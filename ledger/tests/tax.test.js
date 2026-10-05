import test from 'node:test';
import assert from 'node:assert/strict';
import { compare, computeNew, computeOld, extractForm16 } from '../js/tax.js';

test('new regime: 12L salary is tax free after 87A, 15L gross matches published figure', () => {
  assert.equal(computeNew({ grossSalary: 1200000 }).total, 0);
  // taxable 14.25L: 20k + 40k + 33,750 = 93,750 + 4% cess = 97,500
  assert.equal(computeNew({ grossSalary: 1500000 }).total, 97500);
});

test('new regime marginal relief just above the rebate limit', () => {
  // gross 12.9L -> taxable 12.15L; slab tax = 61,500 + ... capped at 15,000 (income above 12L), +4% cess = 15,600
  const r = computeNew({ grossSalary: 1290000 });
  assert.equal(r.total, 15600);
});

test('old regime: 12L gross with 1.5L 80C', () => {
  // taxable = 12L - 50k - 1.5L = 10L -> 12,500 + 100,000 = 112,500 -> +cess = 117,000
  assert.equal(computeOld({ grossSalary: 1200000, sec80C: 150000 }).total, 117000);
});

test('old regime rebate up to 5L taxable', () => {
  assert.equal(computeOld({ grossSalary: 550000 }).total, 0);
});

test('HRA exemption and caps are applied; old wins only with enough deductions', () => {
  const heavy = { grossSalary: 1800000, basicSalary: 800000, hraReceived: 320000, rentPaid: 300000, metro: true, sec80C: 150000, nps80CCD1B: 50000, health80DSelf: 25000, homeLoanInterest: 200000 };
  const c = compare(heavy);
  assert.equal(c.better, 'old');
  const light = compare({ grossSalary: 1800000, basicSalary: 800000, sec80C: 50000 });
  assert.equal(light.better, 'new');
  assert.ok(light.extraDeductionsNeeded > 0);
  const o = computeOld(heavy);
  assert.equal(o.exemptions[0].amount, 220000); // rent 3L - 10% basic(80k) = 2.2L < HRA 3.2L < 50% basic 4L
  assert.equal(o.deductions.find((d) => d.label === '80C').amount, 150000);
});

test('surcharge with marginal relief never makes tax jump more than income above the threshold', () => {
  const just = computeNew({ grossSalary: 5000000 + 75000 + 1 }).total;
  const above = computeNew({ grossSalary: 5000000 + 75000 + 20000 }).total;
  assert.ok(above - just <= 20000 * 1.04 + 1);
});

test('refund / balance uses TDS', () => {
  const c = compare({ grossSalary: 1200000, tdsDeducted: 80000 });
  assert.equal(c.newBalance, -80000);
});

test('Form 16 extraction picks up key figures', () => {
  const t = 'PAN of employee ABCDE1234F  Gross Salary (a) Salary as per provisions contained in section 17(1) 12,50,000.00 Standard deduction under section 16(ia) 75,000.00 Total amount of tax deducted 45,000.00';
  const f = extractForm16(t);
  assert.equal(f.grossSalary, 1250000);
  assert.equal(f.pan, 'ABCDE1234F');
  assert.equal(f.standardDeduction, 75000);
  assert.equal(f.tdsDeducted, 45000);
});
