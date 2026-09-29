// Geometric perception shared by sensing, prediction and the emergency brake. Map geometry is
// known; moving objects and signal phases are observed only inside weather range and line of sight.
import { current as weather } from "./weather.js";

const CELL = 25;
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];

function inside(p, pts) {
  let yes = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) yes = !yes;
  }
  return yes;
}

function blocks(from, to, pts) {
  if (inside(from, pts) || inside(to, pts)) return true;
  const r = [to[0] - from[0], to[1] - from[1]];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const s = [b[0] - a[0], b[1] - a[1]], w = [a[0] - from[0], a[1] - from[1]];
    const den = cross(r, s);
    if (Math.abs(den) < 1e-9) continue;
    const t = cross(w, s) / den, u = cross(w, r) / den;
    if (t > 1e-6 && t < 1 - 1e-6 && u >= 0 && u <= 1) return true;
  }
  return false;
}

export class Visibility {
  constructor(map) {
    this.grid = new Map();
    for (const { pts, h } of map.pack.buildings || []) {
      if (pts.length < 3 || h < 1.5) continue;
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      for (let x = Math.floor(Math.min(...xs) / CELL); x <= Math.floor(Math.max(...xs) / CELL); x++) {
        for (let y = Math.floor(Math.min(...ys) / CELL); y <= Math.floor(Math.max(...ys) / CELL); y++) {
          const key = `${x},${y}`;
          if (!this.grid.has(key)) this.grid.set(key, []);
          this.grid.get(key).push(pts);
        }
      }
    }
  }

  get range() { return weather.visibility; }

  canSee(observer, x, y) {
    const d = Math.hypot(x - observer.x, y - observer.y);
    if (d > this.range) return false;
    const seen = new Set(), from = [observer.x, observer.y], to = [x, y];
    // Visit the ray's bounded rectangle, including cells the ray only clips at a corner.
    for (let cx = Math.floor(Math.min(observer.x, x) / CELL); cx <= Math.floor(Math.max(observer.x, x) / CELL); cx++) {
      for (let cy = Math.floor(Math.min(observer.y, y) / CELL); cy <= Math.floor(Math.max(observer.y, y) / CELL); cy++) {
        const key = `${cx},${cy}`;
        for (const pts of this.grid.get(key) || []) {
          if (seen.has(pts)) continue;
          seen.add(pts);
          if (blocks(from, to, pts)) return false;
        }
      }
    }
    return true;
  }

  sees(observer, object) {
    const box = object.obb();
    // A visible nose still counts when the center is behind a corner.
    const dx = Math.cos(box.heading) * box.halfLength, dy = Math.sin(box.heading) * box.halfLength;
    return [[0, 0], [dx, dy], [-dx, -dy]].some(([x, y]) => this.canSee(observer, box.center[0] + x, box.center[1] + y));
  }
}
