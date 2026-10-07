// End-to-end check of the real Electron app (main process + UI + engine + hidden browser) against the local mock job sites.
// Run:  xvfb-run -a node tests/electron.e2e.mjs [path/to/packaged/JobAutopilot.exe-or-binary]
import { _electron as electron } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMock } from '../mock/server.js';
import { tempResume, testProfile } from './helpers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = process.env.SHOTS_DIR || '';
const packaged = process.argv[2];
const mock = await startMock(0);
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ja-e2e-'));
const app = await electron.launch({
  ...(packaged ? { executablePath: packaged, args: ['--no-sandbox', `--user-data-dir=${userData}`] } : { args: ['--no-sandbox', `--user-data-dir=${userData}`, ROOT] }),
  env: { ...process.env, JA_TEST_BASE: JSON.stringify(mock.sourceBase) },
});
const errors = [];
try {
  const win = await app.firstWindow();
  win.on('pageerror', (e) => errors.push(e.message));
  await win.waitForSelector('#view > *', { timeout: 20000 });
  const api = (name, payload) => win.evaluate(([n, p]) => window.api.call(n, p), [name, payload]);
  const waitFor = async (fn, ms = 40000, what = '') => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error(`timeout: ${what}`); await new Promise((r) => setTimeout(r, 250)); } };
  const shot = (n) => (SHOTS ? win.screenshot({ path: path.join(SHOTS, `${n}.png`) }) : null);

  const st = await api('state');
  assert.equal(st.running, false); assert.match(st.version, /^1\.2/); assert.ok(st.settings.inbox, 'new settings present');
  console.log('✓ app started, version', st.version, '· keys encrypted:', st.encrypted);

  // profile + settings through the real IPC API
  await api('profile:save', testProfile(tempResume()));
  await api('settings:save', { mode: 'live', approval: true, delaySeconds: [0, 0], maxPerCompany: 10, followUpDays: 0 });
  await win.reload(); await win.waitForSelector('#view > *');
  await shot('01-today');

  // autopilot on → live + approval: jobs are prepared but NOT submitted
  await api('engine:start');
  await waitFor(async () => (await api('state')).counts.awaiting >= 3, 40000, 'awaiting approvals');
  assert.equal(mock.submissions.length, 0, 'nothing submitted while waiting for approval');
  console.log('✓ approval mode queued', (await api('state')).counts.awaiting, 'jobs, 0 submitted');
  await win.evaluate(() => { location.hash = '#/approvals'; }); await win.waitForSelector('.approval'); await shot('02-approvals');

  // approve one in the UI → really applied via the hidden browser
  await win.locator('[data-act="approve"]').first().click();
  await waitFor(() => mock.submissions.length >= 1, 40000, 'submission after approve');
  const apps = await waitFor(async () => { const a = await api('apps:list'); return a.some((x) => x.status === 'applied') && a; }, 20000, 'app recorded');
  console.log('✓ approved job submitted:', apps.find((x) => x.status === 'applied').title);

  // the SmartRecruiters mock job (multi-step, shadow DOM, custom widgets) goes through the same approval flow
  const sr = (await api('jobs:list')).find((j) => j.ats === 'smartrecruiters');
  assert.ok(sr, 'smartrecruiters job found'); assert.equal(sr.status, 'awaiting');
  await api('profile:save', { summary: 'ML engineer with a year of experience building NLP and churn models.' });
  const before = mock.submissions.length;
  const ap = await api('job:approve', sr.id);
  assert.equal(ap.app.status, 'applied', JSON.stringify(ap.app));
  const sub = mock.submissions.at(-1); assert.equal(sub.kind, 'smartrecruiters'); assert.equal(sub.fields.firstName, 'Jane'); assert.equal(sub.files.resume.filename, 'Jane_Role_Resume.pdf');
  assert.equal(mock.submissions.length, before + 1);
  console.log('✓ SmartRecruiters multi-step shadow-DOM form submitted from Electron (file upload via CDP handle)');

  // reject another → skipped + learned
  const left = await win.locator('[data-act="skipjob"]').count();
  if (left) { await win.locator('[data-act="skipjob"]').first().click(); await waitFor(async () => (await api('state')).counts.awaiting < (left), 8000, 'reject'); console.log('✓ rejected one'); }

  // "Watch it fill": a visible application window opens, the form is filled but NOT submitted, and you can close it
  const gh = (await api('jobs:list')).find((j) => j.ats === 'lever' && ['awaiting', 'new', 'queued', 'needs_you', 'dry_run'].includes(j.status));
  if (gh) {
    const subs = mock.submissions.length;
    await api('job:watch', gh.id);
    await waitFor(async () => (await api('log:list')).some((l) => /everything is filled|Could not|needs/i.test(l.msg) && /Machine Learning Engineer|AI Engineer/.test(l.msg)), 30000, 'watch filled');
    const watchWin = app.windows().find((w) => w !== win);
    assert.ok(watchWin, 'a second, visible window is open for watching');
    assert.equal(mock.submissions.length, subs, 'watching never submits by itself');
    await watchWin.close().catch(() => {});
    console.log('✓ watch mode opened a visible window, filled the form, did not submit');
  }

  // pipeline: stage change, follow-up (followUpDays 0), insights, CSV builder
  const applied = (await api('apps:list')).find((x) => x.status === 'applied');
  await api('app:stage', { id: applied.id, stage: 'interview', interviewAt: '2026-11-03T10:30:00.000Z' });
  const ins = await api('insights'); assert.ok(ins.totals.applied >= 2); assert.equal(ins.totals.interviews, 1);
  await win.evaluate(() => { location.hash = '#/pipeline'; }); await win.waitForSelector('.pcard'); await shot('03-pipeline');
  assert.equal(await win.locator('.pcol[data-stage="interview"] .pcard').count(), 1);
  await win.evaluate(() => { location.hash = '#/insights'; }); await win.waitForSelector('.kpis'); await shot('04-insights');
  // answer bank API
  const qa = await api('qa:state'); assert.ok(qa.catalog.length >= 100); assert.ok(qa.groups.includes('Notice & pay'));
  await api('qa:bank', { id: 'postal', answer: '411001' }); await api('qa:add', { question: 'Do you own a car?', answer: 'No' });
  const qa2 = await api('qa:state'); assert.equal(qa2.catalog.find((c) => c.id === 'postal').yours, '411001'); assert.ok(qa2.qa.some((q) => /own a car/.test(q.question)));
  await win.evaluate(() => { location.hash = '#/answers'; }); await win.waitForSelector('.qrow'); await shot('06-answers');
  const prep = await api('app:prep', applied.id); assert.match(prep.text, /Likely questions/); assert.equal(prep.source, 'template');
  const draft = await api('app:followup:draft', applied.id); assert.match(draft.subject, /Following up/);
  const ib = await api('inbox:test'); assert.equal(ib.ok, false); assert.match(ib.error, /not set up/);
  const secrets = await api('settings:save', { claude: { apiKey: 'sk-ant-test-key' } });
  assert.equal(secrets.claude.hasKey, true); assert.equal(secrets.claude.apiKey, '');          // never sent back to the UI
  await new Promise((r) => setTimeout(r, 600));
  const disk = fs.readFileSync(path.join(userData, 'data', 'settings.json'), 'utf8');
  if (st.encrypted) assert.ok(!disk.includes('sk-ant-test-key'), 'API key must be encrypted on disk'); else console.log('  (OS key store unavailable here – plaintext fallback, as designed)');
  await win.evaluate(() => { location.hash = '#/settings'; }); await win.waitForSelector('[data-act="testinbox"]'); await shot('05-settings');
  await api('engine:stop');
  assert.deepEqual(errors, [], 'no renderer errors');
  console.log('\nELECTRON E2E PASSED');
} finally { await app.close().catch(() => {}); await mock.close(); }
