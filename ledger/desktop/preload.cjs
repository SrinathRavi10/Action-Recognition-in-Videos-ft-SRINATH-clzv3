// Safe bridge between the web app and the desktop shell (contextIsolation is on; no Node access in the page).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('paisa', {
  desktop: true,
  platform: process.platform,
  info: () => ipcRenderer.invoke('app:info'),
  setTitleBarTheme: (dark) => ipcRenderer.invoke('theme:set', !!dark),
  savePDF: (name) => ipcRenderer.invoke('print:pdf', name),
  onNavigate: (cb) => ipcRenderer.on('navigate', (_e, hash) => cb(hash)),
  onAction: (cb) => ipcRenderer.on('action', (_e, name) => cb(name)),
});
