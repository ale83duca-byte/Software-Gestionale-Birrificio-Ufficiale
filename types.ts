export interface Movement {
  DATA: string;
  TIPOLOGIA: string;
  NOME: string;
  MARCA: string;
  FORNITORE: string;
  KG_LITRI_PZ: number;
  N_FATTURA: string;
  LOTTO_FORNITORE: string;
  LOTTO_PRODUZIONE: string;
  DATA_SCADENZA?: string;
  PREZZO?: number;
}

export interface PriceDBItem {
    NOME: string;
    MARCA: string;
    FORNITORE: string;
    PREZZO: number;
    DATA_ULTIMO_CARICO: string;
}

export interface DatabaseItem {
  TIPOLOGIA: string;
  NOME: string;
  MARCA: string;
  FORNITORE: string;
}

export interface WarehouseItem {
  TIPOLOGIA: string;
  NOME: string;
  GIACENZA: number;
}

export interface RawWarehouseItem {
    TIPOLOGIA: string;
    NOME: string;
    MARCA: string;
    FORNITORE: string;
    GIACENZA: number;
}


export interface BrewHeader {
  LOTTO: string;
  CLIENTE: string;
  DATA_PROD: string;
  NOME_BIRRA: string;
  FERMENTATORE: string;
  PLATO_INIZIALE: string;
  LITRI_FINALI: string;
  GAS_COTTA: string;
  GAS_CONFEZIONAMENTO: string;
  FLAG_CO2: boolean;
  FLAG_AZOTO: boolean;
  TIPO_BIRRA: string;
  TIPO_FERMENTAZIONE: 'ALTA' | 'BASSA' | '';
  GIORNI_FERMENTAZIONE_PREVISTI: string;
  NOTE?: string;
  // Campi contatori
  mustCounterPrevious?: string;
  mustCounterMeasured?: string;
  gasBrewCounterPrevious?: string;
  gasBrewCounterCurrent?: string;
  gasPackagingCounterPrevious?: string;
  gasPackagingCounterCurrent?: string;
  washWaterCounterPrevious?: string;
  washWaterCounterMeasured?: string;
  // Campi per analisi costi
  costAnalysisGasType?: 'gpl' | 'metano';
  costAnalysisUseStorage?: boolean;
  costAnalysisEpalCount?: number;
  isCostAnalysisClosed?: boolean;
  costAnalysisUseLabels?: boolean;
  savedCostAnalysis?: {
    rawMaterialsCosts: any;
    otherCosts: any;
    analysisSummary: any;
    packagingAnalysis: any;
  };
  frozenPrices?: PriceDBItem[];
  frozenCoeffs?: any;
  // Campi per riporto da anno precedente
  isCarriedOver?: boolean;
  carriedOverFromYear?: string;
  carriedOverIngredients?: Movement[];
  litriFinaliOrigine?: string;
  litriGiaConfezionatiAnnoPrec?: number;
  // Chiusura cantina (mantenendo lo storico del fermentatore) e supporto Doppia Cotta
  isCellarClosed?: boolean;
  isDoubleBatch?: boolean;
  // Fase 3: Parametri tecnologici avanzati cantina, Plato finale/fiscale e genealogia lieviti
  PLATO_FINALE?: string;
  PLATO_FISCALE?: string;
  yeastPitchType?: 'NUOVO_MAGAZZINO' | 'REPITCHING';
  yeastSourceLotto?: string;
  yeastGeneration?: number;
  yeastStrain?: string;
  yeastHarvestNotes?: string;
  dryHopDate?: string;
  coldCrashDate?: string;
  bbtTransferDate?: string;
  // Prezzi di vendita/mercato personalizzati per formato su questo specifico lotto (€/pz)
  lotSellingPrices?: Record<string, number>;
  // Target gradazione alcolica da ricetta / etichetta e gestione rifermentazione vs isobarico
  targetAbv?: string;
  carbonationMode?: 'ISOBARICO' | 'RIFERMENTATO';
  refermentationSugarGL?: string;
}

export interface FermentationDataPoint {
  LOTTO: string;
  GIORNO: number;
  TEMPERATURA: number;
  PLATO: number;
  PH?: number;
  PRESSIONE?: number;
  NOTE_MISURA?: string;
}

export type BeerStorageLocation = 'CELLA_BIRRIFICIO' | 'MAGAZZINO_CENTRALE';

export interface PackagingData {
  DATA: string;
  LOTTO_PROD: string;
  FORMATO: string;
  QTA_UNITA: number;
  LITRI_TOT: number;
  ID_OPERAZIONE: string;
  DATA_SCADENZA: string; // Aggiunto campo scadenza
  isReturnableKeg?: boolean;
  usedCartons?: boolean;
  capNameUsed?: string;
  initialLocation?: BeerStorageLocation;
  giorniRifermentazione?: number;
  dataProntaTrasferimento?: string;
}

export interface FermenterConfig {
  id: string;
  nome: string;
  capacita: number;
}

// Start Cliente Interface
export interface Cliente {
  id: string;
  nome: string;
  partitaIva?: string;
  codiceFiscale?: string;
  codiceUnivocoSdi?: string;
  pec?: string;
  sedeSociale?: string;
  cap?: string;
  comune?: string;
  provincia?: string;
  numeroTelefono?: string;
  ragioneSociale?: string;
}

export type IngredientUnit = 'kg' | 'g' | 'L' | 'pz';

export interface RecipeIngredient {
    tipologia: string;
    nome: string;
    qta: number;
    unita?: IngredientUnit;
}

export interface Birra {
  id: string;
  clienteId: string;
  nomeBirra: string;
  tipologia: string;
  platoIniziale: string;
  litriBatchBase?: number;
  gradoAlcolicoPrevisto?: number; // % ABV previsto da ricetta e riportato in etichetta
  zuccheroRifermentazioneGL?: number; // g/L zucchero per rifermentazione (opzionale, ignorato in isobarico)
  ricetta?: RecipeIngredient[];
}

export type ExciseBracket = 'MICRO_50' | 'ARTIGIANALE_30' | 'ARTIGIANALE_20' | 'ORDINARIA' | 'PERSONALIZZATA';

export interface BreweryProfile {
  ragioneSociale: string;
  indirizzo: string;
  capCittaProvincia: string;
  partitaIva: string;
  codiceFiscale?: string;
  codiceUnivocoSdi?: string;
  codiceAccisa?: string;
  telefono?: string;
  email?: string;
  pec?: string;
  iban?: string;
  regimeFiscale?: string;
  scaglioneAccisa?: ExciseBracket;
  internalClientName: string;
}

export interface CostCoefficients {
    prezzo_gpl_mc?: number;
    prezzo_metano_mc?: number;
    coefficiente_accise?: number;
    spese_stoccaggio?: number;
    costo_epal?: number;
    costo_co2?: number;
    costo_azoto?: number;
    spese_gestione_litro?: number;
    costo_lavaggio_fusto_acciaio?: number;
    costo_etichetta?: number;
}

export interface QuoteIngredient {
    id: number;
    nome: string;
    qta: string;
    prezzoUnitario: string;
}

export interface QuotePackaging {
    id: number;
    nome: string;
    formato: string;
    qta: string;
    costoContenitore: string;
    costoScatola: string;
    costoTappo: string;
}

export interface Quote {
    id: string;
    date: string;
    cliente: string;
    nomeBirra: string;
    plato: string;
    litriFinali: string;
    gasConsumato: string;
    gasType: 'gpl' | 'metano';
    useCo2: boolean;
    useAzoto: boolean;
    useStorage: boolean;
    epalCount: string;
    useLabels: boolean;
    ingredients: QuoteIngredient[];
    packaging: QuotePackaging[];
}

// FIX: Add BeerStockItem interface to be used for representing beer stock. This fixes an import error in BeerWarehouseView.tsx.
export interface BeerStockItem {
    cliente: string;
    nomeBirra: string;
    lotto: string;
    formato: string;
    quantita: number;
    dataScadenza: string;
    location?: BeerStorageLocation;
    dataProntaTrasferimento?: string;
    dataConfezionamento?: string;
}

export interface InitialBeerStock {
    cliente: string;
    nomeBirra: string;
    lotto: string;
    formato: string;
    quantita: number;
    dataScadenza: string;
    location?: BeerStorageLocation;
}

export type BeerWasteReason =
    | 'SCADENZA_TMC'
    | 'OSSIDAZIONE_DIFETTO'
    | 'CONTESTAZIONE_CLIENTE'
    | 'ROTTURA_PERDITA'
    | 'CAMPIONATURA_ANALISI';

export type BeerMovementType =
    | 'SALE'
    | 'ADJUSTMENT'
    | 'PURCHASE'
    | 'WASTE'
    | 'RETURN_CONSIGNMENT'
    | 'INTERNAL_TRANSFER_OUT'
    | 'BREWERY_TO_CENTRAL_OUT'
    | 'BREWERY_TO_CENTRAL_IN';

export interface BeerMovement {
    id: string;
    data: string;
    type: BeerMovementType;
    cliente: string;
    nomeBirra: string;
    lotto: string;
    formato: string;
    quantita: number; // Negativo per uscite/vendite/scarti, positivo per carichi/resi
    relatedDocId?: string;
    destinatario?: string;
    location?: BeerStorageLocation;
    wasteReason?: BeerWasteReason;
    notes?: string;
    ddtNumber?: string;
    ddtSeqNumber?: number;
}

export interface SalesOrderItem {
    beerName: string;
    lotto: string;
    format: string;
    quantity: number;
    customBeerName?: string; // Nome personalizzato per il cliente
}

export interface SalesOrder {
    id: string;
    numeroDdt?: string;
    ddtSeqNumber?: number;
    date: string;
    client: string;
    items: SalesOrderItem[];
    deliveryMode?: 'RITIRO_DIRETTO' | 'CONTO_DEPOSITO_CELLA';
}

export interface PackagedBeerOrderItem {
    beerName: string;
    lotto: string;
    format: string;
    quantity: number;
    price: number;
    total: number;
}

export type CommercialOrderStatus = 'DDT_EMESSO' | 'FATTURATO' | 'PAGATO';

export interface PackagedBeerOrder {
    id: string;
    numeroDdt?: string;
    ddtSeqNumber?: number;
    date: string;
    client: string;
    items: PackagedBeerOrderItem[];
    totalNet: number;
    iva: number;
    totalGross: number;
    status?: CommercialOrderStatus;
    invoiceId?: string;
    invoiceNumber?: string;
}

export type KegFleetFormat = 'FUSTO ACCIAIO 20L' | 'FUSTO ACCIAIO 24L' | 'FUSTO ACCIAIO 30L';

export interface KegFleetConfigItem {
    formato: KegFleetFormat;
    dotazioneTotale: number;
    vuotiLavatiIniziali: number;
    cauzioneUnitaria: number;
}

export type KegMovementType = 'CONSEGNA_CLIENTE' | 'RIENTRO_VUOTO' | 'LAVAGGIO_SANIFICAZIONE' | 'RETTIFICA_PARCO';

export interface KegMovementLog {
    id: string;
    data: string; // DD/MM/YYYY
    tipo: KegMovementType;
    formato: KegFleetFormat;
    quantita: number; // sempre positivo; il segno logico dipende da `tipo`
    cliente?: string;
    lotto?: string;
    relatedOrderId?: string;
    cauzioneTotale?: number;
    cauzioneSaldata?: boolean;
    note?: string;
}

export interface SummaryInvoiceDdtRef {
    orderId: string;
    numeroDdt: string;
    dataDdt: string; // DD/MM/YYYY
}

export interface SummaryInvoiceLine {
    descrizione: string;
    formato: string;
    lotto: string;
    quantita: number;
    prezzoUnitario: number;
    imponibile: number;
    aliquotaIva: number;
    ddtOrderId?: string;
}

export interface SummaryInvoice {
    id: string;
    numeroFattura: string;
    dataEmissione: string; // DD/MM/YYYY
    dataScadenzaPagamento: string; // DD/MM/YYYY
    cliente: string;
    orderIds: string[];
    ddtReferences: SummaryInvoiceDdtRef[];
    lines: SummaryInvoiceLine[];
    imponibileTotale: number;
    ivaTotale: number;
    totaleDocumento: number;
    modalitaPagamento: 'MP05' | 'MP12' | 'MP01'; // MP05 Bonifico, MP12 RIBA, MP01 Contanti
    statoPagamento: 'DA_INCASSARE' | 'INCASSATA';
    dataIncasso?: string;
    note?: string;
}

export interface BeerInventoryCheckItem {
    cliente: string;
    nomeBirra: string;
    lotto: string;
    formato: string;
    quantitaCalcolata: number;
    quantitaFisica: number;
    discrepanza: number;
    location?: BeerStorageLocation;
    resiContoVendita?: number;
    scartiRilevati?: number;
}

export interface BeerInventoryCheck {
    id: string; // e.g., 'INV_2024_07' o 'INV_2024_12_CHIUSURA'
    date: string; // e.g., '01/07/2024'
    items: BeerInventoryCheckItem[];
    checkType?: 'START_OF_MONTH' | 'YEAR_END_CLOSING';
}

export interface BeerLotStatusOverride {
    key: string; // `${cliente}|${nomeBirra}|${lotto}|${formato}`
    status: 'REGOLARE' | 'PROMO_TMC' | 'CONTESTATO_BLOCCATO';
    promoPrice?: number;
    note?: string;
    updatedAt: string;
}

export interface InternalTransferDDTItem {
    cliente: string;
    nomeBirra: string;
    lotto: string;
    formato: string;
    quantita: number;
    litri: number;
    dataScadenza: string;
}

export interface InternalTransferDDT {
    id: string;
    numeroDdt: string;
    ddtSeqNumber?: number;
    data: string; // DD/MM/YYYY
    indirizzoPartenza: string;
    indirizzoDestinazione: string;
    mezzoTrasporto: string;
    targaMezzo?: string;
    conducente?: string;
    note?: string;
    items: InternalTransferDDTItem[];
}

export interface GasTankConfig {
    gasType: 'gpl' | 'metano';
    capacitaTotaleLitri: number;
    percentualeRiempimentoMax: number;
    fattoreConversioneLitriAMc: number; // es. GPL: 1 L liquido = 0.260 m³ gas
    litriInizialiAnno: number;
    dataTaratura?: string; // DD/MM/YYYY: se presente, litriInizialiAnno è la lettura reale a questa data (esclude cotte/scarichi antecedenti)
    sogliaRiservaPercent: number;
    indirizzoDepositoCentrale?: string;
}

export interface GasRefillRecord {
    id: string;
    data: string; // DD/MM/YYYY
    gasType: 'gpl' | 'metano';
    fornitore: string;
    numeroBolla: string;
    litriScaricati: number;
    mcEquivalenti: number;
    costoTotale: number;
    prezzoAlLitro: number;
    prezzoAlMc: number;
    note?: string;
}

export type TechGasCode = 'CO2' | 'AZOTO' | 'ARGON';
export type TechGasMovementType = 'CAMBIO_BOMBOLA' | 'CONSEGNA_FORNITORE' | 'RETTIFICA_SCORTA';

export interface TechGasCylinderItem {
    codice: TechGasCode;
    nome: string;
    unitaCapacita: 'kg' | 'L';
    formatoCapacita: number; // es. 30 kg per CO2 alimentare, 50 L per Azoto/Argon
    pieneScorta: number;
    inUsoImpianto: number;
    vuoteDaRendere: number;
    sogliaAllarmePiene: number;
    costoMedioRicarica: number;
    attivo: boolean;
}

export interface TechGasMovementLog {
    id: string;
    data: string; // DD/MM/YYYY
    codice: TechGasCode;
    tipo: TechGasMovementType;
    quantita: number;
    vuotiResi?: number;
    fornitore?: string;
    numeroBolla?: string;
    costoTotale?: number;
    note?: string;
}

export interface BeerPriceList {
    beerName: string;
    prices: Record<string, number>; // Format -> Price
}

export interface ClientOffer {
    id: string;
    clientId: string;
    clientName: string;
    date: string;
    prices: Record<string, Record<string, number>>; // BeerName -> Format -> Price
}

export interface BreweryData {
  MOVIMENTAZIONE: Movement[];
  DATABASE: DatabaseItem[];
  MAGAZZINO: RawWarehouseItem[];
  COTTE_HEAD: BrewHeader[];
  FERMENTAZIONE: FermentationDataPoint[];
  CONFEZIONAMENTO: PackagingData[];
  CANTINA_CONFIG: FermenterConfig[];
  CLIENTI: Cliente[];
  BIRRE: Birra[];
  PRICE_DATABASE: PriceDBItem[];
  COST_COEFFICIENTS: CostCoefficients;
  QUOTES: Quote[];
  // Nuove tabelle per magazzino birra finita
  BEER_WAREHOUSE_INITIAL: InitialBeerStock[];
  BEER_MOVEMENTS: BeerMovement[];
  SALES_ORDERS: SalesOrder[];
  PACKAGED_BEER_ORDERS: PackagedBeerOrder[];
  BEER_INVENTORY_CHECKS: BeerInventoryCheck[];
  BEER_PRICE_LIST: BeerPriceList[];
  CLIENT_OFFERS: ClientOffer[];
  CALENDAR_NOTES: CalendarNote[];
  PLANNED_BREWS: PlannedBrew[];
  MAINTENANCE_PLANS: MaintenancePlan[];
  MAINTENANCE_LOGS: MaintenanceLog[];
  BREWERY_PROFILE?: BreweryProfile;
  KEG_FLEET_CONFIG?: KegFleetFormatConfigList;
  KEG_LOGS?: KegMovementLog[];
  SUMMARY_INVOICES?: SummaryInvoice[];
  BEER_LOT_OVERRIDES?: BeerLotStatusOverride[];
  INTERNAL_TRANSFERS?: InternalTransferDDT[];
  GAS_TANK_CONFIG?: GasTankConfig;
  GAS_REFILLS?: GasRefillRecord[];
  TECH_GAS_CONFIG?: TechGasCylinderItem[];
  TECH_GAS_LOGS?: TechGasMovementLog[];
  DDT_COUNTERS?: {
    sales?: number;
    transfer?: number;
    waste?: number;
  };
}

export type KegFleetFormatConfigList = KegFleetConfigItem[];

// --- PIANIFICAZIONE COTTE FUTURE & ANALISI FABBISOGNO MAGAZZINO ---
export interface PlannedBrewIngredientCheck {
    tipologia: string;
    nome: string;
    qtaRicetta: number;
    qtaRichiesta: number;
    qtaDisponibile: number;
    qtaMancante: number;
    sufficiente: boolean;
    unitaMisura: string;
}

export interface PlannedBrewStockAnalysis {
    sufficiente: boolean;
    mancantiCount: number;
    ingredienti: PlannedBrewIngredientCheck[];
    dettaglioMancanti: string[];
}

export interface PlannedBrew {
    id: string;
    date: string; // Formato ISO: YYYY-MM-DD
    clienteId: string;
    clienteNome: string;
    birraId: string;
    birraNome: string;
    litriPrevisti: number;
    fermentatore?: string;
    note?: string;
    status: 'PIANIFICATA' | 'CONFERMATA' | 'PRODOTTA' | 'ANNULLATA';
    createdAt: string;
    stockAnalysis?: PlannedBrewStockAnalysis;
    lottoCreato?: string;
    eseguitaAt?: string;
}

// --- PROMEMORIA CICLI CIP / SANIFICAZIONI / MANUTENZIONE IMPIANTI ---
export type MaintenanceType = 'CIP_SANIFICAZIONE' | 'MANUTENZIONE_TECNICA';
export type MaintenanceFrequency = 'GIORNALIERA' | 'SETTIMANALE' | 'QUINDICINALE' | 'MENSILE' | 'TRIMESTRALE' | 'SEMESTRALE' | 'ANNUALE' | 'PERSONALIZZATA';

export interface MaintenancePlan {
    id: string;
    nome: string; // Es. "CIP Settimanale Scambiatore a Piastre", "Manutenzione Pompe e Giranti"
    tipo: MaintenanceType;
    apparato: string; // Es. "Sala Cotte", "Scambiatore", "Fermentatori", "Pompe e Tubazioni", "Gruppo Frigo / Glicole", "Imbottigliatrice/Fusti", "Altro"
    frequenza: MaintenanceFrequency;
    intervalloGiorni: number; // 1, 7, 14, 30, 90, 180, 365 o personalizzato
    dataUltimaEsecuzione?: string; // YYYY-MM-DD
    dataProssimaScadenza: string; // YYYY-MM-DD
    noteProcedura?: string; // Es. concentrazioni chimiche (soda 2%, acido peracetico 0.5%) o istruzioni tecniche
    prodottoChimico?: string;
    attivo: boolean;
    stato?: 'regolare' | 'in_scadenza' | 'scaduto';
    daysRemaining?: number;
}

export interface MaintenanceLog {
    id: string;
    planId: string;
    planNome: string;
    tipo: MaintenanceType;
    apparato: string;
    dataEsecuzione: string; // YYYY-MM-DD
    operatore?: string;
    note?: string;
}

export type CalendarNoteCategory = 'NOTE' | 'CONFEZIONAMENTO' | 'COTTA' | 'LAVORAZIONE' | 'MANUTENZIONE' | 'CONSEGNA';
export type CalendarNotePriority = 'NORMALE' | 'ALTA' | 'URGENTE';

export interface CalendarNote {
    id: string;
    date: string; // Formato ISO: YYYY-MM-DD
    title: string;
    description?: string;
    category: CalendarNoteCategory;
    priority: CalendarNotePriority;
    time?: string; // Es. "08:30" oppure vuoto
    completed: boolean;
    createdAt: string;
    relatedLotto?: string;
    relatedFermentatore?: string;
}

export interface CellarPackagingEvent {
    fermentatore: string;
    capacitaFermentatore: number;
    lotto: string;
    nomeBirra: string;
    cliente: string;
    dataProd: string;
    litriFinali: number;
    giorniPrevisti: number;
    dataPrevistaConfezionamento: string; // Formato ISO: YYYY-MM-DD
    status: 'in_progress' | 'finishing' | 'alarm';
    daysRemaining: number;
}

export type BrewerySheet = keyof BreweryData;

export interface WarehouseStatus {
    dischargedItems: { nome: string; lotto: string; qta: number }[];
    expiringSoonItems: { nome:string; lotto: string; scadenza: string; giacenza: number }[];
    outOfStockItems: { nome: string; marca: string; fornitore: string; tipologia: string; }[];
    expiringBeerItems: { cliente: string; birra: string; lotto: string; formato: string; scadenza: string; qta: number }[];
}