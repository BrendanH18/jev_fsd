import { r1 } from "../../common.js";
import { pointAt, projectPoint } from "../../map/mapdata.js";
import { detourAt, lookahead } from "../controller.js";
import { comfort } from "../vehicle.js";
import { wrap } from "../world.js";
import {
  SPAN_M as WZ_SPAN_M,
  WORK_ZONE_COUNT,
  WZ_LIMIT_MPS,
  WorkZones,
  canStopFor as canStopForFlagger,
  detourOf,
  isWorkZone,
  marksOn,
  paddle,
  sideOf,
  stopKey,
  workZoneNotice,
} from "../work-zone.js";

const WZ_DECEL = 1.5;
// Stopping for a flagger's STOP paddle (sim/work-zone.js, Ontario HTA s. 146.1): once the car, heading
// into a work zone along its street, first sees its flagger showing STOP while still short of the
// one-lane section, it owes the stop if it could then stop at the line braking at up to 3.5 m/s^2
// (standing still, it can). It misses the stop if, owing it, its front goes more than 2 m past the
// line at more than 1 m/s while the paddle still shows STOP. Counted once each time that paddle turns
// to STOP.
const AUDIT_FLAGGER_PAST_M = 2;
const AUDIT_FLAGGER_MOVING_MPS = 1;
// A work zone with a flagger on the car's route ahead (sim/work-zone.js), from when the car can see the
// flagger at its end of it (or is already past the line) until its front is out of the one-lane
// section. `side` is "closed" when the car's lane is the one shut; `paddle` what that flagger shows
// ("stop" or "slow"); `stop_s_route` the stop line (for the front bumper); `wait` whether the car must
// stop there now: the paddle shows STOP, and when the car first saw it turned to STOP, still short of
// the one-lane section, it could have stopped at the line braking at OWED_DECEL, or was standing still
// (a car too close to stop by then goes on through, and the flaggers wait for it), and its front is
// not yet in the one-lane section; `detour`, on the closed
// side, the way round the closed stretch through the other lane in route arc lengths
// (sim/controller.js detourAt); `limit_mps` the zone's limit, never above the street's. Or null.
const WZ_LOOK_M = 120;
function workZone(world, frontS, road) {
  const { ego, route, map } = world,
    zones = world.workZones?.zones;
  if (!zones?.length) return null;
  for (const z of zones) {
    if (Math.hypot(z.x - ego.x, z.y - ego.y) > WZ_LOOK_M + WZ_SPAN_M) continue;
    const i = route.edges.findIndex((id, k) => sideOf(z, id) && route.edgeStarts[k + 1] > frontS - ego.spec.length);
    if (i < 0) continue;
    const side = sideOf(z, route.edges[i]),
      e = map.edges.get(route.edges[i]),
      lane = map.lane(e.id, 0),
      m = marksOn(z, side);
    // (along the route: where the edge puts it, as projected onto the route's own line)
    const toRoute = (x) => {
      const est = route.edgeStarts[i + 1] - (e.length - x),
        q = pointAt(lane.pts, lane.cum, (x * lane.length) / e.length),
        r = projectPoint(route.pts, route.cum, q);
      return r && r.distance < 1.5 && Math.abs(r.s - est) < 15 ? r.s : est;
    };
    const line = toRoute(m.line),
      from = toRoute(m.from),
      to = toRoute(m.to);
    if (frontS > to || line - frontS > WZ_LOOK_M) continue;
    const flagger = z.flaggers[side];
    if (frontS < line && !world.visibility.canSee(ego, flagger[0], flagger[1])) continue;
    const shows = paddle(z, side),
      key = stopKey(z, side);
    world.flaggerYields ||= new Map();
    // (decided when the car first sees the paddle showing STOP, short of the one-lane section)
    if (shows === "stop" && !world.flaggerYields.has(key) && frontS < from) {
      if (world.flaggerYields.size > 20) world.flaggerYields.delete(world.flaggerYields.keys().next().value);
      world.flaggerYields.set(key, canStopForFlagger(ego.v, Math.max(0, line - frontS)));
    }
    const d = side === "closed" ? detourOf(z) : null;
    return {
      id: z.id,
      side,
      paddle: shows,
      stop_s_route: line,
      bumper_to_stop_m: line - frontS,
      wait: shows === "stop" && !!world.flaggerYields.get(key) && frontS < from - 0.5,
      one_lane: { from_s: from, to_s: to },
      in_one_lane: frontS > from,
      closure_id: z.closure.id,
      limit_mps: Math.min(road.limit || 11.2, WZ_LIMIT_MPS),
      detour: d
        ? { from: toRoute(d.from), full: toRoute(d.full), back: toRoute(d.back), to: toRoute(d.to), shift: d.shift }
        : null,
    };
  }
  return null;
}

// The speed to go through a work zone at (see workZone), from 5 m short of its stop line, or, short of
// that, the speed from which the car slows to it comfortably by then.
function workZoneSpeed(wz) {
  if (wz.bumper_to_stop_m <= 5) return wz.limit_mps;
  return Math.sqrt(wz.limit_mps * wz.limit_mps + 2 * comfort().decel * 0.6 * (wz.bumper_to_stop_m - 5));
}

// The work zone on the street a driver is on, or the next it will be on, within WZ_LOOK_M of its
// stop line (sim/work-zone.js), with its marks along the driver's path: { zone, side, line, from,
// to (the one-lane section), detour (on the side whose lane is closed) }, or null once past it.
function workZoneAhead(world, path, front) {
  const zones = world.workZones;
  if (!zones?.zones.length) return null;
  for (const e of path.edges) {
    if (e.sEnd < path.s) continue;
    if (e.sStart - front > WZ_LOOK_M) break;
    const hit = zones.on(e.id);
    if (!hit) continue;
    const k = (e.sEnd - e.sStart) / Math.max(1, world.map.edges.get(e.id).length),
      at = (s) => e.sStart + s * k,
      m = marksOn(hit.zone, hit.side);
    if (front > at(m.to) + 2 || at(m.line) - front > WZ_LOOK_M) continue;
    const d = hit.side === "closed" ? detourOf(hit.zone) : null;
    return {
      zone: hit.zone,
      side: hit.side,
      line: at(m.line),
      from: at(m.from),
      to: at(m.to),
      detour: d ? { from: at(d.from), full: at(d.full), back: at(d.back), to: at(d.to), shift: d.shift } : null,
    };
  }
  return null;
}

// The speed a driver keeps to at a work zone (sim/work-zone.js): its limit from 5 m short of the stop
// line to the end of the one-lane section, and short of that, the speed from which it slows to that
// by then braking at WZ_DECEL.
function workZoneLimit(wz, front) {
  if (front > wz.to + 2) return Infinity;
  return Math.sqrt(WZ_LIMIT_MPS * WZ_LIMIT_MPS + 2 * WZ_DECEL * Math.max(0, wz.line - 5 - front));
}

function flaggerHold(n, wz, front) {
  const toLine = wz.line - front;
  if (paddle(wz.zone, wz.side) !== "stop" || toLine < -1) {
    n.flagger = null;
    return null;
  }
  const key = stopKey(wz.zone, wz.side);
  if (n.flagger !== key && !canStopForFlagger(n.v, toLine - 0.5)) return null;
  n.flagger = key;
  return toLine - 0.5;
}

// Going past a flagger's STOP paddle once the stop was owed (see AUDIT_FLAGGER_PAST_M).
function auditFlaggers(world) {
  const zones = world.workZones.zones;
  if (!zones.length) return;
  const ego = world.ego,
    FRONT = ego.spec.length - ego.spec.rearOverhang;
  for (const z of zones) {
    if (Math.abs(ego.x - z.x) > WZ_SPAN_M + 80 || Math.abs(ego.y - z.y) > WZ_SPAN_M + 80) continue;
    for (const side of ["closed", "open"]) {
      if (paddle(z, side) !== "stop") continue;
      const e = world.map.edges.get(z[side]),
        p = projectPoint(e.pts, e.cum, [ego.x, ego.y], null);
      if (
        !p ||
        p.lateral < e.asphalt[0] - 1 ||
        p.lateral > e.asphalt[1] + 1 ||
        Math.abs(wrap(ego.psi - p.heading)) > Math.PI / 3
      )
        continue;
      const m = marksOn(z, side),
        front = p.s + FRONT,
        key = stopKey(z, side);
      if (front > m.to) continue;
      let rec = world.flaggerCalls.get(key);
      // (decided when the car first sees the flagger showing STOP, still short of the one-lane section)
      if (!rec && front < m.from && world.visibility.canSee(ego, ...z.flaggers[side]))
        world.flaggerCalls.set(
          key,
          (rec = { owed: canStopForFlagger(ego.v, Math.max(0, m.line - front)), counted: false }),
        );
      if (rec?.owed && !rec.counted && front > m.line + AUDIT_FLAGGER_PAST_M && ego.v > AUDIT_FLAGGER_MOVING_MPS) {
        rec.counted = true;
        world.violations.stop_signs_run++;
        world.events.push({ type: "stop_sign", flagger: true, zone: z.id });
      }
    }
  }
  if (world.flaggerCalls.size > 20)
    for (const key of [...world.flaggerCalls.keys()].slice(0, 10)) world.flaggerCalls.delete(key);
}

// A work zone with a flagger on the route ahead (sim/work-zone.js).
function workZoneClause(snap) {
  const w = snap.work_zone,
    at = Math.max(0, Math.round(w.bumper_to_stop_m)),
    kmh = Math.round(w.limit_mps * 3.6);
  const lead = `A road crew has closed ${w.side === "closed" ? "the car's lane" : "the oncoming lane"} ahead (work zone \`${w.id}\`), leaving one lane for both directions in turn; a flagger ${w.bumper_to_stop_m > 0 ? `${at} m ahead` : "at the line"} holds a paddle that shows ${w.paddle === "stop" ? "STOP" : "SLOW"} to the car.`;
  const round =
    w.side === "closed"
      ? " The car's candidates already take it round the work through the other lane, and back into its own past it."
      : "";
  if (w.wait)
    return `${lead} Stop at the line and do not go on until the paddle turns to SLOW: traffic coming the other way has the one lane now. ${at < 2 ? "Hold still where the car is." : `Slow down and stop ${at} m ahead (\`stop_for_flagger\`).`}${round}`;
  if (w.paddle === "stop")
    return `${lead} The car was too close to stop for it when it turned: keep going through the one lane at ${kmh} km/h, with care.${round}`;
  return `${lead} Go on with care at no more than ${kmh} km/h (\`car.target_speed\` already does): the crew works beside the lane.${round}`;
}

export default {
  key: "workZones",
  defaultCount: WORK_ZONE_COUNT,
  calls: "flaggerCalls",
  buildAt: "afterSpawn",
  build: (world, { enabled, seed }) => new WorkZones(world, { count: enabled, seed }),
  snapshot: { work_zone: null },
  checkpoint(world) {
    world.workZones.world = world;
  },
  coachCorridor: (world, limit) => world.workZones?.passing(limit),
  coachCorridorFrame(score, passage, { speed, speedGrace, speeding, dt }) {
    if (!passage || speed <= passage.limit + speedGrace) return null;
    score.workZoneSpeeding += dt;
    if (!speeding) score.speeding += dt;
    if (!score.workZoneCounted.has(passage.zone.id)) {
      score.workZoneCounted.add(passage.zone.id);
      score.incident("work_zone_speeding", "Too fast through a work zone", { zone: passage.zone.id });
    }
    return `Slow to ${Math.round(passage.limit * 3.6)}. You’re in a work zone.`;
  },
  coach: {
    init: () => ({ workZoneSpeeding: 0, workZoneCounted: new Set(), flaggerStops: 0 }),
    events: {
      stop_sign(score, event) {
        if (event.flagger) score.flaggerStops++;
      },
    },
    reports: [
      {
        at: "afterFlagger",
        order: -1,
        read: (score, round) => ({
          work_zone_speeding_s: round(score.workZoneSpeeding),
          flagger_stops_run: score.flaggerStops,
        }),
      },
    ],
    tips: [
      {
        at: "beforeJunction",
        order: 0,
        when: (score) => score.flaggerStops,
        text: "At a work zone, stop for the flagger’s STOP paddle and wait for it to turn to SLOW. Traffic coming the other way has the one lane until then.",
      },
      {
        at: "beforeJunction",
        order: 1,
        when: (score) => score.workZoneSpeeding > 0.5,
        text: "Keep to 30 km/h through a work zone. The crew works right beside the lane.",
      },
    ],
  },
  stepBeforeTraffic: { at: "afterParked", run: (world, _fleet, dt) => world.workZones.step(dt) },
  resetContact: (world) => world.flaggerYields?.clear(),
  audit: { at: "beforeMerge", run: auditFlaggers },
  notice: {
    at: "beforeMerge",
    order: 0,
    duration: 2500,
    read: workZoneNotice,
    style: (line) => (line.stop ? "safety" : ""),
  },
  obstacle: { test: isWorkZone, traffic: true },
  standingVehicleLabel: (o) => (isWorkZone(o) ? "work zone" : null),
  trafficSpawnBlocked: (world, x, y) => world.workZones?.covers(x, y),
  // (nobody parks on the block of a work zone: sim/parallel-park.js)
  parkingObstructed: (world, edge) => !!world.workZones?.zones.some((z) => z.closed === edge || z.open === edge),
  trafficCorridor(world, vehicle, path, front) {
    const wz = workZoneAhead(world, path, front);
    if (!wz) return null;
    const shift = wz.detour ? detourAt(wz.detour, path.s + lookahead(vehicle.v)) : 0;
    return {
      shift,
      ignore: wz.detour ? wz.zone.closure : null,
      lineAt: wz.detour ? (at) => detourAt(wz.detour, at) - shift : null,
      limit: workZoneLimit(wz, front),
      stop: () => flaggerHold(vehicle, wz, front),
    };
  },
  sense: {
    at: "beforeWorkZone",
    run(world, snap, { frontS, road }) {
      snap.work_zone = workZone(world, frontS, road);
    },
  },
  limit: {
    at: "beforeWorkZone",
    run(snap) {
      if (snap.work_zone) snap.limit = Math.min(snap.limit, workZoneSpeed(snap.work_zone));
    },
  },
  target: {
    at: "beforeMerge",
    run(snap, v, reasons, { decel, stopSpeedFor }) {
      const wz = snap.work_zone;
      if (wz?.wait) {
        const room = wz.bumper_to_stop_m;
        const vw = room < 1.0 ? 0 : stopSpeedFor(room - 0.5, decel);
        if (vw < v) {
          v = vw;
          reasons.push("flagger showing STOP");
        }
      } else if (wz && workZoneSpeed(wz) <= v + 0.05)
        reasons.push(wz.side === "closed" ? "work zone: round it through the other lane" : "work zone: one lane");
      return v;
    },
  },
  hazard: { at: "beforeWorkZone", run: (snap) => (snap.work_zone ? "work zone" : null) },
  detour: { at: "beforeMerge", run: (snap) => snap.work_zone?.detour },
  candidates: {
    at: "beforeMerge",
    run({ snap, FRONT, laneUntil, inLane, approach, stopAt }, out) {
      const wz = snap.work_zone;
      if (wz?.wait && wz.bumper_to_stop_m > 0.3) {
        out.push({
          id: "stop_for_flagger",
          laneUntil,
          law: inLane({ kind: "lane", vTarget: approach, stopAtRoute: stopAt(wz.stop_s_route - FRONT - 0.5) }),
          steer: "hold lane",
          speed: "stop at the line for the flagger's STOP paddle",
        });
      }
    },
  },
  sim: {
    at: "beforeMerge",
    run(_world, snap) {
      const zone = snap.work_zone;
      if (!zone?.wait) return null;
      let passed = false;
      return {
        start() {
          passed = false;
        },
        along(s, nose) {
          if (s + nose > zone.stop_s_route + 1.5) passed = true;
        },
        reject: (c) => (passed && c.law.kind !== "hard_brake" ? "runs_flagger_stop" : null),
      };
    },
  },
  passBlockReason: (why) => (why === "work_zone" ? "a work zone is on the street" : null),
  flagText: { runs_flagger_stop: "it goes past a work zone flagger showing STOP" },
  rulesStop: (snap) => snap.work_zone?.wait && snap.work_zone.bumper_to_stop_m < 1.5,
  rulesCost: { at: "stops", run: (c) => (c.id === "stop_for_flagger" ? -6 : 0) },
  legitimateStop: (snap) => snap?.work_zone?.wait && snap.work_zone.bumper_to_stop_m < 8,
  motion: (snap) => snap.work_zone?.wait,
  state: {
    at: "beforeMerge",
    run(snap, state) {
      if (snap.work_zone) {
        const w = snap.work_zone;
        state.work_zone = {
          id: w.id,
          lane: w.side === "closed" ? "closed: go round through the other lane" : "open",
          flagger: w.paddle === "stop" ? "STOP" : "SLOW",
          ...(w.bumper_to_stop_m > 0 ? { stop_line_m: r1(w.bumper_to_stop_m) } : {}),
          one_lane: w.in_one_lane
            ? "car is in it"
            : `starts ${r1(Math.max(0, w.one_lane.from_s - snap.routeProj.s - snap.ego.front_m))} m ahead`,
          pass_at: r1(w.limit_mps),
          ...(w.wait ? { stop: true, wait_in_m: r1(Math.max(0, w.bumper_to_stop_m)) } : {}),
        };
      }
    },
  },
  outcome: {
    at: "ids",
    run(c, snap) {
      if (c.id === "stop_for_flagger" && snap.work_zone)
        return `clear, stops ${Math.max(0, r1(snap.work_zone.bumper_to_stop_m - c.sim.progress_m))} m short of the flagger, at the line`;
      return null;
    },
  },
  clause: { at: "afterJunctionBox", run: (snap) => (snap.work_zone ? workZoneClause(snap) : null) },
  holdStill: {
    at: "beforeMerge",
    run: (snap) =>
      snap.work_zone?.wait
        ? ", when a work zone's flagger shows STOP to the car and it has stopped at the line (`work_zone.wait_in_m` under 2)"
        : "",
  },
  prompt: {
    at: "beforeMerge",
    text: `- Choose \`stop_for_flagger\` when \`situation\` says a work zone's flagger shows STOP to the car: stop at the line, and keep the car stopped there until the paddle turns to SLOW. Under SLOW, go through the one lane at no more than \`car.target_speed\`; where the car's own lane is closed, its candidates already take it round the work through the other lane.`,
  },
  examinerFail: {
    at: "beforeTracks",
    run(report) {
      if (!(report.flagger_stops_run > 0)) return null;
      return {
        category: "right_of_way",
        remark: "Went past a flagger's STOP paddle",
        reason: "flagger",
        incident: null,
      };
    },
  },
};
