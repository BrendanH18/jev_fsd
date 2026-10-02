// Buildings from OSM footprints. Houses (most of Kitsilano) get sided walls with windows and a
// gabled or hipped roof when the footprint is roughly rectangular; larger or taller buildings get
// flat roofs and an apartment/storefront facade. Houses facing a street get the details that make
// a Kitsilano block: a front porch with steps and posts, a brick chimney, a clipped hedge along the
// front yard. Geometry is merged per ~180 m chunk so the camera and the shadow pass can skip what
// they cannot see.

import * as THREE from "three";
import { snowable } from "./weather.js";
import { GeoBuilder, hash01 } from "./geo.js";
import { facadeTextures, flatRoofTexture, shingleTexture, grassTexture } from "./textures.js";
import { buildingShapes } from "../map/building-scenery.js";
import { lighting } from "./atmosphere.js";

const CHUNK = 180;
const FACADE_TILE = 12;   // meters per facade texture tile
const SHINGLE_TILE = 4;
const FLAT_TILE = 9;
const EAVE = 0.4;

const HOUSE_COLORS = [0xf2eee6, 0xe9dfc8, 0xd8d3c6, 0xb6c3ae, 0x9fb1c2, 0x707d88, 0x414c58, 0xc9b99c, 0xeadba4, 0x8f604b, 0xf5f3ec, 0x5f705d, 0xc6cfd4, 0xa77b5c];
const BLOCK_COLORS = [0xdad2c4, 0xc9b9a0, 0xaba59c, 0x9d6c56, 0xe4dfd5, 0x8f9296, 0xb98b6b, 0xcfc8bb];
const ROOF_COLORS = [0x6d7075, 0x585b60, 0x80695a, 0x777b80, 0x5d6e67, 0x8c7765, 0x4c4e53, 0x9a6452];
const FLAT_COLORS = [0x9c9c98, 0x8b8d8f, 0xa9a59c, 0x7a7d80];

const color = (list, key, salt, jitter = 0.08) => {
  const c = new THREE.Color(list[Math.floor(hash01(key, salt) * list.length)]);
  return c.multiplyScalar(1 - jitter + 2 * jitter * hash01(key, salt + 1));
};

// After dark about two windows in five are lit, mostly warm lamplight, now and then the cool flicker
// of a screen; shop windows on the ground floor of apartment blocks stay lit.
function wallMaterial(kind) {
  const { map, mask } = facadeTextures(kind);
  const mat = new THREE.MeshStandardMaterial({ map, vertexColors: true, roughness: 0.88, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.tintMask = { value: mask };
    shader.uniforms.uNight = lighting.night;
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <map_pars_fragment>", "#include <map_pars_fragment>\nuniform sampler2D tintMask;\nuniform float uNight;")
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
        float glass = texture2D( tintMask, vMapUv ).g;
        if ( glass > 0.5 && uNight > 0.0 ) {
          vec2 cell = floor( vMapUv * 4.0 );
          float rnd = fract( sin( dot( cell, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
          float shop = ${kind === "block" ? "step( fract( vMapUv.y ), 0.25 )" : "0.0"};
          float lit = max( step( 0.6, rnd ), shop );
          vec3 tone = mix( vec3( 1.0, 0.68, 0.36 ), vec3( 0.62, 0.74, 1.0 ), step( 0.95, fract( rnd * 7.13 ) ) );
          // brighter toward the top of the window, where the room's ceiling is lit
          float fall = 0.55 + 0.45 * fract( vMapUv.y * 4.0 );
          totalEmissiveRadiance += tone * lit * uNight * fall * 0.9;
        }`)
      .replace("#include <color_fragment>", `
        float wallMask = texture2D( tintMask, vMapUv ).r;
        #if defined( USE_COLOR )
          diffuseColor.rgb *= mix( vec3( 1.0 ), vColor.rgb, wallMask );
        #endif`)
      .replace("#include <roughnessmap_fragment>", "float roughnessFactor = mix( 0.12, roughness, wallMask );");
  };
  mat.customProgramCacheKey = () => "facade-" + kind;
  return mat;
}

class Chunk {
  constructor() {
    this.house = new GeoBuilder({ colors: true }); this.house.uvScale = 1 / FACADE_TILE;
    this.block = new GeoBuilder({ colors: true }); this.block.uvScale = 1 / FACADE_TILE;
    this.roof = new GeoBuilder({ colors: true }); this.roof.uvScale = 1 / SHINGLE_TILE;
    this.flat = new GeoBuilder({ colors: true });
    this.detail = new GeoBuilder({ colors: true });
    this.hedge = new GeoBuilder({ colors: true }); this.hedge.uvScale = 1 / 3;
  }
}

// A box on the ground plan: centered at (cx, cy), long axis (ux, uy), half extents hl x hw, from
// height z0 to z1, sides facing out.
function orientedBox(b, cx, cy, ux, uy, hl, hw, z0, z1, color, top = true) {
  const vx = -uy, vy = ux;
  const P = (a, c, z) => [cx + ux * a + vx * c, cy + uy * a + vy * c, z];
  const corners = [[-hl, -hw], [hl, -hw], [hl, hw], [-hl, hw]];
  for (let i = 0; i < 4; i++) {
    const [a0, c0] = corners[i], [a1, c1] = corners[(i + 1) % 4];
    const out = [((a0 + a1) / 2) * ux + ((c0 + c1) / 2) * vx, ((a0 + a1) / 2) * uy + ((c0 + c1) / 2) * vy, 0];
    b.quad(P(a0, c0, z0), P(a1, c1, z0), P(a1, c1, z1), P(a0, c0, z1), null, color, out);
  }
  if (top) b.quad(P(-hl, -hw, z1), P(hl, -hw, z1), P(hl, hw, z1), P(-hl, hw, z1), null, color, [0, 0, 1]);
}

const WHITE = new THREE.Color(0xf4f2ec), DECK = new THREE.Color(0x7d746a), BRICK = new THREE.Color(0x8a4c3c), STEP = new THREE.Color(0xa9a59c);
const HEDGE = [0x6f9a50, 0x7fa85a, 0x648c48];

// The details of a house with a street in front: porch, chimney, hedge.
function houseDetails(chunk, r, wallH, roofTop, key, roofCol, boxes) {
  if (chunk && hash01(key, 41) < 0.45) {
    // a chimney up through the roof near one gable end
    const end = hash01(key, 42) < 0.5 ? -1 : 1;
    const a = end * Math.max(0, r.hl - 0.9), c = r.hw * 0.35 * (hash01(key, 43) < 0.5 ? -1 : 1);
    orientedBox(chunk.detail, r.cx + r.ux * a - r.uy * c, r.cy + r.uy * a + r.ux * c, r.ux, r.uy, 0.35, 0.3, wallH - 0.5, roofTop + 0.7, BRICK);
  }
  for (const box of boxes) {
    const { part, cx, cy, ux, uy, hl, hw, z0, z1 } = box;
    const materialColor = part === "porch" ? DECK : part === "porch_step" ? STEP
      : part === "porch_roof" ? roofCol : part === "door" ? new THREE.Color([0x5a2e22, 0x2b3a4a, 0x1f1f1f, 0x7a1f1f, 0x2f4a3a][Math.floor(hash01(key, 46) * 5)])
      : part === "hedge" ? new THREE.Color(HEDGE[Math.floor(hash01(key, 48) * HEDGE.length)]) : WHITE;
    orientedBox(part === "hedge" ? chunk.hedge : chunk.detail, cx, cy, ux, uy, hl, hw, z0, z1, materialColor);
  }
}

function walls(b, pts, h, col) {
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    b.quad([p[0], p[1], 0], [q[0], q[1], 0], [q[0], q[1], h], [p[0], p[1], h], null, col);
  }
}

function pitchedRoof(chunk, wallsB, r, wallH, key, wallCol, roofCol) {
  const hip = hash01(key, 5) < 0.4;
  const hw = r.hw, hl = r.hl;
  const rise = hip ? Math.min(3.4, Math.max(1.3, hw * 0.62)) : Math.min(4.2, Math.max(1.5, hw * 0.78));
  const top = wallH + rise, zE = wallH - EAVE * (rise / hw);
  const P = (u, v, z) => [r.cx + u * r.ux - v * r.uy, r.cy + u * r.uy + v * r.ux, z];
  const up = [0, 0, 1];
  const A = P(-hl - EAVE, -hw - EAVE, zE), B = P(hl + EAVE, -hw - EAVE, zE);
  const C = P(hl + EAVE, hw + EAVE, zE), D = P(-hl - EAVE, hw + EAVE, zE);
  if (hip) {
    const rl = Math.max(0, hl - hw);
    const R1 = P(-rl, 0, top), R2 = P(rl, 0, top);
    chunk.roof.quad(A, B, R2, R1, null, roofCol, up);
    chunk.roof.quad(C, D, R1, R2, null, roofCol, up);
    chunk.roof.tri(B, C, R2, null, roofCol, up);
    chunk.roof.tri(D, A, R1, null, roofCol, up);
  } else {
    const R1 = P(-hl - EAVE, 0, top), R2 = P(hl + EAVE, 0, top);
    chunk.roof.quad(A, B, R2, R1, null, roofCol, up);
    chunk.roof.quad(C, D, R1, R2, null, roofCol, up);
    // gable ends, in the wall material
    for (const s of [-1, 1]) {
      const out = [s * r.ux, s * r.uy, 0];
      wallsB.tri(P(s * hl, -hw, wallH), P(s * hl, hw, wallH), P(s * hl, 0, top), null, wallCol, out);
    }
  }
  return top;
}

export function buildBuildings(map, { houseColors = HOUSE_COLORS, blockColors = BLOCK_COLORS } = {}) {
  const group = new THREE.Group();
  const chunks = new Map();
  const footprints = [];
  buildingShapes(map).forEach(({ pts, i, h, kind, r, pitched, cx, cy, boxes }) => {
    footprints.push(pts);
    const key = `${Math.floor(cx / CHUNK)},${Math.floor(cy / CHUNK)}`;
    if (!chunks.has(key)) chunks.set(key, new Chunk());
    const chunk = chunks.get(key);
    const wallCol = color(kind === "house" ? houseColors : blockColors, i, 11);
    const builder = kind === "house" ? chunk.house : chunk.block;
    if (pitched) {
      const wallH = Math.max(2.8, h - Math.min(4.2, r.hw * 0.7));
      walls(builder, pts, wallH, wallCol);
      const roofCol = color(ROOF_COLORS, i, 21, 0.12);
      const top = pitchedRoof(chunk, builder, r, wallH, i, wallCol, roofCol);
      if (kind === "house") houseDetails(chunk, r, wallH, top, i, roofCol, boxes);
    } else {
      walls(builder, pts, h, wallCol);
      chunk.flat.polygon(pts, h, { scale: FLAT_TILE, color: color(FLAT_COLORS, i, 31) });
      // a parapet cap in the wall color so flat roofs read as tops of walls
      for (let k = 0; k < pts.length; k++) {
        const p = pts[k], q = pts[(k + 1) % pts.length];
        const dx = q[0] - p[0], dy = q[1] - p[1], l = Math.hypot(dx, dy) || 1;
        const nx = -dy / l * 0.25, ny = dx / l * 0.25;   // inward for a counter-clockwise ring
        chunk.flat.quad([p[0], p[1], h + 0.05], [q[0], q[1], h + 0.05], [q[0] + nx, q[1] + ny, h + 0.05], [p[0] + nx, p[1] + ny, h + 0.05], [[0, 0], [1, 0], [1, 0.1], [0, 0.1]], wallCol, [0, 0, 1]);
      }
    }
  });

  const mats = {
    house: wallMaterial("house"),
    block: wallMaterial("block"),
    roof: snowable(new THREE.MeshStandardMaterial({ map: shingleTexture(), vertexColors: true, roughness: 0.92, side: THREE.DoubleSide }), "roof"),
    flat: snowable(new THREE.MeshStandardMaterial({ map: flatRoofTexture(), vertexColors: true, roughness: 0.95 }), "roof"),
    detail: snowable(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }), "roof"),
    hedge: snowable(new THREE.MeshStandardMaterial({ map: grassTexture().clone(), vertexColors: true, roughness: 0.95 }), "leaf"),
  };
  mats.hedge.map.repeat.set(1, 1);
  mats.hedge.map.needsUpdate = true;
  for (const chunk of chunks.values()) {
    for (const name of ["house", "block", "roof", "flat", "detail", "hedge"]) {
      const b = chunk[name];
      if (b.empty) continue;
      const mesh = new THREE.Mesh(b.toGeometry(), mats[name]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }
  group.userData.index = new FootprintIndex(footprints);
  return group;
}

// "Is this point inside or near a building?" for placing trees.
export class FootprintIndex {
  constructor(polys, cell = 25) {
    this.polys = polys; this.cell = cell; this.grid = new Map();
    polys.forEach((pts, i) => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
      for (let gx = Math.floor(x0 / cell); gx <= Math.floor(x1 / cell); gx++) for (let gy = Math.floor(y0 / cell); gy <= Math.floor(y1 / cell); gy++) {
        const k = gx + "," + gy;
        if (!this.grid.has(k)) this.grid.set(k, []);
        this.grid.get(k).push(i);
      }
    });
  }

  near(x, y, margin) {
    const seen = new Set();
    const r = Math.ceil(margin / this.cell);
    const gx = Math.floor(x / this.cell), gy = Math.floor(y / this.cell);
    for (let i = gx - r; i <= gx + r; i++) for (let j = gy - r; j <= gy + r; j++) {
      for (const idx of this.grid.get(i + "," + j) || []) {
        if (seen.has(idx)) continue;
        seen.add(idx);
        if (insideOrNear(this.polys[idx], x, y, margin)) return true;
      }
    }
    return false;
  }
}

function insideOrNear(pts, x, y, margin) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    const dx = xj - xi, dy = yj - yi, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((x - xi) * dx + (y - yi) * dy) / l2)) : 0;
    if (Math.hypot(x - xi - dx * t, y - yi - dy * t) < margin) return true;
  }
  return inside;
}
