import * as THREE from 'three';
import { FOREST, forestGroundCover, getForestField } from './forest-zone.js';
import { rng } from './textures.js';

let state = null;
const CELL = 48;

export function buildPerimeterForest(parent, height, trees, shared) {
  if (!trees.length) return;
  const treeCells = new Map(), trunkCells = new Map(), coverCells = new Map(), lods = [];
  const random = rng(4179);
  for (const tree of trees) {
    const key = `${Math.floor(tree.x / 96)}|${Math.floor(tree.z / 96)}`;
    if (!treeCells.has(key)) treeCells.set(key, []);
    treeCells.get(key).push(tree);
    const trunkKey = `${Math.floor(tree.x / 8)}|${Math.floor(tree.z / 8)}`;
    if (!trunkCells.has(trunkKey)) trunkCells.set(trunkKey, []);
    trunkCells.get(trunkKey).push(tree);
  }
  const canopy = new THREE.Group(); canopy.name = 'Perimeter woodland canopy'; parent.add(canopy);
  const hashVariant = (t) => Math.abs(Math.round(t.x * 17 + t.z * 31)) % 4;
  for (const [key, list] of treeCells) {
    const [cx, cz] = key.split('|').map(Number), x = (cx + 0.5) * 96, z = (cz + 0.5) * 96;
    for (let variant = 0; variant < 4; variant++) {
      const selected = list.filter((t) => hashVariant(t) === variant);
      if (!selected.length) continue;
      const species = shared.species[variant];
      const records = selected.map((t) => ({ x: t.x - x, y: height(t.x, t.z) - 0.04, z: t.z - z,
        scale: t.s * (variant === 3 ? 0.25 : 0.30) * (0.9 + random() * 0.25),
        rot: t.rot ?? random() * Math.PI * 2, lean: (random() - 0.5) * 0.055 }));
      const lod = new THREE.LOD(); lod.position.set(x, 0, z); canopy.add(lod);
      lods.push({ lod, x, z });
      for (let level = 0; level < species.geometry.length; level++) {
        const group = new THREE.Group(), geometry = species.geometry[level];
        if (geometry.branches) {
          const branch = shared.instances(geometry.branches, species.bark, records, level < 2, null, group);
          branch.receiveShadow = level < 2;
        }
        const leaves = shared.instances(geometry.leaves, level === 3 ? species.farMaterial : species.leaves,
          records, level < 2, level === 3 ? null : species.depth, group);
        leaves.receiveShadow = level < 2;
        lod.addLevel(group, [0, 80, 180, 380][level], 0.08);
      }
    }
  }

  const field = getForestField(), pixels = new Uint8Array(field.width * field.height * 4);
  field.cover.forEach((value, i) => {
    pixels[i * 4] = Math.round(value * 255); pixels[i * 4 + 3] = 255;
    if (value > 0.08) {
      const x = field.bounds[0] + i % field.width * field.step;
      const z = field.bounds[1] + Math.floor(i / field.width) * field.step;
      const key = `${Math.floor(x / CELL)}|${Math.floor(z / CELL)}`;
      if (!coverCells.has(key)) coverCells.set(key, { x: Math.floor(x / CELL) * CELL, z: Math.floor(z / CELL) * CELL, group: null, lastSeen: 0 });
    }
  });
  const mask = new THREE.DataTexture(pixels, field.width, field.height);
  mask.minFilter = mask.magFilter = THREE.LinearFilter; mask.needsUpdate = true;
  const dirt = shared.dirt.clone(), normal = shared.dirtNormal.clone();
  dirt.repeat.set(1, 1); normal.repeat.set(1, 1); dirt.needsUpdate = normal.needsUpdate = true;
  const material = new THREE.MeshStandardMaterial({ map: dirt, normalMap: normal,
    normalScale: new THREE.Vector2(0.7, 0.7), roughness: 0.98, color: '#e4dcc9', transparent: true, depthWrite: false });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWoodlandCover = { value: mask };
    shader.uniforms.uWoodlandBounds = { value: new THREE.Vector4(...field.bounds) };
    shader.uniforms.uWoodlandGrid = { value: new THREE.Vector2(field.width, field.height) };
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWoodlandFloor;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWoodlandFloor = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vWoodlandFloor; uniform sampler2D uWoodlandCover; uniform vec4 uWoodlandBounds; uniform vec2 uWoodlandGrid;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        if (length((vWoodlandFloor.xz - vec2(${FOREST.x.toFixed(1)}, ${FOREST.z.toFixed(1)})) / vec2(${FOREST.rx.toFixed(1)}, ${FOREST.rz.toFixed(1)})) < 1.0) discard;
        vec2 woodUv = (vWoodlandFloor.xz - uWoodlandBounds.xy) / (uWoodlandBounds.zw - uWoodlandBounds.xy);
        woodUv = (woodUv * (uWoodlandGrid - 1.0) + 0.5) / uWoodlandGrid;
        float woodCover = texture2D(uWoodlandCover, woodUv).r;
        if (woodCover < 0.015) discard;
        diffuseColor.a *= woodCover;
        diffuseColor.rgb *= 1.5;
      `);
  };
  material.customProgramCacheKey = () => 'perimeter-forest-floor-v1';
  const floorGroup = new THREE.Group(); floorGroup.name = 'Perimeter forest floor'; parent.add(floorGroup);
  const coverGroup = new THREE.Group(); coverGroup.name = 'Nearby perimeter undergrowth'; parent.add(coverGroup);
  const floorHeight = (x, z) => 0.025 + forestGroundCover(x, z) * (0.045 + Math.sin(x * 0.13) * Math.sin(z * 0.17) * 0.035);
  for (const cell of coverCells.values()) {
    // The original preview already supplies its floor, trail and planting.
    const geometry = new THREE.PlaneGeometry(CELL, CELL, 16, 16).rotateX(-Math.PI / 2);
    geometry.translate(cell.x + CELL / 2, 0, cell.z + CELL / 2);
    const p = geometry.attributes.position, uv = geometry.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      p.setY(i, height(x, z) + floorHeight(x, z)); uv.setXY(i, x / 4, z / 4);
    }
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, material); mesh.receiveShadow = true; floorGroup.add(mesh);
    cell.floor = mesh;
  }
  state = { cells: [...coverCells.values()], lods, trunks: trunkCells, shared, parent: coverGroup, height, floorHeight, trees: trees.length };
}

function populate(cell) {
  const { shared, height, floorHeight, trunks, parent } = state;
  const group = new THREE.Group(); parent.add(group);
  const random = rng(Math.round(cell.x * 47 + cell.z * 173));
  const grass = [], ferns = [];
  for (let x = cell.x; x < cell.x + CELL; x += 0.62) for (let z = cell.z; z < cell.z + CELL; z += 0.62) {
    const px = x + random() * 0.59, pz = z + random() * 0.59;
    if (shared.inPilot(px, pz)) continue;
    const coverage = forestGroundCover(px, pz);
    if (coverage < 0.08 || random() > coverage) continue;
    let occupied = false;
    for (let tx = Math.floor(px / 8) - 1; tx <= Math.floor(px / 8) + 1 && !occupied; tx++) {
      for (let tz = Math.floor(pz / 8) - 1; tz <= Math.floor(pz / 8) + 1 && !occupied; tz++) {
        occupied = (trunks.get(`${tx}|${tz}`) || []).some((t) => Math.hypot(px - t.x, pz - t.z) < t.s * 0.55);
      }
    }
    if (occupied) continue;
    const scale = 0.19 + random() * 0.25;
    const record = { x: px, y: height(px, pz) + floorHeight(px, pz), z: pz,
      scale, sx: scale * 1.25, sy: scale * (0.9 + random() * 0.55), rot: random() * Math.PI * 2 };
    grass.push(record);
    if (random() < 0.018) ferns.push({ ...record, scale: 0.4 + random() * 0.5, sx: undefined, sy: undefined });
  }
  if (grass.length) shared.instances(shared.grassGeometry, shared.grassMaterial, grass, false, null, group);
  if (ferns.length) {
    shared.instances(shared.fernGeometry, shared.fernMaterial, ferns, false, null, group);
    const bushes = ferns.filter((_, i) => i % 4 === 0).map((r) => ({ ...r, scale: 0.024 + random() * 0.026 }));
    shared.instances(shared.shrubGeometry.leaves, shared.shrubMaterial, bushes, false, null, group);
    shared.instances(shared.shrubGeometry.branches, shared.shrubBark, bushes, false, null, group);
  }
  cell.group = group;
}

// Quality control: scale the distances at which each 96 m section of woodland steps down from
// full branches and leaves to coarser models and finally to baked silhouettes.
let perimeterScale = 1, perimeterApplied = 0;
export function setPerimeterDetail(scale) { perimeterScale = scale; perimeterApplied = 0; }
export function updatePerimeterForest(camera, now, fogDensity) {
  if (state && perimeterApplied !== perimeterScale) {
    for (const entry of state.lods) entry.lod.levels.forEach((l) => { if (l.base === undefined) l.base = l.distance; l.distance = l.base * perimeterScale; });
    perimeterApplied = perimeterScale;
  }
  if (!state) return;
  const visibleRange = Math.min(2600, 2.8 / Math.max(0.0001, fogDensity));
  for (const entry of state.lods) entry.lod.visible = Math.hypot(camera.x - entry.x, camera.y - 18, camera.z - entry.z) < visibleRange + 90;
  for (const cell of state.cells) {
    cell.floor.visible = Math.hypot(camera.x - cell.x - CELL / 2, camera.y, camera.z - cell.z - CELL / 2) < visibleRange + 40;
    const near = camera.y < 38 && Math.hypot(camera.x - cell.x - CELL / 2, camera.z - cell.z - CELL / 2) < 100;
    if (near && !cell.group) populate(cell);
    if (cell.group) cell.group.visible = near;
    if (near) cell.lastSeen = now;
  }
  // Keep walking all the way around the wall from accumulating GPU instances.
  const inactive = state.cells.filter((c) => c.group && !c.group.visible).sort((a, b) => b.lastSeen - a.lastSeen);
  for (const cell of inactive.slice(32)) {
    cell.group.traverse((o) => { if (o.isInstancedMesh) o.dispose(); });
    state.parent.remove(cell.group); cell.group = null;
  }
}

export const perimeterForestInfo = () => state ? { trees: state.trees, sections: state.cells.length,
  loadedUndergrowth: state.cells.filter((c) => c.group).length } : null;
