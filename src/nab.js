import * as THREE from 'three';
import { Geo, pip, distToPoly, addRibbon } from './geo.js';
import { rng, canvasTex, plainTex, grassTex, courtTex } from './textures.js';
import { heightMods, fbm } from './world.js';
import { noTreeZones, extraPlants } from './plants.js';
import { hedgeLine, hedgeMesh } from './garden.js';

// New Academic Block: white wings on grassed mounds around a deeply sunken courtyard.
// From the chess board the cross axis runs east up a stone retaining wall (twin stair flights)
// to the red auditorium, and west up a long terraced stair to a bridge between the wings;
// the long axis is a hedged brick path running out between the wings at both ends.
const C = [-349, -267], U = [0.466, -0.885], V = [0.885, 0.466];
const D = 4.5, WALL_V = 15, STAIR0 = 12, STAIR_RUN = 18, NSTEP = 30;
export const NAB_RECT = { o: [C[0] - U[0] * 62 - V[0] * 36, C[1] - U[1] * 62 - V[1] * 36], e: U, len: 124, wid: 72 };
const NAB_ID = 20022715;
let outer = null;
const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const P = (u, v) => [C[0] + U[0] * u + V[0] * v, C[1] + U[1] * u + V[1] * v];
const loc = (x, z) => [(x - C[0]) * U[0] + (z - C[1]) * U[1], (x - C[0]) * V[0] + (z - C[1]) * V[1]];

export function nabHeight(x, z) {
  if (!outer) return 0;
  const [u, v] = loc(x, z);
  if (Math.abs(u) > 60 || v > WALL_V || v < -(STAIR0 + STAIR_RUN) || pip(x, z, outer)) return 0;
  const fu = 1 - sstep(36, 58, Math.abs(u));
  const dist = distToPoly(x, z, outer);
  let h = -D * fu * sstep(1.5, 12, dist);
  // a level floor around the chess board, the cafe and the foot of the stairs
  const flat = (1 - sstep(13, 18, Math.abs(u))) * (1 - sstep(9, 12.5, Math.abs(v))) * sstep(0.5, 3, dist);
  h = h * (1 - flat) - D * flat;
  // twin stair flights rising along the face of the east retaining wall
  if (v > WALL_V - 2.6 && Math.abs(u) > 3 && Math.abs(u) < 20) h = Math.max(h, -D + (D * (Math.abs(u) - 3)) / 17);
  // the long west stair and the terraces beside it
  if (v < -STAIR0) {
    const k = Math.min(NSTEP, Math.floor((-STAIR0 - v) / (STAIR_RUN / NSTEP)) + 1);
    h = Math.max(h, -D + (k * D) / NSTEP);
  }
  return Math.min(0, h);
}

export function prepareNab(data) {
  const nab = data.buildings.find((b) => b.id === NAB_ID);
  if (!nab) return;
  outer = nab.outer;
  nab.kind = 'nab'; nab.levels = 3;
  for (const b of data.buildings) if (b.on === NAB_ID) b.kind = 'nab';
  data.areas = data.areas.filter((a) => !/Chess/.test(a.name));
  // the mapped cafe kiosk and footpaths are replaced by the modelled courtyard
  data.buildings = data.buildings.filter((b) => !/Goutham/.test(b.name));
  for (const rd of data.roads) {
    if (rd.kind !== 'foot' && rd.kind !== 'path') continue;
    const m = rd.pts[rd.pts.length >> 1], [u, v] = loc(m[0], m[1]);
    if (Math.abs(u) < 58 && Math.abs(v) < 32) rd.garden = true;
  }
  heightMods.push(nabHeight);
  for (let u = -50; u <= 50; u += 10) noTreeZones.push([...P(u, 0), 13], [...P(u, -18), 10]);
  noTreeZones.push([...P(0, 22), 14], [...P(9.5, -8.6), 6]);
  const T = (u, v, kind, s) => extraPlants.push({ x: P(u, v)[0], z: P(u, v)[1], kind, s });
  for (const [u, v] of [[14, -7], [26, 7], [38, -6], [-14, 7], [-26, -7], [-38, 6], [9, 10], [-9, -10]]) T(u, v, 'tall', 0.85);
  T(4, -16, 'palm', 0.7); T(-4.5, -22, 'palm', 0.75);
}

function stoneTex() {
  return canvasTex(256, 256, (g, w, h) => {
    const r = rng(1201); g.fillStyle = '#4c4b46'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 26) { let x = -r() * 30; while (x < w) { const bw = 24 + r() * 30, v = 120 + r() * 50; g.fillStyle = `rgb(${v},${v},${v * 0.95})`; g.beginPath(); g.roundRect(x + 2, y + 2 + r() * 3, bw - 3, 20, 4); g.fill(); x += bw; } }
  });
}

export function buildNab(scene, height, env) {
  if (!outer) return null;
  const g = new THREE.Group();
  const r = rng(1203);
  const white = new THREE.MeshStandardMaterial({ map: plainTex('#f1f2f3', 1210, 0.04), roughness: 0.85 });
  const stone = new THREE.MeshStandardMaterial({ map: stoneTex(), roughness: 1 });
  const step = new THREE.MeshStandardMaterial({ map: plainTex('#5d6470', 1211, 0.1), roughness: 0.9 });
  const ang = Math.atan2(U[1], U[0]);
  const mk = (geo, mat, cast = true) => { const m = new THREE.Mesh(geo.build(), mat); m.castShadow = cast; m.receiveShadow = true; g.add(m); return m; };
  // box with its long side along U: (u, v) centre, lu x lv
  const B = (geo, u, v, lu, lv, y0, y1, uv = 0.3) => { const p = P(u, v); geo.box(p[0], p[1], lu, lv, y0, y1, ang, uv); };

  // ---- fine terrain
  {
    const geo = new Geo(), cols = [], R = NAB_RECT, nu = R.len, nv = R.wid;
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
      const x = R.o[0] + U[0] * i + V[0] * j, z = R.o[1] + U[1] * i + V[1] * j;
      geo.vert([x, height(x, z) - (pip(x, z, outer) ? 0.3 : 0), z], [0, 1, 0], x / 5, z / 5);
      const n = 0.9 + 0.2 * fbm(x / 6, z / 6); cols.push(0.82 * n, 1.0 * n, 0.62 * n);
    }
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 2, d = a + nu + 1; geo.i.push(a, d, c, a, c, b); }
    const bg = geo.build(); bg.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3)); bg.computeVertexNormals();
    const m = new THREE.Mesh(bg, new THREE.MeshStandardMaterial({ map: grassTex(), vertexColors: true, roughness: 1, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }));
    m.receiveShadow = true; g.add(m);
  }

  // ---- east: stone retaining wall, stair flights, auditorium portico above
  {
    const sg = new Geo(), wg = new Geo(), tg = new Geo();
    B(sg, 0, WALL_V + 0.5, 46, 1.2, -D - 0.3, 0.7, 0.35);
    for (const s of [-1, 1]) {
      for (let k = 0; k < NSTEP; k++) B(tg, s * (3 + (k + 0.5) * (17 / NSTEP)), WALL_V - 1.3, 17 / NSTEP, 2.4, -D - 0.2, -D + ((k + 1) * D) / NSTEP + 0.03);
      B(sg, s * 11.5, WALL_V - 2.7, 17.5, 0.35, -D - 0.2, -1.6, 0.35);            // balustrade wall (lower part)
      // two white frames with a lattice screen, under one flat projecting roof
      for (const [du, dv] of [[-2.2, -2], [2.2, -2], [-2.2, 2], [2.2, 2]]) B(wg, s * 7 + du, WALL_V + 6 + dv, 0.7, 0.7, 0, 7.4);
      B(wg, s * 7, WALL_V + 6, 5.1, 4.7, 5.6, 6.3); B(wg, s * 7, WALL_V + 6, 5.1, 4.7, 0, 0.8);
      const jali = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 4.6), new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, transparent: true, alphaTest: 0.4, roughness: 0.8, map: canvasTex(128, 128, (c) => {
        c.clearRect(0, 0, 128, 128); c.strokeStyle = '#8a4a34'; c.lineWidth = 5; for (let i = 0; i <= 128; i += 21) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i, 128); c.moveTo(0, i); c.lineTo(128, i); c.stroke(); } c.strokeRect(30, 30, 68, 68);
      }, { repeat: false }) }));
      const jp = P(s * 7, WALL_V + 4); jali.position.set(jp[0], 3.2, jp[1]); jali.rotation.y = -ang; g.add(jali);
    }
    B(wg, 0, WALL_V + 6, 25, 8.5, 7.4, 7.9);
    mk(sg, stone); mk(wg, white); mk(tg, step);
  }

  // ---- west: the long stair, terraces with hedges, and the bridge between the wings
  const hg = new Geo();
  {
    const tg = new Geo(), run = STAIR_RUN / NSTEP;
    for (let k = 0; k < NSTEP; k++) B(tg, 0, -STAIR0 - (k + 0.5) * run, 6, run, -D - 0.3, -D + ((k + 1) * D) / NSTEP + 0.04);
    for (const s of [-1, 1]) for (const v of [-16.5, -21.5, -26.5]) {
      const a = P(s * 4.4, v), b = P(s * 19, v);
      hedgeLine(hg, [a, b], 1.1, 0.7, '#5c8c38', '#2f5226', height, (x, z) => pip(x, z, outer) || distToPoly(x, z, outer) < 2, 0.05);
    }
    mk(tg, step);
  }

  // ---- the chess board, its pieces, and planting around it
  {
    const board = new THREE.Mesh(new THREE.PlaneGeometry(10.7, 10.7), new THREE.MeshStandardMaterial({ map: (() => { const t = courtTex('chess', ''); return t; })(), color: '#c9c4ba', roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
    board.rotation.order = 'YXZ'; board.rotation.y = -ang; board.rotation.x = -Math.PI / 2; board.position.set(C[0], -D + 0.06, C[1]); board.receiveShadow = true; g.add(board);
    const pg = new Geo(); B(pg, 0, 0, 15, 15, -D - 0.2, -D + 0.03, 0.4);
    mk(pg, new THREE.MeshStandardMaterial({ map: plainTex('#a7a39a', 1220, 0.08), roughness: 0.9 }), false);
    const prof = [[0, 0], [0.26, 0], [0.28, 0.08], [0.14, 0.2], [0.1, 0.62], [0.17, 0.7], [0.08, 0.78], [0.16, 0.92], [0.12, 1.02], [0, 1.08]].map(([x, y]) => new THREE.Vector2(x, y));
    const pawn = new THREE.LatheGeometry(prof, 12);
    for (const [colr, side] of [['#f2f2ee', 1], ['#1c1c1e', -1]]) {
      const im = new THREE.InstancedMesh(pawn, new THREE.MeshStandardMaterial({ color: colr, roughness: 0.5 }), 16);
      const d = new THREE.Object3D();
      for (let i = 0; i < 16; i++) { const p = P((i % 8 - 3.5) * 1.34 + (r() - 0.5) * 0.5, side * (i < 8 ? 4.7 : 3.4) + (r() - 0.5) * 0.4); d.position.set(p[0], -D + 0.06, p[1]); d.scale.setScalar(i < 8 ? 1.15 : 0.9); d.updateMatrix(); im.setMatrixAt(i, d.matrix); }
      im.castShadow = true; g.add(im);
    }
    // clipped hedges round the plaza and bronze-red shrubs lining the brick path
    for (const s of [-1, 1]) {
      hedgeLine(hg, [P(-7.6, s * 8.6), P(-2.6, s * 8.6)], 1.3, 0.8, '#5c8c38', '#2f5226', height, null, 0.04);
      hedgeLine(hg, [P(2.6, s * 8.6), P(7.6, s * 8.6)], 1.3, 0.8, '#5c8c38', '#2f5226', height, null, 0.04);
      for (const e of [-1, 1]) {
        hedgeLine(hg, [P(e * 9.5, s * 2.6), P(e * 34, s * 2.6)], 1.5, 0.95, '#b5613f', '#5d3a26', height, null, 0.14);
        hedgeLine(hg, [P(e * 9.5, s * 4.3), P(e * 34, s * 4.3)], 1.2, 0.6, '#a9c244', '#5f7f2c', height, null, 0.1);
      }
    }
    // brick path along the long axis, laid on the slope
    const bg = new Geo();
    for (const e of [-1, 1]) {
      const line = []; for (let u = 7.4; u <= 56; u += 1) line.push(P(e * u, 0));
      addRibbon(bg, line, 3.2, (x, z) => height(x, z) + 0.07, { vScale: 1 / 3, uRep: 1, maxSeg: 1 });
    }
    mk(bg, new THREE.MeshStandardMaterial({ map: plainTex('#c98a4e', 1221, 0.1, 6), roughness: 0.95, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }), false);
  }
  // ---- Goutham Cafe: a small kiosk on the level floor at the foot of the west stair
  {
    const kg = new Geo(); B(kg, 9.5, -8.6, 5, 3.6, -D, -D + 3); B(kg, 9.5, -8.2, 5.6, 4.8, -D + 3, -D + 3.2);
    mk(kg, white);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 1.9), new THREE.MeshStandardMaterial({ roughness: 0.5, map: canvasTex(512, 220, (c) => {
      c.fillStyle = '#f1f2f3'; c.fillRect(0, 0, 512, 220); c.fillStyle = '#8a4a34'; c.fillRect(0, 0, 512, 60);
      c.fillStyle = '#fff'; c.font = '700 40px sans-serif'; c.textAlign = 'center'; c.fillText('GOUTHAM CAFE', 256, 44);
      c.fillStyle = '#26323c'; c.fillRect(40, 80, 432, 90); c.fillStyle = '#c9c4ba'; c.fillRect(30, 170, 452, 12);
    }, { repeat: false }) }));
    const sp = P(9.5, -6.75); sign.position.set(sp[0], -D + 1.75, sp[1]); sign.rotation.y = -ang + Math.PI; g.add(sign);
    const s2 = sign.clone(); s2.rotation.y = -ang; g.add(s2);
  }
  g.add(hedgeMesh(hg));

  // ---- round stair towers with an open colonnade under a disc roof
  for (const [x, z] of [[-347, -293], [-371, -247]]) {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(4.3, 4.3, 17, 28), white); body.position.set(x, 3.5, z); body.castShadow = true; body.receiveShadow = true; g.add(body);
    for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; const col = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 3.2, 6), white); col.position.set(x + Math.cos(a) * 4.0, 13.6, z + Math.sin(a) * 4.0); g.add(col); }
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(5.3, 5.3, 0.45, 32), white); roof.position.set(x, 15.4, z); roof.castShadow = true; g.add(roof);
    const dark = new THREE.MeshStandardMaterial({ color: '#23272e', roughness: 0.4 });
    for (let i = 0; i < 6; i++) { const a = i * 1.05 + 0.4, w = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.9, 0.2), dark); w.position.set(x + Math.cos(a) * 4.28, 2 + (i % 3) * 3.2, z + Math.sin(a) * 4.28); w.rotation.y = -a + Math.PI / 2; g.add(w); }
  }
  scene.add(g);
  return g;
}
