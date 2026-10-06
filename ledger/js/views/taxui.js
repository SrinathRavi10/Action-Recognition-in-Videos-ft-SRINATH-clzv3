import { state, addDoc } from '../store.js';
import { compare, TAX_YEARS, extractForm16, extractInterest, advanceTaxPlan, itrSummary, businessIncome } from '../tax.js';
import { icon } from '../icons.js';
import { readPdf, pagesToText, PasswordCancelled } from '../pdfio.js';
import { askPassword, toast, chip } from '../ui.js';
import { esc, fmt, fmt2, monthLabel, longDate, toISO } from '../util.js';

const FIELDS = [
  ['Salary', [
    ['grossSalary', 'Gross salary (year)', 'From Form 16 / payslips, before any deduction'],
    ['basicSalary', 'Basic salary + DA (year)', 'Needed for HRA and employer-NPS limits'],
    ['hraReceived', 'HRA received (year)', ''],
    ['rentPaid', 'Rent paid (year)', 'Old regime only'],
    ['employerNPS', 'Employer NPS contribution', 'Allowed in both regimes'],
  ]],
  ['Other income', [
    ['savingsInterest', 'Savings-account interest', ''],
    ['fdInterest', 'FD / bond interest', ''],
    ['otherIncome', 'Other taxable income', 'Freelance, rental, etc.'],
  ]],
  ['Capital gains (listed equity & equity mutual funds)', [
    ['stcgEquity', 'Short-term gains (held ≤ 12 months)', 'Taxed at 20%'],
    ['ltcgEquity', 'Long-term gains (held > 12 months)', '12.5% on gains above ₹1,25,000'],
  ]],
  ['House property (let out) & business', [
    ['rentalIncome', 'Rent received from let-out property (year)', ''],
    ['municipalTax', 'Municipal taxes paid', ''],
    ['letOutInterest', 'Home-loan interest on the let-out property', 'No cap; loss set-off limited to ₹2L (old regime only)'],
    ['businessReceipts', 'Business / professional receipts (year)', 'Used with the scheme below'],
  ]],
  ['Deductions (old regime)', [
    ['sec80C', '80C: EPF, PPF, ELSS, LIC, tuition…', 'Max ₹1,50,000'],
    ['nps80CCD1B', 'NPS 80CCD(1B)', 'Max ₹50,000'],
    ['health80DSelf', 'Health insurance – self & family (80D)', 'Max ₹25,000 (₹50,000 if 60+)'],
    ['health80DParents', 'Health insurance – parents (80D)', 'Max ₹25,000 (₹50,000 if senior)'],
    ['homeLoanInterest', 'Home-loan interest, self-occupied', 'Max ₹2,00,000'],
    ['eduLoanInterest', 'Education-loan interest (80E)', ''],
    ['donations80G', 'Donations eligible under 80G', 'Eligible amount only'],
  ]],
  ['Taxes already paid', [
    ['tdsDeducted', 'TDS deducted by employer / banks', 'See Form 16 / Form 26AS'],
    ['advanceTax', 'Advance / self-assessment tax paid', ''],
  ]],
];

export function fyRange(fy) {
  const y = +fy.slice(0, 4);
  return [`${y}-04-01`, `${y + 1}-03-31`];
}

/** Figures worth suggesting, pulled from imported statements for the selected FY. */
export function suggestions(fy) {
  const [a, b] = fyRange(fy);
  const t = state.txns.filter((x) => x.date >= a && x.date <= b);
  const sumOf = (f) => Math.round(t.filter(f).reduce((s, x) => s + x.amount, 0));
  const out = [];
  const interest = sumOf((x) => x.type === 'credit' && x.category === 'Interest');
  if (interest) out.push({ key: 'savingsInterest', label: 'Savings interest credited', amount: interest });
  const rent = sumOf((x) => x.type === 'debit' && x.category === 'Rent & Housing' && /RENT|LANDLORD/i.test(x.desc));
  const rentRecords = state.rent.filter((r) => r.month >= a.slice(0, 7) && r.month <= b.slice(0, 7)).reduce((s, r) => s + r.amount, 0);
  if (rentRecords) out.push({ key: 'rentPaid', label: 'Rent from your receipts', amount: rentRecords });
  else if (rent) out.push({ key: 'rentPaid', label: 'Rent paid (from statements)', amount: rent });
  const c80 = sumOf((x) => x.type === 'debit' && /\b(LIC|PPF|ELSS|SUKANYA|NSC|TUITION|EPF)\b/i.test(x.desc));
  if (c80) out.push({ key: 'sec80C', label: 'Possible 80C payments (LIC / PPF / ELSS…)', amount: c80 });
  const nps = sumOf((x) => x.type === 'debit' && /\bNPS\b/i.test(x.desc));
  if (nps) out.push({ key: 'nps80CCD1B', label: 'NPS contributions', amount: nps });
  const health = sumOf((x) => x.type === 'debit' && x.category === 'Insurance' && /HEALTH|MEDICLAIM|NIVA|CARE|ACKO/i.test(x.desc));
  if (health) out.push({ key: 'health80DSelf', label: 'Health insurance premiums', amount: health });
  return out;
}

const num = (v) => (v ? String(v) : '');

function form(p) {
  const biz = `<label class="field"><span>Presumptive scheme</span><select data-change="tax-biz"><option value="none" ${!p.businessType || p.businessType === 'none' ? 'selected' : ''}>None</option><option value="44ADA" ${p.businessType === '44ADA' ? 'selected' : ''}>44ADA – professionals (50% of receipts)</option><option value="44AD" ${p.businessType === '44AD' ? 'selected' : ''}>44AD – business (6% digital / 8% other)</option></select></label>
    <label class="check" style="align-self:end;padding-bottom:8px"><input type="checkbox" data-change="tax-flag" data-k="businessDigital" ${p.businessDigital ? 'checked' : ''}> Receipts mostly digital (44AD)</label>`;
  return FIELDS.map(([title, fs]) => `<fieldset><legend>${title}</legend><div class="fields">${fs.map(([k, label, hint]) => `
    <label class="field"><span>${label}</span><input class="input" inputmode="numeric" data-input="tax-field" data-k="${k}" value="${num(p[k])}" placeholder="0" aria-describedby="h-${k}">${hint ? `<small id="h-${k}">${hint}</small>` : ''}</label>`).join('')}${title.startsWith('House property') ? biz : ''}</div></fieldset>`).join('');
}

function regimeCard(r, best, balance) {
  const rows = [
    ['Gross income', r.grossIncome],
    ...r.exemptions.map((e) => [`− ${e.label}`, e.amount]),
    ...r.deductions.map((d) => [`− ${d.label}`, d.amount]),
  ];
  return `<div class="card regime ${best ? 'best' : ''}">
    <div class="card-head"><h3>${r.regime === 'new' ? 'New regime' : 'Old regime'}</h3>${best ? `<span class="chip good">${icon('check', 13)} Lower tax</span>` : ''}</div>
    <div class="big tnum">${fmt(r.total)}</div>
    <div class="muted small">${r.totalIncome ? `${((r.total / r.totalIncome) * 100).toFixed(1)}% of income · ${fmt(r.total / 12)} per month` : ''}</div>
    <table class="mini-table" style="margin-top:10px"><tbody>
      ${rows.map(([l, v]) => `<tr><td>${esc(l)}</td><td class="num">${fmt(v)}</td></tr>`).join('')}
      <tr class="strong"><td>Taxable income (slab rates)</td><td class="num">${fmt(r.taxable)}</td></tr>
      <tr><td>Tax on slabs</td><td class="num">${fmt(r.slabTax)}</td></tr>
      ${r.rebate ? `<tr><td>− Rebate 87A${r.regime === 'new' ? ' / marginal relief' : ''}</td><td class="num">${fmt(r.rebate)}</td></tr>` : ''}
      ${r.special.tax ? `<tr><td>+ Capital-gains tax (20% / 12.5%)</td><td class="num">${fmt(r.special.tax)}</td></tr>` : ''}
      ${r.surcharge ? `<tr><td>+ Surcharge</td><td class="num">${fmt(r.surcharge)}</td></tr>` : ''}
      <tr><td>+ Cess 4%</td><td class="num">${fmt(r.cess)}</td></tr>
      <tr class="strong"><td>Total tax</td><td class="num">${fmt(r.total)}</td></tr>
      ${balance != null ? `<tr class="${balance > 0 ? 'neg' : 'pos'}"><td>${balance > 0 ? 'Still to pay' : 'Refund due'}</td><td class="num">${fmt(Math.abs(balance))}</td></tr>` : ''}</tbody></table>
    <details><summary>Slab-wise tax</summary><table class="mini-table"><tbody>${r.slabRows.map((s) => `<tr><td>${fmt(s.from)} – ${s.to === Infinity ? 'above' : fmt(s.to)} @ ${(s.rate * 100).toFixed(0)}%</td><td class="num">${fmt(s.tax)}</td></tr>`).join('')}</tbody></table></details></div>`;
}

export function computeFor() {
  const p = state.settings.taxProfile;
  return compare(p, state.settings.taxYear);
}

export function itrText() {
  const c = computeFor();
  return itrSummary(c, state.settings.taxProfile).map(([l, v]) => `${l}: ${typeof v === 'number' ? Math.round(v).toLocaleString('en-IN') : v}`).join('\n');
}

export function resultHtml() {
  const p = state.settings.taxProfile;
  const fy = state.settings.taxYear;
  if (!+p.grossSalary && !+p.otherIncome && !businessIncome(p) && !+p.stcgEquity && !+p.ltcgEquity && !+p.rentalIncome) return `<section class="card">${emptyHint()}</section>`;
  const c = compare(p, fy);
  const hasPaid = c.paid > 0;
  let verdict;
  if (!c.saving) verdict = 'Both regimes give the same tax.';
  else verdict = `<b>${c.better === 'new' ? 'New' : 'Old'} regime</b> looks cheaper for you by <b>${fmt(c.saving)}</b> a year.`;
  let tip = '';
  if (c.better === 'new' && c.extraDeductionsNeeded) tip = `<p>The old regime would only win if your total old-regime deductions and exemptions reached about <b>${fmt(c.totalClaimedOld + c.extraDeductionsNeeded)}</b> (you have ${fmt(c.totalClaimedOld)} now).</p>`;
  if (c.better === 'new' && c.extraDeductionsNeeded === null) tip = '<p>No realistic level of deductions makes the old regime cheaper at this income.</p>';
  const best = c.better === 'old' ? c.old : c.new;
  const today = toISO(new Date());
  const adv = advanceTaxPlan(best.total, c.paid, { year: fy, presumptive: !!p.businessType && p.businessType !== 'none', today });
  const ideas = c.better === 'old' || c.saving < 40000 ? c.ideas : [];
  const itr = itrSummary(c, p);
  return `
    <section class="card verdict"><h2>${icon('rupee', 20)} ${verdict}</h2>${tip}${c.note ? `<p class="warn-line">${icon('alert', 16)}<span>${esc(c.note)}</span></p>` : ''}</section>
    <div class="grid2">${regimeCard(c.new, c.better === 'new' && c.saving, hasPaid ? c.newBalance : null)}${regimeCard(c.old, c.better === 'old' && c.saving, hasPaid ? c.oldBalance : null)}</div>
    ${adv.required ? `<section class="card"><div class="card-head"><h2>${icon('calendar', 18)} Advance-tax calendar</h2><span class="muted small">on ${fmt(adv.net)} net liability</span></div>
      <div class="table-wrap"><table class="tx small"><thead><tr><th>Due date</th><th class="num">Cumulative</th><th class="num">Pay now</th><th></th></tr></thead><tbody>${adv.items.map((i) => `<tr class="${i.past ? 'dim' : ''}"><td>${longDate(i.due)}</td><td class="num">${fmt(i.cumulative)} <span class="faint">(${(i.pct * 100).toFixed(0)}%)</span></td><td class="num">${fmt(i.instalment)}</td><td>${i.past ? '<span class="chip">Passed</span>' : '<span class="chip info">Upcoming</span>'}</td></tr>`).join('')}</tbody></table></div>
      <p class="muted xs">Salaried taxpayers whose employer deducts enough TDS usually owe nothing here. Interest u/s 234B/C applies if instalments are missed.</p></section>` : ''}
    ${ideas.length ? `<section class="card"><div class="card-head"><h2>${icon('sparkle', 18)} Before 31 March – ways to cut tax (old regime)</h2></div><ul class="plainlist">${ideas.map((i) => `<li><span><b>${esc(i.label)}</b><div class="muted xs">up to ${fmt(i.amount)} more</div></span><span class="pos strong tnum">saves ≈ ${fmt(i.saves)}</span></li>`).join('')}</ul><p class="muted xs">Estimates at your marginal slab rate. Only worth it if the old regime suits you.</p></section>` : ''}
    <section class="card"><div class="card-head"><h2>${icon('report', 18)} Summary for the ITR form</h2><button class="btn small" data-action="itr-copy">${icon('file', 14)} Copy</button></div>
      <table class="mini-table"><tbody>${itr.map(([l, v]) => `<tr><td>${esc(l)}</td><td class="num">${typeof v === 'number' ? fmt(v) : esc(v)}</td></tr>`).join('')}</tbody></table>
      <p class="muted xs">A cross-check against what the e-filing portal pre-fills from Form 26AS / AIS – not a substitute for it.</p></section>`;
}

const emptyHint = () => `<div class="empty">${icon('rupee', 34)}<b>Enter your income to compare regimes</b><span>Start with gross salary, or import a Form 16 under Documents.</span></div>`;

function estimateTab() {
  const p = state.settings.taxProfile;
  const fy = state.settings.taxYear;
  const sug = suggestions(fy).filter((s) => +p[s.key] !== s.amount);
  return `
  <section class="card">
    <div class="row gap wrap">
      <label class="field"><span>Financial year</span><select data-change="tax-year">${Object.entries(TAX_YEARS).map(([k, v]) => `<option value="${k}" ${k === fy ? 'selected' : ''}>${v.label}</option>`).join('')}</select></label>
      <label class="field"><span>Age</span><select data-change="tax-age"><option value="below60" ${p.age !== 'senior' && p.age !== 'super' ? 'selected' : ''}>Below 60</option><option value="senior" ${p.age === 'senior' ? 'selected' : ''}>60 – 79</option><option value="super" ${p.age === 'super' ? 'selected' : ''}>80 or above</option></select></label>
      <label class="check"><input type="checkbox" data-change="tax-flag" data-k="metro" ${p.metro ? 'checked' : ''}> Live in a metro (Delhi, Mumbai, Kolkata, Chennai)</label>
      <label class="check"><input type="checkbox" data-change="tax-flag" data-k="parentsSenior" ${p.parentsSenior ? 'checked' : ''}> Parents are 60+</label>
    </div>
    ${sug.length ? `<div class="suggest"><b>${icon('sparkle', 16)} Found in your statements for this year</b>${sug.map((s) => `<div class="row between"><span>${esc(s.label)}: <b>${fmt(s.amount)}</b></span><button class="btn small" data-action="tax-apply" data-k="${s.key}" data-v="${s.amount}">Use</button></div>`).join('')}<p class="muted small" style="margin:0">Suggestions are keyword matches – check them before using.</p></div>` : ''}
    <div id="taxForm">${form(p)}</div>
  </section>
  <div id="taxResult">${resultHtml()}</div>`;
}

function docsTab() {
  const fy = state.settings.taxYear;
  const kinds = { form16: 'Form 16', 'interest-savings': 'Savings interest certificate', 'interest-fd': 'FD / bond interest certificate', rent: 'Rent receipt', other: 'Other (80C proof, 80D receipt…)' };
  return `
  <section class="card">
    <div class="row gap wrap"><label class="field"><span>Document type</span><select id="docKind">${Object.entries(kinds).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label></div>
    <label class="drop small" id="docdrop" tabindex="0"><input type="file" id="docfile" accept=".pdf,image/*" multiple hidden><b>Add documents</b><span class="muted">PDF or photo · stored only on this device, never uploaded</span></label>
  </section>
  <section class="card flush"><div class="table-wrap"><table class="tx"><thead><tr><th>Document</th><th>Type</th><th>Detected</th><th></th></tr></thead><tbody>
    ${state.docs.map((d) => {
      const e = d.extracted || {};
      const found = Object.entries(e).filter(([k]) => k !== 'pan').map(([k, v]) => `${k.replace(/([A-Z])/g, ' $1').toLowerCase()}: <b>${fmt2(v)}</b>`).join('<br>');
      return `<tr><td><div class="desc clip">${esc(d.name)}</div><div class="muted small">${(d.size / 1024).toFixed(0)} KB · ${new Date(d.added).toLocaleDateString('en-IN')}</div></td><td>${chip(kinds[d.kind] || d.kind)}</td>
        <td class="small">${found || '<span class="muted">Nothing read – enter figures manually</span>'}${e.pan ? `<div class="muted">PAN ${esc(e.pan)}</div>` : ''}</td>
        <td class="acts nowrap">${found ? `<button class="btn small" data-action="doc-apply" data-id="${d.id}">Use in estimate</button>` : ''}<button class="icon" data-action="doc-open" data-id="${d.id}" title="Open" aria-label="Open">↗</button><button class="icon" data-action="doc-del" data-id="${d.id}" title="Delete" aria-label="Delete">✕</button></td></tr>`;
    }).join('') || '<tr><td colspan="4" class="muted center pad">No documents yet.</td></tr>'}</tbody></table></div></section>
  <p class="muted small">Values are read from the PDF text with simple pattern matching and can be wrong. Always confirm them against the original before using them.</p>`;
}

function rentTab() {
  const fy = state.settings.taxYear;
  const [a, b] = fyRange(fy);
  const list = state.rent.filter((r) => r.month >= a.slice(0, 7) && r.month <= b.slice(0, 7)).sort((x, y) => (x.month < y.month ? -1 : 1));
  const total = list.reduce((s, r) => s + r.amount, 0);
  const noPan = total > 100000 && list.some((r) => !/^[A-Z]{5}\d{4}[A-Z]$/.test(r.pan || ''));
  const last = list.at(-1) || {};
  return `
  <section class="card">
    <h2>Rent receipts for FY ${fy}</h2>
    <div class="fields" style="margin-bottom:14px"><label class="field"><span>Your name (tenant)</span><input class="input" data-input="tax-text" data-k="tenantName" value="${esc(state.settings.taxProfile.tenantName || '')}"></label>
      <label class="field"><span>Rented property address</span><input class="input" data-input="tax-text" data-k="propertyAddress" value="${esc(state.settings.taxProfile.propertyAddress || '')}"></label></div>
    <form class="fields" data-submit="rent-add">
      <label class="field"><span>Month</span><input class="input" type="month" name="month" required min="${a.slice(0, 7)}" max="${b.slice(0, 7)}" value="${a.slice(0, 7)}"></label>
      <label class="field"><span>Rent (₹)</span><input class="input" name="amount" inputmode="numeric" required value="${last.amount || ''}"></label>
      <label class="field"><span>Landlord name</span><input class="input" name="landlord" required value="${esc(last.landlord || '')}"></label>
      <label class="field"><span>Landlord PAN</span><input class="input" name="pan" maxlength="10" placeholder="ABCDE1234F" value="${esc(last.pan || '')}" style="text-transform:uppercase"></label>
      <div class="row gap end wrap"><button class="btn primary">Add receipt</button><button type="button" class="btn" data-action="rent-fill">Fill all 12 months</button>${list.length ? `<button type="button" class="btn" data-action="rent-print">${icon('print', 16)} Print receipts</button>` : ''}</div>
    </form>
    ${noPan ? '<p class="warn-line">⚠ Annual rent above ₹1,00,000: your employer will ask for the landlord’s PAN for HRA exemption.</p>' : ''}
  </section>
  <section class="card flush"><div class="table-wrap"><table class="tx"><thead><tr><th>Month</th><th>Landlord</th><th>PAN</th><th class="num">Rent</th><th></th></tr></thead><tbody>
    ${list.map((r) => `<tr><td>${monthLabel(r.month)}</td><td>${esc(r.landlord)}</td><td>${esc(r.pan || '–')}</td><td class="num">${fmt(r.amount)}</td><td class="acts"><button class="icon" data-action="rent-del" data-id="${r.id}" aria-label="Delete receipt">✕</button></td></tr>`).join('') || '<tr><td colspan="5" class="muted center pad">No receipts for this year.</td></tr>'}
    ${list.length ? `<tr class="strong"><td colspan="3">Total (${list.length} month${list.length === 1 ? '' : 's'})</td><td class="num">${fmt(total)}</td><td></td></tr>` : ''}</tbody></table></div></section>`;
}

export function tax() {
  const tab = state.ui.taxTab;
  const tabs = [['estimate', 'Old vs new regime', 'rupee'], ['docs', 'Documents', 'file'], ['rent', 'Rent receipts', 'receipt']];
  return `
  <div class="page-head"><div><h1>Tax helper</h1><p>Old vs new regime, capital gains, advance tax and your documents.</p></div></div>
  <div class="banner">${icon('info', 18)}<div>This is an <b>estimate</b> for a salaried individual using published slabs. It is not tax or filing advice – check with a qualified professional or the Income Tax portal before you file.</div></div>
  <nav class="tabs" role="tablist">${tabs.map(([k, l, ic]) => `<button role="tab" aria-selected="${tab === k}" class="${tab === k ? 'on' : ''}" data-action="tax-tab" data-tab="${k}">${icon(ic, 16)}${l}</button>`).join('')}</nav>
  ${tab === 'docs' ? docsTab() : tab === 'rent' ? rentTab() : estimateTab()}`;
}

/** Read and store tax documents; PDFs are mined for figures. */
export async function uploadDocs(files, kind, rerender) {
  for (const file of files) {
    let extracted = {};
    try {
      if (/pdf$/i.test(file.type) || /\.pdf$/i.test(file.name)) {
        if (kind === 'form16' || kind.startsWith('interest')) {
          const pdf = await readPdf(file, askPassword);
          const text = pagesToText(pdf.pages);
          if (kind === 'form16') extracted = extractForm16(text);
          else { const v = extractInterest(text); if (v) extracted = { [kind === 'interest-fd' ? 'fdInterest' : 'savingsInterest']: v }; }
        }
      }
    } catch (e) {
      if (!(e instanceof PasswordCancelled)) toast(`Stored ${file.name}, but could not read its text.`);
    }
    await addDoc(file, kind, state.settings.taxYear, extracted);
  }
  toast(`${files.length} document${files.length === 1 ? '' : 's'} added.`);
  rerender();
}


/** Print one rent receipt per month (uses a temporary sheet shown only when printing). */
export function printReceipts() {
  const p = state.settings.taxProfile;
  const [a, b] = fyRange(state.settings.taxYear);
  const list = state.rent.filter((r) => r.month >= a.slice(0, 7) && r.month <= b.slice(0, 7)).sort((x, y) => (x.month < y.month ? -1 : 1));
  if (!list.length) return;
  document.getElementById('receiptSheet')?.remove();
  const sheet = document.createElement('div');
  sheet.id = 'receiptSheet';
  sheet.innerHTML = list.map((r) => `<section class="rcpt"><h2>Rent Receipt</h2><p class="rn">No. ${r.month.replace('-', '')}</p>
    <p>Received a sum of <b>₹ ${r.amount.toLocaleString('en-IN')}</b> from <b>${esc(p.tenantName || '________________')}</b> towards the rent of the property at <b>${esc(p.propertyAddress || '________________________')}</b> for the month of <b>${monthLabel(r.month)}</b>.</p>
    <div class="sig"><div><b>${esc(r.landlord)}</b><br>Landlord${r.pan ? `<br>PAN: ${esc(r.pan)}` : ''}</div><div>Signature<br><br>_______________</div></div></section>`).join('');
  document.body.appendChild(sheet);
  document.documentElement.classList.add('printing-receipts');
  const done = () => { document.documentElement.classList.remove('printing-receipts'); sheet.remove(); removeEventListener('afterprint', done); };
  addEventListener('afterprint', done);
  setTimeout(() => window.print(), 50);
}
