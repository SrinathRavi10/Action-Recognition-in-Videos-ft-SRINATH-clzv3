import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { salaryInfo, parseMoneyInr, compareSalary, dupKey, pickWinner, fmtLpa } from '../core/quality.js';
import { record, adjust } from '../core/learn.js';
import { evaluate } from '../core/match.js';
import { DEFAULT_SETTINGS, emptyProfile } from '../core/profile.js';
import { followUps, followUpEmail, interviewIcs, analytics, appsCsv, stageOf } from '../core/pipeline.js';
import { classifyEmail, matchApplication, proposeUpdates, fetchRecent } from '../core/inbox.js';
import { templatePrep, interviewPrep } from '../core/llm.js';
import { Store } from '../core/store.js';
import { smartrecruiters } from '../core/sources/index.js';
import { companyFromUrl } from '../core/companies.js';
import { Engine } from '../core/engine.js';
import { testProfile, tempResume } from './helpers.js';

const DAY = 864e5;

test('salary: understands lakh / LPA / monthly / rupee forms and ignores unrelated numbers', () => {
  assert.deepEqual(salaryInfo('Salary: ₹8-12 LPA, hybrid'), { min: 8e5, max: 12e5, raw: salaryInfo('Salary: ₹8-12 LPA, hybrid').raw });
  assert.equal(salaryInfo('CTC 6 to 9 LPA').max, 9e5);
  assert.equal(salaryInfo('Compensation INR 800,000 - 1,200,000 per annum').min, 8e5);
  assert.equal(salaryInfo('Stipend ₹30,000 - 40,000 per month').max, 4.8e6 / 10);   // 40k × 12
  assert.equal(salaryInfo('We have 2-3 years of experience and 5 - 10 members in the team'), null);
  assert.equal(parseMoneyInr('8 LPA'), 8e5);
  assert.equal(parseMoneyInr('₹8,00,000'), 8e5);
  assert.equal(parseMoneyInr('1.5 Cr'), 1.5e7);
  assert.equal(fmtLpa(8e5), '8 LPA');
  const c = compareSalary({ description: 'CTC 3-4 LPA' }, '8 LPA'); assert.equal(c.verdict, 'below');
  assert.equal(compareSalary({ description: 'CTC 8-10 LPA' }, '8 LPA').verdict, 'meets');
  assert.equal(compareSalary({ description: 'great team' }, '8 LPA').known, false);
});

test('duplicates: same job on two sites is recognised; the auto-appliable listing wins', () => {
  const a = { company: 'Acme', title: 'Machine Learning Engineer (Remote)', location: 'Pune, India', ats: null, source: 'remoteok', firstSeen: '2026-01-01' };
  const b = { company: 'ACME', title: 'Machine learning engineer', location: 'Pune', ats: 'greenhouse', firstSeen: '2026-01-02' };
  assert.equal(dupKey(a), dupKey(b));
  assert.equal(pickWinner(a, b, ['greenhouse']), b);
});

test('learning: approvals and rejections shift scores a little, never a lot', () => {
  const learn = { f: {}, n: 0 };
  const liked = { title: 'NLP Engineer', company: 'Good Co', department: 'AI' }, disliked = { title: 'Data Analyst', company: 'Meh Co', department: 'BI' };
  assert.equal(adjust(learn, liked).points, 0);   // nothing learned yet
  for (let i = 0; i < 4; i++) { record(learn, liked, 'up'); record(learn, disliked, 'down'); }
  const up = adjust(learn, { title: 'NLP Engineer', company: 'Good Co' }), down = adjust(learn, { title: 'Data Analyst', company: 'Meh Co' });
  assert.ok(up.points > 0 && up.points <= 12, JSON.stringify(up));
  assert.ok(down.points < 0 && down.points >= -12);
  assert.match(up.why, /approved/); assert.match(down.why, /rejected/);
  assert.equal(adjust(learn, { title: 'Quantum Plumber', company: 'Nobody' }).points, 0);
});

test('matching: stale postings are skipped; low pay lowers the score and says why', () => {
  const p = { ...emptyProfile(), skills: ['Python', 'PyTorch', 'NLP'], experienceYears: 1, answers: { expectedCtc: '10 LPA' } };
  const s = { ...DEFAULT_SETTINGS(), locations: ['Pune'] };
  const job = (o) => ({ title: 'Machine Learning Engineer', company: 'X', location: 'Pune, India', description: 'Python PyTorch NLP. 0-2 years experience.', postedAt: new Date().toISOString(), ...o });
  assert.match(evaluate(job({ postedAt: new Date(Date.now() - 90 * DAY).toISOString() }), p, s).skipReason, /stale/i);
  const base = evaluate(job({}), p, s), low = evaluate(job({ description: 'Python PyTorch NLP. 0-2 years experience. CTC 3-4 LPA' }), p, s), high = evaluate(job({ description: 'Python PyTorch NLP. 0-2 years experience. CTC 12-15 LPA' }), p, s);
  assert.ok(low.score < base.score); assert.ok(low.reasons.some((r) => /below your expectation/.test(r)));
  assert.ok(high.score > base.score); assert.ok(high.reasons.some((r) => /meets your expectation/.test(r)));
});

const app = (o) => ({ id: Math.random().toString(36).slice(2), company: 'Acme', title: 'ML Engineer', status: 'applied', at: new Date().toISOString(), ats: 'greenhouse', score: 70, ...o });

test('pipeline: follow-ups, interview calendar entry, analytics and CSV', () => {
  const old = app({ at: new Date(Date.now() - 9 * DAY).toISOString() }), fresh = app({}), replied = app({ at: new Date(Date.now() - 9 * DAY).toISOString(), stage: 'replied' }), snoozed = app({ at: new Date(Date.now() - 9 * DAY).toISOString(), snoozeUntil: new Date(Date.now() + DAY).toISOString() });
  assert.deepEqual(followUps([old, fresh, replied, snoozed], { days: 7 }).map((a) => a.id), [old.id]);
  assert.match(followUpEmail({ fullName: 'Jane Role', email: 'j@x.in' }, old).subject, /Following up/);
  const ics = interviewIcs({ id: 'a1', company: 'Acme, Inc', title: 'ML Engineer', interviewAt: '2026-11-03T10:30:00Z' });
  assert.match(ics, /DTSTART:20261103T103000Z/); assert.match(ics, /DTEND:20261103T113000Z/); assert.match(ics, /Acme\\, Inc/);
  assert.equal(interviewIcs({ id: 'x' }), null);
  const apps = [old, fresh, replied, app({ stage: 'interview', ats: 'lever' }), app({ stage: 'offer', ats: 'lever' }), app({ status: 'dry_run' }), app({ stage: 'rejected' })];
  const a = analytics(apps, {}, {});
  assert.equal(a.totals.applied, 6); assert.equal(a.totals.interviews, 2); assert.equal(a.totals.offers, 1); assert.equal(a.totals.responded, 4);
  assert.equal(a.weekly.length, 8);
  assert.equal(a.weekly.reduce((n, w) => n + w.applied, 0), 6); assert.equal(a.weekly.reduce((n, w) => n + w.dry, 0), 1);
  assert.equal(a.bySource.find((x) => x.name === 'lever').applied, 2);
  assert.equal(stageOf(app({ status: 'failed' })), null);
  const csv = appsCsv([app({ company: 'A, "B"', filled: [{ label: 'Email', value: 'j@x.in' }] })]);
  assert.match(csv, /"A, ""B"""/); assert.match(csv, /Email=j@x.in/);
});

test('inbox: classifies replies and links them to the right application, never downgrades', () => {
  assert.equal(classifyEmail({ subject: 'Interview invitation – ML Engineer', text: 'We would like to schedule an interview' }), 'interview');
  assert.equal(classifyEmail({ subject: 'Update on your application', text: 'Unfortunately we will not be moving forward with your application' }), 'rejection');
  assert.equal(classifyEmail({ subject: 'Offer letter', text: 'We are pleased to offer you the position' }), 'offer');
  assert.equal(classifyEmail({ subject: 'Thank you for applying', text: 'We have received your application' }), 'received');
  assert.equal(classifyEmail({ subject: '10 jobs you may like – job alert', text: 'Unfortunately' }), null);
  const acme = app({ company: 'Acme Robotics', title: 'ML Engineer' }), other = app({ company: 'Globex', title: 'Data Scientist' });
  const mail = (o) => ({ id: 'm' + Math.random(), from: 'Acme Robotics Careers careers@acmerobotics.com', subject: 'Interview invitation', text: 'schedule an interview for the ML Engineer role', date: new Date(Date.now() + 1000).toISOString(), ...o });
  assert.equal(matchApplication([acme, other], mail()).id, acme.id);
  const u = proposeUpdates([acme, other], [mail(), mail({ from: 'x@unknown.com', subject: 'Interview invitation', text: 'schedule an interview' })]);
  assert.equal(u.length, 1); assert.equal(u[0].stage, 'interview');
  assert.equal(proposeUpdates([{ ...acme, stage: 'interview' }], [mail()]).length, 0);        // already there
  assert.equal(proposeUpdates([{ ...acme, stage: 'rejected' }], [mail()]).length, 0);          // final
  const seen = mail(); assert.equal(proposeUpdates([acme], [seen], new Set([seen.id])).length, 0);
});

test('inbox: IMAP fetch is driven through the client interface (stubbed) and refuses without setup', async () => {
  await assert.rejects(() => fetchRecent({ inbox: { enabled: false } }), /not set up/);
  const calls = [];
  class Fake {
    constructor(o) { calls.push(['new', o.host, o.auth.user]); }
    async connect() { calls.push(['connect']); }
    async getMailboxLock() { return { release() { calls.push(['release']); } }; }
    async search() { return [1, 2]; }
    async *fetch() { yield { uid: 2, envelope: { subject: 'Interview invitation', from: [{ name: 'Acme', address: 'hr@acme.com' }], date: new Date() }, source: Buffer.from('Subject: x\r\n\r\nWe would like to <b>schedule</b> an interview') }; }
    async logout() { calls.push(['logout']); }
  }
  const mails = await fetchRecent({ inbox: { enabled: true, user: 'me@gmail.com', pass: 'app-pass' } }, { imapFlow: { ImapFlow: Fake } });
  assert.equal(mails.length, 1); assert.match(mails[0].text, /schedule an interview/); assert.equal(mails[0].id, 'me@gmail.com:2');
  assert.deepEqual(calls.map((c) => c[0]), ['new', 'connect', 'release', 'logout']);
});

test('interview prep: honest checklist without Claude; uses Claude when available', async () => {
  const p = { ...emptyProfile(), skills: ['Python', 'PyTorch'] };
  const job = { title: 'ML Engineer', company: 'Acme', description: 'Python, PyTorch, Kubernetes, Docker and NLP' };
  const t = templatePrep(p, job);
  assert.match(t, /Where you are strong\n- Python\n- PyTorch/); assert.match(t, /Gaps to revise[\s\S]*Docker/);
  const client = { beta: { messages: { create: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: '## Brief\nhello' }] }) } } };
  assert.deepEqual(await interviewPrep({ client, settings: {}, profile: p, job }), { text: '## Brief\nhello', source: 'claude' });
  assert.equal((await interviewPrep({ client: null, settings: {}, profile: p, job })).source, 'template');
});

test('secrets: API keys and passwords are encrypted on disk and readable again', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ja-sec-'));
  const codec = { encrypt: (s) => Buffer.from([...s].reverse().join('')).toString('base64'), decrypt: (s) => [...Buffer.from(s, 'base64').toString()].reverse().join('') };
  const a = new Store(dir, { codec });
  a.get('settings').claude.apiKey = 'sk-ant-secret'; a.get('settings').email.pass = 'hunter2'; a.get('settings').inbox.pass = 'imap-pass';
  a.flush();
  const raw = fs.readFileSync(path.join(dir, 'settings.json'), 'utf8');
  assert.ok(!raw.includes('sk-ant-secret') && !raw.includes('hunter2') && !raw.includes('imap-pass')); assert.match(raw, /enc:v1:/);
  const b = new Store(dir, { codec });
  assert.equal(b.get('settings').claude.apiKey, 'sk-ant-secret'); assert.equal(b.get('settings').email.pass, 'hunter2'); assert.equal(b.get('settings').inbox.pass, 'imap-pass');
  // plain-text files from an older version are upgraded on the next save
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ claude: { apiKey: 'old-plain' } }));
  const c = new Store(dir, { codec }); assert.equal(c.get('settings').claude.apiKey, 'old-plain'); c.flush();
  assert.ok(!fs.readFileSync(path.join(dir, 'settings.json'), 'utf8').includes('old-plain'));
});

test('smartrecruiters: listing adapter + careers URL recognised (apply is manual)', async () => {
  const real = globalThis.fetch;
  globalThis.fetch = async (u) => { assert.match(String(u), /api\.smartrecruiters\.com\/v1\/companies\/Acme\/postings/); return new Response(JSON.stringify({ totalFound: 1, content: [{ id: '123', name: 'Machine Learning Engineer', releasedDate: '2026-10-01T00:00:00Z', company: { name: 'Acme' }, location: { city: 'Pune', country: 'in', fullLocation: 'Pune, India' }, department: { label: 'AI' } }] }), { headers: { 'content-type': 'application/json' } }); };
  try {
    const jobs = await smartrecruiters('Acme', {});
    assert.equal(jobs.length, 1); assert.equal(jobs[0].manual, true); assert.equal(jobs[0].url, 'https://jobs.smartrecruiters.com/Acme/123'); assert.equal(jobs[0].location, 'Pune, India');
  } finally { globalThis.fetch = real; }
  assert.deepEqual(companyFromUrl('https://jobs.smartrecruiters.com/Acme/743999'), { ats: 'smartrecruiters', token: 'Acme', name: 'Acme', custom: true, enabled: true, checkedAt: null });
});

// ───────── engine behaviour that needs no browser ─────────
function engineWith(jobs, over = {}, factory) {
  const store = new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'ja-f-')));
  Object.assign(store.get('profile'), testProfile(tempResume()));
  Object.assign(store.get('settings'), { mode: 'live', autopilot: true, delaySeconds: [0, 0], locations: ['Pune'], ...over });
  const now = new Date().toISOString();
  for (const j of jobs) store.get('jobs')[j.id] = { source: j.ats, token: 't', location: 'Pune, India', description: 'Python PyTorch NLP. 0-2 years experience.', postedAt: now, firstSeen: now, status: 'new', department: '', ...j };
  const e = new Engine({ store, driverFactory: factory || (async () => { throw new Error('no browser in this test'); }), sleepFn: async () => {} });
  e.running = true; e.reevaluate();
  return { e, store };
}
const J = (id, o = {}) => ({ id, ats: 'greenhouse', company: 'Co' + id, title: 'Machine Learning Engineer', applyUrl: 'http://x/' + id, url: 'http://x/' + id, ...o });

test('engine: approval mode queues jobs instead of applying; approve / reject work and teach the scorer', async () => {
  const { e } = engineWith([J('a'), J('b')], { approval: true });
  e.applyTo = async (job) => { e.jobs[job.id].status = 'applied'; return { status: 'applied' }; };
  const r = await e.processQueue();
  assert.equal(r.done, 0); assert.equal(r.queuedForApproval, 2);
  assert.ok(Object.values(e.jobs).every((j) => j.status === 'awaiting'));
  e.reject('b'); assert.equal(e.jobs.b.status, 'skipped'); assert.equal(e.learn.n, 1);
  const ok = await e.approve('a'); assert.equal(ok.app.status, 'applied'); assert.equal(e.jobs.a.status, 'applied');
  // turning approval off releases anything still waiting
  e.jobs.a.status = 'awaiting'; e.settings.approval = false; const r2 = await e.processQueue(); assert.equal(r2.done, 1);
});

test('engine: approval is not used for dry runs', async () => {
  const { e } = engineWith([J('a')], { approval: true, mode: 'dry' });
  let called = 0; e.applyTo = async (job) => { called++; e.jobs[job.id].status = 'dry_run'; return { status: 'dry_run' }; };
  const r = await e.processQueue(); assert.equal(called, 1); assert.equal(r.queuedForApproval, 0);
});

test('engine: sites we cannot fill are never attempted; user gets one heads-up and can record the application', async () => {
  const { e } = engineWith([J('s', { ats: 'smartrecruiters', manual: true, company: 'Visa' })]);
  const heard = []; e.on('manual', (j) => heard.push(j.id));
  e.applyTo = async () => { throw new Error('must not be attempted'); };
  assert.equal((await e.processQueue()).done, 0);
  e.store.get('settings').sources = { ...e.settings.sources };
  const rec = e.recordManual('s'); assert.equal(rec.status, 'applied'); assert.equal(rec.mode, 'manual'); assert.equal(e.jobs.s.status, 'applied'); assert.equal(stageOf(rec), 'applied');
});

test('engine: duplicates across sites are collapsed to one (and stay collapsed after re-scoring)', () => {
  const { e } = engineWith([J('g', { company: 'Acme', location: 'Pune, India' }), J('r', { company: 'Acme', ats: null, source: 'remoteok', location: 'Pune' })]);
  assert.equal(e.markDuplicates(), 1);
  assert.equal(e.jobs.r.status, 'skipped'); assert.match(e.jobs.r.eval.skipReason, /listed on greenhouse/);
  e.reevaluate(); assert.equal(e.jobs.r.status, 'skipped'); assert.equal(e.jobs.g.eval.decision, 'apply');
});

test('engine: a failed application is retried once automatically, with a fresh browser window', async () => {
  let opened = 0;
  const factory = async () => { opened++; throw new Error('net::ERR_CONNECTION_RESET'); };
  const { e } = engineWith([J('a')], {}, factory);
  const rec = await e.applyTo(e.jobs.a, { force: true });
  assert.equal(opened, 2); assert.equal(rec.status, 'failed'); assert.match(rec.reason, /after a retry/);
});

test('engine: stages, follow-ups, calendar data and the email-driven pipeline', async () => {
  const { e } = engineWith([J('a', { company: 'Acme Robotics' })]);
  const rec = e.recordManual('a');
  rec.at = new Date(Date.now() - 8 * DAY).toISOString();
  assert.equal(e.followUps().length, 1);
  assert.match(e.followUpDraft(rec.id).body, /Acme Robotics/);
  e.snooze(rec.id, 3); assert.equal(e.followUps().length, 0);
  // inbox reply → interview
  e.store.get('settings').inbox = { enabled: true, user: 'me@x.in', pass: 'p', host: 'h', port: 993 };
  class Fake { async connect() {} async getMailboxLock() { return { release() {} }; } async search() { return [9]; } async *fetch() { yield { uid: 9, envelope: { subject: 'Interview invitation – Machine Learning Engineer', from: [{ name: 'Acme Robotics', address: 'hr@acme.com' }], date: new Date(Date.now() + 1000) }, source: Buffer.from('X: y\r\n\r\nPlease let us schedule an interview') }; } async logout() {} }
  e.imapFlow = { ImapFlow: Fake };
  const r = await e.checkInbox();
  assert.equal(r.updated, 1); assert.equal(rec.stage, 'interview'); assert.equal(rec.history.at(-1).source, 'email');
  assert.equal((await e.checkInbox()).updated, 0);                // the same mail is not applied twice
  e.setStage(rec.id, 'interview', { interviewAt: '2026-11-03T10:30:00Z' });
  assert.match(interviewIcs(rec), /20261103T103000Z/);
  assert.match((await e.prep(rec.id)).text, /Likely questions/);
});

test('engine: a job you skipped stays skipped when the profile or settings change later', () => {
  const { e } = engineWith([J('a')]);
  assert.equal(e.jobs.a.eval.decision, 'apply');
  e.setJobStatus('a', 'skipped'); e.reevaluate(); e.reevaluate();
  assert.equal(e.jobs.a.status, 'skipped');
  e.setJobStatus('a', 'new'); assert.equal(e.jobs.a.userSkipped, undefined);
});
