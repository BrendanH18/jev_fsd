// Slow down, move over (BC Motor Vehicle Act Regulations s. 47.02): a driver coming up to a vehicle
// stopped at the roadside with its flashing lights on (a police car, an ambulance or fire truck, a tow
// truck, a road crew's or a utility's truck; not a school bus) must slow to 40 km/h where the limit is
// under 80 km/h, or to 70 km/h where it is 80 or more, and, where there is another lane going the same
// way, move out of the lane next to it if that is safe. The people working beside such a vehicle stand
// at the edge of that lane, and step into it.
//
// The sim has two of them, both parked in the parking lane on the right of a street like any parked
// car (sim/parking.js), so traffic, cyclists and the collision checks treat them as one: a tow truck
// (amber lights) with the car it is about to tow parked behind it, and a police car (red and blue)
// behind the car it has pulled over. Neither ever moves off. In a free drive, two of them stand at any
// time, somewhere 150 to 450 m from the car where it cannot see them, each for 2.5 to 6 minutes, and
// then leave once the car is well away (RoadsideStops; `?roadside=0` takes them off).
//
// The rule holds for a driver going the vehicle's way with the vehicle on its right, whose near (left)
// side is within SIDE_M of the driver's line: from APPROACH_M short of its rear until the driver's
// rear is past its front. The lane next to it is the one its near side is within ADJACENT_M of.
// Traffic keeps to the speed; the driven car's sensing reports it (brain/sensors.js), Rules keeps to
// the speed and moves over where it can, and the coaching score counts both (sim/drive-score.js).

import { Vehicle, CAR, TOW_TRUCK, POLICE_CAR } from "./vehicle.js";
import { pointAt, headingAt, projectPoint } from "../map/mapdata.js";
import { rng } from "../common.js";

export const ROADSIDE_SPECS = { tow_truck: TOW_TRUCK, police: POLICE_CAR };
export const ROADSIDE_NAMES = { tow_truck: "tow truck", police: "police car" };
export const ROADSIDE_LIGHTS = { tow_truck: "amber", police: "red and blue" };
export const SLOW_MPS = 40 / 3.6;
export const SLOW_FAST_MPS = 70 / 3.6;
const FAST_LIMIT_MPS = 80 / 3.6 - 0.05;
export const APPROACH_M = 30;
export const SIDE_M = 9;
export const ADJACENT_M = 3;
const SAME_WAY = Math.PI / 6;
// Free drive: how many stand at once, where they turn up, for how long, and how far away the car must
// be before one leaves.
export const ROADSIDE_COUNT = 2;
const SPAWN_M = [150, 450];
const STAY_S = [150, 360];
const LEAVE_M = 150;
const RETRY_S = 5;
const CROSSWALK_CLEAR_M = 15;
// A gap in the next lane, as for a lane change (brain/sensors.js): 6 m between bumpers plus 2 s of
// closing speed to the vehicle ahead, and 2.5 s to the one behind.
const GAP_M = 6, GAP_AHEAD_S = 2, GAP_BEHIND_S = 2.5;
// (and far enough short of the vehicle to get across before it: the sharpest lane change the car makes,
// or 1.5 s at its speed)
const ROOM_AHEAD_M = 12, ROOM_S = 1.5;

export const isRoadside = (v) => !!v && v.roadside === true;
export const flashing = (v) => isRoadside(v) && v.flashing === true;
// The speed a driver keeps to passing one, on a street limited to `limit`: never above the limit.
export const passLimit = (limit) => Math.min(limit, limit >= FAST_LIMIT_MPS ? SLOW_FAST_MPS : SLOW_MPS);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// How far right of the centre line of street `e` a vehicle the size of `spec` stands in its right-hand
// parking lane: in the middle of it, or as far in as it fits, its body 0.15 m from the curb.
export const curbOffset = (e, spec) => e.asphalt[1] - Math.max((e.parking?.[1] || 2.1) / 2 + 0.05, spec.width / 2 + 0.15);

// The rear and front of stopped vehicle `v`, on its centre line.
export function endsOf(v) {
  const s = v.spec, c = Math.cos(v.psi), n = Math.sin(v.psi);
  return { rear: [v.x - c * s.rearOverhang, v.y - n * s.rearOverhang], front: [v.x + c * (s.length - s.rearOverhang), v.y + n * (s.length - s.rearOverhang)] };
}

// How driver `o`, going straight on as it heads, stands to stopped vehicle `v` with its lights
// flashing: { ahead_m (its front to v's rear: negative once beside it), side_m (how far right of its
// centre line v's near side is), holds (the rule holds for it now), adjacent (it is in the lane next
// to v) }, or null when v is not on its right going its way, or it is past v.
export function roadsideRelation(o, v) {
  if (!flashing(v) || o === v || Math.abs(wrap(v.psi - o.psi)) > SAME_WAY) return null;
  const os = o.spec || CAR, { rear, front } = endsOf(v);
  const r = o.toLocal(rear[0], rear[1]), f = o.toLocal(front[0], front[1]);
  const side = Math.min(r.right, f.right) - v.spec.width / 2;
  if (side < 0 || side > SIDE_M || f.ahead + os.rearOverhang < 0) return null;
  const ahead = r.ahead - (os.length - os.rearOverhang);
  return { ahead_m: ahead, side_m: side, holds: ahead <= APPROACH_M, adjacent: side < ADJACENT_M };
}

// Free-drive roadside stops, and the challenge's (`place`). `vehicles`: those with their lights on.
export class RoadsideStops {
  constructor(world, { count = 0, seed = 1 } = {}) {
    this.world = world;
    this.count = count;
    this.random = rng(seed * 49979687 + 13);
    this.stops = [];
    this.vehicles = [];
    this.made = 0;
    this.next = 0;
    for (let i = 0; i < count; i++) this.spawn();
  }

  step(dt) {
    if (!this.count) return;
    const ego = this.world.ego;
    for (const stop of [...this.stops]) {
      stop.left -= dt;
      const v = stop.vehicle;
      if (stop.left <= 0 && Math.hypot(v.x - ego.x, v.y - ego.y) > LEAVE_M && !this.world.sees(ego, v)) this.retire(stop);
    }
    if (this.stops.length < this.count && (this.next -= dt) <= 0) { this.next = RETRY_S; this.spawn(); }
  }

  // Two free bays in a row on the right curb of a street, SPAWN_M from the car and out of its sight,
  // clear of marked crosswalks: whoever is parked there leaves, and a stop takes their place.
  spawn() {
    const world = this.world, map = world.map, ego = world.ego;
    const pairs = this.pairs ||= bayPairs(world);
    if (!pairs.length) return null;
    // (on a street with another lane going its way, half the time, where there is one)
    const multi = pairs.filter((p) => p.edge.lanes > 1);
    const pool = multi.length && this.random() < 0.5 ? multi : pairs;
    for (let attempt = 0; attempt < 20; attempt++) {
      const pair = pool[Math.floor(this.random() * pool.length)];
      const mid = pointAt(pair.edge.pts, pair.edge.cum, (pair.from + pair.to) / 2), d = Math.hypot(mid[0] - ego.x, mid[1] - ego.y);
      if (d < SPAWN_M[0] || d > SPAWN_M[1] || world.visibility.canSee(ego, mid[0], mid[1])) continue;
      if (pair.bays.some((b) => b.reserved || b.occupant?.door)) continue;
      if ((map.crosswalks || []).some((c) => Math.hypot(c.x - mid[0], c.y - mid[1]) < CROSSWALK_CLEAR_M + 7)) continue;
      for (const b of pair.bays) if (b.occupant) world.parked.remove(b.occupant);
      const kind = this.random() < 0.6 ? "tow_truck" : "police";
      const stop = this.place({ edge: pair.edge.id, from: pair.from, to: pair.to, kind });
      stop.bays = pair.bays;
      for (const b of pair.bays) b.reserved = stop.vehicle;
      stop.left = STAY_S[0] + this.random() * (STAY_S[1] - STAY_S[0]);
      return stop;
    }
    return null;
  }

  // A stop on the right curb of edge `edge`, filling [from, to] metres along it: the vehicle with its
  // lights on, and the car with it (a tow truck's in front of the car it tows; a police car behind the
  // one it pulled over). `gap` sets the room between them.
  place({ edge, from, to, kind = "tow_truck", gap = null, color = null }) {
    const world = this.world, e = world.map.edges.get(edge), spec = ROADSIDE_SPECS[kind], n = ++this.made;
    const put = (sRear, vspec) => {
      const lat = curbOffset(e, vspec);
      const at = sRear + vspec.rearOverhang, p = pointAt(e.pts, e.cum, at), h = headingAt(e.pts, e.cum, at);
      return new Vehicle(p[0] + Math.sin(h) * lat, p[1] - Math.cos(h) * lat, h, 0, vspec);
    };
    const room = to - from - spec.length - CAR.length, between = gap ?? Math.max(0.6, room - 0.4);
    const ahead = kind === "tow_truck";
    const sVehicle = ahead ? to - 0.2 - spec.length : from + Math.max(0.2, (room - between) / 2);
    const sCar = ahead ? sVehicle - between - CAR.length : sVehicle + spec.length + between;
    const vehicle = put(sVehicle, spec), car = put(sCar, CAR);
    Object.assign(vehicle, { id: `roadside_${n}`, kind, roadside: true, flashing: true, stay: true, edge, curb: "right", color: kind === "police" ? 0xf4f4f0 : 0xe2a514 });
    Object.assign(car, { id: `roadside_${n}_car`, stay: true, edge, curb: "right", color: color ?? [0x8d9299, 0x2b3a55, 0x9b1e1e, 0xc4c8cc][n % 4], style: n % 8 });
    world.parked.add(car);
    world.parked.add(vehicle);
    const stop = { id: vehicle.id, kind, vehicle, car, left: Infinity, bays: [] };
    this.stops.push(stop);
    this.vehicles.push(vehicle);
    return stop;
  }

  // The one the driven car is passing now (the rule holds for it), on a street limited to `limit`:
  // { vehicle, name, relation, limit (the speed to pass it at), other_lane (there is another lane
  // going the car's way), room (in the lane next to it, far enough short of it, the lane to
  // the car's left has a gap it could move over into, as a lane change needs: see roomLeft) }, or
  // null. Sensing-free, for the coaching score.
  passing(limit) {
    const world = this.world, ego = world.ego;
    for (const v of this.vehicles) {
      if (Math.abs(v.x - ego.x) > 60 || Math.abs(v.y - ego.y) > 60) continue;
      const r = roadsideRelation(ego, v);
      if (!r?.holds) continue;
      const lane = world.map.nearestLane(ego.x, ego.y, ego.psi, 6)?.lane.edgeRef, other = (lane?.lanes || 1) > 1, w = lane?.lane_width || 3.3;
      const room = other && r.adjacent && r.ahead_m >= Math.max(ROOM_AHEAD_M, ROOM_S * Math.max(0, ego.v)) && roomLeft(ego, world.npcs || [], w);
      return { vehicle: v, name: ROADSIDE_NAMES[v.kind], relation: r, limit: passLimit(limit), other_lane: other, room };
    }
    return null;
  }

  retire(stop) {
    this.world.parked.remove(stop.vehicle);
    this.world.parked.remove(stop.car);
    for (const b of stop.bays) if (b.reserved === stop.vehicle) b.reserved = null;
    this.stops.splice(this.stops.indexOf(stop), 1);
    this.vehicles.splice(this.vehicles.indexOf(stop.vehicle), 1);
  }
}

// Whether the lane to the left of driver `o` (`width` wide) has a gap it could change into (see GAP_M):
// nothing going its way beside it, and what is ahead and behind there far enough away.
function roomLeft(o, vehicles, width) {
  const os = o.spec || CAR, v = Math.max(0, o.v);
  for (const n of vehicles) {
    if (n === o || Math.abs(wrap(n.psi - o.psi)) > SAME_WAY || Math.abs(n.x - o.x) > 80 || Math.abs(n.y - o.y) > 80) continue;
    const l = o.toLocal(n.x, n.y), ns = n.spec || CAR;
    if (l.right > -width / 2 || l.right < -width * 1.5) continue;
    const ahead = l.ahead - ns.rearOverhang - (os.length - os.rearOverhang), behind = -l.ahead - (ns.length - ns.rearOverhang) - os.rearOverhang;
    if (ahead > 0 ? ahead < GAP_M + Math.max(0, v - n.v) * GAP_AHEAD_S : behind > 0 ? behind < GAP_M + Math.max(0, n.v - v) * GAP_BEHIND_S : true) return false;
  }
  return true;
}

// Every two bays in a row on the right curb of the same street: { edge, from, to, bays }.
function bayPairs(world) {
  const map = world.map, byEdge = new Map();
  for (const slot of world.parked.slots) {
    const e = map.edges.get(slot.edge);
    if (slot.curb !== "right" || !e || e.ring) continue;
    const s = projectPoint(e.pts, e.cum, [slot.x, slot.y], null).s - CAR.rearOverhang;
    if (!byEdge.has(e.id)) byEdge.set(e.id, []);
    byEdge.get(e.id).push({ slot, s });
  }
  const pairs = [];
  for (const [id, list] of byEdge) {
    list.sort((a, b) => a.s - b.s);
    for (let i = 0; i + 1 < list.length; i++) {
      const a = list[i], b = list[i + 1];
      if (b.s - a.s > 7) continue;
      pairs.push({ edge: map.edges.get(id), from: a.s - 0.95, to: b.s + CAR.length + 0.95, bays: [a.slot, b.slot] });
    }
  }
  return pairs;
}
