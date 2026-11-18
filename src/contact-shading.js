import * as THREE from 'three';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export function createContactShading(renderer, scene, camera) {
  const target = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    samples: Math.min(4, renderer.capabilities.maxSamples),
    depthTexture: new THREE.DepthTexture(1, 1, THREE.UnsignedIntType),
  });
  // Reuse the beauty pass's depth: an override normal material would fill in
  // the alpha-cutout foliage, producing dark rectangles around the trees.
  const ao = new GTAOPass(scene, camera, 1, 1);
  ao.setGBuffer(target.depthTexture);
  ao.output = GTAOPass.OUTPUT.Off;
  ao.updateGtaoMaterial({ radius: 0.9, thickness: 0.65, distanceFallOff: 0.65,
    distanceExponent: 1.4, scale: 1, samples: 8, screenSpaceRadius: false });
  ao.updatePdMaterial({ radius: 3, samples: 8, rings: 2, depthPhi: 2, normalPhi: 3 });

  const output = new OutputPass();
  Object.assign(output.uniforms, {
    tAO: { value: ao.gtaoMap }, tDepth: { value: target.depthTexture },
    contactStrength: { value: 0.38 },
    clipNear: { value: camera.near }, clipFar: { value: camera.far },
  });
  output.material.fragmentShader = output.material.fragmentShader
    .replace('uniform sampler2D tDiffuse;', `uniform sampler2D tDiffuse;
      uniform sampler2D tAO; uniform sampler2D tDepth;
      uniform float contactStrength; uniform float clipNear; uniform float clipFar;`)
    .replace('gl_FragColor = texture2D( tDiffuse, vUv );', `
      gl_FragColor = texture2D(tDiffuse, vUv);
      float depth = texture2D(tDepth, vUv).r;
      float distance = clipNear * clipFar / (clipFar - depth * (clipFar - clipNear));
      float strength = contactStrength * (1.0 - smoothstep(100.0, 350.0, distance));
      gl_FragColor.rgb *= mix(1.0, clamp(texture2D(tAO, vUv).r, 0.0, 1.0), strength);
    `);
  output.renderToScreen = true;
  renderer.info.autoReset = false;

  let aoOn = true, isNight = false;
  const strength = () => { output.uniforms.contactStrength.value = aoOn ? (isNight ? 0.22 : 0.38) : 0; };
  return {
    setNight(night) { isNight = night; strength(); },
    // quality controls: ambient occlusion can be skipped and the multisample count lowered
    setAO(on) { aoOn = on; strength(); },
    setSamples(n) { const v = Math.min(n, renderer.capabilities.maxSamples); if (target.samples !== v) { target.samples = v; target.dispose(); } },
    resize(width, height) {
      const ratio = renderer.getPixelRatio();
      const w = Math.round(width * ratio), h = Math.round(height * ratio);
      target.setSize(w, h);
      // Keep the contact pass light on retina displays; the main image remains
      // full resolution and multisampled for the foliage and building edges.
      const scale = Math.min(0.5, 960 / w);
      ao.setSize(Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale)));
    },
    render() {
      renderer.info.reset();
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      if (aoOn) ao.render(renderer, null, target);
      output.render(renderer, null, target);
      // Labels use a separate layer so contact shading never dirties the text
      // or mistakes a screen-facing name plate for world geometry.
      const background = scene.background, autoClear = renderer.autoClear;
      scene.background = null; renderer.autoClear = false;
      camera.layers.set(1); renderer.clearDepth();
      renderer.render(scene, camera);
      camera.layers.set(0); renderer.autoClear = autoClear; scene.background = background;
    },
  };
}
