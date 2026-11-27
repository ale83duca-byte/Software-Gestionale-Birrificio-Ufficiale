import { CONFIG_PACKAGING } from '../constants';
import type {
    BeerLotStatusOverride,
    BeerPriceList,
    BreweryData,
    BrewHeader,
    ClientOffer,
} from '../types';

export const getUnitLitersFromFormat = (format: string): number => {
    if (!format) return 1;
    if (CONFIG_PACKAGING[format]) return CONFIG_PACKAGING[format].litriUnit;
    const upper = format.toUpperCase().trim();
    if (upper.includes('30')) return 30;
    if (upper.includes('24')) return 24;
    if (upper.includes('20')) return 20;
    if (upper.includes('75')) return 0.75;
    if (upper.includes('50')) return 0.5;
    if (upper.includes('33')) return 0.33;
    if (upper.includes('5L') || upper.includes('5 LT') || upper.includes('5 L')) return 5;
    return 1;
};

/**
 * Restituisce tutte le chiavi formato equivalenti tra i formati di confezionamento (CONFIG_PACKAGING)
 * e le chiavi del listino prezzi base (PRICE_LIST_FORMATS).
 */
export const getFormatCandidateKeys = (format: string): string[] => {
    const raw = (format || '').trim();
    const upper = raw.toUpperCase();
    const candidates: string[] = [];

    if (raw) candidates.push(raw);
    if (upper && upper !== raw) candidates.push(upper);

    if (upper.includes('33')) {
        candidates.push('BOTT. 33CL', 'BOTTIGLIA 33CL');
    } else if (upper.includes('50')) {
        candidates.push('BOTT. 50CL', 'BOTTIGLIA 50CL');
    } else if (upper.includes('75')) {
        candidates.push('BOTT. 75CL', 'BOTTIGLIA 75CL');
    } else if (upper.includes('ACCIAIO') && upper.includes('20')) {
        candidates.push('FUSTO ACCIAIO 20L', 'ACCIAIO 20 LT', 'FUSTO 20 LT');
    } else if (upper.includes('ACCIAIO') && upper.includes('24')) {
        candidates.push('FUSTO ACCIAIO 24L', 'ACCIAIO 24 LT', 'FUSTO 24 LT');
    } else if (upper.includes('ACCIAIO') && upper.includes('30')) {
        candidates.push('FUSTO ACCIAIO 30L', 'ACCIAIO 30 LT', 'FUSTO 30 LT');
    } else if (upper.includes('20L') || upper.includes('20 LT') || upper.includes('20 L')) {
        candidates.push('KEYKEG 20L', 'FUSTO POLYKEG 20LT', 'FUSTO POLYKEG 20LT CON SACCA', 'FUSTO 20 LT', 'ACCIAIO 20 LT');
    } else if (upper.includes('24L') || upper.includes('24 LT') || upper.includes('24 L')) {
        candidates.push('FUSTO POLYKEG 24LT', 'FUSTO POLYKEG 24LT CON SACCA', 'FUSTO 24 LT', 'ACCIAIO 24 LT');
    } else if (upper.includes('30L') || upper.includes('30 LT') || upper.includes('30 L')) {
        candidates.push('KEYKEG 30L', 'FUSTO 30 LT', 'ACCIAIO 30 LT');
    } else if (upper.includes('5 LT') || upper.includes('5L')) {
        candidates.push('FUSTO 5 LT');
    }

    return Array.from(new Set(candidates));
};

export const lookupPriceInMap = (
    priceMap: Record<string, number> | undefined,
    format: string
): number | null => {
    if (!priceMap) return null;
    const candidates = getFormatCandidateKeys(format);
    for (const cand of candidates) {
        const val = priceMap[cand];
        if (typeof val === 'number' && val > 0) return val;
    }
    const entries = Object.entries(priceMap);
    const upperCandidates = new Set(candidates.map(c => c.toUpperCase()));
    for (const [k, val] of entries) {
        if (upperCandidates.has(k.trim().toUpperCase()) && typeof val === 'number' && val > 0) {
            return val;
        }
    }
    return null;
};

/**
 * Ricava il prezzo base consigliato dal Listino Prezzi Birre Finite (o da un'offerta cliente se fornita).
 */
export const getRecommendedListPrice = (params: {
    beerName: string;
    format: string;
    beerPriceList?: BeerPriceList[];
    clientOffer?: ClientOffer | null;
}): { price: number; source: 'CLIENT_OFFER' | 'BEER_PRICE_LIST' | 'NONE' } => {
    const { beerName, format, beerPriceList = [], clientOffer } = params;
    const normBeer = (beerName || '').trim().toUpperCase();

    if (clientOffer?.prices) {
        const beerKey = Object.keys(clientOffer.prices).find(
            k => k.trim().toUpperCase() === normBeer
        );
        if (beerKey) {
            const p = lookupPriceInMap(clientOffer.prices[beerKey], format);
            if (p !== null && p > 0) {
                return { price: p, source: 'CLIENT_OFFER' };
            }
        }
    }

    const priceItem = beerPriceList.find(
        p => (p.beerName || '').trim().toUpperCase() === normBeer
    );
    if (priceItem) {
        const p = lookupPriceInMap(priceItem.prices, format);
        if (p !== null && p > 0) {
            return { price: p, source: 'BEER_PRICE_LIST' };
        }
    }

    return { price: 0, source: 'NONE' };
};

export type ResolvedPriceSource =
    | 'PROMO_TMC'
    | 'LOT_CUSTOM'
    | 'CLIENT_OFFER'
    | 'BEER_PRICE_LIST'
    | 'NONE';

export interface ResolvedSellingPrice {
    unitPrice: number;
    source: ResolvedPriceSource;
    listPrice: number;
}

/**
 * Risolve il prezzo unitario di vendita/mercato (€/pz) effettivo per una birra + lotto + formato.
 * Priorità:
 * 1) Promo TMC attiva su BEER_LOT_OVERRIDES
 * 2) Prezzo di vendita personalizzato salvato sul lotto in Analisi Costi (COTTE_HEAD.lotSellingPrices)
 * 3) Offerta personalizzata cliente (CLIENT_OFFERS)
 * 4) Listino Prezzi Base Birre Finite (BEER_PRICE_LIST)
 */
export const resolveEffectiveSellingPrice = (params: {
    data: Partial<BreweryData> | null | undefined;
    cliente?: string;
    beerName: string;
    lotto?: string;
    format: string;
    clientOffer?: ClientOffer | null;
}): ResolvedSellingPrice => {
    const { data, cliente = '', beerName, lotto = '', format, clientOffer } = params;
    const priceList = data?.BEER_PRICE_LIST || [];
    const listLookup = getRecommendedListPrice({
        beerName,
        format,
        beerPriceList: priceList,
        clientOffer,
    });

    // 1. Promo TMC override
    if (cliente && lotto) {
        const overrideKey = `${cliente}|${beerName}|${lotto}|${format}`;
        const ov: BeerLotStatusOverride | undefined = (data?.BEER_LOT_OVERRIDES || []).find(
            o => o.key === overrideKey
        );
        if (ov && ov.status === 'PROMO_TMC' && typeof ov.promoPrice === 'number' && ov.promoPrice > 0) {
            return {
                unitPrice: ov.promoPrice,
                source: 'PROMO_TMC',
                listPrice: listLookup.price,
            };
        }
    }

    // 2. Lot-specific custom selling price set in CostAnalysisView
    if (lotto) {
        const normLotto = lotto.trim().toUpperCase();
        const header: BrewHeader | undefined = (data?.COTTE_HEAD || []).find(
            c => (c.LOTTO || '').trim().toUpperCase() === normLotto
        );
        const lotCustom = lookupPriceInMap(header?.lotSellingPrices, format);
        if (lotCustom !== null && lotCustom > 0) {
            return {
                unitPrice: lotCustom,
                source: 'LOT_CUSTOM',
                listPrice: listLookup.price,
            };
        }
    }

    // 3 & 4. Client offer or Base Price List
    if (listLookup.price > 0) {
        return {
            unitPrice: listLookup.price,
            source: listLookup.source,
            listPrice: listLookup.price,
        };
    }

    return {
        unitPrice: 0,
        source: 'NONE',
        listPrice: 0,
    };
};
