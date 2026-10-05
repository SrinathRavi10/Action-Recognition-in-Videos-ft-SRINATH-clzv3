import { state, accounts } from '../store.js';
import { SPEND_CATS } from '../categorize.js';
import { displayMerchant } from '../categorize.js';
import { esc, fmt } from '../util.js';

export function settings() {
  const b = state.settings.budgets;
  const rules = Object.entries(state.rules).sort();
  return `
  <div class="page-head"><h1>Settings</h1></div>
  <section class="card"><h2>Appearance</h2>
    <label class="field"><span>Theme</span><select data-change="theme">${['auto', 'light', 'dark'].map((t) => `<option value="${t}" ${state.settings.theme === t ? 'selected' : ''}>${t[0].toUpperCase() + t.slice(1)}</option>`).join('')}</select></label></section>

  <section class="card"><h2>Monthly budgets</h2><p class="muted">Leave blank for no limit. Progress shows on the dashboard.</p>
    <div class="fields">${SPEND_CATS.filter((c) => c !== 'Uncategorized').map((c) => `<label class="field"><span>${esc(c)}</span><input class="input" inputmode="numeric" data-input="budget" data-cat="${esc(c)}" value="${b[c] || ''}" placeholder="No limit"></label>`).join('')}</div></section>

  <section class="card"><div class="card-head"><h2>Learned categories</h2><button class="btn small" data-action="recat">Re-apply rules</button></div>
    <p class="muted">When you change a merchant’s category and choose “all”, the choice is remembered here and applied to future imports.</p>
    ${rules.length ? `<ul class="rules">${rules.map(([m, c]) => `<li><span><b>${esc(displayMerchant(m))}</b> → ${esc(c)}</span><button class="icon" data-action="rule-del" data-m="${esc(m)}" aria-label="Forget rule">✕</button></li>`).join('')}</ul>` : '<p class="muted">Nothing learned yet.</p>'}</section>

  <section class="card"><h2>Backup & restore</h2>
    <p class="muted">Your data lives only in this browser. Export a backup now and then – especially before clearing browser data or switching devices.</p>
    <label class="field"><span>Passphrase (optional – encrypts the backup with AES-256)</span><input class="input" type="password" id="bkpass" autocomplete="new-password"></label>
    <div class="row gap"><button class="btn primary" data-action="backup">Export backup</button>
      <label class="btn">Restore from file<input type="file" id="restore" accept=".json,application/json" hidden></label>
      <button class="btn" data-action="persist">Ask browser to keep my data</button></div>
    <p class="muted small">${state.txns.length.toLocaleString('en-IN')} transactions · ${accounts().length} account(s) · ${state.docs.length} document(s)</p></section>

  <section class="card"><h2>Privacy</h2><ul class="ticks">
    <li>No analytics, no accounts, no servers. The app’s security policy blocks all outside network connections.</li>
    <li>PDF reading, categorisation, subscription detection and tax maths all run locally.</li>
    <li>Works offline once installed – use your browser’s “Install app” option.</li></ul></section>

  <section class="card danger-zone"><h2>Danger zone</h2><p class="muted">Permanently delete every transaction, document and setting from this device.</p>
    <button class="btn danger" data-action="wipe">Delete all data</button></section>`;
}
