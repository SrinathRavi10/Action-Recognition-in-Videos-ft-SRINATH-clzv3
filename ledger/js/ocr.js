// Offline OCR for scanned statements (Tesseract compiled to WebAssembly, bundled in vendor/ocr).
import { groupLines } from './parser.js';

let worker, loading;
const base = (p) => new URL(`../vendor/ocr/${p}`, import.meta.url).href;

function loadScript(src) {
  return new Promise((res, rej) => {
    if (window.Tesseract) return res();
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load the OCR engine'));
    document.head.appendChild(s);
  });
}

async function getWorker(onProgress) {
  if (worker) return worker;
  if (loading) return loading;
  loading = (async () => {
    await loadScript(base('tesseract.min.js'));
    const w = await window.Tesseract.createWorker('eng', 1, {
      workerPath: base('worker.min.js'), corePath: base(''), langPath: base(''), gzip: true, workerBlobURL: false,
      logger: (m) => { if (m.status === 'recognizing text') onProgress?.(m.progress); },
    });
    await w.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1' });
    worker = w;
    return w;
  })();
  try { return await loading; } finally { loading = null; }
}

/** Recognise one canvas and return pdf.js-style lines for the parser. */
async function recognise(canvas, onProgress) {
  const w = await getWorker(onProgress);
  const { data } = await w.recognize(canvas, {}, { blocks: true });
  const words = [];
  for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) for (const wd of l.words || []) words.push(wd);
  const H = canvas.height;
  const items = words.filter((x) => x.text && x.text.trim() && x.confidence > 20).map((x) => ({ str: x.text, x: x.bbox.x0, y: H - (x.bbox.y0 + x.bbox.y1) / 2, w: x.bbox.x1 - x.bbox.x0 }));
  const hs = words.map((x) => x.bbox.y1 - x.bbox.y0).sort((a, b) => a - b);
  const med = hs[Math.floor(hs.length / 2)] || 20;
  return groupLines(items, med * 0.55);
}

/** OCR every page of an already-open pdf.js document. onProgress(pageIndex, pages, fraction) */
export async function ocrPdfDoc(doc, onProgress) {
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale: 3 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    pages.push(await recognise(canvas, (f) => onProgress?.(i, doc.numPages, f)));
    canvas.width = canvas.height = 0;
  }
  return pages;
}

/** OCR a photo/screenshot of a statement. */
export async function ocrImage(file, onProgress) {
  const bmp = await createImageBitmap(file);
  const scale = bmp.width < 1600 ? 2 : 1;
  const canvas = document.createElement('canvas');
  canvas.width = bmp.width * scale; canvas.height = bmp.height * scale;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return [await recognise(canvas, (f) => onProgress?.(1, 1, f))];
}

export async function stopOcr() { if (worker) { await worker.terminate(); worker = null; } }
