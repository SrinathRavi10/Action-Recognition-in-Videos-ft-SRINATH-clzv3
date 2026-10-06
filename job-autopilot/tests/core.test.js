import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseResume, monthsCovered } from '../core/resume.js';
import { evaluate, requiredYears, locationInfo, skillsIn } from '../core/match.js';
import { DEFAULT_SETTINGS, emptyProfile, missingForLive } from '../core/profile.js';
import { detectAts } from '../core/ats.js';
import { companyFromUrl } from '../core/companies.js';
import { htmlToText } from '../core/util.js';
import { Store } from '../core/store.js';
import * as src from '../core/sources/index.js';

const fx = (n) => JSON.parse(fs.readFileSync(new URL(`./fixtures/${n}.json`, import.meta.url), 'utf8'));
const resumeText = fs.readFileSync(new URL('./fixtures/resume.txt', import.meta.url), 'utf8');
const NOW = new Date('2026-10-06');

// serve fixtures through a stubbed fetch so the real adapters run unchanged
function stubFetch(map) {
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => {
    for (const [frag, body] of Object.entries(map)) if (String(url).includes(frag)) return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    return new Response('nope', { status: 404 });
  };
  return () => { globalThis.fetch = real; };
}

test('resume parser: contact details, name, skills, experience excludes education dates', () => {
  const p = parseResume(resumeText, { now: NOW });
  assert.equal(p.fullName, 'Jane Role');
  assert.equal(p.email, 'jane.role@example.com');
  assert.equal(p.phone, '9876543210');
  assert.equal(p.city, 'Pune');
  assert.equal(p.linkedin, 'linkedin.com/in/jane-role');
  assert.equal(p.github, 'github.com/janerole');
  for (const s of ['Python', 'PyTorch', 'Scikit-learn', 'XGBoost', 'NLP', 'LLM', 'SQL']) assert.ok(p.skills.includes(s), s);
  // Jun 2025–now (16 months) + Jan–Apr 2025 (4 months) = 20 months; the 2021–2025 degree must not count
  assert.ok(p.experienceMonths >= 19 && p.experienceMonths <= 21, String(p.experienceMonths));
  assert.equal(p.currentCompany, 'Acme Analytics');
  assert.equal(p.currentTitle, 'Data Scientist');
});

test('monthsCovered merges overlapping ranges', () => {
  const r = (a, b) => ({ start: new Date(a), end: new Date(b) });
  const m = monthsCovered([r('2025-01-01', '2025-06-30'), r('2025-03-01', '2025-08-31')], NOW);
  assert.ok(Math.abs(m - 8) < 0.2);
});

test('required years extraction', () => {
  assert.equal(requiredYears('We need 3+ years of experience in Python'), 3);
  assert.equal(requiredYears('1-3 years of relevant experience'), 1);
  assert.equal(requiredYears('Freshers welcome'), 0);
  assert.equal(requiredYears('Our company is 10 years old and growing'), null);
  assert.equal(requiredYears('5 years of professional experience; 2 years leading teams'), 2);
});

test('location logic', () => {
  const s = DEFAULT_SETTINGS();
  assert.equal(locationInfo({ location: 'Bengaluru, India' }, s).inIndia, true);
  assert.equal(locationInfo({ location: 'Remote - US' }, s).foreignOnly, true);
  assert.equal(locationInfo({ location: 'Remote', locations: ['Bengaluru, India'] }, s).inIndia, true);
  assert.equal(locationInfo({ location: 'Remote - APAC' }, s).globalRemote, true);
});

test('adapters normalise Greenhouse / Lever / Ashby shapes', async () => {
  const restore = stubFetch({ '/v1/boards/acme/jobs': fx('greenhouse'), '/v0/postings/acme': fx('lever'), '/posting-api/job-board/acme': fx('ashby') });
  try {
    const gh = await src.greenhouse('acme', {});
    assert.equal(gh.length, 5);
    assert.equal(gh[0].id, 'greenhouse:acme:4001');
    assert.match(gh[0].description, /ML engineer with Python/);   // entity-escaped HTML decoded
    assert.match(gh[0].description, /• Build LLM features/);
    const lv = await src.lever('acme', {});
    assert.equal(lv[0].applyUrl, 'https://jobs.lever.co/acme/a1b2/apply');
    assert.match(lv[0].description, /Docker/);
    const ab = await src.ashby('acme', {});
    assert.equal(ab[0].remote, true);
    assert.deepEqual(ab[0].locations, ['Bengaluru, India']);
  } finally { restore(); }
});

test('matching: sensible apply / skip decisions with reasons', async () => {
  const restore = stubFetch({ '/v1/boards/acme/jobs': fx('greenhouse'), '/v0/postings/acme': fx('lever'), '/posting-api/job-board/acme': fx('ashby') });
  try {
    const profile = { ...emptyProfile(), ...parseResume(resumeText, { now: NOW }), experienceYears: 1 };
    const settings = { ...DEFAULT_SETTINGS(), locations: ['Pune', 'Bengaluru', 'Hyderabad'] };
    const jobs = [...await src.greenhouse('acme', {}), ...await src.lever('acme', {}), ...await src.ashby('acme', {})];
    const byTitle = Object.fromEntries(jobs.map((j) => [j.title, evaluate(j, profile, settings)]));
    assert.equal(byTitle['Machine Learning Engineer'].decision, 'apply');
    assert.ok(byTitle['Machine Learning Engineer'].score >= 70, JSON.stringify(byTitle['Machine Learning Engineer']));
    assert.match(byTitle['Senior Machine Learning Engineer'].skipReason, /Seniority/);
    assert.match(byTitle['Account Executive'].skipReason, /Not a technical role/);
    assert.match(byTitle['Data Scientist'].skipReason || '', /outside India|Location/i);   // San Francisco
    assert.match(byTitle['Data Scientist - Computer Vision'].skipReason, /3\+ years/);
    assert.equal(byTitle['AI Engineer (Generative AI)'].decision, 'apply');
    assert.equal(byTitle['Software Engineer - Backend'].decision, 'skip');
    assert.equal(byTitle['Machine Learning Engineer, Applied AI'].decision, 'apply');   // Remote + Bengaluru
    assert.equal(byTitle['Data Analyst'].decision, 'skip');                               // Remote - EMEA
  } finally { restore(); }
});

test('ATS detection and careers URL parsing', () => {
  assert.deepEqual(detectAts('https://boards.greenhouse.io/razorpay/jobs/123'), { ats: 'greenhouse', token: 'razorpay' });
  assert.deepEqual(detectAts('https://job-boards.greenhouse.io/postman/jobs/9'), { ats: 'greenhouse', token: 'postman' });
  assert.deepEqual(detectAts('https://boards.greenhouse.io/embed/job_app?for=acme&token=1'), { ats: 'greenhouse', token: 'acme' });
  assert.deepEqual(detectAts('https://jobs.lever.co/cred/abc'), { ats: 'lever', token: 'cred' });
  assert.deepEqual(detectAts('https://jobs.ashbyhq.com/openai/xyz'), { ats: 'ashby', token: 'openai' });
  assert.equal(detectAts('https://www.example.com/careers').ats, null);
  assert.equal(companyFromUrl('https://jobs.lever.co/cred').token, 'cred');
  assert.equal(companyFromUrl('https://example.com'), null);
});

test('htmlToText handles escaped html', () => {
  assert.equal(htmlToText('&lt;p&gt;Hello &amp;amp; welcome&lt;/p&gt;&lt;ul&gt;&lt;li&gt;One&lt;/li&gt;&lt;/ul&gt;').replace(/\n/g, '|'), 'Hello & welcome|• One');
});

test('store persists atomically and merges new defaults', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ja-'));
  const s = new Store(dir);
  s.get('settings').minScore = 80;
  s.set('apps', [{ id: 1 }]);
  s.flush();
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ minScore: 80 }));   // an old file without the newer keys
  const s2 = new Store(dir);
  assert.equal(s2.get('settings').minScore, 80);
  assert.equal(s2.get('settings').maxPerDay, 15);      // default filled in
  assert.deepEqual(s2.get('apps'), [{ id: 1 }]);
  assert.ok(missingForLive(s2.get('profile')).includes('Upload your resume'));
});

test('skillsIn finds skills in job text', () => {
  const s = skillsIn('Experience with Python, PyTorch, Docker and LangChain required. Knowledge of SQL a plus.');
  for (const k of ['Python', 'PyTorch', 'Docker', 'LangChain', 'SQL']) assert.ok(s.includes(k), k);
});
