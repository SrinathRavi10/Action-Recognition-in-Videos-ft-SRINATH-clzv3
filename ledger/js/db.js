// IndexedDB wrapper – the app's entire "backend". Nothing ever leaves the device.
// With the app lock enabled every record is sealed with AES-256-GCM (key derived from the passphrase, kept only in memory).
import { dbName, lsKey } from './profiles.js';

const VERSION = 1;
const STORES = { txns: 'id', docs: 'id', meta: 'key' };

let dbp;
function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName(), VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const [name, keyPath] of Object.entries(STORES)) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

const wrap = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });

async function tx(store, mode, fn) {
  const db = await open();
  const t = db.transaction(store, mode);
  const s = t.objectStore(store);
  const result = await fn(s);
  await new Promise((res, rej) => { t.oncomplete = res; t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });
  return result;
}

// ───────── encryption at rest ─────────
const enc = new TextEncoder();
const dec = new TextDecoder();
let KEY = null;

const cfgRead = () => { try { return JSON.parse(localStorage.getItem(lsKey('lock'))); } catch { return null; } };
const b64 = (buf) => { let s = ''; const a = new Uint8Array(buf); for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode(...a.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const concat = (a, b) => { const o = new Uint8Array(a.length + b.length); o.set(a); o.set(b, a.length); return o; };

async function derive(pass, salt, iter) {
  const base = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function seal(bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  return concat(iv, new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, KEY, bytes)));
}
async function unseal(buf) {
  const a = new Uint8Array(buf);
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: a.slice(0, 12) }, KEY, a.slice(12)));
}

async function pack(store, obj) {
  if (!KEY) return obj;
  const kp = STORES[store];
  const { blob, ...rest } = obj;
  const out = { [kp]: obj[kp], _e: (await seal(enc.encode(JSON.stringify(rest)))).buffer };
  if (blob) { out._eb = (await seal(new Uint8Array(await blob.arrayBuffer()))).buffer; out._bt = blob.type; }
  return out;
}
async function unpack(rec) {
  if (!rec || !rec._e) return rec;
  if (!KEY) throw new Error('locked');
  const obj = JSON.parse(dec.decode(await unseal(rec._e)));
  if (rec._eb) obj.blob = new Blob([await unseal(rec._eb)], { type: rec._bt });
  return obj;
}

export const lockEnabled = () => !!cfgRead();
export const isUnlocked = () => !lockEnabled() || !!KEY;

export async function unlock(pass) {
  const cfg = cfgRead();
  if (!cfg) return true;
  try {
    const key = await derive(pass, unb64(cfg.salt), cfg.iter);
    const a = unb64(cfg.check);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: a.slice(0, 12) }, key, a.slice(12));
    if (dec.decode(pt) !== 'paisa-ok') return false;
    KEY = key;
    return true;
  } catch { return false; }
}
export function lockNow() { KEY = null; }

/** Turn the lock on: derive a key, then re-write every record sealed. */
export async function enableLock(pass) {
  const [txns, docs, meta] = await Promise.all([db.all('txns'), db.all('docs'), db.all('meta')]);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iter = 250000;
  KEY = await derive(pass, salt, iter);
  const check = await seal(enc.encode('paisa-ok'));
  for (const [store, list] of [['txns', txns], ['docs', docs], ['meta', meta]]) await db.putMany(store, list);
  localStorage.setItem(lsKey('lock'), JSON.stringify({ salt: b64(salt), iter, check: b64(check) }));
}

/** Turn it off (must be unlocked). */
export async function disableLock() {
  const [txns, docs, meta] = await Promise.all([db.all('txns'), db.all('docs'), db.all('meta')]);
  KEY = null;
  localStorage.removeItem(lsKey('lock'));
  for (const [store, list] of [['txns', txns], ['docs', docs], ['meta', meta]]) await db.putMany(store, list);
}

export async function changePassphrase(oldPass, newPass) {
  if (!(await unlock(oldPass))) return false;
  await disableLock();
  await enableLock(newPass);
  return true;
}

export const db = {
  all: async (store) => Promise.all((await tx(store, 'readonly', (s) => wrap(s.getAll()))).map(unpack)),
  get: async (store, key) => unpack(await tx(store, 'readonly', (s) => wrap(s.get(key)))),
  put: async (store, obj) => { const r = await pack(store, obj); return tx(store, 'readwrite', (s) => wrap(s.put(r))); },
  putMany: async (store, objs) => { const rs = []; for (const o of objs) rs.push(await pack(store, o)); return tx(store, 'readwrite', async (s) => { for (const r of rs) s.put(r); }); },
  del: (store, key) => tx(store, 'readwrite', (s) => wrap(s.delete(key))),
  clear: (store) => tx(store, 'readwrite', (s) => wrap(s.clear())),
  async meta(key, fallback = null) {
    const r = await db.get('meta', key);
    return r ? r.value : fallback;
  },
  setMeta: (key, value) => db.put('meta', { key, value }),
  persist: async () => (navigator.storage?.persist ? navigator.storage.persist() : false),
};

// ───────── passphrase-encrypted backup helpers ─────────
export async function encryptJSON(obj, pass) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await derive(pass, salt, 250000);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj)));
  return { format: 'paisa-ledger-encrypted-v1', salt: b64(salt), iv: b64(iv), data: b64(ct) };
}
export async function decryptJSON(wrapper, pass) {
  const key = await derive(pass, unb64(wrapper.salt), 250000);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(wrapper.iv) }, key, unb64(wrapper.data));
  return JSON.parse(dec.decode(pt));
}
export const blobToB64 = async (blob) => b64(await blob.arrayBuffer());
export const b64ToBlob = (data, type) => new Blob([unb64(data)], { type });
