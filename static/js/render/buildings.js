// Buildings from OSM footprints. Houses (most of Kitsilano) get sided walls with windows and a
// gabled or hipped roof when the footprint is roughly rectangular; larger or taller buildings get
// flat roofs and an apartment/storefront facade. Geometry is merged per ~180 m chunk so the camera
// and the shadow pass can skip what they cannot see.

import * as THREE from "three";
import { GeoBuilder, hash01 } from "./geo.js";
import { facadeTextures, flatRoofTexture, shingleTexture } from "./textures.js";

const CHUNK = 180;
const FACADE_TILE = 12;   // meters per facade texture tile
const SHINGLE_TILE = 4;
const FLAT_TILE = 9;
const EAVE = 0.4;
const INSET = 0.06;       // shrink footprints so buildings sharing a wall do not z-fight

const HOUSE_COLORS = [0xf2eee6, 0xe9dfc8, 0xd8d3c6, 0xb6c3ae, 0x9fb1c2, 0x707d88, 0x414c58, 0xc9b99c, 0xeadba4, 0x8f604b, 0xf5f3ec, 0x5f705d, 0xc6cfd4, 0xa77b5c];
const BLOCK_COLORS = [0xdad2c4, 0xc9b9a0, 0xaba59c, 0x9d6c56, 0xe4dfd5, 0x8f9296, 0xb98b6b, 0xcfc8bb];
const ROOF_COLORS = [0x6d7075, 0x585b60, 0x80695a, 0x777b80, 0x5d6e67, 0x8c7765, 0x4c4e53, 0x9a6452];
const FLAT_COLORS = [0x9c9c98, 0x8b8d8f, 0xa9a59c, 0x7a7d80];

const color = (list, key, salt, jitter = 0.08) => {
  const c = new THREE.Color(list[Math.floor(hash01(key, salt) * list.length)]);
  return c.multiplyScalar(1 - jitter + 2 * jitter * hash01(key, salt + 1));
};

function wallMaterial(kind) {
  const { map, mask } = facadeTextures(kind);
  const mat = new THREE.MeshStandardMaterial({ map, vertexColors: true, roughness: 0.88, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.tintMask = { value: mask };
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <map_pars_fragment>", "#include <map_pars_fragment>\nuniform sampler2D tintMask;")
      .replace("#include <color_fragment>", `
        float wallMask = texture2D( tintMask, vMapUv ).r;
        #if defined( USE_COLOR )
          diffuseColor.rgb *= mix( vec3( 1.0 ), vColor.rgb, wallMask );
        #endif`)
      .replace("#include <roughnessmap_fragment>", "float roughnessFactor = mix( 0.12, roughness, wallMask );");
  };
  mat.customProgramCacheKey = () => "facade";
  return mat;
}

function centroid(pts) {
  let x = 0, y = 0;
  for (const p of pts) { x += p[0]; y += p[1]; }
  return [x / pts.length, y / pts.length];
}

function area(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; }
  return a / 2;
}

function convexHull(points) {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const p of pts) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  up.pop(); lo.pop();
  return lo.concat(up);
}

// Minimum-area bounding rectangle: center, long axis (ux, uy), half length hl >= half width hw.
function minRect(pts) {
  const hull = convexHull(pts);
  let best = null;
  for (let i = 0; i < hull.length; i++) {
    const p = hull[i], q = hull[(i + 1) % hull.length];
    const l = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (l < 1e-6) continue;
    const ux = (q[0] - p[0]) / l, uy = (q[1] - p[1]) / l;
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const [x, y] of hull) {
      const u = x * ux + y * uy, v = -x * uy + y * ux;
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
    }
    const a = (u1 - u0) * (v1 - v0);
    if (!best || a < best.area) best = { area: a, ux, uy, u0, u1, v0, v1 };
  }
  if (!best) return null;
  const { ux, uy, u0, u1, v0, v1 } = best;
  const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
  let r = { cx: cu * ux - cv * uy, cy: cu * uy + cv * ux, ux, uy, hl: (u1 - u0) / 2, hw: (v1 - v0) / 2, area: best.area };
  if (r.hw > r.hl) r = { ...r, ux: -uy, uy: ux, hl: r.hw, hw: r.hl };
  return r;
}

class Chunk {
  constructor() {
    this.house = new GeoBuilder({ colors: true }); this.house.uvScale = 1 / FACADE_TILE;
    this.block = new GeoBuilder({ colors: true }); this.block.uvScale = 1 / FACADE_TILE;
    this.roof = new GeoBuilder({ colors: true }); this.roof.uvScale = 1 / SHINGLE_TILE;
    this.flat = new GeoBuilder({ colors: true });
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
}

export function buildBuildings(map) {
  const group = new THREE.Group();
  const chunks = new Map();
  const footprints = [];
  map.pack.buildings.forEach((bld, i) => {
    let pts = bld.pts;
    if (Math.abs(area(pts)) < 1) return;
    if (area(pts) < 0) pts = [...pts].reverse();
    const c = centroid(pts);
    pts = pts.map(([x, y]) => {
      const dx = x - c[0], dy = y - c[1], d = Math.hypot(dx, dy) || 1;
      const k = Math.max(0.5, 1 - INSET / d);
      return [c[0] + dx * k, c[1] + dy * k];
    });
    footprints.push(pts);
    const key = `${Math.floor(c[0] / CHUNK)},${Math.floor(c[1] / CHUNK)}`;
    if (!chunks.has(key)) chunks.set(key, new Chunk());
    const chunk = chunks.get(key);
    const h = bld.h + (i % 7) * 0.04;
    const a = Math.abs(area(pts));
    const kind = h > 13 || a > 450 ? "block" : "house";
    const wallCol = color(kind === "house" ? HOUSE_COLORS : BLOCK_COLORS, i, 11);
    const r = kind === "house" ? minRect(pts) : null;
    const pitched = r && a / r.area > 0.7 && r.hw <= 8.5 && r.hw >= 1.5 && hash01(i, 3) < 0.92;
    const builder = kind === "house" ? chunk.house : chunk.block;
    if (pitched) {
      const wallH = Math.max(2.8, h - Math.min(4.2, r.hw * 0.7));
      walls(builder, pts, wallH, wallCol);
      pitchedRoof(chunk, builder, r, wallH, i, wallCol, color(ROOF_COLORS, i, 21, 0.12));
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
    roof: new THREE.MeshStandardMaterial({ map: shingleTexture(), vertexColors: true, roughness: 0.92, side: THREE.DoubleSide }),
    flat: new THREE.MeshStandardMaterial({ map: flatRoofTexture(), vertexColors: true, roughness: 0.95 }),
  };
  for (const chunk of chunks.values()) {
    for (const name of ["house", "block", "roof", "flat"]) {
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
