import { chromium } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Test driver implementing the same interface as the Electron driver, backed by Playwright's Chromium. */
export async function pwDriver() {
  const exe = ['/opt/pw-browsers/chromium', undefined].find((p) => !p || fs.existsSync(p));
  const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
  const page = await (await browser.newContext({ viewport: { width: 1200, height: 900 } })).newPage();
  return {
    page,
    goto: (u) => page.goto(u, { waitUntil: 'domcontentloaded' }),
    eval: (code) => page.evaluate(code),
    setFiles: (sel, files) => page.setInputFiles(sel, files),
    screenshot: () => page.screenshot(),
    url: async () => page.url(),
    close: () => browser.close(),
  };
}

export function tempResume() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ja-res-'));
  const f = path.join(dir, 'Jane_Role_Resume.pdf');
  fs.writeFileSync(f, '%PDF-1.4\n% test resume\n');
  return f;
}

export const testProfile = (resumePath) => ({
  firstName: 'Jane', lastName: 'Role', fullName: 'Jane Role', email: 'jane.role@example.com', phone: '9876543210', location: 'Pune, India', city: 'Pune', country: 'India',
  linkedin: 'linkedin.com/in/jane-role', github: 'github.com/janerole', website: '', headline: 'Machine Learning Engineer',
  skills: ['Python', 'PyTorch', 'Scikit-learn', 'NLP', 'LLM', 'SQL'], experienceYears: 1, experienceMonths: 14,
  education: { degree: 'B.Tech, Computer Science', gradYear: 2025, cgpa: '8.4' }, currentCompany: 'Acme Analytics', currentTitle: 'Data Scientist', summary: '',
  resumePath, resumeText: 'Jane Role. Machine learning engineer. Built churn models in Python using XGBoost at Acme Analytics.',
  answers: { noticePeriod: '30 days', currentCtc: '5 LPA', expectedCtc: '8 LPA', workAuthorization: 'Yes – I am an Indian citizen and authorised to work in India.', requireSponsorship: 'No', willingToRelocate: 'Yes', howDidYouHear: 'Company careers page', extra: [] },
});

/** One shared Chromium; each application gets a fresh isolated context like the Electron driver does. */
export async function pwFactory() {
  const exe = ['/opt/pw-browsers/chromium', undefined].find((p) => !p || fs.existsSync(p));
  const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
  const factory = async () => {
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
    const page = await ctx.newPage();
    return { goto: (u) => page.goto(u, { waitUntil: 'domcontentloaded' }), eval: (c) => page.evaluate(c), setFiles: (s, f) => page.setInputFiles(s, f), screenshot: () => page.screenshot(), url: async () => page.url(), close: () => ctx.close() };
  };
  return { factory, close: () => browser.close() };
}
