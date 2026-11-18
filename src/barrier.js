// The playable area: the campus plus the land outside its walls up to a painted treeline BAND metres
// out. Everything up to that treeline is built; nothing beyond it is (trees, rocks, buildings, areas,
// roads are culled before the scene is made). The camera may roam to REACH metres out, which stops
// it short of the treeline so the painting is never seen up close. What lies outside is suggested instead by two painted treeline bands — a near one
// just past the barrier and a far one around the whole campus — plus the satellite ground texture,
// which fade out as you climb so they never read as cardboard from the air.
import * as THREE from 'three';
import { pip, distToPoly, centroid } from './geo.js';
import { canvasTex, rng } from './textures.js';

export const BAND = 80, REACH = 60;
let boundary = null;

export function inBarrier(x, z, margin = 0) {
  return pip(x, z, boundary) || distToPoly(x, z, boundary) <= BAND + margin;
}

function nearestOnBoundary(x, z) {
  let best = Infinity, bx = x, bz = z;
  for (let i = 0; i < boundary.length; i++) {
    const a = boundary[i], b = boundary[(i + 1) % boundary.length];
    const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l2));
    const px = a[0] + t * dx, pz = a[1] + t * dz, d = Math.hypot(x - px, z - pz);
    if (d < best) { best = d; bx = px; bz = pz; }
  }
  return [bx, bz, best];
}

// Pull a point outside the barrier back onto it (towards the nearest stretch of wall), so motion
// slides along the line instead of stopping dead.
export function clampToBarrier(x, z) {
  if (pip(x, z, boundary)) return [x, z];
  const [bx, bz, d] = nearestOnBoundary(x, z);
  if (d <= REACH) return [x, z];
  const k = (REACH - 0.05) / d;
  return [bx + (x - bx) * k, bz + (z - bz) * k];
}

// Drop everything that lies beyond the barrier. Runs after the area builders' prepare steps (they
// look up mapped features by id/position) and before any geometry is made.
export function cullOutside(data) {
  boundary = data.boundary;
  const keep = (x, z) => inBarrier(x, z);
  const before = { trees: data.trees.length, rocks: data.rocks.length, buildings: data.buildings.length, areas: data.areas.length };
  data.trees = data.trees.filter((t) => keep(t[0], t[1]));
  data.rocks = data.rocks.filter((r) => keep(r[0], r[1]));
  data.buildings = data.buildings.filter((b) => keep(...centroid(b.outer)));
  data.areas = data.areas.filter((a) => keep(...centroid(a.pts)));
  data.labels = data.labels.filter((l) => keep(l.at[0], l.at[1]));
  // roads: split into the runs that stay inside, cut where they cross the barrier
  const roads = [];
  for (const r of data.roads) {
    const pts = r.closed ? [...r.pts, r.pts[0]] : r.pts;
    let run = [];
    const flush = () => { if (run.length > 1) roads.push({ ...r, closed: false, pts: run }); run = []; };
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], inside = keep(p[0], p[1]);
      if (i > 0) {
        const q = pts[i - 1], qin = keep(q[0], q[1]);
        if (inside !== qin) {
          // bisect the crossing so the road ends right at the barrier
          let lo = 0, hi = 1;
          for (let k = 0; k < 18; k++) { const m = (lo + hi) / 2, mx = q[0] + (p[0] - q[0]) * m, mz = q[1] + (p[1] - q[1]) * m; if (keep(mx, mz) === qin) lo = m; else hi = m; }
          const t = qin ? lo : hi, cut = [q[0] + (p[0] - q[0]) * t, q[1] + (p[1] - q[1]) * t];
          if (qin) { run.push(cut); flush(); } else run.push(cut);
        }
      }
      if (inside) run.push(p);
    }
    flush();
    // an untouched closed loop stays closed
    if (r.closed && roads.length && roads.at(-1).pts.length === pts.length) { roads.at(-1).pts = r.pts; roads.at(-1).closed = true; }
  }
  data.roads = roads;
  return Object.fromEntries(Object.entries(before).map(([k, v]) => [k, v - data[k].length]));
}

// ------------------------------------------------------------------ backdrop
function treelineTexture(seed, { far = false } = {}) {
  const W = 2048, H = 512, r = rng(seed);
  return canvasTex(W, H, (g) => {
    g.clearRect(0, 0, W, H);
    // far: hazier, lower contrast; near: darker, with visible trunks and lit leaf clusters
    const base = far ? [86, 104, 78] : [44, 66, 36];
    const tone = (k, a = 1) => `rgba(${base.map((c, i) => Math.round(Math.min(255, c * k + (i === 1 ? 6 : 0)))).join(',')},${a})`;
    g.fillStyle = tone(0.8); g.fillRect(0, H * 0.74, W, H * 0.26);           // undergrowth meets the ground
    const crowns = [];
    for (let i = 0; i < (far ? 260 : 170); i++) {
      crowns.push({ x: r() * W, top: H * (far ? 0.22 + r() * 0.42 : 0.04 + r() * 0.5), rad: far ? 26 + r() * 40 : 34 + r() * 70 });
    }
    crowns.sort((a, b) => a.top - b.top);                                     // taller trees behind
    const wrap = (fn, x) => { for (const dx of [-W, 0, W]) fn(x + dx); };     // seamless tiling
    for (const c of crowns) {
      const shade = 0.75 + r() * 0.5;
      if (!far) wrap((x) => { g.fillStyle = 'rgba(52,40,30,0.9)'; g.fillRect(x - 3, c.top + c.rad * 1.2, 6, H); }, c.x);
      // a crown is a cluster of leaf dabs, darker underneath and lit on top
      const dabs = far ? 26 : 60;
      for (let k = 0; k < dabs; k++) {
        const a = r() * Math.PI * 2, d = Math.sqrt(r()) * c.rad;
        const dx = Math.cos(a) * d * 1.1, dy = Math.sin(a) * d * 0.9, lit = 1 - (dy / c.rad) * 0.35;
        const rr = (far ? 5 : 7) + r() * (far ? 9 : 14);
        wrap((x) => { g.fillStyle = tone(shade * lit * (0.85 + r() * 0.3)); g.beginPath(); g.arc(x + dx, c.top + c.rad + dy, rr, 0, Math.PI * 2); g.fill(); }, c.x);
      }
    }
    // fine speckle so it doesn't read as flat paint up close
    const alpha = g.getImageData(0, 0, W, H).data;
    for (let i = 0; i < (far ? 3000 : 9000); i++) {
      const x = r() * W, y = H * 0.1 + r() * H * 0.9;
      if (alpha[((y | 0) * W + (x | 0)) * 4 + 3] < 200) continue;
      g.fillStyle = r() < 0.5 ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,220,0.10)'; g.fillRect(x, y, 2, 2);
    }
  });
}

// A vertical strip along a polyline, following the ground; u runs in metres / tileW.
function addStrip(pos, uv, idx, pts, height, H, tileW) {
  let u = 0;
  const base = pos.length / 3;
  for (let i = 0; i < pts.length; i++) {
    if (i) u += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]) / tileW;
    const y = height(pts[i][0], pts[i][1]);
    pos.push(pts[i][0], y - 2, pts[i][1], pts[i][0], y + H, pts[i][1]);
    uv.push(u, 0, u, 1);
    if (i) { const a = base + (i - 1) * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
}
const densify = (pts, step) => {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let k = 0; k < n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  out.push(pts.at(-1));
  return out;
};
function convexHull(points) {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo.at(-2), lo.at(-1), q) <= 0) lo.pop(); lo.push(q); }
  for (const q of p.reverse()) { while (up.length >= 2 && cross(up.at(-2), up.at(-1), q) <= 0) up.pop(); up.push(q); }
  return [...lo.slice(0, -1), ...up.slice(0, -1)];
}

const bands = [];
export function buildBackdrop(scene, data, height) {
  const B = data.boundary;
  const area = B.reduce((s, p, i) => { const q = B[(i + 1) % B.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0);
  const sgn = area > 0 ? 1 : -1;
  const roadCross = (x, z, r) => data.roads.some((rd) => rd.kind !== 'foot' && rd.kind !== 'path' && rd.pts.some((p) => Math.hypot(p[0] - x, p[1] - z) < r));

  // near band: each wall segment pushed out along its own normal and stretched past its ends so
  // convex corners close up; pieces that would land back inside the campus are dropped, and a gap
  // is left where a road leaves through the barrier.
  const NEAR = BAND;
  const near = { pos: [], uv: [], idx: [] };
  for (let i = 0; i < B.length; i++) {
    const a = B[i], b = B[(i + 1) % B.length], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 6) continue;
    const ex = (b[0] - a[0]) / len, ez = (b[1] - a[1]) / len, nx = ez * sgn, nz = -ex * sgn;
    const ext = Math.min(NEAR, len * 0.5);
    const p0 = [a[0] - ex * ext + nx * NEAR, a[1] - ez * ext + nz * NEAR], p1 = [b[0] + ex * ext + nx * NEAR, b[1] + ez * ext + nz * NEAR];
    let run = [];
    const flush = () => { if (run.length > 1) addStrip(near.pos, near.uv, near.idx, run, height, 22, 80); run = []; };
    for (const q of densify([p0, p1], 6)) {
      const ok = !pip(q[0], q[1], B) && distToPoly(q[0], q[1], B) > REACH + 15 && !roadCross(q[0], q[1], 18);
      if (ok) run.push(q); else flush();
    }
    flush();
  }

  // far band: the convex hull pushed well out, a hazier treeline beyond the near one
  const FAR = 170;
  const hull = convexHull(B);
  const ha = hull.reduce((s, p, i) => { const q = hull[(i + 1) % hull.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0) > 0 ? 1 : -1;
  const ring = hull.map((p, i) => {
    const prev = hull[(i - 1 + hull.length) % hull.length], next = hull[(i + 1) % hull.length];
    let nx = 0, nz = 0;
    for (const [s, e] of [[prev, p], [p, next]]) { const l = Math.hypot(e[0] - s[0], e[1] - s[1]) || 1; nx += ((e[1] - s[1]) / l) * ha; nz += (-(e[0] - s[0]) / l) * ha; }
    const nl = Math.hypot(nx, nz) || 1;
    return [p[0] + (nx / nl) * FAR, p[1] + (nz / nl) * FAR];
  });
  const far = { pos: [], uv: [], idx: [] };
  addStrip(far.pos, far.uv, far.idx, densify([...ring, ring[0]], 14), height, 34, 120);

  for (const [g, tex, name] of [[near, treelineTexture(71), 'Treeline (near)'], [far, treelineTexture(72, { far: true }), 'Treeline (far)']]) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(g.pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(g.uv, 2));
    geo.setIndex(g.idx);
    // normals point up: both faces light like a canopy seen from the side, never as a dark slab
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(g.pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.ClampToEdgeWrapping;
    const mat = new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide, transparent: true });
    const m = new THREE.Mesh(geo, mat);
    m.name = name; m.castShadow = false; m.receiveShadow = false;
    scene.add(m); bands.push(m);
  }
}

// From the air the bands would look like painted fences: fade them out with altitude.
export function updateBackdrop(camera, groundY) {
  const alt = camera.position.y - groundY;
  const o = 1 - THREE.MathUtils.smoothstep(alt, 70, 180);
  for (const m of bands) { m.visible = o > 0.01; m.material.opacity = o; }
}
