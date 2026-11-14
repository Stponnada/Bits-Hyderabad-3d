import { surfaceMaterial } from './surfaces.js';
import * as THREE from 'three';
import { Geo, addFlatPoly } from './geo.js';
import { rng, canvasTex, paverTex, grassTex, plainTex } from './textures.js';
import { leafTex, blob, merge, plantMaterials, extraPlants, noTreeZones, foliageGlow } from './plants.js';

// Entrance roundabout just inside the main gate (centre and radius of the mapped ring road)
export const RB = { x: -66.9, z: -369.4, r: 31.2, roadW: 5.6 };

export function prepareRoundabout(data) {
  // drop the mapped footpath ring and the placeholder fountain: the island is modelled by hand
  data.roads = data.roads.filter((r) => !(r.kind === 'foot' && r.closed && Math.hypot(r.pts[0][0] - RB.x, r.pts[0][1] - RB.z) < 40));
  data.areas = data.areas.filter((a) => !(a.kind === 'fountain' && Math.hypot(a.pts[0][0] - RB.x, a.pts[0][1] - RB.z) < 40));
  noTreeZones.push([RB.x, RB.z, RB.r - RB.roadW / 2]);
  const P = (ang, rad, kind, s, extra = {}) => extraPlants.push({ x: RB.x + Math.cos(ang) * rad, z: RB.z + Math.sin(ang) * rad, kind, s, ...extra });
  // curated planting, after the reference photo: tiered conifers, a spreading tree, royal palms
  P(0.6, 13, 'conifer', 1.0); P(1.5, 16, 'conifer', 0.85); P(3.9, 15, 'conifer', 0.9);
  P(2.6, 12, 'broad', 1.25); P(5.2, 14, 'broad', 1.1); P(0.0, 19, 'tall', 0.9);
  P(4.4, 19, 'palm', 0.8); P(4.75, 18.5, 'palm', 0.72); P(3.2, 19, 'palm', 0.78); P(2.0, 20, 'palm', 0.7);
}

function ring(geo, r0, r1, y, a0 = 0, a1 = Math.PI * 2, uvS = 0.3) {
  const n = Math.max(6, Math.ceil(((a1 - a0) * r1) / 1.6));
  for (let i = 0; i < n; i++) {
    const t0 = a0 + ((a1 - a0) * i) / n, t1 = a0 + ((a1 - a0) * (i + 1)) / n;
    const p = (t, r) => [RB.x + Math.cos(t) * r, y, RB.z + Math.sin(t) * r];
    const u = (t, r) => [t * r1 * uvS, r * uvS];
    // winding chosen so the face points up
    geo.quad(p(t0, r0), p(t1, r0), p(t1, r1), p(t0, r1), [0, 1, 0], u(t0, r0), u(t1, r0), u(t1, r1), u(t0, r1));
  }
}
// clipped hedge: a low wall with rounded-ish top following an arc
function hedge(geo, rad, w, h, a0, a1, colTop, colBot) {
  const n = Math.max(4, Math.ceil(((a1 - a0) * rad) / 1.2));
  const ct = new THREE.Color(colTop), cb = new THREE.Color(colBot);
  const prof = [[-w / 2, 0, cb], [-w / 2, h * 0.8, ct], [-w / 4, h, ct], [w / 4, h, ct], [w / 2, h * 0.8, ct], [w / 2, 0, cb]];
  for (let i = 0; i < n; i++) {
    const t0 = a0 + ((a1 - a0) * i) / n, t1 = a0 + ((a1 - a0) * (i + 1)) / n;
    const wob = (t) => 1 + 0.06 * Math.sin(t * 37) + 0.04 * Math.sin(t * 91);
    for (let k = 0; k < prof.length - 1; k++) {
      const A = prof[k], B = prof[k + 1];
      const pt = (t, q) => { const rr = rad + q[0]; return [RB.x + Math.cos(t) * rr, q[1] * wob(t + q[0]), RB.z + Math.sin(t) * rr]; };
      const a = pt(t0, A), b = pt(t0, B), c = pt(t1, B), d = pt(t1, A);
      const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
      let nn = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const l = Math.hypot(...nn) || 1; nn = nn.map((v) => v / l);
      const uv = (p) => [(p[0] + p[2]) * 0.5, p[1] * 0.9 + p[0] * 0.3];
      const i0 = geo.vert(a, nn, ...uv(a)); geo.vert(b, nn, ...uv(b)); geo.vert(c, nn, ...uv(c)); geo.vert(d, nn, ...uv(d));
      geo.i.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3);
      (geo.c ||= []).push(...A[2].toArray(), ...B[2].toArray(), ...B[2].toArray(), ...A[2].toArray());
    }
    if (i === 0 || i === n - 1) { /* open ends are hidden by neighbouring shrubs */ }
  }
}

export function buildRoundabout(scene, env) {
  const g = new THREE.Group();
  const rIn = RB.r - RB.roadW / 2;                 // inner edge of the carriageway
  const poly = { polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 };
  // red paver footpath hugging the kerb, lawn inside
  const pav = new Geo(); ring(pav, rIn - 3.0, rIn - 0.32, 0.09, 0, Math.PI * 2, 0.62);
  const pm = new THREE.Mesh(pav.build(), surfaceMaterial('pavers', '#a66b55', { side: THREE.DoubleSide, ...poly })); pm.receiveShadow = true; g.add(pm);
  const lawn = new Geo();
  const disc = []; for (let i = 0; i < 48; i++) disc.push([RB.x + Math.cos((i / 48) * 6.2832) * (rIn - 3.0), RB.z + Math.sin((i / 48) * 6.2832) * (rIn - 3.0)]);
  addFlatPoly(lawn, disc, [], 0.06, 1 / 5);
  const lm = new THREE.Mesh(lawn.build(), new THREE.MeshStandardMaterial({ map: grassTex(), roughness: 1, ...poly })); lm.receiveShadow = true; g.add(lm);

  // hedges: bright duranta border with gaps, darker clipped hedge behind it
  const hg = new Geo();
  const gaps = [0.2, 1.75, 3.35, 4.9];
  for (let k = 0; k < gaps.length; k++) {
    const a0 = gaps[k] + 0.09, a1 = gaps[(k + 1) % gaps.length] - 0.09 + (k === gaps.length - 1 ? Math.PI * 2 : 0);
    hedge(hg, rIn - 3.9, 1.3, 0.85, a0, a1, '#b4c43c', '#6f8a2c');
    hedge(hg, rIn - 5.6, 1.6, 1.25, a0 + 0.18, a1 - 0.3, '#4f7a34', '#2f4d24');
  }
  for (let k = 0; k < 5; k++) hedge(hg, 9.5 + (k % 2) * 1.2, 1.2, 0.7, k * 1.26, k * 1.26 + 0.8, k % 2 ? '#c8cf3e' : '#8a3a52', k % 2 ? '#7d8f2c' : '#5a2438');
  const hgeo = hg.build(); hgeo.setAttribute('color', new THREE.Float32BufferAttribute(hg.c, 3));
  const hedgeMat = new THREE.MeshLambertMaterial({ map: leafTex(), vertexColors: true, side: THREE.DoubleSide });
  hedgeMat.onBeforeCompile = (sh) => {
    sh.uniforms.uGlow = foliageGlow;
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uGlow;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * uGlow;');
  };
  const hm = new THREE.Mesh(hgeo, hedgeMat); hm.castShadow = true; hm.receiveShadow = true; g.add(hm);

  // flower beds: low mounds of colour between the hedges and the lawn
  const r = rng(77);
  const mats = plantMaterials();
  const shrub = merge([{ geo: blob(1, 1, 0.7, 3, '#ffffff', '#9a9a9a', 0.3), up: 0.8, uvWorld: true }]);
  const beds = [];
  const bed = (ang, rad, n, cols, s) => { for (let i = 0; i < n; i++) beds.push({ a: ang + (r() - 0.5) * 0.5, rad: rad + (r() - 0.5) * 2.2, s: s * (0.7 + r() * 0.6), c: cols[Math.floor(r() * cols.length)] }); };
  bed(0.9, 20, 16, ['#e58a2a', '#f0b63a', '#d9682a'], 0.55);
  bed(2.4, 20.5, 14, ['#c9d24a', '#e8d84a', '#9fc04a'], 0.6);
  bed(4.1, 20, 14, ['#b03a5a', '#d05a7a', '#8a2a4a'], 0.55);
  bed(5.5, 20.5, 12, ['#f2f2ea', '#e9e2c8', '#7da84a'], 0.6);
  bed(1.3, 6.5, 12, ['#8a2a4a', '#b03a5a', '#c9d24a'], 0.6);
  bed(4.3, 6.8, 12, ['#e58a2a', '#c9d24a', '#4f7a34'], 0.6);
  const bm = new THREE.InstancedMesh(shrub, mats.solid, beds.length);
  const d = new THREE.Object3D(); const col = new THREE.Color();
  beds.forEach((b, i) => { d.position.set(RB.x + Math.cos(b.a) * b.rad, b.s * 0.45, RB.z + Math.sin(b.a) * b.rad); d.rotation.set(0, r() * 6, 0); d.scale.set(b.s * 1.3, b.s, b.s * 1.3); d.updateMatrix(); bm.setMatrixAt(i, d.matrix); bm.setColorAt(i, col.set(b.c)); });
  bm.castShadow = true; g.add(bm);

  // potted topiary on the footpath
  const potProfile = [[0.0, 0], [0.34, 0], [0.38, 0.06], [0.5, 0.62], [0.56, 0.66], [0.56, 0.74], [0.46, 0.74], [0.44, 0.7]].map(([x, y]) => new THREE.Vector2(x, y));
  const potGeo = new THREE.LatheGeometry(potProfile, 14);
  const ballGeo = merge([{ geo: blob(0.95, 2, 0.92, 5, '#5f8f3c', '#2f5226', 0.22), matrix: new THREE.Matrix4().makeTranslation(0, 1.55, 0), up: 0.7, uvWorld: true }]);
  const stemGeo = new THREE.CylinderGeometry(0.05, 0.07, 0.6, 5); stemGeo.translate(0, 0.95, 0);
  const NP = 9;
  const pots = new THREE.InstancedMesh(potGeo, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85 }), NP);
  const balls = new THREE.InstancedMesh(ballGeo, mats.solid, NP);
  const stems = new THREE.InstancedMesh(stemGeo, new THREE.MeshLambertMaterial({ color: '#5a4636' }), NP);
  for (let i = 0; i < NP; i++) {
    const a = 0.45 + (i / NP) * Math.PI * 2, rad = rIn - 2.55, s = 0.85 + r() * 0.45;
    d.position.set(RB.x + Math.cos(a) * rad, 0.09, RB.z + Math.sin(a) * rad); d.rotation.set(0, r() * 6, 0); d.scale.setScalar(s); d.updateMatrix();
    pots.setMatrixAt(i, d.matrix); balls.setMatrixAt(i, d.matrix); stems.setMatrixAt(i, d.matrix);
    pots.setColorAt(i, col.set(i % 3 === 1 ? '#d9924a' : '#c8704a')); balls.setColorAt(i, col.set('#ffffff'));
  }
  for (const m of [pots, balls, stems]) { m.castShadow = true; m.receiveShadow = true; g.add(m); }

  // stepped stone plinth at the centre
  const stone = new THREE.MeshStandardMaterial({ roughness: 0.95, map: canvasTex(256, 256, (c, w, h) => {
    const q = rng(55); c.fillStyle = '#8f8a80'; c.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 32) for (let x = -32; x < w; x += 64) {
      const xx = x + ((y / 32) % 2) * 32, v = 120 + q() * 60;
      c.fillStyle = `rgb(${v},${v * 0.98},${v * 0.93})`; c.fillRect(xx + 2, y + 2, 60, 28);
    }
  }) });
  const sg = new Geo();
  const tiers = [[7.2, 0.38], [6.0, 0.76], [4.8, 1.14], [3.6, 1.52]];
  for (const [w, top] of tiers) sg.box(RB.x, RB.z, w, w, 0, top, 0.5, 0.35);
  const sm = new THREE.Mesh(sg.build(), stone); sm.castShadow = true; sm.receiveShadow = true; g.add(sm);
  const white = surfaceMaterial('concrete', '#e0dbce');
  const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 1.25, 2.1, 4), white);
  ped.position.set(RB.x, 1.52 + 1.05, RB.z); ped.rotation.y = 0.5 + Math.PI / 4; ped.castShadow = true; g.add(ped);
  const cap = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.2, 1.5), white); cap.position.set(RB.x, 1.52 + 2.2, RB.z); cap.rotation.y = 0.5; cap.castShadow = true; g.add(cap);

  scene.add(g);
  return g;
}
