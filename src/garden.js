import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { Geo, pip, bbox, centroid, addFlatPoly, addRibbon } from './geo.js';
import { rng, canvasTex, grassTex, plainTex } from './textures.js';
import { fbm, heightMods } from './world.js';
import { leafTex, blob, merge, plantMaterials, extraPlants, noTreeZones, foliageGlow } from './plants.js';

// The Rock Garden, laid out from the campus panorama tour:
//  - the whole lawn sits below the surrounding road
//  - south-west: amphitheatre steps curving down to their own lawn
//  - east / south-east: a stone retaining wall with a planted bed on top
//  - a hedged flagstone path from the south road to a raised ring garden
//  - west of the ring: the big granite outcrop with the waterfall
//  - centre: a rockery of piled boulders with a moat and stepping stones
//  - east: the lotus pond with a small palm island
//  - north-west: a rocky hillock rising towards the academic block
export const GARDEN = { poly: null, bb: null, paths: [], pond: null };
const DEPTH = 1.6, NS = 4, RISE = 0.4, TREAD = 1.5, WALL = 2.2;
const L = -DEPTH;
const POND = { x: 23.5, z: -87 };
const CLIFF = { x: -54, z: -67, fx: 0.9, fz: 0.44 };      // kept clear of the path that runs west from the ring
const ROCKERY = { x: -6, z: -93, sx: 5.2, sz: 8 };
const RING = { x: -29, z: -67, r: 6, steps: [10.9, 10.0, 9.1], rise: 0.3 };     // raised ring garden: three steps up
const HILL = { x: -40, z: -128 };
const ISLANDS = [[69, -117, 5], [26, -29, 5]];
const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function nearest(x, z, pts, closed = true) {
  let best = Infinity, bx = 0, bz = 0;
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l2));
    const qx = a[0] + t * dx, qz = a[1] + t * dz, d = Math.hypot(x - qx, z - qz);
    if (d < best) { best = d; bx = qx; bz = qz; }
  }
  return { d: best, x: bx, z: bz };
}
// The steps wrap a little way past the hedged path before the wall takes over; SPLIT is a
// vertex inserted into the boundary so both runs meet exactly there.
const SPLIT = 15.3;
const isAmphi = (p) => p[0] < SPLIT + 0.1 && p[1] > -75;  // south-west edge: steps
const isWall = (p) => p[0] > SPLIT - 0.1 && p[1] > -131;  // east edge: retaining wall
const hillAt = (x, z) => 7.0 * Math.exp(-((x - HILL.x) ** 2 + (z - HILL.z) ** 2) / (2 * 17 * 17)) + 3.4 * Math.exp(-((x + 56) ** 2 + (z + 150) ** 2) / (2 * 13 * 13))
  + 2.4 * Math.exp(-((x + 22) ** 2 + (z + 118) ** 2) / (2 * 10 * 10));
const moundAt = (x, z) => 2.9 * Math.exp(-(((x - ROCKERY.x) / ROCKERY.sx) ** 2 + ((z - ROCKERY.z) / ROCKERY.sz) ** 2) / 2);

function edgeProfile(n) {
  const q = [n.x, n.z];
  if (isAmphi(q)) return -RISE * Math.min(NS, Math.floor(n.d / TREAD));
  if (isWall(q)) return n.d < WALL ? 0 : L;
  return L * sstep(2, 14, n.d);
}
export function gardenHeight(x, z) {
  const b = GARDEN.bb;
  if (!b || x < b[0] || x > b[2] || z < b[1] || z > b[3] || !pip(x, z, GARDEN.poly)) return 0;
  const n = nearest(x, z, GARDEN.poly);
  let h = edgeProfile(n) + (hillAt(x, z) + moundAt(x, z)) * sstep(1, 12, n.d);
  const dr = Math.hypot(x - RING.x, z - RING.z);
  for (const rad of RING.steps) if (dr < rad) h += RING.rise;
  return h;
}

export function prepareGarden(data) {
  const park = data.areas.find((a) => a.name === 'Rock Garden');
  if (!park) return;
  {
    // add the vertex where steps hand over to the wall (on the edge crossing x = SPLIT in the south-east)
    const p = park.pts;
    for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length];
      if (a[1] > -60 && b[1] > -60 && (a[0] - SPLIT) * (b[0] - SPLIT) < 0) { const t = (SPLIT - a[0]) / (b[0] - a[0]); p.splice(i + 1, 0, [SPLIT, a[1] + (b[1] - a[1]) * t]); break; }
    }
  }
  GARDEN.poly = park.pts; GARDEN.bb = bbox(park.pts);
  heightMods.push(gardenHeight);
  const inPark = (p) => pip(p[0], p[1], park.pts);
  data.rocks = data.rocks.filter((r) => !inPark(r));
  const nearPond = (a) => Math.hypot(centroid(a.pts)[0] - POND.x, centroid(a.pts)[1] - POND.z) < 14;
  GARDEN.pond = data.areas.find((a) => a.kind === 'water' && nearPond(a))?.pts;
  data.areas = data.areas.filter((a) => !((a.kind === 'grass' || a.kind === 'water') && nearPond(a)));
  for (const r of data.roads) {
    if ((r.kind === 'foot' || r.kind === 'path') && inPark(r.pts[r.pts.length >> 1])) { r.garden = true; GARDEN.paths.push(r); }
  }
  noTreeZones.push([-30, -44, 24], [-55, -48, 14], [26, -98, 30], [34, -138, 18], [6, -60, 14], [10, -150, 12], [POND.x, POND.z, 18],
    [CLIFF.x + 6, CLIFF.z + 2, 15], [ROCKERY.x, ROCKERY.z, 19], [RING.x, RING.z, 13], [46, -120, 10]);
  for (const r of GARDEN.paths) for (const p of r.pts) noTreeZones.push([p[0], p[1], 3.4]);
  // nothing grows on the steps or in the wall's planting bed
  for (let i = 0; i < park.pts.length; i++) {
    const a = park.pts[i], b = park.pts[(i + 1) % park.pts.length];
    if (!(isAmphi(a) || isWall(a)) || !(isAmphi(b) || isWall(b))) continue;
    const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 4);
    for (let j = 0; j <= n; j++) noTreeZones.push([a[0] + ((b[0] - a[0]) * j) / n, a[1] + ((b[1] - a[1]) * j) / n, isAmphi(a) ? 8 : 4.5]);
  }
  for (const [x, z, r] of ISLANDS) noTreeZones.push([x, z, r + 1]);
  const P = (x, z, kind, s, extra = {}) => extraPlants.push({ x, z, kind, s, ...extra });
  // mature canopy behind the waterfall rock and at the end of the steps
  P(-63, -79, 'broad', 2.3); P(-64, -58, 'broad', 2.0); P(-66, -101, 'broad', 2.1); P(-70, -52, 'broad', 2.2);
  P(-12, -60, 'broad', 1.7); P(-44, -98, 'broad', 1.6); P(-20, -112, 'broad', 1.5);
  // specimen trees on the main lawn, the yellow-flowering shrub by the flat rocks
  P(38, -128, 'broad', 1.5); P(4, -128, 'broad', 1.4); P(-8, -150, 'broad', 1.5); P(28, -160, 'broad', 1.6); P(46, -150, 'broad', 1.4);
  P(40, -108, 'scrub', 1.7, { tint: '#f0e25a' }); P(43, -104, 'palm', 0.24); P(44.5, -106, 'palm', 0.2);
  P(-52, -38, 'palm', 0.26); P(-49, -40.5, 'palm', 0.22); P(-54, -41, 'palm', 0.2);
  // lotus pond island, ring garden centre, road islands
  P(POND.x, POND.z, 'palm', 0.8, { y: L + 0.55 });
  P(RING.x, RING.z, 'palm', 0.5, { y: L + RING.steps.length * RING.rise });
  P(ISLANDS[0][0], ISLANDS[0][1], 'palm', 0.75);
  for (const [x, z] of ISLANDS) for (let i = 0; i < 3; i++) P(x + Math.cos(i * 2.1 + 0.4) * 2.6, z + Math.sin(i * 2.1 + 0.4) * 2.6, 'conifer', 0.24);
}

// ------------------------------------------------------------------ textures
function granite() {
  return canvasTex(512, 512, (g, w, h) => {
    const r = rng(401);
    g.fillStyle = '#b69a7c'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 120; i++) {
      const v = r();
      g.fillStyle = v < 0.4 ? `rgba(90,70,55,${r() * 0.16})` : v < 0.75 ? `rgba(228,205,176,${r() * 0.18})` : `rgba(168,118,88,${r() * 0.16})`;
      g.beginPath(); g.ellipse(r() * w, r() * h, 16 + r() * 80, 16 + r() * 60, r() * 3, 0, 7); g.fill();
    }
    for (let i = 0; i < 30000; i++) { const v = r() < 0.5 ? 40 : 235; g.fillStyle = `rgba(${v},${v * 0.95},${v * 0.9},${r() * 0.17})`; g.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2); }
    for (let i = 0; i < 34; i++) {
      const x = r() * w, y = r() * h * 0.6, len = 50 + r() * 200, dark = r() < 0.65;
      const gr = g.createLinearGradient(0, y, 0, y + len);
      gr.addColorStop(0, dark ? 'rgba(55,42,34,0.2)' : 'rgba(240,226,206,0.2)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(x, y, 3 + r() * 14, len);
    }
    g.strokeStyle = 'rgba(45,32,26,0.45)'; g.lineWidth = 1.6;
    for (let i = 0; i < 16; i++) { let x = r() * w, y = r() * h; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 8; k++) { x += (r() - 0.5) * 60; y += (r() - 0.3) * 50; g.lineTo(x, y); } g.stroke(); }
  });
}
function rubble(base = [172, 146, 116], mortar = '#4e4338') {
  return canvasTex(256, 256, (g, w, h) => {
    const r = rng(402);
    g.fillStyle = mortar; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 22) {
      let x = -r() * 30;
      while (x < w) {
        const bw = 26 + r() * 34, v = 0.75 + r() * 0.45;
        g.fillStyle = `rgb(${base[0] * v},${base[1] * v},${base[2] * v})`;
        g.beginPath(); g.roundRect(x + 2, y + 2, bw - 3, 18, 5); g.fill();
        x += bw;
      }
    }
  });
}
function flagstone() {
  return canvasTex(256, 256, (g, w, h) => {
    const r = rng(403);
    g.fillStyle = '#4f5048'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 64) {
      let x = (y / 64) % 2 ? -40 : 0;
      while (x < w) {
        const bw = 70 + r() * 50, v = 0.88 + r() * 0.22;
        g.fillStyle = `rgb(${150 * v},${152 * v},${144 * v})`;
        g.fillRect(x + 3, y + 3, bw - 6, 58);
        for (let i = 0; i < 40; i++) { const q = r() < 0.5 ? 60 : 220; g.fillStyle = `rgba(${q},${q},${q},${r() * 0.12})`; g.fillRect(x + 3 + r() * (bw - 8), y + 3 + r() * 56, 2 + r() * 5, 2 + r() * 5); }
        x += bw;
      }
    }
  });
}
function fallTex() {
  return canvasTex(128, 256, (g, w, h) => {
    const r = rng(404);
    g.clearRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 200; i++) {
      const x = r() * w, y = r() * h, len = 30 + r() * 120;
      const gr = g.createLinearGradient(0, y, 0, y + len);
      gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.4, `rgba(255,255,255,${0.45 + r() * 0.5})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      for (const oy of [0, -h]) g.fillRect(x, y + oy, 2 + r() * 7, len);
    }
  });
}
function lilyTex() {
  return canvasTex(512, 512, (g, w, h) => {
    const r = rng(405);
    g.fillStyle = '#1c2a22'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 520; i++) {
      const x = r() * w, y = r() * h, rad = 7 + r() * 9, a = r() * 6.28, v = r();
      g.fillStyle = v < 0.7 ? `rgb(${70 + r() * 40},${110 + r() * 50},${50 + r() * 25})` : `rgb(${120 + r() * 40},${125 + r() * 30},${60 + r() * 20})`;
      for (const [ox, oy] of [[0, 0], [w, 0], [-w, 0], [0, h], [0, -h]]) { g.beginPath(); g.moveTo(x + ox, y + oy); g.arc(x + ox, y + oy, rad, a + 0.35, a + 6.28); g.closePath(); g.fill(); }
      if (r() < 0.06) { g.fillStyle = r() < 0.5 ? '#f3c7d8' : '#f5e9a6'; g.beginPath(); g.arc(x, y, 3.5, 0, 7); g.fill(); }
    }
  });
}

// angular boulder in unit space; surf(dir) is reused to drape water over it
function makeRock(seed, detail = 3, rough = 0.42, cuts = 6) {
  const q = rng(seed * 131 + 7);
  const planes = Array.from({ length: cuts }, () => {
    const v = new THREE.Vector3(q() - 0.5, (q() - 0.35) * 0.9, q() - 0.5).normalize();
    return { v, c: 0.72 + q() * 0.22 };
  });
  const surf = (d) => {
    let n = 1 - rough / 2 + rough * (fbm(d.x * 1.4 + seed, d.z * 1.4 + d.y * 1.9 + seed * 1.7) * 0.7 + fbm(d.x * 4.2 + seed, d.y * 4.2 + d.z * 3.1) * 0.3);
    for (const p of planes) { const t = d.dot(p.v); if (t > 0.05) n = Math.min(n, p.c / t); }
    if (d.y < 0) n = Math.min(n, 0.55 / -d.y + 0.2);
    return d.clone().multiplyScalar(n);
  };
  let g = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('normal'); g.deleteAttribute('uv');
  g = mergeVertices(g, 1e-4);
  const p = g.attributes.position, v = new THREE.Vector3(), uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize(); const s = surf(v); p.setXYZ(i, s.x, s.y, s.z);
    uv[i * 2] = s.x * 0.42 + s.z * 0.27 + seed * 0.13; uv[i * 2 + 1] = s.y * 0.45 + s.z * 0.12 + seed * 0.07;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return { geo: g, surf };
}

// ------------------------------------------------------------------ geometry helpers
export function hedgeLine(geo, pts, w, h, colTop, colBot, heightFn, skip, wobble = 0.07) {
  const ct = new THREE.Color(colTop), cb = new THREE.Color(colBot);
  const prof = [[-w / 2, 0, cb], [-w / 2, h * 0.78, ct], [-w / 4, h, ct], [w / 4, h, ct], [w / 2, h * 0.78, ct], [w / 2, 0, cb]];
  const S = densify(pts, 0.9);
  let dist = 0;
  const rows = S.map((p, i) => {
    const a = S[Math.max(0, i - 1)], b = S[Math.min(S.length - 1, i + 1)];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, nx = -(b[1] - a[1]) / l, nz = (b[0] - a[0]) / l;
    if (i) dist += Math.hypot(p[0] - S[i - 1][0], p[1] - S[i - 1][1]);
    const k = 1 + wobble * Math.sin(dist * 1.9) + wobble * 0.6 * Math.sin(dist * 4.7 + 1);
    const y0 = heightFn(p[0], p[1]);
    return skip && skip(p[0], p[1]) ? null : prof.map((q) => [p[0] + nx * q[0], y0 + q[1] * k, p[1] + nz * q[0]]);
  });
  geo.c ||= [];
  for (let i = 0; i < rows.length - 1; i++) {
    const A = rows[i], B = rows[i + 1];
    if (!A || !B) continue;
    for (let k = 0; k < prof.length - 1; k++) {
      const a = A[k], b = A[k + 1], c = B[k + 1], d = B[k];
      const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
      let nn = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const l = Math.hypot(...nn) || 1; nn = nn.map((v) => v / l);
      const uv = (p) => [(p[0] + p[2]) * 0.5, p[1] * 0.9 + p[0] * 0.3];
      const i0 = geo.vert(a, nn, ...uv(a)); geo.vert(b, nn, ...uv(b)); geo.vert(c, nn, ...uv(c)); geo.vert(d, nn, ...uv(d));
      geo.i.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3);
      geo.c.push(...prof[k][2].toArray(), ...prof[k + 1][2].toArray(), ...prof[k + 1][2].toArray(), ...prof[k][2].toArray());
    }
  }
}
export function hedgeMesh(geo) {
  const g = geo.build(); g.setAttribute('color', new THREE.Float32BufferAttribute(geo.c, 3));
  const mat = new THREE.MeshLambertMaterial({ map: leafTex(), vertexColors: true, side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uGlow = foliageGlow;
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uGlow;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * uGlow;');
  };
  const m = new THREE.Mesh(g, mat); m.castShadow = true; m.receiveShadow = true;
  return m;
}
function offsetLine(pts, d) {
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [p[0] - ((b[1] - a[1]) / l) * d, p[1] + ((b[0] - a[0]) / l) * d];
  });
}
function densify(pts, step) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let j = 0; j < n; j++) out.push([a[0] + ((b[0] - a[0]) * j) / n, a[1] + ((b[1] - a[1]) * j) / n]);
  }
  out.push(pts[pts.length - 1]);
  return out;
}
const ell = (cx, cz, rx, rz, a0, a1, n = 40) => Array.from({ length: n + 1 }, (_, i) => { const a = a0 + ((a1 - a0) * i) / n; return [cx + Math.cos(a) * rx, cz + Math.sin(a) * rz]; });
// strip between two polylines of equal length; yA/yB may be numbers or functions of (x,z)
function strip(geo, A, B, yA, yB, vS = 0.5) {
  const Y = (y, p) => (typeof y === 'function' ? y(p[0], p[1]) : y);
  let dist = 0;
  for (let i = 0; i < A.length - 1; i++) {
    const seg = Math.hypot(A[i + 1][0] - A[i][0], A[i + 1][1] - A[i][1]);
    const a = [A[i][0], Y(yA, A[i]), A[i][1]], b = [A[i + 1][0], Y(yA, A[i + 1]), A[i + 1][1]], c = [B[i + 1][0], Y(yB, B[i + 1]), B[i + 1][1]], d = [B[i][0], Y(yB, B[i]), B[i][1]];
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
    let nn = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const l = Math.hypot(...nn) || 1; nn = nn.map((v) => v / l);
    if (nn[1] < -0.01) nn = nn.map((v) => -v);
    const w = Math.hypot(d[0] - a[0], d[1] - a[1], d[2] - a[2]);
    geo.quad(a, b, c, d, nn, [dist * vS, 0], [(dist + seg) * vS, 0], [(dist + seg) * vS, w * vS], [dist * vS, w * vS]);
    dist += seg;
  }
}
// contiguous run of boundary vertices satisfying a test, oriented so that offsetLine(+d) goes into the garden
function boundaryRun(poly, ok) {
  const n = poly.length; let start = 0;
  for (let i = 0; i < n; i++) if (ok(poly[i]) && !ok(poly[(i - 1 + n) % n])) start = i;
  let run = []; for (let k = 0; k < n; k++) { const p = poly[(start + k) % n]; if (!ok(p)) break; run.push(p); }
  run = densify(run, 1.3);
  const t = offsetLine(run, 2)[run.length >> 1];
  return { run, sign: pip(t[0], t[1], poly) ? 1 : -1 };
}

export const waterTextures = [];

export function buildGarden(scene, height, env) {
  if (!GARDEN.poly) return null;
  const g = new THREE.Group();
  const poly = GARDEN.poly, bb = GARDEN.bb;
  const r = rng(808);
  const amphi = boundaryRun(poly, isAmphi), wall = boundaryRun(poly, isWall);
  const off = (b, d) => offsetLine(b.run, b.sign * d);

  // ---- fine terrain (the campus-wide ground has a hole here)
  {
    const geo = new Geo(); const cols = [];
    const x0 = Math.floor(bb[0]) - 2, z0 = Math.floor(bb[1]) - 2, nx = Math.ceil(bb[2] - bb[0]) + 4, nz = Math.ceil(bb[3] - bb[1]) + 4;
    const idx = new Int32Array((nx + 1) * (nz + 1)).fill(-1);
    const keep = (x, z) => pip(x, z, poly) || nearest(x, z, poly).d < 0.8;
    const vid = (ix, iz) => {
      const k = iz * (nx + 1) + ix;
      if (idx[k] < 0) {
        const x = x0 + ix, z = z0 + iz;
        let y = height(x, z);
        const inside = pip(x, z, poly);
        let dry = 0;
        if (inside) {
          const n = nearest(x, z, poly), q = [n.x, n.z];
          // keep the turf safely underneath the built steps and behind the wall face
          if (isAmphi(q) && n.d < NS * TREAD) y = Math.min(y, -0.25 - DEPTH * Math.max(0, Math.min(1, (n.d - 0.3) / (NS * TREAD - 1.3))));
          else if (isWall(q) && n.d < WALL) y = n.d < 1.0 ? 0 : L;
          dry = sstep(1.5, 6, hillAt(x, z));
        }
        // turf stays below the ring garden's solid plinth
        if (Math.hypot(x - RING.x, z - RING.z) < RING.steps[0] + 0.2) y = L - 0.35;
        idx[k] = geo.vert([x, y, z], [0, 1, 0], x / 5, z / 5);
        const patch = Math.min(1, sstep(0.44, 0.62, fbm(x / 11 + 3, z / 11 + 7)) * 0.8 + dry * 0.6);
        const n2 = 0.92 + 0.16 * fbm(x / 5, z / 5);
        // yellow-green lawn with drier, straw-coloured patches
        // the sliver of mesh outside the garden edge takes the surrounding ground tone
        if (!inside) cols.push(0.88 * n2, 0.7 * n2, 0.9 * n2);
        else cols.push((1.38 + 0.7 * patch) * n2, (1.12 + 0.3 * patch) * n2, (0.62 + 0.28 * patch) * n2);
      }
      return idx[k];
    };
    for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) {
      if (!keep(x0 + ix + 0.5, z0 + iz + 0.5)) continue;
      const a = vid(ix, iz), b = vid(ix + 1, iz), c = vid(ix + 1, iz + 1), d = vid(ix, iz + 1);
      geo.i.push(a, d, c, a, c, b);
    }
    const bg = geo.build(); bg.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3)); bg.computeVertexNormals();
    const m = new THREE.Mesh(bg, new THREE.MeshStandardMaterial({ map: grassTex(), vertexColors: true, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
    m.receiveShadow = true; g.add(m);
  }

  const concrete = new THREE.MeshStandardMaterial({ map: plainTex('#b9b2a2', 411, 0.09), roughness: 0.95, side: THREE.DoubleSide });
  const cg = new Geo();
  const wallMat = new THREE.MeshStandardMaterial({ map: rubble(), roughness: 1, side: THREE.DoubleSide });
  const darkWall = new THREE.MeshStandardMaterial({ map: rubble([118, 100, 84], '#3a322b'), roughness: 1, side: THREE.DoubleSide });
  const soil = new THREE.MeshStandardMaterial({ map: plainTex('#a0663f', 412, 0.12), roughness: 1, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const hg = new Geo();

  // ---- amphitheatre steps (south-west)
  {
    const rings = []; for (let k = 0; k <= NS; k++) rings.push(off(amphi, k * TREAD));
    for (let k = 0; k < NS; k++) {
      strip(cg, rings[k], rings[k + 1], -k * RISE + 0.03, -k * RISE + 0.03);
      strip(cg, rings[k + 1], rings[k + 1], -k * RISE + 0.03, -(k + 1) * RISE - (k === NS - 1 ? 0.45 : 0.05));
    }
    GARDEN.stepTop = off(amphi, TREAD * 0.5);
  }
  // ---- retaining wall with a planted bed on top (east)
  {
    const face = off(wall, WALL), inner = off(wall, 0.25), coping = off(wall, WALL - 0.35);
    const wgeo = new Geo(); strip(wgeo, face, face, 0.16, L - 0.2, 0.35);
    const wm = new THREE.Mesh(wgeo.build(), darkWall); wm.castShadow = true; wm.receiveShadow = true; g.add(wm);
    strip(cg, coping, face, 0.16, 0.16);
    const sg = new Geo(); strip(sg, inner, coping, 0.08, 0.08);
    const sm = new THREE.Mesh(sg.build(), soil); sm.receiveShadow = true; g.add(sm);
    // alternating blocks of foliage along the bed: purple, green, red
    const mid = off(wall, 1.15);
    const palette = [['#6a3558', '#3a1d33'], ['#5c8c38', '#2f5226'], ['#c2473a', '#6f2a25'], ['#5c8c38', '#2f5226'], ['#6a3558', '#3a1d33'], ['#a9c244', '#5f7f2c']];
    let i0 = 2, k = 0;
    while (i0 < mid.length - 4) {
      const len = 6 + Math.floor(r() * 5), seg = mid.slice(i0, Math.min(mid.length - 2, i0 + len));
      const [ct, cb] = palette[k++ % palette.length];
      if (seg.length > 2) hedgeLine(hg, seg, 1.5, 0.55 + r() * 0.4, ct, cb, () => 0.08, null, 0.12);
      i0 += len + 1;
    }
    GARDEN.wallTop = off(wall, -1.1);
  }

  // ---- rocks
  const rockMat = new THREE.MeshStandardMaterial({ map: granite(), roughness: 0.93 });
  const fall = fallTex(); waterTextures.push(fall);
  const fallMat = new THREE.MeshLambertMaterial({ map: fall, transparent: true, depthWrite: false, side: THREE.DoubleSide, color: '#eef6fa', emissive: '#8fa3ad', emissiveIntensity: 0.15, opacity: 0.75 });
  const waterMat = new THREE.MeshStandardMaterial({ color: '#445f55', roughness: 0.08, metalness: 0.5, transparent: true, opacity: 0.92, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  const smalls = [];
  const onPath = (x, z, m) => GARDEN.paths.some((p) => nearest(x, z, p.pts, false).d < m);
  const addSmall = (x, z, s, lift = 0, flat = 0) => { if (!onPath(x, z, 3.4 + s)) smalls.push({ x, z, s, y: height(x, z) + s * 0.22 + lift, flat }); };
  const addRock = (x, y, z, sx, sy, sz, rotY, seed, falls) => {
    const R = makeRock(seed, 3, sy > 3.2 ? 0.5 : 0.42);
    const m = new THREE.Mesh(R.geo, rockMat);
    m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.rotation.y = rotY; m.castShadow = true; m.receiveShadow = true; g.add(m);
    m.updateMatrix();
    if (falls) for (const f of falls) {
      const cols = 7, rowsN = 16, pos = [], uv = [], ind = [];
      for (let j = 0; j <= rowsN; j++) for (let i = 0; i <= cols; i++) {
        const th = Math.PI / 2 + f.c + (i / cols - 0.5) * f.w, ph = 0.2 + (j / rowsN) * (f.end || 1.75);
        const d = new THREE.Vector3(Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th));
        const q = R.surf(d).multiplyScalar(1.04).applyMatrix4(m.matrix);
        pos.push(q.x, Math.max(q.y, f.floor ?? -99), q.z); uv.push((i / cols) * f.w * 1.2, 1 - (j / rowsN) * 2.2);
      }
      for (let j = 0; j < rowsN; j++) for (let i = 0; i < cols; i++) { const a = j * (cols + 1) + i; ind.push(a, a + cols + 1, a + 1, a + 1, a + cols + 1, a + cols + 2); }
      const sg = new THREE.BufferGeometry();
      sg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); sg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); sg.setIndex(ind); sg.computeVertexNormals();
      const sm = new THREE.Mesh(sg, fallMat); sm.renderOrder = 5; g.add(sm);
    }
    return m;
  };
  // waterfall outcrop, west of the ring garden
  {
    const ax = -CLIFF.fz, az = CLIFF.fx, rot = Math.atan2(CLIFF.fx, CLIFF.fz), base = height(CLIFF.x + CLIFF.fx * 6, CLIFF.z + CLIFF.fz * 6);
    const row = [
      [-8.6, 3.8, 4.4, 3.6, 11, [{ c: 0.1, w: 1.1 }]], [-4.4, 4.2, 5.4, 3.9, 12, [{ c: -0.15, w: 0.9 }]], [-0.2, 4.6, 6.0, 4.1, 13, [{ c: 0.0, w: 1.3 }, { c: 0.75, w: 0.4 }]],
      [4.4, 4.0, 5.0, 3.9, 14, null], [8.8, 4.6, 3.9, 4.0, 15, [{ c: -0.2, w: 1.0 }]],
    ];
    for (const [o, sx, sy, sz, seed, falls] of row) addRock(CLIFF.x + ax * o, base + sy * 0.6, CLIFF.z + az * o, sx, sy, sz, rot + (r() - 0.5) * 0.3, seed, falls?.map((f) => ({ ...f, floor: base + 0.1 })));
    addRock(CLIFF.x + ax * -2.4, base + 9.6, CLIFF.z + az * -2.4 - 0.5, 2.2, 1.6, 1.9, 0.4, 21);
    addRock(CLIFF.x + ax * 5.6, base + 8.2, CLIFF.z + az * 5.6 - 0.4, 1.5, 1.2, 1.4, 1.2, 22);
    addRock(CLIFF.x + ax * -12.6, base + 1.5, CLIFF.z + az * -12.6 + 1, 3.0, 2.4, 2.6, 0.7, 23);
    addRock(CLIFF.x + ax * 13, base + 1.1, CLIFF.z + az * 13 + 1, 2.8, 1.9, 2.4, 2.1, 24);
    const fx = CLIFF.fx, fz = CLIFF.fz, c0 = [CLIFF.x + fx * 4.3, CLIFF.z + fz * 4.3];
    const front = [], back = [];
    for (let i = 0; i <= 20; i++) { const t = -10.5 + (21 * i) / 20; front.push([c0[0] + ax * t + fx * (1.7 - (t * t) / 70), c0[1] + az * t + fz * (1.7 - (t * t) / 70)]); back.push([c0[0] + ax * t - fx * 2.4, c0[1] + az * t - fz * 2.4]); }
    const wg = new Geo(); strip(wg, back, front, base + 0.14, base + 0.14);
    g.add(new THREE.Mesh(wg.build(), waterMat));
    strip(cg, front, offsetLine(front, 0.45), base + 0.24, base + 0.24);
    strip(cg, offsetLine(front, 0.45), offsetLine(front, 0.45), base + 0.24, base - 0.1);
    hedgeLine(hg, [[c0[0] + ax * -4.5 + fx * 4.4, c0[1] + az * -4.5 + fz * 4.4], [c0[0] + ax * 4.5 + fx * 4.4, c0[1] + az * 4.5 + fz * 4.4]], 1.7, 2.0, '#5f8a3a', '#34562a', height, null, 0.03);
    for (let i = 0; i < 22; i++) { const t = (r() - 0.5) * 30; if (Math.abs(t) > 6) addSmall(CLIFF.x + ax * t + fx * (4.5 + r() * 4), CLIFF.z + az * t + fz * (4.5 + r() * 4), 0.5 + r() * 1.1); }
  }
  // the boulder where the steps end, wrapped by their last curve
  {
    const a = amphi.run[0], b = amphi.run[amphi.run.length - 1];
    const end = Math.hypot(a[0] + 80, a[1] + 59) < Math.hypot(b[0] + 80, b[1] + 59) ? a : b;
    addRock(end[0] + 7, L + 1.9, end[1] - 6, 5.0, 3.4, 3.6, 0.5, 31);
    addRock(end[0] + 11.5, L + 1.0, end[1] - 4, 2.4, 1.8, 2.2, 1.4, 32);
  }
  // hilltop boulders
  for (const [dx, dz, sx, sy, sz, seed] of [[0, 0, 5.2, 3.6, 4.2, 41], [6.5, -2.5, 4.4, 3.2, 3.8, 42], [-5.5, 3, 4.0, 2.9, 3.4, 43], [2, 6.5, 3.4, 2.4, 3.0, 44], [-16, -22, 3.6, 2.6, 3.0, 45], [18, 10, 3.0, 2.0, 2.6, 46]]) {
    const x = HILL.x + dx, z = HILL.z + dz; addRock(x, height(x, z) + sy * 0.45, z, sx, sy, sz, r() * 6, seed);
  }
  for (let i = 0; i < 70; i++) { const x = -78 + r() * 80, z = -178 + r() * 100; if (pip(x, z, poly) && hillAt(x, z) > 1.2) addSmall(x, z, 0.5 + r() * 1.6); }

  // ---- rockery: piled boulders, dry-stone planters, cascade, moat and stepping stones
  {
    const R = ROCKERY;
    for (let i = 0; i < 190; i++) {
      const a = r() * 6.28, d = Math.sqrt(r()) * 1.95, x = R.x + Math.cos(a) * d * R.sx, z = R.z + Math.sin(a) * d * R.sz;
      addSmall(x, z, 0.55 + r() * 0.95 * (1.3 - d * 0.3), -0.05);
    }
    addRock(R.x + 3.6, height(R.x + 3.6, R.z + 1) + 0.9, R.z + 1.0, 2.2, 2.3, 2.0, Math.PI / 2 + 0.2, 70, [{ c: 0.1, w: 1.5, end: 1.9, floor: L + 0.1 }]);
    addRock(R.x - 1.5, height(R.x - 1.5, R.z - 4) + 1.1, R.z - 4, 2.4, 1.9, 2.0, 0.8, 71);
    addRock(R.x + 0.5, height(R.x + 0.5, R.z + 5) + 0.9, R.z + 5, 2.0, 1.6, 1.8, 2.2, 72);
    for (const [dx, dz, rad, hh] of [[-0.6, -0.5, 2.4, 1.0], [1.6, -5.5, 1.6, 0.9], [-2.2, 4.4, 1.7, 0.9], [2.4, 3.2, 1.2, 0.8]]) {
      const x = R.x + dx, z = R.z + dz;
      const w = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad * 1.06, hh, 16, 1, true), wallMat);
      w.position.set(x, height(x, z) + hh / 2 + 0.2, z); w.castShadow = true; g.add(w);
      const top = new THREE.Mesh(new THREE.CircleGeometry(rad, 16).rotateX(-Math.PI / 2), soil); top.position.set(x, height(x, z) + hh + 0.18, z); g.add(top);
    }
    // moat hugging the east and south sides
    const mi = ell(R.x, R.z, R.sx * 2.15, R.sz * 1.9, -1.25, 2.0, 46), mo = ell(R.x, R.z, R.sx * 2.15 + 2.3, R.sz * 1.9 + 2.3, -1.25, 2.0, 46);
    const mg = new Geo(); strip(mg, mi, mo, L + 0.09, L + 0.09);
    g.add(new THREE.Mesh(mg.build(), waterMat));
    const mo2 = ell(R.x, R.z, R.sx * 2.15 + 2.75, R.sz * 1.9 + 2.75, -1.25, 2.0, 46);
    strip(cg, mo, mo2, L + 0.2, L + 0.2); strip(cg, mo2, mo2, L + 0.2, L - 0.1); strip(cg, mo, mo, L + 0.2, L - 0.1);
    GARDEN.stones = ell(R.x, R.z, R.sx * 2.15 + 5.2, R.sz * 1.9 + 5.2, -1.5, 2.25, 80).concat(densify([[R.x + (R.sx * 2.15 + 5.2) * Math.cos(2.25), R.z + (R.sz * 1.9 + 5.2) * Math.sin(2.25)], [RING.x + 12, RING.z + 1.5]], 0.9));
  }

  // ---- lotus pond with its little palm island
  if (GARDEN.pond) {
    const pts = GARDEN.pond, y = L + 0.1;
    const pg = new Geo(); addFlatPoly(pg, pts, [], y, 1 / 9);
    const pm = new THREE.Mesh(pg.build(), new THREE.MeshStandardMaterial({ map: lilyTex(), roughness: 0.35, metalness: 0.1, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    pm.receiveShadow = true; g.add(pm);
    const loop = pts.concat([pts[0]]);
    const t = offsetLine(loop, 1)[3];
    const outer = offsetLine(loop, pip(t[0], t[1], pts) ? -0.9 : 0.9);
    strip(cg, loop, outer, L + 0.32, L + 0.32); strip(cg, loop, loop, L + 0.32, L); strip(cg, outer, outer, L + 0.32, L - 0.1);
    const isl = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.5, 0.5, 28), concrete); isl.position.set(POND.x, L + 0.3, POND.z); g.add(isl);
    const turf = new THREE.Mesh(new THREE.SphereGeometry(3.0, 24, 8, 0, 6.2832, 0, Math.PI / 2).scale(1, 0.22, 1), new THREE.MeshStandardMaterial({ map: grassTex(), roughness: 1 }));
    turf.position.set(POND.x, L + 0.5, POND.z); g.add(turf);
  }

  // ---- flagstone paths with clipped hedges; the raised ring garden
  const yPath = (x, z) => height(x, z) + 0.07;
  const pathGeo = new Geo();
  // paths stop at the foot of the amphitheatre steps: you walk down the steps onto them
  const onSteps = (x, z, m) => { const n = nearest(x, z, poly); return isAmphi([n.x, n.z]) && n.d < NS * TREAD + m; };
  for (const p of GARDEN.paths) {
    if (p.closed) continue;        // the ring itself is the paved plinth built below
    const line = densify(p.pts, 1).filter((q) => pip(q[0], q[1], poly) && !onSteps(q[0], q[1], 0.2) && Math.hypot(q[0] - RING.x, q[1] - RING.z) > RING.steps[0] + 0.1);
    if (line.length < 2) continue;
    addRibbon(pathGeo, line, 2.8, yPath, { vScale: 1 / 3, uRep: 1, maxSeg: 1.2 });
    for (const s of [-1, 1]) {
      hedgeLine(hg, offsetLine(line, s * 2.15), 1.2, 0.95, '#b9cc3e', '#6c8a2c', height,
        (x, z) => !pip(x, z, poly) || nearest(x, z, poly).d < 2.5 || onSteps(x, z, 1.0) || Math.hypot(x - RING.x, z - RING.z) < RING.steps[0] + 1.2);
    }
  }
  {
    // ring garden: a solid circular plinth with three steps all round, paved on top, planted in the middle
    const top = L + RING.steps.length * RING.rise;
    RING.steps.forEach((rad, i) => {
      const hh = (i + 1) * RING.rise + 0.4;
      const c = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad, hh, 56), concrete);
      c.position.set(RING.x, L - 0.4 + hh / 2, RING.z); c.castShadow = true; c.receiveShadow = true; g.add(c);
    });
    strip(pathGeo, ell(RING.x, RING.z, 3.5, 3.5, 0, 6.2832, 48), ell(RING.x, RING.z, RING.steps[2] - 0.15, RING.steps[2] - 0.15, 0, 6.2832, 48), top + 0.03, top + 0.03, 1 / 3);
    const bed = new THREE.Mesh(new THREE.CircleGeometry(3.5, 32).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: grassTex(), roughness: 1, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
    bed.position.set(RING.x, top + 0.03, RING.z); bed.receiveShadow = true; g.add(bed);
    hedgeLine(hg, ell(RING.x, RING.z, 7.8, 7.8, 0, 6.2832, 56), 1.1, 0.8, '#b9cc3e', '#6c8a2c', () => top,
      (x, z) => GARDEN.paths.some((p) => !p.closed && nearest(x, z, p.pts, false).d < 2.4));
    hedgeLine(hg, ell(RING.x, RING.z, 3.0, 3.0, 0, 6.2832, 30), 1.0, 0.7, '#5c8c38', '#2f5226', () => top, null);
    hedgeLine(hg, ell(RING.x, RING.z, 1.5, 1.5, 0, 6.2832, 18), 0.8, 0.5, '#c9523e', '#6f2a25', () => top, null);
  }
  // little hedge-ringed beds on the north lawn, the border around the flat rocks
  for (const [x, z, rad] of [[4, -138, 2.2], [16, -152, 1.9]]) { hedgeLine(hg, ell(x, z, rad, rad, 0, 6.2832, 20), 0.9, 0.45, '#c3d04a', '#7d8f2c', height, null); addSmall(x, z, 0.9); }
  hedgeLine(hg, ell(42, -104, 6.5, 4.5, 0.3, 3.6, 22), 1.0, 0.5, '#a9c244', '#5f7f2c', height, null);
  addSmall(43.5, -102.5, 2.6, 0, 1); addSmall(40.5, -99.5, 2.1, 0, 1);
  // curved hedge on the wall near the entrance-side junction, and the two road islands
  {
    const top = off(wall, 1.2).filter((p) => p[1] < -104);
    if (top.length > 3) hedgeLine(hg, top, 1.7, 1.0, '#8fae3c', '#4c6e2a', () => 0.08, null, 0.05);
  }
  for (const [x, z, rad] of ISLANDS) hedgeLine(hg, ell(x, z, rad - 1, rad - 1, 0, 6.2832, 30), 1.4, 0.85, '#5c8c38', '#2f5226', () => 0.02, null, 0.04);
  const pm2 = new THREE.Mesh(pathGeo.build(), new THREE.MeshStandardMaterial({ map: flagstone(), roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
  pm2.receiveShadow = true; g.add(pm2);
  g.add(hedgeMesh(hg));
  const cm = new THREE.Mesh(cg.build(), concrete); cm.castShadow = true; cm.receiveShadow = true; g.add(cm);

  // ---- instanced: small boulders, stepping stones, pots, shrubs
  for (const [x, z, s] of [[18, -108, 1.1], [30, -70, 0.9], [8, -118, 1.3], [-2, -72, 1.0], [12, -74, 0.8], [36, -145, 1.1], [-14, -140, 1.2], [-36, -50, 0.8], [-20, -36, 0.9]]) addSmall(x, z, s);
  const d = new THREE.Object3D(), col = new THREE.Color();
  for (let v = 0; v < 3; v++) {
    const arr = smalls.filter((s, i) => i % 3 === v && pip(s.x, s.z, poly));
    const SR = makeRock(91 + v * 7, 2, 0.45, 7);
    const im = new THREE.InstancedMesh(SR.geo, rockMat, arr.length);
    arr.forEach((s, i) => { d.position.set(s.x, s.y, s.z); d.rotation.set(r() * 0.5, r() * 6.28, r() * 0.5); d.scale.set(s.s * (0.9 + r() * 0.5), s.s * (s.flat ? 0.28 : 0.6 + r() * 0.4), s.s * (0.9 + r() * 0.4)); d.updateMatrix(); im.setMatrixAt(i, d.matrix); const t = 0.78 + r() * 0.32; im.setColorAt(i, col.setRGB(t, t * 0.98, t * 0.95)); });
    im.castShadow = true; im.receiveShadow = true; g.add(im);
  }
  {
    const pts = GARDEN.stones, list = [];
    pts.forEach((p, i) => {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, nx = -(b[1] - a[1]) / l, nz = (b[0] - a[0]) / l;
      for (const s of [-0.75, 0.75]) if ((i + (s > 0 ? 1 : 0)) % 2 === 0) list.push([p[0] + nx * (s + (r() - 0.5) * 0.4), p[1] + nz * (s + (r() - 0.5) * 0.4)]);
    });
    const im = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.62, 0.66, 0.1, 7), new THREE.MeshStandardMaterial({ map: plainTex('#cfc8b6', 420, 0.1), roughness: 0.95 }), list.length);
    list.forEach((p, i) => { d.position.set(p[0], height(p[0], p[1]) + 0.04, p[1]); d.rotation.set(0, r() * 6.28, 0); d.scale.set(0.8 + r() * 0.5, 1, 0.7 + r() * 0.4); d.updateMatrix(); im.setMatrixAt(i, d.matrix); });
    im.receiveShadow = true; g.add(im);
  }
  const mats = plantMaterials();
  const potProfile = [[0.0, 0], [0.34, 0], [0.38, 0.06], [0.5, 0.62], [0.56, 0.66], [0.56, 0.74], [0.46, 0.74], [0.44, 0.7]].map(([x, y]) => new THREE.Vector2(x, y));
  const ballGeo = merge([{ geo: blob(0.8, 2, 0.95, 7, '#ffffff', '#8a8a8a', 0.4), matrix: new THREE.Matrix4().makeTranslation(0, 1.35, 0), up: 0.7, uvWorld: true }]);
  const potSpots = GARDEN.stepTop.filter((_, i) => i % 8 === 4).map((p) => [p[0], p[1], '#6f9f48']).concat(GARDEN.wallTop.filter((_, i) => i % 11 === 5).map((p) => [p[0], p[1], '#d0508c']));
  const pots = new THREE.InstancedMesh(new THREE.LatheGeometry(potProfile, 14), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85 }), potSpots.length);
  const balls = new THREE.InstancedMesh(ballGeo, mats.solid, potSpots.length);
  potSpots.forEach((p, i) => { d.position.set(p[0], 0.05, p[1]); d.rotation.set(0, r() * 6, 0); d.scale.setScalar(0.85 + r() * 0.35); d.updateMatrix(); pots.setMatrixAt(i, d.matrix); balls.setMatrixAt(i, d.matrix); pots.setColorAt(i, col.set(i % 2 ? '#d9924a' : '#c8704a')); balls.setColorAt(i, col.set(p[2])); });
  for (const m of [pots, balls]) { m.castShadow = true; g.add(m); }
  // clipped shrubs growing out of the rockery
  {
    const list = [];
    for (let i = 0; i < 26; i++) { const a = r() * 6.28, dd = Math.sqrt(r()) * 1.5; list.push([ROCKERY.x + Math.cos(a) * dd * ROCKERY.sx, ROCKERY.z + Math.sin(a) * dd * ROCKERY.sz, 0.6 + r() * 0.7, r() < 0.3 ? '#c9dc6a' : '#7fae4c']); }
    const shrub = merge([{ geo: blob(1, 2, 0.85, 3, '#ffffff', '#8f8f8f', 0.35), up: 0.8, uvWorld: true }]);
    const im = new THREE.InstancedMesh(shrub, mats.solid, list.length);
    list.forEach((s, i) => { d.position.set(s[0], height(s[0], s[1]) + 0.55 + s[2] * 0.6, s[1]); d.rotation.set(0, r() * 6, 0); d.scale.setScalar(s[2]); d.updateMatrix(); im.setMatrixAt(i, d.matrix); im.setColorAt(i, col.set(s[3])); });
    im.castShadow = true; g.add(im);
  }
  // solar lamp posts on the lawn
  const steel = new THREE.MeshStandardMaterial({ color: '#d7d9da', roughness: 0.5, metalness: 0.4 });
  const lampMat = new THREE.MeshStandardMaterial({ color: '#e8e8e8', emissive: '#fff1cf', emissiveIntensity: 0 });
  env.nightEmissive.push({ mat: lampMat, on: 5 });
  for (const [x, z] of [[14, -70], [36, -112], [2, -132], [-22, -48], [8, -106]]) {
    const y = height(x, z);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 4.4, 8), steel); pole.position.set(x, y + 2.2, z); pole.castShadow = true; g.add(pole);
    const panel = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.05, 0.8), new THREE.MeshStandardMaterial({ color: '#1c2b4d', roughness: 0.3, metalness: 0.5 })); panel.position.set(x, y + 4.5, z); panel.rotation.set(0.35, r() * 0.5, 0); g.add(panel);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.22), lampMat); lamp.position.set(x + 0.35, y + 3.9, z); g.add(lamp);
  }
  scene.add(g);
  return g;
}
