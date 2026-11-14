import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { buildBuildings } from './buildings.js';
import { makeHeight } from './terrain.js';
import { buildGround, buildRoads, buildAreas, buildRocks, buildLamps, buildGate, buildBoundaryWall, GATE, fbm } from './world.js';
import { buildTrees, updatePlantLOD, foliageGlow } from './plants.js';
import { prepareRoundabout, buildRoundabout } from './roundabout.js';
import { prepareQuad, buildQuad } from './quad.js';
import { textSprite, canvasTex } from './textures.js';
import { pip, centroid } from './geo.js';

const qs = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: qs.has('shot') });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.3, 12000);
scene.fog = new THREE.FogExp2('#cfdbe4', 0.0003);

// ------------------------------------------------------------- sky + lights
const sky = new Sky();
sky.scale.setScalar(10000);
scene.add(sky);
const sun = new THREE.DirectionalLight('#fff1dc', 3);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
const SH = 330;
Object.assign(sun.shadow.camera, { left: -SH, right: SH, top: SH, bottom: -SH, near: 10, far: 2200 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.35;
scene.add(sun, sun.target);
const hemi = new THREE.HemisphereLight('#cfe2ff', '#8d7a5a', 0.7);
scene.add(hemi);
const pmrem = new THREE.PMREMGenerator(renderer);
const envScene = new THREE.Scene();
const envSky = new Sky(); envSky.scale.setScalar(10000); envScene.add(envSky);

const starGeo = new THREE.BufferGeometry();
{
  const p = [];
  for (let i = 0; i < 1800; i++) {
    const a = Math.random() * Math.PI * 2, e = Math.asin(Math.random() * 0.98 + 0.02);
    p.push(Math.cos(a) * Math.cos(e) * 9000, Math.sin(e) * 9000, Math.sin(a) * Math.cos(e) * 9000);
  }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
}
const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: '#dfe6ff', size: 2.2, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.85 }));
stars.visible = false; scene.add(stars);

// cloud deck: one large soft-edged sheet that drifts slowly overhead
const clouds = new THREE.Mesh(new THREE.PlaneGeometry(17000, 17000).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({
  map: canvasTex(1024, 1024, (g, w, h) => {
    const id = g.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const u = x / w * 9, v = y / h * 9;
      let n = fbm(u, v) * 0.6 + fbm(u * 2.7 + 3, v * 2.7 + 8) * 0.28 + fbm(u * 7 + 1, v * 7 + 5) * 0.12;
      const big = fbm(u * 0.35 + 9, v * 0.35 + 4);
      let a = THREE.MathUtils.smoothstep(n * 0.75 + big * 0.35, 0.5, 0.68);
      const rr = Math.hypot(x / w - 0.5, y / h - 0.5) * 2;
      a *= 1 - THREE.MathUtils.smoothstep(rr, 0.55, 0.98);
      const o = (y * w + x) * 4, sh = 228 + 27 * THREE.MathUtils.smoothstep(n, 0.45, 0.7);
      id.data[o] = sh; id.data[o + 1] = sh; id.data[o + 2] = sh + 4; id.data[o + 3] = a * 255;
    }
    g.putImageData(id, 0, 0);
  }, { repeat: false }), transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide }));
clouds.renderOrder = -1;
scene.add(clouds);

const env = { nightEmissive: [], nightVisible: [] };
const sunDir = new THREE.Vector3();
const TIMES = {
  day: { label: 'Midday', el: 54, az: 145, col: '#fff3e0', int: 2.5, hemi: ['#d4e4ff', '#8f7c5c', 0.6], envI: 0.4, exp: 0.58, fog: '#c7d6e2', dens: 0.00028, turb: 4.5, ray: 1.1, win: 0, lamps: false, glow: 0.17, cloud: ['#ffffff', 0.9] },
  evening: { label: 'Golden hour', el: 11, az: 258, col: '#ffb070', int: 3.4, hemi: ['#f2c9a8', '#6d5c4a', 0.6], envI: 0.55, exp: 0.8, fog: '#e0b693', dens: 0.00034, turb: 8, ray: 2.4, win: 0.55, lamps: true, glow: 0.24, cloud: ['#ffd2b0', 0.85] },
  night: { label: 'Night', el: 46, az: 205, col: '#9fb6ea', int: 0.55, hemi: ['#44558a', '#15161c', 0.55], envI: 0.06, exp: 0.85, fog: '#080d19', dens: 0.0004, turb: 4, ray: 1, win: 1.5, lamps: true, night: true, glow: 0.02, cloud: ['#2a3350', 0.5] },
};
let timeKey = TIMES[qs.get('time')] ? qs.get('time') : 'day';
let nightMats = [];
function applyTime(key) {
  timeKey = key;
  const t = TIMES[key];
  const el = THREE.MathUtils.degToRad(t.el), az = THREE.MathUtils.degToRad(t.az);
  sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
  for (const s of [sky, envSky]) {
    const u = s.material.uniforms;
    u.turbidity.value = t.turb; u.rayleigh.value = t.ray; u.mieCoefficient.value = 0.005; u.mieDirectionalG.value = 0.8;
    u.sunPosition.value.copy(sunDir);
  }
  sky.visible = !t.night; stars.visible = !!t.night;
  scene.background = t.night ? new THREE.Color('#060a15') : null;
  sun.color.set(t.col); sun.intensity = t.int;
  hemi.color.set(t.hemi[0]); hemi.groundColor.set(t.hemi[1]); hemi.intensity = t.hemi[2];
  scene.fog.color.set(t.fog); scene.fog.density = t.dens;
  renderer.toneMappingExposure = t.exp;
  if (scene.environment) scene.environment.dispose();
  scene.environment = pmrem.fromScene(envScene, 0, 1, 20000).texture;
  scene.environmentIntensity = t.envI;
  for (const m of nightMats) m.emissiveIntensity = t.win;
  for (const e of env.nightEmissive) e.mat.emissiveIntensity = t.lamps ? e.on : 0;
  for (const o of env.nightVisible) o.visible = t.lamps;
  for (const o of env.nightOnly || []) o.visible = !!t.night;
  foliageGlow.value = t.glow;
  clouds.material.color.set(t.cloud[0]); clouds.material.opacity = t.cloud[1];
  $('time').textContent = t.label;
}

// --------------------------------------------------------------- build world
const PLACES = [
  ['Main Gate', GATE.x, GATE.z, 20, 46, 7],
  ['Marine Drive', -20, -250, 10, 120, 22],
  ['Academic Blocks', -150, -150, 70, 190, 60],
  ['Central Library', -154, -250, 35, 120, 34],
  ['Auditorium', -261, -217, 300, 110, 40],
  ['New Academic Block', -345, -263, 300, 130, 55],
  ['Rock Garden', -11, -102, 110, 95, 16],
  ['Central Workshop', -307, -13, 200, 120, 40],
  ['Old Football Ground', 157, -23, 200, 150, 45],
  ['Shankar & Vyas Bhavan', 220, -110, 170, 170, 60],
  ['Dining Hall 2', 235, -142, 120, 90, 30],
  ['Dining Hall 1', 102, 131, 330, 110, 40],
  ['Connaught Place', 307, 158, 290, 90, 28],
  ['Student Activity Centre', 240, 304, 150, 110, 35],
  ['Sports Complex', 380, 310, 250, 190, 70],
  ['Cricket Ground', 476, 412, 320, 130, 35],
  ['Faculty Housing', 470, -40, 200, 200, 70],
  ['Campus Overview', 40, -40, 180, 900, 620],
];

const player = { yaw: 0, pitch: 0, mode: 'fly', vel: new THREE.Vector3() };
let height = () => 0, footprints = [], labelSprites = [], named = [], data = null;

function goTo(p) {
  const [, tx, tz, bearing, dist, h] = p;
  const b = THREE.MathUtils.degToRad(bearing);
  camera.position.set(tx + Math.sin(b) * dist, h + height(tx, tz), tz - Math.cos(b) * dist);
  const dx = tx - camera.position.x, dz = tz - camera.position.z;
  player.yaw = Math.atan2(-dx, -dz);
  player.pitch = -Math.atan2(h - 6, Math.hypot(dx, dz)) * 0.9;
  if (player.mode === 'walk' && h > 12) setMode('fly');
}
function setMode(m) {
  player.mode = m;
  $('mode').textContent = m === 'walk' ? 'Walking' : 'Flying';
  $('mode').dataset.m = m;
}

async function init() {
  data = await (await fetch('campus.json')).json();
  const dem = await (await fetch('dem.json')).json();
  data.pads = [];
  // the mapped guard booths are replaced by the modelled gate
  data.buildings = data.buildings.filter((b) => { const c = centroid(b.outer); return !(b.kind === 'kiosk' && Math.hypot(c[0] - GATE.x, c[1] - GATE.z) < 26); });
  prepareRoundabout(data);
  prepareQuad(data);
  height = makeHeight(data, dem);
  buildGround(data, scene, height);
  buildRoads(data, scene, height);
  const B = buildBuildings(data, scene);
  footprints = B.footprints; nightMats = B.nightMats;
  const A = buildAreas(data, scene, env, height);
  const trees = buildTrees(data, scene, height);
  buildRocks(data, scene, height);
  buildLamps(data, scene, env, height);
  buildGate(data, scene, height);
  buildRoundabout(scene, env, height);
  buildQuad(scene, B.heightOf);
  buildBoundaryWall(data, scene, height);

  // labels
  const all = [...B.labels, ...data.labels.map((l) => ({ name: l.name, at: [l.at[0], height(l.at[0], l.at[1]) + 26, l.at[1]], major: true })), ...A.places.map((p) => ({ ...p, major: false })),
    { name: 'Main Gate', at: [GATE.x, height(GATE.x, GATE.z) + 14, GATE.z], major: true }];
  const seen = new Set();
  for (const l of all) {
    if (!l.name || seen.has(l.name)) continue; seen.add(l.name);
    const s = textSprite(l.name, { size: l.major ? 44 : 36 });
    s.position.set(...l.at); s.userData = l;
    scene.add(s); labelSprites.push(s); named.push(l);
  }

  buildUI();
  applyTime(timeKey);
  const start = PLACES.find((p) => p[0] === (qs.get('place') || 'Marine Drive')) || PLACES[1];
  goTo(start);
  if (qs.has('pos')) {
    const [x, y, z] = qs.get('pos').split(',').map(Number); camera.position.set(x, y, z);
    player.yaw = THREE.MathUtils.degToRad(+(qs.get('yaw') || 0)); player.pitch = THREE.MathUtils.degToRad(+(qs.get('pitch') || 0));
  }
  if (qs.get('mode') === 'walk') setMode('walk');
  if (qs.has('ui')) document.body.classList.add('noui');
  $('stats').textContent = `${data.buildings.length} buildings · ${trees.count.toLocaleString()} trees · ${data.roads.length} road segments`;
  $('loading').remove();
  $('intro').classList.add('ready');
  if (qs.has('shot')) $('intro').remove();
  renderer.setAnimationLoop(frame);
  window.__height = height; window.__data = data;
  window.__ready = true;
}

// ------------------------------------------------------------------ controls
const keys = new Set();
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  keys.add(e.code);
  if (e.code === 'KeyF') setMode(player.mode === 'fly' ? 'walk' : 'fly');
  if (e.code === 'KeyT') applyTime({ day: 'evening', evening: 'night', night: 'day' }[timeKey]);
  if (e.code === 'KeyL') { labelsOn = !labelsOn; }
  if (e.code === 'KeyM') document.body.classList.toggle('bigmap');
  if (e.code === 'KeyH') document.body.classList.toggle('noui');
  if (e.code === 'Space') e.preventDefault();
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
let labelsOn = true, dragging = false;
const cv = renderer.domElement;
cv.addEventListener('mousedown', () => { dragging = true; });
addEventListener('mouseup', () => { dragging = false; });
cv.addEventListener('dblclick', () => cv.requestPointerLock?.());
addEventListener('mousemove', (e) => {
  if (!(dragging || document.pointerLockElement === cv)) return;
  const k = document.pointerLockElement === cv ? 0.0021 : 0.0032;
  player.yaw -= e.movementX * k;
  player.pitch = THREE.MathUtils.clamp(player.pitch - e.movementY * k, -1.5, 1.5);
});
cv.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (player.mode !== 'fly') return;
  const f = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(player.pitch, player.yaw, 0, 'YXZ'));
  camera.position.addScaledVector(f, -e.deltaY * 0.12);
}, { passive: false });
// touch: one finger looks, two fingers move forward
let lastTouch = null;
cv.addEventListener('touchstart', (e) => { lastTouch = e.touches[0]; }, { passive: true });
cv.addEventListener('touchmove', (e) => {
  const t = e.touches[0];
  if (lastTouch) { player.yaw -= (t.clientX - lastTouch.clientX) * 0.004; player.pitch = THREE.MathUtils.clamp(player.pitch - (t.clientY - lastTouch.clientY) * 0.004, -1.5, 1.5); }
  lastTouch = t;
  if (e.touches.length > 1) keys.add('KeyW');
}, { passive: true });
cv.addEventListener('touchend', () => { lastTouch = null; keys.delete('KeyW'); });

function blocked(x, z, y) {
  for (const f of footprints) {
    const b = f.bb;
    if (x < b[0] || x > b[2] || z < b[1] || z > b[3]) continue;
    if (y > f.h + 1.5) continue;
    if (pip(x, z, f.outer) && !f.holes.some((h) => pip(x, z, h))) return true;
  }
  return false;
}

const tmp = new THREE.Vector3(), fwd = new THREE.Vector3(), right = new THREE.Vector3();
function move(dt) {
  const walk = player.mode === 'walk';
  const fast = keys.has('ShiftLeft') || keys.has('ShiftRight');
  const alt = Math.max(0, camera.position.y - height(camera.position.x, camera.position.z));
  const speed = walk ? (fast ? 16 : 5.5) : (fast ? 150 : 38) * (1 + alt / 220);
  fwd.set(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
  right.set(Math.cos(player.yaw), 0, -Math.sin(player.yaw));
  tmp.set(0, 0, 0);
  if (keys.has('KeyW') || keys.has('ArrowUp')) tmp.add(fwd);
  if (keys.has('KeyS') || keys.has('ArrowDown')) tmp.sub(fwd);
  if (keys.has('KeyD')) tmp.add(right);
  if (keys.has('KeyA')) tmp.sub(right);
  if (keys.has('ArrowLeft')) player.yaw += dt * 1.6;
  if (keys.has('ArrowRight')) player.yaw -= dt * 1.6;
  if (tmp.lengthSq() > 0) tmp.normalize();
  if (!walk) {
    // fly along the view direction for forward/back
    const f3 = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(player.pitch, player.yaw, 0, 'YXZ'));
    const fAmt = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
    const rAmt = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    tmp.copy(f3).multiplyScalar(fAmt).addScaledVector(right, rAmt);
    if (keys.has('Space') || keys.has('KeyE')) tmp.y += 0.8;
    if (keys.has('KeyQ') || keys.has('KeyC')) tmp.y -= 0.8;
  }
  player.vel.lerp(tmp.multiplyScalar(speed), 1 - Math.exp(-dt * (walk ? 12 : 6)));
  const p = camera.position;
  const nx = p.x + player.vel.x * dt, nz = p.z + player.vel.z * dt;
  let ny = p.y + player.vel.y * dt;
  if (!blocked(nx, p.z, ny)) p.x = nx; else player.vel.x = 0;
  if (!blocked(p.x, nz, ny)) p.z = nz; else player.vel.z = 0;
  const lim = 4200;
  p.x = THREE.MathUtils.clamp(p.x, -lim, lim); p.z = THREE.MathUtils.clamp(p.z, -lim, lim);
  const g = height(p.x, p.z);
  if (walk) ny = THREE.MathUtils.lerp(p.y, g + 1.7, 1 - Math.exp(-dt * 10));
  else ny = Math.max(g + 1.2, Math.min(1500, ny));
  p.y = ny;
  camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');
}

// ------------------------------------------------------------------------ UI
const MAP = { x0: -570, z0: -500, x1: 650, z1: 520 };
let mapBase = null;
function drawMapBase() {
  const W = 1220, H = 1020;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const X = (x) => x - MAP.x0, Z = (z) => z - MAP.z0;
  const poly = (pts) => { g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(X(p[0]), Z(p[1])) : g.moveTo(X(p[0]), Z(p[1])))); g.closePath(); };
  g.fillStyle = '#26301f'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#3b4a2c'; poly(data.boundary); g.fill();
  for (const a of data.areas) {
    const col = { pitch: '#6c8a45', grass: '#5b7c3c', park: '#4d6e38', water: '#3f7d95', pool: '#39a6c8', track: '#a2604a', parking: '#5e5e60' }[a.kind];
    if (!col) continue;
    g.fillStyle = /Old/.test(a.name) ? '#a98c62' : col; poly(a.pts); g.fill();
  }
  g.lineCap = 'round'; g.lineJoin = 'round';
  for (const r of data.roads) {
    g.strokeStyle = r.kind === 'foot' || r.kind === 'path' || r.kind === 'track' ? '#8f7a62' : '#c9c6bd';
    g.lineWidth = r.kind === 'foot' || r.kind === 'path' ? 1.6 : r.w;
    g.beginPath(); r.pts.forEach((p, i) => (i ? g.lineTo(X(p[0]), Z(p[1])) : g.moveTo(X(p[0]), Z(p[1])))); g.stroke();
  }
  const col = { academic: '#e3c9a0', auditorium: '#d6a79c', hostel: '#f3f1ea', housing: '#ead9bd', apartment: '#ffffff', mess: '#d6a79c', sac: '#d6a79c', workshop: '#8fb0d8' };
  for (const b of data.buildings) {
    if (b.kind === 'library' || b.on != null) continue;
    g.fillStyle = col[b.kind] || '#d8cdb8'; poly(b.outer); g.fill();
    g.fillStyle = '#4d6e38'; for (const h of b.holes) { poly(h); g.fill(); }
  }
  g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 2; g.setLineDash([8, 6]); poly(data.boundary); g.stroke();
  return c;
}
function drawMap() {
  const c = $('map'); const g = c.getContext('2d');
  const W = c.width, H = c.height;
  g.clearRect(0, 0, W, H);
  g.drawImage(mapBase, 0, 0, W, H);
  const sx = W / (MAP.x1 - MAP.x0), sz = H / (MAP.z1 - MAP.z0);
  const px = (camera.position.x - MAP.x0) * sx, pz = (camera.position.z - MAP.z0) * sz;
  g.save(); g.translate(THREE.MathUtils.clamp(px, 6, W - 6), THREE.MathUtils.clamp(pz, 6, H - 6)); g.rotate(-player.yaw);
  g.fillStyle = 'rgba(255,214,90,0.25)'; g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, 46, -Math.PI / 2 - 0.55, -Math.PI / 2 + 0.55); g.fill();
  g.fillStyle = '#ffd24a'; g.strokeStyle = '#1b1b1b'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(0, -11); g.lineTo(7, 8); g.lineTo(0, 4); g.lineTo(-7, 8); g.closePath(); g.fill(); g.stroke();
  g.restore();
}
function buildUI() {
  mapBase = drawMapBase();
  const c = $('map'); c.width = 610; c.height = 510;
  c.addEventListener('click', (e) => {
    const r = c.getBoundingClientRect();
    const x = MAP.x0 + ((e.clientX - r.left) / r.width) * (MAP.x1 - MAP.x0), z = MAP.z0 + ((e.clientY - r.top) / r.height) * (MAP.z1 - MAP.z0);
    camera.position.x = x; camera.position.z = z;
    if (player.mode === 'fly') camera.position.y = Math.max(camera.position.y, height(x, z) + 30);
    if (blocked(x, z, camera.position.y)) { setMode('fly'); camera.position.y = Math.max(camera.position.y, 40); }
  });
  const ul = $('places');
  PLACES.forEach((p, i) => {
    const b = document.createElement('button');
    b.textContent = p[0];
    b.onclick = () => { goTo(p); b.blur(); };
    ul.appendChild(b);
  });
  $('enter').onclick = () => { $('intro').remove(); };
  $('mode').onclick = () => setMode(player.mode === 'fly' ? 'walk' : 'fly');
  $('time').onclick = () => applyTime({ day: 'evening', evening: 'night', night: 'day' }[timeKey]);
}

let lastHud = 0;
function hud(now) {
  if (now - lastHud < 200) return; lastHud = now;
  let best = null, bd = 1e9;
  for (const l of named) { const d = Math.hypot(l.at[0] - camera.position.x, l.at[2] - camera.position.z); if (d < bd) { bd = d; best = l; } }
  $('where').textContent = best && bd < 170 ? `Near ${best.name}` : pip(camera.position.x, camera.position.z, data.boundary) ? 'BITS Pilani, Hyderabad Campus' : 'Outside the campus';
  for (const s of labelSprites) {
    const d = s.position.distanceTo(camera.position);
    s.visible = labelsOn && d < (s.userData.major ? 480 : 150);
  }
}

// ----------------------------------------------------------------------- loop
const clock = new THREE.Clock();
const st = new THREE.Vector3();
function frame(now) {
  const dt = Math.min(0.05, clock.getDelta());
  move(dt);
  // keep the shadow frustum around the viewer, snapped to texels to avoid shimmer
  st.set(0, 0, -1).applyEuler(camera.rotation); st.y = 0; if (st.lengthSq() > 0) st.normalize();
  const reach = Math.min(240, 60 + camera.position.y * 0.8);
  const tx = camera.position.x + st.x * reach, tz = camera.position.z + st.z * reach;
  const snap = (SH * 2) / 4096 * 8;
  sun.target.position.set(Math.round(tx / snap) * snap, 0, Math.round(tz / snap) * snap);
  sun.position.copy(sun.target.position).addScaledVector(sunDir, 1100);
  sky.position.copy(camera.position); stars.position.copy(camera.position);
  clouds.position.set(camera.position.x, 2400, camera.position.z); clouds.rotation.y = now * 0.000004;
  updatePlantLOD(camera.position);
  renderer.render(scene, camera);
  drawMap(); hud(now);
}
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
window.__go = (x, y, z, yaw, pitch) => { camera.position.set(x, y, z); player.yaw = THREE.MathUtils.degToRad(yaw); player.pitch = THREE.MathUtils.degToRad(pitch); };
window.__time = applyTime;
window.__info = () => ({ tris: renderer.info.render.triangles, calls: renderer.info.render.calls });
init().catch((e) => { console.error(e); $('loading').textContent = 'Failed to load: ' + e.message; });
