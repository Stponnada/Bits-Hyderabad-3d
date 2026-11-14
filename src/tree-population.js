import { rng } from './textures.js';
import { pip, distToPoly, bbox } from './geo.js';
import { GATE } from './world.js';

// Keep the original population and random stream stable when adding planting.
export function createOriginalTrees(data, noTreeZones, extraPlants) {
  const r = rng(5);
  const KIND = ['broad', 'tall', 'scrub'];
  const list = [];
  for (const t of data.trees) {
    if (noTreeZones.some((z) => Math.hypot(t[0] - z[0], t[1] - z[1]) < z[2])) continue;
    let kind = KIND[t[3]];
    const inside = pip(t[0], t[1], data.boundary);
    if (kind === 'broad' && !inside && distToPoly(t[0], t[1], data.boundary) > 60) kind = 'far';
    if (inside && kind === 'tall' && r() < 0.18) kind = 'conifer';
    list.push({ x: t[0], z: t[1], s: t[2] * (0.72 + r() * 0.3), kind });
  }
  // royal palms along Marine Drive (the sweep from the gate roundabout to the academic block)
  for (const road of data.roads) {
    if (road.kind === 'foot' || road.kind === 'path' || road.kind === 'track' || road.closed) continue;
    const mid = road.pts[road.pts.length >> 1];
    if (!(mid[0] > -150 && mid[0] < 70 && mid[1] > -400 && mid[1] < -20)) continue;
    let acc = 8;
    for (let i = 0; i < road.pts.length - 1; i++) {
      const a = road.pts[i], b = road.pts[i + 1];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 0.01) continue;
      const nx = -(b[1] - a[1]) / len, nz = (b[0] - a[0]) / len;
      while (acc < len) {
        const t = acc / len, x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t;
        for (const s of [-1, 1]) {
          const px = x + nx * s * 6.4, pz = z + nz * s * 6.4;
          if (!noTreeZones.some((q) => Math.hypot(px - q[0], pz - q[1]) < q[2] + 12)) list.push({ x: px, z: pz, s: 0.85 + r() * 0.3, kind: 'palm' });
        }
        acc += 24;
      }
      acc -= len;
    }
  }
  for (const p of extraPlants) list.push(p);
  // sparse scrub beyond the surveyed extent
  for (let i = 0; i < 5000; i++) {
    const a = r() * Math.PI * 2, d = 1000 + r() * 2200;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    const e = data.extent;
    if (x > e[0] && x < e[2] && z > e[1] && z < e[3]) continue;
    list.push({ x, z, s: 0.8 + r() * 0.8, kind: r() < 0.6 ? 'scrub' : 'far' });
  }
  return { trees: list, random: r };
}

class SpatialGrid {
  constructor(size) { this.size = size; this.cells = new Map(); }
  insert(box, item) {
    for (let x = Math.floor(box[0] / this.size); x <= Math.floor(box[2] / this.size); x++) {
      for (let z = Math.floor(box[1] / this.size); z <= Math.floor(box[3] / this.size); z++) {
        const key = `${x}|${z}`;
        if (!this.cells.has(key)) this.cells.set(key, []);
        this.cells.get(key).push(item);
      }
    }
  }
  at(x, z) { return this.cells.get(`${Math.floor(x / this.size)}|${Math.floor(z / this.size)}`) || []; }
}

function segmentDistance(x, z, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz);
}

export function createCompanionTrees(data, originals, noTreeZones = []) {
  const obstacles = new SpatialGrid(32), trunks = new SpatialGrid(4);
  const pad = (box, d) => [box[0] - d, box[1] - d, box[2] + d, box[3] + d];
  const addPolygon = (pts, margin) => obstacles.insert(pad(bbox(pts), margin), { pts, margin });
  // The modelled entrance replaces mapped guard booths, so its footprint is
  // absent from data.buildings. Reserve its cabin, portals and sign wall too.
  const c = Math.cos(GATE.ang), s = Math.sin(GATE.ang);
  addPolygon([[-36, -8], [19, -8], [19, 8], [-36, 8]].map(([x, z]) =>
    [GATE.x + c * x - s * z, GATE.z + s * x + c * z]), 2);
  for (const b of data.buildings) addPolygon(b.outer, 1.2);
  // Preserve all playable, paved and water areas. Grass and parks remain plantable.
  for (const area of data.areas) {
    if (!['grass', 'park'].includes(area.kind)) addPolygon(area.pts, 1.2);
  }
  for (const road of data.roads) {
    const foot = ['foot', 'path', 'track'].includes(road.kind);
    const margin = (road.kind === 'service' ? 5.6 : road.w || 3) / 2 + (foot ? 0.9 : 2.7);
    for (let i = 0; i < road.pts.length - (road.closed ? 0 : 1); i++) {
      const a = road.pts[i], b = road.pts[(i + 1) % road.pts.length];
      obstacles.insert(pad([Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])], margin), { a, b, margin });
    }
  }
  for (const [x, z, r] of noTreeZones) obstacles.insert([x - r - 1, z - r - 1, x + r + 1, z + r + 1], { x, z, radius: r + 1 });
  const register = (tree) => {
    const radius = Math.max(1.1, Math.min(2, tree.s * 1.3));
    trunks.insert([tree.x - radius, tree.z - radius, tree.x + radius, tree.z + radius], { ...tree, radius });
  };
  originals.forEach(register);
  const additions = [];
  originals.forEach((source, parent) => {
    const random = rng(1907 + parent * 7919);
    const inside = pip(source.x, source.z, data.boundary);
    const kind = ['tall', 'conifer'].includes(source.kind) ? 'tall' : 'broad';
    const s = source.s * (source.kind === 'scrub' ? 0.48 + random() * 0.14 : 0.78 + random() * 0.3);
    const phase = random() * Math.PI * 2;
    let placed = false;
    for (let attempt = 0; attempt < 600; attempt++) {
      const radius = attempt < 80 ? 2.8 + attempt * 0.18 : 17.2 + (attempt - 80) * 0.6;
      const angle = phase + attempt * 2.399963;
      const x = source.x + Math.cos(angle) * radius, z = source.z + Math.sin(angle) * radius;
      if (inside && !pip(x, z, data.boundary)) continue;
      if (trunks.at(x, z).some((t) => Math.hypot(x - t.x, z - t.z) < t.radius)) continue;
      if (obstacles.at(x, z).some((o) => o.pts
        ? pip(x, z, o.pts) || distToPoly(x, z, o.pts) < o.margin
        : o.a ? segmentDistance(x, z, o.a, o.b) < o.margin
          : Math.hypot(x - o.x, z - o.z) < o.radius)) continue;
      const tree = { x, z, s, kind, rot: random() * Math.PI * 2, parent };
      additions.push(tree); register(tree); placed = true; break;
    }
    // An exact one-for-one population must not silently lose trees to exclusions.
    if (!placed) throw new Error(`No clear planting position for tree ${parent}`);
  });
  return additions;
}
