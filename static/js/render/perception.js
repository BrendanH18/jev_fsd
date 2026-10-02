import * as THREE from "three";
import { buildSnapshot } from "../brain/sensors.js";

// A debug view of geometric sensing, not a claim about a camera or learned perception model.
export class PerceptionView {
  constructor(scene) {
    this.group = new THREE.Group(); scene.add(this.group); this.group.visible = false; this.last = -Infinity;
    this.lines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.75, depthWrite: false }));
    this.group.add(this.lines);
    this.bounds = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ vertexColors: true, depthWrite: false }));
    this.group.add(this.bounds);
  }
  setEnabled(on) { this.group.visible = on; this.last = -Infinity; }
  update(world, now, decision) {
    if (!this.group.visible || now - this.last < 250) return null;
    this.last = now;
    const snap = buildSnapshot(world), ego = world.ego, rays = [], rayColors = [], boxes = [], boxColors = [];
    const add = (target, colors, from, to, color) => { target.push(from[0], 0.14, -from[1], to[0], 0.14, -to[1]); colors.push(...color, ...color); };
    for (let i = 0; i < 64; i++) {
      const angle = ego.psi + i / 64 * Math.PI * 2;
      const range = world.visibility.rangeAt(ego, ego.x + Math.cos(angle) * 100, ego.y + Math.sin(angle) * 100);
      let lo = 0, hi = range;
      if (!world.visibility.canSee(ego, ego.x + Math.cos(angle) * range, ego.y + Math.sin(angle) * range)) {
        for (let n = 0; n < 7; n++) { const mid = (lo + hi) / 2;
          if (world.visibility.canSee(ego, ego.x + Math.cos(angle) * mid, ego.y + Math.sin(angle) * mid)) lo = mid; else hi = mid;
        }
      } else lo = range;
      const p = [ego.x + Math.cos(angle) * lo, ego.y + Math.sin(angle) * lo];
      add(rays, rayColors, [ego.x, ego.y], p, [0.18, 0.65, 0.64]);
    }
    const nearby = world.obstaclesNear(ego.x, ego.y, 80);
    let seen = 0, hidden = 0;
    for (const object of nearby) {
      const visible = world.visibility.sees(ego, object); visible ? seen++ : hidden++;
      const b = object.obb(), c = Math.cos(b.heading), s = Math.sin(b.heading);
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => [b.center[0] + c * x * b.halfLength - s * y * b.halfWidth, b.center[1] + s * x * b.halfLength + c * y * b.halfWidth]);
      for (let i = 0; i < 4; i++) add(boxes, boxColors, corners[i], corners[(i + 1) % 4], visible ? [0.34, 0.9, 0.66] : [0.96, 0.39, 0.42]);
    }
    for (const [mesh, vertices, colors] of [[this.lines, rays, rayColors], [this.bounds, boxes, boxColors]]) {
      mesh.geometry.dispose(); mesh.geometry = new THREE.BufferGeometry();
      mesh.geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
      mesh.geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3)); mesh.geometry.computeBoundingSphere();
    }
    const reasons = { collision: "Predicted collision", visibility_stopping_distance: "Beyond stopping sight", passes_cyclist_too_close: "Too close to cyclist",
      off_road: "Leaves the road", runs_red: "Red light", fails_to_yield: "Must yield", runs_stop: "Missed stop", fails_to_yield_to_pedestrian: "Person crossing" };
    return { seen, hidden, range: snap.visibility.range_m, safeSpeed: Math.min(snap.limit, snap.visibility.safe_speed_mps) * 3.6,
      rejected: decision?.candidates?.filter(c => !c.eligible).map(c => ({ id: c.id, reason: reasons[c.reject] || "Safety filter" })) || [] };
  }
}
