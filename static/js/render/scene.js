// Renderer, sky, sun, ground, and the cameras. Sim coordinates (x east, y north, z up) map to
// Three.js as (x, z, -y).
//
// Ground-level layers (grass, sidewalks, asphalt, markings) are coplanar, so instead of lifting
// them apart by millimeters (which z-fights at a distance) they are drawn first, in a fixed
// order, without depth testing. Nothing sits below the ground, so everything drawn afterwards
// correctly covers them.

import * as THREE from "three";
import { grassTexture, setMaxAnisotropy, withMacroVariation } from "./textures.js";

export const toThree = (x, y, z = 0) => new THREE.Vector3(x, z, -y);

export const LAYER = { sky: -100, grass: -50, sidewalk: -40, curb: -38, asphalt: -30, patch: -28, marking: -20 };

// A material for a ground layer: painted in renderOrder, no depth test or write.
export function groundLayer(mesh, order) {
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const m of mats) { m.depthTest = false; m.depthWrite = false; }
  mesh.renderOrder = order;
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  return mesh;
}

// Late-afternoon sun from the south-west (sim), so shadows fall toward the north-east.
const SUN_DIR = new THREE.Vector3(-0.52, 0.6, 0.6).normalize();
const SKY = { zenith: 0x3f79c4, horizon: 0xc9dbea, ground: 0x8d9a86, sun: 0xfff2d6 };
const SHADOW_HALF = 70;          // meters of shadow coverage around the car
const SHADOW_MAP = 4096;

function skyMaterial() {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    uniforms: {
      zenith: { value: new THREE.Color(SKY.zenith) },
      horizon: { value: new THREE.Color(SKY.horizon) },
      groundColor: { value: new THREE.Color(SKY.ground) },
      sunColor: { value: new THREE.Color(SKY.sun) },
      sunDir: { value: SUN_DIR.clone() },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: `
      uniform vec3 zenith, horizon, groundColor, sunColor, sunDir;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col = mix(horizon, zenith, pow(clamp(h, 0.0, 1.0), 0.55));
        col = mix(col, groundColor, smoothstep(0.0, -0.08, h));
        float s = max(dot(d, sunDir), 0.0);
        col += sunColor * (pow(s, 1200.0) * 30.0 + pow(s, 60.0) * 0.35 + pow(s, 6.0) * 0.12);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

export class SceneView {
  constructor(canvas, extent) {
    this.canvas = canvas;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer = renderer;
    setMaxAnisotropy(renderer.capabilities.getMaxAnisotropy());

    this.scene = new THREE.Scene();
    const horizon = new THREE.Color(SKY.horizon);
    this.scene.background = horizon;
    this.scene.fog = new THREE.FogExp2(horizon, 0.0016);
    this.camera = new THREE.PerspectiveCamera(58, 1, 0.3, 6000);
    this.mode = "chase";
    this.camPos = new THREE.Vector3();
    this.camLook = new THREE.Vector3();

    this.sky = new THREE.Mesh(new THREE.SphereGeometry(4500, 32, 16), skyMaterial());
    this.sky.renderOrder = LAYER.sky;
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);
    this.scene.environment = this.buildEnvironment();
    this.scene.environmentIntensity = 0.55;

    this.scene.add(new THREE.HemisphereLight(0xcfe0f2, 0x6c7358, 0.55));
    const sun = new THREE.DirectionalLight(0xfff0dc, 3.0);
    sun.castShadow = true;
    sun.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
    Object.assign(sun.shadow.camera, { left: -SHADOW_HALF, right: SHADOW_HALF, top: SHADOW_HALF, bottom: -SHADOW_HALF, near: 1, far: 800 });
    sun.shadow.camera.updateProjectionMatrix();
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.04;
    sun.shadow.radius = 2.5;
    this.sun = sun;
    this.scene.add(sun, sun.target);

    const [x0, y0, x1, y1] = extent;
    const size = Math.max(x1 - x0, y1 - y0) + 6000;
    const grassMat = withMacroVariation(new THREE.MeshStandardMaterial({ map: grassTexture(), roughness: 0.95, metalness: 0 }), 0.06, 0.3);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(size, size), grassMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set((x0 + x1) / 2, 0, -(y0 + y1) / 2);
    grassMat.map.repeat.set(size / 14, size / 14);
    groundLayer(ground, LAYER.grass);
    this.scene.add(ground);

    this._basis = this.lightBasis();
    window.addEventListener("resize", () => this.resize());
    this.resize();
  }

  buildEnvironment() {
    const envScene = new THREE.Scene();
    const mat = skyMaterial();
    mat.depthTest = true;
    envScene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), mat));
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const tex = pmrem.fromScene(envScene, 0.02, 0.1, 1000).texture;
    pmrem.dispose();
    return tex;
  }

  lightBasis() {
    const fwd = SUN_DIR.clone().negate();
    const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(right, fwd).normalize();
    return { fwd, right, up };
  }

  // Keep the shadow map centered on the car, snapped to whole shadow texels so edges do not shimmer
  // as it moves.
  followShadow(x, y) {
    const { fwd, right, up } = this._basis;
    const texel = (2 * SHADOW_HALF) / SHADOW_MAP;
    const c = toThree(x, y, 0);
    const a = Math.round(c.dot(right) / texel) * texel;
    const b = Math.round(c.dot(up) / texel) * texel;
    const f = c.dot(fwd);
    const snapped = right.clone().multiplyScalar(a).addScaledVector(up, b).addScaledVector(fwd, f);
    this.sun.target.position.copy(snapped);
    this.sun.position.copy(snapped).addScaledVector(SUN_DIR, 400);
    this.sun.target.updateMatrixWorld();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  toggleCamera() {
    const modes = ["chase", "top", "far"];
    this.mode = modes[(modes.indexOf(this.mode) + 1) % modes.length];
    return this.mode;
  }

  updateCamera(ego, dt) {
    const fx = Math.cos(ego.psi), fy = Math.sin(ego.psi);
    let target, look, up = new THREE.Vector3(0, 1, 0), lerp = 1 - Math.pow(0.002, dt);
    if (this.mode === "top") {
      target = toThree(ego.x, ego.y, 130);
      look = toThree(ego.x, ego.y, 0);
      up = new THREE.Vector3(0, 0, -1);
      lerp = 1 - Math.pow(0.02, dt);
    } else if (this.mode === "far") {
      target = toThree(ego.x - fx * 28, ego.y - fy * 28, 17);
      look = toThree(ego.x + fx * 12, ego.y + fy * 12, 0.5);
    } else {
      target = toThree(ego.x - fx * 8, ego.y - fy * 8, 3.1);
      look = toThree(ego.x + fx * 8, ego.y + fy * 8, 1.1);
    }
    if (this.camPos.lengthSq() === 0) { this.camPos.copy(target); this.camLook.copy(look); }
    this.camPos.lerp(target, lerp);
    this.camLook.lerp(look, lerp);
    this.camera.position.copy(this.camPos);
    this.camera.up.copy(up);
    this.camera.lookAt(this.camLook);
    this.sky.position.copy(this.camera.position);
    this.followShadow(ego.x, ego.y);
  }

  render() { this.renderer.render(this.scene, this.camera); }
}
