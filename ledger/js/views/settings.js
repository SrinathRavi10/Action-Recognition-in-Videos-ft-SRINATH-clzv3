import { state, accounts } from '../store.js';
import { SPEND_CATS, ALL_CATS, displayMerchant } from '../categorize.js';
import { lockEnabled } from '../db.js';
import { profiles, activeId } from '../profiles.js';
import { LANGS } from '../i18n.js';
import { icon } from '../icons.js';
import { categoryOptions } from './transactions.js';
import { esc, longDate, daysBetween, toISO } from '../util.js';

const sel = (name, opts, cur) => `<select data-change="${name}">${opts.map(([v, l]) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${l}</option>`).join('')}</select>`;

export function settings() {
  const S = state.settings;
  const b = S.budgets;
  const rules = Object.entries(state.rules).sort();
  const locked = lockEnabled();
  const since = S.lastBackup ? daysBetween(S.lastBackup, toISO(new Date())) : null;
  const merchants = [...new Set(state.txns.map((t) => t.merchant))].sort();
  return `
  <div class="page-head"><div><h1>Settings</h1><p>Everything here is stored on this device only.</p></div></div>

  <section class="card"><div class="card-head"><h2>${icon('sun', 18)} Appearance &amp; accessibility</h2></div>
    <div class="fields">
      <label class="field"><span>Theme</span>${sel('theme', [['auto', 'Match system'], ['light', 'Light'], ['dark', 'Dark']], S.theme)}</label>
      <label class="field"><span>Language</span>${sel('lang', Object.entries(LANGS), S.lang)}<small>Navigation and key screens. More languages can be added in js/i18n.js.</small></label>
      <label class="field"><span>Text size</span>${sel('textSize', [['normal', 'Normal'], ['large', 'Large'], ['xlarge', 'Extra large']], S.textSize)}</label>
      <label class="field"><span>Contrast</span>${sel('contrast', [['normal', 'Normal'], ['high', 'High contrast']], S.contrast)}</label></div></section>

  <section class="card"><div class="card-head"><h2>${icon('lock', 18)} App lock &amp; encryption</h2>${locked ? '<span class="chip good">' + icon('shield', 13) + ' On</span>' : '<span class="chip">Off</span>'}</div>
    <p class="muted">Locks the app with a passphrase and encrypts everything stored on this device (AES-256). If you forget it, the data cannot be recovered – keep a backup. Use 8+ characters; short PINs can be guessed by someone who copies your data files.</p>
    ${locked ? `<div class="row gap wrap"><button class="btn" data-action="lock-now">${icon('lock', 17)} Lock now</button><button class="btn" data-action="lock-change">Change passphrase</button><button class="btn danger" data-action="lock-off">Turn off</button>
      <label class="field" style="margin-left:auto"><span>Auto-lock after</span>${sel('lockMinutes', [['1', '1 minute'], ['5', '5 minutes'], ['15', '15 minutes'], ['60', '1 hour'], ['0', 'Never']], String(S.lockMinutes))}</label></div>`
    : `<button class="btn primary" data-action="lock-on">${icon('lock', 17)} Set up app lock</button>`}</section>

  <section class="card"><div class="card-head"><h2>${icon('users', 18)} Profiles</h2></div>
    <p class="muted">Keep separate books – for example “Me”, “Parents” or “Business”. Each profile has its own data and its own lock.</p>
    <ul class="plainlist">${profiles().map((p) => `<li><span class="row gap"><b>${esc(p.name)}</b>${p.id === activeId() ? '<span class="chip good">Current</span>' : ''}</span><span class="row gap">${p.id !== activeId() ? `<button class="btn small" data-action="profile-switch" data-id="${p.id}">Switch</button>` : ''}<button class="btn small ghost" data-action="profile-rename" data-id="${p.id}">Rename</button>${p.id !== 'default' && p.id !== activeId() ? `<button class="btn small ghost" data-action="profile-del" data-id="${p.id}">${icon('trash', 14)}</button>` : ''}</span></li>`).join('')}</ul>
    <button class="btn" data-action="profile-add" style="margin-top:12px">${icon('plus', 17)} Add profile</button></section>

  <section class="card"><div class="card-head"><h2>${icon('target', 18)} Monthly budgets</h2></div><p class="muted">Leave blank for no limit. Progress shows on Home.</p>
    <div class="fields">${SPEND_CATS.filter((c) => c !== 'Uncategorized').map((c) => `<label class="field"><span>${esc(c)}</span><input class="input" inputmode="numeric" data-input="budget" data-cat="${esc(c)}" value="${b[c] || ''}" placeholder="No limit"></label>`).join('')}</div></section>

  <section class="card"><div class="card-head"><h2>${icon('tag', 18)} Categorisation rules</h2><button class="btn small" data-action="recat">${icon('refresh', 14)} Re-apply rules</button></div>
    <p class="muted">Teach the app your own patterns. A rule matches words in the bank narration (or a <code>/regex/</code>). Rules beat the built-in ones; categories you set by hand are never overwritten.</p>
    <form class="row gap wrap" data-submit="rule-add" style="margin-bottom:14px">
      <input class="input grow" name="pattern" placeholder="e.g. BESCOM  or  /uber|ola/" required>
      <select name="category" style="min-width:200px">${categoryOptions('Groceries')}</select>
      <select name="type"><option value="">Any</option><option value="debit">Debits</option><option value="credit">Credits</option></select>
      <button type="button" class="btn" data-action="rule-preview">Preview</button><button class="btn primary">Add rule</button></form>
    ${state.customRules.length ? `<ul class="plainlist">${state.customRules.map((r) => `<li><span><code>${esc(r.pattern)}</code> → <b>${esc(r.category)}</b>${r.type ? ` <span class="chip">${r.type}s</span>` : ''}</span><button class="icon" data-action="crule-del" data-id="${r.id}" aria-label="Delete rule">${icon('trash', 16)}</button></li>`).join('')}</ul>` : ''}
    <details><summary>Learned from your edits (${rules.length})</summary>${rules.length ? `<ul class="rules">${rules.map(([m, c]) => `<li><span><b>${esc(displayMerchant(m))}</b> → ${esc(c)}</span><button class="icon" data-action="rule-del" data-m="${esc(m)}" aria-label="Forget rule">${icon('x', 16)}</button></li>`).join('')}</ul>` : '<p class="muted">Nothing learned yet.</p>'}</details>
    <details><summary>Merge merchants (${Object.keys(state.aliases).length})</summary>
      <p class="muted small">Treat two names as the same merchant, e.g. “Swiggy Instamart” → “Swiggy”.</p>
      <form class="row gap wrap" data-submit="alias-add"><input class="input grow" name="from" list="mlist" placeholder="Merge this merchant…" required><input class="input grow" name="to" list="mlist" placeholder="…into this one" required><button class="btn">Merge</button></form>
      <datalist id="mlist">${merchants.map((m) => `<option value="${esc(m)}">`).join('')}</datalist>
      ${Object.entries(state.aliases).length ? `<ul class="plainlist">${Object.entries(state.aliases).map(([a, c]) => `<li><span>${esc(a)} → <b>${esc(c)}</b></span><button class="icon" data-action="alias-del" data-m="${esc(a)}" aria-label="Undo merge">${icon('x', 16)}</button></li>`).join('')}</ul>` : ''}</details></section>

  <section class="card"><div class="card-head"><h2>${icon('download', 18)} Backup &amp; restore</h2>${since != null && since > S.backupEveryDays ? '<span class="chip warn">Backup overdue</span>' : ''}</div>
    <p class="muted">Your data lives only on this device. Export a backup now and then – especially before clearing browser data, reinstalling or switching computers. ${S.lastBackup ? `Last backup: <b>${longDate(S.lastBackup)}</b>.` : 'You have not made a backup yet.'}</p>
    <div class="fields" style="margin-bottom:14px"><label class="field"><span>Passphrase (optional – encrypts the backup)</span><input class="input" type="password" id="bkpass" autocomplete="new-password"></label>
      <label class="field"><span>Remind me every</span>${sel('backupEvery', [['7', '7 days'], ['30', '30 days'], ['90', '90 days'], ['0', 'Never']], String(S.backupEveryDays))}</label></div>
    <div class="row gap wrap"><button class="btn primary" data-action="backup">${icon('download', 17)} Export backup</button>
      <label class="btn">${icon('upload', 17)} Restore from file<input type="file" id="restore" accept=".json,application/json" hidden></label>
      <button class="btn" data-action="persist">Keep my data (ask browser)</button></div>
    <p class="muted small">${state.txns.length.toLocaleString('en-IN')} transactions · ${accounts().length} account(s) · ${state.docs.length} document(s)</p></section>

  <section class="card"><div class="card-head"><h2>${icon('shield', 18)} Privacy</h2></div><ul class="ticks">
    <li>No analytics, no accounts, no servers. The app's security policy blocks outside network connections.</li>
    <li>PDF and OCR reading, categorisation, subscription detection and tax maths all run locally.</li>
    <li>Works offline once installed.</li></ul></section>

  <section class="card danger-zone"><div class="card-head"><h2>${icon('trash', 18)} Danger zone</h2></div><p class="muted">Permanently delete every transaction, document and setting in this profile.</p>
    <button class="btn danger" data-action="wipe">Delete all data</button></section>`;
}
