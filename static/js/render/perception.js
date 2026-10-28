import * as THREE from "three";
import { buildSnapshot } from "../brain/sensors.js";
import { isEmergency } from "../sim/emergency.js";
import { busSignalling } from "../sim/bus.js";

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
      const visible = world.sees(ego, object); visible ? seen++ : hidden++;
      const b = object.obb(), c = Math.cos(b.heading), s = Math.sin(b.heading);
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => [b.center[0] + c * x * b.halfLength - s * y * b.halfWidth, b.center[1] + s * x * b.halfLength + c * y * b.halfWidth]);
      // (an emergency vehicle with its siren on is heard whether or not it is seen: magenta)
      // (a bus signalling to pull out from its stop, seen: amber)
      // (a vehicle stopped at a crosswalk that the car must not pass, or a school bus showing its
      // lights: amber too)
      const color = isEmergency(object) ? [1, 0.3, 0.9] : visible && (busSignalling(object) || object.id === snap.crosswalk_stop?.id || object.id === snap.school_bus?.id) ? [1, 0.7, 0.15] : visible ? [0.34, 0.9, 0.66] : [0.96, 0.39, 0.42];
      for (let i = 0; i < 4; i++) add(boxes, boxColors, corners[i], corners[(i + 1) % 4], color);
    }
    for (const [mesh, vertices, colors] of [[this.lines, rays, rayColors], [this.bounds, boxes, boxColors]]) {
      mesh.geometry.dispose(); mesh.geometry = new THREE.BufferGeometry();
      mesh.geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
      mesh.geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3)); mesh.geometry.computeBoundingSphere();
    }
    const reasons = { collision: "Predicted collision", visibility_stopping_distance: "Beyond stopping sight", passes_cyclist_too_close: "Too close to cyclist",
      off_road: "Leaves the road", runs_red: "Red light", fails_to_yield: "Must yield", runs_stop: "Missed stop", fails_to_yield_to_pedestrian: "Person crossing",
      fails_to_yield_to_oncoming: "Oncoming traffic", fails_to_yield_to_cyclist: "Cyclist on the right", fails_to_yield_to_emergency: "Emergency vehicle", fails_to_yield_to_bus: "Bus pulling out", passes_car_stopped_at_crosswalk: "Car stopped at crosswalk", passes_stopped_school_bus: "School bus stopped", enters_unseen_junction: "Cannot see yet",
      passes_turn_round_point: "Turns round here" };
    const e = snap.emergency;
    const emergency = e ? `${e.kind[0].toUpperCase()}${e.kind.slice(1)} ${e.from === "behind" ? "behind" : e.from === "ahead" ? "ahead" : `from the ${e.from}`}, ${Math.round(e.distance_m)} m${e.seen ? "" : ", heard not seen"}: ${e.lead ? "stuck behind the car, driving on ahead" : `pull over ${e.offset_m.toFixed(1)} m, stop in ${Math.max(0, Math.round(e.bumper_to_stop_m))} m${e.clearing ? " past the junction" : ""}`}` : null;
    const b = snap.bus;
    const bus = b ? `Bus${b.ref ? ` ${b.ref}` : ""} ${b.moving_out ? "pulling out" : "signalling to pull out"} ${Math.round(Math.max(0, b.gap_m))} m ahead: stop in ${Math.max(0, Math.round(b.bumper_to_stop_m))} m and let it out` : null;
    const w = snap.crosswalk_stop;
    const crosswalk = w ? `${w.kind[0].toUpperCase()}${w.kind.slice(1)} ${w.stopped ? "stopped" : "stopping"} at a crosswalk in the next lane, ${Math.round(Math.max(0, w.bumper_to_crosswalk_m))} m ahead: stop in ${Math.max(0, Math.round(w.bumper_to_stop_m))} m and look` : null;
    const k = snap.school_bus;
    const school = k ? `School bus ${k.relation === "behind" ? "ahead" : "coming the other way"}, ${Math.round(Math.max(0, k.gap_m))} m: ${k.lights === "red" ? `red lights flashing, stop in ${Math.max(0, Math.round(k.bumper_to_stop_m))} m` : "amber lights, about to stop"}` : null;
    return { seen, hidden, emergency, bus, crosswalk, school, range: snap.visibility.range_m, safeSpeed: Math.min(snap.limit, snap.visibility.safe_speed_mps) * 3.6,
      rejected: decision?.candidates?.filter(c => !c.eligible).map(c => ({ id: c.id, reason: reasons[c.reject] || "Safety filter" })) || [] };
  }
}
