import { state } from '../store.js';
import { areaChart, hbars } from '../charts.js';
import { forecast } from '../insights.js';
import { monthlyTotals } from '../analytics.js';
import { recurringItems } from './bills.js';
import { emptyBlock } from '../ui.js';
import { icon } from '../icons.js';
import { esc, fmt, fmt2, longDate, monthLabel, shortDate, toISO, daysBetween, sum, median, addMonths } from '../util.js';

export const ACCOUNT_TYPES = { bank: ['Bank / cash', 'asset'], fd: ['FD / RD', 'asset'], mf: ['Mutual funds', 'asset'], stocks: ['Stocks', 'asset'], epf: ['EPF / PPF / NPS', 'asset'], property: ['Property / gold', 'asset'], otherA: ['Other asset', 'asset'], loan: ['Loan', 'liability'], card: ['Credit card dues', 'liability'], otherL: ['Other liability', 'liability'] };

/** Net-worth history by month (carry the last known balance of each account forward). */
export function netWorthSeries() {
  const dates = state.accounts.flatMap((a) => a.history.map((h) => h.date.slice(0, 7)));
  if (!dates.length) return [];
  const start = dates.reduce((a, b) => (a < b ? a : b));
  const end = toISO(new Date()).slice(0, 7);
  const out = [];
  for (let m = start; m <= end; m = addMonths(m + '-01', 1).slice(0, 7)) {
    let net = 0;
    for (const a of state.accounts) {
      const h = [...a.history].filter((x) => x.date.slice(0, 7) <= m).sort((x, y) => (x.date < y.date ? 1 : -1))[0];
      if (!h) continue;
      net += ACCOUNT_TYPES[a.type]?.[1] === 'liability' ? -h.balance : h.balance;
    }
    out.push({ month: m, net });
  }
  return out;
}

export const owedList = () => {
  const by = {};
  for (const t of state.txns) if (t.share?.with && t.share.amount > 0) (by[t.share.with] ||= { who: t.share.with, open: 0, items: [] }, by[t.share.with].items.push(t), !t.share.settled && (by[t.share.with].open += t.share.amount));
  return Object.values(by).sort((a, b) => b.open - a.open);
};

function goalsTab() {
  const totals = monthlyTotals(state.txns).slice(-4, -1);
  const keptMonthly = totals.length ? median(totals.map((t) => t.income - t.spend)) : null;
  const today = toISO(new Date());
  const cards = state.goals.map((g) => {
    const pct = Math.min(100, (g.saved / g.target) * 100);
    const left = Math.max(0, g.target - g.saved);
    const months = g.deadline ? Math.max(1, Math.ceil(daysBetween(today, g.deadline) / 30.4)) : null;
    const need = months ? left / months : null;
    const ok = need != null && keptMonthly != null ? keptMonthly >= need : null;
    return `<li class="card tight" style="margin:0"><div class="row between"><div class="row gap"><span class="kpi-ic">${icon('flag', 18)}</span><div><b>${esc(g.name)}</b><div class="faint xs">${g.deadline ? 'by ' + longDate(g.deadline) : 'no deadline'}</div></div></div>
      <div class="row"><button class="icon" data-action="goal-add" data-id="${g.id}" title="Add savings" aria-label="Add savings">${icon('plus', 17)}</button><button class="icon" data-action="goal-edit" data-id="${g.id}" aria-label="Edit goal">${icon('edit', 17)}</button></div></div>
      <div class="row between" style="margin-top:12px"><b class="tnum" style="font-size:1.25rem">${fmt(g.saved)}</b><span class="muted tnum">of ${fmt(g.target)} · ${pct.toFixed(0)}%</span></div>
      <div class="meter"><span style="width:${pct}%"></span></div>
      ${need != null ? `<p class="small ${ok === false ? 'warn-line' : 'muted'}" style="margin:10px 0 0">${left <= 0 ? '🎉 Goal reached!' : `Save <b>${fmt(need)}</b> a month for ${months} month${months === 1 ? '' : 's'}${ok === true ? ' – you are on track.' : ok === false ? ` – you usually keep about ${fmt(Math.max(0, keptMonthly))}.` : '.'}`}</p>` : ''}</li>`;
  }).join('');
  return `<div class="row between" style="margin-bottom:14px"><p class="muted" style="margin:0">Targets with a deadline, tracked against what you actually keep each month.</p><button class="btn primary" data-action="goal-new">${icon('plus', 17)} New goal</button></div>
    ${state.goals.length ? `<ul class="goals" style="grid-template-columns:repeat(auto-fill,minmax(320px,1fr));display:grid">${cards}</ul>` : `<section class="card">${emptyBlock('flag', 'Set your first goal', 'Emergency fund, a trip, a new phone – give it a target and a date.', `<button class="btn primary" data-action="goal-new">${icon('plus', 17)} New goal</button>`)}</section>`}`;
}

function netTab() {
  const series = netWorthSeries();
  const assets = state.accounts.filter((a) => ACCOUNT_TYPES[a.type]?.[1] === 'asset');
  const liabs = state.accounts.filter((a) => ACCOUNT_TYPES[a.type]?.[1] === 'liability');
  const A = sum(assets, (a) => a.balance), L = sum(liabs, (a) => a.balance);
  const fromStatements = [...new Map(state.txns.filter((t) => t.balance != null && t.source !== 'manual').map((t) => [t.account, t])).values()];
  return `<div class="row between wrap" style="margin-bottom:14px;gap:10px"><p class="muted" style="margin:0">Add what you own and owe. Update balances now and then to see your trend.</p><button class="btn primary" data-action="acct-new">${icon('plus', 17)} Add account</button></div>
    ${state.accounts.length ? `<section class="kpis"><div class="kpi"><div class="kpi-head"><span class="kpi-ic">${icon('wallet', 18)}</span>Net worth</div><div class="kpi-value tnum">${fmt(A - L)}</div><div class="kpi-sub">assets minus liabilities</div></div><div class="kpi"><div class="kpi-head"><span class="kpi-ic">${icon('up', 18)}</span>Assets</div><div class="kpi-value tnum">${fmt(A)}</div><div class="kpi-sub">${assets.length} accounts</div></div><div class="kpi"><div class="kpi-head"><span class="kpi-ic">${icon('down', 18)}</span>Liabilities</div><div class="kpi-value tnum">${fmt(L)}</div><div class="kpi-sub">${liabs.length} accounts</div></div></section>
    ${series.length >= 2 ? `<section class="card"><div class="card-head"><h2>Net worth over time</h2></div>${areaChart([{ name: 'Net worth', color: 'var(--s1)', points: series.map((p) => ({ x: monthLabel(p.month).slice(0, 3), full: monthLabel(p.month), y: p.net })) }])}</section>` : ''}
    <section class="card flush"><div class="table-wrap"><table class="tx"><thead><tr><th>Account</th><th>Type</th><th class="num">Balance</th><th>Updated</th><th></th></tr></thead><tbody>
      ${state.accounts.map((a) => `<tr><td class="desc">${esc(a.name)}</td><td>${esc(ACCOUNT_TYPES[a.type]?.[0] || a.type)}</td><td class="num ${ACCOUNT_TYPES[a.type]?.[1] === 'liability' ? 'neg' : ''}">${fmt2(a.balance)}</td><td class="faint small">${longDate(a.history.at(-1).date)}</td><td class="acts"><button class="icon" data-action="acct-edit" data-id="${a.id}" aria-label="Update ${esc(a.name)}">${icon('edit', 17)}</button></td></tr>`).join('')}</tbody></table></div></section>`
    : `<section class="card">${emptyBlock('wallet', 'Track your net worth', 'Add your bank balances, FDs, investments and loans in a minute.', `<button class="btn primary" data-action="acct-new">${icon('plus', 17)} Add account</button>`)}${fromStatements.length ? `<p class="muted small center">Latest statement balances: ${fromStatements.map((t) => `${esc(t.account)} ${fmt(t.balance)}`).join(' · ')}</p>` : ''}</section>`}`;
}

function forecastTab() {
  if (!state.txns.length) return `<section class="card">${emptyBlock('calendar', 'Nothing to forecast yet', 'Import statements first.')}</section>`;
  const { items } = recurringItems();
  const fc = forecast(state.txns, items, { today: toISO(new Date()), days: 30 });
  const outflow = sum(fc.expected.filter((e) => e.amount < 0), (e) => -e.amount);
  const inflow = sum(fc.expected.filter((e) => e.amount > 0), (e) => e.amount);
  return `<section class="kpis">
    <div class="kpi"><div class="kpi-head"><span class="kpi-ic">${icon('down', 18)}</span>Expected in</div><div class="kpi-value tnum">${fmt(inflow)}</div><div class="kpi-sub">next 30 days</div></div>
    <div class="kpi"><div class="kpi-head"><span class="kpi-ic">${icon('repeat', 18)}</span>Bills &amp; subscriptions</div><div class="kpi-value tnum">${fmt(outflow)}</div><div class="kpi-sub">${fc.expected.filter((e) => e.amount < 0).length} payments</div></div>
    <div class="kpi"><div class="kpi-head"><span class="kpi-ic">${icon('receipt', 18)}</span>Everyday spending</div><div class="kpi-value tnum">${fmt(fc.dailyBase * 30)}</div><div class="kpi-sub">${fmt(fc.dailyBase)} a day (typical)</div></div>
    <div class="kpi ${fc.total < 0 ? 'bad' : ''}"><div class="kpi-head"><span class="kpi-ic">${icon('wallet', 18)}</span>Projected change</div><div class="kpi-value tnum">${fc.total >= 0 ? '+' : '−'}${fmt(Math.abs(fc.total))}</div><div class="kpi-sub">to your balance in 30 days</div></div></section>
  <section class="card"><div class="card-head"><h2>Cumulative cash flow, next 30 days</h2></div>${areaChart([{ name: 'Projected change', color: 'var(--s1)', points: fc.points.map((p) => ({ x: shortDate(p.date), full: longDate(p.date), y: p.cumulative })) }], { labelEvery: 5 })}
    <p class="muted small">Starts at zero today. Combines your recurring bills, expected salary and your typical everyday spending over the last 90 days. A projection, not a promise.</p></section>
  <section class="card flush"><div class="table-wrap"><table class="tx"><thead><tr><th>Date</th><th>What</th><th>Type</th><th class="num">Amount</th></tr></thead><tbody>
    ${fc.expected.map((e) => `<tr><td class="nowrap">${longDate(e.date)}</td><td class="desc">${esc(e.label)}</td><td class="muted">${esc(e.kind)}</td><td class="num ${e.amount > 0 ? 'pos' : ''}">${e.amount > 0 ? '+' : '−'}${fmt(Math.abs(e.amount))}</td></tr>`).join('') || `<tr><td colspan="4">${emptyBlock('calendar', 'No scheduled items', 'No recurring payments were detected for the next 30 days.')}</td></tr>`}</tbody></table></div></section>`;
}

function owedTab() {
  const list = owedList();
  const total = sum(list, (l) => l.open);
  return `<p class="muted">Mark a transaction as shared (edit it → “Shared with someone”) and track who still owes you. Only your own share counts as spending.</p>
    ${list.length ? `<section class="kpis"><div class="kpi"><div class="kpi-head"><span class="kpi-ic">${icon('users', 18)}</span>Owed to you</div><div class="kpi-value tnum">${fmt(total)}</div><div class="kpi-sub">${list.filter((l) => l.open > 0).length} people</div></div></section>
    ${list.map((p) => `<section class="card"><div class="card-head"><h2>${icon('users', 18)} ${esc(p.who)}</h2><b class="tnum ${p.open > 0 ? 'neg' : 'pos'}">${p.open > 0 ? fmt(p.open) + ' owed' : 'All settled'}</b></div>
      <ul class="plainlist">${p.items.sort((a, b) => (a.date < b.date ? 1 : -1)).map((t) => `<li><span><b>${esc(t.desc.slice(0, 48))}</b><div class="faint xs">${longDate(t.date)} · total ${fmt2(t.amount)}</div></span><span class="row gap"><b class="tnum">${fmt2(t.share.amount)}</b>${t.share.settled ? '<span class="chip good">Paid</span>' : `<button class="btn small" data-action="share-settle" data-id="${t.id}">Mark paid</button>`}</span></li>`).join('')}</ul></section>`).join('')}` : `<section class="card">${emptyBlock('users', 'Nobody owes you anything', 'When you split a dinner or a trip, record it here so nothing gets forgotten.')}</section>`}`;
}

export function plan() {
  const tab = state.ui.planTab;
  const tabs = [['goals', 'Goals', 'flag'], ['net', 'Net worth', 'wallet'], ['forecast', 'Forecast', 'calendar'], ['owed', 'Owed to you', 'users']];
  return `<div class="page-head"><div><h1>Plan</h1><p>Goals, net worth and what the next month looks like.</p></div></div>
  <nav class="tabs" role="tablist">${tabs.map(([k, l, ic]) => `<button role="tab" aria-selected="${tab === k}" class="${tab === k ? 'on' : ''}" data-action="plan-tab" data-tab="${k}">${icon(ic, 16)}${l}</button>`).join('')}</nav>
  ${tab === 'net' ? netTab() : tab === 'forecast' ? forecastTab() : tab === 'owed' ? owedTab() : goalsTab()}`;
}
