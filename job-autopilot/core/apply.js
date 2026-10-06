// One application, start to finish, through a "driver" (a controllable browser page).
// Driver interface: goto(url) · eval(code) → value · setFiles(selector, [paths]) · screenshot() → Buffer · url() · close()
import { INPAGE } from './inpage.js';
import { resolve, unresolved } from './answers.js';
import { answerQuestions, coverLetter as makeCoverLetter } from './llm.js';
import { sleep } from './util.js';

const CLOSED = /no longer (available|accepting)|position (has been|is) (filled|closed)|job (is )?(no longer|not found|has expired)|this (job|posting|position) (has|is) (expired|closed)|page (you are looking for|not found)|404/i;

export async function applyToJob({ driver, job, profile, settings, client = null, mode = 'dry', step = () => {}, saveShot = async () => '', timeouts = {} }) {
  const T = { form: 25000, confirm: 30000, ...timeouts };
  const out = { status: 'failed', reason: '', filled: [], missing: [], captcha: null, screenshot: '', url: job.applyUrl, source: {} };
  const call = async (code, retry = true) => {
    try { return await driver.eval(code); }
    catch (e) {
      if (!retry) throw e;
      await sleep(400);
      await driver.eval(INPAGE).catch(() => {});
      return call(code, false);
    }
  };
  const ja = (expr) => call(`window.__JA ? (${expr}) : null`);

  try {
    step(`Opening ${job.applyUrl}`);
    await driver.goto(job.applyUrl);
    await driver.eval(INPAGE);

    // 1) wait for the form (some sites need an "Apply" click first)
    const t0 = Date.now();
    let state = null, clicked = false;
    while (Date.now() - t0 < T.form) {
      await driver.eval(INPAGE).catch(() => {});
      state = await ja('__JA.state()');
      if (state && (state.fields >= 3 || (state.hasFile && state.fields >= 2))) break;
      if (state?.applyLink && !clicked) { step('Clicking “Apply”'); clicked = true; await ja('__JA.clickApply()'); await sleep(1200); continue; }
      const body = await call('document.body ? document.body.innerText.slice(0, 1500) : ""').catch(() => '');
      if (CLOSED.test(body) && Date.now() - t0 > 2500) { out.status = 'closed'; out.reason = 'The posting is closed or was removed'; return out; }
      await sleep(600);
    }
    if (!state || state.fields < 2) { out.status = 'needs_you'; out.reason = 'Could not find an application form on the page'; out.screenshot = await saveShot(await driver.screenshot().catch(() => null), 'noform'); return out; }
    out.url = state.url;

    // 2) read the form
    let fields = await ja('__JA.scan()');
    step(`Found ${fields.length} fields`);

    // 3) cover letter (only generate when a field asks for one)
    let coverLetter = '';
    if (fields.some((f) => /cover letter|covering letter/i.test(f.label) && f.type !== 'file')) coverLetter = await makeCoverLetter({ client, settings, profile, job });
    const ctx = { profile, job, coverLetter };

    // 4) deterministic answers
    for (const f of fields) {
      const r = resolve(f, ctx);
      if (!r) continue;
      if (r.skip) { out.source[f.label || f.id] = `skipped: ${r.why}`; continue; }
      try {
        if (r.upload) {
          const sel = await ja(`__JA.markUpload(${JSON.stringify(f.id)}, "resume")`);
          if (!sel) throw new Error('upload field vanished');
          await driver.setFiles(sel, [r.value]);
          out.filled.push({ label: f.label || 'Resume', value: profile.resumePath.split(/[\\/]/).pop(), source: 'profile' });
        } else {
          const res = await ja(`__JA.set(${JSON.stringify(f.id)}, ${JSON.stringify(r.value)})`);
          if (res?.ok) out.filled.push({ label: f.label, value: String(res.value ?? r.value).slice(0, 80), source: r.source });
          else out.missing.push({ label: f.label, why: res?.why || 'could not set value' });
        }
      } catch (e) { out.missing.push({ label: f.label, why: e.message }); }
    }

    // 5) questions we could not answer from facts: ask Claude (grounded in the resume) – required ones only
    const rest = unresolved(fields, ctx).filter((f) => f.required);
    if (rest.length && client) {
      step(`Asking Claude about ${rest.length} question(s)`);
      try {
        const answers = await answerQuestions({ client, settings, profile, job, questions: rest });
        for (const f of rest) {
          const a = answers.get(f.id);
          if (!a || a.confidence !== 'high') continue;
          const res = await ja(`__JA.set(${JSON.stringify(f.id)}, ${JSON.stringify(a.answer)})`);
          if (res?.ok) out.filled.push({ label: f.label, value: String(res.value ?? a.answer).slice(0, 80), source: 'claude' });
        }
      } catch (e) { step(`Claude unavailable: ${e.message}`); }
    }

    // 6) everything required must be filled – never submit a half-empty application
    await sleep(300);
    const left = await ja('__JA.unfilled()');
    if (left.length) {
      out.missing.push(...left.map((f) => ({ label: f.label, why: 'needs your answer' })));
      out.status = 'needs_you';
      out.reason = `Needs your answer: ${left.map((f) => f.label || f.name).slice(0, 5).join('; ')}`;
      out.screenshot = await saveShot(await driver.screenshot().catch(() => null), 'incomplete');
      return out;
    }

    out.captcha = await ja('__JA.captcha()');
    out.screenshot = await saveShot(await driver.screenshot().catch(() => null), 'ready');

    // 7) dry run stops here
    if (mode !== 'live') { out.status = 'dry_run'; out.reason = `Form filled correctly – not submitted (dry run)${out.captcha?.present ? ' · a captcha is present' : ''}`; return out; }

    // 8) submit
    if (out.captcha?.challengeVisible) { out.status = 'needs_you'; out.reason = 'A captcha challenge is showing – open the page and solve it'; return out; }
    step('Submitting');
    const s = await ja('__JA.submit()');
    if (!s?.clicked) { out.status = 'needs_you'; out.reason = 'Could not find the submit button'; return out; }

    const t1 = Date.now();
    let errors = [];
    while (Date.now() - t1 < T.confirm) {
      await sleep(900);
      await driver.eval(INPAGE).catch(() => {});
      const c = await ja('__JA.confirmation()').catch(() => null);
      if (!c) continue;
      if (c.done) { out.status = 'applied'; out.reason = 'Submitted and confirmed by the site'; out.url = c.url; out.screenshot = await saveShot(await driver.screenshot().catch(() => null), 'confirmed'); return out; }
      errors = c.errors;
      const cap = await ja('__JA.captcha()').catch(() => null);
      if (cap?.challengeVisible) { out.status = 'needs_you'; out.reason = 'The site showed a captcha – open the page and finish it'; out.screenshot = await saveShot(await driver.screenshot().catch(() => null), 'captcha'); return out; }
      if (errors.length && Date.now() - t1 > 3500) break;
    }
    out.screenshot = await saveShot(await driver.screenshot().catch(() => null), 'after');
    if (errors.length) { out.status = 'needs_you'; out.reason = `The site rejected the form: ${errors.slice(0, 3).join(' | ')}`; return out; }
    const now = await driver.url().catch(() => '');
    out.status = 'unconfirmed'; out.reason = `Submitted but no confirmation text was detected${now && now !== state.url ? ' (page changed)' : ''} – check your email`;
    return out;
  } catch (e) {
    out.status = 'failed'; out.reason = e.message || String(e);
    return out;
  }
}
