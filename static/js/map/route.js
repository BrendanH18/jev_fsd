// A route as returned by /api/route: a 1 m polyline plus edge list and turns. Provides projection
// with a hint so following the route is O(1) per tick, and offset points for lateral maneuvers.

import { cumulative, pointAt, headingAt, projectPoint, dist } from "./mapdata.js";
import { secondsToGreen as secondsToGreenFor } from "../sim/signals.js";

export class Route {
  constructor(data, map) {
    this.id = data.id;
    this.pts = data.polyline;
    this.cum = cumulative(this.pts);
    this.length = this.cum[this.cum.length - 1];
    this.edges = data.edges;
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
      const junctionNode = map.nodes.get(e.to);
      const inter = e.control.type === "signal" ? map.intersections.get(e.control.id) : null;
      this.controls.push({
        edge: e.id, control: e.control, sRoute: p.s, junction: junctionNode ? [junctionNode.x, junctionNode.y] : null,
        secondsToGreen: inter ? (t) => secondsToGreenFor(inter, e.control.group, t) : null,
      });
    }
    this.controls.sort((a, b) => a.sRoute - b.sRoute);
  }

  project(x, y, hint = null) {
    const p = projectPoint(this.pts, this.cum, [x, y], hint === null ? this.hint : hint);
    if (p) this.hint = p.index;
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
  endPoint() { return this.pts[this.pts.length - 1]; }
  static distanceBetween(a, b) { return dist(a, b); }
}
