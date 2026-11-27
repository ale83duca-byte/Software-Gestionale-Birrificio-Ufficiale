import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
    getBreweryData,
    saveBreweryData,
    getInternalClientName,
    getEffectiveBreweryProfile,
    DEFAULT_BREWERY_PROFILE,
    syncOrderSteelKegLogs,
    removeOrderSteelKegLogs,
    getNextDdtNumber,
    normalizeDdtInput,
    syncDdtCountersForYear,
    assignMissingSalesDdtsForYear,
} from '../services/dataService';
import type { Cliente, PackagedBeerOrder, PackagedBeerOrderItem, BeerMovement, BeerPriceList, ClientOffer, BreweryProfile, BeerLotStatusOverride, BrewHeader } from '../types';
import { useToast } from '../hooks/useToast';
import { PlusIcon, TrashIcon, DocumentTextIcon } from './icons';
import { exportPackagedBeerOrderToExcel } from '../utils/excelExport';
import { printOrderDDT } from '../utils/ddtPrint';
import { computeDualLocationBeerStock, parseItDateSafe } from '../utils/beerStockEngine';
import { resolveEffectiveSellingPrice } from '../utils/pricingEngine';

interface PackagedBeerOrdersViewProps {
    selectedYear: string;
    onRefresh: () => void;
}

type LocalBeerStockItem = {
    lotto: string;
    formato: string;
    quantita: number;
    dataScadenza: string;
};

type StockByBeer = Record<string, LocalBeerStockItem[]>;

export const PackagedBeerOrdersView: React.FC<PackagedBeerOrdersViewProps> = ({ selectedYear, onRefresh }) => {
    
    const { showToast } = useToast();
    const [view, setView] = useState<'dashboard' | 'new'>('dashboard');
    const [isLoading, setIsLoading] = useState(true);
    
    const [orders, setOrders] = useState<PackagedBeerOrder[]>([]);
    const [clients, setClients] = useState<Cliente[]>([]);
    const [alvereseStock, setAlvereseStock] = useState<StockByBeer>({});
    const [priceList, setPriceList] = useState<BeerPriceList[]>([]);
    const [clientOffers, setClientOffers] = useState<ClientOffer[]>([]);
    const [internalClientName, setInternalClientName] = useState('ALVERESE');
    const [breweryProfile, setBreweryProfile] = useState<BreweryProfile>({ ...DEFAULT_BREWERY_PROFILE });
    
    const [selectedClient, setSelectedClient] = useState('');
    const [orderDate, setOrderDate] = useState(new Date().toISOString().slice(0, 10));
    const [ddtNumberInput, setDdtNumberInput] = useState('');
    const [suggestedNextDdt, setSuggestedNextDdt] = useState(`1/${selectedYear}`);
    const [inlineEditOrderId, setInlineEditOrderId] = useState<string | null>(null);
    const [inlineDdtValue, setInlineDdtValue] = useState('');
    const [orderItems, setOrderItems] = useState<PackagedBeerOrderItem[]>([{ beerName: '', lotto: '', format: '', quantity: 0, price: 0, total: 0 }]);
    const [editingOrder, setEditingOrder] = useState<PackagedBeerOrder | null>(null);

    const [lotOverrides, setLotOverrides] = useState<BeerLotStatusOverride[]>([]);
    const [cotteHeads, setCotteHeads] = useState<BrewHeader[]>([]);

    const loadData = useCallback(async () => {
        setIsLoading(true);
        const data = await getBreweryData(selectedYear);
        if (data) {
            const internalName = getInternalClientName(data);
            setInternalClientName(internalName);
            setBreweryProfile(getEffectiveBreweryProfile(data));
            setClients(data.CLIENTI || []);
            const nextSalesDdt = getNextDdtNumber(data, selectedYear, 'SALES');
            setSuggestedNextDdt(nextSalesDdt.numeroDdt);
            setOrders(
                (data.PACKAGED_BEER_ORDERS || []).slice().sort((a, b) => {
                    const dA = new Date(a.date.split('/').reverse().join('-')).getTime() || 0;
                    const dB = new Date(b.date.split('/').reverse().join('-')).getTime() || 0;
                    if (dB !== dA) return dB - dA;
                    return (b.ddtSeqNumber || 0) - (a.ddtSeqNumber || 0);
                })
            );
            setPriceList(data.BEER_PRICE_LIST || []);
            setClientOffers(data.CLIENT_OFFERS || []);
            setCotteHeads(data.COTTE_HEAD || []);
            const overrides = data.BEER_LOT_OVERRIDES || [];
            setLotOverrides(overrides);

            const blockedKeys = new Set(
                overrides.filter(o => o.status === 'CONTESTATO_BLOCCATO').map(o => o.key)
            );

            // Legge esclusivamente la merce pronta alla vendita nel Magazzino Centrale (escludendo i lotti contestati/bloccati e quelli ancora in rifermentazione in birrificio)
            const dualStock = computeDualLocationBeerStock(data);
            const stock: StockByBeer = {};
            dualStock.centralSalesStock.forEach(item => {
                if (item.cliente.trim().toUpperCase() !== internalName.toUpperCase()) return;
                const ovKey = `${item.cliente}|${item.nomeBirra}|${item.lotto}|${item.formato}`;
                if (blockedKeys.has(ovKey)) return;
                if (!stock[item.nomeBirra]) stock[item.nomeBirra] = [];
                stock[item.nomeBirra].push({
                    lotto: item.lotto,
                    formato: item.formato,
                    quantita: item.quantita,
                    dataScadenza: item.dataScadenza,
                });
            });
            setAlvereseStock(stock);
        }
        setIsLoading(false);
    }, [selectedYear]);

    useEffect(() => { loadData(); }, [loadData]);

    const getPrice = useCallback((clientName: string, beerName: string, format: string, lotto?: string) => {
        const client = clients.find(c => c.nome === clientName);
        const offer = client ? clientOffers.find(o => o.clientId === client.id) || null : null;

        const resolved = resolveEffectiveSellingPrice({
            data: {
                BEER_LOT_OVERRIDES: lotOverrides,
                COTTE_HEAD: cotteHeads,
                BEER_PRICE_LIST: priceList,
            },
            cliente: internalClientName,
            beerName,
            lotto,
            format,
            clientOffer: offer,
        });

        return resolved.unitPrice;
    }, [clients, clientOffers, priceList, lotOverrides, cotteHeads, internalClientName]);

    // Update prices when client changes
    useEffect(() => {
        if (selectedClient) {
            setOrderItems(prevItems => prevItems.map(item => {
                if (item.beerName && item.format) {
                    const newPrice = getPrice(selectedClient, item.beerName, item.format, item.lotto);
                    return { ...item, price: newPrice, total: item.quantity * newPrice };
                }
                return item;
            }));
        }
    }, [selectedClient, getPrice]);

    const handleItemChange = (index: number, field: keyof PackagedBeerOrderItem, value: string | number) => {
        const newItems = [...orderItems];
        const currentItem = { ...newItems[index], [field]: value };

        if (field === 'beerName') {
            currentItem.lotto = '';
            currentItem.format = '';
            currentItem.price = 0;
        } else if (field === 'lotto') {
            currentItem.format = '';
        } else if (field === 'format') {
            // Auto-fetch price when format changes (including Promo TMC override if set on the lot)
            const price = getPrice(selectedClient, currentItem.beerName, value as string, currentItem.lotto);
            currentItem.price = price;
        } else if (field === 'quantity') {
             if (currentItem.price === 0 && currentItem.format && selectedClient) {
                 const price = getPrice(selectedClient, currentItem.beerName, currentItem.format, currentItem.lotto);
                 if (price > 0) currentItem.price = price;
             }
        }

        // Recalculate total for the row
        if (field === 'quantity' || field === 'price' || field === 'format') {
             const qty = field === 'quantity' ? Number(value) : currentItem.quantity;
             const price = field === 'price' ? Number(value) : currentItem.price;
             currentItem.total = qty * price;
        }

        newItems[index] = currentItem;
        setOrderItems(newItems);
    };

    const addItem = () => setOrderItems([...orderItems, { beerName: '', lotto: '', format: '', quantity: 0, price: 0, total: 0 }]);
    const removeItem = (index: number) => setOrderItems(orderItems.filter((_, i) => i !== index));

    const availableBeers = useMemo(() => Object.keys(alvereseStock), [alvereseStock]);

    const getLottoExpiry = (beerName: string, lotto: string, format?: string): string => {
        if (!beerName || !lotto || !alvereseStock[beerName]) return '';
        const matching = alvereseStock[beerName].filter(
            item => item.lotto === lotto && (!format || item.formato === format) && item.dataScadenza
        );
        return matching[0]?.dataScadenza || '';
    };

    // Ordina sempre i lotti per criterio FEFO (First-Expired, First-Out: scadenza più ravvicinata in cima)
    const availableLottos = (beerName: string) => {
        if (!beerName || !alvereseStock[beerName]) return [];
        const uniqueLottos = [...new Set(alvereseStock[beerName].map(item => item.lotto))];
        return uniqueLottos.sort((a, b) => {
            const expA = parseItDateSafe(getLottoExpiry(beerName, a))?.getTime() ?? Number.MAX_SAFE_INTEGER;
            const expB = parseItDateSafe(getLottoExpiry(beerName, b))?.getTime() ?? Number.MAX_SAFE_INTEGER;
            return expA - expB;
        });
    };

    const getFefoBetterLotSuggestion = (beerName: string, selectedLotto: string, format: string) => {
        if (!beerName || !selectedLotto || !alvereseStock[beerName]) return null;
        const selectedExpMs = parseItDateSafe(getLottoExpiry(beerName, selectedLotto, format || undefined))?.getTime();
        if (!selectedExpMs) return null;

        const candidates = alvereseStock[beerName].filter(item => {
            if (item.lotto === selectedLotto || item.quantita <= 0) return false;
            if (format && item.formato !== format) return false;
            const ms = parseItDateSafe(item.dataScadenza)?.getTime();
            return !!ms && ms < selectedExpMs;
        });

        if (candidates.length === 0) return null;
        candidates.sort(
            (a, b) =>
                (parseItDateSafe(a.dataScadenza)?.getTime() || 0) -
                (parseItDateSafe(b.dataScadenza)?.getTime() || 0)
        );
        return candidates[0];
    };

    const availableFormats = (beerName: string, lotto: string) => {
        if (!beerName || !lotto || !alvereseStock[beerName]) return [];
        const formats = alvereseStock[beerName]
            .filter(item => item.lotto === lotto)
            .map(item => item.formato);
        return [...new Set(formats)];
    };

    const getAvailableQuantity = (beerName: string, lotto: string, format: string) => {
        if (!beerName || !lotto || !format) return 0;
        return alvereseStock[beerName]
            ?.filter(item => item.lotto === lotto && item.formato === format)
            .reduce((sum, item) => sum + item.quantita, 0) || 0;
    };

    const applyFefoSuggestion = (index: number, suggestedLotto: string, suggestedFormat: string) => {
        const newItems = [...orderItems];
        const current = { ...newItems[index], lotto: suggestedLotto };
        const validFormats = availableFormats(current.beerName, suggestedLotto);
        const nextFormat = current.format && validFormats.includes(current.format)
            ? current.format
            : suggestedFormat;
        current.format = nextFormat;
        const nextPrice = getPrice(selectedClient, current.beerName, nextFormat, suggestedLotto);
        current.price = nextPrice;
        current.total = (current.quantity || 0) * nextPrice;
        newItems[index] = current;
        setOrderItems(newItems);
    };

    const calculateTotals = () => {
        const totalNet = orderItems.reduce((sum, item) => sum + item.total, 0);
        const iva = totalNet * 0.22; // Assuming 22% VAT
        const totalGross = totalNet + iva;
        return { totalNet, iva, totalGross };
    };

    const { totalNet, iva, totalGross } = calculateTotals();

    const handleEditOrder = (order: PackagedBeerOrder) => {
        setEditingOrder(order);
        setSelectedClient(order.client);
        const [day, month, year] = order.date.split('/');
        setOrderDate(`${year}-${month}-${day}`);
        setDdtNumberInput(order.numeroDdt || '');
        setOrderItems(order.items.map(item => ({ ...item })));
        setView('new');
    };

    const handleSaveOrder = async () => {
        if (!selectedClient || orderItems.some(i => !i.beerName || !i.lotto || !i.format || !i.quantity)) {
            showToast("Cliente e tutti i campi degli articoli sono obbligatori.", 'error'); return;
        }

        const orderId = editingOrder ? editingOrder.id : `ORD_VEND_${Date.now()}`;
        const [year, month, day] = orderDate.split('-');
        const formattedDate = `${day}/${month}/${year}`;

        // Stock Validation
        const stockCheckMap = new Map<string, { required: number, available: number, refund: number }>();
        for (const item of orderItems) {
            if (item.quantity <= 0) continue;
            const key = `${item.beerName}|${item.lotto}|${item.format}`;
            const current = stockCheckMap.get(key) || { required: 0, available: 0, refund: 0 };
            current.required += item.quantity;
            stockCheckMap.set(key, current);
        }

        for (const key of stockCheckMap.keys()) {
            const [beerName, lotto, format] = key.split('|');
            const available = getAvailableQuantity(beerName, lotto, format);
            
            let refund = 0;
            if (editingOrder) {
                editingOrder.items.forEach(i => {
                    if (i.beerName === beerName && i.lotto === lotto && i.format === format) {
                        refund += i.quantity;
                    }
                });
            }
            
            const current = stockCheckMap.get(key)!;
            current.available = available;
            current.refund = refund;
            stockCheckMap.set(key, current);
        }

        for (const [key, data] of stockCheckMap.entries()) {
            const [beerName, lotto, format] = key.split('|');
            if (data.required > (data.available + data.refund)) {
                 showToast(`Stock insufficiente per ${beerName} (Lotto: ${lotto}, ${format}). Disponibili: ${data.available + data.refund}, Richiesti: ${data.required}`, 'error');
                 return;
            }
        }

        const newMovements: BeerMovement[] = [];
        for (const item of orderItems) {
             if (item.quantity <= 0) continue;

            // Movement OUT from internal brewery client in Magazzino Centrale (Sale)
            newMovements.push({
                id: `MOV_VEND_${Date.now()}_${newMovements.length}_OUT`,
                data: formattedDate,
                type: 'SALE',
                location: 'MAGAZZINO_CENTRALE',
                cliente: internalClientName,
                nomeBirra: item.beerName,
                lotto: item.lotto,
                formato: item.format,
                quantita: -item.quantity,
                relatedDocId: orderId,
                destinatario: selectedClient
            });
        }
        
        const data = await getBreweryData(selectedYear);
        if (!data) return;

        let numeroDdt = '';
        let ddtSeqNumber = 0;
        const trimmedInput = ddtNumberInput.trim();
        if (trimmedInput) {
            const normalized = normalizeDdtInput(trimmedInput, selectedYear, 'SALES');
            numeroDdt = normalized.numeroDdt;
            ddtSeqNumber = normalized.seq;
        } else {
            const nextDdt = getNextDdtNumber(data, selectedYear, 'SALES');
            numeroDdt = nextDdt.numeroDdt;
            ddtSeqNumber = nextDdt.seq;
        }

        const duplicateHit =
            (data.PACKAGED_BEER_ORDERS || []).some(
                o => o.id !== orderId && (o.numeroDdt || '').trim().toUpperCase() === numeroDdt.toUpperCase()
            ) ||
            (data.SALES_ORDERS || []).some(
                o => (o.numeroDdt || '').trim().toUpperCase() === numeroDdt.toUpperCase()
            );
        if (
            duplicateHit &&
            !window.confirm(`Il DDT N° ${numeroDdt} risulta già presente nell'archivio ${selectedYear}. Vuoi comunque salvare con questo numero?`)
        ) {
            return;
        }

        const newOrder: PackagedBeerOrder = {
            id: orderId,
            numeroDdt,
            ddtSeqNumber,
            date: formattedDate,
            client: selectedClient,
            items: orderItems.filter(i => i.quantity > 0),
            totalNet,
            iva,
            totalGross,
            status: editingOrder?.status || 'DDT_EMESSO',
            invoiceId: editingOrder?.invoiceId,
            invoiceNumber: editingOrder?.invoiceNumber,
        };
        
        let updatedOrders = data.PACKAGED_BEER_ORDERS || [];
        let updatedMovements = data.BEER_MOVEMENTS || [];

        if (editingOrder) {
            updatedOrders = updatedOrders.filter(o => o.id !== editingOrder.id);
            updatedMovements = updatedMovements.filter(m => m.relatedDocId !== editingOrder.id);
        }

        updatedOrders.push(newOrder);
        updatedMovements.push(...newMovements);
        
        data.PACKAGED_BEER_ORDERS = updatedOrders;
        data.BEER_MOVEMENTS = updatedMovements;

        if (newOrder.invoiceId && Array.isArray(data.SUMMARY_INVOICES)) {
            data.SUMMARY_INVOICES = data.SUMMARY_INVOICES.map(inv =>
                inv.id === newOrder.invoiceId
                    ? {
                          ...inv,
                          ddtReferences: (inv.ddtReferences || []).map(ref =>
                              ref.orderId === newOrder.id
                                  ? { ...ref, numeroDdt, dataDdt: formattedDate }
                                  : ref
                          ),
                      }
                    : inv
            );
        }

        syncDdtCountersForYear(data, selectedYear);
        syncOrderSteelKegLogs(
            data,
            orderId,
            formattedDate,
            selectedClient,
            newOrder.items.map(it => ({ format: it.format, quantity: it.quantity, lotto: it.lotto, beerName: it.beerName }))
        );
        await saveBreweryData(selectedYear, data);

        showToast(`Ordine salvato con successo (DDT N° ${numeroDdt})!`, 'success');
        
        // Generate Excel with real BreweryProfile & Client details
        try {
             const clientDetails = clients.find(c => c.nome === newOrder.client);
             exportPackagedBeerOrderToExcel(newOrder, breweryProfile, clientDetails);
             showToast("Bolla d'accompagno (Excel) generata.", 'info');
        } catch (e) {
            console.error(e);
            showToast("Errore generazione Excel.", 'error');
        }

        onRefresh();
        await loadData();
        setView('dashboard');
        setSelectedClient('');
        setDdtNumberInput('');
        setOrderItems([{ beerName: '', lotto: '', format: '', quantity: 0, price: 0, total: 0 }]);
        setEditingOrder(null);
    };

    const handleSaveInlineDdt = async (order: PackagedBeerOrder) => {
        const trimmed = inlineDdtValue.trim();
        if (!trimmed) {
            showToast('Inserisci un numero di DDT valido (es. 1/2025 oppure solo 1).', 'error');
            return;
        }
        const data = await getBreweryData(selectedYear);
        if (!data) return;

        const { numeroDdt, seq } = normalizeDdtInput(trimmed, selectedYear, 'SALES');
        const duplicateHit =
            (data.PACKAGED_BEER_ORDERS || []).some(
                o => o.id !== order.id && (o.numeroDdt || '').trim().toUpperCase() === numeroDdt.toUpperCase()
            ) ||
            (data.SALES_ORDERS || []).some(
                o => (o.numeroDdt || '').trim().toUpperCase() === numeroDdt.toUpperCase()
            );
        if (
            duplicateHit &&
            !window.confirm(`Il DDT N° ${numeroDdt} risulta già usato in un altro documento del ${selectedYear}. Confermi comunque?`)
        ) {
            return;
        }

        data.PACKAGED_BEER_ORDERS = (data.PACKAGED_BEER_ORDERS || []).map(o =>
            o.id === order.id ? { ...o, numeroDdt, ddtSeqNumber: seq } : o
        );
        if (order.invoiceId && Array.isArray(data.SUMMARY_INVOICES)) {
            data.SUMMARY_INVOICES = data.SUMMARY_INVOICES.map(inv =>
                inv.id === order.invoiceId
                    ? {
                          ...inv,
                          ddtReferences: (inv.ddtReferences || []).map(ref =>
                              ref.orderId === order.id ? { ...ref, numeroDdt } : ref
                          ),
                      }
                    : inv
            );
        }
        syncDdtCountersForYear(data, selectedYear);
        await saveBreweryData(selectedYear, data);

        setInlineEditOrderId(null);
        setInlineDdtValue('');
        showToast(`Numero DDT aggiornato a ${numeroDdt}.`, 'success');
        onRefresh();
        await loadData();
    };

    const handleBackfillMissingDdts = async () => {
        const missingCount = orders.filter(o => !o.numeroDdt || !o.numeroDdt.trim()).length;
        if (missingCount === 0) return;
        if (
            !window.confirm(
                `Ci sono ${missingCount} ordini/commissioni senza numero DDT nell'anno ${selectedYear}. Vuoi assegnare automaticamente una numerazione progressiva in ordine cronologico (partendo da ${suggestedNextDdt})? Potrai comunque modificare ogni singolo numero in seguito.`
            )
        ) {
            return;
        }
        const updatedCount = await assignMissingSalesDdtsForYear(selectedYear);
        showToast(`Assegnati ${updatedCount} numeri DDT progressivi ai documenti storici.`, 'success');
        onRefresh();
        await loadData();
    };

    const handleDeleteOrder = async (order: PackagedBeerOrder) => {
        if (!window.confirm(`Vuoi davvero eliminare/annullare l'ordine del ${order.date} per ${order.client} (€ ${order.totalGross.toFixed(2)})? Le birre scaricate verranno riaccreditate automaticamente a magazzino.`)) {
            return;
        }
        const data = await getBreweryData(selectedYear);
        if (!data) return;

        data.PACKAGED_BEER_ORDERS = (data.PACKAGED_BEER_ORDERS || []).filter(o => o.id !== order.id);
        data.BEER_MOVEMENTS = (data.BEER_MOVEMENTS || []).filter(m => m.relatedDocId !== order.id);
        removeOrderSteelKegLogs(data, order.id);
        syncDdtCountersForYear(data, selectedYear);
        await saveBreweryData(selectedYear, data);

        showToast("Ordine annullato e giacenze ripristinate nel magazzino birra finita.", 'success');
        onRefresh();
        await loadData();
    };

    if(isLoading) return <p>Caricamento...</p>
    
    if (view === 'new') {
        return (
            <div className="space-y-4">
                 <h1 className="text-3xl font-bold text-brew-accent">
                    {editingOrder ? 'Modifica Ordine Birre Confezionate' : 'Nuovo Ordine Birre Confezionate'}
                 </h1>
                 <div className="bg-brew-dark-secondary p-4 rounded-lg shadow-lg">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                        <Field label="Cliente">
                            <select value={selectedClient} onChange={e => setSelectedClient(e.target.value)} className="w-full bg-brew-dark p-2 rounded-md border border-slate-600">
                                <option value="">Seleziona...</option>
                                {clients.map(c => <option key={c.id} value={c.nome}>{c.nome}</option>)}
                            </select>
                        </Field>
                         <Field label="Data Ordine">
                            <input type="date" value={orderDate} onChange={e => setOrderDate(e.target.value)} className="w-full bg-brew-dark p-2 rounded-md border border-slate-600" />
                        </Field>
                        <Field label={`N° DDT (es. ${suggestedNextDdt} o solo numero)`}>
                            <div className="flex gap-1.5">
                                <input
                                    type="text"
                                    value={ddtNumberInput}
                                    onChange={e => setDdtNumberInput(e.target.value)}
                                    placeholder={suggestedNextDdt}
                                    className="w-full bg-brew-dark p-2 rounded-md border border-slate-600 font-mono text-emerald-300"
                                />
                                {!ddtNumberInput && (
                                    <button
                                        type="button"
                                        onClick={() => setDdtNumberInput(suggestedNextDdt)}
                                        className="px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-[11px] font-semibold text-emerald-300 whitespace-nowrap"
                                        title="Applica prossimo progressivo dell'anno"
                                    >
                                        Auto
                                    </button>
                                )}
                            </div>
                        </Field>
                    </div>
                     <h3 className="text-lg font-semibold mb-2">Articoli</h3>
                     <div className="space-y-2.5">
                        {orderItems.map((item, index) => {
                            const fefoHint = getFefoBetterLotSuggestion(item.beerName, item.lotto, item.format);
                            return (
                                <div key={index} className="space-y-1.5">
                                    <div className="grid grid-cols-[1.5fr,1.15fr,1.1fr,0.75fr,0.75fr,0.8fr,auto] gap-2 items-end">
                                        <Field label={index === 0 ? "Birra" : ""}>
                                            <select value={item.beerName} onChange={e => handleItemChange(index, 'beerName', e.target.value)} className="w-full bg-brew-dark p-2 rounded-md border border-slate-600">
                                                <option value="">Seleziona...</option>
                                                {availableBeers.map(b => <option key={b} value={b}>{b}</option>)}
                                            </select>
                                        </Field>
                                        <Field label={index === 0 ? "Lotto (FEFO)" : ""}>
                                            <select value={item.lotto} onChange={e => handleItemChange(index, 'lotto', e.target.value)} className="w-full bg-brew-dark p-2 rounded-md border border-slate-600" disabled={!item.beerName}>
                                                <option value="">Seleziona...</option>
                                                {availableLottos(item.beerName).map(l => {
                                                    const exp = getLottoExpiry(item.beerName, l);
                                                    return (
                                                        <option key={l} value={l}>
                                                            {l}{exp ? ` (TMC ${exp})` : ''}
                                                        </option>
                                                    );
                                                })}
                                            </select>
                                        </Field>
                                        <Field label={index === 0 ? "Formato" : ""}>
                                            <select value={item.format} onChange={e => handleItemChange(index, 'format', e.target.value)} className="w-full bg-brew-dark p-2 rounded-md border border-slate-600" disabled={!item.lotto}>
                                                <option value="">Seleziona...</option>
                                                {availableFormats(item.beerName, item.lotto).map(f => <option key={f} value={f}>{f} (Disp: {getAvailableQuantity(item.beerName, item.lotto, f)})</option>)}
                                            </select>
                                        </Field>
                                        <Field label={index === 0 ? "Quantità" : ""}>
                                             <input type="number" value={item.quantity} onChange={e => handleItemChange(index, 'quantity', e.target.value)} className="w-full bg-brew-dark p-2 rounded-md border border-slate-600 font-mono tabular-nums"/>
                                        </Field>
                                        <Field label={index === 0 ? "Prezzo Unit." : ""}>
                                             <input type="number" step="0.01" value={item.price} onChange={e => handleItemChange(index, 'price', e.target.value)} className="w-full bg-brew-dark p-2 rounded-md border border-slate-600 font-mono tabular-nums"/>
                                        </Field>
                                        <Field label={index === 0 ? "Totale" : ""}>
                                             <div className="w-full bg-brew-dark p-2 rounded-md border border-slate-600 text-right font-mono tabular-nums">
                                                € {item.total.toFixed(2)}
                                             </div>
                                        </Field>
                                        <button onClick={() => removeItem(index)} className="p-2 text-red-500 hover:text-red-400"><TrashIcon className="w-5 h-5"/></button>
                                    </div>
                                    {fefoHint && (
                                        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 rounded-md bg-amber-950/60 border border-amber-500/60 text-xs text-amber-200">
                                            <span>
                                                Consiglio FEFO (rotazione scadenze): in cella è presente il <strong>Lotto {fefoHint.lotto}</strong> ({fefoHint.formato}, disp. <strong>{fefoHint.quantita}</strong>) con scadenza antecedente (TMC <strong>{fefoHint.dataScadenza}</strong>).
                                            </span>
                                            <button
                                                type="button"
                                                onClick={() => applyFefoSuggestion(index, fefoHint.lotto, fefoHint.formato)}
                                                className="px-2.5 py-1 rounded bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs whitespace-nowrap"
                                            >
                                                Passa al Lotto {fefoHint.lotto}
                                            </button>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                    <button onClick={addItem} className="mt-4 flex items-center px-2 py-1 bg-brew-blue rounded-md text-xs hover:bg-opacity-80"><PlusIcon className="w-4 h-4 mr-1"/>Aggiungi Articolo</button>
                    
                    <div className="mt-6 border-t border-slate-600 pt-4 flex flex-col items-end">
                        <div className="w-64 space-y-2">
                            <div className="flex justify-between">
                                <span>Totale Netto:</span>
                                <span className="font-mono">€ {totalNet.toFixed(2)}</span>
                            </div>
                            <div className="flex justify-between text-sm text-gray-400">
                                <span>IVA (22%):</span>
                                <span className="font-mono">€ {iva.toFixed(2)}</span>
                            </div>
                            <div className="flex justify-between text-xl font-bold text-brew-accent border-t border-slate-600 pt-2">
                                <span>Totale + IVA:</span>
                                <span className="font-mono">€ {totalGross.toFixed(2)}</span>
                            </div>
                        </div>
                    </div>

                 </div>
                 <div className="flex justify-between">
                     <button onClick={() => setView('dashboard')} className="px-4 py-2 rounded-md bg-slate-600 font-semibold hover:bg-slate-500">Annulla</button>
                     <button onClick={handleSaveOrder} className="px-6 py-3 rounded-md bg-brew-green font-bold text-lg hover:bg-opacity-90">Salva e Genera Bolla</button>
                 </div>
            </div>
        );
    }

    return (
        <div className="bg-brew-dark-secondary p-4 rounded-lg shadow-lg">
            <div className="flex flex-wrap justify-between items-center gap-3 mb-4">
                <div>
                    <h2 className="text-2xl font-bold text-brew-accent">Ordini Birre Confezionate</h2>
                    <p className="text-xs text-slate-400 mt-0.5">
                        Numerazione DDT progressiva annuale modificabile (riparte da 1 ogni anno). Prossimo DDT {selectedYear}: <span className="font-mono font-bold text-emerald-300">{suggestedNextDdt}</span>.
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    {orders.some(o => !o.numeroDdt || !o.numeroDdt.trim()) && (
                        <button
                            type="button"
                            onClick={handleBackfillMissingDdts}
                            className="bg-amber-600 hover:bg-amber-500 text-white font-semibold py-2 px-3 rounded-md text-xs"
                        >
                            Assegna progressivi DDT ai mancanti
                        </button>
                    )}
                    <button
                        onClick={() => {
                            setEditingOrder(null);
                            setSelectedClient('');
                            setDdtNumberInput(suggestedNextDdt);
                            setOrderItems([{ beerName: '', lotto: '', format: '', quantity: 0, price: 0, total: 0 }]);
                            setView('new');
                        }}
                        className="flex items-center gap-2 bg-brew-green text-white font-bold py-2 px-4 rounded-md hover:bg-opacity-90"
                    >
                        <PlusIcon className="w-5 h-5" /> Nuovo Ordine
                    </button>
                </div>
            </div>
            <div className="overflow-x-auto max-h-[70vh] space-y-4">
                {orders.map(order => (
                    <div key={order.id} className="bg-brew-dark p-4 rounded-lg flex justify-between items-center border border-slate-700 gap-4">
                        <div>
                            <div className="flex flex-wrap items-center gap-2 mb-1">
                                {inlineEditOrderId === order.id ? (
                                    <div className="flex items-center gap-1">
                                        <input
                                            type="text"
                                            value={inlineDdtValue}
                                            onChange={e => setInlineDdtValue(e.target.value)}
                                            onKeyDown={e => {
                                                if (e.key === 'Enter') handleSaveInlineDdt(order);
                                                if (e.key === 'Escape') {
                                                    setInlineEditOrderId(null);
                                                    setInlineDdtValue('');
                                                }
                                            }}
                                            placeholder={`Es. 1/${selectedYear}`}
                                            className="w-28 bg-brew-dark-secondary border border-emerald-500 rounded px-2 py-0.5 text-xs font-mono text-white"
                                            autoFocus
                                        />
                                        <button
                                            type="button"
                                            onClick={() => handleSaveInlineDdt(order)}
                                            className="px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold"
                                        >
                                            Salva
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setInlineEditOrderId(null);
                                                setInlineDdtValue('');
                                            }}
                                            className="px-1.5 py-0.5 rounded bg-slate-600 hover:bg-slate-500 text-white text-[11px]"
                                        >
                                            Annulla
                                        </button>
                                    </div>
                                ) : (
                                    <>
                                        {order.numeroDdt ? (
                                            <span className="px-2 py-0.5 rounded bg-emerald-950/70 border border-emerald-600/60 text-emerald-300 text-xs font-mono font-bold">
                                                DDT N° {order.numeroDdt}
                                            </span>
                                        ) : (
                                            <span className="px-2 py-0.5 rounded bg-amber-950/70 border border-amber-500/60 text-amber-300 text-xs font-mono font-bold">
                                                DDT da assegnare
                                            </span>
                                        )}
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setInlineEditOrderId(order.id);
                                                setInlineDdtValue(order.numeroDdt || '');
                                            }}
                                            className="text-[11px] text-sky-300 hover:text-sky-200 underline"
                                            title="Modifica numero DDT"
                                        >
                                            {order.numeroDdt ? 'Modifica N°' : 'Inserisci N°'}
                                        </button>
                                    </>
                                )}
                                <span className="text-brew-accent font-bold text-lg">{order.client}</span>
                                <span className="text-sm text-gray-400">· {order.date}</span>
                                <span className="text-xs text-slate-300">
                                    · {order.status === 'PAGATO'
                                        ? `Saldato (Fatt. ${order.invoiceNumber || ''})`
                                        : order.status === 'FATTURATO' || order.invoiceNumber
                                            ? `Fatturato N. ${order.invoiceNumber || '-'}`
                                            : 'DDT Emesso (Da fatturare)'}
                                </span>
                            </div>
                            <ul className="text-xs text-gray-300 list-disc pl-4">
                                {order.items.map((item, i) => (
                                    <li key={i}>{item.quantity} x {item.beerName} ({item.format}) - € {item.total.toFixed(2)}</li>
                                ))}
                            </ul>
                        </div>
                        <div className="text-right">
                            <div className="text-xl font-bold text-white mb-2 tabular-nums">€ {order.totalGross.toFixed(2)}</div>
                            <div className="flex flex-wrap justify-end gap-2">
                                <button
                                    onClick={() => printOrderDDT(order, {
                                        profile: breweryProfile,
                                        clientDetails: clients.find(c => c.nome === order.client),
                                        causale: 'Vendita',
                                    })}
                                    className="text-emerald-400 hover:text-emerald-300 font-semibold text-xs border border-emerald-500/80 px-2 py-1 rounded flex items-center gap-1"
                                    title="Stampa o salva in PDF il Documento di Trasporto A4"
                                >
                                    <DocumentTextIcon className="w-4 h-4"/> DDT PDF
                                </button>
                                <button
                                    onClick={() => exportPackagedBeerOrderToExcel(order, breweryProfile, clients.find(c => c.nome === order.client))}
                                    className="text-brew-blue hover:text-blue-400 font-semibold text-xs border border-brew-blue px-2 py-1 rounded flex items-center gap-1"
                                    title="Scarica DDT in formato Excel (.xlsx)"
                                >
                                    <DocumentTextIcon className="w-4 h-4"/> Excel
                                </button>
                                <button onClick={() => handleEditOrder(order)} className="text-brew-orange hover:text-orange-400 font-semibold text-xs border border-brew-orange px-2 py-1 rounded">
                                    Modifica
                                </button>
                                <button onClick={() => handleDeleteOrder(order)} className="text-red-400 hover:text-red-300 font-semibold text-xs border border-red-500/80 px-2 py-1 rounded">
                                    Elimina
                                </button>
                            </div>
                        </div>
                    </div>
                ))}
                {orders.length === 0 && <p className="text-center text-slate-400 mt-8 py-4">Nessun ordine registrato.</p>}
            </div>
        </div>
    );
};

const Field: React.FC<{label: string, children: React.ReactNode}> = ({ label, children }) => (
    <div>
        <label className="block text-xs font-medium text-gray-400 mb-1">{label || '\u00A0'}</label>
        {children}
    </div>
);
