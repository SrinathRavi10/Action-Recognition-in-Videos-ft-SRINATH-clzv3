// What happens after applying: stages, follow-ups, interview calendar entries and the numbers behind the Insights screen.
export const DONE = ['applied', 'unconfirmed', 'emailed'];
export const STAGES = ['applied', 'replied', 'interview', 'offer', 'rejected'];
export const isDone = (a) => DONE.includes(a.status);
export const stageOf = (a) => (isDone(a) ? a.stage || 'applied' : null);
const DAY = 864e5;

/** Applications that deserve a polite nudge: applied, no reply, `days` old, not already nudged. */
export function followUps(apps, { days = 7, now = Date.now() } = {}) {
  return apps.filter((a) => isDone(a) && stageOf(a) === 'applied' && !a.followedUpAt && now - new Date(a.at) >= days * DAY && !(a.snoozeUntil && new Date(a.snoozeUntil) > now));
}

export function followUpEmail(profile, app) {
  const who = profile.fullName || `${profile.firstName} ${profile.lastName}`.trim();
  const when = new Date(app.at).toLocaleDateString('en-IN', { day: 'numeric', month: 'long' });
  return {
    subject: `Following up – ${app.title} application (${who})`,
    body: `Hello ${app.company} team,\n\nI applied for the ${app.title} role on ${when} and wanted to check whether there is any update on my application. I remain very interested and would be glad to share anything further that would help.\n\nThank you for your time.\n\nRegards,\n${who}\n${profile.phone || ''}\n${profile.email || ''}`.trim(),
  };
}

const p2 = (n) => String(n).padStart(2, '0');
const icsDate = (d) => `${d.getUTCFullYear()}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}T${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}00Z`;
const icsEsc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, (c) => `\\${c}`);

/** An .ics calendar entry for an interview (opens in Outlook / Google / Apple Calendar). */
export function interviewIcs(app, { minutes = 60 } = {}) {
  if (!app.interviewAt) return null;
  const start = new Date(app.interviewAt); if (Number.isNaN(+start)) return null;
  const end = new Date(+start + minutes * 60000);
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Job Autopilot//EN', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT', `UID:${app.id}@jobautopilot`, `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(start)}`, `DTEND:${icsDate(end)}`, `SUMMARY:${icsEsc(`Interview – ${app.company} (${app.title})`)}`, `DESCRIPTION:${icsEsc(app.notes || 'Added by Job Autopilot')}`, app.applyUrl ? `URL:${app.applyUrl}` : '', 'BEGIN:VALARM', 'TRIGGER:-PT30M', 'ACTION:DISPLAY', 'DESCRIPTION:Interview soon', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].filter(Boolean).join('\r\n');
}

const weekStart = (d) => { const x = new Date(d); x.setUTCHours(0, 0, 0, 0); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x.toISOString().slice(0, 10); };
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

/** Everything the Insights screen needs. */
export function analytics(apps, jobs, { now = Date.now(), weeks = 8 } = {}) {
  const done = apps.filter(isDone);
  const stages = { applied: 0, replied: 0, interview: 0, offer: 0, rejected: 0 };
  for (const a of done) stages[stageOf(a)]++;
  const responded = done.filter((a) => ['replied', 'interview', 'offer', 'rejected'].includes(stageOf(a))).length;
  const interviews = done.filter((a) => ['interview', 'offer'].includes(stageOf(a)) || a.hadInterview).length;
  const offers = done.filter((a) => stageOf(a) === 'offer').length;

  const weekly = [];
  const cur = new Date(weekStart(now) + 'T00:00:00Z');
  for (let i = weeks - 1; i >= 0; i--) { const d = new Date(+cur - i * 7 * DAY).toISOString().slice(0, 10); weekly.push({ week: d, applied: 0, dry: 0 }); }
  const idx = Object.fromEntries(weekly.map((w, i) => [w.week, i]));
  for (const a of apps) { const k = idx[weekStart(a.at)]; if (k == null) continue; if (isDone(a)) weekly[k].applied++; else if (a.status === 'dry_run') weekly[k].dry++; }

  const group = (key) => { const m = {}; for (const a of done) { const k = a[key] || 'other'; const g = (m[k] ||= { name: k, applied: 0, responded: 0 }); g.applied++; if (['replied', 'interview', 'offer', 'rejected'].includes(stageOf(a))) g.responded++; } return Object.values(m).sort((a, b) => b.applied - a.applied); };
  const buckets = [['45–59', 45, 59], ['60–69', 60, 69], ['70–79', 70, 79], ['80+', 80, 101]].map(([label, lo, hi]) => { const g = done.filter((a) => a.score >= lo && a.score <= hi); return { label, applied: g.length, responded: g.filter((a) => ['replied', 'interview', 'offer', 'rejected'].includes(stageOf(a))).length }; });
  const needsYou = apps.filter((a) => a.status === 'needs_you').length;
  const scores = Object.values(jobs).filter((j) => j.eval?.decision === 'apply').map((j) => j.eval.score);
  const skillCount = {};
  for (const j of Object.values(jobs)) if (j.eval && j.eval.decision !== 'skip') for (const s of j.eval.matchedSkills || []) skillCount[s] = (skillCount[s] || 0) + 1;
  const topSkills = Object.entries(skillCount).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, n]) => ({ name, n }));
  return {
    totals: { applied: done.length, responded, interviews, offers, needsYou, responseRate: pct(responded, done.length), interviewRate: pct(interviews, done.length), seen: Object.keys(jobs).length, matches: scores.length, avgScore: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0 },
    stages, weekly, bySource: group('ats'), buckets, topSkills,
    funnel: [{ label: 'Applied', n: done.length }, { label: 'Heard back', n: responded }, { label: 'Interview', n: interviews }, { label: 'Offer', n: offers }],
  };
}

const csvCell = (v) => { const t = String(v ?? ''); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
/** Complete audit trail of what was submitted, as CSV (opens in Excel). */
export function appsCsv(apps) {
  const head = ['Date', 'Company', 'Title', 'Location', 'Result', 'Stage', 'Match score', 'Mode', 'Site', 'Link', 'Note', 'What was filled'];
  const rows = apps.filter((a) => a.status !== 'superseded').map((a) => [a.at, a.company, a.title, a.location, a.status, a.stage || '', a.score ?? '', a.mode, a.ats || '', a.applyUrl || a.url, a.reason, (a.filled || []).map((f) => `${f.label}=${f.value}`).join('; ')]);
  return '\ufeff' + [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
}
