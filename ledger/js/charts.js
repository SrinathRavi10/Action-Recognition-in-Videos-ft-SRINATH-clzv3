// Dependency-free SVG charts with hover tooltips. Colours come from CSS variables (--s1…--s8), so they follow the theme.
import { compact, esc, fmt } from './util.js';

const niceMax = (v) => {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const f = v / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
};
const fill = (c) => `style="fill:${c}"`;
let uid = 0;

// ---- shared tooltip (one element, positioned from data-tip attributes via event delegation) ----
let tipEl;
export function installTooltips(root = document) {
  if (!tipEl) { tipEl = document.createElement('div'); tipEl.className = 'tip'; tipEl.setAttribute('role', 'tooltip'); document.body.appendChild(tipEl); }
  const show = (e) => {
    const t = e.target.closest?.('[data-tip]');
    if (!t) { tipEl.classList.remove('on'); return; }
    tipEl.innerHTML = t.dataset.tip;
    tipEl.classList.add('on');
    const w = tipEl.offsetWidth, h = tipEl.offsetHeight;
    const x = Math.min(innerWidth - w - 10, Math.max(10, e.clientX + 14));
    const y = e.clientY - h - 14 < 8 ? e.clientY + 18 : e.clientY - h - 14;
    tipEl.style.left = x + 'px'; tipEl.style.top = y + 'px';
  };
  root.addEventListener('pointermove', show);
  root.addEventListener('pointerleave', () => tipEl.classList.remove('on'));
  root.addEventListener('focusin', (e) => { const t = e.target.closest?.('[data-tip]'); if (t) { const r = t.getBoundingClientRect(); show({ target: t, clientX: r.left + r.width / 2, clientY: r.top }); } });
  root.addEventListener('focusout', () => tipEl.classList.remove('on'));
}
export const tip = (title, rows = []) => esc(`<b>${title}</b>${rows.map(([c, k, v]) => `<div class="r"><span>${c ? `<i style="background:${c}"></i>` : ''}${k}</span><span>${v}</span></div>`).join('')}`).replace(/&quot;/g, '&quot;');

/**
 * Stacked bars (+ optional line). data: [{ label, full, segments:[{name,value,color}], line? }]
 */
export function stackedBars(data, { height = 300, width = 540, lineLabel = 'Income' } = {}) {
  const W = width, H = height, L = 54, R = 10, T = 16, B = 30;
  const max = niceMax(Math.max(1, ...data.map((d) => Math.max(d.segments.reduce((a, s) => a + s.value, 0), d.line || 0))));
  const iw = W - L - R, ih = H - T - B;
  const step = iw / Math.max(1, data.length);
  const bw = Math.min(44, step * 0.6);
  const y = (v) => T + ih - (v / max) * ih;
  let g = '';
  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i;
    g += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${L - 10}" y="${y(v) + 4}" text-anchor="end">${compact(v)}</text>`;
  }
  let bars = '', pts = [];
  data.forEach((d, i) => {
    const cx = L + step * i + step / 2;
    const total = d.segments.reduce((a, s) => a + s.value, 0);
    let acc = 0;
    const rows = [...d.segments].reverse().filter((s) => s.value > 0).map((s) => [s.color, esc(s.name), fmt(s.value)]);
    if (d.line != null) rows.push(['var(--text)', lineLabel, fmt(d.line)]);
    const t = tip(d.full || d.label, [['', 'Spent', `<b style="display:inline">${fmt(total)}</b>`], ...rows]);
    bars += `<g class="bar" tabindex="0" data-tip="${t}" aria-label="${esc(d.full || d.label)} spent ${fmt(total)}"><rect x="${cx - step / 2}" y="${T}" width="${step}" height="${ih}" fill="transparent"/>`;
    const segs = d.segments.filter((s) => s.value > 0);
    segs.forEach((s, k) => {
      const h = (s.value / max) * ih;
      const top = k === segs.length - 1;
      const yy = y(acc + s.value);
      const rr = top ? 5 : 0;
      bars += `<path ${fill(s.color)} d="M${cx - bw / 2},${yy + Math.max(h - 2, 0.5)} V${yy + rr} Q${cx - bw / 2},${yy} ${cx - bw / 2 + rr},${yy} H${cx + bw / 2 - rr} Q${cx + bw / 2},${yy} ${cx + bw / 2},${yy + rr} V${yy + Math.max(h - 2, 0.5)} Z"><animate attributeName="opacity" from="0" to="1" dur=".5s" begin="${i * 0.04}s" fill="freeze"/></path>`;
      acc += s.value;
    });
    bars += '</g>';
    g += `<text class="ax" x="${cx}" y="${H - 8}" text-anchor="middle">${esc(d.label)}</text>`;
    if (d.line != null) pts.push([cx, y(d.line)]);
  });
  const line = pts.length ? `<polyline class="line" points="${pts.map((p) => p.join(',')).join(' ')}"/>${pts.map((p) => `<circle class="dot" cx="${p[0]}" cy="${p[1]}" r="3.5"/>`).join('')}` : '';
  return `<div class="chart-wrap"><svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Monthly spending by category">${g}<g class="bars">${bars}</g>${line}</svg></div>`;
}

/** Donut. items: [{name,value,color}] */
export function donut(items, { size = 220, centreLabel = '', centreValue = '' } = {}) {
  const total = items.reduce((a, i) => a + i.value, 0);
  const r = size / 2, ro = r - 6, ri = ro * 0.64;
  if (!total) return `<svg class="chart" viewBox="0 0 ${size} ${size}"><circle cx="${r}" cy="${r}" r="${(ro + ri) / 2}" class="grid" fill="none" stroke-width="${ro - ri}"/></svg>`;
  let a0 = -Math.PI / 2, out = '';
  for (const it of items) {
    const frac = it.value / total;
    const gap = frac < 1 ? 0.025 : 0;
    const a1 = a0 + frac * Math.PI * 2 - gap;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const p = (rad, a) => `${(r + rad * Math.cos(a)).toFixed(2)},${(r + rad * Math.sin(a)).toFixed(2)}`;
    const t = tip(esc(it.name), [[it.color, 'Spent', fmt(it.value)], ['', 'Share', `${(frac * 100).toFixed(0)}%`]]);
    out += frac >= 0.9999
      ? `<circle class="arc" cx="${r}" cy="${r}" r="${(ro + ri) / 2}" fill="none" style="stroke:${it.color}" stroke-width="${ro - ri}" data-tip="${t}"/>`
      : `<path class="arc" ${fill(it.color)} data-tip="${t}" tabindex="0" d="M${p(ro, a0 + gap / 2)} A${ro},${ro} 0 ${large} 1 ${p(ro, a1)} L${p(ri, a1)} A${ri},${ri} 0 ${large} 0 ${p(ri, a0 + gap / 2)} Z"><animate attributeName="opacity" from="0" to="1" dur=".5s" fill="freeze"/></path>`;
    a0 += frac * Math.PI * 2;
  }
  return `<svg class="chart donut" viewBox="0 0 ${size} ${size}" role="img" aria-label="Spending share">${out}
    <text class="ctr-label" x="${r}" y="${r - 6}" text-anchor="middle">${esc(centreLabel)}</text>
    <text class="ctr-value" x="${r}" y="${r + 18}" text-anchor="middle">${esc(centreValue)}</text></svg>`;
}

/**
 * Area/line chart with crosshair tooltips. series: [{ name, color, points:[{x:label, y:number}], dashed? }]
 */
export function areaChart(series, { height = 240, area = true, yFmt = compact, labelEvery = 1 } = {}) {
  const W = 760, H = height, L = 54, R = 14, T = 14, B = 30;
  const n = Math.max(...series.map((s) => s.points.length));
  if (n < 2) return '<p class="muted small">Needs at least two data points.</p>';
  const all = series.flatMap((s) => s.points.map((p) => p.y));
  const minV = Math.min(0, ...all), maxV = niceMax(Math.max(1, ...all));
  const iw = W - L - R, ih = H - T - B;
  const x = (i) => L + (i / (n - 1)) * iw;
  const y = (v) => T + ih - ((v - minV) / (maxV - minV || 1)) * ih;
  const id = ++uid;
  let g = '';
  for (let i = 0; i <= 4; i++) {
    const v = minV + ((maxV - minV) / 4) * i;
    g += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${L - 10}" y="${y(v) + 4}" text-anchor="end">${yFmt(v)}</text>`;
  }
  const labels = series[0].points;
  labels.forEach((p, i) => { if (i % labelEvery === 0) g += `<text class="ax" x="${x(i)}" y="${H - 8}" text-anchor="middle">${esc(p.x)}</text>`; });
  let paths = '';
  series.forEach((s, k) => {
    const pts = s.points.map((p, i) => [x(i), y(p.y)]);
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
    if (area && k === 0) paths += `<defs><linearGradient id="ag${id}" x1="0" y1="0" x2="0" y2="1" class="area-g"><stop offset="0" style="stop-color:${s.color}"/><stop offset="1" style="stop-color:${s.color}"/></linearGradient></defs><path d="${d} L${pts.at(-1)[0]},${T + ih} L${pts[0][0]},${T + ih} Z" fill="url(#ag${id})"/>`;
    paths += `<path d="${d}" fill="none" style="stroke:${s.color}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" ${s.dashed ? 'stroke-dasharray="6 5"' : ''} pathLength="1"><animate attributeName="stroke-dashoffset" from="1" to="0" dur=".8s" fill="freeze"/></path>`;
  });
  // hover columns
  let hover = '';
  const colW = iw / (n - 1);
  for (let i = 0; i < n; i++) {
    const rows = series.map((s) => [s.color, esc(s.name), s.points[i] ? fmt(s.points[i].y) : '–']);
    hover += `<g class="hv"><rect x="${x(i) - colW / 2}" y="${T}" width="${colW}" height="${ih}" fill="transparent" data-tip="${tip(esc(String(labels[i]?.full || labels[i]?.x)), rows)}"/></g>`;
  }
  const dots = series.map((s) => s.points.map((p, i) => (i === s.points.length - 1 ? `<circle cx="${x(i)}" cy="${y(p.y)}" r="4.5" style="fill:${s.color}" stroke="var(--surface)" stroke-width="2"/>` : '')).join('')).join('');
  return `<div class="chart-wrap"><svg class="chart" viewBox="0 0 ${W} ${H}" role="img">${g}${paths}${dots}${hover}</svg></div>`;
}

export function sparkline(values, { w = 120, h = 32 } = {}) {
  if (values.length < 2) return '';
  const max = Math.max(...values), min = Math.min(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * (w - 4) + 2},${h - 3 - ((v - min) / span) * (h - 6)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline points="${pts}"/></svg>`;
}

/** Horizontal bars (HTML). items: [{name,value,color,sub?}] */
export function hbars(items, { fmtValue = fmt } = {}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return `<ul class="hbars">${items.map((i) => `<li><span class="hb-name" title="${esc(i.name)}">${esc(i.name)}</span><span class="hb-track"><span class="hb-fill" style="width:${(i.value / max) * 100}%;background:${i.color || 'var(--accent)'}"></span></span><span class="hb-val">${fmtValue(i.value)}</span></li>`).join('')}</ul>`;
}

/** Calendar heatmap for one month: byDay = {1: amount, …}; sequential single-hue steps. */
export function monthHeat(month, byDay) {
  const [y, m] = month.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const days = new Date(y, m, 0).getDate();
  const offset = (first.getDay() + 6) % 7; // Monday first
  const vals = Object.values(byDay).filter((v) => v > 0).sort((a, b) => a - b);
  const q = (v) => (!v ? 0 : 1 + Math.min(4, Math.floor((vals.indexOf(v) / Math.max(1, vals.length)) * 5)));
  let cells = ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d) => `<div class="dow">${d}</div>`).join('');
  cells += '<div style="visibility:hidden"></div>'.repeat(offset);
  for (let d = 1; d <= days; d++) {
    const v = byDay[d] || 0;
    cells += `<div class="${v ? 'h' + q(v) : ''}" data-tip="${tip(`${d} ${first.toLocaleString('en', { month: 'short' })}`, [['', 'Spent', fmt(v)]])}" tabindex="0">${d}</div>`;
  }
  return `<div class="heat" role="img" aria-label="Daily spending calendar">${cells}</div>`;
}
