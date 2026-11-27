import * as THREE from "three";
import { rng } from "../common.js";
import { flakeTexture } from "./textures.js";

// A camera-sized volume with world-anchored motion. Only its origin and clock change each frame.
const weatherVolume = `
  uniform vec3 weatherCamera;
  uniform float weatherTime;
  vec3 weatherPosition(vec3 p) {
    vec2 xz = mod(p.xz - weatherCamera.xz, 70.0) - 35.0;
    float y = mod(p.y, 32.0) - min(weatherCamera.y, 16.0);
    return vec3(xz.x, y, xz.y);
  }
`;

const weatherUniforms = () => ({
  weatherCamera: { value: new THREE.Vector3() },
  weatherTime: { value: 0 },
});

// Camera-facing quads with a single draw and the same fog and depth testing as the world.
export function particleQuads(count, uniforms, vertex, fragment, name) {
  const quad = new THREE.PlaneGeometry(1, 1);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setIndex(quad.index);
  geometry.setAttribute("position", quad.attributes.position);
  geometry.setAttribute("uv", quad.attributes.uv);
  geometry.instanceCount = count;
  const material = new THREE.ShaderMaterial({
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), ...uniforms },
    transparent: true,
    depthWrite: false,
    fog: true,
    vertexShader: `
      #include <fog_pars_vertex>
      varying vec2 vParticleUV;
      varying float vOpacity;
      ${vertex}
    `,
    fragmentShader: `
      #include <fog_pars_fragment>
      varying vec2 vParticleUV;
      varying float vOpacity;
      uniform vec3 particleColor;
      void main() {
        ${fragment}
        gl_FragColor = vec4(particleColor, alpha * vOpacity);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.frustumCulled = false;
  return mesh;
}

export function makeRain(count = 5000) {
  const uniforms = weatherUniforms();
  const mesh = particleQuads(
    count,
    { ...uniforms, particleColor: { value: new THREE.Color(0xb8c2cc) } },
    `
      ${weatherVolume}
      attribute vec3 dropSeed;
      void main() {
        vec3 p = dropSeed * vec3(70.0, 32.0, 70.0) + vec3(1.2, -9.5, 0.0) * weatherTime;
        vec4 mvPosition = modelViewMatrix * vec4(weatherPosition(p), 1.0);
        // Project the fall direction at the drop and keep the quad at a single depth.
        // The same winding then faces the camera in steep and overhead views.
        vec3 tail = mat3(viewMatrix) * vec3(-1.2, 9.5, 0.0) * mix(0.038, 0.066, dropSeed.z);
        vec2 streak = tail.xy - mvPosition.xy * tail.z / min(mvPosition.z, -0.3);
        vec2 across = vec2(streak.y, -streak.x) / max(length(streak), 0.001);
        mvPosition.xy += streak * uv.y + across * position.x * 0.065;
        vParticleUV = uv;
        vOpacity = 0.52 * smoothstep(0.5, 2.8, -mvPosition.z);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    `
      float sides = smoothstep(0.0, 0.42, min(vParticleUV.x, 1.0 - vParticleUV.x));
      float alpha = sides * smoothstep(0.0, 0.18, vParticleUV.y) * (1.0 - vParticleUV.y);
    `,
    "rain",
  );
  const seeds = new Float32Array(count * 3);
  const random = rng(32051);
  for (let i = 0; i < seeds.length; i++) seeds[i] = random();
  mesh.geometry.setAttribute("dropSeed", new THREE.InstancedBufferAttribute(seeds, 3));
  return { mesh, uniforms };
}

export function makeSnow(count = 6000) {
  const positions = new Float32Array(count * 3);
  const phases = new Float32Array(count);
  const random = rng(91041);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = random();
    positions[i * 3 + 1] = random();
    positions[i * 3 + 2] = random();
    phases[i] = random();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("flakePhase", new THREE.BufferAttribute(phases, 1));
  const uniforms = weatherUniforms();
  const flake = 0.12;
  const material = new THREE.PointsMaterial({
    color: 0xffffff,
    size: flake,
    map: flakeTexture(),
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
  });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${weatherVolume}\nattribute float flakePhase;`)
      .replace(
        "#include <begin_vertex>",
        `
        float sway = sin(weatherTime * 0.8 + flakePhase * 6.28) * 0.6;
        vec3 p = position * vec3(70.0, 32.0, 70.0)
          + vec3(sway + weatherTime * 0.4, -weatherTime * (0.9 + flakePhase * 0.5), 0.0);
        vec3 transformed = weatherPosition(p);
        `,
      )
      .replace(
        "#include <fog_vertex>",
        // Three's scale uses CSS height; size / flake gives the pixel ratio.
        `#include <fog_vertex>\n gl_PointSize = min(gl_PointSize, scale * 0.03 * size / ${flake});`,
      );
  };
  const mesh = new THREE.Points(geometry, material);
  mesh.name = "snow";
  mesh.frustumCulled = false;
  return { mesh, uniforms };
}

export function updatePrecipitation({ mesh, uniforms }, dt, camera) {
  camera.getWorldPosition(mesh.position);
  uniforms.weatherCamera.value.copy(mesh.position);
  uniforms.weatherTime.value += dt;
}
