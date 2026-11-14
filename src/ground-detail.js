import * as THREE from 'three';
import { bbox, pip, distToPoly } from './geo.js';
import { noiseTex, rng } from './textures.js';

let field = null;
const grassCells = [];
const grassTime = { value: 0 };
const hash = (x, z) => {
  let h = Math.imul(x, 374761393) ^ Math.imul(z, 668265263);
  h = Math.imul(h ^ h >>> 13, 1274126177);
  return ((h ^ h >>> 16) >>> 0) / 4294967296;
};

export function prepareGroundDetail(data, roundabout, gate) {
  const extent = [data.extent[0] - 40, data.extent[1] - 40, data.extent[2] + 40, data.extent[3] + 40];
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 2048;
  const g = canvas.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, 2048, 2048);
  const sx = 2048 / (extent[2] - extent[0]), sz = 2048 / (extent[3] - extent[1]);
  g.setTransform(sx, 0, 0, sz, -extent[0] * sx, -extent[1] * sz);
  g.lineJoin = g.lineCap = 'round';
  // Green stores worn margins outside paving. It only affects grass materials,
  // so neither the road nor the footpath gets painted over by the ground pass.
  for (const road of data.roads) {
    const foot = ['foot', 'path', 'track'].includes(road.kind);
    const mid = road.pts[road.pts.length >> 1];
    const width = (road.kind === 'service' ? 5.6 : road.w || 3) + (!foot && pip(mid[0], mid[1], data.boundary) ? 4.4 : 0);
    for (const [extra, shade] of [[2.4, '#002a00'], [0.9, '#006800']]) {
      g.strokeStyle = shade; g.lineWidth = width + extra;
      g.beginPath(); road.pts.forEach((p, i) => i ? g.lineTo(...p) : g.moveTo(...p));
      if (road.closed) g.closePath(); g.stroke();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace; texture.anisotropy = 4;
  field = { canvas, g, extent, texture, noise: noiseTex(512, 509), roundabout, gate, trees: [] };
}

export function addTreeGroundDetail(trees) {
  if (!field) return;
  field.trees = trees;
  const { g, extent } = field;
  const random = rng(931);
  g.globalCompositeOperation = 'lighter';
  // Soft, overlapping root/litter patches, subsequently broken up by world-
  // space detail noise in the shader rather than hard circular dirt decals.
  for (const t of trees) {
    if (t.x < extent[0] || t.x > extent[2] || t.z < extent[1] || t.z > extent[3]) continue;
    const radius = (0.9 + t.s * 0.65) * (0.8 + random() * 0.5);
    g.save(); g.translate(t.x, t.z); g.scale(1, 0.72 + random() * 0.5);
    const gradient = g.createRadialGradient(0, 0, radius * 0.15, 0, 0, radius * 1.5);
    gradient.addColorStop(0, '#d00000'); gradient.addColorStop(0.5, '#700000'); gradient.addColorStop(1, '#000000');
    g.fillStyle = gradient; g.fillRect(-radius * 1.5, -radius * 1.5, radius * 3, radius * 3);
    g.restore();
  }
  g.globalCompositeOperation = 'source-over'; field.texture.needsUpdate = true;
}

export function groundMaterial(material, painted = false) {
  if (!field) return material;
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    Object.assign(shader.uniforms, {
      uGroundField: { value: field.texture }, uGroundNoise: { value: field.noise },
      uFieldExtent: { value: new THREE.Vector4(...field.extent) },
    });
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vGroundPosition;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGroundPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vGroundPosition; uniform sampler2D uGroundField;
      uniform sampler2D uGroundNoise; uniform vec4 uFieldExtent;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec2 gp = vGroundPosition.xz;
        vec3 fine = texture2D(uGroundNoise, gp / 1.8).rgb;
        vec3 patchNoise = texture2D(uGroundNoise, gp / 13.0).rgb;
        vec3 broad = texture2D(uGroundNoise, gp / 54.0).rgb;
        vec2 fieldUv = (gp - uFieldExtent.xy) / (uFieldExtent.zw - uFieldExtent.xy);
        float inField = step(0.0, fieldUv.x) * step(fieldUv.x, 1.0) * step(0.0, fieldUv.y) * step(fieldUv.y, 1.0);
        vec2 margins = texture2D(uGroundField, vec2(fieldUv.x, 1.0 - fieldUv.y)).rg * inField;
        float grassy = ${painted ? 'smoothstep(0.0, 0.045, diffuseColor.g - diffuseColor.r * 0.96)' : '1.0'};
        vec3 lawn = diffuseColor.rgb;
        lawn *= 0.88 + broad.g * 0.20 + fine.g * 0.10;
        float dry = smoothstep(0.51, 0.74, patchNoise.r * 0.65 + broad.r * 0.35);
        lawn = mix(lawn, vec3(0.19, 0.175, 0.075), dry * 0.28);
        vec3 soil = mix(vec3(0.065, 0.043, 0.023), vec3(0.17, 0.125, 0.067), fine.r);
        float litter = smoothstep(0.10, 0.82, margins.r + (fine.g - 0.5) * 0.25);
        float edge = margins.g * (0.30 + fine.r * 0.55);
        lawn = mix(lawn, soil, clamp(litter * 0.7 + edge * 0.55, 0.0, 0.78));
        diffuseColor.rgb = mix(diffuseColor.rgb, lawn, grassy);
      `)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        float groundRelief = texture2D(uGroundNoise, vGroundPosition.xz / 0.55).g * 0.0018;
        vec3 groundDx = dFdx(-vViewPosition), groundDy = dFdy(-vViewPosition);
        vec3 groundR1 = cross(groundDy, normal), groundR2 = cross(normal, groundDx);
        float groundDet = dot(groundDx, groundR1) * faceDirection;
        vec3 groundGradient = sign(groundDet) * (dFdx(groundRelief) * groundR1 + dFdy(groundRelief) * groundR2);
        normal = normalize(max(abs(groundDet), 0.00000001) * normal - groundGradient);
      `);
  };
  material.customProgramCacheKey = () => `ground-detail-${painted ? 'terrain' : 'lawn'}-v1`;
  return material;
}

export function buildGroundCover(scene, height, data) {
  if (!field) return;
  const blocked = new Map();
  const insert = (bounds, obstacle) => {
    for (let x = Math.floor(bounds[0] / 32); x <= Math.floor(bounds[2] / 32); x++) {
      for (let z = Math.floor(bounds[1] / 32); z <= Math.floor(bounds[3] / 32); z++) {
        const key = `${x}|${z}`;
        if (!blocked.has(key)) blocked.set(key, []);
        blocked.get(key).push(obstacle);
      }
    }
  };
  for (const pts of [...data.buildings.map((b) => b.outer), ...data.areas.filter((a) => !['grass', 'park'].includes(a.kind)).map((a) => a.pts)]) {
    const b = bbox(pts); insert([b[0] - 0.3, b[1] - 0.3, b[2] + 0.3, b[3] + 0.3], { pts });
  }
  for (const road of data.roads) {
    const foot = ['foot', 'path', 'track'].includes(road.kind);
    const margin = (road.kind === 'service' ? 5.6 : road.w || 3) / 2 + (foot ? 0.3 : 2.5);
    for (let i = 0; i < road.pts.length - (road.closed ? 0 : 1); i++) {
      const a = road.pts[i], b = road.pts[(i + 1) % road.pts.length];
      insert([Math.min(a[0], b[0]) - margin, Math.min(a[1], b[1]) - margin, Math.max(a[0], b[0]) + margin, Math.max(a[1], b[1]) + margin], { a, b, margin });
    }
  }
  const bytes = field.g.getImageData(0, 0, 2048, 2048).data;
  const [x0, z0, x1, z1] = field.extent;
  const bounds = bbox(data.boundary), buckets = new Map(), random = rng(501);
  for (let x = bounds[0]; x < bounds[2]; x += 0.75) for (let z = bounds[1]; z < bounds[3]; z += 0.75) {
    if (random() > 0.75) continue;
    const px = x + random() * 0.7, pz = z + random() * 0.7;
    if (!pip(px, pz, data.boundary)) continue;
    const rb = field.roundabout, radius = Math.hypot(px - rb.x, pz - rb.z);
    if (radius > 25 && radius < 35) continue;
    const gate = field.gate, dx = px - gate.x, dz = pz - gate.z;
    const lx = dx * Math.cos(gate.ang) + dz * Math.sin(gate.ang);
    const lz = -dx * Math.sin(gate.ang) + dz * Math.cos(gate.ang);
    if (lx > -36 && lx < 19 && Math.abs(lz) < 8) continue;
    const ix = Math.min(2047, Math.max(0, Math.floor((px - x0) / (x1 - x0) * 2048)));
    const iz = Math.min(2047, Math.max(0, Math.floor((pz - z0) / (z1 - z0) * 2048)));
    if (bytes[(iz * 2048 + ix) * 4] > 110) continue;
    const obstacles = blocked.get(`${Math.floor(px / 32)}|${Math.floor(pz / 32)}`) || [];
    if (obstacles.some((o) => {
      if (o.pts) return pip(px, pz, o.pts) || distToPoly(px, pz, o.pts) < 0.25;
      const vx = o.b[0] - o.a[0], vz = o.b[1] - o.a[1];
      const t = THREE.MathUtils.clamp(((px - o.a[0]) * vx + (pz - o.a[1]) * vz) / (vx * vx + vz * vz || 1), 0, 1);
      return Math.hypot(px - o.a[0] - t * vx, pz - o.a[1] - t * vz) < o.margin;
    })) continue;
    const key = `${Math.floor(px / 48)}|${Math.floor(pz / 48)}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push([px, pz, 0.6 + random() * 0.7, random() * Math.PI * 2]);
  }
  const positions = [], normals = [], colors = [], indices = [];
  const base = new THREE.Color('#596642'), tip = new THREE.Color('#83975a');
  for (let i = 0; i < 8; i++) {
    const a = random() * Math.PI * 2, r = random() * 0.12, w = 0.0025 + random() * 0.002;
    const h = 0.06 + random() * 0.07, bend = 0.02 + random() * 0.035;
    const x = Math.cos(a) * r, z = Math.sin(a) * r, c = Math.cos(a), s = Math.sin(a);
    const start = positions.length / 3;
    for (const [width, y, lean] of [[-w, 0, 0], [w, 0, 0], [-w * 0.5, h * 0.6, bend * 0.3], [w * 0.5, h * 0.6, bend * 0.3], [0, h, bend]]) {
      positions.push(x + c * width + s * lean, y, z + s * width - c * lean);
      normals.push(s * 0.35, 0.88, -c * 0.35);
      const color = base.clone().lerp(tip, y / h); colors.push(color.r, color.g, color.b);
    }
    indices.push(start, start + 1, start + 2, start + 1, start + 3, start + 2, start + 2, start + 3, start + 4);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); geometry.setIndex(indices);
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uGrassTime = grassTime;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uGrassTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        transformed.x += sin(uGrassTime * 1.5 + instanceMatrix[3].x * 0.6 + instanceMatrix[3].z * 0.8) * position.y * 0.12;`);
  };
  material.customProgramCacheKey = () => 'short-grass-v1';
  const group = new THREE.Group(); group.name = 'Ground grass';
  const object = new THREE.Object3D();
  for (const [key, list] of buckets) {
    const mesh = new THREE.InstancedMesh(geometry, material, list.length);
    list.forEach(([x, z, scale, rotation], i) => {
      object.position.set(x, height(x, z) + 0.006, z); object.rotation.set(0, rotation, 0);
      object.scale.setScalar(scale); object.updateMatrix(); mesh.setMatrixAt(i, object.matrix);
      mesh.setColorAt(i, new THREE.Color().setRGB(0.82 + random() * 0.18, 0.85 + random() * 0.15, 0.65 + random() * 0.25));
    });
    mesh.computeBoundingSphere(); mesh.boundingSphere.radius += 0.1;
    mesh.receiveShadow = true; mesh.castShadow = false; mesh.visible = false;
    const [x, z] = key.split('|').map(Number);
    grassCells.push({ mesh, x: (x + 0.5) * 48, z: (z + 0.5) * 48 }); group.add(mesh);
  }
  scene.add(group);
}

export function updateGroundCover(camera, now) {
  grassTime.value = now * 0.001;
  for (const cell of grassCells) cell.mesh.visible = camera.y < 55
    && Math.hypot(cell.x - camera.x, cell.z - camera.z) < 85;
}
