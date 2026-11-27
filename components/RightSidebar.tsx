import React, { useState, useEffect, useMemo } from 'react';
import { useTranslation } from '../i18n';
import {
  BrewPandaLogo,
  CubeIcon,
  ClipboardDocumentListIcon,
  CalculatorIcon,
  ChartBarIcon,
  ScaleIcon,
  CylinderStackIcon,
  XMarkIcon,
} from './icons';
import { getSheetData } from '../services/dataService';
import type { PriceDBItem } from '../types';
import { PriceSearchModal } from './PriceSearchModal';
import type { View } from '../App';

interface RightSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  selectedYear: string;
  refreshKey: number;
  onNavigate: (view: View) => void;
  onOpenCoefficients: () => void;
}

const Button: React.FC<{
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  className?: string;
  textClassName?: string;
}> = ({ onClick, icon, label, className, textClassName }) => (
  <button
    type="button"
    onClick={onClick}
    className={`w-full min-h-[42px] flex items-center justify-center px-3 py-2 rounded-md transition-colors text-white font-bold hover:bg-opacity-90 ${className}`}
  >
    {icon}
    <span className={textClassName || 'text-sm'}>{label}</span>
  </button>
);

export const RightSidebar: React.FC<RightSidebarProps> = ({
  isOpen,
  onClose,
  selectedYear,
  refreshKey,
  onNavigate,
  onOpenCoefficients,
}) => {
  const { t } = useTranslation();
  const [priceDb, setPriceDb] = useState<PriceDBItem[]>([]);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    const loadPriceData = async () => {
      if (selectedYear) {
        const data = await getSheetData(selectedYear, 'PRICE_DATABASE');
        setPriceDb((data as PriceDBItem[]) || []);
      }
    };
    loadPriceData();
  }, [selectedYear, refreshKey]);

  const filteredPriceDb = useMemo(() => {
    if (!searchTerm) return [];
    const lowercasedFilter = searchTerm.toLowerCase();
    return priceDb
      .filter(
        (item) =>
          item.NOME.toLowerCase().includes(lowercasedFilter) ||
          item.MARCA.toLowerCase().includes(lowercasedFilter) ||
          item.FORNITORE.toLowerCase().includes(lowercasedFilter)
      )
      .sort((a, b) => a.NOME.localeCompare(b.NOME));
  }, [priceDb, searchTerm]);

  const runAndAutoCloseMobile = (fn: () => void) => {
    fn();
    if (typeof window !== 'undefined' && window.innerWidth < 1280) {
      onClose();
    }
  };

  return (
    <>
      {/* Backdrop per Smartphone e Tablet (< 1280px) */}
      {isOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/60 backdrop-blur-[1px] xl:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside
        className={`fixed inset-y-0 right-0 z-40 w-72 max-w-[85vw] bg-brew-dark flex-shrink-0 flex flex-col border-l border-slate-700 p-3 pb-28 xl:pb-4 overflow-y-auto transition-transform duration-200 ease-out xl:static xl:z-auto xl:w-60 xl:translate-x-0 ${
          isOpen ? 'translate-x-0 flex' : 'translate-x-full hidden xl:hidden'
        }`}
      >
        <div className="flex items-center justify-between xl:hidden mb-2 pb-2 border-b border-slate-700">
          <span className="text-xs font-extrabold uppercase tracking-wider text-brew-accent">
            Commerciale & Vendite
          </span>
          <button
            type="button"
            onClick={onClose}
            className="p-2 min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg text-slate-300 hover:text-white hover:bg-slate-700"
            aria-label="Chiudi colonna commerciale"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="p-1 text-center mb-4 hidden xl:flex flex-col items-center">
          <BrewPandaLogo className="w-24 h-auto mb-2" />
          <h1 className="text-3xl font-bold text-brew-light">
            BREW<span className="text-brew-accent">PANDA</span>
          </h1>
          <p className="text-xs text-slate-400">v2.0.7 ERP</p>
        </div>

        <div className="flex-grow flex flex-col">
          <div className="mb-4">
            <h2 className="text-sm font-bold text-brew-accent mb-2 px-2 text-center">
              {t('rightSidebar.commercialAdminTitle')}
            </h2>
          </div>
          <div className="space-y-2 mb-6">
            <Button
              onClick={() => runAndAutoCloseMobile(() => onNavigate('COST_ANALYSIS'))}
              icon={null}
              label={t('rightSidebar.batchCostButton')}
              className="bg-brew-orange py-3"
              textClassName="text-base"
            />
            <Button
              onClick={() => runAndAutoCloseMobile(() => onNavigate('PRODUCTION_TREND'))}
              icon={null}
              label={t('rightSidebar.productionTrendButton')}
              className="bg-teal-600 hover:bg-teal-500"
            />
            <Button
              onClick={() => runAndAutoCloseMobile(() => onNavigate('QUOTES_LIST'))}
              icon={null}
              label="Preventivi"
              className="bg-brew-blue py-3"
              textClassName="text-base"
            />
            <Button
              onClick={() => runAndAutoCloseMobile(() => onNavigate('EXCISE_INVOICING'))}
              icon={<ScaleIcon className="w-5 h-5 mr-2" />}
              label="Accise ADM & Fatture SDI"
              className="bg-amber-600 hover:bg-amber-500 py-2.5"
              textClassName="text-xs"
            />
          </div>

          <div className="border-t border-slate-700 pt-4">
            <Button
              onClick={() => runAndAutoCloseMobile(onOpenCoefficients)}
              icon={null}
              label={t('rightSidebar.coefficientsButton')}
              className="bg-brew-green mb-4"
            />
            <label
              htmlFor="price-search"
              className="text-sm font-bold text-brew-accent mb-2 px-2 block text-center"
            >
              {t('rightSidebar.priceDbSearchTitle')}
            </label>
            <input
              id="price-search"
              type="text"
              placeholder={t('rightSidebar.priceDbSearchPlaceholder')}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-brew-dark-secondary p-2 rounded-md text-sm focus:ring-2 focus:ring-brew-accent focus:outline-none mb-4"
            />
            <Button
              onClick={() => runAndAutoCloseMobile(() => onNavigate('BEER_PRICE_LIST'))}
              icon={null}
              label="LISTINO PREZZI BIRRE FINITE"
              className="bg-brew-purple py-2 text-xs"
            />
            <Button
              onClick={() => runAndAutoCloseMobile(() => onNavigate('PACKAGED_BEER_ORDERS'))}
              icon={null}
              label="ORDINI BIRRE CONFEZIONATE"
              className="bg-brew-purple py-2 text-xs mt-2"
            />
          </div>

          <div className="mt-auto pt-4 border-t border-slate-700">
            <h2 className="text-sm font-bold text-brew-accent mb-2 px-2 text-center">
              {t('rightSidebar.packagedBeerTitle')}
            </h2>
            <div className="space-y-2">
              <Button
                onClick={() => runAndAutoCloseMobile(() => onNavigate('BEER_WAREHOUSE'))}
                icon={<CubeIcon className="w-5 h-5 mr-2" />}
                label={t('rightSidebar.beerWarehouseButton')}
                className="bg-brew-purple"
              />
              <Button
                onClick={() => runAndAutoCloseMobile(() => onNavigate('SALES_ORDER'))}
                icon={<ClipboardDocumentListIcon className="w-5 h-5 mr-2" />}
                label={t('rightSidebar.salesOrderButton')}
                className="bg-sky-600 hover:bg-sky-500"
              />
              <Button
                onClick={() => runAndAutoCloseMobile(() => onNavigate('KEG_TRACKING'))}
                icon={<CylinderStackIcon className="w-5 h-5 mr-2" />}
                label="Parco Fusti & Cauzioni"
                className="bg-cyan-700 hover:bg-cyan-600"
              />
              <Button
                onClick={() => runAndAutoCloseMobile(() => onNavigate('SALES_TREND'))}
                icon={<ChartBarIcon className="w-5 h-5 mr-2" />}
                label={t('rightSidebar.salesTrendButton')}
                className="bg-rose-600 hover:bg-rose-500"
              />
              <Button
                onClick={() => runAndAutoCloseMobile(() => onNavigate('BEER_INVENTORY'))}
                icon={<CalculatorIcon className="w-5 h-5 mr-2" />}
                label={t('rightSidebar.beerInventoryButton')}
                className="bg-indigo-600 hover:bg-indigo-500"
              />
            </div>
          </div>
        </div>

        <PriceSearchModal
          isOpen={searchTerm.length > 0}
          onClose={() => setSearchTerm('')}
          searchTerm={searchTerm}
          results={filteredPriceDb}
        />
      </aside>
    </>
  );
};
