import * as THREE from 'three';
import { Geo, centroid, pip, distToPoly, addFlatPoly } from './geo.js';
import { surfaceMaterial } from './surfaces.js';
import { rng, plainTex } from './textures.js';

// Wind-tunnel / Central Workshop site, digitised from current aerial imagery.
// The wind tunnel, workshop and washroom footprints are deliberately untouched.
// These are the three open parking canopies and their separate ground-level slab.
export const WORKSHOP_SLAB = [
  [-193.77, 25.33], [-164.73, 33.25], [-173.84, 62.94], [-198.32, 55.03],
];
const PARKING_1 = [
  [-156.76, 21.94], [-147.65, 25.05], [-159.04, 51.35], [-167.01, 48.24],
];
const PARKING_2 = [
  [-151.92, 38.06], [-124.02, 45.69], [-126.58, 53.33], [-155.05, 46.54],
];
const PARKING_3 = [
  [-146.51, 29.86], [-120.03, 37.49], [-122.31, 45.13], [-149.07, 37.78],
];

// Open, dry ground south of the slab. Large crowns here are thinned into scrub;
// displaced trees are moved (not deleted) into the dense belt beside the slab.
const SCRUB_FIELD = [
  [-174, 58], [-129, 52], [-112, 99], [-145, 125], [-187, 110], [-193, 70],
];
const DENSE_BELT = [
  [-211, 35], [-198, 34], [-194, 59], [-199, 88], [-219, 96], [-227, 75], [-218, 55],
];
const CLEARING_GROUND = [
  [-173.84, 62.94], [-151, 59], [-126, 57], [-119, 72], [-132, 86],
  [-154, 93], [-176, 83], [-195, 68], [-198.32, 55.03],
];

const SLAB_H = 0.06;
const CANOPY_FLOOR_H = 0.12;
const ROOF_H = 2.8;
const near = (p, q, d) => Math.hypot(p[0] - q[0], p[1] - q[1]) < d;
const hardSurfaces = () => [WORKSHOP_SLAB, PARKING_1, PARKING_2, PARKING_3];

function segmentDistance(x, z, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz);
}

// Keep the surveyed population constant while correcting the local cover.
// This runs before tree construction, so both originals and their companions
// observe the corrected slab/canopy exclusions.
export function prepareBikeParks(data) {
  if (data.workshopSitePrepared) return;
  data.workshopSitePrepared = true;
  const areas = data.areas || [];
  const oldMiddle = areas.find((a) => a.kind === 'bikepark' && near(centroid(a.pts), [-179.38, 40.69], 8));
  const oldEast = areas.find((a) => a.kind === 'bikepark' && near(centroid(a.pts), [-147.36, 38.34], 8));
  if (oldMiddle) oldMiddle.pts = PARKING_1.map((p) => [...p]);
  else areas.push({ kind: 'bikepark', name: '', pts: PARKING_1.map((p) => [...p]) });
  if (oldEast) oldEast.pts = PARKING_2.map((p) => [...p]);
  else areas.push({ kind: 'bikepark', name: '', pts: PARKING_2.map((p) => [...p]) });
  areas.push({ kind: 'bikepark', name: '', pts: PARKING_3.map((p) => [...p]) });
  areas.push({ kind: 'workshop_slab', name: '', pts: WORKSHOP_SLAB.map((p) => [...p]) });

  const surfaces = hardSurfaces();
  const blocked = (x, z) => {
    for (const b of data.buildings || []) {
      if (pip(x, z, b.outer) || distToPoly(x, z, b.outer) < 2) return true;
    }
    for (const p of surfaces) if (pip(x, z, p) || distToPoly(x, z, p) < 1.5) return true;
    for (const r of data.roads || []) {
      const margin = (r.kind === 'service' ? 5.6 : r.w || 3) / 2 + 2;
      for (let i = 0; i < r.pts.length - (r.closed ? 0 : 1); i++) {
        if (segmentDistance(x, z, r.pts[i], r.pts[(i + 1) % r.pts.length]) < margin) return true;
      }
    }
    return false;
  };
  const neighbours = data.trees.filter((t) => t[0] > -240 && t[0] < -185 && t[1] > 25 && t[1] < 105);
  const random = rng(7319);
  for (const t of data.trees) {
    const onConcrete = surfaces.some((p) => pip(t[0], t[1], p) || distToPoly(t[0], t[1], p) < 1.2);
    const inScrub = pip(t[0], t[1], SCRUB_FIELD);
    const thin = inScrub && Math.abs(Math.floor(t[0] * 7 + t[1] * 13)) % 4 === 0;
    if (!onConcrete && !thin) {
      if (inScrub) t[4] = 'scrub';
      continue;
    }
    // Golden-angle placement avoids grid-like planting while remaining stable.
    let placed = false;
    for (let attempt = 0; attempt < 500; attempt++) {
      const x = -229 + random() * 37, z = 32 + random() * 66;
      if (!pip(x, z, DENSE_BELT) || blocked(x, z)) continue;
      if (neighbours.some((q) => Math.hypot(q[0] - x, q[1] - z) < 1.7)) continue;
      t[0] = x; t[1] = z; neighbours.push(t); placed = true; break;
    }
    if (!placed) throw new Error('Unable to relocate a wind-tunnel clearing tree');
  }
}

function edgeSkirt(geo, pts, y0, y1) {
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    const dx = q[0] - p[0], dz = q[1] - p[1], len = Math.hypot(dx, dz);
    if (len < 0.05) continue;
    geo.quad([p[0], y0, p[1]], [p[0], y1, p[1]], [q[0], y1, q[1]], [q[0], y0, q[1]],
      [dz / len, 0, -dx / len], [0, 0], [0, 0.1], [len / 4, 0.1], [len / 4, 0]);
  }
}

export function buildBikeParks(data, scene, height = () => 0) {
  prepareBikeParks(data);
  const group = new THREE.Group();

  // The area around and just south of the slab is bare, compacted earth rather
  // than the bright lawn suggested by the older ground imagery.
  const clearing = new Geo();
  addFlatPoly(clearing, CLEARING_GROUND, [], 0.025, 1 / 5);
  const clearingMesh = new THREE.Mesh(clearing.build(), new THREE.MeshStandardMaterial({
    map: plainTex('#a58e6c', 173, 0.13), roughness: 1, polygonOffset: true,
    polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  }));
  clearingMesh.receiveShadow = true;
  group.add(clearingMesh);

  const concreteGeo = new Geo();
  addFlatPoly(concreteGeo, WORKSHOP_SLAB, [], height(-182.66, 44.14) + SLAB_H, 1 / 5);
  edgeSkirt(concreteGeo, WORKSHOP_SLAB, height(-182.66, 44.14), height(-182.66, 44.14) + SLAB_H);
  const concrete = new THREE.Mesh(concreteGeo.build(), surfaceMaterial('concrete', '#b8b3a7', {
    side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  }));
  concrete.receiveShadow = true;
  group.add(concrete);

  const floors = new Geo(), poles = new Geo(), roofs = new Geo();
  for (const shed of data.areas.filter((a) => a.kind === 'bikepark')) {
    const pts = shed.pts, c = centroid(pts), y0 = height(c[0], c[1]);
    addFlatPoly(floors, pts, [], y0 + CANOPY_FLOOR_H, 1 / 4);
    edgeSkirt(floors, pts, y0, y0 + CANOPY_FLOOR_H);
    addFlatPoly(roofs, pts, [], y0 + ROOF_H, 1 / 4);

    // Steel posts along the two long sides; the short ends remain open.
    const edges = pts.map((p, i) => ({ p, q: pts[(i + 1) % pts.length] }))
      .sort((a, b) => Math.hypot(b.q[0] - b.p[0], b.q[1] - b.p[1]) - Math.hypot(a.q[0] - a.p[0], a.q[1] - a.p[1]))
      .slice(0, 2);
    for (const { p, q } of edges) {
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      const n = Math.max(2, Math.round(len / 3) + 1);
      for (let j = 0; j < n; j++) {
        const x = p[0] + (q[0] - p[0]) * j / (n - 1), z = p[1] + (q[1] - p[1]) * j / (n - 1);
        poles.box(x, z, 0.14, 0.14, y0, y0 + ROOF_H);
      }
    }
  }
  const floorMesh = new THREE.Mesh(floors.build(), surfaceMaterial('concrete', '#bdb9ae', { side: THREE.DoubleSide }));
  floorMesh.receiveShadow = true;
  group.add(floorMesh);
  const roofMesh = new THREE.Mesh(roofs.build(), new THREE.MeshStandardMaterial({
    color: '#f3f1e9', roughness: 0.9, side: THREE.DoubleSide,
  }));
  roofMesh.castShadow = true;
  roofMesh.receiveShadow = true;
  group.add(roofMesh);
  const poleMesh = new THREE.Mesh(poles.build(), new THREE.MeshStandardMaterial({
    color: '#8d9399', roughness: 0.5, metalness: 0.6,
  }));
  poleMesh.castShadow = true;
  group.add(poleMesh);
  scene.add(group);
  return group;
}
