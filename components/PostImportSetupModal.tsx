import React, { useState, useEffect, useMemo } from 'react';
import { Modal } from './Modal';
import type {
    BreweryData,
    GasTankConfig,
    KegFleetConfigItem,
    KegFleetFormat,
    KegMovementLog,
    TechGasCylinderItem,
} from '../types';
import {
    getBreweryData,
    saveBreweryData,
    DEFAULT_KEG_FLEET_CONFIG,
    getEffectiveGasTankConfig,
    getEffectiveTechGasConfig,
} from '../services/dataService';
import { computeDualLocationBeerStock } from '../utils/beerStockEngine';
import { useToast } from '../hooks/useToast';
import { CheckIcon, FireIcon, CylinderStackIcon, ArchiveBoxIcon, WrenchIcon } from './icons';

interface PostImportSetupModalProps {
    isOpen: boolean;
    onClose: () => void;
    selectedYear: string;
    onSaved: () => void;
}

type SetupTab = 'OVERVIEW' | 'GAS_TANK' | 'KEG_FLEET' | 'TECH_GAS';

const KEG_FORMATS: KegFleetFormat[] = ['FUSTO ACCIAIO 20L', 'FUSTO ACCIAIO 24L', 'FUSTO ACCIAIO 30L'];

const PostImportSetupModal: React.FC<PostImportSetupModalProps> = ({
    isOpen,
    onClose,
    selectedYear,
    onSaved,
}) => {
    const { showToast } = useToast();
    const [activeTab, setActiveTab] = useState<SetupTab>('OVERVIEW');
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [yearData, setYearData] = useState<BreweryData | null>(null);

    // Tab 2: Cisterna Gas
    const [enableGasAlign, setEnableGasAlign] = useState(false);
    const [gasConfig, setGasConfig] = useState<GasTankConfig>(() => getEffectiveGasTankConfig(null));
    const [gaugePercentToday, setGaugePercentToday] = useState<string>('');

    // Tab 3: Parco Fusti
    const [kegConfig, setKegConfig] = useState<KegFleetConfigItem[]>(() =>
        DEFAULT_KEG_FLEET_CONFIG.map(k => ({ ...k }))
    );
    const [kegsAlreadyOutAtClients, setKegsAlreadyOutAtClients] = useState<Record<KegFleetFormat, number>>({
        'FUSTO ACCIAIO 20L': 0,
        'FUSTO ACCIAIO 24L': 0,
        'FUSTO ACCIAIO 30L': 0,
    });

    // Tab 4: Bombole CO2 / Azoto / Argon
    const [techGasConfig, setTechGasConfig] = useState<TechGasCylinderItem[]>(() =>
        getEffectiveTechGasConfig(null)
    );

    useEffect(() => {
        if (!isOpen || !selectedYear) return;
        let cancelled = false;
        const load = async () => {
            setLoading(true);
            try {
                const data = await getBreweryData(selectedYear);
                if (cancelled || !data) return;
                setYearData(data);

                // Gas Tank
                const effGas = getEffectiveGasTankConfig(data);
                setGasConfig(effGas);
                if (effGas.litriInizialiAnno > 0 && effGas.capacitaTotaleLitri > 0) {
                    const pct = Math.round((effGas.litriInizialiAnno / effGas.capacitaTotaleLitri) * 100);
                    setGaugePercentToday(String(pct));
                    setEnableGasAlign(false);
                } else {
                    setGaugePercentToday('');
                    setEnableGasAlign(false);
                }

                // Keg Fleet
                const savedKegs = data.KEG_FLEET_CONFIG || [];
                setKegConfig(
                    KEG_FORMATS.map(fmt => {
                        const found = savedKegs.find(k => k.formato === fmt);
                        const def = DEFAULT_KEG_FLEET_CONFIG.find(d => d.formato === fmt)!;
                        return found ? { ...def, ...found } : { ...def };
                    })
                );

                const existingInitialOut: Record<KegFleetFormat, number> = {
                    'FUSTO ACCIAIO 20L': 0,
                    'FUSTO ACCIAIO 24L': 0,
                    'FUSTO ACCIAIO 30L': 0,
                };
                (data.KEG_LOGS || []).forEach(l => {
                    if (l.id.startsWith('KEG_INIT_OUT_') && l.tipo === 'CONSEGNA_CLIENTE') {
                        existingInitialOut[l.formato] = l.quantita;
                    }
                });
                setKegsAlreadyOutAtClients(existingInitialOut);

                // Tech Gas Cylinders
                setTechGasConfig(getEffectiveTechGasConfig(data));
            } finally {
                if (!cancelled) setLoading(false);
            }
        };
        load();
        return () => {
            cancelled = true;
        };
    }, [isOpen, selectedYear]);

    const diagnostics = useMemo(() => {
        if (!yearData) {
            return {
                cotteCount: 0,
                packagedCount: 0,
                rawMovementsCount: 0,
                centralLotsCount: 0,
                cellarLotsCount: 0,
                fullKegsByFormat: {
                    'FUSTO ACCIAIO 20L': 0,
                    'FUSTO ACCIAIO 24L': 0,
                    'FUSTO ACCIAIO 30L': 0,
                } as Record<KegFleetFormat, number>,
            };
        }

        const dualStock = computeDualLocationBeerStock(yearData);
        const centralLotsCount = dualStock.centralSalesStock.length;
        const cellarLotsCount = dualStock.breweryCellarStock.length;
        const fullKegsByFormat: Record<KegFleetFormat, number> = {
            'FUSTO ACCIAIO 20L': 0,
            'FUSTO ACCIAIO 24L': 0,
            'FUSTO ACCIAIO 30L': 0,
        };

        dualStock.allPositiveStock.forEach(entry => {
            const fmtUpper = entry.formato.trim().toUpperCase() as KegFleetFormat;
            if (KEG_FORMATS.includes(fmtUpper) && entry.quantita > 0) {
                fullKegsByFormat[fmtUpper] += entry.quantita;
            }
        });

        return {
            cotteCount: (yearData.COTTE_HEAD || []).length,
            packagedCount: (yearData.CONFEZIONAMENTO || []).length,
            rawMovementsCount: (yearData.MOVIMENTAZIONE || []).length,
            centralLotsCount,
            cellarLotsCount,
            fullKegsByFormat,
        };
    }, [yearData]);

    const handleCloseClean = () => {
        localStorage.removeItem('brewpanda_pending_post_import_wizard');
        onClose();
    };

    const handleSaveAll = async () => {
        if (!selectedYear) return;
        setSaving(true);
        try {
            const freshData = await getBreweryData(selectedYear);
            if (!freshData) {
                showToast('Impossibile caricare i dati dell’anno selezionato.', 'error');
                return;
            }

            const now = new Date();
            const todayStr = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;

            // 1. Cisterna Gas
            const nextGas: GasTankConfig = { ...gasConfig };
            if (enableGasAlign && gaugePercentToday.trim() !== '') {
                const pct = Math.max(0, Math.min(100, Number(gaugePercentToday) || 0));
                nextGas.litriInizialiAnno = Math.round((nextGas.capacitaTotaleLitri * pct) / 100);
                nextGas.dataTaratura = todayStr;
            }
            freshData.GAS_TANK_CONFIG = nextGas;

            // 2. Parco Fusti Acciaio + eventuale saldo fusti già presso clienti
            freshData.KEG_FLEET_CONFIG = kegConfig.map(k => ({
                formato: k.formato,
                dotazioneTotale: Math.max(0, Math.round(Number(k.dotazioneTotale) || 0)),
                vuotiLavatiIniziali: Math.max(0, Math.round(Number(k.vuotiLavatiIniziali) || 0)),
                cauzioneUnitaria: Math.max(0, Number(k.cauzioneUnitaria) || 0),
            }));

            const otherKegLogs = (freshData.KEG_LOGS || []).filter(l => !l.id.startsWith('KEG_INIT_OUT_'));
            const initOutLogs: KegMovementLog[] = [];
            KEG_FORMATS.forEach(fmt => {
                const qtyOut = Math.max(0, Math.round(Number(kegsAlreadyOutAtClients[fmt]) || 0));
                if (qtyOut > 0) {
                    const cfg = kegConfig.find(k => k.formato === fmt);
                    const cauzUnit = cfg?.cauzioneUnitaria || 0;
                    initOutLogs.push({
                        id: `KEG_INIT_OUT_${fmt.replace(/\s+/g, '_')}`,
                        data: todayStr,
                        tipo: 'CONSEGNA_CLIENTE',
                        formato: fmt,
                        quantita: qtyOut,
                        cliente: 'CLIENTI VARI (SALDO PREGRESSO)',
                        cauzioneTotale: qtyOut * cauzUnit,
                        cauzioneSaldata: true,
                        note: 'Saldo iniziale fusti già fuori presso clienti al momento dell’attivazione modulo',
                    });
                }
            });
            freshData.KEG_LOGS = [...initOutLogs, ...otherKegLogs];

            // 3. Bombole Gas Tecnici Cantina (CO2 / N2 / Argon)
            freshData.TECH_GAS_CONFIG = techGasConfig.map(item => ({
                ...item,
                pieneScorta: Math.max(0, Math.round(Number(item.pieneScorta) || 0)),
                inUsoImpianto: Math.max(0, Math.round(Number(item.inUsoImpianto) || 0)),
                vuoteDaRendere: Math.max(0, Math.round(Number(item.vuoteDaRendere) || 0)),
                sogliaAllarmePiene: Math.max(0, Math.round(Number(item.sogliaAllarmePiene) || 0)),
                costoMedioRicarica: Math.max(0, Number(item.costoMedioRicarica) || 0),
                attivo:
                    (Number(item.pieneScorta) || 0) +
                        (Number(item.inUsoImpianto) || 0) +
                        (Number(item.vuoteDaRendere) || 0) >
                    0
                        ? true
                        : item.attivo,
            }));

            await saveBreweryData(selectedYear, freshData);
            localStorage.removeItem('brewpanda_pending_post_import_wizard');
            showToast(`Taratura iniziale moduli salvata per l'anno ${selectedYear}.`, 'success');
            onSaved();
            onClose();
        } catch (error) {
            console.error(error);
            showToast('Errore durante il salvataggio della taratura iniziale.', 'error');
        } finally {
            setSaving(false);
        }
    };

    const computedGaugeLiters = useMemo(() => {
        const pct = Math.max(0, Math.min(100, Number(gaugePercentToday) || 0));
        return Math.round((gasConfig.capacitaTotaleLitri * pct) / 100);
    }, [gaugePercentToday, gasConfig.capacitaTotaleLitri]);

    return (
        <Modal
            isOpen={isOpen}
            onClose={handleCloseClean}
            title={`Allineamento Rapido Moduli & Dati Importati (${selectedYear})`}
            size="4xl"
        >
            {loading ? (
                <div className="py-12 text-center text-slate-400">Verifica archivio {selectedYear} in corso...</div>
            ) : (
                <div className="space-y-5">
                    {/* Segmented Navigation */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 bg-slate-900/90 p-1.5 rounded-xl border border-slate-700/80">
                        <button
                            type="button"
                            onClick={() => setActiveTab('OVERVIEW')}
                            className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
                                activeTab === 'OVERVIEW'
                                    ? 'bg-amber-500 text-slate-950 shadow-sm'
                                    : 'text-slate-300 hover:bg-slate-800'
                            }`}
                        >
                            <ArchiveBoxIcon className="w-4 h-4 shrink-0" />
                            <span>1. Dati Storici</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => setActiveTab('GAS_TANK')}
                            className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
                                activeTab === 'GAS_TANK'
                                    ? 'bg-amber-500 text-slate-950 shadow-sm'
                                    : 'text-slate-300 hover:bg-slate-800'
                            }`}
                        >
                            <FireIcon className="w-4 h-4 shrink-0" />
                            <span>2. Cisterna Gas</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => setActiveTab('KEG_FLEET')}
                            className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
                                activeTab === 'KEG_FLEET'
                                    ? 'bg-amber-500 text-slate-950 shadow-sm'
                                    : 'text-slate-300 hover:bg-slate-800'
                            }`}
                        >
                            <CylinderStackIcon className="w-4 h-4 shrink-0" />
                            <span>3. Parco Fusti</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => setActiveTab('TECH_GAS')}
                            className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
                                activeTab === 'TECH_GAS'
                                    ? 'bg-amber-500 text-slate-950 shadow-sm'
                                    : 'text-slate-300 hover:bg-slate-800'
                            }`}
                        >
                            <WrenchIcon className="w-4 h-4 shrink-0" />
                            <span>4. Bombole CO₂/N₂</span>
                        </button>
                    </div>

                    {/* TAB 1: OVERVIEW */}
                    {activeTab === 'OVERVIEW' && (
                        <div className="space-y-4">
                            <div className="bg-emerald-950/35 border border-emerald-700/50 rounded-xl p-4">
                                <div className="flex items-start gap-3">
                                    <div className="p-2 rounded-lg bg-emerald-500/20 text-emerald-300 shrink-0">
                                        <CheckIcon className="w-5 h-5" />
                                    </div>
                                    <div className="space-y-1">
                                        <h4 className="text-sm font-bold text-emerald-200">
                                            Compatibilità Totale con il tuo Backup Precedente
                                        </h4>
                                        <p className="text-xs text-slate-300 leading-relaxed">
                                            Tutte le tue cotte, materie prime, clienti, ricette e vendite storiche dell’anno{' '}
                                            <strong className="text-white">{selectedYear}</strong> sono già pronte e non richiedono alcuna modifica manuale.
                                            I nuovi moduli (Cisterna Gas, Parco Fusti, Bombole Cantina e Doppio Magazzino) partono in sicurezza senza alterare lo storico.
                                        </p>
                                    </div>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                <div className="bg-slate-900/70 border border-slate-700/80 rounded-xl p-3.5">
                                    <div className="text-[11px] uppercase tracking-wider text-slate-400">Cotte Registrate</div>
                                    <div className="text-2xl font-bold font-mono tabular-nums text-white mt-1">
                                        {diagnostics.cotteCount}
                                    </div>
                                </div>
                                <div className="bg-slate-900/70 border border-slate-700/80 rounded-xl p-3.5">
                                    <div className="text-[11px] uppercase tracking-wider text-slate-400">Confezionamenti</div>
                                    <div className="text-2xl font-bold font-mono tabular-nums text-white mt-1">
                                        {diagnostics.packagedCount}
                                    </div>
                                </div>
                                <div className="bg-slate-900/70 border border-slate-700/80 rounded-xl p-3.5">
                                    <div className="text-[11px] uppercase tracking-wider text-slate-400">Movimenti Materie Prime</div>
                                    <div className="text-2xl font-bold font-mono tabular-nums text-white mt-1">
                                        {diagnostics.rawMovementsCount}
                                    </div>
                                </div>
                                <div className="bg-slate-900/70 border border-slate-700/80 rounded-xl p-3.5">
                                    <div className="text-[11px] uppercase tracking-wider text-slate-400">Lotti Pronti Vendita</div>
                                    <div className="text-2xl font-bold font-mono tabular-nums text-emerald-400 mt-1">
                                        {diagnostics.centralLotsCount}
                                    </div>
                                </div>
                            </div>

                            <div className="bg-slate-900/60 border border-slate-700/70 rounded-xl p-4 space-y-2.5 text-xs text-slate-300">
                                <div className="font-semibold text-white text-sm">Cosa succede in automatico ai tuoi dati importati:</div>
                                <ul className="space-y-2 list-disc pl-4">
                                    <li>
                                        <strong className="text-amber-300">Doppio Magazzino Birra:</strong> tutta la birra confezionata presente nel tuo backup è stata collocata automaticamente nel{' '}
                                        <strong className="text-white">Magazzino Centrale Vendita</strong>, così puoi continuare subito ad evadere ordini senza dover generare DDT arretrati. Solo i <em>nuovi</em> confezionamenti futuri entreranno prima in <em>Cella Birrificio</em>.
                                    </li>
                                    <li>
                                        <strong className="text-amber-300">Vendite Contoterzi / Beerfirm:</strong> eventuali doppi conteggi passati tra commissione lotto e vendita finale sono stati ripuliti automaticamente nei grafici annuali.
                                    </li>
                                    <li>
                                        <strong className="text-amber-300">Allineamento Facoltativo (Schede 2, 3 e 4 qui sopra):</strong> se vuoi attivare subito l’indicatore della <em>Cisterna Gas</em>, il <em>Parco Fusti</em> e le <em>Bombole CO₂/N₂</em> a anno già iniziato, inserisci nelle 3 schede successive la situazione fisica che hai <strong>oggi in birrificio</strong> (richiede 60 secondi).
                                    </li>
                                </ul>
                            </div>

                            <div className="flex justify-end">
                                <button
                                    type="button"
                                    onClick={() => setActiveTab('GAS_TANK')}
                                    className="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-white text-xs font-semibold transition-colors"
                                >
                                    Vai a Passo 2: Cisterna Gas →
                                </button>
                            </div>
                        </div>
                    )}

                    {/* TAB 2: GAS TANK */}
                    {activeTab === 'GAS_TANK' && (
                        <div className="space-y-4">
                            <div className="bg-slate-900/70 border border-slate-700/80 rounded-xl p-4 space-y-4">
                                <div>
                                    <h4 className="text-sm font-bold text-white">
                                        Taratura Cisterna GPL / Metano a Anno in Corso
                                    </h4>
                                    <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                                        Poiché importi dati con cotte già effettuate nei mesi scorsi, <strong className="text-slate-200">non serve inserire vecchie bolle del gas</strong>: leggi oggi la percentuale sul manometro esterno del serbatoio. Il programma fisserà la data di oggi come punto zero e scalerà solo le cotte da domani in avanti (senza scalare due volte le cotte passate!).
                                    </p>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                    <div>
                                        <label className="block text-xs text-slate-400 mb-1">Tipo Alimentazione</label>
                                        <select
                                            value={gasConfig.gasType}
                                            onChange={e => {
                                                const t = e.target.value as 'gpl' | 'metano';
                                                setGasConfig(prev => ({
                                                    ...prev,
                                                    gasType: t,
                                                    fattoreConversioneLitriAMc: t === 'gpl' ? 0.26 : 1.0,
                                                }));
                                            }}
                                            className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white"
                                        >
                                            <option value="gpl">Cisterna GPL (Litri → m³)</option>
                                            <option value="metano">Cisterna Metano / GNL</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-xs text-slate-400 mb-1">Capacità Geometrica Serbatoio (Litri)</label>
                                        <input
                                            type="number"
                                            min={100}
                                            step={50}
                                            value={gasConfig.capacitaTotaleLitri}
                                            onChange={e =>
                                                setGasConfig(prev => ({
                                                    ...prev,
                                                    capacitaTotaleLitri: Number(e.target.value) || 2750,
                                                }))
                                            }
                                            className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm font-mono tabular-nums text-white"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs text-slate-400 mb-1">Soglia Riserva Allarme (%)</label>
                                        <input
                                            type="number"
                                            min={5}
                                            max={50}
                                            value={gasConfig.sogliaRiservaPercent}
                                            onChange={e =>
                                                setGasConfig(prev => ({
                                                    ...prev,
                                                    sogliaRiservaPercent: Number(e.target.value) || 20,
                                                }))
                                            }
                                            className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm font-mono tabular-nums text-white"
                                        />
                                    </div>
                                </div>

                                <div className="bg-slate-950/70 border border-amber-500/30 rounded-xl p-4 space-y-3">
                                    <label className="flex items-center gap-2.5 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={enableGasAlign}
                                            onChange={e => setEnableGasAlign(e.target.checked)}
                                            className="w-4 h-4 rounded accent-amber-500"
                                        />
                                        <span className="text-xs font-semibold text-amber-300">
                                            Allinea ora il livello cisterna alla lettura reale del manometro di oggi
                                        </span>
                                    </label>

                                    {enableGasAlign && (
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center pt-1">
                                            <div>
                                                <label className="block text-xs text-slate-300 mb-1">
                                                    Percentuale letta oggi sul manometro esterno (%)
                                                </label>
                                                <input
                                                    type="number"
                                                    min={0}
                                                    max={95}
                                                    placeholder="Es. 55"
                                                    value={gaugePercentToday}
                                                    onChange={e => setGaugePercentToday(e.target.value)}
                                                    className="w-full bg-slate-800 border border-amber-500/60 rounded-lg px-3 py-2 text-sm font-mono tabular-nums text-white"
                                                />
                                            </div>
                                            <div className="bg-slate-900 border border-slate-700 rounded-lg p-3 text-xs">
                                                <div className="text-slate-400">Volume liquido corrispondente oggi:</div>
                                                <div className="text-lg font-bold font-mono tabular-nums text-amber-400 mt-0.5">
                                                    {computedGaugeLiters.toLocaleString('it-IT')} Litri
                                                    <span className="text-xs font-normal text-slate-400 ml-2">
                                                        (≈ {(computedGaugeLiters * gasConfig.fattoreConversioneLitriAMc).toFixed(0)} m³ gas)
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {!enableGasAlign && gasConfig.dataTaratura && (
                                        <div className="text-xs text-emerald-400">
                                            Taratura già registrata al {gasConfig.dataTaratura} ({gasConfig.litriInizialiAnno} L). Spunta la casella sopra solo se desideri ritarare il livello a oggi.
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="flex justify-between">
                                <button
                                    type="button"
                                    onClick={() => setActiveTab('OVERVIEW')}
                                    className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold"
                                >
                                    ← Indietro
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setActiveTab('KEG_FLEET')}
                                    className="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-white text-xs font-semibold"
                                >
                                    Vai a Passo 3: Parco Fusti →
                                </button>
                            </div>
                        </div>
                    )}

                    {/* TAB 3: KEG FLEET */}
                    {activeTab === 'KEG_FLEET' && (
                        <div className="space-y-4">
                            <div className="bg-slate-900/70 border border-slate-700/80 rounded-xl p-4 space-y-3">
                                <div>
                                    <h4 className="text-sm font-bold text-white">
                                        Fotografia Iniziale Parco Fusti in Acciaio
                                    </h4>
                                    <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                                        I <strong className="text-emerald-300">Fusti Pieni in Cella</strong> vengono già riconosciuti in automatico dai tuoi confezionamenti importati. Inserisci qui sotto quanti fusti in acciaio possiedi in totale, quanti vuoti lavati hai oggi in birrificio e (se ne hai già in giro) quanti fusti sono attualmente fuori presso i clienti.
                                    </p>
                                </div>

                                <div className="overflow-x-auto">
                                    <table className="w-full text-left border-collapse text-xs">
                                        <thead>
                                            <tr className="border-b border-slate-700 text-slate-400 uppercase text-[11px]">
                                                <th className="py-2 pr-3">Formato</th>
                                                <th className="py-2 px-2 text-right">Pieni in Cella (Auto)</th>
                                                <th className="py-2 px-2">Dotazione Totale</th>
                                                <th className="py-2 px-2">Vuoti Lavati Oggi</th>
                                                <th className="py-2 px-2">Già Fuori dai Clienti</th>
                                                <th className="py-2 pl-2">Cauzione (€)</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-800">
                                            {kegConfig.map((item, idx) => {
                                                const autoFull = diagnostics.fullKegsByFormat[item.formato] || 0;
                                                return (
                                                    <tr key={item.formato}>
                                                        <td className="py-2.5 pr-3 font-semibold text-white whitespace-nowrap">
                                                            {item.formato}
                                                        </td>
                                                        <td className="py-2.5 px-2 text-right font-mono tabular-nums text-emerald-400 font-bold">
                                                            {autoFull} pz
                                                        </td>
                                                        <td className="py-2.5 px-2">
                                                            <input
                                                                type="number"
                                                                min={0}
                                                                value={item.dotazioneTotale}
                                                                onChange={e => {
                                                                    const val = Number(e.target.value) || 0;
                                                                    setKegConfig(prev =>
                                                                        prev.map((k, i) =>
                                                                            i === idx ? { ...k, dotazioneTotale: val } : k
                                                                        )
                                                                    );
                                                                }}
                                                                className="w-24 bg-slate-800 border border-slate-600 rounded px-2.5 py-1.5 font-mono tabular-nums text-white"
                                                            />
                                                        </td>
                                                        <td className="py-2.5 px-2">
                                                            <input
                                                                type="number"
                                                                min={0}
                                                                value={item.vuotiLavatiIniziali}
                                                                onChange={e => {
                                                                    const val = Number(e.target.value) || 0;
                                                                    setKegConfig(prev =>
                                                                        prev.map((k, i) =>
                                                                            i === idx ? { ...k, vuotiLavatiIniziali: val } : k
                                                                        )
                                                                    );
                                                                }}
                                                                className="w-24 bg-slate-800 border border-slate-600 rounded px-2.5 py-1.5 font-mono tabular-nums text-white"
                                                            />
                                                        </td>
                                                        <td className="py-2.5 px-2">
                                                            <input
                                                                type="number"
                                                                min={0}
                                                                value={kegsAlreadyOutAtClients[item.formato] || 0}
                                                                onChange={e => {
                                                                    const val = Number(e.target.value) || 0;
                                                                    setKegsAlreadyOutAtClients(prev => ({
                                                                        ...prev,
                                                                        [item.formato]: val,
                                                                    }));
                                                                }}
                                                                className="w-24 bg-slate-800 border border-amber-500/40 rounded px-2.5 py-1.5 font-mono tabular-nums text-amber-200"
                                                            />
                                                        </td>
                                                        <td className="py-2.5 pl-2">
                                                            <input
                                                                type="number"
                                                                min={0}
                                                                step={1}
                                                                value={item.cauzioneUnitaria}
                                                                onChange={e => {
                                                                    const val = Number(e.target.value) || 0;
                                                                    setKegConfig(prev =>
                                                                        prev.map((k, i) =>
                                                                            i === idx ? { ...k, cauzioneUnitaria: val } : k
                                                                        )
                                                                    );
                                                                }}
                                                                className="w-20 bg-slate-800 border border-slate-600 rounded px-2.5 py-1.5 font-mono tabular-nums text-white"
                                                            />
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            <div className="flex justify-between">
                                <button
                                    type="button"
                                    onClick={() => setActiveTab('GAS_TANK')}
                                    className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold"
                                >
                                    ← Indietro
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setActiveTab('TECH_GAS')}
                                    className="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-white text-xs font-semibold"
                                >
                                    Vai a Passo 4: Bombole CO₂/N₂ →
                                </button>
                            </div>
                        </div>
                    )}

                    {/* TAB 4: TECH GAS CYLINDERS */}
                    {activeTab === 'TECH_GAS' && (
                        <div className="space-y-4">
                            <div className="bg-slate-900/70 border border-slate-700/80 rounded-xl p-4 space-y-3">
                                <div>
                                    <h4 className="text-sm font-bold text-white">
                                        Bombole Cantina (CO₂ / Azoto / Argon) — Metodo "Cambio Bombola"
                                    </h4>
                                    <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                                        Non serve sapere quanti grammi o litri consumi a singolo confezionamento! Conta solo quante bombole hai oggi in cantina (<strong className="text-emerald-300">Piene Chiuse</strong>, <strong className="text-sky-300">In Uso all’impianto</strong> e <strong className="text-amber-300">Vuote da rendere</strong>). Quando una bombola finisce cliccherai semplicemente <em>"Bombola Finita → Attacca Nuova"</em>. Lascia pure a zero i gas che non usi.
                                    </p>
                                </div>

                                <div className="overflow-x-auto">
                                    <table className="w-full text-left border-collapse text-xs">
                                        <thead>
                                            <tr className="border-b border-slate-700 text-slate-400 uppercase text-[11px]">
                                                <th className="py-2 pr-3">Gas Tecnico</th>
                                                <th className="py-2 px-2">Formato</th>
                                                <th className="py-2 px-2">Piene di Scorta</th>
                                                <th className="py-2 px-2">In Uso Ora</th>
                                                <th className="py-2 px-2">Vuote da Rendere</th>
                                                <th className="py-2 pl-2">Costo Ricarica (€)</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-800">
                                            {techGasConfig.map((g, idx) => (
                                                <tr key={g.codice}>
                                                    <td className="py-2.5 pr-3 font-semibold text-white">{g.nome}</td>
                                                    <td className="py-2.5 px-2">
                                                        <div className="flex items-center gap-1">
                                                            <input
                                                                type="number"
                                                                min={1}
                                                                value={g.formatoCapacita}
                                                                onChange={e => {
                                                                    const val = Number(e.target.value) || 30;
                                                                    setTechGasConfig(prev =>
                                                                        prev.map((item, i) =>
                                                                            i === idx ? { ...item, formatoCapacita: val } : item
                                                                        )
                                                                    );
                                                                }}
                                                                className="w-16 bg-slate-800 border border-slate-600 rounded px-2 py-1.5 font-mono tabular-nums text-white"
                                                            />
                                                            <span className="text-slate-400">{g.unitaCapacita}</span>
                                                        </div>
                                                    </td>
                                                    <td className="py-2.5 px-2">
                                                        <input
                                                            type="number"
                                                            min={0}
                                                            value={g.pieneScorta}
                                                            onChange={e => {
                                                                const val = Number(e.target.value) || 0;
                                                                setTechGasConfig(prev =>
                                                                    prev.map((item, i) =>
                                                                        i === idx ? { ...item, pieneScorta: val } : item
                                                                    )
                                                                );
                                                            }}
                                                            className="w-20 bg-slate-800 border border-emerald-600/50 rounded px-2.5 py-1.5 font-mono tabular-nums text-emerald-300"
                                                        />
                                                    </td>
                                                    <td className="py-2.5 px-2">
                                                        <input
                                                            type="number"
                                                            min={0}
                                                            value={g.inUsoImpianto}
                                                            onChange={e => {
                                                                const val = Number(e.target.value) || 0;
                                                                setTechGasConfig(prev =>
                                                                    prev.map((item, i) =>
                                                                        i === idx ? { ...item, inUsoImpianto: val } : item
                                                                    )
                                                                );
                                                            }}
                                                            className="w-20 bg-slate-800 border border-sky-600/50 rounded px-2.5 py-1.5 font-mono tabular-nums text-sky-300"
                                                        />
                                                    </td>
                                                    <td className="py-2.5 px-2">
                                                        <input
                                                            type="number"
                                                            min={0}
                                                            value={g.vuoteDaRendere}
                                                            onChange={e => {
                                                                const val = Number(e.target.value) || 0;
                                                                setTechGasConfig(prev =>
                                                                    prev.map((item, i) =>
                                                                        i === idx ? { ...item, vuoteDaRendere: val } : item
                                                                    )
                                                                );
                                                            }}
                                                            className="w-20 bg-slate-800 border border-amber-600/50 rounded px-2.5 py-1.5 font-mono tabular-nums text-amber-300"
                                                        />
                                                    </td>
                                                    <td className="py-2.5 pl-2">
                                                        <input
                                                            type="number"
                                                            min={0}
                                                            step={0.5}
                                                            value={g.costoMedioRicarica}
                                                            onChange={e => {
                                                                const val = Number(e.target.value) || 0;
                                                                setTechGasConfig(prev =>
                                                                    prev.map((item, i) =>
                                                                        i === idx ? { ...item, costoMedioRicarica: val } : item
                                                                    )
                                                                );
                                                            }}
                                                            className="w-20 bg-slate-800 border border-slate-600 rounded px-2.5 py-1.5 font-mono tabular-nums text-white"
                                                        />
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            <div className="flex justify-start">
                                <button
                                    type="button"
                                    onClick={() => setActiveTab('KEG_FLEET')}
                                    className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold"
                                >
                                    ← Indietro
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Modal Footer */}
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-3 border-t border-slate-700/80">
                        <span className="text-[11px] text-slate-400">
                            Puoi riaprire questo assistente in qualsiasi momento dalla barra sinistra: <strong className="text-slate-300">Taratura Moduli</strong>.
                        </span>
                        <div className="flex items-center justify-end gap-2.5">
                            <button
                                type="button"
                                onClick={handleCloseClean}
                                className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition-colors"
                            >
                                Chiudi / Configura più tardi
                            </button>
                            <button
                                type="button"
                                disabled={saving}
                                onClick={handleSaveAll}
                                className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold shadow transition-colors"
                            >
                                {saving ? 'Salvataggio...' : 'Salva Taratura & Chiudi'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </Modal>
    );
};

export default PostImportSetupModal;
