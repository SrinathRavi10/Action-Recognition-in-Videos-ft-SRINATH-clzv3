// Small shared helpers: formatting, dates, hashing, escaping.

const INR0 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const INR2 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const fmt = (n) => INR0.format(Math.round(n || 0));
export const fmt2 = (n) => INR2.format(n || 0);

export function compact(n) {
  const a = Math.abs(n);
  const s = n < 0 ? '-' : '';
  if (a >= 1e7) return s + '₹' + +(a / 1e7).toFixed(2) + 'Cr';
  if (a >= 1e5) return s + '₹' + +(a / 1e5).toFixed(2) + 'L';
  if (a >= 1e3) return s + '₹' + +(a / 1e3).toFixed(1) + 'k';
  return s + '₹' + Math.round(a);
}

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Parse an amount string such as "1,23,456.78", "(500.00)", "₹ 1,200.00 Dr". Returns a non-negative number or null. */
export function parseAmount(str) {
  if (str == null) return null;
  const s = String(str).replace(/[₹]|rs\.?|inr/gi, '').trim();
  const m = s.match(/^\(?\s*-?\s*(\d[\d,]*(?:\.\d+)?|\.\d+)\s*\)?\s*(?:dr|cr)?\.?$/i);
  if (!m) return null;
  const v = parseFloat(m[1].replace(/,/g, ''));
  return Number.isFinite(v) ? v : null;
}

/** Two 32-bit FNV-1a hashes concatenated – plenty for de-duplicating transactions. */
export function hash(str) {
  let h1 = 0x811c9dc5, h2 = 0x01000193 ^ 0x9e3779b9;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x85ebca6b) >>> 0;
    h2 = (h2 ^ (h2 >>> 13)) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

const pad = (n) => String(n).padStart(2, '0');
export const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const fromISO = (s) => new Date(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
export const monthKey = (iso) => iso.slice(0, 7);
const MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const monthName = (mk) => MN[+mk.slice(5, 7) - 1];
export const monthLabel = (mk) => `${monthName(mk)} ${mk.slice(0, 4)}`;
export const shortDate = (iso) => `${+iso.slice(8, 10)} ${MN[+iso.slice(5, 7) - 1]}`;
export const longDate = (iso) => `${+iso.slice(8, 10)} ${MN[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}`;

export function daysBetween(a, b) {
  return Math.round((fromISO(b) - fromISO(a)) / 86400000);
}

export function addDays(iso, n) {
  const d = fromISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

/** Add n months, clamping the day (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(iso, n) {
  const d = fromISO(iso);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return toISO(d);
}

/** Indian financial year start-year for an ISO date (Apr–Mar). */
export const fyStart = (iso) => (+iso.slice(5, 7) >= 4 ? +iso.slice(0, 4) : +iso.slice(0, 4) - 1);
export const fyLabel = (start) => `${start}-${String((start + 1) % 100).padStart(2, '0')}`;

export const sum = (arr, f = (x) => x) => arr.reduce((a, x) => a + f(x), 0);
export const median = (arr) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function titleCase(s) {
  return s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

/** Deterministic PRNG (mulberry32) so demo data is reproducible. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
