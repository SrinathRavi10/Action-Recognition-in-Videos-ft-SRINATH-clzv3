// Indian income-tax estimator for salaried individuals: old vs new regime.
// ESTIMATES ONLY – not filing advice. Slabs live in RULES so they can be updated in one place.

const NEW_SLABS = [[400000, 0], [800000, 0.05], [1200000, 0.1], [1600000, 0.15], [2000000, 0.2], [2400000, 0.25], [Infinity, 0.3]];
const OLD_SLABS = {
  below60: [[250000, 0], [500000, 0.05], [1000000, 0.2], [Infinity, 0.3]],
  senior: [[300000, 0], [500000, 0.05], [1000000, 0.2], [Infinity, 0.3]],
  super: [[500000, 0], [1000000, 0.2], [Infinity, 0.3]],
};

const BASE_RULES = {
  newRegime: { slabs: NEW_SLABS, standardDeduction: 75000, rebateLimit: 1200000, rebateMax: 60000, npsEmployerPct: 0.14, surcharge: [[5e6, 0.1], [1e7, 0.15], [2e7, 0.25]] },
  oldRegime: { slabs: OLD_SLABS, standardDeduction: 50000, rebateLimit: 500000, rebateMax: 12500, npsEmployerPct: 0.1, surcharge: [[5e6, 0.1], [1e7, 0.15], [2e7, 0.25], [5e7, 0.37]],
    cap80C: 150000, cap80CCD1B: 50000, cap80D_self: 25000, cap80D_self_senior: 50000, cap80D_parents: 25000, cap80D_parents_senior: 50000, cap80D_total: 100000, cap80TTA: 10000, cap80TTB: 50000, capHomeLoan: 200000 },
  cess: 0.04,
};

/** Financial years supported. Update here when the Budget changes slabs. */
export const TAX_YEARS = {
  '2025-26': { label: 'FY 2025-26 (AY 2026-27)', verified: true, rules: BASE_RULES },
  '2026-27': { label: 'FY 2026-27 (AY 2027-28)', verified: false, rules: BASE_RULES, note: 'Assumes the FY 2025-26 slabs and limits are unchanged. Check the latest Finance Act before relying on this.' },
};

const n = (v) => (Number.isFinite(+v) ? Math.max(0, +v) : 0);

function slabTax(income, slabs) {
  let tax = 0, lower = 0;
  const rows = [];
  for (const [upper, rate] of slabs) {
    if (income > lower) {
      const part = Math.min(income, upper) - lower;
      rows.push({ from: lower, to: upper, rate, amount: part, tax: part * rate });
      tax += part * rate;
    }
    lower = upper;
  }
  return { tax, rows };
}

/** Surcharge on `income` with marginal relief at each threshold. */
function withSurcharge(tax, income, slabs, bands) {
  let rate = 0, threshold = 0, prevRate = 0;
  for (const [t, r] of bands) {
    if (income > t) { prevRate = rate; rate = r; threshold = t; }
  }
  if (!rate) return { surcharge: 0, rate: 0 };
  let surcharge = tax * rate;
  const atThreshold = slabTax(threshold, slabs).tax;
  const baseTotal = atThreshold + atThreshold * prevRate;
  const relief = tax + surcharge - (baseTotal + (income - threshold));
  if (relief > 0) surcharge -= relief;
  return { surcharge: Math.max(0, surcharge), rate };
}

function hraExemption(p) {
  const hra = n(p.hraReceived), rent = n(p.rentPaid), basic = n(p.basicSalary);
  if (!hra || !rent || !basic) return 0;
  return Math.max(0, Math.min(hra, rent - 0.1 * basic, (p.metro ? 0.5 : 0.4) * basic));
}

function finish(taxable, grossIncome, regime, rules, slabs, p, parts) {
  const { tax: base, rows } = slabTax(taxable, slabs);
  let rebate = 0;
  let tax = base;
  if (taxable <= rules.rebateLimit) {
    rebate = Math.min(base, rules.rebateMax);
    tax = base - rebate;
  } else if (regime === 'new') {
    // Marginal relief: tax payable can't exceed the income above the rebate limit.
    const capped = Math.min(base, taxable - rules.rebateLimit);
    rebate = base - capped;
    tax = capped;
  }
  const { surcharge, rate } = withSurcharge(tax, taxable, slabs, rules.surcharge);
  const cess = (tax + surcharge) * BASE_RULES.cess;
  const total = tax + surcharge + cess;
  return { regime, ...parts, grossIncome, taxable, slabRows: rows, slabTax: base, rebate, taxAfterRebate: tax, surcharge, surchargeRate: rate, cess, total: Math.round(total) };
}

export function computeNew(p, year = '2025-26') {
  const r = TAX_YEARS[year].rules.newRegime;
  const salary = n(p.grossSalary);
  const other = n(p.savingsInterest) + n(p.fdInterest) + n(p.otherIncome);
  const std = salary > 0 ? Math.min(r.standardDeduction, salary) : 0;
  const nps = Math.min(n(p.employerNPS), r.npsEmployerPct * n(p.basicSalary));
  const gross = salary + other;
  const taxable = Math.max(0, gross - std - nps);
  return finish(taxable, gross, 'new', r, r.slabs, p, { exemptions: [], deductions: [{ label: 'Standard deduction', amount: std }, ...(nps ? [{ label: 'Employer NPS 80CCD(2)', amount: nps }] : [])] });
}

export function computeOld(p, year = '2025-26') {
  const r = TAX_YEARS[year].rules.oldRegime;
  const age = p.age || 'below60';
  const salary = n(p.grossSalary);
  const other = n(p.savingsInterest) + n(p.fdInterest) + n(p.otherIncome);
  const hra = hraExemption(p);
  const std = salary > 0 ? Math.min(r.standardDeduction, salary) : 0;
  const homeLoan = Math.min(n(p.homeLoanInterest), r.capHomeLoan);
  const nps = Math.min(n(p.employerNPS), r.npsEmployerPct * n(p.basicSalary));
  const c80 = Math.min(n(p.sec80C), r.cap80C);
  const nps1b = Math.min(n(p.nps80CCD1B), r.cap80CCD1B);
  const selfCap = age === 'below60' ? r.cap80D_self : r.cap80D_self_senior;
  const parCap = p.parentsSenior ? r.cap80D_parents_senior : r.cap80D_parents;
  const d80 = Math.min(Math.min(n(p.health80DSelf), selfCap) + Math.min(n(p.health80DParents), parCap), r.cap80D_total);
  const e80 = n(p.eduLoanInterest);
  const g80 = n(p.donations80G);
  const tta = age === 'below60' ? Math.min(n(p.savingsInterest), r.cap80TTA) : 0;
  const ttb = age !== 'below60' ? Math.min(n(p.savingsInterest) + n(p.fdInterest), r.cap80TTB) : 0;
  const gross = salary + other;
  const deductions = [
    ['Standard deduction', std], ['Home-loan interest 24(b)', homeLoan], ['Employer NPS 80CCD(2)', nps], ['80C', c80], ['NPS 80CCD(1B)', nps1b],
    ['Health insurance 80D', d80], ['Education-loan interest 80E', e80], ['Donations 80G', g80], ['Savings interest 80TTA', tta], ['Senior interest 80TTB', ttb],
  ].filter(([, a]) => a > 0).map(([label, amount]) => ({ label, amount }));
  const exemptions = hra ? [{ label: 'HRA exemption 10(13A)', amount: hra }] : [];
  const taxable = Math.max(0, gross - hra - deductions.reduce((a, d) => a + d.amount, 0));
  return finish(taxable, gross, 'old', r, r.slabs[age] || r.slabs.below60, p, { exemptions, deductions });
}

/** Total additional old-regime deductions needed before the old regime beats the new one (null if never / already). */
function breakEven(p, year, newTotal) {
  const oldNow = computeOld(p, year).total;
  if (oldNow <= newTotal) return 0;
  let lo = 0, hi = 5e6;
  const at = (extra) => computeOld({ ...p, donations80G: n(p.donations80G) + extra }, year).total;
  if (at(hi) > newTotal) return null;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (at(mid) > newTotal) lo = mid; else hi = mid;
  }
  return Math.ceil(hi);
}

export function compare(profile, year = '2025-26') {
  const p = { age: 'below60', ...profile };
  const newR = computeNew(p, year);
  const oldR = computeOld(p, year);
  const paid = n(p.tdsDeducted) + n(p.advanceTax);
  const better = oldR.total < newR.total ? 'old' : 'new';
  const saving = Math.abs(oldR.total - newR.total);
  const be = better === 'new' ? breakEven(p, year, newR.total) : 0;
  const totalClaimedOld = oldR.deductions.reduce((a, d) => a + d.amount, 0) + oldR.exemptions.reduce((a, d) => a + d.amount, 0);
  return {
    year, new: newR, old: oldR, better, saving, paid,
    newBalance: newR.total - paid, oldBalance: oldR.total - paid,
    extraDeductionsNeeded: be, totalClaimedOld,
    verified: TAX_YEARS[year].verified, note: TAX_YEARS[year].note || null,
  };
}

/** Pull candidate figures out of Form 16 / certificate text. Returns { field: amount } for the user to confirm. */
export function extractForm16(text) {
  const out = {};
  const amt = String.raw`(\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?|\d+\.\d{2})`;
  const grab = (re) => {
    const m = text.match(re);
    if (!m) return undefined;
    const v = parseFloat(m[1].replace(/,/g, ''));
    return Number.isFinite(v) ? v : undefined;
  };
  const pairs = [
    ['grossSalary', new RegExp(String.raw`gross salary.{0,120}?` + amt, 'is')],
    ['tdsDeducted', new RegExp(String.raw`(?:total (?:amount of )?tax (?:deducted|deductible)|tax deducted at source|total tds).{0,120}?` + amt, 'is')],
    ['standardDeduction', new RegExp(String.raw`standard deduction.{0,80}?` + amt, 'is')],
    ['sec80C', new RegExp(String.raw`(?:section 80C|80C).{0,120}?` + amt, 'is')],
    ['taxableIncome', new RegExp(String.raw`total taxable income.{0,80}?` + amt, 'is')],
    ['basicSalary', new RegExp(String.raw`basic(?: salary| pay)?.{0,60}?` + amt, 'is')],
    ['hraReceived', new RegExp(String.raw`(?:house rent allowance|\bHRA\b).{0,80}?` + amt, 'is')],
  ];
  for (const [k, re] of pairs) {
    const v = grab(re);
    if (v != null && v > 0) out[k] = v;
  }
  const pan = text.match(/\b[A-Z]{5}\d{4}[A-Z]\b/);
  if (pan) out.pan = pan[0];
  return out;
}

export function extractInterest(text) {
  const m = text.match(/(?:total )?interest(?: paid| credited| earned| amount)?[^\d]{0,80}?(\d[\d,]*\.\d{2})/i);
  return m ? parseFloat(m[1].replace(/,/g, '')) : null;
}
