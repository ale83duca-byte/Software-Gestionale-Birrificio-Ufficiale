import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
    getBreweryData,
    saveBreweryData,
    getEffectiveBreweryProfile,
    getEffectiveGasTankConfig,
    getNextDdtNumber,
    normalizeDdtInput,
    syncDdtCountersForYear,
    isInternalOwner,
    DEFAULT_BREWERY_PROFILE,
} from '../services/dataService';
import type {
    BeerStockItem,
    BeerLotStatusOverride,
    BeerMovement,
    BeerWasteReason,
    BreweryData,
    BreweryProfile,
    InternalTransferDDT,
} from '../types';
import { useTranslation } from '../i18n';
import { CubeIcon, DocumentTextIcon, TrashIcon } from './icons';
import { InitialBeerStockModal } from './InitialBeerStockModal';
import { Modal } from './Modal';
import { useToast } from '../hooks/useToast';
import {
    computeDualLocationBeerStock,
    computeCleanSalesAndWaste,
    getUnitLiters,
    parseItDateSafe,
} from '../utils/beerStockEngine';
import { printInternalTransferDdtA4, printWasteDdtA4 } from '../utils/erpPrintAndXml';
import { resolveEffectiveSellingPrice } from '../utils/pricingEngine';

interface BeerWarehouseViewProps {
    selectedYear: string;
}

interface GroupedStock {
    [client: string]: {
        [beer: string]: BeerStockItem[];
    };
}

const WASTE_REASON_LABELS: Record<BeerWasteReason, string> = {
    SCADENZA_TMC: 'Superamento TMC (Scaduta — Destinata a distruzione)',
    OSSIDAZIONE_DIFETTO: 'Lotto Rovinato / Ossidato / Difetto Organolettico',
    CONTESTAZIONE_CLIENTE: 'Prodotto Contestato / Non Conforme',
    ROTTURA_PERDITA: 'Rottura / Perdita Accidentale in Magazzino',
    CAMPIONATURA_ANALISI: 'Campionatura / Analisi Qualità',
};

export const BeerWarehouseView: React.FC<BeerWarehouseViewProps> = ({ selectedYear }) => {
    const { t } = useTranslation();
    const { showToast } = useToast();

    const [activeTab, setActiveTab] = useState<'CENTRAL' | 'BREWERY_CELLAR' | 'LOGS'>('CENTRAL');
    const [ownershipFilter, setOwnershipFilter] = useState<'ALL' | 'INTERNAL' | 'BEERFIRM'>('ALL');
    const [isLoading, setIsLoading] = useState(true);
    const [fullData, setFullData] = useState<BreweryData | null>(null);
    const [centralStock, setCentralStock] = useState<BeerStockItem[]>([]);
    const [breweryCellarStock, setBreweryCellarStock] = useState<BeerStockItem[]>([]);
    const [overrides, setOverrides] = useState<BeerLotStatusOverride[]>([]);
    const [transfers, setTransfers] = useState<InternalTransferDDT[]>([]);
    const [wasteMovements, setWasteMovements] = useState<BeerMovement[]>([]);
    const [totalWastedLiters, setTotalWastedLiters] = useState(0);
    const [profile, setProfile] = useState<BreweryProfile>({ ...DEFAULT_BREWERY_PROFILE });

    const [isInitialModalOpen, setIsInitialModalOpen] = useState(false);

    // Selezione trasferimento DDT Cella Birrificio -> Magazzino Centrale
    const [selectedForTransfer, setSelectedForTransfer] = useState<Record<string, number>>({});
    const [ddtNumber, setDdtNumber] = useState('');
    const [ddtDate, setDdtDate] = useState(new Date().toISOString().slice(0, 10));
    const [ddtOrigin, setDdtOrigin] = useState('');
    const [ddtDestination, setDdtDestination] = useState('');
    const [ddtVehicle, setDdtVehicle] = useState('Automezzo Aziendale (Conto Proprio)');
    const [ddtPlate, setDdtPlate] = useState('');
    const [ddtDriver, setDdtDriver] = useState('');
    const [ddtNotes, setDdtNotes] = useState('');

    // Modal Gestione Stato Commerciale / Promo TMC / Lotto Contestato
    const [statusModalItem, setStatusModalItem] = useState<BeerStockItem | null>(null);
    const [statusForm, setStatusForm] = useState<{
        status: 'REGOLARE' | 'PROMO_TMC' | 'CONTESTATO_BLOCCATO';
        promoPrice: string;
        note: string;
    }>({ status: 'REGOLARE', promoPrice: '', note: '' });

    // Modal Scarico a Scarto / Distruzione (NON va nei litri venduti!)
    const [wasteModalItem, setWasteModalItem] = useState<BeerStockItem | null>(null);
    const [suggestedNextWasteDdt, setSuggestedNextWasteDdt] = useState(`SC-1/${selectedYear}`);
    const [wasteForm, setWasteForm] = useState<{
        qty: string;
        date: string;
        reason: BeerWasteReason;
        notes: string;
        ddtNumber: string;
    }>({
        qty: '',
        date: new Date().toISOString().slice(0, 10),
        reason: 'SCADENZA_TMC',
        notes: '',
        ddtNumber: '',
    });

    const [inlineEditTransferId, setInlineEditTransferId] = useState<string | null>(null);
    const [inlineTransferDdtVal, setInlineTransferDdtVal] = useState('');
    const [inlineEditWasteId, setInlineEditWasteId] = useState<string | null>(null);
    const [inlineWasteDdtVal, setInlineWasteDdtVal] = useState('');

    const loadAll = useCallback(async () => {
        setIsLoading(true);
        const data = await getBreweryData(selectedYear);
        if (data) {
            setFullData(data);
            const effProfile = getEffectiveBreweryProfile(data);
            const gasCfg = getEffectiveGasTankConfig(data);
            setProfile(effProfile);

            const dual = computeDualLocationBeerStock(data);
            setCentralStock(dual.centralSalesStock);
            setBreweryCellarStock(dual.breweryCellarStock);
            setOverrides(data.BEER_LOT_OVERRIDES || []);

            const trList = (data.INTERNAL_TRANSFERS || []).slice().sort((a, b) => {
                const tA = parseItDateSafe(a.data)?.getTime() || 0;
                const tB = parseItDateSafe(b.data)?.getTime() || 0;
                return tB - tA;
            });
            setTransfers(trList);

            const nextTransfer = getNextDdtNumber(data, selectedYear, 'TRANSFER');
            setDdtNumber(nextTransfer.numeroDdt);
            const nextWaste = getNextDdtNumber(data, selectedYear, 'WASTE');
            setSuggestedNextWasteDdt(nextWaste.numeroDdt);
            setDdtOrigin(
                prev =>
                    prev ||
                    `${effProfile.ragioneSociale} — Cella Rifermentazione Birrificio ${effProfile.indirizzo || ''}`.trim()
            );
            setDdtDestination(
                prev =>
                    prev ||
                    gasCfg.indirizzoDepositoCentrale ||
                    `${effProfile.ragioneSociale} — Magazzino Centrale Vendita`
            );

            const cleanMetrics = computeCleanSalesAndWaste(data);
            setWasteMovements(
                cleanMetrics.wasteMovements.slice().sort((a, b) => {
                    const tA = parseItDateSafe(a.data)?.getTime() || 0;
                    const tB = parseItDateSafe(b.data)?.getTime() || 0;
                    return tB - tA;
                })
            );
            setTotalWastedLiters(cleanMetrics.totalWastedLiters);
        }
        setIsLoading(false);
    }, [selectedYear]);

    useEffect(() => {
        loadAll();
    }, [loadAll]);

    const overrideMap = useMemo(() => {
        const m = new Map<string, BeerLotStatusOverride>();
        overrides.forEach(o => m.set(o.key, o));
        return m;
    }, [overrides]);

    const getDaysToTmc = (dateStr: string): number | null => {
        const d = parseItDateSafe(dateStr);
        if (!d) return null;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        d.setHours(0, 0, 0, 0);
        return Math.ceil((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    };

    const getItemMarketPricing = useCallback((item: BeerStockItem) => {
        const resolved = resolveEffectiveSellingPrice({
            data: fullData,
            cliente: item.cliente,
            beerName: item.nomeBirra,
            lotto: item.lotto,
            format: item.formato,
        });
        return {
            ...resolved,
            marketValue: resolved.unitPrice * item.quantita,
        };
    }, [fullData]);

    const matchesOwnershipFilter = useCallback((clienteName: string) => {
        if (ownershipFilter === 'ALL') return true;
        const isInt = isInternalOwner(fullData, clienteName);
        return ownershipFilter === 'INTERNAL' ? isInt : !isInt;
    }, [ownershipFilter, fullData]);

    const filteredCentralStock = useMemo(
        () => centralStock.filter(i => matchesOwnershipFilter(i.cliente)),
        [centralStock, matchesOwnershipFilter]
    );

    const filteredBreweryCellarStock = useMemo(
        () => breweryCellarStock.filter(i => matchesOwnershipFilter(i.cliente)),
        [breweryCellarStock, matchesOwnershipFilter]
    );

    const groupedCentralStock = useMemo(() => {
        return filteredCentralStock.reduce((acc: GroupedStock, item) => {
            if (!acc[item.cliente]) acc[item.cliente] = {};
            if (!acc[item.cliente][item.nomeBirra]) acc[item.cliente][item.nomeBirra] = [];
            acc[item.cliente][item.nomeBirra].push(item);
            return acc;
        }, {});
    }, [filteredCentralStock]);

    const sortedCentralClients = useMemo(() => {
        return Object.entries(groupedCentralStock).sort(([aName], [bName]) => {
            const aInt = isInternalOwner(fullData, aName) ? 0 : 1;
            const bInt = isInternalOwner(fullData, bName) ? 0 : 1;
            if (aInt !== bInt) return aInt - bInt;
            return aName.localeCompare(bName);
        });
    }, [groupedCentralStock, fullData]);

    const kpiStats = useMemo(() => {
        let centralLiters = 0;
        let centralMarketValue = 0;
        let internalLiters = 0;
        let internalMarketValue = 0;
        let beerfirmLiters = 0;
        let beerfirmMarketValue = 0;

        centralStock.forEach(i => {
            const l = i.quantita * getUnitLiters(i.formato);
            const mv = getItemMarketPricing(i).marketValue;
            centralLiters += l;
            centralMarketValue += mv;
            if (isInternalOwner(fullData, i.cliente)) {
                internalLiters += l;
                internalMarketValue += mv;
            } else {
                beerfirmLiters += l;
                beerfirmMarketValue += mv;
            }
        });

        let breweryLiters = 0;
        let breweryMarketValue = 0;
        breweryCellarStock.forEach(i => {
            breweryLiters += i.quantita * getUnitLiters(i.formato);
            breweryMarketValue += getItemMarketPricing(i).marketValue;
        });

        const readyInBreweryCount = breweryCellarStock.filter(i => {
            if (!i.dataProntaTrasferimento) return true;
            const diff = getDaysToTmc(i.dataProntaTrasferimento);
            return diff !== null && diff <= 0;
        }).length;

        const allLots = [...centralStock, ...breweryCellarStock];
        const tmcAlertLots = allLots.filter(i => {
            const diff = getDaysToTmc(i.dataScadenza);
            return diff !== null && diff <= 60;
        });
        const tmcAlertLiters = tmcAlertLots.reduce((s, i) => s + i.quantita * getUnitLiters(i.formato), 0);

        return {
            centralLiters,
            centralMarketValue,
            internalLiters,
            internalMarketValue,
            beerfirmLiters,
            beerfirmMarketValue,
            breweryLiters,
            breweryMarketValue,
            readyInBreweryCount,
            tmcAlertCount: tmcAlertLots.length,
            tmcAlertLiters,
        };
    }, [centralStock, breweryCellarStock, fullData, getItemMarketPricing]);

    const openStatusModal = (item: BeerStockItem) => {
        const key = `${item.cliente}|${item.nomeBirra}|${item.lotto}|${item.formato}`;
        const existing = overrideMap.get(key);
        setStatusModalItem(item);
        setStatusForm({
            status: existing?.status || 'REGOLARE',
            promoPrice: existing?.promoPrice ? String(existing.promoPrice) : '',
            note: existing?.note || '',
        });
    };

    const handleSaveLotStatus = async () => {
        if (!statusModalItem) return;
        const data = await getBreweryData(selectedYear);
        if (!data) return;

        const key = `${statusModalItem.cliente}|${statusModalItem.nomeBirra}|${statusModalItem.lotto}|${statusModalItem.formato}`;
        const parsedPromo = parseFloat(statusForm.promoPrice.replace(',', '.'));

        if (statusForm.status === 'PROMO_TMC' && (isNaN(parsedPromo) || parsedPromo <= 0)) {
            showToast('Inserisci un prezzo promozionale valido (€ > 0) per la vendita scontata TMC.', 'error');
            return;
        }

        const list = (data.BEER_LOT_OVERRIDES || []).filter(o => o.key !== key);
        if (statusForm.status !== 'REGOLARE' || statusForm.note.trim()) {
            list.push({
                key,
                status: statusForm.status,
                promoPrice: statusForm.status === 'PROMO_TMC' ? parsedPromo : undefined,
                note: statusForm.note.trim() || undefined,
                updatedAt: new Date().toLocaleDateString('it-IT'),
            });
        }
        data.BEER_LOT_OVERRIDES = list;
        await saveBreweryData(selectedYear, data);

        showToast(
            statusForm.status === 'CONTESTATO_BLOCCATO'
                ? `Lotto ${statusModalItem.lotto} bloccato come CONTESTATO (escluso dagli ordini di vendita).`
                : statusForm.status === 'PROMO_TMC'
                    ? `Prezzo Promo TMC (€ ${parsedPromo.toFixed(2)}) attivato sul lotto ${statusModalItem.lotto}!`
                    : `Stato regolare ripristinato per il lotto ${statusModalItem.lotto}.`,
            'success'
        );
        setStatusModalItem(null);
        await loadAll();
    };

    const openWasteModal = (item: BeerStockItem, defaultReason: BeerWasteReason = 'SCADENZA_TMC') => {
        setWasteModalItem(item);
        setWasteForm({
            qty: String(Math.round(item.quantita)),
            date: new Date().toISOString().slice(0, 10),
            reason: defaultReason,
            notes: '',
            ddtNumber: suggestedNextWasteDdt,
        });
    };

    const handleConfirmWasteDischarge = async () => {
        if (!wasteModalItem) return;
        const qty = parseInt(wasteForm.qty, 10);
        if (isNaN(qty) || qty <= 0 || qty > Math.round(wasteModalItem.quantita)) {
            showToast(`Inserisci una quantità valida tra 1 e ${Math.round(wasteModalItem.quantita)}.`, 'error');
            return;
        }
        const [y, m, d] = wasteForm.date.split('-');
        const formattedDate = `${d}/${m}/${y}`;

        const data = await getBreweryData(selectedYear);
        if (!data) return;

        const trimmedWasteDdt = wasteForm.ddtNumber.trim();
        const wasteDdtInfo = trimmedWasteDdt
            ? normalizeDdtInput(trimmedWasteDdt, selectedYear, 'WASTE')
            : getNextDdtNumber(data, selectedYear, 'WASTE');

        const wasteMov: BeerMovement = {
            id: `WASTE_${Date.now()}`,
            data: formattedDate,
            type: 'WASTE',
            location: wasteModalItem.location || 'MAGAZZINO_CENTRALE',
            cliente: wasteModalItem.cliente,
            nomeBirra: wasteModalItem.nomeBirra,
            lotto: wasteModalItem.lotto,
            formato: wasteModalItem.formato,
            quantita: -qty,
            wasteReason: wasteForm.reason,
            notes: wasteForm.notes.trim() || undefined,
            ddtNumber: wasteDdtInfo.numeroDdt,
            ddtSeqNumber: wasteDdtInfo.seq,
        };

        data.BEER_MOVEMENTS = [...(data.BEER_MOVEMENTS || []), wasteMov];
        syncDdtCountersForYear(data, selectedYear);
        await saveBreweryData(selectedYear, data);

        const wastedLiters = qty * getUnitLiters(wasteModalItem.formato);
        showToast(
            `Emesso DDT Scarto ${wasteDdtInfo.numeroDdt}: scaricati ${qty} pz (${wastedLiters.toFixed(1)} L) nei Litri Scartati.`,
            'success'
        );
        setWasteModalItem(null);
        await loadAll();
    };

    const handleDeleteWasteMovement = async (movId: string) => {
        if (!window.confirm('Annullare questo scarico a scarto e riaccreditare le unità in giacenza?')) return;
        const data = await getBreweryData(selectedYear);
        if (!data) return;
        data.BEER_MOVEMENTS = (data.BEER_MOVEMENTS || []).filter(m => m.id !== movId);
        syncDdtCountersForYear(data, selectedYear);
        await saveBreweryData(selectedYear, data);
        showToast('Scarico a scarto annullato e giacenza ripristinata.', 'info');
        await loadAll();
    };

    const handleSaveInlineWasteDdt = async (movId: string) => {
        const trimmed = inlineWasteDdtVal.trim();
        if (!trimmed) {
            showToast('Inserisci un numero DDT di scarto valido.', 'error');
            return;
        }
        const data = await getBreweryData(selectedYear);
        if (!data) return;
        const { numeroDdt, seq } = normalizeDdtInput(trimmed, selectedYear, 'WASTE');
        data.BEER_MOVEMENTS = (data.BEER_MOVEMENTS || []).map(m =>
            m.id === movId ? { ...m, ddtNumber: numeroDdt, ddtSeqNumber: seq } : m
        );
        syncDdtCountersForYear(data, selectedYear);
        await saveBreweryData(selectedYear, data);
        setInlineEditWasteId(null);
        setInlineWasteDdtVal('');
        showToast(`DDT Scarto aggiornato a ${numeroDdt}.`, 'success');
        await loadAll();
    };

    const getCellarItemKey = (item: BeerStockItem) =>
        `${item.cliente}|${item.nomeBirra}|${item.lotto}|${item.formato}`;

    const toggleTransferSelection = (item: BeerStockItem) => {
        const key = getCellarItemKey(item);
        setSelectedForTransfer(prev => {
            const next = { ...prev };
            if (next[key] !== undefined) {
                delete next[key];
            } else {
                next[key] = Math.round(item.quantita);
            }
            return next;
        });
    };

    const handleCreateTransferDDT = async () => {
        const chosenEntries = breweryCellarStock
            .map(item => {
                const qty = selectedForTransfer[getCellarItemKey(item)];
                return { item, qty: qty || 0 };
            })
            .filter(e => e.qty > 0);

        if (chosenEntries.length === 0) {
            showToast('Seleziona almeno un lotto dalla Cella Birrificio da caricare sul camion.', 'error');
            return;
        }

        for (const entry of chosenEntries) {
            if (entry.qty > Math.round(entry.item.quantita)) {
                showToast(
                    `Quantità superiore alla disponibilità in Cella Birrificio per ${entry.item.nomeBirra} (Lotto ${entry.item.lotto}).`,
                    'error'
                );
                return;
            }
        }

        if (!ddtNumber.trim()) {
            showToast('Inserisci il numero del DDT di trasferimento.', 'error');
            return;
        }

        const [y, m, d] = ddtDate.split('-');
        const formattedDate = `${d}/${m}/${y}`;
        const transferId = `DDT_TRASF_${Date.now()}`;

        const data = await getBreweryData(selectedYear);
        if (!data) return;

        const nextTransferInfo = getNextDdtNumber(data, selectedYear, 'TRANSFER');
        const normalizedTransfer = ddtNumber.trim()
            ? normalizeDdtInput(ddtNumber.trim(), selectedYear, 'TRANSFER')
            : nextTransferInfo;
        const enteredDdt = normalizedTransfer.numeroDdt;
        const transferSeq = normalizedTransfer.seq;

        const newMovements: BeerMovement[] = [];
        const ddtItems = chosenEntries.map((entry, idx) => {
            const { item, qty } = entry;
            const liters = qty * getUnitLiters(item.formato);

            newMovements.push({
                id: `${transferId}_${idx}_OUT`,
                data: formattedDate,
                type: 'BREWERY_TO_CENTRAL_OUT',
                location: 'CELLA_BIRRIFICIO',
                cliente: item.cliente,
                nomeBirra: item.nomeBirra,
                lotto: item.lotto,
                formato: item.formato,
                quantita: -qty,
                relatedDocId: transferId,
                notes: `DDT Trasferimento ${enteredDdt} verso Magazzino Centrale`,
            });

            newMovements.push({
                id: `${transferId}_${idx}_IN`,
                data: formattedDate,
                type: 'BREWERY_TO_CENTRAL_IN',
                location: 'MAGAZZINO_CENTRALE',
                cliente: item.cliente,
                nomeBirra: item.nomeBirra,
                lotto: item.lotto,
                formato: item.formato,
                quantita: qty,
                relatedDocId: transferId,
                notes: `Carico da Cella Birrificio rif. DDT ${enteredDdt}`,
            });

            return {
                cliente: item.cliente,
                nomeBirra: item.nomeBirra,
                lotto: item.lotto,
                formato: item.formato,
                quantita: qty,
                litri: liters,
                dataScadenza: item.dataScadenza,
            };
        });

        const transferRecord: InternalTransferDDT = {
            id: transferId,
            numeroDdt: enteredDdt,
            ddtSeqNumber: transferSeq,
            data: formattedDate,
            indirizzoPartenza: ddtOrigin.trim(),
            indirizzoDestinazione: ddtDestination.trim(),
            mezzoTrasporto: ddtVehicle.trim() || 'Automezzo Aziendale (Conto Proprio)',
            targaMezzo: ddtPlate.trim() || undefined,
            conducente: ddtDriver.trim() || undefined,
            note: ddtNotes.trim() || undefined,
            items: ddtItems,
        };

        data.BEER_MOVEMENTS = [...(data.BEER_MOVEMENTS || []), ...newMovements];
        data.INTERNAL_TRANSFERS = [...(data.INTERNAL_TRANSFERS || []), transferRecord];
        syncDdtCountersForYear(data, selectedYear);
        if (ddtDestination.trim()) {
            data.GAS_TANK_CONFIG = {
                ...getEffectiveGasTankConfig(data),
                indirizzoDepositoCentrale: ddtDestination.trim(),
            };
        }

        await saveBreweryData(selectedYear, data);

        printInternalTransferDdtA4(transferRecord, profile);
        showToast(
            `DDT ${transferRecord.numeroDdt} emesso! Merce scaricata dalla Cella Birrificio e caricata nel Magazzino Centrale.`,
            'success'
        );

        setSelectedForTransfer({});
        setDdtNumber('');
        setDdtNotes('');
        await loadAll();
    };

    const handleDeleteTransferDDT = async (tr: InternalTransferDDT) => {
        if (
            !window.confirm(
                `Annullare il DDT di trasferimento ${tr.numeroDdt} del ${tr.data}? Le unità torneranno in carico nella Cella Birrificio.`
            )
        ) {
            return;
        }
        const data = await getBreweryData(selectedYear);
        if (!data) return;
        data.INTERNAL_TRANSFERS = (data.INTERNAL_TRANSFERS || []).filter(tItem => tItem.id !== tr.id);
        data.BEER_MOVEMENTS = (data.BEER_MOVEMENTS || []).filter(m => m.relatedDocId !== tr.id);
        syncDdtCountersForYear(data, selectedYear);
        await saveBreweryData(selectedYear, data);
        showToast(`DDT ${tr.numeroDdt} annullato e giacenze riportate in Cella Birrificio.`, 'info');
        await loadAll();
    };

    const handleSaveInlineTransferDdt = async (tr: InternalTransferDDT) => {
        const trimmed = inlineTransferDdtVal.trim();
        if (!trimmed) {
            showToast('Inserisci un numero DDT di trasferimento valido.', 'error');
            return;
        }
        const data = await getBreweryData(selectedYear);
        if (!data) return;
        const { numeroDdt, seq } = normalizeDdtInput(trimmed, selectedYear, 'TRANSFER');
        data.INTERNAL_TRANSFERS = (data.INTERNAL_TRANSFERS || []).map(item =>
            item.id === tr.id ? { ...item, numeroDdt, ddtSeqNumber: seq } : item
        );
        syncDdtCountersForYear(data, selectedYear);
        await saveBreweryData(selectedYear, data);
        setInlineEditTransferId(null);
        setInlineTransferDdtVal('');
        showToast(`DDT trasferimento aggiornato a ${numeroDdt}.`, 'success');
        await loadAll();
    };

    if (isLoading) {
        return <p className="p-6 text-slate-300">Caricamento logistica magazzini birra...</p>;
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-brew-accent">
                        {t('beerWarehouse.title')} & Logistica Doppio Polo — {selectedYear}
                    </h1>
                    <p className="text-xs text-slate-400 mt-1">
                        Gestione separata Cella Birrificio (rifermentazione/sosta) ➔ DDT Trasferimento Camion ➔ Magazzino Centrale Vendita, allerte TMC e registro scarti/contestazioni.
                    </p>
                </div>
                <button
                    onClick={() => setIsInitialModalOpen(true)}
                    className="flex items-center gap-2 bg-brew-orange text-white font-bold py-2 px-4 rounded-md hover:bg-opacity-90 self-start sm:self-auto"
                >
                    <CubeIcon className="w-5 h-5" /> Carica Giacenze Iniziali
                </button>
            </div>

            {/* KPI Strip */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 font-mono tabular-nums">
                <div className="bg-brew-dark-secondary p-4 rounded-lg border border-slate-700">
                    <div className="text-xs font-sans text-slate-400 uppercase font-semibold">
                        Magazzino Centrale &amp; Valore Mercato
                    </div>
                    <div className="text-2xl font-extrabold text-emerald-400 mt-1">
                        {kpiStats.centralLiters.toFixed(1)} L · € {kpiStats.centralMarketValue.toFixed(0)}
                    </div>
                    <div className="text-[11px] font-sans text-slate-300 mt-1 flex flex-wrap gap-x-2">
                        <span className="text-emerald-300">🏠 Interne: {kpiStats.internalLiters.toFixed(0)}L (€ {kpiStats.internalMarketValue.toFixed(0)})</span>
                        <span className="text-sky-300">🤝 Terzi: {kpiStats.beerfirmLiters.toFixed(0)}L (€ {kpiStats.beerfirmMarketValue.toFixed(0)})</span>
                    </div>
                </div>

                <div className="bg-brew-dark-secondary p-4 rounded-lg border border-slate-700">
                    <div className="text-xs font-sans text-slate-400 uppercase font-semibold">
                        Cella Birrificio (Rifermentazione / Sosta)
                    </div>
                    <div className="text-2xl font-extrabold text-sky-400 mt-1">
                        {kpiStats.breweryLiters.toFixed(1)} L · € {kpiStats.breweryMarketValue.toFixed(0)}
                    </div>
                    <div className="text-xs font-sans text-slate-400 mt-0.5">
                        {kpiStats.readyInBreweryCount} lotti pronti per DDT camion
                    </div>
                </div>

                <div className="bg-brew-dark-secondary p-4 rounded-lg border border-slate-700">
                    <div className="text-xs font-sans text-slate-400 uppercase font-semibold">
                        Allerta TMC (≤ 60 gg o Superato)
                    </div>
                    <div
                        className={`text-2xl font-extrabold mt-1 ${
                            kpiStats.tmcAlertCount > 0 ? 'text-amber-400' : 'text-slate-300'
                        }`}
                    >
                        {kpiStats.tmcAlertCount} lotti · {kpiStats.tmcAlertLiters.toFixed(0)} L
                    </div>
                    <div className="text-xs font-sans text-slate-400 mt-0.5">
                        Scegli tra Promo TMC scontata o Scarto
                    </div>
                </div>

                <div className="bg-brew-dark-secondary p-4 rounded-lg border border-slate-700">
                    <div className="text-xs font-sans text-slate-400 uppercase font-semibold">
                        Monte Litri Scartati / Contestati
                    </div>
                    <div className="text-2xl font-extrabold text-rose-400 mt-1">
                        {totalWastedLiters.toFixed(1)} L
                    </div>
                    <div className="text-xs font-sans text-slate-400 mt-0.5">
                        Separato al 100% dai Litri Venduti
                    </div>
                </div>
            </div>

            {/* Segmented Tab Controls + Ownership Filter */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-1 p-1 bg-brew-dark-secondary rounded-lg border border-slate-700 w-fit">
                    <button
                        type="button"
                        onClick={() => setActiveTab('CENTRAL')}
                        className={`px-4 py-2 text-sm font-semibold rounded-md transition-colors ${
                            activeTab === 'CENTRAL'
                                ? 'bg-brew-accent text-brew-dark shadow-sm'
                                : 'text-slate-300 hover:text-white'
                        }`}
                    >
                        Magazzino Centrale Vendita ({filteredCentralStock.length})
                    </button>
                    <button
                        type="button"
                        onClick={() => setActiveTab('BREWERY_CELLAR')}
                        className={`px-4 py-2 text-sm font-semibold rounded-md transition-colors ${
                            activeTab === 'BREWERY_CELLAR'
                                ? 'bg-brew-accent text-brew-dark shadow-sm'
                                : 'text-slate-300 hover:text-white'
                        }`}
                    >
                        Cella Birrificio &amp; DDT Camion ({filteredBreweryCellarStock.length})
                    </button>
                    <button
                        type="button"
                        onClick={() => setActiveTab('LOGS')}
                        className={`px-4 py-2 text-sm font-semibold rounded-md transition-colors ${
                            activeTab === 'LOGS'
                                ? 'bg-brew-accent text-brew-dark shadow-sm'
                                : 'text-slate-300 hover:text-white'
                        }`}
                    >
                        Storico DDT Trasferimenti ({transfers.length}) &amp; Scarti ({wasteMovements.length})
                    </button>
                </div>

                {activeTab !== 'LOGS' && (
                    <div className="flex items-center gap-1 p-1 bg-brew-dark-secondary rounded-lg border border-slate-700">
                        <button
                            type="button"
                            onClick={() => setOwnershipFilter('ALL')}
                            className={`px-3 py-1.5 text-xs font-bold rounded ${ownershipFilter === 'ALL' ? 'bg-slate-600 text-white' : 'text-slate-400 hover:text-white'}`}
                        >
                            Tutte
                        </button>
                        <button
                            type="button"
                            onClick={() => setOwnershipFilter('INTERNAL')}
                            className={`px-3 py-1.5 text-xs font-bold rounded ${ownershipFilter === 'INTERNAL' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'}`}
                        >
                            🏠 Birre Interne Birrificio
                        </button>
                        <button
                            type="button"
                            onClick={() => setOwnershipFilter('BEERFIRM')}
                            className={`px-3 py-1.5 text-xs font-bold rounded ${ownershipFilter === 'BEERFIRM' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-white'}`}
                        >
                            🤝 Clienti BeerFirm (Terzi)
                        </button>
                    </div>
                )}
            </div>

            {/* TAB 1: MAGAZZINO CENTRALE VENDITA */}
            {activeTab === 'CENTRAL' && (
                <>
                    {filteredCentralStock.length === 0 ? (
                        <div className="text-center py-14 bg-brew-dark-secondary rounded-lg border border-slate-700">
                            <p className="text-slate-300 font-semibold">Nessun prodotto presente nel Magazzino Centrale Vendita per il filtro selezionato.</p>
                            <p className="text-xs text-slate-400 mt-1">
                                Se hai birra appena confezionata in sosta, apri la scheda <strong>Cella Birrificio &amp; DDT Camion</strong> per trasferirla con DDT nel Magazzino Centrale.
                            </p>
                        </div>
                    ) : (
                        <div className="space-y-6">
                            {sortedCentralClients.map(([clientName, beers]) => {
                                const isInternal = isInternalOwner(fullData, clientName);
                                const flatItems = Object.values(beers).flat();
                                const totalClientLiters = flatItems.reduce(
                                    (sum, item) => sum + getUnitLiters(item.formato) * item.quantita,
                                    0
                                );
                                const totalClientMarketValue = flatItems.reduce(
                                    (sum, item) => sum + getItemMarketPricing(item).marketValue,
                                    0
                                );
                                return (
                                    <div key={clientName} className={`bg-brew-dark-secondary p-4 rounded-lg shadow-lg border ${isInternal ? 'border-emerald-500/50' : 'border-slate-700'}`}>
                                        <div className="flex flex-wrap justify-between items-baseline gap-2 mb-4 border-b border-slate-600 pb-2">
                                            <div className="flex items-center gap-2">
                                                <span className={`px-2 py-0.5 text-xs font-bold rounded ${isInternal ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' : 'bg-sky-500/20 text-sky-300 border border-sky-500/40'}`}>
                                                    {isInternal ? '🏠 PRODUZIONE INTERNA BIRRIFICIO' : '🤝 CLIENTE BEERFIRM (TERZI)'}
                                                </span>
                                                <h2 className="text-2xl font-bold text-brew-accent">{clientName}</h2>
                                            </div>
                                            <div className="flex items-baseline gap-4 font-mono tabular-nums">
                                                <p className="text-lg font-bold text-brew-light">
                                                    Stock: <span className="text-2xl text-brew-accent">{totalClientLiters.toFixed(1)} L</span>
                                                </p>
                                                <p className="text-lg font-bold text-emerald-300">
                                                    Valore Mercato: <span className="text-2xl">€ {totalClientMarketValue.toFixed(2)}</span>
                                                </p>
                                            </div>
                                        </div>
                                        <div className="space-y-5">
                                            {Object.entries(beers).map(([beerName, items]) => {
                                                const beerLiters = items.reduce((sum, i) => sum + getUnitLiters(i.formato) * i.quantita, 0);
                                                const beerMarket = items.reduce((sum, i) => sum + getItemMarketPricing(i).marketValue, 0);
                                                return (
                                                <div key={beerName}>
                                                    <div className="flex justify-between items-baseline mb-2">
                                                        <h3 className="text-lg font-semibold text-white">{beerName}</h3>
                                                        <p className="text-sm font-bold text-brew-accent font-mono tabular-nums">
                                                            {beerLiters.toFixed(1)} L · <span className="text-emerald-300">€ {beerMarket.toFixed(2)}</span>
                                                        </p>
                                                    </div>
                                                    <div className="overflow-x-auto">
                                                        <table className="w-full text-sm text-left text-gray-300 tabular-nums">
                                                            <thead className="text-xs text-brew-light uppercase bg-slate-700/80">
                                                                <tr>
                                                                    <th className="px-3 py-2">Lotto</th>
                                                                    <th className="px-3 py-2">Formato</th>
                                                                    <th className="px-3 py-2 text-right">Q.tà</th>
                                                                    <th className="px-3 py-2 text-right">Litri</th>
                                                                    <th className="px-3 py-2 text-right">Prezzo Vendita</th>
                                                                    <th className="px-3 py-2 text-right">Valore Mercato</th>
                                                                    <th className="px-3 py-2">TMC</th>
                                                                    <th className="px-3 py-2">Stato / Gestione</th>
                                                                    <th className="px-3 py-2 text-right">Azioni Qualità &amp; TMC</th>
                                                                </tr>
                                                            </thead>
                                                            <tbody>
                                                                {items.map((item, idx) => {
                                                                    const ovKey = `${item.cliente}|${item.nomeBirra}|${item.lotto}|${item.formato}`;
                                                                    const ov = overrideMap.get(ovKey);
                                                                    const daysLeft = getDaysToTmc(item.dataScadenza);
                                                                    const isExpiredTmc = daysLeft !== null && daysLeft < 0;
                                                                    const isExpiringSoon = daysLeft !== null && daysLeft >= 0 && daysLeft <= 60;
                                                                    const pricing = getItemMarketPricing(item);

                                                                    return (
                                                                        <tr
                                                                            key={idx}
                                                                            className={`border-b border-slate-700/60 ${
                                                                                ov?.status === 'CONTESTATO_BLOCCATO'
                                                                                    ? 'bg-rose-950/30'
                                                                                    : isExpiredTmc
                                                                                        ? 'bg-amber-950/30'
                                                                                        : ''
                                                                            }`}
                                                                        >
                                                                            <td className="px-3 py-2 font-bold text-white">{item.lotto}</td>
                                                                            <td className="px-3 py-2">{item.formato}</td>
                                                                            <td className="px-3 py-2 text-right font-mono font-bold">{Math.round(item.quantita)}</td>
                                                                            <td className="px-3 py-2 text-right font-mono text-slate-300">
                                                                                {(item.quantita * getUnitLiters(item.formato)).toFixed(1)} L
                                                                            </td>
                                                                            <td className="px-3 py-2 text-right font-mono">
                                                                                {pricing.unitPrice > 0 ? (
                                                                                    <div>
                                                                                        <span className="font-bold text-emerald-300">€ {pricing.unitPrice.toFixed(2)}</span>
                                                                                        <span className="block text-[10px] text-slate-400">
                                                                                            {pricing.source === 'PROMO_TMC' ? 'Promo TMC' : pricing.source === 'LOT_CUSTOM' ? 'Prezzo Lotto' : 'Listino Base'}
                                                                                        </span>
                                                                                    </div>
                                                                                ) : (
                                                                                    <span className="text-xs text-slate-500">N/D</span>
                                                                                )}
                                                                            </td>
                                                                            <td className="px-3 py-2 text-right font-mono font-bold text-white">
                                                                                {pricing.marketValue > 0 ? `€ ${pricing.marketValue.toFixed(2)}` : '-'}
                                                                            </td>
                                                                            <td className="px-3 py-2">
                                                                                <div className="font-mono">{item.dataScadenza || '-'}</div>
                                                                                {daysLeft !== null && (
                                                                                    <div
                                                                                        className={`text-xs ${
                                                                                            isExpiredTmc
                                                                                                ? 'text-rose-400 font-semibold'
                                                                                                : isExpiringSoon
                                                                                                    ? 'text-amber-400 font-semibold'
                                                                                                    : 'text-slate-400'
                                                                                        }`}
                                                                                    >
                                                                                        {isExpiredTmc
                                                                                            ? `TMC superato da ${Math.abs(daysLeft)} gg`
                                                                                            : isExpiringSoon
                                                                                                ? `TMC tra ${daysLeft} gg`
                                                                                                : `Tra ${daysLeft} gg`}
                                                                                    </div>
                                                                                )}
                                                                            </td>
                                                                            <td className="px-3 py-2 text-xs">
                                                                                {ov?.status === 'CONTESTATO_BLOCCATO' ? (
                                                                                    <span className="text-rose-400 font-bold">
                                                                                        BLOCCATO / CONTESTATO {ov.note ? `· ${ov.note}` : ''}
                                                                                    </span>
                                                                                ) : ov?.status === 'PROMO_TMC' ? (
                                                                                    <span className="text-amber-300 font-bold">
                                                                                        Vendita Promo TMC · € {ov.promoPrice?.toFixed(2)}/pz
                                                                                    </span>
                                                                                ) : (
                                                                                    <span className="text-emerald-400">Regolare Vendibile</span>
                                                                                )}
                                                                            </td>
                                                                            <td className="px-3 py-2 text-right">
                                                                                <div className="flex flex-wrap justify-end gap-1.5">
                                                                                    <button
                                                                                        type="button"
                                                                                        onClick={() => openStatusModal(item)}
                                                                                        className="px-2 py-1 text-xs font-semibold border border-amber-500/70 text-amber-300 hover:bg-amber-500/10 rounded"
                                                                                        title="Imposta vendita scontata Promo TMC oppure blocca lotto contestato/ossidato"
                                                                                    >
                                                                                        Promo TMC / Blocca
                                                                                    </button>
                                                                                    <button
                                                                                        type="button"
                                                                                        onClick={() =>
                                                                                            openWasteModal(
                                                                                                item,
                                                                                                isExpiredTmc || isExpiringSoon
                                                                                                    ? 'SCADENZA_TMC'
                                                                                                    : 'OSSIDAZIONE_DIFETTO'
                                                                                            )
                                                                                        }
                                                                                        className="px-2 py-1 text-xs font-semibold border border-rose-500/70 text-rose-300 hover:bg-rose-500/10 rounded"
                                                                                        title="Scarica prodotto scaduto, ossidato o contestato con DDT Scarto (non va sulle vendite)"
                                                                                    >
                                                                                        Scarta / DDT
                                                                                    </button>
                                                                                </div>
                                                                            </td>
                                                                        </tr>
                                                                    );
                                                                })}
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                </div>
                                            );})}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </>
            )}

            {/* TAB 2: CELLA BIRRIFICIO & DDT TRASFERIMENTO CAMION */}
            {activeTab === 'BREWERY_CELLAR' && (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                    <div className="lg:col-span-7 bg-brew-dark-secondary p-4 rounded-lg border border-slate-700 space-y-4">
                        <div>
                            <h2 className="text-xl font-bold text-brew-accent">
                                Lotti in Cella Birrificio (Rifermentazione / Sosta Tecnica)
                            </h2>
                            <p className="text-xs text-slate-400 mt-0.5">
                                Spunta i lotti pronti e indica i pezzi da caricare sul camion per spostarli nel Magazzino Centrale Vendita con DDT di trasferimento.
                            </p>
                        </div>

                        {filteredBreweryCellarStock.length === 0 ? (
                            <div className="py-12 text-center text-slate-400 text-sm">
                                Nessun lotto attualmente in sosta nella Cella Birrificio per il filtro selezionato.
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm text-left text-gray-300 tabular-nums">
                                    <thead className="text-xs uppercase bg-slate-700/80 text-brew-light">
                                        <tr>
                                            <th className="p-2 w-8">Carica</th>
                                            <th className="p-2">Birra &amp; Lotto</th>
                                            <th className="p-2">Formato</th>
                                            <th className="p-2">Stato Rifermentazione</th>
                                            <th className="p-2 text-right">Giac. Cella</th>
                                            <th className="p-2 text-right">Q.tà DDT</th>
                                            <th className="p-2 text-right">Scarto</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {filteredBreweryCellarStock.map(item => {
                                            const key = getCellarItemKey(item);
                                            const isSelected = selectedForTransfer[key] !== undefined;
                                            const readyDays = item.dataProntaTrasferimento
                                                ? getDaysToTmc(item.dataProntaTrasferimento)
                                                : 0;
                                            const isReady = readyDays === null || readyDays <= 0;

                                            return (
                                                <tr key={key} className="border-b border-slate-700/60">
                                                    <td className="p-2 text-center">
                                                        <input
                                                            type="checkbox"
                                                            checked={isSelected}
                                                            onChange={() => toggleTransferSelection(item)}
                                                            className="h-4 w-4 rounded bg-brew-dark border-slate-500"
                                                        />
                                                    </td>
                                                    <td className="p-2">
                                                        <div className="font-bold text-white">{item.nomeBirra}</div>
                                                        <div className="text-xs text-slate-400">
                                                            Lotto <strong>{item.lotto}</strong> · {item.cliente}
                                                        </div>
                                                    </td>
                                                    <td className="p-2">{item.formato}</td>
                                                    <td className="p-2 text-xs">
                                                        {isReady ? (
                                                            <span className="text-emerald-400 font-semibold">
                                                                Pronta al trasporto
                                                                {item.dataProntaTrasferimento ? ` (dal ${item.dataProntaTrasferimento})` : ''}
                                                            </span>
                                                        ) : (
                                                            <span className="text-amber-300">
                                                                In rifermentazione · Pronta il {item.dataProntaTrasferimento} (-{readyDays} gg)
                                                            </span>
                                                        )}
                                                    </td>
                                                    <td className="p-2 text-right font-mono font-bold">{Math.round(item.quantita)}</td>
                                                    <td className="p-2 text-right">
                                                        <input
                                                            type="number"
                                                            min={1}
                                                            max={Math.round(item.quantita)}
                                                            disabled={!isSelected}
                                                            value={isSelected ? selectedForTransfer[key] : ''}
                                                            onChange={e =>
                                                                setSelectedForTransfer(prev => ({
                                                                    ...prev,
                                                                    [key]: parseInt(e.target.value, 10) || 0,
                                                                }))
                                                            }
                                                            className="w-20 bg-brew-dark p-1.5 rounded border border-slate-600 text-right font-mono disabled:opacity-40"
                                                        />
                                                    </td>
                                                    <td className="p-2 text-right">
                                                        <button
                                                            type="button"
                                                            onClick={() => openWasteModal(item, 'OSSIDAZIONE_DIFETTO')}
                                                            className="text-xs text-rose-400 hover:text-rose-300 underline"
                                                            title="Segnala difetto/rottura già in cella birrificio"
                                                        >
                                                            Scarta
                                                        </button>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>

                    <div className="lg:col-span-5 bg-brew-dark-secondary p-4 rounded-lg border border-slate-700 space-y-3 h-fit">
                        <h3 className="text-lg font-bold text-brew-accent">
                            Compila DDT Trasferimento a Magazzino Centrale
                        </h3>
                        <p className="text-xs text-slate-400">
                            Genera il Documento di Trasporto A4 conforme DPR 472/96 (causale: trasferimento interno conto proprio), svuotando la Cella Birrificio e caricando il Magazzino Centrale Vendita.
                        </p>

                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="block text-xs text-slate-400 mb-1">Numero DDT *</label>
                                <input
                                    type="text"
                                    value={ddtNumber}
                                    onChange={e => setDdtNumber(e.target.value)}
                                    className="w-full bg-brew-dark p-2 rounded border border-slate-600 text-sm font-mono"
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-slate-400 mb-1">Data Trasporto *</label>
                                <input
                                    type="date"
                                    value={ddtDate}
                                    onChange={e => setDdtDate(e.target.value)}
                                    className="w-full bg-brew-dark p-2 rounded border border-slate-600 text-sm"
                                />
                            </div>
                        </div>

                        <div>
                            <label className="block text-xs text-slate-400 mb-1">Partenza (Cella Produzione Birrificio)</label>
                            <input
                                type="text"
                                value={ddtOrigin}
                                onChange={e => setDdtOrigin(e.target.value)}
                                className="w-full bg-brew-dark p-2 rounded border border-slate-600 text-sm"
                            />
                        </div>

                        <div>
                            <label className="block text-xs text-slate-400 mb-1">Destinazione (Magazzino Centrale Vendita)</label>
                            <input
                                type="text"
                                value={ddtDestination}
                                onChange={e => setDdtDestination(e.target.value)}
                                placeholder="Indirizzo deposito vendita..."
                                className="w-full bg-brew-dark p-2 rounded border border-slate-600 text-sm"
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="block text-xs text-slate-400 mb-1">Mezzo di Trasporto</label>
                                <input
                                    type="text"
                                    value={ddtVehicle}
                                    onChange={e => setDdtVehicle(e.target.value)}
                                    className="w-full bg-brew-dark p-2 rounded border border-slate-600 text-sm"
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-slate-400 mb-1">Targa Camion / Furgone</label>
                                <input
                                    type="text"
                                    value={ddtPlate}
                                    onChange={e => setDdtPlate(e.target.value.toUpperCase())}
                                    placeholder="Es. GF 123 AB"
                                    className="w-full bg-brew-dark p-2 rounded border border-slate-600 text-sm font-mono"
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="block text-xs text-slate-400 mb-1">Conducente / Operatore</label>
                                <input
                                    type="text"
                                    value={ddtDriver}
                                    onChange={e => setDdtDriver(e.target.value)}
                                    className="w-full bg-brew-dark p-2 rounded border border-slate-600 text-sm"
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-slate-400 mb-1">Note / Bancali EPAL</label>
                                <input
                                    type="text"
                                    value={ddtNotes}
                                    onChange={e => setDdtNotes(e.target.value)}
                                    placeholder="Es. 2 bancali EPAL"
                                    className="w-full bg-brew-dark p-2 rounded border border-slate-600 text-sm"
                                />
                            </div>
                        </div>

                        <button
                            type="button"
                            onClick={handleCreateTransferDDT}
                            disabled={Object.keys(selectedForTransfer).length === 0}
                            className="w-full py-3 bg-brew-green hover:bg-opacity-90 disabled:bg-slate-700 disabled:text-slate-400 text-white font-bold rounded-md shadow flex items-center justify-center gap-2 transition-colors"
                        >
                            <DocumentTextIcon className="w-5 h-5" />
                            Trasferisci a Magazzino Centrale & Stampa DDT A4
                        </button>
                    </div>
                </div>
            )}

            {/* TAB 3: STORICO DDT TRASFERIMENTI & REGISTRO SCARTI */}
            {activeTab === 'LOGS' && (
                <div className="space-y-6">
                    <div className="bg-brew-dark-secondary p-4 rounded-lg border border-slate-700">
                        <h2 className="text-xl font-bold text-brew-accent mb-3">
                            Storico DDT Trasferimenti Interni (Birrificio ➔ Magazzino Centrale)
                        </h2>
                        {transfers.length === 0 ? (
                            <p className="text-sm text-slate-400 py-4">Nessun DDT di trasferimento interno registrato nell&apos;anno {selectedYear}.</p>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm text-left text-gray-300 tabular-nums">
                                    <thead className="text-xs uppercase bg-slate-700 text-brew-light">
                                        <tr>
                                            <th className="p-2">N. DDT & Data</th>
                                            <th className="p-2">Tratta & Mezzo</th>
                                            <th className="p-2">Lotti Trasferiti</th>
                                            <th className="p-2 text-right">Volume Tot.</th>
                                            <th className="p-2 text-right">Azioni</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {transfers.map(tr => {
                                            const totL = tr.items.reduce((s, i) => s + i.litri, 0);
                                            return (
                                                <tr key={tr.id} className="border-b border-slate-700/60">
                                                    <td className="p-2">
                                                        {inlineEditTransferId === tr.id ? (
                                                            <div className="flex items-center gap-1 mb-1">
                                                                <input
                                                                    type="text"
                                                                    value={inlineTransferDdtVal}
                                                                    onChange={e => setInlineTransferDdtVal(e.target.value)}
                                                                    onKeyDown={e => {
                                                                        if (e.key === 'Enter') handleSaveInlineTransferDdt(tr);
                                                                        if (e.key === 'Escape') {
                                                                            setInlineEditTransferId(null);
                                                                            setInlineTransferDdtVal('');
                                                                        }
                                                                    }}
                                                                    className="w-28 bg-brew-dark border border-emerald-500 rounded px-1.5 py-0.5 text-xs font-mono text-white"
                                                                    autoFocus
                                                                />
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleSaveInlineTransferDdt(tr)}
                                                                    className="px-1.5 py-0.5 rounded bg-emerald-600 text-white text-[11px] font-bold"
                                                                >
                                                                    Salva
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => setInlineEditTransferId(null)}
                                                                    className="px-1.5 py-0.5 rounded bg-slate-600 text-white text-[11px]"
                                                                >
                                                                    Annulla
                                                                </button>
                                                            </div>
                                                        ) : (
                                                            <div className="flex items-center gap-1.5">
                                                                <div className="font-bold text-white font-mono">{tr.numeroDdt}</div>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => {
                                                                        setInlineEditTransferId(tr.id);
                                                                        setInlineTransferDdtVal(tr.numeroDdt || '');
                                                                    }}
                                                                    className="text-[10px] text-sky-300 hover:text-sky-200 underline"
                                                                >
                                                                    Modifica N°
                                                                </button>
                                                            </div>
                                                        )}
                                                        <div className="text-xs text-slate-400">{tr.data}</div>
                                                    </td>
                                                    <td className="p-2 text-xs">
                                                        <div className="text-slate-200">{tr.indirizzoDestinazione}</div>
                                                        <div className="text-slate-400">
                                                            {tr.mezzoTrasporto} {tr.targaMezzo ? `· Targa ${tr.targaMezzo}` : ''}
                                                        </div>
                                                    </td>
                                                    <td className="p-2 text-xs">
                                                        {tr.items.map((it, i) => (
                                                            <div key={i}>
                                                                {it.quantita}x {it.nomeBirra} ({it.formato}) — Lotto <strong>{it.lotto}</strong>
                                                            </div>
                                                        ))}
                                                    </td>
                                                    <td className="p-2 text-right font-mono font-bold text-emerald-400">
                                                        {totL.toFixed(1)} L
                                                    </td>
                                                    <td className="p-2 text-right">
                                                        <div className="flex justify-end gap-2">
                                                            <button
                                                                type="button"
                                                                onClick={() => printInternalTransferDdtA4(tr, profile)}
                                                                className="px-2 py-1 text-xs font-semibold border border-emerald-500/70 text-emerald-300 rounded flex items-center gap-1"
                                                            >
                                                                <DocumentTextIcon className="w-3.5 h-3.5" /> Ristampa DDT
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() => handleDeleteTransferDDT(tr)}
                                                                className="p-1 text-rose-400 hover:text-rose-300"
                                                                title="Annulla DDT e riporta merce in Cella Birrificio"
                                                            >
                                                                <TrashIcon className="w-4 h-4" />
                                                            </button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>

                    <div className="bg-brew-dark-secondary p-4 rounded-lg border border-slate-700">
                        <div className="flex justify-between items-baseline mb-3">
                            <div>
                                <h2 className="text-xl font-bold text-rose-400">
                                    Registro Lotti Scartati / Scaduti / Contestati (Esclusi dalle Vendite)
                                </h2>
                                <p className="text-xs text-slate-400">
                                    Utile anche ai fini della distruzione fiscale / verbale ADM e controllo qualità HACCP.
                                </p>
                            </div>
                            <div className="font-mono font-bold text-rose-400 text-lg tabular-nums">
                                Totale Scartato: {totalWastedLiters.toFixed(1)} L
                            </div>
                        </div>
                        {wasteMovements.length === 0 ? (
                            <p className="text-sm text-slate-400 py-4">Nessuno scarto o distruzione registrata nell&apos;anno {selectedYear}.</p>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm text-left text-gray-300 tabular-nums">
                                    <thead className="text-xs uppercase bg-slate-700 text-brew-light">
                                        <tr>
                                            <th className="p-2">DDT Scarto &amp; Data</th>
                                            <th className="p-2">Birra &amp; Lotto</th>
                                            <th className="p-2">Formato</th>
                                            <th className="p-2">Causale Scarto</th>
                                            <th className="p-2 text-right">Unità</th>
                                            <th className="p-2 text-right">Litri Scartati</th>
                                            <th className="p-2 text-right">Azioni DDT</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {wasteMovements.map(m => {
                                            const liters = Math.abs(m.quantita) * getUnitLiters(m.formato);
                                            return (
                                                <tr key={m.id} className="border-b border-slate-700/60">
                                                    <td className="p-2 font-mono">
                                                        {inlineEditWasteId === m.id ? (
                                                            <div className="flex items-center gap-1 mb-1">
                                                                <input
                                                                    type="text"
                                                                    value={inlineWasteDdtVal}
                                                                    onChange={e => setInlineWasteDdtVal(e.target.value)}
                                                                    onKeyDown={e => {
                                                                        if (e.key === 'Enter') handleSaveInlineWasteDdt(m.id);
                                                                        if (e.key === 'Escape') {
                                                                            setInlineEditWasteId(null);
                                                                            setInlineWasteDdtVal('');
                                                                        }
                                                                    }}
                                                                    className="w-28 bg-brew-dark border border-rose-500 rounded px-1.5 py-0.5 text-xs font-mono text-white"
                                                                    autoFocus
                                                                />
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleSaveInlineWasteDdt(m.id)}
                                                                    className="px-1.5 py-0.5 rounded bg-rose-600 text-white text-[11px] font-bold"
                                                                >
                                                                    Salva
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => setInlineEditWasteId(null)}
                                                                    className="px-1.5 py-0.5 rounded bg-slate-600 text-white text-[11px]"
                                                                >
                                                                    Annulla
                                                                </button>
                                                            </div>
                                                        ) : (
                                                            <div className="flex items-center gap-1.5">
                                                                <div className="font-bold text-rose-300">{m.ddtNumber || '-'}</div>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => {
                                                                        setInlineEditWasteId(m.id);
                                                                        setInlineWasteDdtVal(m.ddtNumber || '');
                                                                    }}
                                                                    className="text-[10px] text-sky-300 hover:text-sky-200 underline font-sans"
                                                                >
                                                                    Modifica N°
                                                                </button>
                                                            </div>
                                                        )}
                                                        <div className="text-xs text-slate-400">{m.data}</div>
                                                    </td>
                                                    <td className="p-2">
                                                        <div className="font-bold text-white">{m.nomeBirra}</div>
                                                        <div className="text-xs text-slate-400">
                                                            Lotto {m.lotto} · {m.cliente}
                                                        </div>
                                                    </td>
                                                    <td className="p-2">{m.formato}</td>
                                                    <td className="p-2 text-xs">
                                                        <div className="text-rose-300 font-semibold">
                                                            {m.wasteReason ? WASTE_REASON_LABELS[m.wasteReason] : 'Scarto / Contestazione'}
                                                        </div>
                                                        {m.notes && <div className="text-slate-400">{m.notes}</div>}
                                                    </td>
                                                    <td className="p-2 text-right font-mono">{Math.abs(m.quantita)}</td>
                                                    <td className="p-2 text-right font-mono font-bold text-rose-400">
                                                        {liters.toFixed(1)} L
                                                    </td>
                                                    <td className="p-2 text-right">
                                                        <div className="flex justify-end gap-2">
                                                            <button
                                                                type="button"
                                                                onClick={() => printWasteDdtA4(m, profile)}
                                                                className="px-2 py-1 text-xs font-semibold border border-rose-500/60 text-rose-300 hover:bg-rose-500/10 rounded flex items-center gap-1"
                                                                title="Stampa DDT Scarto Prodotto in A4"
                                                            >
                                                                <DocumentTextIcon className="w-3.5 h-3.5" /> DDT A4
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() => handleDeleteWasteMovement(m.id)}
                                                                className="p-1 text-slate-400 hover:text-white"
                                                                title="Annulla scarto e ripristina in magazzino"
                                                            >
                                                                <TrashIcon className="w-4 h-4" />
                                                            </button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {isInitialModalOpen && (
                <InitialBeerStockModal
                    selectedYear={selectedYear}
                    onClose={() => {
                        setIsInitialModalOpen(false);
                        loadAll();
                    }}
                />
            )}

            {/* Modal Gestione Promo TMC / Lotto Contestato Bloccato */}
            {statusModalItem && (
                <Modal
                    title={`Gestione Stato Lotto ${statusModalItem.lotto} — ${statusModalItem.nomeBirra}`}
                    isOpen={Boolean(statusModalItem)}
                    onClose={() => setStatusModalItem(null)}
                    size="md"
                >
                    <div className="space-y-4 text-sm text-slate-200">
                        <div className="p-3 bg-brew-dark rounded border border-slate-700 text-xs text-slate-300">
                            La birra riporta in etichetta il <strong>TMC (&ldquo;Da consumarsi preferibilmente entro&rdquo;)</strong>: in prossimità o superamento del TMC non costituisce rischio sanitario ma può perdere freschezza organolettica. Qui puoi attivare un <strong>Prezzo Promozionale TMC</strong> (applicato in automatico negli Ordini Birra Confezionata) oppure <strong>bloccare il lotto</strong> se ossidato o contestato.
                        </div>

                        <div>
                            <label className="block text-xs text-slate-400 mb-1">Stato Operativo del Lotto</label>
                            <select
                                value={statusForm.status}
                                onChange={e =>
                                    setStatusForm(prev => ({
                                        ...prev,
                                        status: e.target.value as 'REGOLARE' | 'PROMO_TMC' | 'CONTESTATO_BLOCCATO',
                                    }))
                                }
                                className="w-full bg-brew-dark p-2 rounded border border-slate-600"
                            >
                                <option value="REGOLARE">Regolare — Vendibile a listino standard</option>
                                <option value="PROMO_TMC">In Scadenza / TMC — Vendita Promozionale Scontata</option>
                                <option value="CONTESTATO_BLOCCATO">LOTTO CONTESTATO / OSSIDATO — Blocca vendita</option>
                            </select>
                        </div>

                        {statusForm.status === 'PROMO_TMC' && (
                            <div>
                                <label className="block text-xs text-slate-400 mb-1">
                                    Prezzo Unitario Scontato per {statusModalItem.formato} (€ IVA escl.) *
                                </label>
                                <input
                                    type="text"
                                    value={statusForm.promoPrice}
                                    onChange={e => setStatusForm(prev => ({ ...prev, promoPrice: e.target.value }))}
                                    placeholder="Es. 1.80"
                                    className="w-full bg-brew-dark p-2 rounded border border-slate-600 font-mono"
                                />
                            </div>
                        )}

                        <div>
                            <label className="block text-xs text-slate-400 mb-1">Note Qualità / Motivo (es. Lotto ossidato, promo fiera)</label>
                            <input
                                type="text"
                                value={statusForm.note}
                                onChange={e => setStatusForm(prev => ({ ...prev, note: e.target.value }))}
                                placeholder="Annotazione interna..."
                                className="w-full bg-brew-dark p-2 rounded border border-slate-600"
                            />
                        </div>

                        <div className="flex justify-end gap-3 pt-2">
                            <button
                                type="button"
                                onClick={() => setStatusModalItem(null)}
                                className="px-4 py-2 bg-slate-600 rounded font-semibold"
                            >
                                Annulla
                            </button>
                            <button
                                type="button"
                                onClick={handleSaveLotStatus}
                                className="px-4 py-2 bg-brew-accent text-brew-dark rounded font-bold"
                            >
                                Salva Impostazione Lotto
                            </button>
                        </div>
                    </div>
                </Modal>
            )}

            {/* Modal Scarico a Scarto / Distruzione (Litri Scartati, MAI Venduti) */}
            {wasteModalItem && (
                <Modal
                    title={`Scarico a Scarto / Distruzione — Lotto ${wasteModalItem.lotto}`}
                    isOpen={Boolean(wasteModalItem)}
                    onClose={() => setWasteModalItem(null)}
                    size="md"
                >
                    <div className="space-y-4 text-sm text-slate-200">
                        <div className="p-3 bg-rose-950/40 border border-rose-500/70 rounded text-xs text-rose-200">
                            <strong>Separazione Fiscale & Statistica Garantita:</strong> le unità scaricate qui vengono tolte dalla giacenza di magazzino e registrate esclusivamente nel contatore <strong>Litri Scartati / Scaduti / Contestati</strong>. Non verranno <strong>mai</strong> sommate ai Litri Venduti.
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            <div>
                                <label className="block text-xs text-slate-400 mb-1">
                                    Quantità da Scartare (max {Math.round(wasteModalItem.quantita)} pz) *
                                </label>
                                <input
                                    type="number"
                                    min={1}
                                    max={Math.round(wasteModalItem.quantita)}
                                    value={wasteForm.qty}
                                    onChange={e => setWasteForm(prev => ({ ...prev, qty: e.target.value }))}
                                    className="w-full bg-brew-dark p-2 rounded border border-slate-600 font-mono"
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-slate-400 mb-1">Data Operazione *</label>
                                <input
                                    type="date"
                                    value={wasteForm.date}
                                    onChange={e => setWasteForm(prev => ({ ...prev, date: e.target.value }))}
                                    className="w-full bg-brew-dark p-2 rounded border border-slate-600"
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-slate-400 mb-1">N° DDT Scarto</label>
                                <input
                                    type="text"
                                    value={wasteForm.ddtNumber}
                                    onChange={e => setWasteForm(prev => ({ ...prev, ddtNumber: e.target.value }))}
                                    placeholder={suggestedNextWasteDdt}
                                    className="w-full bg-brew-dark p-2 rounded border border-slate-600 font-mono text-rose-300"
                                />
                            </div>
                        </div>

                        <div>
                            <label className="block text-xs text-slate-400 mb-1">Causale Scarto / Non Conformità *</label>
                            <select
                                value={wasteForm.reason}
                                onChange={e =>
                                    setWasteForm(prev => ({ ...prev, reason: e.target.value as BeerWasteReason }))
                                }
                                className="w-full bg-brew-dark p-2 rounded border border-slate-600"
                            >
                                {(Object.keys(WASTE_REASON_LABELS) as BeerWasteReason[]).map(r => (
                                    <option key={r} value={r}>
                                        {WASTE_REASON_LABELS[r]}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div>
                            <label className="block text-xs text-slate-400 mb-1">Note / Estremi Verbale o Contestazione Cliente</label>
                            <input
                                type="text"
                                value={wasteForm.notes}
                                onChange={e => setWasteForm(prev => ({ ...prev, notes: e.target.value }))}
                                placeholder="Es. Lotto ossidato ritirato da cliente X, verbale smaltimento..."
                                className="w-full bg-brew-dark p-2 rounded border border-slate-600"
                            />
                        </div>

                        <div className="flex justify-end gap-3 pt-2">
                            <button
                                type="button"
                                onClick={() => setWasteModalItem(null)}
                                className="px-4 py-2 bg-slate-600 rounded font-semibold"
                            >
                                Annulla
                            </button>
                            <button
                                type="button"
                                onClick={handleConfirmWasteDischarge}
                                className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded font-bold"
                            >
                                Conferma Scarico a Scarto
                            </button>
                        </div>
                    </div>
                </Modal>
            )}
        </div>
    );
};