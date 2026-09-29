// Post-processing. The scene renders into an HDR target that keeps its depth buffer; ambient
// occlusion is reconstructed from that depth (no second pass over the geometry), bloom picks out
// whatever is brighter than white (lamps, signals, headlights), the output pass tone-maps, and SMAA
// smooths the edges. (A multisampled target would antialias for free, but its depth does not
// reliably resolve into a texture on every browser, and the occlusion needs it.)
//
// Quality presets:
//   low     direct render, no post-processing, 1x pixel ratio
//   high    bloom + SMAA, 1x pixel ratio, quarter-size wet reflections
//   ultra   adds ambient occlusion, up to 2x pixel ratio and half-size wet reflections

import * as THREE from "three";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { SMAAPass } from "three/addons/postprocessing/SMAAPass.js";

export const QUALITY = {
  low: { post: false, ao: false, pixelRatio: 1, shadowMap: 2048, reflectionScale: 0.25 },
  high: { post: true, ao: false, pixelRatio: 1, shadowMap: 2048, reflectionScale: 0.25 },
  ultra: { post: true, ao: true, pixelRatio: 2, shadowMap: 4096, reflectionScale: 0.5 },
};

export class PostFX {
  constructor(renderer, scene, camera, { ao = false } = {}) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    const { x: w, y: h } = renderer.getDrawingBufferSize(new THREE.Vector2());
    const depthTexture = new THREE.DepthTexture(w, h);
    depthTexture.format = THREE.DepthStencilFormat;
    depthTexture.type = THREE.UnsignedInt248Type;
    this.sceneRT = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthTexture });
    this.blendRT = null;
    this.ldrRT = new THREE.WebGLRenderTarget(w, h);
    this.ao = null;
    this.setAO(ao);

    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.32, 0.45, 1.0);
    this.output = new OutputPass();
    this.smaa = new SMAAPass();
    this.smaa.setSize(w, h);
    this.smaa.renderToScreen = true;
  }

  setAO(enabled) {
    if (!!this.ao === enabled) return;
    if (!enabled) {
      this.ao.dispose(); this.blendRT.dispose();
      this.ao = null; this.blendRT = null;
      return;
    }
    const { width: w, height: h, depthTexture } = this.sceneRT;
    this.blendRT = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType });

    // AO at half resolution, in world units: a meter or so of reach darkens the ground under cars,
    // the foot of every wall, and the corners of eaves and window reveals.
    this.ao = new GTAOPass(this.scene, this.camera, Math.ceil(w / 2), Math.ceil(h / 2));
    this.ao.setGBuffer(depthTexture);
    this.ao.updateGtaoMaterial({ radius: 1.5, distanceExponent: 1.5, thickness: 1.8, scale: 1.6, samples: 12, distanceFallOff: 1.0 });
    this.ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 3, rings: 2, samples: 8 });
    this.ao.blendIntensity = 1.0;
    // depth-reconstructed normals are noise a few hundred meters out (depth precision runs out),
    // and occlusion there is invisible anyway: fade it away with distance
    const m = this.ao.gtaoMaterial;
    m.fragmentShader = m.fragmentShader.replace("ao = pow(ao, scale);", "ao = pow(ao, scale);\n\t\t\tao = mix(ao, 1.0, smoothstep(60.0, 160.0, -viewPos.z));");
    m.needsUpdate = true;
  }

  setSize(w, h) {
    this.sceneRT.setSize(w, h);
    this.blendRT?.setSize(w, h);
    this.ldrRT.setSize(w, h);
    this.smaa.setSize(w, h);
    this.ao?.setSize(Math.ceil(w / 2), Math.ceil(h / 2));
    this.bloom.setSize(w, h);
  }

  // Night asks for more bloom: lamps are the brightest things in view.
  setBloom(strength, threshold) {
    this.bloom.strength = strength;
    this.bloom.threshold = threshold;
  }

  render() {
    const r = this.renderer;
    r.setRenderTarget(this.sceneRT);
    r.clear();
    r.render(this.scene, this.camera);
    let source = this.sceneRT;
    if (this.ao) {
      this.ao.render(r, this.blendRT, this.sceneRT);
      source = this.blendRT;
    }
    this.bloom.render(r, null, source);             // adds the glow in place
    this.output.render(r, this.ldrRT, source);      // tone map
    this.smaa.render(r, null, this.ldrRT);           // antialias to the screen
  }

  dispose() {
    this.sceneRT.dispose();
    this.blendRT?.dispose();
    this.ldrRT.dispose();
    this.smaa.dispose();
    this.ao?.dispose();
    this.bloom.dispose();
    this.output.dispose();
  }
}
