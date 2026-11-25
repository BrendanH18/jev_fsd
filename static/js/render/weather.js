// How the weather looks on the ground: wet or snow-covered surfaces, and rain or snow falling
// around the camera. Surfaces opt in by tagging their material with
// `userData.surface`; snow settles on whatever faces up (a shader tweak), so roofs, lawns, and the
// tops of trees and parked cars turn white while walls stay as they are.

import * as THREE from "three";
import { rng } from "../common.js";
import { flakeTexture } from "./textures.js";

// what each weather does to surfaces and the air around the camera (the sky and light are in
// atmosphere.js)
const PRESETS = {
  dry: {},
  rain: { wet: 1, particles: "rain" },
  fog: { wet: 0.4 },
  snow: { snow: 1, particles: "snow" },
};
// how much snow each kind of surface keeps (plowed and driven roads keep the least)
const SNOW_COVER = {
  grass: 0.95,
  roof: 0.92,
  concrete: 0.8,
  curb: 0.7,
  leaf: 0.55,
  asphalt: 0.42,
  paint: 0.35,
  car: 0.8,
};
const WET = {
  asphalt: { color: 0.62, roughness: 0.28, env: 1.6 },
  concrete: { color: 0.78, roughness: 0.55, env: 1.0 },
  curb: { color: 0.8, roughness: 0.6, env: 1.0 },
  paint: { color: 0.85, roughness: 0.35, env: 1.3 },
};

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
      .replace(
        "#include <beginnormal_vertex>",
        `#include <beginnormal_vertex>
        vec3 upN = objectNormal;
        #ifdef USE_INSTANCING
          upN = mat3(instanceMatrix) * upN;
        #endif
        vUp = normalize(mat3(modelMatrix) * upN).y;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vUp;\nuniform float uSnow;")
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.95, 0.98), uSnow * smoothstep(0.35, 0.85, vUp));`,
      );
  };
  const prevKey = Object.hasOwn(material, "customProgramCacheKey") ? material.customProgramCacheKey : null;
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
    this.name = Object.hasOwn(PRESETS, name) ? name : "dry";
    const P = PRESETS[this.name];
    const v = this.view;
    const updated = new Set();
    v.scene.traverse((o) => {
      const mats = !o.material ? [] : Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        const surface = m.userData.surface;
        if (!surface || updated.has(m)) continue;
        updated.add(m);
        if (!m.userData.base)
          m.userData.base = { color: m.color.clone(), roughness: m.roughness, env: m.envMapIntensity ?? 1 };
        const base = m.userData.base,
          wet = (P.wet || 0) * (WET[surface] ? 1 : 0),
          w = WET[surface];
        m.color.copy(base.color).multiplyScalar(wet ? 1 - (1 - w.color) * wet : 1);
        m.roughness = wet ? base.roughness + (w.roughness - base.roughness) * wet : base.roughness;
        m.envMapIntensity = wet ? base.env + (w.env - base.env) * wet : base.env;
        if (m.userData.snow) m.userData.snow.value = (P.snow || 0) * (SNOW_COVER[surface] || 0);
      }
    });
    this.setParticles(P.particles || null);
  }

  setParticles(kind) {
    if ((kind === "rain" && this.rain) || (kind === "snow" && this.snow)) return;
    for (const k of ["rain", "snow"]) {
      if (this[k]) {
        const { mesh } = this[k];
        mesh.removeFromParent();
        mesh.geometry.dispose();
        mesh.material.dispose();
        this[k] = null;
      }
    }
    if (kind === "rain") this.rain = makeRain();
    if (kind === "snow") this.snow = makeSnow();
    const effect = this.rain ?? this.snow;
    if (effect) {
      effect.update(0, this.view.camera.position);
      this.view.scene.add(effect.mesh);
    }
  }

  update(dt) {
    (this.rain ?? this.snow)?.update(dt, this.view.camera.position);
  }
}

const BOX = { w: 70, h: 32 };

// Rain: short streaks falling fast with a little wind, recycled in a box around the camera.
function makeRain(count = 5000) {
  const seeds = new Float32Array(count * 3);
  const random = rng(32051);
  for (let i = 0; i < seeds.length; i++) seeds[i] = random();
  const pos = new Float32Array(count * 6);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  const mesh = new THREE.LineSegments(
    geo,
    new THREE.LineBasicMaterial({ color: 0xb8c2cc, transparent: true, opacity: 0.45, depthWrite: false }),
  );
  mesh.frustumCulled = false;
  let t = 0;
  return {
    mesh,
    update(dt, cam) {
      t += dt;
      const bottom = Math.max(0, cam.y - BOX.h / 2);
      for (let i = 0; i < count; i++) {
        const x = wrap(seeds[i * 3] * BOX.w + t * 1.2 - cam.x, BOX.w) + cam.x - BOX.w / 2;
        const z = wrap(seeds[i * 3 + 1] * BOX.w - cam.z, BOX.w) + cam.z - BOX.w / 2;
        const y = wrap(seeds[i * 3 + 2] * BOX.h - t * 9.5, BOX.h) + bottom;
        const j = i * 6;
        pos[j] = x;
        pos[j + 1] = y;
        pos[j + 2] = z;
        pos[j + 3] = x - (0.55 * 1.2) / 9.5;
        pos[j + 4] = y + 0.55;
        pos[j + 5] = z;
      }
      geo.attributes.position.needsUpdate = true;
    },
  };
}

// Snow: flakes drifting down slowly, swaying.
function makeSnow(count = 6000) {
  const seeds = new Float32Array(count * 4);
  const random = rng(91041);
  for (let i = 0; i < seeds.length; i++) seeds[i] = random();
  const pos = new Float32Array(count * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  // Round, soft-edged flakes. Plain points are hard squares, and a flake passing just in front of
  // the lens grew into a large flat tile, so the on-screen size is also capped.
  // Three sets `scale` to half the CSS height but `size` to the flake size times the pixel ratio,
  // so `size / FLAKE` is the pixel ratio and the cap is 1.5% of the view height on any screen.
  const FLAKE = 0.12;
  const material = new THREE.PointsMaterial({
    color: 0xffffff,
    size: FLAKE,
    map: flakeTexture(),
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
  });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      "#include <fog_vertex>",
      `#include <fog_vertex>\n  gl_PointSize = min( gl_PointSize, scale * 0.03 * size / ${FLAKE.toFixed(2)} );`,
    );
  };
  const mesh = new THREE.Points(geo, material);
  mesh.frustumCulled = false;
  let t = 0;
  return {
    mesh,
    update(dt, cam) {
      t += dt;
      const bottom = Math.max(0, cam.y - BOX.h / 2);
      for (let i = 0; i < count; i++) {
        const sway = Math.sin(t * 0.8 + seeds[i * 4 + 3] * 6.28) * 0.6;
        const x = wrap(seeds[i * 4] * BOX.w + sway + t * 0.4 - cam.x, BOX.w) + cam.x - BOX.w / 2;
        const z = wrap(seeds[i * 4 + 1] * BOX.w - cam.z, BOX.w) + cam.z - BOX.w / 2;
        const y = wrap(seeds[i * 4 + 2] * BOX.h - t * (0.9 + seeds[i * 4 + 3] * 0.5), BOX.h) + bottom;
        const j = i * 3;
        pos[j] = x;
        pos[j + 1] = y;
        pos[j + 2] = z;
      }
      geo.attributes.position.needsUpdate = true;
    },
  };
}

const wrap = (v, m) => ((v % m) + m) % m;
