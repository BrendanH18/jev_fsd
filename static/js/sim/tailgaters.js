// Tailgaters (World option `tailgaters`): the first hazard behind the car rather than ahead of it. Now
// and then, from the feature's own seeded random stream, an ordinary traffic car that has come up
// behind the driven car in its lane closes up to an aggressive gap, well under a second, and holds it:
// an impatient driver in a hurry. It edges in and out, drifts left in its lane now and then to look
// past the car, and flashes its headlights (render-only, render/tailgaters.js). It stays ordinary
// traffic (sim/npc.js), on the shared car model, with a tailgating driver layered on: a short time gap
// (TAIL_T, TAIL_S0_M), a wish to go faster (TAIL_HURRY of the limit), and the car's brake lights
// noticed late: it reacts to the car's speed TAIL_REACT_S after the fact. Once it notices it brakes
// for real, as hard as the road allows (it is aggressive, not suicidal), so it follows a car that
// brakes early and gently without trouble; a sudden hard stop, a brake check, can leave it too little
// room, and the collision audit (sim/world.js) puts that rear-end on the follower.
//
// The right response, which the driven car's brains are taught (and Canadian driver's handbooks say):
// never brake-check; brake earlier and more gently where the situation ahead allows; leave twice the
// usual gap ahead (sim/following.js, room TAIL_ROOM), so as to brake gently later; and let the
// tailgater by: move right where another lane goes the car's way (`let_tailgater_pass`), or else ease
// off slightly (`ease_off_for_tailgater`). Never speed up to please it.
//
// `tailgaterThreat` is the one test, shared by the driven car's sensing (brain/sensors.js `tailgater`),
// the candidates (`let_tailgater_pass`, `ease_off_for_tailgater`, and the rejection
// `brakes_hard_with_tailgater`), Rules, the cautious agent, the model wording, the coach and the audit:
// a vehicle behind the observer in its lane, going its way at TAIL_THREAT_MIN_MPS or more, whose front
// bumper is less than TAIL_THREAT_S of its speed behind the observer's rear bumper.
//
// `brakingNeed` is what the situation ahead requires of the car, from the shared tests: closing on
// whatever is in its path ahead (a vehicle, a person, a goose; braking now or not, with the
// FOLLOWING_STANDSTILL_M sim/following.js leaves at a standstill, less a metre), a red light, or an
// amber it can stop for (sim/amber.js stopping distance), or a stop sign not yet stopped at, at the
// line; the route's bends at comfortable cornering; and the destination. The audit counts braking
// harder than BRAKE_CHECK_DECEL for BRAKE_CHECK_HOLD_S, at more than BRAKE_CHECK_SLACK above that
// need, with a tailgater close behind, as `brake_checks`; the metric reaches reports, and fails a
// drive, only once a tailgater has followed the car (`World.tailgatersSeen`). With the option off
// nothing here is computed and no random number is drawn.

import { rng } from "../common.js";
import { CAR, comfort } from "./vehicle.js";
import { FOLLOWING_STANDSTILL_M } from "./following.js";
import { amberStoppingDistance } from "./amber.js";
import { approachPhase, movementSignal } from "./signals.js";
import { controlAt } from "./outage.js";
import { isEmergency, isEmergencyVehicle } from "./emergency.js";
import { isPlow } from "./snow-plow.js";

// Free drives: a car behind is looked at every TAIL_CHECK_S, from TAIL_FIRST_S into the drive, and
// becomes a tailgater with TAIL_CHANCE (a draw only when there is one); after one, none for
// TAIL_COOLDOWN_S. One is picked only up to TAIL_PICK_M behind, both going at TAIL_MIN_MPS or more.
export const TAIL_CHANCE = 0.3;
export const TAIL_CHECK_S = 2;
export const TAIL_FIRST_S = 20;
export const TAIL_COOLDOWN_S = 60;
export const TAIL_PICK_M = 50;
export const TAIL_MIN_MPS = 6;
// It gives up once it is past the car, once it has not been behind it in its lane for TAIL_LOST_S,
// or after TAIL_MAX_S.
export const TAIL_LOST_S = 6;
export const TAIL_MAX_S = 120;
// The tailgating driver: time gap TAIL_T (swinging by TAIL_EDGE either way over TAIL_EDGE_S: edging in
// and out), standstill gap TAIL_S0_M, cruising at TAIL_HURRY of the limit (and at TAIL_AFTER once it
// gives up). It sees the car's speed, and its brake lights, TAIL_REACT_S late (judging how hard the car
// brakes over TAIL_JUDGE_S), and then brakes TAIL_MATCH_MPS2 harder than it sees the car braking, or as
// hard as stopping behind it needs if the car brakes on to a stop (up to the hardest the road allows).
export const TAIL_T = 0.3;
export const TAIL_EDGE = 0.2;
export const TAIL_EDGE_S = 7;
export const TAIL_S0_M = 1.2;
export const TAIL_HURRY = 1.2;
export const TAIL_AFTER = 1.1;
export const TAIL_REACT_S = 0.4;
export const TAIL_JUDGE_S = 0.2;
export const TAIL_MATCH_MPS2 = 1.0;
// Now and then it drifts TAIL_PEEK_M left in its lane, for TAIL_PEEK_FOR_S every TAIL_PEEK_EVERY_S,
// at TAIL_PEEK_MPS sideways, to look past the car; and flashes its headlights every TAIL_FLASH_EVERY_S.
export const TAIL_PEEK_M = 0.5;
export const TAIL_PEEK_EVERY_S = 11;
export const TAIL_PEEK_FOR_S = 2.5;
export const TAIL_PEEK_MPS = 0.4;
export const TAIL_FLASH_EVERY_S = 9;
// The one test: closer behind than this (front bumper to rear bumper, in seconds of its speed), going
// at least this fast, within TAIL_LOOK_M behind and TAIL_SIDE_M of the observer's line.
export const TAIL_THREAT_S = 0.8;
export const TAIL_THREAT_MIN_MPS = 3;
export const TAIL_LOOK_M = 30;
export const TAIL_SIDE_M = 1.4;
// Tailgated, the driven car leaves this many times its usual following gap ahead; brakes no harder
// than TAIL_GENTLE_DECEL, or TAIL_NEED_SLACK above what is ahead requires (or TAIL_GENTLEST_SLACK above
// the gentlest manoeuvre that passes every other check); and, with no lane to move right into, eases off
// TAIL_EASE_MPS below its target speed where that is at least TAIL_EASE_MIN_MPS and near the limit. Its
// stop at a line starts earlier, braking at TAIL_STOP_DECEL rather than the usual comfortable braking.
export const TAIL_ROOM = 2;
export const TAIL_STOP_DECEL = 2.0;
export const TAIL_GENTLE_DECEL = 3.0;
export const TAIL_NEED_SLACK = 1.0;
export const TAIL_GENTLEST_SLACK = 0.5;
export const TAIL_EASE_MPS = 1.4;
export const TAIL_EASE_MIN_MPS = 8;
// The audit: braking harder than BRAKE_CHECK_DECEL for BRAKE_CHECK_HOLD_S, more than BRAKE_CHECK_SLACK
// above the need, at BRAKE_CHECK_MIN_MPS or more, with a tailgater close behind, is a brake check
// (once a braking, which ends below BRAKE_RELEASE_DECEL). What is ahead is looked at to NEED_LOOK_M.
export const BRAKE_CHECK_DECEL = 4.0;
export const BRAKE_CHECK_SLACK = 2.5;
export const BRAKE_CHECK_HOLD_S = 0.25;
export const BRAKE_CHECK_MIN_MPS = 3;
export const BRAKE_RELEASE_DECEL = 1.5;
export const NEED_LOOK_M = 80;

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// The World's state: whether tailgaters come, their random stream, when the next may be picked, the one
// tailgating now (its id), and the car's recent speeds (for its late reaction).
export function createTailgaters({ enabled = false, seed = 1 } = {}) {
  return { enabled: !!enabled, random: enabled ? rng(seed * 2654435761 + 56042) : null, next: enabled ? TAIL_FIRST_S : Infinity,
    checkAt: 0, active: null, easing: null, committed: 0, hist: [], behind: false };
}

// Ordinary cars only: not cyclists, transit, school buses, trains, trucks at work, emergency vehicles,
// plows, cars pulling out or parking, running a light, or passing a cyclist.
const ordinary = (n) => n.kind !== "bike" && !n.transit && !n.school && !n.rail && !n.collect && !n.pull && !n.parking && !n.parker && !n.runner && !n.cyc
  && !isPlow(n) && !isEmergency(n) && !isEmergencyVehicle(n);

// How far `o` is behind `observer` in its lane, going its way: from its front bumper to the observer's
// rear bumper (m), or null.
export function behindInLane(observer, o, look = TAIL_LOOK_M) {
  if (Math.cos(wrap(o.psi - observer.psi)) < 0.87) return null;
  const spec = observer.spec || CAR, os = o.spec || CAR, local = observer.toLocal(o.x, o.y);
  if (Math.abs(local.right) > TAIL_SIDE_M) return null;
  const gap = -spec.rearOverhang - (local.ahead + (os.length - os.rearOverhang) * Math.cos(wrap(o.psi - observer.psi)));
  return gap < -0.5 || gap > look ? null : gap;
}

// The one test. Of `others`, the vehicle tailgating `observer`, nearest behind it, or null:
// { vehicle, gap_m, headway_s, closing_mps }.
export function tailgaterThreat(world, observer, others) {
  let best = null;
  for (const o of others) {
    if (o === observer || !o.spec || o.kind === "bike" || o.kind === "pedestrian" || o.parked || o.goose || !(o.v >= TAIL_THREAT_MIN_MPS)) continue;
    if (Math.abs(o.x - observer.x) > TAIL_LOOK_M + 10 || Math.abs(o.y - observer.y) > TAIL_LOOK_M + 10) continue;
    const gap = behindInLane(observer, o);
    if (gap === null) continue;
    const headway = Math.max(0, gap) / o.v;
    if (headway >= TAIL_THREAT_S || (best && gap >= best.gap_m)) continue;
    best = { vehicle: o, gap_m: gap, headway_s: headway, closing_mps: o.v - Math.max(0, observer.v) };
  }
  return best;
}

// Make traffic car `n` a tailgater: its tailgating driver and its hurry, and its phase (for edging,
// peeking and flashing), from the feature's stream.
export function commitTailgater(world, n) {
  const state = world.tailgaters, limit = world.map.edges.get(n.path?.currentEdge()?.id)?.limit ?? 11.2;
  n.tailgate = { since: world.t, driver: n.driver, v0: n.v0, phase: state.random ? state.random() * TAIL_FLASH_EVERY_S : 0, close: false, lostFor: 0 };
  n.driver = { ...(n.driver || {}), aMax: Math.max(n.driver?.aMax ?? 1.5, 2.2), b: 3.0, s0: TAIL_S0_M, T: TAIL_T, react: 0.3, lcRate: 0.5 };
  n.v0 = Math.max(n.v0 || 0, limit * TAIL_HURRY);
  state.active = n.id; state.committed++; state.hist = [];
  return n.tailgate;
}

// It gives up: its own driver again, still in a bit of a hurry.
function endTailgate(world, n) {
  const state = world.tailgaters, tg = n.tailgate, limit = world.map.edges.get(n.path?.currentEdge()?.id)?.limit ?? 11.2;
  n.driver = tg.driver; n.v0 = Math.max(tg.v0 || 0, limit * TAIL_AFTER);
  delete n.tailgate;
  state.active = null; state.next = world.t + TAIL_COOLDOWN_S; state.hist = [];
  state.easing = n.tgPeek ? n.id : null;
}

const ease = (from, to, step) => from + Math.max(-step, Math.min(step, to - from));

// Each traffic step (NpcFleet.step, before the drivers move): the tailgater's edging, peeking and
// giving up, and, now and then, a new one.
export function manageTailgaters(world, fleet, dt) {
  const state = world.tailgaters, ego = world.ego;
  // (whether any vehicle is tailgating the car now, by the one test: for the coach, sim/drive-score.js)
  state.behind = !!tailgaterThreat(world, ego, world.npcs);
  if (state.easing) {
    const n = fleet.vehicles.find((v) => v.id === state.easing);
    if (n) n.tgPeek = ease(n.tgPeek || 0, 0, TAIL_PEEK_MPS * dt);
    if (!n || !n.tgPeek) state.easing = null;
  }
  if (state.active) {
    const n = fleet.vehicles.find((v) => v.id === state.active);
    if (!n?.tailgate) { state.active = null; state.next = world.t + TAIL_COOLDOWN_S; state.hist = []; return; }
    const tg = n.tailgate;
    state.hist.push([world.t, ego.v]);
    while (state.hist.length > 2 && state.hist[1][0] <= world.t - TAIL_REACT_S - TAIL_JUDGE_S) state.hist.shift();
    const gap = behindInLane(ego, n, TAIL_PICK_M);
    tg.close = gap !== null && n.v >= TAIL_THREAT_MIN_MPS && Math.max(0, gap) / n.v < TAIL_THREAT_S;
    if (tg.close) world.tailgatersSeen = true;
    tg.lostFor = gap === null ? tg.lostFor + dt : 0;
    const passed = ego.toLocal(n.x, n.y).ahead - n.spec.rearOverhang > ego.spec.length - ego.spec.rearOverhang;
    if (passed || tg.lostFor > TAIL_LOST_S || world.t - tg.since > TAIL_MAX_S) { endTailgate(world, n); return; }
    const k = world.t - tg.since + tg.phase;
    n.driver.T = TAIL_T * (1 + TAIL_EDGE * Math.sin(2 * Math.PI * k / TAIL_EDGE_S));
    const peek = tg.close && k % TAIL_PEEK_EVERY_S > TAIL_PEEK_EVERY_S - TAIL_PEEK_FOR_S ? -TAIL_PEEK_M : 0;
    n.tgPeek = ease(n.tgPeek || 0, peek, TAIL_PEEK_MPS * dt);
    // (it may pull out and pass on the left, but from the leftmost lane it never cuts by on the right)
    if (n.path?.currentEdge()?.lane === 0) n.lcCooldown = Math.max(n.lcCooldown || 0, 1);
    return;
  }
  if (world.t < state.next || world.t < state.checkAt) return;
  state.checkAt = world.t + TAIL_CHECK_S;
  if (ego.v < TAIL_MIN_MPS) return;
  let pick = null, best = Infinity;
  for (const n of fleet.vehicles) {
    if (!ordinary(n) || n.v < TAIL_MIN_MPS || Math.abs(n.x - ego.x) > TAIL_PICK_M + 10 || Math.abs(n.y - ego.y) > TAIL_PICK_M + 10) continue;
    const g = behindInLane(ego, n, TAIL_PICK_M);
    if (g !== null && g < best) { best = g; pick = n; }
  }
  if (pick && state.random() < TAIL_CHANCE) commitTailgater(world, pick);
}

// The car's speed as the tailgater sees it: TAIL_REACT_S ago (its brake lights noticed late), or `back`
// seconds before that.
export function tailgateLeadSpeed(world, back = 0) {
  const h = world.tailgaters.hist, at = world.t - TAIL_REACT_S - back;
  let v = h.length ? h[0][1] : world.ego.v;
  for (const [t, s] of h) { if (t > at) break; v = s; }
  return v;
}

// The acceleration tailgater `n`, `gap` behind the car (bumper to bumper), brakes at for it once it sees it
// braking: TAIL_MATCH_MPS2 harder than it sees, or as hard as stopping TAIL_S0_M behind it needs if the
// car brakes on like that to a stop (from where it expects it to be by now). Infinity while it sees no
// braking.
export function tailgateBrake(world, n, gap) {
  const seen = tailgateLeadSpeed(world), braking = (tailgateLeadSpeed(world, TAIL_JUDGE_S) - seen) / TAIL_JUDGE_S;
  if (braking < 0.5) return Infinity;
  const ahead = Math.max(0, seen - braking * TAIL_REACT_S), room = Math.max(0.5, gap - TAIL_S0_M + ahead * ahead / (2 * braking));
  return -Math.max(braking + TAIL_MATCH_MPS2, Math.max(0, n.v) ** 2 / (2 * room));
}

// Render-only: whether tailgater `n` flashes its headlights now (a double flash every
// TAIL_FLASH_EVERY_S while it is close behind the car).
export function tailgaterFlash(world, n) {
  const tg = n.tailgate;
  if (!tg?.close) return false;
  const k = (world.t - tg.since + tg.phase) % TAIL_FLASH_EVERY_S;
  return k < 0.15 || (k > 0.35 && k < 0.5);
}

// What the situation ahead requires of `ego` (m/s^2 of braking, and why), from the shared tests (see
// the top of this file). `s`: its route arc length, where the caller has it (else it is projected).
export function brakingNeed(world, ego = world.ego, s = null) {
  const v = Math.max(0, ego.v), FRONT = ego.spec.length - ego.spec.rearOverhang;
  let decel = 0, why = null;
  const need = (d, what) => { const a = v * v / (2 * Math.max(0.5, d)); if (a > decel) { decel = a; why = what; } };
  // whatever is in its path ahead
  for (const o of world.obstaclesNear(ego.x, ego.y, NEED_LOOK_M)) {
    if (o === ego) continue;
    const person = o.kind === "pedestrian" || !!o.goose, os = o.spec || CAR, local = ego.toLocal(o.x, o.y);
    if (Math.abs(local.right) > ego.spec.width / 2 + (person ? 1.8 : (os.width || CAR.width) / 2 + 0.3)) continue;
    const gap = local.ahead - FRONT - (person ? 0.3 : os.rearOverhang ?? CAR.rearOverhang);
    if (gap < -0.5 || gap > NEED_LOOK_M) continue;
    const along = Number.isFinite(o.psi) ? Math.max(0, (o.v || 0) * Math.cos(wrap(o.psi - ego.psi))) : 0;
    const room = gap - (person ? 1 : FOLLOWING_STANDSTILL_M - 1);
    const what = person ? (o.goose ? "geese" : "person") : "vehicle ahead";
    if (v > along) { const a = (v - along) ** 2 / (2 * Math.max(0.5, room)); if (a > decel) { decel = a; why = what; } }
    const braking = -(o.ax || 0);
    if (braking > 0.5) need(room + along * along / (2 * braking), what);
  }
  const route = world.route;
  if (route) {
    if (s === null) { const p = route.project(ego.x, ego.y); s = p.distance < 6 ? p.s : null; }
    if (s !== null) {
      // a red light, or an amber it can stop for, or a stop sign not yet stopped at, at its line
      for (const c of route.controls) {
        const d = c.sRoute - (s + FRONT);
        if (d < 0) continue;
        if (d > NEED_LOOK_M) break;
        const ctl = controlAt(world, c.control, c.edge);
        if (ctl.type === "signal") {
          const inter = world.map.intersections.get(ctl.id);
          const light = inter ? movementSignal(approachPhase(inter, c.edge, world.t), c.turn || "straight") : "red";
          if (light === "red" || light === "flashing_red" || (light === "yellow" && d >= amberStoppingDistance(ego))) need(d - 0.5, light === "yellow" ? "amber light" : "red light");
        } else if (ctl.type === "stop" && !(world.egoStop?.controlId === ctl.id && world.egoStop.completed)) need(d - 0.5, "stop sign");
      }
      // the route's bends, at comfortable cornering
      const lat = comfort().lat;
      for (let d = 0; d <= 60 && s + d < route.length; d += 3) {
        const vc = route.curveSpeedAt(s, d, lat);
        if (Number.isFinite(vc) && v > vc) { const a = (v * v - vc * vc) / (2 * Math.max(3, d)); if (a > decel) { decel = a; why = "bend"; } }
      }
      // and the destination
      const left = route.length - 1 - s;
      if (left < NEED_LOOK_M) need(left, "destination");
    }
  }
  return { decel, why };
}

// The audit, each step: a brake check (see the top of this file), counted once a braking, as
// `brake_checks` (`world.tailgaterCall` follows the braking).
export function auditTailgaters(world) {
  const ego = world.ego, decel = -(ego.ax || 0);
  let call = world.tailgaterCall;
  if (decel < BRAKE_RELEASE_DECEL) { world.tailgaterCall = null; return; }
  if (!call) {
    if (decel < BRAKE_CHECK_DECEL || ego.v < BRAKE_CHECK_MIN_MPS) return;
    call = world.tailgaterCall = { since: world.t, max: 0, need: 0, why: null, threat: null, counted: false };
  }
  if (call.counted) return;
  call.max = Math.max(call.max, decel);
  const need = brakingNeed(world);
  if (need.decel >= call.need) { call.need = need.decel; call.why = need.why; }
  const threat = tailgaterThreat(world, ego, world.npcs);
  if (threat) call.threat = { id: threat.vehicle.id ?? null, headway_s: Math.round(threat.headway_s * 100) / 100 };
  if (world.t - call.since + 1e-9 < BRAKE_CHECK_HOLD_S || !call.threat || call.max <= Math.max(BRAKE_CHECK_DECEL, call.need + BRAKE_CHECK_SLACK)) return;
  call.counted = true;
  world.violations.brake_checks = (world.violations.brake_checks || 0) + 1;
  world.events.push({ type: "brake_check", with: call.threat.id, decel_mps2: Math.round(call.max * 10) / 10, need_mps2: Math.round(call.need * 10) / 10,
    ...(call.why ? { ahead: call.why } : {}), headway_s: call.threat.headway_s });
}

// The driven car's sensing: the tailgater behind it among `seen`, or null. `s`: its route arc length.
export function tailgaterSensing(world, seen, s = null) {
  const threat = tailgaterThreat(world, world.ego, seen);
  if (!threat) return null;
  const o = threat.vehicle, r1 = (x) => Math.round(x * 10) / 10, need = brakingNeed(world, world.ego, s);
  return { id: o.id ?? null, vehicle: o, gap_m: r1(threat.gap_m), headway_s: Math.round(threat.headway_s * 100) / 100, speed: r1(o.v), closing_mps: r1(threat.closing_mps),
    flashing: tailgaterFlash(world, o), need_mps2: r1(need.decel), need_for: need.why, gentle_mps2: r1(Math.max(TAIL_GENTLE_DECEL, need.decel + TAIL_NEED_SLACK)),
    room_factor: TAIL_ROOM, lane_right: false, can_move_right: false };
}

// The HUD line for a tailgater close behind: said once each time it changes.
export function tailgaterNotice(world, snap) {
  const t = snap?.tailgater ?? (world.tailgaters?.enabled ? tailgaterThreat(world, world.ego, world.npcs) : null);
  if (!t) return null;
  const right = !!snap?.tailgater?.can_move_right;
  return { key: `${t.id ?? t.vehicle?.id}:${right}`, text: right ? "TAILGATER · MOVE RIGHT AND LET THEM BY" : "TAILGATER · LEAVE MORE ROOM AHEAD", wait: false };
}
