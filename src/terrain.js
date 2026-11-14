import { bbox, centroid, pip, distToPoly, polyArea } from './geo.js';
import { fbm } from './world.js';

// Terrain from a 30 m elevation grid (public/dem.json, see tools/dem.py).
// The survey is smoothed and resampled to a 4 m grid over the mapped extent; on that grid every
// building, court and pool gets a level pad at its own height and every road is graded along
// its centre line. Roads, paving and lawns are not flat: they are draped onto the triangles of
// the ground mesh (drapeGeo), so they can never cut through it. Outside the grid the land runs
// on into the procedural hills.
export const STEP = 4, COARSE = 32;
const FLAT = new Set(['pitch', 'track', 'pool', 'pooldeck', 'water', 'stage', 'amphi', 'bleachers', 'fountain', 'substation', 'shelter']);
const CORE = 6;        // level margin around a pad: more than one grid cell, so no sloping triangle reaches the outline
const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const cr = (p0, p1, p2, p3, t) => p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));

export function makeHeight(data, dem) {
  // ---- the survey, in metres relative to the campus centre. SRTM measures the top of whatever the radar
  // hit, so every large building shows up as a hill several metres high. Samples on or near a building are
  // thrown away and the rest is blurred heavily (about 90 m) to recover the lie of the land underneath.
  const { nx, nz, step } = dem;
  const boxes = data.buildings.map((b) => ({ bb: bbox(b.outer), pts: b.outer }));
  const NEAR = 30;
  let hw = new Float32Array(nx * nz), w = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = dem.x0 + i * step, z = dem.z0 + j * step;
    const built = boxes.some(({ bb, pts }) => x > bb[0] - NEAR && x < bb[2] + NEAR && z > bb[1] - NEAR && z < bb[3] + NEAR && (pip(x, z, pts) || distToPoly(x, z, pts) < NEAR));
    w[j * nx + i] = built ? 0 : 1; hw[j * nx + i] = built ? 0 : dem.h[j * nx + i];
  }
  const blur = (a) => {
    const t = new Float32Array(a.length);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) t[j * nx + i] = (a[j * nx + Math.max(0, i - 1)] + 2 * a[j * nx + i] + a[j * nx + Math.min(nx - 1, i + 1)]) / 4;
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) a[j * nx + i] = (t[Math.max(0, j - 1) * nx + i] + 2 * t[j * nx + i] + t[Math.min(nz - 1, j + 1) * nx + i]) / 4;
  };
  for (let pass = 0; pass < 18; pass++) { blur(hw); blur(w); }
  const h = hw.map((v, i) => v / Math.max(w[i], 1e-6));
  const base = h[Math.round(-dem.z0 / step) * nx + Math.round(-dem.x0 / step)];
  for (let i = 0; i < h.length; i++) h[i] -= base;
  const D = (i, j) => h[Math.max(0, Math.min(nz - 1, j)) * nx + Math.max(0, Math.min(nx - 1, i))];
  const dx1 = dem.x0 + (nx - 1) * step, dz1 = dem.z0 + (nz - 1) * step;
  function demAt(x, z) {
    const fx = (Math.max(dem.x0, Math.min(dx1, x)) - dem.x0) / step, fz = (Math.max(dem.z0, Math.min(dz1, z)) - dem.z0) / step;
    const i = Math.min(nx - 2, Math.floor(fx)), j = Math.min(nz - 2, Math.floor(fz)), tx = fx - i, tz = fz - j;
    const row = (m) => cr(D(i - 1, j + m), D(i, j + m), D(i + 1, j + m), D(i + 2, j + m), tx);
    return cr(row(-1), row(0), row(1), row(2), tz);
  }
  function raw(x, z) {
    const d = Math.hypot(Math.max(dem.x0 - x, 0, x - dx1), Math.max(dem.z0 - z, 0, z - dz1));
    const y = demAt(x, z);
    if (d <= 0) return y;
    const s = Math.min(1, d / 700), k = s * s * (3 - 2 * s);
    const hills = fbm(x / 800, z / 800) * 46 + fbm(x / 230 + 7, z / 230 + 2) * 9 - 12;
    const far = Math.max(0, (Math.hypot(x, z) - 2200) / 1500);
    return y + k * Math.max(-2, hills) + far * far * 60 * fbm(x / 600 + 3, z / 600);
  }

  // ---- fine grid over the mapped extent, aligned to the coarse ground mesh
  const e = data.extent;
  const gx0 = Math.floor((e[0] - 40) / COARSE) * COARSE, gz0 = Math.floor((e[1] - 40) / COARSE) * COARSE;
  const gnx = Math.round((Math.ceil((e[2] + 40) / COARSE) * COARSE - gx0) / STEP) + 1, gnz = Math.round((Math.ceil((e[3] + 40) / COARSE) * COARSE - gz0) / STEP) + 1;
  const gx1 = gx0 + (gnx - 1) * STEP, gz1 = gz0 + (gnz - 1) * STEP;
  const F = new Float32Array(gnx * gnz), mask = new Uint8Array(gnx * gnz), padW = new Float32Array(gnx * gnz);
  for (let j = 0; j < gnz; j++) for (let i = 0; i < gnx; i++) F[j * gnx + i] = demAt(gx0 + i * STEP, gz0 + j * STEP);
  const fine = (x, z) => x >= gx0 && x <= gx1 && z >= gz0 && z <= gz1;
  const bil = (A, x, z) => {
    const fx = (x - gx0) / STEP, fz = (z - gz0) / STEP;
    const i = Math.max(0, Math.min(gnx - 2, Math.floor(fx))), j = Math.max(0, Math.min(gnz - 2, Math.floor(fz))), tx = fx - i, tz = fz - j, k = j * gnx + i;
    return (A[k] * (1 - tx) + A[k + 1] * tx) * (1 - tz) + (A[k + gnx] * (1 - tx) + A[k + gnx + 1] * tx) * tz;
  };
  const cells = (x0, z0, x1, z1, fn) => {
    const i0 = Math.max(0, Math.floor((x0 - gx0) / STEP)), i1 = Math.min(gnx - 1, Math.ceil((x1 - gx0) / STEP));
    const j0 = Math.max(0, Math.floor((z0 - gz0) / STEP)), j1 = Math.min(gnz - 1, Math.ceil((z1 - gz0) / STEP));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) fn(j * gnx + i, gx0 + i * STEP, gz0 + j * STEP);
  };

  // ---- level pads. `core` metres around the outline are dead level, then the ground eases back over `ease`
  function pad(A, pts, y, core, ease, lock) {
    const bb = bbox(pts), r = core + ease;
    cells(bb[0] - r, bb[1] - r, bb[2] + r, bb[3] + r, (k, x, z) => {
      const d = pip(x, z, pts) ? 0 : distToPoly(x, z, pts);
      if (d >= r || (lock && mask[k] && d >= core)) return;   // never tilt a pad that is already level
      const wt = 1 - sstep(core, r, d);
      A[k] += (y - A[k]) * wt;
      if (lock) { padW[k] = Math.max(padW[k], wt); if (d < core) mask[k] = 1; }
    });
  }
  const meanAt = (pts) => { const c = centroid(pts); let s = demAt(c[0], c[1]); for (const p of pts) s += demAt(p[0], p[1]); return s / (pts.length + 1); };
  const byId = new Map(data.buildings.map((b) => [b.id, b]));
  // big areas first, so that a stage on a pitch or a kiosk on a court takes the level of what it stands on
  const areas = data.areas.filter((a) => FLAT.has(a.kind) && !a.hidden).sort((p, q) => Math.abs(polyArea(q.pts)) - Math.abs(polyArea(p.pts)));
  const within = (c, list) => list.find((a) => pip(c[0], c[1], a.pts));
  areas.forEach((a, i) => { const c = centroid(a.pts), host = within(c, areas.slice(0, i)); a.y = host ? host.y : demAt(c[0], c[1]); });
  const grounded = data.buildings.filter((b) => b.on == null && b.kind !== 'library');
  for (const b of grounded) {
    const bb = bbox(b.outer), host = within(centroid(b.outer), areas);
    // buildings beyond the fine grid cannot be given a pad, so they are sunk to their lowest corner
    b.y = host ? host.y : fine(bb[0], bb[1]) && fine(bb[2], bb[3]) ? meanAt(b.outer) : Math.min(...b.outer.map((p) => raw(p[0], p[1])));
  }
  // Buildings that stand close together share one terrace, at the average of their natural levels weighted by
  // floor area. Within 25 m always: separate levels that close leave a bank across the yard between them.
  // Across a road (up to 48 m) too, unless both are small and the land really drops between them: a road
  // squeezed between two terraces at different levels has nowhere to lie flat.
  {
    const N = grounded.map((b) => ({ b, bb: bbox(b.outer), area: Math.abs(polyArea(b.outer)) }));
    const parent = N.map((_, i) => i);
    const find = (i) => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
    const gap = (s, o) => Math.min(...s.b.outer.map((p) => (pip(p[0], p[1], o.b.outer) ? 0 : distToPoly(p[0], p[1], o.b.outer))));
    for (let i = 0; i < N.length; i++) for (let j = i + 1; j < N.length; j++) {
      const s = N[i], o = N[j];
      if (s.b.padWith === o.b.id || o.b.padWith === s.b.id) { parent[find(i)] = find(j); continue; }
      if (s.bb[0] > o.bb[2] + 48 || s.bb[2] < o.bb[0] - 48 || s.bb[1] > o.bb[3] + 48 || s.bb[3] < o.bb[1] - 48) continue;
      const d = Math.min(gap(s, o), gap(o, s));
      if (d < 25 || (d < 48 && (Math.abs(s.b.y - o.b.y) < 3.5 || Math.min(s.area, o.area) > 1500))) parent[find(i)] = find(j);
    }
    const sum = new Map();
    N.forEach((n, i) => { const r = find(i), t = sum.get(r) || [0, 0]; t[0] += n.area; t[1] += n.area * n.b.y; sum.set(r, t); });
    N.forEach((n, i) => { const t = sum.get(find(i)); n.b.y = t[1] / t[0]; });
  }
  for (const p of data.pads || []) p.y = p.like != null && byId.has(p.like) ? byId.get(p.like).y : demAt(p.at[0], p.at[1]);
  const pads = [...areas.map((a) => [a.pts, a.y]), ...(data.pads || []).map((p) => [p.pts, p.y]), ...grounded.map((b) => [b.outer, b.y])];
  // first pull the land around every pad towards its level over a wide shoulder (where several pads are near,
  // towards their average), so that roads, car parks and lawns between buildings lie at about floor level
  // instead of climbing over the natural ground in between. Then cut the exact level pads into that.
  {
    const sW = new Float32Array(F.length), sWY = new Float32Array(F.length), mW = new Float32Array(F.length);
    for (const [pts, y] of pads) {
      const bb = bbox(pts), core = CORE + 10, r = core + 26;
      cells(bb[0] - r, bb[1] - r, bb[2] + r, bb[3] + r, (k, x, z) => {
        const d = pip(x, z, pts) ? 0 : distToPoly(x, z, pts);
        if (d >= r) return;
        const wt = 1 - sstep(core, r, d);
        sW[k] += wt; sWY[k] += wt * y; mW[k] = Math.max(mW[k], wt);
      });
    }
    for (let k = 0; k < F.length; k++) if (sW[k] > 0) F[k] += (sWY[k] / sW[k] - F[k]) * mW[k];
  }
  for (const [pts, y] of pads) pad(F, pts, y, CORE, 8, true);
  const Fr = F.slice();
  // lawns and car parks are draped, but a lawn in a courtyard should report the pad it lies on
  for (const a of data.areas) { const c = centroid(a.pts); a.y = fine(c[0], c[1]) ? bil(F, c[0], c[1]) : raw(c[0], c[1]); }

  // ---- roads: level across, graded in a straight line between mapped points
  {
    // where several stretches of road reach the same ground (bends, junctions) their grades are averaged, weighted
    // towards the nearest, so the surface stays smooth instead of stepping from one road's grade to the next
    const wMax = new Float32Array(F.length), sw = new Float32Array(F.length), swh = new Float32Array(F.length);
    for (const r of data.roads) {
      if (r.hidden) continue;
      const walk = r.kind === 'foot' || r.kind === 'path' || r.kind === 'track';
      const flat = (walk ? r.w / 2 : (r.kind === 'service' ? 2.8 : r.w / 2) + 2.2) + 4.5, reach = flat + 6;
      // sample the level every 8 m or so along the road
      const line = [];
      for (let s = 0; s < r.pts.length - 1; s++) {
        const a = r.pts[s], b = r.pts[s + 1], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 8));
        for (let i = 0; i < n; i++) line.push([a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n]);
      }
      line.push(r.pts[r.pts.length - 1]);
      for (let s = 0; s < line.length - 1; s++) {
        const a = line[s], b = line[s + 1];
        if (!fine(a[0], a[1]) || !fine(b[0], b[1])) continue;
        const ha = bil(Fr, a[0], a[1]), hb = bil(Fr, b[0], b[1]);
        const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz || 1;
        cells(Math.min(a[0], b[0]) - reach, Math.min(a[1], b[1]) - reach, Math.max(a[0], b[0]) + reach, Math.max(a[1], b[1]) + reach, (k, x, z) => {
          const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l2));
          const d = Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz);
          if (d >= reach) return;
          wMax[k] = Math.max(wMax[k], 1 - sstep(flat, reach, d));
          const w = (1 - d / reach) ** 4;
          sw[k] += w; swh[k] += w * (ha + (hb - ha) * t);
        });
      }
    }
    // a road gives way to a pad as it nears one, so the two meet on the pad's smooth shoulder instead of a step
    for (let k = 0; k < F.length; k++) if (sw[k] > 0) F[k] += (swh[k] / sw[k] - F[k]) * wMax[k] * (1 - padW[k]);
  }
  // ---- the rim follows the coarse mesh around it, so the two ground meshes meet without cracks
  {
    const n = COARSE / STEP;
    const stitch = (count, at) => { for (let i = 0; i < count; i++) { const a = Math.floor(i / n) * n, b = Math.min(count - 1, a + n), t = (i - a) / n; if (i % n) F[at(i)] = F[at(a)] * (1 - t) + F[at(b)] * t; } };
    stitch(gnx, (i) => i); stitch(gnx, (i) => (gnz - 1) * gnx + i);
    stitch(gnz, (j) => j * gnx); stitch(gnz, (j) => j * gnx + gnx - 1);
  }

  // inside the grid, heights are read off the same two triangles per cell that the ground mesh draws
  const tri = (x, z) => {
    const fx = (x - gx0) / STEP, fz = (z - gz0) / STEP;
    const i = Math.max(0, Math.min(gnx - 2, Math.floor(fx))), j = Math.max(0, Math.min(gnz - 2, Math.floor(fz))), tx = fx - i, tz = fz - j, k = j * gnx + i;
    return tz > tx ? F[k] + (F[k + gnx + 1] - F[k + gnx]) * tx + (F[k + gnx] - F[k]) * tz : F[k] + (F[k + 1] - F[k]) * tx + (F[k + gnx + 1] - F[k + 1]) * tz;
  };
  const height = (x, z) => (fine(x, z) ? tri(x, z) : raw(x, z));
  height.fine = fine;
  height.grid = { x0: gx0, z0: gz0, nx: gnx, nz: gnz, step: STEP, F };
  return height;
}

// ---- draping: cut flat geometry (x, z, uv) along the ground mesh's triangles and lay it `off` above them
const clip = (poly, f) => {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length], fp = f(p), fq = f(q);
    if (fp >= 0) out.push(p);
    if ((fp > 0 && fq < 0) || (fp < 0 && fq > 0)) { const t = fp / (fp - fq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
  }
  return out;
};
function drapeTri(dst, A, B, C, height, off) {
  const g = height.grid, S = g.step, F = g.F;
  const det = (B[0] - A[0]) * (C[1] - A[1]) - (C[0] - A[0]) * (B[1] - A[1]);
  if (Math.abs(det) < 1e-9) return;
  const emit = (poly, hf) => {
    if (poly.length < 3) return;
    const idx = poly.map(([x, z]) => {
      const l1 = ((x - A[0]) * (C[1] - A[1]) - (C[0] - A[0]) * (z - A[1])) / det, l2 = ((B[0] - A[0]) * (z - A[1]) - (x - A[0]) * (B[1] - A[1])) / det;
      return dst.vert([x, hf(x, z) + off, z], [0, 1, 0], A[2] + l1 * (B[2] - A[2]) + l2 * (C[2] - A[2]), A[3] + l1 * (B[3] - A[3]) + l2 * (C[3] - A[3]));
    });
    for (let k = 1; k < poly.length - 1; k++) {
      const p = poly[0], q = poly[k], r = poly[k + 1];
      if ((q[1] - p[1]) * (r[0] - p[0]) - (q[0] - p[0]) * (r[1] - p[1]) >= 0) dst.i.push(idx[0], idx[k], idx[k + 1]); else dst.i.push(idx[0], idx[k + 1], idx[k]);
    }
  };
  const base = [[A[0], A[1]], [B[0], B[1]], [C[0], C[1]]];
  const x0 = Math.min(A[0], B[0], C[0]), x1 = Math.max(A[0], B[0], C[0]), z0 = Math.min(A[1], B[1], C[1]), z1 = Math.max(A[1], B[1], C[1]);
  // beyond the grid the ground mesh is coarse: leave the triangle whole and let it ride a little high
  if (!height.fine(x0, z0) || !height.fine(x1, z1)) { emit(base, (x, z) => height(x, z) + 0.35); return; }
  const i0 = Math.max(0, Math.floor((x0 - g.x0) / S)), i1 = Math.min(g.nx - 2, Math.floor((x1 - g.x0) / S));
  const j0 = Math.max(0, Math.floor((z0 - g.z0) / S)), j1 = Math.min(g.nz - 2, Math.floor((z1 - g.z0) / S));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const cx = g.x0 + i * S, cz = g.z0 + j * S, k = j * g.nx + i;
    let poly = clip(clip(clip(clip(base, (p) => p[0] - cx), (p) => cx + S - p[0]), (p) => p[1] - cz), (p) => cz + S - p[1]);
    if (poly.length < 3) continue;
    const a = F[k], b = F[k + 1], c = F[k + g.nx + 1], d = F[k + g.nx];
    emit(clip(poly, (p) => (p[1] - cz) - (p[0] - cx)), (x, z) => a + ((c - d) * (x - cx) + (d - a) * (z - cz)) / S);
    emit(clip(poly, (p) => (p[0] - cx) - (p[1] - cz)), (x, z) => a + ((b - a) * (x - cx) + (c - b) * (z - cz)) / S);
  }
}
export function drapeGeo(dst, src, height, off = 0) {
  const at = (i) => [src.p[i * 3], src.p[i * 3 + 2], src.uv[i * 2], src.uv[i * 2 + 1]];
  for (let t = 0; t < src.i.length; t += 3) drapeTri(dst, at(src.i[t]), at(src.i[t + 1]), at(src.i[t + 2]), height, off);
}
