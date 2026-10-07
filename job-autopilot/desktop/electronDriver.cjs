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
      // Get a handle to the marked <input type=file> through the page (this also finds inputs inside shadow DOM, which
      // DOM.querySelector cannot see), then attach the files to that handle.
      const tag = (/data-ja-upload="([^"]+)"/.exec(selector) || [])[1];
      const { result } = await wc.debugger.sendCommand('Runtime.evaluate', { expression: tag ? `window.__JA && __JA.markedElement(${JSON.stringify(tag)})` : `document.querySelector(${JSON.stringify(selector)})`, returnByValue: false });
      if (!result || !result.objectId) throw new Error('file input not found');
      await wc.debugger.sendCommand('DOM.setFileInputFiles', { objectId: result.objectId, files });
      await wc.debugger.sendCommand('Runtime.callFunctionOn', { objectId: result.objectId, functionDeclaration: "function(){ this.dispatchEvent(new Event('input',{bubbles:true,composed:true})); this.dispatchEvent(new Event('change',{bubbles:true,composed:true})); }" });
    },
    screenshot: async () => (await wc.capturePage()).toPNG(),
    url: async () => wc.getURL(),
    close: async () => { try { if (wc.debugger.isAttached()) wc.debugger.detach(); } catch {} if (!win.isDestroyed()) win.destroy(); },
  };
  return driver;
}
module.exports = { makeDriver };
