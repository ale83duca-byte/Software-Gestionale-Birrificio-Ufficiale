import React, { useState, useEffect, useMemo } from 'react';
import { getBreweryData, saveDataToSheet } from '../services/dataService';
import type { FermenterConfig, BrewHeader, PackagingData, FermentationDataPoint } from '../types';
import { PlusIcon, TrashIcon } from './icons';
import { useToast } from '../hooks/useToast';
import { parseItalianDate } from '../utils/dateUtils';

interface CantinaViewProps {
    selectedYear: string;
    onOpenLotto: (lottoId: string) => void;
}

export const CantinaView: React.FC<CantinaViewProps> = ({ selectedYear, onOpenLotto }) => {
    const [fermenters, setFermenters] = useState<FermenterConfig[]>([]);
    const [cotte, setCotte] = useState<BrewHeader[]>([]);
    const [packaging, setPackaging] = useState<PackagingData[]>([]);
    const [fermentationData, setFermentationData] = useState<FermentationDataPoint[]>([]);
    const [newFermenter, setNewFermenter] = useState({ nome: '', capacita: '' });
    const { showToast } = useToast();

    useEffect(() => {
        const loadCantinaData = async () => {
            const data = await getBreweryData(selectedYear);
            if(data){
                setFermenters(data.CANTINA_CONFIG || []);
                setCotte(data.COTTE_HEAD || []);
                setPackaging(data.CONFEZIONAMENTO || []);
                setFermentationData(data.FERMENTAZIONE || []);
            }
        };
        loadCantinaData();
    }, [selectedYear]);

    const activeLotsByFermenter = useMemo(() => {
        const packagedLiters: Record<string, number> = {};
        packaging.forEach(p => {
            packagedLiters[p.LOTTO_PROD] = (packagedLiters[p.LOTTO_PROD] || 0) + p.LITRI_TOT;
        });

        const activeLots: Record<string, BrewHeader[]> = {};
        cotte.forEach(cotta => {
            const litriFinali = parseFloat(cotta.LITRI_FINALI?.replace(',', '.')) || 0;
            const litriConfezionati = packagedLiters[cotta.LOTTO] || 0;
            if (!cotta.isCellarClosed && cotta.FERMENTATORE && litriFinali > 0 && litriConfezionati < litriFinali) {
                if (!activeLots[cotta.FERMENTATORE]) {
                    activeLots[cotta.FERMENTATORE] = [];
                }
                activeLots[cotta.FERMENTATORE].push(cotta);
            }
        });
        return activeLots;
    }, [cotte, packaging]);

    const latestTemperaturesByLotto = useMemo(() => {
        const temps: Record<string, number> = {};
        const dataByLotto: Record<string, FermentationDataPoint[]> = {};
        fermentationData.forEach(point => {
            if (!dataByLotto[point.LOTTO]) {
                dataByLotto[point.LOTTO] = [];
            }
            dataByLotto[point.LOTTO].push(point);
        });

        for (const lotto in dataByLotto) {
            const points = dataByLotto[lotto];
            if (points.length > 0) {
                const latestPoint = points.reduce((latest, current) => 
                    current.GIORNO > latest.GIORNO ? current : latest
                );
                temps[lotto] = latestPoint.TEMPERATURA;
            }
        }
        return temps;
    }, [fermentationData]);

    const handleSaveFermenters = async (updatedFermenters: FermenterConfig[]) => {
        setFermenters(updatedFermenters);
        await saveDataToSheet(selectedYear, 'CANTINA_CONFIG', updatedFermenters);
        showToast("Configurazione fermentatori salvata.", 'success');
    };

    const addFermenter = () => {
        if (newFermenter.nome && newFermenter.capacita) {
            const newFerm: FermenterConfig = {
                id: `ferm_${Date.now()}`,
                nome: newFermenter.nome.toUpperCase(),
                capacita: parseFloat(newFermenter.capacita),
            };
            handleSaveFermenters([...fermenters, newFerm]);
            setNewFermenter({ nome: '', capacita: '' });
        } else {
            showToast("Nome e capacità sono obbligatori.", 'error');
        }
    };

    const removeFermenter = (id: string) => {
        if (window.confirm("Sei sicuro di voler rimuovere questo fermentatore?")) {
            handleSaveFermenters(fermenters.filter(f => f.id !== id));
        }
    };

    const getSingleLotStatus = (activeLot: BrewHeader): { status: 'occupied' | 'finishing' | 'alarm'; expectedDate?: Date } => {
        const giorniPrevisti = parseInt(activeLot.GIORNI_FERMENTAZIONE_PREVISTI || '0', 10);
        const dataProd = parseItalianDate(activeLot.DATA_PROD);

        if (giorniPrevisti > 0 && dataProd) {
            const dataFinePrevista = new Date(dataProd);
            dataFinePrevista.setDate(dataFinePrevista.getDate() + giorniPrevisti);
            
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            const daysRemaining = (dataFinePrevista.getTime() - today.getTime()) / (1000 * 3600 * 24);

            if (daysRemaining < 0) {
                return { status: 'alarm', expectedDate: dataFinePrevista };
            }
            if (daysRemaining >= 0 && daysRemaining <= 5) {
                return { status: 'finishing', expectedDate: dataFinePrevista };
            }
            return { status: 'occupied', expectedDate: dataFinePrevista };
        }
        
        return { status: 'occupied' };
    };

    const getFermenterStatus = (lots: BrewHeader[] | undefined): { status: 'free' | 'occupied' | 'finishing' | 'alarm'; expectedDate?: Date } => {
        if (!lots || lots.length === 0) {
            return { status: 'free' };
        }
        const priority = { alarm: 3, finishing: 2, occupied: 1 };
        let worst: { status: 'occupied' | 'finishing' | 'alarm'; expectedDate?: Date } = getSingleLotStatus(lots[0]);
        for (let i = 1; i < lots.length; i++) {
            const candidate = getSingleLotStatus(lots[i]);
            if (priority[candidate.status] > priority[worst.status]) {
                worst = candidate;
            } else if (
                priority[candidate.status] === priority[worst.status] &&
                candidate.expectedDate &&
                (!worst.expectedDate || candidate.expectedDate < worst.expectedDate)
            ) {
                worst = candidate;
            }
        }
        return worst;
    };

    const statusClasses = {
        free: 'bg-green-500/20 border-green-500',
        occupied: 'bg-red-500/20 border-red-500',
        finishing: 'bg-yellow-500/20 border-yellow-500',
        alarm: 'bg-yellow-500/40 border-yellow-500 animate-pulse ring-4 ring-yellow-500',
    }

    return (
        <div className="space-y-6">
            <h1 className="text-3xl font-bold text-brew-accent">🌡️ Gestione Cantina</h1>
            
            {/* Configuration Section */}
            <div className="bg-brew-dark-secondary p-4 rounded-lg shadow-lg">
                <h2 className="text-xl font-bold mb-4">Configura Fermentatori</h2>
                <div className="flex gap-4 items-end">
                    <div className="flex-grow">
                        <label className="text-xs">Nome Fermentatore</label>
                        <input type="text" value={newFermenter.nome} onChange={e => setNewFermenter(s => ({...s, nome: e.target.value}))} className="w-full bg-brew-dark p-2 rounded-md border border-slate-600"/>
                    </div>
                     <div className="w-32">
                        <label className="text-xs">Capacità (L)</label>
                        <input type="number" value={newFermenter.capacita} onChange={e => setNewFermenter(s => ({...s, capacita: e.target.value}))} className="w-full bg-brew-dark p-2 rounded-md border border-slate-600"/>
                    </div>
                    <button onClick={addFermenter} className="bg-brew-blue text-white font-bold py-2 px-4 rounded-md flex items-center gap-2"><PlusIcon className="w-5 h-5"/> Aggiungi</button>
                </div>
                 {fermenters.length > 0 && (
                    <div className="mt-4 text-xs text-slate-400">
                        Fermentatori configurati: {fermenters.map(f => (
                            <span key={f.id} className="inline-flex items-center bg-slate-700 rounded-full px-2 py-0.5 mx-1">
                                {f.nome} ({f.capacita}L)
                                <button onClick={() => removeFermenter(f.id)} className="ml-2 text-red-500 hover:text-red-400"><TrashIcon className="w-3 h-3"/></button>
                            </span>
                        ))}
                    </div>
                 )}
            </div>

            {/* Visualization Section */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
                {fermenters.map(ferm => {
                    const lotsInTank = activeLotsByFermenter[ferm.nome] || [];
                    const primaryLot = lotsInTank[lotsInTank.length - 1];
                    const isMultiBatch = lotsInTank.length > 1;
                    const totalTankLiters = lotsInTank.reduce(
                        (sum, l) => sum + (parseFloat(l.LITRI_FINALI?.replace(',', '.') || '0') || 0),
                        0
                    );
                    const { status, expectedDate } = getFermenterStatus(lotsInTank);
                    const latestTemp = primaryLot ? latestTemperaturesByLotto[primaryLot.LOTTO] : undefined;
                    
                    return (
                        <div 
                            key={ferm.id} 
                            className={`border-2 rounded-lg shadow-lg flex flex-col ${statusClasses[status]} ${lotsInTank.length === 1 ? 'cursor-pointer hover:opacity-90' : ''}`}
                            onDoubleClick={() => {
                                if (lotsInTank.length === 1) {
                                    onOpenLotto(lotsInTank[0].LOTTO);
                                }
                            }}
                        >
                           <div className="p-3 bg-black/20">
                             <h3 className="text-lg font-bold text-center">{ferm.nome}</h3>
                             <p className="text-xs text-center text-slate-400">{ferm.capacita} Litri</p>
                           </div>
                           <div className="flex-grow p-4 flex flex-col justify-center items-center space-y-2">
                                {status === 'free' ? (
                                    <p className="text-2xl font-bold text-green-400">LIBERO</p>
                                ) : isMultiBatch ? (
                                    <>
                                        <span className="text-[11px] bg-purple-600/40 text-purple-200 border border-purple-400/60 px-2.5 py-0.5 rounded-full font-extrabold uppercase tracking-wide">
                                            ⚡ Doppia Cotta ({lotsInTank.length} Lotti)
                                        </span>
                                        <p className="text-xs text-slate-300 font-semibold text-center">{primaryLot?.NOME_BIRRA}</p>
                                        <div className="w-full space-y-1.5">
                                            {lotsInTank.map(lot => (
                                                <button
                                                    key={lot.LOTTO}
                                                    type="button"
                                                    onClick={() => onOpenLotto(lot.LOTTO)}
                                                    className="w-full flex items-center justify-between bg-slate-800 hover:bg-slate-700 border border-slate-600 px-2.5 py-1.5 rounded-md text-xs transition-colors"
                                                    title={`Apri foglio cotta ${lot.LOTTO}`}
                                                >
                                                    <span className="font-bold text-brew-accent">{lot.LOTTO}</span>
                                                    <span className="text-white font-semibold">{lot.LITRI_FINALI} L ➔</span>
                                                </button>
                                            ))}
                                        </div>
                                        <p className="text-xs font-bold text-amber-200">
                                            Totale in tank: {Math.round(totalTankLiters * 10) / 10} / {ferm.capacita} L
                                        </p>
                                        {expectedDate && (
                                            <div className="mt-1 text-center bg-black/30 p-2 rounded-md w-full">
                                                <p className="text-[10px] text-slate-300 uppercase font-bold">Data Conf. Prevista</p>
                                                <p className={`text-sm font-bold ${status === 'alarm' ? 'text-red-400' : 'text-white'}`}>
                                                    {expectedDate.toLocaleDateString('it-IT')}
                                                </p>
                                            </div>
                                        )}
                                    </>
                                ) : (
                                    primaryLot && (
                                        <>
                                            <p className="text-xs text-slate-400">Lotto Attivo</p>
                                            <button
                                                type="button"
                                                onClick={() => onOpenLotto(primaryLot.LOTTO)}
                                                className="text-2xl font-bold text-brew-accent bg-slate-800 hover:bg-slate-700 px-3 py-1 rounded-md transition-colors"
                                                title="Clicca per aprire il foglio cotta"
                                            >
                                                {primaryLot.LOTTO}
                                            </button>
                                            <p className="text-xs text-slate-300 text-center font-medium">{primaryLot.NOME_BIRRA}</p>
                                            {primaryLot.isCarriedOver && (
                                                <span className="text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/40 px-2 py-0.5 rounded-full font-semibold">
                                                    🔄 Riporto {primaryLot.carriedOverFromYear}
                                                </span>
                                            )}
                                            <p className="text-sm font-semibold text-white">{primaryLot.LITRI_FINALI} L</p>
                                            {expectedDate && (
                                                <div className="mt-2 text-center bg-black/30 p-2 rounded-md w-full">
                                                    <p className="text-[10px] text-slate-300 uppercase font-bold">Data Conf. Prevista</p>
                                                    <p className={`text-sm font-bold ${status === 'alarm' ? 'text-red-400' : 'text-white'}`}>
                                                        {expectedDate.toLocaleDateString('it-IT')}
                                                    </p>
                                                </div>
                                            )}
                                        </>
                                    )
                                )}
                           </div>
                           <div className="p-2 bg-black/20 flex items-center justify-center gap-2">
                               <span className="text-sm font-semibold">T:</span>
                               <div className="w-full bg-brew-dark p-1 text-center rounded-md border border-slate-600 text-lg font-bold flex items-center justify-center">
                                    {latestTemp !== undefined ? `${latestTemp.toFixed(1)}°C` : 'N/D'}
                               </div>
                           </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};