// How the weather looks on the ground: wet or snow-covered surfaces, and rain or snow falling
// around the camera. Surfaces opt in by tagging their material with
// `userData.surface`; snow settles on whatever faces up (a shader tweak), so roofs, lawns, and the
// tops of trees and parked cars turn white while walls stay as they are.

import { makeRain, makeSnow, updatePrecipitation } from "./weather-particles.js";
import { TireSpray } from "./tire-spray.js";

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

const snowUniforms = new WeakMap();

// Make a material able to show snow on its upward faces; the amount is a uniform set later.
export function snowable(material, surface) {
  material.userData.surface = surface;
  if (snowUniforms.has(material)) return material;
  const uniform = { value: 0 };
  snowUniforms.set(material, uniform);
  material.userData.snow = uniform;
  const prev = material.onBeforeCompile;
  const prevKey = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    prev.call(material, shader, renderer);
    shader.uniforms.uSnow = uniform;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying float vUp;")
      .replace(
        "#include <defaultnormal_vertex>",
        `#include <defaultnormal_vertex>
        vUp = normalize(transpose(mat3(viewMatrix)) * transformedNormal).y;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vUp;\nuniform float uSnow;")
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.95, 0.98), uSnow * smoothstep(0.35, 0.85, vUp));`,
      );
  };
  material.customProgramCacheKey = () => `snow-${prevKey}`;
  material.needsUpdate = true;
  return material;
}

export class WeatherView {
  constructor(view) {
    this.view = view;
    this.name = "dry";
    this.rain = null;
    this.snow = null;
    this.spray = null;
  }

  apply(name) {
    this.name = Object.hasOwn(PRESETS, name) ? name : "dry";
    const P = PRESETS[this.name];
    const v = this.view;
    const updated = new Set();
    v.scene.traverse((o) => {
      const mats = !o.material ? [] : Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        const surface = m?.userData.surface;
        if (!surface || !m.color || updated.has(m)) continue;
        updated.add(m);
        if (!m.userData.base)
          m.userData.base = { color: m.color.clone(), roughness: m.roughness, env: m.envMapIntensity };
        const base = m.userData.base,
          wet = Object.hasOwn(WET, surface) ? (P.wet ?? 0) : 0,
          w = WET[surface];
        m.color.copy(base.color).multiplyScalar(wet ? 1 - (1 - w.color) * wet : 1);
        if (base.roughness !== undefined)
          m.roughness = wet ? base.roughness + (w.roughness - base.roughness) * wet : base.roughness;
        if (base.env !== undefined) m.envMapIntensity = wet ? base.env + (w.env - base.env) * wet : base.env;
        if (m.userData.snow)
          m.userData.snow.value = Object.hasOwn(SNOW_COVER, surface) ? (P.snow ?? 0) * SNOW_COVER[surface] : 0;
      }
    });
    this.setParticles(P.particles || null);
  }

  setParticles(kind) {
    if ((kind === "rain" && this.rain) || (kind === "snow" && this.snow)) return;
    for (const k of ["rain", "snow", "spray"]) {
      if (this[k]) {
        const { mesh } = this[k];
        mesh.removeFromParent();
        mesh.geometry.dispose();
        mesh.material.dispose();
        this[k] = null;
      }
    }
    if (kind === "rain") {
      this.rain = makeRain();
      this.spray = new TireSpray();
      this.view.scene.add(this.spray.mesh);
    }
    if (kind === "snow") this.snow = makeSnow();
    const effect = this.rain ?? this.snow;
    if (effect) {
      updatePrecipitation(effect, 0, this.view.camera);
      this.view.scene.add(effect.mesh);
    }
  }

  update(dt) {
    const effect = this.rain ?? this.snow;
    if (effect) updatePrecipitation(effect, Number.isFinite(dt) && dt > 0 ? dt : 0, this.view.camera);
  }
}
