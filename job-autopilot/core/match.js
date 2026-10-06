// Eligibility + scoring: should this job be applied to, and why?
import { norm } from './util.js';
import { SKILLS } from './resume.js';
import { compareSalary, fmtLpa, ageDays } from './quality.js';
import { adjust } from './learn.js';

const INDIA_CITIES = ['india', 'chennai', 'bengaluru', 'bangalore', 'hyderabad', 'pune', 'mumbai', 'navi mumbai', 'delhi', 'new delhi', 'gurgaon', 'gurugram', 'noida', 'ghaziabad', 'kochi', 'cochin', 'coimbatore', 'kolkata', 'ahmedabad', 'jaipur', 'chandigarh', 'trivandrum', 'thiruvananthapuram', 'madurai', 'mysuru', 'mysore', 'indore', 'nagpur', 'vadodara', 'bhubaneswar', 'mohali', 'lucknow', 'remote - india', 'india remote'];
const NOT_INDIA = ['united states', 'usa', ' us ', 'u.s.', 'canada', 'united kingdom', ' uk ', 'germany', 'france', 'netherlands', 'ireland', 'spain', 'poland', 'australia', 'singapore', 'dubai', 'uae', 'brazil', 'mexico', 'israel', 'japan', 'emea', 'europe', 'latam', 'north america', 'new york', 'san francisco', 'london', 'berlin', 'toronto'];
const GLOBAL_REMOTE = ['worldwide', 'anywhere', 'global', 'apac', 'asia', 'work from anywhere', 'any location'];

export function locationInfo(job, settings) {
  const raw = [job.location, ...(job.locations || [])].filter(Boolean).join(' | ');
  const t = ` ${norm(raw)} `;
  const remote = job.remote === true || /\bremote\b|work from home|wfh/.test(t);
  const inIndia = INDIA_CITIES.some((c) => t.includes(` ${c} `) || t.includes(` ${c},`) || t.includes(` ${c}|`));
  const foreignOnly = NOT_INDIA.some((c) => t.includes(c)) && !inIndia;
  const globalRemote = remote && GLOBAL_REMOTE.some((c) => t.includes(c));
  const preferred = (settings.locations || []).some((c) => t.includes(norm(c)));
  return { raw, remote, inIndia, foreignOnly, globalRemote, preferred, unknown: !raw.trim() };
}

const ROLE_STRONG = ['machine learning', 'ml engineer', 'ai engineer', 'ai/ml', 'aiml', 'ai ml', 'data scientist', 'generative ai', 'gen ai', 'genai', 'llm', 'nlp', 'computer vision', 'deep learning', 'applied scientist', 'research engineer', 'artificial intelligence', 'mlops', 'prompt engineer', 'agentic'];
const ROLE_MEDIUM = ['data analyst', 'data engineer', 'automation engineer', 'rpa', 'python developer', 'python engineer', 'analytics engineer', 'business intelligence', 'bi developer', 'software engineer - ai', 'software engineer (ai', 'ai developer', 'ml developer', 'data science'];
const ROLE_WEAK = ['software engineer', 'software developer', 'backend engineer', 'sde', 'full stack', 'analyst'];
const OFF_TOPIC = ['sales', 'marketing', 'recruit', 'talent', 'account executive', 'customer success', 'support specialist', 'finance', 'accountant', 'legal', 'counsel', 'designer', 'ux ', 'hr ', 'human resources', 'operations manager', 'nurse', 'driver', 'warehouse', 'content writer', 'copywriter', 'seo', 'social media', 'business development', 'partnerships', 'procurement', 'payroll'];

/** Lowest number of years of experience a posting asks for (null if it does not say). */
export function requiredYears(text) {
  const t = String(text || '').toLowerCase().replace(/[–—]/g, '-');
  const hits = [];
  for (const m of t.matchAll(/(\d{1,2})\s*(?:\+|plus)?\s*(?:-|to)?\s*(\d{1,2})?\s*(?:\+)?\s*(?:years?|yrs?)(?:\s+of)?(?:\s+(?:relevant|professional|hands-on|industry|work|total|overall))?\s*(?:experience|exp)?/g)) {
    const around = t.slice(Math.max(0, m.index - 60), m.index + m[0].length + 40);
    if (!/experience|exp\b|working|industry|background|track record/.test(around)) continue;
    const lo = +m[1];
    if (lo > 25) continue;
    hits.push(lo);
  }
  if (/\b(fresher|freshers|new grad|new graduate|entry[- ]level|recent graduate|graduate program|0-1 year|0-2 years?)\b/.test(t)) hits.push(0);
  return hits.length ? Math.min(...hits) : null;
}

const skillRegexes = SKILLS.map(([name, src]) => [name, new RegExp(src.startsWith('(?<') ? src : `\\b(?:${src})`, 'i')]);
export function skillsIn(text) { const t = String(text || ''); return skillRegexes.filter(([n, re]) => n !== 'R' && re.test(t)).map(([n]) => n); }

/**
 * @returns {{score:number, decision:'apply'|'maybe'|'skip', reasons:string[], skipReason?:string, matchedSkills:string[]}}
 */
export function evaluate(job, profile, settings, learn = null) {
  const reasons = [];
  const title = norm(job.title);
  const desc = String(job.description || '');
  const skip = (why) => ({ score: 0, decision: 'skip', reasons: [why], skipReason: why, matchedSkills: [] });

  // 1) hard exclusions
  const bad = (settings.excludeTitleWords || []).find((w) => ` ${title} `.includes(` ${norm(w)}`) || title.startsWith(norm(w)));
  if (bad) return skip(`Seniority/level excluded (“${bad.trim()}”)`);
  if (/\bintern(ship)?\b|\btrainee\b/.test(title) && !settings.includeInternships) return skip('Internship (turned off in settings)');
  if (OFF_TOPIC.some((w) => ` ${title} `.includes(` ${w}`))) return skip('Not a technical role');

  const age = ageDays(job);
  if (age != null && age > (settings.maxAgeDays ?? 45)) return skip(`Posted ${Math.round(age)} days ago – probably stale`);

  // 2) role relevance
  let role = 0, roleWhy = '';
  const custom = (settings.roles || []).map(norm);
  if (ROLE_STRONG.some((w) => title.includes(w)) || custom.some((w) => w && title.includes(w) && ROLE_STRONG.concat(ROLE_MEDIUM).some((x) => x.includes(w) || w.includes(x)))) { role = 42; roleWhy = 'Title matches your target AI/ML roles'; }
  else if (ROLE_MEDIUM.some((w) => title.includes(w)) || custom.some((w) => w && title.includes(w))) { role = 28; roleWhy = 'Title is a related data/automation role'; }
  else if (ROLE_WEAK.some((w) => title.includes(w))) { role = 10; roleWhy = 'Generic engineering title'; }
  const descSkills = skillsIn(`${job.title} ${desc}`);
  const mine = new Set(profile.skills || []);
  const matched = descSkills.filter((s) => mine.has(s));
  const mlHeavy = descSkills.filter((s) => ['Machine Learning', 'Deep Learning', 'NLP', 'LLM', 'Generative AI', 'Computer Vision', 'TensorFlow', 'PyTorch', 'Scikit-learn'].includes(s)).length;
  if (role === 10 && mlHeavy >= 3) { role = 24; roleWhy = 'Generic title but the description is ML-heavy'; }
  if (role < 20) return skip(role ? 'Title not close enough to your target roles' : 'Title is unrelated to your target roles');
  reasons.push(roleWhy);

  // 3) experience demanded
  const yrs = requiredYears(`${job.title}\n${desc}`);
  let exp = 0;
  const have = profile.experienceYears || 0;
  if (yrs != null) {
    if (yrs > (settings.maxYearsRequired ?? 2)) return skip(`Asks for ${yrs}+ years of experience (your limit is ${settings.maxYearsRequired})`);
    exp = yrs <= have ? 12 : 4;
    reasons.push(yrs === 0 ? 'Open to freshers / entry level' : `Asks for ${yrs}+ years – you have about ${have}`);
  } else { exp = 6; reasons.push('Does not state required experience'); }
  if (/\b(fresher|new grad|entry[- ]level|graduate|junior|associate|engineer i\b|sde[- ]?1|level 1)\b/i.test(`${job.title} ${desc.slice(0, 1500)}`)) { exp += 6; reasons.push('Entry-level friendly wording'); }

  // 4) location
  const loc = locationInfo(job, settings);
  let where = 0;
  if (loc.foreignOnly && !(loc.remote && loc.globalRemote)) return skip('Location is outside India');
  if (loc.inIndia && loc.preferred) { where = 16; reasons.push(`In one of your cities (${job.location})`); }
  else if (loc.remote && (loc.inIndia || loc.globalRemote) && settings.acceptRemote) { where = 14; reasons.push('Remote and open to India'); }
  else if (loc.inIndia && settings.acceptAnywhereInIndia) { where = 9; reasons.push(`In India (${job.location}) – needs relocation`); }
  else if (loc.inIndia) return skip('Outside your preferred cities');
  else if (loc.remote && settings.acceptRemote && !loc.foreignOnly) { where = 6; reasons.push('Remote – India eligibility not stated'); }
  else if (loc.unknown) { where = 2; reasons.push('Location not stated'); }
  else return skip(`Location not suitable (${job.location})`);

  // 5) skills overlap
  const skillPts = Math.min(26, matched.length * 4);
  if (matched.length) reasons.push(`Skills you have: ${matched.slice(0, 8).join(', ')}`);

  // 6) freshness
  let fresh = 0;
  if (job.postedAt) { const days = (Date.now() - new Date(job.postedAt).getTime()) / 864e5; if (days <= 3) fresh = 5; else if (days <= 14) fresh = 3; else if (days > 60) fresh = -6; }

  // 7) pay vs what you expect, and what the user taught us by approving / rejecting similar jobs
  let pay = 0;
  const cmp = compareSalary(job, profile.answers?.expectedCtc);
  if (cmp.known && cmp.verdict === 'below') { pay = -8; reasons.push(`Pays ${fmtLpa(cmp.range.min)}–${fmtLpa(cmp.range.max)} – below your expectation`); }
  else if (cmp.known && cmp.verdict === 'meets') { pay = 2; reasons.push(`Pays ${fmtLpa(cmp.range.min)}–${fmtLpa(cmp.range.max)} – meets your expectation`); }
  else if (cmp.known) reasons.push(`Pays ${fmtLpa(cmp.range.min)}–${fmtLpa(cmp.range.max)}`);
  const lr = adjust(learn, job);
  if (lr.why) reasons.push(lr.why);

  const score = Math.max(0, Math.min(100, Math.round(role + exp + where + skillPts + fresh + pay + lr.points)));
  const decision = score >= (settings.minScore ?? 62) ? 'apply' : score >= (settings.minScore ?? 62) - 14 ? 'maybe' : 'skip';
  return { score, decision, reasons, matchedSkills: matched, skipReason: decision === 'skip' ? 'Score below your threshold' : undefined };
}
