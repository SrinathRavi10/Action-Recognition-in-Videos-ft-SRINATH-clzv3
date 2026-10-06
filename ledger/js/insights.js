// Smart insights: anomalies, duplicates, forecast, year-over-year, statement gaps.
import { groupOf, displayMerchant } from './categorize.js';
import { monthlyTotals, categoryBreakdown } from './analytics.js';
import { addDays, addMonths, daysBetween, fmt, median, monthKey, monthLabel, toISO, fromISO, sum } from './util.js';

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const stdev = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };

/** Categories whose spend this month is well above their recent average. */
export function categorySpikes(txns, month) {
  const totals = monthlyTotals(txns);
  const idx = totals.findIndex((t) => t.month === month);
  if (idx < 3) return [];
  const prev = totals.slice(Math.max(0, idx - 4), idx);
  const cur = totals[idx];
  const out = [];
  for (const [cat, v] of Object.entries(cur.byCat)) {
    const hist = prev.map((p) => p.byCat[cat] || 0);
    const m = mean(hist), sd = stdev(hist);
    if (m < 500) continue;
    if (v > m * 1.4 && v - m > 1500 && (sd === 0 || v > m + 1.5 * sd)) out.push({ category: cat, now: v, avg: m, pct: ((v - m) / m) * 100 });
  }
  return out.sort((a, b) => b.now - b.avg - (a.now - a.avg));
}

/** Unusually large single payments and probable double charges. */
export function unusualTransactions(txns, { sinceDays = 45, today = toISO(new Date()) } = {}) {
  const spend = txns.filter((t) => t.type === 'debit' && groupOf(t.category) === 'spend');
  const byMerchant = new Map();
  for (const t of spend) { if (!byMerchant.has(t.merchant)) byMerchant.set(t.merchant, []); byMerchant.get(t.merchant).push(t.amount); }
  const out = [];
  const recent = spend.filter((t) => daysBetween(t.date, today) <= sinceDays);
  for (const t of recent) {
    const hist = byMerchant.get(t.merchant);
    if (hist.length >= 4) {
      const med = median(hist);
      if (t.amount > med * 3 && t.amount > 3000) { out.push({ type: 'large', txn: t, note: `${fmt(t.amount)} is about ${(t.amount / med).toFixed(0)}× your usual ${fmt(med)} at ${displayMerchant(t.merchant)}` }); continue; }
    }
    if (hist.length <= 2 && t.amount >= 15000) out.push({ type: 'large', txn: t, note: `Large first-time payment of ${fmt(t.amount)} to ${displayMerchant(t.merchant)}` });
  }
  // duplicates: same merchant & amount within 2 days, not a regular cadence
  const sorted = [...recent].sort((a, b) => (a.date < b.date ? -1 : 1));
  for (let i = 1; i < sorted.length; i++) {
    for (let j = i - 1; j >= 0 && daysBetween(sorted[j].date, sorted[i].date) <= 2; j--) {
      const a = sorted[j], b = sorted[i];
      if (a.merchant === b.merchant && Math.abs(a.amount - b.amount) < 0.01 && a.amount >= 200 && a.id !== b.id) {
        out.push({ type: 'duplicate', txn: b, other: a, note: `Two payments of ${fmt(b.amount)} to ${displayMerchant(b.merchant)} within ${daysBetween(a.date, b.date)} day(s)` });
        break;
      }
    }
  }
  return out;
}

/** Months with no transactions between the first and last statement of an account. */
export function statementGaps(txns) {
  const by = new Map();
  for (const t of txns) { if (t.source === 'manual' || t.source === 'demo') continue; if (!by.has(t.account)) by.set(t.account, new Set()); by.get(t.account).add(monthKey(t.date)); }
  const gaps = [];
  for (const [account, set] of by) {
    const ms = [...set].sort();
    if (ms.length < 2) continue;
    let cur = ms[0];
    const missing = [];
    while (cur < ms.at(-1)) { cur = monthKey(addMonths(cur + '-01', 1)); if (!set.has(cur) && cur < ms.at(-1)) missing.push(cur); }
    if (missing.length) gaps.push({ account, months: missing });
  }
  return gaps;
}

/** This month vs the same month last year, and financial-year-to-date vs last year. */
export function yearOverYear(txns, month) {
  const totals = monthlyTotals(txns);
  const cur = totals.find((t) => t.month === month);
  const lastKey = `${+month.slice(0, 4) - 1}${month.slice(4)}`;
  const last = totals.find((t) => t.month === lastKey);
  if (!cur || !last) return null;
  return { month, lastMonth: lastKey, spend: cur.spend, lastSpend: last.spend, income: cur.income, lastIncome: last.income, pct: last.spend ? ((cur.spend - last.spend) / last.spend) * 100 : null };
}

export function yearSummary(txns) {
  const totals = monthlyTotals(txns);
  const years = new Map();
  for (const t of totals) {
    const y = t.month.slice(0, 4);
    const e = years.get(y) || { year: y, income: 0, spend: 0, save: 0, months: 0 };
    e.income += t.income; e.spend += t.spend; e.save += t.save; e.months++;
    years.set(y, e);
  }
  return [...years.values()];
}

/**
 * Project the next `days` days of cash flow from recurring payments + typical everyday spend + expected income.
 * Returns { points:[{date, net, cumulative}], monthEndSaving, dailyBase, expected:[{date,label,amount}] }.
 */
export function forecast(txns, recurring, { today = toISO(new Date()), days = 30 } = {}) {
  const recent = txns.filter((t) => daysBetween(t.date, today) <= 90 && daysBetween(t.date, today) >= 0);
  const recKeys = new Set(recurring.filter((r) => r.status !== 'cancelled' && r.status !== 'lapsed').map((r) => r.key));
  const base = recent.filter((t) => t.type === 'debit' && groupOf(t.category) === 'spend' && !recKeys.has(t.merchant) && t.category !== 'Rent & Housing');
  const span = Math.max(30, Math.min(90, recent.length ? daysBetween(recent.reduce((a, t) => (t.date < a ? t.date : a), today), today) + 1 : 30));
  const dailyBase = sum(base, (t) => t.amount) / span;
  const expected = [];
  for (const r of recurring) {
    if (r.status === 'cancelled' || r.status === 'lapsed') continue;
    let due = r.nextDue;
    let guard = 0;
    while (daysBetween(today, due) <= days && guard++ < 6) {
      if (daysBetween(today, due) >= 0) expected.push({ date: due, label: r.name, amount: -r.amount, kind: r.kind });
      due = r.cadenceDays >= 28 ? addMonths(due, Math.max(1, Math.round(r.cadenceDays / 30))) : addDays(due, r.cadenceDays);
    }
  }
  // Expected salary: same day-of-month as last salary credit.
  const sal = txns.filter((t) => t.type === 'credit' && t.category === 'Salary').sort((a, b) => (a.date < b.date ? 1 : -1));
  if (sal.length >= 2) {
    const amt = median(sal.slice(0, 3).map((s) => s.amount));
    let due = addMonths(sal[0].date, 1);
    let guard = 0;
    while (daysBetween(today, due) <= days && guard++ < 3) {
      if (daysBetween(today, due) >= 0) expected.push({ date: due, label: 'Salary (expected)', amount: amt, kind: 'income' });
      due = addMonths(due, 1);
    }
  }
  const pts = [];
  let cum = 0;
  for (let i = 0; i <= days; i++) {
    const d = addDays(today, i);
    const ex = sum(expected.filter((e) => e.date === d), (e) => e.amount);
    const net = ex - (i === 0 ? 0 : dailyBase);
    cum += net;
    pts.push({ date: d, net, cumulative: cum });
  }
  return { points: pts, dailyBase, expected: expected.sort((a, b) => (a.date < b.date ? -1 : 1)), total: cum };
}

/**
 * Human-readable insight cards for the home screen.
 * ctx: { month, prevMonth, totals(cur), prevTotals, recurring, alerts, budgets, today }
 */
export function buildInsights(txns, ctx) {
  const out = [];
  const { month, cur, prev, budgets = {}, recurring = [] } = ctx;
  if (cur && prev && prev.spend > 0) {
    const pct = ((cur.spend - prev.spend) / prev.spend) * 100;
    if (Math.abs(pct) >= 10) out.push({ level: pct > 0 ? 'warn' : 'good', icon: pct > 0 ? 'up' : 'down', title: `Spending is ${pct > 0 ? 'up' : 'down'} ${Math.abs(pct).toFixed(0)}% on last month`, text: `${fmt(cur.spend)} vs ${fmt(prev.spend)}.` });
  }
  if (cur?.income > 0) {
    const rate = ((cur.income - cur.spend) / cur.income) * 100;
    if (rate >= 30) out.push({ level: 'good', icon: 'piggy', title: `You kept ${rate.toFixed(0)}% of your income`, text: `${fmt(cur.income - cur.spend)} left after spending – a healthy savings rate.` });
    else if (rate < 5) out.push({ level: 'bad', icon: 'alert', title: rate < 0 ? 'You spent more than you earned' : 'Almost nothing left after spending', text: `${fmt(cur.spend)} out vs ${fmt(cur.income)} in this month.` });
  }
  for (const s of categorySpikes(txns, month).slice(0, 2)) out.push({ level: 'warn', icon: 'sparkle', title: `${s.category} is ${s.pct.toFixed(0)}% above normal`, text: `${fmt(s.now)} this month vs a usual ${fmt(s.avg)}.` });
  const subs = recurring.filter((r) => r.status !== 'cancelled' && r.status !== 'lapsed' && ['OTT & apps', 'Mobile & broadband'].includes(r.kind));
  const subCost = sum(subs, (r) => r.yearlyCost);
  if (subs.length >= 3) out.push({ level: 'info', icon: 'repeat', title: `${subs.length} subscriptions cost ${fmt(subCost)} a year`, text: 'Review them on the Bills page – cancel anything you no longer use.' });
  for (const [cat, lim] of Object.entries(budgets)) {
    const spent = cur?.byCat?.[cat] || 0;
    if (lim > 0 && spent > lim) out.push({ level: 'bad', icon: 'target', title: `${cat} budget exceeded`, text: `${fmt(spent)} spent against a ${fmt(lim)} budget.` });
  }
  const unusual = unusualTransactions(txns, { today: ctx.today });
  for (const u of unusual.slice(0, 2)) out.push({ level: u.type === 'duplicate' ? 'bad' : 'warn', icon: u.type === 'duplicate' ? 'copy' : 'alert', title: u.type === 'duplicate' ? 'Possible double charge' : 'Unusually large payment', text: u.note });
  const gaps = statementGaps(txns);
  if (gaps.length) out.push({ level: 'info', icon: 'calendar', title: 'Statement gap', text: `${gaps[0].account}: no data for ${gaps[0].months.slice(0, 3).map(monthLabel).join(', ')}${gaps[0].months.length > 3 ? '…' : ''}. Import those months for accurate totals.` });
  const yoy = yearOverYear(txns, month);
  if (yoy?.pct != null && Math.abs(yoy.pct) >= 8) out.push({ level: yoy.pct > 0 ? 'warn' : 'good', icon: 'calendar', title: `${Math.abs(yoy.pct).toFixed(0)}% ${yoy.pct > 0 ? 'more' : 'less'} than ${monthLabel(yoy.lastMonth)}`, text: `${fmt(yoy.spend)} this month vs ${fmt(yoy.lastSpend)} a year ago.` });
  return out;
}
