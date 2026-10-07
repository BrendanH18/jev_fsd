// Post-processing. The scene renders into an HDR target that keeps its depth buffer; ambient
// occlusion is reconstructed from that depth (no second pass over the geometry), bloom picks out
// whatever is brighter than white (lamps, signals, headlights), the output pass tone-maps, a grade
// pass sets contrast, colour and vignette and dithers away sky banding, and SMAA smooths the edges. (A multisampled target would antialias for free, but its depth does not
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
import { FullScreenQuad } from "three/addons/postprocessing/Pass.js";

// Display-referred grade. Contrast pivots around mid-grey, saturation is measured against Rec. 709
// luma, and a half-step of blue-noise-like dither hides 8-bit banding in smooth sky gradients.
export const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    contrast: { value: 1 },
    saturation: { value: 1 },
    tint: { value: new THREE.Color(1, 1, 1) },
    vignette: { value: 0 },
    aspect: { value: 1 },
    seed: { value: 0 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float contrast, saturation, vignette, aspect, seed;
    uniform vec3 tint;
    varying vec2 vUv;
    float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
    void main() {
      vec4 texel = texture2D(tDiffuse, vUv);
      vec3 c = texel.rgb;
      c = (c - 0.5) * contrast + 0.5;
      float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(luma), c, saturation) * tint;
      vec2 q = (vUv - 0.5) * vec2(aspect, 1.0);
      c *= 1.0 - vignette * smoothstep(0.35, 1.05, length(q));
      c += (ign(gl_FragCoord.xy + seed * 5.588238) - 0.5) / 255.0;
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), texel.a);
    }`,
};

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
    this.gradeRT = new THREE.WebGLRenderTarget(w, h);
    this.grade = new THREE.ShaderMaterial({ ...GradeShader, uniforms: THREE.UniformsUtils.clone(GradeShader.uniforms) });
    this.grade.uniforms.aspect.value = w / Math.max(1, h);
    this.gradeQuad = new FullScreenQuad(this.grade);
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
    this.gradeRT.setSize(w, h);
    this.grade.uniforms.aspect.value = w / Math.max(1, h);
    this.smaa.setSize(w, h);
    this.ao?.setSize(Math.ceil(w / 2), Math.ceil(h / 2));
    this.bloom.setSize(w, h);
  }

  // Night asks for more bloom: lamps are the brightest things in view.
  setBloom(strength, threshold) {
    this.bloom.strength = strength;
    this.bloom.threshold = threshold;
  }

  setGrade({ contrast, saturation, tint, vignette }) {
    const u = this.grade.uniforms;
    u.contrast.value = contrast;
    u.saturation.value = saturation;
    u.tint.value.copy(tint);
    u.vignette.value = vignette;
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
    this.grade.uniforms.tDiffuse.value = this.ldrRT.texture;
    this.grade.uniforms.seed.value = (this.grade.uniforms.seed.value + 1) % 64;
    r.setRenderTarget(this.gradeRT);
    this.gradeQuad.render(r);                         // colour grade, vignette, dither
    this.smaa.render(r, null, this.gradeRT);          // antialias to the screen
  }

  dispose() {
    this.sceneRT.dispose();
    this.blendRT?.dispose();
    this.ldrRT.dispose();
    this.gradeRT.dispose();
    this.grade.dispose();
    this.gradeQuad.dispose();
    this.smaa.dispose();
    this.ao?.dispose();
    this.bloom.dispose();
    this.output.dispose();
  }
}
