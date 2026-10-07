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

// ── SmartRecruiters-style multi-step application built from web components (shadow DOM) ──
const SR_PAGE = (company, id) => `<!doctype html><html><head><title>Apply – ${company}</title>${STYLE}<style>.step{display:none}.step.on{display:block}spl-input,spl-upload{display:block;margin-top:10px}.opt{padding:6px;cursor:pointer;border:1px solid #ccc}[role=listbox]{border:1px solid #888;background:#fff;padding:0;margin:0;list-style:none}[role=radio]{display:inline-block;border:1px solid #888;padding:6px 14px;margin-right:6px;cursor:pointer}[role=radio][aria-checked=true]{background:#0a7;color:#fff}.rte{border:1px solid #888;min-height:60px;padding:6px}</style></head><body>
<h1>Machine Learning Engineer</h1><div id="app">
<div class="step on" id="s1"><h2>Contact information</h2>
<spl-input label="First name" name="firstName" required></spl-input>
<spl-input label="Last name" name="lastName" required></spl-input>
<spl-input label="Email" name="email" required></spl-input>
<spl-input label="Confirm your email" name="email2" required></spl-input>
<spl-input label="Phone number" name="phone"></spl-input>
<div class="field"><label id="loclbl">Where are you located? *</label><input id="loc" name="location" role="combobox" aria-autocomplete="list" aria-labelledby="loclbl" aria-required="true" autocomplete="off"><ul role="listbox" id="locopts" hidden></ul></div>
<spl-upload label="Resume" name="resume" required></spl-upload>
<button type="button" id="n1">Next</button></div>
<div class="step" id="s2"><h2>Additional questions</h2>
<div role="radiogroup" aria-label="Do you have experience with Python? *" id="q_py"><span role="radio" aria-checked="false" data-v="Yes" tabindex="0">Yes</span><span role="radio" aria-checked="false" data-v="No" tabindex="0">No</span></div>
<div class="field"><label for="sqlyrs">How many years of experience do you have with SQL? *</label><select id="sqlyrs" name="sqlyrs" required><option value="">Select</option><option>Less than 1 year</option><option>1-3 years</option><option>3-5 years</option><option>5+ years</option></select></div>
<div class="field"><span id="npl">What is your notice period? *</span><button type="button" id="npb" aria-haspopup="listbox" aria-expanded="false" aria-labelledby="npl">Select…</button><ul role="listbox" id="npo" hidden><li role="option">Immediate</li><li role="option">15 days</li><li role="option">30 days</li><li role="option">60 days</li><li role="option">90 days</li></ul></div>
<div class="field"><label for="ctc">Expected CTC *</label><select id="ctc" name="ctc" required><option value="">Select</option><option>Below 5 LPA</option><option>5-8 LPA</option><option>8-12 LPA</option><option>Above 12 LPA</option></select></div>
<div class="field"><label for="start">Earliest start date *</label><input id="start" name="start" type="date" required></div>
<div class="field"><span id="rtl">Tell us about yourself *</span><div class="rte" contenteditable="true" role="textbox" aria-labelledby="rtl" id="rte"></div></div>
<div class="field"><label for="ext">Anything else?</label><textarea id="ext" name="ext" maxlength="40"></textarea></div>
<button type="button" id="b2">Back</button> <button type="button" id="n2">Continue</button></div>
<div class="step" id="s3"><h2>Review &amp; consent</h2>
<spl-check label="I agree to the privacy policy and consent to the processing of my personal data *" name="consent" required></spl-check>
<spl-check label="I would like to receive job alerts and marketing emails" name="marketing"></spl-check>
<button type="button" id="b3">Back</button> <button type="button" id="sub">Submit application</button></div></div>
<script>
customElements.define('spl-input', class extends HTMLElement { connectedCallback(){ const r=this.attachShadow({mode:'open'}); r.innerHTML='<input type="text" part="input" style="width:100%;padding:6px">'; r.querySelector('input').name=this.getAttribute('name'); if(this.hasAttribute('required')) r.querySelector('input').required=true; } });
customElements.define('spl-upload', class extends HTMLElement { connectedCallback(){ const r=this.attachShadow({mode:'open'}); r.innerHTML='<label>'+this.getAttribute('label')+' *</label><input type="file" style="display:block">'; r.querySelector('input').name=this.getAttribute('name'); r.querySelector('input').required=true; } });
customElements.define('spl-check', class extends HTMLElement { connectedCallback(){ const r=this.attachShadow({mode:'open'}); r.innerHTML='<label><input type="checkbox"> '+this.getAttribute('label')+'</label>'; r.querySelector('input').name=this.getAttribute('name'); if(this.hasAttribute('required')) r.querySelector('input').required=true; } });
const deep=(root,sel,out=[])=>{ out.push(...root.querySelectorAll(sel)); for(const e of root.querySelectorAll('*')) if(e.shadowRoot) deep(e.shadowRoot,sel,out); return out; };
const err=(msg)=>{ document.querySelectorAll('.err').forEach(e=>e.remove()); const d=document.createElement('div'); d.className='err'; d.setAttribute('role','alert'); d.textContent=msg; document.querySelector('.step.on').appendChild(d); };
const val=(el)=> el.type==='checkbox'?el.checked:el.type==='file'?el.files.length:el.value.trim();
const show=(n)=>{ document.querySelectorAll('.step').forEach(s=>s.classList.toggle('on', s.id==='s'+n)); };
function check(stepId){ const bad=deep(document.getElementById(stepId),'input,select,textarea').filter(e=>e.required && !val(e)); if(bad.length){ err('Please fill in all required fields'); bad[0].setAttribute('aria-invalid','true'); return false; } return true; }
// location autocomplete
const loc=document.getElementById('loc'), lo=document.getElementById('locopts');
loc.addEventListener('input',()=>{ const q=loc.value.toLowerCase(); lo.innerHTML=''; if(!q){lo.hidden=true;return;} for(const c of ['Pune, Maharashtra, India','Pune, Oregon, USA','Chennai, Tamil Nadu, India']) if(c.toLowerCase().includes(q)){ const li=document.createElement('li'); li.setAttribute('role','option'); li.textContent=c; li.onclick=()=>{ loc.value=c; loc.dataset.chosen='1'; lo.hidden=true; }; lo.appendChild(li);} lo.hidden=false; });
// radio group
document.querySelectorAll('#q_py [role=radio]').forEach(r=>r.onclick=()=>{ document.querySelectorAll('#q_py [role=radio]').forEach(x=>x.setAttribute('aria-checked', x===r?'true':'false')); });
// custom select
const npb=document.getElementById('npb'), npo=document.getElementById('npo');
npb.onclick=()=>{ npo.hidden=!npo.hidden; npb.setAttribute('aria-expanded', String(!npo.hidden)); };
npo.querySelectorAll('[role=option]').forEach(o=>o.onclick=()=>{ npb.textContent=o.textContent; npb.dataset.value=o.textContent; npo.hidden=true; });
document.getElementById('n1').onclick=()=>{ if(!check('s1')) return; if(!loc.dataset.chosen){ err('Please pick a location from the list'); return; } const e=deep(document,'[name=email]')[0].value, e2=deep(document,'[name=email2]')[0].value; if(e!==e2){ err('Emails do not match'); return; } show(2); };
document.getElementById('b2').onclick=()=>show(1);
document.getElementById('n2').onclick=()=>{ if(!document.querySelector('#q_py [aria-checked=true]')){ err('Please answer: Python experience'); return; } if(!npb.dataset.value){ err('Please select a notice period'); return; } if(!document.getElementById('rte').textContent.trim()){ err('Please tell us about yourself'); return; } if(!check('s2')) return; show(3); };
document.getElementById('b3').onclick=()=>show(2);
document.getElementById('sub').onclick=async()=>{ if(!check('s3')) return; const fd=new FormData(); for(const e of deep(document,'input,select,textarea')){ if(!e.name) continue; fd.append(e.name, e.type==='file'? (e.files[0]||'') : e.type==='checkbox'? (e.checked?'on':'') : e.value); }
  fd.append('python', document.querySelector('#q_py [aria-checked=true]').dataset.v); fd.append('notice', npb.dataset.value); fd.append('about', document.getElementById('rte').textContent.trim());
  const r=await fetch('/__submit/smartrecruiters?job='+encodeURIComponent(location.pathname),{method:'POST',body:fd}); if(r.ok) document.body.innerHTML='<h1>Thank you for applying!</h1><p>Your application has been submitted.</p>'; };
</script></body></html>`;

// ── a page with many unusual questions (to prove the answer bank copes with wording we did not plan for) ──
const WIDE_PAGE = `<!doctype html><html><head><title>Application</title>${STYLE}</head><body><h1>Applied Scientist</h1>
<form id="f" action="#">
<div class="field"><label for="a1">Legal first name *</label><input id="a1" name="first" required></div>
<div class="field"><label for="a2">Surname *</label><input id="a2" name="last" required></div>
<div class="field"><label for="a3">Primary email address *</label><input id="a3" name="email" type="email" required></div>
<div class="field"><label for="a4">Mobile (with country code) *</label><input id="a4" name="mobile" type="tel" placeholder="+91 XXXXX XXXXX" required></div>
<div class="field"><label for="cc">Country code</label><select id="cc" name="cc"><option>+1 (United States)</option><option>+44 (United Kingdom)</option><option>+91 (India)</option></select></div>
<div class="field"><label for="a5">Resume *</label><input id="a5" name="resume" type="file" required></div>
<div class="field"><label for="a6">Total professional experience *</label><select id="a6" name="exp" required><option value="">--</option><option>Fresher / 0 years</option><option>Less than 1 year</option><option>1 to 3 years</option><option>3 to 5 years</option><option>More than 5 years</option></select></div>
<div class="field"><label for="a7">When can you join us? *</label><select id="a7" name="join" required><option value="">--</option><option>Immediately</option><option>Within 15 days</option><option>Within 1 month</option><option>2 months</option><option>3 months or more</option></select></div>
<div class="field"><label for="a8">Current annual compensation (in LPA) *</label><input id="a8" name="cur" required></div>
<div class="field"><label for="a9">Expected annual salary (INR) *</label><input id="a9" name="exp_sal" type="number" required></div>
<fieldset><legend>Are you eligible to work in India without sponsorship? *</legend><label><input type="radio" name="elig" value="y" required> Yes, I am</label> <label><input type="radio" name="elig" value="n"> No, I am not</label></fieldset>
<fieldset><legend>Would you be open to relocating to Bengaluru or Hyderabad? *</legend><label><input type="radio" name="reloc" value="Yes" required> Yes</label> <label><input type="radio" name="reloc" value="No"> No</label> <label><input type="radio" name="reloc" value="Maybe"> Maybe</label></fieldset>
<fieldset><legend>Which programming languages do you work with? *</legend><label><input type="checkbox" name="lang" value="Python" required> Python</label> <label><input type="checkbox" name="lang" value="Java"> Java</label> <label><input type="checkbox" name="lang" value="SQL"> SQL</label> <label><input type="checkbox" name="lang" value="Rust"> Rust</label></fieldset>
<div class="field"><label for="b1">Do you have hands-on experience with PyTorch? *</label><select id="b1" name="pt" required><option value="">--</option><option>Yes</option><option>No</option></select></div>
<div class="field"><label for="b2">Do you have hands-on experience with Kubernetes? *</label><select id="b2" name="k8s" required><option value="">--</option><option>Yes</option><option>No</option></select></div>
<div class="field"><label for="b3">What is your highest level of education? *</label><select id="b3" name="edu" required><option value="">--</option><option>High school</option><option>Bachelor's degree</option><option>Master's degree</option><option>Doctorate</option></select></div>
<div class="field"><label for="b4">Graduation year *</label><input id="b4" name="gy" required></div>
<div class="field"><label for="b5">Which work arrangement do you prefer? *</label><select id="b5" name="wm" required><option value="">--</option><option>Fully remote</option><option>Hybrid</option><option>Work from office</option></select></div>
<div class="field"><label for="b6">Are you willing to work night shifts? *</label><select id="b6" name="night" required><option value="">--</option><option>Yes</option><option>No</option></select></div>
<div class="field"><label for="b7">Date of birth</label><input id="b7" name="dob" type="date"></div>
<div class="field"><label for="b8">Gender</label><select id="b8" name="gender"><option value="">--</option><option>Male</option><option>Female</option><option>Prefer not to say</option></select></div>
<div class="field"><label for="b9">Type your full name as your signature *</label><input id="b9" name="sig" required></div>
<div class="field"><label for="c1">Why are you leaving your current job? *</label><textarea id="c1" name="leave" required></textarea></div>
<div class="field"><label><input type="checkbox" name="terms" required> I have read and agree to the Terms &amp; Conditions *</label></div>
<div class="field"><label><input type="checkbox" name="promo"> Send me promotional offers</label></div>
<button type="submit">Submit Application</button></form>${SCRIPT('wide')}</body></html>`;

const ACCOUNT_PAGE = `<!doctype html><html><head><title>Sign in</title>${STYLE}</head><body><h1>Candidate Home</h1><p>Create an account to apply</p><form><label>Email<input name="email"></label><label>Password<input type="password" name="pw"></label><label>Verify password<input type="password" name="pw2"></label><button>Create Account</button></form><p>Already have an account? Sign in</p></body></html>`;
const GH_EMBED_HOST = (o, id) => `<!doctype html><html><head><title>Careers</title></head><body><h1>Careers at MockCo</h1><p>Machine Learning Engineer</p><iframe id="grnhse_iframe" src="${o}/embed/job_app?for=mockco&token=${id}" style="width:100%;height:1400px;border:0"></iframe></body></html>`;

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
      smartrecruiters: { totalFound: 1, content: [{ id: '743999', name: 'Machine Learning Engineer', releasedDate: new Date().toISOString(), company: { name: 'MockCo' }, location: { city: 'Pune', country: 'in', fullLocation: 'Pune, India' }, department: { label: 'AI' } }] },
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
    if (p === '/sr-api/v1/companies/mockco/postings') return j(res, J.smartrecruiters);
    if (p === '/sr-api/v1/companies/mockco/postings/743999') return j(res, { applyUrl: `${origin()}/sr/mockco/1`, jobAd: { sections: { jobDescription: { title: 'Job Description', text: '<p>Python, PyTorch, NLP. 0-2 years of experience.</p>' } } } });
    if (p.startsWith('/sr-api/')) return j(res, { error: 'not found' }, 404);
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
    if (p === '/sr/oneclick') return html(res, SR_PAGE('mockco', 'x'));
    if ((m = /^\/sr\/(\w+)\/(\w+)$/.exec(p))) return html(res, `<h1>Machine Learning Engineer</h1><p>Pune, India</p><a class="btn" href="/sr/oneclick">I'm interested</a>`);
    if (p === '/wide/form') return html(res, WIDE_PAGE);
    if (p === '/account/login') return html(res, ACCOUNT_PAGE);
    if ((m = /^\/careers\/mockco\/(\d+)$/.exec(p))) return html(res, GH_EMBED_HOST(origin(), m[1]));
    if (p === '/embed/job_app') return html(res, ghPage('mockco', u.searchParams.get('token')));
    if (p === '/careers-noframe/mockco/9') return html(res, '<h1>Careers</h1><p>Loading…</p>');
    return html(res, '<h1>Mock job site</h1>', 200);
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({
    url: origin(), submissions, server,
    sourceBase: { greenhouse: `${origin()}/boards-api`, greenhouseEmbed: origin(), lever: `${origin()}/lever-api`, ashby: `${origin()}/ashby-api`, smartrecruiters: `${origin()}/sr-api` },
    close: () => new Promise((r) => server.close(r)),
  })));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const m = await startMock(+process.env.PORT || 4010);
  console.log(`Mock job site on ${m.url}`);
}
