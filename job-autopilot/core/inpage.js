// Code that runs INSIDE the job-application page (injected as a string). It is deliberately label-driven rather than
// tied to any one site's markup: it finds the application form, lists every control with its question text, and
// can set values the way a person would (firing the events React/Vue/Angular forms listen for).
// It sees through open shadow DOM (web-component forms), custom drop-downs, button-style radios and rich-text boxes,
// and can tell which step of a multi-page form it is on.
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

  // ───────── DOM traversal that crosses shadow roots ─────────
  const hostOf = (n) => { const r = n.getRootNode && n.getRootNode(); return r && r.host ? r.host : null; };
  const parentDeep = (n) => n.parentElement || hostOf(n);
  function deepAll(root, sel) {
    const out = [];
    const walk = (r) => {
      try { out.push(...r.querySelectorAll(sel)); } catch { /* bad selector */ }
      for (const el of r.querySelectorAll('*')) if (el.shadowRoot) walk(el.shadowRoot);
    };
    walk(root);
    return out;
  }
  function closestDeep(el, sel) { for (let n = el; n; n = parentDeep(n)) { if (n.matches && n.matches(sel)) return n; } return null; }
  const containsDeep = (a, b) => { for (let n = b; n; n = parentDeep(n)) if (n === a) return true; return false; };
  const textDeep = (n) => { let t = rawText(n); if (n && n.shadowRoot) t += ' ' + rawText(n.shadowRoot); return t; };

  const isHoneypot = (el) => /honeypot|hp_|bot-field|do-not-fill|trap/i.test(`${el.name} ${el.id} ${el.className}`) || el.tabIndex === -1 && !vis(el) && el.type !== 'file' && el.type !== 'radio' && el.type !== 'checkbox' || closestDeep(el, '[aria-hidden="true"]') && el.type !== 'file';

  const FIELD_BOX = '.field, .form-group, .application-field, .application-question, [class*="question"], [class*="Field"], [class*="field"], [data-qa], fieldset, li, .ashby-application-form-field-entry, spl-form-field, [class*="form-row"], [class*="FormRow"]';
  function labelFor(el) {
    const bits = [];
    const lb = el.getAttribute('aria-labelledby');
    if (lb) for (const id of lb.split(/\s+/)) bits.push(rawText((el.getRootNode().getElementById && el.getRootNode().getElementById(id)) || document.getElementById(id)));
    if (!bits.join('').trim() && el.labels && el.labels.length) for (const l of el.labels) bits.push(rawText(l));
    if (!bits.join('').trim() && el.getAttribute('aria-label')) bits.push(el.getAttribute('aria-label'));
    if (!bits.join('').trim()) { const l = el.closest('label'); if (l) bits.push(rawText(l)); }
    // web components: the question is usually an attribute / slot on the host element
    for (let h = hostOf(el), i = 0; h && !bits.join('').trim() && i < 4; h = hostOf(h) || null, i++) {
      for (const a of ['label', 'aria-label', 'data-label', 'title', 'placeholder', 'name']) if (h.getAttribute(a) && !/^[a-z0-9_.-]+$/i.test(h.getAttribute(a)) || a === 'label' && h.getAttribute(a)) { bits.push(h.getAttribute(a)); break; }
      if (!bits.join('').trim()) { const l = h.querySelector('[slot="label"], label, [class*="label"]'); if (l) bits.push(rawText(l)); }
    }
    if (!bits.join('').trim()) {
      const box = closestDeep(el, FIELD_BOX);
      if (box) { const h = box.querySelector('label, legend, .label, [class*="label"], [class*="Label"], h3, h4, strong'); if (h && !h.contains(el)) bits.push(rawText(h)); }
    }
    if (!bits.join('').trim()) bits.push(el.placeholder || el.getAttribute('placeholder') || el.name || el.id || '');
    const raw = bits.join(' ');
    return { label: clean(raw), requiredMark: /\*|✱|\brequired\b/i.test(raw) };
  }
  const optLabel = (el) => clean(rawText(el.labels && el.labels[0]) || rawText(el.closest && el.closest('label')) || (el.getAttribute && el.getAttribute('aria-label')) || rawText(el) || el.value);

  /** Question text for a radio / checkbox group: the nearest ancestor holding the whole group and some text that is not an option. */
  function groupLabel(el, group) {
    const fs = closestDeep(el, 'fieldset'); if (fs) { const lg = fs.querySelector('legend'); if (lg) return { label: clean(rawText(lg)), requiredMark: /\*|✱|required/i.test(rawText(lg)) }; }
    const grp = closestDeep(el, '[role="radiogroup"], [role="group"]');
    if (grp) { const id = grp.getAttribute('aria-labelledby'); const t = id ? rawText(document.getElementById(id)) : grp.getAttribute('aria-label') || grp.getAttribute('label'); if (t) return { label: clean(t), requiredMark: /\*|✱|required/i.test(t) }; }
    const members = group && group.length ? group : [el];
    const optTexts = members.map((r) => optLabel(r));
    let node = parentDeep(members[0]);
    while (node && !members.every((r) => containsDeep(node, r))) node = parentDeep(node);
    for (let i = 0; i < 6 && node && node !== document.body; i++, node = parentDeep(node)) {
      const heads = [...node.querySelectorAll('legend, .label, [class*="label"], [class*="title"], [class*="question"], h1, h2, h3, h4, h5, h6, strong, label, p, span')]
        .filter((h) => !h.querySelector('input, select, textarea') && !members.some((r) => containsDeep(h, r)) && clean(rawText(h)).length > 2 && !optTexts.some((t) => t && clean(rawText(h)) === t));
      if (heads.length) return { label: clean(rawText(heads[0])), requiredMark: /\*|✱|required/i.test(rawText(heads[0])) || !!node.querySelector('.required, .asterisk') };
      const attr = node.getAttribute && (node.getAttribute('label') || node.getAttribute('aria-label')); if (attr) return { label: clean(attr), requiredMark: false };
    }
    return labelFor(el);
  }

  function formRoot() {
    const forms = [...document.forms];
    let best = null, score = 0;
    for (const f of forms) {
      const n = f.querySelectorAll('input:not([type=hidden]):not([type=search]), textarea, select').length + (f.querySelector('input[type=file]') ? 5 : 0);
      if (n > score) { best = f; score = n; }
    }
    if (best && score >= 3) return best;
    // no <form>, or a form made of web components: use the whole page (shadow roots are searched by deepAll)
    return document.body;
  }

  // ───────── registry of elements we have named ─────────
  let seq = 0;
  const reg = new Map();
  const ensureId = (el) => { if (!el.dataset) return null; if (!el.dataset.jaId) el.dataset.jaId = `ja${++seq}`; reg.set(el.dataset.jaId, el); return el.dataset.jaId; };
  const byId = (id) => { const el = reg.get(id); if (el && el.isConnected) return el; return deepAll(document, `[data-ja-id="${id}"]`)[0] || null; };

  const COMBO_BTN = 'button[aria-haspopup="listbox"], [role="combobox"]:not(input):not(select), [role="button"][aria-haspopup="listbox"], button[aria-haspopup="true"][aria-expanded]';
  const SEL = `input, textarea, select, [contenteditable="true"][role="textbox"], [contenteditable="plaintext-only"], [role="radio"]:not(input), [role="checkbox"]:not(input), ${COMBO_BTN}`;

  function scan() {
    const root = formRoot();
    const out = [];
    const seenGroups = new Set();
    for (const el of deepAll(root, SEL)) {
      const tag = el.tagName;
      const role = el.getAttribute('role');
      let t = (el.type || tag).toLowerCase();
      if (el.hasAttribute && el.hasAttribute('contenteditable')) t = 'richtext';
      if (role === 'radio' && tag !== 'INPUT') t = 'ariaradio';
      if (role === 'checkbox' && tag !== 'INPUT') t = 'ariacheckbox';
      if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT' && (role === 'combobox' || el.matches(COMBO_BTN))) t = 'combobutton';
      if (['hidden', 'submit', 'button', 'image', 'reset', 'search', 'password'].includes(t)) continue;
      if (el.disabled || el.readOnly && t !== 'file') continue;
      // text-like controls must be on screen (or sit inside an on-screen custom select); radios/checkboxes/files are often
      // visually hidden behind a styled label, so for those only "not display:none" (e.g. a hidden wizard step) matters
      if (t === 'file' || t === 'radio' || t === 'checkbox') { if (el.checkVisibility && !el.checkVisibility()) continue; }
      else if (!vis(el)) { const c = parentDeep(el) && closestDeep(parentDeep(el), '[role="combobox"], [class*="select__"], [class*="react-select"]'); if (!(c && vis(c))) continue; }
      if (isHoneypot(el)) continue;
      if (el.closest && el.closest('.g-recaptcha, .h-captcha, [class*="captcha"]')) continue;

      if (t === 'radio' || t === 'ariaradio') {
        const grpEl = t === 'ariaradio' ? closestDeep(el, '[role="radiogroup"]') : null;
        const key = t === 'radio' ? (el.name || ensureId(el)) : (grpEl ? ensureId(grpEl) : ensureId(el));
        if (seenGroups.has(key)) continue;
        seenGroups.add(key);
        const group = t === 'radio'
          ? deepAll(document, 'input[type=radio]').filter((r) => (el.name ? r.name === el.name : r === el))
          : (grpEl ? deepAll(grpEl, '[role="radio"]') : [el]);
        const g = groupLabel(el, group);
        const checked = (r) => (t === 'radio' ? r.checked : r.getAttribute('aria-checked') === 'true');
        out.push({ id: ensureId(group[0]), type: 'radio', label: g.label, name: el.name || '', required: group.some((r) => r.required || r.getAttribute('aria-required') === 'true') || g.requiredMark, options: group.map((r) => ({ id: ensureId(r), text: optLabel(r), value: r.value || optLabel(r) })), value: (group.find(checked) ? (group.find(checked).value || optLabel(group.find(checked))) : '') });
        continue;
      }
      if (t === 'checkbox' || t === 'ariacheckbox') {
        const same = t === 'checkbox' && el.name ? deepAll(document, 'input[type=checkbox]').filter((r) => r.name === el.name) : [el];
        if (same.length > 1) {
          if (seenGroups.has(el.name)) continue;
          seenGroups.add(el.name);
          const g = groupLabel(el, same);
          out.push({ id: ensureId(same[0]), type: 'checkboxgroup', label: g.label, name: el.name, required: same.some((r) => r.required) || g.requiredMark, options: same.map((r) => ({ id: ensureId(r), text: optLabel(r), value: r.value })), value: same.filter((r) => r.checked).map((r) => r.value) });
        } else {
          const l = labelFor(el);
          out.push({ id: ensureId(el), type: 'checkbox', label: l.label || optLabel(el), name: el.name || '', required: el.required || el.getAttribute('aria-required') === 'true' || l.requiredMark, value: t === 'checkbox' ? el.checked : el.getAttribute('aria-checked') === 'true' });
        }
        continue;
      }
      const l = labelFor(el);
      const f = { id: ensureId(el), label: l.label, name: el.name || '', placeholder: el.placeholder || el.getAttribute('placeholder') || '', required: el.required || el.getAttribute('aria-required') === 'true' || l.requiredMark };
      if (t === 'file') { out.push({ ...f, type: 'file', accept: el.accept || '', multiple: el.multiple, value: el.files ? el.files.length : 0 }); continue; }
      if (tag === 'SELECT') { out.push({ ...f, type: 'select', options: [...el.options].filter((o) => o.value !== '' || o.text.trim()).map((o) => ({ value: o.value, text: clean(o.text) })), value: el.value }); continue; }
      if (tag === 'TEXTAREA') { out.push({ ...f, type: 'textarea', maxLength: el.maxLength > 0 ? el.maxLength : 0, value: el.value }); continue; }
      if (t === 'richtext') { out.push({ ...f, type: 'textarea', rich: true, maxLength: 0, value: clean(rawText(el)) }); continue; }
      if (t === 'combobutton') { out.push({ ...f, type: 'combobox', button: true, value: clean(rawText(el)) === f.label ? '' : clean(rawText(el)) }); continue; }
      const combo = role === 'combobox' || el.getAttribute('aria-haspopup') === 'listbox' || !!closestDeep(el, '[class*="select__"], [class*="react-select"]');
      out.push({ ...f, type: combo ? 'combobox' : (['email', 'tel', 'url', 'number', 'date'].includes(t) ? t : 'text'), maxLength: el.maxLength > 0 ? el.maxLength : 0, value: el.value });
    }
    return out;
  }

  const fire = (el, names) => names.forEach((n) => el.dispatchEvent(new Event(n, { bubbles: true, composed: true })));
  const setNative = (el, v) => {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
  };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const same = (a, b) => clean(a).toLowerCase() === clean(b).toLowerCase();
  const click = (el) => { el.scrollIntoView({ block: 'center' }); for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) el.dispatchEvent(new MouseEvent(t, { bubbles: true, composed: true, cancelable: true })); el.click(); };
  const openOptions = () => deepAll(document, '[role="option"], [role="listbox"] li, [class*="option"], [class*="menu-item"], [class*="dropdown"] li, ul[role="listbox"] > *').filter(vis);

  const optText = (x) => clean(rawText(x));
  function bestOption(options, value) {
    const want = String(value).toLowerCase().trim();
    const toks = want.split(/[,\s/]+/).filter((w) => w.length > 2);
    return options.find((x) => same(rawText(x), value))
      || options.find((x) => optText(x).toLowerCase().includes(want))
      || options.find((x) => want.includes(optText(x).toLowerCase()) && optText(x).length > 2)
      || (toks.length > 1 ? (() => { const sc = options.map((x) => [x, toks.filter((w) => optText(x).toLowerCase().includes(w)).length]).sort((a, b) => b[1] - a[1]); return sc[0] && sc[0][1] === toks.length && (!sc[1] || sc[1][1] < sc[0][1]) ? sc[0][0] : null; })() : null);
  }
  async function pickFromDropdown(trigger, value, typeInto) {
    trigger.focus(); click(trigger);
    if (typeInto) { setNative(typeInto, String(value)); fire(typeInto, ['input']); }
    await wait(450);
    let options = openOptions();
    if (!options.length && !typeInto) { await wait(500); options = openOptions(); }
    let o = bestOption(options, value);
    if (!o && typeInto && /,/.test(String(value))) {            // address-style autocompletes want just the city first
      setNative(typeInto, String(value).split(',')[0].trim()); fire(typeInto, ['input']); await wait(500);
      options = openOptions(); o = bestOption(options, value);
    }
    if (!o && options.length === 1 && typeInto) o = options[0];
    if (o) { click(o); await wait(150); fire(trigger, ['change', 'blur']); return { ok: true, value: optText(o) }; }
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, composed: true }));
    return { ok: false, why: options.length ? `no option matches “${value}”` : 'dropdown did not open' };
  }
  /** Open a custom drop-down, read its choices, close it again (so the answer can be chosen against the real wording). */
  async function readOptions(id) {
    const el = byId(id); if (!el) return [];
    el.scrollIntoView({ block: 'center' }); el.focus(); click(el); await wait(450);
    let opts = openOptions(); if (!opts.length) { await wait(500); opts = openOptions(); }
    const texts = [...new Set(opts.map(optText).filter(Boolean))].slice(0, 60);
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, composed: true }));
    if (openOptions().length) click(el);
    return texts;
  }

  async function set(id, value) {
    const el = byId(id);
    if (!el) return { ok: false, why: 'field not found' };
    const role = el.getAttribute('role');
    let t = (el.type || el.tagName).toLowerCase();
    el.scrollIntoView({ block: 'center' });
    if (el.tagName === 'SELECT') {
      const opts = [...el.options];
      const want = String(value);
      const o = opts.find((x) => same(x.text, want) || same(x.value, want)) || opts.find((x) => clean(x.text).toLowerCase().includes(want.toLowerCase()) && x.value !== '') || opts.find((x) => want.toLowerCase().includes(clean(x.text).toLowerCase()) && clean(x.text).length > 2 && x.value !== '');
      if (!o) return { ok: false, why: `no option matches “${want}”` };
      setNative(el, o.value); fire(el, ['input', 'change', 'blur']);
      return { ok: true, value: o.text };
    }
    if (t === 'radio' || role === 'radio') {
      const grpEl = role === 'radio' && el.tagName !== 'INPUT' ? closestDeep(el, '[role="radiogroup"]') : null;
      const group = role === 'radio' && el.tagName !== 'INPUT' ? (grpEl ? deepAll(grpEl, '[role="radio"]') : [el]) : (el.name ? deepAll(document, 'input[type=radio]').filter((r) => r.name === el.name) : [el]);
      const want = String(value);
      const r = group.find((x) => same(optLabel(x), want) || same(x.value, want)) || group.find((x) => clean(optLabel(x)).toLowerCase().startsWith(want.toLowerCase())) || group.find((x) => clean(optLabel(x)).toLowerCase().includes(want.toLowerCase()));
      if (!r) return { ok: false, why: `no option matches “${want}”` };
      const lab = r.tagName === 'INPUT' ? (r.labels && r.labels[0]) : null;
      click(lab || r);
      const on = () => (r.tagName === 'INPUT' ? r.checked : r.getAttribute('aria-checked') === 'true');
      if (!on()) click(r);
      return { ok: on() || r.tagName !== 'INPUT', value: optLabel(r) };
    }
    if (t === 'checkbox' || role === 'checkbox') {
      const isAria = el.tagName !== 'INPUT';
      const want = Array.isArray(value) ? value : [value];
      const group = !isAria && el.name ? deepAll(document, 'input[type=checkbox]').filter((r) => r.name === el.name) : [el];
      const state = (c) => (isAria ? c.getAttribute('aria-checked') === 'true' : c.checked);
      if (group.length === 1) { const on = want[0] === true || /^(true|yes)$/i.test(String(want[0])); if (state(el) !== on) click(el); return { ok: state(el) === on, value: on }; }
      for (const c of group) { const on = want.some((w) => same(optLabel(c), w) || same(c.value, w)); if (state(c) !== on) click(c); }
      return { ok: true, value: want };
    }
    if (el.hasAttribute('contenteditable')) {
      el.focus();
      const sel = window.getSelection(); const range = document.createRange(); range.selectNodeContents(el); sel.removeAllRanges(); sel.addRange(range);
      if (!document.execCommand('insertText', false, String(value))) { el.textContent = String(value); fire(el, ['input']); }
      fire(el, ['change', 'blur']);
      return { ok: clean(rawText(el)).length > 0, value: clean(rawText(el)).slice(0, 80) };
    }
    if (role === 'combobox' && el.tagName !== 'INPUT' || el.matches && el.matches(COMBO_BTN) && el.tagName !== 'INPUT') return pickFromDropdown(el, value, null);
    if (role === 'combobox' || el.getAttribute('aria-haspopup') === 'listbox' || closestDeep(el, '[class*="select__"], [class*="react-select"]')) return pickFromDropdown(el, value, el);
    el.focus();
    let v = String(value);
    if (el.maxLength > 0 && v.length > el.maxLength) v = v.slice(0, el.maxLength);
    setNative(el, v);
    fire(el, ['input', 'change', 'blur']);
    return { ok: el.value === v, value: el.value };
  }

  /** The marked file input itself (searching inside shadow roots too) – used by drivers that need a handle to it. */
  const markedElement = (tag) => deepAll(document, `[data-ja-upload="${tag}"]`)[0] || null;
  function markUpload(id, tag) { const el = byId(id); if (!el) return null; el.setAttribute('data-ja-upload', tag); return `[data-ja-upload="${tag}"]`; }

  function unfilled() {
    return scan().filter((f) => f.required && (f.type === 'checkboxgroup' ? !(f.value || []).length : f.type === 'radio' ? !f.value : f.type === 'checkbox' ? !f.value : f.type === 'file' ? !f.value : !String(f.value || '').trim() || (f.type === 'select' && /^(select|choose|please|--)/i.test(String(f.value)))));
  }

  function captcha() {
    const hits = [];
    for (const f of deepAll(document, 'iframe')) { const s = f.src || ''; if (/recaptcha|hcaptcha|turnstile|challenges\.cloudflare|arkoselabs|funcaptcha/i.test(s)) hits.push({ kind: (s.match(/recaptcha|hcaptcha|turnstile|arkose/i) || ['captcha'])[0].toLowerCase(), visible: vis(f) && f.getBoundingClientRect().height > 80 }); }
    for (const e of deepAll(document, '.g-recaptcha, .h-captcha, .cf-turnstile, [data-sitekey]')) hits.push({ kind: 'widget', visible: vis(e) && e.getBoundingClientRect().height > 40 });
    return { present: hits.length > 0, challengeVisible: hits.some((h) => h.visible), kinds: [...new Set(hits.map((h) => h.kind))] };
  }

  // ───────── buttons: submit vs "Next" ─────────
  const SUBMIT_RE = /^(submit( (my )?application)?|send( application)?|apply( now)?|finish|complete( application)?|confirm|submit & apply|apply for (this )?job|send my application)$/i;
  const NEXT_RE = /^(next( step)?|continue|save (and|&) continue|proceed|go to next|next page|continue to .*|review( application)?|save & next)$/i;
  const BAD_BTN = /cancel|back|previous|save for later|save draft|share|sign in|log in|login|upload|add (another|more)|remove|delete|attach|browse|choose file|edit|preview|print|download|reset|clear/i;
  function buttons() {
    const root = formRoot();
    let list = deepAll(root, 'button, input[type=submit], input[type=button], a[role=button], [role=button]').filter(vis);
    return list.filter((b) => !b.disabled && b.getAttribute('aria-disabled') !== 'true').map((b) => ({ el: b, text: clean(rawText(b) || b.value || b.getAttribute('aria-label') || '') })).filter((b) => b.text && !BAD_BTN.test(b.text));
  }
  /** What would a person press now? { kind: 'submit'|'next'|null, label } */
  function action() {
    const bs = buttons();
    const sub = bs.find((b) => SUBMIT_RE.test(b.text)) || bs.find((b) => b.el.type === 'submit' && !NEXT_RE.test(b.text) && !/^(search|go)$/i.test(b.text)) || bs.find((b) => /submit|send application/i.test(b.text));
    if (sub) return { kind: 'submit', label: sub.text };
    const nx = bs.find((b) => NEXT_RE.test(b.text)) || bs.find((b) => b.el.type === 'submit');
    return nx ? { kind: 'next', label: nx.text } : { kind: null, label: '' };
  }
  function clickAction(kind) {
    const bs = buttons();
    const b = kind === 'submit'
      ? (bs.find((x) => SUBMIT_RE.test(x.text)) || bs.find((x) => x.el.type === 'submit' && !NEXT_RE.test(x.text)) || bs.find((x) => /submit|send application/i.test(x.text)))
      : (bs.find((x) => NEXT_RE.test(x.text)) || bs.find((x) => x.el.type === 'submit'));
    if (!b) return { clicked: false };
    b.el.scrollIntoView({ block: 'center' });
    click(b.el);
    return { clicked: true, label: b.text };
  }
  const submit = () => clickAction('submit');

  /** A cheap fingerprint of the visible fields, to notice when a multi-step form moved on. */
  function signature() { return scan().map((f) => `${f.type}:${f.label}`).join('|') + '#' + (document.querySelector('h1, h2, [class*="step"][class*="active"], [aria-current="step"]') || { textContent: '' }).textContent.trim().slice(0, 60); }

  function confirmation() {
    const text = (document.body.innerText || '').slice(0, 6000);
    const done = /thank you for (applying|your (application|interest|submission))|application (has been |was )?(successfully )?(submitted|received|sent)|we('ve| have) received your application|your application (is|has been) (in|submitted|received|on its way)|successfully (applied|submitted)|you('ve| have) applied|application complete|thanks for applying|we will (review|be in touch)|submitted successfully/i.test(text) || /\/(confirmation|thanks|thank-you|submitted|success|applied)\b/i.test(location.pathname);
    const errors = deepAll(document, '[role="alert"], .error, .errors, [class*="error"]:not(input):not(select):not(textarea), [aria-invalid="true"], [class*="invalid"]:not(input)').filter(vis).map((e) => clean(rawText(e)) || clean(labelFor(e).label)).filter((s) => s && s.length < 160);
    return { done, errors: [...new Set(errors)].slice(0, 8), url: location.href };
  }

  const APPLY_RE = /^(apply( now| for this job| to this job| for this position| online)?|apply here|i'?m interested|start (your )?application|apply with resume|easy apply|quick apply|apply manually|continue to application)$/i;
  const applyBtn = () => deepAll(document, 'a, button, [role=button]').filter(vis).find((x) => APPLY_RE.test(clean(rawText(x))));
  /** Is there an application form on the page yet? Some sites show the job first with an "Apply" button. */
  function state() {
    const f = scan();
    const apply = applyBtn();
    return { fields: f.length, hasFile: f.some((x) => x.type === 'file'), applyLink: apply ? (apply.href || true) : null, title: document.title, url: location.href, account: needsAccount() };
  }
  function clickApply() { const a = applyBtn(); if (a) { click(a); return true; } return false; }

  /** The page wants an account (password box / "sign in to apply") instead of an application form. */
  function needsAccount() {
    const pw = deepAll(document, 'input[type=password]').filter(vis);
    if (pw.length) return true;
    const t = (document.body.innerText || '').slice(0, 2500);
    return scan().length < 3 && /(sign in|log ?in|create (an )?account|register) (to|and) (apply|continue)|you (must|need to) (sign in|log in|create an account)|already have an account/i.test(t);
  }

  /** Application forms embedded in an iframe (company careers page → ATS widget): where to go instead. */
  function iframeTarget() {
    for (const f of document.querySelectorAll('iframe')) {
      const s = f.src || '';
      if (/greenhouse\.io|lever\.co|ashbyhq\.com|workable\.com|smartrecruiters\.com|breezy\.hr|recruitee\.com|bamboohr\.com|zohorecruit|jobvite|icims\.com|\/embed\/job_app|grnhse|application[-_]?form/i.test(s)) return s;
    }
    return null;
  }

  window.__JA = { scan, set, readOptions, markedElement, markUpload, unfilled, captcha, submit, confirmation, state, clickApply, action, clickAction, signature, needsAccount, iframeTarget };
  return 'installed';
}
export const INPAGE = `(${install.toString()})()`;
