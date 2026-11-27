import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { getBreweryData, saveBreweryData, parseSteelKegFormat, DEFAULT_KEG_FLEET_CONFIG, getNextDdtNumber } from '../services/dataService';
import type {
    BeerMovement,
    BeerInventoryCheck,
    BeerInventoryCheckItem,
    BeerStockItem,
    BeerStorageLocation,
    KegMovementLog,
} from '../types';
import { useToast } from '../hooks/useToast';
import { CONFIG_PACKAGING } from '../constants';
import { PlusIcon } from './icons';
import { Modal } from './Modal';
import { computeDualLocationBeerStock } from '../utils/beerStockEngine';

interface BeerInventoryViewProps {
    selectedYear: string;
    onRefresh: () => void;
}

const MONTH_NAMES_FULL = [
    'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
    'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre',
];

type InventoryCheckMode = 'START_OF_MONTH' | 'YEAR_END_CLOSING';

const makeRowKey = (item: { location?: BeerStorageLocation; cliente: string; nomeBirra: string; lotto: string; formato: string }) =>
    `${item.location || 'MAGAZZINO_CENTRALE'}|${item.cliente}|${item.nomeBirra}|${item.lotto}|${item.formato}`;

const PastCheckItem: React.FC<{ check: BeerInventoryCheck }> = ({ check }) => {
    const [isOpen, setIsOpen] = useState(false);
    const activeRows = check.items.filter(
        i => i.discrepanza !== 0 || (i.resiContoVendita || 0) > 0 || (i.scartiRilevati || 0) > 0
    );
    const salesItems = check.items.filter(
        i => (i.location || 'MAGAZZINO_CENTRALE') === 'MAGAZZINO_CENTRALE' && i.discrepanza < 0
    );
    const totalSoldUnits = salesItems.reduce((acc, i) => acc + Math.abs(i.discrepanza), 0);
    const totalResiUnits = check.items.reduce((acc, i) => acc + (i.resiContoVendita || 0), 0);
    const totalScartiUnits = check.items.reduce((acc, i) => acc + (i.scartiRilevati || 0), 0);

    const isYearEnd = check.checkType === 'YEAR_END_CLOSING' || check.id.includes('CHIUSURA');

    const parts = check.date.split('/');
    let currentMonthLabel = '';
    let previousMonthLabel = '';
    if (parts.length === 3) {
        const day = Number(parts[0]);
        const month = Number(parts[1]);
        const year = Number(parts[2]);
        const invDate = new Date(year, month - 1, day);
        const prevMonthDate = new Date(year, month - 1, 0);
        currentMonthLabel = MONTH_NAMES_FULL[invDate.getMonth()] || '';
        previousMonthLabel = isYearEnd ? 'Dicembre' : (MONTH_NAMES_FULL[prevMonthDate.getMonth()] || '');
    }

    return (
        <div
            className={`rounded-xl border overflow-hidden shadow-md ${
                isYearEnd ? 'bg-brew-dark border-amber-500/60 ring-1 ring-amber-500/30' : 'bg-brew-dark border-slate-700'
            }`}
        >
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-full flex flex-col sm:flex-row sm:items-center justify-between p-3.5 text-left hover:bg-slate-700/40 transition-colors gap-2"
            >
                <div>
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-bold uppercase text-slate-300">
                            {isYearEnd ? 'Chiusura 31 Dicembre' : `Inizio Mese (${currentMonthLabel})`}
                        </span>
                        <span className="text-slate-500">·</span>
                        <span className="font-extrabold text-lg text-brew-accent">Controllo del {check.date}</span>
                        <span className="text-slate-500">·</span>
                        <span className="text-xs font-semibold text-emerald-300">
                            Vendite assegnate a: {isYearEnd ? 'Dicembre' : `${previousMonthLabel} (M-1)`}
                        </span>
                    </div>

                    <div className="text-xs text-slate-400 mt-1.5 flex flex-wrap items-center gap-3 font-mono tabular-nums">
                        <span>{activeRows.length} movimentazioni rilevate</span>
                        {totalSoldUnits > 0 && (
                            <span className="text-amber-300 font-semibold">· Vendite nette: {totalSoldUnits} pz</span>
                        )}
                        {totalResiUnits > 0 && (
                            <span className="text-sky-300 font-semibold">· Resi fiere/conto vendita: +{totalResiUnits} pz</span>
                        )}
                        {totalScartiUnits > 0 && (
                            <span className="text-rose-300 font-semibold">· Scarti rilevati: -{totalScartiUnits} pz</span>
                        )}
                    </div>
                </div>
                <span className={`transform transition-transform text-2xl text-slate-400 self-end sm:self-auto ${isOpen ? 'rotate-180' : ''}`}>
                    ▾
                </span>
            </button>

            {isOpen && (
                <div className="p-4 border-t border-slate-700/80 bg-brew-dark-secondary/40 space-y-3">
                    {activeRows.length > 0 ? (
                        <div className="overflow-x-auto rounded-lg border border-slate-700">
                            <table className="w-full text-xs tabular-nums">
                                <thead className="text-slate-300 bg-slate-800">
                                    <tr>
                                        <th className="p-2 text-left">Polo</th>
                                        <th className="p-2 text-left">Birra (Formato)</th>
                                        <th className="p-2 text-left">Lotto</th>
                                        <th className="p-2 text-right">Teorica</th>
                                        <th className="p-2 text-right">Resi Fiere</th>
                                        <th className="p-2 text-right">Scarti</th>
                                        <th className="p-2 text-right">Fisica</th>
                                        <th className="p-2 text-right">Esito Netto</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {activeRows.map((item, index) => (
                                        <tr key={index} className="border-t border-slate-700/60 hover:bg-slate-700/30">
                                            <td className="p-2 text-slate-300">
                                                {item.location === 'CELLA_BIRRIFICIO' ? 'Cella Birrificio' : 'Mag. Centrale'}
                                            </td>
                                            <td className="p-2 font-semibold">
                                                {item.nomeBirra} ({item.formato})
                                            </td>
                                            <td className="p-2 text-brew-accent font-mono">{item.lotto}</td>
                                            <td className="p-2 text-right font-mono">{item.quantitaCalcolata}</td>
                                            <td className="p-2 text-right font-mono text-sky-300">
                                                {item.resiContoVendita ? `+${item.resiContoVendita}` : '-'}
                                            </td>
                                            <td className="p-2 text-right font-mono text-rose-300">
                                                {item.scartiRilevati ? `-${item.scartiRilevati}` : '-'}
                                            </td>
                                            <td className="p-2 text-right font-mono font-bold text-white">{item.quantitaFisica}</td>
                                            <td
                                                className={`p-2 text-right font-mono font-bold ${
                                                    item.discrepanza < 0
                                                        ? 'text-amber-400'
                                                        : item.discrepanza > 0
                                                            ? 'text-emerald-400'
                                                            : 'text-slate-400'
                                                }`}
                                            >
                                                {item.discrepanza < 0
                                                    ? `${item.discrepanza} pz (${item.location === 'CELLA_BIRRIFICIO' ? 'Rettifica' : 'Vendita'})`
                                                    : item.discrepanza > 0
                                                        ? `+${item.discrepanza} pz`
                                                        : 'Allineato'}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <p className="text-sm text-slate-400 italic">
                            Nessuna discrepanza, reso o scarto rilevato in questo controllo.
                        </p>
                    )}
                </div>
            )}
        </div>
    );
};

interface ZeroStockCandidate {
    cliente: string;
    nomeBirra: string;
    lotto: string;
    formato: string;
    dataScadenza: string;
}

export const BeerInventoryView: React.FC<BeerInventoryViewProps> = ({ selectedYear, onRefresh }) => {
    const { showToast } = useToast();
    const [isLoading, setIsLoading] = useState(true);
    const [view, setView] = useState<'list' | 'check'>('list');
    const [checkMode, setCheckMode] = useState<InventoryCheckMode>('START_OF_MONTH');
    const [locationFilter, setLocationFilter] = useState<'ALL' | BeerStorageLocation>('ALL');

    const [stock, setStock] = useState<BeerStockItem[]>([]);
    const [zeroStockCandidates, setZeroStockCandidates] = useState<ZeroStockCandidate[]>([]);
    const [physicalCounts, setPhysicalCounts] = useState<Record<string, string>>({});
    const [looseBottleCounts, setLooseBottleCounts] = useState<Record<string, string>>({});
    const [resiCounts, setResiCounts] = useState<Record<string, string>>({});
    const [scartiCounts, setScartiCounts] = useState<Record<string, string>>({});
    const [pastChecks, setPastChecks] = useState<BeerInventoryCheck[]>([]);

    const [isAddReturnedLotModalOpen, setIsAddReturnedLotModalOpen] = useState(false);
    const [selectedZeroCandidateKey, setSelectedZeroCandidateKey] = useState('');
    const [returnedZeroQty, setReturnedZeroQty] = useState('1');

    const [checkDateInput, setCheckDateInput] = useState<string>(() => {
        const today = new Date();
        const y = today.getFullYear();
        const m = String(today.getMonth() + 1).padStart(2, '0');
        const d = String(today.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    });

    const loadData = useCallback(async () => {
        setIsLoading(true);
        const data = await getBreweryData(selectedYear);
        if (data) {
            setPastChecks(
                (data.BEER_INVENTORY_CHECKS || [])
                    .slice()
                    .sort(
                        (a, b) =>
                            new Date(b.date.split('/').reverse().join('-')).getTime() -
                            new Date(a.date.split('/').reverse().join('-')).getTime()
                    )
            );

            const dualStock = computeDualLocationBeerStock(data);
            const allRows = dualStock.allPositiveStock.map(i => ({
                ...i,
                location: i.location || 'MAGAZZINO_CENTRALE',
                quantita: Math.round(i.quantita),
            }));
            setStock(allRows);

            // Raccogli anche i lotti esauriti (giacenza 0) per permettere il rientro da fiere/conto vendita anche quando tutti i fusti erano usciti
            const existingKeys = new Set(
                allRows.map(r => `${r.cliente}|${r.nomeBirra}|${r.lotto}|${r.formato}`)
            );
            const lottoMap = new Map<string, { cliente: string; nomeBirra: string }>();
            (data.COTTE_HEAD || []).forEach(c =>
                lottoMap.set(c.LOTTO, { cliente: c.CLIENTE, nomeBirra: c.NOME_BIRRA })
            );
            const candidatesMap = new Map<string, ZeroStockCandidate>();
            (data.BEER_WAREHOUSE_INITIAL || []).forEach(init => {
                const k = `${init.cliente}|${init.nomeBirra}|${init.lotto}|${init.formato}`;
                if (!existingKeys.has(k)) {
                    candidatesMap.set(k, {
                        cliente: init.cliente,
                        nomeBirra: init.nomeBirra,
                        lotto: init.lotto,
                        formato: init.formato,
                        dataScadenza: init.dataScadenza || '',
                    });
                }
            });
            (data.CONFEZIONAMENTO || []).forEach(pkg => {
                const info = lottoMap.get(pkg.LOTTO_PROD);
                if (!info) return;
                const k = `${info.cliente}|${info.nomeBirra}|${pkg.LOTTO_PROD}|${pkg.FORMATO}`;
                if (!existingKeys.has(k)) {
                    candidatesMap.set(k, {
                        cliente: info.cliente,
                        nomeBirra: info.nomeBirra,
                        lotto: pkg.LOTTO_PROD,
                        formato: pkg.FORMATO,
                        dataScadenza: pkg.DATA_SCADENZA || '',
                    });
                }
            });
            setZeroStockCandidates(Array.from(candidatesMap.values()));

            const initialCounts: Record<string, string> = {};
            const initialLooseCounts: Record<string, string> = {};
            const initialResi: Record<string, string> = {};
            const initialScarti: Record<string, string> = {};

            allRows.forEach(item => {
                const key = makeRowKey(item);
                const config = CONFIG_PACKAGING[item.formato];
                if (config && item.formato.includes('BOTT') && config.pezziPerCartone > 0) {
                    initialCounts[key] = String(Math.floor(item.quantita / config.pezziPerCartone));
                    initialLooseCounts[key] = String(item.quantita % config.pezziPerCartone);
                } else {
                    initialCounts[key] = String(item.quantita);
                    initialLooseCounts[key] = '0';
                }
                initialResi[key] = '0';
                initialScarti[key] = '0';
            });

            setPhysicalCounts(initialCounts);
            setLooseBottleCounts(initialLooseCounts);
            setResiCounts(initialResi);
            setScartiCounts(initialScarti);
        }
        setIsLoading(false);
    }, [selectedYear]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const handleNumericInput = (
        setter: React.Dispatch<React.SetStateAction<Record<string, string>>>,
        key: string,
        value: string
    ) => {
        if (/^\d*$/.test(value)) {
            setter(prev => ({ ...prev, [key]: value }));
        }
    };

    const handleResiChange = (item: BeerStockItem, value: string) => {
        if (!/^\d*$/.test(value)) return;
        const key = makeRowKey(item);
        const prevResi = parseInt(resiCounts[key] || '0', 10) || 0;
        const nextResi = parseInt(value || '0', 10) || 0;
        const delta = nextResi - prevResi;

        setResiCounts(prev => ({ ...prev, [key]: value }));

        // Aggiorna comodamente anche il conteggio fisico suggerito se è un formato a pezzi singoli (es. fusti)
        const config = CONFIG_PACKAGING[item.formato];
        const isBottleFormat = Boolean(config && item.formato.includes('BOTT') && config.pezziPerCartone > 0);
        if (!isBottleFormat && delta !== 0) {
            const curPhys = parseInt(physicalCounts[key] || '0', 10) || 0;
            setPhysicalCounts(prev => ({ ...prev, [key]: String(Math.max(0, curPhys + delta)) }));
        }
    };

    const handleAddZeroStockReturnedLot = () => {
        if (!selectedZeroCandidateKey) {
            showToast('Seleziona il lotto rientrato da fiera / conto vendita.', 'error');
            return;
        }
        const qty = parseInt(returnedZeroQty, 10);
        if (isNaN(qty) || qty <= 0) {
            showToast('Inserisci una quantità rientrata maggiore di zero.', 'error');
            return;
        }
        const cand = zeroStockCandidates.find(
            c => `${c.cliente}|${c.nomeBirra}|${c.lotto}|${c.formato}` === selectedZeroCandidateKey
        );
        if (!cand) return;

        const newItem: BeerStockItem = {
            location: 'MAGAZZINO_CENTRALE',
            cliente: cand.cliente,
            nomeBirra: cand.nomeBirra,
            lotto: cand.lotto,
            formato: cand.formato,
            quantita: 0,
            dataScadenza: cand.dataScadenza,
        };
        const key = makeRowKey(newItem);
        const config = CONFIG_PACKAGING[newItem.formato];
        const isBottle = Boolean(config && newItem.formato.includes('BOTT') && config.pezziPerCartone > 0);

        setStock(prev => [newItem, ...prev]);
        setResiCounts(prev => ({ ...prev, [key]: String(qty) }));
        setScartiCounts(prev => ({ ...prev, [key]: '0' }));
        if (isBottle && config) {
            setPhysicalCounts(prev => ({ ...prev, [key]: String(Math.floor(qty / config.pezziPerCartone)) }));
            setLooseBottleCounts(prev => ({ ...prev, [key]: String(qty % config.pezziPerCartone) }));
        } else {
            setPhysicalCounts(prev => ({ ...prev, [key]: String(qty) }));
            setLooseBottleCounts(prev => ({ ...prev, [key]: '0' }));
        }

        setZeroStockCandidates(prev =>
            prev.filter(c => `${c.cliente}|${c.nomeBirra}|${c.lotto}|${c.formato}` !== selectedZeroCandidateKey)
        );
        setIsAddReturnedLotModalOpen(false);
        setSelectedZeroCandidateKey('');
        setReturnedZeroQty('1');
        showToast(
            `Lotto ${cand.lotto} aggiunto con +${qty} pz di Reso Conto Vendita / Fiera!`,
            'success'
        );
    };

    const startNewCheck = (mode: InventoryCheckMode) => {
        setCheckMode(mode);
        if (mode === 'YEAR_END_CLOSING') {
            setCheckDateInput(`${selectedYear}-12-31`);
        } else {
            const today = new Date();
            const y = today.getFullYear();
            const m = String(today.getMonth() + 1).padStart(2, '0');
            const d = String(today.getDate()).padStart(2, '0');
            setCheckDateInput(`${y}-${m}-${d}`);
        }
        loadData();
        setView('check');
    };

    const visibleStockRows = useMemo(() => {
        if (locationFilter === 'ALL') return stock;
        return stock.filter(s => (s.location || 'MAGAZZINO_CENTRALE') === locationFilter);
    }, [stock, locationFilter]);

    const handleSaveCheck = async () => {
        const adjustments: BeerMovement[] = [];
        const kegSyncLogs: KegMovementLog[] = [];
        const isYearEnd = checkMode === 'YEAR_END_CLOSING';

        let checkId: string;
        let formattedDate: string;
        let salesAttributedDate: string;

        if (isYearEnd) {
            checkId = `INV_${selectedYear}_12_CHIUSURA`;
            formattedDate = `31/12/${selectedYear}`;
            salesAttributedDate = `31/12/${selectedYear}`;
        } else {
            const [invY, invM, invD] = checkDateInput.split('-').map(Number);
            checkId = `INV_${invY}_${String(invM).padStart(2, '0')}`;
            formattedDate = `${String(invD).padStart(2, '0')}/${String(invM).padStart(2, '0')}/${invY}`;

            const prevMonthLastDay = new Date(invY, invM - 1, 0);
            salesAttributedDate = `${String(prevMonthLastDay.getDate()).padStart(2, '0')}/${String(
                prevMonthLastDay.getMonth() + 1
            ).padStart(2, '0')}/${prevMonthLastDay.getFullYear()}`;
        }

        const data = await getBreweryData(selectedYear);
        if (!data) return;

        const existingChecks = data.BEER_INVENTORY_CHECKS || [];
        if (existingChecks.some(c => c.id === checkId)) {
            const confirmMsg = isYearEnd
                ? `Esiste già un inventario di chiusura per l'anno ${selectedYear}. Vuoi sovrascriverlo?`
                : `Esiste già un controllo inventariale per questo periodo (${checkId}). Vuoi sovrascriverlo?`;
            if (!window.confirm(confirmMsg)) return;
        }

        const fleetCfg = data.KEG_FLEET_CONFIG || DEFAULT_KEG_FLEET_CONFIG;
        const checkItems: BeerInventoryCheckItem[] = [];

        const hasAnyScarti = stock.some(item => (parseInt(scartiCounts[makeRowKey(item)] || '0', 10) || 0) > 0);
        const existingWasteForCheck = (data.BEER_MOVEMENTS || []).find(
            m => m.relatedDocId === `INVENTORY_${checkId}` && m.type === 'WASTE' && m.ddtNumber && m.ddtSeqNumber
        );
        let wasteDdtNumber: string | undefined;
        let wasteDdtSeqNumber: number | undefined;
        if (hasAnyScarti) {
            if (existingWasteForCheck?.ddtNumber && existingWasteForCheck?.ddtSeqNumber) {
                wasteDdtNumber = existingWasteForCheck.ddtNumber;
                wasteDdtSeqNumber = existingWasteForCheck.ddtSeqNumber;
            } else {
                const nextWaste = getNextDdtNumber(data, selectedYear, 'WASTE');
                wasteDdtNumber = nextWaste.numeroDdt;
                wasteDdtSeqNumber = nextWaste.seq;
                data.DDT_COUNTERS = {
                    ...(data.DDT_COUNTERS || {}),
                    waste: Math.max(data.DDT_COUNTERS?.waste || 0, nextWaste.seq),
                };
            }
        }

        for (const item of stock) {
            const loc: BeerStorageLocation = item.location || 'MAGAZZINO_CENTRALE';
            const key = makeRowKey(item);
            const physicalCountInput = parseInt(physicalCounts[key] || '0', 10) || 0;
            const looseCountInput = parseInt(looseBottleCounts[key] || '0', 10) || 0;
            const resiUnits = parseInt(resiCounts[key] || '0', 10) || 0;
            const scartiUnits = parseInt(scartiCounts[key] || '0', 10) || 0;
            const calculatedQty = item.quantita;

            let physicalCountInUnits = physicalCountInput;
            const config = CONFIG_PACKAGING[item.formato];
            if (config && item.formato.includes('BOTT') && config.pezziPerCartone > 0) {
                physicalCountInUnits = physicalCountInput * config.pezziPerCartone + looseCountInput;
            }

            // Ricalibrazione: confrontiamo il fisico con (Teorica + Resi Fiere - Scarti Rilevati)
            const expectedAfterRecalibration = calculatedQty + resiUnits - scartiUnits;
            const netDifference = physicalCountInUnits - expectedAfterRecalibration;

            checkItems.push({
                location: loc,
                cliente: item.cliente,
                nomeBirra: item.nomeBirra,
                lotto: item.lotto,
                formato: item.formato,
                quantitaCalcolata: calculatedQty,
                resiContoVendita: resiUnits > 0 ? resiUnits : undefined,
                scartiRilevati: scartiUnits > 0 ? scartiUnits : undefined,
                quantitaFisica: physicalCountInUnits,
                discrepanza: netDifference,
            });

            const steelKegFmt = parseSteelKegFormat(item.formato);

            // 1. Movimento di rientro da Conto Vendita / Fiere (ricarica magazzino e storna dalle vendite globali!)
            if (resiUnits > 0) {
                adjustments.push({
                    id: `RESO_${Date.now()}_${adjustments.length}`,
                    data: salesAttributedDate,
                    type: 'RETURN_CONSIGNMENT',
                    location: loc,
                    cliente: item.cliente,
                    nomeBirra: item.nomeBirra,
                    lotto: item.lotto,
                    formato: item.formato,
                    quantita: resiUnits,
                    relatedDocId: `INVENTORY_${checkId}`,
                    notes: 'Ricalibrazione rientro merce non consumata da conto vendita / fiera',
                });

                // Se rientrano fusti inox PIENI non consumati, riallinea anche il Parco Fusti (non sono più fuori né sporchi)
                if (steelKegFmt && loc === 'MAGAZZINO_CENTRALE') {
                    kegSyncLogs.push(
                        {
                            id: `KEG_INV_RESO_IN_${checkId}_${kegSyncLogs.length}`,
                            data: formattedDate,
                            tipo: 'RIENTRO_VUOTO',
                            formato: steelKegFmt,
                            quantita: resiUnits,
                            cliente: 'CLIENTI VARI / CONTO VENDITA',
                            lotto: item.lotto,
                            relatedOrderId: `INVENTORY_${checkId}`,
                            note: `Rientro fusto pieno invenduto da fiera (${item.nomeBirra})`,
                        },
                        {
                            id: `KEG_INV_RESO_OK_${checkId}_${kegSyncLogs.length}`,
                            data: formattedDate,
                            tipo: 'LAVAGGIO_SANIFICAZIONE',
                            formato: steelKegFmt,
                            quantita: resiUnits,
                            relatedOrderId: `INVENTORY_${checkId}`,
                            note: 'Compensazione tecnica fusto rientrato pieno (non sporco)',
                        }
                    );
                }
            }

            // 2. Movimento di Scarto / Rottura rilevato in inventario (va nel monte Litri Scartati, MAI nelle vendite!)
            if (scartiUnits > 0) {
                adjustments.push({
                    id: `WASTE_INV_${Date.now()}_${adjustments.length}`,
                    data: salesAttributedDate,
                    type: 'WASTE',
                    location: loc,
                    cliente: item.cliente,
                    nomeBirra: item.nomeBirra,
                    lotto: item.lotto,
                    formato: item.formato,
                    quantita: -scartiUnits,
                    wasteReason: 'ROTTURA_PERDITA',
                    relatedDocId: `INVENTORY_${checkId}`,
                    ddtNumber: wasteDdtNumber,
                    ddtSeqNumber: wasteDdtSeqNumber,
                    notes: 'Scarto / rottura rilevata in sede di inventario',
                });
            }

            // 3. Differenza netta residua
            if (netDifference !== 0) {
                const isCentralSale = loc === 'MAGAZZINO_CENTRALE' && netDifference < 0;
                adjustments.push({
                    id: `ADJ_${Date.now()}_${adjustments.length}`,
                    data: isCentralSale ? salesAttributedDate : formattedDate,
                    type: isCentralSale ? 'SALE' : 'ADJUSTMENT',
                    location: loc,
                    cliente: item.cliente,
                    nomeBirra: item.nomeBirra,
                    lotto: item.lotto,
                    formato: item.formato,
                    quantita: netDifference,
                    relatedDocId: `INVENTORY_${checkId}`,
                });

                // Sincronizza il Parco Fusti Inox quando i fusti escono per differenza inventariale inizio mese!
                if (isCentralSale && steelKegFmt) {
                    const soldKegs = Math.abs(netDifference);
                    const unitDep = fleetCfg.find(f => f.formato === steelKegFmt)?.cauzioneUnitaria || 0;
                    kegSyncLogs.push({
                        id: `KEG_INV_OUT_${checkId}_${kegSyncLogs.length}`,
                        data: salesAttributedDate,
                        tipo: 'CONSEGNA_CLIENTE',
                        formato: steelKegFmt,
                        quantita: soldKegs,
                        cliente: 'CLIENTI VARI / CONTO VENDITA',
                        lotto: item.lotto,
                        relatedOrderId: `INVENTORY_${checkId}`,
                        cauzioneTotale: soldKegs * unitDep,
                        note: `Uscita fusti rilevata da Inventario (${item.nomeBirra})`,
                    });
                }
            }
        }

        const newCheck: BeerInventoryCheck = {
            id: checkId,
            date: formattedDate,
            items: checkItems,
            checkType: checkMode,
        };

        data.BEER_MOVEMENTS = [
            ...(data.BEER_MOVEMENTS || []).filter(mov => mov.relatedDocId !== `INVENTORY_${checkId}`),
            ...adjustments,
        ];
        data.BEER_INVENTORY_CHECKS = [
            ...existingChecks.filter(c => c.id !== checkId),
            newCheck,
        ];
        data.KEG_LOGS = [
            ...(data.KEG_LOGS || []).filter(k => k.relatedOrderId !== `INVENTORY_${checkId}`),
            ...kegSyncLogs,
        ];

        await saveBreweryData(selectedYear, data);

        if (isYearEnd) {
            showToast(
                `Inventario di Chiusura Fine Anno ${selectedYear} salvato! Vendite nette registrate su DICEMBRE e Parco Fusti sincronizzato.`,
                'success'
            );
        } else {
            const [invY, invM] = checkDateInput.split('-').map(Number);
            const prevMonthLastDay = new Date(invY, invM - 1, 0);
            const currentMonthName = MONTH_NAMES_FULL[invM - 1] || '';
            const prevMonthName = MONTH_NAMES_FULL[prevMonthLastDay.getMonth()] || '';
            showToast(
                `Controllo ${currentMonthName} salvato! Vendite nette attribuite a ${prevMonthName} (M-1), resi ricalibrati e Parco Fusti allineato.`,
                'success'
            );
        }

        setView('list');
        onRefresh();
        loadData();
    };

    if (isLoading) {
        return (
            <div className="p-8 text-center text-slate-400">
                <div className="w-8 h-8 border-2 border-brew-accent border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                <p>Caricamento inventario birra...</p>
            </div>
        );
    }

    if (view === 'list') {
        const hasYearEndCheck = pastChecks.some(
            c => c.checkType === 'YEAR_END_CLOSING' || c.id.includes('CHIUSURA')
        );

        return (
            <div className="bg-brew-dark-secondary p-4 rounded-xl shadow-lg space-y-4">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-slate-700 pb-3">
                    <div>
                        <h2 className="text-2xl font-black text-brew-accent tracking-wide">
                            Inventari Birra Confezionata — Anno {selectedYear}
                        </h2>
                        <p className="text-xs text-slate-400 mt-0.5">
                            Conteggio doppio polo (Magazzino Centrale Vendita + Cella Birrificio), ricalibrazione resi da fiere/conto vendita, scarti separati e sincronizzazione Parco Fusti Inox.
                        </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 self-start lg:self-auto">
                        <button
                            onClick={() => startNewCheck('START_OF_MONTH')}
                            className="flex items-center gap-2 bg-brew-green hover:bg-opacity-90 text-white font-extrabold py-2 px-3.5 rounded-lg shadow-md text-xs sm:text-sm"
                        >
                            <PlusIcon className="w-4 h-4" />
                            <span>Controllo Ordinario Inizio Mese</span>
                        </button>

                        <button
                            onClick={() => startNewCheck('YEAR_END_CLOSING')}
                            className={`flex items-center gap-2 font-black py-2 px-3.5 rounded-lg shadow-md text-xs sm:text-sm border ${
                                hasYearEndCheck
                                    ? 'bg-amber-900/60 text-amber-200 border-amber-600 hover:bg-amber-800'
                                    : 'bg-amber-600 hover:bg-amber-500 text-white border-amber-400'
                            }`}
                        >
                            <span>{hasYearEndCheck ? 'Aggiorna Chiusura 31 Dicembre' : 'Chiusura Fine Anno (31 Dicembre)'}</span>
                        </button>
                    </div>
                </div>

                {pastChecks.length > 0 ? (
                    <div className="space-y-3">
                        {pastChecks.map(check => (
                            <PastCheckItem key={check.id} check={check} />
                        ))}
                    </div>
                ) : (
                    <div className="p-8 text-center text-slate-400 bg-brew-dark rounded-xl border border-slate-700">
                        <p className="font-bold text-slate-300">
                            Nessun controllo inventariale salvato per l&apos;anno {selectedYear}.
                        </p>
                        <p className="text-xs mt-1">
                            Avvia un controllo il primo lunedì del mese per contare entrambi i magazzini, registrare eventuali fusti rientrati da fiere/conto vendita e calcolare le vendite nette.
                        </p>
                    </div>
                )}
            </div>
        );
    }

    const isYearEnd = checkMode === 'YEAR_END_CLOSING';
    const [previewY, previewM] = checkDateInput.split('-').map(Number);
    const prevMonthDate = new Date(previewY, previewM - 1, 0);
    const currentMonthLabel = MONTH_NAMES_FULL[previewM - 1] || '';
    const previousMonthLabel = isYearEnd ? 'Dicembre' : (MONTH_NAMES_FULL[prevMonthDate.getMonth()] || '');

    const centralCount = stock.filter(s => (s.location || 'MAGAZZINO_CENTRALE') === 'MAGAZZINO_CENTRALE').length;
    const breweryCellarCount = stock.filter(s => s.location === 'CELLA_BIRRIFICIO').length;

    return (
        <div className="bg-brew-dark-secondary p-4 rounded-xl shadow-lg space-y-4">
            {/* Top Bar */}
            <div className="p-4 rounded-xl border bg-brew-dark border-slate-700 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div>
                    <h2 className="text-2xl font-black text-brew-accent">
                        {isYearEnd
                            ? `Inventario di Chiusura Fine Anno — 31/12/${selectedYear}`
                            : `Controllo Inventario Inizio Mese (${currentMonthLabel})`}
                    </h2>
                    <p className="text-xs text-slate-300 mt-1">
                        Vendite nette del Magazzino Centrale attribuite a:{' '}
                        <strong className="text-emerald-400">
                            {isYearEnd ? 'DICEMBRE' : `${previousMonthLabel} (M-1)`}
                        </strong>{' '}
                        · I <strong>Resi Conto Vendita / Fiere</strong> ricaricano il magazzino e stornano i fusti rientrati non consumati · Gli <strong>Scarti</strong> vanno nel monte Litri Scartati.
                    </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    <div className="inline-flex rounded-lg bg-brew-dark-secondary p-1 border border-slate-700 text-xs">
                        <button
                            type="button"
                            onClick={() => {
                                setCheckMode('START_OF_MONTH');
                                const today = new Date();
                                setCheckDateInput(today.toISOString().slice(0, 10));
                            }}
                            className={`px-2.5 py-1 rounded-md font-semibold ${
                                !isYearEnd ? 'bg-brew-green text-white' : 'text-slate-400 hover:text-white'
                            }`}
                        >
                            Inizio Mese (M-1)
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                setCheckMode('YEAR_END_CLOSING');
                                setCheckDateInput(`${selectedYear}-12-31`);
                            }}
                            className={`px-2.5 py-1 rounded-md font-semibold ${
                                isYearEnd ? 'bg-amber-600 text-white' : 'text-slate-400 hover:text-white'
                            }`}
                        >
                            Chiusura 31/12
                        </button>
                    </div>

                    <div className="flex items-center gap-1.5 bg-brew-dark-secondary p-1.5 px-2.5 rounded-lg border border-slate-700">
                        <label className="text-xs font-bold text-slate-300">Data:</label>
                        <input
                            type="date"
                            value={checkDateInput}
                            onChange={e => setCheckDateInput(e.target.value)}
                            disabled={isYearEnd}
                            className="bg-brew-dark border border-slate-600 rounded px-2 py-0.5 text-xs text-white font-mono"
                        />
                    </div>
                </div>
            </div>

            {/* Polo Filter + Add Returned Zero-Stock Lot Button */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-1 p-1 bg-brew-dark rounded-lg border border-slate-700">
                    <button
                        type="button"
                        onClick={() => setLocationFilter('ALL')}
                        className={`px-3 py-1.5 text-xs font-semibold rounded-md ${
                            locationFilter === 'ALL'
                                ? 'bg-brew-accent text-brew-dark'
                                : 'text-slate-300 hover:text-white'
                        }`}
                    >
                        Tutti i Magazzini ({stock.length})
                    </button>
                    <button
                        type="button"
                        onClick={() => setLocationFilter('MAGAZZINO_CENTRALE')}
                        className={`px-3 py-1.5 text-xs font-semibold rounded-md ${
                            locationFilter === 'MAGAZZINO_CENTRALE'
                                ? 'bg-emerald-500 text-brew-dark'
                                : 'text-slate-300 hover:text-white'
                        }`}
                    >
                        Magazzino Centrale Vendita ({centralCount})
                    </button>
                    <button
                        type="button"
                        onClick={() => setLocationFilter('CELLA_BIRRIFICIO')}
                        className={`px-3 py-1.5 text-xs font-semibold rounded-md ${
                            locationFilter === 'CELLA_BIRRIFICIO'
                                ? 'bg-sky-400 text-brew-dark'
                                : 'text-slate-300 hover:text-white'
                        }`}
                    >
                        Cella Birrificio Rifermentazione ({breweryCellarCount})
                    </button>
                </div>

                {zeroStockCandidates.length > 0 && (
                    <button
                        type="button"
                        onClick={() => setIsAddReturnedLotModalOpen(true)}
                        className="px-3 py-1.5 bg-sky-700 hover:bg-sky-600 text-white text-xs font-bold rounded-lg border border-sky-500 flex items-center gap-1.5"
                        title="Usa questo pulsante se un lotto era andato a giacenza zero il mese scorso (es. fiera) e questo mese sono rientrati fusti pieni invenduti"
                    >
                        <PlusIcon className="w-4 h-4" />
                        Rientro Fusti da Fiera su Lotto a Giacenza 0
                    </button>
                )}
            </div>

            {/* Card Conteggio Touch per Smartphone (< md) */}
            <div className="md:hidden space-y-3">
                {visibleStockRows.map(item => {
                    const loc: BeerStorageLocation = item.location || 'MAGAZZINO_CENTRALE';
                    const key = makeRowKey(item);
                    const physicalCountInput = parseInt(physicalCounts[key] || '0', 10) || 0;
                    const looseCountInput = parseInt(looseBottleCounts[key] || '0', 10) || 0;
                    const resiUnits = parseInt(resiCounts[key] || '0', 10) || 0;
                    const scartiUnits = parseInt(scartiCounts[key] || '0', 10) || 0;

                    const config = CONFIG_PACKAGING[item.formato];
                    const isBottleFormat = Boolean(
                        config && item.formato.includes('BOTT') && config.pezziPerCartone > 0
                    );
                    const physicalCountInUnits = isBottleFormat
                        ? physicalCountInput * config.pezziPerCartone + looseCountInput
                        : physicalCountInput;

                    const expectedAfterRecalibration = item.quantita + resiUnits - scartiUnits;
                    const netDifference = physicalCountInUnits - expectedAfterRecalibration;
                    const calcCartons = isBottleFormat
                        ? Math.floor(item.quantita / config.pezziPerCartone)
                        : 0;
                    const calcLoose = isBottleFormat ? item.quantita % config.pezziPerCartone : 0;

                    return (
                        <div
                            key={`mobile-${key}`}
                            className="bg-brew-dark border border-slate-700 rounded-xl p-3.5 space-y-3 shadow"
                        >
                            <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                        <span
                                            className={`text-[10px] px-2 py-0.5 rounded font-extrabold uppercase ${
                                                loc === 'CELLA_BIRRIFICIO'
                                                    ? 'bg-sky-900/70 text-sky-300 border border-sky-700/60'
                                                    : 'bg-emerald-900/70 text-emerald-300 border border-emerald-700/60'
                                            }`}
                                        >
                                            {loc === 'CELLA_BIRRIFICIO' ? 'Cella Birrificio' : 'Mag. Centrale'}
                                        </span>
                                        <span className="text-xs font-mono font-bold text-brew-accent">
                                            Lotto {item.lotto}
                                        </span>
                                    </div>
                                    <h3 className="font-bold text-white text-base mt-1 leading-tight">
                                        {item.nomeBirra}
                                    </h3>
                                    <div className="text-xs text-slate-400">
                                        {item.formato} · {item.cliente}
                                    </div>
                                </div>
                                <div className="text-right flex-shrink-0">
                                    <div className="text-[10px] uppercase text-slate-400 font-bold">
                                        Giac. Teorica
                                    </div>
                                    <div className="font-mono font-black text-base text-slate-100">
                                        {item.quantita} pz
                                    </div>
                                    {isBottleFormat && (
                                        <div className="text-[11px] font-mono text-slate-400">
                                            ({calcCartons} ct{calcLoose > 0 ? ` + ${calcLoose}` : ''})
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Conteggio Fisico Touch */}
                            <div className="p-2.5 rounded-lg bg-slate-900/70 border border-slate-700 space-y-2">
                                <div className="flex items-center justify-between">
                                    <span className="text-xs font-bold text-white">
                                        {isBottleFormat ? 'Q.tà Fisica Contata (Cartoni + Sfuse)' : 'Q.tà Fisica Contata (Pezzi)'}
                                    </span>
                                    {isBottleFormat && (
                                        <span className="text-xs font-mono font-bold text-cyan-300">
                                            = {physicalCountInUnits} pz
                                        </span>
                                    )}
                                </div>

                                {isBottleFormat ? (
                                    <div className="grid grid-cols-2 gap-2">
                                        <div className="space-y-1">
                                            <span className="text-[11px] text-slate-400 block">Cartoni</span>
                                            <div className="flex items-center gap-1">
                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        handleNumericInput(
                                                            setPhysicalCounts,
                                                            key,
                                                            String(Math.max(0, physicalCountInput - 1))
                                                        )
                                                    }
                                                    className="min-w-[40px] min-h-[42px] rounded-lg bg-slate-700 hover:bg-slate-600 text-white font-black text-lg"
                                                >
                                                    −
                                                </button>
                                                <input
                                                    type="text"
                                                    inputMode="numeric"
                                                    value={physicalCounts[key] ?? ''}
                                                    onChange={e =>
                                                        handleNumericInput(setPhysicalCounts, key, e.target.value)
                                                    }
                                                    className="w-full min-h-[42px] bg-brew-dark rounded-lg border border-slate-600 text-center font-mono font-bold text-white text-base"
                                                    placeholder="0"
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        handleNumericInput(
                                                            setPhysicalCounts,
                                                            key,
                                                            String(physicalCountInput + 1)
                                                        )
                                                    }
                                                    className="min-w-[40px] min-h-[42px] rounded-lg bg-slate-700 hover:bg-slate-600 text-white font-black text-lg"
                                                >
                                                    +
                                                </button>
                                            </div>
                                        </div>

                                        <div className="space-y-1">
                                            <span className="text-[11px] text-amber-300 block">Sfuse</span>
                                            <div className="flex items-center gap-1">
                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        handleNumericInput(
                                                            setLooseBottleCounts,
                                                            key,
                                                            String(Math.max(0, looseCountInput - 1))
                                                        )
                                                    }
                                                    className="min-w-[40px] min-h-[42px] rounded-lg bg-slate-700 hover:bg-slate-600 text-white font-black text-lg"
                                                >
                                                    −
                                                </button>
                                                <input
                                                    type="text"
                                                    inputMode="numeric"
                                                    value={looseBottleCounts[key] ?? ''}
                                                    onChange={e =>
                                                        handleNumericInput(setLooseBottleCounts, key, e.target.value)
                                                    }
                                                    className="w-full min-h-[42px] bg-brew-dark rounded-lg border border-slate-600 text-center font-mono font-bold text-amber-300 text-base"
                                                    placeholder="0"
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        handleNumericInput(
                                                            setLooseBottleCounts,
                                                            key,
                                                            String(looseCountInput + 1)
                                                        )
                                                    }
                                                    className="min-w-[40px] min-h-[42px] rounded-lg bg-slate-700 hover:bg-slate-600 text-white font-black text-lg"
                                                >
                                                    +
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex items-center gap-2">
                                        <button
                                            type="button"
                                            onClick={() =>
                                                handleNumericInput(
                                                    setPhysicalCounts,
                                                    key,
                                                    String(Math.max(0, physicalCountInput - 1))
                                                )
                                            }
                                            className="min-w-[48px] min-h-[44px] rounded-lg bg-slate-700 hover:bg-slate-600 text-white font-black text-xl"
                                        >
                                            −
                                        </button>
                                        <input
                                            type="text"
                                            inputMode="numeric"
                                            value={physicalCounts[key] ?? ''}
                                            onChange={e =>
                                                handleNumericInput(setPhysicalCounts, key, e.target.value)
                                            }
                                            className="flex-1 min-h-[44px] bg-brew-dark rounded-lg border border-slate-600 text-center font-mono font-black text-white text-lg"
                                        />
                                        <button
                                            type="button"
                                            onClick={() =>
                                                handleNumericInput(
                                                    setPhysicalCounts,
                                                    key,
                                                    String(physicalCountInput + 1)
                                                )
                                            }
                                            className="min-w-[48px] min-h-[44px] rounded-lg bg-slate-700 hover:bg-slate-600 text-white font-black text-xl"
                                        >
                                            +
                                        </button>
                                    </div>
                                )}
                            </div>

                            {/* Resi e Scarti */}
                            <div className="grid grid-cols-2 gap-2">
                                <div>
                                    <label className="block text-[11px] font-bold text-sky-300 mb-1">
                                        Resi Fiere (+Pz)
                                    </label>
                                    <input
                                        type="text"
                                        inputMode="numeric"
                                        value={resiCounts[key] ?? '0'}
                                        onChange={e => handleResiChange(item, e.target.value)}
                                        className="w-full min-h-[40px] bg-slate-900 rounded-lg border border-sky-700/80 text-center font-mono font-bold text-sky-300"
                                    />
                                </div>
                                <div>
                                    <label className="block text-[11px] font-bold text-rose-300 mb-1">
                                        Scarti / Rotture (-Pz)
                                    </label>
                                    <input
                                        type="text"
                                        inputMode="numeric"
                                        value={scartiCounts[key] ?? '0'}
                                        onChange={e => handleNumericInput(setScartiCounts, key, e.target.value)}
                                        className="w-full min-h-[40px] bg-slate-900 rounded-lg border border-rose-700/80 text-center font-mono font-bold text-rose-300"
                                    />
                                </div>
                            </div>

                            {/* Esito Ricalibrato */}
                            <div className="flex items-center justify-between pt-2 border-t border-slate-700/80 text-xs font-mono">
                                <span className="text-slate-400">Esito ricalibrato:</span>
                                <span
                                    className={`font-black ${
                                        netDifference < 0
                                            ? 'text-amber-400'
                                            : netDifference > 0
                                                ? 'text-emerald-400'
                                                : 'text-slate-400'
                                    }`}
                                >
                                    {netDifference < 0
                                        ? `${netDifference} pz (${
                                              loc === 'CELLA_BIRRIFICIO'
                                                  ? 'Rettifica Cella'
                                                  : `Vendita ${previousMonthLabel}`
                                          })`
                                        : netDifference > 0
                                            ? `+${netDifference} pz (Eccedenza)`
                                            : 'Allineato (0)'}
                                </span>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Tabella Conteggio & Ricalibrazione (Tablet landscape & Desktop >= md) */}
            <div className="hidden md:block overflow-x-auto max-h-[65vh] rounded-xl border border-slate-700">
                <table className="w-full text-sm text-left text-gray-300 tabular-nums">
                    <thead className="text-xs text-brew-dark uppercase bg-brew-accent sticky top-0 shadow">
                        <tr>
                            <th className="px-3 py-2.5">Magazzino</th>
                            <th className="px-3 py-2.5">Birra & Proprietà</th>
                            <th className="px-3 py-2.5">Lotto & Formato</th>
                            <th className="px-3 py-2.5 text-right">Giac. Teorica</th>
                            <th className="px-3 py-2.5 text-center">Resi Fiere / C.Vendita (+Pz)</th>
                            <th className="px-3 py-2.5 text-center">Scarti / Rotture (-Pz)</th>
                            <th className="px-3 py-2.5 text-center">Q.tà Fisica Contata</th>
                            <th className="px-3 py-2.5 text-right">Esito Ricalibrato</th>
                        </tr>
                    </thead>
                    <tbody>
                        {visibleStockRows.map(item => {
                            const loc: BeerStorageLocation = item.location || 'MAGAZZINO_CENTRALE';
                            const key = makeRowKey(item);
                            const physicalCountInput = parseInt(physicalCounts[key] || '0', 10) || 0;
                            const looseCountInput = parseInt(looseBottleCounts[key] || '0', 10) || 0;
                            const resiUnits = parseInt(resiCounts[key] || '0', 10) || 0;
                            const scartiUnits = parseInt(scartiCounts[key] || '0', 10) || 0;

                            const config = CONFIG_PACKAGING[item.formato];
                            const isBottleFormat = Boolean(
                                config && item.formato.includes('BOTT') && config.pezziPerCartone > 0
                            );
                            const physicalCountInUnits = isBottleFormat
                                ? physicalCountInput * config.pezziPerCartone + looseCountInput
                                : physicalCountInput;

                            const expectedAfterRecalibration = item.quantita + resiUnits - scartiUnits;
                            const netDifference = physicalCountInUnits - expectedAfterRecalibration;
                            const calcCartons = isBottleFormat
                                ? Math.floor(item.quantita / config.pezziPerCartone)
                                : 0;
                            const calcLoose = isBottleFormat ? item.quantita % config.pezziPerCartone : 0;

                            return (
                                <tr key={key} className="border-b border-slate-700/80 hover:bg-slate-700/30">
                                    <td className="px-3 py-2 text-xs">
                                        {loc === 'CELLA_BIRRIFICIO' ? (
                                            <span className="text-sky-300 font-bold">Cella Birrificio</span>
                                        ) : (
                                            <span className="text-emerald-300 font-bold">Mag. Centrale</span>
                                        )}
                                    </td>
                                    <td className="px-3 py-2">
                                        <div className="font-semibold text-white">{item.nomeBirra}</div>
                                        <div className="text-xs text-slate-400">{item.cliente}</div>
                                    </td>
                                    <td className="px-3 py-2">
                                        <div className="text-brew-accent font-mono font-bold">{item.lotto}</div>
                                        <div className="text-xs text-slate-300">{item.formato}</div>
                                    </td>
                                    <td className="px-3 py-2 text-right font-mono">
                                        <div className="font-bold text-slate-200">{item.quantita} pz</div>
                                        {isBottleFormat && (
                                            <div className="text-[11px] text-slate-400">
                                                ({calcCartons} ct{calcLoose > 0 ? ` + ${calcLoose}` : ''})
                                            </div>
                                        )}
                                    </td>
                                    <td className="px-3 py-2 text-center">
                                        <input
                                            type="text"
                                            value={resiCounts[key] ?? '0'}
                                            onChange={e => handleResiChange(item, e.target.value)}
                                            className="w-16 bg-brew-dark p-1 rounded border border-sky-700/80 text-center font-mono font-bold text-sky-300 focus:border-sky-400 focus:outline-none"
                                            title="Fusti o cartoni rientrati pieni invenduti da fiere / conto vendita (già contati come usciti nel mese precedente)"
                                        />
                                    </td>
                                    <td className="px-3 py-2 text-center">
                                        <input
                                            type="text"
                                            value={scartiCounts[key] ?? '0'}
                                            onChange={e => handleNumericInput(setScartiCounts, key, e.target.value)}
                                            className="w-16 bg-brew-dark p-1 rounded border border-rose-700/80 text-center font-mono font-bold text-rose-300 focus:border-rose-400 focus:outline-none"
                                            title="Bottiglie rotte o fusti difettosi (vanno in Litri Scartati, non in Vendite)"
                                        />
                                    </td>
                                    <td className="px-3 py-2 text-center">
                                        {isBottleFormat ? (
                                            <div className="flex flex-col items-center gap-1">
                                                <div className="flex items-center justify-center gap-1">
                                                    <input
                                                        type="text"
                                                        value={physicalCounts[key] ?? ''}
                                                        onChange={e =>
                                                            handleNumericInput(setPhysicalCounts, key, e.target.value)
                                                        }
                                                        className="w-14 bg-brew-dark p-1 rounded border border-slate-600 text-center font-mono font-bold text-white"
                                                        placeholder="0"
                                                    />
                                                    <span className="text-[11px] text-slate-400">ct+</span>
                                                    <input
                                                        type="text"
                                                        value={looseBottleCounts[key] ?? ''}
                                                        onChange={e =>
                                                            handleNumericInput(
                                                                setLooseBottleCounts,
                                                                key,
                                                                e.target.value
                                                            )
                                                        }
                                                        className="w-12 bg-brew-dark p-1 rounded border border-slate-600 text-center font-mono font-bold text-amber-300"
                                                        placeholder="0"
                                                    />
                                                </div>
                                                <span className="text-[11px] text-cyan-300 font-mono">
                                                    = {physicalCountInUnits} pz
                                                </span>
                                            </div>
                                        ) : (
                                            <input
                                                type="text"
                                                value={physicalCounts[key] ?? ''}
                                                onChange={e =>
                                                    handleNumericInput(setPhysicalCounts, key, e.target.value)
                                                }
                                                className="w-20 bg-brew-dark p-1 rounded border border-slate-600 text-center font-mono font-bold text-white"
                                            />
                                        )}
                                    </td>
                                    <td className="px-3 py-2 text-right text-xs font-mono">
                                        {resiUnits > 0 && (
                                            <div className="text-sky-300 font-semibold">+{resiUnits} pz Reso C.V.</div>
                                        )}
                                        {scartiUnits > 0 && (
                                            <div className="text-rose-300 font-semibold">-{scartiUnits} pz Scarto</div>
                                        )}
                                        <div
                                            className={`font-bold ${
                                                netDifference < 0
                                                    ? 'text-amber-400'
                                                    : netDifference > 0
                                                        ? 'text-emerald-400'
                                                        : 'text-slate-500'
                                            }`}
                                        >
                                            {netDifference < 0
                                                ? `${netDifference} pz (${
                                                      loc === 'CELLA_BIRRIFICIO'
                                                          ? 'Rettifica Cella'
                                                          : `Vendita ${previousMonthLabel}`
                                                  })`
                                                : netDifference > 0
                                                    ? `+${netDifference} pz (Eccedenza)`
                                                    : 'Allineato (0)'}
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            <div className="mt-4 flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
                <button
                    onClick={() => setView('list')}
                    className="w-full sm:w-auto min-h-[44px] px-4 py-2 rounded-lg bg-slate-700 font-bold hover:bg-slate-600 text-white"
                >
                    Annulla
                </button>
                <button
                    onClick={handleSaveCheck}
                    className={`w-full sm:w-auto min-h-[48px] px-6 py-3 rounded-lg font-black text-white text-sm sm:text-base shadow-xl ${
                        isYearEnd ? 'bg-amber-600 hover:bg-amber-500' : 'bg-brew-green hover:bg-opacity-90'
                    }`}
                >
                    {isYearEnd
                        ? 'Salva Chiusura Anno & Sincronizza Magazzini'
                        : `Salva Controllo Ricalibrato (${previousMonthLabel} M-1)`}
                </button>
            </div>

            {/* Modal Rientro Lotto Esaurito da Fiera */}
            {isAddReturnedLotModalOpen && (
                <Modal
                    title="Rientro Fusti / Colli da Fiera o Conto Vendita (Lotto a Giacenza 0)"
                    isOpen={isAddReturnedLotModalOpen}
                    onClose={() => setIsAddReturnedLotModalOpen(false)}
                    size="md"
                >
                    <div className="space-y-4 text-sm text-slate-200">
                        <p className="text-xs text-slate-300">
                            Se nel conteggio del mese scorso tutti i fusti di un lotto erano fuori in conto vendita / fiera (portando la giacenza a 0) e alcuni sono rientrati pieni invenduti, selezionalo qui per reinserirlo in Magazzino Centrale e stornare automaticamente la vendita in eccesso.
                        </p>
                        <div>
                            <label className="block text-xs text-slate-400 mb-1">Seleziona Lotto & Formato *</label>
                            <select
                                value={selectedZeroCandidateKey}
                                onChange={e => setSelectedZeroCandidateKey(e.target.value)}
                                className="w-full bg-brew-dark p-2 rounded border border-slate-600"
                            >
                                <option value="">Seleziona lotto storico...</option>
                                {zeroStockCandidates.map(c => {
                                    const k = `${c.cliente}|${c.nomeBirra}|${c.lotto}|${c.formato}`;
                                    return (
                                        <option key={k} value={k}>
                                            {c.nomeBirra} — Lotto {c.lotto} ({c.formato}) [{c.cliente}]
                                        </option>
                                    );
                                })}
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs text-slate-400 mb-1">
                                Unità Piene Rientrate in Magazzino Centrale *
                            </label>
                            <input
                                type="number"
                                min={1}
                                value={returnedZeroQty}
                                onChange={e => setReturnedZeroQty(e.target.value)}
                                className="w-full bg-brew-dark p-2 rounded border border-slate-600 font-mono"
                            />
                        </div>
                        <div className="flex justify-end gap-3 pt-2">
                            <button
                                type="button"
                                onClick={() => setIsAddReturnedLotModalOpen(false)}
                                className="px-4 py-2 bg-slate-600 rounded font-semibold"
                            >
                                Annulla
                            </button>
                            <button
                                type="button"
                                onClick={handleAddZeroStockReturnedLot}
                                className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded font-bold"
                            >
                                Aggiungi al Conteggio
                            </button>
                        </div>
                    </div>
                </Modal>
            )}
        </div>
    );
};