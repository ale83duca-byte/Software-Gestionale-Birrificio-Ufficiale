import type { BreweryData, BrewerySheet, Movement, DatabaseItem, RawWarehouseItem, WarehouseStatus, PriceDBItem, InitialBeerStock, PackagingData, BrewHeader, FermentationDataPoint, BreweryProfile, Cliente, Birra, KegFleetConfigItem, KegFleetFormat, KegMovementLog, GasTankConfig, TechGasCylinderItem } from '../types';
import { getDb } from './db';
import { computeDualLocationBeerStock } from '../utils/beerStockEngine';

export const DEFAULT_GAS_TANK_CONFIG: GasTankConfig = {
    gasType: 'gpl',
    capacitaTotaleLitri: 2750,
    percentualeRiempimentoMax: 85,
    fattoreConversioneLitriAMc: 0.26, // 1 L liquido GPL ≈ 0.260 m³ gas (1 m³ ≈ 3.85 L)
    litriInizialiAnno: 0,
    dataTaratura: undefined,
    sogliaRiservaPercent: 20,
    indirizzoDepositoCentrale: '',
};

export const getEffectiveGasTankConfig = (data?: Partial<BreweryData> | null): GasTankConfig => {
    const saved = data?.GAS_TANK_CONFIG;
    return {
        gasType: saved?.gasType || DEFAULT_GAS_TANK_CONFIG.gasType,
        capacitaTotaleLitri: saved?.capacitaTotaleLitri && saved.capacitaTotaleLitri > 0 ? saved.capacitaTotaleLitri : DEFAULT_GAS_TANK_CONFIG.capacitaTotaleLitri,
        percentualeRiempimentoMax: saved?.percentualeRiempimentoMax && saved.percentualeRiempimentoMax > 0 ? saved.percentualeRiempimentoMax : DEFAULT_GAS_TANK_CONFIG.percentualeRiempimentoMax,
        fattoreConversioneLitriAMc: saved?.fattoreConversioneLitriAMc && saved.fattoreConversioneLitriAMc > 0 ? saved.fattoreConversioneLitriAMc : DEFAULT_GAS_TANK_CONFIG.fattoreConversioneLitriAMc,
        litriInizialiAnno: typeof saved?.litriInizialiAnno === 'number' ? saved.litriInizialiAnno : 0,
        dataTaratura: saved?.dataTaratura || undefined,
        sogliaRiservaPercent: typeof saved?.sogliaRiservaPercent === 'number' ? saved.sogliaRiservaPercent : DEFAULT_GAS_TANK_CONFIG.sogliaRiservaPercent,
        indirizzoDepositoCentrale: saved?.indirizzoDepositoCentrale || '',
    };
};

export const DEFAULT_TECH_GAS_CONFIG: TechGasCylinderItem[] = [
    {
        codice: 'CO2',
        nome: 'CO₂ Alimentare (E290)',
        unitaCapacita: 'kg',
        formatoCapacita: 30,
        pieneScorta: 0,
        inUsoImpianto: 0,
        vuoteDaRendere: 0,
        sogliaAllarmePiene: 1,
        costoMedioRicarica: 38,
        attivo: true,
    },
    {
        codice: 'AZOTO',
        nome: 'Azoto Alimentare N₂ / Carboazoto',
        unitaCapacita: 'L',
        formatoCapacita: 50,
        pieneScorta: 0,
        inUsoImpianto: 0,
        vuoteDaRendere: 0,
        sogliaAllarmePiene: 1,
        costoMedioRicarica: 45,
        attivo: true,
    },
    {
        codice: 'ARGON',
        nome: 'Argon Puro Ar (Inertizzazione)',
        unitaCapacita: 'L',
        formatoCapacita: 50,
        pieneScorta: 0,
        inUsoImpianto: 0,
        vuoteDaRendere: 0,
        sogliaAllarmePiene: 1,
        costoMedioRicarica: 55,
        attivo: true,
    },
];

export const getEffectiveTechGasConfig = (data?: Partial<BreweryData> | null): TechGasCylinderItem[] => {
    const saved = data?.TECH_GAS_CONFIG;
    if (!saved || !Array.isArray(saved) || saved.length === 0) {
        return DEFAULT_TECH_GAS_CONFIG.map(item => ({ ...item }));
    }
    return DEFAULT_TECH_GAS_CONFIG.map(def => {
        const found = saved.find(s => s.codice === def.codice);
        return found ? { ...def, ...found } : { ...def };
    });
};

export const DEFAULT_KEG_FLEET_CONFIG: KegFleetConfigItem[] = [
    { formato: 'FUSTO ACCIAIO 20L', dotazioneTotale: 0, vuotiLavatiIniziali: 0, cauzioneUnitaria: 50 },
    { formato: 'FUSTO ACCIAIO 24L', dotazioneTotale: 0, vuotiLavatiIniziali: 0, cauzioneUnitaria: 55 },
    { formato: 'FUSTO ACCIAIO 30L', dotazioneTotale: 0, vuotiLavatiIniziali: 0, cauzioneUnitaria: 60 },
];

export const DEFAULT_BREWERY_PROFILE: BreweryProfile = {
    ragioneSociale: 'BIRRIFICIO ALVERESE',
    indirizzo: '',
    capCittaProvincia: '',
    partitaIva: '',
    codiceFiscale: '',
    codiceUnivocoSdi: '',
    codiceAccisa: '',
    telefono: '',
    email: '',
    pec: '',
    iban: '',
    regimeFiscale: 'RF01',
    scaglioneAccisa: 'MICRO_50',
    internalClientName: 'ALVERESE',
};

export const getEffectiveBreweryProfile = (data?: Partial<BreweryData> | null): BreweryProfile => {
    const saved = data?.BREWERY_PROFILE;
    return {
        ragioneSociale: saved?.ragioneSociale?.trim() || DEFAULT_BREWERY_PROFILE.ragioneSociale,
        indirizzo: saved?.indirizzo?.trim() || '',
        capCittaProvincia: saved?.capCittaProvincia?.trim() || '',
        partitaIva: saved?.partitaIva?.trim() || '',
        codiceFiscale: saved?.codiceFiscale?.trim() || '',
        codiceUnivocoSdi: saved?.codiceUnivocoSdi?.trim() || '',
        codiceAccisa: saved?.codiceAccisa?.trim() || '',
        telefono: saved?.telefono?.trim() || '',
        email: saved?.email?.trim() || '',
        pec: saved?.pec?.trim() || '',
        iban: saved?.iban?.trim() || '',
        regimeFiscale: saved?.regimeFiscale?.trim() || 'RF01',
        scaglioneAccisa: saved?.scaglioneAccisa || 'MICRO_50',
        internalClientName: saved?.internalClientName?.trim() || DEFAULT_BREWERY_PROFILE.internalClientName,
    };
};

export const getInternalClientName = (data?: Partial<BreweryData> | null): string => {
    const configured = getEffectiveBreweryProfile(data).internalClientName;
    const matchedClient = (data?.CLIENTI || []).find(
        c => c.nome.trim().toUpperCase() === configured.toUpperCase()
    );
    return matchedClient ? matchedClient.nome : configured;
};

export const isInternalOwner = (
    data?: Partial<BreweryData> | null,
    ownerName?: string | null
): boolean => {
    const normOwner = (ownerName || '').trim().toUpperCase();
    if (!normOwner) return false;
    const profile = getEffectiveBreweryProfile(data);
    const internalName = getInternalClientName(data).trim().toUpperCase();
    const configuredInternal = profile.internalClientName.trim().toUpperCase();
    const ragioneSoc = profile.ragioneSociale.trim().toUpperCase();
    return (
        normOwner === internalName ||
        normOwner === configuredInternal ||
        normOwner === ragioneSoc
    );
};

export type DdtSequenceKind = 'SALES' | 'TRANSFER' | 'WASTE';

export const extractSeqFromDdtString = (ddtStr: string | undefined, targetYear: string): number => {
    if (!ddtStr) return 0;
    const clean = String(ddtStr).trim().toUpperCase().replace(/\s+/g, '');
    // Matches "12/2026", "TR-12/2026", "SC-12/2026", "FT-012/2026", "12-BIS/2026"
    const slashMatch = clean.match(/^(?:TR-|SC-|FT-|DDT-|N\.?)?0*(\d+)(?:[A-Z-]*)\/(\d{4})$/);
    if (slashMatch) {
        return slashMatch[2] === targetYear ? parseInt(slashMatch[1], 10) : 0;
    }
    // Matches short year e.g. "12/26"
    const shortYearMatch = clean.match(/^(?:TR-|SC-|FT-|DDT-|N\.?)?0*(\d+)(?:[A-Z-]*)\/(\d{2})$/);
    if (shortYearMatch) {
        return targetYear.endsWith(shortYearMatch[2]) ? parseInt(shortYearMatch[1], 10) : 0;
    }
    // Matches legacy "TR-2026-005" or "SC-2026-005"
    const dashMatch = clean.match(/^(?:TR|SC|FT|DDT)-(\d{4})-0*(\d+)$/);
    if (dashMatch) {
        return dashMatch[1] === targetYear ? parseInt(dashMatch[2], 10) : 0;
    }
    // Matches pure integer or prefix + integer without explicit conflicting year (e.g. "15", "TR-15")
    const plainMatch = clean.match(/^(?:TR-|SC-|FT-|DDT-|N\.?)?0*(\d+)$/);
    if (plainMatch) {
        return parseInt(plainMatch[1], 10);
    }
    return 0;
};

export const normalizeDdtInput = (
    rawInput: string,
    year: string,
    kind: DdtSequenceKind
): { numeroDdt: string; seq: number } => {
    const trimmed = rawInput.trim();
    if (!trimmed) return { numeroDdt: '', seq: 0 };
    if (/^\d+$/.test(trimmed)) {
        const seq = parseInt(trimmed, 10);
        if (kind === 'TRANSFER') return { numeroDdt: `TR-${seq}/${year}`, seq };
        if (kind === 'WASTE') return { numeroDdt: `SC-${seq}/${year}`, seq };
        return { numeroDdt: `${seq}/${year}`, seq };
    }
    const seq = extractSeqFromDdtString(trimmed, year);
    return { numeroDdt: trimmed, seq };
};

export const syncDdtCountersForYear = (data: BreweryData, year: string): BreweryData => {
    let salesMax = 0;
    (data.PACKAGED_BEER_ORDERS || []).forEach(o => {
        const s = extractSeqFromDdtString(o.numeroDdt, year) || (o.numeroDdt ? (o.ddtSeqNumber || 0) : 0);
        if (s > salesMax) salesMax = s;
    });
    (data.SALES_ORDERS || []).forEach(o => {
        const s = extractSeqFromDdtString(o.numeroDdt, year) || (o.numeroDdt ? (o.ddtSeqNumber || 0) : 0);
        if (s > salesMax) salesMax = s;
    });

    let transferMax = 0;
    (data.INTERNAL_TRANSFERS || []).forEach(tr => {
        const s = extractSeqFromDdtString(tr.numeroDdt, year) || (tr.numeroDdt ? (tr.ddtSeqNumber || 0) : 0);
        if (s > transferMax) transferMax = s;
    });

    let wasteMax = 0;
    (data.BEER_MOVEMENTS || []).forEach(m => {
        if (m.type === 'WASTE') {
            const s = extractSeqFromDdtString(m.ddtNumber, year) || (m.ddtNumber ? (m.ddtSeqNumber || 0) : 0);
            if (s > wasteMax) wasteMax = s;
        }
    });

    data.DDT_COUNTERS = {
        sales: salesMax,
        transfer: transferMax,
        waste: wasteMax,
    };
    return data;
};

/**
 * Calcola il prossimo numero progressivo annuale per tipologia di DDT (1 -> N nell'anno, azzerato al cambio anno).
 * - SALES: DDT di vendita / cessione (`1/2026`, `2/2026`, ...)
 * - TRANSFER: DDT di trasporto da birrificio a magazzino centrale (`TR-1/2026`, `TR-2/2026`, ...)
 * - WASTE: DDT di scarto prodotto per deterioramento (`SC-1/2026`, `SC-2/2026`, ...)
 */
export const getNextDdtNumber = (
    data: Partial<BreweryData> | null | undefined,
    year: string,
    kind: DdtSequenceKind
): { seq: number; numeroDdt: string } => {
    let maxSeq = 0;

    if (kind === 'SALES') {
        (data?.PACKAGED_BEER_ORDERS || []).forEach(o => {
            const s = extractSeqFromDdtString(o.numeroDdt, year) || (o.numeroDdt ? (o.ddtSeqNumber || 0) : 0);
            if (s > maxSeq) maxSeq = s;
        });
        (data?.SALES_ORDERS || []).forEach(o => {
            const s = extractSeqFromDdtString(o.numeroDdt, year) || (o.numeroDdt ? (o.ddtSeqNumber || 0) : 0);
            if (s > maxSeq) maxSeq = s;
        });
        const next = maxSeq + 1;
        return { seq: next, numeroDdt: `${next}/${year}` };
    }

    if (kind === 'TRANSFER') {
        (data?.INTERNAL_TRANSFERS || []).forEach(tr => {
            const s = extractSeqFromDdtString(tr.numeroDdt, year) || (tr.numeroDdt ? (tr.ddtSeqNumber || 0) : 0);
            if (s > maxSeq) maxSeq = s;
        });
        const next = maxSeq + 1;
        return { seq: next, numeroDdt: `TR-${next}/${year}` };
    }

    // WASTE
    (data?.BEER_MOVEMENTS || []).forEach(m => {
        if (m.type === 'WASTE') {
            const s = extractSeqFromDdtString(m.ddtNumber, year) || (m.ddtNumber ? (m.ddtSeqNumber || 0) : 0);
            if (s > maxSeq) maxSeq = s;
        }
    });
    const next = maxSeq + 1;
    return { seq: next, numeroDdt: `SC-${next}/${year}` };
};

export const getNextInvoiceNumber = (
    data: Partial<BreweryData> | null | undefined,
    year: string
): { seq: number; numeroFattura: string } => {
    let maxSeq = 0;
    (data?.SUMMARY_INVOICES || []).forEach(inv => {
        const s = extractSeqFromDdtString(inv.numeroFattura, year);
        if (s > maxSeq) maxSeq = s;
    });
    const next = maxSeq + 1;
    return {
        seq: next,
        numeroFattura: `FT-${String(next).padStart(3, '0')}/${year}`,
    };
};

export const assignMissingSalesDdtsForYear = async (year: string): Promise<number> => {
    const data = await getBreweryData(year);
    if (!data) return 0;

    const parseDateMs = (d: string): number => {
        if (!d) return 0;
        const p = d.split('/');
        if (p.length === 3) {
            const [day, month, yr] = p.map(Number);
            if (!isNaN(day) && !isNaN(month) && !isNaN(yr)) return new Date(yr, month - 1, day).getTime();
        }
        return 0;
    };

    type MissingRef = { kind: 'PACKAGED' | 'SALES'; id: string; dateMs: number };
    const missing: MissingRef[] = [];

    (data.PACKAGED_BEER_ORDERS || []).forEach(o => {
        if (!o.numeroDdt || !o.numeroDdt.trim()) {
            missing.push({ kind: 'PACKAGED', id: o.id, dateMs: parseDateMs(o.date) });
        }
    });
    (data.SALES_ORDERS || []).forEach(o => {
        if (!o.numeroDdt || !o.numeroDdt.trim()) {
            missing.push({ kind: 'SALES', id: o.id, dateMs: parseDateMs(o.date) });
        }
    });

    if (missing.length === 0) return 0;
    missing.sort((a, b) => a.dateMs - b.dateMs);

    let nextSeq = getNextDdtNumber(data, year, 'SALES').seq;
    const assignedMap = new Map<string, { numeroDdt: string; seq: number }>();
    missing.forEach(item => {
        assignedMap.set(`${item.kind}|${item.id}`, {
            numeroDdt: `${nextSeq}/${year}`,
            seq: nextSeq,
        });
        nextSeq += 1;
    });

    data.PACKAGED_BEER_ORDERS = (data.PACKAGED_BEER_ORDERS || []).map(o => {
        const hit = assignedMap.get(`PACKAGED|${o.id}`);
        return hit ? { ...o, numeroDdt: hit.numeroDdt, ddtSeqNumber: hit.seq } : o;
    });
    data.SALES_ORDERS = (data.SALES_ORDERS || []).map(o => {
        const hit = assignedMap.get(`SALES|${o.id}`);
        return hit ? { ...o, numeroDdt: hit.numeroDdt, ddtSeqNumber: hit.seq } : o;
    });

    syncDdtCountersForYear(data, year);
    await saveBreweryData(year, data);
    return missing.length;
};

const getDefaultData = (): BreweryData => ({
    MOVIMENTAZIONE: [], DATABASE: [], MAGAZZINO: [], COTTE_HEAD: [], FERMENTAZIONE: [],
    CONFEZIONAMENTO: [], CANTINA_CONFIG: [], CLIENTI: [], BIRRE: [], PRICE_DATABASE: [],
    COST_COEFFICIENTS: {}, QUOTES: [],
    BEER_WAREHOUSE_INITIAL: [],
    BEER_MOVEMENTS: [],
    SALES_ORDERS: [],
    PACKAGED_BEER_ORDERS: [],
    BEER_INVENTORY_CHECKS: [],
    BEER_PRICE_LIST: [],
    CLIENT_OFFERS: [],
    CALENDAR_NOTES: [],
    PLANNED_BREWS: [],
    MAINTENANCE_PLANS: [],
    MAINTENANCE_LOGS: [],
    BREWERY_PROFILE: { ...DEFAULT_BREWERY_PROFILE },
    KEG_FLEET_CONFIG: DEFAULT_KEG_FLEET_CONFIG.map(item => ({ ...item })),
    KEG_LOGS: [],
    SUMMARY_INVOICES: [],
    BEER_LOT_OVERRIDES: [],
    INTERNAL_TRANSFERS: [],
    GAS_TANK_CONFIG: { ...DEFAULT_GAS_TANK_CONFIG },
    GAS_REFILLS: [],
    TECH_GAS_CONFIG: DEFAULT_TECH_GAS_CONFIG.map(item => ({ ...item })),
    TECH_GAS_LOGS: [],
    DDT_COUNTERS: { sales: 0, transfer: 0, waste: 0 },
});

let autoBackupTimeout: ReturnType<typeof setTimeout> | null = null;

const scheduleLocalAutoBackup = () => {
    if (typeof window === 'undefined') return;
    if (autoBackupTimeout) clearTimeout(autoBackupTimeout);
    autoBackupTimeout = setTimeout(async () => {
        try {
            const allData = await getAllBreweryData();
            await fetch('/api/auto-backup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(allData),
            });
        } catch {
            // Endpoint disponibile quando eseguito tramite launcher.cjs desktop; ignorato silenziosamente in modalità browser pura
        }
    }, 1500);
};

export const getBreweryData = async (year: string): Promise<BreweryData | undefined> => {
    const db = await getDb();
    const data = await db.get('brewery_data', year);
    if (!data) return undefined;

    const defaultData = getDefaultData();
    for (const key in defaultData) {
        if (!data[key as BrewerySheet]) {
            data[key as BrewerySheet] = defaultData[key as BrewerySheet] as any;
        }
    }
    return data;
};

export const saveBreweryData = async (year: string, data: BreweryData) => {
    try {
        const db = await getDb();
        await db.put('brewery_data', data, year);
        window.dispatchEvent(new CustomEvent('data-saved'));
        scheduleLocalAutoBackup();
    } catch (error) {
        console.error("Failed to save brewery data.", error);
    }
};

export const getYears = async (): Promise<string[]> => {
    const db = await getDb();
    let years = await db.getAllKeys('brewery_data');
    years.sort();
    
    if (years.length === 0) {
        const currentYear = new Date().getFullYear().toString();
        await initializeYear(currentYear);
        return [currentYear];
    }
    return years;
};

const initializeYear = async (year: string, initialMovements: Movement[] = []) => {
    const newData = getDefaultData();
    newData.MOVIMENTAZIONE = initialMovements;
    const { magazzino, database } = syncWithMovements(newData.MOVIMENTAZIONE);
    newData.MAGAZZINO = magazzino;
    newData.DATABASE = database;
    await saveBreweryData(year, newData);
};

export const initializeCurrentYearData = async () => {
    await getYears(); // This will create the current year if none exist
};

export const createNewYear = async (newYear: string, importFromYear?: string, importActiveBrews: boolean = true): Promise<boolean> => {
    const db = await getDb();
    if (await db.get('brewery_data', newYear)) {
        return false;
    }

    const newData = getDefaultData();

    if (importFromYear) {
        const prevYearData = await getBreweryData(importFromYear);
        if (prevYearData) {
            // Riporto giacenze magazzino per singolo lotto fornitore preservando tracciabilità HACCP, scadenze e prezzi
            const lotCarryMap = new Map<string, {
                TIPOLOGIA: string;
                NOME: string;
                MARCA: string;
                FORNITORE: string;
                LOTTO_FORNITORE: string;
                giacenza: number;
                dataScadenza?: string;
                prezzo?: number;
            }>();

            (prevYearData.MOVIMENTAZIONE || []).forEach(m => {
                const tipologia = (m.TIPOLOGIA || '').toUpperCase().trim();
                const nome = (m.NOME || '').toUpperCase().trim();
                if (!nome) return;
                const marca = (m.MARCA || '').toUpperCase().trim();
                const fornitore = (m.FORNITORE || '').toUpperCase().trim();
                const lotto = (m.LOTTO_FORNITORE || '').toUpperCase().trim();
                const key = `${tipologia}|${nome}|${marca}|${fornitore}|${lotto}`;

                const existing = lotCarryMap.get(key) || {
                    TIPOLOGIA: tipologia,
                    NOME: nome,
                    MARCA: marca,
                    FORNITORE: fornitore,
                    LOTTO_FORNITORE: lotto,
                    giacenza: 0,
                    dataScadenza: undefined,
                    prezzo: undefined,
                };

                existing.giacenza += m.KG_LITRI_PZ;
                if (m.KG_LITRI_PZ > 0) {
                    if (m.DATA_SCADENZA) existing.dataScadenza = m.DATA_SCADENZA;
                    if (m.PREZZO && m.PREZZO > 0) existing.prezzo = m.PREZZO;
                }
                lotCarryMap.set(key, existing);
            });

            const initialMovements: Movement[] = Array.from(lotCarryMap.values())
                .filter(item => item.giacenza >= 0.01)
                .map(item => ({
                    DATA: `01/01/${newYear}`,
                    TIPOLOGIA: item.TIPOLOGIA,
                    NOME: item.NOME,
                    MARCA: item.MARCA,
                    FORNITORE: item.FORNITORE,
                    KG_LITRI_PZ: parseFloat(item.giacenza.toFixed(2)),
                    N_FATTURA: 'RIPORTO_ANNO_PREC',
                    LOTTO_FORNITORE: item.LOTTO_FORNITORE || `RIPORTO_${importFromYear}`,
                    LOTTO_PRODUZIONE: '',
                    DATA_SCADENZA: item.dataScadenza,
                    PREZZO: item.prezzo,
                }));

            newData.MOVIMENTAZIONE = initialMovements;
            newData.CLIENTI = (prevYearData.CLIENTI || []).map(c => ({ ...c }));
            newData.BIRRE = (prevYearData.BIRRE || []).map(b => ({
                ...b,
                ricetta: b.ricetta ? b.ricetta.map(r => ({ ...r })) : undefined,
            }));
            newData.CANTINA_CONFIG = (prevYearData.CANTINA_CONFIG || []).map(f => ({ ...f }));
            newData.PRICE_DATABASE = (prevYearData.PRICE_DATABASE || []).map(p => ({ ...p }));
            newData.COST_COEFFICIENTS = { ...(prevYearData.COST_COEFFICIENTS || {}) };
            newData.BEER_PRICE_LIST = (prevYearData.BEER_PRICE_LIST || []).map(item => ({
                ...item,
                prices: { ...(item.prices || {}) },
            }));
            newData.CLIENT_OFFERS = (prevYearData.CLIENT_OFFERS || []).map(offer => ({
                ...offer,
                prices: Object.fromEntries(
                    Object.entries(offer.prices || {}).map(([beer, fmtMap]) => [beer, { ...(fmtMap || {}) }])
                ),
            }));
            newData.MAINTENANCE_PLANS = (prevYearData.MAINTENANCE_PLANS || []).map(plan => ({ ...plan }));
            newData.BREWERY_PROFILE = prevYearData.BREWERY_PROFILE
                ? { ...prevYearData.BREWERY_PROFILE }
                : { ...DEFAULT_BREWERY_PROFILE };
            newData.KEG_FLEET_CONFIG = (prevYearData.KEG_FLEET_CONFIG && prevYearData.KEG_FLEET_CONFIG.length > 0)
                ? prevYearData.KEG_FLEET_CONFIG.map(k => ({ ...k }))
                : DEFAULT_KEG_FLEET_CONFIG.map(k => ({ ...k }));

            // Riporta i saldi aperti di fusti acciaio presso ciascun cliente al 01/01 del nuovo anno
            const clientKegBalance = new Map<string, number>();
            (prevYearData.KEG_LOGS || []).forEach(log => {
                if (!log.cliente) return;
                const key = `${log.cliente}|${log.formato}`;
                if (log.tipo === 'CONSEGNA_CLIENTE') {
                    clientKegBalance.set(key, (clientKegBalance.get(key) || 0) + log.quantita);
                } else if (log.tipo === 'RIENTRO_VUOTO') {
                    clientKegBalance.set(key, (clientKegBalance.get(key) || 0) - log.quantita);
                }
            });
            const carriedKegLogs: KegMovementLog[] = [];
            clientKegBalance.forEach((qty, key) => {
                if (qty > 0) {
                    const [cliente, formato] = key.split('|');
                    const cfg = newData.KEG_FLEET_CONFIG?.find(c => c.formato === formato);
                    carriedKegLogs.push({
                        id: `KEG_CARRY_${newYear}_${carriedKegLogs.length}`,
                        data: `01/01/${newYear}`,
                        tipo: 'CONSEGNA_CLIENTE',
                        formato: formato as KegFleetFormat,
                        quantita: qty,
                        cliente,
                        cauzioneTotale: qty * (cfg?.cauzioneUnitaria || 0),
                        note: `Saldo fusti a rendere riportato da anno ${importFromYear}`,
                    });
                }
            });
            newData.KEG_LOGS = carriedKegLogs;
            newData.SUMMARY_INVOICES = [];
            newData.QUOTES = []; // Quotes are not carried over
            newData.INTERNAL_TRANSFERS = [];
            newData.GAS_REFILLS = [];
            newData.DDT_COUNTERS = { sales: 0, transfer: 0, waste: 0 };

            // Riporto configurazione cisterna gas con calcolo automatico dei litri residui a fine anno (rispettando eventuale dataTaratura)
            const prevGasCfg = getEffectiveGasTankConfig(prevYearData);
            const calibrationMs = prevGasCfg.dataTaratura ? (parseItalianDate(prevGasCfg.dataTaratura)?.getTime() || 0) : 0;
            const totalRefilledLiters = (prevYearData.GAS_REFILLS || []).reduce((s, r) => {
                if (calibrationMs > 0) {
                    const rMs = parseItalianDate(r.data)?.getTime() || 0;
                    if (rMs > 0 && rMs < calibrationMs) return s;
                }
                return s + (r.litriScaricati || 0);
            }, 0);
            const totalUsedMc = (prevYearData.COTTE_HEAD || []).reduce((s, c) => {
                if (calibrationMs > 0) {
                    const cMs = parseItalianDate(c.DATA_PROD)?.getTime() || 0;
                    if (cMs > 0 && cMs < calibrationMs) return s;
                }
                const parseVal = (v: string | number | undefined) => {
                    if (typeof v === 'number') return v;
                    if (!v) return 0;
                    return parseFloat(String(v).replace(',', '.')) || 0;
                };
                const directB = parseVal(c.GAS_COTTA);
                const cntB = Math.max(0, parseVal(c.gasBrewCounterCurrent) - parseVal(c.gasBrewCounterPrevious));
                const directP = parseVal(c.GAS_CONFEZIONAMENTO);
                const cntP = Math.max(0, parseVal(c.gasPackagingCounterCurrent) - parseVal(c.gasPackagingCounterPrevious));
                return s + (directB > 0 ? directB : cntB) + (directP > 0 ? directP : cntP);
            }, 0);
            const factor = prevGasCfg.fattoreConversioneLitriAMc > 0 ? prevGasCfg.fattoreConversioneLitriAMc : 0.26;
            const usedLitersEq = totalUsedMc / factor;
            const residualGasLiters = Math.max(0, prevGasCfg.litriInizialiAnno + totalRefilledLiters - usedLitersEq);
            newData.GAS_TANK_CONFIG = {
                ...prevGasCfg,
                litriInizialiAnno: Number(residualGasLiters.toFixed(1)),
                dataTaratura: undefined,
            };

            // Riporto dotazione e situazione fisica bombole gas tecnici (CO2, Azoto, Argon) al 31/12
            newData.TECH_GAS_CONFIG = getEffectiveTechGasConfig(prevYearData).map(item => ({ ...item }));
            newData.TECH_GAS_LOGS = [];

            // Riporto giacenza birra confezionata al 31/12 preservando entrambi i poli (CELLA_BIRRIFICIO e MAGAZZINO_CENTRALE)
            const dualStock = computeDualLocationBeerStock(prevYearData);
            const newInitialBeerStock: InitialBeerStock[] = dualStock.allPositiveStock.map(item => ({
                cliente: item.cliente,
                nomeBirra: item.nomeBirra,
                lotto: item.lotto,
                formato: item.formato,
                quantita: Math.round(item.quantita),
                dataScadenza: item.dataScadenza || '',
                location: item.location || 'MAGAZZINO_CENTRALE',
            })).filter(i => i.quantita > 0);
            newData.BEER_WAREHOUSE_INITIAL = newInitialBeerStock;
            newData.BEER_LOT_OVERRIDES = (prevYearData.BEER_LOT_OVERRIDES || []).map(o => ({ ...o }));

            // 3. Riporto automatico cotte ancora in cantina / fermentazione (es. cotte di Dicembre)
            if (importActiveBrews) {
                const activeCarriedOverCotte: BrewHeader[] = [];
                const activeCarriedOverFerm: FermentationDataPoint[] = [];

                (prevYearData.COTTE_HEAD || []).forEach(cotta => {
                    const fermName = cotta.FERMENTATORE ? cotta.FERMENTATORE.trim() : '';
                    const litriFinali = parseFloat(cotta.LITRI_FINALI?.replace(',', '.') || '0') || 0;
                    
                    // Calcola litri già confezionati nell'anno precedente
                    const prevPackaged = (prevYearData.CONFEZIONAMENTO || [])
                        .filter(p => p.LOTTO_PROD === cotta.LOTTO)
                        .reduce((sum, p) => sum + (p.LITRI_TOT || 0), 0);

                    // La cotta è ancora in cantina se ha un fermentatore assegnato, non è chiusa in cantina e non è stata interamente confezionata
                    const isStillInCellar = !cotta.isCellarClosed && fermName !== '' && litriFinali > 0 && prevPackaged < (litriFinali - 0.5);

                    if (isStillInCellar) {
                        // Recupera ingredienti utilizzati nella cotta dall'anno precedente per consultazione e calcolo costi
                        const brewCategories = ['MALTI', 'MALTO', 'LUPPOLI', 'LUPPOLO', 'LIEVITI', 'LIEVITO', 'ADDITIVI', 'ADDITIVO', 'SANIFICANTI', 'SANIFICANTE', 'ALTRO', 'ZUCCHERO', 'SPEZIE'];
                        const lotIngredients = (prevYearData.MOVIMENTAZIONE || []).filter(m =>
                            m.LOTTO_PRODUZIONE === cotta.LOTTO &&
                            m.KG_LITRI_PZ < 0 &&
                            brewCategories.some(cat => (m.TIPOLOGIA || '').toUpperCase().includes(cat))
                        );

                        // Recupera tutte le letture di fermentazione già effettuate per continuità del grafico
                        const lotFermPoints = (prevYearData.FERMENTAZIONE || []).filter(f => f.LOTTO === cotta.LOTTO);
                        activeCarriedOverFerm.push(...lotFermPoints);

                        // Calcola litri residui nel fermentatore
                        const remainingLiters = Math.max(0, litriFinali - prevPackaged);

                        activeCarriedOverCotte.push({
                            ...cotta,
                            isCarriedOver: true,
                            carriedOverFromYear: importFromYear,
                            carriedOverIngredients: lotIngredients,
                            litriFinaliOrigine: cotta.LITRI_FINALI,
                            litriGiaConfezionatiAnnoPrec: prevPackaged,
                            LITRI_FINALI: remainingLiters > 0 ? remainingLiters.toFixed(2).replace(/\.00$/, '') : cotta.LITRI_FINALI,
                            frozenPrices: cotta.frozenPrices || prevYearData.PRICE_DATABASE || [],
                            frozenCoeffs: cotta.frozenCoeffs || prevYearData.COST_COEFFICIENTS || {},
                        });
                    }
                });

                newData.COTTE_HEAD = activeCarriedOverCotte;
                newData.FERMENTAZIONE = activeCarriedOverFerm;
            }
        }
    }
    
    const { magazzino, database } = syncWithMovements(newData.MOVIMENTAZIONE);
    newData.MAGAZZINO = magazzino;
    newData.DATABASE = database;
    
    await saveBreweryData(newYear, newData);
    return true;
};

export const getActiveCellarLotsPreview = async (year: string): Promise<Array<{ lotto: string; birra: string; fermentatore: string; litri: number }>> => {
    const data = await getBreweryData(year);
    if (!data) return [];
    const preview: Array<{ lotto: string; birra: string; fermentatore: string; litri: number }> = [];
    (data.COTTE_HEAD || []).forEach(cotta => {
        const fermName = cotta.FERMENTATORE ? cotta.FERMENTATORE.trim() : '';
        const litriFinali = parseFloat(cotta.LITRI_FINALI?.replace(',', '.') || '0') || 0;
        const prevPackaged = (data.CONFEZIONAMENTO || [])
            .filter(p => p.LOTTO_PROD === cotta.LOTTO)
            .reduce((sum, p) => sum + (p.LITRI_TOT || 0), 0);
        if (!cotta.isCellarClosed && fermName !== '' && litriFinali > 0 && prevPackaged < (litriFinali - 0.5)) {
            preview.push({
                lotto: cotta.LOTTO,
                birra: cotta.NOME_BIRRA,
                fermentatore: fermName,
                litri: Math.round(Math.max(0, litriFinali - prevPackaged))
            });
        }
    });
    return preview;
};

const syncWithMovements = (movements: Movement[]) => {
    const safeMovements = (Array.isArray(movements) ? movements : []).map(m => {
        const parsedQty = typeof m.KG_LITRI_PZ === 'number'
            ? (isFinite(m.KG_LITRI_PZ) ? m.KG_LITRI_PZ : 0)
            : (parseFloat(String(m.KG_LITRI_PZ ?? '0').replace(',', '.')) || 0);
        return {
            ...m,
            TIPOLOGIA: String(m.TIPOLOGIA || 'ALTRO').toUpperCase().trim(),
            NOME: String(m.NOME || '').toUpperCase().trim(),
            MARCA: m.MARCA ? String(m.MARCA).toUpperCase().trim() : '',
            FORNITORE: m.FORNITORE ? String(m.FORNITORE).toUpperCase().trim() : '',
            KG_LITRI_PZ: parsedQty,
        };
    });
    const dbItems = new Map<string, DatabaseItem>();
    safeMovements.forEach(m => {
        if (m.KG_LITRI_PZ > 0 && m.NOME) {
            const key = `${m.NOME}|${m.MARCA}`;
            if (!dbItems.has(key)) {
                dbItems.set(key, { TIPOLOGIA: m.TIPOLOGIA, NOME: m.NOME, MARCA: m.MARCA, FORNITORE: m.FORNITORE });
            }
        }
    });
    const database = Array.from(dbItems.values());
    const warehouseMap = new Map<string, number>();
    safeMovements.forEach(m => {
        if (!m.NOME) return;
        const key = `${m.TIPOLOGIA}|${m.NOME}|${m.MARCA}|${m.FORNITORE}`;
        warehouseMap.set(key, (warehouseMap.get(key) || 0) + m.KG_LITRI_PZ);
    });
    const magazzino: RawWarehouseItem[] = Array.from(warehouseMap.entries()).map(([key, giacenza]) => {
        const [TIPOLOGIA, NOME, MARCA, FORNITORE] = key.split('|');
        return { TIPOLOGIA, NOME, MARCA, FORNITORE, GIACENZA: parseFloat(giacenza.toFixed(2)) };
    })
    .filter(item => item.GIACENZA > 0.01);
    return { magazzino, database };
};

export const addMovementsAndSync = async (year: string, newMovements: Movement[]) => {
    const data = await getBreweryData(year) || getDefaultData();
    data.MOVIMENTAZIONE.push(...newMovements);

    // Update Price Database
    newMovements.forEach(movement => {
        if (movement.KG_LITRI_PZ > 0 && movement.PREZZO && movement.PREZZO > 0) {
            const newItem: PriceDBItem = {
                NOME: movement.NOME.toUpperCase().trim(),
                MARCA: (movement.MARCA || '').toUpperCase().trim(),
                FORNITORE: (movement.FORNITORE || '').toUpperCase().trim(),
                PREZZO: movement.PREZZO,
                DATA_ULTIMO_CARICO: movement.DATA,
            };
            const index = data.PRICE_DATABASE.findIndex(
                item => item.NOME === newItem.NOME && item.MARCA === newItem.MARCA && item.FORNITORE === newItem.FORNITORE
            );
            if (index > -1) {
                data.PRICE_DATABASE[index] = newItem;
            } else {
                data.PRICE_DATABASE.push(newItem);
            }
        }
    });

    const { magazzino, database } = syncWithMovements(data.MOVIMENTAZIONE);
    data.MAGAZZINO = magazzino;
    data.DATABASE = database;
    await saveBreweryData(year, data);
};

export const updateMovementAndSync = async (year: string, originalIndex: number, updatedMovement: Movement) => {
    const data = await getBreweryData(year);
    if (!data || originalIndex < 0 || originalIndex >= data.MOVIMENTAZIONE.length) {
        throw new Error("Movimento non trovato o non valido.");
    }

    data.MOVIMENTAZIONE[originalIndex] = updatedMovement;
    
    if (updatedMovement.KG_LITRI_PZ > 0 && updatedMovement.PREZZO && updatedMovement.PREZZO > 0) {
        const newItem: PriceDBItem = {
            NOME: updatedMovement.NOME.toUpperCase().trim(),
            MARCA: (updatedMovement.MARCA || '').toUpperCase().trim(),
            FORNITORE: (updatedMovement.FORNITORE || '').toUpperCase().trim(),
            PREZZO: updatedMovement.PREZZO,
            DATA_ULTIMO_CARICO: updatedMovement.DATA,
        };
        const index = data.PRICE_DATABASE.findIndex(
            item => item.NOME === newItem.NOME && item.MARCA === newItem.MARCA && item.FORNITORE === newItem.FORNITORE
        );
        if (index > -1) {
            data.PRICE_DATABASE[index] = newItem;
        } else {
            data.PRICE_DATABASE.push(newItem);
        }
    }

    const { magazzino, database } = syncWithMovements(data.MOVIMENTAZIONE);
    data.MAGAZZINO = magazzino;
    data.DATABASE = database;
    await saveBreweryData(year, data);
};

export const deleteMovementByIndexAndSync = async (year: string, index: number) => {
    const data = await getBreweryData(year);
    if (data && index >= 0 && index < data.MOVIMENTAZIONE.length) {
        data.MOVIMENTAZIONE.splice(index, 1);
        const { magazzino, database } = syncWithMovements(data.MOVIMENTAZIONE);
        data.MAGAZZINO = magazzino;
        data.DATABASE = database;
        await saveBreweryData(year, data);
    }
};

export const deleteMovementsByInvoiceAndSync = async (year: string, invoiceId: string) => {
    const data = await getBreweryData(year);
    if (!data) return;
    data.MOVIMENTAZIONE = data.MOVIMENTAZIONE.filter(m => m.N_FATTURA !== invoiceId);
    const { magazzino, database } = syncWithMovements(data.MOVIMENTAZIONE);
    data.MAGAZZINO = magazzino;
    data.DATABASE = database;
    await saveBreweryData(year, data);
};

export const saveDataToSheet = async <T extends BrewerySheet>(year: string, sheet: T, newData: BreweryData[T]) => {
    const data = await getBreweryData(year) || getDefaultData();
    data[sheet] = newData;
    await saveBreweryData(year, data);
};

export const upsertItemInSheet = async <T extends Exclude<keyof BreweryData, 'COST_COEFFICIENTS' | 'BREWERY_PROFILE' | 'GAS_TANK_CONFIG' | 'DDT_COUNTERS'>>(
    year: string,
    sheet: T,
    item: NonNullable<BreweryData[T]>[number],
    uniqueKey: keyof NonNullable<BreweryData[T]>[number]
) => {
    const data = await getBreweryData(year) || getDefaultData();
    const sheetData = ((data[sheet] as any[]) || []).slice();
    const index = sheetData.findIndex(i => i[uniqueKey] === (item as any)[uniqueKey]);
    if (index > -1) sheetData[index] = item;
    else sheetData.push(item);
    data[sheet] = sheetData as BreweryData[T];
    await saveBreweryData(year, data);
};

export const updateClientWithCascade = async (year: string, updatedClient: Cliente) => {
    const data = await getBreweryData(year) || getDefaultData();
    const existingIndex = (data.CLIENTI || []).findIndex(c => c.id === updatedClient.id);
    const oldName = existingIndex > -1 ? data.CLIENTI[existingIndex].nome : null;
    const newName = updatedClient.nome.trim();
    const cleanClient: Cliente = { ...updatedClient, nome: newName };

    if (existingIndex > -1) {
        data.CLIENTI[existingIndex] = cleanClient;
    } else {
        data.CLIENTI.push(cleanClient);
    }

    if (oldName && oldName !== newName) {
        data.COTTE_HEAD = (data.COTTE_HEAD || []).map(c => c.CLIENTE === oldName ? { ...c, CLIENTE: newName } : c);
        data.BEER_WAREHOUSE_INITIAL = (data.BEER_WAREHOUSE_INITIAL || []).map(i => i.cliente === oldName ? { ...i, cliente: newName } : i);
        data.BEER_MOVEMENTS = (data.BEER_MOVEMENTS || []).map(m => ({
            ...m,
            cliente: m.cliente === oldName ? newName : m.cliente,
            destinatario: m.destinatario === oldName ? newName : m.destinatario,
        }));
        data.SALES_ORDERS = (data.SALES_ORDERS || []).map(o => o.client === oldName ? { ...o, client: newName } : o);
        data.PACKAGED_BEER_ORDERS = (data.PACKAGED_BEER_ORDERS || []).map(o => o.client === oldName ? { ...o, client: newName } : o);
        data.CLIENT_OFFERS = (data.CLIENT_OFFERS || []).map(o =>
            (o.clientId === cleanClient.id || o.clientName === oldName) ? { ...o, clientName: newName } : o
        );
        data.PLANNED_BREWS = (data.PLANNED_BREWS || []).map(pb =>
            (pb.clienteId === cleanClient.id || pb.clienteNome === oldName) ? { ...pb, clienteNome: newName } : pb
        );
        data.QUOTES = (data.QUOTES || []).map(q => q.cliente === oldName ? { ...q, cliente: newName } : q);
        data.BEER_INVENTORY_CHECKS = (data.BEER_INVENTORY_CHECKS || []).map(chk => ({
            ...chk,
            items: (chk.items || []).map(it => it.cliente === oldName ? { ...it, cliente: newName } : it),
        }));
        data.KEG_LOGS = (data.KEG_LOGS || []).map(k =>
            k.cliente === oldName ? { ...k, cliente: newName } : k
        );
        data.SUMMARY_INVOICES = (data.SUMMARY_INVOICES || []).map(inv =>
            inv.cliente === oldName ? { ...inv, cliente: newName } : inv
        );
        data.INTERNAL_TRANSFERS = (data.INTERNAL_TRANSFERS || []).map(tr => ({
            ...tr,
            items: (tr.items || []).map(it => it.cliente === oldName ? { ...it, cliente: newName } : it),
        }));
        data.BEER_LOT_OVERRIDES = (data.BEER_LOT_OVERRIDES || []).map(ov => {
            const parts = ov.key.split('|');
            if (parts[0] === oldName) {
                parts[0] = newName;
                return { ...ov, key: parts.join('|') };
            }
            return ov;
        });
        if (data.BREWERY_PROFILE && data.BREWERY_PROFILE.internalClientName === oldName) {
            data.BREWERY_PROFILE = { ...data.BREWERY_PROFILE, internalClientName: newName };
        }
    }

    await saveBreweryData(year, data);
};

export const parseSteelKegFormat = (format: string): KegFleetFormat | null => {
    const upper = (format || '').toUpperCase().trim();
    if (!upper.includes('ACCIAIO')) return null;
    if (upper.includes('20')) return 'FUSTO ACCIAIO 20L';
    if (upper.includes('24')) return 'FUSTO ACCIAIO 24L';
    if (upper.includes('30')) return 'FUSTO ACCIAIO 30L';
    return null;
};

export const syncOrderSteelKegLogs = (
    data: BreweryData,
    orderId: string,
    date: string,
    clientName: string,
    items: Array<{ format: string; quantity: number; lotto?: string; beerName?: string }>
) => {
    const filtered = (data.KEG_LOGS || []).filter(l => l.relatedOrderId !== orderId);
    const fleetCfg = data.KEG_FLEET_CONFIG || DEFAULT_KEG_FLEET_CONFIG;

    items.forEach((item, idx) => {
        const kegFormat = parseSteelKegFormat(item.format);
        if (!kegFormat || item.quantity <= 0) return;
        const unitDeposit = fleetCfg.find(f => f.formato === kegFormat)?.cauzioneUnitaria || 0;
        filtered.push({
            id: `KEG_ORD_${orderId}_${idx}`,
            data: date,
            tipo: 'CONSEGNA_CLIENTE',
            formato: kegFormat,
            quantita: item.quantity,
            cliente: clientName,
            lotto: item.lotto,
            relatedOrderId: orderId,
            cauzioneTotale: item.quantity * unitDeposit,
            note: item.beerName ? `Consegna ordine (${item.beerName})` : 'Consegna da ordine DDT',
        });
    });

    data.KEG_LOGS = filtered;
};

export const removeOrderSteelKegLogs = (data: BreweryData, orderId: string) => {
    data.KEG_LOGS = (data.KEG_LOGS || []).filter(l => l.relatedOrderId !== orderId);
};

export const upsertBeerWithCascade = async (year: string, birraToSave: Birra) => {
    const data = await getBreweryData(year) || getDefaultData();
    const existingIndex = (data.BIRRE || []).findIndex(b => b.id === birraToSave.id);
    const oldBeer = existingIndex > -1 ? data.BIRRE[existingIndex] : null;
    const oldName = oldBeer?.nomeBirra || null;
    const newName = birraToSave.nomeBirra.trim();
    const cleanBeer: Birra = { ...birraToSave, nomeBirra: newName };

    if (existingIndex > -1) {
        data.BIRRE[existingIndex] = cleanBeer;
    } else {
        data.BIRRE.push(cleanBeer);
    }

    if (oldName && oldName !== newName) {
        const ownerName = (data.CLIENTI || []).find(c => c.id === cleanBeer.clienteId)?.nome;
        const matchesClient = (cName: string) => !ownerName || cName === ownerName;

        data.COTTE_HEAD = (data.COTTE_HEAD || []).map(c =>
            (c.NOME_BIRRA === oldName && matchesClient(c.CLIENTE)) ? { ...c, NOME_BIRRA: newName } : c
        );
        data.BEER_WAREHOUSE_INITIAL = (data.BEER_WAREHOUSE_INITIAL || []).map(i =>
            (i.nomeBirra === oldName && matchesClient(i.cliente)) ? { ...i, nomeBirra: newName } : i
        );
        data.BEER_MOVEMENTS = (data.BEER_MOVEMENTS || []).map(m =>
            m.nomeBirra === oldName ? { ...m, nomeBirra: newName } : m
        );
        data.SALES_ORDERS = (data.SALES_ORDERS || []).map(o => ({
            ...o,
            items: (o.items || []).map(it => ({
                ...it,
                beerName: it.beerName === oldName ? newName : it.beerName,
                customBeerName: it.customBeerName === oldName ? newName : it.customBeerName,
            })),
        }));
        data.PACKAGED_BEER_ORDERS = (data.PACKAGED_BEER_ORDERS || []).map(o => ({
            ...o,
            items: (o.items || []).map(it => it.beerName === oldName ? { ...it, beerName: newName } : it),
        }));
        data.BEER_PRICE_LIST = (data.BEER_PRICE_LIST || []).map(p =>
            p.beerName === oldName ? { ...p, beerName: newName } : p
        );
        data.CLIENT_OFFERS = (data.CLIENT_OFFERS || []).map(o => {
            if (!o.prices || !o.prices[oldName]) return o;
            const nextPrices = { ...o.prices, [newName]: o.prices[oldName] };
            delete nextPrices[oldName];
            return { ...o, prices: nextPrices };
        });
        data.PLANNED_BREWS = (data.PLANNED_BREWS || []).map(pb =>
            (pb.birraId === cleanBeer.id || pb.birraNome === oldName) ? { ...pb, birraNome: newName } : pb
        );
        data.QUOTES = (data.QUOTES || []).map(q =>
            (q.nomeBirra === oldName && matchesClient(q.cliente)) ? { ...q, nomeBirra: newName } : q
        );
        data.BEER_INVENTORY_CHECKS = (data.BEER_INVENTORY_CHECKS || []).map(chk => ({
            ...chk,
            items: (chk.items || []).map(it =>
                (it.nomeBirra === oldName && matchesClient(it.cliente)) ? { ...it, nomeBirra: newName } : it
            ),
        }));
        data.INTERNAL_TRANSFERS = (data.INTERNAL_TRANSFERS || []).map(tr => ({
            ...tr,
            items: (tr.items || []).map(it =>
                (it.nomeBirra === oldName && matchesClient(it.cliente)) ? { ...it, nomeBirra: newName } : it
            ),
        }));
        data.BEER_LOT_OVERRIDES = (data.BEER_LOT_OVERRIDES || []).map(ov => {
            const parts = ov.key.split('|');
            if (parts[1] === oldName && matchesClient(parts[0])) {
                parts[1] = newName;
                return { ...ov, key: parts.join('|') };
            }
            return ov;
        });
    }

    await saveBreweryData(year, data);
};

export const deleteItemFromSheetById = async <T extends Exclude<keyof BreweryData, 'COST_COEFFICIENTS' | 'BREWERY_PROFILE' | 'GAS_TANK_CONFIG' | 'DDT_COUNTERS'>>(
    year: string,
    sheet: T,
    itemId: string,
    idKey: keyof NonNullable<BreweryData[T]>[number] = 'id' as any
) => {
    const data = await getBreweryData(year);
    if (!data) return;
    const sheetData = (data[sheet] as any[]) || [];
    const updatedSheetData = sheetData.filter(item => item[idKey] !== itemId);
    data[sheet] = updatedSheetData as BreweryData[T];
    await saveBreweryData(year, data);
};

export const getSheetData = async <T extends BrewerySheet>(year: string, sheet: T): Promise<BreweryData[T]> => {
    const data = await getBreweryData(year);
    return data?.[sheet] || getDefaultData()[sheet];
};

export const getAllBreweryData = async (): Promise<Record<string, BreweryData>> => {
    const allData: Record<string, BreweryData> = {};
    const db = await getDb();
    const years = await db.getAllKeys('brewery_data');
    for (const year of years) {
        const data = await getBreweryData(year);
        if (data) allData[year] = data;
    }
    return allData;
};

export const importAllBreweryData = async (rawPayload: unknown): Promise<{ importedYears: string[]; hadLegacyMissingModules: boolean }> => {
    if (typeof rawPayload !== 'object' || rawPayload === null) {
        throw new Error('Formato file di backup non valido.');
    }

    const payloadObj = rawPayload as Record<string, any>;
    // Supporta sia backup multi-anno { "2024": {...}, "2025": {...} }, sia backup wrappati { data: { "2025": {...} } }, sia backup singolo anno
    let candidateMap: Record<string, any> = payloadObj;
    if (payloadObj.data && typeof payloadObj.data === 'object' && Object.keys(payloadObj.data).some(k => /^\d{4}$/.test(k))) {
        candidateMap = payloadObj.data;
    }

    const yearEntries: Array<[string, BreweryData]> = [];
    for (const key of Object.keys(candidateMap)) {
        if (/^\d{4}$/.test(key) && typeof candidateMap[key] === 'object' && candidateMap[key] !== null) {
            yearEntries.push([key, candidateMap[key] as BreweryData]);
        }
    }

    // Fallback se il JSON fosse l'esportazione diretta di un singolo anno (senza chiave "2025" esterna)
    if (yearEntries.length === 0 && (Array.isArray(payloadObj.MOVIMENTAZIONE) || Array.isArray(payloadObj.COTTE_HEAD))) {
        let inferredYear = new Date().getFullYear().toString();
        const firstBrewDate = payloadObj.COTTE_HEAD?.[0]?.DATA_PROD || payloadObj.MOVIMENTAZIONE?.[0]?.DATA;
        if (typeof firstBrewDate === 'string') {
            const m = firstBrewDate.match(/(\d{4})/);
            if (m) inferredYear = m[1];
        }
        yearEntries.push([inferredYear, payloadObj as BreweryData]);
    }

    if (yearEntries.length === 0) {
        throw new Error('Nessun archivio annuale valido trovato nel file di backup.');
    }

    const db = await getDb();
    await db.clear('brewery_data');
    const importedYears: string[] = [];
    let hadLegacyMissingModules = false;

    for (const [year, rawYearData] of yearEntries) {
        const defaults = getDefaultData();

        // Rileva se il backup proviene da una versione precedente che non aveva ancora Fusti, Cisterna Gas o Bombole CO2/N2/Ar configurati
        const missingKegs = !Array.isArray(rawYearData.KEG_FLEET_CONFIG) || rawYearData.KEG_FLEET_CONFIG.every(k => !k.dotazioneTotale);
        const missingGas = !rawYearData.GAS_TANK_CONFIG || (!rawYearData.GAS_TANK_CONFIG.litriInizialiAnno && !(Array.isArray(rawYearData.GAS_REFILLS) && rawYearData.GAS_REFILLS.length > 0));
        const missingTechGas = !Array.isArray(rawYearData.TECH_GAS_CONFIG);
        if (missingKegs || missingGas || missingTechGas) {
            hadLegacyMissingModules = true;
        }

        const safeArray = <T>(val: unknown, fallback: T[] = []): T[] => (Array.isArray(val) ? val : fallback);

        // Normalizzazione sicura al 100% retrocompatibile: preserva ogni singolo dato storico e aggiunge i default ai nuovi moduli
        const normalizedYearData: BreweryData = {
            ...defaults,
            ...rawYearData,
            MOVIMENTAZIONE: safeArray(rawYearData.MOVIMENTAZIONE),
            DATABASE: safeArray(rawYearData.DATABASE),
            MAGAZZINO: safeArray(rawYearData.MAGAZZINO),
            COTTE_HEAD: safeArray(rawYearData.COTTE_HEAD),
            FERMENTAZIONE: safeArray(rawYearData.FERMENTAZIONE),
            CANTINA_CONFIG: safeArray(rawYearData.CANTINA_CONFIG),
            CLIENTI: safeArray(rawYearData.CLIENTI),
            BIRRE: safeArray(rawYearData.BIRRE),
            PRICE_DATABASE: safeArray(rawYearData.PRICE_DATABASE),
            QUOTES: safeArray(rawYearData.QUOTES),
            SALES_ORDERS: safeArray(rawYearData.SALES_ORDERS),
            PACKAGED_BEER_ORDERS: safeArray(rawYearData.PACKAGED_BEER_ORDERS),
            BEER_INVENTORY_CHECKS: safeArray(rawYearData.BEER_INVENTORY_CHECKS),
            BEER_PRICE_LIST: safeArray(rawYearData.BEER_PRICE_LIST),
            CLIENT_OFFERS: safeArray(rawYearData.CLIENT_OFFERS),
            CALENDAR_NOTES: safeArray(rawYearData.CALENDAR_NOTES),
            PLANNED_BREWS: safeArray(rawYearData.PLANNED_BREWS),
            MAINTENANCE_PLANS: safeArray(rawYearData.MAINTENANCE_PLANS),
            MAINTENANCE_LOGS: safeArray(rawYearData.MAINTENANCE_LOGS),
            KEG_LOGS: safeArray(rawYearData.KEG_LOGS),
            SUMMARY_INVOICES: safeArray(rawYearData.SUMMARY_INVOICES),
            BEER_LOT_OVERRIDES: safeArray(rawYearData.BEER_LOT_OVERRIDES),
            INTERNAL_TRANSFERS: safeArray(rawYearData.INTERNAL_TRANSFERS),
            GAS_REFILLS: safeArray(rawYearData.GAS_REFILLS),
            TECH_GAS_LOGS: safeArray(rawYearData.TECH_GAS_LOGS),
            BREWERY_PROFILE: getEffectiveBreweryProfile(rawYearData),
            GAS_TANK_CONFIG: getEffectiveGasTankConfig(rawYearData),
            TECH_GAS_CONFIG: getEffectiveTechGasConfig(rawYearData),
            KEG_FLEET_CONFIG: (Array.isArray(rawYearData.KEG_FLEET_CONFIG) && rawYearData.KEG_FLEET_CONFIG.length > 0)
                ? rawYearData.KEG_FLEET_CONFIG
                : DEFAULT_KEG_FLEET_CONFIG.map(k => ({ ...k })),
            BEER_WAREHOUSE_INITIAL: safeArray<InitialBeerStock>(rawYearData.BEER_WAREHOUSE_INITIAL).map(item => ({
                ...item,
                location: item.location || 'MAGAZZINO_CENTRALE',
            })),
            CONFEZIONAMENTO: safeArray<PackagingData>(rawYearData.CONFEZIONAMENTO).map(pkg => ({
                ...pkg,
                initialLocation: pkg.initialLocation || 'MAGAZZINO_CENTRALE',
            })),
            BEER_MOVEMENTS: safeArray(rawYearData.BEER_MOVEMENTS).map((mov: any) => ({
                ...mov,
                location: mov.location || (mov.type === 'BREWERY_TO_CENTRAL_OUT' ? 'CELLA_BIRRIFICIO' : 'MAGAZZINO_CENTRALE'),
            })),
            DDT_COUNTERS: {
                sales: rawYearData.DDT_COUNTERS?.sales || 0,
                transfer: rawYearData.DDT_COUNTERS?.transfer || 0,
                waste: rawYearData.DDT_COUNTERS?.waste || 0,
            },
        };

        // Se MOVIMENTAZIONE è presente, riallinea MAGAZZINO e DATABASE per sicurezza
        if (normalizedYearData.MOVIMENTAZIONE.length > 0) {
            const { magazzino, database } = syncWithMovements(normalizedYearData.MOVIMENTAZIONE);
            normalizedYearData.MAGAZZINO = magazzino;
            if (!normalizedYearData.DATABASE || normalizedYearData.DATABASE.length === 0) {
                normalizedYearData.DATABASE = database;
            }
        }

        syncDdtCountersForYear(normalizedYearData, year);

        await saveBreweryData(year, normalizedYearData);
        importedYears.push(year);
    }

    if (typeof window !== 'undefined' && hadLegacyMissingModules) {
        try {
            window.localStorage.setItem('brewpanda_pending_post_import_wizard', '1');
        } catch {
            // Ignora errori storage restrittivi
        }
    }

    return { importedYears: importedYears.sort(), hadLegacyMissingModules };
};

const parseItalianDate = (dateStr: string): Date | null => {
    if (!dateStr) return null;
    const parts = dateStr.split('/');
    if (parts.length === 3) {
        const [day, month, year] = parts.map(Number);
        if (!isNaN(day) && !isNaN(month) && !isNaN(year)) return new Date(year, month - 1, day);
    }
    return null;
};

export const checkAndProcessWarehouseStatus = async (year: string): Promise<WarehouseStatus> => {
    let data = await getBreweryData(year);
    if (!data) return { dischargedItems: [], expiringSoonItems: [], outOfStockItems: [], expiringBeerItems: [] };
    
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const lotStock = new Map<string, number>();
    data.MOVIMENTAZIONE.forEach(m => {
        if (m.NOME && m.LOTTO_FORNITORE) {
            const key = `${m.NOME.toUpperCase()}|${m.LOTTO_FORNITORE.toUpperCase()}`;
            lotStock.set(key, (lotStock.get(key) || 0) + m.KG_LITRI_PZ);
        }
    });

    const uniqueLotsWithScadenza = new Map<string, Movement>();
    data.MOVIMENTAZIONE.filter(m => m.DATA_SCADENZA && m.KG_LITRI_PZ > 0).forEach(m => {
        uniqueLotsWithScadenza.set(`${m.NOME.toUpperCase()}|${m.LOTTO_FORNITORE.toUpperCase()}`, m);
    });

    const dischargedItems: WarehouseStatus['dischargedItems'] = [];
    const expiringSoonItems: WarehouseStatus['expiringSoonItems'] = [];

    uniqueLotsWithScadenza.forEach((movement, key) => {
        const stock = lotStock.get(key) || 0;
        if (stock <= 0.01) return;
        const scadenzaDate = parseItalianDate(movement.DATA_SCADENZA!);
        if (!scadenzaDate) return;
        scadenzaDate.setHours(0,0,0,0);
        const diffDays = Math.ceil((scadenzaDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

        if (diffDays <= 30) {
            // Keep both expired and expiring soon items here. 
            // The UI will handle highlighting expired items in red.
            expiringSoonItems.push({ nome: movement.NOME, lotto: movement.LOTTO_FORNITORE, scadenza: movement.DATA_SCADENZA!, giacenza: stock });
        }
    });

    const finalData = data;
    
    // Custom calculation to find out-of-stock items, since syncWithMovements now filters them out.
    const warehouseMap = new Map<string, number>();
    finalData.MOVIMENTAZIONE.forEach(m => {
        const key = `${m.TIPOLOGIA.toUpperCase().trim()}|${m.NOME.toUpperCase().trim()}|${(m.MARCA || '').toUpperCase().trim()}|${(m.FORNITORE || '').toUpperCase().trim()}`;
        warehouseMap.set(key, (warehouseMap.get(key) || 0) + m.KG_LITRI_PZ);
    });

    const outOfStockItems: WarehouseStatus['outOfStockItems'] = [];
    warehouseMap.forEach((giacenza, key) => {
        if (giacenza <= 0.01) {
            const [tipologia, nome, marca, fornitore] = key.split('|');
            outOfStockItems.push({ nome, marca, fornitore, tipologia });
        }
    });


    // Calculate expiring and expired beer items across both CELLA_BIRRIFICIO and MAGAZZINO_CENTRALE
    const dualStock = computeDualLocationBeerStock(finalData);
    const aggregatedByLotFmt = new Map<string, { cliente: string; birra: string; lotto: string; formato: string; scadenza: string; qta: number }>();
    dualStock.allPositiveStock.forEach(item => {
        if (!item.dataScadenza) return;
        const key = `${item.cliente}|${item.nomeBirra}|${item.lotto}|${item.formato}`;
        const existing = aggregatedByLotFmt.get(key);
        if (existing) {
            existing.qta += item.quantita;
        } else {
            aggregatedByLotFmt.set(key, {
                cliente: item.cliente,
                birra: item.nomeBirra,
                lotto: item.lotto,
                formato: item.formato,
                scadenza: item.dataScadenza,
                qta: item.quantita,
            });
        }
    });

    const expiringBeerItems: WarehouseStatus['expiringBeerItems'] = [];
    aggregatedByLotFmt.forEach(stockInfo => {
        if (stockInfo.qta <= 0) return;
        const scadenzaDate = parseItalianDate(stockInfo.scadenza);
        if (!scadenzaDate) return;
        scadenzaDate.setHours(0, 0, 0, 0);
        const diffDays = Math.ceil((scadenzaDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        if (diffDays <= 90) {
            expiringBeerItems.push(stockInfo);
        }
    });

    expiringBeerItems.sort((a, b) => {
        const dA = parseItalianDate(a.scadenza)?.getTime() || 0;
        const dB = parseItalianDate(b.scadenza)?.getTime() || 0;
        return dA - dB;
    });

    return { dischargedItems, expiringSoonItems, outOfStockItems, expiringBeerItems };
};

export const checkLottoExists = async (year: string, lottoId: string): Promise<boolean> => {
    const data = await getBreweryData(year);
    if (!data || !data.COTTE_HEAD) return false;
    return data.COTTE_HEAD.some(cotta => cotta.LOTTO.toUpperCase() === lottoId.toUpperCase());
};

export const updatePriceInDb = async (year: string, itemIdentifier: { NOME: string, MARCA: string, FORNITORE: string }, newPrice: number) => {
    const data = await getBreweryData(year);
    if (!data) return;

    const priceDb = data.PRICE_DATABASE || [];
    const index = priceDb.findIndex(p => 
        p.NOME === itemIdentifier.NOME &&
        p.MARCA === itemIdentifier.MARCA &&
        p.FORNITORE === itemIdentifier.FORNITORE
    );

    const today = new Date().toLocaleDateString('it-IT');

    if (index > -1) {
        priceDb[index].PREZZO = newPrice;
        priceDb[index].DATA_ULTIMO_CARICO = today;
    } else {
        priceDb.push({
            ...itemIdentifier,
            PREZZO: newPrice,
            DATA_ULTIMO_CARICO: today,
        });
    }

    await saveDataToSheet(year, 'PRICE_DATABASE', priceDb);
};

export const editWarehouseItem = async (year: string, oldItem: RawWarehouseItem, newItem: Omit<RawWarehouseItem, 'GIACENZA'>) => {
    const data = await getBreweryData(year);
    if (!data) return;

    data.MOVIMENTAZIONE = data.MOVIMENTAZIONE.map(mov => {
        if (
            mov.TIPOLOGIA.toUpperCase().trim() === oldItem.TIPOLOGIA.toUpperCase().trim() &&
            mov.NOME.toUpperCase().trim() === oldItem.NOME.toUpperCase().trim() &&
            (mov.MARCA || '').toUpperCase().trim() === (oldItem.MARCA || '').toUpperCase().trim() &&
            (mov.FORNITORE || '').toUpperCase().trim() === (oldItem.FORNITORE || '').toUpperCase().trim()
        ) {
            return { ...mov, ...newItem };
        }
        return mov;
    });

    data.PRICE_DATABASE = data.PRICE_DATABASE.map(price => {
        if (
            price.NOME.toUpperCase().trim() === oldItem.NOME.toUpperCase().trim() &&
            (price.MARCA || '').toUpperCase().trim() === (oldItem.MARCA || '').toUpperCase().trim() &&
            (price.FORNITORE || '').toUpperCase().trim() === (oldItem.FORNITORE || '').toUpperCase().trim()
        ) {
            return { ...price, NOME: newItem.NOME, MARCA: newItem.MARCA, FORNITORE: newItem.FORNITORE };
        }
        return price;
    });
    
    const { magazzino, database } = syncWithMovements(data.MOVIMENTAZIONE);
    data.MAGAZZINO = magazzino;
    data.DATABASE = database;
    await saveBreweryData(year, data);
};

export const deleteWarehouseItem = async (year: string, itemToDelete: RawWarehouseItem) => {
    const data = await getBreweryData(year);
    if (!data) return;

    if (itemToDelete.GIACENZA >= 0.01) {
        throw new Error("Cannot delete an item with a stock greater than zero.");
    }

    data.MOVIMENTAZIONE = data.MOVIMENTAZIONE.filter(mov => 
        !(
            mov.TIPOLOGIA.toUpperCase().trim() === itemToDelete.TIPOLOGIA.toUpperCase().trim() &&
            mov.NOME.toUpperCase().trim() === itemToDelete.NOME.toUpperCase().trim() &&
            (mov.MARCA || '').toUpperCase().trim() === (itemToDelete.MARCA || '').toUpperCase().trim() &&
            (mov.FORNITORE || '').toUpperCase().trim() === (itemToDelete.FORNITORE || '').toUpperCase().trim()
        )
    );

    data.PRICE_DATABASE = data.PRICE_DATABASE.filter(price =>
        !(
            price.NOME.toUpperCase().trim() === itemToDelete.NOME.toUpperCase().trim() &&
            (price.MARCA || '').toUpperCase().trim() === (itemToDelete.MARCA || '').toUpperCase().trim() &&
            (price.FORNITORE || '').toUpperCase().trim() === (itemToDelete.FORNITORE || '').toUpperCase().trim()
        )
    );

    const { magazzino, database } = syncWithMovements(data.MOVIMENTAZIONE);
    data.MAGAZZINO = magazzino;
    data.DATABASE = database;
    await saveBreweryData(year, data);
};

export const saveCottaAndPackaging = async (year: string, {
    header,
    ingredientMovements,
    packagingMovements,
    newPackagingData,
    replaceIngredients = false
}: {
    header: BrewHeader;
    ingredientMovements: Movement[];
    packagingMovements: Movement[];
    newPackagingData: PackagingData[];
    replaceIngredients?: boolean;
}) => {
    const data = await getBreweryData(year) || getDefaultData();

    // 1. Update Header
    const headerIndex = data.COTTE_HEAD.findIndex(h => h.LOTTO === header.LOTTO);
    if (headerIndex > -1) {
        data.COTTE_HEAD[headerIndex] = header;
    } else {
        data.COTTE_HEAD.push(header);
    }

    // 2. Replace ALL raw material brew discharges for this lot (prevents duplicate deductions even if originally discharged manually or imported)
    if (replaceIngredients && !header.isCarriedOver) {
        const targetLotto = (header.LOTTO || '').toUpperCase().trim();
        const rawBrewCategories = new Set([
            'MALTI', 'MALTO',
            'LUPPOLI', 'LUPPOLO',
            'LIEVITI', 'LIEVITO',
            'ADDITIVI', 'ADDITIVO',
            'SANIFICANTI', 'SANIFICANTE',
            'ZUCCHERO', 'SPEZIE', 'ALTRO'
        ]);
        data.MOVIMENTAZIONE = data.MOVIMENTAZIONE.filter(m => {
            const mLotto = (m.LOTTO_PRODUZIONE || '').toUpperCase().trim();
            if (mLotto !== targetLotto) return true;
            const isBrewInvoice = (m.N_FATTURA || '').toUpperCase().startsWith('SCARICO_COTTA_');
            const isRawCategoryDischarge = m.KG_LITRI_PZ < 0 && rawBrewCategories.has((m.TIPOLOGIA || '').toUpperCase().trim());
            return !(isBrewInvoice || isRawCategoryDischarge);
        });
    }

    // 3. Add all new movements
    data.MOVIMENTAZIONE.push(...ingredientMovements, ...packagingMovements);

    // 4. Add new packaging data
    data.CONFEZIONAMENTO.push(...newPackagingData);

    // 5. Sync warehouse and database
    const { magazzino, database } = syncWithMovements(data.MOVIMENTAZIONE);
    data.MAGAZZINO = magazzino;
    data.DATABASE = database;

    // 6. Save all changes
    await saveBreweryData(year, data);
};

export const updatePackagingTmcWithCascade = async (
    year: string,
    params: {
        lotto: string;
        idOperazione?: string;
        formato: string;
        dataConfezionamento?: string;
        qtaUnita?: number;
        newDataScadenza: string; // DD/MM/YYYY
    }
) => {
    const data = await getBreweryData(year);
    if (!data) throw new Error('Archivio anno non trovato.');

    const targetLotto = (params.lotto || '').trim().toUpperCase();
    const targetFormato = (params.formato || '').trim().toUpperCase();
    let updatedCount = 0;

    data.CONFEZIONAMENTO = (data.CONFEZIONAMENTO || []).map(pkg => {
        const matchById = Boolean(params.idOperazione && pkg.ID_OPERAZIONE === params.idOperazione);
        const matchFallback =
            !params.idOperazione &&
            (pkg.LOTTO_PROD || '').trim().toUpperCase() === targetLotto &&
            (pkg.FORMATO || '').trim().toUpperCase() === targetFormato &&
            (!params.dataConfezionamento || pkg.DATA === params.dataConfezionamento) &&
            (params.qtaUnita === undefined || pkg.QTA_UNITA === params.qtaUnita);

        if (matchById || matchFallback) {
            updatedCount++;
            return {
                ...pkg,
                DATA_SCADENZA: params.newDataScadenza,
            };
        }
        return pkg;
    });

    if (updatedCount === 0) {
        throw new Error('Riga di confezionamento non trovata.');
    }

    // Propaga la nuova scadenza TMC anche a eventuali giacenze iniziali o DDT interni dello stesso lotto+formato
    const sameLotFmtPkgs = (data.CONFEZIONAMENTO || []).filter(
        p =>
            (p.LOTTO_PROD || '').trim().toUpperCase() === targetLotto &&
            (p.FORMATO || '').trim().toUpperCase() === targetFormato
    );
    const allSameTmc = sameLotFmtPkgs.every(p => p.DATA_SCADENZA === params.newDataScadenza);

    if (allSameTmc) {
        data.BEER_WAREHOUSE_INITIAL = (data.BEER_WAREHOUSE_INITIAL || []).map(init =>
            (init.lotto || '').trim().toUpperCase() === targetLotto &&
            (init.formato || '').trim().toUpperCase() === targetFormato
                ? { ...init, dataScadenza: params.newDataScadenza }
                : init
        );

        data.INTERNAL_TRANSFERS = (data.INTERNAL_TRANSFERS || []).map(tr => ({
            ...tr,
            items: (tr.items || []).map(it =>
                (it.lotto || '').trim().toUpperCase() === targetLotto &&
                (it.formato || '').trim().toUpperCase() === targetFormato
                    ? { ...it, dataScadenza: params.newDataScadenza }
                    : it
            ),
        }));
    }

    await saveBreweryData(year, data);
};