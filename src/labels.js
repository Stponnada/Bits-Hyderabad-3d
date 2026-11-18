// Labels for every building, mapped area and hand-modelled feature on the map.
// Named things keep their names. Unnamed ones get a type ("Lawn", "Tennis Court") prefixed with
// the nearest named landmark, so "Lawn" becomes "Vyas Bhavan Lawn"; duplicates are numbered
// west to east. Tiers set the draw distance in main.js: major > minor > detail.
import { centroid, pip, polyArea } from './geo.js';
import { RB } from './roundabout.js';
import { FOREST } from './forest-zone.js';
import { marineLayout } from './marine-drive-layout.js';
import { FIELD, SHOP_ROWS } from './sports.js';

// Buildings whose role is known from the site surveys in the area builders / AGENTS.md.
const BUILDING_NAMES = {
  1393041468: 'Pool Service Hall', [-183]: 'Pool Service Hall',      // pool.js
  360815486: 'Wind Tunnel Washroom',                                   // AGENTS.md
  [-182]: 'Electrical Substation', [-186]: 'Electrical Substation',    // sit on the mapped substation plots
  [-188]: 'Utility Block',
  [-184]: 'Lab Annexe', [-185]: 'Lab Annexe',
  1462868035: 'Roadside Temple',
  1339803222: 'Industrial Warehouse',
};

const KIND_NAME = {
  housing: 'Faculty House', apartment: 'Faculty Apartments', hostel: 'Hostel Block', generic: 'Service Building',
  utility: 'Utility Block', lab: 'Lab', kiosk: 'Kiosk', workshop: 'Workshop', academic: 'Academic Building',
  mess: 'Dining Hall', medical: 'Medical Centre', retail: 'Shops', temple: 'Temple', library: 'Library',
};
// Numbered ("Faculty House 12") rather than prefixed with a landmark: there are dozens of them.
const NUMBERED = new Set(['housing']);

const SPORT_NAME = {
  soccer: 'Football Field', tennis: 'Tennis Court', basketball: 'Basketball Court', volleyball: 'Volleyball Court',
  badminton: 'Badminton Court', cricket: 'Cricket Ground', chess: 'Chess Courtyard', kho_kho: 'Multi-sport Ground',
};
const AREA_NAME = {
  grass: 'Lawn', park: 'Park', plaza: 'Plaza', water: 'Pond', parking: 'Car Park', substation: 'Substation',
  seating: 'Seating Area', amphi: 'Amphitheatre', stage: 'Open-air Stage', fountain: 'Fountain', shelter: 'Bus Stop',
  bikepark: 'Parking Canopy', workshop_slab: 'Workshop Slab', nets: 'Cricket Nets', bleachers: 'Bleachers',
  pool: 'Swimming Pool', pooldeck: 'Pool Deck', track: 'Athletics Track',
};
// Specific areas recognised by centroid (from the garden.js / roundabout.js / hostels.js surveys).
const AREA_AT = [
  [69, -117, 'grass', 'Palm Island'], [26, -29, 'grass', 'Grass Island'],
  [207, -85, 'plaza', 'Kiosk Plaza'], [-66, -368, 'grass', 'Roundabout Lawn'], [298, 239, 'plaza', 'Kho-Kho & Throwball Court'],
  [-743, -807, 'water', 'Lake (off campus)'],
];
// Shorter forms of long landmark names when they prefix something else.
const SHORT = {
  'Library BPHC': 'Library', 'Nalini Kurra Wind Tunnel Facility': 'Wind Tunnel', 'Student Activity Center': 'SAC',
  'BPHC Auditorium': 'Auditorium', 'Academic Blocks': 'Academic Block', 'New Academic Block': 'NAB',
  'BPHC Criket Ground': 'Cricket Ground', 'Conaught Place': 'CP',
};

function sportName(sport) {
  const s = (sport || '').split(';');
  if (s.length > 2) return 'Multi-sport Ground';
  return SPORT_NAME[s[0].replace(/_turf$/, '')] || 'Sports Pitch';
}

export function assetLabels(data, { heightOf, height, gate }) {
  const out = [];
  const add = (name, x, z, y, tier) => out.push({ name, at: [x, y, z], tier, major: tier === 'major' });
  const ground = (x, z) => height(x, z);

  // landmarks used to give unnamed things context
  const anchors = [];
  const anchor = (name, x, z) => anchors.push({ name: SHORT[name] || name, x, z });
  for (const b of data.buildings) if (b.name) { const c = centroid(b.outer); anchor(b.name, c[0], c[1]); }
  for (const l of data.labels) anchor(l.name, l.at[0], l.at[1]);
  for (const a of data.areas) if (a.name && a.kind !== 'substation') { const c = centroid(a.pts); anchor(a.name, c[0], c[1]); }
  const near = (x, z, max = 140) => {
    let best = null, bd = max;
    for (const a of anchors) { const d = Math.hypot(a.x - x, a.z - z); if (d < bd) { bd = d; best = a; } }
    return best && best.name;
  };
  const inside = (x, z) => pip(x, z, data.boundary);

  // ---- buildings (named ones are already labelled by buildings.js)
  const pending = [];
  for (const b of data.buildings) {
    if (b.name && b.kind !== 'apartment') continue;
    const c = centroid(b.outer);
    // big complexes already carry point labels (Academic Blocks; Gandhi, Ram, Budh ... Bhavan)
    if (data.labels.some((l) => pip(l.at[0], l.at[1], b.outer) || Math.hypot(l.at[0] - c[0], l.at[1] - c[1]) < 30)) continue;
    const y = ground(c[0], c[1]) + heightOf(b) + 4;
    let base = BUILDING_NAMES[b.id], tier = 'detail';
    if (!base) {
      if (b.kind === 'workshop' && !inside(c[0], c[1])) base = 'Industrial Shed';
      else if (NUMBERED.has(b.kind)) base = KIND_NAME[b.kind];
      else { const k = KIND_NAME[b.kind] || 'Building'; const n = near(c[0], c[1]); base = n ? `${n} ${k}` : k; }
    }
    if (b.kind === 'apartment') { base = 'Faculty Apartments Tower'; tier = 'minor'; }
    if (polyArea(b.outer) > 2500) tier = 'minor';
    pending.push({ base, x: c[0], z: c[1], y, tier });
  }

  // ---- areas
  for (const a of data.areas) {
    const c = centroid(a.pts);
    if (a.kind === 'substation' && a.name) continue;       // Malkaram grid substation, far off campus
    if (a.kind === 'parking' && Math.hypot(c[0] + 150, c[1] - 41.7) < 20) continue;   // unpaved, not drawn
    const fixed = AREA_AT.find(([x, z, k]) => k === a.kind && Math.hypot(x - c[0], z - c[1]) < 3);
    if (a.name) continue;                                   // world.js already labels named areas
    const y = ground(c[0], c[1]) + 3;
    if (fixed) { add(fixed[3], c[0], c[1], y, 'detail'); continue; }
    // substation plots are labelled by the building standing on them; shop plots by their shops
    if (a.kind === 'substation' && data.buildings.some((b) => pip(...centroid(b.outer), a.pts))) continue;
    if (SHOP_ROWS.some((r) => r.plot === a.pts)) continue;
    const kind = a.kind === 'pitch' || a.sport ? sportName(a.sport) : AREA_NAME[a.kind] || 'Area';
    const n = near(c[0], c[1]);
    pending.push({ base: n && !n.endsWith(kind) ? `${n} ${kind}` : kind, x: c[0], z: c[1], y, tier: 'detail' });
  }

  // number duplicates west to east
  const groups = new Map();
  for (const p of pending) { if (!groups.has(p.base)) groups.set(p.base, []); groups.get(p.base).push(p); }
  for (const [base, ps] of groups) {
    ps.sort((a, b) => a.x - b.x || a.z - b.z);
    ps.forEach((p, i) => add(ps.length > 1 ? `${base} ${i + 1}` : base, p.x, p.z, p.y, p.tier));
  }

  // ---- hand-modelled features (coordinates from each area builder's survey)
  const feat = (name, x, z, lift = 4, tier = 'detail') => add(name, x, z, ground(x, z) + lift, tier);
  // Rock Garden (garden.js)
  feat('Waterfall Outcrop', -54, -67, 9);
  feat('Rockery & Moat', -6, -93, 5);
  feat('Raised Ring Garden', -29, -67, 4);
  feat('Rocky Hillock', -40, -128, 6);
  feat('Lotus Pond', 23.5, -87, 3);
  // things whose mapped areas the builders replace with models
  feat('Roundabout Fountain', RB.x, RB.z, 5);
  const F = (s, v) => [FIELD.o[0] + FIELD.e[0] * s + FIELD.w[0] * v, FIELD.o[1] + FIELD.e[1] * s + FIELD.w[1] * v];
  feat('Old Football Ground', ...F(FIELD.len * 0.62, FIELD.wid / 2), 6, 'minor');
  feat('Football Ground Steps', ...F(95, FIELD.wid / 2), 4);
  feat('Football Ground Lawn', ...F(47, FIELD.wid / 2), 3);
  feat('Practice Cricket Net', 272, 5, 6);
  feat('SAC Bleachers', 235, 230, 5);
  for (const r of SHOP_ROWS) r.names.forEach((n, i) => {
    const lx = r.xs ? r.xs[i] : (i - 1) * 9;
    feat(n.replace(/\w\S*/g, (w) => (w.length > 3 ? w[0] + w.slice(1).toLowerCase() : w)), r.c[0] + r.a[0] * lx, r.c[1] + r.a[1] * lx, 6.5);
  });
  // entrance (roundabout.js, world.js)
  feat('Entrance Roundabout', RB.x, RB.z + RB.r, 4, 'minor');
  feat('Gatehouse', gate.x, gate.z - 8, 6);
  // New Academic Block (nab.js): cross axis V runs east to the auditorium
  const C = [-349, -267], V = [0.885, 0.466], P = (v) => [C[0] + V[0] * v, C[1] + V[1] * v];
  feat('Chess Courtyard', ...C, 3, 'minor');
  feat('NAB Retaining Wall Stairs', ...P(15), 4);
  feat('NAB Terraced Stair', ...P(-21), 5);
  // covered walk (academic-walk.js): from the Academic complex steps to the NAB end
  feat('Academic Colonnade', (-211 + -261) / 2, (-266 + -292) / 2, 6, 'minor');
  feat('Colonnade Entrance Steps', -211, -266, 4);
  // hostel street (hostels.js)
  feat('Shankar Bhavan Portico', 212, -129.5, 14);
  feat('Vyas Bhavan Portico', 238, -116, 15);
  feat('Hostel Street', 227.5, -122.5, 5, 'minor');
  // woodland (forest-zone.js)
  feat('Woodland', FOREST.x, FOREST.z, 14, 'minor');
  // named roads
  const md = marineLayout();
  if (md) { const p = md.outer[Math.floor(md.outer.length / 2)]; feat('Marine Drive', p[0], p[1], 6, 'minor'); }
  for (const r of data.roads) if (r.name) { const p = r.pts[Math.floor(r.pts.length / 2)]; feat(r.name, p[0], p[1], 5, 'minor'); }
  // the industrial estate as a whole
  const sheds = data.buildings.filter((b) => b.kind === 'workshop' && !inside(...centroid(b.outer)));
  if (sheds.length) {
    const cx = sheds.reduce((s, b) => s + centroid(b.outer)[0], 0) / sheds.length, cz = sheds.reduce((s, b) => s + centroid(b.outer)[1], 0) / sheds.length;
    feat('Industrial Estate (off campus)', cx, cz, 22, 'major');
  }
  return out;
}
