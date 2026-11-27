import React, { useState, useEffect, useMemo, useCallback } from 'react';
import type { 
    CalendarNote, 
    CellarPackagingEvent, 
    CalendarNotePriority, 
    CalendarNoteCategory, 
    BrewHeader,
    PlannedBrew,
    MaintenancePlan,
    MaintenanceLog,
    MaintenanceType,
    MaintenanceFrequency,
    Cliente,
    Birra,
    RawWarehouseItem,
    FermenterConfig
} from '../types';
import { 
    getCellarPackagingEvents, 
    getCalendarNotes, 
    addCalendarNote, 
    updateCalendarNote, 
    deleteCalendarNote, 
    toggleCalendarNote,
    getPlannedBrews,
    addPlannedBrew,
    updatePlannedBrew,
    deletePlannedBrew,
    togglePlannedBrewStatus,
    setPlannedBrewLotto,
    getMaintenancePlans,
    addMaintenancePlan,
    updateMaintenancePlan,
    deleteMaintenancePlan,
    executeMaintenancePlan,
    getMaintenanceLogs,
    analyzePlannedBrewStock
} from '../services/calendarService';
import { getBreweryData } from '../services/dataService';
import { 
    PlusIcon, 
    TrashIcon, 
    CheckIcon, 
    XMarkIcon, 
    PencilIcon, 
    CalendarDaysIcon, 
    FireIcon, 
    WrenchIcon, 
    SparklesIcon, 
    ArrowRightIcon
} from './icons';
import { useToast } from '../hooks/useToast';

interface CalendarViewProps {
    selectedYear: string;
    onOpenLotto?: (lottoId: string) => void;
    onNavigateToCantina?: () => void;
    onNavigateToBrew?: (plannedBrew?: PlannedBrew) => void;
}

const MONTH_NAMES_IT = [
    'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
    'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'
];

const WEEKDAY_NAMES_IT = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];

const CATEGORY_LABELS: Record<CalendarNoteCategory, { label: string; icon: string; color: string }> = {
    NOTE: { label: 'Appunto / Nota', icon: '📝', color: 'bg-slate-700 text-slate-200 border-slate-600' },
    CONFEZIONAMENTO: { label: 'Confezionamento', icon: '🍺', color: 'bg-amber-900/60 text-amber-200 border-amber-600' },
    COTTA: { label: 'Cotta Pianificata', icon: '🔥', color: 'bg-orange-900/60 text-orange-200 border-orange-600' },
    LAVORAZIONE: { label: 'Dry Hop / Cantina', icon: '🌿', color: 'bg-emerald-900/60 text-emerald-200 border-emerald-600' },
    MANUTENZIONE: { label: 'Manutenzione Impianto', icon: '🔧', color: 'bg-blue-900/60 text-blue-200 border-blue-600' },
    CONSEGNA: { label: 'Consegna / Ordine', icon: '🚚', color: 'bg-purple-900/60 text-purple-200 border-purple-600' },
};

const PRIORITY_BADGES: Record<CalendarNotePriority, { label: string; badge: string }> = {
    NORMALE: { label: 'Normale', badge: 'bg-slate-600 text-slate-200' },
    ALTA: { label: 'Alta', badge: 'bg-yellow-600 text-yellow-100 font-bold' },
    URGENTE: { label: 'Urgente', badge: 'bg-red-600 text-white font-extrabold animate-pulse' },
};

const FREQUENCY_LABELS: Record<MaintenanceFrequency, { label: string; defaultDays: number }> = {
    GIORNALIERA: { label: 'Giornaliera (1 giorno)', defaultDays: 1 },
    SETTIMANALE: { label: 'Settimanale (7 giorni)', defaultDays: 7 },
    QUINDICINALE: { label: 'Quindicinale (14 giorni)', defaultDays: 14 },
    MENSILE: { label: 'Mensile (30 giorni)', defaultDays: 30 },
    TRIMESTRALE: { label: 'Trimestrale (90 giorni)', defaultDays: 90 },
    SEMESTRALE: { label: 'Semestrale (180 giorni)', defaultDays: 180 },
    ANNUALE: { label: 'Annuale (365 giorni)', defaultDays: 365 },
    PERSONALIZZATA: { label: 'Personalizzata (giorni a scelta)', defaultDays: 10 }
};

export const CalendarView: React.FC<CalendarViewProps> = ({ 
    selectedYear, 
    onOpenLotto, 
    onNavigateToCantina,
    onNavigateToBrew 
}) => {
    const { showToast } = useToast();
    const today = useMemo(() => new Date(), []);
    const todayISO = useMemo(() => {
        const y = today.getFullYear();
        const m = String(today.getMonth() + 1).padStart(2, '0');
        const d = String(today.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }, [today]);

    // Tab attivo all'interno del calendario
    const [activeTab, setActiveTab] = useState<'CALENDAR' | 'PLANNED_BREWS' | 'MAINTENANCE'>('CALENDAR');

    // Mese e anno visualizzati sul calendario
    const [currentYear, setCurrentYear] = useState<number>(parseInt(selectedYear, 10) || today.getFullYear());
    const [currentMonth, setCurrentMonth] = useState<number>(today.getMonth()); // 0-11
    const [calendarViewMode, setCalendarViewMode] = useState<'DAYS' | 'MONTHS' | 'YEARS'>('DAYS');

    // Dati DB
    const [notes, setNotes] = useState<CalendarNote[]>([]);
    const [cellarEvents, setCellarEvents] = useState<CellarPackagingEvent[]>([]);
    const [plannedBrews, setPlannedBrews] = useState<PlannedBrew[]>([]);
    const [maintenancePlans, setMaintenancePlans] = useState<MaintenancePlan[]>([]);
    const [maintenanceLogs, setMaintenanceLogs] = useState<MaintenanceLog[]>([]);
    const [clienti, setClienti] = useState<Cliente[]>([]);
    const [birre, setBirre] = useState<Birra[]>([]);
    const [magazzino, setMagazzino] = useState<RawWarehouseItem[]>([]);
    const [cantinaConfig, setCantinaConfig] = useState<FermenterConfig[]>([]);
    const [activeCotte, setActiveCotte] = useState<BrewHeader[]>([]);
    const [loading, setLoading] = useState(true);

    // Filtri calendario
    const [filterCategory, setFilterCategory] = useState<string>('ALL');
    const [showPlannedBrewsOnCalendar, setShowPlannedBrewsOnCalendar] = useState<boolean>(true);
    const [showCompletedBrewsOnCalendar, setShowCompletedBrewsOnCalendar] = useState<boolean>(true);
    const [showMaintenanceOnCalendar, setShowMaintenanceOnCalendar] = useState<boolean>(true);
    const [showCellarOnCalendar, setShowCellarOnCalendar] = useState<boolean>(true);

    // Modale associazione numero di lotto
    const [lottoLinkingModal, setLottoLinkingModal] = useState<{ isOpen: boolean; brew: PlannedBrew | null; lottoInput: string }>({
        isOpen: false,
        brew: null,
        lottoInput: ''
    });

    // Giorno selezionato per modale dettaglio giorno
    const [selectedDateISO, setSelectedDateISO] = useState<string>(todayISO);
    const [isDayModalOpen, setIsDayModalOpen] = useState<boolean>(false);

    // Modali Note
    const [isNoteModalOpen, setIsNoteModalOpen] = useState<boolean>(false);
    const [editingNote, setEditingNote] = useState<CalendarNote | null>(null);
    const [formNoteDate, setFormNoteDate] = useState<string>(todayISO);
    const [formNoteTitle, setFormNoteTitle] = useState<string>('');
    const [formNoteDescription, setFormNoteDescription] = useState<string>('');
    const [formNoteCategory, setFormNoteCategory] = useState<CalendarNoteCategory>('NOTE');
    const [formNotePriority, setFormNotePriority] = useState<CalendarNotePriority>('NORMALE');
    const [formNoteTime, setFormNoteTime] = useState<string>('');
    const [formNoteRelatedLotto, setFormNoteRelatedLotto] = useState<string>('');
    const [formNoteRelatedFermentatore, setFormNoteRelatedFermentatore] = useState<string>('');

    // Modali Pianificazione Cotta
    const [isPlannedBrewModalOpen, setIsPlannedBrewModalOpen] = useState<boolean>(false);
    const [editingPlannedBrew, setEditingPlannedBrew] = useState<PlannedBrew | null>(null);
    const [formBrewDate, setFormBrewDate] = useState<string>(todayISO);
    const [formBrewClienteId, setFormBrewClienteId] = useState<string>('');
    const [formBrewBirraId, setFormBrewBirraId] = useState<string>('');
    const [formBrewLitri, setFormBrewLitri] = useState<number>(1000);
    const [formBrewFermentatore, setFormBrewFermentatore] = useState<string>('');
    const [formBrewNote, setFormBrewNote] = useState<string>('');
    const [formBrewStatus, setFormBrewStatus] = useState<PlannedBrew['status']>('PIANIFICATA');
    const [formBrewLotto, setFormBrewLotto] = useState<string>('');
    const [plannedBrewsFilter, setPlannedBrewsFilter] = useState<'ALL' | 'PENDING' | 'COMPLETED'>('ALL');

    // Modali Manutenzione & CIP
    const [isMaintenanceModalOpen, setIsMaintenanceModalOpen] = useState<boolean>(false);
    const [editingMaintenancePlan, setEditingMaintenancePlan] = useState<MaintenancePlan | null>(null);
    const [formMaintTipo, setFormMaintTipo] = useState<MaintenanceType>('CIP_SANIFICAZIONE');
    const [formMaintNome, setFormMaintNome] = useState<string>('');
    const [formMaintApparato, setFormMaintApparato] = useState<string>('Scambiatore');
    const [formMaintFrequenza, setFormMaintFrequenza] = useState<MaintenanceFrequency>('SETTIMANALE');
    const [formMaintIntervalloGiorni, setFormMaintIntervalloGiorni] = useState<number>(7);
    const [formMaintProssimaData, setFormMaintProssimaData] = useState<string>(todayISO);
    const [formMaintProcedura, setFormMaintProcedura] = useState<string>('');
    const [formMaintProdottoChimico, setFormMaintProdottoChimico] = useState<string>('');

    // Modale Esecuzione Manutenzione
    const [executingPlan, setExecutingPlan] = useState<MaintenancePlan | null>(null);
    const [execOperatore, setExecOperatore] = useState<string>('');
    const [execNote, setExecNote] = useState<string>('');

    // Caricamento Dati
    const loadAllData = useCallback(async () => {
        setLoading(true);
        try {
            const [
                loadedNotes, 
                loadedCellarEvents, 
                loadedPlannedBrews, 
                loadedMaintenancePlans,
                loadedMaintenanceLogs,
                breweryData
            ] = await Promise.all([
                getCalendarNotes(selectedYear),
                getCellarPackagingEvents(selectedYear),
                getPlannedBrews(selectedYear),
                getMaintenancePlans(selectedYear),
                getMaintenanceLogs(selectedYear),
                getBreweryData(selectedYear)
            ]);

            setNotes(loadedNotes);
            setCellarEvents(loadedCellarEvents);
            setPlannedBrews(loadedPlannedBrews);
            setMaintenancePlans(loadedMaintenancePlans);
            setMaintenanceLogs(loadedMaintenanceLogs);

            if (breweryData) {
                setClienti(breweryData.CLIENTI || []);
                setBirre(breweryData.BIRRE || []);
                setMagazzino(breweryData.MAGAZZINO || []);
                setCantinaConfig(breweryData.CANTINA_CONFIG || []);
                setActiveCotte(breweryData.COTTE_HEAD || []);
            }
        } catch (error) {
            console.error('Errore nel caricamento del calendario:', error);
            showToast('Errore durante il caricamento dei dati del calendario', 'error');
        } finally {
            setLoading(false);
        }
    }, [selectedYear, showToast]);

    useEffect(() => {
        loadAllData();
    }, [loadAllData]);

    // Birre disponibili per il cliente selezionato nel form di pianificazione
    const birreClienteForm = useMemo(() => {
        if (!formBrewClienteId) return [];
        return birre.filter(b => b.clienteId === formBrewClienteId);
    }, [formBrewClienteId, birre]);

    // Birra attualmente selezionata nel form pianificazione cotta
    const selectedBirraForm = useMemo(() => {
        return birre.find(b => b.id === formBrewBirraId);
    }, [formBrewBirraId, birre]);

    // Analisi magazzino in tempo reale nel form pianificazione cotta
    const liveStockAnalysis = useMemo(() => {
        if (!selectedBirraForm) return null;
        return analyzePlannedBrewStock(selectedBirraForm, formBrewLitri, magazzino);
    }, [selectedBirraForm, formBrewLitri, magazzino]);

    // Navigazione calendario
    const handlePrevMonth = () => {
        if (calendarViewMode === 'DAYS') {
            if (currentMonth === 0) {
                setCurrentMonth(11);
                setCurrentYear(prev => prev - 1);
            } else {
                setCurrentMonth(prev => prev - 1);
            }
        } else if (calendarViewMode === 'MONTHS') {
            setCurrentYear(prev => prev - 1);
        } else if (calendarViewMode === 'YEARS') {
            setCurrentYear(prev => prev - 12);
        }
    };

    const handleNextMonth = () => {
        if (calendarViewMode === 'DAYS') {
            if (currentMonth === 11) {
                setCurrentMonth(0);
                setCurrentYear(prev => prev + 1);
            } else {
                setCurrentMonth(prev => prev + 1);
            }
        } else if (calendarViewMode === 'MONTHS') {
            setCurrentYear(prev => prev + 1);
        } else if (calendarViewMode === 'YEARS') {
            setCurrentYear(prev => prev + 12);
        }
    };

    const handleToday = () => {
        setCurrentMonth(today.getMonth());
        setCurrentYear(today.getFullYear());
        setCalendarViewMode('DAYS');
    };

    // Generazione celle giorni del mese
    const calendarDays = useMemo(() => {
        const firstDayOfMonth = new Date(currentYear, currentMonth, 1);
        const lastDayOfMonth = new Date(currentYear, currentMonth + 1, 0);
        
        let startDayOfWeek = firstDayOfMonth.getDay() - 1;
        if (startDayOfWeek === -1) startDayOfWeek = 6; // Domenica

        const prevMonthLastDay = new Date(currentYear, currentMonth, 0).getDate();
        const totalDaysCurrentMonth = lastDayOfMonth.getDate();

        const days = [];

        // Giorni mese precedente
        for (let i = startDayOfWeek - 1; i >= 0; i--) {
            const dayNum = prevMonthLastDay - i;
            const prevM = currentMonth === 0 ? 11 : currentMonth - 1;
            const prevY = currentMonth === 0 ? currentYear - 1 : currentYear;
            const iso = `${prevY}-${String(prevM + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
            days.push({ dayNumber: dayNum, isCurrentMonth: false, isoDate: iso });
        }

        // Giorni mese corrente
        for (let d = 1; d <= totalDaysCurrentMonth; d++) {
            const iso = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            days.push({ dayNumber: d, isCurrentMonth: true, isoDate: iso });
        }

        // Giorni mese successivo per completare la griglia (multiplo di 7)
        const remainingCells = (7 - (days.length % 7)) % 7;
        for (let d = 1; d <= remainingCells; d++) {
            const nextM = currentMonth === 11 ? 0 : currentMonth + 1;
            const nextY = currentMonth === 11 ? currentYear + 1 : currentYear;
            const iso = `${nextY}-${String(nextM + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            days.push({ dayNumber: d, isCurrentMonth: false, isoDate: iso });
        }

        return days;
    }, [currentYear, currentMonth]);

    // Raggruppamento dati per data ISO
    const notesByDate = useMemo(() => {
        const map = new Map<string, CalendarNote[]>();
        notes.forEach(note => {
            if (filterCategory !== 'ALL' && note.category !== filterCategory) return;
            const existing = map.get(note.date) || [];
            existing.push(note);
            map.set(note.date, existing);
        });
        return map;
    }, [notes, filterCategory]);

    const cellarByDate = useMemo(() => {
        const map = new Map<string, CellarPackagingEvent[]>();
        if (!showCellarOnCalendar) return map;
        cellarEvents.forEach(e => {
            const existing = map.get(e.dataPrevistaConfezionamento) || [];
            existing.push(e);
            map.set(e.dataPrevistaConfezionamento, existing);
        });
        return map;
    }, [cellarEvents, showCellarOnCalendar]);

    const plannedBrewsByDate = useMemo(() => {
        const map = new Map<string, PlannedBrew[]>();
        if (!showPlannedBrewsOnCalendar) return map;
        plannedBrews.forEach(pb => {
            if (!showCompletedBrewsOnCalendar && pb.status === 'PRODOTTA') return;
            const existing = map.get(pb.date) || [];
            existing.push(pb);
            map.set(pb.date, existing);
        });
        return map;
    }, [plannedBrews, showPlannedBrewsOnCalendar, showCompletedBrewsOnCalendar]);

    const maintenanceByDate = useMemo(() => {
        const map = new Map<string, MaintenancePlan[]>();
        if (!showMaintenanceOnCalendar) return map;
        maintenancePlans.forEach(mp => {
            if (mp.attivo && mp.dataProssimaScadenza) {
                const existing = map.get(mp.dataProssimaScadenza) || [];
                existing.push(mp);
                map.set(mp.dataProssimaScadenza, existing);
            }
        });
        return map;
    }, [maintenancePlans, showMaintenanceOnCalendar]);

    // Handlers Note
    const handleOpenNewNoteModal = (dateISO?: string) => {
        setEditingNote(null);
        setFormNoteDate(dateISO || todayISO);
        setFormNoteTitle('');
        setFormNoteDescription('');
        setFormNoteCategory('NOTE');
        setFormNotePriority('NORMALE');
        setFormNoteTime('');
        setFormNoteRelatedLotto('');
        setFormNoteRelatedFermentatore('');
        setIsNoteModalOpen(true);
    };

    const handleEditNote = (note: CalendarNote) => {
        setEditingNote(note);
        setFormNoteDate(note.date);
        setFormNoteTitle(note.title);
        setFormNoteDescription(note.description || '');
        setFormNoteCategory(note.category);
        setFormNotePriority(note.priority);
        setFormNoteTime(note.time || '');
        setFormNoteRelatedLotto(note.relatedLotto || '');
        setFormNoteRelatedFermentatore(note.relatedFermentatore || '');
        setIsNoteModalOpen(true);
    };

    const handleSaveNote = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!formNoteTitle.trim()) {
            showToast('Il titolo dell\'appunto è obbligatorio', 'error');
            return;
        }

        try {
            if (editingNote) {
                await updateCalendarNote(selectedYear, {
                    ...editingNote,
                    date: formNoteDate,
                    title: formNoteTitle.trim(),
                    description: formNoteDescription.trim(),
                    category: formNoteCategory,
                    priority: formNotePriority,
                    time: formNoteTime.trim() || undefined,
                    relatedLotto: formNoteRelatedLotto.trim() || undefined,
                    relatedFermentatore: formNoteRelatedFermentatore.trim() || undefined,
                });
                showToast('Appunto aggiornato con successo!', 'success');
            } else {
                await addCalendarNote(selectedYear, {
                    date: formNoteDate,
                    title: formNoteTitle.trim(),
                    description: formNoteDescription.trim(),
                    category: formNoteCategory,
                    priority: formNotePriority,
                    time: formNoteTime.trim() || undefined,
                    completed: false,
                    relatedLotto: formNoteRelatedLotto.trim() || undefined,
                    relatedFermentatore: formNoteRelatedFermentatore.trim() || undefined,
                });
                showToast('Nuovo appunto salvato a calendario!', 'success');
            }
            setIsNoteModalOpen(false);
            loadAllData();
        } catch (error) {
            console.error('Errore nel salvataggio della nota:', error);
            showToast('Errore nel salvataggio dell\'appunto', 'error');
        }
    };

    const handleDeleteNote = async (noteId: string) => {
        if (window.confirm('Sei sicuro di voler eliminare questo appunto?')) {
            await deleteCalendarNote(selectedYear, noteId);
            showToast('Appunto eliminato', 'info');
            loadAllData();
        }
    };

    const handleToggleNote = async (noteId: string) => {
        await toggleCalendarNote(selectedYear, noteId);
        loadAllData();
    };

    // Handlers Cotte Pianificate
    const handleOpenNewPlannedBrew = (dateISO?: string) => {
        setEditingPlannedBrew(null);
        setFormBrewDate(dateISO || todayISO);
        setFormBrewClienteId(clienti.length > 0 ? clienti[0].id : '');
        setFormBrewBirraId('');
        setFormBrewLitri(1000);
        setFormBrewFermentatore('');
        setFormBrewNote('');
        setFormBrewStatus('PIANIFICATA');
        setFormBrewLotto('');
        setIsPlannedBrewModalOpen(true);
    };

    const handleEditPlannedBrew = (brew: PlannedBrew) => {
        setEditingPlannedBrew(brew);
        setFormBrewDate(brew.date);
        setFormBrewClienteId(brew.clienteId);
        setFormBrewBirraId(brew.birraId);
        setFormBrewLitri(brew.litriPrevisti);
        setFormBrewFermentatore(brew.fermentatore || '');
        setFormBrewNote(brew.note || '');
        setFormBrewStatus(brew.status || 'PIANIFICATA');
        setFormBrewLotto(brew.lottoCreato || '');
        setIsPlannedBrewModalOpen(true);
    };

    const handleSavePlannedBrew = async (e: React.FormEvent) => {
        e.preventDefault();
        const clienteObj = clienti.find(c => c.id === formBrewClienteId);
        const birraObj = birre.find(b => b.id === formBrewBirraId);

        if (!clienteObj || !birraObj) {
            showToast('Seleziona sia il cliente che la birra da produrre', 'error');
            return;
        }

        try {
            if (editingPlannedBrew) {
                await updatePlannedBrew(selectedYear, {
                    ...editingPlannedBrew,
                    date: formBrewDate,
                    clienteId: clienteObj.id,
                    clienteNome: clienteObj.nome,
                    birraId: birraObj.id,
                    birraNome: birraObj.nomeBirra,
                    litriPrevisti: formBrewLitri,
                    fermentatore: formBrewFermentatore.trim() || undefined,
                    note: formBrewNote.trim() || undefined,
                    status: formBrewStatus,
                    lottoCreato: formBrewLotto.trim() || undefined,
                    eseguitaAt: formBrewStatus === 'PRODOTTA' ? (editingPlannedBrew.eseguitaAt || new Date().toISOString()) : undefined
                });
                showToast('Cotta pianificata aggiornata!', 'success');
            } else {
                await addPlannedBrew(selectedYear, {
                    date: formBrewDate,
                    clienteId: clienteObj.id,
                    clienteNome: clienteObj.nome,
                    birraId: birraObj.id,
                    birraNome: birraObj.nomeBirra,
                    litriPrevisti: formBrewLitri,
                    fermentatore: formBrewFermentatore.trim() || undefined,
                    note: formBrewNote.trim() || undefined,
                    status: formBrewStatus,
                    lottoCreato: formBrewLotto.trim() || undefined,
                    eseguitaAt: formBrewStatus === 'PRODOTTA' ? new Date().toISOString() : undefined
                });
                showToast(
                    formBrewStatus === 'PRODOTTA' 
                        ? 'Cotta memorizzata nello storico del calendario come eseguita!' 
                        : 'Nuova cotta fissata a calendario con verifica magazzino!', 
                    'success'
                );
            }
            setIsPlannedBrewModalOpen(false);
            loadAllData();
        } catch (err) {
            console.error(err);
            showToast('Errore durante il salvataggio della cotta pianificata', 'error');
        }
    };

    const handleTogglePlannedBrew = async (brew: PlannedBrew, explicitLotto?: string) => {
        try {
            const isNowCompleted = brew.status !== 'PRODOTTA';
            await togglePlannedBrewStatus(
                selectedYear, 
                brew.id, 
                isNowCompleted ? 'PRODOTTA' : 'PIANIFICATA',
                explicitLotto !== undefined ? explicitLotto : (isNowCompleted ? brew.lottoCreato : undefined)
            );
            showToast(
                isNowCompleted 
                    ? `✓ Cotta ${brew.birraNome} contrassegnata come Eseguita! Rimane conservata nello storico del calendario per il ${formatISODateToItalian(brew.date)}.` 
                    : `Cotta ${brew.birraNome} riaperta come Da Eseguire.`,
                'success'
            );
            loadAllData();
        } catch (err) {
            console.error(err);
            showToast('Errore durante l\'aggiornamento dello stato della cotta', 'error');
        }
    };

    const handleOpenLottoLinking = (brew: PlannedBrew) => {
        setLottoLinkingModal({
            isOpen: true,
            brew,
            lottoInput: brew.lottoCreato || ''
        });
    };

    const handleSaveLottoLink = async () => {
        if (!lottoLinkingModal.brew) return;
        try {
            const trimmed = lottoLinkingModal.lottoInput.trim().toUpperCase();
            await setPlannedBrewLotto(selectedYear, lottoLinkingModal.brew.id, trimmed);
            showToast(`Lotto ${trimmed || 'rimosso'} associato alla cotta del calendario!`, 'success');
            setLottoLinkingModal({ isOpen: false, brew: null, lottoInput: '' });
            loadAllData();
        } catch (err) {
            console.error(err);
            showToast('Errore durante l\'associazione del numero di lotto', 'error');
        }
    };

    const handleDeletePlannedBrew = async (brewId: string) => {
        if (window.confirm('Sei sicuro di voler eliminare questa cotta dal calendario?\n\n⚠️ NOTA BENE: Se la cotta è già stata eseguita e vuoi memorizzarla nello storico del lavoro svolto, NON cancellarla con il cestino ma usa invece la casella di spunta "Cotta Eseguita" (✓).\n\nVuoi procedere comunque con l\'eliminazione definitiva dal calendario?')) {
            await deletePlannedBrew(selectedYear, brewId);
            showToast('Cotta rimossa dal calendario', 'info');
            loadAllData();
        }
    };

    // Handlers Manutenzione & CIP
    const handleOpenNewMaintenanceModal = (dateISO?: string) => {
        setEditingMaintenancePlan(null);
        setFormMaintTipo('CIP_SANIFICAZIONE');
        setFormMaintNome('');
        setFormMaintApparato('Scambiatore');
        setFormMaintFrequenza('SETTIMANALE');
        setFormMaintIntervalloGiorni(7);
        setFormMaintProssimaData(dateISO || todayISO);
        setFormMaintProcedura('');
        setFormMaintProdottoChimico('');
        setIsMaintenanceModalOpen(true);
    };

    const handleEditMaintenancePlan = (plan: MaintenancePlan) => {
        setEditingMaintenancePlan(plan);
        setFormMaintTipo(plan.tipo);
        setFormMaintNome(plan.nome);
        setFormMaintApparato(plan.apparato);
        setFormMaintFrequenza(plan.frequenza);
        setFormMaintIntervalloGiorni(plan.intervalloGiorni);
        setFormMaintProssimaData(plan.dataProssimaScadenza);
        setFormMaintProcedura(plan.noteProcedura || '');
        setFormMaintProdottoChimico(plan.prodottoChimico || '');
        setIsMaintenanceModalOpen(true);
    };

    const handleFrequencyChange = (freq: MaintenanceFrequency) => {
        setFormMaintFrequenza(freq);
        setFormMaintIntervalloGiorni(FREQUENCY_LABELS[freq].defaultDays);
    };

    const handleSaveMaintenancePlan = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!formMaintNome.trim()) {
            showToast('Inserisci un nome per l\'intervento di manutenzione o CIP', 'error');
            return;
        }

        try {
            if (editingMaintenancePlan) {
                await updateMaintenancePlan(selectedYear, {
                    ...editingMaintenancePlan,
                    tipo: formMaintTipo,
                    nome: formMaintNome.trim(),
                    apparato: formMaintApparato.trim(),
                    frequenza: formMaintFrequenza,
                    intervalloGiorni: formMaintIntervalloGiorni,
                    dataProssimaScadenza: formMaintProssimaData,
                    noteProcedura: formMaintProcedura.trim() || undefined,
                    prodottoChimico: formMaintProdottoChimico.trim() || undefined,
                    attivo: true
                });
                showToast('Piano di manutenzione aggiornato!', 'success');
            } else {
                await addMaintenancePlan(selectedYear, {
                    tipo: formMaintTipo,
                    nome: formMaintNome.trim(),
                    apparato: formMaintApparato.trim(),
                    frequenza: formMaintFrequenza,
                    intervalloGiorni: formMaintIntervalloGiorni,
                    dataProssimaScadenza: formMaintProssimaData,
                    noteProcedura: formMaintProcedura.trim() || undefined,
                    prodottoChimico: formMaintProdottoChimico.trim() || undefined,
                    attivo: true
                });
                showToast('Nuovo promemoria cadenzato salvato a calendario!', 'success');
            }
            setIsMaintenanceModalOpen(false);
            loadAllData();
        } catch (err) {
            console.error(err);
            showToast('Errore durante il salvataggio del piano', 'error');
        }
    };

    const handleDeleteMaintenancePlan = async (planId: string) => {
        if (window.confirm('Eliminare questo promemoria di manutenzione/CIP?')) {
            await deleteMaintenancePlan(selectedYear, planId);
            showToast('Piano rimosso', 'info');
            loadAllData();
        }
    };

    const handleQuickExecute = async (plan: MaintenancePlan) => {
        setExecutingPlan(plan);
        setExecOperatore('');
        setExecNote('');
    };

    const handleConfirmExecution = async () => {
        if (!executingPlan) return;
        try {
            await executeMaintenancePlan(selectedYear, executingPlan.id, {
                operatore: execOperatore.trim() || undefined,
                note: execNote.trim() || undefined
            });
            showToast(`Intervento "${executingPlan.nome}" registrato come eseguito! Nuova scadenza calcolata.`, 'success');
            setExecutingPlan(null);
            loadAllData();
        } catch (err) {
            console.error(err);
            showToast('Errore durante la registrazione dell\'intervento', 'error');
        }
    };

    // Apertura Dettaglio Giorno Cliccato
    const handleDayClick = (isoDate: string) => {
        setSelectedDateISO(isoDate);
        setIsDayModalOpen(true);
    };

    const selectedDayNotes = useMemo(() => notesByDate.get(selectedDateISO) || [], [notesByDate, selectedDateISO]);
    const selectedDayCellar = useMemo(() => cellarByDate.get(selectedDateISO) || [], [cellarByDate, selectedDateISO]);
    const selectedDayBrews = useMemo(() => plannedBrewsByDate.get(selectedDateISO) || [], [plannedBrewsByDate, selectedDateISO]);
    const selectedDayMaint = useMemo(() => maintenanceByDate.get(selectedDateISO) || [], [maintenanceByDate, selectedDateISO]);

    // Formatters
    const formatISODateToItalian = (iso: string) => {
        const parts = iso.split('-');
        if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
        return iso;
    };

    return (
        <div className="space-y-4">
            {/* INTESTAZIONE & TABS */}
            <div className="bg-brew-dark p-4 rounded-xl border border-brew-border shadow-lg flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <div className="flex items-center gap-2">
                        <span className="p-2 bg-emerald-950/80 border border-emerald-600/50 text-emerald-400 rounded-lg">
                            <CalendarDaysIcon className="w-6 h-6" />
                        </span>
                        <div>
                            <h1 className="text-2xl font-black text-brew-accent tracking-wide flex items-center gap-2">
                                <span>CALENDARIO & PIANIFICAZIONE BIRRIFICIO</span>
                                <span className="text-xs px-2 py-0.5 bg-emerald-800 text-emerald-100 rounded font-bold">PRODUTTIVA</span>
                            </h1>
                            <p className="text-xs text-slate-400 mt-0.5">
                                Cotte future, verifica giacenze malto/luppoli, promemoria cicli CIP, manutenzione pompe e confezionamenti cantina.
                            </p>
                        </div>
                    </div>
                </div>

                {/* TABS DI SELEZIONE VISTA */}
                <div className="flex flex-wrap items-center gap-1.5 bg-brew-dark-secondary p-1 rounded-lg border border-slate-700/60 self-start md:self-auto">
                    <button
                        onClick={() => setActiveTab('CALENDAR')}
                        className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all flex items-center gap-1.5 ${
                            activeTab === 'CALENDAR' 
                                ? 'bg-brew-blue text-white shadow-md' 
                                : 'text-slate-300 hover:text-white hover:bg-slate-800'
                        }`}
                    >
                        <CalendarDaysIcon className="w-4 h-4" />
                        <span>Vista Calendario</span>
                    </button>

                    <button
                        onClick={() => setActiveTab('PLANNED_BREWS')}
                        className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all flex items-center gap-1.5 ${
                            activeTab === 'PLANNED_BREWS' 
                                ? 'bg-orange-600 text-white shadow-md' 
                                : 'text-slate-300 hover:text-white hover:bg-slate-800'
                        }`}
                    >
                        <FireIcon className="w-4 h-4" />
                        <span>Cotte & Fabbisogno ({plannedBrews.length})</span>
                    </button>

                    <button
                        onClick={() => setActiveTab('MAINTENANCE')}
                        className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all flex items-center gap-1.5 ${
                            activeTab === 'MAINTENANCE' 
                                ? 'bg-cyan-700 text-white shadow-md' 
                                : 'text-slate-300 hover:text-white hover:bg-slate-800'
                        }`}
                    >
                        <WrenchIcon className="w-4 h-4" />
                        <span>CIP & Manutenzioni ({maintenancePlans.length})</span>
                    </button>
                </div>
            </div>

            {/* CONTENUTO IN BASE AL TAB ATTIVO */}

            {/* TAB 1: VISTA CALENDARIO MENSILE COMPLETA */}
            {activeTab === 'CALENDAR' && (
                <div className="space-y-4">
                    {/* BARRA CONTROLLI CALENDARIO & FILTRI */}
                    <div className="bg-brew-dark p-3 rounded-xl border border-brew-border shadow flex flex-col md:flex-row md:items-center justify-between gap-3">
                        {/* Selettore Mese/Anno stile Windows */}
                        <div className="flex items-center gap-2">
                            <button
                                onClick={handlePrevMonth}
                                className="p-1.5 bg-brew-dark-secondary hover:bg-slate-700 text-white rounded-lg border border-slate-700 transition-colors"
                                title="Mese precedente"
                            >
                                ◀
                            </button>

                            <button
                                onClick={() => {
                                    if (calendarViewMode === 'DAYS') setCalendarViewMode('MONTHS');
                                    else if (calendarViewMode === 'MONTHS') setCalendarViewMode('YEARS');
                                    else setCalendarViewMode('DAYS');
                                }}
                                className="px-3 py-1 bg-brew-dark-secondary hover:bg-slate-700 text-brew-accent hover:text-yellow-300 font-extrabold text-sm rounded-lg border border-slate-700 transition-colors"
                            >
                                {calendarViewMode === 'DAYS' && `${MONTH_NAMES_IT[currentMonth]} ${currentYear} ▾`}
                                {calendarViewMode === 'MONTHS' && `Anno ${currentYear} ▾`}
                                {calendarViewMode === 'YEARS' && `${currentYear - 6} - ${currentYear + 5}`}
                            </button>

                            <button
                                onClick={handleNextMonth}
                                className="p-1.5 bg-brew-dark-secondary hover:bg-slate-700 text-white rounded-lg border border-slate-700 transition-colors"
                                title="Mese successivo"
                            >
                                ▶
                            </button>

                            <button
                                onClick={handleToday}
                                className="px-2.5 py-1 bg-emerald-900/60 hover:bg-emerald-800 text-emerald-200 border border-emerald-700/60 font-bold text-xs rounded-lg transition-colors ml-1"
                            >
                                Oggi
                            </button>
                        </div>

                        {/* Filtri & Bottoni Rapidi Azione */}
                        <div className="flex flex-wrap items-center gap-2">
                            {loading && (
                                <span className="text-xs text-amber-400 font-bold animate-pulse mr-1">Aggiornamento...</span>
                            )}

                            {/* Filtro Categoria Note */}
                            <select
                                value={filterCategory}
                                onChange={e => setFilterCategory(e.target.value)}
                                className="bg-brew-dark-secondary border border-slate-700 text-xs text-slate-200 rounded-lg px-2 py-1 focus:outline-none"
                            >
                                <option value="ALL">Tutte le categorie</option>
                                {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                                    <option key={k} value={k}>{v.icon} {v.label}</option>
                                ))}
                            </select>

                            {/* Toggle selettivi */}
                            <label className="flex items-center gap-1.5 text-xs text-orange-300 bg-orange-950/40 px-2.5 py-1 rounded-md border border-orange-800/60 cursor-pointer">
                                <input 
                                    type="checkbox" 
                                    checked={showPlannedBrewsOnCalendar} 
                                    onChange={e => setShowPlannedBrewsOnCalendar(e.target.checked)}
                                    className="rounded text-orange-500 focus:ring-0"
                                />
                                <span>🔥 Cotte Future</span>
                            </label>

                            <label className="flex items-center gap-1.5 text-xs text-emerald-300 bg-emerald-950/40 px-2.5 py-1 rounded-md border border-emerald-800/60 cursor-pointer" title="Mostra nel calendario le cotte già eseguite per mantenere la memoria dello storico">
                                <input 
                                    type="checkbox" 
                                    checked={showCompletedBrewsOnCalendar} 
                                    onChange={e => setShowCompletedBrewsOnCalendar(e.target.checked)}
                                    className="rounded text-emerald-500 focus:ring-0"
                                />
                                <span>✅ Storico Cotte Eseguite</span>
                            </label>

                            <label className="flex items-center gap-1.5 text-xs text-cyan-300 bg-cyan-950/40 px-2.5 py-1 rounded-md border border-cyan-800/60 cursor-pointer">
                                <input 
                                    type="checkbox" 
                                    checked={showMaintenanceOnCalendar} 
                                    onChange={e => setShowMaintenanceOnCalendar(e.target.checked)}
                                    className="rounded text-cyan-500 focus:ring-0"
                                />
                                <span>🧪 CIP / Manutenzioni</span>
                            </label>

                            <label className="flex items-center gap-1.5 text-xs text-amber-300 bg-amber-950/40 px-2.5 py-1 rounded-md border border-amber-800/60 cursor-pointer">
                                <input 
                                    type="checkbox" 
                                    checked={showCellarOnCalendar} 
                                    onChange={e => setShowCellarOnCalendar(e.target.checked)}
                                    className="rounded text-amber-500 focus:ring-0"
                                />
                                <span>🍺 Cantina</span>
                            </label>

                            {/* Azioni rapide di inserimento */}
                            <button
                                onClick={() => handleOpenNewNoteModal()}
                                className="px-2.5 py-1 bg-slate-700 hover:bg-slate-600 text-white font-bold text-xs rounded-lg shadow flex items-center gap-1 transition-colors"
                            >
                                <PlusIcon className="w-3.5 h-3.5" />
                                <span>Nota</span>
                            </button>

                            <button
                                onClick={() => handleOpenNewPlannedBrew()}
                                className="px-2.5 py-1 bg-orange-600 hover:bg-orange-500 text-white font-bold text-xs rounded-lg shadow flex items-center gap-1 transition-colors"
                            >
                                <FireIcon className="w-3.5 h-3.5" />
                                <span>Pianifica Cotta</span>
                            </button>

                            <button
                                onClick={() => handleOpenNewMaintenanceModal()}
                                className="px-2.5 py-1 bg-cyan-700 hover:bg-cyan-600 text-white font-bold text-xs rounded-lg shadow flex items-center gap-1 transition-colors"
                            >
                                <WrenchIcon className="w-3.5 h-3.5" />
                                <span>Nuovo CIP/Maint</span>
                            </button>
                        </div>
                    </div>

                    {/* GRIGLIA PRINCIPALE CALENDARIO */}
                    {calendarViewMode === 'DAYS' && (
                        <div className="bg-brew-dark p-3 rounded-xl border border-brew-border shadow-xl">
                            {/* Giorni della settimana */}
                            <div className="grid grid-cols-7 gap-1.5 mb-1.5 text-center font-bold text-xs uppercase text-slate-400">
                                {WEEKDAY_NAMES_IT.map((d, idx) => (
                                    <div key={d} className={`py-1 rounded bg-brew-dark-secondary/60 ${idx >= 5 ? 'text-amber-400' : ''}`}>
                                        {d}
                                    </div>
                                ))}
                            </div>

                            {/* Griglia giorni */}
                            <div className="grid grid-cols-7 gap-1.5">
                                {calendarDays.map((cell) => {
                                    const isToday = cell.isoDate === todayISO;
                                    const dayNotes = notesByDate.get(cell.isoDate) || [];
                                    const dayCellar = cellarByDate.get(cell.isoDate) || [];
                                    const dayBrews = plannedBrewsByDate.get(cell.isoDate) || [];
                                    const dayMaint = maintenanceByDate.get(cell.isoDate) || [];

                                    const totalEvents = dayNotes.length + dayCellar.length + dayBrews.length + dayMaint.length;

                                    return (
                                        <div
                                            key={cell.isoDate}
                                            onClick={() => handleDayClick(cell.isoDate)}
                                            className={`min-h-[110px] sm:min-h-[125px] p-1.5 rounded-lg border transition-all cursor-pointer flex flex-col justify-between group ${
                                                cell.isCurrentMonth 
                                                    ? 'bg-brew-dark-secondary/80 hover:bg-brew-dark-secondary border-slate-700/80 hover:border-brew-accent/80' 
                                                    : 'bg-brew-dark/40 hover:bg-brew-dark/70 border-slate-800/50 text-slate-600 opacity-60'
                                            } ${isToday ? 'ring-2 ring-emerald-500 bg-emerald-950/20' : ''}`}
                                        >
                                            {/* Header Giorno */}
                                            <div className="flex items-center justify-between mb-1">
                                                <span className={`text-xs font-black rounded-md px-1.5 py-0.5 ${
                                                    isToday 
                                                        ? 'bg-emerald-600 text-white' 
                                                        : cell.isCurrentMonth ? 'text-slate-200 group-hover:text-brew-accent' : 'text-slate-600'
                                                }`}>
                                                    {cell.dayNumber}
                                                </span>

                                                {totalEvents > 0 && (
                                                    <span className="text-[10px] px-1 py-0.2 bg-slate-700 text-slate-300 rounded font-semibold">
                                                        {totalEvents}
                                                    </span>
                                                )}
                                            </div>

                                            {/* Eventi Giornalieri */}
                                            <div className="space-y-1 overflow-hidden flex-1">
                                                {/* 1. Cotte Pianificate & Eseguite */}
                                                {dayBrews.map(brew => {
                                                    const isCompleted = brew.status === 'PRODOTTA';
                                                    const stockOk = brew.stockAnalysis?.sufficiente ?? true;
                                                    return (
                                                        <div 
                                                            key={`brew_${brew.id}`}
                                                            className={`p-1 rounded text-[10px] border truncate flex items-center justify-between gap-1 shadow-sm font-bold ${
                                                                isCompleted
                                                                    ? 'bg-emerald-950/80 border-emerald-500/80 text-emerald-200'
                                                                    : stockOk 
                                                                        ? 'bg-orange-950/80 border-orange-600 text-orange-200' 
                                                                        : 'bg-red-950/90 border-red-500 text-red-200 animate-pulse'
                                                            }`}
                                                            title={`Cotta ${isCompleted ? '✓ Eseguita (resta a storico)' : 'Pianificata'}: ${brew.birraNome} (${brew.clienteNome}) ${brew.lottoCreato ? `- Lotto: ${brew.lottoCreato}` : ''} - Clicca sulla casella per contrassegnare eseguita / riaprire`}
                                                        >
                                                            <div className="flex items-center gap-1 truncate">
                                                                <button
                                                                    type="button"
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        handleTogglePlannedBrew(brew);
                                                                    }}
                                                                    className="hover:scale-125 transition-transform flex-shrink-0 cursor-pointer"
                                                                    title={isCompleted ? "Cotta già eseguita nello storico (clicca per riaprire)" : "Spunta come Eseguita per memorizzarla nello storico"}
                                                                >
                                                                    {isCompleted ? '✅' : '⬜'}
                                                                </button>
                                                                <span className={`truncate ${isCompleted ? 'line-through opacity-85 text-emerald-300' : ''}`}>{brew.birraNome}</span>
                                                            </div>
                                                            <span className={`text-[9px] px-1 rounded font-black flex-shrink-0 ${
                                                                isCompleted 
                                                                    ? 'bg-emerald-700 text-white' 
                                                                    : stockOk ? 'bg-emerald-400 text-black' : 'bg-red-500 text-white'
                                                            }`}>
                                                                {isCompleted ? (brew.lottoCreato ? `L.${brew.lottoCreato}` : 'FATTA') : stockOk ? 'OK' : '!'}
                                                            </span>
                                                        </div>
                                                    );
                                                })}

                                                {/* 2. CIP / Sanificazioni & Manutenzioni */}
                                                {dayMaint.map(maint => (
                                                    <div
                                                        key={`maint_${maint.id}`}
                                                        className={`p-1 rounded text-[10px] border truncate flex items-center justify-between gap-1 shadow-sm font-semibold ${
                                                            maint.tipo === 'CIP_SANIFICAZIONE'
                                                                ? 'bg-cyan-950/80 border-cyan-500 text-cyan-200'
                                                                : 'bg-blue-950/80 border-blue-500 text-blue-200'
                                                        }`}
                                                        title={`${maint.tipo === 'CIP_SANIFICAZIONE' ? 'Lavaggio CIP' : 'Manutenzione'}: ${maint.nome} (${maint.apparato})`}
                                                    >
                                                        <div className="flex items-center gap-1 truncate">
                                                            <span>{maint.tipo === 'CIP_SANIFICAZIONE' ? '🧪' : '🔧'}</span>
                                                            <span className="truncate">{maint.apparato}: {maint.nome}</span>
                                                        </div>
                                                    </div>
                                                ))}

                                                {/* 3. Confezionamenti Cantina */}
                                                {dayCellar.map(cellar => (
                                                    <div
                                                        key={`cellar_${cellar.fermentatore}_${cellar.lotto}`}
                                                        className={`p-1 rounded text-[10px] border truncate flex items-center justify-between gap-1 shadow-sm font-semibold ${
                                                            cellar.status === 'alarm'
                                                                ? 'bg-red-950/90 border-red-500 text-red-200 animate-pulse'
                                                                : cellar.status === 'finishing'
                                                                ? 'bg-amber-950/80 border-amber-500 text-amber-200'
                                                                : 'bg-emerald-950/80 border-emerald-600 text-emerald-200'
                                                        }`}
                                                        title={`Confezionamento: ${cellar.fermentatore} - ${cellar.nomeBirra} (${cellar.litriFinali}L)`}
                                                    >
                                                        <div className="flex items-center gap-1 truncate">
                                                            <span>🍺</span>
                                                            <span className="truncate">{cellar.fermentatore} - {cellar.nomeBirra}</span>
                                                        </div>
                                                    </div>
                                                ))}

                                                {/* 4. Note & Promemoria */}
                                                {dayNotes.slice(0, 2).map(n => (
                                                    <div
                                                        key={n.id}
                                                        className={`p-0.5 px-1 rounded text-[10px] border truncate flex items-center justify-between gap-1 ${
                                                            n.completed ? 'opacity-40 line-through bg-slate-800 text-slate-400 border-slate-700' : CATEGORY_LABELS[n.category].color
                                                        }`}
                                                    >
                                                        <span className="truncate">
                                                            {n.time ? `${n.time} ` : ''}{CATEGORY_LABELS[n.category].icon} {n.title}
                                                        </span>
                                                        {n.priority === 'URGENTE' && !n.completed && (
                                                            <span className="w-1.5 h-1.5 rounded-full bg-red-400 flex-shrink-0 animate-ping" />
                                                        )}
                                                    </div>
                                                ))}

                                                {dayNotes.length > 2 && (
                                                    <div className="text-[9px] text-slate-400 text-right pr-1">
                                                        +{dayNotes.length - 2} altri
                                                    </div>
                                                )}
                                            </div>

                                            {/* Indicatore interazione hover */}
                                            <div className="text-[9px] text-slate-500 group-hover:text-slate-300 text-right mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                Clicca per aprire ➔
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* VISTA SELETTORE MESI */}
                    {calendarViewMode === 'MONTHS' && (
                        <div className="bg-brew-dark p-6 rounded-xl border border-brew-border shadow-xl">
                            <h2 className="text-xl font-bold text-brew-accent mb-4 text-center">Seleziona un Mese dell'Anno {currentYear}</h2>
                            <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                                {MONTH_NAMES_IT.map((mName, mIdx) => (
                                    <button
                                        key={mName}
                                        onClick={() => {
                                            setCurrentMonth(mIdx);
                                            setCalendarViewMode('DAYS');
                                        }}
                                        className={`p-4 rounded-xl border text-center font-extrabold text-sm transition-all ${
                                            mIdx === currentMonth 
                                                ? 'bg-brew-blue text-white border-blue-400 shadow-lg scale-105' 
                                                : 'bg-brew-dark-secondary hover:bg-slate-700 text-slate-200 border-slate-700'
                                        }`}
                                    >
                                        {mName}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* VISTA SELETTORE ANNI */}
                    {calendarViewMode === 'YEARS' && (
                        <div className="bg-brew-dark p-6 rounded-xl border border-brew-border shadow-xl">
                            <h2 className="text-xl font-bold text-brew-accent mb-4 text-center">Seleziona un Anno</h2>
                            <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                                {Array.from({ length: 12 }, (_, i) => currentYear - 6 + i).map(yearNum => (
                                    <button
                                        key={yearNum}
                                        onClick={() => {
                                            setCurrentYear(yearNum);
                                            setCalendarViewMode('MONTHS');
                                        }}
                                        className={`p-4 rounded-xl border text-center font-extrabold text-sm transition-all ${
                                            yearNum === currentYear 
                                                ? 'bg-brew-blue text-white border-blue-400 shadow-lg scale-105' 
                                                : 'bg-brew-dark-secondary hover:bg-slate-700 text-slate-200 border-slate-700'
                                        }`}
                                    >
                                        {yearNum}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* TAB 2: PIANIFICAZIONE COTTE FUTURE & ANALISI FABBISOGNO MAGAZZINO */}
            {activeTab === 'PLANNED_BREWS' && (
                <div className="space-y-4">
                    <div className="bg-brew-dark p-4 rounded-xl border border-brew-border shadow flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div>
                            <h2 className="text-xl font-black text-orange-400 flex items-center gap-2">
                                <FireIcon className="w-5 h-5 text-orange-500" />
                                <span>PIANIFICAZIONE COTTE & ANALISI DISPONIBILITÀ MAGAZZINO</span>
                            </h2>
                            <p className="text-xs text-slate-400 mt-0.5">
                                Il gestionale analizza automaticamente la ricetta memorizzata per il cliente e confronta i quantitativi di malto, luppolo e lievito necessari con le giacenze attuali in magazzino.
                            </p>
                        </div>
                        <button
                            onClick={() => handleOpenNewPlannedBrew()}
                            className="px-3.5 py-2 bg-orange-600 hover:bg-orange-500 text-white font-extrabold text-xs rounded-lg shadow-lg flex items-center gap-2 self-start sm:self-auto transition-transform hover:scale-105"
                        >
                            <PlusIcon className="w-4 h-4" />
                            <span>Pianifica Nuova Cotta</span>
                        </button>
                    </div>

                    {/* Filtri stato cotte */}
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs text-slate-400 font-bold uppercase mr-1">Filtra:</span>
                        <button
                            onClick={() => setPlannedBrewsFilter('ALL')}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                                plannedBrewsFilter === 'ALL'
                                    ? 'bg-brew-blue text-white shadow'
                                    : 'bg-brew-dark-secondary hover:bg-slate-700 text-slate-300'
                            }`}
                        >
                            Tutte ({plannedBrews.length})
                        </button>
                        <button
                            onClick={() => setPlannedBrewsFilter('PENDING')}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                                plannedBrewsFilter === 'PENDING'
                                    ? 'bg-orange-600 text-white shadow'
                                    : 'bg-brew-dark-secondary hover:bg-slate-700 text-slate-300'
                            }`}
                        >
                            ⏳ Da Eseguire ({plannedBrews.filter(b => b.status !== 'PRODOTTA').length})
                        </button>
                        <button
                            onClick={() => setPlannedBrewsFilter('COMPLETED')}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                                plannedBrewsFilter === 'COMPLETED'
                                    ? 'bg-emerald-600 text-white shadow'
                                    : 'bg-brew-dark-secondary hover:bg-slate-700 text-slate-300'
                            }`}
                        >
                            ✅ Eseguite / Storico ({plannedBrews.filter(b => b.status === 'PRODOTTA').length})
                        </button>
                    </div>

                    {plannedBrews.length === 0 ? (
                        <div className="bg-brew-dark p-8 rounded-xl border border-brew-border text-center text-slate-400">
                            <FireIcon className="w-12 h-12 mx-auto mb-2 text-orange-500/50" />
                            <p className="font-bold text-slate-300">Nessuna cotta pianificata nel calendario.</p>
                            <p className="text-xs mt-1">Clicca su "Pianifica Nuova Cotta" per fissare a calendario la produzione del prossimo mese con stima del fabbisogno.</p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {plannedBrews
                                .filter(brew => {
                                    if (plannedBrewsFilter === 'PENDING') return brew.status !== 'PRODOTTA';
                                    if (plannedBrewsFilter === 'COMPLETED') return brew.status === 'PRODOTTA';
                                    return true;
                                })
                                .map(brew => {
                                const isCompleted = brew.status === 'PRODOTTA';
                                const stockAnalysis = brew.stockAnalysis;
                                const isOk = isCompleted || (stockAnalysis ? stockAnalysis.sufficiente : true);

                                return (
                                    <div 
                                        key={brew.id}
                                        className={`bg-brew-dark p-4 rounded-xl border-2 transition-all shadow-lg ${
                                            isCompleted
                                                ? 'border-emerald-600/70 bg-emerald-950/20'
                                                : isOk 
                                                    ? 'border-emerald-700/60 bg-emerald-950/10' 
                                                    : 'border-red-600/80 bg-red-950/20'
                                        }`}
                                    >
                                        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-slate-700/60 pb-3">
                                            <div className="flex items-start gap-3">
                                                <input 
                                                    type="checkbox"
                                                    id={`check_tab_brew_${brew.id}`}
                                                    checked={isCompleted}
                                                    onChange={() => handleTogglePlannedBrew(brew)}
                                                    className="mt-1.5 w-5 h-5 rounded text-emerald-500 bg-slate-900 border-slate-600 focus:ring-0 cursor-pointer flex-shrink-0"
                                                    title={isCompleted ? "Cotta già eseguita. Clicca per riaprire come Da Eseguire" : "Spunta la casella per contrassegnare come Eseguita e mantenerla a storico"}
                                                />
                                                <div>
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <span className="px-2 py-0.5 rounded text-xs font-black bg-orange-600 text-white">
                                                            DATA: {formatISODateToItalian(brew.date)}
                                                        </span>
                                                        {isCompleted ? (
                                                            <span className="px-2 py-0.5 rounded text-xs font-black bg-emerald-800 text-emerald-100 flex items-center gap-1 border border-emerald-500/60">
                                                                <span>✅</span> ESEGUITA A STORICO {brew.lottoCreato ? `• Lotto ${brew.lottoCreato}` : ''}
                                                            </span>
                                                        ) : (
                                                            <span className={`px-2 py-0.5 rounded text-xs font-extrabold flex items-center gap-1 ${
                                                                isOk 
                                                                    ? 'bg-emerald-800 text-emerald-100' 
                                                                    : 'bg-red-700 text-white animate-pulse'
                                                            }`}>
                                                                {isOk ? '🟢 TUTTO DISPONIBILE A MAGAZZINO' : '🔴 MANCANZE A MAGAZZINO'}
                                                            </span>
                                                        )}
                                                        {brew.fermentatore && (
                                                            <span className="px-2 py-0.5 rounded text-xs font-bold bg-slate-700 text-slate-200">
                                                                {brew.fermentatore}
                                                            </span>
                                                        )}
                                                    </div>

                                                    <div className="mt-1.5">
                                                        <label htmlFor={`check_tab_brew_${brew.id}`} className={`text-lg font-black cursor-pointer ${isCompleted ? 'text-emerald-300 line-through' : 'text-white'}`}>{brew.birraNome}</label>
                                                        <span className="text-slate-400 text-sm ml-2">Cliente: <strong>{brew.clienteNome}</strong></span>
                                                        <span className="text-amber-400 text-sm ml-3 font-bold">Litri previsti: {brew.litriPrevisti} L</span>
                                                        {brew.lottoCreato && (
                                                            <span className="text-emerald-400 text-xs ml-3 font-mono font-bold">
                                                                Lotto prodotto: {brew.lottoCreato}
                                                            </span>
                                                        )}
                                                    </div>

                                                    {isCompleted && (
                                                        <p className="text-xs text-emerald-400 mt-1 flex items-center gap-1">
                                                            <span>✓</span>
                                                            <span>Cotta memorizzata nello storico del calendario per il giorno {formatISODateToItalian(brew.date)}</span>
                                                        </p>
                                                    )}

                                                    {brew.note && (
                                                        <p className="text-xs text-slate-300 italic mt-1">Note: {brew.note}</p>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Azioni */}
                                            <div className="flex items-center gap-2 self-start lg:self-auto flex-wrap">
                                                <button
                                                    onClick={() => handleTogglePlannedBrew(brew)}
                                                    className={`px-3 py-1.5 font-bold text-xs rounded-lg shadow flex items-center gap-1.5 transition-all ${
                                                        brew.status === 'PRODOTTA'
                                                            ? 'bg-slate-700 hover:bg-slate-600 text-slate-200'
                                                            : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                                                    }`}
                                                    title={brew.status === 'PRODOTTA' ? 'Riapri cotta come Da Eseguire' : 'Segna come eseguita per conservarla nello storico senza cancellarla'}
                                                >
                                                    <span>{brew.status === 'PRODOTTA' ? '↩ Riapri Cotta' : '✓ Segna Eseguita'}</span>
                                                </button>

                                                {isCompleted && (
                                                    <button
                                                        onClick={() => handleOpenLottoLinking(brew)}
                                                        className="px-2.5 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-bold rounded-lg border border-slate-600"
                                                        title="Associa o modifica il numero di lotto prodotto per questa cotta"
                                                    >
                                                        <span>🏷️ {brew.lottoCreato ? `Lotto: ${brew.lottoCreato}` : 'Collega Lotto'}</span>
                                                    </button>
                                                )}

                                                {onNavigateToBrew && (
                                                    <button
                                                        onClick={() => {
                                                            if (brew.lottoCreato && onOpenLotto) {
                                                                onOpenLotto(brew.lottoCreato);
                                                            } else {
                                                                onNavigateToBrew(brew);
                                                            }
                                                        }}
                                                        className="px-3 py-1.5 bg-brew-accent hover:bg-yellow-400 text-brew-dark font-black text-xs rounded-lg shadow flex items-center gap-1.5 transition-transform hover:scale-105"
                                                        title={brew.status === 'PRODOTTA' && brew.lottoCreato ? 'Vedi Foglio Cotta per questo lotto' : 'Avvia Cotta e compila il foglio cotta'}
                                                    >
                                                        <span>{brew.status === 'PRODOTTA' && brew.lottoCreato ? 'Vedi Foglio Cotta' : 'Avvia Cotta'}</span>
                                                        <ArrowRightIcon className="w-4 h-4" />
                                                    </button>
                                                )}

                                                <button
                                                    onClick={() => handleEditPlannedBrew(brew)}
                                                    className="p-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg transition-colors"
                                                    title="Modifica parametri cotta pianificata"
                                                >
                                                    <PencilIcon className="w-4 h-4" />
                                                </button>

                                                <button
                                                    onClick={() => handleDeletePlannedBrew(brew.id)}
                                                    className="p-1.5 bg-red-900/60 hover:bg-red-700 text-red-200 rounded-lg transition-colors"
                                                    title="Elimina dal calendario (Se eseguita, spunta il flag per tenerla a storico invece di cancellarla)"
                                                >
                                                    <TrashIcon className="w-4 h-4" />
                                                </button>
                                            </div>
                                        </div>

                                        {/* DETTAGLIO FABBISOGNO INGREDIENTI RICETTA VS MAGAZZINO */}
                                        <div className="mt-3">
                                            <h4 className="text-xs font-bold uppercase text-slate-400 mb-2 flex items-center justify-between">
                                                <span>Verifica Ingredienti Ricetta in Magazzino</span>
                                                <span className="text-[11px] text-slate-400">
                                                    {stockAnalysis ? `${stockAnalysis.ingredienti.length} ingredienti verificati` : 'Nessuna ricetta associata'}
                                                </span>
                                            </h4>

                                            {!stockAnalysis || stockAnalysis.ingredienti.length === 0 ? (
                                                <p className="text-xs text-slate-400 italic">
                                                    Nessun ingrediente inserito nella ricetta di questa birra nel Database Birre. Modifica la ricetta nel Database Clienti/Birre per abilitare il controllo automatico.
                                                </p>
                                            ) : (
                                                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                                                    {stockAnalysis.ingredienti.map((ing, i) => (
                                                        <div 
                                                            key={i} 
                                                            className={`p-2 rounded-lg border text-xs flex flex-col justify-between ${
                                                                ing.sufficiente 
                                                                    ? 'bg-brew-dark-secondary/80 border-slate-700' 
                                                                    : 'bg-red-950/80 border-red-500 shadow-md'
                                                            }`}
                                                        >
                                                            <div>
                                                                <div className="flex items-center justify-between gap-1">
                                                                    <span className="font-extrabold text-slate-100 truncate">{ing.nome}</span>
                                                                    <span className="text-[10px] text-slate-400">{ing.tipologia}</span>
                                                                </div>
                                                                <div className="mt-1 flex items-center justify-between text-[11px]">
                                                                    <span className="text-slate-400">Richiesti: <strong>{ing.qtaRichiesta} {ing.unitaMisura}</strong></span>
                                                                    <span className={ing.sufficiente ? 'text-emerald-400 font-bold' : 'text-red-300 font-bold'}>
                                                                        Disp: {ing.qtaDisponibile.toFixed(1)}
                                                                    </span>
                                                                </div>
                                                            </div>

                                                            {!ing.sufficiente && (
                                                                <div className="mt-1 pt-1 border-t border-red-700/60 text-red-300 font-extrabold text-[10px] flex items-center justify-between">
                                                                    <span>MANCANO:</span>
                                                                    <span className="text-red-200 bg-red-900 px-1.5 py-0.2 rounded font-black">
                                                                        -{ing.qtaMancante.toFixed(1)} {ing.unitaMisura}
                                                                    </span>
                                                                </div>
                                                            )}
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}

            {/* TAB 3: PROMEMORIA CICLI CIP & MANUTENZIONI PERIODICHE IMPIANTI */}
            {activeTab === 'MAINTENANCE' && (
                <div className="space-y-4">
                    <div className="bg-brew-dark p-4 rounded-xl border border-brew-border shadow flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div>
                            <h2 className="text-xl font-black text-cyan-400 flex items-center gap-2">
                                <SparklesIcon className="w-5 h-5 text-cyan-400" />
                                <span>PROMEMORIA CICLI CIP & MANUTENZIONE IMPIANTI</span>
                            </h2>
                            <p className="text-xs text-slate-400 mt-0.5">
                                Definisci se l'intervento è un lavaggio di sanificazione (CIP) o una manutenzione tecnica sui macchinari/pompe, impostando la scadenza periodica (settimanale, mensile o personalizzata).
                            </p>
                        </div>
                        <button
                            onClick={() => handleOpenNewMaintenanceModal()}
                            className="px-3.5 py-2 bg-cyan-700 hover:bg-cyan-600 text-white font-extrabold text-xs rounded-lg shadow-lg flex items-center gap-2 self-start sm:self-auto transition-transform hover:scale-105"
                        >
                            <PlusIcon className="w-4 h-4" />
                            <span>Nuovo Promemoria Cadenzato</span>
                        </button>
                    </div>

                    {maintenancePlans.length === 0 ? (
                        <div className="bg-brew-dark p-8 rounded-xl border border-brew-border text-center text-slate-400">
                            <WrenchIcon className="w-12 h-12 mx-auto mb-2 text-cyan-500/50" />
                            <p className="font-bold text-slate-300">Nessun piano di sanificazione CIP o manutenzione registrato.</p>
                            <p className="text-xs mt-1">Aggiungi i tuoi macchinari (scambiatore, pompe, fermentatori) con le rispettive scadenze periodiche.</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {maintenancePlans.map(plan => {
                                const isExpired = plan.stato === 'scaduto';
                                const isDueSoon = plan.stato === 'in_scadenza';

                                return (
                                    <div
                                        key={plan.id}
                                        className={`bg-brew-dark p-4 rounded-xl border-2 shadow-lg flex flex-col justify-between ${
                                            isExpired 
                                                ? 'border-red-600 bg-red-950/20' 
                                                : isDueSoon 
                                                ? 'border-yellow-500 bg-yellow-950/20' 
                                                : 'border-slate-700 bg-brew-dark'
                                        }`}
                                    >
                                        <div>
                                            <div className="flex items-center justify-between gap-2 border-b border-slate-700/60 pb-2">
                                                <div className="flex items-center gap-2">
                                                    <span className={`px-2 py-0.5 rounded text-[11px] font-black flex items-center gap-1 ${
                                                        plan.tipo === 'CIP_SANIFICAZIONE'
                                                            ? 'bg-cyan-900 text-cyan-100 border border-cyan-500'
                                                            : 'bg-blue-900 text-blue-100 border border-blue-500'
                                                    }`}>
                                                        {plan.tipo === 'CIP_SANIFICAZIONE' ? '🧪 CIP SANIFICAZIONE' : '🔧 MANUTENZIONE TECNICA'}
                                                    </span>
                                                    <span className="text-xs font-bold text-slate-400">Apparato: <strong>{plan.apparato}</strong></span>
                                                </div>

                                                <span className={`px-2 py-0.5 rounded text-[10px] font-black ${
                                                    isExpired 
                                                        ? 'bg-red-700 text-white animate-pulse' 
                                                        : isDueSoon 
                                                        ? 'bg-yellow-600 text-white font-bold' 
                                                        : 'bg-emerald-800 text-emerald-100'
                                                }`}>
                                                    {isExpired ? 'SCADUTO!' : isDueSoon ? 'IN SCADENZA' : 'REGOLARE'}
                                                </span>
                                            </div>

                                            <div className="mt-2.5">
                                                <h3 className="text-base font-black text-white">{plan.nome}</h3>
                                                <div className="text-xs text-slate-300 mt-1 space-y-0.5">
                                                    <div>Frequenza: <strong>{FREQUENCY_LABELS[plan.frequenza]?.label || `${plan.intervalloGiorni} giorni`}</strong></div>
                                                    <div>Prossima scadenza: <strong className={isExpired ? 'text-red-400 font-bold' : 'text-amber-300'}>{formatISODateToItalian(plan.dataProssimaScadenza)}</strong> {plan.daysRemaining !== undefined && `(${plan.daysRemaining < 0 ? `${Math.abs(plan.daysRemaining)} giorni fa` : `tra ${plan.daysRemaining} giorni`})`}</div>
                                                    {plan.dataUltimaEsecuzione && (
                                                        <div className="text-[11px] text-slate-400">Ultima esecuzione: {formatISODateToItalian(plan.dataUltimaEsecuzione)}</div>
                                                    )}
                                                    {plan.prodottoChimico && (
                                                        <div className="text-[11px] text-cyan-300">Prodotti / Concentrazioni: {plan.prodottoChimico}</div>
                                                    )}
                                                    {plan.noteProcedura && (
                                                        <p className="text-[11px] text-slate-400 italic mt-1 bg-brew-dark-secondary p-1.5 rounded">
                                                            {plan.noteProcedura}
                                                        </p>
                                                    )}
                                                </div>
                                            </div>
                                        </div>

                                        <div className="mt-4 pt-3 border-t border-slate-700/60 flex items-center justify-between gap-2">
                                            <button
                                                onClick={() => handleQuickExecute(plan)}
                                                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs rounded-lg shadow flex items-center gap-1.5 transition-transform hover:scale-105"
                                            >
                                                <CheckIcon className="w-4 h-4" />
                                                <span>Segna come Eseguito Oggi</span>
                                            </button>

                                            <div className="flex items-center gap-1">
                                                <button
                                                    onClick={() => handleEditMaintenancePlan(plan)}
                                                    className="p-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg transition-colors"
                                                    title="Modifica"
                                                >
                                                    <PencilIcon className="w-4 h-4" />
                                                </button>
                                                <button
                                                    onClick={() => handleDeleteMaintenancePlan(plan.id)}
                                                    className="p-1.5 bg-red-900/60 hover:bg-red-700 text-red-200 rounded-lg transition-colors"
                                                    title="Elimina"
                                                >
                                                    <TrashIcon className="w-4 h-4" />
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {/* STORICO INTERVENTI RECENTI */}
                    {maintenanceLogs.length > 0 && (
                        <div className="bg-brew-dark p-4 rounded-xl border border-brew-border shadow mt-6">
                            <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider mb-2">
                                Storico Ultimi Interventi Eseguiti ({maintenanceLogs.length})
                            </h3>
                            <div className="divide-y divide-slate-800 text-xs">
                                {maintenanceLogs.slice(0, 5).map(log => (
                                    <div key={log.id} className="py-2 flex items-center justify-between gap-2">
                                        <div>
                                            <span className="font-bold text-white">{log.planNome}</span>
                                            <span className="text-slate-400 ml-2">({log.apparato})</span>
                                            {log.operatore && <span className="text-amber-400 ml-2">• Operatore: {log.operatore}</span>}
                                            {log.note && <span className="text-slate-400 italic ml-2">• "{log.note}"</span>}
                                        </div>
                                        <span className="text-emerald-400 font-bold flex-shrink-0">
                                            {formatISODateToItalian(log.dataEsecuzione)}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* MODALE DETTAGLIO GIORNO SELEZIONATO */}
            {isDayModalOpen && (
                <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-3">
                    <div className="bg-brew-dark border-2 border-brew-accent rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-5 shadow-2xl space-y-4">
                        <div className="flex items-center justify-between border-b border-slate-700 pb-3">
                            <div className="flex items-center gap-2.5">
                                <span className="p-2 bg-emerald-900/60 text-emerald-400 rounded-lg">
                                    <CalendarDaysIcon className="w-5 h-5" />
                                </span>
                                <div>
                                    <h3 className="text-lg font-black text-brew-accent">
                                        Attività del {formatISODateToItalian(selectedDateISO)}
                                    </h3>
                                    <p className="text-xs text-slate-400">Tutti gli eventi, cotte, cantina e promemoria per questa giornata</p>
                                </div>
                            </div>
                            <button 
                                onClick={() => setIsDayModalOpen(false)}
                                className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800"
                            >
                                <XMarkIcon className="w-5 h-5" />
                            </button>
                        </div>

                        {/* Pulsanti rapidi di aggiunta per questo giorno */}
                        <div className="flex flex-wrap items-center gap-2 pt-1">
                            <button
                                onClick={() => {
                                    setIsDayModalOpen(false);
                                    handleOpenNewNoteModal(selectedDateISO);
                                }}
                                className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-bold text-xs flex items-center gap-1"
                            >
                                <PlusIcon className="w-4 h-4" />
                                <span>Aggiungi Nota</span>
                            </button>

                            <button
                                onClick={() => {
                                    setIsDayModalOpen(false);
                                    handleOpenNewPlannedBrew(selectedDateISO);
                                }}
                                className="px-3 py-1.5 bg-orange-600 hover:bg-orange-500 text-white rounded-lg font-bold text-xs flex items-center gap-1"
                            >
                                <FireIcon className="w-4 h-4" />
                                <span>Pianifica Cotta per Oggi</span>
                            </button>

                            <button
                                onClick={() => {
                                    setIsDayModalOpen(false);
                                    handleOpenNewMaintenanceModal(selectedDateISO);
                                }}
                                className="px-3 py-1.5 bg-cyan-700 hover:bg-cyan-600 text-white rounded-lg font-bold text-xs flex items-center gap-1"
                            >
                                <WrenchIcon className="w-4 h-4" />
                                <span>Pianifica CIP/Maint</span>
                            </button>
                        </div>

                        {/* CONTENUTI DEL GIORNO */}
                        <div className="space-y-4 pt-2">
                            {/* Cotte Pianificate */}
                            {selectedDayBrews.length > 0 && (
                                <div className="space-y-2">
                                    <h4 className="text-xs font-bold uppercase text-orange-400 flex items-center gap-1.5">
                                        <span>🔥</span> Cotte del Giorno ({selectedDayBrews.length})
                                    </h4>
                                    {selectedDayBrews.map(b => {
                                        const isCompleted = b.status === 'PRODOTTA';
                                        return (
                                            <div 
                                                key={b.id} 
                                                className={`p-3 rounded-lg border flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                                                    isCompleted 
                                                        ? 'bg-emerald-950/30 border-emerald-600/70' 
                                                        : 'bg-brew-dark-secondary border-orange-500/50'
                                                }`}
                                            >
                                                <div className="flex items-start gap-3">
                                                    <input 
                                                        type="checkbox"
                                                        id={`check_daymodal_brew_${b.id}`}
                                                        checked={isCompleted}
                                                        onChange={() => handleTogglePlannedBrew(b)}
                                                        className="mt-1 w-5 h-5 rounded text-emerald-500 bg-slate-900 border-slate-600 focus:ring-0 cursor-pointer flex-shrink-0"
                                                        title={isCompleted ? "Cotta già eseguita. Clicca per riaprire come Da Eseguire" : "Spunta la casella per contrassegnare la cotta come Eseguita e mantenerla a storico"}
                                                    />
                                                    <div>
                                                        <div className="flex items-center gap-2 flex-wrap">
                                                            <label htmlFor={`check_daymodal_brew_${b.id}`} className={`font-extrabold text-sm cursor-pointer ${isCompleted ? 'text-emerald-300 line-through' : 'text-white'}`}>
                                                                {b.birraNome}
                                                            </label>
                                                            {isCompleted ? (
                                                                <span className="px-2 py-0.5 bg-emerald-900/80 border border-emerald-500 text-emerald-300 font-extrabold text-[10px] rounded-full flex items-center gap-1">
                                                                    <span>✅</span> ESEGUITA A STORICO {b.lottoCreato ? `• Lotto ${b.lottoCreato}` : ''}
                                                                </span>
                                                            ) : (
                                                                <span className="px-2 py-0.5 bg-orange-950/80 border border-orange-600 text-orange-300 font-bold text-[10px] rounded-full">
                                                                    ⏳ DA ESEGUIRE
                                                                </span>
                                                            )}
                                                            {b.fermentatore && (
                                                                <span className="px-1.5 py-0.5 bg-slate-700 text-slate-300 text-[10px] rounded font-semibold">
                                                                    {b.fermentatore}
                                                                </span>
                                                            )}
                                                        </div>
                                                        <div className="text-xs text-slate-300 mt-0.5">
                                                            Cliente: <strong>{b.clienteNome}</strong> • Litri: <strong>{b.litriPrevisti} L</strong>
                                                            {b.lottoCreato && <span className="text-emerald-400 font-mono font-bold ml-2">• Lotto: {b.lottoCreato}</span>}
                                                        </div>
                                                        {isCompleted && (
                                                            <div className="text-[11px] text-emerald-400 mt-0.5 flex items-center gap-1">
                                                                <span>✓</span>
                                                                <span>Memorizzata nello storico delle attività svolte per il {formatISODateToItalian(b.date)}</span>
                                                            </div>
                                                        )}
                                                        {b.stockAnalysis && !isCompleted && (
                                                            <div className={`text-xs mt-1 font-bold ${b.stockAnalysis.sufficiente ? 'text-emerald-400' : 'text-red-400'}`}>
                                                                {b.stockAnalysis.sufficiente ? '🟢 Materie prime a magazzino: OK' : `🔴 Mancano ingredienti: ${b.stockAnalysis.dettaglioMancanti.join(', ')}`}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>

                                                <div className="flex items-center gap-2 self-start sm:self-auto flex-wrap">
                                                    <button
                                                        onClick={() => handleTogglePlannedBrew(b)}
                                                        className={`px-2.5 py-1 font-bold text-xs rounded-lg shadow flex items-center gap-1 transition-all ${
                                                            isCompleted
                                                                ? 'bg-slate-700 hover:bg-slate-600 text-slate-200'
                                                                : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                                                        }`}
                                                        title={isCompleted ? 'Riapri cotta come Da Eseguire' : 'Segna come eseguita per conservarla nello storico del calendario'}
                                                    >
                                                        <span>{isCompleted ? '↩ Riapri' : '✓ Segna Eseguita'}</span>
                                                    </button>

                                                    {isCompleted && (
                                                        <button
                                                            onClick={() => handleOpenLottoLinking(b)}
                                                            className="px-2 py-1 bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-semibold rounded-lg border border-slate-600"
                                                            title="Associa o modifica il numero di lotto prodotto per questa cotta"
                                                        >
                                                            <span>🏷️ {b.lottoCreato ? `Lotto: ${b.lottoCreato}` : 'Collega Lotto'}</span>
                                                        </button>
                                                    )}

                                                    {onNavigateToBrew && (
                                                        <button
                                                            onClick={() => {
                                                                setIsDayModalOpen(false);
                                                                if (b.lottoCreato && onOpenLotto) {
                                                                    onOpenLotto(b.lottoCreato);
                                                                } else {
                                                                    onNavigateToBrew(b);
                                                                }
                                                            }}
                                                            className="px-2.5 py-1 bg-brew-accent hover:bg-yellow-400 text-brew-dark font-black text-xs rounded shadow flex items-center gap-1"
                                                            title={isCompleted && b.lottoCreato ? 'Vedi Foglio Cotta per questo lotto' : 'Avvia Cotta e apri foglio cotta'}
                                                        >
                                                            <span>{isCompleted && b.lottoCreato ? 'Vedi Foglio Cotta' : 'Avvia Cotta'}</span>
                                                            <ArrowRightIcon className="w-3.5 h-3.5" />
                                                        </button>
                                                    )}

                                                    <button
                                                        onClick={() => {
                                                            setIsDayModalOpen(false);
                                                            handleEditPlannedBrew(b);
                                                        }}
                                                        className="p-1 text-slate-400 hover:text-white"
                                                        title="Modifica parametri"
                                                    >
                                                        <PencilIcon className="w-4 h-4" />
                                                    </button>

                                                    <button
                                                        onClick={() => handleDeletePlannedBrew(b.id)}
                                                        className="p-1 text-red-400 hover:text-red-200"
                                                        title="Elimina dal calendario (Se eseguita, spunta il flag per conservarla a storico invece di cancellarla)"
                                                    >
                                                        <TrashIcon className="w-4 h-4" />
                                                    </button>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}

                            {/* CIP & Manutenzioni */}
                            {selectedDayMaint.length > 0 && (
                                <div className="space-y-2">
                                    <h4 className="text-xs font-bold uppercase text-cyan-400 flex items-center gap-1.5">
                                        <span>🧪</span> CIP & Manutenzioni in Scadenza ({selectedDayMaint.length})
                                    </h4>
                                    {selectedDayMaint.map(m => (
                                        <div key={m.id} className="p-3 bg-brew-dark-secondary rounded-lg border border-cyan-500/50 flex items-center justify-between gap-2">
                                            <div>
                                                <div className="font-extrabold text-white text-sm">{m.nome}</div>
                                                <div className="text-xs text-slate-300">Apparato: <strong>{m.apparato}</strong> • Tipo: {m.tipo === 'CIP_SANIFICAZIONE' ? 'Lavaggio CIP' : 'Manutenzione Tecnica'}</div>
                                            </div>
                                            <button
                                                onClick={() => {
                                                    setIsDayModalOpen(false);
                                                    handleQuickExecute(m);
                                                }}
                                                className="px-2.5 py-1 bg-emerald-600 text-white font-bold text-xs rounded shadow"
                                            >
                                                Segna Eseguito
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* Confezionamenti Cantina */}
                            {selectedDayCellar.length > 0 && (
                                <div className="space-y-2">
                                    <h4 className="text-xs font-bold uppercase text-amber-400 flex items-center gap-1.5">
                                        <span>🍺</span> Confezionamenti Cantina Previsti ({selectedDayCellar.length})
                                    </h4>
                                    {selectedDayCellar.map(c => (
                                        <div key={`${c.fermentatore}_${c.lotto}`} className="p-3 bg-brew-dark-secondary rounded-lg border border-amber-500/50 flex items-center justify-between gap-2">
                                            <div>
                                                <div className="font-extrabold text-white text-sm">{c.fermentatore}: {c.nomeBirra} (Lotto {c.lotto})</div>
                                                <div className="text-xs text-slate-300">Cliente: <strong>{c.cliente}</strong> • Litri da confezionare: <strong>{c.litriFinali} L</strong></div>
                                            </div>
                                            <div className="flex items-center gap-1.5 flex-shrink-0">
                                                {onOpenLotto && (
                                                    <button
                                                        onClick={() => {
                                                            setIsDayModalOpen(false);
                                                            onOpenLotto(c.lotto);
                                                        }}
                                                        className="px-2.5 py-1 bg-slate-700 hover:bg-slate-600 text-white font-bold text-xs rounded shadow"
                                                    >
                                                        Cotta
                                                    </button>
                                                )}
                                                {onNavigateToCantina && (
                                                    <button
                                                        onClick={() => {
                                                            setIsDayModalOpen(false);
                                                            onNavigateToCantina();
                                                        }}
                                                        className="px-2.5 py-1 bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs rounded shadow"
                                                    >
                                                        Cantina
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* Note e Appunti */}
                            <div className="space-y-2">
                                <h4 className="text-xs font-bold uppercase text-slate-400 flex items-center gap-1.5">
                                    <span>📝</span> Note & Appunti ({selectedDayNotes.length})
                                </h4>
                                {selectedDayNotes.length === 0 ? (
                                    <p className="text-xs text-slate-500 italic">Nessun appunto personale scritto per questo giorno.</p>
                                ) : (
                                    selectedDayNotes.map(n => (
                                        <div key={n.id} className="p-3 bg-brew-dark-secondary rounded-lg border border-slate-700 flex items-center justify-between gap-2">
                                            <div className="flex items-start gap-2">
                                                <input 
                                                    type="checkbox" 
                                                    checked={n.completed} 
                                                    onChange={() => handleToggleNote(n.id)}
                                                    className="mt-1 rounded text-emerald-500 focus:ring-0"
                                                />
                                                <div>
                                                    <div className={`font-bold text-sm ${n.completed ? 'line-through text-slate-400' : 'text-white'}`}>
                                                        {n.time && <span className="text-amber-400 mr-1.5">{n.time}</span>}
                                                        {n.title}
                                                    </div>
                                                    {n.description && (
                                                        <p className="text-xs text-slate-300 mt-0.5">{n.description}</p>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-1">
                                                <button onClick={() => { setIsDayModalOpen(false); handleEditNote(n); }} className="p-1 text-slate-400 hover:text-white">
                                                    <PencilIcon className="w-4 h-4" />
                                                </button>
                                                <button onClick={() => handleDeleteNote(n.id)} className="p-1 text-red-400 hover:text-red-200">
                                                    <TrashIcon className="w-4 h-4" />
                                                </button>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* MODALE PIANIFICAZIONE COTTA & ANALISI MAGAZZINO */}
            {isPlannedBrewModalOpen && (
                <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-3">
                    <div className="bg-brew-dark border-2 border-orange-500 rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-5 shadow-2xl space-y-4">
                        <div className="flex items-center justify-between border-b border-slate-700 pb-3">
                            <h3 className="text-lg font-black text-orange-400 flex items-center gap-2">
                                <FireIcon className="w-5 h-5 text-orange-500" />
                                <span>{editingPlannedBrew ? 'Modifica Cotta Pianificata' : 'Pianifica Nuova Cotta a Calendario'}</span>
                            </h3>
                            <button onClick={() => setIsPlannedBrewModalOpen(false)} className="text-slate-400 hover:text-white">
                                <XMarkIcon className="w-5 h-5" />
                            </button>
                        </div>

                        <form onSubmit={handleSavePlannedBrew} className="space-y-4">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-bold text-slate-300 mb-1">Cliente *</label>
                                    <select
                                        value={formBrewClienteId}
                                        onChange={e => {
                                            setFormBrewClienteId(e.target.value);
                                            setFormBrewBirraId('');
                                        }}
                                        required
                                        className="w-full bg-brew-dark-secondary border border-slate-700 rounded-lg p-2 text-sm text-white focus:border-orange-500 focus:outline-none"
                                    >
                                        <option value="">Seleziona cliente...</option>
                                        {clienti.map(c => (
                                            <option key={c.id} value={c.id}>{c.nome}</option>
                                        ))}
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-xs font-bold text-slate-300 mb-1">Birra da Produrre *</label>
                                    <select
                                        value={formBrewBirraId}
                                        onChange={e => setFormBrewBirraId(e.target.value)}
                                        required
                                        disabled={!formBrewClienteId}
                                        className="w-full bg-brew-dark-secondary border border-slate-700 rounded-lg p-2 text-sm text-white focus:border-orange-500 focus:outline-none disabled:opacity-50"
                                    >
                                        <option value="">Seleziona birra...</option>
                                        {birreClienteForm.map(b => (
                                            <option key={b.id} value={b.id}>{b.nomeBirra} ({b.tipologia})</option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                <div>
                                    <label className="block text-xs font-bold text-slate-300 mb-1">Data Cotta Prevista *</label>
                                    <input
                                        type="date"
                                        value={formBrewDate}
                                        onChange={e => setFormBrewDate(e.target.value)}
                                        required
                                        className="w-full bg-brew-dark-secondary border border-slate-700 rounded-lg p-2 text-sm text-white focus:border-orange-500 focus:outline-none"
                                    />
                                </div>

                                <div>
                                    <label className="block text-xs font-bold text-slate-300 mb-1">Litri Previsti *</label>
                                    <input
                                        type="number"
                                        value={formBrewLitri}
                                        onChange={e => setFormBrewLitri(Math.max(1, parseInt(e.target.value) || 0))}
                                        required
                                        className="w-full bg-brew-dark-secondary border border-slate-700 rounded-lg p-2 text-sm text-white focus:border-orange-500 focus:outline-none"
                                    />
                                </div>

                                <div>
                                    <label className="block text-xs font-bold text-slate-300 mb-1">Fermentatore Previsto</label>
                                    <select
                                        value={formBrewFermentatore}
                                        onChange={e => setFormBrewFermentatore(e.target.value)}
                                        className="w-full bg-brew-dark-secondary border border-slate-700 rounded-lg p-2 text-sm text-white focus:border-orange-500 focus:outline-none"
                                    >
                                        <option value="">Da definire...</option>
                                        {cantinaConfig.map(f => (
                                            <option key={f.id} value={f.nome}>{f.nome} ({f.capacita}L)</option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-300 mb-1">Note Cotta</label>
                                <textarea
                                    value={formBrewNote}
                                    onChange={e => setFormBrewNote(e.target.value)}
                                    rows={2}
                                    placeholder="Es. Note speciali ammostamento, lievito da propagare o recuperare..."
                                    className="w-full bg-brew-dark-secondary border border-slate-700 rounded-lg p-2 text-sm text-white focus:border-orange-500 focus:outline-none"
                                />
                            </div>

                            {/* Stato Avanzamento Cotta & Storico */}
                            <div className="p-3 bg-brew-dark-secondary rounded-xl border border-slate-700 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                <div>
                                    <label className="text-xs font-bold text-slate-200 block">Stato Cotta nel Calendario</label>
                                    <span className="text-[11px] text-slate-400">Contrassegna come eseguita per conservare il giorno lavorato a storico senza cancellarlo</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setFormBrewStatus(s => s === 'PRODOTTA' ? 'PIANIFICATA' : 'PRODOTTA')}
                                        className={`px-3 py-1.5 rounded-lg text-xs font-black flex items-center gap-1.5 transition-all ${
                                            formBrewStatus === 'PRODOTTA'
                                                ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow'
                                                : 'bg-slate-700 hover:bg-slate-600 text-slate-300'
                                        }`}
                                    >
                                        <span>{formBrewStatus === 'PRODOTTA' ? '✅ Cotta Eseguita (a storico)' : '⏳ In Programma / Da Fare'}</span>
                                    </button>
                                </div>
                            </div>

                            {formBrewStatus === 'PRODOTTA' && (
                                <div>
                                    <label className="block text-xs font-bold text-emerald-400 mb-1">Codice Lotto Cotta Prodotto (Opzionale)</label>
                                    <input
                                        type="text"
                                        value={formBrewLotto}
                                        onChange={e => setFormBrewLotto(e.target.value.toUpperCase())}
                                        placeholder="Es. 26-15 o PILS-02"
                                        className="w-full bg-brew-dark-secondary border border-emerald-600/70 rounded-lg p-2 text-sm text-white focus:border-emerald-400 focus:outline-none"
                                    />
                                </div>
                            )}

                            {/* ANALISI IN TEMPO REALE RICETTA & MAGAZZINO */}
                            {selectedBirraForm && liveStockAnalysis && (
                                <div className="p-3 bg-brew-dark-secondary rounded-xl border border-slate-700 space-y-2">
                                    <div className="flex items-center justify-between">
                                        <h4 className="text-xs font-bold uppercase text-slate-300">
                                            Analisi Giacenze Magazzino (Ricetta {selectedBirraForm.nomeBirra})
                                        </h4>
                                        <span className={`px-2 py-0.5 rounded text-xs font-extrabold ${
                                            liveStockAnalysis.sufficiente 
                                                ? 'bg-emerald-800 text-emerald-100' 
                                                : 'bg-red-800 text-red-100 animate-pulse'
                                        }`}>
                                            {liveStockAnalysis.sufficiente ? '🟢 DISPONIBILITÀ COMPLETA' : `🔴 MANCANO ${liveStockAnalysis.mancantiCount} INGREDIENTI`}
                                        </span>
                                    </div>

                                    {liveStockAnalysis.ingredienti.length === 0 ? (
                                        <p className="text-xs text-slate-400 italic">
                                            Nessun ingrediente inserito nella ricetta di questa birra nel Database.
                                        </p>
                                    ) : (
                                        <div className="max-h-40 overflow-y-auto space-y-1 pr-1 text-xs">
                                            {liveStockAnalysis.ingredienti.map((ing, i) => (
                                                <div key={i} className="flex items-center justify-between p-1.5 rounded bg-brew-dark/60 border border-slate-700">
                                                    <div>
                                                        <span className="font-bold text-white">{ing.nome}</span>
                                                        <span className="text-[10px] text-slate-400 ml-2">({ing.tipologia})</span>
                                                    </div>
                                                    <div className="flex items-center gap-3">
                                                        <span>Richiesti: <strong>{ing.qtaRichiesta} {ing.unitaMisura}</strong></span>
                                                        <span className={ing.sufficiente ? 'text-emerald-400 font-bold' : 'text-red-400 font-bold'}>
                                                            Giacenza: {ing.qtaDisponibile.toFixed(1)} {ing.unitaMisura}
                                                        </span>
                                                        {!ing.sufficiente && (
                                                            <span className="px-1.5 py-0.2 bg-red-900 text-red-200 rounded font-black text-[10px]">
                                                                Mancano: {ing.qtaMancante.toFixed(1)}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}

                            <div className="flex justify-end gap-2 pt-2 border-t border-slate-700">
                                <button
                                    type="button"
                                    onClick={() => setIsPlannedBrewModalOpen(false)}
                                    className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-xs font-bold"
                                >
                                    Annulla
                                </button>
                                <button
                                    type="submit"
                                    className="px-4 py-2 bg-orange-600 hover:bg-orange-500 text-white rounded-lg text-xs font-extrabold shadow-lg"
                                >
                                    Salva Cotta a Calendario
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* MODALE PIANO CIP / SANIFICAZIONE / MANUTENZIONE */}
            {isMaintenanceModalOpen && (
                <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-3">
                    <div className="bg-brew-dark border-2 border-cyan-500 rounded-2xl max-w-xl w-full max-h-[90vh] overflow-y-auto p-5 shadow-2xl space-y-4">
                        <div className="flex items-center justify-between border-b border-slate-700 pb-3">
                            <h3 className="text-lg font-black text-cyan-400 flex items-center gap-2">
                                <WrenchIcon className="w-5 h-5 text-cyan-400" />
                                <span>{editingMaintenancePlan ? 'Modifica Piano Manutenzione/CIP' : 'Nuovo Promemoria Cadenzato Manutenzione/CIP'}</span>
                            </h3>
                            <button onClick={() => setIsMaintenanceModalOpen(false)} className="text-slate-400 hover:text-white">
                                <XMarkIcon className="w-5 h-5" />
                            </button>
                        </div>

                        <form onSubmit={handleSaveMaintenancePlan} className="space-y-4">
                            {/* Selezione Tipo Intervento */}
                            <div>
                                <label className="block text-xs font-bold text-slate-300 mb-1">Tipo di Intervento *</label>
                                <div className="grid grid-cols-2 gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setFormMaintTipo('CIP_SANIFICAZIONE')}
                                        className={`p-2.5 rounded-lg border text-xs font-extrabold flex items-center justify-center gap-2 transition-all ${
                                            formMaintTipo === 'CIP_SANIFICAZIONE'
                                                ? 'bg-cyan-900 border-cyan-400 text-white shadow-lg ring-1 ring-cyan-400'
                                                : 'bg-brew-dark-secondary border-slate-700 text-slate-400 hover:text-white'
                                        }`}
                                    >
                                        <span>🧪</span>
                                        <span>Lavaggio / Ciclo CIP</span>
                                    </button>

                                    <button
                                        type="button"
                                        onClick={() => setFormMaintTipo('MANUTENZIONE_TECNICA')}
                                        className={`p-2.5 rounded-lg border text-xs font-extrabold flex items-center justify-center gap-2 transition-all ${
                                            formMaintTipo === 'MANUTENZIONE_TECNICA'
                                                ? 'bg-blue-900 border-blue-400 text-white shadow-lg ring-1 ring-blue-400'
                                                : 'bg-brew-dark-secondary border-slate-700 text-slate-400 hover:text-white'
                                        }`}
                                    >
                                        <span>🔧</span>
                                        <span>Manutenzione Tecnica Macchinari & Pompe</span>
                                    </button>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-bold text-slate-300 mb-1">Nome / Titolo Intervento *</label>
                                    <input
                                        type="text"
                                        value={formMaintNome}
                                        onChange={e => setFormMaintNome(e.target.value)}
                                        placeholder={formMaintTipo === 'CIP_SANIFICAZIONE' ? 'Es. CIP Settimanale Scambiatore' : 'Es. Controllo Giranti e Tenute Meccaniche'}
                                        required
                                        className="w-full bg-brew-dark-secondary border border-slate-700 rounded-lg p-2 text-sm text-white focus:border-cyan-500 focus:outline-none"
                                    />
                                </div>

                                <div>
                                    <label className="block text-xs font-bold text-slate-300 mb-1">Apparato / Attrezzatura *</label>
                                    <select
                                        value={formMaintApparato}
                                        onChange={e => setFormMaintApparato(e.target.value)}
                                        className="w-full bg-brew-dark-secondary border border-slate-700 rounded-lg p-2 text-sm text-white focus:border-cyan-500 focus:outline-none"
                                    >
                                        <option value="Scambiatore a Piastre">Scambiatore a Piastre</option>
                                        <option value="Pompe Carrellate / Giranti">Pompe Carrellate / Giranti</option>
                                        <option value="Sala Cotte (Tini / Caldaia)">Sala Cotte (Tini / Caldaia)</option>
                                        <option value="Fermentatori & Serbatoi">Fermentatori & Serbatoi</option>
                                        <option value="Gruppo Frigo / Circuito Glicole">Gruppo Frigo / Circuito Glicole</option>
                                        <option value="Imbottigliatrice / Infustatrice">Imbottigliatrice / Infustatrice</option>
                                        <option value="Compressore / Impianto Aria & Azoto">Compressore / Impianto Aria & Azoto</option>
                                        <option value="Altro Impianto">Altro Impianto</option>
                                    </select>
                                </div>
                            </div>

                            {/* Cadenza / Frequenza Periodica */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-bold text-slate-300 mb-1">Cadenza / Frequenza Scadenza *</label>
                                    <select
                                        value={formMaintFrequenza}
                                        onChange={e => handleFrequencyChange(e.target.value as MaintenanceFrequency)}
                                        className="w-full bg-brew-dark-secondary border border-slate-700 rounded-lg p-2 text-sm text-white focus:border-cyan-500 focus:outline-none"
                                    >
                                        {Object.entries(FREQUENCY_LABELS).map(([k, v]) => (
                                            <option key={k} value={k}>{v.label}</option>
                                        ))}
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-xs font-bold text-slate-300 mb-1">
                                        Intervallo Giorni {formMaintFrequenza === 'PERSONALIZZATA' && '(stabilito da te)'} *
                                    </label>
                                    <input
                                        type="number"
                                        value={formMaintIntervalloGiorni}
                                        onChange={e => setFormMaintIntervalloGiorni(Math.max(1, parseInt(e.target.value) || 1))}
                                        required
                                        className="w-full bg-brew-dark-secondary border border-slate-700 rounded-lg p-2 text-sm text-white focus:border-cyan-500 focus:outline-none"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-300 mb-1">Prossima Data di Scadenza a Calendario *</label>
                                <input
                                    type="date"
                                    value={formMaintProssimaData}
                                    onChange={e => setFormMaintProssimaData(e.target.value)}
                                    required
                                    className="w-full bg-brew-dark-secondary border border-slate-700 rounded-lg p-2 text-sm text-white focus:border-cyan-500 focus:outline-none"
                                />
                            </div>

                            {formMaintTipo === 'CIP_SANIFICAZIONE' && (
                                <div>
                                    <label className="block text-xs font-bold text-slate-300 mb-1">Prodotti Chimici / Concentrazioni</label>
                                    <input
                                        type="text"
                                        value={formMaintProdottoChimico}
                                        onChange={e => setFormMaintProdottoChimico(e.target.value)}
                                        placeholder="Es. Soda Caustica 2% a 75°C per 40 min, Acido Peracetico 0.5%"
                                        className="w-full bg-brew-dark-secondary border border-slate-700 rounded-lg p-2 text-sm text-white focus:border-cyan-500 focus:outline-none"
                                    />
                                </div>
                            )}

                            <div>
                                <label className="block text-xs font-bold text-slate-300 mb-1">Note Procedura / Checklist</label>
                                <textarea
                                    value={formMaintProcedura}
                                    onChange={e => setFormMaintProcedura(e.target.value)}
                                    rows={2}
                                    placeholder="Istruzioni per l'operatore, punti critici da ispezionare, temperature, ecc."
                                    className="w-full bg-brew-dark-secondary border border-slate-700 rounded-lg p-2 text-sm text-white focus:border-cyan-500 focus:outline-none"
                                />
                            </div>

                            <div className="flex justify-end gap-2 pt-2 border-t border-slate-700">
                                <button
                                    type="button"
                                    onClick={() => setIsMaintenanceModalOpen(false)}
                                    className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-xs font-bold"
                                >
                                    Annulla
                                </button>
                                <button
                                    type="submit"
                                    className="px-4 py-2 bg-cyan-700 hover:bg-cyan-600 text-white rounded-lg text-xs font-extrabold shadow-lg"
                                >
                                    Salva Promemoria a Calendario
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* MODALE CONFERMA ESECUZIONE MANUTENZIONE RAPIDA */}
            {executingPlan && (
                <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-3">
                    <div className="bg-brew-dark border-2 border-emerald-500 rounded-2xl max-w-md w-full p-5 shadow-2xl space-y-4">
                        <div className="flex items-center justify-between border-b border-slate-700 pb-2">
                            <h3 className="text-base font-black text-emerald-400 flex items-center gap-2">
                                <CheckIcon className="w-5 h-5 text-emerald-400" />
                                <span>Registra Intervento Eseguito</span>
                            </h3>
                            <button onClick={() => setExecutingPlan(null)} className="text-slate-400 hover:text-white">
                                <XMarkIcon className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="bg-brew-dark-secondary p-3 rounded-lg border border-slate-700 text-xs">
                            <div className="font-bold text-white text-sm">{executingPlan.nome}</div>
                            <div className="text-slate-400 mt-0.5">Apparato: <strong>{executingPlan.apparato}</strong></div>
                            <div className="text-slate-400">Cadenza: <strong>ogni {executingPlan.intervalloGiorni} giorni</strong></div>
                        </div>

                        <div className="space-y-3">
                            <div>
                                <label className="block text-xs font-bold text-slate-300 mb-1">Nome Operatore</label>
                                <input
                                    type="text"
                                    value={execOperatore}
                                    onChange={e => setExecOperatore(e.target.value)}
                                    placeholder="Es. Mario Rossi"
                                    className="w-full bg-brew-dark-secondary border border-slate-700 rounded-lg p-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-300 mb-1">Note Esecuzione</label>
                                <input
                                    type="text"
                                    value={execNote}
                                    onChange={e => setExecNote(e.target.value)}
                                    placeholder="Es. Sostituita guarnizione clamp 1.5 pollici, tenuta perfetta"
                                    className="w-full bg-brew-dark-secondary border border-slate-700 rounded-lg p-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
                                />
                            </div>
                        </div>

                        <div className="flex justify-end gap-2 pt-2 border-t border-slate-700">
                            <button
                                type="button"
                                onClick={() => setExecutingPlan(null)}
                                className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-xs font-bold"
                            >
                                Annulla
                            </button>
                            <button
                                type="button"
                                onClick={handleConfirmExecution}
                                className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-extrabold shadow-lg"
                            >
                                Conferma & Ricalcola Prossima Scadenza
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* MODALE CREAZIONE / MODIFICA NOTA O APPUNTO */}
            {isNoteModalOpen && (
                <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-3">
                    <div className="bg-brew-dark border-2 border-brew-accent rounded-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-5 shadow-2xl space-y-4">
                        <div className="flex items-center justify-between border-b border-slate-700 pb-2">
                            <h3 className="text-base font-black text-brew-accent">
                                {editingNote ? 'Modifica Appunto' : 'Nuovo Appunto a Calendario'}
                            </h3>
                            <button onClick={() => setIsNoteModalOpen(false)} className="text-slate-400 hover:text-white">
                                <XMarkIcon className="w-5 h-5" />
                            </button>
                        </div>

                        <form onSubmit={handleSaveNote} className="space-y-3">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-bold text-slate-300 mb-1">Data *</label>
                                    <input
                                        type="date"
                                        value={formNoteDate}
                                        onChange={e => setFormNoteDate(e.target.value)}
                                        required
                                        className="w-full bg-brew-dark-secondary border border-slate-700 rounded-lg p-2 text-sm text-white focus:border-brew-accent focus:outline-none"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-300 mb-1">Orario (opzionale)</label>
                                    <input
                                        type="time"
                                        value={formNoteTime}
                                        onChange={e => setFormNoteTime(e.target.value)}
                                        className="w-full bg-brew-dark-secondary border border-slate-700 rounded-lg p-2 text-sm text-white focus:border-brew-accent focus:outline-none"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-300 mb-1">Titolo Attività *</label>
                                <input
                                    type="text"
                                    value={formNoteTitle}
                                    onChange={e => setFormNoteTitle(e.target.value)}
                                    placeholder="Es. Dry hop 5kg Citra, sanificazione scambiatore..."
                                    required
                                    className="w-full bg-brew-dark-secondary border border-slate-700 rounded-lg p-2 text-sm text-white focus:border-brew-accent focus:outline-none"
                                />
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-bold text-slate-300 mb-1">Categoria</label>
                                    <select
                                        value={formNoteCategory}
                                        onChange={e => setFormNoteCategory(e.target.value as CalendarNoteCategory)}
                                        className="w-full bg-brew-dark-secondary border border-slate-700 rounded-lg p-2 text-sm text-white focus:border-brew-accent focus:outline-none"
                                    >
                                        {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                                            <option key={k} value={k}>{v.icon} {v.label}</option>
                                        ))}
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-xs font-bold text-slate-300 mb-1">Priorità</label>
                                    <select
                                        value={formNotePriority}
                                        onChange={e => setFormNotePriority(e.target.value as CalendarNotePriority)}
                                        className="w-full bg-brew-dark-secondary border border-slate-700 rounded-lg p-2 text-sm text-white focus:border-brew-accent focus:outline-none"
                                    >
                                        {Object.entries(PRIORITY_BADGES).map(([k, v]) => (
                                            <option key={k} value={k}>{v.label}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-300 mb-1">Descrizione Dettagliata</label>
                                <textarea
                                    value={formNoteDescription}
                                    onChange={e => setFormNoteDescription(e.target.value)}
                                    rows={2}
                                    placeholder="Dettagli operativi, dosaggi, parametri tecnici..."
                                    className="w-full bg-brew-dark-secondary border border-slate-700 rounded-lg p-2 text-sm text-white focus:border-brew-accent focus:outline-none"
                                />
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-bold text-slate-300 mb-1">Lotto Collegato (opzionale)</label>
                                    <select
                                        value={formNoteRelatedLotto}
                                        onChange={e => setFormNoteRelatedLotto(e.target.value)}
                                        className="w-full bg-brew-dark-secondary border border-slate-700 rounded-lg p-2 text-sm text-white focus:border-brew-accent focus:outline-none"
                                    >
                                        <option value="">Nessun lotto</option>
                                        {activeCotte.map(c => (
                                            <option key={c.LOTTO} value={c.LOTTO}>{c.LOTTO} - {c.NOME_BIRRA}</option>
                                        ))}
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-xs font-bold text-slate-300 mb-1">Fermentatore (opzionale)</label>
                                    <select
                                        value={formNoteRelatedFermentatore}
                                        onChange={e => setFormNoteRelatedFermentatore(e.target.value)}
                                        className="w-full bg-brew-dark-secondary border border-slate-700 rounded-lg p-2 text-sm text-white focus:border-brew-accent focus:outline-none"
                                    >
                                        <option value="">Nessun fermentatore</option>
                                        {cantinaConfig.map(f => (
                                            <option key={f.id} value={f.nome}>{f.nome} ({f.capacita}L)</option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            <div className="flex justify-end gap-2 pt-2 border-t border-slate-700">
                                <button
                                    type="button"
                                    onClick={() => setIsNoteModalOpen(false)}
                                    className="px-3.5 py-1.5 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-xs font-bold"
                                >
                                    Annulla
                                </button>
                                <button
                                    type="submit"
                                    className="px-4 py-1.5 bg-brew-accent hover:bg-yellow-400 text-brew-dark font-black rounded-lg text-xs shadow-lg"
                                >
                                    Salva Appunto
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* MODALE ASSOCIAZIONE NUMERO DI LOTTO ALLA COTTA */}
            {lottoLinkingModal.isOpen && lottoLinkingModal.brew && (
                <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-3">
                    <div className="bg-brew-dark border-2 border-emerald-500 rounded-2xl max-w-md w-full p-5 shadow-2xl space-y-4">
                        <div className="flex items-center justify-between border-b border-slate-700 pb-3">
                            <h3 className="text-lg font-black text-emerald-400 flex items-center gap-2">
                                <span>🏷️</span>
                                <span>Associa Numero Lotto alla Cotta</span>
                            </h3>
                            <button 
                                onClick={() => setLottoLinkingModal({ isOpen: false, brew: null, lottoInput: '' })} 
                                className="text-slate-400 hover:text-white"
                            >
                                <XMarkIcon className="w-5 h-5" />
                            </button>
                        </div>
                        <div className="bg-brew-dark-secondary p-3 rounded-lg border border-slate-700 text-xs space-y-1">
                            <div>Birra: <strong className="text-white">{lottoLinkingModal.brew.birraNome}</strong></div>
                            <div>Cliente: <strong className="text-slate-200">{lottoLinkingModal.brew.clienteNome}</strong></div>
                            <div>Data cotta: <strong className="text-amber-400">{formatISODateToItalian(lottoLinkingModal.brew.date)}</strong></div>
                            <div>Litri previsti: <strong className="text-slate-200">{lottoLinkingModal.brew.litriPrevisti} L</strong></div>
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-300 mb-1">
                                Numero di Lotto (es. 2601)
                            </label>
                            <input 
                                type="text" 
                                value={lottoLinkingModal.lottoInput} 
                                onChange={e => setLottoLinkingModal(prev => ({ ...prev, lottoInput: e.target.value.toUpperCase() }))}
                                placeholder="Es. 2601"
                                className="w-full bg-brew-dark-secondary border border-slate-600 rounded-lg p-2.5 text-white font-mono uppercase text-sm focus:border-emerald-500 focus:outline-none"
                                autoFocus
                            />
                            <p className="text-[11px] text-slate-400 mt-1">
                                Associando il numero di lotto, potrai accedere direttamente al foglio cotta dal calendario con il pulsante "Vedi Foglio Cotta".
                            </p>
                        </div>
                        <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-700">
                            <button
                                type="button"
                                onClick={() => setLottoLinkingModal({ isOpen: false, brew: null, lottoInput: '' })}
                                className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-bold rounded-lg"
                            >
                                Annulla
                            </button>
                            <button
                                type="button"
                                onClick={handleSaveLottoLink}
                                className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black rounded-lg shadow"
                            >
                                Salva Associazione
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
