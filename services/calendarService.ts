import type { 
    CalendarNote, 
    CellarPackagingEvent, 
    FermenterConfig, 
    BrewHeader, 
    PackagingData, 
    PlannedBrew, 
    PlannedBrewStockAnalysis, 
    PlannedBrewIngredientCheck, 
    MaintenancePlan, 
    MaintenanceLog, 
    Birra, 
    RawWarehouseItem,
    RecipeIngredient,
    IngredientUnit
} from '../types';
import { getBreweryData, saveDataToSheet } from './dataService';
import { parseItalianDate } from '../utils/dateUtils';

// ==========================================
// 1. CANTINA & CONFEZIONAMENTI PREVISTI
// ==========================================

export const getCellarPackagingEvents = async (selectedYear: string): Promise<CellarPackagingEvent[]> => {
    const data = await getBreweryData(selectedYear);
    if (!data) return [];

    const { CANTINA_CONFIG, COTTE_HEAD, CONFEZIONAMENTO } = data;
    
    // Calcolo litri già confezionati per ciascun lotto
    const packagedLiters: Record<string, number> = {};
    (CONFEZIONAMENTO as PackagingData[] || []).forEach(p => {
        packagedLiters[p.LOTTO_PROD] = (packagedLiters[p.LOTTO_PROD] || 0) + (p.LITRI_TOT || 0);
    });

    // Mappa configurazione fermentatori
    const fermentersMap: Record<string, FermenterConfig> = {};
    (CANTINA_CONFIG as FermenterConfig[] || []).forEach(f => {
        fermentersMap[f.nome.trim().toUpperCase()] = f;
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const events: CellarPackagingEvent[] = [];

    (COTTE_HEAD as BrewHeader[] || []).forEach(cotta => {
        const litriFinali = parseFloat(cotta.LITRI_FINALI?.replace(',', '.') || '0') || 0;
        const litriConfezionati = packagedLiters[cotta.LOTTO] || 0;
        const fermName = cotta.FERMENTATORE ? cotta.FERMENTATORE.trim().toUpperCase() : '';

        // Se il lotto ha un fermentatore assegnato, non è chiuso in cantina, litri finali > 0 e non è stato confezionato interamente
        if (!cotta.isCellarClosed && fermName && litriFinali > 0 && litriConfezionati < litriFinali) {
            const giorniPrevisti = parseInt(cotta.GIORNI_FERMENTAZIONE_PREVISTI || '0', 10);
            const dataProd = parseItalianDate(cotta.DATA_PROD);

            if (dataProd && giorniPrevisti > 0) {
                const dataPrevista = new Date(dataProd);
                dataPrevista.setDate(dataPrevista.getDate() + giorniPrevisti);
                dataPrevista.setHours(0, 0, 0, 0);

                const yearStr = dataPrevista.getFullYear();
                const monthStr = String(dataPrevista.getMonth() + 1).padStart(2, '0');
                const dayStr = String(dataPrevista.getDate()).padStart(2, '0');
                const isoDate = `${yearStr}-${monthStr}-${dayStr}`;

                const diffTime = dataPrevista.getTime() - today.getTime();
                const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

                let status: 'in_progress' | 'finishing' | 'alarm' = 'in_progress';
                if (diffDays < 0) {
                    status = 'alarm'; // Data prevista superata senza confezionamento
                } else if (diffDays <= 3) {
                    status = 'finishing'; // In scadenza entro 3 giorni o oggi
                }

                events.push({
                    fermentatore: cotta.FERMENTATORE,
                    capacitaFermentatore: fermentersMap[fermName]?.capacita || 0,
                    lotto: cotta.LOTTO,
                    nomeBirra: cotta.NOME_BIRRA,
                    cliente: cotta.CLIENTE,
                    dataProd: cotta.DATA_PROD,
                    litriFinali,
                    giorniPrevisti,
                    dataPrevistaConfezionamento: isoDate,
                    status,
                    daysRemaining: diffDays,
                });
            }
        }
    });

    return events.sort((a, b) => a.dataPrevistaConfezionamento.localeCompare(b.dataPrevistaConfezionamento));
};

// ==========================================
// 2. NOTE & APPUNTI DEL CALENDARIO
// ==========================================

export const getCalendarNotes = async (selectedYear: string): Promise<CalendarNote[]> => {
    const data = await getBreweryData(selectedYear);
    return data?.CALENDAR_NOTES || [];
};

export const saveCalendarNotes = async (selectedYear: string, notes: CalendarNote[]): Promise<void> => {
    await saveDataToSheet(selectedYear, 'CALENDAR_NOTES', notes);
};

export const addCalendarNote = async (
    selectedYear: string,
    noteData: Omit<CalendarNote, 'id' | 'createdAt'>
): Promise<CalendarNote> => {
    const notes = await getCalendarNotes(selectedYear);
    const newNote: CalendarNote = {
        ...noteData,
        id: `note_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        createdAt: new Date().toISOString(),
    };
    const updatedNotes = [newNote, ...notes];
    await saveCalendarNotes(selectedYear, updatedNotes);
    return newNote;
};

export const updateCalendarNote = async (
    selectedYear: string,
    updatedNote: CalendarNote
): Promise<void> => {
    const notes = await getCalendarNotes(selectedYear);
    const index = notes.findIndex(n => n.id === updatedNote.id);
    if (index !== -1) {
        const updated = [...notes];
        updated[index] = updatedNote;
        await saveCalendarNotes(selectedYear, updated);
    }
};

export const deleteCalendarNote = async (
    selectedYear: string,
    noteId: string
): Promise<void> => {
    const notes = await getCalendarNotes(selectedYear);
    const filtered = notes.filter(n => n.id !== noteId);
    await saveCalendarNotes(selectedYear, filtered);
};

export const toggleCalendarNote = async (
    selectedYear: string,
    noteId: string
): Promise<void> => {
    const notes = await getCalendarNotes(selectedYear);
    const updated = notes.map(n => n.id === noteId ? { ...n, completed: !n.completed } : n);
    await saveCalendarNotes(selectedYear, updated);
};

// =========================================================================
// 3. PIANIFICAZIONE COTTE FUTURE & ANALISI FABBISOGNO MAGAZZINO
// =========================================================================

export const resolveIngredientUnit = (ing: RecipeIngredient): IngredientUnit => {
    if (ing.unita) return ing.unita;
    if (ing.tipologia === 'LUPPOLI' && ing.qta > 20) return 'g';
    if (ing.tipologia === 'LIEVITI' && ing.qta > 10) return 'g';
    return 'kg';
};

export const scaleRecipeIngredients = (birra: Birra, targetLiters?: number) => {
    const baseLiters = birra.litriBatchBase && birra.litriBatchBase > 0 ? birra.litriBatchBase : 1000;
    const effectiveLiters = targetLiters && targetLiters > 0 ? targetLiters : baseLiters;
    const scaleFactor = effectiveLiters / baseLiters;

    return (birra.ricetta || []).map(ing => {
        const unit = resolveIngredientUnit(ing);
        const scaledRecipeQty = (ing.qta || 0) * scaleFactor;
        // Il magazzino materie prime registra le quantità in kg / L / pz: converti i grammi in kg
        const warehouseQty = unit === 'g' ? scaledRecipeQty / 1000 : scaledRecipeQty;
        const warehouseUnit = unit === 'g' ? 'kg' : unit;

        return {
            tipologia: ing.tipologia,
            nome: ing.nome,
            qtaBase: ing.qta || 0,
            unitaRicetta: unit,
            qtaScalataRicetta: parseFloat(scaledRecipeQty.toFixed(3)),
            qtaMagazzino: parseFloat(warehouseQty.toFixed(3)),
            unitaMagazzino: warehouseUnit,
            scaleFactor,
            baseLiters,
            effectiveLiters,
        };
    });
};

export const analyzePlannedBrewStock = (
    birra: Birra,
    litriPrevisti: number,
    magazzino: RawWarehouseItem[],
    sharedStockMap?: Map<string, number>
): PlannedBrewStockAnalysis => {
    const ricetta = birra.ricetta || [];
    if (ricetta.length === 0) {
        return {
            sufficiente: true,
            mancantiCount: 0,
            ingredienti: [],
            dettaglioMancanti: []
        };
    }

    // Usa mappa condivisa (per cumulo cronologico tra cotte pianificate) oppure costruiscila dal magazzino
    const stockMap = sharedStockMap || new Map<string, number>();
    if (!sharedStockMap) {
        magazzino.forEach(item => {
            const key = item.NOME.trim().toUpperCase();
            stockMap.set(key, (stockMap.get(key) || 0) + (item.GIACENZA || 0));
        });
    }

    const scaledItems = scaleRecipeIngredients(birra, litriPrevisti);
    const ingredientiChecks: PlannedBrewIngredientCheck[] = [];
    const dettaglioMancanti: string[] = [];

    scaledItems.forEach(item => {
        const key = item.nome.trim().toUpperCase();
        const qtaRichiesta = item.qtaMagazzino;
        const qtaDisponibile = stockMap.get(key) || 0;
        const qtaMancante = Math.max(0, parseFloat((qtaRichiesta - qtaDisponibile).toFixed(3)));
        const sufficiente = qtaDisponibile + 0.0005 >= qtaRichiesta;
        const unitaMisura = item.unitaMagazzino;

        // Scala la giacenza residua disponibile per le cotte pianificate successive
        if (sharedStockMap) {
            sharedStockMap.set(key, Math.max(0, qtaDisponibile - qtaRichiesta));
        }

        if (!sufficiente) {
            const recipeHint = item.unitaRicetta === 'g' ? ` (${Math.round(item.qtaScalataRicetta)} g)` : '';
            dettaglioMancanti.push(
                `${item.nome}: richiesti ${qtaRichiesta} ${unitaMisura}${recipeHint}, disponibili ${qtaDisponibile.toFixed(2)} ${unitaMisura} (mancano ${qtaMancante.toFixed(2)} ${unitaMisura})`
            );
        }

        ingredientiChecks.push({
            tipologia: item.tipologia,
            nome: item.nome,
            qtaRicetta: item.qtaBase,
            qtaRichiesta,
            qtaDisponibile: parseFloat(qtaDisponibile.toFixed(3)),
            qtaMancante,
            sufficiente,
            unitaMisura
        });
    });

    return {
        sufficiente: dettaglioMancanti.length === 0,
        mancantiCount: dettaglioMancanti.length,
        ingredienti: ingredientiChecks,
        dettaglioMancanti
    };
};

export const getPlannedBrews = async (selectedYear: string): Promise<PlannedBrew[]> => {
    const data = await getBreweryData(selectedYear);
    if (!data) return [];

    const plannedBrews: PlannedBrew[] = [...(data.PLANNED_BREWS || [])].sort((a, b) => a.date.localeCompare(b.date));
    const birre = data.BIRRE || [];
    const magazzino = data.MAGAZZINO || [];

    // Mappa cumulativa delle giacenze per scalare in ordine cronologico i fabbisogni delle cotte pianificate attive
    const cumulativeStockMap = new Map<string, number>();
    magazzino.forEach(item => {
        const key = item.NOME.trim().toUpperCase();
        cumulativeStockMap.set(key, (cumulativeStockMap.get(key) || 0) + (item.GIACENZA || 0));
    });

    return plannedBrews.map(pb => {
        const isInactive = pb.status === 'PRODOTTA' || pb.status === 'ANNULLATA';
        const birra = birre.find(b => b.id === pb.birraId || b.nomeBirra.trim().toUpperCase() === pb.birraNome.trim().toUpperCase());
        const stockAnalysis = (!isInactive && birra)
            ? analyzePlannedBrewStock(birra, pb.litriPrevisti, magazzino, cumulativeStockMap)
            : undefined;
        return {
            ...pb,
            stockAnalysis
        };
    });
};

export const savePlannedBrews = async (selectedYear: string, brews: PlannedBrew[]): Promise<void> => {
    // Rimuovi stockAnalysis prima di salvare per non appesantire il DB
    const cleanBrews = brews.map(b => {
        const copy: Partial<PlannedBrew> = { ...b };
        delete copy.stockAnalysis;
        return copy as PlannedBrew;
    });
    await saveDataToSheet(selectedYear, 'PLANNED_BREWS', cleanBrews);
};

export const addPlannedBrew = async (
    selectedYear: string,
    brewData: Omit<PlannedBrew, 'id' | 'createdAt'>
): Promise<PlannedBrew> => {
    const brews = await getPlannedBrews(selectedYear);
    const newBrew: PlannedBrew = {
        ...brewData,
        id: `planned_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        createdAt: new Date().toISOString(),
    };
    const updated = [newBrew, ...brews];
    await savePlannedBrews(selectedYear, updated);
    return newBrew;
};

export const updatePlannedBrew = async (
    selectedYear: string,
    updatedBrew: PlannedBrew
): Promise<void> => {
    const brews = await getPlannedBrews(selectedYear);
    const index = brews.findIndex(b => b.id === updatedBrew.id);
    if (index !== -1) {
        const updated = [...brews];
        updated[index] = updatedBrew;
        await savePlannedBrews(selectedYear, updated);
    }
};

export const deletePlannedBrew = async (
    selectedYear: string,
    brewId: string
): Promise<void> => {
    const brews = await getPlannedBrews(selectedYear);
    const filtered = brews.filter(b => b.id !== brewId);
    await savePlannedBrews(selectedYear, filtered);
};

export const togglePlannedBrewStatus = async (
    selectedYear: string,
    brewId: string,
    targetStatus?: 'PRODOTTA' | 'PIANIFICATA',
    lottoCreato?: string
): Promise<void> => {
    const brews = await getPlannedBrews(selectedYear);
    const updated = brews.map(b => {
        if (b.id !== brewId) return b;
        const isNowProdotta = targetStatus 
            ? targetStatus === 'PRODOTTA' 
            : b.status !== 'PRODOTTA';
        return {
            ...b,
            status: (isNowProdotta ? 'PRODOTTA' : 'PIANIFICATA') as 'PRODOTTA' | 'PIANIFICATA',
            eseguitaAt: isNowProdotta ? (b.eseguitaAt || new Date().toISOString()) : undefined,
            lottoCreato: lottoCreato !== undefined ? lottoCreato : (isNowProdotta ? b.lottoCreato : undefined)
        };
    });
    await savePlannedBrews(selectedYear, updated);
};

export const setPlannedBrewLotto = async (
    selectedYear: string,
    brewId: string,
    lottoCreato: string
): Promise<void> => {
    const brews = await getPlannedBrews(selectedYear);
    const updated = brews.map(b => {
        if (b.id !== brewId) return b;
        return {
            ...b,
            lottoCreato: lottoCreato.trim() || undefined
        };
    });
    await savePlannedBrews(selectedYear, updated);
};

// =========================================================================
// 4. CICLI CIP / SANIFICAZIONI & MANUTENZIONE TECNICA IMPIANTI
// =========================================================================

export const getMaintenancePlans = async (selectedYear: string): Promise<MaintenancePlan[]> => {
    const data = await getBreweryData(selectedYear);
    if (!data) return [];

    const plans: MaintenancePlan[] = data.MAINTENANCE_PLANS || [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return plans.map(plan => {
        let daysRemaining = 999;
        let stato: 'regolare' | 'in_scadenza' | 'scaduto' = 'regolare';

        if (plan.dataProssimaScadenza) {
            const nextDate = new Date(plan.dataProssimaScadenza);
            nextDate.setHours(0, 0, 0, 0);
            const diffTime = nextDate.getTime() - today.getTime();
            daysRemaining = Math.round(diffTime / (1000 * 60 * 60 * 24));

            if (daysRemaining < 0) {
                stato = 'scaduto';
            } else if (daysRemaining <= 3) {
                stato = 'in_scadenza';
            }
        }

        return {
            ...plan,
            daysRemaining,
            stato
        };
    }).sort((a, b) => a.dataProssimaScadenza.localeCompare(b.dataProssimaScadenza));
};

export const saveMaintenancePlans = async (selectedYear: string, plans: MaintenancePlan[]): Promise<void> => {
    const cleanPlans = plans.map(p => {
        const copy: Partial<MaintenancePlan> = { ...p };
        delete copy.daysRemaining;
        delete copy.stato;
        return copy as MaintenancePlan;
    });
    await saveDataToSheet(selectedYear, 'MAINTENANCE_PLANS', cleanPlans);
};

export const addMaintenancePlan = async (
    selectedYear: string,
    planData: Omit<MaintenancePlan, 'id'>
): Promise<MaintenancePlan> => {
    const plans = await getMaintenancePlans(selectedYear);
    const newPlan: MaintenancePlan = {
        ...planData,
        id: `maint_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`
    };
    const updated = [newPlan, ...plans];
    await saveMaintenancePlans(selectedYear, updated);
    return newPlan;
};

export const updateMaintenancePlan = async (
    selectedYear: string,
    updatedPlan: MaintenancePlan
): Promise<void> => {
    const plans = await getMaintenancePlans(selectedYear);
    const index = plans.findIndex(p => p.id === updatedPlan.id);
    if (index !== -1) {
        const updated = [...plans];
        updated[index] = updatedPlan;
        await saveMaintenancePlans(selectedYear, updated);
    }
};

export const deleteMaintenancePlan = async (
    selectedYear: string,
    planId: string
): Promise<void> => {
    const plans = await getMaintenancePlans(selectedYear);
    const filtered = plans.filter(p => p.id !== planId);
    await saveMaintenancePlans(selectedYear, filtered);
};

export const executeMaintenancePlan = async (
    selectedYear: string,
    planId: string,
    options?: { executionDate?: string; operatore?: string; note?: string }
): Promise<MaintenancePlan | null> => {
    const data = await getBreweryData(selectedYear);
    if (!data) return null;

    const plans: MaintenancePlan[] = data.MAINTENANCE_PLANS || [];
    const plan = plans.find(p => p.id === planId);
    if (!plan) return null;

    const execDateStr = options?.executionDate || new Date().toISOString().slice(0, 10);
    const execDate = new Date(execDateStr);

    // Calcola la nuova prossima scadenza in base a intervalloGiorni
    const nextDate = new Date(execDate);
    nextDate.setDate(nextDate.getDate() + (plan.intervalloGiorni || 7));
    const nextDateStr = nextDate.toISOString().slice(0, 10);

    const updatedPlan: MaintenancePlan = {
        ...plan,
        dataUltimaEsecuzione: execDateStr,
        dataProssimaScadenza: nextDateStr
    };

    // Aggiungi registro a MAINTENANCE_LOGS
    const log: MaintenanceLog = {
        id: `log_${Date.now()}`,
        planId: plan.id,
        planNome: plan.nome,
        tipo: plan.tipo,
        apparato: plan.apparato,
        dataEsecuzione: execDateStr,
        operatore: options?.operatore,
        note: options?.note
    };

    const logs: MaintenanceLog[] = data.MAINTENANCE_LOGS || [];
    const updatedPlans = plans.map(p => p.id === planId ? updatedPlan : p);

    await saveDataToSheet(selectedYear, 'MAINTENANCE_PLANS', updatedPlans);
    await saveDataToSheet(selectedYear, 'MAINTENANCE_LOGS', [log, ...logs]);

    return updatedPlan;
};

export const getMaintenanceLogs = async (selectedYear: string): Promise<MaintenanceLog[]> => {
    const data = await getBreweryData(selectedYear);
    return data?.MAINTENANCE_LOGS || [];
};

// ==========================================
// 5. PROMEMORIA GLOBALI PER LA HOME
// ==========================================

export const getTodayReminders = async (selectedYear: string) => {
    const now = new Date();
    const todayISO = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const in7DaysDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7);
    const in7DaysISO = `${in7DaysDate.getFullYear()}-${String(in7DaysDate.getMonth() + 1).padStart(2, '0')}-${String(in7DaysDate.getDate()).padStart(2, '0')}`;

    const [notes, cellarEvents, plannedBrews, maintenancePlans] = await Promise.all([
        getCalendarNotes(selectedYear),
        getCellarPackagingEvents(selectedYear),
        getPlannedBrews(selectedYear),
        getMaintenancePlans(selectedYear)
    ]);

    // Note di oggi non completate (o con priorità alta) + prossime note entro 7 giorni
    const todayNotes = notes.filter(n => n.date === todayISO);
    const pendingTodayNotes = todayNotes.filter(n => !n.completed);
    const urgentNotes = notes.filter(n => !n.completed && (n.priority === 'URGENTE' || (n.priority === 'ALTA' && n.date <= todayISO)));
    const upcomingNotes = notes
        .filter(n => !n.completed && n.date > todayISO && n.date <= in7DaysISO)
        .sort((a, b) => a.date.localeCompare(b.date));

    // Confezionamenti in allarme (data passata) o previsti oggi o nei prossimi 7 giorni
    const alarmCellarEvents = cellarEvents.filter(e => e.status === 'alarm');
    const todayCellarEvents = cellarEvents.filter(e => e.dataPrevistaConfezionamento === todayISO);
    const upcomingCellarEvents = cellarEvents.filter(e => e.daysRemaining > 0 && e.daysRemaining <= 7);

    // Cotte pianificate imminenti (oggi o prossimi 7 giorni)
    const upcomingPlannedBrews = plannedBrews.filter(pb => {
        if (pb.status === 'PRODOTTA' || pb.status === 'ANNULLATA') return false;
        const diff = (new Date(pb.date).getTime() - new Date(todayISO).getTime()) / (1000 * 60 * 60 * 24);
        return diff >= 0 && diff <= 7;
    });

    // Cotte pianificate con allarme giacenza (mancano ingredienti a magazzino!)
    const plannedBrewsWithShortages = plannedBrews.filter(pb => {
        if (pb.status === 'PRODOTTA' || pb.status === 'ANNULLATA') return false;
        return pb.stockAnalysis && !pb.stockAnalysis.sufficiente;
    });

    // Manutenzioni / CIP in scadenza o scadute
    const urgentMaintenance = maintenancePlans.filter(m => m.attivo && (m.stato === 'scaduto' || m.stato === 'in_scadenza'));
    const expiredMaintenance = maintenancePlans.filter(m => m.attivo && m.stato === 'scaduto');

    const totalAlertsCount = 
        pendingTodayNotes.length + 
        alarmCellarEvents.length + 
        todayCellarEvents.length + 
        urgentNotes.length +
        plannedBrewsWithShortages.length +
        urgentMaintenance.length;

    const upcomingActivityCount =
        upcomingNotes.length +
        upcomingCellarEvents.length +
        upcomingPlannedBrews.length;

    return {
        todayISO,
        todayNotes,
        pendingTodayNotes,
        urgentNotes,
        upcomingNotes,
        alarmCellarEvents,
        todayCellarEvents,
        upcomingCellarEvents,
        upcomingPlannedBrews,
        plannedBrewsWithShortages,
        urgentMaintenance,
        expiredMaintenance,
        totalAlertsCount,
        upcomingActivityCount
    };
};
