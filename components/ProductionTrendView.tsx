import React, { useState, useEffect, useMemo } from 'react';
import { getBreweryData, getAllBreweryData, isInternalOwner } from '../services/dataService';
import { addPlannedBrew } from '../services/calendarService';
import { useToast } from '../hooks/useToast';
import { CONFIG_PACKAGING } from '../constants';
import type { Cliente, Birra, BrewHeader, PackagingData, BeerMovement, BreweryData } from '../types';
import { useTranslation } from '../i18n';
import { 
    LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, 
    ResponsiveContainer, BarChart, Bar, Cell, LabelList 
} from 'recharts';

interface ProductionTrendViewProps {
    selectedYear: string;
    onExit: () => void;
    onNavigateToCalendar?: () => void;
}

const MONTH_NAMES = [
    'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
    'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'
];

const MONTH_SHORT = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];

const BEER_COLORS = [
    '#f59e0b', '#3b82f6', '#10b981', '#ef4444', '#8b5cf6', 
    '#ec4899', '#06b6d4', '#f97316', '#84cc16', '#6366f1'
];

const parseDate = (dateStr: string): Date => {
    if (!dateStr) return new Date();
    const parts = dateStr.split('/');
    if (parts.length === 3) {
        const [day, month, year] = parts.map(Number);
        if (!isNaN(day) && !isNaN(month) && !isNaN(year)) {
            return new Date(year, month - 1, day);
        }
    }
    return new Date();
};

const getLitersPerUnit = (format: string): number => {
    const config = CONFIG_PACKAGING[format];
    if (config) return config.litriUnit;
    const lower = (format || '').toLowerCase();
    if (lower.includes('20l') || lower.includes('20 lt') || lower.includes('20 l')) return 20;
    if (lower.includes('30l') || lower.includes('30 lt') || lower.includes('30 l')) return 30;
    if (lower.includes('24l') || lower.includes('24 lt') || lower.includes('24 l')) return 24;
    if (lower.includes('33cl') || lower.includes('33 cl')) return 0.33;
    if (lower.includes('50cl') || lower.includes('50 cl')) return 0.50;
    if (lower.includes('75cl') || lower.includes('75 cl')) return 0.75;
    return 1;
};

export const ProductionTrendView: React.FC<ProductionTrendViewProps> = ({ 
    selectedYear, 
    onExit,
    onNavigateToCalendar 
}) => {
    const { t } = useTranslation();
    const { showToast } = useToast();

    // Dati anno corrente e archivio pluriennale completo
    const [currentBreweryData, setCurrentBreweryData] = useState<BreweryData | null>(null);
    const [allYearsData, setAllYearsData] = useState<Record<string, BreweryData>>({});
    const [clienti, setClienti] = useState<Cliente[]>([]);
    const [birre, setBirre] = useState<Birra[]>([]);
    const [cotte, setCotte] = useState<BrewHeader[]>([]);
    const [packaging, setPackaging] = useState<PackagingData[]>([]);
    const [movements, setMovements] = useState<BeerMovement[]>([]);

    // Dati anno precedente
    const prevYear = useMemo(() => (parseInt(selectedYear, 10) - 1).toString(), [selectedYear]);
    const [prevYearData, setPrevYearData] = useState<BreweryData | null>(null);

    // Controlli vista
    const [selectedClientId, setSelectedClientId] = useState<string>('');
    const [ownershipFilter, setOwnershipFilter] = useState<'ALL' | 'INTERNAL' | 'BEERFIRM'>('ALL');
    const [generalActiveTab, setGeneralActiveTab] = useState<'OVERVIEW' | 'FORECAST'>('OVERVIEW');
    const [selectedMonthFilter, setSelectedMonthFilter] = useState<number | 'ALL'>('ALL');
    const [generalMetricView, setGeneralMetricView] = useState<'liters' | 'batches' | 'both'>('both');
    const [prodCompTab, setProdCompTab] = useState<'months' | 'beers' | 'formats' | 'clients'>('months');

    // Controlli modulo previsione
    const [forecastMonthIdx, setForecastMonthIdx] = useState<number>(new Date().getMonth());
    const [useSimulationMode, setUseSimulationMode] = useState<boolean>(false);
    const [planningModalItem, setPlanningModalItem] = useState<{
        clienteNome: string;
        birraNome: string;
        litri: number;
        suggestedDate: string;
    } | null>(null);

    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const loadAllData = async () => {
            setIsLoading(true);
            const [currentData, pData, allYears] = await Promise.all([
                getBreweryData(selectedYear),
                getBreweryData(prevYear),
                getAllBreweryData(),
            ]);
            if (currentData) {
                setCurrentBreweryData(currentData);
                setClienti(currentData.CLIENTI || []);
                setBirre(currentData.BIRRE || []);
                setCotte(currentData.COTTE_HEAD || []);
                setPackaging(currentData.CONFEZIONAMENTO || []);
                setMovements(currentData.BEER_MOVEMENTS || []);
            } else {
                setCurrentBreweryData(null);
            }

            setPrevYearData(pData || null);
            setAllYearsData(allYears || {});
            setIsLoading(false);
        };
        loadAllData();
    }, [selectedYear, prevYear]);

    const hasPrevYearData = useMemo(() => {
        return !!(
            prevYearData && (
                (prevYearData.COTTE_HEAD && prevYearData.COTTE_HEAD.length > 0) ||
                (prevYearData.BEER_MOVEMENTS && prevYearData.BEER_MOVEMENTS.length > 0) ||
                (prevYearData.CONFEZIONAMENTO && prevYearData.CONFEZIONAMENTO.length > 0)
            )
        );
    }, [prevYearData]);

    // Split Produzione Interna vs BeerFirm + Archivio Pluriennale
    const ownershipAndMultiYear = useMemo(() => {
        const parseNum = (v: string | number | undefined) => {
            if (typeof v === 'number') return isFinite(v) ? v : 0;
            if (!v) return 0;
            const n = parseFloat(String(v).replace(',', '.'));
            return isFinite(n) ? n : 0;
        };

        const computeYearBuckets = (yData: BreweryData | null | undefined) => {
            const yCotte = yData?.COTTE_HEAD || [];
            const yPkg = yData?.CONFEZIONAMENTO || [];
            let internalLiters = 0;
            let beerfirmLiters = 0;
            let internalBatches = 0;
            let beerfirmBatches = 0;

            yCotte.forEach(c => {
                const relPkg = yPkg.filter(p => p.LOTTO_PROD === c.LOTTO);
                const pkgL = relPkg.reduce((s, p) => s + (p.LITRI_TOT || 0), 0);
                const effL = pkgL > 0 ? pkgL : parseNum(c.LITRI_FINALI);
                if (isInternalOwner(yData || currentBreweryData, c.CLIENTE)) {
                    internalLiters += effL;
                    internalBatches += 1;
                } else {
                    beerfirmLiters += effL;
                    beerfirmBatches += 1;
                }
            });

            return {
                internalLiters: Math.round(internalLiters),
                beerfirmLiters: Math.round(beerfirmLiters),
                totalLiters: Math.round(internalLiters + beerfirmLiters),
                internalBatches,
                beerfirmBatches,
                totalBatches: internalBatches + beerfirmBatches,
            };
        };

        const currentSplit = computeYearBuckets(currentBreweryData);
        const internalSharePct = currentSplit.totalLiters > 0
            ? Math.round((currentSplit.internalLiters / currentSplit.totalLiters) * 1000) / 10
            : 0;
        const beerfirmSharePct = currentSplit.totalLiters > 0
            ? Math.round((100 - internalSharePct) * 10) / 10
            : 0;

        const sortedYears = Object.keys(allYearsData).sort();
        const yearlyRows = sortedYears.map((yr, idx) => {
            const buckets = computeYearBuckets(allYearsData[yr]);
            const prevBuckets = idx > 0 ? computeYearBuckets(allYearsData[sortedYears[idx - 1]]) : null;
            const yoyPct = prevBuckets && prevBuckets.totalLiters > 0
                ? Math.round(((buckets.totalLiters - prevBuckets.totalLiters) / prevBuckets.totalLiters) * 1000) / 10
                : null;
            return {
                year: yr,
                ...buckets,
                yoyPct,
                isCurrent: yr === selectedYear,
            };
        });

        return {
            currentSplit,
            internalSharePct,
            beerfirmSharePct,
            yearlyRows,
        };
    }, [allYearsData, currentBreweryData, selectedYear]);

    // =========================================================================
    // 1. ANALISI GENERALE DELL'ANNO CORRENTE (SCHERMATA INIZIALE)
    // =========================================================================
    const generalAnalysis = useMemo(() => {
        const matchesOwnership = (owner: string | undefined, refData: BreweryData | null | undefined) => {
            if (ownershipFilter === 'ALL') return true;
            const isInt = isInternalOwner(refData || currentBreweryData, owner);
            return ownershipFilter === 'INTERNAL' ? isInt : !isInt;
        };

        const filteredCotte = cotte.filter(c => matchesOwnership(c.CLIENTE, currentBreweryData));
        if (filteredCotte.length === 0) return null;

        const filteredLottoSet = new Set(filteredCotte.map(c => c.LOTTO));
        const filteredPackaging = packaging.filter(p => filteredLottoSet.has(p.LOTTO_PROD));

        const enrichedCotte = filteredCotte.map(c => {
            const relatedPackaging = filteredPackaging.filter(p => p.LOTTO_PROD === c.LOTTO);
            const packagedLiters = relatedPackaging.reduce((sum, p) => sum + (p.LITRI_TOT || 0), 0);
            const rawFinalLiters = parseFloat(c.LITRI_FINALI?.replace(',', '.') || '0') || 0;
            const effectiveLiters = packagedLiters > 0 ? packagedLiters : rawFinalLiters;
            const dateObj = parseDate(c.DATA_PROD);
            const monthIdx = dateObj.getMonth();

            return {
                ...c,
                dateObj,
                monthIdx,
                packagedLiters,
                effectiveLiters: Math.round(effectiveLiters * 10) / 10
            };
        });

        const totalYearBatches = enrichedCotte.length;
        const totalYearLiters = Math.round(enrichedCotte.reduce((sum, c) => sum + c.effectiveLiters, 0));
        const avgLitersPerBatch = totalYearBatches > 0 ? Math.round(totalYearLiters / totalYearBatches) : 0;
        const distinctClients = Array.from(new Set(enrichedCotte.map(c => c.CLIENTE).filter(Boolean)));
        const distinctBeers = Array.from(new Set(enrichedCotte.map(c => c.NOME_BIRRA).filter(Boolean)));

        const monthlyStats = MONTH_SHORT.map((shortName, monthIdx) => {
            const monthCotte = enrichedCotte.filter(c => c.monthIdx === monthIdx);
            const totalBatches = monthCotte.length;
            const totalLiters = Math.round(monthCotte.reduce((sum, c) => sum + c.effectiveLiters, 0));

            const producerBeerMap: Record<string, {
                cliente: string;
                birra: string;
                batches: number;
                liters: number;
                lotti: string[];
            }> = {};

            monthCotte.forEach(c => {
                const key = `${c.CLIENTE}|${c.NOME_BIRRA}`;
                if (!producerBeerMap[key]) {
                    producerBeerMap[key] = {
                        cliente: c.CLIENTE,
                        birra: c.NOME_BIRRA,
                        batches: 0,
                        liters: 0,
                        lotti: []
                    };
                }
                producerBeerMap[key].batches += 1;
                producerBeerMap[key].liters = Math.round((producerBeerMap[key].liters + c.effectiveLiters) * 10) / 10;
                producerBeerMap[key].lotti.push(c.LOTTO);
            });

            const details = Object.values(producerBeerMap)
                .map(d => ({
                    ...d,
                    percentOnMonth: totalLiters > 0 ? Math.round((d.liters / totalLiters) * 100) : 0
                }))
                .sort((a, b) => b.liters - a.liters);

            return {
                monthIdx,
                shortName,
                monthFullName: MONTH_NAMES[monthIdx],
                totalBatches,
                totalLiters,
                details
            };
        });

        const parseNum = (v: string | number | undefined) => {
            if (typeof v === 'number') return isFinite(v) ? v : 0;
            if (!v) return 0;
            const n = parseFloat(String(v).replace(',', '.'));
            return isFinite(n) ? n : 0;
        };

        // Calcolo Resa Media Cantina->Confezionamento, Perdita Cantina >14% e Consumo Gas Totale (m³ e m³/hL)
        let sumFermLiters = 0;
        let sumPkgLiters = 0;
        let totalGasMc = 0;
        const highLossBatches: {
            lotto: string;
            birra: string;
            cliente: string;
            dataProd: string;
            fermLiters: number;
            pkgLiters: number;
            lostLiters: number;
            lossPct: number;
            isClosed: boolean;
        }[] = [];

        enrichedCotte.forEach(c => {
            const rawFerm = parseNum(c.LITRI_FINALI);
            if (c.packagedLiters > 0 && rawFerm > 0) {
                sumFermLiters += rawFerm;
                sumPkgLiters += c.packagedLiters;
                const lostLiters = Math.max(0, rawFerm - c.packagedLiters);
                const lossPct = Math.round(((rawFerm - c.packagedLiters) / rawFerm) * 1000) / 10;
                if (lossPct > 14 && (c.isCellarClosed || c.packagedLiters > 0)) {
                    highLossBatches.push({
                        lotto: c.LOTTO,
                        birra: c.NOME_BIRRA,
                        cliente: c.CLIENTE,
                        dataProd: c.DATA_PROD,
                        fermLiters: rawFerm,
                        pkgLiters: Math.round(c.packagedLiters * 10) / 10,
                        lostLiters: Math.round(lostLiters * 10) / 10,
                        lossPct,
                        isClosed: Boolean(c.isCellarClosed),
                    });
                }
            }
            const directBrew = parseNum(c.GAS_COTTA);
            const cntBrew = Math.max(0, parseNum(c.gasBrewCounterCurrent) - parseNum(c.gasBrewCounterPrevious));
            const directPkg = parseNum(c.GAS_CONFEZIONAMENTO);
            const cntPkg = Math.max(0, parseNum(c.gasPackagingCounterCurrent) - parseNum(c.gasPackagingCounterPrevious));
            totalGasMc += (directBrew > 0 ? directBrew : cntBrew) + (directPkg > 0 ? directPkg : cntPkg);
        });

        highLossBatches.sort((a, b) => b.lossPct - a.lossPct);
        const avgPackagingYieldPct = sumFermLiters > 0 ? Math.min(100, Math.round((sumPkgLiters / sumFermLiters) * 1000) / 10) : null;
        const avgCellarLossPct = avgPackagingYieldPct !== null ? Math.max(0, Math.round((100 - avgPackagingYieldPct) * 10) / 10) : null;
        const gasMcPerHl = totalYearLiters > 0 ? Math.round((totalGasMc / (totalYearLiters / 100)) * 100) / 100 : 0;

        // Serie storica Anno Precedente (YoY) per Mesi, Birre, Formati e Clienti
        const prevCotte = (prevYearData?.COTTE_HEAD || []).filter(c => matchesOwnership(c.CLIENTE, prevYearData));
        const prevLottoSet = new Set(prevCotte.map(c => c.LOTTO));
        const prevPkg = (prevYearData?.CONFEZIONAMENTO || []).filter(p => prevLottoSet.has(p.LOTTO_PROD));
        const prevMonthlyLiters = Array(12).fill(0);
        const prevBeerMap: Record<string, number> = {};
        const prevClientMap: Record<string, number> = {};
        const prevFormatMap: Record<string, number> = {};

        prevCotte.forEach(pc => {
            const relP = prevPkg.filter(p => p.LOTTO_PROD === pc.LOTTO);
            const pkgL = relP.reduce((s, p) => s + (p.LITRI_TOT || 0), 0);
            const rawL = parseNum(pc.LITRI_FINALI);
            const effL = pkgL > 0 ? pkgL : rawL;
            const m = parseDate(pc.DATA_PROD).getMonth();
            if (m >= 0 && m < 12) prevMonthlyLiters[m] += effL;
            if (pc.NOME_BIRRA) prevBeerMap[pc.NOME_BIRRA] = (prevBeerMap[pc.NOME_BIRRA] || 0) + effL;
            if (pc.CLIENTE) prevClientMap[pc.CLIENTE] = (prevClientMap[pc.CLIENTE] || 0) + effL;
        });
        prevPkg.forEach(pp => {
            if (pp.FORMATO) prevFormatMap[pp.FORMATO] = (prevFormatMap[pp.FORMATO] || 0) + (pp.LITRI_TOT || 0);
        });

        const currBeerMap: Record<string, number> = {};
        const currClientMap: Record<string, number> = {};
        const currFormatMap: Record<string, number> = {};
        enrichedCotte.forEach(c => {
            if (c.NOME_BIRRA) currBeerMap[c.NOME_BIRRA] = (currBeerMap[c.NOME_BIRRA] || 0) + c.effectiveLiters;
            if (c.CLIENTE) currClientMap[c.CLIENTE] = (currClientMap[c.CLIENTE] || 0) + c.effectiveLiters;
        });
        filteredPackaging.forEach(p => {
            if (p.FORMATO) currFormatMap[p.FORMATO] = (currFormatMap[p.FORMATO] || 0) + (p.LITRI_TOT || 0);
        });

        const prevTotalYearLiters = Math.round(prevMonthlyLiters.reduce((s, v) => s + v, 0));
        const totalYoYDeltaPct = prevTotalYearLiters > 0
            ? Math.round(((totalYearLiters - prevTotalYearLiters) / prevTotalYearLiters) * 1000) / 10
            : null;

        const monthlyComparison = monthlyStats.map((m, idx) => {
            const prevL = Math.round(prevMonthlyLiters[idx]);
            const prevMonthL = idx > 0 ? monthlyStats[idx - 1].totalLiters : 0;
            const momPct = idx > 0 && prevMonthL > 0 ? Math.round(((m.totalLiters - prevMonthL) / prevMonthL) * 1000) / 10 : null;
            const yoyPct = prevL > 0 ? Math.round(((m.totalLiters - prevL) / prevL) * 1000) / 10 : null;
            return {
                ...m,
                prevYearLiters: prevL,
                momPct,
                yoyPct
            };
        });

        const buildCompRows = (curr: Record<string, number>, prev: Record<string, number>) => {
            const keys = Array.from(new Set([...Object.keys(curr), ...Object.keys(prev)])).filter(Boolean);
            return keys.map(name => {
                const currL = Math.round((curr[name] || 0) * 10) / 10;
                const prevL = Math.round((prev[name] || 0) * 10) / 10;
                const deltaL = Math.round((currL - prevL) * 10) / 10;
                const deltaPct = prevL > 0 ? Math.round(((currL - prevL) / prevL) * 1000) / 10 : (currL > 0 ? 100 : 0);
                return { name, currL, prevL, deltaL, deltaPct, isNew: prevL === 0 && currL > 0 };
            }).sort((a, b) => b.currL - a.currL || b.prevL - a.prevL);
        };

        const beerYoYRows = buildCompRows(currBeerMap, prevBeerMap);
        const formatYoYRows = buildCompRows(currFormatMap, prevFormatMap);
        const clientYoYRows = buildCompRows(currClientMap, prevClientMap);

        let peakMonth = monthlyStats[0];
        monthlyStats.forEach(m => {
            if (m.totalLiters > peakMonth.totalLiters) {
                peakMonth = m;
            }
        });

        const filteredMonthDetails = selectedMonthFilter === 'ALL'
            ? monthlyStats.flatMap(m => m.details.map(d => ({ ...d, monthName: m.shortName })))
            : (monthlyStats[selectedMonthFilter]?.details || []);

        return {
            totalYearBatches,
            totalYearLiters,
            prevTotalYearLiters,
            totalYoYDeltaPct,
            avgLitersPerBatch,
            avgPackagingYieldPct,
            avgCellarLossPct,
            highLossBatches,
            totalGasMc: Math.round(totalGasMc * 10) / 10,
            gasMcPerHl,
            distinctClientsCount: distinctClients.length,
            distinctBeersCount: distinctBeers.length,
            monthlyStats,
            monthlyComparison,
            beerYoYRows,
            formatYoYRows,
            clientYoYRows,
            peakMonth,
            filteredMonthDetails
        };
    }, [cotte, packaging, selectedMonthFilter, prevYearData, ownershipFilter, currentBreweryData]);

    // =========================================================================
    // 2. MOTORE DI PREVISIONE DI PRODUZIONE (LEAD-TIME & STORICO ANNO SCORSO)
    // =========================================================================
    const forecastEngine = useMemo(() => {
        // Se l'anno precedente non esiste e non siamo in simulazione, segnala assenza dati
        const activeDataSource = (hasPrevYearData && !useSimulationMode) ? 'PREV_YEAR' : 'SIMULATION';
        const sourceCotte = activeDataSource === 'PREV_YEAR' ? (prevYearData?.COTTE_HEAD || []) : cotte;
        const sourcePackaging = activeDataSource === 'PREV_YEAR' ? (prevYearData?.CONFEZIONAMENTO || []) : packaging;
        const sourceMovements = activeDataSource === 'PREV_YEAR' ? (prevYearData?.BEER_MOVEMENTS || []) : movements;

        if (sourceCotte.length === 0) return null;

        // 1. Calcolo del Lead-Time / Lag di Cantina per ciascuna Birra
        // Tempo medio in giorni tra cotta (DATA_PROD) e primo confezionamento (DATA)
        const beerLagMap: Record<string, { days: number; lagMonths: number; sampleCount: number }> = {};
        
        sourceCotte.forEach(c => {
            const beerName = (c.NOME_BIRRA || '').trim();
            if (!beerName) return;

            const prodDate = parseDate(c.DATA_PROD);
            const relatedPkg = sourcePackaging.filter(p => p.LOTTO_PROD === c.LOTTO);
            
            let daysDiff = 0;
            if (relatedPkg.length > 0) {
                const dates = relatedPkg.map(p => parseDate(p.DATA).getTime()).filter(t => !isNaN(t));
                if (dates.length > 0) {
                    const firstPkgTime = Math.min(...dates);
                    daysDiff = Math.round((firstPkgTime - prodDate.getTime()) / (1000 * 60 * 60 * 24));
                }
            }

            // Fallback intelligente su tipo fermentazione se non ancora confezionata
            if (daysDiff <= 0 || daysDiff > 120) {
                const isBassa = c.TIPO_FERMENTAZIONE === 'BASSA' || beerName.toLowerCase().includes('pils') || beerName.toLowerCase().includes('lager');
                const giorniPrevisti = parseInt(c.GIORNI_FERMENTAZIONE_PREVISTI || '0', 10);
                daysDiff = giorniPrevisti > 0 ? giorniPrevisti : (isBassa ? 42 : 28);
            }

            if (!beerLagMap[beerName]) {
                beerLagMap[beerName] = { days: daysDiff, lagMonths: 1, sampleCount: 1 };
            } else {
                beerLagMap[beerName].days = Math.round((beerLagMap[beerName].days * beerLagMap[beerName].sampleCount + daysDiff) / (beerLagMap[beerName].sampleCount + 1));
                beerLagMap[beerName].sampleCount += 1;
            }
        });

        // Converti i giorni medi in mesi di anticipo (lagMonths)
        Object.keys(beerLagMap).forEach(bName => {
            const d = beerLagMap[bName].days;
            // < 35 gg -> 1 mese di anticipo; 35-65 gg -> 2 mesi; >65 gg -> 3 mesi
            const lagM = d <= 35 ? 1 : d <= 65 ? 2 : 3;
            beerLagMap[bName].lagMonths = lagM;
        });

        // 2. Mappatura Vendite Mensili per Birra e Formato
        // Per ogni mese di vendita (0..11), quanti litri e quali formati sono stati venduti
        interface MonthlyBeerSalesTarget {
            cliente: string;
            birra: string;
            totalLiters: number;
            formatsBreakdown: Record<string, { liters: number; units: number; pct: number }>;
        }

        const salesByTargetMonth: Record<number, Record<string, MonthlyBeerSalesTarget>> = {};
        for (let m = 0; m < 12; m++) salesByTargetMonth[m] = {};

        // Elabora movimenti di vendita reali (escludendo riallocazioni interne BeerFirm, trasferimenti celle, scarti e resi)
        const internalTransferDocIds = new Set<string>(
            sourceMovements.filter(m => m.type === 'PURCHASE' && m.relatedDocId).map(m => m.relatedDocId as string)
        );
        const salesMovements = sourceMovements.filter(
            m =>
                (m.type === 'SALE' || (m.type === 'ADJUSTMENT' && m.quantita < 0)) &&
                !(m.relatedDocId && internalTransferDocIds.has(m.relatedDocId))
        );
        
        if (salesMovements.length > 0) {
            salesMovements.forEach(sm => {
                const d = parseDate(sm.data);
                const month = d.getMonth();
                const beerName = (sm.nomeBirra || '').trim();
                const clientName = (sm.cliente || '').trim();
                if (!beerName) return;

                const key = `${clientName}|${beerName}`;
                const units = Math.abs(sm.quantita) || 0;
                const litersUnit = getLitersPerUnit(sm.formato);
                const liters = Math.round(units * litersUnit);

                if (!salesByTargetMonth[month][key]) {
                    salesByTargetMonth[month][key] = {
                        cliente: clientName,
                        birra: beerName,
                        totalLiters: 0,
                        formatsBreakdown: {}
                    };
                }

                salesByTargetMonth[month][key].totalLiters += liters;
                const fmt = sm.formato || 'FUSTO ACCIAIO 20L';
                if (!salesByTargetMonth[month][key].formatsBreakdown[fmt]) {
                    salesByTargetMonth[month][key].formatsBreakdown[fmt] = { liters: 0, units: 0, pct: 0 };
                }
                salesByTargetMonth[month][key].formatsBreakdown[fmt].liters += liters;
                salesByTargetMonth[month][key].formatsBreakdown[fmt].units += units;
            });
        } else {
            // Se non ci sono movimenti vendite diretti, usa il confezionamento o le cotte come riferimento di domanda
            sourcePackaging.forEach(pkg => {
                const d = parseDate(pkg.DATA);
                const month = d.getMonth();
                const cottaRef = sourceCotte.find(c => c.LOTTO === pkg.LOTTO_PROD);
                const beerName = cottaRef?.NOME_BIRRA || 'Birra Artigianale';
                const clientName = cottaRef?.CLIENTE || 'Cliente';
                const key = `${clientName}|${beerName}`;
                const liters = pkg.LITRI_TOT || 0;

                if (!salesByTargetMonth[month][key]) {
                    salesByTargetMonth[month][key] = {
                        cliente: clientName,
                        birra: beerName,
                        totalLiters: 0,
                        formatsBreakdown: {}
                    };
                }

                salesByTargetMonth[month][key].totalLiters += liters;
                const fmt = pkg.FORMATO || 'FUSTO ACCIAIO 20L';
                if (!salesByTargetMonth[month][key].formatsBreakdown[fmt]) {
                    salesByTargetMonth[month][key].formatsBreakdown[fmt] = { liters: 0, units: 0, pct: 0 };
                }
                salesByTargetMonth[month][key].formatsBreakdown[fmt].liters += liters;
                salesByTargetMonth[month][key].formatsBreakdown[fmt].units += (pkg.QTA_UNITA || 1);
            });
        }

        // Calcola percentuali sui formati
        for (let m = 0; m < 12; m++) {
            Object.values(salesByTargetMonth[m]).forEach(item => {
                if (item.totalLiters > 0) {
                    Object.keys(item.formatsBreakdown).forEach(fmt => {
                        item.formatsBreakdown[fmt].pct = Math.round((item.formatsBreakdown[fmt].liters / item.totalLiters) * 100);
                    });
                }
            });
        }

        // 3. Backward-Shift: Mappatura dal Mese di Produzione al Mese di Vendita Futuro
        // Per ogni mese di produzione P (0..11):
        // Quale mese di vendita stiamo preparando? M = (P + lagMonths) % 12
        interface MonthlyForecastResult {
            prodMonthIdx: number;
            prodMonthShort: string;
            prodMonthFull: string;
            targetMonthIdx: number;
            targetMonthShort: string;
            targetMonthFull: string;
            recommendedBrewsLiters: number;
            recommendedBatchesCount: number;
            targetSalesLiters: number;
            beersToBrew: Array<{
                cliente: string;
                birra: string;
                liters: number;
                batches: number;
                targetMonthName: string;
                lagDays: number;
                formatsSuggestion: Array<{
                    formato: string;
                    liters: number;
                    units: number;
                    pct: number;
                }>;
            }>;
        }

        const monthlyForecast: MonthlyForecastResult[] = MONTH_SHORT.map((shortName, prodMonthIdx) => {
            let recommendedBrewsLiters = 0;
            let recommendedBatchesCount = 0;
            let targetSalesLiters = 0;
            const beersToBrew: MonthlyForecastResult['beersToBrew'] = [];

            // Scorri tutte le birre prodotte dal birrificio
            Object.keys(beerLagMap).forEach(bName => {
                const lagInfo = beerLagMap[bName];
                const targetM = (prodMonthIdx + lagInfo.lagMonths) % 12;

                // Cerca le vendite previste per questa birra nel mese target M
                Object.values(salesByTargetMonth[targetM]).forEach(salesItem => {
                    if (salesItem.birra.toLowerCase() === bName.toLowerCase() && salesItem.totalLiters > 0) {
                        const neededLiters = salesItem.totalLiters;
                        // Assumi dimensione media cotta (1.200 L di default o in base ai litri)
                        const batches = Math.max(1, Math.round(neededLiters / 1200));

                        recommendedBrewsLiters += neededLiters;
                        recommendedBatchesCount += batches;
                        targetSalesLiters += salesItem.totalLiters;

                        const formatsSuggestion = Object.entries(salesItem.formatsBreakdown)
                            .map(([fmt, fData]) => ({
                                formato: fmt,
                                liters: fData.liters,
                                units: fData.units,
                                pct: fData.pct
                            }))
                            .sort((a, b) => b.liters - a.liters);

                        beersToBrew.push({
                            cliente: salesItem.cliente,
                            birra: salesItem.birra,
                            liters: neededLiters,
                            batches,
                            targetMonthName: MONTH_NAMES[targetM],
                            lagDays: lagInfo.days,
                            formatsSuggestion
                        });
                    }
                });
            });

            // Se per questo mese non c'è una mappatura diretta, usa un fallback proporzionale sulle cotte storiche
            if (beersToBrew.length === 0) {
                const historicMonthCotte = sourceCotte.filter(c => parseDate(c.DATA_PROD).getMonth() === prodMonthIdx);
                historicMonthCotte.forEach(c => {
                    const ltr = parseFloat(c.LITRI_FINALI?.replace(',', '.') || '0') || 1200;
                    recommendedBrewsLiters += ltr;
                    recommendedBatchesCount += 1;
                    beersToBrew.push({
                        cliente: c.CLIENTE || 'Cliente',
                        birra: c.NOME_BIRRA || 'Birra Artigianale',
                        liters: ltr,
                        batches: 1,
                        targetMonthName: MONTH_NAMES[(prodMonthIdx + 1) % 12],
                        lagDays: 30,
                        formatsSuggestion: [
                            { formato: 'FUSTO ACCIAIO 20L', liters: Math.round(ltr * 0.6), units: Math.round((ltr * 0.6) / 20), pct: 60 },
                            { formato: 'BOTT. 33CL', liters: Math.round(ltr * 0.4), units: Math.round((ltr * 0.4) / 0.33), pct: 40 }
                        ]
                    });
                });
            }

            const targetM = (prodMonthIdx + 1) % 12;

            return {
                prodMonthIdx,
                prodMonthShort: shortName,
                prodMonthFull: MONTH_NAMES[prodMonthIdx],
                targetMonthIdx: targetM,
                targetMonthShort: MONTH_SHORT[targetM],
                targetMonthFull: MONTH_NAMES[targetM],
                recommendedBrewsLiters: Math.round(recommendedBrewsLiters),
                recommendedBatchesCount,
                targetSalesLiters: Math.round(targetSalesLiters || recommendedBrewsLiters),
                beersToBrew: beersToBrew.sort((a, b) => b.liters - a.liters)
            };
        });

        return {
            activeDataSource,
            hasPrevYearData,
            prevYear,
            beerLagMap,
            monthlyForecast,
            selectedMonthForecast: monthlyForecast[forecastMonthIdx] || monthlyForecast[0]
        };
    }, [cotte, packaging, movements, prevYearData, hasPrevYearData, useSimulationMode, forecastMonthIdx, prevYear]);

    // =========================================================================
    // 3. ANALISI SPECIFICA PER SINGOLO CLIENTE (QUANDO SELEZIONATO)
    // =========================================================================
    const clientAnalysis = useMemo(() => {
        if (!selectedClientId) return null;
        
        const clientObj = clienti.find(cli => cli.id === selectedClientId);
        const clientName = clientObj?.nome;
        if (!clientName) return null;

        const clientCotte = cotte.filter(c => c.CLIENTE === clientName);
        if (clientCotte.length === 0) return null;

        const productionHistory = clientCotte.map(cotta => {
            const relatedPackaging = packaging.filter(p => p.LOTTO_PROD === cotta.LOTTO);
            const packagedLiters = relatedPackaging.reduce((sum, p) => sum + (p.LITRI_TOT || 0), 0);
            const rawFinalLiters = parseFloat(cotta.LITRI_FINALI?.replace(',', '.') || '0') || 0;
            const effectiveLiters = packagedLiters > 0 ? packagedLiters : rawFinalLiters;
            const formats = [...new Set(relatedPackaging.map(p => p.FORMATO.includes('BOTT') ? 'Bottiglie' : 'Fusti'))];
            return {
                ...cotta,
                packagedLiters,
                effectiveLiters: Math.round(effectiveLiters * 10) / 10,
                formatsUsed: formats.length > 0 ? formats.join(', ') : 'In fermentazione'
            };
        }).sort((a, b) => parseDate(b.DATA_PROD).getTime() - parseDate(a.DATA_PROD).getTime());
        
        const totalLitersProduced = Math.round((productionHistory.reduce((sum, item) => sum + item.effectiveLiters, 0) + Number.EPSILON) * 10) / 10;
        const totalBatchesCount = productionHistory.length;

        // Raggruppamento per tipologia di birra
        const byBeer = productionHistory.reduce<Record<string, {
            liters: number; 
            batches: number; 
            formats: Record<string, number>;
            lotti: string[];
        }>>((acc, item) => {
            if (!acc[item.NOME_BIRRA]) {
                acc[item.NOME_BIRRA] = { liters: 0, batches: 0, formats: { Bottiglie: 0, Fusti: 0 }, lotti: [] };
            }
            acc[item.NOME_BIRRA].liters += item.effectiveLiters;
            acc[item.NOME_BIRRA].batches += 1;
            acc[item.NOME_BIRRA].lotti.push(item.LOTTO);
            
            const relatedPackaging = packaging.filter(p => p.LOTTO_PROD === item.LOTTO);
            relatedPackaging.forEach(p => {
                const formatType = p.FORMATO.includes('BOTT') ? 'Bottiglie' : 'Fusti';
                acc[item.NOME_BIRRA].formats[formatType] += (p.LITRI_TOT || 0);
            });

            return acc;
        }, {});

        const analysisByBeer = Object.entries(byBeer).map(([name, data]) => {
            const liters = Math.round((data.liters + Number.EPSILON) * 10) / 10;
            const percentOnClient = totalLitersProduced > 0 ? Math.round((liters / totalLitersProduced) * 100) : 0;
            return {
                name,
                liters,
                batches: data.batches,
                percentOnClient,
                lotti: data.lotti,
                preferredFormat: data.formats.Bottiglie > data.formats.Fusti ? 'Bottiglie' : 'Fusti'
            };
        }).sort((a, b) => b.liters - a.liters);

        // Timeline cronologica per il grafico di andamento
        const timelineData = [...productionHistory]
            .sort((a, b) => parseDate(a.DATA_PROD).getTime() - parseDate(b.DATA_PROD).getTime())
            .map(item => ({
                date: item.DATA_PROD,
                litri: item.effectiveLiters,
                birra: item.NOME_BIRRA,
                lotto: item.LOTTO
            }));

        // Analisi formati
        const byFormat = packaging
            .filter(p => clientCotte.some(c => c.LOTTO === p.LOTTO_PROD))
            .reduce<Record<string, number>>((acc, item) => {
                acc[item.FORMATO] = (acc[item.FORMATO] || 0) + (item.LITRI_TOT || 0);
                return acc;
            }, {});
            
        const analysisByFormat = Object.entries(byFormat).map(([name, liters]) => ({
            name, 
            liters: Math.round(((liters as number) + Number.EPSILON) * 10) / 10
        })).sort((a, b) => b.liters - a.liters);

        return {
            clientName,
            totalLitersProduced,
            totalBatchesCount,
            productionHistory,
            timelineData,
            analysisByBeer,
            analysisByFormat
        };
    }, [selectedClientId, clienti, cotte, packaging]);

    // Gestione aggiunta rapida della cotta consigliata al Calendario
    const handleConfirmScheduleBrew = async () => {
        if (!planningModalItem) return;

        try {
            const clientObj = clienti.find(c => c.nome.trim().toLowerCase() === planningModalItem.clienteNome.trim().toLowerCase());
            const matchedBeer = birre.find(b =>
                b.nomeBirra.trim().toLowerCase() === planningModalItem.birraNome.trim().toLowerCase() &&
                (!clientObj || b.clienteId === clientObj.id)
            ) || birre.find(b => b.nomeBirra.trim().toLowerCase() === planningModalItem.birraNome.trim().toLowerCase());
            
            await addPlannedBrew(selectedYear, {
                clienteId: clientObj?.id || `client_${Date.now()}`,
                clienteNome: clientObj?.nome || planningModalItem.clienteNome,
                birraId: matchedBeer?.id || `beer_${Date.now()}`,
                birraNome: matchedBeer?.nomeBirra || planningModalItem.birraNome,
                date: planningModalItem.suggestedDate,
                litriPrevisti: planningModalItem.litri,
                fermentatore: '',
                note: `Cotta pianificata da Modulo Previsione Produzione per coprire la domanda stagionale.`,
                status: 'PIANIFICATA'
            });

            showToast(`Cotta di ${planningModalItem.birraNome} pianificata a Calendario per il ${planningModalItem.suggestedDate}!`, 'success');
            setPlanningModalItem(null);
        } catch (error) {
            console.error('Errore durante la pianificazione da previsione:', error);
            showToast('Errore durante l\'aggiunta al calendario.', 'error');
        }
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-24 text-slate-400">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brew-accent mr-3"></div>
                <p className="font-bold">Caricamento andamento di produzione...</p>
            </div>
        );
    }

    return (
        <div className="space-y-6 pb-12">
            {/* Header principale e selettore cliente */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-slate-700/80 pb-4">
                <div>
                    <h1 className="text-3xl font-extrabold text-brew-accent flex items-center gap-2">
                        <span>📊</span>
                        <span>{t('productionTrend.title')}</span>
                    </h1>
                    <p className="text-xs text-slate-400 mt-1">
                        {selectedClientId 
                            ? `Analisi dettagliata per il cliente: ${clientAnalysis?.clientName || ''}`
                            : `Panoramica generale dell'attività produttiva del birrificio — Anno ${selectedYear}`
                        }
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    {onNavigateToCalendar && (
                        <button
                            onClick={onNavigateToCalendar}
                            className="px-3.5 py-2 bg-emerald-700 hover:bg-emerald-600 rounded-lg text-xs font-bold text-white transition-all shadow flex items-center gap-1.5"
                        >
                            <span>📅</span>
                            <span>Vai al Calendario</span>
                        </button>
                    )}
                    <button 
                        onClick={onExit} 
                        className="px-4 py-2 bg-brew-dark-secondary hover:bg-slate-700 border border-slate-600 rounded-lg text-sm font-bold text-slate-200 transition-all shadow"
                    >
                        Torna alla Home
                    </button>
                </div>
            </div>

            {/* Barra di Selezione Cliente / Proprietà Produzione */}
            <div className="bg-brew-dark-secondary p-4 rounded-xl shadow-lg border border-slate-700 space-y-3">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex items-center gap-3 flex-1 max-w-xl">
                        <label className="text-xs font-bold uppercase text-slate-300 whitespace-nowrap">
                            Visualizzazione:
                        </label>
                        <select 
                            value={selectedClientId} 
                            onChange={e => {
                                setSelectedClientId(e.target.value);
                                setSelectedMonthFilter('ALL');
                            }}
                            className="w-full bg-brew-dark p-2.5 rounded-lg border border-slate-600 font-semibold text-white focus:outline-none focus:ring-2 focus:ring-brew-accent"
                        >
                            <option value="">🌐 Panoramica Generale (Birrificio + BeerFirm)</option>
                            {clienti.some(c => isInternalOwner(currentBreweryData, c.nome)) && (
                                <optgroup label="🏠 Birrificio Centrale (Produzione Interna)">
                                    {clienti
                                        .filter(c => isInternalOwner(currentBreweryData, c.nome))
                                        .map(c => <option key={c.id} value={c.id}>🏠 {c.nome}</option>)}
                                </optgroup>
                            )}
                            {clienti.some(c => !isInternalOwner(currentBreweryData, c.nome)) && (
                                <optgroup label="🤝 Clienti BeerFirm (Conto Terzi)">
                                    {clienti
                                        .filter(c => !isInternalOwner(currentBreweryData, c.nome))
                                        .map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
                                </optgroup>
                            )}
                        </select>
                    </div>

                    {selectedClientId ? (
                        <button 
                            onClick={() => setSelectedClientId('')}
                            className="px-3.5 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-xs font-bold transition-all shadow self-start md:self-auto flex items-center gap-1.5"
                        >
                            <span>🌐</span>
                            <span>Mostra Panoramica Generale</span>
                        </button>
                    ) : (
                        /* Tabs Panoramica Generale: Produzioni Svolte vs Previsione Intelligente */
                        <div className="inline-flex rounded-lg bg-brew-dark p-1 border border-slate-700 text-xs self-start md:self-auto">
                            <button
                                onClick={() => setGeneralActiveTab('OVERVIEW')}
                                className={`px-3 py-1.5 rounded-md font-bold transition-all flex items-center gap-1.5 ${
                                    generalActiveTab === 'OVERVIEW' 
                                        ? 'bg-amber-600 text-white shadow' 
                                        : 'text-slate-400 hover:text-white'
                                }`}
                            >
                                <span>📊</span>
                                <span>Produzioni & Dettaglio Mese</span>
                            </button>
                            <button
                                onClick={() => setGeneralActiveTab('FORECAST')}
                                className={`px-3 py-1.5 rounded-md font-bold transition-all flex items-center gap-1.5 ${
                                    generalActiveTab === 'FORECAST' 
                                        ? 'bg-purple-600 text-white shadow' 
                                        : 'text-slate-400 hover:text-white'
                                }`}
                            >
                                <span>🔮</span>
                                <span>Previsione di Produzione</span>
                            </button>
                        </div>
                    )}
                </div>

                {/* Filtro Proprietà: Tutte / Birrificio Centrale / Clienti BeerFirm Conto Terzi */}
                {!selectedClientId && generalActiveTab === 'OVERVIEW' && (
                    <div className="pt-3 border-t border-slate-700/70 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-[11px] font-bold uppercase text-slate-400 mr-1">Segmento:</span>
                            <button
                                type="button"
                                onClick={() => setOwnershipFilter('ALL')}
                                className={`px-3 py-1.5 rounded-md text-xs font-bold transition-colors ${
                                    ownershipFilter === 'ALL' ? 'bg-brew-accent text-brew-dark' : 'bg-brew-dark text-slate-300 border border-slate-700 hover:text-white'
                                }`}
                            >
                                Tutti ({ownershipAndMultiYear.currentSplit.totalLiters.toLocaleString('it-IT')} L)
                            </button>
                            <button
                                type="button"
                                onClick={() => setOwnershipFilter('INTERNAL')}
                                className={`px-3 py-1.5 rounded-md text-xs font-bold transition-colors ${
                                    ownershipFilter === 'INTERNAL' ? 'bg-emerald-500 text-slate-950' : 'bg-brew-dark text-emerald-300 border border-emerald-700/60 hover:bg-emerald-950/40'
                                }`}
                            >
                                🏠 Birrificio Interno ({ownershipAndMultiYear.currentSplit.internalLiters.toLocaleString('it-IT')} L · {ownershipAndMultiYear.internalSharePct}%)
                            </button>
                            <button
                                type="button"
                                onClick={() => setOwnershipFilter('BEERFIRM')}
                                className={`px-3 py-1.5 rounded-md text-xs font-bold transition-colors ${
                                    ownershipFilter === 'BEERFIRM' ? 'bg-sky-400 text-slate-950' : 'bg-brew-dark text-sky-300 border border-sky-700/60 hover:bg-sky-950/40'
                                }`}
                            >
                                🤝 Clienti BeerFirm ({ownershipAndMultiYear.currentSplit.beerfirmLiters.toLocaleString('it-IT')} L · {ownershipAndMultiYear.beerfirmSharePct}%)
                            </button>
                        </div>

                        {ownershipAndMultiYear.currentSplit.totalLiters > 0 && (
                            <div className="flex items-center gap-2 min-w-[220px]">
                                <div className="flex-1 h-2.5 bg-slate-800 rounded-full overflow-hidden flex border border-slate-700">
                                    <div
                                        className="bg-emerald-500 h-full transition-all"
                                        style={{ width: `${ownershipAndMultiYear.internalSharePct}%` }}
                                        title={`Birrificio Interno: ${ownershipAndMultiYear.internalSharePct}%`}
                                    />
                                    <div
                                        className="bg-sky-400 h-full transition-all"
                                        style={{ width: `${ownershipAndMultiYear.beerfirmSharePct}%` }}
                                        title={`BeerFirm Terzi: ${ownershipAndMultiYear.beerfirmSharePct}%`}
                                    />
                                </div>
                                <span className="text-[11px] font-mono text-slate-300 whitespace-nowrap">
                                    {ownershipAndMultiYear.currentSplit.internalBatches}c / {ownershipAndMultiYear.currentSplit.beerfirmBatches}c
                                </span>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* ========================================================================= */}
            {/* SCENARIO 1: NESSUN CLIENTE SELEZIONATO -> PANORAMICA GENERALE             */}
            {/* ========================================================================= */}
            {!selectedClientId ? (
                generalActiveTab === 'OVERVIEW' ? (
                    generalAnalysis ? (
                        <div className="space-y-6">
                            {/* QUADRO STORICO PLURIENNALE (TUTTI GLI ANNI REGISTRATI NEL DB) */}
                            {ownershipAndMultiYear.yearlyRows.length > 0 && (
                                <div className="bg-brew-dark-secondary p-5 rounded-xl border border-indigo-500/50 shadow-xl space-y-4">
                                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-700 pb-3">
                                        <div>
                                            <h2 className="text-lg font-black text-white flex items-center gap-2">
                                                <span className="w-2.5 h-2.5 rounded-full bg-indigo-400 inline-block"></span>
                                                Registro Pluriennale Produzione ({ownershipAndMultiYear.yearlyRows.map(r => r.year).join(' · ')})
                                            </h2>
                                            <p className="text-xs text-slate-400 mt-0.5">
                                                Storico consolidato di ogni anno di lavoro aggiunto nel gestionale con distinzione tra produzione interna e conto terzi BeerFirm
                                            </p>
                                        </div>
                                        <span className="text-xs font-mono px-2.5 py-1 rounded bg-indigo-950/70 border border-indigo-500/50 text-indigo-200 self-start sm:self-auto">
                                            {ownershipAndMultiYear.yearlyRows.length} {ownershipAndMultiYear.yearlyRows.length === 1 ? 'anno registrato' : 'anni registrati'}
                                        </span>
                                    </div>

                                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-center">
                                        <div className="lg:col-span-5 h-56">
                                            <ResponsiveContainer width="100%" height="100%">
                                                <BarChart data={ownershipAndMultiYear.yearlyRows} margin={{ top: 15, right: 15, left: 0, bottom: 5 }}>
                                                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.5} vertical={false} />
                                                    <XAxis dataKey="year" stroke="#94a3b8" tick={{ fill: '#f8fafc', fontSize: 12, fontWeight: 700 }} />
                                                    <YAxis stroke="#94a3b8" tick={{ fill: '#94a3b8', fontSize: 11 }} tickFormatter={(v: number) => `${v} L`} />
                                                    <Tooltip
                                                        contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px', color: '#f8fafc' }}
                                                        formatter={(val: number, name: string) => [`${val.toLocaleString('it-IT')} L`, name]}
                                                    />
                                                    <Legend wrapperStyle={{ fontSize: 11 }} />
                                                    <Bar dataKey="internalLiters" name="Birrificio Interno" stackId="yr" fill="#10b981" maxBarSize={48} />
                                                    <Bar dataKey="beerfirmLiters" name="Clienti BeerFirm" stackId="yr" fill="#38bdf8" radius={[4, 4, 0, 0]} maxBarSize={48} />
                                                </BarChart>
                                            </ResponsiveContainer>
                                        </div>

                                        <div className="lg:col-span-7 overflow-x-auto rounded-lg border border-slate-700">
                                            <table className="w-full text-xs text-left text-slate-200 tabular-nums">
                                                <thead className="bg-slate-800 uppercase text-[11px] text-slate-300">
                                                    <tr>
                                                        <th className="px-3 py-2">Anno</th>
                                                        <th className="px-3 py-2 text-right">Cotte Tot.</th>
                                                        <th className="px-3 py-2 text-right">🏠 Interno</th>
                                                        <th className="px-3 py-2 text-right">🤝 BeerFirm</th>
                                                        <th className="px-3 py-2 text-right">Totale Prod.</th>
                                                        <th className="px-3 py-2 text-right">Var. Anno Prec.</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-slate-800 font-mono">
                                                    {ownershipAndMultiYear.yearlyRows.map(yr => (
                                                        <tr key={yr.year} className={yr.isCurrent ? 'bg-indigo-950/40 font-bold' : 'hover:bg-slate-800/40'}>
                                                            <td className="px-3 py-2 text-white">
                                                                {yr.year} {yr.isCurrent && <span className="ml-1 text-[10px] font-sans px-1.5 py-0.5 rounded bg-amber-500 text-slate-950 font-black">ATTIVO</span>}
                                                            </td>
                                                            <td className="px-3 py-2 text-right text-slate-300">{yr.totalBatches}</td>
                                                            <td className="px-3 py-2 text-right text-emerald-300">{yr.internalLiters.toLocaleString('it-IT')} L</td>
                                                            <td className="px-3 py-2 text-right text-sky-300">{yr.beerfirmLiters.toLocaleString('it-IT')} L</td>
                                                            <td className="px-3 py-2 text-right text-amber-300 font-bold">{yr.totalLiters.toLocaleString('it-IT')} L</td>
                                                            <td className="px-3 py-2 text-right">
                                                                {yr.yoyPct !== null ? (
                                                                    <span className={yr.yoyPct >= 0 ? 'text-emerald-400 font-bold' : 'text-red-400 font-bold'}>
                                                                        {yr.yoyPct >= 0 ? '▲ +' : '▼ '}{yr.yoyPct}%
                                                                    </span>
                                                                ) : <span className="text-slate-500">Base</span>}
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* KPI Cards Generali Birrificio (5 Indicatori + YoY + Resa & Gas) */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                                <div className="bg-gradient-to-br from-amber-500/20 to-amber-600/10 border-2 border-amber-500/50 p-4 rounded-xl shadow-xl">
                                    <div className="flex items-center justify-between gap-1">
                                        <span className="text-amber-400 text-xs font-extrabold uppercase tracking-wider">Litri Prodotti</span>
                                        {generalAnalysis.totalYoYDeltaPct !== null && (
                                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-black ${
                                                generalAnalysis.totalYoYDeltaPct >= 0 ? 'bg-emerald-900/80 text-emerald-300' : 'bg-red-900/80 text-red-300'
                                            }`}>
                                                {generalAnalysis.totalYoYDeltaPct >= 0 ? '+' : ''}{generalAnalysis.totalYoYDeltaPct}% vs {prevYear}
                                            </span>
                                        )}
                                    </div>
                                    <div className="text-2xl sm:text-3xl font-black text-amber-300 mt-1">
                                        {generalAnalysis.totalYearLiters.toLocaleString('it-IT')} L
                                    </div>
                                    <p className="text-xs text-amber-200/80 mt-1.5 font-medium">
                                        {generalAnalysis.prevTotalYearLiters > 0
                                            ? `Anno ${prevYear}: ${generalAnalysis.prevTotalYearLiters.toLocaleString('it-IT')} L`
                                            : `Volume consolidato anno ${selectedYear}`}
                                    </p>
                                </div>

                                <div className="bg-brew-dark-secondary border border-slate-700 p-4 rounded-xl shadow-lg">
                                    <div className="text-slate-400 text-xs font-bold uppercase tracking-wider">Cotte Totali Svolte</div>
                                    <div className="text-3xl font-black text-white mt-1">
                                        {generalAnalysis.totalYearBatches} <span className="text-base font-normal text-slate-400">cotte</span>
                                    </div>
                                    <p className="text-xs text-slate-300 mt-1.5">
                                        Media: <strong className="text-amber-300">{generalAnalysis.avgLitersPerBatch.toLocaleString('it-IT')} L</strong> a cotta
                                    </p>
                                </div>

                                <div className="bg-brew-dark-secondary border border-slate-700 p-4 rounded-xl shadow-lg">
                                    <div className="text-slate-400 text-xs font-bold uppercase tracking-wider">Resa Confezionamento</div>
                                    <div className="flex items-baseline gap-2 mt-1">
                                        <span className="text-2xl font-black font-mono tabular-nums text-cyan-300">
                                            {generalAnalysis.avgPackagingYieldPct !== null ? `${generalAnalysis.avgPackagingYieldPct}%` : 'N/D'}
                                        </span>
                                        {generalAnalysis.avgCellarLossPct !== null && (
                                            <span className={`text-xs font-semibold font-mono tabular-nums ${generalAnalysis.avgCellarLossPct > 14 ? 'text-amber-400' : 'text-slate-400'}`}>
                                                (-{generalAnalysis.avgCellarLossPct}% perdita)
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-xs text-slate-300 mt-1.5">
                                        Gas: <strong className="text-orange-300 font-mono tabular-nums">{generalAnalysis.totalGasMc} m³</strong> ({generalAnalysis.gasMcPerHl} m³/hL)
                                    </p>
                                </div>

                                <div className="bg-brew-dark-secondary border border-slate-700 p-4 rounded-xl shadow-lg">
                                    <div className="text-slate-400 text-xs font-bold uppercase tracking-wider">Mese Più Produttivo</div>
                                    <div className="text-2xl font-black text-emerald-400 mt-1">
                                        {generalAnalysis.peakMonth.monthFullName}
                                    </div>
                                    <p className="text-xs text-slate-300 mt-1.5">
                                        <strong className="text-emerald-300">{generalAnalysis.peakMonth.totalLiters.toLocaleString('it-IT')} L</strong> in {generalAnalysis.peakMonth.totalBatches} cotte
                                    </p>
                                </div>

                                <div className="bg-brew-dark-secondary border border-slate-700 p-4 rounded-xl shadow-lg">
                                    <div className="text-slate-400 text-xs font-bold uppercase tracking-wider">Clienti & Birre Attive</div>
                                    <div className="text-2xl font-black text-sky-400 mt-1">
                                        {generalAnalysis.distinctClientsCount} <span className="text-sm font-normal text-slate-400">clienti</span>
                                    </div>
                                    <p className="text-xs text-slate-300 mt-1.5">
                                        {generalAnalysis.distinctBeersCount} referenze birre realizzate
                                    </p>
                                </div>
                            </div>

                            {/* MONITOR PERDITE DI CANTINA / SPURGHI / CONFEZIONAMENTO (> 14%) */}
                            {generalAnalysis.highLossBatches.length > 0 && (
                                <div className="bg-amber-950/30 border border-amber-600/50 rounded-xl p-4 shadow-md space-y-3">
                                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                        <div>
                                            <h3 className="text-sm font-bold text-amber-300">
                                                Controllo Perdite Cantina & Confezionamento (&gt; 14% rispetto al mosto in fermentatore)
                                            </h3>
                                            <p className="text-xs text-slate-300 mt-0.5">
                                                Rilevati <strong>{generalAnalysis.highLossBatches.length}</strong> lotti con scarto volumetrico superiore alla soglia fisiologica del 14% (verifica fondi luppolo dry-hopping, spurghi trub o confezionamenti parziali ancora aperti).
                                            </p>
                                        </div>
                                    </div>
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-xs text-left border-collapse">
                                            <thead>
                                                <tr className="border-b border-amber-700/40 text-amber-200/80 uppercase text-[11px]">
                                                    <th className="py-1.5 pr-3">Lotto</th>
                                                    <th className="py-1.5 px-2">Birra</th>
                                                    <th className="py-1.5 px-2">Cliente</th>
                                                    <th className="py-1.5 px-2 text-right">Mosto Ferm.</th>
                                                    <th className="py-1.5 px-2 text-right">Confezionati</th>
                                                    <th className="py-1.5 px-2 text-right">Perdita Cantina</th>
                                                    <th className="py-1.5 pl-2 text-right">Stato Lotto</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-amber-800/30 text-slate-200">
                                                {generalAnalysis.highLossBatches.map(row => (
                                                    <tr key={row.lotto}>
                                                        <td className="py-1.5 pr-3 font-mono font-bold text-amber-300">{row.lotto}</td>
                                                        <td className="py-1.5 px-2 font-semibold">{row.birra}</td>
                                                        <td className="py-1.5 px-2 text-slate-300">{row.cliente}</td>
                                                        <td className="py-1.5 px-2 text-right font-mono tabular-nums">{row.fermLiters.toLocaleString('it-IT')} L</td>
                                                        <td className="py-1.5 px-2 text-right font-mono tabular-nums text-emerald-300">{row.pkgLiters.toLocaleString('it-IT')} L</td>
                                                        <td className="py-1.5 px-2 text-right font-mono tabular-nums font-bold text-red-300">
                                                            -{row.lostLiters.toLocaleString('it-IT')} L (-{row.lossPct.toFixed(1)}%)
                                                        </td>
                                                        <td className="py-1.5 pl-2 text-right">
                                                            <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${row.isClosed ? 'bg-red-900/60 text-red-200' : 'bg-slate-800 text-amber-300'}`}>
                                                                {row.isClosed ? 'Chiuso' : 'Cantina Aperta'}
                                                            </span>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}

                            {/* NUOVO MODULO DIREZIONALE: CONFRONTO PRODUZIONE NEL TEMPO (MoM & YoY) */}
                            <div className="bg-brew-dark-secondary p-5 rounded-xl border-2 border-teal-600/50 shadow-xl space-y-4">
                                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-slate-700 pb-3">
                                    <div>
                                        <h2 className="text-xl font-black text-white flex items-center gap-2">
                                            <span className="w-2.5 h-2.5 rounded-full bg-teal-400 inline-block"></span>
                                            Confronto Storico Produzioni: Mese Prec. (MoM) & Anno Prec. ({prevYear}, YoY)
                                        </h2>
                                        <p className="text-xs text-slate-400 mt-0.5">
                                            Analizza crescite e cali produttivi nel tempo su singoli mesi, tipologie di birra, formati confezionati e clienti/marchi
                                        </p>
                                    </div>

                                    <div className="inline-flex rounded-lg bg-brew-dark p-1 border border-slate-700 text-xs flex-wrap gap-1">
                                        <button
                                            onClick={() => setProdCompTab('months')}
                                            className={`px-3 py-1.5 rounded-md font-bold transition-all ${prodCompTab === 'months' ? 'bg-teal-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}
                                        >
                                            📅 Mesi (MoM & YoY)
                                        </button>
                                        <button
                                            onClick={() => setProdCompTab('beers')}
                                            className={`px-3 py-1.5 rounded-md font-bold transition-all ${prodCompTab === 'beers' ? 'bg-teal-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}
                                        >
                                            🍺 Tipologie Birra
                                        </button>
                                        <button
                                            onClick={() => setProdCompTab('formats')}
                                            className={`px-3 py-1.5 rounded-md font-bold transition-all ${prodCompTab === 'formats' ? 'bg-teal-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}
                                        >
                                            📦 Formati Confezionati
                                        </button>
                                        <button
                                            onClick={() => setProdCompTab('clients')}
                                            className={`px-3 py-1.5 rounded-md font-bold transition-all ${prodCompTab === 'clients' ? 'bg-teal-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}
                                        >
                                            🤝 Clienti / Marchi
                                        </button>
                                    </div>
                                </div>

                                {prodCompTab === 'months' ? (
                                    <div className="space-y-4">
                                        <div className="h-64 w-full">
                                            <ResponsiveContainer width="100%" height="100%">
                                                <BarChart data={generalAnalysis.monthlyComparison} margin={{ top: 15, right: 20, left: 0, bottom: 5 }}>
                                                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.5} vertical={false} />
                                                    <XAxis dataKey="shortName" stroke="#94a3b8" tick={{ fill: '#cbd5e1', fontSize: 12 }} />
                                                    <YAxis stroke="#94a3b8" tick={{ fill: '#94a3b8', fontSize: 11 }} tickFormatter={(v: number) => `${v} L`} />
                                                    <Tooltip
                                                        contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px', color: '#f8fafc' }}
                                                        formatter={(val: number, name: string) => [`${val.toLocaleString('it-IT')} L`, name]}
                                                    />
                                                    <Legend wrapperStyle={{ fontSize: 12 }} />
                                                    <Bar dataKey="prevYearLiters" name={`Produzione ${prevYear}`} fill="#64748b" radius={[4, 4, 0, 0]} />
                                                    <Bar dataKey="totalLiters" name={`Produzione ${selectedYear}`} fill="#14b8a6" radius={[4, 4, 0, 0]} />
                                                </BarChart>
                                            </ResponsiveContainer>
                                        </div>

                                        <div className="overflow-x-auto rounded-lg border border-slate-700">
                                            <table className="w-full text-xs text-left text-slate-200">
                                                <thead className="bg-slate-800 uppercase text-[11px] text-slate-300">
                                                    <tr>
                                                        <th className="px-3 py-2.5">Mese</th>
                                                        <th className="px-3 py-2.5 text-right">Litri {prevYear}</th>
                                                        <th className="px-3 py-2.5 text-right">Litri {selectedYear}</th>
                                                        <th className="px-3 py-2.5 text-right">N° Cotte {selectedYear}</th>
                                                        <th className="px-3 py-2.5 text-right">Var. Mese Prec. (MoM)</th>
                                                        <th className="px-3 py-2.5 text-right">Var. Anno Prec. (YoY)</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-slate-800 font-mono">
                                                    {generalAnalysis.monthlyComparison.map(m => (
                                                        <tr key={m.shortName} className="hover:bg-slate-800/40">
                                                            <td className="px-3 py-2 font-sans font-bold text-white">{m.monthFullName}</td>
                                                            <td className="px-3 py-2 text-right text-slate-400">{m.prevYearLiters.toLocaleString('it-IT')} L</td>
                                                            <td className="px-3 py-2 text-right font-bold text-teal-300">{m.totalLiters.toLocaleString('it-IT')} L</td>
                                                            <td className="px-3 py-2 text-right text-slate-300">{m.totalBatches}</td>
                                                            <td className="px-3 py-2 text-right">
                                                                {m.momPct !== null ? (
                                                                    <span className={m.momPct >= 0 ? 'text-emerald-400 font-bold' : 'text-red-400 font-bold'}>
                                                                        {m.momPct >= 0 ? '▲ +' : '▼ '}{m.momPct}%
                                                                    </span>
                                                                ) : <span className="text-slate-600">-</span>}
                                                            </td>
                                                            <td className="px-3 py-2 text-right">
                                                                {m.yoyPct !== null ? (
                                                                    <span className={m.yoyPct >= 0 ? 'text-emerald-400 font-bold' : 'text-red-400 font-bold'}>
                                                                        {m.yoyPct >= 0 ? '▲ +' : '▼ '}{m.yoyPct}%
                                                                    </span>
                                                                ) : <span className="text-slate-600">{m.totalLiters > 0 ? 'Nuovo' : '-'}</span>}
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="overflow-x-auto max-h-96 rounded-lg border border-slate-700">
                                        <table className="w-full text-xs text-left text-slate-200">
                                            <thead className="bg-slate-800 uppercase text-[11px] text-slate-300 sticky top-0">
                                                <tr>
                                                    <th className="px-4 py-2.5">
                                                        {prodCompTab === 'beers' ? 'Tipologia Birra Prodotta' : prodCompTab === 'formats' ? 'Formato Confezionato' : 'Cliente / Marchio'}
                                                    </th>
                                                    <th className="px-4 py-2.5 text-right">Litri {prevYear}</th>
                                                    <th className="px-4 py-2.5 text-right">Litri {selectedYear}</th>
                                                    <th className="px-4 py-2.5 text-right">Differenza Litri</th>
                                                    <th className="px-4 py-2.5 text-right">Andamento YoY %</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-800 font-mono">
                                                {(prodCompTab === 'beers'
                                                    ? generalAnalysis.beerYoYRows
                                                    : prodCompTab === 'formats'
                                                        ? generalAnalysis.formatYoYRows
                                                        : generalAnalysis.clientYoYRows
                                                ).map(row => (
                                                    <tr key={row.name} className="hover:bg-slate-800/50">
                                                        <td className="px-4 py-2.5 font-sans font-bold text-white">{row.name}</td>
                                                        <td className="px-4 py-2.5 text-right text-slate-400">{row.prevL.toLocaleString('it-IT')} L</td>
                                                        <td className="px-4 py-2.5 text-right font-bold text-amber-300">{row.currL.toLocaleString('it-IT')} L</td>
                                                        <td className={`px-4 py-2.5 text-right font-bold ${row.deltaL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                                            {row.deltaL >= 0 ? '+' : ''}{row.deltaL.toLocaleString('it-IT')} L
                                                        </td>
                                                        <td className="px-4 py-2.5 text-right">
                                                            {row.isNew ? (
                                                                <span className="px-2 py-0.5 rounded bg-sky-900/60 text-sky-300 font-sans font-bold text-[10px]">NUOVA PRODUZIONE</span>
                                                            ) : (
                                                                <span className={`px-2 py-0.5 rounded font-bold ${
                                                                    row.deltaPct >= 0 ? 'bg-emerald-950 text-emerald-300' : 'bg-red-950 text-red-300'
                                                                }`}>
                                                                    {row.deltaPct >= 0 ? '▲ +' : '▼ '}{row.deltaPct}%
                                                                </span>
                                                            )}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>

                            {/* ========================================================================= */}
                            {/* GRAFICO 1: PRODUZIONI TOTALI SVOLTE PER SINGOLO MESE (12 MESI)            */}
                            {/* ========================================================================= */}
                            <div className="bg-brew-dark-secondary p-5 rounded-xl border border-slate-700 shadow-xl space-y-4">
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-700/80 pb-3">
                                    <div>
                                        <h2 className="text-xl font-bold text-white flex items-center gap-2">
                                            <span className="w-2.5 h-2.5 rounded-full bg-amber-400 inline-block"></span>
                                            Produzioni Svolte per Singolo Mese (Totale Generale Birrificio)
                                        </h2>
                                        <p className="text-xs text-slate-400 mt-0.5">
                                            Quantità complessiva delle cotte e dei litri prodotti nei 12 mesi dell'anno (clicca su una barra per filtrare il dettaglio sottostante)
                                        </p>
                                    </div>

                                    <div className="inline-flex rounded-lg bg-brew-dark p-1 border border-slate-700 text-xs self-start sm:self-auto">
                                        <button
                                            onClick={() => setGeneralMetricView('both')}
                                            className={`px-2.5 py-1 rounded-md font-semibold transition-all ${generalMetricView === 'both' ? 'bg-amber-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}
                                        >
                                            Litri & Cotte
                                        </button>
                                        <button
                                            onClick={() => setGeneralMetricView('liters')}
                                            className={`px-2.5 py-1 rounded-md font-semibold transition-all ${generalMetricView === 'liters' ? 'bg-amber-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}
                                        >
                                            Solo Litri
                                        </button>
                                        <button
                                            onClick={() => setGeneralMetricView('batches')}
                                            className={`px-2.5 py-1 rounded-md font-semibold transition-all ${generalMetricView === 'batches' ? 'bg-amber-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}
                                        >
                                            Solo N° Cotte
                                        </button>
                                    </div>
                                </div>

                                <div className="h-80 w-full">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart 
                                            data={generalAnalysis.monthlyStats} 
                                            margin={{ top: 25, right: 20, left: 10, bottom: 10 }}
                                            onClick={(state) => {
                                                if (state && state.activeTooltipIndex !== undefined) {
                                                    setSelectedMonthFilter(state.activeTooltipIndex);
                                                }
                                            }}
                                        >
                                            <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.6} vertical={false} />
                                            <XAxis 
                                                dataKey="shortName" 
                                                stroke="#94a3b8" 
                                                tick={{ fill: '#cbd5e1', fontSize: 12, fontWeight: 600 }}
                                            />
                                            <YAxis 
                                                yAxisId="litersAxis"
                                                stroke="#94a3b8" 
                                                tick={{ fill: '#94a3b8', fontSize: 11 }}
                                                tickFormatter={(v: number) => `${v.toLocaleString('it-IT')} L`}
                                                orientation="left"
                                            />
                                            {generalMetricView === 'both' && (
                                                <YAxis 
                                                    yAxisId="batchesAxis"
                                                    stroke="#38bdf8" 
                                                    tick={{ fill: '#38bdf8', fontSize: 11 }}
                                                    orientation="right"
                                                    tickFormatter={(v: number) => `${v} c.`}
                                                />
                                            )}
                                            <Tooltip 
                                                contentStyle={{ 
                                                    backgroundColor: '#0f172a', 
                                                    borderColor: '#334155', 
                                                    borderRadius: '8px', 
                                                    color: '#f8fafc' 
                                                }}
                                                formatter={(value: number, name: string) => {
                                                    if (name === 'Litri Prodotti') return [`${value.toLocaleString('it-IT')} L`, name];
                                                    if (name === 'Numero Cotte') return [`${value} cotte svolte`, name];
                                                    return [value, name];
                                                }}
                                                labelFormatter={(label: string) => `Mese: ${label}`}
                                            />
                                            <Legend wrapperStyle={{ paddingTop: 10, fontSize: 12 }} />

                                            {(generalMetricView === 'both' || generalMetricView === 'liters') && (
                                                <Bar 
                                                    yAxisId="litersAxis"
                                                    dataKey="totalLiters" 
                                                    name="Litri Prodotti" 
                                                    fill="#f59e0b" 
                                                    radius={[6, 6, 0, 0]}
                                                    cursor="pointer"
                                                >
                                                    <LabelList 
                                                        dataKey="totalLiters" 
                                                        position="top" 
                                                        formatter={(v: number) => v > 0 ? `${v.toLocaleString('it-IT')}L` : ''} 
                                                        fill="#f8fafc" 
                                                        fontSize={10} 
                                                        fontWeight={700}
                                                    />
                                                    {generalAnalysis.monthlyStats.map((_, idx) => (
                                                        <Cell 
                                                            key={`cell-month-${idx}`} 
                                                            fill={selectedMonthFilter === idx ? '#fbbf24' : '#f59e0b'} 
                                                        />
                                                    ))}
                                                </Bar>
                                            )}

                                            {(generalMetricView === 'both' || generalMetricView === 'batches') && (
                                                <Bar 
                                                    yAxisId={generalMetricView === 'both' ? 'batchesAxis' : 'litersAxis'}
                                                    dataKey="totalBatches" 
                                                    name="Numero Cotte" 
                                                    fill="#0284c7" 
                                                    radius={[6, 6, 0, 0]}
                                                    cursor="pointer"
                                                >
                                                    <LabelList 
                                                        dataKey="totalBatches" 
                                                        position="top" 
                                                        formatter={(v: number) => v > 0 ? `${v}c` : ''} 
                                                        fill="#38bdf8" 
                                                        fontSize={10} 
                                                        fontWeight={700}
                                                    />
                                                </Bar>
                                            )}
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>

                            {/* ========================================================================= */}
                            {/* GRAFICO 2: DETTAGLIO DI CHI HA PRODOTTO IN QUEL DETERMINATO MESE          */}
                            {/* ========================================================================= */}
                            <div className="bg-brew-dark-secondary p-5 rounded-xl border border-slate-700 shadow-xl space-y-4">
                                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-700/80 pb-3">
                                    <div>
                                        <h2 className="text-xl font-bold text-white flex items-center gap-2">
                                            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 inline-block"></span>
                                            Dettaglio Produttori e Birre per Mese
                                        </h2>
                                        <p className="text-xs text-slate-400 mt-0.5">
                                            {selectedMonthFilter === 'ALL'
                                                ? 'Visualizzazione aggregata di tutte le birre e clienti dell\'anno'
                                                : `Dettaglio produzioni svolte nel mese di ${MONTH_NAMES[selectedMonthFilter]}`
                                            }
                                        </p>
                                    </div>

                                    {/* Selettore rapido dei mesi */}
                                    <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-thin max-w-full">
                                        <button
                                            onClick={() => setSelectedMonthFilter('ALL')}
                                            className={`px-2.5 py-1 rounded-md text-xs font-bold whitespace-nowrap transition-all ${
                                                selectedMonthFilter === 'ALL'
                                                    ? 'bg-emerald-600 text-white shadow'
                                                    : 'bg-brew-dark text-slate-400 hover:text-white border border-slate-700'
                                            }`}
                                        >
                                            Tutti i Mesi
                                        </button>
                                        {MONTH_SHORT.map((name, idx) => (
                                            <button
                                                key={name}
                                                onClick={() => setSelectedMonthFilter(idx)}
                                                className={`px-2.5 py-1 rounded-md text-xs font-bold whitespace-nowrap transition-all ${
                                                    selectedMonthFilter === idx
                                                        ? 'bg-amber-600 text-white shadow'
                                                        : 'bg-brew-dark text-slate-400 hover:text-white border border-slate-700'
                                                }`}
                                            >
                                                {name}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {generalAnalysis.filteredMonthDetails.length === 0 ? (
                                    <div className="text-center py-10 bg-brew-dark/50 rounded-xl border border-slate-800 text-slate-400">
                                        <p className="font-bold">Nessuna cotta registrata nel mese selezionato.</p>
                                    </div>
                                ) : (
                                    <div className="space-y-4">
                                        {/* Grafico a barre del dettaglio produzioni */}
                                        <div className="h-72 w-full">
                                            <ResponsiveContainer width="100%" height="100%">
                                                <BarChart
                                                    data={generalAnalysis.filteredMonthDetails.slice(0, 12).map(d => ({
                                                        label: `${d.cliente} - ${d.birra}`,
                                                        liters: d.liters,
                                                        batches: d.batches,
                                                        cliente: d.cliente,
                                                        birra: d.birra
                                                    }))}
                                                    layout="vertical"
                                                    margin={{ top: 10, right: 60, left: 10, bottom: 5 }}
                                                >
                                                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.6} horizontal={false} />
                                                    <XAxis 
                                                        type="number" 
                                                        stroke="#94a3b8" 
                                                        tick={{ fill: '#94a3b8', fontSize: 11 }}
                                                        tickFormatter={(v: number) => `${v.toLocaleString('it-IT')} L`}
                                                    />
                                                    <YAxis 
                                                        dataKey="label" 
                                                        type="category" 
                                                        width={180} 
                                                        stroke="#94a3b8" 
                                                        tick={{ fill: '#cbd5e1', fontSize: 11 }}
                                                    />
                                                    <Tooltip 
                                                        contentStyle={{ 
                                                            backgroundColor: '#0f172a', 
                                                            borderColor: '#334155', 
                                                            borderRadius: '8px', 
                                                            color: '#f8fafc' 
                                                        }}
                                                        formatter={(val: number) => [`${val.toLocaleString('it-IT')} L`, 'Volume Prodotto']}
                                                    />
                                                    <Bar dataKey="liters" fill="#10b981" radius={[0, 6, 6, 0]}>
                                                        <LabelList 
                                                            dataKey="liters" 
                                                            position="right" 
                                                            formatter={(val: number) => `${val.toLocaleString('it-IT')} L`} 
                                                            fill="#f8fafc" 
                                                            fontSize={10} 
                                                            fontWeight={700}
                                                            offset={8}
                                                        />
                                                        {generalAnalysis.filteredMonthDetails.slice(0, 12).map((_, index) => (
                                                            <Cell key={`cell-detail-${index}`} fill={BEER_COLORS[index % BEER_COLORS.length]} />
                                                        ))}
                                                    </Bar>
                                                </BarChart>
                                            </ResponsiveContainer>
                                        </div>

                                        {/* Griglia analitica con card di dettaglio per ogni cotta/birra */}
                                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 pt-2">
                                            {generalAnalysis.filteredMonthDetails.map((item, idx) => (
                                                <div 
                                                    key={`${item.cliente}_${item.birra}_${idx}`}
                                                    className="bg-brew-dark p-3.5 rounded-xl border border-slate-700/80 shadow flex flex-col justify-between"
                                                >
                                                    <div className="flex items-start justify-between gap-2">
                                                        <div>
                                                            <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded bg-slate-700 text-amber-300">
                                                                Cliente: {item.cliente}
                                                            </span>
                                                            <h4 className="text-base font-black text-white mt-1">
                                                                🍺 {item.birra}
                                                            </h4>
                                                        </div>
                                                        <span className="text-xs font-black px-2 py-1 bg-emerald-900/60 border border-emerald-500/80 text-emerald-300 rounded-lg">
                                                            {item.batches} {item.batches === 1 ? 'cotta' : 'cotte'}
                                                        </span>
                                                    </div>

                                                    <div className="mt-3 pt-2 border-t border-slate-700/60 flex items-center justify-between text-xs">
                                                        <div>
                                                            <span className="text-slate-400">Volume prodotto:</span>
                                                            <span className="font-extrabold text-amber-300 ml-1.5 text-sm">
                                                                {item.liters.toLocaleString('it-IT')} L
                                                            </span>
                                                        </div>
                                                        {item.lotti && item.lotti.length > 0 && (
                                                            <span className="text-[10px] text-slate-400 font-mono">
                                                                Lotti: {item.lotti.join(', ')}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    ) : (
                        <div className="text-center py-16 bg-brew-dark-secondary rounded-xl border border-slate-700 shadow-lg">
                            <p className="text-slate-400 text-lg">Nessuna cotta registrata per l'anno {selectedYear}.</p>
                        </div>
                    )
                ) : (
                    /* ========================================================================= */
                    /* TAB PREVISIONE DI PRODUZIONE (LEAD-TIME & STORICO ANNO PRECEDENTE)        */
                    /* ========================================================================= */
                    <div className="space-y-6">
                        {/* Banner Informativo sullo Stato dell'Anno Precedente */}
                        {!hasPrevYearData ? (
                            <div className="bg-gradient-to-r from-blue-950/70 via-indigo-950/60 to-purple-950/70 p-5 rounded-2xl border-2 border-amber-500/70 shadow-2xl space-y-3">
                                <div className="flex items-center gap-3">
                                    <span className="text-2xl p-2 bg-amber-500/20 rounded-xl">🔮</span>
                                    <div>
                                        <h3 className="text-lg font-black text-amber-300">
                                            Modulo Previsione di Produzione — Anno di Partenza {selectedYear}
                                        </h3>
                                        <p className="text-xs text-slate-300">
                                            Storico {prevYear} non presente nel database (primo anno di utilizzo sul software).
                                        </p>
                                    </div>
                                </div>
                                <p className="text-xs text-slate-300 leading-relaxed">
                                    Il motore di previsione confronta le vendite e i tempi di cantina dell'anno precedente per suggerire con precisione cosa brassare mese per mese. 
                                    Nel tuo primo anno ({selectedYear}), il modulo opera in <strong>Modalità Simulazione / Proiezione</strong> analizzando le cotte e i trend registrati fino ad oggi, 
                                    e <strong>entrerà a pieno regime automatico all'apertura dell'anno {parseInt(selectedYear, 10) + 1}</strong> basandosi su tutto lo storico reale del {selectedYear}.
                                </p>
                                <div className="flex items-center gap-2 pt-1">
                                    <span className="px-2.5 py-1 rounded bg-emerald-900/60 text-emerald-300 font-extrabold text-xs border border-emerald-500/60">
                                        ✓ Algoritmo Backward-Shift Attivo
                                    </span>
                                    <span className="px-2.5 py-1 rounded bg-slate-800 text-slate-300 text-xs font-mono">
                                        Lead-Time Cantina & Formati Abilitati
                                    </span>
                                </div>
                            </div>
                        ) : (
                            <div className="bg-emerald-950/40 p-4 rounded-xl border border-emerald-600/70 shadow-lg flex items-center justify-between gap-3">
                                <div className="flex items-center gap-2.5">
                                    <span className="text-xl">✅</span>
                                    <div>
                                        <h4 className="font-extrabold text-sm text-emerald-300">
                                            Storico Anno Precedente ({prevYear}) Connesso
                                        </h4>
                                        <p className="text-xs text-slate-300">
                                            Il motore calcola il fabbisogno reale basandosi sulle cotte e vendite registrate nel {prevYear}.
                                        </p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2 flex-wrap">
                                    <button
                                        onClick={() => setUseSimulationMode(!useSimulationMode)}
                                        className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold transition-all border border-slate-600"
                                    >
                                        {useSimulationMode ? "Passa a Storico Reale" : "Simula su Anno Corrente"}
                                    </button>
                                    <span className="px-3 py-1 rounded-full bg-emerald-800 text-emerald-100 font-bold text-xs">
                                        {prevYearData?.COTTE_HEAD?.length || 0} cotte storiche analizzate
                                    </span>
                                </div>
                            </div>
                        )}

                        {forecastEngine && (
                            <div className="space-y-6">
                                {/* Grafico Previsione di Produzione vs Vendite Target */}
                                <div className="bg-brew-dark-secondary p-5 rounded-xl border border-slate-700 shadow-xl space-y-4">
                                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-700/80 pb-3">
                                        <div>
                                            <h2 className="text-xl font-bold text-white flex items-center gap-2">
                                                <span className="w-2.5 h-2.5 rounded-full bg-purple-400 inline-block"></span>
                                                Piano Annuale di Previsione Cotte vs Vendite Stagionali
                                            </h2>
                                            <p className="text-xs text-slate-400 mt-0.5">
                                                Mostra mese per mese i litri da produrre in anticipo per coprire le vendite future dopo la maturazione in cantina
                                            </p>
                                        </div>
                                    </div>

                                    <div className="h-80 w-full">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <BarChart 
                                                data={forecastEngine.monthlyForecast} 
                                                margin={{ top: 25, right: 20, left: 10, bottom: 10 }}
                                                onClick={(state) => {
                                                    if (state && state.activeTooltipIndex !== undefined) {
                                                        setForecastMonthIdx(state.activeTooltipIndex);
                                                    }
                                                }}
                                            >
                                                <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.6} vertical={false} />
                                                <XAxis 
                                                    dataKey="prodMonthShort" 
                                                    stroke="#94a3b8" 
                                                    tick={{ fill: '#cbd5e1', fontSize: 12, fontWeight: 600 }}
                                                />
                                                <YAxis 
                                                    stroke="#94a3b8" 
                                                    tick={{ fill: '#94a3b8', fontSize: 11 }}
                                                    tickFormatter={(v: number) => `${v.toLocaleString('it-IT')} L`}
                                                />
                                                <Tooltip 
                                                    contentStyle={{ 
                                                        backgroundColor: '#0f172a', 
                                                        borderColor: '#334155', 
                                                        borderRadius: '8px', 
                                                        color: '#f8fafc' 
                                                    }}
                                                    formatter={(val: number, name: string) => [`${val.toLocaleString('it-IT')} L`, name]}
                                                    labelFormatter={(lbl: string) => `Mese di Cotta: ${lbl}`}
                                                />
                                                <Legend wrapperStyle={{ paddingTop: 10, fontSize: 12 }} />

                                                <Bar 
                                                    dataKey="recommendedBrewsLiters" 
                                                    name="Litri Consigliati da Brassare" 
                                                    fill="#f59e0b" 
                                                    radius={[6, 6, 0, 0]}
                                                    cursor="pointer"
                                                >
                                                    <LabelList 
                                                        dataKey="recommendedBrewsLiters" 
                                                        position="top" 
                                                        formatter={(v: number) => v > 0 ? `${v}L` : ''} 
                                                        fill="#f8fafc" 
                                                        fontSize={10} 
                                                        fontWeight={700}
                                                    />
                                                    {forecastEngine.monthlyForecast.map((_, idx) => (
                                                        <Cell 
                                                            key={`cell-fc-${idx}`} 
                                                            fill={forecastMonthIdx === idx ? '#a855f7' : '#f59e0b'} 
                                                        />
                                                    ))}
                                                </Bar>

                                                <Bar 
                                                    dataKey="targetSalesLiters" 
                                                    name="Vendite Future che andrà a coprire" 
                                                    fill="#0284c7" 
                                                    radius={[6, 6, 0, 0]}
                                                    cursor="pointer"
                                                />
                                            </BarChart>
                                        </ResponsiveContainer>
                                    </div>
                                </div>

                                {/* Scheda Operativa Dettagliata per il Mese di Brassaggio Selezionato */}
                                <div className="bg-brew-dark-secondary p-5 rounded-xl border border-slate-700 shadow-xl space-y-4">
                                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-700/80 pb-3">
                                        <div>
                                            <h3 className="text-lg font-black text-white flex items-center gap-2">
                                                <span>📋</span>
                                                <span>Consigli di Produzione per il Mese di {MONTH_NAMES[forecastMonthIdx]}</span>
                                            </h3>
                                            <p className="text-xs text-slate-400 mt-0.5">
                                                Cosa brassare questo mese e con quali formati confezionare per arrivare pronti alle vendite stagionali
                                            </p>
                                        </div>

                                        {/* Barra di selezione rapida del mese */}
                                        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-thin">
                                            {MONTH_SHORT.map((name, idx) => (
                                                <button
                                                    key={name}
                                                    onClick={() => setForecastMonthIdx(idx)}
                                                    className={`px-2.5 py-1 rounded-md text-xs font-bold whitespace-nowrap transition-all ${
                                                        forecastMonthIdx === idx
                                                            ? 'bg-purple-600 text-white shadow'
                                                            : 'bg-brew-dark text-slate-400 hover:text-white border border-slate-700'
                                                    }`}
                                                >
                                                    {name}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Elenco Birre Consigliate per il Mese */}
                                    {forecastEngine.selectedMonthForecast.beersToBrew.length === 0 ? (
                                        <div className="text-center py-10 bg-brew-dark/50 rounded-xl border border-slate-800 text-slate-400">
                                            <p className="font-bold">Nessun fabbisogno di brassaggio calcolato per questo mese.</p>
                                        </div>
                                    ) : (
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            {forecastEngine.selectedMonthForecast.beersToBrew.map((beerItem, bIdx) => (
                                                <div 
                                                    key={`${beerItem.cliente}_${beerItem.birra}_${bIdx}`}
                                                    className="bg-brew-dark p-4 rounded-xl border-2 border-slate-700 hover:border-purple-500/60 shadow-lg space-y-3 transition-all"
                                                >
                                                    <div className="flex items-start justify-between gap-2 border-b border-slate-700/60 pb-2.5">
                                                        <div>
                                                            <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded bg-slate-700 text-amber-300">
                                                                {beerItem.cliente}
                                                            </span>
                                                            <h4 className="text-lg font-black text-white mt-1">
                                                                🍺 {beerItem.birra}
                                                            </h4>
                                                        </div>
                                                        <div className="text-right">
                                                            <span className="px-2.5 py-1 rounded bg-purple-900/70 border border-purple-500/80 text-purple-200 font-black text-xs block">
                                                                {beerItem.batches} {beerItem.batches === 1 ? 'cotta consigl.' : 'cotte consigl.'}
                                                            </span>
                                                            <span className="text-xs font-extrabold text-amber-400 mt-1 block">
                                                                ~{beerItem.liters.toLocaleString('it-IT')} L
                                                            </span>
                                                        </div>
                                                    </div>

                                                    {/* Motivazione Lead-Time */}
                                                    <div className="p-2 rounded-lg bg-slate-800/80 border border-slate-700 text-xs flex items-center justify-between text-slate-300">
                                                        <span className="flex items-center gap-1.5">
                                                            <span>⏱️</span>
                                                            <span>Tempo di cantina stimato: <strong>{beerItem.lagDays} giorni</strong></span>
                                                        </span>
                                                        <span className="text-purple-300 font-bold">
                                                            Target vendite: {beerItem.targetMonthName}
                                                        </span>
                                                    </div>

                                                    {/* Ripartizione Formati da Confezionare */}
                                                    <div>
                                                        <div className="text-[11px] font-bold uppercase text-slate-400 mb-1.5 flex items-center gap-1">
                                                            <span>📦</span>
                                                            <span>Ripartizione Formati Consigliata (per coprire le vendite):</span>
                                                        </div>
                                                        <div className="space-y-1.5">
                                                            {beerItem.formatsSuggestion.map((f, fIdx) => (
                                                                <div 
                                                                    key={fIdx}
                                                                    className="flex items-center justify-between p-2 rounded bg-brew-dark-secondary/60 text-xs border border-slate-800"
                                                                >
                                                                    <div className="flex items-center gap-2">
                                                                        <span className="font-bold text-white">{f.formato}</span>
                                                                        <span className="text-[10px] text-slate-400">({f.pct}% del volume)</span>
                                                                    </div>
                                                                    <div className="font-mono text-emerald-400 font-bold">
                                                                        {f.units} {f.formato.includes('BOTT') ? 'pz' : 'fusti'} (~{f.liters} L)
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>

                                                    {/* Azione: Pianifica a Calendario */}
                                                    <div className="pt-2 border-t border-slate-700/60 flex justify-end">
                                                        <button
                                                            onClick={() => {
                                                                // Data suggerita: 15 del mese di produzione
                                                                const dayStr = '15';
                                                                const mStr = String(forecastMonthIdx + 1).padStart(2, '0');
                                                                setPlanningModalItem({
                                                                    clienteNome: beerItem.cliente,
                                                                    birraNome: beerItem.birra,
                                                                    litri: beerItem.liters,
                                                                    suggestedDate: `${selectedYear}-${mStr}-${dayStr}`
                                                                });
                                                            }}
                                                            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold transition-all shadow flex items-center gap-1.5"
                                                        >
                                                            <span>📅</span>
                                                            <span>Pianifica a Calendario</span>
                                                        </button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                )
            ) : (
                /* ========================================================================= */
                /* SCENARIO 2: CLIENTE SELEZIONATO (PUNTO 2 RICHIESTA UTENTE)                */
                /* ========================================================================= */
                clientAnalysis && (
                    <div className="space-y-6">
                        {/* 1. Fascia Gialla: Litri Totali Prodotti da questo cliente */}
                        <div className="bg-brew-accent text-brew-dark text-center p-5 rounded-xl shadow-2xl border-2 border-amber-400">
                            <h3 className="text-base font-extrabold uppercase tracking-wide">
                                Litri Totali Prodotti per {clientAnalysis.clientName}
                            </h3>
                            <p className="text-4xl sm:text-5xl font-black mt-1">
                                {clientAnalysis.totalLitersProduced.toLocaleString('it-IT')} L
                            </p>
                            <p className="text-xs font-bold text-brew-dark/80 mt-1">
                                {clientAnalysis.totalBatchesCount} cotte complessive registrate per questo cliente
                            </p>
                        </div>

                        {/* ========================================================================= */}
                        {/* 2. SUBITO SOTTO LA FASCIA GIALLA: TIPOLOGIE DI BIRRE PRODOTTE E QUANTITÀ   */}
                        {/*    (GRANDE GRAFICO A CANDELE VERTICALI AL POSTO DEL GRAFICO A TORTA)      */}
                        {/* ========================================================================= */}
                        <div className="bg-brew-dark-secondary p-5 rounded-xl border border-slate-700 shadow-xl space-y-4">
                            <div className="border-b border-slate-700/80 pb-3">
                                <h2 className="text-xl font-black text-white flex items-center gap-2">
                                    <span className="w-2.5 h-2.5 rounded-full bg-brew-accent inline-block"></span>
                                    Tipologie di Birre Prodotte e Quantità ({clientAnalysis.analysisByBeer.length} referenze)
                                </h2>
                                <p className="text-xs text-slate-400 mt-0.5">
                                    Ripartizione a candele verticali dei litri prodotti e numero di cotte per ogni birra realizzata da {clientAnalysis.clientName}
                                </p>
                            </div>

                            {/* Grande Grafico a Candele Verticali */}
                            <div className="h-80 sm:h-96 w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart 
                                        data={clientAnalysis.analysisByBeer} 
                                        margin={{ top: 25, right: 25, left: 10, bottom: 45 }}
                                    >
                                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.6} vertical={false} />
                                        <XAxis 
                                            dataKey="name" 
                                            stroke="#94a3b8" 
                                            tick={{ fill: '#cbd5e1', fontSize: 12, fontWeight: 600 }}
                                            interval={0}
                                            angle={-20}
                                            textAnchor="end"
                                        />
                                        <YAxis 
                                            stroke="#94a3b8" 
                                            tick={{ fill: '#94a3b8', fontSize: 11 }}
                                            tickFormatter={(v: number) => `${v.toLocaleString('it-IT')} L`}
                                        />
                                        <Tooltip 
                                            contentStyle={{ 
                                                backgroundColor: '#0f172a', 
                                                borderColor: '#334155', 
                                                borderRadius: '8px', 
                                                color: '#f8fafc' 
                                            }}
                                            formatter={(value: number, name: string) => {
                                                return [`${value.toLocaleString('it-IT')} L`, name];
                                            }}
                                            labelFormatter={(label: string) => `Birra: ${label}`}
                                        />
                                        <Bar 
                                            dataKey="liters" 
                                            name="Litri Prodotti" 
                                            fill="#f59e0b" 
                                            radius={[6, 6, 0, 0]}
                                        >
                                            <LabelList 
                                                dataKey="liters" 
                                                position="top" 
                                                formatter={(val: number) => `${val.toLocaleString('it-IT')} L`} 
                                                fill="#f8fafc" 
                                                fontSize={11} 
                                                fontWeight={700}
                                                offset={8}
                                            />
                                            {clientAnalysis.analysisByBeer.map((_, index) => (
                                                <Cell key={`cell-beer-${index}`} fill={BEER_COLORS[index % BEER_COLORS.length]} />
                                            ))}
                                        </Bar>
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>

                            {/* Griglia di Schede Riassuntive delle Birre Prodotte */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 pt-2">
                                {clientAnalysis.analysisByBeer.map((beer, index) => (
                                    <div 
                                        key={beer.name} 
                                        className="p-3.5 bg-brew-dark rounded-xl border border-slate-700/80 shadow flex flex-col justify-between"
                                        style={{ borderLeft: `5px solid ${BEER_COLORS[index % BEER_COLORS.length]}` }}
                                    >
                                        <div className="flex items-start justify-between gap-2">
                                            <div>
                                                <h4 className="font-black text-white text-base">{beer.name}</h4>
                                                <span className="text-xs text-amber-400 font-extrabold">
                                                    {beer.liters.toLocaleString('it-IT')} L
                                                </span>
                                                <span className="text-[11px] text-slate-400 ml-1.5 font-medium">
                                                    ({beer.percentOnClient}% del totale)
                                                </span>
                                            </div>
                                            <span className="px-2 py-0.5 rounded text-xs font-black bg-slate-700 text-slate-200">
                                                {beer.batches} {beer.batches === 1 ? 'cotta' : 'cotte'}
                                            </span>
                                        </div>

                                        <div className="mt-2.5 pt-2 border-t border-slate-800 text-[11px] flex items-center justify-between text-slate-300">
                                            <span>Formato Prevalente:</span>
                                            <span className="font-bold text-emerald-400">{beer.preferredFormat}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* ========================================================================= */}
                        {/* 3. SUBITO SOTTO: STORICO DELLA PRODUZIONE (TABELLA DEI LOTTI)              */}
                        {/* ========================================================================= */}
                        <div className="bg-brew-dark-secondary p-5 rounded-xl border border-slate-700 shadow-xl space-y-4">
                            <div className="border-b border-slate-700/80 pb-3">
                                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                                    <span className="w-2.5 h-2.5 rounded-full bg-blue-500 inline-block"></span>
                                    {t('productionTrend.productionHistory')}
                                </h2>
                                <p className="text-xs text-slate-400 mt-0.5">Elenco cronologico di tutte le cotte e lotti realizzati per questo cliente</p>
                            </div>

                            <div className="max-h-96 overflow-y-auto rounded-lg border border-slate-700">
                                <table className="w-full text-sm text-left">
                                    <thead className="text-xs text-brew-light uppercase bg-slate-800 sticky top-0 border-b border-slate-700">
                                        <tr>
                                            <th className="px-3.5 py-3 font-bold">{t('home.lottoColumn')}</th>
                                            <th className="px-3.5 py-3 font-bold">{t('home.prodDateColumn')}</th>
                                            <th className="px-3.5 py-3 font-bold">{t('home.typeColumn')}</th>
                                            <th className="px-3.5 py-3 text-right font-bold">{t('productionTrend.packagedLiters')}</th>
                                            <th className="px-3.5 py-3 font-bold">{t('productionTrend.formatsUsed')}</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-800 text-gray-300">
                                        {clientAnalysis.productionHistory.map(row => (
                                            <tr key={row.LOTTO} className="hover:bg-slate-700/40 transition-colors">
                                                <td className="px-3.5 py-2.5 font-mono font-bold text-brew-accent">{row.LOTTO}</td>
                                                <td className="px-3.5 py-2.5">{row.DATA_PROD}</td>
                                                <td className="px-3.5 py-2.5 font-bold text-white">{row.NOME_BIRRA}</td>
                                                <td className="px-3.5 py-2.5 text-right font-black text-amber-300 font-mono">
                                                    {row.effectiveLiters.toLocaleString('it-IT')} L
                                                </td>
                                                <td className="px-3.5 py-2.5 text-xs text-slate-300">{row.formatsUsed}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        {/* Sezioni Secondarie: Timeline e Formati */}
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            {/* Timeline cronologica */}
                            <div className="bg-brew-dark-secondary p-5 rounded-xl border border-slate-700 shadow-xl space-y-4">
                                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                                    <span className="w-2.5 h-2.5 rounded-full bg-amber-400 inline-block"></span>
                                    {t('productionTrend.productionTimeline')}
                                </h3>
                                <div className="h-64">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <LineChart data={clientAnalysis.timelineData} margin={{ top: 10, right: 20, left: 0, bottom: 5 }}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.6} />
                                            <XAxis dataKey="date" stroke="#94a3b8" tick={{ fill: '#cbd5e1', fontSize: 10 }} />
                                            <YAxis stroke="#94a3b8" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                                            <Tooltip 
                                                contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px', color: '#f8fafc' }}
                                                formatter={(value: number) => [`${value} L`, 'Litri']}
                                                labelFormatter={(lbl) => `Data: ${lbl}`}
                                            />
                                            <Line type="monotone" dataKey="litri" name={t('productionTrend.liters')} stroke="#f59e0b" strokeWidth={3} dot={{ r: 4 }} />
                                        </LineChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>

                            {/* Ripartizione Formati Usati da questo cliente */}
                            <div className="bg-brew-dark-secondary p-5 rounded-xl border border-slate-700 shadow-xl space-y-4">
                                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                                    <span className="w-2.5 h-2.5 rounded-full bg-purple-400 inline-block"></span>
                                    {t('productionTrend.analysisByFormat')}
                                </h3>
                                <div className="h-64">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart data={clientAnalysis.analysisByFormat} layout="vertical" margin={{ top: 5, right: 30, left: 10, bottom: 5 }}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.6} horizontal={false} />
                                            <XAxis type="number" stroke="#94a3b8" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                                            <YAxis dataKey="name" type="category" width={140} stroke="#94a3b8" tick={{ fill: '#cbd5e1', fontSize: 11 }} />
                                            <Tooltip 
                                                formatter={(value: number) => [`${value} L`, t('productionTrend.liters')]} 
                                                contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px', color: '#f8fafc' }}
                                            />
                                            <Bar dataKey="liters" name={t('productionTrend.liters')} fill="#8b5cf6" radius={[0, 6, 6, 0]}>
                                                <LabelList 
                                                    dataKey="liters" 
                                                    position="right" 
                                                    formatter={(val: number) => `${val} L`} 
                                                    fill="#f8fafc" 
                                                    fontSize={10} 
                                                    fontWeight={600}
                                                />
                                            </Bar>
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>
                        </div>
                    </div>
                )
            )}

            {/* MODALE CONFERMA PIANIFICAZIONE COTTA DA PREVISIONE */}
            {planningModalItem && (
                <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-3">
                    <div className="bg-brew-dark border-2 border-purple-500 rounded-2xl max-w-md w-full p-5 shadow-2xl space-y-4">
                        <div className="flex items-center gap-2 border-b border-slate-700 pb-3">
                            <span className="p-2 bg-purple-900/60 text-purple-300 rounded-lg text-lg">📅</span>
                            <div>
                                <h3 className="text-lg font-black text-white">Pianifica Cotta nel Calendario</h3>
                                <p className="text-xs text-slate-400">Inserimento suggerito dal modulo di previsione</p>
                            </div>
                        </div>

                        <div className="space-y-3 text-sm">
                            <div className="p-3 bg-brew-dark-secondary rounded-lg border border-slate-700 space-y-1.5">
                                <div>Cliente: <strong className="text-amber-300">{planningModalItem.clienteNome}</strong></div>
                                <div>Birra: <strong className="text-white">🍺 {planningModalItem.birraNome}</strong></div>
                                <div>Volume previsto: <strong className="text-emerald-400">{planningModalItem.litri.toLocaleString('it-IT')} L</strong></div>
                            </div>

                            <div>
                                <label className="block text-xs font-bold uppercase text-slate-300 mb-1">
                                    Data Pianificata:
                                </label>
                                <input 
                                    type="date" 
                                    value={planningModalItem.suggestedDate} 
                                    onChange={e => setPlanningModalItem({ ...planningModalItem, suggestedDate: e.target.value })}
                                    className="w-full bg-slate-900 border border-slate-600 rounded-lg p-2.5 text-white font-mono"
                                />
                            </div>
                        </div>

                        <div className="flex justify-end gap-2 pt-2 border-t border-slate-700">
                            <button
                                onClick={() => setPlanningModalItem(null)}
                                className="px-3.5 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-xs font-bold"
                            >
                                Annulla
                            </button>
                            <button
                                onClick={handleConfirmScheduleBrew}
                                className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-xs font-black shadow"
                            >
                                ✓ Conferma Pianificazione
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};