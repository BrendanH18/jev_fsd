// Black ice (sim/black-ice.js) as a feature record (sim/features/index.js, docs/feature-interface.md).
// Grip itself is the car model's: the World builds this record in every world, so one without ice clears
// `ROAD.gripAt` (sim/vehicle.js) and vehicle stepping stays exactly as without the feature.
import { iceNotice } from "../black-ice.js";
import { r1 } from "../../common.js";
import { current as weather } from "../weather.js";
import {
  BlackIce,
  auditIce,
  earlySlows,
  gentleOnIce,
  iceLimit,
  iceSensing,
  iceSimCheck,
  iceStopDecel,
  iceTurn,
  npcIce,
  patchesUnder,
} from "../black-ice.js";

// Where a patch of black ice lies, for models.
const ICE_WHERE = { bridge: "a bridge deck", shade: "a stretch in the shade of tall buildings" };

// Black ice the car has seen, and the caution while conditions favour it, for models.
function iceClause(a, k, ahead) {
  const caution = k
    ? `Conditions favour black ice (${k.text}): it forms first on bridges, overpasses and shaded stretches, thin and nearly invisible, while the rest of the road looks dry or damp.`
    : "";
  const bridge = k?.bridge
    ? k.bridge.on
      ? ` The car is on a bridge${k.bridge.name ? ` (${k.bridge.name})` : ""}: keep to ${r1(k.slow.mps)} m/s or less until the end of it, ${Math.max(0, Math.round(k.bridge.ends_in_m))} m on.`
      : ` A bridge${k.bridge.name ? ` (${k.bridge.name})` : ""} starts ${Math.max(0, Math.round(k.bridge.starts_in_m))} m ahead: ease off to ${r1(k.slow.mps)} m/s before it (\`car.target_speed\` already does).`
    : "";
  if (!a) return `${caution}${bridge}`;
  const where = `on ${ICE_WHERE[a.kind]}${a.name ? ` (${a.name})` : ""}`;
  const more =
    ahead?.length > 1 ? ` ${ahead.length - 1} more patch${ahead.length > 2 ? "es are" : " is"} further on.` : "";
  const lead = a.on_ice
    ? `The car is on black ice ${where}, ${Math.max(0, Math.round(a.ends_in_m))} m from the end of it: its tyres have about a tenth of their grip.`
    : `The road ${Math.round(a.starts_in_m)} m ahead, ${where}, has a glossy sheen: black ice, ${a.length_m} m of it, where the tyres have about a tenth of their grip.`;
  const how = a.on_ice
    ? ` Do not brake, accelerate or steer sharply: ease off and hold steady at ${r1(a.speed_mps)} m/s or less until all four wheels are off it (\`slow_for_ice\`, or \`car.target_speed\`). Braking hard here slides the car.`
    : ` Slow down now, on the dry road, to ${r1(a.speed_mps)} m/s by the time the front wheels reach it, then cross it steadily, without braking, accelerating or steering sharply (choose \`slow_for_ice\`; \`car.target_speed\` already slows for it). Leave more room to anything ahead: on the ice the car can hardly stop.`;
  return `${caution}${bridge} ${lead}${how}${more}`.trim();
}

export default {
  checkpointShare(world, shared) {
    if (world.ice?.enabled) shared.add(world.ice);
  },
  rulesCost: (c, snap) => (c.id === "slow_for_ice" && snap.black_ice ? -2 : 0),
  cautious: (snap, eligible) =>
    snap.black_ice && !snap.following ? eligible.find((c) => c.id === "slow_for_ice") : null,
  key: "ice",
  coach: {
    init: () => ({
      ice: false,
      iceOverspeed: 0,
    }),
    seen: "ice",
    events: {
      ice_overspeed(score, ev) {
        score.iceOverspeed++;
        score.incident(
          "ice_overspeed",
          ev.reason === "fast"
            ? `Crossed black ice at ${Math.round(ev.kmh)} km/h`
            : ev.reason === "skid"
              ? "Skidded on black ice"
              : `${ev.reason === "brake" ? "Braked" : "Accelerated"} hard on black ice`,
          { patch: ev.patch, reason: ev.reason, kmh: ev.kmh, safe_kmh: ev.safe_kmh },
        );
      },
    },
    reports: [{ at: "end", order: 14, read: (score) => (score.ice ? { ice_overspeed: score.iceOverspeed } : {}) }],
    deductions: [{ at: "safety", order: 8, counter: "iceOverspeed", weight: 20 }],
    tips: [
      {
        at: "afterMerge",
        order: 13,
        when: (score) => score.iceOverspeed,
        text: "Near freezing, expect black ice on bridges, overpasses and shaded stretches, even when the road looks only dry or damp. Slow down before them, on the dry road, and cross the ice steadily: no braking, accelerating or sharp steering on it. If you are already on it, ease off and keep the wheel straight.",
      },
    ],
  },
  notice: {
    at: "beforeLeftOnRed",
    order: 9,
    duration: 2500,
    read: (world, autopilot, views) => (views.ice ? iceNotice(world, autopilot.enabled ? autopilot.snap : null) : null),
    style: (line) => (line.slow ? "safety" : ""),
  },
  eventBadges: {
    ice_overspeed: (event) =>
      event.reason === "fast"
        ? `ONTO BLACK ICE AT ${Math.round(event.kmh)} KM/H`
        : event.reason === "skid"
          ? "SKIDDED ON BLACK ICE"
          : `${event.reason === "brake" ? "BRAKED" : "ACCELERATED"} HARD ON BLACK ICE`,
  },
  perceptionLine(snap) {
    const bi = snap.black_ice,
      ib = snap.ice_caution?.bridge;
    const text = bi
      ? `Black ice ${bi.on_ice ? "under the car: hold steady, no braking" : `${Math.round(bi.starts_in_m)} m ahead: ${Math.round(bi.speed_mps * 3.6)} km/h before it`}`
      : ib && ib.starts_in_m < 80
        ? `Near freezing: bridge ${ib.on ? "here" : `in ${Math.round(ib.starts_in_m)} m`}, ${Math.round(snap.ice_caution.slow.mps * 3.6)} km/h`
        : null;
    return text ? { order: 26, label: "Black ice", text } : null;
  },
  perceptionRejections: {
    crosses_ice_too_fast: "Black ice: too fast",
    brakes_on_ice: "Black ice: no hard braking or steering",
  },
  seen: "iceSeen",
  calls: "iceCalls",
  // (built in every world: one without it clears the car model's grip hook)
  build: (world, { enabled, seed }) => new BlackIce(world, { enabled, seed }),
  // (whether conditions favour it depends on the time of year: the clock keeps its `day` while it is on)
  day: true,
  metric: {
    at: "rearTraffic",
    name: "ice_overspeed",
    failure: "crossed black ice too fast, or braked or steered hard on it",
    label: "Crossed black ice too fast, or braked or steered hard on it",
  },

  // Whether the weather and the time favour it now, and its grip hook, before anything moves.
  stepBeforeTraffic: {
    at: "first",
    run(world) {
      if (world.ice?.enabled) world.ice.refresh(world);
    },
  },
  audit: {
    at: "rearTraffic",
    run(world) {
      if (world.ice?.enabled) auditIce(world);
    },
  },

  // The car's sensing: black ice it has seen ahead, and a caution while conditions favour it.
  sense: {
    at: "streetHazards",
    run(world, snap, { p, frontS }) {
      if (world.ice?.enabled) Object.assign(snap, iceSensing(world, p, frontS));
    },
  },
  // (coming up to black ice it has seen, or a bridge in icy weather, and across it, ready to stop gently
  // on it for what is ahead, the parking space included; the speed is the target itself, so the weather
  // does not take it off again)
  limit: {
    at: "parking",
    run(snap) {
      if ((snap.black_ice_ahead || snap.ice_caution?.slow) && snap.routeProj) {
        const cap = iceLimit(snap, snap.routeProj.s);
        if (cap < Infinity) {
          snap.ice_limit_mps = cap;
          snap.limit = Math.min(snap.limit, cap / Math.min(1, weather.speed));
        }
      }
    },
  },
  // (`limit` is already down to it)
  target: {
    at: "streetHazards",
    run(snap, v, reasons) {
      if (snap.ice_limit_mps != null && snap.ice_limit_mps <= v + 0.05)
        reasons.push(
          snap.black_ice?.on_ice
            ? "on black ice: no braking or sharp steering"
            : snap.black_ice
              ? "black ice ahead"
              : "bridges freeze first",
        );
      return v;
    },
  },
  hazard: {
    at: "late",
    run: (snap) =>
      snap.black_ice || (snap.ice_caution?.bridge && snap.ice_caution.bridge.starts_in_m < 80) ? "black ice" : null,
  },
  // Crossing a junction over black ice it has seen: as slowly and gently as the ice lets it go.
  turnPace: (world, frontS, distance) => (world.ice?.list.length ? iceTurn(world, frontS, distance) : null),

  // Ease off early, on the dry road, to the speed to cross it at, and hold that across it, without
  // braking, accelerating or steering hard on it.
  candidates: {
    at: "rearTraffic",
    run({ snap, laneUntil, inLane, target }, out) {
      const ice = snap.black_ice_ahead;
      if (ice) {
        out.push({
          id: "slow_for_ice",
          laneUntil,
          law: { ...inLane({ kind: "lane", vTarget: target }), slowTo: earlySlows(ice) },
          steer: "hold lane, steering gently",
          speed: snap.black_ice.on_ice
            ? "ease off, no braking, and hold steady across the ice"
            : "ease off before the ice, then hold steady across it",
        });
      }
    },
  },
  // Every lane manoeuvre slows for the black ice it has seen, to its speed by then, and on the ice only
  // eases the pedals and the wheel (`ice`: gentleOnIce), stopping as gently.
  adjust: {
    at: "end",
    run({ snap }, list) {
      if (snap.black_ice_ahead)
        for (const c of list)
          if (c.law.kind === "lane") {
            c.law.slowTo = [...(c.law.slowTo || []), ...snap.black_ice_ahead.map((a) => a.slow)];
            c.law.ice = true;
            if (c.law.stopAtRoute !== undefined)
              c.law.stopDecel = Math.min(c.law.stopDecel ?? Infinity, iceStopDecel(snap.black_ice_ahead));
          }
    },
  },
  // No manoeuvre may take it onto a patch it has seen faster than its safe speed, or brake, accelerate or
  // skid on one (the ice under every forward sim's tyres is the car model's own: ROAD.gripAt).
  sim: {
    at: "streetHazards",
    run(world, snap) {
      const icy = snap.black_ice_ahead && world.ice?.list.length ? snap.black_ice_ahead : null;
      if (!icy) return null;
      const iceStart = patchesUnder(world.ice, world.ego);
      let iceCall = null;
      return {
        start() {
          iceCall = null;
        },
        afterLaw(car, _wheelsBefore, t) {
          if (!iceCall) iceCall = iceSimCheck(world.ice, icy, car, t, iceStart);
        },
        reject: (c) =>
          iceCall && c.law.kind !== "hard_brake"
            ? iceCall === "fast"
              ? "crosses_ice_too_fast"
              : "brakes_on_ice"
            : null,
      };
    },
  },

  state: {
    at: "rearTraffic",
    run(snap, state) {
      if (snap.black_ice) {
        const a = snap.black_ice;
        state.black_ice = {
          id: a.id,
          on: ICE_WHERE[a.kind],
          ...(a.name ? { street: a.name } : {}),
          ...(a.on_ice ? { under_car: true, ends_in_m: r1(Math.max(0, a.ends_in_m)) } : { ahead_m: r1(a.starts_in_m) }),
          length_m: a.length_m,
          grip: "about a tenth of dry asphalt",
          safe_speed: r1(a.safe_mps),
          cross_at: r1(a.speed_mps),
          ...(snap.black_ice_ahead.length > 1 ? { more_ahead: snap.black_ice_ahead.length - 1 } : {}),
        };
      }
      if (snap.ice_caution) {
        const k = snap.ice_caution,
          b = k.bridge;
        state.ice_caution = {
          conditions: k.text,
          ice_forms_first_on: "bridges, overpasses and shaded stretches",
          ...(b
            ? {
                bridge: {
                  ...(b.name ? { name: b.name } : {}),
                  ...(b.on ? { on_it: true, ends_in_m: r1(Math.max(0, b.ends_in_m)) } : { ahead_m: r1(b.starts_in_m) }),
                  keep_to: r1(k.slow.mps),
                },
              }
            : {}),
        };
      }
    },
  },
  // (it eases off to cross it steadily; after the other slow-downs, which `slow_for_ice` also carries)
  slowOutcome: {
    at: "end",
    run(c, snap) {
      if (c.id === "slow_for_ice" && snap.black_ice)
        return snap.black_ice.on_ice
          ? `clear, eases off to ${r1(snap.black_ice.speed_mps)} m/s without braking and holds steady across the ice`
          : `clear, eases off early, on the dry road, to ${r1(snap.black_ice.speed_mps)} m/s before the black ice and holds it across, without braking on it`;
      if (c.law.slowTo && snap.black_ice && c.sim.end_speed > 0.5)
        return `clear, slows to ${r1(snap.black_ice.speed_mps)} m/s by the black ice and holds it across`;
      return null;
    },
  },
  clause: {
    at: "streetHazards",
    run: (snap) =>
      snap.black_ice || snap.ice_caution ? iceClause(snap.black_ice, snap.ice_caution, snap.black_ice_ahead) : null,
  },
  prompt: {
    at: "rearTraffic",
    text: `- Near freezing (\`ice_caution\`), black ice forms first on bridges, overpasses and shaded stretches, and it is nearly invisible. Keep to \`ice_caution.bridge.keep_to\` across a bridge. Once \`black_ice\` is reported, choose \`slow_for_ice\` (or another candidate whose \`end_speed\` is at or below \`car.target_speed\`): slow on the dry road, before the ice, to \`black_ice.cross_at\`, then cross it steadily. On the ice (\`black_ice.under_car\`), never brake, accelerate or steer sharply: ease off and hold steady until the car is off it, and leave extra room to anything ahead.`,
  },

  // Traffic and cyclists slow for black ice ahead, and for bridges in icy weather, and on or coming up to
  // it only ease the pedals and the wheel (a streetcar's steel wheels do not feel it).
  trafficYield(world, n, front) {
    if (!(world.ice?.list.length && !n.transit?.tram)) return null;
    const r = npcIce(world, n, front);
    if (!r) return null;
    return r.limit < Infinity ? { limit: r.limit, controls: gentleOnIce } : { limit: r.limit };
  },
};
