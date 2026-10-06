// Learns from what the user approves / rejects, and nudges future scores (never by more than ±12 points).
import { norm } from './util.js';

const STOP = new Set(['engineer', 'developer', 'and', 'the', 'for', 'of', 'a', 'in', 'at', 'with', 'to', 'i', 'ii', 'iii', 'new', 'team', 'remote', 'india', 'hybrid', 'full', 'time', 'ml']);
const MAX = 12;

export function featuresOf(job) {
  const f = new Set();
  for (const w of norm(job.title).split(' ')) if (w.length > 2 && !STOP.has(w)) f.add(`t:${w}`);
  if (job.company) f.add(`c:${norm(job.company)}`);
  if (job.department) f.add(`d:${norm(job.department)}`);
  return [...f];
}

/** learn = { f: { feature: [positives, negatives] }, n: total } – mutated in place. */
export function record(learn, job, verdict) {
  learn.f ||= {}; learn.n = (learn.n || 0) + 1;
  for (const k of featuresOf(job)) { const e = (learn.f[k] ||= [0, 0]); e[verdict === 'up' ? 0 : 1] += 1; }
}

export function adjust(learn, job) {
  if (!learn?.f || (learn.n || 0) < 3) return { points: 0, why: null };
  let sum = 0; const hits = [];
  for (const k of featuresOf(job)) {
    const e = learn.f[k]; if (!e) continue;
    const v = (e[0] - e[1]) / (e[0] + e[1] + 2);
    const w = k.startsWith('c:') ? 5 : k.startsWith('t:') ? 4 : 2;
    sum += v * w; if (Math.abs(v) > 0.2) hits.push([k.slice(2), v]);
  }
  const points = Math.max(-MAX, Math.min(MAX, Math.round(sum)));
  if (!points) return { points: 0, why: null };
  hits.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  const names = hits.slice(0, 2).map((h) => h[0]).join(', ');
  return { points, why: `${points > 0 ? 'Similar to jobs you approved' : 'Similar to jobs you rejected'}${names ? ` (${names})` : ''}` };
}
