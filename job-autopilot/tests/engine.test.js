import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startMock } from '../mock/server.js';
import { Engine } from '../core/engine.js';
import { Store } from '../core/store.js';
import { pwFactory, tempResume, testProfile } from './helpers.js';

let mock, browser;
test.before(async () => { mock = await startMock(0); browser = await pwFactory(); });
test.after(async () => { await browser?.close(); await mock?.close(); });

function setup(over = {}) {
  const store = new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'ja-eng-')));
  Object.assign(store.get('profile'), testProfile(tempResume()));
  Object.assign(store.get('settings'), { mode: 'live', autopilot: true, delaySeconds: [0, 0], maxPerCompany: 10, sources: { greenhouse: true, lever: true, ashby: true, workable: false, remoteok: false, remotive: false, adzuna: false }, sourceBase: mock.sourceBase, ...over });
  store.set('companies', [{ ats: 'greenhouse', token: 'mockco', enabled: true }, { ats: 'lever', token: 'mockco', enabled: true }, { ats: 'ashby', token: 'mockco', enabled: true }]);
  const engine = new Engine({ store, driverFactory: browser.factory, sleepFn: async () => {}, saveShot: async (b, tag) => `shot-${tag}` });
  engine.running = true;   // as if the autopilot switch were on, without arming the timer
  return { store, engine };
}
const byTitle = (engine) => Object.fromEntries(Object.values(engine.jobs).map((j) => [`${j.ats}:${j.title}`, j]));

test('full cycle: fetch → score → apply; skips seniors; reports captcha, unknown questions and closed postings', async () => {
  await fetch(`${mock.url}/__reset`);
  const { engine } = setup();
  const r = await engine.tick();
  assert.equal(r.fetched, 7);
  const jobs = byTitle(engine);
  assert.equal(jobs['greenhouse:Senior Staff Machine Learning Engineer'].status, 'skipped');
  assert.match(jobs['greenhouse:Senior Staff Machine Learning Engineer'].eval.skipReason, /Seniority/);
  const st = Object.fromEntries(engine.apps.map((a) => [`${a.ats}:${a.title}`, a.status]));
  assert.equal(st['greenhouse:Machine Learning Engineer'], 'applied');
  assert.equal(st['lever:AI Engineer (Generative AI)'], 'applied');
  assert.equal(st['ashby:Machine Learning Engineer, Applied AI'], 'applied');
  assert.equal(st['greenhouse:Data Scientist'], 'needs_you');          // free-text question we cannot answer honestly
  assert.equal(st['lever:Machine Learning Engineer (Vision)'], 'needs_you');    // captcha
  assert.equal(st['greenhouse:AI Engineer'], 'closed');                // posting removed
  assert.equal(mock.submissions.length, 3);
  assert.equal(r.done, 6);
  assert.ok(engine.store.get('meta').health['greenhouse:mockco'].ok);
});

test('a second cycle does not re-apply or re-attempt anything', async () => {
  await fetch(`${mock.url}/__reset`);
  const { engine } = setup();
  await engine.tick();
  const n = engine.apps.length, subs = mock.submissions.length;
  const r = await engine.tick();
  assert.equal(r.fresh, 0);
  assert.equal(engine.apps.length, n);
  assert.equal(mock.submissions.length, subs);
});

test('dry run submits nothing; switching to live then applies those jobs', async () => {
  await fetch(`${mock.url}/__reset`);
  const { engine, store } = setup({ mode: 'dry' });
  await engine.tick();
  assert.equal(mock.submissions.length, 0);
  assert.ok(engine.apps.filter((a) => a.status === 'dry_run').length >= 3);
  store.get('settings').mode = 'live';
  await engine.tick();
  assert.equal(mock.submissions.length, 3);
});

test('daily limit and per-company limit are respected', async () => {
  await fetch(`${mock.url}/__reset`);
  const a = setup({ maxPerDay: 2 });
  await a.engine.tick();
  assert.equal(mock.submissions.length, 2);
  await fetch(`${mock.url}/__reset`);
  const b = setup({ maxPerCompany: 1 });
  await b.engine.tick();
  assert.equal(mock.submissions.length, 1);   // all three listings are the same company
  assert.ok(b.engine.store.get('log').some((l) => /already applied/i.test(l.msg)));
});

test('live mode refuses to run until the profile is complete', async () => {
  await fetch(`${mock.url}/__reset`);
  const { engine, store } = setup();
  store.get('profile').answers.expectedCtc = '';
  const r = await engine.tick();
  assert.equal(r.blocked, 'profile');
  assert.equal(mock.submissions.length, 0);
});

test('stopped autopilot only fetches, never applies', async () => {
  await fetch(`${mock.url}/__reset`);
  const { engine, store } = setup({ autopilot: false });
  engine.running = false;
  const r = await engine.tick({ apply: true });
  assert.ok(r.fetched > 0);
  assert.equal(mock.submissions.length, 0);
  assert.equal(engine.apps.length, 0);
});

test('manual “apply now” works for a single job and records a screenshot reference', async () => {
  await fetch(`${mock.url}/__reset`);
  const { engine } = setup({ autopilot: false });
  engine.running = false;
  await engine.fetchAll();
  const job = Object.values(engine.jobs).find((j) => j.ats === 'ashby');
  const rec = await engine.applyTo(job, { mode: 'live' });
  assert.equal(rec.status, 'applied');
  assert.match(rec.screenshot, /shot-confirmed/);
  assert.equal(engine.jobs[job.id].status, 'applied');
});
