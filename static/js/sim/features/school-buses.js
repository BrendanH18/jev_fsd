import { r1, rng } from "../../common.js";
import { headingAt, pointAt, projectPoint } from "../../map/mapdata.js";
import { purePursuit } from "../controller.js";
import { obbOverlap } from "../collision.js";
import { isEmergency } from "../emergency.js";
import { StopMemory } from "../signals.js";
import { SCHOOL_BUS, Vehicle } from "../vehicle.js";
import {
  AMBER_M,
  BEHIND_M,
  KID_CROSS_P,
  KID_EVERY_S,
  KIDS,
  LEAVE_S,
  ONCOMING_M,
  RED_MAX_S,
  RED_S,
  SIDE_M,
  STOP_EVERY_M,
  canStopFor,
  firstStop,
  isSchoolBus,
  redsOn,
  schoolBusHold,
  schoolBusRelation,
  stopRange,
} from "../school-bus.js";

// School buses (sim/school-bus.js, BC MVA s. 149). On the school run the fleet drives `schoolBuses` of
// them as traffic, stopping now and then with their reds flashing to let children off; everyone stops
// for one with its reds on, either way, and the driven car's sensing, candidates, wording and audit do
// the same.

// In free drives: two from 07:00 to before 17:00, placed 80 to 250 m from the car to begin with; one
// more than 400 m from it, driving on, leaves, and another is placed 120 to 250 m from the car 30 to
// 60 s later. One slows to its stops at up to 1.2 m/s^2.
const SCHOOL_COUNT = 2;
const SCHOOL_HOURS = [7, 17];
const SCHOOL_START_M = [80, 250];
const SCHOOL_LATER_M = [120, 250];
const SCHOOL_GONE_M = 400;
const SCHOOL_EVERY_S = [30, 60];
const SCHOOL_DECEL = 1.2;
const SCHOOL_COLOR = 0xf7b500;
// Coming up to a school bus showing its ambers (about to stop): no faster than it could stop where it
// would stop for the reds, comfortably, but at least this.
const AMBER_MIN_MPS = 4;
// Stopping for a school bus with its reds flashing: once the car, coming up behind it or toward it along
// its street (its near end, the rear or the front, within 9 m of the line the car heads along), first
// sees the reds on, it owes the stop if it could then stop short of it (5 m behind its rear, or 10 m
// short of its front coming toward it) braking at up to 3.5 m/s^2. It fails to yield if, owing it, its
// front draws level with that end of the bus at more than 1 m/s while the reds are still on. Counted
// once a stop.
const AUDIT_SCHOOL_MOVING_MPS = 1;

// Whether a long vehicle following its path through the turn out of `cur` (one of its path's edges)
// would sweep its body over a parked car: rolled on its own model from where it is to a body length
// past the corner. Its nose swings out over the parking lane beyond, wider than any corner rounding
// can take back (a school bus's front corner sweeps an 11.5 m circle).
function turnSweepsParked(world, n, cur) {
  const path = n.path,
    spec = n.spec,
    nose = spec.length - spec.rearOverhang;
  const end = Math.min(path.length, cur.sEnd + spec.length + 5);
  const parked = world.parked.near(n.x, n.y, end - path.s + spec.length);
  if (!parked.length) return false;
  const car = n.clone(),
    speed = 2.5,
    dt = 0.1;
  for (let i = 0; i < 600; i++) {
    const p = projectPoint(path.pts, path.cum, [car.x, car.y], null);
    if (p.s >= end) return false;
    if (p.s + nose > cur.sEnd && parked.some((o) => obbOverlap(car.obb(), o.obb(), 0.1))) return true;
    car.v = speed;
    car.a = 0;
    car.step(dt, { steer: purePursuit(car, path, p.s, 0), accel: 0 });
  }
  return false;
}

class SchoolBuses {
  constructor(fleet, { enabled, seed, makePath }) {
    this.fleet = fleet;
    this.world = fleet.world;
    this.map = fleet.map;
    this.makePath = makePath;
    // (their own stream, so running them leaves the rest of the traffic as it was)
    this.random = rng(seed * 32452843 + 5);
    this.count = 0;
    this.target = enabled;
    this.stops = new Map();
    this.list = [];
    for (let i = 0; i < enabled; i++) this.spawn(SCHOOL_START_M);
    this.next = this.world.t + SCHOOL_EVERY_S[0];
    this.list = this.fleet.vehicles.filter(isSchoolBus);
  }

  // Place one in the curb lane of a street `away[0]` to `away[1]` metres from the car, clear of other
  // traffic. Returns it, or null.
  spawn(away = SCHOOL_LATER_M) {
    const map = this.map,
      ego = this.world.ego,
      fleet = this.fleet;
    const lanes = (this.lanes ||= map.laneList.filter(
      (l) => l.length > 40 && !l.edgeRef.ring && l.idx === l.edgeRef.lanes - 1,
    ));
    const total = lanes.reduce((a, l) => a + l.length, 0);
    for (let attempt = 0; lanes.length && attempt < 40; attempt++) {
      let pick = this.random() * total,
        lane = lanes[0];
      for (const l of lanes) {
        pick -= l.length;
        if (pick <= 0) {
          lane = l;
          break;
        }
      }
      const s = 5 + this.random() * (lane.length - 10),
        p = pointAt(lane.pts, lane.cum, s),
        d = Math.hypot(p[0] - ego.x, p[1] - ego.y);
      if (
        d < away[0] ||
        d > away[1] ||
        fleet.vehicles.some((v) => Math.hypot(v.x - p[0], v.y - p[1]) < SCHOOL_BUS.length + 6) ||
        fleet.spawnBlocked(p[0], p[1])
      )
        continue;
      // (partway to its next stop already)
      const bus = this.add(lane, s, Math.min(8, lane.edgeRef.limit * 0.6));
      bus.school.odo = this.random() * bus.school.every;
      return bus;
    }
    return null;
  }

  // One on `lane`, its rear axle `s` along it, at `v`, driving on as traffic.
  add(lane, s, v = 0, planned = []) {
    const p = pointAt(lane.pts, lane.cum, s),
      bus = new Vehicle(p[0], p[1], headingAt(lane.pts, lane.cum, s), v, SCHOOL_BUS);
    Object.assign(bus, {
      id: `school_bus_${++this.count}`,
      kind: SCHOOL_BUS.kind,
      color: SCHOOL_COLOR,
      v0: 14,
      driver: { aMax: 1.0, b: 1.8, T: 1.6, s0: 3.0, react: 0.9, lcRate: 0 },
      stopMem: new StopMemory(),
      frozen: 0,
      waiting: 0,
    });
    bus.path = this.makePath(this.map, this.random, {});
    bus.path.start(lane.edge, lane.idx, s, planned);
    bus.school = {
      phase: "drive",
      lights: null,
      arm: false,
      doors: false,
      stop: null,
      t: 0,
      red: 0,
      held: false,
      odo: 0,
      every: this.every(),
      stops: 0,
      toDrop: 0,
      dropAt: 0,
    };
    this.fleet.vehicles.push(bus);
    this.list = this.fleet.vehicles.filter(isSchoolBus);
    return bus;
  }

  every() {
    return STOP_EVERY_M[0] + this.random() * (STOP_EVERY_M[1] - STOP_EVERY_M[0]);
  }

  // One far from the car, driving on, leaves, and another is placed when there are too few.
  manage() {
    const ego = this.world.ego,
      vehicles = this.fleet.vehicles;
    for (const n of vehicles.filter(isSchoolBus)) {
      if (n.school?.phase !== "drive" || Math.hypot(n.x - ego.x, n.y - ego.y) <= SCHOOL_GONE_M) continue;
      vehicles.splice(vehicles.indexOf(n), 1);
      this.next = Math.max(
        this.next,
        this.world.t + SCHOOL_EVERY_S[0] + this.random() * (SCHOOL_EVERY_S[1] - SCHOOL_EVERY_S[0]),
      );
    }
    if (vehicles.filter(isSchoolBus).length < this.target && this.world.t >= this.next) {
      if (!this.spawn(SCHOOL_LATER_M)) this.next = this.world.t + 5;
      else this.next = this.world.t + SCHOOL_EVERY_S[0];
    }
    this.list = vehicles.filter(isSchoolBus);
  }

  // Where along one's path its front stops for `stop` ({ edge, s }: metres along the edge's centreline),
  // or null when that street is behind it.
  stopOnPath(n, stop) {
    const pe = n.path.edges.find((e) => e.id === stop.edge && e.sEnd > n.path.s - 5);
    if (!pe) return null;
    return pe.sStart + (stop.s * (pe.sEnd - pe.sStart)) / Math.max(1, this.map.edges.get(stop.edge).length);
  }

  // The next place along one's path where it can stop (sim/school-bus.js), far enough on to slow down
  // for it gently and show its ambers first: { edge, s }, or null.
  findStop(n, front) {
    const from = front + Math.max(AMBER_M, (n.v * n.v) / (2 * SCHOOL_DECEL) + 10);
    for (const pe of n.path.edges) {
      if (pe.sEnd < from) continue;
      if (pe.sStart - front > 200) break;
      if (!this.stops.has(pe.id)) this.stops.set(pe.id, stopRange(this.map, this.map.edges.get(pe.id)));
      const e = this.map.edges.get(pe.id),
        scale = (pe.sEnd - pe.sStart) / Math.max(1, e.length);
      const at = firstStop(this.stops.get(pe.id), (from - pe.sStart) / scale);
      if (at !== null) return { edge: pe.id, s: at };
    }
    return null;
  }

  // One step of a school bus's stops (see the top of sim/school-bus.js): where it stops, as metres from
  // its front, or null.
  plan(n, front, dt) {
    const sb = n.school;
    let stopAt = null;
    if (sb.phase === "drive") {
      sb.odo += Math.max(0, n.v) * dt;
      // (looking that far ahead to stop there, ambers and all)
      const stop = sb.odo + AMBER_M >= sb.every ? this.findStop(n, front) : null;
      if (stop) Object.assign(sb, { phase: "approach", stop });
    }
    if (sb.phase === "approach") {
      const at = this.stopOnPath(n, sb.stop),
        to = at === null ? -Infinity : at - front;
      // (one it cannot make after all: look for the next)
      if (to < -3) Object.assign(sb, { phase: "drive", stop: null, lights: null, odo: sb.every });
      else {
        if (to < AMBER_M) sb.lights = "amber";
        // (the driver's standstill gap would leave it short of the stop: aim beyond by as much)
        stopAt = to + (n.driver.s0 || 0) - 1;
        if (n.v < 0.2 && to < 2.5) {
          Object.assign(sb, {
            phase: "red",
            lights: "red",
            arm: true,
            doors: true,
            t: 0,
            red: RED_S[0] + this.random() * (RED_S[1] - RED_S[0]),
            stops: sb.stops + 1,
            toDrop: KIDS[0] + Math.floor(this.random() * (KIDS[1] - KIDS[0] + 1)),
            dropAt: 1.5,
          });
        }
      }
    }
    if (sb.phase === "red") {
      stopAt = 0;
      // (held: a challenge's bus waits for the car to come up)
      if (!sb.held) sb.t += dt;
      if (sb.toDrop > 0 && sb.t >= sb.dropAt) {
        this.world.crowd.alight(n, this.map.edges.get(sb.stop.edge), this.random() < KID_CROSS_P, this.random);
        sb.toDrop--;
        sb.dropAt = sb.t + KID_EVERY_S;
      }
      // (until every child it let off is across the street; after RED_MAX_S, one still at the curb
      // crosses on a gap instead, but never with one in the street)
      const mine = this.world.crowd.list.filter((p) => p.school === n.id);
      const inStreet = mine.some((p) => p.crossing),
        toCross = sb.toDrop > 0 || mine.some((p) => p.path.some((w) => w.cross));
      if (!inStreet && ((sb.t >= sb.red && !toCross) || sb.t >= RED_MAX_S))
        Object.assign(sb, { phase: "leaving", lights: null, arm: false, doors: false, t: 0 });
    }
    if (sb.phase === "leaving") {
      stopAt = 0;
      sb.t += dt;
      if (sb.t >= LEAVE_S) Object.assign(sb, { phase: "drive", stop: null, odo: 0, every: this.every() });
    }
    n.doors = sb.doors;
    return stopAt;
  }

  // A driver stopping for a school bus with its reds flashing: where it stops, as metres from its front,
  // or null. It owes the stop if it could stop there braking at up to 3.5 m/s^2 when it first saw the
  // reds, and holds it until they go off.
  yieldTo(n, front) {
    let best = null;
    for (const bus of this.list) {
      if (bus === n || !redsOn(bus) || Math.abs(bus.x - n.x) > 110 || Math.abs(bus.y - n.y) > 110) continue;
      const h = schoolBusHold(n.path.pts, n.path.cum, front, bus);
      if (!h) continue;
      const key = `${bus.id}:${bus.school.stops}`;
      n.schoolOwed ||= {};
      if (!(key in n.schoolOwed)) {
        for (const k of Object.keys(n.schoolOwed)) if (k.startsWith(`${bus.id}:`)) delete n.schoolOwed[k];
        n.schoolOwed[key] = canStopFor(n.v, h.stop_m);
      }
      if (n.schoolOwed[key] && (best === null || h.stop_m < best)) best = h.stop_m;
    }
    return best;
  }

  // A school bus whose next turn would sweep its body over a car parked by the corner cannot make it,
  // and would stand in the junction for good (Calgary: 11 Avenue SW left into 7 Street SW). Once its lane
  // changes are done, while there is room, it goes the gentlest other way instead. True when it did.
  avoidCorner(n) {
    const world = this.world,
      path = n.path,
      cur = path.currentEdge(),
      next = path.edges[path.edges.indexOf(cur) + 1];
    const key = next && `${cur.id}:${cur.lane}:${next.id}`;
    if (!(next && n.cornerChecked !== key && cur.sEnd - path.s > 12)) return false;
    n.cornerChecked = key;
    if (!turnSweepsParked(world, n, cur)) return false;
    const lane = this.map.lane(cur.id, cur.lane),
      at = projectPoint(lane.pts, lane.cum, [n.x, n.y]).s;
    const tried = new Set([next.id]);
    let replanned = false;
    for (
      let other = this.fleet.otherWay(path, cur.id, tried);
      other;
      other = this.fleet.otherWay(path, cur.id, tried)
    ) {
      tried.add(other);
      path.start(cur.id, cur.lane, at, [[other, path.laneInto(cur.id, cur.lane, other)]]);
      path.s = projectPoint(path.pts, path.cum, [n.x, n.y]).s;
      replanned = true;
      n.cornerChecked = `${cur.id}:${cur.lane}:${other}`;
      if (!turnSweepsParked(world, n, path.currentEdge())) break;
    }
    return replanned;
  }
}

// (see AUDIT_SCHOOL_MOVING_MPS)
function auditSchoolBuses(world) {
  const ego = world.ego;
  for (const bus of world.npcs) {
    if (!redsOn(bus)) continue;
    const key = `${bus.id}:${bus.school.stops}`,
      r = schoolBusRelation(ego, bus);
    if (!r || Math.abs(r.right_m) > SIDE_M) continue;
    let rec = world.schoolCalls.get(key);
    // (decided when the car first sees the reds, still short of the bus)
    if (!rec) {
      if (r.ahead_m <= 0 || !world.visibility.sees(ego, bus)) continue;
      world.schoolCalls.set(
        key,
        (rec = {
          owed: canStopFor(ego.v, r.ahead_m - (r.relation === "behind" ? BEHIND_M : ONCOMING_M)),
          counted: false,
        }),
      );
    }
    if (rec.owed && !rec.counted && r.ahead_m <= 0 && ego.v > AUDIT_SCHOOL_MOVING_MPS) {
      rec.counted = true;
      world.violations.failed_to_yield++;
      world.events.push({ type: "failed_to_yield", to: "school bus", with: bus.id });
    }
  }
  if (world.schoolCalls.size > 20)
    for (const key of [...world.schoolCalls.keys()].slice(0, 10)) world.schoolCalls.delete(key);
}

// A school bus the car must stop for: stopped with its reds flashing on the car's route, ahead of it
// going its way or coming toward it (`relation`). The car stops with its front 5 m behind the bus's
// rear, or 10 m short of its front coming toward it (`stop_s_route`), and stays stopped while the reds
// flash. Owed when the car, first seeing the reds, could stop there braking at no more than 3.5 m/s^2;
// decided once a stop and remembered in `world.schoolYields`. With none, the nearest showing its ambers
// (about to stop: `lights` "amber"), or null.
function schoolBusStop(world, route, frontS, visibleNpcs) {
  world.schoolYields ||= new Map();
  let red = null,
    amber = null;
  for (const bus of visibleNpcs) {
    if (!isSchoolBus(bus) || !bus.school?.lights) continue;
    const h = schoolBusHold(route.pts, route.cum, frontS, bus);
    if (!h) continue;
    const out = {
      id: bus.id,
      relation: h.relation,
      lights: bus.school.lights,
      gap_m: h.gap_m,
      stop_s_route: frontS + h.stop_m,
      bumper_to_stop_m: h.stop_m,
    };
    if (bus.school.lights === "amber") {
      if (!amber || h.gap_m < amber.gap_m) amber = out;
      continue;
    }
    const key = `${bus.id}:${bus.school.stops}`;
    if (!world.schoolYields.has(key)) {
      if (world.schoolYields.size > 20) world.schoolYields.delete(world.schoolYields.keys().next().value);
      world.schoolYields.set(key, canStopFor(world.ego.v, h.stop_m));
    }
    if (world.schoolYields.get(key) && (!red || h.stop_m < red.bumper_to_stop_m)) red = out;
  }
  return red || amber;
}

export default {
  key: "schoolBuses",
  view: () => import("../../render/school-bus.js"),
  // a school bus ahead with its reds flashing, either way, that the car must stop for: say so once
  notice: {
    at: "afterCrosswalk",
    order: 0,
    duration: 2500,
    style: "safety",
    read(world, _autopilot, _views, _previous, fleet) {
      const bus = fleet?.schoolBuses?.list.find((b) => {
        const r = redsOn(b) && schoolBusRelation(world.ego, b);
        return (
          r && r.ahead_m > 0 && r.ahead_m < 70 && Math.abs(r.right_m) < SIDE_M && world.visibility.sees(world.ego, b)
        );
      });
      return bus ? { key: `${bus.id}:${bus.school.stops}`, text: "SCHOOL BUS · RED LIGHTS FLASHING · STOP" } : null;
    },
  },
  defaultCount: SCHOOL_COUNT,
  // (two on the school run, from 07:00 to before 17:00)
  freeDrive: (on, { hour }) => (on && hour >= SCHOOL_HOURS[0] && hour < SCHOOL_HOURS[1] ? SCHOOL_COUNT : 0),
  property: "schoolYields",
  build: () => new Map(),
  calls: "schoolCalls",
  buildFleet: (fleet, options) => new SchoolBuses(fleet, options),
  snapshot: { school_bus: null },
  // (long, so looked for all along its body; heavy, it stops for any body in its way just ahead, except
  // beside it short of its front, and keeps under the limit; it keeps its own way, and never parks)
  obstacle: {
    test: isSchoolBus,
    traffic: true,
    long: true,
    heavy: true,
    noseFirst: true,
    noParking: () => true,
    pathPolicy: () => false,
  },
  motion: (snap) => !!snap.school_bus,
  flagText: { passes_stopped_school_bus: "it passes a school bus with its red lights flashing" },

  trafficManage: {
    at: "schoolBuses",
    run(_world, fleet) {
      const buses = fleet.schoolBuses;
      if (buses.list.length || buses.target) buses.manage();
    },
  },
  trafficReplan: {
    at: "corner",
    run: (_world, n, fleet) => !!(n.school && !n.lc && fleet.schoolBuses.avoidCorner(n)),
  },
  // A school bus slowing to a stop, standing there with its reds flashing, and moving off.
  trafficStop: (_world, fleet, n, front, dt) => (n.school ? fleet.schoolBuses.plan(n, front, dt) : null),
  // Stopping for a school bus with its reds flashing.
  trafficHold: {
    at: "buses",
    run: (_world, fleet, n, front) =>
      fleet.schoolBuses.list.length && !isEmergency(n) ? fleet.schoolBuses.yieldTo(n, front) : null,
  },
  checkpoint(world, fleet) {
    if (!fleet.schoolBuses) return;
    fleet.schoolBuses.world = world;
    fleet.schoolBuses.fleet = fleet;
  },

  audit: { at: "buses", run: auditSchoolBuses },
  resetContact: (world) => world.schoolYields?.clear(),

  sense: {
    at: "afterCrosswalk",
    run(world, snap, { route, frontS, visibleNpcs }) {
      snap.school_bus = schoolBusStop(world, route, frontS, visibleNpcs);
    },
  },
  // A school bus with its reds flashing: stop short of it; with its ambers, slow down, ready to.
  target: {
    at: "afterCrosswalk",
    run(snap, v, reasons, { decel, stopSpeedFor }) {
      const sb = snap.school_bus;
      if (sb && (sb.lights === "red" || sb.bumper_to_stop_m > 0)) {
        const room = sb.bumper_to_stop_m;
        const vs =
          sb.lights === "red"
            ? room < 1.0
              ? 0
              : stopSpeedFor(room - 0.5, decel)
            : Math.max(AMBER_MIN_MPS, stopSpeedFor(room, decel));
        if (vs < v) {
          v = vs;
          reasons.push(sb.lights === "red" ? "school bus stopped, red lights flashing" : "school bus about to stop");
        }
      }
      return v;
    },
  },
  hazard: { at: "afterCrosswalk", run: (snap) => (snap.school_bus ? "school bus" : null) },

  // A school bus with its reds flashing, ahead or coming toward the car: stop short of it, and stay
  // stopped while they flash.
  candidates: {
    at: "afterCrosswalk",
    run({ snap, laneUntil, inLane, approach, stopAt, FRONT }, out) {
      const school = snap.school_bus;
      if (school && school.lights === "red" && school.bumper_to_stop_m > 0.3) {
        out.push({
          id: "stop_for_school_bus",
          laneUntil,
          law: inLane({ kind: "lane", vTarget: approach, stopAtRoute: stopAt(school.stop_s_route - FRONT) }),
          steer: "hold lane",
          speed:
            school.relation === "behind"
              ? "stop behind the school bus"
              : "stop short of the school bus coming the other way",
        });
      }
    },
  },
  // (1.5 m past where it stops is still well short of the bus)
  sim: {
    at: "afterCrosswalk",
    run(_world, snap) {
      const schoolStop = snap.school_bus?.lights === "red" ? snap.school_bus.stop_s_route : null;
      if (schoolStop === null) return null;
      let passes = false;
      return {
        start() {
          passes = false;
        },
        along(s, front) {
          if (s + front > schoolStop + 1.5) passes = true;
        },
        reject: (c) => (passes && c.law.kind !== "hard_brake" ? "passes_stopped_school_bus" : null),
      };
    },
  },
  rulesWait: (c) => c.id === "stop_for_school_bus",
  legitimateStop: (snap) => !!(snap && snap.school_bus?.lights === "red" && snap.school_bus.bumper_to_stop_m < 8),

  state: {
    at: "afterCrosswalk",
    run(snap, state) {
      if (!snap.school_bus) return;
      const b = snap.school_bus;
      state.school_bus = {
        id: b.id,
        coming_toward_car: b.relation === "oncoming",
        lights: b.lights,
        gap_m: r1(Math.max(0, b.gap_m)),
        ...(b.lights === "red"
          ? { stop: true, wait_in_m: r1(Math.max(0, b.bumper_to_stop_m)) }
          : { about_to_stop: true }),
      };
    },
  },
  outcome: {
    at: "ids",
    run: (c, snap) =>
      c.id === "stop_for_school_bus" && snap.school_bus
        ? `clear, stops ${Math.max(0, r1(snap.school_bus.bumper_to_stop_m - c.sim.progress_m))} m short of the school bus`
        : null,
  },
  clause: {
    at: "afterCrosswalk",
    run(snap) {
      if (!snap.school_bus) return null;
      const b = snap.school_bus,
        w = Math.max(0, Math.round(b.bumper_to_stop_m)),
        where =
          b.relation === "behind"
            ? `${Math.round(Math.max(0, b.gap_m))} m ahead, going the car's way`
            : `${Math.round(Math.max(0, b.gap_m))} m ahead, coming toward the car`;
      return b.lights === "red"
        ? `School bus \`${b.id}\`, ${where}, is stopped with its red lights flashing, letting children off; they may cross in front of it, hidden by it. Traffic both ways must stop for it and stay stopped until it moves off or the lights go off: ${w < 2 ? "hold still where the car is." : `slow down and stop ${w} m ahead, short of it (\`stop_for_school_bus\`).`}`
        : `School bus \`${b.id}\`, ${where}, has its amber lights flashing: it is about to stop and let children off, and traffic both ways will have to stop for it. Slow down, ready to stop short of it; \`car.target_speed\` already does.`;
    },
  },
  holdStill: {
    at: "afterCrosswalk",
    run: (snap) =>
      snap.school_bus?.lights === "red"
        ? ", when a school bus with its red lights flashing is ahead and the car has stopped short of it (`school_bus.wait_in_m` under 2)"
        : "",
  },
  prompt: {
    at: "schoolBuses",
    text: "- Choose `stop_for_school_bus` when `situation` says a school bus ahead, going either way, is stopped with its red lights flashing, and keep the car stopped until they go off.",
  },
};
