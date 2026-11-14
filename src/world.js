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

export function makeHeight(boundary) {
  const bb = bbox(boundary);
  return function height(x, z) {
    let d;
    if (x > bb[0] && x < bb[2] && z > bb[1] && z < bb[3] && pip(x, z, boundary)) return 0;
    d = distToPoly(x, z, boundary);
    if (d < 160) return 0;
    const s = Math.min(1, (d - 160) / 700);
    const k = s * s * (3 - 2 * s);
    const hills = fbm(x / 800, z / 800) * 46 + fbm(x / 230 + 7, z / 230 + 2) * 9 - 12;
    const far = Math.max(0, (Math.hypot(x, z) - 2200) / 1500);
    return k * Math.max(-2, hills) + far * far * 60 * fbm(x / 600 + 3, z / 600);
  };
}

export function buildGround(data, scene, height) {
  const size = 9000, seg = 300;
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, height(pos.getX(i), pos.getZ(i)));
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
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWp;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vWp; uniform sampler2D uGround; uniform sampler2D uDetail; uniform vec4 uExt;`)
      .replace('#include <map_fragment>', `
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
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}

// -------------------------------------------------------------------- roads
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
  for (const r of data.roads) {
    const opt = { closed: r.closed, vScale: 1 / 8 };
    const pts = r.closed ? r.pts.slice(0, -1) : r.pts;
    if (pts.length < 2) continue;
    if (r.kind === 'foot') addRibbon(layers.foot.geo, pts, r.w, yf(layers.foot.y), { ...opt, vScale: 1 / 1.6, uRep: r.w / 1.6 });
    else if (r.kind === 'path' || r.kind === 'track') addRibbon(layers.path.geo, pts, r.w, yf(layers.path.y), { ...opt, vScale: 1 / 6 });
    else {
      const w = r.kind === 'service' ? 5.6 : r.w;
      const mid = pts[pts.length >> 1];
      if (!inside(mid) && r.kind !== 'main' && Math.hypot(mid[0] - GATE.x, mid[1] - GATE.z) > 90 && distToPoly(mid[0], mid[1], data.boundary) > 40) { addRibbon(layers.path.geo, pts, 4, yf(layers.path.y), { ...opt, vScale: 1 / 6 }); continue; }
      if (inside(mid)) { addRibbon(layers.kerb.geo, pts, w + 4.4, yf(layers.kerb.y), { ...opt, vScale: 1 / 1.6, uRep: (w + 4.4) / 1.6 }); carriage.push({ pts: r.pts, hw: w / 2 }); }
      addRibbon((r.kind === 'service' ? layers.service : layers.main).geo, pts, w, yf(r.kind === 'service' ? layers.service.y : layers.main.y), opt);
    }
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

export function buildAreas(data, scene, env) {
  const group = new THREE.Group();
  const flat = {};
  const F = (key, mat) => { if (!flat[key]) flat[key] = { geo: new Geo(), mat }; return flat[key].geo; };
  const std = (tex, o = {}) => new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1, ...o });
  const mats = {
    lawn: std(grassTex()),
    asphalt: surfaceMaterial('asphalt', '#64625c', { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
    concrete: surfaceMaterial('concrete', '#bdb9ae', { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
    paver: surfaceMaterial('pavers', '#b6a18a', { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
    clay: std(plainTex('#a85c42', 63, 0.08)),
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
    switch (a.kind) {
      case 'grass': addFlatPoly(F('lawn', mats.lawn), pts, [], 0.02, 1 / 6); break;
      case 'parking': addFlatPoly(F('asphalt', mats.asphalt), pts, [], 0.04, 1 / 6); break;
      case 'plaza': addFlatPoly(F('paver', mats.paver), pts, [], 0.04, 1 / 3); break;
      case 'pooldeck': addFlatPoly(F('concrete', mats.concrete), pts, [], 0.05, 1 / 6); break;
      case 'track': addFlatPoly(F('clay', mats.clay), pts, a.holes || [], 0.03, 1 / 6); break;
      case 'water': {
        const g = new Geo(); addFlatPoly(g, pts, [], 0.06, 1 / 8);
        const m = new THREE.Mesh(g.build(), water); m.receiveShadow = true; group.add(m);
        // stone rim
        const rim = new Geo(); addRibbon(rim, pts, 0.9, () => 0.12, { closed: true, vScale: 1 / 2 });
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
        if (pts.length !== 4) { addFlatPoly(F('lawn', mats.lawn), pts, [], 0.03, 1 / 6); break; }
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
    addFlatPoly(F('lawn', mats.lawn), track.holes[0], [], 0.035, 1 / 6);
    const c = centroid(track.holes[0]);
    const bb = bbox(track.holes[0]);
    const tall = bb[3] - bb[1] > bb[2] - bb[0];
    for (const s of [-1, 1]) posts.push({ x: c[0] + (tall ? 0 : s * 45), z: c[1] + (tall ? s * 45 : 0), ang: tall ? Math.PI / 2 : 0 });
    for (const s of [-1, 1]) for (const t of [-1, 1]) masts.push({ x: c[0] + s * ((bb[2] - bb[0]) / 2 + 14), z: c[1] + t * (bb[3] - bb[1]) * 0.3 });
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
    g.position.set(p.x, 0, p.z); g.rotation.y = -p.ang; group.add(g);
  }
  // flood-light masts
  const steel = new THREE.MeshStandardMaterial({ color: '#8d9399', roughness: 0.5, metalness: 0.6 });
  const lampMat = new THREE.MeshStandardMaterial({ color: '#dddddd', emissive: '#fff4d6', emissiveIntensity: 0 });
  env.nightEmissive.push({ mat: lampMat, on: 3 });
  for (const p of masts) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.3, 18, 8), steel); pole.position.set(p.x, 9, p.z); pole.castShadow = true; group.add(pole);
    const head = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.2, 0.4), lampMat); head.position.set(p.x, 18.2, p.z); head.lookAt(0, 0, 0); group.add(head);
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
  const mat = new THREE.MeshStandardMaterial({ map: plainTex('#a39a8f', 81, 0.14), roughness: 0.95 });
  const list = data.rocks.map((q) => ({ x: q[0], z: q[1], s: q[2] }));
  // signature boulders of the rock garden
  const park = data.areas.find((a) => a.name === 'Rock Garden');
  if (park) {
    const c = centroid(park.pts);
    [[-28, -14, 9], [-18, -6, 7], [-36, -2, 6.5], [-22, 8, 6], [-8, -18, 5.5], [-40, -20, 5], [-12, 2, 4.5]].forEach(([dx, dz, s]) => list.push({ x: c[0] + dx, z: c[1] + dz, s, big: true }));
    list.push({ x: c[0] - 23, z: c[1] - 9, s: 3.2, lift: 9.5, big: true });   // balanced rock
  }
  const group = new THREE.Group();
  const d = new THREE.Object3D();
  const col = new THREE.Color();
  for (let v = 0; v < 3; v++) {
    const arr = list.filter((_, i) => i % 3 === v);
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
  const sign = signTex([{ text: 'BITS Pilani', size: 118, y: 0.40, color: '#8d8a84' }, { text: 'H y d e r a b a d   C a m p u s', size: 36, y: 0.84, color: '#77736c', weight: 600 }], { w: 1024, h: 176, bg: '#ead9bf' });
  const sm = new THREE.MeshStandardMaterial({ map: sign, roughness: 0.9 });
  for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.PlaneGeometry(9.4, 1.62), sm); p.position.set(0, Hh - beam / 2, s * 0.56); if (s < 0) p.rotation.y = Math.PI; g.add(p); }
  // crest
  const crest = new THREE.Mesh(new THREE.CircleGeometry(0.62, 24), new THREE.MeshStandardMaterial({ map: canvasTex(128, 128, (c) => {
    c.fillStyle = '#c9a23a'; c.beginPath(); c.arc(64, 64, 64, 0, 7); c.fill();
    c.fillStyle = '#b5372e'; c.beginPath(); c.arc(64, 64, 52, 0, 7); c.fill();
    c.fillStyle = '#3d86c6'; c.beginPath(); c.moveTo(64, 64); c.arc(64, 64, 44, -2.6, -0.5); c.fill();
    c.fillStyle = '#e6b83e'; c.beginPath(); c.moveTo(64, 64); c.arc(64, 64, 44, -0.5, 1.6); c.fill();
    c.fillStyle = '#f1ece0'; c.beginPath(); c.moveTo(64, 64); c.arc(64, 64, 44, 1.6, 3.7); c.fill();
  }, { repeat: false }) }));
  for (const s of [-1, 1]) { const c2 = crest.clone(); c2.position.set(-5.6 * s, Hh - beam / 2, s * 0.57); if (s < 0) c2.rotation.y = Math.PI; g.add(c2); }
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
  // blue institute sign wall on the left
  const blue = signTex([{ text: 'Birla Institute of Technology & Science, Pilani', size: 54, y: 0.42, color: '#ffffff' }, { text: 'Hyderabad Campus', size: 44, y: 0.74, color: '#ffffff', weight: 500 }], { w: 1280, h: 256, bg: '#27348b' });
  const wall = box(13, 2.6, 0.4, -W / 2 - 7.5, 1.3, -0.6, new THREE.MeshStandardMaterial({ map: blue, roughness: 0.8 }));
  wall.rotation.y = 0.12;
  g.position.set(GATE.x, 0, GATE.z);
  g.rotation.y = -GATE.ang;
  scene.add(g);
  return g;
}

export function buildBoundaryWall(data, scene, height) {
  const geo = new Geo();
  const b = data.boundary;
  for (let i = 0; i < b.length; i++) {
    const p = b[i], q = b[(i + 1) % b.length];
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const k = Math.max(1, Math.ceil(len / 10));
    for (let j = 0; j < k; j++) {
      const a = [p[0] + ((q[0] - p[0]) * j) / k, p[1] + ((q[1] - p[1]) * j) / k];
      const c = [p[0] + ((q[0] - p[0]) * (j + 1)) / k, p[1] + ((q[1] - p[1]) * (j + 1)) / k];
      const mx = (a[0] + c[0]) / 2, mz = (a[1] + c[1]) / 2;
      if (Math.hypot(mx - GATE.x, mz - GATE.z) < 34) continue;
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
  const m = new THREE.Mesh(geo.build(), surfaceMaterial('concrete', '#cec6b5'));
  m.castShadow = true; m.receiveShadow = true;
  scene.add(m);
  return m;
}
