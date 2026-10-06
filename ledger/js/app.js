import * as S from './store.js';
import { state, load, onChange, saveSettings, saveMeta, importRows, addManual, updateTxn, bulkUpdate, deleteTxns, setCategory, deleteRule, recategorizeAll, previewRule, deleteDoc, saveRent, exportBackup, importBackup, wipeAll } from './store.js';
import { db, lockEnabled, isUnlocked, enableLock, disableLock, changePassphrase, unlock } from './db.js';
import { $, $$, delegate, modal, toast, download, animateCounts } from './ui.js';
import { icon } from './icons.js';
import { installTooltips } from './charts.js';
import { setLang, t } from './i18n.js';
import { home } from './views/home.js';
import { transactions, filtered, categoryOptions, editBody, splitRow } from './views/transactions.js';
import { importer, processFiles, commit, discard, batch } from './views/importer.js';
import { bills, recurringItems } from './views/bills.js';
import { plan, ACCOUNT_TYPES, owedList } from './views/plan.js';
import { tax, resultHtml, uploadDocs, fyRange, itrText, printReceipts } from './views/taxui.js';
import { report, reportSheets } from './views/reports.js';
import { settings as settingsView } from './views/settings.js';
import { demoTransactions } from './demo.js';
import { esc, toISO, fmt, fmt2, daysBetween, monthLabel, longDate } from './util.js';
import { showLock, lockApp, arm } from './lock.js';
import { profiles, activeProfile, addProfile, renameProfile, removeProfile, switchProfile } from './profiles.js';
import { buildICS, requestNotify, notifyDue, cancelGuide } from './notify.js';
import { buildXlsx } from './xlsx.js';

const ROUTES = {
  home: { fn: home, title: 'Home', icon: 'home' }, transactions: { fn: transactions, title: 'Transactions', icon: 'list' },
  import: { fn: importer, title: 'Import', icon: 'upload' }, bills: { fn: bills, title: 'Bills', icon: 'repeat' },
  plan: { fn: plan, title: 'Plan', icon: 'target' }, tax: { fn: tax, title: 'Tax', icon: 'rupee' },
  reports: { fn: report, title: 'Reports', icon: 'report' }, settings: { fn: settingsView, title: 'Settings', icon: 'settings' },
};
const ALIAS = { dashboard: 'home', subscriptions: 'bills' };
const GROUPS = [['', ['home', 'transactions', 'import']], ['Money', ['bills', 'plan']], ['Tax & reports', ['tax', 'reports']], ['', ['settings']]];
const view = $('#view');
let current = 'home';

// ───────────────────────── shell ─────────────────────────
function applyPrefs() {
  const s = state.settings, r = document.documentElement;
  setTimeout(() => window.paisa?.setTitleBarTheme?.(r.dataset.theme === 'dark' || (!r.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches)), 0);
  s.theme === 'auto' ? r.removeAttribute('data-theme') : (r.dataset.theme = s.theme);
  s.textSize === 'normal' ? r.removeAttribute('data-text') : (r.dataset.text = s.textSize);
  s.contrast === 'high' ? (r.dataset.contrast = 'high') : r.removeAttribute('data-contrast');
  setLang(s.lang);
  $('#app').classList.toggle('collapsed', !!s.sidebarCollapsed);
}

function buildShell() {
  const uncat = state.txns.filter((x) => x.category === 'Uncategorized' && x.type === 'debit').length;
  $('#nav').innerHTML = GROUPS.map(([g, keys]) => (g ? `<div class="navgroup">${t(g)}</div>` : '') + keys.map((k) => `<a href="#/${k}" data-route="${k}" title="${t(ROUTES[k].title)}">${icon(ROUTES[k].icon, 20)}<span>${t(ROUTES[k].title)}</span>${k === 'transactions' && uncat ? `<em class="badge" style="font-style:normal">${uncat > 99 ? '99+' : uncat}</em>` : ''}</a>`).join('')).join('');
  const tabs = ['home', 'transactions', 'bills', 'plan'];
  $('#tabbar').innerHTML = tabs.map((k) => `<a href="#/${k}" data-route="${k}">${icon(ROUTES[k].icon, 22)}<span>${t(ROUTES[k].title)}</span></a>`).join('') + `<button id="moreBtn">${icon('more', 22)}<span>More</span></button>`;
  $('#pillIcon').innerHTML = icon('shield', 16);
  $('#searchIcon').innerHTML = icon('search', 18);
  $('#bellBtn').innerHTML = icon('bell', 20);
  $('#fab').innerHTML = `${icon('plus', 20)}<span>${t('Add expense')}</span>`;
  const dark = document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
  $('#themeBtn').innerHTML = `${icon(dark ? 'sun' : 'moon', 20)}<span class="lbl">${dark ? 'Light mode' : 'Dark mode'}</span>`;
  $('#lockBtn').innerHTML = `${icon('lock', 20)}<span class="lbl">${lockEnabled() ? t('Lock') : 'App lock'}</span>`;
  $('#profileBtn').innerHTML = `${icon('users', 20)}<span class="lbl">${esc(activeProfile().name)}</span>`;
  $('#collapseBtn').innerHTML = `${icon('chevron', 20).replace('<svg', `<svg style="transform:scaleX(${state.settings.sidebarCollapsed ? 1 : -1})"`)}<span class="lbl">Collapse</span>`;
  $('#searchBtn .slbl').textContent = t('Search or jump to…');
  const bell = $('#bellBtn');
  bell.querySelector('.dot')?.remove();
  try { const { items } = state.txns.length ? recurringItems() : { items: [] }; if (items.some((r) => r.status === 'due-soon' || (r.hike && !r.hike.old))) bell.insertAdjacentHTML('beforeend', '<span class="dot"></span>'); } catch {}
}

function backupBanner() {
  const s = state.settings;
  if (!state.txns.length || !s.backupEveryDays || current === 'settings') return '';
  const today = toISO(new Date());
  const since = daysBetween(s.lastBackup || s.firstSeen || today, today);
  if (since <= (s.lastBackup ? s.backupEveryDays : Math.min(7, s.backupEveryDays)) || sessionStorage.getItem('pl:bk')) return '';
  return `<div class="banner no-print">${icon('download', 18)}<div style="flex:1">${s.lastBackup ? `Your last backup was ${since} days ago.` : 'You have not backed up your data yet.'} Your data lives only on this device.</div><button class="btn small" data-action="backup-now">Back up now</button><button class="btn small ghost" data-action="backup-snooze">Later</button></div>`;
}

function render({ keepScroll = false } = {}) {
  if (!state.ready) return;
  const raw = (location.hash.replace(/^#\//, '') || 'home').split('?')[0];
  const name = ALIAS[raw] || raw;
  current = ROUTES[name] ? name : 'home';
  const y = window.scrollY;
  buildShell();
  view.innerHTML = (['home', 'transactions', 'bills', 'plan', 'reports'].includes(current) ? backupBanner() : '') + ROUTES[current].fn();
  $$('nav.main a, #tabbar a').forEach((a) => a.classList.toggle('on', a.dataset.route === current));
  $('#pageTitle').textContent = t(ROUTES[current].title);
  document.title = `${t(ROUTES[current].title)} · Paisa Ledger`;
  $('#fab').style.display = ['import', 'settings'].includes(current) ? 'none' : '';
  bindDrops();
  animateCounts(view, fmt);
  if (keepScroll) window.scrollTo(0, y); else window.scrollTo(0, 0);
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
      if (obj.format === 'paisa-ledger-encrypted-v1') {
        pass = await modal({ title: 'Encrypted backup', body: '<input type="password" class="input" name="p" placeholder="Passphrase" autofocus>', buttons: [{ label: 'Cancel', value: null }, { label: 'Restore', value: (d) => d.querySelector('[name=p]').value, primary: true }] });
        if (pass == null) return;
      }
      await importBackup(obj, pass);
      toast('Backup restored.');
    } catch (e) { toast(e.message || 'Could not restore this file.'); }
    rs.value = '';
  };
}

// ───────────────────────── dialogs ─────────────────────────
const val = (d, n) => d.querySelector(`[name=${n}]`)?.value ?? '';
const num = (v) => { const x = parseFloat(String(v).replace(/[,₹\s]/g, '')); return Number.isFinite(x) ? x : 0; };
const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD', 'AUD', 'CAD', 'JPY', 'THB'];

async function addExpenseDialog() {
  const r = await modal({
    title: 'Add a transaction',
    body: `<div class="fields one">
      <div class="fields"><label class="field"><span>Date</span><input class="input" type="date" name="date" value="${toISO(new Date())}" required></label>
      <label class="field"><span>Type</span><select name="type"><option value="debit">Expense</option><option value="credit">Income</option></select></label></div>
      <label class="field"><span>What was it?</span><input class="input" name="desc" placeholder="e.g. Auto fare, Tea stall" required autofocus></label>
      <div class="fields"><label class="field"><span>Amount</span><input class="input" name="amount" inputmode="decimal" required></label>
      <label class="field"><span>Currency</span><select name="cur">${CURRENCIES.map((c) => `<option>${c}</option>`).join('')}</select></label></div>
      <label class="field" id="rateField" hidden><span>Exchange rate (₹ per 1 unit)</span><input class="input" name="rate" inputmode="decimal" placeholder="e.g. 83.5"></label>
      <label class="field"><span>Category</span><select name="cat">${categoryOptions('Uncategorized')}</select></label>
      <label class="field"><span>Tags <small>(optional, comma separated)</small></span><input class="input" name="tags"></label></div>`,
    onOpen: (d) => { d.querySelector('[name=cur]').onchange = (e) => { d.querySelector('#rateField').hidden = e.target.value === 'INR'; }; },
    buttons: [{ label: 'Cancel', value: null }, { label: 'Add', primary: true, value: (d) => ({ date: val(d, 'date'), desc: val(d, 'desc').trim(), amount: num(val(d, 'amount')), type: val(d, 'type'), category: val(d, 'cat'), cur: val(d, 'cur'), rate: num(val(d, 'rate')), tags: val(d, 'tags').split(',').map((x) => x.trim()).filter(Boolean) }) }],
  });
  if (!r || !r.desc || !(r.amount > 0) || !r.date) return;
  let amount = r.amount, fx;
  if (r.cur !== 'INR') {
    if (!(r.rate > 0)) return toast('Enter the exchange rate for ' + r.cur + '.');
    fx = { currency: r.cur, rate: r.rate, original: r.amount };
    amount = Math.round(r.amount * r.rate * 100) / 100;
  }
  await addManual({ date: r.date, desc: r.desc, amount, type: r.type, category: r.category, tags: r.tags, fx });
  toast('Added.');
}

async function editTxnDialog(id) {
  const tx = state.txns.find((x) => x.id === id);
  if (!tx) return;
  let deleted = false;
  const r = await modal({
    title: 'Transaction details', body: editBody(tx), wide: true,
    onOpen: (d) => {
      d.querySelector('#addSplit').onclick = () => d.querySelector('#splitRows').insertAdjacentHTML('beforeend', splitRow());
      d.addEventListener('click', (e) => { if (e.target.closest('[data-rmsplit]')) e.target.closest('.split-row').remove(); });
      d.querySelector('#delTxn').onclick = () => { deleted = true; d.close(); };
    },
    buttons: [{ label: 'Cancel', value: null }, { label: 'Save', primary: true, value: (d) => ({
      cat: val(d, 'cat'), note: val(d, 'note').trim(), tags: val(d, 'tags').split(',').map((x) => x.trim()).filter(Boolean),
      splits: $$('.split-row', d).map((row) => ({ category: row.querySelector('[name=splitCat]').value, amount: num(row.querySelector('[name=splitAmt]').value) })).filter((s) => s.amount > 0),
      shareWith: val(d, 'shareWith').trim(), shareAmt: num(val(d, 'shareAmt')), settled: !!d.querySelector('[name=shareSettled]')?.checked,
    }) }],
  });
  if (deleted) { await deleteTxns([id]); toast('Transaction deleted.'); return; }
  if (!r) return;
  const used = r.splits.reduce((a, s) => a + s.amount, 0);
  if (used > tx.amount + 0.01) return toast('The splits add up to more than the transaction.');
  const patch = { note: r.note, tags: r.tags.length ? r.tags : undefined, splits: r.splits.length ? r.splits : undefined };
  if (r.cat !== tx.category) Object.assign(patch, { category: r.cat, catSrc: 'user' });
  patch.share = r.shareWith && r.shareAmt > 0 ? { with: r.shareWith, amount: Math.min(r.shareAmt, tx.amount), settled: r.settled } : undefined;
  await updateTxn(id, patch);
  toast('Saved.');
}

async function goalDialog(g) {
  const r = await modal({
    title: g ? 'Edit goal' : 'New goal',
    body: `<div class="fields one"><label class="field"><span>Name</span><input class="input" name="name" value="${esc(g?.name || '')}" placeholder="e.g. Emergency fund" required autofocus></label>
      <label class="field"><span>Target (₹)</span><input class="input" name="target" inputmode="numeric" value="${g?.target || ''}" required></label>
      <label class="field"><span>Saved so far (₹)</span><input class="input" name="saved" inputmode="numeric" value="${g?.saved || 0}"></label>
      <label class="field"><span>Target date <small>(optional)</small></span><input class="input" type="date" name="deadline" value="${g?.deadline || ''}"></label></div>`,
    buttons: [...(g ? [{ label: 'Delete', value: 'del', danger: true }] : []), { label: 'Cancel', value: null }, { label: 'Save', primary: true, value: (d) => ({ name: val(d, 'name').trim(), target: num(val(d, 'target')), saved: num(val(d, 'saved')), deadline: val(d, 'deadline') || null }) }],
  });
  if (r === 'del') { state.goals = state.goals.filter((x) => x.id !== g.id); await saveMeta('goals'); return; }
  if (!r || !r.name || !(r.target > 0)) return;
  if (g) Object.assign(g, r); else state.goals.push({ id: crypto.randomUUID(), ...r });
  await saveMeta('goals');
}

async function accountDialog(a) {
  const stmt = [...new Map(state.txns.filter((x) => x.balance != null && x.source !== 'manual').map((x) => [x.account, x])).values()];
  const r = await modal({
    title: a ? 'Update account' : 'Add account',
    body: `<div class="fields one"><label class="field"><span>Name</span><input class="input" name="name" value="${esc(a?.name || '')}" placeholder="e.g. HDFC savings, Home loan" required autofocus></label>
      <label class="field"><span>Type</span><select name="type">${Object.entries(ACCOUNT_TYPES).map(([k, [l, kind]]) => `<option value="${k}" ${a?.type === k ? 'selected' : ''}>${l} ${kind === 'liability' ? '(you owe)' : ''}</option>`).join('')}</select></label>
      <label class="field"><span>Balance today (₹)</span><input class="input" name="balance" inputmode="decimal" value="${a?.balance ?? ''}" required></label>
      ${stmt.length ? `<p class="muted small" style="margin:0">Latest statement balances: ${stmt.map((x) => `<button type="button" class="link" data-fill="${x.balance}">${esc(x.account)} ${fmt(x.balance)}</button>`).join(' · ')}</p>` : ''}</div>`,
    onOpen: (d) => d.addEventListener('click', (e) => { const b = e.target.closest('[data-fill]'); if (b) d.querySelector('[name=balance]').value = b.dataset.fill; }),
    buttons: [...(a ? [{ label: 'Delete', value: 'del', danger: true }] : []), { label: 'Cancel', value: null }, { label: 'Save', primary: true, value: (d) => ({ name: val(d, 'name').trim(), type: val(d, 'type'), balance: num(val(d, 'balance')) }) }],
  });
  if (r === 'del') { state.accounts = state.accounts.filter((x) => x.id !== a.id); await saveMeta('accounts'); return; }
  if (!r || !r.name) return;
  const today = toISO(new Date());
  if (a) { Object.assign(a, { name: r.name, type: r.type, balance: r.balance }); a.history = [...a.history.filter((h) => h.date !== today), { date: today, balance: r.balance }]; }
  else state.accounts.push({ id: crypto.randomUUID(), name: r.name, type: r.type, balance: r.balance, history: [{ date: today, balance: r.balance }] });
  await saveMeta('accounts');
}

async function passphraseDialog(title, { confirm = true, old = false } = {}) {
  return modal({
    title, body: `<div class="fields one">${old ? '<label class="field"><span>Current passphrase</span><input class="input" type="password" name="old" autocomplete="current-password" autofocus></label>' : ''}
      <label class="field"><span>${old ? 'New passphrase' : 'Passphrase'} <small>(8+ characters recommended)</small></span><input class="input" type="password" name="p1" autocomplete="new-password" ${old ? '' : 'autofocus'}></label>
      ${confirm ? '<label class="field"><span>Repeat passphrase</span><input class="input" type="password" name="p2" autocomplete="new-password"></label>' : ''}
      <p class="warn-line" style="margin:0">${icon('alert', 16)}<span>If you forget it, your data cannot be recovered. Export a backup first.</span></p></div>`,
    buttons: [{ label: 'Cancel', value: null }, { label: 'Continue', primary: true, value: (d) => ({ old: val(d, 'old'), p1: val(d, 'p1'), p2: val(d, 'p2') }) }],
  });
}

const confirmBox = (title, body, label = 'Delete') => modal({ title, body: `<p>${body}</p>`, buttons: [{ label: 'Cancel', value: false }, { label, value: true, danger: true }] });
const textPrompt = async (title, initial = '', placeholder = '') => { const v = await modal({ title, body: `<input class="input" name="v" value="${esc(initial)}" placeholder="${esc(placeholder)}" autofocus>`, buttons: [{ label: 'Cancel', value: null }, { label: 'Save', primary: true, value: (d) => d.querySelector('[name=v]').value }] }); return v == null ? null : v.trim(); };

// ───────────────────────── actions ─────────────────────────
const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const setMonth = (m) => { state.ui.month = m; rerender(); };

const actions = {
  demo: async () => { const { added } = await importRows(demoTransactions(), 'Demo account', 'demo'); toast(`Loaded ${added} demo transactions. Remove them any time in Settings → Danger zone.`); location.hash = '#/home'; },
  'month-prev': () => { const ms = [...$$('[data-change=month] option')].map((o) => o.value).reverse(); const i = ms.indexOf(state.ui.month); if (i > 0) setMonth(ms[i - 1]); },
  'month-next': () => { const ms = [...$$('[data-change=month] option')].map((o) => o.value).reverse(); const i = ms.indexOf(state.ui.month); if (i < ms.length - 1) setMonth(ms[i + 1]); },
  'review-uncat': () => { Object.assign(state.ui.tx, { q: '', month: '', cat: 'Uncategorized', type: 'debit', account: '', tag: '', page: 1 }); },
  'add-txn': addExpenseDialog,
  'export-csv': () => {
    const head = ['Date', 'Description', 'Merchant', 'Category', 'Type', 'Amount', 'Account', 'Tags', 'Note'];
    download('transactions.csv', [head, ...filtered().map((x) => [x.date, x.desc, x.merchant, x.category, x.type, x.amount, x.account, (x.tags || []).join('; '), x.note])].map((r) => r.map(csvCell).join(',')).join('\n'), 'text/csv');
  },
  'tx-clear': () => { Object.assign(state.ui.tx, { q: '', month: '', cat: '', type: '', account: '', tag: '', page: 1 }); render(); },
  'tx-more': () => { state.ui.tx.page++; rerender(); },
  'tx-edit': (el) => editTxnDialog(el.dataset.id),
  'bulk-clear': () => { state.ui.selected = new Set(); rerender(); },
  'bulk-del': async () => { const n = state.ui.selected.size; if (await confirmBox(`Delete ${n} transaction${n === 1 ? '' : 's'}?`, 'They will be removed from your totals.')) { await deleteTxns([...state.ui.selected]); toast(`${n} deleted.`); } },
  'bulk-tag': async () => { const v = await textPrompt('Add a tag to the selected transactions', '', 'e.g. Goa trip'); if (v) await bulkUpdate([...state.ui.selected], (x) => { x.tags = [...new Set([...(x.tags || []), v])]; }); },
  'imp-commit': async (el) => { await commit(+el.dataset.i); },
  'imp-discard': (el) => { discard(+el.dataset.i); rerender(); },
  'sub-restore': async () => { for (const k of Object.keys(state.settings.overrides)) if (state.settings.overrides[k] === 'ignored') delete state.settings.overrides[k]; await saveSettings(); rerender(); },
  ics: () => { const { items } = recurringItems(); download('paisa-ledger-bills.ics', buildICS(items), 'text/calendar'); toast('Calendar file saved – open it to add the reminders.'); },
  'bill-cancel-help': (el) => {
    const g = cancelGuide(el.dataset.key);
    modal({ title: `How to stop: ${g.name}`, body: `<p>${esc(g.steps)}</p>${g.url ? `<p><a href="${esc(g.url)}" target="_blank" rel="noopener">Open the ${esc(g.name)} account page ↗</a></p>` : ''}<p class="muted small">Once you have cancelled, mark it “cancelled” here so it stops counting.</p>` });
  },
  'plan-tab': (el) => { state.ui.planTab = el.dataset.tab; rerender(); },
  'goal-new': () => goalDialog(null),
  'goal-edit': (el) => goalDialog(state.goals.find((g) => g.id === el.dataset.id)),
  'goal-add': async (el) => { const g = state.goals.find((x) => x.id === el.dataset.id); const v = await textPrompt(`Add savings to “${g.name}”`, '', 'Amount in ₹'); const n = num(v); if (n > 0) { g.saved += n; await saveMeta('goals'); toast(`Added ${fmt(n)}.`); } },
  'acct-new': () => accountDialog(null),
  'acct-edit': (el) => accountDialog(state.accounts.find((a) => a.id === el.dataset.id)),
  'share-settle': async (el) => {
    const tx = state.txns.find((x) => x.id === el.dataset.id);
    await updateTxn(tx.id, { share: { ...tx.share, settled: true } });
    // If the repayment shows up as an income credit, move it to Transfers so it is not counted as income.
    const m = state.txns.filter((x) => x.type === 'credit' && x.category !== 'Transfers' && Math.abs(x.amount - tx.share.amount) < 0.01 && x.date >= tx.date && daysBetween(tx.date, x.date) <= 60);
    if (m.length === 1) { await updateTxn(m[0].id, { category: 'Transfers', catSrc: 'user' }); toast(`Marked paid. The matching ${fmt(m[0].amount)} credit was filed under Transfers.`); } else toast('Marked as paid.');
  },
  'tax-tab': (el) => { state.ui.taxTab = el.dataset.tab; rerender(); },
  'tax-apply': async (el) => { state.settings.taxProfile[el.dataset.k] = +el.dataset.v; await saveSettings(); rerender(); },
  'doc-apply': async (el) => {
    const d = state.docs.find((x) => x.id === el.dataset.id);
    const ok = ['grossSalary', 'tdsDeducted', 'basicSalary', 'hraReceived', 'sec80C', 'savingsInterest', 'fdInterest'];
    for (const [k, v] of Object.entries(d.extracted)) if (ok.includes(k)) state.settings.taxProfile[k] = v;
    await saveSettings(); state.ui.taxTab = 'estimate'; toast('Applied to your estimate – please review the figures.'); rerender();
  },
  'doc-open': (el) => { const d = state.docs.find((x) => x.id === el.dataset.id); download(d.name, d.blob); },
  'doc-del': async (el) => { if (await confirmBox('Delete document?', 'This removes the stored copy from this device.')) await deleteDoc(el.dataset.id); },
  'rent-del': async (el) => saveRent(state.rent.filter((r) => r.id !== el.dataset.id)),
  'rent-fill': async () => {
    const f = $('[data-submit=rent-add]');
    const amount = num(f.amount.value), landlord = f.landlord.value.trim();
    if (!(amount > 0) || !landlord) return toast('Enter the rent amount and landlord name first.');
    const [a] = fyRange(state.settings.taxYear);
    const list = state.rent.filter((r) => !(r.month >= a.slice(0, 7) && r.month <= `${+a.slice(0, 4) + 1}-03`));
    for (let i = 0; i < 12; i++) { const d = new Date(+a.slice(0, 4), 3 + i, 1); list.push({ id: crypto.randomUUID(), month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, amount, landlord, pan: f.pan.value.toUpperCase() }); }
    await saveRent(list);
  },
  'rent-print': () => printReceipts(),
  'itr-copy': async () => { try { await navigator.clipboard.writeText(itrText()); toast('Summary copied.'); } catch { toast('Could not copy – select the table and copy it manually.'); } },
  'report-print': async () => { if (window.paisa?.savePDF) { const ok = await window.paisa.savePDF(`paisa-ledger-${state.ui.reportPeriod}.pdf`); if (ok) toast('PDF saved.'); } else window.print(); },
  'report-xlsx': () => { download(`paisa-ledger-${state.ui.reportPeriod}.xlsx`, buildXlsx(reportSheets(state.ui.reportPeriod))); },
  recat: async () => { const n = await recategorizeAll(); toast(`${n} change${n === 1 ? '' : 's'} applied.`); },
  'rule-del': async (el) => deleteRule(el.dataset.m),
  'rule-preview': () => { const f = $('[data-submit=rule-add]'); const pattern = f.pattern.value.trim(); if (!pattern) return; const n = previewRule({ pattern, category: f.category.value, type: f.type.value || undefined }); toast(`This rule would re-categorise ${n} existing transaction${n === 1 ? '' : 's'}.`); },
  'crule-del': async (el) => { state.customRules = state.customRules.filter((r) => r.id !== el.dataset.id); await saveMeta('customRules'); },
  'alias-del': async (el) => { delete state.aliases[el.dataset.m]; await saveMeta('aliases'); },
  backup: async () => {
    const pass = $('#bkpass').value;
    const data = await exportBackup(pass || null);
    download(`paisa-ledger-backup-${toISO(new Date())}${pass ? '-encrypted' : ''}.json`, JSON.stringify(data));
    toast(pass ? 'Encrypted backup saved. Keep the passphrase safe – it cannot be recovered.' : 'Backup saved.');
  },
  'backup-now': async () => { const data = await exportBackup(null); download(`paisa-ledger-backup-${toISO(new Date())}.json`, JSON.stringify(data)); toast('Backup saved. Store it somewhere safe (cloud drive, USB).'); rerender(); },
  'backup-snooze': () => { sessionStorage.setItem('pl:bk', '1'); rerender(); },
  persist: async () => toast((await navigator.storage?.persist?.()) ? 'Done – the browser will keep your data.' : 'The browser did not grant persistent storage.'),
  'lock-on': async () => {
    const r = await passphraseDialog('Set an app passphrase');
    if (!r) return;
    if (r.p1.length < 6) return toast('Use at least 6 characters (8+ is better).');
    if (r.p1 !== r.p2) return toast('The two passphrases do not match.');
    toast('Encrypting your data…', { ms: 8000 });
    await enableLock(r.p1);
    toast('App lock is on. Your data is now encrypted on this device.'); arm(); buildShell(); rerender();
  },
  'lock-off': async () => { if (await confirmBox('Turn off app lock?', 'Your data will be stored without encryption on this device.', 'Turn off')) { await disableLock(); toast('App lock turned off.'); buildShell(); rerender(); } },
  'lock-change': async () => {
    const r = await passphraseDialog('Change passphrase', { old: true });
    if (!r) return;
    if (r.p1.length < 6 || r.p1 !== r.p2) return toast('New passphrases must match and be at least 6 characters.');
    toast('Re-encrypting…', { ms: 8000 });
    toast((await changePassphrase(r.old, r.p1)) ? 'Passphrase changed.' : 'The current passphrase was wrong.');
    await load();
  },
  'lock-now': () => lockApp(),
  'profile-add': async () => { const n = await textPrompt('Name the new profile', '', 'e.g. Parents, Business'); if (n) { const id = addProfile(n); switchProfile(id); } },
  'profile-switch': (el) => switchProfile(el.dataset.id),
  'profile-rename': async (el) => { const p = profiles().find((x) => x.id === el.dataset.id); const n = await textPrompt('Rename profile', p.name); if (n) { renameProfile(p.id, n); buildShell(); rerender(); } },
  'profile-del': async (el) => { if (await confirmBox('Delete this profile?', 'All of its data will be erased permanently.')) { removeProfile(el.dataset.id); rerender(); } },
  wipe: async () => {
    const r = await modal({ title: 'Delete everything?', body: '<p>This cannot be undone. Export a backup first if you might need the data.</p><p>Type <b>DELETE</b> to confirm.</p><input class="input" name="c" autocomplete="off">', buttons: [{ label: 'Cancel', value: false }, { label: 'Delete all data', danger: true, value: (d) => d.querySelector('[name=c]').value === 'DELETE' }] });
    if (r) { await wipeAll(); batch.length = 0; toast('All data deleted.'); }
  },
};

const changes = {
  month: (el) => setMonth(el.value),
  'report-period': (el) => { state.ui.reportPeriod = el.value; rerender(); },
  'tx-month': (el) => { state.ui.tx.month = el.value; state.ui.tx.page = 1; rerender(); },
  'tx-cat': (el) => { state.ui.tx.cat = el.value; state.ui.tx.page = 1; rerender(); },
  'tx-type': (el) => { state.ui.tx.type = el.value; state.ui.tx.page = 1; rerender(); },
  'tx-tag': (el) => { state.ui.tx.tag = el.value; state.ui.tx.page = 1; rerender(); },
  'tx-account': (el) => { state.ui.tx.account = el.value; state.ui.tx.page = 1; rerender(); },
  'sel-one': (el) => { el.checked ? state.ui.selected.add(el.dataset.id) : state.ui.selected.delete(el.dataset.id); rerender(); },
  'sel-all': (el) => { const rows = filtered().slice(0, state.ui.tx.page * 100); rows.forEach((x) => (el.checked ? state.ui.selected.add(x.id) : state.ui.selected.delete(x.id))); rerender(); },
  'bulk-cat': async (el) => { if (!el.value) return; const ids = [...state.ui.selected]; await bulkUpdate(ids, (x) => { x.category = el.value; x.catSrc = 'user'; }); toast(`${ids.length} moved to ${el.value}.`); },
  'tx-cat-set': async (el) => {
    const tx = state.txns.find((x) => x.id === el.dataset.id);
    const cat = el.value;
    const n = state.txns.filter((x) => x.merchant === tx.merchant && x.type === tx.type).length;
    let similar = false;
    if (n > 1) {
      const r = await modal({ title: `Move to “${cat}”?`, body: `<p>${n} transactions look like <b>${esc(tx.merchant)}</b>. Apply to all of them (and remember for future imports) or just this one?</p>`, buttons: [{ label: 'Cancel', value: null }, { label: 'Only this one', value: 'one' }, { label: `All ${n}`, value: 'all', primary: true }] });
      if (!r) return rerender();
      similar = r === 'all';
    }
    const undo = await setCategory(tx.id, cat, similar);
    toast(similar ? `Moved ${n} “${tx.merchant}” transactions to ${cat}.` : 'Category updated.', { action: 'Undo', onAction: undo });
  },
  'sub-action': async (el) => { const v = el.value; if (!v) return; if (v === 'active') delete state.settings.overrides[el.dataset.key]; else state.settings.overrides[el.dataset.key] = v; await saveSettings(); rerender(); },
  notify: async (el) => {
    if (el.checked) { const p = await requestNotify(); if (p !== 'granted') { el.checked = false; return toast('Notifications are blocked for this app. Allow them in your system or browser settings.'); } }
    state.settings.notify = el.checked; await saveSettings();
    if (el.checked) { const { items } = recurringItems(); toast(`Reminders on. ${notifyDue(items) || 'No'} payment(s) due soon.`); }
  },
  'tax-year': async (el) => { state.settings.taxYear = el.value; await saveSettings(); rerender(); },
  'tax-biz': async (el) => { state.settings.taxProfile.businessType = el.value; await saveSettings(); $('#taxResult').innerHTML = resultHtml(); },
  'tax-age': async (el) => { state.settings.taxProfile.age = el.value; await saveSettings(); $('#taxResult').innerHTML = resultHtml(); },
  'tax-flag': async (el) => { state.settings.taxProfile[el.dataset.k] = el.checked; await saveSettings(); $('#taxResult').innerHTML = resultHtml(); },
  theme: async (el) => { state.settings.theme = el.value; await saveSettings(); applyPrefs(); buildShell(); },
  lang: async (el) => { state.settings.lang = el.value; await saveSettings(); applyPrefs(); render({ keepScroll: true }); },
  textSize: async (el) => { state.settings.textSize = el.value; await saveSettings(); applyPrefs(); },
  contrast: async (el) => { state.settings.contrast = el.value; await saveSettings(); applyPrefs(); },
  lockMinutes: async (el) => { state.settings.lockMinutes = +el.value; await saveSettings(); arm(); },
  backupEvery: async (el) => { state.settings.backupEveryDays = +el.value; await saveSettings(); },
};

let debounce;
const later = (f, ms = 200) => { clearTimeout(debounce); debounce = setTimeout(f, ms); };
const inputs = {
  'tx-q': (el) => { state.ui.tx.q = el.value; state.ui.tx.page = 1; later(() => { rerender(); const i = $('[data-input=tx-q]'); i?.focus(); i?.setSelectionRange(i.value.length, i.value.length); }, 250); },
  'tax-field': (el) => { state.settings.taxProfile[el.dataset.k] = num(el.value); later(async () => { await saveSettings(); const r = $('#taxResult'); if (r) r.innerHTML = resultHtml(); }, 150); },
  'tax-text': (el) => { state.settings.taxProfile[el.dataset.k] = el.value; later(saveSettings, 400); },
  budget: (el) => { const v = num(el.value); if (v > 0) state.settings.budgets[el.dataset.cat] = v; else delete state.settings.budgets[el.dataset.cat]; later(saveSettings, 400); },
  'imp-account': (el) => { batch[+el.dataset.i].account = el.value; },
};

const submits = {
  'rent-add': async (f) => {
    const amount = num(f.amount.value), pan = f.pan.value.trim().toUpperCase();
    if (!(amount > 0)) return;
    if (pan && !/^[A-Z]{5}\d{4}[A-Z]$/.test(pan)) return toast('That PAN does not look right (format ABCDE1234F).');
    const list = state.rent.filter((r) => r.month !== f.month.value);
    list.push({ id: crypto.randomUUID(), month: f.month.value, amount, landlord: f.landlord.value.trim(), pan });
    await saveRent(list);
  },
  'rule-add': async (f) => {
    const pattern = f.pattern.value.trim();
    if (!pattern) return;
    state.customRules.push({ id: crypto.randomUUID(), pattern, category: f.category.value, type: f.type.value || undefined });
    await saveMeta('customRules');
    const n = await recategorizeAll();
    toast(`Rule added. ${n} existing change${n === 1 ? '' : 's'}.`);
  },
  'alias-add': async (f) => {
    const a = f.from.value.trim().toUpperCase(), b = f.to.value.trim().toUpperCase();
    if (!a || !b || a === b) return;
    state.aliases[a] = b;
    await saveMeta('aliases');
    const n = await recategorizeAll();
    toast(`Merged “${a}” into “${b}”. ${n} update${n === 1 ? '' : 's'}.`);
  },
};

delegate(document.body, { ...actions, ...changes, ...inputs, ...submits });

// ───────────────────────── command palette ─────────────────────────
const pal = { open: false, items: [], idx: 0 };
function paletteItems(q) {
  const ql = q.trim().toLowerCase();
  const nav = Object.entries(ROUTES).map(([k, r]) => ({ group: 'Go to', icon: r.icon, label: t(r.title), run: () => { location.hash = `#/${k}`; } }));
  const cmds = [
    { group: 'Actions', icon: 'plus', label: 'Add expense', hint: 'Ctrl N', run: addExpenseDialog },
    { group: 'Actions', icon: 'upload', label: 'Import a statement', run: () => { location.hash = '#/import'; } },
    { group: 'Actions', icon: 'moon', label: 'Toggle dark mode', run: () => $('#themeBtn').click() },
    { group: 'Actions', icon: 'download', label: 'Export backup', run: () => actions['backup-now']() },
    { group: 'Actions', icon: 'lock', label: 'Lock app', hint: 'Ctrl L', run: () => (lockApp() || toast('Turn on app lock in Settings first.')) },
    { group: 'Actions', icon: 'sparkle', label: 'Load demo data', run: actions.demo },
  ];
  let out = [...nav, ...cmds].filter((i) => !ql || i.label.toLowerCase().includes(ql));
  if (ql.length >= 2) {
    const hits = state.txns.filter((x) => x.desc.toLowerCase().includes(ql) || x.merchant.toLowerCase().includes(ql) || String(x.amount) === ql || (x.tags || []).some((g) => g.toLowerCase() === ql)).slice(0, 6);
    out = [...hits.map((x) => ({ group: 'Transactions', icon: 'receipt', label: `${x.merchant} · ${fmt2(x.amount)}`, hint: longDate(x.date), run: () => { Object.assign(state.ui.tx, { q, month: '', cat: '', type: '', account: '', tag: '', page: 1 }); location.hash = '#/transactions'; render(); } })), ...(hits.length ? [{ group: 'Transactions', icon: 'search', label: `See all results for “${q}”`, run: () => { Object.assign(state.ui.tx, { q, month: '', cat: '', type: '', account: '', tag: '', page: 1 }); location.hash = '#/transactions'; render(); } }] : []), ...out];
  }
  return out;
}
function paintPalette() {
  const q = $('#paletteInput').value;
  pal.items = paletteItems(q);
  pal.idx = Math.min(pal.idx, Math.max(0, pal.items.length - 1));
  let last = '';
  $('#paletteList').innerHTML = pal.items.map((it, i) => { const g = it.group !== last ? `<div class="palette-group">${it.group}</div>` : ''; last = it.group; return `${g}<div class="palette-item ${i === pal.idx ? 'on' : ''}" data-i="${i}">${icon(it.icon, 18)}<span>${esc(it.label)}</span>${it.hint ? `<small>${esc(it.hint)}</small>` : ''}</div>`; }).join('') || '<div class="empty">No matches</div>';
  $('#paletteList .on')?.scrollIntoView({ block: 'nearest' });
}
function openPalette() { if (!state.ready) return; pal.open = true; pal.idx = 0; $('#palette').hidden = false; $('#paletteInput').value = ''; paintPalette(); $('#paletteInput').focus(); }
function closePalette() { pal.open = false; $('#palette').hidden = true; }
function runPalette(i) { const it = pal.items[i]; closePalette(); it?.run(); }
$('#paletteInput').addEventListener('input', () => { pal.idx = 0; paintPalette(); });
$('#paletteInput').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') { e.preventDefault(); pal.idx = Math.min(pal.items.length - 1, pal.idx + 1); paintPalette(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); pal.idx = Math.max(0, pal.idx - 1); paintPalette(); }
  else if (e.key === 'Enter') { e.preventDefault(); runPalette(pal.idx); }
});
$('#paletteList').addEventListener('click', (e) => { const el = e.target.closest('.palette-item'); if (el) runPalette(+el.dataset.i); });
$('#palette').addEventListener('mousedown', (e) => { if (e.target.id === 'palette') closePalette(); });
$('#searchBtn').addEventListener('click', openPalette);
document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); pal.open ? closePalette() : openPalette(); }
  else if (e.key === 'Escape' && pal.open) closePalette();
  else if (mod && e.key.toLowerCase() === 'l') { e.preventDefault(); lockApp(); }
  else if (mod && e.key.toLowerCase() === 'n' && state.ready && !document.querySelector('dialog[open]')) { e.preventDefault(); addExpenseDialog(); }
});

// ───────────────────────── wiring & boot ─────────────────────────
onChange(() => { if (state.ready) queueRender(); });
let queued = false;
function queueRender() {
  if (queued) return;
  queued = true;
  queueMicrotask(() => { queued = false; if (!document.activeElement?.matches?.('input.input[data-input], input[data-input]')) rerender(); });
}
window.addEventListener('hashchange', () => render());
addEventListener('scroll', () => $('#topbar').classList.toggle('scrolled', scrollY > 4), { passive: true });
$('#themeBtn').addEventListener('click', async () => {
  const dark = document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
  state.settings.theme = dark ? 'light' : 'dark';
  await saveSettings(); applyPrefs(); buildShell();
});
$('#lockBtn').addEventListener('click', () => { if (!lockApp()) { location.hash = '#/settings'; toast('Set up an app lock here to protect your data.'); } });
$('#profileBtn').addEventListener('click', () => { location.hash = '#/settings'; });
$('#collapseBtn').addEventListener('click', async () => { state.settings.sidebarCollapsed = !state.settings.sidebarCollapsed; await saveSettings(); applyPrefs(); buildShell(); });
$('#bellBtn').addEventListener('click', () => { location.hash = '#/bills'; });
document.addEventListener('click', (e) => { if (e.target.closest('#moreBtn')) openPalette(); });
installTooltips(document);
if (window.paisa?.desktop) {
  document.documentElement.classList.add('is-desktop', `is-${window.paisa.platform}`);
  window.paisa.onNavigate((h) => { location.hash = h; });
  window.paisa.onAction((a) => actions[a]?.());
}

async function afterUnlock() {
  await load();
  applyPrefs();
  render();
  const run = () => { if (state.settings.notify && state.txns.length) try { notifyDue(recurringItems().items); } catch {} };
  run();
  setInterval(run, 3600000);
}

(async function boot() {
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
  if (lockEnabled() && !isUnlocked()) { applyPrefs(); showLock(afterUnlock); return; }
  await afterUnlock();
})();
