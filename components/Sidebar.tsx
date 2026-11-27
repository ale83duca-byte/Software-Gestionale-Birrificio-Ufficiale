import React from 'react';
import type { View } from '../App';
import {
  HouseIcon,
  DocumentTextIcon,
  ArchiveBoxIcon,
  TruckIcon,
  BeakerIcon,
  TableCellsIcon,
  BrewPandaLogo,
  ArrowPathIcon,
  CylinderStackIcon,
  ArrowDownTrayIcon,
  ArrowUpTrayIcon,
  ArrowDownIcon,
  CalendarDaysIcon,
  ShieldCheckIcon,
  FireIcon,
  WrenchIcon,
  DevicePhoneMobileIcon,
  XMarkIcon,
} from './icons';
import { useTranslation } from '../i18n';
import { downloadLogoAsPng } from '../utils/imageExport';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  years: string[];
  selectedYear: string;
  activeView: View;
  onYearSelect: (year: string) => void;
  onNewYear: () => void;
  onNavigate: (view: View) => void;
  onNewLotto: () => void;
  onLoadGoods: () => void;
  onDischargeGoods: () => void;
  onExportYear: () => void;
  onRefresh: () => void;
  onExportAllData: () => void;
  onImportData: () => void;
  onOpenCalibrationWizard?: () => void;
  onFactoryReset: () => void;
}

const NavButton: React.FC<{
  icon: React.ReactNode;
  label: string;
  isActive: boolean;
  onClick: () => void;
  isAction?: boolean;
  highlightClassName?: string;
}> = ({ icon, label, isActive, onClick, isAction = false, highlightClassName }) => (
  <li>
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center px-3 py-2.5 lg:py-2 min-h-[42px] lg:min-h-0 rounded-md text-sm transition-colors text-left ${
        isActive
          ? 'bg-brew-accent text-brew-dark font-bold'
          : highlightClassName
          ? highlightClassName
          : isAction
          ? 'hover:bg-brew-orange/20 text-brew-orange'
          : 'hover:bg-brew-dark-secondary text-brew-light'
      }`}
    >
      <span className="w-6 h-6 mr-3 flex-shrink-0">{icon}</span>
      <span className="leading-snug">{label}</span>
    </button>
  </li>
);

export const Sidebar: React.FC<SidebarProps> = ({
  isOpen,
  onClose,
  years,
  selectedYear,
  activeView,
  onYearSelect,
  onNewYear,
  onNavigate,
  onNewLotto,
  onLoadGoods,
  onDischargeGoods,
  onExportYear,
  onRefresh,
  onExportAllData,
  onImportData,
  onOpenCalibrationWizard,
  onFactoryReset,
}) => {
  const { t, changeLanguage, locale } = useTranslation();

  const runAndAutoCloseMobile = (fn: () => void) => {
    fn();
    if (typeof window !== 'undefined' && window.innerWidth < 1024) {
      onClose();
    }
  };

  return (
    <>
      {/* Backdrop per Smartphone e Tablet (< 1024px) */}
      {isOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/60 backdrop-blur-[1px] lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 w-72 max-w-[85vw] bg-brew-dark flex-shrink-0 flex flex-col border-r border-slate-700 p-3 overflow-y-auto transition-transform duration-200 ease-out lg:static lg:z-auto lg:w-60 lg:translate-x-0 ${
          isOpen ? 'translate-x-0 flex' : '-translate-x-full hidden lg:hidden'
        }`}
      >
        <div className="flex items-center justify-between lg:hidden mb-2 pb-2 border-b border-slate-700">
          <div className="flex items-center space-x-1 bg-brew-dark-secondary p-1 rounded-md">
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
          <button
            type="button"
            onClick={onClose}
            className="p-2 min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg text-slate-300 hover:text-white hover:bg-slate-700"
            aria-label="Chiudi menu"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="p-1 text-center mb-4 flex flex-col items-center">
          <div id="app-logo-container">
            <BrewPandaLogo className="w-20 lg:w-24 h-auto mb-2" />
          </div>
          <h1 className="text-2xl lg:text-3xl font-bold text-brew-light leading-none">
            BREW<span className="text-brew-accent">PANDA</span>
          </h1>
          <p className="text-xs text-emerald-400 font-semibold mt-1">v2.0.7 ERP Offline</p>
          <button
            type="button"
            onClick={() => downloadLogoAsPng('app-logo-container')}
            className="mt-2 hidden lg:flex items-center gap-1 text-[10px] font-bold text-brew-accent hover:text-white transition-colors bg-brew-dark-secondary px-2 py-1 rounded border border-slate-600 shadow-sm"
            title="Scarica l'icona in formato PNG per il tuo desktop"
          >
            <ArrowDownIcon className="w-3 h-3" /> SCARICA ICONA
          </button>
        </div>

        <div className="mb-6">
          <h2 className="text-sm font-bold text-brew-accent mb-2 px-2">{t('sidebar.mainMenu')}</h2>
          <ul className="space-y-1">
            <NavButton
              icon={<HouseIcon />}
              label={t('sidebar.home')}
              isActive={activeView === 'HOME'}
              onClick={() => runAndAutoCloseMobile(() => onNavigate('HOME'))}
            />
            <NavButton
              icon={<DocumentTextIcon />}
              label={t('sidebar.movements')}
              isActive={activeView === 'MOVEMENTS'}
              onClick={() => runAndAutoCloseMobile(() => onNavigate('MOVEMENTS'))}
            />
            <NavButton
              icon={<ArchiveBoxIcon />}
              label={t('sidebar.warehouse')}
              isActive={activeView === 'WAREHOUSE'}
              onClick={() => runAndAutoCloseMobile(() => onNavigate('WAREHOUSE'))}
            />
            <NavButton
              icon={<ShieldCheckIcon />}
              label="Tracciabilità HACCP"
              isActive={activeView === 'TRACEABILITY'}
              onClick={() => runAndAutoCloseMobile(() => onNavigate('TRACEABILITY'))}
            />
            <NavButton
              icon={<CylinderStackIcon />}
              label="Parco Fusti Inox"
              isActive={activeView === 'KEG_TRACKING'}
              onClick={() => runAndAutoCloseMobile(() => onNavigate('KEG_TRACKING'))}
            />
            <NavButton
              icon={<FireIcon className="text-orange-400" />}
              label="Scarico / Cisterna Gas"
              isActive={activeView === 'GAS_TANK'}
              onClick={() => runAndAutoCloseMobile(() => onNavigate('GAS_TANK'))}
            />
            <NavButton
              icon={<TruckIcon style={{ transform: 'scaleX(-1)' }} />}
              label={t('sidebar.loadGoods')}
              isActive={false}
              onClick={() => runAndAutoCloseMobile(onLoadGoods)}
            />
            <NavButton
              icon={<TruckIcon />}
              label={t('sidebar.dischargeGoods')}
              isActive={false}
              onClick={() => runAndAutoCloseMobile(onDischargeGoods)}
              isAction={true}
            />
            <NavButton
              icon={<TableCellsIcon />}
              label={t('sidebar.exportYear')}
              isActive={false}
              onClick={() => runAndAutoCloseMobile(onExportYear)}
            />
            <NavButton
              icon={<ArrowDownTrayIcon />}
              label={t('sidebar.exportAllData')}
              isActive={false}
              onClick={() => runAndAutoCloseMobile(onExportAllData)}
            />
            <NavButton
              icon={<ArrowUpTrayIcon />}
              label={t('sidebar.importData')}
              isActive={false}
              onClick={() => runAndAutoCloseMobile(onImportData)}
            />
            {onOpenCalibrationWizard && (
              <NavButton
                icon={<WrenchIcon className="text-amber-400" />}
                label="Taratura Moduli"
                isActive={false}
                onClick={() => runAndAutoCloseMobile(onOpenCalibrationWizard)}
              />
            )}
            <NavButton
              icon={<ArrowPathIcon />}
              label={t('sidebar.refreshData')}
              isActive={false}
              onClick={() => runAndAutoCloseMobile(onRefresh)}
            />
            <NavButton
              icon={<DevicePhoneMobileIcon className="text-emerald-400" />}
              label="App Tablet & Netlify (QR)"
              isActive={activeView === 'NETLIFY_GUIDE'}
              highlightClassName="hover:bg-emerald-700/30 text-emerald-300 border border-emerald-700/40"
              onClick={() => runAndAutoCloseMobile(() => onNavigate('NETLIFY_GUIDE'))}
            />
          </ul>
        </div>

        <div className="mb-6">
          <h2 className="text-sm font-bold text-brew-accent mb-2 px-2">
            {t('sidebar.productionManagement')}
          </h2>
          <button
            type="button"
            onClick={() => runAndAutoCloseMobile(onNewLotto)}
            className="w-full flex items-center justify-center px-3 py-3 rounded-md text-base lg:text-lg transition-colors bg-brew-orange text-white font-bold hover:bg-opacity-90 mb-2"
          >
            <BeakerIcon className="w-6 h-6 mr-2" /> {t('sidebar.newBrew')}
          </button>
          <button
            type="button"
            onClick={() => runAndAutoCloseMobile(() => onNavigate('CANTINA'))}
            className="w-full flex items-center justify-center px-3 py-3 rounded-md text-base lg:text-lg transition-colors bg-brew-blue text-white font-bold hover:bg-opacity-90 mb-2"
          >
            <CylinderStackIcon className="w-6 h-6 mr-2" /> {t('sidebar.cellarManagement')}
          </button>
          <button
            type="button"
            onClick={() => runAndAutoCloseMobile(() => onNavigate('DATABASE'))}
            className={`w-full flex items-center justify-center px-3 py-3 rounded-md text-base lg:text-lg transition-colors font-bold mb-2 ${
              activeView === 'DATABASE'
                ? 'bg-brew-accent text-brew-dark'
                : 'bg-slate-600 text-white hover:bg-slate-500'
            }`}
          >
            {t('sidebar.clientBeerDb')}
          </button>
          <button
            type="button"
            onClick={() => runAndAutoCloseMobile(() => onNavigate('CALENDAR'))}
            className={`w-full flex items-center justify-center px-3 py-3 rounded-md text-base lg:text-lg transition-colors font-bold mb-2 shadow-sm ${
              activeView === 'CALENDAR'
                ? 'bg-brew-accent text-brew-dark'
                : 'bg-emerald-700 text-white hover:bg-emerald-600'
            }`}
          >
            <CalendarDaysIcon className="w-6 h-6 mr-2" /> CALENDARIO
          </button>
        </div>

        <div className="mt-auto">
          <h2 className="text-sm font-bold text-brew-accent mb-2 px-2">
            📅 {t('sidebar.yearArchive')}
          </h2>
          <ul className="space-y-1 max-h-40 overflow-y-auto pr-1">
            {years.map((year) => (
              <li key={year}>
                <button
                  type="button"
                  onClick={() => runAndAutoCloseMobile(() => onYearSelect(year))}
                  className={`w-full text-left px-3 py-2 lg:py-1.5 rounded-md text-sm transition-colors ${
                    selectedYear === year
                      ? 'bg-brew-blue text-white font-bold'
                      : 'hover:bg-brew-dark-secondary'
                  }`}
                >
                  {year}
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => runAndAutoCloseMobile(onNewYear)}
            className="w-full mt-3 bg-brew-green text-white font-bold py-2.5 lg:py-2 px-4 rounded-md text-sm hover:bg-opacity-80 transition-all"
          >
            ➕ {t('sidebar.createNewYear')}
          </button>
          <button
            type="button"
            onClick={() => runAndAutoCloseMobile(onFactoryReset)}
            className="w-full mt-3 bg-brew-red text-black font-bold py-2.5 lg:py-2 px-4 rounded-md text-sm hover:bg-opacity-80 transition-all"
          >
            💣 Programma Base
          </button>
          <div className="mt-4 pt-2.5 border-t border-slate-700/60 text-center">
            <span className="text-[11px] text-slate-300 font-mono font-bold">
              Brew Panda v2.0.7 ERP
            </span>
            <span className="text-[10px] text-slate-400 block mt-0.5">
              HACCP · Fusti · Gas · ADM · SDI
            </span>
          </div>
        </div>
      </aside>
    </>
  );
};
