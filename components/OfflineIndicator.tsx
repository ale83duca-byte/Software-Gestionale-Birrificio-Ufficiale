import React from 'react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();
  const isLocalDesktop =
    typeof window !== 'undefined' &&
    (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost');

  if (isOnline || isLocalDesktop) return null;

  return (
    <div
      role="status"
      className="bg-amber-950/90 border-b border-amber-500/70 px-3 py-1.5 text-center text-xs font-bold text-amber-200 flex items-center justify-center gap-2"
    >
      <span className="inline-block w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
      <span>
        Modalità Offline attiva — Puoi registrare inventario e dati; tutto resta salvato nella memoria del dispositivo.
      </span>
    </div>
  );
};
