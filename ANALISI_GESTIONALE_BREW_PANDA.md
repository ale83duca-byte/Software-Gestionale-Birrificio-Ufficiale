# Analisi Tecnica, Operativa e Strategica — Gestionale "Brew Panda" (v1.5.2)

**Data Audit:** Analisi completa del codice sorgente, database locale, flussi operativi di birrificio e infrastruttura portatile (USB/Desktop).  
**Ambito:** Revisione architetturale, bug logici, rischi di perdita dati, discrepanze nei contesti reali di produzione brassicola, migliorie tecniche e nuove funzionalità evolutive.

---

## Indice del Documento

1. [Valutazione Generale e Punti di Forza](#1-valutazione-generale-e-punti-di-forza)
2. [Criticità Gravi e Bug con Rischio Perdita Dati (Priorità Massima)](#2-criticità-gravi-e-bug-con-rischio-perdita-dati-priorità-massima)
3. [Discrepanze nel Codice, nei Calcoli e nei Flussi Gestionali](#3-discrepanze-nel-codice-nei-calcoli-e-nei-flussi-gestionali)
4. [Discrepanze nei Contesti Reali di Lavorazione del Birrificio](#4-discrepanze-nei-contesti-reali-di-lavorazione-del-birrificio)
5. [Criticità Infrastrutturali, Offline/USB ed Esportazione Dati](#5-criticità-infrastrutturali-offlineusb-ed-esportazione-dati)
6. [Migliorie Applicabili all'Architettura Attuale](#6-migliorie-applicabili-allarchitettura-attuale)
7. [Funzionalità Aggiuntive Consigliate per un Birrificio Artigianale](#7-funzionalità-aggiuntive-consigliate-per-un-birrificio-artigianale)
8. [Piano d'Azione / Roadmap Consigliata](#8-piano-dazione--roadmap-consigliata)

---

## 1. Valutazione Generale e Punti di Forza

**Brew Panda** presenta una copertura funzionale già molto ampia e ben pensata per la realtà di un birrificio artigianale che produce sia a marchio proprio sia **conto terzi (BeerFirm)**:
- **Flusso End-to-End integrato:** Materie prime → Sala cotte → Fermentazione/Cantina → Confezionamento (con scarico automatico di bottiglie, tappi, etichette, cartoni e fusti) → Magazzino birra finita → Ordini / Inventario mensile → DDT e Analisi costi/vendite.
- **Pianificazione visuale:** Calendario integrato con cotte pianificate, confezionamenti previsti e piani ricorrenti di manutenzione/sanificazione (CIP).
- **Portabilità:** Idea ottima dell'esecuzione portatile su chiavetta USB tramite `launcher.cjs` con salvataggio profilo isolato in `data/profile`.

Tuttavia, l'analisi approfondita del codice ha fatto emergere **6 bug critici** (alcuni dei quali causano **cancellazione involontaria di dati** o **errori contabili al cambio d'anno**) e diverse discrepanze rispetto all'operatività quotidiana di sala cotte, cantina, fusti a rendere e normativa accise/HACCP.

---

## 2. Criticità Gravi e Bug con Rischio Perdita Dati (Priorità Massima)

Questi problemi devono essere corretti **prima** dell'utilizzo in produzione continuativa, poiché possono cancellare dati storici o bloccare la tracciabilità di magazzino.

### 2.1. "Annulla Ultimo Confezionamento" cancella i confezionamenti di TUTTI gli altri lotti dell'anno
- **File coinvolto:** `components/BrewPage.tsx` (righe 231 e 709–725)
- **Causa tecnica:** Lo stato `packagingData` in `BrewPage.tsx` viene popolato filtrando solo il lotto corrente (`p.LOTTO_PROD === lottoId`). Tuttavia, nella funzione `handleUndoLastPackaging()`, quando si annulla una riga già salvata a database, il codice esegue:
  ```ts
  const updatedPkgs = packagingData.slice(0, -1);
  await saveDataToSheet(selectedYear, 'CONFEZIONAMENTO', updatedPkgs);
  ```
  `saveDataToSheet` **sovrascrive l'intera tabella `CONFEZIONAMENTO` dell'anno** con il solo array locale del lotto aperto.
- **Impatto reale:** Cliccare "Annulla Ultimo" su una riga di confezionamento già salvata **elimina istantaneamente tutti i confezionamenti di tutte le altre cotte dell'anno**, azzerando anche le relative giacenze di birra finita e i calcoli dei costi al litro.

### 2.2. Il passaggio al "Nuovo Anno" (`createNewYear`) azzera Lotti Fornitore, Scadenze e blocca gli Scarichi
- **File coinvolti:** `services/dataService.ts` (righe 82–90), `components/DischargeGoodsModal.tsx` (righe 47–55, 71), `components/BrewPage.tsx` (righe 177, 406–408, 457)
- **Causa tecnica:** Durante la creazione del nuovo anno, la giacenza residua di materie prime viene riportata al `01/01/{nuovoAnno}` impostando:
  ```ts
  LOTTO_FORNITORE: '',
  DATA_SCADENZA: undefined
  ```
- **Impatto reale (triplo effetto a catena):**
  1. **Perdita tracciabilità HACCP:** Dal 1° gennaio spariscono tutti i numeri di lotto fornitore e tutte le date di scadenza di malti, luppoli e lieviti acquistati l'anno precedente. Gli avvisi in Home per merce in scadenza smettono di funzionare sulle giacenze riportate.
  2. **Impossibilità di scarico manuale:** `DischargeGoodsModal.tsx` filtra `if (m.NOME && m.LOTTO_FORNITORE)` e blocca il salvataggio se `lottoFornitore` è vuoto. Tutta la merce riportata dall'anno precedente **diventa impossibile da scaricare manualmente**.
  3. **Mancato scarico automatico in Cotta:** In `BrewPage.tsx` (riga 457), il salvataggio della cotta scarica dal magazzino solo gli ingredienti che hanno `ing.lotto_fornitore` valorizzato. Selezionando un ingrediente riportato dall'anno nuovo (che ha `lotto: ''`), la cotta viene salvata ma **la materia prima non viene mai scalata dal magazzino**!

### 2.3. Il passaggio al "Nuovo Anno" azzera il costo ingredienti (€ 0,00) delle birre in fermentazione a cavallo d'anno
- **File coinvolto:** `services/dataService.ts` (righe 171–194) e `constants.ts` (riga 20)
- **Causa tecnica:** Per riportare nel nuovo anno gli ingredienti delle cotte ancora nei fermentatori al 31/12, `createNewYear` filtra `MOVIMENTAZIONE` cercando:
  ```ts
  ['MALTO', 'LUPPOLO', 'LIEVITO', 'ALTRO', 'ZUCCHERO', 'SPEZIE'].some(cat => m.TIPOLOGIA.includes(cat))
  ```
  Ma in `constants.ts` le categorie ufficiali del gestionale sono plurali: `["MALTI", "LUPPOLI", "LIEVITI", "ADDITIVI", "SANIFICANTI"]`.  
  In JavaScript `'MALTI'.includes('MALTO')` restituisce **`false`** (così come `'LUPPOLI'.includes('LUPPOLO')` e `'LIEVITI'.includes('LIEVITO')`, mentre `'ADDITIVI'` non è nemmeno nell'elenco).
- **Impatto reale:** L'array `carriedOverIngredients` risulta **sempre vuoto `[]`**. Tutte le birre brassate a dicembre e infustate/imbottigliate a gennaio risultano avere **costo materie prime pari a € 0,00** in *Analisi Costi*. Inoltre, `LITRI_FINALI` viene sovrascritto con `remainingLiters`, alterando la resa e lo scarto se una parte del lotto era già stata confezionata a dicembre.

### 2.4. Il passaggio al "Nuovo Anno" perde Listini Prezzi, Offerte Clienti e Piani di Manutenzione
- **File coinvolto:** `services/dataService.ts` (righe 92–98)
- **Causa tecnica:** `createNewYear` copia `CLIENTI`, `BIRRE`, `CANTINA_CONFIG`, `PRICE_DATABASE` e `COST_COEFFICIENTS`, ma **dimentica di copiare**:
  - `BEER_PRICE_LIST` (Listino prezzi birre confezionate)
  - `CLIENT_OFFERS` (Sconti e listini personalizzati per cliente)
  - `MAINTENANCE_PLANS` (Piani ricorrenti di sanificazione/manutenzione sul calendario)
- **Impatto reale:** Ogni 1° gennaio l'utente deve reinserire da zero tutti i prezzi di vendita, tutte le offerte dedicate ai clienti e tutti i piani di manutenzione periodica dell'impianto.

### 2.5. Modificare il nome di un Cliente o di una Birra spezza tutte le relazioni storiche
- **File coinvolto:** `components/DatabaseView.tsx` (righe 63–71, 273–279)
- **Causa tecnica:** Mentre la tabella `BIRRE` è collegata a `CLIENTI` tramite `clienteId`, quasi tutte le altre tabelle (`COTTE_HEAD`, `BEER_WAREHOUSE_INITIAL`, `BEER_MOVEMENTS`, `SALES_ORDERS`, `PACKAGED_BEER_ORDERS`, `BEER_PRICE_LIST`) salvano e filtrano i record tramite **stringa testuale** (`CLIENTE` e `NOME_BIRRA`).
- **Impatto reale:** Correggere anche un solo refuso nel nome di una birra o nella ragione sociale di un cliente in *Anagrafica Database* rende "orfane" le cotte passate, fa sparire o sdoppia le giacenze in magazzino birra finita e azzera i relativi listini e statistiche.

### 2.6. Nome cliente `"ALVERESE"` e dati fiscali di esempio cablati nel codice (Hardcoding)
- **File coinvolti:**
  - `components/SalesOrderView.tsx` (righe 114, 128–145, 226)
  - `components/PackagedBeerOrdersView.tsx` (righe 55, 75, 289)
  - `components/BeerPriceListView.tsx` (righe 39, 224)
  - `utils/excelExport.ts` (righe 372–378)
- **Causa tecnica:** I moduli commerciali cercano esplicitamente la stringa `"ALVERESE"` per individuare le birre di proprietà del birrificio. Inoltre, l'esportazione DDT in Excel (`excelExport.ts`) stampa come mittente fisso:
  `"BIRRIFICIO ALVERESE - Via Example, 123 - 58100 Grosseto (GR) - P.IVA: 01234567890"`.
- **Impatto reale:** Se dopo un *Reset di Fabbrica* il birrificio viene inserito come `"Birrificio Alverese"` o con un altro nome, gli ordini birra confezionata e BeerFirm mostrano **0 birre disponibili**, e i DDT emessi riportano un indirizzo e una Partita IVA fittizi.

---

## 3. Discrepanze nel Codice, nei Calcoli e nei Flussi Gestionali

### 3.1. Disallineamento Formati tra Produzione (`CONFIG_PACKAGING`) e Listino/Ordini (`PRICE_LIST_FORMATS`)
- **File coinvolti:** `constants.ts` (righe 23–46) e `components/PackagedBeerOrdersView.tsx` (righe 107–120)
- **Problema:**
  - In confezionamento esistono **`FUSTO ACCIAIO 30L`** e **`KEYKEG 30L`**, ma in `PRICE_LIST_FORMATS` **non esiste alcun formato da 30 Litri** (mentre esiste un `'FUSTO 5 LT'` assente in produzione).
  - La funzione `mapFormatToPriceKey()` restituisce `null` per qualsiasi fusto da 30L: di conseguenza nei *Listini Prezzi* non è possibile prezzare i fusti da 30L e negli *Ordini Birra Confezionata* il loro prezzo proposto è sempre **€ 0,00**.
  - Inoltre `KEYKEG 20L`, `POLYKEG 20LT`, `FUSTO ACCIAIO 20L` e `SACCA 20L` vengono tutti appiattiti sulla singola voce `'FUSTO 20 LT'`, impedendo di applicare un prezzo diverso tra fusto a rendere in acciaio (senza costo fusto) e KeyKeg/PolyKeg a perdere (che costa 12–16 € a fusto!).

### 3.2. L'avviso "Birra in Scadenza" in Home ignora tutta la produzione dell'anno in corso!
- **File coinvolto:** `services/dataService.ts` (righe 467–500)
- **Problema:** La funzione `checkAndProcessWarehouseStatus()` calcola la giacenza dei lotti birra finita leggendo solo `BEER_WAREHOUSE_INITIAL` e `BEER_MOVEMENTS`, **dimenticando completamente di sommare `CONFEZIONAMENTO`** (a differenza di `BeerWarehouseView.tsx` che invece lo somma correttamente).
- **Impatto:** Qualsiasi lotto di birra prodotto e confezionato nell'anno corrente **non genera mai alcun alert di scadenza** nella Dashboard Home. Inoltre la condizione `diffDays >= 0 && diffDays <= 90` nasconde dall'elenco i lotti **già scaduti** (`diffDays < 0`).

### 3.3. Arrotondamento distruttivo delle bottiglie sfuse nell'Inventario Mensile Birra
- **File coinvolto:** `components/BeerInventoryView.tsx` (righe 260–262, 274, 329–331)
- **Problema:** La giacenza delle bottiglie è salvata in singole unità (`QTA_UNITA`), ma la schermata *Inventario Birra* converte forzatamente le bottiglie in cartoni interi con `Math.floor(unita / 24)` (per le 33cl) o `/ 6` (per le 75cl) e accetta solo numeri interi (`/^\d*$/`).
- **Impatto:** Se in cella ci sono **50 bottiglie da 33cl** (2 cartoni da 24 + 2 bottiglie sfuse per campioni/assaggi), la schermata precompila il campo con **`2` cartoni**. Appena l'operatore clicca *"Salva Inventario"* senza nemmeno toccare quella riga, il sistema calcola `2 * 24 = 48` e **registra automaticamente una vendita fittizia di 2 bottiglie**! È impossibile inventariare bottiglie sfuse.

### 3.4. Mancata scalatura delle ricette sui Litri Previsti e confusione Grammi/Kg
- **File coinvolti:** `services/calendarService.ts` (righe 158–196) e `components/BrewPage.tsx` (righe 255–266, 350–361)
- **Problema:**
  1. In `analyzePlannedBrewStock(birra, _litriPrevisti, magazzino)`, il parametro `_litriPrevisti` ha un underscore ed è **totalmente ignorato**: pianificare una cotta doppia da 2.000 L o una cotta pilota da 500 L richiede esattamente la stessa quantità fissa salvata nella ricetta base. Anche in `BrewPage.tsx`, cambiando `LITRI_INIZIALI`, le quantità della ricetta precaricata non scalano proporzionalmente.
  2. `calendarService.ts` (riga 192) tenta di indovinare l'unità di misura con una regola empirica (`qtaRichiesta > 20 ? 'g' : 'kg'`) e confronta il numero grezzo direttamente con `GIACENZA` di magazzino senza conversione! Se un luppolo è caricato a magazzino in Kg (es. `5` kg) e nella ricetta è scritto `300` (inteso come grammi), il calendario segnala erroneamente **mancanza di 295 g** e colora la cotta in rosso!
  3. **Mancato cumulo sulle cotte pianificate:** Se in calendario ci sono 3 cotte nella settimana che richiedono 200 kg di Malto Pils ciascuna (fabbisogno totale: 600 kg) e in magazzino ci sono 250 kg, il sistema controlla ogni cotta singolarmente (`250 >= 200`) e mostra il semaforo verde **"MAGAZZINO OK" su tutte e tre**, nascondendo un ammanco reale di 350 kg.

### 3.5. Imprecisioni nell'Analisi Costi (`CostAnalysisView.tsx`) e nei Preventivi (`BrewQuoteView.tsx`)
1. **Costo Tappi e Scatole non fedeli allo scarico reale (`CostAnalysisView.tsx`, righe 251–280):**
   - Il costo del tappo corona viene preso dall'ultimo articolo caricato in `PRICE_DATABASE` il cui nome inizia per `TAPPO CORONA`, senza distinguere tra **Tappo 26mm** (33cl) e **Tappo 29mm** (75cl) né leggere il movimento reale del lotto.
   - Il costo del cartone viene **sempre sommato** per ogni bottiglia anche quando in confezionamento l'operatore ha **deselezionato** la spunta *"Includi Scatole"* (`useCartons = false`, es. bottiglie messe in cassa di plastica).
2. **Prezzi basati sull'ultimo listino anziché sul costo reale del lotto scaricato:**
   - Quando si carica merce in magazzino (`LoadGoodsModal`), il prezzo d'acquisto viene salvato sul movimento (`PREZZO`), ma `CostAnalysisView` ignora il prezzo pagato per quello specifico `LOTTO_FORNITORE` e interroga solo `PRICE_DATABASE` (che conserva unicamente l'ultimo prezzo inserito). Se il malto rincara a metà anno, cambiano retroattivamente i costi anche delle cotte aperte fatte col malto vecchio.
3. **Preventivo Cotta (`BrewQuoteView.tsx`, righe 134–177):**
   - Finché l'utente non inserisce righe di confezionamento la cui somma copra i `litriFinali`, le voci `Accise`, `Costo Gestione` e `Prezzo al Litro` vengono calcolate su `totalPackagedLiters` (quindi risultano **€ 0,00** se si vuole preventivare solo il mosto/sfuso prima di decidere i formati).

### 3.6. Doppio Conteggio delle Vendite nelle Statistiche Generali (`SalesTrendView.tsx`)
- **File coinvolti:** `components/SalesOrderView.tsx` (righe 221–246) e `components/SalesTrendView.tsx` (riga 149)
- **Problema:** Quando una BeerFirm ritira un lotto prodotto internamente (`SalesOrderView`), il sistema genera un movimento `SALE` sul cliente `"ALVERESE"` e un movimento `PURCHASE` sul cliente BeerFirm. Successivamente, quando si fa l'inventario per quel cliente BeerFirm (`BeerInventoryView`), viene generato un secondo movimento `SALE` a nome della BeerFirm. Nella vista *"Analisi Generale - Tutti i Clienti"* di `SalesTrendView`, entrambi i movimenti `SALE` vengono sommati insieme, **raddoppiando i litri venduti** di tutte le produzioni conto terzi!
- Inoltre, né in `SalesOrderView` né in `PackagedBeerOrdersView` esiste un pulsante **"Elimina / Annulla Ordine"** (esiste solo *Modifica*, che però non consente di annullare completamente l'ordine ripristinando lo stock).

### 3.7. Sovrastima/Assenza controllo giacenza su righe multiple prima del salvataggio Cotta
- **File coinvolto:** `components/BrewPage.tsx` (righe 454–470 e 680–687)
- **Problema:**
  - Sugli **ingredienti della cotta** non viene effettuato alcun controllo che la quantità inserita sia `<= giacenza del lotto selezionato`: è possibile scaricare 500 kg da un lotto che ne ha 50 kg, mandando il magazzino in negativo.
  - Sul **confezionamento**, se si aggiungono due righe nuove (`isNew: true`) prima di cliccare *"Salva Cotta"*, la seconda riga controlla la disponibilità di tappi/bottiglie/etichette senza sottrarre quelli già impegnati dalla prima riga appena aggiunta in pagina.

---

## 4. Discrepanze nei Contesti Reali di Lavorazione del Birrificio

Oltre ai bug software, emergono limiti importanti rispetto a come si lavora realmente in sala cotte, cantina e logistica fusti:

### 4.1. Impossibilità di gestire la "Doppia Cotta" (Multi-Turn Brew) nello stesso Fermentatore
- **Contesto reale:** Nella quasi totalità dei birrifici artigianali (es. sala cotte da 10 hL con fermentatori da 20 hL o 30 hL), un singolo lotto fermentativo viene riempito con **2 o 3 cotte consecutive** nell'arco di 12–24 ore.
- **Limite attuale (`CantinaView.tsx` riga 216 e `BrewPage.tsx` riga 168):** Un fermentatore occupato sparisce dalla tendina `availableFermenters`, rendendo impossibile versare una seconda cotta nello stesso tank o associare più cotte di sala cottura a un unico lotto cantina.

### 4.2. Chiusura Lotto cancella lo storico del Fermentatore utilizzato
- **Contesto reale:** Per la qualità e l'HACCP (es. individuare un'infezione da *diastaticus* o guarnizione difettosa su uno specifico tank), è fondamentale sapere in quale fermentatore ha fermentato ogni lotto storico.
- **Limite attuale (`BrewPage.tsx` riga 742):** Quando si clicca *"Chiudi Lotto"*, il codice esegue `FERMENTATORE: ''` invece di mantenere il nome del fermentatore e affidarsi solo allo `STATO: 'Confezionata'` per liberare il tank! Di conseguenza **si perde per sempre l'informazione su quale fermentatore ha ospitato le cotte passate**.

### 4.3. Fusti in Acciaio gestiti come "Materiale a Perdere" anziché "Parco Fusti a Rendere"
- **Contesto reale:** Bottiglie, lattine, KeyKeg e PolyKeg sono imballaggi **a perdere** (vengono acquistati, caricati a magazzino e scaricati definitivamente al confezionamento). I **Fusti in Acciaio Inox (20L / 24L / 30L)** sono invece beni strumentali riutilizzabili del birrificio che escono in **cauzione / comodato** presso i pub e rientrano vuoti da lavare.
- **Limite attuale (`BrewPage.tsx` riga 655):** Il gestionale scarica `FUSTO ACCIAIO 30L` dal magazzino materie prime esattamente come una bottiglia di vetro. Ciò costringe il birraio a fare finti "carichi di acquisto" ogni volta che i fusti rientrano dai clienti e non offre alcuna visibilità su **quanti fusti d'acciaio sono attualmente fuori presso ciascun cliente**.

### 4.4. Scheda Cotta e Fermentazione prive di parametri tecnologici essenziali
- **Sala Cotte:** Mancano step di ammostamento (temperature e pause protein rest / beta-amilasi / alfa-amilasi), volumi acqua di mash vs sparge, densità e litri pre-boil, pH di ammostamento, pH fine bollitura, gittate luppolo con tempistiche (60', 15', Whirlpool, Dry Hop) e calcolo automatico dell'**Efficienza Sala Cotte (%)**.
- **Cantina e Maturazione:**
  - Il diario fermentazione traccia solo `Giorno`, `Temperatura` e `Plato`. Mancano **pH**, **Pressione (bar / spunding)**, data inoculo e generazione/ceppo lievito, registro **Dry Hopping** effettuato, ** Cold Crash** e **Travaso in maturatore / Brite Tank (BBT)**.
  - Non vengono calcolati in automatico il **Grado Alcolico stimato (% ABV)** e l'**Attenuazione Apparente (%)** a partire da `PLATO_INIZIALE` e `PLATO_FINALE`.

### 4.5. Calcolo Accise e Conformità Dogane (ADM)
- **Limite attuale (`CostAnalysisView.tsx` riga 172):** L'accisa è calcolata come `PLATO_INIZIALE * hL * coefficiente_accise`.
- **Contesto normativo italiano:**
  1. L'accisa è dovuta sul **prodotto finito condizionato** in base al **Grado Plato effettivo della birra finita** (che cambia rispetto al mosto iniziale in caso di aggiunta di zuccheri in rifermentazione/priming, sciroppi, mosti concentrati, purea di frutta o diluizione con acqua disaerata).
  2. Il grado Plato fiscale ha regole specifiche di troncamento/arrotondamento al decimo di grado e aliquote agevolate a scaglioni per i birrifici artigianali (fino a 10.000 hL, 10–30k hL, 30–60k hL).

---

## 5. Criticità Infrastrutturali, Offline/USB ed Esportazione Dati

### 5.1. Falso funzionamento "100% Offline" su Chiavetta USB (Tailwind via CDN!)
- **File coinvolti:** `index.html` (riga 13), `app_dist/index.html` (riga 13), `index.tsx`, `GUIDA_CHIAVETTA_USB.md` (riga 35)
- **Problema critico:** Sebbene nel progetto sia installato `tailwindcss` con `tailwind.config.js` e `index.css`, il file `index.tsx` **non importa mai `./index.css`**! Al suo posto, `index.html` carica Tailwind da Internet tramite `<script src="https://cdn.tailwindcss.com"></script>`.
- **Impatto reale:** Contrariamente a quanto scritto in `GUIDA_CHIAVETTA_USB.md` (*"Funziona al 100% offline, non serve connessione Internet"*), se si avvia Brew Panda da chiavetta USB in un laboratorio di birrificio **senza connessione Internet**, lo script `cdn.tailwindcss.com` fallisce e **l'intera interfaccia grafica esplode senza stili CSS, colori, griglie né finestre modali**! Inoltre `service-worker.js` è presente nella root ma non viene mai registrato.

### 5.2. Stili grafici dei file Excel/DDT completamente ignorati dalla libreria `xlsx`
- **File coinvolto:** `utils/excelExport.ts` (righe 4–8, 38–47, 360–500)
- **Problema:** Tutto il modulo di esportazione definisce accuratamente colori, bordi, allineamenti e grassetti tramite la proprietà `.s` delle celle (`headerStyle`, `titleStyle`). Tuttavia, la versione gratuita community di SheetJS (`"xlsx": "^0.18.5"`) **ignora silenziosamente tutti gli oggetti `.s` durante il salvataggio**! I file `.xlsx` e i DDT generati escono quindi privi di formattazione grafica, bordi e colori. *(Soluzione: sostituire con `xlsx-js-style` o `exceljs`, oppure generare veri PDF per i DDT).*

### 5.3. Architettura Database Monolitica in IndexedDB e Rischio Corruzione su USB
- **File coinvolti:** `services/db.ts`, `services/dataService.ts`
- **Problema:**
  - L'intero anno gestionale (24 tabelle insieme) è salvato come **un unico grande oggetto JSON** sotto una sola chiave (`selectedYear`) in IndexedDB. Ogni singola modifica legge l'intero blocco, lo clona e lo riscrive per intero (`getBreweryData` → `saveBreweryData`), con rischio di *race condition* (sovrascrittura concorrente) se due salvataggi ravvicinati partono in parallelo.
  - Su chiavetta USB i dati risiedono unicamente nei file binari LevelDB del browser (`data/profile/Default/IndexedDB`). Se un operatore sfila la chiavetta USB senza chiudere correttamente Edge/Chrome, il database LevelDB di Chromium può corrompersi senza che esista un **backup automatico in chiaro (`.json`)** salvato su disco dal server Node locale (`launcher.cjs`).

### 5.4. Pulizia Codice, Sicurezza Launcher e Internazionalizzazione Incompleta
- **Conflitto Porta 3000 (`launcher.cjs` riga 200 e `3_ARRESTA_BREW_PANDA.bat`):** Se sul PC è già attivo un altro programma locale sulla porta `3000`, `launcher.cjs` intercetta `EADDRINUSE`, presume erroneamente che sia già Brew Panda e apre il browser sul programma sbagliato; lo script `ARRESTA_BREW_PANDA.bat` termina forzatamente (`taskkill /F`) qualsiasi processo sulla porta `3000`.
- **File duplicati nel repository:**
  - `utils/vite.config.ts` è un duplicato inutilizzato di `vite.config.ts`.
  - Nella root coesistono script `.bat` doppi (`1_AVVIA_BREW_PANDA.bat` e `AVVIA_BREW_PANDA.bat`, `2_CREA_COLLEGAMENTO_DESKTOP.bat` e `Crea_Collegamento_Desktop.bat`, `3_ARRESTA_BREW_PANDA.bat` e `ARRESTA_BREW_PANDA.bat`), generando confusione.
  - `GUIDA_CHIAVETTA_USB.md` chiede di copiare la cartella `dist/`, mentre nel progetto la cartella precompilata si chiama `app_dist/`.
- **Traduzioni disallineate (`locales/it.json`, `locales/en.json` vs `i18n/LanguageProvider.tsx`):** I file JSON in `locales/` contengono solo ~40 chiavi obsolete e non vengono mai usati, mentre `LanguageProvider.tsx` ne contiene oltre 220 ma molti componenti recenti (`CalendarView`, `BeerInventoryView`, `ProductionTrendView`, `SalesTrendView`) hanno testi italiani scritti direttamente nel codice e manca un selettore lingua nell'interfaccia.
- **HTML non sanitizzato in Home (`components/Home.tsx` righe 195 e 494):** Viene usato `dangerouslySetInnerHTML` annidando un `<li>` generato dalle traduzioni dentro un altro `<li>` già presente nel JSX (`<li><li>...</li></li>`), producendo HTML invalido e potenziale iniezione se il nome di un prodotto contiene caratteri `<` o `>`.

---

## 6. Migliorie Applicabili all'Architettura Attuale

1. **Profilo Aziendale Configurabile ("Impostazioni Birrificio"):**
   - Creare una scheda *Profilo Birrificio* (Ragione Sociale, Indirizzo, P.IVA, Codice Accisa/Ditta ADM, Telefono, Email, Logo e "Cliente Interno associato") eliminando ogni riferimento cablato ad `"ALVERESE"` e popolando automaticamente l'intestazione dei DDT.
2. **Relazioni basate su ID Univoci Immobili:**
   - Collegare `COTTE_HEAD`, `CONFEZIONAMENTO`, `BEER_MOVEMENTS`, `SALES_ORDERS` e `BEER_PRICE_LIST` tramite `clienteId` e `birraId` (o propagare automaticamente le rinomine a cascata tramite una funzione transazionale `renameClient` / `renameBeer`).
3. **Auto-Backup Giornaliero su File Fisico tramite `launcher.cjs`:**
   - Sfruttare il piccolo server Node già attivo in `launcher.cjs` aggiungendo un endpoint locale `POST /api/auto-backup` che salva automaticamente ad ogni chiusura (o ogni modifica importante) una copia JSON datata in `data/backups/backup_YYYY-MM-DD.json` con rotazione degli ultimi 30 backup. In caso di estrazione improvvisa della chiavetta USB, i dati saranno sempre recuperabili in 1 clic!
4. **Compilazione reale di Tailwind CSS per il 100% Offline:**
   - Importare `./index.css` in `index.tsx`, rimuovere `<script src="https://cdn.tailwindcss.com"></script>` e `<script type="importmap">` da `index.html`, e ricompilare `app_dist/` affinché il programma sia realmente autonomo al 100% senza Internet.
5. **Generazione PDF Nativi per DDT, Preventivi e Schede Cotta:**
   - Affiancare (o sostituire) l'export Excel dei DDT con una stampa **PDF impaginata in formato A4 professionale** pronta per il corriere e l'autista (con doppia copia Mittente/Destinatario, calcolo peso lordo automatico pedana e causale trasporto).
6. **Supporto Unità di Misura Esplicite e Conversione Automatica (`kg` ↔ `g`, `L` ↔ `hL`):**
   - Salvare l'unità di misura su ogni articolo di magazzino e su ogni riga ricetta, convertendo automaticamente i grammi in chilogrammi durante gli scarichi e nelle verifiche di disponibilità del calendario.

---

## 7. Funzionalità Aggiuntive Consigliate per un Birrificio Artigianale

Di seguito le funzionalità ad alto valore aggiunto che trasformerebbero **Brew Panda** in un ERP brassicolo completo di livello professionale:

### 7.1. Modulo "Tracciabilità HACCP & Richiamo Lotto in 1 Clic" (Obbligatorio per legge alimentare)
- **Ricerca Bidirezionale:**
  - *Dal Fornitore al Cliente (Forward Traceability):* Inserendo un `LOTTO_FORNITORE` (es. un lotto di malto o un lotto di bottiglie difettose), il sistema mostra istantaneamente tutte le cotte in cui è stato impiegato e **tutti i clienti/DDT** a cui quelle bottiglie o fusti sono stati consegnati.
  - *Dal Cliente al Fornitore (Backward Traceability):* Inserendo il `LOTTO` stampato su una bottiglia, stampa il dossier completo di produzione (materie prime con lotti fornitore, curva di fermentazione, operatore, sanificazione tank precedente, materiali di confezionamento).

### 7.2. Gestione Parco Fusti in Acciaio & Cauzioni (Keg Tracking)
- Anagrafica o contatore fusti inox per formato (20L, 24L, 30L) con stato: *Pieno in Cella*, *Vuoto Sporco*, *Vuoto Lavato/Sanificato*, *Presso Cliente*.
- Quando si emette un DDT con fusti in acciaio, il saldo fusti presso quel cliente aumenta automaticamente (`+3 fusti 30L da Pub Rossi`); registrando il rientro vuoti si aggiorna il saldo e si evidenziano i fusti non restituiti da oltre 60/90 giorni.

### 7.3. Registro Accise / Dogane (Supporto Telematico ADM)
- Calcolo automatico degli **Ettolitri-Grado** mensili e annuali sulle cotte accertate e sulla birra condizionata.
- Prospetto riepilogativo pronto per la dichiarazione mensile/annuale Dogane: carico materie prime amidacee, mosto prodotto, cali di lavorazione/fermentazione/confezionamento (verifica rispetto alle tolleranze di legge) e imposta maturata con gestione automatica dell'aliquota ridotta per microbirrifici.

### 7.4. Calcolatore Tecnologico Sala Cotte & Scalatura Ricette
- Ridimensionamento dinamico della ricetta: cambiando i litri target (es. da 1.000 L a 1.200 L o doppia cotta 2.000 L) o l'efficienza attesa, malti, luppoli e sali vengono ricalcolati istantaneamente.
- Calcolo in tempo reale di **OG / FG attese**, **IBU** (formula Tinseth con correzione Whirlpool), **EBC/SRM** (colore Morey), **ABV %** e **Attenuazione Apparente %**, con confronto tra *Valori Target Ricetta* e *Valori Reali Ottenuti* per monitorare la costanza produttiva lotto dopo lotto.

### 7.5. Laboratorio Lieviti (Pitching, Raccolto e Generazioni)
- Molti birrifici riutilizzano il lievito (*repitching*) recuperandolo dal cono del fermentatore da una cotta all'altra (Gen 1 → Gen 2 → Gen 3...).
- Consentire di selezionare come fonte lievito in cotta non solo una busta nuova da magazzino, ma anche il **"Raccolto da Lotto precedente (es. Fermentatore 2 - Gen. 2)"**, tracciando la genealogia del lievito e ripartendo correttamente il costo della busta madre sulle generazioni successive.

### 7.6. Scadenzario Pagamenti, Fatturazione Elettronica (XML FatturaPA) e Margini per Cliente
- Stato commerciale degli ordini: *Bozza → Confermato → Consegnato (DDT emesso) → Fatturato → Pagato*.
- Esportazione tracciato **XML FatturaPA** a partire da uno o più DDT del mese (fatturazione differita riepilogativa di fine mese, tipica del settore Ho.Re.Ca.) da caricare direttamente nel cassetto fiscale / gestionale SDI.
- Report di marginalità netta per cliente e per formato (confrontando il prezzo netto scontato di vendita di ogni formato con il `Costo Totale Confezionato` calcolato da `CostAnalysisView`).

### 7.7. "Modalità Operatore di Cantina" (Vista Semplificata Touch & Etichette QR)
- Vista ad alto contrasto con pulsanti grandi pensata per tablet/smartphone usati in produzione con mani bagnate o guanti: inserimento rapido di *Temperatura / Plato / pH* giornalieri e spunta task del giorno (Dry-Hop, Scarico lievito, Cold crash, CIP) senza esporre costi, listini o dati amministrativi.
- Stampa scheda fermentatore da appendere al tank con **QR Code**: inquadrandolo col telefono in rete locale, apre direttamente il diario fermentazione di quel fermentatore.

---

## 8. Piano d'Azione / Roadmap Consigliata

Per intervenire in modo ordinato senza interrompere l'operatività del birrificio, si consiglia di procedere in **3 fasi**:

| Fase | Obiettivo | Interventi Principali | Priorità |
| :--- | :--- | :--- | :---: |
| **Fase 1 — Messa in Sicurezza (Hotfix)** | Eliminare perdite dati ed errori di calcolo immediati | 1. Fix `handleUndoLastPackaging` in `BrewPage.tsx` (preservare gli altri lotti).<br>2. Fix `createNewYear`: mantenere `LOTTO_FORNITORE` e `DATA_SCADENZA`, correggere filtro `'MALTI'/'LUPPOLI'/'LIEVITI'` e copiare `BEER_PRICE_LIST`, `CLIENT_OFFERS`, `MAINTENANCE_PLANS`.<br>3. Fix Tailwind offline (`import './index.css'` e rimozione CDN).<br>4. Fix avviso scadenze birra in Home includendo `CONFEZIONAMENTO`.<br>5. Fix formati 30L in listini/ordini e gestione bottiglie sfuse in inventario. | **URGENTE** |
| **Fase 2 — Solidità Gestionale & Contesto Birrificio** | Allineare il software al lavoro reale di cantina e ufficio | 1. Introdurre *Impostazioni Profilo Birrificio* rimuovendo `"ALVERESE"` cablato.<br>2. Mantenere storico `FERMENTATORE` a lotto chiuso e abilitare **Doppia Cotta** sullo stesso tank.<br>3. Scalatura ricette su litri + conversione `g`/`kg` + cumulo fabbisogni cotte pianificate.<br>4. Correggere doppio conteggio vendite BeerFirm e aggiungere tasto *Annulla Ordine*.<br>5. Auto-backup JSON su cartella `data/backups` e stampa PDF/Excel stilizzata dei DDT. | **ALTA** |
| **Fase 3 — Evoluzione ERP Brassicolo** | Conformità fiscale, qualità e controllo avanzato | 1. Modulo **Tracciabilità HACCP / Richiamo Lotti** in 1 clic.<br>2. Gestione **Parco Fusti Acciaio a Rendere** presso i clienti.<br>3. Calcolo automatico ABV%, Attenuazione%, pH/Pressione in cantina e genealogia Lieviti.<br>4. Prospetto **Registro Accise Dogane (ADM)** e Fatturazione riepilogativa DDT. | **MEDIA / EVOLUTIVA** |

---
*Documento redatto a seguito di verifica statica e funzionale dell'intero codice sorgente di Brew Panda v1.5.2.*
