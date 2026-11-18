import * as THREE from 'three';
import { Geo, pip } from './geo.js';
import { rng, canvasTex, plainTex } from './textures.js';
import { blob, merge, plantMaterials } from './plants.js';
import { groundRects } from './world.js';

// Swimming pool, surveyed from the campus virtual tour and z18 imagery.
// The 25 m, six-lane pool sits on a podium about 0.9 m above the road, enclosed by a cream
// parapet with white pilasters and coping. A single-storey cream changing block spans the
// whole north-north-east end of the deck (starting-block end) with water tanks on its roof;
// its pool face has a white recessed hall in the middle. A planted bed of red earth and small
// shrubs runs along the road side. To the south-south-west, the cricket practice nets are
// staggered tunnels of green netting over turf strips on bare earth.
// The two low buildings north of the pool are single-storey cream service halls, not housing.

const DECK_Y = 0.9, PARAPET = 0.95, DEPTH = 1.45, WATER = 0.12;
const BLOCK_U = 30.0;                       // the changing block starts this far along the pool axis
const SERVICE_IDS = [1393041468, -183];
const POOL = { ok: false };

export function preparePool(data) {
  const pool = data.areas.find((a) => a.kind === 'pool' && Math.hypot(a.pts[0][0] - 386.5, a.pts[0][1] - 367.5) < 15);
  const deck = data.areas.find((a) => a.kind === 'pooldeck');
  if (!pool || !deck) return;
  const [p0, p1, p2] = pool.pts;
  const L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), W = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
  const U = [(p1[0] - p0[0]) / L, (p1[1] - p0[1]) / L];
  const V = [-U[1], U[0]];                  // = (p2 - p1) / W for this outline
  Object.assign(POOL, { ok: true, O: p0, U, V, L, W, deck: deck.pts });
  pool.custom = deck.custom = true;
  groundRects.push({ o: p0, e: U, len: L, wid: W });
  const nets = data.areas.find((a) => a.kind === 'nets' && Math.hypot(a.pts[0][0] - 375, a.pts[0][1] - 378) < 30);
  if (nets) { nets.custom = true; POOL.nets = nets.pts; }
  for (const b of data.buildings) if (SERVICE_IDS.includes(b.id)) { b.kind = 'service'; b.levels = 1; }
}

// ---------------------------------------------------------------- textures
function deckTex() {      // 2.4 m square: 4 x 4 grey vitrified tiles, 0.6 m, with grout
  const r = rng(611);
  return canvasTex(512, 512, (g) => {
    g.fillStyle = '#8f9393'; g.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      const v = 166 + r() * 14;
      g.fillStyle = `rgb(${v},${v + 3},${v + 4})`; g.fillRect(i * 128 + 2, j * 128 + 2, 124, 124);
      for (let k = 0; k < 140; k++) { const s = r() * 30 - 15; g.fillStyle = `rgba(${s > 0 ? 255 : 0},${s > 0 ? 255 : 0},${s > 0 ? 255 : 0},${Math.abs(s) / 300})`; g.fillRect(i * 128 + 2 + r() * 122, j * 128 + 2 + r() * 122, 2 + r() * 4, 2 + r() * 4); }
    }
  });
}
function floorTex(L, W) { // pool floor: aqua mosaic with dark blue lane lines and T-ends (as seen through the water)
  const pxm = 40, w = Math.round(L * pxm), h = Math.round(W * pxm);
  const r = rng(612);
  return canvasTex(w, h, (g) => {
    g.fillStyle = '#1f9fcd'; g.fillRect(0, 0, w, h);
    for (let k = 0; k < 2600; k++) { g.fillStyle = `rgba(${r() < 0.5 ? '255,255,255' : '0,60,90'},${r() * 0.06})`; g.fillRect(r() * w, r() * h, 10, 10); }
    g.strokeStyle = 'rgba(20,80,110,0.22)'; g.lineWidth = 1;
    for (let x = 0; x < w; x += 10) { g.beginPath(); g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, h); g.stroke(); }
    for (let y = 0; y < h; y += 10) { g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(w, y + 0.5); g.stroke(); }
    const margin = (W - 15) / 2;
    g.fillStyle = '#143e86';
    for (let k = 0; k < 6; k++) {
      const y = (margin + 1.25 + 2.5 * k) * pxm;
      g.fillRect(2.0 * pxm, y - 0.13 * pxm, (L - 4.0) * pxm, 0.26 * pxm);
      for (const x of [2.0, L - 2.0]) g.fillRect(x * pxm - 0.13 * pxm, y - 0.5 * pxm, 0.26 * pxm, 1.0 * pxm);
    }
  }, { aniso: 8 });
}
function wallTileTex() {   // basin wall: 1 m wide x 1.6 m tall, dark blue waterline band at the top
  return canvasTex(64, 128, (g) => {
    g.fillStyle = '#2aa8d3'; g.fillRect(0, 0, 64, 128);
    g.strokeStyle = 'rgba(20,80,110,0.3)';
    for (let x = 0; x <= 64; x += 16) { g.beginPath(); g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, 128); g.stroke(); }
    for (let y = 0; y <= 128; y += 16) { g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(64, y + 0.5); g.stroke(); }
    g.fillStyle = '#1b3f86'; g.fillRect(0, 0, 64, 18);
    g.fillStyle = '#e9eef0'; g.fillRect(0, 0, 64, 3);
  });
}
function grateTex() {      // overflow gutter grating: slots across the strip
  return canvasTex(64, 32, (g) => {
    g.fillStyle = '#d3d7d8'; g.fillRect(0, 0, 64, 32);
    g.fillStyle = '#8a9295'; for (let x = 2; x < 64; x += 8) g.fillRect(x, 4, 4, 24);
  });
}
function rippleNormal() {  // tileable normal map from a sum of integer-frequency waves
  const S = 256, r = rng(613);
  const waves = Array.from({ length: 9 }, () => ({ fx: Math.round(r() * 8 - 4) || 1, fz: Math.round(r() * 8 - 4) || 2, ph: r() * 6.28, a: 0.4 + r() }));
  const hgt = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let v = 0;
    for (const w of waves) v += w.a * Math.sin((w.fx * x + w.fz * y) / S * Math.PI * 2 + w.ph) / Math.hypot(w.fx, w.fz);
    hgt[y * S + x] = v;
  }
  return canvasTex(S, S, (g) => {
    const img = g.createImageData(S, S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const dx = hgt[y * S + ((x + 1) % S)] - hgt[y * S + ((x + S - 1) % S)];
      const dy = hgt[((y + 1) % S) * S + x] - hgt[((y + S - 1) % S) * S + x];
      const n = [-dx * 1.6, -dy * 1.6, 1], l = Math.hypot(...n), i = (y * S + x) * 4;
      img.data[i] = (n[0] / l * 0.5 + 0.5) * 255; img.data[i + 1] = (n[1] / l * 0.5 + 0.5) * 255; img.data[i + 2] = (n[2] / l * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }, { srgb: false });
}
function causticTex() {    // soft, tileable caustic network
  const S = 256, T = Math.PI * 2 / S;
  return canvasTex(S, S, (g) => {
    const img = g.createImageData(S, S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const a = Math.sin(3 * x * T + 1.7 * Math.sin(2 * y * T)) + Math.sin(4 * y * T + 1.4 * Math.sin(3 * x * T + 1));
      const b = Math.sin(5 * (x + y) * T + 1.2 * Math.sin(2 * x * T)) * 0.6;
      const v = Math.pow(Math.max(0, 1 - Math.abs(a + b) * 0.9), 5);
      const i = (y * S + x) * 4; img.data[i] = img.data[i + 1] = img.data[i + 2] = v * 255; img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  });
}
function meshTex(color) {  // square netting, 0.25 m
  return canvasTex(32, 32, (g) => { g.clearRect(0, 0, 32, 32); g.fillStyle = color; g.fillRect(0, 0, 32, 3); g.fillRect(0, 0, 3, 32); });
}
// the pool face of the changing block, 26.8 m x 3.6 m above the deck
function blockFacadeTex(v0, v1, H, lowFrom, lowH) {
  const pxm = 48, w = Math.round((v1 - v0) * pxm), h = Math.round(H * pxm), r = rng(614);
  const X = (v) => (v - v0) * pxm, Y = (y) => (H - y) * pxm;
  const rect = (va, vb, ya, yb, c) => { g0.fillStyle = c; g0.fillRect(X(va), Y(yb), (vb - va) * pxm, (yb - ya) * pxm); };
  let g0;
  const door = (va, vb, hh = 2.1) => {
    rect(va - 0.08, vb + 0.08, 0, hh + 0.08, '#c9c3b6'); rect(va, vb, 0, hh, '#f1eee8');
    rect(va + 0.08, vb - 0.08, 1.15, hh - 0.12, '#e6e2da'); rect(vb - 0.22, vb - 0.14, 0.95, 1.05, '#5d6166');
  };
  return canvasTex(w, h, (g) => {
    g0 = g;
    g.clearRect(0, 0, w, h);
    rect(v0, lowFrom, 0, H, '#e7d4ae'); rect(lowFrom, v1, 0, lowH, '#e7d4ae');
    rect(v0, lowFrom, H - 0.08, H, '#efe6d2'); rect(lowFrom, v1, lowH - 0.08, lowH, '#efe6d2');
    // left wing: high band of small windows
    for (let v = -4.1; v < -0.5; v += 0.95) { rect(v - 0.04, v + 0.84, 2.3, 2.76, '#d8d2c4'); rect(v, v + 0.8, 2.34, 2.72, '#3a4146'); rect(v + 0.38, v + 0.42, 2.34, 2.72, '#cfc9bc'); }
    // white recessed hall in the middle
    rect(2.2, 11.8, 0, 2.65, '#f5f3ee');
    rect(2.2, 11.8, 2.55, 2.65, 'rgba(0,0,0,0.12)');
    door(2.45, 3.35);
    rect(3.6, 4.3, 0, 2.05, '#30363b'); rect(3.6, 4.3, 0, 0.6, '#4a4f53');
    rect(5.3, 8.9, 2.12, 2.48, '#33393e'); for (let v = 5.3; v < 8.9; v += 0.3) rect(v, v + 0.04, 2.12, 2.48, '#a7a49c');
    rect(6.2, 6.8, 1.55, 1.9, '#2c55a0'); rect(9.9, 11.2, 1.0, 2.35, '#23468f'); rect(9.95, 11.15, 1.05, 2.3, '#2f5aa8');
    for (let k = 0; k < 9; k++) rect(10.05, 10.05 + 0.4 + r() * 0.6, 2.2 - k * 0.13, 2.25 - k * 0.13, 'rgba(255,255,255,0.55)');
    g.fillStyle = '#2b2b2b'; g.beginPath(); g.arc(X(8.3), Y(1.95), 0.19 * pxm, 0, 6.29); g.fill();
    g.fillStyle = '#f7f7f4'; g.beginPath(); g.arc(X(8.3), Y(1.95), 0.15 * pxm, 0, 6.29); g.fill();
    rect(4.6, 9.4, 0, 0.35, 'rgba(40,60,80,0.18)');   // racks and kit along the back wall
    // right wing: two doors with small blue signs and wall lights
    for (const [a, b] of [[12.1, 13.1], [20.1, 21.1]]) { door(a, b); rect(b + 0.25, b + 0.55, 1.45, 1.65, '#2c55a0'); rect(a + 0.3, a + 0.7, 2.45, 2.55, '#f4f4f0'); }
    rect(15.4, 15.8, 2.4, 2.5, '#f4f4f0');
    // grime and dust
    const gg = g.createLinearGradient(0, 0, 0, h);
    gg.addColorStop(0, 'rgba(70,55,35,0.10)'); gg.addColorStop(0.12, 'rgba(70,55,35,0)'); gg.addColorStop(0.92, 'rgba(70,55,35,0)'); gg.addColorStop(1, 'rgba(70,55,35,0.18)');
    g.globalCompositeOperation = 'source-atop'; g.fillStyle = gg; g.fillRect(0, 0, w, h);
    for (let k = 0; k < w * h / 60; k++) { g.fillStyle = `rgba(${r() < 0.5 ? '255,255,255' : '60,45,30'},${r() * 0.05})`; g.fillRect(r() * w, r() * h, 2, 2); }
    g.globalCompositeOperation = 'source-over';
  }, { aniso: 8 });
}

export function buildPool(scene, height, env) {
  if (!POOL.ok) return null;
  const { O, U, V, L, W } = POOL;
  const g = new THREE.Group();
  const r = rng(615);
  const P = (u, v) => [O[0] + U[0] * u + V[0] * v, O[1] + U[1] * u + V[1] * v];
  const F = (p) => [(p[0] - O[0]) * U[0] + (p[1] - O[1]) * U[1], (p[0] - O[0]) * V[0] + (p[1] - O[1]) * V[1]];
  const ang = Math.atan2(U[1], U[0]);
  const y0 = height(...P(L / 2, W / 2));
  const DY = y0 + DECK_Y;
  const Y = (u, v, y) => { const q = P(u, v); return [q[0], y, q[1]]; };
  const nU = [U[0], 0, U[1]], nV = [V[0], 0, V[1]];
  const neg = (n) => [-n[0], -n[1], -n[2]];
  const add = (geo, mat, shadow = true) => { const m = new THREE.Mesh(geo.build ? geo.build() : geo, mat); m.castShadow = shadow; m.receiveShadow = true; g.add(m); return m; };
  // quad in the pool frame: corners (u,v) at heights, uv given by fn
  const fq = (geo, c, n, uvf) => geo.quad(...c.map((q) => Y(q[0], q[1], q[2])), n, ...c.map(uvf));

  const cream = new THREE.MeshStandardMaterial({ map: plainTex('#e4cfa6', 621, 0.06), roughness: 0.92 });
  const white = new THREE.MeshStandardMaterial({ map: plainTex('#f1eee6', 622, 0.04), roughness: 0.8 });
  const chrome = new THREE.MeshStandardMaterial({ color: '#e4e8ea', roughness: 0.18, metalness: 1 });

  const deckLocal = POOL.deck.map(F);
  // ---- deck: tiled top with the pool cut out, uv in the pool frame
  {
    const geo = new Geo();
    const outer = POOL.deck, hole = [P(0, 0), P(L, 0), P(L, W), P(0, W)];
    const shape = new THREE.Shape(outer.map((p) => new THREE.Vector2(p[0], p[1])));
    shape.holes.push(new THREE.Path(hole.map((p) => new THREE.Vector2(p[0], p[1]))));
    const sg = new THREE.ShapeGeometry(shape);
    const pos = sg.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const [u, v] = F([pos.getX(i), pos.getY(i)]);
      geo.vert([pos.getX(i), DY, pos.getY(i)], [0, 1, 0], u / 2.4, v / 2.4);
    }
    const idx = sg.index.array;
    for (let i = 0; i < idx.length; i += 3) geo.i.push(idx[i], idx[i + 2], idx[i + 1]);
    const t = deckTex();
    add(geo, new THREE.MeshStandardMaterial({ map: t, roughness: 0.62, metalness: 0 }), false);
  }
  // ---- overflow gutter grating round the pool
  {
    const geo = new Geo(), gw = 0.32, y = DY + 0.006;
    const strip = (a, b, c, d, len) => fq(geo, [a, b, c, d].map((q) => [q[0], q[1], y]), [0, 1, 0], (_, i) => [[0, 0], [0, 1], [len / 0.32, 1], [len / 0.32, 0]][i]);
    strip([0, 0], [-gw, -gw], [L + gw, -gw], [L, 0], L);
    strip([L, W], [L + gw, W + gw], [-gw, W + gw], [0, W], L);
    strip([0, W], [-gw, W + gw], [-gw, -gw], [0, 0], W);
    strip([L, 0], [L + gw, -gw], [L + gw, W + gw], [L, W], W);
    add(geo, new THREE.MeshStandardMaterial({ map: grateTex(), roughness: 0.5, metalness: 0.2, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), false);
  }
  // ---- basin walls and floor
  const bottom = DY - DEPTH;
  {
    const geo = new Geo();
    const wall = (a, b, n, len) => fq(geo, [[a[0], a[1], bottom], [a[0], a[1], DY], [b[0], b[1], DY], [b[0], b[1], bottom]], n, (_, i) => [[0, 0], [0, 1], [len, 1], [len, 0]][i]);
    wall([0, 0], [L, 0], nV, L); wall([L, W], [0, W], neg(nV), L); wall([0, W], [0, 0], nU, W); wall([L, 0], [L, W], neg(nU), W);
    const t = wallTileTex(); t.repeat.set(1, 1);
    add(geo, new THREE.MeshStandardMaterial({ map: t, roughness: 0.35, side: THREE.DoubleSide }), false);
    const fg = new Geo();
    fq(fg, [[0, 0, bottom], [0, W, bottom], [L, W, bottom], [L, 0, bottom]], [0, 1, 0], (q) => [q[0] / L, q[1] / W]);
    const caustic = causticTex(); caustic.repeat.set(L / 3.2, W / 3.2);
    const fm = new THREE.MeshStandardMaterial({ map: floorTex(L, W), roughness: 0.4, emissive: '#bff4ff', emissiveMap: caustic, emissiveIntensity: 0.38 });
    // caustics use the second uv set scaled independently of the lane map
    fm.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>',
        '#ifdef USE_EMISSIVEMAP\n  vec4 emissiveColor = texture2D( emissiveMap, vEmissiveMapUv );\n  emissiveColor.rgb *= texture2D( emissiveMap, vEmissiveMapUv * 0.73 + vec2(0.31, 0.17) ).rgb * 1.6 + 0.15;\n  totalEmissiveRadiance *= emissiveColor.rgb;\n#endif');
    };
    const floor = add(fg, fm, false);
    floor.onBeforeRender = () => { const t = performance.now() / 1000; caustic.offset.set(Math.sin(t * 0.21) * 0.08 + t * 0.012, Math.cos(t * 0.17) * 0.08); };
  }
  // ---- water surface: thin tint with rippled reflections of the sky
  {
    const geo = new Geo(), wy = DY - WATER;
    fq(geo, [[0, 0, wy], [0, W, wy], [L, W, wy], [L, 0, wy]], [0, 1, 0], (q) => [q[0] / 3.5, q[1] / 3.5]);
    const nm = rippleNormal();
    const wm = new THREE.MeshPhysicalMaterial({ color: '#2fb2dc', roughness: 0.03, metalness: 0, transparent: true, opacity: 0.5, normalMap: nm, normalScale: new THREE.Vector2(0.28, 0.28), envMapIntensity: 1.3, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const water = add(geo, wm, false); water.renderOrder = 6;
    water.onBeforeRender = () => { const t = performance.now() / 1000; nm.offset.set(t * 0.018, t * 0.011); };
  }
  // ---- lane rope, starting blocks, ladders, lifeguard chair
  {
    const margin = (W - 15) / 2;
    const ropeTex = canvasTex(256, 8, (gc) => {
      for (let i = 0; i < 64; i++) { gc.fillStyle = i < 12 || i >= 52 ? (i % 2 ? '#c8202a' : '#e8e4dc') : (i % 2 ? '#2a3c9a' : '#3a58c8'); gc.fillRect(i * 4, 0, 4, 8); }
    }, { repeat: false });
    const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, L, 8, 1, true), new THREE.MeshStandardMaterial({ map: ropeTex, roughness: 0.5 }));
    const rp = P(L / 2, margin + 2.5 * 2);
    rope.rotation.order = 'YXZ'; rope.rotation.y = -ang; rope.rotation.z = Math.PI / 2;
    rope.position.set(rp[0], DY - WATER + 0.03, rp[1]); g.add(rope);
    // starting blocks
    const sb = new Geo(), top = new Geo();
    for (let k = 0; k < 6; k++) {
      const v = margin + 1.25 + 2.5 * k, c = P(L + 0.42, v);
      sb.box(c[0], c[1], 0.12, 0.12, DY, DY + 0.62, ang);
      const t = P(L + 0.3, v); top.box(t[0], t[1], 0.55, 0.52, DY + 0.6, DY + 0.7, ang);
    }
    add(sb, new THREE.MeshStandardMaterial({ color: '#5f676c', roughness: 0.5, metalness: 0.5 }));
    add(top, new THREE.MeshStandardMaterial({ color: '#2fb3ad', roughness: 0.6 }));
    // ladders: two rails curving over the coping into the water
    const rail = (u, v, out, along) => {
      for (const s of [-0.27, 0.27]) {
        const pt = (o, y) => { const q = P(u + along[0] * s + out[0] * o, v + along[1] * s + out[1] * o); return new THREE.Vector3(q[0], y, q[1]); };
        const curve = new THREE.CatmullRomCurve3([pt(0.62, DY), pt(0.55, DY + 0.7), pt(0.38, DY + 0.95), pt(0.1, DY + 0.82), pt(-0.12, DY + 0.3), pt(-0.14, DY - 1.0)]);
        const m = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.024, 6), chrome); m.castShadow = true; g.add(m);
      }
    };
    rail(L, 1.1, [1, 0], [0, 1]); rail(L, W - 1.1, [1, 0], [0, 1]); rail(0, 1.1, [-1, 0], [0, 1]); rail(0, W - 1.1, [-1, 0], [0, 1]);
    // lifeguard chair (white steel frame) on the road side of the deck
    const ch = new Geo(), c = (u, v) => P(L - 4 + u, -2.7 + v);
    for (const [u, v] of [[-0.45, -0.35], [0.45, -0.35], [-0.45, 0.35], [0.45, 0.35]]) { const q = c(u, v); ch.box(q[0], q[1], 0.06, 0.06, DY, DY + 1.95, ang); }
    for (let k = 1; k <= 4; k++) { const q = c(0, 0.35); ch.box(q[0], q[1], 0.9, 0.05, DY + k * 0.36, DY + k * 0.36 + 0.04, ang); }
    { const q = c(0, -0.1); ch.box(q[0], q[1], 0.95, 0.55, DY + 1.6, DY + 1.66, ang); const b = c(0, -0.38); ch.box(b[0], b[1], 0.95, 0.05, DY + 1.66, DY + 2.15, ang); }
    add(ch, white);
  }
  // ---- parapet: cream panels between white pilasters, white coping; it is also the podium face
  const pieces = [];
  {
    const n = deckLocal.length;
    for (let i = 0; i < n; i++) {
      let a = deckLocal[i], b = deckLocal[(i + 1) % n];
      if (a[0] > BLOCK_U + 0.1 && b[0] > BLOCK_U + 0.1) continue;
      if (a[0] > BLOCK_U + 0.1 || b[0] > BLOCK_U + 0.1) {
        const t = (BLOCK_U - a[0]) / (b[0] - a[0]), q = [BLOCK_U, a[1] + (b[1] - a[1]) * t];
        if (a[0] > BLOCK_U + 0.1) a = q; else b = q;
      }
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) > 0.3) pieces.push([a, b]);
    }
    const wg = new Geo(), pg = new Geo();
    const top = DY + PARAPET, base = y0 - 0.3;
    for (const [a, b] of pieces) {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const du = (b[0] - a[0]) / len, dv = (b[1] - a[1]) / len;
      // inward = towards the pool centre
      let iu = -dv, iv = du; const mu = (a[0] + b[0]) / 2 - L / 2, mv = (a[1] + b[1]) / 2 - W / 2;
      if (iu * mu + iv * mv > 0) { iu = -iu; iv = -iv; }
      const off = (u, v, d) => [u + iu * d, v + iv * d];
      const ca = off(a[0], a[1], 0.11), cb = off(b[0], b[1], 0.11);
      const mid = P((ca[0] + cb[0]) / 2, (ca[1] + cb[1]) / 2);
      const wa = Math.atan2(...(() => { const pa = P(...ca), pb = P(...cb); return [pb[1] - pa[1], pb[0] - pa[0]]; })());
      wg.box(mid[0], mid[1], len, 0.22, base, top, wa, 0.5);
      pg.box(mid[0], mid[1], len + 0.1, 0.32, top, top + 0.07, wa, 0.5);
      const np = Math.max(1, Math.round(len / 3.3));
      for (let k = 0; k <= np; k++) {
        const q = P(ca[0] + (cb[0] - ca[0]) * k / np, ca[1] + (cb[1] - ca[1]) * k / np);
        pg.box(q[0], q[1], 0.34, 0.34, base, top + 0.06, wa, 0.5);
      }
    }
    add(wg, cream); add(pg, white);
  }
  // ---- changing block across the NNE end: taller left part and hall, lower right wing
  const vMin = Math.min(...deckLocal.map((p) => p[1])) + 0.02, vMax = Math.max(...deckLocal.map((p) => p[1])) - 0.02;
  const uMax = Math.max(...deckLocal.map((p) => p[0])) - 0.02;
  const LOW_V = 11.8, HI = 3.6, LO = 3.1;
  {
    const bg = new Geo(), roof = new Geo();
    const boxF = (geo, u0, u1, v0, v1, ya, yb) => { const c = P((u0 + u1) / 2, (v0 + v1) / 2); geo.box(c[0], c[1], u1 - u0, v1 - v0, ya, yb, ang, 0.25); };
    boxF(bg, BLOCK_U, uMax, vMin, LOW_V, y0 - 0.3, DY + HI);
    boxF(bg, BLOCK_U, uMax, LOW_V, vMax, y0 - 0.3, DY + LO);
    boxF(roof, BLOCK_U + 0.25, uMax - 0.25, vMin + 0.25, LOW_V - 0.1, DY + HI, DY + HI + 0.03);
    boxF(roof, BLOCK_U + 0.25, uMax - 0.25, LOW_V + 0.1, vMax - 0.25, DY + LO, DY + LO + 0.03);
    add(bg, cream); add(roof, new THREE.MeshStandardMaterial({ map: plainTex('#77746e', 623, 0.12), roughness: 0.95 }));
    // pool face
    const fg = new Geo(), u = BLOCK_U - 0.015, H = HI;
    fq(fg, [[u, vMin, DY], [u, vMin, DY + H], [u, vMax, DY + H], [u, vMax, DY]], neg(nU), (q) => [(q[1] - vMin) / (vMax - vMin), (q[2] - DY) / H]);
    add(fg, new THREE.MeshStandardMaterial({ map: blockFacadeTex(vMin, vMax, H, LOW_V, LO), roughness: 0.9, alphaTest: 0.5, side: THREE.DoubleSide }), false);
    // entrance door and steps on the road side
    const dg = new Geo(), du0 = 33.4, du1 = 35.2, dv = vMin - 0.015;
    fq(dg, [[du0, dv, DY], [du0, dv, DY + 2.15], [du1, dv, DY + 2.15], [du1, dv, DY]], neg(nV), (q, i) => [[0, 0], [0, 1], [1, 1], [1, 0]][i]);
    add(dg, new THREE.MeshStandardMaterial({ map: canvasTex(64, 80, (gc) => { gc.fillStyle = '#d2ccbf'; gc.fillRect(0, 0, 64, 80); gc.fillStyle = '#e9e5dd'; gc.fillRect(4, 4, 27, 76); gc.fillRect(33, 4, 27, 76); gc.fillStyle = '#6b6f73'; gc.fillRect(27, 38, 2, 8); gc.fillRect(35, 38, 2, 8); }), roughness: 0.8, side: THREE.DoubleSide }), false);
    const st = new Geo(), steps = 6, rise = DECK_Y / steps;
    for (let k = 0; k < steps; k++) {
      const c = P((du0 + du1) / 2, vMin - (steps - k) * 0.3 + 0.15);
      st.box(c[0], c[1], 3.2, 0.3, y0 - 0.2, y0 + rise * (k + 1), ang, 0.5);
    }
    add(st, new THREE.MeshStandardMaterial({ map: plainTex('#a9a6a0', 624, 0.12), roughness: 0.9 }));
    // white and blue water tanks, vent pipes
    const tank = new THREE.CylinderGeometry(0.62, 0.66, 1.15, 16);
    const tm = new THREE.MeshStandardMaterial({ color: '#dfe7ec', roughness: 0.55 });
    const lid = new THREE.MeshStandardMaterial({ color: '#2f6fbf', roughness: 0.5 });
    for (const v of [1.3, 2.7, 4.1, 5.5]) {
      const q = P(33.6, v);
      const m = new THREE.Mesh(tank, tm); m.position.set(q[0], DY + HI + 0.6, q[1]); m.castShadow = true; g.add(m);
      const l = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.42, 0.18, 12), lid); l.position.set(q[0], DY + HI + 1.24, q[1]); g.add(l);
    }
    for (const [uu, v, hh] of [[31.0, -1.8, 2.2], [31.0, 0.2, 1.6], [36.5, 8.6, 1.3]]) {
      const q = P(uu, v), m = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, hh, 6), chrome); m.position.set(q[0], DY + HI + hh / 2, q[1]); g.add(m);
    }
  }
  // ---- planted bed of red earth with small clipped shrubs along the road side
  {
    const bed = new Geo(), bw = 1.3;
    const west = pieces.filter(([a, b]) => Math.abs(b[1] - a[1]) < 1.5 && Math.min(a[1], b[1]) < 0);
    for (const [a, b] of west) {
      const ua = Math.min(a[0], b[0]) + 0.3, ub = Math.max(a[0], b[0]) - 0.3;
      const va = Math.min(a[1], b[1]);
      fq(bed, [[ua, va - bw, y0 + 0.05], [ua, va, y0 + 0.05], [ub, va, y0 + 0.05], [ub, va - bw, y0 + 0.05]], [0, 1, 0], (q) => [q[0] / 2, q[1] / 2]);
      const list = [];
      for (let u = ua + 1.2; u < ub - 0.5; u += 2.6 + r() * 0.8) list.push([u, va - bw / 2]);
      const shrub = merge([{ geo: blob(1, 2, 0.8, 5, '#ffffff', '#8a8a8a', 0.35), up: 0.8, uvWorld: true }]);
      const im = new THREE.InstancedMesh(shrub, plantMaterials().solid, list.length);
      const d = new THREE.Object3D(), col = new THREE.Color();
      list.forEach(([u, v], i) => { const q = P(u, v); const s = 0.38 + r() * 0.14; d.position.set(q[0], y0 + 0.05 + s * 0.7, q[1]); d.rotation.set(0, r() * 6, 0); d.scale.setScalar(s); d.updateMatrix(); im.setMatrixAt(i, d.matrix); im.setColorAt(i, col.set(r() < 0.5 ? '#5f8c3a' : '#4b7a33')); });
      im.castShadow = true; g.add(im);
    }
    add(bed, new THREE.MeshStandardMaterial({ map: plainTex('#93513a', 625, 0.14), roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), false);
  }
  // ---- cricket practice nets: staggered tunnels of green netting over turf strips
  if (POOL.nets) buildNets(g, POOL.nets, height, r);
  scene.add(g);
  return g;
}

function buildNets(g, pts, height, r) {
  // lanes run parallel to the polygon's long western edge
  const a = pts[0], b = pts[pts.length - 1];
  const lenAB = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const D = [(b[0] - a[0]) / lenAB, (b[1] - a[1]) / lenAB];
  let N = [-D[1], D[0]];
  const far = pts[Math.floor(pts.length / 2)];
  if ((far[0] - a[0]) * N[0] + (far[1] - a[1]) * N[1] < 0) N = [-N[0], -N[1]];
  const across = Math.max(...pts.map((p) => (p[0] - a[0]) * N[0] + (p[1] - a[1]) * N[1]));
  const lanes = Math.max(1, Math.round(across / 3.1)), lw = across / lanes;
  const Q = (t, s) => [a[0] + D[0] * t + N[0] * s, a[1] + D[1] * t + N[1] * s];
  const dang = Math.atan2(D[1], D[0]);
  const net = new Geo(), posts = new Geo(), turf = new Geo(), dirt = new Geo();
  const H = 3.3, y0 = height(...Q(10, across / 2));
  const Y = (t, s, y) => { const q = Q(t, s); return [q[0], y0 + y, q[1]]; };
  const quad = (geo, c, n, uvs) => geo.quad(...c.map((q) => Y(...q)), n, ...uvs);
  const ext = [];
  for (let k = 0; k < lanes; k++) {
    const s = (k + 0.5) * lw;
    let t0 = null, t1 = null;
    for (let t = -10; t < 60; t += 0.25) { const q = Q(t, s); if (pip(q[0], q[1], pts)) { if (t0 == null) t0 = t; t1 = t; } }
    if (t0 == null) { ext.push(null); continue; }
    t0 += 0.3; t1 -= 0.3; ext.push([t0, t1]);
    const s0 = k * lw + 0.08, s1 = (k + 1) * lw - 0.08, len = t1 - t0;
    quad(dirt, [[t0, s0, 0.03], [t0, s1, 0.03], [t1, s1, 0.03], [t1, s0, 0.03]], [0, 1, 0], [[0, 0], [0, 1], [len / 4, 1], [len / 4, 0]]);
    const sc = (s0 + s1) / 2;
    quad(turf, [[t0 + 1.5, sc - 0.95, 0.05], [t0 + 1.5, sc + 0.95, 0.05], [t1 - 0.6, sc + 0.95, 0.05], [t1 - 0.6, sc - 0.95, 0.05]], [0, 1, 0], [[0, 0], [0, 1], [len / 4, 1], [len / 4, 0]]);
    // roof netting
    quad(net, [[t0, k * lw, H], [t0, (k + 1) * lw, H], [t1, (k + 1) * lw, H], [t1, k * lw, H]], [0, 1, 0], [[0, 0], [0, lw * 4], [len * 4, lw * 4], [len * 4, 0]]);
    // back netting at the batting end
    quad(net, [[t1, k * lw, 0], [t1, k * lw, H], [t1, (k + 1) * lw, H], [t1, (k + 1) * lw, 0]], [D[0], 0, D[1]], [[0, 0], [0, H * 4], [lw * 4, H * 4], [lw * 4, 0]]);
  }
  // side walls on every lane boundary, spanning the union of the neighbouring lanes
  for (let k = 0; k <= lanes; k++) {
    const e = [ext[k - 1], ext[k]].filter(Boolean);
    if (!e.length) continue;
    const t0 = Math.min(...e.map((q) => q[0])), t1 = Math.max(...e.map((q) => q[1])), s = k * lw, len = t1 - t0;
    quad(net, [[t0, s, 0], [t0, s, H], [t1, s, H], [t1, s, 0]], [N[0], 0, N[1]], [[0, 0], [0, H * 4], [len * 4, H * 4], [len * 4, 0]]);
    const np = Math.max(1, Math.round(len / 4));
    for (let i = 0; i <= np; i++) { const q = Q(t0 + (len * i) / np, s); posts.box(q[0], q[1], 0.07, 0.07, y0, y0 + H + 0.05, dang); }
    const q = Q((t0 + t1) / 2, s); posts.box(q[0], q[1], len, 0.05, y0 + H - 0.04, y0 + H + 0.02, dang);
  }
  const add = (geo, mat, cast = true) => { const m = new THREE.Mesh(geo.build(), mat); m.castShadow = cast; m.receiveShadow = true; g.add(m); };
  add(dirt, new THREE.MeshStandardMaterial({ map: plainTex('#b38f69', 631, 0.12), roughness: 1, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), false);
  add(turf, new THREE.MeshStandardMaterial({ map: plainTex('#4f6142', 632, 0.1), roughness: 0.95, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }), false);
  add(posts, new THREE.MeshStandardMaterial({ color: '#8d9497', roughness: 0.5, metalness: 0.5 }));
  add(net, new THREE.MeshLambertMaterial({ map: meshTex('#2f6b3a'), transparent: true, alphaTest: 0.2, side: THREE.DoubleSide }));
}
