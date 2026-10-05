// IndexedDB wrapper – the app's entire "backend". Nothing ever leaves the device.
const DB_NAME = 'paisa-ledger';
const VERSION = 1;
const STORES = { txns: 'id', docs: 'id', meta: 'key' };

let dbp;
function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
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

export const db = {
  all: (store) => tx(store, 'readonly', (s) => wrap(s.getAll())),
  get: (store, key) => tx(store, 'readonly', (s) => wrap(s.get(key))),
  put: (store, obj) => tx(store, 'readwrite', (s) => wrap(s.put(obj))),
  putMany: (store, objs) => tx(store, 'readwrite', async (s) => { for (const o of objs) s.put(o); }),
  del: (store, key) => tx(store, 'readwrite', (s) => wrap(s.delete(key))),
  clear: (store) => tx(store, 'readwrite', (s) => wrap(s.clear())),
  async meta(key, fallback = null) {
    const r = await db.get('meta', key);
    return r ? r.value : fallback;
  },
  setMeta: (key, value) => db.put('meta', { key, value }),
  persist: async () => (navigator.storage?.persist ? navigator.storage.persist() : false),
};

// ----- encrypted backup helpers (WebCrypto AES-GCM, PBKDF2) -----
const enc = new TextEncoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function keyFrom(pass, salt) {
  const base = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 250000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function encryptJSON(obj, pass) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await keyFrom(pass, salt);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj)));
  return { format: 'paisa-ledger-encrypted-v1', salt: b64(salt), iv: b64(iv), data: b64(ct) };
}

export async function decryptJSON(wrapper, pass) {
  const key = await keyFrom(pass, unb64(wrapper.salt));
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(wrapper.iv) }, key, unb64(wrapper.data));
  return JSON.parse(new TextDecoder().decode(pt));
}

export const blobToB64 = (blob) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result.split(',')[1]); r.readAsDataURL(blob); });
export const b64ToBlob = (data, type) => new Blob([unb64(data)], { type });
