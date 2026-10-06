import { state } from '../store.js';
import { monthlyTotals, categoryBreakdown, topMerchants, movers, spendByDay, spendByWeekday } from '../analytics.js';
import { stackedBars, donut, hbars, sparkline, areaChart, monthHeat } from '../charts.js';
import { FAMILIES, SPEND_FAMILIES, familyOf, familyColor, colorOf, displayMerchant } from '../categorize.js';
import { detectRecurring, buildAlerts } from '../recurring.js';
import { buildInsights, forecast } from '../insights.js';
import { icon } from '../icons.js';
import { t } from '../i18n.js';
import { fmt, compact, esc, monthLabel, monthName, sum, toISO, addMonths, shortDate } from '../util.js';

export function welcome() {
  const f = (ic, title, text) => `<div class="feature">${icon(ic, 24)}<b>${title}</b><span>${text}</span></div>`;
  return `<section class="card welcome">
    <div class="drop-icon" style="margin:0 auto 14px;width:72px;height:72px;border-radius:24px">${icon('shield', 34)}</div>
    <h1>Your money, on your device.</h1>
    <p class="lead">Drop in a bank statement and Paisa Ledger sorts every rupee, finds your subscriptions and SIPs, forecasts your month and estimates your tax. Nothing is ever uploaded.</p>
    <div class="row gap wrap"><a class="btn primary lg" href="#/import">${icon('upload', 18)} Import a statement</a><button class="btn lg" data-action="demo">${icon('sparkle', 18)} Try with demo data</button></div>
    <div class="feature-grid">
      ${f('scan', 'Reads any bank', 'PDF (even scanned or locked), Excel and CSV statements.')}
      ${f('repeat', 'Finds your bills', 'Subscriptions, SIPs, EMIs – with price-hike and renewal alerts.')}
      ${f('target', 'Plans ahead', 'Goals, net worth and a 30-day cash-flow forecast.')}
      ${f('rupee', 'Tax estimates', 'Old vs new regime, capital gains and advance-tax dates.')}
      ${f('lock', 'Locked & private', 'Optional encrypted app lock. Works fully offline.')}
    </div></section>`;
}

/** Everything the home screen needs, computed once so other views (reports) can reuse it. */
export function homeData() {
  const totals = monthlyTotals(state.txns);
  const months = totals.map((x) => x.month);
  const lastDate = state.txns[0].date;
  const defMonth = months.length > 1 && +lastDate.slice(8, 10) <= 10 ? months.at(-2) : months.at(-1);
  const sel = state.ui.month && months.includes(state.ui.month) ? state.ui.month : defMonth;
  state.ui.month = sel;
  const idx = months.indexOf(sel);
  const today = toISO(new Date());
  const rec = detectRecurring(state.txns, { today, overrides: state.settings.overrides });
  return { totals, months, sel, idx, cur: totals[idx], prev: totals[idx - 1], today, rec: rec.filter((r) => state.settings.overrides[r.key] !== 'ignored') };
}

const delta = (a, b) => (b ? ((a - b) / b) * 100 : null);
const pill = (d, goodWhenDown = true) => d == null ? '' : `<span class="pill-delta ${Math.abs(d) < 1 ? 'flat' : (d < 0) === goodWhenDown ? 'good' : 'bad'}">${icon(d >= 0 ? 'up' : 'down', 13)}${Math.abs(d).toFixed(0)}%</span>`;

export function home() {
  if (!state.txns.length) return welcome();
  const { totals, months, sel, idx, cur, prev, today, rec } = homeData();
  const kept = cur.income - cur.spend;
  const rate = cur.income > 0 ? (kept / cur.income) * 100 : null;
  const savedSeries = totals.slice(-7).map((x) => x.income - x.spend);

  // spending by family
  const breakdown = categoryBreakdown(state.txns, sel);
  const byFam = {};
  for (const b of breakdown) (byFam[familyOf(b.category)] ||= { amount: 0, cats: [] }).amount += b.amount, byFam[familyOf(b.category)].cats.push(b);
  const famItems = SPEND_FAMILIES.filter((f) => byFam[f]).map((f) => ({ fam: f, name: FAMILIES[f].name, value: byFam[f].amount, color: familyColor(f), cats: byFam[f].cats })).sort((a, b) => b.value - a.value);
  const famTotal = sum(famItems, (x) => x.value) || 1;

  const trend = totals.slice(-12).map((x) => ({
    label: monthName(x.month), full: monthLabel(x.month), line: x.income,
    segments: SPEND_FAMILIES.map((f) => ({ name: FAMILIES[f].name, color: familyColor(f), value: sum(FAMILIES[f].cats, (c) => x.byCat[c] || 0) })),
  }));
  const merchants = topMerchants(state.txns, sel, 6);
  const mv = prev ? movers(state.txns, sel, prev.month).slice(0, 4) : [];
  const alerts = buildAlerts(rec).slice(0, 3);
  const insights = buildInsights(state.txns, { month: sel, cur, prev, budgets: state.settings.budgets, recurring: rec, today }).slice(0, 6);
  const uncategorized = state.txns.filter((x) => x.category === 'Uncategorized' && x.type === 'debit').length;
  const fc = forecast(state.txns, rec, { today, days: 30 });
  const upcoming = fc.expected.filter((e) => e.amount < 0).slice(0, 5);
  const days = new Date(+sel.slice(0, 4), +sel.slice(5, 7), 0).getDate();
  const elapsed = sel === today.slice(0, 7) ? +today.slice(8, 10) : days;
  const daily = cur.spend / Math.max(1, elapsed);
  const biggest = state.txns.filter((x) => x.date.startsWith(sel) && x.type === 'debit' && !['transfer', 'save'].includes(x.category)).sort((a, b) => b.amount - a.amount)[0];

  const budgets = Object.entries(state.settings.budgets).filter(([, v]) => v > 0);
  const budgetHtml = budgets.length ? `<ul class="budgets">${budgets.map(([cat, lim]) => { const spent = cur.byCat[cat] || 0, pct = (spent / lim) * 100; return `<li><div class="row between"><span>${esc(cat)}</span><span class="${pct > 100 ? 'neg' : 'muted'} tnum">${fmt(spent)} / ${fmt(lim)}</span></div><div class="meter"><span class="${pct > 100 ? 'over' : pct > 80 ? 'near' : ''}" style="width:${Math.min(100, pct)}%"></span></div></li>`; }).join('')}</ul>` : `<div class="empty" style="padding:10px">${icon('target', 28)}<span>Set monthly limits per category to track them here.</span><a class="btn small" href="#/settings">Set budgets</a></div>`;

  const kpi = (ic, label, value, sub) => `<div class="kpi"><div class="kpi-head"><span class="kpi-ic">${icon(ic, 18)}</span>${label}</div><div class="kpi-value tnum">${value}</div><div class="kpi-sub">${sub}</div></div>`;

  return `
  <section class="hero">
    <div class="hero-top"><div>
      <div class="hero-label">${icon('wallet', 16)} ${t('Left after spending')} · ${monthLabel(sel)}</div>
      <div class="hero-num" data-count="${kept}">${fmt(kept)}</div>
      <div class="hero-sub">${rate == null ? 'No income recorded this month' : `${rate.toFixed(0)}% of income kept`} ${prev ? pill(delta(cur.spend, prev.spend), true).replace('pill-delta', 'pill-delta') + ` <span style="opacity:.8">spending vs ${monthName(prev.month)}</span>` : ''}</div></div>
      <div class="col" style="align-items:flex-end;gap:10px"><div class="month-switch">
        <button data-action="month-prev" aria-label="Previous month" ${idx <= 0 ? 'disabled' : ''}>${icon('chevron', 16).replace('<svg', '<svg style="transform:scaleX(-1)"')}</button>
        <select data-change="month" aria-label="Month">${[...months].reverse().map((m) => `<option value="${m}" ${m === sel ? 'selected' : ''}>${monthLabel(m)}</option>`).join('')}</select>
        <button data-action="month-next" aria-label="Next month" ${idx >= months.length - 1 ? 'disabled' : ''}>${icon('chevron', 16)}</button></div>${sparkline(savedSeries, { w: 160, h: 56 })}</div></div>
    <div class="hero-stats">
      <div class="hero-stat"><small>${icon('down', 14)} ${t('Income')}</small><b data-count="${cur.income}">${fmt(cur.income)}</b></div>
      <div class="hero-stat"><small>${icon('up', 14)} ${t('Spent')}</small><b data-count="${cur.spend}">${fmt(cur.spend)}</b></div>
      <div class="hero-stat"><small>${icon('piggy', 14)} ${t('Invested')}</small><b data-count="${Math.max(0, cur.save)}">${fmt(Math.max(0, cur.save))}</b></div></div>
  </section>

  ${insights.length ? `<div class="card-head" style="margin:6px 4px 10px"><h2>${icon('sparkle', 18)} ${t('Insights')}</h2></div><section class="insights">${insights.map((i) => `<div class="insight ${i.level}"><span class="ico">${icon(i.icon, 20)}</span><div><b>${esc(i.title)}</b><span>${esc(i.text)}</span></div></div>`).join('')}</section>` : ''}
  ${alerts.length ? `<section class="card"><div class="card-head"><h2>${icon('bell', 18)} Heads up</h2><a href="#/bills">All bills →</a></div>${alerts.map((a) => `<div class="alert ${a.level === 'warn' ? 'warn' : ''}">${icon(a.type === 'hike' ? 'up' : 'calendar', 18)}<div><b>${esc(a.title)}</b><span>${esc(a.detail)}</span></div></div>`).join('')}</section>` : ''}

  <section class="kpis">
    ${kpi('pie', t('Savings rate'), rate == null ? '–' : `${rate.toFixed(0)}%`, rate == null ? 'No income recorded' : `${fmt(kept)} kept`)}
    ${kpi('calendar', 'Average per day', fmt(daily), `over ${elapsed} day${elapsed === 1 ? '' : 's'}`)}
    ${kpi('receipt', 'Biggest expense', biggest ? fmt(biggest.amount) : '–', biggest ? esc(displayMerchant(biggest.merchant)) + ' · ' + shortDate(biggest.date) : 'None yet')}
    ${kpi('repeat', 'Recurring per month', fmt(sum(rec.filter((r) => !['cancelled', 'lapsed'].includes(r.status)), (r) => r.monthlyCost)), `${rec.filter((r) => !['cancelled', 'lapsed'].includes(r.status)).length} bills & subscriptions`)}
  </section>

  <section class="grid2">
    <div class="card"><div class="card-head"><h2>${icon('pie', 18)} ${t('Where your money went')}</h2><span class="muted small">${monthLabel(sel)}</span></div>
      ${famItems.length ? `<div class="donut-wrap">${donut(famItems.map((f) => ({ name: f.name, value: f.value, color: f.color })), { centreLabel: t('Spent'), centreValue: compact(cur.spend) })}
        <ul class="legend">${famItems.map((f) => `<li data-tip="${esc(`<b>${esc(f.name)}</b>` + f.cats.slice(0, 5).map((c) => `<div class="r"><span>${esc(c.category)}</span><span>${fmt(c.amount)}</span></div>`).join(''))}"><i style="background:${f.color}"></i><span>${esc(f.name)}</span><b>${fmt(f.value)}</b><small>${((f.value / famTotal) * 100).toFixed(0)}%</small></li>`).join('')}</ul></div>` : '<p class="muted">No spending this month.</p>'}
    </div>
    <div class="card"><div class="card-head"><h2>${icon('up', 18)} ${t('Month by month')}</h2><span class="legend-inline"><span><span class="ln"></span>${t('Income')}</span></span></div>
      ${stackedBars(trend)}
      <div class="legend-inline" style="margin-top:8px">${SPEND_FAMILIES.map((f) => `<span><i style="background:${familyColor(f)}"></i>${FAMILIES[f].name}</span>`).join('')}</div></div>
  </section>

  <section class="grid3">
    <div class="card"><div class="card-head"><h2>${t('Top merchants')}</h2></div>${merchants.length ? hbars(merchants.map((m) => ({ name: displayMerchant(m.merchant), value: m.amount, color: colorOf(m.category) }))) : '<p class="muted">Nothing yet.</p>'}</div>
    <div class="card"><div class="card-head"><h2>${t('What changed')}</h2></div>${mv.length ? `<ul class="movers">${mv.map((m) => `<li><span class="dot" style="background:${colorOf(m.category)}"></span><span>${esc(m.category)}</span><b class="${m.delta > 0 ? 'neg' : 'pos'} tnum">${m.delta > 0 ? '+' : '−'}${fmt(Math.abs(m.delta))}</b></li>`).join('')}</ul><p class="muted small">Compared with ${monthLabel(prev.month)}.</p>` : '<p class="muted">Needs at least two months of data.</p>'}
      ${uncategorized ? `<p class="callout">${uncategorized} spending transactions need a category. <a href="#/transactions" data-action="review-uncat">Review →</a></p>` : ''}</div>
    <div class="card"><div class="card-head"><h2>${t('Budgets')}</h2><a href="#/settings">Edit</a></div>${budgetHtml}</div>
  </section>

  <section class="grid2">
    <div class="card"><div class="card-head"><h2>${icon('calendar', 18)} Spending calendar</h2><span class="muted small">${monthLabel(sel)}</span></div>${monthHeat(sel, spendByDay(state.txns, sel))}
      <div class="legend-inline" style="margin-top:12px"><span>Less</span>${[1, 2, 3, 4, 5].map((n) => `<span><i style="background:var(--seq-${n * 2 - 1})"></i></span>`).join('')}<span>More</span></div></div>
    <div class="card"><div class="card-head"><h2>${icon('target', 18)} Next 30 days</h2><a href="#/plan">Forecast →</a></div>
      ${upcoming.length ? `<ul class="plainlist">${upcoming.map((e) => `<li><span><b>${esc(e.label)}</b><div class="muted xs">${shortDate(e.date)} · ${esc(e.kind)}</div></span><b class="tnum">${fmt(-e.amount)}</b></li>`).join('')}</ul>` : '<p class="muted">No upcoming bills detected yet.</p>'}</div>
  </section>`;
}

export function forecastChart(fc) {
  return areaChart([{ name: 'Projected net', color: 'var(--s1)', points: fc.points.map((p) => ({ x: shortDate(p.date), y: p.cumulative, full: shortDate(p.date) })) }], { labelEvery: 5 });
}
