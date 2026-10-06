import { state, accounts, allTags } from '../store.js';
import { ALL_CATS, colorOf, displayMerchant, groupOf } from '../categorize.js';
import { icon } from '../icons.js';
import { emptyBlock } from '../ui.js';
import { esc, fmt2, longDate, monthKey, monthLabel, shortDate } from '../util.js';

const PAGE = 100;

export function filtered() {
  const f = state.ui.tx;
  const q = f.q.trim().toLowerCase();
  return state.txns.filter((t) =>
    (!f.month || monthKey(t.date) === f.month) &&
    (!f.cat || t.category === f.cat || t.splits?.some((s) => s.category === f.cat)) &&
    (!f.type || t.type === f.type) &&
    (!f.account || t.account === f.account) &&
    (!f.tag || t.tags?.includes(f.tag)) &&
    (!q || t.desc.toLowerCase().includes(q) || t.merchant.toLowerCase().includes(q) || (t.note || '').toLowerCase().includes(q) || (t.tags || []).some((x) => x.toLowerCase().includes(q)) || String(t.amount).includes(q)));
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
  const sel = state.ui.selected;
  const tags = allTags();
  const active = f.q || f.month || f.cat || f.type || f.account || f.tag;
  return `
  <div class="page-head"><div><h1>Transactions</h1><p>${state.txns.length.toLocaleString('en-IN')} in total</p></div>
    <div class="row gap"><button class="btn" data-action="export-csv">${icon('download', 17)} Export CSV</button><button class="btn primary" data-action="add-txn">${icon('plus', 17)} Add expense</button></div></div>
  <section class="card filters">
    <div class="grow row gap" style="position:relative"><span style="position:absolute;left:12px;color:var(--text-3)">${icon('search', 17)}</span><input class="input" style="width:100%;padding-left:38px" type="search" placeholder="Search narration, merchant, note, tag or amount…" value="${esc(f.q)}" data-input="tx-q" aria-label="Search"></div>
    <select data-change="tx-month" aria-label="Month"><option value="">All months</option>${months.map((m) => `<option value="${m}" ${f.month === m ? 'selected' : ''}>${monthLabel(m)}</option>`).join('')}</select>
    <select data-change="tx-cat" aria-label="Category"><option value="">All categories</option>${categoryOptions(f.cat)}</select>
    <select data-change="tx-type" aria-label="Type"><option value="">Debit &amp; credit</option><option value="debit" ${f.type === 'debit' ? 'selected' : ''}>Debits</option><option value="credit" ${f.type === 'credit' ? 'selected' : ''}>Credits</option></select>
    ${tags.length ? `<select data-change="tx-tag" aria-label="Tag"><option value="">All tags</option>${tags.map((x) => `<option ${f.tag === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>` : ''}
    ${accounts().length > 1 ? `<select data-change="tx-account" aria-label="Account"><option value="">All accounts</option>${accounts().map((a) => `<option ${f.account === a ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select>` : ''}
    ${active ? `<button class="btn ghost" data-action="tx-clear">${icon('x', 15)} Clear</button>` : ''}
  </section>
  ${sel.size ? `<div class="bulkbar"><span>${sel.size} selected</span><select class="mini" data-change="bulk-cat" aria-label="Set category"><option value="">Set category…</option>${categoryOptions('')}</select><button class="btn small" data-action="bulk-tag">${icon('tag', 15)} Add tag</button><button class="btn small danger" data-action="bulk-del">${icon('trash', 15)} Delete</button><button class="btn small ghost" data-action="bulk-clear">Cancel</button></div>` : `<p class="summary">${rows.length.toLocaleString('en-IN')} shown · out <b class="tnum">${fmt2(dr)}</b> · in <b class="tnum">${fmt2(cr)}</b></p>`}
  <section class="card flush"><div class="table-wrap"><table class="tx">
    <thead><tr><th style="width:36px"><input class="rowcheck" type="checkbox" data-change="sel-all" aria-label="Select all shown" ${shown.length && shown.every((t) => sel.has(t.id)) ? 'checked' : ''}></th><th>Date</th><th>Description</th><th>Category</th><th class="num">Amount</th><th></th></tr></thead>
    <tbody>${shown.map((t) => `<tr class="${sel.has(t.id) ? 'sel' : ''}">
      <td><input class="rowcheck" type="checkbox" data-change="sel-one" data-id="${t.id}" ${sel.has(t.id) ? 'checked' : ''} aria-label="Select"></td>
      <td class="nowrap" title="${longDate(t.date)}">${shortDate(t.date)}<div class="faint xs">${t.date.slice(0, 4)}</div></td>
      <td><div class="desc">${esc(displayMerchant(t.merchant))}</div><div class="faint xs clip" title="${esc(t.desc)}">${esc(t.desc)}</div>
        <div class="row gap wrap" style="margin-top:3px;gap:5px">${(t.tags || []).map((x) => `<span class="chip tag">${icon('tag', 11)}${esc(x)}</span>`).join('')}${t.splits?.length ? `<span class="chip info">${icon('split', 11)}Split</span>` : ''}${t.share ? `<span class="chip ${t.share.settled ? 'good' : 'warn'}">${icon('users', 11)}${esc(t.share.with)} ${t.share.settled ? 'paid' : 'owes ' + fmt2(t.share.amount)}</span>` : ''}${t.fx ? `<span class="chip">${esc(t.fx.currency)} ${t.fx.original}</span>` : ''}</div>
        ${t.note ? `<div class="note">${esc(t.note)}</div>` : ''}</td>
      <td><span class="catdot" style="background:${colorOf(t.category)}"></span><select class="catsel ${t.category === 'Uncategorized' ? 'warn' : ''}" data-change="tx-cat-set" data-id="${t.id}" aria-label="Category">${categoryOptions(t.category)}</select></td>
      <td class="num ${t.type === 'credit' ? 'pos' : ''}">${t.type === 'credit' ? '+' : ''}${fmt2(t.amount)}</td>
      <td class="acts"><button class="icon" data-action="tx-edit" data-id="${t.id}" title="Details, tags, split, share" aria-label="Edit transaction">${icon('edit', 17)}</button></td></tr>`).join('') || `<tr><td colspan="6">${emptyBlock('search', 'No transactions match', 'Try clearing a filter or searching for something else.')}</td></tr>`}</tbody></table></div>
    ${rows.length > shown.length ? `<div class="center pad"><button class="btn" data-action="tx-more">Show more (${(rows.length - shown.length).toLocaleString('en-IN')} left)</button></div>` : ''}
  </section>`;
}

/** Detail editor body (used in a modal by app.js). */
export function editBody(t) {
  const splits = t.splits || [];
  return `<div class="stack">
    <div class="muted small">${esc(t.desc)}<br>${longDate(t.date)} · ${fmt2(t.amount)} · ${esc(t.account)}</div>
    <label class="field"><span>Category</span><select name="cat">${categoryOptions(t.category)}</select></label>
    <label class="field"><span>Note</span><input class="input" name="note" maxlength="140" value="${esc(t.note || '')}"></label>
    <label class="field"><span>Tags <small>(comma separated – e.g. Goa trip, work)</small></span><input class="input" name="tags" value="${esc((t.tags || []).join(', '))}"></label>
    <fieldset style="margin:0"><legend>${icon('split', 14)} Split across categories</legend>
      <div id="splitRows" class="stack">${splits.map((s) => splitRow(s.category, s.amount)).join('')}</div>
      <button type="button" class="btn small" id="addSplit" style="margin-top:10px">${icon('plus', 14)} Add split</button>
      <p class="muted xs" style="margin:8px 0 0">The rest stays in the main category above.</p></fieldset>
    ${t.type === 'debit' ? `<fieldset style="margin:0"><legend>${icon('users', 14)} Shared with someone</legend>
      <div class="fields"><label class="field"><span>Who owes you?</span><input class="input" name="shareWith" value="${esc(t.share?.with || '')}" placeholder="e.g. Ravi"></label>
      <label class="field"><span>Their share (₹)</span><input class="input" name="shareAmt" inputmode="decimal" value="${t.share?.amount || ''}"></label></div>
      <label class="check" style="margin-top:10px"><input type="checkbox" name="shareSettled" ${t.share?.settled ? 'checked' : ''}> They have paid me back</label></fieldset>` : ''}
    <div class="row between"><button type="button" class="btn danger small" id="delTxn">${icon('trash', 14)} Delete transaction</button></div>
  </div>`;
}
export const splitRow = (cat = 'Groceries', amount = '') => `<div class="row gap split-row"><select name="splitCat" class="grow">${categoryOptions(cat)}</select><input class="input" name="splitAmt" inputmode="decimal" placeholder="₹" style="width:110px" value="${amount}"><button type="button" class="icon" data-rmsplit aria-label="Remove split">${icon('x', 16)}</button></div>`;
