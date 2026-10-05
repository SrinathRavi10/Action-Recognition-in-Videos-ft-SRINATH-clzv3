// Bank statement parsing: PDF text positions -> transactions, and CSV -> transactions.
// Pure functions (no DOM, no pdf.js) so they can be unit-tested in Node.
import { parseAmount } from './util.js';

const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

function validISO(y, m, d) {
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(y, m - 1, d);
  if (dt.getMonth() !== m - 1) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Match a date at the start of `str`. Day-first (Indian) unless ISO. Returns { iso, len } or null. */
export function matchDate(str) {
  const s = String(str).trimStart();
  const lead = String(str).length - s.length;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?!\d)/);
  if (m) {
    const iso = validISO(+m[1], +m[2], +m[3]);
    return iso && { iso, len: lead + m[0].length };
  }
  m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4}|\d{2})(?!\d)/);
  if (m) {
    let y = +m[3];
    if (y < 100) y += 2000;
    let d = +m[1], mo = +m[2];
    if (mo > 12 && d <= 12) [d, mo] = [mo, d];
    const iso = validISO(y, mo, d);
    return iso && { iso, len: lead + m[0].length };
  }
  m = s.match(/^(\d{1,2})[\s\-\/.]*([A-Za-z]{3,9})[\s\-\/.,]*(\d{4}|\d{2})(?!\d)/);
  if (m && MON[m[2].toLowerCase().slice(0, m[2].toLowerCase().startsWith('sept') ? 4 : 3)]) {
    let y = +m[3];
    if (y < 100) y += 2000;
    const iso = validISO(y, MON[m[2].toLowerCase().slice(0, m[2].toLowerCase().startsWith('sept') ? 4 : 3)], +m[1]);
    return iso && { iso, len: lead + m[0].length };
  }
  return null;
}

/** Group pdf.js text items ({str,x,y,w}) of one page into lines, top to bottom, left to right. */
export function groupLines(items, tol = 2.5) {
  const its = items.filter((i) => i.str && i.str.trim()).sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  for (const it of its) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - it.y) <= tol) {
      last.items.push(it);
    } else {
      lines.push({ y: it.y, items: [it] });
    }
  }
  for (const l of lines) l.items.sort((a, b) => a.x - b.x);
  return lines;
}

/** Split line items on whitespace, estimating each token's x-extent. */
function tokenize(line) {
  const tokens = [];
  for (const it of line.items) {
    const w = it.w || it.str.length * 5;
    const len = it.str.length || 1;
    const re = /\S+/g;
    let m;
    while ((m = re.exec(it.str))) {
      tokens.push({ s: m[0], x0: it.x + (m.index / len) * w, x1: it.x + ((m.index + m[0].length) / len) * w });
    }
  }
  return tokens;
}

const AMT_RE = /^\(?-?(?:₹|rs\.?)?\d[\d,]*\.\d{1,2}\)?(?:dr|cr)?\.?$/i;
const DRCR_RE = /^(dr|cr|debit|credit)\.?$/i;

function amountFrom(token, next) {
  let side = null;
  const m = token.s.match(/(dr|cr)\.?$/i);
  if (m) side = m[1].toLowerCase();
  const v = parseAmount(token.s.replace(/(dr|cr)\.?$/i, ''));
  if (v == null) return null;
  let consumed = 0;
  if (!side && next && DRCR_RE.test(next.s)) {
    side = next.s.toLowerCase().startsWith('d') ? 'dr' : 'cr';
    consumed = 1;
  }
  const neg = /^\(|^-/.test(token.s);
  return { value: v, side, neg, x0: token.x0, x1: token.x1, consumed };
}

const HDR = {
  date: /\b(date|dt)\b/i,
  desc: /narration|description|particulars|details|remarks|transaction/i,
  dr: /withdraw|debit|\bdr\b|paid out|money out/i,
  cr: /deposit|credit|\bcr\b|paid in|money in/i,
  bal: /balance|\bbal\b/i,
};
const FOOTER_RE = /^(page\s*\d|page no|statement\b|opening balance|closing balance|total\b|grand total|registered office|this is a computer|end of statement|generated on|\*+|disclaimer|toll free|customer care|branch|ifsc|micr|nomination|abbreviations|legends?)/i;

function detectHeader(tokens) {
  const text = tokens.map((t) => t.s).join(' ');
  const has = Object.fromEntries(Object.entries(HDR).map(([k, re]) => [k, re.test(text)]));
  const isHeader = (has.date && (has.dr || has.cr || has.bal) && !AMT_RE.test(tokens.at(-1)?.s || '')) || (has.desc && (has.dr || has.cr) && has.bal);
  if (!isHeader) return null;
  const cols = {};
  const centre = (t) => (t.x0 + t.x1) / 2;
  let sawCombined = false;
  for (const t of tokens) {
    if (/^dr\s*\/\s*cr$|^cr\s*\/\s*dr$/i.test(t.s)) { sawCombined = true; continue; }
    if (!cols.desc && HDR.desc.test(t.s)) cols.desc = { c: centre(t), l: t.x0, r: t.x1 };
    if (!cols.ref && /^(chq|cheque|ref|reference|instrument|txn\s*id)/i.test(t.s)) cols.ref = { c: centre(t), l: t.x0, r: t.x1 };
    if (!cols.dr && HDR.dr.test(t.s)) cols.dr = { c: centre(t), l: t.x0, r: t.x1 };
    else if (!cols.cr && HDR.cr.test(t.s)) cols.cr = { c: centre(t), l: t.x0, r: t.x1 };
    else if (!cols.bal && HDR.bal.test(t.s)) cols.bal = { c: centre(t), l: t.x0, r: t.x1 };
  }
  // Headers like "Withdrawal Amt." keep the keyword token; widen to include the following word for better centring.
  return { cols, sawCombined };
}

function nearestCol(a, cols) {
  let best = null, bestD = Infinity;
  for (const [role, c] of Object.entries(cols)) {
    if (role === 'ref' || role === 'desc') continue;
    const d = Math.min(Math.abs((a.x0 + a.x1) / 2 - c.c), Math.abs(a.x1 - c.r), Math.abs(a.x0 - c.l));
    if (d < bestD) { bestD = d; best = role; }
  }
  return best;
}

const BANKS = [
  ['HDFC Bank', /HDFC BANK/i], ['ICICI Bank', /ICICI BANK/i], ['State Bank of India', /STATE BANK OF INDIA|\bSBI\b/i],
  ['Axis Bank', /AXIS BANK/i], ['Kotak Mahindra Bank', /KOTAK/i], ['IDFC FIRST Bank', /IDFC/i], ['Yes Bank', /YES BANK/i],
  ['Punjab National Bank', /PUNJAB NATIONAL/i], ['Bank of Baroda', /BANK OF BARODA/i], ['Canara Bank', /CANARA/i],
  ['IndusInd Bank', /INDUSIND/i], ['Federal Bank', /FEDERAL BANK/i], ['Union Bank', /UNION BANK/i], ['IDBI Bank', /IDBI/i],
  ['Standard Chartered', /STANDARD CHARTERED/i], ['Paytm Payments Bank', /PAYTM PAYMENTS/i], ['AU Small Finance Bank', /AU SMALL/i],
];

function detectMeta(pages) {
  const head = pages.slice(0, 2).flatMap((p) => p.map((l) => l.items.map((i) => i.str).join(' '))).join('\n');
  const bank = (BANKS.find(([, re]) => re.test(head)) || [])[0] || null;
  const acc = head.match(/a\/?c(?:count)?\s*(?:no\.?|number|#)?\s*[:\-]?\s*([0-9Xx*]{6,})/i);
  return { bank, accountTail: acc ? acc[1].slice(-4) : null };
}

const HEADER_VOCAB = /^(date|dt|value|txn|tran|transaction|posting|narration|description|particulars|details|remarks|chq|cheque|ref|reference|no|number|amt|amount|withdrawal|withdrawals|debit|debits|credit|credits|deposit|deposits|dr|cr|balance|bal|closing|running|opening|instrument|id|type|branch|code|sr|sl|s|n|mode|and|in|out|rs|inr)$/i;
const headerLike = (line) => line.items.every((it) => it.str.split(/[^A-Za-z]+/).filter(Boolean).every((w) => HEADER_VOCAB.test(w)));

/** Headers are often stacked over 2-3 lines ("Withdrawal" / "Amt."); merge them so column positions are all found. */
function mergeHeaderLines(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    let merged = null;
    for (const k of [3, 2]) {
      const group = lines.slice(i, i + k);
      if (group.length < k || group[0].y - group[k - 1].y > 30 || !group.every(headerLike)) continue;
      const items = group.flatMap((l) => l.items).sort((a, b) => a.x - b.x);
      const line = { y: group[0].y, items };
      const tokens = tokenize(line);
      const text = tokens.map((t) => t.s).join(' ');
      if (tokens.some((t) => AMT_RE.test(t.s)) || group.some((l) => matchDate(tokenize(l).map((t) => t.s).join(' ')))) continue;
      if (detectHeader(tokens)) { merged = { line, k }; break; }
    }
    if (merged) { out.push(merged.line); i += merged.k - 1; } else out.push(lines[i]);
  }
  return out;
}

const isDateToken = (s) => { const m = matchDate(s); return !!m && m.len >= s.length; };

/** Split a token list into amounts and narration words, dropping value dates and anything in the Ref/Chq column. */
function splitTokens(tokens, cols) {
  const amounts = [], words = [];
  // Only drop the Ref/Chq column when it sits to the right of the narration column.
  const refL = cols?.ref && cols?.desc && cols.ref.l > cols.desc.l ? cols.ref.l - 0.3 * (cols.ref.r - cols.ref.l) : null; // headers are often centred over left-aligned data
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (AMT_RE.test(t.s)) {
      const a = amountFrom(t, tokens[i + 1]);
      if (a) { amounts.push(a); i += a.consumed; continue; }
    }
    if (isDateToken(t.s)) continue;
    if (refL != null && t.x0 >= refL) continue;
    words.push(t.s);
  }
  return { amounts, words };
}

/**
 * Decide which lines between two fixed lines (date lines / headers / footers) belong to the upper or lower one.
 * The row separator is the largest vertical gap in the run, which handles top-aligned, centred and multi-line
 * narrations with the same rule. Ties go to the upper line (classic "continuation lines follow the date line").
 * Returns k: the first k free lines belong to the upper fixed line.
 */
function splitPoint(upY, free, downY) {
  const ys = [upY, ...free.map((l) => l.y), downY];
  const gaps = ys.slice(1).map((y, i) => ys[i] - y);
  const max = Math.max(...gaps);
  let k = 0;
  gaps.forEach((g, j) => { if (g >= max * 0.97) k = j; });
  return k;
}

/**
 * Parse statement pages into raw rows. `pages` is an array (per page) of lines from groupLines().
 * Returns { rows, opening, meta, warnings, stats }.
 */
export function parseStatementPages(pages) {
  const meta = detectMeta(pages);
  const raw = [];
  let cols = null;
  let combined = false;
  let opening = null;
  const warnings = [];

  /** Date-line tokens after the date(s). */
  const afterDate = (tokens, text, d) => {
    let consumed = d.len;
    const rest0 = text.slice(consumed).trimStart();
    const d2 = matchDate(rest0);
    if (d2) consumed = text.length - rest0.length + d2.len;
    let pos = 0;
    const rest = [];
    for (const t of tokens) {
      const at = text.indexOf(t.s, pos);
      pos = at + t.s.length;
      if (at >= consumed) rest.push(t);
    }
    return rest;
  };

  const buildTxn = (anchor, pre, post) => {
    const words = [];
    let amounts = [];
    const take = (x, isAnchor) => {
      const r = splitTokens(isAnchor ? afterDate(x.tokens, x.text, x.date) : x.tokens, cols);
      return r;
    };
    for (const x of pre) {
      const r = take(x, false);
      if (r.amounts.length) continue; // an amount-bearing line above the date line is not narration
      words.push(...r.words);
    }
    const ra = take(anchor, true);
    words.push(...ra.words);
    amounts = ra.amounts;
    let cont = 0;
    for (const x of post) {
      const r = take(x, false);
      if (r.amounts.length) { if (amounts.length) break; amounts = r.amounts; }
      if (++cont > 4) break;
      words.push(...r.words);
    }
    return { date: anchor.date.iso, words, amounts, cols, combined };
  };

  for (const rawLines of pages) {
    const lines = mergeHeaderLines(rawLines);
    const info = lines.map((line) => {
      const tokens = tokenize(line);
      const text = tokens.map((t) => t.s).join(' ');
      const hdr = tokens.length ? detectHeader(tokens) : null;
      const date = !hdr && tokens.length ? matchDate(text) : null;
      let kind = 'free';
      if (!tokens.length) kind = 'skip';
      else if (hdr) kind = 'header';
      else if (date) kind = 'anchor';
      else if (/opening balance|brought forward|b\/f|balance b\/f/i.test(text)) kind = 'break';
      else if (FOOTER_RE.test(text)) kind = 'break';
      return { line, tokens, text, hdr, date, kind, y: line.y };
    });
    // Opening balance + column layout can change at each header, so walk in order.
    const fixed = [];
    info.forEach((x, i) => {
      if (x.kind === 'skip') return;
      if (x.kind === 'free') return;
      fixed.push(i);
    });
    // Column snapshots per anchor: columns are those of the closest header above it.
    let curCols = cols, curCombined = combined;
    const colsAt = new Map();
    for (let i = 0; i < info.length; i++) {
      const x = info[i];
      if (x.kind === 'header' && (x.hdr.cols.dr || x.hdr.cols.cr || x.hdr.cols.bal)) { curCols = x.hdr.cols; curCombined = x.hdr.sawCombined; }
      if (x.kind === 'break' && /opening balance|brought forward|b\/f/i.test(x.text) && opening == null) {
        const am = x.tokens.map((t, j) => (AMT_RE.test(t.s) ? amountFrom(t, x.tokens[j + 1]) : null)).filter(Boolean);
        if (am.length) opening = am.at(-1).value * (am.at(-1).side === 'dr' ? -1 : 1);
      }
      colsAt.set(i, [curCols, curCombined]);
    }
    cols = curCols; combined = curCombined;

    const pre = new Map(), post = new Map();
    const freeBetween = (f, g) => { const out = []; for (let i = f + 1; i < g; i++) if (info[i].kind === 'free') out.push(info[i]); return out; };
    for (let n = 0; n <= fixed.length; n++) {
      const f = n === 0 ? -1 : fixed[n - 1];
      const g = n === fixed.length ? info.length : fixed[n];
      const free = freeBetween(f, g);
      if (!free.length) continue;
      const up = f >= 0 && info[f].kind === 'anchor' ? f : null;
      const down = g < info.length && info[g].kind === 'anchor' ? g : null;
      if (up != null && down != null) {
        const k = splitPoint(info[up].y, free, info[down].y);
        post.set(up, free.slice(0, k)); pre.set(down, free.slice(k));
      } else if (up != null) {
        post.set(up, free);
      } else if (down != null && f >= 0) {
        const k = splitPoint(info[f].y, free, info[down].y);
        pre.set(down, free.slice(k));
      } else if (down != null) {
        // lines above the first fixed line on the page: only the ones hugging the date line
        const nearest = free.filter((x) => info[down].y - x.y > -20 && x.y - info[down].y < 20);
        pre.set(down, nearest.length === free.length ? free : []);
      }
    }
    info.forEach((x, i) => {
      if (x.kind !== 'anchor') return;
      const [c, cm] = colsAt.get(i);
      cols = c; combined = cm;
      const t = buildTxn(x, pre.get(i) || [], post.get(i) || []);
      if (t.amounts.length) raw.push(t);
    });
  }

  if (!raw.length) return { rows: [], opening, meta, warnings: ['No transaction rows were recognised.'], stats: { total: 0, reconciled: 0, checked: 0 }, columns: !!cols };
  const rows = raw.map((r) => buildRow(r, r.cols, r.combined));
  return finalize(rows, opening, meta, warnings, !!cols);
}

function buildRow(r, cols, combined) {
  const desc = r.words.join(' ').replace(/\s+/g, ' ').trim();
  const am = r.amounts;
  let amount = null, balance = null, hard = null;

  if (cols && (cols.dr || cols.cr) && !combined) {
    const roles = am.map((a) => nearestCol(a, cols));
    for (let i = 0; i < am.length; i++) {
      if (roles[i] === 'bal') balance = am[i].side === 'dr' ? -am[i].value : am[i].value;
      else if (roles[i] === 'dr') { amount = am[i].value; hard = 'debit'; }
      else if (roles[i] === 'cr') { amount = am[i].value; hard = 'credit'; }
    }
    if (amount == null && am.length) { amount = am[0].value; }
  } else {
    // Single amount column (optionally with Dr/Cr marker) + optional balance.
    if (am.length >= 2) {
      amount = am[am.length - 2].value;
      balance = am.at(-1).side === 'dr' ? -am.at(-1).value : am.at(-1).value;
      const s = am[am.length - 2].side;
      if (s) hard = s === 'dr' ? 'debit' : 'credit';
      else if (am[am.length - 2].neg) hard = 'debit';
    } else if (am.length === 1) {
      amount = am[0].value;
      if (am[0].side) hard = am[0].side === 'dr' ? 'debit' : 'credit';
      else if (am[0].neg) hard = 'debit';
    }
  }
  return { date: r.date, desc, amount, balance, hard };
}

const CREDIT_WORDS = /\b(salary|refund|reversal|cashback|interest|int\.? ?pd|credit|received|deposit|dividend|redemption|rev)\b/i;

function finalize(rows, opening, meta, warnings, hasCols) {
  rows = rows.filter((r) => r.amount != null && r.amount > 0);
  // Statements are sometimes listed newest-first; the balance chain needs chronological order.
  let desc = false;
  if (rows.length > 1) {
    let down = 0, up = 0;
    for (let i = 1; i < rows.length; i++) {
      if (rows[i].date < rows[i - 1].date) down++;
      else if (rows[i].date > rows[i - 1].date) up++;
    }
    desc = down > up;
  }
  if (desc) rows.reverse();

  let prev = opening;
  let checked = 0, reconciled = 0;
  for (const r of rows) {
    let chain = null;
    if (prev != null && r.balance != null) {
      const isDebit = Math.abs(prev - r.amount - r.balance) < 0.011;
      const isCredit = Math.abs(prev + r.amount - r.balance) < 0.011;
      checked++;
      if (isDebit || isCredit) reconciled++;
      if (isDebit && !isCredit) chain = 'debit';
      else if (isCredit && !isDebit) chain = 'credit';
    }
    r.type = chain || r.hard || (CREDIT_WORDS.test(r.desc) ? 'credit' : 'debit');
    r.typeSource = chain ? 'balance' : r.hard ? 'column' : 'keyword';
    if (r.balance != null) prev = r.balance;
    else if (prev != null) prev += r.type === 'credit' ? r.amount : -r.amount;
  }
  const guessed = rows.filter((r) => r.typeSource === 'keyword').length;
  if (guessed) warnings.push(`${guessed} row(s) had no debit/credit column or balance to verify against – direction was guessed from the narration. Please review.`);
  if (checked && reconciled < checked) warnings.push(`Running balance did not reconcile on ${checked - reconciled} of ${checked} rows – some rows may be missing or mis-read.`);
  if (!hasCols && !rows.some((r) => r.hard)) warnings.push('Could not find Debit/Credit columns; used balance changes and keywords instead.');
  const dates = rows.map((r) => r.date).sort();
  return {
    rows: rows.map(({ date, desc, amount, balance, type, typeSource }) => ({ date, desc, amount, balance, type, typeSource })),
    opening, meta, warnings,
    stats: { total: rows.length, checked, reconciled, from: dates[0], to: dates.at(-1) },
    columns: hasCols,
  };
}

// ---------------------------------------------------------------- CSV

export function parseCSVText(text) {
  const first = text.split(/\r?\n/).slice(0, 5).join('\n');
  const delim = [',', ';', '\t', '|'].map((d) => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

const CSV_H = {
  date: /^(txn\.?|tran\.?|transaction|posting|value)?\s*date$|^date$|^dt$/i,
  desc: /narration|description|particulars|details|remarks|transaction remarks|payee/i,
  dr: /withdraw|debit|\bdr\b|paid out/i,
  cr: /deposit|credit|\bcr\b|paid in/i,
  amt: /^amount|^amt|transaction amount/i,
  bal: /balance/i,
  type: /^(dr\s*\/\s*cr|cr\s*\/\s*dr|type|txn type|transaction type)$/i,
};

export function parseCSVStatement(text) {
  const table = parseCSVText(text.replace(/^﻿/, ''));
  let hi = table.findIndex((r) => r.some((c) => CSV_H.date.test(c.trim())) && r.some((c) => CSV_H.dr.test(c) || CSV_H.cr.test(c) || CSV_H.amt.test(c.trim())));
  if (hi < 0) return { rows: [], warnings: ['Could not find a header row with Date and Amount/Debit/Credit columns.'], stats: { total: 0, checked: 0, reconciled: 0 }, meta: {} };
  const head = table[hi].map((c) => c.trim());
  const idx = {};
  head.forEach((h, i) => {
    for (const k of Object.keys(CSV_H)) {
      if (idx[k] == null && CSV_H[k].test(h)) { idx[k] = i; break; }
    }
  });
  if (idx.date == null) idx.date = head.findIndex((h) => /date/i.test(h));
  const out = [];
  for (const r of table.slice(hi + 1)) {
    const d = matchDate((r[idx.date] || '').trim());
    if (!d) continue;
    const desc = (r[idx.desc] ?? '').replace(/\s+/g, ' ').trim();
    let amount = null, type = null;
    const dr = idx.dr != null ? parseAmount(r[idx.dr]) : null;
    const cr = idx.cr != null ? parseAmount(r[idx.cr]) : null;
    if (dr) { amount = dr; type = 'debit'; }
    else if (cr) { amount = cr; type = 'credit'; }
    else if (idx.amt != null) {
      const raw = (r[idx.amt] || '').trim();
      amount = parseAmount(raw.replace(/^-/, ''));
      if (/^-|^\(/.test(raw)) type = 'debit';
      const t = idx.type != null ? (r[idx.type] || '').trim() : '';
      if (/^(dr|d|debit)/i.test(t)) type = 'debit';
      else if (/^(cr|c|credit)/i.test(t)) type = 'credit';
      else if (/dr\.?$/i.test(raw)) type = 'debit';
      else if (/cr\.?$/i.test(raw)) type = 'credit';
      if (!type) type = 'credit';
    }
    if (!amount) continue;
    const balance = idx.bal != null ? parseAmount(r[idx.bal]) : null;
    out.push({ date: d.iso, desc, amount, balance, type, typeSource: 'column' });
  }
  const dates = out.map((r) => r.date).sort();
  const warnings = [];
  if (!out.length) warnings.push('No transaction rows were recognised.');
  return { rows: out, warnings, stats: { total: out.length, checked: 0, reconciled: 0, from: dates[0], to: dates.at(-1) }, meta: {} };
}
