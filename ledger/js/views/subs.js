import { state } from '../store.js';
import { detectRecurring, buildAlerts } from '../recurring.js';
import { sparkline, hbars } from '../charts.js';
import { chip } from '../ui.js';
import { esc, fmt, longDate, toISO } from '../util.js';

const KIND_COLORS = { 'OTT & apps': '#d6336c', 'Mobile & broadband': '#7c6bd6', 'SIP & investments': '#2b8a3e', Insurance: '#2f9e9e', 'EMI & loans': '#607d8b', 'Rent & society': '#8d6e63', Utilities: '#e0a526', 'Other recurring': '#868e96' };
const STATUS = { 'due-soon': ['Due soon', 'warn'], overdue: ['Not seen yet', 'bad'], lapsed: ['Stopped?', ''], cancelled: ['Cancelled', ''], active: ['Active', 'good'] };

export function subscriptions() {
  if (!state.txns.length) return `<div class="page-head"><h1>Bills & subscriptions</h1></div><section class="card"><p>Import at least a few months of statements and recurring payments will appear here automatically.</p><a class="btn primary" href="#/import">Import statements</a></section>`;
  const ov = state.settings.overrides;
  const all = detectRecurring(state.txns, { today: toISO(new Date()), overrides: ov });
  const ignored = all.filter((r) => ov[r.key] === 'ignored');
  const items = all.filter((r) => ov[r.key] !== 'ignored');
  const live = items.filter((r) => r.status !== 'cancelled' && r.status !== 'lapsed');
  const monthly = live.reduce((a, r) => a + r.monthlyCost, 0);
  const byKind = {};
  for (const r of live) byKind[r.kind] = (byKind[r.kind] || 0) + r.monthlyCost;
  const alerts = buildAlerts(items);
  const sipMonthly = byKind['SIP & investments'] || 0;
  const commitments = monthly - sipMonthly;

  const row = (r) => {
    const [stLabel, stCls] = STATUS[r.status];
    return `<tr class="${r.status === 'cancelled' || r.status === 'lapsed' ? 'dim' : ''}">
      <td><div class="desc">${esc(r.name)}</div><div class="muted small">${chip(r.kind)} ${r.hike && !r.hike.old ? chip(`↑ ${r.hike.pct.toFixed(0)}% hike`, 'bad') : ''}</div></td>
      <td>${r.variable ? '≈ ' : ''}${fmt(r.amount)}<div class="muted small">${r.cadence}</div></td>
      <td class="hide-sm">${sparkline(r.history.map((h) => h.amount))}</td>
      <td class="nowrap">${r.status === 'lapsed' || r.status === 'cancelled' ? '–' : longDate(r.nextDue)}<div class="muted small">${r.status === 'lapsed' || r.status === 'cancelled' ? 'last ' + longDate(r.lastDate) : r.daysToDue >= 0 ? `in ${r.daysToDue} day${r.daysToDue === 1 ? '' : 's'}` : `${-r.daysToDue} days ago`}</div></td>
      <td>${chip(stLabel, stCls)}</td>
      <td class="num">${fmt(r.yearlyCost)}<div class="muted small">per year</div></td>
      <td class="acts"><select class="mini" data-change="sub-action" data-key="${esc(r.key)}" aria-label="Actions for ${esc(r.name)}"><option value="">⋯</option><option value="cancelled">Mark cancelled</option><option value="ignored">Not a subscription</option>${ov[r.key] === 'cancelled' ? '<option value="active">Mark active</option>' : ''}</select></td></tr>`;
  };

  return `
  <div class="page-head"><h1>Bills & subscriptions</h1></div>
  <section class="kpis">
    <div class="kpi"><div class="kpi-label">Recurring per month</div><div class="kpi-value">${fmt(monthly)}</div><div class="kpi-sub">${live.length} payments tracked</div></div>
    <div class="kpi"><div class="kpi-label">Per year</div><div class="kpi-value">${fmt(monthly * 12)}</div><div class="kpi-sub">at current prices</div></div>
    <div class="kpi"><div class="kpi-label">Fixed bills & subscriptions</div><div class="kpi-value">${fmt(commitments)}</div><div class="kpi-sub">per month, excluding SIPs</div></div>
    <div class="kpi"><div class="kpi-label">SIPs & investments</div><div class="kpi-value">${fmt(sipMonthly)}</div><div class="kpi-sub">per month</div></div>
  </section>
  ${alerts.length ? `<section class="card"><h2>Alerts</h2>${alerts.map((a) => `<div class="alert ${a.level}"><b>${esc(a.title)}</b><span>${esc(a.detail)}</span></div>`).join('')}</section>` : ''}
  <section class="grid2">
    <div class="card"><h2>Monthly cost by type</h2>${hbars(Object.entries(byKind).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ name: k, value: v, color: KIND_COLORS[k] })))}</div>
    <div class="card"><h2>Biggest recurring costs</h2>${hbars(live.slice(0, 6).map((r) => ({ name: r.name, value: r.yearlyCost, color: KIND_COLORS[r.kind] })))}<p class="muted small">Yearly cost.</p></div>
  </section>
  <section class="card flush"><div class="table-wrap"><table class="tx"><thead><tr><th>Payment</th><th>Amount</th><th class="hide-sm">Trend</th><th>Next due</th><th>Status</th><th class="num">Yearly</th><th></th></tr></thead>
    <tbody>${items.map(row).join('') || '<tr><td colspan="7" class="muted center pad">No recurring payments detected yet. Detection needs at least two months of history.</td></tr>'}</tbody></table></div></section>
  ${ignored.length ? `<p class="muted small">${ignored.length} hidden as “not a subscription”. <button class="link" data-action="sub-restore">Restore all</button></p>` : ''}
  <p class="muted small">Detected from repeating debits with similar amounts at regular intervals. Variable bills (electricity, mobile) show an average. Renewal dates are predictions based on your last payment.</p>`;
}
