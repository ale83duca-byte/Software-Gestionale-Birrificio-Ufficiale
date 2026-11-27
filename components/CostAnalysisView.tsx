import React, { useState, useEffect, useMemo } from 'react';
import { getBreweryData, upsertItemInSheet } from '../services/dataService';
import type { BrewHeader, Movement, PriceDBItem, CostCoefficients, PackagingData, BeerPriceList } from '../types';
import { useTranslation } from '../i18n';
import { ArrowUturnLeftIcon } from './icons';
import { CONFIG_PACKAGING } from '../constants';
import { exportCostAnalysisToExcel } from '../utils/excelExport';
import { useToast } from '../hooks/useToast';
import { Modal } from './Modal';
import { getRecommendedListPrice, getUnitLitersFromFormat, lookupPriceInMap } from '../utils/pricingEngine';

interface CostAnalysisViewProps {
    selectedYear: string;
    lottoToOpenId?: string | null;
    onExit: () => void;
}

const ingredientCategories = ["MALTI", "LUPPOLI", "LIEVITI", "ADDITIVI", "SANIFICANTI"];

export const CostAnalysisView: React.FC<CostAnalysisViewProps> = ({ selectedYear, lottoToOpenId, onExit }) => {
    const { t } = useTranslation();
    const { showToast } = useToast();
    const [cotte, setCotte] = useState<BrewHeader[]>([]);
    const [movements, setMovements] = useState<Movement[]>([]);
    const [priceDb, setPriceDb] = useState<PriceDBItem[]>([]);
    const [packaging, setPackaging] = useState<PackagingData[]>([]);
    const [coeffs, setCoeffs] = useState<CostCoefficients>({});
    const [beerPriceList, setBeerPriceList] = useState<BeerPriceList[]>([]);
    const [selectedLotto, setSelectedLotto] = useState<BrewHeader | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    const [gasType, setGasType] = useState<'gpl' | 'metano'>('metano');
    const [useStorage, setUseStorage] = useState(false);
    const [epalCount, setEpalCount] = useState(0);
    const [useLabels, setUseLabels] = useState(false);
    const [lotSellingPricesInput, setLotSellingPricesInput] = useState<Record<string, string>>({});
    const [isConfirmCloseModalOpen, setConfirmCloseModalOpen] = useState(false);

    useEffect(() => {
        const loadData = async () => {
            setIsLoading(true);
            const data = await getBreweryData(selectedYear);
            if (data) {
                const sortedCotte = (data.COTTE_HEAD || []).sort((a, b) => {
                    try {
                       const dateA = new Date(a.DATA_PROD.split('/').reverse().join('-')).getTime();
                       const dateB = new Date(b.DATA_PROD.split('/').reverse().join('-')).getTime();
                       if (isNaN(dateA) || isNaN(dateB)) return 0;
                       return dateB - dateA;
                   } catch { return 0; }
                });
                setCotte(sortedCotte);
                setMovements(data.MOVIMENTAZIONE || []);
                setPriceDb(data.PRICE_DATABASE || []);
                setPackaging(data.CONFEZIONAMENTO || []);
                setCoeffs(data.COST_COEFFICIENTS || {});
                setBeerPriceList(data.BEER_PRICE_LIST || []);

                if (lottoToOpenId) {
                    const lotto = sortedCotte.find(c => c.LOTTO === lottoToOpenId);
                    if (lotto) {
                        setSelectedLotto(lotto);
                    }
                }
            }
            setIsLoading(false);
        };
        loadData();
    }, [selectedYear, lottoToOpenId]);

    useEffect(() => {
        if (selectedLotto) {
            setGasType(selectedLotto.costAnalysisGasType || 'metano');
            setUseStorage(selectedLotto.costAnalysisUseStorage || false);
            setEpalCount(selectedLotto.costAnalysisEpalCount || 0);
            setUseLabels(selectedLotto.costAnalysisUseLabels || false);
            const initPrices: Record<string, string> = {};
            const lottoFormats = Array.from(
                new Set(packaging.filter(p => p.LOTTO_PROD === selectedLotto.LOTTO).map(p => p.FORMATO))
            );
            lottoFormats.forEach(fmt => {
                const customVal = lookupPriceInMap(selectedLotto.lotSellingPrices, fmt);
                if (customVal !== null && customVal > 0) {
                    initPrices[fmt] = customVal.toFixed(2);
                } else {
                    const rec = getRecommendedListPrice({
                        beerName: selectedLotto.NOME_BIRRA,
                        format: fmt,
                        beerPriceList,
                    });
                    initPrices[fmt] = rec.price > 0 ? rec.price.toFixed(2) : '';
                }
            });
            // Keep any previously stored keys not currently in packaging
            Object.entries(selectedLotto.lotSellingPrices || {}).forEach(([k, v]) => {
                if (initPrices[k] === undefined && typeof v === 'number' && v > 0) {
                    initPrices[k] = v.toFixed(2);
                }
            });
            setLotSellingPricesInput(initPrices);
        }
    }, [selectedLotto, packaging, beerPriceList]);

    const buildNormalizedLotSellingPrices = (): Record<string, number> => {
        const result: Record<string, number> = {};
        Object.entries(lotSellingPricesInput).forEach(([fmt, valStr]) => {
            const parsed = parseFloat(String(valStr).replace(',', '.'));
            if (!isNaN(parsed) && parsed > 0) {
                result[fmt] = Number(parsed.toFixed(2));
            }
        });
        return result;
    };

    const handleSaveLotSellingPrices = async () => {
        if (!selectedLotto) return;
        const normalizedPrices = buildNormalizedLotSellingPrices();
        const updatedLotto: BrewHeader = {
            ...selectedLotto,
            lotSellingPrices: normalizedPrices,
        };
        await upsertItemInSheet(selectedYear, 'COTTE_HEAD', updatedLotto, 'LOTTO');
        setSelectedLotto(updatedLotto);
        setCotte(prev => prev.map(c => c.LOTTO === updatedLotto.LOTTO ? updatedLotto : c));
        showToast(`Prezzi di vendita per il lotto ${selectedLotto.LOTTO} salvati e collegati al Magazzino Birra Finita!`, 'success');
    };

    const handleSaveAnalysisState = async () => {
        if (!selectedLotto) return;
        const normalizedPrices = buildNormalizedLotSellingPrices();
        const updatedLotto = {
            ...selectedLotto,
            costAnalysisGasType: gasType,
            costAnalysisUseStorage: useStorage,
            costAnalysisEpalCount: epalCount,
            costAnalysisUseLabels: useLabels,
            lotSellingPrices: normalizedPrices,
        };
        await upsertItemInSheet(selectedYear, 'COTTE_HEAD', updatedLotto, 'LOTTO');
        setSelectedLotto(updatedLotto); // Update local state
        setCotte(prev => prev.map(c => c.LOTTO === updatedLotto.LOTTO ? updatedLotto : c));
        showToast(t('toast.analysisStateSaved'), 'success');
    };

    const handleConfirmCloseAnalysis = async () => {
        if (!selectedLotto) return;
        const normalizedPrices = buildNormalizedLotSellingPrices();
        const updatedLotto = { 
            ...selectedLotto, 
            isCostAnalysisClosed: true,
            lotSellingPrices: normalizedPrices,
            savedCostAnalysis: {
                rawMaterialsCosts,
                otherCosts,
                analysisSummary,
                packagingAnalysis
            }
        };
        await upsertItemInSheet(selectedYear, 'COTTE_HEAD', updatedLotto, 'LOTTO');
        setSelectedLotto(updatedLotto);
        setCotte(prev => prev.map(c => c.LOTTO === updatedLotto.LOTTO ? updatedLotto : c));
        setConfirmCloseModalOpen(false);
        showToast(t('toast.analysisClosed'), 'success');
    };

    const handleReopenAnalysis = async () => {
        if (!selectedLotto) return;
        const updatedLotto: BrewHeader = {
            ...selectedLotto,
            isCostAnalysisClosed: false,
            savedCostAnalysis: undefined,
        };
        await upsertItemInSheet(selectedYear, 'COTTE_HEAD', updatedLotto, 'LOTTO');
        setSelectedLotto(updatedLotto);
        setCotte(prev => prev.map(c => c.LOTTO === updatedLotto.LOTTO ? updatedLotto : c));
        showToast(`Analisi costi del lotto ${selectedLotto.LOTTO} riaperta e ricalcolata sui dati attuali del lotto.`, 'info');
    };

    const rawMaterialsCosts = useMemo(() => {
        if (!selectedLotto) return null;
        if (selectedLotto.isCostAnalysisClosed && selectedLotto.savedCostAnalysis?.rawMaterialsCosts) {
            return selectedLotto.savedCostAnalysis.rawMaterialsCosts;
        }

        const currentPriceDb = selectedLotto.frozenPrices || priceDb;

        const ingredientMovements = (selectedLotto.isCarriedOver && selectedLotto.carriedOverIngredients && selectedLotto.carriedOverIngredients.length > 0)
            ? selectedLotto.carriedOverIngredients
            : movements.filter(m => 
                m.LOTTO_PRODUZIONE === selectedLotto.LOTTO && 
                m.KG_LITRI_PZ < 0 && 
                ingredientCategories.includes(m.TIPOLOGIA)
            );

        const costsByCategory: Record<string, { items: any[], total: number }> = {};
        let grandTotal = 0;

        // Fix: Explicitly type m as Movement to ensure property access works and avoids unknown type errors
        ingredientMovements.forEach((m: Movement) => {
            const quantity = Math.abs(m.KG_LITRI_PZ);
            const movNome = (m.NOME || '').toUpperCase();
            const movMarca = (m.MARCA || '').toUpperCase();
            const movFornitore = (m.FORNITORE || '').toUpperCase();

            const priceItem = currentPriceDb.find(p => p.NOME === movNome && p.MARCA === movMarca && p.FORNITORE === movFornitore);
            const unitPrice = priceItem ? priceItem.PREZZO : 0;
            const totalCost = quantity * unitPrice;

            if (!costsByCategory[m.TIPOLOGIA]) {
                costsByCategory[m.TIPOLOGIA] = { items: [], total: 0 };
            }
            costsByCategory[m.TIPOLOGIA].items.push({ nome: m.NOME, qta: quantity, prezzoUnitario: unitPrice, costoTotale: totalCost });
            costsByCategory[m.TIPOLOGIA].total += totalCost;
            grandTotal += totalCost;
        });
        
        return { costsByCategory, grandTotal };
    }, [selectedLotto, movements, priceDb]);

    const otherCosts = useMemo(() => {
        if (!selectedLotto) return null;
        if (selectedLotto.isCostAnalysisClosed && selectedLotto.savedCostAnalysis?.otherCosts) {
            return selectedLotto.savedCostAnalysis.otherCosts;
        }
        
        const currentCoeffs = selectedLotto.frozenCoeffs || coeffs;

        const gasCotta = parseFloat(selectedLotto.GAS_COTTA?.replace(',', '.') || '0');
        const gasConfezionamento = parseFloat(selectedLotto.GAS_CONFEZIONAMENTO?.replace(',', '.') || '0');
        const gasUsed = gasCotta + gasConfezionamento;

        const gasPrice = gasType === 'gpl' ? (currentCoeffs.prezzo_gpl_mc || 0) : (currentCoeffs.prezzo_metano_mc || 0);
        const gasCost = gasUsed * gasPrice;

        const co2Cost = selectedLotto.FLAG_CO2 ? (currentCoeffs.costo_co2 || 0) : 0;
        const azotoCost = selectedLotto.FLAG_AZOTO ? (currentCoeffs.costo_azoto || 0) : 0;
        const additionalGasesCost = co2Cost + azotoCost;

        const currentYearLitersPackaged = packaging.filter(p => p.LOTTO_PROD === selectedLotto.LOTTO).reduce((sum, p) => sum + p.LITRI_TOT, 0);
        const totalLitersPackaged = currentYearLitersPackaged + (selectedLotto.litriGiaConfezionatiAnnoPrec || 0);
        const hectolitersPackaged = totalLitersPackaged / 100;
        const plato = parseFloat((selectedLotto.PLATO_FISCALE || selectedLotto.PLATO_INIZIALE)?.replace(',', '.') || '0');
        const exciseCoefficient = currentCoeffs.coefficiente_accise || 0;
        const exciseDutyCost = plato * hectolitersPackaged * exciseCoefficient;
        
        const storageCost = useStorage ? (currentCoeffs.spese_stoccaggio || 0) : 0;
        const epalCountNum = epalCount || 0;
        const epalTotalCost = epalCountNum * (currentCoeffs.costo_epal || 0);
        const managementCost = totalLitersPackaged * (currentCoeffs.spese_gestione_litro || 0);

        const total = gasCost + additionalGasesCost + exciseDutyCost + storageCost + epalTotalCost + managementCost;

        return {
            gas: { used: gasUsed, price: gasPrice, total: gasCost },
            additionalGases: { co2: co2Cost, azoto: azotoCost, total: additionalGasesCost },
            exciseDuty: { plato, hl: hectolitersPackaged, coeff: exciseCoefficient, total: exciseDutyCost },
            storage: { total: storageCost },
            epal: { count: epalCountNum, price: currentCoeffs.costo_epal || 0, total: epalTotalCost },
            management: { liters: totalLitersPackaged, coeff: currentCoeffs.spese_gestione_litro || 0, total: managementCost },
            grandTotal: total
        };

    }, [selectedLotto, packaging, coeffs, gasType, useStorage, epalCount]);
    
    const analysisSummary = useMemo(() => {
        if (!selectedLotto) return null;
        if (selectedLotto.isCostAnalysisClosed && selectedLotto.savedCostAnalysis?.analysisSummary) {
            return selectedLotto.savedCostAnalysis.analysisSummary;
        }

        const currentYearLitersPackaged = packaging.filter(p => p.LOTTO_PROD === selectedLotto.LOTTO).reduce((sum, p) => sum + p.LITRI_TOT, 0);
        const totalLitersPackaged = currentYearLitersPackaged + (selectedLotto.litriGiaConfezionatiAnnoPrec || 0);
        const grandTotal = (rawMaterialsCosts?.grandTotal || 0) + (otherCosts?.grandTotal || 0);
        const beerPricePerLiter = totalLitersPackaged > 0 ? grandTotal / totalLitersPackaged : 0;
        
        return { totalLitersPackaged, grandTotal, beerPricePerLiter };
    }, [selectedLotto, packaging, rawMaterialsCosts, otherCosts]);

    const packagingAnalysis = useMemo(() => {
        if (!selectedLotto || !analysisSummary || analysisSummary.beerPricePerLiter === 0) return null;
        if (selectedLotto.isCostAnalysisClosed && selectedLotto.savedCostAnalysis?.packagingAnalysis) {
            return selectedLotto.savedCostAnalysis.packagingAnalysis;
        }
        
        const currentPriceDb = selectedLotto.frozenPrices || priceDb;
        const currentCoeffs = selectedLotto.frozenCoeffs || coeffs;

        const lottoPackaging = packaging.filter(p => p.LOTTO_PROD === selectedLotto.LOTTO);
        const uniqueFormats = [...new Set(lottoPackaging.map(p => p.FORMATO))];

        const bottleFormats = uniqueFormats.filter(f => f.toUpperCase().includes('BOTT'));
        const kegFormats = uniqueFormats.filter(f => f.toUpperCase().includes('FUSTO') || f.toUpperCase().includes('KEG'));

        // --- KEG CALCULATION ---
        const kegs = kegFormats.map(formato => {
            const config = CONFIG_PACKAGING[formato];
            if (!config || config.litriUnit <= 0) return null;

            const totalKegs = lottoPackaging.filter(p => p.FORMATO === formato).reduce((sum, p) => sum + p.QTA_UNITA, 0);

            const isSteelKeg = formato.toUpperCase().includes('ACCIAIO');
            let containerUnitCost;

            if (isSteelKeg) {
                containerUnitCost = currentCoeffs.costo_lavaggio_fusto_acciaio || 0;
            } else {
                const priceItem = currentPriceDb.find(p => p.NOME === config.nomeInvCont);
                containerUnitCost = priceItem ? priceItem.PREZZO : 0;
            }
            
            const containerCostPerLiter = containerUnitCost / config.litriUnit;
            const finalPricePerLiter = analysisSummary.beerPricePerLiter + containerCostPerLiter;

            return {
                formato,
                totalKegs,
                beerCostPerLiter: analysisSummary.beerPricePerLiter,
                containerCostPerLiter,
                finalPricePerLiter
            };
        }).filter(Boolean);

        // --- BOTTLE CALCULATION ---
        const allCapsPrices = currentPriceDb.filter(p => p.NOME.toUpperCase().includes('TAPPO'));
        allCapsPrices.sort((a, b) => {
             const dateA = new Date(a.DATA_ULTIMO_CARICO.split('/').reverse().join('-')).getTime();
             const dateB = new Date(b.DATA_ULTIMO_CARICO.split('/').reverse().join('-')).getTime();
             return dateB - dateA;
        });
        const defaultCapPrice = allCapsPrices.length > 0 ? allCapsPrices[0].PREZZO : 0;

        const bottles = bottleFormats.map(formato => {
            const config = CONFIG_PACKAGING[formato];
            if (!config) return null;

            const formatRuns = lottoPackaging.filter(p => p.FORMATO === formato);
            const totalBottles = formatRuns.reduce((sum, p) => sum + p.QTA_UNITA, 0);
            if (totalBottles === 0) return null;

            const bottlesWithCartons = formatRuns
                .filter(p => p.usedCartons !== false)
                .reduce((sum, p) => sum + p.QTA_UNITA, 0);

            const totalCartons = (config.pezziPerCartone && config.pezziPerCartone > 0 && bottlesWithCartons > 0) 
                ? Math.ceil(bottlesWithCartons / config.pezziPerCartone) 
                : 0;

            const beerCost = analysisSummary.beerPricePerLiter * config.litriUnit;
            
            const bottlePriceItem = currentPriceDb.find(p => p.NOME === config.nomeInvCont);
            const bottleCost = bottlePriceItem ? bottlePriceItem.PREZZO : 0;

            // Determina il prezzo del tappo realmente selezionato in confezionamento (es. 26mm vs 29mm)
            const recordedCapName = formatRuns.find(r => r.capNameUsed)?.capNameUsed;
            const specificCapItem = recordedCapName
                ? currentPriceDb.find(p => p.NOME.toUpperCase() === recordedCapName.toUpperCase())
                : (formato.includes('75')
                    ? currentPriceDb.find(p => p.NOME.toUpperCase().includes('29'))
                    : currentPriceDb.find(p => p.NOME.toUpperCase().includes('26')));
            const capPrice = specificCapItem ? specificCapItem.PREZZO : defaultCapPrice;

            let cartonCostPerBottle = 0;
            if (config.nomeInvScatola && totalCartons > 0) {
                const cartonPriceItem = currentPriceDb.find(p => p.NOME === config.nomeInvScatola);
                const cartonCost = cartonPriceItem ? cartonPriceItem.PREZZO : 0;
                cartonCostPerBottle = totalBottles > 0 ? (totalCartons * cartonCost) / totalBottles : 0;
            }

            const labelCost = useLabels ? (currentCoeffs.costo_etichetta || 0) : 0;
            const finalPricePerBottle = beerCost + bottleCost + capPrice + cartonCostPerBottle + labelCost;
            const totalCostForFormat = finalPricePerBottle * totalBottles;

            return {
                formato, totalBottles, totalCartons, beerCost, bottleCost, capPrice,
                cartonCostPerBottle, labelCost, finalPricePerBottle, totalCostForFormat
            };
        }).filter(Boolean);


        return { kegs, bottles };

    }, [selectedLotto, analysisSummary, packaging, priceDb, coeffs, useLabels]);

    const lotCommercialPricingRows = useMemo(() => {
        if (!selectedLotto) return [];
        const lottoPackaging = packaging.filter(p => p.LOTTO_PROD === selectedLotto.LOTTO);
        const formats = Array.from(new Set(lottoPackaging.map(p => p.FORMATO)));

        return formats.map(formato => {
            const qty = lottoPackaging.filter(p => p.FORMATO === formato).reduce((s, p) => s + p.QTA_UNITA, 0);
            const unitLiters = getUnitLitersFromFormat(formato);

            const bottleEntry = packagingAnalysis?.bottles?.find((b: any) => b && b.formato === formato);
            const kegEntry = packagingAnalysis?.kegs?.find((k: any) => k && k.formato === formato);

            let unitProdCost = 0;
            if (bottleEntry) {
                unitProdCost = bottleEntry.finalPricePerBottle || 0;
            } else if (kegEntry) {
                unitProdCost = (kegEntry.finalPricePerLiter || 0) * unitLiters;
            } else if (analysisSummary?.beerPricePerLiter) {
                unitProdCost = analysisSummary.beerPricePerLiter * unitLiters;
            }

            const rec = getRecommendedListPrice({
                beerName: selectedLotto.NOME_BIRRA,
                format: formato,
                beerPriceList,
            });

            const rawInput = lotSellingPricesInput[formato] ?? '';
            const chosenSellingPrice = parseFloat(rawInput.replace(',', '.')) || 0;
            const unitMargin = chosenSellingPrice > 0 ? chosenSellingPrice - unitProdCost : 0;
            const marginPct = chosenSellingPrice > 0 ? (unitMargin / chosenSellingPrice) * 100 : 0;
            const totalMarketValue = chosenSellingPrice * qty;
            const totalCost = unitProdCost * qty;
            const totalMargin = totalMarketValue - totalCost;

            return {
                formato,
                qty,
                unitLiters,
                unitProdCost,
                recommendedPrice: rec.price,
                rawInput,
                chosenSellingPrice,
                unitMargin,
                marginPct,
                totalMarketValue,
                totalMargin,
            };
        });
    }, [selectedLotto, packaging, packagingAnalysis, analysisSummary, beerPriceList, lotSellingPricesInput]);

    const applyAllRecommendedPrices = () => {
        const next: Record<string, string> = { ...lotSellingPricesInput };
        lotCommercialPricingRows.forEach(row => {
            if (row.recommendedPrice > 0) {
                next[row.formato] = row.recommendedPrice.toFixed(2);
            }
        });
        setLotSellingPricesInput(next);
        showToast('Prezzi consigliati dal Listino Birre Finite applicati ai formati del lotto.', 'info');
    };
    
    const handleBack = () => {
        if(lottoToOpenId) {
            onExit();
        } else {
            setSelectedLotto(null);
        }
    }
    
    const handleExport = () => {
        if (selectedLotto && rawMaterialsCosts && otherCosts && analysisSummary) {
            try {
                exportCostAnalysisToExcel(selectedLotto, rawMaterialsCosts, otherCosts, analysisSummary, packagingAnalysis);
            } catch (error) {
                console.error('Export to Excel failed:', error);
                showToast('Esportazione Excel fallita. Controlla la console per i dettagli.', 'error');
            }
        } else {
            showToast('Dati incompleti per l\'esportazione.', 'error');
        }
    };


    if (isLoading) {
        return <div className="text-center p-8">Caricamento dati...</div>;
    }
    
    if (!selectedLotto) {
        return (
             <div className="bg-brew-dark-secondary p-4 rounded-lg shadow-lg">
                <h2 className="text-2xl font-bold text-brew-accent mb-4">{t('costAnalysis.selectLottoTitle')}</h2>
                <div className="overflow-x-auto max-h-[70vh]">
                    <table className="w-full text-sm text-left text-gray-300">
                        <thead className="text-xs text-brew-dark uppercase bg-brew-accent sticky top-0">
                            <tr>
                                <th className="px-3 py-3">{t('costAnalysis.lotto')}</th>
                                <th className="px-3 py-3">{t('costAnalysis.beerName')}</th>
                                <th className="px-3 py-3">{t('costAnalysis.client')}</th>
                                <th className="px-3 py-3">{t('costAnalysis.prodDate')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {cotte.map(cotta => (
                                <tr key={cotta.LOTTO} onClick={() => setSelectedLotto(cotta)} className="cursor-pointer hover:bg-slate-600/50 border-b border-slate-700">
                                    <td className="px-3 py-2 font-semibold text-brew-accent">{cotta.LOTTO}</td>
                                    <td className="px-3 py-2">{cotta.NOME_BIRRA}</td>
                                    <td className="px-3 py-2">{cotta.CLIENTE}</td>
                                    <td className="px-3 py-2">{cotta.DATA_PROD}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {cotte.length === 0 && (
                         <p className="text-center text-slate-400 mt-8 py-4">{t('costAnalysis.noLottos')}</p>
                    )}
                </div>
            </div>
        );
    }

    const isClosed = selectedLotto.isCostAnalysisClosed === true;

    return (
        <div>
            <button onClick={handleBack} className="flex items-center gap-2 mb-4 px-3 py-2 bg-brew-dark-secondary rounded-md text-sm font-semibold hover:bg-slate-600">
                <ArrowUturnLeftIcon className="w-4 h-4" />
                {t('costAnalysis.backToSelection')}
            </button>
            <div className="bg-brew-dark-secondary p-4 rounded-lg shadow-lg space-y-6">
                <h2 className="text-2xl font-bold text-brew-accent">{t('costAnalysis.analysisTitle')}: <span className="text-white">{selectedLotto.LOTTO}</span></h2>
                
                {isClosed && (
                    <div className="p-3 bg-yellow-500/20 border border-yellow-500 text-yellow-300 rounded-lg text-center font-bold">
                        {t('costAnalysis.analysisClosedMessage')}
                    </div>
                )}

                <div className="bg-brew-dark p-4 rounded-lg">
                    <h3 className="text-xl font-bold mb-3">{t('costAnalysis.rawMaterialsCost')}</h3>
                    <div className="space-y-6">
                        {rawMaterialsCosts && Object.keys(rawMaterialsCosts.costsByCategory).sort().map(category => (
                            <div key={category}>
                                 <h4 className="font-semibold text-brew-accent border-b border-slate-600 pb-1 mb-2">{category}</h4>
                                 <table className="w-full text-sm">
                                     <thead><tr className="text-left text-slate-400">
                                         <th className="py-1 px-2 font-medium">{t('costAnalysis.ingredient')}</th>
                                         <th className="py-1 px-2 font-medium text-right">{t('costAnalysis.quantityUsed')}</th>
                                         <th className="py-1 px-2 font-medium text-right">{t('costAnalysis.unitPrice')}</th>
                                         <th className="py-1 px-2 font-medium text-right">{t('costAnalysis.totalCost')}</th>
                                     </tr></thead>
                                     <tbody>{rawMaterialsCosts.costsByCategory[category].items.map((item: any, index: number) => (
                                         <tr key={index} className="border-t border-slate-700/50">
                                             <td className="py-1 px-2">{item.nome}</td>
                                             <td className="py-1 px-2 text-right">{item.qta.toFixed(2)}</td>
                                             <td className="py-1 px-2 text-right">{item.prezzoUnitario > 0 ? `€${item.prezzoUnitario.toFixed(2)}` : <span className="text-red-500 text-xs">{t('costAnalysis.priceNotFound')}</span>}</td>
                                             <td className="py-1 px-2 text-right font-medium">€{item.costoTotale.toFixed(2)}</td>
                                         </tr>
                                     ))}</tbody>
                                     <tfoot><tr className="border-t-2 border-slate-600">
                                         <td colSpan={3} className="pt-2 px-2 text-right font-bold">{t('costAnalysis.subtotal')} {category}</td>
                                         <td className="pt-2 px-2 text-right font-bold text-lg">€{rawMaterialsCosts.costsByCategory[category].total.toFixed(2)}</td>
                                     </tr></tfoot>
                                 </table>
                            </div>
                        ))}
                    </div>
                    <div className="mt-6 pt-4 border-t-2 border-brew-accent text-right">
                        <p className="text-lg font-semibold">{t('costAnalysis.grandTotalRawMaterials')}</p>
                        <p className="text-3xl font-bold text-brew-accent">€{rawMaterialsCosts?.grandTotal.toFixed(2)}</p>
                    </div>
                </div>

                <div className="bg-brew-dark p-4 rounded-lg">
                    <h3 className="text-xl font-bold mb-3">{t('costAnalysis.otherCosts')}</h3>
                    {otherCosts && (
                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-4 items-center p-2 border-b border-slate-700">
                                <label className="font-semibold">{t('costAnalysis.totalGasCost')}</label>
                                <div className="text-right">
                                    <p className="text-sm text-slate-400">{otherCosts.gas.used.toFixed(2)} m³ * €{otherCosts.gas.price.toFixed(2)}/m³</p>
                                    <p className="font-bold text-lg">€{otherCosts.gas.total.toFixed(2)}</p>
                                </div>
                                <label className="text-sm text-slate-400">{t('costAnalysis.gasType')}</label>
                                <select value={gasType} onChange={e => setGasType(e.target.value as any)} className="bg-brew-dark-secondary p-1 rounded-md text-sm disabled:opacity-50" disabled={isClosed}>
                                    <option value="metano">Metano</option>
                                    <option value="gpl">GPL</option>
                                </select>
                            </div>
                            <div className="grid grid-cols-2 gap-4 items-center p-2 border-b border-slate-700">
                            <label className="font-semibold">{t('costAnalysis.additionalGases')}</label>
                                <div className="text-right">
                                    {selectedLotto.FLAG_CO2 && <p className="text-sm text-slate-400">CO2: €{otherCosts.additionalGases.co2.toFixed(2)}</p>}
                                    {selectedLotto.FLAG_AZOTO && <p className="text-sm text-slate-400">Azoto: €{otherCosts.additionalGases.azoto.toFixed(2)}</p>}
                                    <p className="font-bold text-lg">€{otherCosts.additionalGases.total.toFixed(2)}</p>
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4 items-center p-2 border-b border-slate-700">
                            <label className="font-semibold">{t('costAnalysis.exciseDuty')}</label>
                                <div className="text-right">
                                    <p className="text-sm text-slate-400">{otherCosts.exciseDuty.plato.toFixed(2)}°P * {otherCosts.exciseDuty.hl.toFixed(4)} hL * €{otherCosts.exciseDuty.coeff.toFixed(2)}</p>
                                    <p className="font-bold text-lg">€{otherCosts.exciseDuty.total.toFixed(2)}</p>
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4 items-center p-2 border-b border-slate-700">
                            <div className="flex items-center gap-2"><input type="checkbox" checked={useStorage} onChange={e => setUseStorage(e.target.checked)} className="h-4 w-4 rounded bg-brew-dark-secondary disabled:opacity-50" disabled={isClosed}/> <label className="font-semibold">{t('costAnalysis.storage')}</label></div>
                            <p className="font-bold text-lg text-right">€{otherCosts.storage.total.toFixed(2)}</p>
                            <div className="flex items-center gap-2"><input type="number" value={epalCount} onChange={e => setEpalCount(parseInt(e.target.value) || 0)} className="w-16 bg-brew-dark-secondary p-1 rounded-md disabled:opacity-50" disabled={isClosed}/> <label className="font-semibold">{t('costAnalysis.epal')}</label></div>
                            <p className="font-bold text-lg text-right">€{otherCosts.epal.total.toFixed(2)}</p>
                            <label className="font-semibold">{t('costAnalysis.managementFees')}</label>
                            <p className="font-bold text-lg text-right">€{otherCosts.management.total.toFixed(2)}</p>
                            </div>
                        </div>
                    )}
                </div>

                {packagingAnalysis && packagingAnalysis.kegs.length > 0 && (
                    <div className="bg-brew-dark p-4 rounded-lg">
                        <h3 className="text-xl font-bold mb-3">{t('costAnalysis.packagingCostAnalysis')}</h3>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead><tr className="text-left text-slate-400">
                                    <th className="py-1 px-2 font-medium">{t('costAnalysis.packagingFormat')}</th>
                                    <th className="py-1 px-2 font-medium text-right">{t('costAnalysis.kegCount')}</th>
                                    <th className="py-1 px-2 font-medium text-right">{t('costAnalysis.beerCostPerLiter')}</th>
                                    <th className="py-1 px-2 font-medium text-right">{t('costAnalysis.containerCostPerLiter')}</th>
                                    <th className="py-1 px-2 font-medium text-right">{t('costAnalysis.finalPricePerLiter')}</th>
                                </tr></thead>
                                <tbody>
                                    {packagingAnalysis.kegs.map((item: any, index: number) => item && (
                                        <tr key={index} className="border-t border-slate-700/50">
                                            <td className="py-2 px-2 font-bold">{item.formato}</td>
                                            <td className="py-2 px-2 text-right">{item.totalKegs}</td>
                                            <td className="py-2 px-2 text-right">€{item.beerCostPerLiter.toFixed(3)}</td>
                                            <td className="py-2 px-2 text-right">€{item.containerCostPerLiter.toFixed(3)}</td>
                                            <td className="py-2 px-2 text-right font-bold text-lg text-brew-accent">€{item.finalPricePerLiter.toFixed(3)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
                
                {packagingAnalysis && packagingAnalysis.bottles.length > 0 && (
                    <div className="bg-brew-dark p-4 rounded-lg">
                        <div className="flex justify-between items-center mb-3">
                             <h3 className="text-xl font-bold">{t('costAnalysis.bottleCostAnalysis')}</h3>
                             <div className="flex items-center gap-2">
                                <input type="checkbox" id="useLabels" checked={useLabels} onChange={e => setUseLabels(e.target.checked)} className="h-4 w-4 rounded bg-brew-dark-secondary disabled:opacity-50" disabled={isClosed}/> 
                                <label htmlFor="useLabels" className="font-semibold text-sm">{t('costAnalysis.useLabels')}</label>
                             </div>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead><tr className="text-left text-slate-400">
                                    <th className="p-1">{t('costAnalysis.bottleFormat')}</th>
                                    <th className="p-1 text-right">{t('costAnalysis.bottleCount')}</th>
                                    <th className="p-1 text-right">{t('costAnalysis.cartonCount')}</th>
                                    <th className="p-1 text-right">{t('costAnalysis.beerCostPerBottle')}</th>
                                    <th className="p-1 text-right">{t('costAnalysis.containerCostPerBottle')}</th>
                                    <th className="p-1 text-right">{t('costAnalysis.capCostPerBottle')}</th>
                                    <th className="p-1 text-right">{t('costAnalysis.cartonCostPerBottle')}</th>
                                    <th className="p-1 text-right">{t('costAnalysis.labelCostPerBottle')}</th>
                                    <th className="p-1 text-right text-base">{t('costAnalysis.finalPricePerBottle')}</th>
                                    <th className="p-1 text-right text-base">{t('costAnalysis.totalPriceForFormat')}</th>
                                </tr></thead>
                                <tbody>
                                    {packagingAnalysis.bottles.map((item: any, index: number) => item && (
                                        <tr key={index} className="border-t border-slate-700/50">
                                            <td className="p-2 font-bold">{item.formato}</td>
                                            <td className="p-2 text-right">{item.totalBottles}</td>
                                            <td className="p-2 text-right">{item.totalCartons}</td>
                                            <td className="p-2 text-right">€{item.beerCost.toFixed(3)}</td>
                                            <td className="p-2 text-right">€{item.bottleCost.toFixed(3)}</td>
                                            <td className="p-2 text-right">€{item.capPrice.toFixed(3)}</td>
                                            <td className="p-2 text-right">€{item.cartonCostPerBottle.toFixed(3)}</td>
                                            <td className="p-2 text-right">€{item.labelCost.toFixed(3)}</td>
                                            <td className="p-2 text-right font-bold text-lg text-brew-accent">€{item.finalPricePerBottle.toFixed(3)}</td>
                                            <td className="p-2 text-right font-bold text-lg text-brew-green">€{item.totalCostForFormat.toFixed(2)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
                
                {lotCommercialPricingRows.length > 0 && (
                    <div className="bg-brew-dark p-4 rounded-lg border border-emerald-500/40 space-y-3">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-700 pb-2">
                            <div>
                                <h3 className="text-xl font-bold text-emerald-300">💶 Prezzi di Vendita, Listino Target &amp; Valore di Mercato Lotto</h3>
                                <p className="text-xs text-slate-400">
                                    Accetta il prezzo consigliato dal <strong>Listino Prezzi Birre Finite</strong> o personalizzalo per questo lotto. Il prezzo salvato valorizza le giacenze in Magazzino Birra Finita e calcola il margine reale.
                                </p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                <button
                                    type="button"
                                    onClick={applyAllRecommendedPrices}
                                    className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-amber-300 text-xs font-bold rounded border border-amber-500/40"
                                >
                                    Usa Tutti da Listino Base
                                </button>
                                <button
                                    type="button"
                                    onClick={handleSaveLotSellingPrices}
                                    className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded shadow"
                                >
                                    Salva Prezzi Vendita Lotto
                                </button>
                            </div>
                        </div>

                        <div className="overflow-x-auto">
                            <table className="w-full text-sm text-gray-200 tabular-nums">
                                <thead>
                                    <tr className="text-left text-xs text-slate-400 uppercase border-b border-slate-700">
                                        <th className="p-2">Formato</th>
                                        <th className="p-2 text-right">Q.tà Conf.</th>
                                        <th className="p-2 text-right">Costo Prod. (€/pz)</th>
                                        <th className="p-2 text-right">Target Listino (€/pz)</th>
                                        <th className="p-2 text-right">Prezzo Vendita Lotto (€/pz)</th>
                                        <th className="p-2 text-right">Margine Unit.</th>
                                        <th className="p-2 text-right">Valore Mercato (€)</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {lotCommercialPricingRows.map(row => (
                                        <tr key={row.formato} className="border-b border-slate-700/50">
                                            <td className="p-2 font-bold text-white">{row.formato}</td>
                                            <td className="p-2 text-right font-mono">{row.qty} pz</td>
                                            <td className="p-2 text-right font-mono text-slate-300">
                                                € {row.unitProdCost.toFixed(2)}
                                                {row.unitLiters >= 5 && (
                                                    <span className="block text-[10px] text-slate-400">
                                                        (€ {(row.unitProdCost / row.unitLiters).toFixed(2)}/L)
                                                    </span>
                                                )}
                                            </td>
                                            <td className="p-2 text-right font-mono">
                                                {row.recommendedPrice > 0 ? (
                                                    <div className="flex items-center justify-end gap-1.5">
                                                        <span className="text-amber-300 font-semibold">€ {row.recommendedPrice.toFixed(2)}</span>
                                                        <button
                                                            type="button"
                                                            onClick={() => setLotSellingPricesInput(prev => ({ ...prev, [row.formato]: row.recommendedPrice.toFixed(2) }))}
                                                            className="px-1.5 py-0.5 text-[10px] bg-slate-700 hover:bg-slate-600 text-slate-200 rounded"
                                                            title="Applica prezzo da listino"
                                                        >
                                                            Applica
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <span className="text-slate-500 text-xs">Non in listino</span>
                                                )}
                                            </td>
                                            <td className="p-2 text-right">
                                                <input
                                                    type="number"
                                                    step="0.01"
                                                    min="0"
                                                    value={row.rawInput}
                                                    placeholder={row.recommendedPrice > 0 ? row.recommendedPrice.toFixed(2) : '0.00'}
                                                    onChange={e => setLotSellingPricesInput(prev => ({ ...prev, [row.formato]: e.target.value }))}
                                                    className="w-28 bg-brew-dark-secondary border border-emerald-500/60 rounded p-1.5 text-right font-mono font-bold text-emerald-300"
                                                />
                                            </td>
                                            <td className="p-2 text-right font-mono">
                                                {row.chosenSellingPrice > 0 ? (
                                                    <span className={row.unitMargin >= 0 ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                                                        € {row.unitMargin.toFixed(2)} ({row.marginPct.toFixed(1)}%)
                                                    </span>
                                                ) : (
                                                    <span className="text-slate-500">-</span>
                                                )}
                                            </td>
                                            <td className="p-2 text-right font-mono font-bold text-white">
                                                {row.chosenSellingPrice > 0 ? `€ ${row.totalMarketValue.toFixed(2)}` : '-'}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                                {lotCommercialPricingRows.some(r => r.chosenSellingPrice > 0) && (
                                    <tfoot>
                                        <tr className="bg-slate-800/80 font-bold">
                                            <td colSpan={5} className="p-2 text-right text-slate-300">TOTALE VALORE DI MERCATO STIMATO LOTTO:</td>
                                            <td className="p-2 text-right font-mono text-emerald-400">
                                                Marg. € {lotCommercialPricingRows.reduce((s, r) => s + (r.chosenSellingPrice > 0 ? r.totalMargin : 0), 0).toFixed(2)}
                                            </td>
                                            <td className="p-2 text-right font-mono text-lg text-emerald-300">
                                                € {lotCommercialPricingRows.reduce((s, r) => s + r.totalMarketValue, 0).toFixed(2)}
                                            </td>
                                        </tr>
                                    </tfoot>
                                )}
                            </table>
                        </div>
                    </div>
                )}

                {analysisSummary && <div className="space-y-4">
                    <div className="bg-brew-dark-secondary p-4 rounded-lg text-right border border-brew-accent">
                        <h3 className="text-xl font-bold text-brew-accent">{t('costAnalysis.totalPackagedLiters')}</h3>
                        <p className="text-5xl font-extrabold text-white">{analysisSummary.totalLitersPackaged.toFixed(0)} L</p>
                    </div>
                    <div className="bg-brew-accent text-brew-dark p-4 rounded-lg text-right">
                        <h3 className="text-xl font-bold">{t('costAnalysis.grandTotal')}</h3>
                        <p className="text-4xl font-extrabold">€{analysisSummary.grandTotal.toFixed(2)}</p>
                    </div>
                    <div className="bg-brew-green text-white p-4 rounded-lg text-right">
                        <h3 className="text-xl font-bold">{t('costAnalysis.effectivePricePerLiter')}</h3>
                        <p className="text-4xl font-extrabold">€{analysisSummary.beerPricePerLiter.toFixed(3)}</p>
                    </div>
                </div>}

                <div className="pt-4 flex justify-center items-center gap-4">
                    {!isClosed ? (
                        <>
                            <button onClick={handleSaveAnalysisState} className="bg-brew-blue text-white font-bold py-3 px-6 rounded-lg text-lg hover:bg-opacity-90 transition-all shadow-lg">{t('costAnalysis.saveButton')}</button>
                            <button onClick={() => setConfirmCloseModalOpen(true)} className="bg-brew-red text-white font-bold py-3 px-6 rounded-lg text-lg hover:bg-opacity-90 transition-all shadow-lg">{t('costAnalysis.closeButton')}</button>
                        </>
                    ) : (
                        <>
                            <button onClick={handleExport} className="bg-brew-green text-white font-bold py-3 px-8 rounded-lg text-lg hover:bg-opacity-90 transition-all shadow-lg">{t('costAnalysis.exportButton')}</button>
                            <button onClick={handleReopenAnalysis} className="bg-amber-600 text-white font-bold py-3 px-6 rounded-lg text-base hover:bg-amber-500 transition-all shadow-lg">
                                Riapri / Ricalcola Analisi Costi
                            </button>
                        </>
                    )}
                </div>
            </div>
             {isConfirmCloseModalOpen && (
                <Modal title={t('costAnalysis.confirmCloseTitle')} isOpen={isConfirmCloseModalOpen} onClose={() => setConfirmCloseModalOpen(false)} size="sm">
                    <div className="space-y-4">
                        <p className="text-sm text-gray-300">{t('costAnalysis.confirmCloseMessage')}</p>
                        <div className="flex justify-end gap-4 pt-4">
                            <button onClick={() => setConfirmCloseModalOpen(false)} className="px-4 py-2 rounded-md bg-slate-600 text-white font-semibold hover:bg-slate-500">{t('costAnalysis.cancel')}</button>
                            <button onClick={handleConfirmCloseAnalysis} className="px-4 py-2 rounded-md bg-brew-red text-white font-bold hover:bg-opacity-80">{t('costAnalysis.confirm')}</button>
                        </div>
                    </div>
                </Modal>
            )}
        </div>
    );
};