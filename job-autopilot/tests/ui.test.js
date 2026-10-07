import test from 'node:test';
import assert from 'node:assert/strict';
import { startUi } from './ui/harness.js';
import { all, state } from './ui/fixture.js';

let ui;
test.before(async () => { ui = await startUi(); });
test.after(async () => { await ui?.close(); });
const calls = (page) => page.evaluate(() => window.__calls);
const called = async (page, name) => (await calls(page)).filter((c) => c[0] === name);

test('every screen renders without script errors (light and dark)', async () => {
  for (const dark of [false, true]) for (const route of ['today', 'jobs', 'approvals', 'needs', 'pipeline', 'insights', 'profile', 'answers', 'sources', 'settings', 'activity', 'applications']) {
    const p = await ui.open(all, { route, dark });
    await p.page.waitForTimeout(150);
    assert.deepEqual(p.errors, [], `${route}${dark ? ' (dark)' : ''}`);
    assert.ok((await p.page.locator('#view').innerText()).length > 40, `${route} is empty`);
    await p.close();
  }
});

test('first run shows the welcome screen and the insights empty state', async () => {
  const empty = { ...all, state: state({ profile: { ...all.state.profile, hasResume: false }, counts: { ...all.state.counts, appliedTotal: 0, matches: 0, dryRuns: 0 } }), jobs: [], apps: [], insights: { ...all.insights, totals: { ...all.insights.totals, applied: 0, matches: 0 } } };
  let p = await ui.open(empty, { route: 'today' });
  assert.match(await p.page.locator('#view').innerText(), /Start with your resume/);
  await p.close();
  p = await ui.open(empty, { route: 'insights' });
  assert.match(await p.page.locator('#view').innerText(), /Nothing to chart yet/); await p.close();
});

test('Today surfaces what needs attention', async () => {
  const p = await ui.open(all, { route: 'today' });
  const t = await p.page.locator('#view').innerText();
  assert.match(t, /2 waiting for your approval/); assert.match(t, /1 needs you/); assert.match(t, /Interview: Razorpay/); assert.match(t, /1 follow-up due/);
  assert.match(await p.page.locator('#nav').innerText(), /Approvals\s*2/);
  await p.close();
});

test('approvals: approve, reject and approve-all call the right APIs', async () => {
  const p = await ui.open(all, { route: 'approvals' });
  await p.page.locator('[data-act="approve"][data-id="j5"]').click();
  await p.page.waitForTimeout(100);
  assert.equal((await called(p.page, 'job:approve'))[0][1], 'j5');
  await p.page.locator('[data-act="skipjob"][data-id="j6"]').click(); await p.page.waitForTimeout(100);
  assert.equal((await called(p.page, 'job:skip'))[0][1], 'j6');
  await p.page.locator('[data-act="approveall"]').click();
  await p.page.locator('dialog.modal button', { hasText: 'Approve all' }).click(); await p.page.waitForTimeout(300);
  assert.equal((await called(p.page, 'job:approve')).length, 1 + 2);
  await p.close();
});

test('approvals: cover letter preview and the approval-mode switch', async () => {
  const p = await ui.open(all, { route: 'approvals' });
  await p.page.locator('[data-act="coverpreview"][data-id="j5"]').click();
  assert.match(await p.page.locator('dialog.modal').innerText(), /Hello Postman team/);
  await p.page.locator('dialog.modal button', { hasText: 'Close' }).click();
  await p.page.locator('[data-sb="approval"]').evaluate((el) => { el.checked = false; el.dispatchEvent(new Event('change', { bubbles: true })); });
  await p.page.waitForTimeout(500);
  assert.deepEqual((await called(p.page, 'settings:save'))[0][1], { approval: false });
  await p.close();
});

test('jobs: manual sites show "Open to apply", salary chips, feedback buttons and filters', async () => {
  const p = await ui.open(all, { route: 'jobs' });
  const row = p.page.locator('.job', { hasText: 'Machine Learning Engineer – Fraud' });
  assert.match(await row.innerText(), /Open to apply/); assert.match(await row.innerText(), /Apply yourself/);
  assert.match(await p.page.locator('.job', { hasText: 'Razorpay' }).innerText(), /12 LPA–18 LPA/);
  await row.locator('[data-act="manualdone"]').click(); await p.page.waitForTimeout(80);
  assert.equal((await called(p.page, 'job:manualApplied'))[0][1], 'j4');
  await p.page.locator('.job', { hasText: 'Razorpay' }).locator('[data-act="likejob"]').click(); await p.page.waitForTimeout(80);
  assert.deepEqual((await called(p.page, 'job:feedback'))[0][1], { id: 'j1', verdict: 'up' });
  await p.page.locator('[data-act="jobtab"][data-k="manual"]').click();
  assert.equal(await p.page.locator('.job').count(), 1);
  await p.page.locator('[data-act="jobtab"][data-k="all"]').click();
  await p.page.selectOption('#jobsort', 'pay');
  assert.match(await p.page.locator('.job h3').first().innerText(), /Applied AI Engineer/);   // highest stated pay first
  await p.close();
});

test('pipeline: columns, drag & drop, stage select, interview date prompt', async () => {
  const p = await ui.open(all, { route: 'pipeline' });
  const col = (k) => p.page.locator(`.pcol[data-stage="${k}"]`);
  assert.equal(await col('interview').locator('.pcard').count(), 1); assert.equal(await col('applied').locator('.pcard').count(), 3);
  assert.match(await p.page.locator('.pcard', { hasText: 'Freshworks' }).innerText(), /Follow up/);
  assert.match(await p.page.locator('.pcard', { hasText: 'Razorpay' }).innerText(), /from email/);
  // drag Cred (applied) → Heard back
  await p.page.locator('.pcard', { hasText: 'Cred' }).dragTo(col('replied')); await p.page.waitForTimeout(150);
  assert.deepEqual((await called(p.page, 'app:stage'))[0][1], { id: 'a24', stage: 'replied', interviewAt: undefined });
  // select → Interview opens the date prompt
  await p.page.locator('.pcard', { hasText: 'Visa' }).locator('select').selectOption('interview');
  await p.page.locator('dialog.modal #ivAt').fill('2026-11-03T10:30');
  await p.page.locator('dialog.modal button', { hasText: 'Save' }).click(); await p.page.waitForTimeout(150);
  const last = (await called(p.page, 'app:stage')).at(-1)[1];
  assert.equal(last.id, 'a26'); assert.equal(last.stage, 'interview'); assert.match(last.interviewAt, /^2026-11-03T/);
  await p.close();
});

test('pipeline: follow-up draft, detail dialog (notes, prep, calendar) and history view', async () => {
  const p = await ui.open(all, { route: 'pipeline' });
  await p.page.locator('[data-act="followdraft"]').click();
  assert.match(await p.page.locator('dialog.modal').innerText(), /Follow-up message/);
  assert.match(await p.page.locator('dialog.modal #fuB').inputValue(), /Hello team/);
  await p.page.locator('dialog.modal button', { hasText: 'Close' }).click();
  await p.page.locator('[data-act="snooze"]').click(); await p.page.waitForTimeout(80);
  assert.equal((await called(p.page, 'app:snooze'))[0][1], 'a23');
  await p.page.locator('.pcard', { hasText: 'Razorpay' }).locator('[data-act="pdetail"]').click();
  const dlg = p.page.locator('dialog.modal');
  assert.match(await dlg.innerText(), /found in your email/); assert.match(await dlg.innerText(), /Interview invitation/);
  await dlg.locator('#pdNote').fill('Recruiter: Anita'); await dlg.locator('button', { hasText: 'Add to calendar' }).click(); await p.page.waitForTimeout(150);
  assert.deepEqual((await called(p.page, 'app:note'))[0][1], { id: 'a21', note: 'Recruiter: Anita' });
  assert.equal((await called(p.page, 'app:ics'))[0][1], 'a21');
  await p.page.locator('.pcard', { hasText: 'Razorpay' }).locator('[data-act="pdetail"]').click();
  await p.page.locator('dialog.modal button', { hasText: 'Interview prep' }).click();
  await p.page.waitForSelector('.prep h4');
  assert.match(await p.page.locator('.prep').innerText(), /Likely questions/); assert.equal(await p.page.locator('.prep b').first().innerText(), 'a project');
  await p.page.locator('dialog.modal button', { hasText: 'Close' }).click();
  await p.page.locator('[data-act="pipeview"][data-k="history"]').click();
  assert.ok(await p.page.locator('table.tx tbody tr').count() >= 8);
  await p.close();
});

test('needs you: teach an answer once → saved and the application is retried', async () => {
  const p = await ui.open(all, { route: 'needs' });
  await p.page.locator('[data-teach]').fill('I like Zeta’s payments focus.');
  await p.page.locator('[data-act="teach"]').click(); await p.page.waitForTimeout(200);
  assert.deepEqual((await called(p.page, 'answer:save'))[0][1], { match: 'Why do you want to work at Zeta?', answer: 'I like Zeta’s payments focus.' });
  assert.equal((await called(p.page, 'app:retry'))[0][1], 'a10');
  await p.close();
});

test('insights shows real numbers; settings exposes new controls; palette works from the keyboard', async () => {
  let p = await ui.open(all, { route: 'insights' });
  const t = await p.page.locator('#view').innerText();
  assert.match(t, /Applications sent\s*\n?\s*7/); assert.match(t, /57%/); assert.match(t, /Funnel/); assert.match(t, /Which systems reply/);
  assert.ok(await p.page.locator('svg.chart rect').count() > 3);
  await p.close();
  p = await ui.open(all, { route: 'settings' });
  const s = await p.page.locator('#view').innerText();
  for (const w of ['Ask me before applying', 'Ignore postings older than', 'Read replies from your inbox', 'Export applications \\(CSV\\)', 'encrypted with your Windows account']) assert.match(s, new RegExp(w));
  await p.page.locator('[data-act="testinbox"]').click(); await p.page.waitForTimeout(100);
  assert.equal((await called(p.page, 'inbox:test')).length, 1);
  await p.page.keyboard.press('Control+k');
  await p.page.waitForSelector('#pq');
  await p.page.keyboard.type('insi'); await p.page.keyboard.press('Enter'); await p.page.waitForTimeout(300);
  assert.match(await p.page.evaluate(() => location.hash), /insights/);
  await p.page.keyboard.press('Control+k'); await p.page.keyboard.type('Razorpay'); assert.match(await p.page.locator('#plist').innerText(), /Machine Learning Engineer – Razorpay/);
  await p.page.keyboard.press('Escape'); assert.equal(await p.page.locator('#palette').isHidden(), true);
  await p.close();
});

test('theme choice is remembered', async () => {
  const p = await ui.open(all, { route: 'today' });
  await p.page.locator('#themeBtn').click();
  const t1 = await p.page.evaluate(() => [document.documentElement.dataset.theme, localStorage.getItem('ja-theme')]);
  assert.equal(t1[0], t1[1]); assert.ok(['dark', 'light'].includes(t1[0]));
  await p.close();
});

test('answers screen: pending questions, answer-once flow, bank autosave, own Q&A', async () => {
  const p = await ui.open(all, { route: 'answers' });
  const t = await p.page.locator('#view').innerText();
  assert.match(t, /Are you willing to work night shifts\?/); assert.match(t, /seen 3×/); assert.match(t, /choices: Yes · No/);
  assert.match(await p.page.locator('#nav').innerText(), /Answers\s*2/);
  // answer a pending question with Enter
  await p.page.locator('[data-qasave="q1"]').fill('Yes'); await p.page.keyboard.press('Enter'); await p.page.waitForTimeout(150);
  assert.deepEqual((await called(p.page, 'qa:save'))[0][1], { id: 'q1', answer: 'Yes' });
  // a built-in question type: typing autosaves
  await p.page.locator('[data-act="qatab"][data-k="all"]').click();
  await p.page.locator('details.qgroup', { hasText: 'Address' }).locator('summary').click();
  const pin = p.page.locator('[data-qabank="postal"]'); assert.equal(await pin.inputValue(), '600001');
  await p.page.locator('[data-qabank="address"]').fill('12 Anna Salai'); await p.page.waitForTimeout(700);
  assert.deepEqual((await called(p.page, 'qa:bank')).at(-1)[1], { id: 'address', answer: '12 Anna Salai' });
  assert.equal(await p.page.locator('[data-qabank="notice_period"]').getAttribute('placeholder'), '30 days');   // derived default shown
  // own Q&A tab: add + learned-from-Claude flagged for review
  await p.page.locator('[data-act="qatab"][data-k="mine"]').click();
  assert.match(await p.page.locator('#view').innerText(), /From Claude – please review/);
  await p.page.locator('input[name="question"]').fill('Do you own a car?'); await p.page.locator('input[name="answer"]').fill('No'); await p.page.locator('[data-form="qaadd"] button').click(); await p.page.waitForTimeout(150);
  assert.deepEqual((await called(p.page, 'qa:add'))[0][1], { question: 'Do you own a car?', answer: 'No' });
  await p.page.locator('[data-qasave="q3"]').fill('No'); await p.page.locator('[data-qasave="q3"]').blur(); await p.page.waitForTimeout(150);
  assert.deepEqual((await called(p.page, 'qa:save')).at(-1)[1], { id: 'q3', answer: 'No' });
  await p.page.locator('[data-act="qadel"][data-id="q4"]').click(); await p.page.waitForTimeout(100);
  assert.equal((await called(p.page, 'qa:delete'))[0][1], 'q4');
  await p.close();
});

test('dry run is explained clearly; Rehearse / Watch buttons; settings toggles for watching and experimental sites', async () => {
  const dry = { ...all, state: state({ settings: { ...all.state.settings, mode: 'dry', approval: false } }) };
  let p = await ui.open(dry, { route: 'jobs', respond: { 'job:apply': { ok: true, app: { status: 'dry_run', reason: 'Form filled correctly – NOT submitted because Dry run is on' } } } });
  const t = await p.page.locator('#view').innerText();
  assert.match(t, /You are in Dry run/); assert.match(t, /does\s+not\s+submit/); assert.match(t, /Rehearse/);
  await p.page.locator('[data-act="watchjob"][data-id="j1"]').click(); await p.page.waitForTimeout(100);
  assert.equal((await called(p.page, 'job:watch'))[0][1], 'j1');
  await p.page.locator('[data-act="applyjob"][data-id="j1"]').click(); await p.page.waitForTimeout(200);
  assert.equal((await called(p.page, 'job:apply'))[0][1].mode, 'dry');
  assert.match(await p.page.locator('#toast').innerText(), /not submitted|NOT submitted|Rehearsal/i);
  await p.close();
  p = await ui.open(all, { route: 'settings' });
  assert.match(await p.page.locator('#view').innerText(), /Show the application window while it works/); assert.match(await p.page.locator('#view').innerText(), /sites the app was never tested on/);
  await p.page.locator('[data-sb="showBrowser"]').evaluate((el) => { el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true })); }); await p.page.waitForTimeout(500);
  assert.deepEqual((await called(p.page, 'settings:save')).at(-1)[1], { showBrowser: true });
  await p.close();
  p = await ui.open(all, { route: 'jobs' });
  assert.doesNotMatch(await p.page.locator('#view').innerText(), /You are in Dry run/);       // no banner in Live mode
  await p.close();
});
