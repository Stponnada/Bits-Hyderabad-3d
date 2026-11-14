import { bbox, pip, distToPoly } from './geo.js';

export const FOREST = { x: -510, z: -148, rx: 42, rz: 68 };
export const pilotForestDistance = (x, z) => Math.hypot((x - FOREST.x) / FOREST.rx, (z - FOREST.z) / FOREST.rz);
let field = null;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (v, a, b) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

function sample(values, x, z, outside) {
  if (!field) return outside;
  const px = (x - field.bounds[0]) / field.step, pz = (z - field.bounds[1]) / field.step;
  if (px < 0 || pz < 0 || px >= field.width - 1 || pz >= field.height - 1) return outside;
  const ix = Math.floor(px), iz = Math.floor(pz), u = px - ix, v = pz - iz, i = iz * field.width + ix;
  return (values[i] * (1 - u) + values[i + 1] * u) * (1 - v)
    + (values[i + field.width] * (1 - u) + values[i + field.width + 1] * u) * v;
}

export function configureForestZones(data, gate) {
  const b = bbox(data.boundary), step = 3;
  const bounds = [Math.floor((b[0] - 30) / step) * step, Math.floor((b[1] - 30) / step) * step, b[2] + 30, b[3] + 30];
  const width = Math.ceil((bounds[2] - bounds[0]) / step) + 1, height = Math.ceil((bounds[3] - bounds[1]) / step) + 1;
  bounds[2] = bounds[0] + (width - 1) * step; bounds[3] = bounds[1] + (height - 1) * step;
  const raw = new Float32Array(width * height), selected = raw.slice(), cover = raw.slice();
  const trees = new Map(), obstacles = new Map();
  const put = (map, bounds, value, cell) => {
    for (let x = Math.floor(bounds[0] / cell); x <= Math.floor(bounds[2] / cell); x++) for (let z = Math.floor(bounds[1] / cell); z <= Math.floor(bounds[3] / cell); z++) {
      const key = `${x}|${z}`; if (!map.has(key)) map.set(key, []); map.get(key).push(value);
    }
  };
  for (const t of data.trees) put(trees, [t[0], t[1], t[0], t[1]], t, 24);
  for (const pts of [...data.buildings.map((o) => o.outer), ...data.areas.filter((a) => !['grass', 'park'].includes(a.kind)).map((a) => a.pts)]) {
    const q = bbox(pts); put(obstacles, [q[0] - 3, q[1] - 3, q[2] + 3, q[3] + 3], { pts }, 32);
  }
  for (const road of data.roads) {
    const foot = ['foot', 'path', 'track'].includes(road.kind);
    const radius = (road.kind === 'service' ? 5.6 : road.w || 3) / 2 + (foot ? 2 : 3.7);
    for (let i = 0; i < road.pts.length - (road.closed ? 0 : 1); i++) {
      const a = road.pts[i], b = road.pts[(i + 1) % road.pts.length];
      put(obstacles, [Math.min(a[0], b[0]) - radius, Math.min(a[1], b[1]) - radius, Math.max(a[0], b[0]) + radius, Math.max(a[1], b[1]) + radius], { a, b, radius }, 32);
    }
  }
  for (let iz = 0; iz < height; iz++) for (let ix = 0; ix < width; ix++) {
    const x = bounds[0] + ix * step, z = bounds[1] + iz * step, i = iz * width + ix;
    const wall = distToPoly(x, z, data.boundary), inside = pip(x, z, data.boundary);
    let distance = wall / (inside ? 55 : 15);
    if (distance < 1.25) {
      let nearest = 24 * 24;
      for (let tx = Math.floor(x / 24) - 1; tx <= Math.floor(x / 24) + 1; tx++) for (let tz = Math.floor(z / 24) - 1; tz <= Math.floor(z / 24) + 1; tz++) {
        for (const t of trees.get(`${tx}|${tz}`) || []) nearest = Math.min(nearest, (t[0] - x) ** 2 + (t[1] - z) ** 2);
      }
      distance = Math.max(distance, Math.sqrt(nearest) / 19);
    }
    distance = Math.min(2, distance, pilotForestDistance(x, z));
    if (Math.hypot(x - gate.x, z - gate.z) < 65) distance = 2;
    raw[i] = distance;
    const blocked = (obstacles.get(`${Math.floor(x / 32)}|${Math.floor(z / 32)}`) || []).some((o) => {
      if (o.pts) return pip(x, z, o.pts) || distToPoly(x, z, o.pts) < 3;
      const vx = o.b[0] - o.a[0], vz = o.b[1] - o.a[1];
      const t = clamp(((x - o.a[0]) * vx + (z - o.a[1]) * vz) / (vx * vx + vz * vz || 1), 0, 1);
      return Math.hypot(x - o.a[0] - t * vx, z - o.a[1] - t * vz) < o.radius;
    });
    selected[i] = blocked ? 2 : distance;
    cover[i] = blocked ? 0 : (1 - smooth(distance, 0.68, 1)) * smooth(wall, 0.7, 2.5);
  }
  field = { bounds, step, width, height, raw, selected, cover };
  return field;
}

export const getForestField = () => field;
export const forestDistance = (x, z) => field ? sample(field.selected, x, z, 2) : pilotForestDistance(x, z);
export const forestAtmosphereDistance = (x, z) => field ? sample(field.raw, x, z, 2) : pilotForestDistance(x, z);
export const forestGroundCover = (x, z) => field ? sample(field.cover, x, z, 0) : 1 - smooth(pilotForestDistance(x, z), 0.75, 1);
export const isForestTree = (t) => forestDistance(t.x, t.z) < 1;
