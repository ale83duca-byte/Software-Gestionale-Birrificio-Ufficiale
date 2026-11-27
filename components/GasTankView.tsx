import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
    getBreweryData,
    saveBreweryData,
    saveDataToSheet,
    DEFAULT_GAS_TANK_CONFIG,
    getEffectiveGasTankConfig,
    getEffectiveTechGasConfig,
} from '../services/dataService';
import type {
    GasTankConfig,
    GasRefillRecord,
    BrewHeader,
    CostCoefficients,
    TechGasCode,
    TechGasCylinderItem,
    TechGasMovementLog,
    PackagingData,
} from '../types';
import { useToast } from '../hooks/useToast';
import { FireIcon, PlusIcon, TrashIcon, WrenchIcon, CylinderStackIcon, ArrowPathIcon, CheckIcon } from './icons';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface GasTankViewProps {
    selectedYear: string;
    onRefresh?: () => void;
}

const MONTH_SHORT = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];

const parseNumberSafe = (val: string | number | undefined): number => {
    if (typeof val === 'number') return isFinite(val) ? val : 0;
    if (!val) return 0;
    const parsed = parseFloat(String(val).replace(',', '.'));
    return isFinite(parsed) ? parsed : 0;
};

const parseBrewGasMc = (cotta: BrewHeader): number => {
    const directBrew = parseNumberSafe(cotta.GAS_COTTA);
    const counterBrew = Math.max(0, parseNumberSafe(cotta.gasBrewCounterCurrent) - parseNumberSafe(cotta.gasBrewCounterPrevious));
    const brewMc = directBrew > 0 ? directBrew : counterBrew;

    const directPkg = parseNumberSafe(cotta.GAS_CONFEZIONAMENTO);
    const counterPkg = Math.max(0, parseNumberSafe(cotta.gasPackagingCounterCurrent) - parseNumberSafe(cotta.gasPackagingCounterPrevious));
    const pkgMc = directPkg > 0 ? directPkg : counterPkg;

    return Math.max(0, brewMc + pkgMc);
};

const parseItalianOrIsoDate = (dateStr: string | undefined): Date => {
    if (!dateStr) return new Date(0);
    if (dateStr.includes('/')) {
        const [d, m, y] = dateStr.split('/').map(Number);
        if (!isNaN(d) && !isNaN(m) && !isNaN(y)) return new Date(y, m - 1, d);
    }
    const iso = new Date(dateStr);
    return isNaN(iso.getTime()) ? new Date(0) : iso;
};

const formatTodayItalian = (): string => {
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    return `${dd}/${mm}/${now.getFullYear()}`;
};

export const GasTankView: React.FC<GasTankViewProps> = ({ selectedYear, onRefresh }) => {
    const { showToast } = useToast();
    const [activeSection, setActiveSection] = useState<'CISTERNA_COTTE' | 'BOMBOLE_CANTINA'>('CISTERNA_COTTE');
    const [isLoading, setIsLoading] = useState(true);

    // Cisterna GPL / Metano Sala Cotte
    const [config, setConfig] = useState<GasTankConfig>(DEFAULT_GAS_TANK_CONFIG);
    const [refills, setRefills] = useState<GasRefillRecord[]>([]);
    const [cotte, setCotte] = useState<BrewHeader[]>([]);
    const [packaging, setPackaging] = useState<PackagingData[]>([]);
    const [costCoefficients, setCostCoefficients] = useState<CostCoefficients | null>(null);
    const [prevYearRefills, setPrevYearRefills] = useState<GasRefillRecord[]>([]);

    const [showConfigPanel, setShowConfigPanel] = useState(false);
    const [quickGaugePercent, setQuickGaugePercent] = useState<string>('');

    // Form nuovo scarico / rifornimento cisterna
    const [refillDate, setRefillDate] = useState<string>(formatTodayItalian());
    const [fornitore, setFornitore] = useState<string>('');
    const [numeroBolla, setNumeroBolla] = useState<string>('');
    const [litriScaricatiInput, setLitriScaricatiInput] = useState<string>('');
    const [costoTotaleInput, setCostoTotaleInput] = useState<string>('');
    const [noteInput, setNoteInput] = useState<string>('');

    // Bombole Gas Tecnici Cantina (CO2, Azoto, Argon) — Metodo "Cambio Bombola / Vuoto per Pieno"
    const [techGasConfig, setTechGasConfig] = useState<TechGasCylinderItem[]>([]);
    const [techGasLogs, setTechGasLogs] = useState<TechGasMovementLog[]>([]);
    const [editingCylinderCode, setEditingCylinderCode] = useState<TechGasCode | null>(null);
    const [cylinderDraft, setCylinderDraft] = useState<TechGasCylinderItem | null>(null);

    // Form Consegna Fornitore Bombole (Vuoto per Pieno)
    const [delivDate, setDelivDate] = useState<string>(formatTodayItalian());
    const [delivGasCode, setDelivGasCode] = useState<TechGasCode>('CO2');
    const [delivFullQty, setDelivFullQty] = useState<string>('');
    const [delivEmptyReturned, setDelivEmptyReturned] = useState<string>('');
    const [delivSupplier, setDelivSupplier] = useState<string>('');
    const [delivDocRef, setDelivDocRef] = useState<string>('');
    const [delivTotalCost, setDelivTotalCost] = useState<string>('');
    const [delivNote, setDelivNote] = useState<string>('');

    const prevYear = useMemo(() => String(Number(selectedYear) - 1), [selectedYear]);

    const loadData = useCallback(async () => {
        setIsLoading(true);
        const data = await getBreweryData(selectedYear);
        if (data) {
            setConfig(getEffectiveGasTankConfig(data));
            setRefills(data.GAS_REFILLS || []);
            setCotte(data.COTTE_HEAD || []);
            setPackaging(data.CONFEZIONAMENTO || []);
            setCostCoefficients(data.COST_COEFFICIENTS || {});
            setTechGasConfig(getEffectiveTechGasConfig(data));
            setTechGasLogs(data.TECH_GAS_LOGS || []);
        }
        const prev = await getBreweryData(prevYear);
        setPrevYearRefills(prev?.GAS_REFILLS || []);
        setIsLoading(false);
    }, [selectedYear, prevYear]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    // Calcoli fisici Cisterna, Conversione Litri <-> m³ e Consumi Cotte (con supporto dataTaratura per import dati a metà anno)
    const tankStats = useMemo(() => {
        const factor = config.fattoreConversioneLitriAMc > 0 ? config.fattoreConversioneLitriAMc : 0.26;
        const litersPerMc = 1 / factor;
        const usableMaxLiters = Math.max(1, config.capacitaTotaleLitri * (config.percentualeRiempimentoMax / 100));

        const calibrationMs = config.dataTaratura ? parseItalianOrIsoDate(config.dataTaratura).getTime() : 0;

        const totalRefilledLitersAllYear = refills.reduce((sum, r) => sum + (r.litriScaricati || 0), 0);
        const totalRefillCostAllYear = refills.reduce((sum, r) => sum + (r.costoTotale || 0), 0);
        const totalRefilledMcAllYear = totalRefilledLitersAllYear * factor;

        const refilledSinceCalibrationLiters = refills.reduce((sum, r) => {
            if (calibrationMs > 0) {
                const rMs = parseItalianOrIsoDate(r.data).getTime();
                if (rMs > 0 && rMs < calibrationMs) return sum;
            }
            return sum + (r.litriScaricati || 0);
        }, 0);

        const monthlyMc = Array(12).fill(0);
        const monthlyRefillLiters = Array(12).fill(0);

        let totalConsumedMcAllYear = 0;
        let consumedMcSinceCalibration = 0;
        let brewsWithGasCount = 0;

        const brewConsumptionList = cotte.map(c => {
            const mc = parseBrewGasMc(c);
            const d = parseItalianOrIsoDate(c.DATA_PROD);
            const dMs = d.getTime();
            if (mc > 0) {
                totalConsumedMcAllYear += mc;
                brewsWithGasCount += 1;
                if (calibrationMs <= 0 || dMs === 0 || dMs >= calibrationMs) {
                    consumedMcSinceCalibration += mc;
                }
                const m = d.getMonth();
                if (m >= 0 && m < 12) {
                    monthlyMc[m] += mc;
                }
            }
            return {
                lotto: c.LOTTO,
                data: c.DATA_PROD,
                birra: c.NOME_BIRRA,
                cliente: c.CLIENTE,
                mc,
                litriEq: mc / factor,
            };
        }).filter(item => item.mc > 0);

        refills.forEach(r => {
            const d = parseItalianOrIsoDate(r.data);
            const m = d.getMonth();
            if (m >= 0 && m < 12) {
                monthlyRefillLiters[m] += r.litriScaricati || 0;
            }
        });

        const totalConsumedLitersAllYear = totalConsumedMcAllYear / factor;
        const consumedLitersSinceCalibration = consumedMcSinceCalibration / factor;

        const rawRemainingLiters = (config.litriInizialiAnno || 0) + refilledSinceCalibrationLiters - consumedLitersSinceCalibration;
        const remainingLiters = Math.max(0, rawRemainingLiters);
        const remainingMc = remainingLiters * factor;

        const fillPercentOfUsable = Math.min(100, Math.max(0, (remainingLiters / usableMaxLiters) * 100));
        const fillPercentOfGeometric = Math.min(100, Math.max(0, (remainingLiters / Math.max(1, config.capacitaTotaleLitri)) * 100));
        const emptyRefillableSpaceLiters = Math.max(0, usableMaxLiters - remainingLiters);

        const avgMcPerBrew = brewsWithGasCount > 0 ? totalConsumedMcAllYear / brewsWithGasCount : 35;
        const estimatedRemainingBrews = avgMcPerBrew > 0 ? Math.floor(remainingMc / avgMcPerBrew) : 0;

        const avgCostPerLiter = totalRefilledLitersAllYear > 0 ? totalRefillCostAllYear / totalRefilledLitersAllYear : 0;
        const avgCostPerMc = totalRefilledMcAllYear > 0 ? totalRefillCostAllYear / totalRefilledMcAllYear : 0;

        const prevYearTotalLiters = prevYearRefills.reduce((s, r) => s + (r.litriScaricati || 0), 0);
        const prevYearTotalCost = prevYearRefills.reduce((s, r) => s + (r.costoTotale || 0), 0);
        const yoyLitersDeltaPct = prevYearTotalLiters > 0
            ? ((totalRefilledLitersAllYear - prevYearTotalLiters) / prevYearTotalLiters) * 100
            : null;

        const monthlyChartData = MONTH_SHORT.map((name, idx) => ({
            name,
            ScarichiLitri: Math.round(monthlyRefillLiters[idx]),
            ConsumoLitriEq: Math.round((monthlyMc[idx] / factor) * 10) / 10,
            ConsumoMc: Math.round(monthlyMc[idx] * 10) / 10,
        }));

        const isConfigured = (config.litriInizialiAnno || 0) > 0 || refills.length > 0;
        const isInReserve = isConfigured && fillPercentOfUsable <= (config.sogliaRiservaPercent || 20);

        return {
            factor,
            litersPerMc,
            usableMaxLiters,
            totalRefilledLiters: totalRefilledLitersAllYear,
            totalRefillCost: totalRefillCostAllYear,
            totalRefilledMc: totalRefilledMcAllYear,
            totalConsumedMc: totalConsumedMcAllYear,
            totalConsumedLiters: totalConsumedLitersAllYear,
            rawRemainingLiters,
            remainingLiters,
            remainingMc,
            fillPercentOfUsable,
            fillPercentOfGeometric,
            emptyRefillableSpaceLiters,
            avgMcPerBrew,
            estimatedRemainingBrews,
            avgCostPerLiter,
            avgCostPerMc,
            prevYearTotalLiters,
            prevYearTotalCost,
            yoyLitersDeltaPct,
            monthlyChartData,
            brewConsumptionList,
            isConfigured,
            isInReserve,
        };
    }, [config, refills, cotte, prevYearRefills]);

    // Analisi Consumi & Costi Bombole Gas Tecnici (senza pesate singole!)
    const techGasAnalytics = useMemo(() => {
        const totalPackagedLiters = packaging.reduce((s, p) => s + (p.LITRI_TOT || 0), 0);
        const co2BrewsCount = Math.max(1, cotte.filter(c => c.FLAG_CO2 !== false).length || cotte.length || 1);
        const azotoBrewsCount = Math.max(1, cotte.filter(c => c.FLAG_AZOTO).length || 1);

        const swapsByGas: Record<TechGasCode, number> = { CO2: 0, AZOTO: 0, ARGON: 0 };
        const spendByGas: Record<TechGasCode, number> = { CO2: 0, AZOTO: 0, ARGON: 0 };
        const deliveredByGas: Record<TechGasCode, number> = { CO2: 0, AZOTO: 0, ARGON: 0 };

        techGasLogs.forEach(log => {
            if (log.tipo === 'CAMBIO_BOMBOLA') {
                swapsByGas[log.codice] = (swapsByGas[log.codice] || 0) + (log.quantita || 1);
            } else if (log.tipo === 'CONSEGNA_FORNITORE') {
                deliveredByGas[log.codice] = (deliveredByGas[log.codice] || 0) + (log.quantita || 0);
                spendByGas[log.codice] = (spendByGas[log.codice] || 0) + (log.costoTotale || 0);
            }
        });

        const co2Cfg = techGasConfig.find(c => c.codice === 'CO2');
        const azotoCfg = techGasConfig.find(c => c.codice === 'AZOTO');

        const co2KgUsed = swapsByGas.CO2 * (co2Cfg?.formatoCapacita || 30);
        const co2GramsPerLiterPackaged = totalPackagedLiters > 0 && co2KgUsed > 0
            ? (co2KgUsed * 1000) / totalPackagedLiters
            : null;

        const unitCostCo2 = deliveredByGas.CO2 > 0 && spendByGas.CO2 > 0
            ? spendByGas.CO2 / deliveredByGas.CO2
            : (co2Cfg?.costoMedioRicarica || 38);
        const unitCostAzoto = deliveredByGas.AZOTO > 0 && spendByGas.AZOTO > 0
            ? spendByGas.AZOTO / deliveredByGas.AZOTO
            : (azotoCfg?.costoMedioRicarica || 45);

        const realCo2CostPerBrew = swapsByGas.CO2 > 0
            ? (swapsByGas.CO2 * unitCostCo2) / co2BrewsCount
            : null;
        const realAzotoCostPerBrew = swapsByGas.AZOTO > 0
            ? (swapsByGas.AZOTO * unitCostAzoto) / azotoBrewsCount
            : null;

        const lowStockAlerts = techGasConfig.filter(
            item =>
                item.attivo &&
                (item.pieneScorta + item.inUsoImpianto + item.vuoteDaRendere) > 0 &&
                item.pieneScorta <= item.sogliaAllarmePiene
        );

        return {
            totalPackagedLiters,
            swapsByGas,
            spendByGas,
            deliveredByGas,
            co2KgUsed,
            co2GramsPerLiterPackaged,
            realCo2CostPerBrew,
            realAzotoCostPerBrew,
            totalSpendYear: spendByGas.CO2 + spendByGas.AZOTO + spendByGas.ARGON,
            lowStockAlerts,
        };
    }, [packaging, cotte, techGasLogs, techGasConfig]);

    // Anteprima live del form di rifornimento cisterna
    const liveRefillPreview = useMemo(() => {
        const litri = parseNumberSafe(litriScaricatiInput);
        const costo = parseNumberSafe(costoTotaleInput);
        const factor = tankStats.factor;
        const mcEquivalenti = litri * factor;
        const euroPerLitro = litri > 0 ? costo / litri : 0;
        const euroPerMc = mcEquivalenti > 0 ? costo / mcEquivalenti : 0;
        const postRefillLiters = tankStats.remainingLiters + litri;
        const exceedsSafeLimit = postRefillLiters > tankStats.usableMaxLiters + 5;
        return { litri, costo, mcEquivalenti, euroPerLitro, euroPerMc, postRefillLiters, exceedsSafeLimit };
    }, [litriScaricatiInput, costoTotaleInput, tankStats]);

    const handleSaveConfig = async (e: React.FormEvent) => {
        e.preventDefault();
        await saveDataToSheet(selectedYear, 'GAS_TANK_CONFIG', config);
        showToast('Configurazione Cisterna Gas salvata con successo!', 'success');
        setShowConfigPanel(false);
        onRefresh?.();
    };

    const handleQuickCalibrateToday = async () => {
        const pct = parseNumberSafe(quickGaugePercent);
        if (pct <= 0 || pct > 100) {
            showToast('Inserisci la percentuale letta sul manometro fisico della cisterna (es. 55 per il 55%).', 'error');
            return;
        }
        // Il manometro meccanico sui serbatoi GPL indica la % sul volume geometrico totale (max 85%)
        const calibratedLiters = Math.round(config.capacitaTotaleLitri * (pct / 100) * 10) / 10;
        const todayIt = formatTodayItalian();
        const updatedCfg: GasTankConfig = {
            ...config,
            litriInizialiAnno: calibratedLiters,
            dataTaratura: todayIt,
        };
        await saveDataToSheet(selectedYear, 'GAS_TANK_CONFIG', updatedCfg);
        setConfig(updatedCfg);
        setQuickGaugePercent('');
        showToast(
            `Cisterna allineata al manometro di oggi (${pct}% = ${Math.round(calibratedLiters)} L dal ${todayIt}). Le cotte precedenti non verranno sottratte due volte!`,
            'success'
        );
        onRefresh?.();
    };

    const handleAddRefill = async (e: React.FormEvent) => {
        e.preventDefault();
        const litri = parseNumberSafe(litriScaricatiInput);
        const costo = parseNumberSafe(costoTotaleInput);

        if (litri <= 0) {
            showToast('Inserisci i Litri scaricati dall\'autobotte (valore > 0).', 'error');
            return;
        }
        if (costo < 0) {
            showToast('Il costo non può essere negativo.', 'error');
            return;
        }

        const mcEq = Math.round(litri * tankStats.factor * 100) / 100;
        const prezzoL = Math.round((costo / litri) * 10000) / 10000;
        const prezzoMc = mcEq > 0 ? Math.round((costo / mcEq) * 10000) / 10000 : 0;

        const newRecord: GasRefillRecord = {
            id: `GAS_REFILL_${Date.now()}`,
            data: refillDate.trim() || formatTodayItalian(),
            gasType: config.gasType,
            fornitore: fornitore.trim() || 'Fornitore Gas',
            numeroBolla: numeroBolla.trim() || '-',
            litriScaricati: litri,
            mcEquivalenti: mcEq,
            costoTotale: costo,
            prezzoAlLitro: prezzoL,
            prezzoAlMc: prezzoMc,
            note: noteInput.trim() || undefined,
        };

        const updated = [newRecord, ...refills];
        await saveDataToSheet(selectedYear, 'GAS_REFILLS', updated);
        setRefills(updated);
        setLitriScaricatiInput('');
        setCostoTotaleInput('');
        setNumeroBolla('');
        setNoteInput('');
        showToast(`Scarico di ${litri.toLocaleString('it-IT')} L (${mcEq.toFixed(1)} m³) registrato in cisterna!`, 'success');
        onRefresh?.();
    };

    const handleDeleteRefill = async (id: string) => {
        if (!window.confirm('Vuoi eliminare questa registrazione di scarico gas? Il livello cisterna verrà ricalcolato.')) return;
        const updated = refills.filter(r => r.id !== id);
        await saveDataToSheet(selectedYear, 'GAS_REFILLS', updated);
        setRefills(updated);
        showToast('Scarico gas rimosso.', 'info');
        onRefresh?.();
    };

    const handleSyncGasCostCoefficient = async () => {
        if (!costCoefficients || tankStats.avgCostPerMc <= 0) {
            showToast('Registra almeno uno scarico con costo per calcolare il prezzo medio €/m³.', 'warning');
            return;
        }
        const roundedCostMc = Math.round(tankStats.avgCostPerMc * 1000) / 1000;
        const updatedCoeffs: CostCoefficients = {
            ...costCoefficients,
            ...(config.gasType === 'gpl'
                ? { prezzo_gpl_mc: roundedCostMc }
                : { prezzo_metano_mc: roundedCostMc }),
        };
        await saveDataToSheet(selectedYear, 'COST_COEFFICIENTS', updatedCoeffs);
        setCostCoefficients(updatedCoeffs);
        showToast(`Coefficiente ${config.gasType.toUpperCase()} aggiornato a € ${roundedCostMc.toFixed(3)} / m³ per l'Analisi Costi!`, 'success');
        onRefresh?.();
    };

    // --- AZIONI BOMBOLE GAS TECNICI CANTINA (ZERO PESATE) ---
    const handleSwapEmptyCylinder = async (item: TechGasCylinderItem) => {
        if (item.pieneScorta <= 0 && item.inUsoImpianto <= 0) {
            showToast(
                `Imposta prima quante bombole di ${item.nome} hai in cantina cliccando "Imposta Scorta".`,
                'warning'
            );
            return;
        }
        if (item.pieneScorta <= 0) {
            if (!window.confirm(`Attenzione: risultano 0 bombole piene di scorta per ${item.nome}! Vuoi comunque segnare finita la bombola in uso (passandola tra le Vuote)?`)) {
                return;
            }
        }

        const data = await getBreweryData(selectedYear);
        if (!data) return;

        const nextConfig = techGasConfig.map(c => {
            if (c.codice !== item.codice) return c;
            if (c.pieneScorta > 0) {
                // La vecchia bombola in uso diventa vuota (+1 vuote), e 1 piena di scorta entra in uso (-1 piene, inUso resta invariato o va a 1 se era 0)
                return {
                    ...c,
                    pieneScorta: c.pieneScorta - 1,
                    inUsoImpianto: Math.max(1, c.inUsoImpianto),
                    vuoteDaRendere: c.vuoteDaRendere + 1,
                };
            }
            return {
                ...c,
                inUsoImpianto: Math.max(0, c.inUsoImpianto - 1),
                vuoteDaRendere: c.vuoteDaRendere + 1,
            };
        });

        const newLog: TechGasMovementLog = {
            id: `TGAS_SWAP_${Date.now()}`,
            data: formatTodayItalian(),
            codice: item.codice,
            tipo: 'CAMBIO_BOMBOLA',
            quantita: 1,
            note: item.pieneScorta > 0
                ? `Bombola esaurita sostituita con nuova dalla scorta (${item.formatoCapacita} ${item.unitaCapacita})`
                : 'Bombola in uso esaurita (nessuna piena in scorta!)',
        };

        const nextLogs = [newLog, ...techGasLogs];
        data.TECH_GAS_CONFIG = nextConfig;
        data.TECH_GAS_LOGS = nextLogs;
        await saveBreweryData(selectedYear, data);

        setTechGasConfig(nextConfig);
        setTechGasLogs(nextLogs);
        const updatedItem = nextConfig.find(c => c.codice === item.codice)!;
        if (updatedItem.pieneScorta <= updatedItem.sogliaAllarmePiene) {
            showToast(
                `Cambio ${item.codice} registrato! ATTENZIONE: restano solo ${updatedItem.pieneScorta} bombole piene di scorta, prenota il fornitore.`,
                'warning'
            );
        } else {
            showToast(
                `Cambio bombola ${item.codice} registrato! Restano ${updatedItem.pieneScorta} piene di scorta e ${updatedItem.vuoteDaRendere} vuote da rendere.`,
                'success'
            );
        }
        onRefresh?.();
    };

    const handleSaveCylinderDraft = async () => {
        if (!cylinderDraft) return;
        const data = await getBreweryData(selectedYear);
        if (!data) return;

        const nextConfig = techGasConfig.map(c =>
            c.codice === cylinderDraft.codice ? { ...cylinderDraft } : c
        );
        const adjLog: TechGasMovementLog = {
            id: `TGAS_ADJ_${Date.now()}`,
            data: formatTodayItalian(),
            codice: cylinderDraft.codice,
            tipo: 'RETTIFICA_SCORTA',
            quantita: cylinderDraft.pieneScorta,
            note: `Allineamento scorta fisica: ${cylinderDraft.pieneScorta} piene, ${cylinderDraft.inUsoImpianto} in uso, ${cylinderDraft.vuoteDaRendere} vuote`,
        };
        const nextLogs = [adjLog, ...techGasLogs];

        data.TECH_GAS_CONFIG = nextConfig;
        data.TECH_GAS_LOGS = nextLogs;
        await saveBreweryData(selectedYear, data);

        setTechGasConfig(nextConfig);
        setTechGasLogs(nextLogs);
        setEditingCylinderCode(null);
        setCylinderDraft(null);
        showToast(`Dotazione bombole ${cylinderDraft.nome} aggiornata!`, 'success');
        onRefresh?.();
    };

    const handleRegisterCylinderDelivery = async (e: React.FormEvent) => {
        e.preventDefault();
        const fullIn = Math.round(parseNumberSafe(delivFullQty));
        const emptyOut = Math.round(parseNumberSafe(delivEmptyReturned));
        const cost = parseNumberSafe(delivTotalCost);

        if (fullIn <= 0 && emptyOut <= 0) {
            showToast('Inserisci almeno il numero di bombole piene consegnate.', 'error');
            return;
        }

        const data = await getBreweryData(selectedYear);
        if (!data) return;

        const nextConfig = techGasConfig.map(c => {
            if (c.codice !== delivGasCode) return c;
            const newAvgCost = fullIn > 0 && cost > 0 ? Math.round((cost / fullIn) * 100) / 100 : c.costoMedioRicarica;
            return {
                ...c,
                pieneScorta: Math.max(0, c.pieneScorta + fullIn),
                vuoteDaRendere: Math.max(0, c.vuoteDaRendere - emptyOut),
                costoMedioRicarica: newAvgCost,
            };
        });

        const newLog: TechGasMovementLog = {
            id: `TGAS_DELIV_${Date.now()}`,
            data: delivDate.trim() || formatTodayItalian(),
            codice: delivGasCode,
            tipo: 'CONSEGNA_FORNITORE',
            quantita: fullIn,
            vuotiResi: emptyOut,
            fornitore: delivSupplier.trim() || 'Fornitore Gas Tecnici',
            numeroBolla: delivDocRef.trim() || '-',
            costoTotale: cost,
            note: delivNote.trim() || undefined,
        };

        const nextLogs = [newLog, ...techGasLogs];
        data.TECH_GAS_CONFIG = nextConfig;
        data.TECH_GAS_LOGS = nextLogs;
        await saveBreweryData(selectedYear, data);

        setTechGasConfig(nextConfig);
        setTechGasLogs(nextLogs);
        setDelivFullQty('');
        setDelivEmptyReturned('');
        setDelivDocRef('');
        setDelivTotalCost('');
        setDelivNote('');
        showToast(`Consegna Vuoto per Pieno (${fullIn} piene ${delivGasCode}) registrata!`, 'success');
        onRefresh?.();
    };

    const handleDeleteTechGasLog = async (log: TechGasMovementLog) => {
        if (!window.confirm('Eliminare questa voce dal registro bombole?')) return;
        const data = await getBreweryData(selectedYear);
        if (!data) return;
        const nextLogs = techGasLogs.filter(l => l.id !== log.id);
        data.TECH_GAS_LOGS = nextLogs;
        await saveBreweryData(selectedYear, data);
        setTechGasLogs(nextLogs);
        showToast('Registrazione rimossa.', 'info');
        onRefresh?.();
    };

    const handleSyncTechGasCoefficients = async () => {
        if (!costCoefficients) return;
        const updatedCoeffs: CostCoefficients = { ...costCoefficients };
        let changed = false;
        if (techGasAnalytics.realCo2CostPerBrew && techGasAnalytics.realCo2CostPerBrew > 0) {
            updatedCoeffs.costo_co2 = Math.round(techGasAnalytics.realCo2CostPerBrew * 100) / 100;
            changed = true;
        }
        if (techGasAnalytics.realAzotoCostPerBrew && techGasAnalytics.realAzotoCostPerBrew > 0) {
            updatedCoeffs.costo_azoto = Math.round(techGasAnalytics.realAzotoCostPerBrew * 100) / 100;
            changed = true;
        }
        if (!changed) {
            showToast('Registra almeno un cambio bombola per calcolare il costo medio reale a cotta.', 'warning');
            return;
        }
        await saveDataToSheet(selectedYear, 'COST_COEFFICIENTS', updatedCoeffs);
        setCostCoefficients(updatedCoeffs);
        showToast('Coefficienti CO₂ / Azoto per Cotta aggiornati con successo nell\'Analisi Costi!', 'success');
        onRefresh?.();
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center p-12 text-slate-400">
                <div className="w-6 h-6 border-2 border-brew-accent border-t-transparent rounded-full animate-spin mr-3"></div>
                <span>Caricamento gestione Gas Sala Cotte &amp; Bombole Cantina...</span>
            </div>
        );
    }

    const gasLabel = config.gasType.toUpperCase();
    const needleAngleDeg = -90 + (tankStats.fillPercentOfUsable / 100) * 180;

    const sortedRefills = [...refills].sort(
        (a, b) => parseItalianOrIsoDate(b.data).getTime() - parseItalianOrIsoDate(a.data).getTime()
    );

    return (
        <div className="space-y-6 pb-12">
            {/* Header & Selettore Reparto Gas */}
            <div className="bg-brew-dark p-5 rounded-xl border border-slate-700 flex flex-col xl:flex-row xl:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl sm:text-3xl font-extrabold text-brew-accent flex items-center gap-2.5">
                        <FireIcon className="w-7 h-7 text-orange-400" />
                        <span>Gestione Cisterna Gas ({gasLabel}) &amp; Bombole Cantina — {selectedYear}</span>
                    </h1>
                    <p className="text-sm text-slate-400 mt-1">
                        Controllo serbatoio accumulo Sala Cotte (Litri ↔ m³) e gestione semplificata &quot;Cambio Bombola&quot; per CO₂, Azoto e Argon
                    </p>
                </div>

                <div className="inline-flex rounded-lg border border-slate-600 bg-brew-dark-secondary p-1 text-xs sm:text-sm self-start xl:self-auto">
                    <button
                        type="button"
                        onClick={() => setActiveSection('CISTERNA_COTTE')}
                        className={`px-4 py-2 rounded-md font-bold transition-colors whitespace-nowrap ${
                            activeSection === 'CISTERNA_COTTE'
                                ? 'bg-brew-accent text-brew-dark shadow'
                                : 'text-slate-300 hover:text-white'
                        }`}
                    >
                        ⛽ Cisterna {gasLabel} (Sala Cotte)
                    </button>
                    <button
                        type="button"
                        onClick={() => setActiveSection('BOMBOLE_CANTINA')}
                        className={`px-4 py-2 rounded-md font-bold transition-colors whitespace-nowrap flex items-center gap-1.5 ${
                            activeSection === 'BOMBOLE_CANTINA'
                                ? 'bg-cyan-500 text-slate-950 shadow'
                                : 'text-slate-300 hover:text-white'
                        }`}
                    >
                        <span>🫧 Bombole CO₂ / Azoto / Argon</span>
                        {techGasAnalytics.lowStockAlerts.length > 0 && (
                            <span className="px-1.5 py-0.5 rounded bg-red-600 text-white text-[10px] font-black">
                                {techGasAnalytics.lowStockAlerts.length}
                            </span>
                        )}
                    </button>
                </div>
            </div>

            {activeSection === 'CISTERNA_COTTE' ? (
                <div className="space-y-6">
                    {/* Toolbar azioni cisterna */}
                    <div className="flex flex-wrap items-center justify-between gap-3 bg-brew-dark p-4 rounded-xl border border-slate-700">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                            <span className="font-bold text-slate-300">Allineamento rapido al manometro esterno oggi:</span>
                            <input
                                type="number"
                                step="1"
                                min="1"
                                max="95"
                                placeholder="% manometro (es. 60)"
                                value={quickGaugePercent}
                                onChange={e => setQuickGaugePercent(e.target.value)}
                                className="w-44 bg-brew-dark-secondary border border-slate-600 rounded-lg px-3 py-1.5 text-white font-mono tabular-nums"
                            />
                            <button
                                type="button"
                                onClick={handleQuickCalibrateToday}
                                className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded-lg font-bold transition-colors whitespace-nowrap"
                                title="Imposta il livello attuale partendo dalla % del manometro fisico oggi: le cotte passate non verranno sottratte due volte"
                            >
                                Allinea Oggi %
                            </button>
                            {config.dataTaratura && (
                                <span className="text-slate-400">
                                    · Tarato il <strong className="text-amber-300 font-mono">{config.dataTaratura}</strong>
                                </span>
                            )}
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                            {tankStats.avgCostPerMc > 0 && (
                                <button
                                    onClick={handleSyncGasCostCoefficient}
                                    className="px-3.5 py-2 bg-emerald-700 hover:bg-emerald-600 text-white rounded-lg text-xs font-bold transition-colors whitespace-nowrap"
                                    title="Allinea il costo €/m³ usato nell'Analisi Costi Cotta con il prezzo medio reale delle bolle gas dell'anno"
                                >
                                    Allinea Costo Cotta (€ {tankStats.avgCostPerMc.toFixed(2)}/m³)
                                </button>
                            )}
                            <button
                                onClick={() => setShowConfigPanel(!showConfigPanel)}
                                className="px-3.5 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-xs font-bold flex items-center gap-2 border border-slate-500 transition-colors whitespace-nowrap"
                            >
                                <WrenchIcon className="w-4 h-4 text-brew-accent" />
                                <span>{showConfigPanel ? 'Chiudi Parametri Cisterna' : 'Parametri Cisterna & Litri/m³'}</span>
                            </button>
                        </div>
                    </div>

                    {/* Allarme Riserva Gas */}
                    {tankStats.isInReserve && (
                        <div className="p-4 rounded-xl bg-red-950/80 border border-red-500 text-red-100 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                            <div>
                                <div className="text-sm font-black uppercase tracking-wider text-red-300">
                                    SPIA RISERVA CISTERNA {gasLabel} ATTIVA ({tankStats.fillPercentOfUsable.toFixed(1)}% del livello utile)
                                </div>
                                <p className="text-xs text-slate-200 mt-1">
                                    Restano circa <strong>{tankStats.remainingLiters.toFixed(0)} Litri</strong> ({tankStats.remainingMc.toFixed(1)} m³ gas · autonomia stimata: <strong>~{tankStats.estimatedRemainingBrews} cotte</strong>).
                                    Puoi ordinare fino a <strong>{Math.floor(tankStats.emptyRefillableSpaceLiters).toLocaleString('it-IT')} Litri</strong> per arrivare all&apos;{config.percentualeRiempimentoMax}% di sicurezza.
                                </p>
                            </div>
                        </div>
                    )}

                    {/* Pannello Configurazione Tecnica Cisterna e Conversione Litri <-> m³ */}
                    {showConfigPanel && (
                        <form onSubmit={handleSaveConfig} className="bg-brew-dark p-5 rounded-xl border border-brew-accent/70 space-y-4">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-700 pb-3">
                                <div>
                                    <h2 className="text-lg font-bold text-brew-accent">Parametri Fisici Cisterna &amp; Conversione Litri ↔ m³</h2>
                                    <p className="text-xs text-slate-400">
                                        L&apos;autobotte scarica in <strong>Litri di liquido</strong>, mentre il contatore della sala cotte misura i <strong>m³ di gas vaporizzato</strong>.
                                    </p>
                                </div>
                                <div className="flex flex-wrap gap-1.5 text-xs">
                                    <button
                                        type="button"
                                        onClick={() => setConfig({ ...config, gasType: 'gpl', fattoreConversioneLitriAMc: 0.26 })}
                                        className="px-2.5 py-1 bg-amber-700/60 hover:bg-amber-600 text-amber-100 rounded font-bold border border-amber-500/50"
                                    >
                                        Preset GPL Standard (1 L = 0,260 m³)
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setConfig({ ...config, gasType: 'gpl', fattoreConversioneLitriAMc: 0.273 })}
                                        className="px-2.5 py-1 bg-sky-800/60 hover:bg-sky-700 text-sky-100 rounded font-bold border border-sky-500/50"
                                    >
                                        Preset Propano Puro (1 L = 0,273 m³)
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setConfig({ ...config, gasType: 'metano', fattoreConversioneLitriAMc: 0.60, percentualeRiempimentoMax: 90 })}
                                        className="px-2.5 py-1 bg-emerald-800/60 hover:bg-emerald-700 text-emerald-100 rounded font-bold border border-emerald-500/50"
                                    >
                                        Preset Metano Liquido GNL (1 L = 0,600 m³)
                                    </button>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
                                <div>
                                    <label className="block text-xs font-bold uppercase text-slate-300 mb-1">Tipologia Gas Cisterna</label>
                                    <select
                                        value={config.gasType}
                                        onChange={e => setConfig({ ...config, gasType: e.target.value as 'gpl' | 'metano' })}
                                        className="w-full bg-brew-dark-secondary border border-slate-600 rounded-lg p-2.5 text-white font-semibold"
                                    >
                                        <option value="gpl">GPL (Propano / Butano in Cisterna)</option>
                                        <option value="metano">Metano / GNL (Cisterna Accumulo)</option>
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-xs font-bold uppercase text-slate-300 mb-1">Capacità Geometrica Serbatoio (Litri)</label>
                                    <input
                                        type="number"
                                        step="10"
                                        min="100"
                                        value={config.capacitaTotaleLitri}
                                        onChange={e => setConfig({ ...config, capacitaTotaleLitri: parseNumberSafe(e.target.value) })}
                                        className="w-full bg-brew-dark-secondary border border-slate-600 rounded-lg p-2.5 text-white font-mono tabular-nums"
                                    />
                                    <p className="text-[11px] text-slate-400 mt-1">Es. serbatoi tipici: 1.650 L, 2.750 L, 3.000 L, 5.000 L</p>
                                </div>

                                <div>
                                    <label className="block text-xs font-bold uppercase text-slate-300 mb-1">Riempimento Max Sicurezza (%)</label>
                                    <input
                                        type="number"
                                        step="1"
                                        min="50"
                                        max="100"
                                        value={config.percentualeRiempimentoMax}
                                        onChange={e => setConfig({ ...config, percentualeRiempimentoMax: parseNumberSafe(e.target.value) })}
                                        className="w-full bg-brew-dark-secondary border border-slate-600 rounded-lg p-2.5 text-white font-mono tabular-nums"
                                    />
                                    <p className="text-[11px] text-slate-400 mt-1">
                                        Capienza max utile (&quot;F&quot;): <strong>{Math.round(config.capacitaTotaleLitri * (config.percentualeRiempimentoMax / 100))} L</strong>
                                    </p>
                                </div>

                                <div>
                                    <label className="block text-xs font-bold uppercase text-amber-300 mb-1">
                                        Fattore Conversione: m³ Gas per 1 Litro Liquido
                                    </label>
                                    <input
                                        type="number"
                                        step="0.001"
                                        min="0.05"
                                        max="5"
                                        value={config.fattoreConversioneLitriAMc}
                                        onChange={e => setConfig({ ...config, fattoreConversioneLitriAMc: parseNumberSafe(e.target.value) })}
                                        className="w-full bg-slate-900 border border-amber-500 rounded-lg p-2.5 text-amber-300 font-mono tabular-nums font-bold"
                                    />
                                    <p className="text-[11px] text-amber-200/80 mt-1">
                                        1 m³ a contatore = <strong>{(1 / Math.max(0.01, config.fattoreConversioneLitriAMc)).toFixed(2)} Litri</strong> in cisterna
                                    </p>
                                </div>

                                <div>
                                    <label className="block text-xs font-bold uppercase text-slate-300 mb-1">
                                        Livello Riferimento / Inizio Anno (Litri)
                                    </label>
                                    <input
                                        type="number"
                                        step="1"
                                        min="0"
                                        value={config.litriInizialiAnno}
                                        onChange={e => setConfig({ ...config, litriInizialiAnno: parseNumberSafe(e.target.value) })}
                                        className="w-full bg-brew-dark-secondary border border-slate-600 rounded-lg p-2.5 text-white font-mono tabular-nums"
                                    />
                                    <p className="text-[11px] text-slate-400 mt-1">
                                        {config.dataTaratura ? `Riferito alla data taratura ${config.dataTaratura}` : `Giacenza al 01/01/${selectedYear}`}
                                    </p>
                                </div>

                                <div>
                                    <label className="block text-xs font-bold uppercase text-slate-300 mb-1">
                                        Data Taratura Livello (Opzionale, GG/MM/AAAA)
                                    </label>
                                    <div className="flex gap-2">
                                        <input
                                            type="text"
                                            placeholder={`es. 01/01/${selectedYear}`}
                                            value={config.dataTaratura || ''}
                                            onChange={e => setConfig({ ...config, dataTaratura: e.target.value.trim() || undefined })}
                                            className="w-full bg-brew-dark-secondary border border-slate-600 rounded-lg p-2.5 text-white font-mono tabular-nums"
                                        />
                                        {config.dataTaratura && (
                                            <button
                                                type="button"
                                                onClick={() => setConfig({ ...config, dataTaratura: undefined })}
                                                className="px-2.5 py-1 bg-slate-700 hover:bg-slate-600 text-xs text-slate-200 rounded-lg"
                                                title="Azzera data taratura e calcola dall'1 Gennaio"
                                            >
                                                Reset
                                            </button>
                                        )}
                                    </div>
                                    <p className="text-[11px] text-slate-400 mt-1">Ignora nel livello le cotte antecedenti a questa data</p>
                                </div>
                            </div>

                            <div className="flex justify-end gap-2 pt-2 border-t border-slate-700">
                                <button
                                    type="button"
                                    onClick={() => setShowConfigPanel(false)}
                                    className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg text-xs font-bold"
                                >
                                    Annulla
                                </button>
                                <button
                                    type="submit"
                                    className="px-5 py-2 bg-brew-accent hover:bg-yellow-400 text-brew-dark rounded-lg text-xs font-extrabold"
                                >
                                    Salva Parametri Cisterna
                                </button>
                            </div>
                        </form>
                    )}

                    {/* RIGA PRINCIPALE: CRUSCOTTO INDICATORE LIVELLO AUTO + MODULO REGISTRAZIONE SCARICO */}
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                        <div className="lg:col-span-6 bg-brew-dark p-6 rounded-xl border border-slate-700 flex flex-col justify-between">
                            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                                <div>
                                    <span className="text-xs font-bold text-amber-400">
                                        Manometro Digitale &amp; Lancetta Livello
                                    </span>
                                    <h2 className="text-xl font-black text-white mt-0.5">
                                        Situazione Attuale Cisterna {gasLabel}
                                    </h2>
                                </div>
                                <span className={`text-xs font-bold ${
                                    !tankStats.isConfigured
                                        ? 'text-slate-400'
                                        : tankStats.isInReserve
                                            ? 'text-red-400'
                                            : tankStats.fillPercentOfUsable < 40
                                                ? 'text-amber-300'
                                                : 'text-emerald-400'
                                }`}>
                                    {!tankStats.isConfigured
                                        ? 'Da calibrare'
                                        : tankStats.isInReserve
                                            ? '⛽ IN RISERVA'
                                            : '✓ LIVELLO REGOLARE'}
                                </span>
                            </div>

                            {/* SVG Automotive Fuel Gauge */}
                            <div className="flex flex-col items-center justify-center my-4">
                                <svg viewBox="0 0 320 195" className="w-full max-w-md select-none">
                                    <defs>
                                        <linearGradient id="gaugeArcGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                                            <stop offset="0%" stopColor="#ef4444" />
                                            <stop offset="22%" stopColor="#ef4444" />
                                            <stop offset="28%" stopColor="#f59e0b" />
                                            <stop offset="60%" stopColor="#eab308" />
                                            <stop offset="100%" stopColor="#10b981" />
                                        </linearGradient>
                                    </defs>

                                    <path
                                        d="M 35 160 A 125 125 0 0 1 285 160"
                                        fill="none"
                                        stroke="#1e293b"
                                        strokeWidth="24"
                                        strokeLinecap="round"
                                    />
                                    <path
                                        d="M 35 160 A 125 125 0 0 1 285 160"
                                        fill="none"
                                        stroke="url(#gaugeArcGrad)"
                                        strokeWidth="18"
                                        strokeLinecap="butt"
                                    />

                                    {[
                                        { pct: 0, label: 'E', color: '#f87171' },
                                        { pct: 25, label: '1/4', color: '#cbd5e1' },
                                        { pct: 50, label: '1/2', color: '#f8fafc' },
                                        { pct: 75, label: '3/4', color: '#cbd5e1' },
                                        { pct: 100, label: 'F', color: '#34d399' },
                                    ].map(tick => {
                                        const rad = ((-180 + (tick.pct / 100) * 180) * Math.PI) / 180;
                                        const x1 = 160 + Math.cos(rad) * 105;
                                        const y1 = 160 + Math.sin(rad) * 105;
                                        const x2 = 160 + Math.cos(rad) * 136;
                                        const y2 = 160 + Math.sin(rad) * 136;
                                        const lx = 160 + Math.cos(rad) * 84;
                                        const ly = 160 + Math.sin(rad) * 84;
                                        return (
                                            <g key={tick.label}>
                                                <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#0f172a" strokeWidth="3.5" />
                                                <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#f8fafc" strokeWidth="1.8" />
                                                <text
                                                    x={lx}
                                                    y={ly + 4}
                                                    textAnchor="middle"
                                                    fill={tick.color}
                                                    fontSize={tick.label === 'E' || tick.label === 'F' ? '15' : '11'}
                                                    fontWeight="900"
                                                >
                                                    {tick.label}
                                                </text>
                                            </g>
                                        );
                                    })}

                                    <text x="160" y="122" textAnchor="middle" fill="#94a3b8" fontSize="11" fontWeight="700">
                                        {gasLabel} · {tankStats.fillPercentOfUsable.toFixed(1)}% utile ({tankStats.fillPercentOfGeometric.toFixed(0)}% manometro)
                                    </text>

                                    <g transform={`translate(160, 160) rotate(${needleAngleDeg})`}>
                                        <polygon
                                            points="-5,14 0,-112 5,14"
                                            fill="#f97316"
                                            stroke="#ffffff"
                                            strokeWidth="1"
                                        />
                                    </g>

                                    <circle cx="160" cy="160" r="11" fill="#0f172a" stroke="#f59e0b" strokeWidth="3" />
                                    <circle cx="160" cy="160" r="4" fill="#fbbf24" />
                                </svg>

                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 w-full mt-2 font-mono tabular-nums">
                                    <div className="bg-brew-dark-secondary p-3 rounded-lg border border-slate-700 text-center">
                                        <div className="text-[10px] font-sans font-bold text-amber-300">Gas Residuo (Litri)</div>
                                        <div className="text-xl font-black text-white mt-0.5">
                                            {Math.round(tankStats.remainingLiters).toLocaleString('it-IT')} L
                                        </div>
                                        <div className="text-[10px] font-sans text-slate-400">su {Math.round(tankStats.usableMaxLiters).toLocaleString('it-IT')} L max</div>
                                    </div>

                                    <div className="bg-brew-dark-secondary p-3 rounded-lg border border-slate-700 text-center">
                                        <div className="text-[10px] font-sans font-bold text-cyan-300">Equivalenti Contatore</div>
                                        <div className="text-xl font-black text-cyan-300 mt-0.5">
                                            {tankStats.remainingMc.toFixed(1)} m³
                                        </div>
                                        <div className="text-[10px] font-sans text-slate-400">1 m³ = {tankStats.litersPerMc.toFixed(2)} L</div>
                                    </div>

                                    <div className="bg-brew-dark-secondary p-3 rounded-lg border border-slate-700 text-center">
                                        <div className="text-[10px] font-sans font-bold text-emerald-300">Autonomia Stimata</div>
                                        <div className="text-xl font-black text-emerald-300 mt-0.5">
                                            ~{tankStats.estimatedRemainingBrews} cotte
                                        </div>
                                        <div className="text-[10px] font-sans text-slate-400">media {tankStats.avgMcPerBrew.toFixed(1)} m³/cotta</div>
                                    </div>

                                    <div className="bg-brew-dark-secondary p-3 rounded-lg border border-slate-700 text-center">
                                        <div className="text-[10px] font-sans font-bold text-slate-300">Spazio Scaricabile</div>
                                        <div className="text-xl font-black text-amber-200 mt-0.5">
                                            {Math.floor(tankStats.emptyRefillableSpaceLiters).toLocaleString('it-IT')} L
                                        </div>
                                        <div className="text-[10px] font-sans text-slate-400">fino all&apos;{config.percentualeRiempimentoMax}% sicurezza</div>
                                    </div>
                                </div>
                            </div>

                            <div className="p-3 bg-slate-900/90 rounded-lg border border-slate-700 text-xs text-slate-300 flex flex-wrap items-center justify-between gap-2">
                                <span>
                                    Proporzione attiva: <strong>1 L liquido = {tankStats.factor.toFixed(3)} m³ gas</strong> ({tankStats.litersPerMc.toFixed(2)} L per m³ cotta)
                                </span>
                                <span className="text-slate-400 font-mono tabular-nums">
                                    Serbatoio: {config.capacitaTotaleLitri.toLocaleString('it-IT')} L
                                </span>
                            </div>
                        </div>

                        {/* MODULO REGISTRAZIONE SCARICO / RIFORNIMENTO AUTOBOTTE */}
                        <div className="lg:col-span-6 bg-brew-dark p-6 rounded-xl border border-slate-700 flex flex-col justify-between">
                            <div>
                                <div className="border-b border-slate-800 pb-3 mb-4">
                                    <span className="text-xs font-bold text-emerald-400">
                                        Rifornimento Cisterna da Autobotte
                                    </span>
                                    <h2 className="text-xl font-black text-white mt-0.5">
                                        Registra Scarico / Rifornimento Gas
                                    </h2>
                                    <p className="text-xs text-slate-400 mt-0.5">
                                        Inserisci i <strong>Litri scaricati</strong> riportati sul cartellino/DAS del fornitore: il sistema converte in automatico in m³ per le cotte.
                                    </p>
                                </div>

                                <form onSubmit={handleAddRefill} className="space-y-4">
                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                        <div>
                                            <label className="block text-xs font-bold text-slate-300 mb-1">Data Scarico (GG/MM/AAAA)</label>
                                            <input
                                                type="text"
                                                required
                                                placeholder="es. 15/03/2026"
                                                value={refillDate}
                                                onChange={e => setRefillDate(e.target.value)}
                                                className="w-full bg-brew-dark-secondary border border-slate-600 rounded-lg p-2.5 text-white text-sm font-mono tabular-nums focus:border-brew-accent focus:outline-none"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-slate-300 mb-1">Azienda Fornitrice</label>
                                            <input
                                                type="text"
                                                placeholder="es. Liquigas / Butangas..."
                                                value={fornitore}
                                                onChange={e => setFornitore(e.target.value)}
                                                className="w-full bg-brew-dark-secondary border border-slate-600 rounded-lg p-2.5 text-white text-sm focus:border-brew-accent focus:outline-none"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-slate-300 mb-1">N° Bolla / DAS / Fattura</label>
                                            <input
                                                type="text"
                                                placeholder="es. DAS-4821"
                                                value={numeroBolla}
                                                onChange={e => setNumeroBolla(e.target.value)}
                                                className="w-full bg-brew-dark-secondary border border-slate-600 rounded-lg p-2.5 text-white text-sm font-mono focus:border-brew-accent focus:outline-none"
                                            />
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                        <div>
                                            <label className="block text-xs font-bold text-amber-300 mb-1">
                                                Litri di Gas Scaricati (L) *
                                            </label>
                                            <input
                                                type="number"
                                                step="0.1"
                                                min="0.1"
                                                required
                                                placeholder="es. 1500"
                                                value={litriScaricatiInput}
                                                onChange={e => setLitriScaricatiInput(e.target.value)}
                                                className="w-full bg-slate-900 border border-amber-500/70 rounded-lg p-2.5 text-amber-200 text-base font-mono tabular-nums font-bold focus:border-amber-400 focus:outline-none"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-emerald-300 mb-1">
                                                Costo Totale Scarico (€ IVA escl.) *
                                            </label>
                                            <input
                                                type="number"
                                                step="0.01"
                                                min="0"
                                                required
                                                placeholder="es. 1185.00"
                                                value={costoTotaleInput}
                                                onChange={e => setCostoTotaleInput(e.target.value)}
                                                className="w-full bg-slate-900 border border-emerald-500/70 rounded-lg p-2.5 text-emerald-200 text-base font-mono tabular-nums font-bold focus:border-emerald-400 focus:outline-none"
                                            />
                                        </div>
                                    </div>

                                    <div>
                                        <label className="block text-xs font-bold text-slate-300 mb-1">Note Operatore (Opzionale)</label>
                                        <input
                                            type="text"
                                            placeholder="es. Controllo valvola sicurezza eseguito, lettura manometro 82%"
                                            value={noteInput}
                                            onChange={e => setNoteInput(e.target.value)}
                                            className="w-full bg-brew-dark-secondary border border-slate-600 rounded-lg p-2 text-white text-sm focus:border-brew-accent focus:outline-none"
                                        />
                                    </div>

                                    {liveRefillPreview.litri > 0 && (
                                        <div className={`p-3.5 rounded-lg border text-xs space-y-1.5 ${
                                            liveRefillPreview.exceedsSafeLimit
                                                ? 'bg-red-950/60 border-red-500 text-red-200'
                                                : 'bg-slate-900/90 border-cyan-600/60 text-slate-200'
                                        }`}>
                                            <div className="font-bold text-cyan-300">
                                                Anteprima Conversione Automatica Litri → Metri Cubi:
                                            </div>
                                            <div className="grid grid-cols-3 gap-2 pt-1 font-mono tabular-nums">
                                                <div>
                                                    <span className="text-slate-400 block text-[10px] font-sans">m³ Gas Caricati</span>
                                                    <strong className="text-white text-sm">+{liveRefillPreview.mcEquivalenti.toFixed(1)} m³</strong>
                                                </div>
                                                <div>
                                                    <span className="text-slate-400 block text-[10px] font-sans">Prezzo al Litro</span>
                                                    <strong className="text-amber-300 text-sm">€ {liveRefillPreview.euroPerLitro.toFixed(3)}/L</strong>
                                                </div>
                                                <div>
                                                    <span className="text-slate-400 block text-[10px] font-sans">Costo Reale a m³ Cotta</span>
                                                    <strong className="text-emerald-300 text-sm">€ {liveRefillPreview.euroPerMc.toFixed(3)}/m³</strong>
                                                </div>
                                            </div>
                                            {liveRefillPreview.exceedsSafeLimit && (
                                                <div className="text-red-300 font-bold pt-1">
                                                    Attenzione: sommando questo scarico la cisterna salirebbe a {Math.round(liveRefillPreview.postRefillLiters)} L, oltre il limite utile ({Math.round(tankStats.usableMaxLiters)} L).
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    <button
                                        type="submit"
                                        className="w-full py-3 bg-brew-orange hover:bg-opacity-90 text-white font-extrabold rounded-lg flex items-center justify-center gap-2 transition-colors text-sm"
                                    >
                                        <PlusIcon className="w-5 h-5" />
                                        <span>Registra Scarico in Cisterna</span>
                                    </button>
                                </form>
                            </div>
                        </div>
                    </div>

                    {/* CONTATORE ANNUALE SCARICHI, COSTI & CONSUMI */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 font-mono tabular-nums">
                        <div className="bg-brew-dark p-4 rounded-xl border border-slate-700">
                            <div className="text-xs font-sans font-bold text-slate-400">Scarichi Effettuati ({selectedYear})</div>
                            <div className="text-3xl font-black text-white mt-1">
                                {refills.length} <span className="text-sm font-sans font-normal text-slate-400">rifornimenti</span>
                            </div>
                            <p className="text-xs text-amber-300 mt-1">
                                Totale: {Math.round(tankStats.totalRefilledLiters).toLocaleString('it-IT')} L ({tankStats.totalRefilledMc.toFixed(1)} m³)
                            </p>
                        </div>

                        <div className="bg-brew-dark p-4 rounded-xl border border-slate-700">
                            <div className="text-xs font-sans font-bold text-slate-400">Spesa Gas Annua ({selectedYear})</div>
                            <div className="text-3xl font-black text-emerald-400 mt-1">
                                € {tankStats.totalRefillCost.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </div>
                            <p className="text-xs text-slate-300 mt-1">
                                € {tankStats.avgCostPerLiter.toFixed(3)}/L · <strong>€ {tankStats.avgCostPerMc.toFixed(2)}/m³</strong>
                            </p>
                        </div>

                        <div className="bg-brew-dark p-4 rounded-xl border border-slate-700">
                            <div className="text-xs font-sans font-bold text-slate-400">Gas Consumato nelle Cotte</div>
                            <div className="text-3xl font-black text-cyan-300 mt-1">
                                {tankStats.totalConsumedMc.toFixed(1)} m³
                            </div>
                            <p className="text-xs font-sans text-slate-300 mt-1">
                                Pari a <strong className="font-mono">{Math.round(tankStats.totalConsumedLiters).toLocaleString('it-IT')} L</strong> liquidi equivalenti
                            </p>
                        </div>

                        <div className="bg-brew-dark p-4 rounded-xl border border-slate-700">
                            <div className="text-xs font-sans font-bold text-slate-400">Confronto Anno Prec. ({prevYear})</div>
                            {tankStats.prevYearTotalLiters > 0 ? (
                                <>
                                    <div className={`text-2xl font-black mt-1 ${
                                        (tankStats.yoyLitersDeltaPct || 0) <= 0 ? 'text-emerald-400' : 'text-amber-300'
                                    }`}>
                                        {(tankStats.yoyLitersDeltaPct || 0) > 0 ? '+' : ''}
                                        {(tankStats.yoyLitersDeltaPct || 0).toFixed(1)}% Litri
                                    </div>
                                    <p className="text-xs font-sans text-slate-400 mt-1">
                                        {prevYear}: {Math.round(tankStats.prevYearTotalLiters).toLocaleString('it-IT')} L (€ {tankStats.prevYearTotalCost.toFixed(0)})
                                    </p>
                                </>
                            ) : (
                                <>
                                    <div className="text-lg font-sans font-bold text-slate-400 mt-1">Nessun dato {prevYear}</div>
                                    <p className="text-xs font-sans text-slate-500 mt-1">Confronto attivo dal prossimo anno</p>
                                </>
                            )}
                        </div>
                    </div>

                    {/* GRAFICO MENSILE SCARICHI VS CONSUMI IN LITRI EQUIVALENTI */}
                    <div className="bg-brew-dark p-5 rounded-xl border border-slate-700 space-y-3">
                        <div>
                            <h3 className="text-lg font-bold text-white">Andamento Mensile Scarichi Autobotte vs Consumi Sala Cotte ({selectedYear})</h3>
                            <p className="text-xs text-slate-400">Confronto omogeneo in Litri tra i rifornimenti effettuati e i consumi delle cotte convertiti da m³ a Litri</p>
                        </div>
                        <div className="h-64 w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={tankStats.monthlyChartData} margin={{ top: 15, right: 20, left: 0, bottom: 5 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.5} vertical={false} />
                                    <XAxis dataKey="name" stroke="#94a3b8" tick={{ fill: '#cbd5e1', fontSize: 12 }} />
                                    <YAxis stroke="#94a3b8" tick={{ fill: '#94a3b8', fontSize: 11 }} tickFormatter={(v: number) => `${v} L`} />
                                    <Tooltip
                                        contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px', color: '#f8fafc' }}
                                        formatter={(val: number, name: string) => [`${val.toLocaleString('it-IT')} L`, name]}
                                    />
                                    <Legend wrapperStyle={{ fontSize: 12 }} />
                                    <Bar dataKey="ScarichiLitri" name="Litri Scaricati (Rifornimenti)" fill="#10b981" radius={[4, 4, 0, 0]} />
                                    <Bar dataKey="ConsumoLitriEq" name="Litri Consumati dalle Cotte (da m³)" fill="#f97316" radius={[4, 4, 0, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                    {/* TABELLA STORICO SCARICHI GAS DELL'ANNO */}
                    <div className="bg-brew-dark p-5 rounded-xl border border-slate-700 space-y-4">
                        <div className="flex items-center justify-between border-b border-slate-700 pb-3">
                            <div>
                                <h3 className="text-lg font-bold text-brew-accent">
                                    Registro Storico Scarichi / Rifornimenti Gas — Anno {selectedYear}
                                </h3>
                                <p className="text-xs text-slate-400">
                                    Riepilogo cronologico di tutti i rifornimenti con data, fornitore, bolla, Litri scaricati, m³ equivalenti e costi
                                </p>
                            </div>
                            <span className="text-xs font-mono tabular-nums text-slate-300">
                                {sortedRefills.length} registrazioni
                            </span>
                        </div>

                        {sortedRefills.length === 0 ? (
                            <div className="text-center py-10 text-slate-400 text-sm">
                                Nessuno scarico gas registrato per l&apos;anno {selectedYear}. Compila il modulo sopra al primo rifornimento dell&apos;autobotte.
                            </div>
                        ) : (
                            <div className="overflow-x-auto rounded-lg border border-slate-700">
                                <table className="w-full text-sm text-left text-slate-200 font-mono tabular-nums">
                                    <thead className="text-xs font-sans uppercase bg-slate-800 text-slate-300">
                                        <tr>
                                            <th className="px-4 py-3">Data</th>
                                            <th className="px-4 py-3">Fornitore</th>
                                            <th className="px-4 py-3">N° Bolla / DAS</th>
                                            <th className="px-4 py-3 text-right">Litri Scaricati</th>
                                            <th className="px-4 py-3 text-right">m³ Equivalenti</th>
                                            <th className="px-4 py-3 text-right">Prezzo €/L</th>
                                            <th className="px-4 py-3 text-right">Costo €/m³</th>
                                            <th className="px-4 py-3 text-right">Costo Totale</th>
                                            <th className="px-4 py-3">Note</th>
                                            <th className="px-3 py-3 text-center">Azioni</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-800">
                                        {sortedRefills.map(r => {
                                            const mcVal = r.mcEquivalenti || r.litriScaricati * tankStats.factor;
                                            const euroMc = r.prezzoAlMc || (mcVal > 0 ? r.costoTotale / mcVal : 0);
                                            return (
                                                <tr key={r.id} className="hover:bg-slate-800/50">
                                                    <td className="px-4 py-2.5 font-bold text-white">{r.data}</td>
                                                    <td className="px-4 py-2.5 font-sans font-semibold">{r.fornitore}</td>
                                                    <td className="px-4 py-2.5 text-xs text-slate-300">{r.numeroBolla}</td>
                                                    <td className="px-4 py-2.5 text-right font-bold text-amber-300">
                                                        {r.litriScaricati.toLocaleString('it-IT', { maximumFractionDigits: 1 })} L
                                                    </td>
                                                    <td className="px-4 py-2.5 text-right text-cyan-300">
                                                        {mcVal.toFixed(1)} m³
                                                    </td>
                                                    <td className="px-4 py-2.5 text-right text-xs">
                                                        € {r.prezzoAlLitro.toFixed(3)}
                                                    </td>
                                                    <td className="px-4 py-2.5 text-right text-xs text-emerald-300">
                                                        € {euroMc.toFixed(3)}
                                                    </td>
                                                    <td className="px-4 py-2.5 text-right font-bold text-emerald-400">
                                                        € {r.costoTotale.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                    </td>
                                                    <td className="px-4 py-2.5 font-sans text-xs text-slate-400 max-w-xs truncate" title={r.note || ''}>
                                                        {r.note || '-'}
                                                    </td>
                                                    <td className="px-3 py-2.5 text-center">
                                                        <button
                                                            onClick={() => handleDeleteRefill(r.id)}
                                                            className="p-1.5 text-red-400 hover:text-red-200 hover:bg-red-900/40 rounded transition-colors"
                                                            title="Elimina scarico"
                                                        >
                                                            <TrashIcon className="w-4 h-4" />
                                                        </button>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                        <tr className="bg-slate-900 font-bold border-t border-slate-600">
                                            <td colSpan={3} className="px-4 py-3 font-sans text-brew-accent text-xs uppercase">
                                                Totale Annuale ({sortedRefills.length} scarichi)
                                            </td>
                                            <td className="px-4 py-3 text-right text-amber-300">
                                                {Math.round(tankStats.totalRefilledLiters).toLocaleString('it-IT')} L
                                            </td>
                                            <td className="px-4 py-3 text-right text-cyan-300">
                                                {tankStats.totalRefilledMc.toFixed(1)} m³
                                            </td>
                                            <td className="px-4 py-3 text-right text-xs">
                                                € {tankStats.avgCostPerLiter.toFixed(3)}
                                            </td>
                                            <td className="px-4 py-3 text-right text-xs text-emerald-300">
                                                € {tankStats.avgCostPerMc.toFixed(3)}
                                            </td>
                                            <td className="px-4 py-3 text-right text-emerald-400">
                                                € {tankStats.totalRefillCost.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                            </td>
                                            <td colSpan={2}></td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </div>
            ) : (
                /* ========================================================================= */
                /* SEZIONE 2: BOMBOLE GAS TECNICI CANTINA (CO2 / AZOTO / ARGON)              */
                /* METODO "CAMBIO BOMBOLA / VUOTO PER PIENO" — ZERO PESATE DURANTE LE COTTE! */
                /* ========================================================================= */
                <div className="space-y-6">
                    {/* Spiegazione chiara del metodo senza pesate */}
                    <div className="bg-brew-dark p-5 rounded-xl border border-cyan-600/50 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                        <div className="space-y-1">
                            <h2 className="text-lg font-bold text-cyan-300 flex items-center gap-2">
                                <CylinderStackIcon className="w-5 h-5" />
                                <span>Metodo &quot;Cambio Bombola / Vuoto per Pieno&quot; — Non serve misurare o pesare nulla durante le lavorazioni!</span>
                            </h2>
                            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                                Durante saturazioni, lavaggi fusti o imbottigliamenti isobarici <strong>non devi segnare grammi o litri</strong>.
                                Ti basta cliccare <strong>&quot;Bombola Finita → Attacca Nuova&quot;</strong> solo il giorno in cui una bombola in cantina finisce e ne apri una piena dalla scorta:
                                il software ti avvisa prima di restare senza piene e calcola da solo consumo annuo, eventuali perdite sull&apos;impianto e costo medio a cotta.
                            </p>
                        </div>
                        {(techGasAnalytics.realCo2CostPerBrew || techGasAnalytics.realAzotoCostPerBrew) && (
                            <button
                                type="button"
                                onClick={handleSyncTechGasCoefficients}
                                className="px-4 py-2.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white font-bold text-xs whitespace-nowrap shrink-0"
                            >
                                Allinea Costo CO₂/Azoto nelle Cotte
                            </button>
                        )}
                    </div>

                    {/* 3 Schede Bombole: CO2, Azoto, Argon */}
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                        {techGasConfig.map(item => {
                            const totalOwned = item.pieneScorta + item.inUsoImpianto + item.vuoteDaRendere;
                            const isLowStock = totalOwned > 0 && item.attivo && item.pieneScorta <= item.sogliaAllarmePiene;
                            const isEditing = editingCylinderCode === item.codice && cylinderDraft;
                            const swapsYear = techGasAnalytics.swapsByGas[item.codice] || 0;

                            return (
                                <div
                                    key={item.codice}
                                    className={`bg-brew-dark p-5 rounded-xl border flex flex-col justify-between gap-4 ${
                                        isLowStock ? 'border-red-500' : 'border-slate-700'
                                    }`}
                                >
                                    <div className="space-y-3">
                                        <div className="flex items-start justify-between gap-2 border-b border-slate-800 pb-3">
                                            <div>
                                                <h3 className="text-lg font-extrabold text-white">{item.nome}</h3>
                                                <p className="text-xs text-slate-400">
                                                    Formato bombola: <strong className="font-mono text-slate-200">{item.formatoCapacita} {item.unitaCapacita}</strong>
                                                    {' · '}Ricarica: <strong className="font-mono text-emerald-300">€ {item.costoMedioRicarica.toFixed(2)}</strong>
                                                </p>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    if (isEditing) {
                                                        setEditingCylinderCode(null);
                                                        setCylinderDraft(null);
                                                    } else {
                                                        setEditingCylinderCode(item.codice);
                                                        setCylinderDraft({ ...item });
                                                    }
                                                }}
                                                className="px-2.5 py-1 rounded bg-brew-dark-secondary border border-slate-600 hover:bg-slate-700 text-xs font-bold text-slate-200 whitespace-nowrap"
                                            >
                                                {isEditing ? 'Chiudi' : 'Imposta Scorta'}
                                            </button>
                                        </div>

                                        {isEditing && cylinderDraft ? (
                                            <div className="bg-brew-dark-secondary p-3.5 rounded-lg border border-brew-accent/60 space-y-3 text-xs">
                                                <div className="font-bold text-brew-accent">Allinea situazione fisica attuale in cantina:</div>
                                                <div className="grid grid-cols-3 gap-2">
                                                    <div>
                                                        <label className="block text-slate-300 mb-1">Piene Scorta</label>
                                                        <input
                                                            type="number"
                                                            min="0"
                                                            value={cylinderDraft.pieneScorta}
                                                            onChange={e => setCylinderDraft({ ...cylinderDraft, pieneScorta: Math.max(0, Math.round(parseNumberSafe(e.target.value))) })}
                                                            className="w-full bg-brew-dark border border-slate-600 rounded p-1.5 text-white font-mono tabular-nums"
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className="block text-slate-300 mb-1">In Uso Ora</label>
                                                        <input
                                                            type="number"
                                                            min="0"
                                                            value={cylinderDraft.inUsoImpianto}
                                                            onChange={e => setCylinderDraft({ ...cylinderDraft, inUsoImpianto: Math.max(0, Math.round(parseNumberSafe(e.target.value))) })}
                                                            className="w-full bg-brew-dark border border-slate-600 rounded p-1.5 text-white font-mono tabular-nums"
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className="block text-slate-300 mb-1">Vuote Reso</label>
                                                        <input
                                                            type="number"
                                                            min="0"
                                                            value={cylinderDraft.vuoteDaRendere}
                                                            onChange={e => setCylinderDraft({ ...cylinderDraft, vuoteDaRendere: Math.max(0, Math.round(parseNumberSafe(e.target.value))) })}
                                                            className="w-full bg-brew-dark border border-slate-600 rounded p-1.5 text-white font-mono tabular-nums"
                                                        />
                                                    </div>
                                                </div>
                                                <div className="grid grid-cols-3 gap-2">
                                                    <div>
                                                        <label className="block text-slate-300 mb-1">Taglia ({cylinderDraft.unitaCapacita})</label>
                                                        <input
                                                            type="number"
                                                            min="1"
                                                            value={cylinderDraft.formatoCapacita}
                                                            onChange={e => setCylinderDraft({ ...cylinderDraft, formatoCapacita: Math.max(1, parseNumberSafe(e.target.value)) })}
                                                            className="w-full bg-brew-dark border border-slate-600 rounded p-1.5 text-white font-mono tabular-nums"
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className="block text-slate-300 mb-1">Allarme &le;</label>
                                                        <input
                                                            type="number"
                                                            min="0"
                                                            value={cylinderDraft.sogliaAllarmePiene}
                                                            onChange={e => setCylinderDraft({ ...cylinderDraft, sogliaAllarmePiene: Math.max(0, Math.round(parseNumberSafe(e.target.value))) })}
                                                            className="w-full bg-brew-dark border border-slate-600 rounded p-1.5 text-white font-mono tabular-nums"
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className="block text-slate-300 mb-1">Costo Ric. €</label>
                                                        <input
                                                            type="number"
                                                            step="0.5"
                                                            min="0"
                                                            value={cylinderDraft.costoMedioRicarica}
                                                            onChange={e => setCylinderDraft({ ...cylinderDraft, costoMedioRicarica: Math.max(0, parseNumberSafe(e.target.value)) })}
                                                            className="w-full bg-brew-dark border border-slate-600 rounded p-1.5 text-white font-mono tabular-nums"
                                                        />
                                                    </div>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={handleSaveCylinderDraft}
                                                    className="w-full py-2 rounded bg-brew-accent text-brew-dark font-extrabold flex items-center justify-center gap-1.5"
                                                >
                                                    <CheckIcon className="w-4 h-4" />
                                                    Salva Situazione Bombole
                                                </button>
                                            </div>
                                        ) : (
                                            <div className="grid grid-cols-3 gap-2.5 font-mono tabular-nums text-center">
                                                <div className={`p-3 rounded-lg border ${
                                                    isLowStock
                                                        ? 'bg-red-950/60 border-red-500'
                                                        : 'bg-brew-dark-secondary border-slate-700'
                                                }`}>
                                                    <div className="text-[11px] font-sans font-semibold text-emerald-300">Piene Scorta</div>
                                                    <div className="text-2xl font-black text-white mt-0.5">{item.pieneScorta}</div>
                                                    <div className="text-[10px] font-sans text-slate-400">pronte</div>
                                                </div>
                                                <div className="p-3 rounded-lg bg-brew-dark-secondary border border-slate-700">
                                                    <div className="text-[11px] font-sans font-semibold text-cyan-300">In Uso Ora</div>
                                                    <div className="text-2xl font-black text-cyan-300 mt-0.5">{item.inUsoImpianto}</div>
                                                    <div className="text-[10px] font-sans text-slate-400">allacciate</div>
                                                </div>
                                                <div className="p-3 rounded-lg bg-brew-dark-secondary border border-slate-700">
                                                    <div className="text-[11px] font-sans font-semibold text-amber-300">Vuote</div>
                                                    <div className="text-2xl font-black text-amber-200 mt-0.5">{item.vuoteDaRendere}</div>
                                                    <div className="text-[10px] font-sans text-slate-400">da rendere</div>
                                                </div>
                                            </div>
                                        )}

                                        {isLowStock && (
                                            <div className="text-xs font-semibold text-red-300 bg-red-950/50 border border-red-500/60 rounded-lg px-3 py-2">
                                                Scorta minima raggiunta ({item.pieneScorta} piene rimaste su soglia {item.sogliaAllarmePiene}) — prenota consegna Vuoto per Pieno!
                                            </div>
                                        )}
                                    </div>

                                    <div className="space-y-2 pt-2 border-t border-slate-800">
                                        <button
                                            type="button"
                                            onClick={() => handleSwapEmptyCylinder(item)}
                                            className="w-full py-2.5 px-3 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-extrabold text-xs flex items-center justify-center gap-2 transition-colors"
                                        >
                                            <ArrowPathIcon className="w-4 h-4" />
                                            <span>Bombola Finita → Attacca Nuova</span>
                                        </button>
                                        <div className="flex justify-between text-xs text-slate-400">
                                            <span>Bombole finite nel {selectedYear}:</span>
                                            <strong className="font-mono tabular-nums text-white">
                                                {swapsYear} ({swapsYear * item.formatoCapacita} {item.unitaCapacita})
                                            </strong>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {/* Diagnostica Impianto Cantina + Modulo Consegna Fornitore Vuoto per Pieno */}
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                        {/* Diagnostica Automatica Consumo Specifico e Rilevamento Perdite */}
                        <div className="lg:col-span-5 bg-brew-dark p-5 rounded-xl border border-slate-700 space-y-4">
                            <div>
                                <h3 className="text-lg font-bold text-white">Indice Efficienza &amp; Rilevamento Perdite Cantina</h3>
                                <p className="text-xs text-slate-400">
                                    Calcolato in automatico rapportando le bombole sostituite nell&apos;anno ai {Math.round(techGasAnalytics.totalPackagedLiters).toLocaleString('it-IT')} L di birra confezionata
                                </p>
                            </div>

                            <div className="grid grid-cols-2 gap-3 font-mono tabular-nums">
                                <div className="bg-brew-dark-secondary p-3.5 rounded-lg border border-slate-700">
                                    <div className="text-xs font-sans text-slate-400">Consumo Specifico CO₂</div>
                                    <div className="text-xl font-black text-cyan-300 mt-1">
                                        {techGasAnalytics.co2GramsPerLiterPackaged !== null
                                            ? `${techGasAnalytics.co2GramsPerLiterPackaged.toFixed(1)} g/L`
                                            : 'N/D'}
                                    </div>
                                    <div className="text-[11px] font-sans text-slate-400 mt-0.5">
                                        {techGasAnalytics.co2GramsPerLiterPackaged === null
                                            ? 'Attivo al 1° cambio bombola'
                                            : techGasAnalytics.co2GramsPerLiterPackaged > 28
                                                ? 'Elevato (>28 g/L): controlla raccordi/perdite!'
                                                : 'Regolare (range tipico 12–25 g/L)'}
                                    </div>
                                </div>

                                <div className="bg-brew-dark-secondary p-3.5 rounded-lg border border-slate-700">
                                    <div className="text-xs font-sans text-slate-400">Costo Medio CO₂ / Cotta</div>
                                    <div className="text-xl font-black text-emerald-400 mt-1">
                                        {techGasAnalytics.realCo2CostPerBrew !== null
                                            ? `€ ${techGasAnalytics.realCo2CostPerBrew.toFixed(2)}`
                                            : `€ ${(costCoefficients?.costo_co2 || 0).toFixed(2)}`}
                                    </div>
                                    <div className="text-[11px] font-sans text-slate-400 mt-0.5">
                                        Spesa ricariche {selectedYear}: € {techGasAnalytics.totalSpendYear.toFixed(2)}
                                    </div>
                                </div>
                            </div>

                            <div className="p-3.5 rounded-lg bg-brew-dark-secondary border border-slate-700 text-xs text-slate-300 space-y-1.5">
                                <div className="font-bold text-white">Come funziona senza contalitri?</div>
                                <p>
                                    Ogni volta che cambi una bombola da 30 kg di CO₂ e hai confezionato ad esempio 1.800 L di birra, il birrificio ha impiegato circa <strong>16,6 g/L</strong> tra carbonazione, saturazione fusti e contropressione. Se questo indice sale improvvisamente oltre 28–30 g/L, significa quasi certamente che c&apos;è una micro-perdita su un riduttore o collettore!
                                </p>
                            </div>
                        </div>

                        {/* Form Consegna Fornitore Vuoto per Pieno */}
                        <div className="lg:col-span-7 bg-brew-dark p-5 rounded-xl border border-slate-700">
                            <h3 className="text-lg font-bold text-white mb-1">
                                Registra Consegna Fornitore (&quot;Vuoto per Pieno&quot;)
                            </h3>
                            <p className="text-xs text-slate-400 mb-4">
                                Compila quando il corriere dei gas tecnici ritira le bombole vuote e scarica quelle piene
                            </p>

                            <form onSubmit={handleRegisterCylinderDelivery} className="space-y-3 text-sm">
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                    <div>
                                        <label className="block text-xs font-bold text-slate-300 mb-1">Data Consegna</label>
                                        <input
                                            type="text"
                                            value={delivDate}
                                            onChange={e => setDelivDate(e.target.value)}
                                            className="w-full bg-brew-dark-secondary border border-slate-600 rounded-lg p-2 text-white font-mono tabular-nums"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-slate-300 mb-1">Tipologia Bombola</label>
                                        <select
                                            value={delivGasCode}
                                            onChange={e => setDelivGasCode(e.target.value as TechGasCode)}
                                            className="w-full bg-brew-dark-secondary border border-slate-600 rounded-lg p-2 text-white font-semibold"
                                        >
                                            <option value="CO2">CO₂ Alimentare</option>
                                            <option value="AZOTO">Azoto N₂ / Carboazoto</option>
                                            <option value="ARGON">Argon Puro Ar</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-slate-300 mb-1">Fornitore</label>
                                        <input
                                            type="text"
                                            placeholder="es. Linde / Air Liquide / Sapio..."
                                            value={delivSupplier}
                                            onChange={e => setDelivSupplier(e.target.value)}
                                            className="w-full bg-brew-dark-secondary border border-slate-600 rounded-lg p-2 text-white"
                                        />
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                                    <div>
                                        <label className="block text-xs font-bold text-emerald-300 mb-1">Piene Consegnate (+)</label>
                                        <input
                                            type="number"
                                            min="0"
                                            required
                                            placeholder="es. 4"
                                            value={delivFullQty}
                                            onChange={e => {
                                                setDelivFullQty(e.target.value);
                                                if (!delivEmptyReturned) setDelivEmptyReturned(e.target.value);
                                            }}
                                            className="w-full bg-slate-900 border border-emerald-500/70 rounded-lg p-2 text-emerald-200 font-mono tabular-nums font-bold"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-amber-300 mb-1">Vuote Ritirate (-)</label>
                                        <input
                                            type="number"
                                            min="0"
                                            placeholder="es. 4"
                                            value={delivEmptyReturned}
                                            onChange={e => setDelivEmptyReturned(e.target.value)}
                                            className="w-full bg-brew-dark-secondary border border-slate-600 rounded-lg p-2 text-white font-mono tabular-nums"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-slate-300 mb-1">Costo Totale (€)</label>
                                        <input
                                            type="number"
                                            step="0.01"
                                            min="0"
                                            placeholder="es. 152.00"
                                            value={delivTotalCost}
                                            onChange={e => setDelivTotalCost(e.target.value)}
                                            className="w-full bg-brew-dark-secondary border border-slate-600 rounded-lg p-2 text-white font-mono tabular-nums"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-slate-300 mb-1">Rif. DDT / Fattura</label>
                                        <input
                                            type="text"
                                            placeholder="es. DDT-904"
                                            value={delivDocRef}
                                            onChange={e => setDelivDocRef(e.target.value)}
                                            className="w-full bg-brew-dark-secondary border border-slate-600 rounded-lg p-2 text-white font-mono"
                                        />
                                    </div>
                                </div>

                                <div className="flex flex-col sm:flex-row gap-3 items-end">
                                    <div className="flex-1 w-full">
                                        <label className="block text-xs font-bold text-slate-300 mb-1">Note / Lotto Alimentare E290-E941</label>
                                        <input
                                            type="text"
                                            placeholder="es. Lotto gas alimentare per tracciabilità HACCP"
                                            value={delivNote}
                                            onChange={e => setDelivNote(e.target.value)}
                                            className="w-full bg-brew-dark-secondary border border-slate-600 rounded-lg p-2 text-white"
                                        />
                                    </div>
                                    <button
                                        type="submit"
                                        className="px-5 py-2.5 rounded-lg bg-brew-green hover:opacity-90 text-white font-bold text-sm whitespace-nowrap"
                                    >
                                        Salva Consegna Bombole
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>

                    {/* Storico Movimenti Bombole */}
                    <div className="bg-brew-dark p-5 rounded-xl border border-slate-700 space-y-3">
                        <h3 className="text-base font-bold text-white">
                            Storico Cambi Bombola &amp; Consegne Fornitore ({techGasLogs.length})
                        </h3>
                        {techGasLogs.length === 0 ? (
                            <p className="text-sm text-slate-400 py-4 text-center">
                                Nessun movimento bombole registrato nell&apos;anno {selectedYear}.
                            </p>
                        ) : (
                            <div className="overflow-x-auto max-h-72 overflow-y-auto">
                                <table className="w-full text-sm text-left font-mono tabular-nums">
                                    <thead className="text-xs font-sans uppercase text-slate-400 border-b border-slate-700">
                                        <tr>
                                            <th className="py-2 pr-3">Data</th>
                                            <th className="py-2 px-2">Gas</th>
                                            <th className="py-2 px-2">Operazione</th>
                                            <th className="py-2 px-2 text-right">Q.tà</th>
                                            <th className="py-2 px-2 text-right">Costo</th>
                                            <th className="py-2 px-3">Dettagli / Lotto</th>
                                            <th className="py-2 pl-2 text-right">Azioni</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-800">
                                        {techGasLogs.map(log => (
                                            <tr key={log.id} className="hover:bg-brew-dark-secondary/50">
                                                <td className="py-2 pr-3 text-slate-200">{log.data}</td>
                                                <td className="py-2 px-2 font-bold text-cyan-300">{log.codice}</td>
                                                <td className="py-2 px-2 font-sans text-xs font-semibold text-white">
                                                    {log.tipo === 'CAMBIO_BOMBOLA'
                                                        ? 'Cambio Bombola Finita'
                                                        : log.tipo === 'CONSEGNA_FORNITORE'
                                                            ? `Consegna Fornitore (${log.fornitore || ''})`
                                                            : 'Allineamento Scorta'}
                                                </td>
                                                <td className="py-2 px-2 text-right text-white">{log.quantita} pz</td>
                                                <td className="py-2 px-2 text-right text-emerald-400">
                                                    {log.costoTotale ? `€ ${log.costoTotale.toFixed(2)}` : '-'}
                                                </td>
                                                <td className="py-2 px-3 font-sans text-xs text-slate-400">
                                                    {log.numeroBolla && log.numeroBolla !== '-' ? `Rif. ${log.numeroBolla} · ` : ''}
                                                    {log.note || '-'}
                                                </td>
                                                <td className="py-2 pl-2 text-right">
                                                    <button
                                                        type="button"
                                                        onClick={() => handleDeleteTechGasLog(log)}
                                                        className="p-1 text-slate-400 hover:text-red-400"
                                                        title="Rimuovi riga"
                                                    >
                                                        <TrashIcon className="w-4 h-4" />
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};
