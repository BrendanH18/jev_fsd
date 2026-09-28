// Post-processing. The scene renders into an HDR target that keeps its depth buffer; ambient
// occlusion is reconstructed from that depth (no second pass over the geometry), bloom picks out
// whatever is brighter than white (lamps, signals, headlights), the output pass tone-maps, and SMAA
// smooths the edges. (A multisampled target would antialias for free, but its depth does not
// reliably resolve into a texture on every browser, and the occlusion needs it.)
//
// Quality presets:
//   low     direct render, no post-processing, 1x pixel ratio
//   high    ambient occlusion + bloom + SMAA, up to 1.5x pixel ratio
//   ultra   the same at the display's full pixel ratio (up to 2x)

import * as THREE from "three";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { SMAAPass } from "three/addons/postprocessing/SMAAPass.js";

export const QUALITY = {
  low: { post: false, pixelRatio: 1, shadowMap: 2048 },
  high: { post: true, pixelRatio: 1.5, shadowMap: 4096 },
  ultra: { post: true, pixelRatio: 2, shadowMap: 4096 },
};

export class PostFX {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    const { x: w, y: h } = renderer.getDrawingBufferSize(new THREE.Vector2());
    const depthTexture = new THREE.DepthTexture(w, h);
    depthTexture.format = THREE.DepthStencilFormat;
    depthTexture.type = THREE.UnsignedInt248Type;
    this.sceneRT = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthTexture });
    this.blendRT = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType });
    this.ldrRT = new THREE.WebGLRenderTarget(w, h);

    // AO at half resolution, in world units: a meter or so of reach darkens the ground under cars,
    // the foot of every wall, and the corners of eaves and window reveals.
    this.ao = new GTAOPass(scene, camera, Math.ceil(w / 2), Math.ceil(h / 2));
    this.ao.setGBuffer(depthTexture);
    this.ao.updateGtaoMaterial({ radius: 1.5, distanceExponent: 1.5, thickness: 1.8, scale: 1.6, samples: 12, distanceFallOff: 1.0 });
    this.ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
    this.ao.blendIntensity = 1.0;

    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.32, 0.45, 1.0);
    this.output = new OutputPass();
    this.smaa = new SMAAPass();
    this.smaa.setSize(w, h);
    this.smaa.renderToScreen = true;
  }

  setSize(w, h) {
    this.sceneRT.setSize(w, h);
    this.blendRT.setSize(w, h);
    this.ldrRT.setSize(w, h);
    this.smaa.setSize(w, h);
    this.ao.setSize(Math.ceil(w / 2), Math.ceil(h / 2));
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
    this.ao.render(r, this.blendRT, this.sceneRT);   // copies the scene, multiplies the AO in
    this.bloom.render(r, null, this.blendRT);        // adds the glow in place
    this.output.render(r, this.ldrRT, this.blendRT); // tone map
    this.smaa.render(r, null, this.ldrRT);           // antialias to the screen
  }

  dispose() {
    this.sceneRT.dispose();
    this.blendRT.dispose();
    this.ldrRT.dispose();
    this.smaa.dispose();
    this.ao.dispose();
    this.bloom.dispose();
    this.output.dispose();
  }
}
