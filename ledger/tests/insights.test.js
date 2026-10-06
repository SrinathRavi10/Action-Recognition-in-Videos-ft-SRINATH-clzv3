import test from 'node:test';
import assert from 'node:assert/strict';
import { categorySpikes, unusualTransactions, statementGaps, forecast, yearOverYear, buildInsights } from '../js/insights.js';
import { slices, monthlyTotals, categoryBreakdown } from '../js/analytics.js';
import { detectRecurring } from '../js/recurring.js';
import { addMonths } from '../js/util.js';

let n = 0;
const tx = (date, merchant, amount, category = 'Shopping', type = 'debit', extra = {}) => ({ id: 'x' + n++, date, desc: merchant, merchant, amount, type, category, account: 'A', source: 'file', ...extra });

test('split transactions are spread over categories in totals', () => {
  const t = tx('2026-03-05', 'AMAZON', 1000, 'Shopping', 'debit', { splits: [{ category: 'Groceries', amount: 400 }] });
  assert.deepEqual(slices(t), [{ category: 'Groceries', amount: 400 }, { category: 'Shopping', amount: 600 }]);
  const b = Object.fromEntries(categoryBreakdown([t], '2026-03').map((x) => [x.category, x.amount]));
  assert.equal(b.Groceries, 400); assert.equal(b.Shopping, 600);
  assert.equal(monthlyTotals([t])[0].spend, 1000);
});

test('category spike vs previous months', () => {
  const t = [];
  for (const m of ['2026-01', '2026-02', '2026-03', '2026-04']) t.push(tx(m + '-10', 'ZOMATO', 4000, 'Food & Dining'));
  t.push(tx('2026-05-10', 'ZOMATO', 9000, 'Food & Dining'));
  const s = categorySpikes(t, '2026-05');
  assert.equal(s.length, 1); assert.equal(s[0].category, 'Food & Dining');
});

test('large payments and duplicate charges are flagged', () => {
  const t = [];
  for (let i = 0; i < 5; i++) t.push(tx(`2026-0${i + 1}-03`, 'BIGBASKET', 1000));
  t.push(tx('2026-05-20', 'BIGBASKET', 9500));
  t.push(tx('2026-05-21', 'UBER', 480), tx('2026-05-21', 'UBER', 480));
  const u = unusualTransactions(t, { today: '2026-05-25' });
  assert.ok(u.some((x) => x.type === 'large'));
  assert.ok(u.some((x) => x.type === 'duplicate'));
});

test('statement gaps found between uploads', () => {
  const g = statementGaps([tx('2026-01-05', 'A', 1), tx('2026-02-05', 'A', 1), tx('2026-05-05', 'A', 1)]);
  assert.deepEqual(g[0].months, ['2026-03', '2026-04']);
});

test('forecast includes recurring dues and expected salary', () => {
  const t = [];
  for (let m = 0; m < 5; m++) { t.push(tx(addMonths('2026-01-07', m), 'NETFLIX', 649, 'Subscriptions')); t.push(tx(addMonths('2026-01-01', m), 'ACME', 100000, 'Salary', 'credit')); t.push(tx(addMonths('2026-01-15', m), 'SWIGGY', 600 + m * 50, 'Food & Dining')); }
  const rec = detectRecurring(t, { today: '2026-05-20' });
  const f = forecast(t, rec, { today: '2026-05-20', days: 30 });
  assert.ok(f.expected.some((e) => e.label.startsWith('Netflix')));
  assert.ok(f.expected.some((e) => e.label.startsWith('Salary')));
  assert.equal(f.points.length, 31);
  assert.ok(f.dailyBase > 0);
});

test('year over year + insight cards', () => {
  const t = [tx('2025-03-10', 'X', 10000, 'Shopping'), tx('2026-03-10', 'X', 15000, 'Shopping'), tx('2026-03-01', 'ACME', 80000, 'Salary', 'credit')];
  const y = yearOverYear(t, '2026-03');
  assert.equal(Math.round(y.pct), 50);
  const totals = monthlyTotals(t);
  const cards = buildInsights(t, { month: '2026-03', cur: totals.at(-1), prev: totals[0], today: '2026-03-20' });
  assert.ok(cards.some((c) => /more than/.test(c.title)));
});

test('shared expenses only count your own share', () => {
  const t = tx('2026-03-05', 'DINNER', 2000, 'Food & Dining', 'debit', { share: { with: 'Ravi', amount: 800, settled: false } });
  assert.equal(Math.round(monthlyTotals([t])[0].spend), 1200);
});
