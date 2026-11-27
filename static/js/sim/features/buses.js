import { r1 } from "../../common.js";
import { BUS } from "../vehicle.js";
import { isEmergency } from "../emergency.js";
import {
  BUS_DWELL_S,
  BUS_SIGNAL_M,
  BUS_TAPER_M,
  BUS_YIELD_GAP_M,
  busHasRightOfWay,
  busMayPullOut,
  busRelation,
  busYield,
  busZones,
  canStopFor,
  curbShift,
  isBus,
} from "../bus.js";
import { TransitRuns } from "../transit-runs.js";
import { applyTrafficPathPolicy, firstHookResult, hooks } from "./index.js";

// Transit buses (sim/bus.js, BC MVA s. 169.1). The fleet runs them on the map's bus routes (`buses`,
// sim/transit-runs.js), pulling in to their stops and out again; with the World option nobody parks in
// their bus zones. Traffic behind a bus signalling to pull out from its stop lets it out, and so do the
// driven car's sensing, candidates, wording and audit.

const BUS_SPAWN_LANE = hooks("busSpawnLane");
// Up to 4 at a time in free drives. A bus eases in to the curb and back out at up to 0.7 m/s, and
// 0.25 m/s for every 1 m/s it drives plus 0.05 m/s.
const MAX_BUSES = 4;
const BUS_SHIFT_MPS = 0.7;
const BUS_SHIFT_PER_MPS = 0.25;
// Yielding to a bus pulling out from its stop: once the car, in the lane the bus pulls out into and
// behind it, first sees it signalling to (where the limit is 60 km/h or less), it owes it the right of
// way if it could stop 2 m behind it braking at up to 3.5 m/s^2 then. The car fails to yield if, owing
// it, it draws level with the bus (its front past the bus's rear) at more than 1 m/s before the bus has
// pulled out. Counted once each time a bus pulls out.
const AUDIT_BUS_DECEL = 3.5;
const AUDIT_BUS_MOVING_MPS = 1;

// (the signal a bus planned this step, for its turn indicator once the driver's own is set)
let planned = null;

class Buses extends TransitRuns {
  constructor(fleet, { enabled, seed, makePath }) {
    super(fleet, {
      max: MAX_BUSES,
      enabled,
      seed,
      makePath,
      pathPolicy: (world, path) => applyTrafficPathPolicy(world, path, "bus"),
      spawnLane: (world, edge) => firstHookResult(BUS_SPAWN_LANE, world, edge)?.index,
    });
  }

  // Whether a bus's next stop is within 150 m along its path, so it should move across to the curb lane
  // (by a lane change, gap permitting: it keeps its lane straight on through a junction).
  stopSoon(n, front) {
    const stop = n.transit.stops[n.transit.next],
      at = stop ? this.stopOnPath(n, stop, front) : null;
    return at !== null && at - front < 150;
  }

  // One step of a bus's stops (see the top of sim/bus.js): it signals and pulls in to the next, stops
  // there, opens its doors for 10 to 25 s, signals left and pulls out once it may, until its rear axle is
  // back in its lane (`lateral`: how far right of it that is). Returns where it stops (`stopAt`, metres
  // from its front, or null) and its signal (undefined: as any driver's).
  plan(n, pe, front, dt, lateral) {
    const t = n.transit,
      e = this.map.edges.get(pe.id);
    t.limit = e.limit;
    t.laneWidth = e.lane_width;
    let stopAt = null,
      signal,
      target = 0;
    if (t.phase === "drive") {
      let stop = t.stops[t.next],
        at = stop ? this.stopOnPath(n, stop, front) : null;
      // (one it has passed, or whose street is behind it, is skipped)
      while (stop && (at === null || at - front < -2)) {
        stop = t.stops[++t.next];
        at = stop ? this.stopOnPath(n, stop, front) : null;
      }
      if (stop && at - front < BUS_SIGNAL_M) {
        // in to the curb where nothing is parked in the bus zone (a car parked there all the same: in its
        // lane)
        const se = this.map.edges.get(stop.edge),
          lane = n.path.edges.find((x) => x.id === stop.edge)?.lane ?? se.lanes - 1;
        const free = this.fleet
          .parkedAlong(se)
          .every(([a, b]) => b < stop.front - BUS.length - 2 || a > stop.front + 1);
        Object.assign(t, { phase: "in", stop, curb: free ? curbShift(se, lane) : 0 });
      }
    }
    if (t.phase === "in") {
      const at = this.stopOnPath(n, t.stop, front),
        to = at === null ? -Infinity : at - front;
      // (past it without stopping: back into its lane, with no right of way, as it has not stopped)
      if (to < -3) Object.assign(t, { phase: "drive", next: t.next + 1, curb: 0 });
      else {
        signal = "right";
        target = to < BUS_TAPER_M ? t.curb : 0;
        // (the driver's standstill gap would leave it short of the stop: aim beyond by as much)
        stopAt = to + (n.driver.s0 || 0) - 1;
        if (n.v < 0.2 && to < 2.5)
          Object.assign(t, {
            phase: "dwell",
            t: 0,
            dwell: BUS_DWELL_S[0] + this.random() * (BUS_DWELL_S[1] - BUS_DWELL_S[0]),
            doors: true,
            next: t.next + 1,
          });
      }
    }
    if (t.phase === "dwell") {
      target = t.curb;
      stopAt = 0;
      signal = null;
      t.t += dt;
      if (t.t >= t.dwell) Object.assign(t, { phase: "leaving", t: -dt, doors: false, departures: t.departures + 1 });
    }
    if (t.phase === "leaving") {
      target = t.curb;
      stopAt = 0;
      signal = "left";
      t.t += dt;
      if (busMayPullOut(n, [this.world.ego, ...this.fleet.vehicles], (o) => o.busYield?.bus === n)) t.phase = "out";
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

  // A driver yielding to a bus pulling out from its stop: where it stops, as metres from its front, or
  // null. It yields once it sees the bus signal if it can stop 2 m behind it braking at up to 3 m/s^2,
  // and from then on until the bus has pulled out (or it is no longer behind it).
  yieldTo(n) {
    let best = null;
    for (const bus of this.list) {
      const y = busYield(n, bus);
      if (!y) {
        if (n.busYield?.bus === bus) n.busYield = null;
        continue;
      }
      if (n.busYield?.bus !== bus && !canStopFor(n.v, y.stop_m)) continue;
      if (!n.busYield) n.busYield = { bus };
      if (best === null || y.stop_m < best) best = y.stop_m;
    }
    if (best === null) n.busYield = null;
    return best;
  }
}

// (see AUDIT_BUS_MOVING_MPS)
function auditBuses(world) {
  const ego = world.ego;
  for (const bus of world.npcs) {
    if (!isBus(bus) || !busHasRightOfWay(bus)) continue;
    const key = `${bus.id}:${bus.transit.departures}`,
      r = busRelation(ego, bus);
    let rec = world.busCalls.get(key);
    if (!r?.inLane) continue;
    // (it owes the bus the right of way if it was behind it when it first saw it signal, and could stop
    // then; until it sees it, nothing is decided)
    if (!rec) {
      if (!world.visibility.sees(ego, bus)) continue;
      world.busCalls.set(
        key,
        (rec = {
          owed: r.behind_m > 0 && r.behind_m - BUS_YIELD_GAP_M >= Math.max(0, ego.v) ** 2 / (2 * AUDIT_BUS_DECEL),
          counted: false,
        }),
      );
    }
    if (rec.owed && !rec.counted && r.behind_m < 0 && ego.v > AUDIT_BUS_MOVING_MPS) {
      rec.counted = true;
      world.violations.failed_to_yield++;
      world.events.push({ type: "failed_to_yield", to: "bus", with: bus.id });
    }
  }
  // (forget buses that have pulled out)
  if (world.busCalls.size > 20) for (const key of [...world.busCalls.keys()].slice(0, 10)) world.busCalls.delete(key);
}

// A bus ahead signalling to pull out from its stop that the car must let out, or null: which bus (`id`,
// its route `ref`), how far ahead its rear is (`gap_m`) and where the car stops for it (`stop_s_route`,
// front bumper, 2 m behind it), and whether it is already moving out. The car owes it the right of way
// when it sees it signal from the lane it pulls out into, behind it, if it could stop there braking at
// no more than 3 m/s^2 then; from then on until the bus has pulled out. Decided once each time a bus
// pulls out, and remembered in `world.busYields`.
function busPullingOut(world, frontS, visible) {
  let best = null;
  world.busYields ||= new Map();
  for (const bus of world.npcs) {
    if (!isBus(bus) || !visible.includes(bus)) continue;
    const y = busYield(world.ego, bus);
    if (!y) continue;
    const key = `${bus.id}:${bus.transit.departures}`;
    if (!world.busYields.has(key)) {
      if (world.busYields.size > 20) world.busYields.delete(world.busYields.keys().next().value);
      world.busYields.set(key, canStopFor(world.ego.v, y.stop_m));
    }
    if (!world.busYields.get(key)) continue;
    if (!best || y.stop_m < best.bumper_to_stop_m)
      best = {
        id: bus.id,
        ref: bus.ref || "",
        gap_m: y.behind_m,
        stop_s_route: frontS + y.stop_m,
        bumper_to_stop_m: y.stop_m,
        moving_out: bus.transit.phase === "out",
      };
  }
  return best;
}

export default {
  key: "buses",
  view: () => import("../../render/bus.js"),
  // a bus ahead signalling to pull out from its stop, with the right of way: say so once
  notice: {
    at: "first",
    order: 1,
    duration: 2500,
    style: "safety",
    read(world, _autopilot, _views, _previous, fleet) {
      const bus = fleet?.buses?.list.find((b) => busYield(world.ego, b) && world.visibility.sees(world.ego, b));
      return bus
        ? {
            key: `${bus.id}:${bus.transit.departures}`,
            text: `BUS ${bus.ref || ""} PULLING OUT · YIELD`.replace("  ", " "),
          }
        : null;
    },
  },
  // (the World takes the option too: nobody parks in the bus zones while buses run)
  worldOption: true,
  // (the fleet places them right after the cyclists, as it always has)
  buildAt: "early",
  build: (_world, { enabled }) => !!enabled,
  calls: "busCalls",
  buildFleet: (fleet, options) => new Buses(fleet, options),
  snapshot: { bus: null },
  // (long, so looked for all along its body; heavy, it stops for any body in its way just ahead and keeps
  // under the limit; it keeps to its lane, drivers ease past one standing at its stop, and it never
  // parks; its path follows the bus lanes' policy for buses)
  obstacle: {
    test: isBus,
    traffic: true,
    long: true,
    heavy: true,
    ownLane: true,
    noParking: () => true,
    pathPolicy: () => "bus",
    laneShift: (o) => o.transit.shift,
    standing(o) {
      const t = o.transit;
      return t.phase === "dwell" || t.phase === "leaving" || (t.phase === "in" && t.shift > 1);
    },
  },
  motion: (snap) => !!snap.bus,
  flagText: { fails_to_yield_to_bus: "it does not let a bus pull out from its stop" },
  parkingZones: (world, map) => (world.buses ? busZones(map) : null),
  crosswalkVehicle: (n) => (isBus(n) ? "bus" : null),

  trafficManage: {
    at: "buses",
    run(_world, fleet) {
      const buses = fleet.buses;
      if (buses.list.length || buses.target) buses.manage();
    },
  },
  // (a bus moves across to the curb lane for its next stop, and otherwise changes lanes only for a turn)
  trafficLaneChange(_world, fleet, n, edge, front) {
    if (!isBus(n) || !n.transit || n.yieldEv) return false;
    if (n.transit.phase === "drive") fleet.maybeChangeLane(n, edge, front, fleet.buses.stopSoon(n, front));
    return true;
  },
  // A bus pulling in to its stop, waiting there and pulling out again.
  trafficStop(_world, fleet, n, front, dt, proj) {
    planned = null;
    if (!isBus(n) || !n.transit) return null;
    const stand = fleet.buses.plan(n, n.path.currentEdge(), front, dt, proj.lateral);
    if (stand.signal !== undefined) planned = { n, signal: stand.signal };
    return stand.stopAt;
  },
  trafficIndicator: (n) => (planned?.n === n ? { signal: planned.signal } : null),
  // Behind a bus signalling to pull out from its stop, letting it out: after the checks above, which still
  // hold on the way there (a junction before the stop), and not a line the wait at which is ever given up.
  trafficHold: {
    at: "buses",
    run: (_world, fleet, n) =>
      fleet.buses.list.length && n.kind !== "bike" && !n.transit && !isEmergency(n) ? fleet.buses.yieldTo(n) : null,
  },
  trafficStanding: (_world, fleet) => fleet.buses.list,
  trafficRecover: (_world, fleet, n, near) => isBus(n) && fleet.buses.recover(n, near),
  checkpoint(world, fleet) {
    if (!fleet.buses) return;
    fleet.buses.world = world;
    fleet.buses.fleet = fleet;
  },

  audit: { at: "buses", run: auditBuses },

  sense: {
    at: "buses",
    run(world, snap, { frontS, visible }) {
      snap.bus = busPullingOut(world, frontS, visible);
    },
  },
  target: {
    at: "buses",
    run(snap, v, reasons, { decel, holdSpeed }) {
      if (snap.bus) {
        const vb = holdSpeed(snap.bus.bumper_to_stop_m, decel);
        if (vb < v) {
          v = vb;
          reasons.push("bus pulling out");
        }
      }
      return v;
    },
  },
  hazard: { at: "buses", run: (snap) => (snap.bus ? "bus" : null) },

  // A bus pulling out from its stop ahead, with the right of way: stop behind it and let it out.
  candidates: {
    at: "buses",
    run({ snap, laneUntil, inLane, approach, stopAt, FRONT }, out) {
      if (snap.bus && snap.bus.bumper_to_stop_m > 0.3) {
        out.push({
          id: "yield_to_bus",
          laneUntil,
          law: inLane({ kind: "lane", vTarget: approach, stopAtRoute: stopAt(snap.bus.stop_s_route - FRONT - 0.5) }),
          steer: "hold lane",
          speed: "stop behind the bus and let it pull out",
        });
      }
    },
  },
  // (1.5 m past where it stops, as a short stop overshoots: into the 2 m it leaves behind the bus)
  sim: {
    at: "buses",
    run(_world, snap) {
      const busStop = snap.bus?.stop_s_route ?? null;
      if (busStop === null) return null;
      let passes = false;
      return {
        start() {
          passes = false;
        },
        along(s, front) {
          if (s + front > busStop + 1.5) passes = true;
        },
        reject: (c) => (passes && c.law.kind !== "hard_brake" ? "fails_to_yield_to_bus" : null),
      };
    },
  },
  rulesWait: (c) => c.id === "yield_to_bus",
  legitimateStop: (snap) => !!(snap?.bus && snap.bus.bumper_to_stop_m < 8),

  state: {
    at: "buses",
    run(snap, state) {
      if (snap.bus)
        state.bus_pulling_out = {
          id: snap.bus.id,
          route: snap.bus.ref,
          gap_m: r1(Math.max(0, snap.bus.gap_m)),
          wait_in_m: r1(Math.max(0, snap.bus.bumper_to_stop_m)),
          moving_out: snap.bus.moving_out,
          yield: true,
        };
    },
  },
  outcome: {
    at: "ids",
    run: (c, snap) =>
      c.id === "yield_to_bus" && snap.bus
        ? `clear, stops ${Math.max(0, r1(snap.bus.bumper_to_stop_m - c.sim.progress_m))} m behind the bus`
        : null,
  },
  clause: {
    at: "buses",
    run(snap) {
      if (!snap.bus) return null;
      const b = snap.bus,
        w = Math.max(0, Math.round(b.bumper_to_stop_m));
      return `Bus \`${b.id}\`${b.ref ? ` (route ${b.ref})` : ""}, stopped ${Math.round(Math.max(0, b.gap_m))} m ahead at a bus stop in the car's lane, is ${b.moving_out ? "pulling out" : "signalling to pull out"} into it. Traffic behind a bus pulling out from a stop must let it out: ${w < 2 ? "hold still behind it until it has pulled out." : `slow down and stop ${w} m ahead, 2 m behind it (\`yield_to_bus\`), until it has pulled out.`}`;
    },
  },
  holdStill: {
    at: "buses",
    run: (snap) =>
      snap.bus
        ? ", when a bus ahead is pulling out from its stop and the car has stopped behind it (`bus_pulling_out.wait_in_m` under 2)"
        : "",
  },
  prompt: {
    at: "buses",
    text: "- Choose `yield_to_bus` when `situation` says a bus ahead is pulling out from its stop and the car must let it out.",
  },
};
