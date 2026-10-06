// Reads your inbox (IMAP, read-only) for replies to applications: rejections, interview invitations, offers.
// Only message headers + a short text snippet are looked at, and only locally.
import { norm } from './util.js';

const RULES = [
  ['offer', /(offer letter|pleased to offer|we are (delighted|happy|excited) to offer|offer of employment|extend (you )?an offer)/i],
  ['interview', /(schedule (an |a |your )?(interview|call|conversation)|interview (invitation|invite|schedule|slot|round)|invite you (for|to) (an )?interview|shortlisted|next round|technical (round|interview)|hr (round|interview)|assessment (link|invitation)|online (test|assessment)|coding (test|challenge)|availability for (a |an )?(call|interview))/i],
  ['rejection', /(unfortunately|regret to inform|not (be )?moving forward|will not be moving|decided (to )?(not )?(proceed|move forward)|other candidates|not (been )?selected|position has been filled|we won'?t be proceeding|unable to offer)/i],
  ['received', /(thank you for (applying|your application|your interest)|we (have )?received your application|application (received|submitted)|your application (to|for|has been))/i],
];
const NOISE = /(job alert|jobs? (you|that) (may|might)|recommended jobs|newsletter|unsubscribe from (these )?job)/i;

export function classifyEmail({ subject = '', from = '', text = '' }) {
  const t = `${subject}\n${String(text).slice(0, 1800)}`;
  if (NOISE.test(subject)) return null;
  for (const [kind, re] of RULES) if (re.test(t)) return kind;
  return null;
}

/** Try to find which application an email is about: company name in sender/subject/body. */
export function matchApplication(apps, mail) {
  const hay = norm(`${mail.from} ${mail.subject} ${String(mail.text).slice(0, 600)}`);
  let best = null;
  for (const a of apps) {
    if (!['applied', 'unconfirmed', 'emailed'].includes(a.status)) continue;
    const c = norm(a.company);
    if (!c || c.length < 3 || !hay.includes(c)) continue;
    const titleHit = norm(a.title).split(' ').filter((w) => w.length > 3).some((w) => hay.includes(w));
    const score = c.length + (titleHit ? 5 : 0) + (new Date(mail.date) >= new Date(a.at) ? 3 : -10);
    if (!best || score > best.score) best = { app: a, score };
  }
  return best && best.score > 0 ? best.app : null;
}

const RANK = { applied: 0, received: 0, replied: 1, interview: 2, offer: 3, rejected: 3 };
/** Turn classified mails into proposed pipeline changes (never downgrades a stage). */
export function proposeUpdates(apps, mails, handled = new Set()) {
  const out = [];
  for (const m of mails) {
    if (handled.has(m.id)) continue;
    const kind = classifyEmail(m); if (!kind || kind === 'received') continue;
    const app = matchApplication(apps, m); if (!app) continue;
    const cur = app.stage || 'applied';
    if (cur === 'rejected' || cur === 'offer') continue;
    if (kind !== 'rejection' && (RANK[kind] ?? 0) <= (RANK[cur] ?? 0)) continue;
    out.push({ mailId: m.id, appId: app.id, stage: kind, subject: m.subject, from: m.from, date: m.date });
  }
  return out;
}

/** Fetch recent mails over IMAP. imapflow is loaded lazily so the rest of the app never depends on it. */
export async function fetchRecent(settings, { days = 30, limit = 150, imapFlow } = {}) {
  const i = settings.inbox || {};
  if (!i.enabled || !i.user || !i.pass) throw new Error('Inbox reading is not set up');
  const { ImapFlow } = imapFlow || (await import('imapflow'));
  const client = new ImapFlow({ host: i.host || 'imap.gmail.com', port: +i.port || 993, secure: true, auth: { user: i.user, pass: i.pass }, logger: false });
  const mails = [];
  await client.connect();
  try {
    const lock = await client.getMailboxLock('INBOX');
    try {
      const since = new Date(Date.now() - days * 864e5);
      const uids = (await client.search({ since })).slice(-limit);
      for await (const msg of client.fetch(uids, { envelope: true, source: { start: 0, maxLength: 6000 }, uid: true })) {
        const raw = msg.source ? msg.source.toString('utf8') : '';
        const body = raw.split(/\r?\n\r?\n/).slice(1).join('\n\n').replace(/<[^>]+>/g, ' ').replace(/=\r?\n/g, '').replace(/=[0-9A-F]{2}/g, ' ').replace(/\s+/g, ' ');
        mails.push({ id: `${i.user}:${msg.uid}`, subject: msg.envelope?.subject || '', from: (msg.envelope?.from || []).map((f) => `${f.name || ''} ${f.address || ''}`).join(' '), date: msg.envelope?.date || new Date(), text: body });
      }
    } finally { lock.release(); }
  } finally { await client.logout().catch(() => {}); }
  return mails;
}
