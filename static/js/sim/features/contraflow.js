import { r1 } from "../../common.js";
import { cumulative, pointAt } from "../../map/mapdata.js";
import {
  ContraflowRiders,
  ENTRY_LOOK_M,
  auditContraflow,
  comingOut,
  contraLine,
  contraflowOf,
  entryHold,
  isContraflowRider,
  riderConflict,
  roomRight,
  trafficYield,
} from "../contraflow.js";
import { minPassM } from "../cyclist-pass.js";
import { comfort } from "../vehicle.js";
import { wrap } from "../world.js";

const CF_SHIFT_MPS = 0.7;

// A cyclist riding against a one-way street that allows it (sim/contraflow.js, `World` option
// `contraflow`) that the car must look out for, as far as it can see: the one it must wait for first,
// and how far right it moves for one coming the other way. `relation`: "turning_in" (it is coming out of
// the street the car is about to turn or go straight into: the car waits short of the junction),
// "oncoming" (coming the other way along the car's street, with less than the minimum passing distance
// even moved over: the car stops, moved over, until it has gone by), "turning_off" (the car, on such a
// street, would cross its way at the junction ahead, as a left turn crosses oncoming traffic), or
// "crossing" (the car would cross its way coming out of the street). `wait`: the car stops with its
// front at `stop_s_route` (route arc length) until the conflict is over (sim/contraflow.js
// riderConflict); never once it could no longer stop there (it carries on). `detour` moves the car
// right (sim/controller.js detourAt) while one comes the other way within reach, kept from the law that
// moves it until it is by. Or null.
function contraflowCyclist(world, { p, frontS, lane, road, executing, stopSpeedFor }) {
  const { ego, route, map } = world;
  const limit = road.limit || 11.2,
    min = minPassM(limit);
  const room = (r) => {
    const i = route.laneEdgeAt(r);
    return roomRight(map.edges.get(route.edges[i]), route.laneInfo(i).idx, ego.spec);
  };
  const edgeAt = map.edges.get(route.edges[route.edgeIndexAt(frontS)]);
  const onContra = !!(edgeAt && contraflowOf(map, edgeAt.id));
  // (the contraflow streets the route goes into, still ahead of the car's front)
  const entries = [];
  for (let i = 0; i < route.edges.length; i++) {
    const start = route.edgeStarts[i];
    if (start > frontS + 60) break;
    if (start > frontS - 2 && contraflowOf(map, route.edges[i]))
      entries.push({ id: route.edges[i], start, hold: entryHold(map, route.edges[i], start) });
  }
  let best = null,
    shift = 0,
    shiftFor = null;
  for (const n of world.contraflow.riders) {
    if (Math.abs(n.x - ego.x) > 90 || Math.abs(n.y - ego.y) > 90 || !world.sees(ego, n)) continue;
    const c = riderConflict(n, route, {
      front: frontS,
      spec: ego.spec,
      v: ego.v,
      lat: lane.center,
      room,
      vMax: Math.min(limit, 8),
      clearance: min,
    });
    if (!c) continue;
    if ((c.shift || 0) > shift) {
      shift = c.shift;
      shiftFor = n;
    }
    if (c.at === null) continue;
    // where it waits: short of the junction, about to enter the street the cyclist is coming out of, or
    // short of where it would meet or cross it; the first of those it can still stop at
    const at = c.at - (c.meet ? 3 : 1),
      stop = (ego.v * ego.v) / (2 * Math.min(4, comfort().hardDecel)) - 0.3;
    const holds = entries
      .filter((en) => comingOut(n, en.id) && frontS < en.start && en.hold < at + 0.01)
      .map((en) => ({ at: en.hold, relation: "turning_in" }))
      .concat([{ at, relation: c.meet ? "oncoming" : onContra ? "turning_off" : "crossing" }])
      .sort((x, y) => x.at - y.at);
    const hold = holds.find((h) => ego.v < 0.5 || h.at - frontS > stop);
    // (too late to stop short of it: the car has committed and carries on)
    if (hold && (!best || hold.at < best.at)) best = { n, c, at: hold.at, relation: hold.relation };
  }
  // (a contraflow street ahead the car cannot yet see into, ENTRY_LOOK_M along the cyclists' line: it
  // comes up to where it would wait no faster than it could stop there, creeping the last of the way,
  // as at a blind junction, until it can see whether one is coming)
  let entryLimit = null;
  for (const en of entries) {
    if (en.hold <= frontS - 0.5) continue;
    const e = map.edges.get(en.id),
      line = contraLine(e, contraflowOf(map, e.id).side),
      cum = cumulative(line),
      len = cum[cum.length - 1];
    const [x, y] = pointAt(line, cum, Math.max(0, len - Math.min(ENTRY_LOOK_M, len)));
    if (world.visibility.canSee(ego, x, y)) continue;
    // (gently, with room to spare: the cyclist may come into sight only at the corner)
    const vl = stopSpeedFor(Math.max(0, en.hold - frontS - 2), 0.6 * comfort().decel) + 1;
    if (entryLimit === null || vl < entryLimit) entryLimit = vl;
  }
  const exec = executing?.law?.detour?.id?.startsWith?.("cf:") ? executing.law.detour : null;
  let detour = null;
  if (shift > 0.05) {
    const id = `cf:${shiftFor.id}`,
      from = exec?.id === id ? exec.from : p.s,
      full = Math.max(from + 1, from + Math.max(6, 2 * ego.v));
    const q = route.project(shiftFor.x, shiftFor.y, p.index);
    const back = Math.max(full, (q ? q.s : frontS) + ego.spec.rearOverhang + 2);
    detour = { id, from, full, back, to: back + 10, shift: Math.round(shift * 100) / 100 };
  } else if (exec && p.s < exec.to) detour = exec;
  if (!best && !detour)
    return entryLimit === null
      ? null
      : {
          id: null,
          cyclist_id: null,
          relation: "entering",
          street: map.edges.get(entries[0].id)?.name || "",
          lane_kind: contraflowOf(map, entries[0].id)?.kind || "shared",
          wait: false,
          stop_s_route: null,
          bumper_to_stop_m: null,
          yield_s_route: null,
          min_pass_m: min,
          shift_m: 0,
          room_m: Math.round(room(frontS) * 100) / 100,
          detour: null,
          entry_limit_mps: entryLimit,
        };
  // (stopped, it waits where it is)
  const stopS = best ? Math.max(best.at, frontS) : null;
  const wait = !!best;
  const n = best?.n || shiftFor || world.contraflow.riders.find((r) => `cf:${r.id}` === detour.id);
  if (!n) return null;
  const e = map.edges.get(n.path.segs.find((g) => g.contra)?.id);
  return {
    id: n.id,
    cyclist_id: n.id,
    relation: best ? best.relation : "oncoming",
    street: e?.name || "",
    lane_kind: e ? contraflowOf(map, e.id)?.kind || "shared" : "shared",
    gap_m: Math.max(0, Math.hypot(n.x - ego.x, n.y - ego.y) - ego.spec.length + ego.spec.rearOverhang),
    speed: n.v,
    eta_s: best ? best.c.eta_s : null,
    need_s: best ? best.c.need_s : null,
    wait,
    stop_s_route: wait ? stopS : null,
    bumper_to_stop_m: wait ? stopS - frontS : null,
    yield_s_route: best ? best.at : null,
    min_pass_m: min,
    shift_m: detour ? detour.shift : 0,
    room_m: Math.round(room(frontS) * 100) / 100,
    detour,
    entry_limit_mps: entryLimit,
  };
}

// How a contraflow cyclist (sim/contraflow.js) meets the car's way, for models.
const CONTRAFLOW_RELATION = {
  turning_in: "coming out of the street the car is about to enter",
  oncoming: "coming the other way along the car's street",
  turning_off: "coming the other way, across the car's way at the junction ahead",
  crossing: "coming out of its street, across the car's way",
};

// A cyclist riding against a one-way street that allows it (sim/contraflow.js).
function contraflowClause(c) {
  if (c.relation === "entering")
    return `The car is about to enter ${c.street || "a one-way street"} where cyclists may ride against the traffic, on the driver's left, and it cannot see into it yet: come up slowly, ready to stop short of the junction, and look both ways (\`car.target_speed\` already does).`;
  const w = Math.max(0, Math.round(c.bumper_to_stop_m ?? 0)),
    where = c.street ? ` on ${c.street}` : "";
  const lead = `Cyclist \`${c.cyclist_id}\` is riding against the one-way${where}, as cyclists may there (${c.lane_kind === "shared" ? "no lane: it shares the street" : "in a painted contraflow lane on the driver's left"}), ${Math.round(c.gap_m)} m away. Look both ways on such a street: a cyclist can come from the "wrong" way.`;
  const hold =
    w < 2
      ? "Hold still until it has gone by."
      : `Slow down and wait ${w} m ahead (\`yield_to_contraflow_cyclist\`) until it has gone by.`;
  if (c.wait && c.relation === "turning_in")
    return `${lead} It is coming out of the street the car is about to enter: give way to it before entering, short of the junction. ${hold}`;
  if (c.wait && c.relation === "oncoming")
    return `${lead} It is coming the other way along the car's street, and there is not room to pass it with the minimum passing distance (${c.min_pass_m} m) even moved over to the right: move over and stop, and let it go by. ${hold}`;
  if (c.wait)
    return `${lead} Its way crosses the car's ${c.relation === "turning_off" ? "turn at the junction ahead, as oncoming traffic's would" : "way"}, and it would get there first (in ${r1(c.eta_s)} s; the car needs ${r1(c.need_s)} s to be clear): give way to it as to oncoming traffic. ${hold}`;
  return `${lead} It is coming the other way: keep to the right, ${r1(c.shift_m)} m over (the car's candidates already do), leaving it at least ${c.min_pass_m} m as it goes by.`;
}

export default {
  key: "contraflow",
  seen: "contraflowSeen",
  calls: "contraflowCalls",
  snapshot: { contraflow_cyclist: null },
  build: (world, options) => new ContraflowRiders(world, options),
  obstacles: (world, x, y, r) => (world.contraflow?.riders.length ? world.contraflow.near(x, y, r) : null),
  obstacle: {
    test: (o) => isContraflowRider(o),
    traffic: true,
    oncoming: (rider, vehicle) => Math.abs(wrap(rider.psi - vehicle.psi)) > (Math.PI * 2) / 3,
  },
  trafficActors: (world) => world.contraflow?.riders,
  stepAfterTraffic(world, _fleet, dt) {
    if (world.contraflow?.enabled) world.contraflow.step(dt);
  },
  audit: {
    at: "driveways",
    run(world, frontOnPath) {
      if (world.contraflow?.enabled) auditContraflow(world, frontOnPath);
    },
  },
  metric: {
    at: "beforeRunner",
    name: "contraflow_conflicts",
    failure: "cut off or squeezed a contraflow cyclist",
    label: "Cut off or squeezed a cyclist riding against the one-way",
    category: "space",
  },
  trafficLane: {
    at: "beforeLaneMoves",
    run(world, n, front, _busy, dt) {
      const cf =
        world.contraflow?.riders.length && n.kind !== "bike" && !n.transit?.tram ? trafficYield(world, n, front) : null;
      if (!cf && !n.cfShift) return null;
      n.cfShift =
        (n.cfShift || 0) +
        Math.max(-CF_SHIFT_MPS * dt, Math.min(CF_SHIFT_MPS * dt, (cf?.shift || 0) - (n.cfShift || 0)));
      return { shift: n.cfShift, hold: cf?.hold };
    },
  },
  sense: {
    at: "beforeRunner",
    run(world, snap, ctx) {
      if (world.contraflow?.riders.length) snap.contraflow_cyclist = contraflowCyclist(world, ctx);
    },
  },
  limit: {
    at: "beforeRunner",
    run(snap) {
      if (snap.contraflow_cyclist?.entry_limit_mps != null)
        snap.limit = Math.min(snap.limit, snap.contraflow_cyclist.entry_limit_mps);
    },
  },
  detour: (snap) => snap.contraflow_cyclist?.detour,
  target: {
    at: "beforeRunner",
    run(snap, v, reasons, { decel, stopSpeedFor }) {
      const cf = snap.contraflow_cyclist;
      if (cf?.wait) {
        const vc = cf.bumper_to_stop_m < 1.0 ? 0 : stopSpeedFor(cf.bumper_to_stop_m - 0.5, decel);
        if (vc < v) {
          v = vc;
          reasons.push(
            cf.relation === "oncoming" ? "cyclist coming the other way: no room" : "cyclist riding against the one-way",
          );
        }
      }
      return v;
    },
  },
  hazard: { at: "beforeRunner", run: (snap) => snap.contraflow_cyclist && "contraflow cyclist" },
  candidates: {
    at: "beforeRunner",
    run({ snap, laneUntil, inLane, approach, v, stopAt, FRONT }, out) {
      // A cyclist riding against a one-way street (sim/contraflow.js): wait for it short of the junction
      // or its way, or, meeting it with no room to pass, stopped and moved over until it is by.
      const cf = snap.contraflow_cyclist;
      if (cf?.wait && cf.bumper_to_stop_m > 0.3) {
        // (a metre short of where it waits, never speeding up on the way: it is close as a rule, the
        // cyclist having come into sight late round a corner)
        out.push({
          id: "yield_to_contraflow_cyclist",
          laneUntil,
          law: inLane({
            kind: "lane",
            vTarget: Math.min(approach, Math.max(v, 2)),
            stopAtRoute: stopAt(cf.stop_s_route - FRONT - 1),
          }),
          steer: cf.detour ? "move over to the right" : "hold lane",
          speed:
            cf.relation === "oncoming"
              ? "stop, moved over, and let the cyclist coming the other way go by"
              : "stop and let the cyclist riding against the one-way go by",
        });
      }
    },
  },
  sim: {
    at: "beforeRunner",
    run(_world, snap, npcs) {
      const wait = snap.contraflow_cyclist?.wait ? snap.contraflow_cyclist.stop_s_route : null;
      if (wait === null && !npcs.some(({ n }) => isContraflowRider(n))) return null;
      const clearance = snap.contraflow_cyclist?.min_pass_m ?? minPassM(snap.road?.limit ?? snap.limit);
      let cut, meet;
      return {
        start() {
          cut = false;
          meet = false;
        },
        along(s, front) {
          if (wait !== null && s + front > wait + 0.5) cut = true;
        },
        near(car, box, rider, ob, ahead, side, meeting) {
          if (
            meeting &&
            isContraflowRider(rider) &&
            car.v > 1 &&
            Math.abs(ahead) < box.halfLength + ob.halfLength &&
            side - box.halfWidth - ob.halfWidth < clearance - 0.1
          )
            meet = true;
        },
        reject(c) {
          if (c.law.kind === "hard_brake") return null;
          return cut ? "fails_to_yield_to_contraflow_cyclist" : meet ? "passes_contraflow_cyclist_too_close" : null;
        },
      };
    },
  },
  flagText: {
    fails_to_yield_to_contraflow_cyclist: "it cuts off a cyclist riding against the one-way",
    passes_contraflow_cyclist_too_close: "it passes a cyclist riding against the one-way too close",
  },
  state: {
    at: "beforeRunner",
    run(snap, state) {
      if (snap.contraflow_cyclist?.relation === "entering")
        state.contraflow_street = {
          street: snap.contraflow_cyclist.street,
          cyclists_may_come_against_the_traffic: true,
          can_see_into_it: false,
          target_speed: r1(snap.contraflow_cyclist.entry_limit_mps),
        };
      else if (snap.contraflow_cyclist) {
        const c = snap.contraflow_cyclist;
        state.contraflow_cyclist = {
          id: c.cyclist_id,
          riding: "against the one-way, as cyclists may on this street",
          relation: CONTRAFLOW_RELATION[c.relation],
          ...(c.street ? { street: c.street } : {}),
          lane:
            c.lane_kind === "shared"
              ? "no lane: it shares the street"
              : "a painted contraflow lane on the driver's left",
          gap_m: r1(c.gap_m),
          speed: r1(c.speed),
          ...(c.wait
            ? {
                yield: true,
                wait_in_m: r1(Math.max(0, c.bumper_to_stop_m)),
                ...(c.eta_s !== null ? { arrives_in_s: r1(c.eta_s), needed_s: r1(c.need_s) } : {}),
              }
            : {}),
          ...(c.shift_m > 0 ? { move_right_m: r1(c.shift_m) } : {}),
          min_passing_distance_m: c.min_pass_m,
        };
      }
    },
  },
  clause: {
    at: "beforeRunner",
    run: (snap) => snap.contraflow_cyclist && contraflowClause(snap.contraflow_cyclist),
  },
  outcome: {
    at: "ids",
    run(c, snap) {
      if (c.id === "yield_to_contraflow_cyclist" && snap.contraflow_cyclist?.wait)
        return `clear, waits ${Math.max(0, r1(snap.contraflow_cyclist.bumper_to_stop_m - c.sim.progress_m))} m ahead for the cyclist riding against the one-way`;
      return null;
    },
  },
  motion: (snap) => snap.contraflow_cyclist?.wait,
  holdStill: {
    at: "beforeRunner",
    run: (snap) =>
      snap.contraflow_cyclist?.wait
        ? ", when a cyclist riding against a one-way street is coming and the car has reached the point where it waits for it (`contraflow_cyclist.wait_in_m` under 2)"
        : "",
  },
  prompt: {
    at: "beforeRunner",
    text: `- On a one-way street where cyclists may ride both ways, look both ways: a cyclist can come against the traffic, on the driver's left (\`contraflow_cyclist\`). Choose \`yield_to_contraflow_cyclist\` when \`situation\` says the car must wait for one: short of the junction while one comes out of the street the car is about to enter, short of its way when the car would cross it (as for oncoming traffic), or stopped, moved over to the right, when it comes the other way along the car's street with less than the minimum passing distance. Keep the car there until it has gone by. Otherwise keep right as the candidates do, leaving it at least \`contraflow_cyclist.min_passing_distance_m\`.`,
  },
};
