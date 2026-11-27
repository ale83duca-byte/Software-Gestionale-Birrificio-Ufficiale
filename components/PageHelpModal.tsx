import React, { useState, useEffect } from 'react';
import type { View } from '../App';
import { XMarkIcon, QuestionMarkCircleIcon } from './icons';

interface PageHelpModalProps {
    isOpen: boolean;
    onClose: () => void;
    currentView: View;
}

interface HelpTopic {
    view: View;
    title: string;
    category: string;
    summary: string;
    steps: string[];
    tips: string[];
}

const HELP_TOPICS: HelpTopic[] = [
    {
        view: 'HOME',
        title: 'Dashboard Produzione & Allarmi Operativi',
        category: 'Generale',
        summary: 'Quadro di controllo principale del birrificio: mostra il registro sintetico delle cotte dell\'anno, i promemoria della cantina e gli allarmi di scadenza.',
        steps: [
            'Controlla in alto i box di allarme per Materie Prime in scadenza, Birre Confezionate vicine al TMC ("Da consumarsi preferibilmente entro") e livello Riserva Cisterna Gas.',
            'Il primo lunedì del mese (e il 31 Dicembre) compare il promemoria automatico per eseguire l\'Inventario Mensile Birra.',
            'Dalla tabella riepilogativa vedi per ogni cotta: litri mosto, gradi Plato, m³ di gas utilizzati, fermentatore e formati confezionati.'
        ],
        tips: [
            'Clicca direttamente sui pulsanti rapidi negli avvisi per saltare alla Cantina, al Calendario o alla gestione TMC del Magazzino Birra.'
        ]
    },
    {
        view: 'KEG_TRACKING',
        title: 'Parco Fusti Inox & Cauzioni (Come gestirlo con Lavaggio e Inventario)',
        category: 'Logistica & Confezionamento',
        summary: 'Gestisce il ciclo fisico dei fusti in acciaio riutilizzabili (Pieni in Cella, Consegnati ai Clienti, Rientrati Sporchi, Lavati/Sanificati e Saturati di CO2) senza duplicare le vendite di birra.',
        steps: [
            '1. CONFEZIONAMENTO: Quando confezioni una cotta in Fusti Inox nel Foglio Cotta, i fusti vuoti vengono scalati dal magazzino imballaggi e diventano fusti pieni di birra.',
            '2. CONSEGNA AI CLIENTI / INVENTARIO INIZIO MESE: Se registri un Ordine o una Commissione, oppure quando a inizio mese fai l\'Inventario Birra e rilevi fusti mancanti (= venduti), il programma aggiorna automaticamente anche il contatore dei fusti fuori presso "Clienti Vari / Conto Vendita".',
            '3. RIENTRO SETTIMANALE + LAVAGGIO E CO2: Settimana per settimana, quando ritiri i fusti vuoti dai clienti, li lavi, sanifichi e saturi di CO2, apri questa pagina e registra un movimento scegliendo "Rientro + Lavaggio, Sanificazione & CO2 (Subito Pronti)".',
            '4. SE LI LAVI IN UN SECONDO MOMENTO: Scegli prima "Rientro Vuoti Sporchi da Cliente" quando scarichi il furgone, e poi "Lavaggio + Sanificazione + CO2" quando fai il ciclo lavatrice fusti.'
        ],
        tips: [
            'IMPORTANTE: All\'Inventario Birra del primo lunedì del mese devi continuare a contare SOLO I FUSTI PIENI DI BIRRA presenti in cella! I fusti vuoti lavati e saturati di CO2 NON vanno messi nell\'inventario della birra finita, perché sono contenitori vuoti pronti per il prossimo confezionamento.'
        ]
    },
    {
        view: 'BEER_WAREHOUSE',
        title: 'Magazzino Birra Doppio Sito, DDT Camion, Scadenze TMC & Lotti Contestati',
        category: 'Magazzino Birra Finita',
        summary: 'Separa fisicamente le Celle del Birrificio (rifermentazione/maturazione 7-14 gg) dal Magazzino Centrale di Vendita e gestisce scadenze TMC e lotti ossidati/contestati.',
        steps: [
            'SCHEDA 1 - MAGAZZINO CENTRALE VENDITA: Mostra solo la birra pronta alla vendita già trasferita nel magazzino centrale. Da qui vedi i giorni mancanti al TMC.',
            'BIRRA IN SCADENZA (TMC): La birra ha per legge il termine "Da consumarsi preferibilmente entro" (TMC). Cliccando "Promo TMC / Blocca" puoi metterla in vendita promozionale a prezzo scontato (il nuovo prezzo viene applicato in automatico negli ordini!), oppure cliccando "Scarta / Distruggi" la scarichi nei "Litri Scartati / Scaduti" senza gonfiare i Litri Venduti.',
            'LOTTO ROVINATO O CONTESTATO (es. Ossidazione): Clicca "Promo TMC / Blocca" -> imposta "Lotto Bloccato / Contestato" per impedirne la vendita in attesa di verifica, oppure clicca "Scarta / Distruggi" con causale Ossidazione/Contestazione.',
            'SCHEDA 2 - CELLA BIRRIFICIO & DDT CAMION: Qui trovi i lotti appena confezionati in rifermentazione. Quando sono pronti per essere caricati sul camion, inserisci le quantità da spostare e clicca "Emetti DDT Trasferimento & Carica Magazzino Centrale": il software svuota la Cella Birrificio, carica il Magazzino Centrale e stampa il DDT A4 con lotti e colli.'
        ],
        tips: [
            'Se per una cotta non hai bisogno del passaggio camion, nel Foglio Cotta puoi scegliere direttamente "Magazzino Centrale Vendita" come destinazione confezionamento.'
        ]
    },
    {
        view: 'BEER_INVENTORY',
        title: 'Inventario Mensile Birra & Ricalibrazione Resi Fiere / Conto Vendita',
        category: 'Magazzino Birra Finita',
        summary: 'Calcola i consumi/vendite mensili per differenza fisica sul primo lunedì del mese e permette di ricalibrare i fusti/cartoni rientrati pieni da fiere, eventi o conto vendita.',
        steps: [
            '1. SCEGLI IL SITO DA CONTARE: Puoi contare il "Magazzino Centrale Vendita" (che calcola le vendite effettive del mese appena concluso) oppure verificare le giacenze della "Cella Birrificio".',
            '2. RICALIBRAZIONE RESI FIERE / CONTO VENDITA: Se il mese scorso avevi dato fuori 40 fusti a una fiera (che all\'inventario erano risultati assenti e quindi venduti) e questo mese te ne riportano indietro 12 pieni, inserisci "12" nella colonna verde "Resi Fiere / C.Vendita (+Pz)" e scrivi la giacenza reale contata oggi in cella.',
            '3. LOTTI TORNATI DA GIACENZA ZERO: Se un lotto era sceso a 0 il mese scorso e ti rientrano dei fusti pieni oggi, clicca il pulsante "+ Rientro Fusti da Fiera su Lotto a Giacenza 0" per reinserirlo subito in conteggio.',
            '4. EFFETTO SUI LITRI VENDUTI: I resi da conto vendita ripristinano la giacenza in magazzino e scalano automaticamente quei litri dal monte annuo dei Litri Venduti Netti!'
        ],
        tips: [
            'Se durante il conteggio trovi bottiglie rotte o fusti difettosi, inseriscili nella colonna "Scarti / Rotture (-Pz)": finiranno nei Litri Scartati e non nelle vendite.'
        ]
    },
    {
        view: 'BREW_PAGE',
        title: 'Foglio Cotta, Scarico Materie Prime & Rettifica Lotto Chiuso',
        category: 'Produzione',
        summary: 'Gestisce la ricetta di sala cotte, lo scarico lotti materie prime, i contatori (mosto e m³ gas), il confezionamento e l\'eventuale correzione controllata di un lotto già chiuso.',
        steps: [
            'MODIFICA INGREDIENTI SENZA DOPPIO SCARICO: Se ti accorgi di aver sbagliato quantità o ingrediente nel foglio cotta e clicchi Modifica + Salva, il programma sostituisce lo scarico precedente del lotto senza mai sommare due volte il prelievo dal magazzino.',
            'DESTINAZIONE CONFEZIONAMENTO: Nella sezione confezionamento scegli se mandare la birra in "Cella Birrificio (Rifermentazione 7-14 gg)" oppure direttamente nel "Magazzino Centrale".',
            'MODIFICA RAPIDA DATA TMC (ANCHE A LOTTO CHIUSO): Se dopo aver chiuso il lotto ti accorgi di aver sbagliato la data del TMC (scadenza), apri semplicemente il lotto, vai in basso a "Riepilogo Confezionato" e clicca l\'icona matita accanto alla data TMC: la correzione aggiorna istantaneamente Magazzino Birra, ordine FEFO e avvisi scadenza senza sbloccare la cotta.',
            'COME MODIFICARE UN LOTTO CHIUSO IN SICUREZZA: Se avevi già cliccato "Lotto Chiuso" e scopri un errore di battitura su ingredienti o contatori (es. kg di malto o lettura gas), clicca il pulsante ambra in alto "Sblocca per Rettifica Controllata". Fai la correzione e clicca "Salva Rettifica e Riblocca Lotto": il fermentatore in Cantina resta libero, il magazzino si riallinea al grammo e l\'Analisi Costi viene ricalcolata.'
        ],
        tips: [
            'Ricorda di compilare le letture del contatore Gas (m³): verranno scalate automaticamente anche dalla Cisterna Gas!'
        ]
    },
    {
        view: 'SALES_ORDER',
        title: 'Commissioni d\'Ordine & BeerFirm (Senza Doppio Conteggio Vendite)',
        category: 'Commerciale',
        summary: 'Gestisce la cessione di birra prodotta su un lotto interno verso una BeerFirm o cliente committente evitando duplicazioni nei litri annui venduti.',
        steps: [
            'MODALITÀ 1 - RITIRO DIRETTO / CESSIONE DEFINITIVA (Consigliata): Quando la BeerFirm ritira la birra (o gliela spedisci definitivamente), scegli "Ritiro Diretto". Il software scarica il tuo magazzino e registra UNA SOLA volta la vendita senza creare giacenze fantasma intestate alla BeerFirm.',
            'MODALITÀ 2 - CONTO DEPOSITO IN CELLA: Sceglila SOLO se la birra resta fisicamente stoccata nelle tue celle per conto della BeerFirm. In questo caso il software esegue un "Trasferimento Interno Proprietà" (che NON conta come vendita) e conterà i litri venduti una sola volta quando la BeerFirm ritirerà/venderà effettivamente la merce.'
        ],
        tips: [
            'I lotti disponibili vengono ordinati automaticamente in ordine FEFO (prima scadenza TMC in alto) e il sistema ti avvisa con un clic se esiste un lotto più vecchio da smaltire prima.',
            'I lotti bloccati per contestazione/ossidazione vengono nascosti automaticamente dal menu per evitare consegne accidentali.'
        ]
    },
    {
        view: 'GAS_TANK',
        title: 'Cisterna Gas (GPL/Metano) & Bombole Cantina (CO₂ / Azoto / Argon)',
        category: 'Impianto & Utenze',
        summary: 'Gestisce sia la Cisterna GPL/Metano di sala cotte (Litri ↔ m³) sia il parco Bombole Tecniche di cantina (CO₂, Azoto/Carboazoto, Argon) con il metodo pratico del "Cambio Bombola" senza flussimetri né pesate.',
        steps: [
            '1. CISTERNA GPL/METANO (E ALLINEAMENTO A ANNO IN CORSO): Imposta capienza (es. 2.750 L) e proporzione Litri ↔ m³ (1 L GPL ≈ 0,260 m³). Se importi dati a metà anno usa il riquadro "Allineamento rapido al manometro oggi (%)": fisserà la lettura odierna senza scalare due volte le cotte dei mesi passati.',
            '2. BOMBOLE CO₂ / AZOTO / ARGON SENZA PESATE: Non serve sapere quanti grammi consumi a singolo confezionamento! Nella scheda "Bombole CO₂ / Azoto / Argon" imposti quante bombole hai oggi (Piene di Scorta, In Uso Ora, Vuote da Rendere).',
            '3. QUANDO FINISCE UNA BOMBOLA (1 CLIC): Clicca solo il pulsante "Bombola Finita → Attacca Nuova": il programma sposta 1 bombola tra le Vuote da Rendere, ne preleva 1 dalle Piene di Scorta e calcola da solo la resa reale dell\'impianto (g CO₂ / Litro confezionato) segnalando eventuali micro-perdite sulle linee (> 28 g/L).',
            '4. CONSEGNA FORNITORE VUOTO PER PIENO & COSTI COTTA: Quando passa il camion delle bombole registra quante piene lascia e quanti vuoti ritira; con un clic puoi aggiornare automaticamente anche i Coefficienti di Costo Cotta (CO₂ e Azoto).'
        ],
        tips: [
            'Guarda il riquadro "Spazio Scaricabile (Litri)" prima di chiamare l\'autobotte GPL per non superare l\'85%, e tieni d\'occhio in Home l\'avviso automatico quando resta solo 1 bombola piena di CO₂ di scorta!'
        ]
    },
    {
        view: 'SALES_TREND',
        title: 'Andamento Vendite, Confronto Anno Precedente (YoY) & Mese su Mese (MoM)',
        category: 'Statistiche & Direzione',
        summary: 'Analizza le vendite nette depurate dai trasferimenti interni e dai resi fiere, separando chiaramente i Litri Scartati/Scaduti e confrontando le performance nel tempo.',
        steps: [
            'Controlla in alto i KPI: Litri Venduti Netti (con crescita/calo % rispetto all\'anno precedente), Mix Fusti vs Bottiglie %, Resi Conto Vendita ricalibrati e Litri Scartati/Contestati.',
            'Usa la sezione "Confronto Storico Mese Prec. (MoM) & Anno Prec. (YoY)" per capire a colpo d\'occhio quali birre, quali formati e quali clienti stanno crescendo o flettendo.',
            'Clicca su una singola birra nel grafico a candele per aprire la matrice stagionale Mesi x Formati.'
        ],
        tips: [
            'Puoi filtrare l\'intera pagina per singolo Cliente usando il menu a tendina in alto a destra.'
        ]
    },
    {
        view: 'PRODUCTION_TREND',
        title: 'Andamento Produzione, Confronto Storico & Previsione Cotte',
        category: 'Statistiche & Direzione',
        summary: 'Monitora i volumi brassati e confezionati, le rese di cantina, i consumi di gas e confronta la produzione con i mesi e l\'anno precedente.',
        steps: [
            'Nella scheda "Produzioni & Dettaglio Mese" visualizzi i litri prodotti, la variazione % rispetto all\'anno precedente e la tabella di crescita/calo per singola tipologia di birra e formato.',
            'Nella scheda "Previsione di Produzione" il motore calcola i giorni medi di maturazione in cantina e ti suggerisce cosa brassare questo mese per non restare senza scorte nei mesi di picco estivo.',
            'Clicca "Pianifica a Calendario" su un suggerimento per inserirlo direttamente nel Calendario Produzione.'
        ],
        tips: [
            'Controlla l\'indicatore di perdita/resa tra Litri in Fermentatore e Litri Confezionati per individuare eventuali perdite anomale in filtrazione o dry-hopping.'
        ]
    },
    {
        view: 'COST_ANALYSIS',
        title: 'Analisi Costi Lotto & Riapertura Analisi Chiusa',
        category: 'Amministrazione',
        summary: 'Calcola il costo vivo al litro e a cartone/fusto sommando materie prime, confezionamento, energia elettrica, acqua, gas, accisa e manodopera.',
        steps: [
            'Seleziona il cliente e clicca su un lotto confezionato per aprire il dettaglio analitico dei costi.',
            'Se hai modificato un Lotto Chiuso (es. corretto i kg di malto o i cartoni prodotti) o aggiornato il costo del gas, clicca il pulsante "Riapri / Ricalcola Analisi Costi" per rigenerare i conti aggiornati.'
        ],
        tips: [
            'Aggiorna periodicamente i Coefficienti Costi dalla barra destra per avere margini sempre realistici.'
        ]
    },
    {
        view: 'CANTINA',
        title: 'Gestione Cantina & Fermentatori',
        category: 'Produzione',
        summary: 'Visualizza i fermentatori occupati e liberi, le curve di fermentazione (°P, pH, Temperatura) e i giorni residui al confezionamento.',
        steps: [
            'Clicca su un fermentatore attivo per aprire direttamente il Foglio Cotta del lotto in fermentazione e registrare le letture giornaliere di densità e temperatura.',
            'Quando chiudi il ciclo cantina/lotto dal Foglio Cotta, il fermentatore torna automaticamente verde (Libero).'
        ],
        tips: [
            'Anche se sblocchi un Lotto Chiuso per una rettifica amministrativa, il fermentatore non viene rioccupato.'
        ]
    },
    {
        view: 'WAREHOUSE',
        title: 'Magazzino Materie Prime & Imballaggi',
        category: 'Magazzino',
        summary: 'Mostra la giacenza attuale divisa per lotto fornitore e scadenza di malti, luppoli, lieviti, spezie, bottiglie, fusti vuoti, tappi e cartoni.',
        steps: [
            'Usa "Carico Merce" nella barra sinistra quando arriva una fattura/DDT fornitore.',
            'Usa "Scarico Merce Generico" solo per consumi extra-cotta (es. rotture in magazzino o campioni), perché gli ingredienti delle cotte vengono scaricati automaticamente dal Foglio Cotta.'
        ],
        tips: [
            'I lotti vicini alla scadenza vengono evidenziati automaticamente in giallo/rosso.'
        ]
    },
    {
        view: 'MOVEMENTS',
        title: 'Registro Movimenti Materie Prime',
        category: 'Magazzino',
        summary: 'Storico completo di tutti i carichi fattura e gli scarichi cotta sulle materie prime e materiali di confezionamento.',
        steps: [
            'Usa la casella di ricerca in basso a sinistra per filtrare per ingrediente, lotto fornitore o numero cotta.',
            'Puoi modificare o eliminare singoli movimenti manuali cliccando le icone a destra della riga.'
        ],
        tips: [
            'Per correggere lo scarico ingredienti di una cotta, fallo sempre aprendo il Foglio Cotta così ricetta, magazzino e tracciabilità HACCP restano sincronizzati.'
        ]
    },
    {
        view: 'PACKAGED_BEER_ORDERS',
        title: 'Ordini Birre Confezionate & Prezzi Promo TMC',
        category: 'Commerciale',
        summary: 'Registra gli ordini clienti di birra finita attingendo dal Magazzino Centrale di Vendita e applicando listini personalizzati o sconti TMC.',
        steps: [
            'Seleziona il cliente, aggiungi le righe scegliendo Birra, Formato e Lotto dal Magazzino Centrale (i lotti sono già ordinati per FEFO, dal TMC più vicino al più lontano).',
            'Se selezioni per errore un lotto giovane mentre in cella c\'è ancora un lotto con scadenza TMC antecedente, compare un avviso ambra con il tasto rapido "Passa al Lotto..." per ruotare subito il magazzino.',
            'Se un lotto è stato messo in "Promo Scadenza TMC" nel Magazzino Birra, il prezzo scontato viene inserito automaticamente nell\'ordine.'
        ],
        tips: [
            'Puoi stampare il DDT / Conferma d\'ordine professionale in formato A4.'
        ]
    },
    {
        view: 'BEER_PRICE_LIST',
        title: 'Listino Prezzi Birre Finite',
        category: 'Commerciale',
        summary: 'Configura i prezzi standard per formato (fusti, cartoni, bottiglie) e gli eventuali listini dedicati per singoli clienti o distributori.',
        steps: [
            'Imposta prima il Listino Base del birrificio e poi, se necessario, crea listini dedicati per clienti specifici.'
        ],
        tips: [
            'I prezzi configurati qui vengono proposti in automatico nella creazione degli Ordini Birre Confezionate.'
        ]
    },
    {
        view: 'TRACEABILITY',
        title: 'Tracciabilità Alimentare HACCP Bidirezionale',
        category: 'Qualità & Dogane',
        summary: 'Ricostruisce istantaneamente il legame Lotto Fornitore <-> Lotto Cotta <-> Clienti Destinatari per ispezioni ASL/ICQRF.',
        steps: [
            'Ricerca per Lotto Produzione: mostra tutti i lotti di malto/luppolo/lievito usati e tutti i clienti che hanno ricevuto quella birra.',
            'Ricerca per Lotto Ingrediente Fornitore: inserisci un lotto di materia prima per scoprire subito in quali cotte è stato impiegato.'
        ],
        tips: [
            'Stampa la Scheda Ufficiale HACCP in A4 in caso di controllo sanitario.'
        ]
    },
    {
        view: 'EXCISE_INVOICING',
        title: 'Registro Accise Dogane (ADM), Distruzione Merce & Fatturazione SDI',
        category: 'Qualità & Dogane',
        summary: 'Calcola l\'accisa birra su Ettolitri-Grado Plato, prepara la Comunicazione Preventiva ADM per il recupero accisa sui lotti scartati/scaduti e genera i file XML FatturaPA.',
        steps: [
            '1. REGISTRO MENSILE ADM: Controlla il riepilogo mensile delle cotte confezionate con calcolo automatico dell\'imposta maturata e aliquota ridotta microbirrifici.',
            '2. FATTURAZIONE ELETTRONICA SDI: Genera ed esporta il file XML FatturaPA o la copia di cortesia A4 delle fatture riepilogative.',
            '3. DISTRUZIONE MERCE & RECUPERO ACCISA ADM: Nella terza scheda il programma raccoglie in automatico tutti gli scarichi per Scadenza TMC, Ossidazione/Difetto o Contestazione, incrocia il Grado Plato fiscale della cotta e stampa il modulo A4 ufficiale da inviare via PEC all\'Ufficio delle Dogane (Art. 14 e 22 TUA) per il rimborso/accredito dell\'accisa.'
        ],
        tips: [
            'Ricorda di inviare via PEC la Comunicazione Preventiva almeno 5 giorni lavorativi prima dello sversamento fisico dei lotti ad accisa assolta.'
        ]
    },
    {
        view: 'CALENDAR',
        title: 'Calendario Produzione, CIP & Scadenze Cantina',
        category: 'Produzione',
        summary: 'Pianifica le cotte future verificando in anticipo se ci sono abbastanza materie prime in magazzino e programma i lavaggi CIP.',
        steps: [
            'Aggiungi una Cotta Pianificata: il software controlla subito la ricetta e ti avvisa se mancano malti o luppoli.',
            'Dal giorno pianificato puoi avviare direttamente il Foglio Cotta precompilato.'
        ],
        tips: [
            'Registra i cicli CIP periodici su sala cotte, scambiatore e fermentatori per ricevere gli avvisi in Home.'
        ]
    },
    {
        view: 'DATABASE',
        title: 'Database Clienti, Ricette Birre & Materie Prime',
        category: 'Produzione',
        summary: 'Archivio anagrafico dei clienti/BeerFirm, delle ricette standard per litro di mosto e del catalogo ingredienti.',
        steps: [
            'Crea o aggiorna qui le ricette base: verranno caricate e proporzionate automaticamente ai litri desiderati ogni volta che apri una Nuova Cotta.'
        ],
        tips: [
            'Se rinomini una birra o un cliente da qui, il programma aggiorna automaticamente tutti i riferimenti storici dell\'anno.'
        ]
    },
    {
        view: 'QUOTES_LIST',
        title: 'Gestione Preventivi Conto Terzi / Forniture',
        category: 'Commerciale',
        summary: 'Archivio dei preventivi di produzione o fornitura emessi per BeerFirm, pub ed eventi.',
        steps: [
            'Clicca "Nuovo Preventivo" per calcolare costi, margini e stampare un preventivo professionale.'
        ],
        tips: [
            'Puoi riaprire e duplicare o aggiornare qualsiasi preventivo salvato.'
        ]
    },
    {
        view: 'BREW_QUOTE',
        title: 'Compilazione Preventivo Cotta',
        category: 'Commerciale',
        summary: 'Simulatore economico per formulare preventivi precisi di produzione conto terzi.',
        steps: [
            'Inserisci ricetta, formati richiesti e ricarico desiderato per ottenere il prezzo chiavi in mano per il cliente.'
        ],
        tips: [
            'Salva il preventivo per ritrovarlo nell\'elenco storico.'
        ]
    },
    {
        view: 'NETLIFY_GUIDE',
        title: 'App Tablet & Smartphone (GitHub Privato + Netlify + QR)',
        category: 'Mobilità & Sync',
        summary: 'Permette di installare Brew Panda su Tablet e Smartphone collegando un repository GitHub Privato a Netlify, mantenendo la privacy assoluta dei dati e il funzionamento offline su PC Centrale / Chiavetta USB.',
        steps: [
            '1. PUBBLICAZIONE PRIVATA: Carica il codice su un repository GitHub impostato su "Private". Il file .gitignore blocca automaticamente cartelle locali (data/) e backup (*.json).',
            '2. COLLEGAMENTO NETLIFY: Importa il repository su Netlify (Build command: npm run build, Publish: dist) e assegna il nome del sito (es. https://tuo-birrificio.netlify.app).',
            '3. CODICE QR: Scrivi il nome scelto nella pagina "App Tablet & Netlify (QR)" e inquadra il Codice QR dalla fotocamera di Tablet o Smartphone per installare l\'app sulla schermata Home.',
            '4. SINCRONIZZAZIONE BACKUP: Usa "Esporta Tutti i Dati" per inviare il file .json da Smartphone/Tablet (via WhatsApp, Google Drive o Email) al PC Centrale e importalo con "Importa Dati".'
        ],
        tips: [
            'Su GitHub e Netlify risiede SOLO il codice vuoto dell\'applicazione: clienti, cotte, prezzi e giacenze restano esclusivamente nella memoria locale dei tuoi dispositivi.'
        ]
    }
];

export const PageHelpModal: React.FC<PageHelpModalProps> = ({ isOpen, onClose, currentView }) => {
    const [selectedView, setSelectedView] = useState<View>(currentView);
    const [searchQuery, setSearchQuery] = useState('');

    useEffect(() => {
        if (isOpen) {
            setSelectedView(currentView);
            setSearchQuery('');
        }
    }, [isOpen, currentView]);

    if (!isOpen) return null;

    const activeTopic = HELP_TOPICS.find(t => t.view === selectedView) || HELP_TOPICS[0];

    const filteredTopics = HELP_TOPICS.filter(t => {
        if (!searchQuery.trim()) return true;
        const q = searchQuery.toLowerCase();
        return (
            t.title.toLowerCase().includes(q) ||
            t.summary.toLowerCase().includes(q) ||
            t.steps.some(s => s.toLowerCase().includes(q))
        );
    });

    return (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6">
            <div className="bg-brew-dark border-2 border-brew-accent rounded-2xl w-full max-w-5xl max-h-[88vh] flex flex-col shadow-2xl overflow-hidden">
                {/* Header */}
                <div className="p-4 sm:p-5 bg-slate-900 border-b border-slate-700 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-brew-accent/20 text-brew-accent rounded-xl">
                            <QuestionMarkCircleIcon className="w-7 h-7" />
                        </div>
                        <div>
                            <h2 className="text-lg sm:text-xl font-black text-white">
                                Guida Operativa Brew Panda — Come gestire ogni reparto
                            </h2>
                            <p className="text-xs text-slate-400">
                                Spiegazione passo-passo della schermata aperta e manuale rapido delle procedure di birrificio
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-lg transition-colors"
                        title="Chiudi guida"
                    >
                        <XMarkIcon className="w-5 h-5" />
                    </button>
                </div>

                {/* Body */}
                <div className="flex-1 grid grid-cols-1 md:grid-cols-12 overflow-hidden">
                    {/* Sidebar argomenti */}
                    <div className="md:col-span-4 border-b md:border-b-0 md:border-r border-slate-700 bg-slate-900/60 p-3 flex flex-col overflow-hidden max-h-52 md:max-h-none">
                        <input
                            type="text"
                            placeholder="Cerca argomento (es. fusti, gas, TMC, inventario)..."
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            className="w-full bg-brew-dark-secondary border border-slate-600 rounded-lg px-3 py-2 text-xs text-white mb-2.5 focus:border-brew-accent focus:outline-none"
                        />
                        <div className="flex-1 overflow-y-auto space-y-1 pr-1">
                            {filteredTopics.map(topic => {
                                const isCurrentPage = topic.view === currentView;
                                const isSelected = topic.view === activeTopic.view;
                                return (
                                    <button
                                        key={topic.view}
                                        onClick={() => setSelectedView(topic.view)}
                                        className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-all flex flex-col gap-0.5 border ${
                                            isSelected
                                                ? 'bg-brew-accent text-brew-dark font-bold border-brew-accent shadow'
                                                : 'bg-brew-dark/70 text-slate-200 hover:bg-slate-800 border-slate-800'
                                        }`}
                                    >
                                        <div className="flex items-center justify-between gap-1">
                                            <span className={`text-[10px] uppercase font-extrabold ${isSelected ? 'text-slate-800' : 'text-amber-400'}`}>
                                                {topic.category}
                                            </span>
                                            {isCurrentPage && (
                                                <span className={`text-[9px] px-1.5 py-0.5 rounded font-black ${
                                                    isSelected ? 'bg-brew-dark text-brew-accent' : 'bg-emerald-800 text-emerald-200'
                                                }`}>
                                                    PAGINA ATTUALE
                                                </span>
                                            )}
                                        </div>
                                        <span className="leading-snug">{topic.title}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* Contenuto guida */}
                    <div className="md:col-span-8 p-5 sm:p-6 overflow-y-auto space-y-5 bg-brew-dark">
                        <div>
                            <div className="flex items-center gap-2 mb-1">
                                <span className="px-2.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[11px] font-bold uppercase">
                                    {activeTopic.category}
                                </span>
                                {activeTopic.view === currentView && (
                                    <span className="px-2.5 py-0.5 rounded bg-emerald-900/60 text-emerald-300 border border-emerald-500/40 text-[11px] font-bold">
                                        Guida della pagina in cui ti trovi ora
                                    </span>
                                )}
                            </div>
                            <h3 className="text-xl sm:text-2xl font-black text-brew-accent mt-1">
                                {activeTopic.title}
                            </h3>
                            <p className="text-sm text-slate-300 mt-2 leading-relaxed bg-brew-dark-secondary p-3.5 rounded-xl border border-slate-700">
                                {activeTopic.summary}
                            </p>
                        </div>

                        <div className="space-y-2.5">
                            <h4 className="text-xs font-extrabold uppercase tracking-wider text-white">
                                Come operare passo dopo passo:
                            </h4>
                            <div className="space-y-2.5">
                                {activeTopic.steps.map((step, idx) => (
                                    <div
                                        key={idx}
                                        className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-700/90 text-sm text-slate-200 leading-relaxed"
                                    >
                                        {step}
                                    </div>
                                ))}
                            </div>
                        </div>

                        {activeTopic.tips.length > 0 && (
                            <div className="p-4 rounded-xl bg-emerald-950/40 border border-emerald-500/50 space-y-1.5">
                                <div className="text-xs font-black uppercase tracking-wider text-emerald-300">
                                    💡 Regola d&apos;oro per evitare errori di conteggio:
                                </div>
                                {activeTopic.tips.map((tip, idx) => (
                                    <p key={idx} className="text-xs sm:text-sm text-emerald-100 leading-relaxed">
                                        {tip}
                                    </p>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div className="p-3.5 bg-slate-900 border-t border-slate-700 flex items-center justify-between text-xs text-slate-400">
                    <span>Puoi aprire questa guida da qualsiasi schermata cliccando il pulsante <strong>&quot;? Guida Pagina&quot;</strong> in alto.</span>
                    <button
                        onClick={onClose}
                        className="px-4 py-1.5 bg-brew-accent hover:bg-yellow-400 text-brew-dark font-extrabold rounded-lg transition-colors"
                    >
                        Ho capito, chiudi
                    </button>
                </div>
            </div>
        </div>
    );
};
