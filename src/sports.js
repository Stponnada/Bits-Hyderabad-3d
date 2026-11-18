import * as THREE from 'three';
import { Geo, pip, bbox, centroid, distToPoly } from './geo.js';
import { rng, canvasTex, plainTex, signTex, courtTex, grassTex } from './textures.js';
import { heightMods, fbm } from './world.js';
import { noTreeZones, extraPlants } from './plants.js';
import { hedgeLine, hedgeMesh } from './garden.js';

// Old football / hockey ground: the western third is a lawn at road level; broad stone steps
// lead down to the dirt field, which sits in a shallow depression with grass banks.
// East of it are the cricket net and the fenced, floodlit volleyball courts.
const O = [81, -104], A = [269, -13], S = [46, -33];
const LEN = Math.hypot(A[0] - O[0], A[1] - O[1]), WID = Math.hypot(S[0] - O[0], S[1] - O[1]);
const E = [(A[0] - O[0]) / LEN, (A[1] - O[1]) / LEN], W = [(S[0] - O[0]) / WID, (S[1] - O[1]) / WID];
export const FIELD = { o: O, e: E, w: W, len: LEN, wid: WID };
const SPLIT = 95, NS = 4, RISE = 0.4, TREAD = 1.6, DEPTH = NS * RISE, STEP_INSET = 6;
const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const P = (s, v) => [O[0] + E[0] * s + W[0] * v, O[1] + E[1] * s + W[1] * v];
const local = (x, z) => [(x - O[0]) * E[0] + (z - O[1]) * E[1], (x - O[0]) * W[0] + (z - O[1]) * W[1]];

export function fieldHeight(x, z) {
  const [s, v] = local(x, z);
  if (s <= SPLIT || s >= LEN || v <= 0 || v >= WID) return 0;
  const bank = -DEPTH * sstep(0.5, 6, Math.min(v, WID - v, LEN - s));
  if (s < SPLIT + NS * TREAD) {
    const step = -RISE * Math.min(NS, Math.floor((s - SPLIT) / TREAD) + 1);
    return v > STEP_INSET && v < WID - STEP_INSET ? Math.max(step, bank) : Math.max(bank, -DEPTH * sstep(0, NS * TREAD, s - SPLIT));
  }
  return bank;
}

// SAC entrance (north face), bleachers and the basketball courts beside it
const SAC = { x: 240, z: 273, nx: 0.435, nz: -0.9 };
const BL = { o: [221, 242], a: [0.436, -0.9], d: [0.894, 0.447], len: 34.4, dep: 13.4 };

// New football field and athletics track (surveyed from the campus virtual tour): the whole
// bowl sits well below the surrounding ground. On the court side (west) a rough granite rubble
// retaining wall holds up the clay courts; along the north end and the northern half of the
// east side a steep grassy hill with big boulders rises above road level, with a belt of trees
// behind its crest; to the south-east, by the service hall and the pool, a short grass bank.
// The track is pale cinder, and the field and banks are green grass.
export const TRACK = { poly: null, cut: null, c: null };
const TRACK_DEPTH = 2.2, TRACK_MARGIN = 6;
const TA = [0.4532, -0.8915], TV = [0.8915, 0.4532];         // track long axis (NNE) and across (ESE)
const HILL = { rise: 7.5, flat: 2.5, fall: 6.0, crest: 2.6 }; // metres out from the track edge; crest above road level
const HILL_W = HILL.rise + HILL.flat + HILL.fall;
const courtSide = (x, z) => (x - TRACK.c[0]) * -0.9 + (z - TRACK.c[1]) * -0.44 > 30;
// edges held by a retaining wall: the court side, and wherever a road runs too close for a bank
const walledV = (i) => TRACK.walled && TRACK.walled[i];
const walledAt = (n) => courtSide(n.x, n.z) || (walledV(n.i) && walledV((n.i + 1) % TRACK.walled.length));
const tframe = (x, z) => [(x - TRACK.c[0]) * TA[0] + (z - TRACK.c[1]) * TA[1], (x - TRACK.c[0]) * TV[0] + (z - TRACK.c[1]) * TV[1]];
// how much of the hill applies, from the nearest point on the track edge
function hillWeight(x, z) {
  if (courtSide(x, z)) return 0;
  const [u, v] = tframe(x, z);
  return sstep(24, 40, u) * sstep(-34, -20, v);
}
function hillProfile(d) {
  const H = TRACK_DEPTH + HILL.crest;
  if (d < HILL.rise) { const t = d / HILL.rise; return -TRACK_DEPTH + H * (0.45 * t + 0.55 * sstep(0, 1, t)); }
  if (d < HILL.rise + HILL.flat) return HILL.crest;
  return HILL.crest * (1 - sstep(HILL.rise + HILL.flat, HILL_W, d));
}
function nearestOn(x, z, pts) {
  let best = Infinity, bx = 0, bz = 0, bi = 0, bt = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length], dx = b[0] - a[0], dz = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1)));
    const qx = a[0] + t * dx, qz = a[1] + t * dz, d = Math.hypot(x - qx, z - qz);
    if (d < best) { best = d; bx = qx; bz = qz; bi = i; bt = t; }
  }
  return { d: best, x: bx, z: bz, i: bi, t: bt };
}
// bank width at the nearest edge point: the bank always ends before a road or building
const marginAt = (n) => TRACK.margins ? TRACK.margins[n.i] * (1 - n.t) + TRACK.margins[(n.i + 1) % TRACK.margins.length] * n.t : TRACK_MARGIN;
export function trackHeight(x, z) {
  const b = TRACK.bb;
  if (!b || x < b[0] || x > b[2] || z < b[1] || z > b[3]) return 0;
  if (pip(x, z, TRACK.poly)) return -TRACK_DEPTH;
  const n = nearestOn(x, z, TRACK.poly);
  if (n.d > HILL_W || walledAt(n)) return 0;
  // a 1 m flat apron outside the track edge keeps the slope's first triangles off the track
  const mg = marginAt(n), dd = Math.max(0, n.d - 1.0);
  const bank = n.d > mg ? 0 : -TRACK_DEPTH * (1 - sstep(0, mg - 1.0, dd));
  const w = hillWeight(n.x, n.z);
  return w > 0 ? bank * (1 - w) + hillProfile(dd) * w : bank;
}

// Boulders on the hill face, source trees moved off it to behind the crest, and the belt of
// trees behind the hill (the trees the tour shows lining the top of the bank).
function shapeTrackHill(data) {
  const r = rng(4242);
  const poly = TRACK.poly, n = poly.length;
  const roadSegs = data.roads.filter((rd) => !['foot', 'path', 'track'].includes(rd.kind)).flatMap((rd) => rd.pts.slice(0, -1).map((a, i) => [a, rd.pts[i + 1], (rd.kind === 'service' ? 5.6 : rd.w || 4) / 2]));
  const clearOfRoads = (x, z, m) => roadSegs.every(([a, b, hw]) => {
    const dx = b[0] - a[0], dz = b[1] - a[1], t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1)));
    return Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz) > hw + m;
  });
  const clearOfBuildings = (x, z, m) => data.buildings.every((b) => !pip(x, z, b.outer) && distToPoly(x, z, b.outer) > m);
  // walk the track edge, sampling outward normals
  const samples = [];
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    for (let t = 0; t < len; t += 1.5) {
      const x = a[0] + (b[0] - a[0]) * t / len, z = a[1] + (b[1] - a[1]) * t / len;
      let nx = (b[1] - a[1]) / len, nz = -(b[0] - a[0]) / len;
      if ((x - TRACK.c[0]) * nx + (z - TRACK.c[1]) * nz < 0) { nx = -nx; nz = -nz; }
      const w = hillWeight(x, z);
      if (w > 0.6) samples.push({ x, z, nx, nz, w });
    }
  }
  if (!samples.length) return;
  // relocate source trees standing on the hill face to the back slope
  for (const t of data.trees) {
    if (pip(t[0], t[1], poly)) continue;
    const q = nearestOn(t[0], t[1], poly);
    if (q.d > HILL.rise + HILL.flat + 0.5 || hillWeight(q.x, q.z) < 0.3) continue;
    const dx = (t[0] - q.x) / (q.d || 1), dz = (t[1] - q.z) / (q.d || 1), d = HILL.rise + HILL.flat + 1.5 + r() * 4;
    const x = q.x + dx * d, z = q.z + dz * d;
    if (clearOfRoads(x, z, 2) && clearOfBuildings(x, z, 2)) { t[0] = x; t[1] = z; }
  }
  // boulders strewn over the face, a few half-buried big ones and clusters of smaller stones
  for (let k = 0; k < 70; k++) {
    const s = samples[Math.floor(r() * samples.length)];
    const d = 1.2 + r() * (HILL.rise - 1.0), side = (r() - 0.5) * 1.5;
    const x = s.x + s.nx * d - s.nz * side, z = s.z + s.nz * d + s.nx * side;
    const big = r() < 0.3;
    data.rocks.push([x, z, big ? 1.5 + r() * 1.1 : 0.55 + r() * 0.7]);
    if (big && r() < 0.6) for (let j = 0; j < 2; j++) data.rocks.push([x + (r() - 0.5) * 3, z + (r() - 0.5) * 3, 0.4 + r() * 0.4]);
  }
  // a belt of broad-leaved trees behind the crest, two loose rows
  const step = 5.5;
  for (let k = 0; k < samples.length; k += Math.max(1, Math.round(step / 1.5))) {
    const s = samples[k];
    for (const [d0, jit] of [[HILL.rise + HILL.flat + 1.8, 1.2], [HILL_W - 0.5, 2.0]]) {
      if (r() < 0.15) continue;
      const d = d0 + (r() - 0.5) * jit, side = (r() - 0.5) * 2.5;
      const x = s.x + s.nx * d - s.nz * side, z = s.z + s.nz * d + s.nx * side;
      if (!clearOfRoads(x, z, 2.5) || !clearOfBuildings(x, z, 3)) continue;
      extraPlants.push({ x, z, kind: r() < 0.2 ? 'tall' : 'broad', s: 1.15 + r() * 0.5 });
    }
  }
}

// the three stores on the dirt plot south of the old football ground
export const SHOP_ROWS = [
  { c: [142.3, 67.5], a: [-0.436, 0.9], f: [0.9, 0.436], names: ['Bits & Bytes', 'SUBWAY', 'Yummpys'], colors: ['#c8472e', '#2f8a3c', '#d9952a'], wall: '#e9e2d2',
    plot: [[133, 28], [160, 41], [133, 98], [106, 84]] },
  // Hotspot, Amul and Vijay Vahini: three small, separate red shops (Amul is the narrow one) on the
  // corner plot west of the SAC road, facing north onto the main road
  { c: [267.2, 97.8], a: [-0.9, -0.436], f: [0.436, -0.9], names: ['HOTSPOT', 'AMUL', 'VIJAY VAHINI'], colors: ['#8f1f1c', '#8f1f1c', '#8f1f1c'], wall: '#b23a30',
    widths: [6, 3, 6], xs: [-7, 0, 7], depth: 4.2, h: 3.2,
    plot: [[277.5, 99.4], [256.8, 89.4], [252.5, 98.4], [273.2, 108.4]] },
];
const SAC_ROAD = [[286, 98], [259, 156], [234, 208]];

export function prepareSports(data) {
  heightMods.push(fieldHeight);
  // the faculty apartment towers seen across the field are 12 storeys, not 7
  for (const b of data.buildings) if (b.kind === 'apartment' && [-174, -175, -176, -177].includes(b.id)) b.levels = 12;
  const track = data.areas.find((a) => a.kind === 'track');
  if (track) {
    TRACK.poly = track.pts; TRACK.c = centroid(track.pts);
    // the cut-out only grows outward where there is a grass bank; on the court side the wall is the edge
    // bank width per vertex: up to TRACK_MARGIN, but clear of the nearest road edge or building
    const roadSegs = data.roads.filter((rd) => !['foot', 'path', 'track'].includes(rd.kind)).flatMap((rd) => rd.pts.slice(0, -1).map((a, i) => [a, rd.pts[i + 1], (rd.kind === 'service' ? 5.6 : rd.w || 4) / 2 + 2.2]));
    TRACK.margins = track.pts.map((p) => {
      let clear = Infinity;
      for (const [a, b, hw] of roadSegs) {
        const dx = b[0] - a[0], dz = b[1] - a[1], t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz || 1)));
        clear = Math.min(clear, Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz) - hw);
      }
      for (const b of data.buildings) if (Math.abs(b.outer[0][0] - p[0]) < 80 && Math.abs(b.outer[0][1] - p[1]) < 80) clear = Math.min(clear, distToPoly(p[0], p[1], b.outer));
      return Math.min(TRACK_MARGIN, clear - 1.5);
    });
    TRACK.walled = track.pts.map((p, i) => !courtSide(p[0], p[1]) && hillWeight(p[0], p[1]) < 0.01 && TRACK.margins[i] < 3);
    TRACK.margins = TRACK.margins.map((m) => Math.max(2.5, m));
    // offset each vertex along its outward normal: past the hill on the hill side
    const n = track.pts.length, ccw = track.pts.reduce((t, p, i) => { const q = track.pts[(i + 1) % n]; return t + p[0] * q[1] - q[0] * p[1]; }, 0) > 0 ? 1 : -1;
    TRACK.cut = track.pts.map((p, i) => {
      const a = track.pts[(i + n - 1) % n], b = track.pts[(i + 1) % n];
      const e1 = [p[0] - a[0], p[1] - a[1]], e2 = [b[0] - p[0], b[1] - p[1]], l1 = Math.hypot(...e1) || 1, l2 = Math.hypot(...e2) || 1;
      let nx = (e1[1] / l1 + e2[1] / l2) * ccw, nz = -(e1[0] / l1 + e2[0] / l2) * ccw; const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl;
      if ((p[0] - TRACK.c[0]) * nx + (p[1] - TRACK.c[1]) * nz < 0) { nx = -nx; nz = -nz; }
      const m = courtSide(p[0], p[1]) || TRACK.walled[i] ? 0.2 : hillWeight(p[0], p[1]) > 0.01 ? HILL_W + 1.5 : TRACK.margins[i] + 0.3;
      return [p[0] + nx * m, p[1] + nz * m];
    });
    const bb = bbox(TRACK.cut); TRACK.bb = [bb[0] - 1, bb[1] - 1, bb[2] + 1, bb[3] + 1];
    heightMods.push(trackHeight);
    const pitch = data.areas.find((a) => a.kind === 'pitch' && /New Football/.test(a.name || ''));
    if (pitch) TRACK.pitch = pitch.pts;
    shapeTrackHill(data);
  }
  // the throwball / kho-kho court beside the wall is bare red earth, not lawn
  for (const a of data.areas) if (a.kind === 'pitch' && /kho_kho|throwball/.test(a.sport || '')) { a.kind = 'plaza'; a.surface = 'dirt'; }
  // Gautam Bhavan is mapped right on the kerb; it stands well back from the road
  const gautam = data.buildings.find((b) => /Gautam/.test(b.name));
  if (gautam) { const sh = (p) => [p[0] - 0.9 * 12, p[1] - 0.436 * 12]; gautam.outer = gautam.outer.map(sh); gautam.holes = gautam.holes.map((h) => h.map(sh)); }
  // the stores replace the two mapped kiosks, and their plot is bare earth
  data.buildings = data.buildings.filter((b) => !/Yummpys|Bits & Bytes/.test(b.name));
  for (const SHOPS of SHOP_ROWS) {
    data.areas.push({ kind: 'plaza', surface: 'dirt', name: '', pts: SHOPS.plot });
    for (let i = -1; i <= 1; i++) noTreeZones.push([SHOPS.c[0] + SHOPS.a[0] * i * 9 + SHOPS.f[0] * 2, SHOPS.c[1] + SHOPS.a[1] * i * 9 + SHOPS.f[1] * 2, 9]);
  }
  // an avenue of trees along the road that leads up to the SAC
  for (let k = 0; k < SAC_ROAD.length - 1; k++) {
    const a = SAC_ROAD[k], b = SAC_ROAD[k + 1], len = Math.hypot(b[0] - a[0], b[1] - a[1]), nx = (b[1] - a[1]) / len, nz = -(b[0] - a[0]) / len;
    const east = nx > 0 ? 1 : -1;
    for (let t = 5; t < len - 3; t += 9) extraPlants.push({ x: a[0] + ((b[0] - a[0]) * t) / len + nx * east * 5.6, z: a[1] + ((b[1] - a[1]) * t) / len + nz * east * 5.6, kind: 'broad', s: 1.25 + ((t * 13) % 7) * 0.05 });
  }
  data.areas = data.areas.filter((a) => !(a.kind === 'pitch' && /Old Football/.test(a.name)) && a.kind !== 'bleachers');
  for (const a of data.areas) {
    if (a.kind !== 'pitch') continue;
    const cx = a.pts.reduce((t, p) => t + p[0], 0) / a.pts.length, cz = a.pts.reduce((t, p) => t + p[1], 0) / a.pts.length;
    if (a.sport === 'volleyball' && cx > 230 && cx < 290 && cz > 30 && cz < 85) a.sport = 'volleyball_turf';
  }
  const sac = data.buildings.find((b) => /Student Activity/.test(b.name));
  if (sac) {   // find the wall the entrance sits on
    for (let k = 0; k < 120; k++) { const x = 245.2 - SAC.nx * k * 0.2, z = 262.2 - SAC.nz * k * 0.2; if (pip(x, z, sac.outer)) { SAC.x = x; SAC.z = z; break; } }
  }
  // keep the field, plaza, courts and stand clear of scattered trees
  for (let s = SPLIT - 4; s < LEN + 4; s += 12) for (let v = 8; v < WID; v += 14) noTreeZones.push([...P(s, v), 10]);
  noTreeZones.push([SAC.x + SAC.nx * 10, SAC.z + SAC.nz * 10, 15], [233, 230, 16], [261, 245, 24], [272, 5, 18], [260, 57, 26]);
  const T = (x, z, kind, s) => extraPlants.push({ x, z, kind, s });
  // shade trees on the upper lawn and beside the SAC door
  for (const [s, v] of [[18, 14], [40, 30], [22, 52], [58, 16], [66, 60], [80, 38], [46, 68]]) T(...P(s, v), 'broad', 1.3 + ((s * 7) % 5) * 0.1);
  T(SAC.x - 9 + SAC.nx * 4, SAC.z - 4.5 + SAC.nz * 4, 'broad', 1.3); T(SAC.x + 11 + SAC.nx * 5, SAC.z + 5 + SAC.nz * 5, 'broad', 1.5);
}

function rubbleTex() {     // rough granite rubble masonry, 3 m square
  const r = rng(994);
  return canvasTex(384, 384, (g) => {
    g.fillStyle = '#4f4c47'; g.fillRect(0, 0, 384, 384);
    for (let y = 0; y < 384; y += 22 + r() * 10) {
      let x = -r() * 30;
      const rowH = 20 + r() * 14;
      while (x < 384) {
        const w = 26 + r() * 44, h = rowH - 3 - r() * 6, v = 112 + r() * 60, warm = r() * 14;
        g.fillStyle = `rgb(${v + warm},${v + warm * 0.6},${v - 4})`;
        g.beginPath();
        const jx = () => (r() - 0.5) * 6;
        g.moveTo(x + 2 + jx(), y + 2 + jx()); g.lineTo(x + w - 2 + jx(), y + 2 + jx()); g.lineTo(x + w - 2 + jx(), y + h + jx()); g.lineTo(x + 2 + jx(), y + h + jx());
        g.closePath(); g.fill();
        g.fillStyle = `rgba(255,255,255,${0.05 + r() * 0.08})`; g.fillRect(x + 4, y + 3, w * 0.6, 3);
        g.fillStyle = 'rgba(0,0,0,0.15)'; g.fillRect(x + 3, y + h - 3, w - 6, 3);
        x += w;
      }
    }
    for (let k = 0; k < 3000; k++) { g.fillStyle = `rgba(${r() < 0.5 ? '255,255,255' : '0,0,0'},${r() * 0.12})`; g.fillRect(r() * 384, r() * 384, 2, 2); }
    const gg = g.createLinearGradient(0, 0, 0, 384); gg.addColorStop(0, 'rgba(0,0,0,0)'); gg.addColorStop(1, 'rgba(60,40,25,0.18)'); g.fillStyle = gg; g.fillRect(0, 0, 384, 384);
  });
}
function wireTex(color) {
  return canvasTex(64, 64, (g) => {
    g.clearRect(0, 0, 64, 64); g.strokeStyle = color; g.lineWidth = 2.2;
    for (let i = -64; i < 128; i += 16) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 64, 64); g.stroke(); g.beginPath(); g.moveTo(i + 64, 0); g.lineTo(i, 64); g.stroke(); }
  });
}
// chain-link fence around an oriented rectangle
function fence(group, cx, cz, ax, half, h, color, postMat) {
  const dx = [-ax[1], ax[0]];
  const tex = wireTex(color);
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => [cx + ax[0] * half[0] * i + dx[0] * half[1] * j, cz + ax[1] * half[0] * i + dx[1] * half[1] * j]);
  const pg = new Geo();
  for (let k = 0; k < 4; k++) {
    const a = corners[k], b = corners[(k + 1) % 4], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const t = tex.clone(); t.needsUpdate = true; t.repeat.set(len / 0.5, h / 0.5);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(len, h), new THREE.MeshLambertMaterial({ map: t, transparent: true, alphaTest: 0.35, side: THREE.DoubleSide }));
    m.position.set((a[0] + b[0]) / 2, h / 2 + 0.05, (a[1] + b[1]) / 2); m.rotation.y = -Math.atan2(b[1] - a[1], b[0] - a[0]); group.add(m);
    const n = Math.round(len / 3);
    for (let i = 0; i <= n; i++) pg.box(a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n, 0.09, 0.09, 0, h + 0.1, 0);
    pg.box((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, len, 0.06, h, h + 0.07, Math.atan2(b[1] - a[1], b[0] - a[0]));
  }
  group.add(new THREE.Mesh(pg.build(), postMat));
}

export function buildSports(scene, height, env) {
  const g = new THREE.Group();
  const r = rng(909);
  const steel = new THREE.MeshStandardMaterial({ color: '#b9bec2', roughness: 0.4, metalness: 0.7 });
  const lampMat = new THREE.MeshStandardMaterial({ color: '#dddddd', emissive: '#fff4d6', emissiveIntensity: 0 });
  env.nightEmissive.push({ mat: lampMat, on: 3 });
  const mast = (x, z, h = 17) => {
    const y = height(x, z);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.26, h, 8), steel); pole.position.set(x, y + h / 2, z); pole.castShadow = true; g.add(pole);
    const head = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.1, 0.4), lampMat); head.position.set(x, y + h + 0.3, z); head.lookAt(P(150, 40)[0], 0, P(150, 40)[1]); g.add(head);
  };

  // ---- terrain of the ground (the campus-wide ground is cut away here)
  {
    const geo = new Geo(), cols = [];
    const ns = Math.ceil(LEN), nv = Math.ceil(WID);
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= ns; i++) {
      const s = Math.min(LEN, i), v = Math.min(WID, j), [x, z] = P(s, v);
      let y = height(x, z);
      const ds = s - SPLIT;
      if (ds > 0 && ds < NS * TREAD && v > STEP_INSET - 1 && v < WID - STEP_INSET + 1) y = Math.min(y, -0.25 - DEPTH * Math.max(0, Math.min(1, (ds - 0.3) / (NS * TREAD - 1.3))));
      geo.vert([x, y, z], [0, 1, 0], x / 4, z / 4);
      const n = 0.9 + 0.2 * fbm(x / 7, z / 7), patch = fbm(x / 19 + 4, z / 19 + 2);
      const edge = Math.min(v, WID - v, LEN - s);
      // upper lawn and the banks are dry grass; the playing surface is red-brown earth
      const grass = s < SPLIT ? 1 : 1 - sstep(2.5, 6.5, edge);
      const gr = [0.36 + 0.16 * patch, 0.43 + 0.08 * patch, 0.19], di = [0.6 + 0.1 * patch, 0.38 + 0.07 * patch, 0.22 + 0.04 * patch];
      cols.push(...gr.map((c, k) => (c * grass + di[k] * (1 - grass)) * n));
    }
    for (let j = 0; j < nv; j++) for (let i = 0; i < ns; i++) { const a = j * (ns + 1) + i, b = a + 1, c = a + ns + 2, d = a + ns + 1; geo.i.push(a, d, c, a, c, b); }
    const bg = geo.build(); bg.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3)); bg.computeVertexNormals();
    const m = new THREE.Mesh(bg, new THREE.MeshStandardMaterial({ map: plainTex('#f2f0ea', 931, 0.16), vertexColors: true, roughness: 1, side: THREE.DoubleSide }));
    m.receiveShadow = true; g.add(m);
  }
  // ---- the stone steps between the two levels
  {
    const sg = new Geo(), sg2 = new Geo();
    const ang = Math.atan2(E[1], E[0]);
    for (let k = 0; k < NS; k++) {
      const c = P(SPLIT + (k + 0.5) * TREAD, WID / 2);
      (k % 2 ? sg : sg2).box(c[0], c[1], TREAD, WID - 2 * STEP_INSET, -DEPTH - 0.4, -(k + 1) * RISE + 0.02 + (k === NS - 1 ? -0.05 : 0), ang, 0.3);
    }
    const c0 = P(SPLIT - 0.6, WID / 2); sg.box(c0[0], c0[1], 1.2, WID - 2 * STEP_INSET, -0.3, 0.06, ang, 0.3);
    for (const [geo, col, seed] of [[sg, '#9c978d', 941], [sg2, '#b0aba0', 942]]) { const m = new THREE.Mesh(geo.build(), new THREE.MeshStandardMaterial({ map: plainTex(col, seed, 0.12), roughness: 0.9 })); m.castShadow = true; m.receiveShadow = true; g.add(m); }
  }
  // ---- pitch markings, goals, floodlights
  {
    const s0 = SPLIT + NS * TREAD + 6, s1 = LEN - 9, pl = s1 - s0, pw = WID - 20, c = P((s0 + s1) / 2, WID / 2), ang = Math.atan2(E[1], E[0]);
    const tex = courtTex('soccer', 'Old Football ground');
    const m = new THREE.Mesh(new THREE.PlaneGeometry(pw, pl), new THREE.MeshStandardMaterial({ map: tex, roughness: 1, transparent: true, opacity: 0.75, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    m.rotation.order = 'YXZ'; m.rotation.y = -ang + Math.PI / 2; m.rotation.x = -Math.PI / 2; m.position.set(c[0], -DEPTH + 0.04, c[1]); m.receiveShadow = true; g.add(m);
    const white = new THREE.MeshStandardMaterial({ color: '#f3f3f3', roughness: 0.5 });
    for (const s of [s0 + 1.5, s1 - 1.5]) {
      const q = P(s, WID / 2), gg = new THREE.Group();
      for (const t of [-1, 1]) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.14, 6), white); b.position.set(0, 1.07, t * 1.83); gg.add(b); }
      const top = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 3.66, 6), white); top.rotation.x = Math.PI / 2; top.position.y = 2.14; gg.add(top);
      gg.position.set(q[0], -DEPTH, q[1]); gg.rotation.y = -ang; g.add(gg);
    }
    for (const [s, v] of [[SPLIT + 14, -4], [SPLIT + 14, WID + 4], [LEN - 12, -4], [LEN - 12, WID + 4]]) mast(...P(s, v));
  }
  // ---- cricket net (where the kabaddi mat used to be)
  {
    const c = [272, 5], ang = Math.atan2(W[1], W[0]), L2 = 13, W2 = 4.5, h = 4.2;
    fence(g, c[0], c[1], W, [L2, W2], h, '#3f8f4f', new THREE.MeshStandardMaterial({ color: '#2f6f3c', roughness: 0.6 }));
    const roof = new THREE.Mesh(new THREE.PlaneGeometry(L2 * 2, W2 * 2), new THREE.MeshLambertMaterial({ map: (() => { const t = wireTex('#3f8f4f'); t.repeat.set(30, 10); return t; })(), transparent: true, alphaTest: 0.35, side: THREE.DoubleSide }));
    roof.rotation.order = 'YXZ'; roof.rotation.y = -ang; roof.rotation.x = -Math.PI / 2; roof.position.set(c[0], h + 0.1, c[1]); g.add(roof);
    const mg = new Geo();
    for (const o of [-2.2, 2.2]) mg.box(c[0] + E[0] * o, c[1] + E[1] * o, L2 * 2 - 1, 3.2, 0.03, 0.07, ang);
    mg.box(c[0], c[1], L2 * 2 + 1, W2 * 2 + 1, 0, 0.035, ang);
    const mat = new THREE.Mesh(mg.build(), new THREE.MeshStandardMaterial({ map: plainTex('#4f9a58', 951, 0.08), roughness: 1 })); mat.receiveShadow = true; g.add(mat);
  }
  // ---- fenced, floodlit volleyball courts on green turf
  {
    const c = [259.5, 56.5];
    const pad = new Geo(); pad.box(c[0], c[1], 48, 33, 0, 0.03, Math.atan2(E[1], E[0]));
    const pm = new THREE.Mesh(pad.build(), new THREE.MeshStandardMaterial({ map: plainTex('#3f8a50', 952, 0.07), roughness: 1 })); pm.receiveShadow = true; g.add(pm);
    fence(g, c[0], c[1], E, [24, 16.5], 4, '#3f8f4f', new THREE.MeshStandardMaterial({ color: '#2f6f3c', roughness: 0.6 }));
    mast(c[0] + E[0] * 26, c[1] + E[1] * 26, 12); mast(c[0] - E[0] * 26, c[1] - E[1] * 26, 12);
  }

  // ---- SAC: paved forecourt, tiled steps, doors under the balcony with the name board
  {
    const ang = Math.atan2(-SAC.nx, SAC.nz);
    const at = (lx, lz) => [SAC.x + lx * Math.cos(ang) - lz * Math.sin(ang), SAC.z + lx * Math.sin(ang) + lz * Math.cos(ang)];
    const V = (lx, y, lz) => { const p = at(lx, lz); return new THREE.Vector3(p[0], y, p[1]); };
    const cream = new THREE.MeshStandardMaterial({ map: plainTex('#eadfc8', 961, 0.05), roughness: 0.9 });
    const cg = new Geo(), tg = new Geo(), pg = new Geo(), wg = new Geo();
    const box = (geo, lx, lz, w, d, y0, y1, uv = 0.3) => { const p = at(lx, lz); geo.box(p[0], p[1], w, d, y0, y1, ang, uv); };
    box(pg, 0, 5.6, 36, 11.2, 0, 0.06, 1 / 5);                                   // forecourt slab
    box(tg, 0, 1.5, 11, 3, 0, 0.51, 0.5);                                      // landing
    for (let k = 0; k < 3; k++) box(tg, 0, 3 + (k + 0.5) * 1.3, 11, 1.3, 0, 0.51 - (k + 1) * 0.17, 0.5);
    box(tg, -7.4, 3.4, 3.2, 6.8, 0, 0.3, 0.5);                                 // ramp side
    for (const s of [-1, 1]) box(cg, s * 5.9, 1.6, 0.7, 3.2, 0, 12.6);          // piers
    box(cg, 0, 1.9, 12.6, 3.8, 3.9, 5.25);                                     // balcony
    box(cg, 0, 2.1, 13.2, 4.2, 12.1, 12.7);                                    // roof overhang
    for (const s of [-1, 1]) { box(wg, s * 8.6, 4.4, 5.2, 0.6, 0, 0.75, 0.5); box(wg, s * 11.0, 2.2, 0.6, 4.4, 0, 0.75, 0.5); }
    const mk = (geo, mat) => { const m = new THREE.Mesh(geo.build(), mat); m.castShadow = true; m.receiveShadow = true; g.add(m); };
    mk(cg, cream);
    mk(tg, new THREE.MeshStandardMaterial({ roughness: 0.6, map: canvasTex(128, 128, (c) => { for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) { c.fillStyle = (x + y) % 2 ? '#e2d3b3' : '#8a5a48'; c.fillRect(x * 64, y * 64, 64, 64); } c.strokeStyle = 'rgba(0,0,0,0.25)'; c.strokeRect(0, 0, 128, 128); }) }));
    mk(pg, new THREE.MeshStandardMaterial({ roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, map: canvasTex(256, 256, (c) => { const q = rng(7); c.fillStyle = '#b3b1aa'; c.fillRect(0, 0, 256, 256); for (let i = 0; i < 5000; i++) { const v = q() < 0.5 ? 70 : 230; c.fillStyle = `rgba(${v},${v},${v},${q() * 0.12})`; c.fillRect(q() * 256, q() * 256, 2, 2); } c.strokeStyle = 'rgba(60,60,55,0.5)'; c.lineWidth = 2; c.strokeRect(0, 0, 256, 256); }) }));
    mk(wg, new THREE.MeshStandardMaterial({ roughness: 1, map: canvasTex(128, 128, (c) => { const q = rng(8); c.fillStyle = '#55524c'; c.fillRect(0, 0, 128, 128); for (let y = 0; y < 128; y += 22) for (let x = (y / 22 % 2) * 14 - 14; x < 128; x += 28) { const v = 120 + q() * 60; c.fillStyle = `rgb(${v},${v},${v * 0.96})`; c.fillRect(x + 2, y + 2, 24, 18); } }) }));
    const doors = new THREE.Mesh(new THREE.PlaneGeometry(8, 3.3), new THREE.MeshStandardMaterial({ roughness: 0.7, map: canvasTex(512, 256, (c) => {
      c.fillStyle = '#7a4a2c'; c.fillRect(0, 0, 512, 256);
      const gl = c.createLinearGradient(0, 0, 0, 256); gl.addColorStop(0, '#1b2830'); gl.addColorStop(1, '#3d5563'); c.fillStyle = gl;
      for (let i = 0; i < 8; i++) { c.fillRect(8 + i * 63, 8, 52, 44); c.fillRect(12 + i * 63, 66, 44, 80); c.fillRect(12 + i * 63, 156, 44, 60); }
    }, { repeat: false }) }));
    doors.position.copy(V(0, 0.51 + 1.65, 0.12)); doors.rotation.y = -ang; g.add(doors);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(8.4, 0.8), new THREE.MeshStandardMaterial({ roughness: 0.6, map: signTex([{ text: 'STUDENTS  ACTIVITY CENTRE', size: 62, y: 0.54, color: '#2f5fae' }], { w: 1024, h: 98, bg: '#dfe6ee' }) }));
    sign.position.copy(V(0, 4.55, 3.83)); sign.rotation.y = -ang; g.add(sign);
    const hg = new Geo();
    for (const s of [-1, 1]) hedgeLine(hg, [at(s * 6.4, 4.4), at(s * 10.8, 4.4)], 0.55, 0.45, '#6f9f48', '#3b5f2c', () => 0.75, null, 0.05);
    g.add(hedgeMesh(hg));
  }
  // ---- the blue spectator stand beside the basketball courts
  {
    const ang = Math.atan2(BL.a[1], BL.a[0]), TIERS = 9, tierD = 1.25;
    const blue = new Geo(), seat = new Geo();
    const B = (along, depth) => [BL.o[0] + BL.a[0] * along + BL.d[0] * depth, BL.o[1] + BL.a[1] * along + BL.d[1] * depth];
    for (let i = 0; i < TIERS; i++) {
      const depth = BL.dep - 1.2 - (i + 0.5) * tierD, top = 0.9 + i * 0.42, c = B(BL.len / 2, depth);
      blue.box(c[0], c[1], BL.len, tierD, 0, top, ang, 0.3);
      const sc = B(BL.len / 2, depth + 0.35); seat.box(sc[0], sc[1], BL.len - 0.6, 0.36, top + 0.36, top + 0.42, ang, 0.3);
      for (let k = 1; k < 12; k++) { const lc = B((BL.len * k) / 12, depth + 0.35); blue.box(lc[0], lc[1], 0.07, 0.07, top, top + 0.37, ang); }
    }
    const back = B(BL.len / 2, BL.dep - 1.2 - TIERS * tierD - 0.1); blue.box(back[0], back[1], BL.len, 0.2, 0, 0.9 + TIERS * 0.42 + 0.6, ang, 0.3);
    const m1 = new THREE.Mesh(blue.build(), new THREE.MeshStandardMaterial({ map: plainTex('#2c4fae', 971, 0.06), roughness: 0.6, metalness: 0.2 })); m1.castShadow = true; m1.receiveShadow = true; g.add(m1);
    const m2 = new THREE.Mesh(seat.build(), new THREE.MeshStandardMaterial({ map: plainTex('#5b82dc', 972, 0.05), roughness: 0.6 })); m2.castShadow = true; g.add(m2);
    // tubular railings along the back and both ends
    const rail = new THREE.MeshStandardMaterial({ color: '#2a48a0', roughness: 0.5, metalness: 0.5 });
    const bar = (p, q) => { const a = new THREE.Vector3(...p), b = new THREE.Vector3(...q), dd = new THREE.Vector3().subVectors(b, a), len = dd.length(); const m = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, len, 6), rail); m.position.copy(a).addScaledVector(dd, 0.5); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dd.normalize()); g.add(m); };
    const topY = 0.9 + (TIERS - 1) * 0.42, d0 = BL.dep - 1.2 - TIERS * tierD, d1 = BL.dep - 1.2;
    for (const al of [0, BL.len]) for (const dy of [0.5, 1.0]) bar([B(al, d0)[0], topY + dy, B(al, d0)[1]], [B(al, d1)[0], 0.9 + dy, B(al, d1)[1]]);
    for (const dy of [0.6, 1.1]) bar([B(0, d0)[0], topY + dy + 0.4, B(0, d0)[1]], [B(BL.len, d0)[0], topY + dy + 0.4, B(BL.len, d0)[1]]);
    // low stone wall along the forecourt side of the stand
    const wg = new Geo(), wc = B(BL.len / 2, BL.dep + 1.4); wg.box(wc[0], wc[1], BL.len + 6, 0.55, 0, 0.8, ang, 0.5);
    const wm = new THREE.Mesh(wg.build(), new THREE.MeshStandardMaterial({ map: plainTex('#8f8c84', 973, 0.16), roughness: 1 })); wm.castShadow = true; g.add(wm);
  }
  // ---- basketball courts: fence and hoops
  {
    fence(g, 261.5, 245, BL.a, [16.8, 20], 4, '#3f8f4f', new THREE.MeshStandardMaterial({ color: '#2f6f3c', roughness: 0.6 }));
    const yellow = new THREE.MeshStandardMaterial({ color: '#e0c23a', roughness: 0.6 }), board = new THREE.MeshStandardMaterial({ color: '#f1f1ee', roughness: 0.5 });
    for (const c of [[252.5, 240.5], [270.5, 250]]) for (const s of [-1, 1]) {
      const x = c[0] + BL.a[0] * s * 13.8, z = c[1] + BL.a[1] * s * 13.8, ang = Math.atan2(BL.a[1], BL.a[0]);
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.25, 3.3, 0.25), yellow); post.position.set(x + BL.a[0] * s * 1.2, 1.65, z + BL.a[1] * s * 1.2); post.castShadow = true; g.add(post);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.18, 0.18), yellow); arm.position.set(x + BL.a[0] * s * 0.6, 3.2, z + BL.a[1] * s * 0.6); arm.rotation.y = -ang; g.add(arm);
      const bd = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.05, 1.8), board); bd.position.set(x, 3.4, z); bd.rotation.y = -ang; g.add(bd);
    }
  }
  // ---- tennis courts: fenced like the basketball courts
  fence(g, 278, 205.5, [0.46, -0.89], [14.5, 17.5], 4, '#3f8f4f', new THREE.MeshStandardMaterial({ color: '#2f6f3c', roughness: 0.6 }));

  // ---- fence behind the roadside trees, closing off the lawn east of the SAC road
  {
    const post = new THREE.MeshStandardMaterial({ color: '#2f6f3c', roughness: 0.6 }), tex = wireTex('#3f8f4f'), pg = new Geo(), H = 1.9;
    const line = SAC_ROAD.map((p, i) => { const a = SAC_ROAD[Math.max(0, i - 1)], b = SAC_ROAD[Math.min(SAC_ROAD.length - 1, i + 1)], l = Math.hypot(b[0] - a[0], b[1] - a[1]); let nx = (b[1] - a[1]) / l, nz = -(b[0] - a[0]) / l; if (nx < 0) { nx = -nx; nz = -nz; } return [p[0] + nx * 9.5, p[1] + nz * 9.5]; });
    line[0] = [line[0][0] - 2, line[0][1] + 6]; line[line.length - 1] = [line[line.length - 1][0] + 2, line[line.length - 1][1] - 6];
    const path = [[line[0][0] + 16, line[0][1] + 8], ...line, [line[line.length - 1][0] + 13, line[line.length - 1][1] + 6]];
    for (let k = 0; k < path.length - 1; k++) {
      const a = path[k], b = path[k + 1], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const t = tex.clone(); t.needsUpdate = true; t.repeat.set(len / 0.5, H / 0.5);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(len, H), new THREE.MeshLambertMaterial({ map: t, transparent: true, alphaTest: 0.35, side: THREE.DoubleSide }));
      m.position.set((a[0] + b[0]) / 2, H / 2 + 0.05, (a[1] + b[1]) / 2); m.rotation.y = -Math.atan2(b[1] - a[1], b[0] - a[0]); g.add(m);
      const n = Math.round(len / 3);
      for (let i = 0; i <= n; i++) pg.box(a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n, 0.08, 0.08, 0, H + 0.1, 0);
      pg.box((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, len, 0.05, H, H + 0.06, Math.atan2(b[1] - a[1], b[0] - a[0]));
    }
    g.add(new THREE.Mesh(pg.build(), post));
  }

  // ---- rows of three stores, facing the road, each on its dirt plot
  for (const SHOPS of SHOP_ROWS) {
    const ang = Math.atan2(-SHOPS.f[0], SHOPS.f[1]);
    const at = (lx, lz) => [SHOPS.c[0] + lx * Math.cos(ang) - lz * Math.sin(ang), SHOPS.c[1] + lx * Math.sin(ang) + lz * Math.cos(ang)];
    const wg = new Geo();
    const wall = new THREE.MeshStandardMaterial({ map: plainTex(SHOPS.wall, 981, 0.06), roughness: 0.9 });
    SHOPS.names.forEach((name, i) => {
      const lx = SHOPS.xs ? SHOPS.xs[i] : (i - 1) * 9, w = SHOPS.widths ? SHOPS.widths[i] : 8.6;
      const dep = SHOPS.depth || 6, hh = SHOPS.h || 3.7, k = hh / 3.7;
      const p = at(lx, -dep / 2); wg.box(p[0], p[1], w, dep, 0, hh, ang, 0.3);
      const r2 = at(lx, -dep / 2 + 0.4); wg.box(r2[0], r2[1], w + 0.4, dep + 1.4, hh, hh + 0.25, ang, 0.3);
      const stp = at(lx, 1.2); wg.box(stp[0], stp[1], w + 0.4, 2.4, 0, 0.14, ang, 0.3);
      const front = new THREE.Mesh(new THREE.PlaneGeometry(w - 1, 2.5 * k), new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.2, map: canvasTex(256, 96, (c) => {
        const gl = c.createLinearGradient(0, 0, 0, 96); gl.addColorStop(0, '#22323b'); gl.addColorStop(1, '#4a6473'); c.fillStyle = gl; c.fillRect(0, 0, 256, 96);
        c.fillStyle = '#d8d4c8'; for (const x of [0, 84, 170, 250]) c.fillRect(x, 0, 6, 96); c.fillRect(0, 0, 256, 5);
        c.fillStyle = '#6a4a34'; c.fillRect(96, 18, 62, 78); c.fillStyle = gl; c.fillRect(102, 24, 50, 50);
      }, { repeat: false }) }));
      const fp = at(lx, 0.03); front.position.set(fp[0], 1.3 * k, fp[1]); front.rotation.y = -ang; g.add(front);
      const board = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.4, 0.8), new THREE.MeshStandardMaterial({ roughness: 0.6, map: signTex([{ text: name, size: w < 7 ? 64 : 88, y: 0.54, color: '#ffffff' }], { w: Math.round(126 * (w - 0.4) / 0.8), h: 126, bg: SHOPS.colors[i] }) }));
      const bp = at(lx, 0.05); board.position.set(bp[0], hh - 0.5, bp[1]); board.rotation.y = -ang; g.add(board);
      const awn = at(lx, 1.1); const aw = new THREE.Mesh(new THREE.BoxGeometry(w - 0.2, 0.08, 2.2), new THREE.MeshStandardMaterial({ color: SHOPS.colors[i], roughness: 0.7 }));
      aw.position.set(awn[0], hh - 1.08, awn[1]); aw.rotation.order = 'YXZ'; aw.rotation.y = -ang; aw.rotation.x = 0.16; aw.castShadow = true; g.add(aw);
    });
    const wm = new THREE.Mesh(wg.build(), wall); wm.castShadow = true; wm.receiveShadow = true; g.add(wm);
  }

  // ---- sunken athletics field: terrain, and the stone retaining wall below the courts
  if (TRACK.poly) {
    const b = TRACK.bb, geo = new Geo(), cols = [], STEP = 1.0;
    const nx = Math.ceil((b[2] - b[0]) / STEP), nz = Math.ceil((b[3] - b[1]) / STEP), idx = new Int32Array((nx + 1) * (nz + 1)).fill(-1);
    const vid = (ix, iz) => {
      const k = iz * (nx + 1) + ix;
      if (idx[k] < 0) {
        const x = b[0] + ix * STEP, z = b[1] + iz * STEP;
        // along the retaining wall the mesh stays at field level and runs under the wall;
        // the campus ground (cut only 0.2 m outward there) carries the court level behind it
        let hy = height(x, z);
        if (!pip(x, z, TRACK.poly)) { const q = nearestOn(x, z, TRACK.poly); if (q.d < 1.2 && walledAt(q)) hy = -TRACK_DEPTH; }
        idx[k] = geo.vert([x, hy, z], [0, 1, 0], x / 4, z / 4);
        // green grass throughout (the field and banks are fully grassed now); slightly darker,
        // lusher patches in the hollows and a drier tint on the crest
        const n = 0.9 + 0.2 * fbm(x / 7, z / 7), patch = fbm(x / 17 + 9, z / 17 + 5), y = hy;
        const dry = Math.max(0, Math.min(1, (y - 0.6) / 1.2)) * 0.25;
        cols.push((0.86 + 0.12 * patch + dry * 0.5) * n, (0.95 + 0.08 * patch) * n, (0.8 + dry * 0.1) * n);
      }
      return idx[k];
    };
    for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) {
      const cx = b[0] + (ix + 0.5) * STEP, cz = b[1] + (iz + 0.5) * STEP;
      if (!pip(cx, cz, TRACK.cut) && distToPoly(cx, cz, TRACK.cut) > 0.9) continue;
      const a = vid(ix, iz), bb2 = vid(ix + 1, iz), c = vid(ix + 1, iz + 1), d = vid(ix, iz + 1);
      geo.i.push(a, d, c, a, c, bb2);
    }
    const bg = geo.build(); bg.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3)); bg.computeVertexNormals();
    const m = new THREE.Mesh(bg, new THREE.MeshStandardMaterial({ map: grassTex(), vertexColors: true, roughness: 1, side: THREE.DoubleSide }));
    m.receiveShadow = true; g.add(m);
    const wg = new Geo(), cap = new Geo(), pts = TRACK.poly;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length];
      const wp = courtSide(p[0], p[1]) || TRACK.walled[i], wq = courtSide(q[0], q[1]) || TRACK.walled[(i + 1) % pts.length];
      if (!wp && !wq) continue;
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      wg.box((p[0] + q[0]) / 2, (p[1] + q[1]) / 2, len + 0.4, 0.7, -TRACK_DEPTH - 0.3, 0.45, Math.atan2(q[1] - p[1], q[0] - p[0]), 1 / 3);
      cap.box((p[0] + q[0]) / 2, (p[1] + q[1]) / 2, len + 0.5, 0.8, 0.45, 0.55, Math.atan2(q[1] - p[1], q[0] - p[0]), 0.4);
    }
    const wm = new THREE.Mesh(wg.build(), new THREE.MeshStandardMaterial({ map: rubbleTex(), roughness: 1 })); wm.castShadow = true; wm.receiveShadow = true; g.add(wm);
    const cm = new THREE.Mesh(cap.build(), new THREE.MeshStandardMaterial({ map: plainTex('#a9a59c', 993, 0.14), roughness: 0.95 })); cm.receiveShadow = true; g.add(cm);
    // goals at both ends of the pitch, on the long axis
    const pitch = TRACK.pitch;
    if (pitch) {
      const pu = pitch.map((q) => tframe(...q)), vMid = (Math.min(...pu.map((q) => q[1])) + Math.max(...pu.map((q) => q[1]))) / 2;
      const u0 = Math.min(...pu.map((q) => q[0])), u1 = Math.max(...pu.map((q) => q[0]));
      const white = new THREE.MeshStandardMaterial({ color: '#f4f4f2', roughness: 0.4 });
      const netM = new THREE.MeshLambertMaterial({ map: (() => { const t = wireTex('#e8e8e8'); t.repeat.set(16, 5); return t; })(), transparent: true, alphaTest: 0.3, side: THREE.DoubleSide });
      for (const [u, dir] of [[u0 + 2, -1], [u1 - 2, 1]]) {
        const at = [TRACK.c[0] + TA[0] * u + TV[0] * vMid, TRACK.c[1] + TA[1] * u + TV[1] * vMid], gg = new THREE.Group();
        for (const t of [-1, 1]) { const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.44, 8), white); post.position.set(0, 1.22, t * 3.66); post.castShadow = true; gg.add(post); }
        const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 7.32, 8), white); bar.rotation.x = Math.PI / 2; bar.position.y = 2.44; bar.castShadow = true; gg.add(bar);
        const back = new THREE.Mesh(new THREE.PlaneGeometry(7.32, 2.6), netM); back.rotation.y = Math.PI / 2; back.position.set(dir * 1.6, 1.15, 0); back.rotation.z = 0; gg.add(back);
        const roofN = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 7.32), netM); roofN.rotation.x = -Math.PI / 2; roofN.position.set(dir * 0.8, 2.42, 0); gg.add(roofN);
        gg.position.set(at[0], -TRACK_DEPTH, at[1]); gg.rotation.y = -Math.atan2(TA[1], TA[0]); g.add(gg);
      }
    }
    // floodlight masts: two along the wall, one by the hall, one by the pool corner, one on the hill
    const steelM = new THREE.MeshStandardMaterial({ color: '#c3c7ca', roughness: 0.45, metalness: 0.7 });
    const headM = new THREE.MeshStandardMaterial({ color: '#dcdcdc', emissive: '#fff4d6', emissiveIntensity: 0 });
    env.nightEmissive.push({ mat: headM, on: 3 });
    for (const [u, v] of [[-30, -50], [40, -48], [-28, 58], [-78, 40], [70, 52]]) {
      const x = TRACK.c[0] + TA[0] * u + TV[0] * v, z = TRACK.c[1] + TA[1] * u + TV[1] * v, y = height(x, z), h = 20;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.3, h, 10), steelM); pole.position.set(x, y + h / 2, z); pole.castShadow = true; g.add(pole);
      const head = new THREE.Group();
      for (let i = -1; i <= 1; i++) for (let j = 0; j < 2; j++) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.45, 0.22), headM); l.position.set(i * 0.62, j * 0.52, 0); head.add(l); }
      const frame = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.08, 0.08), steelM); frame.position.y = -0.3; head.add(frame);
      head.position.set(x, y + h + 0.2, z); head.lookAt(TRACK.c[0], -TRACK_DEPTH, TRACK.c[1]); g.add(head);
    }
  }
  scene.add(g);
  return g;
}
