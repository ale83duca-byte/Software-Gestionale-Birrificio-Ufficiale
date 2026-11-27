import { CONFIG_PACKAGING } from '../constants';
import type { PackagedBeerOrder, SalesOrder, BreweryProfile, Cliente } from '../types';

const escapeHtml = (val: string | number | undefined | null): string => {
    if (val === undefined || val === null) return '';
    return String(val)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
};

const getLitersForFormat = (format: string): number => {
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

const computeColliForItem = (format: string, quantity: number): number => {
    const cfg = CONFIG_PACKAGING[format];
    if (cfg && format.toUpperCase().includes('BOTT') && cfg.pezziPerCartone > 0) {
        return Math.ceil(quantity / cfg.pezziPerCartone);
    }
    return quantity;
};

export const printOrderDDT = (
    order: PackagedBeerOrder | SalesOrder,
    options?: {
        profile?: BreweryProfile;
        clientDetails?: Cliente;
        causale?: string;
    }
) => {
    const isPricedOrder = 'totalNet' in order;
    const profile = options?.profile;
    const clientDetails = options?.clientDetails;
    const causale = options?.causale || (isPricedOrder ? 'Vendita' : 'Cessione / Conto Lavorazione BeerFirm');

    const ddtNumber = ('numeroDdt' in order && order.numeroDdt) ? order.numeroDdt : order.id;

    const issuerName = profile?.ragioneSociale?.trim() || 'BIRRIFICIO CENTRALE';
    const issuerAddress = [profile?.indirizzo, profile?.capCittaProvincia].filter(Boolean).join(' — ');
    const issuerFiscal = [
        profile?.partitaIva ? `P.IVA: ${profile.partitaIva}` : '',
        profile?.codiceFiscale ? `C.F.: ${profile.codiceFiscale}` : '',
        profile?.codiceAccisa ? `Cod. Accisa: ${profile.codiceAccisa}` : '',
    ].filter(Boolean).join(' • ');
    const issuerContacts = [
        profile?.telefono ? `Tel: ${profile.telefono}` : '',
        profile?.email ? `Email: ${profile.email}` : '',
        profile?.pec ? `PEC: ${profile.pec}` : '',
    ].filter(Boolean).join(' • ');

    const clientTitle = clientDetails?.ragioneSociale?.trim() || order.client;
    const clientLocationSuffix = [clientDetails?.cap, clientDetails?.comune, clientDetails?.provincia ? `(${clientDetails.provincia})` : ''].filter(Boolean).join(' ');
    const clientAddr = [clientDetails?.sedeSociale?.trim(), clientLocationSuffix].filter(Boolean).join(' — ') || '—';
    const clientFiscalParts = [
        clientDetails?.partitaIva?.trim() ? `P.IVA: ${clientDetails.partitaIva.trim()}` : '',
        clientDetails?.codiceFiscale?.trim() ? `C.F.: ${clientDetails.codiceFiscale.trim()}` : '',
    ].filter(Boolean);
    const clientPiva = clientFiscalParts.length > 0 ? clientFiscalParts.join(' • ') : '—';
    const clientPhone = clientDetails?.numeroTelefono?.trim() || '';

    let totalUnits = 0;
    let totalColli = 0;
    let totalLiters = 0;

    const rowsHtml = order.items.map((item, idx) => {
        const displayName = 'customBeerName' in item && item.customBeerName
            ? `${item.customBeerName} (Rif. ${item.beerName})`
            : item.beerName;
        const unitLiters = getLitersForFormat(item.format);
        const rowLiters = item.quantity * unitLiters;
        const rowColli = computeColliForItem(item.format, item.quantity);

        totalUnits += item.quantity;
        totalColli += rowColli;
        totalLiters += rowLiters;

        const priceCols = isPricedOrder && 'price' in item
            ? `<td class="num">€ ${item.price.toFixed(2)}</td>
               <td class="num bold">€ ${item.total.toFixed(2)}</td>`
            : '';

        return `
            <tr>
                <td class="center">${idx + 1}</td>
                <td class="bold">${escapeHtml(displayName)}</td>
                <td class="mono center">${escapeHtml(item.lotto)}</td>
                <td>${escapeHtml(item.format)}</td>
                <td class="num bold">${item.quantity}</td>
                <td class="num">${rowLiters.toFixed(2)} L</td>
                ${priceCols}
            </tr>
        `;
    }).join('');

    const html = `<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8" />
    <title>DDT ${escapeHtml(ddtNumber)} - ${escapeHtml(clientTitle)}</title>
    <style>
        @page { size: A4 portrait; margin: 12mm; }
        * { box-sizing: border-box; font-family: 'Segoe UI', Arial, Helvetica, sans-serif; color: #111827; }
        body { margin: 0; padding: 0; font-size: 11px; line-height: 1.4; background: #fff; }
        .header-grid { display: grid; grid-template-columns: 1.2fr 1fr; gap: 14px; margin-bottom: 14px; }
        .box { border: 1px solid #374151; border-radius: 4px; padding: 10px 12px; }
        .issuer-title { font-size: 16px; font-weight: 800; letter-spacing: 0.3px; margin: 0 0 4px 0; color: #0f172a; }
        .muted { color: #4b5563; font-size: 10px; margin: 2px 0; }
        .label { font-size: 9px; font-weight: 700; text-transform: uppercase; color: #6b7280; letter-spacing: 0.5px; }
        .doc-banner { background: #1e293b; color: #fff; padding: 8px 12px; border-radius: 4px; display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
        .doc-banner * { color: #fff; }
        .doc-title { font-size: 14px; font-weight: 800; letter-spacing: 0.5px; }
        .meta-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 12px; }
        .meta-cell { border: 1px solid #9ca3af; border-radius: 4px; padding: 6px 8px; }
        .meta-val { font-size: 11px; font-weight: 700; margin-top: 2px; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 14px; }
        th { background: #f1f5f9; border: 1px solid #475569; padding: 6px 8px; font-size: 10px; text-transform: uppercase; text-align: left; }
        td { border: 1px solid #cbd5e1; padding: 6px 8px; font-size: 11px; }
        .num { text-align: right; font-variant-numeric: tabular-nums; }
        .center { text-align: center; }
        .mono { font-family: Consolas, monospace; font-weight: 700; }
        .bold { font-weight: 700; }
        .totals-row { display: flex; justify-content: space-between; gap: 14px; margin-bottom: 14px; }
        .summary-box { flex: 1; border: 1px solid #475569; border-radius: 4px; padding: 8px 10px; }
        .fiscal-box { width: 240px; border: 1px solid #1e293b; border-radius: 4px; padding: 8px 10px; background: #f8fafc; }
        .fiscal-line { display: flex; justify-content: space-between; padding: 2px 0; }
        .fiscal-grand { border-top: 1.5px solid #1e293b; margin-top: 4px; padding-top: 4px; font-size: 13px; font-weight: 800; }
        .transport-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 14px; }
        .sign-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 18px; }
        .sign-box { border: 1px solid #475569; border-radius: 4px; padding: 8px 10px; height: 68px; display: flex; flex-direction: column; justify-content: space-between; }
        .footer-note { margin-top: 10px; font-size: 9px; color: #6b7280; text-align: center; }
    </style>
</head>
<body>
    <div class="header-grid">
        <div class="box">
            <div class="label">Mittente / Cedente</div>
            <div class="issuer-title">${escapeHtml(issuerName)}</div>
            ${issuerAddress ? `<div class="muted">${escapeHtml(issuerAddress)}</div>` : ''}
            ${issuerFiscal ? `<div class="muted bold">${escapeHtml(issuerFiscal)}</div>` : ''}
            ${issuerContacts ? `<div class="muted">${escapeHtml(issuerContacts)}</div>` : ''}
        </div>
        <div class="box">
            <div class="label">Destinatario / Cessionario</div>
            <div style="font-size:14px;font-weight:800;margin:2px 0 4px 0;">${escapeHtml(clientTitle)}</div>
            <div class="muted"><strong>Sede / Destinazione:</strong> ${escapeHtml(clientAddr)}</div>
            <div class="muted"><strong>Dati Fiscali:</strong> ${escapeHtml(clientPiva)}</div>
            ${clientPhone ? `<div class="muted"><strong>Telefono:</strong> ${escapeHtml(clientPhone)}</div>` : ''}
        </div>
    </div>

    <div class="doc-banner">
        <div class="doc-title">DOCUMENTO DI TRASPORTO (D.D.T.) — D.P.R. 472 del 14/08/1996</div>
        <div style="font-size:13px;font-weight:800;">N° ${escapeHtml(ddtNumber)}</div>
    </div>

    <div class="meta-grid">
        <div class="meta-cell">
            <div class="label">Data Documento</div>
            <div class="meta-val">${escapeHtml(order.date)}</div>
        </div>
        <div class="meta-cell">
            <div class="label">Causale del Trasporto</div>
            <div class="meta-val">${escapeHtml(causale)}</div>
        </div>
        <div class="meta-cell">
            <div class="label">Trasporto a cura del</div>
            <div class="meta-val">☐ Mittente &nbsp; ☐ Destin. &nbsp; ☐ Vettore</div>
        </div>
        <div class="meta-cell">
            <div class="label">Aspetto Esteriore dei Beni</div>
            <div class="meta-val">Cartoni / Fusti Birra</div>
        </div>
    </div>

    <table>
        <thead>
            <tr>
                <th style="width:32px;" class="center">#</th>
                <th>Descrizione Prodotto</th>
                <th style="width:105px;" class="center">Lotto Prod.</th>
                <th style="width:130px;">Formato</th>
                <th style="width:65px;" class="num">Q.tà (Pz)</th>
                <th style="width:85px;" class="num">Volume (L)</th>
                ${isPricedOrder ? '<th style="width:80px;" class="num">Prezzo</th><th style="width:85px;" class="num">Importo</th>' : ''}
            </tr>
        </thead>
        <tbody>
            ${rowsHtml}
        </tbody>
    </table>

    <div class="totals-row">
        <div class="summary-box">
            <div class="label">Riepilogo Quantità e Tracciabilità Accise / HACCP</div>
            <div style="display:flex;gap:24px;margin-top:6px;font-size:12px;">
                <div><strong>Totale Unità:</strong> ${totalUnits} pz</div>
                <div><strong>Numero Colli Stimati:</strong> ${totalColli}</div>
                <div><strong>Volume Complessivo:</strong> ${totalLiters.toFixed(2)} Litri (${(totalLiters / 100).toFixed(3)} hL)</div>
            </div>
            <div class="muted" style="margin-top:6px;">Annotazioni / Note consegna: ____________________________________________________________________</div>
        </div>
        ${isPricedOrder ? `
        <div class="fiscal-box">
            <div class="fiscal-line"><span>Imponibile Netto:</span><strong>€ ${order.totalNet.toFixed(2)}</strong></div>
            <div class="fiscal-line"><span>IVA (22%):</span><span>€ ${order.iva.toFixed(2)}</span></div>
            <div class="fiscal-line fiscal-grand"><span>TOTALE DOC.:</span><span>€ ${order.totalGross.toFixed(2)}</span></div>
        </div>
        ` : ''}
    </div>

    <div class="transport-grid">
        <div class="meta-cell">
            <div class="label">Vettore Incaricato</div>
            <div class="meta-val" style="height:18px;"></div>
        </div>
        <div class="meta-cell">
            <div class="label">Data e Ora Inizio Trasporto</div>
            <div class="meta-val">${escapeHtml(order.date)} — Ore ____:____</div>
        </div>
        <div class="meta-cell">
            <div class="label">Porto</div>
            <div class="meta-val">Franco / Assegnato</div>
        </div>
    </div>

    <div class="sign-grid">
        <div class="sign-box">
            <div class="label">Firma del Mittente</div>
            <div style="border-top:1px dotted #9ca3af;font-size:9px;color:#6b7280;padding-top:2px;">Timbro e firma</div>
        </div>
        <div class="sign-box">
            <div class="label">Firma del Vettore / Conducente</div>
            <div style="border-top:1px dotted #9ca3af;font-size:9px;color:#6b7280;padding-top:2px;">Data, ora ritiro e firma</div>
        </div>
        <div class="sign-box">
            <div class="label">Firma del Destinatario (per ricevuta)</div>
            <div style="border-top:1px dotted #9ca3af;font-size:9px;color:#6b7280;padding-top:2px;">Data e firma per accettazione merce</div>
        </div>
    </div>

    <div class="footer-note">
        Documento generato da gestionale birrificio — Conservare per tracciabilità lotti ai sensi del Reg. CE 178/2002 (HACCP).
    </div>
</body>
</html>`;

    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow?.document;
    if (!doc || !iframe.contentWindow) {
        document.body.removeChild(iframe);
        return;
    }

    doc.open();
    doc.write(html);
    doc.close();

    setTimeout(() => {
        try {
            iframe.contentWindow?.focus();
            iframe.contentWindow?.print();
        } finally {
            setTimeout(() => {
                if (iframe.parentNode) {
                    iframe.parentNode.removeChild(iframe);
                }
            }, 2000);
        }
    }, 250);
};
