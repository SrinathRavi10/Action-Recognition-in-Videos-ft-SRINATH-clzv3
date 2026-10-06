// Code that runs INSIDE the job-application page (injected as a string). It is deliberately label-driven rather than
// tied to any one site's markup: it finds the application form, lists every control with its question text, and
// can set values the way a person would (firing the events React/Vue forms listen for).
function install() {
  if (window.__JA) return 'already';
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').replace(/[*✱]/g, '').replace(/\(?\s*required\s*\)?/gi, '').trim();
  const rawText = (n) => (n ? (n.innerText ?? n.textContent ?? '') : '');
  const vis = (el) => {
    if (!el) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  };
  const isHoneypot = (el) => /honeypot|hp_|bot-field|do-not-fill|trap/i.test(`${el.name} ${el.id} ${el.className}`) || el.tabIndex === -1 && !vis(el) && el.type !== 'file' && el.type !== 'radio' && el.type !== 'checkbox' || el.closest('[aria-hidden="true"]') && el.type !== 'file';

  function labelFor(el) {
    const bits = [];
    const lb = el.getAttribute('aria-labelledby');
    if (lb) for (const id of lb.split(/\s+/)) bits.push(rawText(document.getElementById(id)));
    if (!bits.join('').trim() && el.labels && el.labels.length) for (const l of el.labels) bits.push(rawText(l));
    if (!bits.join('').trim() && el.getAttribute('aria-label')) bits.push(el.getAttribute('aria-label'));
    if (!bits.join('').trim()) { const l = el.closest('label'); if (l) bits.push(rawText(l)); }
    if (!bits.join('').trim()) {
      const box = el.closest('.field, .form-group, .application-field, .application-question, [class*="question"], [class*="Field"], [data-qa], fieldset, li, .ashby-application-form-field-entry');
      if (box) { const h = box.querySelector('label, legend, .label, [class*="label"], h3, h4, strong'); if (h && !h.contains(el)) bits.push(rawText(h)); }
    }
    if (!bits.join('').trim()) bits.push(el.placeholder || el.name || el.id || '');
    const raw = bits.join(' ');
    return { label: clean(raw), requiredMark: /\*|✱|\brequired\b/i.test(raw) };
  }
  /** Question text for a radio / checkbox group: the nearest ancestor holding the whole group and some text that is not an option. */
  function groupLabel(el, group) {
    const fs = el.closest('fieldset'); if (fs) { const lg = fs.querySelector('legend'); if (lg) return { label: clean(rawText(lg)), requiredMark: /\*|✱|required/i.test(rawText(lg)) }; }
    const grp = el.closest('[role="radiogroup"], [role="group"]');
    if (grp) { const id = grp.getAttribute('aria-labelledby'); const t = id ? rawText(document.getElementById(id)) : grp.getAttribute('aria-label'); if (t) return { label: clean(t), requiredMark: /\*|✱|required/i.test(t) }; }
    const members = group && group.length ? group : [el];
    const optTexts = members.map((r) => optLabel(r));
    let node = members[0].parentElement;
    while (node && !members.every((r) => node.contains(r))) node = node.parentElement;
    for (let i = 0; i < 5 && node && node !== document.body; i++, node = node.parentElement) {
      const heads = [...node.querySelectorAll('legend, .label, [class*="label"], [class*="title"], [class*="question"], h1, h2, h3, h4, h5, h6, strong, label, p, span')]
        .filter((h) => !h.querySelector('input, select, textarea') && !members.some((r) => h.contains(r)) && clean(rawText(h)).length > 2 && !optTexts.some((t) => t && clean(rawText(h)) === t));
      if (heads.length) return { label: clean(rawText(heads[0])), requiredMark: /\*|✱|required/i.test(rawText(heads[0])) || !!node.querySelector('.required, .asterisk') };
    }
    return labelFor(el);
  }
  const optLabel = (el) => clean(rawText(el.labels && el.labels[0]) || rawText(el.closest('label')) || el.value);

  function formRoot() {
    const forms = [...document.forms];
    let best = null, score = 0;
    for (const f of forms) {
      const n = f.querySelectorAll('input:not([type=hidden]):not([type=search]), textarea, select').length + (f.querySelector('input[type=file]') ? 5 : 0);
      if (n > score) { best = f; score = n; }
    }
    return best && score >= 3 ? best : document.body;
  }

  let seq = 0;
  const ensureId = (el) => { if (!el.dataset.jaId) el.dataset.jaId = `ja${++seq}`; return el.dataset.jaId; };

  function scan() {
    const root = formRoot();
    const out = [];
    const seenGroups = new Set();
    for (const el of root.querySelectorAll('input, textarea, select')) {
      const t = (el.type || el.tagName).toLowerCase();
      if (['hidden', 'submit', 'button', 'image', 'reset', 'search', 'password'].includes(t)) continue;
      if (el.disabled || el.readOnly && t !== 'file') continue;
      if (t !== 'file' && t !== 'radio' && t !== 'checkbox' && !vis(el) && !el.closest('[role="combobox"]')) continue;
      if (isHoneypot(el)) continue;
      if (el.closest('[class*="react-select"] [class*="input-container"]') === null && el.getAttribute('aria-autocomplete') === 'list' && el.getAttribute('role') !== 'combobox') { /* plain autocomplete */ }
      if (t === 'radio') {
        const key = el.name || ensureId(el);
        if (seenGroups.has(key)) continue;
        seenGroups.add(key);
        const group = [...root.querySelectorAll(`input[type=radio]${el.name ? `[name="${CSS.escape(el.name)}"]` : ''}`)].filter((r) => el.name ? true : r === el);
        const g = groupLabel(el, group);
        out.push({ id: ensureId(group[0]), type: 'radio', label: g.label, name: el.name, required: group.some((r) => r.required) || g.requiredMark, options: group.map((r) => ({ id: ensureId(r), text: optLabel(r), value: r.value })), value: (group.find((r) => r.checked) || {}).value || '' });
        continue;
      }
      if (t === 'checkbox') {
        const same = el.name ? [...root.querySelectorAll(`input[type=checkbox][name="${CSS.escape(el.name)}"]`)] : [el];
        if (same.length > 1) {
          if (seenGroups.has(el.name)) continue;
          seenGroups.add(el.name);
          const g = groupLabel(el, same);
          out.push({ id: ensureId(same[0]), type: 'checkboxgroup', label: g.label, name: el.name, required: same.some((r) => r.required) || g.requiredMark, options: same.map((r) => ({ id: ensureId(r), text: optLabel(r), value: r.value })), value: same.filter((r) => r.checked).map((r) => r.value) });
        } else {
          const l = labelFor(el);
          out.push({ id: ensureId(el), type: 'checkbox', label: l.label || optLabel(el), name: el.name, required: el.required || l.requiredMark, value: el.checked });
        }
        continue;
      }
      const l = labelFor(el);
      const f = { id: ensureId(el), label: l.label, name: el.name || '', placeholder: el.placeholder || '', required: el.required || el.getAttribute('aria-required') === 'true' || l.requiredMark };
      if (t === 'file') { out.push({ ...f, type: 'file', accept: el.accept || '', multiple: el.multiple, value: el.files ? el.files.length : 0 }); continue; }
      if (el.tagName === 'SELECT') { out.push({ ...f, type: 'select', options: [...el.options].filter((o) => o.value !== '' || o.text.trim()).map((o) => ({ value: o.value, text: clean(o.text) })), value: el.value }); continue; }
      if (el.tagName === 'TEXTAREA') { out.push({ ...f, type: 'textarea', maxLength: el.maxLength > 0 ? el.maxLength : 0, value: el.value }); continue; }
      const combo = el.getAttribute('role') === 'combobox' || el.getAttribute('aria-haspopup') === 'listbox' || !!el.closest('[class*="select__"], [class*="react-select"]');
      out.push({ ...f, type: combo ? 'combobox' : (['email', 'tel', 'url', 'number', 'date'].includes(t) ? t : 'text'), value: el.value });
    }
    return out;
  }

  const byId = (id) => document.querySelector(`[data-ja-id="${id}"]`);
  const fire = (el, names) => names.forEach((n) => el.dispatchEvent(new Event(n, { bubbles: true })));
  const setNative = (el, v) => {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
  };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const same = (a, b) => clean(a).toLowerCase() === clean(b).toLowerCase();

  async function set(id, value) {
    const el = byId(id);
    if (!el) return { ok: false, why: 'field not found' };
    const t = (el.type || el.tagName).toLowerCase();
    el.scrollIntoView({ block: 'center' });
    if (el.tagName === 'SELECT') {
      const opts = [...el.options];
      const want = String(value);
      const o = opts.find((x) => same(x.text, want) || same(x.value, want)) || opts.find((x) => clean(x.text).toLowerCase().includes(want.toLowerCase()) && x.value !== '') || opts.find((x) => want.toLowerCase().includes(clean(x.text).toLowerCase()) && clean(x.text).length > 2 && x.value !== '');
      if (!o) return { ok: false, why: `no option matches “${want}”` };
      setNative(el, o.value); fire(el, ['input', 'change', 'blur']);
      return { ok: true, value: o.text };
    }
    if (t === 'radio') {
      const group = el.name ? [...document.querySelectorAll(`input[type=radio][name="${CSS.escape(el.name)}"]`)] : [el];
      const want = String(value);
      const r = group.find((x) => same(optLabel(x), want) || same(x.value, want)) || group.find((x) => clean(optLabel(x)).toLowerCase().startsWith(want.toLowerCase())) || group.find((x) => clean(optLabel(x)).toLowerCase().includes(want.toLowerCase()));
      if (!r) return { ok: false, why: `no option matches “${want}”` };
      (r.labels && r.labels[0] ? r.labels[0] : r).click();
      if (!r.checked) r.click();
      return { ok: r.checked, value: optLabel(r) };
    }
    if (t === 'checkbox') {
      const want = Array.isArray(value) ? value : [value];
      const group = el.name ? [...document.querySelectorAll(`input[type=checkbox][name="${CSS.escape(el.name)}"]`)] : [el];
      if (group.length === 1) { const on = want[0] === true || /^(true|yes)$/i.test(String(want[0])); if (el.checked !== on) el.click(); return { ok: el.checked === on, value: on }; }
      for (const c of group) { const on = want.some((w) => same(optLabel(c), w) || same(c.value, w)); if (c.checked !== on) c.click(); }
      return { ok: true, value: want };
    }
    if (el.getAttribute('role') === 'combobox' || el.getAttribute('aria-haspopup') === 'listbox' || el.closest('[class*="select__"], [class*="react-select"]')) {
      el.focus(); el.click();
      setNative(el, String(value)); fire(el, ['input']);
      await wait(450);
      const options = [...document.querySelectorAll('[role="option"], [class*="option"]')].filter(vis);
      const want = String(value).toLowerCase();
      const o = options.find((x) => same(rawText(x), value)) || options.find((x) => clean(rawText(x)).toLowerCase().includes(want)) || (options.length === 1 ? options[0] : null);
      if (o) { o.click(); fire(el, ['change', 'blur']); return { ok: true, value: clean(rawText(o)) }; }
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
      return { ok: false, why: 'no dropdown option matched' };
    }
    el.focus();
    setNative(el, String(value));
    fire(el, ['input', 'change', 'blur']);
    return { ok: el.value === String(value), value: el.value };
  }

  function markUpload(id, tag) { const el = byId(id); if (!el) return null; el.setAttribute('data-ja-upload', tag); return `[data-ja-upload="${tag}"]`; }

  function unfilled() {
    return scan().filter((f) => f.required && (f.type === 'checkboxgroup' ? !(f.value || []).length : f.type === 'radio' ? !f.value : f.type === 'checkbox' ? !f.value : f.type === 'file' ? !f.value : !String(f.value || '').trim() || (f.type === 'select' && /^(select|choose|please)/i.test(String(f.value)))));
  }

  function captcha() {
    const hits = [];
    for (const f of document.querySelectorAll('iframe')) { const s = f.src || ''; if (/recaptcha|hcaptcha|turnstile|challenges\.cloudflare|arkoselabs|funcaptcha/i.test(s)) hits.push({ kind: (s.match(/recaptcha|hcaptcha|turnstile|arkose/i) || ['captcha'])[0].toLowerCase(), visible: vis(f) && f.getBoundingClientRect().height > 80 }); }
    for (const e of document.querySelectorAll('.g-recaptcha, .h-captcha, .cf-turnstile, [data-sitekey]')) hits.push({ kind: 'widget', visible: vis(e) && e.getBoundingClientRect().height > 40 });
    return { present: hits.length > 0, challengeVisible: hits.some((h) => h.visible), kinds: [...new Set(hits.map((h) => h.kind))] };
  }

  function submit() {
    const root = formRoot();
    const btns = [...root.querySelectorAll('button, input[type=submit], a[role=button]')].filter(vis);
    const b = btns.find((x) => x.type === 'submit') || btns.find((x) => /submit|apply|send( application)?|finish/i.test(rawText(x) || x.value) && !/cancel|back|save for later|share|sign in|log in/i.test(rawText(x)));
    if (!b) return { clicked: false };
    b.scrollIntoView({ block: 'center' });
    b.click();
    return { clicked: true, label: clean(rawText(b) || b.value) };
  }

  function confirmation() {
    const text = (document.body.innerText || '').slice(0, 6000);
    const done = /thank you for (applying|your (application|interest))|application (has been |was )?(successfully )?(submitted|received|sent)|we('ve| have) received your application|your application (is|has been) (in|submitted|received)|successfully (applied|submitted)|you('ve| have) applied/i.test(text) || /\/(confirmation|thanks|thank-you|submitted|success)\b/i.test(location.pathname);
    const errors = [...document.querySelectorAll('[role="alert"], .error, .errors, [class*="error"]:not(input):not(select):not(textarea), [aria-invalid="true"]')].filter(vis).map((e) => clean(rawText(e)) || clean(labelFor(e).label)).filter((s) => s && s.length < 160);
    return { done, errors: [...new Set(errors)].slice(0, 8), url: location.href };
  }

  /** Is there an application form on the page yet? Some sites show the job first with an "Apply" button. */
  function state() {
    const f = scan();
    const apply = [...document.querySelectorAll('a, button')].filter(vis).find((x) => /^(apply( now| for this job| to this job)?|apply here|i'm interested)$/i.test(clean(rawText(x))));
    return { fields: f.length, hasFile: f.some((x) => x.type === 'file'), applyLink: apply ? (apply.href || true) : null, title: document.title, url: location.href };
  }
  function clickApply() { const a = [...document.querySelectorAll('a, button')].filter(vis).find((x) => /^(apply( now| for this job| to this job)?|apply here|i'm interested)$/i.test(clean(rawText(x)))); if (a) { a.click(); return true; } return false; }

  window.__JA = { scan, set, markUpload, unfilled, captcha, submit, confirmation, state, clickApply };
  return 'installed';
}
export const INPAGE = `(${install.toString()})()`;
