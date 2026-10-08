// Renderer, sky, sun (or moon), ground, post-processing, and the cameras. Sim coordinates (x east,
// y north, z up) map to Three.js as (x, z, -y).
//
// Ground-level layers (grass, sidewalks, asphalt, markings) are coplanar, so instead of lifting
// them apart by millimeters (which z-fights at a distance) they are drawn first, in a fixed
// order over a single depth-writing ground plane. Surface color layers do not rewrite depth, so
// coplanar triangle interpolation cannot make the AO's reconstructed ground normals shimmer.

import * as THREE from "three";
import { grassTexture, setMaxAnisotropy, withMacroVariation } from "./textures.js";
import { snowable } from "./weather.js";
import { PostFX, QUALITY } from "./post.js";
import { atmosphereFor, lighting, updateNightMaterials } from "./atmosphere.js";
import { GroundReflection } from "./reflection.js";
import { buildBackdrop, tintBackdrop } from "./backdrop.js";
import { OrbitCamera } from "./orbit-camera.js";
import { CinematicCamera } from "./cinematic-camera.js";

export const toThree = (x, y, z = 0) => new THREE.Vector3(x, z, -y);

export const LAYER = { sky: -100, grass: -50, water: -46, sidewalk: -40, curb: -38, asphalt: -30, patch: -28, islandCurb: -27, island: -26, marking: -20, pool: -10 };

// Only the base plane writes depth. Color layers use a small raster depth bias to pass the test
// against that plane, retaining depth tests against other geometry without stacking depth errors.
export function groundLayer(mesh, order) {
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const m of mats) {
    m.depthTest = true;
    m.depthFunc = THREE.LessEqualDepth;
    m.depthWrite = order === LAYER.grass;
    m.polygonOffset = order !== LAYER.grass;
    m.polygonOffsetFactor = -1;
    m.polygonOffsetUnits = -1;
  }
  mesh.renderOrder = order;
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  return mesh;
}

const SHADOW_HALF = 70;          // meters of shadow coverage around the car

function skyMaterial() {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    uniforms: {
      zenith: { value: new THREE.Color() },
      horizon: { value: new THREE.Color() },
      groundColor: { value: new THREE.Color() },
      glowColor: { value: new THREE.Color() },
      sunColor: { value: new THREE.Color() },
      sunGlow: { value: 1 },
      stars: { value: 0 },
      sunDir: { value: new THREE.Vector3(0, 1, 0) },
      cloudCover: { value: 0 },
      cloudLit: { value: new THREE.Color() },
      cloudShade: { value: new THREE.Color() },
      cloudTime: { value: 0 },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: `
      uniform vec3 zenith, horizon, groundColor, glowColor, sunColor, sunDir, cloudLit, cloudShade;
      uniform float sunGlow, stars, cloudCover, cloudTime;
      varying vec3 vDir;
      float hash3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      float hash2(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
      float vnoise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), f.x), mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), f.x), f.y);
      }
      float fbm(vec2 p) {
        float sum = 0.0, amp = 0.5;
        mat2 turn = mat2(1.6, 1.2, -1.2, 1.6);
        for (int i = 0; i < 5; i++) { sum += amp * vnoise(p); p = turn * p; amp *= 0.5; }
        return sum;
      }
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col = mix(horizon, zenith, pow(clamp(h, 0.0, 1.0), 0.5));
        // the warm band along the horizon on the sun's side at dawn and dusk
        vec2 across = normalize(d.xz + 1e-5), sunFlat = normalize(sunDir.xz + 1e-5);
        float toward = max(dot(across, sunFlat), 0.0);
        col += glowColor * (0.25 + 0.75 * pow(toward, 4.0)) * exp(-max(h, 0.0) * 7.0);
        col = mix(col, groundColor, smoothstep(0.0, -0.08, h));
        float s = max(dot(d, sunDir), 0.0);
        col += sunColor * sunGlow * (pow(s, 1400.0) * 40.0 + pow(s, 60.0) * 0.35 + pow(s, 6.0) * 0.12);
        if (stars > 0.0 && h > 0.0) {
          vec3 cell = floor(d * 900.0);
          float r = hash3(cell);
          float tw = 0.3 + 0.7 * hash3(cell + 7.0);
          col += vec3(0.85, 0.9, 1.0) * step(0.9986, r) * tw * stars * smoothstep(0.0, 0.3, h) * 0.55;
          // the moon, high in the south-east
          float m = dot(d, normalize(vec3(0.35, 0.72, 0.6)));
          col += vec3(0.75, 0.8, 0.9) * stars * (smoothstep(0.99985, 0.99992, m) * 1.6 + pow(max(m, 0.0), 400.0) * 0.12);
        }
        // A drifting cloud deck projected onto a flat ceiling, so cells shrink toward the horizon.
        // A second sample nudged toward the sun estimates self-shadowing: the sunward edges of each
        // cloud catch the light and the far sides fall into shade, with a silver rim near the sun.
        if (cloudCover > 0.0 && h > 0.0) {
          vec2 uv = d.xz / (h + 0.12) * 1.35 + vec2(cloudTime * 0.010, cloudTime * 0.004);
          float n = fbm(uv);
          float edge = mix(0.60, 0.28, cloudCover);
          // Storm decks close into a continuous sheet with softer, lower-contrast mottling.
          float sheet = smoothstep(0.7, 1.0, cloudCover);
          float cover = max(smoothstep(edge, edge + 0.16, n), sheet * 0.92);
          float toSun = fbm(uv + sunFlat * 0.18);
          float lit = clamp(0.62 + (n - toSun) * 5.0 * (1.0 - 0.55 * sheet) - sheet * (0.55 - n), 0.0, 1.0);
          vec3 cloud = mix(cloudShade, cloudLit, lit);
          cloud += cloudLit * (pow(s, 10.0) * 0.9 + pow(s, 3.0) * 0.15) * (1.0 - cover * 0.6);
          col = mix(col, cloud, cover * smoothstep(0.0, 0.16, h) * 0.96);
        }
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

export class SceneView {
  constructor(canvas, extent, { quality = "high" } = {}) {
    this.canvas = canvas;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer = renderer;
    setMaxAnisotropy(renderer.capabilities.getMaxAnisotropy());

    this.scene = new THREE.Scene();
    this.sceneryLODs = [];
    this.scene.background = new THREE.Color();
    this.scene.fog = new THREE.FogExp2(0xffffff, 0.0016);
    this.camera = new THREE.PerspectiveCamera(58, 1, 0.3, 6000);
    this.mode = "chase";
    this.orbit = new OrbitCamera();
    this.cinematic = new CinematicCamera();
    // Photo-mode adjustments on top of the atmosphere's own exposure and grade (0 = as lit).
    this.look = { exposure: 0, contrast: 0, saturation: 0, vignette: 0 };
    this.camPos = new THREE.Vector3();
    this.camLook = new THREE.Vector3();

    this.sky = new THREE.Mesh(new THREE.SphereGeometry(4500, 32, 16), skyMaterial());
    this.sky.renderOrder = LAYER.sky;
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);

    this.hemi = new THREE.HemisphereLight(0xcfe0f2, 0x6c7358, 0.55);
    this.scene.add(this.hemi);
    const sun = new THREE.DirectionalLight(0xfff0dc, 3.0);
    sun.castShadow = true;
    Object.assign(sun.shadow.camera, { left: -SHADOW_HALF, right: SHADOW_HALF, top: SHADOW_HALF, bottom: -SHADOW_HALF, near: 1, far: 800 });
    sun.shadow.camera.updateProjectionMatrix();
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.04;
    sun.shadow.radius = 2.5;
    this.sun = sun;
    this.keyDir = new THREE.Vector3(-0.52, 0.6, 0.6).normalize();
    this.scene.add(sun, sun.target);

    const [x0, y0, x1, y1] = extent;
    const size = Math.max(x1 - x0, y1 - y0) + 6000;
    const grassMat = snowable(withMacroVariation(new THREE.MeshStandardMaterial({ map: grassTexture(), roughness: 0.95, metalness: 0 }), 0.06, 0.3), "grass");
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(size, size), grassMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set((x0 + x1) / 2, 0, -(y0 + y1) / 2);
    grassMat.map.repeat.set(size / 14, size / 14);
    groundLayer(ground, LAYER.grass);
    this.scene.add(ground);
    this.backdrop = buildBackdrop(new THREE.Vector3((x0 + x1) / 2, 0, -(y0 + y1) / 2));
    this.scene.add(this.backdrop);

    this.post = null;
    this.reflection = new GroundReflection(renderer, this.scene, this.camera);
    this.setQuality(quality);
    this.setAtmosphere(atmosphereFor(15.5, "dry"));
    window.addEventListener("resize", () => this.resize());
  }

  setQuality(name) {
    this.quality = QUALITY[name] ? name : "high";
    const q = QUALITY[this.quality];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, q.pixelRatio));
    if (this.sun.shadow.mapSize.x !== q.shadowMap) {
      this.sun.shadow.mapSize.set(q.shadowMap, q.shadowMap);
      if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    }
    if (q.post && !this.post) this.post = new PostFX(this.renderer, this.scene, this.camera, { ao: q.ao });
    if (q.post && this.post) this.post.setAO(q.ao);
    if (!q.post && this.post) { this.post.dispose(); this.post = null; }
    this.reflection.enabled = q.post;
    this.reflection.resolutionScale = q.reflectionScale;
    this.resize();
    if (this.atmosphere) this.setAtmosphere(this.atmosphere);
    return this.quality;
  }

  // Sky, fog, the key light (sun or moon), fill light, reflections, and exposure for a time of day
  // and weather (see atmosphere.js).
  setAtmosphere(a) {
    this.atmosphere = a;
    const u = this.sky.material.uniforms;
    u.zenith.value.copy(a.sky.zenith); u.horizon.value.copy(a.sky.horizon); u.groundColor.value.copy(a.sky.ground);
    u.glowColor.value.copy(a.sky.glow); u.sunColor.value.copy(a.sky.sun); u.sunDir.value.copy(a.sun.dir);
    u.sunGlow.value = a.sunGlow;
    u.stars.value = a.stars;
    u.cloudCover.value = a.clouds.cover;
    u.cloudLit.value.copy(a.clouds.lit);
    u.cloudShade.value.copy(a.clouds.shade);
    this.scene.background.copy(a.fogColor);
    this.scene.fog.color.copy(a.fogColor);
    this.scene.fog.density = a.fogDensity;
    this.keyDir.copy(a.key.dir);
    this.sun.color.copy(a.key.color);
    this.sun.intensity = a.key.intensity;
    this.hemi.color.copy(a.hemi.sky);
    this.hemi.groundColor.copy(a.hemi.ground);
    this.hemi.intensity = a.hemi.intensity;
    this.scene.environmentIntensity = a.env;
    if (this.post) this.post.setBloom(a.bloom.strength, a.bloom.threshold);
    this.applyLook();
    tintBackdrop(this.backdrop, a);
    lighting.night.value = a.night;
    lighting.wet.value = a.wet;
    lighting.sunDir.value.copy(a.sun.dir);
    updateNightMaterials();
    if (this.scene.environment) this.scene.environment.dispose();
    this.scene.environment = this.buildEnvironment();
    this._basis = this.lightBasis();
  }

  // Exposure in stops and grade offsets chosen in photo mode, layered on the current atmosphere.
  setLook(changes = {}) {
    for (const [key, value] of Object.entries(changes)) if (key in this.look && Number.isFinite(value)) this.look[key] = value;
    this.applyLook();
    return { ...this.look };
  }

  applyLook() {
    const a = this.atmosphere;
    if (!a) return;
    this.renderer.toneMappingExposure = a.exposure * Math.pow(2, this.look.exposure);
    if (this.post) {
      const g = a.grade;
      this.post.setGrade({
        contrast: Math.max(0.5, g.contrast + this.look.contrast),
        saturation: Math.max(0, g.saturation + this.look.saturation),
        tint: g.tint,
        vignette: THREE.MathUtils.clamp(g.vignette + this.look.vignette, 0, 1),
      });
    }
  }

  // Reflections come from the same sky, rendered into a prefiltered environment map.
  buildEnvironment() {
    const envScene = new THREE.Scene();
    const mat = skyMaterial();
    for (const [k, v] of Object.entries(this.sky.material.uniforms)) mat.uniforms[k].value = v.value.clone ? v.value.clone() : v.value;
    mat.uniforms.stars.value = 0;
    mat.depthTest = true;
    envScene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), mat));
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const tex = pmrem.fromScene(envScene, 0.02, 0.1, 1000).texture;
    pmrem.dispose();
    mat.dispose();
    return tex;
  }

  lightBasis() {
    const fwd = this.keyDir.clone().negate();
    const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(right, fwd).normalize();
    return { fwd, right, up };
  }

  // Keep the shadow map centered on the car, snapped to whole shadow texels so edges do not shimmer
  // as it moves.
  followShadow(x, y) {
    const { fwd, right, up } = this._basis;
    const texel = (2 * SHADOW_HALF) / this.sun.shadow.mapSize.x;
    const c = toThree(x, y, 0);
    const a = Math.round(c.dot(right) / texel) * texel;
    const b = Math.round(c.dot(up) / texel) * texel;
    const f = c.dot(fwd);
    const snapped = right.clone().multiplyScalar(a).addScaledVector(up, b).addScaledVector(fwd, f);
    this.sun.target.position.copy(snapped);
    this.sun.position.copy(snapped).addScaledVector(this.keyDir, 400);
    this.sun.target.updateMatrixWorld();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    if (this.post) this.post.setSize(size.x, size.y);
    if (this.reflection) this.reflection.setSize(size.x, size.y);
  }

  toggleCamera() {
    const modes = ["chase", "orbit", "hood", "top", "far", "cinematic"];
    return this.setCamera(modes[(modes.indexOf(this.mode) + 1) % modes.length]);
  }

  setCamera(mode) {
    this.mode = mode;
    this.camPos.set(0, 0, 0);   // snap rather than swoop between very different views
    if (mode === "cinematic") this.cinematic.reset();
    return this.mode;
  }

  updateCamera(ego, dt) {
    const fx = Math.cos(ego.psi), fy = Math.sin(ego.psi);
    let target, look, up = new THREE.Vector3(0, 1, 0), lerp = 1 - Math.pow(0.002, dt);
    this.camera.fov = this.mode === "hood" ? 64 : 58;
    if (this.mode === "cinematic") {
      const shot = this.cinematic.pose(ego, dt, this.vehicleHeight);
      target = toThree(...shot.position);
      look = toThree(...shot.look);
      this.camera.fov = shot.fov;
      if (shot.cut) this.camPos.set(0, 0, 0);
      lerp = 1 - Math.pow(shot.lag, dt);
    } else if (this.mode === "orbit") {
      const pose = this.orbit.pose(ego, this.vehicleHeight);
      target = toThree(pose.x, pose.y, pose.z);
      look = toThree(...pose.look);
      lerp = 1; // Direct manipulation: no spring lag while dragging, still follows the car.
    } else if (this.mode === "top") {
      target = toThree(ego.x, ego.y, 130);
      look = toThree(ego.x, ego.y, 0);
      up = new THREE.Vector3(0, 0, -1);
      lerp = 1 - Math.pow(0.02, dt);
    } else if (this.mode === "far") {
      target = toThree(ego.x - fx * 28, ego.y - fy * 28, 17);
      look = toThree(ego.x + fx * 12, ego.y + fy * 12, 0.5);
    } else if (this.mode === "hood") {
      // at the base of the windshield, looking down the road over the hood
      const hood = this.vehicleCamera || { x: 2.05, y: 1.32 };
      target = toThree(ego.x + fx * hood.x, ego.y + fy * hood.x, hood.y);
      look = toThree(ego.x + fx * 30, ego.y + fy * 30, hood.y - 0.42);
      if (this.cameraMotion !== false) {
        const smooth = 1 - Math.exp(-8 * dt);
        this.cameraPitch = (this.cameraPitch || 0) + (THREE.MathUtils.clamp((ego.ax || 0) * 0.006, -0.035, 0.025) - (this.cameraPitch || 0)) * smooth;
        this.cameraRoll = (this.cameraRoll || 0) + (THREE.MathUtils.clamp((ego.latAccel || 0) * 0.005, -0.03, 0.03) - (this.cameraRoll || 0)) * smooth;
        look.y += this.cameraPitch * 30;
        up.set(Math.sin(ego.psi) * this.cameraRoll, 1, Math.cos(ego.psi) * this.cameraRoll).normalize();
      }
      lerp = 1;
    } else {
      const extra = Math.max(0, (ego.spec?.length || 4.5) - 4.5);
      target = toThree(ego.x - fx * (8 + extra), ego.y - fy * (8 + extra), 3.1 + Math.max(0, (this.vehicleHeight || 1.45) - 1.45));
      look = toThree(ego.x + fx * 8, ego.y + fy * 8, 1.1);
    }
    if (this.camPos.lengthSq() === 0) { this.camPos.copy(target); this.camLook.copy(look); }
    this.camPos.lerp(target, lerp);
    this.camLook.lerp(look, lerp);
    this.camera.position.copy(this.camPos);
    this.camera.up.copy(up);
    this.camera.lookAt(this.camLook);
    this.camera.updateProjectionMatrix();
    this.sky.position.copy(this.camera.position);
    this.followShadow(ego.x, ego.y);
  }

  render(dt = 0) {
    lighting.time.value += dt;
    this.sky.material.uniforms.cloudTime.value = lighting.time.value;
    this.camera.updateMatrixWorld();
    // Select detail once from the viewing camera. A mirrored camera must not change the meshes
    // between the reflection, shadow and main passes within the same frame.
    for (const lod of this.sceneryLODs) lod.update(this.camera);
    const shadows = this.renderer.shadowMap.autoUpdate;
    try {
      // Wet frames update shadows in the first scene pass (the reflection), then reuse those same
      // fresh maps in the main pass. Dry frames update them in the main pass as usual.
      if (this.reflection.render()) this.renderer.shadowMap.autoUpdate = false;
      if (this.post) this.post.render();
      else {
        this.renderer.setRenderTarget(null);
        this.renderer.render(this.scene, this.camera);
      }
    } finally {
      this.renderer.shadowMap.autoUpdate = shadows;
    }
  }

  addScenery(object) {
    object.traverse(child => {
      if (child.isLOD) { child.autoUpdate = false; this.sceneryLODs.push(child); }
    });
    this.scene.add(object);
  }
}
