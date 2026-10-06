// Drives a real (hidden) Chromium window for filling application forms. Each application gets a fresh, isolated,
// in-memory session so nothing leaks between sites. Implements the driver interface used by core/apply.js.
const { BrowserWindow, session } = require('electron');

async function makeDriver({ visible = false } = {}) {
  const partition = `apply-${Date.now()}-${Math.random().toString(36).slice(2)}`;   // no "persist:" prefix = in-memory
  const ses = session.fromPartition(partition);
  ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  ses.on('will-download', (e) => e.preventDefault());
  const win = new BrowserWindow({
    show: visible, width: 1280, height: 1000, title: 'Job Autopilot – application', autoHideMenuBar: true,
    webPreferences: { partition, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, spellcheck: false },
  });
  const wc = win.webContents;
  // Present as ordinary Chromium (many sites reject unknown embedded browsers); nothing else is spoofed.
  wc.setUserAgent(wc.getUserAgent().replace(/\sElectron\/[\d.]+/, '').replace(/\s(job-autopilot|Job Autopilot)\/[\d.]+/i, ''));
  wc.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) wc.loadURL(url); return { action: 'deny' }; });

  const driver = {
    window: win,
    goto: (url) => new Promise((resolve, reject) => {
      let done = false;
      const finish = (err) => { if (done) return; done = true; clearTimeout(t); wc.removeListener('did-fail-load', onFail); err ? reject(err) : resolve(); };
      const onFail = (_e, code, desc, _u, isMain) => { if (isMain && code !== -3) finish(new Error(`${desc} (${code})`)); };
      const t = setTimeout(() => finish(), 45000);
      wc.once('did-finish-load', () => finish());
      wc.on('did-fail-load', onFail);
      wc.loadURL(url).catch((e) => { if (!/ERR_ABORTED|\(-3\)/.test(String(e))) finish(e); });
    }),
    eval: (code) => wc.executeJavaScript(code, true),
    async setFiles(selector, files) {
      if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
      const { root } = await wc.debugger.sendCommand('DOM.getDocument', { depth: 0 });
      const { nodeId } = await wc.debugger.sendCommand('DOM.querySelector', { nodeId: root.nodeId, selector });
      if (!nodeId) throw new Error('file input not found');
      await wc.debugger.sendCommand('DOM.setFileInputFiles', { nodeId, files });
      await wc.executeJavaScript(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(el){el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));}})()`);
    },
    screenshot: async () => (await wc.capturePage()).toPNG(),
    url: async () => wc.getURL(),
    close: async () => { try { if (wc.debugger.isAttached()) wc.debugger.detach(); } catch {} if (!win.isDestroyed()) win.destroy(); },
  };
  return driver;
}
module.exports = { makeDriver };
