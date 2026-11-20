// Spring potholes (sim/potholes.js) as a feature record (sim/features/index.js, docs/feature-interface.md).
import { r1 } from "../../common.js";
import { current as weather } from "../weather.js";
import {
  NPC_SHIFT_MPS,
  Potholes,
  SIM_OVER_MPS,
  SIM_PAD_M,
  auditPotholes,
  crossesPothole,
  npcPothole,
  potholeLimit,
  potholesAhead,
  safeSpeed,
  wheelPoints,
  wheelsCross,
} from "../potholes.js";

// A pothole in the car's lane ahead, for models.
function potholeClause(h, ahead) {
  const where = h.starts_in_m > 0 ? `${Math.round(h.starts_in_m)} m ahead` : "under the car";
  const side =
    Math.abs(h.lateral_m) < 0.25
      ? "in the middle of the car's lane"
      : `${r1(Math.abs(h.lateral_m))} m ${h.lateral_m < 0 ? "left" : "right"} of the middle of the car's lane`;
  const water =
    weather.name === "rain" || weather.name === "snow" ? " It is full of water, so it looks like any puddle." : "";
  const lead = `A pothole \`${h.id}\` ${where}, ${side}, is ${h.width_m} m wide and about ${h.depth_cm} cm deep.${water}`;
  const more =
    ahead?.length > 1 ? ` ${ahead.length - 1} more ${ahead.length > 2 ? "are" : "is"} further along the lane.` : "";
  if (h.room && !h.shift_m)
    return `${lead} It lies between the car's wheels: keep to the middle of the lane and drive on.${more}`;
  if (h.room)
    return `${lead} There is room to go round it inside the lane: choose \`ease_round_pothole\` to ease ${r1(Math.abs(h.shift_m))} m ${h.shift_m < 0 ? "left" : "right"} so that both wheels miss it, keeping its speed, then back to the middle. Never cross a lane line to go round a pothole.${more}`;
  const kmh = Math.round(h.speed_mps * 3.6);
  return `${lead} There is no room to go round it without leaving the lane, so the car must drive over it: slow to ${kmh} km/h by the time the front wheels reach it and keep to that until the rear wheels are over it (\`car.target_speed\` already does). Taken faster, it can burst a tyre or bend a wheel. Never cross a lane line to go round it.${more}`;
}

export default {
  key: "potholes",
  seen: "potholesSeen",
  calls: "potholeCalls",
  build: (_world, { enabled, seed, map }) => new Potholes(map, { enabled, seed }),
  metric: { at: "driveways", name: "pothole_hits", failure: "hit a pothole too fast" },
  priority: ["ease_round_pothole"],

  audit: {
    at: "driveways",
    run(world) {
      if (world.potholes.enabled) auditPotholes(world);
    },
  },

  // The car's sensing: the pothole in its lane ahead it eases round or slows for, and the others.
  sense: {
    at: "driveways",
    run(world, snap, { p, frontS, lane, road }) {
      if (world.potholes?.enabled) {
        const ph = potholesAhead(world, p, frontS, lane, road.limit);
        snap.pothole = ph?.pothole || null;
        snap.potholes_ahead = ph?.ahead || null;
      }
    },
  },
  // (coming up to a pothole it cannot ease round in its lane, and over it)
  limit: {
    at: "driveways",
    run(snap) {
      if (snap.potholes_ahead && snap.routeProj)
        for (const h of snap.potholes_ahead)
          if (!h.room) snap.limit = Math.min(snap.limit, potholeLimit(h, snap.routeProj.s));
    },
  },
  // (`limit` is already down to the speed to drive over it at)
  target: {
    at: "driveways",
    run(snap, v, reasons) {
      const slowFor = snap.potholes_ahead?.find((h) => !h.room);
      if (slowFor && snap.routeProj && potholeLimit(slowFor, snap.routeProj.s) * Math.min(1, weather.speed) <= v + 0.05)
        reasons.push(slowFor.starts_in_m < 0 ? "over a pothole" : "pothole ahead: no room to go round");
      return v;
    },
  },
  hazard: { at: "driveways", run: (snap) => (snap.pothole ? "pothole" : null) },

  // Over inside the lane, both wheel paths clear of it, and back, keeping its speed.
  candidates: {
    at: "driveways",
    run({ snap, laneUntil, inLane, target, v, limit, shifting, detour, passing, speedLabel }, out) {
      const ph = snap.pothole;
      if (ph?.room && ph.detour && !shifting && !detour.detour && !passing.detour) {
        out.push({
          id: "ease_round_pothole",
          laneUntil,
          law: { ...inLane({ kind: "lane", vTarget: target }), detour: ph.detour },
          steer: `ease ${Math.abs(ph.shift_m).toFixed(1)} m ${ph.shift_m < 0 ? "left" : "right"} within the lane, round the pothole, and back`,
          speed: speedLabel(target, v, limit),
        });
      }
    },
  },
  // Every lane manoeuvre whose wheels would cross a pothole ahead slows to the speed to drive over it at, by then.
  adjust: {
    at: "balls",
    run({ snap, world, s, lateralAt }, list) {
      if (snap.potholes_ahead && snap.route && snap.routeProj) {
        for (const c of list) {
          if (c.law.kind !== "lane") continue;
          const law = { ...c.law, s0: c.law.s0 ?? s };
          const slow = snap.potholes_ahead
            .filter((h) => wheelsCross(lateralAt(law, h.s_route, snap.route), h.lateral_route, h, world.ego.spec, 0.05))
            .map((h) => h.slow);
          if (slow.length) c.law.slowTo = slow;
        }
      }
    },
  },
  // Easing round a pothole, it carries on round it while it brakes hard.
  brakeDetour: ({ snap, shifting, detour, passing, s }) =>
    snap.pothole?.room &&
    snap.pothole.detour &&
    !shifting &&
    !detour.detour &&
    !passing.detour &&
    s >= snap.pothole.detour.from
      ? { detour: snap.pothole.detour }
      : null,
  // The potholes the car's front wheels have still to reach: no manoeuvre may put a wheel into one faster
  // than its safe speed.
  sim: {
    at: "driveways",
    run(world) {
      const egoC = Math.cos(world.ego.psi),
        egoS = Math.sin(world.ego.psi),
        wb = world.ego.spec.wheelbase;
      const holes = world.potholes?.list.length
        ? world.potholes
            .near(world.ego.x, world.ego.y, 60)
            .filter((h) => (h.x - world.ego.x) * egoC + (h.y - world.ego.y) * egoS - wb > -h.a + 0.05)
        : null;
      if (!holes?.length) return null;
      let fast = false;
      return {
        wheels: true,
        start() {
          fast = false;
        },
        afterLaw(car, wheelsBefore) {
          if (!wheelsBefore || fast) return;
          const wheelsAfter = wheelPoints(car);
          for (const h of holes)
            if (
              car.v > safeSpeed(h) + SIM_OVER_MPS &&
              wheelsAfter.some(([x, y], i) =>
                crossesPothole(h, wheelsBefore[i][0], wheelsBefore[i][1], x, y, SIM_PAD_M),
              )
            ) {
              fast = true;
              break;
            }
        },
        reject: (c) => (fast && c.law.kind !== "hard_brake" ? "hits_pothole_too_fast" : null),
      };
    },
  },

  state: {
    at: "driveways",
    run(snap, state) {
      if (snap.pothole) {
        const h = snap.pothole;
        state.pothole = {
          id: h.id,
          ...(h.starts_in_m > 0 ? { ahead_m: r1(h.starts_in_m) } : { under_car: true }),
          right_of_lane_centre_m: r1(h.lateral_m),
          length_m: h.length_m,
          width_m: h.width_m,
          depth_cm: h.depth_cm,
          ...(weather.name === "rain" || weather.name === "snow" ? { full_of_water: true } : {}),
          ...(h.room
            ? { room_in_lane: true, ...(h.shift_m ? { ease_to_m: r1(h.shift_m) } : { between_the_wheels: true }) }
            : { room_in_lane: false, drive_over_at: r1(h.speed_mps) }),
          ...(snap.potholes_ahead.length > 1 ? { more_ahead: snap.potholes_ahead.length - 1 } : {}),
        };
      }
    },
  },
  outcome: {
    at: "ids",
    run(c, snap) {
      if (c.id === "ease_round_pothole" && snap.pothole)
        return `clear, eases ${Math.abs(r1(snap.pothole.shift_m))} m ${snap.pothole.shift_m < 0 ? "left" : "right"} inside the lane so that both wheels miss the pothole, keeping its speed, and back`;
      return null;
    },
  },
  // (its wheels would cross a pothole: it slows to drive over it)
  slowOutcome: {
    at: "lane",
    run(c, snap) {
      if (c.law.slowTo && snap.pothole)
        return `clear, slows to ${r1(Math.min(...c.law.slowTo.map((x) => x.mps)))} m/s to drive over the pothole`;
      return null;
    },
  },
  clause: { at: "driveways", run: (snap) => (snap.pothole ? potholeClause(snap.pothole, snap.potholes_ahead) : null) },
  prompt: {
    at: "driveways",
    text: `- Watch for potholes in the car's lane (\`pothole\`). When \`pothole.room_in_lane\` is true and \`ease_to_m\` is given, choose \`ease_round_pothole\`: it moves over inside the lane so that both wheels miss it, without slowing. When \`room_in_lane\` is false, the car must drive over it: prefer a candidate whose \`end_speed\` is at or below \`car.target_speed\`, which slows to \`pothole.drive_over_at\` by the time the wheels reach it. Never cross a lane line into oncoming or occupied traffic to go round a pothole. In rain or snow a pothole full of water looks like any puddle.`,
  },

  // Traffic: ease over inside the lane where that takes both wheels clear of it (not while changing lanes
  // or going round something: `busy`), and otherwise slow to drive over it.
  trafficLane: {
    at: "contraflow",
    run(world, n, front, busy, dt) {
      const ph =
        world.potholes?.list.length && n.kind !== "bike" && !n.transit?.tram ? npcPothole(world, n, front) : null;
      if (!(ph || n.phShift)) return { result: ph, shift: undefined, aim: 0, now: n.phShift || 0, easing: false };
      const to = ph && !busy ? ph.shift : 0;
      n.phShift = (n.phShift || 0) + Math.max(-NPC_SHIFT_MPS * dt, Math.min(NPC_SHIFT_MPS * dt, to - (n.phShift || 0)));
      // (where it is heading in the lane: round the pothole, unless changing lanes)
      return {
        result: ph,
        shift: n.phShift,
        aim: ph && !n.lc ? ph.shift : 0,
        now: n.phShift || 0,
        easing: !!ph?.shift,
      };
    },
  },
};
