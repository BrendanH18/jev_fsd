import { r1 } from "../../common.js";
import { onStreet, pointAt, projectPoint } from "../../map/mapdata.js";
import { wrap } from "../world.js";
import { boxGap } from "../collision.js";
import { BIKE } from "../vehicle.js";
import { current as weather } from "../weather.js";
import { featureObstacle, hooks, firstHookResult } from "./index.js";
import {
  FOLLOW_M as CYCLIST_FOLLOW_M,
  LEAD_M as CYCLIST_LEAD_M,
  LOOK_M as CYCLIST_LOOK_M,
  MIN_EASE_M,
  PASS_DECEL as CYCLIST_PASS_DECEL,
  RETURN_M as CYCLIST_RETURN_M,
  isCyclistPass,
  passId,
  passOthers,
  passStreet,
  planPass,
  DECIDE_M as CP_DECIDE_M,
  cyclistNotice,
  egoPassing,
  minPassM,
  oncomingPassConflict,
  queuedBehind,
  ridingIn,
  sightFor as cyclistSight,
  wayClear as cyclistWayClear,
} from "../cyclist-pass.js";

const PASS_BLOCK_REASON = hooks("passBlockReason");

// Passing a cyclist through the oncoming lane (sim/cyclist-pass.js): no manoeuvre that goes round one
// may have the car, its far side across the centre line, meet a vehicle coming the other way in its way
// closer than this front to front, or this soon at the speed they close at (as the audit counts it).
const MEET_M = 8,
  MEET_S = 2,
  MEET_SIDE_M = 0.5;
// Passing cyclists (sim/cyclist-pass.js), with `passCyclists` on. A pass is the car's body going from
// wholly behind a cyclist going its way (within 30 m) to wholly ahead of it; it is a close pass when,
// beside it, the gap between their bodies was ever less than the minimum passing distance on the
// street (1 m up to 50 km/h, 1.5 m above) less AUDIT_PASS_SLACK_M. And, passing one with its centre left
// of the centre line, the car fails to yield when it cuts off oncoming traffic: once a pass.
const AUDIT_PASS_SLACK_M = 0.1;
const AUDIT_PASS_NEAR_M = 30;

// Passing a cyclist (sim/cyclist-pass.js): a driver moves across at this lateral speed per m/s it
// drives, between these; one that falls back in behind it waits this long before it looks again; and
// the cyclist stays the one it follows until it is this much short of the minimum passing distance clear.
const CP_SIDE_PER_MPS = 0.2,
  CP_SIDE_MPS = [0.6, 1.4],
  CP_RETRY_S = 2,
  CP_LEAD_SLACK_M = 0.15;

// Passing a cyclist through the oncoming lane (sim/cyclist-pass.js) costs this to start, so the car
// passes only for a clear gain; and staying behind one it cannot pass yet gains this.
const PASS_CYCLIST_COST = 1.5,
  FOLLOW_CYCLIST_GAIN = 1.0;

// Passing a cyclist closer than the minimum passing distance, and crossing into the way of oncoming
// traffic while passing one (see AUDIT_PASS_SLACK_M).
function auditCyclistPasses(world, road) {
  const ego = world.ego,
    eb = ego.obb(),
    min = minPassM(road?.limit ?? 11.2);
  for (const n of world.npcs) {
    if (n.kind !== "bike") continue;
    if (
      Math.abs(n.x - ego.x) > AUDIT_PASS_NEAR_M ||
      Math.abs(n.y - ego.y) > AUDIT_PASS_NEAR_M ||
      Math.abs(wrap(n.psi - ego.psi)) > Math.PI / 4
    ) {
      world.bikePasses.delete(n.id);
      continue;
    }
    const b = n.obb(),
      c = Math.cos(b.heading),
      s = Math.sin(b.heading),
      dx = eb.center[0] - b.center[0],
      dy = eb.center[1] - b.center[1];
    const ahead = dx * c + dy * s,
      reach = eb.halfLength + b.halfLength;
    if (ahead < -reach) {
      world.bikePasses.set(n.id, { min: Infinity });
      continue;
    }
    const rec = world.bikePasses.get(n.id);
    if (!rec) continue;
    // (the gap between the bodies: a car still angled out of a turn, or back into its lane, has its
    // centre line nearer the cyclist's than the side of it going by)
    if (ahead <= reach) {
      rec.min = Math.min(rec.min, boxGap(eb, b));
      continue;
    }
    world.bikePasses.delete(n.id);
    if (rec.min < min - AUDIT_PASS_SLACK_M) {
      world.violations.close_passes = (world.violations.close_passes || 0) + 1;
      world.events.push({
        type: "close_pass",
        with: n.id,
        clearance_m: Math.round(Math.max(0, rec.min) * 100) / 100,
        min_m: min,
      });
    }
  }
  const passing = egoPassing(world);
  if (!passing) {
    world.cyclistPass = null;
    return;
  }
  const { bike, e, front, across } = passing;
  if (world.cyclistPass?.id !== bike.id) world.cyclistPass = { id: bike.id, counted: false };
  if (world.cyclistPass.counted || !across) return;
  const n = oncomingPassConflict(world, e, front, bike);
  if (n) {
    world.cyclistPass.counted = true;
    world.violations.failed_to_yield++;
    world.events.push({
      type: "failed_to_yield",
      to: "oncoming traffic",
      with: n.id,
      cyclist_pass: true,
      cyclist: bike.id,
    });
  }
}

// Passing a cyclist riding in the driver's lane ahead, on a two-way street with one lane each way
// (sim/cyclist-pass.js). Once its front is within DECIDE_M of the cyclist's rear, with nobody between
// them, it starts over if the pass is on, it is where the pass would start easing over, and the way is
// clear (as this driver pulls away), and then
// eases across to the plan's shift and back in once its rear is RETURN_M past the cyclist's front; the
// cyclist stays the one it follows until it is clear of it. Still behind the cyclist, it falls back
// in behind it if the way stops being clear, and looks again CP_RETRY_S later. `n.cyc` is the pass
// ({ id, phase: "out" | "back", shift, min }), `n.cpShift` how far across it is now. Returns { bike,
// min (the minimum passing distance) } while it is passing or easing back, or null.
function passInTraffic(world, n, pe, all, dt, held, driver) {
  const { map } = world;
  if (n.cycWait > 0) n.cycWait -= dt;
  const e = map.edges.get(pe.id),
    street = passStreet(map, pe.id),
    on = street ? onStreet(e, n) : null;
  const front = on ? on.s + n.spec.length - n.spec.rearOverhang : 0,
    D = n.driver || driver;
  const self = { accel: D.aMax, react: D.react || 0, vmax: n.v0 * weather.speed };
  let rec = n.cyc,
    bike = null,
    bon = null;
  if (rec) {
    bike = all.find((v) => v.id === rec.id) || null;
    if (!bike) {
      n.cyc = null;
      n.cpShift = 0;
      return null;
    }
    bon = bike && on?.same ? ridingIn(e, bike) : null;
  } else {
    if (!on?.same || n.cycWait > 0 || held) return null;
    let best = Infinity;
    for (const b of all) {
      if (b.kind !== "bike" || Math.abs(b.x - n.x) > CP_DECIDE_M + 10 || Math.abs(b.y - n.y) > CP_DECIDE_M + 10)
        continue;
      const q = ridingIn(e, b),
        g = q ? q.s - (b.spec || BIKE).rearOverhang - front : Infinity;
      if (g > -0.5 && g < CP_DECIDE_M && g < best) {
        best = g;
        bike = b;
        bon = q;
      }
    }
    if (!bike) return null;
    const others = all.filter((x) => x !== n),
      plan = planPass(world, e, { front, v: n.v, spec: n.spec, bike, on: bon, driver: self, others });
    // (and only once it is where it would start over: no sooner into the oncoming lane than it needs)
    if (
      !plan?.possible ||
      plan.from > front + 2 ||
      queuedBehind(e, front, plan, n, all) ||
      !cyclistWayClear(world, plan, others).clear
    )
      return null;
    rec = n.cyc = { id: bike.id, phase: "out", shift: plan.shift, min: plan.min_pass_m };
    n.cpShift = n.cpShift || 0;
  }
  if (rec.phase === "out") {
    const bs = bike.spec || BIKE,
      bRear = bon ? bon.s - bs.rearOverhang : 0;
    if (!bon || (held && front < bRear - 0.5)) rec.phase = "back";
    else {
      if (on.s - n.spec.rearOverhang > bRear + bs.length + CYCLIST_RETURN_M) rec.phase = "back";
      else if (front < bRear - 0.5) {
        // (still behind it: if the way is no longer clear, it falls back in behind)
        const others = all.filter((x) => x !== n),
          plan = planPass(world, e, { front, v: n.v, spec: n.spec, bike, on: bon, driver: self, others });
        if (!plan?.possible || !cyclistWayClear(world, plan, others).clear) {
          rec.phase = "back";
          n.cycWait = CP_RETRY_S;
        } else rec.shift = plan.shift;
      }
    }
  }
  const target = rec.phase === "out" ? rec.shift : 0;
  const rate = Math.max(CP_SIDE_MPS[0], Math.min(CP_SIDE_MPS[1], CP_SIDE_PER_MPS * n.v)) * dt;
  n.cpShift += Math.max(-rate, Math.min(rate, target - n.cpShift));
  if (rec.phase === "back" && Math.abs(n.cpShift) < 0.02) {
    n.cyc = null;
    n.cpShift = 0;
    return null;
  }
  return { vehicle: bike, clearance: rec.min - CP_LEAD_SLACK_M, shift: n.cpShift };
}

// A cyclist riding in the car's lane ahead, on a two-way street with one lane each way, that the car
// could pass only through the oncoming lane (sim/cyclist-pass.js, `World` option `passCyclists`): the
// nearest one it can see within CYCLIST_LOOK_M on the street it is on, or the one it is passing, until
// it is past the end of the way round. `possible`/`why` say whether a pass is on at all (planPass);
// `way` whether the oncoming lane is clear, as far as the car can see; `queued` someone between the car
// and the cyclist; `too_close` the car is too close behind it to pull out with room (it drops back);
// `going` the car has started round it (it is executing a law that goes round it and has moved across,
// or drawn level); `go` it goes round now (going round, unless the way has stopped being clear while it
// is still behind the cyclist; or the pass on, the way clear and nobody between). Then `detour` is the
// way round in route arc lengths (sim/controller.js detourAt), re-anchored on the cyclist as it moves:
// where it starts kept from the law going round, and once the car is past it, all of it. `follow_mps`
// is the speed to stay CYCLIST_FOLLOW_M behind it at. Or null.
function cyclistPass(world, p, lane, executing) {
  if (!world.passCyclists) return null;
  const { ego, route, map } = world,
    FRONT = ego.spec.length - ego.spec.rearOverhang;
  const i = route.edgeIndexAt(p.s),
    e = map.edges.get(route.edges[i]);
  if (!e || !passStreet(map, e.id)) return null;
  const on = onStreet(e, ego);
  if (!on?.same) return null;
  const front = on.s + FRONT,
    el = map.lane(e.id, 0),
    base = route.edgeStarts[i + 1] - e.length;
  // (along the route: where the edge puts it, as projected onto the route's own line, rear axle)
  const ref = (x) => {
    const est = base + x,
      q = pointAt(el.pts, el.cum, Math.max(0, Math.min(el.length, (x * el.length) / e.length))),
      r = projectPoint(route.pts, route.cum, q);
    return (r && r.distance < 1.5 && Math.abs(r.s - est) < 15 ? r.s : est) - FRONT;
  };
  const exec = isCyclistPass(executing?.law?.detour) ? executing.law.detour : null;
  let bike = null,
    bon = null,
    best = Infinity;
  for (const b of world.npcs) {
    if (
      b.kind !== "bike" ||
      Math.abs(b.x - ego.x) > CYCLIST_LOOK_M + 30 ||
      Math.abs(b.y - ego.y) > CYCLIST_LOOK_M + 30 ||
      !world.sees(ego, b)
    )
      continue;
    const q = ridingIn(e, b);
    if (!q) continue;
    const bs = b.spec,
      g = q.s - bs.rearOverhang - front,
      mine = exec?.id === passId(b);
    // (ahead of the car; or, the one it is passing, beside it or behind it)
    if (
      mine
        ? g < -(bs.length + ego.spec.length + CYCLIST_RETURN_M + 25) || g > CYCLIST_LOOK_M
        : g < -0.5 || g > CYCLIST_LOOK_M
    )
      continue;
    if ((mine ? -Infinity : g) < best) {
      best = mine ? -Infinity : g;
      bike = b;
      bon = q;
    }
  }
  if (!bike) return null;
  // (what is coming the other way, as far as the car can see: further than the traffic it follows)
  const others = passOthers(world);
  const plan = planPass(world, e, { front, v: ego.v, spec: ego.spec, bike, on: bon, others });
  if (!plan) return null;
  const id = passId(bike),
    lc = e.lane_offsets?.[0] ?? e.lane_width / 2;
  const behind = front < plan.bike_rear - 0.5,
    past = front - ego.spec.length > plan.bike_front + CYCLIST_RETURN_M - 0.5;
  const going = exec?.id === id && (on.lateral < lc - 0.3 || !behind);
  // (past it, and past the end of the way round: done)
  if (going && past && p.s > exec.to) return null;
  if (!going && !behind) return null;
  const way = plan.possible ? cyclistWayClear(world, plan, others, cyclistSight(world, plan)) : null;
  const queued = going ? null : queuedBehind(e, front, plan, ego, others);
  const tooClose = !going && plan.possible && plan.full - front < MIN_EASE_M;
  const go = going ? !behind || (plan.possible && way.clear) : plan.possible && way.clear && !queued && !tooClose;
  let detour = null;
  // (past it, or abreast of a cyclist that has sped up so the pass no longer works out: keep the marks
  // the car is going round by)
  if (go && going && (past || !Number.isFinite(plan.back))) detour = exec;
  else if (go) {
    const from = going ? exec.from : ref(plan.from),
      full = Math.max(from + 1, ref(plan.full)),
      back = Math.max(full, ref(plan.back));
    detour = { id, from, full, back, to: back + plan.ease_m, shift: plan.shift };
  }
  const bs = bike.spec;
  return {
    id,
    cyclist_id: bike.id,
    kind: "cyclist",
    gap_m: plan.gap_m,
    beside: !behind,
    speed: plan.bike_speed,
    min_pass_m: plan.min_pass_m,
    shift_m: plan.shift,
    limit_mps: plan.pass_mps,
    clearance_m: Math.abs(bon.lateral - on.lateral) - (bs.width + ego.spec.width) / 2,
    centre_line_route: (lane?.center ?? 0) - lc,
    possible: plan.possible,
    why: plan.why,
    way: way
      ? {
          clear: way.clear,
          sees_far_enough: way.sees_far_enough,
          need_s: way.need_s,
          oncoming: way.oncoming ? { id: way.oncoming.vehicle.id, eta_s: way.oncoming.eta_s } : null,
        }
      : null,
    queued: queued ? queued.id : null,
    too_close: tooClose,
    going,
    go,
    follow_gap_m: CYCLIST_FOLLOW_M,
    follow_mps: Math.max(
      0,
      plan.bike_speed + Math.max(-plan.bike_speed, Math.min(2, (plan.gap_m - CYCLIST_FOLLOW_M) / 3)),
    ),
    detour,
  };
}

// The speed to go round a cyclist at (see cyclistPass): the pass speed, or, short of being across, the
// speed from which the car slows to it gently by then.
function cyclistPassSpeed(cp) {
  const room = cp.beside ? 0 : Math.max(0, cp.gap_m - CYCLIST_LEAD_M);
  return Math.sqrt(cp.limit_mps * cp.limit_mps + 2 * CYCLIST_PASS_DECEL * room);
}

// Why a cyclist cannot be passed here (sim/cyclist-pass.js planPass), for models.
const CYCLIST_NOT_HERE = {
  too_fast: "it rides too near the limit to get by quickly",
  no_room: "there is no room for the car between it and the far side of the oncoming lane",
  junction: "the pass would not be over before the junction ahead",
  crosswalk: "a marked crosswalk is ahead",
  level_crossing: "a level crossing is ahead",
  double_parked: "a van is double-parked on the street",
  school_bus: "a school bus is stopped with its red lights flashing",
  streetcar: "a streetcar is stopped ahead",
  no_room_ahead: "there is no room to move back in ahead of it",
};

const passBlockReason = (why) =>
  firstHookResult(PASS_BLOCK_REASON, why) ??
  (Object.hasOwn(CYCLIST_NOT_HERE, why) ? CYCLIST_NOT_HERE[why] : "the passing conditions are not met");

// A cyclist riding in the car's lane ahead, on a two-way street with one lane each way
// (sim/cyclist-pass.js).
function cyclistClause(c) {
  const w = c.way,
    room = `${c.min_pass_m} m`,
    kmh = Math.round(c.limit_mps * 3.6);
  const lead = `A cyclist (\`${c.cyclist_id}\`) is riding in the car's lane ${c.gap_m > 0 ? `${Math.round(c.gap_m)} m ahead` : "beside the car"}, at ${Math.round(c.speed * 3.6)} km/h. With one lane each way there is no room to pass it within the lane: passing means moving into the oncoming lane, at least ${room} clear of the cyclist (the minimum passing distance where the limit is ${c.min_pass_m === 1 ? "50 km/h or less" : "over 50 km/h"}), and only when the oncoming lane is clear for the whole pass and back. Never squeeze past it in the lane.`;
  if (c.going && c.go)
    return `${lead} The car is passing it: carry on round at up to ${kmh} km/h, and back into the lane only well ahead of it; the car's candidates already do.`;
  const behind = ` Stay behind it, ${c.follow_gap_m} m back (\`follow_cyclist\`).`;
  if (c.going)
    return `${lead} The car had started round it, but the oncoming lane is no longer clear: fall back in behind it.${behind}`;
  if (!c.possible) return `${lead} It cannot be passed here: ${passBlockReason(c.why)}.${behind}`;
  if (c.queued) return `${lead} \`${c.queued}\` is behind it, ahead of the car: wait in turn.${behind}`;
  if (c.too_close) return `${lead} The car is too close behind it to pull out with room: drop back first.${behind}`;
  if (!w.clear) {
    const why = w.oncoming
      ? `\`${w.oncoming.id}\`, coming the other way, would get there in ${Math.round(w.oncoming.eta_s)} s, and the pass takes ${Math.round(w.need_s)} s`
      : "the car cannot see far enough along the oncoming lane to know it is clear";
    return `${lead} It is not clear now: ${why}.${behind}`;
  }
  return `${lead} The oncoming lane is clear for the whole pass now: pass it (\`pass_cyclist\`), at up to ${kmh} km/h, ${room} clear; the car's candidates take it round through the oncoming lane and back into its own lane ahead of the cyclist.`;
}

export default {
  key: "passCyclists",
  flag: "cyclistpass",
  calls: "bikePasses",
  build(world, { enabled }) {
    world.cyclistPass = null;
    return !!enabled;
  },
  resetContact(world) {
    world.cyclistPass = null;
  },
  audit: {
    at: "beforeReservedLane",
    run(world, road) {
      if (world.passCyclists) auditCyclistPasses(world, road);
    },
  },
  metric: {
    at: "vehiclePassing",
    name: "close_passes",
    reportWhenEnabled: true,
    failure: "passed a cyclist too close",
    examinerIncident: "close_pass",
    label: "Passed a cyclist closer than the minimum passing distance",
    category: "space",
    eventType: "close_pass",
  },
  snapshot: { cyclist_pass: null },
  trafficOvertaking(world, n, edge, all, dt, held, driver) {
    if (
      !world.passCyclists ||
      n.kind === "bike" ||
      n.transit ||
      n.school ||
      n.pull ||
      featureObstacle(n)?.noCyclistPass
    )
      return null;
    if (held && !n.cyc) return null;
    return passInTraffic(world, n, edge, all, dt, held, driver);
  },
  sense: {
    at: "afterParking",
    run(world, snap, { p, lane, executing }) {
      snap.cyclist_pass = cyclistPass(world, p, lane, executing);
    },
  },
  followingOmitted: (snap, vehicle) => snap?.cyclist_pass?.go && vehicle.id === snap.cyclist_pass.cyclist_id,
  detour: { at: "optional", run: (snap) => snap.cyclist_pass?.detour },
  limit: {
    at: "beforeBlindSpots",
    run(snap) {
      if (snap.cyclist_pass?.go) snap.limit = Math.min(snap.limit, cyclistPassSpeed(snap.cyclist_pass));
    },
  },
  target: {
    at: "afterLeader",
    run(snap, v, reasons) {
      // a cyclist the car cannot pass yet (sim/cyclist-pass.js): stay CYCLIST_FOLLOW_M behind it
      const cp = snap.cyclist_pass;
      if (cp && !cp.go && !cp.beside && cp.follow_mps < v) {
        v = cp.follow_mps;
        reasons.push(
          cp.possible && cp.way && !cp.way.clear
            ? "cyclist ahead: oncoming traffic, staying behind"
            : "cyclist ahead: staying behind",
        );
      } else if (cp?.go && cyclistPassSpeed(cp) <= v + 0.05)
        reasons.push(cp.going ? "passing a cyclist" : "cyclist ahead: way clear to pass");
      return v;
    },
  },
  hazard: { at: "afterParking", run: (snap) => snap.cyclist_pass && "cyclist ahead" },
  candidates: {
    at: "afterParking",
    run({ snap, laneUntil, limit, v, inLane, passing, speedLabel }, out) {
      // A cyclist riding in the lane ahead that the car can pass only through the oncoming lane
      // (sim/cyclist-pass.js): go round it at the pass speed, once the way is clear (or carry on round it);
      // or, still behind it, stay behind it at the following gap, in the lane.
      const cp = snap.cyclist_pass;
      if (cp?.go) {
        out.push({
          id: "pass_cyclist",
          laneUntil,
          laneTarget: cp.limit_mps,
          law: { ...inLane({ kind: "lane", vTarget: cp.limit_mps }), ...passing },
          steer: cp.going
            ? "carry on round the cyclist, then back into the lane ahead of it"
            : `pull out round the cyclist, ${cp.min_pass_m} m clear of it`,
          speed: speedLabel(cp.limit_mps, v, limit),
        });
      }
      if (cp && !cp.beside) {
        const behind = inLane({ kind: "lane", vTarget: Math.round(Math.min(limit, cp.follow_mps) * 10) / 10 });
        out.push({
          id: "follow_cyclist",
          laneUntil,
          law: behind,
          steer: "hold lane, behind the cyclist",
          speed: `stay ${cp.follow_gap_m} m behind the cyclist`,
        });
      }
    },
  },
  priority: ["pass_cyclist", "follow_cyclist"],
  activeManeuver: (snap, passing) =>
    snap.cyclist_pass?.going
      ? { keep: (c) => c.id === "pass_cyclist" || c.id === "follow_cyclist", brake: passing }
      : null,
  passClearance: (world, snap) =>
    world.passCyclists
      ? {
          metres: snap.cyclist_pass?.min_pass_m ?? minPassM(snap.road?.limit ?? snap.limit),
          rejection: "passes_cyclist_without_room",
        }
      : null,
  sim: {
    at: "beforeOffRoad",
    run(_world, snap) {
      const cp = snap.cyclist_pass;
      if (!cp) return null;
      let meets;
      return {
        start() {
          meets = false;
        },
        near(car, box, vehicle, ob, ahead, side, _meeting, _finalStep, lateral, law) {
          // going round a cyclist with its far side across the centre line, meeting a vehicle coming the
          // other way in its way (sim/cyclist-pass.js)
          if (
            isCyclistPass(law.detour) &&
            lateral - box.halfWidth < cp.centre_line_route &&
            ahead > 0 &&
            Math.abs(wrap(vehicle.psi - car.psi)) > (Math.PI * 3) / 4 &&
            side < box.halfWidth + ob.halfWidth + MEET_SIDE_M
          ) {
            const gap = ahead - box.halfLength - ob.halfLength,
              closing = Math.max(0, car.v) + Math.max(0, vehicle.v);
            if (gap < MEET_M || (closing > 0.5 && gap / closing < MEET_S)) meets = true;
          }
        },
        reject: (c) => (meets && c.law.kind !== "hard_brake" ? "crosses_into_oncoming_traffic" : null),
      };
    },
  },
  flagText: {
    passes_cyclist_without_room: "it passes a cyclist with less than the legal passing distance",
    crosses_into_oncoming_traffic: "it crosses into the oncoming lane into the way of oncoming traffic",
  },
  rulesCost: {
    at: "afterSpecial",
    run(c, snap) {
      const cp = snap.cyclist_pass;
      if (cp && !cp.going && isCyclistPass(c.law.detour)) return PASS_CYCLIST_COST;
      if (cp && !cp.go && c.id === "follow_cyclist") return -FOLLOW_CYCLIST_GAIN;
      return 0;
    },
  },
  legitimateStop: (snap) =>
    snap?.cyclist_pass && !snap.cyclist_pass.go && snap.cyclist_pass.gap_m < snap.cyclist_pass.follow_gap_m + 4,
  motion: (snap) => snap.cyclist_pass,
  state: {
    at: "afterParking",
    run(snap, state) {
      if (snap.cyclist_pass) {
        const c = snap.cyclist_pass,
          w = c.way;
        state.cyclist_pass = {
          id: c.cyclist_id,
          ...(c.gap_m > 0 ? { gap_m: r1(c.gap_m) } : { beside_car: true }),
          speed: r1(c.speed),
          min_passing_distance_m: c.min_pass_m,
          pass: c.going
            ? c.go
              ? "car is passing"
              : "falling back in behind: the way is no longer clear"
            : !c.possible
              ? `not here: ${passBlockReason(c.why)}`
              : c.queued
                ? "wait in turn"
                : c.too_close
                  ? "drop back first"
                  : w.clear
                    ? "clear"
                    : !w.sees_far_enough
                      ? "cannot see far enough"
                      : "oncoming traffic",
          ...(w?.oncoming && !c.go
            ? { oncoming: { id: w.oncoming.id, arrives_in_s: r1(w.oncoming.eta_s) }, needs_s: r1(w.need_s) }
            : {}),
          ...(c.queued ? { waiting_ahead: c.queued } : {}),
          pass_at: r1(c.limit_mps),
          ...(c.go ? { go_round: true } : { stay_behind: true, follow_gap_m: c.follow_gap_m }),
        };
      }
    },
  },
  outcome: {
    at: "ids",
    run(c, snap) {
      if (c.id === "follow_cyclist" && snap.cyclist_pass)
        return `clear, stays behind the cyclist, ${snap.cyclist_pass.follow_gap_m} m back`;
      return null;
    },
  },
  activeOutcome(c, snap) {
    if (snap.cyclist_pass && isCyclistPass(c.law.detour) && c.law.kind === "lane")
      return `clear, ${snap.cyclist_pass.going ? "carries on round" : "goes round"} the cyclist through the oncoming lane, at least ${snap.cyclist_pass.min_pass_m} m clear of it, and back into the lane ahead of it`;
    return null;
  },
  clause: { at: "afterParking", run: (snap) => snap.cyclist_pass && cyclistClause(snap.cyclist_pass) },
  suppressFollowingClause: (snap) => !!snap.cyclist_pass,
  driveCriterion: (snap) =>
    snap.cyclist_pass
      ? " Staying behind a cyclist (`follow_cyclist`), at its speed, and passing it (`pass_cyclist`) are driving too."
      : "",
  prompt: {
    at: "afterParkingAdvice",
    text: `- Behind a cyclist riding in the car's lane on a street with one lane each way (\`cyclist_pass\`), never squeeze past it in the lane. Choose \`follow_cyclist\` to stay behind it while \`situation\` says it cannot be passed or the oncoming lane is not clear, and \`pass_cyclist\` only when \`situation\` says the oncoming lane is clear for the whole pass: it goes round through the oncoming lane at least \`cyclist_pass.min_passing_distance_m\` clear of the cyclist (1 m where the limit is 50 km/h or less, 1.5 m above) and back in ahead of it. Once passing, carry on, unless \`situation\` says to fall back in behind.`,
  },
  notice: {
    at: "afterTraffic",
    order: 0,
    duration: 2500,
    read: cyclistNotice,
    style: (line) => (line.wait ? "safety" : ""),
  },
  coach: {
    init: (world) => ({ cyclists: !!world.passCyclists, closePasses: 0, cyclistCutoffs: 0 }),
    directionExempt: (world) => !!egoPassing(world),
    events: {
      close_pass(score, ev) {
        score.closePasses++;
        score.incident("close_pass", "Passed a cyclist closer than the minimum passing distance", {
          cyclist: ev.with,
          clearance_m: ev.clearance_m,
          min_m: ev.min_m,
        });
      },
      failed_to_yield(score, ev) {
        if (ev.cyclist_pass) score.cyclistCutoffs++;
      },
    },
    deductions: [{ at: "followingRules", order: 4, counter: "closePasses", weight: 20 }],
    tips: [
      {
        at: "passingCyclists",
        order: 0,
        when: (score) => score.closePasses,
        text: "Give cyclists room: leave at least 1 m when you pass one where the limit is 50 km/h or less, 1.5 m above. On a street with one lane each way that means moving into the oncoming lane, so stay behind until it is clear.",
      },
      {
        at: "passingCyclists",
        order: 1,
        when: (score) => score.cyclistCutoffs,
        text: "Passing a cyclist through the oncoming lane, wait behind them until that lane is clear for the whole pass and back. Oncoming traffic has the right of way.",
      },
    ],
    reports: [
      {
        at: "passingCyclists",
        order: 0,
        read: (score) =>
          score.cyclists
            ? {
                close_passes: score.closePasses,
                cyclist_cutoffs: score.cyclistCutoffs,
              }
            : {},
      },
    ],
  },
};
