// Tiny UI toolkit: toasts, modal dialogs, event delegation.
import { esc } from './util.js';

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

let toastTimer;
export function toast(msg, { action, onAction, ms = 5000 } = {}) {
  const t = $('#toast');
  t.innerHTML = `<span>${esc(msg)}</span>${action ? `<button class="link">${esc(action)}</button>` : ''}`;
  t.hidden = false;
  t.classList.add('show');
  if (action) t.querySelector('button').onclick = () => { onAction?.(); t.classList.remove('show'); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

/** Show a modal. `body` is HTML; buttons: [{label, value, primary}]. Resolves with the clicked value (or null on dismiss). */
export function modal({ title, body, buttons = [{ label: 'OK', value: true, primary: true }], onOpen }) {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.className = 'modal';
    d.innerHTML = `<form method="dialog"><h3>${esc(title)}</h3><div class="modal-body">${body}</div><div class="modal-actions">${buttons.map((b, i) => `<button value="${i}" class="btn ${b.primary ? 'primary' : ''} ${b.danger ? 'danger' : ''}" ${b.noClose ? 'type="button" data-keep' : ''}>${esc(b.label)}</button>`).join('')}</div></form>`;
    document.body.appendChild(d);
    let result = null;
    d.addEventListener('close', () => { d.remove(); resolve(result); });
    d.querySelector('form').addEventListener('submit', (e) => {
      const i = e.submitter?.value;
      const b = buttons[i];
      result = b ? (typeof b.value === 'function' ? b.value(d) : b.value) : null;
    });
    d.showModal();
    onOpen?.(d);
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

/** Delegated click/change/input handling. `root` receives events; handlers keyed by data-action. */
export function delegate(root, handlers) {
  for (const type of ['click', 'change', 'input', 'submit']) {
    root.addEventListener(type, (e) => {
      const el = e.target.closest?.(`[data-${type}]`) || (type === 'click' ? e.target.closest('[data-action]') : null);
      if (!el || !root.contains(el)) return;
      const name = el.dataset[type] || el.dataset.action;
      const h = handlers[name];
      if (h) { if (type === 'submit') e.preventDefault(); h(el, e); }
    });
  }
}

export const chip = (text, cls = '') => `<span class="chip ${cls}">${esc(text)}</span>`;
export function download(name, data, type = 'application/json') {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
