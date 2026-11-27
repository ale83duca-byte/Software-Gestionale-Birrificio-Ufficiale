export const isInventoryDay = (): boolean => {
    const today = new Date();
    // Chiusura fine anno: dal 26 al 31 Dicembre
    if (today.getMonth() === 11 && today.getDate() >= 26) {
        return true;
    }
    // Inizio mese: primi 7 giorni del mese (lunedì)
    if (today.getDay() === 1 && today.getDate() <= 7) {
        return true;
    }
    return false;
};

export const getInventoryReminderInfo = (): { isReminder: boolean; type: 'START_OF_MONTH' | 'YEAR_END' } => {
    const today = new Date();
    if (today.getMonth() === 11 && today.getDate() >= 26) {
        return { isReminder: true, type: 'YEAR_END' };
    }
    if (today.getDay() === 1 && today.getDate() <= 7) {
        return { isReminder: true, type: 'START_OF_MONTH' };
    }
    return { isReminder: false, type: 'START_OF_MONTH' };
};