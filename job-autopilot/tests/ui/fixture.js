// Realistic fake data for rendering the UI without Electron (used by the UI test and the screenshot script).
import { analytics } from '../../core/pipeline.js';

const DAY = 864e5, ago = (d, h = 0) => new Date(Date.now() - d * DAY - h * 36e5).toISOString();
const J = (i, o) => ({ id: `j${i}`, source: 'greenhouse', ats: 'greenhouse', company: 'Company', title: 'Role', location: 'Bengaluru, India', remote: false, url: 'https://x.test/' + i, applyUrl: 'https://x.test/' + i, postedAt: ago(1), firstSeen: ago(1), status: 'new', score: 70, decision: 'apply', reasons: [], skipReason: undefined, matchedSkills: [], salary: null, manual: false, ...o });

export const jobs = [
  J(1, { company: 'Razorpay', title: 'Machine Learning Engineer', score: 91, postedAt: ago(0, 2), reasons: ['Title matches your target AI/ML roles', 'In one of your cities (Bengaluru, India)', 'Skills you have: Python, PyTorch, NLP, SQL'], salary: { min: 1200000, max: 1800000 } }),
  J(2, { company: 'Sarvam AI', title: 'AI Engineer (Generative AI)', ats: 'ashby', source: 'ashby', score: 88, postedAt: ago(0, 5), location: 'Remote – India', remote: true, reasons: ['Title matches your target AI/ML roles', 'Remote and open to India', 'Does not state required experience'] }),
  J(3, { company: 'Freshworks', title: 'Data Scientist', ats: 'lever', source: 'lever', score: 80, postedAt: ago(1), location: 'Chennai, India', reasons: ['Title matches your target AI/ML roles', 'In one of your cities (Chennai, India)', 'Asks for 1+ years – you have about 1'], salary: { min: 800000, max: 1200000 } }),
  J(4, { company: 'Visa', title: 'Machine Learning Engineer – Fraud', ats: 'smartrecruiters', source: 'smartrecruiters', manual: true, score: 76, location: 'Bengaluru, India', reasons: ['Title matches your target AI/ML roles', 'In one of your cities (Bengaluru, India)'] }),
  J(5, { company: 'Postman', title: 'Applied AI Engineer', score: 74, status: 'awaiting', postedAt: ago(0, 8), reasons: ['Title matches your target AI/ML roles', 'Remote and open to India', 'Similar to jobs you approved (llm)'], salary: { min: 1500000, max: 2200000 } }),
  J(6, { company: 'Cred', title: 'ML Engineer – Risk', ats: 'lever', source: 'lever', score: 72, status: 'awaiting', reasons: ['Title matches your target AI/ML roles', 'In one of your cities (Bengaluru, India)'] }),
  J(7, { company: 'Groww', title: 'Data Analyst', score: 63, decision: 'apply', status: 'dry_run', reasons: ['Title is a related data/automation role', 'Pays 4–6 LPA – below your expectation'], salary: { min: 400000, max: 600000 } }),
  J(8, { company: 'Meesho', title: 'NLP Engineer', score: 58, decision: 'maybe', reasons: ['Title matches your target AI/ML roles', 'In India (Gurugram) – needs relocation'], location: 'Gurugram, India' }),
  J(9, { company: 'Acme Robotics', title: 'Computer Vision Engineer', score: 0, decision: 'skip', status: 'skipped', skipReason: 'Same job is listed on greenhouse', reasons: ['Same job is listed on greenhouse'] }),
  J(10, { company: 'Zeta', title: 'Python Developer', ats: 'workable', source: 'workable', score: 66, status: 'needs_you', reasons: ['Title is a related data/automation role'], location: 'Pune, India' }),
];

const A = (i, o) => ({ id: `a${i}`, jobId: `j${i}`, company: 'Company', title: 'Role', location: 'Bengaluru, India', ats: 'greenhouse', score: 75, mode: 'live', at: ago(3), status: 'applied', reason: 'Submitted and confirmed by the site', filled: [{ label: 'First name', value: 'Srinath', source: 'profile' }, { label: 'Email', value: 'srinath@example.com', source: 'profile' }], missing: [], ...o });
export const apps = [
  A(21, { company: 'Razorpay', title: 'Machine Learning Engineer', at: ago(12), stage: 'interview', interviewAt: new Date(Date.now() + 2 * DAY).toISOString(), history: [{ stage: 'replied', at: ago(8), source: 'email' }, { stage: 'interview', at: ago(6), source: 'email' }], emailEvidence: { subject: 'Interview invitation – Machine Learning Engineer', from: 'Razorpay Careers careers@razorpay.com', date: ago(6) }, score: 91 }),
  A(22, { company: 'Sarvam AI', title: 'AI Engineer (Generative AI)', ats: 'ashby', at: ago(9), stage: 'replied', history: [{ stage: 'replied', at: ago(4) }], score: 88 }),
  A(23, { company: 'Freshworks', title: 'Data Scientist', ats: 'lever', at: ago(10), followUpDue: true, location: 'Chennai, India', score: 80 }),
  A(24, { company: 'Cred', title: 'ML Engineer – Risk', ats: 'lever', at: ago(2), score: 72 }),
  A(25, { company: 'Meesho', title: 'NLP Engineer', at: ago(20), stage: 'rejected', history: [{ stage: 'rejected', at: ago(15), source: 'email' }], score: 69 }),
  A(26, { company: 'Visa', title: 'Machine Learning Engineer – Fraud', ats: 'smartrecruiters', mode: 'manual', at: ago(1), score: 76, reason: 'Applied by you on the company site' }),
  A(27, { company: 'Groww', title: 'Data Analyst', status: 'dry_run', reason: 'Form filled correctly – not submitted (dry run)', at: ago(1), score: 63 }),
  A(10, { company: 'Zeta', title: 'Python Developer', ats: 'workable', status: 'needs_you', reason: 'Needs your answer: Why do you want to work at Zeta?', missing: [{ label: 'Why do you want to work at Zeta?', why: 'needs your answer' }], at: ago(0, 3), location: 'Pune, India' }),
  A(28, { company: 'Postman', title: 'Applied AI Engineer', stage: 'offer', at: ago(30), score: 74, history: [{ stage: 'interview', at: ago(20) }, { stage: 'offer', at: ago(3) }] }),
].map((a) => ({ followUpDue: false, ...a }));

const perDay = {}; for (const a of apps) if (a.status === 'applied' || a.status === 'dry_run') { const d = a.at.slice(0, 10); perDay[d] = (perDay[d] || 0) + 1; }
const jobMap = Object.fromEntries(jobs.map((j) => [j.id, { ...j, eval: { score: j.score, decision: j.decision, matchedSkills: ['Python', 'PyTorch', 'NLP'].slice(0, 1 + (+j.id.slice(1) % 3)) } }]));

export const settings = {
  mode: 'live', autopilot: true, pollMinutes: 10, minScore: 62, maxPerDay: 15, maxPerCompany: 2, maxYearsRequired: 2, includeInternships: false, locations: ['Chennai', 'Bengaluru', 'Hyderabad', 'Pune'], acceptAnywhereInIndia: true, acceptRemote: true,
  roles: ['machine learning engineer', 'ai engineer'], excludeTitleWords: ['senior', 'lead'], approval: true, maxAgeDays: 45, followUpDays: 7, notifyManual: true, delaySeconds: [25, 70], activeHours: { from: 0, to: 24 }, startWithWindows: true, runInBackground: true,
  claude: { enabled: true, apiKey: '', hasKey: true, model: 'claude-opus-5-5' }, email: { enabled: false, host: 'smtp.gmail.com', port: 465, user: '', pass: '', hasPass: false }, adzuna: { appId: '', appKey: '', hasKey: false },
  inbox: { enabled: true, host: 'imap.gmail.com', port: 993, user: 'srinath@gmail.com', pass: '', hasPass: true }, sources: { greenhouse: true, lever: true, ashby: true, workable: true, smartrecruiters: true, remoteok: true, remotive: true, adzuna: false },
};
export const profile = { firstName: 'Srinath', lastName: 'Ravi', fullName: 'Srinath Ravi', email: 'srinath@example.com', phone: '9876543210', city: 'Chennai', linkedin: 'linkedin.com/in/srinath', github: 'github.com/srinath', website: '', headline: 'ML Engineer', currentCompany: 'Acme', currentTitle: 'Data Scientist', skills: ['Python', 'PyTorch', 'NLP', 'SQL', 'LLM'], experienceYears: 1, hasResume: true, resumeName: 'resume.pdf', answers: { noticePeriod: '30 days', currentCtc: '5 LPA', expectedCtc: '10 LPA', extra: [] } };
export const counts = { appliedToday: 3, appliedTotal: 7, dryRuns: 1, needsYou: 1, matches: 5, awaiting: 2, followUps: 1, upcoming: 1, jobsTotal: 1840, companies: 64, perDay };
export const state = (over = {}) => ({ profile, settings, status: { phase: 'idle', message: '', lastRun: new Date(Date.now() - 4 * 60000).toISOString(), nextRun: new Date(Date.now() + 6 * 60000).toISOString() }, running: true, counts, missing: [], version: '1.1.0', encrypted: true, ...over });
export const companies = [{ ats: 'greenhouse', token: 'razorpay', name: 'razorpay', enabled: true, total: 42, relevant: 11, health: { ok: true, count: 42 } }, { ats: 'lever', token: 'cred', name: 'cred', enabled: true, total: 18, relevant: 6, health: { ok: true, count: 18 } }, { ats: 'smartrecruiters', token: 'Visa', name: 'Visa', enabled: true, total: 30, relevant: 4, health: { ok: false, error: 'HTTP 404' } }];
export const log = [{ t: new Date().toISOString(), level: 'info', msg: 'Checked 64 boards: 1840 postings, 12 new, 4 worth a look' }, { t: new Date().toISOString(), level: 'info', msg: 'Waiting for your approval: Postman – Applied AI Engineer (score 74)' }, { t: new Date().toISOString(), level: 'warn', msg: 'Zeta – Python Developer: needs_you – Needs your answer: Why do you want to work at Zeta?' }, { t: new Date().toISOString(), level: 'info', msg: 'Email: Razorpay – Machine Learning Engineer → interview (“Interview invitation”)' }];
export const insights = analytics(apps, jobMap);
export const all = { state: state(), jobs, apps, companies, log, health: { greenhouse: { ok: true, count: 900 }, lever: { ok: true, count: 400 } }, insights };
