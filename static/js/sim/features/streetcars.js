import { r1 } from "../../common.js";
import { BUS_SIGNAL_M } from "../bus.js";
import { isEmergency } from "../emergency.js";
import {
  DEPART_S,
  DOORS_DELAY_S,
  DWELL_MAX_S,
  DWELL_S,
  HOLD_M,
  IN_LANE_M,
  RIDER_EVERY_S,
  RIDERS_OFF,
  RIDERS_ON,
  SIDE_M,
  STOP_M,
  canStopFor,
  doorsOpen,
  holdFromRear,
  isStreetcar,
  stoppingAt,
  streetcarHold,
  streetcarRelation,
} from "../streetcar.js";
import { TransitRuns } from "../transit-runs.js";

// Streetcars (sim/streetcar.js, Ontario HTA s. 166). The fleet runs them on the map's streetcar routes
// (`streetcars`, sim/transit-runs.js), in the lane their track is laid in, stopping at their stops with
// their doors open while their riders cross between them and the curb; nobody passes one with its doors
// open on the side its riders use, and the driven car's sensing, candidates, wording and audit do the
// same.

// Up to 2 at a time in free drives. One slows to its stops at up to 1.1 m/s^2, from a bus's signalling
// distance at least (sim/bus.js BUS_SIGNAL_M).
const MAX_STREETCARS = 2;
const STREETCAR_DECEL = 1.1;
// Coming up to a streetcar slowing for its stop: no faster than the car could stop where it would stop
// for its doors, comfortably, but at least this.
const AMBER_MIN_MPS = 4;
// Not passing a streetcar with its doors open: once the car, going its way behind it in its lane or in
// the lane beside it on the side its riders use, first sees its doors open, it owes the stop if it could
// then stop where drivers do (4 m behind its rear doors, or 4 m behind it in its lane) braking at up to
// 3.5 m/s^2. It fails to yield if, owing it, its front comes within 2 m of the rear doors (of the
// streetcar, in its lane) at more than 1 m/s while they are still open. Counted once a stop.
const AUDIT_STREETCAR_MOVING_MPS = 1;

class Streetcars extends TransitRuns {
  constructor(fleet, { enabled, seed, makePath }) {
    super(fleet, { tram: true, max: MAX_STREETCARS, enabled, seed, makePath });
  }

  // One step of a streetcar's stops (see the top of sim/streetcar.js): it slows to the next and stops
  // there in its lane, opens its doors, lets its riders off and on, closes its doors once they are clear
  // of the street and moves off; and it stops at the end of its run, where its track leaves the map
  // (`manage` then takes it off). Returns where it stops (metres from its front), or null.
  plan(n, front, dt) {
    return streetcarPlan(this.world, this, n, front, dt);
  }

  // A driver not passing a streetcar with its doors open: where it stops, as metres from its front, or
  // null. Owed when, seeing the doors open, it can stop there braking at no more than OWED_DECEL;
  // decided once a stop, and kept until they close.
  yieldTo(n, front) {
    return yieldToStreetcar(this, n, front);
  }
}

function streetcarPlan(world, runs, n, front, dt) {
  const t = n.transit,
    crowd = world.crowd;
  let stopAt = null;
  const last = n.path.edges.find((e) => e.id === t.edges[t.edges.length - 1]);
  if (last) {
    stopAt = last.sEnd - front - 1;
    // (stopped there, short of it by the driver's standstill gap)
    if (stopAt < (n.driver.s0 || 0) + 1.5 && n.v < 0.3) t.done = true;
  }
  const hold = (at) => {
    stopAt = stopAt === null ? at : Math.min(stopAt, at);
  };
  if (t.phase === "drive") {
    let stop = t.stops[t.next],
      at = stop ? runs.stopOnPath(n, stop, front) : null;
    while (stop && (at === null || at - front < -2)) {
      stop = t.stops[++t.next];
      at = stop ? runs.stopOnPath(n, stop, front) : null;
    }
    if (stop && at - front < Math.max(BUS_SIGNAL_M, (n.v * n.v) / (2 * STREETCAR_DECEL) + 10))
      Object.assign(t, { phase: "in", stop });
  }
  if (t.phase === "in") {
    const at = runs.stopOnPath(n, t.stop, front),
      to = at === null ? -Infinity : at - front;
    if (to < -3) Object.assign(t, { phase: "drive", next: t.next + 1 });
    else {
      // (the driver's standstill gap would leave it short of the stop: aim beyond by as much)
      hold(to + (n.driver.s0 || 0) - 1);
      if (n.v < 0.2 && to < 2.5) {
        const pick = (r) => r[0] + Math.floor(runs.random() * (r[1] - r[0] + 1));
        Object.assign(t, {
          phase: "dwell",
          t: 0,
          dwell: DWELL_S[0] + runs.random() * (DWELL_S[1] - DWELL_S[0]),
          next: t.next + 1,
          off: pick(RIDERS_OFF),
          on: pick(RIDERS_ON),
          riderAt: DOORS_DELAY_S + 0.5,
        });
      }
    }
  }
  if (t.phase === "dwell") {
    hold(0);
    t.t += dt;
    const e = world.map.edges.get(n.path.currentEdge().id);
    if (!t.doors && t.t >= DOORS_DELAY_S && !t.closing) t.doors = true;
    // (one rider at a time: those getting off first)
    if (t.doors && !t.held && t.t >= t.riderAt && (t.off > 0 || t.on > 0)) {
      if (t.off > 0) {
        t.off--;
        crowd.rideOff(n, e, runs.random);
      } else {
        t.on--;
        crowd.rideOn(n, e, runs.random);
      }
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
    if (t.closing && t.t >= DEPART_S)
      Object.assign(t, { phase: "drive", closing: false, departures: t.departures + 1 });
  }
  n.doors = t.doors;
  return stopAt;
}

function yieldToStreetcar(runs, n, front) {
  let best = null;
  for (const car of runs.list) {
    if (car === n || !doorsOpen(car) || Math.abs(car.x - n.x) > 130 || Math.abs(car.y - n.y) > 130) continue;
    const h = streetcarHold(n.path.pts, n.path.cum, front, car);
    if (!h) continue;
    const key = `${car.id}:${car.transit.departures}`;
    n.streetcarOwed ||= {};
    if (!(key in n.streetcarOwed)) {
      for (const k of Object.keys(n.streetcarOwed)) if (k.startsWith(`${car.id}:`)) delete n.streetcarOwed[k];
      n.streetcarOwed[key] = canStopFor(n.v, h.stop_m);
    }
    if (n.streetcarOwed[key] && (best === null || h.stop_m < best)) best = h.stop_m;
  }
  return best;
}

// (see AUDIT_STREETCAR_MOVING_MPS)
function auditStreetcars(world) {
  const ego = world.ego;
  for (const car of world.npcs) {
    if (!doorsOpen(car)) continue;
    const key = `${car.id}:${car.transit.departures}`,
      r = streetcarRelation(ego, car);
    if (!r || r.right_m < -IN_LANE_M || r.right_m > SIDE_M) continue;
    let rec = world.streetcarCalls.get(key);
    // (decided when the car first sees the doors open, still short of where it must stop)
    if (!rec) {
      if (r.ahead_m <= 0 || !world.visibility.sees(ego, car)) continue;
      world.streetcarCalls.set(key, (rec = { owed: canStopFor(ego.v, r.ahead_m), counted: false }));
    }
    if (rec.owed && !rec.counted && r.ahead_m <= HOLD_M - STOP_M && ego.v > AUDIT_STREETCAR_MOVING_MPS) {
      rec.counted = true;
      world.violations.failed_to_yield++;
      world.events.push({ type: "failed_to_yield", to: "streetcar", with: car.id });
    }
  }
  if (world.streetcarCalls.size > 20)
    for (const key of [...world.streetcarCalls.keys()].slice(0, 10)) world.streetcarCalls.delete(key);
}

// A streetcar the car must not pass: stopped with its doors open, ahead on the car's route going its
// way, with the car in its lane behind it or in the lane beside it on the side its riders use
// (`beside`). The car stops with its front 4 m behind its rear doors, short of the law's 2 m, or 4 m
// behind it in its lane (`stop_s_route`), and stays stopped while they are open. Owed when the car,
// first seeing them open, could stop there braking at no more than 3.5 m/s^2; decided once a stop and
// remembered in `world.streetcarYields`. With none, the nearest slowing for its stop (`doors` false,
// `stopping` true), or null.
function streetcarStop(world, route, frontS, visibleNpcs) {
  world.streetcarYields ||= new Map();
  let open = null,
    stopping = null;
  for (const car of visibleNpcs) {
    if (!isStreetcar(car) || !(doorsOpen(car) || stoppingAt(car))) continue;
    const h = streetcarHold(route.pts, route.cum, frontS, car),
      r = streetcarRelation(world.ego, car);
    if (!h || !r || r.right_m < -IN_LANE_M || r.right_m > SIDE_M) continue;
    // (in its lane or beside it, by where the car is now)
    const stop = h.gap_m + holdFromRear(r.right_m);
    // (until its front reaches the doors, or the streetcar in its lane: just past where it stops, it
    // stays stopped)
    if (stop + STOP_M <= 0) continue;
    const out = {
      id: car.id,
      ref: car.ref || null,
      beside: r.beside,
      doors: doorsOpen(car),
      gap_m: h.gap_m,
      stop_s_route: frontS + stop,
      bumper_to_stop_m: stop,
    };
    if (!out.doors) {
      if (!stopping || h.gap_m < stopping.gap_m) stopping = { ...out, stopping: true };
      continue;
    }
    const key = `${car.id}:${car.transit.departures}`;
    if (!world.streetcarYields.has(key)) {
      if (world.streetcarYields.size > 20) world.streetcarYields.delete(world.streetcarYields.keys().next().value);
      world.streetcarYields.set(key, canStopFor(world.ego.v, stop));
    }
    if (world.streetcarYields.get(key) && (!open || stop < open.bumper_to_stop_m)) open = out;
  }
  return open || stopping;
}

export default {
  key: "streetcars",
  view: () => import("../../render/streetcar.js"),
  // a streetcar ahead with its doors open, that the car must stop behind: say so once
  notice: {
    at: "afterCrosswalk",
    order: 1,
    duration: 2500,
    style: "safety",
    read(world, _autopilot, _views, _previous, fleet) {
      const tram = fleet?.streetcars?.list.find((c) => {
        const r = doorsOpen(c) && streetcarRelation(world.ego, c);
        return (
          r &&
          r.ahead_m > 0 &&
          r.ahead_m < 70 &&
          r.right_m > -IN_LANE_M &&
          r.right_m < SIDE_M &&
          world.visibility.sees(world.ego, c)
        );
      });
      return tram
        ? { key: `${tram.id}:${tram.transit.departures}`, text: "STREETCAR · DOORS OPEN · STOP BEHIND THE DOORS" }
        : null;
    },
  },
  // (the fleet places them right after the cyclists, before the school buses, as it always has)
  buildAt: "early",
  property: "streetcarYields",
  build: () => new Map(),
  calls: "streetcarCalls",
  buildFleet: (fleet, options) => new Streetcars(fleet, options),
  snapshot: { streetcar: null },
  // (long, so looked for all along its body; heavy, it stops for any body in its way just ahead and keeps
  // under the limit; on its track it keeps its own path and lane, never pulls over and never parks)
  obstacle: {
    test: isStreetcar,
    traffic: true,
    long: true,
    heavy: true,
    ownLane: true,
    onTrack: true,
    noParking: () => true,
    pathPolicy: () => false,
  },
  motion: (snap) => !!snap.streetcar,
  flagText: { passes_streetcar_doors: "it passes a streetcar's open doors" },

  trafficManage: {
    at: "buses",
    run(_world, fleet) {
      const runs = fleet.streetcars;
      if (runs.list.length || runs.target) runs.manage();
    },
  },
  // (on its track, it never changes lanes)
  trafficLaneChange: (_world, _fleet, n) => !!n.transit?.tram,
  trafficStop: (_world, fleet, n, front, dt) => (n.transit?.tram ? fleet.streetcars.plan(n, front, dt) : null),
  // Not passing a streetcar with its doors open on the side its riders use.
  trafficHold: (_world, fleet, n, front) =>
    fleet.streetcars.list.length && !isEmergency(n) && !n.transit?.tram ? fleet.streetcars.yieldTo(n, front) : null,
  trafficRecover: (_world, fleet, n, near) => isStreetcar(n) && fleet.streetcars.recover(n, near),
  checkpoint(world, fleet) {
    if (!fleet.streetcars) return;
    fleet.streetcars.world = world;
    fleet.streetcars.fleet = fleet;
  },

  audit: { at: "buses", run: auditStreetcars },
  resetContact: (world) => world.streetcarYields?.clear(),

  sense: {
    at: "afterCrosswalk",
    run(world, snap, { route, frontS, visibleNpcs }) {
      snap.streetcar = streetcarStop(world, route, frontS, visibleNpcs);
    },
  },
  // A streetcar with its doors open: stop behind them; slowing for its stop, slow down, ready to.
  target: {
    at: "streetcars",
    run(snap, v, reasons, { decel, stopSpeedFor }) {
      const sc = snap.streetcar;
      if (sc) {
        const room = sc.bumper_to_stop_m;
        const vs = sc.doors
          ? room < 1.0
            ? 0
            : stopSpeedFor(room - 0.5, decel)
          : Math.max(AMBER_MIN_MPS, stopSpeedFor(room, decel));
        if (vs < v) {
          v = vs;
          reasons.push(sc.doors ? "streetcar stopped, doors open" : "streetcar stopping");
        }
      }
      return v;
    },
  },
  hazard: { at: "afterCrosswalk", run: (snap) => (snap.streetcar ? "streetcar" : null) },

  // A streetcar ahead with its doors open: stop behind its rear doors (behind it, in its lane), and stay
  // stopped while they are open.
  candidates: {
    at: "afterCrosswalk",
    run({ snap, laneUntil, inLane, approach, stopAt, FRONT }, out) {
      const tram = snap.streetcar;
      if (tram?.doors && tram.bumper_to_stop_m > 0.3) {
        out.push({
          id: "stop_for_streetcar",
          laneUntil,
          law: inLane({ kind: "lane", vTarget: approach, stopAtRoute: stopAt(tram.stop_s_route - FRONT) }),
          steer: "hold lane",
          speed: tram.beside ? "stop behind the streetcar's rear doors" : "stop behind the streetcar",
        });
      }
    },
  },
  // (1.5 m past where it stops is still short of the doors)
  sim: {
    at: "afterCrosswalk",
    run(_world, snap) {
      const tramStop = snap.streetcar?.doors ? snap.streetcar.stop_s_route : null;
      if (tramStop === null) return null;
      let passes = false;
      return {
        start() {
          passes = false;
        },
        along(s, front) {
          if (s + front > tramStop + 1.5) passes = true;
        },
        reject: (c) => (passes && c.law.kind !== "hard_brake" ? "passes_streetcar_doors" : null),
      };
    },
  },
  rulesWait: (c) => c.id === "stop_for_streetcar",
  legitimateStop: (snap) => !!(snap?.streetcar?.doors && snap.streetcar.bumper_to_stop_m < 8),

  state: {
    at: "afterCrosswalk",
    run(snap, state) {
      if (!snap.streetcar) return;
      const c = snap.streetcar;
      state.streetcar = {
        id: c.id,
        ...(c.ref ? { route: c.ref } : {}),
        beside_it: c.beside,
        gap_m: r1(Math.max(0, c.gap_m)),
        ...(c.doors
          ? { doors_open: true, stop: true, wait_in_m: r1(Math.max(0, c.bumper_to_stop_m)) }
          : { stopping: true }),
      };
    },
  },
  outcome: {
    at: "ids",
    run: (c, snap) =>
      c.id === "stop_for_streetcar" && snap.streetcar
        ? `clear, stops ${Math.max(0, r1(snap.streetcar.bumper_to_stop_m - c.sim.progress_m))} m short of the streetcar's ${snap.streetcar.beside ? "rear doors" : "rear"}`
        : null,
  },
  clause: {
    at: "afterCrosswalk",
    run(snap) {
      if (!snap.streetcar) return null;
      const c = snap.streetcar,
        w = Math.max(0, Math.round(c.bumper_to_stop_m)),
        name = `Streetcar \`${c.id}\`${c.ref ? ` (route ${c.ref})` : ""}`;
      return c.doors
        ? `${name}, ${Math.round(Math.max(0, c.gap_m))} m ahead ${c.beside ? "in the next lane" : "in the car's lane"}, going the car's way, is stopped with its doors open: its riders cross the street between it and the curb${c.beside ? ", through the car's lane" : ""}. Traffic behind it must not pass it, or come within 2 m of its rear doors, until they close: ${w < 2 ? "hold still where the car is." : `slow down and stop ${w} m ahead (\`stop_for_streetcar\`).`}`
        : `${name}, ${Math.round(Math.max(0, c.gap_m))} m ahead ${c.beside ? "in the next lane" : "in the car's lane"}, going the car's way, is slowing for its stop. Once it stops its doors open, and traffic behind it will have to stop behind its rear doors while its riders cross between it and the curb. Slow down, ready to stop; \`car.target_speed\` already does.`;
    },
  },
  holdStill: {
    at: "afterCrosswalk",
    run: (snap) =>
      snap.streetcar?.doors
        ? ", when a streetcar ahead has its doors open and the car has stopped behind them (`streetcar.wait_in_m` under 2)"
        : "",
  },
  prompt: {
    at: "afterCrosswalk",
    text: "- Choose `stop_for_streetcar` when `situation` says a streetcar ahead, going the car's way, is stopped with its doors open: riders cross between it and the curb. Keep the car stopped behind its rear doors until they close.",
  },
};
