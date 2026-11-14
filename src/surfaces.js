import * as THREE from 'three';

const cache = new Map();
const size = 512;
function hash(x, y, seed = 17) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ seed;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function noise(x, y, cells, seed) {
  const xx = x * cells / size, yy = y * cells / size;
  const ix = Math.floor(xx), iy = Math.floor(yy);
  const smooth = (v) => v * v * (3 - 2 * v);
  const u = smooth(xx - ix), v = smooth(yy - iy);
  const at = (a, b) => hash((a + cells) % cells, (b + cells) % cells, seed);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(at(ix, iy), at(ix + 1, iy), u),
    THREE.MathUtils.lerp(at(ix, iy + 1), at(ix + 1, iy + 1), u), v);
}
function texture(bytes, srgb = false) {
  const t = new THREE.DataTexture(bytes, size, size, THREE.RGBAFormat);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true; t.anisotropy = 8; t.needsUpdate = true;
  return t;
}

// Each surface shares the same generated pattern across color, normal and
// roughness maps: joints are genuinely recessed in the lighting response.
export function surfaceMaps(kind, color) {
  const key = `${kind}|${color}`;
  if (cache.has(key)) return cache.get(key);
  const rgb = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
  const albedo = new Uint8Array(size * size * 4), roughness = albedo.slice(), normals = albedo.slice();
  const heights = new Float32Array(size * size);
  const pavers = kind === 'pavers', asphalt = kind === 'asphalt';
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x, o = i * 4;
    const grain = hash(x, y, 73), cloud = noise(x, y, 4, 91), wear = noise(x, y, 16, 43);
    let tone, height, rough, joint = 0;
    if (pavers) {
      // One 1.6 m tile: eight 20 cm blocks by sixteen 10 cm courses.
      const row = Math.floor(y / 32), xx = (x + (row % 2) * 32) % size;
      const edge = Math.min(xx % 64, 64 - xx % 64, y % 32, 32 - y % 32);
      const bevel = THREE.MathUtils.smoothstep(edge, 0.7, 3.8);
      joint = 1 - THREE.MathUtils.smoothstep(edge, 0.5, 2.0);
      const block = hash(Math.floor(xx / 64), row, 117);
      tone = 0.88 + block * 0.19 + (grain - 0.5) * 0.09 + (cloud - 0.5) * 0.12;
      height = bevel * (0.8 + block * 0.12) + (grain - 0.5) * 0.055;
      rough = joint ? 0.98 : 0.78 + wear * 0.19;
    } else if (asphalt) {
      const u = x / size;
      const dust = Math.pow(Math.abs(u - 0.5) * 2, 9) * 0.14;
      const tracks = Math.exp(-Math.pow((u - 0.28) / 0.07, 2)) + Math.exp(-Math.pow((u - 0.72) / 0.07, 2));
      tone = 0.96 + (cloud - 0.5) * 0.26 + (wear - 0.5) * 0.12 + (grain - 0.5) * 0.18 + dust - tracks * 0.055;
      height = grain * 0.6 + wear * 0.3;
      rough = 0.80 + wear * 0.18 - tracks * 0.08;
    } else {
      const pit = grain < 0.025;
      tone = 0.97 + (cloud - 0.5) * 0.12 + (wear - 0.5) * 0.07 + (grain - 0.5) * 0.055 - (pit ? 0.08 : 0);
      height = grain * 0.15 + wear * 0.1 - (pit ? 0.2 : 0);
      rough = 0.84 + wear * 0.14;
    }
    heights[i] = height;
    for (let c = 0; c < 3; c++) {
      // Dusty grey sand in paving joints, rather than painted black outlines.
      albedo[o + c] = Math.min(255, rgb[c] * tone * (1 - joint) + [115, 108, 94][c] * joint);
      roughness[o + c] = rough * 255;
    }
    albedo[o + 3] = roughness[o + 3] = normals[o + 3] = 255;
  }
  const strength = pavers ? 0.85 : asphalt ? 0.22 : 0.32;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const at = (xx, yy) => heights[((yy + size) % size) * size + (xx + size) % size];
    const nx = (at(x - 1, y) - at(x + 1, y)) * strength;
    const ny = (at(x, y - 1) - at(x, y + 1)) * strength;
    const inv = 1 / Math.hypot(nx, ny, 1), o = (y * size + x) * 4;
    normals[o] = (nx * inv * 0.5 + 0.5) * 255;
    normals[o + 1] = (ny * inv * 0.5 + 0.5) * 255;
    normals[o + 2] = (inv * 0.5 + 0.5) * 255;
  }
  const result = { map: texture(albedo, true), normalMap: texture(normals), roughnessMap: texture(roughness), roughness: 1 };
  cache.set(key, result);
  return result;
}

export function surfaceMaterial(kind, color, options = {}) {
  return new THREE.MeshStandardMaterial({ ...surfaceMaps(kind, color), ...options });
}

export function facadeRoughness(map) {
  const canvas = map.image, g = canvas.getContext('2d');
  const pixels = g.getImageData(0, 0, canvas.width, canvas.height);
  const p = pixels.data;
  for (let i = 0; i < p.length; i += 4) {
    const glass = p[i + 2] > p[i] * 1.12 && p[i] < 140 && p[i + 1] > p[i];
    const r = glass ? 78 : 228 + (hash(i % canvas.width, Math.floor(i / canvas.width)) - 0.5) * 18;
    p[i] = p[i + 1] = p[i + 2] = r; p[i + 3] = 255;
  }
  const t = new THREE.DataTexture(p, canvas.width, canvas.height, THREE.RGBAFormat);
  t.flipY = true; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true; t.anisotropy = 8; t.needsUpdate = true;
  return t;
}
