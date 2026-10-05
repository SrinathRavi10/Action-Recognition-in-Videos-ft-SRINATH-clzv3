import test from 'node:test';
import assert from 'node:assert/strict';
import { detectRecurring, buildAlerts } from '../js/recurring.js';
import { addMonths } from '../js/util.js';

const tx = (date, desc, amount, category) => ({ date, desc, amount, type: 'debit', category });

function monthly(desc, start, amounts, category) {
  return amounts.map((a, i) => tx(addMonths(start, i), desc, a, category));
}

test('detects monthly OTT subscription with price hike and upcoming renewal', () => {
  const t = [
    ...monthly('ACH D- NETFLIX COM-11111', '2026-04-12', [649, 649, 649, 649, 799, 799], 'Subscriptions'),
    // noise: frequent but irregular food orders must NOT be flagged
    tx('2026-04-02', 'UPI/1/SWIGGY/swiggy@ybl', 312, 'Food & Dining'), tx('2026-04-09', 'UPI/2/SWIGGY/swiggy@ybl', 150, 'Food & Dining'),
    tx('2026-04-30', 'UPI/3/SWIGGY/swiggy@ybl', 480, 'Food & Dining'), tx('2026-05-02', 'UPI/4/SWIGGY/swiggy@ybl', 220, 'Food & Dining'),
  ];
  const r = detectRecurring(t, { today: '2026-10-08' });
  assert.equal(r.length, 1);
  assert.equal(r[0].name, 'Netflix');
  assert.equal(r[0].cadence, 'monthly');
  assert.equal(r[0].kind, 'OTT & apps');
  assert.equal(r[0].amount, 799);
  assert.equal(Math.round(r[0].hike.pct), 23);
  assert.equal(r[0].nextDue, '2026-10-12');
  const alerts = buildAlerts(r);
  assert.ok(alerts.some((a) => a.type === 'hike'));
  assert.ok(alerts.some((a) => a.type === 'renewal'));
});

test('detects SIPs, variable utilities and yearly insurance with just two payments', () => {
  const t = [
    ...monthly('ACH D- ICCL ZERODHA 123', '2026-01-10', [5000, 5000, 5000, 5000], 'Investments'),
    ...monthly('BESCOM ELECTRICITY BILL', '2026-01-20', [1450, 1980, 2210, 1675], 'Bills & Utilities'),
    tx('2025-03-15', 'LIC OF INDIA PREMIUM', 24000, 'Insurance'), tx('2026-03-15', 'LIC OF INDIA PREMIUM', 24000, 'Insurance'),
  ];
  const r = detectRecurring(t, { today: '2026-05-01' });
  const by = Object.fromEntries(r.map((x) => [x.kind, x]));
  assert.equal(by['SIP & investments'].cadence, 'monthly');
  assert.equal(by['Utilities'].variable, true);
  assert.equal(by['Insurance'].cadence, 'yearly');
  assert.equal(by['Insurance'].nextDue, '2027-03-15');
  assert.equal(Math.round(by['Insurance'].monthlyCost), 2000);
});

test('ignores one-offs, same-day duplicates and cancelled overrides', () => {
  const t = [tx('2026-01-05', 'RANDOM SHOP', 500, 'Shopping'), tx('2026-01-05', 'RANDOM SHOP', 500, 'Shopping'),
    ...monthly('SPOTIFY INDIA', '2026-01-03', [119, 119, 119], 'Subscriptions')];
  assert.equal(detectRecurring(t, { today: '2026-04-01' }).length, 1);
  const c = detectRecurring(t, { today: '2026-04-01', overrides: { 'SPOTIFY INDIA': 'cancelled' } });
  assert.equal(c[0].status, 'cancelled');
});
