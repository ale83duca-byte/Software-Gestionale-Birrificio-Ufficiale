# 🐼 Brew Panda - Guida Completa per Chiavetta USB & Applicazione Desktop

Questa guida ti spiega come portare **Brew Panda** sempre con te su una **chiavetta USB** ed eseguirlo su qualsiasi computer Windows come una **vera applicazione desktop** (in una finestra nativa indipendente, senza barre degli indirizzi, senza schede del browser e con tutti i dati salvati direttamente sulla chiavetta).

---

## ⚡ 1. Come copiare e avviare Brew Panda

1. Collega la chiavetta USB al computer.
2. Crea una cartella sulla chiavetta (es. `BrewPanda`) e copia al suo interno tutti i file del programma:
   - La cartella **`dist/`** *(FONDAMENTALE: contiene l'applicazione già pronta e ottimizzata, circa 1.5 MB)*
   - I file di avvio: **`AVVIA_BREW_PANDA.bat`**, **`launcher.cjs`**, **`brew_panda.ico`**, **`Crea_Collegamento_Desktop.bat`**
3. Fai doppio clic su:
   ```text
   AVVIA_BREW_PANDA.bat
   ```

### Cosa succede automaticamente:
- L'applicazione legge i file dalla cartella `dist/` e si avvia in **0.1 secondi**.
- Rileva in automatico **Microsoft Edge** (presente su tutti i Windows 10 e Windows 11) o **Google Chrome**.
- **Brew Panda si apre immediatamente come applicazione desktop a sé stante**, con la sua icona ufficiale, senza URL, senza schede e a schermo intero.

---

## 💾 2. Dove vengono salvati i tuoi dati (Portabilità Totale)

Tutti i dati del gestionale (magazzino materie prime, ricette, lotti, cotte, cantina, ordini birra confezionata, listini prezzi, clienti e impostazioni):
- Vengono salvati **esclusivamente sulla chiavetta USB** nella cartella:
  ```text
  data\profile\
  ```
- **Vantaggi fondamentali**:
  - Non lasci alcuna traccia né dati aziendali sul PC su cui inserisci la chiavetta.
  - Se usi il programma su diversi computer (ufficio, laboratorio birrificio, computer portatile o a casa), **hai sempre con te l'intero archivio aggiornato all'ultimo secondo**.
  - Funziona al **100% offline** (non serve connessione Internet).

---

## 🛑 3. Come chiudere l'applicazione in sicurezza

1. Chiudi la finestra di Brew Panda cliccando sulla classica `X` in alto a destra.
2. Nella finestra nera del launcher premi `CTRL+C` o chiudila.
3. Per assicurarti che nessun processo sia rimasto attivo prima di staccare la USB, puoi anche fare doppio clic su:
   ```text
   ARRESTA_BREW_PANDA.bat
   ```
4. Fai clic su "Rimozione sicura dell'hardware" nella barra di Windows e scollega la chiavetta.

---

## 💻 4. Requisito Node.js (Se usi un PC privo di Node.js)

Se usi il programma su un computer che **non ha Node.js installato**, puoi rendere la chiavetta **completamente autonoma al 100%** in modo semplicissimo:
1. Scarica lo zip di Node.js (versione Windows x64) dal sito ufficiale:  
   `https://nodejs.org/dist/v20.18.0/node-v20.18.0-win-x64.zip`
2. Estrai il contenuto dello zip dentro una cartella denominata **`nodejs`** nella radice della tua chiavetta USB (in modo che il file `node.exe` si trovi in `chiavetta:\BrewPanda\nodejs\node.exe`).
3. Da quel momento, Brew Panda funzionerà su **qualsiasi computer Windows del mondo**, anche se bloccato o senza permessi di amministratore!

---

## 🖥️ 5. Creare un'icona sul Desktop del PC

Se usi spesso un determinato computer, puoi creare un collegamento rapido sul Desktop:
- Fai doppio clic su:
  ```text
  Crea_Collegamento_Desktop.bat
  ```
  Verrà creata un'icona sul Desktop chiamata **Brew Panda** per avviarlo con un solo clic.

---

## 📦 6. Backup dei Dati

- **Metodo Diretto**: Fai semplicemente una copia della cartella `data\` dalla chiavetta USB al tuo computer o su un cloud drive (Google Drive, Dropbox, OneDrive).
- **Dall'interno del programma**: Nella sezione **Database / Impostazioni**, clicca su **"Esporta Database (JSON)"** o **"Esporta Excel"** per avere un backup completo esportato in qualsiasi momento.
