/**
 * DocCheck desktop: runs the whole app on this computer, with nothing to install but Ollama.
 *
 *   1. Postgres 18 (embedded-postgres) in <userData>/postgres, on a free local port
 *   2. the API (server/apps/api/dist/main.js) on Electron's own Node, which also serves the web app
 *   3. a window on http://127.0.0.1:<port>
 *
 * Everything the app keeps lives in the user data folder (Help > Open data folder): the database,
 * uploaded PDFs, the settings key and api.log. A .env there is read by the API (ADMIN_EMAILS,
 * OLLAMA_BASE_URL, LLM_MODEL…) without overriding what this file sets.
 */
import { app, BrowserWindow, Menu, dialog, shell } from 'electron';
import { fork } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import EmbeddedPostgres from 'embedded-postgres';

const here = dirname(fileURLToPath(import.meta.url));
const serverDir = app.isPackaged ? join(process.resourcesPath, 'server') : join(here, 'server');
const dataDir = app.getPath('userData');
const logFile = join(dataDir, 'api.log');

let postgres;
let api;
let window;
let quitting = false;

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => {
  if (window) {
    if (window.isMinimized()) window.restore();
    window.focus();
  }
});

/** A free TCP port on the loopback interface. */
function freePort() {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.unref();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolvePort(port));
    });
  });
}

/** The database password, made on the first run and kept in desktop.json. */
function desktopConfig() {
  const file = join(dataDir, 'desktop.json');
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  const config = { pgPassword: randomBytes(24).toString('base64url') };
  writeFileSync(file, JSON.stringify(config, null, 2), { mode: 0o600 });
  return config;
}

async function startPostgres(password) {
  const databaseDir = join(dataDir, 'postgres');
  const port = await freePort();
  const log = createWriteStream(join(dataDir, 'postgres.log'), { flags: 'a' });
  postgres = new EmbeddedPostgres({
    databaseDir,
    port,
    user: 'doccheck',
    password,
    persistent: true,
    onLog: (m) => log.write(`${m}\n`),
    onError: (m) => log.write(`ERROR ${m instanceof Error ? m.stack : m}\n`),
  });
  if (!existsSync(join(databaseDir, 'PG_VERSION'))) await postgres.initialise();
  await postgres.start();
  const client = postgres.getPgClient('postgres', '127.0.0.1');
  await client.connect();
  const { rowCount } = await client.query("SELECT 1 FROM pg_database WHERE datname = 'doccheck'");
  await client.end();
  if (!rowCount) await postgres.createDatabase('doccheck');
  return `postgres://doccheck:${encodeURIComponent(password)}@127.0.0.1:${port}/doccheck`;
}

async function startApi(databaseUrl) {
  const port = await freePort();
  const log = createWriteStream(logFile, { flags: 'a' });
  log.write(`\n--- DocCheck ${app.getVersion()} ${new Date().toISOString()}\n`);
  api = fork(join(serverDir, 'apps/api/dist/main.js'), [], {
    cwd: dataDir,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      NODE_ENV: 'production',
      PORT: String(port),
      DATABASE_URL: databaseUrl,
      STORAGE_DIR: join(dataDir, 'uploads'),
      SETTINGS_KEY_FILE: join(dataDir, 'settings.key'),
      TRUST_PROXY: 'loopback',
      REDIS_URL: '',
      S3_ENDPOINT: '',
    },
  });
  api.stdout.pipe(log);
  api.stderr.pipe(log);
  api.on('exit', (code) => {
    api = undefined;
    if (!quitting) fail(new Error(`The DocCheck server stopped (exit code ${code}).`));
  });
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 180; i++) {
    try {
      if ((await fetch(`${url}/health`)).ok) return url;
    } catch {
      // not listening yet
    }
    if (!api) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('The DocCheck server did not start in time.');
}

function fail(error) {
  if (quitting) return;
  dialog.showErrorBox('DocCheck could not start', `${error.message}\n\nDetails are in ${logFile}`);
  shell.showItemInFolder(logFile);
  app.quit();
}

function menu() {
  const template = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        { label: 'Open data folder', click: () => shell.openPath(dataDir) },
        { label: 'Open server log', click: () => shell.openPath(logFile) },
        { type: 'separator' },
        { label: 'DocCheck on GitHub', click: () => shell.openExternal('https://github.com/smalbach/doccheck') },
        { label: 'Install Ollama (local models)', click: () => shell.openExternal('https://ollama.com/download') },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(async () => {
  mkdirSync(dataDir, { recursive: true });
  menu();
  window = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 380,
    title: 'DocCheck',
    backgroundColor: '#0f1419',
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  await window.loadFile(join(here, 'splash.html'));
  window.on('closed', () => {
    window = undefined;
  });
  try {
    const url = await startApi(await startPostgres(desktopConfig().pgPassword));
    // Links to other sites open in the browser, not in the app window.
    window?.webContents.setWindowOpenHandler(({ url: target }) => {
      if (!target.startsWith(url)) void shell.openExternal(target);
      return { action: target.startsWith(url) ? 'allow' : 'deny' };
    });
    window?.webContents.on('will-navigate', (event, target) => {
      if (!target.startsWith(url)) {
        event.preventDefault();
        void shell.openExternal(target);
      }
    });
    await window?.loadURL(url);
  } catch (error) {
    fail(error);
  }
});

app.on('window-all-closed', () => app.quit());

app.on('before-quit', (event) => {
  if (quitting) return;
  quitting = true;
  event.preventDefault();
  void (async () => {
    if (api) {
      const exited = new Promise((r) => api.once('exit', r));
      api.kill();
      await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);
    }
    await postgres?.stop().catch(() => {});
    app.exit(0);
  })();
});
