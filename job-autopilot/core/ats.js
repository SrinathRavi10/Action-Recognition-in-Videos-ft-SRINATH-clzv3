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
