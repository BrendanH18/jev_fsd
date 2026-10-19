// A route as returned by /api/route: a 1 m polyline plus edge list and turns. Provides projection
// with a hint so following the route is O(1) per tick, offset points for lateral maneuvers, and the
// same-direction lanes beside the route for lane changes.

import { cumulative, pointAt, headingAt, projectPoint, dist } from "./mapdata.js";
import { secondsToGreen as secondsToGreenFor } from "../sim/signals.js";
import { CAR } from "../sim/vehicle.js";

export class Route {
  constructor(data, map, vehicleSpec = CAR) {
    this.id = data.id;
    this.pts = data.polyline;
    this.cum = cumulative(this.pts);
    this.length = this.cum[this.cum.length - 1];
    this.edges = data.edges;
    // the lane the router followed on each edge (routes saved before it was sent infer it instead)
    this.edgeLanes = Array.isArray(data.lanes) && data.lanes.length === data.edges.length ? data.lanes : null;
    this.turns = data.turns;
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
    this.hint = 0;
    // traffic controls along the route: stop-line position expressed as route arc length
    this.controls = [];
    for (let i = 0; i < this.edges.length; i++) {
      const e = map.edges.get(this.edges[i]);
      if (!e || !e.control) continue;
      const lineOnEdge = pointAt(e.pts, e.cum, e.control.s_line);
      const p = projectPoint(this.pts, this.cum, lineOnEdge);
      if (!p || p.distance > 12) continue;
      if (i === 0 && e.control.s_line < (data.start_s || 0) - 1) continue;  // already behind the start
      // Include controls the selected car's front bumper reaches beyond its destination.
      if (i === this.edges.length - 1 && data.goal_s !== undefined && e.control.s_line > data.goal_s + vehicleSpec.length - vehicleSpec.rearOverhang + 0.3) continue;
      // A longer car can reach a line beyond the truncated route. Projection clamps to the
      // endpoint, so retain its forward distance rather than moving the line to the destination.
      let sRoute = p.s;
      if (i === this.edges.length - 1 && p.s >= this.length - 1e-6) {
        const end = this.endPoint(), h = this.headingAt(this.length);
        const beyond = (lineOnEdge[0] - end[0]) * Math.cos(h) + (lineOnEdge[1] - end[1]) * Math.sin(h);
        if (beyond > 0) sRoute += beyond;
      }
      const junctionNode = map.nodes.get(e.to);
      const inter = e.control.type === "signal" ? map.intersections.get(e.control.id) : null;
      this.controls.push({
        edge: e.id, control: e.control, sRoute, junction: junctionNode ? [junctionNode.x, junctionNode.y] : null,
        secondsToGreen: inter ? (t) => secondsToGreenFor(inter, e.control.group, t) : null,
      });
    }
    this.controls.sort((a, b) => a.sRoute - b.sRoute);
    // where each street's speed limit starts, located on the polyline like the controls
    this.limitMarks = [];
    for (let i = 1; i < this.edges.length; i++) {
      const e = map.edges.get(this.edges[i]);
      if (!e || !e.limit) continue;
      const p = projectPoint(this.pts, this.cum, e.pts[0]);
      if (p && p.distance < 12) this.limitMarks.push({ at: p.s, limit: e.limit });
    }
  }

  // Without a hint this tracks the ego (and remembers where it is); with one it projects anything
  // else (other vehicles, candidate forward-simulations) and leaves the ego's hint alone.
  project(x, y, hint = null) {
    const p = projectPoint(this.pts, this.cum, [x, y], hint === null ? this.hint : hint);
    if (p && hint === null) this.hint = p.index;
    return p;
  }
  pointAt(s) { return pointAt(this.pts, this.cum, s); }
  headingAt(s) { return headingAt(this.pts, this.cum, s); }
  offsetPointAt(s, d) {
    const p = this.pointAt(s);
    const h = this.headingAt(s);
    return [p[0] + Math.sin(h) * d, p[1] - Math.cos(h) * d];  // right of travel is (sin h, -cos h)
  }
  turnsAfter(s) { return this.turns.filter((t) => t.at_m > s - 3); }

  // Speed limits that start within `horizon` meters ahead of s: [{ at, limit }] in route arc length.
  limitsAhead(s, horizon = 80) { return this.limitMarks.filter((m) => m.at > s && m.at <= s + horizon); }
  edgeIndexAt(s) {
    let i = 0;
    while (i + 1 < this.edgeStarts.length - 1 && this.edgeStarts[i + 1] <= s) i++;
    return i;
  }
  // Curvature-limited comfortable speed a bit ahead: v = sqrt(a_lat * R)
  curveSpeedAt(s, lookahead = 15, aLat = 2.5) {
    const s0 = Math.min(s + lookahead, this.length - 1);
    const h0 = this.headingAt(Math.max(0, s0 - 6));
    const h1 = this.headingAt(Math.min(this.length, s0 + 6));
    let dh = Math.abs(h1 - h0);
    while (dh > Math.PI) dh = Math.abs(dh - 2 * Math.PI);
    if (dh < 1e-3) return Infinity;
    const radius = 12 / dh;
    return Math.sqrt(aLat * radius);
  }
  remaining(s) { return Math.max(0, this.length - s); }

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
      const starts = this.laneEdgeStarts(), a = starts[i], b = starts[i + 1];
      const samples = [0.3, 0.5, 0.7].map((f) => this.pointAt(a + (b - a) * f));
      let best = Infinity;
      for (let k = 0; k < info.lanes; k++) {
        const lane = this.map.lane(e.id, k);
        if (!lane) continue;
        const d = samples.reduce((sum, p) => sum + projectPoint(lane.pts, lane.cum, p).distance, 0);
        if (d < best) { best = d; info.idx = k; }
      }
    }
    return (this._lanes[i] = info);
  }

  // The lane `delta` lanes right of the route's lane at s (negative is left): its centre in metres
  // right of the route, and the route arc length where it stops running beside the route (a turn, a
  // change in the lanes, a roundabout or the destination). Null when there is no such lane here.
  laneSpan(s, delta) {
    const starts = this.laneEdgeStarts();
    const i = this.laneEdgeAt(s), a = this.laneInfo(i), to = a.idx + delta;
    if (a.ring || to < 0 || to >= a.lanes) return null;
    const offset = a.offsets[to] - a.offsets[a.idx];
    let j = i;
    while (j + 1 < this.edges.length && starts[j + 1] - s < 400) {
      const b = this.laneInfo(j + 1), prev = this.laneInfo(j);
      const straight = this.map.classifyTurn(this.map.turnAngle(this.edges[j], this.edges[j + 1])) === "straight";
      if (!straight || b.ring || b.lanes !== prev.lanes || b.idx !== prev.idx || Math.abs(b.offsets[to] - b.offsets[b.idx] - offset) > 0.4) break;
      j++;
    }
    return { offset, until: Math.min(this.length, starts[j + 1]) };
  }
  endPoint() { return this.pts[this.pts.length - 1]; }
  static distanceBetween(a, b) { return dist(a, b); }
}
