import { state } from '../store.js';
import { detectRecurring, buildAlerts } from '../recurring.js';
import { sparkline, hbars } from '../charts.js';
import { chip, emptyBlock } from '../ui.js';
import { icon } from '../icons.js';
import { notifySupported } from '../notify.js';
import { esc, fmt, longDate, toISO } from '../util.js';

const KIND_COLORS = { 'OTT & apps': 'var(--s5)', 'Mobile & broadband': 'var(--s1)', 'SIP & investments': 'var(--s6)', Insurance: 'var(--s7)', 'EMI & loans': 'var(--s3)', 'Rent & society': 'var(--s2)', Utilities: 'var(--s4)', 'Other recurring': 'var(--s0)' };
const STATUS = { 'due-soon': ['Due soon', 'warn', 'bell'], overdue: ['Not seen yet', 'bad', 'alert'], lapsed: ['Stopped?', '', 'info'], cancelled: ['Cancelled', '', 'x'], active: ['Active', 'good', 'check'] };

export function recurringItems() {
  const ov = state.settings.overrides;
  const all = detectRecurring(state.txns, { today: toISO(new Date()), overrides: ov });
  return { all, ignored: all.filter((r) => ov[r.key] === 'ignored'), items: all.filter((r) => ov[r.key] !== 'ignored') };
}

export function bills() {
  if (!state.txns.length) return `<div class="page-head"><h1>Bills & subscriptions</h1></div><section class="card">${emptyBlock('repeat', 'Nothing to track yet', 'Import a few months of statements and recurring payments appear here automatically.', '<a class="btn primary" href="#/import">Import statements</a>')}</section>`;
  const ov = state.settings.overrides;
  const { ignored, items } = recurringItems();
  const live = items.filter((r) => r.status !== 'cancelled' && r.status !== 'lapsed');
  const monthly = live.reduce((a, r) => a + r.monthlyCost, 0);
  const byKind = {};
  for (const r of live) byKind[r.kind] = (byKind[r.kind] || 0) + r.monthlyCost;
  const alerts = buildAlerts(items);
  const sipMonthly = byKind['SIP & investments'] || 0;
  const hikes = live.filter((r) => r.hike && !r.hike.old);
  const hikeCost = hikes.reduce((a, r) => a + (r.hike.to - r.hike.from) * (r.yearlyCost / r.amount), 0);

  const row = (r) => {
    const [stLabel, stCls, stIc] = STATUS[r.status];
    const gone = r.status === 'cancelled' || r.status === 'lapsed';
    return `<tr class="${gone ? 'dim' : ''}">
      <td><div class="desc">${esc(r.name)}</div><div class="row gap wrap" style="gap:5px;margin-top:3px">${chip(r.kind)} ${r.hike && !r.hike.old ? chip(`${r.hike.pct.toFixed(0)}% price hike`, 'bad', 'up') : ''}</div></td>
      <td class="tnum">${r.variable ? '≈ ' : ''}${fmt(r.amount)}<div class="faint xs">${r.cadence}</div></td>
      <td class="hide-sm">${sparkline(r.history.map((h) => h.amount))}</td>
      <td class="nowrap">${gone ? '–' : longDate(r.nextDue)}<div class="faint xs">${gone ? 'last ' + longDate(r.lastDate) : r.daysToDue >= 0 ? `in ${r.daysToDue} day${r.daysToDue === 1 ? '' : 's'}` : `${-r.daysToDue} days ago`}</div></td>
      <td>${chip(stLabel, stCls, stIc)}</td>
      <td class="num">${fmt(r.yearlyCost)}<div class="faint xs">per year</div></td>
      <td class="acts nowrap"><button class="icon" data-action="bill-cancel-help" data-key="${esc(r.key)}" title="How to cancel" aria-label="How to cancel ${esc(r.name)}">${icon('info', 17)}</button><select class="mini" data-change="sub-action" data-key="${esc(r.key)}" aria-label="Actions for ${esc(r.name)}"><option value="">⋯</option><option value="cancelled">Mark cancelled</option><option value="ignored">Not a subscription</option>${ov[r.key] === 'cancelled' ? '<option value="active">Mark active</option>' : ''}</select></td></tr>`;
  };

  return `
  <div class="page-head"><div><h1>Bills &amp; subscriptions</h1><p>Detected automatically from your statements.</p></div>
    <div class="row gap wrap"><button class="btn" data-action="ics">${icon('calendar', 17)} Add to calendar</button>${notifySupported() ? `<label class="check btn" style="cursor:pointer"><span class="switch"><input type="checkbox" data-change="notify" ${state.settings.notify ? 'checked' : ''}><i></i></span> Remind me</label>` : ''}</div></div>
  <section class="kpis">
    <div class="kpi"><div class="kpi-head"><span class="kpi-ic">${icon('repeat', 18)}</span>Recurring per month</div><div class="kpi-value tnum">${fmt(monthly)}</div><div class="kpi-sub">${live.length} payments tracked</div></div>
    <div class="kpi"><div class="kpi-head"><span class="kpi-ic">${icon('calendar', 18)}</span>Per year</div><div class="kpi-value tnum">${fmt(monthly * 12)}</div><div class="kpi-sub">at current prices</div></div>
    <div class="kpi"><div class="kpi-head"><span class="kpi-ic">${icon('piggy', 18)}</span>SIPs &amp; investments</div><div class="kpi-value tnum">${fmt(sipMonthly)}</div><div class="kpi-sub">per month</div></div>
    <div class="kpi ${hikes.length ? 'bad' : ''}"><div class="kpi-head"><span class="kpi-ic">${icon('up', 18)}</span>Price hikes</div><div class="kpi-value tnum">${hikes.length}</div><div class="kpi-sub">${hikes.length ? `+${fmt(hikeCost)} per year` : 'none recently'}</div></div>
  </section>
  ${alerts.length ? `<section class="card"><div class="card-head"><h2>${icon('bell', 18)} Alerts</h2></div>${alerts.map((a) => `<div class="alert ${a.level === 'warn' ? 'warn' : ''}">${icon(a.type === 'hike' ? 'up' : a.type === 'overdue' ? 'alert' : 'calendar', 18)}<div><b>${esc(a.title)}</b><span>${esc(a.detail)}</span></div></div>`).join('')}</section>` : ''}
  <section class="grid2">
    <div class="card"><div class="card-head"><h2>Monthly cost by type</h2></div>${hbars(Object.entries(byKind).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ name: k, value: v, color: KIND_COLORS[k] })))}</div>
    <div class="card"><div class="card-head"><h2>Biggest recurring costs</h2><span class="muted small">per year</span></div>${hbars(live.slice(0, 6).map((r) => ({ name: r.name, value: r.yearlyCost, color: KIND_COLORS[r.kind] })))}</div>
  </section>
  <section class="card flush"><div class="table-wrap"><table class="tx"><thead><tr><th>Payment</th><th>Amount</th><th class="hide-sm">Trend</th><th>Next due</th><th>Status</th><th class="num">Yearly</th><th></th></tr></thead>
    <tbody>${items.map(row).join('') || `<tr><td colspan="7">${emptyBlock('repeat', 'No recurring payments yet', 'Detection needs at least two months of history.')}</td></tr>`}</tbody></table></div></section>
  ${ignored.length ? `<p class="muted small">${ignored.length} hidden as “not a subscription”. <button class="link" data-action="sub-restore">Restore all</button></p>` : ''}
  <p class="muted small">Detected from repeating debits with similar amounts at regular intervals. Variable bills show an average. Renewal dates are predictions from your last payment.</p>`;
}
