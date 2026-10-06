// Electron main process: a native window around the offline web app. No network access is needed or allowed.
// Written defensively: any startup failure is logged to a file and shown in a dialog instead of failing silently.
const { app, BrowserWindow, Menu, protocol, shell, dialog, ipcMain, session, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');

const APP_DIR = path.resolve(__dirname, '..');
const ROOT_FILES = new Set(['index.html', 'styles.css', 'manifest.webmanifest', 'sw.js']);
const isDev = !app.isPackaged && process.argv.includes('--dev');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.gz': 'application/octet-stream', '.txt': 'text/plain' };

// ───── logging (userData/startup.log) ─────
let logPath = null;
function log(...a) {
  const line = `[${new Date().toISOString()}] ${a.map((x) => (x instanceof Error ? x.stack : typeof x === 'string' ? x : JSON.stringify(x))).join(' ')}\n`;
  try { if (!logPath) logPath = path.join(app.getPath('userData'), 'startup.log'); fs.appendFileSync(logPath, line); } catch {}
  if (isDev) console.log(line.trim());
}
function fatal(title, err) {
  log('FATAL', title, err);
  try { dialog.showErrorBox(`Paisa Ledger – ${title}`, `${err?.message || err}\n\nA log was saved to:\n${logPath || '(unavailable)'}`); } catch {}
}
process.on('uncaughtException', (e) => fatal('unexpected error', e));
process.on('unhandledRejection', (e) => fatal('unexpected error', e));

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }]);

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.exit(0); }
else {
  app.setAppUserModelId('com.paisaledger.app');
  let win = null;
  const stateFile = () => path.join(app.getPath('userData'), 'window-state.json');
  const loadState = () => { try { return JSON.parse(fs.readFileSync(stateFile(), 'utf8')); } catch { return {}; } };
  const saveState = () => { try { if (win && !win.isDestroyed() && !win.isMinimized() && !win.isMaximized()) fs.writeFileSync(stateFile(), JSON.stringify({ ...win.getBounds(), maximized: false })); else if (win && !win.isDestroyed() && win.isMaximized()) fs.writeFileSync(stateFile(), JSON.stringify({ ...loadState(), maximized: true })); } catch {} };
  const bg = () => (nativeTheme.shouldUseDarkColors ? '#0e0e0d' : '#f4f3ef');
  const overlay = () => ({ color: bg(), symbolColor: nativeTheme.shouldUseDarkColors ? '#c3c2b7' : '#52514e', height: 56 });

  /** Serve the bundled web app from app://paisa/… — a secure origin, so WebCrypto, IndexedDB and OCR workers work.
   *  Files are read with fs (asar-aware) rather than net.fetch, which behaves differently across platforms. */
  function registerAppProtocol() {
    protocol.handle('app', async (req) => {
      try {
        const url = new URL(req.url);
        let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
        const top = rel.split('/')[0];
        if (!(ROOT_FILES.has(rel) || ['js', 'vendor', 'icons'].includes(top))) rel = 'index.html';
        const file = path.resolve(APP_DIR, rel);
        if (!file.startsWith(APP_DIR + path.sep) && file !== APP_DIR) return new Response('Forbidden', { status: 403 });
        const data = await fs.promises.readFile(file);
        return new Response(data, { status: 200, headers: { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-cache' } });
      } catch (e) {
        log('protocol error', req.url, e);
        return new Response('Not found', { status: 404 });
      }
    });
  }

  function createWindow() {
    const st = loadState();
    win = new BrowserWindow({
      width: st.width || 1360, height: st.height || 860, x: st.x, y: st.y, minWidth: 420, minHeight: 600,
      autoHideMenuBar: true, backgroundColor: bg(), title: 'Paisa Ledger',
      titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
      ...(process.platform === 'darwin' ? {} : { titleBarOverlay: overlay() }),
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false, devTools: isDev },
    });
    if (st.maximized) win.maximize();
    win.on('close', saveState);
    win.on('closed', () => { win = null; });
    win.webContents.on('did-fail-load', (_e, code, desc, url) => { log('did-fail-load', code, desc, url); if (code !== -3) fatal('could not load the app', new Error(`${desc} (${code}) while loading ${url}`)); });
    win.webContents.on('render-process-gone', (_e, d) => { log('render-process-gone', d); if (d.reason !== 'clean-exit') win?.webContents.reload(); });
    win.webContents.on('preload-error', (_e, p, err) => log('preload-error', p, err));
    // Never navigate away from the app; open normal web links in the user's browser.
    win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('app://paisa/')) e.preventDefault(); });
    win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
    win.loadURL('app://paisa/index.html').catch((e) => log('loadURL rejected', e));
    // Show as soon as possible, but never leave the user with an invisible window.
    win.once('ready-to-show', () => win?.show());
    setTimeout(() => { if (win && !win.isDestroyed() && !win.isVisible()) { log('window was not visible after 4s; forcing show'); win.show(); } }, 4000);
    if (isDev) win.webContents.openDevTools({ mode: 'detach' });
  }

  function buildMenu() {
    const send = (hash) => win?.webContents.send('navigate', hash);
    const template = [
      ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
      { label: 'File', submenu: [
        { label: 'Import statement…', accelerator: 'CmdOrCtrl+I', click: () => send('#/import') },
        { label: 'Add expense', accelerator: 'CmdOrCtrl+N', click: () => win?.webContents.send('action', 'add-txn') },
        { type: 'separator' }, process.platform === 'darwin' ? { role: 'close' } : { role: 'quit' },
      ] },
      { role: 'editMenu' },
      { label: 'View', submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
      { label: 'Go', submenu: ['home', 'transactions', 'bills', 'plan', 'tax', 'reports', 'settings'].map((k, i) => ({ label: k[0].toUpperCase() + k.slice(1), accelerator: `CmdOrCtrl+${i + 1}`, click: () => send(`#/${k}`) })) },
      { label: 'Help', submenu: [{ label: 'Open log folder', click: () => shell.showItemInFolder(logPath || app.getPath('userData')) }, { label: 'Your data stays on this device', enabled: false }] },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  }

  app.whenReady().then(() => {
    log('starting', app.getVersion(), process.platform, process.arch, 'electron', process.versions.electron, 'packaged', app.isPackaged);
    try {
      registerAppProtocol();
      // Only notifications (renewal reminders) may be requested; everything else is denied. No network origins are allowed.
      session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'notifications'));
      session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (_d, cb) => cb({ cancel: true }));
    } catch (e) { log('session setup failed (continuing)', e); }
    try { buildMenu(); } catch (e) { log('menu failed (continuing)', e); }
    try { createWindow(); } catch (e) { fatal('could not open the window', e); }
    app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
  }).catch((e) => fatal('startup failed', e));

  // A second click on the shortcut focuses the existing window – or opens one if the first start left none.
  app.on('second-instance', () => {
    if (!win || win.isDestroyed()) { try { createWindow(); } catch (e) { fatal('could not open the window', e); } return; }
    if (win.isMinimized()) win.restore();
    win.show(); win.focus();
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('child-process-gone', (_e, d) => log('child-process-gone', d));

  // ───── IPC (renderer → main) ─────
  ipcMain.handle('app:info', () => ({ version: app.getVersion(), platform: process.platform, userData: app.getPath('userData') }));
  ipcMain.handle('theme:set', (_e, dark) => { try { win?.setTitleBarOverlay?.({ color: dark ? '#0e0e0d' : '#f4f3ef', symbolColor: dark ? '#c3c2b7' : '#52514e', height: 56 }); } catch {} });
  ipcMain.handle('print:pdf', async (_e, name) => {
    const { filePath, canceled } = await dialog.showSaveDialog(win, { defaultPath: name || 'report.pdf', filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (canceled || !filePath) return false;
    const data = await win.webContents.printToPDF({ printBackground: true, pageSize: 'A4', margins: { marginType: 'default' } });
    fs.writeFileSync(filePath, data);
    shell.showItemInFolder(filePath);
    return true;
  });
  ipcMain.handle('file:save', async (_e, name, bytes) => {
    const { filePath, canceled } = await dialog.showSaveDialog(win, { defaultPath: name });
    if (canceled || !filePath) return false;
    fs.writeFileSync(filePath, Buffer.from(bytes));
    return true;
  });
}
