// All-way stops: who goes next. A vehicle joins its junction's queue when it comes to a stop at its
// line (within the stop zone, or up to 6 m past the line after an overshoot). The vehicle that
// stopped first goes first. Two that stopped within TIE_S of each other go right before left: the
// one on the right goes first, and from opposite sides a left turn (or U-turn) waits for the other.
// From opposite sides two vehicles that are not turning left go together, and so do two opposing
// left turns, which pass in front of each other. A vehicle that has started to go once it was its
// turn keeps the right of way until it is CLEAR_M past the junction's centre, so a vehicle stopping
// just after it moves off does not take the turn from it, and nobody it conflicts with sets off
// while it is still crossing. If everyone waits for someone (four vehicles that stopped together,
// each with one on its right), the one that stopped first goes. A vehicle that never stopped is not
// in the queue; one that leaves the stop zone without its turn (running the stop) leaves it.
//
// The world keeps one queue for every vehicle, the driven car included; traffic and the driven
// car's sensing both read it, and the audit uses it to judge whether the car went out of turn. A
// signal whose lights are out (sim/outage.js) is an all-way stop too: its queue is keyed on the
// signal's id (`control.junction`), as its approaches may end at different nodes, and a vehicle that
// went has cleared it only once it is past the far side of the widest street there (a signal's
// junction is often far wider than a stop sign's, and may be mapped as several nodes about its centre).

import { STOP_ZONE_M } from "./signals.js";
import { wrap } from "./world.js";

export const TIE_S = 1.0;
const PAST_M = 6;           // the stop zone reaches this far past the line, as in StopMemory
const STOPPED_MPS = 0.2;
const GOING_MPS = 0.3;
const GONE_MPS = 0.5;
const STALE_TICKS = 2;      // an entry not refreshed for this many ticks has left
const CLEAR_M = 6;          // past the junction's centre, a vehicle that went has cleared it
const CLEAR_PAST_M = 2;     // (at a dark signal, this far past the far side of the widest street)
const GOING_MAX_S = 20;     // and one still going after this long has gone elsewhere

const lefty = (turn) => turn === "left" || turn === "uturn";

export class AllWayStops {
  constructor(map) { this.map = map; this.entries = new Map(); }

  // Each tick, for a vehicle whose next control is an all-way stop: the edge it is on, the turn it
  // makes at the junction, how far its front bumper is from the line and its speed. Returns the
  // vehicle it should have waited for when it goes out of turn: its front crosses the line, or it
  // leaves the queue moving past the line (after a stop made past it), without its turn. Else null.
  note(vehicle, control, edgeId, turn, bumperToLine, v, world) {
    const junction = control.junction ?? this.map.stops.get(control.id)?.junction ?? this.map.edges.get(edgeId)?.to;
    let e = this.entries.get(vehicle);
    // one that went has the right of way until it clears the junction (see `at`)
    if (e?.going) { if (!this.cleared(e, world)) return null; this.entries.delete(vehicle); e = null; }
    if (e && (e.junction !== junction || e.edge !== edgeId)) { this.entries.delete(vehicle); e = null; }
    if (bumperToLine > STOP_ZONE_M || bumperToLine < -PAST_M || (e && bumperToLine < 0 && v > GONE_MPS)) {
      if (!e) return null;
      const out = bumperToLine < 0 ? this.turnOf(e, world).wait_for : null;
      this.entries.delete(vehicle);
      return out;
    }
    if (!e) {
      if (Math.abs(v) >= STOPPED_MPS) return null;
      e = { vehicle, junction, edge: edgeId, heading: this.map.headingIn(edgeId), arrived: world.t, going: false, lastB: bumperToLine };
      this.entries.set(vehicle, e);
    }
    e.turn = turn;
    e.tick = world.tick;
    const crossed = e.lastB >= 0 && bumperToLine < 0;
    e.lastB = bumperToLine;
    const turnNow = this.turnOf(e, world);
    if (v > GOING_MPS && turnNow.go) { e.going = true; e.since = world.t; }
    return crossed && !turnNow.go ? turnNow.wait_for : null;
  }

  forget(vehicle) { this.entries.delete(vehicle); }

  // The vehicles waiting at a junction, or going through it, without any that have left.
  at(junction, world) {
    const out = [];
    for (const [vehicle, e] of this.entries) {
      if (e.going ? this.cleared(e, world) : world.tick - e.tick > STALE_TICKS) this.entries.delete(vehicle);
      else if (e.junction === junction) out.push(e);
    }
    return out;
  }

  cleared({ vehicle, junction, since }, world) {
    const node = this.map.nodes.get(junction) ?? this.map.intersections?.get(junction);
    if (!node || world.t - since > GOING_MAX_S) return true;
    const dx = node.x - vehicle.x, dy = node.y - vehicle.y;
    return Math.hypot(dx, dy) > this.clearM(junction) && dx * Math.cos(vehicle.psi) + dy * Math.sin(vehicle.psi) < 0;
  }

  // How far past the centre a vehicle's reference point (its rear axle) is clear of the junction.
  clearM(junction) {
    const inter = this.map.nodes.has(junction) ? null : this.map.intersections?.get(junction);
    if (!inter) return CLEAR_M;
    this.clears ||= new Map();
    if (!this.clears.has(junction)) {
      const spread = Math.max(0, ...(inter.vertices || []).map((id) => { const n = this.map.nodes.get(id); return n ? Math.hypot(n.x - inter.x, n.y - inter.y) : 0; }));
      this.clears.set(junction, Math.max(CLEAR_M, ...inter.approaches.map((a) => spread + this.map.crossingHalfWidth(a.edge) + CLEAR_PAST_M)));
    }
    return this.clears.get(junction);
  }

  // Whether `b` goes before `a`.
  precedes(b, a) {
    if (a === b || a.going) return false;
    const rel = wrap(b.heading - a.heading);
    if (Math.abs(rel) < Math.PI / 6) return false;              // the same approach: one behind the other
    const opposite = Math.abs(rel) > Math.PI * 5 / 6;
    if (opposite && lefty(a.turn) === lefty(b.turn)) return false;
    if (b.going) return true;
    if (b.arrived < a.arrived - TIE_S) return true;
    if (b.arrived > a.arrived + TIE_S) return false;
    // stopped together: from opposite sides the left turn waits; otherwise the one on the right goes
    // (its approach heads a quarter turn to the left of a's)
    return opposite ? lefty(a.turn) : rel > 0;
  }

  // Whether a vehicle in the queue may go now (`go`) and, if not, the vehicle it waits for: the one
  // that goes before it and stopped first. `before` lists every vehicle that goes before it. With
  // `seen`, only the vehicles it can see take part (the driven car's view of the order).
  turnOf(entry, world, seen = null) {
    const all = this.at(entry.junction, world).filter((e) => !seen || e === entry || seen(e.vehicle));
    const before = all.filter((b) => this.precedes(b, entry)).sort((x, y) => x.arrived - y.arrived);
    if (!before.length) return { go: true, wait_for: null, before: [] };
    // everyone waiting for someone: the first to stop goes
    if (all.every((e) => all.some((b) => this.precedes(b, e)))) {
      const first = all.reduce((x, y) => (y.arrived < x.arrived || (y.arrived === x.arrived && String(y.vehicle.id) < String(x.vehicle.id)) ? y : x));
      if (first === entry) return { go: true, wait_for: null, before: [] };
    }
    return { go: false, wait_for: before[0].vehicle, before: before.map((b) => b.vehicle) };
  }

  // A vehicle's turn (among the vehicles it can see, with `seen`): null when it is not in a queue.
  status(vehicle, world, seen = null) {
    const e = this.entries.get(vehicle);
    if (!e || (e.going ? this.cleared(e, world) : world.tick - e.tick > STALE_TICKS)) return null;
    return { ...this.turnOf(e, world, seen), arrived: e.arrived, going: e.going, junction: e.junction };
  }
}
