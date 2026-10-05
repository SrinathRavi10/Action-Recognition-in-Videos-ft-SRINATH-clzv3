// Thin pdf.js wrapper (vendored, no network). Returns positioned text lines per page.
import { groupLines } from './parser.js';

export class PasswordCancelled extends Error {}

function lib() {
  const l = window.pdfjsLib;
  if (!l) throw new Error('pdf.js failed to load');
  l.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.min.js', import.meta.url).href;
  return l;
}

/** askPassword(wasWrong) => Promise<string|null> */
export async function readPdf(file, askPassword) {
  const pdfjs = lib();
  const data = new Uint8Array(await file.arrayBuffer());
  const task = pdfjs.getDocument({ data, isEvalSupported: false });
  task.onPassword = async (update, reason) => {
    const pw = await askPassword(reason === pdfjs.PasswordResponses.INCORRECT_PASSWORD);
    if (pw == null) { task.destroy(); return; }
    update(pw);
  };
  let pdf;
  try {
    pdf = await task.promise;
  } catch (e) {
    if (e?.name === 'PasswordException' || e?.name === 'Error' && /destroy/i.test(e.message)) throw new PasswordCancelled();
    throw e;
  }
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const tc = await page.getTextContent();
    const items = tc.items.map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width }));
    pages.push(groupLines(items));
  }
  const textChars = pages.reduce((a, p) => a + p.reduce((b, l) => b + l.items.reduce((c, i) => c + i.str.length, 0), 0), 0);
  return { pages, textChars, numPages: pdf.numPages };
}

export const pagesToText = (pages) => pages.map((p) => p.map((l) => l.items.map((i) => i.str).join(' ')).join('\n')).join('\n');
