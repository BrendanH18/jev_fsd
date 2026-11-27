import { crossingGap, laneChangeBodyGap, laneChangeGap, pathLine, pickSpawnLane } from "./traffic-geometry.js";
import { inspectTraffic } from "./traffic-inspection.js";
import { reserveSlot } from "./parking.js";
// Traffic: NPC cars that follow lanes, pick turns at junctions, keep gaps with the Intelligent
// Driver Model, and obey lights and stop signs. They also react to the ego car. Now and then a car
// parked up ahead of the ego signals, waits for a gap, and pulls out into the lane. Nobody enters a
// signalled junction without room past it (sim/junction-box.js). At a
// construction site, follow its temporary controls. Where a road crew
// closes one of two lanes, drivers zipper merge: both lanes up to the merge point, then one from each
// in turn.

import { Vehicle, CAR, BIKE, comfort } from "./vehicle.js";
import { lookahead, purePursuit, speedControl } from "./controller.js";
import { cumulative, pointAt, headingAt, projectPoint, joinLanes } from "../map/mapdata.js";
import { advanceHolds, approachPhase, movementSignal, StopMemory } from "./signals.js";
import { rng } from "../common.js";
import { wrap } from "./world.js";
import { obbOverlap } from "./collision.js";
import { ringBusy } from "./roundabout.js";
import { crosswalkConflict, kerbConflict } from "./pedestrians.js";
import { current as weather } from "./weather.js";
import { approachTo, outranks } from "./priority.js";
import { ZONE_LIMIT_MPS, zoneAt } from "./speed-zones.js";
import { boxHold } from "./junction-box.js";
import {
  controlAt,
  buildFleetFeatures,
  featureObstacle,
  applyTrafficPathPolicy,
  firstHookResult,
  hooks,
  isParkingTraffic,
  phaseBansRedTurns,
} from "./features/index.js";

// How traffic takes the registered features (sim/features/index.js): spotted on its way each step, a
// re-plan round them, a move inside its lane, and where it stops for them; each where that feature's own
// code used to be. (With `geese` on, say, drivers and cyclists slow for a gaggle of Canada geese coming up
// to the kerb ahead and stop short of their way across until the last goose is off the roadway.)
const TRAFFIC_MANAGE = hooks("trafficManage"),
  TRAFFIC_MANAGE_BUSES = hooks("trafficManage", "buses"),
  TRAFFIC_MANAGE_SCHOOL_BUSES = hooks("trafficManage", "schoolBuses"),
  TRAFFIC_LANE_CHANGE = hooks("trafficLaneChange"),
  TRAFFIC_RECOVER = hooks("trafficRecover"),
  TRAFFIC_MANAGE_BEFORE_PLOWS = hooks("trafficManage", "beforePlows"),
  TRAFFIC_MANAGE_AFTER_PLOWS = hooks("trafficManage", "afterPlows"),
  TRAFFIC_MANAGE_BEFORE_TRANSIT = hooks("trafficManage", "beforeTransit"),
  TRAFFIC_SPAWN_BLOCKED = hooks("trafficSpawnBlocked"),
  TRAFFIC_RELEASE_CONTROL = hooks("trafficReleaseControl"),
  TRAFFIC_CORRIDOR = hooks("trafficCorridor"),
  TRAFFIC_DRIVER = hooks("trafficDriver"),
  TRAFFIC_MANEUVER = hooks("trafficManeuver"),
  TRAFFIC_SPECIAL = hooks("trafficManeuver", "beforeSpecial"),
  TRAFFIC_STOP = hooks("trafficStop"),
  TRAFFIC_HOLD = hooks("trafficHold"),
  TRAFFIC_HOLD_BUSES = hooks("trafficHold", "buses"),
  TRAFFIC_STANDING = hooks("trafficStanding"),
  TRAFFIC_INDICATOR = hooks("trafficIndicator"),
  AFTER_MERGE = hooks("trafficStop", "afterMerge"),
  TRAFFIC_LEADER_HOLD = hooks("trafficLeaderHold"),
  TRAFFIC_KEEP_BACK = hooks("trafficKeepBack"),
  TRAFFIC_PARKING_PLAN = hooks("trafficParkingPlan"),
  TRAFFIC_START = hooks("trafficStart"),
  TRAFFIC_CONTROL_START = hooks("trafficStart", "beforeControl"),
  TRAFFIC_CONTROL = hooks("trafficControl"),
  TRAFFIC_REPLAN = hooks("trafficReplan"),
  TRAFFIC_BEFORE_CORNER = hooks("trafficReplan", "beforeCorner"),
  TRAFFIC_CORNER = hooks("trafficReplan", "corner"),
  TRAFFIC_TURN_BLOCKED = hooks("trafficTurnBlocked"),
  RED_TURN_BLOCKED = hooks("turnOnRedBlocked"),
  TRAFFIC_PARKING_REACH = hooks("trafficParkingReach");
const TRAFFIC_BYPASS = hooks("trafficBypass"),
  TRAFFIC_ACTORS = hooks("trafficActors"),
  BEFORE_LANE_MOVES = hooks("trafficLane", "beforeLaneMoves"),
  TRAFFIC_LANE = hooks("trafficLane", "laneMoves"),
  TRAFFIC_KEEP = hooks("trafficLane", "late"),
  TRAFFIC_YIELD = hooks("trafficYield"),
  EDGE_TRAFFIC_SPEED = hooks("trafficSpeed", "limit"),
  FOLLOWING_TRAFFIC_SPEED = hooks("trafficSpeed", "following"),
  ORDINARY_TRAFFIC_SPEED = hooks("trafficSpeed", "ordinary"),
  APPROACH_TRAFFIC_SPEED = hooks("trafficSpeed", "beforeControl"),
  CLEARING_TRAFFIC_SPEED = hooks("trafficSpeed", "clearing"),
  SIGNAL_PROCEED = hooks("trafficSignalProceed"),
  SIGNAL_HOLD = hooks("trafficSignalHold"),
  SIGNAL_POLICY = hooks("trafficSignalPolicy"),
  SIGNAL_DECISION = hooks("trafficSignalDecision"),
  TRAFFIC_LANE_INTO = hooks("trafficLaneInto"),
  TRAFFIC_SUCCESSOR_POOL = hooks("trafficSuccessorPool"),
  TRAFFIC_SPAWN_LANE_BLOCKED = hooks("trafficSpawnLaneBlocked"),
  TRAFFIC_LANE_DIRECTION = hooks("trafficLaneDirection"),
  RED_TURN_LANE = hooks("trafficRedTurnLane"),
  PRIORITY_JUNCTION = hooks("priorityJunction"),
  PRIORITY_TRAFFIC_OUTSIDE = hooks("priorityTrafficOutside"),
  TRAFFIC_SPEED = hooks("trafficSpeed"),
  TRAFFIC_PULL_OUT = hooks("trafficPullOut");

const TRAFFIC_OVERTAKING = hooks("trafficOvertaking");
const TRAFFIC_LANE_CONTROL = hooks("trafficLaneControl");
const TRAFFIC_DISPATCH = hooks("trafficManage", "dispatch");
const SPECIAL_LEADER = hooks("trafficFollowingLeader");
const TRAFFIC_LEAD_POLICY = hooks("trafficLeadPolicy");
const PASSING_LANE_BLOCKED = hooks("trafficPassingLaneBlocked");
const MERGE_GAP = hooks("trafficMergeGap");
// (a driver giving way: its call, its move toward the kerb, where it stops; one stood down rejoining its
// lane's line; and hanging back behind a vehicle with right of way)
const TRAFFIC_GIVE_WAY = hooks("trafficGiveWay"),
  TRAFFIC_PULL_OVER = hooks("trafficPullOver"),
  TRAFFIC_REJOIN = hooks("trafficRejoin"),
  TRAFFIC_STOP_AT = hooks("trafficStopAt"),
  TRAFFIC_HANG_BACK = hooks("trafficHangBack");

export const IDM = { aMax: 1.5, b: 2.0, s0: 2.0, T: 1.2 };

export function featureTrafficSpeed(world, n, front, speeds = TRAFFIC_SPEED, context) {
  let limit = Infinity;
  for (const speed of speeds) limit = Math.min(limit, speed(world, n, front, context));
  return limit;
}
const UNSIGNED_NEAR_M = 15;
// A driver backing up (`backOff`) stops with this much room left behind it.
const BACK_CLEAR_M = 1.5;

// Seeded per-driver IDM and lane-change temperament so adding NPCs does not shift spawn points.
function driverProfile(random, bike = false) {
  const r = random();
  const assertive = r < 0.2,
    timid = r > 0.85;
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
const PALETTE = [
  0xeeeeea, 0x8d9299, 0x1a1c20, 0xc4c8cc, 0x2b3a55, 0x9b1e1e, 0xf2f2ee, 0x4a4f57, 0x0f1114, 0x6b7f5e, 0xb9b3a5,
];
export const LOOK_M = 60;
const ZONE_AHEAD_M = 15;
export const BIKES = 12;
const BIKE_COLORS = [0x2b6cb0, 0xc53030, 0x2f855a, 0xd69e2e, 0x553c9a, 0x1a202c, 0xdd6b20];
// Mirrors SHARP_TURN in jev/routing.py: a turn of exactly this much is still allowed.
const SHARP_TURN = (130 * Math.PI) / 180;
const LINK_M = 20; // a street this short going straight on is a link inside a junction
// A driver starts a lane change no later than LC_END_M before its street ends, nor within LC_END_M
// before a control line (maybeChangeLane), so a turn from the wrong lane needs this much stretch
// before that, per lane to cross, to find a gap in (NpcPath.reachesTurnLane).
const LC_END_M = 30;
const LC_ROOM_M = 20;
const BOX_M = 9;
export const LEADER_MARGIN_M = 0.3; // beyond two half-widths: anything closer to the path is in the way
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
// A long, heavy vehicle (a bus, say) also stops for any part of a body in its way over this many
// metres ahead at least.
const LONG_BODY_LOOK_M = 6;
// Passing a vehicle standing at the kerb (a bus at its stop, pulled in toward the curb, say), a driver
// eases left in its lane at 0.5 m/s, from 40 m before it, as far as it must to clear it by the usual
// margin (LEADER_MARGIN_M) if its lane leaves room for that 0.1 m inside its left edge; else it waits
// behind.
const NUDGE_MPS = 0.5;
const NUDGE_LOOK_M = 40;
// (a long one is looked for all along its body)
const isLong = (o) => !!featureObstacle(o)?.long;

// How far ahead of a cyclist's front wheel any part of another vehicle's body is in its way, or
// null: within its own body (and 0.05 m) moving straight on as it is heading for the next 2 m, or
// within half its width plus 0.1 m of the next 8 m of its path, where it is `from` metres right of
// its path now and heads for `side` metres right of it over those 8 m.
function bodyOnPath(n, o, front, from, side) {
  const b = o.obb(),
    c = Math.cos(b.heading),
    s = Math.sin(b.heading),
    m = n.spec.width / 2 + 0.1;
  const own = n.obb(),
    ux = Math.cos(n.psi),
    uy = Math.sin(n.psi);
  for (let d = 0; d <= BODY_AHEAD_M; d += 0.25)
    if (obbOverlap({ ...own, center: [own.center[0] + ux * d, own.center[1] + uy * d] }, b, 0.05)) return d;
  for (let d = 0; d <= BODY_LOOK_M; d += 0.5) {
    const [x, y] = n.path.offsetPointAt(Math.min(n.path.length, front + d), from + ((side - from) * d) / BODY_LOOK_M);
    const dx = x - b.center[0],
      dy = y - b.center[1];
    if (Math.abs(dx * c + dy * s) <= b.halfLength + m && Math.abs(dy * c - dx * s) <= b.halfWidth + m) return d;
  }
  return null;
}

// A long vehicle's nose swings outside its rear axle's lane through a turn. Predict the body
// with the same steering and vehicle model it drives with, rather than laying it on the lane's
// tangent. Look far enough to brake, including actuator response, even on a slippery road.
export const bodySweepLook = (n, least) => Math.max(least, n.v * 0.8 + (n.v * n.v) / (2 * comfort().decel));
export function sweptBodyGap(n, obstacle, offset, least, margin = 0.1) {
  const look = bodySweepLook(n, least);
  const body = obstacle.obb();
  if (Math.hypot(obstacle.x - n.x, obstacle.y - n.y) >= n.spec.length + look + 6 || obbOverlap(n.obb(), body, 0.05))
    return null;
  const car = n.clone(),
    speed = Math.max(1, n.v),
    dt = Math.min(0.1, 0.5 / speed);
  for (let d = 0; d <= look; d += speed * dt) {
    if (d > 0 && obbOverlap(car.obb(), body, margin)) return Math.max(0, d - speed * dt);
    const p = projectPoint(n.path.pts, n.path.cum, [car.x, car.y], null);
    // Hold the observation speed: braking must not shorten the path we check for a reason to brake.
    car.v = speed;
    car.a = 0;
    car.step(dt, { steer: purePursuit(car, n.path, p.s, offset), accel: 0 });
  }
  return null;
}

// How far right of a lane's centre a cyclist rides in the street's parking lane, or null when the
// lane is not beside the right curb or has no parking lane wide enough.
export function stripOffset(e, laneIdx) {
  if (!e || e.ring || !e.parking || laneIdx !== e.lanes - 1) return null;
  const edge = e.lane_offsets[laneIdx] + e.lane_width / 2,
    room = e.asphalt[1] - edge;
  if (room < STRIP_MIN_M) return null;
  return Math.min(
    e.lane_width / 2 + room - BIKE.width / 2 - 0.3,
    Math.max(e.lane_width / 2 + STRIP_INSET_M, STRIP_SIDE_M),
  );
}

export class NpcPath {
  // A path is a chain of lane polylines; we keep the current lane and the next one joined.
  // (`classes`: preferred street classes, when available)
  constructor(map, random, { bike = false, world = null, classes = null } = {}) {
    this.constraintsWorld = world;
    this.map = map;
    this.random = random;
    this.bike = bike;
    this.classes = classes;
    this.edges = [];
    this.pts = [];
    this.cum = [0];
    this.length = 0;
  }
  start(edgeId, laneIdx, s, planned = []) {
    this.edges = [];
    this.pts = [];
    this.cum = [0];
    this.length = 0;
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
    if (!cur || !this.map.lane(cur.id, laneIdx)) return;
    let prev = { id: cur.id, lane: laneIdx };
    const planned = this.edges
      .slice(i + 1)
      .map((e) => (prev = { id: e.id, lane: this.laneInto(prev.id, prev.lane, e.id) }));
    this.start(
      cur.id,
      laneIdx,
      s,
      planned.map((e) => [e.id, e.lane]),
    );
  }
  // The lane taken onto edge `next` from lane `lane` of edge `from`: turns into the nearest lane (left
  // turns into the leftmost, right into the rightmost), going straight keeps the same lane, and a
  // cyclist rides the curb lane.
  laneInto(from, lane, next) {
    const edge = this.map.edges.get(next),
      turn = this.map.classifyTurn(this.map.turnAngle(from, next));
    const laneOverride = firstHookResult(TRAFFIC_LANE_INTO, this, edge, turn, lane);
    if (laneOverride) return laneOverride.index;
    return this.bike
      ? edge.lanes - 1
      : turn === "left"
        ? 0
        : turn === "right"
          ? edge.lanes - 1
          : Math.min(lane, edge.lanes - 1);
  }
  append(edgeId, laneIdx) {
    const lane = this.map.lane(edgeId, laneIdx) || this.map.lane(edgeId, 0);
    // the turn between the two edges decides whether the corner is rounded, as in the router
    const previous = this.edges.length ? this.edges[this.edges.length - 1].id : null;
    this.pts = joinLanes(this.pts, lane.pts, { turn: previous === null ? null : this.map.turnAngle(previous, edgeId) });
    this.cum = cumulative(this.pts);
    this.length = this.cum[this.cum.length - 1];
    const edge = this.map.edges.get(edgeId);
    const sStart = this.edges.length ? this.edges[this.edges.length - 1].sEnd : 0;
    this.edges.push({
      id: edgeId,
      lane: laneIdx,
      sStart,
      sEnd: this.length,
      control: edge.control || null,
      to: edge.to,
      limit: edge.limit,
    });
  }
  extend() {
    if (!this.edges.length) return false;
    // bounded: joining a very short lane after a rounded corner can add almost no length
    for (let guard = 0; guard < 24 && this.length - this.s < LOOK_M * 2.5; guard++) {
      const last = this.edges[this.edges.length - 1];
      const succ = this.map
        .successors(last.id)
        .filter((id) => !TRAFFIC_TURN_BLOCKED.some((blocked) => blocked(this.constraintsWorld, last.id, id, this.bike)))
        // (never into a block closed for an event: sim/road-closures.js)
        .filter((id) => !this.closures?.closed.has(id));
      if (!succ.length) return false;
      // no U-turns, nor turns so sharp they double back (the tip of a traffic island)
      const noU = succ.filter((e) => Math.abs(this.map.turnAngle(last.id, e)) <= SHARP_TURN);
      let pool = noU.length ? noU : succ;
      for (const filter of TRAFFIC_SUCCESSOR_POOL) pool = filter(this, pool);
      if (this.classes) {
        const kept = pool.filter((id) => this.classes.has(this.map.edges.get(id).cls));
        if (kept.length) pool = kept;
      }
      // cyclists keep to bike routes where they can
      if (this.bike) {
        const routes = pool.filter((id) => this.map.edges.get(id).bike);
        if (routes.length && this.random() < 0.85) pool = routes;
      }
      // no turn from a lane it has no room to leave for the turn's lane: it would turn across the next
      // lane, into whoever is in it (Bloor Street West after two short blocks)
      const reached = pool.filter((id) => this.reachesTurnLane(last, id));
      if (reached.length) pool = reached;
      const next = pool[Math.floor(this.random() * pool.length)];
      this.append(next, this.laneInto(last.id, last.lane, next));
    }
    return true;
  }
  // Whether a car in lane `last.lane` of the last planned edge can be in the lane for turning onto
  // `next` (the leftmost for a left, the curb lane for a right) by the junction: it is in it already,
  // or the planned edges up to there leave room to change lanes. maybeChangeLane changes lanes on an
  // edge up to LC_END_M before its end and its control line, for a turn at its end or beyond short
  // links that go straight on, so only that edge and such links count.
  reachesTurnLane(last, next) {
    const e = this.map.edges.get(last.id),
      turn = this.map.classifyTurn(this.map.turnAngle(last.id, next));
    const want = turn === "left" ? 0 : turn === "right" ? e.lanes - 1 : last.lane;
    if (this.bike || want === last.lane) return true;
    let room = 0;
    for (let k = this.edges.length - 1; k >= 0; k--) {
      const x = this.edges[k],
        xe = this.map.edges.get(x.id);
      let end = x.sEnd - LC_END_M;
      if (x.control) end = Math.min(end, pathLine(x, xe.length, x.control.s_line) - LC_END_M);
      // (a street with fewer lanes than the turn's has none to change into)
      if (xe.lanes >= e.lanes) room += Math.max(0, end - Math.max(x.sStart, this.s ?? 0));
      const before = this.edges[k - 1];
      if (!before || xe.length >= LINK_M || this.map.classifyTurn(this.map.turnAngle(before.id, x.id)) !== "straight")
        break;
    }
    return room >= LC_ROOM_M * Math.abs(want - last.lane);
  }
  trim() {
    // drop edges fully behind us to keep the polyline short
    while (this.edges.length > 2 && this.edges[1].sStart + 30 < this.s) {
      const cut = this.cum.findIndex((c) => c >= this.edges[0].sEnd);
      if (cut < 0) break;
      this.edges.shift();
      // A previous trim may already have removed this short edge's geometry.
      if (cut === 0) break;
      const removed = this.cum[cut];
      this.pts = this.pts.slice(cut);
      this.cum = cumulative(this.pts);
      this.length = this.cum[this.cum.length - 1];
      this.s -= removed;
      for (const e of this.edges) {
        e.sStart -= removed;
        e.sEnd -= removed;
      }
    }
  }
  currentEdge() {
    return this.edges.find((e) => this.s < e.sEnd) || this.edges[this.edges.length - 1];
  }
  offsetPointAt(s, d) {
    const p = pointAt(this.pts, this.cum, s),
      h = headingAt(this.pts, this.cum, s);
    return [p[0] + Math.sin(h) * d, p[1] - Math.cos(h) * d];
  }
  pointAt(s) {
    return pointAt(this.pts, this.cum, s);
  }
  headingAt(s) {
    return headingAt(this.pts, this.cum, s);
  }
}

const smooth = (u) => {
  const x = Math.max(0, Math.min(1, u));
  return x * x * (3 - 2 * x);
};

// Fastest speed from which a driver can brake comfortably to every bend's cornering speed over the
// next 40 m of the path. NPCs corner a little harder than the ego's comfort target.
export function curveSpeed(path, s) {
  const { lat, decel } = comfort();
  let best = Infinity;
  for (let d = 0; d <= 40 && s + d < path.length; d += 3) {
    const at = s + d;
    const dh = Math.abs(wrap(path.headingAt(Math.min(path.length, at + 6)) - path.headingAt(Math.max(0, at - 6))));
    if (dh < 0.02) continue;
    const vc = Math.sqrt((lat * 1.25 * 12) / dh);
    best = Math.min(best, Math.sqrt(vc * vc + 2 * decel * d));
  }
  return best;
}

export class NpcFleet {
  constructor(world, { count = 40, bikes = BIKES, seed = 7, ...features } = {}) {
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
    this.vehicles = [];
    this.spawn(count);
    this.spawnBikes(bikes);
    const makePath = (map, random, options) => new NpcPath(map, random, { ...options, world: this.world });
    buildFleetFeatures(this, features, seed, makePath, "early");
    buildFleetFeatures(this, features, seed, makePath);
    world.npcs = this.vehicles;
  }

  inspectTraffic() {
    return inspectTraffic(this);
  }

  // Cyclists start on bike routes, in the curb lane, riding its right-hand side.
  spawnBikes(count) {
    const lanes = this.map.laneList.filter(
      (l) =>
        l.length > 25 &&
        l.edgeRef.bike &&
        l.idx === l.edgeRef.lanes - 1 &&
        !l.edgeRef.ring &&
        !TRAFFIC_SPAWN_LANE_BLOCKED.some((blocked) => blocked(this.world, l, "bicycle")),
    );
    if (!lanes.length) return;
    const totalLen = lanes.reduce((a, l) => a + l.length, 0);
    let made = 0,
      attempts = 0;
    while (made < count && attempts++ < count * 20) {
      const lane = pickSpawnLane(lanes, totalLen, this.random);
      const s = 5 + this.random() * (lane.length - 10);
      const p = pointAt(lane.pts, lane.cum, s);
      if (Math.hypot(p[0] - this.world.ego.x, p[1] - this.world.ego.y) < 30) continue;
      if (this.vehicles.some((v) => Math.hypot(v.x - p[0], v.y - p[1]) < 10)) continue;
      const v = new Vehicle(p[0], p[1], headingAt(lane.pts, lane.cum, s), 0, BIKE);
      v.id = `bike_${++made}`;
      v.kind = "bike";
      v.color = BIKE_COLORS[made % BIKE_COLORS.length];
      v.path = new NpcPath(this.map, this.random, { bike: true });
      applyTrafficPathPolicy(this.world, v.path);
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
    const lanes = this.map.laneList.filter(
      (l) => l.length > 25 && !TRAFFIC_SPAWN_LANE_BLOCKED.some((blocked) => blocked(this.world, l, "car")),
    );
    if (!lanes.length) return;
    const totalLen = lanes.reduce((a, l) => a + l.length, 0);
    let attempts = 0;
    while (this.vehicles.length < count && attempts++ < count * 20) {
      const lane = pickSpawnLane(lanes, totalLen, this.random);
      const s = 5 + this.random() * (lane.length - 10);
      const p = pointAt(lane.pts, lane.cum, s);
      if (Math.hypot(p[0] - this.world.ego.x, p[1] - this.world.ego.y) < 30) continue;
      if (this.vehicles.some((v) => Math.hypot(v.x - p[0], v.y - p[1]) < 14)) continue;
      const v = new Vehicle(p[0], p[1], headingAt(lane.pts, lane.cum, s), 0);
      v.id = `car_${this.vehicles.length + 1}`;
      v.color = PALETTE[this.vehicles.length % PALETTE.length];
      v.path = new NpcPath(this.map, this.random, { world: this.world });
      applyTrafficPathPolicy(this.world, v.path);
      v.path.start(lane.edge, lane.idx, s);
      v.v0 = lane.edgeRef.limit * (0.85 + this.random() * 0.2);
      v.driver = driverProfile(this.drivers);
      v.stopMem = new StopMemory();
      v.frozen = 0;
      v.waiting = 0;
      this.vehicles.push(v);
    }
  }

  manageTraffic(dt) {
    const world = this.world;
    this.nextPull -= dt;
    if (this.nextPull <= 0) {
      this.nextPull = 14 + this.events() * 18;
      this.maybePullOut();
    }
    this.nextPark -= dt;
    if (this.nextPark <= 0) {
      this.nextPark = 15 + this.parkingEvents() * 20;
      this.maybePark();
    }
    for (const manage of TRAFFIC_MANAGE_BEFORE_TRANSIT) manage(world, this, dt);
    for (const manage of TRAFFIC_MANAGE_BUSES) manage(world, this, dt);
    for (const manage of TRAFFIC_MANAGE_SCHOOL_BUSES) manage(world, this, dt);
    for (const manage of TRAFFIC_MANAGE_BEFORE_PLOWS) manage(world, this, dt);
    for (const manage of TRAFFIC_DISPATCH) manage(world, this, dt);
    for (const manage of TRAFFIC_MANAGE_AFTER_PLOWS) manage(world, this, dt);
    for (const manage of TRAFFIC_MANAGE) manage(world, this, dt);
  }

  spawnBlocked(x, y) {
    return TRAFFIC_SPAWN_BLOCKED.some((blocked) => blocked(this.world, x, y));
  }

  step(dt) {
    const world = this.world;
    this.manageTraffic(dt);
    const all = [world.ego, ...this.vehicles];
    const extraTraffic = TRAFFIC_ACTORS.flatMap((actors) => actors(world) ?? []);
    // (what stands at the kerb that drivers ease past: buses at their stops, say)
    const standing = TRAFFIC_STANDING.flatMap((list) => list(world, this) ?? []);
    const scene = { all, extraTraffic, standing };
    for (const n of [...this.vehicles]) this.stepVehicle(n, dt, scene);
  }

  // One driver's step, in stages that share `t`, what this step has found so far: where it is on its path,
  // the line it keeps to in its lane, what it follows, where it stops, and then the pedals and the wheel.
  // `scene` is what every driver sees this step: `all` the moving vehicles, `extraTraffic` the actors
  // outside the fleet, `standing` what stands at the kerb.
  stepVehicle(n, dt, scene) {
    // (with road closures on, say, every driver's way keeps out of a closed block)
    for (const start of TRAFFIC_START) start(this.world, n);
    if (this.heldInPlace(n, dt, scene)) return;
    const t = this.placeOnPath(n);
    this.chooseLane(n, dt, t, scene);
    this.laneOffset(n, dt, t, scene);
    this.leaderOnPath(n, t, scene);
    this.leaderByBody(n, t, scene);
    this.leaderHolds(n, dt, t);
    this.controlAhead(n, dt, t, scene);
    this.stopLines(n, t);
    this.junctionWaits(n, t);
    this.unstick(n, dt, t);
    this.featureHolds(n, dt, t, scene);
    this.drive(n, dt, t);
  }

  // A driver that is not driving its lane this step: frozen, waiting at the kerb to pull out, parking,
  // in a registered feature's manoeuvre, backing off or holding still. True when it has been stepped.
  heldInPlace(n, dt, { all, extraTraffic }) {
    const world = this.world;
    if (n.frozen > 0) {
      n.frozen -= dt;
      n.v = 0;
      return true;
    }
    if (TRAFFIC_SPECIAL.some((step) => step(world, this, n, dt, all, extraTraffic))) return true;
    if (n.pull && n.pull.wait > 0) {
      n.signal = n.pull.lat > 0 ? "left" : "right";
      if (this.pullClear(n)) n.pull.wait -= dt;
      n.v = 0;
      return true;
    }
    // Still at the curb (a parked car close in front, or the driver slow to move off): look again
    // until the car is actually moving, and go back to waiting if someone is coming now.
    if (n.pull && !n.pull.moving) {
      if (n.v > 0.3) n.pull.moving = true;
      else if (!this.pullClear(n)) {
        n.pull.t = 0;
        n.pull.wait = 0.5;
        n.v = 0;
        return true;
      }
    }
    if (n.parking) {
      this.parkStep(n, dt);
      return true;
    }
    if (TRAFFIC_MANEUVER.some((step) => step(world, this, n, dt))) return true;
    if (n.backoff) {
      this.backOff(n, dt);
      return true;
    }
    if (n.holdFor > 0) {
      n.holdFor -= dt;
      n.step(dt, { steer: n.delta, accel: -3 });
      if (n.v < 0) n.v = 0;
      return true;
    }
    return false;
  }

  // Where the driver is on its path: a finished lane change moves the path onto the new lane, the path is
  // recovered or re-planned where it needs to be, then extended and trimmed. Starts this step's `t`.
  placeOnPath(n) {
    const world = this.world;
    const path = n.path;
    // (a registered feature's vehicle can keep a path of its own: a streetcar keeps to its track)
    const pathKind = featureObstacle(n)?.pathPolicy?.(n);
    if (pathKind !== false) applyTrafficPathPolicy(world, path, pathKind ?? null);
    if (n.lc && n.lc.t >= n.lc.T) {
      const lane = this.map.lane(n.lc.edge, n.lc.to);
      if (lane && path.currentEdge().id === n.lc.edge)
        path.switchLane(n.lc.to, projectPoint(lane.pts, lane.cum, [n.x, n.y], null).s);
      n.lc = null;
      n.lcCooldown = 6;
    }
    let proj = projectPoint(path.pts, path.cum, [n.x, n.y], null);
    path.s = proj.s;
    if (proj.distance > 6) {
      this.recoverPath(n);
      proj = projectPoint(path.pts, path.cum, [n.x, n.y], null);
      path.s = proj.s;
    }
    for (const replan of TRAFFIC_BEFORE_CORNER)
      if (replan(world, n)) {
        proj = projectPoint(path.pts, path.cum, [n.x, n.y]);
        path.s = proj.s;
      }
    // (a long vehicle whose next turn would sweep its body over a car parked by the corner goes
    // another way: a school bus, say)
    for (const replan of TRAFFIC_CORNER)
      if (replan(world, n, this)) {
        proj = projectPoint(path.pts, path.cum, [n.x, n.y]);
        path.s = proj.s;
      }
    // (a way through a block closed for an event, say, is re-planned while there is room)
    for (const replan of TRAFFIC_REPLAN)
      if (replan(world, n)) {
        proj = projectPoint(path.pts, path.cum, [n.x, n.y]);
        path.s = proj.s;
      }
    path.extend();
    path.trim();
    const edge = path.currentEdge();
    const spec = n.spec;
    const front = path.s + (spec.length - spec.rearOverhang);
    let leaderHold = null;
    for (const findHold of TRAFFIC_LEADER_HOLD) {
      const hold = findHold(world, n, path, front);
      if (hold && (!leaderHold || hold.gap < leaderHold.gap)) leaderHold = hold;
    }
    return { path, proj, edge, spec, front, leaderHold };
  }

  // Lane changes, a call to give way, the stops registered features plan, a cyclist's place toward the
  // kerb, pulling over, and easing past what stands at the kerb.
  chooseLane(n, dt, t, { standing }) {
    const world = this.world;
    const { path, proj, edge, front } = t;
    // lane change in progress: the lateral offset eases over the maneuver, then the path moves
    // onto the new lane
    // a call on this driver to give way, an emergency vehicle's, say: null, or `yielding`, the call it
    // pulls over and stops for
    const giveWay = firstHookResult(TRAFFIC_GIVE_WAY, world, this, n, proj, dt);
    const laneControl = firstHookResult(TRAFFIC_LANE_CONTROL, world, n, path, front);
    if (n.lc) {
      n.lc.t += dt;
      if (n.lc.edge !== edge.id) n.lc = null; // ran out of edge: the next junction's join takes over
    } else {
      n.lcCooldown = Math.max(0, (n.lcCooldown || 0) - dt);
      // (a registered feature's vehicle can change lanes its own way: a bus moves across to the curb lane
      // for its next stop, and otherwise only for a turn; a streetcar, on its track, never does)
      if (TRAFFIC_LANE_CHANGE.some((change) => change(world, this, n, edge, front))) {
        /* its own way */
      } else if (laneControl) {
        /* keeping its lane through the temporary restriction */
      } else if (!giveWay) this.maybeChangeLane(n, edge, front);
      else if (giveWay.yielding && n.kind !== "bike") this.maybeChangeLane(n, edge, front, true);
    }
    let featureStop = Infinity;
    for (const plan of TRAFFIC_STOP)
      featureStop = Math.min(featureStop, plan(world, this, n, front, dt, proj) ?? Infinity);
    // a cyclist rides the right-hand side of the lane, clear of the car doors, or the empty parking
    // lane beside it: `keepRight` is where it is heading, `n.side` where it is now
    const keepRight = n.kind === "bike" ? this.curbside(n, edge, front, dt) : 0;
    // pulling over to give way
    let pullShift = 0;
    for (const shift of TRAFFIC_PULL_OVER) pullShift += shift(world, this, n, edge, front, dt, giveWay);
    // Ease left to pass vehicles standing at the kerb (buses at their stops, say) and leave room beside
    // the kerb when needed.
    const parkedClearance = featureObstacle(n)?.parkedClearance?.(n);
    if ((standing.length || parkedClearance) && n.kind !== "bike" && !featureObstacle(n)?.ownLane) {
      const to = this.standingNudge(n, edge, standing, parkedClearance);
      n.nudge = (n.nudge || 0) + Math.max(-NUDGE_MPS * dt, Math.min(NUDGE_MPS * dt, to - (n.nudge || 0)));
    }
    Object.assign(t, { giveWay, laneControl, featureStop, keepRight, pullShift });
  }

  // The line the driver keeps to across its lane (`offset`, right of the path positive): its place in the
  // lane, a temporary corridor, going round an obstruction, a controlled lane, overtaking a cyclist, the
  // moves registered features have it make inside its lane, a parking manoeuvre, pulling out from the kerb
  // and rejoining its line.
  laneOffset(n, dt, t, { all }) {
    const world = this.world;
    const { path, edge, front, giveWay, laneControl, keepRight, pullShift } = t;
    const corridor = firstHookResult(TRAFFIC_CORRIDOR, world, n, path, front);
    const corridorShift = corridor?.shift ?? 0;
    const bypass = firstHookResult(TRAFFIC_BYPASS, world, n, front, all, IDM),
      bypassShift = bypass?.shift ?? 0;
    const controlledShift = laneControl?.shift ?? 0;
    const overtaking = firstHookResult(
      TRAFFIC_OVERTAKING,
      world,
      n,
      edge,
      all,
      dt,
      !!(giveWay?.yielding || bypass || laneControl || corridor),
      IDM,
    );
    let offset =
      (n.kind === "bike" ? n.side : keepRight) +
      pullShift +
      (featureObstacle(n)?.laneShift?.(n) ?? 0) +
      (n.nudge || 0) +
      (n.lc ? n.lc.dir * n.lc.width * smooth(n.lc.t / n.lc.T) : 0) +
      corridorShift +
      bypassShift +
      controlledShift;
    if (overtaking) offset += overtaking.shift;
    const earlyMoves = [];
    for (const run of BEFORE_LANE_MOVES) {
      const move = run(world, n, front, false, dt, { offset, moves: earlyMoves });
      if (!move) continue;
      if (move.shift !== undefined) offset += move.shift;
      earlyMoves.push(move);
    }
    // what a registered feature moves it over for inside its lane, a pothole in its lane ahead, say (not
    // while changing lanes or going round something), and its speed ceiling for it; each is handed where
    // it keeps in the lane so far and the earlier moves (where each is heading, `aim`, and has got to, `now`)
    const laneBusy = !!(n.lc || corridorShift || bypassShift || controlledShift || overtaking || n.pull),
      laneMoves = [];
    let featureLimit = Infinity;
    for (const run of TRAFFIC_LANE) {
      const r = run(world, n, front, laneBusy, dt, { offset, moves: laneMoves });
      if (r.shift !== undefined) offset += r.shift;
      if (r.result?.limit != null) featureLimit = Math.min(featureLimit, r.result.limit);
      laneMoves.push(r);
    }
    const driverOverride = firstHookResult(TRAFFIC_DRIVER, world, n);
    if (driverOverride?.offset) offset += driverOverride.offset;
    let parkingPlan = null;
    for (const plan of TRAFFIC_PARKING_PLAN) {
      parkingPlan = plan(n, (n.driver || IDM).s0);
      if (parkingPlan) {
        offset += parkingPlan.shift;
        break;
      }
    }
    // the line a registered feature has it keep to in its lane, over toward the middle between snowbanks
    // that push the parked cars out from the kerb, say: where it stops (`hold`), the move along its way
    // (`lineAt`) and the line it keeps to (`kept`) for what is in its way, and what it has moved so far
    const keepMoves = [];
    for (const run of TRAFFIC_KEEP) {
      const r = run(world, n, front, laneBusy, dt, {
        offset,
        moves: keepMoves,
        pursuit: () => path.s + lookahead(n.v),
      });
      if (r.shift !== undefined) offset += r.shift;
      if (r.result?.limit != null) featureLimit = Math.min(featureLimit, r.result.limit);
      keepMoves.push(r);
    }
    const keptBy = keepMoves.find((m) => m.kept);
    // The merge eases the path out to the lane, which also frees a car boxed in by the one parked
    // in front. It ends only once the car is moving, so a car still at the curb keeps signalling
    // and checking for a gap.
    if (n.pull) {
      n.pull.t += dt;
      offset += n.pull.lat * (1 - smooth(n.pull.t / n.pull.T));
      if (n.pull.t >= n.pull.T && n.pull.moving) n.pull = null;
    }

    // A line it keeps to on its way back into its lane (an emergency vehicle stood down, say), and whether
    // that line is still its own.
    const rejoin = firstHookResult(TRAFFIC_REJOIN, world, this, n, offset, dt);
    if (rejoin) offset = rejoin.offset;
    const ownLine = !!rejoin?.own;
    Object.assign(t, {
      corridor,
      bypass,
      bypassShift,
      overtaking,
      offset,
      earlyMoves,
      featureLimit,
      driverOverride,
      parkingPlan,
      keepMoves,
      keptBy,
      ownLine,
    });
  }

  // Leader: nearest vehicle ahead on our path within LOOK_M (parked cars only when they
  // stick into the lane). Starts `t.gap`, `t.leadV` and `t.leader`.
  leaderOnPath(n, t, { all, extraTraffic }) {
    const world = this.world;
    const { path, spec, corridor, laneControl, bypass, overtaking, keepMoves, ownLine, offset, keptBy } = t;
    const { keepRight, bypassShift } = t;
    let gap = Infinity,
      leadV = n.v0,
      leader = null;
    for (const o of all.concat(
      world.parked.near(n.x, n.y, LOOK_M),
      world.parked.doorsNear(n.x, n.y, LOOK_M),
      extraTraffic,
    )) {
      if (o === n) continue;
      if (Math.abs(o.x - n.x) > LOOK_M + 5 || Math.abs(o.y - n.y) > LOOK_M + 5) continue;
      if (extraTraffic.length && featureObstacle(o)?.oncoming?.(o, n)) continue;
      // Obstacles bypassed by the temporary corridor.
      if (o === corridor?.ignore) continue;
      // (nor, from the closed lane, the lane closure's)
      if (o === laneControl?.ignore) continue;
      if (o === bypass?.ignore) continue;
      // (a cyclist it is passing, until it is the minimum passing distance clear of it, near enough)
      const os = o.spec || CAR,
        reach = (spec.width + os.width) / 2 + (o === overtaking?.vehicle ? overtaking.clearance : LEADER_MARGIN_M);
      // in the way on the current lane, or on the target lane of a lane change: closer to the
      // path than the two half-widths plus a margin
      // The pursuit line moves with the corridor and kerb clearance.
      const inWay = (lat, at) => {
        if (corridor?.lineAt) lat -= corridor.lineAt(at);
        if (laneControl?.lineAt) lat -= laneControl.lineAt(at);
        // (between snowbanks, say, the line it will keep to where `o` is)
        for (const m of keepMoves) if (m.lineAt) lat -= m.lineAt(at);
        // (the line for going round an obstruction moves over; what is at the curb stays there)
        const round = bypass?.lineAt ? lat - bypass.lineAt(at) : lat;
        // (a registered feature's line, between snowbanks say, is its own: `kept`)
        const kept = ownLine
          ? Math.abs(lat - offset)
          : keptBy
            ? keptBy.kept(lat)
            : Math.abs(
                keepMoves.reduce(
                  (x, m) => x - m.now,
                  lat - keepRight - (n.nudge || 0) - bypassShift - (overtaking?.shift ?? 0),
                ),
              );
        return (
          Math.abs(round - offset) <= reach || (n.lc && Math.abs(lat - n.lc.dir * n.lc.width) <= reach) || kept <= reach
        );
      };
      const p = projectPoint(path.pts, path.cum, [o.x, o.y], null);
      if (p && p.s > path.s + 0.5 && p.s <= path.s + LOOK_M && inWay(p.lateral, p.s)) {
        // rear axle to rear axle, less our axle-to-front-bumper and its rear overhang
        const g = p.s - path.s - (spec.length - spec.rearOverhang) - os.rearOverhang;
        if (g < gap) {
          gap = g;
          leadV = o.v;
          leader = o;
        }
      }
      // a long vehicle (a bus, say) is in the way wherever along its body it crosses the path: its middle
      // and front are looked for too
      if (isLong(o))
        for (const d of [os.length / 2 - os.rearOverhang, os.length - os.rearOverhang - 1]) {
          const q = projectPoint(path.pts, path.cum, [o.x + Math.cos(o.psi) * d, o.y + Math.sin(o.psi) * d], null);
          if (!q || q.s <= path.s + 0.5 || q.s > path.s + LOOK_M || !inWay(q.lateral, q.s)) continue;
          const g = q.s - path.s - (spec.length - spec.rearOverhang) - os.width / 2;
          if (g < gap) {
            gap = g;
            leadV = o.v * Math.cos(o.psi - n.psi);
            leader = o;
          }
        }
    }
    Object.assign(t, { gap, leadV, leader });
  }

  // Any part of a body in the driver's way, not only one whose middle is on its path: for a cyclist, a
  // registered feature's heavy vehicle, and every motor vehicle for the driven car.
  leaderByBody(n, t, { all, extraTraffic }) {
    const world = this.world;
    const { path, spec, front, proj, offset } = t;
    let { gap, leadV, leader } = t;
    // a cyclist also stops for any part of a body across its way just ahead (a car turning across
    // it, say), not only for one whose middle is in its path, along the way it will actually ride:
    // moving across, it lags the line it steers for
    if (n.kind === "bike") {
      for (const o of all.concat(
        world.parked.near(n.x, n.y, BODY_LOOK_M + 6),
        world.parked.doorsNear(n.x, n.y, BODY_LOOK_M + 6),
        extraTraffic,
      )) {
        if (o === n || Math.abs(o.x - n.x) > BODY_LOOK_M + 6 || Math.abs(o.y - n.y) > BODY_LOOK_M + 6) continue;
        const g = bodyOnPath(n, o, front, proj.lateral, offset);
        if (g !== null && g < gap) {
          gap = g;
          leadV = Math.max(0, o.v * Math.cos(o.psi - n.psi));
          leader = o;
        }
      }
    }
    // a registered feature's heavy vehicle (a bus, say), long and slow to stop, also stops for any part of
    // a body in its way over the next few metres (a car turning or crossing in front of it), its own body
    // laid along its path there (`noseFirst`: a school bus, say, not for anything already beside it, short
    // of its front: a cyclist that stopped by its side as it turned would wait for it in turn)
    if (featureObstacle(n)?.heavy) {
      const body = n.obb(),
        reach = spec.length + LONG_BODY_LOOK_M + 6,
        nose = spec.length - spec.rearOverhang - 1;
      const close = all
        .concat(world.parked.near(n.x, n.y, reach), extraTraffic)
        .filter(
          (o) =>
            o !== n &&
            Math.abs(o.x - n.x) < reach &&
            Math.abs(o.y - n.y) < reach &&
            !obbOverlap(body, o.obb(), 0.05) &&
            !(featureObstacle(n)?.noseFirst && n.toLocal(o.x, o.y).ahead < nose),
        );
      for (let d = 0.5; close.length && d <= LONG_BODY_LOOK_M && d < gap; d += 0.5) {
        const mid = Math.min(path.length, path.s + spec.length / 2 - spec.rearOverhang + d),
          [x, y] = path.offsetPointAt(mid, offset);
        const hit = close.find((o) =>
          obbOverlap({ ...body, center: [x, y], heading: path.headingAt(mid) }, o.obb(), 0.05),
        );
        if (hit) {
          gap = d - 0.5;
          leadV = Math.max(0, hit.v * Math.cos(hit.psi - n.psi));
          leader = hit;
          break;
        }
      }
    }
    // Ordinary cars can swing across a stopped car too, especially through a wet-road turn:
    // forecast every motor vehicle's real body through the stopping distance.
    if (n.kind !== "bike") {
      const ego = world.ego,
        nose = spec.length - spec.rearOverhang - 1;
      const g =
        featureObstacle(n)?.noseFirst && n.toLocal(ego.x, ego.y).ahead < nose
          ? null
          : sweptBodyGap(n, ego, offset, LONG_BODY_LOOK_M);
      if (g !== null && g < gap) {
        gap = g;
        leader = ego;
        leadV = Math.max(0, ego.v * Math.cos(ego.psi - n.psi));
      }
    }
    Object.assign(t, { gap, leadV, leader });
  }

  // What registered features have the driver keep back from or follow as a leader, its following policy,
  // and the lead it then has (`n.lead`).
  leaderHolds(n, dt, t) {
    const world = this.world;
    const { path, edge, front, offset, leaderHold, driverOverride } = t;
    let { gap, leadV, leader } = t;
    // (what a registered feature has traffic keep back from: the room the driven car reverses into
    // while it parks at its destination, say, sim/features/destination-parking.js)
    for (const keepBack of TRAFFIC_KEEP_BACK) {
      const hold = keepBack(world, n, path, { dt, look: LOOK_M, isLong });
      if (hold && hold.gap < gap) {
        gap = Math.max(0.05, hold.gap);
        leadV = 0;
        leader = hold.vehicle;
      }
    }
    if (leaderHold && leaderHold.gap < gap) {
      gap = Math.max(0.05, leaderHold.gap);
      leadV = 0;
      leader = leaderHold.vehicle;
    }
    const specialLeader = firstHookResult(SPECIAL_LEADER, this, n, path, front, offset, edge.limit, LOOK_M);
    if (specialLeader && specialLeader.gap < gap) {
      gap = specialLeader.gap;
      leadV = specialLeader.vehicle.v;
      leader = specialLeader.vehicle;
    }
    const leadPolicy = firstHookResult(TRAFFIC_LEAD_POLICY, n, leader, edge.limit, (n.driver || IDM).s0);
    if (leadPolicy?.extraGap !== undefined) gap = Math.max(0.05, gap - leadPolicy.extraGap);
    if (driverOverride?.leadSpeed) leadV = driverOverride.leadSpeed(leader, leadV);
    n.lead = gap < Infinity ? { gap, v: leadV, ...leadPolicy?.fields } : null;
    Object.assign(t, { gap, leadV, leader });
  }

  // The first traffic control ahead on the driver's path (a signal, a roundabout's yield line or a stop
  // sign): where it stops for it (`stopAt`), the speed ceilings coming up to it and through it, and
  // whether a registered feature holds it there.
  controlAhead(n, dt, t, { all }) {
    const world = this.world;
    const { path, front } = t;
    let stopAt = null,
      controlCap = Infinity;
    const approachSpeed = featureTrafficSpeed(world, n, front, APPROACH_TRAFFIC_SPEED);
    let signalCap = featureTrafficSpeed(world, n, front, CLEARING_TRAFFIC_SPEED);
    let heldAtControl = false;
    for (const start of TRAFFIC_CONTROL_START) start(world, n);
    for (const e of path.edges) {
      if (!e.control || e.sEnd < path.s) continue;
      const ctl = controlAt(world, e.control, e.id);
      const lineS = pathLine(e, this.map.edges.get(e.id).length, ctl.s_line);
      const bumperToLine = lineS - front;
      if (bumperToLine < -1) continue;
      if (bumperToLine > 70) break;
      const direction = ctl.type === "signal" ? firstHookResult(TRAFFIC_CONTROL, world, n, e.id) : null;
      if (direction) {
        heldAtControl = direction === "stop";
        if (heldAtControl) stopAt = bumperToLine;
      } else if (ctl.type === "signal") {
        // (the light for the way it goes: under a left arrow, only a left turn has a green)
        const after = path.edges[path.edges.indexOf(e) + 1];
        const st = movementSignal(
          approachPhase(this.map.intersections.get(e.control.id), e.id, world.t),
          after ? this.map.classifyTurn(this.map.turnAngle(e.id, after.id)) : "straight",
        );
        const policy = firstHookResult(SIGNAL_POLICY, this, n, e, st);
        if (policy) {
          controlCap = policy.speed;
          if (policy.hold) stopAt = Math.max(0, bumperToLine);
        }
        const decision = firstHookResult(SIGNAL_DECISION, world, n, e, ctl, st, bumperToLine);
        const canStop = decision
          ? decision.stop
          : bumperToLine > (n.v * n.v) / (2 * Math.min(4, comfort().hardDecel)) + 1;
        if (decision && !decision.stop) signalCap = Math.min(signalCap, decision.speed_mps);
        const proceed = firstHookResult(SIGNAL_PROCEED, world, this, n, e, ctl, st, bumperToLine, canStop);
        if (st === "red" && this.rightOnRed(n, e, bumperToLine, front, dt)) stopAt = null;
        else if (!proceed && (st === "red" || (st === "yellow" && canStop))) stopAt = bumperToLine;
        else if (!proceed && st === "green" && firstHookResult(SIGNAL_HOLD, world, n, e, ctl, bumperToLine, all))
          stopAt = Math.max(0, bumperToLine);
      } else if (ctl.type === "yield") {
        // roundabout entry: wait at the line while someone in the ring would arrive first
        if (bumperToLine < 12 && ringBusy(this.map.roundabouts.get(ctl.roundabout), this.map.nodes.get(e.to), all, n))
          stopAt = bumperToLine;
      } else {
        const state = n.stopMem.update(ctl, bumperToLine, n.v, dt);
        const next = path.edges[path.edges.indexOf(e) + 1];
        if (TRAFFIC_RELEASE_CONTROL.some((release) => release(world, n, e, ctl, state, bumperToLine))) break;
        if (ctl.all_way)
          world.allWay.note(
            n,
            ctl,
            e.id,
            next ? this.map.classifyTurn(this.map.turnAngle(e.id, next.id)) : "straight",
            bumperToLine,
            n.v,
            world,
          );
        if (state !== "completed") stopAt = bumperToLine;
        // stopped: go when the junction is clear and, at a two-way stop, when nothing on the
        // through road would get there first; at an all-way stop, when it is its turn, and nothing
        // coming in on a street without a sign there (which does not stop) would get there first
        else if (
          this.boxBusy(n, e) ||
          (ctl.all_way
            ? world.allWay.status(n, world)?.go === false || this.unsignedComing(n, e.id)
            : // (a stop standing in for a grouped junction gives way there, as at an uncontrolled minor approach)
              firstHookResult(PRIORITY_JUNCTION, world, ctl)
              ? this.givesWay(n, e.id, e.sEnd - front)
              : this.crossComing(n, e.to))
        )
          stopAt = Math.max(0, bumperToLine);
      }
      break;
    }
    Object.assign(t, { stopAt, controlCap, signalCap, approachSpeed, heldAtControl });
  }

  // The other lines it stops at: short of people on a crosswalk, a cyclist where the parking lane ends,
  // where it gives way and where it parks; then stopping there, and hanging back.
  stopLines(n, t) {
    const world = this.world;
    const { path, spec, front, proj, offset, giveWay, parkingPlan } = t;
    let { stopAt, gap, leadV } = t;
    // crowd.pxo keeps a PXO occupied until the far curb, in every lane (sim/pxo.js).
    const cw = crosswalkConflict(
      path.pts,
      path.cum,
      front - 2,
      front + 35,
      world.crowd,
      spec.width / 2 + 0.9 + (n.kind === "bike" ? Math.abs(n.side) : 0),
    );
    // A cyclist whose nose has already crossed the walk clears it; stopping with the
    // bicycle across it traps a pedestrian beside its rear. People in front still have priority.
    const clearingWalk =
      n.kind === "bike" &&
      cw &&
      cw.s < front &&
      n.toLocal(cw.ped.x, cw.ped.y).ahead < spec.length - spec.rearOverhang &&
      bodyOnPath(n, cw.ped, front, proj.lateral, offset) === null;
    if (cw && !clearingWalk) stopAt = stopAt === null ? cw.s - front - 2 : Math.min(stopAt, cw.s - front - 2);
    // a cyclist that cannot move back into the lane yet waits where the parking lane ends
    if (n.kind === "bike" && n.stripHold != null)
      stopAt = stopAt === null ? n.stripHold - front : Math.min(stopAt, n.stripHold - front);
    // giving way: stop where it chose to when the call came
    for (const stopFor of TRAFFIC_STOP_AT) {
      const at = stopFor(world, this, n, front, giveWay);
      if (at !== null) stopAt = stopAt === null ? at : Math.min(stopAt, at);
    }
    if (parkingPlan?.stop != null) stopAt = stopAt === null ? parkingPlan.stop : Math.min(stopAt, parkingPlan.stop);
    if (stopAt !== null && stopAt < gap) {
      gap = Math.max(0.05, stopAt);
      leadV = 0;
    }
    // hanging back from what it must not follow closely (an emergency vehicle ahead going its way, say),
    // as from a car nearer than it is
    for (const hangBack of TRAFFIC_HANG_BACK) {
      const back = hangBack(world, this, n, path, front);
      if (back && back.gap < gap) {
        gap = Math.max(0.05, back.gap);
        leadV = back.v;
      }
    }
    Object.assign(t, { stopAt, gap, leadV });
  }

  // The turn coming up: its indicator, and waiting at the junction for oncoming traffic, a cyclist on the
  // right, traffic with the right of way and a busy junction box. Sets `t.cur`, the edge it is on.
  junctionWaits(n, t) {
    const world = this.world;
    const { path, edge, front, parkingPlan, stopAt } = t;
    let { gap, leadV } = t;
    const ji = path.edges.findIndex((e) => e.sEnd > front);
    const cur = path.edges[ji],
      after = path.edges[ji + 1];
    const toNode = cur ? cur.sEnd - front : Infinity;
    // (past the end of its path, `cur` is gone: no turn)
    const turn = cur && after ? this.map.classifyTurn(this.map.turnAngle(cur.id, after.id)) : "straight";
    n.signal = n.pull
      ? n.pull.lat > 0
        ? "left"
        : "right"
      : n.lc
        ? n.lc.dir < 0
          ? "left"
          : "right"
        : toNode < 35 && (turn === "left" || turn === "right")
          ? turn
          : null;
    const indicated = firstHookResult(TRAFFIC_INDICATOR, n);
    if (indicated) n.signal = indicated.signal;
    if (parkingPlan) n.signal = parkingPlan.signal;
    // turning left: yield to oncoming traffic before crossing its lane
    if (stopAt === null && turn === "left" && toNode > 3 && toNode < 25 && this.oncoming(n, cur.to)) {
      gap = Math.min(gap, Math.max(0.05, toNode - 5));
      leadV = 0;
    }
    // turning right: wait short of the corner for a cyclist coming up on the right, unless the car
    // can no longer stop before it
    if (n.kind !== "bike" && turn === "right" && toNode < HOOK_LOOK_M) {
      const half = this.map.crossingHalfWidth(cur.id),
        hold = toNode - half - 1;
      if (hold > (n.v * n.v) / (2 * comfort().decel) - 0.5 && this.cyclistOnRight(n, cur.to, toNode, half)) {
        gap = Math.min(gap, Math.max(0.05, hold));
        leadV = 0;
      }
    }
    // junction with no sign or signal ahead: yield to anyone already crossing it, and give way
    // at the line to traffic with the right of way (sim/priority.js) that would get there first
    if (stopAt === null) {
      const next = path.edges.find((e) => e.sEnd > front);
      const toNode = next ? next.sEnd - front : Infinity;
      // (and, coming in on a street without a sign to an all-way stop, to one pulling away from its line)
      // A ring's entry vertices are not crossing junctions: circulating traffic has priority.
      // Its leader checks above still hold it behind any vehicle obstructing its own lane.
      if (
        next &&
        !next.control &&
        !this.map.edges.get(next.id).ring &&
        toNode > 5 &&
        toNode < 25 &&
        this.isJunction(next.to) &&
        (this.boxBusy(n, next) || this.allWayLeaving(n, next.to))
      ) {
        gap = Math.min(gap, Math.max(0.05, toNode - 6));
        leadV = 0;
      }
      const rule = next && !next.control ? this.map.priorityOf(next.id) : null;
      if (rule && rule.rule !== "major" && toNode < GIVE_WAY_LOOK_M) {
        const toLine = pathLine(next, this.map.edges.get(next.id).length, rule.s_line) - front;
        if (toLine > -1 && this.givesWay(n, next.id, toNode)) {
          gap = Math.min(gap, Math.max(0.05, toLine));
          leadV = 0;
        }
      }
    }
    // intersection box rule for signals too: don't enter while a crossing car is inside
    if (stopAt === null && edge.control && controlAt(world, edge.control, edge.id).type === "signal") {
      const lineS = pathLine(edge, this.map.edges.get(edge.id).length, edge.control.s_line);
      const b = lineS - front;
      if (b > -1 && b < 6 && this.boxBusy(n, edge)) {
        gap = Math.min(gap, Math.max(0.05, b));
        leadV = 0;
      }
    }
    Object.assign(t, { gap, leadV, cur });
  }

  // Getting out of a standoff: backing up for someone nose to nose with it, and giving up a stop it has
  // waited at long enough with the way clear.
  unstick(n, dt, t) {
    const { leader, stopAt, heldAtControl, cur } = t;
    let { gap, leadV } = t;
    // nose to nose with someone stopped in our path who is waiting for us in turn (a car turning
    // across our lane, say): after a few seconds, back up and let them through
    if (
      leader &&
      !leader.parked &&
      n.v < 0.2 &&
      gap < 5 &&
      Math.abs(leader.v) < 0.3 &&
      Math.abs(wrap(leader.psi - n.psi)) > 2.2
    ) {
      n.standoff = (n.standoff || 0) + dt;
      if (n.standoff > 3) {
        n.standoff = 0;
        n.backoff = { left: 6, t: 0 };
      }
    } else n.standoff = 0;
    // After ~15 s stopped at a clear control with no vehicle blocking, abandon the virtual leader.
    if (n.v < 0.2 && gap < 3) n.waiting += dt;
    else n.waiting = 0;
    if (
      n.waiting > 15 &&
      stopAt !== null &&
      stopAt < 1 &&
      leadV === 0 &&
      !heldAtControl &&
      !this.blockedByVehicle(n) &&
      !(cur && this.crossComing(n, cur.to))
    ) {
      gap = Infinity;
      leadV = n.v0;
      n.waiting = 0;
    }
    Object.assign(t, { gap, leadV });
  }

  // Where registered features, the junction box, a corridor, going round an obstruction and a controlled
  // lane have it stop, after the checks above, which still hold on the way there; and the speed ceiling
  // and the handling registered features give it (`t.featureControls`).
  featureHolds(n, dt, t, { all }) {
    const world = this.world;
    const { front, featureStop, corridor, bypass, laneControl, earlyMoves, keepMoves } = t;
    let { gap, leadV, featureLimit } = t;
    // where a registered feature has it stop, after the checks above, which still hold on the way there:
    // behind a bus signalling to pull out from its stop, letting it out, or for a school bus with its
    // reds flashing, say
    for (const hold of TRAFFIC_HOLD_BUSES) {
      const at = hold(world, this, n, front, all);
      if (at != null && at < gap) {
        gap = Math.max(0.05, at);
        leadV = 0;
      }
    }
    if (featureStop < gap) {
      gap = Math.max(0.05, featureStop);
      leadV = 0;
    }
    // where a registered feature has it stop: not passing a streetcar with its doors open on the side its
    // riders use, or short of a level crossing's tracks for a train coming, say
    for (const hold of TRAFFIC_HOLD) {
      const at = hold(world, this, n, front, all);
      if (at != null && at < gap) {
        gap = Math.max(0.05, at);
        leadV = 0;
      }
    }
    // at a signal: at the line, while traffic past the junction leaves no room to clear it
    // (sim/junction-box.js; not a cyclist)
    const forBox = boxHold(this.map, n, front, all);
    if (forBox !== null && forBox < gap) {
      gap = Math.max(0.05, forBox);
      leadV = 0;
    }
    const corridorStop = corridor?.stop?.();
    if (corridorStop != null && corridorStop < gap) {
      gap = Math.max(0.05, corridorStop);
      leadV = 0;
    }
    if (bypass?.waitGap != null && bypass.waitGap < gap) {
      gap = Math.max(0.05, bypass.waitGap);
      leadV = 0;
    }
    const controlledStop = laneControl?.stop();
    if (controlledStop && controlledStop.gap < gap) {
      gap = Math.max(0.05, controlledStop.gap);
      leadV = controlledStop.v;
    }
    for (const plan of AFTER_MERGE) {
      const stop = plan(world, this, n, front, dt);
      if (stop !== null && stop < gap) {
        gap = Math.max(0.05, stop);
        leadV = 0;
      }
    }
    // where a registered feature's line has it stop: between snowbanks, say, short of the one-car stretch
    // until it is its turn (once it could stop there: otherwise it has the way)
    earlyMoves.push(...keepMoves);
    for (const { hold } of earlyMoves) {
      if (hold == null) continue;
      const g = hold - front;
      if (g > -1 && g < gap && g > (n.v * n.v) / (2 * Math.min(4, comfort().hardDecel)) - 1) {
        gap = Math.max(0.05, g);
        leadV = 0;
      }
    }
    // where a registered feature has it stop, and its speed ceiling: for Canada geese, say, slowing while a
    // gaggle comes up to the kerb ahead and stopping short of their way across until the last is off the
    // roadway (once it could stop there, `canStop`: otherwise it carries on); or short of the barricade
    // across a block closed for an event, on a way that could not be changed in time; and how it has the
    // driver handle the car (`controls`)
    let featureControls = null;
    for (const yieldTo of TRAFFIC_YIELD) {
      const y = yieldTo(world, n, front);
      if (!y) continue;
      if (y.limit != null) featureLimit = Math.min(featureLimit, y.limit);
      if (y.controls) featureControls ||= y.controls;
      if (y.hold == null) continue;
      const g = y.hold - front;
      if (g > -1 && g < gap && (!y.canStop || g > (n.v * n.v) / (2 * Math.min(4, comfort().hardDecel)) - 1)) {
        gap = Math.max(0.05, g);
        leadV = 0;
      }
    }
    Object.assign(t, { gap, leadV, featureLimit, featureControls });
  }

  // The driver's speed (the Intelligent Driver Model toward the lowest ceiling, behind what it follows) and
  // its wheel (pure pursuit of its line), then the step; or, wedged at an angle to its lane, a new path.
  drive(n, dt, t) {
    const world = this.world;
    const { path, edge, front, proj, offset, corridor, bypass, laneControl, leader, driverOverride } = t;
    const { controlCap, signalCap, approachSpeed, featureLimit, featureControls, gap, leadV } = t;
    // curvature-limited desired speed: slow in time for every bend in the next 40 m
    const vCurve = curveSpeed(path, path.s);
    const limit = Math.min(
      edge.limit,
      this.zoneLimit(path, front),
      featureTrafficSpeed(world, n, front, EDGE_TRAFFIC_SPEED, edge.limit),
      corridor?.limit ?? Infinity,
      bypass?.limit ?? Infinity,
      laneControl?.limit ?? Infinity,
    );
    const vFollow = featureTrafficSpeed(world, n, front, FOLLOWING_TRAFFIC_SPEED, {
      leader,
      skipFollowing: driverOverride?.skipFollowing,
    });
    const v0 = Math.min(
      featureObstacle(n)?.fixedCruise ? n.v0 : n.v0 * weather.speed,
      limit * (featureObstacle(n)?.heavy ? 0.95 : (driverOverride?.speedFactor ?? 1.05)) * weather.speed,
      vCurve,
      controlCap,
      signalCap,
      approachSpeed,
      n.pull ? 5 : Infinity,
      vFollow,
      featureTrafficSpeed(world, n, front, ORDINARY_TRAFFIC_SPEED),
      featureLimit,
      featureTrafficSpeed(world, n, front),
    );
    const D = n.driver || IDM;
    let a;
    if (v0 <= 0) a = -Math.min(6, comfort().hardDecel * 1.1);
    else if (gap === Infinity) a = D.aMax * (1 - (n.v / v0) ** 4);
    else {
      const dv = n.v - leadV;
      // on a slippery road drivers leave more room and brake more gently
      const grip = Math.min(1, comfort().decel / 2.5);
      const b = D.b * grip,
        T = D.T / Math.max(0.5, grip);
      const sStar = D.s0 + Math.max(0, n.v * T + (n.v * dv) / (2 * Math.sqrt(D.aMax * b)));
      a = D.aMax * (1 - (n.v / v0) ** 4 - (sStar / Math.max(gap, 0.1)) ** 2);
    }
    if (driverOverride?.brake) a = driverOverride.brake(leader, gap, a);
    a = Math.max(-Math.min(6, comfort().hardDecel * 1.1), Math.min(D.aMax, a));
    // standing still, a driver takes a moment to notice the way is clear and move off
    if (n.v < 0.3 && a > 0.2) {
      n.ready = (n.ready || 0) + dt;
      if (n.ready < (D.react || 0)) a = -1;
    } else if (n.v > 1) n.ready = 0;
    if (n.v < 0.05 && a < 0) a = -1; // stopped: hold the brakes rather than creep
    // wedged at an angle to its lane (a turn taken wide, then blocked): rebase its path
    if (n.waiting > 10 && Math.abs(wrap(n.psi - path.headingAt(path.s))) > 0.35) {
      this.recoverPath(n);
      return;
    }
    // stopped close behind something it is moving out round, a cyclist puts a foot down and
    // shuffles the bicycle across rather than rolling forward into it
    if (n.kind === "bike" && n.v < 0.3 && gap < SHUFFLE_GAP_M) {
      const turn = wrap(path.headingAt(path.s) - n.psi);
      if (Math.abs(offset - proj.lateral) > 0.05 || Math.abs(turn) > 0.02)
        this.shuffle(n, offset - proj.lateral, turn, dt);
    }
    const steer = purePursuit(n, path, path.s, offset);
    // (where a registered feature has the driver ease the pedals and the wheel, on or coming up to black
    // ice, say, short of braking harder than it ever does but in an emergency)
    if (featureControls && a > -D.b) n.step(dt, featureControls(n, steer, a, dt));
    else n.step(dt, { steer, accel: a });
    if (n.v < 0) n.v = 0;
  }

  // How far left of its lane's path (negative) a driver eases to pass a vehicle standing at the kerb
  // just ahead or beside it (`standing`: a bus at its stop, say; see NUDGE_MPS), or around a car parked
  // inside its usual leader margin.
  standingNudge(n, pe, standing, parkedClearance) {
    const e = this.map.edges.get(pe.id),
      path = n.path,
      spec = n.spec;
    const room = e.lane_width / 2 - spec.width / 2 - 0.1;
    let nudge = 0;
    for (const o of standing.concat(parkedClearance ? this.world.parked.near(n.x, n.y, NUDGE_LOOK_M + 15) : [])) {
      if (
        (!o.parked && !featureObstacle(o)?.standing?.(o)) ||
        Math.abs(o.x - n.x) > NUDGE_LOOK_M + 15 ||
        Math.abs(o.y - n.y) > NUDGE_LOOK_M + 15
      )
        continue;
      const [cx, cy] = o.center,
        p = projectPoint(path.pts, path.cum, [cx, cy], null);
      // (until the car's rear is past its front)
      if (
        !p ||
        p.s - path.s < -(o.spec.length / 2 + spec.rearOverhang) ||
        p.s - path.s > NUDGE_LOOK_M + o.spec.length ||
        p.lateral <= 0
      )
        continue;
      // (clear of it all along its body, where the leader check looks for it: it may stand at an angle)
      const bs = o.spec,
        lateral = Math.min(
          ...[0, bs.length / 2 - bs.rearOverhang, bs.length - bs.rearOverhang - 1].map((d) => {
            const q = projectPoint(path.pts, path.cum, [o.x + Math.cos(o.psi) * d, o.y + Math.sin(o.psi) * d], null);
            return q ? q.lateral : p.lateral;
          }),
        );
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
      if (
        zoneAt(
          this.map.zoneSpans,
          pe.id,
          (Math.max(0, s - pe.sStart) * e.length) / Math.max(1e-6, pe.sEnd - pe.sStart),
          clock,
        )
      )
        return ZONE_LIMIT_MPS;
    }
    return Infinity;
  }

  // Reverse slowly, straight back, until clear by `left` meters, blocked behind, or out of time;
  // then hold a few seconds while the other vehicle goes.
  backOff(n, dt) {
    const b = n.backoff;
    b.t += dt;
    b.left -= Math.abs(n.v) * dt;
    let behind = Infinity,
      swept = false;
    // (the room it reverses into: its body moved BACK_CLEAR_M straight back. A car stopped behind it at
    // an angle, or off to one side, has its centre outside the strip straight behind but its corner in
    // that room.)
    const box = n.obb(),
      c = Math.cos(n.psi),
      s = Math.sin(n.psi);
    const room = {
      ...box,
      center: [box.center[0] - (c * BACK_CLEAR_M) / 2, box.center[1] - (s * BACK_CLEAR_M) / 2],
      halfLength: box.halfLength + BACK_CLEAR_M / 2,
    };
    // obstaclesNear lists the rest of the world, not the driven car.
    for (const o of this.world.obstaclesNear(n.x, n.y, 12).concat(this.world.ego)) {
      if (o === n) continue;
      const l = n.toLocal(o.x, o.y);
      if (l.ahead < 0 && Math.abs(l.right) < 1.6)
        behind = Math.min(
          behind,
          -l.ahead - n.spec.rearOverhang - (o.spec ? o.spec.length - o.spec.rearOverhang : 3.6),
        );
      if (!swept && l.ahead < 0 && o.obb && obbOverlap(room, o.obb(), 0)) swept = true;
    }
    const done = b.left <= 0 || b.t > 7 || behind < BACK_CLEAR_M || swept;
    n.step(dt, { steer: 0, accel: done ? (n.v < -0.05 ? 3 : 0) : Math.max(-1.5, (-1.5 - n.v) * 1.5), reverse: true });
    n.signal = null;
    if (done && n.v > -0.05) {
      n.v = 0;
      n.backoff = null;
      n.holdFor = 5;
    }
  }

  // Reserve a vacant curb slot on a driver's current lane. The car indicates, slows, moves
  // smoothly into the bay and stops; it becomes a persistent parked obstacle at its actual pose.
  maybePark() {
    for (const n of this.vehicles) {
      if (
        n.kind === "bike" ||
        featureObstacle(n)?.noParking?.(n) ||
        n.pull ||
        isParkingTraffic(n) ||
        n.lc ||
        n.backoff ||
        n.frozen > 0
      )
        continue;
      const edge = n.path.currentEdge(),
        lane = this.map.lane(edge.id, edge.lane);
      const e = this.map.edges.get(edge.id);
      const choices = this.world.parked.slots.filter((slot) => {
        if (slot.edge !== edge.id || slot.occupant || slot.reserved) return false;
        if (edge.lane !== (slot.curb === "right" ? e.lanes - 1 : 0)) return false;
        const p = projectPoint(n.path.pts, n.path.cum, [slot.x, slot.y]);
        const ahead = p.s - n.path.s;
        return (
          ahead > Math.max(18, (n.v * n.v) / (2 * comfort().decel) + 8) &&
          ahead < 60 &&
          Math.abs(p.lateral) < 4.5 &&
          this.world
            .obstaclesNear(slot.x, slot.y, 14)
            .every((o) => o === n || Math.hypot(o.x - slot.x, o.y - slot.y) > 13)
        );
      });
      if (!lane || !choices.length) continue;
      const slot = choices[Math.floor(this.parkingEvents() * choices.length)];
      const p = projectPoint(n.path.pts, n.path.cum, [slot.x, slot.y]);
      reserveSlot(this.map, slot, n);
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
    const box = n.obb();
    const defaultReach = n.v * 0.8;
    const reach = Math.max(0.5, firstHookResult(TRAFFIC_PARKING_REACH, this.world, n, defaultReach) ?? defaultReach);
    box.center = [box.center[0] + (Math.cos(n.psi) * reach) / 2, box.center[1] + (Math.sin(n.psi) * reach) / 2];
    box.halfLength += reach / 2;
    box.halfWidth += 0.15;
    const blocked = this.world
      .obstaclesNear(n.x, n.y, 12)
      .concat(this.world.ego)
      .some((o) => o !== n && obbOverlap(box, o.obb(), 0.2));
    n.step(dt, {
      steer: purePursuit(n, n.path, p.s, offset),
      accel: blocked ? -comfort().hardDecel : speedControl(n.v, target),
    });
    if (n.v < 0) n.v = 0;
    if (room < 0.6 && n.v < 0.2 && Math.abs(p.lateral - park.lat) < 0.45) {
      n.v = n.a = n.vy = n.r = 0;
      n.signal = null;
      n.edge = park.slot.edge;
      n.curb = park.slot.curb;
      n.slot = park.slot;
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
    const world = this.world,
      ego = world.ego;
    const cx = ego.x + Math.cos(ego.psi) * 55,
      cy = ego.y + Math.sin(ego.psi) * 55;
    const near = world.parked.near(cx, cy, 45).filter((c) => {
      const l = ego.toLocal(c.x, c.y);
      return l.ahead > 20 && l.ahead < 90 && c.edge && !c.door && !c.stay;
    });
    if (!near.length) return null;
    const car = near[Math.floor(this.events() * near.length)];
    return this.startPullOut(car);
  }

  // Authored challenges use the same transition, gap acceptance and merge physics as background traffic.
  startPullOut(car) {
    const world = this.world,
      ego = world.ego,
      map = this.map;
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
    v.path = new NpcPath(map, this.random, { world: this.world });
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
        if (k.pull || isParkingTraffic(k)) continue;
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
    // (unless a registered feature has it wait: traffic in a one-car stretch between snowbanks, say)
    for (const may of TRAFFIC_PULL_OUT) if (!may(this.world, n)) return false;
    const path = n.path;
    const gap = Math.max(n.pull?.T || 3.5, n.driver && n.driver.T < 1.05 ? 3.5 : 5) + 1.5;
    for (const o of [this.world.ego, ...this.vehicles]) {
      if (o === n || Math.abs(o.x - n.x) > 70 || Math.abs(o.y - n.y) > 70) continue;
      const dx = n.x - o.x,
        dy = n.y - o.y,
        distance = Math.hypot(dx, dy);
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
    const inLane = Math.max(0, e.lane_width / 2 - 0.75),
      strip = stripOffset(e, pe.lane);
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
    if (k < 0) return Infinity;
    for (let i = k; i < path.edges.length && i <= k + 2; i++) {
      const pi = path.edges[i],
        e = this.map.edges.get(pi.id),
        prev = path.edges[i - 1];
      if (i > k && stripOffset(e, pi.lane) === null) return prev.sEnd - this.map.crossingHalfWidth(prev.id);
      const scale = (pi.sEnd - pi.sStart) / Math.max(1, e.length);
      for (const [s0, s1] of this.parkedAlong(e))
        if (pi.sStart + s1 * scale > front) return Math.max(front, pi.sStart + s0 * scale);
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
        const edge = this.map.edges.get(slot.edge);
        if (!edge) continue;
        const s = projectPoint(edge.pts, edge.cum, [slot.x, slot.y], null).s - CAR.rearOverhang;
        if (!this.bays.has(slot.edge)) this.bays.set(slot.edge, []);
        this.bays.get(slot.edge).push({ slot, s });
      }
      for (const list of this.bays.values()) list.sort((a, b) => a.s - b.s);
    }
    const out = (this.bays.get(e.id) || [])
      .filter((b) => b.slot.occupant || b.slot.reserved)
      .map((b) => [b.s, b.s + CAR.length]);
    // (a car parked outside a bay: placed by a challenge)
    const key = `${this.world.tick}:${parked.list.length}`;
    if (this.looseKey !== key) {
      this.looseKey = key;
      this.loose = parked.list.filter((c) => !c.slot);
    }
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
    const path = n.path,
      ns = n.spec;
    for (const o of [this.world.ego, ...this.vehicles]) {
      if (o === n || Math.abs(o.x - n.x) > 60 || Math.abs(o.y - n.y) > 60) continue;
      const p = projectPoint(path.pts, path.cum, [o.x, o.y], null);
      if (!p || Math.abs(p.lateral) > e.lane_width / 2 + 0.3) continue;
      const os = o.spec || CAR,
        ds = p.s - path.s;
      if (ds - os.rearOverhang > ns.length - ns.rearOverhang + 0.5) continue;
      const behind = -ds - (os.length - os.rearOverhang) - ns.rearOverhang;
      if (behind < MERGE_GAP_M + Math.max(0, o.v - n.v) * MERGE_GAP_S) return false;
    }
    return true;
  }

  // Move a stopped cyclist up to `by` metres to its right (negative: left), at SHUFFLE_MPS, and turn it
  // up to `turn` radians toward its path at SHUFFLE_TURN, if nothing is in the way there.
  shuffle(n, by, turn, dt) {
    const d = Math.sign(by) * Math.min(SHUFFLE_MPS * dt, Math.abs(by)),
      x = n.x + Math.sin(n.psi) * d,
      y = n.y - Math.cos(n.psi) * d;
    const psi = n.psi + Math.sign(turn) * Math.min(SHUFFLE_TURN * dt, Math.abs(turn)),
      f = n.spec.length / 2 - n.spec.rearOverhang;
    const box = { ...n.obb(), heading: psi, center: [x + Math.cos(psi) * f, y + Math.sin(psi) * f] };
    // (to within 0.1 m of nothing new, and away from anything already that close)
    const near = this.world.obstaclesNear(x, y, 8).concat(this.world.ego),
      now = n.obb();
    const closer = (o) =>
      Math.hypot(box.center[0] - o.center[0], box.center[1] - o.center[1]) <
      Math.hypot(now.center[0] - o.center[0], now.center[1] - o.center[1]);
    if (
      near.some(
        (o) => o !== n && o.obb && obbOverlap(box, o.obb(), 0.1) && (!obbOverlap(now, o.obb(), 0.1) || closer(o)),
      )
    )
      return;
    n.x = x;
    n.y = y;
    n.psi = psi;
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
      if (
        local.right < (n.spec.width + o.spec.width) / 2 + 0.1 ||
        local.right > HOOK_SIDE_M ||
        local.ahead < -HOOK_LOOK_M
      )
        continue;
      const along = (node.x - o.x) * Math.cos(o.psi) + (node.y - o.y) * Math.sin(o.psi);
      if (along < -1) continue; // past the corner
      if (Math.max(0, along - half - (o.spec.length - o.spec.rearOverhang)) / Math.max(0.5, o.v) < mine) return true;
    }
    return false;
  }

  // Start a lane change when the lane is wrong for the next turn (looking through a short link inside
  // the junction), or, now and then, to get past a
  // slow car. Only mid-block on multi-lane edges, and only into a gap that is free well behind and
  // ahead in the target lane.
  // Giving way (`curbward`), a driver moves a lane to the right whenever the gap allows, at any speed,
  // up to 15 m before the street ends.
  maybeChangeLane(n, edge, front, curbward = false) {
    const e = this.map.edges.get(edge.id);
    if (!e || e.lanes < 2 || (n.v < 3 && !curbward) || n.lcCooldown > 0 || n.kind === "bike" || n.pull) return;
    const toEnd = edge.sEnd - front;
    if (toEnd < (curbward ? 15 : LC_END_M)) return;
    if (edge.control && !curbward) {
      const lineS = pathLine(edge, e.length, edge.control.s_line);
      if (lineS - front < LC_END_M && lineS - front > -5) return;
    }
    const path = n.path;
    // the turn at the next junction, looking through a short link that goes straight on inside it
    let k = path.edges.indexOf(edge),
      turn = "straight";
    for (; k + 1 < path.edges.length; k++) {
      const a = path.edges[k],
        b = path.edges[k + 1];
      turn = this.map.classifyTurn(this.map.turnAngle(a.id, b.id));
      if (turn !== "straight" || this.map.edges.get(b.id).length >= LINK_M || k + 2 >= path.edges.length) break;
    }
    let dir = 0;
    if (curbward) dir = edge.lane < e.lanes - 1 ? 1 : 0;
    else if (turn === "left" && edge.lane > 0) dir = -1;
    else if (turn === "right" && edge.lane < e.lanes - 1) dir = 1;
    else if (
      turn === "straight" &&
      n.lead &&
      n.lead.gap < 35 &&
      n.lead.v < n.v0 - 2.5 &&
      this.random() < 0.02 * (n.driver ? n.driver.lcRate : 1)
    ) {
      dir = edge.lane > 0 ? -1 : 1;
      if (PASSING_LANE_BLOCKED.some((blocked) => blocked(this.world, n, dir))) dir = 0;
    }
    for (const choose of TRAFFIC_LANE_DIRECTION) dir = choose(this.world, n, edge, e, turn, toEnd, dir);
    if (!dir) return;
    const to = edge.lane + dir;
    if (to < 0 || to >= e.lanes) return;
    const lane = this.map.lane(edge.id, to);
    if (!lane) return;
    const me = projectPoint(lane.pts, lane.cum, [n.x, n.y], null);
    for (const o of [this.world.ego, ...this.vehicles]) {
      if (o === n || Math.abs(o.x - n.x) > 60 || Math.abs(o.y - n.y) > 60) continue;
      const p = projectPoint(lane.pts, lane.cum, [o.x, o.y], null);
      if (!p || Math.abs(p.lateral) > 2.2) continue;
      const ds = p.s - me.s;
      let need = laneChangeGap(ds, n.v, o.v);
      for (const mergeGap of MERGE_GAP) need = Math.max(need, mergeGap(o, ds, e.limit));
      const ns = n.spec || CAR,
        os = o.spec || CAR;
      const bodyGap = laneChangeBodyGap(ds, ns, os);
      if (Math.abs(ds) < need + bodyGap) return;
    }
    n.lc = { dir, to, edge: edge.id, width: Math.abs(e.lane_offsets[to] - e.lane_offsets[edge.lane]), t: 0, T: 3.5 };
  }

  // At a red light: a right turn from the curb lane, or an enabled legal left from the
  // leftmost lane. Both require a full stop, a clear junction and a gap in crossing traffic.
  rightOnRed(n, e, bumperToLine, front, dt) {
    const path = n.path,
      i = path.edges.indexOf(e),
      next = path.edges[i + 1];
    const edge = this.map.edges.get(e.id);
    if (!e.control || !edge) return false;
    const extraTurn = next && firstHookResult(RED_TURN_LANE, this.world, e.id, next.id);
    if (next && RED_TURN_BLOCKED.some((blocked) => blocked(this.world, e.id, next.id))) return false;
    if (
      !next ||
      (extraTurn
        ? e.lane !== extraTurn.lane
        : !this.map.rightOnRed ||
          e.lane !== edge.lanes - 1 ||
          this.map.classifyTurn(this.map.turnAngle(e.id, next.id)) !== "right")
    )
      return false;
    if (n.stopMem.update(e.control, bumperToLine, n.v, dt) !== "completed") return false;
    // Do not enter across protected oncoming turns or under a phase that forbids turns on red.
    const inter = this.map.intersections.get(e.control.id);
    if (inter && (advanceHolds(inter, e.id, this.world.t) || phaseBansRedTurns(inter))) return false;
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
      if (Math.abs(wrap(o.psi - n.psi)) < (Math.PI * 5) / 6) continue;
      const dx = node.x - o.x,
        dy = node.y - o.y,
        d = Math.hypot(dx, dy);
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
    const gapS = crossingGap(n.driver) + extra;
    for (const o of [this.world.ego, ...this.vehicles]) {
      if (o === n || o.v < 1) continue;
      if (Math.abs(wrap(o.psi - n.psi)) < Math.PI / 6) continue; // going our way
      const dx = node.x - o.x,
        dy = node.y - o.y,
        d = Math.hypot(dx, dy);
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
    const edge = this.map.edges.get(edgeId);
    if (!edge) return false;
    const ctl = controlAt(this.world, edge.control, edgeId);
    // (a stop standing in for a grouped junction gives way at that junction)
    const node = (ctl && firstHookResult(PRIORITY_JUNCTION, this.world, ctl)) || this.map.nodes.get(edge.to);
    if (!node) return false;
    const mine = toNode / Math.max(1, n.v);
    for (const o of [this.world.ego, ...this.vehicles]) {
      // (anything moving counts, however slowly: the ETA below decides whether it matters)
      if (o === n || o.v < 0.2) continue;
      const dx = node.x - o.x,
        dy = node.y - o.y,
        d = Math.hypot(dx, dy);
      if (d > 90 || d < 1 || (dx * Math.cos(o.psi) + dy * Math.sin(o.psi)) / d < 0.7) continue;
      const a = approachTo(this.map, o, node.id);
      if (!a || !outranks(this.map, a.edge, edgeId, this.world)) continue;
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
    const nodeId = this.map.edges.get(edgeId)?.to,
      node = this.map.nodes.get(nodeId);
    if (!node) return false;
    const gapS = crossingGap(n.driver);
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
      if (
        a &&
        a.to_node_m < UNSIGNED_NEAR_M &&
        controlAt(this.world, this.map.edges.get(a.edge)?.control, a.edge)?.all_way
      )
        return true;
    }
    return false;
  }

  isJunction(nodeId) {
    if (!this.junctions) this.junctions = new Map();
    if (!this.junctions.has(nodeId)) {
      const ids = [...(this.map.inn.get(nodeId) || []), ...(this.map.out.get(nodeId) || [])];
      const neighbors = new Set();
      for (const id of ids) {
        const e = this.map.edges.get(id);
        if (e) neighbors.add(e.from === nodeId ? e.to : e.from);
      }
      this.junctions.set(nodeId, neighbors.size >= 3);
    }
    return this.junctions.get(nodeId);
  }

  // Whether traffic across stands in the junction at the end of `e`; `onRoad`: only where its body lies
  // across the approach's asphalt.
  boxBusy(n, e, onRoad = false) {
    const junction = firstHookResult(PRIORITY_JUNCTION, this.world, e.control, true);
    const node = junction ?? this.map.nodes.get(e.to);
    if (!node) return false;
    for (const o of [this.world.ego, ...this.vehicles]) {
      if (o === n) continue;
      if (PRIORITY_TRAFFIC_OUTSIDE.some((outside) => outside(this.world, e.control, o, null, true, junction))) continue;
      if (Math.hypot(o.x - node.x, o.y - node.y) > BOX_M) continue;
      const diff = Math.abs(wrap(o.psi - n.psi));
      if (diff > Math.PI / 6 && diff < (Math.PI * 5) / 6) {
        // The radius includes cars whose tail has already left the crossing street.
        // Giving way can stop one there, but it no longer occupies this junction.
        const edge = this.map.edges.get(e.id);
        if (onRoad && edge?.asphalt) {
          const box = o.obb(),
            h = this.map.headingIn(e.id),
            angle = box.heading - h;
          const right = (box.center[0] - node.x) * Math.sin(h) - (box.center[1] - node.y) * Math.cos(h);
          const half = Math.abs(Math.sin(angle)) * box.halfLength + Math.abs(Math.cos(angle)) * box.halfWidth;
          if (right + half < edge.asphalt[0] - 0.1 || right - half > edge.asphalt[1] + 0.1) continue;
        }
        return true;
      }
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

  // The successor of edge `from` closest to straight on, other than `not`, that traffic may take
  // (no banned turn, closed block or U-turn), or null.
  otherWay(path, from, not) {
    const ok = this.map
      .successors(from)
      .filter(
        (id) =>
          !not.has(id) &&
          Math.abs(this.map.turnAngle(from, id)) <= SHARP_TURN &&
          !TRAFFIC_TURN_BLOCKED.some((blocked) => blocked(this.world, from, id, false)) &&
          !path.closures?.closed.has(id),
      );
    ok.sort((a, b) => Math.abs(this.map.turnAngle(from, a)) - Math.abs(this.map.turnAngle(from, b)));
    return ok[0] ?? null;
  }

  recoverPath(n) {
    const near = this.map.nearestLane(n.x, n.y, n.psi, 40);
    if (!near) return;
    // Rebase the plan without teleporting the body or instantaneously stopping a moving car. (A
    // registered feature's vehicle back on its way keeps to it: a bus back on its run, say.)
    if (!TRAFFIC_RECOVER.some((recover) => recover(this.world, this, n, near)))
      n.path.start(near.lane.edge, near.lane.idx, near.s);
    n.stopMem.reset();
    n.lc = null;
  }
}
