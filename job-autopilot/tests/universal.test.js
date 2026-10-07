import test from 'node:test';
import assert from 'node:assert/strict';
import { startMock } from '../mock/server.js';
import { applyToJob } from '../core/apply.js';
import { DEFAULT_SETTINGS } from '../core/profile.js';
import { pwDriver, tempResume, testProfile } from './helpers.js';

let mock, driver, base;
test.before(async () => { mock = await startMock(0); driver = await pwDriver(); base = { ...testProfile(tempResume()), summary: 'ML engineer with a year of experience building NLP and churn models.', bank: {}, qa: [] }; });
test.after(async () => { await driver?.close(); await mock?.close(); });

const settings = () => ({ ...DEFAULT_SETTINGS(), sourceBase: mock.sourceBase, locations: ['Pune', 'Chennai'] });
const run = (path, { profile = base, job = {}, ...over } = {}) => applyToJob({ driver, job: { title: 'ML Engineer', company: 'MockCo', description: '', applyUrl: `${mock.url}${path}`, ...job }, profile, settings: settings(), mode: 'live', timeouts: { confirm: 12000, frame: 1500, form: 15000 }, ...over });
const last = () => mock.submissions.at(-1);

test('multi-step web-component (shadow DOM) form: contact → questions → consent → submit', async () => {
  await fetch(`${mock.url}/__reset`);
  const r = await run('/sr/mockco/1');
  assert.equal(r.status, 'applied', JSON.stringify({ reason: r.reason, missing: r.missing, steps: r.steps }));
  assert.equal(r.steps, 3);
  const f = last().fields;
  assert.equal(f.firstName, 'Jane'); assert.equal(f.lastName, 'Role'); assert.equal(f.email, 'jane.role@example.com'); assert.equal(f.email2, 'jane.role@example.com');
  assert.equal(f.phone, '9876543210');
  assert.equal(f.location, 'Pune, Maharashtra, India');                 // picked from the autocomplete list, not the US “Pune”
  assert.equal(f.python, 'Yes');                                       // role=radio buttons
  assert.equal(f.sqlyrs, '1-3 years');                                 // 1 year → the right numeric bucket
  assert.equal(f.notice, '30 days');                                   // custom drop-down (button + listbox)
  assert.match(f.ctc, /5-8 LPA|8-12 LPA/);
  assert.match(f.start, /^\d{4}-\d{2}-\d{2}$/); assert.ok(new Date(f.start) > new Date());
  assert.equal(f.about, base.summary);                                 // contenteditable rich-text box
  assert.equal(f.consent, 'on'); assert.equal(f.marketing, '');        // consent yes, marketing no
  assert.equal(last().files.resume.filename, 'Jane_Role_Resume.pdf');   // file input inside a shadow root
});

test('multi-step dry run walks every step but never submits', async () => {
  await fetch(`${mock.url}/__reset`);
  const r = await run('/sr/mockco/1', { mode: 'dry' });
  assert.equal(r.status, 'dry_run'); assert.equal(r.steps, 3); assert.equal(mock.submissions.length, 0);
  assert.match(r.reason, /NOT submitted because Dry run is on/);
});

test('multi-step: a question we cannot answer on step 2 stops there, is remembered as pending, nothing is sent', async () => {
  await fetch(`${mock.url}/__reset`);
  const r = await run('/sr/mockco/1', { profile: { ...base, summary: '' } });
  assert.equal(r.status, 'needs_you'); assert.match(r.reason, /Tell us about yourself/);
  assert.equal(mock.submissions.length, 0);
  assert.ok(r.unanswered.some((u) => /Tell us about yourself/.test(u.label)));
});

test('an account / sign-in wall is recognised instead of being filled', async () => {
  const r = await run('/account/login', { timeouts: { form: 9000, frame: 1500 } });
  assert.equal(r.status, 'needs_you'); assert.match(r.reason, /sign in or create an account/);
});

test('form embedded in an iframe on the company page: the app opens the embedded form directly', async () => {
  await fetch(`${mock.url}/__reset`);
  const r = await run('/careers/mockco/9', { job: { ats: 'greenhouse', token: 'mockco', id: 'greenhouse:mockco:9' } });
  assert.equal(r.status, 'applied', JSON.stringify(r));
  assert.equal(last().fields.first_name, 'Jane');
});

test('company page with no visible form: falls back to the Greenhouse application form', async () => {
  await fetch(`${mock.url}/__reset`);
  const r = await run('/careers-noframe/mockco/9', { job: { ats: 'greenhouse', token: 'mockco', id: 'greenhouse:mockco:9' } });
  assert.equal(r.status, 'applied', JSON.stringify(r));
});

test('wide questionnaire: unusual wording, ranges, checkbox groups, date/number/phone shapes – unknown answers become pending, then you answer once', async () => {
  await fetch(`${mock.url}/__reset`);
  // 1st attempt: no answers typed yet for night shifts / work mode / reason for leaving → needs_you and they are listed as pending
  const first = await run('/wide/form');
  assert.equal(first.status, 'needs_you');
  const asked = first.unanswered.map((u) => u.label).join(' | ');
  for (const w of [/night shifts/, /work arrangement/, /leaving/]) assert.match(asked, w);
  assert.deepEqual(first.unanswered.find((u) => /night shifts/.test(u.label)).options, ['--', 'Yes', 'No'].filter((x) => x !== '--').length ? ['--', 'Yes', 'No'].slice(0) : []);
  assert.equal(mock.submissions.length, 0);
  // you answer once on the Answers screen (profile.bank) → the same form now goes through
  const profile = { ...base, bank: { shift: 'No', work_mode: 'Hybrid', reason_leaving: 'I want to work on ML products full-time.' } };
  const r = await run('/wide/form', { profile });
  assert.equal(r.status, 'applied', JSON.stringify({ reason: r.reason, missing: r.missing }));
  const f = last().fields;
  assert.equal(f.first, 'Jane'); assert.equal(f.last, 'Role'); assert.equal(f.email, 'jane.role@example.com');
  assert.equal(f.mobile, '+919876543210'); assert.equal(f.cc, '+91 (India)');
  assert.equal(f.exp, '1 to 3 years'); assert.equal(f.join, 'Within 1 month');
  assert.equal(f.cur, '5'); assert.equal(f.exp_sal, '800000');
  assert.equal(f.elig, 'y'); assert.equal(f.reloc, 'Yes'); assert.equal(f.lang, 'Python,SQL');
  assert.equal(f.pt, 'Yes'); assert.equal(f.k8s, 'No');
  assert.equal(f.edu, "Bachelor's degree"); assert.equal(f.gy, '2025'); assert.equal(f.wm, 'Hybrid'); assert.equal(f.night, 'No');
  assert.ok(!f.dob, 'date of birth is never guessed'); assert.equal(f.gender, 'Prefer not to say');
  assert.equal(f.sig, 'Jane Role'); assert.equal(f.leave, 'I want to work on ML products full-time.');
  assert.equal(f.terms, 'on'); assert.ok(!f.promo, 'promotional box left unticked');
});
