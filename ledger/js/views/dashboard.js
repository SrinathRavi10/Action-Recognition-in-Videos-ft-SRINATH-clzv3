import { state } from '../store.js';
import { monthlyTotals, categoryBreakdown, topMerchants, movers } from '../analytics.js';
import { stackedBars, donut, hbars } from '../charts.js';
import { colorOf, displayMerchant, CATEGORIES } from '../categorize.js';
import { detectRecurring, buildAlerts } from '../recurring.js';
import { fmt, compact, esc, monthLabel, monthName, sum, toISO } from '../util.js';

export function emptyState() {
  return `<section class="hero card">
    <h1>Your money, on your device.</h1>
    <p class="lead">Import a bank statement PDF or CSV and Paisa Ledger sorts every rupee into categories, finds your subscriptions and SIPs, and estimates your tax – all offline. Nothing is uploaded, ever.</p>
    <div class="row gap">
      <a class="btn primary" href="#/import">Import a statement</a>
      <button class="btn" data-action="demo">Try with demo data</button>
    </div>
    <ul class="ticks">
      <li>Works with any bank: PDF (even password-protected) or CSV</li>
      <li>Learns from your corrections – fix a merchant once, it's fixed everywhere</li>
      <li>Finds price hikes and upcoming renewals before they hit</li>
    </ul></section>`;
}

export function dashboard() {
  if (!state.txns.length) return emptyState();
  const totals = monthlyTotals(state.txns);
  const months = totals.map((t) => t.month);
  // Default to the latest month, unless it only has a few days of data (then the previous month is more useful).
  const lastDate = state.txns[0].date;
  const defMonth = months.length > 1 && +lastDate.slice(8, 10) <= 10 ? months.at(-2) : months.at(-1);
  const sel = state.ui.month && months.includes(state.ui.month) ? state.ui.month : defMonth;
  state.ui.month = sel;
  const idx = months.indexOf(sel);
  const cur = totals[idx];
  const prev = totals[idx - 1];
  const rate = cur.income > 0 ? ((cur.income - cur.spend) / cur.income) * 100 : null;
  const delta = (a, b) => (b ? ((a - b) / b) * 100 : null);
  const dSpend = prev ? delta(cur.spend, prev.spend) : null;

  const trend = totals.slice(-12);
  const catsAll = Object.keys(CATEGORIES);
  const trendData = trend.map((t) => ({
    label: monthName(t.month),
    line: t.income,
    segments: catsAll.filter((c) => t.byCat[c] > 0).map((c) => ({ name: c, value: t.byCat[c], color: colorOf(c) })),
  }));
  const breakdown = categoryBreakdown(state.txns, sel);
  const top = breakdown.slice(0, 7);
  const rest = sum(breakdown.slice(7), (b) => b.amount);
  const donutItems = [...top.map((b) => ({ name: b.category, value: b.amount, color: colorOf(b.category) })), ...(rest > 0 ? [{ name: 'Everything else', value: rest, color: '#ced4da' }] : [])];
  const merchants = topMerchants(state.txns, sel, 6);
  const mv = prev ? movers(state.txns, sel, prev.month).slice(0, 4) : [];
  const uncategorized = state.txns.filter((t) => t.category === 'Uncategorized' && t.type === 'debit').length;
  const today = toISO(new Date());
  const rec = detectRecurring(state.txns, { today, overrides: state.settings.overrides });
  const alerts = buildAlerts(rec.filter((r) => state.settings.overrides[r.key] !== 'ignored')).slice(0, 4);

  const budgets = Object.entries(state.settings.budgets).filter(([, v]) => v > 0);
  const budgetHtml = budgets.length
    ? `<ul class="budgets">${budgets.map(([cat, lim]) => {
        const spent = cur.byCat[cat] || 0;
        const pct = (spent / lim) * 100;
        return `<li><div class="row between"><span>${esc(cat)}</span><span class="${pct > 100 ? 'neg' : 'muted'}">${fmt(spent)} / ${fmt(lim)}</span></div><div class="meter"><span class="${pct > 100 ? 'over' : pct > 80 ? 'near' : ''}" style="width:${Math.min(100, pct)}%"></span></div></li>`;
      }).join('')}</ul>`
    : `<p class="muted">Set monthly limits per category to see progress here. <a href="#/settings">Set budgets</a></p>`;

  const kpi = (label, value, sub, cls = '') => `<div class="kpi ${cls}"><div class="kpi-label">${label}</div><div class="kpi-value">${value}</div><div class="kpi-sub">${sub}</div></div>`;
  const arrow = (d, goodWhenDown = true) => d == null ? '' : `<span class="${(d < 0) === goodWhenDown ? 'pos' : 'neg'}">${d > 0 ? '▲' : '▼'} ${Math.abs(d).toFixed(0)}%</span> vs ${monthName(prev.month)}`;

  return `
  <div class="page-head"><h1>Dashboard</h1>
    <label class="sel"><span class="sr">Month</span><select data-change="month">${[...months].reverse().map((m) => `<option value="${m}" ${m === sel ? 'selected' : ''}>${monthLabel(m)}</option>`).join('')}</select></label></div>

  <section class="kpis">
    ${kpi('Income', fmt(cur.income), prev ? arrow(delta(cur.income, prev.income), false) : '&nbsp;')}
    ${kpi('Spent', fmt(cur.spend), arrow(dSpend, true), 'spend')}
    ${kpi('Invested', fmt(Math.max(0, cur.save)), cur.income ? `${((Math.max(0, cur.save) / cur.income) * 100).toFixed(0)}% of income` : '&nbsp;')}
    ${kpi('Savings rate', rate == null ? '–' : `${rate.toFixed(0)}%`, rate == null ? 'No income recorded' : `${fmt(cur.income - cur.spend)} left after spending`, rate != null && rate < 0 ? 'bad' : '')}
  </section>

  ${alerts.length ? `<section class="card"><div class="card-head"><h2>Heads up</h2><a href="#/subscriptions">All subscriptions →</a></div>${alerts.map((a) => `<div class="alert ${a.level}"><b>${esc(a.title)}</b><span>${esc(a.detail)}</span></div>`).join('')}</section>` : ''}

  <section class="grid2">
    <div class="card"><div class="card-head"><h2>Where your money went</h2><span class="muted">${monthLabel(sel)}</span></div>
      ${breakdown.length ? `<div class="donut-wrap">${donut(donutItems, { centreLabel: 'Spent', centreValue: compact(cur.spend) })}
        <ul class="legend">${donutItems.map((d) => `<li><i style="background:${d.color}"></i><span>${esc(d.name)}</span><b>${fmt(d.value)}</b></li>`).join('')}</ul></div>` : '<p class="muted">No spending this month.</p>'}
    </div>
    <div class="card"><div class="card-head"><h2>Month by month</h2><span class="legend-inline"><i class="ln"></i> Income</span></div>
      ${stackedBars(trendData)}</div>
  </section>

  <section class="grid3">
    <div class="card"><h2>Top merchants</h2>${merchants.length ? hbars(merchants.map((m) => ({ name: displayMerchant(m.merchant), value: m.amount, color: colorOf(m.category) }))) : '<p class="muted">Nothing yet.</p>'}</div>
    <div class="card"><h2>What changed</h2>${mv.length ? `<ul class="movers">${mv.map((m) => `<li><span class="dot" style="background:${colorOf(m.category)}"></span><span>${esc(m.category)}</span><b class="${m.delta > 0 ? 'neg' : 'pos'}">${m.delta > 0 ? '+' : '−'}${fmt(Math.abs(m.delta))}</b></li>`).join('')}</ul><p class="muted small">Compared with ${monthLabel(prev.month)}.</p>` : '<p class="muted">Needs at least two months of data.</p>'}
      ${uncategorized ? `<p class="callout">${uncategorized} spending transactions need a category. <a href="#/transactions" data-action="review-uncat">Review them →</a></p>` : ''}</div>
    <div class="card"><div class="card-head"><h2>Budgets</h2><a href="#/settings">Edit</a></div>${budgetHtml}</div>
  </section>`;
}
