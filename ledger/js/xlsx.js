// Minimal XLSX support without libraries: read the first sheet of a workbook; write multi-sheet workbooks.
// Zip handling uses the platform's CompressionStream (browser, Electron, Node 18+).

const te = new TextEncoder(), td = new TextDecoder();

// ───────── zip read ─────────
const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

async function inflateRaw(bytes) {
  const ds = new DecompressionStream('deflate-raw');
  const w = ds.writable.getWriter();
  w.write(bytes); w.close();
  return new Uint8Array(await new Response(ds.readable).arrayBuffer());
}

export async function unzip(buf) {
  const b = new Uint8Array(buf);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 70000); i--) if (u32(b, i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Not a valid .xlsx file');
  const n = u16(b, eocd + 10);
  let p = u32(b, eocd + 16);
  const files = {};
  for (let i = 0; i < n; i++) {
    if (u32(b, p) !== 0x02014b50) break;
    const method = u16(b, p + 10), csize = u32(b, p + 20), nlen = u16(b, p + 28), elen = u16(b, p + 30), clen = u16(b, p + 32), off = u32(b, p + 42);
    const name = td.decode(b.subarray(p + 46, p + 46 + nlen));
    const lh = off + 30 + u16(b, off + 26) + u16(b, off + 28);
    const data = b.subarray(lh, lh + csize);
    files[name] = { method, data };
    p += 46 + nlen + elen + clen;
  }
  const read = async (name) => {
    const f = files[name];
    if (!f) return null;
    return td.decode(f.method === 0 ? f.data : await inflateRaw(f.data));
  };
  return { names: Object.keys(files), read };
}

const unxml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&amp;/g, '&');
const colIndex = (ref) => { const m = ref.match(/^[A-Z]+/)[0]; let n = 0; for (const c of m) n = n * 26 + c.charCodeAt(0) - 64; return n - 1; };

/** Read a worksheet (default: first) into an array of rows of strings. */
export async function readXlsx(buf, sheetIndex = 0) {
  const z = await unzip(buf);
  const shared = [];
  const ss = await z.read('xl/sharedStrings.xml');
  if (ss) for (const si of ss.matchAll(/<si[^>]*>([\s\S]*?)<\/si>/g)) shared.push(unxml([...si[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join('')));
  const sheets = z.names.filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort((a, b) => +a.match(/\d+/)[0] - +b.match(/\d+/)[0]);
  if (!sheets.length) throw new Error('No worksheets found');
  const xml = await z.read(sheets[Math.min(sheetIndex, sheets.length - 1)]);
  const rows = [];
  for (const r of xml.matchAll(/<row[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const row = [];
    for (const c of (r[1] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1], inner = c[2] || '';
      const ref = attrs.match(/\br="([A-Z]+\d+)"/)?.[1];
      const type = attrs.match(/\bt="(\w+)"/)?.[1];
      let val = '';
      const v = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      if (type === 's' && v != null) val = shared[+v] ?? '';
      else if (type === 'inlineStr') val = unxml([...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(''));
      else if (v != null) val = unxml(v);
      row[ref ? colIndex(ref) : row.length] = val;
    }
    for (let i = 0; i < row.length; i++) if (row[i] === undefined) row[i] = '';
    rows.push(row);
  }
  return rows;
}

// ───────── zip write (stored, no compression) ─────────
let CRC;
function crc32(b) {
  if (!CRC) { CRC = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c >>> 0; } }
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function zip(files) {
  const parts = [], central = [];
  let off = 0;
  const h16 = (v) => [v & 255, (v >> 8) & 255], h32 = (v) => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255];
  for (const [name, content] of Object.entries(files)) {
    const nb = te.encode(name), data = typeof content === 'string' ? te.encode(content) : content, crc = crc32(data);
    const local = new Uint8Array([0x50, 0x4b, 3, 4, 20, 0, 0, 8, 0, 0, 0, 0, 0x21, 0, ...h32(crc), ...h32(data.length), ...h32(data.length), ...h16(nb.length), 0, 0]);
    parts.push(local, nb, data);
    central.push(new Uint8Array([0x50, 0x4b, 1, 2, 20, 0, 20, 0, 0, 8, 0, 0, 0, 0, 0x21, 0, ...h32(crc), ...h32(data.length), ...h32(data.length), ...h16(nb.length), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ...h32(off)]), nb);
    off += local.length + nb.length + data.length;
  }
  const cdSize = central.reduce((a, c) => a + c.length, 0);
  const end = new Uint8Array([0x50, 0x4b, 5, 6, 0, 0, 0, 0, ...h16(Object.keys(files).length), ...h16(Object.keys(files).length), ...h32(cdSize), ...h32(off), 0, 0]);
  return new Blob([...parts, ...central, end], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

const xe = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
const colName = (i) => { let s = ''; for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };

/**
 * Build a workbook. sheets: [{ name, rows:[[cell,…]], header?: true, widths?: [..], money?: [colIdx,…] }]
 * Cells: string | number | { v, bold } .
 */
export function buildXlsx(sheets) {
  const files = {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`,
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${xe(s.name.slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    // style ids: 0 normal, 1 bold header, 2 money #,##0.00
    'xl/styles.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>',
  };
  sheets.forEach((s, si) => {
    const money = new Set(s.money || []);
    const rows = s.rows.map((row, ri) => `<row r="${ri + 1}">${row.map((cell, ci) => {
      if (cell == null || cell === '') return '';
      const ref = colName(ci) + (ri + 1);
      const bold = (s.header !== false && ri === 0) || (cell && cell.bold);
      const v = cell && typeof cell === 'object' ? cell.v : cell;
      if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}" s="${bold ? 1 : money.has(ci) ? 2 : 0}"><v>${v}</v></c>`;
      return `<c r="${ref}" t="inlineStr" s="${bold ? 1 : 0}"><is><t xml:space="preserve">${xe(v)}</t></is></c>`;
    }).join('')}</row>`).join('');
    const cols = s.widths ? `<cols>${s.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
    files[`xl/worksheets/sheet${si + 1}.xml`] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${s.header !== false ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' : ''}${cols}<sheetData>${rows}</sheetData></worksheet>`;
  });
  return zip(files);
}
