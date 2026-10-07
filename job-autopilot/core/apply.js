// One application, start to finish, through a "driver" (a controllable browser page).
// Driver interface: goto(url) · eval(code) → value · setFiles(selector, [paths]) · screenshot() → Buffer · url() · close()
//
// Flow: open the page → (click "Apply" / follow an embedded form / spot account walls) → for every step of the form:
// fill every field from your profile & answer bank (then Claude for the rest, strictly from your resume) → check that every
// required field is really filled → press "Next" … → at the final step: dry run stops, live mode submits and waits for the
// site's confirmation. It never submits a form with a required field still empty.
import { INPAGE } from './inpage.js';
import { resolve, unresolved, reusable } from './answers.js';
import { answerQuestions, coverLetter as makeCoverLetter } from './llm.js';
import { sleep } from './util.js';

const CLOSED = /no longer (available|accepting)|position (has been|is) (filled|closed)|job (is )?(no longer|not found|has expired)|this (job|posting|position) (has|is) (expired|closed)|page (you are looking for|not found)|404/i;
const MAX_STEPS = 8;

export async function applyToJob({ driver, job, profile, settings, client = null, mode = 'dry', step = () => {}, saveShot = async () => '', timeouts = {} }) {
  const T = { form: 25000, confirm: 30000, frame: 6000, stepChange: 9000, ...timeouts };
  const out = { status: 'failed', reason: '', filled: [], missing: [], unanswered: [], learned: [], captcha: null, screenshot: '', url: job.applyUrl, source: {}, steps: 0 };
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
  const shot = async (tag) => saveShot(await driver.screenshot().catch(() => null), tag);
  const embedBase = (settings?.sourceBase?.greenhouseEmbed || 'https://job-boards.greenhouse.io').replace(/\/$/, '');

  try {
    step(`Opening ${job.applyUrl}`);
    await driver.goto(job.applyUrl);
    await driver.eval(INPAGE);

    // ───── 1) get to the form (some sites need an "Apply" click first, some embed the form in an iframe, some want an account) ─────
    const t0 = Date.now();
    let state = null, clicked = false, frameTried = false, embedTried = false;
    while (Date.now() - t0 < T.form) {
      await driver.eval(INPAGE).catch(() => {});
      state = await ja('__JA.state()');
      const elapsed = Date.now() - t0;
      if (state && (state.fields >= 3 || (state.hasFile && state.fields >= 2))) break;
      if (state?.account && elapsed > 2500) { out.status = 'needs_you'; out.reason = 'This site wants you to sign in or create an account first – open it and apply yourself'; out.screenshot = await shot('account'); return out; }
      if (state?.applyLink && !clicked) { step('Clicking “Apply”'); clicked = true; await ja('__JA.clickApply()'); await sleep(1200); continue; }
      const body = await call('document.body ? document.body.innerText.slice(0, 1500) : ""').catch(() => '');
      if (CLOSED.test(body) && elapsed > 2500) { out.status = 'closed'; out.reason = 'The posting is closed or was removed'; return out; }
      if (elapsed > T.frame && !frameTried) {
        frameTried = true;
        const src = await ja('__JA.iframeTarget()').catch(() => null);
        if (src) { step('The form is embedded – opening it directly'); await driver.goto(src); await driver.eval(INPAGE); continue; }
      }
      if (elapsed > T.frame && !embedTried && job.ats === 'greenhouse' && job.token && /\d+$/.test(String(job.id || ''))) {
        embedTried = true;
        step('Trying the Greenhouse application form directly');
        await driver.goto(`${embedBase}/embed/job_app?for=${encodeURIComponent(job.token)}&token=${String(job.id).split(':').pop()}`); await driver.eval(INPAGE); continue;
      }
      await sleep(600);
    }
    if (!state || state.fields < 2) { out.status = 'needs_you'; out.reason = 'Could not find an application form on the page'; out.screenshot = await shot('noform'); return out; }
    out.url = state.url;

    // ───── 2) every step of the form ─────
    let coverLetter = '';
    let lastAction = { kind: null };
    for (let n = 1; n <= MAX_STEPS; n++) {
      out.steps = n;
      let fields = await ja('__JA.scan()');
      step(`Step ${n}: found ${fields.length} fields`);

      // resume first (many sites auto-fill other boxes from it, so wait for that before typing our own values)
      let uploaded = false;
      for (const f of fields.filter((x) => x.type === 'file' && !x.value)) {
        const r = resolve(f, { profile, job, coverLetter, settings });
        if (!r?.upload) continue;
        try {
          const sel = await ja(`__JA.markUpload(${JSON.stringify(f.id)}, "resume")`);
          if (!sel) throw new Error('upload field vanished');
          await driver.setFiles(sel, [r.value]);
          out.filled.push({ label: f.label || 'Resume', value: profile.resumePath.split(/[\\/]/).pop(), source: 'profile' }); uploaded = true;
        } catch (e) { out.missing.push({ label: f.label, why: e.message }); }
      }
      if (uploaded) { await sleep(1800); fields = await ja('__JA.scan()'); }

      // custom drop-downs only show their choices when opened: read them so answers are chosen against the real wording
      for (const f of fields) if (f.type === 'combobox' && f.button && !f.options) { const o = await ja(`__JA.readOptions(${JSON.stringify(f.id)})`).catch(() => []); if (o?.length) f.options = o.map((t) => ({ text: t, value: t })); }

      // cover letter (only generate when a field asks for one)
      if (!coverLetter && fields.some((f) => /cover letter|covering letter/i.test(f.label) && f.type !== 'file')) coverLetter = await makeCoverLetter({ client, settings, profile, job });
      const ctx = { profile, job, coverLetter, settings };

      // deterministic answers (profile → your answer bank)
      for (const f of fields) {
        if (f.type === 'file') { const r = resolve(f, ctx); if (r?.skip) out.source[f.label || f.id] = `skipped: ${r.why}`; continue; }
        const r = resolve(f, ctx);
        if (!r) continue;
        if (r.skip) { out.source[f.label || f.id] = `skipped: ${r.why}`; continue; }
        try {
          const res = await ja(`__JA.set(${JSON.stringify(f.id)}, ${JSON.stringify(r.value)})`);
          if (res?.ok) out.filled.push({ label: f.label, value: String(res.value ?? r.value).slice(0, 80), source: r.source, ...(r.qa ? { qa: r.qa } : {}) });
          else out.missing.push({ label: f.label, why: res?.why || 'could not set value' });
        } catch (e) { out.missing.push({ label: f.label, why: e.message }); }
      }

      // questions we could not answer from facts: ask Claude (grounded in the resume) – required ones only, high confidence only
      const rest = unresolved(fields, ctx).filter((f) => f.required);
      if (rest.length && client) {
        step(`Asking Claude about ${rest.length} question(s)`);
        try {
          const answers = await answerQuestions({ client, settings, profile, job, questions: rest });
          for (const f of rest) {
            const a = answers.get(f.id);
            if (!a || a.confidence !== 'high') continue;
            const res = await ja(`__JA.set(${JSON.stringify(f.id)}, ${JSON.stringify(a.answer)})`);
            if (res?.ok) {
              out.filled.push({ label: f.label, value: String(res.value ?? a.answer).slice(0, 80), source: 'claude' });
              if (reusable(f, job)) out.learned.push({ question: f.label, answer: a.answer, kind: (f.options || []).some((o) => /^(yes|no)\b/i.test(String(o.text))) ? 'yesno' : 'text', options: (f.options || []).map((o) => o.text) });
            }
          }
        } catch (e) { step(`Claude unavailable: ${e.message}`); }
      }

      // everything required must be filled – never go on with a half-empty form
      await sleep(300);
      const left = await ja('__JA.unfilled()');
      if (left.length) {
        out.missing.push(...left.map((f) => ({ label: f.label, why: 'needs your answer' })));
        out.unanswered.push(...left.map((f) => ({ label: f.label || f.name, type: f.type, options: (f.options || []).map((o) => o.text) })));
        out.status = 'needs_you';
        out.reason = `Needs your answer: ${left.map((f) => f.label || f.name).slice(0, 5).join('; ')}`;
        out.screenshot = await shot('incomplete');
        return out;
      }

      lastAction = (await ja('__JA.action()')) || { kind: null };
      if (lastAction.kind !== 'next') break;
      if (n === MAX_STEPS) { out.status = 'needs_you'; out.reason = `The form has more than ${MAX_STEPS} steps – open it and finish yourself`; out.screenshot = await shot('steps'); return out; }

      // move on to the next step and wait until the page really changed
      step(`Step ${n} done – pressing “${lastAction.label}”`);
      const before = await ja('__JA.signature()');
      await ja(`__JA.clickAction("next")`);
      const ts = Date.now(); let changed = false;
      while (Date.now() - ts < T.stepChange) {
        await sleep(700);
        await driver.eval(INPAGE).catch(() => {});
        const sig = await ja('__JA.signature()').catch(() => null);
        if (sig && sig !== before) { changed = true; break; }
        const c = await ja('__JA.confirmation()').catch(() => null);
        if (c?.done) { changed = true; break; }
      }
      if (!changed) {
        const c = await ja('__JA.confirmation()').catch(() => null);
        out.status = 'needs_you'; out.reason = c?.errors?.length ? `The site did not accept step ${n}: ${c.errors.slice(0, 3).join(' | ')}` : `The form did not move past step ${n}`;
        out.screenshot = await shot('stuck'); return out;
      }
    }

    out.captcha = await ja('__JA.captcha()');
    out.screenshot = await shot('ready');

    // ───── 3) dry run stops here ─────
    if (mode !== 'live') { out.status = 'dry_run'; out.reason = `Form filled correctly${out.steps > 1 ? ` (${out.steps} steps)` : ''} – NOT submitted because Dry run is on${out.captcha?.present ? ' · a captcha is present' : ''}`; return out; }

    // ───── 4) submit ─────
    if (out.captcha?.challengeVisible) { out.status = 'needs_you'; out.reason = 'A captcha challenge is showing – open the page and solve it'; return out; }
    if (lastAction.kind !== 'submit') { out.status = 'needs_you'; out.reason = 'Could not find the submit button'; return out; }
    step('Submitting');
    const s = await ja('__JA.clickAction("submit")');
    if (!s?.clicked) { out.status = 'needs_you'; out.reason = 'Could not find the submit button'; return out; }

    const t1 = Date.now();
    let errors = [];
    while (Date.now() - t1 < T.confirm) {
      await sleep(900);
      await driver.eval(INPAGE).catch(() => {});
      const c = await ja('__JA.confirmation()').catch(() => null);
      if (!c) continue;
      if (c.done) { out.status = 'applied'; out.reason = 'Submitted and confirmed by the site'; out.url = c.url; out.screenshot = await shot('confirmed'); return out; }
      errors = c.errors;
      const cap = await ja('__JA.captcha()').catch(() => null);
      if (cap?.challengeVisible) { out.status = 'needs_you'; out.reason = 'The site showed a captcha – open the page and finish it'; out.screenshot = await shot('captcha'); return out; }
      if (errors.length && Date.now() - t1 > 3500) break;
    }
    out.screenshot = await shot('after');
    if (errors.length) { out.status = 'needs_you'; out.reason = `The site rejected the form: ${errors.slice(0, 3).join(' | ')}`; return out; }
    const now = await driver.url().catch(() => '');
    out.status = 'unconfirmed'; out.reason = `Submitted but no confirmation text was detected${now && now !== state.url ? ' (page changed)' : ''} – check your email`;
    return out;
  } catch (e) {
    out.status = 'failed'; out.reason = e.message || String(e);
    return out;
  }
}
