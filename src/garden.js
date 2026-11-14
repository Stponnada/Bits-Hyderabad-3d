import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { Geo, pip, bbox, centroid, addFlatPoly, addRibbon } from './geo.js';
import { rng, canvasTex, grassTex, plainTex } from './textures.js';
import { fbm, heightMods } from './world.js';
import { leafTex, blob, merge, plantMaterials, extraPlants, noTreeZones, foliageGlow } from './plants.js';

// The Rock Garden: a sunken lawn in front of the academic block, reached by broad curved
// steps from the road, with a granite outcrop and waterfall on its west side, a pond with
// a boulder island, a shallow round pool, and a hedged flagstone path.
export const GARDEN = { poly: null, bb: null, paths: [] };
const DEPTH = 2.0, NS = 4, RISE = 0.5, TREAD = 1.6;
const POND = { x: 23.5, z: -87 };
const CLIFF = { x: -33, z: -126, fx: 0.87, fz: 0.49 };      // waterfall rock, facing the lawn
const ROCK2 = { x: -6, z: -94 };                            // boulder with the curved terraces
const POOL = { x: 15, z: -140, r: 6.5 };
const RING = { x: -29, z: -67, r: 6 };
const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function nearest(x, z, pts) {
  let best = Infinity, bx = 0, bz = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l2));
    const qx = a[0] + t * dx, qz = a[1] + t * dz, d = Math.hypot(x - qx, z - qz);
    if (d < best) { best = d; bx = qx; bz = qz; }
  }
  return { d: best, x: bx, z: bz };
}
const stepWeight = (n) => (n.x > 22 ? sstep(-136, -130, n.z) * (1 - sstep(-58, -52, n.z)) : 0);
function sunkMask(x, z) {
  const xb = -34 + 18 * sstep(-105, -85, z);
  return sstep(xb - 6, xb + 6, x);
}
export function gardenHeight(x, z) {
  const b = GARDEN.bb;
  if (!b || x < b[0] || x > b[2] || z < b[1] || z > b[3] || !pip(x, z, GARDEN.poly)) return 0;
  const m = sunkMask(x, z);
  if (m <= 0) return 0;
  const n = nearest(x, z, GARDEN.poly);
  const wz = stepWeight(n);
  const bank = -DEPTH * sstep(1.5, 8, n.d);
  const step = -RISE * Math.min(NS, Math.floor(n.d / TREAD));
  return m * (bank * (1 - wz) + step * wz);
}

export function prepareGarden(data) {
  const park = data.areas.find((a) => a.name === 'Rock Garden');
  if (!park) return;
  GARDEN.poly = park.pts; GARDEN.bb = bbox(park.pts);
  heightMods.push(gardenHeight);
  const inPark = (p) => pip(p[0], p[1], park.pts);
  data.rocks = data.rocks.filter((r) => !inPark(r));
  data.areas = data.areas.filter((a) => !(a.kind === 'grass' && Math.hypot(centroid(a.pts)[0] - POND.x, centroid(a.pts)[1] - POND.z) < 14));
  for (const r of data.roads) {
    if ((r.kind === 'foot' || r.kind === 'path') && inPark(r.pts[r.pts.length >> 1])) { r.garden = true; GARDEN.paths.push(r); }
  }
  // open lawn and the built features stay clear of scattered trees
  noTreeZones.push([26, -104, 24], [34, -138, 16], [POOL.x, POOL.z, 11], [POND.x, POND.z, 17], [20, -62, 12], [-4, -45, 14],
    [CLIFF.x + 4, CLIFF.z, 11], [ROCK2.x, ROCK2.z, 8], [-2, -160, 12], [42, -75, 10], [RING.x, RING.z, 9]);
  for (const r of GARDEN.paths) for (const p of r.pts) noTreeZones.push([p[0], p[1], 3.2]);
  const P = (x, z, kind, s, extra = {}) => extraPlants.push({ x, z, kind, s, ...extra });
  // mature canopy behind the outcrop and along the west side
  P(-45, -136, 'broad', 2.3); P(-30, -147, 'broad', 2.0); P(-49, -118, 'broad', 2.2); P(-43, -106, 'broad', 1.8);
  P(-22, -139, 'broad', 1.7); P(-52, -150, 'broad', 2.0); P(-18, -108, 'broad', 1.5); P(-58, -128, 'tall', 1.5);
  // specimen trees on the lawn
  P(38, -121, 'broad', 1.9); P(9, -113, 'broad', 1.3); P(-8, -150, 'broad', 1.5); P(30, -158, 'broad', 1.6);
  // pond island planting (heights set above the boulders)
  const iy = -DEPTH + 3.3;
  P(POND.x - 1.6, POND.z - 0.6, 'tall', 0.5, { y: iy, tint: '#c4e06a' }); P(POND.x + 1.2, POND.z + 1.0, 'tall', 0.42, { y: iy, tint: '#b6d862' });
  P(POND.x + 0.2, POND.z - 1.6, 'palm', 0.72, { y: iy - 0.4 }); P(POND.x + 2.6, POND.z - 0.4, 'palm', 0.26, { y: iy - 1.2 });
  P(POND.x - 2.6, POND.z + 1.6, 'palm', 0.22, { y: iy - 1.4 }); P(POND.x + 1.6, POND.z + 2.6, 'palm', 0.2, { y: iy - 1.6 });
}

// ------------------------------------------------------------------ helpers
function granite() {
  return canvasTex(512, 512, (g, w, h) => {
    const r = rng(401);
    g.fillStyle = '#b89b7c'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 90; i++) {
      const v = r();
      g.fillStyle = v < 0.4 ? `rgba(90,70,55,${r() * 0.14})` : v < 0.75 ? `rgba(225,200,170,${r() * 0.16})` : `rgba(170,120,90,${r() * 0.14})`;
      g.beginPath(); g.ellipse(r() * w, r() * h, 20 + r() * 90, 20 + r() * 70, r() * 3, 0, 7); g.fill();
    }
    for (let i = 0; i < 26000; i++) { const v = r() < 0.5 ? 40 : 235; g.fillStyle = `rgba(${v},${v * 0.95},${v * 0.9},${r() * 0.16})`; g.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2); }
    // rain and mineral streaks
    for (let i = 0; i < 60; i++) {
      const x = r() * w, y = r() * h * 0.5, len = 60 + r() * 260;
      const gr = g.createLinearGradient(0, y, 0, y + len);
      const dark = r() < 0.6;
      gr.addColorStop(0, dark ? 'rgba(60,45,35,0.22)' : 'rgba(240,225,205,0.25)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(x, y, 3 + r() * 16, len);
    }
    g.strokeStyle = 'rgba(50,35,28,0.35)'; g.lineWidth = 1.5;
    for (let i = 0; i < 10; i++) { let x = r() * w, y = r() * h; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 7; k++) { x += (r() - 0.5) * 50; y += r() * 50; g.lineTo(x, y); } g.stroke(); }
  });
}
function rubble() {
  return canvasTex(256, 256, (g, w, h) => {
    const r = rng(402);
    g.fillStyle = '#4e4338'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 22) {
      let x = -r() * 30;
      while (x < w) {
        const bw = 26 + r() * 34, v = 0.8 + r() * 0.4;
        g.fillStyle = `rgb(${172 * v},${146 * v},${116 * v})`;
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
  const t = canvasTex(128, 256, (g, w, h) => {
    const r = rng(404);
    g.clearRect(0, 0, w, h);
    for (let i = 0; i < 150; i++) {
      const x = r() * w, y = r() * h, len = 30 + r() * 120;
      const gr = g.createLinearGradient(0, y, 0, y + len);
      gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.4, `rgba(255,255,255,${0.25 + r() * 0.5})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      for (const oy of [0, -h]) g.fillRect(x, y + oy, 1.5 + r() * 4, len);
    }
  }, { srgb: true });
  return t;
}

// a boulder: returns geometry in unit space plus the surface function used to drape water on it
function makeRock(seed, detail = 3, rough = 0.34) {
  const surf = (d) => { const n = 1 - rough / 2 + rough * (fbm(d.x * 1.4 + seed, d.z * 1.4 + d.y * 1.9 + seed * 1.7) * 0.75 + fbm(d.x * 4 + seed, d.y * 4 + d.z * 3) * 0.25); return d.clone().multiplyScalar(n); };
  let g = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('normal');
  g = mergeVertices(g, 1e-4);
  const p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).normalize(); const q = surf(v); p.setXYZ(i, q.x, q.y, q.z); }
  g.computeVertexNormals();
  return { geo: g, surf };
}

// clipped hedge along a polyline (points [x,z]); skip(x,z) leaves gaps
export function hedgeLine(geo, pts, w, h, colTop, colBot, heightFn, skip, wobble = 0.07) {
  const ct = new THREE.Color(colTop), cb = new THREE.Color(colBot);
  const prof = [[-w / 2, 0, cb], [-w / 2, h * 0.78, ct], [-w / 4, h, ct], [w / 4, h, ct], [w / 2, h * 0.78, ct], [w / 2, 0, cb]];
  const S = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], len = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.round(len / 0.9));
    for (let j = 0; j < n; j++) S.push([a[0] + ((b[0] - a[0]) * j) / n, a[1] + ((b[1] - a[1]) * j) / n]);
  }
  S.push(pts[pts.length - 1]);
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
const arc = (cx, cz, r, a0, a1, n = 24) => Array.from({ length: n + 1 }, (_, i) => { const a = a0 + ((a1 - a0) * i) / n; return [cx + Math.cos(a) * r, cz + Math.sin(a) * r]; });
// strip between two polylines of equal length (both sides drawn)
function strip(geo, A, B, yA, yB, vS = 0.5) {
  let dist = 0;
  for (let i = 0; i < A.length - 1; i++) {
    const seg = Math.hypot(A[i + 1][0] - A[i][0], A[i + 1][1] - A[i][1]);
    const a = [A[i][0], yA, A[i][1]], b = [A[i + 1][0], yA, A[i + 1][1]], c = [B[i + 1][0], yB, B[i + 1][1]], d = [B[i][0], yB, B[i][1]];
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
    let nn = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const l = Math.hypot(...nn) || 1; nn = nn.map((v) => v / l);
    if (nn[1] < -0.01) nn = nn.map((v) => -v);
    const w = Math.hypot(d[0] - a[0], d[1] - a[1], d[2] - a[2]);
    geo.quad(a, b, c, d, nn, [dist * vS, 0], [(dist + seg) * vS, 0], [(dist + seg) * vS, w * vS], [dist * vS, w * vS]);
    dist += seg;
  }
}

export const waterTextures = [];

export function buildGarden(scene, height, env) {
  if (!GARDEN.poly) return null;
  const g = new THREE.Group();
  const poly = GARDEN.poly, bb = GARDEN.bb;
  const r = rng(808);
  const LAWN = -DEPTH;

  // ---- fine terrain for the garden (the campus-wide ground has a hole here)
  {
    const geo = new Geo(); const cols = [];
    const x0 = Math.floor(bb[0]) - 2, z0 = Math.floor(bb[1]) - 2, nx = Math.ceil(bb[2] - bb[0]) + 4, nz = Math.ceil(bb[3] - bb[1]) + 4;
    const idx = new Int32Array((nx + 1) * (nz + 1)).fill(-1);
    const keep = (x, z) => pip(x, z, poly) || nearest(x, z, poly).d < 2.2;
    const vid = (ix, iz) => {
      const k = iz * (nx + 1) + ix;
      if (idx[k] < 0) {
        const x = x0 + ix, z = z0 + iz;
        let y = height(x, z);
        const inside = pip(x, z, poly);
        if (inside) { const n = nearest(x, z, poly); if (stepWeight(n) > 0.02 && n.d < (NS + 0.6) * TREAD) y -= 0.3 * sunkMask(x, z); }
        idx[k] = geo.vert([x, y, z], [0, 1, 0], x / 5, z / 5);
        const m = inside ? sunkMask(x, z) : 0.6;
        const n2 = 0.9 + 0.2 * fbm(x / 9, z / 9);
        cols.push((0.62 + 0.38 * m) * n2, (0.66 + 0.34 * m) * n2, (0.5 + 0.5 * m) * n2);
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

  const concrete = new THREE.MeshStandardMaterial({ map: plainTex('#b7b0a0', 411, 0.09), roughness: 0.95, side: THREE.DoubleSide });
  const cg = new Geo();

  // ---- the broad curved steps down from the road (east side)
  let edge = [];
  {
    const n = poly.length;
    let start = 0;
    const ok = (p) => p[0] > 22 && p[1] > -138 && p[1] < -50;
    for (let i = 0; i < n; i++) if (ok(poly[i]) && !ok(poly[(i - 1 + n) % n])) start = i;
    for (let k = 0; k < n; k++) { const p = poly[(start + k) % n]; if (!ok(p)) break; edge.push(p); }
    edge = densify(edge, 1.4).filter((p) => p[1] > -133 && p[1] < -55);
    // inward normal: polygon has positive area, so inward = (-dz, dx)
    const rings = []; for (let k = 0; k <= NS; k++) rings.push(offsetLine(edge, k * TREAD));
    // make sure "inward" really points into the garden
    if (!pip(rings[1][edge.length >> 1][0], rings[1][edge.length >> 1][1], poly)) for (let k = 0; k <= NS; k++) rings[k] = offsetLine(edge, -k * TREAD);
    for (let k = 0; k < NS; k++) {
      strip(cg, rings[k], rings[k + 1], -k * RISE + 0.03, -k * RISE + 0.03);
      strip(cg, rings[k + 1], rings[k + 1], -k * RISE + 0.03, -(k + 1) * RISE - 0.05);
    }
    GARDEN.stepTop = rings[0].map((p, i) => [(p[0] + rings[1][i][0]) / 2, (p[1] + rings[1][i][1]) / 2]);
  }

  // ---- granite outcrop with the waterfall
  const rockMat = new THREE.MeshStandardMaterial({ map: granite(), roughness: 0.93 });
  const fall = fallTex(); waterTextures.push(fall);
  const fallMat = new THREE.MeshLambertMaterial({ map: fall, transparent: true, depthWrite: false, side: THREE.DoubleSide, color: '#eef6fa', emissive: '#8fa3ad', emissiveIntensity: 0.25 });
  const rocks = [];       // footprints for placing small stones around
  const addRock = (x, y, z, sx, sy, sz, rotY, seed, falls) => {
    const R = makeRock(seed, 3);
    const m = new THREE.Mesh(R.geo, rockMat);
    m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.rotation.y = rotY; m.castShadow = true; m.receiveShadow = true; g.add(m);
    m.updateMatrix();
    rocks.push([x, z, Math.max(sx, sz)]);
    if (falls) for (const f of falls) {
      // drape a sheet of water down the face that looks along local +z
      const cols = 7, rowsN = 16, pos = [], uv = [], ind = [];
      for (let j = 0; j <= rowsN; j++) for (let i = 0; i <= cols; i++) {
        const th = Math.PI / 2 + f.c + (i / cols - 0.5) * f.w, ph = 0.2 + (j / rowsN) * (f.end || 1.75);
        const d = new THREE.Vector3(Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th));
        const q = R.surf(d).multiplyScalar(1.035).applyMatrix4(m.matrix);
        pos.push(q.x, Math.max(q.y, f.floor ?? -99), q.z); uv.push(i / cols * f.w * 1.2, 1 - j / rowsN * 2.2);
      }
      for (let j = 0; j < rowsN; j++) for (let i = 0; i < cols; i++) { const a = j * (cols + 1) + i; ind.push(a, a + cols + 1, a + 1, a + 1, a + cols + 1, a + cols + 2); }
      const sg = new THREE.BufferGeometry();
      sg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); sg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); sg.setIndex(ind); sg.computeVertexNormals();
      const sm = new THREE.Mesh(sg, fallMat); sm.renderOrder = 5; g.add(sm);
    }
    return m;
  };
  {
    const ax = -CLIFF.fz, az = CLIFF.fx, rot = Math.atan2(CLIFF.fx, CLIFF.fz);
    const row = [
      [-10.5, 4.3, 5.0, 4.0, 11, [{ c: 0.1, w: 1.1 }]], [-5.4, 4.6, 5.9, 4.2, 12, [{ c: -0.15, w: 0.9 }]], [-0.6, 5.0, 6.6, 4.4, 13, [{ c: 0.0, w: 1.3 }, { c: 0.75, w: 0.4 }]],
      [4.8, 4.4, 5.6, 4.2, 14, null], [10.4, 5.6, 4.4, 4.4, 15, [{ c: -0.2, w: 1.0 }]],
    ];
    for (const [o, sx, sy, sz, seed, falls] of row) addRock(CLIFF.x + ax * o, LAWN + sy * 0.62, CLIFF.z + az * o, sx, sy, sz, rot + (r() - 0.5) * 0.3, seed, falls?.map((f) => ({ ...f, floor: LAWN + 0.1 })));
    // cap stones and flanking boulders
    addRock(CLIFF.x + ax * -2.8, LAWN + 11.2, CLIFF.z + az * -2.8 - 0.5, 2.3, 1.7, 2.0, 0.4, 21);
    addRock(CLIFF.x + ax * 6.5, LAWN + 9.3, CLIFF.z + az * 6.5 - 0.4, 1.5, 1.3, 1.4, 1.2, 22);
    addRock(CLIFF.x + ax * -15, LAWN + 1.6, CLIFF.z + az * -15 + 1, 3.2, 2.6, 2.8, 0.7, 23);
    addRock(CLIFF.x + ax * 15.5, LAWN + 1.2, CLIFF.z + az * 15.5 + 1, 3.0, 2.0, 2.6, 2.1, 24);
    // catch basin at the foot
    const fx = CLIFF.fx, fz = CLIFF.fz, c0 = [CLIFF.x + fx * 4.6, CLIFF.z + fz * 4.6];
    const basin = []; for (let i = 0; i <= 20; i++) { const t = -12 + (24 * i) / 20; basin.push([c0[0] + ax * t + fx * (1.6 - (t * t) / 90), c0[1] + az * t + fz * (1.6 - (t * t) / 90)]); }
    const back = []; for (let i = 0; i <= 20; i++) { const t = -12 + (24 * i) / 20; back.push([c0[0] + ax * t - fx * 2.4, c0[1] + az * t - fz * 2.4]); }
    const wg = new Geo(); strip(wg, back, basin, LAWN + 0.14, LAWN + 0.14);
    const wm = new THREE.Mesh(wg.build(), new THREE.MeshStandardMaterial({ color: '#4f6b66', roughness: 0.08, metalness: 0.5, transparent: true, opacity: 0.9, side: THREE.DoubleSide })); g.add(wm);
    strip(cg, basin, offsetLine(basin, 0.45), LAWN + 0.24, LAWN + 0.24);
    strip(cg, offsetLine(basin, 0.45), offsetLine(basin, 0.45), LAWN + 0.24, LAWN - 0.1);
    GARDEN.hedgeFront = [[c0[0] + ax * -4.5 + fx * 4.2, c0[1] + az * -4.5 + fz * 4.2], [c0[0] + ax * 4.5 + fx * 4.2, c0[1] + az * 4.5 + fz * 4.2]];
  }
  // ---- second boulder, wrapped by two curved concrete terraces
  {
    addRock(ROCK2.x, LAWN + 1.9, ROCK2.z, 5.2, 3.4, 3.8, 0.5, 31);
    addRock(ROCK2.x - 4.6, LAWN + 1.2, ROCK2.z + 1.2, 2.6, 2.2, 2.4, 1.4, 32);
    for (const [rad, top] of [[7.4, 0.5], [9.0, 0.25]]) {
      const a = arc(ROCK2.x, ROCK2.z, rad, -0.9, 2.5, 28), b = arc(ROCK2.x, ROCK2.z, rad - 1.6, -0.9, 2.5, 28);
      strip(cg, b, a, LAWN + top, LAWN + top); strip(cg, a, a, LAWN + top, LAWN - 0.1);
    }
    for (let i = 0; i < 16; i++) { const a = r() * 6.28, d = 6 + r() * 9, s = 0.5 + r() * 1.1; addRockSmall(ROCK2.x - 4 + Math.cos(a) * d * 0.7, ROCK2.z + Math.sin(a) * d * 0.5, s); }
  }
  function addRockSmall(x, z, s) { smalls.push({ x, z, s, y: height(x, z) + s * 0.25 }); }

  // ---- pond island: piled boulders, dry-stone planters, a cascade
  const wallMat = new THREE.MeshStandardMaterial({ map: rubble(), roughness: 1 });
  {
    const base = new THREE.Mesh(new THREE.CylinderGeometry(6.0, 6.2, 0.5, 30), new THREE.MeshStandardMaterial({ color: '#3a3a38', roughness: 0.7 }));
    base.position.set(POND.x, LAWN + 0.1, POND.z); base.scale.z = 1.15; g.add(base);
    for (let i = 0; i < 11; i++) { const a = (i / 11) * 6.28 + 0.2, s = 1.5 + r() * 0.8; addRock(POND.x + Math.cos(a) * 4.3, LAWN + 0.3 + s * 0.55, POND.z + Math.sin(a) * 4.9, s * 1.15, s * 0.8, s, r() * 6, 40 + i); }
    for (let i = 0; i < 7; i++) { const a = (i / 7) * 6.28 + 0.7, s = 1.2 + r() * 0.6; addRock(POND.x + Math.cos(a) * 2.4, LAWN + 1.5 + s * 0.5, POND.z + Math.sin(a) * 2.7, s * 1.1, s * 0.8, s, r() * 6, 60 + i); }
    addRock(POND.x + 3.4, LAWN + 1.9, POND.z + 1.0, 2.5, 2.6, 2.3, Math.PI / 2 + 0.3, 70, [{ c: 0.1, w: 1.5, end: 1.9, floor: LAWN + 0.12 }]);
    for (const [dx, dz, rad, y0, hh] of [[-0.4, -0.3, 2.7, 2.1, 1.3], [1.9, -2.2, 1.5, 1.5, 1.1], [-2.6, 1.6, 1.4, 1.2, 1.0]]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad * 1.06, hh, 16, 1, false), wallMat);
      w.material.map.repeat.set(3, 1);
      w.position.set(POND.x + dx, LAWN + y0 + hh / 2, POND.z + dz); w.castShadow = true; w.receiveShadow = true; g.add(w);
    }
  }
  // ---- shallow round pool on the north lawn
  {
    const y = height(POOL.x, POOL.z);
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(POOL.r + 0.6, POOL.r + 0.7, 0.4, 36), concrete); rim.position.set(POOL.x, y + 0.12, POOL.z); rim.receiveShadow = true; g.add(rim);
    const w = new THREE.Mesh(new THREE.CircleGeometry(POOL.r, 36).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#7d8f88', roughness: 0.1, metalness: 0.4 }));
    w.position.set(POOL.x, y + 0.34, POOL.z); g.add(w);
    addRock(POOL.x - 8.5, y + 0.9, POOL.z + 3, 1.8, 1.5, 1.6, 0.3, 81);
  }

  // ---- flagstone path with clipped hedges on both sides
  const hg = new Geo();
  const yPath = (x, z) => height(x, z) + 0.07;
  const pathGeo = new Geo();
  const nearPath = (x, z, lim, except) => GARDEN.paths.some((p) => p !== except && nearest(x, z, p.pts.concat([p.pts[p.pts.length - 1]])).d < lim && !p.closed) ;
  for (const p of GARDEN.paths) {
    const pts = p.closed ? p.pts.slice(0, -1) : p.pts;
    addRibbon(pathGeo, pts, p.closed ? 2.4 : 2.8, yPath, { closed: p.closed, vScale: 1 / 3, uRep: 1, maxSeg: 1.5 });
    const line = p.closed ? p.pts : p.pts;
    for (const s of p.closed ? [1] : [-1, 1]) {
      const off = offsetLine(densify(line, 1), s * (p.closed ? 2.0 : 2.15));
      // the ring's hedge goes on its outer side
      const use = p.closed && Math.hypot(off[0][0] - RING.x, off[0][1] - RING.z) < Math.hypot(line[0][0] - RING.x, line[0][1] - RING.z) ? offsetLine(densify(line, 1), -2.0) : off;
      hedgeLine(hg, use, 1.2, 0.95, '#b9cc3e', '#6c8a2c', height, (x, z) => !pip(x, z, poly) || nearest(x, z, poly).d < 2.5 || (p.closed ? nearPath(x, z, 2.4, p) : Math.hypot(x - RING.x, z - RING.z) < RING.r + 1.2));
    }
  }
  const pm = new THREE.Mesh(pathGeo.build(), new THREE.MeshStandardMaterial({ map: flagstone(), roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
  pm.receiveShadow = true; g.add(pm);
  // tall clipped hedge in front of the waterfall, long low hedge across the lawn
  hedgeLine(hg, GARDEN.hedgeFront, 1.7, 2.1, '#5f8a3a', '#34562a', height, null, 0.03);
  hedgeLine(hg, [[-12, -129], [4, -124.5], [20, -126], [36, -131], [44, -130]], 1.3, 0.75, '#a9c244', '#5f7f2c', height, null);
  hedgeLine(hg, [[2, -70], [10, -62], [22, -58]], 1.3, 0.75, '#a9c244', '#5f7f2c', height, null);
  g.add(hedgeMesh(hg));

  // ---- concrete (steps, terraces, rims)
  const cm = new THREE.Mesh(cg.build(), concrete); cm.castShadow = true; cm.receiveShadow = true; g.add(cm);

  // ---- scattered small stones
  const smalls = [];
  for (let i = 0; i < 16; i++) { const a = r() * 6.28, d = 5 + r() * 9, s = 0.5 + r() * 1.1; addRockSmall(ROCK2.x - 4 + Math.cos(a) * d * 0.7, ROCK2.z + Math.sin(a) * d * 0.5, s); }
  for (let i = 0; i < 26; i++) { const t = (r() - 0.5) * 34, s = 0.5 + r() * 1.3; addRockSmall(CLIFF.x - CLIFF.fz * t + CLIFF.fx * (5 + r() * 5), CLIFF.z + CLIFF.fx * t + CLIFF.fz * (5 + r() * 5), s); }
  for (let i = 0; i < 40; i++) { const x = -70 + r() * 50, z = -170 + r() * 120; if (pip(x, z, poly) && sunkMask(x, z) < 0.3) addRockSmall(x, z, 0.6 + r() * 1.8); }
  for (const [x, z, s] of [[18, -108, 1.1], [30, -96, 0.8], [-2, -118, 1.4], [44, -112, 0.9], [8, -150, 1.2], [26, -70, 1.0]]) addRockSmall(x, z, s);
  const SR = makeRock(91, 2);
  const im = new THREE.InstancedMesh(SR.geo, rockMat, smalls.length);
  const d = new THREE.Object3D(), col = new THREE.Color();
  smalls.forEach((s, i) => { d.position.set(s.x, s.y, s.z); d.rotation.set(r() * 0.4, r() * 6.28, r() * 0.4); d.scale.set(s.s * (0.9 + r() * 0.5), s.s * (0.55 + r() * 0.35), s.s * (0.9 + r() * 0.4)); d.updateMatrix(); im.setMatrixAt(i, d.matrix); const v = 0.8 + r() * 0.3; im.setColorAt(i, col.setRGB(v, v * 0.98, v * 0.96)); });
  im.castShadow = true; im.receiveShadow = true; g.add(im);

  // ---- potted shrubs along the top of the steps, solar lamp posts on the lawn
  const mats = plantMaterials();
  const potProfile = [[0.0, 0], [0.34, 0], [0.38, 0.06], [0.5, 0.62], [0.56, 0.66], [0.56, 0.74], [0.46, 0.74], [0.44, 0.7]].map(([x, y]) => new THREE.Vector2(x, y));
  const top = GARDEN.stepTop.filter((_, i) => i % 6 === 3);
  const pots = new THREE.InstancedMesh(new THREE.LatheGeometry(potProfile, 14), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85 }), top.length);
  const balls = new THREE.InstancedMesh(merge([{ geo: blob(0.8, 2, 0.95, 7, '#6a9a44', '#34582a', 0.4), matrix: new THREE.Matrix4().makeTranslation(0, 1.4, 0), up: 0.7, uvWorld: true }]), mats.solid, top.length);
  top.forEach((p, i) => { d.position.set(p[0], 0.03, p[1]); d.rotation.set(0, r() * 6, 0); d.scale.setScalar(0.9 + r() * 0.4); d.updateMatrix(); pots.setMatrixAt(i, d.matrix); balls.setMatrixAt(i, d.matrix); pots.setColorAt(i, col.set(i % 2 ? '#d9924a' : '#c8704a')); balls.setColorAt(i, col.set('#ffffff')); });
  for (const m of [pots, balls]) { m.castShadow = true; g.add(m); }
  const steel = new THREE.MeshStandardMaterial({ color: '#d7d9da', roughness: 0.5, metalness: 0.4 });
  const lampMat = new THREE.MeshStandardMaterial({ color: '#e8e8e8', emissive: '#fff1cf', emissiveIntensity: 0 });
  env.nightEmissive.push({ mat: lampMat, on: 5 });
  for (const [x, z] of [[20, -119], [39, -99], [-1, -141], [6, -66]]) {
    const y = height(x, z);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 4.4, 8), steel); pole.position.set(x, y + 2.2, z); pole.castShadow = true; g.add(pole);
    const panel = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.05, 0.8), new THREE.MeshStandardMaterial({ color: '#1c2b4d', roughness: 0.3, metalness: 0.5 })); panel.position.set(x, y + 4.5, z); panel.rotation.set(0.35, r() * 0.5, 0); g.add(panel);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.22), lampMat); lamp.position.set(x + 0.35, y + 3.9, z); g.add(lamp);
  }
  scene.add(g);
  return g;
}
