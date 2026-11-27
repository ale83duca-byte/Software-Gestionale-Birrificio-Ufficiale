import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
    getBreweryData,
    saveBreweryData,
    getEffectiveBreweryProfile,
    getNextInvoiceNumber,
} from '../services/dataService';
import type {
    BreweryData,
    ExciseBracket,
    PackagedBeerOrder,
    SummaryInvoice,
    SummaryInvoiceDdtRef,
    SummaryInvoiceLine,
} from '../types';
import {
    EXCISE_BRACKET_OPTIONS,
    resolveEffectiveExciseRate,
    normalizeFiscalPlato,
} from '../utils/brewingCalculations';
import {
    printExciseRegisterA4,
    exportExciseRegisterToExcel,
    downloadFatturaPaXml,
    printCourtesyInvoiceA4,
    printAdmDestructionNoticeA4,
    exportAdmDestructionToExcel,
    type ExciseRegisterRow,
    type AdmDestructionRow,
} from '../utils/erpPrintAndXml';
import { getUnitLiters } from '../utils/beerStockEngine';
import { useToast } from '../hooks/useToast';
import { ScaleIcon, PrinterIcon, ArrowDownTrayIcon, CheckIcon, TrashIcon } from './icons';

interface ExciseAndInvoicingViewProps {
    selectedYear: string;
    onRefresh?: () => void;
}

type ErpFiscalTab = 'ACCISE_ADM' | 'DISTRUZIONE_ADM' | 'FATTURAZIONE_DDT';

const ITALIAN_MONTHS = [
    { value: 'ALL', label: 'Intero Anno' },
    { value: '01', label: 'Gennaio' },
    { value: '02', label: 'Febbraio' },
    { value: '03', label: 'Marzo' },
    { value: '04', label: 'Aprile' },
    { value: '05', label: 'Maggio' },
    { value: '06', label: 'Giugno' },
    { value: '07', label: 'Luglio' },
    { value: '08', label: 'Agosto' },
    { value: '09', label: 'Settembre' },
    { value: '10', label: 'Ottobre' },
    { value: '11', label: 'Novembre' },
    { value: '12', label: 'Dicembre' },
];

const extractMonthFromItDate = (dateStr: string): string => {
    if (!dateStr) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr.slice(5, 7);
    const parts = dateStr.split('/');
    if (parts.length === 3) return parts[1].padStart(2, '0');
    return '';
};

const parseItDateMs = (dateStr: string): number => {
    if (!dateStr) return 0;
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return new Date(dateStr).getTime() || 0;
    const parts = dateStr.split('/');
    if (parts.length === 3) {
        const [d, m, y] = parts.map(Number);
        if (!isNaN(d) && !isNaN(m) && !isNaN(y)) return new Date(y, m - 1, d).getTime();
    }
    return 0;
};

const isoToIt = (iso: string): string => {
    if (!iso) return new Date().toLocaleDateString('it-IT');
    const [y, m, d] = iso.split('-');
    if (y && m && d) return `${d}/${m}/${y}`;
    return iso;
};

const addDaysIso = (baseIso: string, days: number, endOfMonth = false): string => {
    const dt = baseIso ? new Date(baseIso) : new Date();
    if (isNaN(dt.getTime())) return new Date().toISOString().slice(0, 10);
    dt.setDate(dt.getDate() + days);
    if (endOfMonth) {
        dt.setMonth(dt.getMonth() + 1, 0);
    }
    return dt.toISOString().slice(0, 10);
};

export const ExciseAndInvoicingView: React.FC<ExciseAndInvoicingViewProps> = ({
    selectedYear,
    onRefresh,
}) => {
    const { showToast } = useToast();
    const [activeTab, setActiveTab] = useState<ErpFiscalTab>('ACCISE_ADM');
    const [breweryData, setBreweryData] = useState<BreweryData | null>(null);

    // Tab 1: Accise ADM state
    const [selectedMonth, setSelectedMonth] = useState<string>('ALL');
    const [bracketDraft, setBracketDraft] = useState<ExciseBracket>('MICRO_50');
    const [codiceAccisaDraft, setCodiceAccisaDraft] = useState<string>('');

    // Tab 2: Fatturazione Differita DDT state
    const [billingClient, setBillingClient] = useState<string>('ALL');
    const [billingMonth, setBillingMonth] = useState<string>('ALL');
    const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([]);
    const [invoiceNum, setInvoiceNum] = useState<string>('');
    const [issueDateIso, setIssueDateIso] = useState<string>(() => new Date().toISOString().slice(0, 10));
    const [dueDateIso, setDueDateIso] = useState<string>(() => addDaysIso(new Date().toISOString().slice(0, 10), 30, true));
    const [paymentMethod, setPaymentMethod] = useState<'MP05' | 'MP12' | 'MP01'>('MP05');
    const [invoiceNote, setInvoiceNote] = useState<string>('');
    const [inlineEditInvoiceId, setInlineEditInvoiceId] = useState<string | null>(null);
    const [inlineInvoiceNumVal, setInlineInvoiceNumVal] = useState<string>('');

    // Tab 3: Comunicazione Preventiva Distruzione Merce & Recupero Accisa ADM
    const [destructionMonth, setDestructionMonth] = useState<string>('ALL');
    const [ufficioDogane, setUfficioDogane] = useState<string>('Ufficio delle Dogane territorialmente competente');
    const [dataPrevistaDistruzione, setDataPrevistaDistruzione] = useState<string>('');
    const [luogoDistruzione, setLuogoDistruzione] = useState<string>('');
    const [modalitaSmaltimento, setModalitaSmaltimento] = useState<string>('Svuotamento controllato fusti/bottiglie e conferimento reflui a smaltitore autorizzato');
    const [selectedWasteIds, setSelectedWasteIds] = useState<string[]>([]);

    const loadData = useCallback(async () => {
        const data = await getBreweryData(selectedYear);
        if (data) {
            setBreweryData(data);
            const prof = getEffectiveBreweryProfile(data);
            setBracketDraft(prof.scaglioneAccisa || 'MICRO_50');
            setCodiceAccisaDraft(prof.codiceAccisa || '');
            setInvoiceNum(getNextInvoiceNumber(data, selectedYear).numeroFattura);
        }
    }, [selectedYear]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const profile = useMemo(() => getEffectiveBreweryProfile(breweryData), [breweryData]);

    const handleSaveExciseSettings = async () => {
        if (!breweryData) return;
        const updatedProfile = {
            ...profile,
            scaglioneAccisa: bracketDraft,
            codiceAccisa: codiceAccisaDraft.trim(),
        };
        const updated: BreweryData = {
            ...breweryData,
            BREWERY_PROFILE: updatedProfile,
        };
        await saveBreweryData(selectedYear, updated);
        setBreweryData(updated);
        showToast('Impostazioni accisa ADM salvate nell’anagrafica birrificio.', 'success');
    };

    const effectiveRate = useMemo(
        () => resolveEffectiveExciseRate(bracketDraft, breweryData?.COST_COEFFICIENTS?.coefficiente_accise),
        [bracketDraft, breweryData]
    );

    const activeBracketOption = useMemo(
        () =>
            EXCISE_BRACKET_OPTIONS.find(b => b.value === bracketDraft) ||
            EXCISE_BRACKET_OPTIONS[0],
        [bracketDraft]
    );

    // Compute Excise Register Rows
    const exciseRows = useMemo<ExciseRegisterRow[]>(() => {
        if (!breweryData) return [];

        const maltKgByLot = new Map<string, number>();
        (breweryData.MOVIMENTAZIONE || []).forEach(m => {
            if (
                m.KG_LITRI_PZ < 0 &&
                m.LOTTO_PRODUZIONE &&
                (m.TIPOLOGIA || '').toUpperCase().trim() === 'MALTI'
            ) {
                const key = m.LOTTO_PRODUZIONE.toUpperCase().trim();
                maltKgByLot.set(key, (maltKgByLot.get(key) || 0) + Math.abs(m.KG_LITRI_PZ));
            }
        });

        const headerByLot = new Map<string, BreweryData['COTTE_HEAD'][number]>();
        (breweryData.COTTE_HEAD || []).forEach(h => {
            const key = h.LOTTO.toUpperCase().trim();
            headerByLot.set(key, h);
            if (!maltKgByLot.has(key) && h.carriedOverIngredients) {
                const carriedMalt = h.carriedOverIngredients
                    .filter(m => (m.TIPOLOGIA || '').toUpperCase().trim() === 'MALTI')
                    .reduce((s, m) => s + Math.abs(m.KG_LITRI_PZ), 0);
                if (carriedMalt > 0) maltKgByLot.set(key, carriedMalt);
            }
        });

        // Group packaging runs by lot (filtered by month if selected)
        const pkgByLot = new Map<
            string,
            { litriPeriodo: number; litriTotaliAnno: number; lastDate: string; lastMonth: string }
        >();

        (breweryData.CONFEZIONAMENTO || []).forEach(p => {
            const lotKey = (p.LOTTO_PROD || '').toUpperCase().trim();
            if (!lotKey) return;
            const m = extractMonthFromItDate(p.DATA);
            const entry = pkgByLot.get(lotKey) || {
                litriPeriodo: 0,
                litriTotaliAnno: 0,
                lastDate: p.DATA,
                lastMonth: m,
            };
            entry.litriTotaliAnno += p.LITRI_TOT;
            if (selectedMonth === 'ALL' || m === selectedMonth) {
                entry.litriPeriodo += p.LITRI_TOT;
                if (parseItDateMs(p.DATA) >= parseItDateMs(entry.lastDate)) {
                    entry.lastDate = p.DATA;
                    entry.lastMonth = m;
                }
            }
            pkgByLot.set(lotKey, entry);
        });

        const rows: ExciseRegisterRow[] = [];
        pkgByLot.forEach((pkgInfo, lotKey) => {
            if (pkgInfo.litriPeriodo <= 0) return;
            const header = headerByLot.get(lotKey);
            const rawMostoLiters = parseFloat(
                String(header?.litriFinaliOrigine || header?.LITRI_FINALI || '0').replace(',', '.')
            ) || 0;
            const prevPackagedLiters = header?.litriGiaConfezionatiAnnoPrec || 0;
            const totalConditionedAllTime = pkgInfo.litriTotaliAnno + prevPackagedLiters;

            const mostoHl = rawMostoLiters / 100;
            const condizionataHl = pkgInfo.litriPeriodo / 100;
            const caloPercent =
                rawMostoLiters > 0
                    ? Math.max(0, ((rawMostoLiters - totalConditionedAllTime) / rawMostoLiters) * 100)
                    : 0;

            const rawPlato = parseFloat(
                String(header?.PLATO_FISCALE || header?.PLATO_INIZIALE || '12').replace(',', '.')
            ) || 0;
            const platoFiscale = normalizeFiscalPlato(rawPlato);
            const ettolitriGrado = condizionataHl * platoFiscale;
            const accisaMaturata = ettolitriGrado * effectiveRate;

            rows.push({
                lotto: header?.LOTTO || lotKey,
                dataProd: header?.DATA_PROD || '-',
                dataUltimoConf: pkgInfo.lastDate,
                meseCompetenza: pkgInfo.lastMonth || '-',
                nomeBirra: header?.NOME_BIRRA || 'Lotto Birra',
                cliente: header?.CLIENTE || '-',
                maltiKg: maltKgByLot.get(lotKey) || 0,
                mostoHl,
                condizionataHl,
                caloPercent,
                platoFiscale,
                ettolitriGrado,
                aliquotaApplicata: effectiveRate,
                accisaMaturata,
            });
        });

        rows.sort((a, b) => parseItDateMs(b.dataUltimoConf) - parseItDateMs(a.dataUltimoConf));
        return rows;
    }, [breweryData, selectedMonth, effectiveRate]);

    const exciseTotals = useMemo(() => {
        const maltiKg = exciseRows.reduce((s, r) => s + r.maltiKg, 0);
        const mostoHl = exciseRows.reduce((s, r) => s + r.mostoHl, 0);
        const condizionataHl = exciseRows.reduce((s, r) => s + r.condizionataHl, 0);
        const ettolitriGrado = exciseRows.reduce((s, r) => s + r.ettolitriGrado, 0);
        const accisaMaturata = exciseRows.reduce((s, r) => s + r.accisaMaturata, 0);
        const highLossCount = exciseRows.filter(r => r.caloPercent > 10).length;
        return { maltiKg, mostoHl, condizionataHl, ettolitriGrado, accisaMaturata, highLossCount };
    }, [exciseRows]);

    // --- TAB 3: COMUNICAZIONE PREVENTIVA DISTRUZIONE MERCE & RECUPERO ACCISA ADM ---
    const admDestructionRows = useMemo<AdmDestructionRow[]>(() => {
        if (!breweryData) return [];

        const headerByLot = new Map<string, BreweryData['COTTE_HEAD'][number]>();
        (breweryData.COTTE_HEAD || []).forEach(h => {
            headerByLot.set((h.LOTTO || '').toUpperCase().trim(), h);
        });

        const reasonLabels: Record<string, string> = {
            SCADENZA_TMC: 'Superamento TMC (Scaduta)',
            OSSIDAZIONE_DIFETTO: 'Ossidazione / Difetto Organolettico',
            CONTESTAZIONE_CLIENTE: 'Lotto Contestato / Non Conforme',
            ROTTURA_PERDITA: 'Rottura / Perdita Accidentale Cella',
            CAMPIONATURA_ANALISI: 'Prelievo Analisi / Campionatura',
        };

        const wasteMovements = (breweryData.BEER_MOVEMENTS || []).filter(
            m =>
                m.type === 'WASTE' &&
                m.quantita < 0 &&
                (destructionMonth === 'ALL' || extractMonthFromItDate(m.data) === destructionMonth)
        );

        return wasteMovements
            .map(m => {
                const qtyUnits = Math.abs(m.quantita);
                const litriTotali = qtyUnits * getUnitLiters(m.formato);
                const ettolitri = litriTotali / 100;
                const header = headerByLot.get((m.lotto || '').toUpperCase().trim());
                const rawPlato = parseFloat(
                    String(header?.PLATO_FISCALE || header?.PLATO_INIZIALE || '12').replace(',', '.')
                ) || 12;
                const platoFiscale = normalizeFiscalPlato(rawPlato);
                const ettolitriGrado = ettolitri * platoFiscale;
                const accisaRecuperabile = ettolitriGrado * effectiveRate;

                return {
                    id: m.id,
                    dataScarico: m.data,
                    lotto: m.lotto,
                    nomeBirra: m.nomeBirra,
                    cliente: m.cliente,
                    formato: m.formato,
                    quantitaUnita: qtyUnits,
                    litriTotali,
                    ettolitri,
                    platoFiscale,
                    ettolitriGrado,
                    aliquotaApplicata: effectiveRate,
                    accisaRecuperabile,
                    causaleLabel: reasonLabels[m.wasteReason || 'OSSIDAZIONE_DIFETTO'] || 'Non Conformità Prodotto',
                    note: m.notes,
                };
            })
            .sort((a, b) => parseItDateMs(b.dataScarico) - parseItDateMs(a.dataScarico));
    }, [breweryData, destructionMonth, effectiveRate]);

    const activeDestructionRowsForPrint = useMemo(() => {
        if (selectedWasteIds.length === 0) return admDestructionRows;
        const set = new Set(selectedWasteIds);
        return admDestructionRows.filter(r => set.has(r.id));
    }, [admDestructionRows, selectedWasteIds]);

    // --- TAB 2: FATTURAZIONE RIEPILOGATIVA DDT & XML FATTURAPA ---
    const unbilledOrders = useMemo<PackagedBeerOrder[]>(() => {
        if (!breweryData) return [];
        return (breweryData.PACKAGED_BEER_ORDERS || [])
            .filter(o => !o.status || o.status === 'DDT_EMESSO')
            .filter(o => billingClient === 'ALL' || o.client === billingClient)
            .filter(o => billingMonth === 'ALL' || extractMonthFromItDate(o.date) === billingMonth)
            .sort((a, b) => parseItDateMs(b.date) - parseItDateMs(a.date));
    }, [breweryData, billingClient, billingMonth]);

    const clientsWithUnbilled = useMemo(() => {
        const set = new Set<string>();
        (breweryData?.PACKAGED_BEER_ORDERS || []).forEach(o => {
            if (!o.status || o.status === 'DDT_EMESSO') set.add(o.client);
        });
        return Array.from(set).sort();
    }, [breweryData]);

    const selectedOrdersForBilling = useMemo(
        () =>
            (breweryData?.PACKAGED_BEER_ORDERS || []).filter(o =>
                selectedOrderIds.includes(o.id)
            ),
        [breweryData, selectedOrderIds]
    );

    const toggleOrderSelection = (order: PackagedBeerOrder) => {
        if (selectedOrderIds.includes(order.id)) {
            setSelectedOrderIds(prev => prev.filter(id => id !== order.id));
            return;
        }
        // Enforce single client per summary invoice
        if (selectedOrdersForBilling.length > 0 && selectedOrdersForBilling[0].client !== order.client) {
            showToast(
                `Una fattura riepilogativa può includere solo DDT dello stesso cliente (${selectedOrdersForBilling[0].client}).`,
                'warning'
            );
            return;
        }
        setSelectedOrderIds(prev => [...prev, order.id]);
    };

    const handleSelectAllClientUnbilled = () => {
        if (unbilledOrders.length === 0) return;
        const targetClient =
            billingClient !== 'ALL' ? billingClient : unbilledOrders[0].client;
        const matching = unbilledOrders.filter(o => o.client === targetClient).map(o => o.id);
        setSelectedOrderIds(matching);
        if (billingClient === 'ALL') setBillingClient(targetClient);
    };

    const handleCreateSummaryInvoice = async () => {
        if (!breweryData) return;
        if (selectedOrdersForBilling.length === 0) {
            showToast('Seleziona almeno un ordine / DDT da fatturare.', 'error');
            return;
        }
        if (!invoiceNum.trim()) {
            showToast('Inserisci il numero progressivo della fattura.', 'error');
            return;
        }

        const targetClient = selectedOrdersForBilling[0].client;
        const sortedOrders = [...selectedOrdersForBilling].sort(
            (a, b) => parseItDateMs(a.date) - parseItDateMs(b.date)
        );

        const ddtReferences: SummaryInvoiceDdtRef[] = sortedOrders.map(ord => ({
            orderId: ord.id,
            numeroDdt: ord.numeroDdt || ord.id,
            dataDdt: ord.date,
        }));

        const lines: SummaryInvoiceLine[] = [];
        sortedOrders.forEach(ord => {
            (ord.items || []).forEach(it => {
                lines.push({
                    descrizione: it.beerName,
                    formato: it.format,
                    lotto: it.lotto,
                    quantita: it.quantity,
                    prezzoUnitario: it.price,
                    imponibile: it.total,
                    aliquotaIva: 22,
                    ddtOrderId: ord.id,
                });
            });
        });

        const imponibileTotale = Number(
            lines.reduce((s, l) => s + l.imponibile, 0).toFixed(2)
        );
        const ivaTotale = Number((imponibileTotale * 0.22).toFixed(2));
        const totaleDocumento = Number((imponibileTotale + ivaTotale).toFixed(2));

        const newInvoice: SummaryInvoice = {
            id: `INV_${Date.now()}`,
            numeroFattura: invoiceNum.trim(),
            dataEmissione: isoToIt(issueDateIso),
            dataScadenzaPagamento: isoToIt(dueDateIso),
            cliente: targetClient,
            orderIds: sortedOrders.map(o => o.id),
            ddtReferences,
            lines,
            imponibileTotale,
            ivaTotale,
            totaleDocumento,
            modalitaPagamento: paymentMethod,
            statoPagamento: 'DA_INCASSARE',
            note: invoiceNote.trim() || undefined,
        };

        const includedSet = new Set(newInvoice.orderIds);
        const updatedOrders = (breweryData.PACKAGED_BEER_ORDERS || []).map(ord =>
            includedSet.has(ord.id)
                ? {
                      ...ord,
                      status: 'FATTURATO' as const,
                      invoiceId: newInvoice.id,
                      invoiceNumber: newInvoice.numeroFattura,
                  }
                : ord
        );

        const nextInvoices = [newInvoice, ...(breweryData.SUMMARY_INVOICES || [])];
        const updatedData: BreweryData = {
            ...breweryData,
            PACKAGED_BEER_ORDERS: updatedOrders,
            SUMMARY_INVOICES: nextInvoices,
        };

        await saveBreweryData(selectedYear, updatedData);
        setBreweryData(updatedData);
        setSelectedOrderIds([]);
        setInvoiceNote('');
        setInvoiceNum(getNextInvoiceNumber(updatedData, selectedYear).numeroFattura);
        showToast(
            `Fattura differita ${newInvoice.numeroFattura} generata (${newInvoice.orderIds.length} DDT riepilogati).`,
            'success'
        );
        onRefresh?.();
    };

    const handleToggleInvoicePaid = async (invoice: SummaryInvoice) => {
        if (!breweryData) return;
        const markPaid = invoice.statoPagamento !== 'INCASSATA';
        const nextStatus = markPaid ? 'INCASSATA' : 'DA_INCASSARE';
        const nextOrderStatus = markPaid ? ('PAGATO' as const) : ('FATTURATO' as const);
        const orderSet = new Set(invoice.orderIds);

        const updatedInvoices = (breweryData.SUMMARY_INVOICES || []).map(inv =>
            inv.id === invoice.id
                ? {
                      ...inv,
                      statoPagamento: nextStatus as 'DA_INCASSARE' | 'INCASSATA',
                      dataIncasso: markPaid ? new Date().toLocaleDateString('it-IT') : undefined,
                  }
                : inv
        );

        const updatedOrders = (breweryData.PACKAGED_BEER_ORDERS || []).map(ord =>
            orderSet.has(ord.id) ? { ...ord, status: nextOrderStatus } : ord
        );

        const updated: BreweryData = {
            ...breweryData,
            SUMMARY_INVOICES: updatedInvoices,
            PACKAGED_BEER_ORDERS: updatedOrders,
        };
        await saveBreweryData(selectedYear, updated);
        setBreweryData(updated);
        showToast(
            markPaid
                ? `Fattura ${invoice.numeroFattura} registrata come incassata.`
                : `Fattura ${invoice.numeroFattura} riaperta tra i crediti da incassare.`,
            'success'
        );
        onRefresh?.();
    };

    const handleDeleteInvoice = async (invoice: SummaryInvoice) => {
        if (!breweryData) return;
        const orderSet = new Set(invoice.orderIds);
        const updatedInvoices = (breweryData.SUMMARY_INVOICES || []).filter(
            inv => inv.id !== invoice.id
        );
        const updatedOrders = (breweryData.PACKAGED_BEER_ORDERS || []).map(ord =>
            orderSet.has(ord.id)
                ? {
                      ...ord,
                      status: 'DDT_EMESSO' as const,
                      invoiceId: undefined,
                      invoiceNumber: undefined,
                  }
                : ord
        );

        const updated: BreweryData = {
            ...breweryData,
            SUMMARY_INVOICES: updatedInvoices,
            PACKAGED_BEER_ORDERS: updatedOrders,
        };
        await saveBreweryData(selectedYear, updated);
        setBreweryData(updated);
        setInvoiceNum(getNextInvoiceNumber(updated, selectedYear).numeroFattura);
        showToast(
            `Fattura ${invoice.numeroFattura} annullata; i ${invoice.orderIds.length} DDT sono nuovamente fatturabili.`,
            'success'
        );
        onRefresh?.();
    };

    const handleSaveInlineInvoiceNum = async (invoice: SummaryInvoice) => {
        if (!breweryData) return;
        const trimmed = inlineInvoiceNumVal.trim();
        if (!trimmed) {
            showToast('Inserisci un numero fattura valido (es. FT-001/2026).', 'error');
            return;
        }
        const orderSet = new Set(invoice.orderIds);
        const updatedInvoices = (breweryData.SUMMARY_INVOICES || []).map(inv =>
            inv.id === invoice.id ? { ...inv, numeroFattura: trimmed } : inv
        );
        const updatedOrders = (breweryData.PACKAGED_BEER_ORDERS || []).map(ord =>
            orderSet.has(ord.id) ? { ...ord, invoiceNumber: trimmed } : ord
        );
        const updated: BreweryData = {
            ...breweryData,
            SUMMARY_INVOICES: updatedInvoices,
            PACKAGED_BEER_ORDERS: updatedOrders,
        };
        await saveBreweryData(selectedYear, updated);
        setBreweryData(updated);
        setInvoiceNum(getNextInvoiceNumber(updated, selectedYear).numeroFattura);
        setInlineEditInvoiceId(null);
        setInlineInvoiceNumVal('');
        showToast(`Numero fattura aggiornato a ${trimmed}.`, 'success');
        onRefresh?.();
    };

    if (!breweryData) {
        return <div className="p-8 text-center text-slate-300">Caricamento modulo fiscale e fatturazione...</div>;
    }

    const monthLabel =
        ITALIAN_MONTHS.find(m => m.value === selectedMonth)?.label || 'Intero Anno';
    const invoices = breweryData.SUMMARY_INVOICES || [];
    const todayMs = Date.now();
    const totalInvoicedGross = invoices.reduce((s, i) => s + i.totaleDocumento, 0);
    const totalPendingGross = invoices
        .filter(i => i.statoPagamento === 'DA_INCASSARE')
        .reduce((s, i) => s + i.totaleDocumento, 0);
    const totalOverdueGross = invoices
        .filter(
            i =>
                i.statoPagamento === 'DA_INCASSARE' &&
                parseItDateMs(i.dataScadenzaPagamento) > 0 &&
                parseItDateMs(i.dataScadenzaPagamento) < todayMs
        )
        .reduce((s, i) => s + i.totaleDocumento, 0);

    const previewSubtotal = selectedOrdersForBilling.reduce((s, o) => s + o.totalNet, 0);

    return (
        <div className="space-y-6">
            {/* Header & Tab Bar */}
            <div className="bg-brew-dark p-5 rounded-lg border border-slate-700 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                <div>
                    <div className="flex items-center gap-2.5">
                        <ScaleIcon className="w-7 h-7 text-brew-accent" />
                        <h1 className="text-2xl font-bold text-white tracking-tight">
                            Registro Accise ADM &amp; Fatturazione Differita SDI
                        </h1>
                    </div>
                    <p className="text-sm text-slate-400 mt-1">
                        Liquidazione ettolitri-grado birra condizionata (TUA D.Lgs. 504/95) · Fatture riepilogative da DDT e tracciato XML FatturaPA
                    </p>
                </div>

                <div className="inline-flex flex-wrap rounded-md border border-slate-600 bg-brew-dark-secondary p-0.5 text-xs sm:text-sm">
                    <button
                        type="button"
                        onClick={() => setActiveTab('ACCISE_ADM')}
                        className={`px-3.5 py-2 rounded font-bold transition-colors whitespace-nowrap ${
                            activeTab === 'ACCISE_ADM'
                                ? 'bg-brew-accent text-brew-dark'
                                : 'text-slate-300 hover:text-white'
                        }`}
                    >
                        Registro Accise Dogane (ADM)
                    </button>
                    <button
                        type="button"
                        onClick={() => setActiveTab('DISTRUZIONE_ADM')}
                        className={`px-3.5 py-2 rounded font-bold transition-colors whitespace-nowrap ${
                            activeTab === 'DISTRUZIONE_ADM'
                                ? 'bg-amber-500 text-slate-950'
                                : 'text-slate-300 hover:text-white'
                        }`}
                    >
                        Distruzione Merce &amp; Recupero Accisa ({admDestructionRows.length})
                    </button>
                    <button
                        type="button"
                        onClick={() => setActiveTab('FATTURAZIONE_DDT')}
                        className={`px-3.5 py-2 rounded font-bold transition-colors whitespace-nowrap ${
                            activeTab === 'FATTURAZIONE_DDT'
                                ? 'bg-brew-blue text-white'
                                : 'text-slate-300 hover:text-white'
                        }`}
                    >
                        Fatture Differite DDT &amp; XML SDI
                    </button>
                </div>
            </div>

            {activeTab === 'ACCISE_ADM' ? (
                <div className="space-y-5">
                    {/* Excise Parameters & Export Toolbar */}
                    <div className="bg-brew-dark p-5 rounded-lg border border-slate-700 space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
                            <div className="md:col-span-3">
                                <label className="block text-xs font-bold uppercase text-slate-400 mb-1">
                                    Codice Ditta / Accisa ADM
                                </label>
                                <input
                                    type="text"
                                    value={codiceAccisaDraft}
                                    onChange={e => setCodiceAccisaDraft(e.target.value)}
                                    placeholder="Es. IT00...A"
                                    className="w-full bg-brew-dark-secondary border border-slate-600 rounded px-3 py-2 text-sm font-mono text-white"
                                />
                            </div>
                            <div className="md:col-span-5">
                                <label className="block text-xs font-bold uppercase text-slate-400 mb-1">
                                    Scaglione Produzione Annua Birrificio Artigianale
                                </label>
                                <select
                                    value={bracketDraft}
                                    onChange={e => setBracketDraft(e.target.value as ExciseBracket)}
                                    className="w-full bg-brew-dark-secondary border border-slate-600 rounded px-3 py-2 text-sm text-white"
                                >
                                    {EXCISE_BRACKET_OPTIONS.map(opt => (
                                        <option key={opt.value} value={opt.value}>
                                            {opt.label} ({opt.reductionLabel} — € {opt.rateEurHlPlato.toFixed(3)}/hL°P)
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className="md:col-span-2">
                                <label className="block text-xs font-bold uppercase text-slate-400 mb-1">
                                    Periodo Competenza
                                </label>
                                <select
                                    value={selectedMonth}
                                    onChange={e => setSelectedMonth(e.target.value)}
                                    className="w-full bg-brew-dark-secondary border border-slate-600 rounded px-3 py-2 text-sm text-white"
                                >
                                    {ITALIAN_MONTHS.map(m => (
                                        <option key={m.value} value={m.value}>
                                            {m.label}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className="md:col-span-2">
                                <button
                                    type="button"
                                    onClick={handleSaveExciseSettings}
                                    className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded bg-brew-green text-white font-bold text-sm hover:opacity-90"
                                >
                                    <CheckIcon className="w-4 h-4" />
                                    Salva Regime
                                </button>
                            </div>
                        </div>

                        {/* KPI Summary Strip */}
                        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 pt-2 border-t border-slate-700 font-mono tabular-nums">
                            <div className="bg-brew-dark-secondary p-3 rounded border border-slate-700">
                                <div className="text-[11px] font-sans uppercase text-slate-400">Aliquota Applicata</div>
                                <div className="text-lg font-bold text-white mt-0.5">
                                    € {effectiveRate.toFixed(3)} <span className="text-xs text-slate-400">/hL·°P</span>
                                </div>
                            </div>
                            <div className="bg-brew-dark-secondary p-3 rounded border border-slate-700">
                                <div className="text-[11px] font-sans uppercase text-slate-400">Malti Scaricati</div>
                                <div className="text-lg font-bold text-white mt-0.5">
                                    {exciseTotals.maltiKg.toFixed(1)} kg
                                </div>
                            </div>
                            <div className="bg-brew-dark-secondary p-3 rounded border border-slate-700">
                                <div className="text-[11px] font-sans uppercase text-slate-400">Birra Condizionata</div>
                                <div className="text-lg font-bold text-sky-400 mt-0.5">
                                    {exciseTotals.condizionataHl.toFixed(3)} hL
                                </div>
                            </div>
                            <div className="bg-brew-dark-secondary p-3 rounded border border-slate-700">
                                <div className="text-[11px] font-sans uppercase text-slate-400">Ettolitri-Grado</div>
                                <div className="text-lg font-bold text-white mt-0.5">
                                    {exciseTotals.ettolitriGrado.toFixed(2)} hL·°P
                                </div>
                            </div>
                            <div className="bg-brew-dark-secondary p-3 rounded border border-slate-700">
                                <div className="text-[11px] font-sans uppercase text-slate-400">Accisa Maturata</div>
                                <div className="text-lg font-bold text-brew-accent mt-0.5">
                                    € {exciseTotals.accisaMaturata.toFixed(2)}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Excise Register Table */}
                    <div className="bg-brew-dark p-5 rounded-lg border border-slate-700 space-y-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                                <h2 className="text-lg font-bold text-white">
                                    Prospetto Lotti Condizionati — {monthLabel} {selectedYear} ({exciseRows.length} lotti)
                                </h2>
                                <p className="text-xs text-slate-400">
                                    Il Grado Plato fiscale è troncato al decimo di grado. I cali di lavorazione superiori alla franchigia del 10% sono evidenziati.
                                </p>
                            </div>
                            <div className="flex items-center gap-2.5">
                                <button
                                    type="button"
                                    disabled={exciseRows.length === 0}
                                    onClick={() =>
                                        exportExciseRegisterToExcel(
                                            selectedYear,
                                            monthLabel,
                                            { ...profile, codiceAccisa: codiceAccisaDraft || profile.codiceAccisa },
                                            exciseRows
                                        )
                                    }
                                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded border border-slate-600 bg-brew-dark-secondary hover:bg-slate-700 text-sm font-semibold text-white disabled:opacity-40"
                                >
                                    <ArrowDownTrayIcon className="w-4 h-4" />
                                    Esporta Excel
                                </button>
                                <button
                                    type="button"
                                    disabled={exciseRows.length === 0}
                                    onClick={() =>
                                        printExciseRegisterA4({
                                            year: selectedYear,
                                            monthFilterLabel: monthLabel,
                                            profile: { ...profile, codiceAccisa: codiceAccisaDraft || profile.codiceAccisa },
                                            bracketLabel: activeBracketOption.label,
                                            rateEurHlPlato: effectiveRate,
                                            rows: exciseRows,
                                        })
                                    }
                                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded bg-brew-accent text-brew-dark font-bold text-sm hover:opacity-90 disabled:opacity-40"
                                >
                                    <PrinterIcon className="w-4 h-4" />
                                    Stampa Prospetto A4
                                </button>
                            </div>
                        </div>

                        <div className="overflow-x-auto">
                            <table className="w-full text-sm text-left">
                                <thead className="text-xs uppercase text-slate-400 border-b border-slate-700">
                                    <tr>
                                        <th className="py-2 pr-3">Lotto</th>
                                        <th className="py-2 px-2">Ult. Conf.</th>
                                        <th className="py-2 px-3">Birra &amp; Proprietà</th>
                                        <th className="py-2 px-2 text-right">Malti (kg)</th>
                                        <th className="py-2 px-2 text-right">Mosto (hL)</th>
                                        <th className="py-2 px-2 text-right">Condiz. (hL)</th>
                                        <th className="py-2 px-2 text-right">Calo %</th>
                                        <th className="py-2 px-2 text-right">°P Fisc.</th>
                                        <th className="py-2 px-2 text-right">hL·°Plato</th>
                                        <th className="py-2 pl-3 text-right">Accisa (€)</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-800 font-mono tabular-nums">
                                    {exciseRows.length === 0 ? (
                                        <tr>
                                            <td colSpan={10} className="py-8 text-center font-sans text-slate-400">
                                                Nessun confezionamento registrato nel periodo selezionato ({monthLabel} {selectedYear}).
                                            </td>
                                        </tr>
                                    ) : (
                                        exciseRows.map(r => (
                                            <tr key={r.lotto} className="hover:bg-brew-dark-secondary/50">
                                                <td className="py-2.5 pr-3 font-bold text-brew-accent">{r.lotto}</td>
                                                <td className="py-2.5 px-2 text-slate-300 text-xs">{r.dataUltimoConf}</td>
                                                <td className="py-2.5 px-3 font-sans">
                                                    <span className="font-semibold text-white">{r.nomeBirra}</span>
                                                    <span className="text-xs text-slate-400"> · {r.cliente}</span>
                                                </td>
                                                <td className="py-2.5 px-2 text-right text-slate-300">{r.maltiKg.toFixed(1)}</td>
                                                <td className="py-2.5 px-2 text-right text-slate-300">{r.mostoHl.toFixed(2)}</td>
                                                <td className="py-2.5 px-2 text-right text-sky-400 font-semibold">
                                                    {r.condizionataHl.toFixed(3)}
                                                </td>
                                                <td
                                                    className={`py-2.5 px-2 text-right ${
                                                        r.caloPercent > 10
                                                            ? 'text-amber-400 font-bold'
                                                            : 'text-slate-300'
                                                    }`}
                                                    title={
                                                        r.caloPercent > 10
                                                            ? 'Calo superiore alla tolleranza ordinaria del 10%'
                                                            : undefined
                                                    }
                                                >
                                                    {r.caloPercent.toFixed(1)}%
                                                </td>
                                                <td className="py-2.5 px-2 text-right text-white">{r.platoFiscale.toFixed(1)}</td>
                                                <td className="py-2.5 px-2 text-right text-white">
                                                    {r.ettolitriGrado.toFixed(2)}
                                                </td>
                                                <td className="py-2.5 pl-3 text-right font-bold text-brew-accent">
                                                    € {r.accisaMaturata.toFixed(2)}
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            ) : activeTab === 'DISTRUZIONE_ADM' ? (
                /* TAB 3: COMUNICAZIONE PREVENTIVA DISTRUZIONE MERCE & RECUPERO ACCISA ADM */
                <div className="space-y-5">
                    <div className="bg-brew-dark p-5 rounded-lg border border-slate-700 space-y-4">
                        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-slate-700 pb-3">
                            <div>
                                <h2 className="text-lg font-bold text-white">
                                    Comunicazione Preventiva di Distruzione Birra &amp; Recupero Accisa (PEC Agenzia Dogane)
                                </h2>
                                <p className="text-xs text-slate-400 mt-0.5">
                                    Raccoglie in automatico i lotti scaricati come <strong>Scarto / Scaduti TMC / Ossidati / Contestati</strong> dal Magazzino Birra o dall&apos;Inventario e calcola gli Ettolitri-Grado e l&apos;Accisa recuperabile.
                                </p>
                            </div>
                            <div className="flex items-center gap-2">
                                <select
                                    value={destructionMonth}
                                    onChange={e => {
                                        setDestructionMonth(e.target.value);
                                        setSelectedWasteIds([]);
                                    }}
                                    className="bg-brew-dark-secondary border border-slate-600 rounded px-3 py-2 text-sm text-white"
                                >
                                    {ITALIAN_MONTHS.map(m => (
                                        <option key={m.value} value={m.value}>
                                            Periodo scarichi: {m.label}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        {/* Estremi Comunicazione PEC Dogane */}
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-sm">
                            <div>
                                <label className="block text-xs font-bold text-slate-400 mb-1">
                                    Ufficio delle Dogane Destinatario
                                </label>
                                <input
                                    type="text"
                                    value={ufficioDogane}
                                    onChange={e => setUfficioDogane(e.target.value)}
                                    placeholder="es. Ufficio delle Dogane di..."
                                    className="w-full bg-brew-dark-secondary border border-slate-600 rounded px-3 py-2 text-sm text-white"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-400 mb-1">
                                    Data e Ora Prevista Distruzione
                                </label>
                                <input
                                    type="text"
                                    value={dataPrevistaDistruzione}
                                    onChange={e => setDataPrevistaDistruzione(e.target.value)}
                                    placeholder="es. 25/11/2026 ore 10:00"
                                    className="w-full bg-brew-dark-secondary border border-slate-600 rounded px-3 py-2 text-sm text-white font-mono"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-400 mb-1">
                                    Luogo Operazioni
                                </label>
                                <input
                                    type="text"
                                    value={luogoDistruzione}
                                    onChange={e => setLuogoDistruzione(e.target.value)}
                                    placeholder={profile.indirizzo || 'Sede birrificio / deposito'}
                                    className="w-full bg-brew-dark-secondary border border-slate-600 rounded px-3 py-2 text-sm text-white"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-400 mb-1">
                                    Modalità Distruzione / Smaltimento
                                </label>
                                <input
                                    type="text"
                                    value={modalitaSmaltimento}
                                    onChange={e => setModalitaSmaltimento(e.target.value)}
                                    className="w-full bg-brew-dark-secondary border border-slate-600 rounded px-3 py-2 text-sm text-white"
                                />
                            </div>
                        </div>

                        {/* KPI Recupero Accisa */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t border-slate-700 font-mono tabular-nums">
                            <div className="bg-brew-dark-secondary p-3 rounded border border-slate-700">
                                <div className="text-[11px] font-sans uppercase text-slate-400">Partite Incluse</div>
                                <div className="text-lg font-bold text-white mt-0.5">
                                    {activeDestructionRowsForPrint.length} <span className="text-xs font-sans text-slate-400">scarichi</span>
                                </div>
                            </div>
                            <div className="bg-brew-dark-secondary p-3 rounded border border-slate-700">
                                <div className="text-[11px] font-sans uppercase text-slate-400">Birra Da Distruggere</div>
                                <div className="text-lg font-bold text-amber-300 mt-0.5">
                                    {activeDestructionRowsForPrint.reduce((s, r) => s + r.ettolitri, 0).toFixed(3)} hL
                                </div>
                            </div>
                            <div className="bg-brew-dark-secondary p-3 rounded border border-slate-700">
                                <div className="text-[11px] font-sans uppercase text-slate-400">Ettolitri-Grado</div>
                                <div className="text-lg font-bold text-white mt-0.5">
                                    {activeDestructionRowsForPrint.reduce((s, r) => s + r.ettolitriGrado, 0).toFixed(2)} hL·°P
                                </div>
                            </div>
                            <div className="bg-brew-dark-secondary p-3 rounded border border-slate-700">
                                <div className="text-[11px] font-sans uppercase text-slate-400">Accisa Recuperabile</div>
                                <div className="text-lg font-bold text-emerald-400 mt-0.5">
                                    € {activeDestructionRowsForPrint.reduce((s, r) => s + r.accisaRecuperabile, 0).toFixed(2)}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Tabella Partite Scartate / Scadute */}
                    <div className="bg-brew-dark p-5 rounded-lg border border-slate-700 space-y-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                                <h3 className="text-base font-bold text-white">
                                    Elenco Partite Scartate / Scadute / Contestate ({admDestructionRows.length})
                                </h3>
                                <p className="text-xs text-slate-400">
                                    Spunta specifiche partite oppure lascia tutto deselezionato per includere l&apos;intero elenco nel modulo A4 per la PEC alle Dogane.
                                </p>
                            </div>
                            <div className="flex items-center gap-2.5">
                                <button
                                    type="button"
                                    disabled={activeDestructionRowsForPrint.length === 0}
                                    onClick={() =>
                                        exportAdmDestructionToExcel(
                                            selectedYear,
                                            { ...profile, codiceAccisa: codiceAccisaDraft || profile.codiceAccisa },
                                            activeDestructionRowsForPrint
                                        )
                                    }
                                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded border border-slate-600 bg-brew-dark-secondary hover:bg-slate-700 text-sm font-semibold text-white disabled:opacity-40"
                                >
                                    <ArrowDownTrayIcon className="w-4 h-4" />
                                    Esporta Excel
                                </button>
                                <button
                                    type="button"
                                    disabled={activeDestructionRowsForPrint.length === 0}
                                    onClick={() =>
                                        printAdmDestructionNoticeA4({
                                            year: selectedYear,
                                            profile: { ...profile, codiceAccisa: codiceAccisaDraft || profile.codiceAccisa },
                                            ufficioDoganeDestinatario: ufficioDogane,
                                            dataPrevistaDistruzione,
                                            luogoDistruzione: luogoDistruzione || profile.indirizzo,
                                            modalitaSmaltimento,
                                            rateEurHlPlato: effectiveRate,
                                            rows: activeDestructionRowsForPrint,
                                        })
                                    }
                                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-sm disabled:opacity-40"
                                >
                                    <PrinterIcon className="w-4 h-4" />
                                    Stampa Comunicazione PEC Dogane (A4)
                                </button>
                            </div>
                        </div>

                        <div className="overflow-x-auto">
                            <table className="w-full text-sm text-left">
                                <thead className="text-xs uppercase text-slate-400 border-b border-slate-700">
                                    <tr>
                                        <th className="py-2 pr-2 w-8">Sel.</th>
                                        <th className="py-2 px-2">Data</th>
                                        <th className="py-2 px-2">Lotto</th>
                                        <th className="py-2 px-3">Birra &amp; Formato</th>
                                        <th className="py-2 px-2">Causale Scarto</th>
                                        <th className="py-2 px-2 text-right">Q.tà</th>
                                        <th className="py-2 px-2 text-right">Volume (hL)</th>
                                        <th className="py-2 px-2 text-right">°P Fisc.</th>
                                        <th className="py-2 px-2 text-right">hL·°Plato</th>
                                        <th className="py-2 pl-3 text-right">Accisa (€)</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-800 font-mono tabular-nums">
                                    {admDestructionRows.length === 0 ? (
                                        <tr>
                                            <td colSpan={10} className="py-8 text-center font-sans text-slate-400">
                                                Nessun lotto registrato come scarto/distruzione nel periodo selezionato. Quando scarichi una birra scaduta o ossidata da &quot;Magazzino Birra&quot;, comparirà automaticamente qui pronta per il recupero accisa.
                                            </td>
                                        </tr>
                                    ) : (
                                        admDestructionRows.map(r => {
                                            const checked = selectedWasteIds.includes(r.id);
                                            return (
                                                <tr
                                                    key={r.id}
                                                    onClick={() =>
                                                        setSelectedWasteIds(prev =>
                                                            prev.includes(r.id)
                                                                ? prev.filter(id => id !== r.id)
                                                                : [...prev, r.id]
                                                        )
                                                    }
                                                    className={`cursor-pointer transition-colors ${
                                                        checked ? 'bg-slate-800/80' : 'hover:bg-brew-dark-secondary/50'
                                                    }`}
                                                >
                                                    <td className="py-2.5 pr-2">
                                                        <input
                                                            type="checkbox"
                                                            checked={checked}
                                                            onChange={() => {}}
                                                            className="rounded border-slate-500"
                                                        />
                                                    </td>
                                                    <td className="py-2.5 px-2 text-xs text-slate-300">{r.dataScarico}</td>
                                                    <td className="py-2.5 px-2 font-bold text-brew-accent">{r.lotto}</td>
                                                    <td className="py-2.5 px-3 font-sans">
                                                        <span className="font-semibold text-white">{r.nomeBirra}</span>
                                                        <span className="text-xs text-slate-400"> · {r.formato}</span>
                                                    </td>
                                                    <td className="py-2.5 px-2 font-sans text-xs text-amber-300">
                                                        {r.causaleLabel}
                                                    </td>
                                                    <td className="py-2.5 px-2 text-right text-slate-200">{r.quantitaUnita}</td>
                                                    <td className="py-2.5 px-2 text-right text-amber-300 font-semibold">
                                                        {r.ettolitri.toFixed(3)}
                                                    </td>
                                                    <td className="py-2.5 px-2 text-right text-white">{r.platoFiscale.toFixed(1)}</td>
                                                    <td className="py-2.5 px-2 text-right text-white">{r.ettolitriGrado.toFixed(2)}</td>
                                                    <td className="py-2.5 pl-3 text-right font-bold text-emerald-400">
                                                        € {r.accisaRecuperabile.toFixed(2)}
                                                    </td>
                                                </tr>
                                            );
                                        })
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            ) : (
                /* TAB 2: FATTURAZIONE DIFFERITA RIEPILOGATIVA DDT & XML FATTURAPA */
                <div className="space-y-6">
                    {/* Receivables Summary Strip */}
                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 font-mono tabular-nums">
                        <div className="bg-brew-dark p-4 rounded-lg border border-slate-700">
                            <div className="text-xs font-sans uppercase text-slate-400">DDT Da Fatturare</div>
                            <div className="text-2xl font-bold text-white mt-1">
                                {(breweryData.PACKAGED_BEER_ORDERS || []).filter(
                                    o => !o.status || o.status === 'DDT_EMESSO'
                                ).length}
                            </div>
                        </div>
                        <div className="bg-brew-dark p-4 rounded-lg border border-slate-700">
                            <div className="text-xs font-sans uppercase text-slate-400">Totale Fatturato {selectedYear}</div>
                            <div className="text-2xl font-bold text-sky-400 mt-1">
                                € {totalInvoicedGross.toFixed(2)}
                            </div>
                        </div>
                        <div className="bg-brew-dark p-4 rounded-lg border border-slate-700">
                            <div className="text-xs font-sans uppercase text-slate-400">Crediti Da Incassare</div>
                            <div className="text-2xl font-bold text-brew-accent mt-1">
                                € {totalPendingGross.toFixed(2)}
                            </div>
                        </div>
                        <div className="bg-brew-dark p-4 rounded-lg border border-slate-700">
                            <div className="text-xs font-sans uppercase text-slate-400">Scaduto Non Incassato</div>
                            <div className={`text-2xl font-bold mt-1 ${totalOverdueGross > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                                € {totalOverdueGross.toFixed(2)}
                            </div>
                        </div>
                    </div>

                    {/* Generator Grid: Left = Select Unbilled DDTs, Right = Issue Summary Invoice */}
                    <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
                        <div className="xl:col-span-7 bg-brew-dark p-5 rounded-lg border border-slate-700 space-y-4">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <div>
                                    <h2 className="text-lg font-bold text-white">
                                        1. Seleziona Ordini / DDT da Riepilogare
                                    </h2>
                                    <p className="text-xs text-slate-400">
                                        Seleziona uno o più DDT dello stesso cliente emessi nel mese per generare la Fattura Differita (TD24).
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={handleSelectAllClientUnbilled}
                                    disabled={unbilledOrders.length === 0}
                                    className="px-3 py-1.5 rounded bg-brew-dark-secondary border border-slate-600 hover:bg-slate-700 text-xs font-bold text-white disabled:opacity-40"
                                >
                                    Seleziona tutti del cliente
                                </button>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <select
                                    value={billingClient}
                                    onChange={e => {
                                        setBillingClient(e.target.value);
                                        setSelectedOrderIds([]);
                                    }}
                                    className="bg-brew-dark-secondary border border-slate-600 rounded px-3 py-2 text-sm text-white"
                                >
                                    <option value="ALL">Tutti i Clienti con DDT aperti ({clientsWithUnbilled.length})</option>
                                    {clientsWithUnbilled.map(c => (
                                        <option key={c} value={c}>
                                            {c}
                                        </option>
                                    ))}
                                </select>

                                <select
                                    value={billingMonth}
                                    onChange={e => setBillingMonth(e.target.value)}
                                    className="bg-brew-dark-secondary border border-slate-600 rounded px-3 py-2 text-sm text-white"
                                >
                                    {ITALIAN_MONTHS.map(m => (
                                        <option key={m.value} value={m.value}>
                                            Mese DDT: {m.label}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div className="overflow-x-auto max-h-80 overflow-y-auto">
                                <table className="w-full text-sm text-left">
                                    <thead className="text-xs uppercase text-slate-400 border-b border-slate-700">
                                        <tr>
                                            <th className="py-2 pr-2 w-8">Sel.</th>
                                            <th className="py-2 px-2">Data</th>
                                            <th className="py-2 px-2">Rif. Ordine / DDT</th>
                                            <th className="py-2 px-2">Cliente</th>
                                            <th className="py-2 px-2 text-right">Righe</th>
                                            <th className="py-2 pl-2 text-right">Imponibile</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-800">
                                        {unbilledOrders.length === 0 ? (
                                            <tr>
                                                <td colSpan={6} className="py-6 text-center text-slate-400">
                                                    Nessun ordine confezionato in attesa di fatturazione per i filtri selezionati.
                                                </td>
                                            </tr>
                                        ) : (
                                            unbilledOrders.map(ord => {
                                                const checked = selectedOrderIds.includes(ord.id);
                                                return (
                                                    <tr
                                                        key={ord.id}
                                                        onClick={() => toggleOrderSelection(ord)}
                                                        className={`cursor-pointer transition-colors ${
                                                            checked
                                                                ? 'bg-slate-800/90'
                                                                : 'hover:bg-brew-dark-secondary/50'
                                                        }`}
                                                    >
                                                        <td className="py-2.5 pr-2">
                                                            <input
                                                                type="checkbox"
                                                                checked={checked}
                                                                onChange={() => {}}
                                                                className="rounded border-slate-500"
                                                            />
                                                        </td>
                                                        <td className="py-2.5 px-2 font-mono tabular-nums text-slate-300">
                                                            {ord.date}
                                                        </td>
                                                        <td className="py-2.5 px-2 font-mono tabular-nums text-xs text-brew-accent font-semibold">
                                                            {ord.numeroDdt ? `DDT ${ord.numeroDdt}` : `DDT da assegnare (${ord.id})`}
                                                        </td>
                                                        <td className="py-2.5 px-2 font-semibold text-white">
                                                            {ord.client}
                                                        </td>
                                                        <td className="py-2.5 px-2 text-right font-mono tabular-nums text-slate-300">
                                                            {ord.items.length}
                                                        </td>
                                                        <td className="py-2.5 pl-2 text-right font-mono tabular-nums font-bold text-white">
                                                            € {ord.totalNet.toFixed(2)}
                                                        </td>
                                                    </tr>
                                                );
                                            })
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        {/* Right: Invoice Emission Parameters */}
                        <div className="xl:col-span-5 bg-brew-dark p-5 rounded-lg border border-slate-700 space-y-4">
                            <h2 className="text-lg font-bold text-white">
                                2. Estremi Fattura Differita (TD24)
                            </h2>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-bold uppercase text-slate-400 mb-1">
                                        Numero Fattura
                                    </label>
                                    <input
                                        type="text"
                                        value={invoiceNum}
                                        onChange={e => setInvoiceNum(e.target.value)}
                                        className="w-full bg-brew-dark-secondary border border-slate-600 rounded px-3 py-2 text-sm font-mono text-white"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold uppercase text-slate-400 mb-1">
                                        Data Emissione
                                    </label>
                                    <input
                                        type="date"
                                        value={issueDateIso}
                                        onChange={e => setIssueDateIso(e.target.value)}
                                        className="w-full bg-brew-dark-secondary border border-slate-600 rounded px-3 py-2 text-sm font-mono tabular-nums text-white"
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-bold uppercase text-slate-400 mb-1">
                                        Modalità Pagamento SDI
                                    </label>
                                    <select
                                        value={paymentMethod}
                                        onChange={e =>
                                            setPaymentMethod(e.target.value as 'MP05' | 'MP12' | 'MP01')
                                        }
                                        className="w-full bg-brew-dark-secondary border border-slate-600 rounded px-3 py-2 text-sm text-white"
                                    >
                                        <option value="MP05">Bonifico Bancario (MP05)</option>
                                        <option value="MP12">Ri.Ba. Ricevuta Bancaria (MP12)</option>
                                        <option value="MP01">Rimessa Diretta / Contanti (MP01)</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-bold uppercase text-slate-400 mb-1">
                                        Scadenza Pagamento
                                    </label>
                                    <input
                                        type="date"
                                        value={dueDateIso}
                                        onChange={e => setDueDateIso(e.target.value)}
                                        className="w-full bg-brew-dark-secondary border border-slate-600 rounded px-3 py-2 text-sm font-mono tabular-nums text-white"
                                    />
                                </div>
                            </div>

                            <div className="flex items-center gap-2 text-xs">
                                <span className="text-slate-400">Termini rapidi:</span>
                                <button
                                    type="button"
                                    onClick={() => setDueDateIso(addDaysIso(issueDateIso, 30, false))}
                                    className="px-2 py-1 rounded bg-brew-dark-secondary border border-slate-600 text-slate-200 hover:text-white"
                                >
                                    30 gg D.F.
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setDueDateIso(addDaysIso(issueDateIso, 30, true))}
                                    className="px-2 py-1 rounded bg-brew-dark-secondary border border-slate-600 text-slate-200 hover:text-white"
                                >
                                    30 gg D.F.F.M.
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setDueDateIso(addDaysIso(issueDateIso, 60, true))}
                                    className="px-2 py-1 rounded bg-brew-dark-secondary border border-slate-600 text-slate-200 hover:text-white"
                                >
                                    60 gg D.F.F.M.
                                </button>
                            </div>

                            <div className="bg-brew-dark-secondary p-4 rounded border border-slate-700 space-y-1.5 font-mono tabular-nums text-sm">
                                <div className="flex justify-between text-slate-300">
                                    <span className="font-sans">Cliente:</span>
                                    <span className="font-sans font-bold text-white">
                                        {selectedOrdersForBilling[0]?.client || 'Nessun DDT selezionato'}
                                    </span>
                                </div>
                                <div className="flex justify-between text-slate-300">
                                    <span className="font-sans">DDT selezionati:</span>
                                    <span>{selectedOrdersForBilling.length}</span>
                                </div>
                                <div className="flex justify-between text-slate-300">
                                    <span className="font-sans">Imponibile Netto:</span>
                                    <span>€ {previewSubtotal.toFixed(2)}</span>
                                </div>
                                <div className="flex justify-between text-slate-300">
                                    <span className="font-sans">IVA 22%:</span>
                                    <span>€ {(previewSubtotal * 0.22).toFixed(2)}</span>
                                </div>
                                <div className="flex justify-between text-base font-bold text-brew-accent pt-1.5 border-t border-slate-700">
                                    <span className="font-sans">Totale Documento:</span>
                                    <span>€ {(previewSubtotal * 1.22).toFixed(2)}</span>
                                </div>
                            </div>

                            <button
                                type="button"
                                disabled={selectedOrdersForBilling.length === 0}
                                onClick={handleCreateSummaryInvoice}
                                className="w-full py-2.5 px-4 rounded-md bg-brew-blue hover:bg-sky-500 text-white font-bold text-sm transition-colors disabled:opacity-40"
                            >
                                Genera Fattura Differita Riepilogativa
                            </button>
                        </div>
                    </div>

                    {/* Issued Summary Invoices & Receivables Table */}
                    <div className="bg-brew-dark p-5 rounded-lg border border-slate-700 space-y-4">
                        <h2 className="text-lg font-bold text-white">
                            Archivio Fatture Differite &amp; Scadenzario Incassi ({invoices.length})
                        </h2>

                        <div className="overflow-x-auto">
                            <table className="w-full text-sm text-left">
                                <thead className="text-xs uppercase text-slate-400 border-b border-slate-700">
                                    <tr>
                                        <th className="py-2 pr-3">N. Fattura</th>
                                        <th className="py-2 px-2">Data</th>
                                        <th className="py-2 px-3">Cliente</th>
                                        <th className="py-2 px-2">DDT Inclusi</th>
                                        <th className="py-2 px-2">Scadenza</th>
                                        <th className="py-2 px-2 text-right">Totale IVA Incl.</th>
                                        <th className="py-2 px-3">Stato Incasso</th>
                                        <th className="py-2 pl-2 text-right">XML SDI / Stampa / Azioni</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-800">
                                    {invoices.length === 0 ? (
                                        <tr>
                                            <td colSpan={8} className="py-6 text-center text-slate-400">
                                                Nessuna fattura riepilogativa emessa nell&apos;anno {selectedYear}.
                                            </td>
                                        </tr>
                                    ) : (
                                        invoices.map(inv => {
                                            const clientObj = (breweryData.CLIENTI || []).find(
                                                c =>
                                                    c.nome.trim().toUpperCase() ===
                                                    inv.cliente.trim().toUpperCase()
                                            );
                                            const isOverdue =
                                                inv.statoPagamento === 'DA_INCASSARE' &&
                                                parseItDateMs(inv.dataScadenzaPagamento) > 0 &&
                                                parseItDateMs(inv.dataScadenzaPagamento) < todayMs;

                                            return (
                                                <tr key={inv.id} className="hover:bg-brew-dark-secondary/50">
                                                    <td className="py-2.5 pr-3 font-mono tabular-nums font-bold text-brew-accent">
                                                        {inlineEditInvoiceId === inv.id ? (
                                                            <div className="flex items-center gap-1">
                                                                <input
                                                                    type="text"
                                                                    value={inlineInvoiceNumVal}
                                                                    onChange={e => setInlineInvoiceNumVal(e.target.value)}
                                                                    onKeyDown={e => {
                                                                        if (e.key === 'Enter') handleSaveInlineInvoiceNum(inv);
                                                                        if (e.key === 'Escape') {
                                                                            setInlineEditInvoiceId(null);
                                                                            setInlineInvoiceNumVal('');
                                                                        }
                                                                    }}
                                                                    className="w-28 bg-brew-dark-secondary border border-brew-accent rounded px-1.5 py-0.5 text-xs font-mono text-white"
                                                                    autoFocus
                                                                />
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleSaveInlineInvoiceNum(inv)}
                                                                    className="px-1.5 py-0.5 rounded bg-emerald-600 text-white text-[11px] font-bold"
                                                                >
                                                                    Salva
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => setInlineEditInvoiceId(null)}
                                                                    className="px-1.5 py-0.5 rounded bg-slate-600 text-white text-[11px]"
                                                                >
                                                                    Annulla
                                                                </button>
                                                            </div>
                                                        ) : (
                                                            <div className="flex items-center gap-1.5">
                                                                <span>{inv.numeroFattura}</span>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => {
                                                                        setInlineEditInvoiceId(inv.id);
                                                                        setInlineInvoiceNumVal(inv.numeroFattura || '');
                                                                    }}
                                                                    className="text-[10px] font-sans font-normal text-sky-300 hover:text-sky-200 underline"
                                                                >
                                                                    Modifica N°
                                                                </button>
                                                            </div>
                                                        )}
                                                    </td>
                                                    <td className="py-2.5 px-2 font-mono tabular-nums text-slate-300">
                                                        {inv.dataEmissione}
                                                    </td>
                                                    <td className="py-2.5 px-3 font-semibold text-white">
                                                        {inv.cliente}
                                                    </td>
                                                    <td className="py-2.5 px-2 font-mono tabular-nums text-xs text-slate-300">
                                                        {inv.ddtReferences.length} DDT
                                                    </td>
                                                    <td
                                                        className={`py-2.5 px-2 font-mono tabular-nums text-xs ${
                                                            isOverdue ? 'text-rose-400 font-bold' : 'text-slate-300'
                                                        }`}
                                                    >
                                                        {inv.dataScadenzaPagamento}
                                                        {isOverdue ? ' · Scaduta' : ''}
                                                    </td>
                                                    <td className="py-2.5 px-2 text-right font-mono tabular-nums font-bold text-white">
                                                        € {inv.totaleDocumento.toFixed(2)}
                                                    </td>
                                                    <td className="py-2.5 px-3 text-xs font-semibold">
                                                        {inv.statoPagamento === 'INCASSATA' ? (
                                                            <span className="text-emerald-400">
                                                                Incassata ({inv.dataIncasso || ''})
                                                            </span>
                                                        ) : (
                                                            <span className="text-amber-400">Da Incassare</span>
                                                        )}
                                                    </td>
                                                    <td className="py-2.5 pl-2 text-right">
                                                        <div className="inline-flex items-center gap-1.5">
                                                            <button
                                                                type="button"
                                                                onClick={() =>
                                                                    downloadFatturaPaXml(inv, profile, clientObj)
                                                                }
                                                                className="px-2.5 py-1 rounded bg-brew-accent text-brew-dark text-xs font-bold hover:opacity-90"
                                                                title="Scarica file XML FatturaPA v1.2.2 (TD24) per Sistema di Interscambio SDI"
                                                            >
                                                                XML SDI
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() =>
                                                                    printCourtesyInvoiceA4(inv, profile, clientObj)
                                                                }
                                                                className="px-2.5 py-1 rounded border border-slate-600 bg-brew-dark-secondary hover:bg-slate-700 text-xs font-semibold text-white"
                                                                title="Stampa copia di cortesia A4"
                                                            >
                                                                PDF A4
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() => handleToggleInvoicePaid(inv)}
                                                                className={`px-2.5 py-1 rounded text-xs font-bold text-white ${
                                                                    inv.statoPagamento === 'INCASSATA'
                                                                        ? 'bg-slate-600 hover:bg-slate-500'
                                                                        : 'bg-emerald-700 hover:bg-emerald-600'
                                                                }`}
                                                            >
                                                                {inv.statoPagamento === 'INCASSATA'
                                                                    ? 'Riapri'
                                                                    : 'Incassa'}
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() => handleDeleteInvoice(inv)}
                                                                className="p-1 text-slate-400 hover:text-rose-400"
                                                                title="Annulla fattura e rimetti i DDT come da fatturare"
                                                            >
                                                                <TrashIcon className="w-4 h-4" />
                                                            </button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            );
                                        })
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
