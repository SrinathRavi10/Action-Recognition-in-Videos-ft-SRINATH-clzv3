// Renewal reminders: desktop notifications (while the app is open) and a calendar (.ics) export.
import { toISO, addDays } from './util.js';
import { lsKey } from './profiles.js';

export const notifySupported = () => typeof Notification !== 'undefined';
export async function requestNotify() {
  if (!notifySupported()) return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  return Notification.requestPermission();
}

/** Show notifications for payments due within `withinDays`, at most once per payment per due date. */
export function notifyDue(items, { withinDays = 2, today = toISO(new Date()) } = {}) {
  if (!notifySupported() || Notification.permission !== 'granted') return 0;
  let seen = {};
  try { seen = JSON.parse(localStorage.getItem(lsKey('notified')) || '{}'); } catch {}
  let n = 0;
  for (const r of items) {
    if (['cancelled', 'lapsed'].includes(r.status)) continue;
    if (r.daysToDue < 0 || r.daysToDue > withinDays) continue;
    const k = `${r.key}@${r.nextDue}`;
    if (seen[k]) continue;
    seen[k] = today;
    n++;
    new Notification(`${r.name} ${r.daysToDue === 0 ? 'is due today' : r.daysToDue === 1 ? 'is due tomorrow' : `is due in ${r.daysToDue} days`}`, { body: `About ₹${Math.round(r.amount).toLocaleString('en-IN')} (${r.cadence})`, icon: 'icons/icon-192.png', tag: k });
  }
  for (const k of Object.keys(seen)) if (seen[k] < addDays(today, -60)) delete seen[k];
  try { localStorage.setItem(lsKey('notified'), JSON.stringify(seen)); } catch {}
  return n;
}

const ics = (s) => String(s).replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
const d8 = (iso) => iso.replace(/-/g, '');

/** iCalendar file with one reminder per upcoming payment (alarm the day before). */
export function buildICS(items, { today = toISO(new Date()) } = {}) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Paisa Ledger//EN', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Paisa Ledger bills'];
  for (const r of items) {
    if (['cancelled', 'lapsed'].includes(r.status)) continue;
    lines.push('BEGIN:VEVENT', `UID:${d8(r.nextDue)}-${r.key.replace(/\W+/g, '')}@paisa-ledger`, `DTSTAMP:${d8(today)}T000000Z`, `DTSTART;VALUE=DATE:${d8(r.nextDue)}`, `SUMMARY:${ics(`${r.name} – ₹${Math.round(r.amount).toLocaleString('en-IN')}`)}`,
      `DESCRIPTION:${ics(`${r.kind} · ${r.cadence}. Predicted from your last payment on ${r.lastDate}.`)}`,
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${ics(r.name + ' is due tomorrow')}`, 'TRIGGER:-P1D', 'END:VALARM', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

/** How to cancel common services (matched on the merchant key). */
export const CANCEL_GUIDES = [
  { re: /NETFLIX/, name: 'Netflix', steps: 'Account → Membership → Cancel membership.', url: 'https://www.netflix.com/cancelplan' },
  { re: /SPOTIFY/, name: 'Spotify', steps: 'Account → Manage your plan → Change or cancel.', url: 'https://www.spotify.com/account/subscription/' },
  { re: /YOUTUBE/, name: 'YouTube Premium', steps: 'Profile → Purchases and memberships → Deactivate.', url: 'https://www.youtube.com/paid_memberships' },
  { re: /PRIME|AMAZON/, name: 'Amazon Prime', steps: 'Account & Lists → Prime Membership → Manage → End membership.', url: 'https://www.amazon.in/gp/primecentral' },
  { re: /HOTSTAR|DISNEY/, name: 'Disney+ Hotstar', steps: 'App or website → Profile → My Account → Subscription → Cancel (or via the UPI AutoPay mandate in your UPI app).' },
  { re: /APPLE|ICLOUD|ITUNES/, name: 'Apple', steps: 'Settings → your name → Subscriptions → pick the subscription → Cancel.' },
  { re: /GOOGLE/, name: 'Google Play / Google One', steps: 'Play Store → profile → Payments & subscriptions → Subscriptions → Cancel.', url: 'https://play.google.com/store/account/subscriptions' },
  { re: /AIRTEL|JIO|VODAFONE|\bVI\b|BSNL/, name: 'Mobile / broadband', steps: 'Use the operator app → Recharge/Plans → Auto-pay. Prepaid plans simply lapse if you do not recharge.' },
  { re: /SIP|ZERODHA|GROWW|ICCL|MUTUAL|BSE STAR|KUVERA|COIN/, name: 'SIP / mutual fund', steps: 'Open the platform or fund-house app → SIPs → Pause or Stop SIP. If it was set up via NACH, also cancel the mandate with your bank.' },
  { re: /LIC|INSURANCE|LIFE|HEALTH/, name: 'Insurance', steps: 'Cancelling can forfeit cover and benefits. Ask the insurer about the free-look period or surrender value before stopping premiums.' },
  { re: /EMI|LOAN|BAJAJ/, name: 'EMI / loan', steps: 'An EMI cannot just be stopped. Ask the lender about foreclosure or part-prepayment.' },
];
export const cancelGuide = (key) => CANCEL_GUIDES.find((g) => g.re.test(key)) || { name: 'Other', steps: 'Look for “Manage subscription” in the service’s app or website. If you pay by UPI AutoPay or a bank mandate, cancel the mandate in your UPI app (Mandates / AutoPay) or net-banking.' };
