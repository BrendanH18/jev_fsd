import { vanNotice } from "../double-parked.js";
import { oncomingPassConflict } from "../cyclist-pass.js";
import {
  DoubleParked,
  PASS_DECEL,
  PASS_MPS,
  VAN_LOOK_M,
  VAN_NAME,
  defaultVanCount,
  isVan,
  queuedAhead,
  wayRound,
} from "../double-parked.js";
import { pointAt, projectPoint } from "../../map/mapdata.js";
import { DAYLIGHT_RANGE_M } from "../visibility.js";
import { wrap } from "../world.js";
import { doubleParkedModel } from "../double-parked-model.js";
import { doubleParkedTraffic } from "../double-parked-traffic.js";

// One pass lasts while the front bumper is alongside the detour.
function auditPass(world) {
  const vans = world.doubleParked.vans;
  if (!vans.length) {
    world.vanCalls.clear();
    return;
  }
  const ego = world.ego,
    FRONT = ego.spec.length - ego.spec.rearOverhang;
  // (one pass lasts while the car's front is alongside the way round, across the centre line or not)
  let passing = null;
  for (const d of vans) {
    if (Math.abs(ego.x - d.x) > 60 || Math.abs(ego.y - d.y) > 60) continue;
    const e = world.map.edges.get(d.edge),
      p = projectPoint(e.pts, e.cum, [ego.x, ego.y], null);
    if (
      !p ||
      Math.abs(wrap(ego.psi - p.heading)) > Math.PI / 3 ||
      p.lateral < e.asphalt[0] - 1 ||
      p.lateral > e.asphalt[1] + 1
    )
      continue;
    const front = p.s + FRONT;
    if (front < d.detour.from || front > d.detour.to) continue;
    passing = { d, e, front, across: p.lateral < 0 };
    break;
  }
  if (!passing) {
    world.vanCalls.clear();
    return;
  }
  world.vansSeen = true;
  const { d, e, front, across } = passing;
  if (!world.vanCalls.has(d.id)) {
    world.vanCalls.clear();
    world.vanCalls.set(d.id, false);
  }
  if (world.vanCalls.get(d.id) || !across) return;
  const n = oncomingPassConflict(world, e, front);
  if (n) {
    world.vanCalls.set(d.id, true);
    world.violations.failed_to_yield++;
    world.events.push({
      type: "failed_to_yield",
      to: "oncoming traffic",
      with: n.id,
      double_parked: true,
      van: d.id,
    });
  }
}

// A van double-parked in the car's lane on its route ahead (sim/double-parked.js), from when the car
// can see it, VAN_LOOK_M short of its rear or nearer, until its front is past the end of the way
// round. `stop_s_route` is where its front waits (WAIT_M short of the van, back far enough to pull out
// round it); `way` the way round as far as the car can tell, from what it can see (`clear`, `oncoming`:
// the first vehicle coming the other way that leaves too little time, and when it gets there,
// `sees_far_enough`: along the oncoming lane, as far as anyone at the street's limit would come in
// the time it takes); `queued` someone waiting behind the van ahead of the car; `going_round` the car
// has started round it (it is executing a law that goes round, and has moved across or past where
// it waits), and carries on; `go` it goes round now (going round, or the way clear with nobody
// waiting ahead of it), and then `detour` is the way round in route arc lengths (sim/controller.js
// detourAt); `wait` it waits behind it instead. Or null.
function doubleParked(world, p, frontS, lane, executing) {
  const { ego, route, map } = world,
    vans = world.doubleParked;
  if (!vans?.vans.length) return null;
  for (const d of vans.vans) {
    if (Math.hypot(d.x - ego.x, d.y - ego.y) > VAN_LOOK_M + 30) continue;
    const i = route.edges.findIndex((id, k) => id === d.edge && route.edgeStarts[k + 1] > frontS - ego.spec.length);
    if (i < 0) continue;
    const e = map.edges.get(d.edge),
      el = map.lane(e.id, 0),
      base = route.edgeStarts[i + 1] - e.length;
    // (along the route: where the edge puts it, as projected onto the route's own line)
    const toRoute = (x) => {
      const est = base + x,
        q = pointAt(el.pts, el.cum, (x * el.length) / e.length),
        r = projectPoint(route.pts, route.cum, q);
      return r && r.distance < 1.5 && Math.abs(r.s - est) < 15 ? r.s : est;
    };
    const rear = toRoute(d.rear),
      to = toRoute(d.detour.to),
      stop = toRoute(d.wait);
    if (frontS > to || rear - frontS > VAN_LOOK_M) continue;
    if (frontS < rear && !world.sees(ego, d.van)) continue;
    // (what is coming the other way, as far as the car can see: further than the traffic it follows)
    const sFront = frontS - base,
      others = world
        .visibleObstaclesNear(ego.x, ego.y, DAYLIGHT_RANGE_M + 10)
        .filter((o) => o !== ego && !o.parked && o.kind !== "pedestrian");
    const way = wayRound(world, d, sFront, ego.v, others, vans.sightFor(d));
    const queued = queuedAhead(world, d, sFront, ego, others);
    const across = p.lateral - (lane?.center ?? 0) < -0.3;
    const going = executing?.law?.detour?.id === d.id && (across || frontS > stop + 0.5);
    const go = going || (way.clear && !queued);
    return {
      id: d.id,
      van_id: d.van.id,
      kind: d.name || VAN_NAME,
      ...(d.truck ? { truck: true, crew_in_road: way.crew ? way.crew.id : null } : {}),
      gap_m: rear - frontS,
      beside: frontS > rear,
      stop_s_route: stop,
      bumper_to_stop_m: stop - frontS,
      way: {
        clear: way.clear,
        sees_far_enough: way.sees_far_enough,
        need_s: way.need_s,
        oncoming: way.oncoming ? { id: way.oncoming.vehicle.id, eta_s: way.oncoming.eta_s } : null,
      },
      queued: queued ? queued.id : null,
      going_round: going,
      go,
      wait: !go,
      limit_mps: PASS_MPS,
      detour: go
        ? {
            id: d.id,
            from: toRoute(d.detour.from),
            full: toRoute(d.detour.full),
            back: toRoute(d.detour.back),
            to,
            shift: d.detour.shift,
          }
        : null,
    };
  }
  return null;
}

// The speed to go round a double-parked van at (see doubleParked), from where the car would wait
// behind it, or, short of that, the speed from which it slows to it gently by then.
function vanSpeed(dp) {
  if (dp.bumper_to_stop_m <= 0) return dp.limit_mps;
  return Math.sqrt(dp.limit_mps * dp.limit_mps + 2 * PASS_DECEL * dp.bumper_to_stop_m);
}

export default {
  checkpoint(world) {
    if (world.doubleParked) world.doubleParked.world = world;
  },
  rulesStop: (snap) => snap.double_parked?.wait && snap.double_parked.bumper_to_stop_m < 1.5,
  legitimateStop: (snap) => snap?.double_parked?.wait && snap.double_parked.bumper_to_stop_m < 8,
  rulesCost: (c) => (c.id === "wait_behind_van" ? -6 : 0),
  // (nobody parks on the block of a double-parked van, either side: sim/parallel-park.js)
  parkingObstructed: (world, edge) => !!world.doubleParked?.vans.some((d) => d.edge === edge || d.opposite === edge),
  key: "vans",
  view: () => import("../../render/delivery-van.js"),
  coach: {
    init: () => ({
      vanCutoffs: 0,
    }),
    events: {
      failed_to_yield(score, ev) {
        if (!ev.double_parked) return;
        score.vanCutoffs++;
      },
    },
    reports: [{ at: "afterFlagger", order: 0, read: (score) => ({ van_cutoffs: score.vanCutoffs }) }],
    tips: [
      {
        at: "afterCyclists",
        order: 0,
        when: (score) => score.vanCutoffs,
        text: "Going round a vehicle stopped in your lane, wait behind it until the oncoming lane is clear for the whole way round and back. Oncoming traffic has the right of way.",
      },
    ],
    directionExempt: (world) => !!world.doubleParked?.passing(),
  },
  notice: {
    at: "beforePlow",
    order: 0,
    duration: 2500,
    read: (world) => vanNotice(world),
    style: (line) => (line.wait ? "safety" : ""),
  },
  perceptionLine(snap) {
    const dp = snap.double_parked;
    const text = dp
      ? `${dp.truck ? "Garbage truck" : "Double-parked van"} ${dp.gap_m > 0 ? `${Math.round(dp.gap_m)} m ahead` : "beside"}: ${dp.going_round ? "going round it" : dp.go ? `way round clear, go round at ${Math.round(dp.limit_mps * 3.6)} km/h` : dp.queued ? "wait in turn behind it" : `${dp.crew_in_road ? "crew in the road" : dp.way.oncoming ? "oncoming traffic" : "can't see far enough"}, wait${dp.bumper_to_stop_m > 0.5 ? ` in ${Math.round(dp.bumper_to_stop_m)} m` : ""}`}`
      : null;
    return text ? { order: 14, label: "Double-parked", text } : null;
  },
  perceptionFocus: (snap, o) => o.id === snap.double_parked?.van_id,
  perceptionRejections: {
    no_room_to_go_round: "Too close to pull out round the van",
  },
  property: "doubleParked",
  defaultCount: defaultVanCount(),
  seen: "vansSeen",
  calls: "vanCalls",
  snapshot: { double_parked: null },
  build: (world, { enabled, seed }) => new DoubleParked(world, { count: Number(enabled), seed }),
  stepBeforeTraffic: {
    at: "afterOutages",
    run(world, _fleet, dt) {
      world.doubleParked.step(dt);
    },
  },
  audit: { at: "afterFlagger", run: auditPass },
  sense: {
    at: "parking",
    run(world, snap, { p, frontS, lane, executing }) {
      snap.double_parked = doubleParked(world, p, frontS, lane, executing);
      if (snap.double_parked) world.vansSeen = true;
    },
  },
  obstacle: { test: isVan, traffic: true, label: "double-parked van" },
  followingExclusion(snap) {
    const d = snap.double_parked;
    return d?.wait && d.bumper_to_stop_m > -1 ? d.van_id : null;
  },
  detour: { at: "parking", run: (snap) => snap.double_parked?.detour },
  limit: {
    at: "passing",
    run(snap) {
      if (snap.double_parked) snap.limit = Math.min(snap.limit, vanSpeed(snap.double_parked));
    },
  },
  target: {
    at: "parking",
    run(snap, v, reasons, { decel, stopSpeedFor }) {
      // a double-parked van with no way round it yet: wait behind it
      const dp = snap.double_parked;
      if (dp?.wait && dp.bumper_to_stop_m > -1) {
        const room = dp.bumper_to_stop_m;
        const vv = room < 1.0 ? 0 : stopSpeedFor(room - 0.5, decel);
        const what = dp.truck ? "a garbage truck" : "a double-parked van";
        if (vv < v) {
          v = vv;
          reasons.push(
            dp.queued
              ? `waiting in turn behind ${what}`
              : dp.crew_in_road
                ? "garbage truck: wait while its crew is in the road"
                : `${what.slice(2)}: wait for the way round to clear`,
          );
        }
      } else if (dp?.go && vanSpeed(dp) <= v + 0.05)
        reasons.push(`going round ${dp.truck ? "a garbage truck" : "a double-parked van"}`);
      return v;
    },
  },
  hazard: { at: "parking", run: (snap) => (snap.double_parked ? "double-parked van" : null) },
  candidates: {
    at: "parking",
    run({ snap, laneUntil, inLane, approach, stopAt, FRONT }, out) {
      // A van double-parked in the lane ahead, and no way round it yet: stop behind it, back far enough to
      // pull out round it, and wait there until the oncoming lane is clear.
      const dp = snap.double_parked;
      if (dp?.wait && dp.bumper_to_stop_m > 0.3) {
        out.push({
          id: "wait_behind_van",
          laneUntil,
          law: inLane({ kind: "lane", vTarget: approach, stopAtRoute: stopAt(dp.stop_s_route - FRONT) }),
          steer: "hold lane",
          speed: dp.queued
            ? "stop behind the car waiting at the double-parked van"
            : "stop behind the double-parked van and wait for the oncoming lane to clear",
        });
      }
    },
  },
  sim: {
    at: "parking",
    run(_world, snap) {
      const d = snap.double_parked;
      if (!d?.wait || !(d.bumper_to_stop_m > 0.3)) return null;
      let entered = false;
      return {
        start() {
          entered = false;
        },
        along(s, front) {
          // 1.5 m past the wait point still leaves room to pull out.
          if (s + front > d.stop_s_route + 1.5) entered = true;
        },
        reject(c) {
          return entered && c.law.kind !== "hard_brake" ? "no_room_to_go_round" : null;
        },
      };
    },
  },
  ...doubleParkedModel,
  ...doubleParkedTraffic,
};
