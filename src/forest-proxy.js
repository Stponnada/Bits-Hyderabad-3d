import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Capture the actual tree's crown and silhouette once. Crossed side views plus
// a top view preserve canopy coverage from aerial cameras for only six triangles.
export function bakeForestProxy(renderer, geometry, bark, foliage) {
  const scene = new THREE.Scene();
  const branch = new THREE.Mesh(geometry.branches, new THREE.MeshBasicMaterial({ map: bark.map, color: bark.color }));
  const leaves = new THREE.Mesh(geometry.leaves, new THREE.MeshBasicMaterial({ map: foliage.map, color: foliage.color,
    alphaTest: 0.42, side: THREE.DoubleSide }));
  scene.add(branch, leaves);
  const box = new THREE.Box3().setFromObject(scene), centre = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3()).multiplyScalar(1.06);
  const target = new THREE.WebGLRenderTarget(256, 512, { minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter, generateMipmaps: true });
  const oldTarget = renderer.getRenderTarget(), oldClear = renderer.getClearColor(new THREE.Color()), oldAlpha = renderer.getClearAlpha();
  const viewport = renderer.getViewport(new THREE.Vector4()), scissor = renderer.getScissor(new THREE.Vector4());
  const scissorTest = renderer.getScissorTest();
  const ratio = renderer.getPixelRatio();
  renderer.setRenderTarget(target); renderer.setScissorTest(true); renderer.setClearColor(0, 0);
  const camera = new THREE.OrthographicCamera(-size.x / 2, size.x / 2, size.y / 2, -size.y / 2, 0.1, size.length() * 5);
  camera.position.set(centre.x, centre.y, box.max.z + size.length() * 2); camera.lookAt(centre);
  renderer.setViewport(0, 256 / ratio, 256 / ratio, 256 / ratio);
  renderer.setScissor(0, 256 / ratio, 256 / ratio, 256 / ratio); renderer.render(scene, camera);
  camera.top = size.z / 2; camera.bottom = -size.z / 2; camera.updateProjectionMatrix();
  camera.position.set(centre.x, box.max.y + size.length() * 2, centre.z); camera.up.set(0, 0, -1); camera.lookAt(centre);
  renderer.setViewport(0, 0, 256 / ratio, 256 / ratio);
  renderer.setScissor(0, 0, 256 / ratio, 256 / ratio); renderer.render(scene, camera);
  renderer.setRenderTarget(oldTarget); renderer.setViewport(viewport); renderer.setScissor(scissor);
  renderer.setScissorTest(scissorTest); renderer.setClearColor(oldClear, oldAlpha);
  branch.material.dispose(); leaves.material.dispose();

  const front = new THREE.PlaneGeometry(size.x, size.y).translate(centre.x, centre.y, centre.z);
  const side = new THREE.PlaneGeometry(size.x, size.y).rotateY(Math.PI / 2).translate(centre.x, centre.y, centre.z);
  const top = new THREE.PlaneGeometry(size.x, size.z).rotateX(-Math.PI / 2).translate(centre.x, box.min.y + size.y * 0.72, centre.z);
  for (const g of [front, side]) {
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setY(i, 0.5 + uv.getY(i) * 0.5);
  }
  for (let i = 0; i < top.attributes.uv.count; i++) top.attributes.uv.setY(i, top.attributes.uv.getY(i) * 0.5);
  const merged = mergeGeometries([front, side, top]);
  front.dispose(); side.dispose(); top.dispose();
  const material = new THREE.MeshStandardMaterial({ map: target.texture, alphaTest: 0.28,
    side: THREE.DoubleSide, alphaToCoverage: true, roughness: 1 });
  return { geometry: merged, material };
}
