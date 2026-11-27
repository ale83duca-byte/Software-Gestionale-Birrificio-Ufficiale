import React, { useState, useEffect, useCallback, useMemo } from 'react';
// FIX: Add 'upsertItemInSheet' to imports to resolve a 'Cannot find name' error.
import { getBreweryData, getSheetData, deleteMovementsByInvoiceAndSync, saveDataToSheet, saveCottaAndPackaging, upsertItemInSheet, updatePackagingTmcWithCascade, isInternalOwner, parseSteelKegFormat } from '../services/dataService';
import { togglePlannedBrewStatus, scaleRecipeIngredients } from '../services/calendarService';
import type { BrewHeader, FermentationDataPoint, PackagingData, Movement, WarehouseItem, FermenterConfig, Cliente, Birra, RawWarehouseItem, PlannedBrew, BeerStorageLocation, BreweryData } from '../types';
import { TrashIcon, PlusIcon, ArrowUturnLeftIcon, PencilIcon, CheckIcon, XMarkIcon } from './icons';
import { CONFIG_PACKAGING } from '../constants';
import { FermentationChart } from './FermentationChart';
import { Modal } from './Modal';
import { useToast } from '../hooks/useToast';
import { exportBrewSheetToExcel } from '../utils/excelExport';
import { useTranslation } from '../i18n';
import { parseItalianDate } from '../utils/dateUtils';
import {
    calculateBrewMetrics,
    buildYeastGenealogy,
    calculateRefermentationAbv,
    calculatePrimingSugarKg,
    parseNumericInput,
    ABV_TOLERANCE_PERCENT,
} from '../utils/brewingCalculations';

interface BrewPageProps {
    selectedYear: string;
    lottoId: string | null;
    initialPlannedBrew?: PlannedBrew | null;
    onClearPlannedBrew?: () => void;
    onExit: () => void;
    onSaveNewLotto?: (id: string) => void;
}

const initialHeaderState: BrewHeader = {
    LOTTO: '', CLIENTE: '', DATA_PROD: new Date().toLocaleDateString('it-IT'), NOME_BIRRA: '', FERMENTATORE: '',
    PLATO_INIZIALE: '', PLATO_FINALE: '', PLATO_FISCALE: '', LITRI_FINALI: '', GAS_COTTA: '', GAS_CONFEZIONAMENTO: '', FLAG_CO2: false, FLAG_AZOTO: false, TIPO_BIRRA: '',
    TIPO_FERMENTAZIONE: '', GIORNI_FERMENTAZIONE_PREVISTI: '', NOTE: '',
    mustCounterPrevious: '', mustCounterMeasured: '',
    gasBrewCounterPrevious: '', gasBrewCounterCurrent: '',
    gasPackagingCounterPrevious: '', gasPackagingCounterCurrent: '',
    washWaterCounterPrevious: '', washWaterCounterMeasured: '',
    yeastPitchType: 'NUOVO_MAGAZZINO',
    yeastSourceLotto: '',
    yeastGeneration: 0,
    yeastStrain: '',
    yeastHarvestNotes: '',
    dryHopDate: '',
    coldCrashDate: '',
    bbtTransferDate: '',
    targetAbv: '',
    carbonationMode: 'ISOBARICO',
    refermentationSugarGL: '',
};

interface IngredientRowState {
    id: number;
    tipologia: string;
    nome: string;
    lotto_fornitore: string;
    marca: string;
    fornitore: string;
    qta: string;
    gia_scaricato: boolean;
    unitHint?: string;
}

const buildScaledRowsFromBeer = (birra: Birra, targetLitersStr?: string): IngredientRowState[] => {
    const parsedTarget = targetLitersStr ? parseFloat(targetLitersStr.replace(',', '.')) : NaN;
    const scaled = scaleRecipeIngredients(birra, !isNaN(parsedTarget) && parsedTarget > 0 ? parsedTarget : undefined);
    return scaled.map((item, idx) => ({
        id: Date.now() + idx + Math.random(),
        tipologia: item.tipologia,
        nome: item.nome,
        qta: String(item.qtaMagazzino).replace('.', ','),
        lotto_fornitore: '',
        marca: '',
        fornitore: '',
        gia_scaricato: false,
        unitHint: item.unitaRicetta === 'g'
            ? `${item.unitaMagazzino} (${Math.round(item.qtaScalataRicetta)} g)`
            : item.unitaMagazzino,
    }));
};

type MaterialRequirement = { NOME: string, TIPOLOGIA: string, QTA: number, lotto: string, marca: string, fornitore: string };

interface LocalPackagingData extends PackagingData {
    isNew?: boolean;
    materials?: MaterialRequirement[];
}

const ingredientCategories = ["MALTI", "LUPPOLI", "LIEVITI", "ADDITIVI", "SANIFICANTI"];

const BrewPage: React.FC<BrewPageProps> = ({ 
    selectedYear, 
    lottoId, 
    initialPlannedBrew, 
    onClearPlannedBrew, 
    onExit, 
    onSaveNewLotto 
}) => {
    const { t } = useTranslation();
    const [header, setHeader] = useState<BrewHeader>(initialHeaderState);
    const [ingredients, setIngredients] = useState<IngredientRowState[]>([]);
    const [fermentationData, setFermentationData] = useState<FermentationDataPoint[]>([]);
    const [packagingData, setPackagingData] = useState<LocalPackagingData[]>([]);
    const [warehouseStock, setWarehouseStock] = useState<WarehouseItem[]>([]);
    const [allMovements, setAllMovements] = useState<Movement[]>([]);
    const [cantinaConfig, setCantinaConfig] = useState<FermenterConfig[]>([]);
    const [cotte, setCotte] = useState<BrewHeader[]>([]);
    const [allPackaging, setAllPackaging] = useState<PackagingData[]>([]);
    const [clienti, setClienti] = useState<Cliente[]>([]);
    const [birre, setBirre] = useState<Birra[]>([]);
    const [breweryDataSnapshot, setBreweryDataSnapshot] = useState<BreweryData | null>(null);
    const [isCloseLottoModalOpen, setIsCloseLottoModalOpen] = useState(false);
    const { showToast } = useToast();
    const [fermInput, setFermInput] = useState({
        data: new Date().toISOString().slice(0, 10),
        temp: '',
        plato: '',
        ph: '',
        pressione: '',
    });

    const dataProdValue = useMemo(() => {
        if (header.DATA_PROD && /^\d{2}\/\d{2}\/\d{4}$/.test(header.DATA_PROD)) {
            return header.DATA_PROD.split('/').reverse().join('-');
        }
        const today = new Date();
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const day = String(today.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }, [header.DATA_PROD]);

    const handleDataProdChange = (isoDate: string) => { // isoDate is 'YYYY-MM-DD'
        if (!isoDate) {
            handleHeaderChange('DATA_PROD', '');
        } else {
            const [y, m, d] = isoDate.split('-');
            handleHeaderChange('DATA_PROD', `${d}/${m}/${y}`);
        }
    };
    
    const [allowOccupiedFermenter, setAllowOccupiedFermenter] = useState(false);
    const [isUnlockedForCorrection, setIsUnlockedForCorrection] = useState(false);

    const isActuallyClosed = useMemo(() => {
        return Boolean(header.isCellarClosed || (!!lottoId && !header.FERMENTATORE) || header.isCostAnalysisClosed);
    }, [lottoId, header.FERMENTATORE, header.isCellarClosed, header.isCostAnalysisClosed]);

    const isLottoClosed = isActuallyClosed && !isUnlockedForCorrection;

    const birreClienteSelezionato = useMemo(() => {
        const clienteSelezionato = clienti.find(c => c.nome === header.CLIENTE);
        if (clienteSelezionato) {
            return birre.filter(b => b.clienteId === clienteSelezionato.id);
        }
        return [];
    }, [header.CLIENTE, clienti, birre]);

    const selectedRecipeBeer = useMemo(() => {
        return birreClienteSelezionato.find(b => b.nomeBirra === header.NOME_BIRRA)
            || birre.find(b => b.nomeBirra === header.NOME_BIRRA);
    }, [birreClienteSelezionato, birre, header.NOME_BIRRA]);

    const occupiedFermenterMap = useMemo(() => {
        const packagedLiters: Record<string, number> = {};
        allPackaging.forEach(p => {
            packagedLiters[p.LOTTO_PROD] = (packagedLiters[p.LOTTO_PROD] || 0) + p.LITRI_TOT;
        });

        const map: Record<string, string[]> = {};
        cotte.forEach(cotta => {
            if (cotta.LOTTO !== lottoId && !cotta.isCellarClosed && cotta.FERMENTATORE) {
                const litriFinali = parseFloat(cotta.LITRI_FINALI?.replace(',', '.')) || 0;
                const litriConfezionati = packagedLiters[cotta.LOTTO] || 0;
                if (litriFinali > 0 && litriConfezionati < litriFinali) {
                    if (!map[cotta.FERMENTATORE]) map[cotta.FERMENTATORE] = [];
                    map[cotta.FERMENTATORE].push(cotta.LOTTO);
                }
            }
        });
        return map;
    }, [cotte, allPackaging, lottoId]);

    const availableFermenters = useMemo(() => {
        return cantinaConfig.filter(f => {
            if (header.FERMENTATORE === f.nome) return true;
            if (allowOccupiedFermenter || header.isDoubleBatch) return true;
            return !occupiedFermenterMap[f.nome];
        });
    }, [cantinaConfig, occupiedFermenterMap, allowOccupiedFermenter, header.FERMENTATORE, header.isDoubleBatch]);

    const dataConfezionamentoPrevista = useMemo(() => {
        if (header.DATA_PROD && header.GIORNI_FERMENTAZIONE_PREVISTI) {
            const prodDate = parseItalianDate(header.DATA_PROD);
            const giorni = parseInt(header.GIORNI_FERMENTAZIONE_PREVISTI, 10);
            if (prodDate && !isNaN(giorni)) {
                prodDate.setDate(prodDate.getDate() + giorni);
                return prodDate.toLocaleDateString('it-IT');
            }
        }
        return 'N/D';
    }, [header.DATA_PROD, header.GIORNI_FERMENTAZIONE_PREVISTI]);

    const ingredientLotsStock = useMemo(() => {
        const stock: Record<string, { lotto: string; giacenza: number; marca: string; fornitore: string }[]> = {};
        const lotStockMap: Record<string, number> = {};
        const lotDetailsMap: Record<string, { nome: string; marca: string; fornitore: string }> = {};

        const normalizedMovements = allMovements.map(m => ({
            ...m,
            NOME: m.NOME ? m.NOME.toUpperCase().trim() : '',
            LOTTO_FORNITORE: m.LOTTO_FORNITORE ? m.LOTTO_FORNITORE.toUpperCase().trim() : '',
            MARCA: m.MARCA ? m.MARCA.toUpperCase().trim() : '',
            FORNITORE: m.FORNITORE ? m.FORNITORE.toUpperCase().trim() : '',
        }));

        normalizedMovements.forEach(m => {
            if (m.NOME) {
                const lotto = m.LOTTO_FORNITORE || 'NESSUN_LOTTO';
                const key = `${m.NOME}|${m.MARCA}|${m.FORNITORE}|${lotto}`;
                lotStockMap[key] = (lotStockMap[key] || 0) + m.KG_LITRI_PZ;

                if (m.KG_LITRI_PZ > 0 && !lotDetailsMap[key]) {
                    lotDetailsMap[key] = { nome: m.NOME, marca: m.MARCA, fornitore: m.FORNITORE };
                }
            }
        });
        
        Object.entries(lotStockMap).forEach(([entryKey, giacenza]) => {
            const key = entryKey as string;
            if (giacenza >= 0.01) {
                const [nome, marca, fornitore, lotto] = key.split('|');
                const details = lotDetailsMap[key] || { nome, marca, fornitore };
                if (!stock[nome]) {
                    stock[nome] = [];
                }
                stock[nome].push({ 
                    lotto, 
                    giacenza, 
                    marca: details.marca, 
                    fornitore: details.fornitore 
                });
            }
        });
        return stock;

    }, [allMovements]);

    const loadData = useCallback(async () => {
        const data = await getBreweryData(selectedYear);
        if (!data) return;

        setBreweryDataSnapshot(data);
        setAllMovements(data.MOVIMENTAZIONE);
        setCantinaConfig(data.CANTINA_CONFIG || []);
        
        const cotteData = (data.COTTE_HEAD || []).sort((a, b) => {
            try {
                const dateA = new Date(a.DATA_PROD.split('/').reverse().join('-')).getTime();
                const dateB = new Date(b.DATA_PROD.split('/').reverse().join('-')).getTime();
                return dateA - dateB;
            } catch { return 0; }
        });
        setCotte(cotteData);

        setAllPackaging(data.CONFEZIONAMENTO || []);
        setClienti(data.CLIENTI || []);
        setBirre(data.BIRRE || []);

        const stockMap = new Map<string, WarehouseItem>();
        (data.MAGAZZINO as RawWarehouseItem[]).forEach(item => {
            const key = `${item.TIPOLOGIA}|${item.NOME}`;
            const existing = stockMap.get(key) || { TIPOLOGIA: item.TIPOLOGIA, NOME: item.NOME, GIACENZA: 0 };
            existing.GIACENZA += item.GIACENZA;
            stockMap.set(key, existing);
        });
        setWarehouseStock(Array.from(stockMap.values()));

        if (lottoId) {
            const existingHeader = cotteData.find(h => h.LOTTO === lottoId);
            setHeader(existingHeader || { ...initialHeaderState, LOTTO: lottoId });
            setAllowOccupiedFermenter(Boolean(existingHeader?.isDoubleBatch));

            const targetLottoUpper = lottoId.toUpperCase().trim();
            const lotMovements = data.MOVIMENTAZIONE.filter(
                m =>
                    (m.LOTTO_PRODUZIONE || '').toUpperCase().trim() === targetLottoUpper &&
                    m.KG_LITRI_PZ < 0 &&
                    ingredientCategories.includes((m.TIPOLOGIA || '').toUpperCase().trim())
            );
            const ingredientsSource = (lotMovements.length > 0)
                ? lotMovements
                : (existingHeader?.carriedOverIngredients || []);

            setIngredients(ingredientsSource.map((m, i) => ({
                id: i + 1,
                tipologia: (m.TIPOLOGIA || '').toUpperCase().trim(),
                nome: m.NOME,
                lotto_fornitore: m.LOTTO_FORNITORE || 'NESSUN_LOTTO',
                marca: m.MARCA || '',
                fornitore: m.FORNITORE || '',
                qta: String(Math.abs(m.KG_LITRI_PZ)),
                gia_scaricato: true,
                unitHint: 'kg'
            })));
            setEditingIngredientId(null);
            setIsUnlockedForCorrection(false);

            setFermentationData(data.FERMENTAZIONE.filter(f => (f.LOTTO || '').trim().toUpperCase() === targetLottoUpper).sort((a,b) => a.GIORNO - b.GIORNO));
            setPackagingData(data.CONFEZIONAMENTO.filter(p => (p.LOTTO_PROD || '').trim().toUpperCase() === targetLottoUpper));
        } else if (initialPlannedBrew) {
            // Avvio cotta da pianificazione del calendario
            const formattedDate = initialPlannedBrew.date 
                ? initialPlannedBrew.date.split('-').reverse().join('/') 
                : new Date().toLocaleDateString('it-IT');

            const birraSelezionata = data.BIRRE?.find(b => 
                b.id === initialPlannedBrew.birraId || 
                b.nomeBirra.trim().toUpperCase() === initialPlannedBrew.birraNome.trim().toUpperCase()
            );

            const targetLitersStr = initialPlannedBrew.litriPrevisti
                ? String(initialPlannedBrew.litriPrevisti)
                : (birraSelezionata?.litriBatchBase ? String(birraSelezionata.litriBatchBase) : '');

            setHeader({
                ...initialHeaderState,
                CLIENTE: initialPlannedBrew.clienteNome || '',
                NOME_BIRRA: initialPlannedBrew.birraNome || '',
                LITRI_FINALI: targetLitersStr,
                FERMENTATORE: initialPlannedBrew.fermentatore || '',
                DATA_PROD: formattedDate,
                NOTE: initialPlannedBrew.note || '',
                PLATO_INIZIALE: birraSelezionata?.platoIniziale || '',
                TIPO_BIRRA: birraSelezionata?.tipologia || '',
                targetAbv: birraSelezionata?.gradoAlcolicoPrevisto !== undefined && birraSelezionata.gradoAlcolicoPrevisto > 0
                    ? String(birraSelezionata.gradoAlcolicoPrevisto)
                    : '',
                carbonationMode: 'ISOBARICO',
                refermentationSugarGL: birraSelezionata?.zuccheroRifermentazioneGL !== undefined && birraSelezionata.zuccheroRifermentazioneGL > 0
                    ? String(birraSelezionata.zuccheroRifermentazioneGL)
                    : '',
            });
            setAllowOccupiedFermenter(false);

            if (birraSelezionata && birraSelezionata.ricetta && birraSelezionata.ricetta.length > 0) {
                setIngredients(buildScaledRowsFromBeer(birraSelezionata, targetLitersStr));
            } else {
                setIngredients([]);
            }
            setFermentationData([]);
            setPackagingData([]);
        } else {
            setHeader(initialHeaderState);
            setAllowOccupiedFermenter(false);
            setIngredients([]);
            setFermentationData([]);
            setPackagingData([]);
        }
    }, [selectedYear, lottoId, initialPlannedBrew]);

    useEffect(() => {
        loadData();
    }, [loadData]);
    
    useEffect(() => {
        let initialDate = new Date();
        // Only for existing lots with a prod date
        if (lottoId && header.DATA_PROD) {
            const prodDate = parseItalianDate(header.DATA_PROD);
            if(prodDate) {
                prodDate.setHours(0,0,0,0);
                 if (fermentationData.length > 0) {
                    // Find the latest day number from the existing data
                    const lastDay = Math.max(...fermentationData.map(d => d.GIORNO));
                    
                    // Calculate the next date by adding (lastDay + 1) to the production date.
                    const nextMeasurementDate = new Date(prodDate.getTime());
                    nextMeasurementDate.setDate(nextMeasurementDate.getDate() + lastDay + 1);
                    
                    initialDate = nextMeasurementDate;
                } else {
                    // If no fermentation data, start from the production date
                    initialDate = prodDate;
                }
            }
        }
        // Also reset temp and plato to avoid carrying over old values
        setFermInput({ data: initialDate.toISOString().slice(0, 10), temp: '', plato: '', ph: '', pressione: '' });
    }, [lottoId, header.DATA_PROD, fermentationData]);

    const handleHeaderChange = (field: keyof BrewHeader, value: string | boolean | number) => {
        if (typeof value === 'boolean' || typeof value === 'number') {
             setHeader(prev => ({ ...prev, [field]: value }));
             return;
        }
        
        const isNumeric =
            field === 'PLATO_INIZIALE' ||
            field === 'PLATO_FINALE' ||
            field === 'PLATO_FISCALE' ||
            field === 'LITRI_FINALI' ||
            field === 'targetAbv' ||
            field === 'refermentationSugarGL';
        const isInteger = field === 'GIORNI_FERMENTAZIONE_PREVISTI';
        const isCounter = [
            'mustCounterPrevious', 'mustCounterMeasured',
            'gasBrewCounterPrevious', 'gasBrewCounterCurrent',
            'gasPackagingCounterPrevious', 'gasPackagingCounterCurrent',
            'washWaterCounterPrevious', 'washWaterCounterMeasured'
        ].includes(field);

        if ((isNumeric || isInteger || isCounter) && value !== '' && !/^[0-9]*[.,]?[0-9]*$/.test(value)) {
            return;
        }
        setHeader(prev => ({ ...prev, [field]: value }));
    };

    const handleClienteSelection = (clienteNome: string) => {
        setHeader(prev => ({
            ...prev,
            CLIENTE: clienteNome,
            NOME_BIRRA: '',
            TIPO_BIRRA: '',
            PLATO_INIZIALE: '',
            targetAbv: '',
            refermentationSugarGL: '',
        }));
        setIngredients([]);
    };

    const handleBirraSelection = (birraNome: string) => {
        const birraSelezionata = birreClienteSelezionato.find(b => b.nomeBirra === birraNome);
        if (birraSelezionata) {
            const baseLiters = birraSelezionata.litriBatchBase || 1000;
            const effectiveLitersStr = header.LITRI_FINALI && parseFloat(header.LITRI_FINALI.replace(',', '.')) > 0
                ? header.LITRI_FINALI
                : String(baseLiters);

            setHeader(prev => ({
                ...prev,
                NOME_BIRRA: birraSelezionata.nomeBirra,
                TIPO_BIRRA: birraSelezionata.tipologia,
                PLATO_INIZIALE: birraSelezionata.platoIniziale,
                LITRI_FINALI: effectiveLitersStr,
                targetAbv: birraSelezionata.gradoAlcolicoPrevisto !== undefined && birraSelezionata.gradoAlcolicoPrevisto > 0
                    ? String(birraSelezionata.gradoAlcolicoPrevisto)
                    : prev.targetAbv || '',
                refermentationSugarGL: birraSelezionata.zuccheroRifermentazioneGL !== undefined && birraSelezionata.zuccheroRifermentazioneGL > 0
                    ? String(birraSelezionata.zuccheroRifermentazioneGL)
                    : '',
            }));
            if (birraSelezionata.ricetta && birraSelezionata.ricetta.length > 0) {
                setIngredients(buildScaledRowsFromBeer(birraSelezionata, effectiveLitersStr));
                showToast(`Ricetta per ${birraSelezionata.nomeBirra} caricata e scalata su ${effectiveLitersStr} L! Seleziona i lotti.`, 'info');
            } else {
                setIngredients([]);
            }
        } else {
             setHeader(prev => ({ ...prev, NOME_BIRRA: birraNome }));
             setIngredients([]);
        }
    };

    const handleRescaleRecipeToLiters = () => {
        if (!selectedRecipeBeer || !selectedRecipeBeer.ricetta || selectedRecipeBeer.ricetta.length === 0) {
            showToast("Nessuna ricetta associata a questa birra.", 'error');
            return;
        }
        const targetLiters = parseFloat((header.LITRI_FINALI || '').replace(',', '.'));
        if (isNaN(targetLiters) || targetLiters <= 0) {
            showToast("Inserisci un volume valido in LITRI FINALI prima di riscalare la ricetta.", 'error');
            return;
        }
        const freshScaled = buildScaledRowsFromBeer(selectedRecipeBeer, header.LITRI_FINALI);
        setIngredients(prev => {
            const alreadyDischarged = prev.filter(r => r.gia_scaricato);
            if (alreadyDischarged.length > 0) {
                return [
                    ...alreadyDischarged,
                    ...freshScaled.filter(f => !alreadyDischarged.some(d => d.nome === f.nome && d.tipologia === f.tipologia)),
                ];
            }
            // Preserva eventuali lotti già selezionati a schermo per gli ingredienti corrispondenti
            return freshScaled.map(f => {
                const prevMatch = prev.find(p => !p.gia_scaricato && p.tipologia === f.tipologia && p.nome === f.nome);
                return prevMatch
                    ? { ...f, lotto_fornitore: prevMatch.lotto_fornitore, marca: prevMatch.marca, fornitore: prevMatch.fornitore }
                    : f;
            });
        });
        showToast(`Ricetta riscalata per ${targetLiters} L (base ricetta: ${selectedRecipeBeer.litriBatchBase || 1000} L).`, 'success');
    };


    const addIngredientRow = (tipologia: string) => {
        setIngredients(prev => [...prev, { id: Date.now(), tipologia, nome: '', lotto_fornitore: '', marca: '', fornitore: '', qta: '', gia_scaricato: false, unitHint: 'kg' }]);
    };
    
    const [editingIngredientId, setEditingIngredientId] = useState<number | null>(null);

    const toggleEditIngredient = (id: number) => {
        if (editingIngredientId === id) {
            setEditingIngredientId(null);
        } else {
            setEditingIngredientId(id);
        }
    };

    const updateIngredientRow = (id: number, field: 'nome' | 'lotto_fornitore' | 'qta', value: string) => {
        if (field === 'qta' && value !== '' && !/^[0-9]*[.,]?[0-9]*$/.test(value)) {
            return;
        }
        setIngredients(prev => prev.map(ing => {
            if (ing.id !== id) {
                return ing;
            }
            const newIng = {...ing};
            switch(field) {
                case 'nome':
                    if (newIng.nome !== value) {
                        newIng.lotto_fornitore = '';
                        newIng.marca = '';
                        newIng.fornitore = '';
                    }
                    newIng.nome = value;
                    break;
                case 'lotto_fornitore':
                    if (value) {
                        const [lotto, marca, fornitore] = value.split('|');
                        newIng.lotto_fornitore = lotto;
                        newIng.marca = marca || '';
                        newIng.fornitore = fornitore || '';
                    } else {
                        newIng.lotto_fornitore = '';
                        newIng.marca = '';
                        newIng.fornitore = '';
                    }
                    break;
                case 'qta':
                    newIng.qta = value;
                    break;
            }
            return newIng;
        }));
    };


    const removeIngredientRow = (id: number) => {
        setIngredients(prev => prev.filter(ing => ing.id !== id));
    };

    const handleSaveCotta = async () => {
        if (!header.LOTTO) {
            showToast("Il numero di Lotto è obbligatorio.", 'error');
            return;
        }
        const isNewLotto = !lottoId;
        const upperLotto = header.LOTTO.toUpperCase().trim();
        
        const parse = (val: string | number | undefined) => {
             if (typeof val === 'number') return val;
             if (!val) return 0;
             return parseFloat(val.replace(',', '.')) || 0;
        };
        const gasCottaValue = parse(header.gasBrewCounterCurrent) - parse(header.gasBrewCounterPrevious);
        const gasConfValue = parse(header.gasPackagingCounterCurrent) - parse(header.gasPackagingCounterPrevious);

        const isTankShared = Boolean(
            allowOccupiedFermenter ||
            (header.FERMENTATORE && (occupiedFermenterMap[header.FERMENTATORE]?.length || 0) > 0)
        );

        const updatedHeader: BrewHeader = { 
            ...header, 
            LOTTO: upperLotto,
            isDoubleBatch: isTankShared,
            GAS_COTTA: gasCottaValue > 0 ? gasCottaValue.toFixed(2).replace('.', ',') : '0',
            GAS_CONFEZIONAMENTO: gasConfValue > 0 ? gasConfValue.toFixed(2).replace('.', ',') : '0',
            // Se stiamo rettificando un lotto la cui analisi costi era chiusa, invalida la cache statica mantenendo i prezzi congelati
            ...(isUnlockedForCorrection && header.savedCostAnalysis
                ? { isCostAnalysisClosed: false, savedCostAnalysis: undefined }
                : {}),
        };

        if (!header.isCarriedOver) {
            const incompleteIngredient = ingredients.find(ing => (ing.nome || ing.qta) && (!ing.nome || !ing.qta || !ing.lotto_fornitore));
            if (incompleteIngredient) {
                showToast(`Completa nome, lotto fornitore e quantità per l'ingrediente "${incompleteIngredient.nome || incompleteIngredient.tipologia}" prima di salvare.`, 'error');
                return;
            }

            // Verifica disponibilità giacenza per lotto (includendo QUALSIASI scarico materie prime già registrato su questa cotta che verrà sostituito)
            const prevBrewDischargeMap = new Map<string, number>();
            allMovements
                .filter(m => {
                    const mLotto = (m.LOTTO_PRODUZIONE || '').toUpperCase().trim();
                    if (mLotto !== upperLotto) return false;
                    const isBrewInv = (m.N_FATTURA || '').toUpperCase().startsWith('SCARICO_COTTA_');
                    const isRawCat = m.KG_LITRI_PZ < 0 && ingredientCategories.includes((m.TIPOLOGIA || '').toUpperCase().trim());
                    return isBrewInv || isRawCat;
                })
                .forEach(m => {
                    const key = `${(m.NOME || '').toUpperCase().trim()}|${(m.LOTTO_FORNITORE || '').toUpperCase().trim() || 'NESSUN_LOTTO'}|${(m.MARCA || '').toUpperCase().trim()}|${(m.FORNITORE || '').toUpperCase().trim()}`;
                    prevBrewDischargeMap.set(key, (prevBrewDischargeMap.get(key) || 0) + Math.abs(m.KG_LITRI_PZ));
                });

            const requestedByLot = new Map<string, { nome: string; lottoLabel: string; required: number; available: number }>();
            for (const ing of ingredients) {
                if (!ing.nome || !ing.qta || !ing.lotto_fornitore) continue;
                const qty = parseFloat(ing.qta.replace(',', '.'));
                if (isNaN(qty) || qty <= 0) {
                    showToast(`Quantità non valida per "${ing.nome}".`, 'error');
                    return;
                }
                const upperNome = ing.nome.toUpperCase().trim();
                const upperLotto = ing.lotto_fornitore.toUpperCase().trim();
                const upperMarca = (ing.marca || '').toUpperCase().trim();
                const upperForn = (ing.fornitore || '').toUpperCase().trim();
                const key = `${upperNome}|${upperLotto}|${upperMarca}|${upperForn}`;

                const lotEntry = (ingredientLotsStock[upperNome] || []).find(
                    l => l.lotto === upperLotto && l.marca === upperMarca && l.fornitore === upperForn
                );
                const currentAvailable = (lotEntry?.giacenza || 0) + (prevBrewDischargeMap.get(key) || 0);
                const existingReq = requestedByLot.get(key);
                if (existingReq) {
                    existingReq.required += qty;
                } else {
                    requestedByLot.set(key, {
                        nome: ing.nome,
                        lottoLabel: upperLotto === 'NESSUN_LOTTO' ? 'Senza Lotto' : upperLotto,
                        required: qty,
                        available: currentAvailable,
                    });
                }
            }

            for (const req of requestedByLot.values()) {
                if (req.required > req.available + 0.001) {
                    showToast(`Giacenza insufficiente per ${req.nome} (Lotto: ${req.lottoLabel}). Richiesti: ${req.required.toFixed(2)}, Disponibili: ${req.available.toFixed(2)}`, 'error');
                    return;
                }
            }
        }

        // Ingredient movements (se la cotta è riportata da anno precedente, le materie prime sono già state scaricate nell'anno passato)
        const ingredientMovements = header.isCarriedOver
            ? []
            : ingredients
                .filter(ing => ing.nome && ing.qta && ing.lotto_fornitore)
                .map(ing => {
                    return {
                        DATA: header.DATA_PROD,
                        TIPOLOGIA: ing.tipologia,
                        NOME: ing.nome,
                        MARCA: ing.marca || '',
                        FORNITORE: ing.fornitore || '',
                        KG_LITRI_PZ: -parseFloat(ing.qta.replace(',', '.')),
                        N_FATTURA: `SCARICO_COTTA_${upperLotto}`,
                        LOTTO_FORNITORE: ing.lotto_fornitore === 'NESSUN_LOTTO' ? '' : ing.lotto_fornitore,
                        LOTTO_PRODUZIONE: upperLotto,
                    } as Movement;
                });
        
        // Packaging movements and data
        const newPackagingItems = packagingData.filter(p => p.isNew);
        const packagingMovements: Movement[] = [];
        newPackagingItems.forEach(pkg => {
            pkg.materials?.forEach(mat => {
                packagingMovements.push({
                    DATA: pkg.DATA,
                    TIPOLOGIA: mat.TIPOLOGIA,
                    NOME: mat.NOME,
                    MARCA: mat.marca,
                    FORNITORE: mat.fornitore,
                    KG_LITRI_PZ: -mat.QTA,
                    N_FATTURA: pkg.ID_OPERAZIONE,
                    LOTTO_FORNITORE: mat.lotto === 'NESSUN_LOTTO' ? '' : mat.lotto,
                    LOTTO_PRODUZIONE: pkg.LOTTO_PROD
                });
            });
        });
        const newPackagingData = newPackagingItems.map(({ isNew: _isNew, materials: _materials, ...rest }) => rest);

        // Save everything
        await saveCottaAndPackaging(selectedYear, {
            header: updatedHeader,
            ingredientMovements,
            packagingMovements,
            newPackagingData,
            replaceIngredients: true // Replace all existing ingredient movements for this lot
        });

        // Se la cotta è stata avviata da una pianificazione del calendario, contrassegnala come eseguita
        if (initialPlannedBrew) {
            try {
                await togglePlannedBrewStatus(selectedYear, initialPlannedBrew.id, 'PRODOTTA', upperLotto);
                onClearPlannedBrew?.();
                showToast(`Cotta ${upperLotto} registrata come Eseguita nello storico del calendario!`, 'success');
            } catch (err) {
                console.error('Errore aggiornamento stato cotta a calendario:', err);
            }
        } else {
            showToast(
                isUnlockedForCorrection
                    ? `Rettifica controllata del lotto chiuso ${upperLotto} salvata! Giacenze materie prime e costi riallineati.`
                    : "Cotta, ingredienti e confezionamento salvati!",
                'success'
            );
        }

        setEditingIngredientId(null);
        setIsUnlockedForCorrection(false);

        if (isNewLotto && onSaveNewLotto) {
            onSaveNewLotto(upperLotto);
        } else {
            await loadData();
        }
    };

    const calculatedFermentationDay = useMemo(() => {
        const prodDate = parseItalianDate(header.DATA_PROD);
        if (!prodDate || !fermInput.data) {
            return null;
        }
    
        const [year, month, day] = fermInput.data.split('-').map(Number);
        if (isNaN(year) || isNaN(month) || isNaN(day)) {
            return null;
        }
        const measurementDate = new Date(year, month - 1, day);
    
        if (isNaN(measurementDate.getTime())) {
            return null;
        }
        
        prodDate.setHours(0, 0, 0, 0);
        measurementDate.setHours(0, 0, 0, 0);
    
        const diffTime = measurementDate.getTime() - prodDate.getTime();
        if (diffTime < 0) return null;
        
        const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
        return diffDays;
    }, [header.DATA_PROD, fermInput.data]);

    const handleFermInputChange = (field: 'data' | 'temp' | 'plato' | 'ph' | 'pressione', value: string) => {
        const numericFields = ['temp', 'plato', 'ph', 'pressione'];
        if (numericFields.includes(field) && value !== '' && !/^[0-9]*[.,]?[0-9]*$/.test(value)) {
            return;
        }
        setFermInput(s => ({ ...s, [field]: value }));
    };

    const effectiveFinalPlato = useMemo(() => {
        if (header.PLATO_FINALE && header.PLATO_FINALE.trim() !== '') {
            return header.PLATO_FINALE;
        }
        if (fermentationData.length > 0) {
            return String(fermentationData[fermentationData.length - 1].PLATO);
        }
        return '';
    }, [header.PLATO_FINALE, fermentationData]);

    const brewMetrics = useMemo(() => {
        return calculateBrewMetrics(header.PLATO_INIZIALE, effectiveFinalPlato);
    }, [header.PLATO_INIZIALE, effectiveFinalPlato]);

    const carbonationMode: 'ISOBARICO' | 'RIFERMENTATO' =
        header.carbonationMode === 'RIFERMENTATO' ? 'RIFERMENTATO' : 'ISOBARICO';

    const effectiveTargetAbvStr = useMemo(() => {
        if (header.targetAbv !== undefined && header.targetAbv.trim() !== '') {
            return header.targetAbv;
        }
        if (selectedRecipeBeer?.gradoAlcolicoPrevisto && selectedRecipeBeer.gradoAlcolicoPrevisto > 0) {
            return String(selectedRecipeBeer.gradoAlcolicoPrevisto);
        }
        return '';
    }, [header.targetAbv, selectedRecipeBeer]);

    const effectiveTargetAbvNum = useMemo(() => {
        const parsed = parseNumericInput(effectiveTargetAbvStr);
        return !isNaN(parsed) && parsed > 0 ? parsed : null;
    }, [effectiveTargetAbvStr]);

    const effectiveSugarGLStr = useMemo(() => {
        if (header.refermentationSugarGL !== undefined && header.refermentationSugarGL !== '') {
            return header.refermentationSugarGL;
        }
        if (selectedRecipeBeer?.zuccheroRifermentazioneGL && selectedRecipeBeer.zuccheroRifermentazioneGL > 0) {
            return String(selectedRecipeBeer.zuccheroRifermentazioneGL);
        }
        return '';
    }, [header.refermentationSugarGL, selectedRecipeBeer]);

    const refermentationAbvAdded = useMemo(() => {
        if (carbonationMode !== 'RIFERMENTATO') return 0;
        return calculateRefermentationAbv(effectiveSugarGLStr);
    }, [carbonationMode, effectiveSugarGLStr]);

    const totalEstimatedAbv = useMemo(() => {
        if (!brewMetrics) return null;
        return brewMetrics.abv + refermentationAbvAdded;
    }, [brewMetrics, refermentationAbvAdded]);

    const abvDeviation = useMemo(() => {
        if (totalEstimatedAbv === null || effectiveTargetAbvNum === null) return null;
        return totalEstimatedAbv - effectiveTargetAbvNum;
    }, [totalEstimatedAbv, effectiveTargetAbvNum]);

    const isAbvOutOfTolerance = useMemo(() => {
        return abvDeviation !== null && Math.abs(abvDeviation) > ABV_TOLERANCE_PERCENT;
    }, [abvDeviation]);

    const packagedLitersTotal = useMemo(
        () => packagingData.reduce((sum, pkg) => sum + (pkg.LITRI_TOT || 0), 0),
        [packagingData]
    );
    const brewFinalLitersNum = parseFloat((header.LITRI_FINALI || '').replace(',', '.')) || 0;

    const primingSugarKgPackaged = useMemo(() => {
        if (carbonationMode !== 'RIFERMENTATO') return 0;
        return calculatePrimingSugarKg(effectiveSugarGLStr, packagedLitersTotal);
    }, [carbonationMode, effectiveSugarGLStr, packagedLitersTotal]);

    const primingSugarKgPreviewBrew = useMemo(() => {
        if (carbonationMode !== 'RIFERMENTATO' || packagedLitersTotal > 0) return 0;
        return calculatePrimingSugarKg(effectiveSugarGLStr, brewFinalLitersNum);
    }, [carbonationMode, effectiveSugarGLStr, packagedLitersTotal, brewFinalLitersNum]);

    const handleCarbonationModeChange = (mode: 'ISOBARICO' | 'RIFERMENTATO') => {
        setHeader(prev => {
            let nextSugar = prev.refermentationSugarGL;
            if (
                mode === 'RIFERMENTATO' &&
                (!nextSugar || nextSugar.trim() === '') &&
                selectedRecipeBeer?.zuccheroRifermentazioneGL &&
                selectedRecipeBeer.zuccheroRifermentazioneGL > 0
            ) {
                nextSugar = String(selectedRecipeBeer.zuccheroRifermentazioneGL);
            }
            return {
                ...prev,
                carbonationMode: mode,
                refermentationSugarGL: nextSugar,
            };
        });
    };

    const handleApplyPrimingSugarToIngredients = (kgAmount: number) => {
        if (isLottoClosed || header.isCarriedOver) {
            showToast("Sblocca il lotto (Rettifica Controllata) per aggiornare gli ingredienti.", 'error');
            return;
        }
        if (kgAmount <= 0) {
            showToast("Quantità di zucchero pari a 0 kg.", 'error');
            return;
        }
        const formattedQty = kgAmount.toFixed(3).replace(/\.?0+$/, '').replace('.', ',');
        const sugarWarehouseItems = warehouseStock.filter(
            w =>
                w.TIPOLOGIA === 'ADDITIVI' &&
                /(ZUCCHER|DESTROSI|GLUCOSI|PRIMING|SACCA|CANDIT)/i.test(w.NOME)
        );
        const preferredItem = sugarWarehouseItems[0];
        const preferredName = preferredItem ? preferredItem.NOME : '';
        const lotsForPreferred = preferredName ? ingredientLotsStock[preferredName.toUpperCase()] || [] : [];
        const singleLot = lotsForPreferred.length === 1 ? lotsForPreferred[0] : null;

        setIngredients(prev => {
            const existingIdx = prev.findIndex(
                ing =>
                    ing.tipologia === 'ADDITIVI' &&
                    !ing.gia_scaricato &&
                    /(ZUCCHER|DESTROSI|GLUCOSI|PRIMING|SACCA|CANDIT)/i.test(ing.nome)
            );
            if (existingIdx > -1) {
                return prev.map((ing, idx) =>
                    idx === existingIdx
                        ? { ...ing, qta: formattedQty, unitHint: 'kg (riferment.)' }
                        : ing
                );
            }
            return [
                ...prev,
                {
                    id: Date.now(),
                    tipologia: 'ADDITIVI',
                    nome: preferredName,
                    lotto_fornitore: singleLot ? singleLot.lotto : '',
                    marca: singleLot ? singleLot.marca : '',
                    fornitore: singleLot ? singleLot.fornitore : '',
                    qta: formattedQty,
                    gia_scaricato: false,
                    unitHint: 'kg (riferment.)',
                },
            ];
        });

        if (preferredName && singleLot) {
            showToast(
                `Aggiunti ${kgAmount.toFixed(3)} kg di "${preferredName}" (Lotto ${singleLot.lotto}) nella sezione ADDITIVI. Ricorda di salvare la cotta per scaricare il magazzino!`,
                'success'
            );
        } else if (preferredName) {
            showToast(
                `Aggiunti ${kgAmount.toFixed(3)} kg di "${preferredName}" in sezione ADDITIVI: seleziona il lotto fornitore e salva la cotta.`,
                'info'
            );
        } else {
            showToast(
                `Creata riga da ${kgAmount.toFixed(3)} kg nella sezione ADDITIVI: seleziona lo zucchero da magazzino, il lotto e salva la cotta.`,
                'info'
            );
        }
    };

    const yeastGenealogy = useMemo(() => {
        if (!header.LOTTO && !header.yeastSourceLotto) return { ancestors: [], children: [] };
        const tempList = cotte.some(c => c.LOTTO === header.LOTTO)
            ? cotte.map(c => (c.LOTTO === header.LOTTO ? header : c))
            : [...cotte, header];
        return buildYeastGenealogy(header.LOTTO || 'NUOVA_COTTA', tempList);
    }, [header, cotte]);

    const handleSelectYeastSourceLotto = (sourceLotto: string) => {
        if (!sourceLotto) {
            setHeader(prev => ({ ...prev, yeastSourceLotto: '', yeastGeneration: 1 }));
            return;
        }
        const sourceBrew = cotte.find(c => c.LOTTO === sourceLotto);
        const parentGen = sourceBrew?.yeastGeneration ?? 0;
        setHeader(prev => ({
            ...prev,
            yeastPitchType: 'REPITCHING',
            yeastSourceLotto: sourceLotto,
            yeastGeneration: parentGen + 1,
            yeastStrain: prev.yeastStrain || sourceBrew?.yeastStrain || '',
        }));
    };

    const addFermentationPoint = async () => {
        const { temp, plato, ph, pressione } = fermInput;
        const giorno = calculatedFermentationDay;
    
        if (giorno === null || giorno < 0 || !temp || !plato || !header.LOTTO) {
            showToast("Dati di fermentazione non validi. Controlla lotto salvato, data, temperatura e plato.", 'error');
            return;
        }
    
        // Check for duplicate day and ask for confirmation to overwrite
        if (fermentationData.some(d => d.GIORNO === giorno)) {
            if (!window.confirm(`Esiste già una misurazione per il giorno ${giorno}. Vuoi sovrascriverla?`)) {
                return; // User cancelled
            }
        }
    
        const parsedPh = ph.trim() !== '' ? parseFloat(ph.replace(',', '.')) : undefined;
        const parsedBar = pressione.trim() !== '' ? parseFloat(pressione.replace(',', '.')) : undefined;

        const newPoint: FermentationDataPoint = {
            LOTTO: header.LOTTO,
            GIORNO: giorno,
            TEMPERATURA: parseFloat(temp.replace(',', '.')),
            PLATO: parseFloat(plato.replace(',', '.')),
            PH: parsedPh !== undefined && !isNaN(parsedPh) ? parsedPh : undefined,
            PRESSIONE: parsedBar !== undefined && !isNaN(parsedBar) ? parsedBar : undefined,
        };
    
        const allFermDataForYear = await getSheetData(selectedYear, 'FERMENTAZIONE');
        
        // Filter out the old point for this lotto and day, if it exists
        const updatedFermDataForYear = allFermDataForYear.filter(d => !(d.LOTTO === header.LOTTO && d.GIORNO === giorno));
        
        // Add the new/updated point
        updatedFermDataForYear.push(newPoint);
    
        await saveDataToSheet(selectedYear, 'FERMENTAZIONE', updatedFermDataForYear);
        
        // Update local state by replacing or adding the point, then sorting
        setFermentationData(prev => [...prev.filter(d => d.GIORNO !== giorno), newPoint].sort((a, b) => a.GIORNO - b.GIORNO));
        
        // Reset input for the next day
        const [y, m, d] = fermInput.data.split('-').map(Number);
        const lastDate = new Date(y, m - 1, d);
        lastDate.setDate(lastDate.getDate() + 1);
        const nextDate = lastDate.toISOString().slice(0, 10);
        setFermInput({ data: nextDate, temp: '', plato: '', ph: '', pressione: '' });
    
        showToast(`Dati per il giorno ${giorno} salvati.`, 'success');
    };

    const [pkgInput, setPkgInput] = useState({data: new Date().toISOString().slice(0, 10), formato:'', qta:'', dataScadenza: ''});
    const [useCartons, setUseCartons] = useState(true);
    const [useReturnableSteelKeg, setUseReturnableSteelKeg] = useState(true);
    const [selectedCapName, setSelectedCapName] = useState('');
    const [pkgMaterialSelections, setPkgMaterialSelections] = useState<Record<string, string>>({});
    const [pkgInitialLocation, setPkgInitialLocation] = useState<BeerStorageLocation>('CELLA_BIRRIFICIO');
    const [pkgRefermentationDays, setPkgRefermentationDays] = useState<string>('14');
    const [editingTmcRowKey, setEditingTmcRowKey] = useState<string | null>(null);
    const [editingTmcIsoValue, setEditingTmcIsoValue] = useState<string>('');

    const startEditingTmc = (pkg: LocalPackagingData, rowKey: string) => {
        let isoVal = '';
        if (pkg.DATA_SCADENZA && /^\d{2}\/\d{2}\/\d{4}$/.test(pkg.DATA_SCADENZA)) {
            const [d, m, y] = pkg.DATA_SCADENZA.split('/');
            isoVal = `${y}-${m}-${d}`;
        }
        setEditingTmcRowKey(rowKey);
        setEditingTmcIsoValue(isoVal);
    };

    const handleSaveEditedTmc = async (pkg: LocalPackagingData, idx: number) => {
        if (!editingTmcIsoValue || !/^\d{4}-\d{2}-\d{2}$/.test(editingTmcIsoValue)) {
            showToast('Inserisci una data TMC valida.', 'error');
            return;
        }
        const [sYear, sMonth, sDay] = editingTmcIsoValue.split('-');
        const formattedScadenza = `${sDay}/${sMonth}/${sYear}`;

        if (pkg.isNew) {
            setPackagingData(prev =>
                prev.map((item, i) => (i === idx ? { ...item, DATA_SCADENZA: formattedScadenza } : item))
            );
            setEditingTmcRowKey(null);
            setEditingTmcIsoValue('');
            showToast(`TMC riga aggiornato al ${formattedScadenza}.`, 'info');
            return;
        }

        try {
            await updatePackagingTmcWithCascade(selectedYear, {
                lotto: pkg.LOTTO_PROD || header.LOTTO,
                idOperazione: pkg.ID_OPERAZIONE,
                formato: pkg.FORMATO,
                dataConfezionamento: pkg.DATA,
                qtaUnita: pkg.QTA_UNITA,
                newDataScadenza: formattedScadenza,
            });
            setPackagingData(prev =>
                prev.map((item, i) => (i === idx ? { ...item, DATA_SCADENZA: formattedScadenza } : item))
            );
            setAllPackaging(prev =>
                prev.map(item => {
                    const matchById = Boolean(pkg.ID_OPERAZIONE && item.ID_OPERAZIONE === pkg.ID_OPERAZIONE);
                    const matchFallback =
                        !pkg.ID_OPERAZIONE &&
                        (item.LOTTO_PROD || '').trim().toUpperCase() === (pkg.LOTTO_PROD || header.LOTTO || '').trim().toUpperCase() &&
                        (item.FORMATO || '').trim().toUpperCase() === (pkg.FORMATO || '').trim().toUpperCase() &&
                        item.DATA === pkg.DATA &&
                        item.QTA_UNITA === pkg.QTA_UNITA;
                    return matchById || matchFallback ? { ...item, DATA_SCADENZA: formattedScadenza } : item;
                })
            );
            setEditingTmcRowKey(null);
            setEditingTmcIsoValue('');
            showToast(`TMC aggiornato al ${formattedScadenza} e sincronizzato con Magazzino Birra e avvisi scadenza.`, 'success');
        } catch (err) {
            console.error('Errore aggiornamento TMC:', err);
            showToast(err instanceof Error ? err.message : 'Errore durante la modifica del TMC.', 'error');
        }
    };

    const calculatedReadyForTransferDate = useMemo(() => {
        if (pkgInitialLocation !== 'CELLA_BIRRIFICIO' || !pkgInput.data) return '';
        const [y, m, d] = pkgInput.data.split('-').map(Number);
        if (isNaN(y) || isNaN(m) || isNaN(d)) return '';
        const dt = new Date(y, m - 1, d);
        const days = Math.max(0, parseInt(pkgRefermentationDays, 10) || 0);
        dt.setDate(dt.getDate() + days);
        return dt.toLocaleDateString('it-IT');
    }, [pkgInitialLocation, pkgInput.data, pkgRefermentationDays]);

    const isSelectedFormatSteelKeg = useMemo(() => Boolean(parseSteelKegFormat(pkgInput.formato)), [pkgInput.formato]);

    useEffect(() => {
        setPkgMaterialSelections({});
        setSelectedCapName('');
        setUseReturnableSteelKeg(Boolean(parseSteelKegFormat(pkgInput.formato)));
    }, [pkgInput.formato, useCartons]);

    const requiredPackagingMaterials = useMemo(() => {
        if (!pkgInput.formato) return [];
        const config = CONFIG_PACKAGING[pkgInput.formato];
        if (!config) return [];

        const materials = [];
        const skipContainerForReturnableFleet = Boolean(parseSteelKegFormat(pkgInput.formato)) && useReturnableSteelKeg;
        if (!skipContainerForReturnableFleet) {
            materials.push({ key: 'container', name: config.nomeInvCont, tipologia: config.nomeInvCont.includes('BOTTIGLIA') ? 'BOTTIGLIE' : 'FUSTI'});
        }

        if (config.nomeInvScatola && useCartons) {
            materials.push({ key: 'carton', name: config.nomeInvScatola, tipologia: 'CARTONI' });
        }

        if (pkgInput.formato.includes("BOTT")) {
            materials.push({ key: 'cap', name: '', tipologia: 'TAPPI' });
        }

        return materials;
    }, [pkgInput.formato, useCartons, useReturnableSteelKeg]);


    const totalLitriConfezionati = packagingData.reduce((sum, pkg) => sum + pkg.LITRI_TOT, 0);
    const litriIniziali = parseFloat(header.LITRI_FINALI?.replace(',', '.')) || 0;
    const perdita = litriIniziali - totalLitriConfezionati;

    const addPackagingItem = () => {
        const {formato, qta: qtaStr, dataScadenza} = pkgInput;
        if (!header.LOTTO || !formato || !qtaStr || !dataScadenza) {
            showToast("Tutti i campi di confezionamento sono obbligatori.", 'error'); return;
        }
        const qta = parseInt(qtaStr);
        if(isNaN(qta) || qta <= 0) { showToast("Quantità non valida.", 'error'); return; }

        const config = CONFIG_PACKAGING[formato];
        if(!config) { showToast("Formato non valido.", 'error'); return; }
        
        const fabbisogni: MaterialRequirement[] = [];

        // 1. Container (saltato se si utilizza il Parco Fusti Acciaio a Rendere riutilizzabili)
        const isReturnableSteel = Boolean(parseSteelKegFormat(formato)) && useReturnableSteelKeg;
        if (!isReturnableSteel) {
            const containerName = config.nomeInvCont;
            const containerSelection = pkgMaterialSelections[containerName];
            if (!containerSelection) { showToast(`Seleziona un lotto per ${containerName}`, 'error'); return; }
            const [containerLotto, containerMarca, containerFornitore] = containerSelection.split('|');
            const containerInfo = (ingredientLotsStock[containerName.toUpperCase()] || []).find(l => l.lotto === containerLotto && l.marca === containerMarca && l.fornitore === containerFornitore);
            if(!containerInfo) { showToast(`Info lotto non trovate per ${containerName}`, 'error'); return; }
            fabbisogni.push({ NOME: containerName, TIPOLOGIA: containerName.includes('BOTT') ? 'BOTTIGLIE' : 'FUSTI', QTA: qta, lotto: containerLotto, marca: containerInfo.marca, fornitore: containerInfo.fornitore });
        }

        // 2. Carton
        if (config.nomeInvScatola && useCartons) {
            const cartonName = config.nomeInvScatola;
            const cartonSelection = pkgMaterialSelections[cartonName];
            if (!cartonSelection) { showToast(`Seleziona un lotto per ${cartonName}`, 'error'); return; }
            const [cartonLotto, cartonMarca, cartonFornitore] = cartonSelection.split('|');
            const cartonQta = Math.ceil(qta / config.pezziPerCartone);
            const cartonInfo = (ingredientLotsStock[cartonName.toUpperCase()] || []).find(l => l.lotto === cartonLotto && l.marca === cartonMarca && l.fornitore === cartonFornitore);
            if(!cartonInfo) { showToast(`Info lotto non trovate per ${cartonName}`, 'error'); return; }
            fabbisogni.push({ NOME: cartonName, TIPOLOGIA: 'CARTONI', QTA: cartonQta, lotto: cartonLotto, marca: cartonInfo.marca, fornitore: cartonInfo.fornitore });
        }

        // 3. Cap
        if (formato.includes("BOTT")) {
            if (!selectedCapName) { showToast("Seleziona un tipo di tappo", 'error'); return; }
            const capSelection = pkgMaterialSelections[selectedCapName];
            if (!capSelection) { showToast(`Seleziona un lotto per ${selectedCapName}`, 'error'); return; }
            const [capLotto, capMarca, capFornitore] = capSelection.split('|');
            const capInfo = (ingredientLotsStock[selectedCapName.toUpperCase()] || []).find(l => l.lotto === capLotto && l.marca === capMarca && l.fornitore === capFornitore);
            if(!capInfo) { showToast(`Info lotto non trovate per ${selectedCapName}`, 'error'); return; }
            fabbisogni.push({ NOME: selectedCapName, TIPOLOGIA: 'TAPPI', QTA: qta, lotto: capLotto, marca: capInfo.marca, fornitore: capInfo.fornitore });
        }

        for (const item of fabbisogni) {
            const availableLots = ingredientLotsStock[item.NOME.toUpperCase()] || [];
            const selectedLotInfo = availableLots.find(l => l.lotto === item.lotto && l.marca === item.marca && l.fornitore === item.fornitore);
            const alreadyQueuedQty = packagingData
                .filter(p => p.isNew)
                .reduce((sum, p) => {
                    const matching = (p.materials || []).filter(
                        m => m.NOME.toUpperCase() === item.NOME.toUpperCase() && m.lotto === item.lotto && m.marca === item.marca && m.fornitore === item.fornitore
                    );
                    return sum + matching.reduce((s, m) => s + m.QTA, 0);
                }, 0);
            const remainingStock = (selectedLotInfo?.giacenza || 0) - alreadyQueuedQty;
            if (!selectedLotInfo || remainingStock < item.QTA) {
                const lotLabel = item.lotto === 'NESSUN_LOTTO' ? 'Senza Lotto' : item.lotto;
                showToast(`Materiale insufficiente: ${item.NOME} (Lotto: ${lotLabel}). Necessari: ${item.QTA}, Disponibili: ${Math.max(0, remainingStock)}`, 'error');
                return;
            }
        }

        const [year, month, day] = pkgInput.data.split('-');
        const formattedDate = `${day}/${month}/${year}`;
        
        const [s_year, s_month, s_day] = dataScadenza.split('-');
        const formattedScadenza = `${s_day}/${s_month}/${s_year}`;

        const id_op = `CONF_${Date.now()}`;
        const sostaGiorni = pkgInitialLocation === 'CELLA_BIRRIFICIO'
            ? Math.max(0, parseInt(pkgRefermentationDays, 10) || 0)
            : 0;
        const newPkg: LocalPackagingData = {
            DATA: formattedDate,
            LOTTO_PROD: header.LOTTO,
            FORMATO: formato,
            QTA_UNITA: qta,
            LITRI_TOT: qta * config.litriUnit,
            ID_OPERAZIONE: id_op,
            DATA_SCADENZA: formattedScadenza,
            isReturnableKeg: isReturnableSteel,
            usedCartons: formato.includes('BOTT') ? useCartons : undefined,
            capNameUsed: formato.includes('BOTT') ? selectedCapName : undefined,
            initialLocation: pkgInitialLocation,
            giorniRifermentazione: sostaGiorni,
            dataProntaTrasferimento: pkgInitialLocation === 'CELLA_BIRRIFICIO' ? calculatedReadyForTransferDate : undefined,
            isNew: true,
            materials: fabbisogni,
        };
        
        setPackagingData(prev => [...prev, newPkg]);
        showToast(
            pkgInitialLocation === 'CELLA_BIRRIFICIO'
                ? `Confezionamento aggiunto in Cella Birrificio (pronto per DDT dal ${calculatedReadyForTransferDate || formattedDate}).`
                : "Confezionamento aggiunto direttamente in Magazzino Centrale Vendita.",
            'info'
        );
        
        setPkgInput({data: new Date().toISOString().slice(0, 10), formato: '', qta: '', dataScadenza: ''});
        setPkgMaterialSelections({});
        setSelectedCapName('');
    };

    const handleUndoLastPackaging = async () => {
        if (packagingData.length === 0) return;
        const lastPkg = packagingData[packagingData.length - 1];

        if (lastPkg.isNew) {
            setPackagingData(prev => prev.slice(0, -1));
            showToast("Ultimo confezionamento non salvato rimosso.", 'info');
        } else {
            if (window.confirm(`Annullare l'ultimo confezionamento salvato (${lastPkg.FORMATO} x${lastPkg.QTA_UNITA})? L'operazione è irreversibile.`)) {
                await deleteMovementsByInvoiceAndSync(selectedYear, lastPkg.ID_OPERAZIONE);
                const allYearPkgs = await getSheetData(selectedYear, 'CONFEZIONAMENTO');
                let removed = false;
                const updatedYearPkgs = [...allYearPkgs]
                    .reverse()
                    .filter(p => {
                        if (!removed && p.LOTTO_PROD === lastPkg.LOTTO_PROD && p.ID_OPERAZIONE === lastPkg.ID_OPERAZIONE) {
                            removed = true;
                            return false;
                        }
                        return true;
                    })
                    .reverse();
                await saveDataToSheet(selectedYear, 'CONFEZIONAMENTO', updatedYearPkgs);
                showToast("Operazione salvata annullata.", 'success');
                await loadData();
            }
        }
    };

    const handleConfirmCloseLotto = async () => {
        if (!header.LOTTO || !header.FERMENTATORE) {
            showToast("Impossibile chiudere il lotto: nessun fermentatore assegnato.", 'error');
            return;
        }
        
        const data = await getBreweryData(selectedYear);
        if (!data) {
            showToast("Errore nel caricamento dei dati per l'analisi costi.", 'error');
            return;
        }

        const fermenterToFree = header.FERMENTATORE;
        const updatedHeader: BrewHeader = { 
            ...header, 
            // Mantieni FERMENTATORE valorizzato per lo storico tracciabilità del lotto e segna la cantina come chiusa
            FERMENTATORE: fermenterToFree,
            isCellarClosed: true,
            frozenPrices: data.PRICE_DATABASE || [],
            frozenCoeffs: data.COST_COEFFICIENTS || {}
        };
        await upsertItemInSheet(selectedYear, 'COTTE_HEAD', updatedHeader, 'LOTTO');
        setHeader(updatedHeader);
        showToast(`Lotto ${header.LOTTO} chiuso (storico ${fermenterToFree} conservato). Il fermentatore è ora libero.`, 'success');
        setIsCloseLottoModalOpen(false);
        await loadData();
    };

    const handleExport = () => {
        try {
            exportBrewSheetToExcel(header, ingredients, fermentationData, packagingData);
        } catch (error) {
            console.error('Export to Excel failed:', error);
            showToast('Esportazione Excel fallita. Controlla la console per i dettagli.', 'error');
        }
    };

    const parseCounter = (val: string | number | undefined) => {
        if (typeof val === 'number') return val;
        if (!val) return 0;
        return parseFloat(val.replace(',', '.')) || 0;
    };

    const gasCottaCalc = parseCounter(header.gasBrewCounterCurrent) - parseCounter(header.gasBrewCounterPrevious);
    const gasConfValue = parseCounter(header.gasPackagingCounterCurrent) - parseCounter(header.gasPackagingCounterPrevious);

    return (
        <div className="space-y-6 text-brew-light">
            <div className="flex justify-between items-center">
                <h1 className="text-3xl font-bold text-brew-accent">{lottoId ? `LOTTO: ${lottoId}` : 'NUOVO FOGLIO COTTA'}</h1>
                <button onClick={onExit} className="px-4 py-2 bg-brew-dark-secondary rounded-md text-sm font-semibold hover:bg-slate-600">Torna alla Home</button>
            </div>

            {initialPlannedBrew && !lottoId && (
                <div className="p-4 bg-orange-950/40 border border-orange-500/70 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-orange-200 shadow-lg">
                    <div className="flex items-center gap-3">
                        <span className="text-2xl">🔥</span>
                        <div>
                            <div className="font-extrabold text-white text-base">
                                Cotta avviata da Pianificazione Calendario: {initialPlannedBrew.birraNome} ({initialPlannedBrew.clienteNome})
                            </div>
                            <div className="text-xs text-orange-300/80 mt-0.5">
                                Fissata a calendario per il <strong className="text-white">{initialPlannedBrew.date}</strong> • Litri previsti: <strong className="text-white">{initialPlannedBrew.litriPrevisti} L</strong> {initialPlannedBrew.fermentatore ? `• Fermentatore: ${initialPlannedBrew.fermentatore}` : ''}.
                                Al salvataggio, il software contrassegnerà automaticamente questa cotta come <strong>Eseguita</strong> memorizzandola nello storico del calendario con il lotto assegnato.
                            </div>
                        </div>
                    </div>
                    {onClearPlannedBrew && (
                        <button 
                            type="button" 
                            onClick={onClearPlannedBrew}
                            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold rounded-lg border border-slate-600 self-start sm:self-auto transition-colors"
                            title="Scollega questa cotta dalla pianificazione calendario"
                        >
                            Scollega Pianificazione
                        </button>
                    )}
                </div>
            )}
            
            {isActuallyClosed && !isUnlockedForCorrection && (
                <div className="p-4 bg-yellow-500/15 border border-yellow-500/80 text-yellow-200 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                        <div className="font-bold text-yellow-300 text-base">Lotto Chiuso e Protetto da Modifiche Accidentali</div>
                        <div className="text-xs text-slate-300 mt-0.5">
                            Puoi correggere direttamente il <strong>TMC (scadenza)</strong> cliccando l&apos;icona matita nella tabella <em>Riepilogo Confezionato</em> in basso. Per rettificare invece materie prime, contatori gas o quantità usa <strong>Sblocca per Rettifica Controllata</strong>.
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={() => setIsUnlockedForCorrection(true)}
                        className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs rounded-md shadow whitespace-nowrap transition-colors"
                    >
                        Sblocca per Rettifica Controllata
                    </button>
                </div>
            )}

            {isActuallyClosed && isUnlockedForCorrection && (
                <div className="p-4 bg-emerald-950/50 border border-emerald-500/80 text-emerald-200 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                        <div className="font-bold text-emerald-300 text-base">Modalità Rettifica Controllata Lotto Chiuso Attiva</div>
                        <div className="text-xs text-slate-300 mt-0.5">
                            Il fermentatore <strong>{header.FERMENTATORE || 'storico'}</strong> resta libero in cantina. Modifica liberamente ingredienti, contatori o confezionamento e clicca <strong>Salva Rettifica e Riblocca Lotto</strong> in fondo alla pagina: gli scarichi materie prime verranno sostituiti senza duplicazioni e l&apos;analisi costi verrà riallineata.
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={() => {
                            setIsUnlockedForCorrection(false);
                            setEditingIngredientId(null);
                            loadData();
                        }}
                        className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 font-semibold text-xs rounded-md whitespace-nowrap transition-colors"
                    >
                        Annulla Rettifica
                    </button>
                </div>
            )}

            {header.isCarriedOver && (
                <div className="p-3.5 bg-amber-950/40 border border-amber-500/60 rounded-lg flex items-center gap-3 text-amber-200 text-sm shadow-md">
                    <span className="text-2xl">🔄</span>
                    <div>
                        <div className="font-bold text-amber-300">Cotta Riportata dall'Anno Precedente ({header.carriedOverFromYear})</div>
                        <div className="text-xs text-slate-300 mt-0.5">
                            Brassata in data <strong className="text-white">{header.DATA_PROD}</strong> nel fermentatore <strong className="text-amber-300">{header.FERMENTATORE}</strong>. Le materie prime sono già state scaricate nel bilancio dell'anno {header.carriedOverFromYear}. I confezionamenti effettuati a Gennaio caricheranno il prodotto finito nel magazzino dell'anno corrente.
                        </div>
                    </div>
                </div>
            )}
            
            <div className="bg-brew-dark-secondary p-4 rounded-lg shadow-lg">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                    <h2 className="text-xl font-bold">Testata</h2>
                    {header.CLIENTE && (
                        <span className={`px-2.5 py-1 rounded text-xs font-bold ${isInternalOwner(breweryDataSnapshot, header.CLIENTE) ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' : 'bg-sky-500/20 text-sky-300 border border-sky-500/40'}`}>
                            {isInternalOwner(breweryDataSnapshot, header.CLIENTE) ? '🏠 Birra Interna del Birrificio' : '🤝 Lavorazione Conto Terzi (BeerFirm)'}
                        </span>
                    )}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    <Input label="LOTTO" value={header.LOTTO} onChange={v => handleHeaderChange('LOTTO', v.target.value.toUpperCase())} required disabled={!!lottoId} />
                    <div>
                        <label className="block text-xs font-medium text-gray-400 mb-1">PROPRIETÀ / CLIENTE</label>
                        <select value={header.CLIENTE} onChange={e => handleClienteSelection(e.target.value)} className="w-full bg-brew-dark p-2 rounded-md border border-slate-600 focus:ring-brew-accent focus:border-brew-accent text-sm disabled:opacity-50" disabled={isLottoClosed}>
                            <option value="">Seleziona Proprietà / Cliente...</option>
                            {clienti.some(c => isInternalOwner(breweryDataSnapshot, c.nome)) && (
                                <optgroup label="🏠 Birrificio Centrale (Produzione Interna)">
                                    {clienti.filter(c => isInternalOwner(breweryDataSnapshot, c.nome)).map(c => (
                                        <option key={c.id} value={c.nome}>{c.nome} (Produzione Interna)</option>
                                    ))}
                                </optgroup>
                            )}
                            {clienti.some(c => !isInternalOwner(breweryDataSnapshot, c.nome)) && (
                                <optgroup label="🤝 Clienti BeerFirm (Conto Terzi)">
                                    {clienti.filter(c => !isInternalOwner(breweryDataSnapshot, c.nome)).map(c => (
                                        <option key={c.id} value={c.nome}>{c.nome}</option>
                                    ))}
                                </optgroup>
                            )}
                        </select>
                    </div>
                    <Input label="DATA PROD." type="date" value={dataProdValue} onChange={v => handleDataProdChange(v.target.value)} disabled={isLottoClosed} />
                    <div>
                        <label className="block text-xs font-medium text-gray-400 mb-1">NOME BIRRA</label>
                        <select value={header.NOME_BIRRA} onChange={e => handleBirraSelection(e.target.value)} className="w-full bg-brew-dark p-2 rounded-md border border-slate-600 focus:ring-brew-accent focus:border-brew-accent text-sm disabled:opacity-50" disabled={isLottoClosed || !header.CLIENTE}>
                            <option value="">Seleziona Birra...</option>
                            {birreClienteSelezionato.map(b => <option key={b.id} value={b.nomeBirra}>{b.nomeBirra}</option>)}
                        </select>
                    </div>
                    <Input label="TIPOLOGIA" value={header.TIPO_BIRRA} onChange={v => handleHeaderChange('TIPO_BIRRA', v.target.value)} disabled={isLottoClosed} />
                    <Input label="PLATO (°P)" value={header.PLATO_INIZIALE} onChange={v => handleHeaderChange('PLATO_INIZIALE', v.target.value)} disabled={isLottoClosed} />
                    <div className="md:col-span-2 flex items-end gap-2">
                        <div className="flex-1">
                            <Input label="LITRI FINALI" value={header.LITRI_FINALI} onChange={v => handleHeaderChange('LITRI_FINALI', v.target.value)} disabled={isLottoClosed} />
                        </div>
                        {!isLottoClosed && !header.isCarriedOver && selectedRecipeBeer?.ricetta && selectedRecipeBeer.ricetta.length > 0 && (
                            <button
                                type="button"
                                onClick={handleRescaleRecipeToLiters}
                                className="h-[42px] px-3 bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs rounded-md shadow transition-colors whitespace-nowrap"
                                title={`Riscala automaticamente le quantità degli ingredienti da ricetta (base ${selectedRecipeBeer.litriBatchBase || 1000} L) ai litri finali inseriti`}
                            >
                                ⚖️ Riscala Ricetta ({selectedRecipeBeer.litriBatchBase || 1000}L ➔ {header.LITRI_FINALI || '?'}L)
                            </button>
                        )}
                    </div>
                </div>
                <div className="col-span-1 md:col-span-2 lg:grid-cols-4 border-t border-slate-700 mt-4 pt-4">
                    <h3 className="text-lg font-semibold text-brew-accent mb-2">{t('brewPage.mustCounter')}</h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <Input label={t('brewPage.mustCounterPrevious')} value={header.mustCounterPrevious} onChange={e => handleHeaderChange('mustCounterPrevious', e.target.value)} disabled={isLottoClosed} />
                        <Input label={t('brewPage.mustCounterMeasured')} value={header.mustCounterMeasured} onChange={e => handleHeaderChange('mustCounterMeasured', e.target.value)} disabled={isLottoClosed} />
                        <div>
                            <label className="block text-xs font-medium text-gray-400 mb-1">{t('brewPage.mustCounterResult')}</label>
                            <div className="w-full bg-brew-dark p-2 rounded-md border border-slate-700 text-lg font-bold text-yellow-300 h-[42px] flex items-center">
                                {Math.round((parseCounter(header.mustCounterMeasured) - parseCounter(header.mustCounterPrevious)) * 100) / 100} L
                            </div>
                        </div>
                    </div>
                </div>
                <div className="col-span-1 md:col-span-2 lg:grid-cols-4 border-t border-slate-700 mt-4 pt-4">
                    <h3 className="text-lg font-semibold text-brew-accent mb-2">Valore Conta Mosto Lavaggi Controflusso</h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <Input label="Valore Precedente" value={header.washWaterCounterPrevious} onChange={e => handleHeaderChange('washWaterCounterPrevious', e.target.value)} disabled={isLottoClosed} />
                        <Input label="Valore Misurato" value={header.washWaterCounterMeasured} onChange={e => handleHeaderChange('washWaterCounterMeasured', e.target.value)} disabled={isLottoClosed} />
                        <div>
                            <label className="block text-xs font-medium text-gray-400 mb-1">Acqua totale di lavaggi</label>
                            <div className="w-full bg-brew-dark p-2 rounded-md border border-slate-700 text-lg font-bold text-cyan-300 h-[42px] flex items-center">
                                {Math.round((parseCounter(header.washWaterCounterMeasured) - parseCounter(header.washWaterCounterPrevious)) * 100) / 100} L
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div className="space-y-4">
                {ingredientCategories.map(cat => (
                    <div key={cat} className="bg-brew-dark-secondary p-4 rounded-lg shadow-lg">
                        <div className="flex justify-between items-center mb-2">
                            <h3 className="text-lg font-bold text-brew-accent">{cat}</h3>
                            <button onClick={() => addIngredientRow(cat)} className="flex items-center px-2 py-1 bg-brew-green rounded-md text-xs hover:bg-opacity-80 disabled:bg-slate-600" disabled={isLottoClosed}><PlusIcon className="w-4 h-4 mr-1"/>AGGIUNGI</button>
                        </div>
                        <div className="space-y-2">
                            {ingredients.filter(i => i.tipologia === cat).map(ing => {
                                const isEditing = editingIngredientId === ing.id;
                                const availableIngredients = warehouseStock.filter(s => s.TIPOLOGIA === cat);
                                // Ensure the current ingredient is in the list even if out of stock, to prevent "Seleziona..."
                                const currentIngredientInStock = availableIngredients.find(s => s.NOME === ing.nome);
                                const options = currentIngredientInStock 
                                    ? availableIngredients 
                                    : [...availableIngredients, { TIPOLOGIA: cat, NOME: ing.nome, GIACENZA: 0 } as WarehouseItem];

                                return (
                                <div key={ing.id} className="grid grid-cols-[1fr,1fr,auto,auto,auto,auto] gap-2 items-center">
                                    <select value={ing.nome} onChange={e => updateIngredientRow(ing.id, 'nome', e.target.value)} className="bg-brew-dark p-1.5 rounded-md text-sm w-full disabled:opacity-50" disabled={(ing.gia_scaricato && !isEditing) || isLottoClosed}>
                                        <option value="">Seleziona...</option>
                                        {options.map(s => <option key={s.NOME} value={String(s.NOME)}>{s.NOME}</option>)}
                                    </select>
                                    {ing.gia_scaricato && !isEditing ? (
                                        <input 
                                            type="text" 
                                            value={`${!ing.lotto_fornitore || ing.lotto_fornitore === 'NESSUN_LOTTO' ? 'SENZA LOTTO (RIPORTO)' : ing.lotto_fornitore} - ${ing.marca} - ${ing.fornitore}`} 
                                            className="bg-brew-dark p-1.5 rounded-md text-sm w-full disabled:opacity-70 border border-transparent" 
                                            disabled 
                                        />
                                    ) : (
                                        <select value={ing.lotto_fornitore ? `${ing.lotto_fornitore}|${ing.marca}|${ing.fornitore}` : ''} onChange={e => updateIngredientRow(ing.id, 'lotto_fornitore', e.target.value)} className="bg-brew-dark p-1.5 rounded-md text-sm w-full disabled:opacity-50" disabled={(isLottoClosed && !isEditing) || !ing.nome}>
                                            <option value="">Seleziona Lotto...</option>
                                            {(ingredientLotsStock[ing.nome.toUpperCase()] || []).map(l => <option key={`${l.lotto}|${l.marca}|${l.fornitore}`} value={`${l.lotto}|${l.marca}|${l.fornitore}`}>{`${l.lotto === 'NESSUN_LOTTO' ? 'SENZA LOTTO (RIPORTO)' : l.lotto} - ${l.marca} - ${l.fornitore} (Giac: ${l.giacenza.toFixed(2)})`}</option>)}
                                            {/* If editing and the current lot is not in stock (e.g. fully used), add it as an option */}
                                            {isEditing && ing.lotto_fornitore && !(ingredientLotsStock[ing.nome.toUpperCase()] || []).some(l => l.lotto === ing.lotto_fornitore && l.marca === ing.marca && l.fornitore === ing.fornitore) && (
                                                <option value={`${ing.lotto_fornitore}|${ing.marca}|${ing.fornitore}`}>{ing.lotto_fornitore === 'NESSUN_LOTTO' ? 'SENZA LOTTO (RIPORTO)' : ing.lotto_fornitore} - {ing.marca} - {ing.fornitore} (Esaurito)</option>
                                            )}
                                        </select>
                                    )}
                                    <div className="flex items-center gap-1.5">
                                        <input type="text" placeholder="Q.tà (kg)" value={ing.qta} onChange={e => updateIngredientRow(ing.id, 'qta', e.target.value)} className="bg-brew-dark p-1.5 rounded-md text-sm w-24 text-right disabled:opacity-50" disabled={(ing.gia_scaricato && !isEditing) || isLottoClosed} />
                                        <span className="text-[11px] text-slate-400 font-mono min-w-[34px]">{ing.unitHint || 'kg'}</span>
                                    </div>
                                    <span className={`text-xl ${ing.gia_scaricato ? 'text-gray-500' : 'text-green-400'}`}>{ing.gia_scaricato ? '✅' : '🆕'}</span>
                                    
                                    {ing.gia_scaricato && !isLottoClosed && (
                                        <button 
                                            onClick={() => toggleEditIngredient(ing.id)} 
                                            className={`p-1 hover:text-brew-accent ${isEditing ? 'text-brew-accent' : 'text-gray-400'}`}
                                            title="Modifica ingrediente scaricato"
                                        >
                                            <PencilIcon className="w-5 h-5"/>
                                        </button>
                                    )}
                                    {!ing.gia_scaricato && !isLottoClosed && <div className="w-7"></div>}

                                    <button onClick={() => removeIngredientRow(ing.id)} className="p-1 text-red-500 hover:text-red-400 disabled:text-gray-500 disabled:cursor-not-allowed" disabled={(ing.gia_scaricato && !isEditing) || isLottoClosed}><TrashIcon className="w-5 h-5"/></button>
                                </div>
                                );
                            })}
                        </div>
                    </div>
                ))}
            </div>

            <div className="bg-brew-dark-secondary p-4 rounded-lg shadow-lg">
                 <h2 className="text-xl font-bold mb-4 text-brew-accent">Gestione Cantina</h2>
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-4">
                        <div className="bg-brew-dark p-3 rounded-md grid grid-cols-2 gap-4">
                             <div className="col-span-2 sm:col-span-1">
                                <label className="block text-xs font-medium text-gray-400 mb-1">
                                    FERMENTATORE {header.isCellarClosed ? '(Storico Lotto Chiuso — Tank Libero)' : ''}
                                </label>
                                <select value={header.FERMENTATORE} onChange={e => handleHeaderChange('FERMENTATORE', e.target.value)} className="w-full bg-brew-dark-secondary p-2 rounded-md border border-slate-600 text-sm disabled:opacity-50" required disabled={isLottoClosed || Boolean(header.isCellarClosed)} >
                                    <option value="">Seleziona fermentatore...</option>
                                    {availableFermenters.map(f => {
                                        const otherLots = occupiedFermenterMap[f.nome];
                                        const label = otherLots && otherLots.length > 0
                                            ? `${f.nome} (${f.capacita}L — Occupato da ${otherLots.join(', ')})`
                                            : `${f.nome} (${f.capacita}L — Libero)`;
                                        return <option key={f.id} value={f.nome}>{label}</option>;
                                    })}
                                </select>
                             </div>
                             <div className="col-span-2 sm:col-span-1">
                                <label className="block text-xs font-medium text-gray-400 mb-1">TIPO FERMENTAZIONE</label>
                                <select value={header.TIPO_FERMENTAZIONE} onChange={e => handleHeaderChange('TIPO_FERMENTAZIONE', e.target.value)} className="w-full bg-brew-dark-secondary p-2 rounded-md border border-slate-600 text-sm disabled:opacity-50" disabled={isLottoClosed}>
                                    <option value="">Seleziona...</option>
                                    <option value="ALTA">Alta</option>
                                    <option value="BASSA">Bassa</option>
                                </select>
                             </div>
                             {!isLottoClosed && (
                                 <div className="col-span-2">
                                     <Checkbox
                                         label="⚡ Doppia Cotta / Accoda in fermentatore già occupato"
                                         checked={allowOccupiedFermenter}
                                         onChange={e => setAllowOccupiedFermenter(e.target.checked)}
                                         disabled={isLottoClosed}
                                     />
                                 </div>
                             )}
                              <Input label="GIORNI PREVISTI" type="number" value={header.GIORNI_FERMENTAZIONE_PREVISTI} onChange={v => handleHeaderChange('GIORNI_FERMENTAZIONE_PREVISTI', v.target.value)} disabled={isLottoClosed} />
                              <Input label="PLATO FINALE FG (°P)" placeholder={effectiveFinalPlato || 'Auto da curva'} value={header.PLATO_FINALE || ''} onChange={v => handleHeaderChange('PLATO_FINALE', v.target.value)} disabled={isLottoClosed} />
                              <Input label="PLATO FISCALE ADM (°P)" placeholder={header.PLATO_INIZIALE || 'Come OG'} value={header.PLATO_FISCALE || ''} onChange={v => handleHeaderChange('PLATO_FISCALE', v.target.value)} disabled={isLottoClosed} />
                              <div className="col-span-2">
                                <p className="text-sm">Data confezionamento prevista: <span className="font-bold text-brew-accent">{dataConfezionamentoPrevista}</span></p>
                              </div>
                              <div className="col-span-2 grid grid-cols-3 gap-2 pt-2 border-t border-slate-700/70">
                                  <Input label="Data Dry Hop" type="date" value={header.dryHopDate || ''} onChange={v => handleHeaderChange('dryHopDate', v.target.value)} disabled={isLottoClosed} />
                                  <Input label="Data Cold Crash" type="date" value={header.coldCrashDate || ''} onChange={v => handleHeaderChange('coldCrashDate', v.target.value)} disabled={isLottoClosed} />
                                  <Input label="Travaso BBT / Mat." type="date" value={header.bbtTransferDate || ''} onChange={v => handleHeaderChange('bbtTransferDate', v.target.value)} disabled={isLottoClosed} />
                              </div>
                        </div>

                        <div className="bg-brew-dark p-3 rounded-md space-y-3 border border-slate-700/70">
                            <div className="flex items-center justify-between">
                                <h4 className="font-semibold text-brew-accent text-sm">Genealogia Lievito & Repitching</h4>
                                <span className="text-xs text-slate-400 font-mono tabular-nums">
                                    Gen. {header.yeastGeneration ?? 0}
                                </span>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-medium text-gray-400 mb-1">Origine Inoculo</label>
                                    <select
                                        value={header.yeastPitchType || 'NUOVO_MAGAZZINO'}
                                        onChange={e => {
                                            const mode = e.target.value as 'NUOVO_MAGAZZINO' | 'REPITCHING';
                                            setHeader(prev => ({
                                                ...prev,
                                                yeastPitchType: mode,
                                                yeastGeneration: mode === 'NUOVO_MAGAZZINO' ? 0 : Math.max(1, prev.yeastGeneration || 1),
                                                yeastSourceLotto: mode === 'NUOVO_MAGAZZINO' ? '' : prev.yeastSourceLotto,
                                            }));
                                        }}
                                        className="w-full bg-brew-dark-secondary p-2 rounded-md border border-slate-600 text-sm h-[42px] disabled:opacity-50"
                                        disabled={isLottoClosed}
                                    >
                                        <option value="NUOVO_MAGAZZINO">Lievito Madre da Magazzino (Gen. 0)</option>
                                        <option value="REPITCHING">Raccolto / Repitching da Cotta Precedente</option>
                                    </select>
                                </div>
                                <Input
                                    label="Ceppo / Codice Lievito"
                                    placeholder="Es. US-05, W-34/70..."
                                    value={header.yeastStrain || ''}
                                    onChange={e => handleHeaderChange('yeastStrain', e.target.value)}
                                    disabled={isLottoClosed}
                                />
                                {header.yeastPitchType === 'REPITCHING' && (
                                    <>
                                        <div>
                                            <label className="block text-xs font-medium text-gray-400 mb-1">Lotto Madre Sorgente</label>
                                            <select
                                                value={header.yeastSourceLotto || ''}
                                                onChange={e => handleSelectYeastSourceLotto(e.target.value)}
                                                className="w-full bg-brew-dark-secondary p-2 rounded-md border border-slate-600 text-sm h-[42px] disabled:opacity-50"
                                                disabled={isLottoClosed}
                                            >
                                                <option value="">Seleziona lotto sorgente...</option>
                                                {cotte
                                                    .filter(c => c.LOTTO !== header.LOTTO)
                                                    .map(c => (
                                                        <option key={c.LOTTO} value={c.LOTTO}>
                                                            {c.LOTTO} — {c.NOME_BIRRA} ({c.FERMENTATORE || 'Tank'} · Gen.{c.yeastGeneration ?? 0})
                                                        </option>
                                                    ))}
                                            </select>
                                        </div>
                                        <Input
                                            label="Numero Generazione"
                                            type="number"
                                            value={String(header.yeastGeneration ?? 1)}
                                            onChange={e => handleHeaderChange('yeastGeneration', Math.max(1, parseInt(e.target.value, 10) || 1))}
                                            disabled={isLottoClosed}
                                        />
                                    </>
                                )}
                            </div>
                            {(yeastGenealogy.ancestors.length > 0 || yeastGenealogy.children.length > 0) && (
                                <div className="text-xs text-slate-300 bg-brew-dark-secondary/70 p-2 rounded border border-slate-700">
                                    <span className="text-slate-400">Catena genealogica: </span>
                                    {[
                                        ...yeastGenealogy.ancestors.map(a => `${a.lotto} (Gen.${a.generation})`),
                                        `${header.LOTTO || 'Cotta Attuale'} (Gen.${header.yeastGeneration ?? 0})`,
                                        ...yeastGenealogy.children.map(ch => `${ch.lotto} (Gen.${ch.generation})`),
                                    ].join(' → ')}
                                </div>
                            )}
                        </div>

                        <div className="bg-brew-dark p-3 rounded-md">
                             <h4 className="font-semibold mb-2">Parametri Gas e Aggiuntivi</h4>
                            <div className="space-y-4">
                                <div>
                                    <h5 className="text-sm font-semibold text-slate-300 mb-1">{t('brewPage.gasBrewCounters')}</h5>
                                    <div className="flex gap-2 items-end">
                                        <Input label={t('brewPage.counterPrevious')} value={header.gasBrewCounterPrevious} onChange={e => handleHeaderChange('gasBrewCounterPrevious', e.target.value)} disabled={isLottoClosed} />
                                        <Input label={t('brewPage.counterCurrent')} value={header.gasBrewCounterCurrent} onChange={e => handleHeaderChange('gasBrewCounterCurrent', e.target.value)} disabled={isLottoClosed} />
                                        <div className="pb-2 text-2xl font-bold">=</div>
                                        <div className="flex-1">
                                            <label className="block text-xs font-medium text-gray-400 mb-1">{t('brewPage.gasUsed')}</label>
                                            <div className="w-full bg-brew-dark p-2 rounded-md border border-slate-700 text-lg font-bold text-yellow-300 h-[42px] flex items-center justify-center tabular-nums">
                                                {gasCottaCalc.toFixed(2)}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <div>
                                    <h5 className="text-sm font-semibold text-slate-300 mb-1">{t('brewPage.gasPackagingCounters')}</h5>
                                    <div className="flex gap-2 items-end">
                                        <Input label={t('brewPage.counterPrevious')} value={header.gasPackagingCounterPrevious} onChange={e => handleHeaderChange('gasPackagingCounterPrevious', e.target.value)} disabled={isLottoClosed} />
                                        <Input label={t('brewPage.counterCurrent')} value={header.gasPackagingCounterCurrent} onChange={e => handleHeaderChange('gasPackagingCounterCurrent', e.target.value)} disabled={isLottoClosed} />
                                        <div className="pb-2 text-2xl font-bold">=</div>
                                        <div className="flex-1">
                                            <label className="block text-xs font-medium text-gray-400 mb-1">{t('brewPage.gasUsed')}</label>
                                            <div className="w-full bg-brew-dark p-2 rounded-md border border-slate-700 text-lg font-bold text-cyan-300 h-[42px] flex items-center justify-center tabular-nums">
                                                {gasConfValue.toFixed(2)}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                             </div>
                             <div className="mt-4 pt-4 border-t border-slate-700 flex justify-end items-center gap-4">
                                <span className="text-lg font-bold">{t('brewPage.totalGasUsed')}</span>
                                <span className="text-3xl font-extrabold text-brew-accent bg-brew-dark px-4 py-2 rounded-lg tabular-nums">
                                    {(gasCottaCalc + gasConfValue).toFixed(2)} m³
                                </span>
                            </div>
                             <div className="flex items-center space-x-4 pt-4">
                                <Checkbox label="CO2" checked={header.FLAG_CO2} onChange={v => handleHeaderChange('FLAG_CO2', v.target.checked)} disabled={isLottoClosed} />
                                <Checkbox label="AZOTO" checked={header.FLAG_AZOTO} onChange={v => handleHeaderChange('FLAG_AZOTO', v.target.checked)} disabled={isLottoClosed} />
                             </div>
                        </div>
                    </div>
                    <div className="flex flex-col gap-4">
                        <div className={`bg-brew-dark p-3 rounded-md border space-y-3 ${isAbvOutOfTolerance ? 'border-red-500 ring-2 ring-red-500/70' : 'border-slate-700/70'}`}>
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <h4 className="font-semibold text-brew-accent text-sm">
                                    Quadro Analitico Fermentazione &amp; Controllo ABV
                                </h4>
                                <div className="inline-flex rounded-md border border-slate-600 overflow-hidden text-xs font-bold">
                                    <button
                                        type="button"
                                        onClick={() => handleCarbonationModeChange('ISOBARICO')}
                                        disabled={isLottoClosed}
                                        className={`px-3 py-1.5 transition-colors disabled:opacity-50 ${
                                            carbonationMode === 'ISOBARICO'
                                                ? 'bg-sky-600 text-white'
                                                : 'bg-brew-dark-secondary text-slate-300 hover:bg-slate-700'
                                        }`}
                                    >
                                        🧊 Isobarico
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => handleCarbonationModeChange('RIFERMENTATO')}
                                        disabled={isLottoClosed}
                                        className={`px-3 py-1.5 transition-colors disabled:opacity-50 ${
                                            carbonationMode === 'RIFERMENTATO'
                                                ? 'bg-amber-600 text-white'
                                                : 'bg-brew-dark-secondary text-slate-300 hover:bg-slate-700'
                                        }`}
                                    >
                                        🍾 Rifermentato
                                    </button>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 items-end bg-brew-dark-secondary/60 p-2.5 rounded border border-slate-700/80">
                                <div>
                                    <label className="block text-[11px] font-medium text-gray-300 mb-1">
                                        Target ABV Etichetta (% vol)
                                    </label>
                                    <input
                                        type="text"
                                        value={header.targetAbv !== undefined ? header.targetAbv : effectiveTargetAbvStr}
                                        onChange={e => handleHeaderChange('targetAbv', e.target.value)}
                                        placeholder="Da ricetta DB"
                                        disabled={isLottoClosed}
                                        className="w-full bg-brew-dark p-1.5 rounded border border-slate-600 text-sm font-mono tabular-nums text-amber-300 disabled:opacity-50"
                                    />
                                </div>
                                {carbonationMode === 'RIFERMENTATO' ? (
                                    <>
                                        <div>
                                            <label className="block text-[11px] font-medium text-gray-300 mb-1">
                                                Zucchero Rifermentazione (g/L)
                                            </label>
                                            <input
                                                type="text"
                                                value={header.refermentationSugarGL !== undefined ? header.refermentationSugarGL : effectiveSugarGLStr}
                                                onChange={e => handleHeaderChange('refermentationSugarGL', e.target.value)}
                                                placeholder="Es. 6.0"
                                                disabled={isLottoClosed}
                                                className="w-full bg-brew-dark p-1.5 rounded border border-amber-500/60 text-sm font-mono tabular-nums text-emerald-300 disabled:opacity-50"
                                            />
                                        </div>
                                        <div className="text-[11px] text-slate-300 bg-brew-dark p-2 rounded border border-slate-700">
                                            <div>
                                                Apporto alcol rif.: <strong className="text-emerald-300 font-mono">+{refermentationAbvAdded.toFixed(2)}% vol</strong>
                                            </div>
                                            {effectiveTargetAbvNum !== null && (
                                                <div className="text-slate-400">
                                                    Target primario pre-rif.:{' '}
                                                    <strong className="text-sky-300 font-mono">
                                                        {Math.max(0, effectiveTargetAbvNum - refermentationAbvAdded).toFixed(2)}%
                                                    </strong>
                                                </div>
                                            )}
                                        </div>
                                    </>
                                ) : (
                                    <div className="sm:col-span-2 text-[11px] text-slate-400 p-1.5">
                                        Modalità <strong className="text-sky-300">Isobarico</strong> attiva: l&apos;eventuale zucchero di rifermentazione da ricetta non viene sommato all&apos;alcol né conteggiato negli ingredienti.
                                    </div>
                                )}
                            </div>

                            {isAbvOutOfTolerance && abvDeviation !== null && effectiveTargetAbvNum !== null && totalEstimatedAbv !== null && (
                                <div className="animate-pulse p-2.5 rounded-md bg-red-600/25 border-2 border-red-500 text-red-100 text-xs flex flex-wrap items-center justify-between gap-2 shadow-lg">
                                    <div className="font-extrabold flex items-center gap-1.5">
                                        <span>🚨 ALLARME GRADAZIONE ALCOLICA FUORI TARGET (±{ABV_TOLERANCE_PERCENT.toFixed(1)}% vol):</span>
                                    </div>
                                    <div className="font-mono tabular-nums font-bold">
                                        Previsto Etichetta {effectiveTargetAbvNum.toFixed(2)}% vs Reale {totalEstimatedAbv.toFixed(2)}% ({abvDeviation >= 0 ? `+${abvDeviation.toFixed(2)}` : abvDeviation.toFixed(2)}%)
                                    </div>
                                </div>
                            )}

                            {brewMetrics ? (
                                <div className={`grid gap-2 text-center font-mono tabular-nums ${carbonationMode === 'RIFERMENTATO' ? 'grid-cols-2 sm:grid-cols-5' : 'grid-cols-2 sm:grid-cols-4'}`}>
                                    <div className="bg-brew-dark-secondary p-2 rounded border border-slate-700">
                                        <div className="text-[10px] text-slate-400 font-sans">ABV Primario</div>
                                        <div className="text-lg font-bold text-brew-accent">{brewMetrics.abv.toFixed(2)}%</div>
                                    </div>
                                    {carbonationMode === 'RIFERMENTATO' && (
                                        <div className="bg-brew-dark-secondary p-2 rounded border border-amber-500/40">
                                            <div className="text-[10px] text-amber-300 font-sans">ABV Totale (Prim.+Rif.)</div>
                                            <div className={`text-lg font-bold ${isAbvOutOfTolerance ? 'text-red-400 animate-pulse' : 'text-emerald-300'}`}>
                                                {(totalEstimatedAbv ?? brewMetrics.abv).toFixed(2)}%
                                            </div>
                                        </div>
                                    )}
                                    <div className="bg-brew-dark-secondary p-2 rounded border border-slate-700">
                                        <div className="text-[10px] text-slate-400 font-sans">Atten. Apparente</div>
                                        <div className="text-lg font-bold text-emerald-400">{brewMetrics.apparentAttenuation.toFixed(1)}%</div>
                                    </div>
                                    <div className="bg-brew-dark-secondary p-2 rounded border border-slate-700">
                                        <div className="text-[10px] text-slate-400 font-sans">Atten. Reale</div>
                                        <div className="text-lg font-bold text-sky-400">{brewMetrics.realAttenuation.toFixed(1)}%</div>
                                    </div>
                                    <div className="bg-brew-dark-secondary p-2 rounded border border-slate-700">
                                        <div className="text-[10px] text-slate-400 font-sans">Densità OG → FG</div>
                                        <div className="text-sm font-bold text-slate-200 pt-1">{brewMetrics.ogSg.toFixed(3)} → {brewMetrics.fgSg.toFixed(3)}</div>
                                    </div>
                                </div>
                            ) : (
                                <p className="text-xs text-slate-400">
                                    Inserisci il Grado Plato Iniziale (OG) e almeno una lettura di fermentazione (o il Plato Finale FG) per calcolare automaticamente ABV% e Attenuazione%.
                                </p>
                            )}

                            {carbonationMode === 'RIFERMENTATO' && (parseNumericInput(effectiveSugarGLStr) || 0) > 0 && (
                                <div className="p-2.5 rounded-md bg-amber-950/35 border border-amber-500/60 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                                    <div>
                                        {packagedLitersTotal > 0 ? (
                                            <>
                                                <div className="font-bold text-amber-300">
                                                    🍬 Zucchero Totale Rifermentazione (su {packagedLitersTotal.toFixed(1)} L confezionati):{' '}
                                                    <span className="text-white text-sm font-mono">{primingSugarKgPackaged.toFixed(3)} kg</span>{' '}
                                                    <span className="text-slate-300 font-mono">({(primingSugarKgPackaged * 1000).toFixed(0)} g)</span>
                                                </div>
                                                <div className="text-[11px] text-slate-300">
                                                    Calcolato a {effectiveSugarGLStr} g/L. Premi il pulsante per portarlo nella sezione ADDITIVI e scaricarlo al salvataggio.
                                                </div>
                                            </>
                                        ) : (
                                            <>
                                                <div className="font-bold text-amber-200">
                                                    🍬 Stima Zucchero Rifermentazione (su {brewFinalLitersNum.toFixed(1)} L cotti):{' '}
                                                    <span className="text-white font-mono">{primingSugarKgPreviewBrew.toFixed(3)} kg</span>
                                                </div>
                                                <div className="text-[11px] text-slate-400">
                                                    Il peso esatto in kg verrà aggiornato automaticamente sui litri effettivamente confezionati a fine lavorazione.
                                                </div>
                                            </>
                                        )}
                                    </div>
                                    {!isLottoClosed && !header.isCarriedOver && (packagedLitersTotal > 0 ? primingSugarKgPackaged : primingSugarKgPreviewBrew) > 0 && (
                                        <button
                                            type="button"
                                            onClick={() =>
                                                handleApplyPrimingSugarToIngredients(
                                                    packagedLitersTotal > 0 ? primingSugarKgPackaged : primingSugarKgPreviewBrew
                                                )
                                            }
                                            className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white font-bold rounded text-xs shadow whitespace-nowrap transition-colors"
                                        >
                                            ➕ Carica {(packagedLitersTotal > 0 ? primingSugarKgPackaged : primingSugarKgPreviewBrew).toFixed(3)} kg in ADDITIVI
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>

                        <div className="bg-brew-dark p-3 rounded-md">
                            <h4 className="font-semibold mb-2">Nuova Misurazione Giornaliera</h4>
                            <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 items-end">
                                <div className="col-span-2 sm:col-span-2">
                                    <label className="block text-xs font-medium text-gray-400 mb-1">Data Misura</label>
                                    <input 
                                        type="date" 
                                        value={fermInput.data} 
                                        onChange={e => handleFermInputChange('data', e.target.value)} 
                                        className="w-full bg-brew-dark p-2 rounded-md border border-slate-600 h-[42px] text-sm disabled:opacity-50"
                                        disabled={isLottoClosed || !header.DATA_PROD}
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-gray-400 mb-1">Giorno</label>
                                    <div className="w-full bg-brew-dark p-2 rounded-md border border-slate-700 h-[42px] flex items-center justify-center font-bold tabular-nums">
                                        {calculatedFermentationDay !== null ? calculatedFermentationDay : 'N/A'}
                                    </div>
                                </div>
                                <div><Input label="Temp °C *" value={fermInput.temp} onChange={e => handleFermInputChange('temp', e.target.value)} disabled={isLottoClosed}/></div>
                                <div><Input label="Plato °P *" value={fermInput.plato} onChange={e => handleFermInputChange('plato', e.target.value)} disabled={isLottoClosed}/></div>
                                <div><Input label="pH" placeholder="4.4" value={fermInput.ph} onChange={e => handleFermInputChange('ph', e.target.value)} disabled={isLottoClosed}/></div>
                                <div><Input label="Bar" placeholder="1.2" value={fermInput.pressione} onChange={e => handleFermInputChange('pressione', e.target.value)} disabled={isLottoClosed}/></div>
                                <div className="col-span-2 sm:col-span-5 flex justify-end">
                                    <button onClick={addFermentationPoint} disabled={isLottoClosed} className="bg-brew-green text-white font-bold py-2 px-5 rounded-md hover:bg-opacity-80 disabled:bg-slate-600 h-[42px] whitespace-nowrap">
                                        Registra Misura
                                    </button>
                                </div>
                            </div>
                        </div>
                        <div className="bg-brew-dark p-3 rounded-md flex-grow">
                             <h4 className="font-semibold mb-2">Diario &amp; Curva Fermentazione</h4>
                             <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 min-h-[250px]">
                                <div className="lg:col-span-5 max-h-64 overflow-y-auto">
                                    <table className="w-full text-xs font-mono tabular-nums">
                                        <thead>
                                            <tr className="text-left text-slate-400 border-b border-slate-700">
                                                <th className="p-1">G</th>
                                                <th className="p-1 text-right">T°C</th>
                                                <th className="p-1 text-right">°P</th>
                                                <th className="p-1 text-right">pH</th>
                                                <th className="p-1 text-right">Bar</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {fermentationData.map(d => (
                                                <tr key={d.GIORNO} className="border-b border-slate-800">
                                                    <td className="p-1 font-bold">{d.GIORNO}</td>
                                                    <td className="p-1 text-right">{d.TEMPERATURA.toFixed(1)}</td>
                                                    <td className="p-1 text-right text-sky-300">{d.PLATO.toFixed(2)}</td>
                                                    <td className="p-1 text-right text-emerald-300">{d.PH !== undefined ? d.PH.toFixed(2) : '-'}</td>
                                                    <td className="p-1 text-right text-amber-300">{d.PRESSIONE !== undefined ? d.PRESSIONE.toFixed(2) : '-'}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                                <div className="lg:col-span-7 h-64 bg-slate-800 p-1 rounded-md">
                                   <FermentationChart
                                        data={fermentationData}
                                        ogPlato={header.PLATO_INIZIALE}
                                        targetAbv={effectiveTargetAbvNum}
                                        refermentationAbv={refermentationAbvAdded}
                                        carbonationMode={carbonationMode}
                                        effectiveTotalAbv={totalEstimatedAbv}
                                        isAbvOutOfTolerance={isAbvOutOfTolerance}
                                   />
                                </div>
                             </div>
                        </div>
                    </div>
                 </div>
            </div>

            <div className="bg-brew-dark-secondary p-4 rounded-lg shadow-lg">
                <h2 className="text-xl font-bold mb-4 text-brew-accent">Confezionamento</h2>
                <div className="grid grid-cols-1 md:grid-cols-[1fr,auto] gap-6">
                    <div>
                        <div className="bg-brew-dark p-3 rounded-md mb-4">
                            <div className="flex flex-wrap items-end gap-2">
                                <div className="flex-grow min-w-[120px]">
                                    <label className="text-xs font-medium text-gray-400 mb-1 block">Data</label>
                                    <input type="date" value={pkgInput.data} onChange={e=>setPkgInput(s=>({...s, data:e.target.value}))} className="bg-brew-dark-secondary p-2 rounded-md disabled:opacity-50 w-full" disabled={isLottoClosed}/>
                                </div>
                                <div className="flex-grow min-w-[150px]">
                                    <label className="text-xs font-medium text-gray-400 mb-1 block">Formato</label>
                                    <select value={pkgInput.formato} onChange={e=>{setPkgInput(s=>({...s, formato:e.target.value})); setUseCartons(true);}} className="bg-brew-dark-secondary p-2 rounded-md disabled:opacity-50 w-full" disabled={isLottoClosed}>
                                        <option value="">Seleziona...</option>
                                        {Object.keys(CONFIG_PACKAGING).map(f=><option key={f} value={f}>{f}</option>)}
                                    </select>
                                </div>
                                <div className="flex-grow min-w-[120px]">
                                    <label className="text-xs font-medium text-gray-400 mb-1 block">{t('brewPage.expirationDate')}</label>
                                    <input type="date" value={pkgInput.dataScadenza} onChange={e=>setPkgInput(s=>({...s, dataScadenza:e.target.value}))} className="bg-brew-dark-secondary p-2 rounded-md disabled:opacity-50 w-full" disabled={isLottoClosed} required/>
                                </div>
                                <div className="w-24">
                                    <label className="text-xs font-medium text-gray-400 mb-1 block">Q.tà Pezzi</label>
                                    <input type="number" placeholder="Q.tà" value={pkgInput.qta} onChange={e=>setPkgInput(s=>({...s, qta:e.target.value}))} className="bg-brew-dark-secondary p-2 rounded-md w-full disabled:opacity-50" disabled={isLottoClosed}/>
                                </div>
                            </div>

                            <div className="mt-3 p-3 bg-brew-dark-secondary/70 border border-slate-700 rounded-md grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                                <div className="sm:col-span-6">
                                    <label className="text-xs font-medium text-gray-300 mb-1 block">Magazzino Destinazione Post-Confezionamento</label>
                                    <select
                                        value={pkgInitialLocation}
                                        onChange={e => setPkgInitialLocation(e.target.value as BeerStorageLocation)}
                                        className="w-full bg-brew-dark p-2 rounded-md border border-slate-600 text-sm disabled:opacity-50"
                                        disabled={isLottoClosed}
                                    >
                                        <option value="CELLA_BIRRIFICIO">Cella Birrificio (Rifermentazione / Sosta Tecnica prima di DDT)</option>
                                        <option value="MAGAZZINO_CENTRALE">Magazzino Centrale Vendita (Carico diretto pronto vendita)</option>
                                    </select>
                                </div>
                                {pkgInitialLocation === 'CELLA_BIRRIFICIO' ? (
                                    <>
                                        <div className="sm:col-span-3">
                                            <label className="text-xs font-medium text-gray-300 mb-1 block">Giorni Riferment./Sosta</label>
                                            <div className="flex gap-1">
                                                <input
                                                    type="number"
                                                    min={0}
                                                    value={pkgRefermentationDays}
                                                    onChange={e => setPkgRefermentationDays(e.target.value)}
                                                    className="w-16 bg-brew-dark p-2 rounded-md border border-slate-600 text-sm text-center font-mono tabular-nums disabled:opacity-50"
                                                    disabled={isLottoClosed}
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() => setPkgRefermentationDays('14')}
                                                    disabled={isLottoClosed}
                                                    className="px-2 py-1 text-[11px] bg-slate-700 hover:bg-slate-600 rounded text-slate-200"
                                                    title="14 giorni per birra rifermentata"
                                                >
                                                    14g
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => setPkgRefermentationDays('4')}
                                                    disabled={isLottoClosed}
                                                    className="px-2 py-1 text-[11px] bg-slate-700 hover:bg-slate-600 rounded text-slate-200"
                                                    title="4 giorni sosta isobarico"
                                                >
                                                    4g
                                                </button>
                                            </div>
                                        </div>
                                        <div className="sm:col-span-3 text-xs text-slate-300 pb-1">
                                            Pronta per DDT camion dal:{' '}
                                            <strong className="text-amber-300 font-mono tabular-nums">{calculatedReadyForTransferDate || '-'}</strong>
                                        </div>
                                    </>
                                ) : (
                                    <div className="sm:col-span-6 text-xs text-emerald-300 pb-1">
                                        Il prodotto andrà subito in carico nel Magazzino Centrale pronto per ordini di vendita.
                                    </div>
                                )}
                            </div>
                            
                            <div className="mt-4 pt-4 border-t border-slate-700 space-y-4">
                                <h4 className="text-md font-semibold text-slate-300">Selezione Materiali di Confezionamento</h4>
                                {requiredPackagingMaterials.map(mat => {
                                    if (mat.tipologia === 'TAPPI') {
                                        const capTypes = Object.keys(ingredientLotsStock).filter(name => name.toUpperCase().startsWith('TAPPO')).sort();
                                        const availableCapLots = selectedCapName ? ingredientLotsStock[selectedCapName.toUpperCase()] || [] : [];
                                        return (
                                            <div key={mat.key} className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                                <Field label="Tipo Tappo">
                                                    <select value={selectedCapName} onChange={e => { setSelectedCapName(e.target.value); setPkgMaterialSelections(p => ({...p, [e.target.value]: ''}));}} className="w-full bg-brew-dark-secondary p-2 rounded-md border border-slate-600 text-sm" disabled={isLottoClosed}>
                                                        <option value="">Seleziona tipo...</option>
                                                        {capTypes.map(name => <option key={name} value={name}>{name}</option>)}
                                                    </select>
                                                </Field>
                                                <Field label="Lotto Tappo">
                                                    <select value={pkgMaterialSelections[selectedCapName] || ''} onChange={e => setPkgMaterialSelections(p => ({...p, [selectedCapName]: e.target.value}))} className="w-full bg-brew-dark-secondary p-2 rounded-md border border-slate-600 text-sm" disabled={isLottoClosed || !selectedCapName}>
                                                        <option value="">Seleziona lotto...</option>
                                                        {availableCapLots.map(l => <option key={`${l.lotto}|${l.marca}|${l.fornitore}`} value={`${l.lotto}|${l.marca}|${l.fornitore}`}>{`${l.lotto === 'NESSUN_LOTTO' ? 'SENZA LOTTO (RIPORTO)' : l.lotto} - ${l.marca} - ${l.fornitore} (Giac: ${l.giacenza.toFixed(2)})`}</option>)}
                                                    </select>
                                                </Field>
                                            </div>
                                        );
                                    } else { // Container or Carton
                                        const availableLots = ingredientLotsStock[mat.name.toUpperCase()] || [];
                                        return (
                                            <div key={mat.key} className="grid grid-cols-[1fr,2fr] gap-2 items-center">
                                                <label className="text-sm font-semibold">{mat.name}</label>
                                                <select value={pkgMaterialSelections[mat.name] || ''} onChange={e => setPkgMaterialSelections(p => ({...p, [mat.name]: e.target.value}))} className="w-full bg-brew-dark-secondary p-2 rounded-md border border-slate-600 text-sm" disabled={isLottoClosed}>
                                                    <option value="">Seleziona lotto...</option>
                                                    {availableLots.map(l => <option key={`${l.lotto}|${l.marca}|${l.fornitore}`} value={`${l.lotto}|${l.marca}|${l.fornitore}`}>{`${l.lotto === 'NESSUN_LOTTO' ? 'SENZA LOTTO (RIPORTO)' : l.lotto} - ${l.marca} - ${l.fornitore} (Giac: ${l.giacenza.toFixed(2)})`}</option>)}
                                                </select>
                                            </div>
                                        );
                                    }
                                })}
                                {pkgInput.formato.includes("BOTT") && <Checkbox label="Includi Scatole" checked={useCartons} onChange={v => setUseCartons(v.target.checked)} disabled={isLottoClosed} />}
                                {isSelectedFormatSteelKeg && (
                                    <div className="p-2.5 bg-brew-dark-secondary/80 border border-slate-600 rounded-md">
                                        <Checkbox
                                            label="Usa Parco Fusti Inox a Rendere (non scaricare dal magazzino imballi a perdere)"
                                            checked={useReturnableSteelKeg}
                                            onChange={v => setUseReturnableSteelKeg(v.target.checked)}
                                            disabled={isLottoClosed}
                                        />
                                    </div>
                                )}
                            </div>
                            
                            <div className="mt-4 pt-4 border-t border-slate-700 flex justify-between">
                                <button onClick={handleUndoLastPackaging} className="flex items-center bg-brew-red text-white text-xs font-bold py-2 px-3 rounded-md hover:bg-opacity-80 disabled:bg-slate-600 self-end" disabled={isLottoClosed || packagingData.length === 0}><ArrowUturnLeftIcon className="w-4 h-4 mr-1"/>ANNULLA ULTIMO</button>
                                <button onClick={addPackagingItem} className="bg-brew-green text-white font-bold py-2 px-4 rounded-md hover:bg-opacity-80 disabled:bg-slate-600 self-end" disabled={isLottoClosed}>OK</button>
                            </div>
                        </div>
                        
                        <div className="flex items-center justify-between mb-2">
                            <h4 className="font-semibold">Riepilogo Confezionato</h4>
                            <span className="text-[11px] text-slate-400">
                                Clicca la matita accanto al TMC per correggere la scadenza anche a lotto chiuso
                            </span>
                        </div>
                        <div className="max-h-60 overflow-y-auto">
                            <table className="w-full text-sm tabular-nums">
                                <thead className="bg-slate-700">
                                    <tr>
                                        <th className="p-2 text-left">DATA</th>
                                        <th className="p-2 text-left">FORMATO &amp; POLO</th>
                                        <th className="p-2 text-left">TMC (SCADENZA)</th>
                                        <th className="p-2 text-right">PEZZI</th>
                                        <th className="p-2 text-right">LITRI</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {packagingData.map((p, idx) => {
                                        const rowKey = `${p.ID_OPERAZIONE || 'ROW'}_${idx}`;
                                        const isEditingThisTmc = editingTmcRowKey === rowKey;
                                        return (
                                            <tr key={rowKey} className={`border-b border-slate-700 ${p.isNew ? 'bg-green-500/10' : ''}`}>
                                                <td className="p-2 whitespace-nowrap">{p.DATA}</td>
                                                <td className="p-2">
                                                    <div>{p.FORMATO} {p.isReturnableKeg ? <span className="text-xs text-sky-400">· A rendere</span> : ''}</div>
                                                    <div className="text-[11px] text-slate-400">
                                                        {p.initialLocation === 'CELLA_BIRRIFICIO'
                                                            ? `Cella Birrificio${p.dataProntaTrasferimento ? ` · Pronta ${p.dataProntaTrasferimento}` : ''}`
                                                            : 'Magazzino Centrale'}
                                                    </div>
                                                </td>
                                                <td className="p-2">
                                                    {isEditingThisTmc ? (
                                                        <div className="flex items-center gap-1.5">
                                                            <input
                                                                type="date"
                                                                value={editingTmcIsoValue}
                                                                onChange={e => setEditingTmcIsoValue(e.target.value)}
                                                                className="bg-brew-dark border border-amber-400 rounded px-2 py-1 text-xs text-white focus:outline-none"
                                                            />
                                                            <button
                                                                type="button"
                                                                onClick={() => handleSaveEditedTmc(p, idx)}
                                                                className="p-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white transition-colors"
                                                                title="Salva nuovo TMC"
                                                            >
                                                                <CheckIcon className="w-3.5 h-3.5" />
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    setEditingTmcRowKey(null);
                                                                    setEditingTmcIsoValue('');
                                                                }}
                                                                className="p-1.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 transition-colors"
                                                                title="Annulla modifica TMC"
                                                            >
                                                                <XMarkIcon className="w-3.5 h-3.5" />
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <div className="flex items-center gap-2">
                                                            <span className="font-mono text-amber-200 whitespace-nowrap">
                                                                {p.DATA_SCADENZA || 'N/D'}
                                                            </span>
                                                            <button
                                                                type="button"
                                                                onClick={() => startEditingTmc(p, rowKey)}
                                                                className="p-1 rounded bg-slate-800 hover:bg-amber-600 text-amber-300 hover:text-white border border-slate-600 transition-colors"
                                                                title="Modifica data TMC (scadenza) anche a lotto chiuso"
                                                            >
                                                                <PencilIcon className="w-3.5 h-3.5" />
                                                            </button>
                                                        </div>
                                                    )}
                                                </td>
                                                <td className="p-2 text-right">{p.QTA_UNITA}</td>
                                                <td className="p-2 text-right">{p.LITRI_TOT.toFixed(1)}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                    <div className="bg-brew-dark p-4 rounded-md text-center flex flex-col justify-center space-y-3">
                        <div>
                            <p className="text-sm text-slate-400">TOTALE CONFEZIONATO</p>
                            <p className="text-2xl font-bold text-brew-accent">{totalLitriConfezionati.toFixed(1)} L</p>
                        </div>
                        <div>
                            <p className="text-sm text-slate-400">PERDITA / RIMANENZA</p>
                            <p className="text-2xl font-bold">{perdita.toFixed(1)} L</p>
                        </div>
                        {carbonationMode === 'RIFERMENTATO' && primingSugarKgPackaged > 0 && (
                            <div className="pt-3 border-t border-slate-700 space-y-1.5">
                                <p className="text-xs text-amber-300 font-semibold uppercase">
                                    Zucchero Rifermentazione ({effectiveSugarGLStr} g/L)
                                </p>
                                <p className="text-xl font-extrabold text-emerald-300 font-mono">
                                    {primingSugarKgPackaged.toFixed(3)} kg
                                </p>
                                {!isLottoClosed && !header.isCarriedOver && (
                                    <button
                                        type="button"
                                        onClick={() => handleApplyPrimingSugarToIngredients(primingSugarKgPackaged)}
                                        className="w-full px-2.5 py-1.5 bg-amber-600 hover:bg-amber-500 text-white font-bold rounded text-xs transition-colors"
                                    >
                                        ➕ Scarica in ADDITIVI
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <div className="bg-brew-dark-secondary p-4 rounded-lg shadow-lg">
                <h2 className="text-xl font-bold mb-4">Note</h2>
                <textarea
                    value={header.NOTE || ''}
                    onChange={e => handleHeaderChange('NOTE', e.target.value)}
                    rows={4}
                    className="w-full bg-brew-dark p-2 rounded-md border border-slate-600 focus:ring-brew-accent focus:border-brew-accent text-sm disabled:opacity-50"
                    placeholder="Aggiungi appunti o informazioni importanti su questa cotta..."
                    disabled={isLottoClosed}
                />
            </div>

             <div className="text-center pt-4 flex flex-wrap justify-center items-center gap-4">
                {!isLottoClosed ? (
                    <>
                        <button onClick={handleSaveCotta} className="bg-brew-blue text-white font-bold py-3 px-8 rounded-lg text-lg hover:bg-opacity-90 transition-all shadow-lg">
                            {isUnlockedForCorrection ? 'SALVA RETTIFICA E RIBLOCCA LOTTO' : 'SALVA COTTA E SCARICA INGREDIENTI'}
                        </button>
                        {!isActuallyClosed && (
                            <button 
                                onClick={() => setIsCloseLottoModalOpen(true)}
                                className="bg-brew-red text-white font-bold py-3 px-8 rounded-lg text-lg hover:bg-opacity-90 transition-all shadow-lg disabled:bg-slate-600 disabled:cursor-not-allowed"
                                disabled={!header.LOTTO || !header.FERMENTATORE}
                                title={!header.FERMENTATORE ? 'Assegna un fermentatore per poter chiudere il lotto' : 'Chiudi lotto e libera il fermentatore'}
                            >
                                CHIUDI LOTTO
                            </button>
                        )}
                    </>
                ) : (
                     <button onClick={handleExport} className="bg-brew-green text-white font-bold py-3 px-8 rounded-lg text-lg hover:bg-opacity-90 transition-all shadow-lg">{t('brewPage.exportButton')}</button>
                )}
            </div>

            {isCloseLottoModalOpen && (
                <Modal
                    title="Conferma Chiusura Lotto"
                    isOpen={isCloseLottoModalOpen}
                    onClose={() => setIsCloseLottoModalOpen(false)}
                    size="sm"
                >
                    <div className="space-y-4">
                        <p className="text-sm text-gray-300">
                            Sei sicuro di voler chiudere definitivamente il lotto <strong>{header.LOTTO}</strong>?
                            <br /><br />
                            Tutte le lavorazioni verranno considerate concluse, il fermentatore verrà liberato e il lotto verrà bloccato da modifiche accidentali (potrai comunque correggere in ogni momento la <strong>data TMC</strong> dalla tabella confezionamento o usare la <em>Rettifica Controllata</em>).
                        </p>
                        <div className="flex justify-end gap-4 pt-4">
                            <button
                                onClick={() => setIsCloseLottoModalOpen(false)}
                                className="px-4 py-2 rounded-md bg-slate-600 text-white font-semibold hover:bg-slate-500"
                            >
                                Annulla
                            </button>
                            <button
                                onClick={handleConfirmCloseLotto}
                                className="px-4 py-2 rounded-md bg-brew-red text-white font-bold hover:bg-opacity-80"
                            >
                                Sì, Chiudi Lotto
                            </button>
                        </div>
                    </div>
                </Modal>
            )}
        </div>
    );
};

const Input: React.FC<{ label: string } & React.InputHTMLAttributes<HTMLInputElement>> = ({ label, ...props }) => (
    <div>
        <label className="block text-xs font-medium text-gray-400 mb-1">{label}</label>
        <input {...props} className="w-full bg-brew-dark p-2 rounded-md border border-slate-600 focus:ring-brew-accent focus:border-brew-accent text-sm disabled:opacity-50 h-[42px]" />
    </div>
);

const Field: React.FC<{label: string, children: React.ReactNode}> = ({ label, children }) => (
    <div>
        <label className="block text-xs font-medium text-gray-400 mb-1">{label}</label>
        {children}
    </div>
);

const Checkbox: React.FC<{ label: string } & React.InputHTMLAttributes<HTMLInputElement>> = ({ label, ...props }) => (
    <label className="flex items-center space-x-2 cursor-pointer text-sm">
        <input type="checkbox" {...props} className="h-4 w-4 rounded bg-brew-dark border-slate-600 text-brew-blue focus:ring-brew-accent disabled:opacity-50"/>
        <span>{label}</span>
    </label>
);

export default BrewPage;