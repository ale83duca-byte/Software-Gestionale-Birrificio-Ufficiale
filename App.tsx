

import { useState, useEffect, useCallback } from 'react';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { Home } from './components/Home';
import { MovementsView } from './components/MovementsView';
import { WarehouseView } from './components/WarehouseView';
import { CantinaView } from './components/CantinaView';
import BrewPage from './components/BrewPage';
import { NewYearModal } from './components/NewYearModal';
import { LoadGoodsModal } from './components/LoadGoodsModal';
import { DischargeGoodsModal } from './components/DischargeGoodsModal';
import { DatabaseView } from './components/DatabaseView';
// FIX: import `importAllBreweryData` to resolve missing name error.
import { getYears as fetchYears, initializeCurrentYearData, getBreweryData, getAllBreweryData, checkAndProcessWarehouseStatus, checkLottoExists, importAllBreweryData } from './services/dataService';
import { migrateFromLocalStorage, factoryReset } from './services/db';
import { BrewPandaLogo } from './components/icons';
import { excel } from './utils/excelExport';
import type { WarehouseStatus, PlannedBrew } from './types';
import { useToast } from './hooks/useToast';
import { RightSidebar } from './components/RightSidebar';
import { useTranslation } from './i18n';
import { CostAnalysisView } from './components/CostAnalysisView';
import { CoefficientsModal } from './components/CoefficientsModal';
import { LottoActionModal } from './components/LottoActionModal';
import { ProductionTrendView } from './components/ProductionTrendView';
import { BrewQuoteView } from './components/BrewQuoteView';
import { QuotesListView } from './components/QuotesListView';
import { BeerWarehouseView } from './components/BeerWarehouseView';
import { SalesOrderView } from './components/SalesOrderView';
import { BeerInventoryView } from './components/BeerInventoryView';
import { SalesTrendView } from './components/SalesTrendView';
import { FactoryResetModal } from './components/FactoryResetModal';

import { BeerPriceListView } from './components/BeerPriceListView';
import { PackagedBeerOrdersView } from './components/PackagedBeerOrdersView';
import { CalendarView } from './components/CalendarView';
import { TraceabilityView } from './components/TraceabilityView';
import { KegTrackingView } from './components/KegTrackingView';
import { ExciseAndInvoicingView } from './components/ExciseAndInvoicingView';
import { GasTankView } from './components/GasTankView';
import { PageHelpModal } from './components/PageHelpModal';
import PostImportSetupModal from './components/PostImportSetupModal';
import { NetlifyDeployGuideView } from './components/NetlifyDeployGuideView';
import { ExportBackupShareModal, PreparedBackupPayload } from './components/ExportBackupShareModal';
import { OfflineIndicator } from './components/OfflineIndicator';

export type View = 'HOME' | 'MOVEMENTS' | 'WAREHOUSE' | 'BREW_PAGE' | 'CANTINA' | 'DATABASE' | 'COST_ANALYSIS' | 'PRODUCTION_TREND' | 'BREW_QUOTE' | 'QUOTES_LIST' | 'BEER_WAREHOUSE' | 'SALES_ORDER' | 'BEER_INVENTORY' | 'SALES_TREND' | 'BEER_PRICE_LIST' | 'PACKAGED_BEER_ORDERS' | 'CALENDAR' | 'TRACEABILITY' | 'KEG_TRACKING' | 'EXCISE_INVOICING' | 'GAS_TANK' | 'NETLIFY_GUIDE';

export default function App() {
    const [years, setYears] = useState<string[]>([]);
    const [selectedYear, setSelectedYear] = useState<string>(new Date().getFullYear().toString());
    const [activeView, setActiveView] = useState<View>('HOME');
    const [editingLottoId, setEditingLottoId] = useState<string | null>(null);
    const [editingQuoteId, setEditingQuoteId] = useState<string | null>(null);
    const [preselectedLottoId, setPreselectedLottoId] = useState<string | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [lottoSearchTerm, setLottoSearchTerm] = useState('');

    const [isNewYearModalOpen, setNewYearModalOpen] = useState(false);
    const [isLoadGoodsModalOpen, setLoadGoodsModalOpen] = useState(false);
    const [isDischargeGoodsModalOpen, setDischargeGoodsModalOpen] = useState(false);
    const [isCoefficientsModalOpen, setCoefficientsModalOpen] = useState(false);
    const [isFactoryResetModalOpen, setFactoryResetModalOpen] = useState(false);
    const [isHelpModalOpen, setHelpModalOpen] = useState(false);
    const [isCalibrationModalOpen, setCalibrationModalOpen] = useState(false);
    const [preparedBackup, setPreparedBackup] = useState<PreparedBackupPayload | null>(null);
    const [isLeftSidebarOpen, setLeftSidebarOpen] = useState<boolean>(() =>
        typeof window !== 'undefined' ? window.innerWidth >= 1024 : true
    );
    const [isRightSidebarOpen, setRightSidebarOpen] = useState<boolean>(() =>
        typeof window !== 'undefined' ? window.innerWidth >= 1280 : true
    );
    const [isMobileSearchOpen, setMobileSearchOpen] = useState(false);
    const isNetlifyHost =
        typeof window !== 'undefined' && window.location.hostname.endsWith('.netlify.app');
    const [lottoActionModal, setLottoActionModal] = useState<{ isOpen: boolean, lottoId: string | null }>({ isOpen: false, lottoId: null });
    const [isLoading, setIsLoading] = useState(true);
    const [loadingMessage, setLoadingMessage] = useState('Caricamento Brew Panda...');
    const [refreshKey, setRefreshKey] = useState(0);
    const [warehouseStatus, setWarehouseStatus] = useState<WarehouseStatus | null>(null);
    const [showSaveIndicator, setShowSaveIndicator] = useState(false);
    const { showToast } = useToast();
    const { t } = useTranslation();

    const handleRefresh = useCallback(() => setRefreshKey(prev => prev + 1), []);

    const refreshYears = useCallback(async () => {
        const availableYears = await fetchYears();
        setYears(availableYears);
        if (availableYears.length > 0 && !availableYears.includes(selectedYear)) {
            setSelectedYear(availableYears[0]);
        }
        return availableYears;
    }, [selectedYear]);

    const checkWarehouse = useCallback(async (year: string) => {
        const status = await checkAndProcessWarehouseStatus(year);
        setWarehouseStatus(status);

        if (status.dischargedItems.length > 0) {
            const dischargedSummary = status.dischargedItems.map(item => `${item.nome} (Lotto: ${item.lotto})`).join(', ');
            showToast(t('toast.expiredLotsDischarged', { summary: dischargedSummary }), 'warning');
            handleRefresh();
        }
    }, [handleRefresh, showToast, t]);

    useEffect(() => {
        const initializeApp = async () => {
            setIsLoading(true);
            try {
                setLoadingMessage(t('loading.migratingDb'));
                const migrated = await migrateFromLocalStorage();
                if (migrated) {
                    showToast(t('toast.dbUpdated'), 'success');
                }

                setLoadingMessage(t('loading.initializingYear'));
                await initializeCurrentYearData();
                
                setLoadingMessage(t('loading.loadingData'));
                const availableYears = await refreshYears();
                const yearToLoad = availableYears.includes(selectedYear) ? selectedYear : availableYears[0];

                if (yearToLoad) {
                    await checkWarehouse(yearToLoad);
                }

                if (localStorage.getItem('brewpanda_pending_post_import_wizard') === '1') {
                    setCalibrationModalOpen(true);
                }
            } catch (err) {
                console.error('Errore durante inizializzazione Brew Panda:', err);
            } finally {
                setIsLoading(false);
            }
        };
        
        initializeApp();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    
    useEffect(() => {
       const loadYearData = async () => {
         if(!isLoading) { // Prevent running on initial load
            setIsLoading(true);
            await checkWarehouse(selectedYear);
            handleRefresh();
            setIsLoading(false);
         }
       };
       loadYearData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedYear]);

    useEffect(() => {
        const isLocalDesktop =
            window.location.hostname === '127.0.0.1' ||
            window.location.hostname === 'localhost';

        // Pulizia sicura delle vecchie cache manuali HTTP/SW (senza mai toccare IndexedDB né la cache Workbox PWA su Netlify)
        if ('caches' in window) {
            caches.keys().then(keys => {
                keys.forEach(key => {
                    if (isLocalDesktop) {
                        caches.delete(key).catch(() => {});
                    } else if (!key.startsWith('workbox-')) {
                        caches.delete(key).catch(() => {});
                    }
                });
            }).catch(() => {});
        }

        if ('serviceWorker' in navigator) {
            if (isLocalDesktop) {
                // In modalità Desktop Offline (127.0.0.1:3000) il server Node locale serve già tutti i file da disco:
                // rimuoviamo qualsiasi vecchio Service Worker per impedire schermate bianche o cache bloccate.
                navigator.serviceWorker.getRegistrations().then(regs => {
                    regs.forEach(reg => {
                        reg.unregister().catch(() => {});
                    });
                }).catch(() => {});
            } else {
                navigator.serviceWorker.getRegistrations().then(regs => {
                    regs.forEach(reg => reg.update().catch(() => {}));
                }).catch(() => {});
            }
        }
        
        const handleDataSaved = () => {
            setShowSaveIndicator(true);
            const timer = setTimeout(() => setShowSaveIndicator(false), 2000);
            return () => clearTimeout(timer);
        };

        window.addEventListener('data-saved', handleDataSaved);
        return () => window.removeEventListener('data-saved', handleDataSaved);
    }, []);

    const handleYearChange = (year: string) => {
        setSelectedYear(year);
        setActiveView('HOME');
    };

    const [plannedBrewToStart, setPlannedBrewToStart] = useState<PlannedBrew | null>(null);

    const handleNewLotto = () => {
        setEditingLottoId(null);
        setPlannedBrewToStart(null);
        setActiveView('BREW_PAGE');
    };

    const handleStartPlannedBrew = (plannedBrew?: PlannedBrew) => {
        setEditingLottoId(null);
        setPlannedBrewToStart(plannedBrew || null);
        setActiveView('BREW_PAGE');
    };

    const handleOpenLotto = (lottoId: string) => {
        setEditingLottoId(lottoId);
        setPlannedBrewToStart(null);
        setActiveView('BREW_PAGE');
    };

    const handleSaveNewLotto = (newLottoId: string) => {
        setEditingLottoId(newLottoId);
    };
    
    const handleLottoSearch = async () => {
        const searchTerm = lottoSearchTerm.trim().toUpperCase();
        if(!searchTerm) return;

        const lottoExists = await checkLottoExists(selectedYear, searchTerm);

        if (lottoExists) {
            setLottoActionModal({ isOpen: true, lottoId: searchTerm });
        } else {
            showToast(t('toast.lottoNotFound', { lottoId: searchTerm }), 'error');
        }
    }

    const openLottoCostAnalysis = (lottoId: string) => {
        setPreselectedLottoId(lottoId);
        setActiveView('COST_ANALYSIS');
    };

    const handleExportYear = async () => {
        const data = await getBreweryData(selectedYear);
        if (data) {
           excel(data, selectedYear);
        } else {
            showToast(t('toast.noDataForYear', { year: selectedYear }), 'error');
        }
    };

    const handleExportAllData = async () => {
        try {
            const allData = await getAllBreweryData();
            const exportedYears = Object.keys(allData).sort();
            if (exportedYears.length === 0) {
                showToast("Nessun dato da esportare.", 'warning');
                return;
            }

            const jsonString = JSON.stringify(allData, null, 2);
            const date = new Date().toISOString().slice(0, 10);
            const filename = `brewpanda_all_data_backup_${date}.json`;
            const sizeKb = Math.max(1, Math.round(new Blob([jsonString]).size / 1024));

            setPreparedBackup({
                filename,
                jsonString,
                years: exportedYears,
                sizeKb,
            });
        } catch (error) {
            console.error('Export failed:', error);
            showToast(t('toast.exportError'), 'error');
        }
    };

    const handleImportData = () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = (event) => {
            const file = (event.target as HTMLInputElement).files?.[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const text = e.target?.result;
                    if (typeof text !== 'string') throw new Error(t('errors.fileNotReadable'));
                    
                    const data = JSON.parse(text);

                    if (typeof data !== 'object' || data === null) {
                        throw new Error(t('errors.invalidBackupFile'));
                    }
                    
                    if (window.confirm(t('confirmations.import'))) {
                        setIsLoading(true);
                        setLoadingMessage('Importazione e normalizzazione archivio in corso...');
                        const { importedYears, hadLegacyMissingModules } = await importAllBreweryData(data);
                        const availableYears = await fetchYears();
                        setYears(availableYears);
                        const targetYear = importedYears.length > 0
                            ? importedYears[importedYears.length - 1]
                            : (availableYears[availableYears.length - 1] || selectedYear);
                        setSelectedYear(targetYear);
                        await checkWarehouse(targetYear);
                        setActiveView('HOME');
                        handleRefresh();
                        setIsLoading(false);
                        showToast(`${t('toast.dataImported')} (Anni: ${importedYears.join(', ')})`, 'success');
                        if (hadLegacyMissingModules) {
                            setCalibrationModalOpen(true);
                        }
                    }
                } catch (error) {
                    setIsLoading(false);
                    console.error('Import failed:', error);
                    const errorMessage = error instanceof Error ? error.message : t('errors.unknown');
                    showToast(t('toast.importError', { message: errorMessage }), 'error');
                }
            };
            reader.readAsText(file);
        };
        input.click();
    };

    const handleConfirmFactoryReset = async () => {
        await factoryReset();
        showToast("Programma ripristinato. Ricaricamento in corso...", "success");
        setTimeout(() => {
            window.location.reload();
        }, 2000);
    };


    const renderView = () => {
        switch (activeView) {
            case 'HOME':
                return <Home key={refreshKey} warehouseStatus={warehouseStatus} selectedYear={selectedYear} onRefresh={handleRefresh} onNavigate={setActiveView} />;
            case 'CALENDAR':
                return <CalendarView 
                            key={`${selectedYear}-${refreshKey}`} 
                            selectedYear={selectedYear} 
                            onOpenLotto={handleOpenLotto} 
                            onNavigateToCantina={() => setActiveView('CANTINA')} 
                            onNavigateToBrew={(pb) => handleStartPlannedBrew(pb)}
                        />;
            case 'MOVEMENTS':
                return <MovementsView key={`${selectedYear}-${refreshKey}`} selectedYear={selectedYear} searchTerm={searchTerm} onRefresh={handleRefresh} />;
            case 'WAREHOUSE':
                return <WarehouseView key={`${selectedYear}-${refreshKey}`} selectedYear={selectedYear} warehouseStatus={warehouseStatus || undefined} />;
            case 'CANTINA':
                return <CantinaView key={`${selectedYear}-${refreshKey}`} selectedYear={selectedYear} onOpenLotto={handleOpenLotto} />;
            case 'BREW_PAGE':
                return <BrewPage 
                            key={`${selectedYear}-${editingLottoId || (plannedBrewToStart ? `planned-${plannedBrewToStart.id}` : 'new')}-${refreshKey}`} 
                            selectedYear={selectedYear} 
                            lottoId={editingLottoId} 
                            initialPlannedBrew={plannedBrewToStart}
                            onClearPlannedBrew={() => setPlannedBrewToStart(null)}
                            onExit={() => {
                                setPlannedBrewToStart(null);
                                checkWarehouse(selectedYear);
                                handleRefresh();
                                setActiveView('HOME');
                            }} 
                            onSaveNewLotto={handleSaveNewLotto} 
                        />;
            case 'DATABASE':
                return <DatabaseView key={`${selectedYear}-${refreshKey}`} selectedYear={selectedYear} />;
            case 'COST_ANALYSIS':
                return <CostAnalysisView key={`${selectedYear}-${refreshKey}`} selectedYear={selectedYear} lottoToOpenId={preselectedLottoId} onExit={() => { setActiveView('HOME'); setPreselectedLottoId(null); }} />;
             case 'PRODUCTION_TREND':
                return <ProductionTrendView 
                            key={`${selectedYear}-${refreshKey}`} 
                            selectedYear={selectedYear} 
                            onExit={() => setActiveView('HOME')} 
                            onNavigateToCalendar={() => setActiveView('CALENDAR')}
                        />;
            case 'QUOTES_LIST':
                return <QuotesListView 
                            key={`${selectedYear}-${refreshKey}`} 
                            selectedYear={selectedYear} 
                            onNewQuote={() => { setEditingQuoteId(null); setActiveView('BREW_QUOTE'); }}
                            onOpenQuote={(id) => { setEditingQuoteId(id); setActiveView('BREW_QUOTE'); }}
                        />;
            case 'BREW_QUOTE':
                return <BrewQuoteView 
                            key={`${selectedYear}-${editingQuoteId || 'new'}-${refreshKey}`} 
                            selectedYear={selectedYear} 
                            quoteId={editingQuoteId}
                            onExit={() => setActiveView('QUOTES_LIST')} 
                        />;
            case 'BEER_WAREHOUSE':
                return <BeerWarehouseView key={`${selectedYear}-${refreshKey}`} selectedYear={selectedYear} />;
            case 'SALES_ORDER':
                return <SalesOrderView key={`${selectedYear}-${refreshKey}`} selectedYear={selectedYear} onRefresh={handleRefresh} />;
            case 'BEER_INVENTORY':
                return <BeerInventoryView key={`${selectedYear}-${refreshKey}`} selectedYear={selectedYear} onRefresh={handleRefresh} />;
            case 'SALES_TREND':
                return <SalesTrendView key={`${selectedYear}-${refreshKey}`} selectedYear={selectedYear} />;
            case 'BEER_PRICE_LIST':
                return <BeerPriceListView key={`${selectedYear}-${refreshKey}`} selectedYear={selectedYear} />;
            case 'PACKAGED_BEER_ORDERS':
                return <PackagedBeerOrdersView key={`${selectedYear}-${refreshKey}`} selectedYear={selectedYear} onRefresh={handleRefresh} />;
            case 'TRACEABILITY':
                return <TraceabilityView key={`${selectedYear}-${refreshKey}`} selectedYear={selectedYear} onOpenLotto={handleOpenLotto} />;
            case 'KEG_TRACKING':
                return <KegTrackingView key={`${selectedYear}-${refreshKey}`} selectedYear={selectedYear} onRefresh={handleRefresh} />;
            case 'EXCISE_INVOICING':
                return <ExciseAndInvoicingView key={`${selectedYear}-${refreshKey}`} selectedYear={selectedYear} onRefresh={handleRefresh} />;
            case 'GAS_TANK':
                return <GasTankView key={`${selectedYear}-${refreshKey}`} selectedYear={selectedYear} onRefresh={handleRefresh} />;
            case 'NETLIFY_GUIDE':
                return <NetlifyDeployGuideView />;
            default:
                return <Home key={refreshKey} warehouseStatus={warehouseStatus} selectedYear={selectedYear} onRefresh={handleRefresh} onNavigate={setActiveView} />;
        }
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-screen bg-brew-dark text-brew-accent">
                <BrewPandaLogo className="w-24 h-auto animate-pulse" />
                <h1 className="text-4xl font-bold ml-4">{loadingMessage}</h1>
            </div>
        );
    }
    
    return (
        <div className="flex h-screen supports-[height:100dvh]:h-[100dvh] bg-brew-dark text-brew-light font-sans overflow-hidden">
            <Sidebar
                isOpen={isLeftSidebarOpen}
                onClose={() => setLeftSidebarOpen(false)}
                years={years}
                selectedYear={selectedYear}
                activeView={activeView}
                onYearSelect={handleYearChange}
                onNewYear={() => setNewYearModalOpen(true)}
                onNavigate={setActiveView}
                onNewLotto={handleNewLotto}
                onLoadGoods={() => setLoadGoodsModalOpen(true)}
                onDischargeGoods={() => setDischargeGoodsModalOpen(true)}
                onExportYear={handleExportYear}
                onRefresh={() => { checkWarehouse(selectedYear); handleRefresh(); }}
                onExportAllData={handleExportAllData}
                onImportData={handleImportData}
                onOpenCalibrationWizard={() => setCalibrationModalOpen(true)}
                onFactoryReset={() => setFactoryResetModalOpen(true)}
            />
            <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
                <Header 
                    selectedYear={selectedYear}
                    showSaveIndicator={showSaveIndicator}
                    onOpenHelp={() => setHelpModalOpen(true)}
                    isLeftSidebarOpen={isLeftSidebarOpen}
                    isRightSidebarOpen={isRightSidebarOpen}
                    onToggleLeftSidebar={() => setLeftSidebarOpen(prev => !prev)}
                    onToggleRightSidebar={() => setRightSidebarOpen(prev => !prev)}
                    isMobileSearchOpen={isMobileSearchOpen}
                    onToggleMobileSearch={() => setMobileSearchOpen(prev => !prev)}
                />
                {isMobileSearchOpen && (
                    <div className="lg:hidden bg-brew-dark px-3 py-2.5 border-b border-slate-700 space-y-2 shadow-lg flex-shrink-0">
                        <div className="flex items-center gap-2">
                            <label htmlFor="search-mobile-top" className="text-xs font-semibold whitespace-nowrap min-w-[96px]">{t('footer.searchMovement')}:</label>
                            <input
                                id="search-mobile-top"
                                type="text"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                        setActiveView('MOVEMENTS');
                                        setMobileSearchOpen(false);
                                    }
                                }}
                                placeholder="Cerca movimento..."
                                className="bg-brew-dark-secondary px-2.5 py-2 rounded-md text-sm flex-1 min-w-0 min-h-[40px] focus:ring-2 focus:ring-brew-accent focus:outline-none"
                            />
                            <button
                                type="button"
                                onClick={() => {
                                    setActiveView('MOVEMENTS');
                                    setMobileSearchOpen(false);
                                }}
                                className="px-3.5 py-2 min-h-[40px] bg-brew-blue rounded-md text-sm font-bold hover:bg-opacity-80"
                            >
                                🔍
                            </button>
                        </div>
                        <div className="flex items-center gap-2">
                            <label htmlFor="lottoSearch-mobile-top" className="text-xs font-semibold whitespace-nowrap min-w-[96px]">{t('footer.openLotto')}:</label>
                            <input
                                id="lottoSearch-mobile-top"
                                type="text"
                                value={lottoSearchTerm}
                                onChange={(e) => setLottoSearchTerm(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                        handleLottoSearch();
                                        setMobileSearchOpen(false);
                                    }
                                }}
                                placeholder="Es. L26-01"
                                className="bg-yellow-100 text-slate-900 px-2.5 py-2 rounded-md text-sm flex-1 min-w-0 min-h-[40px] focus:ring-2 focus:ring-brew-orange focus:outline-none"
                            />
                            <button
                                type="button"
                                onClick={() => {
                                    handleLottoSearch();
                                    setMobileSearchOpen(false);
                                }}
                                className="px-3.5 py-2 min-h-[40px] bg-brew-orange rounded-md text-sm font-bold hover:bg-opacity-80"
                            >
                                {t('footer.open')}
                            </button>
                        </div>
                    </div>
                )}
                <OfflineIndicator />
                <div className="flex-1 p-2.5 sm:p-5 lg:p-6 pb-28 lg:pb-8 overflow-y-auto bg-brew-dark-secondary">
                    {renderView()}
                    {!isMobileSearchOpen && (
                        <div className="lg:hidden mt-6 bg-brew-dark p-3 rounded-xl border border-slate-700 flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-2.5 shadow">
                            <div className="flex items-center gap-2">
                                <label htmlFor="search-mobile-bottom" className="text-xs font-semibold whitespace-nowrap">{t('footer.searchMovement')}:</label>
                                <input
                                    id="search-mobile-bottom"
                                    type="text"
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && setActiveView('MOVEMENTS')}
                                    className="bg-brew-dark-secondary p-2 rounded-md text-sm flex-1 min-w-0 min-h-[40px] focus:ring-2 focus:ring-brew-accent focus:outline-none"
                                />
                                <button
                                    type="button"
                                    onClick={() => setActiveView('MOVEMENTS')}
                                    className="px-3.5 py-2 min-h-[40px] bg-brew-blue rounded-md text-sm font-bold hover:bg-opacity-80"
                                >
                                    🔍
                                </button>
                            </div>
                            <div className="flex items-center gap-2">
                                <label htmlFor="lottoSearch-mobile-bottom" className="text-xs font-semibold whitespace-nowrap">{t('footer.openLotto')}:</label>
                                <input
                                    id="lottoSearch-mobile-bottom"
                                    type="text"
                                    value={lottoSearchTerm}
                                    onChange={(e) => setLottoSearchTerm(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && handleLottoSearch()}
                                    className="bg-yellow-100 text-slate-900 p-2 rounded-md text-sm flex-1 min-w-0 min-h-[40px] focus:ring-2 focus:ring-brew-orange focus:outline-none"
                                />
                                <button
                                    type="button"
                                    onClick={handleLottoSearch}
                                    className="px-3.5 py-2 min-h-[40px] bg-brew-orange rounded-md text-sm font-bold hover:bg-opacity-80"
                                >
                                    {t('footer.open')}
                                </button>
                            </div>
                        </div>
                    )}
                </div>
                <footer className={`hidden lg:flex bg-brew-dark px-3 py-2 border-t border-slate-700 justify-between items-center flex-wrap gap-4 flex-shrink-0 ${isNetlifyHost ? 'pb-14' : ''}`}>
                    <div className="flex items-center gap-2">
                        <label htmlFor="search" className="text-sm font-semibold whitespace-nowrap">{t('footer.searchMovement')}:</label>
                        <input
                            id="search"
                            type="text"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && setActiveView('MOVEMENTS')}
                            className="bg-brew-dark-secondary p-1.5 rounded-md text-sm w-40 min-w-0 focus:ring-2 focus:ring-brew-accent focus:outline-none"
                        />
                         <button onClick={() => setActiveView('MOVEMENTS')} className="px-3 py-1.5 min-h-[36px] bg-brew-blue rounded-md text-sm font-bold hover:bg-opacity-80">🔍</button>
                    </div>
                    <div className="flex items-center gap-2">
                         <label htmlFor="lottoSearch" className="text-sm font-semibold whitespace-nowrap">{t('footer.openLotto')}:</label>
                         <input
                            id="lottoSearch"
                            type="text"
                            value={lottoSearchTerm}
                            onChange={(e) => setLottoSearchTerm(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleLottoSearch()}
                            className="bg-yellow-100 text-slate-900 p-1.5 rounded-md text-sm w-40 min-w-0 focus:ring-2 focus:ring-brew-orange focus:outline-none"
                        />
                        <button onClick={handleLottoSearch} className="px-3 py-1.5 min-h-[36px] bg-brew-orange rounded-md text-sm font-bold hover:bg-opacity-80">{t('footer.open')}</button>
                    </div>
                </footer>
            </main>
             <RightSidebar 
                isOpen={isRightSidebarOpen}
                onClose={() => setRightSidebarOpen(false)}
                selectedYear={selectedYear} 
                refreshKey={refreshKey} 
                onNavigate={setActiveView}
                onOpenCoefficients={() => setCoefficientsModalOpen(true)}
            />
            {isNewYearModalOpen && <NewYearModal onClose={() => setNewYearModalOpen(false)} onYearCreated={refreshYears} />}
            {isLoadGoodsModalOpen && <LoadGoodsModal selectedYear={selectedYear} onClose={() => {
                setLoadGoodsModalOpen(false);
                checkWarehouse(selectedYear);
                handleRefresh();
            }} />}
            {isDischargeGoodsModalOpen && <DischargeGoodsModal selectedYear={selectedYear} onClose={() => {
                setDischargeGoodsModalOpen(false);
                checkWarehouse(selectedYear);
                handleRefresh();
            }} />}
            {isCoefficientsModalOpen && <CoefficientsModal selectedYear={selectedYear} onClose={() => setCoefficientsModalOpen(false)} />}
            {lottoActionModal.isOpen && lottoActionModal.lottoId && (
                <LottoActionModal
                    lottoId={lottoActionModal.lottoId}
                    onClose={() => setLottoActionModal({ isOpen: false, lottoId: null })}
                    onOpenBrewPage={() => {
                        handleOpenLotto(lottoActionModal.lottoId!);
                        setLottoActionModal({ isOpen: false, lottoId: null });
                    }}
                    onOpenCostAnalysis={() => {
                        openLottoCostAnalysis(lottoActionModal.lottoId!);
                        setLottoActionModal({ isOpen: false, lottoId: null });
                    }}
                />
            )}
            {isFactoryResetModalOpen && (
                <FactoryResetModal
                    onClose={() => setFactoryResetModalOpen(false)}
                    onConfirm={handleConfirmFactoryReset}
                />
            )}
            <PageHelpModal
                isOpen={isHelpModalOpen}
                onClose={() => setHelpModalOpen(false)}
                currentView={activeView}
            />
            <PostImportSetupModal
                isOpen={isCalibrationModalOpen}
                onClose={() => setCalibrationModalOpen(false)}
                selectedYear={selectedYear}
                onSaved={() => {
                    checkWarehouse(selectedYear);
                    handleRefresh();
                }}
            />
            <ExportBackupShareModal
                isOpen={Boolean(preparedBackup)}
                onClose={() => setPreparedBackup(null)}
                backup={preparedBackup}
            />
        </div>
    );
}