// Job Autopilot – Electron main process. Hosts the engine, the hidden application browser and the UI window.
// Defensive by design: every startup failure is logged to a file and shown in a dialog instead of failing silently.
const { app, BrowserWindow, Tray, Menu, protocol, dialog, ipcMain, shell, session, nativeImage, Notification, nativeTheme, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const UI = path.join(ROOT, 'ui');
const isDev = !app.isPackaged && process.argv.includes('--dev');
const background = process.argv.includes('--background');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json' };

let logPath = null;
function log(...a) {
  const line = `[${new Date().toISOString()}] ${a.map((x) => (x instanceof Error ? x.stack : typeof x === 'string' ? x : JSON.stringify(x))).join(' ')}\n`;
  try { if (!logPath) logPath = path.join(app.getPath('userData'), 'startup.log'); fs.appendFileSync(logPath, line); } catch {}
  if (isDev) console.log(line.trim());
}
function fatal(title, err) {
  log('FATAL', title, err);
  try { dialog.showErrorBox(`Job Autopilot – ${title}`, `${err?.message || err}\n\nA log was saved to:\n${logPath || '(unavailable)'}`); } catch {}
}
process.on('uncaughtException', (e) => fatal('unexpected error', e));
process.on('unhandledRejection', (e) => { log('unhandledRejection', e); });

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

if (!app.requestSingleInstanceLock()) { app.exit(0); }
else {
  app.setAppUserModelId('com.jobautopilot.app');
  let win = null, tray = null, quitting = false, core = null, store = null, engine = null, dataDir = null, notifiedHint = false;

  const send = (ch, payload) => { try { if (win && !win.isDestroyed()) win.webContents.send(`ev:${ch}`, payload); } catch {} };

  async function loadCore() {
    const url = (f) => pathToFileURL(path.join(ROOT, 'core', f)).href;
    const [st, en, rs, pt, ll, pf, em, ma, qu, pl] = await Promise.all(['store.js', 'engine.js', 'resume.js', 'pdftext.js', 'llm.js', 'profile.js', 'email.js', 'match.js', 'quality.js', 'pipeline.js'].map((f) => import(url(f))));
    return { Store: st.Store, Engine: en.Engine, parseResume: rs.parseResume, pdfToText: pt.pdfToText, makeClient: ll.makeClient, answerQuestions: ll.answerQuestions, missingForLive: pf.missingForLive, makeTransport: em.makeTransport, evaluate: ma.evaluate, salaryInfo: qu.salaryInfo, compareSalary: qu.compareSalary, analytics: pl.analytics, appsCsv: pl.appsCsv, interviewIcs: pl.interviewIcs };
  }

  function registerAppProtocol() {
    protocol.handle('app', async (req) => {
      try {
        const rel = decodeURIComponent(new URL(req.url).pathname).replace(/^\/+/, '') || 'index.html';
        const file = path.resolve(UI, rel);
        if (!file.startsWith(UI + path.sep)) return new Response('Forbidden', { status: 403 });
        return new Response(await fs.promises.readFile(file), { headers: { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-cache' } });
      } catch (e) { return new Response('Not found', { status: 404 }); }
    });
  }

  // ───────── notifications ─────────
  function notify(title, body) {
    try { if (Notification.isSupported() && !(win && win.isFocused())) { const n = new Notification({ title, body, silent: false }); n.on('click', showWindow); n.show(); } } catch {}
  }
  function showWindow() { if (!win || win.isDestroyed()) createWindow(); else { win.show(); win.focus(); } }

  // ───────── window / tray ─────────
  const bg = () => (nativeTheme.shouldUseDarkColors ? '#0e0e0d' : '#f4f3ef');
  function createWindow() {
    win = new BrowserWindow({
      width: 1320, height: 860, minWidth: 900, minHeight: 600, show: !background, backgroundColor: bg(), title: 'Job Autopilot', autoHideMenuBar: true,
      titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
      ...(process.platform === 'darwin' ? {} : { titleBarOverlay: { color: bg(), symbolColor: nativeTheme.shouldUseDarkColors ? '#c3c2b7' : '#52514e', height: 52 } }),
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false, devTools: isDev },
    });
    win.on('close', (e) => {
      if (!quitting && store?.get('settings').runInBackground) {
        e.preventDefault(); win.hide();
        if (!notifiedHint) { notifiedHint = true; notify('Job Autopilot is still running', 'It keeps looking for jobs in the background. Right-click the tray icon to quit.'); }
      }
    });
    win.on('closed', () => { win = null; });
    win.webContents.on('did-fail-load', (_e, code, desc, url) => { log('did-fail-load', code, desc, url); if (code !== -3) fatal('could not load the app', new Error(`${desc} (${code})`)); });
    win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
    win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('app://app/')) e.preventDefault(); });
    win.loadURL('app://app/index.html').catch((e) => log('loadURL rejected', e));
    setTimeout(() => { if (win && !win.isDestroyed() && !background && !win.isVisible()) win.show(); }, 4000);
    if (isDev) win.webContents.openDevTools({ mode: 'detach' });
  }
  function buildTray() {
    try {
      const img = nativeImage.createFromPath(path.join(ROOT, 'build', 'icon.png')).resize({ width: 18, height: 18 });
      tray = new Tray(img);
      tray.setToolTip('Job Autopilot');
      tray.on('click', showWindow);
      refreshTray();
    } catch (e) { log('tray failed (continuing)', e); }
  }
  function refreshTray() {
    if (!tray) return;
    const on = engine?.running;
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Open Job Autopilot', click: showWindow },
      { label: 'Approvals…', click: () => { showWindow(); send('goto', 'approvals'); } },
      { label: on ? 'Pause autopilot' : 'Start autopilot', click: () => { on ? engine.stop() : engine.start(); refreshTray(); send('status', engine.status); } },
      { type: 'separator' }, { label: 'Quit', click: () => { quitting = true; app.quit(); } },
    ]));
  }

  // ───────── helpers ─────────
  const publicJob = (j, withDesc = false) => ({ id: j.id, source: j.source, ats: j.ats, company: j.company, title: j.title, location: j.location, remote: j.remote, url: j.url, applyUrl: j.applyUrl, postedAt: j.postedAt, firstSeen: j.firstSeen, status: j.status, salary: core.salaryInfo(j.description || ''), manual: !!(j.manual || ['smartrecruiters', 'workday'].includes(j.ats)), score: j.eval?.score ?? 0, decision: j.eval?.decision, reasons: j.eval?.reasons || [], skipReason: j.eval?.skipReason, matchedSkills: j.eval?.matchedSkills || [], ...(withDesc ? { description: j.description } : {}) });
  const publicProfile = () => { const p = { ...store.get('profile') }; delete p.resumeText; p.hasResume = !!p.resumePath && fs.existsSync(p.resumePath); p.resumeName = p.resumePath ? path.basename(p.resumePath) : ''; return p; };
  const publicSettings = () => { const s = JSON.parse(JSON.stringify(store.get('settings'))); s.claude.hasKey = !!s.claude.apiKey; s.claude.apiKey = ''; s.email.hasPass = !!s.email.pass; s.email.pass = ''; s.adzuna.hasKey = !!s.adzuna.appKey; s.adzuna.appKey = ''; s.inbox.hasPass = !!s.inbox.pass; s.inbox.pass = ''; return s; };
  const mergeSettings = (cur, over) => { for (const [k, v] of Object.entries(over)) { if (v && typeof v === 'object' && !Array.isArray(v) && cur[k] && typeof cur[k] === 'object') mergeSettings(cur[k], v); else cur[k] = v; } return cur; };
  const counts = () => {
    const apps = store.get('apps'), jobs = Object.values(store.get('jobs')), day = new Date().toISOString().slice(0, 10);
    const done = (a) => ['applied', 'unconfirmed', 'emailed'].includes(a.status);
    const perDay = {};
    for (const a of apps) if (done(a) || a.status === 'dry_run') { const d = a.at.slice(0, 10); perDay[d] = (perDay[d] || 0) + 1; }
    return { appliedToday: apps.filter((a) => done(a) && a.at.slice(0, 10) === day).length, appliedTotal: apps.filter(done).length, dryRuns: apps.filter((a) => a.status === 'dry_run').length, needsYou: apps.filter((a) => a.status === 'needs_you' && jobs.find((j) => j.id === a.jobId)?.status === 'needs_you').length,
      matches: jobs.filter((j) => j.eval?.decision === 'apply' && ['new', 'queued', 'dry_run'].includes(j.status)).length, awaiting: jobs.filter((j) => j.status === 'awaiting').length, followUps: engine.followUps().length,
      upcoming: apps.filter((a) => a.interviewAt && a.stage === 'interview' && new Date(a.interviewAt) > new Date(Date.now() - 36e5)).length, jobsTotal: jobs.length, companies: store.get('companies').filter((c) => c.enabled).length, perDay };
  };
  const applyLoginItem = () => { try { if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: !!store.get('settings').startWithWindows, args: ['--background'] }); } catch (e) { log('login item failed', e); } };

  async function importResume(src) {
    const ext = path.extname(src).toLowerCase();
    if (!['.pdf', '.txt'].includes(ext)) return { ok: false, error: 'Please choose a PDF (or .txt) resume.' };
    const dest = path.join(dataDir, `resume${ext}`);
    fs.copyFileSync(src, dest);
    const text = ext === '.pdf' ? await core.pdfToText(dest) : fs.readFileSync(dest, 'utf8');
    if (text.trim().length < 80) return { ok: false, error: 'No readable text found in that file. Scanned PDFs are not supported – export a text PDF from Word/Google Docs.' };
    const parsed = core.parseResume(text);
    const cur = store.get('profile');
    store.set('profile', { ...cur, ...Object.fromEntries(Object.entries(parsed).filter(([, v]) => v !== '' && v != null && !(Array.isArray(v) && !v.length))), resumePath: dest, resumeText: text, answers: cur.answers });
    engine.reevaluate();
    send('profile', publicProfile());
    return { ok: true, profile: publicProfile() };
  }

  // ───────── API ─────────
  const handlers = {
    state: () => ({ profile: publicProfile(), settings: publicSettings(), status: engine.status, running: engine.running, counts: counts(), missing: core.missingForLive(store.get('profile')), version: app.getVersion(), encrypted: !!store.codec }),
    'profile:save': (p) => { const cur = store.get('profile'); const next = { ...cur, ...p, answers: { ...cur.answers, ...(p.answers || {}) } }; delete next.hasResume; delete next.resumeName; store.set('profile', next); engine.reevaluate(); return publicProfile(); },
    'resume:choose': async () => { const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Resume', extensions: ['pdf', 'txt'] }] }); return r.canceled ? { ok: false, canceled: true } : importResume(r.filePaths[0]); },
    'resume:path': (p) => importResume(p),
    'settings:save': (over) => {
      const s = store.get('settings');
      for (const k of ['apiKey']) if (over.claude && over.claude[k] === '') delete over.claude[k];
      if (over.email && over.email.pass === '') delete over.email.pass;
      if (over.adzuna && over.adzuna.appKey === '') delete over.adzuna.appKey;
      if (over.inbox && over.inbox.pass === '') delete over.inbox.pass;
      const changedTargeting = ['minScore', 'maxYearsRequired', 'includeInternships', 'locations', 'roles', 'excludeTitleWords', 'acceptAnywhereInIndia', 'acceptRemote', 'maxAgeDays'].some((k) => k in over);
      mergeSettings(s, over); store.save('settings'); applyLoginItem();
      if (changedTargeting) engine.reevaluate();
      return publicSettings();
    },
    'jobs:list': () => Object.values(store.get('jobs')).filter((j) => j.status !== 'closed' || j.eval?.decision === 'apply').map((j) => publicJob(j)),
    'job:detail': (id) => { const j = store.get('jobs')[id]; return j ? publicJob(j, true) : null; },
    'job:skip': (id) => { engine.reject(id); return true; },
    'answer:save': ({ match, answer }) => { const p = store.get('profile'); const key = String(match).toLowerCase().trim(); const ex = (p.answers.extra ||= []); const hit = ex.find((x) => String(x.match).toLowerCase() === key); if (hit) hit.answer = answer; else ex.push({ match: key, answer }); store.save('profile'); return { ok: true }; },
    'job:feedback': ({ id, verdict }) => { engine.feedback(id, verdict); return true; },
    'job:approve': (id) => engine.approve(id),
    'job:manualApplied': (id) => ({ ok: !!engine.recordManual(id) }),
    'cover:preview': (id) => engine.previewCoverLetter(id),
    'job:unskip': (id) => { engine.setJobStatus(id, 'new'); return true; },
    'job:apply': async ({ id, mode }) => { const j = store.get('jobs')[id]; if (!j) return { ok: false }; if (mode === 'live') { const miss = core.missingForLive(store.get('profile')); if (miss.length) return { ok: false, error: `Fill in first: ${miss.join(', ')}` }; } const rec = await engine.applyTo(j, { force: true, mode }); return { ok: true, app: rec }; },
    'apps:list': () => { const due = new Set(engine.followUps().map((a) => a.id)); return store.get('apps').slice().reverse().map((a) => ({ ...a, followUpDue: due.has(a.id) })); },
    'app:assist': (id) => { engine.assist(id); return { ok: true }; },
    'app:done': (id) => { engine.markApplied(id); return true; },
    'app:dismiss': (id) => { const a = store.get('apps').find((x) => x.id === id); if (a) { a.status = 'dismissed'; a.reason = 'Dismissed by you'; engine.setJobStatus(a.jobId, 'skipped'); store.save('apps'); send('app', a); } return true; },
    'app:retry': async (id) => { const a = store.get('apps').find((x) => x.id === id); const j = a && store.get('jobs')[a.jobId]; if (!j) return { ok: false }; a.status = 'superseded'; store.save('apps'); return { ok: true, app: await engine.applyTo(j, { force: true }) }; },
    'app:stage': ({ id, stage, interviewAt, note }) => ({ ok: !!engine.setStage(id, stage, { interviewAt, note }) }),
    'app:note': ({ id, note }) => { const a = store.get('apps').find((x) => x.id === id); if (a) { a.notes = note; store.save('apps'); } return true; },
    'app:followup:draft': (id) => engine.followUpDraft(id),
    'app:followup:done': (id) => { engine.markFollowedUp(id); return true; },
    'app:snooze': (id) => { engine.snooze(id, 5); return true; },
    'app:prep': async (id) => (await engine.prep(id)) || { text: 'Not available', source: 'none' },
    'app:ics': async (id) => {
      const a = store.get('apps').find((x) => x.id === id); const ics = a && core.interviewIcs(a);
      if (!ics) return { ok: false, error: 'Set an interview date first.' };
      const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('downloads'), `interview-${a.company.replace(/\W+/g, '-')}.ics`), filters: [{ name: 'Calendar event', extensions: ['ics'] }] });
      if (r.canceled) return { ok: false, canceled: true };
      fs.writeFileSync(r.filePath, ics); return { ok: true, path: r.filePath };
    },
    'apps:csv': async () => {
      const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('downloads'), 'job-applications.csv'), filters: [{ name: 'CSV (Excel)', extensions: ['csv'] }] });
      if (r.canceled) return { ok: false, canceled: true };
      fs.writeFileSync(r.filePath, core.appsCsv(store.get('apps'))); return { ok: true, path: r.filePath };
    },
    'diag:export': async () => {
      const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('downloads'), 'job-autopilot-report.txt'), filters: [{ name: 'Text', extensions: ['txt'] }] });
      if (r.canceled) return { ok: false, canceled: true };
      const st = store.get('settings'); const safe = { mode: st.mode, approval: st.approval, minScore: st.minScore, maxPerDay: st.maxPerDay, sources: st.sources, locations: st.locations };
      let startup = ''; try { startup = fs.readFileSync(path.join(app.getPath('userData'), 'startup.log'), 'utf8').slice(-4000); } catch {}
      fs.writeFileSync(r.filePath, [`Job Autopilot ${app.getVersion()} · ${process.platform} ${process.arch} · electron ${process.versions.electron}`, '', 'Settings (no secrets):', JSON.stringify(safe, null, 2), '', 'Source health:', JSON.stringify(store.get('meta').health || {}, null, 2), '', 'Last log lines:', ...store.get('log').slice(-80).map((l) => `${l.t} ${l.level} ${l.msg}`), '', 'startup.log (tail):', startup].join('\n'));
      return { ok: true, path: r.filePath };
    },
    'insights': () => core.analytics(store.get('apps'), store.get('jobs')),
    'inbox:test': async () => { try { const m = await engine.checkInbox(); return { ok: true, ...m }; } catch (e) { return { ok: false, error: e.message }; } },
    'inbox:check': async () => { try { return { ok: true, ...(await engine.checkInbox()) }; } catch (e) { return { ok: false, error: e.message }; } },
    'shot:read': (p) => { try { if (!p || !p.startsWith(path.join(dataDir, 'shots'))) return null; return `data:image/png;base64,${fs.readFileSync(p).toString('base64')}`; } catch { return null; } },
    'engine:start': () => { engine.start(); refreshTray(); return engine.status; },
    'engine:stop': () => { engine.stop(); refreshTray(); return engine.status; },
    'engine:tick': () => { engine.tick({ apply: engine.running }).catch((e) => engine.log('error', e.message)); return true; },
    'engine:setMode': (mode) => { store.get('settings').mode = mode; store.save('settings'); engine.log('info', mode === 'live' ? 'LIVE mode: applications will really be submitted' : 'Dry-run mode: forms are filled but not submitted'); return mode; },
    'companies:list': () => store.get('companies').map((c) => ({ ...c, health: (store.get('meta').health || {})[`${c.ats}:${c.token}`] || null })),
    'companies:add': (url) => engine.addCompanyFromUrl(url),
    'companies:toggle': ({ ats, token, enabled }) => { const c = store.get('companies').find((x) => x.ats === ats && x.token === token); if (c) { c.enabled = enabled; store.save('companies'); } return true; },
    'companies:remove': ({ ats, token }) => { store.set('companies', store.get('companies').filter((x) => !(x.ats === ats && x.token === token))); return true; },
    'companies:discover': () => { engine.discoverCompanies().then(() => send('jobs')).catch((e) => engine.log('error', e.message)); return true; },
    'health': () => store.get('meta').health || {},
    'log:list': () => store.get('log').slice(-300),
    'test:claude': async () => {
      const s = store.get('settings');
      const c = core.makeClient({ ...s, claude: { ...s.claude, enabled: true } });
      if (!c) return { ok: false, error: 'Add an API key first.' };
      try { const r = await c.messages.create({ model: s.claude.model, max_tokens: 100, messages: [{ role: 'user', content: 'Reply with the single word: ready' }], output_config: { effort: 'low' } }); return { ok: true, reply: (r.content.find((b) => b.type === 'text') || {}).text || '' }; }
      catch (e) { return { ok: false, error: e.message }; }
    },
    'test:email': async () => { try { const t = core.makeTransport(store.get('settings')); await t.verify(); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; } },
    'open:url': (u) => { if (/^https:\/\//.test(u)) shell.openExternal(u); return true; },
    'open:data': () => { shell.openPath(dataDir); return true; },
    'data:reset': () => { engine.stop(); for (const k of ['jobs', 'apps', 'log', 'meta']) store.set(k, k === 'jobs' || k === 'meta' ? {} : []); return true; },
  };
  ipcMain.handle('api', async (_e, name, payload) => {
    try { const h = handlers[name]; if (!h) throw new Error(`unknown api ${name}`); return await h(payload); }
    catch (e) { log('api error', name, e); return { ok: false, error: e.message || String(e) }; }
  });

  app.whenReady().then(async () => {
    log('starting', app.getVersion(), process.platform, process.arch, 'electron', process.versions.electron, 'packaged', app.isPackaged, background ? '(background)' : '');
    try {
      registerAppProtocol();
      session.defaultSession.setPermissionRequestHandler((_w, _p, cb) => cb(false));
      Menu.setApplicationMenu(null);
      core = await loadCore();
      dataDir = path.join(app.getPath('userData'), 'data');
      store = new core.Store(dataDir, { codec: safeStorage.isEncryptionAvailable() ? { encrypt: (v) => safeStorage.encryptString(v).toString('base64'), decrypt: (v) => safeStorage.decryptString(Buffer.from(v, 'base64')) } : null });
      if (process.env.JA_TEST_BASE) {   // test hook: point the app at local mock job boards (never set in normal use)
        try { store.get('settings').sourceBase = JSON.parse(process.env.JA_TEST_BASE); Object.assign(store.get('settings').sources, { remoteok: false, remotive: false, adzuna: false, workable: false }); if (!store.get('companies').length) store.set('companies', ['greenhouse', 'lever', 'ashby'].map((ats) => ({ ats, token: 'mockco', enabled: true }))); } catch (e) { log('JA_TEST_BASE ignored', e); }
      }
      const { makeDriver } = require('./electronDriver.cjs');
      engine = new core.Engine({
        store, driverFactory: (o) => makeDriver(o), makeClient: core.makeClient,
        saveShot: async (buf, tag) => { if (!buf) return ''; const dir = path.join(dataDir, 'shots'); fs.mkdirSync(dir, { recursive: true }); const f = path.join(dir, `${Date.now()}-${tag}.png`); fs.writeFileSync(f, buf); try { const all = fs.readdirSync(dir).sort(); for (const old of all.slice(0, Math.max(0, all.length - 400))) fs.unlinkSync(path.join(dir, old)); } catch {} return f; },
      });
      engine.on('status', (s) => { send('status', s); refreshTray(); });
      engine.on('log', (l) => send('log', l));
      engine.on('jobs', () => send('jobs'));
      engine.on('tick', (t) => send('tick', t));
      engine.on('approval', () => { const n = Object.values(store.get('jobs')).filter((j) => j.status === 'awaiting').length; notify('Waiting for your approval', `${n} application${n === 1 ? '' : 's'} ready to send – open Approvals.`); send('jobs'); });
      engine.on('manual', (j) => notify('Good match – apply yourself', `${j.title} – ${j.company} (this site can't be filled automatically)`));
      engine.on('reply', ({ app: a, stage }) => notify(stage === 'interview' ? 'Interview invitation 🎉' : stage === 'offer' ? 'Offer! 🎉' : 'Application update', `${a.title} – ${a.company}`));
      engine.on('app', (a) => {
        send('app', a);
        if (a.status === 'applied' || a.status === 'emailed') notify('Applied ✓', `${a.title} – ${a.company}`);
        else if (a.status === 'needs_you') notify('Needs your attention', `${a.title} – ${a.company}: ${a.reason}`);
      });
      applyLoginItem();
      buildTray();
      createWindow();
      if (store.get('settings').autopilot) engine.start();
    } catch (e) { fatal('startup failed', e); }
    app.on('activate', showWindow);
  }).catch((e) => fatal('startup failed', e));

  app.on('second-instance', () => showWindow());
  app.on('before-quit', () => { quitting = true; try { store?.flush(); } catch {} });
  app.on('window-all-closed', () => { if (!store?.get('settings').runInBackground) app.quit(); });
}
