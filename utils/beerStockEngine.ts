import type {
    BreweryData,
    BeerStockItem,
    BeerStorageLocation,
    BeerWasteReason,
    BeerMovement,
} from '../types';
import { CONFIG_PACKAGING } from '../constants';

export const getUnitLiters = (formato: string): number => {
    if (!formato) return 0;
    if (CONFIG_PACKAGING[formato]) return CONFIG_PACKAGING[formato].litriUnit;
    const upper = formato.toUpperCase().trim();
    if (upper.includes('30L') || upper.includes('30 L') || upper.includes('30 LT')) return 30;
    if (upper.includes('24L') || upper.includes('24 L') || upper.includes('24 LT')) return 24;
    if (upper.includes('20L') || upper.includes('20 L') || upper.includes('20 LT')) return 20;
    if (upper.includes('75CL') || upper.includes('75 CL')) return 0.75;
    if (upper.includes('50CL') || upper.includes('50 CL')) return 0.5;
    if (upper.includes('33CL') || upper.includes('33 CL')) return 0.33;
    if (upper.includes('5L') || upper.includes('5 LT')) return 5;
    return 1;
};

export const parseItDateSafe = (dateStr: string | undefined): Date | null => {
    if (!dateStr) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        const d = new Date(dateStr);
        return isNaN(d.getTime()) ? null : d;
    }
    const parts = dateStr.split('/');
    if (parts.length === 3) {
        const [day, month, year] = parts.map(Number);
        if (!isNaN(day) && !isNaN(month) && !isNaN(year)) {
            return new Date(year, month - 1, day);
        }
    }
    return null;
};

export interface DualBeerStockResult {
    breweryCellarStock: BeerStockItem[]; // Polo 1: Cella Birrificio (Rifermentazione / Sosta)
    centralSalesStock: BeerStockItem[];  // Polo 2: Magazzino Centrale (Pronto Vendita)
    allPositiveStock: BeerStockItem[];   // Tutti gli item positivi con .location valorizzato
}

/**
 * Motore unificato di calcolo giacenza birra confezionata sui due poli logistici:
 * - CELLA_BIRRIFICIO (Rifermentazione / sosta tecnica in birrificio post-confezionamento)
 * - MAGAZZINO_CENTRALE (Deposito centrale pronto alla vendita)
 * Retrocompatibile al 100%: i record storici privi di `location`/`initialLocation`
 * confluiscono in `MAGAZZINO_CENTRALE`.
 */
export const computeDualLocationBeerStock = (data: BreweryData): DualBeerStockResult => {
    const stockMap = new Map<string, BeerStockItem>();
    const lottoInfo = new Map<string, { clientName: string; beerName: string }>();
    const lottoExpiry = new Map<string, string>();

    (data.COTTE_HEAD || []).forEach(c => {
        lottoInfo.set(c.LOTTO, { clientName: c.CLIENTE, beerName: c.NOME_BIRRA });
    });

    const addEntry = (
        location: BeerStorageLocation,
        cliente: string,
        nomeBirra: string,
        lotto: string,
        formato: string,
        quantita: number,
        dataScadenza: string,
        dataProntaTrasferimento?: string,
        dataConfezionamento?: string
    ) => {
        const key = `${location}|${cliente}|${nomeBirra}|${lotto}|${formato}`;
        const existing = stockMap.get(key);
        if (existing) {
            existing.quantita += quantita;
            if ((!existing.dataScadenza || existing.dataScadenza === 'N/A') && dataScadenza && dataScadenza !== 'N/A') {
                existing.dataScadenza = dataScadenza;
            }
            if (!existing.dataProntaTrasferimento && dataProntaTrasferimento) {
                existing.dataProntaTrasferimento = dataProntaTrasferimento;
            }
            if (!existing.dataConfezionamento && dataConfezionamento) {
                existing.dataConfezionamento = dataConfezionamento;
            }
        } else {
            stockMap.set(key, {
                location,
                cliente,
                nomeBirra,
                lotto,
                formato,
                quantita,
                dataScadenza: dataScadenza || lottoExpiry.get(`${lotto}|${formato}`) || '',
                dataProntaTrasferimento,
                dataConfezionamento,
            });
        }
    };

    // 1. Giacenze iniziali anno
    (data.BEER_WAREHOUSE_INITIAL || []).forEach(item => {
        const loc: BeerStorageLocation = item.location || 'MAGAZZINO_CENTRALE';
        if (item.dataScadenza) lottoExpiry.set(`${item.lotto}|${item.formato}`, item.dataScadenza);
        addEntry(loc, item.cliente, item.nomeBirra, item.lotto, item.formato, item.quantita, item.dataScadenza);
    });

    // 2. Confezionamenti dell'anno
    (data.CONFEZIONAMENTO || []).forEach(pkg => {
        if (pkg.DATA_SCADENZA) lottoExpiry.set(`${pkg.LOTTO_PROD}|${pkg.FORMATO}`, pkg.DATA_SCADENZA);
        const info = lottoInfo.get(pkg.LOTTO_PROD);
        if (info) {
            const loc: BeerStorageLocation = pkg.initialLocation || 'MAGAZZINO_CENTRALE';
            addEntry(
                loc,
                info.clientName,
                info.beerName,
                pkg.LOTTO_PROD,
                pkg.FORMATO,
                pkg.QTA_UNITA,
                pkg.DATA_SCADENZA,
                pkg.dataProntaTrasferimento,
                pkg.DATA
            );
        }
    });

    // 3. Tutti i movimenti (vendite, trasferimenti interni birrificio->centrale, scarti, resi fiere, beerfirm)
    (data.BEER_MOVEMENTS || []).forEach(mov => {
        let loc: BeerStorageLocation = mov.location || 'MAGAZZINO_CENTRALE';
        if (mov.type === 'BREWERY_TO_CENTRAL_OUT') loc = 'CELLA_BIRRIFICIO';
        if (mov.type === 'BREWERY_TO_CENTRAL_IN') loc = 'MAGAZZINO_CENTRALE';

        addEntry(
            loc,
            mov.cliente,
            mov.nomeBirra,
            mov.lotto,
            mov.formato,
            mov.quantita,
            lottoExpiry.get(`${mov.lotto}|${mov.formato}`) || ''
        );
    });

    const sortStock = (arr: BeerStockItem[]) =>
        arr.sort(
            (a, b) =>
                a.cliente.localeCompare(b.cliente) ||
                a.nomeBirra.localeCompare(b.nomeBirra) ||
                (parseItDateSafe(a.dataScadenza)?.getTime() || 0) -
                    (parseItDateSafe(b.dataScadenza)?.getTime() || 0)
        );

    const allPositiveStock = sortStock(
        Array.from(stockMap.values()).filter(item => item.quantita > 0.001)
    );

    return {
        breweryCellarStock: allPositiveStock.filter(i => i.location === 'CELLA_BIRRIFICIO'),
        centralSalesStock: allPositiveStock.filter(i => i.location === 'MAGAZZINO_CENTRALE'),
        allPositiveStock,
    };
};

export interface SalesAndWasteMetrics {
    netSalesMovements: BeerMovement[]; // Movimenti di vendita reali (escluse riallocazioni interne conto deposito BeerFirm)
    consignmentReturnMovements: BeerMovement[]; // Resi da conto vendita / fiere
    wasteMovements: BeerMovement[]; // Scarti / scaduti / contestazioni
    grossSoldLiters: number;
    returnedConsignmentLiters: number;
    netSoldLiters: number;
    totalWastedLiters: number;
    wasteByReasonLiters: Record<BeerWasteReason, number>;
}

/**
 * Calcola i volumi di vendita reali deduplicati (senza doppio conteggio BeerFirm e al netto dei resi da fiere/conto vendita)
 * e separa rigorosamente i litri scartati/scaduti/contestati in un monte dedicato.
 */
export const computeCleanSalesAndWaste = (
    data: BreweryData,
    filterClientName?: string
): SalesAndWasteMetrics => {
    const allMovements = data.BEER_MOVEMENTS || [];

    // Identifica gli ordini BeerFirm che hanno caricato lo stock in conto deposito presso il birrificio (coppia con PURCHASE)
    const internalConsignmentOrderIds = new Set<string>(
        allMovements
            .filter(m => m.type === 'PURCHASE' && m.relatedDocId)
            .map(m => m.relatedDocId as string)
    );

    const matchesClient = (m: BeerMovement) =>
        !filterClientName || m.cliente.trim().toUpperCase() === filterClientName.trim().toUpperCase();

    const netSalesMovements = allMovements.filter(m => {
        if (!matchesClient(m)) return false;
        // Escludi sempre trasferimenti tra celle, trasferimenti proprietà conto deposito, scarti e resi
        if (
            m.type === 'INTERNAL_TRANSFER_OUT' ||
            m.type === 'BREWERY_TO_CENTRAL_OUT' ||
            m.type === 'BREWERY_TO_CENTRAL_IN' ||
            m.type === 'WASTE' ||
            m.type === 'RETURN_CONSIGNMENT' ||
            m.type === 'PURCHASE'
        ) {
            return false;
        }
        // In vista generale (tutti i clienti), escludi i vecchi movimenti SALE associati a un PURCHASE BeerFirm (evita il doppio conteggio)
        if (!filterClientName && m.relatedDocId && internalConsignmentOrderIds.has(m.relatedDocId)) {
            return false;
        }
        return m.type === 'SALE' || (m.type === 'ADJUSTMENT' && m.quantita < 0);
    });

    const consignmentReturnMovements = allMovements.filter(
        m => matchesClient(m) && m.type === 'RETURN_CONSIGNMENT' && m.quantita > 0
    );

    const wasteMovements = allMovements.filter(
        m => matchesClient(m) && m.type === 'WASTE' && m.quantita < 0
    );

    const grossSoldLiters = netSalesMovements.reduce(
        (s, m) => s + Math.abs(m.quantita) * getUnitLiters(m.formato),
        0
    );
    const returnedConsignmentLiters = consignmentReturnMovements.reduce(
        (s, m) => s + Math.abs(m.quantita) * getUnitLiters(m.formato),
        0
    );
    const netSoldLiters = Math.max(0, grossSoldLiters - returnedConsignmentLiters);

    const wasteByReasonLiters: Record<BeerWasteReason, number> = {
        SCADENZA_TMC: 0,
        OSSIDAZIONE_DIFETTO: 0,
        CONTESTAZIONE_CLIENTE: 0,
        ROTTURA_PERDITA: 0,
        CAMPIONATURA_ANALISI: 0,
    };

    let totalWastedLiters = 0;
    wasteMovements.forEach(m => {
        const l = Math.abs(m.quantita) * getUnitLiters(m.formato);
        totalWastedLiters += l;
        const reason: BeerWasteReason = m.wasteReason || 'OSSIDAZIONE_DIFETTO';
        wasteByReasonLiters[reason] = (wasteByReasonLiters[reason] || 0) + l;
    });

    return {
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
