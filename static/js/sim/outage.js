// Power cuts: now and then a signal's lights go dark. Where they are out, every driver treats the
// junction as an all-way stop: stop at the line, then go in turn, whoever stopped first going first
// (the MTO Driver's Handbook: "If traffic lights are not working, treat the intersection as an
// all-way stop"; ICBC's Learn to Drive Smart says the same, and so does every province's handbook).
// A dark signal's every approach then has the all-way stop control `darkControl` in place of its
// signal (`controlAt`), and joins the one queue for the junction in sim/all-way.js, keyed on the
// signal's id. Its walk signals are out too, so people on foot cross there as at a junction without
// a signal, on a gap.
//
// In a free drive one signal at a time goes dark, SPAWN_M from the car and out of its sight, with
// nobody moving within QUIET_M of it, for LAST_S; its lights come back on once the car is LEAVE_M
// away and out of sight again, with nobody within QUIET_M. The next goes dark GAP_S later.

import { rng } from "../common.js";

export const OUTAGE_COUNT = 1;
const SPAWN_M = [150, 450];
const LAST_S = [240, 480];
const GAP_S = [60, 180];
const FIRST_S = 20;          // (the first, this long into the drive)
const RETRY_S = 10;
const LEAVE_M = 150;
const QUIET_M = 40;
const NOTICE_M = 80;

// The all-way stop that stands in for a dark signal's `control` on the approach `edgeId` (one object
// per approach, so it compares equal from one tick to the next): its own id for that approach, as a
// stop sign's (a driver's stop at one approach is not a stop at the next it comes to), the signal's
// id as its junction, and the signal's line and group.
const darkOf = new WeakMap();
export function darkControl(control, edgeId) {
  let d = darkOf.get(control);
  if (!d) darkOf.set(control, d = { type: "stop", all_way: true, dark: true, id: `${control.id}@${edgeId}`, junction: control.id, s_line: control.s_line, group: control.group ?? null });
  return d;
}

// The control a driver obeys in `world` where the map has `control`, on `edgeId`: an all-way stop for
// a dark signal.
export function controlAt(world, control, edgeId) {
  return control?.type === "signal" && world.outages?.isDark(control.id) ? darkControl(control, edgeId) : control;
}

export class Outages {
  constructor(world, { count = 0, seed = 1 } = {}) {
    this.world = world;
    this.count = count;
    this.random = rng(seed * 104729 + 53);
    this.list = [];              // { id, since, left }
    this.next = FIRST_S;
  }

  isDark(id) { return this.since(id) !== null; }

  // When a signal's lights went out, or null while they are on.
  since(id) {
    for (const o of this.list) if (o.id === id) return o.since;
    return null;
  }

  // Turn a signal's lights off for `last` seconds (for good, by default: a challenge's).
  cut(id, last = Infinity) {
    if (this.isDark(id) || !this.world.map.intersections.has(id)) return null;
    const o = { id, since: this.world.t, left: last };
    this.list.push(o);
    return o;
  }

  restore(id) { this.list = this.list.filter((o) => o.id !== id); }

  step(dt) {
    if (!this.count) return;
    const world = this.world, ego = world.ego;
    for (const o of [...this.list]) {
      o.left -= dt;
      const inter = world.map.intersections.get(o.id);
      if (o.left <= 0 && Math.hypot(inter.x - ego.x, inter.y - ego.y) > LEAVE_M && !this.seen(inter) && this.quiet(inter)) {
        this.restore(o.id);
        this.next = GAP_S[0] + this.random() * (GAP_S[1] - GAP_S[0]);
      }
    }
    if (this.list.length < this.count && (this.next -= dt) <= 0) { this.next = RETRY_S; this.spawn(); }
  }

  seen(inter) { return this.world.visibility.canSee(this.world.ego, inter.x, inter.y); }

  // Nobody on the move (or waiting at a line) within QUIET_M of the junction, so nobody is caught by
  // the lights going off or coming back on.
  quiet(inter) {
    return [this.world.ego, ...(this.world.npcs || [])].every((v) => v.rail || Math.hypot(v.x - inter.x, v.y - inter.y) > QUIET_M);
  }

  spawn() {
    const world = this.world, ego = world.ego;
    const sites = [...world.map.intersections.values()].filter((i) => (i.approaches?.length || 0) >= 3);
    for (let attempt = 0; attempt < 20 && sites.length; attempt++) {
      const inter = sites[Math.floor(this.random() * sites.length)], d = Math.hypot(inter.x - ego.x, inter.y - ego.y);
      if (d < SPAWN_M[0] || d > SPAWN_M[1] || this.isDark(inter.id) || this.seen(inter) || !this.quiet(inter)) continue;
      return this.cut(inter.id, LAST_S[0] + this.random() * (LAST_S[1] - LAST_S[0]));
    }
    return null;
  }
}

// What the HUD tells the driver about a dark signal its route takes it through next, within NOTICE_M
// and in sight: { key, text, stop } (`stop`: it must stop or wait now), or null.
export function outageNotice(world) {
  const { route, ego, map } = world;
  if (!route || !world.outages?.list.length) return null;
  const p = route.project(ego.x, ego.y, route.hint);
  if (!p || p.distance > 4) return null;
  const front = p.s + ego.spec.length - ego.spec.rearOverhang;
  const c = route.controls.find((k) => k.sRoute > front - 1);
  if (!c || c.control.type !== "signal" || c.sRoute - front > NOTICE_M || !world.outages.isDark(c.control.id)) return null;
  const inter = map.intersections.get(c.control.id);
  if (!inter || !world.visibility.canSee(ego, inter.x, inter.y)) return null;
  const st = world.allWay.status(ego, world);
  const stopped = world.egoStop.controlId === darkControl(c.control, c.edge).id && world.egoStop.completed;
  const state = !stopped ? "stop" : st && !st.go ? "wait" : "go";
  const text = { stop: "LIGHTS OUT · ALL-WAY STOP · STOP AT THE LINE", wait: "LIGHTS OUT · ALL-WAY STOP · WAIT YOUR TURN", go: "LIGHTS OUT · ALL-WAY STOP · YOUR TURN" }[state];
  return { key: `${darkControl(c.control, c.edge).id}:${state}`, text, stop: state !== "go" };
}
