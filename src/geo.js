import * as THREE from 'three';

export class Geo {
  constructor() { this.p = []; this.n = []; this.uv = []; this.i = []; }
  vert(p, n, u, v) {
    this.p.push(p[0], p[1], p[2]); this.n.push(n[0], n[1], n[2]); this.uv.push(u, v);
    return this.p.length / 3 - 1;
  }
  // a,b,c,d in order around the quad; front face = (a,b,c)
  quad(a, b, c, d, n, uva, uvb, uvc, uvd) {
    const i0 = this.vert(a, n, uva[0], uva[1]);
    this.vert(b, n, uvb[0], uvb[1]); this.vert(c, n, uvc[0], uvc[1]); this.vert(d, n, uvd[0], uvd[1]);
    this.i.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3);
  }
  tri(a, b, c, n, uva, uvb, uvc) {
    const i0 = this.vert(a, n, uva[0], uva[1]);
    this.vert(b, n, uvb[0], uvb[1]); this.vert(c, n, uvc[0], uvc[1]);
    this.i.push(i0, i0 + 1, i0 + 2);
  }
  // axis-aligned-in-local-frame box centred at (cx, y0..y1, cz), rotated by ang about Y
  box(cx, cz, w, d, y0, y1, ang = 0, uvScale = 0.25, vFull = false) {
    const c = Math.cos(ang), s = Math.sin(ang);
    const P = (lx, lz, y) => [cx + lx * c - lz * s, y, cz + lx * s + lz * c];
    const N = (lx, lz) => [lx * c - lz * s, 0, lx * s + lz * c];
    const hw = w / 2, hd = d / 2, h = y1 - y0;
    const sides = [
      [[-hw, -hd], [hw, -hd], [0, -1], w], [[hw, -hd], [hw, hd], [1, 0], d],
      [[hw, hd], [-hw, hd], [0, 1], w], [[-hw, hd], [-hw, -hd], [-1, 0], d],
    ];
    for (const [a, b, n, len] of sides) {
      this.quad(P(a[0], a[1], y0), P(a[0], a[1], y1), P(b[0], b[1], y1), P(b[0], b[1], y0), N(n[0], n[1]),
        [0, 0], [0, vFull ? 1 : h * uvScale], [len * uvScale, vFull ? 1 : h * uvScale], [len * uvScale, 0]);
    }
    this.quad(P(-hw, -hd, y1), P(-hw, hd, y1), P(hw, hd, y1), P(hw, -hd, y1), [0, 1, 0],
      [0, 0], [0, d * uvScale], [w * uvScale, d * uvScale], [w * uvScale, 0]);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.i);
    return g;
  }
}

export function polyArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

export function centroid(pts) {
  let x = 0, z = 0;
  for (const p of pts) { x += p[0]; z += p[1]; }
  return [x / pts.length, z / pts.length];
}

export function pip(x, z, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0], zi = pts[i][1], xj = pts[j][0], zj = pts[j][1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export function bbox(pts) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const p of pts) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
  return [x0, z0, x1, z1];
}

export function distToPoly(x, z, pts) {
  let best = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const l2 = dx * dx + dz * dz || 1;
    let t = ((x - a[0]) * dx + (z - a[1]) * dz) / l2;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz);
    if (d < best) best = d;
  }
  return best;
}

// flat polygon (with holes) at height y, facing up
export function addFlatPoly(geo, outer, holes, y, uvScale = 0.125) {
  const contour = outer.map((p) => new THREE.Vector2(p[0], p[1]));
  const hs = (holes || []).map((h) => h.map((p) => new THREE.Vector2(p[0], p[1])));
  let faces;
  try { faces = THREE.ShapeUtils.triangulateShape(contour, hs); } catch (e) { return; }
  const all = contour.concat(...hs);
  const base = geo.p.length / 3;
  for (const v of all) geo.vert([v.x, y, v.y], [0, 1, 0], v.x * uvScale, v.y * uvScale);
  for (const f of faces) {
    const a = all[f[0]], b = all[f[1]], c = all[f[2]];
    // want +y normal:  cross((b-a),(c-a)).y = (bz-az)*(cx-ax) - (bx-ax)*(cz-az)
    const ny = (b.y - a.y) * (c.x - a.x) - (b.x - a.x) * (c.y - a.y);
    if (ny >= 0) geo.i.push(base + f[0], base + f[1], base + f[2]);
    else geo.i.push(base + f[0], base + f[2], base + f[1]);
  }
}

// ribbon along a polyline. returns nothing; pushes into geo.
export function addRibbon(geo, pts, width, yFn, { closed = false, vScale = 0.125, maxSeg = 12, uRep = 1 } = {}) {
  // densify
  const P = [];
  const n = pts.length;
  const lim = closed ? n : n - 1;
  for (let i = 0; i < lim; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const k = Math.max(1, Math.ceil(len / maxSeg));
    for (let j = 0; j < k; j++) P.push([a[0] + ((b[0] - a[0]) * j) / k, a[1] + ((b[1] - a[1]) * j) / k]);
  }
  if (!closed) P.push(pts[n - 1]);
  const m = P.length;
  if (m < 2) return;
  const hw = width / 2;
  let dist = 0;
  const base = geo.p.length / 3;
  const rows = closed ? m + 1 : m;
  for (let r = 0; r < rows; r++) {
    const i = r % m;
    const prev = closed ? P[(i - 1 + m) % m] : P[Math.max(0, i - 1)];
    const next = closed ? P[(i + 1) % m] : P[Math.min(m - 1, i + 1)];
    const cur = P[i];
    let d1x = cur[0] - prev[0], d1z = cur[1] - prev[1], d2x = next[0] - cur[0], d2z = next[1] - cur[1];
    let l1 = Math.hypot(d1x, d1z), l2 = Math.hypot(d2x, d2z);
    if (l1 < 1e-6) { d1x = d2x; d1z = d2z; l1 = l2; }
    if (l2 < 1e-6) { d2x = d1x; d2z = d1z; l2 = l1; }
    d1x /= l1 || 1; d1z /= l1 || 1; d2x /= l2 || 1; d2z /= l2 || 1;
    let tx = d1x + d2x, tz = d1z + d2z;
    const tl = Math.hypot(tx, tz);
    if (tl < 1e-6) { tx = d2x; tz = d2z; } else { tx /= tl; tz /= tl; }
    const nx = -tz, nz = tx;
    const cosHalf = Math.max(0.45, tx * d2x + tz * d2z);
    const w = hw / cosHalf;
    if (r > 0) { const q = P[(r - 1) % m]; dist += Math.hypot(cur[0] - q[0], cur[1] - q[1]); }
    const lx = cur[0] + nx * w, lz = cur[1] + nz * w, rx = cur[0] - nx * w, rz = cur[1] - nz * w;
    geo.vert([lx, yFn(lx, lz), lz], [0, 1, 0], 0, dist * vScale);
    geo.vert([rx, yFn(rx, rz), rz], [0, 1, 0], uRep, dist * vScale);
  }
  for (let r = 0; r < rows - 1; r++) {
    const a = base + r * 2;
    // ensure upward-facing winding
    const pa = [geo.p[a * 3], geo.p[a * 3 + 2]], pb = [geo.p[(a + 1) * 3], geo.p[(a + 1) * 3 + 2]], pc = [geo.p[(a + 2) * 3], geo.p[(a + 2) * 3 + 2]];
    const ny = (pb[1] - pa[1]) * (pc[0] - pa[0]) - (pb[0] - pa[0]) * (pc[1] - pa[1]);
    if (ny >= 0) geo.i.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    else geo.i.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
}
