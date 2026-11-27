import React from 'react';
import { useTranslation } from '../i18n';
import {
  Bars3Icon,
  ChartBarIcon,
  MagnifyingGlassIcon,
  QuestionMarkCircleIcon,
} from './icons';
import { PWAInstallButton } from './PWAInstallButton';

interface HeaderProps {
  selectedYear: string;
  showSaveIndicator: boolean;
  onOpenHelp?: () => void;
  isLeftSidebarOpen: boolean;
  isRightSidebarOpen: boolean;
  onToggleLeftSidebar: () => void;
  onToggleRightSidebar: () => void;
  isMobileSearchOpen?: boolean;
  onToggleMobileSearch?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  selectedYear,
  showSaveIndicator,
  onOpenHelp,
  isLeftSidebarOpen,
  isRightSidebarOpen,
  onToggleLeftSidebar,
  onToggleRightSidebar,
  isMobileSearchOpen = false,
  onToggleMobileSearch,
}) => {
  const { t, changeLanguage, locale } = useTranslation();

  return (
    <header className="bg-brew-dark px-2.5 sm:px-4 py-2 border-b border-slate-700 flex items-center justify-between gap-2 flex-shrink-0">
      {/* Sinistra: Toggle Menu Principale + Lingua */}
      <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
        <button
          type="button"
          onClick={onToggleLeftSidebar}
          aria-expanded={isLeftSidebarOpen}
          aria-label="Apri o chiudi menu principale"
          title={isLeftSidebarOpen ? 'Nascondi Menu Principale' : 'Mostra Menu Principale'}
          className={`min-w-[42px] min-h-[40px] px-2 sm:px-2.5 rounded-lg border flex items-center gap-1.5 text-xs font-extrabold transition-colors ${
            isLeftSidebarOpen
              ? 'bg-brew-accent/20 border-brew-accent/60 text-brew-accent'
              : 'bg-brew-dark-secondary border-slate-600 text-brew-light hover:border-brew-accent'
          }`}
        >
          <Bars3Icon className="w-5 h-5 flex-shrink-0" />
          <span className="hidden md:inline">Menu</span>
        </button>

        <div className="hidden sm:flex items-center space-x-1 bg-brew-dark-secondary p-1 rounded-md">
          <button
            type="button"
            onClick={() => changeLanguage('it')}
            className={`px-2.5 py-1 text-xs font-bold rounded ${
              locale === 'it'
                ? 'bg-brew-accent text-brew-dark'
                : 'text-brew-light hover:bg-slate-600'
            }`}
          >
            IT
          </button>
          <button
            type="button"
            onClick={() => changeLanguage('en')}
            className={`px-2.5 py-1 text-xs font-bold rounded ${
              locale === 'en'
                ? 'bg-brew-accent text-brew-dark'
                : 'text-brew-light hover:bg-slate-600'
            }`}
          >
            EN
          </button>
        </div>
      </div>

      {/* Centro: Anno Attivo */}
      <div className="flex items-center justify-center gap-1.5 min-w-0">
        <h2 className="text-sm sm:text-xl font-bold text-brew-light truncate">
          <span className="hidden sm:inline">{t('header.activeYear')}: </span>
          <span className="sm:hidden">Anno </span>
          <span className="text-brew-accent text-base sm:text-2xl font-black">{selectedYear}</span>
        </h2>
        <div
          className={`transition-opacity duration-500 ${
            showSaveIndicator ? 'opacity-100' : 'opacity-0 pointer-events-none hidden sm:block'
          }`}
        >
          <span className="text-xs sm:text-sm font-semibold text-green-400">
            {t('header.dataSaved')} ✓
          </span>
        </div>
      </div>

      {/* Destra: Ricerca Mobile + Installa App + Guida + Toggle Commerciale */}
      <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
        {onToggleMobileSearch && (
          <button
            type="button"
            onClick={onToggleMobileSearch}
            aria-expanded={isMobileSearchOpen}
            aria-label="Cerca movimento o apri lotto"
            title="Cerca Movimento / Apri Lotto"
            className={`lg:hidden min-w-[40px] min-h-[40px] px-2 rounded-lg border flex items-center gap-1 text-xs font-extrabold transition-colors ${
              isMobileSearchOpen
                ? 'bg-brew-orange text-white border-brew-orange'
                : 'bg-brew-dark-secondary border-slate-600 text-brew-light hover:border-brew-accent'
            }`}
          >
            <MagnifyingGlassIcon className="w-4 h-4 flex-shrink-0" />
            <span className="hidden sm:inline">Cerca</span>
          </button>
        )}

        <PWAInstallButton variant="header" />

        {onOpenHelp && (
          <button
            type="button"
            onClick={onOpenHelp}
            className="min-w-[40px] min-h-[40px] flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500 text-amber-300 hover:text-brew-dark border border-amber-500/60 text-xs font-extrabold transition-all shadow-sm"
            title="Apri la spiegazione su come utilizzare e gestire questa pagina"
          >
            <QuestionMarkCircleIcon className="w-4 h-4 flex-shrink-0" />
            <span className="hidden lg:inline">Come funziona questa pagina?</span>
          </button>
        )}

        <button
          type="button"
          onClick={onToggleRightSidebar}
          aria-expanded={isRightSidebarOpen}
          aria-label="Apri o chiudi colonna amministrazione commerciale"
          title={
            isRightSidebarOpen
              ? 'Nascondi Amministrazione Commerciale'
              : 'Mostra Amministrazione Commerciale'
          }
          className={`min-w-[42px] min-h-[40px] px-2 sm:px-2.5 rounded-lg border flex items-center gap-1.5 text-xs font-extrabold transition-colors ${
            isRightSidebarOpen
              ? 'bg-brew-accent/20 border-brew-accent/60 text-brew-accent'
              : 'bg-brew-dark-secondary border-slate-600 text-brew-light hover:border-brew-accent'
          }`}
        >
          <ChartBarIcon className="w-5 h-5 flex-shrink-0" />
          <span className="hidden md:inline">Commerciale</span>
        </button>
      </div>
    </header>
  );
};
