import { state, accounts } from '../store.js';
import { ALL_CATS, colorOf, displayMerchant, groupOf } from '../categorize.js';
import { esc, fmt2, longDate, monthKey, monthLabel, shortDate } from '../util.js';

const PAGE = 100;

export function filtered() {
  const f = state.ui.tx;
  const q = f.q.trim().toLowerCase();
  return state.txns.filter((t) =>
    (!f.month || monthKey(t.date) === f.month) &&
    (!f.cat || t.category === f.cat) &&
    (!f.type || t.type === f.type) &&
    (!f.account || t.account === f.account) &&
    (!q || t.desc.toLowerCase().includes(q) || t.merchant.toLowerCase().includes(q) || (t.note || '').toLowerCase().includes(q) || String(t.amount).includes(q)));
}

export function categoryOptions(sel) {
  const groups = { spend: 'Spending', save: 'Saving', transfer: 'Transfers', income: 'Income' };
  return Object.entries(groups).map(([g, label]) => `<optgroup label="${label}">${ALL_CATS.filter((c) => groupOf(c) === g).map((c) => `<option ${c === sel ? 'selected' : ''}>${esc(c)}</option>`).join('')}</optgroup>`).join('');
}

export function transactions() {
  const f = state.ui.tx;
  const months = [...new Set(state.txns.map((t) => monthKey(t.date)))].sort().reverse();
  const rows = filtered();
  const shown = rows.slice(0, f.page * PAGE);
  const dr = rows.filter((t) => t.type === 'debit').reduce((a, t) => a + t.amount, 0);
  const cr = rows.filter((t) => t.type === 'credit').reduce((a, t) => a + t.amount, 0);
  return `
  <div class="page-head"><h1>Transactions</h1>
    <div class="row gap"><button class="btn" data-action="add-txn">+ Add expense</button><button class="btn" data-action="export-csv">Export CSV</button></div></div>
  <section class="card filters">
    <input class="input grow" type="search" placeholder="Search narration, merchant, note or amount…" value="${esc(f.q)}" data-input="tx-q" aria-label="Search">
    <select data-change="tx-month" aria-label="Month"><option value="">All months</option>${months.map((m) => `<option value="${m}" ${f.month === m ? 'selected' : ''}>${monthLabel(m)}</option>`).join('')}</select>
    <select data-change="tx-cat" aria-label="Category"><option value="">All categories</option>${categoryOptions(f.cat)}</select>
    <select data-change="tx-type" aria-label="Type"><option value="">Debit & credit</option><option value="debit" ${f.type === 'debit' ? 'selected' : ''}>Debits</option><option value="credit" ${f.type === 'credit' ? 'selected' : ''}>Credits</option></select>
    ${accounts().length > 1 ? `<select data-change="tx-account" aria-label="Account"><option value="">All accounts</option>${accounts().map((a) => `<option ${f.account === a ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select>` : ''}
    ${(f.q || f.month || f.cat || f.type || f.account) ? '<button class="btn ghost" data-action="tx-clear">Clear</button>' : ''}
  </section>
  <p class="muted summary">${rows.length.toLocaleString('en-IN')} transactions · out <b>${fmt2(dr)}</b> · in <b>${fmt2(cr)}</b></p>
  <section class="card flush"><div class="table-wrap"><table class="tx">
    <thead><tr><th>Date</th><th>Description</th><th>Category</th><th class="num">Amount</th><th></th></tr></thead>
    <tbody>${shown.map((t) => `<tr>
      <td class="nowrap" title="${longDate(t.date)}">${shortDate(t.date)}<div class="muted small">${t.date.slice(0, 4)}</div></td>
      <td><div class="desc">${esc(displayMerchant(t.merchant))}</div><div class="muted small clip" title="${esc(t.desc)}">${esc(t.desc)}</div>${t.note ? `<div class="note">📝 ${esc(t.note)}</div>` : ''}</td>
      <td><span class="catdot" style="background:${colorOf(t.category)}"></span><select class="catsel ${t.category === 'Uncategorized' ? 'warn' : ''}" data-change="tx-cat-set" data-id="${t.id}" aria-label="Category">${categoryOptions(t.category)}</select></td>
      <td class="num ${t.type === 'credit' ? 'pos' : ''}">${t.type === 'credit' ? '+' : ''}${fmt2(t.amount)}</td>
      <td class="acts"><button class="icon" data-action="tx-note" data-id="${t.id}" title="Add note" aria-label="Edit note">✎</button><button class="icon" data-action="tx-del" data-id="${t.id}" title="Delete" aria-label="Delete transaction">✕</button></td></tr>`).join('') || `<tr><td colspan="5" class="muted center pad">No transactions match.</td></tr>`}</tbody></table></div>
    ${rows.length > shown.length ? `<div class="center pad"><button class="btn" data-action="tx-more">Show more (${rows.length - shown.length} left)</button></div>` : ''}
  </section>`;
}
