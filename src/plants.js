import { addTreeGroundDetail } from './ground-detail.js';
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { rng, canvasTex } from './textures.js';
import { buildDetailedTrees, updateDetailedTrees } from './detailed-trees.js';
import { createOriginalTrees, createCompanionTrees } from './tree-population.js';

// shared uniform: fake light transmission through foliage (set per time of day)
export const foliageGlow = { value: 0.16 };

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

// ---------------------------------------------------------------- textures
// Leaf textures are near-neutral in hue: vertex and instance colours supply the green,
// so the same texture serves dark conifers, yellow hedges and flowering shrubs.
function drawLeaves(g, w, h, r, count, cut) {
  for (let i = 0; i < count; i++) {
    const x = r() * w, y = r() * h, a = r() * Math.PI, len = 5 + r() * 5, wid = len * (0.5 + r() * 0.25);
    const v = 175 + r() * 80;
    for (const [ox, oy] of [[0, 0], [w, 0], [-w, 0], [0, h], [0, -h]]) {
      if (x + ox < -20 || x + ox > w + 20 || y + oy < -20 || y + oy > h + 20) continue;
      g.save(); g.translate(x + ox, y + oy); g.rotate(a);
      g.fillStyle = `rgb(${v * 0.96},${v},${v * 0.9})`;
      g.beginPath(); g.ellipse(0, 0, len, wid, 0, 0, 7); g.fill();
      g.strokeStyle = `rgba(255,255,240,${cut ? 0.25 : 0.18})`; g.lineWidth = 1;
      g.beginPath(); g.moveTo(-len, 0); g.lineTo(len, 0); g.stroke();
      g.restore();
    }
  }
}
export function leafTex() {
  return canvasTex(256, 256, (g, w, h) => {
    const r = rng(301);
    g.fillStyle = '#8a8a80'; g.fillRect(0, 0, w, h);
    drawLeaves(g, w, h, r, 900, false);
  });
}
export function leafCutTex() {
  return canvasTex(256, 256, (g, w, h) => {
    const r = rng(302);
    g.clearRect(0, 0, w, h);
    drawLeaves(g, w, h, r, 520, true);
  });
}
function frondTex() {
  return canvasTex(128, 512, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const r = rng(303);
    // v=0 (canvas bottom) is the base of the frond
    for (let i = 0; i < 46; i++) {
      const t = i / 46, y = h - 14 - t * (h - 30);
      const len = (w / 2 - 4) * Math.sin(Math.PI * (0.12 + t * 0.86)) * (0.85 + r() * 0.2);
      const v = 170 + r() * 80;
      g.strokeStyle = `rgb(${v * 0.95},${v},${v * 0.88})`; g.lineWidth = 5.5;
      for (const s of [-1, 1]) { g.beginPath(); g.moveTo(w / 2, y); g.lineTo(w / 2 + s * len, y - 18 - t * 10); g.stroke(); }
    }
    g.strokeStyle = '#d9d6b8'; g.lineWidth = 5;
    g.beginPath(); g.moveTo(w / 2, h); g.lineTo(w / 2, 6); g.stroke();
  }, { repeat: false });
}
function barkTex() {
  return canvasTex(64, 128, (g, w, h) => {
    const r = rng(304);
    g.fillStyle = '#b9b3a6'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 260; i++) {
      const v = 120 + r() * 110;
      g.fillStyle = `rgba(${v},${v},${v},0.35)`;
      g.fillRect(r() * w, r() * h, 1 + r() * 3, 6 + r() * 22);
    }
  });
}

// ---------------------------------------------------------------- geometry
const UVS = 0.62;
function planarUV(g, s = UVS) {
  const p = g.attributes.position, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    uv[i * 2] = (x * 0.8 + z * 0.6) * s; uv[i * 2 + 1] = (y * 0.9 + z * 0.45 - x * 0.2) * s;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}
function paint(g, top, bot, y0, y1) {
  const p = g.attributes.position, col = new Float32Array(p.count * 3);
  const ct = new THREE.Color(top), cb = new THREE.Color(bot), c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const t = y1 > y0 ? THREE.MathUtils.clamp((p.getY(i) - y0) / (y1 - y0), 0, 1) : 1;
    c.copy(cb).lerp(ct, t);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
export function blob(radius, detail, squash, seed, top = '#7ba348', bot = '#3a5a2a', rough = 0.42) {
  let g = new THREE.IcosahedronGeometry(radius, detail);
  g.deleteAttribute('normal'); g.deleteAttribute('uv');
  g = mergeVertices(g, 1e-3);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = 1 - rough / 2 + rough * (vnoise(x * 0.9 + seed * 7.1, z * 0.9 + y * 1.3 + seed) * 0.6 + vnoise(x * 2.3 + seed, y * 2.3 + z * 2.1) * 0.4);
    p.setXYZ(i, x * n, y * n * squash, z * n);
  }
  g.computeVertexNormals();
  paint(g, top, bot, -radius * squash * 0.7, radius * squash);
  return g;
}
const M = (x, y, z, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), new THREE.Vector3(sx, sy, sz));

// merge parts into one non-indexed geometry (position, normal, uv, color)
export function merge(parts) {
  const pos = [], nor = [], col = [], uvs = [];
  const v = new THREE.Vector3(), n = new THREE.Vector3();
  for (const part of parts) {
    const { geo, matrix = new THREE.Matrix4(), up = 0, two = false, uvWorld = false } = part;
    const g = geo.index ? geo.toNonIndexed() : geo;
    const nm = new THREE.Matrix3().getNormalMatrix(matrix);
    const P = g.attributes.position, N = g.attributes.normal, C = g.attributes.color, U = g.attributes.uv;
    const emit = (i) => {
      v.fromBufferAttribute(P, i).applyMatrix4(matrix); pos.push(v.x, v.y, v.z);
      n.fromBufferAttribute(N, i).applyMatrix3(nm).normalize();
      if (up) { n.y = Math.abs(n.y) + up; n.normalize(); }
      nor.push(n.x, n.y, n.z);
      if (C) col.push(C.getX(i), C.getY(i), C.getZ(i)); else col.push(1, 1, 1);
      if (uvWorld) uvs.push((v.x * 0.8 + v.z * 0.6) * UVS, (v.y * 0.9 + v.z * 0.45 - v.x * 0.2) * UVS);
      else if (U) uvs.push(U.getX(i), U.getY(i)); else uvs.push(0, 0);
    };
    for (let i = 0; i < P.count; i += 3) {
      emit(i); emit(i + 1); emit(i + 2);
      if (two) { emit(i); emit(i + 2); emit(i + 1); }
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  return out;
}
function limb(x0, y0, z0, x1, y1, z1, r0, r1, colr = '#6f5d4a') {
  const d = new THREE.Vector3(x1 - x0, y1 - y0, z1 - z0), len = d.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, 6, 1, false);
  paint(g, colr, colr, 0, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
  const m = new THREE.Matrix4().compose(new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), q, new THREE.Vector3(1, 1, 1));
  return { geo: g, matrix: m };
}
// trunk uses a flat patch of the leaf texture, so darken via colour only
const crown = (list, scale = 1) => list.map(([r, d, sq, seed, x, y, z, top, bot]) => ({ geo: blob(r * scale, d, sq, seed, top, bot), matrix: M(x, y, z), up: 0.85, uvWorld: true }));

export function plantGeometries() {
  const G = {};
  // 0: spreading broadleaf (rain tree / gulmohar habit)
  {
    const c = [
      [2.5, 1, 0.62, 1, 0, 6.0, 0, '#86ad4c', '#3f6230'], [2.0, 1, 0.66, 2, 2.2, 5.3, 0.9, '#8fb552', '#41652f'],
      [1.9, 1, 0.66, 3, -1.9, 5.5, -1.3, '#7aa346', '#3a5c2c'], [1.7, 1, 0.7, 4, -0.6, 5.1, 2.1, '#89b04e', '#3f6230'],
      [1.6, 1, 0.7, 5, 0.9, 5.4, -2.2, '#7da648', '#3a5c2c'],
    ];
    G.broad = {
      solid: merge([limb(0, 0, 0, 0, 3.6, 0, 0.3, 0.2), limb(0, 3.2, 0, 1.7, 5.0, 0.7, 0.15, 0.08), limb(0, 3.2, 0, -1.5, 5.1, -1.0, 0.15, 0.08), limb(0, 3.3, 0, -0.4, 4.9, 1.7, 0.13, 0.07), limb(0, 3.4, 0, 0.6, 5.2, -1.7, 0.13, 0.07), ...crown(c, 0.9)]),
      shell: merge(crown(c, 1.08)),
    };
  }
  // 1: upright evergreen (ashoka / silver oak habit)
  {
    const c = [[1.5, 1, 1.9, 6, 0, 6.2, 0, '#6f9c48', '#33542a'], [1.2, 1, 1.5, 7, 0.3, 8.4, 0.2, '#79a64e', '#36582c']];
    G.tall = { solid: merge([limb(0, 0, 0, 0, 5, 0, 0.22, 0.12), ...crown(c, 0.88)]), shell: merge(crown(c, 1.1)) };
  }
  // 2: dry-land scrub (cheap: no shell)
  G.scrub = {
    solid: merge([limb(0, 0, 0, 0, 1.5, 0, 0.14, 0.09), ...crown([[2.1, 1, 0.6, 8, 0, 2.5, 0, '#8d9f55', '#525f34'], [1.3, 1, 0.7, 9, 1.4, 1.9, 0.5, '#98a85c', '#586538']])]),
  };
  // 3: far broadleaf (cheap)
  G.far = {
    solid: merge([limb(0, 0, 0, 0, 3.6, 0, 0.26, 0.16), ...crown([[2.9, 1, 0.72, 10, 0, 5.4, 0, '#7ba348', '#3a5a2a'], [1.9, 1, 0.8, 11, 1.7, 4.7, 0.9, '#86ad4e', '#3f602c']])]),
  };
  // 4: tiered conifer (araucaria)
  {
    const tiers = [], shells = [];
    for (let i = 0; i < 8; i++) {
      const t = i / 7, y = 2.6 + t * 8.2, rad = 3.4 * (1 - t * 0.78);
      const cone = new THREE.ConeGeometry(rad, 1.0 + (1 - t) * 0.5, 9, 1, true);
      paint(cone, '#3f7a3c', '#2c5a2e', -0.6, 0.6);
      tiers.push({ geo: cone, matrix: M(0, y, 0, 0.72, 1, 0.72, 0, i * 0.5, 0), up: 0.9, uvWorld: true, two: true });
      const c2 = new THREE.ConeGeometry(rad, 0.9 + (1 - t) * 0.4, 9, 1, true);
      paint(c2, '#5a9a4a', '#35693a', -0.6, 0.6);
      shells.push({ geo: c2, matrix: M(0, y + 0.12, 0, 1, 1, 1, 0, i * 0.5 + 0.2, 0), up: 0.9, uvWorld: true, two: true });
    }
    G.conifer = { solid: merge([limb(0, 0, 0, 0, 11.4, 0, 0.24, 0.05, '#5d4a3a'), ...tiers]), shell: merge(shells) };
  }
  // 5: royal palm
  {
    const trunk = new THREE.CylinderGeometry(0.2, 0.34, 6.6, 9, 6, false);
    const tp = trunk.attributes.position;
    for (let i = 0; i < tp.count; i++) { const y = tp.getY(i) + 3.3, b = 1 + 0.22 * Math.exp(-((y - 1.6) * (y - 1.6)) / 2.2); tp.setX(i, tp.getX(i) * b); tp.setZ(i, tp.getZ(i) * b); }
    trunk.computeVertexNormals(); paint(trunk, '#ffffff', '#ffffff', 0, 0);
    const shaft = new THREE.CylinderGeometry(0.15, 0.22, 1.5, 8, 1, false); paint(shaft, '#6f9a4c', '#86b05a', -0.7, 0.7);
    const fr = [];
    const NF = 13;
    for (let i = 0; i < NF; i++) {
      const f = new THREE.PlaneGeometry(1.5, 4.4, 2, 7); f.translate(0, 2.2, 0);
      const p = f.attributes.position;
      for (let k = 0; k < p.count; k++) { const y = p.getY(k), x = p.getX(k); p.setZ(k, 0.1 * y * y + Math.abs(x) * 0.45); }
      f.computeVertexNormals(); paint(f, '#6fa046', '#5f8f3e', 0, 4.4);
      fr.push({ geo: f, matrix: new THREE.Matrix4().makeRotationY((i / NF) * Math.PI * 2 + (i % 2) * 0.2).multiply(M(0, 8.0, 0, 1, 1, 1, i % 3 === 0 ? 0.35 : i % 3 === 1 ? 0.8 : 1.15, 0, 0)), up: 1.4, two: true });
    }
    G.palm = { bark: merge([{ geo: trunk, matrix: M(0, 3.3, 0) }]), solid: merge([{ geo: shaft, matrix: M(0, 7.3, 0), uvWorld: true }]), frond: merge(fr) };
  }
  return G;
}

let MATS = null;
export function plantMaterials() {
  if (MATS) return MATS;
  const glow = (m) => {
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uGlow = foliageGlow;
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uGlow;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * uGlow;');
    };
    return m;
  };
  MATS = {
    solid: glow(new THREE.MeshLambertMaterial({ vertexColors: true, map: leafTex() })),
    shell: glow(new THREE.MeshLambertMaterial({ vertexColors: true, map: leafCutTex(), alphaTest: 0.45 })),
    frond: glow(new THREE.MeshLambertMaterial({ vertexColors: true, map: frondTex(), alphaTest: 0.4 })),
    bark: new THREE.MeshLambertMaterial({ vertexColors: true, map: barkTex() }),
  };
  return MATS;
}

// curated plants (roundabout etc.) are pushed here before buildTrees runs
export const extraPlants = [];
export const noTreeZones = [];       // [x, z, radius]

const SHELL_RANGE = 330;
const shellMeshes = [];
const originalMeshes = [];
export function updatePlantLOD(cam, now, visibleRange = Infinity) {
  updateDetailedTrees(cam, now, visibleRange);
  for (const m of originalMeshes) m.visible = cam.distanceTo(m.boundingSphere.center) - m.boundingSphere.radius < visibleRange;
  for (const m of shellMeshes) {
    const c = m.userData.c;
    m.visible = cam.y < 220 && Math.hypot(c[0] - cam.x, c[1] - cam.z) < SHELL_RANGE
      && cam.distanceTo(m.boundingSphere.center) - m.boundingSphere.radius < visibleRange;
  }
}

export function buildTrees(data, scene, height) {
  const G = plantGeometries();
  const mats = plantMaterials();
  const { trees: list, random: r } = createOriginalTrees(data, noTreeZones, extraPlants);
  const CH = 240;
  const buckets = new Map();
  for (const t of list) {
    const k = `${t.kind}|${Math.floor(t.x / CH)}|${Math.floor(t.z / CH)}`;
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(t);
  }
  const group = new THREE.Group();
  const d = new THREE.Object3D();
  const col = new THREE.Color();
  for (const [k, arr] of buckets) {
    const [kind, cx, cz] = k.split('|');
    const mx = [], cols = [];
    arr.forEach((t) => {
      d.position.set(t.x, height(t.x, t.z) - 0.08, t.z);
      d.rotation.set(0, t.rot ?? r() * 6.28, 0);
      const w = t.s * (kind === 'palm' || kind === 'conifer' ? 1 : 0.9 + r() * 0.25);
      d.scale.set(w, t.s, w);
      d.updateMatrix(); mx.push(d.matrix.clone());
      const v = 0.82 + r() * 0.34;
      cols.push(t.tint ? new THREE.Color(t.tint) : new THREE.Color().setRGB(v * (0.92 + r() * 0.18), v, v * (0.85 + r() * 0.2)));
    });
    // Keep the complete seeded transform stream stable for the original trees.
    const remaining = arr.map((_, i) => i);
    if (!remaining.length) continue;
    for (const part of Object.keys(G[kind])) {
      const im = new THREE.InstancedMesh(G[kind][part], mats[part], remaining.length);
      remaining.forEach((source, i) => { im.setMatrixAt(i, mx[source]); im.setColorAt(i, part === 'bark' ? col.set('#ffffff') : cols[source]); });
      im.castShadow = part !== 'shell'; im.receiveShadow = false;
      im.computeBoundingSphere();
      if (part !== 'shell') originalMeshes.push(im);
      if (part === 'shell') { im.userData.c = [(+cx + 0.5) * CH, (+cz + 0.5) * CH]; shellMeshes.push(im); }
      group.add(im);
    }
  }
  const companions = new URLSearchParams(location.search).get('trees') === 'original'
    ? [] : createCompanionTrees(data, list, noTreeZones);
  addTreeGroundDetail([...list, ...companions]);
  buildDetailedTrees(companions, scene, height);
  group.userData.population = { original: list.length, added: companions.length };
  group.name = 'Original trees';
  scene.add(group);
  return { group, count: list.length + companions.length, original: list.length, added: companions.length };
}
