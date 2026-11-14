import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createOriginalTrees, createCompanionTrees } from '../src/tree-population.js';
import { pip, bbox } from '../src/geo.js';
import { prepareRoundabout } from '../src/roundabout.js';
import { extraPlants, noTreeZones } from '../src/plants.js';
import { GATE } from '../src/world.js';

const data = JSON.parse(readFileSync(new URL('../public/campus.json', import.meta.url)));
prepareRoundabout(data);
const { trees: original } = createOriginalTrees(data, noTreeZones, extraPlants);
const savedOriginals = structuredClone(original);
const additions = createCompanionTrees(data, original, noTreeZones);

test('one additional tree per original, deterministically, across the full map', () => {
  assert.equal(original.length, 25558);
  assert.equal(additions.length, original.length);
  assert.equal(new Set(additions.map((t) => t.parent)).size, original.length);
  assert.deepEqual(original, savedOriginals);
  assert.deepEqual(additions, createCompanionTrees(data, original, noTreeZones));
  for (const [i, tree] of additions.entries()) {
    assert.equal(tree.parent, i);
    assert.ok(Number.isFinite(tree.x) && Number.isFinite(tree.z) && tree.s > 0);
    assert.ok(['broad', 'tall'].includes(tree.kind));
    assert.ok(Math.hypot(tree.x - original[i].x, tree.z - original[i].z) >= 2.79);
    if (pip(original[i].x, original[i].z, data.boundary)) assert.ok(pip(tree.x, tree.z, data.boundary));
  }
});

test('added trunks stay off buildings, roads, water, pitches and reserved areas', () => {
  // Independently scan the complete obstacle set, rather than using the
  // production spatial index, to catch missing or mis-indexed obstacles.
  const polygons = [...data.buildings.map((b) => b.outer),
    ...data.areas.filter((a) => !['grass', 'park'].includes(a.kind)).map((a) => a.pts)]
    .map((pts) => ({ pts, bounds: bbox(pts) }));
  const segments = data.roads.flatMap((road) => road.pts.slice(0, road.closed ? undefined : -1).map((a, i) => ({
    a, b: road.pts[(i + 1) % road.pts.length], radius: (road.kind === 'service' ? 5.6 : road.w || 3) / 2,
  })));
  for (const tree of additions) {
    const dx = tree.x - GATE.x, dz = tree.z - GATE.z;
    const localX = dx * Math.cos(GATE.ang) + dz * Math.sin(GATE.ang);
    const localZ = -dx * Math.sin(GATE.ang) + dz * Math.cos(GATE.ang);
    assert.ok(localX < -36 || localX > 19 || Math.abs(localZ) > 8, `tree ${tree.parent} overlaps the modelled gate`);
    for (const { pts, bounds: [x0, z0, x1, z1] } of polygons) {
      if (tree.x < x0 || tree.x > x1 || tree.z < z0 || tree.z > z1) continue;
      assert.ok(!pip(tree.x, tree.z, pts), `tree ${tree.parent} overlaps an area/building`);
    }
    for (const { a, b, radius } of segments) {
      if (tree.x < Math.min(a[0], b[0]) - radius || tree.x > Math.max(a[0], b[0]) + radius
        || tree.z < Math.min(a[1], b[1]) - radius || tree.z > Math.max(a[1], b[1]) + radius) continue;
      const vx = b[0] - a[0], vz = b[1] - a[1], wx = tree.x - a[0], wz = tree.z - a[1];
      const along = Math.max(0, Math.min(1, (wx * vx + wz * vz) / (vx * vx + vz * vz || 1)));
      assert.ok(Math.hypot(wx - along * vx, wz - along * vz) >= radius, `tree ${tree.parent} is on a road`);
    }
    for (const [x, z, radius] of noTreeZones) assert.ok(Math.hypot(tree.x - x, tree.z - z) >= radius);
  }
});
