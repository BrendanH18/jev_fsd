// Emergency vehicles (sim/emergency.js): an ambulance or a fire truck answering a call, lights flashing
// and siren on, sent past the car now and then in free drives (the fleet option `emergency`), and every
// driver giving way to one. Traffic's side is sim/emergency-traffic.js, the car's sensing
// sim/emergency-yield.js and the audit sim/emergency-audit.js. A failure to yield counts in the shared
// `failed_to_yield`, so the record has no metric of its own.
import { r1 } from "../../common.js";
import { wrap } from "../world.js";
import { hooks } from "./index.js";
import { EmergencyTraffic } from "../emergency-traffic.js";
import { auditEmergency } from "../emergency-audit.js";
import { EV_STOP_DECEL, emergencyAhead, emergencyYield } from "../emergency-yield.js";
import { EMERGENCY_NAMES, FOLLOW_M, isEmergency, isEmergencyVehicle, nearestCall } from "../emergency.js";

// (stopping before where a registered feature's move in the lane takes the car, a narrowed stretch between
// snowbanks, say: pull right here, rather than pursuing its upcoming move left into the shared corridor
// while trying to pull over)
const PULL_OVER_DETOUR = hooks("pullOverDetour");

const EV_FROM = { behind: "behind", ahead: "ahead, the other way", left: "the left", right: "the right" };

// An emergency vehicle with its lights and siren on calling on the car to give way.
function emergencyClause(e) {
  const name = `${/^[aeiou]/.test(e.kind) ? "An" : "A"} ${e.kind}`;
  const where =
    e.from === "behind"
      ? "coming up behind the car"
      : e.from === "ahead"
        ? "coming toward the car"
        : `coming from the ${e.from}`;
  const lead = `${name} with flashing lights and a siren is ${where}, ${Math.round(e.distance_m)} m away${e.seen ? "" : " (heard, not yet seen)"}. Every driver must give way to it: pull over as close to the right-hand edge of the road as possible, clear of any junction, and stop until it has passed`;
  if (e.lead)
    return `${lead}. It is stuck behind the car and cannot get past: drive on ahead of it, at the usual speed, and pull over where there is room.`;
  const w = Math.max(0, Math.round(e.bumper_to_stop_m));
  if (w < 2)
    return `${lead}. The car has pulled over: hold still at the side of the road until it has passed (\`pull_over\`).`;
  return `${lead}. ${e.clearing ? "The car is too close to the junction ahead to stop short of it, or already in it: clear the junction, then " : ""}${e.clearing ? "pull" : "Pull"} over ${r1(e.offset_m)} m to the right and stop ${w} m ahead (\`pull_over\`).`;
}

export default {
  key: "emergency",
  view: () => import("../../render/emergency.js"),
  // an emergency vehicle calling on the car to give way: say so, once a second for as long as it calls
  notice: {
    at: "first",
    order: 0,
    duration: 2500,
    style: "safety",
    read(world, _autopilot, _views, previous, fleet) {
      const evs = (fleet?.vehicles ?? []).filter(isEmergency);
      const call = evs.length ? nearestCall(world.ego, evs) : null;
      if (!call) return null;
      // (the key carries when it was last said, so the same call is said again a second later)
      const cut = previous?.lastIndexOf("@") ?? -1;
      const fresh =
        cut < 0 || previous.slice(0, cut) !== String(call.ev.id) || world.t - Number(previous.slice(cut + 1)) > 1;
      const where =
        call.relation === "behind"
          ? "BEHIND"
          : call.relation === "ahead"
            ? "AHEAD"
            : `FROM THE ${call.relation.toUpperCase()}`;
      return {
        key: fresh ? `${call.ev.id}@${world.t}` : previous,
        text: `${EMERGENCY_NAMES[call.ev.kind].toUpperCase()} ${where} · PULL OVER AND STOP`,
      };
    },
  },
  // (the siren of the nearest one)
  sound: {
    name: "siren",
    distance: (world, fleet) =>
      fleet.vehicles
        .filter(isEmergency)
        .reduce((best, n) => Math.min(best, Math.hypot(n.x - world.ego.x, n.y - world.ego.y)), Infinity),
  },
  // (the World keeps the vehicles a failure to yield was counted for)
  property: "evCounted",
  // (emergency vehicle id -> { since, v0, lead, ... }: since it called on the car, and the drive-on latch)
  calls: "evCalls",
  build: () => new Set(),
  buildFleet: (fleet, { enabled, seed }) => new EmergencyTraffic(fleet, enabled, seed),
  snapshot: { emergency: null, emergency_ahead: null },
  flagText: { fails_to_yield_to_emergency: "it does not give way to an emergency vehicle" },
  motion: (snap) => !!snap.emergency,

  // The car giving way, after the cyclists' audit: a failure to yield counts in the shared `failed_to_yield`.
  audit: { at: "afterCyclists", run: auditEmergency },
  // (the junction the car's front is in, while one is about)
  resetContact(world) {
    world.evJunction = null;
  },
  // A vehicle stopped at a crosswalk in the next lane is named by its kind.
  vehicleLabel: (n) => (isEmergency(n) ? EMERGENCY_NAMES[n.kind] || n.kind : null),

  // Sensing, once the cyclist on the right is known: one calling on the car to give way, and one it has let
  // go by ahead.
  sense: {
    at: "afterRightHook",
    run(world, snap, { p, frontS, lane, visible, executing }) {
      snap.emergency = emergencyYield(world, p, frontS, lane, visible, snap.intersection, executing);
      snap.emergency_ahead = emergencyAhead(world, p, frontS);
    },
  },
  hazard: { at: "afterRightHook", run: (snap) => (snap.emergency ? "emergency vehicle" : null) },
  target: {
    at: "afterBus",
    run(snap, v, reasons, { decel, stopSpeedFor }) {
      const ev = snap.emergency;
      if (ev && ev.bumper_to_stop_m !== null) {
        const room = ev.bumper_to_stop_m;
        // (slowing from the start, as gently as it planned to)
        const ve =
          room < 1.0 ? 0 : Math.min(ev.max_speed_mps, stopSpeedFor(room - 0.5, Math.min(decel, EV_STOP_DECEL)));
        if (ve < v) {
          v = ve;
          reasons.push(`pulling over for the ${ev.kind}`);
        }
      }
      // an emergency vehicle it let go by: drop back to FOLLOW_M behind it (standing still within 30 m)
      const ea = snap.emergency_ahead;
      if (ea) {
        const va = ea.speed * Math.max(0, Math.min(1, (ea.gap_m - 30) / (FOLLOW_M - 30)));
        if (va < v) {
          v = va;
          reasons.push(`keeping ${FOLLOW_M} m behind the ${ea.kind}`);
        }
      }
      return v;
    },
  },

  // An emergency vehicle calling on the car to give way: pull over to the right and stop there,
  // braking as gently as the stop was planned for.
  // (a short pull-over finishes its move right within its stopping room: one planned short, and one the
  // queue it stops behind cuts shorter than planned)
  candidates: {
    at: "afterRightHook",
    run({ snap, FRONT, laneUntil, inLane, approach, stopAt, detour }, out) {
      const ev = snap.emergency;
      if (!ev || ev.stop_s_route === null) return;
      const mark = ev.stop_s_route - FRONT - 0.5,
        evStop = stopAt(mark),
        tight = ev.steer_at_stop || evStop < mark;
      out.push({
        id: "pull_over",
        laneUntil,
        law: {
          ...inLane({
            kind: "lane",
            offset: ev.offset_m,
            vTarget: Math.min(approach, ev.max_speed_mps),
            stopAtRoute: evStop,
            stopDecel: EV_STOP_DECEL,
            ...(tight ? { steerAtStop: true } : {}),
          }),
          ...(PULL_OVER_DETOUR.some((drop) => drop(snap, detour.detour, ev.stop_s_route)) ? { detour: null } : {}),
        },
        steer: `pull over ${ev.offset_m.toFixed(1)} m to the right`,
        speed:
          ev.bumper_to_stop_m > 0.3
            ? `stop at the side of the road${ev.clearing ? ", past the junction" : ""}`
            : "hold still at the side of the road",
      });
    },
  },
  // Rounded cruise speeds must not exceed the siren response ceiling when a different lane manoeuvre wins.
  // Driving on ahead of the emergency vehicle is exempt.
  adjust: {
    at: "first",
    run({ snap }, list) {
      const emergency = snap.emergency;
      if (emergency && !emergency.lead && emergency.max_speed_mps != null)
        for (const c of list)
          if (c.law.kind === "lane") c.law.vTarget = Math.min(c.law.vTarget, emergency.max_speed_mps);
    },
  },
  // (an emergency vehicle coming up behind stops for what it cannot get past: it is not predicted
  // to run into the car)
  predictionIgnore: (_snap, o, world) =>
    isEmergency(o) && world.ego.toLocal(o.x, o.y).ahead < 0 && Math.abs(wrap(o.psi - world.ego.psi)) < Math.PI / 4,
  // (one coming the other way down the street moves across only to a gap that clears the car, or stops
  // (sim/emergency.js threadGap): its body stays where it is in the forward sims. Still angled from a
  // turn into the street, one predicted straight on went into a car standing at the kerb, and every
  // pull-over was braked off)
  predictionStill: (world, o) =>
    isEmergency(o) &&
    world.ego.toLocal(o.x, o.y).ahead > 0 &&
    Math.abs(wrap(o.psi - world.ego.psi)) > (Math.PI * 3) / 4,
  // No manoeuvre but the hard brake may go past where the car stops for it (1.5 m past it, as a short stop
  // overshoots).
  sim: {
    at: "afterParkers",
    run(_world, snap) {
      const evStop = snap.emergency?.stop_s_route ?? null;
      if (evStop === null) return null;
      let passes = false;
      return {
        start() {
          passes = false;
        },
        along(s, front) {
          if (s + front > evStop + 1.5) passes = true;
        },
        reject: (c) => (passes && c.law.kind !== "hard_brake" ? "fails_to_yield_to_emergency" : null),
      };
    },
  },

  // The model's decision state and wording.
  state: [
    {
      at: "afterRearTraffic",
      run(snap, state) {
        if (!snap.emergency) return;
        const e = snap.emergency;
        state.emergency_vehicle = {
          id: e.id,
          kind: e.kind,
          siren: true,
          coming_from: EV_FROM[e.from],
          distance_m: r1(e.distance_m),
          reaches_car_in_s: r1(e.eta_s),
          seen: e.seen,
          ...(e.lead
            ? { stuck_behind_car: true }
            : {
                pull_over: true,
                stop_in_m: r1(Math.max(0, e.bumper_to_stop_m)),
                pull_right_m: r1(e.offset_m),
                ...(e.clearing ? { clear_junction_first: true } : {}),
              }),
        };
      },
    },
    {
      at: "beforeTurnaround",
      run(snap, state) {
        if (snap.emergency_ahead)
          state.emergency_vehicle_ahead = {
            id: snap.emergency_ahead.id,
            kind: snap.emergency_ahead.kind,
            gap_m: r1(snap.emergency_ahead.gap_m),
            keep_back_m: FOLLOW_M,
          };
      },
    },
  ],
  outcome: {
    at: "ids",
    run(c, snap) {
      if (c.id !== "pull_over" || !snap.emergency) return null;
      return snap.emergency.bumper_to_stop_m - c.sim.progress_m > 0.3
        ? `clear, pulls over to the right and stops ${Math.max(0, r1(snap.emergency.bumper_to_stop_m - c.sim.progress_m))} m before its stop`
        : "clear, pulls over to the right and stops";
    },
  },
  clause: [
    { at: "afterRearTraffic", run: (snap) => (snap.emergency ? emergencyClause(snap.emergency) : null) },
    {
      at: "beforeFollowing",
      run: (snap) =>
        snap.emergency_ahead
          ? `${/^[aeiou]/.test(snap.emergency_ahead.kind) ? "An" : "A"} ${snap.emergency_ahead.kind} with its siren on is ${Math.round(snap.emergency_ahead.gap_m)} m ahead, going the car's way: do not follow it within ${FOLLOW_M} m; \`car.target_speed\` already keeps the car back.`
          : null,
    },
  ],
  // And giving way to an emergency vehicle, once pulled over.
  holdStill: {
    at: "afterLate",
    run: (snap) =>
      snap.emergency && !snap.emergency.lead
        ? ", when an emergency vehicle is coming and the car has pulled over where it stops for it (`emergency_vehicle.stop_in_m` under 2)"
        : "",
  },
  prompt: {
    at: "afterRightHook",
    text: "- Choose `pull_over` when `situation` says an emergency vehicle is coming and the car must give way to it, and keep choosing it until it has passed.",
  },

  // The built-in drivers. Rules: pull over and stop at once, rather than stop in the lane (outweighing the
  // cost of ending up out of the lane's centre), judged by how near it ends to where it pulls over to, across
  // lanes to the kerb if need be: from the lane's centre, two lanes out, it would cost as much as its bonus.
  rulesTerms: { at: "special", run: (c) => (c.id === "pull_over" ? { pull_over: -15 } : null) },
  rulesLaneGoal: (c) => (c.id === "pull_over" ? c.law.offset - c.law.center : null),
  // The cautious agent pulls over and stops, whatever it costs in lane position, before anything else.
  cautious: { at: "first", run: (_snap, eligible) => eligible.find((c) => c.id === "pull_over") ?? null },
  cautiousDrive: { at: "plannedStop", run: (candidate) => candidate.id === "pull_over" },
  // (waiting pulled over, or behind one it let go by that has stopped, is no deadlock)
  legitimateStop: (snap) =>
    (snap?.emergency && snap.emergency.bumper_to_stop_m !== null && snap.emergency.bumper_to_stop_m < 8) ||
    (snap?.emergency_ahead && snap.emergency_ahead.speed < 1),

  // Traffic (sim/emergency-traffic.js): dispatched, and taken off, before the transit is managed.
  trafficManage: { at: "beforeTransit", run: (_world, fleet, dt) => fleet.emergency.manage(dt) },
  // One with its siren on drives itself, along the middle of the road.
  trafficManeuver: {
    at: "beforeSpecial",
    run(_world, fleet, n, dt, all, extraTraffic) {
      if (!isEmergencyVehicle(n)) return false;
      if (n.siren) {
        fleet.emergency.step(n, dt, extraTraffic.length ? all.concat(extraTraffic) : all);
        return true;
      }
      // Stood down: return to ordinary lane driving and junction priority. Keeping the
      // centre-of-road passing controller after the siren stops can hold a junction forever.
      n.age += dt;
      return false;
    },
  },
  trafficGiveWay: (_world, fleet, n, proj, dt) => fleet.emergency.giveWay(n, proj, dt),
  trafficPullOver: (_world, fleet, n, edge, front, dt, giveWay) =>
    fleet.emergency.pullOver(n, edge, front, dt, giveWay),
  trafficRejoin: (_world, fleet, n, offset, dt) => fleet.emergency.rejoin(n, offset, dt),
  trafficStopAt: (_world, fleet, n, front, giveWay) => fleet.emergency.stopFor(n, front, giveWay),
  trafficHangBack: (_world, fleet, n, path, front) => fleet.emergency.hangBack(n, path, front),
  checkpoint(_world, fleet) {
    if (fleet.emergency) fleet.emergency.fleet = fleet;
  },
};
