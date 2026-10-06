import { icon } from './icons.js';

const api = window.api;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const call = (n, p) => api.call(n, p);

const S = { server: null, jobs: [], apps: [], companies: [], log: [], health: {}, route: 'today', jobFilter: 'matches', jobQ: '', appFilter: 'all', busy: new Set(), drawer: null };

const ROUTES = [
  ['today', 'Today', 'zap'], ['jobs', 'Jobs', 'briefcase'], ['applications', 'Applications', 'send'], ['needs', 'Needs you', 'alert'],
  ['profile', 'Profile', 'user'], ['sources', 'Sources', 'building'], ['settings', 'Settings', 'sliders'], ['activity', 'Activity', 'activity'],
];

// ───────── helpers ─────────
function toast(msg, ms = 4200) { const t = $('#toast'); t.innerHTML = `<span>${esc(msg)}</span>`; t.hidden = false; requestAnimationFrame(() => t.classList.add('show')); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), ms); }
const ago = (iso) => { if (!iso) return ''; const s = (Date.now() - new Date(iso)) / 1000; if (s < 60) return 'just now'; if (s < 3600) return `${Math.floor(s / 60)} min ago`; if (s < 86400) return `${Math.floor(s / 3600)} h ago`; return `${Math.floor(s / 86400)} d ago`; };
const hm = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const inMin = (iso) => { if (!iso) return ''; const m = Math.max(0, Math.round((new Date(iso) - Date.now()) / 60000)); return m <= 1 ? 'in under a minute' : `in ${m} min`; };
function modal({ title, body, buttons = [{ label: 'Close', value: null }], wide = false }) {
  return new Promise((resolve) => {
    const d = document.createElement('dialog'); d.className = 'modal' + (wide ? ' wide' : '');
    d.innerHTML = `<form method="dialog"><h3>${esc(title)}</h3><div class="modal-body">${body}</div><div class="modal-actions">${buttons.map((b, i) => `<button value="${i}" class="btn ${b.primary ? 'primary' : ''} ${b.danger ? 'danger' : ''}">${esc(b.label)}</button>`).join('')}</div></form>`;
    document.body.appendChild(d); let res = null;
    d.addEventListener('close', () => { d.remove(); resolve(res); });
    d.querySelector('form').addEventListener('submit', (e) => { const b = buttons[e.submitter?.value]; res = b ? (typeof b.value === 'function' ? b.value(d) : b.value) : null; });
    d.showModal();
  });
}
const ring = (score, size = 46) => { const r = 19, c = 2 * Math.PI * r, col = score >= 75 ? 'var(--good)' : score >= 60 ? 'var(--s1)' : score >= 45 ? 'var(--warn)' : 'var(--text-3)'; return `<div class="ring" style="width:${size}px;height:${size}px"><svg viewBox="0 0 46 46" width="${size}" height="${size}"><circle class="bg" cx="23" cy="23" r="${r}" fill="none" stroke-width="5"/><circle class="fg" cx="23" cy="23" r="${r}" fill="none" stroke-width="5" style="stroke:${col}" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - score / 100)}"/></svg><b>${score}</b></div>`; };
const STATUS = { applied: ['Applied', 'good', 'check'], emailed: ['Emailed', 'good', 'mail'], unconfirmed: ['Sent – unconfirmed', 'warn', 'info'], dry_run: ['Dry run', 'info', 'eye'], needs_you: ['Needs you', 'warn', 'alert'], failed: ['Failed', 'bad', 'x'], closed: ['Closed', '', 'x'], dismissed: ['Dismissed', '', 'x'], superseded: ['Retried', '', 'refresh'], new: ['New', 'info', 'sparkle'], skipped: ['Skipped', '', 'x'] };
const chip = (st) => { const [l, c, i] = STATUS[st] || [st, '', 'info']; return `<span class="chip ${c}">${icon(i, 12)}${esc(l)}</span>`; };
const isLive = () => S.server.settings.mode === 'live';

async function loadState() { S.server = await call('state'); }
async function loadLists() {
  [S.jobs, S.apps, S.companies, S.log, S.health] = await Promise.all([call('jobs:list'), call('apps:list'), call('companies:list'), call('log:list'), call('health')]);
}

// ───────── shell ─────────
function shell() {
  const needs = S.server?.counts.needsYou || 0;
  $('#nav').innerHTML = ROUTES.map(([k, l, ic]) => `<a href="#/${k}" data-route="${k}" class="${S.route === k ? 'on' : ''}">${icon(ic, 20)}<span>${l}</span>${k === 'needs' && needs ? `<em class="badge" style="font-style:normal">${needs}</em>` : ''}</a>`).join('');
  $('#pill').innerHTML = `${icon('shield', 16)}<span class="lbl">Data stays on this PC</span>`;
  const dark = document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
  $('#themeBtn').innerHTML = `${icon(dark ? 'sun' : 'moon', 20)}<span class="lbl">${dark ? 'Light mode' : 'Dark mode'}</span>`;
  const st = S.server?.status || {};
  $('#topStatus').innerHTML = S.server?.running ? `<span class="pulse"></span> ${esc(st.phase === 'applying' ? `Applying: ${st.message}` : st.phase !== 'idle' ? st.message : `Watching for jobs${st.nextRun ? ' · next check ' + inMin(st.nextRun) : ''}`)}` : `<span class="pulse off"></span> Autopilot is off`;
  $('#pageTitle').textContent = (ROUTES.find((r) => r[0] === S.route) || [])[1] || '';
}

function render() {
  if (!S.server) return;
  shell();
  const v = { today, jobs, applications, needs, profile, sources, settings, activity }[S.route] || today;
  const y = scrollY;
  $('#view').innerHTML = (isLive() && S.route !== 'settings' ? `<div class="livebar">${icon('alert', 18)} LIVE mode – applications are really being submitted.</div>` : '') + v();
  if (S.route === 'jobs') bindJobs();
  scrollTo(0, y);
}

// ───────── Today ─────────
function readiness() {
  const m = S.server.missing;
  return m.length ? `<div class="banner">${icon('alert', 18)}<div style="flex:1"><b>Before going live</b>, finish your profile: ${m.map(esc).join(' · ')}.</div><a class="btn small" href="#/profile">Complete profile</a></div>` : '';
}
function today() {
  const sv = S.server, c = sv.counts, live = isLive(), st = sv.status;
  if (!sv.profile.hasResume) return `<section class="card welcome" style="margin-top:4vh">
    <div class="drop-icon" style="margin:0 auto 14px;width:72px;height:72px;border-radius:24px;display:grid;place-items:center;background:var(--accent-soft);color:var(--accent)">${icon('file', 34)}</div>
    <h1>Start with your resume</h1><p class="lead">Job Autopilot reads your resume, watches company career pages for new openings that fit you, and applies for you – within limits you control.</p>
    <div class="dropzone" id="drop" style="margin:22px auto;max-width:520px"><b>Drop your resume PDF here</b><div class="muted small">or click to choose a file</div></div>
    <ul class="ticks"><li>Nothing is sent anywhere until you switch to Live mode</li><li>Starts in Dry-run: it fills forms and saves screenshots so you can check them first</li><li>Your resume and data stay on this PC</li></ul></section>`;
  const days = []; for (let i = 13; i >= 0; i--) { const d = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10); days.push([d, c.perDay[d] || 0]); }
  const max = Math.max(1, ...days.map((d) => d[1]));
  const top = S.jobs.filter((j) => j.decision === 'apply' && ['new', 'queued', 'dry_run'].includes(j.status)).sort((a, b) => b.score - a.score).slice(0, 5);
  return `${readiness()}
  <section class="hero jobhero ${live ? 'live' : ''}">
    <div class="hero-top"><div>
      <div class="hero-label">${icon('zap', 16)} Autopilot · ${live ? 'LIVE – submits real applications' : 'Dry run – fills forms, does not submit'}</div>
      <div class="hero-num" style="font-size:clamp(1.8rem,4vw,2.6rem)">${sv.running ? (st.phase === 'applying' ? 'Applying…' : st.phase === 'idle' ? 'Watching for jobs' : esc(st.message || 'Working…')) : 'Autopilot is off'}</div>
      <div class="hero-sub">${sv.running ? (st.phase === 'applying' ? esc(st.message) : `Checks every ${sv.settings.pollMinutes} min${st.lastRun ? ` · last check ${ago(st.lastRun)}` : ''}${st.nextRun ? ` · next ${inMin(st.nextRun)}` : ''}`) : 'Turn it on and it will find and apply to matching jobs for you.'}</div></div>
      <label class="bigswitch" title="Turn autopilot on or off"><input type="checkbox" id="autoSwitch" ${sv.running ? 'checked' : ''}><i></i></label></div>
    <div class="row gap wrap" style="margin-top:20px">
      <div class="seg" role="group" aria-label="Mode"><button data-mode="dry" class="${!live ? 'on dry' : ''}">${icon('eye', 16)} Dry run</button><button data-mode="live" class="${live ? 'on live' : ''}">${icon('send', 16)} Live</button></div>
      <button class="btn" data-act="tick" style="background:rgba(255,255,255,.16);color:#fff;border-color:rgba(255,255,255,.3)">${icon('refresh', 16)} Check now</button></div>
    <div class="hero-stats" style="grid-template-columns:repeat(4,minmax(0,1fr))">
      <div class="hero-stat"><small>${icon('send', 14)} Applied today</small><b>${c.appliedToday} / ${sv.settings.maxPerDay}</b></div>
      <div class="hero-stat"><small>${icon('check', 14)} Applied in total</small><b>${c.appliedTotal}</b></div>
      <div class="hero-stat"><small>${icon('sparkle', 14)} Matches waiting</small><b>${c.matches}</b></div>
      <div class="hero-stat"><small>${icon('alert', 14)} Needs you</small><b>${c.needsYou}</b></div></div>
  </section>
  ${!live && c.dryRuns ? `<div class="alert good">${icon('check', 18)}<div><b>${c.dryRuns} application${c.dryRuns === 1 ? '' : 's'} rehearsed</b><span>Open <a href="#/applications">Applications</a>, look at the screenshots, and when the forms look right switch to <b>Live</b>.</span></div></div>` : ''}
  <section class="grid2" style="margin-top:16px">
    <div class="card"><div class="card-head"><h2>${icon('activity', 18)} Recent activity</h2><a href="#/activity">All →</a></div>${feed(S.log.filter((l) => l.level !== 'debug').slice(-9).reverse())}</div>
    <div class="card"><div class="card-head"><h2>${icon('send', 18)} Last 14 days</h2></div><div class="bars14">${days.map(([d, n]) => `<div title="${d}: ${n}"><span class="b ${live ? '' : 'dry'}" style="height:${(n / max) * 100}%"></span><small>${d.slice(8)}</small></div>`).join('')}</div>
      <p class="muted small" style="margin-bottom:0">${c.jobsTotal.toLocaleString()} postings seen across ${c.companies} companies.</p></div>
  </section>
  <div class="card"><div class="card-head"><h2>${icon('sparkle', 18)} Best matches waiting</h2><a href="#/jobs">All jobs →</a></div>${top.length ? `<div class="joblist">${top.map(jobRow).join('')}</div>` : `<div class="empty">${icon('briefcase', 30)}<span>${c.jobsTotal ? 'No unapplied matches right now.' : 'No jobs yet – press “Check now” (the first scan takes a minute or two).'}</span></div>`}</div>`;
}
const feed = (items) => items.length ? `<ul class="feed">${items.map((l) => `<li class="${l.level}"><span class="t">${hm(l.t)}</span><span class="ic">${icon(l.level === 'error' ? 'x' : l.level === 'warn' ? 'alert' : 'check', 15)}</span><span>${esc(l.msg)}</span></li>`).join('')}</ul>` : '<p class="muted">Nothing yet.</p>';

// ───────── Jobs ─────────
function jobRow(j) {
  return `<div class="job" data-job="${esc(j.id)}">${ring(j.score)}
    <div><h3>${esc(j.title)}</h3><div class="meta"><span>${icon('building', 14)}${esc(j.company)}</span><span>${icon('pin', 14)}${esc(j.location || 'Location not stated')}</span>${j.postedAt ? `<span>${icon('clock', 14)}${ago(j.postedAt)}</span>` : ''}<span class="chip">${esc(j.ats || j.source)}</span></div>
      <div class="why">${j.reasons.slice(0, 3).map((r) => `<span class="chip tag">${esc(r)}</span>`).join('')}${j.skipReason ? `<span class="chip">${esc(j.skipReason)}</span>` : ''}</div></div>
    <div class="acts">${['applied', 'needs_you', 'dry_run'].includes(j.status) ? chip(j.status) : ''}
      ${j.status !== 'applied' ? `<button class="btn small primary" data-act="applyjob" data-id="${esc(j.id)}" ${S.busy.has(j.id) ? 'disabled' : ''}>${S.busy.has(j.id) ? '<span class="spin"></span>' : icon('send', 14)} Apply now</button>` : ''}
      <button class="icon" data-act="detail" data-id="${esc(j.id)}" title="Details" aria-label="Details">${icon('chevron', 18)}</button>
      ${j.status !== 'skipped' && j.status !== 'applied' ? `<button class="icon" data-act="skipjob" data-id="${esc(j.id)}" title="Skip" aria-label="Skip">${icon('x', 16)}</button>` : ''}</div></div>`;
}
function filteredJobs() {
  const q = S.jobQ.toLowerCase();
  const f = S.jobFilter;
  return S.jobs.filter((j) => (f === 'matches' ? j.decision === 'apply' && ['new', 'queued', 'dry_run', 'needs_you'].includes(j.status) : f === 'maybe' ? j.decision === 'maybe' && j.status === 'new' : f === 'applied' ? j.status === 'applied' : f === 'skipped' ? j.status === 'skipped' : true) && (!q || `${j.title} ${j.company} ${j.location}`.toLowerCase().includes(q))).sort((a, b) => b.score - a.score || String(b.postedAt).localeCompare(String(a.postedAt)));
}
function jobs() {
  const list = filteredJobs();
  const tabs = [['matches', 'Matches'], ['maybe', 'Maybe'], ['applied', 'Applied'], ['skipped', 'Skipped'], ['all', 'All']];
  return `<div class="page-head"><div><h1>Jobs</h1><p>${S.jobs.length.toLocaleString()} postings scored against your resume.</p></div></div>
  <div class="row between wrap" style="margin-bottom:14px;gap:10px"><nav class="tabs" style="margin:0">${tabs.map(([k, l]) => `<button class="${S.jobFilter === k ? 'on' : ''}" data-act="jobtab" data-k="${k}">${l}</button>`).join('')}</nav>
    <input class="input" id="jobq" placeholder="Search title, company, city…" value="${esc(S.jobQ)}" style="min-width:260px"></div>
  ${list.length ? `<div class="joblist">${list.slice(0, 120).map(jobRow).join('')}</div>${list.length > 120 ? `<p class="muted center">Showing the best 120 of ${list.length}.</p>` : ''}` : `<div class="card"><div class="empty">${icon('briefcase', 32)}<b>Nothing here</b><span>${S.jobs.length ? 'Try another tab or clear the search.' : 'Press “Check now” on the Today page to scan for jobs.'}</span></div></div>`}`;
}
function bindJobs() { const q = $('#jobq'); if (q) q.oninput = () => { S.jobQ = q.value; clearTimeout(bindJobs.t); bindJobs.t = setTimeout(() => { render(); const i = $('#jobq'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 200); }; }

// ───────── Applications ─────────
function applications() {
  const f = S.appFilter;
  const list = S.apps.filter((a) => !['superseded'].includes(a.status) && (f === 'all' || (f === 'done' ? ['applied', 'emailed', 'unconfirmed'].includes(a.status) : a.status === f)));
  const tabs = [['all', 'All'], ['done', 'Applied'], ['dry_run', 'Dry runs'], ['needs_you', 'Needs you'], ['failed', 'Failed']];
  return `<div class="page-head"><div><h1>Applications</h1><p>Everything the autopilot has done, with a screenshot of each form.</p></div></div>
  <nav class="tabs">${tabs.map(([k, l]) => `<button class="${f === k ? 'on' : ''}" data-act="apptab" data-k="${k}">${l}</button>`).join('')}</nav>
  <section class="card flush"><div class="table-wrap"><table class="tx"><thead><tr><th>When</th><th>Role</th><th>Status</th><th>What happened</th><th></th></tr></thead><tbody>
  ${list.map((a) => `<tr><td class="nowrap">${new Date(a.at).toLocaleDateString([], { day: 'numeric', month: 'short' })}<div class="faint xs">${hm(a.at)}</div></td><td><div class="desc">${esc(a.title)}</div><div class="faint xs">${esc(a.company)} · ${esc(a.location || '')}</div></td><td>${chip(a.status)}</td><td class="small" style="max-width:380px">${esc(a.reason)}</td><td class="acts"><button class="btn small" data-act="appdetail" data-id="${a.id}">Details</button></td></tr>`).join('') || `<tr><td colspan="5"><div class="empty">${icon('send', 30)}<span>No applications yet.</span></div></td></tr>`}
  </tbody></table></div></section>`;
}
async function appDetail(id) {
  const a = S.apps.find((x) => x.id === id); if (!a) return;
  const shot = a.screenshot ? await call('shot:read', a.screenshot) : null;
  const act = a.status === 'needs_you' ? [{ label: 'Open & finish for me…', value: 'assist', primary: true }] : [];
  const r = await modal({ wide: true, title: `${a.title} – ${a.company}`, body: `<div class="row gap wrap" style="margin-bottom:10px">${chip(a.status)}<span class="muted small">${esc(a.reason)}</span></div>
    ${a.filled?.length ? `<h4>What was filled in</h4><div class="table-wrap"><table class="tx small"><tbody>${a.filled.map((f) => `<tr><td>${esc(f.label)}</td><td>${esc(f.value)}</td><td><span class="chip ${f.source === 'claude' ? 'info' : ''}">${esc(f.source)}</span></td></tr>`).join('')}</tbody></table></div>` : ''}
    ${a.missing?.length ? `<h4>Not filled</h4><ul>${a.missing.map((m) => `<li>${esc(m.label)} – <span class="muted">${esc(m.why)}</span></li>`).join('')}</ul>` : ''}
    ${shot ? `<h4>Screenshot</h4><img class="shot" src="${shot}" alt="Form screenshot">` : ''}`,
    buttons: [{ label: 'Close', value: null }, ...(a.applyUrl ? [{ label: 'Open the page', value: 'open' }] : []), { label: 'Retry', value: 'retry' }, ...(a.status === 'needs_you' ? [{ label: 'I applied myself', value: 'done' }] : []), ...act] });
  if (r === 'open') call('open:url', a.applyUrl);
  if (r === 'retry') { toast('Retrying…'); const x = await call('app:retry', id); if (x.app) toast(`Result: ${x.app.status}`); await refresh(); }
  if (r === 'done') { await call('app:done', id); await refresh(); }
  if (r === 'assist') { toast('Opening the application for you…'); call('app:assist', id); }
}

// ───────── Needs you ─────────
function needs() {
  const list = S.apps.filter((a) => a.status === 'needs_you' && S.jobs.find((j) => j.id === a.jobId)?.status === 'needs_you');
  return `<div class="page-head"><div><h1>Needs you</h1><p>The autopilot never guesses. When it can't finish honestly – a captcha, a question only you can answer – it stops here.</p></div></div>
  ${list.map((a) => `<section class="card"><div class="card-head"><h2>${esc(a.title)} <span class="muted">· ${esc(a.company)}</span></h2><span class="chip warn">${icon('alert', 12)} ${ago(a.at)}</span></div>
    <p>${esc(a.reason)}</p>
    <div class="row gap wrap"><button class="btn primary" data-act="assist" data-id="${a.id}">${icon('external', 16)} Open &amp; finish for me</button><button class="btn" data-act="appdetail" data-id="${a.id}">See what was filled</button><button class="btn" data-act="appdone" data-id="${a.id}">${icon('check', 16)} I applied myself</button><button class="btn ghost" data-act="appdismiss" data-id="${a.id}">Dismiss</button></div></section>`).join('') || `<div class="card"><div class="empty">${icon('check', 34)}<b>All clear</b><span>Nothing is waiting on you.</span></div></div>`}
  <p class="muted small">“Open &amp; finish for me” opens the form in a window with everything already filled in – you only solve the captcha / answer the remaining question and press Submit. It is marked applied automatically.</p>`;
}

// ───────── Profile ─────────
const tagBox = (id, items, ph) => `<div class="tagbox" data-tagbox="${id}">${items.map((t, i) => `<span class="chip tag">${esc(t)}<button data-rm="${i}" aria-label="Remove">×</button></span>`).join('')}<input placeholder="${esc(ph)}" aria-label="${esc(ph)}"></div>`;
function profile() {
  const p = S.server.profile, a = p.answers || {}, miss = S.server.missing;
  const f = (k, label, ph = '', cls = '') => `<label class="field ${cls}"><span>${label}</span><input class="input" data-p="${k}" value="${esc(p[k])}" placeholder="${esc(ph)}"></label>`;
  const ans = (k, label, ph = '') => `<label class="field"><span>${label}</span><input class="input" data-a="${k}" value="${esc(a[k] || '')}" placeholder="${esc(ph)}"></label>`;
  return `<div class="page-head"><div><h1>Profile</h1><p>Read from your resume – check it, because this is exactly what gets typed into applications.</p></div></div>
  <section class="card"><div class="card-head"><h2>${icon('file', 18)} Resume</h2></div>
    ${p.hasResume ? `<div class="row between wrap"><div><b>${esc(p.resumeName)}</b><div class="muted small">Read ${p.skills.length} skills · about ${p.experienceYears} year(s) of experience</div></div><button class="btn" data-act="resume">${icon('upload', 16)} Replace resume</button></div>` : `<div class="dropzone" id="drop"><b>Drop your resume PDF here</b><div class="muted small">or click to choose a file</div></div>`}</section>
  <section class="card"><div class="card-head"><h2>${icon('check', 18)} Ready to go live?</h2></div>
    <ul class="steps">${[['Resume uploaded', p.hasResume], ['Name, email and phone', !!(p.firstName && p.lastName && p.email && p.phone)], ['Notice period answered', !!a.noticePeriod], ['Expected salary (CTC) answered', !!a.expectedCtc]].map(([l, ok]) => `<li class="${ok ? 'ok' : ''}">${icon(ok ? 'check' : 'info', 18)}${l}</li>`).join('')}</ul></section>
  <section class="card"><div class="card-head"><h2>${icon('user', 18)} About you</h2></div><div class="fields">${f('firstName', 'First name')}${f('lastName', 'Last name')}${f('email', 'Email')}${f('phone', 'Phone (10 digits)')}${f('city', 'Current city')}${f('linkedin', 'LinkedIn')}${f('github', 'GitHub')}${f('website', 'Portfolio / website')}${f('currentCompany', 'Current company')}${f('currentTitle', 'Current job title')}${f('headline', 'Headline')}
    <label class="field"><span>Years of experience</span><input class="input" data-p="experienceYears" data-num="1" value="${esc(p.experienceYears)}" inputmode="decimal"><small>Used to match jobs and to answer “years of experience” questions.</small></label></div></section>
  <section class="card"><div class="card-head"><h2>${icon('cpu', 18)} Skills</h2></div>${tagBox('skills', p.skills, 'Add a skill and press Enter')}<p class="muted small">Matching and answers only use skills listed here – nothing else is ever claimed.</p></section>
  <section class="card"><div class="card-head"><h2>${icon('mail', 18)} Answers to common questions</h2></div><div class="fields">${ans('noticePeriod', 'Notice period', 'e.g. 30 days / Immediate')}${ans('currentCtc', 'Current CTC', 'e.g. 4.5 LPA')}${ans('expectedCtc', 'Expected CTC', 'e.g. 8 LPA')}${ans('workAuthorization', 'Work authorisation')}${ans('requireSponsorship', 'Need visa sponsorship?')}${ans('willingToRelocate', 'Willing to relocate?')}${ans('howDidYouHear', 'How did you hear about us?')}</div>
    <h4 style="margin:18px 0 8px">Your own answers</h4><p class="muted small" style="margin-top:0">If a question contains the keyword, this answer is used.</p>
    <div id="extra">${(a.extra || []).map((x, i) => `<div class="row gap" style="margin-bottom:8px"><input class="input" style="width:30%" data-x="${i}" data-xk="match" value="${esc(x.match)}" placeholder="keyword in question"><input class="input grow" data-x="${i}" data-xk="answer" value="${esc(x.answer)}" placeholder="your answer"><button class="icon" data-act="xdel" data-i="${i}" aria-label="Remove">${icon('x', 16)}</button></div>`).join('')}</div>
    <button class="btn small" data-act="xadd">${icon('plus', 14)} Add</button></section>`;
}

// ───────── Sources ─────────
function sources() {
  const s = S.server.settings, h = S.health;
  const list = S.companies.slice().sort((a, b) => (b.enabled - a.enabled) || (b.relevant || 0) - (a.relevant || 0));
  return `<div class="page-head"><div><h1>Sources</h1><p>Where jobs come from. Company career boards are checked directly, so you see openings the moment they're posted.</p></div>
    <div class="row gap"><button class="btn" data-act="discover">${icon('refresh', 16)} Find more companies</button></div></div>
  <section class="card"><div class="card-head"><h2>Add a company</h2></div><form class="row gap wrap" data-form="addco"><input class="input grow" name="url" placeholder="Paste a careers link, e.g. https://jobs.lever.co/cred or https://boards.greenhouse.io/razorpay" required><button class="btn primary">${icon('plus', 16)} Add</button></form></section>
  <section class="card"><div class="card-head"><h2>Job sites &amp; feeds</h2></div><div class="fields">${[['greenhouse', 'Greenhouse boards'], ['lever', 'Lever boards'], ['ashby', 'Ashby boards'], ['workable', 'Workable boards'], ['remoteok', 'RemoteOK (remote jobs)'], ['remotive', 'Remotive (remote jobs)'], ['adzuna', 'Adzuna India (needs free API key – Settings)']].map(([k, l]) => `<label class="check"><span class="switch"><input type="checkbox" data-src="${k}" ${s.sources[k] ? 'checked' : ''}><i></i></span> ${l} ${h[k] ? (h[k].ok ? `<span class="chip good">${h[k].count} jobs</span>` : `<span class="chip bad" title="${esc(h[k].error)}">error</span>`) : ''}</label>`).join('')}</div>
    <p class="muted small">LinkedIn, Naukri and Indeed are deliberately not automated: their rules forbid bots and they ban accounts that use them.</p></section>
  <section class="card flush"><div class="table-wrap"><table class="tx"><thead><tr><th>Company board</th><th>System</th><th class="num">Openings</th><th class="num">India / remote</th><th>Status</th><th></th></tr></thead><tbody>
  ${list.map((c) => { const hh = c.health; return `<tr class="${c.enabled ? '' : 'dim'}"><td class="desc">${esc(c.name || c.token)}${c.custom ? ' <span class="chip">yours</span>' : ''}</td><td>${esc(c.ats)}</td><td class="num">${hh?.count ?? c.total ?? '–'}</td><td class="num">${c.relevant ?? '–'}</td><td>${hh ? (hh.ok ? '<span class="chip good">OK</span>' : `<span class="chip bad" title="${esc(hh.error)}">Error</span>`) : ''}</td><td class="acts nowrap"><label class="switch" style="display:inline-block;vertical-align:middle"><input type="checkbox" data-co="${esc(c.ats)}|${esc(c.token)}" ${c.enabled ? 'checked' : ''}><i></i></label><button class="icon" data-act="coremove" data-co="${esc(c.ats)}|${esc(c.token)}" aria-label="Remove">${icon('x', 16)}</button></td></tr>`; }).join('') || `<tr><td colspan="6"><div class="empty">${icon('building', 30)}<span>No companies yet – press “Find more companies”.</span></div></td></tr>`}
  </tbody></table></div></section>`;
}

// ───────── Settings ─────────
function settings() {
  const s = S.server.settings;
  const num = (k, label, hint = '', path = '') => `<label class="field"><span>${label}</span><input class="input" data-s="${k}" data-num="1" value="${esc(s[k])}" inputmode="numeric">${hint ? `<small>${hint}</small>` : ''}</label>`;
  return `<div class="page-head"><div><h1>Settings</h1><p>You are in control of how aggressive the autopilot is.</p></div></div>
  <section class="card"><div class="card-head"><h2>${icon('target', 18)} What to apply to</h2></div>
    <div class="fields"><label class="field"><span>Minimum match score</span><input class="input" data-s="minScore" data-num="1" value="${s.minScore}"><small>Only apply at or above this (0–100). Higher = pickier.</small></label>${num('maxYearsRequired', 'Max years of experience a job may ask for', 'Jobs asking for more are skipped.')}
    <label class="check" style="align-self:end"><input type="checkbox" data-sb="includeInternships" ${s.includeInternships ? 'checked' : ''}> Include internships</label><label class="check" style="align-self:end"><input type="checkbox" data-sb="acceptRemote" ${s.acceptRemote ? 'checked' : ''}> Remote jobs are fine</label><label class="check" style="align-self:end"><input type="checkbox" data-sb="acceptAnywhereInIndia" ${s.acceptAnywhereInIndia ? 'checked' : ''}> Willing to relocate within India</label></div>
    <h4 style="margin:16px 0 6px">Preferred cities</h4>${tagBox('locations', s.locations, 'Add a city')}
    <h4 style="margin:16px 0 6px">Target roles</h4>${tagBox('roles', s.roles, 'Add a role keyword')}
    <h4 style="margin:16px 0 6px">Never apply if the title contains</h4>${tagBox('excludeTitleWords', s.excludeTitleWords, 'Add a word')}</section>
  <section class="card"><div class="card-head"><h2>${icon('clock', 18)} Pace &amp; limits</h2></div><div class="fields">${num('pollMinutes', 'Check for new jobs every (minutes)')}${num('maxPerDay', 'Max applications per day')}${num('maxPerCompany', 'Max per company (60 days)')}
    <label class="field"><span>Pause between applications (seconds)</span><div class="row gap"><input class="input" data-delay="0" value="${s.delaySeconds[0]}" inputmode="numeric"><span>to</span><input class="input" data-delay="1" value="${s.delaySeconds[1]}" inputmode="numeric"></div></label>
    <label class="field"><span>Only apply between (hour of day)</span><div class="row gap"><input class="input" data-hours="from" value="${s.activeHours.from}" inputmode="numeric"><span>and</span><input class="input" data-hours="to" value="${s.activeHours.to}" inputmode="numeric"></div></label></div></section>
  <section class="card"><div class="card-head"><h2>${icon('sparkle', 18)} Claude (optional AI help)</h2></div>
    <p class="muted">With a Claude API key, the app answers screening questions and writes cover letters – using <b>only facts from your resume</b>, and it never submits an answer it isn't confident in. Without a key those are left for you.</p>
    <div class="fields"><label class="check"><span class="switch"><input type="checkbox" data-sb2="claude.enabled" ${s.claude.enabled ? 'checked' : ''}><i></i></span> Use Claude</label>
    <label class="field"><span>API key ${s.claude.hasKey ? '<span class="chip good">saved</span>' : ''}</span><input class="input" type="password" data-s2="claude.apiKey" placeholder="${s.claude.hasKey ? '•••••••• (leave blank to keep)' : 'sk-ant-…'}" autocomplete="off"></label>
    <label class="field"><span>Model</span><input class="input" data-s2="claude.model" value="${esc(s.claude.model)}"></label></div><button class="btn" data-act="testclaude" style="margin-top:10px">Test connection</button></section>
  <section class="card"><div class="card-head"><h2>${icon('mail', 18)} Email applications (optional)</h2></div>
    <p class="muted">For postings that say “email your resume to …”. Use a Gmail <b>app password</b> (not your normal password).</p>
    <div class="fields"><label class="check"><span class="switch"><input type="checkbox" data-sb2="email.enabled" ${s.email.enabled ? 'checked' : ''}><i></i></span> Send applications by email</label><label class="field"><span>SMTP server</span><input class="input" data-s2="email.host" value="${esc(s.email.host)}"></label><label class="field"><span>Port</span><input class="input" data-s2="email.port" data-num="1" value="${esc(s.email.port)}"></label><label class="field"><span>Email address</span><input class="input" data-s2="email.user" value="${esc(s.email.user)}"></label><label class="field"><span>App password ${s.email.hasPass ? '<span class="chip good">saved</span>' : ''}</span><input class="input" type="password" data-s2="email.pass" placeholder="${s.email.hasPass ? '•••••••• (leave blank to keep)' : ''}" autocomplete="off"></label></div><button class="btn" data-act="testemail" style="margin-top:10px">Test email login</button></section>
  <section class="card"><div class="card-head"><h2>Adzuna India (optional)</h2></div><p class="muted">Adds more job listings. Free keys at developer.adzuna.com.</p><div class="fields"><label class="field"><span>App ID</span><input class="input" data-s2="adzuna.appId" value="${esc(s.adzuna.appId)}"></label><label class="field"><span>App key ${s.adzuna.hasKey ? '<span class="chip good">saved</span>' : ''}</span><input class="input" type="password" data-s2="adzuna.appKey" placeholder="${s.adzuna.hasKey ? '•••••••• (leave blank to keep)' : ''}"></label></div></section>
  <section class="card"><div class="card-head"><h2>${icon('settings', 18)} This app</h2></div><div class="stack"><label class="check"><span class="switch"><input type="checkbox" data-sb="startWithWindows" ${s.startWithWindows ? 'checked' : ''}><i></i></span> Start with Windows (so the autopilot is always watching)</label><label class="check"><span class="switch"><input type="checkbox" data-sb="runInBackground" ${s.runInBackground ? 'checked' : ''}><i></i></span> Keep running in the tray when I close the window</label></div>
    <div class="row gap wrap" style="margin-top:14px"><button class="btn" data-act="opendata">Open data folder</button><button class="btn danger" data-act="reset">Clear jobs &amp; history</button></div><p class="muted small">Version ${esc(S.server.version)}</p></section>`;
}

// ───────── Activity ─────────
function activity() {
  return `<div class="page-head"><div><h1>Activity</h1><p>A complete log of what the autopilot did and why.</p></div></div><section class="card">${S.log.length ? `<ul class="feed">${S.log.slice().reverse().filter((l) => l.level !== 'debug').map((l) => `<li class="${l.level}"><span class="t">${new Date(l.t).toLocaleDateString([], { day: 'numeric', month: 'short' })}<br>${hm(l.t)}</span><span class="ic">${icon(l.level === 'error' ? 'x' : l.level === 'warn' ? 'alert' : 'check', 15)}</span><span>${esc(l.msg)}</span></li>`).join('')}</ul>` : '<p class="muted">Nothing yet.</p>'}</section>`;
}

// ───────── events ─────────
const setPath = (o, path, v) => { const ks = path.split('.'); let t = o; ks.slice(0, -1).forEach((k) => (t = t[k] ||= {})); t[ks.at(-1)] = v; };
let saveT;
const saveSettingsSoon = (over) => { clearTimeout(saveT); saveT = setTimeout(async () => { S.server.settings = await call('settings:save', over); }, 350); };
const saveProfileSoon = (p) => { clearTimeout(saveProfileSoon.t); saveProfileSoon.t = setTimeout(async () => { const r = await call('profile:save', p); S.server.profile = r; S.server.missing = (await call('state')).missing; }, 350); };

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act], [data-mode], [data-route], #themeBtn, #drop'); if (!el) return;
  if (el.id === 'themeBtn') { const d = document.documentElement; const dark = d.dataset.theme === 'dark' || (!d.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches); d.dataset.theme = dark ? 'light' : 'dark'; return shell(); }
  if (el.id === 'drop' && !e.target.closest('input')) { const r = await call('resume:choose'); return afterResume(r); }
  if (el.dataset.mode) {
    if (el.dataset.mode === 'live') {
      if (S.server.missing.length) return toast(`Finish your profile first: ${S.server.missing.join(', ')}`), (location.hash = '#/profile');
      const ok = await modal({ title: 'Switch to LIVE mode?', body: `<p>The autopilot will <b>really submit applications</b> to jobs scoring ${S.server.settings.minScore}+ (up to ${S.server.settings.maxPerDay} a day).</p><p class="muted">Tip: check a few <a href="#/applications">dry-run screenshots</a> first. You can switch back any time.</p>`, buttons: [{ label: 'Stay in Dry run', value: false }, { label: 'Go live', value: true, danger: true }] });
      if (!ok) return;
    }
    await call('engine:setMode', el.dataset.mode); await refresh(); return;
  }
  const act = el.dataset.act; const id = el.dataset.id;
  const A = {
    tick: async () => { await call('engine:tick'); toast('Checking for jobs…'); },
    jobtab: () => { S.jobFilter = el.dataset.k; render(); }, apptab: () => { S.appFilter = el.dataset.k; render(); },
    detail: async () => { const j = await call('job:detail', id); await modal({ wide: true, title: `${j.title} – ${j.company}`, body: `<div class="row gap wrap" style="margin-bottom:10px">${ring(j.score, 54)}<div><div class="muted">${esc(j.location || '')} · ${esc(j.ats || j.source)}</div><div class="row gap wrap" style="margin-top:6px">${j.reasons.map((r) => `<span class="chip tag">${esc(r)}</span>`).join('')}</div></div></div><pre class="raw" style="white-space:pre-wrap;max-height:380px">${esc((j.description || '').slice(0, 5000))}</pre>`, buttons: [{ label: 'Close', value: null }, { label: 'Open posting', value: 'open' }] }).then((r) => r === 'open' && call('open:url', j.url)); },
    applyjob: async () => {
      const live = isLive();
      if (live && !(await modal({ title: 'Apply now?', body: `<p>This submits a real application.</p>`, buttons: [{ label: 'Cancel', value: false }, { label: 'Apply', value: true, primary: true }] }))) return;
      S.busy.add(id); render(); const r = await call('job:apply', { id, mode: S.server.settings.mode }); S.busy.delete(id);
      toast(r.ok ? `${r.app.status === 'dry_run' ? 'Dry run done' : r.app.status}: ${r.app.reason}` : r.error); await refresh();
    },
    skipjob: async () => { await call('job:skip', id); await refresh(); },
    appdetail: () => appDetail(id), assist: () => { toast('Opening the application for you…'); call('app:assist', id); },
    appdone: async () => { await call('app:done', id); await refresh(); }, appdismiss: async () => { await call('app:dismiss', id); await refresh(); },
    resume: async () => afterResume(await call('resume:choose')),
    xadd: async () => { const a = S.server.profile.answers; a.extra = [...(a.extra || []), { match: '', answer: '' }]; await call('profile:save', { answers: { extra: a.extra } }); render(); },
    xdel: async () => { const a = S.server.profile.answers; a.extra.splice(+el.dataset.i, 1); await call('profile:save', { answers: { extra: a.extra } }); render(); },
    discover: async () => { await call('companies:discover'); toast('Scanning company boards in the background…'); },
    coremove: async () => { const [ats, token] = el.dataset.co.split('|'); await call('companies:remove', { ats, token }); await refresh(); },
    testclaude: async () => { toast('Testing…'); const r = await call('test:claude'); toast(r.ok ? 'Claude is connected ✓' : `Claude error: ${r.error}`, 7000); },
    testemail: async () => { toast('Testing…'); const r = await call('test:email'); toast(r.ok ? 'Email login works ✓' : `Email error: ${r.error}`, 7000); },
    opendata: () => call('open:data'),
    reset: async () => { if (await modal({ title: 'Clear jobs & history?', body: '<p>Your profile and settings stay. Jobs, applications and the log are removed.</p>', buttons: [{ label: 'Cancel', value: false }, { label: 'Clear', value: true, danger: true }] })) { await call('data:reset'); await refresh(); } },
  };
  if (A[act]) A[act]();
});
async function afterResume(r) { if (r?.canceled) return; if (!r?.ok) return toast(r?.error || 'Could not read that file', 7000); toast(`Resume read ✓ – ${r.profile.skills.length} skills found. Please check your details.`); await refresh(); location.hash = '#/profile'; }

document.addEventListener('change', async (e) => {
  const t = e.target;
  if (t.id === 'autoSwitch') { await call(t.checked ? 'engine:start' : 'engine:stop'); await refresh(); return; }
  if (t.dataset.src) return saveSettingsSoon({ sources: { [t.dataset.src]: t.checked } });
  if (t.dataset.co) { const [ats, token] = t.dataset.co.split('|'); await call('companies:toggle', { ats, token, enabled: t.checked }); return refresh(); }
  if (t.dataset.sb) return saveSettingsSoon({ [t.dataset.sb]: t.checked });
  if (t.dataset.sb2) { const o = {}; setPath(o, t.dataset.sb2, t.checked); return saveSettingsSoon(o); }
});
document.addEventListener('input', (e) => {
  const t = e.target;
  const val = t.dataset.num ? (Number.isFinite(parseFloat(t.value)) ? parseFloat(t.value) : 0) : t.value;
  if (t.dataset.p) return saveProfileSoon({ [t.dataset.p]: val });
  if (t.dataset.a) return saveProfileSoon({ answers: { [t.dataset.a]: t.value } });
  if (t.dataset.xk) { const a = S.server.profile.answers; a.extra[+t.dataset.x][t.dataset.xk] = t.value; return saveProfileSoon({ answers: { extra: a.extra } }); }
  if (t.dataset.s) return saveSettingsSoon({ [t.dataset.s]: val });
  if (t.dataset.s2) { const o = {}; setPath(o, t.dataset.s2, val); return saveSettingsSoon(o); }
  if (t.dataset.delay != null) { const d = [...S.server.settings.delaySeconds]; d[+t.dataset.delay] = +t.value || 0; S.server.settings.delaySeconds = d; return saveSettingsSoon({ delaySeconds: d }); }
  if (t.dataset.hours) { const h = { ...S.server.settings.activeHours, [t.dataset.hours]: +t.value || 0 }; S.server.settings.activeHours = h; return saveSettingsSoon({ activeHours: h }); }
});
document.addEventListener('keydown', async (e) => {
  const box = e.target.closest?.('[data-tagbox]');
  if (!box || e.key !== 'Enter') return;
  e.preventDefault();
  const v = e.target.value.trim(); if (!v) return;
  const key = box.dataset.tagbox;
  const cur = key === 'skills' ? S.server.profile.skills : S.server.settings[key];
  if (cur.some((x) => x.toLowerCase() === v.toLowerCase())) return;
  const next = [...cur, v];
  if (key === 'skills') { S.server.profile.skills = next; await call('profile:save', { skills: next }); } else { S.server.settings[key] = next; S.server.settings = await call('settings:save', { [key]: next }); }
  render();
});
document.addEventListener('click', async (e) => {
  const rm = e.target.closest('[data-rm]'); if (!rm) return;
  const key = rm.closest('[data-tagbox]').dataset.tagbox;
  const cur = key === 'skills' ? S.server.profile.skills : S.server.settings[key];
  const next = cur.filter((_, i) => i !== +rm.dataset.rm);
  if (key === 'skills') { S.server.profile.skills = next; await call('profile:save', { skills: next }); } else { S.server.settings[key] = next; S.server.settings = await call('settings:save', { [key]: next }); }
  render();
});
document.addEventListener('submit', async (e) => {
  const f = e.target.closest('[data-form="addco"]'); if (!f) return;
  e.preventDefault();
  const r = await call('companies:add', f.url.value.trim());
  toast(r.ok ? 'Added ✓ – it will be checked on the next scan.' : r.error); if (r.ok) await refresh();
});
// drag & drop a resume anywhere on the drop zone
document.addEventListener('dragover', (e) => { if (e.target.closest('#drop')) { e.preventDefault(); e.target.closest('#drop').classList.add('over'); } });
document.addEventListener('dragleave', (e) => e.target.closest?.('#drop')?.classList.remove('over'));
document.addEventListener('drop', async (e) => { if (!e.target.closest('#drop')) return; e.preventDefault(); const f = e.dataTransfer.files[0]; if (!f) return; const p = api.pathForFile(f); afterResume(await call('resume:path', p)); });

// ───────── boot ─────────
async function refresh() { await loadState(); await loadLists(); render(); }
function route() { S.route = (location.hash.replace(/^#\//, '') || 'today').split('?')[0]; if (!ROUTES.some((r) => r[0] === S.route)) S.route = 'today'; render(); }
window.addEventListener('hashchange', route);
let soon;
const refreshSoon = () => { clearTimeout(soon); soon = setTimeout(refresh, 400); };
api.on('status', (s) => { if (S.server) { S.server.status = s; S.server.running = !!(S.server.running); } shell(); if (S.route === 'today') refreshSoon(); });
api.on('log', (l) => { S.log.push(l); if (S.log.length > 600) S.log.shift(); if (['today', 'activity'].includes(S.route)) { clearTimeout(refreshSoon.l); refreshSoon.l = setTimeout(() => render(), 250); } });
api.on('app', () => refreshSoon()); api.on('jobs', () => refreshSoon()); api.on('tick', () => refreshSoon()); api.on('profile', () => refreshSoon());
setInterval(() => { if (S.server && ['today'].includes(S.route)) shell(); }, 30000);
(async () => { await refresh(); route(); })();
