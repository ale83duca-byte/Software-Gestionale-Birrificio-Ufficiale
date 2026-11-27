import * as XLSX from 'xlsx';
import type {
    BeerMovement,
    BreweryProfile,
    BrewHeader,
    Cliente,
    FermentationDataPoint,
    InternalTransferDDT,
    MaintenanceLog,
    Movement,
    PackagingData,
    SummaryInvoice,
} from '../types';
import { CONFIG_PACKAGING } from '../constants';
import { calculateBrewMetrics } from './brewingCalculations';

const escapeHtml = (value: string | number | undefined | null): string => {
    if (value === undefined || value === null) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
};

const escapeXml = (value: string | number | undefined | null): string => {
    if (value === undefined || value === null) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
};

export const triggerA4PrintHtml = (html: string) => {
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    iframe.setAttribute('aria-hidden', 'true');
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow?.document;
    if (!doc || !iframe.contentWindow) {
        document.body.removeChild(iframe);
        return;
    }

    doc.open();
    doc.write(html);
    doc.close();

    const cleanup = () => {
        setTimeout(() => {
            if (iframe.parentNode) {
                iframe.parentNode.removeChild(iframe);
            }
        }, 1200);
    };

    setTimeout(() => {
        try {
            iframe.contentWindow?.focus();
            iframe.contentWindow?.print();
        } finally {
            cleanup();
        }
    }, 250);
};

const basePrintStyles = `
    @page { size: A4 portrait; margin: 12mm; }
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; color: #0f172a; font-size: 11px; line-height: 1.4; margin: 0; }
    h1, h2, h3 { margin: 0; }
    .header { display: flex; justify-content: space-between; border-bottom: 2px solid #0f172a; padding-bottom: 8px; margin-bottom: 12px; }
    .company { font-size: 15px; font-weight: 800; }
    .doc-badge { text-align: right; }
    .doc-title { font-size: 14px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.04em; }
    .meta-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 12px; background: #f8fafc; border: 1px solid #cbd5e1; padding: 8px; border-radius: 4px; }
    .meta-item label { display: block; font-size: 9px; color: #475569; text-transform: uppercase; font-weight: 700; }
    .meta-item span { font-size: 12px; font-weight: 700; font-variant-numeric: tabular-nums; }
    .section { margin-bottom: 12px; page-break-inside: avoid; }
    .section-title { font-size: 11px; font-weight: 800; text-transform: uppercase; background: #e2e8f0; padding: 4px 8px; border-radius: 3px; margin-bottom: 6px; }
    table { width: 100%; border-collapse: collapse; font-size: 10.5px; font-variant-numeric: tabular-nums; }
    th, td { border: 1px solid #cbd5e1; padding: 4px 6px; text-align: left; }
    th { background: #f1f5f9; font-weight: 700; }
    .num { text-align: right; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    .signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-top: 20px; page-break-inside: avoid; }
    .sig-box { border-top: 1px solid #334155; padding-top: 4px; font-size: 10px; color: #475569; margin-top: 28px; }
`;

export interface HaccpDeliveryRecord {
    data: string;
    cliente: string;
    documento: string;
    formato: string;
    quantita: number;
    litri: number;
}

export const printHaccpLotDossierA4 = (params: {
    year: string;
    profile: BreweryProfile;
    header: BrewHeader;
    rawMaterials: Movement[];
    packagingMaterials: Movement[];
    fermentation: FermentationDataPoint[];
    packagingRuns: PackagingData[];
    deliveries: HaccpDeliveryRecord[];
    cipLogs: MaintenanceLog[];
}) => {
    const { profile, header, rawMaterials, packagingMaterials, fermentation, packagingRuns, deliveries, cipLogs } = params;
    const lastPlato = header.PLATO_FINALE
        || (fermentation.length > 0 ? String(fermentation[fermentation.length - 1].PLATO) : undefined);
    const metrics = calculateBrewMetrics(header.PLATO_INIZIALE, lastPlato);

    const html = `<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8" />
    <title>Dossier HACCP Lotto ${escapeHtml(header.LOTTO)}</title>
    <style>${basePrintStyles}</style>
</head>
<body>
    <div class="header">
        <div>
            <div class="company">${escapeHtml(profile.ragioneSociale)}</div>
            <div>${escapeHtml(profile.indirizzo)} ${escapeHtml(profile.capCittaProvincia)}</div>
            <div>P.IVA: ${escapeHtml(profile.partitaIva || '-')} ${profile.codiceAccisa ? `· Cod. Accisa: ${escapeHtml(profile.codiceAccisa)}` : ''}</div>
        </div>
        <div class="doc-badge">
            <div class="doc-title">Dossier Tracciabilità Lotto HACCP</div>
            <div>Reg. (CE) 178/2002 · Reg. (CE) 852/2004</div>
            <div>Stampato il ${escapeHtml(new Date().toLocaleDateString('it-IT'))}</div>
        </div>
    </div>

    <div class="meta-grid">
        <div class="meta-item"><label>Lotto Produzione</label><span>${escapeHtml(header.LOTTO)}</span></div>
        <div class="meta-item"><label>Birra / Stile</label><span>${escapeHtml(header.NOME_BIRRA)} (${escapeHtml(header.TIPO_BIRRA || '-')})</span></div>
        <div class="meta-item"><label>Cliente / Marchio</label><span>${escapeHtml(header.CLIENTE)}</span></div>
        <div class="meta-item"><label>Data Cotta & Tank</label><span>${escapeHtml(header.DATA_PROD)} · ${escapeHtml(header.FERMENTATORE || 'N/D')}</span></div>
        <div class="meta-item"><label>Grado Plato OG / FG</label><span>${escapeHtml(header.PLATO_INIZIALE || '-')} °P → ${escapeHtml(lastPlato || '-')} °P</span></div>
        <div class="meta-item"><label>Grado Alcolico / Att. App.</label><span>${metrics ? `${metrics.abv.toFixed(2)}% vol · ${metrics.apparentAttenuation.toFixed(1)}%` : 'N/D'}</span></div>
        <div class="meta-item"><label>Volume Mosto</label><span>${escapeHtml(header.LITRI_FINALI || '0')} L</span></div>
        <div class="meta-item"><label>Lievito / Generazione</label><span>${header.yeastPitchType === 'REPITCHING' ? `Repitch da ${escapeHtml(header.yeastSourceLotto || '?')} (Gen. ${header.yeastGeneration ?? 1})` : `Lievito Madre / Gen. ${header.yeastGeneration ?? 0}`}</span></div>
    </div>

    <div class="section">
        <div class="section-title">1. Materie Prime Impiegate (Tracciabilità a Monte)</div>
        <table>
            <thead>
                <tr><th>Tipologia</th><th>Ingrediente</th><th>Marca</th><th>Fornitore</th><th>Lotto Fornitore</th><th class="num">Quantità</th></tr>
            </thead>
            <tbody>
                ${rawMaterials.length > 0 ? rawMaterials.map(m => `
                <tr>
                    <td>${escapeHtml(m.TIPOLOGIA)}</td>
                    <td>${escapeHtml(m.NOME)}</td>
                    <td>${escapeHtml(m.MARCA)}</td>
                    <td>${escapeHtml(m.FORNITORE)}</td>
                    <td><strong>${escapeHtml(m.LOTTO_FORNITORE || 'RIPORTO')}</strong></td>
                    <td class="num">${Math.abs(m.KG_LITRI_PZ).toFixed(2)}</td>
                </tr>`).join('') : '<tr><td colspan="6">Nessun movimento materia prima registrato.</td></tr>'}
            </tbody>
        </table>
    </div>

    <div class="section">
        <div class="section-title">2. Monitoraggio Fermentazione & Parametri Chimico-Fisici</div>
        <table>
            <thead>
                <tr><th>Giorno</th><th class="num">Temperatura (°C)</th><th class="num">Grado Plato (°P)</th><th class="num">pH</th><th class="num">Pressione (bar)</th><th>Note</th></tr>
            </thead>
            <tbody>
                ${fermentation.length > 0 ? fermentation.map(f => `
                <tr>
                    <td>Giorno ${f.GIORNO}</td>
                    <td class="num">${f.TEMPERATURA.toFixed(1)}</td>
                    <td class="num">${f.PLATO.toFixed(2)}</td>
                    <td class="num">${f.PH !== undefined ? f.PH.toFixed(2) : '-'}</td>
                    <td class="num">${f.PRESSIONE !== undefined ? f.PRESSIONE.toFixed(2) : '-'}</td>
                    <td>${escapeHtml(f.NOTE_MISURA || '')}</td>
                </tr>`).join('') : '<tr><td colspan="6">Nessuna misurazione giornaliera registrata.</td></tr>'}
            </tbody>
        </table>
    </div>

    <div class="section">
        <div class="section-title">3. Confezionamento & Materiali a Contatto Alimentare (MOCA)</div>
        <table>
            <thead>
                <tr><th>Data</th><th>Formato</th><th class="num">Unità</th><th class="num">Litri Totali</th><th>TMC / Scadenza</th><th>Modalità Imballo</th></tr>
            </thead>
            <tbody>
                ${packagingRuns.length > 0 ? packagingRuns.map(p => `
                <tr>
                    <td>${escapeHtml(p.DATA)}</td>
                    <td>${escapeHtml(p.FORMATO)}</td>
                    <td class="num">${p.QTA_UNITA}</td>
                    <td class="num">${p.LITRI_TOT.toFixed(2)}</td>
                    <td>${escapeHtml(p.DATA_SCADENZA)}</td>
                    <td>${p.isReturnableKeg ? 'Parco Fusti Inox a Rendere' : ' Scarico Magazzino Imballi'}</td>
                </tr>`).join('') : '<tr><td colspan="6">Nessun confezionamento registrato.</td></tr>'}
            </tbody>
        </table>
        ${packagingMaterials.length > 0 ? `
        <table style="margin-top:6px;">
            <thead>
                <tr><th>Categoria MOCA</th><th>Articolo</th><th>Fornitore</th><th>Lotto Fornitore</th><th class="num">Pezzi Scaricati</th></tr>
            </thead>
            <tbody>
                ${packagingMaterials.map(m => `
                <tr>
                    <td>${escapeHtml(m.TIPOLOGIA)}</td>
                    <td>${escapeHtml(m.NOME)}</td>
                    <td>${escapeHtml(m.FORNITORE)}</td>
                    <td><strong>${escapeHtml(m.LOTTO_FORNITORE || '-')}</strong></td>
                    <td class="num">${Math.abs(m.KG_LITRI_PZ)}</td>
                </tr>`).join('')}
            </tbody>
        </table>` : ''}
    </div>

    <div class="section">
        <div class="section-title">4. Distribuzione Commerciale & Clienti Destinatari (Tracciabilità a Valle)</div>
        <table>
            <thead>
                <tr><th>Data Consegna</th><th>Cliente Destinatario</th><th>Rif. Documento / DDT</th><th>Formato</th><th class="num">Unità Consegnate</th><th class="num">Litri</th></tr>
            </thead>
            <tbody>
                ${deliveries.length > 0 ? deliveries.map(d => `
                <tr>
                    <td>${escapeHtml(d.data)}</td>
                    <td><strong>${escapeHtml(d.cliente)}</strong></td>
                    <td>${escapeHtml(d.documento)}</td>
                    <td>${escapeHtml(d.formato)}</td>
                    <td class="num">${d.quantita}</td>
                    <td class="num">${d.litri.toFixed(2)}</td>
                </tr>`).join('') : '<tr><td colspan="6">Nessuna uscita commerciale registrata per questo lotto (intera produzione in cella).</td></tr>'}
            </tbody>
        </table>
    </div>

    ${cipLogs.length > 0 ? `
    <div class="section">
        <div class="section-title">5. Sanificazioni CIP / Manutenzioni Registrate</div>
        <table>
            <thead><tr><th>Data</th><th>Piano / Procedura</th><th>Apparato</th><th>Operatore</th><th>Note</th></tr></thead>
            <tbody>
                ${cipLogs.slice(0, 8).map(l => `
                <tr>
                    <td>${escapeHtml(l.dataEsecuzione)}</td>
                    <td>${escapeHtml(l.planNome)}</td>
                    <td>${escapeHtml(l.apparato)}</td>
                    <td>${escapeHtml(l.operatore || '-')}</td>
                    <td>${escapeHtml(l.note || '')}</td>
                </tr>`).join('')}
            </tbody>
        </table>
    </div>` : ''}

    <div class="signatures">
        <div class="sig-box">Responsabile Produzione / Mastro Birraio</div>
        <div class="sig-box">Responsabile Autocontrollo HACCP</div>
    </div>
</body>
</html>`;

    triggerA4PrintHtml(html);
};

export const printHaccpSupplierRecallA4 = (params: {
    profile: BreweryProfile;
    supplierLotQuery: string;
    receipts: Array<{ year: string; mov: Movement }>;
    residualStock: number;
    impactedBrews: Array<{ year: string; lotto: string; birra: string; cliente: string; dataProd: string; qtaUsata: number; ruolo: string }>;
    impactedDeliveries: Array<{ year: string; lotto: string; birra: string; data: string; cliente: string; telefono?: string; documento: string; formato: string; quantita: number }>;
}) => {
    const { profile, supplierLotQuery, receipts, residualStock, impactedBrews, impactedDeliveries } = params;

    const html = `<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8" />
    <title>Report Richiamo Lotto Fornitore ${escapeHtml(supplierLotQuery)}</title>
    <style>${basePrintStyles}</style>
</head>
<body>
    <div class="header">
        <div>
            <div class="company">${escapeHtml(profile.ragioneSociale)}</div>
            <div>${escapeHtml(profile.indirizzo)} ${escapeHtml(profile.capCittaProvincia)}</div>
            <div>P.IVA: ${escapeHtml(profile.partitaIva || '-')}</div>
        </div>
        <div class="doc-badge">
            <div class="doc-title" style="color:#b91c1c;">Scheda Richiamo / Blocco Cautelativo</div>
            <div>Art. 18–19 Reg. (CE) 178/2002 — Rintracciabilità Alimentare</div>
            <div>Data emissione: ${escapeHtml(new Date().toLocaleDateString('it-IT'))}</div>
        </div>
    </div>

    <div class="meta-grid">
        <div class="meta-item"><label>Lotto Fornitore Indagato</label><span>${escapeHtml(supplierLotQuery)}</span></div>
        <div class="meta-item"><label>Giacenza Residua da Segregare</label><span>${residualStock.toFixed(2)} u.m.</span></div>
        <div class="meta-item"><label>Lotti Birra Coinvolti</label><span>${impactedBrews.length}</span></div>
        <div class="meta-item"><label>Consegne Clienti da Avvisare</label><span>${impactedDeliveries.length}</span></div>
    </div>

    <div class="section">
        <div class="section-title">1. Carichi di Magazzino Ricevuti</div>
        <table>
            <thead><tr><th>Anno</th><th>Data Carico</th><th>Articolo</th><th>Fornitore</th><th>Rif. Fattura/DDT</th><th class="num">Q.tà Caricata</th><th>Scadenza</th></tr></thead>
            <tbody>
                ${receipts.length > 0 ? receipts.map(r => `
                <tr>
                    <td>${escapeHtml(r.year)}</td>
                    <td>${escapeHtml(r.mov.DATA)}</td>
                    <td>${escapeHtml(r.mov.NOME)} (${escapeHtml(r.mov.TIPOLOGIA)})</td>
                    <td>${escapeHtml(r.mov.FORNITORE)}</td>
                    <td>${escapeHtml(r.mov.N_FATTURA)}</td>
                    <td class="num">${r.mov.KG_LITRI_PZ.toFixed(2)}</td>
                    <td>${escapeHtml(r.mov.DATA_SCADENZA || '-')}</td>
                </tr>`).join('') : '<tr><td colspan="7">Nessun documento di carico trovato.</td></tr>'}
            </tbody>
        </table>
    </div>

    <div class="section">
        <div class="section-title">2. Lotti di Birra Prodotti / Confezionati con il Lotto Indagato</div>
        <table>
            <thead><tr><th>Anno</th><th>Lotto Birra</th><th>Birra</th><th>Proprietà</th><th>Data Cotta</th><th>Impiego</th><th class="num">Q.tà Impiegata</th></tr></thead>
            <tbody>
                ${impactedBrews.length > 0 ? impactedBrews.map(b => `
                <tr>
                    <td>${escapeHtml(b.year)}</td>
                    <td><strong>${escapeHtml(b.lotto)}</strong></td>
                    <td>${escapeHtml(b.birra)}</td>
                    <td>${escapeHtml(b.cliente)}</td>
                    <td>${escapeHtml(b.dataProd)}</td>
                    <td>${escapeHtml(b.ruolo)}</td>
                    <td class="num">${b.qtaUsata.toFixed(2)}</td>
                </tr>`).join('') : '<tr><td colspan="7">Nessun lotto di produzione coinvolto.</td></tr>'}
            </tbody>
        </table>
    </div>

    <div class="section">
        <div class="section-title">3. Lista Clienti Destinatari da Contattare per Ritiro / Richiamo</div>
        <table>
            <thead><tr><th>Data</th><th>Cliente</th><th>Telefono</th><th>Rif. DDT</th><th>Lotto Birra</th><th>Birra & Formato</th><th class="num">Unità</th></tr></thead>
            <tbody>
                ${impactedDeliveries.length > 0 ? impactedDeliveries.map(d => `
                <tr>
                    <td>${escapeHtml(d.data)}</td>
                    <td><strong>${escapeHtml(d.cliente)}</strong></td>
                    <td>${escapeHtml(d.telefono || '-')}</td>
                    <td>${escapeHtml(d.documento)}</td>
                    <td><strong>${escapeHtml(d.lotto)}</strong></td>
                    <td>${escapeHtml(d.birra)} · ${escapeHtml(d.formato)}</td>
                    <td class="num">${d.quantita}</td>
                </tr>`).join('') : '<tr><td colspan="7">Nessuna consegna esterna rilevata per i lotti coinvolti.</td></tr>'}
            </tbody>
        </table>
    </div>

    <div class="signatures">
        <div class="sig-box">Firma Responsabile Qualità / OSA</div>
        <div class="sig-box">Data e Ora Attivazione Blocco Cautelativo</div>
    </div>
</body>
</html>`;

    triggerA4PrintHtml(html);
};

export interface ExciseRegisterRow {
    lotto: string;
    dataProd: string;
    dataUltimoConf: string;
    meseCompetenza: string;
    nomeBirra: string;
    cliente: string;
    maltiKg: number;
    mostoHl: number;
    condizionataHl: number;
    caloPercent: number;
    platoFiscale: number;
    ettolitriGrado: number;
    aliquotaApplicata: number;
    accisaMaturata: number;
}

export const printExciseRegisterA4 = (params: {
    year: string;
    monthFilterLabel: string;
    profile: BreweryProfile;
    bracketLabel: string;
    rateEurHlPlato: number;
    rows: ExciseRegisterRow[];
}) => {
    const { year, monthFilterLabel, profile, bracketLabel, rateEurHlPlato, rows } = params;
    const totMalti = rows.reduce((s, r) => s + r.maltiKg, 0);
    const totMosto = rows.reduce((s, r) => s + r.mostoHl, 0);
    const totCond = rows.reduce((s, r) => s + r.condizionataHl, 0);
    const totHlGrado = rows.reduce((s, r) => s + r.ettolitriGrado, 0);
    const totAccisa = rows.reduce((s, r) => s + r.accisaMaturata, 0);

    const html = `<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8" />
    <title>Prospetto Accise ADM ${escapeHtml(year)}</title>
    <style>${basePrintStyles} @page { size: A4 landscape; margin: 10mm; }</style>
</head>
<body>
    <div class="header">
        <div>
            <div class="company">${escapeHtml(profile.ragioneSociale)}</div>
            <div>P.IVA: ${escapeHtml(profile.partitaIva || '-')} · Codice Accisa / Ditta ADM: <strong>${escapeHtml(profile.codiceAccisa || 'DA CONFIGURARE')}</strong></div>
            <div>Regime Accisa: ${escapeHtml(bracketLabel)} (€ ${rateEurHlPlato.toFixed(3)} / hL-grado Plato)</div>
        </div>
        <div class="doc-badge">
            <div class="doc-title">Prospetto Liquidazione Accise Birra (ADM)</div>
            <div>Periodo: <strong>${escapeHtml(monthFilterLabel)} — Anno ${escapeHtml(year)}</strong></div>
            <div>Stampato il ${escapeHtml(new Date().toLocaleDateString('it-IT'))}</div>
        </div>
    </div>

    <div class="meta-grid">
        <div class="meta-item"><label>Malti Scaricati</label><span>${totMalti.toFixed(1)} kg</span></div>
        <div class="meta-item"><label>Birra Condizionata</label><span>${totCond.toFixed(3)} hL</span></div>
        <div class="meta-item"><label>Totale Ettolitri-Grado</label><span>${totHlGrado.toFixed(2)} hL·°P</span></div>
        <div class="meta-item"><label>Imposta Accisa Maturata</label><span>€ ${totAccisa.toFixed(2)}</span></div>
    </div>

    <table>
        <thead>
            <tr>
                <th>Lotto</th>
                <th>Data Cotta</th>
                <th>Ult. Conf.</th>
                <th>Birra (Proprietà)</th>
                <th class="num">Malti (kg)</th>
                <th class="num">Mosto (hL)</th>
                <th class="num">Condiz. (hL)</th>
                <th class="num">Calo (%)</th>
                <th class="num">°P Fiscale</th>
                <th class="num">hL · °Plato</th>
                <th class="num">Aliquota €</th>
                <th class="num">Accisa (€)</th>
            </tr>
        </thead>
        <tbody>
            ${rows.map(r => `
            <tr>
                <td><strong>${escapeHtml(r.lotto)}</strong></td>
                <td>${escapeHtml(r.dataProd)}</td>
                <td>${escapeHtml(r.dataUltimoConf)}</td>
                <td>${escapeHtml(r.nomeBirra)} (${escapeHtml(r.cliente)})</td>
                <td class="num">${r.maltiKg.toFixed(1)}</td>
                <td class="num">${r.mostoHl.toFixed(2)}</td>
                <td class="num">${r.condizionataHl.toFixed(3)}</td>
                <td class="num">${r.caloPercent.toFixed(1)}%</td>
                <td class="num">${r.platoFiscale.toFixed(1)}</td>
                <td class="num">${r.ettolitriGrado.toFixed(2)}</td>
                <td class="num">${r.aliquotaApplicata.toFixed(3)}</td>
                <td class="num"><strong>${r.accisaMaturata.toFixed(2)}</strong></td>
            </tr>`).join('')}
        </tbody>
        <tfoot>
            <tr style="font-weight:800; background:#f1f5f9;">
                <td colspan="4">TOTALE PERIODO (${rows.length} lotti condizionati)</td>
                <td class="num">${totMalti.toFixed(1)}</td>
                <td class="num">${totMosto.toFixed(2)}</td>
                <td class="num">${totCond.toFixed(3)}</td>
                <td class="num">${totMosto > 0 ? (((totMosto - totCond) / totMosto) * 100).toFixed(1) : '0.0'}%</td>
                <td class="num">-</td>
                <td class="num">${totHlGrado.toFixed(2)}</td>
                <td class="num">${rateEurHlPlato.toFixed(3)}</td>
                <td class="num">€ ${totAccisa.toFixed(2)}</td>
            </tr>
        </tfoot>
    </table>

    <div class="signatures">
        <div class="sig-box">Titolare Deposito Fiscale / Microbirrificio</div>
        <div class="sig-box">Visto Contabilità Accise Dogane</div>
    </div>
</body>
</html>`;

    triggerA4PrintHtml(html);
};

export const exportExciseRegisterToExcel = (
    year: string,
    monthLabel: string,
    profile: BreweryProfile,
    rows: ExciseRegisterRow[]
) => {
    const wb = XLSX.utils.book_new();
    const aoa: (string | number)[][] = [
        [`REGISTRO PROSPETTO ACCISE BIRRA (ADM) — ${profile.ragioneSociale}`],
        [`Codice Accisa: ${profile.codiceAccisa || 'N/D'} — P.IVA: ${profile.partitaIva || 'N/D'} — Periodo: ${monthLabel} (${year})`],
        [],
        [
            'LOTTO',
            'DATA COTTA',
            'DATA CONF.',
            'BIRRA',
            'PROPRIETA',
            'MALTI (KG)',
            'MOSTO (HL)',
            'BIRRA CONDIZIONATA (HL)',
            'CALO (%)',
            'PLATO FISCALE (°P)',
            'ETTOLITRI-GRADO',
            'ALIQUOTA (€/HL°P)',
            'ACCISA MATURATA (€)',
        ],
        ...rows.map(r => [
            r.lotto,
            r.dataProd,
            r.dataUltimoConf,
            r.nomeBirra,
            r.cliente,
            Number(r.maltiKg.toFixed(2)),
            Number(r.mostoHl.toFixed(3)),
            Number(r.condizionataHl.toFixed(4)),
            Number(r.caloPercent.toFixed(2)),
            Number(r.platoFiscale.toFixed(1)),
            Number(r.ettolitriGrado.toFixed(3)),
            Number(r.aliquotaApplicata.toFixed(3)),
            Number(r.accisaMaturata.toFixed(2)),
        ]),
    ];

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [
        { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 24 }, { wch: 18 },
        { wch: 12 }, { wch: 12 }, { wch: 22 }, { wch: 10 }, { wch: 16 },
        { wch: 16 }, { wch: 16 }, { wch: 18 },
    ];
    XLSX.utils.book_append_sheet(wb, ws, `Accise_${year}`);
    XLSX.writeFile(wb, `Prospetto_Accise_ADM_${year}_${monthLabel.replace(/\s+/g, '_')}.xlsx`);
};

const toIsoDateFromIt = (itDate: string): string => {
    if (!itDate) return new Date().toISOString().slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(itDate)) return itDate;
    const parts = itDate.split('/');
    if (parts.length === 3) {
        const [d, m, y] = parts;
        return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }
    return new Date().toISOString().slice(0, 10);
};

const parseCapComuneProv = (raw: string | undefined) => {
    const clean = (raw || '').trim();
    const match = clean.match(/(\d{5})\s+([A-Za-zÀ-ÿ'’\s-]+?)(?:\s*\(?([A-Z]{2})\)?)?$/);
    if (match) {
        return {
            cap: match[1] || '00000',
            comune: (match[2] || 'Comune').trim(),
            provincia: (match[3] || 'RM').toUpperCase(),
        };
    }
    return {
        cap: '00000',
        comune: clean || 'Comune',
        provincia: 'IT',
    };
};

/**
 * Genera e scarica il tracciato XML FatturaPA v1.2.2 (FPR12 — TD24 Fattura Differita da DDT).
 */
export const downloadFatturaPaXml = (
    invoice: SummaryInvoice,
    profile: BreweryProfile,
    client?: Cliente
) => {
    const cleanCedentePiva = (profile.partitaIva || '').replace(/\D/g, '') || '00000000000';
    const cleanClientPiva = (client?.partitaIva || '').replace(/\D/g, '');
    const cleanClientCf = (client?.codiceFiscale || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const sdiCode = (client?.codiceUnivocoSdi || '').toUpperCase().replace(/[^A-Z0-9]/g, '') || '0000000';

    const cedenteLoc = parseCapComuneProv(profile.capCittaProvincia);
    const clientLoc = {
        cap: client?.cap?.trim() || parseCapComuneProv(client?.sedeSociale).cap,
        comune: client?.comune?.trim() || parseCapComuneProv(client?.sedeSociale).comune,
        provincia: (client?.provincia?.trim() || parseCapComuneProv(client?.sedeSociale).provincia).slice(0, 2).toUpperCase(),
    };

    const progressivoInvio = invoice.numeroFattura.replace(/[^A-Za-z0-9]/g, '').slice(-5).padStart(5, '0');
    const dataEmissioneIso = toIsoDateFromIt(invoice.dataEmissione);
    const dataScadenzaIso = toIsoDateFromIt(invoice.dataScadenzaPagamento);

    // Mappa linee per ordine DDT per generare <DatiDDT> conformi art. 21 DPR 633/72
    const linesByOrderId = new Map<string, number[]>();
    invoice.lines.forEach((line, index) => {
        const lineNum = index + 1;
        if (line.ddtOrderId) {
            const arr = linesByOrderId.get(line.ddtOrderId) || [];
            arr.push(lineNum);
            linesByOrderId.set(line.ddtOrderId, arr);
        }
    });

    const datiDdtXml = invoice.ddtReferences.map(ddt => {
        const refLines = linesByOrderId.get(ddt.orderId) || [];
        return `
      <DatiDDT>
        <NumeroDDT>${escapeXml(ddt.numeroDdt.slice(0, 20))}</NumeroDDT>
        <DataDDT>${escapeXml(toIsoDateFromIt(ddt.dataDdt))}</DataDDT>${refLines.map(ln => `
        <RiferimentoNumeroLinea>${ln}</RiferimentoNumeroLinea>`).join('')}
      </DatiDDT>`;
    }).join('');

    const dettaglioLineeXml = invoice.lines.map((line, index) => `
      <DettaglioLinee>
        <NumeroLinea>${index + 1}</NumeroLinea>
        <Descrizione>${escapeXml(`${line.descrizione} (${line.formato}) - Lotto ${line.lotto}`.slice(0, 1000))}</Descrizione>
        <Quantita>${line.quantita.toFixed(2)}</Quantita>
        <UnitaMisura>PZ</UnitaMisura>
        <PrezzoUnitario>${line.prezzoUnitario.toFixed(4)}</PrezzoUnitario>
        <PrezzoTotale>${line.imponibile.toFixed(2)}</PrezzoTotale>
        <AliquotaIVA>${line.aliquotaIva.toFixed(2)}</AliquotaIVA>
      </DettaglioLinee>`).join('');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<p:FatturaElettronica versione="FPR12" xmlns:ds="http://www.w3.org/2000/09/xmldsig#" xmlns:p="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <FatturaElettronicaHeader>
    <DatiTrasmissione>
      <IdTrasmittente>
        <IdPaese>IT</IdPaese>
        <IdCodice>${escapeXml(cleanCedentePiva)}</IdCodice>
      </IdTrasmittente>
      <ProgressivoInvio>${escapeXml(progressivoInvio)}</ProgressivoInvio>
      <FormatoTrasmissione>FPR12</FormatoTrasmissione>
      <CodiceDestinatario>${escapeXml(sdiCode.padEnd(7, '0').slice(0, 7))}</CodiceDestinatario>${sdiCode === '0000000' && client?.pec ? `
      <PECDestinatario>${escapeXml(client.pec)}</PECDestinatario>` : ''}
    </DatiTrasmissione>
    <CedentePrestatore>
      <DatiAnagrafici>
        <IdFiscaleIVA>
          <IdPaese>IT</IdPaese>
          <IdCodice>${escapeXml(cleanCedentePiva)}</IdCodice>
        </IdFiscaleIVA>${profile.codiceFiscale ? `
        <CodiceFiscale>${escapeXml(profile.codiceFiscale.toUpperCase().replace(/[^A-Z0-9]/g, ''))}</CodiceFiscale>` : ''}
        <Anagrafica>
          <Denominazione>${escapeXml(profile.ragioneSociale)}</Denominazione>
        </Anagrafica>
        <RegimeFiscale>${escapeXml(profile.regimeFiscale || 'RF01')}</RegimeFiscale>
      </DatiAnagrafici>
      <Sede>
        <Indirizzo>${escapeXml(profile.indirizzo || 'Via Sede Legale 1')}</Indirizzo>
        <CAP>${escapeXml(cedenteLoc.cap.padEnd(5, '0').slice(0, 5))}</CAP>
        <Comune>${escapeXml(cedenteLoc.comune)}</Comune>${cedenteLoc.provincia.length === 2 ? `
        <Provincia>${escapeXml(cedenteLoc.provincia)}</Provincia>` : ''}
        <Nazione>IT</Nazione>
      </Sede>
    </CedentePrestatore>
    <CessionarioCommittente>
      <DatiAnagrafici>${cleanClientPiva ? `
        <IdFiscaleIVA>
          <IdPaese>IT</IdPaese>
          <IdCodice>${escapeXml(cleanClientPiva)}</IdCodice>
        </IdFiscaleIVA>` : ''}${cleanClientCf ? `
        <CodiceFiscale>${escapeXml(cleanClientCf)}</CodiceFiscale>` : (!cleanClientPiva ? `
        <CodiceFiscale>00000000000</CodiceFiscale>` : '')}
        <Anagrafica>
          <Denominazione>${escapeXml(client?.ragioneSociale || invoice.cliente)}</Denominazione>
        </Anagrafica>
      </DatiAnagrafici>
      <Sede>
        <Indirizzo>${escapeXml(client?.sedeSociale || 'Sede Cliente')}</Indirizzo>
        <CAP>${escapeXml(clientLoc.cap.padEnd(5, '0').slice(0, 5))}</CAP>
        <Comune>${escapeXml(clientLoc.comune)}</Comune>${clientLoc.provincia.length === 2 ? `
        <Provincia>${escapeXml(clientLoc.provincia)}</Provincia>` : ''}
        <Nazione>IT</Nazione>
      </Sede>
    </CessionarioCommittente>
  </FatturaElettronicaHeader>
  <FatturaElettronicaBody>
    <DatiGenerali>
      <DatiGeneraliDocumento>
        <TipoDocumento>TD24</TipoDocumento>
        <Divisa>EUR</Divisa>
        <Data>${escapeXml(dataEmissioneIso)}</Data>
        <Numero>${escapeXml(invoice.numeroFattura)}</Numero>
        <ImportoTotaleDocumento>${invoice.totaleDocumento.toFixed(2)}</ImportoTotaleDocumento>
        <Causale>${escapeXml(`Fattura differita riepilogativa DDT (${invoice.ddtReferences.map(d => d.numeroDdt).join(', ')})`.slice(0, 200))}</Causale>
      </DatiGeneraliDocumento>${datiDdtXml}
    </DatiGenerali>
    <DatiBeniServizi>${dettaglioLineeXml}
      <DatiRiepilogo>
        <AliquotaIVA>22.00</AliquotaIVA>
        <ImponibileImporto>${invoice.imponibileTotale.toFixed(2)}</ImponibileImporto>
        <Imposta>${invoice.ivaTotale.toFixed(2)}</Imposta>
        <EsigibilitaIVA>I</EsigibilitaIVA>
      </DatiRiepilogo>
    </DatiBeniServizi>
    <DatiPagamento>
      <CondizioniPagamento>TP02</CondizioniPagamento>
      <DettaglioPagamento>
        <ModalitaPagamento>${escapeXml(invoice.modalitaPagamento)}</ModalitaPagamento>
        <DataScadenzaPagamento>${escapeXml(dataScadenzaIso)}</DataScadenzaPagamento>
        <ImportoPagamento>${invoice.totaleDocumento.toFixed(2)}</ImportoPagamento>${profile.iban ? `
        <IBAN>${escapeXml(profile.iban.replace(/\s+/g, '').toUpperCase())}</IBAN>` : ''}
      </DettaglioPagamento>
    </DatiPagamento>
  </FatturaElettronicaBody>
</p:FatturaElettronica>`;

    const blob = new Blob([xml], { type: 'application/xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `IT${cleanCedentePiva}_${progressivoInvio}.xml`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
};

export const printCourtesyInvoiceA4 = (
    invoice: SummaryInvoice,
    profile: BreweryProfile,
    client?: Cliente
) => {
    const paymentLabels: Record<string, string> = {
        MP05: 'Bonifico Bancario (MP05)',
        MP12: 'Ricevuta Bancaria / Ri.Ba. (MP12)',
        MP01: 'Rimessa Diretta / Contanti (MP01)',
    };

    const html = `<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8" />
    <title>Fattura di Cortesia ${escapeHtml(invoice.numeroFattura)}</title>
    <style>${basePrintStyles}</style>
</head>
<body>
    <div class="header">
        <div>
            <div class="company">${escapeHtml(profile.ragioneSociale)}</div>
            <div>${escapeHtml(profile.indirizzo)} ${escapeHtml(profile.capCittaProvincia)}</div>
            <div>P.IVA: ${escapeHtml(profile.partitaIva || '-')} ${profile.codiceAccisa ? `· Cod. Accisa: ${escapeHtml(profile.codiceAccisa)}` : ''}</div>
            ${profile.iban ? `<div>IBAN: <strong>${escapeHtml(profile.iban)}</strong></div>` : ''}
        </div>
        <div class="doc-badge">
            <div class="doc-title">Fattura Differita Riepilogativa (TD24)</div>
            <div>Copia analogica di cortesia</div>
            <div>N. <strong>${escapeHtml(invoice.numeroFattura)}</strong> del <strong>${escapeHtml(invoice.dataEmissione)}</strong></div>
        </div>
    </div>

    <div class="meta-grid" style="grid-template-columns: 2fr 1fr 1fr;">
        <div class="meta-item">
            <label>Cessionario / Cliente</label>
            <span>${escapeHtml(client?.ragioneSociale || invoice.cliente)}</span>
            <div style="font-size:10px; color:#334155;">
                ${escapeHtml(client?.sedeSociale || '')} · P.IVA: ${escapeHtml(client?.partitaIva || '-')}
                ${client?.codiceUnivocoSdi ? ` · SDI: ${escapeHtml(client.codiceUnivocoSdi)}` : ''}
            </div>
        </div>
        <div class="meta-item">
            <label>Modalità Pagamento</label>
            <span>${escapeHtml(paymentLabels[invoice.modalitaPagamento] || invoice.modalitaPagamento)}</span>
        </div>
        <div class="meta-item">
            <label>Scadenza Pagamento</label>
            <span>${escapeHtml(invoice.dataScadenzaPagamento)}</span>
        </div>
    </div>

    <div class="section">
        <div class="section-title">Documenti di Trasporto (DDT) Riepilogati</div>
        <div style="padding:4px 2px; font-size:10.5px;">
            ${invoice.ddtReferences.map(d => `DDT <strong>${escapeHtml(d.numeroDdt)}</strong> del ${escapeHtml(d.dataDdt)}`).join(' · ')}
        </div>
    </div>

    <div class="section">
        <div class="section-title">Dettaglio Fornitura</div>
        <table>
            <thead>
                <tr>
                    <th>#</th>
                    <th>Descrizione Prodotto</th>
                    <th>Formato</th>
                    <th>Lotto</th>
                    <th class="num">Q.tà</th>
                    <th class="num">Prezzo Unit. (€)</th>
                    <th class="num">IVA %</th>
                    <th class="num">Imponibile (€)</th>
                </tr>
            </thead>
            <tbody>
                ${invoice.lines.map((l, idx) => `
                <tr>
                    <td>${idx + 1}</td>
                    <td>${escapeHtml(l.descrizione)}</td>
                    <td>${escapeHtml(l.formato)}</td>
                    <td>${escapeHtml(l.lotto)}</td>
                    <td class="num">${l.quantita}</td>
                    <td class="num">${l.prezzoUnitario.toFixed(2)}</td>
                    <td class="num">${l.aliquotaIva.toFixed(0)}%</td>
                    <td class="num">${l.imponibile.toFixed(2)}</td>
                </tr>`).join('')}
            </tbody>
        </table>
    </div>

    <div style="display:flex; justify-content:flex-end; margin-top:12px;">
        <table style="width:280px;">
            <tbody>
                <tr><th>Totale Imponibile</th><td class="num">€ ${invoice.imponibileTotale.toFixed(2)}</td></tr>
                <tr><th>IVA 22%</th><td class="num">€ ${invoice.ivaTotale.toFixed(2)}</td></tr>
                <tr style="font-size:13px; background:#f1f5f9;"><th>TOTALE FATTURA</th><td class="num"><strong>€ ${invoice.totaleDocumento.toFixed(2)}</strong></td></tr>
            </tbody>
        </table>
    </div>
</body>
</html>`;

    triggerA4PrintHtml(html);
};

export const printInternalTransferDdtA4 = (
    transfer: InternalTransferDDT,
    profile: BreweryProfile
) => {
    const totalUnits = transfer.items.reduce((s, i) => s + i.quantita, 0);
    const totalLiters = transfer.items.reduce((s, i) => s + i.litri, 0);

    const html = `<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8" />
    <title>DDT Trasferimento Interno ${escapeHtml(transfer.numeroDdt)}</title>
    <style>${basePrintStyles}</style>
</head>
<body>
    <div class="header">
        <div>
            <div class="company">${escapeHtml(profile.ragioneSociale)}</div>
            <div>${escapeHtml(profile.indirizzo)} ${escapeHtml(profile.capCittaProvincia)}</div>
            <div>P.IVA: ${escapeHtml(profile.partitaIva || '-')}${profile.codiceFiscale ? ` · C.F.: ${escapeHtml(profile.codiceFiscale)}` : ''}${profile.codiceAccisa ? ` · Cod. Accisa: ${escapeHtml(profile.codiceAccisa)}` : ''}</div>
            ${profile.telefono || profile.pec ? `<div>${[profile.telefono ? `Tel: ${escapeHtml(profile.telefono)}` : '', profile.pec ? `PEC: ${escapeHtml(profile.pec)}` : ''].filter(Boolean).join(' · ')}</div>` : ''}
        </div>
        <div class="doc-badge">
            <div class="doc-title">Documento di Trasporto (D.D.T.)</div>
            <div>D.P.R. 14 Agosto 1996 n. 472 — Trasferimento Birrificio ➔ Magazzino</div>
            <div>N. <strong>${escapeHtml(transfer.numeroDdt)}</strong> del <strong>${escapeHtml(transfer.data)}</strong></div>
        </div>
    </div>

    <div class="meta-grid" style="grid-template-columns: 1fr 1fr;">
        <div class="meta-item">
            <label>Luogo di Partenza (Cella Rifermentazione / Produzione)</label>
            <span>${escapeHtml(transfer.indirizzoPartenza || `${profile.ragioneSociale} — Unità Produttiva / Cella Birrificio`)}</span>
        </div>
        <div class="meta-item">
            <label>Luogo di Destinazione (Magazzino Centrale Vendita)</label>
            <span>${escapeHtml(transfer.indirizzoDestinazione || `${profile.ragioneSociale} — Deposito Centrale Prodotto Finito`)}</span>
        </div>
    </div>

    <div class="meta-grid" style="grid-template-columns: 2fr 1fr 1fr;">
        <div class="meta-item">
            <label>Causale del Trasporto</label>
            <span>Trasferimento interno tra unità locali / depositi conto proprio (non costituisce cessione ex art. 2 DPR 633/72)</span>
        </div>
        <div class="meta-item">
            <label>Trasporto a mezzo / Targa</label>
            <span>${escapeHtml(transfer.mezzoTrasporto || 'Mittente (Conto Proprio)')}${transfer.targaMezzo ? ` · ${escapeHtml(transfer.targaMezzo)}` : ''}</span>
        </div>
        <div class="meta-item">
            <label>Conducente / Operatore</label>
            <span>${escapeHtml(transfer.conducente || '-')}</span>
        </div>
    </div>

    <div class="section">
        <div class="section-title">Elenco Prodotti Confezionati Trasferiti (Scarico Cella Birrificio ➔ Carico Magazzino Centrale)</div>
        <table>
            <thead>
                <tr>
                    <th>#</th>
                    <th>Proprietà / Marchio</th>
                    <th>Birra</th>
                    <th>Formato</th>
                    <th>Lotto Produzione</th>
                    <th>TMC (Scadenza)</th>
                    <th class="num">Unità / Colli</th>
                    <th class="num">Volume (Litri)</th>
                </tr>
            </thead>
            <tbody>
                ${transfer.items.map((item, idx) => `
                <tr>
                    <td>${idx + 1}</td>
                    <td>${escapeHtml(item.cliente)}</td>
                    <td><strong>${escapeHtml(item.nomeBirra)}</strong></td>
                    <td>${escapeHtml(item.formato)}</td>
                    <td><strong>${escapeHtml(item.lotto)}</strong></td>
                    <td>${escapeHtml(item.dataScadenza || '-')}</td>
                    <td class="num">${item.quantita}</td>
                    <td class="num">${item.litri.toFixed(2)}</td>
                </tr>`).join('')}
            </tbody>
            <tfoot>
                <tr style="font-weight:800; background:#f1f5f9;">
                    <td colspan="6">TOTALE MERCE TRASPORTATA (${transfer.items.length} righe lotto)</td>
                    <td class="num">${totalUnits}</td>
                    <td class="num">${totalLiters.toFixed(2)} L (${(totalLiters / 100).toFixed(2)} hL)</td>
                </tr>
            </tfoot>
        </table>
    </div>

    ${transfer.note ? `
    <div class="section">
        <div class="section-title">Annotazioni / Condizioni di Trasporto</div>
        <div style="padding:6px; border:1px solid #cbd5e1; border-radius:4px;">${escapeHtml(transfer.note)}</div>
    </div>` : ''}

    <div class="signatures" style="grid-template-columns: 1fr 1fr 1fr;">
        <div class="sig-box">Data e Ora Inizio Trasporto</div>
        <div class="sig-box">Firma Conducente / Incaricato</div>
        <div class="sig-box">Firma Ricezione Magazzino Centrale</div>
    </div>
</body>
</html>`;

    triggerA4PrintHtml(html);
};

const WASTE_REASON_LABELS: Record<string, string> = {
    SCADENZA_TMC: 'Superamento TMC / Scadenza Prodotto',
    OSSIDAZIONE_DIFETTO: 'Ossidazione / Difetto Organolettico',
    CONTESTAZIONE_CLIENTE: 'Reso / Contestazione Qualità Cliente',
    ROTTURA_PERDITA: 'Rottura / Perdita Accidentale',
    CAMPIONATURA_ANALISI: 'Campionatura Laboratorio / Analisi',
};

const getFormatUnitLiters = (format: string): number => {
    if (CONFIG_PACKAGING[format]) return CONFIG_PACKAGING[format].litriUnit;
    const upper = (format || '').toUpperCase();
    if (upper.includes('30')) return 30;
    if (upper.includes('24')) return 24;
    if (upper.includes('20')) return 20;
    if (upper.includes('75')) return 0.75;
    if (upper.includes('50')) return 0.5;
    if (upper.includes('33')) return 0.33;
    if (upper.includes('5L') || upper.includes('5 LT')) return 5;
    return 1;
};

export const printWasteDdtA4 = (
    movementsInput: BeerMovement | BeerMovement[],
    profile: BreweryProfile,
    extra?: { causaleLabel?: string; destinationNote?: string }
) => {
    const items = Array.isArray(movementsInput) ? movementsInput : [movementsInput];
    if (items.length === 0) return;

    const first = items[0];
    const ddtNo = first.ddtNumber || first.id;
    const ddtDate = first.data;
    const causale = extra?.causaleLabel
        || (first.wasteReason ? WASTE_REASON_LABELS[first.wasteReason] : undefined)
        || 'Scarto prodotto finito per deterioramento / non conformità';

    let totUnits = 0;
    let totLiters = 0;

    const rowsHtml = items.map((m, idx) => {
        const qty = Math.abs(m.quantita);
        const liters = qty * getFormatUnitLiters(m.formato);
        totUnits += qty;
        totLiters += liters;
        const reasonStr = (m.wasteReason && WASTE_REASON_LABELS[m.wasteReason]) || 'Deterioramento / Scarto';
        const locLabel = m.location === 'CELLA_BIRRIFICIO' ? 'Cella Birrificio' : 'Magazzino Centrale';

        return `
        <tr>
            <td>${idx + 1}</td>
            <td>${escapeHtml(m.cliente)}</td>
            <td><strong>${escapeHtml(m.nomeBirra)}</strong></td>
            <td><strong>${escapeHtml(m.lotto)}</strong></td>
            <td>${escapeHtml(m.formato)}</td>
            <td>${escapeHtml(locLabel)}</td>
            <td>${escapeHtml(reasonStr)}</td>
            <td class="num">${qty}</td>
            <td class="num">${liters.toFixed(2)}</td>
        </tr>`;
    }).join('');

    const html = `<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8" />
    <title>DDT Scarto Prodotto ${escapeHtml(ddtNo)}</title>
    <style>${basePrintStyles}</style>
</head>
<body>
    <div class="header">
        <div>
            <div class="company">${escapeHtml(profile.ragioneSociale)}</div>
            <div>${escapeHtml(profile.indirizzo)} ${escapeHtml(profile.capCittaProvincia)}</div>
            <div>P.IVA: ${escapeHtml(profile.partitaIva || '-')}${profile.codiceFiscale ? ` · C.F.: ${escapeHtml(profile.codiceFiscale)}` : ''}${profile.codiceAccisa ? ` · Cod. Accisa: ${escapeHtml(profile.codiceAccisa)}` : ''}</div>
            ${profile.telefono || profile.pec ? `<div>${[profile.telefono ? `Tel: ${escapeHtml(profile.telefono)}` : '', profile.pec ? `PEC: ${escapeHtml(profile.pec)}` : ''].filter(Boolean).join(' · ')}</div>` : ''}
        </div>
        <div class="doc-badge">
            <div class="doc-title" style="color:#b91c1c;">DDT Scarto / Deterioramento Prodotto</div>
            <div>Scarico Merce Inidonea / Non Conforme</div>
            <div>N. <strong>${escapeHtml(ddtNo)}</strong> del <strong>${escapeHtml(ddtDate)}</strong></div>
        </div>
    </div>

    <div class="meta-grid" style="grid-template-columns: 1.5fr 1fr 1fr;">
        <div class="meta-item">
            <label>Causale Trasporto / Scarico</label>
            <span>${escapeHtml(causale)}</span>
        </div>
        <div class="meta-item">
            <label>Destinazione / Smaltimento</label>
            <span>${escapeHtml(extra?.destinationNote || 'Avvio a distruzione / smaltimento controllato')}</span>
        </div>
        <div class="meta-item">
            <label>Volume Totale Scartato</label>
            <span>${totUnits} pz · ${totLiters.toFixed(2)} L (${(totLiters / 100).toFixed(3)} hL)</span>
        </div>
    </div>

    <div class="section">
        <div class="section-title">Distinta Birra Confezionata Scaricata per Deterioramento / Scarto</div>
        <table>
            <thead>
                <tr>
                    <th>#</th>
                    <th>Proprietà / Marchio</th>
                    <th>Birra</th>
                    <th>Lotto Prod.</th>
                    <th>Formato</th>
                    <th>Polo Origine</th>
                    <th>Causale Dettaglio</th>
                    <th class="num">Unità</th>
                    <th class="num">Litri</th>
                </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
            <tfoot>
                <tr style="font-weight:800; background:#f1f5f9;">
                    <td colspan="7">TOTALE MERCE AVVIATA A SCARTO / DISTRUZIONE</td>
                    <td class="num">${totUnits}</td>
                    <td class="num">${totLiters.toFixed(2)} L (${(totLiters / 100).toFixed(3)} hL)</td>
                </tr>
            </tfoot>
        </table>
    </div>

    ${first.notes ? `
    <div class="section">
        <div class="section-title">Note / Verbale Non Conformità</div>
        <div style="padding:6px; border:1px solid #cbd5e1; border-radius:4px;">${escapeHtml(first.notes)}</div>
    </div>` : ''}

    <div class="signatures" style="grid-template-columns: 1fr 1fr 1fr;">
        <div class="sig-box">Firma Responsabile Birrificio / Magazzino</div>
        <div class="sig-box">Firma Responsabile Qualità / HACCP</div>
        <div class="sig-box">Firma Addetto Smaltimento / Vettore</div>
    </div>
</body>
</html>`;

    triggerA4PrintHtml(html);
};

export interface AdmDestructionRow {
    id: string;
    dataScarico: string;
    lotto: string;
    nomeBirra: string;
    cliente: string;
    formato: string;
    quantitaUnita: number;
    litriTotali: number;
    ettolitri: number;
    platoFiscale: number;
    ettolitriGrado: number;
    aliquotaApplicata: number;
    accisaRecuperabile: number;
    causaleLabel: string;
    note?: string;
}

export const printAdmDestructionNoticeA4 = (params: {
    year: string;
    profile: BreweryProfile;
    ufficioDoganeDestinatario: string;
    dataPrevistaDistruzione: string;
    luogoDistruzione: string;
    modalitaSmaltimento: string;
    rateEurHlPlato: number;
    rows: AdmDestructionRow[];
}) => {
    const {
        year,
        profile,
        ufficioDoganeDestinatario,
        dataPrevistaDistruzione,
        luogoDistruzione,
        modalitaSmaltimento,
        rateEurHlPlato,
        rows,
    } = params;

    const totUnita = rows.reduce((s, r) => s + r.quantitaUnita, 0);
    const totLitri = rows.reduce((s, r) => s + r.litriTotali, 0);
    const totHl = rows.reduce((s, r) => s + r.ettolitri, 0);
    const totHlGrado = rows.reduce((s, r) => s + r.ettolitriGrado, 0);
    const totRimborso = rows.reduce((s, r) => s + r.accisaRecuperabile, 0);

    const html = `<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8" />
    <title>Comunicazione Distruzione Birra ADM ${escapeHtml(year)}</title>
    <style>${basePrintStyles}</style>
</head>
<body>
    <div class="header">
        <div>
            <div class="company">${escapeHtml(profile.ragioneSociale)}</div>
            <div>${escapeHtml(profile.indirizzo)} ${escapeHtml(profile.capCittaProvincia)}</div>
            <div>P.IVA: ${escapeHtml(profile.partitaIva || '-')} · Codice Accisa / Ditta ADM: <strong>${escapeHtml(profile.codiceAccisa || 'DA COMPILARE')}</strong></div>
            ${profile.pec ? `<div>PEC: ${escapeHtml(profile.pec)}</div>` : ''}
        </div>
        <div class="doc-badge">
            <div class="doc-title">Comunicazione Preventiva Distruzione Merce</div>
            <div>Istanza Rimborso / Accredito Accisa (Art. 14 e Art. 22 D.Lgs. 504/95 - TUA)</div>
            <div>Data documento: <strong>${escapeHtml(new Date().toLocaleDateString('it-IT'))}</strong></div>
        </div>
    </div>

    <div class="meta-grid" style="grid-template-columns: 1.5fr 1fr 1.5fr;">
        <div class="meta-item">
            <label>Spett.le Ufficio delle Dogane Competente (Invio PEC)</label>
            <span>${escapeHtml(ufficioDoganeDestinatario || 'Ufficio delle Dogane territorialmente competente')}</span>
        </div>
        <div class="meta-item">
            <label>Data / Ora Prevista Operazioni</label>
            <span>${escapeHtml(dataPrevistaDistruzione || 'Da concordare / Come da preavviso di legge')}</span>
        </div>
        <div class="meta-item">
            <label>Luogo & Modalità Distruzione / Smaltimento</label>
            <span>${escapeHtml(luogoDistruzione || profile.indirizzo || 'Sede deposito')} — ${escapeHtml(modalitaSmaltimento)}</span>
        </div>
    </div>

    <div style="margin-bottom: 10px; font-size: 10.5px; line-height: 1.45; border: 1px solid #cbd5e1; padding: 8px; border-radius: 4px; background: #ffffff;">
        Il sottoscritto legale rappresentante / titolare della ditta <strong>${escapeHtml(profile.ragioneSociale)}</strong>
        (Codice Accisa <strong>${escapeHtml(profile.codiceAccisa || '___________')}</strong>) comunica formalmente la necessità di procedere
        alla distruzione controllata delle partite di birra condizionata sotto elencate, divenute inidonee al consumo / commercializzazione
        per superamento TMC o difetto organolettico/qualitativo, con contestuale richiesta di riaccredito/sgravio dell&apos;accisa assolta
        ai sensi del Testo Unico Accise (D.Lgs. 504/1995).
    </div>

    <div class="meta-grid">
        <div class="meta-item"><label>Colli / Unità Totali</label><span>${totUnita} pz</span></div>
        <div class="meta-item"><label>Volume Da Distruggere</label><span>${totHl.toFixed(3)} hL (${totLitri.toFixed(1)} L)</span></div>
        <div class="meta-item"><label>Ettolitri-Grado Totali</label><span>${totHlGrado.toFixed(2)} hL·°P</span></div>
        <div class="meta-item"><label>Accisa Recuperabile Stimata</label><span>€ ${totRimborso.toFixed(2)}</span></div>
    </div>

    <div class="section">
        <div class="section-title">Distinta Analitica Lotti Birra Condizionata Avviati a Scarto / Distruzione</div>
        <table>
            <thead>
                <tr>
                    <th>Data Reg.</th>
                    <th>Lotto</th>
                    <th>Birra & Formato</th>
                    <th>Causale Non Conformità</th>
                    <th class="num">Unità</th>
                    <th class="num">Volume (hL)</th>
                    <th class="num">°P Fisc.</th>
                    <th class="num">hL·°Plato</th>
                    <th class="num">Accisa (€)</th>
                </tr>
            </thead>
            <tbody>
                ${rows.map(r => `
                <tr>
                    <td>${escapeHtml(r.dataScarico)}</td>
                    <td><strong>${escapeHtml(r.lotto)}</strong></td>
                    <td>${escapeHtml(r.nomeBirra)} · ${escapeHtml(r.formato)}</td>
                    <td>${escapeHtml(r.causaleLabel)}${r.note ? ` (${escapeHtml(r.note)})` : ''}</td>
                    <td class="num">${r.quantitaUnita}</td>
                    <td class="num">${r.ettolitri.toFixed(3)}</td>
                    <td class="num">${r.platoFiscale.toFixed(1)}</td>
                    <td class="num">${r.ettolitriGrado.toFixed(2)}</td>
                    <td class="num"><strong>€ ${r.accisaRecuperabile.toFixed(2)}</strong></td>
                </tr>`).join('')}
            </tbody>
            <tfoot>
                <tr style="font-weight:800; background:#f1f5f9;">
                    <td colspan="4">TOTALE LOTTI AVVIATI A DISTRUZIONE (${rows.length} partite — Aliquota € ${rateEurHlPlato.toFixed(3)}/hL·°P)</td>
                    <td class="num">${totUnita}</td>
                    <td class="num">${totHl.toFixed(3)}</td>
                    <td class="num">-</td>
                    <td class="num">${totHlGrado.toFixed(2)}</td>
                    <td class="num">€ ${totRimborso.toFixed(2)}</td>
                </tr>
            </tfoot>
        </table>
    </div>

    <div class="signatures" style="grid-template-columns: 1fr 1fr;">
        <div class="sig-box">Timbro e Firma Titolare / Legale Rappresentante</div>
        <div class="sig-box">Spazio Riservato Verbale Funzionari ADM / Organi di Controllo</div>
    </div>
</body>
</html>`;

    triggerA4PrintHtml(html);
};

export const exportAdmDestructionToExcel = (
    year: string,
    profile: BreweryProfile,
    rows: AdmDestructionRow[]
) => {
    const wb = XLSX.utils.book_new();
    const aoa: (string | number)[][] = [
        [`PROSPETTO LOTTI AVVIATI A DISTRUZIONE & RECUPERO ACCISA ADM — ${profile.ragioneSociale}`],
        [`Codice Accisa: ${profile.codiceAccisa || 'N/D'} — P.IVA: ${profile.partitaIva || 'N/D'} — Anno: ${year}`],
        [],
        [
            'DATA SCARICO',
            'LOTTO',
            'BIRRA',
            'PROPRIETA',
            'FORMATO',
            'CAUSALE SCARTO',
            'UNITA',
            'LITRI',
            'ETTOLITRI (HL)',
            'PLATO FISCALE (°P)',
            'ETTOLITRI-GRADO',
            'ALIQUOTA (€/HL°P)',
            'ACCISA RECUPERABILE (€)',
            'NOTE',
        ],
        ...rows.map(r => [
            r.dataScarico,
            r.lotto,
            r.nomeBirra,
            r.cliente,
            r.formato,
            r.causaleLabel,
            r.quantitaUnita,
            Number(r.litriTotali.toFixed(2)),
            Number(r.ettolitri.toFixed(4)),
            Number(r.platoFiscale.toFixed(1)),
            Number(r.ettolitriGrado.toFixed(3)),
            Number(r.aliquotaApplicata.toFixed(3)),
            Number(r.accisaRecuperabile.toFixed(2)),
            r.note || '',
        ]),
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    XLSX.utils.book_append_sheet(wb, ws, `Distruzioni_ADM_${year}`);
    XLSX.writeFile(wb, `Comunicazione_Distruzione_ADM_${year}.xlsx`);
};

