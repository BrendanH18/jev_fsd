// Red-light runners (World option `redRunners`). Now and then a driver coming up to a signal whose
// light is turning red, who could still stop for it, commits to running the late amber or the fresh
// red instead: it holds the speed it had (never faster) and goes through. It is a late runner, not a
// kamikaze: it still stops for a vehicle or a person already in its path (traffic's leader, crosswalk
// and box checks in sim/npc.js all still apply), and it gives up and stops at the line if something
// slows it to a crawl first. Commitments come from the feature's own seeded random stream, at most one
// every RUNNER_COOLDOWN_S, so a free drive meets one only now and then.
//
// Everyone else looks before going on a green (the Canadian defensive-driving rule: when your light
// turns green, check that cross traffic has stopped). `runnerThreat` is the one test, shared by the
// driven car's sensing (brain/sensors.js `red_light_runner`), the candidates and forward sims
// (`wait_for_runner`, and the rejection `enters_ahead_of_red_light_runner`), Rules, the cautious agent,
// the model wording, traffic (sim/npc.js) and the audit: a vehicle crossing the observer's way on a
// red or amber light that cannot stop before its line (sim/amber.js stopping distance, unless it is
// visibly braking hard enough to), or that has already entered the junction on one. A driver about to
// enter on green waits at the line while there is one, as long as it can still stop there.
//
// The audit counts the car entering the junction on green while such a vehicle is in sight, after it
// could have stopped for it, as `fresh_green_conflicts`; the metric reaches reports, and fails a drive,
// only once a runner has committed within SEEN_M of the car (`World.redRunnersSeen`). With the option
// off nothing here is computed and no random number is drawn.

import { rng } from "../common.js";
import { amberStoppingDistance } from "./amber.js";
import { approachPhase, movementSignal } from "./signals.js";
import { approachTo } from "./priority.js";
import { comfort } from "./vehicle.js";
import { isEmergency, isEmergencyVehicle } from "./emergency.js";
import { isPlow } from "./snow-plow.js";

// The chance that a driver who could stop for the amber runs it instead, drawn once per approach.
export const RUNNER_CHANCE = 0.12;
// After one commits, no other does for this long.
export const RUNNER_COOLDOWN_S = 30;
// Only a driver going at least this fast commits; one slowed below RUNNER_ABORT_MPS short of the line
// gives up and stops.
export const RUNNER_MIN_MPS = 6;
const RUNNER_ABORT_MPS = 2;
// It reaches its line no earlier than RUN_EARLY_S before its light turns red (a late amber), and no
// later than RUN_LATE_S after (a fresh red).
const RUN_EARLY_S = 1;
export const RUN_LATE_S = 2.5;
// A commitment lapses after this long, whatever happened.
const RUNNER_MAX_S = 20;
// Crossing traffic slower than this is not a threat.
export const THREAT_MIN_MPS = 2.5;
// How far from a junction's centre crossing traffic is looked at.
export const LOOK_M = 80;
// How far from its line a driver on green looks for one, and how near the car a commitment must be
// for the audit's metric to count.
export const HOLD_LOOK_M = 40;
export const SEEN_M = 120;
// A green this young is a fresh green (for the wording and the HUD).
export const FRESH_GREEN_S = 4;
const CROSS_LO = Math.PI / 6, CROSS_HI = Math.PI * 5 / 6;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// The World's state: whether runners run, their random stream, and when the next may commit.
export function createRunners({ enabled = false, seed = 1 } = {}) {
  return { enabled: !!enabled, random: enabled ? rng(seed * 2246822519 + 48042) : null, next: 0, committed: 0 };
}

// Ordinary cars only: not cyclists, transit, school buses, trains, trucks at work, emergency vehicles,
// plows, or cars pulling out or parking.
const ordinary = (n) => n.kind !== "bike" && !n.transit && !n.school && !n.rail && !n.collect && !n.pull && !n.parking
  && !isPlow(n) && !isEmergency(n) && !isEmergencyVehicle(n);

// Seconds until the movement's light on `edgeId` turns red (to 8 s), or null.
function secondsToRed(inter, edgeId, turn, t) {
  for (let k = 0; k <= 80; k++) if (movementSignal(approachPhase(inter, edgeId, t + k / 10), turn) === "red") return k / 10;
  return null;
}

// How long the movement's light has been green (to `max` s).
export function greenFor(inter, edgeId, turn, t, max = 10) {
  for (let k = 0; k <= max * 10; k++) if (movementSignal(approachPhase(inter, edgeId, t - k / 10), turn) !== "green") return k / 10;
  return max;
}

// Whether vehicle `o` can stop within `toLine` metres: by the amber stopping distance, or because it
// is visibly braking hard enough to already.
export function canStopAt(o, toLine) {
  if (toLine >= amberStoppingDistance(o)) return true;
  const braking = -(o.ax || 0), room = toLine - 0.3;
  return braking > 0.5 && room > 0 && o.v * o.v / (2 * room) <= braking + 0.3;
}

// Commit traffic driver `n` to running the signal on its path edge `edgeId` (junction `interId`).
export function commitRunner(world, n, edgeId, interId) {
  const state = world.redRunners;
  n.runner = { key: `${edgeId}:${interId}`, edge: edgeId, inter: interId, speed: Math.max(0, n.v), at: world.t, entered: false };
  state.next = world.t + RUNNER_COOLDOWN_S; state.committed++;
  if (Math.hypot(n.x - world.ego.x, n.y - world.ego.y) < SEEN_M) world.redRunnersSeen = true;
  return n.runner;
}

// Whether traffic driver `n`, at the signal `ctl` on its path edge `e` showing it `st`, `bumperToLine`
// short of the line, runs it: its commitment, kept until it is through, or one drawn now (once per
// approach, only while it could still stop: `canStop`). `boxBusy()` says whether someone is crossing
// in the junction: it never commits then, and gives up while it can still stop if someone gets there
// first. Null unless it runs it.
export function runsLight(world, n, e, ctl, st, bumperToLine, canStop, boxBusy) {
  const key = `${e.id}:${ctl.id}`;
  if (n.runner) {
    if (n.runner.key !== key) return null;
    const stoppable = bumperToLine > n.v * n.v / (2 * Math.min(6, comfort().hardDecel)) + 1;
    if ((bumperToLine > 0 && n.v < RUNNER_ABORT_MPS) || (!n.runner.entered && stoppable && boxBusy())) { n.runner = null; return null; }
    return n.runner;
  }
  if (st === "green") { if (n.runDrawn === key) n.runDrawn = null; return null; }
  const state = world.redRunners;
  if (st !== "yellow" || n.runDrawn === key || !canStop || bumperToLine <= 0 || n.v < RUNNER_MIN_MPS || world.t < state.next || !ordinary(n)) return null;
  const inter = world.map.intersections.get(ctl.id);
  const after = n.path.edges[n.path.edges.indexOf(e) + 1];
  const turn = after ? world.map.classifyTurn(world.map.turnAngle(e.id, after.id)) : "straight";
  const toRed = inter ? secondsToRed(inter, e.id, turn, world.t) : null;
  const arrive = bumperToLine / n.v;
  if (toRed === null || arrive < toRed - RUN_EARLY_S || arrive > toRed + RUN_LATE_S || boxBusy()) return null;
  n.runDrawn = key;
  if (state.random() >= RUNNER_CHANCE) return null;
  return commitRunner(world, n, e.id, ctl.id);
}

// The speed a committed runner holds (it never speeds up) until its rear is clear of the junction,
// noting when its front crosses the line. Infinity when it is not running a light.
export function runnerCap(world, n, path, front) {
  const r = n.runner;
  if (!r) return Infinity;
  const e = path.edges.find((x) => x.id === r.edge), edge = world.map.edges.get(r.edge);
  if (!e || !edge?.control || world.t - r.at > RUNNER_MAX_S) { n.runner = null; return Infinity; }
  const lineS = e.sStart + (edge.control.s_line / Math.max(1, edge.length)) * (e.sEnd - e.sStart);
  if (front >= lineS) r.entered = true;
  if (path.s - n.spec.rearOverhang > e.sEnd + world.map.crossingHalfWidth(r.edge)) { n.runner = null; return Infinity; }
  return r.speed;
}

// The one test. Of `others`, the vehicle crossing the way of `observer`, entering junction `inter`
// heading `heading`, that threatens it: one on a red or amber light that cannot stop before its line,
// or one that has entered the junction on one (the nearest to the junction's centre), or null.
// { vehicle, relation: "cannot_stop" | "in_junction", to_line_m (its bumper to its line, or null),
//   to_centre_m, side: "left" | "right" }
export function runnerThreat(world, observer, inter, heading, others) {
  const map = world.map;
  let best = null;
  for (const o of others) {
    if (o === observer || !o.spec || o.kind === "pedestrian" || o.parked || !(o.v > THREAT_MIN_MPS)) continue;
    if (Math.abs(o.x - inter.x) > LOOK_M || Math.abs(o.y - inter.y) > LOOK_M) continue;
    const diff = Math.abs(wrap(o.psi - heading));
    if (diff < CROSS_LO || diff > CROSS_HI) continue;
    let relation = null, toLine = null;
    if (o.runner?.inter === inter.id && o.runner.entered) relation = "in_junction";
    else {
      const a = approachTo(map, o, inter.id);
      const edge = a ? map.edges.get(a.edge) : null;
      if (!edge || edge.control?.type !== "signal" || edge.control.id !== inter.id) continue;
      const light = movementSignal(approachPhase(inter, a.edge, world.t), "straight");
      if (light !== "red" && light !== "yellow") continue;
      toLine = a.to_node_m - (edge.length - edge.control.s_line);
      if (toLine < 0) relation = "in_junction";
      else if (!canStopAt(o, toLine)) relation = "cannot_stop";
      else continue;
    }
    const d = Math.hypot(o.x - inter.x, o.y - inter.y);
    if (best && d >= best.to_centre_m) continue;
    const right = (o.x - observer.x) * Math.sin(heading) - (o.y - observer.y) * Math.cos(heading);
    best = { vehicle: o, relation, to_line_m: toLine, to_centre_m: d, side: right > 0 ? "right" : "left" };
  }
  return best;
}

// Whether a driver of `vehicle`, `bumperToLine` short of the line, can still stop there (hard braking
// allowed: a runner is an emergency).
export function canStopForRunner(vehicle, bumperToLine) {
  const v = Math.max(0, vehicle.v);
  return v < 0.5 || bumperToLine - 0.5 >= v * 0.2 + v * v / (2 * comfort().hardDecel);
}

// Traffic: whether driver `n`, on a green at `inter` coming in on edge `edgeId`, waits at the line
// for a runner among `others` (only short of the line, within HOLD_LOOK_M, and able to stop there).
export function runnerHold(world, n, edgeId, inter, bumperToLine, others) {
  if (!inter || bumperToLine <= 0 || bumperToLine > HOLD_LOOK_M) return false;
  if (n.v > 1 && bumperToLine < n.v * n.v / (2 * Math.min(4, comfort().hardDecel)) + 1) return false;
  return !!runnerThreat(world, n, inter, world.map.headingIn(edgeId), others);
}

// The driven car's sensing: a runner crossing its way at the signal ahead while its own light is green
// and it has not entered, from the vehicles it can see. Null when there is none.
export function redLightRunner(world, i, heading) {
  if (!i || i.control !== "signal" || i.signal !== "green" || i.entered || i.bumper_to_line_m > LOOK_M) return null;
  const inter = world.map.intersections.get(i.id);
  if (!inter) return null;
  const threat = runnerThreat(world, world.ego, inter, heading, seenNear(world, inter));
  if (!threat) return null;
  const o = threat.vehicle, r1 = (x) => Math.round(x * 10) / 10;
  const edge = world.route?.controls.find((c) => c.control.id === i.id)?.edge;
  return { id: o.id ?? null, relation: threat.relation, from: threat.side, speed: r1(o.v),
    to_line_m: threat.to_line_m === null ? null : r1(threat.to_line_m), to_centre_m: r1(threat.to_centre_m),
    wait: canStopForRunner(world.ego, i.bumper_to_line_m), stop_s_route: i.s_line_route, bumper_to_stop_m: i.bumper_to_line_m - 0.5,
    green_for_s: edge ? greenFor(inter, edge, i.turn || "straight", world.t, FRESH_GREEN_S + 1) : null };
}

// The traffic the driven car can see near junction `inter`: what its sensing and the audit both look at.
function seenNear(world, inter) {
  return world.npcs.filter((o) => Math.abs(o.x - inter.x) < LOOK_M && Math.abs(o.y - inter.y) < LOOK_M && world.sees(world.ego, o));
}

// The audit, each step on the way up to a signal: the runner the car must not enter ahead of, once it
// has been in sight while the car could still stop for it (`world.runnerCall` remembers that per
// junction), or null. `past`: how far the front bumper is past the line.
export function auditRunner(world, interId, edgeId, turn, heading, past) {
  const inter = world.map.intersections.get(interId);
  if (!inter || past > 0.5 || past < -HOLD_LOOK_M) return null;
  if (movementSignal(approachPhase(inter, edgeId, world.t), turn) !== "green") return null;
  const ego = world.ego, others = seenNear(world, inter);
  const threat = others.length ? runnerThreat(world, ego, inter, heading, others) : null;
  const call = world.runnerCall?.id === interId ? world.runnerCall : (world.runnerCall = { id: interId, owed: false });
  if (threat && past < 0 && canStopForRunner(ego, -past)) call.owed = true;
  return threat && call.owed ? threat : null;
}

// The HUD line for a runner the car waits for, or sees: said once each time it changes.
export function runnerNotice(world, snap) {
  const r = snap?.red_light_runner;
  if (!r) return null;
  return { key: `${r.id}:${r.wait}`, text: r.wait ? "CAR RUNNING THE RED · WAIT" : "CAR RUNNING THE RED · LOOK BOTH WAYS", wait: r.wait };
}
