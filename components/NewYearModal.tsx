import React, { useState, useEffect } from 'react';
import { Modal } from './Modal';
import { getYears, createNewYear as createYearService, getActiveCellarLotsPreview } from '../services/dataService';
import { useToast } from '../hooks/useToast';

interface NewYearModalProps {
    onClose: () => void;
    onYearCreated: () => Promise<any>;
}

export const NewYearModal: React.FC<NewYearModalProps> = ({ onClose, onYearCreated }) => {
    const [newYear, setNewYear] = useState<string>((new Date().getFullYear() + 1).toString());
    const [importFromYear, setImportFromYear] = useState<string>('');
    const [availableYears, setAvailableYears] = useState<string[]>([]);
    const [importInventory, setImportInventory] = useState(true);
    const [importActiveBrews, setImportActiveBrews] = useState(true);
    const [cellarPreview, setCellarPreview] = useState<Array<{ lotto: string; birra: string; fermentatore: string; litri: number }>>([]);
    const { showToast } = useToast();

    useEffect(() => {
        const fetchYears = async () => {
            const years = await getYears();
            setAvailableYears(years);
            if (years.length > 0) {
                const lastYear = Math.max(...years.map(Number)).toString();
                setImportFromYear(lastYear);
            }
        };
        fetchYears();
    }, []);

    useEffect(() => {
        const checkCellar = async () => {
            if (importFromYear) {
                const preview = await getActiveCellarLotsPreview(importFromYear);
                setCellarPreview(preview);
            } else {
                setCellarPreview([]);
            }
        };
        checkCellar();
    }, [importFromYear]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!/^\d{4}$/.test(newYear)) {
            showToast("Per favore, inserisci un anno valido (4 cifre).", "error");
            return;
        }
        
        const success = await createYearService(newYear, importInventory ? importFromYear : undefined, importActiveBrews);
        if (success) {
            showToast(`Anno ${newYear} creato con successo!`, 'success');
            await onYearCreated();
            onClose();
        } else {
             showToast(`L'anno ${newYear} esiste già!`, "error");
        }
    };

    return (
        <Modal title="Crea Nuovo Anno" isOpen={true} onClose={onClose}>
            <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                    <label htmlFor="new-year" className="block text-sm font-medium text-gray-300 mb-1">
                        Anno da creare
                    </label>
                    <input
                        type="text"
                        id="new-year"
                        value={newYear}
                        onChange={(e) => setNewYear(e.target.value)}
                        className="w-full bg-brew-dark p-2 rounded-md border border-slate-600 focus:ring-brew-accent focus:border-brew-accent"
                        required
                    />
                </div>

                <div className="flex items-start">
                    <div className="flex items-center h-5">
                        <input
                            id="import-inventory"
                            type="checkbox"
                            checked={importInventory}
                            onChange={(e) => setImportInventory(e.target.checked)}
                            className="focus:ring-brew-accent h-4 w-4 text-brew-blue bg-brew-dark border-gray-600 rounded"
                        />
                    </div>
                    <div className="ml-3 text-sm">
                        <label htmlFor="import-inventory" className="font-medium text-gray-300">
                            Importa inventario dall'anno precedente
                        </label>
                        <p className="text-gray-500">Importa le giacenze finali di materie prime e birra finita come inventario iniziale.</p>
                    </div>
                </div>

                {importInventory && availableYears.length > 0 && (
                     <div>
                        <label htmlFor="import-from-year" className="block text-sm font-medium text-gray-300 mb-1">
                            Importa da anno
                        </label>
                        <select
                            id="import-from-year"
                            value={importFromYear}
                            onChange={(e) => setImportFromYear(e.target.value)}
                            className="w-full bg-brew-dark p-2 rounded-md border border-slate-600 focus:ring-brew-accent focus:border-brew-accent"
                        >
                            {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
                        </select>
                    </div>
                )}

                <div className="flex items-start pt-2 border-t border-slate-700">
                    <div className="flex items-center h-5">
                        <input
                            id="import-active-brews"
                            type="checkbox"
                            checked={importActiveBrews}
                            onChange={(e) => setImportActiveBrews(e.target.checked)}
                            className="focus:ring-brew-accent h-4 w-4 text-brew-blue bg-brew-dark border-gray-600 rounded"
                        />
                    </div>
                    <div className="ml-3 text-sm">
                        <label htmlFor="import-active-brews" className="font-medium text-amber-300">
                            Riporta cotte ancora in cantina / fermentazione
                        </label>
                        <p className="text-gray-400">
                            Mantiene i fermentatori occupati con i lotti di fine anno per continuare la maturazione e confezionarli a Gennaio nel nuovo anno.
                        </p>
                    </div>
                </div>

                {importActiveBrews && cellarPreview.length > 0 && (
                    <div className="p-3 bg-amber-950/40 border border-amber-500/50 rounded-md text-xs space-y-1.5 text-amber-200">
                        <p className="font-bold flex items-center gap-1.5 text-amber-300">
                            <span>🌡️</span> Lotti in fermentazione rilevati nel {importFromYear} ({cellarPreview.length}):
                        </p>
                        <ul className="list-disc list-inside space-y-1 text-slate-200">
                            {cellarPreview.map((item, idx) => (
                                <li key={idx}>
                                    <strong className="text-amber-300">Lotto {item.lotto}</strong> ({item.birra}) nel fermentatore <span className="font-semibold text-white">{item.fermentatore}</span> (~{item.litri} L)
                                </li>
                            ))}
                        </ul>
                        <p className="text-[11px] text-amber-400/90 pt-1 border-t border-amber-600/30">
                            ✓ Verranno trasferiti attivi nella cantina del {newYear || 'nuovo anno'} con le loro misurazioni di densità e pronti per il confezionamento a Gennaio.
                        </p>
                    </div>
                )}
                
                <div className="pt-4 flex justify-end">
                    <button
                        type="submit"
                        className="bg-brew-green text-white font-bold py-2 px-4 rounded-md hover:bg-opacity-80 transition-all"
                    >
                        Crea Anno
                    </button>
                </div>
            </form>
        </Modal>
    );
};