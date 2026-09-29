// Everything beyond the edge of the map, so the neighbourhood does not end in an empty plain:
// English Bay and False Creek to the north, a low-detail continuation of the city's houses and
// street grid on the land around the map, the West End and downtown towers across False Creek to
// the north-east, and the dark forest of Stanley Park beyond them. None of it takes part in the
// simulation; it is scenery, cheap to draw (instanced, chunked), and faded by a haze of its own so
// it can be seen further than the scene's fog allows.
//
// The geography is simplified from the real thing, in the map's frame (x east, y north, meters
// from the map center at 49.265 N, 123.160 W).

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { LAYER, groundLayer, toThree } from "./scene.js";
import { lighting } from "./atmosphere.js";
import { hash01 } from "./geo.js";
import { macroTexture } from "./textures.js";

const CITY_RADIUS = 2600;
const CHUNK = 500;
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// Distance haze shared by everything out here: color follows the fog, strength the weather.
export const haze = { color: { value: new THREE.Color(0xc9dbea) }, k: { value: 0.00022 } };

// Land or water? The south shore of English Bay runs along Kitsilano out to Kits Point, False
// Creek cuts east from there, downtown sits between it and Burrard Inlet, Stanley Park caps the
// peninsula, and the North Shore rises across the inlet.
export function isWater(x, y) {
  if (y > 5250 + 150 * Math.sin(x / 900)) return false;                       // the North Shore
  if (((x - 1450) / 1400) ** 2 + ((y - 4050) / 900) ** 2 < 1) return false;   // Stanley Park
  const kits = 1000 + 55 * Math.sin(x / 380) + 320 * smooth(300, 1150, x);
  if (x < 1250) return y > kits;
  if (x < 1600) return y > 1340;                                               // off Vanier Park
  if (x < 4150) {
    if (y > 960 + 40 * Math.sin(x / 300) && y < 1290 + 30 * Math.sin(x / 350)) return true;  // False Creek
    return y > 2750 + 120 * Math.sin(x / 700);                                  // Burrard Inlet
  }
  return y > 2900;
}
const isDowntown = (x, y) => x > 1600 && x < 4150 && y > 1330 && y < 2700 && !isWater(x, y);
const isPark = (x, y) => ((x - 1450) / 1400) ** 2 + ((y - 4050) / 900) ** 2 < 0.92;

// Standard materials with a world-space facade pattern and the distance haze.
function sceneryMaterial({ facade = null, roughness = 0.85, metalness = 0 } = {}) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness, metalness, fog: false });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.hazeColor = haze.color;
    shader.uniforms.hazeK = haze.k;
    shader.uniforms.uNight = lighting.night;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying float vHazeDist;\nvarying vec3 vWP;\nvarying vec3 vWN;")
      .replace("#include <project_vertex>", `#include <project_vertex>
        vHazeDist = length( mvPosition.xyz );
        vec4 wp = vec4( transformed, 1.0 );
        vec3 wn = objectNormal;
        #ifdef USE_INSTANCING
          wp = instanceMatrix * wp;
          wn = mat3( instanceMatrix ) * wn;
        #endif
        vWP = ( modelMatrix * wp ).xyz;
        vWN = normalize( mat3( modelMatrix ) * wn );`);
    let frag = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform vec3 hazeColor;\nuniform float hazeK;\nuniform float uNight;\nvarying float vHazeDist;\nvarying vec3 vWP;\nvarying vec3 vWN;\nfloat h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }");
    if (facade) {
      // windows on the walls: floor height and bay width in meters; glass is darker and shinier,
      // and after dark some of it glows
      frag = frag
        .replace("#include <color_fragment>", `#include <color_fragment>
          float wall = 1.0 - abs( vWN.y );
          float along = abs( vWN.x ) > abs( vWN.z ) ? vWP.z : vWP.x;
          vec2 cell = vec2( floor( along / ${facade.bay.toFixed(2)} ), floor( ( vWP.y - ${facade.base.toFixed(2)} ) / ${facade.floor.toFixed(2)} ) );
          vec2 f = vec2( fract( along / ${facade.bay.toFixed(2)} ), fract( ( vWP.y - ${facade.base.toFixed(2)} ) / ${facade.floor.toFixed(2)} ) );
          float glass = wall * step( 0.0, vWP.y - ${facade.base.toFixed(2)} ) * step( ${facade.x0.toFixed(2)}, f.x ) * step( f.x, ${facade.x1.toFixed(2)} ) * step( ${facade.y0.toFixed(2)}, f.y ) * step( f.y, ${facade.y1.toFixed(2)} );
          diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.09, 0.12, 0.15 ), glass * ${facade.glassMix.toFixed(2)} );`)
        .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = mix( roughnessFactor, 0.12, glass );")
        .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
          float lit = step( ${facade.litAbove.toFixed(2)}, h21( cell + floor( vWP.xz / 40.0 ) * 17.0 ) );
          vec3 tone = mix( vec3( 1.0, 0.72, 0.42 ), vec3( 0.75, 0.85, 1.0 ), step( 0.6, h21( cell * 1.7 ) ) );
          totalEmissiveRadiance += tone * glass * lit * uNight * ${facade.glow.toFixed(2)};`);
    }
    frag = frag.replace("#include <tonemapping_fragment>", `
      gl_FragColor.rgb = mix( gl_FragColor.rgb, hazeColor, 1.0 - exp( -vHazeDist * hazeK ) );
      #include <tonemapping_fragment>`);
    shader.fragmentShader = frag;
  };
  mat.customProgramCacheKey = () => "scenery-" + (facade ? JSON.stringify(facade) : "plain");
  return mat;
}

function instanced(group, geo, mat, items, { shadow = false } = {}) {
  // chunked so the camera can skip what is behind it
  const chunks = new Map();
  for (const it of items) {
    const k = `${Math.floor(it.x / CHUNK)},${Math.floor(it.y / CHUNK)}`;
    if (!chunks.has(k)) chunks.set(k, []);
    chunks.get(k).push(it);
  }
  const Y = new THREE.Vector3(0, 1, 0), q = new THREE.Quaternion(), m = new THREE.Matrix4();
  for (const list of chunks.values()) {
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((it, i) => {
      q.setFromAxisAngle(Y, it.rot || 0);
      mesh.setMatrixAt(i, m.compose(toThree(it.x, it.y, it.z || 0), q, new THREE.Vector3(it.sx, it.sy, it.sz)));
      if (it.color !== undefined) mesh.setColorAt(i, new THREE.Color(it.color));
    });
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  }
}

export function buildSurroundings(map) {
  const group = new THREE.Group();
  const [ex0, ey0, ex1, ey1] = map.extent;
  const insideMap = (x, y, margin = 12) => x > ex0 - margin && x < ex1 + margin && y > ey0 - margin && y < ey1 + margin;

  // --- water: a grid of cells, merged where they are wet ---
  const cell = 50, R = 6000;
  const wpos = [];
  for (let x = -R; x < R; x += cell) for (let y = -2000; y < R; y += cell) {
    if (!isWater(x + cell / 2, y + cell / 2)) continue;
    const a = toThree(x, y), b = toThree(x + cell, y), c = toThree(x + cell, y + cell), d = toThree(x, y + cell);
    wpos.push(a.x, 0, a.z, b.x, 0, b.z, c.x, 0, c.z, a.x, 0, a.z, c.x, 0, c.z, d.x, 0, d.z);
  }
  const wgeo = new THREE.BufferGeometry();
  wgeo.setAttribute("position", new THREE.Float32BufferAttribute(wpos, 3));
  const wn = new Float32Array(wpos.length);
  for (let i = 1; i < wn.length; i += 3) wn[i] = 1;
  wgeo.setAttribute("normal", new THREE.BufferAttribute(wn, 3));
  const wuv = new Float32Array((wpos.length / 3) * 2);
  for (let i = 0, j = 0; i < wpos.length; i += 3, j += 2) { wuv[j] = wpos[i] / 60; wuv[j + 1] = wpos[i + 2] / 60; }
  wgeo.setAttribute("uv", new THREE.BufferAttribute(wuv, 2));
  const waves = macroTexture().clone();
  waves.needsUpdate = true;
  const water = new THREE.Mesh(wgeo, new THREE.MeshStandardMaterial({ color: 0x1b3440, roughness: 0.12, metalness: 0.1, envMapIntensity: 1.4, bumpMap: waves, bumpScale: 0.6 }));
  groundLayer(water, LAYER.water);
  group.add(water);

  // --- filler street grid and houses on the land around the map ---
  const houses = [], roofs = [], trees = [], blocks = [], streets = [];
  const AVE = 100, ST = 92;   // avenues run east-west every ~100 m, streets north-south every ~92 m
  for (let bx = -CITY_RADIUS; bx < CITY_RADIUS; bx += ST) for (let by = -CITY_RADIUS; by < CITY_RADIUS; by += AVE) {
    const cx = bx + ST / 2, cy = by + AVE / 2;
    if (Math.hypot(cx, cy) > CITY_RADIUS || insideMap(cx, cy, 60) || isWater(cx, cy) || isDowntown(cx, cy) || isPark(cx, cy)) continue;
    streets.push([bx, by]);
    const key = `${bx},${by}`;
    const arterial = Math.abs(by % (AVE * 4)) < 1;   // every fourth avenue is a busy street with apartments
    for (const row of [-1, 1]) {
      const yRow = cy + row * 24;
      for (let lx = bx + 12; lx < bx + ST - 12; lx += 11) {
        const k = `${key}:${row}:${lx}`;
        if (insideMap(lx, yRow, 8) || isWater(lx, yRow)) continue;
        if (arterial && row < 0 && hash01(k, 1) < 0.8) {
          blocks.push({ x: lx + 5, y: yRow - 4, sx: 22, sy: 10 + hash01(k, 2) * 6, sz: 18, color: [0xd6cfc2, 0xb9a88f, 0x9b6a55, 0xcfc7ba, 0x8d9094][Math.floor(hash01(k, 3) * 5)] });
          lx += 11;
          continue;
        }
        if (hash01(k, 4) < 0.08) continue;
        const w = 7.5 + hash01(k, 5) * 1.5, d = 11 + hash01(k, 6) * 4, h = 5.2 + hash01(k, 7) * 2.2;
        const color = [0xf2eee6, 0xe9dfc8, 0xd8d3c6, 0xb6c3ae, 0x9fb1c2, 0x707d88, 0x414c58, 0xc9b99c, 0xeadba4, 0x8f604b][Math.floor(hash01(k, 8) * 10)];
        houses.push({ x: lx, y: yRow, sx: w, sy: h, sz: d, color });
        roofs.push({ x: lx, y: yRow, z: h, sx: w + 0.8, sy: 2.6 + hash01(k, 9) * 1.4, sz: d + 0.8, color: [0x585b60, 0x6d7075, 0x80695a, 0x4c4e53][Math.floor(hash01(k, 10) * 4)] });
        if (hash01(k, 11) < 0.55) trees.push({ x: lx + (hash01(k, 12) - 0.5) * 6, y: cy + row * 44, z: 4.5, sx: 3.2, sy: 3.4, sz: 3.2, rot: hash01(k, 13) * 6, color: [0x3f6b2a, 0x4b7a31, 0x58883a, 0x355d29][Math.floor(hash01(k, 14) * 4)] });
      }
    }
  }

  // --- downtown and the West End: towers, taller toward the middle ---
  const towers = [];
  for (let x = 1620; x < 4150; x += 58) for (let y = 1350; y < 2700; y += 58) {
    const k = `t${x},${y}`;
    const px = x + (hash01(k, 1) - 0.5) * 20, py = y + (hash01(k, 2) - 0.5) * 20;
    if (!isDowntown(px, py) || hash01(k, 3) < 0.25) continue;
    const core = Math.exp(-(((px - 2800) / 900) ** 2 + ((py - 2150) / 550) ** 2));
    const h = 25 + (40 + 150 * core) * (0.4 + hash01(k, 4) * 0.8);
    const glassy = hash01(k, 5) < 0.55;
    towers.push({ x: px, y: py, sx: 22 + hash01(k, 6) * 16, sy: h, sz: 22 + hash01(k, 7) * 16, rot: 0,
      color: glassy ? [0x5d7a86, 0x6f8793, 0x4d6470, 0x7d949c][Math.floor(hash01(k, 8) * 4)] : [0xd8d4cc, 0xb8b2a6, 0x9aa0a6, 0xc9bfae][Math.floor(hash01(k, 9) * 4)] });
  }

  // --- Stanley Park: old-growth forest ---
  const forest = [];
  for (let x = 0; x < 2900; x += 32) for (let y = 3100; y < 5000; y += 32) {
    const k = `p${x},${y}`;
    const px = x + hash01(k, 1) * 32, py = y + hash01(k, 2) * 32;
    if (!isPark(px, py)) continue;
    const s = 9 + hash01(k, 3) * 7;
    forest.push({ x: px, y: py, z: s * 1.2, sx: s, sy: s * 1.9, sz: s, color: [0x1f3a2a, 0x27432f, 0x2c4a2c][Math.floor(hash01(k, 4) * 3)] });
  }

  const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const prism = (() => {   // unit gable roof
    const s = new THREE.Shape([new THREE.Vector2(-0.5, 0), new THREE.Vector2(0.5, 0), new THREE.Vector2(0, 1)]);
    return new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false }).translate(0, 0, -0.5);   // ridge north-south, gables to the street
  })();
  const blob = new THREE.IcosahedronGeometry(1, 1);
  const cone = new THREE.ConeGeometry(1, 1, 7).translate(0, 0, 0);
  instanced(group, box, sceneryMaterial({ facade: { bay: 3, floor: 3, base: 0.9, x0: 0.25, x1: 0.75, y0: 0.3, y1: 0.75, glassMix: 0.85, litAbove: 0.62, glow: 0.9 } }), houses, { shadow: true });
  instanced(group, prism, sceneryMaterial(), roofs, { shadow: true });
  instanced(group, box, sceneryMaterial({ facade: { bay: 3, floor: 3, base: 0.5, x0: 0.15, x1: 0.85, y0: 0.3, y1: 0.8, glassMix: 0.85, litAbove: 0.55, glow: 1.0 } }), blocks, { shadow: true });
  instanced(group, blob, sceneryMaterial({ roughness: 0.9 }), trees);
  instanced(group, box, sceneryMaterial({ facade: { bay: 1.6, floor: 3.6, base: 0, x0: 0.08, x1: 0.95, y0: 0.18, y1: 0.92, glassMix: 0.7, litAbove: 0.5, glow: 1.3 }, roughness: 0.4, metalness: 0.3 }), towers);
  instanced(group, cone, sceneryMaterial({ roughness: 0.95 }), forest);

  // filler streets: flat asphalt strips along the grid, under everything
  const spos = [];
  const quad = (x0, y0, x1, y1) => { const a = toThree(x0, y0), b = toThree(x1, y0), c = toThree(x1, y1), d = toThree(x0, y1); spos.push(a.x, 0, a.z, b.x, 0, b.z, c.x, 0, c.z, a.x, 0, a.z, c.x, 0, c.z, d.x, 0, d.z); };
  for (const [bx, by] of streets) { quad(bx - 6, by - 6, bx + ST - 6, by + 6); quad(bx - 6, by - 6, bx + 6, by + AVE - 6); }
  if (spos.length) {
    const sgeo = new THREE.BufferGeometry();
    sgeo.setAttribute("position", new THREE.Float32BufferAttribute(spos, 3));
    const sn = new Float32Array(spos.length); for (let i = 1; i < sn.length; i += 3) sn[i] = 1;
    sgeo.setAttribute("normal", new THREE.BufferAttribute(sn, 3));
    const streetMesh = new THREE.Mesh(sgeo, new THREE.MeshStandardMaterial({ color: 0x55585c, roughness: 0.95 }));
    groundLayer(streetMesh, LAYER.water + 1);
    group.add(streetMesh);
  }
  group.userData.counts = { houses: houses.length, towers: towers.length, forest: forest.length };
  return group;
}

// Fog and weather set how far out the scenery can be seen.
export function tintSurroundings(a) {
  haze.color.value.copy(a.fogColor);
  haze.k.value = { fog: 0.004, rain: 0.0011, snow: 0.0012 }[a.weather] || 0.00022 + 0.0002 * (1 - a.day);
}
