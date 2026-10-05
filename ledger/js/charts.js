// Dependency-free SVG charts. Styled through CSS classes so they follow the light/dark theme.
import { compact, esc, fmt } from './util.js';

const niceMax = (v) => {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const f = v / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
};

/**
 * Stacked bars with an optional line overlay.
 * data: [{ label, segments:[{name,value,color}], line? }]
 */
export function stackedBars(data, { height = 260, lineLabel = 'Income' } = {}) {
  const W = 720, H = height, L = 52, R = 12, T = 14, B = 30;
  const max = niceMax(Math.max(1, ...data.map((d) => Math.max(d.segments.reduce((a, s) => a + s.value, 0), d.line || 0))));
  const iw = W - L - R, ih = H - T - B;
  const step = iw / Math.max(1, data.length);
  const bw = Math.min(46, step * 0.62);
  const y = (v) => T + ih - (v / max) * ih;
  let g = '';
  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i;
    g += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${compact(v)}</text>`;
  }
  let bars = '', pts = [];
  data.forEach((d, i) => {
    const cx = L + step * i + step / 2;
    let acc = 0;
    const total = d.segments.reduce((a, s) => a + s.value, 0);
    bars += `<g class="bar" tabindex="0"><title>${esc(d.label)} – spend ${fmt(total)}${d.line != null ? `, ${lineLabel.toLowerCase()} ${fmt(d.line)}` : ''}</title>`;
    for (const s of d.segments) {
      if (s.value <= 0) continue;
      const h = (s.value / max) * ih;
      bars += `<rect x="${cx - bw / 2}" y="${y(acc + s.value)}" width="${bw}" height="${Math.max(0.5, h - 0.6)}" fill="${s.color}" rx="2"><title>${esc(s.name)}: ${fmt(s.value)}</title></rect>`;
      acc += s.value;
    }
    bars += '</g>';
    g += `<text class="ax" x="${cx}" y="${H - 10}" text-anchor="middle">${esc(d.label)}</text>`;
    if (d.line != null) pts.push([cx, y(d.line), d.line, d.label]);
  });
  let line = '';
  if (pts.length) {
    line = `<polyline class="line" points="${pts.map((p) => p[0] + ',' + p[1]).join(' ')}" fill="none"/>` +
      pts.map((p) => `<circle class="dot" cx="${p[0]}" cy="${p[1]}" r="3.5"><title>${esc(p[3])} ${lineLabel.toLowerCase()}: ${fmt(p[2])}</title></circle>`).join('');
  }
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Monthly spending by category">${g}${bars}${line}</svg>`;
}

/** Donut chart. items: [{name,value,color}] */
export function donut(items, { size = 220, centreLabel = '', centreValue = '' } = {}) {
  const total = items.reduce((a, i) => a + i.value, 0);
  const r = size / 2, ro = r - 4, ri = ro * 0.62;
  if (!total) return `<svg class="chart" viewBox="0 0 ${size} ${size}"><circle cx="${r}" cy="${r}" r="${(ro + ri) / 2}" class="grid" fill="none" stroke-width="${ro - ri}"/></svg>`;
  let a0 = -Math.PI / 2, out = '';
  for (const it of items) {
    const frac = it.value / total;
    const a1 = a0 + frac * Math.PI * 2 - (frac < 1 ? 0.012 : 0);
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const p = (rad, a) => `${r + rad * Math.cos(a)},${r + rad * Math.sin(a)}`;
    out += frac >= 0.9999
      ? `<circle cx="${r}" cy="${r}" r="${(ro + ri) / 2}" fill="none" stroke="${it.color}" stroke-width="${ro - ri}"><title>${esc(it.name)}: ${fmt(it.value)}</title></circle>`
      : `<path d="M${p(ro, a0)} A${ro},${ro} 0 ${large} 1 ${p(ro, a1)} L${p(ri, a1)} A${ri},${ri} 0 ${large} 0 ${p(ri, a0)} Z" fill="${it.color}"><title>${esc(it.name)}: ${fmt(it.value)} (${(frac * 100).toFixed(0)}%)</title></path>`;
    a0 += frac * Math.PI * 2;
  }
  return `<svg class="chart donut" viewBox="0 0 ${size} ${size}" role="img" aria-label="Spending share by category">${out}
    <text class="ctr-label" x="${r}" y="${r - 6}" text-anchor="middle">${esc(centreLabel)}</text>
    <text class="ctr-value" x="${r}" y="${r + 16}" text-anchor="middle">${esc(centreValue)}</text></svg>`;
}

export function sparkline(values, { w = 120, h = 32 } = {}) {
  if (values.length < 2) return '';
  const max = Math.max(...values), min = Math.min(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * (w - 4) + 2},${h - 3 - ((v - min) / span) * (h - 6)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline points="${pts}" fill="none"/></svg>`;
}

/** Horizontal comparison bars rendered as HTML (accessible, wraps well on phones). */
export function hbars(items, { fmtValue = fmt } = {}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return `<ul class="hbars">${items.map((i) => `<li><span class="hb-name">${esc(i.name)}</span><span class="hb-track"><span class="hb-fill" style="width:${(i.value / max) * 100}%;background:${i.color || 'var(--accent)'}"></span></span><span class="hb-val">${fmtValue(i.value)}</span></li>`).join('')}</ul>`;
}
