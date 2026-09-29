// How the weather looks on the ground: wet or snow-covered surfaces, and rain or snow falling
// around the camera. Surfaces opt in by tagging their material with
// `userData.surface`; snow settles on whatever faces up (a shader tweak), so roofs, lawns, and the
// tops of trees and parked cars turn white while walls stay as they are.

import * as THREE from "three";

// what each weather does to surfaces and the air around the camera (the sky and light are in
// atmosphere.js)
const PRESETS = {
  dry: {},
  rain: { wet: 1, particles: "rain" },
  fog: { wet: 0.4 },
  snow: { snow: 1, particles: "snow" },
};
// how much snow each kind of surface keeps (plowed and driven roads keep the least)
const SNOW_COVER = { grass: 0.95, roof: 0.92, concrete: 0.8, curb: 0.7, leaf: 0.55, asphalt: 0.42, paint: 0.35, car: 0.8 };
const WET = { asphalt: { color: 0.62, roughness: 0.28, env: 1.6 }, concrete: { color: 0.78, roughness: 0.55, env: 1.0 }, curb: { color: 0.8, roughness: 0.6, env: 1.0 }, paint: { color: 0.85, roughness: 0.35, env: 1.3 } };

// Make a material able to show snow on its upward faces; the amount is a uniform set later.
export function snowable(material, surface) {
  material.userData.surface = surface;
  const uniform = { value: 0 };
  material.userData.snow = uniform;
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    if (prev) prev(shader, renderer);
    shader.uniforms.uSnow = uniform;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying float vUp;")
      .replace("#include <beginnormal_vertex>", `#include <beginnormal_vertex>
        vec3 upN = objectNormal;
        #ifdef USE_INSTANCING
          upN = mat3(instanceMatrix) * upN;
        #endif
        vUp = normalize(mat3(modelMatrix) * upN).y;`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vUp;\nuniform float uSnow;")
      .replace("#include <map_fragment>", `#include <map_fragment>
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.95, 0.98), uSnow * smoothstep(0.35, 0.85, vUp));`);
  };
  const prevKey = Object.prototype.hasOwnProperty.call(material, "customProgramCacheKey") ? material.customProgramCacheKey : null;
  material.customProgramCacheKey = () => `snow-${surface}-${prevKey ? prevKey() : ""}`;
  material.needsUpdate = true;
  return material;
}

export class WeatherView {
  constructor(view) {
    this.view = view;
    this.name = "dry";
    this.rain = null;
    this.snow = null;
  }

  apply(name) {
    const P = PRESETS[name] || PRESETS.dry;
    this.name = PRESETS[name] ? name : "dry";
    const v = this.view;
    v.scene.traverse((o) => {
      const mats = !o.material ? [] : Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        const surface = m.userData.surface;
        if (!surface) continue;
        if (!m.userData.base) m.userData.base = { color: m.color.clone(), roughness: m.roughness, env: m.envMapIntensity ?? 1 };
        const base = m.userData.base, wet = (P.wet || 0) * (WET[surface] ? 1 : 0), w = WET[surface];
        m.color.copy(base.color).multiplyScalar(wet ? 1 - (1 - w.color) * wet : 1);
        m.roughness = wet ? base.roughness + (w.roughness - base.roughness) * wet : base.roughness;
        m.envMapIntensity = wet ? base.env + (w.env - base.env) * wet : base.env;
        if (m.userData.snow) m.userData.snow.value = (P.snow || 0) * (SNOW_COVER[surface] || 0);
      }
    });
    this.setParticles(P.particles || null);
  }

  setParticles(kind) {
    for (const k of ["rain", "snow"]) {
      if (this[k]) { this.view.scene.remove(this[k].mesh); this[k] = null; }
    }
    if (kind === "rain") this.rain = makeRain();
    if (kind === "snow") this.snow = makeSnow();
    for (const k of ["rain", "snow"]) if (this[k]) this.view.scene.add(this[k].mesh);
  }

  update(dt) {
    const cam = this.view.camera.position;
    for (const fx of [this.rain, this.snow]) if (fx) fx.update(dt, cam);
  }
}

const BOX = { w: 70, h: 32 };

// Rain: short streaks falling fast with a little wind, recycled in a box around the camera.
function makeRain(count = 5000) {
  const seeds = new Float32Array(count * 3);
  for (let i = 0; i < count * 3; i++) seeds[i] = Math.random();
  const pos = new Float32Array(count * 6);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const mesh = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xb8c2cc, transparent: true, opacity: 0.45, depthWrite: false }));
  mesh.frustumCulled = false;
  let t = 0;
  return {
    mesh,
    update(dt, cam) {
      t += dt;
      for (let i = 0; i < count; i++) {
        const x = wrap(seeds[i * 3] * BOX.w + t * 1.2 - cam.x, BOX.w) + cam.x - BOX.w / 2;
        const z = wrap(seeds[i * 3 + 1] * BOX.w - cam.z, BOX.w) + cam.z - BOX.w / 2;
        const y = wrap(seeds[i * 3 + 2] * BOX.h - t * 9.5, BOX.h);
        pos.set([x, y, z, x + 0.06, y + 0.55, z], i * 6);
      }
      geo.attributes.position.needsUpdate = true;
    },
  };
}

// Snow: flakes drifting down slowly, swaying.
function makeSnow(count = 6000) {
  const seeds = new Float32Array(count * 4);
  for (let i = 0; i < count * 4; i++) seeds[i] = Math.random();
  const pos = new Float32Array(count * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const mesh = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.09, transparent: true, opacity: 0.9, depthWrite: false }));
  mesh.frustumCulled = false;
  let t = 0;
  return {
    mesh,
    update(dt, cam) {
      t += dt;
      for (let i = 0; i < count; i++) {
        const sway = Math.sin(t * 0.8 + seeds[i * 4 + 3] * 6.28) * 0.6;
        const x = wrap(seeds[i * 4] * BOX.w + sway + t * 0.4 - cam.x, BOX.w) + cam.x - BOX.w / 2;
        const z = wrap(seeds[i * 4 + 1] * BOX.w - cam.z, BOX.w) + cam.z - BOX.w / 2;
        const y = wrap(seeds[i * 4 + 2] * BOX.h - t * (0.9 + seeds[i * 4 + 3] * 0.5), BOX.h);
        pos.set([x, y, z], i * 3);
      }
      geo.attributes.position.needsUpdate = true;
    },
  };
}

const wrap = (v, m) => ((v % m) + m) % m;
