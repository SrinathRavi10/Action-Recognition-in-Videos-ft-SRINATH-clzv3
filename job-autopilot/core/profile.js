// Profile + settings model, defaults and "is this ready to apply live?" checks.

export const DEFAULT_SETTINGS = () => ({
  mode: 'dry',                 // 'dry' = fill forms and save a screenshot but do NOT submit; 'live' = submit
  autopilot: false,            // keep searching and applying in the background
  pollMinutes: 10,
  minScore: 62,                // only apply when the match score is at least this
  maxPerDay: 15,
  maxPerCompany: 2,            // per 60 days
  maxYearsRequired: 2,         // skip jobs that demand more years than this
  includeInternships: false,
  locations: ['Chennai', 'Bengaluru', 'Hyderabad', 'Pune'],
  acceptAnywhereInIndia: true, // willing to relocate within India
  acceptRemote: true,
  roles: [
    'machine learning engineer', 'ml engineer', 'ai engineer', 'ai/ml engineer', 'aiml engineer', 'data scientist', 'generative ai', 'genai', 'llm', 'nlp engineer',
    'computer vision', 'deep learning', 'applied ai', 'data analyst', 'automation engineer', 'rpa', 'python developer', 'data engineer', 'mlops',
  ],
  excludeTitleWords: ['senior', 'sr.', 'sr ', 'lead', 'principal', 'staff', 'manager', 'director', 'head of', 'architect', 'vp ', 'chief', 'president', 'distinguished'],
  approval: false,             // live mode: ask me before each application (queue them under "Approvals")
  maxAgeDays: 45,              // ignore postings older than this (usually stale / ghost listings)
  followUpDays: 7,             // suggest a follow-up if nobody has replied after this many days
  notifyManual: true,          // tell me about good matches on sites the app cannot fill itself
  delaySeconds: [25, 70],      // pause between applications (looks human, avoids hammering sites)
  activeHours: { from: 0, to: 24 },
  startWithWindows: true,
  runInBackground: true,
  claude: { enabled: false, apiKey: '', model: 'claude-opus-5-5' },
  email: { enabled: false, host: 'smtp.gmail.com', port: 465, user: '', pass: '' },
  adzuna: { appId: '', appKey: '' },
  inbox: { enabled: false, host: 'imap.gmail.com', port: 993, user: '', pass: '' },
  sources: { greenhouse: true, lever: true, ashby: true, workable: true, smartrecruiters: true, remoteok: true, remotive: true, adzuna: false },
  sourceBase: {},              // test/override base URLs
});

export const DEFAULT_ANSWERS = () => ({
  noticePeriod: '',            // e.g. "30 days"
  currentCtc: '',              // e.g. "4.2 LPA"
  expectedCtc: '',
  workAuthorization: 'Yes – I am an Indian citizen and authorised to work in India.',
  requireSponsorship: 'No',
  willingToRelocate: 'Yes',
  howDidYouHear: 'Company careers page',
  coverLetterIntro: '',
  extra: [],                   // [{ match: 'keyword in question', answer: '…' }]
});

export const emptyProfile = () => ({
  firstName: '', lastName: '', fullName: '', email: '', phone: '', location: '', city: '', country: 'India', linkedin: '', github: '', website: '', headline: '',
  skills: [], experienceYears: 0, experienceMonths: 0, education: { degree: '', gradYear: null, cgpa: '' }, currentCompany: '', currentTitle: '', summary: '',
  resumePath: '', resumeText: '', answers: DEFAULT_ANSWERS(),
});

/** What the user still has to fill in before live applying makes sense. */
export function missingForLive(profile) {
  const m = [];
  if (!profile.resumePath) m.push('Upload your resume');
  if (!profile.firstName || !profile.lastName) m.push('Your name');
  if (!profile.email) m.push('Email');
  if (!profile.phone) m.push('Phone number');
  const a = profile.answers || {};
  if (!a.noticePeriod) m.push('Notice period');
  if (!a.expectedCtc) m.push('Expected salary (CTC)');
  return m;
}
