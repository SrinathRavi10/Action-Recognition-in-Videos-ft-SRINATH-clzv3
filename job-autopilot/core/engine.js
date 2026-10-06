// The autopilot: poll job sources → score → apply (within limits) → record everything.
import { EventEmitter } from 'node:events';
import { ATS_SOURCES, remoteok, remotive, adzuna, resolveTarget } from './sources/index.js';
import { discover, companyFromUrl } from './companies.js';
import { evaluate } from './match.js';
import { applyToJob } from './apply.js';
import { SUPPORTED_ATS, MANUAL_ATS } from './ats.js';
import { dupKey, pickWinner } from './quality.js';
import { record as learnRecord } from './learn.js';
import { followUps as dueFollowUps, followUpEmail } from './pipeline.js';
import { fetchRecent, proposeUpdates } from './inbox.js';
import { extractApplyEmail, sendApplication } from './email.js';
import { coverLetter, interviewPrep } from './llm.js';
import { missingForLive } from './profile.js';
import { pool, sleep, jitter, uid, norm, today } from './util.js';

const DAY = 864e5;
const settingsSig = (s) => JSON.stringify([s.minScore, s.maxYearsRequired, s.includeInternships, s.locations, s.acceptAnywhereInIndia, s.acceptRemote, s.roles, s.excludeTitleWords]);

export class Engine extends EventEmitter {
  /**
   * @param {{store:import('./store.js').Store, driverFactory:(opts?:{visible?:boolean})=>Promise<object>, makeClient?:(settings:object)=>object|null,
   *          saveShot?:(buf:Buffer, tag:string, ctx:object)=>Promise<string>, sleepFn?:Function}} o
   */
  constructor({ store, driverFactory, makeClient = () => null, saveShot = async () => '', sleepFn = sleep, imapFlow = null }) {
    super();
    this.imapFlow = imapFlow;
    this.store = store; this.driverFactory = driverFactory; this.makeClient = makeClient; this.saveShot = saveShot; this.sleep = sleepFn;
    this.timer = null; this.busy = false; this.running = false; this.stopRequested = false;
    this.status = { phase: 'idle', message: '', lastRun: null, nextRun: null, applying: null };
  }

  get settings() { return this.store.get('settings'); }
  get profile() { return this.store.get('profile'); }
  get jobs() { return this.store.get('jobs'); }
  get apps() { return this.store.get('apps'); }

  // ───────── logging / status ─────────
  log(level, msg, extra) {
    const entry = { t: new Date().toISOString(), level, msg, ...(extra ? { extra } : {}) };
    const log = this.store.get('log'); log.push(entry); if (log.length > 600) log.splice(0, log.length - 600);
    this.store.save('log');
    this.emit('log', entry);
  }
  setStatus(p) { this.status = { ...this.status, ...p }; this.emit('status', this.status); }

  // ───────── scheduling ─────────
  start() {
    if (this.running) return;
    this.running = true; this.stopRequested = false;
    this.settings.autopilot = true; this.store.save('settings');
    this.log('info', 'Autopilot started');
    const loop = async () => {
      if (!this.running) return;
      await this.tick().catch((e) => this.log('error', `Tick failed: ${e.message}`));
      if (!this.running) return;
      const ms = Math.max(1, this.settings.pollMinutes) * 60000;
      this.setStatus({ nextRun: new Date(Date.now() + ms).toISOString() });
      this.timer = setTimeout(loop, ms);
    };
    loop();
  }
  stop() {
    this.running = false; this.stopRequested = true; clearTimeout(this.timer);
    this.settings.autopilot = false; this.store.save('settings');
    this.setStatus({ phase: 'idle', nextRun: null, applying: null });
    this.log('info', 'Autopilot stopped');
  }

  // ───────── one cycle ─────────
  async tick({ apply = true } = {}) {
    if (this.busy) return { skipped: 'busy' };
    this.busy = true;
    try {
      const meta = this.store.get('meta');
      if (!this.store.get('companies').length && (!meta.lastDiscover || Date.now() - meta.lastDiscover > 3600e3)) { meta.lastDiscover = Date.now(); this.store.save('meta'); await this.discoverCompanies(); }
      const stats = await this.fetchAll();
      if (this.settings.inbox?.enabled && (!meta.lastInbox || Date.now() - meta.lastInbox > 30 * 60000)) await this.checkInbox().catch((e) => this.log('warn', `Inbox check failed: ${e.message}`));
      let applied = { done: 0 };
      if (apply && this.settings.autopilot !== false) applied = await this.processQueue();
      this.setStatus({ phase: 'idle', message: '', lastRun: new Date().toISOString(), applying: null });
      this.emit('tick', { ...stats, ...applied });
      return { ...stats, ...applied };
    } finally { this.busy = false; }
  }

  // ───────── companies ─────────
  async discoverCompanies() {
    this.setStatus({ phase: 'discovering', message: 'Looking for companies with open boards…' });
    this.log('info', 'Discovering company job boards (first run only, one minute or so)…');
    const known = this.store.get('companies');
    const found = await discover(this.settings, { known, onProgress: (p) => { if (p.done % 25 === 0 || p.done === p.total) this.setStatus({ message: `Checked ${p.done}/${p.total} company boards` }); } });
    const all = [...known, ...found];
    this.store.set('companies', all);
    this.log('info', `Found ${found.length} company boards (${found.filter((c) => c.enabled).length} with India/remote openings)`);
    return found;
  }
  addCompanyFromUrl(url) {
    const c = companyFromUrl(url);
    if (!c) return { ok: false, error: 'Paste a careers link from Greenhouse, Lever, Ashby or Workable (e.g. https://jobs.lever.co/company).' };
    const list = this.store.get('companies');
    if (list.some((x) => x.ats === c.ats && x.token === c.token)) return { ok: false, error: 'Already in your list.' };
    list.push(c); this.store.save('companies');
    return { ok: true, company: c };
  }

  // ───────── scoring ─────────
  get learn() { const m = this.store.get('meta'); return (m.learn ||= { f: {}, n: 0 }); }
  /** Score one job (including what was learned from your approvals/rejections); duplicates stay skipped. */
  scoreJob(j) {
    const ev = evaluate(j, this.profile, this.settings, this.learn);
    if (j.dupOf) return { ...ev, decision: 'skip', skipReason: j.dupReason || 'Duplicate listing', reasons: [j.dupReason || 'Duplicate listing'] };
    return ev;
  }
  /** Same job on several sites → keep the one we can auto-apply to (or the oldest), skip the rest. */
  markDuplicates() {
    const groups = new Map();
    for (const j of Object.values(this.jobs)) { if (j.status === 'closed') continue; const k = dupKey(j); if (!k.split('|')[1]) continue; (groups.get(k) || groups.set(k, []).get(k)).push(j); }
    let n = 0;
    for (const g of groups.values()) {
      if (g.length < 2) continue;
      const win = g.reduce((a, b) => pickWinner(a, b, SUPPORTED_ATS));
      for (const x of g) {
        if (x === win || x.dupOf || ['applied', 'needs_you', 'dry_run', 'awaiting'].includes(x.status) || this.appsFor(x.id).length) continue;
        x.dupOf = win.id; x.dupReason = `Same job is listed on ${win.ats || win.source}`; x.status = 'skipped'; x.eval = this.scoreJob(x); n++;
      }
    }
    return n;
  }

  // ───────── fetching ─────────
  async fetchAll() {
    const s = this.settings;
    this.setStatus({ phase: 'fetching', message: 'Checking for new jobs…' });
    const health = this.store.get('meta').health || {};
    const seenNow = new Set();
    const fetched = [];
    const companies = this.store.get('companies').filter((c) => c.enabled && s.sources?.[c.ats] !== false);
    await pool(companies, 5, async (c) => {
      const key = `${c.ats}:${c.token}`;
      try {
        const jobs = await ATS_SOURCES[c.ats](c.token, s);
        health[key] = { ok: true, count: jobs.length, at: new Date().toISOString() };
        for (const j of jobs) { fetched.push(j); seenNow.add(j.id); }
        c.lastOk = true;
      } catch (e) { health[key] = { ok: false, error: e.message, at: new Date().toISOString() }; c.lastOk = false; }
    });
    for (const [name, fn] of [['remoteok', () => remoteok(s)], ['remotive', () => remotive(s)], ['adzuna', () => adzuna(s)]]) {
      if (!s.sources?.[name]) continue;
      try { const jobs = await fn(); health[name] = { ok: true, count: jobs.length, at: new Date().toISOString() }; for (const j of jobs) { fetched.push(j); seenNow.add(j.id); } }
      catch (e) { health[name] = { ok: false, error: e.message, at: new Date().toISOString() }; }
    }
    this.store.get('meta').health = health; this.store.save('meta');

    const sig = settingsSig(s);
    let fresh = 0, relevant = 0;
    const now = new Date().toISOString();
    for (const j of fetched) {
      const old = this.jobs[j.id];
      if (!old) {
        const ev = this.scoreJob(j);
        this.jobs[j.id] = { ...j, firstSeen: now, lastSeen: now, status: ev.decision === 'skip' ? 'skipped' : 'new', eval: ev, evalSig: sig };
        fresh++; if (ev.decision !== 'skip') relevant++;
      } else {
        const keep = old.eval && old.evalSig === sig;
        const ev = keep ? old.eval : this.scoreJob({ ...old, ...j });
        this.jobs[j.id] = { ...old, ...j, firstSeen: old.firstSeen, lastSeen: now, eval: ev, evalSig: sig, status: old.status === 'skipped' && ev.decision !== 'skip' && !old.userSkipped ? 'new' : old.status };
      }
    }
    const dups = this.markDuplicates();
    if (dups) relevant = Object.values(this.jobs).filter((x) => x.firstSeen === now && x.eval?.decision !== 'skip').length;
    // good matches on systems we cannot fill (SmartRecruiters, Workday…): tell the user instead of silently skipping them
    if (s.notifyManual !== false) for (const job of Object.values(this.jobs)) {
      if (job.eval?.decision === 'apply' && (MANUAL_ATS.includes(job.ats) || job.manual) && job.status === 'new' && !job.notified) { job.notified = true; this.log('info', `Good match on a site I can't fill for you: ${job.company} – ${job.title}. Open it to apply.`); this.emit('manual', job); }
    }
    // postings that disappeared from boards we fetched successfully are closed
    const okBoards = new Set(companies.filter((c) => c.lastOk).map((c) => `${c.ats}:${c.token}`));
    for (const job of Object.values(this.jobs)) if (job.ats && okBoards.has(`${job.ats}:${job.token}`) && !seenNow.has(job.id) && ['new', 'queued', 'skipped'].includes(job.status)) job.status = 'closed';
    this.store.save('jobs');
    this.log('info', `Checked ${companies.length} boards: ${fetched.length} postings, ${fresh} new, ${relevant} worth a look`);
    this.emit('jobs');
    return { fetched: fetched.length, fresh, relevant };
  }

  /** Re-score every known job (after the profile or targeting settings changed). */
  reevaluate() {
    const sig = settingsSig(this.settings);
    for (const j of Object.values(this.jobs)) {
      const ev = this.scoreJob(j);
      j.eval = ev; j.evalSig = sig;
      if (j.status === 'skipped' && ev.decision !== 'skip' && !j.userSkipped) j.status = 'new';
      else if (j.status === 'new' && ev.decision === 'skip') j.status = 'skipped';
    }
    this.store.save('jobs'); this.emit('jobs');
  }

  // ───────── applying ─────────
  appsFor(jobId) { return this.apps.filter((a) => a.jobId === jobId); }
  appliedToday() { const d = today(); return this.apps.filter((a) => ['applied', 'unconfirmed', 'emailed'].includes(a.status) && a.at.slice(0, 10) === d).length; }
  inActiveHours() { const h = new Date().getHours(); const { from, to } = this.settings.activeHours || { from: 0, to: 24 }; return h >= from && h < to; }

  /** Why this job must not be applied to right now (or null). */
  blockReason(job, { force = false } = {}) {
    const s = this.settings;
    const live = s.mode === 'live';
    const done = this.appsFor(job.id).filter((a) => !(a.status === 'dry_run' && live));
    if (done.some((a) => ['applied', 'unconfirmed', 'emailed'].includes(a.status))) return 'Already applied';
    if (!force) {
      if (done.some((a) => a.status === 'needs_you' || a.status === 'closed')) return 'Waiting on you / closed';
      if (done.filter((a) => a.status === 'failed').length >= 2) return 'Failed twice';
      if (done.some((a) => a.status === 'dry_run')) return 'Dry-run already done';
    }
    const sameRole = this.apps.find((a) => ['applied', 'unconfirmed', 'emailed'].includes(a.status) && norm(a.company) === norm(job.company) && norm(a.title) === norm(job.title));
    if (sameRole) return 'Same role at this company already applied';
    const recent = this.apps.filter((a) => ['applied', 'unconfirmed', 'emailed'].includes(a.status) && norm(a.company) === norm(job.company) && Date.now() - new Date(a.at) < 60 * DAY).length;
    if (recent >= (s.maxPerCompany ?? 2)) return `Already applied ${recent}× to this company recently`;
    return null;
  }

  async processQueue() {
    const s = this.settings;
    const live = s.mode === 'live';
    if (live) { const miss = missingForLive(this.profile); if (miss.length) { this.log('warn', `Live mode paused – missing: ${miss.join(', ')}`); return { done: 0, blocked: 'profile' }; } }
    if (!this.inActiveHours()) { this.log('info', 'Outside active hours – not applying now'); return { done: 0 }; }
    const queue = Object.values(this.jobs)
      .filter((j) => j.eval?.decision === 'apply' && !MANUAL_ATS.includes(j.ats) && !j.manual && (['new', 'queued'].includes(j.status) || (live && j.status === 'dry_run') || (j.status === 'awaiting' && !s.approval)))
      .sort((a, b) => b.eval.score - a.eval.score || String(b.postedAt).localeCompare(String(a.postedAt)));
    let done = 0, consecutiveFails = 0, queuedForApproval = 0;
    const captchas = {};
    for (const job of queue) {
      if (this.stopRequested || !this.running && this.settings.autopilot === false) break;
      if (this.appliedToday() >= (s.maxPerDay ?? 15)) { this.log('info', `Daily limit of ${s.maxPerDay} reached`); break; }
      const why = this.blockReason(job);
      if (why) { if (why !== 'Dry-run already done') this.log('info', `Skipping ${job.company} – ${job.title}: ${why}`); continue; }
      if (live && s.approval) { job.status = 'awaiting'; queuedForApproval++; this.log('info', `Waiting for your approval: ${job.company} – ${job.title} (score ${job.eval.score})`); this.emit('approval', job); continue; }
      if (job.ats && captchas[job.ats] >= 3) { if (captchas[job.ats] === 3) { captchas[job.ats]++; this.log('warn', `Several captchas in a row on ${job.ats} – skipping that site for this cycle`); } continue; }
      const rec = await this.applyTo(job);
      done++;
      if (rec.status === 'needs_you' && /captcha/i.test(rec.reason) && job.ats) captchas[job.ats] = (captchas[job.ats] || 0) + 1;
      consecutiveFails = rec.status === 'failed' ? consecutiveFails + 1 : 0;
      if (consecutiveFails >= 3) { this.log('error', 'Three failures in a row – pausing this cycle'); break; }
      const [lo, hi] = s.delaySeconds || [25, 70];
      await this.sleep(jitter(lo, hi) * 1000);
    }
    if (queuedForApproval) { this.store.save('jobs'); this.emit('jobs'); }
    return { done, queuedForApproval };
  }

  /** Apply to one job now (also used for the manual "Apply now" button). */
  async applyTo(job, { force = false, mode } = {}) {
    const s = this.settings;
    const useMode = mode || s.mode;
    this.setStatus({ phase: 'applying', message: `${job.company} – ${job.title}`, applying: job.id });
    this.log('info', `${useMode === 'live' ? 'Applying' : 'Dry run'}: ${job.company} – ${job.title} (score ${job.eval?.score})`);
    // aggregator listing → find the employer's real application page
    let j = job;
    if (!j.ats && j.applyUrl) { j = await resolveTarget(j); if (j.ats) { Object.assign(this.jobs[job.id], { ats: j.ats, token: j.token, applyUrl: j.applyUrl }); this.store.save('jobs'); } }
    const client = this.makeClient(s);
    let result;
    const attempt = async () => {
      if (SUPPORTED_ATS.includes(j.ats)) {
        let driver;
        try {
          driver = await this.driverFactory();
          return await applyToJob({ driver, job: j, profile: this.profile, settings: s, client, mode: useMode, step: (m) => this.log('debug', m), saveShot: (buf, tag) => this.saveShot(buf, tag, { job: j }) });
        } catch (e) { return { status: 'failed', reason: e.message, filled: [], missing: [] }; }
        finally { try { await driver?.close(); } catch {} }
      }
      const email = extractApplyEmail(j.description);
      if (email) return this.#emailApply(j, email, useMode, client);
      return { status: 'needs_you', reason: `This site is not supported for auto-apply – open it and apply yourself${j.resolvedUrl ? ` (${new URL(j.resolvedUrl).hostname})` : ''}`, filled: [], missing: [] };
    };
    result = await attempt();
    if (result.status === 'failed') {   // one automatic retry with a fresh browser window (transient network / page errors)
      this.log('warn', `${job.company} – ${job.title}: failed (${result.reason}) – retrying once`);
      await this.sleep(3000);
      const second = await attempt();
      result = second.status === 'failed' ? { ...second, reason: `${second.reason} (after a retry)` } : second;
    }
    const rec = { id: uid(), jobId: job.id, company: job.company, title: job.title, location: job.location, url: j.url || job.url, applyUrl: result.url || j.applyUrl, ats: j.ats || null, score: job.eval?.score, mode: useMode, at: new Date().toISOString(), ...result, filled: (result.filled || []).slice(0, 40) };
    this.apps.push(rec); this.store.save('apps');
    const st = { applied: 'applied', emailed: 'applied', dry_run: 'dry-run done', unconfirmed: 'applied', needs_you: 'queued', closed: 'closed', failed: 'queued' }[rec.status];
    this.jobs[job.id].status = rec.status === 'applied' || rec.status === 'emailed' || rec.status === 'unconfirmed' ? 'applied' : rec.status === 'closed' ? 'closed' : rec.status === 'needs_you' ? 'needs_you' : rec.status === 'dry_run' ? 'dry_run' : 'new';
    this.store.save('jobs');
    this.log(rec.status === 'failed' ? 'error' : rec.status === 'needs_you' ? 'warn' : 'info', `${job.company} – ${job.title}: ${rec.status} – ${rec.reason}`);
    this.emit('app', rec);
    return rec;
  }

  async #emailApply(job, to, mode, client) {
    const letter = await coverLetter({ client, settings: this.settings, profile: this.profile, job });
    if (mode !== 'live') return { status: 'dry_run', reason: `Would email your resume to ${to} (dry run)`, emailTo: to, filled: [{ label: 'Email to', value: to, source: 'job' }], missing: [] };
    try { await sendApplication({ settings: this.settings, profile: this.profile, job, to, coverLetter: letter }); return { status: 'emailed', reason: `Emailed your resume to ${to}`, filled: [{ label: 'Email to', value: to, source: 'job' }], missing: [], emailTo: to }; }
    catch (e) { return { status: 'needs_you', reason: `Could not send email to ${to}: ${e.message}`, filled: [], missing: [] }; }
  }

  /**
   * "Open & finish": fill the form in a visible window and leave it open so the user can solve a captcha / answer the
   * remaining questions and press Submit themselves. Completion is detected automatically.
   */
  async assist(appId) {
    const a = this.apps.find((x) => x.id === appId);
    const job = a && this.jobs[a.jobId];
    if (!job) return { ok: false, error: 'Job not found' };
    const driver = await this.driverFactory({ visible: true });
    this.log('info', `Opening ${job.company} – ${job.title} for you to finish`);
    try {
      await applyToJob({ driver, job, profile: this.profile, settings: this.settings, client: this.makeClient(this.settings), mode: 'dry', saveShot: async () => '' });
      const t0 = Date.now();
      while (Date.now() - t0 < 20 * 60000) {
        await this.sleep(2000);
        const c = await driver.eval('window.__JA ? __JA.confirmation() : null').catch(() => { throw new Error('closed'); });
        if (c?.done) { this.markApplied(appId, 'Completed by you (assisted)'); break; }
      }
    } catch (e) { if (e.message !== 'closed') this.log('warn', `Assist ended: ${e.message}`); }
    try { await driver.close(); } catch {}
    return { ok: true };
  }

  /** Mark a job as handled/skipped by the user. */
  setJobStatus(id, status) { if (this.jobs[id]) { this.jobs[id].status = status; if (status === 'skipped') this.jobs[id].userSkipped = true; else delete this.jobs[id].userSkipped; this.store.save('jobs'); this.emit('jobs'); } }
  /** The user finished an application themselves (assist mode or manually). */
  markApplied(appId, note = 'Completed by you') {
    const a = this.apps.find((x) => x.id === appId); if (!a) return;
    a.status = 'applied'; a.reason = note; a.at = new Date().toISOString();
    if (this.jobs[a.jobId]) this.jobs[a.jobId].status = 'applied';
    this.store.save('apps'); this.store.save('jobs'); this.emit('app', a);
  }
  // ───────── your decisions (approval queue, learning) ─────────
  /** Teach the scorer: 'up' = more like this, 'down' = fewer like this. */
  feedback(jobId, verdict) {
    const j = this.jobs[jobId]; if (!j) return;
    learnRecord(this.learn, j, verdict); this.store.save('meta');
    this.reevaluate();
  }
  /** Approvals screen: go ahead with an application that was waiting for you. */
  async approve(jobId) {
    const job = this.jobs[jobId]; if (!job) return { ok: false, error: 'Job not found' };
    const miss = missingForLive(this.profile);
    if (miss.length) return { ok: false, error: `Fill in first: ${miss.join(', ')}` };
    this.feedback(jobId, 'up');
    return { ok: true, app: await this.applyTo(job, { force: true, mode: 'live' }) };
  }
  reject(jobId) { this.feedback(jobId, 'down'); this.setJobStatus(jobId, 'skipped'); return { ok: true }; }
  /** You applied outside the app (manual sites): record it so it appears in the pipeline. */
  recordManual(jobId, note = 'Applied by you on the company site') {
    const job = this.jobs[jobId]; if (!job) return null;
    const rec = { id: uid(), jobId, company: job.company, title: job.title, location: job.location, url: job.url, applyUrl: job.applyUrl, ats: job.ats || null, score: job.eval?.score, mode: 'manual', at: new Date().toISOString(), status: 'applied', reason: note, filled: [], missing: [] };
    this.apps.push(rec); this.store.save('apps'); job.status = 'applied'; this.store.save('jobs');
    this.feedback(jobId, 'up'); this.emit('app', rec); return rec;
  }

  // ───────── after applying: stages, follow-ups, prep ─────────
  setStage(appId, stage, { interviewAt, note, source } = {}) {
    const a = this.apps.find((x) => x.id === appId); if (!a) return null;
    a.stage = stage; (a.history ||= []).push({ stage, at: new Date().toISOString(), ...(source ? { source } : {}) });
    if (stage === 'interview') { a.hadInterview = true; if (interviewAt) a.interviewAt = interviewAt; }
    if (note != null) a.notes = note;
    if (stage === 'interview' || stage === 'offer') learnRecord(this.learn, this.jobs[a.jobId] || a, 'up');
    this.store.save('apps'); this.store.save('meta'); this.emit('app', a); return a;
  }
  followUps() { return dueFollowUps(this.apps, { days: this.settings.followUpDays ?? 7 }); }
  followUpDraft(appId) { const a = this.apps.find((x) => x.id === appId); return a ? { ...followUpEmail(this.profile, a), to: a.emailTo || '' } : null; }
  markFollowedUp(appId) { const a = this.apps.find((x) => x.id === appId); if (a) { a.followedUpAt = new Date().toISOString(); this.store.save('apps'); this.emit('app', a); } }
  snooze(appId, days = 7) { const a = this.apps.find((x) => x.id === appId); if (a) { a.snoozeUntil = new Date(Date.now() + days * DAY).toISOString(); this.store.save('apps'); this.emit('app', a); } }
  async prep(appId) {
    const a = this.apps.find((x) => x.id === appId); const job = a && this.jobs[a.jobId]; if (!a || !job) return null;
    if (!a.prep) { a.prep = await interviewPrep({ client: this.makeClient(this.settings), settings: this.settings, profile: this.profile, job }); this.store.save('apps'); }
    return a.prep;
  }
  async previewCoverLetter(jobId) { const job = this.jobs[jobId]; if (!job) return null; return coverLetter({ client: this.makeClient(this.settings), settings: this.settings, profile: this.profile, job }); }

  /** Read replies from your mailbox and move applications along the pipeline (read-only access). */
  async checkInbox() {
    const meta = this.store.get('meta');
    const mails = await fetchRecent(this.settings, { imapFlow: this.imapFlow });
    meta.lastInbox = Date.now();
    const handled = new Set(meta.inboxHandled || []);
    const updates = proposeUpdates(this.apps, mails, handled);
    for (const u of updates) {
      const a = this.apps.find((x) => x.id === u.appId);
      this.setStage(u.appId, u.stage, { source: 'email', note: a.notes });
      a.emailEvidence = { subject: u.subject, from: u.from, date: u.date };
      handled.add(u.mailId);
      this.log('info', `Email: ${a.company} – ${a.title} → ${u.stage} (“${String(u.subject).slice(0, 70)}”)`);
      this.emit('reply', { app: a, stage: u.stage });
    }
    meta.inboxHandled = [...handled].slice(-600); this.store.save('meta'); this.store.save('apps');
    return { checked: mails.length, updated: updates.length };
  }
}
