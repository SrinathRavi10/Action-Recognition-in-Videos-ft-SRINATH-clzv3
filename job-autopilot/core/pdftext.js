// PDF → plain text (server-side, no network). Uses pdf.js' legacy Node build.
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);

/** Join the text items of one visual line: tiny gap = same word (letter-spaced headings), normal gap = space, big gap = column break. */
function joinRow(items) {
  // Letter-spaced headings arrive one glyph per item: use the typical gap to tell letter gaps from word gaps.
  if (items.length > 6 && items.filter((i) => i.str.trim().length === 1).length / items.length > 0.8) {
    const gaps = items.slice(1).map((it, k) => it.transform[4] - (items[k].transform[4] + items[k].width)).sort((a, b) => a - b);
    const med = gaps[Math.floor(gaps.length / 2)] || 1;
    return items.map((it, k) => (k && it.transform[4] - (items[k - 1].transform[4] + items[k - 1].width) > med * 1.9 ? ' ' : '') + it.str.trim()).join('');
  }
  let out = '';
  items.forEach((it, i) => {
    const str = it.str.replace(/\s+/g, ' ');
    if (i) {
      const p = items[i - 1];
      const h = Math.abs(it.transform[3]) || 10;
      const gap = it.transform[4] - (p.transform[4] + p.width);
      const sep = /\s$/.test(p.str) || /^\s/.test(it.str) ? '' : gap < 0.12 * h ? '' : gap < 1.6 * h ? ' ' : '   ';
      out += sep;
    }
    out += str;
  });
  return out.replace(/ {4,}/g, '   ').trim();
}

export async function pdfToText(file) {
  const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
  const data = new Uint8Array(fs.readFileSync(file));
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true, isEvalSupported: false, verbosity: 0 }).promise;
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent();
    // group by line (y), keep reading order within a line
    const rows = new Map();
    for (const it of tc.items) { if (!it.str.trim()) continue; const y = Math.round(it.transform[5] / 3); (rows.get(y) || rows.set(y, []).get(y)).push(it); }
    pages.push([...rows.entries()].sort((a, b) => b[0] - a[0]).map(([, its]) => joinRow(its.sort((a, b) => a.transform[4] - b.transform[4]))).join('\n'));
  }
  return pages.join('\n');
}
