// Application state + persistence operations. Views read `state` and call these functions.
import { db, encryptJSON, decryptJSON, blobToB64, b64ToBlob } from './db.js';
import { categorize, merchantKey } from './categorize.js';
import { hash, toISO, fyStart } from './util.js';
import { TAX_YEARS } from './tax.js';

const DEFAULT_SETTINGS = () => ({
  theme: 'auto', lang: 'en', textSize: 'normal', contrast: 'normal', budgets: {}, overrides: {}, taxProfile: {}, taxYear: null,
  notify: false, lockMinutes: 5, backupEveryDays: 30, lastBackup: null, onboarded: false, sidebarCollapsed: false, firstSeen: null,
});

export const state = {
  txns: [], rules: {}, docs: [], rent: [],
  goals: [], accounts: [], customRules: [], aliases: {}, colmaps: {},
  settings: DEFAULT_SETTINGS(),
  ui: { month: null, tx: { q: '', month: '', cat: '', type: '', account: '', tag: '', page: 1 }, taxTab: 'estimate', planTab: 'goals', showIgnored: false, selected: new Set() },
  ready: false,
};

const META_KEYS = { rules: 'rules', rent: 'rent', goals: 'goals', accounts: 'accounts', customRules: 'customRules', aliases: 'aliases', colmaps: 'colmaps' };
const sortTx = (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0);

const listeners = new Set();
export const onChange = (f) => { listeners.add(f); return () => listeners.delete(f); };
const emit = () => listeners.forEach((f) => f());

export async function load() {
  const [txns, docs, settings, ...metas] = await Promise.all([db.all('txns'), db.all('docs'), db.meta('settings', null), ...Object.keys(META_KEYS).map((k) => db.meta(k, null))]);
  state.txns = txns.sort(sortTx);
  state.docs = docs.sort((a, b) => b.added - a.added);
  Object.keys(META_KEYS).forEach((k, i) => { if (metas[i] != null) state[k] = metas[i]; });
  state.settings = { ...DEFAULT_SETTINGS(), ...(settings || {}) };
  if (!state.settings.taxYear) {
    const s = fyStart(toISO(new Date()));
    const cur = `${s}-${String((s + 1) % 100).padStart(2, '0')}`;
    state.settings.taxYear = TAX_YEARS[cur] ? cur : Object.keys(TAX_YEARS).at(-1);
  }
  if (!state.settings.firstSeen) { state.settings.firstSeen = toISO(new Date()); saveSettings(); }
  state.ready = true;
  emit();
}

/** Drop everything from memory (used when the app locks). */
export function clearMemory() {
  state.txns = []; state.docs = []; state.rent = []; state.goals = []; state.accounts = []; state.rules = {}; state.customRules = []; state.aliases = {}; state.colmaps = {};
  state.ui.selected = new Set(); state.ready = false;
}

export const saveSettings = () => db.setMeta('settings', state.settings);
export const saveMeta = async (key) => { await db.setMeta(key, state[key]); emit(); };
export const accounts = () => [...new Set(state.txns.map((t) => t.account))].sort();
export const allTags = () => [...new Set(state.txns.flatMap((t) => t.tags || []))].sort();

const catOpts = () => ({ custom: state.customRules, aliases: state.aliases });

/** Build a stored transaction from a parsed row. `seen` counts identical keys within the same batch. */
function makeTxn(row, account, source, seen) {
  const base = [account, row.date, row.type, row.amount.toFixed(2), row.balance ?? '', row.desc].join('|');
  const nth = (seen.get(base) || 0) + 1;
  seen.set(base, nth);
  const c = categorize(row, state.rules, catOpts());
  const t = {
    id: hash(base + '#' + nth), date: row.date, desc: row.desc, merchant: c.key, amount: row.amount, type: row.type,
    balance: row.balance ?? null, category: c.category, catSrc: c.source, account, source, note: '',
  };
  if (row.fx) t.fx = row.fx;
  return t;
}

export function previewImport(rows, account) {
  const have = new Set(state.txns.map((t) => t.id));
  const seen = new Map();
  let fresh = 0;
  for (const r of rows) if (!have.has(makeTxn(r, account, 'x', seen).id)) fresh++;
  return { fresh, dupes: rows.length - fresh };
}

export async function importRows(rows, account, source) {
  const have = new Set(state.txns.map((t) => t.id));
  const seen = new Map();
  const added = [];
  for (const r of rows) {
    const t = makeTxn(r, account, source, seen);
    if (!have.has(t.id)) added.push(t);
  }
  await db.putMany('txns', added);
  state.txns = [...added, ...state.txns].sort(sortTx);
  db.persist();
  emit();
  return { added: added.length, skipped: rows.length - added.length };
}

/** `fx` = { currency, rate, original } for foreign-currency spends already converted by the caller. */
export async function addManual({ date, desc, amount, type, category, account = 'Cash / manual', note = '', tags = [], fx }) {
  const merchant = merchantKey(desc);
  const t = { id: 'm-' + crypto.randomUUID(), date, desc, merchant, amount, type, balance: null, category, catSrc: 'manual', account, source: 'manual', note, tags };
  if (fx) t.fx = fx;
  await db.put('txns', t);
  state.txns = [t, ...state.txns].sort(sortTx);
  emit();
  return t;
}

export async function updateTxn(id, patch) {
  const t = state.txns.find((x) => x.id === id);
  if (!t) return;
  Object.assign(t, patch);
  for (const k of Object.keys(patch)) if (patch[k] === undefined) delete t[k];
  await db.put('txns', t);
  emit();
}

export async function bulkUpdate(ids, patchFn) {
  const set = new Set(ids);
  const changed = [];
  for (const t of state.txns) if (set.has(t.id)) { patchFn(t); changed.push(t); }
  await db.putMany('txns', changed);
  emit();
}

export async function deleteTxns(ids) {
  const set = new Set(ids);
  for (const id of set) await db.del('txns', id);
  state.txns = state.txns.filter((t) => !set.has(t.id));
  state.ui.selected = new Set();
  emit();
}
export const deleteTxn = (id) => deleteTxns([id]);

/** Change a category. If `similar`, also learn a rule and re-tag every transaction of that merchant. Returns undo(). */
export async function setCategory(id, category, similar) {
  const t = state.txns.find((x) => x.id === id);
  if (!t) return () => {};
  const targets = similar ? state.txns.filter((x) => x.merchant === t.merchant && x.type === t.type) : [t];
  const before = targets.map((x) => ({ id: x.id, category: x.category, catSrc: x.catSrc }));
  const prevRule = state.rules[t.merchant];
  for (const x of targets) { x.category = category; x.catSrc = 'user'; }
  if (similar) { state.rules[t.merchant] = category; await db.setMeta('rules', state.rules); }
  await db.putMany('txns', targets);
  emit();
  return async () => {
    for (const b of before) { const x = state.txns.find((y) => y.id === b.id); if (x) Object.assign(x, { category: b.category, catSrc: b.catSrc }); }
    if (similar) { if (prevRule) state.rules[t.merchant] = prevRule; else delete state.rules[t.merchant]; await db.setMeta('rules', state.rules); }
    await db.putMany('txns', state.txns.filter((x) => before.some((b) => b.id === x.id)));
    emit();
  };
}

export async function deleteRule(merchant) {
  delete state.rules[merchant];
  await db.setMeta('rules', state.rules);
  emit();
}

/** Re-run auto/keyword categorisation; user-set and manual categories are never touched. */
export async function recategorizeAll() {
  let n = 0;
  for (const t of state.txns) {
    if (t.catSrc === 'user' || t.catSrc === 'manual') continue;
    const c = categorize(t, state.rules, catOpts());
    if (c.key !== t.merchant) { t.merchant = c.key; n++; }
    if (c.category !== t.category) { t.category = c.category; t.catSrc = c.source; n++; }
  }
  await db.putMany('txns', state.txns);
  emit();
  return n;
}

/** How many existing transactions would a keyword rule change? (for the rule editor preview) */
export function previewRule(rule) {
  let n = 0;
  for (const t of state.txns) {
    if (t.catSrc === 'user' || t.catSrc === 'manual') continue;
    const c = categorize(t, state.rules, { aliases: state.aliases, custom: [rule, ...state.customRules] });
    if (c.category !== t.category) n++;
  }
  return n;
}

// ----- tax documents & rent -----
export async function addDoc(file, kind, fy, extracted = {}) {
  const d = { id: crypto.randomUUID(), kind, fy, name: file.name, type: file.type || 'application/octet-stream', size: file.size, added: Date.now(), extracted, blob: file };
  await db.put('docs', d);
  state.docs = [d, ...state.docs];
  emit();
  return d;
}
export async function updateDoc(id, patch) {
  const d = state.docs.find((x) => x.id === id);
  Object.assign(d, patch);
  await db.put('docs', d);
  emit();
}
export async function deleteDoc(id) {
  await db.del('docs', id);
  state.docs = state.docs.filter((d) => d.id !== id);
  emit();
}
export async function saveRent(list) {
  state.rent = list;
  await db.setMeta('rent', list);
  emit();
}

// ----- backup / restore / wipe -----
export async function exportBackup(passphrase) {
  const docs = await Promise.all(state.docs.map(async (d) => ({ ...d, blob: undefined, data: await blobToB64(d.blob) })));
  const payload = { app: 'paisa-ledger', version: 2, exported: new Date().toISOString(), txns: state.txns, docs, settings: state.settings };
  for (const k of Object.keys(META_KEYS)) payload[k] = state[k];
  state.settings.lastBackup = toISO(new Date());
  await saveSettings();
  return passphrase ? encryptJSON(payload, passphrase) : payload;
}

export async function importBackup(obj, passphrase) {
  let p = obj;
  if (obj.format === 'paisa-ledger-encrypted-v1') {
    if (!passphrase) throw new Error('This backup is encrypted – enter its passphrase.');
    try { p = await decryptJSON(obj, passphrase); } catch { throw new Error('Wrong passphrase, or the file is damaged.'); }
  }
  if (p.app !== 'paisa-ledger') throw new Error('This is not a Paisa Ledger backup.');
  await db.putMany('txns', p.txns || []);
  await db.putMany('docs', (p.docs || []).map(({ data, ...d }) => ({ ...d, blob: b64ToBlob(data, d.type) })));
  for (const k of Object.keys(META_KEYS)) if (p[k] != null) await db.setMeta(k, k === 'rules' || k === 'aliases' || k === 'colmaps' ? { ...state[k], ...p[k] } : p[k]);
  await db.setMeta('settings', { ...state.settings, ...(p.settings || {}) });
  await load();
}

export async function wipeAll() {
  await Promise.all(['txns', 'docs', 'meta'].map((s) => db.clear(s)));
  const keep = { theme: state.settings.theme, lang: state.settings.lang, taxYear: state.settings.taxYear, onboarded: true };
  clearMemory();
  state.settings = { ...DEFAULT_SETTINGS(), ...keep };
  state.ready = true;
  await saveSettings();
  emit();
}
