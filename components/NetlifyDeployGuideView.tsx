import React, { useState, useEffect, useMemo } from 'react';
import QRCode from 'qrcode';
import {
  ArrowDownTrayIcon,
  ClipboardDocumentCheckIcon,
  DevicePhoneMobileIcon,
  LockClosedIcon,
  QrCodeIcon,
} from './icons';
import { PWAInstallButton } from './PWAInstallButton';
import { useToast } from '../hooks/useToast';

const STORAGE_KEY_SITE_NAME = 'brewpanda_netlify_site_name';

function sanitizeSiteSlug(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\.netlify\.app.*$/, '')
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export const NetlifyDeployGuideView: React.FC = () => {
  const { showToast } = useToast();

  const initialSlug = useMemo(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_SITE_NAME);
      if (saved) return saved;
      if (
        typeof window !== 'undefined' &&
        window.location.hostname.endsWith('.netlify.app')
      ) {
        return window.location.hostname.replace(/\.netlify\.app$/, '');
      }
    } catch {
      // ignore storage read errors
    }
    return 'mio-birrificio';
  }, []);

  const [siteInput, setSiteInput] = useState(initialSlug);
  const [customFullUrl, setCustomFullUrl] = useState('');
  const [useCustomUrl, setUseCustomUrl] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');

  const targetUrl = useMemo(() => {
    if (useCustomUrl && customFullUrl.trim()) {
      const trimmed = customFullUrl.trim();
      return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    }
    const slug = sanitizeSiteSlug(siteInput) || 'mio-birrificio';
    return `https://${slug}.netlify.app`;
  }, [siteInput, customFullUrl, useCustomUrl]);

  useEffect(() => {
    try {
      const slug = sanitizeSiteSlug(siteInput);
      if (slug) localStorage.setItem(STORAGE_KEY_SITE_NAME, slug);
    } catch {
      // ignore storage write errors
    }
  }, [siteInput]);

  useEffect(() => {
    let active = true;
    QRCode.toDataURL(targetUrl, {
      width: 320,
      margin: 2,
      color: {
        dark: '#0f172a',
        light: '#ffffff',
      },
      errorCorrectionLevel: 'M',
    })
      .then((url) => {
        if (active) setQrDataUrl(url);
      })
      .catch((err) => {
        console.error('Errore generazione QR Code:', err);
      });
    return () => {
      active = false;
    };
  }, [targetUrl]);

  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(targetUrl);
      showToast('Indirizzo copiato negli appunti!', 'success');
    } catch {
      showToast('Seleziona e copia manualmente l’indirizzo.', 'warning');
    }
  };

  const handleDownloadQr = () => {
    if (!qrDataUrl) return;
    const link = document.createElement('a');
    link.href = qrDataUrl;
    const slug = sanitizeSiteSlug(siteInput) || 'brew-panda';
    link.download = `qr-${slug}-brewpanda.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('Immagine Codice QR scaricata.', 'success');
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-8">
      {/* Intestazione */}
      <div className="bg-brew-dark border border-slate-700 rounded-2xl p-4 sm:p-6 shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="p-2.5 rounded-xl bg-brew-accent/15 border border-brew-accent/40 text-brew-accent">
              <DevicePhoneMobileIcon className="w-7 h-7" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-black text-white">
                App Tablet & Smartphone via GitHub Privato + Netlify
              </h1>
              <p className="text-xs sm:text-sm text-slate-300 mt-1">
                Installa Brew Panda su iPad, Android e iPhone mantenendo i dati aziendali al 100% privati e il PC centrale sempre offline con chiavetta USB o <code>1_AVVIA_BREW_PANDA.bat</code>.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Configuratore Nome Sito + Generatore QR Code */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 bg-brew-dark border border-slate-700 rounded-2xl p-4 sm:p-6 space-y-4 shadow-xl">
          <div className="flex items-center gap-2 text-brew-accent font-extrabold text-sm uppercase tracking-wider">
            <QrCodeIcon className="w-5 h-5" />
            <span>1. Scegli il Nome del Tuo Sito Netlify</span>
          </div>

          <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
            Inserisci il nome scelto su Netlify (ad esempio <strong>birrificio-rossi</strong>). Il sistema genera automaticamente il link esatto e il <strong>Codice QR</strong> da inquadrare con Tablet o Smartphone.
          </p>

          <div className="flex items-center gap-2 text-xs">
            <button
              type="button"
              onClick={() => setUseCustomUrl(false)}
              className={`px-3 py-2 min-h-[40px] rounded-lg font-bold transition-colors ${
                !useCustomUrl
                  ? 'bg-brew-accent text-brew-dark'
                  : 'bg-brew-dark-secondary text-slate-300 hover:text-white'
              }`}
            >
              Nome Netlify (.netlify.app)
            </button>
            <button
              type="button"
              onClick={() => setUseCustomUrl(true)}
              className={`px-3 py-2 min-h-[40px] rounded-lg font-bold transition-colors ${
                useCustomUrl
                  ? 'bg-brew-accent text-brew-dark'
                  : 'bg-brew-dark-secondary text-slate-300 hover:text-white'
              }`}
            >
              Dominio Personalizzato
            </button>
          </div>

          {!useCustomUrl ? (
            <div>
              <label
                htmlFor="netlify-slug-input"
                className="block text-xs font-bold text-slate-300 mb-1.5"
              >
                Nome del sito (solo lettere, numeri e trattini)
              </label>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center rounded-xl overflow-hidden border border-slate-600 bg-brew-dark-secondary">
                <span className="px-3 py-2.5 text-xs sm:text-sm font-mono text-slate-400 bg-slate-900/70 border-b sm:border-b-0 sm:border-r border-slate-700">
                  https://
                </span>
                <input
                  id="netlify-slug-input"
                  type="text"
                  value={siteInput}
                  onChange={(e) => setSiteInput(e.target.value)}
                  placeholder="tuo-birrificio"
                  className="flex-1 bg-transparent px-3 py-2.5 text-sm sm:text-base font-mono font-bold text-white focus:outline-none min-h-[44px]"
                />
                <span className="px-3 py-2.5 text-xs sm:text-sm font-mono text-brew-accent bg-slate-900/70 border-t sm:border-t-0 sm:border-l border-slate-700">
                  .netlify.app
                </span>
              </div>
            </div>
          ) : (
            <div>
              <label
                htmlFor="custom-url-input"
                className="block text-xs font-bold text-slate-300 mb-1.5"
              >
                Indirizzo internet completo
              </label>
              <input
                id="custom-url-input"
                type="url"
                value={customFullUrl}
                onChange={(e) => setCustomFullUrl(e.target.value)}
                placeholder="https://gestionale.tuobirrificio.it"
                className="w-full rounded-xl border border-slate-600 bg-brew-dark-secondary px-3 py-2.5 text-sm font-mono text-white focus:outline-none focus:border-brew-accent min-h-[44px]"
              />
            </div>
          )}

          <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-700 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-wider text-slate-400 font-bold">
                Indirizzo Finale Attivo
              </div>
              <div className="text-sm font-mono font-bold text-emerald-400 break-all">
                {targetUrl}
              </div>
            </div>
            <button
              type="button"
              onClick={handleCopyUrl}
              className="min-h-[44px] px-4 py-2 rounded-xl bg-brew-blue hover:bg-opacity-90 text-white text-xs sm:text-sm font-bold flex items-center justify-center gap-2 flex-shrink-0"
            >
              <ClipboardDocumentCheckIcon className="w-4 h-4" />
              <span>Copia Link</span>
            </button>
          </div>

          <PWAInstallButton variant="card" />
        </div>

        {/* Box Codice QR */}
        <div className="lg:col-span-5 bg-brew-dark border border-slate-700 rounded-2xl p-4 sm:p-6 flex flex-col items-center justify-center text-center space-y-4 shadow-xl">
          <div className="text-sm font-extrabold text-white">
            Scansiona con Fotocamera Tablet / Smartphone
          </div>
          <div className="bg-white p-3 sm:p-4 rounded-2xl shadow-2xl border-4 border-brew-accent/80">
            {qrDataUrl ? (
              <img
                src={qrDataUrl}
                alt={`Codice QR per aprire ${targetUrl}`}
                className="w-52 h-52 sm:w-60 sm:h-60 object-contain"
              />
            ) : (
              <div className="w-52 h-52 flex items-center justify-center text-slate-500 text-xs">
                Generazione QR...
              </div>
            )}
          </div>
          <p className="text-xs text-slate-300 max-w-xs leading-relaxed">
            Inquadra questo QR Code dal tablet o dal telefono: si aprirà direttamente la tua app Brew Panda pronta per essere installata sulla schermata Home.
          </p>
          <button
            type="button"
            onClick={handleDownloadQr}
            disabled={!qrDataUrl}
            className="w-full sm:w-auto min-h-[44px] px-4 py-2 rounded-xl bg-slate-700 hover:bg-slate-600 text-white text-xs font-bold flex items-center justify-center gap-2 transition-colors"
          >
            <ArrowDownTrayIcon className="w-4 h-4" />
            <span>Scarica QR Code (PNG da stampare)</span>
          </button>
        </div>
      </div>

      {/* Box Privacy e Doppio Funzionamento */}
      <div className="bg-emerald-950/35 border border-emerald-500/50 rounded-2xl p-4 sm:p-6 space-y-3">
        <div className="flex items-center gap-2 text-emerald-300 font-black text-sm uppercase tracking-wider">
          <LockClosedIcon className="w-5 h-5" />
          <span>Privacy Totale dei Dati & Continuità PC Locale / Chiavetta USB</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs sm:text-sm text-emerald-100 leading-relaxed">
          <div className="p-3 rounded-xl bg-slate-900/60 border border-emerald-700/40">
            <strong className="block text-emerald-300 mb-1">1. Repository GitHub Privato</strong>
            Su GitHub e Netlify va <strong>solo il codice vuoto dell&apos;app</strong>. Il file <code>.gitignore</code> blocca in automatico <code>data/</code> e ogni backup <code>*.json</code>. Nessuno vede clienti, prezzi, cotte o fusti.
          </div>
          <div className="p-3 rounded-xl bg-slate-900/60 border border-emerald-700/40">
            <strong className="block text-emerald-300 mb-1">2. Dati Solo sul Dispositivo</strong>
            Quando apri l&apos;app da Netlify sul Tablet o Smartphone, i dati restano salvati <strong>solo nella memoria locale (IndexedDB)</strong> di quel dispositivo e lavorano anche senza Wi-Fi in magazzino.
          </div>
          <div className="p-3 rounded-xl bg-slate-900/60 border border-emerald-700/40">
            <strong className="block text-emerald-300 mb-1">3. PC Centrale & Chiavetta USB</strong>
            Sul PC centrale continui ad avviare normalmente <code>1_AVVIA_BREW_PANDA.bat</code> dalla cartella estratta dello <code>.zip</code>, portandola anche su chiavetta USB senza internet.
          </div>
        </div>
      </div>

      {/* Guida Passo Passo */}
      <div className="bg-brew-dark border border-slate-700 rounded-2xl p-4 sm:p-6 space-y-4 shadow-xl">
        <h2 className="text-lg font-black text-white">
          Guida Passo-Passo per Nuovo Utente (Configurazione Unica in 5 Minuti)
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs sm:text-sm text-slate-200">
          <div className="p-4 rounded-xl bg-brew-dark-secondary border border-slate-700 space-y-1.5">
            <div className="font-extrabold text-brew-accent">
              Passo 1 — Carica il codice su GitHub (Privato)
            </div>
            <p className="text-slate-300 leading-relaxed">
              Accedi a <strong>github.com</strong>, crea un nuovo repository selezionando{' '}
              <strong>Private (Privato)</strong> e carica i file della cartella Brew Panda (senza la cartella <code>data/</code> né eventuali file backup <code>.json</code>).
            </p>
          </div>

          <div className="p-4 rounded-xl bg-brew-dark-secondary border border-slate-700 space-y-1.5">
            <div className="font-extrabold text-brew-accent">
              Passo 2 — Collega GitHub a Netlify
            </div>
            <p className="text-slate-300 leading-relaxed">
              Accedi gratis a <strong>netlify.com</strong> con il tuo account GitHub → clicca{' '}
              <strong>Add new site</strong> → <strong>Import an existing project</strong> → seleziona il repository privato. Verifica:
              <br />• Build command: <code>npm run build</code>
              <br />• Publish directory: <code>dist</code>
            </p>
          </div>

          <div className="p-4 rounded-xl bg-brew-dark-secondary border border-slate-700 space-y-1.5">
            <div className="font-extrabold text-brew-accent">
              Passo 3 — Dai un Nome al Sito e Genera il QR
            </div>
            <p className="text-slate-300 leading-relaxed">
              Su Netlify vai in <strong>Site configuration → Change site name</strong> e scegli il nome del tuo birrificio (es. <code>tuo-birrificio</code>). Scrivi lo stesso nome nel campo qui sopra per ottenere il Codice QR pronto.
            </p>
          </div>

          <div className="p-4 rounded-xl bg-brew-dark-secondary border border-slate-700 space-y-1.5">
            <div className="font-extrabold text-brew-accent">
              Passo 4 — Installa & Sincronizza Dati PC ↔ Mobile
            </div>
            <p className="text-slate-300 leading-relaxed">
              Scansiona il QR con Tablet o Smartphone e installa l&apos;app. Quando vuoi passare i dati tra PC e Tablet usa <strong>Esporta Tutti i Dati</strong> (su Smartphone puoi inviare subito via WhatsApp, Email o Google Drive) e poi <strong>Importa Dati</strong> sull&apos;altro dispositivo.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
