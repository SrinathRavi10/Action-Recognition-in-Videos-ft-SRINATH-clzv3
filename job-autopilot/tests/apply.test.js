import test from 'node:test';
import assert from 'node:assert/strict';
import { startMock } from '../mock/server.js';
import { applyToJob } from '../core/apply.js';
import { DEFAULT_SETTINGS } from '../core/profile.js';
import { pwDriver, tempResume, testProfile } from './helpers.js';

let mock, driver, profile;
test.before(async () => { mock = await startMock(0); driver = await pwDriver(); profile = testProfile(tempResume()); });
test.after(async () => { await driver?.close(); await mock?.close(); });

const run = (path, over = {}) => applyToJob({ driver, job: { title: 'ML Engineer', company: 'MockCo', description: '', applyUrl: `${mock.url}${path}` }, profile, settings: DEFAULT_SETTINGS(), mode: 'live', timeouts: { confirm: 12000 }, ...over });

test('Greenhouse-style form: fills everything correctly, submits, site confirms', async () => {
  await fetch(`${mock.url}/__reset`);
  const r = await run('/gh/mockco/jobs/1');
  assert.equal(r.status, 'applied', JSON.stringify(r));
  const s = mock.submissions.at(-1);
  assert.equal(s.fields.first_name, 'Jane');
  assert.equal(s.fields.last_name, 'Role');
  assert.equal(s.fields.email, 'jane.role@example.com');
  assert.equal(s.fields.phone, '9876543210');
  assert.equal(s.fields.q_auth, 'Yes');
  assert.equal(s.fields.q_notice, '30 days');
  assert.equal(s.fields.q_ctc, '8 LPA');
  assert.equal(s.fields.q_src, 'Company careers page');
  assert.equal(s.fields.gender, 'Decline To Self Identify');
  assert.equal(s.fields.consent, 'on');
  assert.equal(s.fields.linkedin, 'https://linkedin.com/in/jane-role');
  assert.equal(s.fields.hp_website, '');                      // honeypot untouched
  assert.equal(s.files.resume.filename, 'Jane_Role_Resume.pdf');
});

test('dry run fills the form but does NOT submit', async () => {
  await fetch(`${mock.url}/__reset`);
  const shots = [];
  const r = await run('/gh/mockco/jobs/1', { mode: 'dry', saveShot: async (buf, tag) => { shots.push(tag); return `shot-${tag}`; } });
  assert.equal(r.status, 'dry_run');
  assert.equal(mock.submissions.length, 0);
  assert.ok(r.filled.length >= 10);
  assert.ok(shots.includes('ready'));
});

test('unknown required question → needs_you and nothing is submitted', async () => {
  await fetch(`${mock.url}/__reset`);
  const r = await run('/gh/mockco/jobs/2');
  assert.equal(r.status, 'needs_you');
  assert.match(r.reason, /Why do you want to work at MockCo/);
  assert.equal(mock.submissions.length, 0);
});

test('with Claude (stubbed), a supported answer is filled and the application goes through', async () => {
  await fetch(`${mock.url}/__reset`);
  const calls = [];
  const stub = { messages: { create: async (b) => { calls.push(b); return { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ answers: [{ id: JSON.parse(b.messages[0].content.match(/<questions>\n([\s\S]*?)\n<\/questions>/)[1])[0].id, answer: 'I want to build NLP products like the churn models I built at Acme Analytics.', confidence: 'high' }] }) }] }; } },
    beta: { messages: { create: async (b) => stub.messages.create(b) } } };
  const r = await run('/gh/mockco/jobs/2', { client: stub });
  assert.equal(r.status, 'applied', JSON.stringify(r));
  assert.match(mock.submissions.at(-1).fields.q_why, /NLP products/);
  assert.match(calls[0].system, /Never invent/);
  assert.ok(calls[0].messages[0].content.includes('<job_description'));       // job text is passed as delimited data
});

test('low-confidence Claude answers are not used', async () => {
  await fetch(`${mock.url}/__reset`);
  const stub = { messages: { create: async (b) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ answers: [{ id: JSON.parse(b.messages[0].content.match(/<questions>\n([\s\S]*?)\n<\/questions>/)[1])[0].id, answer: 'maybe?', confidence: 'low' }] }) }] }) }, };
  stub.beta = { messages: { create: stub.messages.create } };
  const r = await run('/gh/mockco/jobs/2', { client: stub });
  assert.equal(r.status, 'needs_you');
  assert.equal(mock.submissions.length, 0);
});

test('Lever-style form (radios, label-wrapped inputs, URLs)', async () => {
  await fetch(`${mock.url}/__reset`);
  const r = await run('/lever/mockco/lv1/apply');
  assert.equal(r.status, 'applied', JSON.stringify(r));
  const s = mock.submissions.at(-1);
  assert.equal(s.fields.name, 'Jane Role');
  assert.equal(s.fields.org, 'Acme Analytics');
  assert.equal(s.fields['urls[LinkedIn]'], 'https://linkedin.com/in/jane-role');
  assert.equal(s.fields['cards[0]'], 'No');     // sponsorship
  assert.equal(s.fields['cards[1]'], 'Yes');    // relocate
});

test('Lever job page → clicks “Apply” first', async () => {
  await fetch(`${mock.url}/__reset`);
  const r = await run('/lever/mockco/lv1');
  assert.equal(r.status, 'applied', JSON.stringify(r));
});

test('Ashby-style form', async () => {
  await fetch(`${mock.url}/__reset`);
  const r = await run('/ashby/mockco/ab1/application');
  assert.equal(r.status, 'applied', JSON.stringify(r));
  const s = mock.submissions.at(-1);
  assert.equal(s.fields._systemfield_name, 'Jane Role');
  assert.equal(s.fields.location, 'Pune, India');
  assert.equal(s.fields.yoe, '1');
});

test('captcha: reported as needs_you and not submitted', async () => {
  await fetch(`${mock.url}/__reset`);
  const r = await run('/lever/mockco/lv2/apply');
  assert.equal(r.status, 'needs_you');
  assert.match(r.reason, /captcha/i);
  assert.equal(mock.submissions.length, 0);
});

test('closed posting is recognised', async () => {
  const r = await run('/gh/mockco/jobs/4', { timeouts: { form: 8000 } });
  assert.equal(r.status, 'closed');
});
