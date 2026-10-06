// Job source adapters. Every adapter returns jobs in one normalised shape:
// { id, source, ats, token, company, title, location, locations[], remote, department, url, applyUrl, description, postedAt }
import { getJson, htmlToText, slugName } from '../util.js';
import { detectAts } from '../ats.js';

const BASES = {
  greenhouse: 'https://boards-api.greenhouse.io',
  lever: 'https://api.lever.co',
  ashby: 'https://api.ashbyhq.com',
  workable: 'https://apply.workable.com',
  smartrecruiters: 'https://api.smartrecruiters.com',
  remoteok: 'https://remoteok.com',
  remotive: 'https://remotive.com',
  adzuna: 'https://api.adzuna.com',
};
export const base = (settings, name) => (settings?.sourceBase?.[name] || BASES[name]).replace(/\/$/, '');
const iso = (v) => { if (!v) return null; const d = typeof v === 'number' ? new Date(v < 1e12 ? v * 1000 : v) : new Date(v); return Number.isNaN(+d) ? null : d.toISOString(); };

// ───────── company ATS boards (one request per company) ─────────
export async function greenhouse(token, settings) {
  const j = await getJson(`${base(settings, 'greenhouse')}/v1/boards/${encodeURIComponent(token)}/jobs?content=true`);
  return (j.jobs || []).map((x) => ({
    id: `greenhouse:${token}:${x.id}`, source: 'greenhouse', ats: 'greenhouse', token, company: slugName(token), title: x.title || '',
    location: x.location?.name || '', locations: (x.offices || []).map((o) => o.location || o.name).filter(Boolean), remote: /remote/i.test(x.location?.name || ''),
    department: (x.departments || [])[0]?.name || '', url: x.absolute_url, applyUrl: x.absolute_url, description: htmlToText(x.content), postedAt: iso(x.first_published || x.updated_at),
  }));
}

export async function lever(token, settings) {
  const j = await getJson(`${base(settings, 'lever')}/v0/postings/${encodeURIComponent(token)}?mode=json`);
  return (Array.isArray(j) ? j : []).map((x) => ({
    id: `lever:${token}:${x.id}`, source: 'lever', ats: 'lever', token, company: slugName(token), title: x.text || '',
    location: x.categories?.location || '', locations: x.categories?.allLocations || [], remote: /remote/i.test(x.workplaceType || '') || /remote/i.test(x.categories?.location || ''),
    department: x.categories?.team || x.categories?.department || '', url: x.hostedUrl, applyUrl: x.applyUrl || (x.hostedUrl ? `${x.hostedUrl.replace(/\/$/, '')}/apply` : ''),
    description: [x.descriptionPlain || htmlToText(x.description), ...(x.lists || []).map((l) => `${l.text}\n${htmlToText(l.content)}`), x.additionalPlain || ''].join('\n'), postedAt: iso(x.createdAt),
  }));
}

export async function ashby(token, settings) {
  const j = await getJson(`${base(settings, 'ashby')}/posting-api/job-board/${encodeURIComponent(token)}?includeCompensation=true`);
  return (j.jobs || []).filter((x) => x.isListed !== false).map((x) => ({
    id: `ashby:${token}:${x.id}`, source: 'ashby', ats: 'ashby', token, company: slugName(token), title: x.title || '',
    location: x.location || '', locations: (x.secondaryLocations || []).map((l) => l.location || l).filter(Boolean), remote: x.isRemote === true || /remote/i.test(x.workplaceType || ''),
    department: x.department || x.team || '', url: x.jobUrl, applyUrl: x.applyUrl || x.jobUrl, description: x.descriptionPlain || htmlToText(x.descriptionHtml), postedAt: iso(x.publishedAt || x.publishedDate),
  }));
}

export async function workable(token, settings) {
  const j = await getJson(`${base(settings, 'workable')}/api/v1/widget/accounts/${encodeURIComponent(token)}?details=true`);
  return (j.jobs || []).map((x) => {
    const loc = [x.city, x.state, x.country].filter(Boolean).join(', ');
    return { id: `workable:${token}:${x.shortcode || x.code || x.title}`, source: 'workable', ats: 'workable', token, company: j.name || slugName(token), title: x.title || '', location: loc, locations: (x.locations || []).map((l) => [l.city, l.region, l.country].filter(Boolean).join(', ')),
      remote: x.telecommuting === true, department: x.department || '', url: x.url || x.shortlink, applyUrl: x.application_url || x.url, description: htmlToText(x.description || ''), postedAt: iso(x.published_on || x.created_at) };
  });
}

export async function smartrecruiters(token, settings) {
  const out = [];
  for (let offset = 0; offset < 300; offset += 100) {
    const j = await getJson(`${base(settings, 'smartrecruiters')}/v1/companies/${encodeURIComponent(token)}/postings?limit=100&offset=${offset}&country=in`);
    for (const x of j.content || []) {
      const l = x.location || {};
      const loc = l.fullLocation || [l.city, l.region, (l.country || '').toUpperCase()].filter(Boolean).join(', ');
      const url = `https://jobs.smartrecruiters.com/${encodeURIComponent(token)}/${x.id}`;
      out.push({ id: `smartrecruiters:${token}:${x.id}`, source: 'smartrecruiters', ats: 'smartrecruiters', token, company: x.company?.name || slugName(token), title: x.name || '', location: loc, locations: [], remote: l.remote === true,
        department: x.department?.label || '', url, applyUrl: url, description: [x.function?.label, x.industry?.label, x.typeOfEmployment?.label, x.experienceLevel?.label].filter(Boolean).join(' · '), postedAt: iso(x.releasedDate), manual: true });
    }
    if (!(j.content || []).length || offset + 100 >= (j.totalFound || 0)) break;
  }
  return out;
}

export const ATS_SOURCES = { greenhouse, lever, ashby, workable, smartrecruiters };

// ───────── aggregators (search) ─────────
export async function remoteok(settings) {
  const j = await getJson(`${base(settings, 'remoteok')}/api`);
  return (Array.isArray(j) ? j : []).filter((x) => x && x.position).map((x) => ({
    id: `remoteok:${x.id || x.slug}`, source: 'remoteok', ats: null, token: '', company: x.company || '', title: x.position, location: x.location || 'Remote', locations: [], remote: true, department: (x.tags || []).slice(0, 3).join(', '),
    url: x.url || `https://remoteok.com/remote-jobs/${x.slug}`, applyUrl: x.apply_url || x.url, description: htmlToText(x.description) + '\n' + (x.tags || []).join(', '), postedAt: iso(x.date || x.epoch),
  }));
}

export async function remotive(settings, queries = ['machine learning', 'data scientist', 'ai engineer']) {
  const out = [];
  for (const q of queries) {
    const j = await getJson(`${base(settings, 'remotive')}/api/remote-jobs?search=${encodeURIComponent(q)}&limit=60`).catch(() => ({ jobs: [] }));
    for (const x of j.jobs || []) out.push({
      id: `remotive:${x.id}`, source: 'remotive', ats: null, token: '', company: x.company_name || '', title: x.title || '', location: x.candidate_required_location || 'Remote', locations: [], remote: true, department: x.category || '',
      url: x.url, applyUrl: x.url, description: htmlToText(x.description), postedAt: iso(x.publication_date),
    });
  }
  return [...new Map(out.map((j) => [j.id, j])).values()];
}

export async function adzuna(settings, queries = ['machine learning', 'data scientist', 'ai engineer', 'generative ai']) {
  const { appId, appKey } = settings.adzuna || {};
  if (!appId || !appKey) return [];
  const out = [];
  for (const q of queries) {
    const url = `${base(settings, 'adzuna')}/v1/api/jobs/in/search/1?app_id=${encodeURIComponent(appId)}&app_key=${encodeURIComponent(appKey)}&results_per_page=50&max_days_old=14&what=${encodeURIComponent(q)}&content-type=application/json`;
    const j = await getJson(url).catch(() => ({ results: [] }));
    for (const x of j.results || []) out.push({
      id: `adzuna:${x.id}`, source: 'adzuna', ats: null, token: '', company: x.company?.display_name || '', title: x.title || '', location: x.location?.display_name || '', locations: x.location?.area || [], remote: /remote/i.test(x.title + x.description),
      department: x.category?.label || '', url: x.redirect_url, applyUrl: x.redirect_url, description: htmlToText(x.description), postedAt: iso(x.created),
    });
  }
  return [...new Map(out.map((j) => [j.id, j])).values()];
}

/**
 * Aggregator listings usually link to the employer's own application page. Follow the redirects once and, if it lands on a
 * system we can fill (Greenhouse/Lever/Ashby/Workable), upgrade the job so the autopilot can apply to it.
 */
export async function resolveTarget(job, timeout = 15000) {
  if (job.ats || !job.applyUrl) return job;
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeout);
    const res = await fetch(job.applyUrl, { redirect: 'follow', signal: ac.signal, headers: { 'user-agent': 'Mozilla/5.0 JobAutopilot/1.0' } });
    clearTimeout(t);
    const d = detectAts(res.url);
    if (d.ats) return { ...job, ats: d.ats, token: d.token, applyUrl: res.url, url: job.url };
    return { ...job, resolvedUrl: res.url };
  } catch { return job; }
}
