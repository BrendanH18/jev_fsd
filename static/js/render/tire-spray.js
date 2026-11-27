import * as THREE from "three";
import { rng } from "../common.js";
import { particleQuads } from "./weather-particles.js";

const MAX_VEHICLES = 24;
const DROPLETS = 20;
const LIFETIME = 0.5;

// Each instance uses an animated seed and one pair of uniforms for its vehicle's trailing axle.
export class TireSpray {
  constructor() {
    this.vehicles = new Float32Array(MAX_VEHICLES * 8);
    this.phase = { value: 0 };
    this.mesh = particleQuads(
      0,
      {
        sprayVehicles: { value: this.vehicles },
        sprayPhase: this.phase,
        particleColor: { value: new THREE.Color(0xb9c4cc) },
      },
      `
        uniform vec4 sprayVehicles[${MAX_VEHICLES * 2}];
        uniform float sprayPhase;
        attribute vec4 spraySeed;
        void main() {
          int i = int(spraySeed.w) * 2;
          vec4 axle = sprayVehicles[i];
          vec2 forward = sprayVehicles[i + 1].xy;
          vec2 across = vec2(-forward.y, forward.x);
          float side = spraySeed.y < 0.5 ? -1.0 : 1.0;
          float age = fract(sprayPhase + spraySeed.x);
          float heat = smoothstep(3.0, 13.0, axle.w);
          float trail = age * axle.w * ${LIFETIME} * mix(0.65, 1.0, spraySeed.z);
          float spread = 0.34 * age * spraySeed.z;
          vec2 p = axle.xy - forward * trail + across * side * (axle.z + spread);
          float height = 0.09 + (0.12 + 0.52 * heat) * sin(2.5 * age) * spraySeed.z;
          vec4 mvPosition = viewMatrix * vec4(p.x, height, p.y, 1.0);
          mvPosition.xy += position.xy * mix(0.13, 0.95, age) * mix(0.45, 1.0, heat);
          vParticleUV = uv;
          vOpacity = 0.31 * heat * smoothstep(0.0, 0.1, age) * (1.0 - age)
            * smoothstep(0.6, 2.3, -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }
      `,
      `
        vec2 p = 2.0 * vParticleUV - 1.0;
        float alpha = 1.0 - smoothstep(0.0, 1.0, dot(p, p));
      `,
      "tire-spray",
    );
    const seeds = new Float32Array(MAX_VEHICLES * DROPLETS * 4);
    const random = rng(92653);
    for (let i = 0; i < MAX_VEHICLES * DROPLETS; i++) {
      const offset = i * 4;
      seeds[offset] = random();
      seeds[offset + 1] = ((i % 2) + random()) * 0.5;
      seeds[offset + 2] = random();
      seeds[offset + 3] = Math.floor(i / DROPLETS);
    }
    this.mesh.geometry.setAttribute("spraySeed", new THREE.InstancedBufferAttribute(seeds, 4));
    this.mesh.visible = false;
    this.count = 0;
  }

  begin(ego, time) {
    this.mesh.position.set(ego.x, 0, -ego.y);
    this.phase.value = (time % LIFETIME) / LIFETIME;
    this.count = 0;
  }

  add = (pose) => {
    const speed = Math.abs(pose.v);
    const track = pose.spec?.track;
    const anchor = this.mesh.position;
    if (this.count === MAX_VEHICLES || !(speed > 3 && track > 0)) return;
    if ((pose.x - anchor.x) ** 2 + (pose.y + anchor.z) ** 2 > 50 ** 2) return;
    const reversing = pose.v < 0;
    const forwardX = Math.cos(pose.psi);
    const forwardZ = -Math.sin(pose.psi);
    const axle = reversing ? pose.spec.wheelbase : 0;
    const i = this.count * 8;
    this.vehicles[i] = pose.x + axle * forwardX;
    this.vehicles[i + 1] = -pose.y + axle * forwardZ;
    this.vehicles[i + 2] = track * 0.5;
    this.vehicles[i + 3] = speed;
    this.vehicles[i + 4] = reversing ? -forwardX : forwardX;
    this.vehicles[i + 5] = reversing ? -forwardZ : forwardZ;
    this.count++;
  };

  end() {
    this.mesh.geometry.instanceCount = this.count * DROPLETS;
    this.mesh.visible = this.count > 0;
  }
}
