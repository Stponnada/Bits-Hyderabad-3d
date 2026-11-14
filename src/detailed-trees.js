import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { canvasTex, rng } from './textures.js';

// Full geometry is reserved for nearby trees; distant additions use a much
// cheaper canopy with the same foliage texture, rather than disappearing.
const CELL = 128;
const FAR_CELL = 512;
const DETAIL_RANGE = 95;
const MID_RANGE = 230;
const clock = { value: 0 };
const lodGroups = [];
const farMeshes = [];
// Avoid singular normal matrices while making the inactive far instances
// much smaller than a pixel. Their full bounds are retained for later restores.
const hiddenMatrix = new THREE.Matrix4().makeScale(1e-7, 1e-7, 1e-7);

function sprayTexture() {
  return canvasTex(512, 512, (g, w, h) => {
    const random = rng(914);
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#a8a496'; g.fillRect(0, h - 12, 12, 12);
    // A connected leafy twig, with transparent space between individual leaves.
    // Keeping empty space around the edge avoids rectangular card silhouettes.
    for (let branch = 0; branch < 9; branch++) {
      const a = -Math.PI / 2 + (branch - 4) * 0.31;
      const start = new THREE.Vector2(256, 405);
      const end = new THREE.Vector2(256 + Math.cos(a) * 230, 405 + Math.sin(a) * 290);
      g.strokeStyle = '#747151'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(start.x, start.y); g.lineTo(end.x, end.y); g.stroke();
      for (let i = 1; i < 11; i++) {
        const t = i / 11;
        for (const side of [-1, 1]) {
          const x = THREE.MathUtils.lerp(start.x, end.x, t);
          const y = THREE.MathUtils.lerp(start.y, end.y, t);
          const la = a + side * (0.55 + random() * 0.3);
          const length = (25 + random() * 13) * (1 - t * 0.25);
          g.save(); g.translate(x, y); g.rotate(la);
          const shade = 0.72 + random() * 0.28;
          const gradient = g.createLinearGradient(0, -13, 0, 13);
          gradient.addColorStop(0, `rgb(${185 * shade},${199 * shade},${139 * shade})`);
          gradient.addColorStop(0.5, `rgb(${239 * shade},${242 * shade},${197 * shade})`);
          gradient.addColorStop(1, `rgb(${154 * shade},${172 * shade},${115 * shade})`);
          g.fillStyle = gradient;
          g.beginPath(); g.moveTo(0, 0);
          g.bezierCurveTo(length * 0.6, -14, length * 1.3, -12, length * 1.8, 0);
          g.bezierCurveTo(length * 1.1, 13, length * 0.5, 14, 0, 0); g.fill();
          g.restore();
        }
      }
    }
  }, { repeat: false });
}

const wind = `
  vec3 treeOrigin = vec3(0.0);
  #ifdef USE_INSTANCING
    treeOrigin = instanceMatrix[3].xyz;
  #endif
  float phase = dot(treeOrigin.xz, vec2(0.13, 0.19));
  float bend = smoothstep(2.8, 9.0, position.y);
  transformed.x += sin(uTreeTime * 1.1 + phase + position.y * 0.45) * bend * 0.055;
  transformed.z += cos(uTreeTime * 0.8 + phase + position.x) * bend * 0.035;
`;

export function animateMaterial(material, transmission = false) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTreeTime = clock;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTreeTime;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + wind);
    if (transmission) {
      // Extend Three's direct-light response: transmitted light is attenuated
      // by the same shadow term as the front lighting, with no emissive glow.
      shader.fragmentShader = shader.fragmentShader.replace('#include <lights_physical_pars_fragment>', `
        #include <lights_physical_pars_fragment>
        void RE_Direct_Leaf(const in IncidentLight light, const in vec3 p,
          const in vec3 n, const in vec3 view, const in vec3 clearcoatN,
          const in PhysicalMaterial mat, inout ReflectedLight reflected) {
          RE_Direct_Physical(light, p, n, view, clearcoatN, mat, reflected);
          float back = pow(saturate(dot(view, -light.direction)), 3.0);
          reflected.directDiffuse += light.color * BRDF_Lambert(mat.diffuseColor)
            * (0.12 + 0.35 * back) * (1.0 - saturate(dot(n, light.direction)));
        }
        #undef RE_Direct
        #define RE_Direct RE_Direct_Leaf
      `);
    }
  };
  material.customProgramCacheKey = () => `detailed-tree-${transmission ? 'leaf' : 'depth'}-v1`;
  return material;
}

function treeGeometry(kind, seed, quality) {
  const far = quality === 'far', mid = quality === 'mid';
  const random = rng(seed);
  const branches = [], cards = [];
  const branch = (a, b, radius) => {
    const delta = b.clone().sub(a);
    // Fine twigs need a silhouette, not capped five-sided cylinders repeated
    // hundreds of times per tree. Reserve the rounder mesh for main branches.
    const twig = radius < 0.04;
    const g = new THREE.CylinderGeometry(radius * 0.38, radius, delta.length(), twig || far ? 3 : 5, 1, twig || far);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize()));
    g.translate(...a.clone().add(b).multiplyScalar(0.5).toArray());
    branches.push(g);
  };
  const card = (at, size, angle, tilt) => {
    const g = new THREE.PlaneGeometry(size, size);
    g.rotateX(tilt); g.rotateY(angle); g.translate(...at.toArray());
    const p = g.attributes.position, colors = [], normals = g.attributes.normal;
    const shade = 0.75 + random() * 0.25;
    const c = new THREE.Color().setHSL(0.24 + random() * 0.035, 0.28 + random() * 0.13, 0.38 + random() * 0.08);
    for (let i = 0; i < p.count; i++) {
      // Smooth the lighting across sprays rather than illuminating each quad
      // as a flat sheet. Slightly darker inner/lower leaves supply canopy depth.
      const outward = new THREE.Vector3(p.getX(i), (p.getY(i) - 4) * 0.65, p.getZ(i)).normalize();
      const n = new THREE.Vector3().fromBufferAttribute(normals, i).multiplyScalar(0.35).addScaledVector(outward, 0.65).normalize();
      normals.setXYZ(i, n.x, n.y, n.z);
      const f = shade * THREE.MathUtils.lerp(0.80, 1, THREE.MathUtils.clamp((at.y - 3) / 5, 0, 1));
      colors.push(c.r * f, c.g * f, c.b * f);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    cards.push(g);
  };
  const tall = kind === 'tall';
  const trunkTop = new THREE.Vector3(0.12, tall ? 8.7 : 4.1, -0.1);
  branch(new THREE.Vector3(), trunkTop, tall ? 0.19 : 0.28);
  const count = far ? (tall ? 4 : 3) : mid ? (tall ? 8 : 6) : (tall ? 20 : 14);
  for (let i = 0; i < count; i++) {
    const angle = i * 2.39996 + random() * 0.5;
    const y = tall ? 3.3 + (i / count) * 6.2 : 3.1 + random() * 0.9;
    const start = new THREE.Vector3(0.05, y, 0);
    const radius = tall ? (1.35 - (i / count) * 0.75) : 1.6 + random() * 1.5;
    const end = new THREE.Vector3(Math.cos(angle) * radius, tall ? y + 0.55 : 4.8 + random() * 1.7, Math.sin(angle) * radius);
    branch(start, end, tall ? 0.055 : 0.11);
    const sprays = far ? 1 : mid ? (tall ? 2 : 3) : (tall ? 4 : 7);
    for (let j = 0; j < sprays; j++) {
      const a = angle + (random() - 0.5) * 2.8;
      const reach = (tall ? 0.25 : 0.45) + random() * (tall ? 0.4 : 0.9);
      const tip = end.clone().add(new THREE.Vector3(Math.cos(a) * reach, (random() - 0.25) * 1.15, Math.sin(a) * reach));
      branch(end, tip, 0.022);
      for (let k = 0; k < 2; k++) {
        card(tip, (tall ? 1.3 : 1.85) + (far ? 2.2 : mid ? 0.7 : 0) + random() * 0.5, a + k * Math.PI / 2, (random() - 0.5) * 2.5);
      }
    }
  }
  const bark = mergeGeometries(branches), leaves = mergeGeometries(cards);
  for (const g of [...branches, ...cards]) g.dispose();
  return { bark, leaves };
}

export function buildDetailedTrees(trees, scene, height) {
  if (!trees.length) return;
  const texture = sprayTexture();
  const leafMaterial = animateMaterial(new THREE.MeshStandardMaterial({
    map: texture, vertexColors: true, roughness: 0.94, metalness: 0,
    alphaTest: 0.28, side: THREE.DoubleSide, alphaToCoverage: true,
  }), true);
  const depth = animateMaterial(new THREE.MeshDepthMaterial({
    map: texture, alphaTest: 0.28, side: THREE.DoubleSide, depthPacking: THREE.RGBADepthPacking,
  }));
  const barkTexture = canvasTex(128, 256, (g, w, h) => {
    const random = rng(2026);
    g.fillStyle = '#625d50'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 550; i++) {
      g.fillStyle = random() < 0.55 ? '#575447' : '#736b5b';
      g.fillRect(random() * w, random() * h, 1 + random() * 2, 5 + random() * 24);
    }
  });
  const barkMaterial = new THREE.MeshStandardMaterial({ map: barkTexture, bumpMap: barkTexture, bumpScale: 0.035, roughness: 0.98 });
  const geometry = {};
  for (const kind of ['broad', 'tall']) for (let v = 0; v < 2; v++) {
    for (const quality of ['near', 'mid', 'far']) {
      const parts = treeGeometry(kind, 813 + v * 79, quality);
      if (quality === 'far') {
        const color = new THREE.Color('#625d50');
        const colors = [];
        for (let i = 0; i < parts.bark.attributes.position.count; i++) {
          colors.push(color.r, color.g, color.b);
          parts.bark.attributes.uv.setXY(i, 0.01, 0.01);
        }
        parts.bark.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        geometry[`${kind}${v}far`] = mergeGeometries([parts.bark, parts.leaves]);
        parts.bark.dispose(); parts.leaves.dispose();
      } else geometry[`${kind}${v}${quality}`] = parts;
    }
  }
  const farBuckets = new Map(), cells = new Map();
  const object = new THREE.Object3D();
  trees.forEach((tree) => {
    const random = rng(3781 + tree.parent * 607);
    tree.variant = Math.floor(random() * 2);
    object.position.set(tree.x, height(tree.x, tree.z) - 0.08, tree.z);
    object.rotation.set(0, tree.rot, 0);
    object.scale.set(tree.s * (0.9 + random() * 0.22), tree.s, tree.s * (0.9 + random() * 0.22));
    object.updateMatrix(); tree.matrix = object.matrix.clone();
    const key = `${tree.kind}|${tree.variant}|${Math.floor(tree.x / FAR_CELL)}|${Math.floor(tree.z / FAR_CELL)}`;
    if (!farBuckets.has(key)) farBuckets.set(key, []);
    farBuckets.get(key).push(tree);
    const cellKey = `${tree.kind}|${tree.variant}|${Math.floor(tree.x / CELL)}|${Math.floor(tree.z / CELL)}`;
    if (!cells.has(cellKey)) cells.set(cellKey, []);
    cells.get(cellKey).push(tree);
  });
  const group = new THREE.Group(); group.name = 'Additional detailed trees';
  group.userData.count = trees.length;
  for (const list of farBuckets.values()) {
    const first = list[0];
    const mesh = new THREE.InstancedMesh(geometry[`${first.kind}${first.variant}far`], leafMaterial, list.length);
    list.forEach((tree, i) => {
      mesh.setMatrixAt(i, tree.matrix); tree.farMesh = mesh; tree.farIndex = i;
    });
    mesh.computeBoundingSphere(); mesh.boundingSphere.radius += 0.2;
    // Their near/mid versions cast the detailed local shadows. The distant
    // canopy is batched widely and costs only a few dozen triangles per tree.
    mesh.castShadow = false; mesh.receiveShadow = false;
    farMeshes.push(mesh);
    group.add(mesh);
  }
  const makeDetail = (list, quality) => {
    const first = list[0], parts = geometry[`${first.kind}${first.variant}${quality}`];
    const result = new THREE.Group();
    for (const [part, material] of [['bark', barkMaterial], ['leaves', leafMaterial]]) {
      const mesh = new THREE.InstancedMesh(parts[part], material, list.length);
      list.forEach((tree, i) => mesh.setMatrixAt(i, tree.matrix));
      mesh.castShadow = true; mesh.receiveShadow = quality === 'near';
      if (part === 'leaves') mesh.customDepthMaterial = depth;
      mesh.computeBoundingSphere(); mesh.boundingSphere.radius += 0.2;
      result.add(mesh);
    }
    group.add(result);
    return result;
  };
  for (const list of cells.values()) {
    const bounds = new THREE.Box3();
    for (const t of list) bounds.expandByPoint(new THREE.Vector3(t.x, height(t.x, t.z) + t.s * 4, t.z));
    lodGroups.push({ list, centre: bounds.getCenter(new THREE.Vector3()),
      radius: bounds.getSize(new THREE.Vector3()).length() / 2 + 12,
      stage: 'far', near: null, mid: null, makeDetail });
  }
  scene.add(group);
}

export function updateDetailedTrees(camera, now, visibleRange = Infinity) {
  clock.value = now * 0.001;
  for (const mesh of farMeshes) mesh.visible = camera.distanceTo(mesh.boundingSphere.center) - mesh.boundingSphere.radius < visibleRange;
  const changed = new Set();
  for (const cell of lodGroups) {
    const distance = camera.distanceTo(cell.centre) - cell.radius;
    const stage = distance < DETAIL_RANGE + (cell.stage === 'near' ? 18 : 0) ? 'near'
      : distance < MID_RANGE + (cell.stage === 'mid' ? 25 : 0) ? 'mid' : 'far';
    if (stage === cell.stage) continue;
    if (stage !== 'far' && !cell[stage]) cell[stage] = cell.makeDetail(cell.list, stage);
    if (cell.near) cell.near.visible = stage === 'near';
    if (cell.mid) cell.mid.visible = stage === 'mid';
    if ((stage === 'far') !== (cell.stage === 'far')) {
      for (const tree of cell.list) {
        tree.farMesh.setMatrixAt(tree.farIndex, stage === 'far' ? tree.matrix : hiddenMatrix);
        changed.add(tree.farMesh);
      }
    }
    cell.stage = stage;
  }
  for (const mesh of changed) mesh.instanceMatrix.needsUpdate = true;
}
