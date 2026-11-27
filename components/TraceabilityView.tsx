import React, { useState, useEffect, useMemo } from 'react';
import { getBreweryData, getAllBreweryData, getEffectiveBreweryProfile } from '../services/dataService';
import type {
    BreweryData,
    BrewHeader,
    Cliente,
    FermentationDataPoint,
    MaintenanceLog,
    Movement,
    PackagingData,
} from '../types';
import { CONFIG_PACKAGING } from '../constants';
import { calculateBrewMetrics, buildYeastGenealogy } from '../utils/brewingCalculations';
import {
    printHaccpLotDossierA4,
    printHaccpSupplierRecallA4,
    type HaccpDeliveryRecord,
} from '../utils/erpPrintAndXml';
import { ShieldCheckIcon, PrinterIcon, ArrowRightIcon } from './icons';

interface TraceabilityViewProps {
    selectedYear: string;
    onOpenLotto: (lottoId: string) => void;
}

type TraceMode = 'DOSSIER_LOTTO' | 'RICHIAMO_FORNITORE';
type ScopeMode = 'SELECTED_YEAR' | 'ALL_YEARS';

const MOCA_CATEGORIES = new Set(['BOTTIGLIE', 'FUSTI', 'CARTONI', 'TAPPI']);

const estimateFormatLiters = (format: string): number => {
    const upper = (format || '').toUpperCase().trim();
    if (CONFIG_PACKAGING[upper]) return CONFIG_PACKAGING[upper].litriUnit;
    if (upper.includes('33')) return 0.33;
    if (upper.includes('50')) return 0.5;
    if (upper.includes('75')) return 0.75;
    if (upper.includes('30')) return 30;
    if (upper.includes('24')) return 24;
    if (upper.includes('20')) return 20;
    if (upper.includes('5')) return 5;
    return 1;
};

const parseSortableItDate = (dateStr: string): number => {
    if (!dateStr) return 0;
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        return new Date(dateStr).getTime() || 0;
    }
    const parts = dateStr.split('/');
    if (parts.length === 3) {
        const [d, m, y] = parts.map(Number);
        if (!isNaN(d) && !isNaN(m) && !isNaN(y)) {
            return new Date(y, m - 1, d).getTime();
        }
    }
    return 0;
};

interface YearBrewEntry {
    year: string;
    header: BrewHeader;
}

interface SupplierLotSummary {
    key: string;
    lottoFornitore: string;
    nomeArticolo: string;
    tipologia: string;
    fornitore: string;
    totalLoaded: number;
    residualStock: number;
    impactedLotCount: number;
    lastReceiptDate: string;
}

export const TraceabilityView: React.FC<TraceabilityViewProps> = ({ selectedYear, onOpenLotto }) => {
    const [mode, setMode] = useState<TraceMode>('DOSSIER_LOTTO');
    const [scope, setScope] = useState<ScopeMode>('ALL_YEARS');
    const [dataByYear, setDataByYear] = useState<Record<string, BreweryData>>({});
    const [isLoading, setIsLoading] = useState(true);

    // Dossier Lotto state
    const [lotSearch, setLotSearch] = useState('');
    const [selectedBrewKey, setSelectedBrewKey] = useState<string>(''); // `${year}|${LOTTO}`

    // Richiamo Fornitore state
    const [supplierSearch, setSupplierSearch] = useState('');
    const [selectedSupplierLotCode, setSelectedSupplierLotCode] = useState<string>('');

    useEffect(() => {
        let active = true;
        const load = async () => {
            setIsLoading(true);
            if (scope === 'ALL_YEARS') {
                const all = await getAllBreweryData();
                if (active) setDataByYear(all);
            } else {
                const single = await getBreweryData(selectedYear);
                if (active) setDataByYear(single ? { [selectedYear]: single } : {});
            }
            if (active) setIsLoading(false);
        };
        load();
        return () => {
            active = false;
        };
    }, [selectedYear, scope]);

    const activeProfile = useMemo(() => {
        const currentYearData = dataByYear[selectedYear] || Object.values(dataByYear)[0];
        return getEffectiveBreweryProfile(currentYearData);
    }, [dataByYear, selectedYear]);

    const allCotteAcrossScope = useMemo<YearBrewEntry[]>(() => {
        const entries: YearBrewEntry[] = [];
        const sortedYears = Object.keys(dataByYear).sort((a, b) => b.localeCompare(a));
        sortedYears.forEach(yr => {
            const yd = dataByYear[yr];
            (yd?.COTTE_HEAD || []).forEach(h => {
                if (h.LOTTO) entries.push({ year: yr, header: h });
            });
        });
        entries.sort((a, b) => parseSortableItDate(b.header.DATA_PROD) - parseSortableItDate(a.header.DATA_PROD));
        return entries;
    }, [dataByYear]);

    const filteredBrews = useMemo(() => {
        const q = lotSearch.trim().toUpperCase();
        if (!q) return allCotteAcrossScope;
        return allCotteAcrossScope.filter(
            ({ year, header }) =>
                header.LOTTO.toUpperCase().includes(q) ||
                header.NOME_BIRRA.toUpperCase().includes(q) ||
                header.CLIENTE.toUpperCase().includes(q) ||
                year.includes(q)
        );
    }, [allCotteAcrossScope, lotSearch]);

    useEffect(() => {
        if (filteredBrews.length === 0) return;
        const exists = filteredBrews.some(b => `${b.year}|${b.header.LOTTO}` === selectedBrewKey);
        if (!exists) {
            const preferred =
                filteredBrews.find(b => b.year === selectedYear) || filteredBrews[0];
            setSelectedBrewKey(`${preferred.year}|${preferred.header.LOTTO}`);
        }
    }, [filteredBrews, selectedBrewKey, selectedYear]);

    const allBrewHeadersFlat = useMemo(
        () => allCotteAcrossScope.map(e => e.header),
        [allCotteAcrossScope]
    );

    const allClientsByName = useMemo(() => {
        const map = new Map<string, Cliente>();
        Object.values(dataByYear).forEach(yd => {
            (yd.CLIENTI || []).forEach(c => {
                map.set(c.nome.toUpperCase().trim(), c);
            });
        });
        return map;
    }, [dataByYear]);

    // Helper: collect all downstream deliveries for a target LOTTO across loaded years
    const collectDeliveriesForLot = useMemo(() => {
        return (targetLotto: string): Array<HaccpDeliveryRecord & { year: string; telefono?: string }> => {
            const normLot = targetLotto.toUpperCase().trim();
            if (!normLot) return [];
            const records: Array<HaccpDeliveryRecord & { year: string; telefono?: string }> = [];

            Object.entries(dataByYear).forEach(([yr, yd]) => {
                const coveredDocIds = new Set<string>();

                (yd.PACKAGED_BEER_ORDERS || []).forEach(order => {
                    coveredDocIds.add(order.id);
                    (order.items || []).forEach(it => {
                        if ((it.lotto || '').toUpperCase().trim() === normLot && it.quantity > 0) {
                            const clientInfo = allClientsByName.get(order.client.toUpperCase().trim());
                            records.push({
                                year: yr,
                                data: order.date,
                                cliente: order.client,
                                telefono: clientInfo?.numeroTelefono,
                                documento: order.invoiceNumber
                                    ? `Ordine DDT ${order.id} (Fatt. ${order.invoiceNumber})`
                                    : `Ordine DDT ${order.id}`,
                                formato: it.format,
                                quantita: it.quantity,
                                litri: it.quantity * estimateFormatLiters(it.format),
                            });
                        }
                    });
                });

                (yd.SALES_ORDERS || []).forEach(order => {
                    coveredDocIds.add(order.id);
                    (order.items || []).forEach(it => {
                        if ((it.lotto || '').toUpperCase().trim() === normLot && it.quantity > 0) {
                            const clientInfo = allClientsByName.get(order.client.toUpperCase().trim());
                            records.push({
                                year: yr,
                                data: order.date,
                                cliente: order.client,
                                telefono: clientInfo?.numeroTelefono,
                                documento: `Commissione / DDT ${order.id}`,
                                formato: it.format,
                                quantita: it.quantity,
                                litri: it.quantity * estimateFormatLiters(it.format),
                            });
                        }
                    });
                });

                (yd.BEER_MOVEMENTS || []).forEach(mov => {
                    if (
                        mov.type === 'SALE' &&
                        (mov.lotto || '').toUpperCase().trim() === normLot &&
                        (!mov.relatedDocId || !coveredDocIds.has(mov.relatedDocId))
                    ) {
                        const qty = Math.abs(mov.quantita);
                        const recipient = mov.destinatario || mov.cliente;
                        const clientInfo = allClientsByName.get((recipient || '').toUpperCase().trim());
                        records.push({
                            year: yr,
                            data: mov.data,
                            cliente: recipient,
                            telefono: clientInfo?.numeroTelefono,
                            documento: mov.relatedDocId ? `Scarico ${mov.relatedDocId}` : 'Scarico Cella',
                            formato: mov.formato,
                            quantita: qty,
                            litri: qty * estimateFormatLiters(mov.formato),
                        });
                    }
                });
            });

            records.sort((a, b) => parseSortableItDate(b.data) - parseSortableItDate(a.data));
            return records;
        };
    }, [dataByYear, allClientsByName]);

    // Selected Dossier Lot full computation
    const dossierData = useMemo(() => {
        if (!selectedBrewKey) return null;
        const [yr, ...lotParts] = selectedBrewKey.split('|');
        const lotto = lotParts.join('|');
        const yd = dataByYear[yr];
        const header = yd?.COTTE_HEAD.find(c => c.LOTTO === lotto);
        if (!yd || !header) return null;

        const normLot = lotto.toUpperCase().trim();

        // Collect movements across all loaded years matching LOTTO_PRODUZIONE (supports carried-over brews packaged in next year)
        const rawMaterials: Movement[] = [...(header.carriedOverIngredients || [])];
        const packagingMaterials: Movement[] = [];
        const fermentation: FermentationDataPoint[] = [];
        const packagingRuns: PackagingData[] = [];
        const cipLogs: MaintenanceLog[] = [];
        const stockByFormat = new Map<string, number>();

        Object.values(dataByYear).forEach(yearDb => {
            (yearDb.MOVIMENTAZIONE || []).forEach(m => {
                if ((m.LOTTO_PRODUZIONE || '').toUpperCase().trim() === normLot && m.KG_LITRI_PZ < 0) {
                    const cat = (m.TIPOLOGIA || '').toUpperCase().trim();
                    if (MOCA_CATEGORIES.has(cat)) {
                        packagingMaterials.push(m);
                    } else {
                        rawMaterials.push(m);
                    }
                }
            });

            (yearDb.FERMENTAZIONE || []).forEach(f => {
                if ((f.LOTTO || '').toUpperCase().trim() === normLot) {
                    fermentation.push(f);
                }
            });

            (yearDb.CONFEZIONAMENTO || []).forEach(p => {
                if ((p.LOTTO_PROD || '').toUpperCase().trim() === normLot) {
                    packagingRuns.push(p);
                }
            });

            (yearDb.MAINTENANCE_LOGS || []).forEach(log => {
                const appUpper = (log.apparato || '').toUpperCase();
                const tankUpper = (header.FERMENTATORE || '').toUpperCase();
                if (
                    log.tipo === 'CIP_SANIFICAZIONE' &&
                    (appUpper.includes('SALA COTTE') ||
                        appUpper.includes('SCAMBIATORE') ||
                        appUpper.includes('IMBOTTIGLIATRICE') ||
                        (tankUpper && appUpper.includes(tankUpper)))
                ) {
                    cipLogs.push(log);
                }
            });
        });

        // Compute current cellar stock in the latest loaded year (or brew's year)
        const latestYearKey = Object.keys(dataByYear).sort().pop() || yr;
        const latestDb = dataByYear[latestYearKey];
        if (latestDb) {
            (latestDb.BEER_WAREHOUSE_INITIAL || []).forEach(i => {
                if ((i.lotto || '').toUpperCase().trim() === normLot) {
                    stockByFormat.set(i.formato, (stockByFormat.get(i.formato) || 0) + i.quantita);
                }
            });
            (latestDb.CONFEZIONAMENTO || []).forEach(p => {
                if ((p.LOTTO_PROD || '').toUpperCase().trim() === normLot) {
                    stockByFormat.set(p.FORMATO, (stockByFormat.get(p.FORMATO) || 0) + p.QTA_UNITA);
                }
            });
            (latestDb.BEER_MOVEMENTS || []).forEach(m => {
                if ((m.lotto || '').toUpperCase().trim() === normLot) {
                    stockByFormat.set(m.formato, (stockByFormat.get(m.formato) || 0) + m.quantita);
                }
            });
        }

        fermentation.sort((a, b) => a.GIORNO - b.GIORNO);
        cipLogs.sort((a, b) => b.dataEsecuzione.localeCompare(a.dataEsecuzione));

        const lastPlato =
            header.PLATO_FINALE ||
            (fermentation.length > 0 ? String(fermentation[fermentation.length - 1].PLATO) : undefined);
        const metrics = calculateBrewMetrics(header.PLATO_INIZIALE, lastPlato);
        const genealogy = buildYeastGenealogy(header.LOTTO, allBrewHeadersFlat);
        const deliveries = collectDeliveriesForLot(header.LOTTO);

        const residualStockList = Array.from(stockByFormat.entries())
            .filter(([, q]) => q > 0)
            .map(([formato, quantita]) => ({ formato, quantita }));

        return {
            year: yr,
            header,
            rawMaterials,
            packagingMaterials,
            fermentation,
            packagingRuns,
            cipLogs,
            metrics,
            lastPlato,
            genealogy,
            deliveries,
            residualStockList,
        };
    }, [selectedBrewKey, dataByYear, allBrewHeadersFlat, collectDeliveriesForLot]);

    // Supplier Lots Index across loaded years
    const supplierLotsSummary = useMemo<SupplierLotSummary[]>(() => {
        const map = new Map<
            string,
            {
                lottoFornitore: string;
                nomeArticolo: string;
                tipologia: string;
                fornitore: string;
                totalLoaded: number;
                brews: Set<string>;
                lastReceiptDate: string;
            }
        >();

        // Residual stock in latest year
        const latestYearKey = Object.keys(dataByYear).sort().pop();
        const latestMovs = latestYearKey ? dataByYear[latestYearKey]?.MOVIMENTAZIONE || [] : [];
        const latestResidualMap = new Map<string, number>();
        latestMovs.forEach(m => {
            const lf = (m.LOTTO_FORNITORE || '').toUpperCase().trim();
            if (!lf) return;
            const k = `${lf}|${(m.NOME || '').toUpperCase().trim()}`;
            latestResidualMap.set(k, (latestResidualMap.get(k) || 0) + m.KG_LITRI_PZ);
        });

        Object.values(dataByYear).forEach(yd => {
            (yd.MOVIMENTAZIONE || []).forEach(m => {
                const lf = (m.LOTTO_FORNITORE || '').toUpperCase().trim();
                const nome = (m.NOME || '').toUpperCase().trim();
                if (!lf || !nome) return;
                const key = `${lf}|${nome}`;
                const existing = map.get(key) || {
                    lottoFornitore: lf,
                    nomeArticolo: nome,
                    tipologia: (m.TIPOLOGIA || '').toUpperCase().trim(),
                    fornitore: (m.FORNITORE || '').toUpperCase().trim(),
                    totalLoaded: 0,
                    brews: new Set<string>(),
                    lastReceiptDate: '',
                };
                if (m.KG_LITRI_PZ > 0 && m.N_FATTURA !== 'RIPORTO_ANNO_PREC') {
                    existing.totalLoaded += m.KG_LITRI_PZ;
                    if (parseSortableItDate(m.DATA) >= parseSortableItDate(existing.lastReceiptDate)) {
                        existing.lastReceiptDate = m.DATA;
                    }
                    if (m.FORNITORE) existing.fornitore = m.FORNITORE;
                }
                if (m.KG_LITRI_PZ < 0 && m.LOTTO_PRODUZIONE) {
                    existing.brews.add(m.LOTTO_PRODUZIONE.toUpperCase().trim());
                }
                map.set(key, existing);
            });
        });

        const list: SupplierLotSummary[] = Array.from(map.entries()).map(([key, item]) => ({
            key,
            lottoFornitore: item.lottoFornitore,
            nomeArticolo: item.nomeArticolo,
            tipologia: item.tipologia,
            fornitore: item.fornitore || '-',
            totalLoaded: item.totalLoaded,
            residualStock: Math.max(0, latestResidualMap.get(key) || 0),
            impactedLotCount: item.brews.size,
            lastReceiptDate: item.lastReceiptDate || '-',
        }));

        list.sort((a, b) => parseSortableItDate(b.lastReceiptDate) - parseSortableItDate(a.lastReceiptDate));
        return list;
    }, [dataByYear]);

    const filteredSupplierLots = useMemo(() => {
        const q = supplierSearch.trim().toUpperCase();
        if (!q) return supplierLotsSummary.slice(0, 60);
        return supplierLotsSummary.filter(
            s =>
                s.lottoFornitore.includes(q) ||
                s.nomeArticolo.includes(q) ||
                s.fornitore.includes(q) ||
                s.tipologia.includes(q)
        );
    }, [supplierLotsSummary, supplierSearch]);

    // Full Recall Simulation for selectedSupplierLotCode
    const recallReport = useMemo(() => {
        const targetCode = selectedSupplierLotCode.trim().toUpperCase();
        if (!targetCode) return null;

        const receipts: Array<{ year: string; mov: Movement }> = [];
        const brewUsageMap = new Map<
            string,
            { year: string; lotto: string; birra: string; cliente: string; dataProd: string; qtaUsata: number; ruolo: string }
        >();

        Object.entries(dataByYear).forEach(([yr, yd]) => {
            const headerByLot = new Map<string, BrewHeader>();
            (yd.COTTE_HEAD || []).forEach(c => headerByLot.set(c.LOTTO.toUpperCase().trim(), c));

            (yd.MOVIMENTAZIONE || []).forEach(m => {
                const lf = (m.LOTTO_FORNITORE || '').toUpperCase().trim();
                if (lf !== targetCode) return;

                if (m.KG_LITRI_PZ > 0 && m.N_FATTURA !== 'RIPORTO_ANNO_PREC') {
                    receipts.push({ year: yr, mov: m });
                } else if (m.KG_LITRI_PZ < 0 && m.LOTTO_PRODUZIONE) {
                    const prodLot = m.LOTTO_PRODUZIONE.toUpperCase().trim();
                    const foundHeader =
                        headerByLot.get(prodLot) ||
                        allCotteAcrossScope.find(x => x.header.LOTTO.toUpperCase().trim() === prodLot)?.header;
                    const existing = brewUsageMap.get(prodLot) || {
                        year: yr,
                        lotto: foundHeader?.LOTTO || prodLot,
                        birra: foundHeader?.NOME_BIRRA || 'Lotto Produzione',
                        cliente: foundHeader?.CLIENTE || '-',
                        dataProd: foundHeader?.DATA_PROD || m.DATA,
                        qtaUsata: 0,
                        ruolo: MOCA_CATEGORIES.has((m.TIPOLOGIA || '').toUpperCase().trim())
                            ? `Imballo MOCA (${m.NOME})`
                            : `Materia Prima (${m.NOME})`,
                    };
                    existing.qtaUsata += Math.abs(m.KG_LITRI_PZ);
                    brewUsageMap.set(prodLot, existing);
                }
            });
        });

        const latestYearKey = Object.keys(dataByYear).sort().pop();
        let residualStock = 0;
        if (latestYearKey && dataByYear[latestYearKey]) {
            (dataByYear[latestYearKey].MOVIMENTAZIONE || []).forEach(m => {
                if ((m.LOTTO_FORNITORE || '').toUpperCase().trim() === targetCode) {
                    residualStock += m.KG_LITRI_PZ;
                }
            });
        }
        residualStock = Math.max(0, residualStock);

        const impactedBrews = Array.from(brewUsageMap.values()).sort(
            (a, b) => parseSortableItDate(b.dataProd) - parseSortableItDate(a.dataProd)
        );

        const impactedDeliveries: Array<{
            year: string;
            lotto: string;
            birra: string;
            data: string;
            cliente: string;
            telefono?: string;
            documento: string;
            formato: string;
            quantita: number;
        }> = [];

        impactedBrews.forEach(b => {
            const delivs = collectDeliveriesForLot(b.lotto);
            delivs.forEach(d => {
                impactedDeliveries.push({
                    year: d.year,
                    lotto: b.lotto,
                    birra: b.birra,
                    data: d.data,
                    cliente: d.cliente,
                    telefono: d.telefono,
                    documento: d.documento,
                    formato: d.formato,
                    quantita: d.quantita,
                });
            });
        });

        return {
            supplierLotQuery: targetCode,
            receipts,
            residualStock,
            impactedBrews,
            impactedDeliveries,
        };
    }, [selectedSupplierLotCode, dataByYear, allCotteAcrossScope, collectDeliveriesForLot]);

    const handleJumpToSupplierLot = (supplierLot: string) => {
        if (!supplierLot || supplierLot.startsWith('RIPORTO')) return;
        setSupplierSearch(supplierLot);
        setSelectedSupplierLotCode(supplierLot);
        setMode('RICHIAMO_FORNITORE');
    };

    const handleJumpToBrewDossier = (lotto: string) => {
        const match = allCotteAcrossScope.find(
            e => e.header.LOTTO.toUpperCase().trim() === lotto.toUpperCase().trim()
        );
        if (match) {
            setSelectedBrewKey(`${match.year}|${match.header.LOTTO}`);
            setLotSearch('');
            setMode('DOSSIER_LOTTO');
        }
    };

    if (isLoading) {
        return <div className="p-8 text-center text-slate-300">Caricamento archivio tracciabilità HACCP...</div>;
    }

    return (
        <div className="space-y-6">
            {/* Top Header & Controls */}
            <div className="bg-brew-dark p-5 rounded-lg border border-slate-700 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                <div>
                    <div className="flex items-center gap-2.5">
                        <ShieldCheckIcon className="w-7 h-7 text-brew-accent" />
                        <h1 className="text-2xl font-bold text-white tracking-tight">
                            Tracciabilità HACCP &amp; Richiamo Lotti
                        </h1>
                    </div>
                    <p className="text-sm text-slate-400 mt-1">
                        Rintracciabilità alimentare bidirezionale a monte e a valle · Reg. (CE) 178/2002 &amp; MOCA Reg. (CE) 1935/2004
                    </p>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                    {/* Scope Toggle */}
                    <div className="inline-flex rounded-md border border-slate-600 bg-brew-dark-secondary p-0.5 text-xs">
                        <button
                            type="button"
                            onClick={() => setScope('ALL_YEARS')}
                            className={`px-3 py-1.5 rounded font-semibold transition-colors ${
                                scope === 'ALL_YEARS'
                                    ? 'bg-brew-blue text-white'
                                    : 'text-slate-300 hover:text-white'
                            }`}
                        >
                            Tutti gli Anni
                        </button>
                        <button
                            type="button"
                            onClick={() => setScope('SELECTED_YEAR')}
                            className={`px-3 py-1.5 rounded font-semibold transition-colors ${
                                scope === 'SELECTED_YEAR'
                                    ? 'bg-brew-blue text-white'
                                    : 'text-slate-300 hover:text-white'
                            }`}
                        >
                            Solo {selectedYear}
                        </button>
                    </div>

                    {/* Mode Segmented Tabs */}
                    <div className="inline-flex rounded-md border border-slate-600 bg-brew-dark-secondary p-0.5 text-sm">
                        <button
                            type="button"
                            onClick={() => setMode('DOSSIER_LOTTO')}
                            className={`px-3.5 py-1.5 rounded font-bold transition-colors ${
                                mode === 'DOSSIER_LOTTO'
                                    ? 'bg-brew-accent text-brew-dark'
                                    : 'text-slate-300 hover:text-white'
                            }`}
                        >
                            Dossier Lotto Birra
                        </button>
                        <button
                            type="button"
                            onClick={() => setMode('RICHIAMO_FORNITORE')}
                            className={`px-3.5 py-1.5 rounded font-bold transition-colors ${
                                mode === 'RICHIAMO_FORNITORE'
                                    ? 'bg-brew-orange text-white'
                                    : 'text-slate-300 hover:text-white'
                            }`}
                        >
                            Richiamo Lotto Fornitore
                        </button>
                    </div>
                </div>
            </div>

            {mode === 'DOSSIER_LOTTO' ? (
                <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
                    {/* Left Column: Lot Selector */}
                    <div className="xl:col-span-3 bg-brew-dark p-4 rounded-lg border border-slate-700 flex flex-col max-h-[78vh]">
                        <label htmlFor="haccp-lot-search" className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
                            Seleziona Lotto di Produzione ({filteredBrews.length})
                        </label>
                        <input
                            id="haccp-lot-search"
                            type="text"
                            value={lotSearch}
                            onChange={e => setLotSearch(e.target.value)}
                            placeholder="Cerca lotto, birra o cliente..."
                            className="w-full bg-brew-dark-secondary border border-slate-600 rounded-md px-3 py-2 text-sm text-white placeholder-slate-400 focus:outline-none focus:border-brew-accent mb-3"
                        />
                        <div className="flex-1 overflow-y-auto divide-y divide-slate-800 pr-1">
                            {filteredBrews.length === 0 ? (
                                <p className="text-sm text-slate-400 py-6 text-center">
                                    Nessuna cotta trovata.
                                </p>
                            ) : (
                                filteredBrews.map(({ year, header }) => {
                                    const key = `${year}|${header.LOTTO}`;
                                    const isSelected = key === selectedBrewKey;
                                    return (
                                        <button
                                            key={key}
                                            type="button"
                                            onClick={() => setSelectedBrewKey(key)}
                                            className={`w-full text-left px-3 py-2.5 transition-colors rounded ${
                                                isSelected
                                                    ? 'bg-slate-800 border border-brew-accent/60'
                                                    : 'hover:bg-brew-dark-secondary'
                                            }`}
                                        >
                                            <div className="flex items-center justify-between">
                                                <span className="font-mono tabular-nums font-bold text-brew-accent text-sm">
                                                    {header.LOTTO}
                                                </span>
                                                <span className="font-mono tabular-nums text-xs text-slate-400">
                                                    {header.DATA_PROD}
                                                </span>
                                            </div>
                                            <div className="text-sm font-semibold text-white truncate mt-0.5">
                                                {header.NOME_BIRRA}
                                            </div>
                                            <div className="text-xs text-slate-400 truncate">
                                                {header.CLIENTE} · Anno {year}
                                                {header.FERMENTATORE ? ` · ${header.FERMENTATORE}` : ''}
                                            </div>
                                        </button>
                                    );
                                })
                            )}
                        </div>
                    </div>

                    {/* Right Column: Complete Dossier */}
                    <div className="xl:col-span-9 space-y-5">
                        {!dossierData ? (
                            <div className="bg-brew-dark p-10 rounded-lg border border-slate-700 text-center text-slate-400">
                                Seleziona un lotto di produzione dall&apos;elenco a sinistra per visualizzare il dossier completo di tracciabilità.
                            </div>
                        ) : (
                            <>
                                {/* Dossier Action Header & Key Analytical Metrics */}
                                <div className="bg-brew-dark p-5 rounded-lg border border-slate-700 space-y-4">
                                    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-700 pb-4">
                                        <div>
                                            <div className="text-xs uppercase tracking-wider text-slate-400 font-semibold">
                                                Dossier Lotto · Anno {dossierData.year} · Proprietà {dossierData.header.CLIENTE}
                                            </div>
                                            <h2 className="text-2xl font-bold text-white mt-0.5">
                                                <span className="font-mono tabular-nums text-brew-accent mr-2">
                                                    {dossierData.header.LOTTO}
                                                </span>
                                                {dossierData.header.NOME_BIRRA}
                                            </h2>
                                            <div className="text-xs text-slate-300 mt-1 font-mono tabular-nums">
                                                Data Cotta: {dossierData.header.DATA_PROD || '-'} · Tank: {dossierData.header.FERMENTATORE || 'N/D'} · Stile: {dossierData.header.TIPO_BIRRA || '-'}
                                                {dossierData.header.dryHopDate ? ` · Dry Hop: ${dossierData.header.dryHopDate}` : ''}
                                                {dossierData.header.coldCrashDate ? ` · Cold Crash: ${dossierData.header.coldCrashDate}` : ''}
                                                {dossierData.header.bbtTransferDate ? ` · Travaso BBT: ${dossierData.header.bbtTransferDate}` : ''}
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-2.5">
                                            {dossierData.year === selectedYear && (
                                                <button
                                                    type="button"
                                                    onClick={() => onOpenLotto(dossierData.header.LOTTO)}
                                                    className="px-3.5 py-2 rounded-md border border-slate-600 bg-brew-dark-secondary hover:bg-slate-700 text-sm font-semibold text-white transition-colors"
                                                >
                                                    Apri Scheda Cotta
                                                </button>
                                            )}
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    printHaccpLotDossierA4({
                                                        year: dossierData.year,
                                                        profile: activeProfile,
                                                        header: dossierData.header,
                                                        rawMaterials: dossierData.rawMaterials,
                                                        packagingMaterials: dossierData.packagingMaterials,
                                                        fermentation: dossierData.fermentation,
                                                        packagingRuns: dossierData.packagingRuns,
                                                        deliveries: dossierData.deliveries,
                                                        cipLogs: dossierData.cipLogs,
                                                    })
                                                }
                                                className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-brew-accent text-brew-dark font-bold text-sm hover:opacity-90 transition-opacity"
                                            >
                                                <PrinterIcon className="w-4 h-4" />
                                                Stampa Dossier A4
                                            </button>
                                        </div>
                                    </div>

                                    {/* Metrics Strip */}
                                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                                        <div className="bg-brew-dark-secondary p-3 rounded border border-slate-700">
                                            <div className="text-[11px] uppercase text-slate-400">Volume Mosto</div>
                                            <div className="text-lg font-bold font-mono tabular-nums text-white mt-0.5">
                                                {dossierData.header.LITRI_FINALI || '0'} L
                                            </div>
                                        </div>
                                        <div className="bg-brew-dark-secondary p-3 rounded border border-slate-700">
                                            <div className="text-[11px] uppercase text-slate-400">Estratto OG → FG</div>
                                            <div className="text-lg font-bold font-mono tabular-nums text-white mt-0.5">
                                                {dossierData.header.PLATO_INIZIALE || '-'} → {dossierData.lastPlato || '-'} °P
                                            </div>
                                        </div>
                                        <div className="bg-brew-dark-secondary p-3 rounded border border-slate-700">
                                            <div className="text-[11px] uppercase text-slate-400">Grado Alcolico</div>
                                            <div className="text-lg font-bold font-mono tabular-nums text-brew-accent mt-0.5">
                                                {dossierData.metrics ? `${dossierData.metrics.abv.toFixed(2)} % vol` : 'N/D'}
                                            </div>
                                        </div>
                                        <div className="bg-brew-dark-secondary p-3 rounded border border-slate-700">
                                            <div className="text-[11px] uppercase text-slate-400">Attenuazione App. / Reale</div>
                                            <div className="text-lg font-bold font-mono tabular-nums text-white mt-0.5">
                                                {dossierData.metrics
                                                    ? `${dossierData.metrics.apparentAttenuation.toFixed(1)}% · ${dossierData.metrics.realAttenuation.toFixed(1)}%`
                                                    : 'N/D'}
                                            </div>
                                        </div>
                                        <div className="bg-brew-dark-secondary p-3 rounded border border-slate-700">
                                            <div className="text-[11px] uppercase text-slate-400">Inoculo Lievito</div>
                                            <div className="text-sm font-bold font-mono tabular-nums text-white mt-1 truncate">
                                                {dossierData.header.yeastPitchType === 'REPITCHING'
                                                    ? `Repitch da ${dossierData.header.yeastSourceLotto || '?'} (G${dossierData.header.yeastGeneration ?? 1})`
                                                    : `Lievito Madre (G${dossierData.header.yeastGeneration ?? 0})`}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Yeast Lineage Chain if Repitching or Children exist */}
                                    {(dossierData.genealogy.ancestors.length > 0 ||
                                        dossierData.genealogy.children.length > 0) && (
                                        <div className="bg-brew-dark-secondary px-3.5 py-2.5 rounded border border-slate-700 text-xs text-slate-300 flex flex-wrap items-center gap-2">
                                            <span className="font-bold uppercase text-slate-400">
                                                Catena Genealogica Lievito{dossierData.header.yeastStrain ? ` (${dossierData.header.yeastStrain})` : ''}:
                                            </span>
                                            {dossierData.genealogy.ancestors.map(node => (
                                                <React.Fragment key={node.lotto}>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleJumpToBrewDossier(node.lotto)}
                                                        className="font-mono tabular-nums underline text-sky-400 hover:text-sky-300"
                                                    >
                                                        {node.lotto} (G{node.generation})
                                                    </button>
                                                    <ArrowRightIcon className="w-3.5 h-3.5 text-slate-500" />
                                                </React.Fragment>
                                            ))}
                                            <span className="font-mono tabular-nums font-bold text-brew-accent">
                                                {dossierData.header.LOTTO} (G{dossierData.header.yeastGeneration ?? 0})
                                            </span>
                                            {dossierData.genealogy.children.length > 0 && (
                                                <>
                                                    <ArrowRightIcon className="w-3.5 h-3.5 text-slate-500" />
                                                    <span className="text-slate-400">Riusato in:</span>
                                                    {dossierData.genealogy.children.map(ch => (
                                                        <button
                                                            key={ch.lotto}
                                                            type="button"
                                                            onClick={() => handleJumpToBrewDossier(ch.lotto)}
                                                            className="font-mono tabular-nums underline text-emerald-400 hover:text-emerald-300 mr-1"
                                                        >
                                                            {ch.lotto} (G{ch.generation})
                                                        </button>
                                                    ))}
                                                </>
                                            )}
                                        </div>
                                    )}
                                </div>

                                {/* 1. Materie Prime a Monte */}
                                <div className="bg-brew-dark p-5 rounded-lg border border-slate-700">
                                    <div className="flex items-center justify-between mb-3">
                                        <h3 className="text-base font-bold text-white">
                                            1. Materie Prime Impiegate (Tracciabilità a Monte)
                                        </h3>
                                        <span className="text-xs text-slate-400">
                                            Clicca su un Lotto Fornitore per simulare un richiamo
                                        </span>
                                    </div>
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-sm text-left">
                                            <thead className="text-xs uppercase text-slate-400 border-b border-slate-700">
                                                <tr>
                                                    <th className="py-2 pr-3">Categoria</th>
                                                    <th className="py-2 px-3">Ingrediente</th>
                                                    <th className="py-2 px-3">Marca / Fornitore</th>
                                                    <th className="py-2 px-3">Lotto Fornitore</th>
                                                    <th className="py-2 pl-3 text-right">Quantità</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-800">
                                                {dossierData.rawMaterials.length === 0 ? (
                                                    <tr>
                                                        <td colSpan={5} className="py-4 text-center text-slate-400">
                                                            Nessuno scarico materie prime registrato per questo lotto.
                                                        </td>
                                                    </tr>
                                                ) : (
                                                    dossierData.rawMaterials.map((m, idx) => (
                                                        <tr key={`${m.NOME}-${m.LOTTO_FORNITORE}-${idx}`} className="hover:bg-brew-dark-secondary/60">
                                                            <td className="py-2 pr-3 text-xs text-slate-400">{m.TIPOLOGIA}</td>
                                                            <td className="py-2 px-3 font-semibold text-white">{m.NOME}</td>
                                                            <td className="py-2 px-3 text-slate-300">
                                                                {m.MARCA || '-'} · {m.FORNITORE || '-'}
                                                            </td>
                                                            <td className="py-2 px-3 font-mono tabular-nums">
                                                                {m.LOTTO_FORNITORE ? (
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => handleJumpToSupplierLot(m.LOTTO_FORNITORE)}
                                                                        className="text-brew-accent underline hover:text-yellow-300 font-semibold"
                                                                        title="Apri indagine richiamo per questo lotto fornitore"
                                                                    >
                                                                        {m.LOTTO_FORNITORE}
                                                                    </button>
                                                                ) : (
                                                                    <span className="text-slate-500">N/D</span>
                                                                )}
                                                            </td>
                                                            <td className="py-2 pl-3 text-right font-mono tabular-nums text-white">
                                                                {Math.abs(m.KG_LITRI_PZ).toFixed(2)}
                                                            </td>
                                                        </tr>
                                                    ))
                                                )}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>

                                {/* 2. Monitoraggio Fermentazione & CIP */}
                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                                    <div className="bg-brew-dark p-5 rounded-lg border border-slate-700">
                                        <h3 className="text-base font-bold text-white mb-3">
                                            2. Diario Parametri Fermentazione
                                        </h3>
                                        <div className="overflow-x-auto max-h-64 overflow-y-auto">
                                            <table className="w-full text-sm text-left">
                                                <thead className="text-xs uppercase text-slate-400 border-b border-slate-700">
                                                    <tr>
                                                        <th className="py-2 pr-2">Giorno</th>
                                                        <th className="py-2 px-2 text-right">Temp °C</th>
                                                        <th className="py-2 px-2 text-right">Plato °P</th>
                                                        <th className="py-2 px-2 text-right">pH</th>
                                                        <th className="py-2 pl-2 text-right">Bar</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-slate-800 font-mono tabular-nums">
                                                    {dossierData.fermentation.length === 0 ? (
                                                        <tr>
                                                            <td colSpan={5} className="py-4 text-center font-sans text-slate-400">
                                                                Nessuna lettura fermentazione registrata.
                                                            </td>
                                                        </tr>
                                                    ) : (
                                                        dossierData.fermentation.map(f => (
                                                            <tr key={f.GIORNO}>
                                                                <td className="py-1.5 pr-2 text-slate-300">G.{f.GIORNO}</td>
                                                                <td className="py-1.5 px-2 text-right text-white">{f.TEMPERATURA.toFixed(1)}</td>
                                                                <td className="py-1.5 px-2 text-right text-brew-accent">{f.PLATO.toFixed(2)}</td>
                                                                <td className="py-1.5 px-2 text-right text-emerald-400">
                                                                    {f.PH !== undefined ? f.PH.toFixed(2) : '-'}
                                                                </td>
                                                                <td className="py-1.5 pl-2 text-right text-sky-400">
                                                                    {f.PRESSIONE !== undefined ? f.PRESSIONE.toFixed(2) : '-'}
                                                                </td>
                                                            </tr>
                                                        ))
                                                    )}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>

                                    {/* 3. Confezionamento, MOCA e Giacenza Cella */}
                                    <div className="bg-brew-dark p-5 rounded-lg border border-slate-700 space-y-4">
                                        <div>
                                            <h3 className="text-base font-bold text-white mb-2">
                                                3. Confezionamento, MOCA &amp; Cella Frigo
                                            </h3>
                                            <div className="overflow-x-auto">
                                                <table className="w-full text-sm text-left">
                                                    <thead className="text-xs uppercase text-slate-400 border-b border-slate-700">
                                                        <tr>
                                                            <th className="py-1.5 pr-2">Data</th>
                                                            <th className="py-1.5 px-2">Formato</th>
                                                            <th className="py-1.5 px-2 text-right">Unità</th>
                                                            <th className="py-1.5 px-2 text-right">Litri</th>
                                                            <th className="py-1.5 pl-2">Scadenza</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-slate-800 font-mono tabular-nums text-xs">
                                                        {dossierData.packagingRuns.length === 0 ? (
                                                            <tr>
                                                                <td colSpan={5} className="py-3 text-center font-sans text-slate-400">
                                                                    Non ancora confezionato.
                                                                </td>
                                                            </tr>
                                                        ) : (
                                                            dossierData.packagingRuns.map(p => (
                                                                <tr key={p.ID_OPERAZIONE}>
                                                                    <td className="py-1.5 pr-2 text-slate-300">{p.DATA}</td>
                                                                    <td className="py-1.5 px-2 font-sans font-semibold text-white">
                                                                        {p.FORMATO}
                                                                        {p.isReturnableKeg ? ' · Inox' : ''}
                                                                    </td>
                                                                    <td className="py-1.5 px-2 text-right text-white">{p.QTA_UNITA}</td>
                                                                    <td className="py-1.5 px-2 text-right text-slate-300">{p.LITRI_TOT.toFixed(1)}</td>
                                                                    <td className="py-1.5 pl-2 text-slate-300">{p.DATA_SCADENZA}</td>
                                                                </tr>
                                                            ))
                                                        )}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </div>

                                        {dossierData.packagingMaterials.length > 0 && (
                                            <div className="border-t border-slate-700 pt-3">
                                                <div className="text-xs font-bold uppercase text-slate-400 mb-1.5">
                                                    Lotti Imballaggi MOCA Scaricati
                                                </div>
                                                <div className="space-y-1 text-xs">
                                                    {dossierData.packagingMaterials.map((pm, idx) => (
                                                        <div key={idx} className="flex justify-between text-slate-300">
                                                            <span>
                                                                {pm.NOME} ({pm.FORNITORE || '-'})
                                                            </span>
                                                            <span className="font-mono tabular-nums">
                                                                Lotto{' '}
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleJumpToSupplierLot(pm.LOTTO_FORNITORE)}
                                                                    className="text-brew-accent underline"
                                                                >
                                                                    {pm.LOTTO_FORNITORE || '-'}
                                                                </button>{' '}
                                                                · {Math.abs(pm.KG_LITRI_PZ)} pz
                                                            </span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        <div className="border-t border-slate-700 pt-3 flex flex-wrap items-center justify-between gap-2 text-xs">
                                            <span className="font-bold uppercase text-slate-400">Giacenza Attuale in Cella:</span>
                                            <span className="font-mono tabular-nums text-slate-200">
                                                {dossierData.residualStockList.length === 0
                                                    ? '0 unità in cella (esaurito o non confezionato)'
                                                    : dossierData.residualStockList
                                                          .map(s => `${s.quantita}× ${s.formato}`)
                                                          .join(' · ')}
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                {/* 4. Distribuzione Commerciale a Valle */}
                                <div className="bg-brew-dark p-5 rounded-lg border border-slate-700">
                                    <div className="flex items-center justify-between mb-3">
                                        <h3 className="text-base font-bold text-white">
                                            4. Distribuzione Commerciale &amp; Clienti Destinatari (Tracciabilità a Valle)
                                        </h3>
                                        <span className="text-xs font-mono tabular-nums text-slate-400">
                                            {dossierData.deliveries.length} scarichi / consegne registrate
                                        </span>
                                    </div>
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-sm text-left">
                                            <thead className="text-xs uppercase text-slate-400 border-b border-slate-700">
                                                <tr>
                                                    <th className="py-2 pr-3">Data</th>
                                                    <th className="py-2 px-3">Cliente Destinatario</th>
                                                    <th className="py-2 px-3">Rif. Documento / DDT</th>
                                                    <th className="py-2 px-3">Formato</th>
                                                    <th className="py-2 px-3 text-right">Unità</th>
                                                    <th className="py-2 pl-3 text-right">Litri</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-800">
                                                {dossierData.deliveries.length === 0 ? (
                                                    <tr>
                                                        <td colSpan={6} className="py-4 text-center text-slate-400">
                                                            Nessuna consegna commerciale registrata per questo lotto.
                                                        </td>
                                                    </tr>
                                                ) : (
                                                    dossierData.deliveries.map((d, i) => (
                                                        <tr key={`${d.documento}-${i}`} className="hover:bg-brew-dark-secondary/60">
                                                            <td className="py-2 pr-3 font-mono tabular-nums text-slate-300">{d.data}</td>
                                                            <td className="py-2 px-3 font-semibold text-white">
                                                                {d.cliente}
                                                                {d.telefono ? (
                                                                    <span className="text-xs font-normal text-slate-400"> · Tel. {d.telefono}</span>
                                                                ) : null}
                                                            </td>
                                                            <td className="py-2 px-3 text-slate-300">{d.documento}</td>
                                                            <td className="py-2 px-3 text-slate-300">{d.formato}</td>
                                                            <td className="py-2 px-3 text-right font-mono tabular-nums text-white font-semibold">
                                                                {d.quantita}
                                                            </td>
                                                            <td className="py-2 pl-3 text-right font-mono tabular-nums text-slate-300">
                                                                {d.litri.toFixed(2)}
                                                            </td>
                                                        </tr>
                                                    ))
                                                )}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            ) : (
                /* MODE 2: RICHIAMO CAUTELATIVO DA LOTTO FORNITORE */
                <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
                    {/* Left Column: Supplier Lot Search */}
                    <div className="xl:col-span-4 bg-brew-dark p-4 rounded-lg border border-slate-700 flex flex-col max-h-[78vh]">
                        <label htmlFor="supplier-lot-search" className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
                            Cerca Lotto Fornitore o Ingrediente / MOCA
                        </label>
                        <input
                            id="supplier-lot-search"
                            type="text"
                            value={supplierSearch}
                            onChange={e => setSupplierSearch(e.target.value)}
                            placeholder="Es. codice lotto malto, luppolo, bottiglie..."
                            className="w-full bg-brew-dark-secondary border border-slate-600 rounded-md px-3 py-2 text-sm text-white placeholder-slate-400 focus:outline-none focus:border-brew-orange mb-3"
                        />

                        <div className="flex-1 overflow-y-auto divide-y divide-slate-800 pr-1">
                            {filteredSupplierLots.length === 0 ? (
                                <p className="text-sm text-slate-400 py-6 text-center">
                                    Nessun lotto fornitore trovato.
                                </p>
                            ) : (
                                filteredSupplierLots.map(item => {
                                    const isSelected = item.lottoFornitore === selectedSupplierLotCode;
                                    return (
                                        <button
                                            key={item.key}
                                            type="button"
                                            onClick={() => setSelectedSupplierLotCode(item.lottoFornitore)}
                                            className={`w-full text-left px-3 py-2.5 transition-colors rounded ${
                                                isSelected
                                                    ? 'bg-slate-800 border border-brew-orange/70'
                                                    : 'hover:bg-brew-dark-secondary'
                                            }`}
                                        >
                                            <div className="flex items-center justify-between">
                                                <span className="font-mono tabular-nums font-bold text-brew-orange text-sm">
                                                    {item.lottoFornitore}
                                                </span>
                                                <span className="font-mono tabular-nums text-xs text-slate-400">
                                                    {item.impactedLotCount} cotte
                                                </span>
                                            </div>
                                            <div className="text-sm font-semibold text-white truncate mt-0.5">
                                                {item.nomeArticolo}
                                            </div>
                                            <div className="text-xs text-slate-400 truncate font-mono tabular-nums">
                                                {item.fornitore} · Giac. {item.residualStock.toFixed(1)}
                                            </div>
                                        </button>
                                    );
                                })
                            )}
                        </div>
                    </div>

                    {/* Right Column: Recall Impact Report */}
                    <div className="xl:col-span-8 space-y-5">
                        {!recallReport ? (
                            <div className="bg-brew-dark p-10 rounded-lg border border-slate-700 text-center text-slate-400">
                                Seleziona un <strong className="text-white">Lotto Fornitore</strong> dall&apos;elenco a sinistra per individuare istantaneamente giacenze da segregare, cotte coinvolte e clienti destinatari da avvisare.
                            </div>
                        ) : (
                            <>
                                <div className="bg-brew-dark p-5 rounded-lg border border-slate-700 space-y-4">
                                    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-700 pb-4">
                                        <div>
                                            <div className="text-xs uppercase tracking-wider text-rose-400 font-bold">
                                                Simulazione Blocco Cautelativo / Richiamo Alimentare (Art. 18–19 Reg. CE 178/2002)
                                            </div>
                                            <h2 className="text-2xl font-bold text-white mt-0.5">
                                                Lotto Fornitore:{' '}
                                                <span className="font-mono tabular-nums text-brew-orange">
                                                    {recallReport.supplierLotQuery}
                                                </span>
                                            </h2>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => printHaccpSupplierRecallA4({
                                                profile: activeProfile,
                                                supplierLotQuery: recallReport.supplierLotQuery,
                                                receipts: recallReport.receipts,
                                                residualStock: recallReport.residualStock,
                                                impactedBrews: recallReport.impactedBrews,
                                                impactedDeliveries: recallReport.impactedDeliveries,
                                            })}
                                            className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-brew-orange text-white font-bold text-sm hover:opacity-90 transition-opacity"
                                        >
                                            <PrinterIcon className="w-4 h-4" />
                                            Stampa Scheda Richiamo A4
                                        </button>
                                    </div>

                                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                        <div className="bg-brew-dark-secondary p-3 rounded border border-slate-700">
                                            <div className="text-[11px] uppercase text-slate-400">Carichi Registrati</div>
                                            <div className="text-xl font-bold font-mono tabular-nums text-white mt-0.5">
                                                {recallReport.receipts.length}
                                            </div>
                                        </div>
                                        <div className="bg-brew-dark-secondary p-3 rounded border border-slate-700">
                                            <div className="text-[11px] uppercase text-slate-400">Giacenza da Segregare</div>
                                            <div className={`text-xl font-bold font-mono tabular-nums mt-0.5 ${recallReport.residualStock > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                                                {recallReport.residualStock.toFixed(2)}
                                            </div>
                                        </div>
                                        <div className="bg-brew-dark-secondary p-3 rounded border border-slate-700">
                                            <div className="text-[11px] uppercase text-slate-400">Lotti Birra Coinvolti</div>
                                            <div className="text-xl font-bold font-mono tabular-nums text-brew-accent mt-0.5">
                                                {recallReport.impactedBrews.length}
                                            </div>
                                        </div>
                                        <div className="bg-brew-dark-secondary p-3 rounded border border-slate-700">
                                            <div className="text-[11px] uppercase text-slate-400">Consegne Clienti</div>
                                            <div className="text-xl font-bold font-mono tabular-nums text-white mt-0.5">
                                                {recallReport.impactedDeliveries.length}
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Table 1: Receipts */}
                                <div className="bg-brew-dark p-5 rounded-lg border border-slate-700">
                                    <h3 className="text-base font-bold text-white mb-3">
                                        1. Documenti di Carico Ricevuti
                                    </h3>
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-sm text-left">
                                            <thead className="text-xs uppercase text-slate-400 border-b border-slate-700">
                                                <tr>
                                                    <th className="py-2 pr-3">Data</th>
                                                    <th className="py-2 px-3">Articolo</th>
                                                    <th className="py-2 px-3">Fornitore</th>
                                                    <th className="py-2 px-3">Fattura / DDT</th>
                                                    <th className="py-2 px-3 text-right">Q.tà Caricata</th>
                                                    <th className="py-2 pl-3">Scadenza</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-800">
                                                {recallReport.receipts.length === 0 ? (
                                                    <tr>
                                                        <td colSpan={6} className="py-4 text-center text-slate-400">
                                                            Nessun carico diretto trovato (possibile solo riporto).
                                                        </td>
                                                    </tr>
                                                ) : (
                                                    recallReport.receipts.map((r, idx) => (
                                                        <tr key={idx}>
                                                            <td className="py-2 pr-3 font-mono tabular-nums text-slate-300">{r.mov.DATA}</td>
                                                            <td className="py-2 px-3 font-semibold text-white">
                                                                {r.mov.NOME} · <span className="text-xs text-slate-400">{r.mov.TIPOLOGIA}</span>
                                                            </td>
                                                            <td className="py-2 px-3 text-slate-300">{r.mov.FORNITORE || '-'}</td>
                                                            <td className="py-2 px-3 font-mono tabular-nums text-slate-300">{r.mov.N_FATTURA || '-'}</td>
                                                            <td className="py-2 px-3 text-right font-mono tabular-nums text-white">
                                                                {r.mov.KG_LITRI_PZ.toFixed(2)}
                                                            </td>
                                                            <td className="py-2 pl-3 font-mono tabular-nums text-slate-300">
                                                                {r.mov.DATA_SCADENZA || '-'}
                                                            </td>
                                                        </tr>
                                                    ))
                                                )}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>

                                {/* Table 2: Impacted Brews */}
                                <div className="bg-brew-dark p-5 rounded-lg border border-slate-700">
                                    <h3 className="text-base font-bold text-white mb-3">
                                        2. Lotti di Birra Prodotti / Confezionati con questo Lotto
                                    </h3>
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-sm text-left">
                                            <thead className="text-xs uppercase text-slate-400 border-b border-slate-700">
                                                <tr>
                                                    <th className="py-2 pr-3">Lotto Birra</th>
                                                    <th className="py-2 px-3">Birra &amp; Proprietà</th>
                                                    <th className="py-2 px-3">Data Cotta</th>
                                                    <th className="py-2 px-3">Impiego</th>
                                                    <th className="py-2 pl-3 text-right">Q.tà Usata</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-800">
                                                {recallReport.impactedBrews.length === 0 ? (
                                                    <tr>
                                                        <td colSpan={5} className="py-4 text-center text-slate-400">
                                                            Nessun lotto di birra ha ancora utilizzato questo lotto fornitore.
                                                        </td>
                                                    </tr>
                                                ) : (
                                                    recallReport.impactedBrews.map(b => (
                                                        <tr key={`${b.year}-${b.lotto}`} className="hover:bg-brew-dark-secondary/60">
                                                            <td className="py-2 pr-3 font-mono tabular-nums">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleJumpToBrewDossier(b.lotto)}
                                                                    className="text-brew-accent font-bold underline hover:text-yellow-300"
                                                                >
                                                                    {b.lotto}
                                                                </button>
                                                            </td>
                                                            <td className="py-2 px-3 text-white">
                                                                <span className="font-semibold">{b.birra}</span> ·{' '}
                                                                <span className="text-slate-400">{b.cliente}</span>
                                                            </td>
                                                            <td className="py-2 px-3 font-mono tabular-nums text-slate-300">{b.dataProd}</td>
                                                            <td className="py-2 px-3 text-slate-300">{b.ruolo}</td>
                                                            <td className="py-2 pl-3 text-right font-mono tabular-nums text-white">
                                                                {b.qtaUsata.toFixed(2)}
                                                            </td>
                                                        </tr>
                                                    ))
                                                )}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>

                                {/* Table 3: Customer Recall Contacts */}
                                <div className="bg-brew-dark p-5 rounded-lg border border-slate-700">
                                    <h3 className="text-base font-bold text-white mb-3">
                                        3. Lista Clienti Destinatari da Contattare
                                    </h3>
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-sm text-left">
                                            <thead className="text-xs uppercase text-slate-400 border-b border-slate-700">
                                                <tr>
                                                    <th className="py-2 pr-3">Data</th>
                                                    <th className="py-2 px-3">Cliente &amp; Contatto</th>
                                                    <th className="py-2 px-3">Documento / DDT</th>
                                                    <th className="py-2 px-3">Lotto &amp; Formato</th>
                                                    <th className="py-2 pl-3 text-right">Unità</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-800">
                                                {recallReport.impactedDeliveries.length === 0 ? (
                                                    <tr>
                                                        <td colSpan={5} className="py-4 text-center text-emerald-400">
                                                            Nessuna consegna esterna registrata per i lotti coinvolti (merce ancora interna).
                                                        </td>
                                                    </tr>
                                                ) : (
                                                    recallReport.impactedDeliveries.map((d, idx) => (
                                                        <tr key={`${d.documento}-${idx}`} className="hover:bg-brew-dark-secondary/60">
                                                            <td className="py-2 pr-3 font-mono tabular-nums text-slate-300">{d.data}</td>
                                                            <td className="py-2 px-3 text-white">
                                                                <span className="font-semibold">{d.cliente}</span>
                                                                {d.telefono ? (
                                                                    <span className="text-xs text-slate-400"> · {d.telefono}</span>
                                                                ) : null}
                                                            </td>
                                                            <td className="py-2 px-3 text-slate-300">{d.documento}</td>
                                                            <td className="py-2 px-3 text-slate-300">
                                                                <span className="font-mono tabular-nums font-bold text-brew-accent">{d.lotto}</span> · {d.birra} ({d.formato})
                                                            </td>
                                                            <td className="py-2 pl-3 text-right font-mono tabular-nums font-bold text-white">
                                                                {d.quantita}
                                                            </td>
                                                        </tr>
                                                    ))
                                                )}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};
