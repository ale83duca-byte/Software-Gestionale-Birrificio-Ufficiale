import React, { useState, useEffect } from 'react';
import { TrashIcon, XMarkIcon, CalendarDaysIcon, BellAlertIcon, FireIcon } from './icons';
import { getBreweryData, deleteWarehouseItem, getEffectiveGasTankConfig, getEffectiveTechGasConfig } from '../services/dataService';
import { getTodayReminders, toggleCalendarNote } from '../services/calendarService';
import type { WarehouseStatus, Movement, PackagingData, RawWarehouseItem, TechGasCylinderItem } from '../types';
import { InitialInventoryModal } from './InitialInventoryModal';
import { useTranslation } from '../i18n';
import { isInventoryDay, getInventoryReminderInfo } from '../utils/inventoryReminder';
import { useToast } from '../hooks/useToast';
import { CONFIG_PACKAGING } from '../constants';
import { parseItalianDate } from '../utils/dateUtils';

interface HomeProps {
    warehouseStatus: WarehouseStatus | null;
    selectedYear: string;
    onRefresh: () => void;
    onNavigate?: (view: any) => void;
}

interface ProductionSummaryRow {
    numeroProgressivo: number;
    dataProduzione: string;
    cliente: string;
    lotto: string;
    litriContaMosto: string;
    plato: string;
    gasUtilizzato: string;
    tipologia: string;
    litriProdotti: string;
    numeroFermentatore: string;
    dataConfezionamento: string;
    litriConfezionati: string;
    modalitaConfezionamento: string;
}

const AlertBox: React.FC<{ title: string; items: React.ReactNode[]; type: 'warning' | 'info'; onClose: () => void; }> = ({ title, items, type, onClose }) => {
    if (items.length === 0) return null;

    const colors = {
        warning: 'border-yellow-500 bg-yellow-500/10 text-yellow-300',
        info: 'border-blue-500 bg-blue-500/10 text-blue-300',
    };

    return (
        <div className={`border rounded-lg p-3 shadow-md ${colors[type]} w-full max-w-sm backdrop-blur-sm`}>
            <div className="flex justify-between items-center mb-2">
                <h3 className="font-bold text-sm">{title}</h3>
                <button onClick={onClose} className="hover:text-white"><XMarkIcon className="w-4 h-4" /></button>
            </div>
            <ul className="text-xs list-none pl-0 space-y-1 max-h-24 overflow-y-auto">
                {items.map((item, index) => <li key={index}>{item}</li>)}
            </ul>
        </div>
    );
};


export const Home: React.FC<HomeProps> = ({ warehouseStatus, selectedYear, onRefresh, onNavigate }) => {
    const { t } = useTranslation();
    const { showToast } = useToast();
    const [showExpiring, setShowExpiring] = useState(true);
    const [showExpiringBeer, setShowExpiringBeer] = useState(true);
    const [showOutOfStock, setShowOutOfStock] = useState(true);
    const [initialInventory, setInitialInventory] = useState<Movement[]>([]);
    const [isInventoryModalOpen, setInventoryModalOpen] = useState(false);
    const [summaryData, setSummaryData] = useState<ProductionSummaryRow[]>([]);
    const [showInventoryReminder, setShowInventoryReminder] = useState(false);
    const [calendarReminders, setCalendarReminders] = useState<Awaited<ReturnType<typeof getTodayReminders>> | null>(null);
    const [gasReserveAlert, setGasReserveAlert] = useState<{ pct: number; remainingLiters: number; tipoGas: string } | null>(null);
    const [lowTechGasAlerts, setLowTechGasAlerts] = useState<TechGasCylinderItem[]>([]);
    const [cellarLossAlerts, setCellarLossAlerts] = useState<{ lotto: string; birra: string; litriMosto: number; litriConf: number; lossPct: number }[]>([]);
    const [showCellarLoss, setShowCellarLoss] = useState(true);

    const handleToggleCalendarNote = async (noteId: string) => {
        try {
            await toggleCalendarNote(selectedYear, noteId);
            const updated = await getTodayReminders(selectedYear);
            setCalendarReminders(updated);
            showToast('Promemoria aggiornato', 'success');
        } catch (e) {
            console.error('Errore toggle nota in Home:', e);
        }
    };

    useEffect(() => {
        const loadHomeData = async () => {
            setShowInventoryReminder(isInventoryDay());

            // Carica promemoria calendario e sincronizzazione cantina
            try {
                const reminders = await getTodayReminders(selectedYear);
                setCalendarReminders(reminders);
            } catch (err) {
                console.error('Errore caricamento promemoria calendario:', err);
            }

            const breweryData = await getBreweryData(selectedYear);
            if (!breweryData) return;

            const { MOVIMENTAZIONE, COTTE_HEAD, CONFEZIONAMENTO } = breweryData;

            const inventory = MOVIMENTAZIONE.filter(m => m.N_FATTURA === 'RIPORTO_ANNO_PREC' || m.FORNITORE === 'INVENTARIO INIZIALE');
            setInitialInventory(inventory);

            const sortedCotte = [...COTTE_HEAD].sort((a, b) => {
                 try {
                    const dateA = new Date(a.DATA_PROD.split('/').reverse().join('-')).getTime();
                    const dateB = new Date(b.DATA_PROD.split('/').reverse().join('-')).getTime();
                    if (isNaN(dateA) || isNaN(dateB)) return 0;
                    return dateA - dateB;
                } catch {
                    return 0;
                }
            });

            const processedData = sortedCotte.map((cotta, index): ProductionSummaryRow => {
                const relatedPackaging = (CONFEZIONAMENTO as PackagingData[]).filter(p => p.LOTTO_PROD === cotta.LOTTO);
                
                const litriConfezionati = relatedPackaging.reduce((sum, p) => sum + p.LITRI_TOT, 0);
                
                const firstPackagingDate = relatedPackaging.length > 0
                    ? relatedPackaging.sort((a, b) => {
                        try {
                           return new Date(a.DATA.split('/').reverse().join('-')).getTime() - new Date(b.DATA.split('/').reverse().join('-')).getTime()
                        } catch { return 0; }
                    })[0].DATA
                    : 'N/D';

                const packagingSummary: Record<string, number> = relatedPackaging.reduce((acc, p) => {
                    acc[p.FORMATO] = (acc[p.FORMATO] || 0) + p.QTA_UNITA;
                    return acc;
                }, {} as Record<string, number>);

                const packagingModes = Object.entries(packagingSummary).map(([formato, qta]) => {
                    const config = CONFIG_PACKAGING[formato];
                    if (config && formato.includes('BOTT') && config.pezziPerCartone > 0) {
                        const cartons = qta / config.pezziPerCartone;
                        const cartonStr = cartons.toFixed(1).replace(/\.0$/, '');
                        return `${cartonStr} CT x ${formato.replace('BOTT. ', '')}`;
                    }
                    return `${qta} x ${formato}`;
                }).join(' / ') || 'N/D';

                const parseCounter = (val: string | number | undefined) => {
                    if (typeof val === 'number') return val;
                    if (!val) return 0;
                    return parseFloat(val.replace(',', '.')) || 0;
                };

                const litriContaMostoCalc = parseCounter(cotta.mustCounterMeasured) - parseCounter(cotta.mustCounterPrevious);
    
                const gasCottaCalc = parseCounter(cotta.gasBrewCounterCurrent) - parseCounter(cotta.gasBrewCounterPrevious);
                const gasConfCalc = parseCounter(cotta.gasPackagingCounterCurrent) - parseCounter(cotta.gasPackagingCounterPrevious);
                const gasTotale = gasCottaCalc + gasConfCalc;

                return {
                    numeroProgressivo: index + 1,
                    dataProduzione: cotta.DATA_PROD,
                    cliente: cotta.CLIENTE,
                    lotto: cotta.LOTTO,
                    litriContaMosto: litriContaMostoCalc > 0 ? litriContaMostoCalc.toFixed(1) : 'N/D',
                    plato: cotta.PLATO_INIZIALE || 'N/D',
                    gasUtilizzato: gasTotale > 0 ? gasTotale.toFixed(2) : 'N/D',
                    tipologia: cotta.NOME_BIRRA,
                    litriProdotti: cotta.LITRI_FINALI,
                    numeroFermentatore: cotta.FERMENTATORE
                        ? (cotta.isCellarClosed ? `${cotta.FERMENTATORE} (Chiuso)` : cotta.FERMENTATORE)
                        : 'Chiuso',
                    dataConfezionamento: firstPackagingDate,
                    litriConfezionati: litriConfezionati.toFixed(1),
                    modalitaConfezionamento: packagingModes
                };
            });

            setSummaryData(processedData);

            // Verifica spia riserva Cisterna Gas (rispettando eventuale dataTaratura a anno in corso)
            const gasCfg = getEffectiveGasTankConfig(breweryData);
            const taraturaTime = gasCfg.dataTaratura ? (parseItalianDate(gasCfg.dataTaratura)?.getTime() ?? null) : null;
            const gasRefills = (breweryData.GAS_REFILLS || []).filter(r => {
                if (taraturaTime === null) return true;
                const d = parseItalianDate(r.data);
                return d ? d.getTime() > taraturaTime : true;
            });
            const totalGasLoadedLiters = (gasCfg.litriInizialiAnno || 0) + gasRefills.reduce((s, r) => s + (r.litriScaricati || 0), 0);
            if (totalGasLoadedLiters > 0) {
                const factor = gasCfg.fattoreConversioneLitriAMc > 0 ? gasCfg.fattoreConversioneLitriAMc : 0.26;
                const parseNum = (v: string | number | undefined) => {
                    if (typeof v === 'number') return v;
                    if (!v) return 0;
                    return parseFloat(String(v).replace(',', '.')) || 0;
                };
                const filteredCotteGas = COTTE_HEAD.filter(c => {
                    if (taraturaTime === null) return true;
                    const d = parseItalianDate(c.DATA_PROD);
                    return d ? d.getTime() > taraturaTime : true;
                });
                const totalMcUsed = filteredCotteGas.reduce((acc, c) => {
                    const directB = parseNum(c.GAS_COTTA);
                    const cntB = Math.max(0, parseNum(c.gasBrewCounterCurrent) - parseNum(c.gasBrewCounterPrevious));
                    const directP = parseNum(c.GAS_CONFEZIONAMENTO);
                    const cntP = Math.max(0, parseNum(c.gasPackagingCounterCurrent) - parseNum(c.gasPackagingCounterPrevious));
                    return acc + (directB > 0 ? directB : cntB) + (directP > 0 ? directP : cntP);
                }, 0);
                const remLiters = Math.max(0, totalGasLoadedLiters - totalMcUsed / factor);
                const usableMax = Math.max(1, gasCfg.capacitaTotaleLitri * (gasCfg.percentualeRiempimentoMax / 100));
                const pct = (remLiters / usableMax) * 100;
                if (pct <= (gasCfg.sogliaRiservaPercent || 20)) {
                    setGasReserveAlert({ pct, remainingLiters: remLiters, tipoGas: gasCfg.gasType.toUpperCase() });
                } else {
                    setGasReserveAlert(null);
                }
            } else {
                setGasReserveAlert(null);
            }

            // Verifica scorta Bombole CO2 / Azoto / Argon (solo gas effettivamente censiti con almeno 1 bombola in parco)
            const techCfg = getEffectiveTechGasConfig(breweryData);
            const lowCylinders = techCfg.filter(g => {
                const totalFleet = (g.pieneScorta || 0) + (g.inUsoImpianto || 0) + (g.vuoteDaRendere || 0);
                return g.attivo && totalFleet > 0 && g.pieneScorta <= g.sogliaAllarmePiene;
            });
            setLowTechGasAlerts(lowCylinders);

            // Verifica anomalie perdita cantina / confezionamento (> 14% su lotti chiusi)
            const highLosses: { lotto: string; birra: string; litriMosto: number; litriConf: number; lossPct: number }[] = [];
            sortedCotte.forEach(cotta => {
                if (!cotta.isCellarClosed) return;
                const litriMosto = parseFloat(String(cotta.LITRI_FINALI || '').replace(',', '.')) || 0;
                if (litriMosto <= 0) return;
                const litriConf = (CONFEZIONAMENTO as PackagingData[])
                    .filter(p => p.LOTTO_PROD === cotta.LOTTO)
                    .reduce((s, p) => s + (p.LITRI_TOT || 0), 0);
                if (litriConf <= 0) return;
                const lossPct = ((litriMosto - litriConf) / litriMosto) * 100;
                if (lossPct > 14) {
                    highLosses.push({
                        lotto: cotta.LOTTO,
                        birra: cotta.NOME_BIRRA,
                        litriMosto,
                        litriConf,
                        lossPct,
                    });
                }
            });
            setCellarLossAlerts(highLosses);
        };

        loadHomeData();
    }, [selectedYear, warehouseStatus]);

    const handleDeleteOutOfStockItem = async (item: WarehouseStatus['outOfStockItems'][0]) => {
        // FIX: Map the lowercase properties from the 'item' object to the uppercase properties expected by the `RawWarehouseItem` type for `deleteWarehouseItem`.
        const itemToDelete: RawWarehouseItem = {
            NOME: item.nome,
            MARCA: item.marca,
            FORNITORE: item.fornitore,
            TIPOLOGIA: item.tipologia,
            GIACENZA: 0,
        };
        if (window.confirm(`Sei sicuro di voler rimuovere definitivamente il prodotto "${item.nome}" (${item.marca}) dal database? Tutti i movimenti associati verranno cancellati.`)) {
            try {
                await deleteWarehouseItem(selectedYear, itemToDelete);
                showToast('Prodotto rimosso con successo.', 'success');
                onRefresh();
            } catch (e: any) {
                showToast(e.message, 'error');
            }
        }
    };

    const todayMidnight = new Date();
    todayMidnight.setHours(0, 0, 0, 0);

    const expiringItems: React.ReactNode[] = (warehouseStatus?.expiringSoonItems || []).map(item => {
        const expDate = parseItalianDate(item.scadenza);
        const isExpired = expDate ? expDate.getTime() < todayMidnight.getTime() : false;
        return (
            <div key={`${item.nome}-${item.lotto}`} className={isExpired ? 'text-red-300 font-semibold' : ''}>
                {isExpired && <span className="px-1 py-0.5 mr-1 bg-red-700 text-white rounded text-[10px] font-bold">SCADUTO</span>}
                <strong>{item.nome}</strong> (Lotto: {item.lotto || 'N/D'}) {isExpired ? 'scaduto il' : 'scade il'} {item.scadenza}. Giacenza: {item.giacenza.toFixed(2)}
            </div>
        );
    });

    const expiringBeerItems: React.ReactNode[] = (warehouseStatus?.expiringBeerItems || []).map(item => {
        const expDate = parseItalianDate(item.scadenza);
        const isExpired = expDate ? expDate.getTime() < todayMidnight.getTime() : false;
        return (
            <div key={`${item.cliente}-${item.birra}-${item.lotto}-${item.formato}`} className={`flex items-center justify-between gap-2 ${isExpired ? 'text-red-300 font-semibold' : ''}`}>
                <div>
                    {isExpired && <span className="px-1 py-0.5 mr-1 bg-red-700 text-white rounded text-[10px] font-bold">TMC SUPERATO</span>}
                    <strong>{item.birra}</strong> ({item.formato}) Lotto: {item.lotto} — TMC: {item.scadenza} (Q.tà: {item.qta})
                </div>
                {onNavigate && (
                    <button
                        onClick={() => onNavigate('BEER_WAREHOUSE')}
                        className="px-2 py-0.5 bg-amber-600 hover:bg-amber-500 text-white rounded text-[10px] font-bold flex-shrink-0"
                        title="Scegli se scontare in Promo TMC o inviare a Scarto/Distruzione"
                    >
                        Gestisci TMC ➔
                    </button>
                )}
            </div>
        );
    });

    const outOfStockItems = warehouseStatus?.outOfStockItems.map(item => (
        <div key={`${item.nome}-${item.marca}-${item.fornitore}`} className="flex justify-between items-center w-full">
            <span><strong>{item.nome}</strong> <span className="text-slate-400">({item.marca || 'N/D'} - {item.fornitore || 'N/D'})</span></span>
            <button onClick={() => handleDeleteOutOfStockItem(item)} className="ml-2 p-1 text-red-400 hover:text-red-200 flex-shrink-0">
                <TrashIcon className="w-4 h-4" />
            </button>
        </div>
    )) || [];
    
    return (
        <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <h1 className="text-3xl font-bold text-brew-accent">Dashboard Produzione - {selectedYear}</h1>
                {onNavigate && (
                    <button
                        onClick={() => onNavigate('CALENDAR')}
                        className="px-3.5 py-1.5 bg-emerald-700 hover:bg-emerald-600 text-white font-bold text-xs rounded-lg shadow flex items-center gap-2 transition-all self-start sm:self-auto"
                    >
                        <CalendarDaysIcon className="w-4 h-4" />
                        <span>VAI AL CALENDARIO ➔</span>
                    </button>
                )}
            </div>

            {/* WIDGET SEGNALAZIONI CALENDARIO & PROMEMORIA ATTIVITÀ (SEMPRE VISIBILE) */}
            {calendarReminders && (
                <div
                    className={`p-4 rounded-xl border-2 shadow-2xl space-y-3 animate-fadeIn ${
                        calendarReminders.totalAlertsCount > 0
                            ? 'bg-gradient-to-r from-amber-950/70 via-red-950/50 to-brew-dark border-amber-500'
                            : calendarReminders.upcomingActivityCount > 0
                            ? 'bg-gradient-to-r from-emerald-950/50 via-cyan-950/40 to-brew-dark border-emerald-500/70'
                            : 'bg-slate-900/80 border-slate-700'
                    }`}
                >
                    <div
                        className={`flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 ${
                            calendarReminders.totalAlertsCount > 0
                                ? 'border-b border-amber-500/40'
                                : calendarReminders.upcomingActivityCount > 0
                                ? 'border-b border-emerald-500/30'
                                : ''
                        }`}
                    >
                        <div className="flex items-center gap-2.5 flex-wrap">
                            {calendarReminders.totalAlertsCount > 0 ? (
                                <span className="relative flex h-3.5 w-3.5">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-red-500"></span>
                                </span>
                            ) : (
                                <span className="inline-flex rounded-full h-3 w-3 bg-emerald-400"></span>
                            )}
                            <h2
                                className={`text-base sm:text-lg font-extrabold tracking-wide flex items-center gap-2 ${
                                    calendarReminders.totalAlertsCount > 0 ? 'text-amber-200' : 'text-emerald-200'
                                }`}
                            >
                                <BellAlertIcon
                                    className={`w-5 h-5 ${
                                        calendarReminders.totalAlertsCount > 0 ? 'text-amber-300' : 'text-emerald-400'
                                    }`}
                                />
                                <span>SEGNALAZIONI CALENDARIO &amp; PROMEMORIA ATTIVITÀ</span>
                            </h2>
                            {calendarReminders.totalAlertsCount > 0 && (
                                <span className="px-2 py-0.5 rounded bg-red-600/80 text-white text-[11px] font-bold">
                                    {calendarReminders.totalAlertsCount} urgenti/oggi
                                </span>
                            )}
                            {calendarReminders.upcomingActivityCount > 0 && (
                                <span className="px-2 py-0.5 rounded bg-cyan-800/80 text-cyan-100 text-[11px] font-semibold">
                                    {calendarReminders.upcomingActivityCount} nei prossimi 7 gg
                                </span>
                            )}
                        </div>
                        {onNavigate && (
                            <button
                                onClick={() => onNavigate('CALENDAR')}
                                className="px-3 py-1 bg-brew-accent hover:bg-yellow-400 text-brew-dark font-extrabold text-xs rounded-md shadow flex items-center gap-1.5 transition-transform hover:scale-105 self-start sm:self-auto"
                            >
                                <CalendarDaysIcon className="w-4 h-4" />
                                <span>
                                    {calendarReminders.totalAlertsCount === 0 && calendarReminders.upcomingActivityCount === 0
                                        ? '+ AGGIUNGI PROMEMORIA IN CALENDARIO ➔'
                                        : 'APRI CALENDARIO DETTAGLIATO ➔'}
                                </span>
                            </button>
                        )}
                    </div>

                    {calendarReminders.totalAlertsCount === 0 && calendarReminders.upcomingActivityCount === 0 ? (
                        <div className="text-xs text-slate-300 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                            <span>
                                ✅ Nessuna scadenza urgente oggi né impegni in calendario per i prossimi 7 giorni. Usa il Calendario per fissare cotte, lavaggi CIP o promemoria operativi.
                            </span>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                            {/* Confezionamenti Cantina Scaduti, Oggi o Prossimi 7 gg */}
                            {(calendarReminders.alarmCellarEvents.length > 0 ||
                                calendarReminders.todayCellarEvents.length > 0 ||
                                calendarReminders.upcomingCellarEvents.length > 0) && (
                                <div className="space-y-2">
                                    <div className="text-xs font-bold uppercase text-amber-300 tracking-wider flex items-center gap-1.5">
                                        <span>🍺</span>
                                        <span>
                                            Confezionamenti Cantina (
                                            {calendarReminders.alarmCellarEvents.length +
                                                calendarReminders.todayCellarEvents.length +
                                                calendarReminders.upcomingCellarEvents.length}
                                            )
                                        </span>
                                    </div>

                                    {calendarReminders.alarmCellarEvents.map(c => (
                                        <div key={`alarm_${c.fermentatore}_${c.lotto}`} className="p-2.5 rounded-lg bg-red-950/80 border border-red-500 flex items-center justify-between gap-2 text-xs text-red-200 shadow animate-pulse">
                                            <div>
                                                <div className="flex items-center gap-1.5">
                                                    <span className="font-extrabold text-white text-sm">⚠️ {c.fermentatore}</span>
                                                    <span className="px-1.5 py-0.2 bg-red-700 text-white rounded text-[10px] font-bold">RITARDO</span>
                                                </div>
                                                <div className="font-semibold text-slate-100">{c.nomeBirra} (Lotto {c.lotto})</div>
                                                <div className="text-[11px] text-red-300 mt-0.5">
                                                    Data prevista superata ({c.dataPrevistaConfezionamento}) • <strong>{c.litriFinali} L</strong> da confezionare!
                                                </div>
                                            </div>
                                            {onNavigate && (
                                                <button
                                                    onClick={() => onNavigate('CANTINA')}
                                                    className="px-2.5 py-1.5 bg-red-600 hover:bg-red-500 text-white font-bold rounded text-xs flex-shrink-0 shadow transition-colors"
                                                >
                                                    Cantina
                                                </button>
                                            )}
                                        </div>
                                    ))}

                                    {calendarReminders.todayCellarEvents.map(c => (
                                        <div key={`today_${c.fermentatore}_${c.lotto}`} className="p-2.5 rounded-lg bg-amber-900/60 border border-amber-500 flex items-center justify-between gap-2 text-xs text-amber-100 shadow">
                                            <div>
                                                <div className="flex items-center gap-1.5">
                                                    <span className="font-extrabold text-white text-sm">🍺 {c.fermentatore}</span>
                                                    <span className="px-1.5 py-0.2 bg-amber-600 text-white rounded text-[10px] font-bold">OGGI</span>
                                                </div>
                                                <div className="font-semibold text-slate-100">{c.nomeBirra} (Lotto {c.lotto})</div>
                                                <div className="text-[11px] text-amber-200 mt-0.5">
                                                    Confezionamento previsto per <strong>OGGI</strong> • {c.litriFinali} L
                                                </div>
                                            </div>
                                            {onNavigate && (
                                                <button
                                                    onClick={() => onNavigate('CANTINA')}
                                                    className="px-2.5 py-1.5 bg-brew-orange hover:bg-opacity-90 text-white font-bold rounded text-xs flex-shrink-0 shadow transition-colors"
                                                >
                                                    Confeziona
                                                </button>
                                            )}
                                        </div>
                                    ))}

                                    {calendarReminders.upcomingCellarEvents.map(c => (
                                        <div key={`up_${c.fermentatore}_${c.lotto}`} className="p-2.5 rounded-lg bg-slate-800/80 border border-cyan-700/70 flex items-center justify-between gap-2 text-xs text-cyan-100 shadow">
                                            <div>
                                                <div className="flex items-center gap-1.5">
                                                    <span className="font-bold text-white text-sm">🍺 {c.fermentatore}</span>
                                                    <span className="px-1.5 py-0.2 bg-cyan-800 text-cyan-100 rounded text-[10px] font-bold">TRA {c.daysRemaining} GG</span>
                                                </div>
                                                <div className="font-semibold text-slate-100">{c.nomeBirra} (Lotto {c.lotto})</div>
                                                <div className="text-[11px] text-cyan-200 mt-0.5">
                                                    Confezionamento stimato il {c.dataPrevistaConfezionamento} • {c.litriFinali} L
                                                </div>
                                            </div>
                                            {onNavigate && (
                                                <button
                                                    onClick={() => onNavigate('CANTINA')}
                                                    className="px-2.5 py-1 bg-slate-700 hover:bg-slate-600 text-white font-bold rounded text-xs flex-shrink-0"
                                                >
                                                    Vedi Cantina
                                                </button>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* Note & Appunti per Oggi, Urgenti o Prossimi 7 gg */}
                            {(calendarReminders.pendingTodayNotes.length > 0 ||
                                calendarReminders.urgentNotes.length > 0 ||
                                calendarReminders.upcomingNotes.length > 0) && (
                                <div className="space-y-2">
                                    <div className="text-xs font-bold uppercase text-purple-300 tracking-wider flex items-center gap-1.5">
                                        <span>📝</span>
                                        <span>
                                            Appunti &amp; Promemoria Calendario (
                                            {calendarReminders.pendingTodayNotes.length +
                                                calendarReminders.urgentNotes.length +
                                                calendarReminders.upcomingNotes.length}
                                            )
                                        </span>
                                    </div>

                                    {calendarReminders.urgentNotes.map(n => (
                                        <div key={`urgent_${n.id}`} className="p-2.5 rounded-lg bg-purple-950/80 border border-purple-500 flex items-center justify-between gap-2 text-xs text-purple-100 shadow">
                                            <div className="flex items-start gap-2">
                                                <button
                                                    onClick={() => handleToggleCalendarNote(n.id)}
                                                    className="mt-0.5 w-4 h-4 rounded border border-purple-400 bg-purple-900/50 flex items-center justify-center hover:bg-purple-700 flex-shrink-0"
                                                    title="Segna come completato"
                                                />
                                                <div>
                                                    <div className="flex items-center gap-1 flex-wrap">
                                                        <span className="font-extrabold text-red-300 bg-red-950 px-1 rounded text-[10px]">[URGENTE]</span>
                                                        <span className="font-bold text-white">{n.title}</span>
                                                        <span className="text-[10px] text-slate-300">({n.date})</span>
                                                        {n.time && <span className="text-[10px] text-cyan-300 font-mono">⏰ {n.time}</span>}
                                                    </div>
                                                    {n.description && <div className="text-[11px] text-slate-300 truncate max-w-xs mt-0.5">{n.description}</div>}
                                                </div>
                                            </div>
                                            {onNavigate && (
                                                <button onClick={() => onNavigate('CALENDAR')} className="text-[11px] text-brew-accent hover:underline font-bold flex-shrink-0">
                                                    Dettagli
                                                </button>
                                            )}
                                        </div>
                                    ))}

                                    {calendarReminders.pendingTodayNotes.filter(n => n.priority !== 'URGENTE').map(n => (
                                        <div key={`today_note_${n.id}`} className="p-2.5 rounded-lg bg-slate-800/90 border border-amber-500/50 flex items-center justify-between gap-2 text-xs text-slate-200 shadow">
                                            <div className="flex items-start gap-2">
                                                <button
                                                    onClick={() => handleToggleCalendarNote(n.id)}
                                                    className="mt-0.5 w-4 h-4 rounded border border-slate-500 bg-slate-900 flex items-center justify-center hover:bg-slate-700 flex-shrink-0"
                                                    title="Segna come completato"
                                                />
                                                <div>
                                                    <div className="flex items-center gap-1">
                                                        <span className="px-1 bg-amber-700 text-white rounded text-[10px] font-bold">OGGI</span>
                                                        <span className="font-bold text-white">{n.title}</span>
                                                        {n.time && <span className="text-[10px] text-cyan-300 font-mono">⏰ {n.time}</span>}
                                                    </div>
                                                    {n.description && <div className="text-[11px] text-slate-400 truncate max-w-xs mt-0.5">{n.description}</div>}
                                                </div>
                                            </div>
                                            {onNavigate && (
                                                <button onClick={() => onNavigate('CALENDAR')} className="text-[11px] text-brew-accent hover:underline font-bold flex-shrink-0">
                                                    Dettagli
                                                </button>
                                            )}
                                        </div>
                                    ))}

                                    {calendarReminders.upcomingNotes.map(n => (
                                        <div key={`up_note_${n.id}`} className="p-2.5 rounded-lg bg-slate-800/75 border border-slate-700 flex items-center justify-between gap-2 text-xs text-slate-200 shadow">
                                            <div className="flex items-start gap-2">
                                                <button
                                                    onClick={() => handleToggleCalendarNote(n.id)}
                                                    className="mt-0.5 w-4 h-4 rounded border border-slate-500 bg-slate-900 flex items-center justify-center hover:bg-slate-700 flex-shrink-0"
                                                    title="Segna come completato"
                                                />
                                                <div>
                                                    <div className="flex items-center gap-1 flex-wrap">
                                                        <span className="px-1 bg-slate-700 text-cyan-200 rounded text-[10px] font-semibold">{n.date}</span>
                                                        <span className="font-bold text-white">{n.title}</span>
                                                        {n.time && <span className="text-[10px] text-cyan-300 font-mono">⏰ {n.time}</span>}
                                                    </div>
                                                    {n.description && <div className="text-[11px] text-slate-400 truncate max-w-xs mt-0.5">{n.description}</div>}
                                                </div>
                                            </div>
                                            {onNavigate && (
                                                <button onClick={() => onNavigate('CALENDAR')} className="text-[11px] text-brew-accent hover:underline font-bold flex-shrink-0">
                                                    Dettagli
                                                </button>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* Cotte Pianificate & Allarmi Giacenze Magazzino */}
                            {(calendarReminders.plannedBrewsWithShortages.length > 0 || calendarReminders.upcomingPlannedBrews.length > 0) && (
                                <div className="space-y-2">
                                    <div className="text-xs font-bold uppercase text-orange-400 tracking-wider flex items-center gap-1.5">
                                        <span>🔥</span>
                                        <span>Cotte Pianificate &amp; Fabbisogno ({calendarReminders.upcomingPlannedBrews.length})</span>
                                    </div>

                                    {calendarReminders.plannedBrewsWithShortages.map(pb => (
                                        <div key={`shortage_${pb.id}`} className="p-2.5 rounded-lg bg-red-950/80 border border-red-500 flex items-center justify-between gap-2 text-xs text-red-200 shadow animate-pulse">
                                            <div>
                                                <div className="flex items-center gap-1.5">
                                                    <span className="font-extrabold text-white text-sm">⚠️ {pb.birraNome}</span>
                                                    <span className="px-1.5 py-0.2 bg-red-700 text-white rounded text-[10px] font-bold">MANCANO MATERIE PRIME</span>
                                                </div>
                                                <div className="font-semibold text-slate-100">Cliente: {pb.clienteNome} • Data: {pb.date}</div>
                                                {pb.stockAnalysis && (
                                                    <div className="text-[11px] text-red-300 mt-0.5">
                                                        Mancanti: <strong>{pb.stockAnalysis.dettaglioMancanti.slice(0, 2).join(' • ')}</strong>
                                                        {pb.stockAnalysis.dettaglioMancanti.length > 2 && ` (+${pb.stockAnalysis.dettaglioMancanti.length - 2} altri)`}
                                                    </div>
                                                )}
                                            </div>
                                            {onNavigate && (
                                                <button
                                                    onClick={() => onNavigate('CALENDAR')}
                                                    className="px-2.5 py-1.5 bg-red-600 hover:bg-red-500 text-white font-bold rounded text-xs flex-shrink-0 shadow transition-colors"
                                                >
                                                    Verifica
                                                </button>
                                            )}
                                        </div>
                                    ))}

                                    {calendarReminders.upcomingPlannedBrews.filter(pb => !pb.stockAnalysis || pb.stockAnalysis.sufficiente).map(pb => (
                                        <div key={`up_brew_${pb.id}`} className="p-2.5 rounded-lg bg-orange-950/50 border border-orange-700 flex items-center justify-between gap-2 text-xs text-orange-200 shadow">
                                            <div>
                                                <div className="flex items-center gap-1.5">
                                                    <span className="font-extrabold text-white text-sm">🔥 {pb.birraNome}</span>
                                                    <span className="px-1.5 py-0.2 bg-emerald-800 text-white rounded text-[10px] font-bold">MAGAZZINO OK</span>
                                                </div>
                                                <div className="text-slate-300">Cliente: {pb.clienteNome} • {pb.litriPrevisti} L • Prevista il {pb.date}</div>
                                            </div>
                                            {onNavigate && (
                                                <button onClick={() => onNavigate('CALENDAR')} className="text-[11px] text-brew-accent hover:underline font-bold flex-shrink-0">
                                                    Dettagli
                                                </button>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* Manutenzioni Tecniche & Cicli CIP in Scadenza / Scaduti */}
                            {calendarReminders.urgentMaintenance.length > 0 && (
                                <div className="space-y-2">
                                    <div className="text-xs font-bold uppercase text-cyan-400 tracking-wider flex items-center gap-1.5">
                                        <span>🧪</span>
                                        <span>CIP &amp; Manutenzioni Scadute / In Scadenza ({calendarReminders.urgentMaintenance.length})</span>
                                    </div>

                                    {calendarReminders.urgentMaintenance.map(m => (
                                        <div
                                            key={`maint_${m.id}`}
                                            className={`p-2.5 rounded-lg border flex items-center justify-between gap-2 text-xs shadow ${
                                                m.stato === 'scaduto'
                                                    ? 'bg-red-950/80 border-red-500 text-red-200 animate-pulse'
                                                    : 'bg-cyan-950/70 border-cyan-500 text-cyan-200'
                                            }`}
                                        >
                                            <div>
                                                <div className="flex items-center gap-1.5">
                                                    <span className="font-extrabold text-white text-sm">
                                                        {m.tipo === 'CIP_SANIFICAZIONE' ? '🧪 CIP' : '🔧 Maint'}: {m.nome}
                                                    </span>
                                                    <span className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
                                                        m.stato === 'scaduto' ? 'bg-red-700 text-white' : 'bg-cyan-700 text-white'
                                                    }`}>
                                                        {m.stato === 'scaduto' ? 'SCADUTO' : 'IN SCADENZA'}
                                                    </span>
                                                </div>
                                                <div className="text-slate-300 mt-0.5">
                                                    Apparato: <strong>{m.apparato}</strong> • Scadenza: <strong>{m.dataProssimaScadenza}</strong>
                                                </div>
                                            </div>
                                            {onNavigate && (
                                                <button
                                                    onClick={() => onNavigate('CALENDAR')}
                                                    className="px-2.5 py-1.5 bg-cyan-700 hover:bg-cyan-600 text-white font-bold rounded text-xs flex-shrink-0 shadow transition-colors"
                                                >
                                                    Calendario
                                                </button>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            <div className="flex gap-4 flex-wrap">
                {showInventoryReminder && (
                    <AlertBox 
                        title={getInventoryReminderInfo().type === 'YEAR_END' ? '🏁 Promemoria Chiusura Fine Anno (31 Dicembre)' : t('home.inventoryReminderTitle')} 
                        items={[
                            getInventoryReminderInfo().type === 'YEAR_END'
                                ? "È il momento di eseguire l'Inventario di Chiusura Fine Anno al 31 Dicembre: calcolerà le vendite di Dicembre e fisserà le giacenze per il nuovo anno."
                                : t('home.inventoryReminderText')
                        ]} 
                        type={getInventoryReminderInfo().type === 'YEAR_END' ? 'warning' : 'info'} 
                        onClose={() => setShowInventoryReminder(false)} 
                    />
                )}
                {initialInventory.length > 0 && (
                    <div className="bg-blue-500/20 border border-blue-500 text-blue-300 rounded-lg p-3 shadow-md w-full max-w-sm">
                        <h3 className="font-bold text-blue-200 text-sm">Inventario Iniziale Anno {selectedYear}</h3>
                        <p className="text-xs mt-1 mb-2">Riepilogo giacenze iniziali importate.</p>
                        <button 
                            onClick={() => setInventoryModalOpen(true)}
                            className="bg-brew-blue text-white font-bold py-1 px-3 rounded-md hover:bg-opacity-80 transition-all text-xs shadow-sm"
                        >
                            Visualizza / Esporta
                        </button>
                    </div>
                )}
                 {showExpiring && <AlertBox title="Materie Prime in Scadenza / Scadute (entro 30gg)" items={expiringItems} type="warning" onClose={() => setShowExpiring(false)} />}
                 {showExpiringBeer && <AlertBox title={`${t('home.expiringBeerAlertTitle')} (Promo Sconto o Scarto)`} items={expiringBeerItems} type="warning" onClose={() => setShowExpiringBeer(false)} />}
                 {showOutOfStock && <AlertBox title="Materie Prime Esaurite" items={outOfStockItems} type="warning" onClose={() => setShowOutOfStock(false)} />}
                 {gasReserveAlert && (
                     <div className="border-2 border-red-500 bg-red-950/60 text-red-200 rounded-lg p-3 shadow-md w-full max-w-sm">
                         <div className="flex items-center justify-between mb-1">
                             <h3 className="font-extrabold text-sm flex items-center gap-1.5 text-red-300">
                                 <FireIcon className="w-4 h-4 text-orange-400" />
                                 <span>Cisterna {gasReserveAlert.tipoGas} in Riserva ({gasReserveAlert.pct.toFixed(1)}%)</span>
                             </h3>
                         </div>
                         <p className="text-xs text-slate-200 mb-2">
                             Restano circa <strong className="font-mono tabular-nums">{Math.round(gasReserveAlert.remainingLiters)} Litri</strong> in cisterna. Organizza un rifornimento.
                         </p>
                         {onNavigate && (
                             <button
                                 onClick={() => onNavigate('GAS_TANK')}
                                 className="px-3 py-1 bg-brew-orange hover:bg-opacity-90 text-white rounded text-xs font-bold shadow"
                             >
                                 Apri Cisterna Gas ➔
                             </button>
                         )}
                     </div>
                 )}
                 {lowTechGasAlerts.length > 0 && (
                     <div className="border border-amber-500 bg-amber-950/40 text-amber-200 rounded-lg p-3 shadow-md w-full max-w-sm">
                         <h3 className="font-bold text-sm text-amber-300 mb-1.5">
                             Scorta Bombole Cantina in Esaurimento
                         </h3>
                         <ul className="text-xs space-y-1 mb-2.5">
                             {lowTechGasAlerts.map(g => (
                                 <li key={g.codice} className="flex items-center justify-between">
                                     <span><strong>{g.nome}</strong>:</span>
                                     <span className="font-mono tabular-nums font-bold text-white">
                                         {g.pieneScorta} piene • {g.vuoteDaRendere} vuote
                                     </span>
                                 </li>
                             ))}
                         </ul>
                         {onNavigate && (
                             <button
                                 onClick={() => onNavigate('GAS_TANK')}
                                 className="px-3 py-1 bg-amber-600 hover:bg-amber-500 text-white rounded text-xs font-bold shadow"
                             >
                                 Gestisci Vuoto per Pieno ➔
                             </button>
                         )}
                     </div>
                 )}
                 {showCellarLoss && cellarLossAlerts.length > 0 && (
                     <AlertBox
                         title="Anomalia Perdita Cantina > 14%"
                         items={cellarLossAlerts.map(item => (
                             <div key={item.lotto} className="flex items-center justify-between gap-2">
                                 <span>
                                     <strong>Lotto {item.lotto}</strong> ({item.birra}): <strong className="text-red-300 font-mono tabular-nums">-{item.lossPct.toFixed(1)}%</strong> ({item.litriConf.toFixed(0)}/{item.litriMosto.toFixed(0)} L)
                                 </span>
                                 {onNavigate && (
                                     <button
                                         onClick={() => onNavigate('PRODUCTION_TREND')}
                                         className="px-1.5 py-0.5 bg-slate-700 hover:bg-slate-600 text-white rounded text-[10px] font-semibold flex-shrink-0"
                                     >
                                         Analizza
                                     </button>
                                 )}
                             </div>
                         ))}
                         type="warning"
                         onClose={() => setShowCellarLoss(false)}
                     />
                 )}
            </div>
            
            <div className="bg-brew-dark-secondary p-4 rounded-lg shadow-lg">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left text-gray-300">
                        <thead className="text-xs text-brew-dark uppercase bg-brew-accent">
                            <tr>
                                <th className="px-3 py-3">#</th>
                                <th className="px-3 py-3">{t('home.prodDateColumn')}</th>
                                <th className="px-3 py-3">{t('home.clientColumn')}</th>
                                <th className="px-3 py-3">{t('home.lottoColumn')}</th>
                                <th className="px-3 py-3 text-right w-32">{t('home.mustCounterColumn')}</th>
                                <th className="px-3 py-3 text-right">PLATO</th>
                                <th className="px-3 py-3 text-right">{t('home.gasColumn')}</th>
                                <th className="px-3 py-3">{t('home.typeColumn')}</th>
                                <th className="px-3 py-3 text-right">{t('home.litersProdColumn')}</th>
                                <th className="px-3 py-3">{t('home.fermenterColumn')}</th>
                                <th className="px-3 py-3 w-28">{t('home.pkgDateColumn')}</th>
                                <th className="px-3 py-3 text-right">{t('home.litersPkgColumn')}</th>
                                <th className="px-3 py-3">{t('home.pkgModeColumn')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {summaryData.map((row) => (
                                <tr key={row.lotto} className="border-b border-slate-700 hover:bg-slate-600/50">
                                    <td className="px-3 py-2 font-bold">{row.numeroProgressivo}</td>
                                    <td className="px-3 py-2">{row.dataProduzione}</td>
                                    <td className="px-3 py-2">{row.cliente}</td>
                                    <td className="px-3 py-2 font-semibold text-brew-accent">{row.lotto}</td>
                                    <td className="px-3 py-2 text-right font-medium text-yellow-300">{row.litriContaMosto}</td>
                                    <td className="px-3 py-2 text-right font-medium text-purple-300">{row.plato}</td>
                                    <td className="px-3 py-2 text-right font-medium text-cyan-300">{row.gasUtilizzato}</td>
                                    <td className="px-3 py-2">{row.tipologia}</td>
                                    <td className="px-3 py-2 text-right font-medium">{row.litriProdotti}</td>
                                    <td className="px-3 py-2">{row.numeroFermentatore}</td>
                                    <td className="px-3 py-2">{row.dataConfezionamento}</td>
                                    <td className="px-3 py-2 text-right font-medium">{row.litriConfezionati}</td>
                                    <td className="px-3 py-2">{row.modalitaConfezionamento}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                     {summaryData.length === 0 && (
                        <p className="text-center text-slate-400 mt-8 py-4">Nessuna produzione registrata per l'anno corrente. Inizia creando una nuova cotta.</p>
                    )}
                </div>
            </div>

            <InitialInventoryModal 
                isOpen={isInventoryModalOpen}
                onClose={() => setInventoryModalOpen(false)}
                inventory={initialInventory}
                year={selectedYear}
            />
        </div>
    );
};