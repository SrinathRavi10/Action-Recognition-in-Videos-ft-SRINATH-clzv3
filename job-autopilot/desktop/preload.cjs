const { contextBridge, ipcRenderer, webUtils } = require('electron');
const listeners = new Map();
['status', 'log', 'app', 'jobs', 'tick', 'profile'].forEach((ch) => ipcRenderer.on(`ev:${ch}`, (_e, payload) => (listeners.get(ch) || []).forEach((f) => f(payload))));
contextBridge.exposeInMainWorld('api', {
  call: (name, payload) => ipcRenderer.invoke('api', name, payload),
  on: (ch, f) => { listeners.set(ch, [...(listeners.get(ch) || []), f]); },
  platform: process.platform,
  pathForFile: (f) => { try { return webUtils.getPathForFile(f); } catch { return ''; } },
});
