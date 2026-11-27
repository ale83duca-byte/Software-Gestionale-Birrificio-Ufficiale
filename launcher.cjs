// launcher.cjs - Launcher Nativo e Server Desktop per Brew Panda v2.0.7 ERP
// Funziona con Node.js puro, senza dipendenze npm aggiuntive

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');

const APP_VERSION = '2.0.7-ERP';
const PORT = 3000;
const ROOT_DIR = __dirname;
const APP_DIST_DIR = path.join(ROOT_DIR, 'app_dist');
let DIST_DIR = path.join(ROOT_DIR, 'dist');
const DATA_PROFILE_DIR = path.join(ROOT_DIR, 'data', 'profile');
const DATA_BACKUPS_DIR = path.join(ROOT_DIR, 'data', 'backups');

// Trova il file bundle principale (.js o .css) realmente presente in una cartella assets/
function findActualBundleInDir(dirPath, ext) {
  const assetsDir = path.join(dirPath, 'assets');
  if (!fs.existsSync(assetsDir)) return null;
  try {
    const files = fs.readdirSync(assetsDir).filter(f => f.toLowerCase().endsWith(ext));
    if (files.length === 0) return null;
    // Preferisci i bundle brewpanda-* ordinati dal più recente
    const bpFiles = files.filter(f => f.startsWith('brewpanda-')).sort().reverse();
    if (bpFiles.length > 0) {
      return path.join(assetsDir, bpFiles[0]);
    }
    return path.join(assetsDir, files[0]);
  } catch (e) {
    return null;
  }
}

// Verifica se una directory contiene un build utilizzabile (index.html + almeno un bundle .js e .css in assets/)
function hasUsableBuild(dirPath) {
  const htmlPath = path.join(dirPath, 'index.html');
  if (!fs.existsSync(htmlPath)) return false;
  try {
    const html = fs.readFileSync(htmlPath, 'utf8');
    if (html.includes('cdn.tailwindcss.com') || html.includes('esm.sh')) {
      return false;
    }
    const jsBundle = findActualBundleInDir(dirPath, '.js');
    const cssBundle = findActualBundleInDir(dirPath, '.css');
    return Boolean(jsBundle && cssBundle);
  } catch (e) {
    return false;
  }
}

// Verifica se tutti gli asset esatti referenziati da index.html esistono
function hasExactReferencedAssets(dirPath) {
  const htmlPath = path.join(dirPath, 'index.html');
  if (!fs.existsSync(htmlPath)) return false;
  try {
    const html = fs.readFileSync(htmlPath, 'utf8');
    if (html.includes('cdn.tailwindcss.com') || html.includes('esm.sh')) {
      return false;
    }
    const assetMatches = [...html.matchAll(/(?:src|href)=["'](?:\.\/|\/)?(assets\/[^"'?#]+)["']/g)];
    if (assetMatches.length === 0) return false;
    for (const m of assetMatches) {
      if (!fs.existsSync(path.join(dirPath, m[1]))) {
        return false;
      }
    }
    return true;
  } catch (e) {
    return false;
  }
}

// Sincronizza dist/ con app_dist/ quando app_dist/ ha un build valido
try {
  if (hasUsableBuild(APP_DIST_DIR)) {
    let shouldSync = false;
    if (!hasExactReferencedAssets(DIST_DIR)) {
      shouldSync = true;
    } else {
      const distHtml = fs.readFileSync(path.join(DIST_DIR, 'index.html'), 'utf8');
      const appDistHtml = fs.readFileSync(path.join(APP_DIST_DIR, 'index.html'), 'utf8');
      const distJs = findActualBundleInDir(DIST_DIR, '.js');
      const appDistJs = findActualBundleInDir(APP_DIST_DIR, '.js');
      if (
        distHtml !== appDistHtml ||
        path.basename(distJs || '') !== path.basename(appDistJs || '') ||
        (distJs && appDistJs && fs.statSync(distJs).size !== fs.statSync(appDistJs).size)
      ) {
        shouldSync = true;
      }
    }

    if (shouldSync) {
      if (fs.existsSync(DIST_DIR)) {
        try { fs.rmSync(DIST_DIR, { recursive: true, force: true }); } catch (e) {}
      }
      fs.cpSync(APP_DIST_DIR, DIST_DIR, { recursive: true });
    }
  }
} catch (e) {
  DIST_DIR = APP_DIST_DIR;
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.wasm': 'application/wasm'
};

console.log('====================================================================');
console.log(`       🐼 BREW PANDA v${APP_VERSION} - GESTIONALE BIRRIFICIO        `);
console.log('                 Avvio Applicazione Desktop Offline                 ');
console.log('====================================================================\n');

// 0a. Su Windows chiude eventuali vecchie istanze Node rimaste attive sulla porta 3000 esatta
function stopStaleServerOnPortWindows() {
  if (process.platform !== 'win32') return;
  try {
    const out = execSync('netstat -aon', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const lines = out.split(/\r?\n/);
    const portRegex = new RegExp(`:${PORT}\\b`);
    const pids = new Set();
    for (const line of lines) {
      if (portRegex.test(line) && line.includes('LISTENING')) {
        const parts = line.trim().split(/\s+/);
        const pid = parseInt(parts[parts.length - 1], 10);
        if (pid && pid > 0 && pid !== process.pid) {
          pids.add(pid);
        }
      }
    }
    for (const pid of pids) {
      try {
        console.log(`[INFO] Chiusura precedente server rimasto in background (PID ${pid})...`);
        execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
      } catch (e) {}
    }
  } catch (e) {}
}

// 0b. Rimuove SOLO le vecchie cache HTTP / Service Worker del profilo browser locale
//     NON TOCCA MAI IndexedDB ne' Local Storage (tutti i dati del birrificio restano intatti al 100%)
function cleanStaleBrowserServiceWorkerCache() {
  if (!fs.existsSync(DATA_PROFILE_DIR)) return;
  const cacheSubdirs = [
    path.join(DATA_PROFILE_DIR, 'Default', 'Service Worker'),
    path.join(DATA_PROFILE_DIR, 'Default', 'Cache'),
    path.join(DATA_PROFILE_DIR, 'Default', 'Code Cache'),
    path.join(DATA_PROFILE_DIR, 'Service Worker'),
  ];
  for (const dir of cacheSubdirs) {
    if (fs.existsSync(dir)) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch (e) {
        // Ignora se il browser e' gia' aperto
      }
    }
  }
}

// 1. Verifica presenza applicazione compilata (dist o app_dist)
function ensureBuild() {
  if (hasUsableBuild(DIST_DIR)) {
    console.log(`[OK] Applicazione pronta in dist/ — Versione ${APP_VERSION} (avvio istantaneo)`);
    return true;
  }

  if (hasUsableBuild(APP_DIST_DIR)) {
    console.log(`[OK] Applicazione pronta in app_dist/ — Versione ${APP_VERSION} (avvio istantaneo)`);
    DIST_DIR = APP_DIST_DIR;
    return true;
  }

  console.log('[AVVISO] Bundle precompilato non trovato in app_dist/assets, tentativo di compilazione locale...');

  const isDriveRoot = /^[a-zA-Z]:[\\/]?$/.test(ROOT_DIR);
  const viteBin = path.join(ROOT_DIR, 'node_modules', 'vite', 'bin', 'vite.js');
  if (fs.existsSync(viteBin)) {
    try {
      console.log('[INFO] Compilazione diretta con Vite integrato...');
      execSync(`"${process.execPath}" "${viteBin}" build`, { cwd: ROOT_DIR, stdio: 'inherit' });
      if (hasUsableBuild(DIST_DIR)) {
        console.log('\n[OK] Compilazione completata con successo!\n');
        return true;
      }
    } catch (e) {
      console.warn('[AVVISO] Compilazione diretta Vite non riuscita.');
    }
  }

  if (!isDriveRoot) {
    try {
      const npmCmd = process.platform === 'win32'
        ? (fs.existsSync(path.join(ROOT_DIR, 'nodejs', 'npm.cmd')) ? `"${path.join(ROOT_DIR, 'nodejs', 'npm.cmd')}"` : 'npm')
        : 'npm';
      if (fs.existsSync(path.join(ROOT_DIR, 'node_modules'))) {
        console.log('[INFO] Tento compilazione standard tramite npm...');
        execSync(`${npmCmd} run build`, { cwd: ROOT_DIR, stdio: 'inherit' });
        if (hasUsableBuild(DIST_DIR)) {
          console.log('\n[OK] Compilazione completata con successo!\n');
          return true;
        }
      }
    } catch (err) {}
  }

  console.warn('[ATTENZIONE] File bundle JS/CSS mancanti in app_dist/assets! Verra\' mostrata una pagina diagnostica.');
  return false;
}

// 2. Server HTTP statico con supporto SPA, fallback intelligente asset e Auto-Backup JSON locale
function saveLocalJsonBackup(rawJson) {
  if (!fs.existsSync(DATA_BACKUPS_DIR)) {
    fs.mkdirSync(DATA_BACKUPS_DIR, { recursive: true });
  }
  const parsed = JSON.parse(rawJson);
  const pretty = JSON.stringify(parsed, null, 2);
  const todayStr = new Date().toISOString().slice(0, 10);
  const dailyFile = path.join(DATA_BACKUPS_DIR, `brewpanda_backup_${todayStr}.json`);
  const latestFile = path.join(DATA_BACKUPS_DIR, 'brewpanda_latest.json');

  const tmpFile = `${dailyFile}.tmp`;
  fs.writeFileSync(tmpFile, pretty, 'utf8');
  fs.renameSync(tmpFile, dailyFile);
  fs.copyFileSync(dailyFile, latestFile);

  const backupFiles = fs.readdirSync(DATA_BACKUPS_DIR)
    .filter(name => /^brewpanda_backup_\d{4}-\d{2}-\d{2}\.json$/.test(name))
    .sort();
  if (backupFiles.length > 30) {
    const toRemove = backupFiles.slice(0, backupFiles.length - 30);
    toRemove.forEach(file => {
      try { fs.unlinkSync(path.join(DATA_BACKUPS_DIR, file)); } catch (e) {}
    });
  }
}

function isSubPath(parentDir, candidatePath) {
  const rel = path.relative(parentDir, candidatePath);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function getDiagnosticHtml() {
  return `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8" />
  <title>Brew Panda — Diagnostica Avvio</title>
  <style>
    body { background: #1e293b; color: #f8fafc; font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 24px; }
    .box { max-width: 640px; background: #0f172a; border: 2px solid #f59e0b; border-radius: 16px; padding: 28px; box-shadow: 0 20px 40px rgba(0,0,0,0.5); }
    h1 { color: #fbbf24; margin-top: 0; font-size: 22px; }
    p, li { color: #cbd5e1; line-height: 1.6; font-size: 14px; }
    code { background: #1e293b; color: #38bdf8; padding: 2px 6px; border-radius: 4px; }
  </style>
</head>
<body>
  <div class="box">
    <h1>🐼 Brew Panda v${APP_VERSION} — File Compilati Mancanti</h1>
    <p>Il server locale è partito correttamente, ma nella cartella <code>app_dist/assets/</code> non sono presenti i file compilati (<code>.js</code> e <code>.css</code>).</p>
    <ul>
      <li>Verifica di aver estratto <strong>tutto il contenuto dello ZIP</strong> scaricato (inclusa l'intera cartella <code>app_dist/assets/</code>) senza eliminare i file <code>brewpanda-*.js</code> e <code>brewpanda-*.css</code>.</li>
      <li>I tuoi dati salvati in <code>data/profile/</code> e <code>data/backups/</code> sono al sicuro.</li>
    </ul>
  </div>
</body>
</html>`;
}

function startServer() {
  stopStaleServerOnPortWindows();

  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const cleanUrl = (req.url || '/').split('?')[0];

      if (req.method === 'GET' && cleanUrl === '/api/version') {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ ok: true, version: APP_VERSION, dir: ROOT_DIR }));
        return;
      }

      if (req.method === 'POST' && cleanUrl === '/api/auto-backup') {
        let body = '';
        let aborted = false;
        req.on('data', chunk => {
          body += chunk;
          if (body.length > 50 * 1024 * 1024) {
            aborted = true;
            res.writeHead(413, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'Payload troppo grande' }));
            req.destroy();
          }
        });
        req.on('end', () => {
          if (aborted) return;
          try {
            saveLocalJsonBackup(body);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
          } catch (err) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: err.message }));
          }
        });
        return;
      }

      let reqPath = '/';
      try {
        reqPath = decodeURIComponent(cleanUrl);
      } catch (e) {
        reqPath = '/';
      }
      if (reqPath === '/') reqPath = '/index.html';

      const safeRelPath = path.normalize(reqPath).replace(/^([/\\])+/, '').replace(/^(\.\.([/\\]|$))+/, '');

      if (safeRelPath === 'service-worker.js' && fs.existsSync(path.join(ROOT_DIR, 'service-worker.js'))) {
        const swContent = fs.readFileSync(path.join(ROOT_DIR, 'service-worker.js'));
        res.writeHead(200, {
          'Content-Type': 'application/javascript; charset=utf-8',
          'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
          'Pragma': 'no-cache',
          'Expires': '0',
        });
        res.end(swContent);
        return;
      }

      const activeDir = hasUsableBuild(DIST_DIR)
        ? DIST_DIR
        : (hasUsableBuild(APP_DIST_DIR) ? APP_DIST_DIR : DIST_DIR);

      if (safeRelPath === 'index.html' && !hasUsableBuild(activeDir)) {
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        });
        res.end(getDiagnosticHtml());
        return;
      }

      let filePath = path.resolve(activeDir, safeRelPath);

      if (!isSubPath(activeDir, filePath)) {
        filePath = path.join(activeDir, 'index.html');
      }

      if (!fs.existsSync(filePath)) {
        const altDist = path.resolve(APP_DIST_DIR, safeRelPath);
        if (isSubPath(APP_DIST_DIR, altDist) && fs.existsSync(altDist)) {
          filePath = altDist;
        } else {
          // Fallback intelligente anti-schermata-bianca:
          // se il browser (o una vecchia cache) chiede un vecchio nome bundle in assets/*.js o assets/*.css,
          // servi automaticamente il bundle .js / .css realmente presente in activeDir/assets o app_dist/assets!
          const reqExt = path.extname(safeRelPath).toLowerCase();
          if (safeRelPath.startsWith('assets') && (reqExt === '.js' || reqExt === '.css')) {
            const fallbackBundle =
              findActualBundleInDir(activeDir, reqExt) ||
              findActualBundleInDir(APP_DIST_DIR, reqExt) ||
              findActualBundleInDir(DIST_DIR, reqExt);
            if (fallbackBundle && fs.existsSync(fallbackBundle)) {
              filePath = fallbackBundle;
            }
          } else {
            const rootPath = path.resolve(ROOT_DIR, safeRelPath);
            if (
              isSubPath(ROOT_DIR, rootPath) &&
              !isSubPath(path.join(ROOT_DIR, 'data'), rootPath) &&
              safeRelPath !== 'index.html' &&
              fs.existsSync(rootPath) &&
              fs.statSync(rootPath).isFile()
            ) {
              filePath = rootPath;
            }
          }
        }
      }

      fs.stat(filePath, (err, stats) => {
        if (err || !stats.isFile()) {
          const reqExt = path.extname(safeRelPath).toLowerCase();
          if (reqExt === '.js' || reqExt === '.css') {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Asset non trovato: ' + safeRelPath);
            return;
          }
          if (!hasUsableBuild(activeDir)) {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
            res.end(getDiagnosticHtml());
            return;
          }
          filePath = path.join(activeDir, 'index.html');
        }

        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';

        fs.readFile(filePath, (readErr, content) => {
          if (readErr) {
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('Errore interno del server: ' + readErr.message);
            return;
          }

          res.writeHead(200, {
            'Content-Type': contentType,
            'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
            'Pragma': 'no-cache',
            'Expires': '0',
            'Access-Control-Allow-Origin': '*'
          });
          res.end(content);
        });
      });
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.log(`[INFO] Porta ${PORT} gia' attiva, riutilizzo in corso...`);
        resolve(server);
      } else {
        reject(err);
      }
    });

    server.listen(PORT, '127.0.0.1', () => {
      console.log(`[OK] Server locale attivo su: http://127.0.0.1:${PORT} (v${APP_VERSION})`);
      resolve(server);
    });
  });
}

// 3. Ricerca browser compatibile per la modalita' App Desktop (senza barre)
function findAppRunner() {
  const isWin = process.platform === 'win32';
  if (!isWin) return null;

  const progFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
  const progFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const localAppData = process.env['LocalAppData'] || '';

  // Preferisci Chrome se presente (avvio --app piu' rapido e senza popup First-Run di Edge), altrimenti Edge o Brave
  const candidates = [
    path.join(progFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(progFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(progFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(progFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(localAppData, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(progFiles, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
    path.join(localAppData, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe')
  ];

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

// 4. Apertura finestra applicativa nativa
function openAppWindow() {
  if (!fs.existsSync(DATA_PROFILE_DIR)) {
    fs.mkdirSync(DATA_PROFILE_DIR, { recursive: true });
  }

  cleanStaleBrowserServiceWorkerCache();

  const appRunner = findAppRunner();
  // Il parametro ?v=... bypassa al 100% qualsiasi vecchia entry '/' rimasta in una CacheStorage Service Worker
  const appUrl = `http://127.0.0.1:${PORT}/?v=${APP_VERSION}-${Date.now()}`;

  if (appRunner) {
    console.log(`[OK] Rilevato browser di sistema: ${path.basename(appRunner)}`);
    console.log(`[OK] Avvio di Brew Panda v${APP_VERSION} in modalita' Finestra Desktop...`);

    const args = [
      `--app=${appUrl}`,
      `--user-data-dir=${DATA_PROFILE_DIR}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-features=TranslateUI',
      '--window-size=1440,900',
      '--window-position=50,50'
    ];

    const child = spawn(appRunner, args, {
      detached: true,
      stdio: 'ignore'
    });
    child.unref();
  } else {
    console.log('[INFO] Apertura nel browser predefinito di Windows...');
    const startCmd = process.platform === 'win32' ? 'cmd /c start ""' : 'open';
    spawn(startCmd, [`"${appUrl}"`], { shell: true, detached: true, stdio: 'ignore' }).unref();
  }
}

// 5. Ciclo di vita principale
async function main() {
  try {
    ensureBuild();
    const server = await startServer();
    openAppWindow();

    console.log('\n====================================================================');
    console.log(`     🐼 BREW PANDA v${APP_VERSION} E' IN ESECUZIONE OFFLINE!       `);
    console.log('====================================================================');
    console.log('  * La finestra di Brew Panda e\' aperta.');
    console.log('  * I dati del gestionale sono memorizzati localmente in:');
    console.log('    data/profile/ (con backup automatici in data/backups/)');
    console.log('  * Per spegnere Brew Panda, chiudi la finestra nera oppure');
    console.log('    esegui 3_ARRESTA_BREW_PANDA.bat.');
    console.log('====================================================================\n');

    process.stdin.resume();

    const cleanup = () => {
      console.log('\n[INFO] Chiusura server Brew Panda in corso...');
      if (server && server.close) server.close();
      console.log('[OK] Chiuso correttamente. Puoi scollegare la chiavetta USB.');
      process.exit(0);
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);

  } catch (err) {
    console.error('\n[ERRORE]', err);
    console.log('\nPremi un tasto per uscire...');
    process.stdin.resume();
    process.stdin.on('data', () => process.exit(1));
  }
}

main();
