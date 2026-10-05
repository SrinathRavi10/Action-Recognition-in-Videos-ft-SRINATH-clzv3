import { state, load, onChange, saveSettings, accounts, importRows, addManual, updateTxn, deleteTxn, setCategory, deleteRule, recategorizeAll, deleteDoc, updateDoc, saveRent, exportBackup, importBackup, wipeAll } from './store.js';
import { $, $$, delegate, modal, toast, download } from './ui.js';
import { dashboard } from './views/dashboard.js';
import { transactions, filtered, categoryOptions } from './views/transactions.js';
import { importer, processFiles, commit, discard, batch } from './views/importer.js';
import { subscriptions } from './views/subs.js';
import { tax, resultHtml, uploadDocs, suggestions, fyRange } from './views/taxui.js';
import { settings } from './views/settings.js';
import { demoTransactions } from './demo.js';
import { esc, toISO, monthKey, fyStart } from './util.js';
import { merchantKey } from './categorize.js';

const ROUTES = { dashboard, transactions, import: importer, subscriptions, tax, settings };
const view = $('#view');
let current = 'dashboard';

function applyTheme() {
  const t = state.settings.theme;
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.dataset.theme = t;
}

function render({ keepScroll = false } = {}) {
  const name = (location.hash.replace(/^#\//, '') || 'dashboard').split('?')[0];
  current = ROUTES[name] ? name : 'dashboard';
  const y = window.scrollY;
  view.innerHTML = ROUTES[current]();
  $$('nav.main a').forEach((a) => a.classList.toggle('on', a.dataset.route === current));
  document.title = `${current[0].toUpperCase() + current.slice(1)} · Paisa Ledger`;
  bindDrops();
  if (keepScroll) window.scrollTo(0, y); else if (!keepScroll) window.scrollTo(0, 0);
}
const rerender = () => render({ keepScroll: true });

function bindDrops() {
  for (const [dropId, inputId, handler] of [
    ['drop', 'file', (files) => processFiles(files, rerender)],
    ['docdrop', 'docfile', (files) => uploadDocs(files, $('#docKind').value, rerender)],
  ]) {
    const drop = $('#' + dropId), input = $('#' + inputId);
    if (!drop) continue;
    input.onchange = () => { handler([...input.files]); input.value = ''; };
    drop.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } };
    drop.onclick = (e) => { if (e.target !== input) { e.preventDefault(); input.click(); } };
    ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', (e) => handler([...e.dataTransfer.files]));
  }
  const rs = $('#restore');
  if (rs) rs.onchange = async () => {
    const f = rs.files[0]; if (!f) return;
    try {
      const obj = JSON.parse(await f.text());
      let pass = '';
      if (obj.format === 'paisa-ledger-encrypted-v1') pass = await modal({ title: 'Encrypted backup', body: '<input type="password" class="input" name="p" placeholder="Passphrase" autofocus>', buttons: [{ label: 'Cancel', value: null }, { label: 'Restore', value: (d) => d.querySelector('[name=p]').value, primary: true }] });
      if (obj.format === 'paisa-ledger-encrypted-v1' && pass == null) return;
      await importBackup(obj, pass);
      toast('Backup restored.');
    } catch (e) { toast(e.message || 'Could not restore this file.'); }
    rs.value = '';
  };
}

let debounce;
const later = (f, ms = 200) => { clearTimeout(debounce); debounce = setTimeout(f, ms); };
const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

async function addExpenseDialog() {
  const r = await modal({
    title: 'Add a cash / manual transaction',
    body: `<div class="fields one">
      <label class="field"><span>Date</span><input class="input" type="date" name="date" value="${toISO(new Date())}" required></label>
      <label class="field"><span>What was it?</span><input class="input" name="desc" placeholder="e.g. Auto fare, Tea stall" required></label>
      <label class="field"><span>Amount (₹)</span><input class="input" name="amount" inputmode="decimal" required></label>
      <label class="field"><span>Type</span><select name="type"><option value="debit">Expense</option><option value="credit">Income</option></select></label>
      <label class="field"><span>Category</span><select name="cat">${categoryOptions('Uncategorized')}</select></label></div>`,
    buttons: [{ label: 'Cancel', value: null }, { label: 'Add', primary: true, value: (d) => { const g = (n) => d.querySelector(`[name=${n}]`).value; return { date: g('date'), desc: g('desc').trim(), amount: parseFloat(g('amount').replace(/,/g, '')), type: g('type'), category: g('cat') }; } }],
  });
  if (!r || !r.desc || !(r.amount > 0) || !r.date) return;
  await addManual(r);
  toast('Added.');
}

const actions = {
  demo: async () => {
    const rows = demoTransactions();
    const { added } = await importRows(rows, 'Demo account', 'demo');
    toast(`Loaded ${added} demo transactions. Delete them any time in Settings.`);
    location.hash = '#/dashboard';
  },
  'review-uncat': () => { Object.assign(state.ui.tx, { q: '', month: '', cat: 'Uncategorized', type: 'debit', account: '', page: 1 }); },
  'add-txn': addExpenseDialog,
  'export-csv': () => {
    const rows = filtered();
    const head = ['Date', 'Description', 'Merchant', 'Category', 'Type', 'Amount', 'Account', 'Note'];
    download('transactions.csv', [head, ...rows.map((t) => [t.date, t.desc, t.merchant, t.category, t.type, t.amount, t.account, t.note])].map((r) => r.map(csvCell).join(',')).join('\n'), 'text/csv');
  },
  'tx-clear': () => { Object.assign(state.ui.tx, { q: '', month: '', cat: '', type: '', account: '', page: 1 }); render(); },
  'tx-more': () => { state.ui.tx.page++; rerender(); },
  'tx-del': async (el) => { if (await modal({ title: 'Delete this transaction?', body: '<p>It will be removed from your totals.</p>', buttons: [{ label: 'Cancel', value: false }, { label: 'Delete', value: true, danger: true }] })) await deleteTxn(el.dataset.id); },
  'tx-note': async (el) => {
    const t = state.txns.find((x) => x.id === el.dataset.id);
    const v = await modal({ title: 'Note', body: `<input class="input" name="n" maxlength="140" value="${esc(t.note || '')}" autofocus>`, buttons: [{ label: 'Cancel', value: null }, { label: 'Save', primary: true, value: (d) => d.querySelector('[name=n]').value }] });
    if (v != null) await updateTxn(t.id, { note: v.trim() });
  },
  'imp-commit': async (el) => { await commit(+el.dataset.i); },
  'imp-discard': (el) => { discard(+el.dataset.i); rerender(); },
  'sub-restore': async () => { for (const k of Object.keys(state.settings.overrides)) if (state.settings.overrides[k] === 'ignored') delete state.settings.overrides[k]; await saveSettings(); rerender(); },
  'tax-tab': (el) => { state.ui.taxTab = el.dataset.tab; rerender(); },
  'tax-apply': async (el) => { state.settings.taxProfile[el.dataset.k] = +el.dataset.v; await saveSettings(); rerender(); },
  'doc-apply': async (el) => {
    const d = state.docs.find((x) => x.id === el.dataset.id);
    const ok = ['grossSalary', 'tdsDeducted', 'basicSalary', 'hraReceived', 'sec80C', 'savingsInterest', 'fdInterest'];
    for (const [k, v] of Object.entries(d.extracted)) if (ok.includes(k)) state.settings.taxProfile[k] = v;
    await saveSettings();
    state.ui.taxTab = 'estimate';
    toast('Applied to your estimate – please review the figures.');
    rerender();
  },
  'doc-open': (el) => { const d = state.docs.find((x) => x.id === el.dataset.id); download(d.name, d.blob); },
  'doc-del': async (el) => { if (await modal({ title: 'Delete document?', body: '<p>This removes the stored copy from this device.</p>', buttons: [{ label: 'Cancel', value: false }, { label: 'Delete', value: true, danger: true }] })) await deleteDoc(el.dataset.id); },
  'rent-del': async (el) => saveRent(state.rent.filter((r) => r.id !== el.dataset.id)),
  'rent-fill': async () => {
    const f = $('[data-submit=rent-add]');
    const amount = parseFloat(f.amount.value), landlord = f.landlord.value.trim();
    if (!(amount > 0) || !landlord) return toast('Enter the rent amount and landlord name first.');
    const [a] = fyRange(state.settings.taxYear);
    const list = state.rent.filter((r) => !(r.month >= a.slice(0, 7) && r.month <= `${+a.slice(0, 4) + 1}-03`));
    for (let i = 0; i < 12; i++) { const d = new Date(+a.slice(0, 4), 3 + i, 1); list.push({ id: crypto.randomUUID(), month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, amount, landlord, pan: f.pan.value.toUpperCase() }); }
    await saveRent(list);
  },
  recat: async () => { const n = await recategorizeAll(); toast(`${n} transaction${n === 1 ? '' : 's'} re-categorised.`); },
  'rule-del': async (el) => deleteRule(el.dataset.m),
  backup: async () => {
    const pass = $('#bkpass').value;
    const data = await exportBackup(pass || null);
    download(`paisa-ledger-backup-${toISO(new Date())}${pass ? '-encrypted' : ''}.json`, JSON.stringify(data));
    toast(pass ? 'Encrypted backup saved. Keep the passphrase safe – it cannot be recovered.' : 'Backup saved.');
  },
  persist: async () => toast((await navigator.storage?.persist?.()) ? 'Done – the browser will keep your data.' : 'The browser did not grant persistent storage.'),
  wipe: async () => {
    const r = await modal({ title: 'Delete everything?', body: '<p>This cannot be undone. Export a backup first if you might need the data.</p><p>Type <b>DELETE</b> to confirm.</p><input class="input" name="c" autocomplete="off">', buttons: [{ label: 'Cancel', value: false }, { label: 'Delete all data', danger: true, value: (d) => d.querySelector('[name=c]').value === 'DELETE' }] });
    if (r) { await wipeAll(); batch.length = 0; toast('All data deleted.'); }
  },
};

const changes = {
  month: (el) => { state.ui.month = el.value; rerender(); },
  'tx-month': (el) => { state.ui.tx.month = el.value; state.ui.tx.page = 1; rerender(); },
  'tx-cat': (el) => { state.ui.tx.cat = el.value; state.ui.tx.page = 1; rerender(); },
  'tx-type': (el) => { state.ui.tx.type = el.value; state.ui.tx.page = 1; rerender(); },
  'tx-account': (el) => { state.ui.tx.account = el.value; state.ui.tx.page = 1; rerender(); },
  'tx-cat-set': async (el) => {
    const t = state.txns.find((x) => x.id === el.dataset.id);
    const cat = el.value;
    const n = state.txns.filter((x) => x.merchant === t.merchant && x.type === t.type).length;
    let similar = false;
    if (n > 1) {
      const r = await modal({ title: `Move to “${cat}”?`, body: `<p>${n} transactions look like <b>${esc(t.merchant)}</b>. Apply to all of them (and remember for future imports) or just this one?</p>`, buttons: [{ label: 'Cancel', value: null }, { label: 'Only this one', value: 'one' }, { label: `All ${n}`, value: 'all', primary: true }] });
      if (!r) return rerender();
      similar = r === 'all';
    }
    const undo = await setCategory(t.id, cat, similar);
    toast(similar ? `Moved ${n} “${t.merchant}” transactions to ${cat}.` : 'Category updated.', { action: 'Undo', onAction: undo });
  },
  'sub-action': async (el) => {
    const v = el.value; if (!v) return;
    if (v === 'active') delete state.settings.overrides[el.dataset.key]; else state.settings.overrides[el.dataset.key] = v;
    await saveSettings(); rerender();
  },
  'tax-year': async (el) => { state.settings.taxYear = el.value; await saveSettings(); rerender(); },
  'tax-age': async (el) => { state.settings.taxProfile.age = el.value; await saveSettings(); $('#taxResult').innerHTML = resultHtml(); },
  'tax-flag': async (el) => { state.settings.taxProfile[el.dataset.k] = el.checked; await saveSettings(); $('#taxResult').innerHTML = resultHtml(); },
  theme: async (el) => { state.settings.theme = el.value; await saveSettings(); applyTheme(); },
};

const inputs = {
  'tx-q': (el) => { state.ui.tx.q = el.value; state.ui.tx.page = 1; later(() => { rerender(); const i = $('[data-input=tx-q]'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250); },
  'tax-field': (el) => {
    const v = parseFloat(el.value.replace(/[,₹\s]/g, ''));
    state.settings.taxProfile[el.dataset.k] = Number.isFinite(v) ? v : 0;
    later(async () => { await saveSettings(); const r = $('#taxResult'); if (r) r.innerHTML = resultHtml(); }, 150);
  },
  budget: (el) => {
    const v = parseFloat(el.value.replace(/,/g, ''));
    if (v > 0) state.settings.budgets[el.dataset.cat] = v; else delete state.settings.budgets[el.dataset.cat];
    later(saveSettings, 400);
  },
  'imp-account': (el) => { batch[+el.dataset.i].account = el.value; },
};

const submits = {
  'rent-add': async (form) => {
    const f = form;
    const amount = parseFloat(f.amount.value.replace(/,/g, ''));
    const pan = f.pan.value.trim().toUpperCase();
    if (!(amount > 0)) return;
    if (pan && !/^[A-Z]{5}\d{4}[A-Z]$/.test(pan)) return toast('That PAN does not look right (format ABCDE1234F).');
    const list = state.rent.filter((r) => r.month !== f.month.value);
    list.push({ id: crypto.randomUUID(), month: f.month.value, amount, landlord: f.landlord.value.trim(), pan });
    await saveRent(list);
  },
};

delegate(document.body, { ...actions, ...Object.fromEntries(Object.entries(changes).concat(Object.entries(inputs)).map(([k, v]) => [k, v])), ...submits });

// 'review-uncat' must navigate AND set the filter: the link's href handles navigation after the click handler runs.

onChange(() => { if (state.ready) queueRender(); });
let queued = false;
function queueRender() {
  if (queued) return;
  queued = true;
  queueMicrotask(() => { queued = false; if (!document.activeElement?.matches?.('input.input[data-input]')) rerender(); });
}

window.addEventListener('hashchange', () => render());
$('#themeToggle')?.addEventListener('click', async () => {
  const dark = document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
  state.settings.theme = dark ? 'light' : 'dark';
  await saveSettings(); applyTheme();
});

(async function boot() {
  await load();
  applyTheme();
  render();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
