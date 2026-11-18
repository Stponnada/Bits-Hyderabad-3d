import * as THREE from 'three';
import { Geo, pip } from './geo.js';
import { rng, canvasTex, plainTex, signTex } from './textures.js';
import { merge, extraPlants, noTreeZones } from './plants.js';

// The street between Shankar Bhavan and Vyas Bhavan: each hostel has a tall entrance portico
// reached by a wide flight of steps, Dining Hall II lines the north side, and the kiosk plaza
// with its benches sits under the trees on the south side.
const STREET = { a: [210.35, -131.47], b: [244.81, -113.66] };
const E = (() => { const dx = STREET.b[0] - STREET.a[0], dz = STREET.b[1] - STREET.a[1], l = Math.hypot(dx, dz); return [dx / l, dz / l]; })();
const N = [E[1], -E[0]];                 // towards the dining hall (north side of the street)
const entrances = [];                    // { x, z, dx, dz, W, D, lift, steps, tread, name }
const RISER = 0.15;

function march(poly, start, dir, max = 60) {
  for (let k = 0; k < max / 0.2; k++) { const x = start[0] + dir[0] * k * 0.2, z = start[1] + dir[1] * k * 0.2; if (pip(x, z, poly)) return [x, z]; }
  return null;
}

export function prepareHostels(data) {
  const B = (n) => data.buildings.find((b) => b.name === n);
  const sh = B('Shankar Bhavan'), vy = B('Vyas Bhavan'), dh = B('Dining Hall 2');
  if (sh) { const f = march(sh.outer, [212, -129.5], [-E[0], -E[1]]); if (f) entrances.push({ x: f[0], z: f[1], dx: E[0], dz: E[1], W: 10, D: 3.4, lift: 1.65, tread: 0.32, H: 11.5, name: ['SHANKAR', 'BHAVAN'] }); }
  if (vy) { const f = march(vy.outer, [233, -119], E); if (f) entrances.push({ x: f[0], z: f[1], dx: -E[0], dz: -E[1], W: 10, D: 3.0, lift: 2.7, tread: 0.3, H: 12.5, name: ['VYAS', 'BHAVAN'] }); }
  for (const e of entrances) { e.steps = Math.round(e.lift / RISER); e.run = e.steps * e.tread; noTreeZones.push([e.x + e.dx * 6, e.z + e.dz * 6, 10]); }
  if (dh) { const f = march(dh.outer, [228.6, -121], N); if (f) STREET.sign = f; }
  noTreeZones.push([227, -122, 9], [218, -127, 7], [238, -117, 7]);
  const P = (x, z, kind, s, extra = {}) => extraPlants.push({ x, z, kind, s, ...extra });
  // shade trees over the kiosk plaza, royal palms by the hostel doors and the dining hall
  P(199, -101, 'broad', 1.8); P(214, -93, 'broad', 1.9); P(223, -107, 'broad', 1.6); P(196, -84, 'broad', 1.7); P(208, -112, 'broad', 1.5); P(206, -70, 'broad', 1.6);
  for (const e of entrances) { const vx = -e.dz, vz = e.dx; P(e.x + e.dx * 2 + vx * 7.4, e.z + e.dz * 2 + vz * 7.4, 'palm', 1.25); P(e.x + e.dx * 2 - vx * 7.4, e.z + e.dz * 2 - vz * 7.4, 'palm', 1.1); }
  P(241.5, -123.5, 'palm', 1.2);
}

// walking height on the entrance steps (kept out of the terrain so roads are unaffected)
export function stairHeight(x, z) {
  for (const e of entrances) {
    const rx = x - e.x, rz = z - e.z, u = rx * e.dx + rz * e.dz, v = rx * -e.dz + rz * e.dx;
    if (Math.abs(v) > e.W / 2 - 0.3 || u < 0 || u > e.D + e.run) continue;
    return u < e.D ? e.lift : e.lift - RISER * Math.ceil((u - e.D) / e.tread);
  }
  return 0;
}

function doorTex() {
  return canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#f1e7cc'; g.fillRect(0, 0, w, h);
    const glass = g.createLinearGradient(0, 0, 0, h); glass.addColorStop(0, '#1b2830'); glass.addColorStop(1, '#3d5563');
    // double doors with side lights (bottom), wide window above
    g.fillStyle = '#7a4a2c'; g.fillRect(150, 350, 212, 162);
    g.fillStyle = glass; for (const x of [158, 262]) g.fillRect(x, 362, 92, 110);
    g.fillStyle = '#3a2416'; g.fillRect(254, 350, 4, 162);
    g.fillStyle = glass; g.fillRect(110, 360, 32, 152); g.fillRect(370, 360, 32, 152);
    g.fillStyle = '#2a2f33'; g.fillRect(140, 150, 232, 130);
    g.fillStyle = glass; for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) g.fillRect(146 + i * 56, 156 + j * 62, 52, 58);
    g.fillStyle = 'rgba(0,0,0,0.08)'; g.fillRect(0, 0, w, 18);
  }, { repeat: false });
}
function bar(a, b, r, mat) {
  const d = new THREE.Vector3().subVectors(b, a), len = d.length();
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 6), mat);
  m.position.copy(a).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  return m;
}

export function buildHostels(scene, data, height, env) {
  const g = new THREE.Group();
  const r = rng(515);
  const white = new THREE.MeshStandardMaterial({ map: plainTex('#f3f1ea', 601, 0.05), roughness: 0.9 });
  const stone = new THREE.MeshStandardMaterial({ map: plainTex('#8d9094', 602, 0.1), roughness: 0.85 });
  const steel = new THREE.MeshStandardMaterial({ color: '#c9cdd0', roughness: 0.35, metalness: 0.8 });
  const wg = new Geo(), sg = new Geo(), sg2 = new Geo();
  const door = new THREE.MeshStandardMaterial({ map: doorTex(), roughness: 0.8 });

  for (const e of entrances) {
    const ang = Math.atan2(-e.dx, e.dz);                       // local +z = outward, local +x = along the wall
    const at = (lx, lz) => [e.x + lx * Math.cos(ang) - lz * Math.sin(ang), e.z + lx * Math.sin(ang) + lz * Math.cos(ang)];
    const V = (lx, y, lz) => { const p = at(lx, lz); return new THREE.Vector3(p[0], y, p[1]); };
    const box = (geo, lx, lz, w, d, y0, y1) => { const p = at(lx, lz); geo.box(p[0], p[1], w, d, y0, y1, ang, 0.3); };
    // landing and the flight of steps
    box(sg, 0, e.D / 2, e.W, e.D, 0, e.lift);
    for (let k = 0; k < e.steps; k++) box(k % 2 ? sg : sg2, 0, e.D + (k + 0.5) * e.tread, e.W - 0.6, e.tread, 0, e.lift - (k + 1) * RISER);
    // portico: side walls, roof slab, grey edge pier
    for (const s of [-1, 1]) box(wg, s * (e.W / 2 - 0.25), e.D / 2, 0.5, e.D, 0, e.H);
    box(wg, 0, e.D / 2, e.W + 0.4, e.D + 0.5, e.H, e.H + 0.55);
    box(wg, 0, 0.6, e.W - 1, 1.2, e.H - 2.2, e.H);
    // back wall with the doors
    const wallH = e.H - e.lift, pm = new THREE.Mesh(new THREE.PlaneGeometry(e.W - 1, wallH), door);
    const c = V(0, e.lift + wallH / 2, 0.32); pm.position.copy(c); pm.rotation.y = -ang; g.add(pm);
    // name board on the fascia
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 1.3), new THREE.MeshStandardMaterial({ roughness: 0.6, map: signTex(
      [{ text: e.name[0], size: 96, y: 0.3, color: '#2f6fc0' }, { text: e.name[1], size: 96, y: 0.74, color: '#2f6fc0' }], { w: 512, h: 196, bg: '#dfe9f4' }) }));
    sign.position.copy(V(0, e.H - 0.5, e.D + 0.28)); sign.rotation.y = -ang; g.add(sign);
    // steel railings on both sides of the steps
    for (const s of [-1, 1]) {
      const lx = s * (e.W / 2 - 0.45), top = V(lx, e.lift + 0.95, e.D), bot = V(lx, 0.95, e.D + e.run);
      for (const dy of [0, -0.3, -0.6]) g.add(bar(top.clone().setY(top.y + dy), bot.clone().setY(bot.y + dy), dy ? 0.018 : 0.03, steel));
      for (let k = 0; k <= 5; k++) { const t = k / 5, p = top.clone().lerp(bot, t); g.add(bar(new THREE.Vector3(p.x, p.y - 0.95, p.z), p, 0.025, steel)); }
      g.add(bar(V(lx, e.lift + 0.95, 0.4), top, 0.03, steel)); g.add(bar(V(lx, e.lift, 0.4), V(lx, e.lift + 0.95, 0.4), 0.025, steel));
    }
    // a couple of pots on the landing
    for (const s of [-1, 1]) {
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.2, 0.42, 10), new THREE.MeshStandardMaterial({ color: '#c8704a', roughness: 0.85 }));
      pot.position.copy(V(s * 2.9, e.lift + 0.21, 0.9)); g.add(pot);
      const bush = new THREE.Mesh(new THREE.SphereGeometry(0.45, 8, 6), new THREE.MeshLambertMaterial({ color: '#5f9440' })); bush.position.copy(V(s * 2.9, e.lift + 0.85, 0.9)); bush.scale.y = 1.3; g.add(bush);
    }
    // bicycles parked beside the steps
    e.bikes = []; for (let i = 0; i < 9; i++) e.bikes.push([...at(-(e.W / 2 + 1.6 + i * 0.75), e.D + e.run - 0.6 + (r() - 0.5) * 0.4), ang + (r() - 0.5) * 0.3]);
  }
  const wm = new THREE.Mesh(wg.build(), white); wm.castShadow = true; wm.receiveShadow = true; g.add(wm);
  const sm = new THREE.Mesh(sg.build(), stone); sm.castShadow = true; sm.receiveShadow = true; g.add(sm);
  // alternate treads in a second tone so the flight reads as steps from a distance
  const sm2 = new THREE.Mesh(sg2.build(), new THREE.MeshStandardMaterial({ map: plainTex('#a3a6aa', 603, 0.1), roughness: 0.85 })); sm2.castShadow = true; sm2.receiveShadow = true; g.add(sm2);

  // Dining Hall II name board
  if (STREET.sign) {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 0.95), new THREE.MeshStandardMaterial({ roughness: 0.6, map: signTex([{ text: 'DINING HALL - II', size: 84, y: 0.52, color: '#2f6fc0' }], { w: 768, h: 174, bg: '#e6eef6' }) }));
    s.position.set(STREET.sign[0] - N[0] * 0.25, 4.15, STREET.sign[1] - N[1] * 0.25); s.rotation.y = Math.atan2(-N[0], -N[1]); g.add(s);
  }

  // kiosk plaza: steel tables with fixed seats, red umbrellas, the assembly-point board, a boulder
  const fg = new Geo();
  const table = (x, z, a) => {
    fg.box(x, z, 2.4, 0.75, 0.72, 0.78, a);
    for (const s of [-1, 1]) for (let i = -1; i <= 1; i++) { const c = Math.cos(a), si = Math.sin(a), lx = i * 0.75, lz = s * 0.75; fg.box(x + lx * c - lz * si, z + lx * si + lz * c, 0.42, 0.42, 0.42, 0.47, a); fg.box(x + lx * c - lz * si, z + lx * si + lz * c, 0.06, 0.06, 0, 0.42, a); }
    for (const i of [-0.9, 0.9]) fg.box(x + i * Math.cos(a), z + i * Math.sin(a), 0.07, 0.07, 0, 0.72, a);
  };
  table(219, -99, 0.46); table(214, -103, 0.46); table(222, -93, 0.46); table(199, -93, 2.0);
  const fm = new THREE.Mesh(fg.build(), steel); fm.castShadow = true; g.add(fm);
  const red = new THREE.MeshStandardMaterial({ color: '#d32f2a', roughness: 0.7, side: THREE.DoubleSide });
  for (const [x, z] of [[207, -79], [211, -76], [200, -80], [217, -103]]) {
    const u = new THREE.Mesh(new THREE.ConeGeometry(1.7, 0.75, 8, 1, true), red); u.position.set(x, 2.5, z); u.castShadow = true; g.add(u);
    g.add(bar(new THREE.Vector3(x, 0, z), new THREE.Vector3(x, 2.6, z), 0.03, steel));
  }
  {
    const board = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.2), new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.6, map: canvasTex(256, 256, (c) => {
      c.fillStyle = '#2f9a48'; c.fillRect(0, 0, 256, 256); c.strokeStyle = '#fff'; c.lineWidth = 6; c.strokeRect(8, 8, 240, 240);
      c.fillStyle = '#fff'; for (const x of [96, 128, 160]) { c.beginPath(); c.arc(x, 96, 16, 0, 7); c.fill(); c.fillRect(x - 15, 114, 30, 62); }
      c.font = '700 24px sans-serif'; c.textAlign = 'center'; c.fillText('ASSEMBLY POINT', 128, 226);
    }, { repeat: false }) }));
    board.position.set(224, 2.0, -109); board.rotation.y = Math.atan2(N[0], N[1]); g.add(board);
    g.add(bar(new THREE.Vector3(224, 0, -109), new THREE.Vector3(224, 1.5, -109), 0.03, steel));
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.6, 1), new THREE.MeshStandardMaterial({ map: plainTex('#b0aaa0', 610, 0.14), roughness: 0.95 })); rock.position.set(226, 0.3, -106); rock.scale.set(1.3, 0.8, 1); g.add(rock);
  }

  // bicycles: beside each flight of steps and along the dining hall's side wall
  {
    const wheel = new THREE.TorusGeometry(0.33, 0.028, 5, 14).rotateY(Math.PI / 2);
    const tube = (x0, y0, z0, x1, y1, z1) => { const d = new THREE.Vector3(x1 - x0, y1 - y0, z1 - z0), len = d.length(); const gg = new THREE.CylinderGeometry(0.02, 0.02, len, 5); return { geo: gg, matrix: new THREE.Matrix4().compose(new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()), new THREE.Vector3(1, 1, 1)) }; };
    const bike = merge([
      { geo: wheel, matrix: new THREE.Matrix4().makeTranslation(0, 0.35, 0.52) }, { geo: wheel, matrix: new THREE.Matrix4().makeTranslation(0, 0.35, -0.52) },
      tube(0, 0.35, -0.52, 0, 0.85, -0.2), tube(0, 0.85, -0.2, 0, 0.8, 0.3), tube(0, 0.8, 0.3, 0, 0.35, 0.52), tube(0, 0.35, -0.52, 0, 0.4, 0.05), tube(0, 0.4, 0.05, 0, 0.8, 0.3), tube(0, 0.4, 0.05, 0, 0.9, -0.2),
      tube(0, 0.8, 0.3, 0, 1.02, 0.32), tube(-0.25, 1.02, 0.32, 0.25, 1.02, 0.32), tube(-0.1, 0.93, -0.22, 0.1, 0.93, -0.22),
    ]);
    const spots = entrances.flatMap((e) => e.bikes);
    for (let i = 0; i < 9; i++) spots.push([240.2 + i * 0.75 * E[0] + N[0] * 3.2, -121.2 + i * 0.75 * E[1] + N[1] * 3.2, -Math.atan2(N[0], N[1]) + (r() - 0.5) * 0.3]);
    const im = new THREE.InstancedMesh(bike, new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.4 }), spots.length);
    const d = new THREE.Object3D(), col = new THREE.Color(), cols = ['#22252a', '#22252a', '#8d1f1f', '#d8d8d8', '#1f4f8d', '#2f2f2f'];
    spots.forEach((s, i) => { d.position.set(s[0], 0.05, s[1]); d.rotation.set(0, -s[2], (r() - 0.5) * 0.25); d.updateMatrix(); im.setMatrixAt(i, d.matrix); im.setColorAt(i, col.set(cols[Math.floor(r() * cols.length)])); });
    im.castShadow = true; g.add(im);
  }
  scene.add(g);
  return g;
}
