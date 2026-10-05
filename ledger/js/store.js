// Application state + persistence operations. Views read `state` and call these functions.
import { db, encryptJSON, decryptJSON, blobToB64, b64ToBlob } from './db.js';
import { categorize, merchantKey } from './categorize.js';
import { hash, toISO, fyStart } from './util.js';
import { TAX_YEARS } from './tax.js';

export const state = {
  txns: [],
  rules: {},
  docs: [],
  rent: [],
  settings: { theme: 'auto', budgets: {}, overrides: {}, taxProfile: {}, taxYear: null },
  ui: { month: null, tx: { q: '', month: '', cat: '', type: '', account: '', page: 1 }, taxTab: 'estimate', showIgnored: false },
  ready: false,
};

const listeners = new Set();
export const onChange = (f) => { listeners.add(f); return () => listeners.delete(f); };
const emit = () => listeners.forEach((f) => f());

export async function load() {
  const [txns, docs, rules, rent, settings] = await Promise.all([db.all('txns'), db.all('docs'), db.meta('rules', {}), db.meta('rent', []), db.meta('settings', null)]);
  state.txns = txns.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  state.docs = docs.sort((a, b) => b.added - a.added);
  state.rules = rules;
  state.rent = rent;
  if (settings) Object.assign(state.settings, settings);
  if (!state.settings.taxYear) {
    const cur = `${fyStart(toISO(new Date()))}-${String((fyStart(toISO(new Date())) + 1) % 100).padStart(2, '0')}`;
    state.settings.taxYear = TAX_YEARS[cur] ? cur : Object.keys(TAX_YEARS).at(-1);
  }
  state.ready = true;
  emit();
}

export const saveSettings = () => db.setMeta('settings', state.settings);
export const accounts = () => [...new Set(state.txns.map((t) => t.account))].sort();

/** Build a stored transaction from a parsed row. `seen` counts identical keys within the same batch. */
function makeTxn(row, account, source, seen) {
  const base = [account, row.date, row.type, row.amount.toFixed(2), row.balance ?? '', row.desc].join('|');
  const nth = (seen.get(base) || 0) + 1;
  seen.set(base, nth);
  const c = categorize(row, state.rules);
  return {
    id: hash(base + '#' + nth), date: row.date, desc: row.desc, merchant: c.key, amount: row.amount, type: row.type,
    balance: row.balance ?? null, category: c.category, catSrc: c.source, account, source, note: '',
  };
}

/** How many of these rows are new vs already stored? Used for the import preview. */
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
  state.txns = [...added, ...state.txns].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  db.persist();
  emit();
  return { added: added.length, skipped: rows.length - added.length };
}

export async function addManual({ date, desc, amount, type, category, account = 'Cash / manual', note = '' }) {
  const merchant = merchantKey(desc);
  const t = { id: 'm-' + crypto.randomUUID(), date, desc, merchant, amount, type, balance: null, category, catSrc: 'manual', account, source: 'manual', note };
  await db.put('txns', t);
  state.txns = [t, ...state.txns].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  emit();
}

export async function updateTxn(id, patch) {
  const t = state.txns.find((x) => x.id === id);
  if (!t) return;
  Object.assign(t, patch);
  await db.put('txns', t);
  emit();
}

export async function deleteTxn(id) {
  await db.del('txns', id);
  state.txns = state.txns.filter((t) => t.id !== id);
  emit();
}

/** Change a category. If `similar`, also learn a rule and re-tag every transaction of that merchant. Returns undo(). */
export async function setCategory(id, category, similar) {
  const t = state.txns.find((x) => x.id === id);
  if (!t) return () => {};
  const before = state.txns.filter((x) => (similar ? x.merchant === t.merchant : x.id === id)).map((x) => ({ id: x.id, category: x.category, catSrc: x.catSrc }));
  const prevRule = state.rules[t.merchant];
  const targets = similar ? state.txns.filter((x) => x.merchant === t.merchant && x.type === t.type) : [t];
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

export async function recategorizeAll() {
  let n = 0;
  for (const t of state.txns) {
    if (t.catSrc === 'user' || t.catSrc === 'manual') continue;
    const c = categorize(t, state.rules);
    if (c.category !== t.category) { t.category = c.category; n++; }
  }
  await db.putMany('txns', state.txns);
  emit();
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
  const payload = { app: 'paisa-ledger', version: 1, exported: new Date().toISOString(), txns: state.txns, rules: state.rules, rent: state.rent, settings: state.settings, docs };
  return passphrase ? encryptJSON(payload, passphrase) : payload;
}

export async function importBackup(obj, passphrase) {
  let p = obj;
  if (obj.format === 'paisa-ledger-encrypted-v1') {
    if (!passphrase) throw new Error('This backup is encrypted – enter its passphrase.');
    try { p = await decryptJSON(obj, passphrase); } catch { throw new Error('Wrong passphrase, or the file is damaged.'); }
  }
  if (p.app !== 'paisa-ledger') throw new Error('This is not a Paisa Ledger backup.');
  await db.putMany('txns', p.txns);
  await db.putMany('docs', (p.docs || []).map(({ data, ...d }) => ({ ...d, blob: b64ToBlob(data, d.type) })));
  await db.setMeta('rules', { ...state.rules, ...p.rules });
  await db.setMeta('rent', p.rent || []);
  await db.setMeta('settings', { ...state.settings, ...p.settings });
  await load();
}

export async function wipeAll() {
  await Promise.all(['txns', 'docs', 'meta'].map((s) => db.clear(s)));
  state.txns = []; state.docs = []; state.rules = {}; state.rent = [];
  state.settings = { theme: state.settings.theme, budgets: {}, overrides: {}, taxProfile: {}, taxYear: state.settings.taxYear };
  emit();
}
