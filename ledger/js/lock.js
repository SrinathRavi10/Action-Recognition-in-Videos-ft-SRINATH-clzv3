// Lock screen UI + auto-lock timer. Encryption itself lives in db.js.
import { unlock, lockNow, lockEnabled } from './db.js';
import { clearMemory, state } from './store.js';
import { activeProfile } from './profiles.js';
import { icon } from './icons.js';
import { esc } from './util.js';

let timer, onUnlocked;

export function showLock(cb) {
  onUnlocked = cb || onUnlocked;
  const el = document.getElementById('lock');
  el.hidden = false;
  document.getElementById('app').setAttribute('inert', '');
  el.innerHTML = `<form class="lockbox" id="lockForm" autocomplete="off">
    <img src="icons/icon.svg" alt="">
    <div><h1 style="font-size:1.4rem">Paisa Ledger</h1><p class="muted" style="margin:4px 0 0">${esc(activeProfile().name)} · enter your passphrase</p></div>
    <input class="input" type="password" id="lockPass" placeholder="Passphrase" autocomplete="current-password" autofocus style="text-align:center;font-size:1.1rem">
    <p id="lockMsg" class="neg small" style="margin:0;min-height:1.2em" role="alert"></p>
    <button class="btn primary lg" style="justify-content:center">${icon('unlock', 18)} Unlock</button></form>`;
  const form = el.querySelector('#lockForm');
  const input = el.querySelector('#lockPass');
  setTimeout(() => input.focus(), 30);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button');
    btn.disabled = true;
    const ok = await unlock(input.value);
    btn.disabled = false;
    if (!ok) { el.querySelector('#lockMsg').textContent = 'Wrong passphrase.'; form.classList.remove('shake'); void form.offsetWidth; form.classList.add('shake'); input.select(); return; }
    el.hidden = true; el.innerHTML = '';
    document.getElementById('app').removeAttribute('inert');
    await onUnlocked?.();
    arm();
  };
}

export function lockApp() {
  if (!lockEnabled()) return false;
  lockNow();
  clearMemory();
  showLock();
  return true;
}

/** Idle auto-lock. */
export function arm() {
  clearTimeout(timer);
  const mins = +state.settings.lockMinutes;
  if (!lockEnabled() || !mins) return;
  timer = setTimeout(lockApp, mins * 60000);
}
['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach((ev) => addEventListener(ev, () => { if (lockEnabled()) arm(); }, { passive: true }));
