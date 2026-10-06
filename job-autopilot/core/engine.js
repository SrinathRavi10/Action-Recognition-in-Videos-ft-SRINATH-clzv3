// The autopilot: poll job sources → score → apply (within limits) → record everything.
import { EventEmitter } from 'node:events';
import { ATS_SOURCES, remoteok, remotive, adzuna, resolveTarget } from './sources/index.js';
import { discover, companyFromUrl } from './companies.js';
import { evaluate } from './match.js';
import { applyToJob } from './apply.js';
import { SUPPORTED_ATS } from './ats.js';
import { extractApplyEmail, sendApplication } from './email.js';
import { coverLetter } from './llm.js';
import { missingForLive } from './profile.js';
import { pool, sleep, jitter, uid, norm, today } from './util.js';

const DAY = 864e5;
const settingsSig = (s) => JSON.stringify([s.minScore, s.maxYearsRequired, s.includeInternships, s.locations, s.acceptAnywhereInIndia, s.acceptRemote, s.roles, s.excludeTitleWords]);

export class Engine extends EventEmitter {
  /**
   * @param {{store:import('./store.js').Store, driverFactory:(opts?:{visible?:boolean})=>Promise<object>, makeClient?:(settings:object)=>object|null,
   *          saveShot?:(buf:Buffer, tag:string, ctx:object)=>Promise<string>, sleepFn?:Function}} o
   */
  constructor({ store, driverFactory, makeClient = () => null, saveShot = async () => '', sleepFn = sleep }) {
    super();
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
        const ev = evaluate(j, this.profile, s);
        this.jobs[j.id] = { ...j, firstSeen: now, lastSeen: now, status: ev.decision === 'skip' ? 'skipped' : 'new', eval: ev, evalSig: sig };
        fresh++; if (ev.decision !== 'skip') relevant++;
      } else {
        const keep = old.eval && old.evalSig === sig;
        const ev = keep ? old.eval : evaluate(j, this.profile, s);
        this.jobs[j.id] = { ...old, ...j, firstSeen: old.firstSeen, lastSeen: now, eval: ev, evalSig: sig, status: old.status === 'skipped' && ev.decision !== 'skip' ? 'new' : old.status };
      }
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
      const ev = evaluate(j, this.profile, this.settings);
      j.eval = ev; j.evalSig = sig;
      if (j.status === 'skipped' && ev.decision !== 'skip') j.status = 'new';
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
      .filter((j) => j.eval?.decision === 'apply' && (['new', 'queued'].includes(j.status) || (live && j.status === 'dry_run')))
      .sort((a, b) => b.eval.score - a.eval.score || String(b.postedAt).localeCompare(String(a.postedAt)));
    let done = 0, consecutiveFails = 0;
    for (const job of queue) {
      if (this.stopRequested || !this.running && this.settings.autopilot === false) break;
      if (this.appliedToday() >= (s.maxPerDay ?? 15)) { this.log('info', `Daily limit of ${s.maxPerDay} reached`); break; }
      const why = this.blockReason(job);
      if (why) { if (why !== 'Dry-run already done') this.log('info', `Skipping ${job.company} – ${job.title}: ${why}`); continue; }
      const rec = await this.applyTo(job);
      done++;
      consecutiveFails = rec.status === 'failed' ? consecutiveFails + 1 : 0;
      if (consecutiveFails >= 3) { this.log('error', 'Three failures in a row – pausing this cycle'); break; }
      const [lo, hi] = s.delaySeconds || [25, 70];
      await this.sleep(jitter(lo, hi) * 1000);
    }
    return { done };
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
    if (SUPPORTED_ATS.includes(j.ats)) {
      let driver;
      try {
        driver = await this.driverFactory();
        result = await applyToJob({ driver, job: j, profile: this.profile, settings: s, client, mode: useMode, step: (m) => this.log('debug', m), saveShot: (buf, tag) => this.saveShot(buf, tag, { job: j }) });
      } catch (e) { result = { status: 'failed', reason: e.message, filled: [], missing: [] }; }
      finally { try { await driver?.close(); } catch {} }
    } else {
      const email = extractApplyEmail(j.description);
      if (email) result = await this.#emailApply(j, email, useMode, client);
      else result = { status: 'needs_you', reason: `This site is not supported for auto-apply – open it and apply yourself${j.resolvedUrl ? ` (${new URL(j.resolvedUrl).hostname})` : ''}`, filled: [], missing: [] };
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
    if (mode !== 'live') return { status: 'dry_run', reason: `Would email your resume to ${to} (dry run)`, filled: [{ label: 'Email to', value: to, source: 'job' }], missing: [] };
    try { await sendApplication({ settings: this.settings, profile: this.profile, job, to, coverLetter: letter }); return { status: 'emailed', reason: `Emailed your resume to ${to}`, filled: [{ label: 'Email to', value: to, source: 'job' }], missing: [] }; }
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
  setJobStatus(id, status) { if (this.jobs[id]) { this.jobs[id].status = status; this.store.save('jobs'); this.emit('jobs'); } }
  /** The user finished an application themselves (assist mode or manually). */
  markApplied(appId, note = 'Completed by you') {
    const a = this.apps.find((x) => x.id === appId); if (!a) return;
    a.status = 'applied'; a.reason = note; a.at = new Date().toISOString();
    if (this.jobs[a.jobId]) this.jobs[a.jobId].status = 'applied';
    this.store.save('apps'); this.store.save('jobs'); this.emit('app', a);
  }
}
