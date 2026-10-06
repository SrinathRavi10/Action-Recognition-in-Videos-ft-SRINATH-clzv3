// Decide what to put in each form field. Order: facts from the profile → the user's own answer bank → (optional) Claude,
// grounded in the resume. Anything that cannot be answered honestly is left unresolved rather than guessed.
import { norm } from './util.js';

const DECLINE = /prefer not|decline|do not wish|don'?t wish|not to say|rather not|choose not|no answer/i;
const YES = /^(yes|y|true|i am|i do|i have|i will)\b/i;

export function chooseOption(options, desired) {
  if (!options?.length) return null;
  const d = String(desired ?? '').trim();
  if (!d) return null;
  const txt = (o) => String(o.text ?? o.value ?? '');
  const exact = options.find((o) => norm(txt(o)) === norm(d));
  if (exact) return txt(exact);
  if (/^(yes|no)\b/i.test(d)) {
    const want = /^yes/i.test(d) ? /^yes\b/i : /^no\b/i;
    const m = options.find((o) => want.test(txt(o).trim()));
    if (m) return txt(m);
  }
  const partial = options.find((o) => norm(txt(o)).includes(norm(d)) && norm(d).length > 2) || options.find((o) => norm(d).includes(norm(txt(o))) && norm(txt(o)).length > 3);
  return partial ? txt(partial) : null;
}
const pickDecline = (options) => { const o = (options || []).find((x) => DECLINE.test(String(x.text ?? x.value))); return o ? String(o.text ?? o.value) : null; };

/** Years as a string like "1" or "1.5". */
const years = (p) => String(p.experienceYears ?? 0).replace(/\.0$/, '');

/**
 * @param {object} f   a field from __JA.scan()
 * @param {{profile:object, job:object, coverLetter?:string}} ctx
 * @returns {{value:any, source:string}|{skip:true, why:string}|null}
 */
export function resolve(f, ctx) {
  const { profile: p, coverLetter } = ctx;
  const a = p.answers || {};
  const label = norm(`${f.label} ${f.name || ''}`.replace(/_/g, ' '));
  const L = (re) => re.test(label);
  const val = (value, source = 'profile') => (value === '' || value == null ? null : { value, source });
  const forOptions = (value, source = 'profile') => {
    if (!value) return null;
    if (f.options?.length) { const o = chooseOption(f.options, value); return o ? { value: o, source } : null; }
    return { value, source };
  };

  // user-defined overrides first
  for (const x of a.extra || []) if (x.match && label.includes(norm(x.match)) && x.answer) return forOptions(x.answer, 'bank');

  if (f.type === 'file') {
    if (L(/resume|cv|curriculum/) || (!L(/cover|letter|photo|transcript|certificate|portfolio/) && f.required !== false)) return p.resumePath ? { value: p.resumePath, source: 'profile', upload: 'resume' } : { skip: true, why: 'no resume uploaded' };
    if (L(/cover/)) return { skip: true, why: 'cover letter file not supported' };
    return { skip: true, why: 'file not needed' };
  }

  // consent / acknowledgement boxes
  if (f.type === 'checkbox') {
    if (L(/agree|consent|acknowledge|privacy|terms|certify|confirm|accurate|true and correct|read and understood|gdpr|data processing/)) return { value: true, source: 'default' };
    if (L(/subscribe|newsletter|marketing|updates|future (roles|opportunit)|talent (community|network)|sms|whatsapp|text me/)) return { value: false, source: 'default' };
    return null;
  }

  // demographic / sensitive: decline where possible, otherwise leave
  if (L(/gender|sex\b|race|ethnic|veteran|disabilit|pronoun|sexual orientation|religion|caste|marital|transgender|lgbt/)) {
    const d = pickDecline(f.options);
    if (d) return { value: d, source: 'default' };
    return f.required ? null : { skip: true, why: 'optional demographic question' };
  }
  if (L(/date of birth|\bdob\b|\bage\b|aadhaar|pan card|passport/)) return f.required ? null : { skip: true, why: 'not shared' };

  // identity & contact
  if (L(/first name|given name|\bfname\b/)) return val(p.firstName);
  if (L(/last name|surname|family name|\blname\b/)) return val(p.lastName);
  if (L(/preferred (first )?name/)) return val(p.firstName);
  if (L(/^(full |legal |your )?name$|^name\b|full name|legal name|your name/)) return val(p.fullName || `${p.firstName} ${p.lastName}`.trim());
  if (L(/e ?mail/)) return val(p.email);
  if (f.type === 'tel' || L(/phone|mobile|contact number|telephone|whatsapp number|cell/)) return L(/country code/) ? null : val(p.phone);
  if (L(/linkedin/)) return val(p.linkedin ? (p.linkedin.startsWith('http') ? p.linkedin : `https://${p.linkedin}`) : '');
  if (L(/github/)) return val(p.github ? (p.github.startsWith('http') ? p.github : `https://${p.github}`) : '');
  if (L(/portfolio|personal (site|website|url)|^website|blog|other (link|website)|^url$|link to your work/)) return val(p.website || (p.github ? `https://${p.github.replace(/^https?:\/\//, '')}` : '') || (p.linkedin ? `https://${p.linkedin.replace(/^https?:\/\//, '')}` : ''));
  if (L(/current (location|city)|where are you (based|located|currently)|^location|^city|city of residence|^address/) && !L(/preferred|relocat/)) return val(p.city ? `${p.city}, India` : p.location);
  if (L(/^country|country of residence|country you/)) return forOptions(p.country || 'India');
  if (L(/current (company|employer|organi[sz]ation)|present (company|employer)|employer name|company name/)) return val(p.currentCompany);
  if (L(/current (job )?title|current (role|designation)|^designation|job title/)) return val(p.currentTitle);
  if (L(/(total|overall|relevant|professional|work).{0,20}experience|years of (work |professional )?experience|experience in years|how many years/)) return forOptions(years(p));

  // India-specific
  if (L(/notice period|how soon can you join|joining time|availability to join|when can you (start|join)/)) return forOptions(a.noticePeriod, 'bank');
  if (L(/current (ctc|salary|compensation|package)|present (ctc|salary)|fixed (ctc|salary)/)) return forOptions(a.currentCtc, 'bank');
  if (L(/expected (ctc|salary|compensation|package)|salary expectation|desired (salary|ctc)|ctc expectation/)) return forOptions(a.expectedCtc, 'bank');

  // eligibility
  if (L(/sponsor|visa/)) return forOptions(a.requireSponsorship || 'No', 'bank');
  if (L(/authori[sz]ed to work|work authori[sz]ation|legally (eligible|authori[sz]ed|permitted)|right to work|eligible to work|work permit/)) return forOptions(YES.test(a.workAuthorization || '') ? 'Yes' : a.workAuthorization, 'bank');
  if (L(/relocat|willing to (move|work (from|in|at))|open to (relocation|working)/)) return forOptions(YES.test(a.willingToRelocate || 'Yes') ? 'Yes' : a.willingToRelocate, 'bank');
  if (L(/how did you (hear|find|learn)|where did you (hear|find)|^source|referral source/)) return forOptions(a.howDidYouHear || 'Company careers page', 'bank');
  if (L(/previously (worked|employed|applied)|worked (here|for us) before|former employee/)) return forOptions('No', 'default');
  if (L(/18 years|over the age|at least 18/)) return forOptions('Yes', 'default');

  // education
  if (L(/graduat(ion|ed) year|year of (passing|graduation)|passing year/)) return val(p.education?.gradYear ? String(p.education.gradYear) : '');
  if (L(/cgpa|gpa|percentage|aggregate/)) return val(p.education?.cgpa);
  if (L(/degree|qualification|highest (level of )?education/)) return f.options?.length ? forOptions(/b\.?\s?tech|b\.?e\b|bachelor/i.test(p.education?.degree || '') ? "Bachelor's" : p.education?.degree) : val(p.education?.degree);

  // free text
  if (f.type === 'textarea' || f.type === 'text') {
    if (L(/cover letter|covering letter|letter of interest/)) return coverLetter ? { value: coverLetter, source: 'generated' } : null;
    if (L(/additional information|anything else|comments|tell us (more )?about yourself|introduce yourself|summary|about you/) && !f.required) return { skip: true, why: 'optional free text' };
  }
  return null;
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
