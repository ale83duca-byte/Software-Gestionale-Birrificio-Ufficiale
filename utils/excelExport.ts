import * as XLSX from 'xlsx';
import type {
    BreweryData,
    BrewHeader,
    Movement,
    PackagingData,
    FermentationDataPoint,
    PackagedBeerOrder,
    BreweryProfile,
    Cliente,
    KegFleetConfigItem,
    KegFleetFormat,
    SalesOrder,
} from '../types';
import { computeDualLocationBeerStock, computeCleanSalesAndWaste, getUnitLiters } from './beerStockEngine';
import { resolveEffectiveSellingPrice, type ResolvedPriceSource } from './pricingEngine';
import {
    getEffectiveBreweryProfile,
    isInternalOwner,
    DEFAULT_KEG_FLEET_CONFIG,
    parseSteelKegFormat,
} from '../services/dataService';

const headerStyle = { font: { bold: true, color: { rgb: "ECF0F1" } }, fill: { fgColor: { rgb: "34495e" } }, alignment: { horizontal: 'center' } };
const titleStyle = { font: { bold: true, sz: 18 }, alignment: { horizontal: 'center' } };
const sectionTitleStyle = { font: { bold: true, sz: 13, color: { rgb: "1E293B" } }, fill: { fgColor: { rgb: "FDE68A" } } };
const totalLabelStyle = { font: { bold: true }, alignment: { horizontal: 'right' } };
const totalValueStyle = { font: { bold: true, sz: 12 } };
const dossierBannerStyle = {
    font: { bold: true, sz: 15, color: { rgb: "FFFFFF" } },
    fill: { fgColor: { rgb: "1E293B" } },
    alignment: { horizontal: 'center', vertical: 'center' },
};
const dossierSubBannerStyle = {
    font: { italic: true, sz: 10, color: { rgb: "334155" } },
    fill: { fgColor: { rgb: "F1F5F9" } },
    alignment: { horizontal: 'center', vertical: 'center' },
};
const totalRowLabelStyle = {
    font: { bold: true },
    fill: { fgColor: { rgb: "E2E8F0" } },
    alignment: { horizontal: 'right' },
};
const totalRowValueStyle = {
    font: { bold: true, sz: 11 },
    fill: { fgColor: { rgb: "E2E8F0" } },
};

const safeRound2 = (n: number): number => Math.round(((n || 0) + Number.EPSILON) * 100) / 100;
const safeRound1 = (n: number): number => Math.round(((n || 0) + Number.EPSILON) * 10) / 10;

const parseFloatItSafe = (val: string | number | undefined): number => {
    if (typeof val === 'number') return isNaN(val) ? 0 : val;
    if (!val) return 0;
    return parseFloat(String(val).replace(',', '.')) || 0;
};

const getColumnWidths = (data: any[][]): { wch: number }[] => {
    if (!data || data.length === 0) return [];
    
    const widths: { wch: number }[] = [];
    const numCols = data.reduce((max, row) => Math.max(max, (row || []).length), 0);

    for (let C = 0; C < numCols; C++) {
        widths[C] = { wch: 0 };
    }

    data.forEach(row => {
        (row || []).forEach((cell, C) => {
            const cellValue = cell === null || cell === undefined ? '' : String(cell);
            const cellLength = cellValue.length;
            if (widths[C].wch < cellLength) {
                widths[C].wch = cellLength;
            }
        });
    });

    widths.forEach((width, C) => {
        widths[C].wch = Math.min(48, Math.max(12, width.wch + 2));
    });

    return widths;
};


const applyStylesToSheet = (ws: XLSX.WorkSheet, styles: { [cell: string]: any }) => {
    Object.keys(styles).forEach(cellAddress => {
        if (ws[cellAddress]) {
            ws[cellAddress].s = styles[cellAddress];
        } else {
            XLSX.utils.sheet_add_aoa(ws, [[null]], { origin: cellAddress });
            ws[cellAddress].s = styles[cellAddress];
        }
    });
};

export const excel = (data: BreweryData, year: string): void => {
    try {
        exportData(data, year);
    } catch(e) {
        console.error("Failed to export to Excel", e);
    }
};

const colLetter = (idx: number): string => {
    let n = idx;
    let s = '';
    while (n >= 0) {
        s = String.fromCharCode((n % 26) + 65) + s;
        n = Math.floor(n / 26) - 1;
    }
    return s;
};

const PRICE_SOURCE_LABEL: Record<ResolvedPriceSource, string> = {
    PROMO_TMC: 'Promo TMC',
    LOT_CUSTOM: 'Prezzo Lotto',
    CLIENT_OFFER: 'Offerta Cliente',
    BEER_PRICE_LIST: 'Listino Base',
    NONE: 'N/D (Manca Prezzo)',
};

const WASTE_REASON_LABELS: Record<string, string> = {
    SCADENZA_TMC: 'Scadenza TMC',
    OSSIDAZIONE_DIFETTO: 'Ossidazione / Difetto',
    CONTESTAZIONE_CLIENTE: 'Contestazione Cliente',
    ROTTURA_PERDITA: 'Rottura / Perdita',
    CAMPIONATURA_ANALISI: 'Campionatura / Analisi',
};

const KEG_LOG_TYPE_LABELS: Record<string, string> = {
    CONSEGNA_CLIENTE: 'Consegna a Cliente',
    RIENTRO_VUOTO: 'Rientro Vuoto Sporco',
    LAVAGGIO_SANIFICAZIONE: 'Lavaggio & Sanitizzazione CO2',
    RETTIFICA_PARCO: 'Rettifica Dotazione Parco',
};

function appendStyledDossierSheet(
    wb: XLSX.WorkBook,
    sheetName: string,
    aoa: (string | number | null)[][],
    styles: Record<string, any>,
    merges: XLSX.Range[],
    orientation: 'portrait' | 'landscape'
) {
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = getColumnWidths(aoa);
    ws['!merges'] = merges;
    ws['!pageSetup'] = { orientation, paper: 9, fitToWidth: 1, fitToHeight: 0 };
    ws['!margins'] = { left: 0.35, right: 0.35, top: 0.45, bottom: 0.45, header: 0.2, footer: 0.2 };
    applyStylesToSheet(ws, styles);
    XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
}

function addDossierHeaderBlock(
    aoa: (string | number | null)[][],
    styles: Record<string, any>,
    merges: XLSX.Range[],
    numCols: number,
    profile: BreweryProfile,
    docTitle: string,
    year: string
) {
    const lastCol = Math.max(1, numCols - 1);
    const titleRow = aoa.length;
    aoa.push([`${profile.ragioneSociale} — ${docTitle} (Anno ${year})`]);
    styles[`A${titleRow + 1}`] = dossierBannerStyle;
    merges.push({ s: { r: titleRow, c: 0 }, e: { r: titleRow, c: lastCol } });

    const subRow = aoa.length;
    const fiscalBits = [
        profile.indirizzo,
        profile.capCittaProvincia,
        profile.partitaIva ? `P.IVA: ${profile.partitaIva}` : '',
        profile.codiceFiscale ? `C.F.: ${profile.codiceFiscale}` : '',
        profile.codiceAccisa ? `Cod. Accisa: ${profile.codiceAccisa}` : '',
    ].filter(Boolean).join(' • ');
    aoa.push([`${fiscalBits || 'Birrificio Centrale'} — Esportato il ${new Date().toLocaleDateString('it-IT')}`]);
    styles[`A${subRow + 1}`] = dossierSubBannerStyle;
    merges.push({ s: { r: subRow, c: 0 }, e: { r: subRow, c: lastCol } });
    aoa.push([]);
}

function addSectionBanner(
    aoa: (string | number | null)[][],
    styles: Record<string, any>,
    merges: XLSX.Range[],
    numCols: number,
    title: string
) {
    const rowIdx = aoa.length;
    aoa.push([title]);
    styles[`A${rowIdx + 1}`] = sectionTitleStyle;
    merges.push({ s: { r: rowIdx, c: 0 }, e: { r: rowIdx, c: Math.max(0, numCols - 1) } });
}

function addTableHeader(
    aoa: (string | number | null)[][],
    styles: Record<string, any>,
    headers: string[]
) {
    const rowNum = aoa.length + 1;
    aoa.push(headers);
    headers.forEach((_, idx) => {
        styles[`${colLetter(idx)}${rowNum}`] = headerStyle;
    });
}

function exportData(data: BreweryData, year: string) {
    const wb = XLSX.utils.book_new();
    const profile = getEffectiveBreweryProfile(data);

    // Calcoli unificati condivisi con l'app UI
    const dualStock = computeDualLocationBeerStock(data);
    const cleanSales = computeCleanSalesAndWaste(data);

    const packagingByLot = new Map<string, number>();
    (data.CONFEZIONAMENTO || []).forEach(p => {
        packagingByLot.set(p.LOTTO_PROD, (packagingByLot.get(p.LOTTO_PROD) || 0) + (p.LITRI_TOT || 0));
    });

    // Produzione (Interna vs BeerFirm)
    const cotte = [...(data.COTTE_HEAD || [])].sort((a, b) => {
        const dA = new Date(a.DATA_PROD.split('/').reverse().join('-')).getTime() || 0;
        const dB = new Date(b.DATA_PROD.split('/').reverse().join('-')).getTime() || 0;
        return dA - dB;
    });

    let prodInternalLiters = 0;
    let prodBeerfirmLiters = 0;
    let totalPackagedLiters = 0;
    cotte.forEach(c => {
        const lf = parseFloatItSafe(c.LITRI_FINALI);
        if (isInternalOwner(data, c.CLIENTE)) prodInternalLiters += lf;
        else prodBeerfirmLiters += lf;
        totalPackagedLiters += packagingByLot.get(c.LOTTO) || 0;
    });

    // Vendite nette per proprietà
    let soldInternalLiters = 0;
    let soldBeerfirmLiters = 0;
    cleanSales.netSalesMovements.forEach(m => {
        const l = Math.abs(m.quantita) * getUnitLiters(m.formato);
        if (isInternalOwner(data, m.cliente)) soldInternalLiters += l;
        else soldBeerfirmLiters += l;
    });
    cleanSales.consignmentReturnMovements.forEach(r => {
        const l = Math.abs(r.quantita) * getUnitLiters(r.formato);
        if (isInternalOwner(data, r.cliente)) soldInternalLiters = Math.max(0, soldInternalLiters - l);
        else soldBeerfirmLiters = Math.max(0, soldBeerfirmLiters - l);
    });

    // Ordini DDT & Incassi da Inventario
    const orders = [...(data.PACKAGED_BEER_ORDERS || [])];
    const orderRevNet = orders.reduce((s, o) => s + (o.totalNet || 0), 0);
    const orderRevGross = orders.reduce((s, o) => s + (o.totalGross || 0), 0);

    const inventoryMovements = cleanSales.netSalesMovements.filter(
        m => m.relatedDocId && m.relatedDocId.startsWith('INVENTORY_')
    );
    const checkDateMap = new Map<string, string>();
    (data.BEER_INVENTORY_CHECKS || []).forEach(chk => checkDateMap.set(`INVENTORY_${chk.id}`, chk.date));

    let invSoldUnits = 0;
    let invSoldLiters = 0;
    let invRevenue = 0;
    const invRowsData = inventoryMovements.map(m => {
        const units = Math.abs(m.quantita) || 0;
        const liters = safeRound1(units * getUnitLiters(m.formato));
        const res = resolveEffectiveSellingPrice({
            data,
            cliente: m.cliente,
            beerName: m.nomeBirra,
            lotto: m.lotto,
            format: m.formato,
        });
        const lineRev = safeRound2(units * res.unitPrice);
        invSoldUnits += units;
        invSoldLiters += liters;
        invRevenue += lineRev;
        return {
            data: checkDateMap.get(m.relatedDocId || '') || m.data,
            rif: (m.relatedDocId || '').replace('INVENTORY_', ''),
            ownership: isInternalOwner(data, m.cliente) ? 'Birrificio Interno' : 'BeerFirm (Terzi)',
            cliente: m.cliente,
            birra: m.nomeBirra,
            lotto: m.lotto,
            formato: m.formato,
            units,
            liters,
            unitPrice: res.unitPrice,
            sourceLabel: PRICE_SOURCE_LABEL[res.source],
            lineRev,
        };
    });

    cleanSales.consignmentReturnMovements.forEach(ret => {
        if (!ret.relatedDocId || !ret.relatedDocId.startsWith('INVENTORY_')) return;
        const res = resolveEffectiveSellingPrice({
            data,
            cliente: ret.cliente,
            beerName: ret.nomeBirra,
            lotto: ret.lotto,
            format: ret.formato,
        });
        invRevenue = Math.max(0, invRevenue - safeRound2(Math.abs(ret.quantita) * res.unitPrice));
    });

    // Giacenza Birra Finita & Valore di Mercato
    let cellarUnits = 0, cellarLiters = 0, cellarValue = 0;
    let centralUnits = 0, centralLiters = 0, centralValue = 0;
    let stockValueInternal = 0, stockValueBeerfirm = 0;

    const stockRowsData = dualStock.allPositiveStock.map(item => {
        const liters = safeRound1(item.quantita * getUnitLiters(item.formato));
        const res = resolveEffectiveSellingPrice({
            data,
            cliente: item.cliente,
            beerName: item.nomeBirra,
            lotto: item.lotto,
            format: item.formato,
        });
        const mktVal = safeRound2(item.quantita * res.unitPrice);
        const isInt = isInternalOwner(data, item.cliente);

        if (item.location === 'CELLA_BIRRIFICIO') {
            cellarUnits += item.quantita;
            cellarLiters += liters;
            cellarValue += mktVal;
        } else {
            centralUnits += item.quantita;
            centralLiters += liters;
            centralValue += mktVal;
        }
        if (isInt) stockValueInternal += mktVal;
        else stockValueBeerfirm += mktVal;

        return {
            polo: item.location === 'CELLA_BIRRIFICIO' ? 'Cella Birrificio' : 'Magazzino Centrale',
            ownership: isInt ? 'Birrificio Interno' : 'BeerFirm (Terzi)',
            cliente: item.cliente,
            birra: item.nomeBirra,
            lotto: item.lotto,
            formato: item.formato,
            quantita: item.quantita,
            liters,
            scadenza: item.dataScadenza || 'N/D',
            unitPrice: res.unitPrice,
            sourceLabel: PRICE_SOURCE_LABEL[res.source],
            mktVal,
        };
    });

    // Parco Fusti Inox (identico a KegTrackingView)
    const STEEL_FORMATS: KegFleetFormat[] = ['FUSTO ACCIAIO 20L', 'FUSTO ACCIAIO 24L', 'FUSTO ACCIAIO 30L'];
    const cfgList: KegFleetConfigItem[] = STEEL_FORMATS.map(fmt => {
        const found = (data.KEG_FLEET_CONFIG || []).find(c => c.formato === fmt);
        const def = DEFAULT_KEG_FLEET_CONFIG.find(c => c.formato === fmt)!;
        return found ? { ...def, ...found } : { ...def };
    });

    const kegStockMap = new Map<string, { formato: KegFleetFormat; qty: number }>();
    const addKegQty = (lotto: string, formato: string, delta: number) => {
        const kf = parseSteelKegFormat(formato);
        if (!kf) return;
        const k = `${lotto}|${kf}`;
        const cur = kegStockMap.get(k) || { formato: kf, qty: 0 };
        cur.qty += delta;
        kegStockMap.set(k, cur);
    };
    (data.BEER_WAREHOUSE_INITIAL || []).forEach(i => addKegQty(i.lotto, i.formato, i.quantita));
    (data.CONFEZIONAMENTO || []).forEach(p => addKegQty(p.LOTTO_PROD, p.FORMATO, p.QTA_UNITA));
    (data.BEER_MOVEMENTS || []).forEach(m => addKegQty(m.lotto, m.formato, m.quantita));

    const kegFull: Record<KegFleetFormat, number> = { 'FUSTO ACCIAIO 20L': 0, 'FUSTO ACCIAIO 24L': 0, 'FUSTO ACCIAIO 30L': 0 };
    kegStockMap.forEach(({ formato, qty }) => { if (qty > 0) kegFull[formato] += qty; });

    const parseKegDate = (s: string) => {
        const parts = (s || '').split('/');
        return parts.length === 3 ? new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0])).getTime() : 0;
    };
    const sortedKegLogs = [...(data.KEG_LOGS || [])].sort((a, b) => parseKegDate(a.data) - parseKegDate(b.data));
    const kegClientQueues = new Map<string, number>();
    const kegDirty: Record<KegFleetFormat, number> = { 'FUSTO ACCIAIO 20L': 0, 'FUSTO ACCIAIO 24L': 0, 'FUSTO ACCIAIO 30L': 0 };
    const kegWashed: Record<KegFleetFormat, number> = { 'FUSTO ACCIAIO 20L': 0, 'FUSTO ACCIAIO 24L': 0, 'FUSTO ACCIAIO 30L': 0 };
    const kegAdj: Record<KegFleetFormat, number> = { 'FUSTO ACCIAIO 20L': 0, 'FUSTO ACCIAIO 24L': 0, 'FUSTO ACCIAIO 30L': 0 };

    sortedKegLogs.forEach(log => {
        const fmt = log.formato;
        if (!STEEL_FORMATS.includes(fmt)) return;
        if (log.tipo === 'CONSEGNA_CLIENTE' && log.cliente && log.quantita > 0) {
            const k = `${log.cliente.trim().toUpperCase()}|${fmt}`;
            kegClientQueues.set(k, (kegClientQueues.get(k) || 0) + log.quantita);
        } else if (log.tipo === 'RIENTRO_VUOTO' && log.quantita > 0) {
            kegDirty[fmt] += log.quantita;
            let rem = log.quantita;
            const deductKey = (qk: string) => {
                if (rem <= 0) return;
                const avail = kegClientQueues.get(qk) || 0;
                if (avail > 0) {
                    const take = Math.min(avail, rem);
                    kegClientQueues.set(qk, avail - take);
                    rem -= take;
                }
            };
            if (log.cliente?.trim()) deductKey(`${log.cliente.trim().toUpperCase()}|${fmt}`);
            deductKey(`CLIENTI VARI / CONTO VENDITA|${fmt}`);
            if (rem > 0) {
                for (const [qk] of kegClientQueues.entries()) {
                    if (rem <= 0) break;
                    if (qk.endsWith(`|${fmt}`)) deductKey(qk);
                }
            }
        } else if (log.tipo === 'LAVAGGIO_SANIFICAZIONE' && log.quantita > 0) {
            kegWashed[fmt] += log.quantita;
            kegDirty[fmt] = Math.max(0, kegDirty[fmt] - log.quantita);
        } else if (log.tipo === 'RETTIFICA_PARCO') {
            kegAdj[fmt] += log.quantita;
        }
    });

    const kegOut: Record<KegFleetFormat, number> = { 'FUSTO ACCIAIO 20L': 0, 'FUSTO ACCIAIO 24L': 0, 'FUSTO ACCIAIO 30L': 0 };
    kegClientQueues.forEach((qty, key) => {
        const fmt = key.slice(key.lastIndexOf('|') + 1) as KegFleetFormat;
        if (qty > 0 && fmt in kegOut) kegOut[fmt] += qty;
    });

    const kegSummaryRows = cfgList.map(cfg => {
        const fleet = Math.max(0, cfg.dotazioneTotale + kegAdj[cfg.formato]);
        const pieni = kegFull[cfg.formato];
        const fuori = kegOut[cfg.formato];
        const sporchi = kegDirty[cfg.formato];
        const lavatiPronti = fleet > 0
            ? Math.max(0, fleet - pieni - fuori - sporchi)
            : Math.max(0, cfg.vuotiLavatiIniziali + kegWashed[cfg.formato]);
        return { formato: cfg.formato, fleet, pieni, fuori, sporchi, lavatiPronti, cauzione: cfg.cauzioneUnitaria };
    });

    // Fatture Riepilogative
    const invoices = [...(data.SUMMARY_INVOICES || [])];
    const invTotDoc = invoices.reduce((s, f) => s + (f.totaleDocumento || 0), 0);
    const invPaidDoc = invoices.filter(f => f.statoPagamento === 'INCASSATA').reduce((s, f) => s + (f.totaleDocumento || 0), 0);
    const invDueDoc = Math.max(0, invTotDoc - invPaidDoc);

    // =========================================================================
    // FOGLIO 1: RIEPILOGO ANNUALE (DOSSIER ESECUTIVO A4)
    // =========================================================================
    {
        const aoa: (string | number | null)[][] = [];
        const styles: Record<string, any> = {};
        const merges: XLSX.Range[] = [];
        const COLS = 4;

        addDossierHeaderBlock(aoa, styles, merges, COLS, profile, 'DOSSIER ANNUALE PRODUZIONE, VENDITE & MAGAZZINO', year);

        addSectionBanner(aoa, styles, merges, COLS, '1. ANAGRAFICA FISCALE BIRRIFICIO CENTRALE');
        addTableHeader(aoa, styles, ['Campo Aziendale', 'Valore Registrato', 'Campo Fiscale / Banca', 'Valore Registrato']);
        aoa.push(['Ragione Sociale', profile.ragioneSociale, 'Partita IVA', profile.partitaIva || 'N/D']);
        aoa.push(['Indirizzo Sede', `${profile.indirizzo || 'N/D'} ${profile.capCittaProvincia || ''}`.trim(), 'Codice Fiscale', profile.codiceFiscale || 'N/D']);
        aoa.push(['Codice Accisa', profile.codiceAccisa || 'N/D', 'Codice SDI / PEC', `${profile.codiceUnivocoSdi || 'N/D'} / ${profile.pec || 'N/D'}`]);
        aoa.push(['Email / Telefono', `${profile.email || 'N/D'} • ${profile.telefono || 'N/D'}`, 'IBAN Aziendale', profile.iban || 'N/D']);
        aoa.push([]);

        addSectionBanner(aoa, styles, merges, COLS, `2. PRODUZIONE ANNUALE (${year}) — BIRRIFICIO VS BEERFIRM`);
        addTableHeader(aoa, styles, ['Indicatore Produzione', 'Valore', 'Dettaglio / Note', 'Quota %']);
        const totProdL = prodInternalLiters + prodBeerfirmLiters;
        aoa.push(['Totale Cotte Registrate', cotte.length, 'Lotti inseriti nel registro anno', '100%']);
        aoa.push(['Litri Finali Prodotti (Totali)', safeRound1(totProdL), 'Birrificio Interno + Conto Terzi BeerFirm', '100%']);
        aoa.push(['  • Birre Interne Birrificio', safeRound1(prodInternalLiters), `Associato a: ${profile.internalClientName}`, totProdL > 0 ? `${safeRound1((prodInternalLiters / totProdL) * 100)}%` : '0%']);
        aoa.push(['  • Clienti BeerFirm (Conto Terzi)', safeRound1(prodBeerfirmLiters), 'Produzioni per committenti esterni', totProdL > 0 ? `${safeRound1((prodBeerfirmLiters / totProdL) * 100)}%` : '0%']);
        aoa.push(['Litri Confezionati nell\'Anno', safeRound1(totalPackagedLiters), 'Fusti inox, KeyKeg, Bottiglie & Lattine', '-']);
        aoa.push([]);

        addSectionBanner(aoa, styles, merges, COLS, `3. VENDITE, SCARTI & PROSPETTO INCASSI (${year})`);
        addTableHeader(aoa, styles, ['Voce Commerciale / Incasso', 'Quantità / Litri', 'Valore Netto (€)', 'Note']);
        const totSoldNet = soldInternalLiters + soldBeerfirmLiters;
        aoa.push(['Litri Venduti Netti Totali', safeRound1(totSoldNet), safeRound2(orderRevNet + invRevenue), 'Al netto dei resi conto vendita/fiere']);
        aoa.push(['  • Vendite Birrificio Interno (L)', safeRound1(soldInternalLiters), '-', totSoldNet > 0 ? `${safeRound1((soldInternalLiters / totSoldNet) * 100)}% vol.` : '0%']);
        aoa.push(['  • Uscite BeerFirm / Terzi (L)', safeRound1(soldBeerfirmLiters), '-', totSoldNet > 0 ? `${safeRound1((soldBeerfirmLiters / totSoldNet) * 100)}% vol.` : '0%']);
        aoa.push([`Ordini & DDT Vendita (${orders.length} doc.)`, '-', safeRound2(orderRevNet), `Totale ivato doc: € ${safeRound2(orderRevGross).toFixed(2)}`]);
        aoa.push([`Vendite Inventario / Scontrini (${invSoldUnits} pz)`, safeRound1(invSoldLiters), safeRound2(invRevenue), 'Disavanzi fisici inventariali valorizzati']);
        aoa.push(['Litri Scartati / Deteriorati (DDT Scarto)', safeRound1(cleanSales.totalWastedLiters), 0, `${cleanSales.wasteMovements.length} movimenti di scarto`]);
        aoa.push([]);

        addSectionBanner(aoa, styles, merges, COLS, '4. GIACENZE BIRRA FINITA & VALORE DI MERCATO ATTUALE');
        addTableHeader(aoa, styles, ['Polo / Tipologia Giacenza', 'Pezzi (pz)', 'Litri (L)', 'Valore di Mercato (€)']);
        aoa.push(['Cella Birrificio (Rifermentazione)', cellarUnits, safeRound1(cellarLiters), safeRound2(cellarValue)]);
        aoa.push(['Magazzino Centrale (Pronto Vendita)', centralUnits, safeRound1(centralLiters), safeRound2(centralValue)]);
        aoa.push(['  • Quota Proprietà Birrificio Interno', '-', '-', safeRound2(stockValueInternal)]);
        aoa.push(['  • Quota Clienti BeerFirm (Terzi)', '-', '-', safeRound2(stockValueBeerfirm)]);
        const totStockRow = aoa.length + 1;
        aoa.push(['TOTALE GIACENZA BIRRA FINITA', cellarUnits + centralUnits, safeRound1(cellarLiters + centralLiters), safeRound2(cellarValue + centralValue)]);
        styles[`A${totStockRow}`] = totalRowLabelStyle;
        styles[`B${totStockRow}`] = totalRowValueStyle;
        styles[`C${totStockRow}`] = totalRowValueStyle;
        styles[`D${totStockRow}`] = totalRowValueStyle;
        aoa.push([]);

        addSectionBanner(aoa, styles, merges, COLS, '5. SINTESI PARCO FUSTI INOX & FATTURAZIONE');
        addTableHeader(aoa, styles, ['Indicatore', 'Totale', 'Dettaglio Operativo', 'Importo (€)']);
        const totFleet = kegSummaryRows.reduce((s, r) => s + r.fleet, 0);
        const totPieni = kegSummaryRows.reduce((s, r) => s + r.pieni, 0);
        const totFuori = kegSummaryRows.reduce((s, r) => s + r.fuori, 0);
        const totSporchi = kegSummaryRows.reduce((s, r) => s + r.sporchi, 0);
        const totPronti = kegSummaryRows.reduce((s, r) => s + r.lavatiPronti, 0);
        aoa.push(['Parco Fusti Inox (20L / 24L / 30L)', totFleet, `Pieni: ${totPieni} | Clienti: ${totFuori} | Sporchi: ${totSporchi} | Pronti: ${totPronti}`, '-']);
        aoa.push(['Fatture Riepilogative Emesse', invoices.length, `Incassate: € ${safeRound2(invPaidDoc).toFixed(2)} | Da incassare: € ${safeRound2(invDueDoc).toFixed(2)}`, safeRound2(invTotDoc)]);

        appendStyledDossierSheet(wb, 'Riepilogo_Annuale', aoa, styles, merges, 'portrait');
    }

    // =========================================================================
    // FOGLIO 2: COTTE PRODUZIONE
    // =========================================================================
    {
        const aoa: (string | number | null)[][] = [];
        const styles: Record<string, any> = {};
        const merges: XLSX.Range[] = [];
        const headers = ['#', 'Lotto', 'Data Prod.', 'Tipo Proprietà', 'Proprietà / Cliente', 'Nome Birra', 'Tipologia', 'Fermentatore', 'Plato (°P)', 'Litri Finali', 'Litri Confezionati', 'Gas Tot. (m³)', 'Stato Cantina'];

        addDossierHeaderBlock(aoa, styles, merges, headers.length, profile, 'REGISTRO COTTE & PRODUZIONE', year);
        addTableHeader(aoa, styles, headers);

        cotte.forEach((c, idx) => {
            const lf = parseFloatItSafe(c.LITRI_FINALI);
            const lp = safeRound1(packagingByLot.get(c.LOTTO) || 0);
            const gBrew = parseFloatItSafe(c.GAS_COTTA) || Math.max(0, parseFloatItSafe(c.gasBrewCounterCurrent) - parseFloatItSafe(c.gasBrewCounterPrevious));
            const gPkg = parseFloatItSafe(c.GAS_CONFEZIONAMENTO) || Math.max(0, parseFloatItSafe(c.gasPackagingCounterCurrent) - parseFloatItSafe(c.gasPackagingCounterPrevious));
            const gasTot = safeRound2(gBrew + gPkg);
            const stato = c.isCellarClosed ? 'Chiuso' : (c.FERMENTATORE ? `Attivo (${c.FERMENTATORE})` : 'Chiuso');
            aoa.push([
                idx + 1,
                c.LOTTO,
                c.DATA_PROD,
                isInternalOwner(data, c.CLIENTE) ? 'Birrificio Interno' : 'BeerFirm (Terzi)',
                c.CLIENTE,
                c.NOME_BIRRA,
                c.TIPO_BIRRA || '',
                c.FERMENTATORE || 'N/D',
                parseFloatItSafe(c.PLATO_INIZIALE),
                safeRound1(lf),
                lp,
                gasTot,
                stato,
            ]);
        });

        const totRow = aoa.length + 1;
        aoa.push([null, null, null, null, null, null, null, null, 'TOTALI ANNO:', safeRound1(prodInternalLiters + prodBeerfirmLiters), safeRound1(totalPackagedLiters), null, null]);
        styles[`I${totRow}`] = totalRowLabelStyle;
        styles[`J${totRow}`] = totalRowValueStyle;
        styles[`K${totRow}`] = totalRowValueStyle;

        appendStyledDossierSheet(wb, 'Cotte_Produzione', aoa, styles, merges, 'landscape');
    }

    // =========================================================================
    // FOGLIO 3: ORDINI & DDT DI VENDITA
    // =========================================================================
    {
        const aoa: (string | number | null)[][] = [];
        const styles: Record<string, any> = {};
        const merges: XLSX.Range[] = [];
        const headers = ['N° DDT', 'Data', 'Cliente', 'Dettaglio Articoli', 'Imponibile (€)', 'IVA (€)', 'Totale (€)', 'Stato', 'N° Fattura'];

        addDossierHeaderBlock(aoa, styles, merges, headers.length, profile, 'REGISTRO ORDINI & DDT DI VENDITA', year);
        addSectionBanner(aoa, styles, merges, headers.length, 'ORDINI BIRRE CONFEZIONATE (DDT VENDITA)');
        addTableHeader(aoa, styles, headers);

        if (orders.length === 0) {
            aoa.push(['Nessun ordine/DDT vendita birre confezionate registrato nell\'anno.']);
        } else {
            orders.forEach(o => {
                const detail = (o.items || []).map(i => `${i.quantity}x ${i.beerName} (${i.format}, L.${i.lotto})`).join(' | ');
                aoa.push([
                    o.numeroDdt || o.id,
                    o.date,
                    o.client,
                    detail,
                    safeRound2(o.totalNet),
                    safeRound2(o.iva),
                    safeRound2(o.totalGross),
                    o.status || 'DDT_EMESSO',
                    o.invoiceNumber || '-',
                ]);
            });
            const totRow = aoa.length + 1;
            aoa.push([null, null, null, 'TOTALE ORDINI DDT:', safeRound2(orderRevNet), safeRound2(orderRevGross - orderRevNet), safeRound2(orderRevGross), null, null]);
            styles[`D${totRow}`] = totalRowLabelStyle;
            styles[`E${totRow}`] = totalRowValueStyle;
            styles[`F${totRow}`] = totalRowValueStyle;
            styles[`G${totRow}`] = totalRowValueStyle;
        }

        const salesOrders: SalesOrder[] = [...(data.SALES_ORDERS || [])];
        if (salesOrders.length > 0) {
            aoa.push([]);
            addSectionBanner(aoa, styles, merges, headers.length, 'COMMISSIONI & DDT CONSEGNA / CONTO DEPOSITO BEERFIRM');
            addTableHeader(aoa, styles, ['N° DDT', 'Data', 'Cliente / BeerFirm', 'Modalità Consegna', 'Dettaglio Articoli', '-', '-', '-', '-']);
            salesOrders.forEach(so => {
                const detail = (so.items || []).map(i => `${i.quantity}x ${i.customBeerName || i.beerName} (${i.format}, L.${i.lotto})`).join(' | ');
                aoa.push([so.numeroDdt || so.id, so.date, so.client, so.deliveryMode || 'RITIRO_DIRETTO', detail]);
            });
        }

        appendStyledDossierSheet(wb, 'Ordini_DDT_Vendita', aoa, styles, merges, 'landscape');
    }

    // =========================================================================
    // FOGLIO 4: VENDITE DA DISAVANZI INVENTARIO (SCONTRINI / BANCO)
    // =========================================================================
    {
        const aoa: (string | number | null)[][] = [];
        const styles: Record<string, any> = {};
        const merges: XLSX.Range[] = [];
        const headers = ['Data Rilevazione', 'Rif. Controllo', 'Tipo Proprietà', 'Proprietà Stock', 'Birra', 'Lotto', 'Formato', 'Pezzi Mancanti', 'Litri (L)', 'Prezzo Unit. (€)', 'Fonte Prezzo', 'Incasso Stimato (€)'];

        addDossierHeaderBlock(aoa, styles, merges, headers.length, profile, 'PROSPETTO VENDITE DA INVENTARIO (SCONTRINI / SENZA FATTURA)', year);
        addTableHeader(aoa, styles, headers);

        if (invRowsData.length === 0) {
            aoa.push(['Nessuna vendita da controllo inventario registrata nell\'anno.']);
        } else {
            invRowsData.forEach(r => {
                aoa.push([r.data, r.rif, r.ownership, r.cliente, r.birra, r.lotto, r.formato, r.units, r.liters, r.unitPrice, r.sourceLabel, r.lineRev]);
            });
            const totRow = aoa.length + 1;
            aoa.push([null, null, null, null, null, null, 'TOTALE INCASSI INVENTARIO:', invSoldUnits, safeRound1(invSoldLiters), null, null, safeRound2(invRevenue)]);
            styles[`G${totRow}`] = totalRowLabelStyle;
            styles[`H${totRow}`] = totalRowValueStyle;
            styles[`I${totRow}`] = totalRowValueStyle;
            styles[`L${totRow}`] = totalRowValueStyle;
        }

        appendStyledDossierSheet(wb, 'Vendite_Inventario', aoa, styles, merges, 'landscape');
    }

    // =========================================================================
    // FOGLIO 5: GIACENZE BIRRA FINITA & VALORE DI MERCATO
    // =========================================================================
    {
        const aoa: (string | number | null)[][] = [];
        const styles: Record<string, any> = {};
        const merges: XLSX.Range[] = [];
        const headers = ['Polo Magazzino', 'Tipo Proprietà', 'Proprietà / Cliente', 'Nome Birra', 'Lotto', 'Formato', 'Quantità (pz)', 'Litri (L)', 'Scadenza TMC', 'Prezzo Vendita (€)', 'Fonte Prezzo', 'Valore Mercato (€)'];

        addDossierHeaderBlock(aoa, styles, merges, headers.length, profile, 'GIACENZE BIRRA FINITA & VALORE DI MERCATO', year);
        addTableHeader(aoa, styles, headers);

        if (stockRowsData.length === 0) {
            aoa.push(['Nessuna giacenza di birra finita attualmente presente a magazzino.']);
        } else {
            stockRowsData.forEach(s => {
                aoa.push([s.polo, s.ownership, s.cliente, s.birra, s.lotto, s.formato, s.quantita, s.liters, s.scadenza, s.unitPrice, s.sourceLabel, s.mktVal]);
            });
            const totRow = aoa.length + 1;
            aoa.push([null, null, null, null, null, 'TOTALI GIACENZA:', cellarUnits + centralUnits, safeRound1(cellarLiters + centralLiters), null, null, null, safeRound2(cellarValue + centralValue)]);
            styles[`F${totRow}`] = totalRowLabelStyle;
            styles[`G${totRow}`] = totalRowValueStyle;
            styles[`H${totRow}`] = totalRowValueStyle;
            styles[`L${totRow}`] = totalRowValueStyle;
        }

        appendStyledDossierSheet(wb, 'Giacenze_Birra_Finita', aoa, styles, merges, 'landscape');
    }

    // =========================================================================
    // FOGLIO 6: MAGAZZINO MATERIE PRIME
    // =========================================================================
    {
        const aoa: (string | number | null)[][] = [];
        const styles: Record<string, any> = {};
        const merges: XLSX.Range[] = [];
        const headers = ['Categoria / Tipologia', 'Prodotto', 'Marca', 'Fornitore', 'Giacenza Residua'];

        addDossierHeaderBlock(aoa, styles, merges, headers.length, profile, 'GIACENZE MAGAZZINO MATERIE PRIME & IMBALLI', year);
        addTableHeader(aoa, styles, headers);

        const rawItems = [...(data.MAGAZZINO || [])].sort(
            (a, b) => (a.TIPOLOGIA || '').localeCompare(b.TIPOLOGIA || '') || (a.NOME || '').localeCompare(b.NOME || '')
        );
        if (rawItems.length === 0) {
            aoa.push(['Nessuna materia prima in magazzino.']);
        } else {
            rawItems.forEach(item => {
                aoa.push([item.TIPOLOGIA, item.NOME, item.MARCA || '', item.FORNITORE || '', safeRound2(item.GIACENZA)]);
            });
        }

        appendStyledDossierSheet(wb, 'Materie_Prime', aoa, styles, merges, 'portrait');
    }

    // =========================================================================
    // FOGLIO 7: PARCO FUSTI INOX
    // =========================================================================
    {
        const aoa: (string | number | null)[][] = [];
        const styles: Record<string, any> = {};
        const merges: XLSX.Range[] = [];
        const headers = ['Data', 'Operazione', 'Formato', 'Cliente / Origine', 'Quantità', 'Cauzione (€)', 'Note'];

        addDossierHeaderBlock(aoa, styles, merges, headers.length, profile, 'SITUAZIONE PARCO FUSTI INOX & MOVIMENTI', year);

        addSectionBanner(aoa, styles, merges, headers.length, 'STATO ATTUALE PARCO FUSTI INOX');
        addTableHeader(aoa, styles, ['Formato Fusto', 'Dotazione Totale', 'Pieni in Cella', 'Presso Clienti', 'Vuoti Sporchi', 'Vuoti Lavati Pronti', 'Cauzione Unit. (€)']);
        kegSummaryRows.forEach(r => {
            aoa.push([r.formato, r.fleet, r.pieni, r.fuori, r.sporchi, r.lavatiPronti, r.cauzione]);
        });
        aoa.push([]);

        addSectionBanner(aoa, styles, merges, headers.length, 'REGISTRO MOVIMENTI FUSTI INOX');
        addTableHeader(aoa, styles, headers);
        if (sortedKegLogs.length === 0) {
            aoa.push(['Nessun movimento fusti inox registrato nell\'anno.']);
        } else {
            sortedKegLogs.forEach(log => {
                aoa.push([
                    log.data,
                    KEG_LOG_TYPE_LABELS[log.tipo] || log.tipo,
                    log.formato,
                    log.cliente || '-',
                    log.quantita,
                    safeRound2(log.cauzioneTotale || 0),
                    log.note || '',
                ]);
            });
        }

        appendStyledDossierSheet(wb, 'Parco_Fusti', aoa, styles, merges, 'landscape');
    }

    // =========================================================================
    // FOGLIO 8: TRASFERIMENTI INTERNI & SCARTI (DDT PROGRESSIVI)
    // =========================================================================
    {
        const aoa: (string | number | null)[][] = [];
        const styles: Record<string, any> = {};
        const merges: XLSX.Range[] = [];
        const COLS = 9;

        addDossierHeaderBlock(aoa, styles, merges, COLS, profile, 'DDT TRASPORTO INTERNO & DDT SCARTO PRODOTTO', year);

        addSectionBanner(aoa, styles, merges, COLS, '1. DDT DI TRASPORTO INTERNO (BIRRIFICIO ➔ MAGAZZINO CENTRALE)');
        addTableHeader(aoa, styles, ['N° DDT Trasporto', 'Data', 'Origine', 'Destinazione', 'Vettore / Conducente', 'Dettaglio Colli', 'Litri Tot. (L)', 'Note', '-']);
        const transfers = [...(data.INTERNAL_TRANSFERS || [])];
        if (transfers.length === 0) {
            aoa.push(['Nessun DDT di trasferimento interno registrato nell\'anno.']);
        } else {
            transfers.forEach(tr => {
                const detail = (tr.items || []).map(i => `${i.quantita}x ${i.nomeBirra} (${i.formato}, L.${i.lotto})`).join(' | ');
                const totL = safeRound1((tr.items || []).reduce((s, i) => s + (i.litri || 0), 0));
                const transportLabel = [tr.mezzoTrasporto, tr.conducente].filter(Boolean).join(' • ') || 'Trasporto Interno';
                aoa.push([tr.numeroDdt, tr.data, tr.indirizzoPartenza, tr.indirizzoDestinazione, transportLabel, detail, totL, tr.note || '']);
            });
        }
        aoa.push([]);

        addSectionBanner(aoa, styles, merges, COLS, '2. DDT DI SCARTO / DETERIORAMENTO PRODOTTO');
        addTableHeader(aoa, styles, ['N° DDT Scarto', 'Data', 'Polo', 'Proprietà Stock', 'Birra', 'Lotto', 'Formato', 'Causale', 'Litri (L)']);
        if (cleanSales.wasteMovements.length === 0) {
            aoa.push(['Nessun DDT / movimento di scarto registrato nell\'anno.']);
        } else {
            cleanSales.wasteMovements.forEach(w => {
                const l = safeRound1(Math.abs(w.quantita) * getUnitLiters(w.formato));
                aoa.push([
                    w.ddtNumber || '-',
                    w.data,
                    w.location === 'CELLA_BIRRIFICIO' ? 'Cella Birrificio' : 'Magazzino Centrale',
                    w.cliente,
                    w.nomeBirra,
                    w.lotto,
                    w.formato,
                    WASTE_REASON_LABELS[w.wasteReason || 'OSSIDAZIONE_DIFETTO'] || (w.wasteReason || ''),
                    l,
                ]);
            });
        }

        appendStyledDossierSheet(wb, 'Trasf_e_Scarti_DDT', aoa, styles, merges, 'landscape');
    }

    // =========================================================================
    // FOGLIO 9: ACCISE & FATTURE RIEPILOGATIVE
    // =========================================================================
    {
        const aoa: (string | number | null)[][] = [];
        const styles: Record<string, any> = {};
        const merges: XLSX.Range[] = [];
        const headers = ['N° Fattura', 'Data Emissione', 'Scadenza', 'Cliente', 'DDT Inclusi', 'Imponibile (€)', 'IVA (€)', 'Totale (€)', 'Pagamento', 'Stato Incasso', 'Data Incasso'];

        addDossierHeaderBlock(aoa, styles, merges, headers.length, profile, 'REGISTRO FATTURE RIEPILOGATIVE & ACCISE', year);
        addTableHeader(aoa, styles, headers);

        if (invoices.length === 0) {
            aoa.push(['Nessuna fattura riepilogativa emessa nell\'anno.']);
        } else {
            invoices.forEach(f => {
                const ddts = (f.ddtReferences || []).map(d => d.numeroDdt).join(', ') || '-';
                aoa.push([
                    f.numeroFattura,
                    f.dataEmissione,
                    f.dataScadenzaPagamento,
                    f.cliente,
                    ddts,
                    safeRound2(f.imponibileTotale),
                    safeRound2(f.ivaTotale),
                    safeRound2(f.totaleDocumento),
                    f.modalitaPagamento,
                    f.statoPagamento,
                    f.dataIncasso || '-',
                ]);
            });
            const totRow = aoa.length + 1;
            aoa.push([null, null, null, null, 'TOTALI FATTURATO:', safeRound2(invoices.reduce((s, f) => s + f.imponibileTotale, 0)), safeRound2(invoices.reduce((s, f) => s + f.ivaTotale, 0)), safeRound2(invTotDoc), null, null, null]);
            styles[`E${totRow}`] = totalRowLabelStyle;
            styles[`F${totRow}`] = totalRowValueStyle;
            styles[`G${totRow}`] = totalRowValueStyle;
            styles[`H${totRow}`] = totalRowValueStyle;
        }

        appendStyledDossierSheet(wb, 'Accise_e_Fatture', aoa, styles, merges, 'landscape');
    }

    XLSX.writeFile(wb, `birrificio_dossier_${year}.xlsx`);
}

function generateAndDownloadInventory(inventory: Movement[], year: string) {
    const wb = XLSX.utils.book_new();
    const sheetName = 'Inventario Iniziale';

    const ws_data = [
        [`Inventario Iniziale Magazzino - 01/01/${year}`],
        [], 
        ['TIPOLOGIA', 'NOME PRODOTTO', 'MARCA', 'GIACENZA INIZIALE'],
        ...inventory
            .sort((a, b) => a.TIPOLOGIA.localeCompare(b.TIPOLOGIA) || a.NOME.localeCompare(b.NOME))
            .map(item => [item.TIPOLOGIA, item.NOME, item.MARCA, item.KG_LITRI_PZ])
    ];
    
    const ws = XLSX.utils.aoa_to_sheet(ws_data);
    ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 3 } }];
    ws['!cols'] = getColumnWidths(ws_data);
    ws['!pageSetup'] = { orientation: 'portrait', paper: 9 };
    
    applyStylesToSheet(ws, {
        'A1': titleStyle, 'A3': headerStyle, 'B3': headerStyle, 'C3': headerStyle, 'D3': headerStyle
    });

    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    XLSX.writeFile(wb, `inventario_iniziale_${year}.xlsx`);
}


export const exportInventoryToExcel = (inventory: Movement[], year: string): void => {
    try {
        generateAndDownloadInventory(inventory, year);
    } catch(e) {
        console.error("Failed to export inventory to Excel", e);
    }
};

export const exportCostAnalysisToExcel = (
    lotto: BrewHeader,
    rawMaterialsCosts: any,
    otherCosts: any,
    analysisSummary: any,
    packagingAnalysis: { bottles: any[], kegs: any[] } | null
) => {
    const wb = XLSX.utils.book_new();
    let ws_data: (string | number | null)[][] = [];
    const styles: { [cell: string]: any } = {};

    // --- TITLE ---
    ws_data.push([`ANALISI COSTI LOTTO: ${lotto.LOTTO}`]);
    styles[`A${ws_data.length}`] = titleStyle;
    ws_data.push([], []);

    // --- HEADER INFO ---
    ws_data.push(['Cliente:', lotto.CLIENTE, null, 'Nome Birra:', lotto.NOME_BIRRA]);
    styles[`A${ws_data.length}`] = totalLabelStyle; styles[`D${ws_data.length}`] = totalLabelStyle;
    ws_data.push(['Data Produzione:', lotto.DATA_PROD, null, 'Litri Finali:', lotto.LITRI_FINALI]);
    styles[`A${ws_data.length}`] = totalLabelStyle; styles[`D${ws_data.length}`] = totalLabelStyle;
    ws_data.push([], []);

    // --- RAW MATERIALS ---
    ws_data.push(['COSTI MATERIE PRIME']);
    styles[`A${ws_data.length}`] = sectionTitleStyle;
    ws_data.push(['Ingrediente', 'Q.tà Usata', 'Prezzo Unit.', 'Costo Totale']);
    ['A','B','C','D'].forEach(c => styles[`${c}${ws_data.length}`] = headerStyle);
    
    Object.keys(rawMaterialsCosts.costsByCategory).sort().forEach(category => {
        ws_data.push([]);
        ws_data.push([`${category.toUpperCase()}`]);
        styles[`A${ws_data.length}`] = { font: { bold: true, sz: 11 }};
        rawMaterialsCosts.costsByCategory[category].items.forEach((item: any) => {
            ws_data.push([item.nome, item.qta, item.prezzoUnitario, item.costoTotale]);
        });
        ws_data.push([null, null, `Subtotale ${category}`, rawMaterialsCosts.costsByCategory[category].total]);
        styles[`C${ws_data.length}`] = totalLabelStyle; styles[`D${ws_data.length}`] = totalValueStyle;
    });
    ws_data.push([], []);

    ws_data.push([null, null, 'Totale Costo Materie Prime', rawMaterialsCosts.grandTotal]);
    styles[`C${ws_data.length}`] = totalLabelStyle; styles[`D${ws_data.length}`] = totalValueStyle;
    ws_data.push([], []);

    // --- OTHER COSTS ---
    ws_data.push(['ALTRI COSTI']);
    styles[`A${ws_data.length}`] = sectionTitleStyle;
    ws_data.push(['Descrizione', 'Dettaglio Calcolo', 'Costo']);
    ['A','B','C'].forEach(c => styles[`${c}${ws_data.length}`] = headerStyle);
    ws_data.push(['Costo Gas Totale', `${otherCosts.gas.used.toFixed(2)} m³ * €${otherCosts.gas.price.toFixed(2)}/m³`, otherCosts.gas.total]);
    if(otherCosts.additionalGases.total > 0) { ws_data.push(['Gas Aggiuntivi (CO2/Azoto)', null, otherCosts.additionalGases.total]); }
    ws_data.push(['Accise', `${otherCosts.exciseDuty.plato.toFixed(2)}°P * ${otherCosts.exciseDuty.hl.toFixed(4)} hL * €${otherCosts.exciseDuty.coeff.toFixed(2)}`, otherCosts.exciseDuty.total]);
    if(otherCosts.storage.total > 0) { ws_data.push(['Stoccaggio', null, otherCosts.storage.total]); }
    if(otherCosts.epal.total > 0) { ws_data.push(['Epal', `${otherCosts.epal.count} pz * €${otherCosts.epal.price.toFixed(2)}/pz`, otherCosts.epal.total]); }
    ws_data.push(['Spese Gestione Birrificio', `${otherCosts.management.liters.toFixed(2)} L * €${otherCosts.management.coeff.toFixed(2)}/L`, otherCosts.management.total]);
    ws_data.push([null, 'Totale Altri Costi', otherCosts.grandTotal]);
    styles[`B${ws_data.length}`] = totalLabelStyle; styles[`C${ws_data.length}`] = totalValueStyle;
    ws_data.push([], []);
    
    let packagingCols = 4;
    // --- PACKAGING ---
    if(packagingAnalysis && (packagingAnalysis.kegs.length > 0 || packagingAnalysis.bottles.length > 0)) {
        ws_data.push(['ANALISI COSTI CONFEZIONAMENTO']);
        styles[`A${ws_data.length}`] = sectionTitleStyle;
        
        if(packagingAnalysis.kegs.length > 0) {
            ws_data.push([]);
            ws_data.push(['Formato Fusto', 'Costo Birra / L', 'Costo Contenitore / L', 'Prezzo Finale / L']);
            ['A','B','C','D'].forEach(c => styles[`${c}${ws_data.length}`] = headerStyle);
            packagingAnalysis.kegs.forEach(item => {
                ws_data.push([item.formato, item.beerCostPerLiter, item.containerCostPerLiter, item.finalPricePerLiter]);
            });
        }

        if(packagingAnalysis.bottles.length > 0) {
            ws_data.push([]);
            packagingCols = 9;
            const bottleHeaders = ['Formato Bottiglia', 'Q.tà', 'Costo Birra/bott.', 'Costo Bottiglia', 'Costo Tappo', 'Incid. Cartone', 'Costo Etichetta', 'Finale/bott.', 'Totale Formato'];
            ws_data.push(bottleHeaders);
            ['A','B','C','D','E','F','G','H','I'].forEach(c => styles[`${c}${ws_data.length}`] = headerStyle);
            packagingAnalysis.bottles.forEach(item => {
                ws_data.push([item.formato, item.totalBottles, item.beerCost, item.bottleCost, item.capPrice, item.cartonCostPerBottle, item.labelCost, item.finalPricePerBottle, item.totalCostForFormat]);
            });
        }
        ws_data.push([]);
    }

    // --- GRAND TOTALS ---
    ws_data.push([null, null, 'GRAN TOTALE COSTI LOTTO', analysisSummary.grandTotal]);
    styles[`C${ws_data.length}`] = totalLabelStyle; styles[`D${ws_data.length}`] = totalValueStyle;
    ws_data.push([null, null, 'PREZZO EFFETTIVO AL LITRO (SOLO BIRRA)', analysisSummary.beerPricePerLiter]);
    styles[`C${ws_data.length}`] = totalLabelStyle; styles[`D${ws_data.length}`] = totalValueStyle;

    const ws = XLSX.utils.aoa_to_sheet(ws_data);
    ws['!cols'] = getColumnWidths(ws_data);
    ws['!pageSetup'] = { orientation: 'portrait', paper: 9 };
    ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: packagingCols - 1 } }];
    applyStylesToSheet(ws, styles);
    
    XLSX.utils.book_append_sheet(wb, ws, `Costi Lotto ${lotto.LOTTO}`);
    XLSX.writeFile(wb, `costi_lotto_${lotto.LOTTO}.xlsx`);
};


export const exportBrewSheetToExcel = (
    header: BrewHeader,
    ingredients: { tipologia: string; nome: string; lotto_fornitore: string; qta: string; }[],
    fermentationData: FermentationDataPoint[],
    packagingData: PackagingData[]
) => {
    const wb = XLSX.utils.book_new();
    const ws_data: (string | number | null)[][] = [];
    const styles: { [cell: string]: any } = {};

    ws_data.push([`FOGLIO COTTA - LOTTO: ${header.LOTTO}`]); styles[`A${ws_data.length}`] = titleStyle;
    ws_data.push([], []);
    
    ws_data.push(['TESTATA']); styles[`A${ws_data.length}`] = sectionTitleStyle;
    ws_data.push(['Cliente:', header.CLIENTE, 'Data Produzione:', header.DATA_PROD]);
    ws_data.push(['Nome Birra:', header.NOME_BIRRA, 'Tipologia:', header.TIPO_BIRRA]);
    ws_data.push(['Litri Finali:', header.LITRI_FINALI, 'Plato Iniziale:', header.PLATO_INIZIALE]);
    ws_data.push([], []);

    ws_data.push(['INGREDIENTI UTILIZZATI']); styles[`A${ws_data.length}`] = sectionTitleStyle;
    ws_data.push(['Tipologia', 'Nome', 'Lotto Fornitore', 'Quantità']);
    ['A','B','C','D'].forEach(c => styles[`${c}${ws_data.length}`] = headerStyle);
    
    ingredients.forEach(item => {
        ws_data.push([item.tipologia, item.nome, item.lotto_fornitore, parseFloat(item.qta.replace(',', '.')) || 0]);
    });
    ws_data.push([], []);

    ws_data.push(['GESTIONE CANTINA']); styles[`A${ws_data.length}`] = sectionTitleStyle;
    const fermLabel = header.FERMENTATORE
        ? (header.isCellarClosed ? `${header.FERMENTATORE} (Chiuso)` : header.FERMENTATORE)
        : 'CHIUSO';
    ws_data.push(['Fermentatore:', fermLabel, 'Tipo Fermentazione:', header.TIPO_FERMENTAZIONE]);
    ws_data.push(['Giorni Previsti:', header.GIORNI_FERMENTAZIONE_PREVISTI, 'Gas Cotta (m³):', header.GAS_COTTA]);
    ws_data.push(['Gas Confezionamento (m³):', header.GAS_CONFEZIONAMENTO, 'Gas Aggiuntivi:', `${header.FLAG_CO2 ? 'CO2 ' : ''}${header.FLAG_AZOTO ? 'Azoto' : ''}`.trim()]);
    ws_data.push([], []);

    ws_data.push(['DATI FERMENTAZIONE']); styles[`A${ws_data.length}`] = sectionTitleStyle;
    ws_data.push(['Giorno', 'Temperatura (°C)', 'Plato (°P)']);
    ['A','B','C'].forEach(c => styles[`${c}${ws_data.length}`] = headerStyle);
    fermentationData.forEach(p => { ws_data.push([p.GIORNO, p.TEMPERATURA, p.PLATO]); });
    ws_data.push([], []);

    ws_data.push(['CONFEZIONAMENTO']); styles[`A${ws_data.length}`] = sectionTitleStyle;
    ws_data.push(['Data', 'Formato', 'Pezzi', 'Litri Totali']);
    ['A','B','C','D'].forEach(c => styles[`${c}${ws_data.length}`] = headerStyle);
    packagingData.forEach(p => { ws_data.push([p.DATA, p.FORMATO, p.QTA_UNITA, p.LITRI_TOT]); });
    ws_data.push([], []);
    
    ws_data.push(['NOTE']); styles[`A${ws_data.length}`] = sectionTitleStyle;
    ws_data.push([header.NOTE || 'Nessuna nota.']);
    
    const ws = XLSX.utils.aoa_to_sheet(ws_data);
    ws['!cols'] = getColumnWidths(ws_data);
    ws['!pageSetup'] = { orientation: 'portrait', paper: 9 };
    ws['!merges'] = [ XLSX.utils.decode_range('A1:D1'), { s: {r: ws_data.length-1, c: 0}, e: {r: ws_data.length-1, c: 3} }];
    applyStylesToSheet(ws, styles);

    XLSX.utils.book_append_sheet(wb, ws, `Cotta ${header.LOTTO}`);
    XLSX.writeFile(wb, `foglio_cotta_${header.LOTTO}.xlsx`);
};

export const exportQuoteToExcel = (
    quoteData: any,
    rawMaterialsCosts: any,
    otherCosts: any,
    analysisSummary: any,
    packagingAnalysis: { bottles: any[], kegs: any[] } | null
) => {
    const wb = XLSX.utils.book_new();
    let ws_data: (string | number | null)[][] = [];
    const styles: { [cell: string]: any } = {};

    ws_data.push([`PREVENTIVO PER BIRRA: ${quoteData.nomeBirra}`]); styles[`A${ws_data.length}`] = titleStyle;
    ws_data.push([], []);
    ws_data.push(['Cliente:', quoteData.cliente]); styles[`A${ws_data.length}`] = totalLabelStyle;
    ws_data.push(['Litri Stimati:', parseFloat(quoteData.litriFinali.replace(',', '.')) || 0]); styles[`A${ws_data.length}`] = totalLabelStyle;
    ws_data.push([], []);

    ws_data.push(['COSTI MATERIE PRIME']); styles[`A${ws_data.length}`] = sectionTitleStyle;
    ws_data.push(['Ingrediente', 'Q.tà', 'Prezzo Unit.', 'Costo Totale']);
    ['A','B','C','D'].forEach(c => styles[`${c}${ws_data.length}`] = headerStyle);
    rawMaterialsCosts.items.forEach((item: any) => {
        ws_data.push([item.nome, item.qta, item.prezzoUnitario, item.costoTotale]);
    });
    ws_data.push([null, null, 'Totale Materie Prime', rawMaterialsCosts.grandTotal]);
    styles[`C${ws_data.length}`] = totalLabelStyle; styles[`D${ws_data.length}`] = totalValueStyle;
    ws_data.push([], []);

    ws_data.push(['ALTRI COSTI']); styles[`A${ws_data.length}`] = sectionTitleStyle;
    ws_data.push(['Descrizione', 'Costo']);
    ['A','B'].forEach(c => styles[`${c}${ws_data.length}`] = headerStyle);
    ws_data.push(['Costo Gas Totale', otherCosts.gas.total]);
    if(otherCosts.additionalGases.total > 0) { ws_data.push(['Gas Aggiuntivi', otherCosts.additionalGases.total]); }
    ws_data.push(['Accise', otherCosts.exciseDuty.total]);
    if(otherCosts.storage.total > 0) { ws_data.push(['Stoccaggio', otherCosts.storage.total]); }
    if(otherCosts.epal.total > 0) { ws_data.push(['Epal', otherCosts.epal.total]); }
    ws_data.push(['Spese Gestione', otherCosts.management.total]);
    ws_data.push(['Totale Altri Costi', otherCosts.grandTotal]);
    styles[`A${ws_data.length}`] = totalLabelStyle; styles[`B${ws_data.length}`] = totalValueStyle;
    ws_data.push([], []);
    
    let packagingCols = 4;
    if(packagingAnalysis && (packagingAnalysis.kegs.length > 0 || packagingAnalysis.bottles.length > 0)) {
        ws_data.push(['ANALISI COSTI CONFEZIONAMENTO']); styles[`A${ws_data.length}`] = sectionTitleStyle;
        ws_data.push([]);
        
        if(packagingAnalysis.kegs.length > 0) {
            ws_data.push(['Formato Fusto', 'Costo Birra/L', 'Costo Contenitore/L', 'Prezzo Finale/L']);
            ['A','B','C','D'].forEach(c => styles[`${c}${ws_data.length}`] = headerStyle);
            packagingAnalysis.kegs.forEach(item => { ws_data.push([item.formato, item.beerCostPerLiter, item.containerCostPerLiter, item.finalPricePerLiter]); });
            ws_data.push([]);
        }
        if(packagingAnalysis.bottles.length > 0) {
            packagingCols = 9;
            ws_data.push(['Formato', 'Q.tà', 'Birra', 'Bottiglia', 'Tappo', 'Cartone', 'Etichetta', 'Finale/bott.', 'Totale']);
            ['A','B','C','D','E','F','G','H','I'].forEach(c => styles[`${c}${ws_data.length}`] = headerStyle);
            packagingAnalysis.bottles.forEach(item => {
                ws_data.push([item.formato, item.totalBottles, item.beerCost, item.bottleCost, item.capPrice, item.cartonCostPerBottle, item.labelCost, item.finalPricePerBottle, item.totalCostForFormat]);
            });
        }
        ws_data.push([]);
    }

    ws_data.push([null, null, 'GRAN TOTALE COSTI', analysisSummary.grandTotal]);
    styles[`C${ws_data.length}`] = totalLabelStyle; styles[`D${ws_data.length}`] = totalValueStyle;
    ws_data.push([null, null, 'PREZZO AL LITRO (BIRRA)', analysisSummary.beerPricePerLiter]);
    styles[`C${ws_data.length}`] = totalLabelStyle; styles[`D${ws_data.length}`] = totalValueStyle;

    const ws = XLSX.utils.aoa_to_sheet(ws_data);
    ws['!cols'] = getColumnWidths(ws_data);
    ws['!pageSetup'] = { orientation: 'portrait', paper: 9 };
    ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: packagingCols - 1 } }];
    applyStylesToSheet(ws, styles);
    
    XLSX.utils.book_append_sheet(wb, ws, `Preventivo`);
    XLSX.writeFile(wb, `preventivo_${quoteData.nomeBirra.replace(/ /g, '_')}.xlsx`);
};

export const exportPackagedBeerOrderToExcel = (
    order: PackagedBeerOrder,
    profile?: BreweryProfile,
    clientDetails?: Cliente
) => {
    const wb = XLSX.utils.book_new();
    const ws_data: (string | number | null)[][] = [];
    const styles: { [cell: string]: any } = {};

    const issuerName = profile?.ragioneSociale?.trim() || 'BIRRIFICIO ALVERESE';
    const issuerAddr = profile?.indirizzo?.trim() || '';
    const issuerCity = profile?.capCittaProvincia?.trim() || '';
    const issuerTax = [
        profile?.partitaIva ? `P.IVA: ${profile.partitaIva}` : '',
        profile?.codiceAccisa ? `Cod. Accisa: ${profile.codiceAccisa}` : ''
    ].filter(Boolean).join(' - ');

    const recipientTitle = clientDetails?.ragioneSociale?.trim() || order.client;
    const recipientAddr = clientDetails?.sedeSociale?.trim() || '';
    const recipientTax = [
        clientDetails?.partitaIva ? `P.IVA: ${clientDetails.partitaIva}` : '',
        clientDetails?.numeroTelefono ? `Tel: ${clientDetails.numeroTelefono}` : ''
    ].filter(Boolean).join(' - ');

    // --- HEADER ---
    ws_data.push([issuerName, null, null, null, 'DESTINATARIO:']);
    styles[`A${ws_data.length}`] = { font: { bold: true, sz: 14 } };
    styles[`E${ws_data.length}`] = { font: { bold: true } };

    ws_data.push([issuerAddr, null, null, null, recipientTitle]);
    ws_data.push([issuerCity, null, null, null, recipientAddr]);
    ws_data.push([issuerTax, null, null, null, recipientTax]);
    ws_data.push([], []);

    // --- TITLE & INFO ---
    const titleRowIndex = ws_data.length;
    const ddtLabel = order.numeroDdt || order.id;
    ws_data.push(['DOCUMENTO DI TRASPORTO (DDT)']);
    styles[`A${ws_data.length}`] = { font: { bold: true, sz: 16 }, alignment: { horizontal: 'center' } };
    ws_data.push([`Numero: ${ddtLabel}`, null, `Data: ${order.date}`, null, 'Causale: Vendita']);
    ws_data.push([], []);

    // --- ITEMS TABLE ---
    ws_data.push(['Descrizione', 'Lotto', 'Formato', 'Q.tà', 'Prezzo Unit.', 'Totale']);
    ['A','B','C','D','E','F'].forEach(c => styles[`${c}${ws_data.length}`] = headerStyle);

    order.items.forEach(item => {
        ws_data.push([
            item.beerName,
            item.lotto,
            item.format,
            item.quantity,
            item.price,
            item.total
        ]);
    });
    ws_data.push([], []);

    // --- TOTALS ---
    ws_data.push([null, null, null, null, 'Totale Netto:', order.totalNet]);
    styles[`E${ws_data.length}`] = totalLabelStyle; styles[`F${ws_data.length}`] = totalValueStyle;

    ws_data.push([null, null, null, null, 'IVA (22%):', order.iva]);
    styles[`E${ws_data.length}`] = totalLabelStyle; styles[`F${ws_data.length}`] = totalValueStyle;

    ws_data.push([null, null, null, null, 'TOTALE DOCUMENTO:', order.totalGross]);
    styles[`E${ws_data.length}`] = { font: { bold: true, sz: 12 }, alignment: { horizontal: 'right' } };
    styles[`F${ws_data.length}`] = { font: { bold: true, sz: 14 } };

    const ws = XLSX.utils.aoa_to_sheet(ws_data);
    ws['!cols'] = getColumnWidths(ws_data);
    ws['!pageSetup'] = { orientation: 'portrait', paper: 9 };
    ws['!merges'] = [
        { s: { r: titleRowIndex, c: 0 }, e: { r: titleRowIndex, c: 5 } }
    ];
    applyStylesToSheet(ws, styles);

    const safeDdtSheet = ddtLabel.replace(/[/\\?*[\]:]/g, '_').slice(-18);
    XLSX.utils.book_append_sheet(wb, ws, `DDT_${safeDdtSheet}`);
    XLSX.writeFile(wb, `DDT_${ddtLabel.replace(/[/\\]/g, '-')}_${order.client.replace(/ /g, '_')}_${order.date.replace(/\//g, '-')}.xlsx`);
};

export const exportAllDataToExcel = (allData: Record<string, BreweryData>) => {
    const wb = XLSX.utils.book_new();
    const years = Object.keys(allData).sort();

    if (years.length === 0) {
        console.error("No data to export.");
        return;
    }
    
    const firstYearData = allData[years[0]];
    if (!firstYearData) return;

    const sheetNames = Object.keys(firstYearData) as Array<keyof BreweryData>;

    sheetNames.forEach(sheetName => {
        let combinedData: any[] = [];
        years.forEach(year => {
            const yearData = allData[year]?.[sheetName];
            if (!yearData) return;

            const dataToAdd = Array.isArray(yearData) ? yearData : [yearData];
            
            dataToAdd.forEach(row => {
                if (typeof row === 'object' && row !== null && Object.keys(row).length > 0) {
                    combinedData.push({ ANNO: year, ...row });
                } else if (typeof row !== 'object' || row === null) {
                    // For primitive values or null in array
                    combinedData.push({ ANNO: year, value: row });
                }
            });
        });

        if (combinedData.length > 0) {
            const ws = XLSX.utils.json_to_sheet(combinedData);
            
            const aoaDataForWidth = [Object.keys(combinedData[0] || {}), ...combinedData.map(row => Object.values(row))];
            ws['!cols'] = getColumnWidths(aoaDataForWidth);
            ws['!pageSetup'] = { orientation: 'portrait', paper: 9 };
            
            const range = XLSX.utils.decode_range(ws['!ref'] as string);
            for (let C = range.s.c; C <= range.e.c; ++C) {
                const address = XLSX.utils.encode_cell({ r: 0, c: C });
                if (ws[address]) ws[address].s = headerStyle;
            }
            
            XLSX.utils.book_append_sheet(wb, ws, sheetName);
        }
    });

    XLSX.writeFile(wb, `brewpanda_all_data_backup_${new Date().toISOString().slice(0, 10)}.xlsx`);
};