// Hidden traffic: with the World option `hazards`, road vehicles hide other road vehicles and cyclists
// from the driven car, as they already hide pedestrians (sim/crosswalk.js hiddenByTraffic).
//
// Driver's handbooks across Canada warn about the same thing at left turns: a vehicle waiting to turn
// left from the other side of the junction can hide a car coming straight through in the lane beside
// it, so wait until you can see that the lane is clear. Here a vehicle or cyclist is out of the driven
// car's sight when every line from the car to it (its middle, nose and tail, as sim/visibility.js
// sees) passes through the body of another road vehicle: one in traffic (not a cyclist), or one
// standing in the road (a double-parked van, a vehicle stopped at the roadside, a work zone's). Sensing
// is in plan view, so a body hides whatever is behind it, whatever its height. Cars parked in a parking
// lane do not hide traffic (they hide pedestrians: sim/hidden-hazards.js): the car looks from its rear
// axle, and from there a street lined with parked cars would hide all of its traffic.
//
// What the car cannot see along a lane it must give way to (`laneSight`): it looks back along the
// lane from the junction, every SAMPLE_M, as far as it is asked to or can see at all, and the lane is
// in view as far as the first point a vehicle's body hides from it. A vehicle it can see standing in
// the lane (queued at the line, or waiting in the junction to turn) covers the rest: nothing behind it
// can come through before it. One coming along the lane does not: once it has passed, the car must
// see what follows it.
//
// With hazards off (the seeded benchmark and the challenges other than "Between the cars" and "Blind
// left") nothing here is computed.

import { CAR } from "./vehicle.js";
import { segmentHitsBox } from "./crosswalk.js";
import { pointAt, headingAt, projectPoint } from "../map/mapdata.js";

export const SAMPLE_M = 3;
const SAME_WAY = Math.PI / 6;
const IN_LANE_M = 1.6;     // a vehicle this near a lane's line is in it
const STANDING_MPS = 0.5;
const PAST_END_M = 1;      // (lanes end at the junction's centre: one whose front is past it is going through)
const HIDE_RANGE_M = 90;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// Standing in the road rather than parked in a parking lane.
export const standsInRoad = (c) => !!(c.doubleParked || c.roadside || c.workzone);
// What can be hidden: a road vehicle or cyclist moving in traffic (not a train, not anything standing).
export const hideable = (o) => !!o && !o.parked && o.kind !== "pedestrian" && o.kind !== "door" && o.kind !== "train" && typeof o.obb === "function";

// The vehicles whose bodies may hide something on the line from `observer` to (x, y): road vehicles in
// traffic near it (not cyclists, not `skip`) and those standing in the road.
export function blockersNear(world, observer, x, y, skip = null) {
  const x0 = Math.min(observer.x, x), x1 = Math.max(observer.x, x), y0 = Math.min(observer.y, y), y1 = Math.max(observer.y, y);
  const out = [];
  for (const v of world.npcs) {
    if (v === observer || v === skip || v.kind === "bike" || v.kind === "pedestrian" || v.parked) continue;
    const m = Math.max(5, v.spec?.length || 0);
    if (v.x > x0 - m && v.x < x1 + m && v.y > y0 - m && v.y < y1 + m) out.push(v);
  }
  const mx = (observer.x + x) / 2, my = (observer.y + y) / 2;
  for (const c of world.parked.near(mx, my, Math.hypot(x - observer.x, y - observer.y) / 2 + 8)) if (c !== skip && standsInRoad(c)) out.push(c);
  return out;
}

// The first of `bodies` that hides the point (x, y) from `observer`, or null.
function hiderOf(observer, x, y, bodies) {
  for (const v of bodies) if (segmentHitsBox([observer.x, observer.y], [x, y], v.obb())) return v;
  return null;
}

// True when every line from `observer` to vehicle or cyclist `o` passes through another road vehicle.
export function hiddenVehicle(world, observer, o) {
  const d = Math.hypot(o.x - observer.x, o.y - observer.y);
  if (d < 1 || d > HIDE_RANGE_M) return false;
  const box = o.obb();
  const bodies = blockersNear(world, observer, box.center[0], box.center[1], o);
  if (!bodies.length) return false;
  const dx = Math.cos(box.heading) * box.halfLength, dy = Math.sin(box.heading) * box.halfLength;
  return [[0, 0], [dx, dy], [-dx, -dy]].every(([x, y]) => hiderOf(observer, box.center[0] + x, box.center[1] + y, bodies));
}

// Where vehicle `n` is along `lane` (arc length, extended straight on past its end, the junction's
// centre) and how far to one side of its line.
function alongLane(lane, n) {
  const L = lane.cum[lane.cum.length - 1];
  const pr = projectPoint(lane.pts, lane.cum, [n.x, n.y]);
  if (pr.s < L - 0.01) return { s: pr.s, side: Math.abs(pr.lateral), heading: pr.heading };
  const h = headingAt(lane.pts, lane.cum, L), end = lane.pts[lane.pts.length - 1];
  const ex = n.x - end[0], ey = n.y - end[1];
  return { s: L + ex * Math.cos(h) + ey * Math.sin(h), side: Math.abs(ex * Math.sin(h) - ey * Math.cos(h)), heading: h };
}

// The point `back` metres short of the end of `lane`, back along it and straight on past its start.
export function laneBack(lane, back) {
  const L = lane.cum[lane.cum.length - 1];
  if (back <= L) return pointAt(lane.pts, lane.cum, L - back);
  const h = headingAt(lane.pts, lane.cum, 0), p = lane.pts[0], beyond = back - L;
  return [p[0] - Math.cos(h) * beyond, p[1] - Math.sin(h) * beyond];
}

// How far back along `lane` from `from` metres short of its end the driven car can see (see the top):
// null when it sees as far as `far` (or as far as it can see at all, or up to a vehicle it sees coming
// along the lane), otherwise { sight_m, hidden_by, at: [x, y], back }, where `at` is the first point
// it cannot see, `back` metres short of the lane's end.
export function laneSight(world, observer, lane, from, far) {
  const L = lane.cum[lane.cum.length - 1];
  // vehicles it can see standing in the lane, short of the junction's centre
  const covers = [];
  for (const n of world.npcs) {
    if (n === observer || n.kind === "bike" || n.kind === "pedestrian" || Math.abs(n.v) > STANDING_MPS || Math.hypot(n.x - observer.x, n.y - observer.y) > far + 40) continue;
    const a = alongLane(lane, n), front = a ? a.s + (n.spec || CAR).length - (n.spec || CAR).rearOverhang : Infinity;
    if (!a || a.side > IN_LANE_M || front > L + PAST_END_M || Math.abs(wrap(n.psi - a.heading)) > SAME_WAY) continue;
    // (from its front on: anything behind it is covered, as is the lane it stands in)
    if (world.sees(observer, n)) covers.push(Math.max(0, L - front));
  }
  const first = covers.length ? Math.min(...covers) : Infinity;
  let last = from;
  for (let back = from; back <= far; back += SAMPLE_M) {
    if (back >= first) return null;
    const p = laneBack(lane, back);
    if (Math.hypot(p[0] - observer.x, p[1] - observer.y) > world.visibility.rangeAt(observer, ...p)) return null;
    const by = hiderOf(observer, p[0], p[1], blockersNear(world, observer, p[0], p[1]));
    if (by) return { sight_m: Math.max(0, last), hidden_by: by.id, at: p, back };
    last = back;
  }
  return null;
}

// What a vehicle hiding a lane is called, on the HUD and in the AI eyes panel.
const NAMES = { delivery_van: "van", bus: "bus", school_bus: "school bus", streetcar: "streetcar", ambulance: "ambulance", fire_truck: "fire truck", police: "police car", tow_truck: "tow truck", work_zone: "work truck" };
export function hiderName(world, id) {
  const v = world.npcs.find((n) => n.id === id) || world.parked.list.find((c) => c.id === id);
  return v ? NAMES[v.kind || v.spec?.kind] || "car" : "vehicle";
}

// What the HUD says (once each) when a vehicle hides a lane the car must give way to: turning left, the
// oncoming lane; giving way, the street it crosses; turning right on red, the street to its left.
// { key, text, wait } or null.
export function trafficNotice(world, snap) {
  const i = world.hazards ? snap?.intersection : null;
  if (!i) return null;
  const name = (id) => `THE ${hiderName(world, id).toUpperCase()}`;
  if (i.oncoming && i.oncoming.id === null) return { key: `left:${i.id}`, text: `${name(i.oncoming.view.hidden_by)} HIDES THE ONCOMING LANE · WAIT UNTIL YOU CAN SEE`, wait: true };
  const g = i.give_way;
  if (g?.hidden_by && !g.go) return { key: `give:${i.id}`, text: `${name(g.hidden_by)} HIDES THE CROSS STREET · ${g.waiting_to_see ? "WAIT UNTIL YOU CAN SEE" : "CREEP UP AND LOOK"}`, wait: !!g.waiting_to_see };
  const w = i.right_on_red?.wait_for;
  if (w?.hidden_by) return { key: `rtor:${i.id}`, text: `${name(w.hidden_by)} HIDES TRAFFIC FROM THE LEFT · WAIT`, wait: true };
  return null;
}
