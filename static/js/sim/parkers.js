// Traffic parallel parking (World option `parkers`): now and then, from the feature's own seeded random
// stream, the ordinary traffic car right ahead of the driven car in its lane, on a street with a parking
// lane and a free gap long enough to parallel park in, becomes a parker. It signals right, slows, stops
// alongside the car parked in front of the gap (its rear bumper a little behind that car's, about a metre
// out from it), pauses to check behind, then reverses in and straightens up. The geometry and the
// manoeuvre are the driven car's own (sim/parallel-park.js: `freeStretches` and `planSpaceOn` find the
// space and plan it on the car's own path, `planParking` and `stepParking` drive it on the shared car
// model), so there is one parker in the sim, not two. Once in, it is a parked car (sim/parking.js): it
// leaves the traffic (`world.npcs`) and joins `world.parked`, its slot taken, so `world.obstaclesNear`
// keeps returning it through the parked cars' grid as for every other parked car, and nothing treats it
// as moving traffic any more (a car that stayed in the fleet would be followed as a stopped leader and
// counted twice). Waiting at its start, it gives up and drives on when something stands in the room it
// reverses into for GIVE_UP_S; once reversing, it stops for anyone moving into that room or standing
// within REV_CLEAR_M behind it, and gives up only while it is still close to parallel in its lane.
//
// Everyone behind it keeps back: the driven car, traffic and cyclists stop at its hold line, `hold` metres
// (the length of its reverse and HOLD_MARGIN_M more than the driven car's own parking asks of traffic,
// World.parkHold) behind the rear bumper it will have where it stops to start, don't creep into that room
// and don't go round it, until it is in. A driving instructor teaches the same: a car ahead signalling and
// stopping beside a gap is about to reverse; stop well back, leave it the room, and wait, rather than try
// to squeeze by while it is signalling or reversing.
//
// `parkerConflict` is the one test, shared by the driven car's sensing (brain/sensors.js
// `parking_ahead`), the candidates (`wait_for_parker`, the rejection `blocks_parking_car`), Rules, the
// cautious agent, the model wording, traffic (sim/npc.js) and the audit: of the parkers going the
// observer's way, the nearest whose hold line lies on the observer's path within BAND_M of its line, with
// the observer still behind its rear bumper; with how far the observer's front bumper is from the hold
// line (negative: inside the room it needs). The audit counts the driven car in that room while the
// parker is stopped to start or reversing, and going past it while it is signalling or reversing
// after having been behind it, as `parking_conflicts`; the metric reaches reports, and fails a drive,
// only once a parker has signalled ahead of the car (`World.parkersSeen`). With the option off nothing
// here is computed and no random number is drawn.

import { rng } from "../common.js";
import { CAR } from "./vehicle.js";
import { projectPoint } from "../map/mapdata.js";
import { obbOverlap } from "./collision.js";
import { speedControl } from "./controller.js";
import { freeStretches, planSpaceOn, planParking, stepParking, reversing, frameOf, parkRoom, solveS } from "./parallel-park.js";
import { behindInLane } from "./tailgaters.js";
import { isEmergency, isEmergencyVehicle } from "./emergency.js";
import { isPlow } from "./snow-plow.js";

// Free drives: the car ahead is looked at every PARKER_CHECK_S, from PARKER_FIRST_S into the drive, and
// becomes a parker with PARKER_CHANCE (a draw only when it could); one at a time, and none for
// PARKER_COOLDOWN_S after one has parked (PARKER_RETRY_S after one gave up).
export const PARKER_CHANCE = 0.35;
export const PARKER_CHECK_S = 3;
export const PARKER_FIRST_S = 25;
export const PARKER_COOLDOWN_S = 90;
export const PARKER_RETRY_S = 30;
// The car ahead: within PICK_M of the driven car's front, moving at PICK_MIN_MPS or more; its stop
// STOP_MIN_M to STOP_MAX_M ahead along its path, and at least what stopping at PARK_DECEL needs; the hold
// line far enough ahead of the driven car to stop for at EGO_DECEL, and HOLD_ROOM_M more.
export const PICK_M = 60;
export const PICK_MIN_MPS = 3;
export const STOP_MIN_M = 18;
export const STOP_MAX_M = 75;
export const PARK_DECEL = 1.8;
export const EGO_DECEL = 2.0;
export const HOLD_ROOM_M = 8;
// The room kept behind it: the driven car's own `hold` (its reverse's length and 1.5 m) and this.
export const HOLD_MARGIN_M = 1.5;
// The parker: eases right in its lane up to its start from NUDGE_FROM_M out at NUDGE_MPS; stops within
// STOP_NEAR_M of its start (giving up past it by OVERSHOOT_M); pauses there PAUSE_S, signalling and
// checking behind; gives up after GIVE_UP_S with someone in the room it needs (or after MAX_S before it
// has started back), and, reversing, only while within GIVE_UP_PHI of parallel; and stops reversing for
// anything standing within REV_CLEAR_M behind it; stuck, it tries again from where it stands every RETRY_S.
export const NUDGE_FROM_M = 20;
export const NUDGE_MPS = 0.4;
export const STOP_NEAR_M = 2.5;
export const OVERSHOOT_M = 3;
export const PAUSE_S = 2;
export const GIVE_UP_S = 12;
export const MAX_S = 75;
export const GIVE_UP_PHI = 12 * Math.PI / 180;
export const REV_CLEAR_M = 1.0;
export const RETRY_S = 1.5;
// The one test: the hold line within BAND_M of the observer's line, within LOOK_M ahead of its front.
// Moving at COMING_MPS or more toward the room it needs, within COMING_S of it, someone is coming.
export const BAND_M = 1.6;
export const LOOK_M = 90;
export const COMING_MPS = 1;
export const COMING_S = 2.5;
const LANE_HALF_M = 1.75;
// The audit: the driven car's front more than AUDIT_SLACK_M past the hold line once a parker has stopped
// to start or is reversing; past its front, after having been behind it, while it is still at it.
export const AUDIT_SLACK_M = 0.5;

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const r1 = (x) => Math.round(x * 10) / 10;
const at = (f, u, w) => [f.ox + u * Math.cos(f.h) + w * Math.sin(f.h), f.oy + u * Math.sin(f.h) - w * Math.cos(f.h)];
const rearBumper = (v) => [v.x - Math.cos(v.psi) * v.spec.rearOverhang, v.y - Math.sin(v.psi) * v.spec.rearOverhang];
const frontBumper = (v) => { const f = v.spec.length - v.spec.rearOverhang; return [v.x + Math.cos(v.psi) * f, v.y + Math.sin(v.psi) * f]; };

// The World's state: whether traffic parks, its random stream, when the next may be picked, and the
// parkers at it now (traffic cars, `n.parker` holding each one's plan and progress).
export function createParkers({ enabled = false, seed = 1 } = {}) {
  return { enabled: !!enabled, random: enabled ? rng(seed * 2654435761 + 58042) : null, next: enabled ? PARKER_FIRST_S : Infinity,
    checkAt: 0, active: [], committed: 0, parked: 0, gaveUp: 0, behind: false };
}

// Ordinary cars only: not cyclists, transit, school buses, trains, trucks at work, emergency vehicles,
// plows, cars pulling out or parking already, running a light, passing a cyclist, tailgating, or changing
// lanes; and not one that has given up parking once.
const ordinary = (n) => n.kind !== "bike" && !n.transit && !n.school && !n.rail && !n.collect && !n.pull && !n.parking && !n.parker && !n.runner && !n.cyc
  && !n.tailgate && !n.lc && !n.backoff && !(n.frozen > 0) && !n.parkerTried && !isPlow(n) && !isEmergency(n) && !isEmergencyVehicle(n) && (n.spec || CAR).length <= 5.5;

// The plan for traffic car `n` to park in the nearest free space ahead on its street, or null: on its
// current edge, in the lane beside the right parking lane, its start STOP_MIN_M to STOP_MAX_M ahead and
// far enough to stop for, with nothing between it and there. { plan, toStop }.
export function parkerPlan(world, n) {
  const map = world.map, path = n.path, cur = path?.currentEdge();
  const e = cur && map.edges.get(cur.id);
  if (!e || !e.parking?.[1] || cur.lane !== e.lanes - 1 || e.ring) return null;
  // (never on the block of a work zone, a lane closure or a double-parked van, as for the driven car)
  if (world.workZones?.zones.some((z) => z.closed === e.id || z.open === e.id) || world.laneClosures?.zones.some((z) => z.edge === e.id) || world.doubleParked?.vans.some((d) => d.edge === e.id || d.opposite === e.id)) return null;
  const v = Math.max(0, n.v), least = Math.max(STOP_MIN_M, v * v / (2 * PARK_DECEL) + 6);
  let best = null;
  for (const { a, b, spans } of freeStretches(world, e, n.spec)) {
    const plan = planSpaceOn(world, path, e, a, b, n.spec, spans);
    if (!plan || plan.slots.some((slot) => slot.reserved)) continue;
    // (and its whole S clear of what stands about it: the space's own check is the car in front and the
    // car behind, and the front swings out, on a narrow street into the cars at the other kerb)
    if (!sClear(world, plan, n.spec)) continue;
    const q = projectPoint(path.pts, path.cum, at(plan, plan.startU, plan.startW), null);
    if (!q || q.distance > 2) continue;
    const toStop = q.s - path.s;
    if (toStop < least || toStop > STOP_MAX_M || (best && toStop >= best.toStop)) continue;
    // (nothing in its way up to there)
    if (n.lead && n.lead.gap < toStop + 4) continue;
    best = { plan, toStop };
  }
  return best;
}

// Whether a car of `spec` can reverse into the space of `plan` on its S from where it starts, its body
// clear of anything standing (`parkRoom`, every SWEEP_M of the way, as the manoeuvre itself looks).
const SWEEP_M = 0.25;
export function sClear(world, plan, spec) {
  const R = plan.R, S = solveS(R, plan.X, plan.goalW - plan.startW);
  let pose = { x: at(plan, plan.startU, plan.startW)[0], y: at(plan, plan.startU, plan.startW)[1], psi: plan.h, spec, v: 0 };
  for (const [steer, length] of [[-spec.maxSteer, R * S.phi1], [0, S.d], [spec.maxSteer, R * S.phi1]]) {
    const k = Math.tan(steer) / spec.wheelbase;
    for (let done = 0; done < length - 1e-6; done += SWEEP_M) {
      const d = -Math.min(SWEEP_M, length - done);
      if (!parkRoom(pose, world, steer, d)) return false;
      const psi = pose.psi + k * d;
      pose = Math.abs(k) < 1e-9 ? { ...pose, x: pose.x + Math.cos(pose.psi) * d, y: pose.y + Math.sin(pose.psi) * d }
        : { ...pose, x: pose.x + (Math.sin(psi) - Math.sin(pose.psi)) / k, y: pose.y - (Math.cos(psi) - Math.cos(pose.psi)) / k, psi };
    }
  }
  return true;
}

// Make traffic car `n` a parker for `plan`: its hold line, the slots of the space reserved for it, and
// its right indicator on. `stay`: once in, it stays parked (a challenge's).
export function commitParker(world, n, plan, { stay = false } = {}) {
  const state = world.parkers, spec = n.spec || CAR, hold = plan.hold + HOLD_MARGIN_M, rearU = plan.startU - spec.rearOverhang;
  n.parker = {
    phase: "approach", since: world.t, id: plan.id, hold, shift: 0, pause: 0, blocked: 0, blocker: null, law: null, stay: !!stay,
    plan: { id: plan.id, edge: plan.edge, ox: plan.ox, oy: plan.oy, h: plan.h, kerbW: plan.kerbW, laneW: plan.laneW, startU: plan.startU, startW: plan.startW,
      goalU: plan.goalU, goalW: plan.goalW, R: plan.R, phi1: plan.phi1, sFrom: plan.sFrom, sTo: plan.sTo, nudge: plan.nudge, hold: plan.hold, slots: plan.slots },
    // where its rear axle stops to start, the hold line (at its lane's centre), and its rear bumper there
    start: at(plan, plan.startU, plan.startW), line: at(plan, rearU - hold, plan.laneW), lineU: rearU - hold,
  };
  for (const slot of plan.slots) if (!slot.reserved && !slot.occupant) slot.reserved = n;
  n.signal = "right";
  state.active.push(n); state.committed++;
  return n.parker;
}

// Let a parker go: its slots, its indicator and reverse lamps; it carries on as ordinary traffic.
function release(world, n, gaveUp) {
  const state = world.parkers, pk = n.parker;
  for (const slot of pk?.plan.slots || []) if (slot.reserved === n) slot.reserved = null;
  delete n.parker;
  n.signal = null; n.reverseLamps = false;
  state.active = state.active.filter((o) => o !== n);
  if (gaveUp) { n.parkerTried = true; n.lcCooldown = Math.max(n.lcCooldown || 0, 2); state.gaveUp++; }
  state.next = Math.max(state.next, world.t + (gaveUp ? PARKER_RETRY_S : PARKER_COOLDOWN_S));
}

// In: it leaves the traffic and is a parked car, in the slot nearest where it stands.
function settle(world, fleet, n) {
  const pk = n.parker;
  let slot = null, best = Infinity;
  for (const s of pk.plan.slots) {
    const d = Math.hypot(s.x - n.x, s.y - n.y);
    if (!s.occupant && (s.reserved === n || !s.reserved) && d < best) { best = d; slot = s; }
  }
  const stay = pk.stay;
  release(world, n, false);
  world.parkers.parked++;
  const i = fleet.vehicles.indexOf(n);
  if (i >= 0) fleet.vehicles.splice(i, 1);
  Object.assign(n, { v: 0, a: 0, vy: 0, r: 0, ax: 0, delta: 0, edge: pk.plan.edge, curb: "right", slot, lead: null });
  if (stay) n.stay = true;
  world.parked.add(n);
}

// Each traffic step (NpcFleet.step, before the drivers move): parkers that have left the traffic are let
// go, and now and then the car right ahead of the driven car becomes one.
export function manageParkers(world, fleet) {
  const state = world.parkers;
  for (const n of [...state.active]) if (!n.parker || !fleet.vehicles.includes(n)) { if (n.parker) release(world, n, true); else state.active = state.active.filter((o) => o !== n); }
  if (state.active.length || world.t < state.next || world.t < state.checkAt || !world.route) return;
  state.checkAt = world.t + PARKER_CHECK_S;
  const ego = world.ego;
  let pick = null, best = Infinity;
  for (const n of fleet.vehicles) {
    if (!ordinary(n) || n.v < PICK_MIN_MPS || Math.abs(n.x - ego.x) > PICK_M + 10 || Math.abs(n.y - ego.y) > PICK_M + 10) continue;
    // (the driven car behind it in its lane: its front to this car's rear bumper)
    const g = behindInLane(n, ego, PICK_M);
    if (g !== null && g < best) { best = g; pick = n; }
  }
  if (!pick) return;
  const found = parkerPlan(world, pick);
  if (!found) return;
  // (its hold line on the driven car's way, far enough ahead to stop for comfortably)
  const route = world.route, line = at(found.plan, found.plan.startU - pick.spec.rearOverhang - found.plan.hold - HOLD_MARGIN_M, found.plan.laneW);
  const q = projectPoint(route.pts, route.cum, line, route.hint), p = projectPoint(route.pts, route.cum, [ego.x, ego.y], route.hint);
  // (on the route itself, not past its end, where a projection lands on the route's last point)
  if (!q || !p || q.distance > BAND_M + Math.abs(p.lateral) + 0.5 || Math.abs(q.lateral - p.lateral) > BAND_M || q.s > route.length - 2) return;
  const v = Math.max(0, ego.v), toHold = q.s - (p.s + ego.spec.length - ego.spec.rearOverhang);
  if (toHold < v * v / (2 * EGO_DECEL) + HOLD_ROOM_M) return;
  if (state.random() < PARKER_CHANCE) commitParker(world, pick, found.plan);
}

// Who is in the room parker `n` needs behind it, or on the way into it: { o, inside } or null. The room:
// along the kerb from its hold line, less HOLD_MARGIN_M (the room it really needs: the margin is
// for those behind it to keep), to its rear bumper, across from its lane's far side to the kerb.
function zoneBlocker(world, n, { standingWithin = null } = {}) {
  const pk = n.parker, f = pk.plan, me = frameOf(n, f), rearU = me.u - n.spec.rearOverhang * Math.cos(me.phi) + 0.5;
  const wLo = f.laneW - LANE_HALF_M, wHi = f.kerbW;
  const others = world.obstaclesNear(n.x, n.y, pk.hold + 30);
  let coming = null;
  for (const o of [world.ego, ...others]) {
    if (o === n || o.parked || !o.obb) continue;
    const box = o.obb(), c = Math.cos(box.heading), s = Math.sin(box.heading);
    let uMin = Infinity, uMax = -Infinity, wMin = Infinity, wMax = -Infinity;
    for (const [p, q] of [[1, 1], [1, -1], [-1, -1], [-1, 1]]) {
      const x = box.center[0] + p * box.halfLength * c - q * box.halfWidth * s, y = box.center[1] + p * box.halfLength * s + q * box.halfWidth * c;
      const g = frameOf({ x, y, psi: 0 }, f);
      uMin = Math.min(uMin, g.u); uMax = Math.max(uMax, g.u); wMin = Math.min(wMin, g.w); wMax = Math.max(wMax, g.w);
    }
    if (wMax < wLo || wMin > wHi || uMin > rearU) continue;
    const moving = Math.abs(o.v || 0) > 0.3;
    if (uMax > pk.lineU + HOLD_MARGIN_M) {
      // reversing: anything moving there, or standing within REV_CLEAR_M behind it
      if (!standingWithin || moving || obbOverlap(n.obb(), box, standingWithin)) return { o, inside: true };
      continue;
    }
    // (coming up to it, going its way)
    const along = (o.v || 0) * Math.cos(wrap((o.psi || 0) - f.h));
    if (along > COMING_MPS && (pk.lineU - uMax) / along < COMING_S) coming ||= { o, inside: false };
  }
  return coming;
}

const hold = (n, dt) => { n.step(dt, { steer: n.delta, accel: speedControl(n.v, 0, { gain: 4, maxBrake: 3 }), reverse: n.v < 0 }); if (Math.abs(n.v) < 0.03) n.v = 0; };

// Parker `n`'s step (NpcFleet.step, for a traffic car with `n.parker`, before it drives): returns true
// where it moved the car itself (stopped at its start, or reversing in), false where it drives on in
// its lane (on its way up to its start, with `parkerStop` and `n.parker.shift`, or having given up).
export function stepParker(world, fleet, n, dt) {
  const pk = n.parker;
  n.lcCooldown = Math.max(n.lcCooldown || 0, 1);
  if (pk.phase === "approach") {
    const q = projectPoint(n.path.pts, n.path.cum, pk.start, null);
    const toStop = q && q.distance < 3 ? q.s - n.path.s : -Infinity;
    pk.toStop = toStop;
    // (past it, too long about it, off its way to it, or making way for an emergency vehicle: it gives up)
    if (toStop < -OVERSHOOT_M || world.t - pk.since > MAX_S || n.lc || n.yieldEv) { release(world, n, true); return false; }
    // (easing right toward where it starts, alongside the car parked in front of the space)
    const want = toStop < NUDGE_FROM_M ? pk.plan.nudge : 0;
    pk.shift += Math.max(-NUDGE_MPS * dt, Math.min(NUDGE_MPS * dt, want - pk.shift));
    n.signal = "right";
    if (!(Math.abs(n.v) < 0.2 && toStop < STOP_NEAR_M)) return false;
    pk.phase = "stop"; pk.pause = 0; pk.blocked = 0;
  }
  n.signal = "right";
  if (pk.phase === "stop") {
    hold(n, dt);
    const b = zoneBlocker(world, n);
    pk.blocker = b ? b.o.id ?? null : null;
    if (b?.inside) {
      pk.blocked += dt;
      if (pk.blocked > GIVE_UP_S || world.t - pk.since > MAX_S) { release(world, n, true); return false; }
      return true;
    }
    if (b) return true;
    pk.pause += dt;
    if (pk.pause >= PAUSE_S) { pk.phase = "reverse"; pk.blocked = 0; pk.law = planParking(pk.plan); }
    return true;
  }
  const law = pk.law;
  if (law.phase === "parked") { settle(world, fleet, n); return true; }
  const back = reversing(law) || law.phase === "start";
  const b = back ? zoneBlocker(world, n, { standingWithin: REV_CLEAR_M }) : null;
  pk.blocker = b?.inside ? b.o.id ?? null : null;
  n.reverseLamps = reversing(law);
  const near = () => { const f = frameOf(n, pk.plan); return Math.abs(f.phi) < GIVE_UP_PHI && Math.abs(f.w - pk.plan.startW) < 0.8; };
  // (stuck: something in the way, a door opening beside it, say: wait and try again from where it stands,
  // RETRY_S at a time; after GIVE_UP_S of that it gives up while still near its start, or else keeps trying)
  if (law.phase === "stuck") {
    hold(n, dt);
    pk.stuckFor = (pk.stuckFor || 0) + dt;
    if (pk.stuckFor > GIVE_UP_S && near()) { release(world, n, true); return false; }
    if ((pk.retry = (pk.retry || 0) + dt) >= RETRY_S && Math.abs(n.v) < 0.05) { pk.retry = 0; pk.law = planParking(pk.plan); }
    return true;
  }
  if (b) {
    hold(n, dt);
    if (b.inside) { pk.blocked += dt; if (pk.blocked > GIVE_UP_S && Math.abs(n.v) < 0.05 && near()) { release(world, n, true); return false; } }
    return true;
  }
  pk.blocked = 0;
  stepParking(n, law, world, dt, speedControl);
  return true;
}

// On its way up to its start: how far its front bumper is from where it should stop (for its driver's
// stop, sim/npc.js), or null.
export function parkerStop(n) {
  const pk = n.parker;
  return pk?.phase === "approach" && Number.isFinite(pk.toStop) ? pk.toStop : null;
}

// The one test. For `vehicle` going along `path` (its `pts` and `cum`), its front bumper at `front` along
// it and `lat` right of it (`hint`: where to look on the path first): the nearest parker it is behind in
// that parker's lane, or null: { parker, phase, to_hold_m, gap_m, hold_m, line_s }.
export function parkerConflict(world, vehicle, path, front, { lat = 0, hint = null } = {}) {
  const list = world.parkers?.active;
  if (!list?.length || !path?.pts) return null;
  let best = null;
  for (const P of list) {
    const pk = P.parker;
    if (!pk || P === vehicle || Math.cos(wrap(vehicle.psi - pk.plan.h)) < 0.5) continue;
    if (Math.abs(P.x - vehicle.x) > LOOK_M + 20 || Math.abs(P.y - vehicle.y) > LOOK_M + 20) continue;
    const qH = projectPoint(path.pts, path.cum, pk.line, hint);
    if (!qH || qH.distance > BAND_M + Math.abs(lat) + 0.5 || Math.abs(qH.lateral - lat) > BAND_M) continue;
    const qR = projectPoint(path.pts, path.cum, rearBumper(P), hint);
    if (!qR || front > qR.s + 0.5) continue;
    const toHold = qH.s - front;
    if (toHold > LOOK_M || (best && toHold >= best.to_hold_m)) continue;
    best = { parker: P, phase: pk.phase, to_hold_m: toHold, gap_m: qR.s - front, hold_m: pk.hold, line_s: qH.s };
  }
  return best;
}

// What each phase is called, for sensing and models.
export const PARKER_PHASE = { approach: "signalling", stop: "stopped", reverse: "reversing" };

// The driven car's sensing: the parker it is behind, or null. `p`: its route projection; `frontS`: its
// front bumper's route arc length.
export function parkerSensing(world, p, frontS) {
  const route = world.route, c = parkerConflict(world, world.ego, route, frontS, { lat: p.lateral, hint: p.index });
  if (!c || !world.sees(world.ego, c.parker)) return null;
  const P = c.parker, pk = P.parker;
  return { id: P.id ?? null, vehicle: P, phase: PARKER_PHASE[pk.phase], signal: "right", reverse_lights: !!P.reverseLamps, gap_m: r1(c.gap_m), hold_m: r1(c.hold_m),
    bumper_to_stop_m: r1(c.to_hold_m), stop_s_route: Math.max(c.line_s, frontS), wait: true, in_room: c.to_hold_m < -AUDIT_SLACK_M,
    ...(pk.phase === "approach" && Number.isFinite(pk.toStop) ? { stops_in_m: r1(Math.max(0, pk.toStop)) } : {}) };
}

// The audit, each step: the driven car in the room a parker needs while it is stopped to start or
// reversing (it blocks it: whether it drove in then or had already crept in behind it), and going past one it was behind while it is still at it, each once per
// parker, as `parking_conflicts` (World.parkerCalls).
export function auditParkers(world) {
  const state = world.parkers, route = world.route;
  state.behind = false;
  if (!state.active.length || !route) return;
  const ego = world.ego, p = projectPoint(route.pts, route.cum, [ego.x, ego.y], route.hint);
  if (!p) return;
  const front = p.s + ego.spec.length - ego.spec.rearOverhang;
  const c = parkerConflict(world, ego, route, front, { lat: p.lateral, hint: p.index });
  const calls = world.parkerCalls ||= new Map();
  const count = (ev) => { world.violations.parking_conflicts = (world.violations.parking_conflicts || 0) + 1; world.events.push(ev); };
  for (const P of state.active) {
    const pk = P.parker, mine = c?.parker === P ? c : null, at = pk.phase === "stop" || pk.phase === "reverse";
    const call = calls.get(P.id) || { behind: false, blocked: false, passed: false };
    calls.set(P.id, call);
    if (mine) { call.behind = true; world.parkersSeen = true; if (at) state.behind = true; }
    if (mine && at && !call.blocked && mine.to_hold_m < -AUDIT_SLACK_M) {
      call.blocked = true;
      count({ type: "parking_conflict", with: P.id ?? null, reason: "blocked", phase: PARKER_PHASE[pk.phase], into_m: r1(-mine.to_hold_m) });
    }
    if (!mine && call.behind && !call.passed) {
      const q = projectPoint(route.pts, route.cum, frontBumper(P), p.index);
      if (q && front > q.s && Math.abs(q.lateral - p.lateral) < 6 && q.s - p.s < 30) {
        call.passed = true;
        count({ type: "parking_conflict", with: P.id ?? null, reason: "passed", phase: PARKER_PHASE[pk.phase] });
      }
    }
  }
}

// The HUD line for a car parking ahead of the driven car: said once each time it changes.
export function parkerNotice(world, snap) {
  let pa = snap?.parking_ahead;
  if (!pa && !snap && world.parkers?.active.length && world.route) {
    const ego = world.ego, p = projectPoint(world.route.pts, world.route.cum, [ego.x, ego.y], world.route.hint);
    const c = p && parkerConflict(world, ego, world.route, p.s + ego.spec.length - ego.spec.rearOverhang, { lat: p.lateral, hint: p.index });
    if (c && world.sees(ego, c.parker)) pa = { id: c.parker.id, phase: PARKER_PHASE[c.parker.parker.phase] };
  }
  if (!pa) return null;
  return { key: `${pa.id}:${pa.phase}`, text: pa.phase === "reversing" ? "CAR PARKING AHEAD · REVERSING IN · WAIT" : "CAR PARKING AHEAD · WAIT", wait: true };
}
