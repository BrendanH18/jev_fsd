// Puddles at the kerb (sim/puddles.js) as a feature record (sim/features/index.js, docs/feature-interface.md).
import { puddleNotice } from "../puddles.js";
import { r1 } from "../../common.js";
import { current as weather } from "../weather.js";
import { wheelPoints } from "../potholes.js";
import {
  NPC_SHIFT_MPS,
  Puddles,
  auditPuddles,
  lawSlows,
  npcPuddle,
  puddleLimit,
  puddlesAhead,
  simSplashes,
  splashTargets,
} from "../puddles.js";

// A puddle in the car's lane ahead with someone within splash reach of it, for models.
function puddleClause(h, ahead) {
  const where = h.starts_in_m > 0 ? `${Math.round(h.starts_in_m)} m ahead` : "under the car";
  const what = h.kind === "pothole" ? `A pothole full of rain water \`${h.id}\`` : `A puddle \`${h.id}\` by the kerb`;
  const who = h.people === 1 ? "Someone is" : `${h.people} people are`;
  const lead = `${what} ${where}, ${h.width_m} m wide and about ${h.depth_cm} cm deep, reaches ${r1(Math.abs(h.lateral_m))} m ${h.lateral_m < 0 ? "left" : "right"} of the middle of the car's lane. ${who} on the sidewalk or at the kerb beside it: a wheel through it faster than ${Math.round(h.splash_mps * 3.6)} km/h throws water over them, which is careless driving.`;
  const more =
    ahead?.length > 1
      ? ` ${ahead.length - 1} more with people near ${ahead.length > 2 ? "are" : "is"} further along the lane.`
      : "";
  if (h.room && !h.shift_m)
    return `${lead} The car's wheels miss it in the middle of the lane: keep to the middle and drive on.${more}`;
  if (h.room)
    return `${lead} There is room to keep the wheels out of it inside the lane: choose \`ease_round_puddle\` to ease ${r1(Math.abs(h.shift_m))} m ${h.shift_m < 0 ? "left" : "right"}, keeping its speed, then back to the middle. Never cross a lane line to avoid a puddle.${more}`;
  return `${lead} There is no room to keep the wheels out of it without leaving the lane, so slow to ${Math.round(h.speed_mps * 3.6)} km/h by the time the front wheels reach it and keep to that until the rear wheels are through (\`car.target_speed\` already does).${more}`;
}

const PUDDLE_COACH =
  "Puddle by the kerb, people beside it. Ease left in your lane, or slow right down, so you don’t splash them.";

export default {
  checkpointShare(world, shared) {
    if (world.puddles?.enabled) shared.add(world.puddles);
  },
  rulesCost: (c, snap) => (c.id === "ease_round_puddle" && snap.puddle_splash?.room ? -1.5 : 0),
  cautious: {
    at: "afterAmber",
    run: (snap, eligible, target) =>
      snap.puddle_splash?.room
        ? eligible.find((c) => c.id === "ease_round_puddle" && Math.abs(c.sim.end_speed - target) < 1.5)
        : null,
  },
  key: "puddles",
  coach: {
    init: () => ({
      puddles: false,
      splashes: 0,
    }),
    seen: "puddles",
    events: {
      pedestrian_splashed(score, ev) {
        score.splashes++;
        score.incident("pedestrian_splashed", `Splashed a pedestrian from a puddle at ${Math.round(ev.kmh)} km/h`, {
          puddle: ev.puddle,
          person: ev.person,
          kmh: ev.kmh,
          splash_kmh: ev.splash_kmh,
        });
      },
    },
    reports: [
      { at: "end", order: 16, read: (score) => (score.puddles ? { pedestrians_splashed: score.splashes } : {}) },
    ],
    deductions: [{ at: "post", order: 1, counter: "splashes", weight: 20, category: "legality" }],
    tips: [
      {
        at: "afterMerge",
        order: 5,
        when: (score) => score.splashes,
        text: "In the rain, watch for puddles by the kerb, at corners and over drains, and for people on the sidewalk or waiting at a bus stop beside them. Where your lane leaves room, ease left inside it so your wheels miss the puddle; where it doesn't, slow right down, below about 20 km/h, until you're through. Splashing someone is careless driving.",
      },
    ],
    guidance: [
      {
        at: "beforeSample",
        order: 1,
        read: (score, { world, normal }) => (normal && score.lastTtc >= 1.5 && world.puddleWarn ? PUDDLE_COACH : ""),
      },
      { at: "afterSample", order: 1, read: (_score, { world }) => (world.puddleWarn ? PUDDLE_COACH : "") },
    ],
  },
  notice: {
    at: "beforeLeftOnRed",
    order: 10,
    duration: 2500,
    read: (world, autopilot, views) =>
      views.puddles ? puddleNotice(world, autopilot.enabled ? autopilot.snap : null) : null,
    style: (line) => (line.slow ? "safety" : ""),
  },
  eventBadges: {
    pedestrian_splashed: (event) => `SPLASHED A PEDESTRIAN AT ${Math.round(event.kmh)} KM/H`,
  },
  perceptionLine(snap) {
    const pd = snap.puddle_splash;
    const text = pd
      ? `Puddle by the kerb ${pd.starts_in_m > 0 ? `${Math.round(pd.starts_in_m)} m ahead` : "under the car"}, ${pd.people === 1 ? "someone" : `${pd.people} people`} beside it: ${pd.room ? (pd.shift_m ? `ease ${Math.abs(pd.shift_m).toFixed(1)} m ${pd.shift_m < 0 ? "left" : "right"} in the lane` : "the wheels miss it") : `${Math.round(pd.speed_mps * 3.6)} km/h through it`}`
      : null;
    return text ? { order: 23, label: "Puddle", text } : null;
  },
  perceptionRejections: {
    splashes_pedestrian: "Puddle: would splash someone",
  },
  seen: "puddlesSeen",
  calls: "puddleCalls",
  // where they stand, whether it has rained this drive (they lie on until it snows), and who the car is
  // splashing now (the coach's warning)
  build(world, { enabled, seed, map }) {
    const puddles = new Puddles(map, { enabled, seed });
    world.puddlesRained = puddles.enabled && world.weather === "rain";
    world.puddleWarn = null;
    return puddles;
  },
  metric: {
    at: "rearTraffic",
    name: "pedestrians_splashed",
    failure: "splashed a pedestrian from a puddle",
    label: "Splashed a pedestrian from a puddle at the kerb",
    category: "speed",
  },
  priority: ["ease_round_puddle"],

  audit: {
    at: "rearTraffic",
    run(world) {
      if (world.puddles?.enabled) auditPuddles(world);
    },
  },

  // The car's sensing: puddles at the kerb with someone within splash reach, while they lie.
  sense: {
    at: "streetHazards",
    run(world, snap, { p, frontS, lane, road, visible }) {
      if (world.puddles?.enabled) {
        const pd = puddlesAhead(world, p, frontS, lane, road.limit, visible);
        snap.puddle_splash = pd?.puddle || null;
        snap.puddles_ahead = pd?.ahead || null;
      }
    },
  },
  // (coming up to a puddle with someone near it that it cannot ease round in its lane, and through it)
  limit: {
    at: "driveways",
    run(snap) {
      if (snap.puddles_ahead && snap.routeProj)
        for (const h of snap.puddles_ahead)
          if (!h.room) snap.limit = Math.min(snap.limit, puddleLimit(h, snap.routeProj.s));
    },
  },
  // (`limit` is already below its splash speed)
  target: {
    at: "driveways",
    run(snap, v, reasons) {
      const splashFor = snap.puddles_ahead?.find((h) => !h.room);
      if (
        splashFor &&
        snap.routeProj &&
        puddleLimit(splashFor, snap.routeProj.s) * Math.min(1, weather.speed) <= v + 0.05
      )
        reasons.push("puddle by the kerb: people on the sidewalk");
      return v;
    },
  },
  hazard: { at: "late", run: (snap) => (snap.puddle_splash ? "puddle by the kerb" : null) },

  // Over to the left inside the lane, the right wheels clear of it, and back, keeping its speed.
  candidates: {
    at: "driveways",
    run({ snap, laneUntil, inLane, target, v, limit, shifting, detour, passing, speedLabel }, out) {
      const pd = snap.puddle_splash;
      if (pd?.room && pd.detour && !shifting && !detour.detour && !passing.detour) {
        out.push({
          id: "ease_round_puddle",
          laneUntil,
          law: { ...inLane({ kind: "lane", vTarget: target }), detour: pd.detour },
          steer: `ease ${Math.abs(pd.shift_m).toFixed(1)} m ${pd.shift_m < 0 ? "left" : "right"} within the lane, the wheels clear of the puddle, and back`,
          speed: speedLabel(target, v, limit),
        });
      }
    },
  },
  // Every lane manoeuvre whose wheels would go through a puddle with someone near it slows below its
  // splash speed, by then.
  adjust: {
    at: "streetHazards",
    run({ snap, world, s, lateralAt }, list) {
      if (snap.puddles_ahead && snap.route && snap.routeProj) {
        for (const c of list) {
          if (c.law.kind !== "lane") continue;
          const law = { ...c.law, s0: c.law.s0 ?? s };
          const slow = lawSlows(snap.puddles_ahead, (at) => lateralAt(law, at, snap.route), world.ego.spec);
          if (slow.length) c.law.slowTo = [...(c.law.slowTo || []), ...slow];
        }
      }
    },
  },
  // No manoeuvre may put a wheel through one faster than its splash speed, unless none can help it: a
  // splash no manoeuvre can help, someone stepping up to the kerb too late for the car to slow, is no
  // reason to brake hard, so those it would have rejected stay eligible.
  sim: {
    at: "end",
    run(world, snap) {
      const splashAt = splashTargets(world, snap.puddles_ahead);
      if (!splashAt) return null;
      let splashes = false;
      return {
        wheels: true,
        start() {
          splashes = false;
        },
        afterLaw(car, wheelsBefore) {
          if (wheelsBefore && !splashes) splashes = simSplashes(splashAt, wheelsBefore, wheelPoints(car), car.v);
        },
        reject: (c) => (splashes && c.law.kind !== "hard_brake" ? "splashes_pedestrian" : null),
        settle(candidates) {
          if (!candidates.some((c) => !c.reject && c.law.kind !== "hard_brake"))
            for (const c of candidates)
              if (c.reject === "splashes_pedestrian") {
                c.reject = null;
                c.eligible = true;
              }
        },
      };
    },
  },

  state: {
    at: "driveways",
    run(snap, state) {
      if (snap.puddle_splash) {
        const h = snap.puddle_splash;
        state.puddle = {
          id: h.id,
          ...(h.starts_in_m > 0 ? { ahead_m: r1(h.starts_in_m) } : { under_car: true }),
          ...(h.kind === "pothole" ? { pothole_full_of_water: true } : { by_the_kerb: true }),
          right_of_lane_centre_m: r1(h.lateral_m),
          width_m: h.width_m,
          depth_cm: h.depth_cm,
          people_within_splash_reach: h.people,
          splash_speed: r1(h.splash_mps),
          ...(h.room
            ? { room_in_lane: true, ...(h.shift_m ? { ease_to_m: r1(h.shift_m) } : { wheels_miss_it: true }) }
            : { room_in_lane: false, go_through_at: r1(h.speed_mps) }),
          ...(snap.puddles_ahead.length > 1 ? { more_ahead: snap.puddles_ahead.length - 1 } : {}),
        };
      }
    },
  },
  outcome: {
    at: "ids",
    run(c, snap) {
      if (c.id === "ease_round_puddle" && snap.puddle_splash)
        return `clear, eases ${Math.abs(r1(snap.puddle_splash.shift_m))} m ${snap.puddle_splash.shift_m < 0 ? "left" : "right"} inside the lane so that its wheels miss the puddle by the kerb, keeping its speed, and back`;
      return null;
    },
  },
  // (its wheels would go through a puddle with someone near it: it slows below its splash speed)
  slowOutcome: {
    at: "lane",
    run(c, snap) {
      if (c.law.slowTo && snap.puddle_splash)
        return `clear, slows to ${r1(Math.min(...c.law.slowTo.map((x) => x.mps)))} m/s to go through the puddle without splashing anyone`;
      return null;
    },
  },
  clause: {
    at: "driveways",
    run: (snap) => (snap.puddle_splash ? puddleClause(snap.puddle_splash, snap.puddles_ahead) : null),
  },
  prompt: {
    at: "snowbanks",
    text: `- In the rain, watch for puddles by the kerb with people beside them (\`puddle\`). Never splash a pedestrian. When \`puddle.room_in_lane\` is true and \`ease_to_m\` is given, choose \`ease_round_puddle\`: it moves over inside the lane so that the wheels miss it, without slowing. When \`room_in_lane\` is false, prefer a candidate whose \`end_speed\` is at or below \`car.target_speed\`, which slows to \`puddle.go_through_at\` by the time the wheels reach it. Never cross a lane line to avoid a puddle. A puddle with nobody near is just water.`,
  },

  // Traffic: ease left inside the lane where that takes the wheels out of a puddle with someone within
  // splash reach (not while off the middle of the lane for anything else, `busy` or `offset`, or while an
  // earlier move inside the lane, round a pothole say, is under way), and otherwise slow below its splash
  // speed, wherever in the lane it is going (`moves`: where each earlier move is heading).
  trafficLane: {
    at: "laneMoves",
    run(world, n, front, busy, dt, { offset, moves }) {
      const pdBusy = busy || moves.some((m) => m.easing) || Math.abs(offset) > 0.05;
      const pd =
        world.puddles?.enabled && n.kind !== "bike" && !n.transit?.tram
          ? npcPuddle(
              world,
              n,
              front,
              offset,
              pdBusy,
              moves.reduce((h, m) => h + m.aim - m.now, offset),
            )
          : null;
      if (!(pd || n.pdShift)) return { result: pd, shift: undefined };
      const to = pd && !pdBusy ? pd.shift : 0;
      n.pdShift = (n.pdShift || 0) + Math.max(-NPC_SHIFT_MPS * dt, Math.min(NPC_SHIFT_MPS * dt, to - (n.pdShift || 0)));
      return { result: pd, shift: n.pdShift };
    },
  },
};
