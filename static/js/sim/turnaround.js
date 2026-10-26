// Turning round where the route makes a U-turn: at a dead end the street is too narrow for the car
// to come round in one sweep, so it makes a three-point turn (more legs where it is tight). Legs at
// walking pace on full lock turn the car the way the U-turn goes: forward steering that way, back
// steering the other. Each
// leg ends short of the kerb or anything standing in the way, and the car stops before it changes
// direction. Once it faces the way out, it drives along the route's lane beyond the U-turn until
// the route's own projection finds it there (see Autopilot.step), and the car drives on as usual.
//
// The manoeuvre is a law (`kind: "turnaround"`) whose fields carry its progress: `phase` ("forward",
// "reverse", "out" once facing the way out, "stuck" when no leg can move), `legs`, `travelled`
// (this leg, in metres) and `idle` (seconds standing still). World.turnaround holds the one the car is making, so it carries on across
// decisions, and a stop to let traffic by does not lose it.

import { obbOverlap } from "./collision.js";
import { projectPoint } from "../map/mapdata.js";

export const TURN_ROUND_MPS = 1.0;
const REVERSE_MPS = 0.8;
const OUT_MPS = 2.0;
export const TURN_ROUND_START_M = 12;  // offered this close to the U-turn, once the car is slow
// Where the car stops to turn round: this far short of the U-turn, so the first leg has the whole
// width of the street (or just into the street, when it is shorter than that).
export const TURN_ROUND_BACK_M = 9;
export const TURN_ROUND_OFFER_MPS = 3.5;   // (the first leg slows to walking pace)
const OUT_HEADING_RAD = 20 * Math.PI / 180;   // facing the way out to within this
const KERB_M = 0.2;           // how far a bumper may reach over the kerb
const CLEAR_M = 0.5;          // kept from anything standing in the way (more than the prediction's 0.3, so a leg never ends inside it)
const LOOK_M = 0.4;           // checked ahead along the leg, plus the distance to stop
const LEG_MAX_M = 6;
const MAX_LEGS = 15;
const STEER_READY_RAD = 5 * Math.PI / 180;   // a leg starts once the wheel is this close to lock
const OUT_BEYOND_M = 25;      // how far past the U-turn the lane beyond it is looked for

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

function indexAt(route, s) {
  let lo = 0, hi = route.cum.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (route.cum[mid] <= s) lo = mid; else hi = mid - 1; }
  return lo;
}

// Route arc length where the car stops to turn round for the U-turn `turn` (rear axle).
export function turnaroundStopS(route, turn) {
  const before = route.turns.filter((t) => t.at_m < turn.at_m - 0.1).at(-1);
  return Math.max(turn.at_m - TURN_ROUND_BACK_M, before ? before.at_m + 3 : -Infinity);
}

// A fresh turnaround for the U-turn `turn` on `route` (one of route.turns).
export function planTurnaround(route, turn) {
  // The way out is back the way the car came. (The route's own line just past the U-turn is no
  // guide: it crosses from one lane to the other there.) A U-turn goes left, as the car drives on
  // the right.
  const psiOut = wrap(route.headingAt(Math.max(0, turn.at_m - 6)) + Math.PI);
  const side = 1;
  return {
    kind: "turnaround", id: `uturn@${Math.round(turn.at_m * 10) / 10}`, side, psiOut, sTurn: turn.at_m,
    outLo: indexAt(route, turn.at_m), outHi: indexAt(route, Math.min(route.length, turn.at_m + OUT_BEYOND_M)) + 1,
    phase: "forward", legs: 0, travelled: 0, offset: 0, center: 0, lane: 0, vTarget: OUT_MPS,
  };
}

// Where the rear axle is after `d` metres (negative: backwards) on steering angle `steer`.
function poseAfter(vehicle, steer, d) {
  const k = Math.tan(steer) / vehicle.spec.wheelbase;
  if (Math.abs(k) < 1e-6) return { x: vehicle.x + Math.cos(vehicle.psi) * d, y: vehicle.y + Math.sin(vehicle.psi) * d, psi: vehicle.psi };
  const psi = vehicle.psi + k * d;
  return { x: vehicle.x + (Math.sin(psi) - Math.sin(vehicle.psi)) / k, y: vehicle.y - (Math.cos(psi) - Math.cos(vehicle.psi)) / k, psi };
}

function boxAt(pose, spec) {
  const toCentre = spec.length / 2 - spec.rearOverhang;
  return { center: [pose.x + Math.cos(pose.psi) * toCentre, pose.y + Math.sin(pose.psi) * toCentre], heading: pose.psi, halfLength: spec.length / 2, halfWidth: spec.width / 2 };
}

// The body's corners and the middle of its leading end, at a pose.
function outline(pose, spec, d) {
  const box = boxAt(pose, spec);
  const c = Math.cos(pose.psi), s = Math.sin(pose.psi);
  const lead = d > 0 ? box.halfLength : -box.halfLength;
  return [[box.halfLength, box.halfWidth], [box.halfLength, -box.halfWidth], [-box.halfLength, -box.halfWidth], [-box.halfLength, box.halfWidth], [lead, 0]]
    .map(([ax, ay]) => [box.center[0] + ax * c - ay * s, box.center[1] + ax * s + ay * c]);
}

// Whether the car can move `d` metres along this leg: its body stays on the asphalt (to within a
// bumper's reach over the kerb; a corner already further over may only come back), and clear of
// scenery and of anything standing still. Moving traffic is left to the prediction and the safety
// brake.
export function legRoom(vehicle, world, steer, d) {
  const spec = vehicle.spec;
  const to = poseAfter(vehicle, steer, d);
  const box = boxAt(to, spec);
  const now = outline(vehicle, spec, d), after = outline(to, spec, d);
  for (let k = 0; k < after.length; k++) {
    const over = world.map.roadDistance(after[k][0], after[k][1]).distance;
    if (over > KERB_M && over > world.map.roadDistance(now[k][0], now[k][1]).distance + 0.01) return false;
  }
  if (world.staticObstacles?.sweep({ x: vehicle.x, y: vehicle.y, psi: vehicle.psi }, to, spec, CLEAR_M)) return false;
  for (const n of world.obstaclesNear(box.center[0], box.center[1], 8)) {
    if (n === vehicle || Math.abs(n.v || 0) > 0.5) continue;
    if (obbOverlap(box, n.obb(), CLEAR_M)) return false;
  }
  return true;
}

// The lane beyond the U-turn, as the route's arc length and offset from it (searched only there,
// since the lane coming in runs right beside it).
function outProjection(vehicle, route, law) {
  const pts = route.pts.slice(law.outLo, law.outHi + 1), cum = route.cum.slice(law.outLo, law.outHi + 1);
  return pts.length > 1 ? projectPoint(pts, cum, [vehicle.x, vehicle.y]) : null;
}

// The car has stopped at the end of a leg: the next goes the other way (a leg that could not move
// at all counts toward giving up). Also for a leg the safety brake stopped.
export function endLeg(law) {
  if (law.phase !== "forward" && law.phase !== "reverse") return;
  law.short = law.travelled < 0.2 ? (law.short || 0) + 1 : 0;
  law.legs++;
  law.travelled = 0;
  law.phase = law.legs >= MAX_LEGS || law.short >= 2 ? "stuck" : law.phase === "reverse" ? "forward" : "reverse";
}

// One physics step of the turnaround. Returns false once it has handed back to the lane (`done`).
export function stepTurnaround(vehicle, law, route, world, dt, purePursuit, speedControl) {
  const spec = vehicle.spec;
  const v = Math.abs(vehicle.v);
  // (how long it has stood still, for the deadlock detector)
  law.idle = v < 0.05 ? (law.idle || 0) + dt : 0;
  if (law.phase === "forward" && Math.abs(wrap(law.psiOut - vehicle.psi)) < OUT_HEADING_RAD) law.phase = "out";
  if (law.phase === "out") {
    const p = outProjection(vehicle, route, law);
    if (!p) { law.done = true; return false; }
    const steer = purePursuit(vehicle, route, p.s, 0);
    const room = legRoom(vehicle, world, steer, LOOK_M + v * v / 3);
    vehicle.step(dt, { steer, accel: speedControl(vehicle.v, room ? OUT_MPS : 0, { maxBrake: 3 }) });
    // no room to drive out from here: back up for another leg
    if (!room && Math.abs(vehicle.v) < 0.05) {
      law.legs++;
      law.travelled = 0;
      law.phase = law.legs >= MAX_LEGS ? "stuck" : "reverse";
    }
    return true;
  }
  if (law.phase === "stuck") {
    vehicle.step(dt, { steer: vehicle.delta, accel: speedControl(vehicle.v, 0, { maxBrake: 4 }), reverse: vehicle.v < 0 });
    return true;
  }
  const back = law.phase === "reverse";
  // turn the car toward the way out (the way the U-turn goes, until it is nearly there)
  const err = wrap(law.psiOut - vehicle.psi);
  const dir = Math.abs(err) > 2.6 ? law.side : Math.sign(err) || law.side;
  const steer = (back ? -dir : dir) * spec.maxSteer;
  const look = LOOK_M + v * v / 3;
  law.travelled += v * dt;
  // (a leg back ends once the car faces the way out, too: it drives out from there)
  if (!legRoom(vehicle, world, steer, back ? -look : look) || law.travelled > LEG_MAX_M || (back && Math.abs(err) < OUT_HEADING_RAD)) {
    // stop, then go the other way (a leg that could not move at all counts toward giving up)
    vehicle.step(dt, { steer, accel: speedControl(vehicle.v, 0, { maxBrake: 4 }), reverse: back });
    if (Math.abs(vehicle.v) < 0.05) endLeg(law);
    return true;
  }
  const ready = Math.abs(vehicle.delta - steer) < STEER_READY_RAD || v > 0.3;
  const vTarget = ready ? (back ? -REVERSE_MPS : TURN_ROUND_MPS) : 0;
  vehicle.step(dt, { steer, accel: speedControl(vehicle.v, vTarget, { maxAccel: 1.5, maxBrake: 3 }), reverse: back });
  return true;
}
