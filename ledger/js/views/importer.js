import { state, previewImport, importRows } from '../store.js';
import { readPdf, pagesToText, PasswordCancelled } from '../pdfio.js';
import { parseStatementPages, parseCSVStatement } from '../parser.js';
import { categorize } from '../categorize.js';
import { askPassword, toast } from '../ui.js';
import { esc, fmt2, longDate, shortDate } from '../util.js';

/** Parsed-but-not-yet-saved statements. */
export const batch = [];
let busy = null;

export async function processFiles(files, rerender) {
  for (const file of files) {
    busy = file.name;
    rerender();
    const item = { name: file.name, status: 'ok', rows: [], warnings: [], stats: {}, meta: {}, account: '', rawText: '' };
    try {
      if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') {
        const pdf = await readPdf(file, askPassword);
        if (!pdf.textChars) {
          item.status = 'error';
          item.error = 'This PDF has no selectable text (it looks like a scan or photo). Scanned statements need OCR, which is not available offline yet – download the CSV/Excel version from your bank instead, or use a text-based PDF.';
        } else {
          const r = parseStatementPages(pdf.pages);
          Object.assign(item, r);
          item.rawText = pagesToText(pdf.pages).slice(0, 6000);
        }
      } else {
        const r = parseCSVStatement(await file.text());
        Object.assign(item, r);
      }
      if (item.status === 'ok' && !item.rows.length) {
        item.status = 'error';
        item.error = item.warnings[0] || 'No transactions found in this file.';
      }
      if (item.status === 'ok') {
        const bank = item.meta?.bank || file.name.replace(/\.[^.]+$/, '');
        item.account = item.meta?.accountTail ? `${bank} ••${item.meta.accountTail}` : bank;
      }
    } catch (e) {
      item.status = e instanceof PasswordCancelled ? 'skipped' : 'error';
      item.error = e instanceof PasswordCancelled ? 'Skipped – password not provided.' : `Could not read this file: ${e.message || e}`;
    }
    batch.push(item);
  }
  busy = null;
  rerender();
}

export async function commit(i) {
  const it = batch[i];
  const { added, skipped } = await importRows(it.rows, it.account.trim() || 'Account', it.name);
  batch.splice(i, 1);
  toast(`Imported ${added} transactions${skipped ? ` (${skipped} duplicates skipped)` : ''}.`);
}

export const discard = (i) => batch.splice(i, 1);

export function importer() {
  return `
  <div class="page-head"><h1>Import statements</h1></div>
  <section class="card">
    <label class="drop" id="drop" tabindex="0">
      <input type="file" id="file" accept=".pdf,.csv,.txt,application/pdf,text/csv" multiple hidden>
      <div class="drop-icon" aria-hidden="true">⬆</div>
      <b>Drop statement PDFs or CSVs here</b>
      <span class="muted">or click to choose. Several files at once is fine.</span>
    </label>
    <p class="privacy">🔒 Files are read inside your browser. Nothing is uploaded; passwords are never stored.</p>
    ${busy ? `<p class="busy"><span class="spin"></span> Reading <b>${esc(busy)}</b>…</p>` : ''}
  </section>
  ${batch.map((it, i) => card(it, i)).join('')}
  <section class="card tips"><h2>Tips for best results</h2><ul>
    <li><b>Any bank:</b> the reader finds the Date / Debit / Credit / Balance columns by itself and double-checks every row against the running balance.</li>
    <li><b>Duplicates are safe:</b> importing overlapping statements never counts a transaction twice.</li>
    <li><b>Credit-card statements:</b> import the CSV if you have it; the bill payment from your bank account is tracked as a transfer so spending isn't counted twice.</li>
    <li><b>Something looks off?</b> Open the extracted text under any file below and compare with the PDF.</li></ul></section>`;
}

function card(it, i) {
  if (it.status !== 'ok') {
    return `<section class="card ${it.status === 'error' ? 'bad-card' : ''}"><div class="card-head"><h2>${esc(it.name)}</h2><button class="btn ghost" data-action="imp-discard" data-i="${i}">Dismiss</button></div><p>${esc(it.error)}</p>${it.rawText ? `<details><summary>Show extracted text</summary><pre class="raw">${esc(it.rawText)}</pre></details>` : ''}</section>`;
  }
  const { fresh, dupes } = previewImport(it.rows, it.account);
  const s = it.stats;
  const ok = s.checked ? s.reconciled === s.checked : null;
  const preview = it.rows.slice(0, 8).map((r) => ({ ...r, category: categorize(r, state.rules).category }));
  return `<section class="card" data-i="${i}">
    <div class="card-head"><h2>${esc(it.name)}</h2>
      ${ok === true ? '<span class="chip good">✓ Balances reconcile</span>' : ok === false ? '<span class="chip bad">Balance mismatch</span>' : '<span class="chip">No balance column to verify</span>'}</div>
    <div class="facts">
      <div><span class="muted">Period</span><b>${longDate(s.from)} – ${longDate(s.to)}</b></div>
      <div><span class="muted">Rows read</span><b>${s.total}</b></div>
      <div><span class="muted">New</span><b>${fresh}</b></div>
      <div><span class="muted">Already stored</span><b>${dupes}</b></div></div>
    <label class="field"><span>Account name</span><input class="input" value="${esc(it.account)}" data-input="imp-account" data-i="${i}" maxlength="40"></label>
    ${it.warnings.map((w) => `<p class="warn-line">⚠ ${esc(w)}</p>`).join('')}
    <div class="table-wrap"><table class="tx small"><thead><tr><th>Date</th><th>Description</th><th>Category</th><th class="num">Amount</th></tr></thead><tbody>
      ${preview.map((r) => `<tr><td class="nowrap">${shortDate(r.date)}</td><td class="clip">${esc(r.desc)}</td><td>${esc(r.category)}</td><td class="num ${r.type === 'credit' ? 'pos' : ''}">${r.type === 'credit' ? '+' : ''}${fmt2(r.amount)}</td></tr>`).join('')}</tbody></table></div>
    ${it.rows.length > 8 ? `<p class="muted small">…and ${it.rows.length - 8} more rows.</p>` : ''}
    ${it.rawText ? `<details><summary>Show extracted text</summary><pre class="raw">${esc(it.rawText)}</pre></details>` : ''}
    <div class="row gap end"><button class="btn ghost" data-action="imp-discard" data-i="${i}">Discard</button><button class="btn primary" data-action="imp-commit" data-i="${i}" ${fresh ? '' : 'disabled'}>Import ${fresh} transaction${fresh === 1 ? '' : 's'}</button></div></section>`;
}
