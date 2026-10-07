// The answer bank: what to put in a form field when we have never seen the exact question before.
//
//  1. A catalog of ~100 *kinds* of question that application forms ask (name, notice period, CTC, relocation, work mode, degree,
//     "do you have experience with X", consent boxes, …). Each kind knows how to recognise itself from the wording, where its
//     answer comes from (your profile, or something you typed once on the Answers screen) and how to shape it for the field
//     in front of us (text, number, date, yes/no, a drop-down with unpredictable option wording, a numeric range bucket…).
//  2. A personal Q&A list (`profile.qa`): questions you answered yourself, ones the app learned, and ones it met but could not
//     answer ("pending"). They are matched fuzzily, so "Are you willing to work night shifts?" also catches
//     "Would you be open to rotational / night shift work?".
//  Nothing here ever invents a fact: if there is no answer, the question stays pending for you to fill in once.
import { norm } from './util.js';
import { parseMoneyInr } from './quality.js';
import { skillsIn } from './match.js';

// ───────── small text helpers ─────────
const STOP = new Set(('a an the of to in on at for and or are is be do does did you your yours we our us this that these those it its as by with from will would can could should have has had any if please kindly ' +
  'what which who whom how when where why whether about into over within more than at least most one each all also not no yes').split(' '));
const stem = (w) => w.replace(/(ing|ed|es|s)$/, '').replace(/ie$/, 'y');
export const tokens = (s) => [...new Set(norm(s).split(' ').filter((w) => w.length > 1 && !STOP.has(w)).map(stem))];
export function similarity(a, b) {
  const A = tokens(a), B = tokens(b);
  if (!A.length || !B.length) return 0;
  const sa = new Set(A), inter = B.filter((x) => sa.has(x)).length;
  const jac = inter / (A.length + B.length - inter);
  const contain = inter / Math.min(A.length, B.length);
  return Math.max(jac, Math.min(contain, 0.9) * (Math.min(A.length, B.length) >= 2 ? 1 : 0.6));
}

export const yesNo = (v) => {
  const t = String(v ?? '').trim().toLowerCase();
  if (/^(yes|y|true|i am|i do|i have|i will|i can|sure|ok|agree|affirmative|1)\b/.test(t)) return 'Yes';
  if (/^(no|n|false|i am not|i do not|i don'?t|i have not|i haven'?t|not|never|0)\b/.test(t)) return 'No';
  return null;
};

// ───────── numeric ranges inside option text ("1-3 years", "Less than 15 days", "5 to 8 LPA", "30+ days") ─────────
const UNIT = {
  years: (u) => (/month/.test(u) ? 1 / 12 : /week/.test(u) ? 7 / 365 : /day/.test(u) ? 1 / 365 : 1),
  days: (u) => (/month/.test(u) ? 30 : /week/.test(u) ? 7 : /year/.test(u) ? 365 : 1),
  inr: (u) => (/cr/.test(u) ? 1e7 : /(lpa|lakh|lac|\bl\b)/.test(u) ? 1e5 : /\bk\b|thousand/.test(u) ? 1e3 : 1),
};
/** → { lo, hi, loOpen, hiOpen } in the unit of `kind`, or null. */
export function spanOf(text, kind) {
  let t = String(text || '').toLowerCase().replace(/[₹$,]/g, '').replace(/[–—−]/g, '-').replace(/\binr\b|\brs\.?\b/g, '').trim();
  if (!t) return null;
  if (kind === 'days' && /\b(immediate|immediately|right away|asap|no notice|serving)\b/.test(t) && !/\d/.test(t)) return { lo: 0, hi: 0 };
  const unit = (u) => UNIT[kind](u || '');
  const num = '(\\d+(?:\\.\\d+)?)';
  const unitRe = '\\s*(lpa|lakhs?|lacs?|cr|crores?|k|years?|yrs?|months?|weeks?|days?)?';
  let m;
  if ((m = t.match(new RegExp(`${num}${unitRe}\\s*(?:-|to)\\s*${num}${unitRe}`)))) { const u = m[4] || m[2] || ''; return { lo: +m[1] * unit(m[2] || u), hi: +m[3] * unit(u) }; }
  if ((m = t.match(new RegExp(`(?:less than|under|below|up ?to|upto|within|maximum|max|<=?)\\s*${num}${unitRe}`)))) { const open = /less than|under|below|</.test(t); return { lo: 0, hi: +m[1] * unit(m[2]), hiOpen: open }; }
  if ((m = t.match(new RegExp(`(?:more than|above|over|greater than|at least|minimum|min|>=?)\\s*${num}${unitRe}`)))) { return { lo: +m[1] * unit(m[2]), hi: Infinity, loOpen: /more than|above|over|greater than|>(?!=)/.test(t) }; }
  if ((m = t.match(new RegExp(`${num}${unitRe}\\s*\\+`)))) return { lo: +m[1] * unit(m[2]), hi: Infinity };
  if ((m = t.match(new RegExp(`${num}${unitRe}`)))) { const u = unit(m[2]); if (!m[2] && kind === 'inr' && +m[1] < 1000) return { lo: +m[1] * 1e5, hi: +m[1] * 1e5 }; return { lo: +m[1] * u, hi: +m[1] * u }; }
  if (/fresher|no experience|none|nil/.test(t) && kind === 'years') return { lo: 0, hi: 0 };
  return null;
}
const within = (s, n) => n >= s.lo - 1e-9 && n <= s.hi + 1e-9 && !(s.loOpen && n <= s.lo) && !(s.hiOpen && n >= s.hi);
/** Pick the option whose numeric span contains `n` (tightest wins); otherwise the nearest span if it is close enough. */
export function pickByNumber(options, n, kind) {
  const spans = options.map((o) => ({ o, s: spanOf(o.text ?? o.value, kind) })).filter((x) => x.s);
  if (!spans.length) return null;
  const hits = spans.filter((x) => within(x.s, n)).sort((a, b) => (a.s.hi - a.s.lo) - (b.s.hi - b.s.lo));
  if (hits.length) return String(hits[0].o.text ?? hits[0].o.value);
  const dist = (s) => (n < s.lo ? s.lo - n : n - s.hi);
  const near = spans.map((x) => ({ ...x, d: dist(x.s) })).sort((a, b) => a.d - b.d)[0];
  const tol = kind === 'years' ? 1 : kind === 'days' ? 20 : Math.max(1e5, n * 0.2);
  return near && near.d <= tol ? String(near.o.text ?? near.o.value) : null;
}

export const toDays = (v) => { const s = spanOf(v, 'days'); return s ? s.lo : null; };
export const toYears = (v) => { const s = spanOf(v, 'years'); return s ? s.lo : null; };
export const toInr = (v) => parseMoneyInr(v);

// ───────── choosing among options with unpredictable wording ─────────
const SYN = [
  ['full time', 'fulltime', 'permanent', 'regular', 'fte', 'full-time'], ['part time', 'parttime', 'part-time'], ['contract', 'contractor', 'freelance', 'consultant', 'c2h'],
  ['hybrid', 'flexible', 'partially remote'], ['remote', 'work from home', 'wfh', 'fully remote'], ['on site', 'onsite', 'office', 'in office', 'work from office', 'wfo'],
  ['immediate', 'immediately', 'immediate joiner', 'right away', 'asap', 'now'], ['india', 'indian', 'in'], ['english', 'eng'],
  ["bachelor's", 'bachelors', 'bachelor', 'b tech', 'b.tech', 'btech', 'b e', 'b.e', 'be', 'undergraduate', 'graduate', 'ug'], ["master's", 'masters', 'master', 'm tech', 'm.tech', 'mtech', 'pg', 'post graduate', 'postgraduate', 'msc', 'm.sc', 'mca'],
  ['prefer not to say', 'decline', 'do not wish', "don't wish", 'rather not', 'not to disclose', 'choose not'],
  ['linkedin', 'linked in'], ['careers page', 'company website', 'career site', 'company careers page', 'careers site', 'corporate website', 'company site'], ['job board', 'job portal', 'naukri', 'indeed', 'glassdoor'],
];
const canon = (s) => { const t = norm(s); for (const g of SYN) if (g.some((x) => norm(x) === t)) return norm(g[0]); return t; };
const YES_RE = /^(yes|y|true|i am|i do|i have|i will|i can|i would|agree|i agree|affirmative)\b/i, NO_RE = /^(no|n|false|i am not|i do not|i don'?t|i have not|i haven'?t|not|negative)\b/i;

/** Best option for a desired answer (or null). Handles yes/no phrasing, synonyms and word overlap. */
export function chooseOption(options, desired) {
  if (!options?.length) return null;
  const d = String(desired ?? '').trim();
  if (!d) return null;
  const txt = (o) => String(o.text ?? o.value ?? '');
  const nd = norm(d);
  const exact = options.find((o) => norm(txt(o)) === nd);
  if (exact) return txt(exact);
  const yn = yesNo(d);
  if (yn && (/^(yes|no|y|n|true|false)\b/i.test(d) || d.length < 5)) {
    const re = yn === 'Yes' ? YES_RE : NO_RE;
    const m = options.find((o) => re.test(txt(o).trim()));
    if (m) return txt(m);
  }
  const cd = canon(d);
  const syn = options.find((o) => canon(txt(o)) === cd);
  if (syn) return txt(syn);
  const partial = options.find((o) => norm(txt(o)).includes(nd) && nd.length > 2) || options.find((o) => nd.includes(norm(txt(o))) && norm(txt(o)).length > 3);
  if (partial) return txt(partial);
  // synonym groups: any member of d's group inside an option
  for (const g of SYN) {
    if (!g.some((x) => nd === norm(x) || nd.includes(norm(x)) && norm(x).length > 3)) continue;
    const o = options.find((opt) => g.some((x) => { const n = norm(x); return n.length > 2 && ` ${norm(txt(opt))} `.includes(` ${n} `); }));
    if (o) return txt(o);
  }
  // word overlap
  let best = null, bs = 0;
  for (const o of options) { const s = similarity(d, txt(o)); if (s > bs) { bs = s; best = o; } }
  return best && bs >= 0.6 ? txt(best) : null;
}
export const pickDecline = (options) => { const o = (options || []).find((x) => /prefer not|decline|do not wish|don'?t wish|not to say|rather not|choose not|no answer|not disclose|not wish/i.test(String(x.text ?? x.value))); return o ? String(o.text ?? o.value) : null; };

// ───────── dates ─────────
const pad = (n) => String(n).padStart(2, '0');
export function fmtDate(d, f = {}) {
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(+dt)) return null;
  const y = dt.getFullYear(), m = pad(dt.getMonth() + 1), day = pad(dt.getDate());
  if (f.type === 'date') return `${y}-${m}-${day}`;
  const ph = String(f.placeholder || '').toLowerCase();
  if (/yyyy-mm-dd/.test(ph)) return `${y}-${m}-${day}`;
  if (/mm\/dd\/yyyy|mm-dd-yyyy/.test(ph)) return `${m}/${day}/${y}`;
  if (/dd-mm-yyyy/.test(ph)) return `${day}-${m}-${y}`;
  if (/dd\.mm\.yyyy/.test(ph)) return `${day}.${m}.${y}`;
  if (/dd mmm yyyy|d mmm yyyy/.test(ph)) return `${day} ${dt.toLocaleString('en', { month: 'short' })} ${y}`;
  return `${day}/${m}/${y}`;
}
export function parseUserDate(s) {
  const t = String(s || '').trim();
  let m;
  if ((m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) return new Date(+m[1], +m[2] - 1, +m[3]);
  if ((m = t.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/))) return new Date(+m[3], +m[2] - 1, +m[1]);   // Indian order dd/mm/yyyy
  const d = new Date(t); return Number.isNaN(+d) ? null : d;
}

const STATE_OF = { chennai: 'Tamil Nadu', coimbatore: 'Tamil Nadu', madurai: 'Tamil Nadu', trichy: 'Tamil Nadu', bengaluru: 'Karnataka', bangalore: 'Karnataka', mysuru: 'Karnataka', mysore: 'Karnataka', hyderabad: 'Telangana', pune: 'Maharashtra', mumbai: 'Maharashtra', 'navi mumbai': 'Maharashtra', nagpur: 'Maharashtra', delhi: 'Delhi', 'new delhi': 'Delhi', gurgaon: 'Haryana', gurugram: 'Haryana', noida: 'Uttar Pradesh', ghaziabad: 'Uttar Pradesh', lucknow: 'Uttar Pradesh', kochi: 'Kerala', cochin: 'Kerala', trivandrum: 'Kerala', thiruvananthapuram: 'Kerala', kolkata: 'West Bengal', ahmedabad: 'Gujarat', vadodara: 'Gujarat', jaipur: 'Rajasthan', chandigarh: 'Chandigarh', indore: 'Madhya Pradesh', bhubaneswar: 'Odisha', mohali: 'Punjab' };

// ───────── the catalog ─────────
// Q(id, group, title, kind, patterns, derive?, opts?)
//   kind: text | yesno | choice | years | days | inr | date | long | consent | list
//   derive(ctx) → string|null (default answer from the profile). `ctx.bank(id)` is what the user typed on the Answers screen.
//   opts.store: legacy profile.answers.<key> that holds the user's answer;  opts.sensitive: demographic;  opts.hint: shown in the UI
const C = [];
const Q = (id, group, title, kind, patterns, derive = null, opts = {}) => C.push({ id, group, title, kind, re: new RegExp(`(?<![a-z0-9])(?:${patterns})`, 'i'), derive, ...opts });
const none = () => null;
const P = (k) => ({ profile: p }) => (p[k] === '' || p[k] == null ? null : String(p[k]));
const url = (v) => (v ? (/^https?:\/\//i.test(v) ? v : `https://${v}`) : null);
const cityOf = ({ profile: p }) => p.city || String(p.location || '').split(',')[0].trim() || null;

// Identity
Q('first_name', 'Identity', 'First name', 'text', 'first name|given name|fname|forename|first_name', P('firstName'));
Q('middle_name', 'Identity', 'Middle name', 'text', 'middle name|middle initial', none);
Q('last_name', 'Identity', 'Last name', 'text', 'last name|surname|family name|lname|last_name', P('lastName'));
Q('preferred_name', 'Identity', 'Preferred name', 'text', 'preferred (first )?name|nick ?name|known as|what should we call you', P('firstName'));
Q('esign', 'Identity', 'Signature (type your full name)', 'text', 'signature|sign (here|below)|type your (full |legal )?name|electronic(ally)? sign|e sign|initial here|digital sign', ({ profile: p }) => p.fullName || `${p.firstName} ${p.lastName}`.trim() || null);
Q('full_name', 'Identity', 'Full name', 'text', '^(full |legal |your |candidate |applicant )?name$|^name( |$)|full name|legal name|your name|applicant name|candidate name', ({ profile: p }) => p.fullName || `${p.firstName} ${p.lastName}`.trim() || null);
Q('nationality', 'Identity', 'Nationality / citizenship', 'text', 'nationality|citizen of|country of citizenship|citizenship', () => 'Indian');
Q('dob', 'Identity', 'Date of birth', 'date', 'date of birth|\\bdob\\b|birth ?date|birthday|d o b', none, { hint: 'Only filled if you enter it here.', sensitive: true });
Q('age', 'Identity', 'Age', 'text', '^(what( is|s) )?(your |candidate )?age( in years| \\(years\\))?$|how old', none, { sensitive: true });
Q('marital', 'Identity', 'Marital status', 'choice', 'marital|married', none, { sensitive: true });

// Contact
Q('email_alt', 'Contact', 'Alternate email', 'text', '(alternate|alternative|secondary|other|personal|backup) e ?mail', none);
Q('email', 'Contact', 'Email', 'text', 'e ?mail|mail id', P('email'));
Q('phone_code', 'Contact', 'Phone country code', 'text', '^(phone |mobile |telephone |your )?(country|dial(ing)?|isd|calling) code( .*)?$|^code$', () => '+91');
Q('phone_alt', 'Contact', 'Alternate phone', 'text', '(alternate|alternative|secondary|other|emergency|parent|guardian|home) (phone|mobile|contact|number)', none);
Q('phone', 'Contact', 'Phone / mobile', 'text', 'phone|mobile|contact number|telephone|whatsapp|cell( number)?|contact no', P('phone'));

// Address
Q('address2', 'Address', 'Address line 2', 'text', 'address line 2|address 2|apartment|suite|flat|landmark|locality|area', none);
Q('address', 'Address', 'Street address', 'text', 'street address|address line 1|address 1|^address$|residential address|current address|permanent address|mailing address|full address|your address|home address', none, { hint: 'Needed by some forms. Enter once.' });
Q('postal', 'Address', 'PIN / postal code', 'text', 'postal|zip|pin ?code|pincode|post code', none);
Q('state', 'Address', 'State', 'text', '\\bstate\\b|province|region of residence|state of residence', (c) => STATE_OF[norm(cityOf(c) || '')] || null);
Q('country', 'Address', 'Country', 'choice', '^country|country of residence|country you (live|reside|are)|country$|country/region', () => 'India');
Q('hometown', 'Address', 'Hometown / native place', 'text', 'hometown|native (place|city)|permanent (location|city|place)|place of birth|birth ?place', none);
Q('city', 'Address', 'Current city / location', 'text', 'current (location|city|town)|city of residence|^city|town|where are you (currently )?(based|located|residing|living)|location of residence|^location|currently (based|located|reside)|present (location|city)', (c) => { const city = cityOf(c); return city ? { text: city, withCountry: `${city}, India` } : null; }, { custom: true });

// Links
Q('linkedin', 'Links', 'LinkedIn profile', 'text', 'linked ?in', ({ profile: p }) => url(p.linkedin));
Q('github', 'Links', 'GitHub profile', 'text', 'github|git hub', ({ profile: p }) => url(p.github));
Q('kaggle', 'Links', 'Kaggle profile', 'text', 'kaggle', none);
Q('leetcode', 'Links', 'LeetCode / HackerRank / coding profile', 'text', 'leetcode|hackerrank|codechef|codeforces|geeksforgeeks|coding profile|competitive', none);
Q('stackoverflow', 'Links', 'Stack Overflow', 'text', 'stack ?overflow', none);
Q('twitter', 'Links', 'Twitter / X', 'text', 'twitter|\\bx\\.com|x handle', none);
Q('medium', 'Links', 'Blog / Medium', 'text', 'medium|blog|substack|dev\\.to', none);
Q('portfolio', 'Links', 'Portfolio / website', 'text', 'portfolio|personal (site|website|url|page)|^website|other (link|website|url)|^url$|link to your work|work samples?|online presence|web ?site|homepage', ({ profile: p }) => p.website || url(p.github) || url(p.linkedin) || null);
Q('resume_link', 'Links', 'Link to your resume', 'text', 'resume (link|url)|cv (link|url)|link to (your )?(resume|cv)|google drive|drive link', none);

// Skills & languages (specific "do you know X" questions are handled separately, see skillAnswer)
Q('skills_list', 'Skills', 'Key skills', 'list', 'key skills?|technical skills?|skills? (you have|set|summary)|primary skills?|core skills?|tech(nical)? stack|technologies|programming languages?|coding languages?|languages? (and|&) (tools|frameworks|technologies)|which (tools|frameworks|technologies)', ({ profile: p }) => (p.skills || []).slice(0, 15).join(', ') || null);
Q('languages', 'Skills', 'Languages you speak', 'list', 'languages?( (known|spoken|you (speak|know)))?|which languages|fluent in|mother tongue', none, { hint: 'e.g. English, Hindi, Tamil' });
Q('english_level', 'Skills', 'English proficiency', 'choice', 'english (proficiency|level|fluency|speaking|communication)|proficiency in english|level of english|communication skills', none, { hint: 'e.g. Fluent / Professional / Native' });

// Current work
Q('current_company', 'Current work', 'Current company', 'text', 'current (company|employer|organi[sz]ation)|present (company|employer|organi[sz]ation)|employer name|company name|name of (the )?(company|organi[sz]ation)|most recent (company|employer)|last (company|employer)', P('currentCompany'));
Q('current_title', 'Current work', 'Current job title', 'text', 'current (job )?(title|role|designation|position)|^designation|job title|present (role|designation)|most recent (title|role)', P('currentTitle'));
Q('employed_now', 'Current work', 'Currently employed?', 'yesno', 'currently (employed|working)|are you employed|present(ly)? employed|employment status', ({ profile: p }) => (p.currentCompany ? 'Yes' : null));
Q('serving_notice', 'Current work', 'Currently serving notice?', 'yesno', 'serving (your )?notice|currently on notice|under notice', none);
Q('last_working_day', 'Current work', 'Last working day', 'date', 'last working (day|date)|\\blwd\\b|relieving date|date of relieving', none);
Q('reason_leaving', 'Current work', 'Reason for leaving / job change', 'long', 'reason (for|of) (leaving|change|job change|switch)|why are you (leaving|looking|changing|planning)|why (do you want to )?(leave|change|switch)|looking for a change', none, { hint: 'One or two honest sentences.' });
Q('experience_months', 'Current work', 'Experience in months', 'number', '(experience|exp).{0,20}months|months of (work |professional )?experience', ({ profile: p }) => String(Math.round((p.experienceYears || 0) * 12)));
Q('total_experience', 'Current work', 'Total years of experience', 'years', '(total|overall|relevant|professional|work(ing)?|industry|it|software|related).{0,25}experience|years of (work |professional |relevant )?(experience|exp)|experience in years|how many years|number of years|yrs of exp|\\bexp(erience)?\\b.{0,12}\\byears?\\b', ({ profile: p }) => String(p.experienceYears ?? 0).replace(/\.0$/, ''));

// Compensation & joining
Q('notice_period', 'Notice & pay', 'Notice period / joining time', 'days', 'notice period|how soon can you join|joining time|availability to join|when can you (start|join)|time to join|days to join|joining availability|period of notice|how (quickly|soon).{0,20}(join|start)', ({ profile: p }) => p.answers?.noticePeriod || null, { store: 'noticePeriod', hint: 'e.g. 30 days, Immediate, 2 months' });
Q('earliest_start', 'Notice & pay', 'Earliest start date', 'date', 'earliest (start|joining|date)|available (from|to start)|start date|joining date|date of joining|expected (date of )?joining|preferred start|date available|availability date|when are you available', ({ profile: p }) => p.answers?.noticePeriod || null, { hint: 'Calculated from your notice period.' });
Q('notice_negotiable', 'Notice & pay', 'Notice period negotiable / buy-out?', 'yesno', 'negotiable.{0,20}notice|notice.{0,30}(negotiable|buy ?out|waive|reduce|shorten)|buy ?out|can you (join|reduce|prepone)', none);
Q('current_ctc', 'Notice & pay', 'Current CTC', 'inr', 'current (ctc|salary|compensation|package|pay|remuneration|annual|fixed)|present (ctc|salary|package)|fixed (ctc|salary)|last drawn|ctc \\(current|existing (ctc|salary)|annual (ctc|salary) \\(current', ({ profile: p }) => p.answers?.currentCtc || null, { store: 'currentCtc', hint: 'e.g. 5 LPA' });
Q('expected_ctc', 'Notice & pay', 'Expected CTC', 'inr', 'expected (ctc|salary|compensation|package|pay|remuneration)|salary expectation|desired (salary|ctc|compensation)|ctc expectation|expectation (on|of|for) (ctc|salary)|expected annual|what are you (looking|expecting)|salary requirement|compensation expectation|asking (salary|ctc)', ({ profile: p }) => p.answers?.expectedCtc || null, { store: 'expectedCtc', hint: 'e.g. 8 LPA' });
Q('ctc_negotiable', 'Notice & pay', 'Salary negotiable?', 'yesno', 'negotiable|flexible (on|with) (salary|ctc|compensation)', none);
Q('variable_pay', 'Notice & pay', 'Variable pay / bonus', 'text', 'variable|bonus|incentive|stock|esop|rsu', none);
Q('currency', 'Notice & pay', 'Salary currency', 'choice', '^currency|salary currency|currency of', () => 'INR');

// Preferences
Q('relocate', 'Preferences', 'Willing to relocate?', 'yesno', 'relocat|willing to (move|work (from|in|at))|open to (relocation|working (from|in|at))|move to|ready to shift|comfortable (relocating|moving)', ({ profile: p }) => yesNo(p.answers?.willingToRelocate ?? 'Yes') || 'Yes', { store: 'willingToRelocate' });
Q('preferred_location', 'Preferences', 'Preferred work location(s)', 'text', 'preferred (work )?(location|city|cities|office)|location preference|which (city|location|office)s?|where would you (like|prefer)|desired location|work location', ({ settings }) => (settings?.locations || []).join(', ') || null, { hint: 'Taken from your preferred cities in Settings.' });
Q('work_mode', 'Preferences', 'Work mode (remote / hybrid / on-site)', 'choice', '(prefer|comfortable|open|willing|ready).{0,40}(remote|hybrid|on ?site|office|work from)|work (mode|model|arrangement|type|setup|style)|mode of work|(remote|hybrid|on ?site) (work|preference|working)|work from (home|office)', none, { hint: 'e.g. Hybrid' });
Q('employment_type', 'Preferences', 'Employment type', 'choice', '(job|employment|position|work|role) type|type of (employment|job|role|position)|full ?time|part ?time|permanent|contract(ual)? (basis|role|position)|employment (basis|mode)|looking for', () => 'Full-time');
Q('shift', 'Preferences', 'Shift flexibility', 'yesno', 'shift|night|rotational|24 ?x ?7|odd hours|flexible hours|working hours|overlap', none);
Q('travel', 'Preferences', 'Willing to travel?', 'yesno', 'willing to travel|travel (required|percentage|extensively|frequently|up to)|% travel|ready to travel|domestic travel|international travel|business travel', none);
Q('weekends', 'Preferences', 'Weekend / on-call work', 'yesno', 'weekend|on[- ]call|holiday work|work on (saturday|sunday)', none);
Q('onsite_days', 'Preferences', 'Comfortable in office (days / commute)', 'yesno', 'commute|days? (a |per )?(week )?in (the )?office|work from office|come to (the )?office|office (location|attendance)', none);
Q('laptop', 'Preferences', 'Own laptop / internet', 'yesno', 'laptop|own (computer|device|pc)|internet connection|broadband|wi-?fi|work from home (set ?up|infrastructure)|workstation', none);

// Eligibility & legal
Q('work_auth', 'Eligibility', 'Authorised to work in India?', 'yesno', 'authori[sz]ed to work|work authori[sz]ation|legally (eligible|authori[sz]ed|permitted|allowed)|right to work|eligible to work|work permit|permitted to work|legal right', ({ profile: p }) => (yesNo(p.answers?.workAuthorization || 'Yes') || 'Yes'), { store: 'workAuthorization' });
Q('sponsorship', 'Eligibility', 'Need visa sponsorship?', 'yesno', 'sponsor|visa (status|type|support|requirement)|require.{0,20}visa|need.{0,20}visa|immigration', ({ profile: p }) => yesNo(p.answers?.requireSponsorship || 'No') || 'No', { store: 'requireSponsorship' });
Q('visa_status', 'Eligibility', 'Visa / work-permit status', 'text', 'visa (status|type)|type of visa|work permit (status|type)|residency status|immigration status', () => 'Not applicable – Indian citizen');
Q('clearance', 'Eligibility', 'Security clearance', 'yesno', 'clearance', () => 'No');
Q('background_check', 'Eligibility', 'Consent to background check', 'yesno', 'background (check|verification|screening)|consent to (a )?(background|verification)|employment verification|reference check', () => 'Yes', { hint: 'Default Yes – change if you object.' });
Q('drug_test', 'Eligibility', 'Drug test', 'yesno', 'drug (test|screen)|substance', none);
Q('age18', 'Eligibility', 'At least 18 years old?', 'yesno', '18 years|over the age|at least 18|legal (working )?age|older than 18|minimum age', () => 'Yes');
Q('prev_employee', 'Eligibility', 'Worked here before?', 'yesno', 'previously (worked|employed)|worked (here|for us|at) .{0,25}before|former (employee|intern)|ever (been )?(employed|worked)|current employee of|are you (a )?(current|former)', () => 'No');
Q('prev_applied', 'Eligibility', 'Applied here before?', 'yesno', 'previously applied|applied (here|to us|with us|for (a )?position).{0,20}before|applied before|prior application|interviewed (with|at|here)', () => 'No');
Q('relatives', 'Eligibility', 'Relatives / conflict of interest', 'yesno', 'relatives?|family member|related to|know anyone (who )?(works|working)|conflict of interest|friend.{0,15}(works|employee)|spouse|close (relation|associate)', () => 'No');
Q('non_compete', 'Eligibility', 'Non-compete / bond / service agreement', 'yesno', 'non[- ]?compete|restrictive covenant|bond|service agreement|service contract|obligat|contractual (restriction|obligation)|garden leave|non[- ]solicit', () => 'No');
Q('criminal', 'Eligibility', 'Criminal record', 'yesno', 'convict|criminal|felony|offen[cs]e|legal proceeding|court case|pending case', () => 'No');
Q('govt_official', 'Eligibility', 'Government employee / official', 'yesno', 'government (employee|official)|public (official|servant)|politically exposed|civil servant', () => 'No');
Q('essential_functions', 'Eligibility', 'Can perform essential job functions', 'yesno', 'essential (job )?functions|reasonable accommodation|perform the (essential )?duties|able to perform', () => 'Yes');
Q('passport', 'Eligibility', 'Passport', 'yesno', 'passport', none);
Q('driving', 'Eligibility', 'Driving licence', 'yesno', 'driving|driver.?s? licen[cs]e|two ?wheeler|own (vehicle|transport)', none);

// Education
Q('degree', 'Education', 'Highest degree', 'choice', 'degree|qualification|highest (level of )?(education|qualification)|education(al)? (level|qualification)|level of education', ({ profile: p }) => p.education?.degree || null, { custom: true });
Q('major', 'Education', 'Branch / major', 'text', 'major|branch|specialization|specialisation|field of study|stream|discipline|area of study|course', ({ profile: p }) => { const d = String(p.education?.degree || ''); const parts = d.split(/[,\-–(]/).map((x) => x.trim()).filter(Boolean); return parts.length > 1 ? parts.slice(1).join(', ').replace(/\)$/, '') : null; });
Q('college', 'Education', 'College / university', 'text', 'college|university|institut|school name|alma mater|name of (the )?(college|university|institution)', ({ profile: p }) => p.education?.college || null);
Q('grad_year', 'Education', 'Graduation year', 'text', 'graduat(ion|ed) year|year of (passing|graduation|completion)|passing year|year graduated|batch|passout|pass ?out year|when did you graduate', ({ profile: p }) => (p.education?.gradYear ? String(p.education.gradYear) : null));
Q('grad_month', 'Education', 'Graduation month', 'text', 'graduation month|month of (passing|graduation)', none);
Q('tenth', 'Education', '10th percentage', 'text', '10th|tenth|\\bx(th)? (std|standard|class)|sslc|matric|secondary (school|education|percentage)|class 10|class x\\b', none);
Q('twelfth', 'Education', '12th percentage', 'text', '12th|twelfth|\\bxii\\b|hsc|higher secondary|intermediate|puc|senior secondary|class 12|class xii|diploma percentage', none);
Q('cgpa', 'Education', 'CGPA / percentage (degree)', 'text', 'cgpa|gpa|percentage|aggregate|grade point|marks|score in (degree|graduation|ug|b\\.?tech)', ({ profile: p }) => p.education?.cgpa || null);
Q('backlogs', 'Education', 'Active backlogs / arrears', 'text', 'backlog|arrear|standing arrear|supplementary|kt\\b|failed subjects', none, { hint: 'e.g. No / 0' });
Q('edu_gap', 'Education', 'Gap in education / career', 'yesno', 'gap (in|year|between|period)|break in (education|career|studies)|career break', none);
Q('certifications', 'Education', 'Certifications', 'text', 'certification|certificate|licen[cs]es? (and|&) cert|courses? completed|professional certification', none);

// Referral & source
Q('referred', 'Source', 'Were you referred?', 'yesno', 'were you referred|referred by|employee referral|referral (code|name|id|email)|who referred|referrer', () => 'No');
Q('how_hear', 'Source', 'How did you hear about us?', 'choice', 'how did you (hear|find|learn|come to know|get to know)|where did you (hear|find|learn|see)|^source|referral source|source of (application|hire|referral)|how (do|did) you know|hear about', ({ profile: p }) => p.answers?.howDidYouHear || 'Company careers page', { store: 'howDidYouHear' });

// Demographics: declined unless the user answers
Q('gender', 'Demographics', 'Gender', 'choice', 'gender|\\bsex\\b|identify as', none, { sensitive: true });
Q('pronouns', 'Demographics', 'Pronouns', 'choice', 'pronoun', none, { sensitive: true });
Q('race', 'Demographics', 'Race / ethnicity', 'choice', 'race|ethnic|hispanic|latino', none, { sensitive: true });
Q('veteran', 'Demographics', 'Veteran status', 'choice', 'veteran|military|armed forces', none, { sensitive: true });
Q('disability', 'Demographics', 'Disability', 'choice', 'disabilit|handicap|differently abled|special(ly)? abled', none, { sensitive: true });
Q('orientation', 'Demographics', 'Sexual orientation / gender identity', 'choice', 'sexual orientation|lgbt|transgender|gender identity', none, { sensitive: true });
Q('religion', 'Demographics', 'Religion / caste / category', 'choice', 'religion|caste|community|reservation|category \\(?(general|obc|sc|st)|social category|minority', none, { sensitive: true });

// Consent / acknowledgement boxes (checkbox fields)
export const CONSENT_YES = /agree|consent|acknowledge|privacy|terms|conditions|certify|confirm|accurate|true and correct|read and understood|gdpr|data processing|declaration|i hereby|authori[sz]e|accept|policy|understand that/;
export const CONSENT_NO = /subscribe|newsletter|marketing|promotional|(job )?alerts?|future (roles|opportunit|positions|openings)|talent (community|network|pool)|sms|whatsapp|text me|keep me (posted|updated)|contact me about other|share my (data|information) with (third|partners)/;

// Written answers (long text): only ever your own words – or Claude's, strictly from your resume
Q('cover_letter', 'Written answers', 'Cover letter', 'long', 'cover letter|covering letter|letter of interest|motivation letter|letter of motivation', none, { generated: true });
Q('why_company', 'Written answers', 'Why do you want to work with us?', 'long', 'why.{0,40}(company|us\\b|join|want to work|interested in (this |our )?(company|role|position|opportunity|us)|apply|choose)|what (attracts|interests|excites|motivates) you|why are you interested|reason for (applying|interest)', none, { generated: true, jobSpecific: true });
Q('about_you', 'Written answers', 'Tell us about yourself', 'long', 'tell us (more )?about yourself|introduce yourself|about you|describe yourself|professional summary|profile summary|summary of (your )?(profile|experience)|brief (introduction|profile|bio)|^bio$|your story|elevator pitch', ({ profile: p }) => p.summary || null, { generated: true });
Q('strengths', 'Written answers', 'Your strengths', 'long', 'strength|what are you (good|best) at|key (strengths|skills you bring)|what sets you apart|unique (skills|value)|what can you bring|value you (will )?(bring|add)', none, { generated: true });
Q('weaknesses', 'Written answers', 'Your weaknesses / areas to improve', 'long', 'weakness|area.{0,15}(improv|develop)|improve(ment)?|growth area|feedback (you|that)', none, { generated: true });
Q('goals', 'Written answers', 'Career goals', 'long', 'career (goals?|aspirations?|objectives?|plans?)|where do you see yourself|(5|five|3|three) years|long[- ]term (goals?|plans?)|future plans|professional goals', none, { generated: true });
Q('project', 'Written answers', 'Describe a project / achievement', 'long', '(describe|tell us about|share|explain|walk us through).{0,40}(project|achievement|accomplishment|challenge|experience|time when|example|situation|solution|initiative)|proudest|most (challenging|significant|impressive)|biggest (achievement|challenge)|notable (project|work)', none, { generated: true });
Q('salary_justify', 'Written answers', 'Why this salary expectation?', 'long', 'justify|basis (of|for) (your )?(expect|salary)|how did you arrive', none, { generated: true });
Q('additional_info', 'Written answers', 'Anything else we should know', 'long', 'additional information|anything else|any other (information|details|comments)|comments|notes|message (to|for) (the )?(hiring|recruit)|questions (for|to) us|other details|add(itional)? notes|remarks|is there anything|something else', none, { optionalOnly: true });
Q('accommodation', 'Written answers', 'Accommodation needed for interview', 'yesno', 'accommodation|adjustments? (needed|required)|special (needs|requirements)', () => 'No');

export const CATALOG = C;
export const GROUPS = [...new Set(C.map((x) => x.group))];
const byId = new Map(C.map((x) => [x.id, x]));
export const entryById = (id) => byId.get(id);

/** First catalog entry whose wording matches the question (order in the list above is the priority). */
export function findEntry(label) {
  const t = norm(label);
  if (!t) return null;
  for (const e of C) if (e.re.test(t)) return e;
  return null;
}

// ───────── per-profile view of the catalog (for the Answers screen) ─────────
/** What the user typed for an entry: legacy profile.answers.<key> or profile.bank[id]. */
export const userValue = (entry, profile) => {
  const b = profile.bank?.[entry.id];
  if (b != null && String(b).trim() !== '') return String(b);
  if (entry.store && profile.answers?.[entry.store]) return String(profile.answers[entry.store]);
  return '';
};
export function derivedValue(entry, ctx) {
  if (!entry.derive) return '';
  const v = entry.derive(ctx);
  if (v && typeof v === 'object') return v.text || '';
  return v == null ? '' : String(v);
}
export function catalogView(profile, settings) {
  const ctx = { profile, settings };
  return C.filter((e) => e.kind !== 'consent').map((e) => {
    const mine = userValue(e, profile), def = derivedValue(e, ctx);
    return { id: e.id, group: e.group, title: e.title, kind: e.kind, hint: e.hint || '', sensitive: !!e.sensitive, store: e.store || '', yours: mine, fallback: def, effective: mine || def, status: mine ? 'yours' : def ? 'default' : e.sensitive ? 'declined' : e.optionalOnly ? 'optional' : 'empty' };
  });
}

// ───────── user-made / learned / pending Q&A (profile.qa) ─────────
/** profile.qa item: { id, question, answer, kind, options?, source: 'you'|'learned'|'claude'|'pending', uses, seen, addedAt, lastUsed } */
export function matchQa(qa, label, minSim = 0.72, job = null) {
  let best = null, bs = 0;
  for (const q of qa || []) {
    if (!q.answer && q.source !== 'pending') continue;
    // a question stored as "Why do you want to work at {company}?" is compared with the real company / role filled in
    const qt = job ? String(q.question).replace(/\{company\}/gi, job.company || '').replace(/\{(role|title|position)\}/gi, job.title || '') : q.question;
    const s = norm(qt) === norm(label) ? 1 : similarity(qt, label);
    if (s > bs) { bs = s; best = q; }
  }
  return best && bs >= minSim ? best : null;
}
let counter = 0;
export function upsertQa(profile, { question, answer = '', kind = 'text', options = null, source = 'you' }) {
  const qa = (profile.qa ||= []);
  const q = String(question || '').trim();
  if (!q) return null;
  let hit = matchQa(qa, q, 0.8) || qa.find((x) => x.source === 'pending' && similarity(x.question, q) >= 0.8);
  const now = new Date().toISOString();
  if (hit) {
    if (answer !== '' && (source === 'you' || !hit.answer || hit.source === 'pending')) { hit.answer = answer; hit.source = source === 'claude' ? 'claude' : source; }
    else if (answer === '' && source === 'pending') { hit.seen = (hit.seen || 0) + 1; }
    if (options && options.length) hit.options = options;
    hit.updatedAt = now; return hit;
  }
  hit = { id: `q${Date.now().toString(36)}${(counter++).toString(36)}`, question: q, answer, kind, options: options && options.length ? options.slice(0, 30) : undefined, source: answer ? source : 'pending', uses: 0, seen: 1, addedAt: now, updatedAt: now };
  qa.push(hit);
  if (qa.length > 600) qa.splice(0, qa.length - 600);
  return hit;
}
export const pendingCount = (profile) => (profile.qa || []).filter((q) => q.source === 'pending' && !q.answer).length;

// ───────── shaping an answer for the field in front of us ─────────
const digits = (s) => String(s || '').replace(/\D/g, '');
function shapeNumber(raw, kind, f, ctx) {
  const label = norm(`${f.label} ${f.name || ''} ${f.placeholder || ''}`);
  if (f.options?.length) {
    const n = kind === 'years' ? toYears(raw) : kind === 'days' ? toDays(raw) : toInr(raw);
    if (n != null) { const o = pickByNumber(f.options, n, kind); if (o) return o; }
    return chooseOption(f.options, raw);
  }
  if (kind === 'years') { const n = toYears(raw); return n == null ? String(raw) : String(Math.round(n * 10) / 10).replace(/\.0$/, ''); }
  if (kind === 'days') {
    if (f.type === 'date') return null;
    if (f.type === 'number' || /\b(in|number of) days\b|\(days\)/.test(label)) { const d = toDays(raw); return d == null ? null : String(Math.round(d)); }
    if (/\bmonths?\b/.test(label) && /\bin months|\(months\)/.test(label)) { const d = toDays(raw); return d == null ? null : String(Math.round(d / 30)); }
    return String(raw);
  }
  if (kind === 'inr') {
    const inr = toInr(raw);
    if (inr == null) return String(raw);
    if (/lpa|lakh|lac|in lakhs/.test(label)) return String(Math.round((inr / 1e5) * 100) / 100).replace(/\.0+$/, '');
    if (/\bcr\b|crore/.test(label)) return String(inr / 1e7);
    if (f.type === 'number' || /annual|per annum|yearly|in (rs|inr|rupees)|₹|amount/.test(label)) return String(Math.round(inr));
    if (/per month|monthly/.test(label)) return String(Math.round(inr / 12));
    return String(raw);
  }
  return String(raw);
}
const phoneFor = (v, f) => { const d = digits(v).slice(-10); if (!d) return null; return /\+91|country code|with country|isd/i.test(`${f.placeholder} ${f.label}`) ? `+91${d}` : d; };

/**
 * Turn a raw answer into a value that fits `f`. Returns {value} or null when it cannot be expressed in this field honestly.
 */
export function shape(raw, entry, f, ctx) {
  if (raw == null || raw === '') return null;
  const kind = entry?.kind || 'text';
  const opts = f.options;
  if (f.type === 'checkboxgroup') {
    const want = String(raw).split(/[,;/]|\band\b/i).map((x) => x.trim()).filter(Boolean);
    const chosen = (opts || []).filter((o) => want.some((w) => canon(String(o.text)) === canon(w) || norm(String(o.text)).includes(norm(w)) && norm(w).length > 2)).map((o) => o.text);
    return chosen.length ? { value: chosen } : null;
  }
  if (kind === 'yesno') {
    const yn = yesNo(raw);
    if (!yn) return opts?.length ? ((o) => (o ? { value: o } : null))(chooseOption(opts, raw)) : { value: String(raw) };
    if (f.type === 'checkbox') return { value: yn === 'Yes' };
    if (opts?.length) { const o = chooseOption(opts, yn); return o ? { value: o } : null; }
    return { value: yn };
  }
  if (kind === 'date' || f.type === 'date') {
    let d = parseUserDate(raw);
    if (!d) { const days = toDays(raw); if (days != null) { d = new Date(); d.setDate(d.getDate() + Math.round(days)); } }
    if (!d) return null;
    return { value: fmtDate(d, f) };
  }
  if (kind === 'years' || kind === 'days' || kind === 'inr' || kind === 'number') {
    const v = shapeNumber(raw, kind === 'number' ? 'years' : kind, f, ctx);
    return v == null ? null : { value: v };
  }
  if (entry?.id === 'phone') { const v = phoneFor(raw, f); return v ? { value: v } : null; }
  if (entry?.id === 'phone_code') { if (opts?.length) { const o = opts.find((x) => /\+?91\b|india/i.test(String(x.text))); return o ? { value: o.text } : null; } return { value: '+91' }; }
  if (entry?.id === 'city') { /* derive returns {text, withCountry} */ }
  if (opts?.length) {
    if (entry?.id === 'preferred_location') { for (const c of String(raw).split(',')) { const o = chooseOption(opts, c.trim()); if (o) return { value: o }; } return null; }
    const o = chooseOption(opts, raw);
    return o ? { value: o } : null;
  }
  let v = String(raw);
  if (f.maxLength && v.length > f.maxLength) {
    const cut = v.slice(0, f.maxLength);
    const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
    v = end > f.maxLength * 0.5 ? cut.slice(0, end + 1) : cut.slice(0, cut.lastIndexOf(' ') > 0 ? cut.lastIndexOf(' ') : f.maxLength);
  }
  return { value: v };
}

// ───────── "do you have experience with <skill>?" ─────────
const SKILL_Q = /(experience|experienced|proficien|familiar|knowledge|know|worked|working|hands[- ]on|expertise|skilled|comfortable|exposure|background|competen|used|using|expert|well versed|command)/;
/** Answer questions about one specific technology from the skills in the profile. Returns {kind, raw} or null. */
export function skillAnswer(label, f, profile) {
  const t = norm(label);
  if (!SKILL_Q.test(t) && !/^(are you|do you|have you|can you)/.test(t)) return null;
  const mentioned = skillsIn(label).filter((s) => !['Automation', 'Networking', 'Statistics', 'Data Analysis', 'Data Science'].includes(s) || t.includes(norm(s)));
  if (!mentioned.length) return null;
  const mine = new Set((profile.skills || []).map((s) => s.toLowerCase()));
  const has = mentioned.some((s) => mine.has(s.toLowerCase()));
  const yearsAsked = /how many years|years of|number of years|\byrs\b|experience in years|duration|how long/.test(t) || f.type === 'number';
  if (yearsAsked && !/^(do|are|have|can) you\b/.test(t)) {
    if (!has) return { kind: 'years', raw: '0' };
    const per = Math.max(...mentioned.map((s) => Number(profile.skillYears?.[s])).filter(Number.isFinite), 0);
    const total = Number(profile.experienceYears) || 0;
    return { kind: 'years', raw: String(per > 0 ? Math.min(per, Math.max(total, per)) : total) };
  }
  const need = t.match(/(\d+(?:\.\d+)?)\s*\+?\s*(?:years|yrs)/);
  if (need && has) { const per = Math.max(...mentioned.map((x) => Number(profile.skillYears?.[x])).filter(Number.isFinite), 0); if (Math.max(per, Number(profile.experienceYears) || 0) < +need[1]) return { kind: 'yesno', raw: 'No' }; }
  if (f.type === 'select' || f.type === 'radio' || f.type === 'text' || f.type === 'textarea' || f.type === 'combobox' || f.type === 'checkbox') {
    const optsYesNo = !f.options?.length || f.options.some((o) => yesNo(o.text) || /\b(yes|no)\b/i.test(String(o.text)));
    if (optsYesNo) return { kind: 'yesno', raw: has ? 'Yes' : 'No' };
  }
  return null;
}
