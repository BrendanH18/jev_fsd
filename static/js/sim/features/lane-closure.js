import { r1 } from "../../common.js";
import { pointAt, projectPoint, headingAt } from "../../map/mapdata.js";
import { comfort } from "../vehicle.js";
import { detourAt, lookahead } from "../controller.js";
import {
  EGO_ID,
  AHEAD_M as LC_AHEAD_M,
  HEAD_M as LC_HEAD_M,
  LC_LIMIT_MPS,
  LET_IN_DECEL,
  OWED_DECEL as LC_OWED_DECEL,
  THROUGH_M,
  THROUGH_M as LC_THROUGH_M,
  canStop as canStopForMerge,
  detourOf as closureDetour,
  LANE_CLOSURE_COUNT,
  LaneClosures,
  isLaneClosure,
  laneClosureNotice,
} from "../lane-closure.js";

const ZONE_DECEL = 1.5;

// Lane closures (sim/lane-closure.js). In the closed lane, the car owes its wait at the merge point once,
// at the merge (the nearest in its lane to it), it could stop there braking at up to 3.5 m/s^2 and has not
// been let in; going through the merge point owing it is merging out of turn, forcing in (counted once a
// visit, with the vehicle in the open lane nearest it). Moving across from the closed lane into the open
// one more than AUDIT_EARLY_M short of the merge point is merging early; and in the open lane, going
// AUDIT_LET_IN_PAST_M past where it would let someone in, at more than 1 m/s, once it owed that (it could
// stop there braking at 2.5 m/s^2), is taking another's turn. Both are events for coaching, once a visit.
const AUDIT_EARLY_M = 5;
const AUDIT_LET_IN_PAST_M = 2;
const AUDIT_MERGE_MOVING_MPS = 1;
// At a lane closure: merging out of turn, merging early, and not letting someone in (see AUDIT_EARLY_M).
function auditClosures(world) {
  const lc = world.laneClosures;
  if (!lc.zones.length) {
    world.mergeCall = null;
    return;
  }
  world.closuresSeen = true;
  const here = lc.egoAt();
  if (!here) {
    world.mergeCall = null;
    return;
  }
  const z = here.zone,
    ego = world.ego,
    me = EGO_ID;
  if (world.mergeCall?.zone !== z.id)
    world.mergeCall = {
      zone: z.id,
      owed: false,
      crossed: false,
      lane: here.lane,
      early: false,
      letIn: false,
      took: false,
    };
  const rec = world.mergeCall;
  if (here.side === "closed" && here.front < z.m + THROUGH_M) {
    rec.owed =
      z.grant !== me && (rec.owed || (z.head === me && canStopForMerge(ego.v, z.m - 0.5 - here.front, LC_OWED_DECEL)));
  } else if (here.side === "closed" && !rec.crossed) {
    rec.crossed = true;
    if (rec.owed) {
      const e = world.map.edges.get(z.edge),
        oo = e.lane_offsets[z.open];
      const cut = lc
        .movers(z)
        .filter(
          (x) =>
            x.id !== me &&
            Math.abs(x.body.lateral - oo) < 2.2 &&
            x.body.front < here.front + 5 &&
            x.body.front > z.m - 25,
        )
        .sort((a, b) => b.body.front - a.body.front)[0];
      world.violations.merge_cut_ins = (world.violations.merge_cut_ins || 0) + 1;
      world.events.push({ type: "merged_out_of_turn", zone: z.id, cut: cut?.id ?? null });
    }
  }
  if (rec.lane === "closed" && here.lane === "open" && here.front < z.m - AUDIT_EARLY_M && !rec.early) {
    rec.early = true;
    world.events.push({ type: "merged_early", zone: z.id });
  }
  if (here.side === "open") {
    const line = lc.letInLine(z, -Infinity),
      owing = z.turn === "closed" && !!z.head && z.head !== me;
    if (!owing) rec.letIn = false;
    else if (!rec.letIn && here.front < line + 0.5 && lc.firstInOpen(z, me))
      rec.letIn = canStopForMerge(ego.v, line - here.front, LET_IN_DECEL);
    if (rec.letIn && owing && !rec.took && here.front > line + AUDIT_LET_IN_PAST_M && ego.v > AUDIT_MERGE_MOVING_MPS) {
      rec.took = true;
      world.events.push({ type: "took_merge_turn", zone: z.id, from: z.head });
    }
  }
  rec.lane = here.lane;
}

// A lane closure on the car's route ahead (sim/lane-closure.js), from when the car can see it (or is 30 m
// short of its merge point) until its front is out of it. `side` is "closed" when the car is in the lane
// that is closed (past the merge point: came from it) and "open" otherwise; `closed_lane` which lane that
// is ("right" or "left"); `merge_s_route` the merge point (for the front bumper); `at_merge` whether the
// car is the one in the closed lane nearest it, within HEAD_M; `turn` whose turn it is there ("closed" or
// "open" lane); `let_in` whether the car, in the closed lane, has been let in (its turn, and the way clear);
// `wait` whether it must wait at the merge point now: in the closed lane, short of it and not let in, once
// it could stop there braking at OWED_DECEL (or was standing still); `wait_for` then, on the open lane's
// turn, the vehicle in the open lane that goes first. In the open lane, `let_in_for` the vehicle at the
// merge the car must let in (on the closed lane's turn, or while one let in is still moving across in front
// of it), once it could stop LET_IN_M short of the merge point braking at LET_IN_DECEL. `stop_s_route` is
// where the front stops, either way, and `bumper_to_stop_m` how far that is; `detour`, in the closed lane,
// the way across into the open lane at the merge point and back once past the work, in route arc lengths
// (sim/controller.js detourAt), while the lane the car keeps to is the closed one (on the closure's
// street: switched back on in the open lane beside the work, it is across already); `limit_mps` the
// zone's limit, never above the street's. Or null.
function laneClosure(world, p, frontS, road, lane) {
  const { ego, route, map } = world,
    lc = world.laneClosures;
  if (!lc?.zones.length) return null;
  const here = lc.egoAt();
  if (!here) {
    world.mergeWait = null;
    return null;
  }
  const z = here.zone,
    i = route.edges.findIndex((id, k) => id === z.edge && route.edgeStarts[k + 1] > frontS - ego.spec.length);
  if (i < 0 || (here.front < z.m - 30 && !lc.seen(z))) return null;
  const e = map.edges.get(z.edge),
    est = (x) => route.edgeStarts[i + 1] - (e.length - x);
  // (along the route: where the edge puts it, as projected onto the route's own line)
  const toRoute = (x) => {
    const q = pointAt(e.pts, e.cum, x),
      h = headingAt(e.pts, e.cum, x),
      off = e.lane_offsets[z.closed];
    const r = projectPoint(route.pts, route.cum, [q[0] + Math.sin(h) * off, q[1] - Math.cos(h) * off]);
    return r && r.distance < 5 && Math.abs(r.s - est(x)) < 15 ? r.s : est(x);
  };
  const m = toRoute(z.m),
    side = here.side;
  let wait = false,
    waitFor = null,
    letInFor = null,
    stop = null;
  // (it decides at the merge, within HEAD_M of it: further back it drives on up the lane)
  if (
    side === "closed" &&
    here.front < z.m + LC_THROUGH_M &&
    z.grant !== EGO_ID &&
    (here.front > z.m - LC_HEAD_M || world.mergeWait === z.id)
  ) {
    wait = world.mergeWait === z.id || canStopForMerge(ego.v, z.m - 0.5 - here.front, LC_OWED_DECEL);
    if (wait && z.head === EGO_ID && z.turn === "open") {
      const oo = e.lane_offsets[z.open];
      waitFor =
        lc
          .movers(z)
          .filter(
            (x) =>
              x.id !== EGO_ID &&
              x.side === "open" &&
              Math.abs(x.body.lateral - oo) < 2.2 &&
              x.body.front < z.m + LC_THROUGH_M,
          )
          .sort((a, b) => b.body.front - a.body.front)[0]?.id ?? null;
    }
    if (wait) stop = m;
  }
  world.mergeWait = wait ? z.id : null;
  if (side === "open") {
    // (only the first in the open lane lets anyone in: one further back is in the queue)
    const line = lc.letInLine(z, here.front),
      who =
        line === null || !lc.firstInOpen(z, EGO_ID)
          ? null
          : z.head && z.head !== EGO_ID && z.turn === "closed"
            ? z.head
            : z.merger;
    if (who && (world.mergeLetIn === `${z.id}:${who}` || canStopForMerge(ego.v, line - here.front, LET_IN_DECEL))) {
      letInFor = who;
      stop = toRoute(line);
      // (and behind the one let in, while it moves across in front of the car)
      const rear = who === z.merger ? lc.mergerRear(z) : null,
        q = rear && projectPoint(route.pts, route.cum, [rear.x, rear.y]);
      if (q && q.s - 2 > stop) stop = q.s - 2;
    }
    world.mergeLetIn = letInFor ? `${z.id}:${letInFor}` : null;
  }
  const onStreet = p.s >= route.edgeStarts[i],
    d = side === "closed" && (!onStreet || lane.index === z.closed) ? closureDetour(z) : null;
  const right = z.closed === e.lanes - 1 ? "right" : "left";
  return {
    id: z.id,
    side,
    closed_lane: right,
    merge_s_route: m,
    bumper_to_merge_m: m - frontS,
    at_merge: z.head === EGO_ID,
    turn: z.turn,
    let_in: z.grant === EGO_ID,
    wait,
    wait_for: waitFor,
    let_in_for: letInFor,
    stop_s_route: stop,
    bumper_to_stop_m: stop === null ? null : stop - frontS,
    closure_id: z.closure.id,
    limit_mps: Math.min(road.limit || 11.2, LC_LIMIT_MPS),
    merged: here.front >= z.m + LC_THROUGH_M,
    detour: d
      ? { from: toRoute(d.from), full: toRoute(d.full), back: toRoute(d.back), to: toRoute(d.to), shift: d.shift }
      : null,
  };
}

// The speed to go through a lane closure at (see laneClosure), from 5 m short of its merge point, or, short
// of that, the speed from which the car slows to it comfortably by then.
function closureSpeed(lz) {
  if (lz.bumper_to_merge_m <= 5) return lz.limit_mps;
  return Math.sqrt(lz.limit_mps * lz.limit_mps + 2 * comfort().decel * 0.6 * (lz.bumper_to_merge_m - 5));
}

function closureLimit(lz, front) {
  if (front > lz.to + 2) return Infinity;
  return Math.sqrt(LC_LIMIT_MPS * LC_LIMIT_MPS + 2 * ZONE_DECEL * Math.max(0, lz.m - 5 - front));
}

// The lane closure on the street a driver is on, or the next it will be on (sim/lane-closure.js), from
// AHEAD_M short of its merge point to its end, with its marks along the driver's path: { zone, side
// ("closed" when the driver's lane is the one closed, or "open"), m (the merge point), to (its end), at
// (from the edge's `s` to the path's), detour (in the closed lane: across into the open lane and back) },
// or null.
function closureAhead(world, path, front) {
  const lc = world.laneClosures;
  for (const e of path.edges) {
    if (e.sEnd < path.s) continue;
    if (e.sStart - front > LC_AHEAD_M + 40) break;
    const z = lc.on(e.id);
    if (!z) continue;
    const k = (e.sEnd - e.sStart) / Math.max(1, world.map.edges.get(e.id).length),
      at = (s) => e.sStart + s * k;
    if (front > at(z.to) + 2 || at(z.m) - front > LC_AHEAD_M) continue;
    const side = e.lane === z.closed ? "closed" : "open",
      d = side === "closed" ? closureDetour(z) : null;
    return {
      zone: z,
      side,
      m: at(z.m),
      to: at(z.to),
      at,
      detour: d ? { from: at(d.from), full: at(d.full), back: at(d.back), to: at(d.to), shift: d.shift } : null,
    };
  }
  return null;
}

// Where a driver at a lane closure waits, or keeps behind, or null: { gap, v (of what it keeps behind) }.
// In the closed lane, at the merge point until it is let in (one too close to stop there by then goes
// on). In the open lane, LET_IN_M short of it (and behind the one at the merge) on the closed lane's turn, once it could stop there braking
// at LET_IN_DECEL; and behind the one let in while it moves across in front of it, which it cannot yet
// see as in its lane (sim/lane-closure.js).
function mergeHold(world, n, lz, path, front) {
  const z = lz.zone,
    lc = world.laneClosures;
  if (lz.side === "closed") {
    const toM = lz.m - front;
    // (it decides at the merge, within HEAD_M of it: further back it drives on up the lane)
    if (toM < -THROUGH_M || z.grant === n.id || (toM > LC_HEAD_M && n.mergeWait !== z.id)) {
      n.mergeWait = null;
      return null;
    }
    if (n.mergeWait !== z.id && !canStopForMerge(n.v, toM - 0.5, LC_OWED_DECEL)) return null;
    n.mergeWait = z.id;
    return { gap: toM - 0.5, v: 0 };
  }
  const toLine = lz.at(lc.letInLine(z, -Infinity)) - front;
  if (!(z.turn === "closed" || z.merger) || toLine < -0.5) {
    n.letIn = null;
    return null;
  }
  if (n.letIn !== z.id && !canStopForMerge(n.v, toLine, LET_IN_DECEL)) return null;
  n.letIn = z.id;
  let hold = z.turn === "closed" ? { gap: Math.max(0, toLine), v: 0 } : null;
  const rear = lc.mergerRear(z),
    q = rear && projectPoint(path.pts, path.cum, [rear.x, rear.y], null);
  if (q && q.s > path.s && (!hold || q.s - front - 2 < hold.gap))
    hold = { gap: Math.max(0, q.s - front - 2), v: rear.v };
  return hold;
}

// A lane closed ahead by a road crew, where the two lanes zipper merge (sim/lane-closure.js).
function closureClause(l) {
  const kmh = Math.round(l.limit_mps * 3.6),
    at = Math.max(0, Math.round(l.bumper_to_merge_m)),
    stop = Math.max(0, Math.round(l.bumper_to_stop_m ?? 0));
  const lead = `A road crew has closed the ${l.closed_lane} lane ahead (lane closure \`${l.id}\`), and its traffic merges into the other lane ${l.merged ? "behind the car" : `${at} m ahead, at the merge point`}: a zipper merge, where drivers use both lanes up to the merge point and then take turns, one from each lane. Keep to ${kmh} km/h through it (\`car.target_speed\` already does).`;
  if (l.side === "closed" && !l.merged) {
    const keep =
      " Do not change lanes before the merge point: the car's candidates already take it across into the open lane there, once it is let in.";
    if (l.let_in) return `${lead} It is the car's turn and the lane beside it is clear: merge now.${keep}`;
    if (l.wait)
      return `${lead} It is not the car's turn yet${l.wait_for ? `: \`${l.wait_for}\` in the open lane goes first` : l.at_merge ? ": the open lane is not clear beside it" : ": others in its lane go first"}. Stop at the merge point and wait (${stop < 2 ? "hold still where the car is" : `\`wait_to_merge\`, ${stop} m ahead`}); never force in.${keep}`;
    if (!l.at_merge)
      return `${lead} Keep to the car's lane up to the merge point, behind anyone ahead in it, and take the car's turn there.${keep}`;
    return `${lead} The car is too close to stop at the merge point: merge with care.${keep}`;
  }
  if (l.merged)
    return `${lead} The car is past the merge point: carry on through the closure at no more than ${kmh} km/h, and do not change lanes before its end.`;
  if (l.let_in_for)
    return `${lead} The car is in the open lane, and \`${l.let_in_for}\` in the closed lane has its turn to merge in front of it: let it in. Stop ${stop < 2 ? "where the car is" : `${stop} m ahead (\`let_merge_in\`)`}, short of the merge point, and go once it is across in front of the car. Do not move into the closed lane.`;
  return `${lead} The car is in the open lane: keep to it, and let in the one whose turn it is.`;
}

function mustStop(snap, distance) {
  return snap?.lane_closure?.stop_s_route != null && snap.lane_closure.bumper_to_stop_m < distance;
}

export default {
  key: "closures",
  property: "laneClosures",
  seen: "closuresSeen",
  defaultCount: LANE_CLOSURE_COUNT,
  buildAt: "afterSpawn",
  build: (world, { enabled, seed }) => new LaneClosures(world, { count: enabled, seed }),
  checkpoint(world) {
    world.laneClosures.world = world;
  },
  resetContact(world) {
    world.mergeCall = null;
    world.mergeWait = null;
    world.mergeLetIn = null;
  },
  stepBeforeTraffic: { at: "afterParked", run: (world, _fleet, dt) => world.laneClosures.step(dt) },
  audit: { at: "afterRoadsideVehicles", run: auditClosures },
  metric: {
    at: "vehiclePassing",
    name: "merge_cut_ins",
    failure: "merged out of turn",
    label: "Merged out of turn at a lane closure",
    category: "right_of_way",
    eventType: "merged_out_of_turn",
  },
  snapshot: { lane_closure: null },
  trafficSpawnBlocked: (world, x, y) => world.laneClosures?.covers(x, y),
  obstacle: { test: isLaneClosure, traffic: true },
  standingVehicleLabel: (vehicle) => (isLaneClosure(vehicle) ? "lane closure" : null),
  trafficLaneControl(world, vehicle, path, front) {
    if (!world.laneClosures?.zones.length) return null;
    const zone = closureAhead(world, path, front);
    if (!zone) return null;
    const shift = zone.detour ? detourAt(zone.detour, path.s + lookahead(vehicle.v)) : 0;
    return {
      shift,
      ignore: zone.detour ? zone.zone.closure : null,
      lineAt: zone.detour ? (at) => detourAt(zone.detour, at) - shift : null,
      limit: closureLimit(zone, front),
      stop: () => mergeHold(world, vehicle, zone, path, front),
    };
  },
  sense: {
    at: "beforeParking",
    run(world, snap, { p, frontS, road, lane }) {
      snap.lane_closure = laneClosure(world, p, frontS, road, lane);
    },
  },
  hazard: { at: "parkingApproach", run: (snap) => snap.lane_closure && "lane closure" },
  limit: {
    at: "beforeParking",
    run(snap) {
      if (snap.lane_closure) snap.limit = Math.min(snap.limit, closureSpeed(snap.lane_closure));
    },
  },
  target: {
    at: "beforeParking",
    run(snap, v, reasons, { decel, stopSpeedFor }) {
      // a lane closure: in the closed lane, wait at the merge point for its turn; in the open lane, let the
      // one whose turn it is in
      const lz = snap.lane_closure;
      if (lz?.stop_s_route != null) {
        const room = lz.bumper_to_stop_m;
        const vz = room < 1.0 ? 0 : stopSpeedFor(room - 0.5, decel);
        if (vz < v) {
          v = vz;
          reasons.push(lz.wait ? "lane closed: wait your turn at the merge" : "lane closure: letting a car in");
        }
      } else if (lz && closureSpeed(lz) <= v + 0.05)
        reasons.push(lz.side === "closed" ? "lane closed: merge in turn" : "lane closure: take turns at the merge");
      return v;
    },
  },
  detour: { at: "laneControl", run: (snap) => snap.lane_closure?.detour },
  candidates: {
    at: "beforeParking",
    run({ snap, FRONT, laneUntil, inLane, approach, stopAt }, out) {
      // A lane closed ahead (sim/lane-closure.js): in the closed lane, wait at the merge point for the car's
      // turn; in the open lane, stop short of it to let in the one whose turn it is.
      const lz = snap.lane_closure;
      if (lz?.stop_s_route != null && lz.bumper_to_stop_m > 0.3) {
        // (a metre short of the merge point, and half a metre short of where it lets one in, as a stop
        // overshoots)
        out.push(
          lz.wait
            ? {
                id: "wait_to_merge",
                laneUntil,
                law: inLane({ kind: "lane", vTarget: approach, stopAtRoute: stopAt(lz.stop_s_route - FRONT - 1) }),
                steer: "hold lane",
                speed: "stop at the merge point and wait for the car's turn",
              }
            : {
                id: "let_merge_in",
                laneUntil,
                law: inLane({ kind: "lane", vTarget: approach, stopAtRoute: stopAt(lz.stop_s_route - FRONT - 0.5) }),
                steer: "hold lane",
                speed: "stop short of the merge point and let the car in the closed lane go first",
              },
        );
      }
    },
  },
  sim: {
    at: "merge",
    run(_world, snap) {
      // at a lane closure: where the car waits for its turn at the merge point, or stops to let one in; and
      // the lane changes the zipper rules out (sim/lane-closure.js)
      const lz = snap.lane_closure;
      const mergeStop = lz?.wait ? lz.stop_s_route : null,
        letInStop = lz?.let_in_for ? lz.stop_s_route : null;
      const zipper = lz ? lz.side : null;
      if (!lz) return null;
      let passesMerge, passesLetIn;
      return {
        start() {
          passesMerge = false;
          passesLetIn = false;
        },
        along(s, FRONT) {
          // (and here: a metre past the merge point has not gone through it, sim/lane-closure.js THROUGH_M; 1.5 m past
          // where it lets one in is still behind it)
          if (mergeStop !== null && s + FRONT > mergeStop + 1) passesMerge = true;
          if (letInStop !== null && s + FRONT > letInStop + 1.5) passesLetIn = true;
        },
        reject(c) {
          if (passesMerge && c.law.kind !== "hard_brake") return "merges_out_of_turn";
          if (passesLetIn && c.law.kind !== "hard_brake") return "takes_merge_turn";
          if (zipper === "closed" && c.change) return lz.merged ? "into_closed_lane" : "merges_early";
          if (zipper === "open" && c.change && c.change.dir === lz.closed_lane) return "into_closed_lane";
          return null;
        },
      };
    },
  },
  flagText: {
    merges_out_of_turn: "it merges at the lane closure out of turn",
    takes_merge_turn: "it takes the turn of the car merging at the lane closure",
    into_closed_lane: "it moves into a closed lane",
    merges_early: "it leaves the closed lane before the merge point",
  },
  rulesStop: (snap) => mustStop(snap, 1.5),
  rulesCost: { at: "stops", run: (c) => (c.id === "wait_to_merge" || c.id === "let_merge_in" ? -6 : 0) },
  legitimateStop: (snap) => mustStop(snap, 8),
  motion: (snap) => snap.lane_closure?.stop_s_route != null,
  state: {
    at: "beforeParking",
    run(snap, state) {
      if (snap.lane_closure) {
        const l = snap.lane_closure,
          closed = l.side === "closed";
        state.lane_closure = {
          id: l.id,
          closed_lane: l.closed_lane,
          lane: closed
            ? l.merged
              ? "closed: across into the open lane, past the merge point"
              : "closed: merge into the open lane at the merge point, in turn"
            : "open",
          ...(l.merged ? { merge_point: "car is past it" } : { merge_point_m: r1(Math.max(0, l.bumper_to_merge_m)) }),
          turn: `${l.turn} lane`,
          ...(closed && !l.merged ? { at_merge: l.at_merge, your_turn: l.let_in } : {}),
          pass_at: r1(l.limit_mps),
          ...(l.wait
            ? {
                stop: true,
                wait_in_m: r1(Math.max(0, l.bumper_to_stop_m)),
                ...(l.wait_for ? { goes_first: l.wait_for } : {}),
              }
            : {}),
          ...(l.let_in_for ? { let_in: l.let_in_for, stop: true, wait_in_m: r1(Math.max(0, l.bumper_to_stop_m)) } : {}),
        };
      }
    },
  },
  outcome: {
    at: "ids",
    run(c, snap) {
      if (c.id === "wait_to_merge" && snap.lane_closure)
        return `clear, stops ${Math.max(0, r1(snap.lane_closure.bumper_to_stop_m - c.sim.progress_m))} m short of the merge point, to wait for the car's turn`;
      if (c.id === "let_merge_in" && snap.lane_closure)
        return `clear, stops ${Math.max(0, r1(snap.lane_closure.bumper_to_stop_m - c.sim.progress_m))} m short of where it lets \`${snap.lane_closure.let_in_for}\` in`;
      return null;
    },
  },
  passBlockReason: (why) => (why === "lane_closure" ? "a lane is closed on the street" : null),
  clause: { at: "beforeParking", run: (snap) => snap.lane_closure && closureClause(snap.lane_closure) },
  holdStill: {
    at: "beforeParking",
    run(snap) {
      // And waiting at a lane closure's merge point for the car's turn, or letting one in there.
      return snap.lane_closure?.wait
        ? ", when a lane closure's merge point is ahead in the car's lane, it is not the car's turn and it has stopped there (`lane_closure.wait_in_m` under 2)"
        : snap.lane_closure?.let_in_for
          ? ", when the car is letting a car at a lane closure's merge point in and has stopped for it (`lane_closure.wait_in_m` under 2)"
          : "";
    },
  },
  prompt: {
    at: "beforeParking",
    text: `- At a lane closure (\`lane_closure\`), zipper merge: stay in the car's lane right up to the merge point, never changing lanes before it, then take turns, one from each lane. In the closed lane, choose \`wait_to_merge\` when \`situation\` says it is not the car's turn, and keep the car at the merge point until \`lane_closure.your_turn\` is true; then its candidates already take it across. In the open lane, choose \`let_merge_in\` when \`situation\` says to let the car at the merge in, and go once it is across in front.`,
  },
  notice: {
    at: "beforeMerge",
    order: 100,
    duration: 2500,
    read: laneClosureNotice,
    style: (line) => (line.stop ? "safety" : ""),
  },
  coachCorridor: (world, limit) => world.laneClosures?.passing(limit),
  coach: {
    init: () => ({ closures: false, mergeCutIns: 0, mergeTurnsTaken: 0, earlyMerges: 0 }),
    seen: "closures",
    events: {
      merged_out_of_turn(score, ev) {
        score.mergeCutIns++;
        score.incident("merge_cut_in", "Merged out of turn: forced in ahead of the car whose turn it was", {
          zone: ev.zone,
          cut: ev.cut,
        });
      },
      took_merge_turn(score, ev) {
        score.mergeTurnsTaken++;
        score.incident("merge_turn_taken", "Didn’t let the car in the closed lane take its turn at the merge", {
          zone: ev.zone,
        });
      },
      merged_early(score, ev) {
        score.earlyMerges++;
        score.incident("early_merge", "Merged early instead of using the lane to the merge point", { zone: ev.zone });
      },
    },
    deductions: [
      { at: "followingRules", order: 2, counter: "mergeCutIns", weight: 20 },
      { at: "followingRules", order: 3, counter: "mergeTurnsTaken", weight: 10 },
    ],
    tips: [
      {
        at: "beforeMerge",
        order: 2,
        when: (score) => score.mergeCutIns || score.mergeTurnsTaken,
        text: "Where a lane is closed, zipper merge: use both lanes right up to the merge point, then take turns, one vehicle from each lane. Don't force your way in out of turn, and don't close the gap on someone whose turn it is.",
      },
      {
        at: "beforeMerge",
        order: 3,
        when: (score) => score.earlyMerges,
        text: "In slow traffic, don't merge early into the open lane. Stay in your lane to the merge point and take your turn there: using both lanes keeps the queue shorter, and everyone gets through sooner.",
      },
    ],
    reports: [
      {
        at: "beforeMerge",
        order: 1,
        read: (score) =>
          score.closures
            ? {
                merge_cut_ins: score.mergeCutIns,
                merge_turns_taken: score.mergeTurnsTaken,
                early_merges: score.earlyMerges,
              }
            : {},
      },
    ],
  },
};
