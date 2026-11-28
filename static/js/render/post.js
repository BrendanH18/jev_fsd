// Post-processing. The scene renders into an HDR target that keeps its depth buffer; ambient
// occlusion is reconstructed from that depth (no second pass over the geometry), bloom picks out
// whatever is brighter than white (lamps, signals, headlights). One pass tone-maps, grades and
// dithers the image before SMAA smooths the edges.
// Without occlusion (High) the scene target is 4x multisampled. With it (Ultra) it is not: a
// multisampled depth buffer does not reliably resolve into a texture on every browser, and the
// occlusion needs one; Ultra's 2x pixel ratio supersamples instead.
//
// Quality presets:
//   low     direct render to the antialiased canvas, no post-processing, 1x pixel ratio
//   high    4x MSAA + bloom + SMAA, 1x pixel ratio, quarter-size wet reflections
//   ultra   adds ambient occlusion (no MSAA), up to 2x pixel ratio and half-size wet reflections

import * as THREE from "three";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { SMAAPass } from "three/addons/postprocessing/SMAAPass.js";
import { FullScreenQuad } from "three/addons/postprocessing/Pass.js";

// Display-referred grade. Contrast pivots around mid-grey, saturation is measured against Rec. 709
// luma, and a half-step of blue-noise-like dither hides 8-bit banding in smooth sky gradients.
const displayShader = {
  vertexShader: `
    precision highp float;
    uniform mat4 projectionMatrix, modelViewMatrix;
    attribute vec3 position;
    attribute vec2 uv;
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    precision highp float;
    #include <tonemapping_pars_fragment>
    #include <colorspace_pars_fragment>
    uniform sampler2D tDiffuse;
    uniform float contrast, saturation, vignette, aspect, seed;
    uniform vec3 tint;
    varying vec2 vUv;
    float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
    void main() {
      vec4 texel = texture2D(tDiffuse, vUv);
      texel.rgb = ACESFilmicToneMapping(texel.rgb);
      vec3 c = sRGBTransferOETF(texel).rgb;
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
    this.samples = Math.min(4, renderer.capabilities?.maxSamples ?? 4);
    this.disposed = false;
    this.clearColor = new THREE.Color();
    this.sceneRT = this.sceneTarget(w, h, ao);
    this.blendRT = null;
    this.ao = null;
    this.setAO(ao);

    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.32, 0.45, 1.0);
    // SMAA detects edges in display space. Keep one RGBA8 input for all three SMAA passes.
    this.displayRT = new THREE.WebGLRenderTarget(w, h, { depthBuffer: false });
    this.display = new THREE.RawShaderMaterial({
      ...displayShader,
      uniforms: {
        tDiffuse: { value: null },
        toneMappingExposure: { value: 1 },
        contrast: { value: 1 },
        saturation: { value: 1 },
        tint: { value: new THREE.Color(1, 1, 1) },
        vignette: { value: 0 },
        aspect: { value: w / Math.max(1, h) },
        seed: { value: 0 },
      },
    });
    this.displayQuad = new FullScreenQuad(this.display);
    this.smaa = new SMAAPass();
    this.smaa._edgesRT.depthBuffer = false;
    this.smaa._weightsRT.depthBuffer = false;
    this.smaa.setSize(w, h);
    this.smaa.renderToScreen = true;
  }

  // With ambient occlusion the scene target keeps a depth texture for it to read. Without, the
  // target is multisampled instead: real antialiasing for geometry and, through alpha to coverage,
  // for the cut-out edges of leaves, which SMAA alone leaves stair-stepped and crawling.
  sceneTarget(w, h, depth) {
    if (!depth) return new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: this.samples });
    const depthTexture = new THREE.DepthTexture(w, h);
    depthTexture.format = THREE.DepthStencilFormat;
    depthTexture.type = THREE.UnsignedInt248Type;
    return new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthTexture, stencilBuffer: true });
  }

  setAO(enabled) {
    if (this.disposed || (!!this.ao === enabled && !!this.sceneRT.depthTexture === enabled)) return;
    if (!!this.sceneRT.depthTexture !== enabled) {
      const { width, height } = this.sceneRT;
      this.sceneRT.dispose();
      this.sceneRT = this.sceneTarget(width, height, enabled);
    }
    if (!enabled) {
      this.disposeAO();
      this.blendRT?.dispose();
      this.ao = null;
      this.blendRT = null;
      return;
    }
    if (this.ao) return;
    const { width: w, height: h, depthTexture } = this.sceneRT;
    this.blendRT = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: false });

    // AO at half resolution, in world units: a meter or so of reach darkens the ground under cars,
    // the foot of every wall, and the corners of eaves and window reveals.
    this.ao = new GTAOPass(this.scene, this.camera, Math.ceil(w / 2), Math.ceil(h / 2));
    this.ao.setGBuffer(depthTexture);
    this.ao.updateGtaoMaterial({
      radius: 1.5,
      distanceExponent: 1.5,
      thickness: 1.8,
      scale: 1.6,
      samples: 12,
      distanceFallOff: 1.0,
    });
    this.ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 3, rings: 2, samples: 8 });
    this.ao.blendIntensity = 1.0;
    // depth-reconstructed normals are noise a few hundred meters out (depth precision runs out),
    // and occlusion there is invisible anyway: fade it away with distance
    const m = this.ao.gtaoMaterial;
    m.fragmentShader = m.fragmentShader.replace(
      "ao = pow(ao, scale);",
      "ao = pow(ao, scale);\n\t\t\tao = mix(ao, 1.0, smoothstep(60.0, 160.0, -viewPos.z));",
    );
    m.needsUpdate = true;
  }

  setSize(w, h) {
    if (this.disposed || !Number.isFinite(w) || !Number.isFinite(h)) return;
    w = Math.max(1, Math.floor(w));
    h = Math.max(1, Math.floor(h));
    if (w === this.sceneRT.width && h === this.sceneRT.height) return;
    this.sceneRT.setSize(w, h);
    this.blendRT?.setSize(w, h);
    this.displayRT.setSize(w, h);
    this.display.uniforms.aspect.value = w / Math.max(1, h);
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
    const u = this.display.uniforms;
    u.contrast.value = contrast;
    u.saturation.value = saturation;
    u.tint.value.copy(tint);
    u.vignette.value = vignette;
  }

  render() {
    if (this.disposed) return;
    const r = this.renderer;
    const target = r.getRenderTarget(),
      face = r.getActiveCubeFace(),
      mip = r.getActiveMipmapLevel(),
      autoClear = r.autoClear,
      alpha = r.getClearAlpha();
    r.getClearColor(this.clearColor);
    try {
      this.renderPasses(r);
    } catch (error) {
      r.setRenderTarget(target, face, mip);
      r.setClearColor(this.clearColor, alpha);
      r.autoClear = autoClear;
      throw error;
    }
  }

  renderPasses(r) {
    r.setRenderTarget(this.sceneRT);
    r.clear();
    r.render(this.scene, this.camera);
    let source = this.sceneRT;
    if (this.ao) {
      this.ao.render(r, this.blendRT, this.sceneRT);
      source = this.blendRT;
    }
    this.bloom.render(r, null, source); // adds the glow in place
    const u = this.display.uniforms;
    u.tDiffuse.value = source.texture;
    u.toneMappingExposure.value = r.toneMappingExposure;
    u.seed.value = (u.seed.value + 1) % 64;
    r.setRenderTarget(this.displayRT);
    this.displayQuad.render(r);
    this.smaa.render(r, null, this.displayRT);
  }

  disposeAO() {
    if (!this.ao) return;
    // The vendored GTAOPass omits these shader materials from its own dispose().
    this.ao.gtaoMaterial.dispose();
    this.ao.blendMaterial.dispose();
    this.ao.dispose();
    this.ao = null;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.sceneRT.dispose();
    this.blendRT?.dispose();
    this.displayRT.dispose();
    this.display.dispose();
    this.displayQuad.dispose();
    this.smaa.dispose();
    this.disposeAO();
    this.bloom.dispose();
  }
}
