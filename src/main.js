import * as THREE from 'three';
import { prepareMarineDrive } from './marine-drive-layout.js';
import { buildMarineDrive } from './marine-drive.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { buildBuildings } from './buildings.js';
import { makeHeight, buildGround, buildRoads, buildAreas, buildRocks, buildLamps, buildGate, buildBoundaryWall, GATE, prepareGate, fbm } from './world.js';
import { buildTrees, updatePlantLOD, foliageGlow, setTreeRanges } from './plants.js';
import { setDetailScale } from './detailed-trees.js';
import { prepareRoundabout, buildRoundabout, RB } from './roundabout.js';
import { prepareGarden, buildGarden, GARDEN, waterTextures } from './garden.js';
import { prepareHostels, buildHostels, stairHeight } from './hostels.js';
import { MARINE_LAWNS } from './marine-drive-layout.js';
import { prepareNab, buildNab, NAB_RECT } from './nab.js';
import { prepareSports, buildSports, FIELD, TRACK } from './sports.js';
import { preparePool, buildPool } from './pool.js';
import { prepareAcademicWalk, buildAcademicWalk } from './academic-walk.js';
import { textSprite, canvasTex } from './textures.js';
import { pip, centroid, distToPoly } from './geo.js';
import { createContactShading } from './contact-shading.js';
import { prepareGroundDetail, buildGroundCover, updateGroundCover } from './ground-detail.js';
import { buildForest, updateForest, forestView, setForestDetail } from './forest.js';
import { configureForestZones, forestAtmosphereDistance } from './forest-zone.js';
import { prepareBikeParks, buildBikeParks } from './bikepark.js';
import { assetLabels } from './labels.js';
import { createMenu, settingsPane } from './ui.js';
import { cullOutside, clampToBarrier, buildBackdrop, updateBackdrop } from './barrier.js';

const qs = new URLSearchParams(location.search);
// Development only: Vite reloads the page on every saved file. The view is remembered per tab, so a
// reload puts you back where you were and skips the title screen; real visitors always start at the
// gate. (Open a new tab, or Locations → Main Gate, to start over.)
const DEV_VIEW = 'bits-dev-view';
const devView = import.meta.env.DEV && !qs.has('shot') && !qs.has('place') && !qs.has('pos')
  ? (() => { try { return JSON.parse(sessionStorage.getItem(DEV_VIEW)); } catch (e) { return null; } })() : null;
function saveDevView() {
  if (!window.__ready) return;                // a reload mid-build keeps the last good view
  const p = camera.position;
  try { sessionStorage.setItem(DEV_VIEW, JSON.stringify({ x: p.x, y: p.y, z: p.z, yaw: player.yaw, pitch: player.pitch, mode: player.mode, time: timeKey, menu: menu?.open ? menu.pane : null })); } catch (e) { /* private mode */ }
}
if (import.meta.env.DEV) { addEventListener('beforeunload', saveDevView); import.meta.hot?.on('vite:beforeFullReload', saveDevView); }
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
const contactShading = createContactShading(renderer, scene, camera);
contactShading.resize(innerWidth, innerHeight);

// ------------------------------------------------------------- sky + lights
const sky = new Sky();
sky.scale.setScalar(10000);
scene.add(sky);
const sun = new THREE.DirectionalLight('#fff1dc', 3);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.autoUpdate = false;
let SH = 192;
Object.assign(sun.shadow.camera, { left: -SH, right: SH, top: SH, bottom: -SH, near: 10, far: 2200 });
sun.shadow.bias = -0.00002; sun.shadow.normalBias = 0.055;
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
  day: { label: 'Midday', el: 54, az: 145, col: '#fff4e5', int: 2.9, hemi: ['#cbdfff', '#7d7059', 0.55], envI: 0.45, exp: 0.62, fog: '#c7d6e2', dens: 0.00028, turb: 4.5, ray: 1.1, win: 0, lamps: false, glow: 0.10, cloud: ['#ffffff', 0.9] },
  evening: { label: 'Golden hour', el: 11, az: 258, col: '#ffb070', int: 3.4, hemi: ['#f2c9a8', '#6d5c4a', 0.6], envI: 0.55, exp: 0.8, fog: '#e0b693', dens: 0.00034, turb: 8, ray: 2.4, win: 0.55, lamps: true, glow: 0.24, cloud: ['#ffd2b0', 0.85] },
  night: { label: 'Night', el: 46, az: 205, col: '#9fb6ea', int: 0.55, hemi: ['#44558a', '#15161c', 0.55], envI: 0.06, exp: 0.85, fog: '#080d19', dens: 0.0004, turb: 4, ray: 1, win: 1.5, lamps: true, night: true, glow: 0.02, cloud: ['#2a3350', 0.5] },
};
let timeKey = TIMES[qs.get('time')] ? qs.get('time') : TIMES[devView?.time] ? devView.time : 'day';
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
  shadowDirty = true;
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
  contactShading.setNight(!!t.night);
  clouds.material.color.set(t.cloud[0]); clouds.material.opacity = t.cloud[1];
  syncUI();
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
  ['Woodland Trail', -510, -148, 0, 47, 1.8],
  ['North Boundary Woods', -470, -603, 245, 0, 1.8],
  ['East Boundary Woods', 520, 333, 0, 0, 1.8],
  ['South Boundary Woods', 150, 296, 66, 0, 1.8],
];

const player = { yaw: 0, pitch: 0, mode: 'fly', vel: new THREE.Vector3() };
let height = () => 0, footprints = [], labelSprites = [], named = [], data = null;
let treePopulation = null;

// Every visit starts on foot in the inbound carriageway just outside the main gate, facing the campus.
function startAtGate() {
  const ex = Math.cos(GATE.ang), ez = Math.sin(GATE.ang);      // along the gate beam
  const ox = Math.sin(GATE.ang), oz = -Math.cos(GATE.ang);     // outward, away from the campus
  const x = GATE.x + ex * 8.75 + ox * 7, z = GATE.z + ez * 8.75 + oz * 7;
  camera.position.set(x, height(x, z) + 1.7, z);
  player.yaw = Math.atan2(ox, oz); player.pitch = -0.02;
  setMode('fly');
}

function goTo(p) {
  if (p[0] === 'Main Gate') { startAtGate(); return; }
  if (p[0].endsWith('Boundary Woods')) {
    camera.position.set(p[1], p[5], p[2]);
    player.yaw = THREE.MathUtils.degToRad(p[3]); player.pitch = -0.02;
    setMode('walk'); return;
  }
  if (p[0] === 'Woodland Trail') {
    camera.position.set(forestView.x, forestView.y, forestView.z);
    player.yaw = THREE.MathUtils.degToRad(forestView.yaw);
    player.pitch = THREE.MathUtils.degToRad(forestView.pitch);
    setMode('walk'); return;
  }
  const [, tx, tz, bearing, dist, h] = p;
  const b = THREE.MathUtils.degToRad(bearing);
  camera.position.set(tx + Math.sin(b) * dist, h, tz - Math.cos(b) * dist);
  [camera.position.x, camera.position.z] = clampToBarrier(camera.position.x, camera.position.z);
  const dx = tx - camera.position.x, dz = tz - camera.position.z;
  player.yaw = Math.atan2(-dx, -dz);
  player.pitch = -Math.atan2(h - 6, Math.hypot(dx, dz)) * 0.9;
  if (player.mode === 'walk' && h > 12) setMode('fly');
}
function setMode(m) {
  player.mode = m;
  syncUI();
}

// Loading screen: each stage names what is being built and advances the bar by its share of the
// total build time (weights measured on a typical laptop). Yielding a frame between stages lets
// the page repaint, since the builders themselves are synchronous.
const STAGE_TOTAL = 100.5;
let stageDone = 0;
const stageLog = [];
function stage(text, weight) {
  stageLog.push({ text, weight });
  const pct = Math.min(99, Math.round((stageDone / STAGE_TOTAL) * 100));
  stageDone += weight;
  // glide toward the end of this stage over its expected time; a transform keeps animating on the
  // compositor even while the builder blocks the main thread
  const bar = $('bar');
  if (bar) { bar.style.transitionDuration = weight * 270 + 'ms'; bar.style.transform = `scaleX(${Math.min(0.995, stageDone / STAGE_TOTAL)})`; }
  const num = $('pct'); if (num) num.textContent = String(pct).padStart(2, '0') + '%';
  const log = $('log');
  if (log) log.innerHTML = stageLog.slice(-5).map((s, i, a) => `<li class="${i === a.length - 1 ? 'now' : ''}">${s.text}</li>`).join('');
  return new Promise((r) => { const t = setTimeout(r, 60); requestAnimationFrame(() => setTimeout(() => { clearTimeout(t); r(); }, 0)); });
}

async function init() {
  await stage('Downloading the campus survey', 1);
  data = await (await fetch('campus.json')).json();
  await stage('Surveying ' + data.areas.length + ' grounds, gardens and courts', 5);
  // the mapped guard booths are replaced by the modelled gate
  data.buildings = data.buildings.filter((b) => { const c = centroid(b.outer); return !(b.kind === 'kiosk' && Math.hypot(c[0] - GATE.x, c[1] - GATE.z) < 26); });
  prepareGate(data);
  prepareBikeParks(data);
  prepareRoundabout(data);
  prepareMarineDrive(data);
  configureForestZones(data, GATE);
  prepareGroundDetail(data, RB, GATE);
  prepareGarden(data);
  // the Rock Garden models its own lawn and planting, so it is not one of the formal Marine Drive lawns
  for (let i = MARINE_LAWNS.length - 1; i >= 0; i--) { const c = centroid(MARINE_LAWNS[i]); if (GARDEN.poly && pip(c[0], c[1], GARDEN.poly)) MARINE_LAWNS.splice(i, 1); }
  prepareHostels(data);
  prepareSports(data);
  preparePool(data);
  prepareAcademicWalk();
  prepareNab(data);
  await stage('Clearing everything beyond the walls', 0.5);
  cullOutside(data);
  await stage('Shaping the terrain', 2);
  height = makeHeight(data.boundary);
  buildGround(data, scene, height, GARDEN.poly, FIELD, TRACK.cut, NAB_RECT);
  await stage('Paving ' + data.roads.length + ' roads and footpaths', 1);
  buildRoads(data, scene, height);
  await stage('Raising ' + data.buildings.length + ' buildings', 7);
  const B = buildBuildings(data, scene);
  footprints = B.footprints; nightMats = B.nightMats;
  await stage('Laying lawns, pitches and car parks', 2);
  const A = buildAreas(data, scene, env, height);
  await stage('Planting trees', 8);
  const trees = buildTrees(data, scene, height);
  treePopulation = { original: trees.original, added: trees.added, total: trees.count };
  await stage('Growing the woodland', 8);
  await buildForest(scene, height, trees.forestTrees, trees.forestOriginals, renderer);
  await stage('Placing ' + data.rocks.length + ' boulders and wiring the street lamps', 0.5);
  buildRocks(data, scene, height);
  buildLamps(data, scene, env);
  await stage('Building the main gate and roundabout', 1);
  buildGate(data, scene);
  buildRoundabout(scene, env);
  await stage('Lining Marine Drive with palms', 1);
  buildMarineDrive(scene);
  await stage('Landscaping the Rock Garden', 2);
  buildGarden(scene, height, env);
  await stage('Detailing the hostels', 0.5);
  buildHostels(scene, data, height, env);
  await stage('Marking out the sports fields', 2.5);
  buildSports(scene, height, env);
  buildPool(scene, height, env);
  await stage('Finishing the academic blocks', 1);
  buildAcademicWalk(scene, height, env);
  buildNab(scene, height, env);
  await stage('Walling the campus and roofing the bike sheds', 1);
  buildBoundaryWall(data, scene, height);
  buildBikeParks(data, scene, height);
  buildBackdrop(scene, data, height);
  await stage('Scattering grass and ground cover', 23);
  buildGroundCover(scene, height, data);
  await stage('Naming every place', 3);
  await document.fonts.load('600 40px Satoshi').catch(() => {});

  // labels
  const all = [...B.labels, ...data.labels.map((l) => ({ name: l.name, at: [l.at[0], 26, l.at[1]], major: true })), ...A.places.map((p) => ({ ...p, major: false })),
    { name: 'Main Gate', at: [GATE.x, 14, GATE.z], major: true },
    ...assetLabels(data, { heightOf: B.heightOf, height, gate: GATE })];
  const seen = new Set();
  for (const l of all) {
    if (!l.name || seen.has(l.name)) continue; seen.add(l.name);
    l.tier = l.tier || (l.major ? 'major' : 'minor');
    const s = textSprite(l.name, { size: l.tier === 'detail' ? 30 : l.major ? 44 : 36 });
    s.position.set(...l.at); s.userData = l; s.layers.set(1);
    scene.add(s); labelSprites.push(s); named.push(l);
  }

  buildUI();
  applyQuality(qs.get('q') || (() => { try { return localStorage.getItem('bits-quality'); } catch (e) { return null; } })() || 'auto');
  applyTime(timeKey);
  const start = qs.has('place') && PLACES.find((p) => p[0] === qs.get('place'));
  if (start) goTo(start);
  else if (devView) { camera.position.set(devView.x, devView.y, devView.z); player.yaw = devView.yaw; player.pitch = devView.pitch; setMode(devView.mode); }
  else startAtGate();
  if (qs.has('shot')) setMode('fly');        // screenshot tools place the camera freely (tools/shot.mjs)
  if (qs.has('pos')) {
    const [x, y, z] = qs.get('pos').split(',').map(Number); camera.position.set(x, y, z);
    player.yaw = THREE.MathUtils.degToRad(+(qs.get('yaw') || 0)); player.pitch = THREE.MathUtils.degToRad(+(qs.get('pitch') || 0));
  }
  if (qs.get('mode') === 'walk') setMode('walk');
  if (qs.has('ui')) document.body.classList.add('noui');
  $('stats').textContent = `${data.buildings.length} buildings · ${trees.count.toLocaleString()} trees · ${data.roads.length} road segments`;
  await stage('Compiling shaders', 31);
  await renderer.compileAsync(scene, camera).catch(() => {});
  await stage('Ready', 0);
  $('bar').style.transitionDuration = '200ms'; $('bar').style.transform = 'scaleX(1)'; $('pct').textContent = '100%';
  $('boot').classList.add('ready');
  if (qs.has('shot') || devView) $('boot').remove();
  if (devView?.menu) menu.setOpen(true, devView.menu);
  renderer.setAnimationLoop(frame);
  window.__labels = () => named.map((l) => ({ name: l.name, tier: l.tier, at: l.at.map((v) => Math.round(v)) }));
  window.__ready = true;
}

// ------------------------------------------------------------------ controls
const keys = new Set();
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || !menu) return;
  const boot = $('boot');
  if (boot) { if (e.code === 'Enter' && boot.classList.contains('ready')) boot.remove(); return; }   // title screen
  if (e.code === 'KeyI' || (e.code === 'Escape' && menu.open)) { menu.setOpen(!menu.open); return; }
  if (menu.open) {
    // the menu takes the keyboard: Q/E, arrows or Tab flip tabs, 1-9 jump to one
    if (e.code === 'Tab') { e.preventDefault(); menu.cycle(e.shiftKey ? -1 : 1); }
    if (e.code === 'KeyE' || e.code === 'ArrowRight') menu.cycle(1);
    if (e.code === 'KeyQ' || e.code === 'ArrowLeft') menu.cycle(-1);
    if (/^Digit[1-9]$/.test(e.code)) menu.show(+e.code.slice(5) - 1);
    if (e.code === 'KeyM') menu.setOpen(false);
    return;
  }
  keys.add(e.code);
  if (e.key === 'Shift') lastHud = 0;              // show / hide labels straight away
  if (e.code === 'KeyF') setMode(player.mode === 'fly' ? 'walk' : 'fly');
  if (e.code === 'KeyT') applyTime({ day: 'evening', evening: 'night', night: 'day' }[timeKey]);
  if (e.code === 'KeyL') setPref('labels', { shift: 'always', always: 'off', off: 'shift' }[prefs.labels]);
  if (e.code === 'KeyM') menu.setOpen(true, 'map');
  if (e.code === 'KeyH') document.body.classList.toggle('noui');
  if (e.code === 'KeyG') applyQuality({ auto: 'high', high: 'medium', medium: 'low', low: 'auto' }[qKey]);
  if (e.code === 'Space') e.preventDefault();
});
addEventListener('keyup', (e) => { keys.delete(e.code); if (e.key === 'Shift') lastHud = 0; });
addEventListener('blur', () => keys.clear());
let dragging = false;

// UI preferences, remembered per browser
const PREFS_KEY = 'bits-ui';
const prefs = { labels: 'shift', labelDetail: 'all', minimap: 'open', fps: 'off' };
try { Object.assign(prefs, JSON.parse(localStorage.getItem(PREFS_KEY)) || {}); } catch (e) { /* private mode */ }
if (qs.has('labels')) prefs.labels = qs.get('labels');      // e.g. ?labels=always for screenshots
function setPref(k, v) {
  prefs[k] = v;
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) { /* private mode */ }
  applyPrefs();
}
function applyPrefs() {
  $('mapWrap').classList.toggle('min', prefs.minimap === 'min');
  $('mapMin').textContent = prefs.minimap === 'min' ? '+' : '–';
  $('mapMin').title = prefs.minimap === 'min' ? 'Show map' : 'Minimise map';
  $('fps').hidden = prefs.fps !== 'on';
  $('labelHint').hidden = prefs.labels !== 'shift';
  lastHud = 0; syncUI();
}
let menu = null, settings = null;
const syncUI = () => settings?.sync();
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
  [p.x, p.z] = clampToBarrier(p.x, p.z);      // the virtual wall: REACH metres outside the campus walls, short of the painted treeline
  const g = height(p.x, p.z) + stairHeight(p.x, p.z);
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
    // same unpaved lot as in buildAreas: don't paint it grey on the minimap
    if (a.kind === 'parking') { const ac = centroid(a.pts); if (Math.hypot(ac[0] + 150.0, ac[1] - 41.7) < 20) continue; }
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
  const col = { academic: '#e3c9a0', auditorium: '#d6a79c', hostel: '#f3f1ea', housing: '#ead9bd', apartment: '#ecd6b4', mess: '#d6a79c', sac: '#d6a79c', workshop: '#8fb0d8' };
  for (const b of data.buildings) {
    if (b.kind === 'library' || b.on != null) continue;
    g.fillStyle = col[b.kind] || '#d8cdb8'; poly(b.outer); g.fill();
    g.fillStyle = '#4d6e38'; for (const h of b.holes) { poly(h); g.fill(); }
  }
  g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 2; g.setLineDash([8, 6]); poly(data.boundary); g.stroke();
  return c;
}
function drawMap() {
  const c = $('map'); if (!c.offsetParent) return;   // minimised and not in the menu
  const g = c.getContext('2d');
  const W = c.width, H = c.height;
  g.clearRect(0, 0, W, H);
  g.drawImage(mapBase, 0, 0, W, H);
  const sx = W / (MAP.x1 - MAP.x0), sz = H / (MAP.z1 - MAP.z0);
  const px = (camera.position.x - MAP.x0) * sx, pz = (camera.position.z - MAP.z0) * sz;
  const k = W / 610;     // marker sized for the 610 px minimap; the canvas itself is twice that for the menu map
  g.save(); g.translate(THREE.MathUtils.clamp(px, 6 * k, W - 6 * k), THREE.MathUtils.clamp(pz, 6 * k, H - 6 * k)); g.rotate(-player.yaw); g.scale(k, k);
  g.fillStyle = 'rgba(255,255,255,0.22)'; g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, 46, -Math.PI / 2 - 0.55, -Math.PI / 2 + 0.55); g.fill();
  g.fillStyle = '#fff'; g.strokeStyle = '#000'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(0, -11); g.lineTo(7, 8); g.lineTo(0, 4); g.lineTo(-7, 8); g.closePath(); g.fill(); g.stroke();
  g.restore();
}
function buildUI() {
  mapBase = drawMapBase();
  const c = $('map'); c.width = 1220; c.height = 1020;
  c.addEventListener('click', (e) => {
    const r = c.getBoundingClientRect();
    const x = MAP.x0 + ((e.clientX - r.left) / r.width) * (MAP.x1 - MAP.x0), z = MAP.z0 + ((e.clientY - r.top) / r.height) * (MAP.z1 - MAP.z0);
    [camera.position.x, camera.position.z] = clampToBarrier(x, z);
    if (player.mode === 'fly') camera.position.y = Math.max(camera.position.y, 30);
    if (blocked(camera.position.x, camera.position.z, camera.position.y)) { setMode('fly'); camera.position.y = Math.max(camera.position.y, 40); }
  });
  const ul = $('places');
  PLACES.forEach((p, i) => {
    const b = document.createElement('button');
    b.textContent = p[0];
    b.onclick = () => { goTo(p); b.blur(); };
    ul.appendChild(b);
  });
  $('enter').onclick = () => { $('boot').remove(); };

  menu = createMenu();
  // one map canvas: it moves into the Map pane while that pane is open, and back to the corner after
  menu.onChange((open, pane) => {
    (open && pane === 'map' ? $('bigSlot') : $('miniSlot')).appendChild(c);
    $('mapWrap').classList.toggle('away', open && pane === 'map');
    if (open) { keys.clear(); dragging = false; document.exitPointerLock?.(); }
  });
  for (const b of ul.children) b.addEventListener('click', () => menu.setOpen(false));
  $('menuBtn').onclick = () => menu.setOpen(true);
  $('mapMin').onclick = () => setPref('minimap', prefs.minimap === 'min' ? 'open' : 'min');
  settings = settingsPane($('settings'), [
    { label: 'Labels', hint: 'Hold Shift to show them, or keep them on', options: [['shift', 'Hold Shift'], ['always', 'Always'], ['off', 'Off']], get: () => prefs.labels, set: (v) => setPref('labels', v) },
    { label: 'Label detail', hint: 'Small features (courts, lawns, stairs) appear up close', options: [['all', 'Everything'], ['main', 'Main places only']], get: () => prefs.labelDetail, set: (v) => setPref('labelDetail', v) },
    { label: 'Minimap', options: [['open', 'Shown'], ['min', 'Minimised']], get: () => prefs.minimap, set: (v) => setPref('minimap', v) },
    { label: 'Movement', options: [['fly', 'Fly'], ['walk', 'Walk']], get: () => player.mode, set: (v) => setMode(v) },
    { label: 'Time of day', options: Object.entries(TIMES).map(([k, t]) => [k, t.label]), get: () => timeKey, set: (v) => applyTime(v) },
    { label: 'Graphics quality', hint: 'Auto adjusts resolution to keep frames smooth', options: [['auto', 'Auto'], ...Object.entries(QUALITY).map(([k, q]) => [k, q.label])], get: () => qKey, set: (v) => applyQuality(v) },
    { label: 'Frame rate counter', options: [['on', 'On'], ['off', 'Off']], get: () => prefs.fps, set: (v) => setPref('fps', v) },
  ]);
  applyPrefs();
}

let lastHud = 0;
const LABEL_RANGE = { major: 480, minor: 150, detail: 110 };
function hud(now) {
  if (now - lastHud < 200) return; lastHud = now;
  let best = null, bd = 1e9;
  for (const l of named) {
    // small features only count when you're right next to them
    const d = Math.hypot(l.at[0] - camera.position.x, l.at[2] - camera.position.z) + (l.tier === 'detail' ? 40 : 0);
    if (d < bd) { bd = d; best = l; }
  }
  $('where').textContent = best && bd < 170 ? `Near ${best.name}` : pip(camera.position.x, camera.position.z, data.boundary) ? 'On campus' : 'Outside the campus';
  $('mapWhere').textContent = $('where').textContent;
  const on = prefs.labels === 'always' || (prefs.labels === 'shift' && (keys.has('ShiftLeft') || keys.has('ShiftRight')));
  for (const s of labelSprites) {
    const t = s.userData.tier;
    // small features: judged by ground distance so they still show when flying low over them
    const d = t === 'detail' ? (camera.position.y - s.position.y < 140 ? Math.hypot(s.position.x - camera.position.x, s.position.z - camera.position.z) : 1e9) : s.position.distanceTo(camera.position);
    s.visible = on && d < LABEL_RANGE[t] && (prefs.labelDetail === 'all' || t !== 'detail');
  }
}

// ----------------------------------------------------------------------- loop
// ----------------------------------------------------------------- quality
// What costs frame time here is mostly invisible: full-resolution multisampling on a retina
// panel, redrawing a static shadow map, and full tree models hundreds of metres away.
// Each level trims those first; "auto" also scales the render resolution to hold frame rate.
const QUALITY = {
  high: { label: 'High', maxRatio: 2, samples: 4, ao: true, shadow: 4096, shadowStep: 2, treeNear: 330, shell: 330, detail: 1, forest: 0, treeShadows: true },
  medium: { label: 'Medium', maxRatio: 1.5, samples: 2, ao: true, shadow: 2048, shadowStep: 4, treeNear: 220, shell: 220, detail: 0.75, forest: 2, treeShadows: true },
  low: { label: 'Low', maxRatio: 1.25, samples: 0, ao: false, shadow: 2048, shadowStep: 8, treeNear: 130, shell: 110, detail: 0.5, forest: 3, treeShadows: false },
};
let Q = QUALITY.medium, qKey = 'auto', ratio = 1, shadowDirty = true;
function setRatio(r) {
  ratio = r; renderer.setPixelRatio(r); renderer.setSize(innerWidth, innerHeight); contactShading.resize(innerWidth, innerHeight);
}
function applyQuality(key) {
  qKey = QUALITY[key] || key === 'auto' ? key : 'auto';
  Q = QUALITY[qKey === 'auto' ? 'medium' : qKey];
  try { localStorage.setItem('bits-quality', qKey); } catch (e) { /* private mode */ }
  contactShading.setAO(Q.ao); contactShading.setSamples(Q.samples);
  if (sun.shadow.mapSize.x !== Q.shadow) { sun.shadow.mapSize.set(Q.shadow, Q.shadow); sun.shadow.map?.dispose(); sun.shadow.map = null; }
  shadowDirty = true;
  setTreeRanges(Q.treeNear, Q.shell); setDetailScale(Q.detail, Q.treeShadows); setForestDetail(Q.forest, Q.treeShadows);
  setRatio(Math.min(window.devicePixelRatio, Q.maxRatio));
  syncUI();
}
// dynamic resolution: nudge the pixel ratio so frames stay near 50 fps; in auto mode fall
// back to the low preset if even the minimum resolution cannot keep up
let frames = 0, tick = 0, slow = 0, fps = 60;
function tuneResolution(now) {
  frames++;
  if (!tick) { tick = now; return; }
  if (now - tick < 700) return;
  fps = (frames * 1000) / (now - tick); frames = 0; tick = now;
  const el = $('fps'); if (el) el.textContent = Math.round(fps) + ' fps';
  if (qs.has('shot') || document.hidden) return;
  // never below a crisp image: on a retina panel the floor is 1.25 device pixels per CSS pixel
  const max = Math.min(window.devicePixelRatio, Q.maxRatio), min = Math.min(max, window.devicePixelRatio >= 2 ? 1.25 : 1);
  if (fps < 40 && ratio > min) setRatio(Math.max(min, ratio - 0.1));
  else if (fps > 56 && ratio < max) setRatio(Math.min(max, ratio + 0.05));
  if (qKey === 'auto') {
    slow = fps < 26 && ratio <= min + 0.01 ? slow + 1 : 0;
    if (slow >= 4 && Q !== QUALITY.low) { Q = QUALITY.low; contactShading.setAO(false); contactShading.setSamples(0); setTreeRanges(Q.treeNear, Q.shell); setDetailScale(Q.detail, false); setForestDetail(Q.forest, false); shadowDirty = true; slow = 0; setRatio(Math.min(window.devicePixelRatio, Q.maxRatio)); syncUI(); }
  }
}

const clock = new THREE.Clock();
const st = new THREE.Vector3();
function frame(now) {
  const dt = Math.min(0.05, clock.getDelta());
  move(dt);
  updateBackdrop(camera, height(camera.position.x, camera.position.z));
  tuneResolution(now);
  // Shadows: everything that casts one is static, so the sun map is redrawn only when the
  // viewer has moved far enough for the snapped shadow window to shift, or the sun changed.
  const extent = Math.ceil(THREE.MathUtils.lerp(180, 360, THREE.MathUtils.smoothstep(camera.position.y, 2, 220)) / 16) * 16;
  if (extent !== SH) {
    SH = extent;
    Object.assign(sun.shadow.camera, { left: -SH, right: SH, top: SH, bottom: -SH });
    sun.shadow.camera.updateProjectionMatrix(); shadowDirty = true;
  }
  const snap = Math.max((SH * 2) / Q.shadow, Q.shadowStep);
  const sx = Math.round(camera.position.x / snap) * snap, sz = Math.round(camera.position.z / snap) * snap;
  if (shadowDirty || sx !== sun.target.position.x || sz !== sun.target.position.z) {
    sun.target.position.set(sx, 0, sz);
    sun.position.copy(sun.target.position).addScaledVector(sunDir, 1100);
    sun.shadow.needsUpdate = true; shadowDirty = false;
  }
  sky.position.copy(camera.position); stars.position.copy(camera.position);
  clouds.position.set(camera.position.x, 2400, camera.position.z); clouds.rotation.y = now * 0.000004;
  updatePlantLOD(camera.position, now, 2.8 / Math.max(scene.fog.density, 0.0001));
  updateGroundCover(camera.position, now);
  updateForest(camera, now, scene, TIMES[timeKey]);
  for (const t of waterTextures) t.offset.y += dt * 0.55;
  contactShading.render();
  drawMap(); hud(now);
}
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  setRatio(ratio);
});
window.__where = () => { const p = camera.position; return { x: Math.round(p.x * 10) / 10, z: Math.round(p.z * 10) / 10, mode: player.mode, outsideWall: pip(p.x, p.z, data.boundary) ? 0 : Math.round(distToPoly(p.x, p.z, data.boundary) * 10) / 10 }; };
window.__go = (x, y, z, yaw, pitch) => { camera.position.set(x, y, z); player.yaw = THREE.MathUtils.degToRad(yaw); player.pitch = THREE.MathUtils.degToRad(pitch); };
window.__time = applyTime;
window.__scene = scene; window.__renderer = renderer; window.__sun = sun;
window.__quality = applyQuality;
window.__info = () => ({ fps: Math.round(fps), ratio, tris: renderer.info.render.triangles, calls: renderer.info.render.calls, trees: treePopulation });
init().catch((e) => { console.error(e); const l = $('log'); if (l) l.innerHTML = `<li class="now err">Failed to load: ${e.message}</li>`; });
