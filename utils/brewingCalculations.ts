import type { BrewHeader, ExciseBracket } from '../types';

export interface BrewFermentationMetrics {
    ogPlato: number;
    fgPlato: number;
    ogSg: number;
    fgSg: number;
    abv: number;
    apparentAttenuation: number;
    realAttenuation: number;
    realExtractPlato: number;
    kcalPer100ml: number;
}

/**
 * Converte Grado Plato (°P) in Peso Specifico (SG 20°C/20°C) tramite polinomiale ASBC.
 */
export const platoToSpecificGravity = (plato: number): number => {
    if (!isFinite(plato) || plato <= 0) return 1.0;
    return 1 + plato / (258.6 - (plato / 258.2) * 227.1);
};

/**
 * Calcola grado alcolico (% ABV), attenuazione apparente (% AA), attenuazione reale (% RA)
 * ed estratto reale secondo equazione di Balling / ASBC a partire da OG e FG in °Plato.
 */
export const calculateBrewMetrics = (
    ogPlatoInput: number | string | undefined,
    fgPlatoInput: number | string | undefined
): BrewFermentationMetrics | null => {
    const parseNum = (v: number | string | undefined): number => {
        if (typeof v === 'number') return v;
        if (!v) return NaN;
        return parseFloat(String(v).replace(',', '.'));
    };

    const ogPlato = parseNum(ogPlatoInput);
    const fgPlato = parseNum(fgPlatoInput);

    if (isNaN(ogPlato) || isNaN(fgPlato) || ogPlato <= 0 || fgPlato < 0 || fgPlato > ogPlato) {
        return null;
    }

    const ogSg = platoToSpecificGravity(ogPlato);
    const fgSg = platoToSpecificGravity(fgPlato);

    // Estratto reale (Balling): RE = 0.1808 * OE + 0.8192 * AE
    const realExtractPlato = 0.1808 * ogPlato + 0.8192 * fgPlato;

    // Alcol in peso (% ABW): (OE - RE) / (2.0665 - 0.010665 * OE)
    const denominator = 2.0665 - 0.010665 * ogPlato;
    const abw = denominator > 0 ? Math.max(0, (ogPlato - realExtractPlato) / denominator) : 0;

    // Alcol in volume (% ABV): ABW * (FG_SG / 0.7907)
    const abv = Math.max(0, abw * (fgSg / 0.7907));

    const apparentAttenuation = ogPlato > 0 ? ((ogPlato - fgPlato) / ogPlato) * 100 : 0;
    const realAttenuation = ogPlato > 0 ? ((ogPlato - realExtractPlato) / ogPlato) * 100 : 0;

    // Stima energetica ASBC (kcal / 100 ml)
    const kcalPer100ml = (6.9 * abw + 4.0 * Math.max(0, realExtractPlato - 0.1)) * fgSg;

    return {
        ogPlato,
        fgPlato,
        ogSg,
        fgSg,
        abv,
        apparentAttenuation,
        realAttenuation,
        realExtractPlato,
        kcalPer100ml,
    };
};

export const ABV_TOLERANCE_PERCENT = 0.5;

export const parseNumericInput = (v: number | string | undefined): number => {
    if (typeof v === 'number') return isFinite(v) ? v : NaN;
    if (v === undefined || v === null) return NaN;
    const trimmed = String(v).trim();
    if (!trimmed) return NaN;
    return parseFloat(trimmed.replace(',', '.'));
};

/**
 * Calcola il contributo alcolico (% ABV) apportato dallo zucchero di rifermentazione secondaria (g/L).
 * Rapporto stechiometrico pratico birrario: ~16 g/L di zucchero fermentescibile = +1.00% vol (0.0625% vol per g/L).
 */
export const calculateRefermentationAbv = (gramsPerLiterInput: number | string | undefined): number => {
    const gPerL = parseNumericInput(gramsPerLiterInput);
    if (isNaN(gPerL) || gPerL <= 0) return 0;
    return gPerL / 16;
};

/**
 * Calcola i kg totali di zucchero da usare/scaricare in base ai g/L impostati e ai litri effettivi confezionati.
 */
export const calculatePrimingSugarKg = (
    gramsPerLiterInput: number | string | undefined,
    liters: number
): number => {
    const gPerL = parseNumericInput(gramsPerLiterInput);
    if (isNaN(gPerL) || gPerL <= 0 || !isFinite(liters) || liters <= 0) return 0;
    return Math.round(((gPerL * liters) / 1000 + Number.EPSILON) * 1000) / 1000;
};

export interface YeastLineageNode {
    lotto: string;
    birra: string;
    dataProd: string;
    fermentatore: string;
    generation: number;
    strain: string;
}

/**
 * Ricostruisce la genealogia del lievito (catena ascendente dai lotti madre e lotti figli generati).
 */
export const buildYeastGenealogy = (
    currentLotto: string,
    allCotte: BrewHeader[]
): { ancestors: YeastLineageNode[]; children: YeastLineageNode[] } => {
    const byLotto = new Map<string, BrewHeader>();
    allCotte.forEach(c => {
        if (c.LOTTO) byLotto.set(c.LOTTO.toUpperCase().trim(), c);
    });

    const ancestors: YeastLineageNode[] = [];
    const visited = new Set<string>();
    const startKey = currentLotto.toUpperCase().trim();
    visited.add(startKey);

    let cursor = byLotto.get(startKey);
    while (cursor?.yeastPitchType === 'REPITCHING' && cursor.yeastSourceLotto) {
        const parentKey = cursor.yeastSourceLotto.toUpperCase().trim();
        if (!parentKey || visited.has(parentKey)) break;
        visited.add(parentKey);
        const parent = byLotto.get(parentKey);
        if (!parent) {
            ancestors.unshift({
                lotto: parentKey,
                birra: 'Lotto storico',
                dataProd: '-',
                fermentatore: '-',
                generation: Math.max(0, (cursor.yeastGeneration || 1) - 1),
                strain: cursor.yeastStrain || '',
            });
            break;
        }
        ancestors.unshift({
            lotto: parent.LOTTO,
            birra: parent.NOME_BIRRA,
            dataProd: parent.DATA_PROD,
            fermentatore: parent.FERMENTATORE || '-',
            generation: parent.yeastGeneration ?? 0,
            strain: parent.yeastStrain || '',
        });
        cursor = parent;
    }

    const children: YeastLineageNode[] = allCotte
        .filter(
            c =>
                c.yeastPitchType === 'REPITCHING' &&
                (c.yeastSourceLotto || '').toUpperCase().trim() === startKey
        )
        .map(c => ({
            lotto: c.LOTTO,
            birra: c.NOME_BIRRA,
            dataProd: c.DATA_PROD,
            fermentatore: c.FERMENTATORE || '-',
            generation: c.yeastGeneration ?? 1,
            strain: c.yeastStrain || '',
        }));

    return { ancestors, children };
};

/**
 * Aliquote accisa birra Italia (TUA D.Lgs. 504/1995 art. 35 — base ordinaria € 2,99 / ettolitro-grado Plato).
 */
export const ADM_BASE_EXCISE_EUR_HL_PLATO = 2.99;

export const EXCISE_BRACKET_OPTIONS: Array<{
    value: ExciseBracket;
    label: string;
    reductionLabel: string;
    rateEurHlPlato: number;
}> = [
    {
        value: 'MICRO_50',
        label: 'Microbirrificio Artigianale (fino a 10.000 hL/anno)',
        reductionLabel: 'Riduzione -50%',
        rateEurHlPlato: 1.495,
    },
    {
        value: 'ARTIGIANALE_30',
        label: 'Birrificio Artigianale (10.001 – 30.000 hL/anno)',
        reductionLabel: 'Riduzione -30%',
        rateEurHlPlato: 2.093,
    },
    {
        value: 'ARTIGIANALE_20',
        label: 'Birrificio Artigianale (30.001 – 60.000 hL/anno)',
        reductionLabel: 'Riduzione -20%',
        rateEurHlPlato: 2.392,
    },
    {
        value: 'ORDINARIA',
        label: 'Aliquota Ordinaria (> 60.000 hL/anno)',
        reductionLabel: 'Aliquota piena',
        rateEurHlPlato: 2.99,
    },
    {
        value: 'PERSONALIZZATA',
        label: 'Coefficiente Personalizzato (da Parametri Costi)',
        reductionLabel: 'Manuale',
        rateEurHlPlato: 2.99,
    },
];

export const resolveEffectiveExciseRate = (
    bracket: ExciseBracket | undefined,
    customCoeff?: number
): number => {
    if (!bracket || bracket === 'PERSONALIZZATA') {
        return customCoeff && customCoeff > 0 ? customCoeff : ADM_BASE_EXCISE_EUR_HL_PLATO;
    }
    const found = EXCISE_BRACKET_OPTIONS.find(b => b.value === bracket);
    return found ? found.rateEurHlPlato : ADM_BASE_EXCISE_EUR_HL_PLATO;
};

/**
 * Troncamento fiscale del Grado Plato al decimo di grado (normativa ADM per liquidazione birra).
 */
export const normalizeFiscalPlato = (platoRaw: number): number => {
    if (!isFinite(platoRaw) || platoRaw <= 0) return 0;
    return Math.floor((platoRaw + 1e-6) * 10) / 10;
};
