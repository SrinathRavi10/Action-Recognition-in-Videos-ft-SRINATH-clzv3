// Separate profiles (e.g. "Me", "Parents", "Business"): each has its own database and lock. Registry lives in localStorage.
const REG = 'pl:profiles', ACT = 'pl:active';
const read = () => { try { return JSON.parse(localStorage.getItem(REG)) || [{ id: 'default', name: 'Me' }]; } catch { return [{ id: 'default', name: 'Me' }]; } };

export const profiles = () => read();
export const activeId = () => { try { return localStorage.getItem(ACT) || 'default'; } catch { return 'default'; } };
export const activeProfile = () => read().find((p) => p.id === activeId()) || read()[0];
export const lsKey = (k, id = activeId()) => `pl:${id}:${k}`;
export const dbName = (id = activeId()) => (id === 'default' ? 'paisa-ledger' : `paisa-ledger-${id}`);

export function addProfile(name) {
  const list = read();
  const id = 'p' + Date.now().toString(36);
  list.push({ id, name: name.trim().slice(0, 24) || 'Profile' });
  localStorage.setItem(REG, JSON.stringify(list));
  return id;
}
export function renameProfile(id, name) {
  const list = read().map((p) => (p.id === id ? { ...p, name: name.trim().slice(0, 24) || p.name } : p));
  localStorage.setItem(REG, JSON.stringify(list));
}
export function removeProfile(id) {
  if (id === 'default') return;
  localStorage.setItem(REG, JSON.stringify(read().filter((p) => p.id !== id)));
  try { indexedDB.deleteDatabase(dbName(id)); } catch {}
  for (const k of Object.keys(localStorage)) if (k.startsWith(`pl:${id}:`)) localStorage.removeItem(k);
}
export function switchProfile(id) { localStorage.setItem(ACT, id); location.hash = '#/home'; location.reload(); }
