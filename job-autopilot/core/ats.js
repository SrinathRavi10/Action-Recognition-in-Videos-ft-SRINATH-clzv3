// Recognise which application system a URL belongs to, and extract the company token.
export function detectAts(url) {
  let u;
  try { u = new URL(url); } catch { return { ats: null }; }
  const h = u.hostname.toLowerCase();
  const seg = u.pathname.split('/').filter(Boolean);
  if (/(^|\.)greenhouse\.io$/.test(h)) {
    // boards.greenhouse.io/{token}/jobs/{id} · job-boards.greenhouse.io/{token}/jobs/{id} · boards.greenhouse.io/embed/job_app?for={token}&token={id}
    const token = u.searchParams.get('for') || (seg[0] && seg[0] !== 'embed' ? seg[0] : '');
    return { ats: 'greenhouse', token };
  }
  if (h === 'jobs.lever.co' || h === 'jobs.eu.lever.co') return { ats: 'lever', token: seg[0] || '' };
  if (h === 'jobs.ashbyhq.com') return { ats: 'ashby', token: seg[0] || '' };
  if (h === 'apply.workable.com') return { ats: 'workable', token: seg[0] || '' };
  if (/\.workable\.com$/.test(h)) return { ats: 'workable', token: h.split('.')[0] };
  if (/\.smartrecruiters\.com$/.test(h) || h === 'jobs.smartrecruiters.com') return { ats: 'smartrecruiters', token: seg[0] || '' };
  if (/myworkdayjobs\.com$/.test(h)) return { ats: 'workday', token: h.split('.')[0] };
  return { ats: null };
}

/** Which systems the form filler is able to submit on. */
export const SUPPORTED_ATS = ['greenhouse', 'lever', 'ashby', 'workable'];
/** Filled by the same universal form filler, but never seen on a real site by the developer: on by default, can be switched off in Settings. */
export const EXPERIMENTAL_ATS = ['smartrecruiters'];
/** Systems that need an account per employer (or are otherwise not automatable): the app finds the job, you apply with one click. */
export const MANUAL_ATS = ['workday'];
/** Job sites whose rules forbid bots and ban accounts: never automated, only opened for you. */
const FORBIDDEN_HOSTS = /(^|\.)(linkedin|naukri|indeed|glassdoor|foundit|monsterindia|shine|timesjobs|apna|instahyre|hirist|wellfound|angel)\.(com|co\.in|co)$/i;
export const isForbiddenSite = (url) => { try { return FORBIDDEN_HOSTS.test(new URL(url).hostname); } catch { return false; } };

/** Can the autopilot try this job by itself? */
export function canAutoApply(job, settings = {}) {
  if (!job) return false;
  if (SUPPORTED_ATS.includes(job.ats)) return true;
  if (MANUAL_ATS.includes(job.ats) || job.manual) return false;
  if (settings.tryExperimental === false) return false;
  if (EXPERIMENTAL_ATS.includes(job.ats)) return true;
  // any other employer careers page (found by following an aggregator link): try the universal filler, unless it is a bot-hostile job board
  return !job.ats && !!(job.resolvedUrl || job.applyUrl) && !isForbiddenSite(job.resolvedUrl || job.applyUrl);
}
