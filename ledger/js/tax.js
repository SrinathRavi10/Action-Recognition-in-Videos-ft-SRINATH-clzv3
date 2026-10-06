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

export const CAPITAL_GAINS = { stcgRate: 0.2, ltcgRate: 0.125, ltcgExempt: 125000 };

/** Business / profession income under presumptive schemes. */
export function businessIncome(p) {
  const r = n(p.businessReceipts);
  if (!r || !p.businessType || p.businessType === 'none') return 0;
  if (p.businessType === '44ADA') return r * 0.5;
  if (p.businessType === '44AD') return r * (p.businessDigital ? 0.06 : 0.08);
  return 0;
}

/** Let-out house property: net income (can be negative) before self-occupied interest. */
export function letOutIncome(p) {
  const nav = Math.max(0, n(p.rentalIncome) - n(p.municipalTax));
  return nav - 0.3 * nav - n(p.letOutInterest);
}

/** Capital-gains tax at special rates, using any unused basic exemption (resident individuals). */
function specialTaxes(normalTaxable, stcg, ltcg, exemptionLimit) {
  let unused = Math.max(0, exemptionLimit - normalTaxable);
  let l = Math.max(0, ltcg - CAPITAL_GAINS.ltcgExempt);
  let st = stcg;
  const u1 = Math.min(unused, st); st -= u1; unused -= u1;
  const u2 = Math.min(unused, l); l -= u2;
  return { stcgTaxable: st, ltcgTaxable: l, income: Math.max(0, stcg - (stcg - st)) + 0, tax: st * CAPITAL_GAINS.stcgRate + l * CAPITAL_GAINS.ltcgRate, totalIncomeAdd: stcg + Math.max(0, ltcg - CAPITAL_GAINS.ltcgExempt) };
}

function finish(normalTaxable, grossIncome, regime, rules, slabs, p, parts) {
  const sp = specialTaxes(normalTaxable, n(p.stcgEquity), n(p.ltcgEquity), slabs[0][0]);
  const totalIncome = normalTaxable + sp.totalIncomeAdd;
  const { tax: base, rows } = slabTax(normalTaxable, slabs);
  let rebate = 0;
  let tax = base;
  if (totalIncome <= rules.rebateLimit) {
    rebate = Math.min(base, rules.rebateMax);
    tax = base - rebate;
  } else if (regime === 'new') {
    // Marginal relief: tax payable can't exceed the income above the rebate limit.
    const capped = Math.min(base, Math.max(0, totalIncome - rules.rebateLimit));
    rebate = base - capped;
    tax = capped;
  }
  const { surcharge: scN, rate } = withSurcharge(tax, totalIncome, slabs, rules.surcharge);
  const scS = sp.tax * Math.min(rate, 0.15);
  const surcharge = scN + scS;
  const cess = (tax + sp.tax + surcharge) * BASE_RULES.cess;
  const total = tax + sp.tax + surcharge + cess;
  return { regime, ...parts, grossIncome, taxable: normalTaxable, totalIncome, slabRows: rows, slabTax: base, rebate, taxAfterRebate: tax,
    special: { stcg: n(p.stcgEquity), ltcg: n(p.ltcgEquity), tax: sp.tax, ltcgExemptUsed: Math.min(n(p.ltcgEquity), CAPITAL_GAINS.ltcgExempt) },
    surcharge, surchargeRate: rate, cess, total: Math.round(total) };
}

function otherIncome(p) { return n(p.savingsInterest) + n(p.fdInterest) + n(p.otherIncome); }

export function computeNew(p, year = '2025-26') {
  const r = TAX_YEARS[year].rules.newRegime;
  const salary = n(p.grossSalary);
  const std = salary > 0 ? Math.min(r.standardDeduction, salary) : 0;
  const nps = Math.min(n(p.employerNPS), r.npsEmployerPct * n(p.basicSalary));
  const hp = Math.max(0, letOutIncome(p)); // house-property losses cannot be set off in the new regime
  const biz = businessIncome(p);
  const gross = salary + otherIncome(p) + hp + biz;
  const taxable = Math.max(0, gross - std - nps);
  return finish(taxable, gross, 'new', r, r.slabs, p, { exemptions: [], deductions: [{ label: 'Standard deduction', amount: std }, ...(nps ? [{ label: 'Employer NPS 80CCD(2)', amount: nps }] : [])], heads: { salary, other: otherIncome(p), houseProperty: hp, business: biz } });
}

export function computeOld(p, year = '2025-26') {
  const r = TAX_YEARS[year].rules.oldRegime;
  const age = p.age || 'below60';
  const salary = n(p.grossSalary);
  const hra = hraExemption(p);
  const std = salary > 0 ? Math.min(r.standardDeduction, salary) : 0;
  const selfInt = Math.min(n(p.homeLoanInterest), r.capHomeLoan);
  const hpTotal = letOutIncome(p) - selfInt;
  const hpGain = Math.max(0, hpTotal);
  const hpLoss = Math.min(r.capHomeLoan, Math.max(0, -hpTotal)); // loss set-off against other heads is capped at ₹2L
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
  const biz = businessIncome(p);
  const gross = salary + otherIncome(p) + hpGain + biz;
  const deductions = [
    ['Standard deduction', std], ['House-property loss set-off', hpLoss], ['Employer NPS 80CCD(2)', nps], ['80C', c80], ['NPS 80CCD(1B)', nps1b],
    ['Health insurance 80D', d80], ['Education-loan interest 80E', e80], ['Donations 80G', g80], ['Savings interest 80TTA', tta], ['Senior interest 80TTB', ttb],
  ].filter(([, a]) => a > 0).map(([label, amount]) => ({ label, amount }));
  const exemptions = hra ? [{ label: 'HRA exemption 10(13A)', amount: hra }] : [];
  const taxable = Math.max(0, gross - hra - deductions.reduce((a, d) => a + d.amount, 0));
  return finish(taxable, gross, 'old', r, r.slabs[age] || r.slabs.below60, p, { exemptions, deductions, heads: { salary, other: otherIncome(p), houseProperty: hpGain, business: biz } });
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

/** Advance-tax instalments: needed only if the liability after TDS is ₹10,000 or more. */
export function advanceTaxPlan(totalTax, paid, { year = '2025-26', presumptive = false, today } = {}) {
  const net = Math.max(0, totalTax - paid);
  if (net < 10000) return { required: false, net, items: [] };
  const y = +year.slice(0, 4);
  const steps = presumptive ? [[1, `${y + 1}-03-15`]] : [[0.15, `${y}-06-15`], [0.45, `${y}-09-15`], [0.75, `${y}-12-15`], [1, `${y + 1}-03-15`]];
  let prev = 0;
  const items = steps.map(([pct, due]) => {
    const cum = Math.round(net * pct);
    const inst = cum - prev; prev = cum;
    return { due, pct, cumulative: cum, instalment: inst, past: today ? due < today : false };
  });
  return { required: true, net, items };
}

/** Year-end moves that could cut tax under the old regime: unused headroom × marginal rate. */
export function savingIdeas(p, year, res) {
  const r = TAX_YEARS[year].rules.oldRegime;
  const age = p.age || 'below60';
  const taxable = res.old.taxable;
  const slabs = r.slabs[age] || r.slabs.below60;
  const marginal = (slabs.find(([u]) => taxable <= u) || slabs.at(-1))[1] * 1.04;
  if (!marginal) return [];
  const ideas = [];
  const h80c = r.cap80C - Math.min(n(p.sec80C), r.cap80C);
  if (h80c > 0) ideas.push({ label: '80C headroom (ELSS, PPF, tax-saver FD, EPF top-up)', amount: h80c, saves: Math.min(h80c, taxable) * marginal });
  const h1b = r.cap80CCD1B - Math.min(n(p.nps80CCD1B), r.cap80CCD1B);
  if (h1b > 0) ideas.push({ label: 'NPS extra ₹50,000 under 80CCD(1B)', amount: h1b, saves: Math.min(h1b, taxable) * marginal });
  const selfCap = age === 'below60' ? r.cap80D_self : r.cap80D_self_senior;
  const hd = selfCap - Math.min(n(p.health80DSelf), selfCap);
  if (hd > 0) ideas.push({ label: 'Health insurance for you & family (80D)', amount: hd, saves: Math.min(hd, taxable) * marginal });
  return ideas.filter((i) => i.saves > 500).sort((a, b) => b.saves - a.saves);
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
  const out = {
    year, new: newR, old: oldR, better, saving, paid,
    newBalance: newR.total - paid, oldBalance: oldR.total - paid,
    extraDeductionsNeeded: be, totalClaimedOld,
    verified: TAX_YEARS[year].verified, note: TAX_YEARS[year].note || null,
  };
  out.ideas = savingIdeas(p, year, out);
  return out;
}

/** Flat summary for filing-portal data entry. */
export function itrSummary(c, profile) {
  const r = c.better === 'old' ? c.old : c.new;
  const rows = [
    ['Regime (cheaper for you)', c.better === 'old' ? 'Old regime' : 'New regime'],
    ['Income from salary', r.heads.salary], ['Income from house property', r.heads.houseProperty], ['Profits from business / profession', r.heads.business], ['Income from other sources', r.heads.other],
    ['Short-term capital gains (equity, 111A)', r.special.stcg], ['Long-term capital gains (equity, 112A)', r.special.ltcg],
    ...r.exemptions.map((e) => [e.label, -e.amount]), ...r.deductions.map((d) => [d.label, -d.amount]),
    ['Total income (normal-rate part)', r.taxable], ['Tax on normal income', r.slabTax], ['Rebate 87A / relief', -r.rebate], ['Tax on capital gains', r.special.tax], ['Surcharge', r.surcharge], ['Health & education cess', r.cess], ['Total tax liability', r.total],
    ['TDS / advance tax paid', -c.paid], [r.total - c.paid > 0 ? 'Tax payable' : 'Refund due', Math.abs(r.total - c.paid)],
  ];
  return rows.filter(([, v]) => v !== 0 && v !== '' && v != null);
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
