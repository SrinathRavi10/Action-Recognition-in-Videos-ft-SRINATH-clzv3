// Applying by email when a posting asks for it ("send your resume to jobs@company.com").
import nodemailer from 'nodemailer';
import fs from 'node:fs';
import path from 'node:path';

const BAD_LOCAL = /^(no-?reply|donotreply|do-not-reply|mailer-daemon|postmaster|abuse|privacy|legal|press|sales|support|billing|security)$/i;

/** First plausible recruiting address mentioned in a job description. */
export function extractApplyEmail(text) {
  const t = String(text || '');
  const re = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
  let best = null, m;
  while ((m = re.exec(t))) {
    const email = m[0].replace(/\.$/, '');
    const [local, domain] = email.toLowerCase().split('@');
    if (BAD_LOCAL.test(local) || /example\.|sentry|wixpress|\.png$|\.jpg$/.test(domain)) continue;
    const ctx = t.slice(Math.max(0, m.index - 90), m.index + 40).toLowerCase();
    const score = (/apply|send (your )?(resume|cv)|resume|cv|application|careers|hiring|recruit|join/.test(ctx) ? 2 : 0) + (/^(careers?|jobs?|hr|hiring|recruit(ment|ing)?|talent|apply|people)/.test(local) ? 2 : 0);
    if (!best || score > best.score) best = { email, score };
  }
  return best && best.score >= 2 ? best.email : null;
}

export function makeTransport(settings, { jsonOnly = false } = {}) {
  if (jsonOnly) return nodemailer.createTransport({ jsonTransport: true });
  const e = settings.email || {};
  return nodemailer.createTransport({ host: e.host, port: +e.port || 465, secure: (+e.port || 465) === 465, auth: { user: e.user, pass: e.pass }, connectionTimeout: 20000 });
}

export async function sendApplication({ settings, profile, job, to, coverLetter, transport }) {
  const e = settings.email || {};
  if (!transport && (!e.enabled || !e.user || !e.pass)) throw new Error('Email sending is not configured');
  const t = transport || makeTransport(settings);
  const attachments = profile.resumePath && fs.existsSync(profile.resumePath) ? [{ filename: path.basename(profile.resumePath), path: profile.resumePath }] : [];
  const info = await t.sendMail({
    from: `"${profile.fullName || e.user}" <${e.user || profile.email}>`, to, replyTo: profile.email,
    subject: `Application for ${job.title} – ${profile.fullName}`,
    text: `${coverLetter}\n\n${profile.fullName}\n${profile.phone || ''}\n${profile.email}\n${profile.linkedin || ''}`.trim(), attachments,
  });
  return info;
}
