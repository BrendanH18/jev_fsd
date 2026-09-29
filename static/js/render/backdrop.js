// The North Shore mountains on the northern horizon, as they rise behind Kitsilano: a ridge of
// forested peaks from the north-west round to the north-east (bare in late September, white when
// it snows), and the haze of the distance between. It is a curtain a few kilometers out (inside the camera's far
// plane), sized to subtend what the real mountains do from twelve kilometers away, shaded by the
// sky it sits under and hidden when the weather closes in.

import * as THREE from "three";

const RADIUS = 5200;
const ARC = [-78, 72];       // degrees from north, clockwise (west is negative)
const SEGMENTS = 360;

// Ridge height (m, at RADIUS) at an azimuth: a few named-peak bumps plus rougher noise.
function ridge(az) {
  const peaks = [[-62, 180, 14], [-40, 260, 10], [-18, 330, 9], [-4, 290, 7], [8, 360, 8], [24, 300, 10], [44, 250, 12], [62, 190, 14]];
  let h = 90 + 40 * Math.sin(az * 0.21) + 25 * Math.sin(az * 0.53 + 1.3);
  for (const [c, height, width] of peaks) h = Math.max(h, height * Math.exp(-(((az - c) / width) ** 2)) + 60 * Math.exp(-(((az - c) / (width * 2.2)) ** 2)));
  h += 18 * Math.sin(az * 1.7 + 0.4) + 9 * Math.sin(az * 3.9 + 2.1) + 4 * Math.sin(az * 9.1);
  // taper off at the ends of the range
  const t = Math.min(1, (az - ARC[0]) / 12, (ARC[1] - az) / 12);
  return Math.max(0, h * 1.75 * Math.max(0, t));
}

export function buildBackdrop(center) {
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= SEGMENTS; i++) {
    const az = ARC[0] + (ARC[1] - ARC[0]) * (i / SEGMENTS);
    const a = az * Math.PI / 180;
    const x = center.x + Math.sin(a) * RADIUS, z = center.z - Math.cos(a) * RADIUS;
    const h = ridge(az);
    pos.push(x, -30, z, x, h, z);
    uv.push(i / SEGMENTS, 0, i / SEGMENTS, 1);
    if (i < SEGMENTS) { const k = i * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  const mat = new THREE.ShaderMaterial({
    fog: false,
    side: THREE.DoubleSide,
    uniforms: {
      horizon: { value: new THREE.Color(0xc9dbea) },
      rock: { value: new THREE.Color(0x3c4c50) },
      snow: { value: new THREE.Color(0xe8eef4) },
      snowCover: { value: 0.12 },
      haze: { value: 0.55 },
      light: { value: 1 },
      visible: { value: 1 },
    },
    vertexShader: `
      varying vec2 vUv; varying float vH;
      void main() { vUv = uv; vH = position.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform vec3 horizon, rock, snow; uniform float haze, light, visible, snowCover;
      varying vec2 vUv; varying float vH;
      float n1(float x) { return fract(sin(mod(x, 289.0) * 12.9898) * 43758.5453); }
      float noise(float x) { float i = floor(x), f = fract(x); return mix(n1(i), n1(i + 1.0), f * f * (3.0 - 2.0 * f)); }
      void main() {
        // spurs and gullies running down the slopes (streaks that lean with the height), forest
        // below, bare rock toward the tops, snow on the high ground when it has snowed
        float x = vUv.x * 140.0 + vH * 0.012;
        float spur = noise(x) * 0.6 + noise(x * 2.7 + 5.0) * 0.3 + noise(x * 7.1 + 9.0) * 0.1;
        vec3 forest = vec3(0.13, 0.19, 0.17), bare = rock;
        vec3 c = mix(forest, bare, smoothstep(380.0, 620.0, vH + spur * 90.0)) * (0.7 + 0.6 * spur);
        float snowLine = mix(640.0, 300.0, snowCover) + 90.0 * noise(vUv.x * 40.0);
        c = mix(c, snow, smoothstep(snowLine - 40.0, snowLine + 60.0, vH + spur * 80.0) * mix(0.5, 0.95, snowCover));
        c *= light;
        // more haze toward the foot of the range, where there is more air in the way
        float h = clamp(haze + 0.2 * (1.0 - smoothstep(0.0, 450.0, vH)), 0.0, 1.0);
        c = mix(c, horizon, h);
        gl_FragColor = vec4(mix(horizon, c, visible), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -90;   // just after the sky, before anything nearer
  return mesh;
}

// Match the mountains to the sky: the haze takes the horizon's color, the rock is lit by the day,
// and fog, rain, and snow hide the range.
export function tintBackdrop(mesh, a) {
  const u = mesh.material.uniforms;
  u.horizon.value.copy(a.fogColor);
  u.light.value = 0.12 + 0.88 * a.day;
  u.haze.value = 0.38 + 0.3 * (1 - a.day);
  const hidden = { fog: 1, rain: 0.85, snow: 0.8 }[a.weather] || 0;
  u.visible.value = 1 - hidden;
  u.snowCover.value = a.weather === "snow" ? 1 : 0.12;
}
