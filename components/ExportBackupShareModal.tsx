import React, { useMemo, useState } from 'react';
import {
  ArrowDownTrayIcon,
  ClipboardDocumentCheckIcon,
  EnvelopeIcon,
  LockClosedIcon,
  ShareIcon,
  XMarkIcon,
} from './icons';
import { useToast } from '../hooks/useToast';

export interface PreparedBackupPayload {
  filename: string;
  jsonString: string;
  years: string[];
  sizeKb: number;
}

interface ExportBackupShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  backup: PreparedBackupPayload | null;
}

export const ExportBackupShareModal: React.FC<ExportBackupShareModalProps> = ({
  isOpen,
  onClose,
  backup,
}) => {
  const { showToast } = useToast();
  const [isSharing, setIsSharing] = useState(false);

  const shareCapability = useMemo(() => {
    if (!backup || typeof navigator === 'undefined' || typeof navigator.share !== 'function') {
      return { canShareFiles: false, canShareText: false };
    }
    try {
      const testFile = new File([backup.jsonString], backup.filename, {
        type: 'application/json',
      });
      const canShareFiles =
        typeof navigator.canShare === 'function' && navigator.canShare({ files: [testFile] });
      return { canShareFiles, canShareText: true };
    } catch {
      return { canShareFiles: false, canShareText: typeof navigator.share === 'function' };
    }
  }, [backup]);

  if (!isOpen || !backup) return null;

  const triggerFileDownload = () => {
    const blob = new Blob([backup.jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = backup.filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast(`File ${backup.filename} scaricato sul dispositivo.`, 'success');
  };

  const handleNativeShare = async () => {
    if (!shareCapability.canShareFiles && !shareCapability.canShareText) {
      triggerFileDownload();
      return;
    }

    setIsSharing(true);
    try {
      const file = new File([backup.jsonString], backup.filename, {
        type: 'application/json',
      });

      if (shareCapability.canShareFiles) {
        await navigator.share({
          title: 'Backup Brew Panda',
          text: `Backup completo Brew Panda (${backup.years.join(', ')}) — importa questo file sul PC centrale o sul tablet con "Importa Dati".`,
          files: [file],
        });
        showToast('Backup condiviso con successo!', 'success');
      } else {
        // Fallback: scarica il file e apre comunque il foglio di condivisione testuale se disponibile
        triggerFileDownload();
        await navigator.share({
          title: 'Backup Brew Panda',
          text: `Backup Brew Panda (${backup.filename}) pronto. Allega il file appena scaricato.`,
        });
      }
    } catch (error) {
      const errName = error instanceof Error ? error.name : '';
      if (errName !== 'AbortError') {
        console.warn('Condivisione diretta non riuscita, avvio download standard:', error);
        triggerFileDownload();
      }
    } finally {
      setIsSharing(false);
    }
  };

  const handleCopyJson = async () => {
    try {
      await navigator.clipboard.writeText(backup.jsonString);
      showToast('Contenuto backup copiato negli appunti.', 'success');
    } catch {
      showToast('Impossibile copiare negli appunti su questo browser.', 'warning');
    }
  };

  const handleSendByEmail = () => {
    // Scarica subito il file .json così l'utente può allegarlo all'email aperta
    triggerFileDownload();
    const subject = encodeURIComponent(`Backup Brew Panda - ${backup.filename}`);
    const body = encodeURIComponent(
      `In allegato il file di backup "${backup.filename}" (Anni: ${backup.years.join(', ')}).\n\nRicorda di allegare il file appena scaricato dalla cartella Download prima di inviare l'email, poi aprilo su Brew Panda tramite "Importa Dati".`
    );
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-brew-dark border border-slate-600 rounded-2xl shadow-2xl overflow-hidden text-slate-100 my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-5 py-4 bg-slate-900/90 border-b border-slate-700">
          <div className="flex items-center gap-2.5">
            <ShareIcon className="w-6 h-6 text-brew-accent flex-shrink-0" />
            <div>
              <h2 className="text-base sm:text-lg font-extrabold text-white">
                Esporta & Condividi Backup
              </h2>
              <p className="text-xs text-slate-400">
                Sincronizza PC Centrale ↔ Tablet / Smartphone
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-slate-700"
            aria-label="Chiudi finestra esportazione"
          >
            <XMarkIcon className="w-6 h-6" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 sm:p-5 space-y-4">
          {/* Riepilogo File */}
          <div className="p-3.5 rounded-xl bg-brew-dark-secondary border border-slate-700 space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                File Backup Pronto
              </span>
              <span className="text-xs font-mono font-bold text-emerald-400">
                {backup.sizeKb} KB
              </span>
            </div>
            <div className="font-mono text-xs sm:text-sm font-bold text-brew-accent break-all">
              {backup.filename}
            </div>
            <div className="text-xs text-slate-300">
              Anni inclusi:{' '}
              <span className="font-semibold text-white">
                {backup.years.length > 0 ? backup.years.join(', ') : 'Archivio completo'}
              </span>
            </div>
          </div>

          {/* Azioni Principali Mobile & Desktop */}
          <div className="space-y-2.5">
            {shareCapability.canShareFiles ? (
              <button
                type="button"
                onClick={handleNativeShare}
                disabled={isSharing}
                className="w-full min-h-[52px] px-4 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white font-extrabold text-sm sm:text-base flex items-center justify-center gap-2.5 shadow-lg transition-colors"
              >
                <ShareIcon className="w-5 h-5 flex-shrink-0" />
                <span>
                  {isSharing
                    ? 'Apertura condivisione...'
                    : 'Condividi Subito (WhatsApp, Email, Google Drive...)'}
                </span>
              </button>
            ) : (
              <div className="p-3 rounded-xl bg-sky-950/50 border border-sky-700/60 text-xs text-sky-200 leading-relaxed">
                Su questo browser desktop la condivisione diretta file non è attiva: usa{' '}
                <strong>Scarica File (.json)</strong> oppure <strong>Prepara Email</strong>. Su{' '}
                <strong>Tablet e Smartphone</strong> il pulsante verde apre direttamente WhatsApp,
                Email, Google Drive o AirDrop/File.
              </div>
            )}

            <button
              type="button"
              onClick={triggerFileDownload}
              className="w-full min-h-[48px] px-4 py-3 rounded-xl bg-brew-blue hover:bg-opacity-90 text-white font-bold text-sm flex items-center justify-center gap-2.5 shadow transition-colors"
            >
              <ArrowDownTrayIcon className="w-5 h-5 flex-shrink-0" />
              <span>Scarica File Backup (.json)</span>
            </button>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={handleSendByEmail}
                className="min-h-[46px] px-3 py-2.5 rounded-xl bg-slate-700 hover:bg-slate-600 text-white font-semibold text-xs sm:text-sm flex items-center justify-center gap-2 transition-colors"
              >
                <EnvelopeIcon className="w-4 h-4 text-amber-300 flex-shrink-0" />
                <span>Scarica & Apri Email</span>
              </button>

              <button
                type="button"
                onClick={handleCopyJson}
                className="min-h-[46px] px-3 py-2.5 rounded-xl bg-slate-700 hover:bg-slate-600 text-white font-semibold text-xs sm:text-sm flex items-center justify-center gap-2 transition-colors"
              >
                <ClipboardDocumentCheckIcon className="w-4 h-4 text-emerald-300 flex-shrink-0" />
                <span>Copia Testo JSON</span>
              </button>
            </div>
          </div>

          {/* Nota Privacy & Importazione */}
          <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-700 flex items-start gap-2.5 text-xs text-slate-300 leading-relaxed">
            <LockClosedIcon className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
            <div>
              <strong>Privacy garantita:</strong> questo file contiene i tuoi dati aziendali e resta
              solo sui tuoi dispositivi o sui canali privati che scegli di inviare. Per caricarlo
              sull&apos;altro dispositivo clicca <strong>Importa Dati</strong> nel menu principale.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
