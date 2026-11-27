import React, { useState } from 'react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { ArrowDownTrayIcon, DevicePhoneMobileIcon, XMarkIcon } from './icons';

interface PWAInstallButtonProps {
  variant?: 'header' | 'card';
  onInstalled?: () => void;
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({ variant = 'header', onInstalled }) => {
  const { canPromptInstall, isInstalled, isIOS, isLocalDesktop, triggerInstall } = usePWAInstall();
  const [showInstructionsModal, setShowInstructionsModal] = useState(false);

  if (isInstalled) {
    if (variant === 'card') {
      return (
        <div className="px-4 py-3 rounded-xl bg-emerald-950/60 border border-emerald-500/60 text-emerald-200 text-xs sm:text-sm font-semibold text-center">
          App già installata su questo dispositivo in modalità standalone.
        </div>
      );
    }
    return null;
  }

  // Nell'header non mostriamo il pulsante se siamo sul server PC locale (127.0.0.1)
  if (variant === 'header' && isLocalDesktop) {
    return null;
  }

  // Nell'header mostriamo il pulsante solo quando è installabile nativamente o su iOS Safari
  if (variant === 'header' && !canPromptInstall && !isIOS) {
    return null;
  }

  const handleClick = async () => {
    if (canPromptInstall) {
      const outcome = await triggerInstall();
      if (outcome === 'accepted' && onInstalled) {
        onInstalled();
      }
      return;
    }
    setShowInstructionsModal(true);
  };

  return (
    <>
      {variant === 'header' ? (
        <button
          type="button"
          onClick={handleClick}
          className="flex items-center gap-1.5 px-2.5 sm:px-3 min-h-[38px] rounded-lg bg-emerald-600/25 hover:bg-emerald-500 text-emerald-200 hover:text-brew-dark border border-emerald-500/60 text-xs font-extrabold transition-all shadow-sm"
          title="Installa Brew Panda come applicazione sul dispositivo"
        >
          <ArrowDownTrayIcon className="w-4 h-4 flex-shrink-0" />
          <span className="hidden md:inline">Installa App</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={handleClick}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 min-h-[48px] rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-sm shadow-lg transition-colors"
        >
          <DevicePhoneMobileIcon className="w-5 h-5" />
          <span>
            {canPromptInstall
              ? 'Installa Brew Panda su questo Dispositivo'
              : 'Come Installare su Tablet / Smartphone'}
          </span>
        </button>
      )}

      {showInstructionsModal && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-brew-dark border border-slate-600 rounded-2xl p-5 shadow-2xl space-y-4 text-slate-100">
            <div className="flex items-center justify-between border-b border-slate-700 pb-3">
              <div className="flex items-center gap-2">
                <DevicePhoneMobileIcon className="w-6 h-6 text-brew-accent" />
                <h3 className="text-base font-extrabold text-white">Installa Brew Panda</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowInstructionsModal(false)}
                className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700"
                aria-label="Chiudi"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>

            {isLocalDesktop ? (
              <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                Stai usando Brew Panda in modalità <strong>PC Locale Offline (127.0.0.1)</strong>. Per installare l&apos;app su Tablet o Smartphone, apri su quel dispositivo il tuo link Netlify pubblicato (o scansiona il codice QR qui sotto) da Chrome o Safari.
              </p>
            ) : isIOS ? (
              <ol className="space-y-2.5 text-xs sm:text-sm text-slate-200 list-decimal list-inside">
                <li>
                  Apri il sito Netlify in <strong>Safari</strong> su iPad o iPhone.
                </li>
                <li>
                  Tocca il pulsante <strong>Condividi</strong> (icona quadrato con freccia verso l&apos;alto).
                </li>
                <li>
                  Scorri e seleziona <strong>&quot;Aggiungi alla schermata Home&quot;</strong>, poi conferma con <strong>Aggiungi</strong>.
                </li>
              </ol>
            ) : (
              <ol className="space-y-2.5 text-xs sm:text-sm text-slate-200 list-decimal list-inside">
                <li>
                  Apri il tuo indirizzo Netlify in <strong>Google Chrome</strong> o <strong>Microsoft Edge</strong>.
                </li>
                <li>
                  Tocca il menu del browser (tre puntini <strong>⋮</strong> in alto a destra).
                </li>
                <li>
                  Seleziona <strong>&quot;Installa app&quot;</strong> oppure <strong>&quot;Aggiungi a schermata Home&quot;</strong>.
                </li>
              </ol>
            )}

            <button
              type="button"
              onClick={() => setShowInstructionsModal(false)}
              className="w-full min-h-[44px] py-2.5 rounded-xl bg-brew-accent text-brew-dark font-extrabold text-sm hover:bg-yellow-400 transition-colors"
            >
              Ho capito
            </button>
          </div>
        </div>
      )}
    </>
  );
};
