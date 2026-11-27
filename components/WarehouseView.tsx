import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { getBreweryData, getEffectiveBreweryProfile, updatePriceInDb } from '../services/dataService';
import type { BreweryData, PriceDBItem, RawWarehouseItem, WarehouseStatus } from '../types';
import { TIPOLOGIE_PRODOTTI } from '../constants';
import { useToast } from '../hooks/useToast';
import { parseItalianDate } from '../utils/dateUtils';
import {
    RAW_INGREDIENT_CATEGORIES,
    computeAnnualConsumedIngredients,
    buildMergedReportAndSuggestions,
    loadIngredientMergePreferences,
    saveIngredientMergePreferences,
    makeRejectedPairKey,
    type CandidateMergeSuggestion,
    type IngredientMergePreferences,
    type MergedConsumedIngredientRow,
    type RawIngredientCategory,
} from '../utils/ingredientGroupingEngine';
import { exportAnnualIngredientsConsumptionToExcel } from '../utils/excelExport';

interface WarehouseViewProps {
    selectedYear: string;
    warehouseStatus?: WarehouseStatus;
}

interface DetailedWarehouseItem {
    TIPOLOGIA: string;
    NOME: string;
    MARCA: string;
    FORNITORE: string;
    GIACENZA: number;
}

const ALL_CATEGORIES = 'TUTTO';
type WarehouseTab = 'STOCK' | 'ANNUAL_USAGE';

export const WarehouseView: React.FC<WarehouseViewProps> = ({ selectedYear, warehouseStatus }) => {
    const [activeTab, setActiveTab] = useState<WarehouseTab>('STOCK');
    const [rawWarehouse, setRawWarehouse] = useState<RawWarehouseItem[]>([]);
    const [priceDb, setPriceDb] = useState<PriceDBItem[]>([]);
    const [breweryData, setBreweryData] = useState<BreweryData | null>(null);
    const [filter, setFilter] = useState<string>(ALL_CATEGORIES);
    const [editingItemKey, setEditingItemKey] = useState<string | null>(null);
    const [editingPrice, setEditingPrice] = useState('');
    const { showToast } = useToast();
    const [refreshKey, setRefreshKey] = useState(0);

    // Stato Resoconto Ingredienti Utilizzati Annui
    const [usageCategoryFilter, setUsageCategoryFilter] = useState<string>(ALL_CATEGORIES);
    const [usageSearch, setUsageSearch] = useState('');
    const [mergePrefs, setMergePrefs] = useState<IngredientMergePreferences>(() => loadIngredientMergePreferences());
    const [suggestionTargetNames, setSuggestionTargetNames] = useState<Record<string, string>>({});
    const [expandedRowKey, setExpandedRowKey] = useState<string | null>(null);
    const [selectedManualKeys, setSelectedManualKeys] = useState<string[]>([]);
    const [manualTargetName, setManualTargetName] = useState('');

    const loadData = useCallback(async () => {
        const data = await getBreweryData(selectedYear);
        if (data) {
            setBreweryData(data);
            setRawWarehouse(data.MAGAZZINO || []);
            setPriceDb(data.PRICE_DATABASE || []);
        }
    }, [selectedYear]);

    useEffect(() => {
        loadData();
    }, [selectedYear, refreshKey, loadData]);

    const detailedWarehouse: DetailedWarehouseItem[] = useMemo(() => {
        const filteredData = filter === ALL_CATEGORIES
            ? rawWarehouse
            : rawWarehouse.filter(item => item.TIPOLOGIA === filter);

        return filteredData
            .filter((item: RawWarehouseItem) => item.GIACENZA >= 0.01)
            .sort((a: RawWarehouseItem, b: RawWarehouseItem) => a.TIPOLOGIA.localeCompare(b.TIPOLOGIA) || a.NOME.localeCompare(b.NOME));
    }, [rawWarehouse, filter]);

    const totalQuantity = useMemo(() => {
        if (filter === ALL_CATEGORIES) {
            return null;
        }
        return detailedWarehouse.reduce((sum, item) => sum + item.GIACENZA, 0);
    }, [detailedWarehouse, filter]);

    const handlePriceClick = (key: string, currentPrice: number | undefined) => {
        setEditingItemKey(key);
        setEditingPrice(currentPrice ? String(currentPrice) : '');
    };

    const handlePriceUpdate = async () => {
        if (!editingItemKey) return;

        const [, nome, marca, fornitore] = editingItemKey.split('|');
        const newPrice = parseFloat(editingPrice.replace(',', '.'));

        if (isNaN(newPrice) || newPrice < 0) {
            showToast('Inserisci un prezzo valido.', 'error');
            return;
        }

        try {
            await updatePriceInDb(selectedYear, { NOME: nome, MARCA: marca, FORNITORE: fornitore }, newPrice);
            showToast(`Prezzo per ${nome} aggiornato a €${newPrice.toFixed(2)}`, 'success');
            setEditingItemKey(null);
            setRefreshKey(prev => prev + 1);
        } catch {
            showToast("Errore durante l'aggiornamento del prezzo.", 'error');
        }
    };

    // Calcoli Resoconto Ingredienti Utilizzati Annui
    const rawConsumedIngredients = useMemo(
        () => computeAnnualConsumedIngredients(breweryData),
        [breweryData]
    );

    const { rows: allMergedUsageRows, pendingSuggestions } = useMemo(
        () => buildMergedReportAndSuggestions(rawConsumedIngredients, mergePrefs),
        [rawConsumedIngredients, mergePrefs]
    );

    const filteredUsageRows = useMemo(() => {
        const q = usageSearch.trim().toUpperCase();
        return allMergedUsageRows.filter(row => {
            if (usageCategoryFilter !== ALL_CATEGORIES && row.tipologia !== usageCategoryFilter) {
                return false;
            }
            if (q) {
                const matchName = row.displayName.toUpperCase().includes(q);
                const matchConstituents = row.constituents.some(c => c.nome.toUpperCase().includes(q));
                return matchName || matchConstituents;
            }
            return true;
        });
    }, [allMergedUsageRows, usageCategoryFilter, usageSearch]);

    const usageTotalsByCategory = useMemo(() => {
        const totals: Record<string, number> = {};
        RAW_INGREDIENT_CATEGORIES.forEach(cat => {
            totals[cat] = 0;
        });
        allMergedUsageRows.forEach(r => {
            totals[r.tipologia] = (totals[r.tipologia] || 0) + r.totalQty;
        });
        return totals;
    }, [allMergedUsageRows]);

    const totalConsumedCost = useMemo(
        () => allMergedUsageRows.reduce((sum, r) => sum + r.estimatedCost, 0),
        [allMergedUsageRows]
    );

    const persistPrefs = (next: IngredientMergePreferences) => {
        setMergePrefs(next);
        saveIngredientMergePreferences(next);
    };

    const handleConfirmSuggestion = (sugg: CandidateMergeSuggestion) => {
        const targetName = (suggestionTargetNames[sugg.suggestionId] ?? sugg.suggestedTargetName).trim().toUpperCase();
        if (!targetName) {
            showToast('Inserisci un nome unificato valido prima di confermare.', 'error');
            return;
        }
        const newMemberNames = sugg.items.map(i => i.nome.toUpperCase().trim());

        let nextGroups = [...mergePrefs.confirmedGroups];
        if (sugg.existingGroupId) {
            nextGroups = nextGroups.map(g =>
                g.id === sugg.existingGroupId
                    ? {
                        ...g,
                        targetName,
                        members: Array.from(new Set([...g.members, ...newMemberNames])),
                    }
                    : g
            );
        } else {
            nextGroups.push({
                id: `GRP_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                tipologia: sugg.tipologia,
                targetName,
                members: Array.from(new Set(newMemberNames)),
            });
        }

        persistPrefs({
            ...mergePrefs,
            confirmedGroups: nextGroups,
        });
        showToast(
            `Ingredienti accorpati in "${targetName}" (${sugg.combinedQty.toFixed(2)} totali).`,
            'success'
        );
    };

    const handleRejectSuggestion = (sugg: CandidateMergeSuggestion) => {
        const pairsToReject = new Set(mergePrefs.rejectedPairKeys);
        const itemNames = sugg.items.map(i => i.nome);
        for (let i = 0; i < itemNames.length; i++) {
            for (let j = i + 1; j < itemNames.length; j++) {
                pairsToReject.add(makeRejectedPairKey(sugg.tipologia, itemNames[i], itemNames[j]));
            }
            if (sugg.existingGroupMembers) {
                sugg.existingGroupMembers.forEach(m => {
                    pairsToReject.add(makeRejectedPairKey(sugg.tipologia, m, itemNames[i]));
                });
            }
        }
        persistPrefs({
            ...mergePrefs,
            rejectedPairKeys: Array.from(pairsToReject),
        });
        showToast('Voci lasciate separate nel resoconto.', 'info');
    };

    const handleUnmergeGroup = (groupId: string) => {
        const group = mergePrefs.confirmedGroups.find(g => g.id === groupId);
        if (!group) return;
        const pairsToReject = new Set(mergePrefs.rejectedPairKeys);
        for (let i = 0; i < group.members.length; i++) {
            for (let j = i + 1; j < group.members.length; j++) {
                pairsToReject.add(makeRejectedPairKey(group.tipologia, group.members[i], group.members[j]));
            }
        }
        persistPrefs({
            confirmedGroups: mergePrefs.confirmedGroups.filter(g => g.id !== groupId),
            rejectedPairKeys: Array.from(pairsToReject),
        });
        showToast(`Gruppo "${group.targetName}" separato di nuovo nelle voci originali.`, 'info');
    };

    const handleToggleManualSelection = (row: MergedConsumedIngredientRow) => {
        setSelectedManualKeys(prev => {
            if (prev.includes(row.rowKey)) {
                return prev.filter(k => k !== row.rowKey);
            }
            return [...prev, row.rowKey];
        });
    };

    const selectedManualRows = useMemo(
        () => allMergedUsageRows.filter(r => selectedManualKeys.includes(r.rowKey)),
        [allMergedUsageRows, selectedManualKeys]
    );

    const canManualMerge = useMemo(() => {
        if (selectedManualRows.length < 2) return false;
        const firstCat = selectedManualRows[0].tipologia;
        return selectedManualRows.every(r => r.tipologia === firstCat);
    }, [selectedManualRows]);

    const handleManualMerge = () => {
        if (!canManualMerge) {
            showToast('Seleziona almeno 2 ingredienti della stessa categoria per unirli.', 'error');
            return;
        }
        const tipologia: RawIngredientCategory = selectedManualRows[0].tipologia;
        const targetName = (manualTargetName.trim() || selectedManualRows[0].displayName).toUpperCase();
        const allMembers = Array.from(
            new Set(selectedManualRows.flatMap(r => r.constituents.map(c => c.nome.toUpperCase().trim())))
        );
        const existingGroupIds = new Set(
            selectedManualRows.map(r => r.mergeGroupId).filter((id): id is string => Boolean(id))
        );

        const nextRejected = mergePrefs.rejectedPairKeys.filter(pk => {
            if (!pk.startsWith(`${tipologia}|`)) return true;
            const pairPart = pk.slice(tipologia.length + 1);
            const [a, b] = pairPart.split('::');
            return !(allMembers.includes(a) && allMembers.includes(b));
        });

        const remainingGroups = mergePrefs.confirmedGroups.filter(g => !existingGroupIds.has(g.id));
        remainingGroups.push({
            id: `GRP_MAN_${Date.now()}`,
            tipologia,
            targetName,
            members: allMembers,
        });

        persistPrefs({
            confirmedGroups: remainingGroups,
            rejectedPairKeys: nextRejected,
        });
        setSelectedManualKeys([]);
        setManualTargetName('');
        showToast(`Uniti ${allMembers.length} ingredienti in "${targetName}".`, 'success');
    };

    const handleResetRejectedSuggestions = () => {
        persistPrefs({
            ...mergePrefs,
            rejectedPairKeys: [],
        });
        showToast('Suggerimenti automatici di accorpamento ripristinati.', 'info');
    };

    const handleExportAnnualReport = () => {
        exportAnnualIngredientsConsumptionToExcel(
            filteredUsageRows,
            selectedYear,
            getEffectiveBreweryProfile(breweryData)
        );
        showToast(`Resoconto ingredienti ${selectedYear} esportato in Excel.`, 'success');
    };

    return (
        <div className="bg-brew-dark-secondary p-4 sm:p-6 rounded-lg shadow-lg space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-700 pb-4">
                <div className="inline-flex flex-wrap gap-2">
                    <button
                        type="button"
                        onClick={() => setActiveTab('STOCK')}
                        className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors ${
                            activeTab === 'STOCK'
                                ? 'bg-brew-accent text-brew-dark shadow'
                                : 'bg-brew-dark text-slate-300 hover:bg-slate-700'
                        }`}
                    >
                        📦 Giacenze &amp; Prezzi Magazzino
                    </button>
                    <button
                        type="button"
                        onClick={() => setActiveTab('ANNUAL_USAGE')}
                        className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors flex items-center gap-2 ${
                            activeTab === 'ANNUAL_USAGE'
                                ? 'bg-brew-accent text-brew-dark shadow'
                                : 'bg-brew-dark text-slate-300 hover:bg-slate-700'
                        }`}
                    >
                        <span>📊 Resoconto Ingredienti Utilizzati Annui</span>
                        {pendingSuggestions.length > 0 && (
                            <span className="px-2 py-0.5 text-xs rounded-full bg-amber-600 text-white font-extrabold animate-pulse">
                                {pendingSuggestions.length} da confermare
                            </span>
                        )}
                    </button>
                </div>
            </div>

            {activeTab === 'STOCK' ? (
                <>
                    <div className="flex justify-between items-center mb-4 flex-wrap gap-4">
                        <h2 className="text-2xl font-bold text-brew-accent">📦 Giacenze e Prezzi Magazzino - {selectedYear}</h2>
                        <div className="flex items-center gap-4">
                            {totalQuantity !== null && (
                                <div className="bg-brew-accent text-brew-dark p-2 rounded-lg text-center shadow-md">
                                    <p className="text-xs font-bold uppercase">Totale {filter}</p>
                                    <p className="text-2xl font-extrabold">{totalQuantity.toFixed(2)}</p>
                                </div>
                            )}
                            <select
                                value={filter}
                                onChange={(e) => setFilter(e.target.value)}
                                className="bg-brew-dark p-2 rounded-md text-brew-light focus:outline-none focus:ring-2 focus:ring-brew-accent h-full"
                            >
                                <option value={ALL_CATEGORIES}>TUTTO</option>
                                {TIPOLOGIE_PRODOTTI.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                            </select>
                        </div>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left text-gray-300">
                            <thead className="text-xs text-brew-dark uppercase bg-brew-accent">
                                <tr>
                                    <th scope="col" className="px-6 py-3">TIPOLOGIA</th>
                                    <th scope="col" className="px-6 py-3">NOME PRODOTTO</th>
                                    <th scope="col" className="px-6 py-3">MARCA</th>
                                    <th scope="col" className="px-6 py-3">FORNITORE</th>
                                    <th scope="col" className="px-6 py-3 text-right">GIACENZA</th>
                                    <th scope="col" className="px-6 py-3 text-right">PREZZO</th>
                                </tr>
                            </thead>
                            <tbody>
                                {detailedWarehouse.map((item, index) => {
                                    const key = `${item.TIPOLOGIA}|${item.NOME}|${item.MARCA}|${item.FORNITORE}`;
                                    const priceItem = priceDb.find(p => p.NOME === item.NOME && p.MARCA === item.MARCA && p.FORNITORE === item.FORNITORE);
                                    const isEditing = editingItemKey === key;

                                    const hasExpiredLots = warehouseStatus?.expiringSoonItems.some(
                                        expItem => expItem.nome === item.NOME &&
                                            (parseItalianDate(expItem.scadenza)?.getTime() || 0) < new Date().setHours(0, 0, 0, 0)
                                    );

                                    return (
                                        <tr key={index} className={`border-b border-slate-700 hover:bg-slate-600 ${hasExpiredLots ? 'bg-red-900/30 text-red-200' : ''}`}>
                                            <td className="px-6 py-4">{item.TIPOLOGIA}</td>
                                            <td className="px-6 py-4 font-medium">{item.NOME} {hasExpiredLots && <span className="text-red-400 text-xs ml-2">(Scaduto)</span>}</td>
                                            <td className="px-6 py-4">{item.MARCA || '-'}</td>
                                            <td className="px-6 py-4">{item.FORNITORE || '-'}</td>
                                            <td className="px-6 py-4 font-bold text-right">{item.GIACENZA.toFixed(2)}</td>
                                            <td className="px-6 py-4 font-bold text-right cursor-pointer" onClick={() => !isEditing && handlePriceClick(key, priceItem?.PREZZO)}>
                                                {isEditing ? (
                                                    <input
                                                        type="text"
                                                        value={editingPrice}
                                                        onChange={(e) => setEditingPrice(e.target.value)}
                                                        onBlur={handlePriceUpdate}
                                                        onKeyDown={(e) => e.key === 'Enter' && handlePriceUpdate()}
                                                        className="w-24 bg-brew-dark p-1 rounded-md border border-brew-accent text-right"
                                                        autoFocus
                                                    />
                                                ) : (
                                                    <span className={priceItem ? 'text-brew-accent' : 'text-gray-400'}>
                                                        {priceItem ? `€${priceItem.PREZZO.toFixed(2)}` : 'N/D'}
                                                    </span>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                        {detailedWarehouse.length === 0 && (
                            <p className="text-center text-slate-400 mt-8">Nessun articolo in magazzino per questa categoria.</p>
                        )}
                    </div>
                </>
            ) : (
                <div className="space-y-5">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                            <h2 className="text-2xl font-bold text-brew-accent">
                                📊 Resoconto Ingredienti Utilizzati Annui ({selectedYear})
                            </h2>
                            <p className="text-xs text-slate-400 mt-1">
                                Somma tutti gli ingredienti scaricati dai fogli cotta (lotti <strong>aperti e chiusi</strong> dell&apos;anno {selectedYear}) per pianificare gli acquisti annuali in stock.
                            </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            {mergePrefs.rejectedPairKeys.length > 0 && (
                                <button
                                    type="button"
                                    onClick={handleResetRejectedSuggestions}
                                    className="px-3 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-semibold rounded-md transition-colors"
                                    title="Ripristina eventuali coppie di varianti che avevi scelto di tenere separate"
                                >
                                    🔄 Ripristina Suggerimenti
                                </button>
                            )}
                            <button
                                type="button"
                                onClick={handleExportAnnualReport}
                                disabled={filteredUsageRows.length === 0}
                                className="px-4 py-2 bg-brew-green hover:bg-opacity-90 disabled:bg-slate-600 text-white font-bold text-sm rounded-md shadow transition-colors"
                            >
                                📥 Esporta Resoconto Excel
                            </button>
                        </div>
                    </div>

                    {/* Riepilogo KPI per categoria */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 font-mono tabular-nums">
                        {RAW_INGREDIENT_CATEGORIES.map(cat => (
                            <div key={cat} className="bg-brew-dark p-3 rounded-lg border border-slate-700">
                                <div className="text-[11px] font-sans text-slate-400 font-semibold">{cat}</div>
                                <div className="text-lg font-extrabold text-white mt-0.5">
                                    {(usageTotalsByCategory[cat] || 0).toFixed(2)}
                                </div>
                            </div>
                        ))}
                        <div className="bg-brew-dark p-3 rounded-lg border border-amber-500/40">
                            <div className="text-[11px] font-sans text-amber-300 font-semibold">Valore Consumi</div>
                            <div className="text-lg font-extrabold text-amber-300 mt-0.5">
                                € {totalConsumedCost.toFixed(2)}
                            </div>
                        </div>
                    </div>

                    {/* Conferma Accorpamento Varianti per Parole Chiave */}
                    {pendingSuggestions.length > 0 && (
                        <div className="bg-amber-950/35 border-2 border-amber-500/80 rounded-xl p-4 space-y-3 shadow-lg">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <div>
                                    <h3 className="text-base font-extrabold text-amber-300">
                                        ⚠️ Possibili Ingredienti Identici Rilevati (Richiesta Conferma Utente)
                                    </h3>
                                    <p className="text-xs text-slate-300">
                                        Alcuni prodotti hanno nomi leggermente diversi (es. <em>&quot;SAAZ&quot;</em>, <em>&quot;SAAZ PELLET&quot;</em>, <em>&quot;SAAZ T-90&quot;</em>). Conferma se sommarli in un&apos;unica voce o lasciarli separati.
                                    </p>
                                </div>
                            </div>
                            <div className="space-y-3">
                                {pendingSuggestions.map(sugg => {
                                    const currentTarget = suggestionTargetNames[sugg.suggestionId] ?? sugg.suggestedTargetName;
                                    return (
                                        <div
                                            key={sugg.suggestionId}
                                            className="bg-brew-dark p-3 rounded-lg border border-slate-700 flex flex-col lg:flex-row lg:items-center justify-between gap-3"
                                        >
                                            <div className="space-y-1.5 flex-1">
                                                <div className="flex flex-wrap items-center gap-2 text-xs">
                                                    <span className="px-2 py-0.5 rounded bg-slate-700 text-amber-300 font-bold">
                                                        {sugg.tipologia}
                                                    </span>
                                                    <span className="text-slate-400">{sugg.reason}</span>
                                                </div>
                                                <div className="flex flex-wrap items-center gap-2 text-xs">
                                                    {sugg.existingGroupId && (
                                                        <span className="px-2 py-1 rounded bg-emerald-900/40 border border-emerald-500/40 text-emerald-200">
                                                            Gruppo esistente: <strong>{sugg.suggestedTargetName}</strong>
                                                        </span>
                                                    )}
                                                    {sugg.items.map(it => (
                                                        <span
                                                            key={it.key}
                                                            className="px-2 py-1 rounded bg-brew-dark-secondary border border-slate-600 text-slate-200 font-mono"
                                                        >
                                                            {it.nome}: <strong className="text-amber-300">{it.totalQty.toFixed(2)}</strong>
                                                        </span>
                                                    ))}
                                                    <span className="text-emerald-300 font-bold font-mono">
                                                        ➔ Somma gruppo: {sugg.combinedQty.toFixed(2)}
                                                    </span>
                                                </div>
                                            </div>
                                            <div className="flex flex-wrap items-center gap-2">
                                                <input
                                                    type="text"
                                                    value={currentTarget}
                                                    onChange={e =>
                                                        setSuggestionTargetNames(prev => ({
                                                            ...prev,
                                                            [sugg.suggestionId]: e.target.value,
                                                        }))
                                                    }
                                                    placeholder="Nome voce unificata"
                                                    className="bg-brew-dark-secondary px-2.5 py-1.5 rounded border border-slate-600 text-xs font-bold text-white w-44"
                                                    title="Nome finale da mostrare nel resoconto unificato"
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() => handleConfirmSuggestion(sugg)}
                                                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded transition-colors whitespace-nowrap"
                                                >
                                                    ✅ Sì, è lo stesso (Unisci)
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => handleRejectSuggestion(sugg)}
                                                    className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 font-semibold text-xs rounded transition-colors whitespace-nowrap"
                                                >
                                                    ❌ No, tieni separati
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* Barra Filtri + Unione Manuale */}
                    <div className="bg-brew-dark p-3 rounded-lg border border-slate-700 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                        <div className="flex flex-wrap items-center gap-2">
                            <select
                                value={usageCategoryFilter}
                                onChange={e => setUsageCategoryFilter(e.target.value)}
                                className="bg-brew-dark-secondary p-2 rounded-md border border-slate-600 text-sm text-white"
                            >
                                <option value={ALL_CATEGORIES}>TUTTE LE CATEGORIE</option>
                                {RAW_INGREDIENT_CATEGORIES.map(cat => (
                                    <option key={cat} value={cat}>{cat}</option>
                                ))}
                            </select>
                            <input
                                type="text"
                                value={usageSearch}
                                onChange={e => setUsageSearch(e.target.value)}
                                placeholder="Cerca ingrediente (es. Saaz, Pilsner...)"
                                className="bg-brew-dark-secondary p-2 rounded-md border border-slate-600 text-sm text-white w-64"
                            />
                        </div>

                        {selectedManualKeys.length > 0 && (
                            <div className="flex flex-wrap items-center gap-2 bg-sky-950/50 border border-sky-500/50 px-3 py-1.5 rounded-md">
                                <span className="text-xs text-sky-200 font-semibold">
                                    {selectedManualKeys.length} selezionati
                                </span>
                                {canManualMerge ? (
                                    <>
                                        <input
                                            type="text"
                                            value={manualTargetName}
                                            onChange={e => setManualTargetName(e.target.value)}
                                            placeholder={`Nome unificato (es. ${selectedManualRows[0]?.displayName})`}
                                            className="bg-brew-dark px-2 py-1 rounded border border-slate-600 text-xs text-white w-48"
                                        />
                                        <button
                                            type="button"
                                            onClick={handleManualMerge}
                                            className="px-3 py-1 bg-brew-blue hover:bg-opacity-90 text-white font-bold text-xs rounded"
                                        >
                                            🔗 Unisci Selezionati
                                        </button>
                                    </>
                                ) : (
                                    <span className="text-xs text-amber-300">
                                        Seleziona almeno 2 voci della stessa categoria
                                    </span>
                                )}
                                <button
                                    type="button"
                                    onClick={() => {
                                        setSelectedManualKeys([]);
                                        setManualTargetName('');
                                    }}
                                    className="px-2 py-1 text-xs text-slate-300 hover:text-white"
                                >
                                    Annulla
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Tabella Resoconto Consumi */}
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left text-gray-300">
                            <thead className="text-xs text-brew-dark uppercase bg-brew-accent">
                                <tr>
                                    <th className="px-3 py-3 w-8 text-center">✓</th>
                                    <th className="px-4 py-3">CATEGORIA</th>
                                    <th className="px-4 py-3">INGREDIENTE</th>
                                    <th className="px-4 py-3 text-center">LOTTI COTTA (APERTI / CHIUSI)</th>
                                    <th className="px-4 py-3 text-right">TOTALE UTILIZZATO ANNUO</th>
                                    <th className="px-4 py-3 text-right">COSTO STIMATO</th>
                                    <th className="px-4 py-3 text-right">AZIONI</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredUsageRows.map(row => {
                                    const isExpanded = expandedRowKey === row.rowKey;
                                    const isSelected = selectedManualKeys.includes(row.rowKey);
                                    return (
                                        <React.Fragment key={row.rowKey}>
                                            <tr className={`border-b border-slate-700 hover:bg-slate-700/40 ${isSelected ? 'bg-sky-900/25' : ''}`}>
                                                <td className="px-3 py-3 text-center">
                                                    <input
                                                        type="checkbox"
                                                        checked={isSelected}
                                                        onChange={() => handleToggleManualSelection(row)}
                                                        className="h-4 w-4 rounded bg-brew-dark border-slate-600 text-brew-blue"
                                                        title="Seleziona per accorpare manualmente con un altro ingrediente"
                                                    />
                                                </td>
                                                <td className="px-4 py-3 font-semibold text-xs text-slate-300">{row.tipologia}</td>
                                                <td className="px-4 py-3">
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <span className="font-bold text-white">{row.displayName}</span>
                                                        {row.isMerged && (
                                                            <span className="px-2 py-0.5 text-[11px] font-semibold rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                                                                🔗 Unificato ({row.constituents.length} varianti)
                                                            </span>
                                                        )}
                                                    </div>
                                                    {row.isMerged && (
                                                        <div className="text-[11px] text-slate-400 mt-0.5 font-mono">
                                                            {row.constituents.map(c => `${c.nome}: ${c.totalQty.toFixed(2)}`).join(' + ')}
                                                        </div>
                                                    )}
                                                </td>
                                                <td className="px-4 py-3 text-center font-mono text-xs tabular-nums">
                                                    <span className="font-bold text-white">{row.lottiCount}</span>{' '}
                                                    <span className="text-slate-400">
                                                        ({row.openLotsCount} ap. / {row.closedLotsCount} ch.)
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3 text-right font-extrabold text-brew-accent font-mono text-base tabular-nums">
                                                    {row.totalQty.toFixed(2)}
                                                </td>
                                                <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-200">
                                                    {row.estimatedCost > 0 ? `€ ${row.estimatedCost.toFixed(2)}` : 'N/D'}
                                                </td>
                                                <td className="px-4 py-3 text-right whitespace-nowrap space-x-2">
                                                    <button
                                                        type="button"
                                                        onClick={() => setExpandedRowKey(isExpanded ? null : row.rowKey)}
                                                        className="px-2 py-1 text-xs rounded bg-slate-700 hover:bg-slate-600 text-slate-200"
                                                    >
                                                        {isExpanded ? 'Chiudi lotti' : 'Dettaglio lotti'}
                                                    </button>
                                                    {row.mergeGroupId && (
                                                        <button
                                                            type="button"
                                                            onClick={() => handleUnmergeGroup(row.mergeGroupId!)}
                                                            className="px-2 py-1 text-xs rounded bg-red-900/50 hover:bg-red-800/70 text-red-200 border border-red-500/30"
                                                            title="Separa di nuovo le voci unite in questo gruppo"
                                                        >
                                                            Separa
                                                        </button>
                                                    )}
                                                </td>
                                            </tr>
                                            {isExpanded && (
                                                <tr className="bg-brew-dark/80 border-b border-slate-700">
                                                    <td colSpan={7} className="px-6 py-3">
                                                        <div className="text-xs text-slate-300 space-y-1">
                                                            <div className="font-bold text-amber-300 mb-1">
                                                                Impiego sui lotti di produzione ({selectedYear}):
                                                            </div>
                                                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                                                                {row.lotsDetail.map((ld, idx) => (
                                                                    <div
                                                                        key={`${ld.lotto}_${idx}`}
                                                                        className="p-2 rounded bg-brew-dark-secondary border border-slate-700 flex items-center justify-between gap-2 font-mono tabular-nums"
                                                                    >
                                                                        <div>
                                                                            <div className="font-bold text-white">
                                                                                {ld.lotto} · <span className="font-sans text-slate-300">{ld.birra}</span>
                                                                            </div>
                                                                            <div className="text-[11px] text-slate-400">
                                                                                {ld.data} • {ld.isClosed ? 'Lotto Chiuso' : 'Lotto Aperto'}
                                                                            </div>
                                                                        </div>
                                                                        <div className="text-right">
                                                                            <div className="font-bold text-emerald-300">{ld.qty.toFixed(2)}</div>
                                                                            {ld.cost > 0 && (
                                                                                <div className="text-[10px] text-slate-400">€ {ld.cost.toFixed(2)}</div>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    </td>
                                                </tr>
                                            )}
                                        </React.Fragment>
                                    );
                                })}
                            </tbody>
                        </table>
                        {filteredUsageRows.length === 0 && (
                            <p className="text-center text-slate-400 mt-8">
                                Nessun consumo materie prime registrato nei fogli cotta per i filtri selezionati nell&apos;anno {selectedYear}.
                            </p>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};