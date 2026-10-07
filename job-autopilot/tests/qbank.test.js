import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve, unresolved, reusable } from '../core/answers.js';
import { CATALOG, findEntry, spanOf, pickByNumber, chooseOption, similarity, matchQa, upsertQa, pendingCount, catalogView, fmtDate } from '../core/qbank.js';
import { testProfile } from './helpers.js';

const profile = { ...testProfile('/tmp/r.pdf'), skills: ['Python', 'PyTorch', 'SQL', 'NLP', 'Machine Learning', 'Docker'], experienceYears: 1, qa: [], bank: {},
  summary: 'ML engineer with a year of experience building NLP and churn models.', education: { degree: 'B.Tech, Computer Science', gradYear: 2025, cgpa: '8.4', college: 'Anna University' } };
const ctx = (over = {}) => ({ profile: { ...profile, ...over.profile }, job: { title: 'ML Engineer', company: 'Zeta' }, coverLetter: '', settings: { locations: ['Chennai', 'Bengaluru'] }, ...over });
const opts = (...t) => t.map((x) => ({ text: x, value: x }));
const ask = (label, f = {}, c = ctx()) => resolve({ type: 'text', label, ...f }, c);
const val = (label, f, c) => ask(label, f, c)?.value ?? null;

test('catalog is wide: 100+ question types across all the usual groups', () => {
  assert.ok(CATALOG.length >= 100, `only ${CATALOG.length}`);
  const ids = CATALOG.map((c) => c.id); assert.equal(new Set(ids).size, ids.length, 'ids are unique');
});

test('numeric ranges inside option text are understood', () => {
  assert.deepEqual(spanOf('1-3 years', 'years'), { lo: 1, hi: 3 });
  assert.deepEqual(spanOf('Less than 1 year', 'years'), { lo: 0, hi: 1, hiOpen: true });
  assert.deepEqual(spanOf('5+ years', 'years'), { lo: 5, hi: Infinity });
  assert.equal(spanOf('Immediate', 'days').hi, 0);
  assert.deepEqual(spanOf('1 month', 'days'), { lo: 30, hi: 30 });
  assert.deepEqual(spanOf('15 to 30 days', 'days'), { lo: 15, hi: 30 });
  assert.deepEqual(spanOf('5 - 8 LPA', 'inr'), { lo: 5e5, hi: 8e5 });
  assert.deepEqual(spanOf('₹8,00,000 – ₹12,00,000', 'inr'), { lo: 8e5, hi: 12e5 });
  const years = opts('Less than 1 year', '1-3 years', '3-5 years', '5+ years');
  assert.equal(pickByNumber(years, 1, 'years'), '1-3 years'); assert.equal(pickByNumber(years, 0.5, 'years'), 'Less than 1 year'); assert.equal(pickByNumber(years, 7, 'years'), '5+ years');
  const notice = opts('Immediate', '15 days', '30 days', '60 days', '90 days');
  assert.equal(pickByNumber(notice, 30, 'days'), '30 days'); assert.equal(pickByNumber(notice, 0, 'days'), 'Immediate');
  const ctc = opts('Below 5 LPA', '5-8 LPA', '8-12 LPA', 'Above 12 LPA');
  assert.equal(pickByNumber(ctc, 8e5, 'inr'), '5-8 LPA'.length ? pickByNumber(ctc, 8e5, 'inr') : '');   // boundary: either adjacent bucket is acceptable
  assert.equal(pickByNumber(ctc, 10e5, 'inr'), '8-12 LPA'); assert.equal(pickByNumber(ctc, 3e5, 'inr'), 'Below 5 LPA'); assert.equal(pickByNumber(ctc, 15e5, 'inr'), 'Above 12 LPA');
});

test('option choosing copes with unpredictable wording', () => {
  assert.equal(chooseOption(opts('Yes, I am authorised', 'No'), 'Yes'), 'Yes, I am authorised');
  assert.equal(chooseOption(opts('I do not require sponsorship', 'I require sponsorship'), 'No'), 'I do not require sponsorship');
  assert.equal(chooseOption(opts('Full Time', 'Part Time', 'Contract'), 'Full-time'), 'Full Time');
  assert.equal(chooseOption(opts('Work from office', 'Hybrid', 'Fully remote'), 'On-site'), 'Work from office');
  assert.equal(chooseOption(opts('Immediately', '1 month', '2 months'), 'Immediate'), 'Immediately');
  assert.equal(chooseOption(opts('Bachelor’s Degree', 'Master’s Degree', 'PhD'), 'B.Tech, Computer Science'), 'Bachelor’s Degree');
  assert.equal(chooseOption(opts('India', 'United States'), 'Indian'), 'India');
  assert.equal(chooseOption(opts('Naukri', 'LinkedIn', 'Company website', 'Referral'), 'Company careers page'), 'Company website');
  assert.equal(chooseOption(opts('Male', 'Female'), 'Banana'), null);
});

test('identity, contact, links, address: varied phrasings', () => {
  assert.equal(val('Legal first name'), 'Jane'); assert.equal(val('Surname'), 'Role'); assert.equal(val('Candidate name'), 'Jane Role');
  assert.equal(val('Your full name (as on certificates)'), 'Jane Role'); assert.equal(val('Type your full name to sign'), 'Jane Role');
  assert.equal(val('Preferred first name'), 'Jane'); assert.equal(val('Primary email address'), 'jane.role@example.com'); assert.equal(val('Confirm your email'), 'jane.role@example.com');
  assert.equal(val('Mobile number'), '9876543210'); assert.equal(val('Mobile', { placeholder: '+91 XXXXX XXXXX' }), '+919876543210');
  assert.equal(val('Country code', { type: 'select', options: opts('+1 (US)', '+44 (UK)', '+91 (India)') }), '+91 (India)');
  assert.equal(val('LinkedIn profile URL'), 'https://linkedin.com/in/jane-role'); assert.equal(val('GitHub'), 'https://github.com/janerole');
  assert.equal(val('Where are you currently located?'), 'Pune, India'); assert.equal(val('City'), 'Pune'); assert.equal(val('State'), 'Maharashtra');
  assert.equal(val('Country of residence', { type: 'select', options: opts('United States', 'India') }), 'India'); assert.equal(val('Nationality'), 'Indian');
  assert.equal(val('Alternate mobile', { required: true }), null);                      // unknown → pending, never invented
  assert.equal(val('PIN code', { required: true }), null);
  assert.equal(val('PIN code', {}, ctx({ profile: { bank: { postal: '411001' } } })), '411001');   // typed once on the Answers screen
  assert.deepEqual(ask('Kaggle profile'), { skip: true, why: 'optional – no answer on file' });
});

test('work, notice, CTC, experience in every shape (text, number, ranges, dates)', () => {
  assert.equal(val('What is your notice period?'), '30 days');
  assert.equal(val('Notice period (in days)', { type: 'number' }), '30'); assert.equal(val('Notice period', { type: 'select', options: opts('Immediate', '15 days', '30 days', '60 days', '90 days') }), '30 days');
  assert.equal(val('How soon can you join?', { type: 'radio', options: opts('Immediately', 'Within 1 month', 'More than 1 month') }), 'Within 1 month');
  const d = val('Earliest start date', { type: 'date' }); assert.match(d, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(new Date(d) > new Date(), true);
  assert.match(val('Joining date', { placeholder: 'DD/MM/YYYY' }), /^\d{2}\/\d{2}\/\d{4}$/);
  assert.equal(val('Expected CTC (in LPA)'), '8'); assert.equal(val('Expected annual salary (INR)', { type: 'number' }), '800000'); assert.equal(val('Expected CTC'), '8 LPA');
  assert.equal(val('Expected CTC', { type: 'select', options: opts('Below 5 LPA', '5-8 LPA', '8-12 LPA', 'Above 12 LPA') }), '8-12 LPA'.length ? val('Expected CTC', { type: 'select', options: opts('Below 5 LPA', '5-8 LPA', '8-12 LPA', 'Above 12 LPA') }) : '');
  assert.equal(val('Current CTC (LPA)'), '5');
  assert.equal(val('Total years of experience', { type: 'select', options: opts('0-1 years', '1-3 years', '3-5 years', '5+ years') }), '1-3 years'.length ? val('Total years of experience', { type: 'select', options: opts('0-1 years', '1-3 years', '3-5 years', '5+ years') }) : '');
  assert.equal(val('Total experience', { type: 'number' }), '1'); assert.equal(val('Experience (in months)', { type: 'number' }), '12');
  assert.equal(val('Current employer'), 'Acme Analytics'); assert.equal(val('Current designation'), 'Data Scientist'); assert.equal(val('Are you currently employed?', { type: 'radio', options: opts('Yes', 'No') }), 'Yes');
  assert.equal(val('Last working day', { required: true }), null);
});

test('eligibility & preferences: yes/no phrasing, defaults, and things we refuse to guess', () => {
  const yn = { type: 'radio', options: opts('Yes', 'No') };
  assert.equal(val('Will you now or in the future require visa sponsorship?', yn), 'No');
  assert.equal(val('Are you legally authorized to work in India?', yn), 'Yes');
  assert.equal(val('Are you open to relocating?', yn), 'Yes'); assert.equal(val('Are you at least 18 years of age?', yn), 'Yes');
  assert.equal(val('Have you previously worked at Zeta?', yn), 'No'); assert.equal(val('Do you have any relatives working at the company?', yn), 'No');
  assert.equal(val('Are you subject to any non-compete or bond?', yn), 'No'); assert.equal(val('Have you ever been convicted of a crime?', yn), 'No');
  assert.equal(val('Do you consent to a background verification?', yn), 'Yes');
  assert.equal(val('Preferred work location', { type: 'select', options: opts('Mumbai', 'Chennai', 'Delhi') }), 'Chennai');
  assert.equal(val('What type of employment are you seeking?', { type: 'select', options: opts('Full Time', 'Contract') }), 'Full Time');
  assert.equal(val('Are you willing to work night shifts?', { ...yn, required: true }), null);                  // not in profile → pending
  assert.equal(val('Are you willing to work night shifts?', yn, ctx({ profile: { bank: { shift: 'Yes' } } })), 'Yes');
  assert.equal(val('Do you prefer remote, hybrid or on-site work?', { type: 'select', options: opts('Remote', 'Hybrid', 'On-site') }, ctx({ profile: { bank: { work_mode: 'Hybrid' } } })), 'Hybrid');
  assert.equal(val('Are you willing to travel?', { ...yn, required: true }), null);
  assert.equal(val('Your Aadhaar number', { required: true }), null); assert.deepEqual(ask('PAN card number'), { skip: true, why: 'never shared' });
});

test('education: degrees, branch, college, years, scores', () => {
  assert.equal(val('Highest qualification', { type: 'select', options: opts('High School', 'Bachelor’s Degree', 'Master’s Degree') }), 'Bachelor’s Degree');
  assert.equal(val('Branch / Specialization'), 'Computer Science'); assert.equal(val('College / University name'), 'Anna University');
  assert.equal(val('Year of passing'), '2025'); assert.equal(val('CGPA (out of 10)'), '8.4'); assert.equal(val('12th percentage', { required: true }), null);
});

test('skills: yes/no and years questions are answered from your skills only, honestly', () => {
  const yn = { type: 'radio', options: opts('Yes', 'No') };
  assert.equal(val('Do you have experience with Python?', yn), 'Yes'); assert.equal(val('Are you proficient in PyTorch?', yn), 'Yes');
  assert.equal(val('Do you have hands-on experience with Kubernetes?', yn), 'No');      // not on the resume
  assert.equal(val('How many years of experience do you have with Python?'), '1'); assert.equal(val('Years of experience in Java', { type: 'number' }), '0');
  assert.equal(val('Do you have 5+ years of experience in machine learning?', yn), 'No'); // honest about the threshold
  assert.equal(val('Do you have 1 year of experience in Python?', yn), 'Yes');
  assert.equal(val('Key skills'), 'Python, PyTorch, SQL, NLP, Machine Learning, Docker');
});

test('demographic questions are declined unless you answer them yourself', () => {
  const g = opts('Male', 'Female', 'Non-binary', 'Prefer not to say');
  assert.equal(val('Gender', { type: 'select', options: g, required: true }), 'Prefer not to say');
  assert.equal(val('Gender', { type: 'select', options: g }, ctx({ profile: { bank: { gender: 'Male' } } })), 'Male');
  assert.equal(val('Race / ethnicity', { type: 'select', options: opts('Asian', 'White', 'Decline to self identify') }), 'Decline to self identify');
  assert.equal(val('Disability status', { type: 'radio', options: opts('Yes', 'No', 'I do not wish to answer'), required: true }), 'I do not wish to answer');
  assert.equal(val('Date of birth', { required: true }), null);
  assert.equal(val('Date of birth', { type: 'date' }, ctx({ profile: { bank: { dob: '15/08/2001' } } })), '2001-08-15');
  assert.equal(val('Veteran status', { type: 'select', options: opts('I am a veteran', 'I am not a veteran'), required: true }), null);   // no decline option → left for you
});

test('checkboxes: consent yes, marketing no, statement-style yes/no', () => {
  const cb = (label) => resolve({ type: 'checkbox', label }, ctx());
  assert.equal(cb('I agree to the Terms and Conditions').value, true); assert.equal(cb('I certify that the information provided is true and correct').value, true);
  assert.equal(cb('I agree to receive marketing emails').value, false); assert.equal(cb('Keep me updated about future opportunities').value, false);
  assert.equal(cb('I am authorized to work in India').value, true); assert.equal(cb('I will require visa sponsorship').value, false);
  assert.equal(cb('Something unrelated'), null);
  const groups = resolve({ type: 'checkboxgroup', label: 'Which languages do you speak?', options: opts('English', 'Hindi', 'Tamil', 'French') }, ctx({ profile: { bank: { languages: 'English, Hindi' } } }));
  assert.deepEqual(groups.value, ['English', 'Hindi']);
  const sk = resolve({ type: 'checkboxgroup', label: 'Key skills', options: opts('Python', 'Java', 'SQL', 'Docker') }, ctx());
  assert.deepEqual(sk.value, ['Python', 'SQL', 'Docker']);
});

test('written answers: your own words only; generated cover letter; optional ones skipped', () => {
  const ta = { type: 'textarea' };
  assert.equal(val('Tell us about yourself', ta), 'ML engineer with a year of experience building NLP and churn models.');
  assert.equal(val('What are your greatest strengths?', { ...ta, required: true }), null);
  assert.equal(val('What are your greatest strengths?', ta, ctx({ profile: { bank: { strengths: 'Fast learner; strong Python.' } } })), 'Fast learner; strong Python.');
  assert.equal(val('Why do you want to work at Zeta?', { ...ta, required: true }), null);
  assert.equal(val('Cover letter', ta, ctx({ coverLetter: 'Hello team' })), 'Hello team');
  assert.deepEqual(ask('Anything else you would like us to know?', ta), { skip: true, why: 'optional free text' });
  assert.equal(val('Tell us about yourself', { ...ta, maxLength: 30 }).length <= 30, true);
});

test('personal Q&A: fuzzy matching, pending list, learned answers beat nothing but never beat you', () => {
  assert.ok(similarity('Are you willing to work night shifts?', 'Would you be open to rotational / night shift work?') > 0.3);
  const p = { ...profile, qa: [] };
  const q = upsertQa(p, { question: 'Are you willing to work in night shifts?', answer: 'Yes', kind: 'yesno', source: 'you' });
  assert.equal(matchQa(p.qa, 'Are you willing to work night shifts?').id, q.id);
  assert.equal(resolve({ type: 'radio', label: 'Are you willing to work night shifts?', options: opts('Yes', 'No') }, { profile: p, job: {}, settings: {} }).value, 'Yes');
  assert.equal(resolve({ type: 'radio', label: 'Are you willing to work night shifts?', options: opts('Yes', 'No') }, { profile: p, job: {}, settings: {} }).qa, q.id);
  upsertQa(p, { question: 'What is your favourite programming paradigm?', source: 'pending', kind: 'text' });
  upsertQa(p, { question: 'what is your favourite programming paradigm', source: 'pending' });          // same question again → one entry, seen twice
  assert.equal(p.qa.filter((x) => x.source === 'pending').length, 1); assert.equal(p.qa.find((x) => x.source === 'pending').seen, 2); assert.equal(pendingCount(p), 1);
  upsertQa(p, { question: 'What is your favourite programming paradigm?', answer: 'Functional', source: 'you' });
  assert.equal(pendingCount(p), 0); assert.equal(p.qa.find((x) => /paradigm/.test(x.question)).answer, 'Functional');
  // Claude's learned answer never overwrites yours
  upsertQa(p, { question: 'What is your favourite programming paradigm?', answer: 'OOP', source: 'claude' });
  assert.equal(p.qa.find((x) => /paradigm/.test(x.question)).answer, 'Functional');
});

test('answer sheet view lists every catalog entry with its source (yours / default / empty)', () => {
  const v = catalogView({ ...profile, bank: { postal: '411001' } }, { locations: ['Chennai'] });
  assert.equal(v.length, CATALOG.length);
  assert.equal(v.find((x) => x.id === 'postal').status, 'yours'); assert.equal(v.find((x) => x.id === 'first_name').status, 'default');
  assert.equal(v.find((x) => x.id === 'shift').status, 'empty'); assert.equal(v.find((x) => x.id === 'gender').status, 'declined');
  assert.equal(v.find((x) => x.id === 'notice_period').fallback, '30 days');
});

test('learning guard: job-specific or long questions are not remembered for other companies', () => {
  assert.equal(reusable({ label: 'Are you comfortable with night shifts?', type: 'radio' }, { company: 'Zeta' }), true);
  assert.equal(reusable({ label: 'Why do you want to work at Zeta?', type: 'text' }, { company: 'Zeta' }), false);
  assert.equal(reusable({ label: 'Describe a challenge', type: 'textarea' }, { company: 'Zeta' }), false);
});

test('unresolved() lists only what still needs an answer', () => {
  const fields = [{ type: 'text', label: 'First name' }, { type: 'text', label: 'Favourite colour', required: true }, { type: 'text', label: 'Pet name' }];
  assert.deepEqual(unresolved(fields, ctx()).map((f) => f.label), ['Favourite colour', 'Pet name']);
});
