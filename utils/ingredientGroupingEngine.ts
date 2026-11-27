import type { BreweryData, Movement, PriceDBItem } from '../types';

export const RAW_INGREDIENT_CATEGORIES = ['MALTI', 'LUPPOLI', 'LIEVITI', 'ADDITIVI', 'SANIFICANTI'] as const;
export type RawIngredientCategory = (typeof RAW_INGREDIENT_CATEGORIES)[number];

const CATEGORY_ALIAS_MAP: Record<string, RawIngredientCategory> = {
    MALTI: 'MALTI',
    MALTO: 'MALTI',
    LUPPOLI: 'LUPPOLI',
    LUPPOLO: 'LUPPOLI',
    LIEVITI: 'LIEVITI',
    LIEVITO: 'LIEVITI',
    ADDITIVI: 'ADDITIVI',
    ADDITIVO: 'ADDITIVI',
    ZUCCHERO: 'ADDITIVI',
    SPEZIE: 'ADDITIVI',
    SANIFICANTI: 'SANIFICANTI',
    SANIFICANTE: 'SANIFICANTI',
};

const NOISE_WORDS = new Set([
    'PELLET', 'PELLETS', 'T90', 'T45', 'CRYO', 'LUPOMAX',
    'CONI', 'CONO', 'FOGLIE', 'FOGLIA', 'FIORI', 'FIORE',
    'GRANI', 'MACINATO', 'MACINATI', 'FIOCCHI', 'FLAKES',
    'SECCO', 'LIQUIDO', 'CREMA', 'BUSTINA', 'BUSTA', 'BUSTINE',
    'SACCO', 'SACCHI', 'TANICA', 'FUSTINO', 'FLACONE',
    'POLVERE', 'CRISTALLI', 'GRANULARE', 'SCAGLIE',
    'PURO', 'PURA', 'BIO', 'BIOLOGICO', 'BIOLOGICA',
    'ESTRATTO', 'SOLUZIONE', 'ALIMENTARE',
    'IN', 'DI', 'DA', 'PER', 'CON', 'AL', 'ALLA',
    'USA', 'US', 'UK', 'DE', 'CZ', 'SI', 'NZ', 'AU', 'IT', 'BE', 'FR',
    'CECA', 'GERMANIA', 'BELGIO', 'INGHILTERRA', 'ITALIA',
]);

const CATEGORY_SPECIFIC_NOISE: Record<RawIngredientCategory, Set<string>> = {
    MALTI: new Set(['MALTO', 'MALTI', 'MALT']),
    LUPPOLI: new Set(['LUPPOLO', 'LUPPOLI', 'HOP', 'HOPS']),
    LIEVITI: new Set(['LIEVITO', 'LIEVITI', 'YEAST']),
    ADDITIVI: new Set(['ADDITIVO', 'ADDITIVI']),
    SANIFICANTI: new Set(['SANIFICANTE', 'SANIFICANTI']),
};

export const normalizeIngredientCategory = (rawCat: string | undefined): RawIngredientCategory | null => {
    const clean = (rawCat || '').toUpperCase().trim();
    return CATEGORY_ALIAS_MAP[clean] || null;
};

/**
 * Normalizza il nome di un ingrediente per estrarre le parole chiave essenziali
 * (es. "SAAZ PELLET" -> "SAAZ", "SAAZ T-90" -> "SAAZ", "MALTO PILSNER 25KG" -> "PILSNER").
 */
export const extractIngredientKeywordSignature = (
    rawName: string,
    category: RawIngredientCategory
): { signature: string; tokens: string[] } => {
    let text = (rawName || '').toUpperCase().trim();
    // Rimuove note tra parentesi o quadre
    text = text.replace(/\([^)]*\)/g, ' ').replace(/\[[^\]]*\]/g, ' ');
    // Rimuove pesi e formati numerici (es. 25KG, 500G, 5L, 11.5G, 2024)
    text = text.replace(/\b\d+([.,]\d+)?\s*(KG|G|GR|L|LT|ML|CL|OZ|LB)\b/g, ' ');
    // Rimuove codici pellettizzazione T-90 / T-45 prima della separazione trattini
    text = text.replace(/\bT[-\s]?90\b/g, ' ').replace(/\bT[-\s]?45\b/g, ' ');
    // Rimuove percentuali alfa acidi es. "4.5% AA"
    text = text.replace(/\b\d+([.,]\d+)?\s*%(\s*(AA|ALFA|AB))?\b/g, ' ');
    // Rimuove anni raccolto (es. 2023, 2024, 2025)
    text = text.replace(/\b20[1-3]\d\b/g, ' ');
    // Uniforma separatori in spazi (mantiene composti tipo US-05 / W-34 solo come token puliti)
    const rawTokens = text
        .replace(/[/_,.;:+]+/g, ' ')
        .replace(/-/g, ' ')
        .split(/\s+/)
        .map(t => t.trim())
        .filter(Boolean);

    const catNoise = CATEGORY_SPECIFIC_NOISE[category];
    const cleanTokens = rawTokens.filter(tok => {
        if (NOISE_WORDS.has(tok)) return false;
        if (catNoise.has(tok)) return false;
        return true;
    });

    const finalTokens = cleanTokens.length > 0 ? cleanTokens : rawTokens;
    const signature = finalTokens.join(' ');
    return { signature, tokens: finalTokens };
};

export interface IngredientLotUsageDetail {
    lotto: string;
    birra: string;
    data: string;
    qty: number;
    isClosed: boolean;
    marca: string;
    fornitore: string;
    cost: number;
}

export interface RawConsumedIngredientSummary {
    key: string; // `${tipologia}|${nome}`
    tipologia: RawIngredientCategory;
    nome: string;
    totalQty: number;
    estimatedCost: number;
    lottiCount: number;
    openLotsCount: number;
    closedLotsCount: number;
    lotsDetail: IngredientLotUsageDetail[];
    signature: string;
    tokens: string[];
}

export interface ConfirmedIngredientMergeGroup {
    id: string;
    tipologia: RawIngredientCategory;
    targetName: string;
    members: string[]; // lista di `nome` (uppercase) inclusi nel gruppo
}

export interface IngredientMergePreferences {
    confirmedGroups: ConfirmedIngredientMergeGroup[];
    rejectedPairKeys: string[]; // chiavi `${tipologia}|${nameA}::${nameB}` ordinate alfabeticamente
}

export interface CandidateMergeSuggestion {
    suggestionId: string;
    tipologia: RawIngredientCategory;
    suggestedTargetName: string;
    reason: string;
    items: RawConsumedIngredientSummary[];
    combinedQty: number;
    combinedCost: number;
    existingGroupId?: string;
    existingGroupMembers?: string[];
}

export interface MergedConsumedIngredientRow {
    rowKey: string;
    tipologia: RawIngredientCategory;
    displayName: string;
    totalQty: number;
    estimatedCost: number;
    lottiCount: number;
    openLotsCount: number;
    closedLotsCount: number;
    isMerged: boolean;
    mergeGroupId?: string;
    constituents: RawConsumedIngredientSummary[];
    lotsDetail: IngredientLotUsageDetail[];
}

const STORAGE_KEY = 'brewpanda_ingredient_merge_rules_v1';

export const loadIngredientMergePreferences = (): IngredientMergePreferences => {
    if (typeof window === 'undefined') {
        return { confirmedGroups: [], rejectedPairKeys: [] };
    }
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return { confirmedGroups: [], rejectedPairKeys: [] };
        const parsed = JSON.parse(raw);
        return {
            confirmedGroups: Array.isArray(parsed?.confirmedGroups) ? parsed.confirmedGroups : [],
            rejectedPairKeys: Array.isArray(parsed?.rejectedPairKeys) ? parsed.rejectedPairKeys : [],
        };
    } catch {
        return { confirmedGroups: [], rejectedPairKeys: [] };
    }
};

export const saveIngredientMergePreferences = (prefs: IngredientMergePreferences): void => {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    } catch {
        // Ignora errori storage restrittivi
    }
};

export const makeRejectedPairKey = (tipologia: RawIngredientCategory, nameA: string, nameB: string): string => {
    const [a, b] = [nameA.toUpperCase().trim(), nameB.toUpperCase().trim()].sort();
    return `${tipologia}|${a}::${b}`;
};

const resolveUnitPrice = (m: Movement, priceDb: PriceDBItem[]): number => {
    const n = (m.NOME || '').toUpperCase().trim();
    const ma = (m.MARCA || '').toUpperCase().trim();
    const fo = (m.FORNITORE || '').toUpperCase().trim();
    const exact = priceDb.find(
        p =>
            p.NOME.toUpperCase().trim() === n &&
            (p.MARCA || '').toUpperCase().trim() === ma &&
            (p.FORNITORE || '').toUpperCase().trim() === fo
    );
    if (exact && exact.PREZZO > 0) return exact.PREZZO;
    const byName = priceDb.find(p => p.NOME.toUpperCase().trim() === n && p.PREZZO > 0);
    return byName ? byName.PREZZO : 0;
};

/**
 * Aggrega tutti gli ingredienti consumati dai fogli cotta (sia lotti aperti che chiusi) nell'archivio anno.
 */
export const computeAnnualConsumedIngredients = (
    data: BreweryData | null | undefined
): RawConsumedIngredientSummary[] => {
    if (!data) return [];

    const cotteByLotto = new Map<string, { birra: string; isClosed: boolean }>();
    (data.COTTE_HEAD || []).forEach(c => {
        const key = (c.LOTTO || '').toUpperCase().trim();
        if (!key) return;
        const isClosed = Boolean(c.isCellarClosed || !c.FERMENTATORE || c.isCostAnalysisClosed);
        cotteByLotto.set(key, {
            birra: c.NOME_BIRRA || 'Cotta',
            isClosed,
        });
    });

    const priceDb = data.PRICE_DATABASE || [];
    const byIngredientMap = new Map<
        string,
        {
            tipologia: RawIngredientCategory;
            nome: string;
            totalQty: number;
            estimatedCost: number;
            lotSet: Set<string>;
            openLotSet: Set<string>;
            closedLotSet: Set<string>;
            lotsDetail: IngredientLotUsageDetail[];
        }
    >();

    (data.MOVIMENTAZIONE || []).forEach(m => {
        if (m.KG_LITRI_PZ >= 0) return;
        const cat = normalizeIngredientCategory(m.TIPOLOGIA);
        if (!cat) return;

        const lottoProd = (m.LOTTO_PRODUZIONE || '').toUpperCase().trim();
        const isBrewInvoice = (m.N_FATTURA || '').toUpperCase().startsWith('SCARICO_COTTA_');
        // Considera scarichi provenienti da fogli cotta (con lotto produzione o fattura SCARICO_COTTA_)
        if (!lottoProd && !isBrewInvoice) return;

        const rawName = (m.NOME || '').toUpperCase().trim();
        if (!rawName) return;

        const qty = Math.abs(m.KG_LITRI_PZ);
        if (qty <= 0) return;

        const unitPrice = resolveUnitPrice(m, priceDb);
        const cost = qty * unitPrice;

        const lotMeta = cotteByLotto.get(lottoProd);
        const isClosed = lotMeta ? lotMeta.isClosed : false;
        const birra = lotMeta ? lotMeta.birra : 'Cotta';

        const key = `${cat}|${rawName}`;
        let entry = byIngredientMap.get(key);
        if (!entry) {
            entry = {
                tipologia: cat,
                nome: rawName,
                totalQty: 0,
                estimatedCost: 0,
                lotSet: new Set<string>(),
                openLotSet: new Set<string>(),
                closedLotSet: new Set<string>(),
                lotsDetail: [],
            };
            byIngredientMap.set(key, entry);
        }

        entry.totalQty += qty;
        entry.estimatedCost += cost;
        if (lottoProd) {
            entry.lotSet.add(lottoProd);
            if (isClosed) entry.closedLotSet.add(lottoProd);
            else entry.openLotSet.add(lottoProd);
        }
        entry.lotsDetail.push({
            lotto: lottoProd || m.N_FATTURA.replace(/^SCARICO_COTTA_/i, ''),
            birra,
            data: m.DATA,
            qty,
            isClosed,
            marca: (m.MARCA || '').trim(),
            fornitore: (m.FORNITORE || '').trim(),
            cost,
        });
    });

    return Array.from(byIngredientMap.entries())
        .map(([key, val]) => {
            const { signature, tokens } = extractIngredientKeywordSignature(val.nome, val.tipologia);
            return {
                key,
                tipologia: val.tipologia,
                nome: val.nome,
                totalQty: Math.round((val.totalQty + Number.EPSILON) * 1000) / 1000,
                estimatedCost: Math.round((val.estimatedCost + Number.EPSILON) * 100) / 100,
                lottiCount: val.lotSet.size || val.lotsDetail.length,
                openLotsCount: val.openLotSet.size,
                closedLotsCount: val.closedLotSet.size,
                lotsDetail: val.lotsDetail,
                signature,
                tokens,
            };
        })
        .sort((a, b) => a.tipologia.localeCompare(b.tipologia) || b.totalQty - a.totalQty);
};

const areItemsSimilarCandidates = (
    a: RawConsumedIngredientSummary,
    b: RawConsumedIngredientSummary
): { similar: boolean; reason: string } => {
    if (a.tipologia !== b.tipologia) return { similar: false, reason: '' };
    if (a.nome === b.nome) return { similar: false, reason: '' };

    // 1. Corrispondenza esatta della radice parole chiave (es. "SAAZ" vs "SAAZ PELLET" vs "SAAZ T-90")
    if (a.signature && a.signature === b.signature) {
        return { similar: true, reason: `Parola chiave comune: "${a.signature}"` };
    }

    // 2. Contenimento stretto dei token chiave (es. "SAAZ" contenuto in "SAAZ BOHEMIA")
    // Evita di proporre falsi positivi se ci sono numeri diversi (es. CARAMEL 30 vs CARAMEL 120)
    const numsA = a.tokens.filter(t => /\d/.test(t)).join(',');
    const numsB = b.tokens.filter(t => /\d/.test(t)).join(',');
    if (numsA && numsB && numsA !== numsB) {
        return { similar: false, reason: '' };
    }

    const shorter = a.tokens.length <= b.tokens.length ? a.tokens : b.tokens;
    const longer = a.tokens.length <= b.tokens.length ? b.tokens : a.tokens;
    if (shorter.length >= 1 && shorter.join('').length >= 3) {
        const longerSet = new Set(longer);
        const allContained = shorter.every(tok => longerSet.has(tok));
        if (allContained && longer.length <= shorter.length + 2) {
            return { similar: true, reason: `Termine "${shorter.join(' ')}" presente in entrambi` };
        }
    }

    return { similar: false, reason: '' };
};

/**
 * Applica i gruppi già confermati dall'utente e individua nuovi gruppi candidati
 * da sottoporre alla conferma esplicita prima dell'accorpamento.
 */
export const buildMergedReportAndSuggestions = (
    rawItems: RawConsumedIngredientSummary[],
    prefs: IngredientMergePreferences
): {
    rows: MergedConsumedIngredientRow[];
    pendingSuggestions: CandidateMergeSuggestion[];
} => {
    const rejectedSet = new Set(prefs.rejectedPairKeys);
    const assignedGroupByKey = new Map<string, ConfirmedIngredientMergeGroup>();

    prefs.confirmedGroups.forEach(group => {
        group.members.forEach(memberName => {
            assignedGroupByKey.set(`${group.tipologia}|${memberName.toUpperCase().trim()}`, group);
        });
    });

    // 1. Costruisci le righe visibili (accorpando SOLO i gruppi confermati)
    const rowBuckets = new Map<string, MergedConsumedIngredientRow>();

    rawItems.forEach(item => {
        const matchedGroup = assignedGroupByKey.get(item.key);
        const bucketKey = matchedGroup
            ? `GROUP|${matchedGroup.id}`
            : `RAW|${item.key}`;

        const existing = rowBuckets.get(bucketKey);
        if (!existing) {
            rowBuckets.set(bucketKey, {
                rowKey: bucketKey,
                tipologia: item.tipologia,
                displayName: matchedGroup ? matchedGroup.targetName : item.nome,
                totalQty: item.totalQty,
                estimatedCost: item.estimatedCost,
                lottiCount: item.lottiCount,
                openLotsCount: item.openLotsCount,
                closedLotsCount: item.closedLotsCount,
                isMerged: Boolean(matchedGroup),
                mergeGroupId: matchedGroup?.id,
                constituents: [item],
                lotsDetail: [...item.lotsDetail],
            });
        } else {
            existing.totalQty = Math.round((existing.totalQty + item.totalQty + Number.EPSILON) * 1000) / 1000;
            existing.estimatedCost = Math.round((existing.estimatedCost + item.estimatedCost + Number.EPSILON) * 100) / 100;
            existing.constituents.push(item);
            existing.lotsDetail.push(...item.lotsDetail);
            const allLots = new Set(existing.lotsDetail.map(d => d.lotto).filter(Boolean));
            const openLots = new Set(existing.lotsDetail.filter(d => !d.isClosed).map(d => d.lotto).filter(Boolean));
            const closedLots = new Set(existing.lotsDetail.filter(d => d.isClosed).map(d => d.lotto).filter(Boolean));
            existing.lottiCount = allLots.size || existing.lotsDetail.length;
            existing.openLotsCount = openLots.size;
            existing.closedLotsCount = closedLots.size;
        }
    });

    const rows = Array.from(rowBuckets.values()).map(r => ({
        ...r,
        isMerged: Boolean(r.mergeGroupId && r.constituents.length > 1),
    }));

    rows.sort((a, b) => a.tipologia.localeCompare(b.tipologia) || b.totalQty - a.totalQty);

    // 2. Calcola suggerimenti candidati sugli item non ancora uniti
    const ungroupedItems = rawItems.filter(item => !assignedGroupByKey.has(item.key));
    const visited = new Set<string>();
    const pendingSuggestions: CandidateMergeSuggestion[] = [];

    // 2a. Verifica prima se un item non ancora raggruppato corrisponde a un gruppo già confermato
    prefs.confirmedGroups.forEach(group => {
        const groupSig = extractIngredientKeywordSignature(group.targetName, group.tipologia);
        const syntheticGroupSummary: RawConsumedIngredientSummary = {
            key: `SYN|${group.id}`,
            tipologia: group.tipologia,
            nome: group.targetName.toUpperCase().trim(),
            totalQty: 0,
            estimatedCost: 0,
            lottiCount: 0,
            openLotsCount: 0,
            closedLotsCount: 0,
            lotsDetail: [],
            signature: groupSig.signature,
            tokens: groupSig.tokens,
        };

        const matchingNewItems: RawConsumedIngredientSummary[] = [];
        ungroupedItems.forEach(candidate => {
            if (visited.has(candidate.key) || candidate.tipologia !== group.tipologia) return;
            const anyRejected = group.members.some(m =>
                rejectedSet.has(makeRejectedPairKey(group.tipologia, m, candidate.nome))
            );
            if (anyRejected) return;
            const check = areItemsSimilarCandidates(syntheticGroupSummary, candidate);
            if (check.similar) {
                matchingNewItems.push(candidate);
            }
        });

        if (matchingNewItems.length > 0) {
            matchingNewItems.forEach(m => visited.add(m.key));
            pendingSuggestions.push({
                suggestionId: `SUGG_ADD_${group.id}_${matchingNewItems.map(c => c.nome).sort().join('|')}`,
                tipologia: group.tipologia,
                suggestedTargetName: group.targetName,
                reason: `Nuova variante compatibile con gruppo esistente "${group.targetName}"`,
                items: matchingNewItems,
                combinedQty: Math.round((matchingNewItems.reduce((s, c) => s + c.totalQty, 0) + Number.EPSILON) * 1000) / 1000,
                combinedCost: Math.round((matchingNewItems.reduce((s, c) => s + c.estimatedCost, 0) + Number.EPSILON) * 100) / 100,
                existingGroupId: group.id,
                existingGroupMembers: group.members,
            });
        }
    });

    // 2b. Raggruppa nuovi candidati tra loro
    for (let i = 0; i < ungroupedItems.length; i++) {
        const seed = ungroupedItems[i];
        if (visited.has(seed.key)) continue;

        const cluster: RawConsumedIngredientSummary[] = [seed];
        let matchedReason = '';

        for (let j = i + 1; j < ungroupedItems.length; j++) {
            const candidate = ungroupedItems[j];
            if (visited.has(candidate.key)) continue;
            if (rejectedSet.has(makeRejectedPairKey(seed.tipologia, seed.nome, candidate.nome))) {
                continue;
            }
            const check = areItemsSimilarCandidates(seed, candidate);
            if (check.similar) {
                cluster.push(candidate);
                if (!matchedReason) matchedReason = check.reason;
            }
        }

        if (cluster.length >= 2) {
            cluster.forEach(c => visited.add(c.key));
            const shortestRaw = [...cluster].sort((x, y) => x.nome.length - y.nome.length)[0];
            const proposedName = seed.signature && seed.signature.length >= 3
                ? seed.signature
                : shortestRaw.nome;

            pendingSuggestions.push({
                suggestionId: `SUGG_${seed.tipologia}_${cluster.map(c => c.nome).sort().join('|')}`,
                tipologia: seed.tipologia,
                suggestedTargetName: proposedName,
                reason: matchedReason || `Parole chiave affini`,
                items: cluster,
                combinedQty: Math.round((cluster.reduce((s, c) => s + c.totalQty, 0) + Number.EPSILON) * 1000) / 1000,
                combinedCost: Math.round((cluster.reduce((s, c) => s + c.estimatedCost, 0) + Number.EPSILON) * 100) / 100,
            });
        }
    }

    return { rows, pendingSuggestions };
};
