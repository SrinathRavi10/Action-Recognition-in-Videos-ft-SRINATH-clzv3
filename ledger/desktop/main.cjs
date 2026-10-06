// Electron main process: a native window around the offline web app. No network access is needed or allowed.
const { app, BrowserWindow, Menu, protocol, net, shell, dialog, ipcMain, session, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const APP_DIR = path.join(__dirname, '..');
const ROOT_FILES = new Set(['index.html', 'styles.css', 'manifest.webmanifest']);
const isDev = !app.isPackaged && process.argv.includes('--dev');

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }]);

if (!app.requestSingleInstanceLock()) { app.quit(); }
app.setAppUserModelId('com.paisaledger.app');

let win;
const stateFile = () => path.join(app.getPath('userData'), 'window-state.json');
const loadState = () => { try { return JSON.parse(fs.readFileSync(stateFile(), 'utf8')); } catch { return {}; } };
const saveState = () => { try { if (win && !win.isMinimized() && !win.isMaximized()) fs.writeFileSync(stateFile(), JSON.stringify({ ...win.getBounds(), maximized: false })); else if (win?.isMaximized()) fs.writeFileSync(stateFile(), JSON.stringify({ ...loadState(), maximized: true })); } catch {} };

/** Serve the bundled web app from app://paisa/… — a secure origin, so WebCrypto, IndexedDB and OCR workers behave. */
function registerAppProtocol() {
  protocol.handle('app', (req) => {
    const url = new URL(req.url);
    let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    const top = rel.split('/')[0];
    if (!(ROOT_FILES.has(rel) || ['js', 'vendor', 'icons'].includes(top))) rel = 'index.html';
    const file = path.normalize(path.join(APP_DIR, rel));
    if (!file.startsWith(APP_DIR)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
}

function createWindow() {
  const st = loadState();
  win = new BrowserWindow({
    width: st.width || 1360, height: st.height || 860, x: st.x, y: st.y, minWidth: 420, minHeight: 600,
    show: false, autoHideMenuBar: true, backgroundColor: nativeTheme.shouldUseDarkColors ? '#0e0e0d' : '#f4f3ef', title: 'Paisa Ledger',
    icon: path.join(APP_DIR, 'build', 'icon.png'),
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    titleBarOverlay: process.platform === 'darwin' ? false : { color: '#00000000', symbolColor: nativeTheme.shouldUseDarkColors ? '#c3c2b7' : '#52514e', height: 56 },
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false, devTools: isDev },
  });
  if (st.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  win.on('close', saveState);
  win.loadURL('app://paisa/index.html');

  // Never navigate away from the app; open normal web links in the user's browser.
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('app://paisa/')) e.preventDefault(); });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
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
    { label: 'Help', submenu: [{ label: 'Your data stays on this device', enabled: false }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  registerAppProtocol();
  // Only notifications (renewal reminders) may be requested; everything else is denied. No network origins are allowed.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'notifications'));
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (_d, cb) => cb({ cancel: true }));
  buildMenu();
  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// ───── IPC (renderer → main) ─────
ipcMain.handle('app:info', () => ({ version: app.getVersion(), platform: process.platform, userData: app.getPath('userData') }));
ipcMain.handle('theme:set', (_e, dark) => { try { win?.setTitleBarOverlay?.({ color: '#00000000', symbolColor: dark ? '#c3c2b7' : '#52514e', height: 56 }); } catch {} });
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
