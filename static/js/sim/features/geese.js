// Canada geese crossing the road (sim/geese.js) as a feature record (sim/features/index.js,
// docs/feature-interface.md).
import { r1 } from "../../common.js";
import { Geese, auditGeese, geeseCrossing, geeseYield, isGoose } from "../geese.js";

// What a gaggle is doing, for models.
const GEESE_PHASE = {
  about_to_cross: "on the grass by the road, walking up to the kerb",
  crossing: "crossing the road in single file",
  stopped_in_road: "crossing the road in single file, one or more standing still in it",
};

// Canada geese by the road ahead, or crossing it, for models.
function geeseClause(g) {
  const w = Math.max(0, Math.round(g.bumper_to_stop_m ?? 0));
  const who = `${g.geese} Canada geese${g.goslings ? `, ${g.goslings} of them goslings,` : ""}`;
  const lead = `A gaggle of ${who} ${Math.round(g.gap_m)} m ahead, coming from the ${g.from}, is ${GEESE_PHASE[g.phase]}${g.on_road ? ` (${g.on_road} on the road${g.stopped_on_road ? `, ${g.stopped_on_road} standing still` : ""})` : ""}.`;
  if (g.wait)
    return `${lead} Stop short of their way across and wait until the last goose is off the road, on the far side, however long they take: never drive through a gap between geese, and never creep toward the file. ${w < 2 ? "Hold still until the last goose is off the road." : `Slow down and stop ${w} m ahead (\`wait_for_geese\`).`}`;
  if (g.phase === "about_to_cross")
    return `${lead} They may step into the road at any moment: slow to ${r1(g.limit_mps)} m/s, ready to stop for them (\`car.target_speed\` already does).`;
  return `${lead} The car is already at their way across: keep to ${r1(g.limit_mps)} m/s and keep clear of them.`;
}

export default {
  key: "geese",
  seen: "geeseSeen",
  calls: "geeseCalls",
  build: (world, { enabled, seed }) => new Geese(world, { enabled, seed }),
  metric: {
    at: "streetHazards",
    name: "wildlife_conflicts",
    failure: "drove into or too close to geese crossing the road",
  },
  // (waited for as a gaggle, never followed or passed; the car is at fault for one it drives into, as for
  // a pedestrian)
  obstacle: { test: isGoose, likePedestrian: true },
  motion: (snap) => !!snap.geese_crossing?.wait,

  obstacles(world, x, y, r) {
    return world.geese?.gaggles.length ? world.geese.near(x, y, r) : null;
  },
  stepAfterTraffic(world, _fleet, dt) {
    if (world.geese?.enabled) world.geese.step(dt);
  },
  audit: {
    at: "streetHazards",
    run(world) {
      if (world.geese.enabled) auditGeese(world);
    },
  },

  sense: {
    at: "streetHazards",
    run(world, snap, { p, frontS, lane }) {
      if (world.geese?.enabled)
        snap.geese_crossing = world.geese.gaggles.length ? geeseCrossing(world, p, frontS, lane) : null;
    },
  },
  // (coming up to geese by the road, or crossing it)
  limit: {
    at: "streetHazards",
    run(snap) {
      if (snap.geese_crossing?.limit_mps != null) snap.limit = Math.min(snap.limit, snap.geese_crossing.limit_mps);
    },
  },
  // Stop short of them until the last is off the road.
  target: {
    at: "streetHazards",
    run(snap, v, reasons, { decel, stopSpeedFor }) {
      const gc = snap.geese_crossing;
      if (gc?.wait) {
        const vg = gc.bumper_to_stop_m < 1.0 ? 0 : stopSpeedFor(gc.bumper_to_stop_m - 0.5, decel);
        if (vg < v) {
          v = vg;
          reasons.push("geese crossing");
        }
      } else if (gc?.limit_mps != null && gc.limit_mps <= v + 0.05) reasons.push("geese by the road");
      return v;
    },
  },
  hazard: { at: "streetHazards", run: (snap) => (snap.geese_crossing ? "geese" : null) },

  // Slow while they come up to the kerb, and stop short of their way across, waiting until the last is
  // off the road, once they cross.
  candidates: {
    at: "streetHazards",
    run({ snap, laneUntil, inLane, approach, stopAt, FRONT }, out) {
      const gc = snap.geese_crossing;
      if (gc && (!gc.wait || gc.bumper_to_stop_m > 0.3)) {
        out.push({
          id: "wait_for_geese",
          laneUntil,
          law: inLane({
            kind: "lane",
            vTarget: Math.min(approach, gc.limit_mps ?? approach),
            ...(gc.wait ? { stopAtRoute: stopAt(gc.stop_s_route - FRONT - 0.5) } : {}),
          }),
          steer: "hold lane",
          speed: gc.wait
            ? "stop and wait until the last goose is off the road"
            : "slow down, ready to stop for the geese",
        });
      }
    },
  },
  // Where the car stops for them: a metre past it is still short of their way.
  sim: {
    at: "streetHazards",
    run(_world, snap) {
      const geeseStop = snap.geese_crossing?.wait ? snap.geese_crossing.stop_s_route : null;
      if (geeseStop === null) return null;
      let into = false;
      return {
        start() {
          into = false;
        },
        along(s, front) {
          if (s + front > geeseStop + 1) into = true;
        },
        reject: (c) => (into && c.law.kind !== "hard_brake" ? "drives_into_geese" : null),
      };
    },
  },

  state: {
    at: "streetHazards",
    run(snap, state) {
      if (snap.geese_crossing) {
        const g = snap.geese_crossing;
        state.geese_crossing = {
          id: g.id,
          geese: g.geese,
          ...(g.goslings ? { goslings: g.goslings } : {}),
          coming_from: g.from,
          now: GEESE_PHASE[g.phase],
          on_road: g.on_road,
          ...(g.stopped_on_road ? { standing_in_road: g.stopped_on_road } : {}),
          gap_m: r1(g.gap_m),
          ...(g.wait ? { wait: true, wait_in_m: r1(Math.max(0, g.bumper_to_stop_m)) } : {}),
          slow_to: r1(g.limit_mps),
        };
      }
    },
  },
  outcome: {
    at: "ids",
    run(c, snap) {
      if (c.id === "wait_for_geese" && snap.geese_crossing)
        return snap.geese_crossing.wait
          ? `clear, stops ${Math.max(0, r1(snap.geese_crossing.bumper_to_stop_m - c.sim.progress_m))} m short of the geese's way across`
          : "clear, slows for the geese by the road";
      return null;
    },
  },
  clause: { at: "ice", run: (snap) => (snap.geese_crossing ? geeseClause(snap.geese_crossing) : null) },
  holdStill: {
    at: "driveways",
    run: (snap) =>
      snap.geese_crossing?.wait
        ? ", when Canada geese are crossing the road ahead (`geese_crossing.wait` true) and the car has reached the point where it stops for them (`geese_crossing.wait_in_m` under 2), until the last goose is off the road"
        : "",
  },
  prompt: {
    at: "snowbanks",
    text: `- Canada geese cross the road by parks and water (\`geese_crossing\`). While a gaggle walks up to the kerb, slow to \`geese_crossing.slow_to\`, ready to stop. Choose \`wait_for_geese\` when \`geese_crossing.wait\` is true: they are crossing, so stop short of their way across and keep the car stopped until the last goose is off the road, even when the geese ahead of the car's lane have crossed or one stands still in the road. Never drive through a gap between geese, and never creep toward the file.`,
  },

  // Traffic and cyclists: slow while a gaggle comes up to the kerb ahead and stop short of their way
  // across until the last is off the roadway (once it could stop there: otherwise it carries on).
  trafficYield(world, n, front) {
    const gs = world.geese?.gaggles.length ? geeseYield(world, n, front) : null;
    return gs ? { hold: gs.hold, limit: gs.limit, canStop: true } : null;
  },
};
