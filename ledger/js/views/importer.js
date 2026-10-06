import { state, previewImport, importRows, saveMeta } from '../store.js';
import { readPdf, pagesToText, PasswordCancelled } from '../pdfio.js';
import { parseStatementPages, parseCSVText, parseTable, matchDate } from '../parser.js';
import { readXlsx } from '../xlsx.js';
import { ocrPdfDoc, ocrImage } from '../ocr.js';
import { categorize } from '../categorize.js';
import { askPassword, toast, modal } from '../ui.js';
import { icon } from '../icons.js';
import { esc, fmt2, longDate, shortDate } from '../util.js';

/** Parsed-but-not-yet-saved statements. */
export const batch = [];
let busy = null;      // { name, stage, fraction }

const setBusy = (rerender, b) => { busy = b; rerender(); };

/** Let the user point at the Date / Debit / Credit / Amount / Balance columns of an unrecognised table. */
async function mapColumns(table) {
  const n = Math.max(...table.slice(0, 12).map((r) => r.length));
  const first = Math.max(0, table.findIndex((r) => r.some((c) => matchDate(String(c).trim()))));
  const roles = [['', 'Ignore'], ['date', 'Date'], ['desc', 'Description'], ['dr', 'Debit / withdrawal'], ['cr', 'Credit / deposit'], ['amt', 'Amount (±)'], ['type', 'Dr/Cr marker'], ['bal', 'Balance']];
  const guess = (i) => { const sample = table.slice(first, first + 6).map((r) => String(r[i] ?? '').trim()); if (sample.some((c) => matchDate(c))) return 'date'; if (sample.every((c) => /^-?[\d,]+(\.\d+)?$/.test(c) || !c)) return ''; return sample.some((c) => /[A-Za-z]{3}/.test(c)) ? 'desc' : ''; };
  const body = `<p class="muted">We couldn't recognise the columns automatically. Tell us what each column is – we'll remember this layout.</p>
    <label class="field" style="max-width:240px"><span>First transaction row</span><input class="input" type="number" min="1" name="first" value="${first + 1}"></label>
    <div class="table-wrap" style="margin-top:12px"><table class="tx small"><thead><tr>${Array.from({ length: n }, (_, i) => `<th><select class="mini" name="role${i}">${roles.map(([v, l]) => `<option value="${v}" ${guess(i) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></th>`).join('')}</tr></thead>
    <tbody>${table.slice(0, 10).map((r) => `<tr>${Array.from({ length: n }, (_, i) => `<td class="clip">${esc(r[i] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  return modal({
    title: 'Map the columns', body, wide: true,
    buttons: [{ label: 'Cancel', value: null }, { label: 'Use this layout', primary: true, value: (d) => {
      const idx = {};
      for (let i = 0; i < n; i++) { const v = d.querySelector(`[name=role${i}]`).value; if (v && idx[v] == null) idx[v] = i; }
      return { hi: (+d.querySelector('[name=first]').value || 1) - 2, idx, n };
    } }],
  });
}

async function parseTableWithMapping(table, name) {
  let r = parseTable(table);
  if (!r.needsMapping) return r;
  const n = Math.max(...table.slice(0, 12).map((x) => x.length));
  const remembered = state.colmaps[`n${n}`];
  if (remembered) { const rr = parseTable(table, remembered); if (rr.rows.length) return rr; }
  const m = await mapColumns(table);
  if (!m || m.idx.date == null || (m.idx.dr == null && m.idx.cr == null && m.idx.amt == null)) return { ...r, warnings: ['Column mapping was cancelled or incomplete – choose at least Date and an amount column.'] };
  r = parseTable(table, m);
  if (r.rows.length) { state.colmaps[`n${n}`] = { hi: m.hi, idx: m.idx }; saveMeta('colmaps'); }
  return r;
}

export async function processFiles(files, rerender) {
  for (const file of files) {
    setBusy(rerender, { name: file.name, stage: 'Reading file…' });
    const item = { name: file.name, status: 'ok', rows: [], warnings: [], stats: {}, meta: {}, account: '', rawText: '', ocr: false };
    try {
      const isPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
      const isImg = /\.(png|jpe?g|webp|bmp)$/i.test(file.name) || file.type.startsWith('image/');
      const isXlsx = /\.xlsx$/i.test(file.name);
      if (isPdf) {
        const pdf = await readPdf(file, askPassword);
        let pages = pdf.pages;
        if (!pdf.textChars) {
          item.ocr = true;
          setBusy(rerender, { name: file.name, stage: 'No text layer – reading the scan with OCR (first run loads the engine)…', fraction: 0 });
          pages = await ocrPdfDoc(pdf.doc, (i, n, f) => setBusy(rerender, { name: file.name, stage: `OCR page ${i} of ${n}`, fraction: (i - 1 + f) / n }));
        }
        Object.assign(item, parseStatementPages(pages));
        item.rawText = pagesToText(pages).slice(0, 6000);
        if (item.ocr) item.warnings.unshift('Read from a scan using OCR – please check amounts and dates against the original before importing.');
      } else if (isImg) {
        item.ocr = true;
        setBusy(rerender, { name: file.name, stage: 'Reading the image with OCR…', fraction: 0 });
        const pages = await ocrImage(file, (i, n, f) => setBusy(rerender, { name: file.name, stage: 'Reading the image with OCR…', fraction: f }));
        Object.assign(item, parseStatementPages(pages));
        item.rawText = pagesToText(pages).slice(0, 6000);
        item.warnings.unshift('Read from an image using OCR – please check amounts and dates before importing.');
      } else if (isXlsx) {
        Object.assign(item, await parseTableWithMapping(await readXlsx(await file.arrayBuffer()), file.name));
      } else {
        Object.assign(item, await parseTableWithMapping(parseCSVText((await file.text()).replace(/^﻿/, '')), file.name));
      }
      if (!item.rows.length) { item.status = 'error'; item.error = item.warnings[0] || 'No transactions found in this file.'; }
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
  setBusy(rerender, null);
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
  <div class="page-head"><div><h1>Import statements</h1><p>PDF, scanned PDF, photo, Excel or CSV – from any bank.</p></div></div>
  <section class="card">
    <label class="drop" id="drop" tabindex="0">
      <input type="file" id="file" accept=".pdf,.csv,.txt,.xlsx,.png,.jpg,.jpeg,.webp,application/pdf,text/csv,image/*" multiple hidden>
      <div class="drop-icon" aria-hidden="true">${icon('upload', 28)}</div>
      <b style="font-size:1.1rem">Drop statements here</b>
      <span class="muted">or click to choose · several files at once is fine</span>
    </label>
    <p class="privacy">${icon('shield', 17)} Files are read inside this app. Nothing is uploaded; passwords are never stored.</p>
    ${busy ? `<div class="busy" style="flex-direction:column;align-items:stretch"><div class="row gap"><span class="spin"></span><span>${esc(busy.name)} — ${esc(busy.stage)}</span></div>${busy.fraction != null ? `<div class="progress"><i style="width:${Math.round(busy.fraction * 100)}%"></i></div>` : ''}</div>` : ''}
  </section>
  ${batch.map((it, i) => card(it, i)).join('')}
  <section class="card"><div class="card-head"><h2>${icon('info', 18)} How it works</h2></div><ul class="ticks">
    <li><b>Any bank:</b> columns are found automatically and every row is checked against the running balance.</li>
    <li><b>Scans and photos:</b> read with offline OCR. Always double-check the numbers.</li>
    <li><b>Excel / CSV:</b> if the layout isn't recognised you can map the columns once – it's remembered.</li>
    <li><b>Duplicates are safe:</b> importing overlapping statements never counts a transaction twice.</li>
    <li><b>Credit-card statements:</b> import as CSV/Excel; bill payments from your bank account are tracked as transfers so spending isn't counted twice.</li></ul></section>`;
}

function card(it, i) {
  if (it.status !== 'ok') {
    return `<section class="card ${it.status === 'error' ? 'bad-card' : ''}"><div class="card-head"><h2>${icon(it.status === 'error' ? 'alert' : 'info', 18)} ${esc(it.name)}</h2><button class="btn ghost" data-action="imp-discard" data-i="${i}">Dismiss</button></div><p>${esc(it.error)}</p>${it.rawText ? `<details><summary>Show extracted text</summary><pre class="raw">${esc(it.rawText)}</pre></details>` : ''}</section>`;
  }
  const { fresh, dupes } = previewImport(it.rows, it.account);
  const s = it.stats;
  const ok = s.checked ? s.reconciled === s.checked : null;
  const preview = it.rows.slice(0, 8).map((r) => ({ ...r, category: categorize(r, state.rules, { custom: state.customRules, aliases: state.aliases }).category }));
  return `<section class="card" data-i="${i}">
    <div class="card-head"><h2>${icon(it.ocr ? 'scan' : 'file', 18)} ${esc(it.name)}</h2>
      ${ok === true ? `<span class="chip good">${icon('check', 13)} Balances reconcile</span>` : ok === false ? `<span class="chip bad">${icon('alert', 13)} Balance mismatch</span>` : '<span class="chip">No balance column to verify</span>'}</div>
    <div class="facts">
      <div><span>Period</span><b>${longDate(s.from)} – ${longDate(s.to)}</b></div>
      <div><span>Rows read</span><b>${s.total}</b></div>
      <div><span>New</span><b>${fresh}</b></div>
      <div><span>Already stored</span><b>${dupes}</b></div></div>
    <label class="field" style="max-width:320px"><span>Account name</span><input class="input" value="${esc(it.account)}" data-input="imp-account" data-i="${i}" maxlength="40"></label>
    ${it.warnings.map((w) => `<p class="warn-line">${icon('alert', 16)}<span>${esc(w)}</span></p>`).join('')}
    <div class="table-wrap" style="margin-top:10px"><table class="tx small"><thead><tr><th>Date</th><th>Description</th><th>Category</th><th class="num">Amount</th></tr></thead><tbody>
      ${preview.map((r) => `<tr><td class="nowrap">${shortDate(r.date)}</td><td class="clip">${esc(r.desc)}</td><td>${esc(r.category)}</td><td class="num ${r.type === 'credit' ? 'pos' : ''}">${r.type === 'credit' ? '+' : ''}${fmt2(r.amount)}</td></tr>`).join('')}</tbody></table></div>
    ${it.rows.length > 8 ? `<p class="muted small">…and ${it.rows.length - 8} more rows.</p>` : ''}
    ${it.rawText ? `<details><summary>Show extracted text</summary><pre class="raw">${esc(it.rawText)}</pre></details>` : ''}
    <div class="row gap end"><button class="btn ghost" data-action="imp-discard" data-i="${i}">Discard</button><button class="btn primary" data-action="imp-commit" data-i="${i}" ${fresh ? '' : 'disabled'}>${icon('check', 17)} Import ${fresh} transaction${fresh === 1 ? '' : 's'}</button></div></section>`;
}
