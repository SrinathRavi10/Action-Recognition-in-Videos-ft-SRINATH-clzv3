import { state } from '../store.js';
import { monthlyTotals, categoryBreakdown, topMerchants } from '../analytics.js';
import { yearSummary } from '../insights.js';
import { FAMILIES, SPEND_FAMILIES, familyColor, colorOf, displayMerchant, familyOf } from '../categorize.js';
import { donut, hbars, stackedBars } from '../charts.js';
import { recurringItems } from './bills.js';
import { icon } from '../icons.js';
import { emptyBlock } from '../ui.js';
import { esc, fmt, fmt2, monthLabel, monthName, sum, longDate, toISO } from '../util.js';

export function reportPeriods() {
  const months = monthlyTotals(state.txns).map((t) => t.month);
  const years = [...new Set(months.map((m) => m.slice(0, 4)))];
  return { months: [...months].reverse(), years: years.reverse() };
}

/** Transactions for "2026-03" (month) or "2026" (calendar year). */
export const periodTxns = (p) => state.txns.filter((t) => t.date.startsWith(p));

export function report() {
  if (!state.txns.length) return `<div class="page-head"><h1>Reports</h1></div><section class="card">${emptyBlock('report', 'No data yet', 'Import statements to generate reports.')}</section>`;
  const { months, years } = reportPeriods();
  const p = state.ui.reportPeriod && (months.includes(state.ui.reportPeriod) || years.includes(state.ui.reportPeriod)) ? state.ui.reportPeriod : months[0];
  state.ui.reportPeriod = p;
  const txns = periodTxns(p);
  const totals = monthlyTotals(txns);
  const income = sum(totals, (t) => t.income), spend = sum(totals, (t) => t.spend), save = sum(totals, (t) => t.save);
  const cats = categoryBreakdown(txns);
  const byFam = SPEND_FAMILIES.map((f) => ({ name: FAMILIES[f].name, color: familyColor(f), value: sum(cats.filter((c) => familyOf(c.category) === f), (c) => c.amount) })).filter((x) => x.value > 0);
  const merchants = topMerchants(txns, null, 10);
  const { items } = recurringItems();
  const live = items.filter((r) => !['cancelled', 'lapsed'].includes(r.status));
  const label = p.length === 4 ? `Calendar year ${p}` : monthLabel(p);
  const trend = p.length === 4 ? totals.map((x) => ({ label: monthName(x.month), full: monthLabel(x.month), line: x.income, segments: SPEND_FAMILIES.map((f) => ({ name: FAMILIES[f].name, color: familyColor(f), value: sum(FAMILIES[f].cats, (c) => x.byCat[c] || 0) })) })) : null;
  return `
  <div class="page-head no-print"><div><h1>Reports</h1><p>A clean summary you can print, save as PDF or open in Excel.</p></div>
    <div class="row gap wrap"><label class="field"><span class="sr">Period</span><select data-change="report-period">${[...years.map((y) => [y, `Year ${y}`]), ...months.map((m) => [m, monthLabel(m)])].map(([v, l]) => `<option value="${v}" ${v === p ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <button class="btn" data-action="report-xlsx">${icon('download', 17)} Excel</button><button class="btn primary" data-action="report-print">${icon('print', 17)} Print / Save PDF</button></div></div>
  <article class="card report">
    <header class="row between" style="margin-bottom:18px;align-items:flex-start"><div><h2 style="font-size:1.5rem">Paisa Ledger — ${esc(label)}</h2><div class="muted small">Generated ${longDate(toISO(new Date()))} · ${txns.length.toLocaleString('en-IN')} transactions</div></div><img src="icons/icon.svg" width="44" height="44" alt=""></header>
    <section class="kpis"><div class="kpi"><div class="kpi-head">Income</div><div class="kpi-value tnum">${fmt(income)}</div></div><div class="kpi"><div class="kpi-head">Spent</div><div class="kpi-value tnum">${fmt(spend)}</div></div><div class="kpi"><div class="kpi-head">Invested</div><div class="kpi-value tnum">${fmt(Math.max(0, save))}</div></div><div class="kpi"><div class="kpi-head">Kept</div><div class="kpi-value tnum ${income - spend < 0 ? 'neg' : ''}">${fmt(income - spend)}</div><div class="kpi-sub">${income ? ((income - spend) / income * 100).toFixed(0) + '% of income' : ''}</div></div></section>
    ${trend ? `<h3 style="margin:18px 0 8px">Month by month</h3>${stackedBars(trend, { width: 900, height: 300 })}` : ''}
    <div class="grid2" style="margin-top:18px"><div><h3 style="margin-bottom:10px">Where the money went</h3><div class="donut-wrap">${donut(byFam, { centreLabel: 'Spent', centreValue: fmt(spend) })}<ul class="legend">${byFam.map((f) => `<li><i style="background:${f.color}"></i><span>${esc(f.name)}</span><b>${fmt(f.value)}</b></li>`).join('')}</ul></div></div>
      <div><h3 style="margin-bottom:10px">Top merchants</h3>${hbars(merchants.map((m) => ({ name: displayMerchant(m.merchant), value: m.amount, color: colorOf(m.category) })))}</div></div>
    <h3 style="margin:22px 0 8px">By category</h3>
    <table class="tx"><thead><tr><th>Category</th><th class="num">Spent</th><th class="num">Share</th></tr></thead><tbody>${cats.map((c) => `<tr><td><span class="catdot" style="background:${colorOf(c.category)}"></span>${esc(c.category)}</td><td class="num">${fmt2(c.amount)}</td><td class="num">${spend ? ((c.amount / spend) * 100).toFixed(1) : 0}%</td></tr>`).join('')}</tbody></table>
    <h3 style="margin:22px 0 8px">Recurring bills &amp; subscriptions</h3>
    <table class="tx"><thead><tr><th>Payment</th><th>Cadence</th><th class="num">Amount</th><th class="num">Per year</th></tr></thead><tbody>${live.slice(0, 15).map((r) => `<tr><td>${esc(r.name)}</td><td>${r.cadence}</td><td class="num">${fmt(r.amount)}</td><td class="num">${fmt(r.yearlyCost)}</td></tr>`).join('')}</tbody></table>
    <p class="muted xs" style="margin-top:18px">Figures are computed on this device from the statements you imported. Estimates are not financial or tax advice.</p>
  </article>`;
}

/** Workbook sheets for the Excel export. */
export function reportSheets(p) {
  const txns = periodTxns(p);
  const cats = categoryBreakdown(txns);
  const totals = monthlyTotals(txns);
  return [
    { name: 'Summary', rows: [['Item', 'Amount (₹)'], ['Income', sum(totals, (t) => t.income)], ['Spent', sum(totals, (t) => t.spend)], ['Invested', Math.max(0, sum(totals, (t) => t.save))], ['Kept', sum(totals, (t) => t.income - t.spend)]], money: [1], widths: [24, 18] },
    { name: 'By month', rows: [['Month', 'Income', 'Spent', 'Invested'], ...totals.map((t) => [t.month, t.income, t.spend, Math.max(0, t.save)])], money: [1, 2, 3], widths: [12, 16, 16, 16] },
    { name: 'By category', rows: [['Category', 'Spent (₹)'], ...cats.map((c) => [c.category, c.amount])], money: [1], widths: [26, 18] },
    { name: 'Transactions', rows: [['Date', 'Description', 'Merchant', 'Category', 'Type', 'Amount (₹)', 'Account', 'Tags', 'Note'], ...txns.map((t) => [t.date, t.desc, t.merchant, t.category, t.type, t.amount, t.account, (t.tags || []).join(', '), t.note || ''])], money: [5], widths: [12, 50, 22, 20, 8, 14, 20, 18, 24] },
  ];
}
