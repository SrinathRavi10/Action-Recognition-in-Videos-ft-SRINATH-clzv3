import { icon } from './icons.js';

const api = window.api;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const call = (n, p) => api.call(n, p);

const S = { server: null, jobs: [], apps: [], companies: [], log: [], health: {}, insights: null, route: 'today', jobFilter: 'matches', jobSort: 'score', jobQ: '', appFilter: 'all', pipeView: 'board', busy: new Set(), drawer: null };

const ROUTES = [
  ['today', 'Today', 'zap', 'Work'], ['jobs', 'Jobs', 'briefcase'], ['approvals', 'Approvals', 'check'], ['needs', 'Needs you', 'alert'],
  ['pipeline', 'Pipeline', 'send', 'Track'], ['insights', 'Insights', 'pie'],
  ['profile', 'Profile', 'user', 'Set up'], ['sources', 'Sources', 'building'], ['settings', 'Settings', 'sliders'], ['activity', 'Activity', 'activity'],
];
const PIPE = [['applied', 'Applied', 'send', 's1'], ['replied', 'Heard back', 'mail', 's4'], ['interview', 'Interview', 'calendar', 's3'], ['offer', 'Offer', 'sparkle', 's6'], ['rejected', 'Closed', 'x', 's0']];
const DONE = ['applied', 'unconfirmed', 'emailed'];
const stageOf = (a) => (DONE.includes(a.status) ? a.stage || 'applied' : null);
const fmtDate = (iso) => new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short' });
const fmtDateTime = (iso) => new Date(iso).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const lpa = (n) => `${(n / 1e5).toFixed(n % 1e5 === 0 ? 0 : 1)} LPA`;
const salaryChip = (j) => (j.salary ? `<span class="chip info" title="Stated in the posting">${icon('rupee', 12)}${lpa(j.salary.min)}${j.salary.max !== j.salary.min ? '–' + lpa(j.salary.max) : ''}</span>` : '');
/** tiny, safe Markdown: ## headings, - bullets, **bold** */
function md(t) {
  const lines = esc(t).split('\n'); let out = '', ul = false;
  for (const l of lines) {
    const bold = (x) => x.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    if (/^- /.test(l)) { if (!ul) { out += '<ul class="mdl">'; ul = true; } out += `<li>${bold(l.slice(2))}</li>`; continue; }
    if (ul) { out += '</ul>'; ul = false; }
    if (/^#{1,4} /.test(l)) out += `<h4>${bold(l.replace(/^#+ /, ''))}</h4>`; else if (l.trim()) out += `<p>${bold(l)}</p>`;
  }
  return out + (ul ? '</ul>' : '');
}

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
  if (S.route === 'insights') S.insights = await call('insights');
}

// ───────── shell ─────────
function shell() {
  const c = S.server?.counts || {};
  const badge = { needs: c.needsYou, approvals: c.awaiting, pipeline: c.followUps };
  let last = '';
  $('#nav').innerHTML = ROUTES.map(([k, l, ic, grp]) => { const g = grp && grp !== last ? `<div class="navgroup">${grp}</div>` : ''; if (grp) last = grp; const n = badge[k]; return `${g}<a href="#/${k}" data-route="${k}" class="${S.route === k ? 'on' : ''}">${icon(ic, 20)}<span>${l}</span>${n ? `<em class="badge ${k === 'pipeline' ? 'soft' : ''}" style="font-style:normal">${n}</em>` : ''}</a>`; }).join('');
  $('#pill').innerHTML = `${icon('shield', 16)}<span class="lbl">${S.server?.encrypted ? 'Keys encrypted on this PC' : 'Data stays on this PC'}</span>`;
  const dark = isDark();
  $('#themeBtn').innerHTML = `${icon(dark ? 'sun' : 'moon', 20)}<span class="lbl">${dark ? 'Light mode' : 'Dark mode'}</span>`;
  const st = S.server?.status || {};
  $('#topStatus').innerHTML = S.server?.running ? `<span class="pulse"></span> ${esc(st.phase === 'applying' ? `Applying: ${st.message}` : st.phase !== 'idle' ? st.message : `Watching for jobs${st.nextRun ? ' · next check ' + inMin(st.nextRun) : ''}`)}` : `<span class="pulse off"></span> Autopilot is off`;
  $('#pageTitle').textContent = (ROUTES.find((r) => r[0] === S.route) || [])[1] || '';
}
function isDark() { const d = document.documentElement; return d.dataset.theme === 'dark' || (!d.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches); }
function setTheme(t) { document.documentElement.dataset.theme = t; try { localStorage.setItem('ja-theme', t); } catch {} shell(); }
try { const t = localStorage.getItem('ja-theme'); if (t) document.documentElement.dataset.theme = t; } catch {}

function render() {
  if (!S.server) return;
  shell();
  const v = { today, jobs, approvals, needs, pipeline, insights, profile, sources, settings, activity }[S.route] || today;
  const y = scrollY;
  $('#view').innerHTML = (isLive() && !['settings', 'today'].includes(S.route) ? `<div class="livebar">${icon('alert', 18)} LIVE mode – applications are really being submitted.</div>` : '') + v();
  if (S.route === 'jobs') bindJobs();
  if (S.route === 'pipeline') bindPipeline();
  scrollTo(0, y);
}

// ───────── Today ─────────
function readiness() {
  const m = S.server.missing;
  return m.length ? `<div class="banner">${icon('alert', 18)}<div style="flex:1"><b>Before going live</b>, finish your profile: ${m.map(esc).join(' · ')}.</div><a class="btn small" href="#/profile">Complete profile</a></div>` : '';
}
function attention() {
  const c = S.server.counts, up = S.apps.filter((a) => a.interviewAt && stageOf(a) === 'interview' && new Date(a.interviewAt) > Date.now() - 36e5).sort((a, b) => new Date(a.interviewAt) - new Date(b.interviewAt))[0];
  const cards = [
    c.awaiting && ['warn', 'check', `${c.awaiting} waiting for your approval`, 'Review and approve before they are sent.', '#/approvals', 'Review'],
    c.needsYou && ['bad', 'alert', `${c.needsYou} need${c.needsYou === 1 ? 's' : ''} you`, 'A captcha or a question only you can answer.', '#/needs', 'Open'],
    up && ['good', 'calendar', `Interview: ${up.company}`, fmtDateTime(up.interviewAt), '#/pipeline', 'Prepare'],
    c.followUps && ['info', 'mail', `${c.followUps} follow-up${c.followUps === 1 ? '' : 's'} due`, 'No reply yet – a short nudge often helps.', '#/pipeline', 'See'],
  ].filter(Boolean);
  return cards.length ? `<div class="insights attn">${cards.map(([k, ic, t, sub, href]) => `<a class="insight ${k} linkcard" href="${href}"><div class="ico">${icon(ic, 20)}</div><div style="flex:1"><b>${esc(t)}</b><span>${esc(sub)}</span></div>${icon('chevron', 18)}</a>`).join('')}</div>` : '';
}
function getReady() {
  const p = S.server.profile, a = p.answers || {}, c = S.server.counts;
  const steps = [['Upload resume', p.hasResume, '#/profile'], ['Check your details', !!(p.firstName && p.lastName && p.email && p.phone), '#/profile'], ['Answer notice period & CTC', !!(a.noticePeriod && a.expectedCtc), '#/profile'], ['Rehearse in Dry run', c.dryRuns > 0 || c.appliedTotal > 0, '#/applications'], ['Go live', c.appliedTotal > 0 || isLive(), '#/today']];
  const done = steps.filter((x) => x[1]).length;
  if (done === steps.length && c.appliedTotal > 0) return '';
  return `<section class="card getready"><div class="card-head"><h2>${icon('target', 18)} Get ready</h2><span class="chip tag">${done} of ${steps.length}</span></div>
    <div class="progress"><i style="width:${(done / steps.length) * 100}%"></i></div>
    <ol class="stepper">${steps.map(([l, ok, href], i) => `<li class="${ok ? 'ok' : steps.findIndex((x) => !x[1]) === i ? 'now' : ''}"><a href="${href}"><span class="dotn">${ok ? icon('check', 14) : i + 1}</span>${esc(l)}</a></li>`).join('')}</ol></section>`;
}
function today() {
  const sv = S.server, c = sv.counts, live = isLive(), st = sv.status;
  if (!sv.profile.hasResume) return `<section class="card welcome" style="margin-top:4vh">
    <div class="drop-icon" style="margin:0 auto 14px;width:72px;height:72px;border-radius:24px;display:grid;place-items:center;background:var(--accent-soft);color:var(--accent)">${icon('file', 34)}</div>
    <h1>Start with your resume</h1><p class="lead">Job Autopilot reads your resume, watches company career pages for new openings that fit you, and applies for you – within limits you control.</p>
    <div class="dropzone" id="drop" style="margin:22px auto;max-width:520px"><b>Drop your resume PDF here</b><div class="muted small">or click to choose a file</div></div>
    <ul class="ticks"><li>Nothing is sent anywhere until you switch to Live mode</li><li>Starts in Dry-run: it fills forms and saves screenshots so you can check them first</li><li>Your resume and data stay on this PC</li></ul>
    <div class="feature-grid"><div class="feature">${icon('zap', 22)}<b>Applies within minutes</b><span>Checks company career boards every few minutes.</span></div><div class="feature">${icon('check', 22)}<b>You stay in control</b><span>Approval mode, daily limits, dry-run first.</span></div><div class="feature">${icon('send', 22)}<b>Tracks everything</b><span>Pipeline, follow-ups, interviews and insights.</span></div></div></section>`;
  const days = []; for (let i = 13; i >= 0; i--) { const d = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10); days.push([d, c.perDay[d] || 0]); }
  const max = Math.max(1, ...days.map((d) => d[1]));
  const top = S.jobs.filter((j) => j.decision === 'apply' && !j.manual && ['new', 'queued', 'dry_run'].includes(j.status)).sort((a, b) => b.score - a.score).slice(0, 5);
  const manual = S.jobs.filter((j) => j.decision === 'apply' && j.manual && j.status === 'new').sort((a, b) => b.score - a.score).slice(0, 3);
  return `${readiness()}
  <section class="hero jobhero ${live ? 'live' : ''}">
    <div class="hero-top"><div>
      <div class="hero-label">${icon('zap', 16)} Autopilot · ${live ? (sv.settings.approval ? 'LIVE – asks you before each application' : 'LIVE – submits real applications') : 'Dry run – fills forms, does not submit'}</div>
      <div class="hero-num" style="font-size:clamp(1.8rem,4vw,2.6rem)">${sv.running ? (st.phase === 'applying' ? 'Applying…' : st.phase === 'idle' ? 'Watching for jobs' : esc(st.message || 'Working…')) : 'Autopilot is off'}</div>
      <div class="hero-sub">${sv.running ? (st.phase === 'applying' ? esc(st.message) : `Checks every ${sv.settings.pollMinutes} min${st.lastRun ? ` · last check ${ago(st.lastRun)}` : ''}${st.nextRun ? ` · next ${inMin(st.nextRun)}` : ''}`) : 'Turn it on and it will find and apply to matching jobs for you.'}</div></div>
      <label class="bigswitch" title="Turn autopilot on or off"><input type="checkbox" id="autoSwitch" aria-label="Autopilot" ${sv.running ? 'checked' : ''}><i></i></label></div>
    <div class="row gap wrap" style="margin-top:20px">
      <div class="seg" role="group" aria-label="Mode"><button data-mode="dry" class="${!live ? 'on dry' : ''}">${icon('eye', 16)} Dry run</button><button data-mode="live" class="${live ? 'on live' : ''}">${icon('send', 16)} Live</button></div>
      <button class="btn" data-act="tick" style="background:rgba(255,255,255,.16);color:#fff;border-color:rgba(255,255,255,.3)">${icon('refresh', 16)} Check now</button></div>
    <div class="hero-stats" style="grid-template-columns:repeat(4,minmax(0,1fr))">
      <div class="hero-stat"><small>${icon('send', 14)} Applied today</small><b>${c.appliedToday} / ${sv.settings.maxPerDay}</b></div>
      <div class="hero-stat"><small>${icon('check', 14)} Applied in total</small><b>${c.appliedTotal}</b></div>
      <div class="hero-stat"><small>${icon('sparkle', 14)} Matches waiting</small><b>${c.matches}</b></div>
      <div class="hero-stat"><small>${icon('alert', 14)} Needs you</small><b>${c.needsYou}</b></div></div>
  </section>
  ${attention()}${getReady()}
  ${!live && c.dryRuns ? `<div class="alert good">${icon('check', 18)}<div><b>${c.dryRuns} application${c.dryRuns === 1 ? '' : 's'} rehearsed</b><span>Open <a href="#/applications">History</a>, look at the screenshots, and when the forms look right switch to <b>Live</b>.</span></div></div>` : ''}
  <section class="grid2" style="margin-top:16px">
    <div class="card"><div class="card-head"><h2>${icon('activity', 18)} Recent activity</h2><a href="#/activity">All →</a></div>${feed(S.log.filter((l) => l.level !== 'debug').slice(-9).reverse())}</div>
    <div class="card"><div class="card-head"><h2>${icon('send', 18)} Last 14 days</h2></div><div class="bars14">${days.map(([d, n]) => `<div title="${d}: ${n}"><span class="b ${live ? '' : 'dry'}" style="height:${(n / max) * 100}%"></span><small>${d.slice(8)}</small></div>`).join('')}</div>
      <p class="muted small" style="margin-bottom:0">${c.jobsTotal.toLocaleString()} postings seen across ${c.companies} companies.</p></div>
  </section>
  <div class="card"><div class="card-head"><h2>${icon('sparkle', 18)} Best matches waiting</h2><a href="#/jobs">All jobs →</a></div>${top.length ? `<div class="joblist">${top.map(jobRow).join('')}</div>` : `<div class="empty">${icon('briefcase', 30)}<span>${c.jobsTotal ? 'No unapplied matches right now.' : 'No jobs yet – press “Check now” (the first scan takes a minute or two).'}</span></div>`}</div>
  ${manual.length ? `<div class="card"><div class="card-head"><h2>${icon('external', 18)} Good matches to apply yourself</h2><span class="chip">${icon('info', 12)} these sites can't be filled automatically</span></div><div class="joblist">${manual.map(jobRow).join('')}</div></div>` : ''}`;
}
const feed = (items) => items.length ? `<ul class="feed">${items.map((l) => `<li class="${l.level}"><span class="t">${hm(l.t)}</span><span class="ic">${icon(l.level === 'error' ? 'x' : l.level === 'warn' ? 'alert' : 'check', 15)}</span><span>${esc(l.msg)}</span></li>`).join('')}</ul>` : '<p class="muted">Nothing yet.</p>';

// ───────── Jobs ─────────
function jobRow(j) {
  const done = j.status === 'applied';
  const apply = j.manual
    ? `<button class="btn small primary" data-act="openjob" data-id="${esc(j.id)}">${icon('external', 14)} Open to apply</button>${done ? '' : `<button class="btn small" data-act="manualdone" data-id="${esc(j.id)}" title="Record that you applied">${icon('check', 14)} I applied</button>`}`
    : done ? '' : j.status === 'awaiting' ? `<a class="btn small primary" href="#/approvals">Review</a>`
    : `<button class="btn small primary" data-act="applyjob" data-id="${esc(j.id)}" ${S.busy.has(j.id) ? 'disabled' : ''}>${S.busy.has(j.id) ? '<span class="spin"></span>' : icon('send', 14)} Apply now</button>`;
  return `<div class="job" data-job="${esc(j.id)}">${ring(j.score)}
    <div><h3>${esc(j.title)}</h3><div class="meta"><span>${icon('building', 14)}${esc(j.company)}</span><span>${icon('pin', 14)}${esc(j.location || 'Location not stated')}</span>${j.postedAt ? `<span>${icon('clock', 14)}${ago(j.postedAt)}</span>` : ''}<span class="chip">${esc(j.ats || j.source)}</span>${salaryChip(j)}${j.manual ? `<span class="chip warn">${icon('external', 12)}Apply yourself</span>` : ''}</div>
      <div class="why">${j.reasons.slice(0, 3).map((r) => `<span class="chip tag">${esc(r)}</span>`).join('')}${j.skipReason ? `<span class="chip">${esc(j.skipReason)}</span>` : ''}</div></div>
    <div class="acts">${['applied', 'needs_you', 'dry_run', 'awaiting'].includes(j.status) ? chip(j.status) : ''}${apply}
      <button class="icon" data-act="detail" data-id="${esc(j.id)}" title="Details" aria-label="Details">${icon('chevron', 18)}</button>
      ${j.status !== 'skipped' && !done ? `<button class="icon" data-act="likejob" data-id="${esc(j.id)}" title="More like this" aria-label="More like this">${icon('heart', 16)}</button><button class="icon" data-act="skipjob" data-id="${esc(j.id)}" title="Not for me – show fewer like this" aria-label="Not for me">${icon('x', 16)}</button>` : ''}</div></div>`;
}
function filteredJobs() {
  const q = S.jobQ.toLowerCase();
  const f = S.jobFilter;
  const list = S.jobs.filter((j) => (f === 'matches' ? j.decision === 'apply' && ['new', 'queued', 'dry_run', 'needs_you', 'awaiting'].includes(j.status) : f === 'maybe' ? j.decision === 'maybe' && j.status === 'new' : f === 'manual' ? j.manual && j.decision !== 'skip' && j.status !== 'applied' : f === 'applied' ? j.status === 'applied' : f === 'skipped' ? j.status === 'skipped' : true) && (!q || `${j.title} ${j.company} ${j.location}`.toLowerCase().includes(q)));
  return list.sort(S.jobSort === 'new' ? (a, b) => String(b.postedAt || b.firstSeen).localeCompare(String(a.postedAt || a.firstSeen)) : S.jobSort === 'pay' ? (a, b) => (b.salary?.max || 0) - (a.salary?.max || 0) : (a, b) => b.score - a.score || String(b.postedAt).localeCompare(String(a.postedAt)));
}
function jobs() {
  const list = filteredJobs();
  const tabs = [['matches', 'Matches'], ['maybe', 'Maybe'], ['manual', 'Apply yourself'], ['applied', 'Applied'], ['skipped', 'Skipped'], ['all', 'All']];
  return `<div class="page-head"><div><h1>Jobs</h1><p>${S.jobs.length.toLocaleString()} postings scored against your resume. <span class="faint">Use ♥ and ✕ to teach it what you like.</span></p></div></div>
  <div class="row between wrap" style="margin-bottom:14px;gap:10px"><nav class="tabs" style="margin:0">${tabs.map(([k, l]) => `<button class="${S.jobFilter === k ? 'on' : ''}" data-act="jobtab" data-k="${k}">${l}</button>`).join('')}</nav>
    <div class="row gap"><select id="jobsort" aria-label="Sort"><option value="score" ${S.jobSort === 'score' ? 'selected' : ''}>Best match</option><option value="new" ${S.jobSort === 'new' ? 'selected' : ''}>Newest</option><option value="pay" ${S.jobSort === 'pay' ? 'selected' : ''}>Highest pay</option></select>
    <input class="input" id="jobq" placeholder="Search title, company, city…  ( / )" value="${esc(S.jobQ)}" style="min-width:260px"></div></div>
  ${list.length ? `<div class="joblist">${list.slice(0, 120).map(jobRow).join('')}</div>${list.length > 120 ? `<p class="muted center">Showing the best 120 of ${list.length}.</p>` : ''}` : `<div class="card"><div class="empty">${icon('briefcase', 32)}<b>Nothing here</b><span>${S.jobs.length ? 'Try another tab or clear the search.' : 'Press “Check now” on the Today page to scan for jobs.'}</span></div></div>`}`;
}
function bindJobs() { const q = $('#jobq'); if (q) q.oninput = () => { S.jobQ = q.value; clearTimeout(bindJobs.t); bindJobs.t = setTimeout(() => { render(); const i = $('#jobq'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 200); }; const so = $('#jobsort'); if (so) so.onchange = () => { S.jobSort = so.value; render(); }; }

// ───────── Approvals ─────────
function approvals() {
  const list = S.jobs.filter((j) => j.status === 'awaiting').sort((a, b) => b.score - a.score);
  const on = S.server.settings.approval;
  return `<div class="page-head"><div><h1>Approvals</h1><p>In approval mode the autopilot finds and prepares jobs, but <b>nothing is sent until you say so</b>.</p></div>
    <div class="row gap"><label class="check"><span class="switch"><input type="checkbox" data-sb="approval" ${on ? 'checked' : ''}><i></i></span> Ask me before applying</label>${list.length > 1 ? `<button class="btn primary" data-act="approveall">${icon('check', 16)} Approve all ${list.length}</button>` : ''}</div></div>
  ${!on ? `<div class="alert info">${icon('info', 18)}<div><b>Approval mode is off</b><span>The autopilot applies by itself in Live mode. Turn the switch on if you'd rather review each application first. (Dry runs never need approval – nothing is sent.)</span></div></div>` : ''}
  ${list.map((j) => `<section class="card approval" data-job="${esc(j.id)}"><div class="row gap" style="align-items:flex-start">${ring(j.score, 56)}
    <div class="grow"><h2 style="font-size:1.12rem">${esc(j.title)}</h2><div class="meta muted small row gap wrap" style="margin-top:4px"><span>${icon('building', 14)} ${esc(j.company)}</span><span>${icon('pin', 14)} ${esc(j.location || 'Location not stated')}</span>${j.postedAt ? `<span>${icon('clock', 14)} ${ago(j.postedAt)}</span>` : ''}<span class="chip">${esc(j.ats || j.source)}</span>${salaryChip(j)}</div>
    <div class="why" style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap">${j.reasons.map((r) => `<span class="chip tag">${esc(r)}</span>`).join('')}</div></div></div>
    <div class="row gap wrap end" style="margin-top:16px"><button class="btn ghost" data-act="detail" data-id="${esc(j.id)}">${icon('eye', 16)} Posting</button><button class="btn" data-act="coverpreview" data-id="${esc(j.id)}">${icon('mail', 16)} Cover letter</button><button class="btn" data-act="skipjob" data-id="${esc(j.id)}">${icon('x', 16)} Reject</button><button class="btn primary" data-act="approve" data-id="${esc(j.id)}" ${S.busy.has(j.id) ? 'disabled' : ''}>${S.busy.has(j.id) ? '<span class="spin"></span>' : icon('check', 16)} Approve &amp; apply</button></div></section>`).join('') || `<div class="card"><div class="empty">${icon('check', 34)}<b>Nothing waiting</b><span>${on ? 'New matches will appear here while the autopilot is running in Live mode.' : 'Switch approval mode on to review applications before they are sent.'}</span></div></div>`}`;
}

// ───────── Pipeline & history ─────────
function pipeline() {
  const board = S.pipeView === 'board';
  const head = `<div class="page-head"><div><h1>Pipeline</h1><p>${board ? 'Drag a card to move it along. Replies found in your inbox move cards for you (if you turn that on in Settings).' : 'Everything the autopilot has done, with a screenshot of each form.'}</p></div>
    <div class="row gap"><nav class="tabs" style="margin:0"><button class="${board ? 'on' : ''}" data-act="pipeview" data-k="board">Board</button><button class="${!board ? 'on' : ''}" data-act="pipeview" data-k="history">History</button></nav><button class="btn" data-act="csv">${icon('download', 16)} Export CSV</button></div></div>`;
  return head + (board ? board_() : history());
}
function board_() {
  const apps = S.apps.filter((a) => DONE.includes(a.status));
  if (!apps.length) return `<div class="card"><div class="empty">${icon('send', 34)}<b>No applications yet</b><span>Once the autopilot (or you) applies somewhere it shows up here, and you can track replies, interviews and offers.</span></div></div>`;
  const due = apps.filter((a) => a.followUpDue);
  const col = ([k, label, ic, tok]) => { const list = apps.filter((a) => stageOf(a) === k).sort((a, b) => String(b.at).localeCompare(String(a.at)));
    return `<section class="pcol" data-stage="${k}"><header style="--tok:var(--${tok})"><span>${icon(ic, 15)} ${label}</span><em>${list.length}</em></header><div class="pcards">${list.map(pcard).join('') || `<div class="pempty">${k === 'applied' ? 'Nothing here yet' : 'Drop a card here'}</div>`}</div></section>`; };
  return `${due.length ? `<section class="card"><div class="card-head"><h2>${icon('mail', 18)} Follow up</h2><span class="chip info">${due.length} due</span></div><ul class="plainlist">${due.slice(0, 6).map((a) => `<li><div><b>${esc(a.title)}</b> <span class="muted">· ${esc(a.company)}</span><div class="faint xs">Applied ${ago(a.at)} · no reply yet</div></div><div class="row gap"><button class="btn small" data-act="followdraft" data-id="${a.id}">${icon('mail', 14)} Draft follow-up</button><button class="btn small ghost" data-act="snooze" data-id="${a.id}">Snooze 5 days</button></div></li>`).join('')}</ul></section>` : ''}
  <div class="board">${PIPE.map(col).join('')}</div>`;
}
function pcard(a) {
  const mail = a.history?.some((h) => h.source === 'email');
  return `<article class="pcard" draggable="true" data-app="${a.id}"><div class="pc-top"><b>${esc(a.company)}</b>${a.score ? `<span class="chip tag">${a.score}</span>` : ''}</div><div class="pc-title">${esc(a.title)}</div>
    <div class="pc-meta"><span>${icon('clock', 12)} ${fmtDate(a.at)}</span>${a.location ? `<span>${icon('pin', 12)} ${esc(String(a.location).split(',')[0])}</span>` : ''}</div>
    <div class="pc-chips">${a.interviewAt ? `<span class="chip good">${icon('calendar', 12)} ${fmtDateTime(a.interviewAt)}</span>` : ''}${a.followUpDue ? `<span class="chip warn">${icon('mail', 12)} Follow up</span>` : ''}${mail ? `<span class="chip info" title="${esc(a.emailEvidence?.subject || '')}">${icon('mail', 12)} from email</span>` : ''}${a.mode === 'manual' ? '<span class="chip">by you</span>' : ''}</div>
    <div class="pc-foot"><select class="mini" data-stage-for="${a.id}" aria-label="Move to">${PIPE.map(([k, l]) => `<option value="${k}" ${stageOf(a) === k ? 'selected' : ''}>${l}</option>`).join('')}</select><button class="btn small ghost" data-act="pdetail" data-id="${a.id}">Open</button></div></article>`;
}
function bindPipeline() {
  if (S.pipeView !== 'board') return;
  let drag = null;
  $$('.pcard').forEach((c) => { c.ondragstart = (e) => { drag = c.dataset.app; c.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', drag); }; c.ondragend = () => { c.classList.remove('dragging'); $$('.pcol').forEach((x) => x.classList.remove('over')); }; });
  $$('.pcol').forEach((col) => { col.ondragover = (e) => { e.preventDefault(); col.classList.add('over'); }; col.ondragleave = (e) => { if (!col.contains(e.relatedTarget)) col.classList.remove('over'); }; col.ondrop = (e) => { e.preventDefault(); col.classList.remove('over'); const id = drag || e.dataTransfer.getData('text/plain'); if (id) moveStage(id, col.dataset.stage); }; });
}
async function moveStage(id, stage) {
  const a = S.apps.find((x) => x.id === id); if (!a || stageOf(a) === stage) return;
  let interviewAt;
  if (stage === 'interview') {
    const r = await modal({ title: 'Interview scheduled?', body: `<p class="muted small">Optional – add the date and time and you can put it in your calendar.</p><input class="input" type="datetime-local" id="ivAt" value="${a.interviewAt ? a.interviewAt.slice(0, 16) : ''}">`, buttons: [{ label: 'Cancel', value: null }, { label: 'Skip date', value: () => ({}) }, { label: 'Save', value: (d) => ({ at: d.querySelector('#ivAt').value }), primary: true }] });
    if (!r) return render();
    if (r.at) interviewAt = new Date(r.at).toISOString();
  }
  await call('app:stage', { id, stage, interviewAt }); await refresh();
  toast(`Moved to ${PIPE.find((x) => x[0] === stage)[1]}`);
}
function history() {
  const f = S.appFilter;
  const list = S.apps.filter((a) => !['superseded'].includes(a.status) && (f === 'all' || (f === 'done' ? DONE.includes(a.status) : a.status === f)));
  const tabs = [['all', 'All'], ['done', 'Applied'], ['dry_run', 'Dry runs'], ['needs_you', 'Needs you'], ['failed', 'Failed']];
  return `<nav class="tabs">${tabs.map(([k, l]) => `<button class="${f === k ? 'on' : ''}" data-act="apptab" data-k="${k}">${l}</button>`).join('')}</nav>
  <section class="card flush"><div class="table-wrap"><table class="tx"><thead><tr><th>When</th><th>Role</th><th>Status</th><th>What happened</th><th></th></tr></thead><tbody>
  ${list.map((a) => `<tr><td class="nowrap">${fmtDate(a.at)}<div class="faint xs">${hm(a.at)}</div></td><td><div class="desc">${esc(a.title)}</div><div class="faint xs">${esc(a.company)} · ${esc(a.location || '')}</div></td><td>${chip(a.status)}</td><td class="small" style="max-width:380px">${esc(a.reason)}</td><td class="acts"><button class="btn small" data-act="appdetail" data-id="${a.id}">Details</button></td></tr>`).join('') || `<tr><td colspan="5"><div class="empty">${icon('send', 30)}<span>No applications yet.</span></div></td></tr>`}
  </tbody></table></div></section>`;
}
const toLocalInput = (iso) => { if (!iso) return ''; const d = new Date(iso); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
async function pipeDetail(id) {
  const a = S.apps.find((x) => x.id === id); if (!a) return;
  const hist = [{ stage: 'applied', at: a.at }, ...(a.history || [])];
  const r = await modal({ wide: true, title: `${a.title} – ${a.company}`, body: `<div class="row gap wrap" style="margin-bottom:12px">${chip(a.status)}<span class="chip tag">${PIPE.find((x) => x[0] === stageOf(a))?.[1] || ''}</span>${a.followUpDue ? `<span class="chip warn">${icon('mail', 12)} follow-up due</span>` : ''}</div>
    <div class="fields" style="grid-template-columns:1fr 1fr;margin-bottom:14px"><label class="field"><span>Stage</span><select id="pdStage">${PIPE.map(([k, l]) => `<option value="${k}" ${stageOf(a) === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="field"><span>Interview date &amp; time</span><input class="input" type="datetime-local" id="pdAt" value="${toLocalInput(a.interviewAt)}"></label></div>
    <label class="field"><span>Notes (recruiter name, salary discussed, anything)</span><textarea id="pdNote" rows="3" style="width:100%">${esc(a.notes || '')}</textarea></label>
    <h4>Timeline</h4><ol class="timeline">${hist.map((h) => `<li><b>${esc((PIPE.find((x) => x[0] === h.stage) || [0, h.stage])[1])}</b><span class="muted small"> · ${fmtDateTime(h.at)}${h.source === 'email' ? ' · found in your email' : ''}</span></li>`).join('')}</ol>
    ${a.emailEvidence ? `<p class="muted small">${icon('mail', 13)} “${esc(a.emailEvidence.subject)}” – ${esc(a.emailEvidence.from)}</p>` : ''}`,
    buttons: [{ label: 'Close', value: grab('save') }, { label: 'Interview prep', value: grab('prep') }, { label: 'Add to calendar', value: grab('ics') }, { label: 'Form & screenshot', value: grab('form') }, ...(a.applyUrl ? [{ label: 'Open posting', value: grab('open') }] : []), { label: 'Save', value: grab('save'), primary: true }] });
  if (!r) return;
  const cur = stageOf(a);
  if (r.note !== (a.notes || '')) await call('app:note', { id, note: r.note });
  const at = r.at ? new Date(r.at).toISOString() : undefined;
  if (r.stage !== cur || (r.stage === 'interview' && at && at !== a.interviewAt)) await call('app:stage', { id, stage: r.stage, interviewAt: at });
  await refresh();
  if (r.act === 'open') call('open:url', a.applyUrl);
  if (r.act === 'form') return appDetail(id);
  if (r.act === 'prep') return prepModal(id);
  if (r.act === 'ics') { const x = await call('app:ics', id); toast(x.ok ? `Saved ${x.path} – double-click it to add to your calendar` : x.canceled ? '' : x.error || 'Set an interview date first', 6000); }
}
const grab = (act) => (d) => ({ act, stage: d.querySelector('#pdStage').value, at: d.querySelector('#pdAt').value, note: d.querySelector('#pdNote').value });
async function prepModal(id) {
  toast('Preparing…', 2500);
  const p = await call('app:prep', id);
  await modal({ wide: true, title: 'Interview preparation', body: `<div class="row gap" style="margin-bottom:10px"><span class="chip ${p.source === 'claude' ? 'info' : ''}">${icon(p.source === 'claude' ? 'sparkle' : 'file', 12)} ${p.source === 'claude' ? 'Written by Claude from your resume' : 'Checklist from the posting and your skills'}</span></div><div class="prep">${md(p.text)}</div>`, buttons: [{ label: 'Copy', value: 'copy' }, { label: 'Close', value: null, primary: true }] }).then((r) => { if (r === 'copy') { navigator.clipboard?.writeText(p.text).then(() => toast('Copied')); } });
}
async function followModal(id) {
  const d = await call('app:followup:draft', id); if (!d) return;
  const r = await modal({ wide: true, title: 'Follow-up message', body: `<p class="muted small">Copy this and send it to the recruiter or the careers address${d.to ? ` (${esc(d.to)})` : ''}. ${S.server.settings.email.enabled ? '' : 'Tip: the app cannot know the recruiter’s address for form applications, so this is a draft for you to send.'}</p><label class="field"><span>Subject</span><input class="input" id="fuS" value="${esc(d.subject)}"></label><label class="field" style="margin-top:10px"><span>Message</span><textarea id="fuB" rows="10" style="width:100%">${esc(d.body)}</textarea></label>`,
    buttons: [{ label: 'Close', value: null }, { label: 'Copy', value: (dl) => ({ copy: `Subject: ${dl.querySelector('#fuS').value}\n\n${dl.querySelector('#fuB').value}` }) }, { label: 'Copy & mark as sent', value: (dl) => ({ copy: `Subject: ${dl.querySelector('#fuS').value}\n\n${dl.querySelector('#fuB').value}`, sent: true }), primary: true }] });
  if (!r) return;
  try { await navigator.clipboard.writeText(r.copy); toast('Copied to clipboard'); } catch { toast('Could not copy – select the text manually'); }
  if (r.sent) { await call('app:followup:done', id); await refresh(); }
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
  ${list.map((a) => { const qs = (a.missing || []).filter((m) => m.why === 'needs your answer' && m.label); return `<section class="card"><div class="card-head"><h2>${esc(a.title)} <span class="muted">· ${esc(a.company)}</span></h2><span class="chip warn">${icon('alert', 12)} ${ago(a.at)}</span></div>
    <p>${esc(a.reason)}</p>
    ${qs.length ? `<div class="teach"><b>${icon('sparkle', 14)} Teach it once – it will answer next time</b>${qs.slice(0, 4).map((m, i) => `<label class="field"><span>${esc(m.label)}</span><div class="row gap"><input class="input grow" data-teach="${a.id}|${i}" placeholder="Your answer"><button class="btn small primary" data-act="teach" data-id="${a.id}" data-i="${i}">Save &amp; retry</button></div></label>`).join('')}</div>` : ''}
    <div class="row gap wrap"><button class="btn primary" data-act="assist" data-id="${a.id}">${icon('external', 16)} Open &amp; finish for me</button><button class="btn" data-act="appdetail" data-id="${a.id}">See what was filled</button><button class="btn" data-act="appdone" data-id="${a.id}">${icon('check', 16)} I applied myself</button><button class="btn ghost" data-act="appdismiss" data-id="${a.id}">Dismiss</button></div></section>`; }).join('') || `<div class="card"><div class="empty">${icon('check', 34)}<b>All clear</b><span>Nothing is waiting on you.</span></div></div>`}
  <p class="muted small">“Open &amp; finish for me” opens the form in a window with everything already filled in – you only solve the captcha / answer the remaining question and press Submit. It is marked applied automatically.</p>`;
}

// ───────── Insights ─────────
const fmtWeek = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString([], { day: 'numeric', month: 'short' });
function weeklyChart(weeks) {
  const W = 620, H = 200, L = 30, B = 26, T = 10, max = Math.max(4, ...weeks.map((w) => w.applied + w.dry)), n = weeks.length, bw = (W - L) / n, y = (v) => T + (H - T - B) * (1 - v / max);
  const ticks = [0, Math.round(max / 2), max];
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Applications per week">${ticks.map((t) => `<line class="grid" x1="${L}" x2="${W}" y1="${y(t)}" y2="${y(t)}"/><text class="ax" x="${L - 6}" y="${y(t) + 4}" text-anchor="end">${t}</text>`).join('')}
    <g class="bars">${weeks.map((w, i) => { const x = L + i * bw + bw * 0.2, ww = bw * 0.6, h1 = (H - T - B) * (w.applied / max), h2 = (H - T - B) * (w.dry / max); return `<g class="bar"><title>Week of ${fmtWeek(w.week)}: ${w.applied} applied${w.dry ? `, ${w.dry} dry runs` : ''}</title><rect x="${x}" y="${H - B - h1}" width="${ww}" height="${h1}" rx="5" fill="var(--s1)"/>${w.dry ? `<rect x="${x}" y="${H - B - h1 - h2}" width="${ww}" height="${h2}" rx="5" fill="var(--s0)" opacity=".5"/>` : ''}<text class="ax" x="${x + ww / 2}" y="${H - 8}" text-anchor="middle">${fmtWeek(w.week)}</text></g>`; }).join('')}</g></svg>`;
}
function insights() {
  const I = S.insights;
  if (!I) return `<div class="page-head"><div><h1>Insights</h1></div></div><div class="card"><div class="skeleton" style="height:120px"></div></div>`;
  const t = I.totals;
  if (!t.applied && !t.matches) return `<div class="page-head"><div><h1>Insights</h1><p>What's working and what isn't.</p></div></div><div class="card"><div class="empty">${icon('pie', 34)}<b>Nothing to chart yet</b><span>After the first scan and a few applications, this page shows your response rate, which sites reply, and how match score relates to replies.</span></div></div>`;
  const kpi = (ic, label, val, sub) => `<div class="kpi"><div class="kpi-head"><span class="kpi-ic">${icon(ic, 18)}</span>${label}</div><div class="kpi-value">${val}</div><div class="kpi-sub">${sub}</div></div>`;
  const fmax = Math.max(1, I.funnel[0].n);
  const cols = ['var(--s1)', 'var(--s4)', 'var(--s3)', 'var(--s6)'];
  const enough = t.applied >= 5;
  return `<div class="page-head"><div><h1>Insights</h1><p>What's working and what isn't${enough ? '' : ' – numbers get meaningful after ~5 applications'}.</p></div></div>
  <div class="kpis">${kpi('send', 'Applications sent', t.applied, `${t.seen.toLocaleString()} postings seen · ${t.matches} matches`)}${kpi('mail', 'Heard back', `${t.responseRate}%`, `${t.responded} of ${t.applied} replied`)}${kpi('calendar', 'Interviews', t.interviews, `${t.interviewRate}% of applications`)}${kpi('sparkle', 'Offers', t.offers, t.offers ? 'Congratulations!' : 'Keep going')}</div>
  <section class="grid2"><div class="card"><div class="card-head"><h2>${icon('filter', 18)} Funnel</h2></div><ul class="hbars">${I.funnel.map((f, i) => `<li><span class="hb-name">${f.label}</span><span class="hb-track"><span class="hb-fill" style="width:${(f.n / fmax) * 100}%;background:${cols[i]}"></span></span><span class="hb-val">${f.n}</span></li>`).join('')}</ul></div>
  <div class="card"><div class="card-head"><h2>${icon('calendar', 18)} Per week</h2><div class="legend-inline"><span><i style="background:var(--s1)"></i>Applied</span><span><i style="background:var(--s0)"></i>Dry runs</span></div></div><div class="chart-wrap">${weeklyChart(I.weekly)}</div></div></section>
  <section class="grid2"><div class="card"><div class="card-head"><h2>${icon('globe', 18)} Which systems reply</h2></div>${I.bySource.length ? `<table class="tx small"><thead><tr><th>System</th><th class="num">Applied</th><th class="num">Replies</th><th style="width:34%">Reply rate</th></tr></thead><tbody>${I.bySource.map((g) => { const r = g.applied ? Math.round((g.responded / g.applied) * 100) : 0; return `<tr><td class="desc">${esc(g.name)}</td><td class="num">${g.applied}</td><td class="num">${g.responded}</td><td><div class="meter"><span style="width:${r}%"></span></div><span class="faint xs">${r}%</span></td></tr>`; }).join('')}</tbody></table>` : '<p class="muted">No applications yet.</p>'}</div>
  <div class="card"><div class="card-head"><h2>${icon('target', 18)} Match score vs replies</h2></div>${t.applied ? `<table class="tx small"><thead><tr><th>Score</th><th class="num">Applied</th><th class="num">Replies</th></tr></thead><tbody>${I.buckets.map((b) => `<tr><td class="desc">${b.label}</td><td class="num">${b.applied}</td><td class="num">${b.responded}</td></tr>`).join('')}</tbody></table><p class="muted small" style="margin:10px 0 0">${enough ? 'If higher scores reply more, raise your minimum score in Settings.' : 'Not enough data yet.'}</p>` : '<p class="muted">No applications yet.</p>'}</div></section>
  <div class="card"><div class="card-head"><h2>${icon('cpu', 18)} Skills employers ask for in your matches</h2></div>${I.topSkills.length ? `<ul class="hbars">${I.topSkills.map((k, i) => `<li><span class="hb-name">${esc(k.name)}</span><span class="hb-track"><span class="hb-fill" style="width:${(k.n / I.topSkills[0].n) * 100}%;background:var(--s1)"></span></span><span class="hb-val">${k.n}</span></li>`).join('')}</ul>` : '<p class="muted">Appears after the first scan.</p>'}</div>`;
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
  <section class="card"><div class="card-head"><h2>${icon('shield', 18)} Safety &amp; quality</h2></div>
    <div class="stack"><label class="check"><span class="switch"><input type="checkbox" data-sb="approval" ${s.approval ? 'checked' : ''}><i></i></span> Ask me before applying in Live mode <span class="muted small">(queues applications under Approvals)</span></label>
    <label class="check"><span class="switch"><input type="checkbox" data-sb="notifyManual" ${s.notifyManual ? 'checked' : ''}><i></i></span> Tell me about good matches on sites the app can't fill (SmartRecruiters, Workday…)</label></div>
    <div class="fields" style="margin-top:14px">${num('maxAgeDays', 'Ignore postings older than (days)', 'Old postings are usually filled or fake.')}${num('followUpDays', 'Suggest a follow-up after (days)', 'If nobody has replied.')}</div></section>
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
  <section class="card"><div class="card-head"><h2>${icon('mail', 18)} Read replies from your inbox (optional)</h2></div>
    <p class="muted">The app looks for interview invitations, offers and rejections and moves your applications along the Pipeline. It only <b>reads</b> mail (IMAP, last 30 days) on this PC and stores nothing but the status. Use an <b>app password</b>.</p>
    <div class="fields"><label class="check"><span class="switch"><input type="checkbox" data-sb2="inbox.enabled" ${s.inbox.enabled ? 'checked' : ''}><i></i></span> Check my inbox every 30 minutes</label><label class="field"><span>IMAP server</span><input class="input" data-s2="inbox.host" value="${esc(s.inbox.host)}"></label><label class="field"><span>Port</span><input class="input" data-s2="inbox.port" data-num="1" value="${esc(s.inbox.port)}"></label><label class="field"><span>Email address</span><input class="input" data-s2="inbox.user" value="${esc(s.inbox.user)}"></label><label class="field"><span>App password ${s.inbox.hasPass ? '<span class="chip good">saved</span>' : ''}</span><input class="input" type="password" data-s2="inbox.pass" placeholder="${s.inbox.hasPass ? '•••••••• (leave blank to keep)' : ''}" autocomplete="off"></label></div><button class="btn" data-act="testinbox" style="margin-top:10px">Check now</button></section>
  <section class="card"><div class="card-head"><h2>Adzuna India (optional)</h2></div><p class="muted">Adds more job listings. Free keys at developer.adzuna.com.</p><div class="fields"><label class="field"><span>App ID</span><input class="input" data-s2="adzuna.appId" value="${esc(s.adzuna.appId)}"></label><label class="field"><span>App key ${s.adzuna.hasKey ? '<span class="chip good">saved</span>' : ''}</span><input class="input" type="password" data-s2="adzuna.appKey" placeholder="${s.adzuna.hasKey ? '•••••••• (leave blank to keep)' : ''}"></label></div></section>
  <section class="card"><div class="card-head"><h2>${icon('settings', 18)} This app</h2></div><div class="stack"><label class="check"><span class="switch"><input type="checkbox" data-sb="startWithWindows" ${s.startWithWindows ? 'checked' : ''}><i></i></span> Start with Windows (so the autopilot is always watching)</label><label class="check"><span class="switch"><input type="checkbox" data-sb="runInBackground" ${s.runInBackground ? 'checked' : ''}><i></i></span> Keep running in the tray when I close the window</label></div>
    <div class="row gap wrap" style="margin-top:14px"><button class="btn" data-act="opendata">Open data folder</button><button class="btn" data-act="csv">${icon('download', 16)} Export applications (CSV)</button><button class="btn" data-act="diag">${icon('file', 16)} Save a problem report</button><button class="btn danger" data-act="reset">Clear jobs &amp; history</button></div><p class="muted small">Version ${esc(S.server.version)} · ${S.server.encrypted ? 'API keys and passwords are encrypted with your Windows account.' : 'Encryption of saved keys is not available on this system.'}</p></section>`;
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
  if (el.id === 'themeBtn') return setTheme(isDark() ? 'light' : 'dark');
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
    skipjob: async () => { await call('job:skip', id); toast('Skipped – I’ll show fewer jobs like this.', 2500); await refresh(); },
    likejob: async () => { await call('job:feedback', { id, verdict: 'up' }); toast('Noted – more jobs like this will score higher.', 2500); await refresh(); },
    openjob: () => { const j = S.jobs.find((x) => x.id === id); if (j) call('open:url', j.url); },
    manualdone: async () => { await call('job:manualApplied', id); toast('Recorded in your pipeline ✓'); await refresh(); },
    approve: async () => { if (S.busy.has(id)) return; S.busy.add(id); render(); const r = await call('job:approve', id); S.busy.delete(id); toast(r.ok ? `${r.app.status === 'applied' ? 'Applied ✓' : r.app.status}: ${r.app.reason}` : r.error, 6000); await refresh(); },
    approveall: async () => {
      const list = S.jobs.filter((j) => j.status === 'awaiting');
      if (!(await modal({ title: `Approve all ${list.length}?`, body: `<p>This submits ${list.length} real applications, one after another.</p>`, buttons: [{ label: 'Cancel', value: false }, { label: 'Approve all', value: true, primary: true }] }))) return;
      let n = 0; for (const j of list) { toast(`Applying ${++n} of ${list.length}: ${j.company}…`, 60000); S.busy.add(j.id); render(); await call('job:approve', j.id); S.busy.delete(j.id); }
      toast(`Done – ${list.length} processed`); await refresh();
    },
    coverpreview: async () => { toast('Writing the cover letter…', 2500); const t = await call('cover:preview', id); await modal({ wide: true, title: 'Cover letter preview', body: `<pre class="raw" style="white-space:pre-wrap;max-height:380px">${esc(t || '')}</pre><p class="muted small">Used only when the application form has a cover-letter field (or for email applications).</p>`, buttons: [{ label: 'Close', value: null, primary: true }] }); },
    teach: async () => {
      const a = S.apps.find((x) => x.id === id); const m = (a.missing || []).filter((q) => q.why === 'needs your answer' && q.label)[+el.dataset.i];
      const input = $(`[data-teach="${id}|${el.dataset.i}"]`); const v = input.value.trim(); if (!v) return toast('Type your answer first');
      await call('answer:save', { match: m.label, answer: v }); toast('Saved – retrying the application…'); const x = await call('app:retry', id); toast(x.app ? `Result: ${x.app.status} – ${x.app.reason}` : 'Retried', 7000); await refresh();
    },
    pipeview: () => { S.pipeView = el.dataset.k; render(); },
    pdetail: () => pipeDetail(id),
    followdraft: () => followModal(id),
    snooze: async () => { await call('app:snooze', id); toast('Snoozed for 5 days'); await refresh(); },
    csv: async () => { const r = await call('apps:csv'); if (r.ok) toast(`Saved ${r.path}`, 6000); },
    diag: async () => { const r = await call('diag:export'); if (r.ok) toast(`Saved ${r.path} – send it to whoever is helping you`, 7000); },
    testinbox: async () => { toast('Checking your inbox…', 20000); const r = await call('inbox:test'); toast(r.ok ? `Inbox works ✓ – looked at ${r.checked} recent emails, updated ${r.updated} application(s)` : `Inbox error: ${r.error}`, 8000); await refresh(); },
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
  if (t.dataset.stageFor) return moveStage(t.dataset.stageFor, t.value);
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

// ───────── command palette (Ctrl/⌘+K) ─────────
const palette = { items: [], i: 0 };
function paletteItems() {
  const go = ROUTES.map(([k, l, ic]) => ({ g: 'Go to', label: l, ic, run: () => { location.hash = `#/${k}`; } }));
  const act = [
    { g: 'Do', label: S.server?.running ? 'Pause autopilot' : 'Start autopilot', ic: S.server?.running ? 'pause' : 'play', run: async () => { await call(S.server.running ? 'engine:stop' : 'engine:start'); await refresh(); } },
    { g: 'Do', label: 'Check for new jobs now', ic: 'refresh', run: async () => { await call('engine:tick'); toast('Checking for jobs…'); } },
    { g: 'Do', label: isLive() ? 'Switch to Dry run' : 'Switch to Live…', ic: 'send', run: () => { location.hash = '#/today'; setTimeout(() => $(`[data-mode="${isLive() ? 'dry' : 'live'}"]`)?.click(), 50); } },
    { g: 'Do', label: isDark() ? 'Light mode' : 'Dark mode', ic: isDark() ? 'sun' : 'moon', run: () => setTheme(isDark() ? 'light' : 'dark') },
    { g: 'Do', label: 'Export applications (CSV)', ic: 'download', run: () => call('apps:csv').then((r) => r.ok && toast(`Saved ${r.path}`)) },
  ];
  const jobs = S.jobs.filter((j) => j.decision !== 'skip').sort((a, b) => b.score - a.score).slice(0, 60).map((j) => ({ g: 'Jobs', label: `${j.title} – ${j.company}`, ic: 'briefcase', hint: String(j.score), run: () => { S.jobQ = j.title; S.jobFilter = 'all'; location.hash = '#/jobs'; render(); } }));
  return [...go, ...act, ...jobs];
}
function openPalette() {
  const el = $('#palette'); if (!el) return;
  palette.items = paletteItems(); palette.i = 0; el.hidden = false;
  el.innerHTML = `<div class="palette-box" role="dialog" aria-label="Command palette"><input id="pq" placeholder="Jump to a page, run an action or find a job…" autocomplete="off"><div class="palette-list" id="plist"></div><div class="palette-foot"><span><kbd>↑</kbd> <kbd>↓</kbd> move</span><span><kbd>Enter</kbd> run</span><span><kbd>Esc</kbd> close</span></div></div>`;
  const draw = () => {
    const q = $('#pq').value.toLowerCase().trim();
    const shown = palette.items.filter((x) => !q || x.label.toLowerCase().includes(q)).slice(0, 14); palette.shown = shown; palette.i = Math.min(palette.i, Math.max(0, shown.length - 1));
    let last = ''; $('#plist').innerHTML = shown.map((x, i) => { const g = x.g !== last ? `<div class="palette-group">${x.g}</div>` : ''; last = x.g; return `${g}<div class="palette-item ${i === palette.i ? 'on' : ''}" data-pi="${i}">${icon(x.ic, 18)}<span>${esc(x.label)}</span>${x.hint ? `<small>${esc(x.hint)}</small>` : ''}</div>`; }).join('') || '<div class="empty">No matches</div>';
  };
  const run = (i) => { const x = palette.shown[i]; closePalette(); x?.run(); };
  $('#pq').oninput = draw; draw(); $('#pq').focus();
  $('#pq').onkeydown = (e) => { if (e.key === 'ArrowDown') { palette.i = Math.min(palette.i + 1, palette.shown.length - 1); e.preventDefault(); draw(); } else if (e.key === 'ArrowUp') { palette.i = Math.max(0, palette.i - 1); e.preventDefault(); draw(); } else if (e.key === 'Enter') run(palette.i); };
  $('#plist').onclick = (e) => { const it = e.target.closest('[data-pi]'); if (it) run(+it.dataset.pi); };
  el.onclick = (e) => { if (e.target === el) closePalette(); };
}
function closePalette() { const el = $('#palette'); if (el) { el.hidden = true; el.innerHTML = ''; } }
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); return $('#palette')?.hidden === false ? closePalette() : openPalette(); }
  if (e.key === 'Escape' && $('#palette')?.hidden === false) return closePalette();
  if (e.key === '/' && S.route === 'jobs' && !/input|textarea|select/i.test(e.target.tagName)) { e.preventDefault(); $('#jobq')?.focus(); }
});
document.addEventListener('click', (e) => { if (e.target.closest('#searchBtn')) openPalette(); });

// ───────── boot ─────────
async function refresh() { await loadState(); await loadLists(); render(); }
async function route() {
  let r = (location.hash.replace(/^#\//, '') || 'today').split('?')[0];
  if (r === 'applications') { r = 'pipeline'; S.pipeView = 'history'; }
  S.route = ROUTES.some((x) => x[0] === r) ? r : 'today';
  render();
  if (S.server) { await loadState(); await loadLists(); }   // always show fresh data when you open a page
  render();
}
window.addEventListener('hashchange', route);
let soon;
const refreshSoon = () => { clearTimeout(soon); soon = setTimeout(refresh, 400); };
api.on('status', (s) => { if (S.server) { S.server.status = s; S.server.running = !!(S.server.running); } shell(); if (S.route === 'today') refreshSoon(); });
api.on('log', (l) => { S.log.push(l); if (S.log.length > 600) S.log.shift(); if (['today', 'activity'].includes(S.route)) { clearTimeout(refreshSoon.l); refreshSoon.l = setTimeout(() => render(), 250); } });
api.on('goto', (r) => { location.hash = `#/${r}`; });
api.on('app', () => refreshSoon()); api.on('jobs', () => refreshSoon()); api.on('tick', () => refreshSoon()); api.on('profile', () => refreshSoon());
setInterval(() => { if (S.server && ['today'].includes(S.route)) shell(); }, 30000);
(async () => { await refresh(); route(); })();
