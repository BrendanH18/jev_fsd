import { reserveSlot } from "./parking.js";
// A police officer directing traffic at a signalized junction (World option `officers`). Every
// province's highway traffic act puts a police officer's directions above the signals (Ontario's HTA
// s. 134, BC's Motor Vehicle Act s. 123, Québec's Highway Safety Code s. 309): stop when the officer
// holds you, even on a green; go when waved through, even on a red, still yielding to people and
// traffic already in the junction, and to oncoming traffic turning left.
//
// Now and then, from the feature's own seeded random stream, a signalized junction on the driven car's
// route, well ahead and out of its sight, with nobody near it, gets an officer in a hi-vis vest standing
// in the middle of the box, with a cruiser, its lights on, parked at a corner: in a parking bay of one of
// the streets leading away where there is one (parked like any car, so solid), else up on the kerb
// beside one, out of the lanes (render-only). The signals keep cycling, or stay dark in a power cut; the
// officer governs either way. Junctions with a scramble crossing, a streetcar line or a level crossing
// never get one.
//
// The officer works in phases of their own: waves one signal group (an axis, `phase` "A" or "B")
// through, holding the other, for at least GO_MIN_S; then, once someone waits on the held axis and
// nobody on the waved one is too close to stop for them (sim/amber.js stopping distance), or after
// GO_MAX_S with someone waiting, holds everyone (`phase` "clear") for at least CLEAR_S and until the
// box has emptied (no vehicle within `boxR` of the centre, nobody on foot crossing there), then waves
// the other axis. A driver still too close to stop when the officer turns to hold its axis is waved on
// (`committed`, once, for that turn), and the officer waits for it. People on foot walk with the waved
// axis (across the held street), starting only in the first OFFICER_WALK_S of a wave.
//
// `officerDirection` is the one test, shared by the driven car's sensing (brain/sensors.js
// `traffic_officer`), the candidates (`wait_for_officer`, `go_on_officer_wave`, the rejection
// `passes_officer_stop`), Rules, the cautious agent, the model wording, traffic and cyclists
// (sim/npc.js), contraflow cyclists, and the audit: for a vehicle on an approach to a junction an
// officer governs, "go" while that approach's group is waved (or the vehicle was waved on as the
// officer turned), else "stop"; null where no officer governs. People on foot use `officerWalk`.
// With an officer there, `controlAt` (sim/outage.js) keeps the junction a signal even in a power cut or
// overnight flashing, so that nobody treats it as an all-way or two-way stop.
//
// The audit (sim/world.js) counts entering the junction (the front bumper crossing the line) while the
// officer holds the car as `officer_violations`, instead of the red-light, amber, right-on-red and
// fresh-green checks, which do not apply under an officer. The metric reaches reports, and fails a
// drive, only once the car has come up to a junction an officer governs and seen them
// (`World.officersSeen`). With the option off nothing here is computed and no random number is drawn.

import { rng } from "../common.js";
import { CAR, POLICE_CAR, Vehicle } from "./vehicle.js";
import { amberStoppingDistance } from "./amber.js";
import { approachTo } from "./priority.js";
import { railIndex } from "./rail.js";
import { pointAt, headingAt, projectPoint } from "../map/mapdata.js";
import { GUTTER, CURB } from "../map/streets.js";

// Free drives: from OFFICER_FIRST_S into the drive, every OFFICER_CHECK_S, the nearest signal on the car's
// route between SPAWN_M ahead, out of its sight, with nobody within QUIET_M of it, gets an officer with
// OFFICER_CHANCE (a draw only when there is one); one at a time, and after one leaves, none for
// OFFICER_COOLDOWN_S. An officer stays STAY_S, then leaves once the car is LEAVE_M away and out of sight,
// with nobody within QUIET_M.
export const OFFICER_CHANCE = 0.35;
export const OFFICER_CHECK_S = 8;
export const OFFICER_FIRST_S = 30;
export const OFFICER_COOLDOWN_S = 90;
export const SPAWN_M = [150, 450];
export const STAY_S = [150, 300];
export const LEAVE_M = 150;
export const QUIET_M = 40;
// The officer's phases (see the top of this file). Someone within WAIT_LOOK_M short of a held line, or at
// the kerb to cross with the held axis, is waiting.
export const GO_MIN_S = 12;
export const GO_MAX_S = 30;
export const CLEAR_S = 2;
export const CLEAR_MAX_S = 15;
export const WAIT_LOOK_M = 60;
export const OFFICER_WALK_S = 7;
// A driver waved on as the officer turns: over the line already, or moving and short of it by less than
// its stopping distance and this margin.
const COMMIT_MARGIN_M = 0.5;
const KERB_M = 6;
// The driven car notices the officer within NOTICE_M of the line, once it can see them; the audit marks
// the officer seen within SEEN_M.
export const NOTICE_M = 80;
export const SEEN_M = 60;
// (the junction's box: within this much of the nearest stop line of the centre)
const BOX_IN_M = 1.5;
// Held by an officer, the driven car stops at the line braking at no more than this, starting earlier
// than the usual comfortable braking, so as not to run up to the officer: it plans the stop as if it
// reacted OFFICER_STOP_REACTION_S late, plus its pedals' lag, so that the lag never carries it over the
// line or forces it to brake harder at the end (`officerStopLaw`).
export const OFFICER_STOP_DECEL = 2.0;
export const OFFICER_STOP_REACTION_S = 0.4;
export const officerStopLaw = (spec, decel = OFFICER_STOP_DECEL) => ({ stopDecel: Math.min(OFFICER_STOP_DECEL, decel), stopReaction: OFFICER_STOP_REACTION_S + (spec.accelLag || 0) });
// The ego's id among those waved on (as for lane closures and snowbanks).
export const EGO_ID = "ego";

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const idOf = (world, v) => v === world.ego ? EGO_ID : v?.id ?? null;
const other = (group) => group === "A" ? "B" : "A";

// The World's state: whether officers come, their random stream, when the next may be looked for, and
// the officers standing now.
export function createOfficers({ enabled = false, seed = 1 } = {}) {
  return { enabled: !!enabled, random: enabled ? rng(seed * 2654435761 + 57042) : null, list: [], made: 0,
    next: enabled ? OFFICER_FIRST_S : Infinity, checkAt: 0 };
}

// The officer governing junction `interId`, or null.
export function officerAt(world, interId) {
  const list = world.officers?.list;
  if (!list?.length) return null;
  for (const o of list) if (o.inter === interId) return o;
  return null;
}

// The one test: what the officer governing the junction that edge `edgeId` leads into tells `vehicle`
// on it ("go" or "stop"), or null where no officer governs it.
export function officerDirection(world, vehicle, edgeId) {
  if (!world.officers?.list.length) return null;
  const ctl = world.map.edges.get(edgeId)?.control;
  if (ctl?.type !== "signal") return null;
  const o = officerAt(world, ctl.id);
  if (!o) return null;
  if (o.phase === ctl.group) return "go";
  return o.committed[idOf(world, vehicle)] === o.turn ? "go" : "stop";
}

// Whether people on foot may step off at junction `interId` to walk alongside `group`'s traffic (across
// the other group's street): only early in that group's wave. Null where no officer governs.
export function officerWalk(world, interId, group) {
  const o = officerAt(world, interId);
  if (!o) return null;
  return o.phase === group && world.t - o.phaseSince < OFFICER_WALK_S;
}

// Whether junction `inter` may get an officer: a signal with three approaches or more, no scramble
// crossing, no streetcar line through it and no level crossing on its streets.
export function officerSite(map, inter) {
  if (!inter || (inter.approaches?.length || 0) < 3 || inter.scramblePlan) return false;
  const edges = new Set(inter.approaches.map((a) => a.edge));
  for (const a of inter.approaches) for (const id of map.out.get(map.edges.get(a.edge)?.to) || []) edges.add(id);
  for (const route of map.transit?.routes || []) {
    if (route.mode !== "tram") continue;
    if ((route.runs || []).some((run) => run.edges.some((id) => edges.has(id)))) return false;
  }
  if (railIndex(map).crossings.some((c) => c.edges.some((on) => edges.has(on.edge)))) return false;
  return true;
}

// Where vehicle `v` is on its way into junction `inter`: { edge, group, toLine (its front bumper short of
// the line, negative past it) }, or null. The driven car goes by its route where it follows one.
export function approachOf(world, inter, v) {
  const map = world.map;
  if (v === world.ego && world.route) {
    const route = world.route, p = route.project(v.x, v.y, route.hint);
    if (p && p.distance < 6) {
      const front = p.s + v.spec.length - v.spec.rearOverhang;
      for (const c of route.controls) {
        if (c.control.type !== "signal" || c.control.id !== inter.id) continue;
        const toLine = c.sRoute - front;
        if (toLine > WAIT_LOOK_M + 40 || toLine < -40) continue;
        return { edge: c.edge, group: c.control.group, toLine };
      }
    }
  }
  const a = approachTo(map, v, inter.id);
  if (!a) return null;
  const e = map.edges.get(a.edge);
  if (e?.control?.type !== "signal" || e.control.id !== inter.id) return null;
  return { edge: a.edge, group: e.control.group, toLine: a.to_node_m - (e.length - e.control.s_line) };
}

// Everyone on wheels near junction `o` (the driven car, traffic and cyclists; not trains).
function movers(world, o) {
  const out = [];
  for (const v of [world.ego, ...(world.npcs || [])]) {
    if (!v || v.rail || v.parked) continue;
    if (Math.abs(v.x - o.x) > WAIT_LOOK_M + 40 || Math.abs(v.y - o.y) > WAIT_LOOK_M + 40) continue;
    out.push(v);
  }
  return out;
}

// Whether vehicle `v` is in the box of junction `o`: its front, middle or rear within `o.boxR` of the
// centre.
function inBox(o, v) {
  const s = v.spec || CAR, c = Math.cos(v.psi), n = Math.sin(v.psi), f = s.length - s.rearOverhang, mid = s.length / 2 - s.rearOverhang;
  for (const d of [f, mid, -s.rearOverhang]) if (Math.hypot(v.x + c * d - o.x, v.y + n * d - o.y) < o.boxR) return true;
  return false;
}

// People on foot crossing at junction `o` now, or (`group`) at the kerb about to cross alongside it.
function onFoot(world, o, group = null) {
  const crowd = world.crowd, legsAt = crowd?.legsAt;
  if (!legsAt) return false;
  for (const ped of crowd.list) {
    if (Math.abs(ped.x - o.x) > 40 || Math.abs(ped.y - o.y) > 40) continue;
    if (group === null) {
      if (ped.crossing && legsAt.get(ped.crossing.node)?.inter?.id === o.inter) return true;
      continue;
    }
    if (ped.crossing || ped.frozen > 0) continue;
    const c = ped.path?.slice(0, 2).find((w) => w.cross)?.cross;
    if (!c?.leg?.group || c.jaywalk || legsAt.get(c.node)?.inter?.id !== o.inter) continue;
    if (Math.hypot(ped.x - c.from[0], ped.y - c.from[1]) < KERB_M && other(c.leg.group) === group) return true;
  }
  return false;
}

// Whether anyone waits to go on `group`: a vehicle up to WAIT_LOOK_M short of its line, or someone on foot
// at the kerb to walk alongside it.
function waiting(world, o, inter, group) {
  for (const v of movers(world, o)) {
    const a = approachOf(world, inter, v);
    if (a && a.group === group && a.toLine > -1 && a.toLine < WAIT_LOOK_M) return true;
  }
  return onFoot(world, o, group);
}

// The vehicles on `group` the officer turning to hold it waves on: over the line already, or moving and
// too close to stop for them (see COMMIT_MARGIN_M).
function caught(world, o, inter, group) {
  const out = [];
  for (const v of movers(world, o)) {
    const a = approachOf(world, inter, v);
    if (a && a.group === group && (a.toLine < 0 || (v.v > 0.5 && a.toLine < amberStoppingDistance(v) + COMMIT_MARGIN_M))) out.push(v);
  }
  return out;
}

// The heading the officer faces: toward traffic held on an approach of the axis it holds (the driven
// car's, where it is coming up to one of them), or toward the first approach of group `held`.
function faceFor(world, o, inter, held) {
  const map = world.map;
  const ego = approachOf(world, inter, world.ego);
  const a = ego && ego.group === held && ego.toLine > -1 && ego.toLine < NOTICE_M ? inter.approaches.find((x) => x.edge === ego.edge)
    : inter.approaches.find((x) => x.group === held);
  const e = a ? map.edges.get(a.edge) : null;
  return e ? wrap(headingAt(e.pts, e.cum, e.length) + Math.PI) : o.face;
}

// The radius of junction `inter`'s box: the nearest stop line's distance from the centre, less BOX_IN_M.
function boxRadius(map, inter) {
  let r = Infinity;
  for (const a of inter.approaches) {
    const e = map.edges.get(a.edge);
    if (!e?.control) continue;
    const p = pointAt(e.pts, e.cum, e.control.s_line);
    r = Math.min(r, Math.hypot(p[0] - inter.x, p[1] - inter.y));
  }
  return Math.max(5, Math.min(20, (Number.isFinite(r) ? r : 12) - BOX_IN_M));
}

// The cruiser, lights on, at a corner of junction `inter`: in the first free parking bay on the right of a
// street leading away from it (parked like any car), else up on the kerb beside one (render-only).
function parkCruiser(world, o, inter) {
  const map = world.map, nodes = new Set([...(inter.vertices || []), ...inter.approaches.map((a) => map.edges.get(a.edge)?.to)]), exits = [];
  for (const node of nodes) for (const id of map.out.get(node) || []) {
    const e = map.edges.get(id);
    if (e && !nodes.has(e.to) && !e.ring && e.length >= 20) exits.push(e);
  }
  exits.sort((a, b) => String(a.id) < String(b.id) ? -1 : 1);
  let best = null;
  for (const slot of world.parked.slots || []) {
    if (slot.curb !== "right" || slot.reserved || slot.occupant?.door) continue;
    const e = exits.find((x) => x.id === slot.edge);
    if (!e) continue;
    const s = projectPoint(e.pts, e.cum, [slot.x, slot.y], null).s;
    if (s > 45) continue;
    if (!best || s < best.s) best = { slot, s };
  }
  const id = `${o.id}_cruiser`;
  if (best) {
    const { slot } = best;
    if (slot.occupant) world.parked.remove(slot.occupant);
    const car = new Vehicle(slot.x, slot.y, slot.psi, 0, POLICE_CAR);
    Object.assign(car, { id, kind: "police", roadside: true, flashing: true, stay: true, officer: o.id, edge: slot.edge, curb: "right", color: 0xf4f4f0, slot: null });
    reserveSlot(map, slot, car);
    world.parked.add(car);
    return { id, parked: true, slot, vehicle: car };
  }
  // (up on the kerb: the first spot along a street leading away, past the corner, clear of every street's
  // asphalt, its whole body)
  const lat = (e) => e.asphalt[1] + GUTTER + CURB + POLICE_CAR.width / 2 + 0.15, back = POLICE_CAR.length / 2 - POLICE_CAR.rearOverhang;
  for (const e of exits) for (const s of [14, 20, 26, 32]) {
    if (s > e.length - 3) break;
    const h = headingAt(e.pts, e.cum, s), p = pointAt(e.pts, e.cum, s), l = lat(e);
    const x = p[0] + Math.sin(h) * l, y = p[1] - Math.cos(h) * l;
    const half = POLICE_CAR.length / 2;
    if ([-half, 0, half].some((d) => map.roadDistance(x + Math.cos(h) * d, y + Math.sin(h) * d).distance < POLICE_CAR.width / 2 + 0.3)) continue;
    const car = new Vehicle(x - Math.cos(h) * back, y - Math.sin(h) * back, h, 0, POLICE_CAR);
    Object.assign(car, { id, kind: "police", roadside: true, flashing: true, stay: true, officer: o.id, color: 0xf4f4f0 });
    return { id, parked: false, slot: null, vehicle: car };
  }
  return null;
}

// Put an officer at junction `interId`: `wave` the group to wave first (by default the one with the green
// now, or "A"), `phase` "clear" to start holding everyone (the default) or the group waved now, `left` how
// long they stay (for good, by default: a challenge's). Returns the officer, or null.
export function placeOfficer(world, interId, { wave = null, phase = "clear", left = Infinity, holdUntil = 0 } = {}) {
  const state = world.officers, map = world.map, inter = map.intersections.get(interId);
  if (!state?.enabled || !inter || officerAt(world, interId)) return null;
  const first = wave || (inter.approaches.some((a) => a.group === "A") ? "A" : "B");
  const o = { id: `officer_${++state.made}`, inter: interId, x: inter.x, y: inter.y, since: world.t, left,
    phase: phase === "clear" ? "clear" : phase, next: phase === "clear" ? first : other(phase), phaseSince: world.t, turn: 1,
    committed: {}, holdUntil, boxR: boxRadius(map, inter), face: 0, cruiser: null };
  o.face = faceFor(world, o, inter, o.phase === "clear" ? other(first) : other(o.phase));
  state.list.push(o);
  o.cruiser = parkCruiser(world, o, inter);
  return o;
}

// The officer leaves: their cruiser too.
export function removeOfficer(world, o) {
  const state = world.officers, cruiser = o.cruiser;
  if (cruiser?.parked) {
    world.parked.remove(cruiser.vehicle);
    if (cruiser.slot?.reserved?.owner === cruiser.vehicle) cruiser.slot.reserved = null;
  }
  state.list.splice(state.list.indexOf(o), 1);
}

// Nobody on wheels within QUIET_M of junction `inter`.
function quiet(world, inter) {
  return [world.ego, ...(world.npcs || [])].every((v) => v.rail || Math.hypot(v.x - inter.x, v.y - inter.y) > QUIET_M);
}

// Each step, before traffic moves: every officer's phase, and in a free drive, now and then a new one,
// and old ones leaving.
export function stepOfficers(world, dt) {
  const state = world.officers, map = world.map, ego = world.ego;
  for (const o of [...state.list]) {
    const inter = map.intersections.get(o.inter);
    o.left -= dt;
    if (o.left <= 0 && Math.hypot(o.x - ego.x, o.y - ego.y) > LEAVE_M && !world.visibility.canSee(ego, o.x, o.y) && quiet(world, inter)) {
      removeOfficer(world, o);
      state.next = Math.max(state.next, world.t + OFFICER_COOLDOWN_S);
      continue;
    }
    stepPhase(world, o, inter);
  }
  if (world.t < state.next || world.t < state.checkAt || state.list.length || !world.route) return;
  state.checkAt = world.t + OFFICER_CHECK_S;
  const route = world.route, p = route.project(ego.x, ego.y, route.hint);
  if (!p || p.distance > 6) return;
  const front = p.s + ego.spec.length - ego.spec.rearOverhang;
  for (const c of route.controls) {
    if (c.control.type !== "signal") continue;
    const ahead = c.sRoute - front;
    if (ahead < SPAWN_M[0]) continue;
    if (ahead > SPAWN_M[1]) break;
    const inter = map.intersections.get(c.control.id);
    if (!officerSite(map, inter) || world.visibility.canSee(ego, inter.x, inter.y) || !quiet(world, inter)) continue;
    if (state.random() < OFFICER_CHANCE) placeOfficer(world, inter.id, { left: STAY_S[0] + state.random() * (STAY_S[1] - STAY_S[0]) });
    return;
  }
}

// One officer's phase (see the top of this file).
function stepPhase(world, o, inter) {
  const t = world.t;
  if (o.phase !== "clear") {
    const held = other(o.phase), since = t - o.phaseSince;
    if (t >= o.holdUntil && since >= GO_MIN_S && waiting(world, o, inter, held)) {
      const caughtNow = caught(world, o, inter, o.phase);
      if (!caughtNow.length || since >= GO_MAX_S) {
        o.turn++;
        o.committed = {};
        for (const v of caughtNow) o.committed[idOf(world, v)] = o.turn;
        o.next = held; o.phase = "clear"; o.phaseSince = t;
      }
    }
    if (o.phase !== "clear") { o.face = faceFor(world, o, inter, held); return; }
  }
  // holding everyone: until the box is empty and whoever was waved on as the officer turned is through
  const since = t - o.phaseSince;
  if (since < CLEAR_S || t < o.holdUntil) return;
  // (someone on foot crossing or a vehicle in the box always holds the switch; only waiting for a driver
  // waved on as the officer turned, still short of its line, gives up after CLEAR_MAX_S)
  if (onFoot(world, o)) return;
  let late = false;
  for (const v of movers(world, o)) {
    if (inBox(o, v)) return;
    const id = idOf(world, v);
    if (o.committed[id] !== o.turn) continue;
    const a = approachOf(world, inter, v);
    if (a && a.toLine > -0.5) late = true;
  }
  // (a contraflow cyclist, not in world.npcs, still in the box holds it too: sim/contraflow.js)
  for (const r of world.contraflow?.riders || []) if (inBox(o, r)) return;
  if (late && since < CLEAR_MAX_S) return;
  o.phase = o.next; o.phaseSince = t; o.committed = {}; o.turn++;
  o.face = faceFor(world, o, inter, other(o.phase));
}

// What the driven car's sensing says about the officer at the junction of route control `c` (its front
// bumper at route arc length `frontS`), once it can see them within NOTICE_M of the line, or null:
// { id, direction, axis (the group waved, or null while everyone is held), approach_group, phase ("wave"
// or "all_stop"), bumper_to_line_m, s_line_route }; `officerLight` adds what the light shows.
export function officerSensing(world, c, frontS) {
  if (c.control.type !== "signal") return null;
  const o = officerAt(world, c.control.id);
  if (!o) return null;
  const toLine = c.sRoute - frontS;
  if (toLine > NOTICE_M || !world.visibility.canSee(world.ego, o.x, o.y)) return null;
  const direction = officerDirection(world, world.ego, c.edge);
  const r1 = (x) => Math.round(x * 10) / 10;
  return { id: o.id, direction, axis: o.phase === "clear" ? null : o.phase, approach_group: c.control.group, phase: o.phase === "clear" ? "all_stop" : "wave",
    bumper_to_line_m: r1(toLine), s_line_route: c.sRoute };
}

// The officer's sensing `s` with what the light shows the car (`signal`; "dark" in a power cut), and whether
// the officer's direction goes against it.
export function officerLight(s, signal) {
  return Object.assign(s, { signal, against_light: (s.direction === "go" && signal !== "green") || (s.direction === "stop" && signal === "green") });
}

// The HUD line for an officer at the junction ahead: said once each time the direction changes.
export function officerNotice(world, snap) {
  const s = snap?.traffic_officer ?? (world.officers?.list.length ? egoOfficer(world) : null);
  if (!s) return null;
  return { key: `${s.id}:${s.direction}`, text: `OFFICER DIRECTING TRAFFIC · ${s.direction === "go" ? "GO" : "STOP"}`, wait: s.direction === "stop" };
}

// (the officer ahead of the driven car, without sensing: for the HUD while driving by hand)
function egoOfficer(world) {
  const route = world.route, ego = world.ego;
  if (!route) return null;
  const p = route.project(ego.x, ego.y, route.hint);
  if (!p || p.distance > 6) return null;
  const front = p.s + ego.spec.length - ego.spec.rearOverhang;
  const c = route.controls.find((k) => k.sRoute > front - 1);
  return c ? officerSensing(world, c, front) : null;
}
