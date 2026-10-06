// Aggregations used by the dashboard. Pure functions over the transaction array.
import { CATEGORIES, groupOf } from './categorize.js';
import { monthKey, sum } from './util.js';

/** A transaction's category slices: split transactions contribute to several categories. */
export function slices(t) {
  let list;
  if (t.splits?.length) {
    const used = sum(t.splits, (s) => s.amount);
    const rest = Math.max(0, t.amount - used);
    list = [...t.splits.map((s) => ({ category: s.category, amount: s.amount })), ...(rest > 0.005 ? [{ category: t.category, amount: rest }] : [])];
  } else list = [{ category: t.category, amount: t.amount }];
  // Money a friend owes you for a shared expense is not your own spending.
  if (t.type === 'debit' && t.share?.amount > 0 && t.amount > 0) {
    const f = Math.max(0, (t.amount - t.share.amount) / t.amount);
    list = list.map((s) => ({ ...s, amount: s.amount * f }));
  }
  return list;
}

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
    for (const s of slices(t)) {
      const g = groupOf(s.category);
      if (t.type === 'credit') {
        if (g === 'income') row.income += s.amount;
        else if (g === 'save') row.save -= s.amount;
        else if (g === 'spend') row.spend -= s.amount; // refund tagged to a spend category nets it off
      } else if (g === 'spend') {
        row.spend += s.amount;
        row.byCat[s.category] = (row.byCat[s.category] || 0) + s.amount;
      } else if (g === 'save') row.save += s.amount;
      else if (g === 'transfer') row.transfer += s.amount;
    }
  }
  return [...m.values()].sort((a, b) => (a.month < b.month ? -1 : 1));
}

export function categoryBreakdown(txns, month) {
  const by = {};
  for (const t of txns) {
    if (t.type !== 'debit') continue;
    if (month && monthKey(t.date) !== month) continue;
    for (const s of slices(t)) {
      if (groupOf(s.category) !== 'spend') continue;
      by[s.category] = (by[s.category] || 0) + s.amount;
    }
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

/** Month-over-month movers per category. */
export function movers(txns, month, prevMonth) {
  const a = Object.fromEntries(categoryBreakdown(txns, month).map((x) => [x.category, x.amount]));
  const b = Object.fromEntries(categoryBreakdown(txns, prevMonth).map((x) => [x.category, x.amount]));
  return [...new Set([...Object.keys(a), ...Object.keys(b)])]
    .map((category) => ({ category, now: a[category] || 0, prev: b[category] || 0, delta: (a[category] || 0) - (b[category] || 0) }))
    .filter((x) => Math.abs(x.delta) > 0)
    .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
}

/** Spend per day-of-month for the calendar heatmap. */
export function spendByDay(txns, month) {
  const out = {};
  for (const t of txns) {
    if (t.type !== 'debit' || monthKey(t.date) !== month) continue;
    for (const s of slices(t)) if (groupOf(s.category) === 'spend') out[+t.date.slice(8, 10)] = (out[+t.date.slice(8, 10)] || 0) + s.amount;
  }
  return out;
}

/** Spend by weekday (Mon=0) over the given months (all if omitted). */
export function spendByWeekday(txns) {
  const out = Array(7).fill(0);
  for (const t of txns) {
    if (t.type !== 'debit') continue;
    const d = new Date(+t.date.slice(0, 4), +t.date.slice(5, 7) - 1, +t.date.slice(8, 10));
    for (const s of slices(t)) if (groupOf(s.category) === 'spend') out[(d.getDay() + 6) % 7] += s.amount;
  }
  return out;
}

export const summarize = (txns) => {
  const t = monthlyTotals(txns);
  return { income: sum(t, (x) => x.income), spend: sum(t, (x) => x.spend), save: sum(t, (x) => x.save), months: t.length };
};

export { CATEGORIES };
