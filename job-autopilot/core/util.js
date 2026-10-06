// Small shared helpers.
import crypto from 'node:crypto';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const jitter = (min, max) => Math.round(min + Math.random() * (max - min));
export const hash = (s) => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 16);
export const uid = () => crypto.randomUUID();
export const today = () => new Date().toISOString().slice(0, 10);

const ENT = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ', '&rsquo;': "'", '&lsquo;': "'", '&ndash;': '–', '&mdash;': '—', '&bull;': '•' };
/** HTML (possibly entity-escaped HTML, as Greenhouse returns) → readable plain text. */
export function htmlToText(html) {
  let s = String(html || '');
  // Greenhouse double-escapes its HTML: "&lt;p&gt;" → decode first
  if (/&lt;\w+/.test(s) && !/<\w+/.test(s)) s = s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  return s
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\s*(br|\/p|\/div|\/li|\/h\d|\/tr)\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, (m) => ENT[m.toLowerCase()] ?? ' ')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

export const titleCase = (s) => String(s || '').toLowerCase().replace(/(^|[\s\-'])([a-z])/g, (m, a, b) => a + b.toUpperCase());
export const slugName = (s) => String(s || '').replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
export const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9+#. ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** fetch JSON with timeout, retry on transient failures and a polite User-Agent. */
export async function getJson(url, { timeout = 20000, retries = 2, headers = {}, method = 'GET', body } = {}) {
  let last;
  for (let i = 0; i <= retries; i++) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeout);
    try {
      const res = await fetch(url, { method, body, signal: ac.signal, headers: { 'user-agent': 'JobAutopilot/1.0 (+personal job search)', accept: 'application/json', ...headers } });
      clearTimeout(t);
      if (res.status === 404) { const e = new Error('404'); e.status = 404; throw e; }
      if (res.status === 429 || res.status >= 500) { last = new Error(`HTTP ${res.status}`); last.status = res.status; await sleep(800 * (i + 1)); continue; }
      if (!res.ok) { const e = new Error(`HTTP ${res.status}`); e.status = res.status; throw e; }
      return await res.json();
    } catch (e) {
      clearTimeout(t);
      if (e.status === 404 || e.status === 403 || e.status === 401) throw e;
      last = e;
      await sleep(500 * (i + 1));
    }
  }
  throw last || new Error('request failed');
}

/** Run async tasks with limited concurrency. */
export async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const k = i++; try { out[k] = await fn(items[k], k); } catch (e) { out[k] = { error: e }; } }
  }));
  return out;
}
