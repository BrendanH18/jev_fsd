import { r1 } from "../../common.js";
import {
  auditParkers,
  createParkers,
  manageParkers,
  parkerConflict,
  parkerSensing,
  parkerStop,
  stepParker,
} from "../parkers.js";

// What a car ahead parallel parking (sim/parkers.js) is doing, for models.
const PARKER_NOW = {
  signalling: "signalling right and slowing to stop beside a gap in the parked cars",
  stopped: "stopped beside the gap, signalling right, about to reverse in",
  reversing: "reversing into the gap",
};

// A car ahead parallel parking (sim/parkers.js).
function parkerClause(a) {
  const w = Math.round(Math.max(0, a.bumper_to_stop_m));
  const lead = `Car \`${a.id}\` ${Math.round(Math.max(0, a.gap_m))} m ahead is ${PARKER_NOW[a.phase]}: it is parallel parking, and needs about ${Math.round(a.hold_m)} m behind it to reverse into.`;
  if (a.in_room)
    return `${lead} The car is already inside that room, blocking it: hold still and do not move forward; never go round it.`;
  return `${lead} Stop well back, short of that room, and wait until it is in (\`wait_for_parker\`${w < 2 ? ", holding still" : `, stopping ${w} m ahead`}). Never creep up behind it, and never go round it while it signals or reverses.`;
}

export default {
  key: "parkers",
  seen: "parkersSeen",
  calls: "parkerCalls",
  build: (_world, options) => createParkers(options),
  audit: {
    at: "late",
    run(world) {
      if (world.parkers?.enabled) auditParkers(world);
    },
  },
  metric: {
    at: "late",
    name: "parking_conflicts",
    failure: "blocked or went round a car parallel parking",
  },
  evQueueHold(world, front) {
    const route = world.route;
    if (!world.parkers?.active.length || !route) return null;
    const ego = world.ego;
    const p = route.project(ego.x, ego.y, route.hint);
    const c = p && parkerConflict(world, ego, route, p.s + front, { lat: p.lateral, hint: p.index });
    return c && c.phase !== "approach" ? { distance: c.to_hold_m, vehicle: c.parker } : null;
  },
  sense: {
    at: "late",
    run(world, snap, { p, frontS }) {
      // (a car ahead parallel parking, and the room it needs behind it, with that option on: sim/parkers.js)
      if (world.parkers?.enabled)
        snap.parking_ahead = world.parkers.active.length ? parkerSensing(world, p, frontS) : null;
    },
  },
  target: {
    at: "beforeEmergency",
    run(snap, v, reasons, { decel, stopSpeedFor }) {
      // a car ahead parallel parking (sim/parkers.js): stop at its hold line, short of the room it reverses
      // into, until it is in
      const pa = snap.parking_ahead;
      if (pa?.wait) {
        const vp = pa.bumper_to_stop_m < 1.0 ? 0 : stopSpeedFor(pa.bumper_to_stop_m - 0.5, decel);
        if (vp < v) {
          v = vp;
          reasons.push("car parking ahead");
        }
      }
      return v;
    },
  },
  hazard: { at: "late", run: (snap) => (snap.parking_ahead ? "car parking ahead" : null) },
  candidates: {
    at: "rearTraffic",
    run({ snap, laneUntil, inLane, approach, queue, FRONT }, out) {
      // A car ahead parallel parking (sim/parkers.js): stop well back, at its hold line, short of the room it
      // reverses into, and wait until it is in (offered once the hold line is nearer than the queue behind it:
      // until then the car simply follows it).
      const pa = snap.parking_ahead,
        parkerAt = pa ? pa.stop_s_route - FRONT - 0.5 : Infinity;
      if (pa?.wait && pa.bumper_to_stop_m > 0.3 && parkerAt <= queue + 0.5) {
        out.push({
          id: "wait_for_parker",
          laneUntil,
          law: inLane({ kind: "lane", vTarget: approach, stopAtRoute: parkerAt }),
          steer: "hold lane",
          speed: "stop well back and wait while the car ahead parallel parks",
        });
      }
    },
  },
  sim: {
    at: "beforeEmergency",
    run(_world, snap) {
      if (!snap.parking_ahead?.wait) return null;
      const line = snap.parking_ahead.stop_s_route + 1;
      let entered = false;
      return {
        start() {
          entered = false;
        },
        along(s, front) {
          if (s + front > line) entered = true;
        },
        reject(c) {
          return (entered || c.change) && c.law.kind !== "hard_brake" ? "blocks_parking_car" : null;
        },
      };
    },
  },
  state: {
    at: "rearTraffic",
    run(snap, state) {
      if (snap.parking_ahead) {
        const a = snap.parking_ahead;
        state.parking_ahead = {
          id: a.id,
          signalling: "right",
          now: PARKER_NOW[a.phase],
          ...(a.reverse_lights ? { reverse_lights: true } : {}),
          gap_m: r1(a.gap_m),
          room_it_needs_m: r1(a.hold_m),
          ...(a.stops_in_m != null ? { stops_in_m: r1(a.stops_in_m) } : {}),
          wait: true,
          ...(a.in_room ? { in_its_room: true } : { wait_in_m: r1(Math.max(0, a.bumper_to_stop_m)) }),
        };
      }
    },
  },
  outcome: {
    at: "ids",
    run(c, snap) {
      if (c.id === "wait_for_parker" && snap.parking_ahead)
        return `clear, stops ${Math.max(0, r1(snap.parking_ahead.bumper_to_stop_m - c.sim.progress_m))} m ahead, well back from the car parking, and waits`;
      return null;
    },
  },
  clause: { at: "rearTraffic", run: (snap) => (snap.parking_ahead ? parkerClause(snap.parking_ahead) : null) },
  motion: (snap) => snap.parking_ahead?.wait,
  holdStill: {
    at: "late",
    run(snap) {
      return snap.parking_ahead?.wait
        ? ", when a car ahead is parallel parking (`parking_ahead.wait` true) and the car has reached the point where it waits for it (`parking_ahead.wait_in_m` under 2) or is inside the room it needs (`parking_ahead.in_its_room`), until it is in"
        : "";
    },
  },
  prompt: {
    at: "snowbanks",
    text: `- A car ahead signalling right and slowing to stop beside a gap in the parked cars is about to parallel park (\`parking_ahead\`). Stop well back, short of the room it reverses into, and wait until it is in: choose \`wait_for_parker\` while \`parking_ahead.wait\` is true, and keep the car stopped there. Never creep up behind it, and never go round it while it signals or reverses. If the car is already inside that room (\`parking_ahead.in_its_room\`), hold still.`,
  },
  parkingTraffic: (n) => !!n.parker,
  trafficManage(world, fleet) {
    if (world.parkers?.enabled) manageParkers(world, fleet);
  },
  trafficManeuver: (world, fleet, n, dt) => n.parker && stepParker(world, fleet, n, dt),
  trafficLeaderHold(world, n, path, front) {
    if (!world.parkers?.active.length || n.parker) return null;
    const hold = parkerConflict(world, n, path, front);
    if (!hold) return null;
    n.lcCooldown = Math.max(n.lcCooldown || 0, 0.5);
    return { gap: hold.to_hold_m, vehicle: hold.parker };
  },
  trafficParkingPlan(n, standstillGap) {
    if (!n.parker) return null;
    const stop = parkerStop(n);
    return { shift: n.parker.shift, stop: stop === null ? null : stop + standstillGap - 0.3, signal: "right" };
  },
};
