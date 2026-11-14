import * as THREE from 'three';
import { Geo, pip, bbox, centroid, distToPoly, addFlatPoly, addRibbon } from './geo.js';
import { rng, canvasTex, plainTex, grassTex, signTex } from './textures.js';
import { fbm } from './world.js';
import { leafTex, blob, merge, plantMaterials, extraPlants, noTreeZones, foliageGlow } from './plants.js';

// The academic quadrangle: the lawn enclosed by the library wing, the auditorium and the
// classroom wing, with four double-lane slab paths meeting at a round fountain. The faces of
// the academic block that look onto it are rebuilt in 3D after the reference photos: red
// sandstone piers in front of recessed verandas, Dholpur-stone bands, framed glazing.
const ACAD = 5372151, AUD = 19224287;
export const QUAD = { c: [-184.2, -181.8], poly: null, edges: [], arms: [], stage: null, acad: null, aud: null };
const FH = 4.2;                       // storey height of the colonnaded wings
const LANE = 2.4, LANE_OFF = 2.6;     // slab lane width and its offset from the arm axis

// local frame of a footprint edge: s runs along it, o points out of the building
function frame(p, q) {
  const dx = q[0] - p[0], dz = q[1] - p[1], L = Math.hypot(dx, dz);
  const tx = dx / L, tz = dz / L, nx = tz, nz = -tx;
  return { p, q, L, tx, tz, nx, nz, ang: Math.atan2(tz, tx), P: (s, o = 0) => [p[0] + tx * s + nx * o, p[1] + tz * s + nz * o] };
}
const segDist = (x, z, a, b) => {
  const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l2));
  return Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz);
};
const nearArm = (x, z, lim) => QUAD.arms.some((a) => segDist(x, z, QUAD.c, a.end) < lim);

export function prepareQuad(data) {
  const acad = data.buildings.find((b) => b.id === ACAD), aud = data.buildings.find((b) => b.id === AUD);
  if (!acad || !aud || acad.outer.length !== 166 || aud.outer.length !== 11) return;
  QUAD.acad = acad; QUAD.aud = aud;
  // the wings are lower than the auditorium: three storeys, the top one a plain stone band
  acad.levels = 3; acad.h = 10.4;
  aud.padWith = ACAD;                 // the auditorium and the quad share the academic block's level
  const o = acad.outer, n = o.length;
  const idx = [165, ...Array.from({ length: 24 }, (_, i) => i)];
  acad.skipEdges = new Set(idx);
  QUAD.poly = [...idx, 24].map((i) => o[i]);
  QUAD.edges = idx.map((i) => ({ i, ...frame(o[i], o[(i + 1) % n]) }));
  QUAD.audEdge = frame(aud.outer[7], aud.outer[8]);
  (data.pads ||= []).push({ pts: QUAD.poly, like: ACAD });
  const [cx, cz] = QUAD.c;
  for (const a of data.areas) {
    const c = centroid(a.pts);
    if (a.kind === 'grass' && pip(c[0], c[1], QUAD.poly)) a.hidden = true;
    if (a.kind === 'stage' && Math.hypot(c[0] - cx, c[1] - cz) < 50) { a.hidden = true; QUAD.stage = a.pts; data.pads.push({ pts: a.pts, like: ACAD }); }
  }
  for (const r of data.roads) if (r.kind === 'foot' && r.pts.every((p) => Math.hypot(p[0] - cx, p[1] - cz) < 50)) r.hidden = true;
  data.rocks = data.rocks.filter((r) => !pip(r[0], r[1], QUAD.poly));
  noTreeZones.push([cx, cz, 46], [-150, -163, 22]);

  // the four arms: auditorium, sign plaza, library, classrooms
  for (const [name, tx, tz] of [['aud', -216.1, -196.8], ['plaza', -152.2, -166.2], ['library', -168.4, -212.3], ['classrooms', -200, -150.4]]) {
    const l = Math.hypot(tx - cx, tz - cz), dx = (tx - cx) / l, dz = (tz - cz) / l;
    let len = 8;
    for (; len < 70; len += 0.25) {
      const x = cx + dx * len, z = cz + dz * len;
      if (!pip(x, z, QUAD.poly) || distToPoly(x, z, QUAD.poly) < 3.2 || (QUAD.stage && pip(x, z, QUAD.stage))) break;
    }
    QUAD.arms.push({ name, dx, dz, len, end: [cx + dx * len, cz + dz * len] });
  }
  // slim ornamental trees between the hedge and the two long wings
  const r = rng(611);
  for (const e of QUAD.edges) {
    if (e.i !== 2 && e.i !== 19) continue;
    for (let s = 5; s < e.L - 4; s += 8.8) {
      const [x, z] = e.P(s + (r() - 0.5) * 2, 3.0);
      if (nearArm(x, z, 6.5)) continue;
      extraPlants.push({ x, z, kind: r() < 0.6 ? 'tall' : 'broad', s: 0.4 + r() * 0.12 });
    }
  }
  // palms between the sign wall and the glazed front behind it
  const e11 = QUAD.edges.find((e) => e.i === 11);
  for (const s of [3.5, 12, 20.5]) { const [x, z] = e11.P(s, 2.2); extraPlants.push({ x, z, kind: 'palm', s: 0.62 + r() * 0.12 }); }
}

// ------------------------------------------------------------------ textures
function tiles(w, h, cols, rows, palette, seed, joint = 'rgba(70,50,40,0.3)') {
  return canvasTex(w, h, (g) => {
    const r = rng(seed);
    const tw = w / cols, th = h / rows;
    for (let y = 0; y < rows; y++) for (let x = -1; x < cols; x++) {
      const xx = (x + (y % 2) * 0.5) * tw;
      g.fillStyle = palette[Math.floor(r() * palette.length)];
      g.fillRect(xx, y * th, tw + 1, th + 1);
      const v = r() < 0.5 ? 0 : 255; g.fillStyle = `rgba(${v},${v},${v},${r() * 0.07})`; g.fillRect(xx, y * th, tw, th);
      g.strokeStyle = joint; g.lineWidth = 1; g.strokeRect(xx + 0.5, y * th + 0.5, tw, th);
    }
    for (let i = 0; i < w * h / 60; i++) { const v = r() < 0.5 ? 0 : 255; g.fillStyle = `rgba(${v},${v},${v},${r() * 0.06})`; g.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2); }
    // rain streaks from the top
    for (let i = 0; i < 26; i++) { const x = r() * w, len = h * (0.15 + r() * 0.4); const gr = g.createLinearGradient(0, 0, 0, len); gr.addColorStop(0, 'rgba(60,45,35,0.12)'); gr.addColorStop(1, 'rgba(60,45,35,0)'); g.fillStyle = gr; g.fillRect(x, 0, 3 + r() * 12, len); }
  });
}
const stoneTex = () => tiles(512, 512, 8, 8, ['#d8c6a4', '#d2bd9b', '#dccdb0', '#cfb49a', '#c9b79a', '#d6c1a6', '#c8a892'], 701);
const redTex = () => tiles(256, 512, 4, 6, ['#b4543d', '#a94a38', '#bd5d44', '#b3503f', '#c2674c', '#ad4d3c'], 702, 'rgba(60,20,15,0.35)');
function verandaTex() {
  // one bay, one storey of the wall at the back of a veranda: door, window, shadow under the slab
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#e6e1d4'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#3d4a44'; g.fillRect(w * 0.14, h * 0.42, w * 0.2, h * 0.58);
    g.fillStyle = '#56645c'; g.fillRect(w * 0.16, h * 0.45, w * 0.16, h * 0.22);
    g.fillStyle = '#f1eee6'; g.fillRect(w * 0.46, h * 0.36, w * 0.42, h * 0.34);
    const gr = g.createLinearGradient(0, h * 0.36, 0, h * 0.7); gr.addColorStop(0, '#1d2a30'); gr.addColorStop(1, '#3d525c');
    g.fillStyle = gr; for (let i = 0; i < 3; i++) g.fillRect(w * 0.475 + i * w * 0.135, h * 0.38, w * 0.12, h * 0.3);
    g.fillStyle = '#b9b3a4'; g.fillRect(0, h * 0.96, w, h * 0.04);
    const sh = g.createLinearGradient(0, 0, 0, h * 0.55); sh.addColorStop(0, 'rgba(20,18,15,0.5)'); sh.addColorStop(1, 'rgba(20,18,15,0)');
    g.fillStyle = sh; g.fillRect(0, 0, w, h * 0.55);
  });
}
function railTex() {
  return canvasTex(64, 64, (g, w, h) => {
    g.clearRect(0, 0, w, h); g.fillStyle = '#34383d';
    g.fillRect(0, 0, w, 6); g.fillRect(0, 28, w, 3); g.fillRect(0, 44, w, 3); g.fillRect(0, h - 4, w, 4);
    g.fillRect(0, 0, 4, h);
  });
}
function glassTex() {
  return canvasTex(256, 256, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, '#3f7a6c'); gr.addColorStop(0.5, '#24544d'); gr.addColorStop(1, '#1b3f3d');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(210,235,225,0.10)'; for (let i = 0; i < 4; i++) g.fillRect(20 + i * 62, 10 + (i % 2) * 70, 40, 150);
    g.strokeStyle = '#8f9a94'; g.lineWidth = 4;
    for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo((i * w) / 4, 0); g.lineTo((i * w) / 4, h); g.stroke(); }
    for (let i = 0; i <= 5; i++) { g.beginPath(); g.moveTo(0, (i * h) / 5); g.lineTo(w, (i * h) / 5); g.stroke(); }
  });
}
function slabTex() {
  // stone slabs laid across the walking direction with grass growing in the joints; v runs along the path
  return canvasTex(128, 256, (g, w, h) => {
    const r = rng(703);
    g.fillStyle = '#5f8238'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(${60 + r() * 60},${100 + r() * 60},${30 + r() * 30},0.5)`; g.fillRect(r() * w, r() * h, 2, 2); }
    for (let i = 0; i < 4; i++) {
      const v = 0.9 + r() * 0.18;
      g.fillStyle = `rgb(${172 * v},${163 * v},${146 * v})`;
      g.fillRect(3, i * 64 + 6, w - 6, 52);
      for (let k = 0; k < 60; k++) { const q = r() < 0.5 ? 40 : 235; g.fillStyle = `rgba(${q},${q},${q},${r() * 0.1})`; g.fillRect(3 + r() * (w - 8), i * 64 + 6 + r() * 50, 1 + r() * 4, 1 + r() * 3); }
    }
  });
}

// quad with the normal taken from its winding, so both faces of a double-sided material light correctly
function q4(geo, a, b, c, d, ua, ub, uc, ud) {
  const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  const l = Math.hypot(...n) || 1;
  geo.quad(a, b, c, d, n.map((v) => v / l), ua, ub, uc, ud);
}
// vertical face in an edge frame, looking outwards (+o)
// (fit = true maps the texture exactly once per us x vs instead of by position)
function wall(geo, F, s0, s1, o, y0, y1, us = 1 / 6, vs = 1 / 6, fit = false) {
  const a = F.P(s0, o), b = F.P(s1, o);
  const ua = fit ? 0 : s0 * us, ub = fit ? (s1 - s0) * us : s1 * us, va = fit ? 0 : y0 * vs, vb = fit ? (y1 - y0) * vs : y1 * vs;
  q4(geo, [a[0], y0, a[1]], [a[0], y1, a[1]], [b[0], y1, b[1]], [b[0], y0, b[1]], [ua, va], [ua, vb], [ub, vb], [ub, va]);
}
// vertical face across an edge frame (at constant s)
function cross(geo, F, s, o0, o1, y0, y1) {
  const a = F.P(s, o0), b = F.P(s, o1);
  q4(geo, [a[0], y0, a[1]], [a[0], y1, a[1]], [b[0], y1, b[1]], [b[0], y0, b[1]], [o0 / 4, y0 / 4], [o0 / 4, y1 / 4], [o1 / 4, y1 / 4], [o1 / 4, y0 / 4]);
}
function flat(geo, F, s0, s1, o0, o1, y, up = true) {
  const a = F.P(s0, o0), b = F.P(s0, o1), c = F.P(s1, o1), d = F.P(s1, o0);
  const A = [a[0], y, a[1]], B = [b[0], y, b[1]], C = [c[0], y, c[1]], D = [d[0], y, d[1]];
  const uv = [[s0 / 4, o0 / 4], [s0 / 4, o1 / 4], [s1 / 4, o1 / 4], [s1 / 4, o0 / 4]];
  // (A,B,C) winds one way or the other depending on the frame; pick the one whose normal has the wanted sign
  const ny = (B[2] - A[2]) * (C[0] - A[0]) - (B[0] - A[0]) * (C[2] - A[2]);
  if ((ny > 0) === up) q4(geo, A, B, C, D, ...uv); else q4(geo, D, C, B, A, uv[3], uv[2], uv[1], uv[0]);
}
const box = (geo, F, s, o, w, d, y0, y1, uvS = 0.25) => { const c = F.P(s, o); geo.box(c[0], c[1], w, d, y0, y1, F.ang, uvS); };

function hedgeLine(geo, pts, w, h, colTop, colBot, skip) {
  const ct = new THREE.Color(colTop), cb = new THREE.Color(colBot);
  const prof = [[-w / 2, 0, cb], [-w / 2, h * 0.8, ct], [-w / 4, h, ct], [w / 4, h, ct], [w / 2, h * 0.8, ct], [w / 2, 0, cb]];
  const S = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.9));
    for (let j = 0; j < n; j++) S.push([a[0] + ((b[0] - a[0]) * j) / n, a[1] + ((b[1] - a[1]) * j) / n]);
  }
  S.push(pts[pts.length - 1]);
  let dist = 0;
  const rows = S.map((p, i) => {
    const a = S[Math.max(0, i - 1)], b = S[Math.min(S.length - 1, i + 1)];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, nx = -(b[1] - a[1]) / l, nz = (b[0] - a[0]) / l;
    if (i) dist += Math.hypot(p[0] - S[i - 1][0], p[1] - S[i - 1][1]);
    const k = 1 + 0.06 * Math.sin(dist * 1.9) + 0.04 * Math.sin(dist * 4.7 + 1);
    return skip && skip(p[0], p[1]) ? null : prof.map((q) => [p[0] + nx * q[0], q[1] * k, p[1] + nz * q[0]]);
  });
  geo.c ||= [];
  const uv = (p) => [(p[0] + p[2]) * 0.5, p[1] * 0.9 + p[0] * 0.3];
  for (let i = 0; i < rows.length - 1; i++) {
    const A = rows[i], B = rows[i + 1];
    if (!A || !B) continue;
    for (let k = 0; k < prof.length - 1; k++) {
      q4(geo, A[k], A[k + 1], B[k + 1], B[k], uv(A[k]), uv(A[k + 1]), uv(B[k + 1]), uv(B[k]));
      geo.c.push(...prof[k][2].toArray(), ...prof[k + 1][2].toArray(), ...prof[k + 1][2].toArray(), ...prof[k][2].toArray());
    }
  }
}
const glow = (m) => {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uGlow = foliageGlow;
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uGlow;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * uGlow;');
  };
  return m;
};

export function buildQuad(scene, heightOf) {
  if (!QUAD.poly) return null;
  const group = new THREE.Group();
  const [cx, cz] = QUAD.c;
  const r = rng(612);
  const off = (f, u) => ({ polygonOffset: true, polygonOffsetFactor: -f, polygonOffsetUnits: -(u ?? f) });
  const std = (o) => new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0, ...o });
  const M = {
    stone: std({ map: stoneTex(), side: THREE.DoubleSide }),
    red: std({ map: redTex(), side: THREE.DoubleSide, roughness: 0.88 }),
    plaster: std({ map: plainTex('#e9e4d8', 711, 0.05), side: THREE.DoubleSide }),
    veranda: std({ map: verandaTex(), side: THREE.DoubleSide, color: '#d6d6d6' }),
    soffit: std({ color: '#8f8b82', side: THREE.DoubleSide }),
    rail: std({ map: railTex(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.5 }),
    glass: std({ map: glassTex(), side: THREE.DoubleSide, roughness: 0.12, metalness: 0.6 }),
    dark: std({ color: '#14171a', side: THREE.DoubleSide }),
    pave: std({ map: plainTex('#b5ac9a', 712, 0.08, 4), ...off(2) }),
    slab: std({ map: slabTex(), ...off(3) }),
    bed: std({ map: grassTex(), color: '#b9d68f', roughness: 1, ...off(4) }),
    kerb: std({ color: '#a9a294', ...off(5) }),
  };
  const G = {}; const geo = (k) => (G[k] ||= new Geo());

  // ------------------------------------------------------------ facades
  const H = heightOf(QUAD.acad), TOP = H + 1.0;
  function parapet(F, o, top, mat = 'stone') {
    wall(geo(mat), F, F.L, 0, o - 0.35, H, top);                 // inner face, looking over the roof
    flat(geo(mat), F, 0, F.L, o - 0.35, o, top);
  }
  function colonnade(F, { nF = 2, fh = FH, top = TOP, front = 0, depth = 2.6, band = 'stone', bay = 4.4, lintel = true, dark = null, glass = false, roof = false }) {
    const back = front - depth, yC = nF * fh;
    const nb = Math.max(1, Math.round(F.L / bay)), bw = F.L / nb;
    for (let k = 0; k < nF; k++) wall(geo('veranda'), F, 0, F.L, back, k * fh, (k + 1) * fh, 1 / bw, 1 / fh);
    for (const s of [0.02, F.L - 0.02]) cross(geo('plaster'), F, s, back, front, 0, yC);
    for (let k = 1; k <= nF; k++) {
      box(geo('plaster'), F, F.L / 2, (front + back) / 2, F.L, depth, k * fh - 0.35, k * fh);
      flat(geo('soffit'), F, 0, F.L, back, front, k * fh - 0.36, false);
      if (k < nF) wall(geo('rail'), F, 0, F.L, front - 0.22, k * fh, k * fh + 1.05, 1 / 0.55, 1 / 1.05, true);
    }
    box(geo('pave'), F, F.L / 2, (front + back) / 2 + 0.4, F.L, depth + 0.8, 0, 0.18);
    wall(geo(band), F, 0, F.L, front, yC, top);
    if (roof) { flat(geo('plaster'), F, 0, F.L, back, front, top - 0.4); flat(geo('soffit'), F, 0, F.L, back, front, yC, false); wall(geo(band), F, F.L, 0, back, yC, top); for (const s of [0, F.L]) cross(geo(band), F, s, back, front, yC, top); } else parapet(F, front, top, band);
    if (lintel) wall(geo('plaster'), F, 0, F.L, front - 0.3, yC - 1.25, yC - 0.35, 1 / 4, 1 / 4);
    for (let i = 0; i <= nb; i++) {
      const s = Math.min(F.L - 0.5, Math.max(0.5, i * bw));
      box(geo('red'), F, s, front - 0.1, 1.0, 1.0, 0, yC + 0.25);
    }
    if (dark) wall(geo('dark'), F, dark[0], dark[1], back + 0.05, 0.18, fh - 0.6);
    if (glass) { const i = Math.floor(nb / 2); wall(geo('glass'), F, i * bw + 0.6, (i + 1) * bw - 0.6, back + 0.08, 0.2, yC - 0.5, 1 / (bw - 1.2), 1 / (yC - 0.7), true); }
  }
  function glazed(F, top) {
    wall(geo('stone'), F, 0, F.L, 0, 0, top); parapet(F, 0, top);
    const np = Math.max(1, Math.round(F.L / 8)), gap = 1.3, pw = (F.L - gap * (np + 1)) / np, y0 = 1.0, y1 = top - 2.6;
    for (let i = 0; i < np; i++) {
      const s0 = gap + i * (pw + gap), s1 = s0 + pw;
      wall(geo('glass'), F, s0, s1, 0.1, y0, y1, 1 / pw, 1 / (y1 - y0), true);
      for (const s of [s0, s1]) box(geo('red'), F, s, 0.08, 0.32, 0.36, y0 - 0.16, y1 + 0.16);
      for (const y of [y0, y1]) box(geo('red'), F, (s0 + s1) / 2, 0.08, pw, 0.36, y - 0.16, y + 0.16);
    }
  }
  const sAlong = (F, pt) => (pt[0] - F.p[0]) * F.tx + (pt[1] - F.p[1]) * F.tz;
  for (const e of QUAD.edges) {
    const kind = e.i === 11 ? 'glass' : e.L >= 20 ? 'col' : e.L >= 10 ? 'glass' : 'stone';
    if (kind === 'stone') { wall(geo('stone'), e, 0, e.L, 0, 0, TOP); parapet(e, 0, TOP); continue; }
    if (kind === 'glass') { glazed(e, TOP); continue; }
    // the walk-through to the classrooms and the library doors are dark openings at the back of the veranda
    const arm = e.i === 2 ? QUAD.arms[3] : e.i === 19 ? QUAD.arms[2] : null;
    const s = arm ? sAlong(e, arm.end) : 0;
    colonnade(e, { dark: arm ? [s - 3.6, s + 3.6] : null });
    if (e.i === 2) {
      const sign = signTex([{ text: 'BLOCK - F', size: 84, y: 0.52, color: '#ffffff' }], { w: 512, h: 128, bg: '#2a4f9c' });
      const a = e.P(s - 1.6, 0.03), b = e.P(s + 1.6, 0.03), sg = new Geo();
      q4(sg, [a[0], FH - 0.3, a[1]], [a[0], FH + 0.5, a[1]], [b[0], FH + 0.5, b[1]], [b[0], FH - 0.3, b[1]], [1, 0], [1, 1], [0, 1], [0, 0]);
      group.add(new THREE.Mesh(sg.build(), std({ map: sign, side: THREE.DoubleSide })));
    }
  }
  // auditorium front: a four-storey red sandstone portico standing in front of the hall
  {
    const F = QUAD.audEdge, Ha = heightOf(QUAD.aud);
    colonnade(F, { nF: 4, fh: (Ha - 0.4) / 4, top: Ha + 1.2, front: 3.4, depth: 3.35, band: 'red', bay: 4.7, lintel: false, glass: true, roof: true });
  }
  // low dome on a brick drum over the hall behind the sign plaza
  {
    const F = QUAD.edges.find((e) => e.i === 11), c = F.P(F.L / 2, -17);
    if (pip(c[0], c[1], QUAD.acad.outer)) {
      const drum = new THREE.Mesh(new THREE.CylinderGeometry(9.4, 9.4, 2.6, 40, 1, true), std({ map: redTex(), side: THREE.DoubleSide }));
      drum.material.map.repeat.set(4, 1); drum.position.set(c[0], H + 1.3, c[1]);
      const dome = new THREE.Mesh(new THREE.SphereGeometry(9.6, 40, 12, 0, Math.PI * 2, 0, Math.PI / 2), std({ color: '#8c8f78', roughness: 0.8 }));
      dome.scale.y = 0.42; dome.position.set(c[0], H + 2.6, c[1]);
      for (const m of [drum, dome]) { m.castShadow = true; m.receiveShadow = true; group.add(m); }
    }
  }

  // ------------------------------------------------------------ lawn
  {
    const bb = bbox(QUAD.poly), ST = 2, lg = new Geo(), cols = [];
    const x0 = Math.floor(bb[0]) - 2, z0 = Math.floor(bb[1]) - 2, nx = Math.ceil((bb[2] - bb[0] + 4) / ST), nz = Math.ceil((bb[3] - bb[1] + 4) / ST);
    const idx = new Int32Array((nx + 1) * (nz + 1)).fill(-1);
    const vid = (ix, iz) => {
      const k = iz * (nx + 1) + ix;
      if (idx[k] < 0) {
        const x = x0 + ix * ST, z = z0 + iz * ST;
        idx[k] = lg.vert([x, 0.03, z], [0, 1, 0], x / 5, z / 5);
        // dry, trodden patches in the middle of each lawn and greener grass towards the edges
        const dry = THREE.MathUtils.smoothstep(fbm(x / 20 + 3, z / 20 + 7) * 0.75 + fbm(x / 6, z / 6 + 2) * 0.25, 0.44, 0.6), v = 0.9 + 0.2 * fbm(x / 3, z / 3);
        cols.push((0.9 + 0.95 * dry) * v, (0.97 + 0.13 * dry) * v, (0.75 + 0.85 * dry) * v);
      }
      return idx[k];
    };
    for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) {
      const x = x0 + (ix + 0.5) * ST, z = z0 + (iz + 0.5) * ST;
      if (!(pip(x, z, QUAD.poly) || distToPoly(x, z, QUAD.poly) < 2.6)) continue;
      const a = vid(ix, iz), b = vid(ix + 1, iz), c = vid(ix + 1, iz + 1), d = vid(ix, iz + 1);
      lg.i.push(a, d, c, a, c, b);
    }
    const g = lg.build(); g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    const m = new THREE.Mesh(g, std({ map: grassTex(), vertexColors: true, roughness: 1, ...off(1) }));
    m.receiveShadow = true; group.add(m);
  }
  // paved apron along the building fronts
  addRibbon(geo('pave'), QUAD.poly, 5.6, () => 0.05, { closed: true, vScale: 1 / 4, uRep: 1.4, maxSeg: 6 });

  // ------------------------------------------------------------ paths and fountain
  for (const a of QUAD.arms) {
    const mx = -a.dz, mz = a.dx;       // across the arm
    const at = (s, o) => [cx + a.dx * s + mx * o, cz + a.dz * s + mz * o];
    for (const side of [-1, 1]) addRibbon(geo('slab'), [at(7, side * LANE_OFF), at(a.len, side * LANE_OFF)], LANE, () => 0.06, { vScale: 1 / 2.7, uRep: 1, maxSeg: 4 });
    // planted median with rounded ends
    const hw = LANE_OFF - LANE / 2 - 0.12, s0 = 10.5 + hw, s1 = a.len - 2.2 - hw, pts = [];
    for (let i = 0; i <= 10; i++) { const t = -Math.PI / 2 + (Math.PI * i) / 10; pts.push(at(s1 + Math.cos(t) * hw, Math.sin(t) * hw)); }
    for (let i = 0; i <= 10; i++) { const t = Math.PI / 2 + (Math.PI * i) / 10; pts.push(at(s0 + Math.cos(t) * hw, Math.sin(t) * hw)); }
    addFlatPoly(geo('bed'), pts, [], 0.1, 1 / 5);
    addRibbon(geo('kerb'), pts, 0.2, () => 0.13, { closed: true });
    // the two lanes join in a paved pad at the far end
    addRibbon(geo('pave'), [at(a.len - 2.0, 0), at(a.len + 1.2, 0)], LANE_OFF * 2 + LANE, () => 0.055, { vScale: 1 / 4, uRep: 2 });
    a.at = at; a.med = [s0, s1];
  }
  {
    // radial slabs around the fountain
    const dg = geo('slab'), R0 = 3.3, R1 = 8.3, N = 64;
    for (let i = 0; i < N; i++) {
      const t0 = (i / N) * Math.PI * 2, t1 = ((i + 1) / N) * Math.PI * 2;
      const p = (t, rad) => [cx + Math.cos(t) * rad, 0.065, cz + Math.sin(t) * rad];
      q4(dg, p(t0, R0), p(t1, R0), p(t1, R1), p(t0, R1), [0, (i / N) * 9], [0, ((i + 1) / N) * 9], [1, ((i + 1) / N) * 9], [1, (i / N) * 9]);
    }
    const stone = std({ map: plainTex('#b9b2a3', 713, 0.09), roughness: 0.9 });
    const basin = new THREE.Mesh(new THREE.CylinderGeometry(2.55, 2.7, 0.62, 36), stone); basin.position.set(cx, 0.31, cz);
    const water = new THREE.Mesh(new THREE.CircleGeometry(2.2, 36).rotateX(-Math.PI / 2), std({ color: '#3f8fc4', roughness: 0.06, metalness: 0.35 })); water.position.set(cx, 0.64, cz);
    const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.24, 0.5, 10), stone); spout.position.set(cx, 0.75, cz);
    for (const m of [basin, water, spout]) { m.castShadow = m !== water; m.receiveShadow = true; group.add(m); }
  }

  // ------------------------------------------------------------ sign plaza
  if (QUAD.stage) {
    const P = QUAD.stage, F = frame(P[0], P[1]);                 // long side nearest the lawn
    const wid = Math.hypot(P[2][0] - P[1][0], P[2][1] - P[1][1]);
    const out = pip(...F.P(F.L / 2, 2), P) ? 1 : -1;             // +o must point into the plaza
    const o = (d) => out * d;
    box(geo('pave'), F, F.L / 2, o(wid / 2 - 0.5), F.L + 0.9, wid + 1.0, 0, 0.16);
    box(geo('pave'), F, F.L / 2, o(wid / 2 - 0.2), F.L + 0.4, wid + 0.4, 0, 0.32);
    box(geo('pave'), F, F.L / 2, o(wid / 2), F.L, wid, 0, 0.48);
    const blue = signTex([{ text: 'Birla Institute of Technology & Science, Pilani', size: 62, y: 0.42, color: '#ffffff' }, { text: 'Hyderabad Campus', size: 40, y: 0.74, color: '#ffffff', weight: 500 }], { w: 2048, h: 192, bg: '#2a4f9c' });
    blue.wrapS = THREE.RepeatWrapping; blue.repeat.x = -1;      // Geo.box maps its faces right-to-left
    const wg = new Geo(), wl = F.L - 3, c = F.P(F.L / 2, o(wid - 0.9));
    wg.box(c[0], c[1], wl, 0.4, 0.48, 2.5, F.ang, 1 / wl, true);
    const wm = new THREE.Mesh(wg.build(), std({ map: blue, roughness: 0.7 })); wm.castShadow = true; wm.receiveShadow = true; group.add(wm);
    // low clipped hedge with shrubs along the front edge
    QUAD.plazaFront = [F.P(1.5, o(-1.6)), F.P(F.L - 1.5, o(-1.6))];
  }

  // ------------------------------------------------------------ planting
  const hg = new Geo();
  for (const e of QUAD.edges) {
    if (e.i !== 2 && e.i !== 19) continue;
    hedgeLine(hg, [e.P(1.5, 4.3), e.P(e.L - 1.5, 4.3)], 1.1, 0.9, '#7fa644', '#3f6230', (x, z) => nearArm(x, z, 4.6));
  }
  if (QUAD.plazaFront) hedgeLine(hg, QUAD.plazaFront, 1.0, 0.6, '#9fbf4a', '#4f7030', (x, z) => nearArm(x, z, 4.6));
  // ring of flowering shrubs around the fountain
  hedgeLine(hg, Array.from({ length: 41 }, (_, i) => [cx + Math.cos((i / 40) * Math.PI * 2) * 3.0, cz + Math.sin((i / 40) * Math.PI * 2) * 3.0]), 0.8, 0.55, '#6f9f48', '#3f6a2c');
  const hgeo = hg.build(); hgeo.setAttribute('color', new THREE.Float32BufferAttribute(hg.c, 3));
  const hm = new THREE.Mesh(hgeo, glow(new THREE.MeshLambertMaterial({ map: leafTex(), vertexColors: true, side: THREE.DoubleSide })));
  hm.castShadow = true; hm.receiveShadow = true; group.add(hm);

  const mats = plantMaterials();
  const d = new THREE.Object3D(), col = new THREE.Color();
  const instanced = (g, m, list, fn) => {
    const im = new THREE.InstancedMesh(g, m, list.length);
    list.forEach((it, i) => { fn(it, i); d.updateMatrix(); im.setMatrixAt(i, d.matrix); im.setColorAt(i, col); });
    im.castShadow = true; im.receiveShadow = true; group.add(im);
    return im;
  };
  // cycads down the medians
  {
    const fr = [], NF = 18;
    for (let i = 0; i < NF; i++) {
      const f = new THREE.PlaneGeometry(0.6, 2.0, 2, 6); f.translate(0, 1.0, 0);
      const p = f.attributes.position;
      for (let k = 0; k < p.count; k++) { const y = p.getY(k), x = p.getX(k); p.setZ(k, 0.24 * y * y + Math.abs(x) * 0.35); }
      f.computeVertexNormals();
      const tilt = [0.35, 0.75, 1.1][i % 3];
      fr.push({ geo: f, matrix: new THREE.Matrix4().makeRotationY((i / NF) * Math.PI * 2 + (i % 3) * 0.13).multiply(new THREE.Matrix4().makeTranslation(0, 0.62, 0)).multiply(new THREE.Matrix4().makeRotationX(tilt)), up: 1.2, two: true });
    }
    const fronds = merge(fr);
    const tg = new THREE.CylinderGeometry(0.2, 0.27, 0.7, 8); tg.translate(0, 0.35, 0);
    const trunk = merge([{ geo: tg }]);
    const list = [];
    for (const a of QUAD.arms) for (let s = a.med[0] + 0.6; s < a.med[1]; s += 4.3) { const [x, z] = a.at(s, 0); list.push({ x, z, s: 0.8 + r() * 0.3, rot: r() * 6.28 }); }
    const put = (it) => { d.position.set(it.x, 0.1, it.z); d.rotation.set(0, it.rot, 0); d.scale.setScalar(it.s); };
    instanced(trunk, mats.bark, list, (it) => { put(it); col.set('#8a7660'); });
    instanced(fronds, mats.frond, list, (it) => { put(it); const v = 0.8 + r() * 0.25; col.setRGB(0.36 * v, 0.56 * v, 0.24 * v); });
  }
  // terracotta planters: bougainvillea and clipped shrubs
  {
    const prof = [[0.0, 0], [0.42, 0], [0.46, 0.06], [0.6, 0.5], [0.66, 0.54], [0.66, 0.62], [0.56, 0.62], [0.54, 0.58]].map(([x, y]) => new THREE.Vector2(x, y));
    const shrub = merge([{ geo: blob(0.75, 2, 0.8, 9, '#ffffff', '#8a8a8a', 0.45), matrix: new THREE.Matrix4().makeTranslation(0, 1.0, 0), up: 0.8, uvWorld: true }]);
    const list = [];
    for (const e of QUAD.edges) {
      if (e.i !== 2 && e.i !== 19) continue;
      for (let s = 3; s < e.L - 2; s += 5.2) { const [x, z] = e.P(s, 5.6); if (!nearArm(x, z, 5)) list.push({ x, z }); }
    }
    const A = QUAD.audEdge;
    for (let s = 2; s < A.L - 1; s += 2.9) { const [x, z] = A.P(s, 6.4); if (!nearArm(x, z, 4.8)) list.push({ x, z }); }
    for (const a of QUAD.arms) for (const side of [-1, 1]) { const [x, z] = a.at(a.len - 3, side * (LANE_OFF + LANE / 2 + 1.3)); list.push({ x, z }); }
    list.forEach((it) => { it.s = 0.85 + r() * 0.4; it.rot = r() * 6.28; it.flower = r() < 0.45; });
    const put = (it) => { d.position.set(it.x, 0.04, it.z); d.rotation.set(0, it.rot, 0); d.scale.setScalar(it.s); };
    instanced(new THREE.LatheGeometry(prof, 14), std({ color: '#ffffff', roughness: 0.85, side: THREE.DoubleSide }), list, (it, i) => { put(it); col.set(i % 3 ? '#c9a58a' : '#c8704a'); });
    instanced(shrub, mats.solid, list, (it) => { put(it); col.set(it.flower ? (r() < 0.5 ? '#d64a8a' : '#e06a9c') : (r() < 0.5 ? '#5f9a40' : '#4a7f36')); });
    // blooms in the ring around the fountain
    const ring = Array.from({ length: 22 }, (_, i) => ({ a: (i / 22) * Math.PI * 2 + r() * 0.15 }));
    instanced(shrub, mats.solid, ring, (it, i) => {
      d.position.set(cx + Math.cos(it.a) * 3.0, 0.12, cz + Math.sin(it.a) * 3.0); d.rotation.set(0, r() * 6.28, 0); d.scale.setScalar(0.34 + r() * 0.1);
      col.set(['#d8483a', '#e0703a', '#d64a8a'][i % 3]);
    });
  }
  // granite boulders on the lawn
  {
    const rg = new THREE.IcosahedronGeometry(1, 3), p = rg.attributes.position;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), n = 0.8 + 0.4 * fbm(x * 1.2 + 4, z * 1.2 + y * 1.6); p.setXYZ(i, x * n, y * n, z * n); }
    rg.computeVertexNormals();
    const mid = (i, j, dist) => { const a = QUAD.arms[i], b = QUAD.arms[j], l = Math.hypot(a.dx + b.dx, a.dz + b.dz); return [cx + ((a.dx + b.dx) / l) * dist, cz + ((a.dz + b.dz) / l) * dist]; };
    const list = [];
    const cluster = ([x, z], sizes) => sizes.forEach((s, k) => list.push({ x: x + k * s * 1.5 - 2, z: z + (k % 2) * 1.8 - 0.5, s }));
    cluster(mid(0, 2, 27), [1.5, 1.2, 1.7]);
    cluster(mid(2, 1, 24), [1.3, 1.6]);
    cluster(mid(3, 0, 26), [1.2, 1.4, 1.0]);
    const lib = QUAD.arms[2]; list.push({ x: lib.at(lib.len - 5, -9.5)[0], z: lib.at(lib.len - 5, -9.5)[1], s: 3.6, flat: true });
    instanced(rg, std({ map: plainTex('#a9a59c', 714, 0.14), roughness: 0.95 }), list, (it) => {
      d.position.set(it.x, it.s * (it.flat ? 0.08 : 0.12), it.z); d.rotation.set(0, r() * 6.28, 0);
      d.scale.set(it.s * (1.1 + r() * 0.4), it.s * (it.flat ? 0.3 : 0.42), it.s * (0.8 + r() * 0.3));
      const v = 0.85 + r() * 0.2; col.setRGB(v, v * 0.99, v * 0.97);
    });
  }

  for (const k in G) {
    const m = new THREE.Mesh(G[k].build(), M[k]);
    m.castShadow = !['slab', 'bed', 'kerb'].includes(k); m.receiveShadow = true; m.name = 'quad_' + k;
    if (['pave', 'slab', 'bed', 'kerb'].includes(k)) m.renderOrder = 2;
    group.add(m);
  }
  group.position.y = QUAD.acad.y ?? 0;
  scene.add(group);
  return group;
}
