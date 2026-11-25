// A route as returned by /api/route: a 1 m polyline plus edge list and turns. Provides projection
// with a hint so following the route is O(1) per tick, offset points for lateral maneuvers, and the
// same-direction lanes beside the route for lane changes.

import { cumulative, pointAt, headingAt, projectPoint, dist } from "./mapdata.js";
import { secondsToGreen as secondsToGreenFor } from "../sim/signals.js";
import { firstHookResult, hooks } from "../sim/features/index.js";
import { CAR } from "../sim/vehicle.js";
import { PEEK_SHORT_M } from "../sim/priority.js";

// Within this distance of where the route moves to another lane of the same street (the router
// takes the left lane on the block before a left turn), that lane already counts as the route's
// lane, so the car changes into it as a lane change instead of sliding across with the polyline.
export const PREPARE_LANE_M = 150;
const RAMP_M = 40; // the polyline's own move between lanes is measured up to this far either side of the join
const ROUTE_LANE_INDEX = hooks("routeLaneIndex");
const ROUTE_LANE_MERGES = hooks("routeLaneMerges");
const NO_MERGES = Object.freeze([]);

function routeGeometry(data, map) {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new TypeError("Route data must be an object");
  if (!Array.isArray(data.polyline) || data.polyline.length === 0)
    throw new TypeError("Route polyline must contain at least one point");
  for (const [i, point] of data.polyline.entries()) {
    if (!Array.isArray(point) || !Number.isFinite(point[0]) || !Number.isFinite(point[1]))
      throw new TypeError(`Route polyline point ${i} must have finite x and y coordinates`);
  }
  if (!Array.isArray(data.edges)) throw new TypeError("Route edges must be an array");
  for (const id of data.edges) {
    if (!map.edges.has(id)) throw new RangeError(`Route references unknown road ${String(id)}`);
  }
  if (data.start_s != null && !Number.isFinite(data.start_s)) throw new TypeError("Route start_s must be finite");
  if (data.goal_s != null && !Number.isFinite(data.goal_s)) throw new TypeError("Route goal_s must be finite");
  if (data.turns != null) {
    if (!Array.isArray(data.turns)) throw new TypeError("Route turns must be an array");
    for (const [i, turn] of data.turns.entries()) {
      if (!turn || typeof turn.dir !== "string") throw new TypeError(`Route turn ${i} requires a direction`);
      if (!Number.isFinite(turn.at_m)) throw new TypeError(`Route turn ${i} requires a finite distance`);
    }
  }
  const cum = cumulative(data.polyline);
  if (!Number.isFinite(cum.at(-1))) throw new RangeError("Route polyline length must be finite");
  return cum;
}

// How far right the polyline has moved at s through these moves (laneShifts, busMerges).
function shiftSum(moves, s) {
  let sum = 0;
  for (const sh of moves) {
    const k = s - sh.at - sh.lo;
    if (k <= 0) continue;
    if (k >= sh.ramp.length - 1) {
      sum += sh.by;
      continue;
    }
    const j = Math.floor(k);
    sum += sh.by * (sh.ramp[j] + (sh.ramp[j + 1] - sh.ramp[j]) * (k - j));
  }
  return sum;
}

export class Route {
  constructor(data, map, vehicleSpec = CAR) {
    this.cum = routeGeometry(data, map);
    this.id = data.id;
    this.pts = data.polyline;
    this.length = this.cum[this.cum.length - 1];
    this.edges = data.edges;
    // the lane the router followed on each edge (routes saved before it was sent infer it instead)
    this.edgeLanes = Array.isArray(data.lanes) && data.lanes.length === data.edges.length ? data.lanes : null;
    this.turns = data.turns ?? [];
    this.summary = data.summary;
    this.map = map;
    // arc-length at which each edge starts, so controls can be located along the route
    this.edgeStarts = [];
    let s = 0;
    for (let i = 0; i < this.edges.length; i++) {
      const e = map.edges.get(this.edges[i]);
      this.edgeStarts.push(s);
      s += i === 0 ? e.length - (data.start_s || 0) : e.length;
    }
    this.edgeStarts.push(s);
    // A U-turn where the route's own polyline turns (sim/turnaround.js stops short of it and turns round
    // there): the server gives it in summed edge lengths, which drift from the polyline (rounded corners)
    // by metres over a long route, and the car would come to the turn before the turnaround was offered.
    if (this.edges.length > 1 && this.turns.some((t) => t.dir === "uturn")) {
      const starts = this.laneEdgeStarts();
      this.turns = this.turns.map((t) => {
        if (t.dir !== "uturn") return t;
        let best = 1;
        const gap = (j) => Math.min(Math.abs(this.edgeStarts[j] - t.at_m), Math.abs(starts[j] - t.at_m));
        for (let i = 1; i < this.edges.length; i++) {
          if (gap(i) < gap(best)) best = i;
        }
        return { ...t, at_m: starts[best] };
      });
    }
    this.hint = 0;
    // traffic controls along the route: stop-line position expressed as route arc length. A
    // junction without a sign or signal counts too (MapData.priorityOf), where the car gives way
    // there or, on the road with the right of way, where it turns left across oncoming traffic.
    this.controls = [];
    for (let i = 0; i < this.edges.length; i++) {
      const e = map.edges.get(this.edges[i]);
      // (and, past a stop sign standing well short of the junction, the junction itself: MapData.junctionPastStop)
      for (const control of e
        ? [e.control || (map.priorityOf ? map.priorityOf(e.id) : null), map.junctionPastStop?.(e.id)]
        : []) {
        if (!control) continue;
        const lineOnEdge = pointAt(e.pts, e.cum, control.s_line);
        const p = projectPoint(this.pts, this.cum, lineOnEdge);
        if (!p || p.distance > 12) continue;
        if (i === 0 && control.s_line < (data.start_s || 0) - 1) continue; // already behind the start
        // Include controls the selected car's front bumper reaches beyond its destination.
        if (
          i === this.edges.length - 1 &&
          data.goal_s !== undefined &&
          control.s_line > data.goal_s + vehicleSpec.length - vehicleSpec.rearOverhang + 0.3
        )
          continue;
        // A longer car can reach a line beyond the truncated route. Projection clamps to the
        // endpoint, so retain its forward distance rather than moving the line to the destination.
        let sRoute = p.s;
        if (i === this.edges.length - 1 && p.s >= this.length - 1e-6) {
          const end = this.endPoint(),
            h = this.headingAt(this.length);
          const beyond = (lineOnEdge[0] - end[0]) * Math.cos(h) + (lineOnEdge[1] - end[1]) * Math.sin(h);
          if (beyond > 0) sRoute += beyond;
        }
        const junctionNode = map.nodes.get(e.to);
        const inter = control.type === "signal" ? map.intersections.get(control.id) : null;
        // The turn the route makes at this junction, from the streets either side of it (across short
        // links that go straight inside it), and where the junction's centre is along the route,
        // searched forward from the line.
        const { turn } = map.turnThrough(this.edges, i, map.junctionNodes(inter));
        if (control.rule === "major" && turn !== "left" && turn !== "uturn") continue;
        const centre = inter ? [inter.x, inter.y] : junctionNode ? [junctionNode.x, junctionNode.y] : null;
        const cp = centre ? projectPoint(this.pts, this.cum, centre, p.index) : null;
        const sJunction = cp && cp.distance < 15 && cp.s >= sRoute - 1 ? cp.s : null;
        this.controls.push({
          edge: e.id,
          control,
          sRoute,
          junction: junctionNode ? [junctionNode.x, junctionNode.y] : null,
          turn,
          sJunction,
          // where the front bumper stops to look, giving way (sim/priority.js)
          sPeek: Math.max(sRoute, (sJunction ?? sRoute + 8) - map.crossingHalfWidth(e.id) - PEEK_SHORT_M),
          secondsToGreen: inter ? (t) => secondsToGreenFor(inter, control.group, t, e.id, turn) : null,
        });
      }
    }
    this.controls.sort((a, b) => a.sRoute - b.sRoute);
    // where each street's speed limit starts, located on the polyline like the controls
    this.limitMarks = [];
    for (let i = 1; i < this.edges.length; i++) {
      const e = map.edges.get(this.edges[i]);
      if (!e?.limit) continue;
      const p = projectPoint(this.pts, this.cum, e.pts[0]);
      if (p && p.distance < 12) this.limitMarks.push({ at: p.s, limit: e.limit });
    }
    // the stretches of school and playground zone along it (sim/speed-zones.js), in route arc length,
    // whether or not they are in effect: [{ from, to, zone }]
    this.zoneMarks = [];
    if (map.zoneSpans?.size) {
      const starts = this.laneEdgeStarts();
      for (let i = 0; i < this.edges.length; i++) {
        const back = i === 0 ? data.start_s || 0 : 0;
        for (const span of map.zoneSpans.get(this.edges[i]) || []) {
          const from = Math.max(0, starts[i] + span.from - back),
            to = Math.min(this.length, starts[i] + span.to - back);
          if (to > from) this.zoneMarks.push({ from, to, zone: span.zone });
        }
      }
    }
    // the speed humps, tables, cushions and bumps along it (sim/traffic-calming.js), in route arc length,
    // in order: [{ at (its centre), half (half its length), device }]
    this.calmingMarks = [];
    if (map.calmingSpans?.size) {
      const starts = this.laneEdgeStarts();
      for (let i = 0; i < this.edges.length; i++) {
        const back = i === 0 ? data.start_s || 0 : 0;
        for (const span of map.calmingSpans.get(this.edges[i]) || []) {
          const at = starts[i] + span.s - back;
          if (at + span.half > 0 && at - span.half < this.length)
            this.calmingMarks.push({ at, half: span.half, device: span.device });
        }
      }
      this.calmingMarks.sort((a, b) => a.at - b.at);
    }
  }

  // Without a hint this tracks the ego (and remembers where it is); with one it projects anything
  // else (other vehicles, candidate forward-simulations) and leaves the ego's hint alone.
  project(x, y, hint = null) {
    const p = projectPoint(this.pts, this.cum, [x, y], hint === null ? this.hint : hint);
    if (p && hint === null) this.hint = p.index;
    return p;
  }
  pointAt(s) {
    return pointAt(this.pts, this.cum, s);
  }
  headingAt(s) {
    return headingAt(this.pts, this.cum, s);
  }
  offsetPointAt(s, d) {
    const p = this.pointAt(s);
    if (!p || !Number.isFinite(d)) return undefined;
    const h = this.headingAt(s);
    return [p[0] + Math.sin(h) * d, p[1] - Math.cos(h) * d]; // right of travel is (sin h, -cos h)
  }
  turnsAfter(s) {
    return this.turns.filter((t) => t.at_m > s - 3);
  }

  // Speed limits that start within `horizon` meters ahead of s: [{ at, limit }] in route arc length.
  limitsAhead(s, horizon = 80) {
    return this.limitMarks.filter((m) => m.at > s && m.at <= s + horizon);
  }
  // School and playground zone stretches that end past s and start within `horizon` meters of it.
  zonesAhead(s, horizon = 80) {
    return (this.zoneMarks || []).filter((m) => m.to > s && m.from <= s + horizon);
  }
  edgeIndexAt(s) {
    let i = 0;
    while (i + 1 < this.edgeStarts.length - 1 && this.edgeStarts[i + 1] <= s) i++;
    return i;
  }
  // Curvature-limited comfortable speed a bit ahead: v = sqrt(a_lat * R)
  curveSpeedAt(s, lookahead = 15, aLat = 2.5) {
    if (!Number.isFinite(aLat) || aLat < 0) throw new RangeError("Lateral acceleration must be finite and nonnegative");
    const s0 = Math.min(s + lookahead, this.length - 1);
    const h0 = this.headingAt(Math.max(0, s0 - 6));
    const h1 = this.headingAt(Math.min(this.length, s0 + 6));
    const delta = Math.abs(h1 - h0);
    const dh = delta > Math.PI ? Math.abs(delta - 2 * Math.PI) : delta;
    if (dh < 1e-3) return Infinity;
    const radius = 12 / dh;
    return Math.sqrt(aLat * radius);
  }
  remaining(s) {
    return Math.max(0, this.length - s);
  }

  // Route arc length at which each edge begins, measured on the route's own polyline (turns are
  // rounded and the polyline resampled, so summed edge lengths drift from it): where the polyline
  // passes the edge's first node, searched forward from the previous edge's start over at most that
  // edge's length, so a route that comes back through a junction finds the right visit. The last
  // entry is the route's end.
  laneEdgeStarts() {
    if (this._laneEdgeStarts) return this._laneEdgeStarts;
    const out = [0];
    let lo = 0;
    for (let i = 1; i < this.edges.length; i++) {
      const node = this.map.nodes.get(this.map.edges.get(this.edges[i])?.from);
      const reach = this.cum[lo] + (this.map.edges.get(this.edges[i - 1])?.length || 0) + 30;
      let hi = lo + 1;
      while (hi < this.pts.length - 1 && this.cum[hi] < reach) hi++;
      const p = node ? projectPoint(this.pts.slice(lo, hi + 1), this.cum.slice(lo, hi + 1), [node.x, node.y]) : null;
      const s = p ? p.s : Math.max(out[i - 1], this.edgeStarts[i]);
      if (p) lo += p.index;
      out.push(Math.min(this.length, s));
    }
    out.push(this.length);
    return (this._laneEdgeStarts = out);
  }
  laneEdgeAt(s) {
    const starts = this.laneEdgeStarts();
    let i = 0;
    while (i + 1 < this.edges.length && starts[i + 1] <= s) i++;
    return i;
  }

  // The lanes of route edge i: their count, which one the route follows (0 is the leftmost) and
  // their offsets right of the street's centreline. The router says which lane it followed; for an
  // older route without that, it is the lane closest to the route's own polyline across the part of
  // the edge the route drives.
  laneInfo(i) {
    this._lanes ||= [];
    if (this._lanes[i]) return this._lanes[i];
    const e = this.map.edges.get(this.edges[i]);
    const info = { lanes: e ? e.lanes || 1 : 1, idx: 0, offsets: e?.lane_offsets || [0], ring: !!e?.ring };
    const routed = this.edgeLanes ? this.edgeLanes[i] : null;
    if (Number.isInteger(routed) && routed >= 0 && routed < info.lanes) info.idx = routed;
    else if (info.lanes > 1) {
      const starts = this.laneEdgeStarts(),
        a = starts[i],
        b = starts[i + 1];
      const samples = [0.3, 0.5, 0.7].map((f) => this.pointAt(a + (b - a) * f));
      let best = Infinity;
      for (let k = 0; k < info.lanes; k++) {
        const lane = this.map.lane(e.id, k);
        if (!lane) continue;
        const d = samples.reduce((sum, p) => sum + projectPoint(lane.pts, lane.cum, p).distance, 0);
        if (d < best) {
          best = d;
          info.idx = k;
        }
      }
    }
    return (this._lanes[i] = info);
  }

  // Whether route edge j runs straight on into edge j + 1 with the same lanes (count and positions),
  // so each lane carries on as the same lane.
  sameLanes(j) {
    this._same ||= [];
    if (this._same[j] !== undefined) return this._same[j];
    let same = false;
    if (j + 1 < this.edges.length) {
      const a = this.laneInfo(j),
        b = this.laneInfo(j + 1);
      same =
        !a.ring &&
        !b.ring &&
        a.lanes === b.lanes &&
        a.offsets.every((o, k) => Math.abs(o - b.offsets[k]) <= 0.4) &&
        this.map.classifyTurn(this.map.turnAngle(this.edges[j], this.edges[j + 1])) === "straight";
    }
    return (this._same[j] = same);
  }
  // The first edge of the straight run of same-lane edges that edge i belongs to.
  chainOf(i) {
    if (!this._chains) {
      this._chains = [0];
      for (let j = 1; j < this.edges.length; j++) this._chains.push(this.sameLanes(j - 1) ? this._chains[j - 1] : j);
    }
    return this._chains[i];
  }

  // Where the route moves to another lane of the same street: the edge it moves on (i), the lanes
  // it moves between, the move in metres right, its chain, and the fraction of the move the
  // polyline has made at each metre from RAMP_M before the join until it is across (the polyline
  // blends between the two lanes over a few metres).
  laneShifts() {
    if (this._shifts) return this._shifts;
    const starts = this.laneEdgeStarts(),
      out = [];
    for (let i = 1; i < this.edges.length; i++) {
      const a = this.laneInfo(i - 1),
        b = this.laneInfo(i);
      const at = starts[i],
        by = b.offsets[b.idx] - b.offsets[a.idx];
      if (!this.sameLanes(i - 1) || a.idx === b.idx || Math.abs(by) < 0.5) continue;
      // measured outward from the join, so a corner just before it does not count as part of the move
      const made = (d) => {
        const lane = this.map.lane(this.edges[d < 0 ? i - 1 : i], a.idx);
        const q = lane
          ? projectPoint(lane.pts, lane.cum, this.pointAt(Math.max(0, Math.min(this.length, at + d))))
          : null;
        return q ? Math.max(0, Math.min(1, q.lateral / by)) : d < 0 ? 0 : 1;
      };
      const ramp = [made(0)];
      let lo = 0;
      for (let d = -1; d >= Math.max(-RAMP_M, starts[i - 1] - at) && ramp[0] > 0.001; d--, lo--)
        ramp.unshift(Math.min(ramp[0], made(d)));
      for (let d = 1; d <= Math.min(RAMP_M, starts[i + 1] - at) && ramp[ramp.length - 1] < 0.999; d++)
        ramp.push(Math.max(ramp[ramp.length - 1], made(d)));
      // the move is complete beyond the measured stretch (it is only cut short by a very short edge)
      ramp[0] = 0;
      ramp[ramp.length - 1] = 1;
      out.push({ i, at, from: a.idx, to: b.idx, by, chain: this.chainOf(i), lo, ramp });
    }
    return (this._shifts = out);
  }
  // How far right the polyline has moved at s through the route's own lane moves, counted from the
  // route's start. Lane laws subtract the move since they were chosen, so a car holds its lane
  // where the polyline moves to another one.
  frameShift(s) {
    const sum = shiftSum(this.laneShifts(), s);
    const moves = this.busMerges();
    return moves.length ? sum + shiftSum(moves, s) : sum;
  }
  frameMove(s0, s) {
    return Number.isFinite(s0) && (this.laneShifts().length || this.busMerges().length)
      ? this.frameShift(s) - this.frameShift(s0)
      : 0;
  }

  // The route's lane at s as the car drives it: the lane the route follows here or, within
  // PREPARE_LANE_M of a move to another lane of the same street, the lane it moves to (`ahead`). Its
  // index (0 is the leftmost), the edge's lane count and offsets, the chain the edge belongs to and
  // the lane's centre in metres right of the polyline at s.
  laneAt(s) {
    const { info, chain, idx } = this.laneIndexAt(s);
    return {
      lanes: info.lanes,
      idx,
      lineIdx: info.idx,
      offsets: info.offsets,
      ring: info.ring,
      chain,
      ahead: idx !== info.idx,
      center: this.laneOffsetAt(s, idx),
    };
  }
  // laneAt's choice of lane, without its centre: the route edge (i) and its lanes, its chain, and the lane.
  laneIndexAt(s) {
    const i = this.laneEdgeAt(s),
      info = this.laneInfo(i),
      chain = this.chainOf(i);
    let idx = info.idx;
    for (const sh of this.laneShifts()) {
      if (sh.at <= s || sh.chain !== chain) continue;
      if (sh.at - s > PREPARE_LANE_M) break;
      idx = sh.to;
    }
    for (const select of ROUTE_LANE_INDEX) idx = select(this, s, i, info, idx, PREPARE_LANE_M);
    return { i, info, chain, idx };
  }
  // Kept for callers inspecting reserved-lane transitions.
  busMerges() {
    return firstHookResult(ROUTE_LANE_MERGES, this, RAMP_M) ?? NO_MERGES;
  }
  // Centre of lane k of the edge at s, in metres right of the polyline there.
  laneOffsetAt(s, k) {
    const i = this.laneEdgeAt(s),
      info = this.laneInfo(i);
    let settled = 0;
    for (const sh of this.laneShifts()) if (sh.i <= i) settled += sh.by;
    for (const m of this.busMerges()) if (m.i <= i) settled += m.by;
    return info.offsets[k] - info.offsets[info.idx] - (this.frameShift(s) - settled);
  }

  // The lane `delta` lanes right of the route's lane at s (negative is left): its centre in metres
  // right of the route, and the route arc length where it stops running beside the route (a turn, a
  // change in the lanes, a roundabout or the destination). Null when there is no such lane here.
  laneSpan(s, delta) {
    const starts = this.laneEdgeStarts();
    const here = this.laneAt(s),
      to = here.idx + delta;
    if (here.ring || to < 0 || to >= here.lanes) return null;
    const i = this.laneEdgeAt(s),
      beside = here.offsets[to] - here.offsets[here.idx];
    let j = i;
    while (j + 1 < this.edges.length && starts[j + 1] - s < 400) {
      const b = this.laneInfo(j + 1),
        prev = this.laneInfo(j);
      const straight = this.map.classifyTurn(this.map.turnAngle(this.edges[j], this.edges[j + 1])) === "straight";
      if (
        !straight ||
        b.ring ||
        b.lanes !== prev.lanes ||
        this.laneAt(starts[j + 1]).idx !== here.idx ||
        Math.abs(b.offsets[to] - b.offsets[here.idx] - beside) > 0.4
      )
        break;
      j++;
    }
    return { offset: this.laneOffsetAt(s, to), until: Math.min(this.length, starts[j + 1]) };
  }
  endPoint() {
    return this.pts[this.pts.length - 1];
  }
  static distanceBetween(a, b) {
    return dist(a, b);
  }
}
