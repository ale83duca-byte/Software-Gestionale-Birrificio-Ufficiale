import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { getBreweryData, getAllBreweryData, isInternalOwner, getInternalClientName } from '../services/dataService';
import type { BeerMovement, Cliente, BeerStockItem as StockItem, BreweryData } from '../types';
import { useTranslation } from '../i18n';
import { 
    BarChart, 
    Bar, 
    XAxis, 
    YAxis, 
    CartesianGrid, 
    Tooltip, 
    ResponsiveContainer, 
    Cell, 
    LabelList,
    Legend
} from 'recharts';
import { CONFIG_PACKAGING } from '../constants';
import { computeDualLocationBeerStock, computeCleanSalesAndWaste } from '../utils/beerStockEngine';
import { resolveEffectiveSellingPrice, type ResolvedPriceSource } from '../utils/pricingEngine';

interface SalesTrendViewProps {
    selectedYear: string;
}

// Warm artisanal brewery colors: Golden Ale, Amber, Copper, Ruby, Stout, Forest, Slate
const CANDLE_COLORS = [
    '#f59e0b', // Amber / Gold
    '#d97706', // Deep Amber
    '#b45309', // Warm Copper
    '#0284c7', // Sky Blue
    '#059669', // Emerald
    '#dc2626', // Ruby Red
    '#7c3aed', // Purple Stout
    '#ea580c', // Orange
    '#0891b2', // Cyan
    '#4b5563', // Slate
    '#65a30d', // Lime
    '#db2777'  // Berry
];

// Helper to strictly round floating point numbers to 1 decimal place
const round1 = (val: number): number => {
    if (val === undefined || val === null || isNaN(val) || !isFinite(val)) return 0;
    return Math.round((val + Number.EPSILON) * 10) / 10;
};

// Format liters with 1 decimal and 'L'
const formatL = (val: number): string => `${round1(val).toFixed(1)} L`;

const parseDate = (dateStr: string) => {
    if (!dateStr) return new Date(0);
    const parts = dateStr.split('/');
    if (parts.length === 3) {
        const [day, month, year] = parts.map(Number);
        return new Date(year, month - 1, day);
    }
    return new Date(0);
};

// Specific format palette to maintain visual consistency across charts
const getFormatColor = (fmt: string, index: number = 0): string => {
    const upper = fmt.toUpperCase().trim();
    if (upper.includes('30L') || upper.includes('30 L') || upper.includes('30 LT')) return '#f59e0b'; // Amber
    if (upper.includes('24L') || upper.includes('24 L') || upper.includes('24 LT')) return '#0284c7'; // Sky Blue
    if (upper.includes('20L') || upper.includes('20 L') || upper.includes('20 LT')) return '#8b5cf6'; // Violet
    if (upper.includes('33CL') || upper.includes('33 CL')) return '#10b981'; // Emerald
    if (upper.includes('50CL') || upper.includes('50 CL')) return '#06b6d4'; // Cyan
    if (upper.includes('75CL') || upper.includes('75 CL')) return '#ec4899'; // Pink / Ruby
    if (upper.includes('LATT')) return '#ea580c'; // Orange
    if (upper.includes('KEYKEG')) return '#d97706'; // Deep Amber
    return CANDLE_COLORS[index % CANDLE_COLORS.length];
};

// Extract liters per single unit for any format string
const getLitersPerUnit = (formato: string): number => {
    if (!formato) return 0;
    if (CONFIG_PACKAGING[formato]) {
        return CONFIG_PACKAGING[formato].litriUnit;
    }
    const upper = formato.toUpperCase().trim();
    if (upper.includes('30L') || upper.includes('30 L') || upper.includes('30 LT')) return 30.0;
    if (upper.includes('24L') || upper.includes('24 L') || upper.includes('24 LT')) return 24.0;
    if (upper.includes('20L') || upper.includes('20 L') || upper.includes('20 LT')) return 20.0;
    if (upper.includes('75CL') || upper.includes('75 CL')) return 0.75;
    if (upper.includes('50CL') || upper.includes('50 CL')) return 0.50;
    if (upper.includes('33CL') || upper.includes('33 CL')) return 0.33;
    if (upper.includes('5L') || upper.includes('5 LT')) return 5.0;
    return 1.0;
};

interface BeerFormatItem {
    name: string;
    liters: number;
    units: number;
    percent: number;
}

interface BeerDetailAnalysis {
    beerName: string;
    totalLiters: number;
    totalUnits: number;
    percentOnClient: number;
    formats: BeerFormatItem[];
    monthlyBreakdown: Array<{
        monthIndex: number;
        monthName: string;
        totalLiters: number;
        totalUnits: number;
        [formatName: string]: number | string;
    }>;
    monthlyUnitsBreakdown: Array<{
        monthIndex: number;
        monthName: string;
        totalUnits: number;
        [formatName: string]: number | string;
    }>;
    allFormats: string[];
    topFormat: BeerFormatItem | null;
    leastFormat: BeerFormatItem | null;
    peakMonth: { name: string; liters: number } | null;
}

export const SalesTrendView: React.FC<SalesTrendViewProps> = ({ selectedYear }) => {
    const { t } = useTranslation();
    const [isLoading, setIsLoading] = useState(true);
    const [clients, setClients] = useState<Cliente[]>([]);
    const [rawBreweryData, setRawBreweryData] = useState<BreweryData | null>(null);
    const [prevBreweryData, setPrevBreweryData] = useState<BreweryData | null>(null);
    const [allYearsData, setAllYearsData] = useState<Record<string, BreweryData>>({});
    const [currentStock, setCurrentStock] = useState<StockItem[]>([]);
    const [selectedClientId, setSelectedClientId] = useState<string>('');
    const [ownershipFilter, setOwnershipFilter] = useState<'ALL' | 'INTERNAL' | 'BEERFIRM'>('ALL');
    const [selectedInventoryCheckFilter, setSelectedInventoryCheckFilter] = useState<string>('ALL');

    // Comparative YoY / MoM panel tab
    const [comparisonTab, setComparisonTab] = useState<'months' | 'beers' | 'formats' | 'clients'>('months');

    // Chart customization states
    const [beerLimit, setBeerLimit] = useState<'8' | '15' | 'all'>('15');
    const [beerChartStyle, setBeerChartStyle] = useState<'vertical_candle' | 'horizontal_bar'>('vertical_candle');
    const [beerChartCompositionMode, setBeerChartCompositionMode] = useState<'total' | 'stacked_formats'>('total');
    const [monthlyViewMode, setMonthlyViewMode] = useState<'candle_volumes' | 'candlestick_ohlc'>('candle_volumes');

    // State for Drill-Down Single Beer Formats & Monthly Evolution
    const [selectedDetailBeer, setSelectedDetailBeer] = useState<string>('');
    const [detailViewTab, setDetailViewTab] = useState<'monthly_chart' | 'format_ranking' | 'matrix_table'>('monthly_chart');
    const [detailMonthlyMode, setDetailMonthlyMode] = useState<'stacked' | 'grouped'>('stacked');
    const [matrixDisplayUnit, setMatrixDisplayUnit] = useState<'liters' | 'units'>('liters');

    const prevYear = useMemo(() => String(Number(selectedYear) - 1), [selectedYear]);

    const loadData = useCallback(async () => {
        setIsLoading(true);
        const [data, pData, allYears] = await Promise.all([
            getBreweryData(selectedYear),
            getBreweryData(prevYear),
            getAllBreweryData(),
        ]);
        if (data) {
            setRawBreweryData(data);
            setClients(data.CLIENTI || []);
            const dualStock = computeDualLocationBeerStock(data);
            setCurrentStock(dualStock.centralSalesStock);
        } else {
            setRawBreweryData(null);
            setCurrentStock([]);
        }
        setPrevBreweryData(pData || null);
        setAllYearsData(allYears || {});
        setIsLoading(false);
    }, [selectedYear, prevYear]);

    useEffect(() => { loadData(); }, [loadData]);

    // Analisi Incassi (DDT/Ordini + Disavanzi Inventario) & Ripartizione Interna vs BeerFirm & Storico Pluriennale
    const revenueAndMultiYear = useMemo(() => {
        const getEffectiveDateStatic = (mov: BeerMovement): Date => {
            let d = parseDate(mov.data);
            if (mov.relatedDocId && mov.relatedDocId.startsWith('INVENTORY_INV_')) {
                if (!mov.relatedDocId.includes('CHIUSURA') && !mov.relatedDocId.includes('END')) {
                    const parts = mov.relatedDocId.replace('INVENTORY_INV_', '').split('_');
                    if (parts.length >= 2) {
                        const invYear = parseInt(parts[0], 10);
                        const invMonth = parseInt(parts[1], 10);
                        if (d.getFullYear() === invYear && d.getMonth() === invMonth - 1) {
                            d = new Date(invYear, invMonth - 1, 0);
                        }
                    }
                }
            }
            return d;
        };

        const computeYearSalesSnapshot = (
            yData: BreweryData,
            filterClientName?: string,
            ownFilter: 'ALL' | 'INTERNAL' | 'BEERFIRM' = 'ALL'
        ) => {
            const clean = computeCleanSalesAndWaste(yData, filterClientName);
            const internalName = getInternalClientName(yData);

            let internalNetLiters = 0;
            let beerfirmNetLiters = 0;

            clean.netSalesMovements.forEach(m => {
                const l = Math.abs(m.quantita) * getLitersPerUnit(m.formato);
                if (isInternalOwner(yData, m.cliente)) internalNetLiters += l;
                else beerfirmNetLiters += l;
            });
            clean.consignmentReturnMovements.forEach(r => {
                const l = Math.abs(r.quantita) * getLitersPerUnit(r.formato);
                if (isInternalOwner(yData, r.cliente)) internalNetLiters = Math.max(0, internalNetLiters - l);
                else beerfirmNetLiters = Math.max(0, beerfirmNetLiters - l);
            });

            const matchesOwn = (ownerName: string) => {
                if (filterClientName || ownFilter === 'ALL') return true;
                const isInt = isInternalOwner(yData, ownerName);
                return ownFilter === 'INTERNAL' ? isInt : !isInt;
            };

            // Ordini DDT Confezionate (sono vendite delle birre del birrificio interno)
            const matchingOrders = (yData.PACKAGED_BEER_ORDERS || []).filter(ord => {
                if (filterClientName) {
                    const fUpper = filterClientName.trim().toUpperCase();
                    return ord.client.trim().toUpperCase() === fUpper || internalName.trim().toUpperCase() === fUpper;
                }
                return ownFilter !== 'BEERFIRM';
            });

            let orderRevenueNet = 0;
            let orderRevenueGross = 0;
            const monthlyOrderRevenue = Array(12).fill(0);
            matchingOrders.forEach(ord => {
                orderRevenueNet += ord.totalNet || 0;
                orderRevenueGross += ord.totalGross || 0;
                const m = parseDate(ord.date).getMonth();
                if (m >= 0 && m < 12) monthlyOrderRevenue[m] += (ord.totalNet || 0);
            });

            // Vendite da Disavanzi Inventario (scontrini / banco / vendite fuori fattura)
            const inventorySalesLines: Array<{
                id: string;
                checkId: string;
                checkDate: string;
                attributedMonthLabel: string;
                monthIdx: number;
                cliente: string;
                isInternal: boolean;
                nomeBirra: string;
                lotto: string;
                formato: string;
                units: number;
                liters: number;
                unitPrice: number;
                priceSource: ResolvedPriceSource;
                totalRevenue: number;
            }> = [];

            let inventoryRevenue = 0;
            let inventorySoldLiters = 0;
            let inventorySoldUnits = 0;
            let unpricedInventoryItems = 0;
            const monthlyInventoryRevenue = Array(12).fill(0);
            const checkDateLookup = new Map<string, string>();
            (yData.BEER_INVENTORY_CHECKS || []).forEach(chk => {
                checkDateLookup.set(`INVENTORY_${chk.id}`, chk.date);
            });

            const monthLabelsIt = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];

            clean.netSalesMovements.forEach(mov => {
                if (!matchesOwn(mov.cliente)) return;
                if (!mov.relatedDocId || !mov.relatedDocId.startsWith('INVENTORY_')) return;

                const units = Math.abs(mov.quantita) || 0;
                const liters = round1(units * getLitersPerUnit(mov.formato));
                const effDate = getEffectiveDateStatic(mov);
                const monthIdx = effDate.getMonth();
                const resolved = resolveEffectiveSellingPrice({
                    data: yData,
                    cliente: mov.cliente,
                    beerName: mov.nomeBirra,
                    lotto: mov.lotto,
                    format: mov.formato,
                });

                const lineRev = Math.round(units * resolved.unitPrice * 100) / 100;
                if (resolved.unitPrice <= 0) unpricedInventoryItems += 1;

                inventoryRevenue += lineRev;
                inventorySoldLiters += liters;
                inventorySoldUnits += units;
                if (monthIdx >= 0 && monthIdx < 12) monthlyInventoryRevenue[monthIdx] += lineRev;

                inventorySalesLines.push({
                    id: mov.id,
                    checkId: mov.relatedDocId,
                    checkDate: checkDateLookup.get(mov.relatedDocId) || mov.data,
                    attributedMonthLabel: monthLabelsIt[monthIdx] || mov.data,
                    monthIdx,
                    cliente: mov.cliente,
                    isInternal: isInternalOwner(yData, mov.cliente),
                    nomeBirra: mov.nomeBirra,
                    lotto: mov.lotto,
                    formato: mov.formato,
                    units,
                    liters,
                    unitPrice: resolved.unitPrice,
                    priceSource: resolved.source,
                    totalRevenue: lineRev,
                });
            });

            // Storna eventuali resi da inventario / fiera dal prospetto incassi
            clean.consignmentReturnMovements.forEach(ret => {
                if (!matchesOwn(ret.cliente)) return;
                if (!ret.relatedDocId || !ret.relatedDocId.startsWith('INVENTORY_')) return;
                const units = Math.abs(ret.quantita) || 0;
                const resolved = resolveEffectiveSellingPrice({
                    data: yData,
                    cliente: ret.cliente,
                    beerName: ret.nomeBirra,
                    lotto: ret.lotto,
                    format: ret.formato,
                });
                const ded = Math.round(units * resolved.unitPrice * 100) / 100;
                inventoryRevenue = Math.max(0, inventoryRevenue - ded);
                const mIdx = getEffectiveDateStatic(ret).getMonth();
                if (mIdx >= 0 && mIdx < 12) {
                    monthlyInventoryRevenue[mIdx] = Math.max(0, monthlyInventoryRevenue[mIdx] - ded);
                }
            });

            inventorySalesLines.sort((a, b) => b.totalRevenue - a.totalRevenue || b.liters - a.liters);

            const monthlyRevenueChart = monthLabelsIt.map((name, idx) => ({
                name,
                incassoOrdiniDdt: Math.round(monthlyOrderRevenue[idx] * 100) / 100,
                incassoInventario: Math.round(monthlyInventoryRevenue[idx] * 100) / 100,
                totale: Math.round((monthlyOrderRevenue[idx] + monthlyInventoryRevenue[idx]) * 100) / 100,
            }));

            return {
                internalNetLiters: round1(internalNetLiters),
                beerfirmNetLiters: round1(beerfirmNetLiters),
                totalNetLiters: round1(internalNetLiters + beerfirmNetLiters),
                ordersCount: matchingOrders.length,
                orderRevenueNet: Math.round(orderRevenueNet * 100) / 100,
                orderRevenueGross: Math.round(orderRevenueGross * 100) / 100,
                inventoryRevenue: Math.round(inventoryRevenue * 100) / 100,
                inventorySoldLiters: round1(inventorySoldLiters),
                inventorySoldUnits,
                unpricedInventoryItems,
                totalRevenueNet: Math.round((orderRevenueNet + inventoryRevenue) * 100) / 100,
                monthlyRevenueChart,
                inventorySalesLines,
            };
        };

        const clientName = clients.find(c => c.id === selectedClientId)?.nome;
        const currentRev = rawBreweryData
            ? computeYearSalesSnapshot(rawBreweryData, clientName, ownershipFilter)
            : null;

        const sortedYears = Object.keys(allYearsData).sort();
        const multiYearRows = sortedYears.map((yr, idx) => {
            const snap = computeYearSalesSnapshot(allYearsData[yr], undefined, 'ALL');
            const prevSnap = idx > 0 ? computeYearSalesSnapshot(allYearsData[sortedYears[idx - 1]], undefined, 'ALL') : null;
            const yoyPct = prevSnap && prevSnap.totalNetLiters > 0
                ? round1(((snap.totalNetLiters - prevSnap.totalNetLiters) / prevSnap.totalNetLiters) * 100)
                : null;
            return {
                year: yr,
                ...snap,
                yoyPct,
                isCurrent: yr === selectedYear,
            };
        });

        return {
            currentRev,
            multiYearRows,
        };
    }, [rawBreweryData, allYearsData, clients, selectedClientId, ownershipFilter, selectedYear]);

    const analysisData = useMemo(() => {
        if (!rawBreweryData) return null;
        const clientName = clients.find(c => c.id === selectedClientId)?.nome;

        const applyOwnershipFilter = (
            metrics: ReturnType<typeof computeCleanSalesAndWaste>,
            refData: BreweryData
        ) => {
            if (clientName || ownershipFilter === 'ALL') return metrics;
            const matchFn = (owner: string) => {
                const isInt = isInternalOwner(refData, owner);
                return ownershipFilter === 'INTERNAL' ? isInt : !isInt;
            };
            const netSalesMovements = metrics.netSalesMovements.filter(m => matchFn(m.cliente));
            const consignmentReturnMovements = metrics.consignmentReturnMovements.filter(m => matchFn(m.cliente));
            const wasteMovements = metrics.wasteMovements.filter(m => matchFn(m.cliente));
            const grossSoldLiters = netSalesMovements.reduce((s, m) => s + Math.abs(m.quantita) * getLitersPerUnit(m.formato), 0);
            const returnedConsignmentLiters = consignmentReturnMovements.reduce((s, m) => s + Math.abs(m.quantita) * getLitersPerUnit(m.formato), 0);
            const netSoldLiters = Math.max(0, grossSoldLiters - returnedConsignmentLiters);
            let totalWastedLiters = 0;
            const wasteByReasonLiters = { ...metrics.wasteByReasonLiters };
            Object.keys(wasteByReasonLiters).forEach(k => { wasteByReasonLiters[k as keyof typeof wasteByReasonLiters] = 0; });
            wasteMovements.forEach(m => {
                const l = Math.abs(m.quantita) * getLitersPerUnit(m.formato);
                totalWastedLiters += l;
                const reason = m.wasteReason || 'OSSIDAZIONE_DIFETTO';
                wasteByReasonLiters[reason] = (wasteByReasonLiters[reason] || 0) + l;
            });
            return {
                ...metrics,
                netSalesMovements,
                consignmentReturnMovements,
                wasteMovements,
                grossSoldLiters,
                returnedConsignmentLiters,
                netSoldLiters,
                totalWastedLiters,
                wasteByReasonLiters,
            };
        };

        // Motore deduplicato: elimina doppio conteggio BeerFirm, scorpora Resi Fiere/Conto Vendita e separa Scarti/TMC
        const cleanCurrent = applyOwnershipFilter(computeCleanSalesAndWaste(rawBreweryData, clientName), rawBreweryData);
        const cleanGeneralCurrent = applyOwnershipFilter(computeCleanSalesAndWaste(rawBreweryData), rawBreweryData);
        const cleanPrev = prevBreweryData ? applyOwnershipFilter(computeCleanSalesAndWaste(prevBreweryData, clientName), prevBreweryData) : null;
        const cleanGeneralPrev = prevBreweryData ? applyOwnershipFilter(computeCleanSalesAndWaste(prevBreweryData), prevBreweryData) : null;

        const movementsToAnalyze = cleanCurrent.netSalesMovements;
        const returnMovements = cleanCurrent.consignmentReturnMovements;

        if (movementsToAnalyze.length === 0 && cleanCurrent.wasteMovements.length === 0) return null;

        const totalLitersSold = round1(cleanCurrent.netSoldLiters);

        // Helper per attribuire correttamente la data (inclusa M-1 da inventario inizio mese)
        const getEffectiveMovementDate = (mov: BeerMovement): Date => {
            let d = parseDate(mov.data);
            if (mov.relatedDocId && mov.relatedDocId.startsWith('INVENTORY_INV_')) {
                if (!mov.relatedDocId.includes('CHIUSURA') && !mov.relatedDocId.includes('END')) {
                    const parts = mov.relatedDocId.replace('INVENTORY_INV_', '').split('_');
                    if (parts.length >= 2) {
                        const invYear = parseInt(parts[0], 10);
                        const invMonth = parseInt(parts[1], 10);
                        if (d.getFullYear() === invYear && d.getMonth() === invMonth - 1) {
                            d = new Date(invYear, invMonth - 1, 0);
                        }
                    }
                }
            }
            return d;
        };

        // Sales by Beer (al netto dei resi conto vendita)
        const salesByBeerMap = movementsToAnalyze.reduce((acc, mov) => {
            const litersPerUnit = getLitersPerUnit(mov.formato);
            const liters = Math.abs(mov.quantita) * litersPerUnit;
            if (!acc[mov.nomeBirra]) {
                acc[mov.nomeBirra] = { liters: 0, count: 0 };
            }
            acc[mov.nomeBirra].liters += liters;
            acc[mov.nomeBirra].count += 1;
            return acc;
        }, {} as Record<string, { liters: number; count: number }>);

        returnMovements.forEach(ret => {
            const liters = Math.abs(ret.quantita) * getLitersPerUnit(ret.formato);
            if (salesByBeerMap[ret.nomeBirra]) {
                salesByBeerMap[ret.nomeBirra].liters = Math.max(0, salesByBeerMap[ret.nomeBirra].liters - liters);
            }
        });

        const topBeers = Object.entries(salesByBeerMap).map(([name, data]) => {
            const roundedLiters = round1(data.liters);
            const percent = totalLitersSold > 0 ? round1((roundedLiters / totalLitersSold) * 100) : 0;
            return {
                name,
                liters: roundedLiters,
                count: data.count,
                percent
            };
        }).sort((a, b) => b.liters - a.liters);

        // Sales by Format (al netto dei resi conto vendita)
        const salesByFormatMap = movementsToAnalyze.reduce((acc, mov) => {
            const litersPerUnit = getLitersPerUnit(mov.formato);
            const liters = Math.abs(mov.quantita) * litersPerUnit;
            acc[mov.formato] = (acc[mov.formato] || 0) + liters;
            return acc;
        }, {} as Record<string, number>);

        returnMovements.forEach(ret => {
            const liters = Math.abs(ret.quantita) * getLitersPerUnit(ret.formato);
            if (salesByFormatMap[ret.formato] !== undefined) {
                salesByFormatMap[ret.formato] = Math.max(0, salesByFormatMap[ret.formato] - liters);
            }
        });

        const topFormats = Object.entries(salesByFormatMap).map(([name, liters]) => {
            const roundedLiters = round1(liters);
            const percent = totalLitersSold > 0 ? round1((roundedLiters / totalLitersSold) * 100) : 0;
            return {
                name,
                liters: roundedLiters,
                percent
            };
        }).sort((a, b) => b.liters - a.liters);

        // Mix Fusti vs Bottiglie/Lattine
        let kegLiters = 0;
        let packagedSmallLiters = 0;
        topFormats.forEach(f => {
            const u = f.name.toUpperCase();
            if (u.includes('FUST') || u.includes('KEG') || u.includes('20L') || u.includes('24L') || u.includes('30L')) {
                kegLiters += f.liters;
            } else {
                packagedSmallLiters += f.liters;
            }
        });
        const kegMixPct = totalLitersSold > 0 ? round1((kegLiters / totalLitersSold) * 100) : 0;
        const bottleMixPct = totalLitersSold > 0 ? round1((packagedSmallLiters / totalLitersSold) * 100) : 0;

        // Sales by Client (Overall deduplicated & al netto dei resi)
        const salesByClientMap = cleanGeneralCurrent.netSalesMovements.reduce((acc, mov) => {
            const litersPerUnit = getLitersPerUnit(mov.formato);
            const liters = Math.abs(mov.quantita) * litersPerUnit;
            acc[mov.cliente] = (acc[mov.cliente] || 0) + liters;
            return acc;
        }, {} as Record<string, number>);

        cleanGeneralCurrent.consignmentReturnMovements.forEach(ret => {
            const liters = Math.abs(ret.quantita) * getLitersPerUnit(ret.formato);
            if (salesByClientMap[ret.cliente] !== undefined) {
                salesByClientMap[ret.cliente] = Math.max(0, salesByClientMap[ret.cliente] - liters);
            }
        });

        const topClients = Object.entries(salesByClientMap).map(([name, liters]) => ({
            name,
            liters: round1(liters)
        })).sort((a, b) => b.liters - a.liters);

        // Monthly Sales and OHLC distribution
        const monthNames = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];
        const monthlyVolumes: number[][] = Array.from({ length: 12 }, () => []);

        // =========================================================================
        // DETTAGLIO FORMATI PER SINGOLA BIRRA E ANDAMENTO MENSILE PER FORMATO
        // =========================================================================
        interface BeerRawData {
            totalLiters: number;
            totalUnits: number;
            allFormatsSet: Set<string>;
            formatsMap: Record<string, { liters: number; units: number }>;
            monthlyStats: Array<{
                monthIndex: number;
                monthName: string;
                totalLiters: number;
                totalUnits: number;
                [formatKey: string]: number | string;
            }>;
            monthlyUnits: Array<{
                monthIndex: number;
                monthName: string;
                totalUnits: number;
                [formatKey: string]: number | string;
            }>;
        }

        const beerRawMap = new Map<string, BeerRawData>();

        movementsToAnalyze.forEach(mov => {
            let d = parseDate(mov.data);

            // Salvaguardia / Attribuzione vendite da inventario a M-1:
            if (mov.relatedDocId && mov.relatedDocId.startsWith('INVENTORY_INV_')) {
                if (mov.relatedDocId.includes('CHIUSURA') || mov.relatedDocId.includes('END')) {
                    // Rimane a Dicembre (31/12)
                } else {
                    const parts = mov.relatedDocId.replace('INVENTORY_INV_', '').split('_');
                    if (parts.length >= 2) {
                        const invYear = parseInt(parts[0], 10);
                        const invMonth = parseInt(parts[1], 10); // 1-12
                        if (d.getFullYear() === invYear && d.getMonth() === invMonth - 1) {
                            d = new Date(invYear, invMonth - 1, 0);
                        }
                    }
                }
            }

            const month = d.getMonth();
            const litersPerUnit = getLitersPerUnit(mov.formato);
            const units = Math.abs(mov.quantita) || 0;
            const liters = round1(units * litersPerUnit);

            if (month >= 0 && month < 12) {
                if (liters > 0) {
                    monthlyVolumes[month].push(round1(liters));
                }

                // Dettaglio birra e formati
                const beerName = mov.nomeBirra || 'Sconosciuta';
                const formatName = mov.formato || 'ALTRO';

                let bEntry = beerRawMap.get(beerName);
                if (!bEntry) {
                    bEntry = {
                        totalLiters: 0,
                        totalUnits: 0,
                        allFormatsSet: new Set<string>(),
                        formatsMap: {},
                        monthlyStats: monthNames.map((mName, mIdx) => ({
                            monthIndex: mIdx,
                            monthName: mName,
                            totalLiters: 0,
                            totalUnits: 0,
                        })),
                        monthlyUnits: monthNames.map((mName, mIdx) => ({
                            monthIndex: mIdx,
                            monthName: mName,
                            totalUnits: 0,
                        }))
                    };
                    beerRawMap.set(beerName, bEntry);
                }

                bEntry.totalLiters = round1(bEntry.totalLiters + liters);
                bEntry.totalUnits += units;
                bEntry.allFormatsSet.add(formatName);

                if (!bEntry.formatsMap[formatName]) {
                    bEntry.formatsMap[formatName] = { liters: 0, units: 0 };
                }
                bEntry.formatsMap[formatName].liters = round1(bEntry.formatsMap[formatName].liters + liters);
                bEntry.formatsMap[formatName].units += units;

                // Monthly liters by format
                const mStat = bEntry.monthlyStats[month];
                mStat.totalLiters = round1(mStat.totalLiters + liters);
                mStat.totalUnits += units;
                const prevFmtL = typeof mStat[formatName] === 'number' ? (mStat[formatName] as number) : 0;
                mStat[formatName] = round1(prevFmtL + liters);

                // Monthly units by format
                const mUnit = bEntry.monthlyUnits[month];
                mUnit.totalUnits += units;
                const prevFmtU = typeof mUnit[formatName] === 'number' ? (mUnit[formatName] as number) : 0;
                mUnit[formatName] = prevFmtU + units;
            }
        });

        // Finalize Beer Details Map
        const beerDetailsMap: Record<string, BeerDetailAnalysis> = {};
        beerRawMap.forEach((raw, bName) => {
            const allFormats = Array.from(raw.allFormatsSet);

            // Sorted formats
            const formatsList: BeerFormatItem[] = allFormats.map(fmt => {
                const fData = raw.formatsMap[fmt] || { liters: 0, units: 0 };
                const pct = raw.totalLiters > 0 ? round1((fData.liters / raw.totalLiters) * 100) : 0;
                return {
                    name: fmt,
                    liters: round1(fData.liters),
                    units: fData.units,
                    percent: pct
                };
            }).sort((a, b) => b.liters - a.liters);

            // Peak month
            let peakMonth: { name: string; liters: number } | null = null;
            let maxL = -1;
            raw.monthlyStats.forEach(m => {
                if (m.totalLiters > maxL && m.totalLiters > 0) {
                    maxL = m.totalLiters;
                    peakMonth = { name: m.monthName, liters: m.totalLiters };
                }
            });

            const pctOnClient = totalLitersSold > 0 ? round1((raw.totalLiters / totalLitersSold) * 100) : 0;

            beerDetailsMap[bName] = {
                beerName: bName,
                totalLiters: raw.totalLiters,
                totalUnits: raw.totalUnits,
                percentOnClient: pctOnClient,
                formats: formatsList,
                monthlyBreakdown: raw.monthlyStats,
                monthlyUnitsBreakdown: raw.monthlyUnits,
                allFormats,
                topFormat: formatsList[0] || null,
                leastFormat: formatsList.length > 1 ? formatsList[formatsList.length - 1] : (formatsList[0] || null),
                peakMonth
            };
        });

        // Top Beers with stacked formats representation for Chart 1
        const allClientFormats = Array.from(
            new Set(movementsToAnalyze.map(m => m.formato).filter(Boolean))
        );

        const stackedTopBeers = topBeers.map(b => {
            const bDetail = beerDetailsMap[b.name];
            const row: Record<string, string | number> = {
                name: b.name,
                totalLiters: b.liters,
                count: b.count,
                percent: b.percent
            };
            if (bDetail) {
                bDetail.formats.forEach(f => {
                    row[f.name] = f.liters;
                });
            }
            return row;
        });

        // Sottrai eventuali resi conto vendita anche dal mese di competenza
        const monthlyReturnLiters = Array(12).fill(0);
        returnMovements.forEach(ret => {
            const d = getEffectiveMovementDate(ret);
            const m = d.getMonth();
            if (m >= 0 && m < 12) {
                monthlyReturnLiters[m] += Math.abs(ret.quantita) * getLitersPerUnit(ret.formato);
            }
        });

        // Calcolo serie storica Anno Precedente (YoY) per Mese, Birra, Formato e Cliente
        const prevMonthlyLiters = Array(12).fill(0);
        const prevBeerMap: Record<string, number> = {};
        const prevFormatMap: Record<string, number> = {};
        const prevClientMap: Record<string, number> = {};
        const hasPrevYearSales = !!(cleanPrev && (cleanPrev.netSalesMovements.length > 0 || cleanPrev.totalWastedLiters > 0));

        if (cleanPrev) {
            cleanPrev.netSalesMovements.forEach(mov => {
                const d = getEffectiveMovementDate(mov);
                const m = d.getMonth();
                const l = Math.abs(mov.quantita) * getLitersPerUnit(mov.formato);
                if (m >= 0 && m < 12) prevMonthlyLiters[m] += l;
                prevBeerMap[mov.nomeBirra] = (prevBeerMap[mov.nomeBirra] || 0) + l;
                prevFormatMap[mov.formato] = (prevFormatMap[mov.formato] || 0) + l;
            });
            cleanPrev.consignmentReturnMovements.forEach(ret => {
                const d = getEffectiveMovementDate(ret);
                const m = d.getMonth();
                const l = Math.abs(ret.quantita) * getLitersPerUnit(ret.formato);
                if (m >= 0 && m < 12) prevMonthlyLiters[m] = Math.max(0, prevMonthlyLiters[m] - l);
                if (prevBeerMap[ret.nomeBirra]) prevBeerMap[ret.nomeBirra] = Math.max(0, prevBeerMap[ret.nomeBirra] - l);
                if (prevFormatMap[ret.formato]) prevFormatMap[ret.formato] = Math.max(0, prevFormatMap[ret.formato] - l);
            });
        }

        if (cleanGeneralPrev) {
            cleanGeneralPrev.netSalesMovements.forEach(mov => {
                const l = Math.abs(mov.quantita) * getLitersPerUnit(mov.formato);
                prevClientMap[mov.cliente] = (prevClientMap[mov.cliente] || 0) + l;
            });
            cleanGeneralPrev.consignmentReturnMovements.forEach(ret => {
                const l = Math.abs(ret.quantita) * getLitersPerUnit(ret.formato);
                if (prevClientMap[ret.cliente]) prevClientMap[ret.cliente] = Math.max(0, prevClientMap[ret.cliente] - l);
            });
        }

        const salesByMonth = monthNames.map((name, i) => {
            const vols = monthlyVolumes[i];
            const grossMonth = vols.reduce((s, v) => s + v, 0);
            const total = round1(Math.max(0, grossMonth - monthlyReturnLiters[i]));
            const prevYearLiters = round1(prevMonthlyLiters[i]);
            const count = vols.length;
            const open = count > 0 ? vols[0] : 0;
            const close = count > 0 ? vols[count - 1] : 0;
            const high = count > 0 ? Math.max(...vols) : 0;
            const low = count > 0 ? Math.min(...vols) : 0;
            const avg = count > 0 ? round1(total / count) : 0;
            const isBullish = close >= open;

            return {
                name,
                Litri: total,
                LitriAnnoPrec: prevYearLiters,
                totalLiters: total,
                orderCount: count,
                open,
                close,
                high,
                low,
                avg,
                isBullish,
                momDeltaPct: null as number | null,
                yoyDeltaPct: prevYearLiters > 0 ? round1(((total - prevYearLiters) / prevYearLiters) * 100) : null
            };
        });

        // Calcola variazione Mese su Mese (MoM %)
        for (let i = 1; i < 12; i++) {
            const prevM = salesByMonth[i - 1].totalLiters;
            const currM = salesByMonth[i].totalLiters;
            if (prevM > 0) {
                salesByMonth[i].momDeltaPct = round1(((currM - prevM) / prevM) * 100);
            }
        }

        // Tabelle comparative Crescita / Calo YoY per Birra, Formato e Cliente
        const buildComparisonRows = (currRec: Record<string, number>, prevRec: Record<string, number>) => {
            const keys = Array.from(new Set([...Object.keys(currRec), ...Object.keys(prevRec)])).filter(Boolean);
            return keys.map(name => {
                const currL = round1(currRec[name] || 0);
                const prevL = round1(prevRec[name] || 0);
                const deltaL = round1(currL - prevL);
                const deltaPct = prevL > 0 ? round1(((currL - prevL) / prevL) * 100) : (currL > 0 ? 100 : 0);
                return { name, currL, prevL, deltaL, deltaPct, isNew: prevL === 0 && currL > 0 };
            }).sort((a, b) => b.currL - a.currL || b.prevL - a.prevL);
        };

        const currBeerSimpleMap: Record<string, number> = {};
        Object.entries(salesByBeerMap).forEach(([k, v]) => { currBeerSimpleMap[k] = v.liters; });

        const beerYoYRows = buildComparisonRows(currBeerSimpleMap, prevBeerMap);
        const formatYoYRows = buildComparisonRows(salesByFormatMap, prevFormatMap);
        const clientYoYRows = buildComparisonRows(salesByClientMap, prevClientMap);

        const prevTotalSold = cleanPrev ? round1(cleanPrev.netSoldLiters) : 0;
        const totalYoYDeltaPct = prevTotalSold > 0 ? round1(((totalLitersSold - prevTotalSold) / prevTotalSold) * 100) : null;

        // Slow moving items logic (unsold > 90 days)
        const threshold = new Date();
        threshold.setDate(threshold.getDate() - 90);

        const slowMovingItems = currentStock
            .filter(item => clientName ? item.cliente === clientName : true)
            .map(item => {
                const salesForItem = cleanGeneralCurrent.netSalesMovements.filter(sale => 
                    sale.cliente === item.cliente &&
                    sale.nomeBirra === item.nomeBirra &&
                    sale.formato === item.formato &&
                    sale.lotto === item.lotto
                ).sort((a,b) => parseDate(b.data).getTime() - parseDate(a.data).getTime());
                
                const lastSaleDate = salesForItem.length > 0 ? parseDate(salesForItem[0].data) : null;
                return { ...item, lastSaleDate };
            })
            .filter(item => !item.lastSaleDate || item.lastSaleDate < threshold);

        return { 
            totalLitersSold,
            grossSoldLiters: round1(cleanCurrent.grossSoldLiters),
            returnedConsignmentLiters: round1(cleanCurrent.returnedConsignmentLiters),
            totalWastedLiters: round1(cleanCurrent.totalWastedLiters),
            wasteByReasonLiters: cleanCurrent.wasteByReasonLiters,
            kegLiters: round1(kegLiters),
            packagedSmallLiters: round1(packagedSmallLiters),
            kegMixPct,
            bottleMixPct,
            prevTotalSold,
            totalYoYDeltaPct,
            hasPrevYearSales,
            beerYoYRows,
            formatYoYRows,
            clientYoYRows,
            topBeers, 
            topFormats, 
            topClients, 
            salesByMonth, 
            slowMovingItems,
            beerDetailsMap,
            stackedTopBeers,
            allClientFormats,
            totalMovementsCount: movementsToAnalyze.length
        };

    }, [rawBreweryData, prevBreweryData, currentStock, selectedClientId, clients, ownershipFilter]);

    // Keep selected detail beer in sync
    useEffect(() => {
        if (analysisData && analysisData.topBeers.length > 0) {
            if (!selectedDetailBeer || !analysisData.beerDetailsMap[selectedDetailBeer]) {
                setSelectedDetailBeer(analysisData.topBeers[0].name);
            }
        }
    }, [analysisData, selectedDetailBeer]);

    const currentSnapshot = revenueAndMultiYear.currentRev;
    const internalSharePct = currentSnapshot && currentSnapshot.totalNetLiters > 0
        ? round1((currentSnapshot.internalNetLiters / currentSnapshot.totalNetLiters) * 100)
        : 0;
    const beerfirmSharePct = currentSnapshot && currentSnapshot.totalNetLiters > 0
        ? round1(100 - internalSharePct)
        : 0;

    const distinctCheckIds = useMemo(() => {
        if (!currentSnapshot) return [];
        const map = new Map<string, string>();
        currentSnapshot.inventorySalesLines.forEach(line => {
            if (!map.has(line.checkId)) {
                map.set(line.checkId, `${line.checkDate} (${line.attributedMonthLabel})`);
            }
        });
        return Array.from(map.entries());
    }, [currentSnapshot]);

    const filteredInventorySalesLines = useMemo(() => {
        if (!currentSnapshot) return [];
        if (selectedInventoryCheckFilter === 'ALL') return currentSnapshot.inventorySalesLines;
        return currentSnapshot.inventorySalesLines.filter(l => l.checkId === selectedInventoryCheckFilter);
    }, [currentSnapshot, selectedInventoryCheckFilter]);

    const clientName = selectedClientId
        ? (clients.find(c => c.id === selectedClientId)?.nome || 'Cliente')
        : ownershipFilter === 'INTERNAL'
        ? 'Birrificio Interno'
        : ownershipFilter === 'BEERFIRM'
        ? 'Clienti BeerFirm'
        : 'Generale';

    const limitCount = beerLimit === '8' ? 8 : beerLimit === '15' ? 15 : undefined;
    const displayedBeers = analysisData
        ? (limitCount ? analysisData.topBeers.slice(0, limitCount) : analysisData.topBeers)
        : [];
    const displayedStackedBeers = analysisData
        ? (limitCount ? analysisData.stackedTopBeers.slice(0, limitCount) : analysisData.stackedTopBeers)
        : [];
    const activeBeerName =
        selectedDetailBeer && analysisData?.beerDetailsMap[selectedDetailBeer]
            ? selectedDetailBeer
            : (analysisData?.topBeers[0]?.name || '');
    const activeBeerDetail: BeerDetailAnalysis | null =
        activeBeerName && analysisData ? (analysisData.beerDetailsMap[activeBeerName] || null) : null;

    if (isLoading) return (
        <div className="flex items-center justify-center p-12 text-slate-400">
            <div className="w-6 h-6 border-2 border-brew-accent border-t-transparent rounded-full animate-spin mr-3"></div>
            <span>Caricamento dati di vendita...</span>
        </div>
    );

    return (
        <div className="space-y-6">
            {/* Header & Controls */}
            <div className="bg-brew-dark-secondary p-4 rounded-xl border border-slate-700 shadow-lg space-y-3">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div>
                        <h1 className="text-3xl font-bold text-brew-accent">
                            Andamento Vendite &amp; Incassi <span className="text-white text-2xl font-normal">— {clientName} ({selectedYear})</span>
                        </h1>
                        <p className="text-sm text-slate-400 mt-1">
                            Volumi venduti, confronto pluriennale, distinzione Birrificio vs BeerFirm e Prospetto Incassi (DDT + Inventari/Scontrini)
                        </p>
                    </div>

                    <div className="flex items-center gap-3">
                        <select 
                            value={selectedClientId} 
                            onChange={e => setSelectedClientId(e.target.value)}
                            className="bg-brew-dark text-white font-medium p-2.5 rounded-lg border border-slate-600 focus:outline-none focus:border-brew-accent shadow-sm"
                        >
                            <option value="">-- Analisi Generale (Birrificio + BeerFirm) --</option>
                            {clients.some(c => isInternalOwner(rawBreweryData, c.nome)) && (
                                <optgroup label="🏠 Birrificio Centrale (Birre Interne)">
                                    {clients
                                        .filter(c => isInternalOwner(rawBreweryData, c.nome))
                                        .map(c => <option key={c.id} value={c.id}>🏠 {c.nome}</option>)}
                                </optgroup>
                            )}
                            {clients.some(c => !isInternalOwner(rawBreweryData, c.nome)) && (
                                <optgroup label="🤝 Clienti BeerFirm / Terzi">
                                    {clients
                                        .filter(c => !isInternalOwner(rawBreweryData, c.nome))
                                        .map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
                                </optgroup>
                            )}
                        </select>

                        {selectedClientId && (
                            <button 
                                onClick={() => setSelectedClientId('')}
                                className="bg-slate-700 hover:bg-slate-600 text-slate-200 px-3 py-2.5 rounded-lg text-sm font-semibold transition-colors"
                            >
                                Mostra Generale
                            </button>
                        )}
                    </div>
                </div>

                {/* Ownership Filter & Share Strip */}
                {!selectedClientId && currentSnapshot && (
                    <div className="pt-3 border-t border-slate-700/80 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-[11px] font-bold uppercase text-slate-400 mr-1">Segmento:</span>
                            <button
                                type="button"
                                onClick={() => setOwnershipFilter('ALL')}
                                className={`px-3 py-1.5 rounded-md text-xs font-bold transition-colors ${
                                    ownershipFilter === 'ALL' ? 'bg-brew-accent text-brew-dark' : 'bg-brew-dark text-slate-300 border border-slate-700 hover:text-white'
                                }`}
                            >
                                Tutti ({formatL(currentSnapshot.totalNetLiters)})
                            </button>
                            <button
                                type="button"
                                onClick={() => setOwnershipFilter('INTERNAL')}
                                className={`px-3 py-1.5 rounded-md text-xs font-bold transition-colors ${
                                    ownershipFilter === 'INTERNAL' ? 'bg-emerald-500 text-slate-950' : 'bg-brew-dark text-emerald-300 border border-emerald-700/60 hover:bg-emerald-950/40'
                                }`}
                            >
                                🏠 Birre Interne Birrificio ({formatL(currentSnapshot.internalNetLiters)} · {internalSharePct}%)
                            </button>
                            <button
                                type="button"
                                onClick={() => setOwnershipFilter('BEERFIRM')}
                                className={`px-3 py-1.5 rounded-md text-xs font-bold transition-colors ${
                                    ownershipFilter === 'BEERFIRM' ? 'bg-sky-400 text-slate-950' : 'bg-brew-dark text-sky-300 border border-sky-700/60 hover:bg-sky-950/40'
                                }`}
                            >
                                🤝 Clienti BeerFirm Terzi ({formatL(currentSnapshot.beerfirmNetLiters)} · {beerfirmSharePct}%)
                            </button>
                        </div>

                        {currentSnapshot.totalNetLiters > 0 && (
                            <div className="flex items-center gap-2 min-w-[200px]">
                                <div className="flex-1 h-2.5 bg-slate-800 rounded-full overflow-hidden flex border border-slate-700">
                                    <div className="bg-emerald-500 h-full" style={{ width: `${internalSharePct}%` }} />
                                    <div className="bg-sky-400 h-full" style={{ width: `${beerfirmSharePct}%` }} />
                                </div>
                                <span className="text-[11px] font-mono text-slate-300 whitespace-nowrap">
                                    {internalSharePct}% / {beerfirmSharePct}%
                                </span>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* QUADRO STORICO PLURIENNALE VENDITE & INCASSI (TUTTI GLI ANNI REGISTRATI) */}
            {!selectedClientId && revenueAndMultiYear.multiYearRows.length > 0 && (
                <div className="bg-brew-dark-secondary p-5 rounded-xl border border-indigo-500/50 shadow-xl space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-700 pb-3">
                        <div>
                            <h2 className="text-lg font-black text-white flex items-center gap-2">
                                <span className="w-2.5 h-2.5 rounded-full bg-indigo-400 inline-block"></span>
                                Registro Pluriennale Vendite &amp; Incassi ({revenueAndMultiYear.multiYearRows.map(r => r.year).join(' · ')})
                            </h2>
                            <p className="text-xs text-slate-400 mt-0.5">
                                Storico automatico di ogni nuovo anno di lavoro con ripartizione Birrificio vs BeerFirm e totale incassi stimati
                            </p>
                        </div>
                        <span className="text-xs font-mono px-2.5 py-1 rounded bg-indigo-950/70 border border-indigo-500/50 text-indigo-200 self-start sm:self-auto">
                            {revenueAndMultiYear.multiYearRows.length} {revenueAndMultiYear.multiYearRows.length === 1 ? 'anno' : 'anni'}
                        </span>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-center">
                        <div className="lg:col-span-5 h-56">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={revenueAndMultiYear.multiYearRows} margin={{ top: 15, right: 15, left: 0, bottom: 5 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.5} vertical={false} />
                                    <XAxis dataKey="year" stroke="#94a3b8" tick={{ fill: '#f8fafc', fontSize: 12, fontWeight: 700 }} />
                                    <YAxis stroke="#94a3b8" tick={{ fill: '#94a3b8', fontSize: 11 }} tickFormatter={(v: number) => `${v} L`} />
                                    <Tooltip
                                        contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px', color: '#f8fafc' }}
                                        formatter={(val: number, name: string) => [`${round1(val).toFixed(1)} L`, name]}
                                    />
                                    <Legend wrapperStyle={{ fontSize: 11 }} />
                                    <Bar dataKey="internalNetLiters" name="Birre Interne Birrificio" stackId="yrS" fill="#10b981" maxBarSize={48} />
                                    <Bar dataKey="beerfirmNetLiters" name="Clienti BeerFirm" stackId="yrS" fill="#38bdf8" radius={[4, 4, 0, 0]} maxBarSize={48} />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>

                        <div className="lg:col-span-7 overflow-x-auto rounded-lg border border-slate-700">
                            <table className="w-full text-xs text-left text-slate-200 tabular-nums">
                                <thead className="bg-slate-800 uppercase text-[11px] text-slate-300">
                                    <tr>
                                        <th className="px-3 py-2">Anno</th>
                                        <th className="px-3 py-2 text-right">🏠 Interno</th>
                                        <th className="px-3 py-2 text-right">🤝 BeerFirm</th>
                                        <th className="px-3 py-2 text-right">Totale (L)</th>
                                        <th className="px-3 py-2 text-right">Var. YoY</th>
                                        <th className="px-3 py-2 text-right">Incasso DDT</th>
                                        <th className="px-3 py-2 text-right">Incasso Inv.</th>
                                        <th className="px-3 py-2 text-right">Totale €</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-800 font-mono">
                                    {revenueAndMultiYear.multiYearRows.map(yr => (
                                        <tr key={yr.year} className={yr.isCurrent ? 'bg-indigo-950/40 font-bold' : 'hover:bg-slate-800/40'}>
                                            <td className="px-3 py-2 text-white">{yr.year}</td>
                                            <td className="px-3 py-2 text-right text-emerald-300">{formatL(yr.internalNetLiters)}</td>
                                            <td className="px-3 py-2 text-right text-sky-300">{formatL(yr.beerfirmNetLiters)}</td>
                                            <td className="px-3 py-2 text-right text-amber-300 font-bold">{formatL(yr.totalNetLiters)}</td>
                                            <td className="px-3 py-2 text-right">
                                                {yr.yoyPct !== null ? (
                                                    <span className={yr.yoyPct >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                                                        {yr.yoyPct >= 0 ? '▲ +' : '▼ '}{yr.yoyPct}%
                                                    </span>
                                                ) : <span className="text-slate-500">Base</span>}
                                            </td>
                                            <td className="px-3 py-2 text-right text-slate-300">€ {yr.orderRevenueNet.toFixed(0)}</td>
                                            <td className="px-3 py-2 text-right text-cyan-300">€ {yr.inventoryRevenue.toFixed(0)}</td>
                                            <td className="px-3 py-2 text-right text-emerald-400 font-bold">€ {yr.totalRevenueNet.toFixed(0)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}

            {!analysisData ? (
                 <div className="text-center py-16 bg-brew-dark-secondary rounded-xl border border-slate-700/60 shadow-lg">
                    <p className="text-slate-400 text-lg">Nessun dato di vendita registrato per il periodo o filtro selezionato.</p>
                </div>
            ) : (
                <div className="space-y-6">
                    {/* Top KPI Cards (5Indicatori Strategici: Venduto Netto + YoY, Mix Fusti/Bottiglie, Top Birra, Top Formato, Monte Scarti/Scaduti) */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                        <div className="bg-gradient-to-br from-amber-500/20 to-amber-600/10 border border-amber-500/40 p-4 rounded-xl shadow-lg relative overflow-hidden">
                            <div className="flex items-center justify-between gap-1 mb-1">
                                <span className="text-amber-400 text-xs font-bold uppercase tracking-wider">Litri Venduti Netti</span>
                                {analysisData.totalYoYDeltaPct !== null && (
                                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-black ${
                                        analysisData.totalYoYDeltaPct >= 0 ? 'bg-emerald-900/80 text-emerald-300' : 'bg-red-900/80 text-red-300'
                                    }`}>
                                        {analysisData.totalYoYDeltaPct >= 0 ? '+' : ''}{analysisData.totalYoYDeltaPct}% vs {prevYear}
                                    </span>
                                )}
                            </div>
                            <div className="text-2xl sm:text-3xl font-extrabold text-amber-300">
                                {formatL(analysisData.totalLitersSold)}
                            </div>
                            <p className="text-[11px] text-amber-200/80 mt-1.5">
                                {analysisData.returnedConsignmentLiters > 0
                                    ? `Già detratti ${formatL(analysisData.returnedConsignmentLiters)} di resi fiere/c.vendita`
                                    : `Senza doppi conteggi BeerFirm • ${selectedYear}`}
                            </p>
                        </div>

                        <div className="bg-brew-dark-secondary border border-slate-700 p-4 rounded-xl shadow-lg">
                            <div className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-1">Mix Fusti vs Bott./Latt.</div>
                            <div className="text-lg font-extrabold text-white">
                                <span className="text-amber-300">{analysisData.kegMixPct}%</span> Fusti • <span className="text-cyan-300">{analysisData.bottleMixPct}%</span> Conf.
                            </div>
                            <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden mt-2 flex">
                                <div className="bg-amber-500 h-full" style={{ width: `${analysisData.kegMixPct}%` }} />
                                <div className="bg-cyan-500 h-full" style={{ width: `${analysisData.bottleMixPct}%` }} />
                            </div>
                            <p className="text-[11px] text-slate-400 mt-1">
                                Spina: {formatL(analysisData.kegLiters)} | Bott.: {formatL(analysisData.packagedSmallLiters)}
                            </p>
                        </div>

                        <div className="bg-brew-dark-secondary border border-slate-700 p-4 rounded-xl shadow-lg">
                            <div className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-1">Birra Più Venduta</div>
                            <div className="text-lg font-bold text-white truncate" title={analysisData.topBeers[0]?.name || 'N/D'}>
                                {analysisData.topBeers[0]?.name || 'Nessuna'}
                            </div>
                            <p className="text-xs font-semibold text-brew-accent mt-1">
                                {analysisData.topBeers[0] ? `${formatL(analysisData.topBeers[0].liters)} (${analysisData.topBeers[0].percent}%)` : '-'}
                            </p>
                        </div>

                        <div className="bg-brew-dark-secondary border border-slate-700 p-4 rounded-xl shadow-lg">
                            <div className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-1">Formato Preferito</div>
                            <div className="text-lg font-bold text-white truncate" title={analysisData.topFormats[0]?.name || 'N/D'}>
                                {analysisData.topFormats[0]?.name || 'Nessuno'}
                            </div>
                            <p className="text-xs font-semibold text-emerald-400 mt-1">
                                {analysisData.topFormats[0] ? `${formatL(analysisData.topFormats[0].liters)} (${analysisData.topFormats[0].percent}%)` : '-'}
                            </p>
                        </div>

                        <div className="bg-red-950/30 border border-red-700/60 p-4 rounded-xl shadow-lg">
                            <div className="text-red-300 text-xs font-bold uppercase tracking-wider mb-1">Litri Scartati / Scaduti</div>
                            <div className="text-2xl font-extrabold text-red-400">
                                {formatL(analysisData.totalWastedLiters)}
                            </div>
                            <p className="text-[11px] text-slate-300 mt-1 truncate" title="Separati dal monte vendite: TMC superato, ossidazione, contestazioni e rotture">
                                TMC: {round1(analysisData.wasteByReasonLiters.SCADENZA_TMC)}L • Difetti/Cont.: {round1(analysisData.wasteByReasonLiters.OSSIDAZIONE_DIFETTO + analysisData.wasteByReasonLiters.CONTESTAZIONE_CLIENTE)}L
                            </p>
                        </div>
                    </div>

                    {/* PROSPETTO INCASSI VENDITE (€): ORDINI DDT + VENDITE DA DISAVANZI INVENTARIO (SCONTRINI / CONTO VENDITA) */}
                    {currentSnapshot && (
                        <div className="bg-brew-dark-secondary p-5 rounded-xl border-2 border-emerald-500/60 shadow-2xl space-y-4">
                            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-slate-700 pb-3">
                                <div>
                                    <h2 className="text-xl font-black text-emerald-300 flex items-center gap-2">
                                        <span>💶</span>
                                        <span>Prospetto Incassi &amp; Analisi Ricavi Vendite — {selectedYear}</span>
                                    </h2>
                                    <p className="text-xs text-slate-300 mt-0.5">
                                        Calcolo economico unificato tra <strong>Ordini Birre Confezionate (DDT/Fatture)</strong> e <strong>Disavanzi da Inventari Inizio Mese</strong> (vendite con scontrino fiscale o fuori ordine valorizzate a Prezzo Lotto / Listino Base).
                                    </p>
                                </div>
                                {distinctCheckIds.length > 0 && (
                                    <select
                                        value={selectedInventoryCheckFilter}
                                        onChange={e => setSelectedInventoryCheckFilter(e.target.value)}
                                        className="bg-brew-dark border border-slate-600 rounded-lg px-3 py-1.5 text-xs text-white font-semibold"
                                    >
                                        <option value="ALL">Tutti i Controlli Inventario ({currentSnapshot.inventorySalesLines.length} righe)</option>
                                        {distinctCheckIds.map(([chkId, label]) => (
                                            <option key={chkId} value={chkId}>Controllo {label}</option>
                                        ))}
                                    </select>
                                )}
                            </div>

                            {/* KPI Finanziari Incassi */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 font-mono tabular-nums">
                                <div className="bg-emerald-950/40 border border-emerald-600/60 p-3.5 rounded-lg">
                                    <div className="text-[11px] font-sans uppercase font-bold text-emerald-300">Totale Incassi / Ricavi Stimati</div>
                                    <div className="text-2xl font-black text-white mt-1">
                                        € {currentSnapshot.totalRevenueNet.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </div>
                                    <div className="text-[11px] font-sans text-slate-300 mt-1">Imponibile DDT + Vendite da Inventario</div>
                                </div>

                                <div className="bg-brew-dark border border-slate-700 p-3.5 rounded-lg">
                                    <div className="text-[11px] font-sans uppercase font-bold text-sky-300">Da Ordini / DDT Confezionate</div>
                                    <div className="text-2xl font-black text-sky-300 mt-1">
                                        € {currentSnapshot.orderRevenueNet.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </div>
                                    <div className="text-[11px] font-sans text-slate-400 mt-1">
                                        {currentSnapshot.ordersCount} ordini (Ivato: € {currentSnapshot.orderRevenueGross.toLocaleString('it-IT', { minimumFractionDigits: 2 })})
                                    </div>
                                </div>

                                <div className="bg-brew-dark border border-slate-700 p-3.5 rounded-lg">
                                    <div className="text-[11px] font-sans uppercase font-bold text-amber-300">Da Disavanzi Inventario (Scontrini)</div>
                                    <div className="text-2xl font-black text-amber-300 mt-1">
                                        € {currentSnapshot.inventoryRevenue.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </div>
                                    <div className="text-[11px] font-sans text-slate-400 mt-1">
                                        {currentSnapshot.inventorySoldUnits} pz · {formatL(currentSnapshot.inventorySoldLiters)} mancanti
                                    </div>
                                </div>

                                <div className={`border p-3.5 rounded-lg ${currentSnapshot.unpricedInventoryItems > 0 ? 'bg-amber-950/30 border-amber-500/60' : 'bg-brew-dark border-slate-700'}`}>
                                    <div className="text-[11px] font-sans uppercase font-bold text-slate-300">Copertura Prezzi Vendita</div>
                                    <div className={`text-2xl font-black mt-1 ${currentSnapshot.unpricedInventoryItems > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                                        {currentSnapshot.unpricedInventoryItems === 0 ? '100% Valorizzato' : `${currentSnapshot.unpricedInventoryItems} senza prezzo`}
                                    </div>
                                    <div className="text-[11px] font-sans text-slate-400 mt-1">
                                        {currentSnapshot.unpricedInventoryItems > 0
                                            ? 'Imposta prezzo in Analisi Costi Lotto o Listino Base'
                                            : 'Tutti i lotti venduti hanno prezzo assegnato'}
                                    </div>
                                </div>
                            </div>

                            {/* Grafico Mensile Incassi DDT vs Inventari */}
                            <div className="h-64 w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={currentSnapshot.monthlyRevenueChart} margin={{ top: 15, right: 20, left: 5, bottom: 5 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.5} vertical={false} />
                                        <XAxis dataKey="name" stroke="#94a3b8" tick={{ fill: '#cbd5e1', fontSize: 12 }} />
                                        <YAxis stroke="#94a3b8" tick={{ fill: '#94a3b8', fontSize: 11 }} tickFormatter={(v: number) => `€${v}`} />
                                        <Tooltip
                                            contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px', color: '#f8fafc' }}
                                            formatter={(val: number, name: string) => [`€ ${Number(val).toFixed(2)}`, name]}
                                        />
                                        <Legend wrapperStyle={{ fontSize: 12 }} />
                                        <Bar dataKey="incassoOrdiniDdt" name="Incassi Ordini / DDT (€)" stackId="rev" fill="#0ea5e9" maxBarSize={44} />
                                        <Bar dataKey="incassoInventario" name="Incassi da Inventari / Scontrini (€)" stackId="rev" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={44} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>

                            {/* Tabella Dettaglio Incassi da Controlli Inventario */}
                            {filteredInventorySalesLines.length > 0 && (
                                <div className="overflow-x-auto max-h-80 rounded-lg border border-slate-700">
                                    <table className="w-full text-xs text-left text-slate-200 tabular-nums">
                                        <thead className="bg-slate-800 uppercase text-[11px] text-slate-300 sticky top-0">
                                            <tr>
                                                <th className="px-3 py-2">Controllo / Mese</th>
                                                <th className="px-3 py-2">Birra &amp; Proprietà</th>
                                                <th className="px-3 py-2">Lotto · Formato</th>
                                                <th className="px-3 py-2 text-right">Pezzi Mancanti</th>
                                                <th className="px-3 py-2 text-right">Litri</th>
                                                <th className="px-3 py-2 text-right">Prezzo Unit.</th>
                                                <th className="px-3 py-2 text-center">Fonte Prezzo</th>
                                                <th className="px-3 py-2 text-right">Incasso Stimato</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-800">
                                            {filteredInventorySalesLines.map(line => (
                                                <tr key={line.id} className="hover:bg-slate-800/40">
                                                    <td className="px-3 py-2 font-mono">
                                                        <div className="text-white font-semibold">{line.checkDate}</div>
                                                        <div className="text-[10px] text-emerald-300">Comp: {line.attributedMonthLabel}</div>
                                                    </td>
                                                    <td className="px-3 py-2">
                                                        <div className="font-bold text-white">{line.nomeBirra}</div>
                                                        <div className="text-[10px] text-slate-400">
                                                            {line.isInternal ? '🏠 Birrificio' : `🤝 ${line.cliente}`}
                                                        </div>
                                                    </td>
                                                    <td className="px-3 py-2">
                                                        <span className="font-mono text-brew-accent font-bold">{line.lotto}</span>
                                                        <div className="text-[11px] text-slate-300">{line.formato}</div>
                                                    </td>
                                                    <td className="px-3 py-2 text-right font-mono font-bold text-white">{line.units} pz</td>
                                                    <td className="px-3 py-2 text-right font-mono text-slate-300">{line.liters.toFixed(1)} L</td>
                                                    <td className="px-3 py-2 text-right font-mono text-cyan-300">
                                                        {line.unitPrice > 0 ? `€ ${line.unitPrice.toFixed(2)}` : <span className="text-amber-400">N/D</span>}
                                                    </td>
                                                    <td className="px-3 py-2 text-center">
                                                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                                            line.priceSource === 'LOT_CUSTOM'
                                                                ? 'bg-emerald-950 text-emerald-300 border border-emerald-700/60'
                                                                : line.priceSource === 'PROMO_TMC'
                                                                    ? 'bg-amber-950 text-amber-300 border border-amber-700/60'
                                                                    : line.priceSource === 'BEER_PRICE_LIST' || line.priceSource === 'CLIENT_OFFER'
                                                                        ? 'bg-sky-950 text-sky-300 border border-sky-700/60'
                                                                        : 'bg-red-950 text-red-300 border border-red-700/60'
                                                        }`}>
                                                            {line.priceSource === 'LOT_CUSTOM'
                                                                ? 'Prezzo Lotto'
                                                                : line.priceSource === 'PROMO_TMC'
                                                                    ? 'Promo TMC'
                                                                    : line.priceSource === 'CLIENT_OFFER'
                                                                        ? 'Offerta Cliente'
                                                                        : line.priceSource === 'BEER_PRICE_LIST'
                                                                            ? 'Listino Base'
                                                                            : 'Da Impostare'}
                                                        </span>
                                                    </td>
                                                    <td className="px-3 py-2 text-right font-mono font-black text-emerald-300">
                                                        € {line.totalRevenue.toFixed(2)}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    )}

                    {/* NUOVO MODULO DIREZIONALE: CONFRONTO MESI PRECEDENTI (MoM) & ANNO PRECEDENTE (YoY) */}
                    <div className="bg-brew-dark-secondary p-5 rounded-xl border-2 border-cyan-600/50 shadow-xl space-y-4">
                        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-slate-700 pb-3">
                            <div>
                                <h2 className="text-xl font-black text-white flex items-center gap-2">
                                    <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 inline-block"></span>
                                    Analisi Comparativa Nel Tempo: Crescite & Flessioni ({selectedYear} vs {prevYear} e Mese su Mese)
                                </h2>
                                <p className="text-xs text-slate-400 mt-0.5">
                                    Confronta i volumi attuali con i mesi precedenti (MoM %) e con l&apos;anno precedente ({prevYear}, YoY %) su singole birre, formati e clienti
                                </p>
                            </div>

                            <div className="inline-flex rounded-lg bg-brew-dark p-1 border border-slate-700 text-xs flex-wrap gap-1">
                                <button
                                    onClick={() => setComparisonTab('months')}
                                    className={`px-3 py-1.5 rounded-md font-bold transition-all ${comparisonTab === 'months' ? 'bg-cyan-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}
                                >
                                    📅 Mesi (MoM & YoY)
                                </button>
                                <button
                                    onClick={() => setComparisonTab('beers')}
                                    className={`px-3 py-1.5 rounded-md font-bold transition-all ${comparisonTab === 'beers' ? 'bg-cyan-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}
                                >
                                    🍺 Crescita/Calo Birre
                                </button>
                                <button
                                    onClick={() => setComparisonTab('formats')}
                                    className={`px-3 py-1.5 rounded-md font-bold transition-all ${comparisonTab === 'formats' ? 'bg-cyan-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}
                                >
                                    📦 Crescita/Calo Formati
                                </button>
                                {!selectedClientId && (
                                    <button
                                        onClick={() => setComparisonTab('clients')}
                                        className={`px-3 py-1.5 rounded-md font-bold transition-all ${comparisonTab === 'clients' ? 'bg-cyan-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}
                                    >
                                        🤝 Crescita/Calo Clienti
                                    </button>
                                )}
                            </div>
                        </div>

                        {comparisonTab === 'months' && (
                            <div className="space-y-4">
                                <div className="h-72 w-full">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart data={analysisData.salesByMonth} margin={{ top: 15, right: 20, left: 0, bottom: 5 }}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.5} vertical={false} />
                                            <XAxis dataKey="name" stroke="#94a3b8" tick={{ fill: '#cbd5e1', fontSize: 12 }} />
                                            <YAxis stroke="#94a3b8" tick={{ fill: '#94a3b8', fontSize: 11 }} tickFormatter={(v: number) => `${v} L`} />
                                            <Tooltip
                                                contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px', color: '#f8fafc' }}
                                                formatter={(val: number, name: string) => [`${round1(val).toFixed(1)} L`, name]}
                                            />
                                            <Legend wrapperStyle={{ fontSize: 12 }} />
                                            <Bar dataKey="LitriAnnoPrec" name={`Anno Precedente (${prevYear})`} fill="#64748b" radius={[4, 4, 0, 0]} />
                                            <Bar dataKey="Litri" name={`Anno Corrente (${selectedYear})`} fill="#06b6d4" radius={[4, 4, 0, 0]} />
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>

                                <div className="overflow-x-auto rounded-lg border border-slate-700">
                                    <table className="w-full text-xs text-left text-slate-200">
                                        <thead className="bg-slate-800 uppercase text-[11px] text-slate-300">
                                            <tr>
                                                <th className="px-3 py-2.5">Mese</th>
                                                <th className="px-3 py-2.5 text-right">Vendite {prevYear}</th>
                                                <th className="px-3 py-2.5 text-right">Vendite {selectedYear}</th>
                                                <th className="px-3 py-2.5 text-right">Var. su Mese Prec. (MoM)</th>
                                                <th className="px-3 py-2.5 text-right">Var. su Anno Prec. (YoY)</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-800 font-mono">
                                            {analysisData.salesByMonth.map(m => (
                                                <tr key={m.name} className="hover:bg-slate-800/40">
                                                    <td className="px-3 py-2 font-sans font-bold text-white">{m.name}</td>
                                                    <td className="px-3 py-2 text-right text-slate-400">{formatL(m.LitriAnnoPrec)}</td>
                                                    <td className="px-3 py-2 text-right font-bold text-cyan-300">{formatL(m.Litri)}</td>
                                                    <td className="px-3 py-2 text-right">
                                                        {m.momDeltaPct !== null ? (
                                                            <span className={m.momDeltaPct >= 0 ? 'text-emerald-400 font-bold' : 'text-red-400 font-bold'}>
                                                                {m.momDeltaPct >= 0 ? '▲ +' : '▼ '}{m.momDeltaPct}%
                                                            </span>
                                                        ) : <span className="text-slate-600">-</span>}
                                                    </td>
                                                    <td className="px-3 py-2 text-right">
                                                        {m.yoyDeltaPct !== null ? (
                                                            <span className={m.yoyDeltaPct >= 0 ? 'text-emerald-400 font-bold' : 'text-red-400 font-bold'}>
                                                                {m.yoyDeltaPct >= 0 ? '▲ +' : '▼ '}{m.yoyDeltaPct}%
                                                            </span>
                                                        ) : <span className="text-slate-600">{m.Litri > 0 ? 'Nuovo' : '-'}</span>}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}

                        {comparisonTab !== 'months' && (
                            <div className="overflow-x-auto max-h-96 rounded-lg border border-slate-700">
                                <table className="w-full text-xs text-left text-slate-200">
                                    <thead className="bg-slate-800 uppercase text-[11px] text-slate-300 sticky top-0">
                                        <tr>
                                            <th className="px-4 py-2.5">
                                                {comparisonTab === 'beers' ? 'Tipologia Birra' : comparisonTab === 'formats' ? 'Formato Confezione' : 'Cliente'}
                                            </th>
                                            <th className="px-4 py-2.5 text-right">Litri {prevYear}</th>
                                            <th className="px-4 py-2.5 text-right">Litri {selectedYear}</th>
                                            <th className="px-4 py-2.5 text-right">Differenza (Litri)</th>
                                            <th className="px-4 py-2.5 text-right">Andamento YoY %</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-800 font-mono">
                                        {(comparisonTab === 'beers'
                                            ? analysisData.beerYoYRows
                                            : comparisonTab === 'formats'
                                                ? analysisData.formatYoYRows
                                                : analysisData.clientYoYRows
                                        ).map(row => (
                                            <tr key={row.name} className="hover:bg-slate-800/50">
                                                <td className="px-4 py-2.5 font-sans font-bold text-white">{row.name}</td>
                                                <td className="px-4 py-2.5 text-right text-slate-400">{formatL(row.prevL)}</td>
                                                <td className="px-4 py-2.5 text-right font-bold text-amber-300">{formatL(row.currL)}</td>
                                                <td className={`px-4 py-2.5 text-right font-bold ${row.deltaL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                                    {row.deltaL >= 0 ? '+' : ''}{formatL(row.deltaL)}
                                                </td>
                                                <td className="px-4 py-2.5 text-right">
                                                    {row.isNew ? (
                                                        <span className="px-2 py-0.5 rounded bg-sky-900/60 text-sky-300 font-sans font-bold text-[10px]">NUOVA VOCE</span>
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

                    {/* MAIN CHART 1: Grafico Birre Più Vendute */}
                    <div className="bg-brew-dark-secondary p-5 rounded-xl border border-slate-700 shadow-xl space-y-4">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-700/80 pb-3">
                            <div>
                                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                                    <span className="w-2.5 h-2.5 rounded-full bg-brew-accent inline-block"></span>
                                    Birre più vendute — {beerChartCompositionMode === 'total' ? 'Grafico a Candela' : 'Ripartizione Formati Impilati'}
                                </h2>
                                <p className="text-xs text-slate-400 mt-0.5">
                                    {beerChartCompositionMode === 'total' 
                                        ? 'Visualizzazione candele verticali dei litri per singola referenza (clicca su una birra per il dettaglio formati)' 
                                        : 'Confronto immediato dei formati (fusti vs bottiglie) venduti per ciascuna birra'}
                                </p>
                            </div>

                            <div className="flex flex-wrap items-center gap-2">
                                {/* Composition Mode Toggle */}
                                <div className="inline-flex rounded-lg bg-brew-dark p-1 border border-slate-700 text-xs">
                                    <button
                                        onClick={() => setBeerChartCompositionMode('total')}
                                        className={`px-2.5 py-1 rounded-md font-semibold transition-all ${beerChartCompositionMode === 'total' ? 'bg-amber-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}
                                    >
                                        Candele Totali
                                    </button>
                                    <button
                                        onClick={() => setBeerChartCompositionMode('stacked_formats')}
                                        className={`px-2.5 py-1 rounded-md font-semibold transition-all ${beerChartCompositionMode === 'stacked_formats' ? 'bg-amber-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}
                                        title="Mostra la suddivisione interna dei formati impilati per ciascuna birra"
                                    >
                                        Formati Impilati
                                    </button>
                                </div>

                                {/* Beers display count selector */}
                                <div className="inline-flex rounded-lg bg-brew-dark p-1 border border-slate-700 text-xs">
                                    <button
                                        onClick={() => setBeerLimit('8')}
                                        className={`px-2.5 py-1 rounded-md font-semibold transition-all ${beerLimit === '8' ? 'bg-brew-accent text-brew-dark shadow' : 'text-slate-400 hover:text-white'}`}
                                    >
                                        Top 8
                                    </button>
                                    <button
                                        onClick={() => setBeerLimit('15')}
                                        className={`px-2.5 py-1 rounded-md font-semibold transition-all ${beerLimit === '15' ? 'bg-brew-accent text-brew-dark shadow' : 'text-slate-400 hover:text-white'}`}
                                    >
                                        Top 15
                                    </button>
                                    <button
                                        onClick={() => setBeerLimit('all')}
                                        className={`px-2.5 py-1 rounded-md font-semibold transition-all ${beerLimit === 'all' ? 'bg-brew-accent text-brew-dark shadow' : 'text-slate-400 hover:text-white'}`}
                                    >
                                        Tutte ({analysisData.topBeers.length})
                                    </button>
                                </div>

                                {/* Orientation switch (only in total mode) */}
                                {beerChartCompositionMode === 'total' && (
                                    <div className="inline-flex rounded-lg bg-brew-dark p-1 border border-slate-700 text-xs">
                                        <button
                                            onClick={() => setBeerChartStyle('vertical_candle')}
                                            className={`px-2.5 py-1 rounded-md font-semibold transition-all ${beerChartStyle === 'vertical_candle' ? 'bg-slate-700 text-white shadow' : 'text-slate-400 hover:text-white'}`}
                                            title="Colonne / Candele verticali"
                                        >
                                            Verticali
                                        </button>
                                        <button
                                            onClick={() => setBeerChartStyle('horizontal_bar')}
                                            className={`px-2.5 py-1 rounded-md font-semibold transition-all ${beerChartStyle === 'horizontal_bar' ? 'bg-slate-700 text-white shadow' : 'text-slate-400 hover:text-white'}`}
                                            title="Barre orizzontali"
                                        >
                                            Barre
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Chart Container */}
                        {beerChartCompositionMode === 'stacked_formats' ? (
                            <div className="w-full overflow-x-auto pb-2">
                                <div 
                                    className="h-96"
                                    style={{ 
                                        minWidth: displayedStackedBeers.length > 8 ? `${Math.max(720, displayedStackedBeers.length * 68)}px` : '100%' 
                                    }}
                                >
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart
                                            data={displayedStackedBeers}
                                            margin={{ top: 28, right: 24, left: 10, bottom: 65 }}
                                        >
                                            <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.6} vertical={false} />
                                            <XAxis 
                                                dataKey="name" 
                                                stroke="#94a3b8" 
                                                tick={{ fill: '#cbd5e1', fontSize: 11 }}
                                                interval={0}
                                                angle={-35}
                                                textAnchor="end"
                                                height={65}
                                            />
                                            <YAxis 
                                                stroke="#94a3b8"
                                                tick={{ fill: '#94a3b8', fontSize: 11 }}
                                                tickFormatter={(v: number) => `${round1(v)} L`}
                                            />
                                            <Tooltip 
                                                contentStyle={{ 
                                                    backgroundColor: '#0f172a', 
                                                    borderColor: '#334155', 
                                                    borderRadius: '8px', 
                                                    color: '#f8fafc',
                                                    boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.5)'
                                                }}
                                                formatter={(value: number, name: string) => [`${round1(value).toFixed(1)} L`, name]}
                                                labelFormatter={(label: string) => `🍺 Birra: ${label}`}
                                            />
                                            <Legend 
                                                wrapperStyle={{ paddingTop: 10, fontSize: 11 }}
                                            />
                                            {analysisData.allClientFormats.map((fmt, fIdx) => (
                                                <Bar
                                                    key={fmt}
                                                    dataKey={fmt}
                                                    name={fmt}
                                                    stackId="beerFormats"
                                                    fill={getFormatColor(fmt, fIdx)}
                                                    maxBarSize={52}
                                                    cursor="pointer"
                                                    onClick={(entry) => {
                                                        if (entry && entry.name) {
                                                            setSelectedDetailBeer(String(entry.name));
                                                        }
                                                    }}
                                                />
                                            ))}
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>
                        ) : beerChartStyle === 'vertical_candle' ? (
                            <div className="w-full overflow-x-auto pb-2">
                                <div 
                                    className="h-96"
                                    style={{ 
                                        minWidth: displayedBeers.length > 8 ? `${Math.max(680, displayedBeers.length * 64)}px` : '100%' 
                                    }}
                                >
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart
                                            data={displayedBeers}
                                            margin={{ top: 28, right: 24, left: 10, bottom: 65 }}
                                        >
                                            <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.6} vertical={false} />
                                            <XAxis 
                                                dataKey="name" 
                                                stroke="#94a3b8" 
                                                tick={{ fill: '#cbd5e1', fontSize: 11 }}
                                                interval={0}
                                                angle={-35}
                                                textAnchor="end"
                                                height={65}
                                            />
                                            <YAxis 
                                                stroke="#94a3b8"
                                                tick={{ fill: '#94a3b8', fontSize: 11 }}
                                                tickFormatter={(v: number) => `${round1(v)} L`}
                                            />
                                            <Tooltip 
                                                formatter={(value: number) => [`${round1(value).toFixed(1)} L`, 'Litri Venduti']}
                                                labelFormatter={(label: string) => `Birra: ${label}`}
                                                contentStyle={{ 
                                                    backgroundColor: '#0f172a', 
                                                    borderColor: '#334155', 
                                                    borderRadius: '8px', 
                                                    color: '#f8fafc',
                                                    boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.5)'
                                                }}
                                            />
                                            <Bar 
                                                dataKey="liters" 
                                                name="Litri Venduti" 
                                                radius={[6, 6, 0, 0]}
                                                maxBarSize={52}
                                                cursor="pointer"
                                                onClick={(entry) => {
                                                    if (entry && entry.name) {
                                                        setSelectedDetailBeer(String(entry.name));
                                                    }
                                                }}
                                            >
                                                {displayedBeers.map((entry, index) => (
                                                    <Cell 
                                                        key={`cell-${index}`} 
                                                        fill={entry.name === activeBeerName ? '#fbbf24' : CANDLE_COLORS[index % CANDLE_COLORS.length]} 
                                                        stroke={entry.name === activeBeerName ? '#ffffff' : undefined}
                                                        strokeWidth={entry.name === activeBeerName ? 2 : 0}
                                                    />
                                                ))}
                                                <LabelList 
                                                    dataKey="liters" 
                                                    position="top" 
                                                    formatter={(val: number) => `${round1(val).toFixed(1)} L`}
                                                    fill="#f8fafc"
                                                    fontSize={10}
                                                    fontWeight={600}
                                                    offset={8}
                                                />
                                            </Bar>
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>
                        ) : (
                            <div className="h-96">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart
                                        data={displayedBeers}
                                        layout="vertical"
                                        margin={{ top: 10, right: 60, left: 30, bottom: 10 }}
                                    >
                                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.6} horizontal={false} />
                                        <XAxis 
                                            type="number" 
                                            stroke="#94a3b8" 
                                            tick={{ fill: '#94a3b8', fontSize: 11 }}
                                            tickFormatter={(v: number) => `${round1(v)} L`}
                                        />
                                        <YAxis 
                                            dataKey="name" 
                                            type="category" 
                                            width={140} 
                                            stroke="#94a3b8"
                                            tick={{ fill: '#cbd5e1', fontSize: 12 }}
                                        />
                                        <Tooltip 
                                            formatter={(value: number) => [`${round1(value).toFixed(1)} L`, 'Litri Venduti']}
                                            labelFormatter={(label: string) => `Birra: ${label}`}
                                            contentStyle={{ 
                                                backgroundColor: '#0f172a', 
                                                borderColor: '#334155', 
                                                borderRadius: '8px', 
                                                color: '#f8fafc' 
                                            }}
                                        />
                                        <Bar 
                                            dataKey="liters" 
                                            name="Litri Venduti" 
                                            radius={[0, 6, 6, 0]}
                                            cursor="pointer"
                                            onClick={(entry) => {
                                                if (entry && entry.name) {
                                                    setSelectedDetailBeer(String(entry.name));
                                                }
                                            }}
                                        >
                                            {displayedBeers.map((entry, index) => (
                                                <Cell 
                                                    key={`bar-cell-${index}`} 
                                                    fill={entry.name === activeBeerName ? '#fbbf24' : CANDLE_COLORS[index % CANDLE_COLORS.length]} 
                                                    stroke={entry.name === activeBeerName ? '#ffffff' : undefined}
                                                    strokeWidth={entry.name === activeBeerName ? 2 : 0}
                                                />
                                            ))}
                                            <LabelList 
                                                dataKey="liters" 
                                                position="right" 
                                                formatter={(val: number) => `${round1(val).toFixed(1)} L`}
                                                fill="#f8fafc"
                                                fontSize={10}
                                                fontWeight={600}
                                                offset={8}
                                            />
                                        </Bar>
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        )}
                    </div>

                    {/* MAIN CHART 2: Andamento Mensile delle Vendite (Grafico a Candela Mensile) */}
                    <div className="bg-brew-dark-secondary p-5 rounded-xl border border-slate-700 shadow-xl space-y-4">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-700/80 pb-3">
                            <div>
                                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block"></span>
                                    {t('salesTrend.monthlySalesTrend')} — Grafico a Candela
                                </h2>
                                <p className="text-xs text-slate-400 mt-0.5">
                                    Volumi mensili complessivi (Gen - Dic) • Vendite da disavanzo inventario attribuite al mese vendite M-1
                                </p>
                            </div>

                            <div className="inline-flex rounded-lg bg-brew-dark p-1 border border-slate-700 text-xs">
                                <button
                                    onClick={() => setMonthlyViewMode('candle_volumes')}
                                    className={`px-3 py-1.5 rounded-md font-semibold transition-all ${monthlyViewMode === 'candle_volumes' ? 'bg-emerald-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}
                                >
                                    Candele Volumi Mensili
                                </button>
                                <button
                                    onClick={() => setMonthlyViewMode('candlestick_ohlc')}
                                    className={`px-3 py-1.5 rounded-md font-semibold transition-all ${monthlyViewMode === 'candlestick_ohlc' ? 'bg-emerald-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}
                                >
                                    Candele Giapponesi OHLC
                                </button>
                            </div>
                        </div>

                        {monthlyViewMode === 'candle_volumes' ? (
                            <div className="h-80">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart 
                                        data={analysisData.salesByMonth} 
                                        margin={{ top: 25, right: 20, left: 10, bottom: 10 }}
                                    >
                                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.6} vertical={false} />
                                        <XAxis 
                                            dataKey="name" 
                                            stroke="#94a3b8" 
                                            tick={{ fill: '#cbd5e1', fontSize: 12, fontWeight: 500 }}
                                        />
                                        <YAxis 
                                            stroke="#94a3b8" 
                                            tick={{ fill: '#94a3b8', fontSize: 11 }}
                                            tickFormatter={(val: number) => `${round1(val)} L`}
                                        />
                                        <Tooltip 
                                            formatter={(value: number) => [`${round1(value).toFixed(1)} L`, t('salesTrend.litersSold')]}
                                            labelFormatter={(label: string) => `Mese: ${label}`}
                                            contentStyle={{ 
                                                backgroundColor: '#0f172a', 
                                                borderColor: '#334155', 
                                                borderRadius: '8px', 
                                                color: '#f8fafc' 
                                            }}
                                        />
                                        <Bar 
                                            dataKey="Litri" 
                                            name={t('salesTrend.litersSold')} 
                                            fill="#10b981" 
                                            radius={[6, 6, 0, 0]}
                                            maxBarSize={48}
                                        >
                                            {analysisData.salesByMonth.map((entry, index) => (
                                                <Cell 
                                                    key={`month-cell-${index}`} 
                                                    fill={entry.Litri > 0 ? (index % 2 === 0 ? '#10b981' : '#059669') : '#334155'} 
                                                />
                                            ))}
                                            <LabelList 
                                                dataKey="Litri" 
                                                position="top" 
                                                formatter={(val: number) => val > 0 ? `${round1(val).toFixed(1)} L` : ''}
                                                fill="#f8fafc"
                                                fontSize={10}
                                                fontWeight={600}
                                                offset={6}
                                            />
                                        </Bar>
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        ) : (
                            /* Candela Giapponese OHLC: High (Max ordine), Low (Min ordine), Open (Primo ordine), Close (Ultimo ordine) */
                            <div className="space-y-3">
                                <div className="p-3 bg-brew-dark rounded-lg border border-slate-700/80 flex flex-wrap items-center justify-between text-xs text-slate-300 gap-2">
                                    <div className="flex items-center gap-4">
                                        <span className="flex items-center gap-1.5">
                                            <span className="w-3 h-3 bg-emerald-500 rounded-sm inline-block"></span>
                                            Candela Verde: Chiusura &ge; Apertura (Crescita volumi ordine nel mese)
                                        </span>
                                        <span className="flex items-center gap-1.5">
                                            <span className="w-3 h-3 bg-red-500 rounded-sm inline-block"></span>
                                            Candela Rossa: Chiusura &lt; Apertura (Flessione volumi ordine)
                                        </span>
                                    </div>
                                    <span className="text-slate-400">
                                        Ombre candela: Min &bull; Max volume singolo ordine
                                    </span>
                                </div>

                                <div className="h-80 w-full">
                                    {(() => {
                                        const months = analysisData.salesByMonth;
                                        const maxVal = Math.max(...months.map(m => m.high), 20);
                                        const svgH = 280;
                                        const padTop = 30;
                                        const padBottom = 40;
                                        const usableH = svgH - padTop - padBottom;
                                        const getY = (val: number) => svgH - padBottom - (val / maxVal) * usableH;

                                        return (
                                            <svg className="w-full h-full" viewBox={`0 0 800 ${svgH}`}>
                                                {/* Background Grid Lines */}
                                                {[0, 0.25, 0.5, 0.75, 1].map((ratio, idx) => {
                                                    const val = round1(maxVal * ratio);
                                                    const y = getY(val);
                                                    return (
                                                        <g key={idx}>
                                                            <line x1="50" y1={y} x2="780" y2={y} stroke="#334155" strokeDasharray="3 3" opacity={0.6} />
                                                            <text x="42" y={y + 4} textAnchor="end" fill="#94a3b8" fontSize="10">
                                                                {val.toFixed(1)} L
                                                            </text>
                                                        </g>
                                                    );
                                                })}

                                                {/* Candlesticks for each of the 12 months */}
                                                {months.map((m, idx) => {
                                                    const step = (780 - 60) / 12;
                                                    const cx = 60 + idx * step + step / 2;
                                                    const candleW = Math.max(step * 0.55, 16);

                                                    if (m.orderCount === 0) {
                                                        const yBase = getY(0);
                                                        return (
                                                            <g key={idx}>
                                                                <circle cx={cx} cy={yBase} r="2" fill="#475569" />
                                                                <text x={cx} y={svgH - 15} textAnchor="middle" fill="#64748b" fontSize="11">
                                                                    {m.name}
                                                                </text>
                                                            </g>
                                                        );
                                                    }

                                                    const yHigh = getY(m.high);
                                                    const yLow = getY(m.low);
                                                    const yOpen = getY(m.open);
                                                    const yClose = getY(m.close);

                                                    const bodyTop = Math.min(yOpen, yClose);
                                                    const bodyH = Math.max(Math.abs(yClose - yOpen), 4);
                                                    const isUp = m.isBullish;
                                                    const color = isUp ? '#10b981' : '#ef4444';

                                                    return (
                                                        <g key={idx} className="cursor-pointer group">
                                                            {/* High-Low Wick */}
                                                            <line 
                                                                x1={cx} 
                                                                y1={yHigh} 
                                                                x2={cx} 
                                                                y2={yLow} 
                                                                stroke={color} 
                                                                strokeWidth="1.5" 
                                                            />
                                                            {/* Candle Real Body */}
                                                            <rect 
                                                                x={cx - candleW / 2} 
                                                                y={bodyTop} 
                                                                width={candleW} 
                                                                height={bodyH} 
                                                                fill={color} 
                                                                rx="2" 
                                                            />
                                                            {/* Month Label */}
                                                            <text x={cx} y={svgH - 15} textAnchor="middle" fill="#cbd5e1" fontSize="11" fontWeight="600">
                                                                {m.name}
                                                            </text>
                                                            {/* Total Liters Label */}
                                                            <text x={cx} y={bodyTop - 8} textAnchor="middle" fill="#f8fafc" fontSize="9" fontWeight="bold">
                                                                {m.totalLiters > 0 ? `${round1(m.totalLiters)}L` : ''}
                                                            </text>
                                                        </g>
                                                    );
                                                })}
                                            </svg>
                                        );
                                    })()}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* ========================================================================= */}
                    {/* SECTION: DETTAGLIO FORMATI & ANDAMENTO MENSILE PER SINGOLA BIRRA */}
                    {/* ========================================================================= */}
                    <div className="bg-brew-dark-secondary p-5 rounded-xl border-2 border-amber-500/60 shadow-2xl space-y-5">
                        {/* Section Header */}
                        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-700/80 pb-4">
                            <div>
                                <div className="flex items-center gap-2">
                                    <span className="p-1.5 bg-amber-500/20 text-amber-400 rounded-lg text-lg">🍺</span>
                                    <h2 className="text-xl font-black text-amber-400 tracking-wide">
                                        Dettaglio Formati & Andamento Mensile per Singola Birra
                                    </h2>
                                </div>
                                <p className="text-xs text-slate-300 mt-1">
                                    Controlla per ciascuna tipologia di birra prodotta quali formati (fusti, bottiglie, lattine) vengono venduti di più o di meno e in quali mesi dell'anno.
                                </p>
                            </div>

                            {/* View Switcher Tabs */}
                            <div className="inline-flex rounded-lg bg-brew-dark p-1 border border-slate-700 text-xs self-start lg:self-auto flex-wrap">
                                <button
                                    onClick={() => setDetailViewTab('monthly_chart')}
                                    className={`px-3 py-1.5 rounded-md font-bold transition-all ${
                                        detailViewTab === 'monthly_chart' 
                                            ? 'bg-amber-600 text-white shadow-lg' 
                                            : 'text-slate-400 hover:text-white'
                                    }`}
                                >
                                    📊 Andamento Mese x Formato
                                </button>
                                <button
                                    onClick={() => setDetailViewTab('format_ranking')}
                                    className={`px-3 py-1.5 rounded-md font-bold transition-all ${
                                        detailViewTab === 'format_ranking' 
                                            ? 'bg-amber-600 text-white shadow-lg' 
                                            : 'text-slate-400 hover:text-white'
                                    }`}
                                >
                                    🏆 Classifica Formati Birra
                                </button>
                                <button
                                    onClick={() => setDetailViewTab('matrix_table')}
                                    className={`px-3 py-1.5 rounded-md font-bold transition-all ${
                                        detailViewTab === 'matrix_table' 
                                            ? 'bg-amber-600 text-white shadow-lg' 
                                            : 'text-slate-400 hover:text-white'
                                    }`}
                                >
                                    📋 Matrice Tabellare Mesi x Formati
                                </button>
                            </div>
                        </div>

                        {/* Interactive Beer Selector Carousel / Pills */}
                        <div className="space-y-2">
                            <div className="flex items-center justify-between text-xs font-bold uppercase text-slate-400">
                                <span>Seleziona la Birra da Analizzare ({analysisData.topBeers.length} referenze):</span>
                                <span className="text-amber-400 font-normal normal-case">
                                    Birra attiva: <strong>{activeBeerName}</strong>
                                </span>
                            </div>

                            <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-thin">
                                {analysisData.topBeers.map((b, idx) => {
                                    const isSelected = b.name === activeBeerName;
                                    return (
                                        <button
                                            key={b.name}
                                            onClick={() => setSelectedDetailBeer(b.name)}
                                            className={`px-3 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all flex items-center gap-2 flex-shrink-0 border ${
                                                isSelected 
                                                    ? 'bg-amber-500/20 border-amber-500 text-amber-200 shadow-md ring-2 ring-amber-500/50' 
                                                    : 'bg-brew-dark border-slate-700/80 text-slate-300 hover:bg-slate-700/70 hover:border-slate-500'
                                            }`}
                                        >
                                            <span>{idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : '🍺'}</span>
                                            <span className="font-extrabold">{b.name}</span>
                                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-black ${
                                                isSelected ? 'bg-amber-500 text-brew-dark' : 'bg-slate-700 text-slate-200'
                                            }`}>
                                                {formatL(b.liters)}
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Detail Summary Cards for the Active Beer */}
                        {activeBeerDetail && (
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                                <div className="bg-brew-dark/80 p-3.5 rounded-xl border border-slate-700">
                                    <div className="text-[11px] font-bold uppercase text-slate-400">Litri Totali Birra</div>
                                    <div className="text-2xl font-black text-amber-300 mt-0.5">
                                        {formatL(activeBeerDetail.totalLiters)}
                                    </div>
                                    <p className="text-xs text-amber-400/80 mt-1">
                                        {activeBeerDetail.percentOnClient}% del volume totale venduto
                                    </p>
                                </div>

                                <div className="bg-brew-dark/80 p-3.5 rounded-xl border border-emerald-700/60">
                                    <div className="text-[11px] font-bold uppercase text-emerald-400">🏆 Formato Più Venduto</div>
                                    <div className="text-base font-extrabold text-white mt-0.5 truncate" title={activeBeerDetail.topFormat?.name || 'N/D'}>
                                        {activeBeerDetail.topFormat?.name || 'N/D'}
                                    </div>
                                    <p className="text-xs text-emerald-300 mt-1">
                                        {activeBeerDetail.topFormat ? `${formatL(activeBeerDetail.topFormat.liters)} (${activeBeerDetail.topFormat.percent}%) • ${activeBeerDetail.topFormat.units} pezzi` : '-'}
                                    </p>
                                </div>

                                <div className="bg-brew-dark/80 p-3.5 rounded-xl border border-slate-700">
                                    <div className="text-[11px] font-bold uppercase text-slate-400">📉 Formato Meno Venduto</div>
                                    <div className="text-base font-extrabold text-slate-200 mt-0.5 truncate" title={activeBeerDetail.leastFormat?.name || 'N/D'}>
                                        {activeBeerDetail.leastFormat?.name || 'N/D'}
                                    </div>
                                    <p className="text-xs text-slate-400 mt-1">
                                        {activeBeerDetail.leastFormat ? `${formatL(activeBeerDetail.leastFormat.liters)} (${activeBeerDetail.leastFormat.percent}%) • ${activeBeerDetail.leastFormat.units} pezzi` : '-'}
                                    </p>
                                </div>

                                <div className="bg-brew-dark/80 p-3.5 rounded-xl border border-slate-700">
                                    <div className="text-[11px] font-bold uppercase text-slate-400">☀️ Mese Record Vendite</div>
                                    <div className="text-2xl font-black text-white mt-0.5">
                                        {activeBeerDetail.peakMonth?.name || 'N/D'}
                                    </div>
                                    <p className="text-xs text-amber-300 mt-1">
                                        {activeBeerDetail.peakMonth ? `${formatL(activeBeerDetail.peakMonth.liters)} venduti` : 'Nessun picco'}
                                    </p>
                                </div>
                            </div>
                        )}

                        {/* TAB 1: GRAFICO MENSILE FORMATI (STACKED BAR CHART) */}
                        {detailViewTab === 'monthly_chart' && activeBeerDetail && (
                            <div className="bg-brew-dark p-4 rounded-xl border border-slate-700 space-y-3">
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                    <div>
                                        <h3 className="text-sm font-bold text-white flex items-center gap-2">
                                            <span>📈</span>
                                            <span>Andamento Mensile per Formato — {activeBeerName}</span>
                                        </h3>
                                        <p className="text-xs text-slate-400 mt-0.5">
                                            Ogni mese mostra i litri venduti suddivisi per i diversi formati di confezionamento
                                        </p>
                                    </div>

                                    <div className="inline-flex rounded-lg bg-brew-dark-secondary p-1 border border-slate-700 text-xs self-start sm:self-auto">
                                        <button
                                            onClick={() => setDetailMonthlyMode('stacked')}
                                            className={`px-2.5 py-1 rounded-md font-semibold transition-all ${
                                                detailMonthlyMode === 'stacked' 
                                                    ? 'bg-amber-600 text-white shadow' 
                                                    : 'text-slate-400 hover:text-white'
                                            }`}
                                        >
                                            Barre Impilate (Totale + Dettaglio)
                                        </button>
                                        <button
                                            onClick={() => setDetailMonthlyMode('grouped')}
                                            className={`px-2.5 py-1 rounded-md font-semibold transition-all ${
                                                detailMonthlyMode === 'grouped' 
                                                    ? 'bg-amber-600 text-white shadow' 
                                                    : 'text-slate-400 hover:text-white'
                                            }`}
                                        >
                                            Barre Raggruppate
                                        </button>
                                    </div>
                                </div>

                                <div className="h-80 w-full">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart
                                            data={activeBeerDetail.monthlyBreakdown}
                                            margin={{ top: 20, right: 20, left: 10, bottom: 10 }}
                                        >
                                            <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.6} vertical={false} />
                                            <XAxis 
                                                dataKey="monthName" 
                                                stroke="#94a3b8" 
                                                tick={{ fill: '#cbd5e1', fontSize: 12, fontWeight: 500 }}
                                            />
                                            <YAxis 
                                                stroke="#94a3b8"
                                                tick={{ fill: '#94a3b8', fontSize: 11 }}
                                                tickFormatter={(v: number) => `${round1(v)} L`}
                                            />
                                            <Tooltip 
                                                contentStyle={{ 
                                                    backgroundColor: '#0f172a', 
                                                    borderColor: '#334155', 
                                                    borderRadius: '8px', 
                                                    color: '#f8fafc',
                                                    boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.5)'
                                                }}
                                                formatter={(value: number, name: string) => [`${round1(value).toFixed(1)} L`, name]}
                                                labelFormatter={(label: string) => `Mese: ${label}`}
                                            />
                                            <Legend 
                                                wrapperStyle={{ paddingTop: 10, fontSize: 11 }}
                                            />
                                            {activeBeerDetail.allFormats.map((fmt, fIdx) => (
                                                <Bar
                                                    key={fmt}
                                                    dataKey={fmt}
                                                    name={fmt}
                                                    stackId={detailMonthlyMode === 'stacked' ? 'beerMonthly' : undefined}
                                                    fill={getFormatColor(fmt, fIdx)}
                                                    maxBarSize={detailMonthlyMode === 'stacked' ? 44 : 20}
                                                    radius={detailMonthlyMode === 'stacked' ? [0, 0, 0, 0] : [4, 4, 0, 0]}
                                                />
                                            ))}
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>
                        )}

                        {/* TAB 2: CLASSIFICA FORMATI PER QUESTA BIRRA */}
                        {detailViewTab === 'format_ranking' && activeBeerDetail && (
                            <div className="bg-brew-dark p-4 rounded-xl border border-slate-700 space-y-4">
                                <div>
                                    <h3 className="text-sm font-bold text-white flex items-center gap-2">
                                        <span>🏆</span>
                                        <span>Ripartizione Formati di Confezionamento — {activeBeerName}</span>
                                    </h3>
                                    <p className="text-xs text-slate-400 mt-0.5">
                                        Analisi dei formati venduti per questa birra ordinati dal più richiesto al meno richiesto
                                    </p>
                                </div>

                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                    {/* Chart */}
                                    <div className="h-72">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <BarChart
                                                data={activeBeerDetail.formats}
                                                layout="vertical"
                                                margin={{ top: 10, right: 60, left: 30, bottom: 5 }}
                                            >
                                                <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.6} horizontal={false} />
                                                <XAxis 
                                                    type="number" 
                                                    stroke="#94a3b8" 
                                                    tick={{ fill: '#94a3b8', fontSize: 11 }}
                                                    tickFormatter={(v: number) => `${round1(v)} L`}
                                                />
                                                <YAxis 
                                                    dataKey="name" 
                                                    type="category" 
                                                    width={140} 
                                                    stroke="#94a3b8"
                                                    tick={{ fill: '#cbd5e1', fontSize: 11 }}
                                                />
                                                <Tooltip 
                                                    formatter={(value: number) => [`${round1(value).toFixed(1)} L`, 'Litri Venduti']}
                                                    labelFormatter={(label: string) => `Formato: ${label}`}
                                                    contentStyle={{ 
                                                        backgroundColor: '#0f172a', 
                                                        borderColor: '#334155', 
                                                        borderRadius: '8px', 
                                                        color: '#f8fafc' 
                                                    }}
                                                />
                                                <Bar dataKey="liters" name="Litri Venduti" radius={[0, 6, 6, 0]}>
                                                    {activeBeerDetail.formats.map((entry, index) => (
                                                        <Cell key={`fmt-cell-${index}`} fill={getFormatColor(entry.name, index)} />
                                                    ))}
                                                    <LabelList 
                                                        dataKey="liters" 
                                                        position="right" 
                                                        formatter={(val: number) => `${round1(val).toFixed(1)} L`}
                                                        fill="#f8fafc"
                                                        fontSize={10}
                                                        fontWeight={600}
                                                        offset={8}
                                                    />
                                                </Bar>
                                            </BarChart>
                                        </ResponsiveContainer>
                                    </div>

                                    {/* Detailed breakdown list */}
                                    <div className="space-y-2 overflow-y-auto max-h-72 pr-1">
                                        {activeBeerDetail.formats.map((fmt, idx) => (
                                            <div 
                                                key={fmt.name}
                                                className="p-3 bg-brew-dark-secondary rounded-lg border border-slate-700/80 flex items-center justify-between gap-3 shadow"
                                            >
                                                <div className="flex items-center gap-2.5">
                                                    <span 
                                                        className="w-3.5 h-3.5 rounded-full flex-shrink-0"
                                                        style={{ backgroundColor: getFormatColor(fmt.name, idx) }}
                                                    />
                                                    <div>
                                                        <div className="font-extrabold text-white text-sm">
                                                            {fmt.name}
                                                        </div>
                                                        <div className="text-xs text-slate-400 mt-0.5">
                                                            {fmt.units} unità/pezzi confezionati
                                                        </div>
                                                    </div>
                                                </div>

                                                <div className="text-right">
                                                    <div className="text-sm font-black text-amber-300">
                                                        {formatL(fmt.liters)}
                                                    </div>
                                                    <div className="text-xs text-emerald-400 font-bold">
                                                        {fmt.percent}%
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* TAB 3: MATRICE COMPLETA MESI X FORMATI */}
                        {detailViewTab === 'matrix_table' && activeBeerDetail && (
                            <div className="bg-brew-dark p-4 rounded-xl border border-slate-700 space-y-3">
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                    <div>
                                        <h3 className="text-sm font-bold text-white flex items-center gap-2">
                                            <span>📋</span>
                                            <span>Matrice Stagionale Formati per Mese — {activeBeerName}</span>
                                        </h3>
                                        <p className="text-xs text-slate-400 mt-0.5">
                                            Tutti i volumi venduti mese per mese per ciascuna tipologia di fusto o bottiglia
                                        </p>
                                    </div>

                                    <div className="inline-flex rounded-lg bg-brew-dark-secondary p-1 border border-slate-700 text-xs self-start sm:self-auto">
                                        <button
                                            onClick={() => setMatrixDisplayUnit('liters')}
                                            className={`px-3 py-1 rounded-md font-semibold transition-all ${
                                                matrixDisplayUnit === 'liters' 
                                                    ? 'bg-emerald-600 text-white shadow' 
                                                    : 'text-slate-400 hover:text-white'
                                            }`}
                                        >
                                            Litri Venduti (L)
                                        </button>
                                        <button
                                            onClick={() => setMatrixDisplayUnit('units')}
                                            className={`px-3 py-1 rounded-md font-semibold transition-all ${
                                                matrixDisplayUnit === 'units' 
                                                    ? 'bg-emerald-600 text-white shadow' 
                                                    : 'text-slate-400 hover:text-white'
                                            }`}
                                        >
                                            Pezzi / Unità (pz)
                                        </button>
                                    </div>
                                </div>

                                <div className="overflow-x-auto rounded-lg border border-slate-700/80">
                                    <table className="w-full text-xs text-left text-slate-300">
                                        <thead className="text-[11px] uppercase bg-slate-800 text-slate-200 font-extrabold sticky top-0">
                                            <tr>
                                                <th className="px-3 py-2.5 min-w-[140px]">Formato</th>
                                                {['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'].map(m => (
                                                    <th key={m} className="px-2 py-2.5 text-center min-w-[50px]">{m}</th>
                                                ))}
                                                <th className="px-3 py-2.5 text-right font-black text-amber-400 bg-slate-800/90 min-w-[80px]">
                                                    {matrixDisplayUnit === 'liters' ? 'Tot. Litri' : 'Tot. Pezzi'}
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-800 font-mono">
                                            {activeBeerDetail.formats.map((fmt, idx) => {
                                                // Find max month for this format to highlight peak
                                                const monthlyVals = activeBeerDetail.monthlyBreakdown.map((m, mIdx) => {
                                                    if (matrixDisplayUnit === 'liters') {
                                                        return typeof m[fmt.name] === 'number' ? (m[fmt.name] as number) : 0;
                                                    } else {
                                                        const uRow = activeBeerDetail.monthlyUnitsBreakdown[mIdx];
                                                        return typeof uRow[fmt.name] === 'number' ? (uRow[fmt.name] as number) : 0;
                                                    }
                                                });
                                                const maxInRow = Math.max(...monthlyVals, 0);

                                                return (
                                                    <tr key={fmt.name} className="hover:bg-slate-800/40 transition-colors">
                                                        <td className="px-3 py-2 font-bold text-white flex items-center gap-2">
                                                            <span 
                                                                className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                                                                style={{ backgroundColor: getFormatColor(fmt.name, idx) }}
                                                            />
                                                            <span className="truncate">{fmt.name}</span>
                                                        </td>
                                                        {monthlyVals.map((val, mIdx) => {
                                                            const isPeak = val > 0 && val === maxInRow;
                                                            return (
                                                                <td 
                                                                    key={mIdx} 
                                                                    className={`px-2 py-2 text-center text-[11px] ${
                                                                        isPeak 
                                                                            ? 'bg-amber-500/20 text-amber-300 font-extrabold rounded' 
                                                                            : val > 0 ? 'text-slate-200' : 'text-slate-600'
                                                                    }`}
                                                                >
                                                                    {val > 0 
                                                                        ? (matrixDisplayUnit === 'liters' ? round1(val).toFixed(0) : val) 
                                                                        : '-'}
                                                                </td>
                                                            );
                                                        })}
                                                        <td className="px-3 py-2 text-right font-black text-amber-300 bg-slate-800/30">
                                                            {matrixDisplayUnit === 'liters' ? `${round1(fmt.liters).toFixed(1)} L` : `${fmt.units} pz`}
                                                        </td>
                                                    </tr>
                                                );
                                            })}

                                            {/* Totals Row */}
                                            <tr className="bg-slate-800/80 font-bold text-white border-t border-slate-700">
                                                <td className="px-3 py-2.5 uppercase text-amber-400 font-black">
                                                    Totale Mese
                                                </td>
                                                {activeBeerDetail.monthlyBreakdown.map((m, mIdx) => {
                                                    const tot = matrixDisplayUnit === 'liters' ? m.totalLiters : m.totalUnits;
                                                    return (
                                                        <td key={mIdx} className="px-2 py-2.5 text-center text-amber-300 font-extrabold text-[11px]">
                                                            {tot > 0 
                                                                ? (matrixDisplayUnit === 'liters' ? round1(tot).toFixed(0) : tot) 
                                                                : '-'}
                                                        </td>
                                                    );
                                                })}
                                                <td className="px-3 py-2.5 text-right font-black text-amber-300">
                                                    {matrixDisplayUnit === 'liters' ? `${formatL(activeBeerDetail.totalLiters)}` : `${activeBeerDetail.totalUnits} pz`}
                                                </td>
                                            </tr>
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Secondary Row: Top Clients and Top Formats */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {/* Top Clients (shown when viewing General Analysis) */}
                        {!selectedClientId && (
                            <div className="bg-brew-dark-secondary p-5 rounded-xl border border-slate-700 shadow-xl space-y-4">
                                <div>
                                    <h2 className="text-xl font-bold text-white flex items-center gap-2">
                                        <span className="w-2.5 h-2.5 rounded-full bg-sky-500 inline-block"></span>
                                        {t('salesTrend.topClientsByLiters')}
                                    </h2>
                                    <p className="text-xs text-slate-400 mt-0.5">I 10 principali clienti per volume acquistato</p>
                                </div>
                                <div className="h-80">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart 
                                            data={analysisData.topClients.slice(0, 10)} 
                                            layout="vertical" 
                                            margin={{ top: 10, right: 50, left: 10, bottom: 5 }}
                                        >
                                            <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.6} horizontal={false} />
                                            <XAxis 
                                                type="number" 
                                                stroke="#94a3b8" 
                                                tick={{ fill: '#94a3b8', fontSize: 11 }}
                                                tickFormatter={(v: number) => `${round1(v)} L`}
                                            />
                                            <YAxis 
                                                dataKey="name" 
                                                type="category" 
                                                width={130} 
                                                stroke="#94a3b8"
                                                tick={{ fill: '#cbd5e1', fontSize: 11 }}
                                            />
                                            <Tooltip 
                                                formatter={(value: number) => [`${round1(value).toFixed(1)} L`, t('salesTrend.litersPurchased')]}
                                                labelFormatter={(label: string) => `Cliente: ${label}`}
                                                contentStyle={{ 
                                                    backgroundColor: '#0f172a', 
                                                    borderColor: '#334155', 
                                                    borderRadius: '8px', 
                                                    color: '#f8fafc' 
                                                }}
                                            />
                                            <Bar 
                                                dataKey="liters" 
                                                name={t('salesTrend.litersPurchased')} 
                                                fill="#0284c7" 
                                                radius={[0, 6, 6, 0]}
                                            >
                                                <LabelList 
                                                    dataKey="liters" 
                                                    position="right" 
                                                    formatter={(val: number) => `${round1(val).toFixed(1)} L`}
                                                    fill="#f8fafc"
                                                    fontSize={10}
                                                    fontWeight={600}
                                                    offset={8}
                                                />
                                            </Bar>
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>
                        )}

                        {/* Top Formats */}
                        <div className={`bg-brew-dark-secondary p-5 rounded-xl border border-slate-700 shadow-xl space-y-4 ${selectedClientId ? 'lg:col-span-2' : ''}`}>
                            <div>
                                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                                    <span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block"></span>
                                    {t('salesTrend.topFormatsByLiters')}
                                </h2>
                                <p className="text-xs text-slate-400 mt-0.5">Ripartizione volumi complessivi per tipologia di confezionamento</p>
                            </div>
                            <div className="h-80">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart 
                                        data={analysisData.topFormats} 
                                        margin={{ top: 25, right: 30, left: 10, bottom: 45 }}
                                    >
                                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.6} vertical={false} />
                                        <XAxis 
                                            dataKey="name" 
                                            stroke="#94a3b8" 
                                            tick={{ fill: '#cbd5e1', fontSize: 11 }}
                                            interval={0}
                                            angle={-25}
                                            textAnchor="end"
                                            height={45}
                                        />
                                        <YAxis 
                                            stroke="#94a3b8" 
                                            tick={{ fill: '#94a3b8', fontSize: 11 }}
                                            tickFormatter={(v: number) => `${round1(v)} L`}
                                        />
                                        <Tooltip 
                                            formatter={(value: number) => [`${round1(value).toFixed(1)} L`, t('salesTrend.litersSold')]}
                                            labelFormatter={(label: string) => `Formato: ${label}`}
                                            contentStyle={{ 
                                                backgroundColor: '#0f172a', 
                                                borderColor: '#334155', 
                                                borderRadius: '8px', 
                                                color: '#f8fafc' 
                                            }}
                                        />
                                        <Bar 
                                            dataKey="liters" 
                                            name={t('salesTrend.litersSold')} 
                                            fill="#d97706" 
                                            radius={[6, 6, 0, 0]}
                                            maxBarSize={55}
                                        >
                                            {analysisData.topFormats.map((entry, index) => (
                                                <Cell key={`fmt-cell-${index}`} fill={getFormatColor(entry.name, index)} />
                                            ))}
                                            <LabelList 
                                                dataKey="liters" 
                                                position="top" 
                                                formatter={(val: number) => `${round1(val).toFixed(1)} L`}
                                                fill="#f8fafc"
                                                fontSize={10}
                                                fontWeight={600}
                                                offset={8}
                                            />
                                        </Bar>
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </div>
                    </div>

                    {/* Slow Moving Items (Unsold > 90 days) */}
                    {analysisData.slowMovingItems.length > 0 && (
                        <div className="bg-red-950/40 border border-red-700/60 p-5 rounded-xl shadow-xl space-y-3">
                            <div className="flex items-center justify-between">
                                <h2 className="text-lg font-bold text-red-300 flex items-center gap-2">
                                    <span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block animate-pulse"></span>
                                    Articoli a Lenta Movimentazione (Invenduti da oltre 90 giorni)
                                </h2>
                                <span className="text-xs bg-red-900/60 text-red-200 px-2.5 py-1 rounded-full font-bold">
                                    {analysisData.slowMovingItems.length} lotti fermi
                                </span>
                            </div>
                            <div className="overflow-x-auto max-h-64 rounded-lg border border-red-800/40">
                                <table className="w-full text-sm text-left text-red-200">
                                    <thead className="text-xs uppercase bg-red-900/60 text-red-300 sticky top-0">
                                        <tr>
                                            <th className="px-4 py-2.5">Birra</th>
                                            <th className="px-4 py-2.5">Formato</th>
                                            <th className="px-4 py-2.5">Lotto</th>
                                            <th className="px-4 py-2.5 text-right">Giacenza</th>
                                            <th className="px-4 py-2.5 text-center">Ultima Vendita</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-red-800/30">
                                        {analysisData.slowMovingItems.map((item, index) => (
                                            <tr key={index} className="hover:bg-red-900/20 transition-colors">
                                                <td className="px-4 py-2.5 font-semibold text-white">{item.nomeBirra}</td>
                                                <td className="px-4 py-2.5">{item.formato}</td>
                                                <td className="px-4 py-2.5 font-mono text-xs">{item.lotto}</td>
                                                <td className="px-4 py-2.5 text-right font-bold text-amber-300">{item.quantita}</td>
                                                <td className="px-4 py-2.5 text-center text-xs">
                                                    {item.lastSaleDate ? item.lastSaleDate.toLocaleDateString('it-IT') : <span className="text-red-400 font-semibold">MAI VENDUTO</span>}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};