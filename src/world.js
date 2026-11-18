import { marineReserved } from './marine-drive-layout.js';
import { groundMaterial } from './ground-detail.js';
import { surfaceMaterial } from './surfaces.js';
import * as THREE from 'three';
import { Geo, polyArea, centroid, pip, bbox, distToPoly, addFlatPoly, addRibbon } from './geo.js';
import { rng, noiseTex, roadTex, kerbTex, paverTex, plainTex, grassTex, courtTex, signTex, canvasTex } from './textures.js';

// ------------------------------------------------------------------ terrain
function hash2(ix, iz) {
  let h = (ix * 374761393 + iz * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  return (hash2(ix, iz) * (1 - sx) + hash2(ix + 1, iz) * sx) * (1 - sz) + (hash2(ix, iz + 1) * (1 - sx) + hash2(ix + 1, iz + 1) * sx) * sz;
}
export function fbm(x, z) {
  return vnoise(x, z) * 0.55 + vnoise(x * 2.1 + 5, z * 2.1 + 9) * 0.28 + vnoise(x * 4.3 + 11, z * 4.3 + 3) * 0.17;
}

export const heightMods = [];      // local terrain edits inside the campus (e.g. the sunken rock garden)
export const groundRects = [];     // extra oriented-rectangle cut-outs in the terrain ({ o, e, len, wid }), e.g. the pool basin
export function makeHeight(boundary) {
  const bb = bbox(boundary);
  return function height(x, z, raw = false) {
    let d;
    if (x > bb[0] && x < bb[2] && z > bb[1] && z < bb[3] && pip(x, z, boundary)) {
      if (raw) return 0;
      let h = 0; for (const f of heightMods) h += f(x, z);
      return h;
    }
    d = distToPoly(x, z, boundary);
    if (d < 160) return 0;
    const s = Math.min(1, (d - 160) / 700);
    const k = s * s * (3 - 2 * s);
    const hills = fbm(x / 800, z / 800) * 46 + fbm(x / 230 + 7, z / 230 + 2) * 9 - 12;
    const far = Math.max(0, (Math.hypot(x, z) - 2200) / 1500);
    return k * Math.max(-2, hills) + far * far * 60 * fbm(x / 600 + 3, z / 600);
  };
}

export function buildGround(data, scene, height, hole, rect, hole2, rect2) {
  const size = 9000, seg = 300;
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, height(pos.getX(i), pos.getZ(i), true));
  geo.computeVertexNormals();
  const ground = new THREE.TextureLoader().load('ground.jpg');
  ground.colorSpace = THREE.SRGBColorSpace; ground.anisotropy = 8;
  const detail = noiseTex(512, 4);
  const mat = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, color: '#ffffff' });
  const e = data.extent;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uGround = { value: ground };
    sh.uniforms.uDetail = { value: detail };
    sh.uniforms.uExt = { value: new THREE.Vector4(e[0], e[1], e[2], e[3]) };
    const hp = (hole || []).slice(0, 40), hb = hp.length ? bbox(hp) : [0, 0, 0, 0];
    sh.uniforms.uHole = { value: Array.from({ length: 40 }, (_, i) => new THREE.Vector2(...(hp[i] || [0, 0]))) };
    sh.uniforms.uHoleN = { value: hp.length };
    const hq = (hole2 || []).slice(0, 48), hqb = hq.length ? bbox(hq) : [0, 0, 0, 0];
    sh.uniforms.uHole2 = { value: Array.from({ length: 48 }, (_, i) => new THREE.Vector2(...(hq[i] || [0, 0]))) };
    sh.uniforms.uHole2N = { value: hq.length };
    sh.uniforms.uHB2 = { value: new THREE.Vector4(...hqb) };
    // a second, rectangular cut-out (origin, unit long axis, length and width)
    sh.uniforms.uRectO = { value: new THREE.Vector2(...(rect ? rect.o : [0, 0])) };
    sh.uniforms.uRectE = { value: new THREE.Vector2(...(rect ? rect.e : [1, 0])) };
    sh.uniforms.uRectS = { value: new THREE.Vector2(rect ? rect.len : 0, rect ? rect.wid : 0) };
    sh.uniforms.uRect2O = { value: new THREE.Vector2(...(rect2 ? rect2.o : [0, 0])) };
    sh.uniforms.uRect2E = { value: new THREE.Vector2(...(rect2 ? rect2.e : [1, 0])) };
    sh.uniforms.uRect2S = { value: new THREE.Vector2(rect2 ? rect2.len : 0, rect2 ? rect2.wid : 0) };
    sh.uniforms.uHB = { value: new THREE.Vector4(...hb) };
    const xr = groundRects.slice(0, 4);
    sh.uniforms.uXRect = { value: Array.from({ length: 4 }, (_, i) => xr[i] ? new THREE.Vector4(xr[i].o[0], xr[i].o[1], xr[i].e[0], xr[i].e[1]) : new THREE.Vector4()) };
    sh.uniforms.uXRectS = { value: Array.from({ length: 4 }, (_, i) => new THREE.Vector2(xr[i] ? xr[i].len : 0, xr[i] ? xr[i].wid : 0)) };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWp;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vWp; uniform sampler2D uGround; uniform sampler2D uDetail; uniform vec4 uExt;
      uniform vec2 uHole[40]; uniform int uHoleN; uniform vec4 uHB; uniform vec2 uRectO; uniform vec2 uRectE; uniform vec2 uRectS; uniform vec2 uRect2O; uniform vec2 uRect2E; uniform vec2 uRect2S; uniform vec2 uHole2[48]; uniform int uHole2N; uniform vec4 uHB2; uniform vec4 uXRect[4]; uniform vec2 uXRectS[4];`)
      .replace('#include <map_fragment>', `
      for (int i = 0; i < 4; i++) {
        if (uXRectS[i].x <= 0.0) continue;
        vec2 xp = vWp.xz - uXRect[i].xy; float xs = dot(xp, uXRect[i].zw); float xv = dot(xp, vec2(-uXRect[i].w, uXRect[i].z));
        if (xs > 0.0 && xs < uXRectS[i].x && xv > 0.0 && xv < uXRectS[i].y) discard;
      }
      if (uHole2N > 2 && vWp.x > uHB2.x && vWp.x < uHB2.z && vWp.z > uHB2.y && vWp.z < uHB2.w) {
        bool in2 = false;
        for (int i = 0; i < 48; i++) {
          if (i >= uHole2N) break;
          vec2 a = uHole2[i]; vec2 b = uHole2[(i + 1 == uHole2N) ? 0 : i + 1];
          if (((a.y > vWp.z) != (b.y > vWp.z)) && (vWp.x < (b.x - a.x) * (vWp.z - a.y) / (b.y - a.y) + a.x)) in2 = !in2;
        }
        if (in2) discard;
      }
      if (uRect2S.x > 0.0) {
        vec2 rp2 = vWp.xz - uRect2O; float rs2 = dot(rp2, uRect2E); float rv2 = dot(rp2, vec2(-uRect2E.y, uRect2E.x));
        if (rs2 > 0.0 && rs2 < uRect2S.x && rv2 > 0.0 && rv2 < uRect2S.y) discard;
      }
      if (uRectS.x > 0.0) {
        vec2 rp = vWp.xz - uRectO; float rs = dot(rp, uRectE); float rv = dot(rp, vec2(-uRectE.y, uRectE.x));
        if (rs > 0.0 && rs < uRectS.x && rv > 0.0 && rv < uRectS.y) discard;
      }
      if (uHoleN > 2 && vWp.x > uHB.x && vWp.x < uHB.z && vWp.z > uHB.y && vWp.z < uHB.w) {
        bool ins = false;
        for (int i = 0; i < 40; i++) {
          if (i >= uHoleN) break;
          vec2 a = uHole[i]; vec2 b = uHole[(i + 1 == uHoleN) ? 0 : i + 1];
          if (((a.y > vWp.z) != (b.y > vWp.z)) && (vWp.x < (b.x - a.x) * (vWp.z - a.y) / (b.y - a.y) + a.x)) ins = !ins;
        }
        if (ins) discard;
      }
      vec2 guv = (vWp.xz - uExt.xy) / (uExt.zw - uExt.xy);
      vec3 gc = texture2D(uGround, vec2(guv.x, 1.0 - guv.y)).rgb;
      float ed = smoothstep(0.0, 0.05, guv.x) * smoothstep(1.0, 0.95, guv.x) * smoothstep(0.0, 0.05, guv.y) * smoothstep(1.0, 0.95, guv.y);
      vec3 d1 = texture2D(uDetail, vWp.xz / 6.0).rgb;
      vec3 d2 = texture2D(uDetail, vWp.xz / 47.0).rgb;
      vec3 d3 = texture2D(uDetail, vWp.xz / 610.0).rgb;
      vec3 d4 = texture2D(uDetail, vWp.xz / 2300.0 + 0.37).rgb;
      vec3 farc = mix(vec3(0.115, 0.165, 0.062), vec3(0.36, 0.25, 0.13), smoothstep(0.38, 0.62, d3.g * 0.6 + d4.r * 0.4));
      vec3 c = mix(farc, gc, ed);
      float dist = length(vWp.xz - cameraPosition.xz);
      float nearF = 1.0 - smoothstep(60.0, 260.0, dist);
      c *= mix(1.0, 0.62 + 0.8 * d1.r, nearF) * (0.82 + 0.36 * d2.g);
      diffuseColor.rgb = c;`);
  };
  groundMaterial(mat, true);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}

// -------------------------------------------------------------------- roads
// Split a polyline into the runs that stay outside `cut`, ending each run exactly at the crossing.
function clipRuns(pts, cut) {
  const runs = []; let run = [];
  const edge = (a, b) => {           // a kept, b cut: binary search for the boundary
    let lo = 0, hi = 1;
    for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (cut([a[0] + (b[0] - a[0]) * m, a[1] + (b[1] - a[1]) * m])) hi = m; else lo = m; }
    return [a[0] + (b[0] - a[0]) * lo, a[1] + (b[1] - a[1]) * lo];
  };
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], c = cut(p), q = pts[i - 1];
    if (!c) { if (!run.length && q && cut(q)) run.push(edge(p, q)); run.push(p); }
    else if (run.length) { run.push(edge(q, p)); runs.push(run); run = []; }
  }
  if (run.length > 1) runs.push(run);
  return runs.filter((r) => r.length > 1);
}

export function buildRoads(data, scene, height) {
  const layers = {
    kerb: { geo: new Geo(), y: 0.035, mat: surfaceMaterial('pavers', '#a66b55') },
    foot: { geo: new Geo(), y: 0.05, mat: surfaceMaterial('pavers', '#ad9275') },
    path: { geo: new Geo(), y: 0.03, mat: new THREE.MeshStandardMaterial({ map: plainTex('#a98a63', 51, 0.1), roughness: 1 }) },
    main: { geo: new Geo(), y: 0.085, mat: surfaceMaterial('asphalt', '#4d4b47') },
    service: { geo: new Geo(), y: 0.07, mat: surfaceMaterial('asphalt', '#4d4b47') },
  };
  const yf = (off) => (x, z) => { const h = height(x, z); return h + off + (h > 0.01 ? 0.35 : 0); };
  const inside = (p) => pip(p[0], p[1], data.boundary);
  const carriage = [];          // campus carriageways that get raised kerbs
  // Campus service roads and paths stop at the gate line; outside it the apron below takes over,
  // so no paving or kerb shows on the road side of the gate.
  const beforeGate = (p) => { const [u, v] = gateLocal(p[0], p[1]); return v < APRON_V && v > -40 && Math.abs(u) < 40; };
  const pieces = [];
  for (const r of data.roads) {
    const all = r.closed ? r.pts.slice(0, -1) : r.pts;
    if (r.kind === 'road' || r.kind === 'main' || !all.some(beforeGate)) { pieces.push({ r, pts: all, closed: r.closed, full: r.pts }); continue; }
    for (const run of clipRuns(r.closed ? r.pts : all, beforeGate)) pieces.push({ r, pts: run, closed: false, full: run });
  }
  for (const { r, pts, closed, full } of pieces) {
    const opt = { closed, vScale: 1 / 8 };
    if (pts.length < 2 || r.garden) continue;
    if (r.kind === 'foot') addRibbon(layers.foot.geo, pts, r.w, yf(layers.foot.y), { ...opt, vScale: 1 / 1.6, uRep: r.w / 1.6 });
    else if (r.kind === 'path' || r.kind === 'track') addRibbon(layers.path.geo, pts, r.w, yf(layers.path.y), { ...opt, vScale: 1 / 6 });
    else {
      const w = r.kind === 'service' ? 5.6 : r.w;
      const mid = pts[pts.length >> 1];
      if (!inside(mid) && r.kind !== 'main' && Math.hypot(mid[0] - GATE.x, mid[1] - GATE.z) > 90 && distToPoly(mid[0], mid[1], data.boundary) > 40) { addRibbon(layers.path.geo, pts, 4, yf(layers.path.y), { ...opt, vScale: 1 / 6 }); continue; }
      if (inside(mid)) { addRibbon(layers.kerb.geo, pts, w + 4.4, yf(layers.kerb.y), { ...opt, vScale: 1 / 1.6, uRep: (w + 4.4) / 1.6 }); carriage.push({ pts: full, hw: w / 2 }); }
      addRibbon((r.kind === 'service' ? layers.service : layers.main).geo, pts, w, yf(r.kind === 'service' ? layers.service.y : layers.main.y), opt);
    }
  }
  {
    const h = height(GATE.x, GATE.z), y = h + layers.main.y + (h > 0.01 ? 0.35 : 0) + 0.012;
    addFlatPoly(layers.main.geo, APRON.map(([u, v]) => gateWorld(u, v)), [], y, 1 / 8);
    // round off the outside junction, where the two road ribbons meet with square ends
    addFlatPoly(layers.main.geo, Array.from({ length: 12 }, (_, i) => gateWorld(-3.8 + 3.4 * Math.cos(-i * Math.PI / 6), -13.2 + 3.4 * Math.sin(-i * Math.PI / 6))), [], y, 1 / 8);
  }
  const group = new THREE.Group();
  let order = 1;
  for (const k of ['path', 'kerb', 'foot', 'service', 'main']) {
    const L = layers[k];
    L.mat.polygonOffset = true; L.mat.polygonOffsetFactor = -order; L.mat.polygonOffsetUnits = -order * 2;
    const m = new THREE.Mesh(L.geo.build(), L.mat);
    m.receiveShadow = true; m.renderOrder = order++;
    group.add(m);
  }

  // ---- raised yellow/black kerb stones, broken wherever another carriageway joins
  const CELL = 24, grid = new Map();
  carriage.forEach((c, id) => {
    for (let i = 0; i < c.pts.length - 1; i++) {
      const a = c.pts[i], b = c.pts[i + 1];
      const x0 = Math.floor((Math.min(a[0], b[0]) - 6) / CELL), x1 = Math.floor((Math.max(a[0], b[0]) + 6) / CELL);
      const z0 = Math.floor((Math.min(a[1], b[1]) - 6) / CELL), z1 = Math.floor((Math.max(a[1], b[1]) + 6) / CELL);
      for (let gx = x0; gx <= x1; gx++) for (let gz = z0; gz <= z1; gz++) {
        const k = gx + '|' + gz; if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push({ a, b, hw: c.hw, id });
      }
    }
  });
  const blockedBy = (x, z, id) => {
    const list = grid.get(Math.floor(x / CELL) + '|' + Math.floor(z / CELL)); if (!list) return false;
    for (const s of list) {
      if (s.id === id) continue;
      const dx = s.b[0] - s.a[0], dz = s.b[1] - s.a[1], l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - s.a[0]) * dx + (z - s.a[1]) * dz) / l2));
      if (Math.hypot(x - s.a[0] - t * dx, z - s.a[1] - t * dz) < s.hw + 0.45) return true;
    }
    return Math.hypot(x - GATE.x, z - GATE.z) < 17;
  };
  const kg = new Geo();
  const KH = 0.17, KW = 0.3, STEP = 1.2;
  carriage.forEach((c, id) => {
    for (const side of [-1, 1]) {
      let prev = null, dist = 0;
      for (let i = 0; i < c.pts.length - 1; i++) {
        const a = c.pts[i], b = c.pts[i + 1];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]); if (len < 0.01) continue;
        const tx = (b[0] - a[0]) / len, tz = (b[1] - a[1]) / len, nx = -tz * side, nz = tx * side;
        const n = Math.max(1, Math.round(len / STEP));
        for (let j = 0; j <= n; j++) {
          const x = a[0] + tx * (len * j) / n, z = a[1] + tz * (len * j) / n;
          const ix = x + nx * (c.hw + 0.02), iz = z + nz * (c.hw + 0.02), ox = x + nx * (c.hw + 0.02 + KW), oz = z + nz * (c.hw + 0.02 + KW);
          const cur = blockedBy((ix + ox) / 2, (iz + oz) / 2, id) ? null : { ix, iz, ox, oz, nx, nz };
          if (cur && prev && (j > 0 || Math.hypot(cur.ix - prev.ix, cur.iz - prev.iz) < 1.5)) {
            const seg = Math.hypot(cur.ix - prev.ix, cur.iz - prev.iz); if (seg > 0.01) {
              const v0 = dist / 2, v1 = (dist + seg) / 2; dist += seg;
              const A = [prev.ix, 0.06, prev.iz], B = [cur.ix, 0.06, cur.iz], At = [prev.ix, KH, prev.iz], Bt = [cur.ix, KH, cur.iz];
              const Ao = [prev.ox, KH, prev.oz], Bo = [cur.ox, KH, cur.oz], Ag = [prev.ox, 0.03, prev.oz], Bg = [cur.ox, 0.03, cur.oz];
              kg.quad(A, At, Bt, B, [-cur.nx, 0, -cur.nz], [0.1, v0], [0.3, v0], [0.3, v1], [0.1, v1]);
              kg.quad(At, Ao, Bo, Bt, [0, 1, 0], [0.3, v0], [0.7, v0], [0.7, v1], [0.3, v1]);
              kg.quad(Ao, Ag, Bg, Bo, [cur.nx, 0, cur.nz], [0.7, v0], [0.9, v0], [0.9, v1], [0.7, v1]);
            }
          }
          prev = cur;
        }
      }
    }
  });
  const km = new THREE.Mesh(kg.build(), new THREE.MeshStandardMaterial({ map: kerbTex(), roughness: 0.85, side: THREE.DoubleSide }));
  km.castShadow = true; km.receiveShadow = true; group.add(km);
  scene.add(group);
  return group;
}

// -------------------------------------------------------------------- areas
function orientedRect(pts) {
  // for 4-point pitches: returns centre, long axis angle, length, width
  const c = centroid(pts);
  const e1 = [pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]], e2 = [pts[2][0] - pts[1][0], pts[2][1] - pts[1][1]];
  const l1 = Math.hypot(...e1), l2 = Math.hypot(...e2);
  const long = l1 > l2 ? e1 : e2;
  return { c, ang: Math.atan2(long[1], long[0]), len: Math.max(l1, l2), wid: Math.min(l1, l2) };
}

export function buildAreas(data, scene, env, height = () => 0) {
  const group = new THREE.Group();
  const flat = {};
  const F = (key, mat) => { if (!flat[key]) flat[key] = { geo: new Geo(), mat }; return flat[key].geo; };
  const std = (tex, o = {}) => new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1, ...o });
  const mats = {
    lawn: groundMaterial(std(grassTex())),
    asphalt: surfaceMaterial('asphalt', '#64625c', { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
    concrete: surfaceMaterial('concrete', '#bdb9ae', { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
    paver: surfaceMaterial('pavers', '#b6a18a', { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
    clay: std(plainTex('#b3a089', 63, 0.1)),        // the athletics track is pale cinder / murram, not red
    dirt: std(plainTex('#b79468', 64, 0.1)),
    cricket: std(plainTex('#6f8f45', 65, 0.1)),
  };
  const water = new THREE.MeshStandardMaterial({ color: '#3d6a6b', roughness: 0.08, metalness: 0.5, transparent: true, opacity: 0.92, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  const poolWater = new THREE.MeshStandardMaterial({ color: '#2fa6c9', roughness: 0.05, metalness: 0.3, emissive: '#0a3a4a', emissiveIntensity: 0.4, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 });
  const solid = new Geo();           // raised concrete things
  const places = [];
  const posts = [];                  // goal posts & masts: {x,z,h,r}
  const masts = [];

  for (const a of data.areas) {
    const pts = a.pts;
    const c = centroid(pts);
    if (a.name) places.push({ name: a.name, at: [c[0], 10, c[1]] });
    if (a.custom) continue;           // modelled by its own builder (e.g. pool.js)
    switch (a.kind) {
      case 'grass': addFlatPoly(F('lawn', mats.lawn), pts, [], 0.02, 1 / 6); break;
      case 'parking': {
        // site survey: the lot under the red bike shed (~(-150, 42)) is not paved — leave the ground imagery visible
        if (Math.hypot(c[0] + 150.0, c[1] - 41.7) < 20) break;
        addFlatPoly(F('asphalt', mats.asphalt), pts, [], 0.04, 1 / 6); break;
      }
      case 'plaza': if (a.surface === 'dirt') addFlatPoly(F('dirt', mats.dirt), pts, [], 0.035, 1 / 6); else addFlatPoly(F('paver', mats.paver), pts, [], 0.04, 1 / 3); break;
      case 'pooldeck': addFlatPoly(F('concrete', mats.concrete), pts, [], 0.05, 1 / 6); break;
      case 'track': addFlatPoly(F('clay', mats.clay), pts, a.holes || [], height(c[0], c[1]) + 0.03, 1 / 6); break;
      case 'water': {
        const wy = height(c[0], c[1]);
        const g = new Geo(); addFlatPoly(g, pts, [], wy + 0.06, 1 / 8);
        const m = new THREE.Mesh(g.build(), water); m.receiveShadow = true; group.add(m);
        // stone rim
        const rim = new Geo(); addRibbon(rim, pts, 0.9, () => wy + 0.12, { closed: true, vScale: 1 / 2 });
        group.add(new THREE.Mesh(rim.build(), mats.concrete));
        break;
      }
      case 'pool': {
        const g = new Geo(); addFlatPoly(g, pts, [], 0.2, 1 / 8);
        const pm = new THREE.Mesh(g.build(), poolWater); pm.renderOrder = 6; group.add(pm);
        const rim = new Geo(); addRibbon(rim, pts, 1.2, () => 0.24, { closed: true, vScale: 1 / 2 });
        group.add(new THREE.Mesh(rim.build(), mats.concrete));
        break;
      }
      case 'stage': {
        const o = orientedRect(pts);
        solid.box(o.c[0], o.c[1], o.len, o.wid, 0, 0.9, o.ang);
        break;
      }
      case 'bleachers': {
        const o = orientedRect(pts);
        for (let s = 0; s < 5; s++) {
          const off = (s - 2) * (o.wid / 5);
          solid.box(o.c[0] - Math.sin(o.ang) * off, o.c[1] + Math.cos(o.ang) * off, o.len, o.wid / 5, 0, 0.5 + s * 0.5, o.ang);
        }
        break;
      }
      case 'amphi': {
        for (let s = 0; s < 4; s++) {
          const sc = 1 - s * 0.2;
          const ring = pts.map((p) => [c[0] + (p[0] - c[0]) * sc, c[1] + (p[1] - c[1]) * sc]);
          addFlatPoly(solid, ring, [], 1.6 - s * 0.4, 0.2);
          const n = ring.length;
          for (let i = 0; i < n; i++) {
            const p = ring[i], q = ring[(i + 1) % n];
            const dx = q[0] - p[0], dz = q[1] - p[1], l = Math.hypot(dx, dz) || 1;
            solid.quad([p[0], 0, p[1]], [p[0], 1.6 - s * 0.4, p[1]], [q[0], 1.6 - s * 0.4, q[1]], [q[0], 0, q[1]], [dz / l, 0, -dx / l], [0, 0], [0, 0.3], [l / 4, 0.3], [l / 4, 0]);
          }
        }
        break;
      }
      case 'fountain': {
        const r = Math.max(3, Math.sqrt(Math.abs(polyArea(pts)) / Math.PI));
        const basin = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.05, 0.7, 28), mats.concrete);
        basin.position.set(c[0], 0.35, c[1]); basin.castShadow = true; group.add(basin);
        const w = new THREE.Mesh(new THREE.CircleGeometry(r * 0.9, 28), poolWater); w.rotation.x = -Math.PI / 2; w.position.set(c[0], 0.72, c[1]); group.add(w);
        const tier = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.35, r * 0.2, 1.6, 16), mats.concrete); tier.position.set(c[0], 1.2, c[1]); group.add(tier);
        const jet = new THREE.Mesh(new THREE.ConeGeometry(0.35, 3.2, 8), new THREE.MeshBasicMaterial({ color: '#dff3ff', transparent: true, opacity: 0.55 }));
        jet.position.set(c[0], 3.4, c[1]); group.add(jet);
        break;
      }
      case 'substation': {
        const o = orientedRect(pts);
        solid.box(o.c[0], o.c[1], o.len * 0.6, o.wid * 0.6, 0, 2.6, o.ang);
        break;
      }
      case 'shelter': {
        if (Math.hypot(c[0] - GATE.x, c[1] - GATE.z) < 40) break;   // the gate's bus stop (buildGate)
        const o = orientedRect(pts);
        solid.box(o.c[0], o.c[1], o.len, o.wid, 2.5, 2.7, o.ang);
        solid.box(o.c[0], o.c[1], o.len, 0.15, 0, 2.5, o.ang);
        break;
      }
      case 'nets': addFlatPoly(F('lawn', mats.lawn), pts, [], 0.03, 1 / 6); break;
      case 'pitch': {
        const sport = a.sport || 'soccer';
        if (sport.startsWith('cricket')) {
          addFlatPoly(F('cricket', mats.cricket), pts, [], 0.03, 1 / 9);
          const strip = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 22), std(plainTex('#c9b98c', 66, 0.06)));
          strip.rotation.x = -Math.PI / 2; strip.rotation.z = 0.4; strip.position.set(c[0], 0.06, c[1]); group.add(strip);
          break;
        }
        if (pts.length !== 4) { addFlatPoly(F('lawn', mats.lawn), pts, [], height(c[0], c[1]) + 0.03, 1 / 6); break; }   // follows sunken fields
        const o = orientedRect(pts);
        const m = new THREE.Mesh(new THREE.PlaneGeometry(o.wid, o.len), std(courtTex(sport, a.name || ''), { polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
        m.rotation.order = 'YXZ';
        m.rotation.y = -o.ang + Math.PI / 2; m.rotation.x = -Math.PI / 2;
        m.position.set(o.c[0], 0.045, o.c[1]); m.receiveShadow = true; group.add(m);
        const ax = [Math.cos(o.ang), Math.sin(o.ang)];
        if (sport.startsWith('soccer') && o.len > 60) {
          for (const s of [-1, 1]) posts.push({ x: o.c[0] + ax[0] * s * (o.len / 2 - 3), z: o.c[1] + ax[1] * s * (o.len / 2 - 3), ang: o.ang });
          for (const s of [-1, 1]) for (const t of [-1, 1]) masts.push({ x: o.c[0] + ax[0] * s * o.len * 0.3 - ax[1] * t * (o.wid / 2 + 5), z: o.c[1] + ax[1] * s * o.len * 0.3 + ax[0] * t * (o.wid / 2 + 5) });
        }
        if (sport.startsWith('tennis') || sport.startsWith('volleyball') || sport.startsWith('badminton')) {
          const h = sport.startsWith('tennis') ? 1.0 : sport.startsWith('badminton') ? 1.55 : 2.4;
          const net = new THREE.Mesh(new THREE.PlaneGeometry(o.wid * 0.85, sport.startsWith('tennis') ? 1.0 : 0.9),
            new THREE.MeshBasicMaterial({ color: '#f0f0f0', transparent: true, opacity: 0.45, side: THREE.DoubleSide }));
          net.position.set(o.c[0], h - 0.45, o.c[1]); net.rotation.y = -o.ang + Math.PI / 2; group.add(net);
        }
        break;
      }
      default: break;
    }
  }
  // new football ground: the infield of the athletics track
  const track = data.areas.find((a) => a.kind === 'track');
  if (track && track.holes && track.holes[0]) {
    const c = centroid(track.holes[0]);
    addFlatPoly(F('lawn', mats.lawn), track.holes[0], [], height(c[0], c[1]) + 0.035, 1 / 6);
    // goals on the pitch axis and the floodlight masts are built in sports.js
  }
  // central academic quad lawn (the big courtyard is open, not a hole in the footprint)
  for (const k in flat) {
    const m = new THREE.Mesh(flat[k].geo.build(), flat[k].mat); m.receiveShadow = true; group.add(m);
  }
  const sm = new THREE.Mesh(solid.build(), surfaceMaterial('concrete', '#c9c4b6'));
  sm.castShadow = true; sm.receiveShadow = true; group.add(sm);

  // goal posts
  const white = new THREE.MeshStandardMaterial({ color: '#f3f3f3', roughness: 0.5 });
  for (const p of posts) {
    const g = new THREE.Group();
    const bar = new THREE.CylinderGeometry(0.07, 0.07, 2.44, 6);
    for (const s of [-1, 1]) { const m = new THREE.Mesh(bar, white); m.position.set(0, 1.22, s * 3.66); g.add(m); }
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 7.32, 6), white); top.rotation.x = Math.PI / 2; top.position.y = 2.44; g.add(top);
    g.position.set(p.x, height(p.x, p.z), p.z); g.rotation.y = -p.ang; group.add(g);
  }
  // flood-light masts
  const steel = new THREE.MeshStandardMaterial({ color: '#8d9399', roughness: 0.5, metalness: 0.6 });
  const lampMat = new THREE.MeshStandardMaterial({ color: '#dddddd', emissive: '#fff4d6', emissiveIntensity: 0 });
  env.nightEmissive.push({ mat: lampMat, on: 3 });
  for (const p of masts) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.3, 18, 8), steel); pole.position.set(p.x, 9 + height(p.x, p.z), p.z); pole.castShadow = true; group.add(pole);
    const head = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.2, 0.4), lampMat); head.position.set(p.x, 18.2 + height(p.x, p.z), p.z); head.lookAt(0, 0, 0); group.add(head);
  }
  scene.add(group);
  return { group, places };
}

export function buildRocks(data, scene, height) {
  const r = rng(17);
  const mk = (seed) => {
    const g = new THREE.IcosahedronGeometry(1, 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const n = 0.72 + 0.5 * fbm(x * 1.3 + seed, z * 1.3 + y * 1.7 + seed);
      p.setXYZ(i, x * n, y * n * 0.8, z * n);
    }
    g.computeVertexNormals();
    return g;
  };
  const mat = new THREE.MeshStandardMaterial({ map: plainTex('#b29c84', 81, 0.14), roughness: 0.95 });
  const list = data.rocks.map((q) => ({ x: q[0], z: q[1], s: q[2] }));
  const group = new THREE.Group();
  const d = new THREE.Object3D();
  const col = new THREE.Color();
  for (let v = 0; v < 3; v++) {
    const arr = list.filter((q, i) => i % 3 === v && !marineReserved(q.x, q.z));
    const im = new THREE.InstancedMesh(mk(v * 13.7 + 1), mat, arr.length);
    arr.forEach((q, i) => {
      d.position.set(q.x, height(q.x, q.z) + (q.lift || 0) + q.s * 0.28, q.z);
      d.rotation.set(r() * 0.5, r() * 6.28, r() * 0.5);
      d.scale.set(q.s * (0.8 + r() * 0.5), q.s * (q.big ? 0.95 : 0.6 + r() * 0.4), q.s * (0.8 + r() * 0.5));
      d.updateMatrix(); im.setMatrixAt(i, d.matrix);
      const t = 0.8 + r() * 0.35; col.setRGB(t * 1.02, t * 0.98, t * 0.94); im.setColorAt(i, col);
    });
    im.castShadow = true; im.receiveShadow = true; group.add(im);
  }
  scene.add(group);
  return group;
}

// -------------------------------------------------------------- street lamps
export function buildLamps(data, scene, env) {
  const r = rng(23);
  const spots = [];
  for (const road of data.roads) {
    if (road.kind === 'foot' || road.kind === 'path' || road.kind === 'track') continue;
    const mid = road.pts[road.pts.length >> 1];
    if (!pip(mid[0], mid[1], data.boundary)) continue;
    let acc = 12 + r() * 10, side = 1;
    for (let i = 0; i < road.pts.length - 1; i++) {
      const a = road.pts[i], b = road.pts[i + 1];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 0.01) continue;
      const nx = -(b[1] - a[1]) / len, nz = (b[0] - a[0]) / len;
      while (acc < len) {
        const t = acc / len;
        spots.push({ x: a[0] + (b[0] - a[0]) * t + nx * side * 4.4, z: a[1] + (b[1] - a[1]) * t + nz * side * 4.4, ang: Math.atan2(-nz * side, -nx * side) });
        acc += 38; side = -side;
      }
      acc -= len;
    }
  }
  const pole = new THREE.CylinderGeometry(0.07, 0.11, 7, 6); pole.translate(0, 3.5, 0);
  const arm = new THREE.CylinderGeometry(0.05, 0.05, 1.6, 5); arm.rotateZ(Math.PI / 2); arm.translate(0.8, 6.95, 0);
  const steel = new THREE.MeshStandardMaterial({ color: '#7d848a', roughness: 0.5, metalness: 0.5 });
  const headMat = new THREE.MeshStandardMaterial({ color: '#e8e8e8', emissive: '#ffcf8a', emissiveIntensity: 0 });
  env.nightEmissive.push({ mat: headMat, on: 4 });
  const head = new THREE.BoxGeometry(0.7, 0.14, 0.3); head.translate(1.5, 6.9, 0);
  const ims = [[pole, steel], [arm, steel], [head, headMat]].map(([g, m]) => new THREE.InstancedMesh(g, m, spots.length));
  const d = new THREE.Object3D();
  const glowPos = [];
  spots.forEach((s, i) => {
    d.position.set(s.x, 0, s.z); d.rotation.set(0, -s.ang, 0); d.updateMatrix();
    ims.forEach((im) => im.setMatrixAt(i, d.matrix));
    glowPos.push(s.x + Math.cos(s.ang) * 1.5, 6.8, s.z + Math.sin(s.ang) * 1.5);
  });
  const group = new THREE.Group();
  ims.forEach((im) => group.add(im));
  // glow sprites + light pools for the night
  const glowTex = canvasTex(64, 64, (g) => {
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,225,170,1)'); gr.addColorStop(0.25, 'rgba(255,190,110,0.55)'); gr.addColorStop(1, 'rgba(255,170,80,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  }, { repeat: false });
  const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.Float32BufferAttribute(glowPos, 3));
  const glow = new THREE.Points(pg, new THREE.PointsMaterial({ map: glowTex, size: 4.5, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }));
  glow.visible = false; group.add(glow);
  const pool = new THREE.InstancedMesh(new THREE.CircleGeometry(11, 20).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8 }), spots.length);
  spots.forEach((s, i) => { d.position.set(s.x + Math.cos(s.ang) * 2, 0.12, s.z + Math.sin(s.ang) * 2); d.rotation.set(0, 0, 0); d.updateMatrix(); pool.setMatrixAt(i, d.matrix); });
  pool.visible = false; pool.renderOrder = 8; group.add(pool);
  env.nightVisible.push(pool); env.nightOnly = [glow];
  scene.add(group);
  return group;
}

// ----------------------------------------------------------------- the gate
export const GATE = { x: -55.5, z: -407, ang: Math.atan2(7, 21) };
// Gate frame: u runs along the beam (+u is on your left as you face the campus from the road),
// v points into the campus, so the approach road outside is at negative v.
const GC = Math.cos(GATE.ang), GS = Math.sin(GATE.ang);
export const gateLocal = (x, z) => { const dx = x - GATE.x, dz = z - GATE.z; return [dx * GC + dz * GS, -dx * GS + dz * GC]; };
export const gateWorld = (u, v) => [GATE.x + u * GC - v * GS, GATE.z + u * GS + v * GC];
const SIGN_END = 28.5;           // the blue sign walls run from the outer pillars (|u| = 15) to here
const APRON_V = 0.8;             // campus paths and kerbs start just inside the gate line
// asphalt apron joining the two gate lanes to the outside road junction (gate frame)
const APRON = [[-13.9, 1.1], [13.9, 1.1], [14.3, -3], [15.6, -7.4], [18, -10.3], [4, -10.8], [-3.8, -11.6],
  [-6.4, -14.6], [-8, -17.5], [-10.2, -14.5], [-12.4, -10.5], [-13.6, -6.5], [-13.9, -3]];
// the bus stop in the wall notch right of the gate (mapped as a shelter), and the walk from the apron to it
const STOP = { u: -26.1, v: -11.3, ang: Math.atan2(0.984, 0.178) };
let gateBoundary = null;
export function prepareGate(data) { gateBoundary = data.boundary; }
// Places kept free of trees: the gate mouth (Marine Drive palms used to stand in the lanes), the line of
// the sign walls, and the open verge between the wall and the westbound road where the bus stop is.
export function gateClear(x, z) {
  const [u, v] = gateLocal(x, z);
  if (Math.hypot(u, v) < 17) return true;
  if (Math.abs(v) < 2.4 && Math.abs(u) > 13 && Math.abs(u) < 52) return true;
  if (u < -2 && u > -52 && v < 1 && v > -60 && gateBoundary && !pip(x, z, gateBoundary)) {
    // which side of the westbound road (junction (-3.8,-13.2) to (-42.7,-53.2)), and how far
    const side = (40 * (u + 3.8) - 38.9 * (v + 13.2)) / 55.8;
    if (side < -4.5) return true;
  }
  return false;
}

export function buildGate(data, scene) {
  const g = new THREE.Group();
  const cream = surfaceMaterial('concrete', '#dfd4bf');
  const W = 30, Hh = 9.2, beam = 1.7;
  const box = (w, h, dd, x, y, z, m = cream) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, dd), m); b.position.set(x, y, z); b.castShadow = true; b.receiveShadow = true; g.add(b); return b; };
  box(W, beam, 1.1, 0, Hh - beam / 2, 0);
  for (const x of [-W / 2 + 0.6, W / 2 - 0.6]) box(1.2, Hh - beam, 1.1, x, (Hh - beam) / 2, 0);
  for (const x of [-3.1, 3.1]) box(0.9, Hh - beam, 1.0, x, (Hh - beam) / 2, 0);
  // guard cabin between the centre pillars
  box(5.4, 3.3, 3.2, 0, 1.65, 0.6);
  box(6.0, 0.25, 3.8, 0, 3.4, 0.6);
  const glass = new THREE.MeshStandardMaterial({ color: '#1d2a30', roughness: 0.2, metalness: 0.5 });
  box(3.6, 1.5, 0.08, 0, 1.9, -1.02, glass); box(3.6, 1.5, 0.08, 0, 1.9, 2.22, glass);
  // lettering on both faces
  const sign = canvasTex(1024, 176, (c, w) => {
    const F = '"Helvetica Neue", Helvetica, Arial, sans-serif';
    c.fillStyle = '#ead9bf'; c.fillRect(0, 0, w, 176);
    c.fillStyle = '#6f6b64'; c.textBaseline = 'alphabetic';
    c.font = `700 112px ${F}`; const wa = c.measureText('BITS ').width;
    c.font = `300 112px ${F}`; const wb = c.measureText('Pilani').width;
    const x = (w - wa - wb) / 2;
    c.font = `700 112px ${F}`; c.fillText('BITS ', x, 108);
    c.font = `300 112px ${F}`; c.fillText('Pilani', x + wa, 108);
    c.font = `300 38px ${F}`; c.textAlign = 'center'; c.letterSpacing = '4px';
    c.fillText('Hyderabad Campus', w / 2 + 2, 158);
  }, { repeat: false });
  const sm = new THREE.MeshStandardMaterial({ map: sign, roughness: 0.9 });
  for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.PlaneGeometry(9.4, 1.62), sm); p.position.set(0, Hh - beam / 2, s * 0.56); if (s < 0) p.rotation.y = Math.PI; g.add(p); }
  // maroon gate leaves, swung open
  const bars = canvasTex(256, 256, (c) => {
    c.clearRect(0, 0, 256, 256); c.fillStyle = '#7d2634';
    for (let x = 0; x < 256; x += 22) c.fillRect(x, 0, 6, 256);
    c.fillRect(0, 0, 256, 10); c.fillRect(0, 150, 256, 10); c.fillRect(0, 246, 256, 10);
  }, { repeat: false });
  const gm = new THREE.MeshStandardMaterial({ map: bars, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.6, metalness: 0.4 });
  const leaf = (px, dir, swing) => {
    const piv = new THREE.Group(); piv.position.set(px, 0, 0);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 3.6), gm); m.position.set(dir * 2.6, 1.8, 0); m.castShadow = true;
    piv.add(m); piv.rotation.y = swing; g.add(piv);
  };
  leaf(-W / 2 + 1.2, 1, -1.25); leaf(-3.55, -1, 1.25); leaf(3.55, 1, -1.25); leaf(W / 2 - 1.2, -1, 1.25);
  // blue institute sign walls either side, running from the outer pillars into the boundary wall;
  // the lettering faces the road, the campus side is plain blue
  // same pattern as the beam: the institute name bold, 'Pilani' and the campus line light
  const blue = canvasTex(1280, 256, (c, w) => {
    const F = '"Helvetica Neue", Helvetica, Arial, sans-serif';
    c.fillStyle = '#27348b'; c.fillRect(0, 0, w, 256);
    c.fillStyle = '#ffffff'; c.textBaseline = 'alphabetic';
    const A = 'Birla Institute of Technology & Science, ', B = 'Pilani';
    c.font = `700 52px ${F}`; const wa = c.measureText(A).width;
    c.font = `300 52px ${F}`; const wb = c.measureText(B).width;
    const x = (w - wa - wb) / 2;
    c.font = `700 52px ${F}`; c.fillText(A, x, 124);
    c.font = `300 52px ${F}`; c.fillText(B, x + wa, 124);
    c.font = `300 40px ${F}`; c.textAlign = 'center'; c.letterSpacing = '3px';
    c.fillText('Hyderabad Campus', w / 2 + 1.5, 196);
  }, { repeat: false });
  const blueFace = new THREE.MeshStandardMaterial({ map: blue, roughness: 0.8 });
  const bluePlain = new THREE.MeshStandardMaterial({ color: '#27348b', roughness: 0.8 });
  const signLen = SIGN_END - W / 2;
  for (const s of [-1, 1]) box(signLen, 2.6, 0.4, s * (W / 2 + signLen / 2), 1.3, 0, [bluePlain, bluePlain, bluePlain, bluePlain, bluePlain, blueFace]);
  buildBusStop(g);
  g.position.set(GATE.x, 0, GATE.z);
  g.rotation.y = -GATE.ang;
  scene.add(g);
  return g;
}

// A small bus stop in the wall notch right of the gate: concrete pad, steel posts, a white roof with a
// glass side screens and a bench, with a concrete walk back to the gate apron.
function buildBusStop(parent) {
  const s = new THREE.Group();
  s.position.set(STOP.u, 0, STOP.v); s.rotation.y = STOP.ang;      // local x along the stop, +z faces out
  const concrete = surfaceMaterial('concrete', '#bdb8ae');
  const steel = new THREE.MeshStandardMaterial({ color: '#5d646b', roughness: 0.45, metalness: 0.6 });
  const white = new THREE.MeshStandardMaterial({ color: '#eceae4', roughness: 0.7 });
  const glass = new THREE.MeshStandardMaterial({ color: '#b9d3da', roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide });
  const wood = new THREE.MeshStandardMaterial({ color: '#8a6a4a', roughness: 0.8 });
  const B = (w, h, d, x, y, z, m, grp = s) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); b.castShadow = m !== glass; b.receiveShadow = true; grp.add(b); return b; };
  B(10.4, 0.16, 4.4, 0, 0.08, 0.2, concrete);                                   // pad
  for (const x of [-4.6, -2.3, 0, 2.3, 4.6]) B(0.12, 2.6, 0.12, x, 1.46, -1.55, steel);     // back posts
  for (const x of [-4.6, 4.6]) B(0.12, 2.5, 0.12, x, 1.41, 1.45, steel);                 // front posts
  B(9.3, 0.9, 0.08, 0, 0.62, -1.55, white);                                     // low back panel
  B(9.3, 1.3, 0.03, 0, 1.72, -1.55, glass);                                     // glazed upper back
  for (const x of [-4.62, 4.62]) B(0.03, 1.9, 2.4, x, 1.2, -0.35, glass);       // side screens
  const roof = B(10.6, 0.16, 4.3, 0, 2.86, 0, white); roof.rotation.x = -0.04;  // falls gently to the back
  B(7.2, 0.06, 0.46, 0, 0.5, -1.15, wood);                                      // bench
  for (const x of [-3.3, 0, 3.3]) B(0.08, 0.34, 0.4, x, 0.33, -1.15, steel);
  parent.add(s);
  // concrete walk from the apron's edge to the front of the stop (gate frame)
  const walk = new THREE.Mesh(new THREE.BoxGeometry(1, 0.12, 2.4), concrete);
  const a = [-12.8, -10.4], b = [STOP.u + 0.984 * 2.3, STOP.v + 0.178 * 2.3];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  walk.scale.x = len; walk.position.set((a[0] + b[0]) / 2, 0.06, (a[1] + b[1]) / 2);
  walk.rotation.y = -Math.atan2(b[1] - a[1], b[0] - a[0]); walk.receiveShadow = true;
  parent.add(walk);
}

// boundary wall pieces replaced by the gate, its sign walls and their connections
const JOIN_U = 50;
function gateSkip(x, z) {
  const [u, v] = gateLocal(x, z);
  return (u > -28.6 && u <= 0 && v > -6.7 && v < 6) || (u >= 0 && u < JOIN_U && v > -12 && v < 6);
}

export function buildBoundaryWall(data, scene, height) {
  const geo = new Geo();
  const b = data.boundary;
  for (let i = 0; i < b.length; i++) {
    const p = b[i], q = b[(i + 1) % b.length];
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const nearGate = Math.min(Math.hypot(p[0] - GATE.x, p[1] - GATE.z), Math.hypot(q[0] - GATE.x, q[1] - GATE.z), distToPoly(GATE.x, GATE.z, [p, q, p])) < 120;
    const k = Math.max(1, Math.ceil(len / (nearGate ? 2 : 10)));
    for (let j = 0; j < k; j++) {
      const a = [p[0] + ((q[0] - p[0]) * j) / k, p[1] + ((q[1] - p[1]) * j) / k];
      const c = [p[0] + ((q[0] - p[0]) * (j + 1)) / k, p[1] + ((q[1] - p[1]) * (j + 1)) / k];
      const mx = (a[0] + c[0]) / 2, mz = (a[1] + c[1]) / 2;
      if (gateSkip(mx, mz)) continue;
      // leave openings where real roads cross the boundary
      let crossing = false;
      for (const r of data.roads) {
        if (r.kind === 'foot' || r.kind === 'path') continue;
        for (const rp of r.pts) if (Math.abs(rp[0] - mx) < 7 && Math.abs(rp[1] - mz) < 7) { crossing = true; break; }
        if (crossing) break;
      }
      if (crossing) continue;
      const l = len / k;
      geo.box(mx, mz, l + 0.05, 0.35, height(mx, mz) - 0.3, height(mx, mz) + 2.3, Math.atan2(c[1] - a[1], c[0] - a[0]), 0.25);
    }
  }
  // the wall meets the ends of the blue sign walls: straight back into the notch on the right,
  // and on a slight angle on the left to where the mapped wall line resumes
  let left = null;
  for (let i = 0; i < b.length && !left; i++) {
    const [pu, pv] = gateLocal(...b[i]), [qu, qv] = gateLocal(...b[(i + 1) % b.length]);
    if ((pu - JOIN_U) * (qu - JOIN_U) <= 0 && Math.abs(pv) < 15 && pu !== qu) left = [JOIN_U, pv + ((qv - pv) * (JOIN_U - pu)) / (qu - pu)];
  }
  for (const [a, c] of [[[-SIGN_END, 0], [-28.7, -6.8]], [[SIGN_END, 0], left || [JOIN_U, -6]]]) {
    const A = gateWorld(...a), C = gateWorld(...c), mx = (A[0] + C[0]) / 2, mz = (A[1] + C[1]) / 2;
    geo.box(mx, mz, Math.hypot(C[0] - A[0], C[1] - A[1]) + 0.3, 0.35, height(mx, mz) - 0.3, height(mx, mz) + 2.3, Math.atan2(C[1] - A[1], C[0] - A[0]), 0.25);
  }
  const m = new THREE.Mesh(geo.build(), surfaceMaterial('concrete', '#cec6b5'));
  m.castShadow = true; m.receiveShadow = true;
  scene.add(m);
  return m;
}
