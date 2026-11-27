// Slow down, move over for vehicles stopped at the roadside with flashing lights (sim/roadside.js)
// as a feature record (sim/features/index.js, docs/feature-interface.md).
import { r1 } from "../../common.js";
import {
  ADJACENT_M,
  APPROACH_M,
  ROADSIDE_COUNT,
  ROADSIDE_LIGHTS,
  ROADSIDE_NAMES,
  RoadsideStops,
  SIDE_M,
  endsOf,
  flashing,
  passLimit,
  roadsideRelation,
} from "../roadside.js";
import { comfort } from "../vehicle.js";
import { current as weather } from "../weather.js";
import { wrap } from "../world.js";

const ROADSIDE_LOOK_M = 100;
const ROADSIDE_AHEAD_M = 40;
const MOVE_OVER_MIN_M = 5;
const MOVE_OVER_PAST_M = 10;

// A vehicle stopped at the roadside with its lights flashing that the car must slow down and move over
// for (sim/roadside.js, BC MVA Regulations s. 47.02): the nearest it can see on the right of its route
// ahead, going its way, within ROADSIDE_LOOK_M, until the car's rear is past its front.
function roadsideStop(world, p, frontS, lane, road) {
  const { ego, route } = world;
  let best = null;
  for (const v of world.roadside?.vehicles || []) {
    if (!flashing(v) || Math.hypot(v.x - ego.x, v.y - ego.y) > ROADSIDE_LOOK_M + 20 || !world.sees(ego, v)) continue;
    const { rear, front } = endsOf(v),
      qr = route.project(rear[0], rear[1], p.index),
      qf = route.project(front[0], front[1], p.index);
    if (!qr || !qf || qr.distance > 15 || Math.abs(wrap(v.psi - qr.heading)) > Math.PI / 6) continue;
    const gap = qr.s - frontS;
    if (gap > ROADSIDE_LOOK_M || p.s - ego.spec.rearOverhang > qf.s) continue;
    // its near side, in metres right of the route where the car is
    const side =
      Math.min(qr.lateral + route.frameMove(p.s, qr.s), qf.lateral + route.frameMove(p.s, qf.s)) - v.spec.width / 2;
    if (side - lane.center < 0 || side - lane.center > SIDE_M) continue;
    if (best && gap >= best.gap_m) continue;
    // the lanes going the car's way, left of it: the one nearest it is next to it
    const here = route.laneAt(p.s),
      lanes = [];
    for (let d = -here.idx; d < here.lanes - here.idx; d++) {
      const span = d === 0 ? { offset: here.center } : route.laneSpan(p.s, d);
      if (span && span.offset < side) lanes.push({ d, offset: span.offset });
    }
    lanes.sort((a, b) => b.offset - a.offset);
    const adjacent = lanes.length && side - lanes[0].offset < ADJACENT_M ? lanes[0].d : null;
    best = {
      id: v.id,
      kind: v.kind,
      name: ROADSIDE_NAMES[v.kind] || v.kind,
      lights: ROADSIDE_LIGHTS[v.kind] || "flashing",
      gap_m: gap,
      s_rear_route: qr.s,
      s_front_route: qf.s,
      limit_mps: passLimit(road.limit || 11.2),
      adjacent_delta: adjacent,
      in_adjacent_lane: adjacent !== null && lane.delta === adjacent,
      other_lane: adjacent !== null && lanes.length > 1,
    };
  }
  return best;
}

// The speed to pass a vehicle stopped at the roadside at, or, short of it, the speed from which the
// car slows to that comfortably by 5 m before APPROACH_M short of it.
function roadsideSpeed(rs, factor = 1) {
  const lim = rs.limit_mps * factor;
  return Math.sqrt(lim * lim + 2 * comfort().decel * 0.6 * Math.max(0, rs.gap_m - APPROACH_M - 5));
}

// Slowing down and moving over for a vehicle stopped at the roadside with its lights flashing.
function roadsideClause(snap) {
  const r = snap.roadside_stop,
    kmh = Math.round(r.limit_mps * 3.6);
  const where = r.gap_m > 0 ? `${Math.round(r.gap_m)} m ahead on the right` : "beside the car on the right";
  const lead = `A ${r.name} (\`${r.id}\`) is stopped at the roadside ${where} with its ${r.lights} lights flashing; people may be working beside it, at the edge of the lane next to it. Slow to ${kmh} km/h to pass it (\`car.target_speed\` already does)`;
  if (!r.in_adjacent_lane) return `${lead}, and keep out of the lane next to it until past it.`;
  if (!r.other_lane)
    return `${lead}; there is no other lane going the car's way to move over into, so stay in this one.`;
  const offered = snap.lane && Object.values(snap.lane.sides).some((side) => side.offer === "move_over");
  return offered
    ? `${lead}, and move over: a \`change_left_*\` candidate moves the car into the lane to its left, away from it. Stay in that lane until past it.`
    : `${lead}. Move over into the lane to the left once that is safe; until then stay in this lane.`;
}

export default {
  // Passing a vehicle stopped at the roadside with its lights flashing, the car keeps out of the lane
  // next to it where there is another going its way, if it can.
  rulesCost: {
    at: "beforePassing",
    run: (c, snap) => (snap.roadside_stop?.other_lane && c.law.lane === snap.roadside_stop.adjacent_delta ? 6 : 0),
  },
  key: "roadside",
  view: () => import("../../render/roadside.js"),
  coach: {
    init: () => ({
      roadsideSpeeding: 0,
      noMoveOver: 0,
      roadsideCounted: new Set(),
      moveOverCounted: new Set(),
      moveOverRoom: new Set(),
    }),
    reports: [
      {
        at: "afterSpeed",
        order: 0,
        read: (score, round) => ({
          roadside_speeding_s: round(score.roadsideSpeeding),
          no_move_over: score.noMoveOver,
        }),
      },
    ],
    deductions: [{ at: "afterSpeed", order: 0, counter: "noMoveOver", weight: 10 }],
    tips: [
      {
        at: "afterSpeed",
        order: 0,
        when: (score) => score.roadsideSpeeding > 0.5 || score.noMoveOver,
        text: "Passing a vehicle stopped with its lights flashing, slow to 40 km/h (70 where the limit is 80 or more) and move out of the lane next to it if you can. People work right beside it.",
      },
    ],
    guidance: [{ at: "afterBlind", order: 0, read: (_score, { passLimitMessage }) => passLimitMessage }],
    frame(score, context) {
      const { world, road, dt, speed, speeding, speedGrace } = context;
      const passing = world.roadside?.passing(road?.limit ?? 11.2) || null,
        name = passing?.name;
      const roadsideFast = !!passing && speed > passing.limit + speedGrace;
      if (roadsideFast) {
        score.roadsideSpeeding += dt;
        if (!speeding) score.speeding += dt;
        if (!score.roadsideCounted.has(passing.vehicle.id)) {
          score.roadsideCounted.add(passing.vehicle.id);
          score.incident("roadside_speeding", `Passed a stopped ${name} too fast`, { vehicle: passing.vehicle.id });
        }
      }
      if (passing?.room && passing.relation.ahead_m > 0) score.moveOverRoom.add(passing.vehicle.id);
      if (
        passing?.relation.adjacent &&
        passing.other_lane &&
        passing.relation.ahead_m <= 0 &&
        speed > 1 &&
        score.moveOverRoom.has(passing.vehicle.id) &&
        !score.moveOverCounted.has(passing.vehicle.id)
      ) {
        score.moveOverCounted.add(passing.vehicle.id);
        score.noMoveOver++;
        score.incident("no_move_over", `Didn’t move over for a stopped ${name}`, { vehicle: passing.vehicle.id });
      }
      if (roadsideFast)
        context.passLimitMessage = `Slow to ${Math.round(passing.limit * 3.6)} and move over. A ${name} is stopped with its lights flashing.`;
    },
  },
  notice: {
    at: "beforeZone",
    order: 0,
    duration: 2500,
    style: "safety",
    hold: true,
    read(world, _autopilot, _views, previous) {
      const ahead = world.roadside.vehicles
        .map((v) => ({ v, r: roadsideRelation(world.ego, v) }))
        .find(({ v, r }) => r && r.ahead_m < 70 && world.sees(world.ego, v));
      if (!ahead || ahead.v.id === previous) return null;
      const moveOver =
        ahead.r.adjacent &&
        (world.map.nearestLane(world.ego.x, world.ego.y, world.ego.psi, 6)?.lane.edgeRef.lanes || 1) > 1;
      return {
        key: ahead.v.id,
        text: `${ROADSIDE_NAMES[ahead.v.kind].toUpperCase()} · LIGHTS FLASHING · SLOW TO ${Math.round(passLimit(world._road?.limit ?? 11.2) * 3.6)}${moveOver ? " · MOVE OVER" : ""}`,
      };
    },
  },
  perceptionLine(snap) {
    const r = snap.roadside_stop;
    const text = r
      ? `${r.name[0].toUpperCase()}${r.name.slice(1)} at the roadside, lights flashing, ${r.gap_m > 0 ? `${Math.round(r.gap_m)} m ahead` : "beside"}: pass at ${Math.round(r.limit_mps * 3.6)} km/h${r.in_adjacent_lane && r.other_lane ? ", move over" : ""}`
      : null;
    return text ? { order: 31, label: "Roadside", text } : null;
  },
  perceptionFocus: (snap, o) => o.id === snap.roadside_stop?.id,
  buildAt: "afterSpawn",
  defaultCount: ROADSIDE_COUNT,
  snapshot: { roadside_stop: null },
  build: (world, { enabled, seed }) => new RoadsideStops(world, { count: enabled, seed }),
  standingVehicleLabel: (o) => ROADSIDE_NAMES[o.kind],

  stepBeforeTraffic: {
    at: "afterParked",
    run(world, _fleet, dt) {
      world.roadside.step(dt);
    },
  },
  checkpoint(world) {
    if (world.roadside) world.roadside.world = world;
  },

  sense: {
    at: "beforeWorkZone",
    run(world, snap, { p, frontS, lane, road }) {
      snap.roadside_stop = roadsideStop(world, p, frontS, lane, road);
    },
  },
  limit: {
    at: "beforeWorkZone",
    run(snap) {
      if (snap.roadside_stop) snap.limit = Math.min(snap.limit, roadsideSpeed(snap.roadside_stop));
    },
  },
  target: {
    at: "beforeParked",
    run(snap, v, reasons) {
      const rs = snap.roadside_stop;
      if (rs) {
        const vr = roadsideSpeed(rs, Math.min(weather.speed, 1));
        if (vr <= v + 0.05) {
          v = Math.min(v, vr);
          reasons.push(
            rs.gap_m <= APPROACH_M
              ? `passing a ${rs.name} with its lights flashing`
              : `${rs.name} ahead, lights flashing`,
          );
        }
      }
      return v;
    },
  },
  hazard: { at: "beforeWorkZone", run: (snap) => (snap.roadside_stop ? "roadside vehicle" : null) },
  laneOffer: {
    at: "afterPassing",
    run(snap, side, { dir, routeLength, inJunction, changeMargin }) {
      const rs = snap.roadside_stop;
      if (
        rs?.in_adjacent_lane &&
        rs.other_lane &&
        rs.gap_m > MOVE_OVER_MIN_M &&
        dir === "left" &&
        (side.until_s ?? routeLength) > rs.s_front_route + MOVE_OVER_PAST_M &&
        !inJunction(changeMargin)
      )
        return "move_over";
      return null;
    },
  },
  laneChangeStyle(snap, side) {
    if (side.offer !== "move_over") return null;
    return {
      target: side.target_v,
      steer: `move over to the ${side.dir} lane, away from the stopped ${snap.roadside_stop.name}`,
    };
  },

  state: {
    at: "afterPlow",
    run(snap, state) {
      if (snap.roadside_stop) {
        const r = snap.roadside_stop;
        state.roadside_vehicle = {
          id: r.id,
          kind: r.name,
          lights: r.lights,
          ...(r.gap_m > 0 ? { gap_m: r1(r.gap_m) } : { beside_car: true }),
          pass_at: r1(r.limit_mps),
          in_lane_next_to_it: r.in_adjacent_lane,
          ...(r.in_adjacent_lane && r.other_lane ? { move_over: true } : {}),
        };
      }
    },
  },
  outcome: {
    at: "laneChange",
    run(c, snap) {
      if (c.change?.offer === "move_over" && snap.roadside_stop)
        return `clear, moves over into the ${c.change.dir} lane, away from the stopped ${snap.roadside_stop.name}${c.sim.min_gap_m < 8 ? `, ${r1(c.sim.min_gap_m)} m behind a car` : ""}`;
      return null;
    },
  },
  clause: { at: "afterPassing", run: (snap) => (snap.roadside_stop ? roadsideClause(snap) : null) },
  returnClause: (snap) =>
    snap.roadside_stop && !snap.roadside_stop.in_adjacent_lane ? `once past the ${snap.roadside_stop.name}, ` : null,
  prompt: {
    at: "afterPlow",
    text: `- Passing a vehicle stopped at the roadside with its lights flashing (\`roadside_vehicle\`), keep to \`car.target_speed\`, and when \`situation\` says to move over, choose the \`change_left_*\` candidate that does; then stay out of the lane next to it until past it.`,
  },

  trafficSpeed: {
    at: "limit",
    run(world, n, _front, edgeLimit) {
      if (n.kind === "bike") return Infinity;
      for (const v of world.roadside?.vehicles || []) {
        if (Math.abs(v.x - n.x) > 80 || Math.abs(v.y - n.y) > 80) continue;
        const r = roadsideRelation(n, v);
        if (r && r.ahead_m <= APPROACH_M + ROADSIDE_AHEAD_M) return passLimit(edgeLimit);
      }
      return Infinity;
    },
  },
};
