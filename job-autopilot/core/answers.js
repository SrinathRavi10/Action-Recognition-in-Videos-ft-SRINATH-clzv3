// Decide what to put in each form field. Order: your own Q&A (fuzzy) → catalog of common question types (core/qbank.js)
// → (optional) Claude, grounded in the resume. Anything that cannot be answered honestly is left unresolved – the app
// remembers it as a pending question so you only ever answer it once.
import { norm } from './util.js';
import { findEntry, userValue, derivedValue, shape, chooseOption, pickDecline, skillAnswer, matchQa, CONSENT_YES, CONSENT_NO } from './qbank.js';

export { chooseOption };

const NEVER = /aadhaar|aadhar|pan card|\bpan\b number|ssn|social security|national id|voter id|bank account|ifsc|credit card/;

/**
 * @param {object} f   a field from __JA.scan()
 * @param {{profile:object, job:object, coverLetter?:string, settings?:object}} ctx
 * @returns {{value:any, source:string, qa?:string}|{skip:true, why:string}|{upload:..}|null}
 */
/** {company} / {role} placeholders in answers you wrote once ("I'm excited by {company}'s work in …"). */
export const fillTemplate = (v, job = {}) => (typeof v === 'string' ? v.replace(/\{company\}/gi, job.company || 'your company').replace(/\{(role|title|position)\}/gi, job.title || 'this role') : v);

export function resolve(f, ctx) {
  const r = resolveRaw(f, ctx);
  if (r && typeof r.value === 'string' && r.value.includes('{')) r.value = fillTemplate(r.value, ctx.job);
  return r;
}

function resolveRaw(f, ctx) {
  const { profile: p, coverLetter } = ctx;
  const a = p.answers || {};
  const label = norm(`${f.label} ${f.name || ''}`.replace(/_/g, ' '));
  const L = (re) => re.test(label);
  const forOptions = (value, source) => {
    if (!value) return null;
    if (f.options?.length) { const o = chooseOption(f.options, value); return o ? { value: o, source } : null; }
    return { value, source };
  };

  // 0. your own keyword answers (older feature, still honoured)
  for (const x of a.extra || []) if (x.match && label.includes(norm(x.match)) && x.answer) return forOptions(x.answer, 'bank');

  // files
  if (f.type === 'file') {
    if (L(/resume|cv|curriculum/) || (!L(/cover|letter|photo|transcript|certificate|portfolio|marksheet|id proof|identity|aadhaar|passport/) && f.required !== false)) return p.resumePath ? { value: p.resumePath, source: 'profile', upload: 'resume' } : { skip: true, why: 'no resume uploaded' };
    if (L(/cover/)) return { skip: true, why: 'cover letter file not supported' };
    return { skip: true, why: 'file not needed' };
  }

  // 1. your personal Q&A (typed by you, learned earlier, or fuzzy-similar to something you answered)
  const mine = matchQa(p.qa, f.label || f.name, 0.72, ctx.job);
  if (mine && mine.answer) {
    const s = f.type === 'checkbox' && mine.kind === 'yesno' ? { value: /^y/i.test(mine.answer) } : shape(mine.answer, { kind: mine.kind || 'text', id: `qa:${mine.id}` }, f, ctx);
    return s ? { value: s.value, source: mine.source === 'claude' ? 'learned' : 'bank', qa: mine.id } : null;
  }

  // consent / acknowledgement boxes
  if (f.type === 'checkbox') {
    if (CONSENT_NO.test(label)) return { value: false, source: 'default' };
    if (CONSENT_YES.test(label)) return { value: true, source: 'default' };
    const e = findEntry(f.label || f.name);
    if (e?.kind === 'yesno') { const raw = userValue(e, p) || derivedValue(e, ctx); const s = raw && shape(raw, e, f, ctx); if (s) return { value: s.value, source: 'profile', qa: e.id }; }
    return null;
  }

  if (NEVER.test(label)) return f.required ? null : { skip: true, why: 'never shared' };

  // 2. questions about one specific technology ("Do you have experience with PyTorch?", "Years of experience in SQL")
  const sk = skillAnswer(f.label || '', f, p);
  if (sk) { const s = shape(sk.raw, { kind: sk.kind, id: 'skill' }, f, ctx); if (s) return { value: s.value, source: 'profile', qa: 'skill' }; }

  // 3. the catalog of common question types
  const e = findEntry(f.label || f.name || f.placeholder);
  if (!e) return null;
  const user = userValue(e, p);
  if (e.optionalOnly && !f.required && !user) return { skip: true, why: 'optional free text' };
  if (e.generated && !user) {
    if (e.id === 'cover_letter' && coverLetter) return { value: coverLetter, source: 'generated', qa: e.id };
    if (e.optionalOnly && !f.required) return { skip: true, why: 'optional free text' };
    const d = derivedValue(e, ctx);
    if (!d) return f.required ? null : { skip: true, why: 'optional free text' };
  }
  let raw = user;
  if (!raw) {
    const d = e.derive ? e.derive(ctx) : null;
    raw = d && typeof d === 'object' ? (/(^| )(city|town)( |$)/.test(label) && !/location|where|based|reside/.test(label) ? d.text : d.withCountry) : d;
  }
  if (!raw) {
    if (e.sensitive) {
      const dec = pickDecline(f.options);
      if (dec) return { value: dec, source: 'default', qa: e.id };
      return f.required ? null : { skip: true, why: 'optional demographic question' };
    }
    return f.required ? null : { skip: true, why: 'optional – no answer on file' };
  }
  const s = shape(raw, e, f, ctx);
  if (!s) return null;
  return { value: s.value, source: user ? 'bank' : 'profile', qa: e.id };
}

/** Fields we have no honest deterministic answer for (excluding files). */
export function unresolved(fields, ctx) {
  const out = [];
  for (const f of fields) {
    if (f.type === 'file') continue;
    const r = resolve(f, ctx);
    if (!r) out.push(f);
  }
  return out;
}

/** Is this question general enough to remember an answer for next time (not about this company / role)? */
export function reusable(f, job = {}) {
  const t = norm(f.label || '');
  if (!t || t.length > 180 || f.type === 'textarea' || /why |cover letter|describe |tell us/.test(t)) return false;
  for (const w of [job.company, job.title].map(norm).filter((x) => x && x.length > 3)) if (t.includes(w)) return false;
  return true;
}
