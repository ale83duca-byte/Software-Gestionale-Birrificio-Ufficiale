import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
    getSheetData,
    saveDataToSheet,
    getBreweryData,
    saveBreweryData,
    getEffectiveBreweryProfile,
    isInternalOwner,
    updateClientWithCascade,
    upsertBeerWithCascade,
    DEFAULT_BREWERY_PROFILE,
} from '../services/dataService';
import { resolveIngredientUnit } from '../services/calendarService';
import type { Cliente, Birra, DatabaseItem, RecipeIngredient, IngredientUnit, BreweryProfile, ExciseBracket, BreweryData } from '../types';
import { EXCISE_BRACKET_OPTIONS } from '../utils/brewingCalculations';
import { PlusIcon, TrashIcon, PencilIcon } from './icons';
import { Modal } from './Modal';
import { useToast } from '../hooks/useToast';

interface DatabaseViewProps {
    selectedYear: string;
}

const ingredientCategories = ["MALTI", "LUPPOLI", "LIEVITI", "ADDITIVI", "SANIFICANTI"];

const BeerRecipeModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    selectedYear: string;
    clienteId: string;
    beerToEdit: Birra | null;
    warehouseDb: DatabaseItem[];
}> = ({ isOpen, onClose, selectedYear, clienteId, beerToEdit, warehouseDb }) => {
    const { showToast } = useToast();
    const [beerDetails, setBeerDetails] = useState({
        nomeBirra: '',
        tipologia: '',
        platoIniziale: '',
        litriBatchBase: '1000',
        gradoAlcolicoPrevisto: '',
        zuccheroRifermentazioneGL: '',
    });
    const [ricetta, setRicetta] = useState<(Omit<RecipeIngredient, 'qta'> & { qta: string | number; unita: IngredientUnit; uiId: number })[]>([]);

    useEffect(() => {
        if (beerToEdit) {
            setBeerDetails({
                nomeBirra: beerToEdit.nomeBirra,
                tipologia: beerToEdit.tipologia,
                platoIniziale: beerToEdit.platoIniziale,
                litriBatchBase: String(beerToEdit.litriBatchBase || 1000),
                gradoAlcolicoPrevisto: beerToEdit.gradoAlcolicoPrevisto !== undefined && beerToEdit.gradoAlcolicoPrevisto > 0
                    ? String(beerToEdit.gradoAlcolicoPrevisto)
                    : '',
                zuccheroRifermentazioneGL: beerToEdit.zuccheroRifermentazioneGL !== undefined && beerToEdit.zuccheroRifermentazioneGL > 0
                    ? String(beerToEdit.zuccheroRifermentazioneGL)
                    : '',
            });
            setRicetta((beerToEdit.ricetta || []).map(r => ({
                ...r,
                qta: r.qta,
                unita: resolveIngredientUnit(r),
                uiId: Date.now() + Math.random(),
            })));
        } else {
            setBeerDetails({
                nomeBirra: '',
                tipologia: '',
                platoIniziale: '',
                litriBatchBase: '1000',
                gradoAlcolicoPrevisto: '',
                zuccheroRifermentazioneGL: '',
            });
            setRicetta([]);
        }
    }, [beerToEdit]);

    const handleDetailChange = (field: keyof typeof beerDetails, value: string) => {
        const numericFields: Array<keyof typeof beerDetails> = [
            'litriBatchBase',
            'gradoAlcolicoPrevisto',
            'zuccheroRifermentazioneGL',
        ];
        if (numericFields.includes(field) && value !== '' && !/^[0-9]*[.,]?[0-9]*$/.test(value)) return;
        setBeerDetails(prev => ({ ...prev, [field]: value }));
    };

    const addRicettaIngredient = (tipologia: string) => {
        const defaultUnit: IngredientUnit = tipologia === 'LUPPOLI' ? 'g' : 'kg';
        setRicetta(prev => [...prev, { uiId: Date.now() + Math.random(), tipologia, nome: '', qta: '', unita: defaultUnit }]);
    };
    
    const updateRicettaIngredient = (uiId: number, field: 'nome' | 'qta' | 'unita', value: string) => {
        if (field === 'qta' && !/^[0-9]*[.,]?[0-9]*$/.test(value)) return;
        setRicetta(prev => prev.map(r => r.uiId === uiId ? { ...r, [field]: value } : r));
    };
    
    const removeRicettaIngredient = (uiId: number) => {
        setRicetta(prev => prev.filter(r => r.uiId !== uiId));
    };

    const handleSave = async () => {
        if (!beerDetails.nomeBirra.trim() || !beerDetails.tipologia.trim() || !beerDetails.platoIniziale.trim()) {
            showToast("Nome, tipologia e grado Plato della birra sono obbligatori.", 'error');
            return;
        }

        const expectedAbv = parseFloat(beerDetails.gradoAlcolicoPrevisto.replace(',', '.'));
        if (isNaN(expectedAbv) || expectedAbv <= 0 || expectedAbv > 30) {
            showToast("Inserisci il grado alcolico previsto da ricetta e riportato in etichetta (% ABV).", 'error');
            return;
        }

        const sugarGLRaw = beerDetails.zuccheroRifermentazioneGL.trim();
        const sugarGL = sugarGLRaw !== '' ? parseFloat(sugarGLRaw.replace(',', '.')) : undefined;
        if (sugarGL !== undefined && (isNaN(sugarGL) || sugarGL < 0)) {
            showToast("I g/L di zucchero per rifermentazione devono essere un numero valido (>= 0).", 'error');
            return;
        }

        const baseLiters = parseFloat(beerDetails.litriBatchBase.replace(',', '.')) || 1000;
        if (baseLiters <= 0) {
            showToast("I litri base della ricetta devono essere maggiori di zero.", 'error');
            return;
        }

        const ricettaToSave: RecipeIngredient[] = ricetta
            .map(({ uiId: _uiId, ...rest }) => ({
                tipologia: rest.tipologia,
                nome: rest.nome,
                qta: parseFloat(String(rest.qta).replace(',', '.')) || 0,
                unita: rest.unita || 'kg',
            }))
            .filter(r => r.nome && r.qta > 0);

        const birraToSave: Birra = {
            id: beerToEdit?.id || `birra_${Date.now()}`,
            clienteId,
            nomeBirra: beerDetails.nomeBirra.trim(),
            tipologia: beerDetails.tipologia.trim(),
            platoIniziale: beerDetails.platoIniziale.trim(),
            litriBatchBase: baseLiters,
            gradoAlcolicoPrevisto: Math.round(expectedAbv * 100) / 100,
            zuccheroRifermentazioneGL: sugarGL !== undefined && sugarGL > 0 ? Math.round(sugarGL * 100) / 100 : undefined,
            ricetta: ricettaToSave,
        };
        
        await upsertBeerWithCascade(selectedYear, birraToSave);
        showToast(`Birra "${birraToSave.nomeBirra}" salvata con successo!`, 'success');
        onClose();
    };

    const availableIngredients = useMemo(() => {
        const grouped: Record<string, string[]> = {};
        ingredientCategories.forEach(cat => {
            // FIX: Explicitly type `item` to resolve type inference issue.
            grouped[cat] = [...new Set(warehouseDb.filter((item: DatabaseItem) => item.TIPOLOGIA === cat).map(item => item.NOME))].sort();
        });
        return grouped;
    }, [warehouseDb]);

    return (
        <Modal title={beerToEdit ? `Modifica Ricetta: ${beerToEdit.nomeBirra}` : "Aggiungi Nuova Birra"} isOpen={isOpen} onClose={onClose} size="3xl">
            <div className="space-y-6">
                <div className="bg-brew-dark p-4 rounded-lg grid grid-cols-1 md:grid-cols-3 gap-4">
                    <Field label="Nome Birra *"><Input value={beerDetails.nomeBirra} onChange={e => handleDetailChange('nomeBirra', e.target.value)} required/></Field>
                    <Field label="Tipologia *"><Input value={beerDetails.tipologia} onChange={e => handleDetailChange('tipologia', e.target.value)} required/></Field>
                    <Field label="Grado Plato OG (°P) *"><Input value={beerDetails.platoIniziale} onChange={e => handleDetailChange('platoIniziale', e.target.value)} required/></Field>
                    <Field label="Litri Base Ricetta (L) *"><Input value={beerDetails.litriBatchBase} onChange={e => handleDetailChange('litriBatchBase', e.target.value)} placeholder="1000" required/></Field>
                    <Field label="Grado Alcolico Etichetta (% ABV) *">
                        <Input
                            value={beerDetails.gradoAlcolicoPrevisto}
                            onChange={e => handleDetailChange('gradoAlcolicoPrevisto', e.target.value)}
                            placeholder="Es. 5.2"
                            required
                        />
                    </Field>
                    <Field label="Zucchero Rifermentazione (g/L)">
                        <Input
                            value={beerDetails.zuccheroRifermentazioneGL}
                            onChange={e => handleDetailChange('zuccheroRifermentazioneGL', e.target.value)}
                            placeholder="Es. 6.0 (opzionale)"
                        />
                        <p className="text-[11px] text-slate-400 mt-1">
                            Attivo solo in lavorazione Rifermentata; ignorato se Isobarico.
                            {(() => {
                                const g = parseFloat(beerDetails.zuccheroRifermentazioneGL.replace(',', '.'));
                                return !isNaN(g) && g > 0 ? (
                                    <span className="text-amber-300 font-semibold"> (+{(g / 16).toFixed(2)}% vol stimati)</span>
                                ) : null;
                            })()}
                        </p>
                    </Field>
                </div>
                
                <div className="space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                        <h3 className="text-xl font-bold text-brew-accent">Ricetta (per {beerDetails.litriBatchBase || '1000'} L)</h3>
                        <span className="text-xs text-slate-400">Le dosi in grammi (g) vengono convertite automaticamente in kg sul foglio cotta e nel controllo giacenze.</span>
                    </div>
                    {ingredientCategories.map(cat => (
                        <div key={cat} className="bg-brew-dark p-3 rounded-lg">
                            <div className="flex justify-between items-center mb-2">
                                <h4 className="font-semibold">{cat}</h4>
                                <button onClick={() => addRicettaIngredient(cat)} className="flex items-center text-xs px-2 py-1 bg-brew-blue rounded-md hover:bg-opacity-80"><PlusIcon className="w-4 h-4 mr-1"/>Aggiungi</button>
                            </div>
                            <div className="space-y-2">
                                {ricetta.filter(r => r.tipologia === cat).map(ing => (
                                    <div key={ing.uiId} className="grid grid-cols-[1fr,auto,auto,auto] gap-2 items-center">
                                        <select value={ing.nome} onChange={e => updateRicettaIngredient(ing.uiId, 'nome', e.target.value)} className="w-full bg-brew-dark-secondary p-1.5 rounded-md text-sm">
                                            <option value="">Seleziona ingrediente...</option>
                                            {(availableIngredients[cat] || []).map(name => <option key={name} value={name}>{name}</option>)}
                                        </select>
                                        <input type="text" placeholder="Q.tà" value={ing.qta} onChange={e => updateRicettaIngredient(ing.uiId, 'qta', e.target.value)} className="w-24 bg-brew-dark-secondary p-1.5 rounded-md text-sm text-right"/>
                                        <select value={ing.unita} onChange={e => updateRicettaIngredient(ing.uiId, 'unita', e.target.value)} className="w-20 bg-brew-dark-secondary p-1.5 rounded-md text-sm font-semibold text-brew-accent">
                                            <option value="kg">kg</option>
                                            <option value="g">g</option>
                                            <option value="L">L</option>
                                            <option value="pz">pz</option>
                                        </select>
                                        <button onClick={() => removeRicettaIngredient(ing.uiId)} className="p-1 text-red-500 hover:text-red-400"><TrashIcon className="w-5 h-5"/></button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>

                <div className="pt-5 flex justify-end">
                    <button onClick={handleSave} className="bg-brew-green text-white font-bold py-2 px-6 rounded-md hover:bg-opacity-80">Salva Birra e Ricetta</button>
                </div>
            </div>
        </Modal>
    );
};


const EditClientModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    clientToEdit: Cliente | null;
    onSave: (client: Cliente) => Promise<void>;
}> = ({ isOpen, onClose, clientToEdit, onSave }) => {
    const [formData, setFormData] = useState<Cliente | null>(null);

    useEffect(() => {
        setFormData(clientToEdit);
    }, [clientToEdit]);

    const handleChange = (field: keyof Cliente, value: string) => {
        if (formData) {
            setFormData({ ...formData, [field]: value });
        }
    };

    const handleSave = () => {
        if (formData) {
            onSave(formData);
        }
    };

    if (!formData) return null;

    return (
        <Modal title="Modifica Cliente" isOpen={isOpen} onClose={onClose}>
            <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Field label="Nome Cliente"><Input value={formData.nome} onChange={e => handleChange('nome', e.target.value)} /></Field>
                    <Field label="Ragione Sociale"><Input value={formData.ragioneSociale || ''} onChange={e => handleChange('ragioneSociale', e.target.value)} /></Field>
                    <Field label="Partita IVA"><Input value={formData.partitaIva || ''} onChange={e => handleChange('partitaIva', e.target.value)} /></Field>
                    <Field label="Codice Fiscale"><Input value={formData.codiceFiscale || ''} onChange={e => handleChange('codiceFiscale', e.target.value)} /></Field>
                    <Field label="Codice Destinatario SDI (7 car.)"><Input maxLength={7} placeholder="0000000" value={formData.codiceUnivocoSdi || ''} onChange={e => handleChange('codiceUnivocoSdi', e.target.value.toUpperCase())} /></Field>
                    <Field label="PEC Fatturazione"><Input value={formData.pec || ''} onChange={e => handleChange('pec', e.target.value)} /></Field>
                    <div className="sm:col-span-2">
                        <Field label="Sede Sociale (Via, CAP Città Prov.)"><Input value={formData.sedeSociale || ''} onChange={e => handleChange('sedeSociale', e.target.value)} /></Field>
                    </div>
                    <Field label="Numero di Telefono"><Input value={formData.numeroTelefono || ''} onChange={e => handleChange('numeroTelefono', e.target.value)} /></Field>
                </div>
                <div className="flex justify-end pt-4">
                    <button onClick={handleSave} className="bg-brew-green text-white font-bold py-2 px-4 rounded-md hover:bg-opacity-80">Salva Modifiche</button>
                </div>
            </div>
        </Modal>
    );
};

export const DatabaseView: React.FC<DatabaseViewProps> = ({ selectedYear }) => {
    const [clienti, setClienti] = useState<Cliente[]>([]);
    const [birre, setBirre] = useState<Birra[]>([]);
    const [warehouseDb, setWarehouseDb] = useState<DatabaseItem[]>([]);
    const [breweryProfile, setBreweryProfile] = useState<BreweryProfile>({ ...DEFAULT_BREWERY_PROFILE });
    const [fullDataSnapshot, setFullDataSnapshot] = useState<BreweryData | null>(null);
    const [isProfileOpen, setIsProfileOpen] = useState(true);
    const [newCliente, setNewCliente] = useState<Partial<Cliente>>({ nome: '', partitaIva: '', sedeSociale: '', numeroTelefono: '', ragioneSociale: '' });
    const [confirmState, setConfirmState] = useState<{ isOpen: boolean; type: 'cliente' | 'birra' | null; id: string | null; }>({ isOpen: false, type: null, id: null });
    const { showToast } = useToast();

    const [modalState, setModalState] = useState<{isOpen: boolean, clienteId: string | null, beerToEdit: Birra | null}>({isOpen: false, clienteId: null, beerToEdit: null});
    const [editClientModalOpen, setEditClientModalOpen] = useState(false);
    const [clientToEdit, setClientToEdit] = useState<Cliente | null>(null);

    const loadData = useCallback(async () => {
        const data = await getBreweryData(selectedYear);
        if (data) {
            setFullDataSnapshot(data);
            setClienti(data.CLIENTI || []);
            setBirre(data.BIRRE || []);
            setWarehouseDb(data.DATABASE || []);
            setBreweryProfile(getEffectiveBreweryProfile(data));
        }
    }, [selectedYear]);
    
    useEffect(() => {
        loadData();
    }, [loadData]);

    const handleSaveBreweryProfile = async () => {
        if (!breweryProfile.ragioneSociale.trim() || !breweryProfile.internalClientName.trim()) {
            showToast("Ragione Sociale e Nome Marchio Interno Birrificio sono obbligatori.", 'error');
            return;
        }
        const cleanProfile: BreweryProfile = {
            ...breweryProfile,
            ragioneSociale: breweryProfile.ragioneSociale.trim(),
            internalClientName: breweryProfile.internalClientName.trim(),
            codiceFiscale: breweryProfile.codiceFiscale?.trim().toUpperCase() || '',
            codiceUnivocoSdi: breweryProfile.codiceUnivocoSdi?.trim().toUpperCase() || '',
        };
        const data = await getBreweryData(selectedYear);
        if (!data) return;
        data.BREWERY_PROFILE = cleanProfile;

        // Crea o aggiorna automaticamente l'anagrafica interna tra i marchi per associare le birre proprie del birrificio
        const targetNorm = cleanProfile.internalClientName.toUpperCase();
        const existingIdx = (data.CLIENTI || []).findIndex(
            c => c.nome.trim().toUpperCase() === targetNorm
        );
        const fullAddress = [cleanProfile.indirizzo, cleanProfile.capCittaProvincia].filter(Boolean).join(' - ');
        if (existingIdx > -1) {
            data.CLIENTI[existingIdx] = {
                ...data.CLIENTI[existingIdx],
                ragioneSociale: cleanProfile.ragioneSociale,
                partitaIva: cleanProfile.partitaIva || data.CLIENTI[existingIdx].partitaIva,
                codiceFiscale: cleanProfile.codiceFiscale || data.CLIENTI[existingIdx].codiceFiscale,
                codiceUnivocoSdi: cleanProfile.codiceUnivocoSdi || data.CLIENTI[existingIdx].codiceUnivocoSdi,
                pec: cleanProfile.pec || data.CLIENTI[existingIdx].pec,
                sedeSociale: fullAddress || data.CLIENTI[existingIdx].sedeSociale,
                numeroTelefono: cleanProfile.telefono || data.CLIENTI[existingIdx].numeroTelefono,
            };
        } else {
            data.CLIENTI = [
                {
                    id: `cli_brewery_${Date.now()}`,
                    nome: cleanProfile.internalClientName,
                    ragioneSociale: cleanProfile.ragioneSociale,
                    partitaIva: cleanProfile.partitaIva || undefined,
                    codiceFiscale: cleanProfile.codiceFiscale || undefined,
                    codiceUnivocoSdi: cleanProfile.codiceUnivocoSdi || undefined,
                    pec: cleanProfile.pec || undefined,
                    sedeSociale: fullAddress || undefined,
                    numeroTelefono: cleanProfile.telefono || undefined,
                },
                ...(data.CLIENTI || []),
            ];
        }

        await saveBreweryData(selectedYear, data);
        await loadData();
        showToast("Dati aziendali del Birrificio Centrale salvati e sincronizzati con le birre interne!", 'success');
    };

    const addCliente = async () => {
        if (!newCliente.nome || newCliente.nome.trim() === '') {
            showToast("Il nome del cliente non può essere vuoto.", 'error');
            return;
        }
        
        const currentClienti = await getSheetData(selectedYear, 'CLIENTI') as Cliente[];
        if (currentClienti.some(c => c.nome.toLowerCase() === newCliente.nome!.trim().toLowerCase())) {
            showToast("Esiste già un cliente con questo nome.", 'error');
            return;
        }
        
        const clienteToSave: Cliente = {
            id: `cli_${Date.now()}`,
            nome: newCliente.nome.trim(),
            partitaIva: newCliente.partitaIva?.trim() || undefined,
            codiceFiscale: newCliente.codiceFiscale?.trim() || undefined,
            codiceUnivocoSdi: newCliente.codiceUnivocoSdi?.trim().toUpperCase() || undefined,
            pec: newCliente.pec?.trim() || undefined,
            sedeSociale: newCliente.sedeSociale?.trim() || undefined,
            numeroTelefono: newCliente.numeroTelefono?.trim() || undefined,
            ragioneSociale: newCliente.ragioneSociale?.trim() || undefined,
        };

        await saveDataToSheet(selectedYear, 'CLIENTI', [...currentClienti, clienteToSave]);
        await loadData();
        setNewCliente({ nome: '', partitaIva: '', codiceFiscale: '', codiceUnivocoSdi: '', pec: '', sedeSociale: '', numeroTelefono: '', ragioneSociale: '' });
        showToast("Cliente aggiunto con successo!", 'success');
    };

    const handleDeleteRequest = (type: 'cliente' | 'birra', id: string) => {
        setConfirmState({ isOpen: true, type, id });
    };

    const handleConfirmDelete = async () => {
        if (!confirmState.type || !confirmState.id) return;

        try {
            const fullData = await getBreweryData(selectedYear);
            if (!fullData) throw new Error("Dati non trovati per l'anno corrente");
            
            if (confirmState.type === 'cliente') {
                const clienteId = confirmState.id;
                fullData.CLIENTI = fullData.CLIENTI.filter(c => c.id !== clienteId);
                fullData.BIRRE = fullData.BIRRE.filter(b => b.clienteId !== clienteId);
            } else {
                const birraId = confirmState.id;
                fullData.BIRRE = fullData.BIRRE.filter(b => b.id !== birraId);
            }
            
            await saveBreweryData(selectedYear, fullData);
            await loadData();
            showToast("Elemento eliminato.", 'success');

        } catch (error) {
             console.error("Errore durante l'eliminazione:", error);
            showToast(`Si è verificato un errore: ${error instanceof Error ? error.message : String(error)}`, 'error');
        } finally {
            setConfirmState({ isOpen: false, type: null, id: null });
        }
    };
    
    const handleOpenNewBeerModal = (clienteId: string) => {
        setModalState({ isOpen: true, clienteId, beerToEdit: null });
    };
    
    const handleOpenEditBeerModal = (beer: Birra) => {
        setModalState({ isOpen: true, clienteId: beer.clienteId, beerToEdit: beer });
    };

    const handleCloseModal = () => {
        setModalState({ isOpen: false, clienteId: null, beerToEdit: null });
        loadData();
    };

    const handleEditClient = (cliente: Cliente) => {
        setClientToEdit(cliente);
        setEditClientModalOpen(true);
    };

    const saveEditedClient = async (updatedClient: Cliente) => {
        if (!updatedClient.nome || updatedClient.nome.trim() === '') {
            showToast("Il nome del cliente non può essere vuoto.", 'error');
            return;
        }
        const duplicate = clienti.some(
            c => c.id !== updatedClient.id && c.nome.trim().toLowerCase() === updatedClient.nome.trim().toLowerCase()
        );
        if (duplicate) {
            showToast("Esiste già un altro cliente con questo nome.", 'error');
            return;
        }
        await updateClientWithCascade(selectedYear, updatedClient);
        await loadData();
        setEditClientModalOpen(false);
        setClientToEdit(null);
        showToast("Cliente aggiornato e sincronizzato in tutto l'archivio!", 'success');
    };


    const sortedClienti = useMemo(() => {
        return [...clienti].sort((a, b) => {
            const aInt = isInternalOwner(fullDataSnapshot, a.nome) ? 0 : 1;
            const bInt = isInternalOwner(fullDataSnapshot, b.nome) ? 0 : 1;
            if (aInt !== bInt) return aInt - bInt;
            return a.nome.localeCompare(b.nome);
        });
    }, [clienti, fullDataSnapshot]);

    const ownershipCounts = useMemo(() => {
        let internalBeers = 0;
        let beerfirmBeers = 0;
        let beerfirmClients = 0;
        clienti.forEach(c => {
            const cBeers = birre.filter(b => b.clienteId === c.id).length;
            if (isInternalOwner(fullDataSnapshot, c.nome)) {
                internalBeers += cBeers;
            } else {
                beerfirmClients += 1;
                beerfirmBeers += cBeers;
            }
        });
        return { internalBeers, beerfirmClients, beerfirmBeers };
    }, [clienti, birre, fullDataSnapshot]);

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                    <h1 className="text-3xl font-bold text-brew-accent">📚 Anagrafica Birrificio Centrale, Clienti &amp; Birre</h1>
                    <p className="text-xs text-slate-400 mt-1">
                        Birre Interne Birrificio: <strong className="text-emerald-300">{ownershipCounts.internalBeers}</strong> • Clienti BeerFirm / Conto Terzi: <strong className="text-sky-300">{ownershipCounts.beerfirmClients}</strong> ({ownershipCounts.beerfirmBeers} birre)
                    </p>
                </div>
                <button
                    onClick={() => setIsProfileOpen(prev => !prev)}
                    className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white font-bold text-sm rounded-lg shadow transition-colors self-start sm:self-auto"
                >
                    {isProfileOpen ? '▲ Comprimi Dati Birrificio Centrale' : '🏭 Espandi Dati Birrificio Centrale'}
                </button>
            </div>

            {isProfileOpen && (
                <div className="bg-brew-dark-secondary p-5 rounded-xl shadow-xl border border-amber-500/50 space-y-4">
                    <div className="border-b border-slate-700 pb-2">
                        <h2 className="text-xl font-bold text-amber-300">🏭 Dati Aziendali Birrificio Centrale (Mittente DDT, Fatture &amp; Produzione Interna)</h2>
                        <p className="text-xs text-slate-400 mt-0.5">
                            Questi dati compaiono sempre come <strong>Mittente / Cedente</strong> in tutti i DDT di vendita, DDT di trasferimento, DDT scarti, Dossier HACCP e Fatture XML. Il marchio interno associato distingue le birre proprie del birrificio dai clienti BeerFirm conto terzi.
                        </p>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                        <Field label="Ragione Sociale Birrificio *">
                            <Input value={breweryProfile.ragioneSociale} onChange={e => setBreweryProfile(p => ({ ...p, ragioneSociale: e.target.value }))} placeholder="Es. Birrificio Artigianale S.r.l." />
                        </Field>
                        <Field label="Nome / Linea Birre Interne Birrificio *">
                            <Input
                                list="internal-client-options"
                                value={breweryProfile.internalClientName}
                                onChange={e => setBreweryProfile(p => ({ ...p, internalClientName: e.target.value }))}
                                placeholder="Es. ALVERESE"
                            />
                            <datalist id="internal-client-options">
                                {clienti.map(c => <option key={c.id} value={c.nome} />)}
                            </datalist>
                        </Field>
                        <Field label="Partita IVA">
                            <Input value={breweryProfile.partitaIva} onChange={e => setBreweryProfile(p => ({ ...p, partitaIva: e.target.value }))} placeholder="Es. 01234567890" />
                        </Field>
                        <Field label="Codice Fiscale">
                            <Input value={breweryProfile.codiceFiscale || ''} onChange={e => setBreweryProfile(p => ({ ...p, codiceFiscale: e.target.value.toUpperCase() }))} placeholder="C.F. azienda o titolare" />
                        </Field>
                        <Field label="Codice Accisa (ADM Dogane)">
                            <Input value={breweryProfile.codiceAccisa || ''} onChange={e => setBreweryProfile(p => ({ ...p, codiceAccisa: e.target.value }))} placeholder="Es. IT00GRX00001A" />
                        </Field>
                        <Field label="Codice SDI (7 car.)">
                            <Input maxLength={7} value={breweryProfile.codiceUnivocoSdi || ''} onChange={e => setBreweryProfile(p => ({ ...p, codiceUnivocoSdi: e.target.value.toUpperCase() }))} placeholder="0000000" />
                        </Field>
                        <Field label="Indirizzo Sede / Opificio">
                            <Input value={breweryProfile.indirizzo} onChange={e => setBreweryProfile(p => ({ ...p, indirizzo: e.target.value }))} placeholder="Via / Località, Civico" />
                        </Field>
                        <Field label="CAP, Città e Provincia">
                            <Input value={breweryProfile.capCittaProvincia} onChange={e => setBreweryProfile(p => ({ ...p, capCittaProvincia: e.target.value }))} placeholder="Es. 58100 Grosseto (GR)" />
                        </Field>
                        <Field label="Telefono">
                            <Input value={breweryProfile.telefono || ''} onChange={e => setBreweryProfile(p => ({ ...p, telefono: e.target.value }))} placeholder="Recapito telefonico" />
                        </Field>
                        <Field label="Email">
                            <Input value={breweryProfile.email || ''} onChange={e => setBreweryProfile(p => ({ ...p, email: e.target.value }))} placeholder="info@birrificio.it" />
                        </Field>
                        <Field label="PEC Aziendale">
                            <Input value={breweryProfile.pec || ''} onChange={e => setBreweryProfile(p => ({ ...p, pec: e.target.value }))} placeholder="birrificio@pec.it" />
                        </Field>
                        <Field label="IBAN Accredito Fatture">
                            <Input value={breweryProfile.iban || ''} onChange={e => setBreweryProfile(p => ({ ...p, iban: e.target.value }))} placeholder="IT00 X000 0000 0000 0000 0000 000" />
                        </Field>
                        <div className="md:col-span-2">
                            <Field label="Scaglione Accisa Birrificio (ADM Dogane)">
                                <select
                                    value={breweryProfile.scaglioneAccisa || 'MICRO_50'}
                                    onChange={e => setBreweryProfile(p => ({ ...p, scaglioneAccisa: e.target.value as ExciseBracket }))}
                                    className="w-full bg-brew-dark p-2 rounded-md border border-slate-600 text-sm h-[38px]"
                                >
                                    {EXCISE_BRACKET_OPTIONS.map(opt => (
                                        <option key={opt.value} value={opt.value}>
                                            {opt.label} ({opt.reductionLabel} — €{opt.rateEurHlPlato.toFixed(3)}/hL·°P)
                                        </option>
                                    ))}
                                </select>
                            </Field>
                        </div>
                    </div>
                    <div className="flex justify-end pt-2">
                        <button onClick={handleSaveBreweryProfile} className="bg-brew-green hover:bg-opacity-90 text-white font-bold py-2 px-6 rounded-md shadow">
                            Salva Dati Birrificio Centrale &amp; Sincronizza Birre Interne
                        </button>
                    </div>
                </div>
            )}

            <div className="bg-brew-dark-secondary p-4 rounded-lg shadow-lg border border-slate-700">
                <h2 className="text-xl font-bold mb-1">🤝 Aggiungi Nuovo Cliente / BeerFirm</h2>
                <p className="text-xs text-slate-400 mb-4">Registra clienti commerciali destinatari dei DDT di vendita oppure BeerFirm (conto terzisti) con le proprie birre.</p>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
                    <Field label="Nome Cliente / BeerFirm *"><Input value={newCliente.nome || ''} onChange={e => setNewCliente(prev => ({ ...prev, nome: e.target.value }))} onKeyDown={e => e.key === 'Enter' && addCliente()} required/></Field>
                    <Field label="Ragione Sociale"><Input value={newCliente.ragioneSociale || ''} onChange={e => setNewCliente(prev => ({ ...prev, ragioneSociale: e.target.value }))} onKeyDown={e => e.key === 'Enter' && addCliente()}/></Field>
                    <Field label="Partita IVA"><Input value={newCliente.partitaIva || ''} onChange={e => setNewCliente(prev => ({ ...prev, partitaIva: e.target.value }))} onKeyDown={e => e.key === 'Enter' && addCliente()}/></Field>
                    <Field label="Codice Fiscale"><Input value={newCliente.codiceFiscale || ''} onChange={e => setNewCliente(prev => ({ ...prev, codiceFiscale: e.target.value.toUpperCase() }))} onKeyDown={e => e.key === 'Enter' && addCliente()}/></Field>
                    <Field label="Codice SDI (7 car.)"><Input maxLength={7} placeholder="0000000" value={newCliente.codiceUnivocoSdi || ''} onChange={e => setNewCliente(prev => ({ ...prev, codiceUnivocoSdi: e.target.value.toUpperCase() }))} onKeyDown={e => e.key === 'Enter' && addCliente()}/></Field>
                    <Field label="Sede Sociale (Via, CAP Città)"><Input value={newCliente.sedeSociale || ''} onChange={e => setNewCliente(prev => ({ ...prev, sedeSociale: e.target.value }))} onKeyDown={e => e.key === 'Enter' && addCliente()}/></Field>
                    <Field label="PEC"><Input value={newCliente.pec || ''} onChange={e => setNewCliente(prev => ({ ...prev, pec: e.target.value }))} onKeyDown={e => e.key === 'Enter' && addCliente()}/></Field>
                    <Field label="Numero di Telefono"><Input value={newCliente.numeroTelefono || ''} onChange={e => setNewCliente(prev => ({ ...prev, numeroTelefono: e.target.value }))} onKeyDown={e => e.key === 'Enter' && addCliente()}/></Field>
                    <div className="md:col-span-2 lg:col-span-4 flex justify-end">
                        <button onClick={addCliente} className="bg-brew-green text-white font-bold py-2 px-5 rounded-md flex items-center justify-center gap-2 h-[38px] whitespace-nowrap"><PlusIcon className="w-5 h-5"/> Aggiungi Cliente</button>
                    </div>
                </div>
            </div>

            <div className="space-y-4">
                {sortedClienti.map(cliente => {
                    const isBreweryInternal = isInternalOwner(fullDataSnapshot, cliente.nome);
                    const associatedBeers = birre.filter(b => b.clienteId === cliente.id);
                    return (
                    <div key={cliente.id} className={`bg-brew-dark-secondary p-4 rounded-lg shadow-lg border ${isBreweryInternal ? 'border-emerald-500/60' : 'border-slate-700'}`}>
                        <div className="flex flex-wrap justify-between items-center gap-3 mb-4 border-b border-slate-600 pb-2">
                            <div className="flex flex-wrap items-center gap-2">
                                <span className={`px-2 py-0.5 text-xs font-bold rounded ${isBreweryInternal ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' : 'bg-sky-500/20 text-sky-300 border border-sky-500/40'}`}>
                                    {isBreweryInternal ? '🏠 BIRRIFICIO CENTRALE (INTERNA)' : '🤝 BEERFIRM / CLIENTE TERZI'}
                                </span>
                                <h3 className="text-2xl font-bold text-brew-accent">{cliente.nome}</h3>
                            </div>
                            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
                                {cliente.ragioneSociale && <span>Rag. Soc.: <strong className="text-slate-200">{cliente.ragioneSociale}</strong></span>}
                                {cliente.partitaIva && <span>P.IVA: {cliente.partitaIva}</span>}
                                {cliente.sedeSociale && <span>Sede: {cliente.sedeSociale}</span>}
                                {cliente.numeroTelefono && <span>Tel: {cliente.numeroTelefono}</span>}
                                <div className="flex items-center gap-2 ml-2">
                                    <button onClick={() => handleEditClient(cliente)} className="text-brew-blue hover:text-blue-400" title="Modifica anagrafica"><PencilIcon className="w-5 h-5"/></button>
                                    <button onClick={() => handleDeleteRequest('cliente', cliente.id)} className="text-red-500 hover:text-red-400" title="Elimina"><TrashIcon className="w-5 h-5"/></button>
                                </div>
                            </div>
                        </div>
                        
                        <div className="pl-2 sm:pl-4">
                             <h4 className="text-base font-semibold mb-2 text-slate-200">
                                {isBreweryInternal ? 'Birre di Produzione Interna del Birrificio' : 'Birre Associate al Cliente (Conto Terzi)'} ({associatedBeers.length})
                             </h4>
                             {associatedBeers.map(birra => (
                                <div key={birra.id} className="flex justify-between items-center bg-brew-dark p-2.5 rounded-md mb-2 border border-slate-700/60">
                                    <div>
                                        <div className="flex flex-wrap items-center gap-2">
                                            <p className="font-bold text-white">{birra.nomeBirra}</p>
                                            {birra.gradoAlcolicoPrevisto !== undefined && birra.gradoAlcolicoPrevisto > 0 ? (
                                                <span className="px-2 py-0.5 text-[11px] font-bold rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 font-mono tabular-nums">
                                                    ABV Etichetta: {birra.gradoAlcolicoPrevisto.toFixed(1)}% vol
                                                </span>
                                            ) : (
                                                <span className="px-2 py-0.5 text-[11px] font-bold rounded bg-red-500/15 text-red-300 border border-red-500/40">
                                                    ABV Etichetta non impostato
                                                </span>
                                            )}
                                            {birra.zuccheroRifermentazioneGL !== undefined && birra.zuccheroRifermentazioneGL > 0 && (
                                                <span className="px-2 py-0.5 text-[11px] font-semibold rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-mono tabular-nums">
                                                    Riferment.: {birra.zuccheroRifermentazioneGL} g/L
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-xs text-slate-400 mt-0.5">
                                            {birra.tipologia} • {birra.platoIniziale}°P • Ricetta base: {birra.litriBatchBase || 1000} L
                                            {birra.ricetta ? ` (${birra.ricetta.length} ingr.)` : ''}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-4">
                                        <button onClick={() => handleOpenEditBeerModal(birra)} className="text-brew-blue hover:text-blue-400" title="Modifica birra e ricetta"><PencilIcon className="w-5 h-5"/></button>
                                        <button onClick={() => handleDeleteRequest('birra', birra.id)} className="text-red-500/70 hover:text-red-500" title="Elimina birra"><TrashIcon className="w-5 h-5"/></button>
                                    </div>
                                </div>
                             ))}
                             {associatedBeers.length === 0 && <p className="text-sm text-slate-400">Nessuna birra associata.</p>}

                            <div className="mt-4 pt-3 border-t border-slate-700">
                                <button onClick={() => handleOpenNewBeerModal(cliente.id)} className="w-full bg-brew-blue text-white font-bold p-2 rounded-md flex items-center justify-center gap-2 hover:bg-opacity-90">
                                    <PlusIcon className="w-5 h-5"/> {isBreweryInternal ? 'Aggiungi Nuova Birra Interna Birrificio' : 'Aggiungi Nuova Birra BeerFirm'}
                                </button>
                            </div>
                        </div>
                    </div>
                    );
                })}
            </div>
            
            {confirmState.isOpen && (
                <Modal
                    title="Conferma Eliminazione"
                    isOpen={confirmState.isOpen}
                    onClose={() => setConfirmState({ isOpen: false, type: null, id: null })}
                    size="sm"
                >
                    <div className="space-y-4">
                        <p className="text-sm text-gray-300">
                            {confirmState.type === 'cliente'
                                ? "Vuoi davvero cancellare questo cliente e tutte le sue birre associate dal database?"
                                : "Vuoi davvero cancellare questo prodotto dal database?"}
                        </p>
                        <div className="flex justify-end gap-4 pt-4">
                            <button
                                onClick={() => setConfirmState({ isOpen: false, type: null, id: null })}
                                className="px-4 py-2 rounded-md bg-slate-600 text-white font-semibold hover:bg-slate-500"
                            >
                                No
                            </button>
                            <button
                                onClick={handleConfirmDelete}
                                className="px-4 py-2 rounded-md bg-brew-red text-white font-bold hover:bg-opacity-80"
                            >
                                Sì
                            </button>
                        </div>
                    </div>
                </Modal>
            )}

            {modalState.isOpen && (
                <BeerRecipeModal
                    isOpen={modalState.isOpen}
                    onClose={handleCloseModal}
                    selectedYear={selectedYear}
                    clienteId={modalState.clienteId!}
                    beerToEdit={modalState.beerToEdit}
                    warehouseDb={warehouseDb}
                />
            )}
            
            {editClientModalOpen && (
                <EditClientModal
                    isOpen={editClientModalOpen}
                    onClose={() => setEditClientModalOpen(false)}
                    clientToEdit={clientToEdit}
                    onSave={saveEditedClient}
                />
            )}
        </div>
    );
};

const Field: React.FC<{label: string, children: React.ReactNode}> = ({ label, children }) => (
    <div>
        <label className="block text-xs font-medium text-gray-400 mb-1">{label}</label>
        {children}
    </div>
);

const Input = (props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input {...props} className="w-full bg-brew-dark p-2 rounded-md border border-slate-600 focus:ring-brew-accent focus:border-brew-accent text-sm" />
);