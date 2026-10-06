// Tiny UI toolkit: toasts, modal dialogs, event delegation.
import { esc } from './util.js';
import { icon } from './icons.js';

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

let toastTimer;
export function toast(msg, { action, onAction, ms = 5000 } = {}) {
  const t = $('#toast');
  t.innerHTML = `<span>${esc(msg)}</span>${action ? `<button class="link">${esc(action)}</button>` : ''}`;
  t.hidden = false;
  requestAnimationFrame(() => t.classList.add('show'));
  if (action) t.querySelector('button').onclick = () => { onAction?.(); t.classList.remove('show'); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

/** Show a modal. `body` is HTML; buttons: [{label, value, primary, danger, noClose}]. Resolves with the clicked value (or null on dismiss). */
export function modal({ title, body, buttons = [{ label: 'OK', value: true, primary: true }], onOpen, wide = false }) {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.className = 'modal' + (wide ? ' wide' : '');
    d.innerHTML = `<form method="dialog"><h3>${esc(title)}</h3><div class="modal-body">${body}</div><div class="modal-actions">${buttons.map((b, i) => `<button value="${i}" class="btn ${b.primary ? 'primary' : ''} ${b.danger ? 'danger' : ''}">${esc(b.label)}</button>`).join('')}</div></form>`;
    document.body.appendChild(d);
    let result = null;
    d.addEventListener('close', () => { d.remove(); resolve(result); });
    d.querySelector('form').addEventListener('submit', (e) => {
      const b = buttons[e.submitter?.value];
      result = b ? (typeof b.value === 'function' ? b.value(d) : b.value) : null;
    });
    d.showModal();
    onOpen?.(d);
    d.querySelector('[autofocus], input, select')?.focus();
  });
}

export async function askPassword(wrong) {
  const r = await modal({
    title: 'This PDF is password protected',
    body: `<p class="muted">${wrong ? '<b class="neg">Incorrect password.</b> ' : ''}Bank PDFs are usually locked with your date of birth, PAN or customer ID. The password is used only on this device to open the file.</p><input type="password" name="pw" class="input" autocomplete="off" placeholder="PDF password" autofocus>`,
    buttons: [{ label: 'Skip file', value: null }, { label: 'Unlock', value: (d) => d.querySelector('[name=pw]').value, primary: true }],
  });
  return r || null;
}

/** Delegated click/change/input/submit handling. Handlers keyed by data-action / data-change / data-input / data-submit. */
export function delegate(root, handlers) {
  for (const type of ['click', 'change', 'input', 'submit']) {
    root.addEventListener(type, (e) => {
      const sel = type === 'click' ? '[data-action]' : `[data-${type}]`;
      const el = e.target.closest?.(sel);
      if (!el || !root.contains(el)) return;
      const name = type === 'click' ? el.dataset.action : el.dataset[type];
      const h = handlers[name];
      if (h) { if (type === 'submit') e.preventDefault(); h(el, e); }
    });
  }
}

export const chip = (text, cls = '', ic = '') => `<span class="chip ${cls}">${ic ? icon(ic, 13) : ''}${esc(text)}</span>`;
export const emptyBlock = (ic, title, text, action = '') => `<div class="empty">${icon(ic, 34)}<b>${esc(title)}</b><span>${text}</span>${action}</div>`;

export function download(name, data, type = 'application/json') {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

/** Animate numbers from 0 → data-count (formatted with the given formatter). */
export function animateCounts(root, format) {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  $$('[data-count]', root).forEach((el) => {
    const to = +el.dataset.count;
    if (reduce || !Number.isFinite(to)) { el.textContent = format(to); return; }
    const t0 = performance.now(), dur = 800;
    const tick = (now) => {
      const p = Math.min(1, (now - t0) / dur);
      el.textContent = format(to * (1 - (1 - p) ** 3));
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
