// Resume text → structured profile draft. Heuristic and deliberately conservative: everything it extracts is shown to
// the user in the Profile screen to confirm, and nothing is invented.
import { titleCase } from './util.js';

const CITIES = ['Chennai', 'Bengaluru', 'Bangalore', 'Hyderabad', 'Pune', 'Mumbai', 'Delhi', 'New Delhi', 'Gurgaon', 'Gurugram', 'Noida', 'Kochi', 'Coimbatore', 'Kolkata', 'Ahmedabad', 'Jaipur', 'Chandigarh', 'Trivandrum', 'Thiruvananthapuram', 'Madurai', 'Mysore', 'Indore'];

/** [canonical name, regex source]. Word-boundary matched, case-insensitive. */
export const SKILLS = [
  ['Python', 'python'], ['Java', 'java(?!script)'], ['JavaScript', 'javascript|node\\.?js'], ['TypeScript', 'typescript'], ['C++', 'c\\+\\+'], ['SQL', 'sql|mysql|postgres(?:ql)?|sqlite'], ['MySQL', 'mysql'], ['R', '(?<![a-z])R(?![a-z+#])'],
  ['Machine Learning', 'machine learning|\\bml\\b|ai/ml|aiml'], ['Deep Learning', 'deep learning'], ['Computer Vision', 'computer vision|image classification|object detection|opencv'],
  ['NLP', '\\bnlp\\b|natural language'], ['LLM', '\\bllms?\\b|large language model'], ['Generative AI', 'gen ?ai|generative ai|genai'], ['RAG', '\\brag\\b|retrieval[- ]augmented'],
  ['TensorFlow', 'tensorflow'], ['Keras', 'keras'], ['PyTorch', 'pytorch|torch'], ['Scikit-learn', 'scikit[- ]?learn|sklearn'], ['OpenCV', 'opencv'], ['YOLO', 'yolo'], ['Mediapipe', 'mediapipe'],
  ['LSTM', 'lstm'], ['CNN', '\\bcnns?\\b|convolutional'], ['Random Forest', 'random forest'], ['SVM', '\\bsvm\\b|support vector'], ['K-NN', 'k-?nn'], ['XGBoost', 'xgboost'], ['Transformers', 'transformers?|hugging ?face|bert'],
  ['LangChain', 'langchain'], ['LangGraph', 'langgraph'], ['CrewAI', 'crew ?ai'], ['AI Agents', 'ai agents?|agentic|agno'], ['RPA', '\\brpa\\b|robotic process'], ['Automation', 'automation'],
  ['Pandas', 'pandas'], ['NumPy', 'numpy'], ['Matplotlib', 'matplotlib'], ['Excel', 'excel'], ['Power BI', 'power ?bi'], ['Tableau', 'tableau'], ['Statistics', 'statistic'], ['Data Analysis', 'data analy'], ['Data Science', 'data science'],
  ['Time Series', 'time[- ]series'], ['Predictive Modeling', 'predictive'], ['Feature Engineering', 'feature engineering'], ['MLOps', 'mlops'], ['Docker', 'docker'], ['Kubernetes', 'kubernetes|k8s'], ['Git', '\\bgit\\b|github'],
  ['AWS', '\\baws\\b|amazon web services'], ['Azure', 'azure'], ['GCP', '\\bgcp\\b|google cloud'], ['FastAPI', 'fastapi'], ['Flask', 'flask'], ['Django', 'django'], ['React', 'react(?:\\.js)?'], ['HTML', 'html'], ['Tkinter', 'tkinter'],
  ['OCR', '\\bocr\\b'], ['Recommendation Systems', 'recommendation'], ['Anomaly Detection', 'anomaly|fraud detection'], ['Cloud Computing', 'cloud computing'], ['Networking', 'networks?\\b'],
];

const MON = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
const monIdx = (s) => MON[String(s).toLowerCase().slice(0, 4).replace(/\.$/, '')] ?? MON[String(s).toLowerCase().slice(0, 3)];

function parseRanges(text, now) {
  const re = /\b([A-Za-z]{3,9})\.?\s*(\d{4})\s*\*?\s*[–—-]\s*(present\s*\*?|[A-Za-z]{3,9}\.?\s*\d{4}\s*\*?)/gi;
  const out = [];
  let m;
  while ((m = re.exec(text))) {
    const sm = monIdx(m[1]);
    if (sm == null) continue;
    const start = new Date(+m[2], sm, 1);
    let end;
    if (/present/i.test(m[3])) end = now;
    else { const e = m[3].match(/([A-Za-z]{3,9})\.?\s*(\d{4})/); const em = e && monIdx(e[1]); if (em == null) continue; end = new Date(+e[2], em + 1, 0); }
    if (end < start || start.getFullYear() < 1990) continue;
    const before = text.slice(Math.max(0, m.index - 4), m.index);
    const line = text.slice(text.lastIndexOf('\n', m.index) + 1, text.indexOf('\n', m.index) < 0 ? undefined : text.indexOf('\n', m.index));
    out.push({ start, end, raw: m[0], paren: /\(\s*$/.test(before), education: /college|university|school|b\.?\s?tech|b\.?e\b|education|cgpa|grade/i.test(line) });
  }
  return out;
}

/** Total months covered by the ranges (overlaps counted once), ignoring future dates. */
export function monthsCovered(ranges, now = new Date()) {
  const rs = ranges.map((r) => ({ s: r.start.getTime(), e: Math.min(r.end.getTime(), now.getTime()) })).filter((r) => r.e > r.s).sort((a, b) => a.s - b.s);
  let total = 0, cur = null;
  for (const r of rs) { if (!cur || r.s > cur.e) { if (cur) total += cur.e - cur.s; cur = { ...r }; } else cur.e = Math.max(cur.e, r.e); }
  if (cur) total += cur.e - cur.s;
  return total / (1000 * 60 * 60 * 24 * 30.44);
}

export function parseResume(text, { now = new Date() } = {}) {
  const raw = String(text || '');
  const flat = raw.replace(/\r/g, '');
  const lines = flat.split('\n').map((l) => l.trim()).filter(Boolean);

  const email = (flat.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/) || [])[0] || '';
  const phoneM = flat.match(/(?:\+?91[\s-]?)?([6-9]\d{4}[\s-]?\d{5})\b/) || flat.match(/(?:\+?\d{1,3}[\s-]?)?\(?\d{3,5}\)?[\s-]?\d{3,5}[\s-]?\d{3,5}/);
  const phone = phoneM ? (phoneM[1] || phoneM[0]).replace(/[^\d+]/g, '').replace(/^91(?=\d{10}$)/, '') : '';
  const linkedin = (flat.match(/(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[A-Za-z0-9\-_%]+/i) || [''])[0];
  const github = (flat.match(/(?:https?:\/\/)?(?:www\.)?github\.com\/[A-Za-z0-9\-_]+/i) || [''])[0];
  const website = (flat.match(/https?:\/\/(?!(?:www\.)?(?:linkedin|github)\.)[^\s)]+/i) || [''])[0];

  // Name: first line that is mostly letters, 2–4 words, no digits/@ (resumes put it on top, often upper-case).
  let name = '';
  for (const l of lines.slice(0, 8)) {
    const t = l.replace(/\s{3,}.*/, '').trim(); // layout text: keep only the left cell
    if (/^[A-Za-z][A-Za-z.'-]+(?:\s+[A-Za-z][A-Za-z.'-]+){1,3}$/.test(t) && !/@|\d|resume|curriculum|engineer|developer|analyst|scientist/i.test(t)) { name = titleCase(t); break; }
  }
  if (!name && email) name = titleCase(email.split('@')[0].replace(/[._\d]+/g, ' ').trim());
  const parts = name.split(/\s+/).filter(Boolean);
  const firstName = parts[0] || '';
  const lastName = parts.slice(1).join(' ');

  const headline = titleCase((lines.slice(0, 6).find((l) => /engineer|developer|scientist|analyst|designer|manager|consultant|architect/i.test(l) && l.length < 80) || '').replace(/\s{3,}.*/, '').trim());

  const city = CITIES.find((c) => new RegExp(`\\b${c}\\b`, 'i').test(flat)) || '';
  const location = city ? `${city === 'Bangalore' ? 'Bengaluru' : city}, India` : (/india/i.test(flat) ? 'India' : '');

  const skills = [];
  for (const [name_, src] of SKILLS) {
    const re = new RegExp(src.startsWith('(?<') ? src : `\\b(?:${src})`, src === '(?<![a-z])R(?![a-z+#])' ? '' : 'i');
    if (re.test(flat) && !skills.includes(name_)) skills.push(name_);
  }
  // "R" is too ambiguous in running text – only keep it if listed explicitly.
  if (skills.includes('R') && !/(?:languages?|skills?)[^\n]{0,80}\bR\b/i.test(flat)) skills.splice(skills.indexOf('R'), 1);

  const allRanges = parseRanges(flat, now);
  // Work experience dates normally sit in brackets after the employer: "ACME (MAR 2024 – PRESENT)". Education dates must not count.
  const ranges = allRanges.some((r) => r.paren) ? allRanges.filter((r) => r.paren) : allRanges.filter((r) => !r.education);
  const months = monthsCovered(ranges, now);
  const degree = (flat.match(/\b(B\.?\s?Tech|B\.?E\.?|M\.?\s?Tech|M\.?E\.?|B\.?Sc|M\.?Sc|MBA|BCA|MCA)\b[^\n]{0,80}/i) || [''])[0].replace(/\s{2,}.*/, '').trim();
  const gradYear = (() => { const m = flat.match(/(?:20\d\d)\s*[–—-]\s*([A-Za-z]{3,9}\.?\s*)?(20\d\d)/); return m ? +m[2] : null; })();
  const cgpa = (flat.match(/CGPA[:\s]*([0-9.]+)\s*\/\s*10/i) || [])[1] || '';
  const currentCompany = (() => { const m = flat.match(/(?:^|\s{2,}|\n)([A-Z][A-Z0-9&.' -]{3,40}?)\s*\(\s*[A-Za-z]{3,9}\.?\s*\d{4}\s*\*?\s*[–—-]\s*present/i); return m ? titleCase(m[1].trim()) : ''; })();
  const currentTitle = (() => { const i = lines.findIndex((l) => /present/i.test(l) && /\(/.test(l));
    if (i < 0) return '';
    for (const l of lines.slice(i + 1, i + 4)) for (const cell of l.split(/\s{3,}/)) if (/engineer|developer|scientist|analyst|intern|trainee|associate/i.test(cell) && !/b\.?tech|cgpa|college|developed|built|designed|integrated/i.test(cell)) return cell.replace(/^[•\s]+/, '').split(/\s[—–-]\s/)[0].trim();
    return ''; })();

  return {
    firstName, lastName, fullName: name, email, phone, location, city: city === 'Bangalore' ? 'Bengaluru' : city, country: 'India', linkedin, github, website, headline,
    skills, experienceYears: Math.round((months / 12) * 2) / 2, experienceMonths: Math.round(months), education: { degree, gradYear, cgpa }, currentCompany, currentTitle,
    summary: (() => { const i = lines.findIndex((l) => /PROFILE SUMMARY|^SUMMARY|^ABOUT/i.test(l)); if (i < 0) return ''; const out = []; for (const l of lines.slice(i + 1, i + 9)) { if (/^(EDUCATION|EXPERIENCE|SKILLS|PROJECTS)\b/.test(l)) break; const cells = l.split(/\s{3,}/); out.push(cells.length > 1 ? cells.slice(1).join(' ') : cells[0]); } return out.join(' ').replace(/\s+/g, ' ').trim().slice(0, 600); })(),
  };
}
