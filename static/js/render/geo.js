// A small geometry builder: flat arrays in, one non-indexed BufferGeometry out. Everything the
// scenery draws (roads, walls, roofs, markings) is accumulated here so each material becomes one
// draw call. Inputs are sim coordinates (x east, y north, z up); output is Three.js (x, z, -y).

import * as THREE from "three";

export class GeoBuilder {
  constructor({ colors = false } = {}) {
    this.pos = []; this.nrm = []; this.uv = []; this.col = colors ? [] : null;
    this.uvScale = 1;  // applied to automatic (planar) texture coordinates
  }

  get empty() { return this.pos.length === 0; }

  // One vertex. p = [x, y, z] in sim coordinates, n likewise.
  vert(p, n, uv, color) {
    this.pos.push(p[0], p[2], -p[1]);
    this.nrm.push(n[0], n[2], -n[1]);
    this.uv.push(uv[0], uv[1]);
    if (this.col) this.col.push(color.r, color.g, color.b);
  }

  // Triangle with a flat normal computed from its winding (counter-clockwise seen from the front).
  tri(a, b, c, uvs, color, flipTo = null) {
    let n = normalOf(a, b, c);
    if (flipTo && n[0] * flipTo[0] + n[1] * flipTo[1] + n[2] * flipTo[2] < 0) {
      [b, c] = [c, b];
      uvs = uvs && [uvs[0], uvs[2], uvs[1]];
      n = [-n[0], -n[1], -n[2]];
    }
    if (!uvs) {
      const k = this.uvScale;
      uvs = [a, b, c].map((p) => { const [u, v] = planarUV(p, n); return [u * k, v * k]; });
    }
    this.vert(a, n, uvs[0], color); this.vert(b, n, uvs[1], color); this.vert(c, n, uvs[2], color);
  }

  quad(a, b, c, d, uvs, color, flipTo = null) {
    this.tri(a, b, c, uvs && [uvs[0], uvs[1], uvs[2]], color, flipTo);
    this.tri(a, c, d, uvs && [uvs[0], uvs[2], uvs[3]], color, flipTo);
  }

  // A flat strip along a polyline at height z, between signed lateral offsets left..right
  // (right of travel is positive). uv: "world" tiles in world meters / scale; "along" runs u
  // along the line and v across it.
  ribbon(pts, left, right, z = 0, { uv = "world", scale = 1, color = null, from = 0, to = Infinity } = {}) {
    const n = pts.length;
    if (n < 2) return;
    const segN = [];
    for (let i = 0; i < n - 1; i++) {
      const dx = pts[i + 1][0] - pts[i][0], dy = pts[i + 1][1] - pts[i][1];
      const l = Math.hypot(dx, dy) || 1;
      segN.push([dy / l, -dx / l]);
    }
    const rows = [];
    let s = 0;
    for (let i = 0; i < n; i++) {
      if (i > 0) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      let nx, ny, k = 1;
      if (i === 0) [nx, ny] = segN[0];
      else if (i === n - 1) [nx, ny] = segN[n - 2];
      else {
        const a = segN[i - 1], b = segN[i];
        nx = a[0] + b[0]; ny = a[1] + b[1];
        const l = Math.hypot(nx, ny);
        if (l < 1e-6) [nx, ny] = a;
        else { nx /= l; ny /= l; k = Math.min(2, 1 / Math.max(0.3, a[0] * nx + a[1] * ny)); }
      }
      rows.push({ s, x: pts[i][0], y: pts[i][1], nx: nx * k, ny: ny * k });
    }
    const up = [0, 0, 1];
    const at = (r, lat) => [r.x + r.nx * lat, r.y + r.ny * lat, z];
    const uvOf = (p, r, lat) => (uv === "along" ? [r.s / scale, lat / scale] : [p[0] / scale, p[1] / scale]);
    for (let i = 0; i < n - 1; i++) {
      let r0 = rows[i], r1 = rows[i + 1];
      if (r1.s <= from || r0.s >= to) continue;
      if (r0.s < from) r0 = lerpRow(r0, r1, (from - r0.s) / (r1.s - r0.s));
      if (r1.s > to) r1 = lerpRow(rows[i], r1, (to - rows[i].s) / (r1.s - rows[i].s));
      const a = at(r0, right), b = at(r1, right), c = at(r1, left), d = at(r0, left);
      const uvs = [uvOf(a, r0, right), uvOf(b, r1, right), uvOf(c, r1, left), uvOf(d, r0, left)];
      this.quad(a, b, c, d, uvs, color, up);
    }
  }

  // Filled convex or simple polygon (sim xy) at height z, facing up.
  polygon(pts, z = 0, { scale = 1, color = null } = {}) {
    if (pts.length < 3) return;
    const contour = pts.map(([x, y]) => new THREE.Vector2(x, y));
    const tris = THREE.ShapeUtils.triangulateShape(contour, []);
    for (const [i, j, k] of tris) {
      const a = [...pts[i], z], b = [...pts[j], z], c = [...pts[k], z];
      this.tri(a, b, c, [[a[0] / scale, a[1] / scale], [b[0] / scale, b[1] / scale], [c[0] / scale, c[1] / scale]], color, [0, 0, 1]);
    }
  }

  // A rectangle on the ground centered at (x, y) with the given heading, length along it and width.
  rect(x, y, heading, length, width, z = 0, color = null) {
    const c = Math.cos(heading), s = Math.sin(heading);
    const hl = length / 2, hw = width / 2;
    const p = (a, b) => [x + a * c + b * s, y + a * s - b * c, z];
    this.quad(p(-hl, hw), p(hl, hw), p(hl, -hw), p(-hl, -hw), [[0, 0], [1, 0], [1, 1], [0, 1]], color, [0, 0, 1]);
  }

  toGeometry() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(this.nrm, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2));
    if (this.col) geo.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    geo.computeBoundingSphere();
    return geo;
  }
}

function lerpRow(a, b, t) {
  return { s: a.s + (b.s - a.s) * t, x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, nx: a.nx + (b.nx - a.nx) * t, ny: a.ny + (b.ny - a.ny) * t };
}

export function normalOf(a, b, c) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1;
  return [nx / l, ny / l, nz / l];
}

// Texture coordinates in meters on the face's own plane: u runs horizontally along the face, v up
// its slope. Windows, siding, and shingle rows therefore stay level on every wall and roof.
export function planarUV(p, n) {
  let tx = -n[1], ty = n[0];
  const tl = Math.hypot(tx, ty);
  if (tl < 1e-4) return [p[0], p[1]];  // horizontal face
  tx /= tl; ty /= tl;
  // bitangent = n x t (t has no z component)
  const bx = -n[2] * ty, by = n[2] * tx, bz = n[0] * ty - n[1] * tx;
  return [p[0] * tx + p[1] * ty, p[0] * bx + p[1] * by + p[2] * bz];
}

// Deterministic per-item randomness from a string or number.
export function hash01(key, salt = 0) {
  let h = 2166136261 ^ salt;
  const s = String(key);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 13; h = Math.imul(h, 1274126177); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
