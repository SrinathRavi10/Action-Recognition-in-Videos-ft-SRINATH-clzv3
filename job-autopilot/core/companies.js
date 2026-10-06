// Companies whose public ATS boards we poll. We ship a list of *candidate* board names and probe them once to
// find the ones that exist and have India/remote openings; users can add their own via a careers URL.
import { ATS_SOURCES } from './sources/index.js';
import { locationInfo } from './match.js';
import { pool } from './util.js';
import { detectAts } from './ats.js';

// Board names (the part after the host in the careers URL). Not all exist – probing weeds those out.
export const CANDIDATES = {
  greenhouse: ['razorpay', 'postman', 'freshworks', 'phonepe', 'groww', 'cred', 'meesho', 'swiggy', 'zepto', 'sharechat', 'dreamsports', 'urbancompany', 'zeta', 'uniphore', 'observeai', 'sigmoid', 'fractal', 'tredence', 'databricks', 'stripe', 'mongodb', 'elastic', 'twilio', 'okta', 'gitlab', 'zscaler', 'nutanix', 'netskope', 'rubrik', 'thoughtspot', 'sprinklr', 'chargebee', 'clevertap', 'whatfix', 'yellowai', 'haptik', 'gupshup', 'mindtickle', 'innovaccer', 'qureai', 'sarvam', 'airbnb', 'coinbase', 'robinhood', 'scaleai', 'anthropic', 'datadog', 'cloudflare', 'figma', 'notion', 'canva', 'discord', 'reddit', 'pinterest', 'lyft', 'instacart', 'doordash', 'affirm', 'brex', 'ramp', 'plaid', 'toast', 'samsara', 'verkada', 'asana', 'dropbox', 'box', 'hubspot', 'zendesk', 'intercom', 'sumologic', 'pagerduty', 'newrelic', 'splunk', 'tenable', 'rapid7', 'crowdstrike', 'sentinelone', 'wiz', 'snyk', 'hashicorp', 'confluent', 'cockroachlabs', 'singlestore', 'clickhouse', 'dbtlabs', 'fivetran', 'airtable', 'amplitude', 'mixpanel', 'segment', 'gong', 'highspot', 'appian', 'veeva', 'tekion', 'ola', 'oyo', 'dunzo', 'khatabook', 'slice', 'jupiter', 'navi', 'lenskart', 'nykaa', 'mpl', 'games24x7', 'inmobi', 'glance', 'dailyhunt', 'unacademy', 'upgrad', 'vedantu', 'byjus', 'physicswallah', 'cars24', 'spinny', 'bharatpe', 'paytm', 'mobikwik', 'policybazaar', 'acko', 'digit', 'zoho', 'icertis', 'druva', 'netcore', 'moengage', 'leadsquared', 'capillary', 'browserstack', 'hasura', 'atlan', 'sarvamai', 'krutrim', 'wadhwaniai', 'gramener', 'mu-sigma', 'latentview', 'ideas2it', 'kissflow', 'vymo', 'zluri', 'rocketlane', 'darwinbox', 'springworks', 'razorpayx', 'juspay', 'setu', 'cashfree', 'perfios', 'signzy', 'idfy', 'hyperverge'],
  lever: ['palantir', 'mistral', 'cred', 'meesho', 'paytm', 'zeta', 'swiggy', 'freshworks', 'upgrad', 'dream11', 'sharechat', 'gojek', 'spotify', 'netflix', 'plaid', 'highspot', 'kredx', 'uniphore', 'innovaccer', 'whatfix', 'exotel', 'clevertap', 'leena-ai', 'slice', 'zomato', 'ola', 'shadowfax', 'mpl', 'jar', 'rapido', 'park-plus', 'gupshup', 'sprinklr', 'tide', 'wingify', 'visa', 'weave', 'aledade', 'ziprecruiter', 'matchgroup', 'octopus', 'cohere', 'neon', 'lambda', 'zoox'],
  ashby: ['openai', 'perplexity', 'cohere', 'ramp', 'notion', 'linear', 'vercel', 'supabase', 'replit', 'modal', 'anyscale', 'cursor', 'elevenlabs', 'runway', 'deel', 'rippling', 'lattice', 'retool', 'zapier', 'sarvam', 'krutrim', 'postman', 'groww', 'razorpay', 'meesho', 'cred', 'snowflake', 'cohere-ai', 'writer', 'harvey', 'glean', 'sierra', 'decagon', 'hightouch', 'dbt-labs', 'posthog', 'sentry', 'mercury', 'wise', 'monzo'],
  smartrecruiters: ['Visa', 'BoschGroup', 'Ubisoft', 'ServiceNow', 'Experian', 'Sodexo', 'Freshworks', 'Wipro', 'Infosys', 'LinkedIn3', 'McDonaldsCorporation', 'AccentureIndia'],
  workable: ['workable', 'huggingface', 'ivalua', 'bitly', 'doctolib', 'tbs-engineering', 'quantexa', 'seon', 'turing', 'toptal', 'remote-com', 'lokalise', 'proxify', 'wizeline', 'ey-gds', 'nagarro', 'ideas2it', 'zeta-global', 'sigma-computing', 'invideo', 'mad-street-den', 'vahan', 'sarvam-ai'],
};

/** Probe a board; ok=false if it does not exist. */
export async function probe(ats, token, settings) {
  try {
    const jobs = await ATS_SOURCES[ats](token, settings);
    const relevant = jobs.filter((j) => { const l = locationInfo(j, { locations: [] }); return l.inIndia || l.remote || l.unknown; });
    return { ok: true, total: jobs.length, relevant: relevant.length, india: jobs.filter((j) => locationInfo(j, { locations: [] }).inIndia).length };
  } catch (e) { return { ok: false, status: e.status }; }
}

/** Probe all candidates (limited concurrency, polite). Keeps boards that exist and have at least one India/remote opening. */
export async function discover(settings, { onProgress, candidates = CANDIDATES, concurrency = 6, known = [] } = {}) {
  const have = new Set(known.map((c) => `${c.ats}:${c.token}`));
  const todo = [];
  for (const [ats, tokens] of Object.entries(candidates)) {
    if (settings.sources?.[ats] === false) continue;
    for (const token of [...new Set(tokens)]) if (!have.has(`${ats}:${token}`)) todo.push({ ats, token });
  }
  let done = 0;
  const found = [];
  await pool(todo, concurrency, async ({ ats, token }) => {
    const r = await probe(ats, token, settings);
    done++;
    onProgress?.({ done, total: todo.length, ats, token, ok: r.ok });
    if (r.ok) found.push({ ats, token, name: token, total: r.total, relevant: r.relevant, india: r.india, checkedAt: new Date().toISOString(), enabled: r.relevant > 0 });
  });
  return found;
}

/** Turn a careers URL pasted by the user into a company entry. */
export function companyFromUrl(url) {
  const d = detectAts(url);
  if (!d.ats || !d.token || !(d.ats in ATS_SOURCES)) return null;
  return { ats: d.ats, token: d.token, name: d.token, custom: true, enabled: true, checkedAt: null };
}
