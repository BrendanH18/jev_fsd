// Traffic: NPC cars that follow lanes, pick turns at junctions, keep gaps with the Intelligent
// Driver Model, and obey lights and stop signs. They also react to the ego car. Now and then a car
// parked up ahead of the ego signals, waits for a gap, and pulls out into the lane. Buses drive
// their routes and stop at their stops (sim/bus.js), and streetcars theirs, on their tracks; nobody
// passes one with its doors open on the side its riders use (sim/streetcar.js). School buses stop to
// let children off, and everyone stops for them (sim/school-bus.js). Trains run their tracks, off
// the streets, and everyone stops short of a level crossing for one coming, and never on the tracks
// (sim/rail.js). Nobody enters a signalled junction without room past it (sim/junction-box.js). At a
// work zone everyone stops for the flagger's STOP paddle, keeps to 30 km/h, and the direction whose
// lane is closed goes round the work through the other lane (sim/work-zone.js). Behind a van
// double-parked in its lane a driver waits until the oncoming lane is clear, then goes round it through
// that lane (sim/double-parked.js).

import { Vehicle, CAR, BIKE, BUS, SCHOOL_BUS, STREETCAR, HERITAGE_STREETCAR, DELIVERY_VAN, comfort } from "./vehicle.js";
import { detourAt, lookahead, purePursuit, speedControl } from "./controller.js";
import { cumulative, pointAt, headingAt, projectPoint, joinLanes } from "../map/mapdata.js";
import { advanceHolds, approachPhase, movementSignal, StopMemory } from "./signals.js";
import { controlAt } from "./outage.js";
import { rng } from "../common.js";
import { wrap } from "./world.js";
import { obbOverlap } from "./collision.js";
import { ringBusy } from "./roundabout.js";
import { crosswalkConflict, kerbConflict } from "./pedestrians.js";
import { current as weather } from "./weather.js";
import { approachTo, outranks } from "./priority.js";
import { EMERGENCY_SPECS, EV_JUNCTION_MPS, EV_LIMIT_FACTOR, EV_MAX_MPS, EV_PASS_LOOK_M, EV_SQUEEZE_M, EV_SQUEEZE_MPS, EV_STAND_DOWN_S,
  FOLLOW_M, IN_WAY_M, closestOnPath, evOffset, isEmergency, isEmergencyVehicle, isJunction as junctionAt, leadsEmergency, nearestCall, planBehind, planCrossing, planOncoming, pullOverOffset, threadGap } from "./emergency.js";
import { BUS_DWELL_S, BUS_SIGNAL_M, BUS_TAPER_M, busMayPullOut, busStopFront, busYield, canStopFor, curbShift, isBus } from "./bus.js";
import { ZONE_LIMIT_MPS, zoneAt } from "./speed-zones.js";
import { APPROACH_M, passLimit, roadsideRelation } from "./roadside.js";
import { DEPART_S, DOORS_DELAY_S, DWELL_MAX_S, DWELL_S, RIDER_EVERY_S, RIDERS_OFF, RIDERS_ON, canStopFor as canStopForStreetcar, doorsOpen, isStreetcar, streetcarHold } from "./streetcar.js";
import { AWAY_S, canStopFor as canStopForTrain, crossingHold, isTrain, railIndex, stepTrain, trainState } from "./rail.js";
import { boxHold } from "./junction-box.js";
import { WZ_LIMIT_MPS, canStopFor as canStopForFlagger, detourOf, marksOn, paddle, stopKey } from "./work-zone.js";
import { DECIDE_M, PASS_DECEL, PASS_MPS, VAN_LOOK_M, queuedAhead, wayRound } from "./double-parked.js";
import { AMBER_M, KID_CROSS_P, KID_EVERY_S, KIDS, LEAVE_S, RED_MAX_S, RED_S, STOP_EVERY_M, canStopFor as canStopForSchool, firstStop, isSchoolBus, redsOn, schoolBusHold, stopRange } from "./school-bus.js";

const IDM = { aMax: 1.5, b: 2.0, s0: 2.0, T: 1.2 };
// Behind a double-parked van, a driver more than this past where it would wait is too close to pull out
// round it (sim/double-parked.js).
const WAIT_SLACK_M = 1.5;
const UNSIGNED_NEAR_M = 15;
// A driver too close to its line to stop there when the lights at its signal go out (within
// DARK_CAUGHT_S of it) goes on through, for DARK_GO_S.
const DARK_CAUGHT_S = 0.5, DARK_GO_S = 10;

// Seeded per-driver IDM and lane-change temperament so adding NPCs does not shift spawn points.
function driverProfile(random, bike = false) {
  const r = random();
  const assertive = r < 0.2, timid = r > 0.85;
  const pick = (lo, hi) => lo + random() * (hi - lo);
  return {
    aMax: bike ? pick(0.7, 1.1) : assertive ? pick(1.8, 2.4) : timid ? pick(1.0, 1.3) : pick(1.3, 1.8),
    b: assertive ? pick(2.4, 3.0) : timid ? pick(1.5, 1.9) : pick(1.8, 2.4),
    T: assertive ? pick(0.8, 1.05) : timid ? pick(1.5, 2.0) : pick(1.05, 1.5),
    s0: assertive ? pick(1.5, 2.0) : pick(2.0, 3.0),
    react: pick(0.4, 1.1) + (timid ? 0.4 : 0),
    lcRate: assertive ? 2.5 : timid ? 0.3 : 1,
  };
}
// Real-world paint mix: mostly white, grey, silver, and black, some blue and red.
const PALETTE = [0xeeeeea, 0x8d9299, 0x1a1c20, 0xc4c8cc, 0x2b3a55, 0x9b1e1e, 0xf2f2ee, 0x4a4f57, 0x0f1114, 0x6b7f5e, 0xb9b3a5];
const LOOK_M = 60;
const ZONE_AHEAD_M = 15;
const ROADSIDE_AHEAD_M = 40;
// A work zone on a driver's street (sim/work-zone.js) counts from this far before its stop line; it
// slows to the zone's limit by 5 m short of the line, braking at no more than WZ_DECEL.
const WZ_LOOK_M = 120;
const WZ_DECEL = 1.5;
export const BIKES = 12;
const BIKE_COLORS = [0x2b6cb0, 0xc53030, 0x2f855a, 0xd69e2e, 0x553c9a, 0x1a202c, 0xdd6b20];
const SHARP_TURN = 130 * Math.PI / 180;   // mirrors SHARP_TURN_DEG in jev/routing.py
const LINK_M = 20;   // a street this short going straight on is a link inside a junction
const BOX_M = 9;
const LEADER_MARGIN_M = 0.3;    // beyond two half-widths: anything closer to the path is in the way
// Turning right on red (where the map allows it), from the curb lane after a full stop: the gap a
// driver accepts is this much longer than at a stop sign, since the car pulls away from rest into
// traffic that has a green; nobody may be about to step onto a crosswalk it crosses within 4 s.
const RTOR_EXTRA_GAP_S = 1.5;
const RTOR_WALK_S = 4;
// Giving way at a junction without a sign or signal: from this far before its node, a driver gives
// way to traffic with the right of way due there before it, or up to 2 s after it, within 8 s.
const GIVE_WAY_LOOK_M = 40;
const GIVE_WAY_AFTER_S = 2;
const GIVE_WAY_HORIZON_S = 8;
// Cyclists keep right. A street's parking lane at least 1.5 m wide is ridden where nothing is parked
// in it: the rider's centre 0.75 m into it, and at least 2.6 m right of the traffic lane's centre (a
// metre and a quarter clear of a 2 m wide car in the middle of the lane). Parking stops short of
// every corner, so riders come up beside cars waiting or turning there. A rider takes the parking
// lane when it is empty to the end of the block and carries on past the junction, or for at least
// 60 m mid-block; it moves back into the traffic lane 20 m plus 2 s before the next parked car (on
// the next block, once it is crossing the junction), or before a junction where it turns left or the next
// street has no parking lane. It moves across at up to 0.8 m/s, and 0.3 m/s for every 1 m/s it
// rides plus 0.1 m/s (a bicycle moves sideways only as it rolls forward), and back into the lane
// only with no car beside it in the lane or closing from behind (4 m plus 2.5 s of closing speed);
// until then it waits 6 m behind the parked car, room to pull out round it from rest. Stopped within 6 m
// of something, a rider shuffles the bicycle sideways at 0.3 m/s, and round toward its way at 0.5 rad/s,
// into free space.
const STRIP_MIN_M = 1.5;
const STRIP_INSET_M = 0.75;
const STRIP_SIDE_M = 2.6;
const STRIP_ENTER_M = 60;
const STRIP_LEAVE_M = 20;
const STRIP_LEAVE_S = 2;
const SIDE_MPS = 0.8;
const SIDE_PER_MPS = 0.3;
const STRIP_HOLD_M = 6;
const SHUFFLE_GAP_M = 6;
const SHUFFLE_MPS = 0.3;
const SHUFFLE_TURN = 0.5;
const MERGE_GAP_M = 4;
const MERGE_GAP_S = 2.5;
// Turning right, from 50 m before the junction, a driver waits short of the corner for a cyclist on
// its right (clear of its line, so not one following it, and within 6 m of it, on its street) going
// its way that would reach the corner before the car is round it
// (its front at the junction's centre plus the car's length, at its speed but no faster than the 6 m/s
// it slows to for the turn, and no slower than 2.5 m/s) plus 1.5 s.
const HOOK_LOOK_M = 50;
const HOOK_SIDE_M = 6;
const HOOK_MARGIN_S = 1.5;
const HOOK_TURN_MPS = 6;
const BODY_LOOK_M = 8;
const BODY_AHEAD_M = 2;
// Giving way to an emergency vehicle (sim/emergency.js): a driver eases over at up to 0.8 m/s and
// stops within its stopping distance braking at 1.5 m/s^2 (3.5 m/s^2 for one coming toward it or
// across its way; at least 4 m on), short of the next junction
// (2.5 m short of its crossing street) if it can stop there braking at up to 3.5 m/s^2, else just
// past it, its rear clear. It carries on 1.5 s after the vehicle no longer calls on it.
const EV_SHIFT_MPS = 0.8;
const EV_STOP_DECEL = 1.5;
const EV_FIRM_DECEL = 3.5;
const EV_RELEASE_S = 1.5;
const EV_CROSSING_M = 1.5;
const EV_BODY_LOOK_M = 4;   // an emergency vehicle passes something moving across its way at least this far off
// Emergency vehicles in free drives: the first 60 to 120 s in, then one every 2.5 to 5 minutes;
// one leaves once it is more than 220 m from the car, or after 4 minutes.
const EV_FIRST_S = [60, 120];
const EV_EVERY_S = [150, 300];
const EV_GONE_M = 220;
const EV_MAX_AGE_S = 240;
// Buses in free drives (sim/bus.js): up to 4 at a time on their routes, placed at least 60 m from
// the car to begin with and then, once one has finished its run more than 150 m from the car, another
// 15 to 45 s later at least 150 m away. A bus eases in to the curb and back out at up to 0.7 m/s,
// and 0.25 m/s for every 1 m/s it drives plus 0.05 m/s.
const MAX_BUSES = 4;
const BUS_START_M = 60;
const BUS_LATER_M = 150;
const BUS_GONE_M = 150;
const BUS_EVERY_S = [15, 45];
const BUS_SHIFT_MPS = 0.7;
const BUS_SHIFT_PER_MPS = 0.25;
const BUS_COLORS = [0xf4f4f0];
const BUS_BODY_LOOK_M = 6;
// Passing a bus standing at its stop, pulled in toward the curb, a driver eases left in its lane at
// 0.5 m/s, from 40 m before it, as far as it must to clear it by the usual margin (LEADER_MARGIN_M)
// if its lane leaves room for that 0.1 m inside its left edge; else it waits behind.
const NUDGE_MPS = 0.5;
const NUDGE_LOOK_M = 40;
// School buses in free drives (sim/school-bus.js): `schoolBuses` at a time, placed 80 to 250 m from
// the car to begin with; one more than 400 m from it, driving on, leaves, and another is placed 120
// to 250 m from the car 30 to 60 s later. One slows to its stops at up to 1.2 m/s^2.
const SCHOOL_START_M = [80, 250];
const SCHOOL_LATER_M = [120, 250];
const SCHOOL_GONE_M = 400;
const SCHOOL_EVERY_S = [30, 60];
const SCHOOL_DECEL = 1.2;
const SCHOOL_COLOR = 0xf7b500;
// Streetcars in free drives (sim/streetcar.js): up to 2 at a time on their routes' runs, placed and
// replaced as buses are. One slows to its stops at up to 1.1 m/s^2.
const MAX_STREETCARS = 2;
const STREETCAR_COLOR = 0xc8102e;
const STREETCAR_DECEL = 1.1;
// Trains in free drives (sim/rail.js): one at a time on a map with a track, placed somewhere along it
// at the start, and brought back from the edge of the map AWAY_S after it runs off it.
const MAX_TRAINS = 1;
const TRAIN_COLOR = 0x7a1d1d;
// (a bus, school bus, streetcar or train: long, so looked for all along its body)
const isLong = (o) => isBus(o) || isSchoolBus(o) || isStreetcar(o) || isTrain(o);

// How far ahead of a cyclist's front wheel any part of another vehicle's body is in its way, or
// null: within its own body (and 0.05 m) moving straight on as it is heading for the next 2 m, or
// within half its width plus 0.1 m of the next 8 m of its path, where it is `from` metres right of
// its path now and heads for `side` metres right of it over those 8 m.
function bodyOnPath(n, o, front, from, side) {
  const b = o.obb(), c = Math.cos(b.heading), s = Math.sin(b.heading), m = n.spec.width / 2 + 0.1;
  const own = n.obb(), ux = Math.cos(n.psi), uy = Math.sin(n.psi);
  for (let d = 0; d <= BODY_AHEAD_M; d += 0.25) if (obbOverlap({ ...own, center: [own.center[0] + ux * d, own.center[1] + uy * d] }, b, 0.05)) return d;
  for (let d = 0; d <= BODY_LOOK_M; d += 0.5) {
    const [x, y] = n.path.offsetPointAt(Math.min(n.path.length, front + d), from + (side - from) * d / BODY_LOOK_M);
    const dx = x - b.center[0], dy = y - b.center[1];
    if (Math.abs(dx * c + dy * s) <= b.halfLength + m && Math.abs(dy * c - dx * s) <= b.halfWidth + m) return d;
  }
  return null;
}

// How far right of a lane's centre a cyclist rides in the street's parking lane, or null when the
// lane is not beside the right curb or has no parking lane wide enough.
export function stripOffset(e, laneIdx) {
  if (!e || e.ring || !e.parking || laneIdx !== e.lanes - 1) return null;
  const edge = e.lane_offsets[laneIdx] + e.lane_width / 2, room = e.asphalt[1] - edge;
  if (room < STRIP_MIN_M) return null;
  return Math.min(e.lane_width / 2 + room - BIKE.width / 2 - 0.3, Math.max(e.lane_width / 2 + STRIP_INSET_M, STRIP_SIDE_M));
}

export class NpcPath {
  // A path is a chain of lane polylines; we keep the current lane and the next one joined.
  constructor(map, random, { bike = false } = {}) { this.map = map; this.random = random; this.bike = bike; this.edges = []; this.pts = []; this.cum = [0]; this.length = 0; }
  start(edgeId, laneIdx, s, planned = []) {
    this.edges = [];
    this.pts = []; this.cum = [0]; this.length = 0;
    this.append(edgeId, laneIdx);
    for (const [id, lane] of planned) this.append(id, lane);
    this.s = s;
    this.extend();
  }
  // Move onto another lane of the current edge, keeping the edges already planned after it. Their
  // lanes follow from the new one, as when they were planned: carrying on straight in the lane it
  // had planned would take the car back across, in the junction.
  switchLane(laneIdx, s) {
    const i = this.edges.indexOf(this.currentEdge());
    const cur = this.edges[i];
    let prev = { id: cur.id, lane: laneIdx };
    const planned = this.edges.slice(i + 1).map((e) => (prev = { id: e.id, lane: this.laneInto(prev.id, prev.lane, e.id) }));
    this.start(cur.id, laneIdx, s, planned.map((e) => [e.id, e.lane]));
  }
  // The lane taken onto edge `next` from lane `lane` of edge `from`: turns into the nearest lane (left
  // turns into the leftmost, right into the rightmost), going straight keeps the same lane, and a
  // cyclist rides the curb lane.
  laneInto(from, lane, next) {
    const edge = this.map.edges.get(next), turn = this.map.classifyTurn(this.map.turnAngle(from, next));
    return this.bike ? edge.lanes - 1 : turn === "left" ? 0 : turn === "right" ? edge.lanes - 1 : Math.min(lane, edge.lanes - 1);
  }
  append(edgeId, laneIdx) {
    const lane = this.map.lane(edgeId, laneIdx) || this.map.lane(edgeId, 0);
    this.pts = joinLanes(this.pts, lane.pts);
    this.cum = cumulative(this.pts);
    this.length = this.cum[this.cum.length - 1];
    const edge = this.map.edges.get(edgeId);
    const sStart = this.edges.length ? this.edges[this.edges.length - 1].sEnd : 0;
    this.edges.push({ id: edgeId, lane: laneIdx, sStart, sEnd: this.length, control: edge.control || null, to: edge.to, limit: edge.limit });
  }
  extend() {
    // bounded: joining a very short lane after a rounded corner can add almost no length
    for (let guard = 0; guard < 24 && this.length - this.s < LOOK_M * 2.5; guard++) {
      const last = this.edges[this.edges.length - 1];
      const succ = this.map.successors(last.id);
      if (!succ.length) return false;
      // no U-turns, nor turns so sharp they double back (the tip of a traffic island)
      const noU = succ.filter((e) => Math.abs(this.map.turnAngle(last.id, e)) < SHARP_TURN);
      let pool = noU.length ? noU : succ;
      // cyclists keep to bike routes where they can
      if (this.bike) {
        const routes = pool.filter((id) => this.map.edges.get(id).bike);
        if (routes.length && this.random() < 0.85) pool = routes;
      }
      const next = pool[Math.floor(this.random() * pool.length)];
      this.append(next, this.laneInto(last.id, last.lane, next));
    }
    return true;
  }
  trim() {
    // drop edges fully behind us to keep the polyline short
    while (this.edges.length > 2 && this.edges[1].sStart + 30 < this.s) {
      const drop = this.edges.shift();
      const cut = this.cum.findIndex((c) => c >= drop.sEnd);
      if (cut <= 0) break;
      const removed = this.cum[cut];
      this.pts = this.pts.slice(cut);
      this.cum = cumulative(this.pts);
      this.length = this.cum[this.cum.length - 1];
      this.s -= removed;
      for (const e of this.edges) { e.sStart -= removed; e.sEnd -= removed; }
    }
  }
  currentEdge() { return this.edges.find((e) => this.s < e.sEnd) || this.edges[this.edges.length - 1]; }
  offsetPointAt(s, d) {
    const p = pointAt(this.pts, this.cum, s), h = headingAt(this.pts, this.cum, s);
    return [p[0] + Math.sin(h) * d, p[1] - Math.cos(h) * d];
  }
  pointAt(s) { return pointAt(this.pts, this.cum, s); }
  headingAt(s) { return headingAt(this.pts, this.cum, s); }
}

const smooth = (u) => { const x = Math.max(0, Math.min(1, u)); return x * x * (3 - 2 * x); };

// Fastest speed from which a driver can brake comfortably to every bend's cornering speed over the
// next 40 m of the path. NPCs corner a little harder than the ego's comfort target.
function curveSpeed(path, s) {
  const { lat, decel } = comfort();
  let best = Infinity;
  for (let d = 0; d <= 40 && s + d < path.length; d += 3) {
    const at = s + d;
    const dh = Math.abs(wrap(path.headingAt(Math.min(path.length, at + 6)) - path.headingAt(Math.max(0, at - 6))));
    if (dh < 0.02) continue;
    const vc = Math.sqrt(lat * 1.25 * 12 / dh);
    best = Math.min(best, Math.sqrt(vc * vc + 2 * decel * d));
  }
  return best;
}

// The speed a driver keeps to going round a double-parked van (sim/double-parked.js): PASS_MPS from
// where it would wait behind it until it is back in its lane past it, and short of that, the speed
// from which it slows to that by then braking at PASS_DECEL.
function vanLimit(dp, front) {
  if (front > dp.to + 2) return Infinity;
  return Math.sqrt(PASS_MPS * PASS_MPS + 2 * PASS_DECEL * Math.max(0, dp.wait - front));
}

// The speed a driver keeps to at a work zone (sim/work-zone.js): its limit from 5 m short of the stop
// line to the end of the one-lane section, and short of that, the speed from which it slows to that
// by then braking at WZ_DECEL.
function workZoneLimit(wz, front) {
  if (front > wz.to + 2) return Infinity;
  return Math.sqrt(WZ_LIMIT_MPS * WZ_LIMIT_MPS + 2 * WZ_DECEL * Math.max(0, wz.line - 5 - front));
}

export class NpcFleet {
  constructor(world, { count = 40, bikes = BIKES, seed = 7, emergency = false, buses = false, streetcars = false, trains = false, schoolBuses = 0 } = {}) {
    this.world = world;
    this.map = world.map;
    this.random = rng(seed);
    this.drivers = rng(seed * 7919 + 3);
    this.events = rng(seed * 104729 + 17);
    this.nextPull = 10 + this.events() * 12;
    this.pulled = 0;
    this.parkingEvents = rng(seed * 65537 + 31);
    this.nextPark = 12 + this.parkingEvents() * 15;
    this.target = count;
    // (their own stream, so dispatching them leaves the rest of the traffic as it was)
    this.emergency = emergency;
    this.sirens = rng(seed * 92821 + 7);
    this.nextEmergency = EV_FIRST_S[0] + this.sirens() * (EV_FIRST_S[1] - EV_FIRST_S[0]);
    this.dispatched = 0;
    this.evs = [];
    // (buses have their own stream too)
    this.transit = rng(seed * 15485863 + 11);
    this.busCount = 0;
    this.buses = [];
    this.vehicles = [];
    this.spawn(count);
    this.spawnBikes(bikes);
    this.busTarget = buses ? Math.min(MAX_BUSES, this.busRuns().length) : 0;
    for (let i = 0; i < this.busTarget; i++) this.spawnBus(BUS_START_M);
    this.nextBus = world.t + BUS_EVERY_S[0];
    this.buses = this.vehicles.filter(isBus);
    // (streetcars too)
    this.trams = rng(seed * 49979687 + 13);
    this.streetcarCount = 0;
    this.streetcarTarget = streetcars ? Math.min(MAX_STREETCARS, this.busRuns(true).length) : 0;
    for (let i = 0; i < this.streetcarTarget; i++) this.spawnBus(BUS_START_M, null, null, true);
    this.nextStreetcar = world.t + BUS_EVERY_S[0];
    this.streetcars = this.vehicles.filter(isStreetcar);
    // (and school buses theirs)
    this.school = rng(seed * 32452843 + 5);
    this.schoolCount = 0;
    this.schoolTarget = schoolBuses;
    this.schoolStops = new Map();
    for (let i = 0; i < schoolBuses; i++) this.spawnSchoolBus(SCHOOL_START_M);
    this.nextSchool = world.t + SCHOOL_EVERY_S[0];
    this.schoolBuses = this.vehicles.filter(isSchoolBus);
    // (and trains, on their tracks)
    this.rails = rng(seed * 86028121 + 19);
    this.trainCount = 0;
    this.crossings = railIndex(this.map).crossings.length > 0;
    this.trainTarget = trains ? Math.min(MAX_TRAINS, railIndex(this.map).tracks.size) : 0;
    for (let i = 0; i < this.trainTarget; i++) this.spawnTrain(true);
    this.nextTrain = world.t + AWAY_S[0];
    this.trains = this.vehicles.filter(isTrain);
    world.npcs = this.vehicles;
  }

  // Put a train on a track of the map (sim/rail.js): `anywhere`, somewhere along it going either way,
  // at least 150 m from the car; else coming onto the map from an end where its track leaves it.
  // Returns it, or null.
  spawnTrain(anywhere = false, track = null, front = null, dir = null) {
    const tracks = [...railIndex(this.map).tracks.values()], ego = this.world.ego, random = this.rails;
    for (let attempt = 0; tracks.length && attempt < 12; attempt++) {
      const t = track || tracks[Math.floor(random() * tracks.length)];
      let d = dir, f = front;
      if (f === null) {
        if (anywhere) { d = random() < 0.5 ? 1 : -1; f = 30 + random() * (t.length - 60); }
        else {
          const edges = [0, 1].filter((k) => t.ends[k] === "edge");
          if (!edges.length) return null;
          const k = edges[Math.floor(random() * edges.length)];
          d = k === 0 ? 1 : -1; f = k === 0 ? 1 : t.length - 1;
        }
      }
      const n = Object.assign(new Vehicle(0, 0, 0, 0, HERITAGE_STREETCAR), { id: `train_${++this.trainCount}`, kind: "train", color: TRAIN_COLOR,
        name: t.name || "", frozen: 0, waiting: 0 }, trainState(t, f, d, anywhere ? 0 : 6));
      stepTrain(n, t, 0, [], () => false, random);
      if (anywhere && Math.hypot(n.x - ego.x, n.y - ego.y) < 150 && front === null) { this.trainCount--; continue; }
      this.vehicles.push(n);
      this.trains = this.vehicles.filter(isTrain);
      return n;
    }
    return null;
  }

  // Trains: take off one that has run off the map, and send another back after a while.
  manageTrains() {
    for (const n of this.vehicles.filter((v) => isTrain(v) && v.rail.gone)) {
      this.vehicles.splice(this.vehicles.indexOf(n), 1);
      this.nextTrain = Math.max(this.nextTrain, this.world.t + AWAY_S[0] + this.rails() * (AWAY_S[1] - AWAY_S[0]));
    }
    if (this.vehicles.filter(isTrain).length < this.trainTarget && this.world.t >= this.nextTrain) {
      if (!this.spawnTrain()) this.nextTrain = this.world.t + 30;
    }
    this.trains = this.vehicles.filter(isTrain);
  }

  // Place a school bus in the curb lane of a street `away[0]` to `away[1]` metres from the car, clear
  // of other traffic (sim/school-bus.js). Returns it, or null.
  spawnSchoolBus(away = SCHOOL_LATER_M) {
    const map = this.map, ego = this.world.ego;
    const lanes = this.schoolLanes ||= map.laneList.filter((l) => l.length > 40 && !l.edgeRef.ring && l.idx === l.edgeRef.lanes - 1);
    const total = lanes.reduce((a, l) => a + l.length, 0);
    for (let attempt = 0; lanes.length && attempt < 40; attempt++) {
      let pick = this.school() * total, lane = lanes[0];
      for (const l of lanes) { pick -= l.length; if (pick <= 0) { lane = l; break; } }
      const s = 5 + this.school() * (lane.length - 10), p = pointAt(lane.pts, lane.cum, s), d = Math.hypot(p[0] - ego.x, p[1] - ego.y);
      if (d < away[0] || d > away[1] || this.vehicles.some((v) => Math.hypot(v.x - p[0], v.y - p[1]) < SCHOOL_BUS.length + 6) || this.world.workZones?.covers(p[0], p[1]) || this.world.doubleParked?.covers(p[0], p[1])) continue;
      // (partway to its next stop already)
      const bus = this.addSchoolBus(lane, s, Math.min(8, lane.edgeRef.limit * 0.6));
      bus.school.odo = this.school() * bus.school.every;
      return bus;
    }
    return null;
  }

  // A school bus on `lane`, its rear axle `s` along it, at `v`, driving on as traffic.
  addSchoolBus(lane, s, v = 0, planned = []) {
    const p = pointAt(lane.pts, lane.cum, s), bus = new Vehicle(p[0], p[1], headingAt(lane.pts, lane.cum, s), v, SCHOOL_BUS);
    Object.assign(bus, { id: `school_bus_${++this.schoolCount}`, kind: "school_bus", color: SCHOOL_COLOR, v0: 14,
      driver: { aMax: 1.0, b: 1.8, T: 1.6, s0: 3.0, react: 0.9, lcRate: 0 }, stopMem: new StopMemory(), frozen: 0, waiting: 0 });
    bus.path = new NpcPath(this.map, this.school);
    bus.path.start(lane.edge, lane.idx, s, planned);
    bus.school = { phase: "drive", lights: null, arm: false, doors: false, stop: null, t: 0, red: 0, held: false, odo: 0, every: this.schoolEvery(), stops: 0, toDrop: 0, dropAt: 0 };
    this.vehicles.push(bus);
    this.schoolBuses = this.vehicles.filter(isSchoolBus);
    return bus;
  }

  schoolEvery() { return STOP_EVERY_M[0] + this.school() * (STOP_EVERY_M[1] - STOP_EVERY_M[0]); }

  // Every run of every bus route on the map (`tram`: of every streetcar route): [{ route, run }].
  busRuns(tram = false) {
    const key = tram ? "_tramRuns" : "_busRuns";
    if (!this[key]) this[key] = (this.map.transit?.routes || []).filter((route) => (route.mode === "tram") === tram)
      .flatMap((route) => route.runs.filter((run) => run.edges.every((id) => this.map.edges.has(id))).map((run) => ({ route, run })));
    return this[key];
  }

  // Place a bus on a run of its route (`pick`, by default one at random, longer runs more often) at
  // `sRun` metres along it (by default somewhere in its first 80%), at least `away` metres from the
  // car and clear of other traffic. Returns the bus, or null. (`tram`: a streetcar, on a run of a
  // streetcar route, in the lane its track is laid in.)
  spawnBus(away = BUS_LATER_M, pick = null, sRun = null, tram = false) {
    const runs = this.busRuns(tram), map = this.map, ego = this.world.ego, spec = tram ? STREETCAR : BUS, random = tram ? this.trams : this.transit;
    if (!runs.length) return null;
    const total = runs.reduce((a, r) => a + r.run.length, 0);
    for (let attempt = 0; attempt < 12; attempt++) {
      let choice = pick;
      if (!choice) {
        let at = random() * total;
        choice = runs.find((r) => (at -= r.run.length) <= 0) || runs.at(-1);
      }
      const { route, run } = choice;
      let along = sRun ?? random() * run.length * 0.8, k = 0;
      while (k < run.edges.length - 1 && along > map.edges.get(run.edges[k]).length) along -= map.edges.get(run.edges[k++]).length;
      const e = map.edges.get(run.edges[k]), lane = map.lane(e.id, tram ? Math.min(run.lane ?? 0, e.lanes - 1) : e.lanes - 1);
      if (!lane) continue;
      const s = Math.max(1, Math.min(lane.length - 1, along * lane.length / Math.max(1, e.length)));
      const p = pointAt(lane.pts, lane.cum, s);
      if (Math.hypot(p[0] - ego.x, p[1] - ego.y) < away) { if (pick) return null; continue; }
      if (this.vehicles.some((v) => Math.hypot(v.x - p[0], v.y - p[1]) < spec.length + 4)) { if (pick) return null; continue; }
      const v = new Vehicle(p[0], p[1], headingAt(lane.pts, lane.cum, s), Math.min(8, e.limit * 0.6), spec);
      Object.assign(v, { id: tram ? `streetcar_${++this.streetcarCount}` : `bus_${++this.busCount}`, kind: spec.kind, color: tram ? STREETCAR_COLOR : BUS_COLORS[0], ref: route.ref, headsign: route.name,
        v0: 15, driver: { aMax: tram ? 1.1 : 1.0, b: 1.8, T: 1.6, s0: 3.0, react: 0.9, lcRate: 0 }, stopMem: new StopMemory(), frozen: 0, waiting: 0 });
      v.path = new NpcPath(map, random);
      this.startRun(v, run.edges, k, lane.idx, s, tram);
      // the route's stops still ahead, as where its front stops along each street (see busStopFront)
      const firstAt = run.edges.slice(0, k).reduce((a, id) => a + map.edges.get(id).length, 0) + s * e.length / Math.max(1, lane.length);
      let at = 0;
      const stops = [];
      run.edges.forEach((id, i) => {
        for (const st of run.stops.filter((x) => x.edge === id)) {
          const front = busStopFront(map, id, st.s, spec.length);
          if (front !== null && at + front > firstAt + spec.length + 20) stops.push({ id: st.id, edge: id, k: i, front });
        }
        at += map.edges.get(id).length;
      });
      v.transit = { route: route.id, ref: route.ref, edges: run.edges, k, stops, next: 0, phase: "drive", shift: 0, curb: 0, t: 0, dwell: 0, departures: 0, doors: false, done: false, limit: e.limit, laneWidth: e.lane_width,
        ...(tram ? { tram: true, lane: lane.idx, off: 0, on: 0, riderAt: 0 } : {}) };
      this.vehicles.push(v);
      this.buses = this.vehicles.filter(isBus);
      this.streetcars = this.vehicles.filter(isStreetcar);
      return v;
    }
    return null;
  }

  // Start a bus's path on edge `edges[k]` (lane `lane`, `s` along it) with the rest of its run planned.
  // (`fixed`: a streetcar's, in that lane all the way, along its track.)
  startRun(n, edges, k, lane, s, fixed = false) {
    let prev = { id: edges[k], lane };
    const planned = edges.slice(k + 1).map((id) => { prev = { id, lane: fixed ? Math.min(lane, this.map.edges.get(id).lanes - 1) : n.path.laneInto(prev.id, prev.lane, id) }; return [id, prev.lane]; });
    n.path.start(edges[k], lane, s, planned);
  }

  // Cyclists start on bike routes, in the curb lane, riding its right-hand side.
  spawnBikes(count) {
    const lanes = this.map.laneList.filter((l) => l.length > 25 && l.edgeRef.bike && l.idx === l.edgeRef.lanes - 1 && !l.edgeRef.ring);
    if (!lanes.length) return;
    const totalLen = lanes.reduce((a, l) => a + l.length, 0);
    let made = 0, attempts = 0;
    while (made < count && attempts++ < count * 20) {
      let pick = this.random() * totalLen;
      let lane = lanes[0];
      for (const l of lanes) { pick -= l.length; if (pick <= 0) { lane = l; break; } }
      const s = 5 + this.random() * (lane.length - 10);
      const p = pointAt(lane.pts, lane.cum, s);
      if (Math.hypot(p[0] - this.world.ego.x, p[1] - this.world.ego.y) < 30) continue;
      if (this.vehicles.some((v) => Math.hypot(v.x - p[0], v.y - p[1]) < 10)) continue;
      const v = new Vehicle(p[0], p[1], headingAt(lane.pts, lane.cum, s), 0, BIKE);
      v.id = `bike_${++made}`;
      v.kind = "bike";
      v.color = BIKE_COLORS[made % BIKE_COLORS.length];
      v.path = new NpcPath(this.map, this.random, { bike: true });
      v.path.start(lane.edge, lane.idx, s);
      v.v0 = 4.2 + this.random() * 2.3;
      v.driver = driverProfile(this.drivers, true);
      v.stopMem = new StopMemory();
      v.frozen = 0;
      v.waiting = 0;
      this.vehicles.push(v);
    }
  }

  spawn(count) {
    const lanes = this.map.laneList.filter((l) => l.length > 25);
    const totalLen = lanes.reduce((a, l) => a + l.length, 0);
    let attempts = 0;
    while (this.vehicles.length < count && attempts++ < count * 20) {
      let pick = this.random() * totalLen;
      let lane = lanes[0];
      for (const l of lanes) { pick -= l.length; if (pick <= 0) { lane = l; break; } }
      const s = 5 + this.random() * (lane.length - 10);
      const p = pointAt(lane.pts, lane.cum, s);
      if (Math.hypot(p[0] - this.world.ego.x, p[1] - this.world.ego.y) < 30) continue;
      if (this.vehicles.some((v) => Math.hypot(v.x - p[0], v.y - p[1]) < 14)) continue;
      const v = new Vehicle(p[0], p[1], headingAt(lane.pts, lane.cum, s), 0);
      v.id = `car_${this.vehicles.length + 1}`;
      v.color = PALETTE[this.vehicles.length % PALETTE.length];
      v.path = new NpcPath(this.map, this.random);
      v.path.start(lane.edge, lane.idx, s);
      v.v0 = lane.edgeRef.limit * (0.85 + this.random() * 0.2);
      v.driver = driverProfile(this.drivers);
      v.stopMem = new StopMemory();
      v.frozen = 0;
      v.waiting = 0;
      this.vehicles.push(v);
    }
  }

  step(dt) {
    const world = this.world;
    this.nextPull -= dt;
    if (this.nextPull <= 0) { this.nextPull = 14 + this.events() * 18; this.maybePullOut(); }
    this.nextPark -= dt;
    if (this.nextPark <= 0) { this.nextPark = 15 + this.parkingEvents() * 20; this.maybePark(); }
    if (this.emergency) {
      this.nextEmergency -= dt;
      // (one at a time, stood down or not)
      if (this.nextEmergency <= 0 && !this.vehicles.some(isEmergencyVehicle)) {
        this.nextEmergency = EV_EVERY_S[0] + this.sirens() * (EV_EVERY_S[1] - EV_EVERY_S[0]);
        this.dispatchEmergency();
      }
    }
    this.retireEmergency();
    this.evs = this.vehicles.filter(isEmergency);
    if (this.buses.length || this.busTarget) this.manageBuses();
    if (this.streetcars.length || this.streetcarTarget) this.manageBuses(true);
    if (this.schoolBuses.length || this.schoolTarget) this.manageSchoolBuses();
    if (this.trains.length || this.trainTarget) this.manageTrains();
    if (world.doubleParked?.vans.length) this.driveOffVans();
    const all = [world.ego, ...this.vehicles];
    for (const n of [...this.vehicles]) {
      if (n.frozen > 0) { n.frozen -= dt; n.v = 0; continue; }
      // a train on its track (sim/rail.js), braking for anything in its way that it can see
      if (isTrain(n)) {
        stepTrain(n, railIndex(this.map).tracks.get(n.rail.track), dt, [...all, ...world.crowd.list], (cab, o) => world.visibility.sees(cab, o), this.rails);
        continue;
      }
      if (isEmergencyVehicle(n)) { this.emergencyStep(n, dt, all); continue; }
      if (n.pull && n.pull.wait > 0) {
        n.signal = n.pull.lat > 0 ? "left" : "right";
        if (this.pullClear(n)) n.pull.wait -= dt;
        n.v = 0;
        continue;
      }
      // Still at the curb (a parked car close in front, or the driver slow to move off): look again
      // until the car is actually moving, and go back to waiting if someone is coming now.
      if (n.pull && !n.pull.moving) {
        if (n.v > 0.3) n.pull.moving = true;
        else if (!this.pullClear(n)) { n.pull.t = 0; n.pull.wait = 0.5; n.v = 0; continue; }
      }
      if (n.parking) { this.parkStep(n, dt); continue; }
      if (n.backoff) { this.backOff(n, dt); continue; }
      if (n.holdFor > 0) { n.holdFor -= dt; n.step(dt, { steer: n.delta, accel: -3 }); if (n.v < 0) n.v = 0; continue; }
      const path = n.path;
      if (n.lc && n.lc.t >= n.lc.T) {
        const lane = this.map.lane(n.lc.edge, n.lc.to);
        if (lane && path.currentEdge().id === n.lc.edge) path.switchLane(n.lc.to, projectPoint(lane.pts, lane.cum, [n.x, n.y], null).s);
        n.lc = null;
        n.lcCooldown = 6;
      }
      let proj = projectPoint(path.pts, path.cum, [n.x, n.y], null);
      path.s = proj.s;
      if (proj.distance > 6) { this.recoverPath(n); proj = projectPoint(path.pts, path.cum, [n.x, n.y], null); path.s = proj.s; }
      path.extend();
      path.trim();
      const edge = path.currentEdge();
      const spec = n.spec;
      const front = path.s + (spec.length - spec.rearOverhang);
      // lane change in progress: the lateral offset eases over the maneuver, then the path moves
      // onto the new lane
      // an emergency vehicle calling on this driver to give way (none while still at the curb)
      const call = this.evs.length && !n.pull ? nearestCall(n, this.evs) : null;
      if (call) {
        if (n.yieldEv?.ev !== call.ev) n.yieldEv = { ev: call.ev, stop: null, lead: false, clear: 0, toward: call.relation !== "behind" };
        n.yieldEv.clear = 0;
        // stuck behind it, unable to get past: drive on ahead of it
        if (leadsEmergency(call.ev, n)) n.yieldEv.lead = true;
      } else if (n.yieldEv && (n.yieldEv.clear += dt) > EV_RELEASE_S) n.yieldEv = null;
      const yielding = n.yieldEv && !n.yieldEv.lead ? n.yieldEv : null;
      if (n.lc) {
        n.lc.t += dt;
        if (n.lc.edge !== edge.id) n.lc = null;   // ran out of edge: the next junction's join takes over
      } else {
        n.lcCooldown = Math.max(0, (n.lcCooldown || 0) - dt);
        // (a bus moves across to the curb lane for its next stop, and otherwise changes lanes only
        // for a turn)
        // (a streetcar, on its track, never changes lanes)
        if (n.transit?.tram) { /* on its track */ }
        else if (n.transit && !n.yieldEv) { if (n.transit.phase === "drive") this.maybeChangeLane(n, edge, front, this.busStopSoon(n, front)); }
        else if (!n.yieldEv) this.maybeChangeLane(n, edge, front);
        else if (yielding && n.kind !== "bike") this.maybeChangeLane(n, edge, front, true);
      }
      // a bus pulling in to its stop, waiting there and pulling out again (sim/bus.js)
      // (a streetcar stopping at its stops in its lane, its doors open while its riders get on and off)
      const stand = n.transit ? (n.transit.tram ? this.streetcarPlan(n, front, dt) : this.busPlan(n, edge, front, dt, proj.lateral)) : null;
      // a school bus slowing to a stop, standing there with its reds flashing, and moving off
      const schoolStop = n.school ? this.schoolPlan(n, front, dt) : null;
      // a cyclist rides the right-hand side of the lane, clear of the car doors, or the empty parking
      // lane beside it: `keepRight` is where it is heading, `n.side` where it is now
      const keepRight = n.kind === "bike" ? this.curbside(n, edge, front, dt) : 0;
      // pulling over for an emergency vehicle (a cyclist already keeps right)
      const pullTo = yielding && n.kind !== "bike" && !n.transit?.tram ? this.pullOverTo(n, edge, front) : 0;
      n.evShift = (n.evShift || 0) + Math.max(-EV_SHIFT_MPS * dt, Math.min(EV_SHIFT_MPS * dt, pullTo - (n.evShift || 0)));
      // easing left in its lane to pass a bus standing at its stop (see busNudge)
      if (this.buses.length && n.kind !== "bike" && !n.transit) {
        const to = this.busNudge(n, edge);
        n.nudge = (n.nudge || 0) + Math.max(-NUDGE_MPS * dt, Math.min(NUDGE_MPS * dt, to - (n.nudge || 0)));
      }
      // a work zone on its street: round the closed stretch through the other lane, aiming where the
      // detour will be at its pursuit point
      const wz = this.workZoneAhead(n, path, front);
      const wzShift = wz?.detour ? detourAt(wz.detour, path.s + lookahead(n.v)) : 0;
      // a van double-parked in its lane ahead: wait behind it, and round it through the oncoming
      // lane once the way is clear (a cyclist riding the empty parking lane goes by it on the right)
      const dp = world.doubleParked?.vans.length && !(n.kind === "bike" && n.side > 1.2) ? this.vanAhead(n, path, front, all) : null;
      if (!dp && n.vanGo) n.vanGo = null;
      const dpShift = dp?.go ? detourAt(dp.detour, path.s + lookahead(n.v)) : 0;
      let offset = (n.kind === "bike" ? n.side : keepRight) + n.evShift + (n.transit ? n.transit.shift : 0) + (n.nudge || 0) + (n.lc ? n.lc.dir * n.lc.width * smooth(n.lc.t / n.lc.T) : 0) + wzShift + dpShift;
      // The merge eases the path out to the lane, which also frees a car boxed in by the one parked
      // in front. It ends only once the car is moving, so a car still at the curb keeps signalling
      // and checking for a gap.
      if (n.pull) {
        n.pull.t += dt;
        offset += n.pull.lat * (1 - smooth(n.pull.t / n.pull.T));
        if (n.pull.t >= n.pull.T && n.pull.moving) n.pull = null;
      }

      // Leader: nearest vehicle ahead on our path within LOOK_M (parked cars only when they
      // stick into the lane).
      let gap = Infinity, leadV = n.v0, leader = null;
      for (const o of all.concat(world.parked.near(n.x, n.y, LOOK_M), world.parked.doorsNear(n.x, n.y, LOOK_M))) {
        if (o === n) continue;
        if (Math.abs(o.x - n.x) > LOOK_M + 5 || Math.abs(o.y - n.y) > LOOK_M + 5) continue;
        // (going round a work zone's closed stretch, not up to it)
        if (wz?.detour && o === wz.zone.closure) continue;
        // (nor round a double-parked van)
        if (dp?.go && o === dp.van) continue;
        const os = o.spec || CAR, reach = (spec.width + os.width) / 2 + LEADER_MARGIN_M;
        // in the way on the current lane, or on the target lane of a lane change: closer to the
        // path than the two half-widths plus a margin
        // (easing past a bus at its stop, `nudge`, the line it keeps to moves over with it; going
        // round a work zone, the line it will keep to where `o` is)
        const inWay = (lat, at) => {
          if (wz?.detour) lat -= detourAt(wz.detour, at) - wzShift;
          // (round a double-parked van, only the line it keeps to moves over: what is at the curb stays there)
          const round = dp?.go ? lat - (detourAt(dp.detour, at) - dpShift) : lat;
          return Math.abs(round - offset) <= reach || (n.lc && Math.abs(lat - n.lc.dir * n.lc.width) <= reach) || Math.abs(lat - keepRight - (n.nudge || 0) - (dp?.go ? dpShift : 0)) <= reach;
        };
        const p = projectPoint(path.pts, path.cum, [o.x, o.y], null);
        if (p && p.s > path.s + 0.5 && p.s <= path.s + LOOK_M && inWay(p.lateral, p.s)) {
          // rear axle to rear axle, less our axle-to-front-bumper and its rear overhang
          const g = p.s - path.s - (spec.length - spec.rearOverhang) - os.rearOverhang;
          if (g < gap) { gap = g; leadV = o.v; leader = o; }
        }
        // a bus is in the way wherever along its body it crosses the path: its middle and front are
        // looked for too
        if (isLong(o)) for (const d of [os.length / 2 - os.rearOverhang, os.length - os.rearOverhang - 1]) {
          const q = projectPoint(path.pts, path.cum, [o.x + Math.cos(o.psi) * d, o.y + Math.sin(o.psi) * d], null);
          if (!q || q.s <= path.s + 0.5 || q.s > path.s + LOOK_M || !inWay(q.lateral, q.s)) continue;
          const g = q.s - path.s - (spec.length - spec.rearOverhang) - os.width / 2;
          if (g < gap) { gap = g; leadV = o.v * Math.cos(o.psi - n.psi); leader = o; }
        }
      }
      // a cyclist also stops for any part of a body across its way just ahead (a car turning across
      // it, say), not only for one whose middle is in its path, along the way it will actually ride:
      // moving across, it lags the line it steers for
      if (n.kind === "bike") {
        for (const o of all.concat(world.parked.near(n.x, n.y, BODY_LOOK_M + 6), world.parked.doorsNear(n.x, n.y, BODY_LOOK_M + 6))) {
          if (o === n || Math.abs(o.x - n.x) > BODY_LOOK_M + 6 || Math.abs(o.y - n.y) > BODY_LOOK_M + 6) continue;
          const g = bodyOnPath(n, o, front, proj.lateral, offset);
          if (g !== null && g < gap) { gap = g; leadV = Math.max(0, o.v * Math.cos(o.psi - n.psi)); leader = o; }
        }
      }
      // a bus, long and slow to stop, also stops for any part of a body in its way over the next few
      // metres (a car turning or crossing in front of it), its own body laid along its path there
      // (a school bus, not for anything already beside it, short of its front: a cyclist that stopped
      // by its side as it turned would wait for it in turn)
      if (n.transit || n.school) {
        const body = n.obb(), reach = spec.length + BUS_BODY_LOOK_M + 6, nose = spec.length - spec.rearOverhang - 1;
        const close = all.concat(world.parked.near(n.x, n.y, reach)).filter((o) => o !== n && Math.abs(o.x - n.x) < reach && Math.abs(o.y - n.y) < reach && !obbOverlap(body, o.obb(), 0.05)
          && !(n.school && n.toLocal(o.x, o.y).ahead < nose));
        for (let d = 0.5; close.length && d <= BUS_BODY_LOOK_M && d < gap; d += 0.5) {
          const mid = Math.min(path.length, path.s + spec.length / 2 - spec.rearOverhang + d), [x, y] = path.offsetPointAt(mid, offset);
          const hit = close.find((o) => obbOverlap({ ...body, center: [x, y], heading: path.headingAt(mid) }, o.obb(), 0.05));
          if (hit) { gap = d - 0.5; leadV = Math.max(0, hit.v * Math.cos(hit.psi - n.psi)); leader = hit; break; }
        }
      }
      n.lead = gap < Infinity ? { gap, v: leadV } : null;
      let stopAt = null;
      for (const e of path.edges) {
        if (!e.control || e.sEnd < path.s) continue;
        // (a signal whose lights are out is an all-way stop: sim/outage.js)
        const ctl = controlAt(world, e.control, e.id);
        const lineS = e.sStart + (ctl.s_line / Math.max(1, this.map.edges.get(e.id).length)) * (e.sEnd - e.sStart);
        const bumperToLine = lineS - front;
        if (bumperToLine < -1) continue;
        if (bumperToLine > 70) break;
        if (ctl.type === "signal") {
          // (the light for the way it goes: under a left arrow, only a left turn has a green)
          const after = path.edges[path.edges.indexOf(e) + 1];
          const st = movementSignal(approachPhase(this.map.intersections.get(e.control.id), e.id, world.t), after ? this.map.classifyTurn(this.map.turnAngle(e.id, after.id)) : "straight");
          const canStop = bumperToLine > n.v * n.v / (2 * Math.min(4, comfort().hardDecel)) + 1;
          if (st === "red" && this.rightOnRed(n, e, bumperToLine, front, dt)) stopAt = null;
          else if (st === "red" || (st === "yellow" && canStop)) stopAt = bumperToLine;
        } else if (ctl.type === "yield") {
          // roundabout entry: wait at the line while someone in the ring would arrive first
          if (bumperToLine < 12 && ringBusy(this.map.roundabouts.get(ctl.roundabout), this.map.nodes.get(e.to), all, n)) stopAt = bumperToLine;
        } else {
          const state = n.stopMem.update(ctl, bumperToLine, n.v, dt);
          const next = path.edges[path.edges.indexOf(e) + 1];
          // (a signal's lights going out with the driver too close to its line to stop there: it
          // goes on through, as on a yellow)
          if (ctl.dark && state === "approaching" && world.t - world.outages.since(ctl.junction) < DARK_CAUGHT_S && bumperToLine < n.v * n.v / (2 * Math.min(4, comfort().hardDecel)) + 1) n.darkGo = { edge: e.id, t: world.t };
          if (ctl.dark && n.darkGo?.edge === e.id && world.t - n.darkGo.t < DARK_GO_S) break;
          if (ctl.all_way) world.allWay.note(n, ctl, e.id, next ? this.map.classifyTurn(this.map.turnAngle(e.id, next.id)) : "straight", bumperToLine, n.v, world);
          if (state !== "completed") stopAt = bumperToLine;
          // stopped: go when the junction is clear and, at a two-way stop, when nothing on the
          // through road would get there first; at an all-way stop, when it is its turn, and nothing
          // coming in on a street without a sign there (which does not stop) would get there first
          else if (this.boxBusy(n, e) || (ctl.all_way ? world.allWay.status(n, world)?.go === false || this.unsignedComing(n, e.id) : this.crossComing(n, e.to))) stopAt = Math.max(0, bumperToLine);
        }
        break;
      }
      const cw = crosswalkConflict(path.pts, path.cum, front - 2, front + 35, world.crowd, spec.width / 2 + 0.9 + (n.kind === "bike" ? Math.abs(n.side) : 0));
      if (cw) stopAt = stopAt === null ? cw.s - front - 2 : Math.min(stopAt, cw.s - front - 2);
      // a cyclist that cannot move back into the lane yet waits where the parking lane ends
      if (n.kind === "bike" && n.stripHold != null) stopAt = stopAt === null ? n.stripHold - front : Math.min(stopAt, n.stripHold - front);
      // giving way to an emergency vehicle: stop where it chose to when the call came
      if (yielding) { const at = this.yieldStop(n, yielding, front); stopAt = stopAt === null ? at : Math.min(stopAt, at); }
      if (stopAt !== null && stopAt < gap) { gap = Math.max(0.05, stopAt); leadV = 0; }
      // an emergency vehicle ahead going its way, within FOLLOW_M: hang back from it as from a car
      // FOLLOW_M nearer
      const evAhead = this.evs.length ? this.emergencyAhead(n, path, front) : null;
      if (evAhead && evAhead.gap - FOLLOW_M < gap) { gap = Math.max(0.05, evAhead.gap - FOLLOW_M); leadV = evAhead.v; }
      const ji = path.edges.findIndex((e) => e.sEnd > front);
      const cur = path.edges[ji], after = path.edges[ji + 1];
      const toNode = cur ? cur.sEnd - front : Infinity;
      const turn = after ? this.map.classifyTurn(this.map.turnAngle(cur.id, after.id)) : "straight";
      n.signal = n.pull ? (n.pull.lat > 0 ? "left" : "right") : n.lc ? (n.lc.dir < 0 ? "left" : "right") : toNode < 35 && (turn === "left" || turn === "right") ? turn : null;
      if (stand && stand.signal !== undefined) n.signal = stand.signal;
      // turning left: yield to oncoming traffic before crossing its lane
      if (stopAt === null && turn === "left" && toNode > 3 && toNode < 25 && this.oncoming(n, cur.to)) {
        gap = Math.min(gap, Math.max(0.05, toNode - 5)); leadV = 0;
      }
      // turning right: wait short of the corner for a cyclist coming up on the right, unless the car
      // can no longer stop before it
      if (n.kind !== "bike" && turn === "right" && toNode < HOOK_LOOK_M) {
        const half = this.map.crossingHalfWidth(cur.id), hold = toNode - half - 1;
        if (hold > n.v * n.v / (2 * comfort().decel) - 0.5 && this.cyclistOnRight(n, cur.to, toNode, half)) { gap = Math.min(gap, Math.max(0.05, hold)); leadV = 0; }
      }
      // junction with no sign or signal ahead: yield to anyone already crossing it, and give way
      // at the line to traffic with the right of way (sim/priority.js) that would get there first
      if (stopAt === null) {
        const next = path.edges.find((e) => e.sEnd > front);
        const toNode = next ? next.sEnd - front : Infinity;
        // (and, coming in on a street without a sign to an all-way stop, to one pulling away from its line)
        if (next && !next.control && toNode > 5 && toNode < 25 && this.isJunction(next.to) && (this.boxBusy(n, next) || this.allWayLeaving(n, next.to))) {
          gap = Math.min(gap, Math.max(0.05, toNode - 6)); leadV = 0;
        }
        const rule = next && !next.control ? this.map.priorityOf(next.id) : null;
        if (rule && rule.rule !== "major" && toNode < GIVE_WAY_LOOK_M) {
          const toLine = next.sStart + (rule.s_line / Math.max(1, this.map.edges.get(next.id).length)) * (next.sEnd - next.sStart) - front;
          if (toLine > -1 && this.givesWay(n, next.id, toNode)) { gap = Math.min(gap, Math.max(0.05, toLine)); leadV = 0; }
        }
      }
      // intersection box rule for signals too: don't enter while a crossing car is inside
      if (stopAt === null && edge.control && controlAt(world, edge.control, edge.id).type === "signal") {
        const lineS = edge.sStart + (edge.control.s_line / Math.max(1, this.map.edges.get(edge.id).length)) * (edge.sEnd - edge.sStart);
        const b = lineS - front;
        if (b > -1 && b < 6 && this.boxBusy(n, edge)) { gap = Math.min(gap, Math.max(0.05, b)); leadV = 0; }
      }
      // nose to nose with someone stopped in our path who is waiting for us in turn (a car turning
      // across our lane, say): after a few seconds, back up and let them through
      if (leader && !leader.parked && n.v < 0.2 && gap < 5 && Math.abs(leader.v) < 0.3 && Math.abs(wrap(leader.psi - n.psi)) > 2.2) {
        n.standoff = (n.standoff || 0) + dt;
        if (n.standoff > 3) { n.standoff = 0; n.backoff = { left: 6, t: 0 }; }
      } else n.standoff = 0;
      // After ~15 s stopped at a clear control with no vehicle blocking, abandon the virtual leader.
      if (n.v < 0.2 && gap < 3) n.waiting += dt; else n.waiting = 0;
      if (n.waiting > 15 && stopAt !== null && stopAt < 1 && leadV === 0 && !this.blockedByVehicle(n) && !(cur && this.crossComing(n, cur.to))) { gap = Infinity; leadV = n.v0; n.waiting = 0; }
      // a bus at its stop, or pulling in to it; or, behind a bus signalling to pull out from its stop,
      // letting it out (sim/bus.js): after the checks above, which still hold on the way there (a
      // junction before the stop), and not a line the wait at which is ever given up
      const forBus = this.buses.length && n.kind !== "bike" && !n.transit && !isEmergencyVehicle(n) ? this.yieldToBus(n) : null;
      const busStop = Math.min(stand?.stopAt ?? Infinity, forBus ?? Infinity);
      if (busStop < gap) { gap = Math.max(0.05, busStop); leadV = 0; }
      // a school bus at its stop, or stopping for a school bus with its reds flashing (sim/school-bus.js)
      const forSchool = this.schoolBuses.length && !isEmergencyVehicle(n) ? this.yieldToSchoolBus(n, front) : null;
      const schoolAt = Math.min(schoolStop ?? Infinity, forSchool ?? Infinity);
      if (schoolAt < gap) { gap = Math.max(0.05, schoolAt); leadV = 0; }
      // not passing a streetcar with its doors open on the side its riders use (sim/streetcar.js)
      const forStreetcar = this.streetcars.length && !isEmergencyVehicle(n) && !n.transit?.tram ? this.yieldToStreetcar(n, front) : null;
      if (forStreetcar !== null && forStreetcar < gap) { gap = Math.max(0.05, forStreetcar); leadV = 0; }
      // at a level crossing: short of the tracks for a train coming, or for a queue backed up past them
      // (sim/rail.js; an emergency vehicle only for the train)
      const forRail = this.crossings ? this.yieldAtCrossing(n, front, all) : null;
      if (forRail !== null && forRail < gap) { gap = Math.max(0.05, forRail); leadV = 0; }
      // at a signal: at the line, while traffic past the junction leaves no room to clear it
      // (sim/junction-box.js; not a cyclist)
      const forBox = boxHold(this.map, n, front, all);
      if (forBox !== null && forBox < gap) { gap = Math.max(0.05, forBox); leadV = 0; }
      // at a work zone: at the line while its flagger shows STOP, once it could stop there
      // (sim/work-zone.js)
      const forFlagger = wz ? this.flaggerHold(n, wz, front) : null;
      if (forFlagger !== null && forFlagger < gap) { gap = Math.max(0.05, forFlagger); leadV = 0; }
      // behind a double-parked van while the way round is not clear: where it waits, back far enough
      // to pull out round it (sim/double-parked.js)
      if (dp && !dp.go && dp.wait - front > -1 && dp.wait - front < gap) { gap = Math.max(0.05, dp.wait - front); leadV = 0; }

      // curvature-limited desired speed: slow in time for every bend in the next 40 m
      const vCurve = curveSpeed(path, path.s);
      const limit = Math.min(edge.limit, this.zoneLimit(path, front), n.kind === "bike" ? Infinity : this.roadsideLimit(n, edge.limit), wz ? workZoneLimit(wz, front) : Infinity, dp ? vanLimit(dp, front) : Infinity);
      const v0 = Math.min(n.v0 * weather.speed, limit * (n.transit || n.school ? 0.95 : 1.05) * weather.speed, vCurve, n.pull ? 5 : Infinity);
      const D = n.driver || IDM;
      let a;
      if (gap === Infinity) a = D.aMax * (1 - Math.pow(n.v / v0, 4));
      else {
        const dv = n.v - leadV;
        // on a slippery road drivers leave more room and brake more gently
        const grip = Math.min(1, comfort().decel / 2.5);
        const b = D.b * grip, T = D.T / Math.max(0.5, grip);
        const sStar = D.s0 + Math.max(0, n.v * T + n.v * dv / (2 * Math.sqrt(D.aMax * b)));
        a = D.aMax * (1 - Math.pow(n.v / v0, 4) - Math.pow(sStar / Math.max(gap, 0.1), 2));
      }
      a = Math.max(-Math.min(6, comfort().hardDecel * 1.1), Math.min(D.aMax, a));
      // standing still, a driver takes a moment to notice the way is clear and move off
      if (n.v < 0.3 && a > 0.2) { n.ready = (n.ready || 0) + dt; if (n.ready < (D.react || 0)) a = -1; }
      else if (n.v > 1) n.ready = 0;
      if (n.v < 0.05 && a < 0) a = -1;   // stopped: hold the brakes rather than creep
      // wedged at an angle to its lane (a turn taken wide, then blocked): rebase its path
      if (n.waiting > 10 && Math.abs(wrap(n.psi - path.headingAt(path.s))) > 0.35) { this.recoverPath(n); continue; }
      // stopped close behind something it is moving out round, a cyclist puts a foot down and
      // shuffles the bicycle across rather than rolling forward into it
      if (n.kind === "bike" && n.v < 0.3 && gap < SHUFFLE_GAP_M) {
        const turn = wrap(path.headingAt(path.s) - n.psi);
        if (Math.abs(offset - proj.lateral) > 0.05 || Math.abs(turn) > 0.02) this.shuffle(n, offset - proj.lateral, turn, dt);
      }
      const steer = purePursuit(n, path, path.s, offset);
      n.step(dt, { steer, accel: a });
      if (n.v < 0) n.v = 0;
    }
  }

  // Send an emergency vehicle past the driven car (sim/emergency.js): up behind it along its street,
  // toward it down the street, or across the junction ahead of it, whichever the streets allow (in
  // a random order, or `relation`). Returns the vehicle, or null.
  dispatchEmergency({ relation = null, kind = null, distance = null } = {}) {
    const ego = this.world.ego, map = this.map;
    const plans = { behind: planBehind, ahead: planOncoming, crossing: planCrossing };
    const order = relation ? [relation] : Object.keys(plans);
    for (let i = order.length - 1; i > 0 && !relation; i--) { const j = Math.floor(this.sirens() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    for (const rel of order) {
      const plan = plans[rel](map, ego.x, ego.y, ego.psi, ...(distance ? [distance] : []));
      const lane = plan && (map.lane(plan.edge, plan.lane) || map.lane(plan.edge, 0));
      if (!lane) continue;
      const k = kind || (this.sirens() < 0.7 ? "ambulance" : "fire_truck"), spec = EMERGENCY_SPECS[k];
      const p = pointAt(lane.pts, lane.cum, plan.s), psi = headingAt(lane.pts, lane.cum, plan.s);
      const side = evOffset(lane.edgeRef, lane.idx, spec);
      const x = p[0] + Math.sin(psi) * side, y = p[1] - Math.cos(psi) * side;
      // (not on top of anything)
      if ([ego, ...this.vehicles].some((o) => Math.hypot(o.x - x, o.y - y) < spec.length + 2)) continue;
      const v = new Vehicle(x, y, psi, Math.min(10, lane.edgeRef.limit), spec);
      Object.assign(v, { id: `${k}_${++this.dispatched}`, kind: k, siren: true, color: k === "ambulance" ? 0xf2f2ee : 0xb3121b, side, age: 0, relation: plan.relation,
        v0: Math.min(EV_MAX_MPS, lane.edgeRef.limit * EV_LIMIT_FACTOR), driver: { aMax: spec.maxAccel * 0.85, b: 3.0, s0: 3.0, T: 0.9, react: 0.3, lcRate: 0 },
        stopMem: new StopMemory(), frozen: 0, waiting: 0, blockedBy: null, blockedFor: 0 });
      v.path = new NpcPath(map, this.sirens);
      v.path.start(lane.edge, lane.idx, plan.s, plan.planned);
      this.vehicles.push(v);
      this.evs = this.vehicles.filter(isEmergency);
      return v;
    }
    return null;
  }

  // An emergency vehicle leaves once well away from the car, at the end of its streets, or after
  // EV_MAX_AGE_S.
  retireEmergency() {
    const ego = this.world.ego;
    for (const n of this.vehicles.filter(isEmergencyVehicle)) {
      const far = Math.hypot(n.x - ego.x, n.y - ego.y) > EV_GONE_M;
      if ((far && n.age > 10) || n.age > EV_MAX_AGE_S || (n.path.length - n.path.s < 8 && n.v < 0.5)) this.vehicles.splice(this.vehicles.indexOf(n), 1);
    }
  }

  // One step of an emergency vehicle: lights and siren on, along the middle of the road, slowing
  // through junctions where it has no right of way and squeezing past vehicles pulled over.
  emergencyStep(n, dt, all) {
    const world = this.world, map = this.map, path = n.path, spec = n.spec;
    n.age += dt;
    let proj = projectPoint(path.pts, path.cum, [n.x, n.y], null);
    path.s = proj.s;
    if (proj.distance > 8) { this.recoverPath(n); proj = projectPoint(path.pts, path.cum, [n.x, n.y], null); path.s = proj.s; }
    path.extend();
    path.trim();
    const pe = path.currentEdge(), e = map.edges.get(pe.id);
    const front = path.s + (spec.length - spec.rearOverhang);
    const near = all.concat(world.parked.near(n.x, n.y, LOOK_M), world.parked.doorsNear(n.x, n.y, LOOK_M)).filter((o) => o !== n && Math.abs(o.x - n.x) <= LOOK_M + 5 && Math.abs(o.y - n.y) <= LOOK_M + 5)
      // (only along the stretch of its path from beside it to LOOK_M ahead: a path that doubles back,
      // at a dead end, passes the same place again further on)
      .map((o) => ({ o, p: closestOnPath(path, ...o.obb().center, path.s - spec.length, path.s + LOOK_M) })).filter(({ p }) => p && p.s > path.s - spec.length + 1e-6 && p.s < path.s + LOOK_M - 1e-6);
    // across the road: the nearest gap past what is beside it and in the next stretch (the vehicles'
    // bodies, as they lie across the path)
    const spans = near.filter(({ p }) => p.s - path.s < EV_PASS_LOOK_M + spec.length).map(({ o, p }) => {
      const os = o.spec || CAR, h = Math.abs(Math.sin(o.psi - path.headingAt(p.s))) * os.length / 2 + Math.abs(Math.cos(o.psi - path.headingAt(p.s))) * os.width / 2;
      return [p.lateral - h, p.lateral + h];
    });
    const preferred = evOffset(e, pe.lane, spec);
    const target = threadGap(e, pe.lane, spec, preferred, spans) ?? preferred;
    n.side += Math.max(-dt, Math.min(dt, target - n.side));
    const offset = n.side;
    let gap = Infinity, leadV = n.v0, leader = null, squeeze = false;
    const blocking = [];
    for (const { o, p } of near) {
      if (p.s <= path.s + 0.5) continue;
      // (something moving across its way, or toward it, is given a wide berth: it will not stay
      // where it is)
      const across = Math.abs(o.v) > 0.3 && Math.cos(o.psi - path.headingAt(p.s)) < 0.85;
      const os = o.spec || CAR, clear = Math.abs(p.lateral - offset) - (spec.width + os.width) / 2;
      if (clear >= (across ? EV_CROSSING_M : EV_SQUEEZE_M - 1e-6)) { if (clear < 0.6 && p.s - path.s < 25) squeeze = true; continue; }
      // (from its middle; coming the other way, it closes the gap)
      const g = p.s - path.s - (spec.length - spec.rearOverhang) - os.length / 2;
      if (g < 15 && !o.parked) blocking.push(o);
      if (g < gap) { gap = g; leadV = o.v * Math.cos(o.psi - path.headingAt(p.s)); leader = o; }
    }
    // any part of a body in its way over the next few metres, its own body laid along its path there
    // (where it is heading across the road)
    // (everything close by, wherever it lies along the path)
    const body = n.obb(), reach = spec.length + EV_BODY_LOOK_M + 6;
    const close = all.concat(world.parked.near(n.x, n.y, reach), world.parked.doorsNear(n.x, n.y, reach)).filter((o) => o !== n && Math.abs(o.x - n.x) < reach && Math.abs(o.y - n.y) < reach);
    for (let d = 0.5; d <= EV_BODY_LOOK_M && d < gap; d += 0.5) {
      const mid = path.s + spec.length / 2 - spec.rearOverhang + d, [x, y] = path.offsetPointAt(Math.min(path.length, mid), target);
      const ahead = { ...body, center: [x, y], heading: path.headingAt(Math.min(path.length, mid)) };
      const hit = close.find((o) => obbOverlap(ahead, o.obb(), 0.05) && !obbOverlap(body, o.obb(), 0.05));
      if (hit) { gap = Math.min(gap, d - 0.5); leadV = Math.max(0, hit.v * Math.cos(hit.psi - n.psi)); leader = hit; break; }
    }
    // stuck behind something it cannot get past
    // (`blocking`: everything in its way within 15 m, but what is parked)
    if (blocking.length && n.v < 1) { n.blockedFor += dt; n.blockedBy = blocking; }
    else { n.blockedFor = 0; n.blockedBy = null; }
    n.stuck = n.v < 0.5 ? (n.stuck || 0) + dt : 0;
    // stuck for good: stood down, it turns its siren off and carries on at the limit
    if (n.stuck > EV_STAND_DOWN_S) { n.siren = false; n.blockedBy = null; n.v0 = Math.min(n.v0, e.limit); }
    // (something coming toward it in its way: slow right down until it is out of the way)
    let vCap = squeeze ? EV_SQUEEZE_MPS : Infinity, stopAt = null;
    if (leader && leadV < -0.3) vCap = Math.min(vCap, EV_JUNCTION_MPS);
    for (const c of path.edges) {
      if (c.sEnd < path.s) continue;
      const toNode = c.sEnd - front;
      if (toNode > 60) break;
      const half = map.crossingHalfWidth(c.id);
      if (toNode < -half - 3) continue;
      const control = controlAt(world, c.control, c.id);
      const lineS = control ? c.sStart + (control.s_line / Math.max(1, map.edges.get(c.id).length)) * (c.sEnd - c.sStart) : c.sEnd - half;
      const toLine = lineS - front;
      if (!control && !junctionAt(map, c.to)) continue;
      const after = path.edges[path.edges.indexOf(c) + 1];
      const st = control?.type === "signal" ? movementSignal(approachPhase(map.intersections.get(control.id), c.id, world.t), after ? map.classifyTurn(map.turnAngle(c.id, after.id)) : "straight") : null;
      const noWay = control && (control.type !== "signal" || st !== "green");
      // through a junction it has no right of way at, slow to a walking-plus pace; through any other,
      // to 8 m/s; and wait at the line for anything crossing
      vCap = Math.min(vCap, Math.sqrt((noWay ? EV_JUNCTION_MPS ** 2 : 64) + 2 * 2.5 * Math.max(0, toLine - 2)));
      if (toLine > -1 && (this.boxBusy(n, c) || this.crossComing(n, c.to, -2.5))) stopAt = Math.max(0, toLine);
      break;
    }
    const cw = crosswalkConflict(path.pts, path.cum, front - 2, front + 35, world.crowd, spec.width / 2 + 0.9 + Math.abs(offset));
    if (cw) stopAt = stopAt === null ? cw.s - front - 2 : Math.min(stopAt, cw.s - front - 2);
    // (and short of a level crossing for a train coming: sim/rail.js)
    const forRail = this.crossings ? this.yieldAtCrossing(n, front, all) : null;
    if (forRail !== null) stopAt = stopAt === null ? forRail : Math.min(stopAt, forRail);
    if (stopAt !== null && stopAt < gap) { gap = Math.max(0.05, stopAt); leadV = 0; }
    const v0 = Math.min(n.v0 * weather.speed, e.limit * (n.siren ? EV_LIMIT_FACTOR : 1) * weather.speed, EV_MAX_MPS, curveSpeed(path, path.s), vCap);
    const D = n.driver;
    let a;
    if (gap === Infinity) a = D.aMax * (1 - Math.pow(n.v / v0, 4));
    else {
      const dv = n.v - leadV, grip = Math.min(1, comfort().decel / 2.5);
      const sStar = D.s0 + Math.max(0, n.v * D.T / Math.max(0.5, grip) + n.v * dv / (2 * Math.sqrt(D.aMax * D.b * grip)));
      a = D.aMax * (1 - Math.pow(n.v / v0, 4) - Math.pow(sStar / Math.max(gap, 0.1), 2));
    }
    a = Math.max(-Math.min(6, comfort().hardDecel * 1.1), Math.min(D.aMax, a));
    if (n.v < 0.05 && a < 0) a = -1;
    n.signal = null;
    n.step(dt, { steer: purePursuit(n, path, path.s, offset), accel: a });
    if (n.v < 0) n.v = 0;
  }

  // An emergency vehicle with its siren on ahead along a driver's path, going its way, within
  // FOLLOW_M of its front: the gap to its rear and its speed, or null.
  emergencyAhead(n, path, front) {
    let best = null;
    for (const ev of this.evs) {
      if (Math.abs(ev.x - n.x) > FOLLOW_M || Math.abs(ev.y - n.y) > FOLLOW_M || Math.cos(ev.psi - n.psi) < 0.7) continue;
      const p = closestOnPath(path, ev.x, ev.y, front, front + FOLLOW_M);
      if (!p || p.distance > IN_WAY_M) continue;
      const gap = p.s - ev.spec.rearOverhang - front;
      if (gap > 0 && (!best || gap < best.gap)) best = { gap, v: Math.max(0, ev.v) };
    }
    return best;
  }

  // Buses (sim/bus.js), or streetcars (`tram`, sim/streetcar.js): note where each is along its run,
  // take off those that have finished it well away from the car, and send another when there are too
  // few.
  manageBuses(tram = false) {
    const ego = this.world.ego, is = tram ? isStreetcar : isBus, next = tram ? "nextStreetcar" : "nextBus", random = tram ? this.trams : this.transit;
    for (const n of this.vehicles.filter(is)) {
      const t = n.transit;
      if (!t) continue;
      // (along its run, or off it: then it has finished, and drives on as traffic)
      const id = n.path.currentEdge().id, k = t.edges.indexOf(id, t.k);
      if (k >= 0) t.k = k;
      else if (!t.done && t.edges.indexOf(id) < 0) t.done = true;
      if (t.k === t.edges.length - 1 && n.path.currentEdge().sEnd - n.path.s < 15) t.done = true;
      // (a streetcar waits at the end of its run, where its track leaves the map's streets, until the
      // car is well away or cannot see it: it has nowhere to drive on to as traffic)
      if (t.done && t.phase === "drive" && (Math.hypot(n.x - ego.x, n.y - ego.y) > BUS_GONE_M || (tram && !this.world.visibility.sees(ego, n)))) {
        this.vehicles.splice(this.vehicles.indexOf(n), 1);
        this[next] = Math.max(this[next], this.world.t + BUS_EVERY_S[0] + random() * (BUS_EVERY_S[1] - BUS_EVERY_S[0]));
      }
    }
    if (this.vehicles.filter(is).length < (tram ? this.streetcarTarget : this.busTarget) && this.world.t >= this[next]) {
      if (!this.spawnBus(BUS_LATER_M, null, null, tram)) this[next] = this.world.t + 5;
      else this[next] = this.world.t + BUS_EVERY_S[0];
    }
    this.buses = this.vehicles.filter(isBus);
    this.streetcars = this.vehicles.filter(isStreetcar);
  }

  // School buses (sim/school-bus.js): one far from the car, driving on, leaves, and another is placed
  // when there are too few.
  manageSchoolBuses() {
    const ego = this.world.ego;
    for (const n of this.vehicles.filter(isSchoolBus)) {
      if (n.school?.phase !== "drive" || Math.hypot(n.x - ego.x, n.y - ego.y) <= SCHOOL_GONE_M) continue;
      this.vehicles.splice(this.vehicles.indexOf(n), 1);
      this.nextSchool = Math.max(this.nextSchool, this.world.t + SCHOOL_EVERY_S[0] + this.school() * (SCHOOL_EVERY_S[1] - SCHOOL_EVERY_S[0]));
    }
    if (this.vehicles.filter(isSchoolBus).length < this.schoolTarget && this.world.t >= this.nextSchool) {
      if (!this.spawnSchoolBus(SCHOOL_LATER_M)) this.nextSchool = this.world.t + 5;
      else this.nextSchool = this.world.t + SCHOOL_EVERY_S[0];
    }
    this.schoolBuses = this.vehicles.filter(isSchoolBus);
  }

  // Where along a school bus's path its front stops for `stop` ({ edge, s }: metres along the edge's
  // centreline), or null when that street is behind it.
  schoolStopOnPath(n, stop) {
    const pe = n.path.edges.find((e) => e.id === stop.edge && e.sEnd > n.path.s - 5);
    if (!pe) return null;
    return pe.sStart + stop.s * (pe.sEnd - pe.sStart) / Math.max(1, this.map.edges.get(stop.edge).length);
  }

  // The next place along a school bus's path where it can stop (sim/school-bus.js), far enough on to
  // slow down for it gently and show its ambers first: { edge, s }, or null.
  findSchoolStop(n, front) {
    const from = front + Math.max(AMBER_M, n.v * n.v / (2 * SCHOOL_DECEL) + 10);
    for (const pe of n.path.edges) {
      if (pe.sEnd < from) continue;
      if (pe.sStart - front > 200) break;
      if (!this.schoolStops.has(pe.id)) this.schoolStops.set(pe.id, stopRange(this.map, this.map.edges.get(pe.id)));
      const e = this.map.edges.get(pe.id), scale = (pe.sEnd - pe.sStart) / Math.max(1, e.length);
      const at = firstStop(this.schoolStops.get(pe.id), (from - pe.sStart) / scale);
      if (at !== null) return { edge: pe.id, s: at };
    }
    return null;
  }

  // One step of a school bus's stops (see the top of sim/school-bus.js): where it stops, as metres
  // from its front, or null.
  schoolPlan(n, front, dt) {
    const sb = n.school;
    let stopAt = null;
    if (sb.phase === "drive") {
      sb.odo += Math.max(0, n.v) * dt;
      // (looking that far ahead to stop there, ambers and all)
      const stop = sb.odo + AMBER_M >= sb.every ? this.findSchoolStop(n, front) : null;
      if (stop) Object.assign(sb, { phase: "approach", stop });
    }
    if (sb.phase === "approach") {
      const at = this.schoolStopOnPath(n, sb.stop), to = at === null ? -Infinity : at - front;
      // (one it cannot make after all: look for the next)
      if (to < -3) Object.assign(sb, { phase: "drive", stop: null, lights: null, odo: sb.every });
      else {
        if (to < AMBER_M) sb.lights = "amber";
        // (the driver's standstill gap would leave it short of the stop: aim beyond by as much)
        stopAt = to + (n.driver.s0 || 0) - 1;
        if (n.v < 0.2 && to < 2.5) {
          Object.assign(sb, { phase: "red", lights: "red", arm: true, doors: true, t: 0, red: RED_S[0] + this.school() * (RED_S[1] - RED_S[0]),
            stops: sb.stops + 1, toDrop: KIDS[0] + Math.floor(this.school() * (KIDS[1] - KIDS[0] + 1)), dropAt: 1.5 });
        }
      }
    }
    if (sb.phase === "red") {
      stopAt = 0;
      // (held: a challenge's bus waits for the car to come up)
      if (!sb.held) sb.t += dt;
      if (sb.toDrop > 0 && sb.t >= sb.dropAt) {
        this.world.crowd.alight(n, this.map.edges.get(sb.stop.edge), this.school() < KID_CROSS_P, this.school);
        sb.toDrop--; sb.dropAt = sb.t + KID_EVERY_S;
      }
      // (until every child it let off is across the street; after RED_MAX_S, one still at the curb
      // crosses on a gap instead, but never with one in the street)
      const mine = this.world.crowd.list.filter((p) => p.school === n.id);
      const inStreet = mine.some((p) => p.crossing), toCross = sb.toDrop > 0 || mine.some((p) => p.path.some((w) => w.cross));
      if (!inStreet && ((sb.t >= sb.red && !toCross) || sb.t >= RED_MAX_S)) Object.assign(sb, { phase: "leaving", lights: null, arm: false, doors: false, t: 0 });
    }
    if (sb.phase === "leaving") {
      stopAt = 0;
      sb.t += dt;
      if (sb.t >= LEAVE_S) Object.assign(sb, { phase: "drive", stop: null, odo: 0, every: this.schoolEvery() });
    }
    n.doors = sb.doors;
    return stopAt;
  }

  // A driver stopping for a school bus with its reds flashing (sim/school-bus.js): where it stops, as
  // metres from its front, or null. It owes the stop if it could stop there braking at up to
  // 3.5 m/s^2 when it first saw the reds, and holds it until they go off.
  yieldToSchoolBus(n, front) {
    let best = null;
    for (const bus of this.schoolBuses) {
      if (bus === n || !redsOn(bus) || Math.abs(bus.x - n.x) > 110 || Math.abs(bus.y - n.y) > 110) continue;
      const h = schoolBusHold(n.path.pts, n.path.cum, front, bus);
      if (!h) continue;
      const key = `${bus.id}:${bus.school.stops}`;
      n.schoolOwed ||= {};
      if (!(key in n.schoolOwed)) {
        for (const k of Object.keys(n.schoolOwed)) if (k.startsWith(`${bus.id}:`)) delete n.schoolOwed[k];
        n.schoolOwed[key] = canStopForSchool(n.v, h.stop_m);
      }
      if (n.schoolOwed[key] && (best === null || h.stop_m < best)) best = h.stop_m;
    }
    return best;
  }

  // Where along a bus's path its front stops for `stop`, or null when that street is behind it.
  stopOnPath(n, stop, front) {
    const pe = n.path.edges.find((e) => e.id === stop.edge && e.sEnd > front - n.spec.length);
    if (!pe) return null;
    return pe.sStart + stop.front * (pe.sEnd - pe.sStart) / Math.max(1, this.map.edges.get(stop.edge).length);
  }

  // Whether a bus's next stop is within 150 m along its path, so it should move across to the curb
  // lane (by a lane change, gap permitting: it keeps its lane straight on through a junction).
  busStopSoon(n, front) {
    const stop = n.transit.stops[n.transit.next], at = stop ? this.stopOnPath(n, stop, front) : null;
    return at !== null && at - front < 150;
  }

  // One step of a bus's stops (see the top of sim/bus.js): it signals and pulls in to the next, stops
  // there, opens its doors for 10 to 25 s, signals left and pulls out once it may, until its rear
  // axle is back in its lane (`lateral`: how far right of it that is). Returns where it stops
  // (`stopAt`, metres from its front, or null) and its signal (undefined: as any driver's).
  busPlan(n, pe, front, dt, lateral) {
    const t = n.transit, e = this.map.edges.get(pe.id);
    t.limit = e.limit; t.laneWidth = e.lane_width;
    let stopAt = null, signal, target = 0;
    if (t.phase === "drive") {
      let stop = t.stops[t.next], at = stop ? this.stopOnPath(n, stop, front) : null;
      // (one it has passed, or whose street is behind it, is skipped)
      while (stop && (at === null || at - front < -2)) { stop = t.stops[++t.next]; at = stop ? this.stopOnPath(n, stop, front) : null; }
      if (stop && at - front < BUS_SIGNAL_M) {
        // in to the curb where nothing is parked in the bus zone (a car parked there all the same: in
        // its lane)
        const se = this.map.edges.get(stop.edge), lane = n.path.edges.find((x) => x.id === stop.edge)?.lane ?? se.lanes - 1;
        const free = this.parkedAlong(se).every(([a, b]) => b < stop.front - BUS.length - 2 || a > stop.front + 1);
        Object.assign(t, { phase: "in", stop, curb: free ? curbShift(se, lane) : 0 });
      }
    }
    if (t.phase === "in") {
      const at = this.stopOnPath(n, t.stop, front), to = at === null ? -Infinity : at - front;
      // (past it without stopping: back into its lane, with no right of way, as it has not stopped)
      if (to < -3) Object.assign(t, { phase: "drive", next: t.next + 1, curb: 0 });
      else {
        signal = "right";
        target = to < BUS_TAPER_M ? t.curb : 0;
        // (the driver's standstill gap would leave it short of the stop: aim beyond by as much)
        stopAt = to + (n.driver.s0 || 0) - 1;
        if (n.v < 0.2 && to < 2.5) Object.assign(t, { phase: "dwell", t: 0, dwell: BUS_DWELL_S[0] + this.transit() * (BUS_DWELL_S[1] - BUS_DWELL_S[0]), doors: true, next: t.next + 1 });
      }
    }
    if (t.phase === "dwell") {
      target = t.curb; stopAt = 0; signal = null;
      t.t += dt;
      if (t.t >= t.dwell) Object.assign(t, { phase: "leaving", t: -dt, doors: false, departures: t.departures + 1 });
    }
    if (t.phase === "leaving") {
      target = t.curb; stopAt = 0; signal = "left";
      t.t += dt;
      if (busMayPullOut(n, [this.world.ego, ...this.vehicles], (o) => o.busYield?.bus === n)) t.phase = "out";
    }
    if (t.phase === "out") {
      signal = Math.abs(lateral) > 0.3 ? "left" : null;
      if (Math.abs(t.shift) < 0.05 && Math.abs(lateral) < 0.3) t.phase = "drive";
    }
    // (a bus moves across only as it rolls forward)
    const rate = Math.min(BUS_SHIFT_MPS, BUS_SHIFT_PER_MPS * Math.max(0, n.v) + 0.05) * dt;
    t.shift += Math.max(-rate, Math.min(rate, target - t.shift));
    n.doors = t.doors;
    return { stopAt, signal };
  }

  // One step of a streetcar's stops (see the top of sim/streetcar.js): it slows to the next and stops
  // there in its lane, opens its doors, lets its riders off and on, closes its doors once they are
  // clear of the street and moves off; and it stops at the end of its run, where its track leaves the
  // map (manageBuses then takes it off). Returns where it stops (`stopAt`, metres from its front, or
  // null), and no signal: it has none to give.
  streetcarPlan(n, front, dt) {
    const t = n.transit, crowd = this.world.crowd;
    let stopAt = null;
    const last = n.path.edges.find((e) => e.id === t.edges[t.edges.length - 1]);
    if (last) {
      stopAt = last.sEnd - front - 1;
      // (stopped there, short of it by the driver's standstill gap)
      if (stopAt < (n.driver.s0 || 0) + 1.5 && n.v < 0.3) t.done = true;
    }
    const hold = (at) => { stopAt = stopAt === null ? at : Math.min(stopAt, at); };
    if (t.phase === "drive") {
      let stop = t.stops[t.next], at = stop ? this.stopOnPath(n, stop, front) : null;
      while (stop && (at === null || at - front < -2)) { stop = t.stops[++t.next]; at = stop ? this.stopOnPath(n, stop, front) : null; }
      if (stop && at - front < Math.max(BUS_SIGNAL_M, n.v * n.v / (2 * STREETCAR_DECEL) + 10)) Object.assign(t, { phase: "in", stop });
    }
    if (t.phase === "in") {
      const at = this.stopOnPath(n, t.stop, front), to = at === null ? -Infinity : at - front;
      if (to < -3) Object.assign(t, { phase: "drive", next: t.next + 1 });
      else {
        // (the driver's standstill gap would leave it short of the stop: aim beyond by as much)
        hold(to + (n.driver.s0 || 0) - 1);
        if (n.v < 0.2 && to < 2.5) {
          const pick = (r) => r[0] + Math.floor(this.trams() * (r[1] - r[0] + 1));
          Object.assign(t, { phase: "dwell", t: 0, dwell: DWELL_S[0] + this.trams() * (DWELL_S[1] - DWELL_S[0]), next: t.next + 1, off: pick(RIDERS_OFF), on: pick(RIDERS_ON), riderAt: DOORS_DELAY_S + 0.5 });
        }
      }
    }
    if (t.phase === "dwell") {
      hold(0);
      t.t += dt;
      const e = this.map.edges.get(n.path.currentEdge().id);
      if (!t.doors && t.t >= DOORS_DELAY_S && !t.closing) t.doors = true;
      // (one rider at a time: those getting off first)
      if (t.doors && !t.held && t.t >= t.riderAt && (t.off > 0 || t.on > 0)) {
        if (t.off > 0) { t.off--; crowd.rideOff(n, e, this.trams); } else { t.on--; crowd.rideOn(n, e, this.trams); }
        t.riderAt = t.t + RIDER_EVERY_S;
      }
      const mine = crowd.list.filter((p) => p.streetcar === n.id && !p.gone);
      // (a rider still in the street, crossing between the curb and the doors, or about to)
      const inStreet = mine.some((p) => p.path.some((w) => w.cross) && (p.crossing || !p.boarding));
      if (t.doors && !t.held && t.t >= t.dwell && !inStreet && (!(t.off > 0 || t.on > 0) || t.t >= DWELL_MAX_S)) {
        // (anyone still waiting at the curb to get on has missed it)
        for (const p of mine) if (p.boarding && !p.crossing) crowd.missed(p, e);
        Object.assign(t, { doors: false, off: 0, on: 0, closing: true, t: 0 });
      }
      if (t.closing && t.t >= DEPART_S) Object.assign(t, { phase: "drive", closing: false, departures: t.departures + 1 });
    }
    n.doors = t.doors;
    return { stopAt };
  }

  // A driver not passing a streetcar with its doors open (sim/streetcar.js): where it stops, as metres
  // from its front, or null. Owed when, seeing the doors open, it can stop there braking at no more
  // than OWED_DECEL; decided once a stop, and kept until they close.
  yieldToStreetcar(n, front) {
    let best = null;
    for (const car of this.streetcars) {
      if (car === n || !doorsOpen(car) || Math.abs(car.x - n.x) > 130 || Math.abs(car.y - n.y) > 130) continue;
      const h = streetcarHold(n.path.pts, n.path.cum, front, car);
      if (!h) continue;
      const key = `${car.id}:${car.transit.departures}`;
      n.streetcarOwed ||= {};
      if (!(key in n.streetcarOwed)) {
        for (const k of Object.keys(n.streetcarOwed)) if (k.startsWith(`${car.id}:`)) delete n.streetcarOwed[k];
        n.streetcarOwed[key] = canStopForStreetcar(n.v, h.stop_m);
      }
      if (n.streetcarOwed[key] && (best === null || h.stop_m < best)) best = h.stop_m;
    }
    return best;
  }

  // Where a driver's front stops for the level crossings ahead on its path (sim/rail.js crossingHold),
  // or null. It owes the stop for a train when it first hears it coming and can stop then; an emergency
  // vehicle does not wait for room past the tracks.
  yieldAtCrossing(n, front, all) {
    n.railOwed ||= new Map();
    const owes = (x, at) => {
      const key = `${x.c.id}:${at.train.id}:${at.train.rail.departures}`;
      if (!n.railOwed.has(key)) {
        if (n.railOwed.size > 8) n.railOwed.delete(n.railOwed.keys().next().value);
        n.railOwed.set(key, canStopForTrain(n.v, x.stop_m) || n.v < 0.5);
      }
      return n.railOwed.get(key);
    };
    const hold = crossingHold(this.map, n.path.pts, n.path.cum, front, n.spec, n.v, { trains: this.trains, vehicles: isEmergencyVehicle(n) ? [] : all, self: n, owes });
    return hold ? hold.stop_m : null;
  }

  // How far left of its lane's path (negative) a driver eases to pass a bus standing at its stop just
  // ahead or beside it (see NUDGE_MPS), or 0.
  busNudge(n, pe) {
    const e = this.map.edges.get(pe.id), path = n.path, spec = n.spec;
    const room = e.lane_width / 2 - spec.width / 2 - 0.1;
    let nudge = 0;
    for (const bus of this.buses) {
      const t = bus.transit;
      if (!(t.phase === "dwell" || t.phase === "leaving" || (t.phase === "in" && t.shift > 1)) || Math.abs(bus.x - n.x) > NUDGE_LOOK_M + 15 || Math.abs(bus.y - n.y) > NUDGE_LOOK_M + 15) continue;
      const [cx, cy] = bus.center, p = projectPoint(path.pts, path.cum, [cx, cy], null);
      // (until the car's rear is past the bus's front)
      if (!p || p.s - path.s < -(bus.spec.length / 2 + spec.rearOverhang) || p.s - path.s > NUDGE_LOOK_M + bus.spec.length || p.lateral <= 0) continue;
      // (clear of it all along its body, where the leader check looks for it: it may stand at an angle)
      const bs = bus.spec, lateral = Math.min(...[0, bs.length / 2 - bs.rearOverhang, bs.length - bs.rearOverhang - 1].map((d) => {
        const q = projectPoint(path.pts, path.cum, [bus.x + Math.cos(bus.psi) * d, bus.y + Math.sin(bus.psi) * d], null);
        return q ? q.lateral : p.lateral;
      }));
      const need = (spec.width + bs.width) / 2 + LEADER_MARGIN_M + 0.01 - lateral;
      if (need > 0 && need <= room) nudge = Math.min(nudge, -need);
    }
    return nudge;
  }

  // The limit of a school or playground zone in effect at the front of a vehicle on `path`, or one
  // that starts within ZONE_AHEAD_M of it, so that it slows on the way in (sim/speed-zones.js);
  // Infinity when there is none.
  zoneLimit(path, front) {
    const clock = this.world.clock;
    if (!clock || !this.map.zoneSpans.size) return Infinity;
    for (const s of [front, front + ZONE_AHEAD_M]) {
      const pe = path.edges.find((e) => s < e.sEnd);
      const e = pe && this.map.edges.get(pe.id);
      if (!e || !this.map.zoneSpans.has(pe.id)) continue;
      if (zoneAt(this.map.zoneSpans, pe.id, Math.max(0, s - pe.sStart) * e.length / Math.max(1e-6, pe.sEnd - pe.sStart), clock)) return ZONE_LIMIT_MPS;
    }
    return Infinity;
  }

  // Passing a vehicle stopped at the roadside with its lights flashing (sim/roadside.js): the speed
  // to keep to, from ROADSIDE_AHEAD_M before APPROACH_M short of it (so that it is down to it by
  // then) until past it; Infinity when there is none.
  // The work zone on the street a driver is on, or the next it will be on, within WZ_LOOK_M of its
  // stop line (sim/work-zone.js), with its marks along the driver's path: { zone, side, line, from,
  // to (the one-lane section), detour (on the side whose lane is closed) }, or null once past it.
  workZoneAhead(n, path, front) {
    const zones = this.world.workZones;
    if (!zones?.zones.length) return null;
    for (const e of path.edges) {
      if (e.sEnd < path.s) continue;
      if (e.sStart - front > WZ_LOOK_M) break;
      const hit = zones.on(e.id);
      if (!hit) continue;
      const k = (e.sEnd - e.sStart) / Math.max(1, this.map.edges.get(e.id).length), at = (s) => e.sStart + s * k, m = marksOn(hit.zone, hit.side);
      if (front > at(m.to) + 2 || at(m.line) - front > WZ_LOOK_M) continue;
      const d = hit.side === "closed" ? detourOf(hit.zone) : null;
      return { zone: hit.zone, side: hit.side, line: at(m.line), from: at(m.from), to: at(m.to),
        detour: d ? { from: at(d.from), full: at(d.full), back: at(d.back), to: at(d.to), shift: d.shift } : null };
    }
    return null;
  }

  // A van double-parked in the driver's lane ahead on its path, within VAN_LOOK_M (sim/double-parked.js),
  // with its marks along the path: { van, d (its record), go (going round it now), detour, wait (where
  // the front waits), to (the end of the way round) }, or null once past it. The driver goes round once
  // its front is within DECIDE_M of the van, nobody waits ahead of it and the way is clear (a long
  // vehicle needs the time its extra length takes too), and once it has started across it carries on
  // round (`vanGo`). One whose front is more than WAIT_SLACK_M past where it would wait is too close to
  // pull out round it, and waits for it to leave.
  vanAhead(n, path, front, all) {
    const vans = this.world.doubleParked;
    for (const e of path.edges) {
      if (e.sEnd < path.s) continue;
      if (e.sStart - front > VAN_LOOK_M) break;
      for (const d of vans.on(e.id)) {
        const k = (e.sEnd - e.sStart) / Math.max(1, this.map.edges.get(e.id).length), at = (s) => e.sStart + s * k;
        if (front > at(d.detour.to) || at(d.rear) - front > VAN_LOOK_M) continue;
        const detour = { from: at(d.detour.from), full: at(d.detour.full), back: at(d.detour.back), to: at(d.detour.to), shift: d.detour.shift };
        let go = n.vanGo === d.id;
        // (not from closer than where it would wait: too close to pull out round it, it waits for it to go)
        if (!go && at(d.rear) - front < DECIDE_M && front < at(d.wait) + WAIT_SLACK_M) {
          // (as this driver pulls away: its own acceleration, reaction and speed)
          const sFront = (front - e.sStart) / k, extra = Math.max(0, n.spec.length - CAR.length), D = n.driver || IDM;
          const self = { accel: D.aMax, react: D.react || 0, vmax: n.v0 * weather.speed };
          if (!queuedAhead(this.world, d, sFront, n, all) && wayRound(this.world, d, sFront - extra, n.v, all.filter((o) => o !== n), null, self).clear) {
            go = true;
            // (committed once its pursuit point is past where the way round starts)
            if (path.s + lookahead(n.v) > detour.from + 2) n.vanGo = d.id;
          }
        }
        return { van: d.van, d, go, detour, wait: at(d.wait), to: detour.to };
      }
    }
    return null;
  }

  // Vans whose drivers are back and that the car can see (sim/double-parked.js `leaving`): switch the
  // hazards off and drive away as traffic, from where they stand.
  driveOffVans() {
    const vans = this.world.doubleParked;
    for (const d of vans.vans.filter((x) => x.leaving)) {
      const old = d.van, lane = this.map.lane(d.edge, 0);
      vans.retire(d);
      if (!lane) continue;
      const s = projectPoint(lane.pts, lane.cum, [old.x, old.y], null).s;
      const v = new Vehicle(old.x, old.y, old.psi, 0, DELIVERY_VAN);
      Object.assign(v, { id: `${old.id}_away`, kind: "delivery_van", color: old.color, v0: lane.edgeRef.limit * 0.9,
        driver: { aMax: 1.2, b: 2, s0: 2.5, T: 1.4, react: 1.0, lcRate: 0 }, stopMem: new StopMemory(), frozen: 0, waiting: 0 });
      // (its own stream for the turns it takes, so the rest of the traffic is as it was)
      v.path = new NpcPath(this.map, rng(7919 * (Number(d.id.slice(4)) || 1) + 11));
      v.path.start(d.edge, 0, s);
      this.vehicles.push(v);
    }
  }

  // Where a driver stops for a work zone's flagger showing STOP, as metres from its front, or null:
  // short of the line, once it could stop there braking at OWED_DECEL (and from then on while the
  // paddle shows STOP); a driver too close to stop goes on through.
  flaggerHold(n, wz, front) {
    const toLine = wz.line - front;
    if (paddle(wz.zone, wz.side) !== "stop" || toLine < -1) { n.flagger = null; return null; }
    const key = stopKey(wz.zone, wz.side);
    if (n.flagger !== key && !canStopForFlagger(n.v, toLine - 0.5)) return null;
    n.flagger = key;
    return toLine - 0.5;
  }

  roadsideLimit(n, limit) {
    for (const v of this.world.roadside?.vehicles || []) {
      if (Math.abs(v.x - n.x) > 80 || Math.abs(v.y - n.y) > 80) continue;
      const r = roadsideRelation(n, v);
      if (r && r.ahead_m <= APPROACH_M + ROADSIDE_AHEAD_M) return passLimit(limit);
    }
    return Infinity;
  }

  // A driver yielding to a bus pulling out from its stop (sim/bus.js): where it stops, as metres from
  // its front, or null. It yields once it sees the bus signal if it can stop 2 m behind it braking at
  // up to 3 m/s^2, and from then on until the bus has pulled out (or it is no longer behind it).
  yieldToBus(n) {
    let best = null;
    for (const bus of this.buses) {
      const y = busYield(n, bus);
      if (!y) { if (n.busYield?.bus === bus) n.busYield = null; continue; }
      if (n.busYield?.bus !== bus && !canStopFor(n.v, y.stop_m)) continue;
      if (!n.busYield) n.busYield = { bus };
      if (best === null || y.stop_m < best) best = y.stop_m;
    }
    if (best === null) n.busYield = null;
    return best;
  }

  // How far right of its lane's centre a driver giving way to an emergency vehicle pulls over: into
  // the parking lane where nothing is parked from 10 m behind its front to 15 m ahead of it.
  pullOverTo(n, pe, front) {
    const e = this.map.edges.get(pe.id);
    const scale = e.length / Math.max(1, pe.sEnd - pe.sStart), at = (front - pe.sStart) * scale;
    const free = this.parkedAlong(e).every(([a, b]) => b < at - 10 - n.spec.length || a > at + 15);
    return pullOverOffset(e, pe.lane, n.spec.width, free);
  }

  // Where a driver giving way to an emergency vehicle stops, as metres from its front bumper: chosen
  // when the call came (see EV_STOP_DECEL) and kept as a point on the road.
  yieldStop(n, y, front) {
    const path = n.path;
    if (!y.stop) {
      // (sooner, braking firmly, for one coming toward it)
      let dist = Math.max(4, n.v * n.v / (2 * (y.toward ? EV_FIRM_DECEL : EV_STOP_DECEL)));
      const i = path.edges.findIndex((e) => e.sEnd > front), cur = path.edges[i], prev = path.edges[i - 1];
      // (in a junction: clear it first)
      if (prev && this.isJunction(prev.to)) dist = Math.max(dist, prev.sEnd + this.map.crossingHalfWidth(prev.id) + n.spec.length + 1 - front);
      if (cur && this.isJunction(cur.to)) {
        const half = this.map.crossingHalfWidth(cur.id), toNode = cur.sEnd - front;
        const control = cur.control, toLine = control ? cur.sStart + (control.s_line / Math.max(1, this.map.edges.get(cur.id).length)) * (cur.sEnd - cur.sStart) - front : Infinity;
        const short = Math.min(toNode - half - 2.5, toLine - 0.5);
        if (short < dist) dist = short >= n.v * n.v / (2 * EV_FIRM_DECEL) ? Math.max(0.3, short) : toNode + half + n.spec.length + 3;
      }
      y.stop = path.pointAt(Math.min(path.length, front + dist));
    }
    return projectPoint(path.pts, path.cum, y.stop, null).s - front;
  }

  // Reverse slowly, straight back, until clear by `left` meters, blocked behind, or out of time;
  // then hold a few seconds while the other vehicle goes.
  backOff(n, dt) {
    const b = n.backoff;
    b.t += dt;
    b.left -= Math.abs(n.v) * dt;
    let behind = Infinity;
    for (const o of this.world.obstaclesNear(n.x, n.y, 12)) {
      if (o === n) continue;
      const l = n.toLocal(o.x, o.y);
      if (l.ahead < 0 && Math.abs(l.right) < 1.6) behind = Math.min(behind, -l.ahead - n.spec.rearOverhang - (o.spec ? o.spec.length - o.spec.rearOverhang : 3.6));
    }
    const done = b.left <= 0 || b.t > 7 || behind < 1.5;
    n.step(dt, { steer: 0, accel: done ? (n.v < -0.05 ? 3 : 0) : Math.max(-1.5, (-1.5 - n.v) * 1.5), reverse: true });
    n.signal = null;
    if (done && n.v > -0.05) { n.v = 0; n.backoff = null; n.holdFor = 5; }
  }

  // Reserve a vacant curb slot on a driver's current lane. The car indicates, slows, moves
  // smoothly into the bay and stops; it becomes a persistent parked obstacle at its actual pose.
  maybePark() {
    for (const n of this.vehicles) {
      if (n.kind === "bike" || n.transit || n.school || n.rail || n.pull || n.parking || n.lc || n.backoff || n.frozen > 0) continue;
      const edge = n.path.currentEdge(), lane = this.map.lane(edge.id, edge.lane);
      const e = this.map.edges.get(edge.id);
      const choices = this.world.parked.slots.filter((slot) => {
        if (slot.edge !== edge.id || slot.occupant || slot.reserved) return false;
        if (edge.lane !== (slot.curb === "right" ? e.lanes - 1 : 0)) return false;
        const p = projectPoint(n.path.pts, n.path.cum, [slot.x, slot.y]);
        const ahead = p.s - n.path.s;
        return ahead > Math.max(18, n.v * n.v / (2 * comfort().decel) + 8) && ahead < 60
          && Math.abs(p.lateral) < 4.5 && this.world.obstaclesNear(slot.x, slot.y, 14).every((o) => o === n || Math.hypot(o.x - slot.x, o.y - slot.y) > 13);
      });
      if (!lane || !choices.length) continue;
      const slot = choices[Math.floor(this.parkingEvents() * choices.length)];
      const p = projectPoint(n.path.pts, n.path.cum, [slot.x, slot.y]);
      slot.reserved = n;
      n.parking = { slot, start: n.path.s, end: p.s, lat: p.lateral, t: 0 };
      n.signal = slot.curb;
      return n;
    }
    return null;
  }

  parkStep(n, dt) {
    const park = n.parking;
    park.t += dt;
    const p = projectPoint(n.path.pts, n.path.cum, [n.x, n.y]);
    n.path.s = p.s;
    const room = park.end - p.s;
    const offset = park.lat * smooth((14 - room) / 9);
    const target = Math.min(3, Math.sqrt(2 * comfort().decel * Math.max(0, room - 0.2)));
    // Check a short swept envelope, including pedestrians, before moving into the bay.
    const box = n.obb();
    const reach = Math.max(0.5, n.v * 0.8);
    box.center = [box.center[0] + Math.cos(n.psi) * reach / 2, box.center[1] + Math.sin(n.psi) * reach / 2];
    box.halfLength += reach / 2;
    box.halfWidth += 0.15;
    const blocked = this.world.obstaclesNear(n.x, n.y, 12).concat(this.world.ego).some((o) => o !== n && obbOverlap(box, o.obb(), 0.2));
    n.step(dt, { steer: purePursuit(n, n.path, p.s, offset), accel: blocked ? -comfort().hardDecel : speedControl(n.v, target) });
    if (n.v < 0) n.v = 0;
    if (room < 0.6 && n.v < 0.2 && Math.abs(p.lateral - park.lat) < 0.45) {
      n.v = n.a = n.vy = n.r = 0;
      n.signal = null;
      n.edge = park.slot.edge; n.curb = park.slot.curb; n.slot = park.slot;
      n.parking = null;
      this.vehicles.splice(this.vehicles.indexOf(n), 1);
      this.world.parked.add(n);
    } else if (park.t > 35 || room < -2) {
      park.slot.reserved = null;
      n.parking = null;
      n.signal = null;
    }
  }

  // A car parked 20 to 90 m ahead of the ego gets ready to pull out. It becomes traffic; to keep the
  // count steady, the traffic car farthest from the ego (well out of sight) leaves.
  maybePullOut() {
    const world = this.world, ego = world.ego, map = this.map;
    const cx = ego.x + Math.cos(ego.psi) * 55, cy = ego.y + Math.sin(ego.psi) * 55;
    const near = world.parked.near(cx, cy, 45).filter((c) => { const l = ego.toLocal(c.x, c.y); return l.ahead > 20 && l.ahead < 90 && c.edge && !c.door && !c.stay; });
    if (!near.length) return null;
    const car = near[Math.floor(this.events() * near.length)];
    return this.startPullOut(car);
  }

  // Authored challenges use the same transition, gap acceptance and merge physics as background traffic.
  startPullOut(car) {
    const world = this.world, ego = world.ego, map = this.map;
    const e = map.edges.get(car.edge);
    if (!e) return null;
    const laneIdx = car.curb === "right" ? e.lanes - 1 : 0;
    const lane = map.lane(e.id, laneIdx);
    if (!lane) return null;
    const proj = projectPoint(lane.pts, lane.cum, [car.x, car.y], null);
    if (!proj || proj.s < 6 || proj.s > lane.length - 20 || Math.abs(proj.lateral) > 4.5) return null;
    if (!world.parked.remove(car)) return null;
    const v = new Vehicle(car.x, car.y, car.psi, 0);
    v.id = `car_p${++this.pulled}`;
    v.color = car.color;
    v.style = car.style;
    v.path = new NpcPath(map, this.random);
    v.path.start(e.id, laneIdx, proj.s);
    v.v0 = e.limit * (0.85 + this.events() * 0.2);
    v.driver = driverProfile(this.events);
    v.stopMem = new StopMemory();
    v.frozen = 0;
    v.waiting = 0;
    v.parked = false;
    v.pull = { lat: proj.lateral, t: 0, T: 3.5, wait: 1.5 + this.events() * 2.5 };
    this.vehicles.push(v);
    const cars = this.vehicles.filter((k) => k.kind !== "bike" && !isLong(k));
    if (cars.length > this.target) {
      let far = null;
      for (const k of cars) {
        if (k.pull || k.parking) continue;
        const d = Math.hypot(k.x - ego.x, k.y - ego.y);
        if (d > 150 && (!far || d > far.d)) far = { k, d };
      }
      if (far) this.vehicles.splice(this.vehicles.indexOf(far.k), 1);
    }
    return v;
  }

  // Nothing in the lane coming up behind within a few seconds (less for an assertive driver), and
  // nothing stopped right in front.
  pullClear(n) {
    const path = n.path;
    const gap = Math.max(n.pull?.T || 3.5, n.driver && n.driver.T < 1.05 ? 3.5 : 5) + 1.5;
    for (const o of [this.world.ego, ...this.vehicles]) {
      if (o === n || Math.abs(o.x - n.x) > 70 || Math.abs(o.y - n.y) > 70) continue;
      const dx = n.x - o.x, dy = n.y - o.y, distance = Math.hypot(dx, dy);
      const closing = dx * Math.cos(o.psi) + dy * Math.sin(o.psi);
      const side = Math.abs(dx * Math.sin(o.psi) - dy * Math.cos(o.psi));
      if (distance < 12 || (closing > 0 && side < 5.5 && distance < o.v * gap + 8)) return false;
      const p = projectPoint(path.pts, path.cum, [o.x, o.y], null);
      if (!p || Math.abs(p.lateral) > 3.5) continue;
      const ds = p.s - path.s;
      if (Math.abs(ds) < 9) return false;
      if (ds <= -1 && ds > -60 && o.v > 0.5 && (-ds - 5) / o.v < gap) return false;
    }
    return true;
  }

  // Where a cyclist rides across its lane (see STRIP_MIN_M): it takes the parking lane or moves back
  // into the traffic lane, eases `n.side` toward it and returns it. `n.stripHold` is where it must
  // stop, in the parking lane, while it waits to move back.
  curbside(n, pe, front, dt) {
    const e = this.map.edges.get(pe.id);
    const inLane = Math.max(0, e.lane_width / 2 - 0.75), strip = stripOffset(e, pe.lane);
    if (n.side === undefined) n.side = inLane;
    const end = strip === null ? front : this.stripEnd(n.path, pe, front);
    n.stripHold = null;
    // (a parked car on the next street is passed only once the rider is crossing the junction, its
    // front at the crossing street, but where the street just carries on, as round a bend, it is
    // passed like one on this street)
    const across = end > pe.sEnd && this.isJunction(pe.to) && front < pe.sEnd - this.map.crossingHalfWidth(pe.id);
    const leave = strip === null || (end - front < STRIP_LEAVE_M + STRIP_LEAVE_S * n.v && !across);
    if (n.strip) {
      if (leave) {
        if (this.laneClear(n, e)) n.strip = false;
        else if (strip !== null) n.stripHold = end - STRIP_HOLD_M;
      }
    } else if (!leave && (across || end - front > STRIP_ENTER_M)) n.strip = true;
    const target = n.strip ? strip : inLane;
    // (a bicycle moves across only as it rolls forward)
    const rate = Math.min(SIDE_MPS, SIDE_PER_MPS * Math.max(0, n.v) + SHUFFLE_MPS) * dt;
    n.side += Math.max(-rate, Math.min(rate, target - n.side));
    return target;
  }

  // Where the parking lane a cyclist rides in ends ahead of it, as arc length along its path: at the
  // first car parked in it (or a bay a car is about to park in), or before a junction where it turns
  // left or the next street has no parking lane. Looked for along this street and the next two.
  stripEnd(path, pe, front) {
    const k = path.edges.indexOf(pe);
    for (let i = k; i < path.edges.length && i <= k + 2; i++) {
      const pi = path.edges[i], e = this.map.edges.get(pi.id), prev = path.edges[i - 1];
      if (i > k && stripOffset(e, pi.lane) === null) return prev.sEnd - this.map.crossingHalfWidth(prev.id);
      const scale = (pi.sEnd - pi.sStart) / Math.max(1, e.length);
      for (const [s0, s1] of this.parkedAlong(e)) if (pi.sStart + s1 * scale > front) return Math.max(front, pi.sStart + s0 * scale);
      const next = path.edges[i + 1];
      if (next) {
        const turn = this.map.classifyTurn(this.map.turnAngle(pi.id, next.id));
        if (turn === "left" || turn === "uturn") return pi.sEnd - this.map.crossingHalfWidth(pi.id);
      }
    }
    return Infinity;
  }

  // The stretches of a street's right-hand parking lane taken by parked cars, or bays reserved by a
  // car about to park, as [start, end] along the street, in order.
  parkedAlong(e) {
    const parked = this.world.parked;
    if (!this.bays) {
      this.bays = new Map();
      for (const slot of parked.slots) {
        if (slot.curb !== "right") continue;
        const edge = this.map.edges.get(slot.edge), s = projectPoint(edge.pts, edge.cum, [slot.x, slot.y], null).s - CAR.rearOverhang;
        if (!this.bays.has(slot.edge)) this.bays.set(slot.edge, []);
        this.bays.get(slot.edge).push({ slot, s });
      }
      for (const list of this.bays.values()) list.sort((a, b) => a.s - b.s);
    }
    const out = (this.bays.get(e.id) || []).filter((b) => b.slot.occupant || b.slot.reserved).map((b) => [b.s, b.s + CAR.length]);
    // (a car parked outside a bay: placed by a challenge)
    const key = `${this.world.tick}:${parked.list.length}`;
    if (this.looseKey !== key) { this.looseKey = key; this.loose = parked.list.filter((c) => !c.slot); }
    for (const c of this.loose) {
      if (c.edge !== e.id || c.curb !== "right") continue;
      const s = projectPoint(e.pts, e.cum, [c.x, c.y], null).s - c.spec.rearOverhang;
      out.push([s, s + c.spec.length]);
    }
    return out.sort((a, b) => a[0] - b[0]);
  }

  // Nothing in the traffic lane beside a cyclist, or coming up behind it, that it would move in front
  // of (see MERGE_GAP_M). Anything ahead of it is a leader once it is in the lane.
  laneClear(n, e) {
    const path = n.path, ns = n.spec;
    for (const o of [this.world.ego, ...this.vehicles]) {
      if (o === n || Math.abs(o.x - n.x) > 60 || Math.abs(o.y - n.y) > 60) continue;
      const p = projectPoint(path.pts, path.cum, [o.x, o.y], null);
      if (!p || Math.abs(p.lateral) > e.lane_width / 2 + 0.3) continue;
      const os = o.spec || CAR, ds = p.s - path.s;
      if (ds - os.rearOverhang > ns.length - ns.rearOverhang + 0.5) continue;
      const behind = -ds - (os.length - os.rearOverhang) - ns.rearOverhang;
      if (behind < MERGE_GAP_M + Math.max(0, o.v - n.v) * MERGE_GAP_S) return false;
    }
    return true;
  }

  // Move a stopped cyclist up to `by` metres to its right (negative: left), at SHUFFLE_MPS, and turn it
  // up to `turn` radians toward its path at SHUFFLE_TURN, if nothing is in the way there.
  shuffle(n, by, turn, dt) {
    const d = Math.sign(by) * Math.min(SHUFFLE_MPS * dt, Math.abs(by)), x = n.x + Math.sin(n.psi) * d, y = n.y - Math.cos(n.psi) * d;
    const psi = n.psi + Math.sign(turn) * Math.min(SHUFFLE_TURN * dt, Math.abs(turn)), f = n.spec.length / 2 - n.spec.rearOverhang;
    const box = { ...n.obb(), heading: psi, center: [x + Math.cos(psi) * f, y + Math.sin(psi) * f] };
    // (to within 0.1 m of nothing new, and away from anything already that close)
    const near = this.world.obstaclesNear(x, y, 8).concat(this.world.ego), now = n.obb();
    const closer = (o) => Math.hypot(box.center[0] - o.center[0], box.center[1] - o.center[1]) < Math.hypot(now.center[0] - o.center[0], now.center[1] - o.center[1]);
    if (near.some((o) => o !== n && o.obb && obbOverlap(box, o.obb(), 0.1) && (!obbOverlap(now, o.obb(), 0.1) || closer(o)))) return;
    n.x = x; n.y = y; n.psi = psi;
  }

  // Turning right at node `nodeId`, `toNode` metres ahead: a cyclist on the right (clear of the car's
  // line, so not one following it) going the car's way would reach the corner (the near side of the
  // crossing street, `half` metres short of the junction's centre) before the car is round it.
  cyclistOnRight(n, nodeId, toNode, half) {
    const node = this.map.nodes.get(nodeId);
    if (!node) return false;
    const mine = (toNode + n.spec.length) / Math.max(2.5, Math.min(HOOK_TURN_MPS, n.v)) + HOOK_MARGIN_S;
    for (const o of this.vehicles) {
      if (o.kind !== "bike" || (o.v < 0.5 && !(o.v > 0.05 && o.a > 0.3))) continue;
      if (Math.abs(wrap(o.psi - n.psi)) > Math.PI / 6) continue;
      const local = n.toLocal(o.x, o.y);
      if (local.right < (n.spec.width + o.spec.width) / 2 + 0.1 || local.right > HOOK_SIDE_M || local.ahead < -HOOK_LOOK_M) continue;
      const along = (node.x - o.x) * Math.cos(o.psi) + (node.y - o.y) * Math.sin(o.psi);
      if (along < -1) continue;   // past the corner
      if (Math.max(0, along - half - (o.spec.length - o.spec.rearOverhang)) / Math.max(0.5, o.v) < mine) return true;
    }
    return false;
  }

  // Start a lane change when the lane is wrong for the next turn (looking through a short link inside
  // the junction), or, now and then, to get past a
  // slow car. Only mid-block on multi-lane edges, and only into a gap that is free well behind and
  // ahead in the target lane.
  // Giving way to an emergency vehicle (`curbward`), a driver moves a lane to the right whenever the
  // gap allows, at any speed, up to 15 m before the street ends.
  maybeChangeLane(n, edge, front, curbward = false) {
    const e = this.map.edges.get(edge.id);
    if (!e || e.lanes < 2 || (n.v < 3 && !curbward) || n.lcCooldown > 0 || n.kind === "bike" || n.pull) return;
    const toEnd = edge.sEnd - front;
    if (toEnd < (curbward ? 15 : 30)) return;
    if (edge.control && !curbward) {
      const lineS = edge.sStart + (edge.control.s_line / Math.max(1, e.length)) * (edge.sEnd - edge.sStart);
      if (lineS - front < 30 && lineS - front > -5) return;
    }
    const path = n.path;
    // the turn at the next junction, looking through a short link that goes straight on inside it
    let k = path.edges.indexOf(edge), turn = "straight";
    for (; k + 1 < path.edges.length; k++) {
      const a = path.edges[k], b = path.edges[k + 1];
      turn = this.map.classifyTurn(this.map.turnAngle(a.id, b.id));
      if (turn !== "straight" || this.map.edges.get(b.id).length >= LINK_M || k + 2 >= path.edges.length) break;
    }
    let dir = 0;
    if (curbward) dir = edge.lane < e.lanes - 1 ? 1 : 0;
    else if (turn === "left" && edge.lane > 0) dir = -1;
    else if (turn === "right" && edge.lane < e.lanes - 1) dir = 1;
    else if (turn === "straight" && n.lead && n.lead.gap < 35 && n.lead.v < n.v0 - 2.5 && this.random() < 0.02 * (n.driver ? n.driver.lcRate : 1)) {
      dir = edge.lane > 0 ? -1 : 1;
    }
    if (!dir) return;
    const to = edge.lane + dir;
    if (to < 0 || to >= e.lanes) return;
    const lane = this.map.lane(edge.id, to);
    const me = projectPoint(lane.pts, lane.cum, [n.x, n.y], null);
    for (const o of [this.world.ego, ...this.vehicles]) {
      if (o === n || Math.abs(o.x - n.x) > 60 || Math.abs(o.y - n.y) > 60) continue;
      const p = projectPoint(lane.pts, lane.cum, [o.x, o.y], null);
      if (!p || Math.abs(p.lateral) > 2.2) continue;
      const ds = p.s - me.s;
      const need = ds >= 0 ? 8 + Math.max(0, n.v - o.v) * 2 : 8 + Math.max(0, o.v - n.v) * 2.5;
      const ns = n.spec || CAR, os = o.spec || CAR;
      const bodyGap = ds >= 0 ? ns.length - ns.rearOverhang + os.rearOverhang : os.length - os.rearOverhang + ns.rearOverhang;
      if (Math.abs(ds) < need + bodyGap) return;
    }
    n.lc = { dir, to, edge: edge.id, width: Math.abs(e.lane_offsets[to] - e.lane_offsets[edge.lane]), t: 0, T: 3.5 };
  }

  // At a red light: whether this driver may turn right on red now. It turns right here from the
  // curb lane, has stopped fully at the line, the junction is clear and nothing is coming that it
  // must yield to.
  rightOnRed(n, e, bumperToLine, front, dt) {
    if (!this.map.rightOnRed) return false;
    const path = n.path, i = path.edges.indexOf(e), next = path.edges[i + 1];
    const edge = this.map.edges.get(e.id);
    if (!next || e.lane !== edge.lanes - 1 || this.map.classifyTurn(this.map.turnAngle(e.id, next.id)) !== "right") return false;
    if (n.stopMem.update(e.control, bumperToLine, n.v, dt) !== "completed") return false;
    // (not across the protected left turns of an advance green opposite)
    const inter = this.map.intersections.get(e.control.id);
    if (inter && advanceHolds(inter, e.id, this.world.t)) return false;
    if (this.boxBusy(n, e) || this.crossComing(n, e.to, RTOR_EXTRA_GAP_S)) return false;
    const crowd = this.world.crowd;
    return !kerbConflict(path.pts, path.cum, front - 2, front + 30, crowd, crowd.list, this.world.t, RTOR_WALK_S);
  }

  // Someone coming the other way who will reach this node within 6 s (a slow left turn needs
  // about that long to clear the oncoming lane).
  oncoming(n, nodeId) {
    const node = this.map.nodes.get(nodeId);
    if (!node) return false;
    for (const o of [this.world.ego, ...this.vehicles]) {
      if (o === n || o.v < 1) continue;
      if (Math.abs(wrap(o.psi - n.psi)) < Math.PI * 5 / 6) continue;
      const dx = node.x - o.x, dy = node.y - o.y, d = Math.hypot(dx, dy);
      if (d > 80 || dx * Math.cos(o.psi) + dy * Math.sin(o.psi) < 0) continue;
      if (d / o.v < 6) return true;
    }
    return false;
  }

  // Anyone moving who will reach this node before we could get across: within the driver's accepted
  // gap (4.5 to 6.5 s; the bolder the driver, the shorter).
  crossComing(n, nodeId, extra = 0) {
    const node = this.map.nodes.get(nodeId);
    if (!node) return false;
    const gapS = (n.driver ? 3.2 + n.driver.T * 1.7 : 5) + extra;
    for (const o of [this.world.ego, ...this.vehicles]) {
      if (o === n || o.v < 1) continue;
      if (Math.abs(wrap(o.psi - n.psi)) < Math.PI / 6) continue;   // going our way
      const dx = node.x - o.x, dy = node.y - o.y, d = Math.hypot(dx, dy);
      if (d > 90 || d < 1) continue;
      const closing = (dx * Math.cos(o.psi) + dy * Math.sin(o.psi)) / d;
      if (closing > 0.7 && d / o.v < gapS) return true;
    }
    return false;
  }

  // At a junction without a sign or signal, whether someone with the right of way over this driver's
  // street (`edgeId`), coming in on another, would get there before it, or within 2 s after it
  // (in which case it could not clear the junction in time).
  givesWay(n, edgeId, toNode) {
    const node = this.map.nodes.get(this.map.edges.get(edgeId).to);
    if (!node) return false;
    const mine = toNode / Math.max(1, n.v);
    for (const o of [this.world.ego, ...this.vehicles]) {
      // (anything moving counts, however slowly: the ETA below decides whether it matters)
      if (o === n || o.v < 0.2) continue;
      const dx = node.x - o.x, dy = node.y - o.y, d = Math.hypot(dx, dy);
      if (d > 90 || d < 1 || (dx * Math.cos(o.psi) + dy * Math.sin(o.psi)) / d < 0.7) continue;
      const a = approachTo(this.map, o, node.id);
      if (!a || !outranks(this.map, a.edge, edgeId)) continue;
      const eta = Math.max(0, a.to_node_m) / o.v;
      if (eta < Math.min(GIVE_WAY_HORIZON_S, mine + GIVE_WAY_AFTER_S)) return true;
    }
    return false;
  }

  // At an all-way stop on `edgeId`, whether someone crossing its way, coming in on a street without a
  // sign at the same junction (the link between two junctions close together, say), would get there
  // within a few seconds, or is moving within UNSIGNED_NEAR_M of it: it does not stop, and has the
  // right of way.
  unsignedComing(n, edgeId) {
    const nodeId = this.map.edges.get(edgeId).to, node = this.map.nodes.get(nodeId);
    if (!node) return false;
    const gapS = n.driver ? 3.2 + n.driver.T * 1.7 : 5;
    for (const o of [this.world.ego, ...this.vehicles]) {
      if (o === n || o.v < 0.3 || Math.abs(wrap(o.psi - n.psi)) < Math.PI / 6) continue;
      if (Math.abs(node.x - o.x) > 90 || Math.abs(node.y - o.y) > 90) continue;
      const a = approachTo(this.map, o, nodeId);
      if (!a || a.edge === edgeId || this.map.edges.get(a.edge)?.control) continue;
      // (moving at all, and close: one on a short link speeds up as it comes)
      if (a.to_node_m < UNSIGNED_NEAR_M || Math.max(0, a.to_node_m) / o.v < gapS) return true;
    }
    return false;
  }

  // Whether someone crossing this driver's way is pulling away from an all-way stop's line at junction
  // `nodeId`, within UNSIGNED_NEAR_M of it (for one coming in on a street without a sign there; see
  // unsignedComing, the other side of it).
  allWayLeaving(n, nodeId) {
    const node = this.map.nodes.get(nodeId);
    if (!node) return false;
    for (const o of [this.world.ego, ...this.vehicles]) {
      if (o === n || o.v < 0.5 || Math.abs(wrap(o.psi - n.psi)) < Math.PI / 6) continue;
      if (Math.abs(node.x - o.x) > UNSIGNED_NEAR_M + 5 || Math.abs(node.y - o.y) > UNSIGNED_NEAR_M + 5) continue;
      const a = approachTo(this.map, o, nodeId);
      if (a && a.to_node_m < UNSIGNED_NEAR_M && controlAt(this.world, this.map.edges.get(a.edge)?.control, a.edge)?.all_way) return true;
    }
    return false;
  }

  isJunction(nodeId) {
    if (!this.junctions) this.junctions = new Map();
    if (!this.junctions.has(nodeId)) {
      const ids = [...(this.map.inn.get(nodeId) || []), ...(this.map.out.get(nodeId) || [])];
      const neighbors = new Set(ids.map((id) => { const e = this.map.edges.get(id); return e.from === nodeId ? e.to : e.from; }));
      this.junctions.set(nodeId, neighbors.size >= 3);
    }
    return this.junctions.get(nodeId);
  }

  boxBusy(n, e) {
    const node = this.map.nodes.get(e.to);
    if (!node) return false;
    for (const o of [this.world.ego, ...this.vehicles]) {
      if (o === n) continue;
      if (Math.hypot(o.x - node.x, o.y - node.y) > BOX_M) continue;
      const diff = Math.abs(wrap(o.psi - n.psi));
      if (diff > Math.PI / 6 && diff < Math.PI * 5 / 6) return true;
    }
    return false;
  }

  blockedByVehicle(n) {
    for (const o of [this.world.ego, ...this.vehicles]) {
      if (o === n) continue;
      const local = n.toLocal(o.x, o.y);
      if (local.ahead > 0 && local.ahead < 8 && Math.abs(local.right) < 2) return true;
    }
    return false;
  }

  recoverPath(n) {
    const near = this.map.nearestLane(n.x, n.y, n.psi, 40);
    if (!near) return;
    // Rebase the plan without teleporting the body or instantaneously stopping a moving car. (A bus
    // back on its run keeps to it.)
    const k = n.transit && !n.transit.done ? n.transit.edges.indexOf(near.lane.edge, n.transit.k) : -1;
    if (k >= 0) this.startRun(n, n.transit.edges, k, near.lane.idx, near.s);
    else n.path.start(near.lane.edge, near.lane.idx, near.s);
    n.stopMem.reset();
    n.lc = null;
  }
}
