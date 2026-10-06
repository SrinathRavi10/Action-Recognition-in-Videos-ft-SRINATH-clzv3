// A local imitation of job boards + application forms (Greenhouse / Lever / Ashby style) for end-to-end testing.
// It never talks to the internet. Run standalone:  node mock/server.js   (http://localhost:4010)
import http from 'node:http';

const j = (res, obj, code = 200) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
const html = (res, body, code = 200) => { res.writeHead(code, { 'content-type': 'text/html; charset=utf-8' }); res.end(body); };

/** minimal multipart/form-data parser: returns { fields, files } */
function parseMultipart(buf, ct) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/.exec(ct || '');
  if (!m) return { fields: {}, files: {} };
  const b = Buffer.from('--' + (m[1] || m[2]));
  const fields = {}, files = {};
  let pos = buf.indexOf(b);
  while (pos >= 0) {
    const next = buf.indexOf(b, pos + b.length);
    if (next < 0) break;
    const part = buf.subarray(pos + b.length + 2, next - 2);
    const he = part.indexOf('\r\n\r\n');
    const head = part.subarray(0, he).toString();
    const body = part.subarray(he + 4);
    const name = /name="([^"]*)"/.exec(head)?.[1];
    const fn = /filename="([^"]*)"/.exec(head)?.[1];
    if (name) { if (fn !== undefined) files[name] = { filename: fn, size: body.length }; else fields[name] = (fields[name] ? fields[name] + ',' : '') + body.toString(); }
    pos = next;
  }
  return { fields, files };
}

const STYLE = `<style>body{font-family:Arial;max-width:720px;margin:24px auto}label{display:block;font-weight:600;margin-top:12px}input[type=text],input[type=email],input[type=tel],input:not([type]),textarea,select{width:100%;padding:6px;margin-top:4px;box-sizing:border-box}.err{color:#c00;font-size:13px}.asterisk,.required{color:#c00}.hide{position:absolute;left:-9999px}.captcha{height:100px;border:1px solid #888;margin:10px 0;display:flex;align-items:center;justify-content:center}</style>`;

// client-side validation + AJAX submit shared by every mock form
const SCRIPT = (kind) => `<script>
document.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const form = ev.target;
  document.querySelectorAll('.err').forEach(e => e.remove());
  let bad = false;
  form.querySelectorAll('[required]').forEach(el => {
    const empty = el.type === 'file' ? !el.files.length : el.type === 'checkbox' ? !el.checked : el.type === 'radio' ? !form.querySelector('input[type=radio][name="'+el.name+'"]:checked') : !el.value.trim();
    if (empty) { bad = true; const d = document.createElement('div'); d.className = 'err'; d.setAttribute('role','alert'); d.textContent = 'This field is required'; (el.closest('div,li,fieldset') || el.parentNode).appendChild(d); el.setAttribute('aria-invalid','true'); }
  });
  if (document.querySelector('.captcha') && !window.__solved) { bad = true; const d = document.createElement('div'); d.className='err'; d.setAttribute('role','alert'); d.textContent='Please complete the captcha'; form.appendChild(d); }
  if (bad) return;
  const r = await fetch('/__submit/${kind}?job=' + encodeURIComponent(location.pathname), { method: 'POST', body: new FormData(form) });
  if (r.ok) document.body.innerHTML = '<h1>Thank you for applying!</h1><p>Your application has been submitted.</p>';
});
</script>`;

const ghPage = (token, id, extra = '') => `<!doctype html><html><head><title>Job Application for ${token}</title>${STYLE}</head><body>
<h1>Machine Learning Engineer</h1><p>Bengaluru, India</p>
<form id="application_form" method="post" action="#">
<div class="field"><label for="first_name">First Name <span class="asterisk">*</span></label><input id="first_name" name="first_name" required></div>
<div class="field"><label for="last_name">Last Name <span class="asterisk">*</span></label><input id="last_name" name="last_name" required></div>
<div class="field"><label for="email">Email <span class="asterisk">*</span></label><input id="email" name="email" type="email" required></div>
<div class="field"><label for="phone">Phone</label><input id="phone" name="phone" type="tel"></div>
<div class="field"><label for="resume">Resume/CV <span class="asterisk">*</span></label><input id="resume" name="resume" type="file" required></div>
<div class="field"><label for="cover">Cover Letter</label><textarea id="cover" name="cover_letter"></textarea></div>
<div class="field"><label for="li">LinkedIn Profile</label><input id="li" name="linkedin"></div>
<div class="field"><label for="auth">Are you legally authorized to work in India? <span class="asterisk">*</span></label><select id="auth" name="q_auth" required><option value="">Please select</option><option>Yes</option><option>No</option></select></div>
<div class="field"><label for="notice">What is your notice period? <span class="asterisk">*</span></label><input id="notice" name="q_notice" required></div>
<div class="field"><label for="ctc">What is your expected CTC? <span class="asterisk">*</span></label><input id="ctc" name="q_ctc" required></div>
<div class="field"><label for="src">How did you hear about this job?</label><select id="src" name="q_src"><option value="">Please select</option><option>LinkedIn</option><option>Company careers page</option><option>Referral</option></select></div>
<fieldset><legend>Gender</legend><select name="gender" aria-label="Gender"><option value="">Select</option><option>Male</option><option>Female</option><option>Decline To Self Identify</option></select></fieldset>
${extra}
<div class="field"><label><input type="checkbox" name="consent" required> I agree to the privacy policy and consent to processing of my data <span class="asterisk">*</span></label></div>
<input type="text" name="hp_website" class="hide" tabindex="-1" autocomplete="off">
<button type="submit" class="btn">Submit Application</button></form>${SCRIPT('greenhouse')}</body></html>`;

const leverPage = (token, id, extra = '') => `<!doctype html><html><head><title>${token} - Apply</title>${STYLE}</head><body>
<h1>AI Engineer (Generative AI)</h1>
<form class="application-form" method="post" action="#"><ul style="list-style:none;padding:0">
<li class="application-question"><label><div class="application-label">Resume/CV <span class="required">✱</span></div><input type="file" name="resume" class="application-upload" required></label></li>
<li class="application-question"><label><div class="application-label">Full name <span class="required">✱</span></div><input type="text" name="name" required></label></li>
<li class="application-question"><label><div class="application-label">Email <span class="required">✱</span></div><input type="text" name="email" required></label></li>
<li class="application-question"><label><div class="application-label">Phone</div><input type="text" name="phone"></label></li>
<li class="application-question"><label><div class="application-label">Current company</div><input type="text" name="org"></label></li>
<li class="application-question"><label><div class="application-label">LinkedIn URL</div><input type="text" name="urls[LinkedIn]"></label></li>
<li class="application-question"><label><div class="application-label">GitHub URL</div><input type="text" name="urls[GitHub]"></label></li>
<li class="application-question custom-question"><div class="application-label">Will you now or in the future require sponsorship? <span class="required">✱</span></div><ul style="list-style:none"><li><label><input type="radio" name="cards[0]" value="Yes" required><span>Yes</span></label></li><li><label><input type="radio" name="cards[0]" value="No"><span>No</span></label></li></ul></li>
<li class="application-question custom-question"><div class="application-label">Are you willing to relocate? <span class="required">✱</span></div><ul style="list-style:none"><li><label><input type="radio" name="cards[1]" value="Yes" required><span>Yes</span></label></li><li><label><input type="radio" name="cards[1]" value="No"><span>No</span></label></li></ul></li>
<li class="application-question"><label><div class="application-label">Additional information</div><textarea name="comments"></textarea></label></li>
${extra}
</ul><button type="submit" class="postings-btn template-btn-submit">Submit application</button></form>${SCRIPT('lever')}</body></html>`;

const ashbyPage = (token, id) => `<!doctype html><html><head><title>${token}</title>${STYLE}</head><body>
<h1>Machine Learning Engineer, Applied AI</h1>
<form class="ashby-application-form" action="#"><div>
<div class="ashby-application-form-field-entry"><label class="ashby-application-form-question-title" for="_systemfield_name">Name <span>*</span></label><input id="_systemfield_name" name="_systemfield_name" required></div>
<div class="ashby-application-form-field-entry"><label class="ashby-application-form-question-title" for="_systemfield_email">Email <span>*</span></label><input id="_systemfield_email" name="_systemfield_email" type="email" required></div>
<div class="ashby-application-form-field-entry"><label class="ashby-application-form-question-title" for="_systemfield_resume">Resume <span>*</span></label><input id="_systemfield_resume" name="_systemfield_resume" type="file" required></div>
<div class="ashby-application-form-field-entry"><label class="ashby-application-form-question-title" for="loc">Current location <span>*</span></label><input id="loc" name="location" required></div>
<div class="ashby-application-form-field-entry"><label class="ashby-application-form-question-title" for="yoe">Total years of experience <span>*</span></label><input id="yoe" name="yoe" required></div>
</div><button type="submit" class="ashby-application-form-submit-button">Submit Application</button></form>${SCRIPT('ashby')}</body></html>`;

const WHY = `<div class="field"><label for="why">Why do you want to work at MockCo? <span class="asterisk">*</span></label><textarea id="why" name="q_why" required></textarea></div>`;
const CAPTCHA = `<div class="captcha h-captcha" data-sitekey="mock">hCaptcha challenge – <button type="button" onclick="window.__solved=true;this.textContent='solved'">I am human</button></div>`;

export function startMock(port = 0) {
  const submissions = [];
  const origin = () => `http://127.0.0.1:${server.address().port}`;
  const jobs = () => {
    const o = origin();
    return {
      greenhouse: { jobs: [
        { id: 1, title: 'Machine Learning Engineer', updated_at: new Date().toISOString(), location: { name: 'Bengaluru, India' }, absolute_url: `${o}/gh/mockco/jobs/1`, content: '&lt;p&gt;Python, PyTorch, NLP. 0-2 years of experience. Freshers welcome.&lt;/p&gt;' },
        { id: 2, title: 'Data Scientist', updated_at: new Date().toISOString(), location: { name: 'Chennai, India' }, absolute_url: `${o}/gh/mockco/jobs/2`, content: '&lt;p&gt;Python, scikit-learn, machine learning. 1 year of experience.&lt;/p&gt;' },
        { id: 3, title: 'Senior Staff Machine Learning Engineer', updated_at: new Date().toISOString(), location: { name: 'Bengaluru, India' }, absolute_url: `${o}/gh/mockco/jobs/3`, content: '&lt;p&gt;10+ years.&lt;/p&gt;' },
        { id: 4, title: 'AI Engineer', updated_at: new Date().toISOString(), location: { name: 'Pune, India' }, absolute_url: `${o}/gh/mockco/jobs/4`, content: '&lt;p&gt;Python, LLM, 1 year.&lt;/p&gt;' },
      ] },
      lever: [{ id: 'lv1', text: 'AI Engineer (Generative AI)', categories: { location: 'Hyderabad, India', team: 'AI' }, workplaceType: 'hybrid', descriptionPlain: 'LLM, RAG, Python, LangChain. 1+ years experience.', hostedUrl: `${o}/lever/mockco/lv1`, applyUrl: `${o}/lever/mockco/lv1/apply`, createdAt: Date.now() },
        { id: 'lv2', text: 'Machine Learning Engineer (Vision)', categories: { location: 'Hyderabad, India' }, descriptionPlain: 'Python machine learning. Freshers welcome.', hostedUrl: `${o}/lever/mockco/lv2`, applyUrl: `${o}/lever/mockco/lv2/apply`, createdAt: Date.now() }],
      ashby: { jobs: [{ id: 'ab1', title: 'Machine Learning Engineer, Applied AI', location: 'Remote', isRemote: true, secondaryLocations: [{ location: 'Bengaluru, India' }], descriptionPlain: 'Python, PyTorch, deep learning. 1-3 years of experience.', jobUrl: `${o}/ashby/mockco/ab1`, applyUrl: `${o}/ashby/mockco/ab1/application`, publishedAt: new Date().toISOString(), isListed: true }] },
    };
  };

  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const p = u.pathname;
    if (req.method === 'POST' && p.startsWith('/__submit/')) {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const { fields, files } = parseMultipart(Buffer.concat(chunks), req.headers['content-type']);
        submissions.push({ kind: p.split('/').pop(), job: u.searchParams.get('job'), fields, files, at: Date.now() });
        j(res, { ok: true });
      });
      return;
    }
    if (p === '/__submissions') return j(res, submissions);
    if (p === '/__reset') { submissions.length = 0; return j(res, { ok: true }); }
    const J = jobs();
    if (p === '/boards-api/v1/boards/mockco/jobs') return j(res, J.greenhouse);
    if (p === '/lever-api/v0/postings/mockco') return j(res, J.lever);
    if (p === '/ashby-api/posting-api/job-board/mockco') return j(res, J.ashby);
    if (p.startsWith('/boards-api/') || p.startsWith('/lever-api/') || p.startsWith('/ashby-api/')) return j(res, { error: 'not found' }, 404);
    let m;
    if ((m = /^\/gh\/(\w+)\/jobs\/(\d+)$/.exec(p))) {
      if (m[2] === '2') return html(res, ghPage(m[1], m[2], WHY));
      if (m[2] === '4') return html(res, '<h1>Sorry</h1><p>This job is no longer available.</p>', 404);
      return html(res, ghPage(m[1], m[2]));
    }
    if ((m = /^\/lever\/(\w+)\/(\w+)\/apply$/.exec(p))) return html(res, leverPage(m[1], m[2], m[2] === 'lv2' ? CAPTCHA : ''));
    if ((m = /^\/lever\/(\w+)\/(\w+)$/.exec(p))) return html(res, `<h1>AI Engineer</h1><a class="postings-btn" href="/lever/${m[1]}/${m[2]}/apply">Apply for this job</a>`);
    if ((m = /^\/ashby\/(\w+)\/(\w+)\/application$/.exec(p))) return html(res, ashbyPage(m[1], m[2]));
    return html(res, '<h1>Mock job site</h1>', 200);
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({
    url: origin(), submissions, server,
    sourceBase: { greenhouse: `${origin()}/boards-api`, lever: `${origin()}/lever-api`, ashby: `${origin()}/ashby-api` },
    close: () => new Promise((r) => server.close(r)),
  })));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const m = await startMock(+process.env.PORT || 4010);
  console.log(`Mock job site on ${m.url}`);
}
