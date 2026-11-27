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
import type { Cliente, SalesOrder, BeerMovement, BreweryProfile, BeerLotStatusOverride } from '../types';
import { useToast } from '../hooks/useToast';
import { PlusIcon, TrashIcon, DocumentTextIcon } from './icons';
import { printOrderDDT } from '../utils/ddtPrint';
import { computeDualLocationBeerStock, parseItDateSafe } from '../utils/beerStockEngine';

interface SalesOrderViewProps {
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
type StockByClient = Record<string, StockByBeer>;

export const SalesOrderView: React.FC<SalesOrderViewProps> = ({ selectedYear, onRefresh }) => {
    const { showToast } = useToast();
    const [view, setView] = useState<'dashboard' | 'new'>('dashboard');
    const [isLoading, setIsLoading] = useState(true);

    const [orders, setOrders] = useState<SalesOrder[]>([]);
    const [clients, setClients] = useState<Cliente[]>([]);
    const [beerStock, setBeerStock] = useState<StockByClient>({});
    const [restingInBreweryLiters, setRestingInBreweryLiters] = useState(0);
    const [internalClientName, setInternalClientName] = useState('ALVERESE');
    const [breweryProfile, setBreweryProfile] = useState<BreweryProfile>({ ...DEFAULT_BREWERY_PROFILE });

    const [selectedClient, setSelectedClient] = useState('');
    const [orderDate, setOrderDate] = useState(new Date().toISOString().slice(0, 10));
    const [deliveryMode, setDeliveryMode] = useState<'RITIRO_DIRETTO' | 'CONTO_DEPOSITO_CELLA'>('RITIRO_DIRETTO');
    const [ddtNumberInput, setDdtNumberInput] = useState('');
    const [suggestedNextDdt, setSuggestedNextDdt] = useState(`1/${selectedYear}`);
    const [inlineEditOrderId, setInlineEditOrderId] = useState<string | null>(null);
    const [inlineDdtValue, setInlineDdtValue] = useState('');
    const [orderItems, setOrderItems] = useState<
        { beerName: string; lotto: string; format: string; quantity: string; customBeerName: string }[]
    >([{ beerName: '', lotto: '', format: '', quantity: '', customBeerName: '' }]);
    const [editingOrder, setEditingOrder] = useState<SalesOrder | null>(null);

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
                (data.SALES_ORDERS || []).slice().sort((a, b) => {
                    const dA = new Date(a.date.split('/').reverse().join('-')).getTime() || 0;
                    const dB = new Date(b.date.split('/').reverse().join('-')).getTime() || 0;
                    if (dB !== dA) return dB - dA;
                    return (b.ddtSeqNumber || 0) - (a.ddtSeqNumber || 0);
                })
            );

            const blockedKeys = new Set(
                (data.BEER_LOT_OVERRIDES || [])
                    .filter((ov: BeerLotStatusOverride) => ov.status === 'CONTESTATO_BLOCCATO')
                    .map(ov => ov.key)
            );

            const dualStock = computeDualLocationBeerStock(data);
            const stock: StockByClient = {};

            dualStock.centralSalesStock.forEach(item => {
                const overrideKey = `${item.cliente}|${item.nomeBirra}|${item.lotto}|${item.formato}`;
                if (blockedKeys.has(overrideKey)) return;
                if (!stock[item.cliente]) stock[item.cliente] = {};
                if (!stock[item.cliente][item.nomeBirra]) stock[item.cliente][item.nomeBirra] = [];
                stock[item.cliente][item.nomeBirra].push({
                    lotto: item.lotto,
                    formato: item.formato,
                    quantita: item.quantita,
                    dataScadenza: item.dataScadenza,
                });
            });

            const restingCount = dualStock.breweryCellarStock
                .filter(i => i.cliente.trim().toUpperCase() === internalName.trim().toUpperCase())
                .reduce((s, i) => s + i.quantita, 0);
            setRestingInBreweryLiters(restingCount);
            setBeerStock(stock);
        }
        setIsLoading(false);
    }, [selectedYear]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const handleItemChange = (
        index: number,
        field: 'beerName' | 'lotto' | 'format' | 'quantity' | 'customBeerName',
        value: string
    ) => {
        const newItems = [...orderItems];
        newItems[index] = { ...newItems[index], [field]: value };
        if (field === 'beerName') {
            newItems[index].lotto = '';
            newItems[index].format = '';
            newItems[index].customBeerName = value;
        }
        if (field === 'lotto') {
            newItems[index].format = '';
        }
        setOrderItems(newItems);
    };
    const addItem = () =>
        setOrderItems([...orderItems, { beerName: '', lotto: '', format: '', quantity: '', customBeerName: '' }]);
    const removeItem = (index: number) => setOrderItems(orderItems.filter((_, i) => i !== index));

    const availableBeers = useMemo(() => {
        const internalStock = beerStock[internalClientName];
        return internalStock ? Object.keys(internalStock) : [];
    }, [beerStock, internalClientName]);

    const groupedOrders = useMemo(() => {
        const groups: Record<string, SalesOrder[]> = {};
        orders.forEach(order => {
            if (!groups[order.client]) groups[order.client] = [];
            groups[order.client].push(order);
        });
        return groups;
    }, [orders]);

    const getLottoExpiry = (beerName: string, lotto: string, format?: string): string => {
        const list = beerStock[internalClientName]?.[beerName];
        if (!beerName || !lotto || !list) return '';
        const matching = list.filter(
            item => item.lotto === lotto && (!format || item.formato === format) && item.dataScadenza
        );
        return matching[0]?.dataScadenza || '';
    };

    const availableLottos = (beerName: string) => {
        if (!beerName || !beerStock[internalClientName] || !beerStock[internalClientName][beerName]) return [];
        const uniqueLottos = [...new Set(beerStock[internalClientName][beerName].map(item => item.lotto))];
        return uniqueLottos.sort((a, b) => {
            const expA = parseItDateSafe(getLottoExpiry(beerName, a))?.getTime() ?? Number.MAX_SAFE_INTEGER;
            const expB = parseItDateSafe(getLottoExpiry(beerName, b))?.getTime() ?? Number.MAX_SAFE_INTEGER;
            return expA - expB;
        });
    };

    const getFefoBetterLotSuggestion = (beerName: string, selectedLotto: string, format: string) => {
        const list = beerStock[internalClientName]?.[beerName];
        if (!beerName || !selectedLotto || !list) return null;
        const selectedExpMs = parseItDateSafe(getLottoExpiry(beerName, selectedLotto, format || undefined))?.getTime();
        if (!selectedExpMs) return null;

        const candidates = list.filter(item => {
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
        if (!beerName || !lotto || !beerStock[internalClientName] || !beerStock[internalClientName][beerName]) return [];
        const formats = beerStock[internalClientName][beerName]
            .filter(item => item.lotto === lotto)
            .map(item => item.formato);
        return [...new Set(formats)];
    };

    const getAvailableQuantity = (beerName: string, lotto: string, format: string) => {
        if (!beerName || !lotto || !format) return 0;
        return (
            beerStock[internalClientName]?.[beerName]
                ?.filter(item => item.lotto === lotto && item.formato === format)
                .reduce((sum, item) => sum + item.quantita, 0) || 0
        );
    };

    const applyFefoSuggestion = (index: number, suggestedLotto: string, suggestedFormat: string) => {
        const newItems = [...orderItems];
        const current = { ...newItems[index], lotto: suggestedLotto };
        const validFormats = availableFormats(current.beerName, suggestedLotto);
        current.format = current.format && validFormats.includes(current.format)
            ? current.format
            : suggestedFormat;
        newItems[index] = current;
        setOrderItems(newItems);
    };

    const handleEditOrder = (order: SalesOrder) => {
        setEditingOrder(order);
        setSelectedClient(order.client);
        const [day, month, year] = order.date.split('/');
        setOrderDate(`${year}-${month}-${day}`);
        setDdtNumberInput(order.numeroDdt || '');
        // Gli ordini storici che creavano PURCHASE erano in conto deposito cella; i nuovi di default sono RITIRO_DIRETTO
        setDeliveryMode(order.deliveryMode || 'CONTO_DEPOSITO_CELLA');
        setOrderItems(
            order.items.map(item => ({
                beerName: item.beerName,
                lotto: item.lotto,
                format: item.format,
                quantity: String(item.quantity),
                customBeerName: item.customBeerName || '',
            }))
        );
        setView('new');
    };

    const handleSaveOrder = async () => {
        if (!selectedClient || orderItems.some(i => !i.beerName || !i.lotto || !i.format || !i.quantity)) {
            showToast('Cliente e tutti i campi degli articoli sono obbligatori.', 'error');
            return;
        }

        const orderId = editingOrder ? editingOrder.id : `ORD_${Date.now()}`;
        const [year, month, day] = orderDate.split('-');
        const formattedDate = `${day}/${month}/${year}`;

        const stockCheckMap = new Map<string, { required: number; available: number; refund: number }>();

        for (const item of orderItems) {
            const qty = parseInt(item.quantity, 10);
            if (isNaN(qty) || qty <= 0) continue;
            const key = `${item.beerName}|${item.lotto}|${item.format}`;
            const current = stockCheckMap.get(key) || { required: 0, available: 0, refund: 0 };
            current.required += qty;
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

        for (const [key, stockItem] of stockCheckMap.entries()) {
            const [beerName, lotto, format] = key.split('|');
            if (stockItem.required > stockItem.available + stockItem.refund) {
                showToast(
                    `Stock insufficiente nel Magazzino Centrale per ${beerName} (Lotto: ${lotto}, ${format}). Disponibili: ${
                        stockItem.available + stockItem.refund
                    }, Richiesti: ${stockItem.required}`,
                    'error'
                );
                return;
            }
        }

        const newMovements: BeerMovement[] = [];
        for (const item of orderItems) {
            const quantityToShip = parseInt(item.quantity, 10);
            if (isNaN(quantityToShip) || quantityToShip <= 0) continue;

            if (deliveryMode === 'RITIRO_DIRETTO') {
                // La BeerFirm ritira subito la merce: scarico definitivo come vendita (nessun carico fantasma nel magazzino BeerFirm, nessun doppio conteggio)
                newMovements.push({
                    id: `MOV_${Date.now()}_${newMovements.length}_OUT`,
                    data: formattedDate,
                    type: 'SALE',
                    location: 'MAGAZZINO_CENTRALE',
                    cliente: internalClientName,
                    nomeBirra: item.beerName,
                    lotto: item.lotto,
                    formato: item.format,
                    quantita: -quantityToShip,
                    relatedDocId: orderId,
                    destinatario: selectedClient,
                    notes: item.customBeerName ? `Etichetta BeerFirm: ${item.customBeerName}` : undefined,
                });
            } else {
                // La merce resta stoccata nel nostro Magazzino Centrale intestata alla BeerFirm:
                // passaggio interno di proprietà (INTERNAL_TRANSFER_OUT + PURCHASE). Verrà contata come vendita globale UNA SOLA VOLTA quando la BeerFirm la ritirerà.
                newMovements.push({
                    id: `MOV_${Date.now()}_${newMovements.length}_OUT`,
                    data: formattedDate,
                    type: 'INTERNAL_TRANSFER_OUT',
                    location: 'MAGAZZINO_CENTRALE',
                    cliente: internalClientName,
                    nomeBirra: item.beerName,
                    lotto: item.lotto,
                    formato: item.format,
                    quantita: -quantityToShip,
                    relatedDocId: orderId,
                    destinatario: selectedClient,
                });

                newMovements.push({
                    id: `MOV_${Date.now()}_${newMovements.length}_IN`,
                    data: formattedDate,
                    type: 'PURCHASE',
                    location: 'MAGAZZINO_CENTRALE',
                    cliente: selectedClient,
                    nomeBirra: item.customBeerName || item.beerName,
                    lotto: item.lotto,
                    formato: item.format,
                    quantita: quantityToShip,
                    relatedDocId: orderId,
                });
            }
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
            (data.SALES_ORDERS || []).some(
                o => o.id !== orderId && (o.numeroDdt || '').trim().toUpperCase() === numeroDdt.toUpperCase()
            ) ||
            (data.PACKAGED_BEER_ORDERS || []).some(
                o => (o.numeroDdt || '').trim().toUpperCase() === numeroDdt.toUpperCase()
            );
        if (
            duplicateHit &&
            !window.confirm(`Il DDT N° ${numeroDdt} risulta già presente nell'archivio ${selectedYear}. Vuoi comunque salvare con questo numero?`)
        ) {
            return;
        }

        const newOrder: SalesOrder = {
            id: orderId,
            numeroDdt,
            ddtSeqNumber,
            date: formattedDate,
            client: selectedClient,
            deliveryMode,
            items: orderItems
                .map(i => ({ ...i, quantity: parseInt(String(i.quantity), 10) }))
                .filter(i => i.quantity > 0),
        };

        let updatedOrders = data.SALES_ORDERS || [];
        let updatedMovements = data.BEER_MOVEMENTS || [];

        if (editingOrder) {
            updatedOrders = updatedOrders.filter(o => o.id !== editingOrder.id);
            updatedMovements = updatedMovements.filter(m => m.relatedDocId !== editingOrder.id);
        }

        updatedOrders.push(newOrder);
        updatedMovements.push(...newMovements);

        data.SALES_ORDERS = updatedOrders;
        data.BEER_MOVEMENTS = updatedMovements;
        syncDdtCountersForYear(data, selectedYear);

        if (deliveryMode === 'RITIRO_DIRETTO') {
            syncOrderSteelKegLogs(
                data,
                orderId,
                formattedDate,
                selectedClient,
                newOrder.items.map(it => ({
                    format: it.format,
                    quantity: it.quantity,
                    lotto: it.lotto,
                    beerName: it.customBeerName || it.beerName,
                }))
            );
        } else {
            removeOrderSteelKegLogs(data, orderId);
        }

        await saveBreweryData(selectedYear, data);

        showToast(
            deliveryMode === 'RITIRO_DIRETTO'
                ? `Commissione BeerFirm salvata (DDT N° ${numeroDdt}) in Ritiro Diretto!`
                : `Commissione BeerFirm salvata (DDT N° ${numeroDdt}) in Conto Deposito Cella!`,
            'success'
        );
        onRefresh();
        await loadData();
        setView('dashboard');
        setSelectedClient('');
        setDdtNumberInput('');
        setDeliveryMode('RITIRO_DIRETTO');
        setOrderItems([{ beerName: '', lotto: '', format: '', quantity: '', customBeerName: '' }]);
        setEditingOrder(null);
    };

    const handleSaveInlineDdt = async (order: SalesOrder) => {
        const trimmed = inlineDdtValue.trim();
        if (!trimmed) {
            showToast('Inserisci un numero di DDT valido (es. 1/2025 oppure solo 1).', 'error');
            return;
        }
        const data = await getBreweryData(selectedYear);
        if (!data) return;

        const { numeroDdt, seq } = normalizeDdtInput(trimmed, selectedYear, 'SALES');
        const duplicateHit =
            (data.SALES_ORDERS || []).some(
                o => o.id !== order.id && (o.numeroDdt || '').trim().toUpperCase() === numeroDdt.toUpperCase()
            ) ||
            (data.PACKAGED_BEER_ORDERS || []).some(
                o => (o.numeroDdt || '').trim().toUpperCase() === numeroDdt.toUpperCase()
            );
        if (
            duplicateHit &&
            !window.confirm(`Il DDT N° ${numeroDdt} risulta già usato in un altro documento del ${selectedYear}. Confermi comunque?`)
        ) {
            return;
        }

        data.SALES_ORDERS = (data.SALES_ORDERS || []).map(o =>
            o.id === order.id ? { ...o, numeroDdt, ddtSeqNumber: seq } : o
        );
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

    const handleDeleteOrder = async (order: SalesOrder) => {
        if (
            !window.confirm(
                `Vuoi davvero eliminare/annullare la commissione del ${order.date} per ${order.client}? Le quantità di birra torneranno disponibili nello stock interno (${internalClientName}).`
            )
        ) {
            return;
        }
        const data = await getBreweryData(selectedYear);
        if (!data) return;

        data.SALES_ORDERS = (data.SALES_ORDERS || []).filter(o => o.id !== order.id);
        data.BEER_MOVEMENTS = (data.BEER_MOVEMENTS || []).filter(m => m.relatedDocId !== order.id);
        removeOrderSteelKegLogs(data, order.id);
        syncDdtCountersForYear(data, selectedYear);
        await saveBreweryData(selectedYear, data);

        showToast('Commissione annullata e giacenze ripristinate.', 'success');
        onRefresh();
        await loadData();
    };

    if (isLoading) return <p>Caricamento...</p>;

    if (view === 'new') {
        return (
            <div className="space-y-4">
                <h1 className="text-3xl font-bold text-brew-accent">
                    {editingOrder ? 'Modifica Commissione BeerFirm' : 'Nuova Commissione BeerFirm'}
                </h1>

                {restingInBreweryLiters > 0 && availableBeers.length === 0 && (
                    <div className="p-3 bg-amber-950/40 border border-amber-500/70 rounded-lg text-xs text-amber-200">
                        Nota logistica: risultano colli in sosta nella <strong>Cella Birrificio</strong> ma non ancora trasferiti nel{' '}
                        <strong>Magazzino Centrale Vendita</strong>. Emetti prima il DDT di Trasferimento da <em>Magazzino Birra</em> per renderli vendibili.
                    </div>
                )}

                <div className="bg-brew-dark-secondary p-4 rounded-lg shadow-lg space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                        <Field label="Cliente BeerFirm">
                            <select
                                value={selectedClient}
                                onChange={e => setSelectedClient(e.target.value)}
                                className="w-full bg-brew-dark p-2 rounded-md border border-slate-600"
                            >
                                <option value="">Seleziona...</option>
                                {clients.map(c => (
                                    <option key={c.id} value={c.nome}>
                                        {c.nome}
                                    </option>
                                ))}
                            </select>
                        </Field>
                        <Field label="Data Ordine">
                            <input
                                type="date"
                                value={orderDate}
                                onChange={e => setOrderDate(e.target.value)}
                                className="w-full bg-brew-dark p-2 rounded-md border border-slate-600"
                            />
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
                        <Field label="Modalità Consegna / Gestione Giacenza">
                            <select
                                value={deliveryMode}
                                onChange={e => setDeliveryMode(e.target.value as 'RITIRO_DIRETTO' | 'CONTO_DEPOSITO_CELLA')}
                                className="w-full bg-brew-dark p-2 rounded-md border border-slate-600 text-sm"
                            >
                                <option value="RITIRO_DIRETTO">Ritiro Diretto (Esce subito — Vendita unica)</option>
                                <option value="CONTO_DEPOSITO_CELLA">Conto Deposito in Cella (Resta in magazzino a nome BeerFirm)</option>
                            </select>
                        </Field>
                    </div>

                    <div className="p-3 bg-brew-dark rounded-md border border-slate-700 text-xs text-slate-300">
                        {deliveryMode === 'RITIRO_DIRETTO' ? (
                            <span>
                                <strong className="text-emerald-400">Ritiro Diretto (Consigliato se la BeerFirm ritira la merce):</strong>{' '}
                                scarica lo stock di {internalClientName} e registra la vendita <strong>una sola volta</strong>, senza caricare giacenze nella cella della BeerFirm (evitando doppi conteggi all&apos;inventario mensile).
                            </span>
                        ) : (
                            <span>
                                <strong className="text-sky-400">Conto Deposito in Cella:</strong>{' '}
                                trasferisce la proprietà dei colli da {internalClientName} alla BeerFirm all&apos;interno del Magazzino Centrale <strong>senza conteggiarla ancora tra i litri venduti</strong>. I litri verranno conteggiati come usciti/venduti una sola volta quando la BeerFirm li preleverà.
                            </span>
                        )}
                    </div>

                    <div>
                        <h3 className="text-lg font-semibold mb-2">Articoli dal Magazzino Centrale ({internalClientName})</h3>
                        <div className="space-y-2.5">
                            {orderItems.map((item, index) => {
                                const fefoHint = getFefoBetterLotSuggestion(item.beerName, item.lotto, item.format);
                                return (
                                    <div key={index} className="space-y-1.5">
                                        <div className="grid grid-cols-[1.4fr,1.4fr,1.15fr,1.1fr,0.55fr,auto] gap-2 items-end">
                                            <Field label={index === 0 ? 'Birra' : ''}>
                                                <select
                                                    value={item.beerName}
                                                    onChange={e => handleItemChange(index, 'beerName', e.target.value)}
                                                    className="w-full bg-brew-dark p-2 rounded-md border border-slate-600"
                                                    disabled={!selectedClient}
                                                >
                                                    <option value="">Seleziona...</option>
                                                    {availableBeers.map(b => (
                                                        <option key={b} value={b}>
                                                            {b}
                                                        </option>
                                                    ))}
                                                </select>
                                            </Field>
                                            <Field label={index === 0 ? 'Nome Etichetta Cliente' : ''}>
                                                <input
                                                    type="text"
                                                    value={item.customBeerName}
                                                    onChange={e => handleItemChange(index, 'customBeerName', e.target.value)}
                                                    className="w-full bg-brew-dark p-2 rounded-md border border-slate-600"
                                                    placeholder={item.beerName}
                                                    disabled={!item.beerName}
                                                />
                                            </Field>
                                            <Field label={index === 0 ? 'Lotto (FEFO)' : ''}>
                                                <select
                                                    value={item.lotto}
                                                    onChange={e => handleItemChange(index, 'lotto', e.target.value)}
                                                    className="w-full bg-brew-dark p-2 rounded-md border border-slate-600"
                                                    disabled={!item.beerName}
                                                >
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
                                            <Field label={index === 0 ? 'Formato' : ''}>
                                                <select
                                                    value={item.format}
                                                    onChange={e => handleItemChange(index, 'format', e.target.value)}
                                                    className="w-full bg-brew-dark p-2 rounded-md border border-slate-600"
                                                    disabled={!item.lotto}
                                                >
                                                    <option value="">Seleziona...</option>
                                                    {availableFormats(item.beerName, item.lotto).map(f => (
                                                        <option key={f} value={f}>
                                                            {f} (Disp: {getAvailableQuantity(item.beerName, item.lotto, f)})
                                                        </option>
                                                    ))}
                                                </select>
                                            </Field>
                                            <Field label={index === 0 ? 'Quantità' : ''}>
                                                <input
                                                    type="number"
                                                    value={item.quantity}
                                                    onChange={e => handleItemChange(index, 'quantity', e.target.value)}
                                                    className="w-24 bg-brew-dark p-2 rounded-md border border-slate-600 font-mono tabular-nums"
                                                />
                                            </Field>
                                            <button onClick={() => removeItem(index)} className="p-2 text-red-500 hover:text-red-400">
                                                <TrashIcon className="w-5 h-5" />
                                            </button>
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
                        <button
                            onClick={addItem}
                            className="mt-4 flex items-center px-2 py-1 bg-brew-blue rounded-md text-xs hover:bg-opacity-80"
                        >
                            <PlusIcon className="w-4 h-4 mr-1" />
                            Aggiungi Articolo
                        </button>
                    </div>
                </div>
                <div className="flex justify-between">
                    <button
                        onClick={() => setView('dashboard')}
                        className="px-4 py-2 rounded-md bg-slate-600 font-semibold hover:bg-slate-500"
                    >
                        Annulla
                    </button>
                    <button
                        onClick={handleSaveOrder}
                        className="px-6 py-3 rounded-md bg-brew-green font-bold text-lg hover:bg-opacity-90"
                    >
                        Salva Commissione
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="bg-brew-dark-secondary p-4 rounded-lg shadow-lg">
            <div className="flex flex-wrap justify-between items-center gap-3 mb-4">
                <div>
                    <h2 className="text-2xl font-bold text-brew-accent">Commissioni BeerFirm su lotti interni</h2>
                    <p className="text-xs text-slate-400 mt-0.5">
                        Numerazione progressiva annuale modificabile (riparte da 1 ogni anno). Prossimo DDT {selectedYear}: <span className="font-mono font-bold text-emerald-300">{suggestedNextDdt}</span>.
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
                            setDeliveryMode('RITIRO_DIRETTO');
                            setOrderItems([{ beerName: '', lotto: '', format: '', quantity: '', customBeerName: '' }]);
                            setView('new');
                        }}
                        className="flex items-center gap-2 bg-brew-green text-white font-bold py-2 px-4 rounded-md hover:bg-opacity-90"
                    >
                        <PlusIcon className="w-5 h-5" /> Nuova Commissione
                    </button>
                </div>
            </div>
            <div className="overflow-x-auto max-h-[70vh] space-y-6">
                {Object.keys(groupedOrders)
                    .sort()
                    .map(clientName => (
                        <div key={clientName} className="bg-brew-dark p-4 rounded-lg">
                            <h3 className="text-xl font-bold text-white mb-3 border-b border-slate-600 pb-2">{clientName}</h3>
                            <table className="w-full text-sm text-left text-gray-300">
                                <thead className="text-xs text-brew-dark uppercase bg-brew-accent">
                                    <tr>
                                        <th className="px-3 py-3 rounded-tl-md">DDT, Data & Modalità</th>
                                        <th className="px-3 py-3">Articoli</th>
                                        <th className="px-3 py-3 rounded-tr-md">Azioni</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {groupedOrders[clientName].map(order => (
                                        <tr key={order.id} className="border-b border-slate-700 last:border-0">
                                            <td className="px-3 py-2 w-60">
                                                {inlineEditOrderId === order.id ? (
                                                    <div className="flex flex-wrap items-center gap-1 mb-1">
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
                                                    <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
                                                        {order.numeroDdt ? (
                                                            <span className="text-xs font-mono font-bold text-emerald-300">
                                                                DDT N° {order.numeroDdt}
                                                            </span>
                                                        ) : (
                                                            <span className="text-[11px] font-mono font-bold text-amber-300 bg-amber-950/60 border border-amber-500/60 px-1.5 py-0.5 rounded">
                                                                DDT da assegnare
                                                            </span>
                                                        )}
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                setInlineEditOrderId(order.id);
                                                                setInlineDdtValue(order.numeroDdt || '');
                                                            }}
                                                            className="text-[10px] text-sky-300 hover:text-sky-200 underline"
                                                            title="Modifica numero DDT (utile per recuperare vecchi backup)"
                                                        >
                                                            {order.numeroDdt ? 'Modifica N°' : 'Inserisci N°'}
                                                        </button>
                                                    </div>
                                                )}
                                                <div className="font-semibold font-mono tabular-nums">{order.date}</div>
                                                <div className="text-[11px] text-slate-400">
                                                    {order.deliveryMode === 'RITIRO_DIRETTO'
                                                        ? 'Ritiro Diretto'
                                                        : 'Conto Deposito Cella'}
                                                </div>
                                            </td>
                                            <td className="px-3 py-2">
                                                <ul className="text-xs list-disc pl-4 space-y-1">
                                                    {order.items.map((item, i) => (
                                                        <li key={i}>
                                                            {item.quantity} x{' '}
                                                            {item.customBeerName
                                                                ? `${item.customBeerName} (ex ${item.beerName})`
                                                                : item.beerName}{' '}
                                                            ({item.format}) - Lotto: {item.lotto}
                                                        </li>
                                                    ))}
                                                </ul>
                                            </td>
                                            <td className="px-3 py-2 w-56">
                                                <div className="flex flex-wrap items-center gap-1.5">
                                                    <button
                                                        onClick={() =>
                                                            printOrderDDT(order, {
                                                                profile: breweryProfile,
                                                                clientDetails: clients.find(c => c.nome === order.client),
                                                                causale:
                                                                    order.deliveryMode === 'RITIRO_DIRETTO'
                                                                        ? 'Vendita / Cessione BeerFirm'
                                                                        : 'Passaggio Conto Deposito BeerFirm',
                                                            })
                                                        }
                                                        className="text-emerald-400 hover:text-emerald-300 font-semibold text-xs border border-emerald-500/70 px-2 py-1 rounded flex items-center gap-1"
                                                        title="Stampa o salva in PDF il Documento di Trasporto A4"
                                                    >
                                                        <DocumentTextIcon className="w-3.5 h-3.5" /> DDT PDF
                                                    </button>
                                                    <button
                                                        onClick={() => handleEditOrder(order)}
                                                        className="text-brew-blue hover:text-blue-400 font-semibold text-xs border border-brew-blue px-2 py-1 rounded"
                                                    >
                                                        Modifica
                                                    </button>
                                                    <button
                                                        onClick={() => handleDeleteOrder(order)}
                                                        className="text-red-400 hover:text-red-300 font-semibold text-xs border border-red-500/70 px-2 py-1 rounded"
                                                    >
                                                        Elimina
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ))}
                {orders.length === 0 && (
                    <p className="text-center text-slate-400 mt-8 py-4">Nessuna commissione d&apos;ordine trovata.</p>
                )}
            </div>
        </div>
    );
};

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
    <div>
        <label className="block text-xs font-medium text-gray-400 mb-1">{label || '\u00A0'}</label>
        {children}
    </div>
);