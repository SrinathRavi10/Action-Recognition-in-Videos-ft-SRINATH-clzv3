// Detects recurring payments (OTT, mobile plans, SIPs, insurance, EMIs, rent...) from transaction history,
// flags price hikes and upcoming renewals.
import { merchantKey, displayMerchant } from './categorize.js';
import { addDays, addMonths, daysBetween, median, toISO } from './util.js';

const CADENCES = [
  { name: 'weekly', days: 7, tol: 1, months: 0, perYear: 52 },
  { name: 'fortnightly', days: 14, tol: 2, months: 0, perYear: 26 },
  { name: 'monthly', days: 30, tol: 4, months: 1, perYear: 12 },
  { name: 'bi-monthly', days: 61, tol: 5, months: 2, perYear: 6 },
  { name: 'quarterly', days: 91, tol: 7, months: 3, perYear: 4 },
  { name: 'half-yearly', days: 182, tol: 10, months: 6, perYear: 2 },
  { name: 'yearly', days: 365, tol: 15, months: 12, perYear: 1 },
];

const KIND_RULES = [
  ['OTT & apps', /NETFLIX|HOTSTAR|DISNEY|PRIME|SPOTIFY|YOUTUBE|ZEE5|SONY ?LIV|JIO ?CINEMA|GAANA|WYNK|AUDIBLE|KINDLE|GOOGLE|APPLE|ICLOUD|CHATGPT|OPENAI|CLAUDE|NOTION|ADOBE|MICROSOFT|DROPBOX|LINKEDIN|CANVA|GITHUB|CULT ?FIT/],
  ['Mobile & broadband', /AIRTEL|JIO|VODAFONE|\bVI\b|BSNL|ACT FIBERNET|HATHWAY|TATA PLAY|DISH|BROADBAND|RECHARGE/],
  ['SIP & investments', /SIP|MUTUAL|ZERODHA|GROWW|KUVERA|ICCL|CLEARING|NPS|PPF|COIN|SMALLCASE|BSE STAR|MF /],
  ['Insurance', /LIC|INSURANCE|LIFE|HEALTH|ACKO|POLICYBAZAAR|ALLIANZ|PRU|NIVA/],
  ['EMI & loans', /EMI|LOAN|BAJAJ|FINSERV|KREDITBEE/],
  ['Rent & society', /RENT|SOCIETY|MAINTENANCE|APARTMENT|LANDLORD/],
  ['Utilities', /ELECTRIC|BESCOM|POWER|WATER|GAS|BSES|MSEDCL/],
];
const CAT_KIND = {
  Subscriptions: 'OTT & apps', 'Mobile & Internet': 'Mobile & broadband', Investments: 'SIP & investments', Insurance: 'Insurance',
  'EMI & Loans': 'EMI & loans', 'Rent & Housing': 'Rent & society', 'Bills & Utilities': 'Utilities',
};
/** Kinds where the amount legitimately varies month to month. */
const VARIABLE_OK = new Set(['Utilities', 'Mobile & broadband']);

export function kindOf(key, category) {
  if (CAT_KIND[category]) return CAT_KIND[category];
  for (const [k, re] of KIND_RULES) if (re.test(key)) return k;
  return 'Other recurring';
}

function matchCadence(gaps) {
  const med = median(gaps);
  let best = null;
  for (const c of CADENCES) {
    if (Math.abs(med - c.days) > c.tol) continue;
    const fit = gaps.filter((g) => Math.abs(g - c.days) <= c.tol + Math.ceil(c.days * 0.05)).length / gaps.length;
    if (fit >= 0.6 && (!best || fit > best.fit)) best = { ...c, fit };
  }
  return best;
}

function nextDue(lastDate, c) {
  return c.months ? addMonths(lastDate, c.months) : addDays(lastDate, c.days);
}

/**
 * @param txns   all transactions ({date, amount, type, desc, category, merchant?})
 * @param opts   { today: 'YYYY-MM-DD', overrides: { [key]: 'ignored' | 'cancelled' } }
 */
export function detectRecurring(txns, { today = toISO(new Date()), overrides = {} } = {}) {
  const groups = new Map();
  for (const t of txns) {
    if (t.type !== 'debit') continue;
    if (t.category === 'Cash Withdrawal' || t.category === 'Transfers' || t.category === 'Credit Card Bill') continue;
    const key = t.merchant || merchantKey(t.desc);
    if (!key || key === 'UNKNOWN') continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }

  const out = [];
  for (const [key, list] of groups) {
    list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    // Collapse same-day duplicates of the same amount (statements imported twice, split payments).
    const uniq = [];
    for (const t of list) {
      const prev = uniq.at(-1);
      if (prev && prev.date === t.date && Math.abs(prev.amount - t.amount) < 0.01) continue;
      uniq.push(t);
    }
    if (uniq.length < 2) continue;
    const category = uniq.at(-1).category;
    const kind = kindOf(key, category);
    const gaps = [];
    for (let i = 1; i < uniq.length; i++) gaps.push(daysBetween(uniq[i - 1].date, uniq[i].date));
    const cad = matchCadence(gaps);
    if (!cad) continue;

    const amounts = uniq.map((t) => t.amount);
    const med = median(amounts);
    const spread = amounts.filter((a) => Math.abs(a - med) / med <= 0.02).length / amounts.length;
    const lastAmt = amounts.at(-1);
    // Price-step detection: stable at one amount, then a new stable amount.
    const priorStable = amounts.length >= 3 ? median(amounts.slice(0, -1)) : amounts[0];
    const stepUp = lastAmt > priorStable * 1.03 && amounts.slice(0, -1).filter((a) => Math.abs(a - priorStable) / priorStable <= 0.02).length >= Math.max(1, amounts.length - 2);

    const variableOk = VARIABLE_OK.has(kind);
    const stable = spread >= 0.6 || amounts.slice(-3).every((a) => Math.abs(a - lastAmt) / lastAmt <= 0.03) || stepUp;
    // Few occurrences need stronger evidence; irregular-amount merchants (groceries, food apps) are not subscriptions.
    const minOcc = cad.perYear <= 2 ? 2 : kind === 'Other recurring' ? 3 : 2;
    if (uniq.length < minOcc) continue;
    if (!stable && !variableOk) continue;
    if (kind === 'Other recurring' && uniq.length < 3 && cad.perYear > 2) continue;
    if (!variableOk && !stable) continue;

    const last = uniq.at(-1);
    const due = nextDue(last.date, cad);
    const daysToDue = daysBetween(today, due);
    const sinceLast = daysBetween(last.date, today);
    let status = 'active';
    if (overrides[key] === 'cancelled') status = 'cancelled';
    else if (sinceLast > cad.days * 2 + cad.tol) status = 'lapsed';
    else if (daysToDue < -Math.max(cad.tol, 5)) status = 'overdue';
    else if (daysToDue <= (cad.perYear <= 2 ? 30 : 7)) status = 'due-soon';

    // Find the most recent change in price, for the alert text.
    let hike = null;
    for (let i = amounts.length - 1; i >= 1; i--) {
      const ratio = amounts[i] / amounts[i - 1];
      if (ratio > 1.03 && !variableOk) { hike = { from: amounts[i - 1], to: amounts[i], pct: (ratio - 1) * 100, date: uniq[i].date }; break; }
      if (Math.abs(ratio - 1) <= 0.03) continue;
      if (ratio < 0.97) break;
    }
    // Only surface hikes from the last ~2 billing cycles worth of history.
    if (hike && daysBetween(hike.date, today) > cad.days * 3 + 10) hike = { ...hike, old: true };

    const typical = variableOk ? median(amounts.slice(-3)) : lastAmt;
    out.push({
      key, name: displayMerchant(key), kind, category, cadence: cad.name, cadenceDays: cad.days,
      amount: typical, lastAmount: lastAmt, variable: variableOk && spread < 0.6, count: uniq.length,
      firstDate: uniq[0].date, lastDate: last.date, nextDue: due, daysToDue, status,
      monthlyCost: (typical * cad.perYear) / 12, yearlyCost: typical * cad.perYear,
      hike, history: uniq.map((t) => ({ date: t.date, amount: t.amount })),
      confidence: Math.min(1, 0.4 + 0.15 * uniq.length) * (0.7 + 0.3 * cad.fit),
    });
  }
  out.sort((a, b) => b.monthlyCost - a.monthlyCost);
  return out;
}

/** Turn detected items into user-facing alerts, most urgent first. */
export function buildAlerts(items) {
  const alerts = [];
  for (const r of items) {
    if (r.status === 'cancelled' || r.status === 'lapsed') continue;
    if (r.hike && !r.hike.old) {
      alerts.push({ level: 'warn', type: 'hike', key: r.key, title: `${r.name} price went up ${r.hike.pct.toFixed(0)}%`, detail: `₹${r.hike.from.toLocaleString('en-IN')} → ₹${r.hike.to.toLocaleString('en-IN')} on ${r.hike.date}. That is ₹${Math.round((r.hike.to - r.hike.from) * (r.yearlyCost / r.amount)).toLocaleString('en-IN')} more per year.` });
    }
    if (r.status === 'due-soon') {
      const d = r.daysToDue;
      alerts.push({ level: r.cadenceDays >= 90 ? 'warn' : 'info', type: 'renewal', key: r.key, title: `${r.name} ${r.cadenceDays >= 90 ? 'renews' : 'is due'} ${d <= 0 ? 'today' : d === 1 ? 'tomorrow' : `in ${d} days`}`, detail: `Expected ≈ ₹${Math.round(r.amount).toLocaleString('en-IN')} on ${r.nextDue} (${r.cadence}).` });
    } else if (r.status === 'overdue') {
      alerts.push({ level: 'info', type: 'overdue', key: r.key, title: `${r.name} hasn't been charged yet`, detail: `Expected around ${r.nextDue}. It may have been paid elsewhere, failed, or cancelled.` });
    }
  }
  const rank = { warn: 0, info: 1 };
  alerts.sort((a, b) => rank[a.level] - rank[b.level]);
  return alerts;
}
