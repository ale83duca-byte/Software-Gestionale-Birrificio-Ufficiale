import React from 'react';
import ReactDOM from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import './index.css';
import App from './App';
import { ToastProvider } from './hooks/useToast';
import { LanguageProvider } from './i18n';

const isLocalDesktopServer =
  typeof window !== 'undefined' &&
  (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost');

if (!isLocalDesktopServer && typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  registerSW({
    immediate: true,
    onOfflineReady() {
      console.info('Brew Panda pronta anche offline su questo dispositivo.');
    },
  });
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

class RootErrorBoundary extends React.Component<{ children: React.ReactNode }, ErrorBoundaryState> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    const msg = error instanceof Error ? `${error.message}\n${error.stack || ''}` : String(error);
    return { hasError: true, errorMessage: msg };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    console.error('Errore critico interfaccia Brew Panda:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-900 text-slate-100 flex items-center justify-center p-6 font-sans">
          <div className="max-w-xl w-full bg-slate-800 border-2 border-amber-500 rounded-xl p-6 shadow-2xl space-y-4">
            <h1 className="text-xl font-bold text-amber-400">
              Avviso di Ripristino Interfaccia — Brew Panda
            </h1>
            <p className="text-sm text-slate-300">
              Si è verificato un errore imprevisto durante il caricamento della schermata. I tuoi dati salvati nell&apos;archivio locale non sono stati toccati.
            </p>
            <pre className="bg-slate-950 text-red-300 p-3 rounded text-xs overflow-auto max-h-48 border border-slate-700">
              {this.state.errorMessage}
            </pre>
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-900 font-bold rounded-lg text-sm"
              >
                Ricarica Applicazione
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Could not find root element to mount to');
}

const AppWrapper = () => (
  <RootErrorBoundary>
    <LanguageProvider>
      <ToastProvider>
        <App />
      </ToastProvider>
    </LanguageProvider>
  </RootErrorBoundary>
);

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <AppWrapper />
  </React.StrictMode>
);
