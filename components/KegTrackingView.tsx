import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
    getBreweryData,
    saveBreweryData,
    DEFAULT_KEG_FLEET_CONFIG,
    parseSteelKegFormat,
} from '../services/dataService';
import type {
    BreweryData,
    KegFleetConfigItem,
    KegFleetFormat,
    KegMovementLog,
    KegMovementType,
} from '../types';
import { useToast } from '../hooks/useToast';
import { CylinderStackIcon, TrashIcon, PlusIcon, CheckIcon } from './icons';

interface KegTrackingViewProps {
    selectedYear: string;
    onRefresh?: () => void;
}

const STEEL_FORMATS: KegFleetFormat[] = [
    'FUSTO ACCIAIO 20L',
    'FUSTO ACCIAIO 24L',
    'FUSTO ACCIAIO 30L',
];

const parseItDateToMs = (dateStr: string): number | null => {
    if (!dateStr) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        const ms = new Date(dateStr).getTime();
        return isNaN(ms) ? null : ms;
    }
    const parts = dateStr.split('/');
    if (parts.length === 3) {
        const [d, m, y] = parts.map(Number);
        if (!isNaN(d) && !isNaN(m) && !isNaN(y)) {
            return new Date(y, m - 1, d).getTime();
        }
    }
    return null;
};

const isoToItDate = (iso: string): string => {
    if (!iso) return new Date().toLocaleDateString('it-IT');
    const parts = iso.split('-');
    if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
    return iso;
};

interface ClientKegRow {
    cliente: string;
    telefono?: string;
    counts: Record<KegFleetFormat, number>;
    totalOut: number;
    depositEstimate: number;
    oldestOpenDate: string;
    daysOutMax: number;
}

export const KegTrackingView: React.FC<KegTrackingViewProps> = ({ selectedYear, onRefresh }) => {
    const { showToast } = useToast();
    const [breweryData, setBreweryData] = useState<BreweryData | null>(null);
    const [fleetDraft, setFleetDraft] = useState<KegFleetConfigItem[]>([]);
    const [showConfigPanel, setShowConfigPanel] = useState(false);

    // Client table filters
    const [clientFilter, setClientFilter] = useState<'ALL' | 'OVERDUE_60'>('ALL');
    const [searchQuery, setSearchQuery] = useState('');

    // Quick movement form (include 1-click combined Return + Wash & CO2 saturation)
    const [movType, setMovType] = useState<KegMovementType | 'RIENTRO_E_LAVAGGIO_CO2'>('RIENTRO_E_LAVAGGIO_CO2');
    const [movFormat, setMovFormat] = useState<KegFleetFormat>('FUSTO ACCIAIO 30L');
    const [movClient, setMovClient] = useState<string>('');
    const [movQty, setMovQty] = useState<string>('1');
    const [movDateIso, setMovDateIso] = useState<string>(() => new Date().toISOString().slice(0, 10));
    const [movNote, setMovNote] = useState<string>('');
    const [showWorkflowGuide, setShowWorkflowGuide] = useState<boolean>(false);

    const loadData = useCallback(async () => {
        const data = await getBreweryData(selectedYear);
        if (data) {
            setBreweryData(data);
            const savedCfg =
                data.KEG_FLEET_CONFIG && data.KEG_FLEET_CONFIG.length > 0
                    ? data.KEG_FLEET_CONFIG
                    : DEFAULT_KEG_FLEET_CONFIG;
            // Ensure all 3 formats exist
            const normalized = STEEL_FORMATS.map(fmt => {
                const found = savedCfg.find(x => x.formato === fmt);
                return found ? { ...found } : { formato: fmt, dotazioneTotale: 0, vuotiLavatiIniziali: 0, cauzioneUnitaria: 50 };
            });
            setFleetDraft(normalized);
        }
    }, [selectedYear]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const handleSaveFleetConfig = async () => {
        if (!breweryData) return;
        const updated: BreweryData = {
            ...breweryData,
            KEG_FLEET_CONFIG: fleetDraft.map(f => ({
                ...f,
                dotazioneTotale: Math.max(0, Math.round(Number(f.dotazioneTotale) || 0)),
                vuotiLavatiIniziali: Math.max(0, Math.round(Number(f.vuotiLavatiIniziali) || 0)),
                cauzioneUnitaria: Math.max(0, Number(f.cauzioneUnitaria) || 0),
            })),
        };
        await saveBreweryData(selectedYear, updated);
        setBreweryData(updated);
        setShowConfigPanel(false);
        showToast('Configurazione parco fusti inox salvata.', 'success');
        onRefresh?.();
    };

    // Compute Full Keg Status & Per-Customer FIFO Aging
    const kegAnalytics = useMemo(() => {
        const cfgByFormat = new Map<KegFleetFormat, KegFleetConfigItem>();
        fleetDraft.forEach(c => cfgByFormat.set(c.formato, c));

        // 1. Full kegs currently in Cold Room (Pieni in Cella)
        const lotFormatStock = new Map<string, { formato: KegFleetFormat; qty: number }>();
        if (breweryData) {
            (breweryData.BEER_WAREHOUSE_INITIAL || []).forEach(item => {
                const kf = parseSteelKegFormat(item.formato);
                if (!kf) return;
                const key = `${item.lotto}|${kf}`;
                const cur = lotFormatStock.get(key) || { formato: kf, qty: 0 };
                cur.qty += item.quantita;
                lotFormatStock.set(key, cur);
            });
            (breweryData.CONFEZIONAMENTO || []).forEach(pkg => {
                const kf = parseSteelKegFormat(pkg.FORMATO);
                if (!kf) return;
                const key = `${pkg.LOTTO_PROD}|${kf}`;
                const cur = lotFormatStock.get(key) || { formato: kf, qty: 0 };
                cur.qty += pkg.QTA_UNITA;
                lotFormatStock.set(key, cur);
            });
            (breweryData.BEER_MOVEMENTS || []).forEach(mov => {
                const kf = parseSteelKegFormat(mov.formato);
                if (!kf) return;
                const key = `${mov.lotto}|${kf}`;
                const cur = lotFormatStock.get(key) || { formato: kf, qty: 0 };
                cur.qty += mov.quantita;
                lotFormatStock.set(key, cur);
            });
        }

        const fullInCellar: Record<KegFleetFormat, number> = {
            'FUSTO ACCIAIO 20L': 0,
            'FUSTO ACCIAIO 24L': 0,
            'FUSTO ACCIAIO 30L': 0,
        };
        lotFormatStock.forEach(({ formato, qty }) => {
            if (qty > 0) fullInCellar[formato] += qty;
        });

        // 2. Process KEG_LOGS chronologically for customer FIFO queues + wash cycles
        const logs = [...(breweryData?.KEG_LOGS || [])];
        logs.sort((a, b) => (parseItDateToMs(a.data) || 0) - (parseItDateToMs(b.data) || 0));

        // Per normalized(client)+format FIFO queue of open deliveries: Array<{ date: string; ms: number; qty: number }>
        const clientQueues = new Map<string, Array<{ date: string; ms: number; qty: number }>>();
        const displayClientByKey = new Map<string, string>();
        const sporchiCount: Record<KegFleetFormat, number> = {
            'FUSTO ACCIAIO 20L': 0,
            'FUSTO ACCIAIO 24L': 0,
            'FUSTO ACCIAIO 30L': 0,
        };
        const washedTotal: Record<KegFleetFormat, number> = {
            'FUSTO ACCIAIO 20L': 0,
            'FUSTO ACCIAIO 24L': 0,
            'FUSTO ACCIAIO 30L': 0,
        };
        const fleetAdjTotal: Record<KegFleetFormat, number> = {
            'FUSTO ACCIAIO 20L': 0,
            'FUSTO ACCIAIO 24L': 0,
            'FUSTO ACCIAIO 30L': 0,
        };

        const deductFromQueue = (queueKey: string, amount: number): number => {
            if (amount <= 0) return 0;
            const q = clientQueues.get(queueKey);
            if (!q || q.length === 0) return amount;
            let rem = amount;
            while (rem > 0 && q.length > 0) {
                if (q[0].qty <= rem) {
                    rem -= q[0].qty;
                    q.shift();
                } else {
                    q[0].qty -= rem;
                    rem = 0;
                }
            }
            clientQueues.set(queueKey, q);
            return rem;
        };

        logs.forEach(log => {
            const fmt = log.formato;
            if (!STEEL_FORMATS.includes(fmt)) return;

            if (log.tipo === 'CONSEGNA_CLIENTE' && log.cliente && log.quantita > 0) {
                const trimmed = log.cliente.trim();
                const normClient = trimmed.toUpperCase();
                const key = `${normClient}|${fmt}`;
                if (!displayClientByKey.has(key)) displayClientByKey.set(key, trimmed);
                const q = clientQueues.get(key) || [];
                q.push({
                    date: log.data,
                    ms: parseItDateToMs(log.data) || Date.now(),
                    qty: log.quantita,
                });
                clientQueues.set(key, q);
            } else if (log.tipo === 'RIENTRO_VUOTO' && log.quantita > 0) {
                // Il rientro vuoto sporco incrementa i vuoti sporchi e scala i fusti fuori "Presso Clienti"
                sporchiCount[fmt] += log.quantita;
                let toDeduct = log.quantita;

                if (log.cliente && log.cliente.trim()) {
                    const targetKey = `${log.cliente.trim().toUpperCase()}|${fmt}`;
                    toDeduct = deductFromQueue(targetKey, toDeduct);
                }

                // Fallback 1: scala da "CLIENTI VARI / CONTO VENDITA" (fusti usciti per differenze inventariali)
                if (toDeduct > 0) {
                    toDeduct = deductFromQueue(`CLIENTI VARI / CONTO VENDITA|${fmt}`, toDeduct);
                }

                // Fallback 2: scala FIFO dalle eventuali code clienti residue per quel formato
                if (toDeduct > 0) {
                    const openKeysForFmt = Array.from(clientQueues.entries())
                        .filter(([k, q]) => k.endsWith(`|${fmt}`) && q.length > 0)
                        .sort((a, b) => (a[1][0]?.ms || 0) - (b[1][0]?.ms || 0))
                        .map(([k]) => k);
                    for (const k of openKeysForFmt) {
                        if (toDeduct <= 0) break;
                        toDeduct = deductFromQueue(k, toDeduct);
                    }
                }
            } else if (log.tipo === 'LAVAGGIO_SANIFICAZIONE' && log.quantita > 0) {
                // Il lavaggio scala i vuoti sporchi e libera fusti nei Vuoti Lavati Pronti
                washedTotal[fmt] += log.quantita;
                sporchiCount[fmt] = Math.max(0, sporchiCount[fmt] - log.quantita);
            } else if (log.tipo === 'RETTIFICA_PARCO') {
                fleetAdjTotal[fmt] += log.quantita;
            }
        });

        // Aggregate per customer
        const todayMs = Date.now();
        const clientMap = new Map<string, ClientKegRow>();
        const phoneByClient = new Map<string, string | undefined>();
        (breweryData?.CLIENTI || []).forEach(c => {
            phoneByClient.set(c.nome.trim().toUpperCase(), c.numeroTelefono);
        });

        const outAtClients: Record<KegFleetFormat, number> = {
            'FUSTO ACCIAIO 20L': 0,
            'FUSTO ACCIAIO 24L': 0,
            'FUSTO ACCIAIO 30L': 0,
        };

        clientQueues.forEach((queue, key) => {
            const openQty = queue.reduce((s, item) => s + item.qty, 0);
            if (openQty <= 0) return;
            const sepIdx = key.lastIndexOf('|');
            const normClient = key.slice(0, sepIdx);
            const fmt = key.slice(sepIdx + 1) as KegFleetFormat;
            const displayClient = displayClientByKey.get(key) || normClient;
            outAtClients[fmt] += openQty;

            const unitDep = cfgByFormat.get(fmt)?.cauzioneUnitaria || 0;
            const existing = clientMap.get(normClient) || {
                cliente: displayClient,
                telefono: phoneByClient.get(normClient),
                counts: {
                    'FUSTO ACCIAIO 20L': 0,
                    'FUSTO ACCIAIO 24L': 0,
                    'FUSTO ACCIAIO 30L': 0,
                },
                totalOut: 0,
                depositEstimate: 0,
                oldestOpenDate: queue[0].date,
                daysOutMax: 0,
            };

            existing.counts[fmt] += openQty;
            existing.totalOut += openQty;
            existing.depositEstimate += openQty * unitDep;

            const oldestBatch = queue[0];
            const daysDiff = Math.max(0, Math.floor((todayMs - oldestBatch.ms) / (1000 * 60 * 60 * 24)));
            if (daysDiff >= existing.daysOutMax) {
                existing.daysOutMax = daysDiff;
                existing.oldestOpenDate = oldestBatch.date;
            }

            clientMap.set(normClient, existing);
        });

        const summaryCards = STEEL_FORMATS.map(fmt => {
            const cfg = cfgByFormat.get(fmt) || {
                formato: fmt,
                dotazioneTotale: 0,
                vuotiLavatiIniziali: 0,
                cauzioneUnitaria: 50,
            };
            const effectiveFleet = Math.max(0, cfg.dotazioneTotale + fleetAdjTotal[fmt]);
            const pieni = fullInCellar[fmt];
            const fuori = outAtClients[fmt];
            const sporchi = sporchiCount[fmt];
            const lavatiPronti =
                effectiveFleet > 0
                    ? Math.max(0, effectiveFleet - pieni - fuori - sporchi)
                    : Math.max(0, cfg.vuotiLavatiIniziali + washedTotal[fmt]);

            return {
                formato: fmt,
                shortLabel: fmt.replace('FUSTO ACCIAIO ', 'Inox '),
                effectiveFleet,
                isFleetConfigured: cfg.dotazioneTotale > 0,
                pieni,
                fuori,
                sporchi,
                lavatiPronti,
                cauzioneUnitaria: cfg.cauzioneUnitaria,
            };
        });

        const clientRows = Array.from(clientMap.values()).sort(
            (a, b) => b.daysOutMax - a.daysOutMax || b.totalOut - a.totalOut
        );

        const logsDesc = [...(breweryData?.KEG_LOGS || [])].sort(
            (a, b) => (parseItDateToMs(b.data) || 0) - (parseItDateToMs(a.data) || 0)
        );

        return {
            summaryCards,
            clientRows,
            logsDesc,
        };
    }, [breweryData, fleetDraft]);

    const filteredClientRows = useMemo(() => {
        return kegAnalytics.clientRows.filter(r => {
            if (clientFilter === 'OVERDUE_60' && r.daysOutMax < 60) return false;
            if (searchQuery.trim()) {
                return r.cliente.toLowerCase().includes(searchQuery.trim().toLowerCase());
            }
            return true;
        });
    }, [kegAnalytics.clientRows, clientFilter, searchQuery]);

    const handleRecordMovement = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!breweryData) return;

        const qtyNum = parseInt(movQty, 10);
        if (isNaN(qtyNum) || qtyNum === 0) {
            showToast('Inserisci una quantità valida diversa da zero.', 'error');
            return;
        }
        const requiresExplicitClient = movType === 'CONSEGNA_CLIENTE';
        const supportsClient =
            movType === 'RIENTRO_E_LAVAGGIO_CO2' ||
            movType === 'RIENTRO_VUOTO' ||
            movType === 'CONSEGNA_CLIENTE';

        if (requiresExplicitClient && !movClient.trim()) {
            showToast('Seleziona il cliente (oppure "CLIENTI VARI / CONTO VENDITA") per registrare la consegna.', 'error');
            return;
        }

        const effectiveClient = supportsClient
            ? (movClient.trim() || 'CLIENTI VARI / CONTO VENDITA')
            : undefined;

        const unitDep =
            fleetDraft.find(f => f.formato === movFormat)?.cauzioneUnitaria || 0;
        const formattedDate = isoToItDate(movDateIso);
        const absQty = Math.abs(qtyNum);

        const entriesToAdd: KegMovementLog[] = [];

        if (movType === 'RIENTRO_E_LAVAGGIO_CO2') {
            // 1 click per il flusso settimanale reale: rientro dal cliente + lavaggio, sanificazione e saturazione CO2 -> subito pronto!
            const ts = Date.now();
            entriesToAdd.push(
                {
                    id: `KEG_${ts}_RET`,
                    data: formattedDate,
                    tipo: 'RIENTRO_VUOTO',
                    formato: movFormat,
                    quantita: absQty,
                    cliente: effectiveClient,
                    note: movNote.trim() || 'Rientro vuoti settimanale (lavati e saturati CO2)',
                },
                {
                    id: `KEG_${ts}_WASH`,
                    data: formattedDate,
                    tipo: 'LAVAGGIO_SANIFICAZIONE',
                    formato: movFormat,
                    quantita: absQty,
                    note: movNote.trim() || 'Lavaggio, sanificazione e saturazione CO2 completati',
                }
            );
        } else {
            entriesToAdd.push({
                id: `KEG_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                data: formattedDate,
                tipo: movType,
                formato: movFormat,
                quantita: movType === 'RETTIFICA_PARCO' ? qtyNum : absQty,
                cliente: effectiveClient,
                cauzioneTotale: movType === 'CONSEGNA_CLIENTE' ? absQty * unitDep : undefined,
                note: movNote.trim() || undefined,
            });
        }

        const updated: BreweryData = {
            ...breweryData,
            KEG_LOGS: [...(breweryData.KEG_LOGS || []), ...entriesToAdd],
        };

        await saveBreweryData(selectedYear, updated);
        setBreweryData(updated);
        setMovQty('1');
        setMovNote('');
        showToast(
            movType === 'RIENTRO_E_LAVAGGIO_CO2'
                ? `${absQty}× ${movFormat} rientrati, lavati, sanificati e saturati CO2: ora sono in "Vuoti Lavati Pronti"!`
                : 'Movimento parco fusti registrato.',
            'success'
        );
        onRefresh?.();
    };

    const handleQuickPrefillReturn = (row: ClientKegRow) => {
        const preferredFormat =
            STEEL_FORMATS.find(fmt => row.counts[fmt] > 0) || 'FUSTO ACCIAIO 30L';
        setMovType('RIENTRO_E_LAVAGGIO_CO2');
        setMovClient(row.cliente);
        setMovFormat(preferredFormat);
        setMovQty(String(row.counts[preferredFormat] || 1));
        setMovNote('Rientro settimanale + lavaggio, sanificazione e saturazione CO2');
    };

    const handleQuickWashDirty = async (formato: KegFleetFormat, count: number) => {
        if (!breweryData || count <= 0) return;
        const entry: KegMovementLog = {
            id: `KEG_WASH_${Date.now()}`,
            data: new Date().toLocaleDateString('it-IT'),
            tipo: 'LAVAGGIO_SANIFICAZIONE',
            formato,
            quantita: count,
            note: 'Ciclo lavaggio e sanificazione lavafusti',
        };
        const updated: BreweryData = {
            ...breweryData,
            KEG_LOGS: [...(breweryData.KEG_LOGS || []), entry],
        };
        await saveBreweryData(selectedYear, updated);
        setBreweryData(updated);
        showToast(`Registrato lavaggio di ${count}× ${formato}.`, 'success');
    };

    const handleDeleteLog = async (log: KegMovementLog) => {
        if (!breweryData) return;
        if (log.relatedOrderId) {
            showToast(
                `Movimento generato automaticamente dall'ordine ${log.relatedOrderId}: modifica o elimina l'ordine per aggiornarlo.`,
                'warning'
            );
            return;
        }
        const updated: BreweryData = {
            ...breweryData,
            KEG_LOGS: (breweryData.KEG_LOGS || []).filter(l => l.id !== log.id),
        };
        await saveBreweryData(selectedYear, updated);
        setBreweryData(updated);
        showToast('Registrazione fusti eliminata.', 'success');
    };

    if (!breweryData) {
        return <div className="p-8 text-center text-slate-300">Caricamento parco fusti in acciaio...</div>;
    }

    const totalOutAll = kegAnalytics.summaryCards.reduce((s, c) => s + c.fuori, 0);
    const totalDepositOut = kegAnalytics.clientRows.reduce((s, r) => s + r.depositEstimate, 0);
    const overdueCount = kegAnalytics.clientRows.filter(r => r.daysOutMax >= 60).length;

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="bg-brew-dark p-5 rounded-lg border border-slate-700 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                    <div className="flex items-center gap-2.5">
                        <CylinderStackIcon className="w-7 h-7 text-brew-accent" />
                        <h1 className="text-2xl font-bold text-white tracking-tight">
                            Parco Fusti in Acciaio a Rendere &amp; Cauzioni
                        </h1>
                    </div>
                    <p className="text-sm text-slate-400 mt-1">
                        Tracciamento rotazione fusti inox 20L / 24L / 30L · Saldi presso clienti, solleciti rientro e ciclo lavaggio
                    </p>
                </div>

                <div className="flex items-center gap-3">
                    <div className="text-right hidden sm:block">
                        <div className="text-xs uppercase text-slate-400">Valore Cauzioni Fuori</div>
                        <div className="text-lg font-bold font-mono tabular-nums text-brew-accent">
                            € {totalDepositOut.toFixed(2)} ({totalOutAll} fusti)
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={() => setShowWorkflowGuide(prev => !prev)}
                        className="px-3 py-2 rounded-md border border-sky-500/70 bg-sky-950/40 hover:bg-sky-900/50 text-xs font-bold text-sky-300 transition-colors"
                    >
                        {showWorkflowGuide ? 'Nascondi Guida' : '? Come Gestire Fusti & Inventario'}
                    </button>
                    <button
                        type="button"
                        onClick={() => setShowConfigPanel(prev => !prev)}
                        className="px-4 py-2 rounded-md border border-slate-600 bg-brew-dark-secondary hover:bg-slate-700 text-sm font-bold text-white transition-colors"
                    >
                        {showConfigPanel ? 'Chiudi Dotazione' : 'Configura Dotazione & Cauzioni'}
                    </button>
                </div>
            </div>

            {showWorkflowGuide && (
                <div className="bg-sky-950/30 border border-sky-500/60 p-4 rounded-lg text-xs text-slate-200 space-y-2">
                    <div className="font-bold text-sky-300 text-sm">
                        Flusso Operativo Consigliato: Parco Fusti Inox + Lavaggio Settimanale + Inventario Inizio Mese
                    </div>
                    <ol className="list-decimal pl-5 space-y-1.5 text-slate-300">
                        <li>
                            <strong className="text-white">Una tantum — Imposta la Dotazione Totale:</strong> clicca su <em>Configura Dotazione &amp; Cauzioni</em> e inserisci quanti fusti in acciaio possiede in totale il birrificio (es. 120 fusti da 30L). Non devi più caricarli/scaricarli nel Magazzino Materie Prime come se fossero fusti usa-e-getta!
                        </li>
                        <li>
                            <strong className="text-white">Al Confezionamento (Foglio Cotta):</strong> lascia attiva la spunta <em>&ldquo;Usa Parco Fusti Inox a Rendere&rdquo;</em>. Il software sposta automaticamente quei fusti da <strong>Vuoti Lavati Pronti</strong> a <strong>Pieni in Cella</strong>.
                        </li>
                        <li>
                            <strong className="text-white">All&apos;Uscita / Inventario Inizio Mese:</strong> se emetti un DDT da <em>Ordini Birra</em>, i fusti passano al singolo cliente; se invece rilevi le vendite per differenza all&apos;<strong>Inventario Birra Inizio Mese</strong>, il software sposta automaticamente i fusti venduti sotto la voce <strong>&ldquo;CLIENTI VARI / CONTO VENDITA&rdquo;</strong>!
                        </li>
                        <li>
                            <strong className="text-white">Settimana per Settimana (Lavaggio, Sanificazione &amp; CO2):</strong> quando ritiri i fusti vuoti, li lavi, sanifichi e saturi di CO2, compila qui a destra <strong>&ldquo;Rientro + Lavaggio, Sanificazione &amp; CO2 (Subito Pronti)&rdquo;</strong> selezionando il cliente (o <em>CLIENTI VARI / CONTO VENDITA</em>). Con un solo clic il fusto scala dai fusti fuori e torna subito in <strong>Vuoti Lavati Pronti</strong>!
                        </li>
                    </ol>
                </div>
            )}

            {/* Fleet Configuration Panel */}
            {showConfigPanel && (
                <div className="bg-brew-dark p-5 rounded-lg border border-brew-accent/60 space-y-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <h2 className="text-base font-bold text-white">
                                Configurazione Dotazione Parco Fusti di Proprietà
                            </h2>
                            <p className="text-xs text-slate-400">
                                Imposta il numero totale di fusti in acciaio posseduti dal birrificio e l&apos;importo cauzionale unitario per il calcolo automatico dei fusti vuoti lavati disponibili.
                            </p>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {fleetDraft.map((item, idx) => (
                            <div key={item.formato} className="bg-brew-dark-secondary p-4 rounded border border-slate-700 space-y-3">
                                <div className="font-bold text-sm text-brew-accent">{item.formato}</div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-xs text-slate-400 mb-1">Dotazione Totale (pz)</label>
                                        <input
                                            type="number"
                                            min={0}
                                            value={item.dotazioneTotale}
                                            onChange={e => {
                                                const next = [...fleetDraft];
                                                next[idx] = { ...next[idx], dotazioneTotale: Number(e.target.value) };
                                                setFleetDraft(next);
                                            }}
                                            className="w-full bg-brew-dark border border-slate-600 rounded px-2.5 py-1.5 text-sm font-mono tabular-nums text-white"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs text-slate-400 mb-1">Cauzione Unitaria (€)</label>
                                        <input
                                            type="number"
                                            min={0}
                                            step="0.5"
                                            value={item.cauzioneUnitaria}
                                            onChange={e => {
                                                const next = [...fleetDraft];
                                                next[idx] = { ...next[idx], cauzioneUnitaria: Number(e.target.value) };
                                                setFleetDraft(next);
                                            }}
                                            className="w-full bg-brew-dark border border-slate-600 rounded px-2.5 py-1.5 text-sm font-mono tabular-nums text-white"
                                        />
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>

                    <div className="flex justify-end">
                        <button
                            type="button"
                            onClick={handleSaveFleetConfig}
                            className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-brew-green text-white font-bold text-sm hover:opacity-90"
                        >
                            <CheckIcon className="w-4 h-4" />
                            Salva Dotazione Parco Fusti
                        </button>
                    </div>
                </div>
            )}

            {/* Format Breakdown Cards */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                {kegAnalytics.summaryCards.map(card => (
                    <div key={card.formato} className="bg-brew-dark p-5 rounded-lg border border-slate-700 space-y-4">
                        <div className="flex items-baseline justify-between border-b border-slate-700 pb-2.5">
                            <div>
                                <h2 className="text-lg font-bold text-white">{card.shortLabel}</h2>
                                <span className="text-xs text-slate-400 font-mono tabular-nums">
                                    Cauzione € {card.cauzioneUnitaria.toFixed(2)}/pz
                                </span>
                            </div>
                            <div className="text-right">
                                <span className="text-xs uppercase text-slate-400 block">Dotazione</span>
                                <span className="text-base font-bold font-mono tabular-nums text-slate-200">
                                    {card.isFleetConfigured ? `${card.effectiveFleet} pz` : 'Non impostata'}
                                </span>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3 font-mono tabular-nums">
                            <div className="bg-brew-dark-secondary p-3 rounded border border-slate-700">
                                <div className="text-[11px] font-sans uppercase text-slate-400">Vuoti Lavati Pronti</div>
                                <div className="text-xl font-bold text-emerald-400 mt-0.5">{card.lavatiPronti}</div>
                            </div>
                            <div className="bg-brew-dark-secondary p-3 rounded border border-slate-700">
                                <div className="text-[11px] font-sans uppercase text-slate-400">Pieni in Cella</div>
                                <div className="text-xl font-bold text-sky-400 mt-0.5">{card.pieni}</div>
                            </div>
                            <div className="bg-brew-dark-secondary p-3 rounded border border-slate-700">
                                <div className="text-[11px] font-sans uppercase text-slate-400">Presso Clienti</div>
                                <div className="text-xl font-bold text-brew-accent mt-0.5">{card.fuori}</div>
                            </div>
                            <div className="bg-brew-dark-secondary p-3 rounded border border-slate-700 flex flex-col justify-between">
                                <div className="text-[11px] font-sans uppercase text-slate-400">Vuoti Sporchi</div>
                                <div className="flex items-center justify-between mt-0.5">
                                    <span className={`text-xl font-bold ${card.sporchi > 0 ? 'text-amber-400' : 'text-slate-400'}`}>
                                        {card.sporchi}
                                    </span>
                                    {card.sporchi > 0 && (
                                        <button
                                            type="button"
                                            onClick={() => handleQuickWashDirty(card.formato, card.sporchi)}
                                            className="text-[11px] font-sans font-bold text-emerald-400 underline hover:text-emerald-300"
                                            title="Segna tutti i fusti sporchi come lavati e sanificati"
                                        >
                                            Lava ({card.sporchi})
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            {/* Main Operational Grid: Left = Client Balances, Right = Quick Operation Form */}
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
                {/* Customer Balances Table */}
                <div className="xl:col-span-8 bg-brew-dark p-5 rounded-lg border border-slate-700 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                            <h2 className="text-lg font-bold text-white">
                                Saldi Fusti Presso Clienti ({filteredClientRows.length})
                            </h2>
                            <p className="text-xs text-slate-400">
                                Le consegne fusti inox da Commissioni d&apos;Ordine e Ordini Confezionato aggiornano automaticamente i saldi.
                            </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                placeholder="Cerca cliente..."
                                className="bg-brew-dark-secondary border border-slate-600 rounded px-3 py-1.5 text-sm text-white placeholder-slate-400 focus:outline-none focus:border-brew-accent"
                            />
                            <div className="inline-flex rounded border border-slate-600 bg-brew-dark-secondary p-0.5 text-xs">
                                <button
                                    type="button"
                                    onClick={() => setClientFilter('ALL')}
                                    className={`px-2.5 py-1 rounded font-semibold ${
                                        clientFilter === 'ALL' ? 'bg-brew-blue text-white' : 'text-slate-300'
                                    }`}
                                >
                                    Tutti
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setClientFilter('OVERDUE_60')}
                                    className={`px-2.5 py-1 rounded font-semibold ${
                                        clientFilter === 'OVERDUE_60' ? 'bg-brew-orange text-white' : 'text-slate-300'
                                    }`}
                                >
                                    Oltre 60 gg ({overdueCount})
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left">
                            <thead className="text-xs uppercase text-slate-400 border-b border-slate-700">
                                <tr>
                                    <th className="py-2 pr-3">Cliente</th>
                                    <th className="py-2 px-2 text-right">20L</th>
                                    <th className="py-2 px-2 text-right">24L</th>
                                    <th className="py-2 px-2 text-right">30L</th>
                                    <th className="py-2 px-2 text-right">Totale</th>
                                    <th className="py-2 px-3">Permanenza</th>
                                    <th className="py-2 px-2 text-right">Cauzione</th>
                                    <th className="py-2 pl-2 text-right">Azione</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800">
                                {filteredClientRows.length === 0 ? (
                                    <tr>
                                        <td colSpan={8} className="py-6 text-center text-slate-400">
                                            Nessun fusto in acciaio attualmente aperto presso clienti con i filtri selezionati.
                                        </td>
                                    </tr>
                                ) : (
                                    filteredClientRows.map(row => {
                                        const agingStatus =
                                            row.daysOutMax >= 90
                                                ? { text: `${row.daysOutMax} gg · Sollecito`, cls: 'text-rose-400 font-bold' }
                                                : row.daysOutMax >= 60
                                                ? { text: `${row.daysOutMax} gg · Attenzione`, cls: 'text-amber-400 font-semibold' }
                                                : { text: `${row.daysOutMax} gg · Regolare`, cls: 'text-slate-300' };

                                        return (
                                            <tr key={row.cliente} className="hover:bg-brew-dark-secondary/60">
                                                <td className="py-2.5 pr-3">
                                                    <div className="font-semibold text-white">{row.cliente}</div>
                                                    <div className="text-xs text-slate-400 font-mono tabular-nums">
                                                        Dal {row.oldestOpenDate}
                                                        {row.telefono ? ` · ${row.telefono}` : ''}
                                                    </div>
                                                </td>
                                                <td className="py-2.5 px-2 text-right font-mono tabular-nums text-slate-300">
                                                    {row.counts['FUSTO ACCIAIO 20L'] || '-'}
                                                </td>
                                                <td className="py-2.5 px-2 text-right font-mono tabular-nums text-slate-300">
                                                    {row.counts['FUSTO ACCIAIO 24L'] || '-'}
                                                </td>
                                                <td className="py-2.5 px-2 text-right font-mono tabular-nums text-slate-300">
                                                    {row.counts['FUSTO ACCIAIO 30L'] || '-'}
                                                </td>
                                                <td className="py-2.5 px-2 text-right font-mono tabular-nums font-bold text-brew-accent">
                                                    {row.totalOut}
                                                </td>
                                                <td className={`py-2.5 px-3 text-xs font-mono tabular-nums ${agingStatus.cls}`}>
                                                    {agingStatus.text}
                                                </td>
                                                <td className="py-2.5 px-2 text-right font-mono tabular-nums text-slate-200">
                                                    € {row.depositEstimate.toFixed(0)}
                                                </td>
                                                <td className="py-2.5 pl-2 text-right">
                                                    <button
                                                        type="button"
                                                        onClick={() => handleQuickPrefillReturn(row)}
                                                        className="px-2.5 py-1 rounded bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-bold transition-colors"
                                                    >
                                                        Rientro Vuoti
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Quick Movement Registration Form */}
                <div className="xl:col-span-4 bg-brew-dark p-5 rounded-lg border border-slate-700">
                    <h2 className="text-lg font-bold text-white mb-1">Registra Operazione Fusti</h2>
                    <p className="text-xs text-slate-400 mb-4">
                        Registra rientri vuoti dal cliente, cicli di lavaggio lavafusti o rettifiche dotazione.
                    </p>

                    <form onSubmit={handleRecordMovement} className="space-y-3.5">
                        <div>
                            <label className="block text-xs font-bold uppercase text-slate-400 mb-1">
                                Tipo Movimento
                            </label>
                            <select
                                value={movType}
                                onChange={e =>
                                    setMovType(e.target.value as KegMovementType | 'RIENTRO_E_LAVAGGIO_CO2')
                                }
                                className="w-full bg-brew-dark-secondary border border-slate-600 rounded px-3 py-2 text-sm text-white"
                            >
                                <option value="RIENTRO_E_LAVAGGIO_CO2">
                                    Rientro + Lavaggio, Sanificazione &amp; CO2 (Subito Pronti)
                                </option>
                                <option value="RIENTRO_VUOTO">Solo Rientro Vuoti Sporchi (Da lavare dopo)</option>
                                <option value="LAVAGGIO_SANIFICAZIONE">Solo Lavaggio &amp; CO2 (Sporchi → Lavati Pronti)</option>
                                <option value="CONSEGNA_CLIENTE">Consegna Manuale a Cliente (Fuori Ordine)</option>
                                <option value="RETTIFICA_PARCO">Rettifica Dotazione (+ Acquisto / - Dismissione)</option>
                            </select>
                        </div>

                        <div>
                            <label className="block text-xs font-bold uppercase text-slate-400 mb-1">
                                Formato Fusto Inox
                            </label>
                            <select
                                value={movFormat}
                                onChange={e => setMovFormat(e.target.value as KegFleetFormat)}
                                className="w-full bg-brew-dark-secondary border border-slate-600 rounded px-3 py-2 text-sm text-white"
                            >
                                {STEEL_FORMATS.map(f => (
                                    <option key={f} value={f}>
                                        {f}
                                    </option>
                                ))}
                            </select>
                        </div>

                        {(movType === 'RIENTRO_E_LAVAGGIO_CO2' ||
                            movType === 'RIENTRO_VUOTO' ||
                            movType === 'CONSEGNA_CLIENTE') && (
                            <div>
                                <label className="block text-xs font-bold uppercase text-slate-400 mb-1">
                                    Cliente (o &ldquo;CLIENTI VARI / CONTO VENDITA&rdquo;)
                                </label>
                                <input
                                    list="keg-clients-datalist"
                                    type="text"
                                    value={movClient}
                                    onChange={e => setMovClient(e.target.value)}
                                    placeholder="Seleziona cliente o CLIENTI VARI / CONTO VENDITA..."
                                    className="w-full bg-brew-dark-secondary border border-slate-600 rounded px-3 py-2 text-sm text-white"
                                />
                                <datalist id="keg-clients-datalist">
                                    <option value="CLIENTI VARI / CONTO VENDITA" />
                                    {kegAnalytics.clientRows
                                        .filter(r => r.cliente !== 'CLIENTI VARI / CONTO VENDITA')
                                        .map(r => (
                                            <option key={`open_${r.cliente}`} value={r.cliente} />
                                        ))}
                                    {(breweryData.CLIENTI || [])
                                        .filter(
                                            c =>
                                                !kegAnalytics.clientRows.some(
                                                    r => r.cliente.toUpperCase() === c.nome.toUpperCase()
                                                )
                                        )
                                        .map(c => (
                                            <option key={c.id} value={c.nome} />
                                        ))}
                                </datalist>
                            </div>
                        )}

                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="block text-xs font-bold uppercase text-slate-400 mb-1">
                                    Quantità (pz)
                                </label>
                                <input
                                    type="number"
                                    step={1}
                                    min={movType === 'RETTIFICA_PARCO' ? -500 : 1}
                                    value={movQty}
                                    onChange={e => setMovQty(e.target.value)}
                                    className="w-full bg-brew-dark-secondary border border-slate-600 rounded px-3 py-2 text-sm font-mono tabular-nums text-white"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold uppercase text-slate-400 mb-1">
                                    Data Operazione
                                </label>
                                <input
                                    type="date"
                                    value={movDateIso}
                                    onChange={e => setMovDateIso(e.target.value)}
                                    className="w-full bg-brew-dark-secondary border border-slate-600 rounded px-3 py-2 text-sm font-mono tabular-nums text-white"
                                />
                            </div>
                        </div>

                        <div>
                            <label className="block text-xs font-bold uppercase text-slate-400 mb-1">
                                Note (opzionale)
                            </label>
                            <input
                                type="text"
                                value={movNote}
                                onChange={e => setMovNote(e.target.value)}
                                placeholder="Es. Ritiro furgone giro pub, fusto ammaccato..."
                                className="w-full bg-brew-dark-secondary border border-slate-600 rounded px-3 py-2 text-sm text-white"
                            />
                        </div>

                        <button
                            type="submit"
                            className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-md bg-brew-accent text-brew-dark font-bold text-sm hover:opacity-90 transition-opacity"
                        >
                            <PlusIcon className="w-4 h-4" />
                            Registra Movimento Fusti
                        </button>
                    </form>
                </div>
            </div>

            {/* Historical Keg Log */}
            <div className="bg-brew-dark p-5 rounded-lg border border-slate-700">
                <h2 className="text-base font-bold text-white mb-3">
                    Registro Storico Movimenti Parco Fusti ({kegAnalytics.logsDesc.length})
                </h2>
                <div className="overflow-x-auto max-h-72 overflow-y-auto">
                    <table className="w-full text-sm text-left">
                        <thead className="text-xs uppercase text-slate-400 border-b border-slate-700">
                            <tr>
                                <th className="py-2 pr-3">Data</th>
                                <th className="py-2 px-3">Operazione</th>
                                <th className="py-2 px-3">Formato</th>
                                <th className="py-2 px-3">Cliente / Origine</th>
                                <th className="py-2 px-3 text-right">Q.tà</th>
                                <th className="py-2 px-3">Note</th>
                                <th className="py-2 pl-3 text-right">Elimina</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800">
                            {kegAnalytics.logsDesc.length === 0 ? (
                                <tr>
                                    <td colSpan={7} className="py-4 text-center text-slate-400">
                                        Nessun movimento fusti registrato nell&apos;anno selezionato.
                                    </td>
                                </tr>
                            ) : (
                                kegAnalytics.logsDesc.slice(0, 100).map(log => {
                                    const typeLabel: Record<KegMovementType, { text: string; cls: string }> = {
                                        CONSEGNA_CLIENTE: { text: 'Consegna Cliente', cls: 'text-amber-400' },
                                        RIENTRO_VUOTO: { text: 'Rientro Vuoti', cls: 'text-emerald-400' },
                                        LAVAGGIO_SANIFICAZIONE: { text: 'Lavaggio Fusti', cls: 'text-sky-400' },
                                        RETTIFICA_PARCO: { text: 'Rettifica Parco', cls: 'text-slate-300' },
                                    };
                                    const meta = typeLabel[log.tipo];
                                    return (
                                        <tr key={log.id} className="hover:bg-brew-dark-secondary/50">
                                            <td className="py-2 pr-3 font-mono tabular-nums text-slate-300">{log.data}</td>
                                            <td className={`py-2 px-3 font-semibold ${meta.cls}`}>{meta.text}</td>
                                            <td className="py-2 px-3 text-white">{log.formato}</td>
                                            <td className="py-2 px-3 text-slate-300">
                                                {log.cliente || '-'}
                                                {log.lotto ? ` · Lotto ${log.lotto}` : ''}
                                            </td>
                                            <td className="py-2 px-3 text-right font-mono tabular-nums font-bold text-white">
                                                {log.quantita}
                                            </td>
                                            <td className="py-2 px-3 text-xs text-slate-400">{log.note || '-'}</td>
                                            <td className="py-2 pl-3 text-right">
                                                {log.relatedOrderId ? (
                                                    <span className="text-[11px] font-mono text-slate-500">
                                                        Auto ({log.relatedOrderId})
                                                    </span>
                                                ) : (
                                                    <button
                                                        type="button"
                                                        onClick={() => handleDeleteLog(log)}
                                                        className="text-slate-400 hover:text-rose-400 p-1"
                                                        title="Elimina registrazione manuale"
                                                    >
                                                        <TrashIcon className="w-4 h-4 inline" />
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};
