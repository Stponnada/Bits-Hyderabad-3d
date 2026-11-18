import * as THREE from 'three';
import { Geo, pip } from './geo.js';
import { rng, plainTex, canvasTex } from './textures.js';
import { blob, merge, plantMaterials, noTreeZones, extraPlants } from './plants.js';

// The covered approach to the New Academic Block, from the Academic complex (SE) across the
// open gap south of the Auditorium. Surveyed from memory of the real campus (no 360 tour here):
//  - a flight of steps lifts you to a raised deck (~1 m);
//  - a wide, pillared, flat-roofed colonnade runs WSW toward the NAB (about 2x a normal path);
//  - a short left spur with 6 steps reaches a door in the Academic block;
//  - near the NAB the colonnade ends in steps down to the service road; you cross and climb a
//    few steps into the NAB entrance;
//  - clipped bushes act as low rails on both sides, with thin lawn behind;
//  - on the right (north) a ~1 m lawn ends at a fence, beyond which the ground drops to a barren
//    lower terrace (built in stage 2 with the car park).

const A = [-211, -266];          // foot of the entrance steps (Academic / SE end), on the f260 walkway
const Bn = [-261, -292];         // deck end near the NAB (before the down-steps)
const DECK = 1.0;                // raised deck height
const DW = 5.2;                  // deck width (~2x a 2.2 m path)
const CLEAR = 3.1, SLAB = 0.32;  // colonnade clear height and roof slab thickness
const RISER = 0.167, TREAD = 0.33;

const L = Math.hypot(Bn[0] - A[0], Bn[1] - A[1]);
const U = [(Bn[0] - A[0]) / L, (Bn[1] - A[1]) / L];     // along the walk (toward NAB)
const Rt = [U[1], -U[0]];        // right-hand normal (points north, toward the Auditorium)
const ang = Math.atan2(U[1], U[0]);
const P = (s, t, y = 0) => [A[0] + U[0] * s + Rt[0] * t, y, A[1] + U[1] * s + Rt[1] * t];

export function prepareAcademicWalk() {
  // keep scattered trees off the deck, the stair aprons and the thin side lawns
  for (let s = -8; s < L + 6; s += 4) for (const t of [0, 4.5, -4.5]) noTreeZones.push([A[0] + U[0] * s + Rt[0] * t, A[1] + U[1] * s + Rt[1] * t, 3.4]);
  // a couple of shade trees just off the deck on the academic side
  extraPlants.push({ x: A[0] + U[0] * 10 + Rt[0] * -7, z: A[1] + U[1] * 10 + Rt[1] * -7, kind: 'broad', s: 1.4 });
}

// ------------------------------------------------------------------ textures
function paverTex() {       // raised deck: grey-buff concrete pavers, 0.5 m
  const r = rng(711);
  return canvasTex(256, 256, (g) => {
    g.fillStyle = '#b9b3a4'; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      const v = 176 + r() * 16;
      g.fillStyle = `rgb(${v},${v - 4},${v - 12})`; g.fillRect(i * 64 + 2, j * 64 + 2, 60, 60);
    }
    for (let k = 0; k < 500; k++) { const s = r() < 0.5 ? 0 : 255; g.fillStyle = `rgba(${s},${s},${s},${r() * 0.05})`; g.fillRect(r() * 256, r() * 256, 2, 2); }
  });
}
function stepTex() { return plainTex('#a8a49b', 712, 0.1); }

export function buildAcademicWalk(scene, height, env) {
  const g = new THREE.Group();
  const r = rng(713);
  const add = (geo, mat, cast = true) => { const m = new THREE.Mesh(geo.build ? geo.build() : geo, mat); m.castShadow = cast; m.receiveShadow = true; g.add(m); return m; };
  const y0 = 0;                   // ground is flat along the corridor
  // place a box centred on a corridor point p = P(s, t): maps p[0],p[2] to box (cx, cz)
  const bx = (geo, p, w, d, ya, yb, a = ang, uv = 0.3) => geo.box(p[0], p[2], w, d, ya, yb, a, uv);

  const deckMat = new THREE.MeshStandardMaterial({ map: paverTex(), roughness: 0.9 });
  const whiteMat = new THREE.MeshStandardMaterial({ map: plainTex('#eceae2', 714, 0.04), roughness: 0.7 });
  const slabMat = new THREE.MeshStandardMaterial({ map: plainTex('#d8d4c8', 715, 0.05), roughness: 0.8 });
  const stepMat = new THREE.MeshStandardMaterial({ map: stepTex(), roughness: 0.9 });

  // ---- the raised deck slab
  { const geo = new Geo(); bx(geo, P(L / 2, 0), DW, L + 2, y0 - 0.3, y0 + DECK, ang + Math.PI / 2, 0.5); add(geo, deckMat, false); }

  // ---- entrance steps at the academic (SE) end, descending outward (−U)
  flight(g, add, stepMat, P(-1.0, 0, y0 + DECK), [-U[0], -U[1]], DECK, DW, ang);

  // ---- colonnade: paired pillars + a flat roof slab, over most of the deck
  {
    const pg = new Geo(), rg = new Geo();
    const hw = DW / 2 + 0.15, roofTop = y0 + DECK + CLEAR + SLAB;
    const n = Math.max(2, Math.round((L - 4) / 4.2));
    for (let i = 0; i <= n; i++) {
      const s = 2 + (L - 5) * i / n;
      for (const t of [-hw, hw]) bx(pg, P(s, t), 0.42, 0.42, y0 + DECK, y0 + DECK + CLEAR);
    }
    // roof slab (width across the walk, length along it)
    bx(rg, P(L / 2, 0), DW + 1.4, L - 4, y0 + DECK + CLEAR, roofTop, ang + Math.PI / 2, 0.25);
    // a thin fascia beam each side just under the slab
    for (const t of [-hw, hw]) bx(rg, P(L / 2, t), 0.3, L - 4, y0 + DECK + CLEAR - 0.35, y0 + DECK + CLEAR, ang + Math.PI / 2, 0.3);
    add(pg, whiteMat); add(rg, slabMat);
  }

  // ---- left spur with 6 steps into the Academic block (near the start, toward −Rt / south)
  {
    const sBranch = 7, spurLen = 4.5, bw = 3.6;
    const dir = [-Rt[0], -Rt[1]];                       // left (south, toward the academic)
    const start = P(sBranch, -DW / 2, 0);               // where the spur leaves the main deck
    const end = [start[0] + dir[0] * spurLen, start[2] + dir[1] * spurLen];
    const mid = [(start[0] + end[0]) / 2, (start[2] + end[1]) / 2];
    const spur = new Geo();
    spur.box(mid[0], mid[1], spurLen, bw, y0 + DECK - 0.1, y0 + DECK, Math.atan2(dir[1], dir[0]), 0.4);
    add(spur, deckMat, false);
    // 6 steps up from the spur end into the academic (continuing −Rt)
    flight(g, add, stepMat, [end[0], y0 + DECK, end[1]], dir, 6 * RISER, bw, Math.atan2(dir[1], dir[0]), 6, true);
  }

  // ---- NAB end: steps down to the road level, then a short landing and steps up to the entrance
  {
    const top = P(L + 1.0, 0, y0 + DECK);
    flight(g, add, stepMat, top, [U[0], U[1]], DECK, DW, ang);   // down to ground
    // up-steps into the NAB entrance a little further along
    const upBase = P(L + 7.5, 0, y0);
    flight(g, add, stepMat, upBase, [U[0], U[1]], 0.8, DW - 0.6, ang, 5);
  }

  // ---- bush rails along both deck edges, thin lawn + a light fence on the right (north)
  buildRailsAndLawn(g, add, height, r, y0);

  scene.add(g);
  return g;
}

// a stair flight: `steps` treads from `topOrBase` going in direction `dir`, total rise `rise`.
// If `up` is false (default) it descends from the given top point; if true it rises from a base.
function flight(g, add, mat, pt, dir, rise, width, rotAng, steps = null, up = false) {
  const ns = steps || Math.max(2, Math.round(rise / RISER));
  const geo = new Geo();
  const pr = [dir[1], -dir[0]];        // across the flight
  for (let k = 0; k < ns; k++) {
    const s0 = k * TREAD, s1 = (k + 1) * TREAD + 0.02;
    const cx = pt[0] + dir[0] * (s0 + s1) / 2, cz = pt[2] + dir[1] * (s0 + s1) / 2;
    const yTop = up ? pt[1] + (k + 1) * (rise / ns) : pt[1] - (k + 1) * (rise / ns) + rise;
    const yBot = up ? pt[1] - 0.3 : pt[1] - 0.3 - rise;
    geo.box(cx, cz, s1 - s0, width, Math.min(yBot, yTop - 0.2), yTop, rotAng, 0.4);
  }
  add(geo, mat);
}

function buildRailsAndLawn(g, add, height, r, y0) {
  const bushGeo = merge([{ geo: blob(1, 2, 0.8, 5, '#6f9a43', '#43672c', 0.35), up: 0.8, uvWorld: true }]);
  const mat = plantMaterials().solid;
  const list = [];
  const hw = DW / 2 + 0.35;
  for (let s = 1; s < L - 1; s += 1.5) for (const t of [-hw, hw]) list.push(P(s, t, y0 + DECK));
  const im = new THREE.InstancedMesh(bushGeo, mat, list.length);
  const d = new THREE.Object3D(), col = new THREE.Color();
  list.forEach((p, i) => { const sc = 0.5 + r() * 0.14; d.position.set(p[0], y0 + DECK + sc * 0.55, p[2]); d.rotation.set(0, r() * 6, 0); d.scale.set(sc, sc * 0.8, sc); d.updateMatrix(); im.setMatrixAt(i, d.matrix); im.setColorAt(i, col.set(r() < 0.5 ? '#6f9a43' : '#5c8838')); });
  im.castShadow = true; g.add(im);

  // thin lawn strips behind the bushes, and a light steel fence on the right (north) edge
  const lawnMat = new THREE.MeshStandardMaterial({ map: plainTex('#5c7c3c', 716, 0.1), roughness: 1 });
  const lg = new Geo();
  for (const side of [1, -1]) { const c = P(L / 2, side * (DW / 2 + 1.25)); lg.box(c[0], c[2], 1.1, L, y0 + DECK - 0.1, y0 + DECK - 0.02, ang + Math.PI / 2, 0.5); }
  add(lg, lawnMat, false);
  // fence posts + two rails along the right edge
  const fg = new Geo(), tF = DW / 2 + 1.9;
  for (let s = 0; s <= L; s += 2.4) { const c = P(s, tF); fg.box(c[0], c[2], 0.08, 0.08, y0 + DECK, y0 + DECK + 0.95, 0, 0.5); }
  const mc = P(L / 2, tF);
  for (const yy of [0.45, 0.9]) fg.box(mc[0], mc[2], 0.05, L, y0 + DECK + yy - 0.03, y0 + DECK + yy, ang + Math.PI / 2, 0.5);
  add(fg, new THREE.MeshStandardMaterial({ color: '#c7c4ba', roughness: 0.5, metalness: 0.4 }));
}
