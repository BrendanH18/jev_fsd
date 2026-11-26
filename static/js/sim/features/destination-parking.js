// Destination parking (sim/parallel-park.js): with the World option `park` (on in free drives; `?park=0`
// stops the car in its lane), the autopilot looks for a space near the destination and parallel parks in
// it, or pulls out of the space it is parked in at the start of the next drive. The planner itself runs in the autopilot (brain/brain.js ParkPlanner); this
// record holds the World's parking state, its audit, how traffic keeps back while the car reverses in,
// and the sensing, candidates, decision state, wording and verdict the core used to name.
//
// The World state: whether the autopilot parks at the destination (`parkAtGoal`, the option), the space
// it is going for (`park`), the manoeuvre (`parking`), how far traffic behind keeps back (`parkHold`),
// the spaces it gave up (`parkTried`), the space it is parked in (`parkedIn`) and whether a tyre is on
// the kerb (`kerbContact`).
import { r1 } from "../../common.js";
import { projectPoint } from "../../map/mapdata.js";
import { TRY_START_M, leftSpace, planParking, planPullOut, reversing, tyres } from "../parallel-park.js";
import { wrap } from "../world.js";

// Pulling up where the car reverses into a space (`wait_to_park`), it brakes at no more than this.
const PARK_STOP_DECEL = 1.2;
// Traffic behind the driven car while it parks: stopped too close, it waits this long, then backs up at
// most this far; the car is this close to a driver's path (in its lane or the space beside it).
const PARK_BACK_S = 2;
const PARK_BACK_MAX_M = 7;
const PARK_SIDE_M = 4.5;
// Parking is slow on purpose; standing still this long in the middle of it is not (brain/safety.js).
const PARK_IDLE_S = 5;

// The manoeuvre under way, or the space it is going for (sensing's `parking`): the space, where the car
// stops to reverse into it (rear axle, route arc length) and how far right of its lane's centre it pulls
// up there, whether something behind keeps it waiting (`wait_for`), and once under way the manoeuvre's
// leg. Null without one, or once there is no space to be had.
function parkingSense(world, snap, executing) {
  const p = world.park,
    law = world.parking;
  if (!p || p.status === "none" || !snap.routeProj) return null;
  const leg = law
    ? { phase: law.phase, legs: law.legs, executing: executing?.law === law, idle_s: law.idle || 0 }
    : { phase: null, legs: 0, executing: false, idle_s: 0 };
  if (p.mode === "out") return { mode: "out", status: p.status, id: p.id, wait_for: p.blocked, ready: !law, ...leg };
  const s = snap.routeProj.s;
  return {
    mode: "in",
    status: p.status,
    id: p.id,
    length_m: p.length,
    kerb: "right",
    stop_s_route: p.stopS,
    stop_in_m: p.stopS - s,
    nudge_m: p.nudge,
    wait_for: p.blocked,
    waited_s: p.waited || 0,
    ready: !law && p.status === "waiting" && !p.blocked,
    near_start: Math.abs(p.stopS - s) < TRY_START_M,
    ...leg,
  };
}

// The decision state's `parking`.
function parkingState(p) {
  if (p.mode === "out")
    return {
      pulling_out: true,
      ...(p.phase ? { leg: p.phase, legs_done: p.legs } : {}),
      ...(p.wait_for ? { wait_for: p.wait_for } : {}),
    };
  return {
    space_m: r1(p.length_m),
    kerb: p.kerb,
    ...(p.phase
      ? { under_way: true, leg: p.phase, legs_done: p.legs }
      : {
          stop_in_m: r1(Math.max(0, p.stop_in_m)),
          ...(p.wait_for ? { wait_for: p.wait_for } : {}),
          ...(p.ready ? { clear_behind: true } : {}),
        }),
  };
}

function parkingClause(p) {
  if (p.mode === "out")
    return p.phase && p.phase !== "out_back" && p.phase !== "out_wait"
      ? "The car is pulling out of the parking space it was parked in: carry on with `pull_out` while it is offered; it hands back to the lane once the car is in it."
      : `The car is parked at the kerb and pulls out of the space to start (\`pull_out\`): it backs up, signals left, and waits until nothing is coming up the lane beside it${p.wait_for ? ` (\`${p.wait_for}\` is coming now)` : ""}; then it pulls out on full lock.`;
  if (p.phase)
    return "The car is parallel parking in the space at the destination: carry on with `park` while it is offered, and hold still only to let something go by.";
  const at = Math.max(0, Math.round(p.stop_in_m));
  if (p.wait_for)
    return `There is a space to park in at the destination, on the right. The car is alongside the car in front of it, signalling right, but \`${p.wait_for}\` is behind it, in the way back or coming: hold still where the car is (\`wait_to_park\`) until it is clear behind. Never back into anyone.`;
  if (p.ready)
    return "There is a space to park in at the destination, on the right, and it is clear behind: park in it with `park`, reversing in on full lock toward the kerb, then the other way.";
  return `There is a space to park in at the destination, on the right, ${Math.round(p.length_m * 10) / 10} m long. Signal right, slow down and stop ${at} m ahead, alongside the car in front of it (\`wait_to_park\`), to reverse into it. The space is the destination now: do not drive on past it.`;
}

// Parking or pulling out, a tyre on the kerb is a kerb strike: counted once a contact (a bumper reaching
// over it is not).
function auditKerb(world) {
  const law = world.parking;
  if (!law || law.phase === "done") {
    world.kerbContact = false;
    return;
  }
  const on = tyres(world.ego, world.ego.spec).some((p) => world.map.roadDistance(p[0], p[1]).distance > 0.02);
  if (on && !world.kerbContact) world.events.push({ type: "kerb_strike", reversing: reversing(law) });
  world.kerbContact = on;
}

// The space the car reverses into, until it starts (route arc length of the rear axle), or null.
const spaceAhead = (world, snap) => (snap.parking?.mode === "in" && !world.parking ? snap.parking.stop_s_route : null);

// The manoeuvre's candidate: under way, or on offer once the car is where it starts and nothing is
// coming from behind; and pulling out of the space the car is parked in, at the start of the next drive.
function manoeuvre(id, law) {
  const out = id === "pull_out";
  return {
    id,
    law,
    steer: out
      ? "pull out of the space: back up, then out on full lock"
      : "reverse into the space: full lock toward the kerb, then the other way",
    speed: "walking pace",
  };
}

export default {
  key: "park",
  property: "parkAtGoal",
  buildAt: "early",
  build(world, { enabled }) {
    world.park = null;
    world.parking = null;
    world.parkHold = 0;
    world.parkTried = [];
    world.parkedIn = null;
    world.kerbContact = false;
    return !!enabled;
  },
  snapshot: { parking: null },
  // (parking and pulling out are kept ahead of lateral alternatives when the list is cut, as a turnaround is)
  priority: ["park", "pull_out"],
  flagText: { passes_parking_space: "it drives past the parking space at the destination" },
  motion: (snap) => !!snap.parking,

  // Moved by hand: whatever space it was going for, or parked in, is let go.
  resetContact(world) {
    for (const p of [world.park, world.parkedIn])
      for (const slot of p?.slots || []) if (slot.reserved?.owner === world.ego) slot.reserved = null;
    world.park = null;
    world.parking = null;
    world.parkHold = 0;
    world.parkedIn = null;
    world.kerbContact = false;
  },
  // The kerb strikes while parking or pulling out, then the space let go once the car has left it.
  audit: {
    at: "destination",
    run(world) {
      auditKerb(world);
      leftSpace(world);
    },
  },
  // Behind the driven car while it pulls up to a space and reverses into it, wherever its body is, in the
  // lane or partway into the space: traffic keeps back the room it reverses into until it is in, and,
  // stopped too close already, backs up out of it.
  trafficKeepBack(world, n, path, { dt, look, isLong }) {
    if (!(world.parkHold > 0)) {
      if (n.parkWait) n.parkWait = 0;
      return null;
    }
    const ego = world.ego,
      spec = n.spec,
      q = projectPoint(path.pts, path.cum, [ego.x, ego.y], null);
    if (
      !(
        q &&
        q.s > path.s &&
        q.s - path.s < look &&
        Math.abs(q.lateral) < PARK_SIDE_M &&
        Math.cos(wrap(ego.psi - n.psi)) > 0.5
      )
    ) {
      n.parkWait = 0;
      return null;
    }
    const g = q.s - path.s - (spec.length - spec.rearOverhang) - ego.spec.rearOverhang;
    // (only while the car waits for it, before it starts back)
    const waits =
      n.v < 0.2 && world.park?.blocked === n.id && world.parkHold - g > 0.5 && n.kind !== "bike" && !isLong(n);
    n.parkWait = waits ? (n.parkWait || 0) + dt : 0;
    if (n.parkWait > PARK_BACK_S) {
      n.parkWait = 0;
      n.backoff = { left: Math.min(PARK_BACK_MAX_M, world.parkHold - g + 0.5), t: 0 };
    }
    return { gap: g - world.parkHold, vehicle: ego };
  },

  sense: {
    at: "destination",
    run(world, snap, { executing }) {
      snap.parking = parkingSense(world, snap, executing);
    },
  },
  // A space to park in: stop where the car reverses into it.
  target: {
    at: "destination",
    run(snap, v, reasons, { decel, stopSpeedFor }) {
      const pk = snap.parking;
      if (pk?.mode === "in" && !pk.phase) {
        const vk = stopSpeedFor(Math.max(0, pk.stop_in_m - 0.3), Math.min(decel * 0.8, PARK_STOP_DECEL));
        if (vk < v) {
          v = vk;
          reasons.push("parking space ahead");
        }
      }
      return v;
    },
  },
  hazard: { at: "destination", run: (snap) => (snap.parking ? "parking" : null) },
  // Waiting to park, or to pull out, signalling, for what is coming; and parking, at walking pace.
  legitimateStop: (snap) =>
    !!snap?.parking &&
    ((snap.parking.mode === "in"
      ? !snap.parking.phase && snap.parking.near_start
      : !snap.parking.phase || snap.parking.executing) ||
      (snap.parking.executing && snap.parking.idle_s < PARK_IDLE_S)),

  // A space to park in near the destination: pull up alongside the car in front of it, a little right of
  // the lane's centre, signalling, and wait there until nothing is coming from behind. The space is the
  // destination now.
  candidates: {
    at: "destination",
    run({ snap, world, s, laneUntil, inLane, approach, stopAt }, out) {
      const pk = snap.parking?.mode === "in" && !world.parking ? snap.parking : null;
      if (!pk || !(pk.stop_in_m > -TRY_START_M)) return;
      // (the last few metres gently: the car stops alongside the car in front, near enough exactly)
      out.push({
        id: "wait_to_park",
        laneUntil,
        law: inLane({
          kind: "lane",
          offset: Math.round(pk.nudge_m * 10) / 10,
          vTarget: approach,
          stopAtRoute: stopAt(s + Math.max(0, pk.stop_in_m)),
          stopDecel: PARK_STOP_DECEL,
        }),
        steer: `pull up ${Math.round(pk.nudge_m * 10) / 10} m right, alongside the car in front of the space`,
        speed:
          pk.stop_in_m > 0.3
            ? "stop where the car reverses into the space"
            : "hold still, signalling right, until it is clear behind",
      });
    },
  },
  replacesDestinationStop: ({ snap, world }) => snap.parking?.mode === "in" && !world.parking,
  manoeuvreCandidates: {
    at: "afterTurnaround",
    run({ snap, world }, out) {
      if (world.parking) out.push(manoeuvre(world.parking.mode === "out" ? "pull_out" : "park", { ...world.parking }));
      else if (snap.parking?.ready) {
        const out1 = snap.parking.mode === "out";
        out.push(manoeuvre(out1 ? "pull_out" : "park", out1 ? planPullOut(world.parkedIn) : planParking(world.park)));
      }
    },
  },
  // Driving on past the space it stops at to reverse into (a metre past it, as a short, slow stop
  // overshoots) is rejected.
  sim: {
    at: "destination",
    run(world, snap) {
      const parkAt = spaceAhead(world, snap);
      if (parkAt === null) return null;
      let past = false;
      return {
        start() {
          past = false;
        },
        along(s, _front, car) {
          if (s > parkAt + 1 && car.v > 0.5) past = true;
        },
        reject: (c) => (past && c.law.kind === "lane" ? "passes_parking_space" : null),
      };
    },
  },

  state: {
    at: "destination",
    run(snap, state) {
      if (snap.parking) state.parking = parkingState(snap.parking);
    },
  },
  outcome: {
    at: "ids",
    run(c, snap) {
      if (c.law.kind === "park")
        return c.law.mode === "out"
          ? "clear, pulls out of the parking space into the lane"
          : "clear, parks the car in the space";
      if (c.id === "wait_to_park" && snap.parking)
        return snap.parking.stop_in_m > 0.3
          ? `clear, stops ${Math.max(0, r1(snap.parking.stop_in_m - c.sim.progress_m))} m short of where the car reverses into the space`
          : "clear, holds still where the car reverses into the space";
      return null;
    },
  },
  clause: { at: "destination", run: (snap) => (snap.parking ? parkingClause(snap.parking) : null) },
  driveCriterion: {
    at: "destination",
    run: (snap) =>
      snap.parking
        ? ` ${snap.parking.mode === "out" ? "Pulling out of a parking space (`pull_out`)" : "Parking (`park`)"} is driving too, its legs back included.`
        : "",
  },
  // And waiting to reverse into a space, or to pull out of one, for traffic behind.
  holdStill: {
    at: "destination",
    run: (snap) =>
      snap.parking?.wait_for
        ? snap.parking.mode === "out"
          ? ", when the car is parked and waiting to pull out for traffic coming up the lane beside it (`parking.wait_for`)"
          : ", when the car has pulled up to reverse into a parking space and something is behind it (`parking.wait_for`)"
        : "",
  },
  // Parking, the space is the destination: the car has not reached it until it is parked.
  arrivalCriterion: (snap) =>
    snap.parking ? " (while parking, the destination is reached only once the car is parked)" : "",
  prompt: {
    at: "afterTurnaround",
    text: "- Where `situation` says there is a space to park in at the destination, choose `wait_to_park` to pull up alongside the car in front of it, and hold still there while `parking.wait_for` is set; then choose `park` when it is offered, and keep choosing it until the car is parked. Likewise `pull_out`, to pull out of a space at the start of a drive.",
  },

  // Rules: the space is the destination, so arriving is no reason to stop while parking; parking at the
  // destination, and pulling out of the space at the start of a drive, carry on whenever their prediction
  // is clear; and pulling up where the car reverses into the space comes before driving on past it.
  keepsDestination: (snap) => snap.parking?.mode === "in",
  manoeuvreGoesOn: (c) => c?.law.kind === "park",
  rulesTerms: {
    at: "afterTurnaround",
    run(c) {
      if (c.law.kind === "park") return { parking: -50 };
      if (c.id === "wait_to_park") return { parking_approach: -12 };
      return null;
    },
  },
  // The cautious agent carries on with parking or pulling out once on offer, and counts the stop each
  // brings it to as planned.
  cautious: { at: "parking", run: (_snap, eligible) => eligible.find((c) => c.id === "park" || c.id === "pull_out") },
  cautiousDrive: {
    at: "plannedStop",
    run: (candidate) => ["park", "pull_out", "wait_to_park"].includes(candidate.id),
  },
  // The safety brake: parking, or pulling out of a space, moves at walking pace up to kerbs and parked
  // cars on purpose, keeping clear of them itself up to sim/parallel-park.js CLEAR_M, so only what is
  // closer counts; and at an angle to the street, traffic going the other way in its own lane is not in
  // the way (the prediction still looks out for it).
  safetyLaw(world, law) {
    if (!(law?.kind === "park" && world.parking === law && law.phase !== "done")) return null;
    return { reversing: reversing(law), gapStill: 0.3, gapMoving: 0.3, ttcMoving: 0.4, passesOncoming: true };
  },

  // A drive that parks at the destination: arrived, but not parked within 30 cm of the kerb
  // (bench/runner.js sets `parked`).
  verdict: {
    failure: "not parked",
    category: "parking",
    examinerRemark: "Did not finish parked within 30 cm of the kerb",
    fails: (m) => m.arrived && m.parked === false,
  },
  examinerMinors: {
    kerb: { category: "parking", remark: "Touched the kerb", when: (report) => !!report.parking },
  },
  // The road test's last instruction, and how the examiner marks the parking.
  examinerScript(route, lines, { say }) {
    lines.push({
      kind: "park",
      from: route.length - say,
      at: route.length + 5,
      text: "Pull up on the right and parallel park in the gap between the parked cars, within 30 cm of the kerb.",
    });
  },
  examinerMarks(report, mark) {
    const park = report.parking;
    if (park?.result === "parked" && park.within_kerb) {
      if (park.kerb_m > 0.2)
        mark("park_far", "parking", `Parked ${Math.round(park.kerb_m * 100)} cm from the kerb: closer is better`);
      if (Math.abs(park.angle_deg) > 4) mark("park_angle", "parking", "Finished at an angle to the kerb");
      if (park.legs > 5) mark("park_moves", "parking", "Needed extra moves to straighten up in the space");
    }
  },
};
