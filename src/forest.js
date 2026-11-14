import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Tree } from './vendor/ez-tree/tree.js';
import ashPreset from './vendor/ez-tree/presets/ash_large.json';
import aspenPreset from './vendor/ez-tree/presets/aspen_large.json';
import bushPreset from './vendor/ez-tree/presets/bush_1.json';
import { animateMaterial } from './detailed-trees.js';
import { rng } from './textures.js';
import { FOREST, pilotForestDistance, forestAtmosphereDistance } from './forest-zone.js';
import { buildPerimeterForest, updatePerimeterForest, perimeterForestInfo } from './perimeter-forest.js';
import { bakeForestProxy } from './forest-proxy.js';

let root = null;
let pilotCover = null;
const pathPoints = [];
const windTime = { value: 0 };
const tempFog = new THREE.Color();
export const forestView = { x: FOREST.x, y: 1.8, z: FOREST.z - 36, yaw: 180, pitch: -1 };

function floorHeight(x, z) {
  const fade = 1 - THREE.MathUtils.smoothstep(pilotForestDistance(x, z), 0.72, 1);
  return 0.025 + fade * (0.045 + Math.sin(x * 0.13) * Math.sin(z * 0.17) * 0.035);
}

function makeTrail(trees) {
  // A narrow preview trail winds around the actual trunks, not through them.
  let previous = FOREST.x;
  for (let i = 0; i < 64; i++) {
    const z = FOREST.z - FOREST.rz + i / 63 * FOREST.rz * 2;
    let best = previous, bestCost = Infinity;
    for (let offset = -12; offset <= 12; offset += 0.5) {
      const x = FOREST.x + offset;
      let cost = Math.abs(x - previous) * 0.75 + Math.abs(offset) * 0.035;
      for (const t of trees) {
        const d = Math.hypot(x - t.x, z - t.z);
        if (d < 2.4) cost += Math.pow(2.4 - d, 2) * 12;
      }
      if (cost < bestCost) { bestCost = cost; best = x; }
    }
    pathPoints.push(best); previous = best;
  }
  forestView.x = trailX(forestView.z);
  forestView.yaw = THREE.MathUtils.radToDeg(Math.atan2(forestView.x - trailX(forestView.z + 10), -10));
  const bytes = new Uint8Array(64 * 4);
  pathPoints.forEach((x, i) => { bytes[i * 4] = (x - FOREST.x + 16) / 32 * 255; bytes[i * 4 + 3] = 255; });
  const texture = new THREE.DataTexture(bytes, 64, 1);
  texture.minFilter = texture.magFilter = THREE.LinearFilter; texture.needsUpdate = true;
  return texture;
}

function trailX(z) {
  const t = THREE.MathUtils.clamp((z - FOREST.z + FOREST.rz) / (FOREST.rz * 2), 0, 1) * 63;
  const i = Math.floor(t);
  return THREE.MathUtils.lerp(pathPoints[i], pathPoints[Math.min(63, i + 1)], t - i);
}

function windMaterial(material, height = 1) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uForestTime = windTime;
    // Thousands of tiny overlapping blades do not need nine shadow samples
    // per fragment. Keep full soft filtering on trunks and tree foliage, and
    // use a single shadow comparison on the finely cut-out undergrowth.
    shader.fragmentShader = '#undef SHADOWMAP_TYPE_PCF_SOFT\n#undef SHADOWMAP_TYPE_PCF\n' + shader.fragmentShader;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uForestTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float grassBend = pow(clamp(position.y / ${height.toFixed(2)}, 0.0, 1.0), 2.0);
        float grassPhase = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.43;
        transformed.x += sin(uForestTime * 0.8 + grassPhase) * grassBend * 0.06;
        transformed.z += cos(uForestTime * 0.65 + grassPhase) * grassBend * 0.04;`);
  };
  material.customProgramCacheKey = () => `woodland-wind-${height}`;
  return material;
}

function fernGeometry() {
  const p = [], n = [], c = [], index = [];
  const dark = new THREE.Color('#33432d'), light = new THREE.Color('#5e7545');
  for (let frond = 0; frond < 7; frond++) {
    const angle = frond / 7 * Math.PI * 2;
    const axis = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
    const side = new THREE.Vector3(-axis.z, 0, axis.x);
    for (let leaf = 1; leaf < 14; leaf++) {
      const t = leaf / 14, radius = t * 0.78;
      const stem = axis.clone().multiplyScalar(radius); stem.y = Math.sin(t * 2.0) * 0.56;
      const width = Math.sin(t * Math.PI) * 0.19;
      for (const sign of [-1, 1]) {
        const start = p.length / 3;
        const end = stem.clone().addScaledVector(side, width * sign).addScaledVector(axis, 0.055); end.y -= 0.035;
        const mid = stem.clone().lerp(end, 0.55); mid.y += 0.022;
        const vertices = [stem.clone().addScaledVector(axis, -0.012), mid.clone().addScaledVector(axis, 0.025), end, mid.clone().addScaledVector(axis, -0.025)];
        for (const v of vertices) {
          p.push(v.x, v.y, v.z); n.push(0, 1, 0);
          const color = dark.clone().lerp(light, t); c.push(color.r, color.g, color.b);
        }
        index.push(start, start + 1, start + 2, start, start + 2, start + 3);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3)); g.setIndex(index);
  return g;
}

export async function buildForest(scene, height, allTrees, allOriginals, renderer) {
  if (!allTrees.length) return;
  const inPilot = (x, z) => pilotForestDistance(x, z) < 1;
  const trees = allTrees.filter((t) => inPilot(t.x, t.z));
  const originals = allOriginals.filter((t) => inPilot(t.x, t.z));
  const perimeter = [...allOriginals, ...allTrees].filter((t) => !inPilot(t.x, t.z));
  const loader = new THREE.TextureLoader();
  const load = async (name, color = false) => {
    const texture = await loader.loadAsync(`/forest/${name}`);
    if (color) texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.anisotropy = 8;
    return texture;
  };
  const [ash, aspen, bark, barkNormal, barkRoughness, birch, birchNormal, birchRoughness, dirt, dirtNormal, grass] = await Promise.all([
    load('ash.png', true), load('aspen.png', true), load('oak-color.jpg', true), load('oak-normal.jpg'), load('oak-roughness.jpg'),
    load('birch-color.jpg', true), load('birch-normal.jpg'), load('birch-roughness.jpg'),
    load('floor-color.jpg', true), load('floor-normal.jpg'), new GLTFLoader().loadAsync('/forest/grass.glb'),
  ]);
  ash.wrapS = ash.wrapT = aspen.wrapS = aspen.wrapT = THREE.ClampToEdgeWrapping;
  root = new THREE.Group(); root.name = 'Woodland trail'; scene.add(root);
  const trail = makeTrail([...originals, ...trees]);
  const stand = [...originals, ...trees];
  const species = [];
  const random = rng(1771), object = new THREE.Object3D();
  let defaultParent = root;
  const makeInstances = (geometry, material, records, shadow = false, depth = null, parent = defaultParent) => {
    const mesh = new THREE.InstancedMesh(geometry, material, records.length);
    records.forEach((r, i) => {
      object.position.set(r.x, r.y, r.z); object.rotation.set(r.lean || 0, r.rot, 0);
      object.scale.set(r.sx ?? r.scale, r.sy ?? r.scale, r.sz ?? r.scale); object.updateMatrix();
      mesh.setMatrixAt(i, object.matrix);
      if (r.color) mesh.setColorAt(i, new THREE.Color(r.color));
    });
    mesh.castShadow = shadow; mesh.receiveShadow = true;
    if (depth) mesh.customDepthMaterial = depth;
    mesh.computeBoundingSphere(); mesh.boundingSphere.radius += 0.2; parent.add(mesh);
    return mesh;
  };
  // Generate a few reusable, genuinely branching trees. Every distance level
  // uses the same EZ-Tree skeleton, so trunks and crowns keep their identity.
  for (let variant = 0; variant < 4; variant++) {
    const pale = variant === 3;
    const tree = new Tree(); tree.options.copy(pale ? aspenPreset : ashPreset);
    tree.options.seed = 619 + variant * 817;
    tree.options.branch.sections[0] = 20; tree.options.branch.segments[0] = 12;
    if (!pale) tree.options.branch.radius[0] = 1.25;
    tree.options.branch.start[1] = pale ? 0.60 : 0.46;
    tree.options.branch.children[0] = pale ? 12 : 11;
    tree.options.leaves.count = pale ? 22 : 14;
    tree.options.leaves.size *= 0.88;
    const barkMaterial = new THREE.MeshStandardMaterial({
      map: pale ? birch : bark, normalMap: pale ? birchNormal : barkNormal,
      roughnessMap: pale ? birchRoughness : barkRoughness, roughness: 1, color: pale ? '#d2d1ba' : '#b9b2a1',
      normalScale: new THREE.Vector2(0.75, 0.75),
    });
    const leafMaterial = animateMaterial(new THREE.MeshStandardMaterial({
      map: pale ? aspen : ash, color: pale ? '#c3c8af' : '#b8c2a2',
      roughness: 0.95, alphaTest: 0.42, alphaToCoverage: true, side: THREE.DoubleSide,
    }), true);
    const leafDepth = animateMaterial(new THREE.MeshDepthMaterial({
      map: pale ? aspen : ash, alphaTest: 0.42, depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide,
    }));
    const records = stand.filter((_, i) => i % 4 === variant).map((t) => ({
      x: t.x - FOREST.x, y: height(t.x, t.z) - 0.04, z: t.z - FOREST.z,
      scale: t.s * (pale ? 0.25 : 0.30) * (0.9 + random() * 0.25), rot: t.rot ?? random() * Math.PI * 2, lean: (random() - 0.5) * 0.055,
    }));
    const lod = new THREE.LOD(); lod.position.set(FOREST.x, 0, FOREST.z); root.add(lod);
    species[variant] = { bark: barkMaterial, leaves: leafMaterial, depth: leafDepth, geometry: [] };
    for (const [distance, detail] of [[0, { sectionStride: 2, leafStride: 2, leafScale: 1.15, billboard: 'single' }],
      [65, { sectionStride: 3, segmentFactor: 0.65, leafStride: 4, leafScale: 1.4, billboard: 'single' }],
      [180, { sectionStride: 5, segmentFactor: 0.4, leafStride: 8, leafScale: 1.7, billboard: 'single' }]]) {
      const geometry = tree.createGeometry(detail), level = new THREE.Group();
      species[variant].geometry.push(geometry);
      makeInstances(geometry.branches, barkMaterial, records, true, null, level);
      makeInstances(geometry.leaves, leafMaterial, records, true, leafDepth, level);
      lod.addLevel(level, distance, 0.08);
    }
    const proxy = bakeForestProxy(renderer, species[variant].geometry[1], barkMaterial, leafMaterial);
    species[variant].geometry.push({ branches: null, leaves: proxy.geometry });
    species[variant].farMaterial = proxy.material;
    const farLevel = new THREE.Group();
    const farMesh = makeInstances(proxy.geometry, proxy.material, records, false, null, farLevel);
    farMesh.receiveShadow = false; lod.addLevel(farLevel, 380, 0.08);
  }

  // Phototextured soil and litter on gently uneven ground, with a continuous
  // trail mask shared by the floor and the undergrowth placement.
  dirt.repeat.set(FOREST.rx * 2 / 4, FOREST.rz * 2 / 4); dirtNormal.repeat.copy(dirt.repeat);
  const floorGeometry = new THREE.PlaneGeometry(FOREST.rx * 2, FOREST.rz * 2, 80, 128).rotateX(-Math.PI / 2);
  floorGeometry.translate(FOREST.x, 0, FOREST.z);
  const p = floorGeometry.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, height(p.getX(i), p.getZ(i)) + floorHeight(p.getX(i), p.getZ(i)));
  floorGeometry.computeVertexNormals();
  const floorMaterial = new THREE.MeshStandardMaterial({ map: dirt, normalMap: dirtNormal,
    normalScale: new THREE.Vector2(0.7, 0.7), roughness: 0.98, color: '#e4dcc9' });
  floorMaterial.onBeforeCompile = (shader) => {
    shader.uniforms.uForestTrail = { value: trail };
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vForestFloor;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvForestFloor = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vForestFloor; uniform sampler2D uForestTrail;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        vec2 forestUV = (vForestFloor.xz - vec2(${FOREST.x.toFixed(1)}, ${FOREST.z.toFixed(1)})) / vec2(${FOREST.rx.toFixed(1)}, ${FOREST.rz.toFixed(1)});
        float coverage = 1.0 - smoothstep(0.83, 1.0, length(forestUV));
        float speckle = fract(sin(dot(floor(vForestFloor.xz * 40.0), vec2(127.1, 311.7))) * 43758.5453);
        if (speckle > coverage) discard;
        float pathX = ${FOREST.x.toFixed(1)} + texture2D(uForestTrail, vec2(forestUV.y * 0.5 + 0.5, 0.5)).r * 32.0 - 16.0;
        float footfall = 1.0 - smoothstep(0.48, 1.1, abs(vForestFloor.x - pathX));
        diffuseColor.rgb *= 1.5;
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.55, 1.25, 0.9), footfall * 0.65);
      `);
  };
  floorMaterial.customProgramCacheKey = () => 'forest-floor-v1';
  const floor = new THREE.Mesh(floorGeometry, floorMaterial); floor.receiveShadow = true; root.add(floor);
  pilotCover = new THREE.Group(); pilotCover.name = 'Nearby trail undergrowth'; root.add(pilotCover);
  defaultParent = pilotCover;

  const grassSource = grass.scene.children.find((o) => o.isMesh);
  const grassMaterial = windMaterial(new THREE.MeshStandardMaterial({
    map: grassSource.material.map, color: '#7d8d5d', roughness: 1,
    alphaTest: 0.45, alphaToCoverage: true, side: THREE.DoubleSide,
  }), 2);
  const fernMaterial = windMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide }));
  const clumps = [], ferns = [];
  for (let x = FOREST.x - FOREST.rx; x < FOREST.x + FOREST.rx; x += 0.47) {
    for (let z = FOREST.z - FOREST.rz; z < FOREST.z + FOREST.rz; z += 0.47) {
      const px = x + random() * 0.44, pz = z + random() * 0.44, zone = pilotForestDistance(px, pz);
      if (zone > 0.96 || random() > (1 - THREE.MathUtils.smoothstep(zone, 0.75, 1))) continue;
      const pathDistance = Math.abs(px - trailX(pz));
      if (pathDistance < 0.78 + random() * 0.42) continue;
      if (stand.some((t) => Math.hypot(px - t.x, pz - t.z) < t.s * 0.55)) continue;
      const scale = 0.19 + random() * 0.25;
      const record = { x: px, y: height(px, pz) + floorHeight(px, pz), z: pz,
        scale, sx: scale * 1.25, sy: scale * (0.9 + random() * 0.55), rot: random() * Math.PI * 2 };
      clumps.push(record);
      if (random() < 0.018 && pathDistance > 1.2) ferns.push({ ...record, scale: 0.4 + random() * 0.5, sx: undefined, sy: undefined });
    }
  }
  makeInstances(grassSource.geometry, grassMaterial, clumps);
  const fern = fernGeometry();
  makeInstances(fern, fernMaterial, ferns);

  // Low leafy shrubs interrupt the uniform grass height, especially away from
  // the trail. The same reusable tree generator also supplies their structure.
  const shrub = new Tree(); shrub.options.copy(bushPreset); shrub.options.seed = 291;
  const shrubGeometry = shrub.createGeometry({ sectionStride: 3, segmentFactor: 0.6, leafStride: 2, leafScale: 1.15 });
  const shrubMaterial = animateMaterial(new THREE.MeshStandardMaterial({ map: ash, color: '#94a478',
    alphaTest: 0.42, alphaToCoverage: true, roughness: 1, side: THREE.DoubleSide }), true);
  const bushes = ferns.filter((_, i) => i % 4 === 0).map((r) => ({ ...r, scale: 0.024 + random() * 0.026 }));
  makeInstances(shrubGeometry.leaves, shrubMaterial, bushes);
  const shrubBark = new THREE.MeshStandardMaterial({ map: bark, roughness: 1, color: '#8c8570' });
  makeInstances(shrubGeometry.branches, shrubBark, bushes);

  const logs = [];
  for (let i = 0; i < 4; i++) {
    const g = new THREE.CylinderGeometry(0.055, 0.1, 1.5 + random() * 1.5, 8).rotateZ(Math.PI / 2);
    const x = trailX(FOREST.z + i * 12) + (i % 2 ? -3.4 : 4.8), z = FOREST.z + i * 12 - 20;
    g.rotateY(random() * Math.PI); g.translate(x, height(x, z) + floorHeight(x, z) + 0.09, z); logs.push(g);
  }
  const deadwood = new THREE.Mesh(mergeGeometries(logs), new THREE.MeshStandardMaterial({ map: bark, normalMap: barkNormal, roughness: 1, color: '#756e56' }));
  deadwood.castShadow = true; deadwood.receiveShadow = true; root.add(deadwood);
  buildPerimeterForest(root, height, perimeter, { species, instances: makeInstances, inPilot,
    dirt, dirtNormal, grassGeometry: grassSource.geometry, grassMaterial,
    fernGeometry: fern, fernMaterial, shrubGeometry, shrubMaterial, shrubBark });
  window.__forest = { ...forestView, trees: stand.length, grass: clumps.length, ferns: ferns.length,
    perimeter: perimeterForestInfo(),
    path: pathPoints.map((x, i) => [x, FOREST.z - FOREST.rz + i / 63 * FOREST.rz * 2]) };
  window.__perimeterForest = perimeterForestInfo;
}

export function updateForest(camera, now, scene, time) {
  if (!root) return;
  windTime.value = now * 0.001;
  const distance = Math.hypot(camera.position.x - FOREST.x, camera.position.z - FOREST.z);
  root.visible = distance < 2400;
  pilotCover.visible = distance < 170 && camera.position.y < 38;
  const blend = (1 - THREE.MathUtils.smoothstep(forestAtmosphereDistance(camera.position.x, camera.position.z), 0.35, 1.12))
    * (1 - THREE.MathUtils.smoothstep(camera.position.y, 12, 28));
  tempFog.set(time.night ? '#101a23' : time.label === 'Golden hour' ? '#b4ae93' : '#b5beac');
  scene.fog.color.set(time.fog).lerp(tempFog, blend);
  scene.fog.density = THREE.MathUtils.lerp(time.dens, time.night ? 0.007 : 0.0125, blend);
  scene.environmentIntensity = THREE.MathUtils.lerp(time.envI, time.envI * 1.4, blend);
  updatePerimeterForest(camera.position, now, scene.fog.density);
}
