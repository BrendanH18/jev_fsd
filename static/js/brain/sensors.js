// What the car "senses" each decision: everything below is computed by code from the world and
// handed to the brains. Distances in meters, speeds in m/s, ego frame: ahead (+forward), right (+).

import { CAR } from "../sim/vehicle.js";
import { corridorQuery } from "../sim/collision.js";
import { signalFor } from "../sim/signals.js";
import { wrap } from "../sim/world.js";

export const LOOK_AHEAD_CONTROL_M = 80;
export const TRAFFIC_RADIUS_M = 60;
const FRONT = CAR.length - CAR.rearOverhang;

export function buildSnapshot(world, executing = null) {
  const { ego, map, route } = world;
  const road = world._road || world.roadInfo();
  const snap = {
    t: world.t, tick: world.tick,
    ego: { x: ego.x, y: ego.y, psi: ego.psi, v: ego.v },
    road, route, routeProj: null, onRoute: false, nav: null, intersection: null, following: null,
    rear_follower: null, traffic: [], current_path_hazard: null, stuck: world.stuckFor > 6 ? { for_s: world.stuckFor } : null,
    limit: road.limit || 11.2,
  };
  if (route) {
    const p = route.project(ego.x, ego.y);
    const headingErr = wrap(ego.psi - p.heading);
    snap.routeProj = { s: p.s, lateral: p.lateral, headingErr, distance: p.distance, point: p.point };
    snap.onRoute = p.distance < 25 && Math.abs(headingErr) < Math.PI * 100 / 180;
    const remaining = route.remaining(p.s);
    const turns = route.turnsAfter(p.s);
    const dest = ego.toLocal(route.endPoint()[0], route.endPoint()[1]);
    snap.nav = {
      next_turn: turns.length ? turns[0].dir : "none",
      turn_in_m: turns.length ? turns[0].at_m - p.s : remaining,
      turn_street: turns.length ? turns[0].street : "",
      remaining_m: remaining,
      destination: { right: dest.right, ahead: dest.ahead },
      arrived: remaining < 3.5,
    };
    // next traffic control along the route within LOOK_AHEAD_CONTROL_M of the front bumper
    const frontS = p.s + FRONT;
    for (const c of route.controls) {
      if (c.sRoute + 12 < frontS) continue;          // already through this one
      if (c.sRoute - frontS > LOOK_AHEAD_CONTROL_M) break;
      const bumperToLine = c.sRoute - frontS;
      const control = c.control;
      const signal = control.type === "signal" ? signalFor(map, control, world.t) : null;
      const inter = control.type === "signal" ? map.intersections.get(control.id) : null;
      const junction = inter ? [inter.x, inter.y] : c.junction;
      let crossTraffic = false;
      if (junction) {
        for (const n of world.npcs) {
          if (Math.hypot(n.x - junction[0], n.y - junction[1]) > 20 || Math.abs(n.v) < 0.5) continue;
          const diff = Math.abs(wrap(n.psi - ego.psi));
          if (diff > Math.PI / 6 && diff < Math.PI * 5 / 6) { crossTraffic = true; break; }
        }
      }
      const stopMem = world.egoStop;
      snap.intersection = {
        id: control.id, control: control.type, signal, group: control.group || null,
        bumper_to_line_m: bumperToLine, s_line_route: c.sRoute,
        entered: bumperToLine < 0,
        stop_completed: control.type === "stop" ? (stopMem.controlId === control.id && stopMem.completed) : null,
        all_way: control.type === "stop" ? !!control.all_way : null,
        cross_traffic_moving: crossTraffic,
        seconds_to_green: c.secondsToGreen ? c.secondsToGreen(world.t) : null,
      };
      break;
    }
    // vehicles in the route corridor
    const ahead = corridorQuery(route, p.s + 1, p.s + TRAFFIC_RADIUS_M, 1.7, world.npcs, p.index);
    if (ahead.length) {
      const lead = ahead[0];
      const gap = lead.s - p.s - CAR.length;
      snap.following = { id: lead.vehicle.id, gap_m: gap, speed: lead.vehicle.v, closing_mps: ego.v - lead.vehicle.v, vehicle: lead.vehicle, s: lead.s };
    }
    const behind = corridorQuery(route, p.s - 14, p.s - 1, 1.7, world.npcs, p.index);
    if (behind.length) {
      const b = behind[behind.length - 1];
      snap.rear_follower = { id: b.vehicle.id, gap_m: p.s - b.s - CAR.length, closing_mps: b.vehicle.v - ego.v };
    }
  }
  // nearby traffic in the ego frame
  for (const n of world.npcs) {
    const d = Math.hypot(n.x - ego.x, n.y - ego.y);
    if (d > TRAFFIC_RADIUS_M) continue;
    const local = ego.toLocal(n.x, n.y);
    const rel = wrap(n.psi - ego.psi);
    const absRel = Math.abs(rel);
    const heading = absRel < Math.PI / 6 ? "same" : absRel > Math.PI * 5 / 6 ? "oncoming" : rel > 0 ? "crossing_right_to_left" : "crossing_left_to_right";
    snap.traffic.push({ id: n.id, right: local.right, ahead: local.ahead, speed: n.v, heading, moving: Math.abs(n.v) > 0.5, dist: d, vehicle: n });
  }
  snap.traffic.sort((a, b) => a.dist - b.dist);
  snap.traffic = snap.traffic.slice(0, 8);
  if (executing && executing.hazard) snap.current_path_hazard = executing.hazard;
  return snap;
}

// Hazard flags decide the decision interval.
export function hazardFlags(snap) {
  const f = [];
  if (snap.intersection && snap.intersection.bumper_to_line_m < 60) f.push("intersection");
  if (snap.nav && snap.nav.next_turn !== "none" && snap.nav.turn_in_m < 50) f.push("turn");
  if (snap.following && snap.following.gap_m < 15) f.push("following");
  if (snap.traffic.some((t) => t.ahead > 0 && t.ahead < 25 && Math.abs(t.right) < 8)) f.push("traffic");
  if (snap.routeProj && Math.abs(snap.routeProj.lateral) > 0.8) f.push("lane");
  if (!snap.road.on_road) f.push("off_road");
  if (snap.stuck) f.push("stuck");
  if (snap.current_path_hazard) f.push("hazard");
  if (snap.nav && snap.nav.remaining_m < 30) f.push("arriving");
  return f;
}
