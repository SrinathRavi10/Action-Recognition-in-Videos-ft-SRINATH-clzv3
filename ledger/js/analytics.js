// Aggregations used by the dashboard. Pure functions over the transaction array.
import { CATEGORIES, groupOf } from './categorize.js';
import { monthKey, sum } from './util.js';

export function monthsIn(txns) {
  return [...new Set(txns.map((t) => monthKey(t.date)))].sort();
}

/** Per-month totals by group. */
export function monthlyTotals(txns) {
  const m = new Map();
  for (const t of txns) {
    const k = monthKey(t.date);
    if (!m.has(k)) m.set(k, { month: k, income: 0, spend: 0, save: 0, transfer: 0, byCat: {} });
    const row = m.get(k);
    const g = groupOf(t.category);
    if (t.type === 'credit') {
      if (g === 'income') row.income += t.amount;
      else if (g === 'save') row.save -= t.amount;
      else if (g === 'spend') row.spend -= t.amount; // refund-like credit tagged to a spend category nets it off
    } else if (g === 'spend') {
      row.spend += t.amount;
      row.byCat[t.category] = (row.byCat[t.category] || 0) + t.amount;
    } else if (g === 'save') row.save += t.amount;
    else if (g === 'transfer') row.transfer += t.amount;
  }
  return [...m.values()].sort((a, b) => (a.month < b.month ? -1 : 1));
}

export function categoryBreakdown(txns, month) {
  const by = {};
  for (const t of txns) {
    if (t.type !== 'debit' || groupOf(t.category) !== 'spend') continue;
    if (month && monthKey(t.date) !== month) continue;
    by[t.category] = (by[t.category] || 0) + t.amount;
  }
  return Object.entries(by).map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount);
}

export function topMerchants(txns, month, n = 8) {
  const by = new Map();
  for (const t of txns) {
    if (t.type !== 'debit' || groupOf(t.category) !== 'spend') continue;
    if (month && monthKey(t.date) !== month) continue;
    const e = by.get(t.merchant) || { merchant: t.merchant, amount: 0, count: 0, category: t.category };
    e.amount += t.amount; e.count++;
    by.set(t.merchant, e);
  }
  return [...by.values()].sort((a, b) => b.amount - a.amount).slice(0, n);
}

/** Month-over-month movers per category: [{category, now, prev, delta}] biggest absolute change first. */
export function movers(txns, month, prevMonth) {
  const a = Object.fromEntries(categoryBreakdown(txns, month).map((x) => [x.category, x.amount]));
  const b = Object.fromEntries(categoryBreakdown(txns, prevMonth).map((x) => [x.category, x.amount]));
  return [...new Set([...Object.keys(a), ...Object.keys(b)])]
    .map((category) => ({ category, now: a[category] || 0, prev: b[category] || 0, delta: (a[category] || 0) - (b[category] || 0) }))
    .filter((x) => Math.abs(x.delta) > 0)
    .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
}

export const summarize = (txns) => {
  const t = monthlyTotals(txns);
  return { income: sum(t, (x) => x.income), spend: sum(t, (x) => x.spend), save: sum(t, (x) => x.save), months: t.length };
};

export { CATEGORIES };
