// Tiny JSON persistence with atomic writes. One file per collection keeps things debuggable and crash-safe.
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_SETTINGS, emptyProfile } from './profile.js';

const SECRET_PATHS = [['claude', 'apiKey'], ['email', 'pass'], ['adzuna', 'appKey'], ['inbox', 'pass']];
const PREFIX = 'enc:v1:';
const mapSecrets = (settings, fn) => { const out = JSON.parse(JSON.stringify(settings)); for (const [a, b] of SECRET_PATHS) if (out[a] && typeof out[a][b] === 'string' && out[a][b]) out[a][b] = fn(out[a][b]); return out; };

const FILES = { profile: emptyProfile, settings: DEFAULT_SETTINGS, jobs: () => ({}), apps: () => [], companies: () => [], log: () => [], meta: () => ({}) };

export class Store {
  /** @param {{codec?:{encrypt:(s:string)=>string, decrypt:(s:string)=>string}}} [o] codec protects API keys / passwords on disk (OS-level encryption). */
  constructor(dir, { codec = null } = {}) {
    this.dir = dir; this.codec = codec;
    this.data = {};
    this.timers = {};
    fs.mkdirSync(dir, { recursive: true });
    for (const [k, def] of Object.entries(FILES)) this.data[k] = this.#read(k, def);
    if (codec) this.data.settings = mapSecrets(this.data.settings, (v) => { if (!v.startsWith(PREFIX)) return v; try { return codec.decrypt(v.slice(PREFIX.length)); } catch { return ''; } });
    // forward-compatible settings: new defaults appear after upgrades
    this.data.settings = deepMerge(DEFAULT_SETTINGS(), this.data.settings);
    this.data.profile = deepMerge(emptyProfile(), this.data.profile);
  }
  #file(k) { return path.join(this.dir, `${k}.json`); }
  #read(k, def) {
    try { return JSON.parse(fs.readFileSync(this.#file(k), 'utf8')); }
    catch (e) {
      if (e.code !== 'ENOENT') { try { fs.copyFileSync(this.#file(k), this.#file(k) + '.corrupt'); } catch {} }
      return def();
    }
  }
  get(k) { return this.data[k]; }
  set(k, v) { this.data[k] = v; this.save(k); return v; }
  /** Debounced atomic write. */
  save(k) {
    clearTimeout(this.timers[k]);
    this.timers[k] = setTimeout(() => this.flush(k), 150);
  }
  flush(k) {
    const keys = k ? [k] : Object.keys(this.data);
    for (const key of keys) {
      clearTimeout(this.timers[key]);
      const f = this.#file(key), tmp = f + '.tmp';
      let data = this.data[key];
      if (key === 'settings' && this.codec) data = mapSecrets(data, (v) => (v.startsWith(PREFIX) ? v : PREFIX + this.codec.encrypt(v)));
      try { fs.writeFileSync(tmp, JSON.stringify(data, null, key === 'jobs' || key === 'log' ? 0 : 2)); fs.renameSync(tmp, f); } catch (e) { console.error('store write failed', key, e.message); }
    }
  }
}

export function deepMerge(base, over) {
  if (!over || typeof over !== 'object' || Array.isArray(over)) return over === undefined ? base : over;
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = v && typeof v === 'object' && !Array.isArray(v) && base && typeof base[k] === 'object' && !Array.isArray(base[k]) ? deepMerge(base[k], v) : v;
  return out;
}
