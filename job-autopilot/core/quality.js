// Posting-quality checks: salary, duplicates across sites, stale/ghost listings.
import { norm } from './util.js';

const CR = 1e7, LAKH = 1e5;
const toInr = (n, unit) => {
  const u = String(unit || '').toLowerCase();
  if (/^(cr|crore)/.test(u)) return n * CR;
  if (/^(l|lac|lakh|lpa)/.test(u)) return n * LAKH;
  if (/^(k)/.test(u)) return n * 1000;
  return n;
};

/** "8 LPA", "₹8,00,000", "INR 8-12 LPA", "800000" → annual INR number (or null). */
export function parseMoneyInr(text) {
  const t = String(text || '').toLowerCase().replace(/,/g, '');
  const m = t.match(/(\d+(?:\.\d+)?)\s*(cr|crore|lpa|lakhs?|lacs?|l\b|k\b)?/);
  if (!m) return null;
  let n = +m[1];
  if (m[2]) return toInr(n, m[2]);
  if (n < 1000) return n * LAKH;     // "8" → 8 lakh
  return n;
}

/** Salary range stated in a posting (annual INR), or null. Understands INR/₹ lakh forms and monthly figures. */
export function salaryInfo(text) {
  const t = String(text || '').replace(/,/g, '').replace(/ /g, ' ');
  const re = /(?:₹|rs\.?|inr)?\s*(\d+(?:\.\d+)?)\s*(lpa|lakhs?|lacs?|l|cr|crores?|k)?\s*(?:-|–|—|to)\s*(?:₹|rs\.?|inr)?\s*(\d+(?:\.\d+)?)\s*(lpa|lakhs?|lacs?|cr|crores?|k)?\s*(lpa|lakhs?|lacs?|per annum|p\.?a\.?|per month|\/month|a month|monthly|\/yr|per year)?/gi;
  let m;
  while ((m = re.exec(t))) {
    const ctx = t.slice(Math.max(0, m.index - 50), m.index + m[0].length + 30).toLowerCase();
    const unit = (m[4] || m[2] || m[5] || '').toLowerCase();
    if (!/(salary|compensation|ctc|pay|lpa|lakh|lac|inr|₹|rs\b|stipend|package)/.test(ctx + unit)) continue;
    let lo = +m[1], hi = +m[3];
    if (!unit && !/(₹|inr|rs)/.test(ctx)) continue;
    const u = unit || 'abs';
    lo = toInr(lo, m[2] || u); hi = toInr(hi, m[4] || u);
    if (/month/.test(`${m[5] || ''}${ctx}`) && hi < 5e5) { lo *= 12; hi *= 12; }
    if (lo > hi) [lo, hi] = [hi, lo];
    if (hi < 1e5 || hi > 2e8) continue;
    return { min: lo, max: hi, raw: m[0].trim() };
  }
  const one = t.match(/(?:ctc|salary|compensation|package)[^0-9₹]{0,25}(?:₹|rs\.?|inr)?\s*(\d+(?:\.\d+)?)\s*(lpa|lakhs?|lacs?|cr|crores?)/i);
  if (one) { const v = toInr(+one[1], one[2]); return { min: v, max: v, raw: one[0].trim() }; }
  return null;
}

export const fmtLpa = (inr) => `${(inr / LAKH).toFixed(inr % LAKH === 0 ? 0 : 1)} LPA`;

/** How a posting's pay compares with what the user expects. */
export function compareSalary(job, expectedCtc) {
  const s = job.salary || salaryInfo(job.description);
  const want = parseMoneyInr(expectedCtc);
  if (!s) return { known: false };
  if (!want) return { known: true, range: s, verdict: 'unknown' };
  if (s.max < want * 0.7) return { known: true, range: s, verdict: 'below' };
  if (s.max >= want) return { known: true, range: s, verdict: 'meets' };
  return { known: true, range: s, verdict: 'close' };
}

/** Same job listed on several sites: identical company + title + first location. */
export const dupKey = (j) => `${norm(j.company)}|${norm(j.title).replace(/\b(m\/f|f\/m|remote|hybrid)\b/g, '').trim()}|${norm(String(j.location || '').split(/[,|;/]/)[0])}`;

/** Prefer a listing we can auto-apply to, then the oldest one. */
export function pickWinner(a, b, supported) {
  const sa = supported.includes(a.ats), sb = supported.includes(b.ats);
  if (sa !== sb) return sa ? a : b;
  return String(a.firstSeen || '') <= String(b.firstSeen || '') ? a : b;
}

export const ageDays = (job) => (job.postedAt ? (Date.now() - new Date(job.postedAt).getTime()) / 864e5 : null);
