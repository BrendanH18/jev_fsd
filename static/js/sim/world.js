// The simulation world: map, ego car, traffic, signals, time, and honest counters.

import { Vehicle, CAR } from "./vehicle.js";
import { phaseOf, StopMemory } from "./signals.js";
import { obbOverlap } from "./collision.js";
import { ringBusy } from "./roundabout.js";
import { ParkedCars, PARKED_DENSITY } from "./parking.js";
import { Crowd, PEDESTRIANS } from "./pedestrians.js";
import { Visibility } from "./visibility.js";
import { setWeather } from "./weather.js";
import { StaticObstacles, poseOf } from "./static-obstacles.js";

const AUDIT_ROUTE_CORRIDOR_M = 4;
const AUDIT_ROUTE_HEADING_RAD = Math.PI / 3;

export class World {
  constructor(map, { seed = 1, parked = PARKED_DENSITY, pedestrians = PEDESTRIANS, weather = "dry", vehicleSpec = CAR } = {}) {
    this.map = map;
    this.seed = seed;
    this.visibility = new Visibility(map);
    this.staticObstacles = new StaticObstacles(map);
    this.staticContacts = new Map();
    this.weather = setWeather(weather).name;
    this.parked = new ParkedCars(map, { seed, density: parked });
    this.t = 0;
    this.tick = 0;
    this.ego = new Vehicle(0, 0, 0, 0, vehicleSpec);
    this.npcs = [];
    this.route = null;
    this.destination = null;
    this.paused = false;
    this.egoStop = new StopMemory();
    this.violations = { collisions: 0, collisions_at_fault: 0, red_lights_run: 0, stop_signs_run: 0, failed_to_yield: 0, off_road_s: 0, safety_brakes: 0, fallbacks: 0, deadlock_overrides: 0 };
    this.events = [];  // transient per-step events for the UI
    this.lastRoad = null;
    this.spawnEgo();
    this.crowd = new Crowd(this, { seed, count: pedestrians });
  }

  // Dynamic/roadside objects near (x, y). Buildings use a separate footprint index so traffic
  // controllers do not mistake a large building's center for a vehicle in their lane.
  obstaclesNear(x, y, r) {
    const out = this.npcs.filter((n) => Math.abs(n.x - x) < r + 5 && Math.abs(n.y - y) < r + 5);
    return out.concat(this.parked.near(x, y, r), this.parked.doorsNear(x, y, r), this.crowd.near(x, y, r));
  }

  visibleObstaclesNear(x, y, r, observer = this.ego) {
    return this.obstaclesNear(x, y, r).filter((o) => this.visibility.sees(observer, o));
  }

  // Middle of a long residential edge near the map center, facing along it.
  spawnEgo() {
    const [x0, y0, x1, y1] = this.map.extent;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, span = Math.min(x1 - x0, y1 - y0) / 2;
    let best = null;
    for (const e of this.map.edges.values()) {
      const mid = e.pts[Math.floor(e.pts.length / 2)];
      const inside = mid[0] > x0 && mid[0] < x1 && mid[1] > y0 && mid[1] < y1;
      if (!inside) continue;
      const centrality = 1 - Math.min(1, Math.hypot(mid[0] - cx, mid[1] - cy) / span);
      const score = Math.min(e.length, 200) * (e.cls === "residential" ? 1.2 : 1) * (e.control ? 0.8 : 1) * (0.4 + centrality);
      if (!best || score > best.score) best = { e, score };
    }
    const lane = this.map.lane(best.e.id, best.e.lanes - 1);
    this.placeOnLane(lane, lane.length / 2);
  }

  placeOnLane(lane, s) {
    const { pointAt, headingAt } = lanePoint(lane, s);
    this.ego.x = pointAt[0]; this.ego.y = pointAt[1]; this.ego.psi = headingAt; this.ego.v = 0; this.ego.delta = 0; this.ego.a = 0;
    this.egoStop.reset();
    this.resetContactHistory();
  }

  resetToLane() {
    const near = this.map.nearestLane(this.ego.x, this.ego.y, this.ego.psi, 80);
    if (near) {
      this.ego.x = near.point[0]; this.ego.y = near.point[1]; this.ego.psi = near.heading; this.ego.v = 0; this.ego.delta = 0; this.ego.a = 0;
      this.resetContactHistory();
    }
    this.events.push({ type: "reset" });
  }

  phase(intersectionId) { return phaseOf(this.map.intersections.get(intersectionId), this.t); }

  resetContactHistory() {
    this.ego.vy = 0; this.ego.r = 0; this.ego.ax = 0; this.ego.latAccel = 0;
    this._previousStaticPose = poseOf(this.ego);
    this.staticContacts.clear();
    this._lastFront = null;
    this.lastRoad = null;
  }

  auditStatic(dt) {
    const hit = this.staticObstacles.sweep(this._previousStaticPose || poseOf(this.ego), poseOf(this.ego), this.ego.spec);
    if (hit) {
      const { obstacle, safePose } = hit;
      if (!this.staticContacts.has(obstacle.id)) {
        this.violations.collisions++;
        this.violations.collisions_at_fault++;
        this.events.push({ type: "collision", with: obstacle.id, kind: obstacle.kind, fault: "ego", at_fault: true,
          t: Math.round(this.t * 10) / 10, ego_v: Math.round(this.ego.v * 10) / 10, other_v: 0 });
      }
      this.staticContacts.set(obstacle.id, 0);
      Object.assign(this.ego, safePose, { v: 0, a: 0, vy: 0, r: 0, ax: 0, latAccel: 0 });
    }
    // Keep a small contact skin after resolving the wall; throttle against it remains one
    // incident. A full second physically clear of that footprint permits another incident.
    const near = new Set(this.staticContacts.size ? this.staticObstacles.overlaps(this.ego.obb(), 0.1).map((o) => o.id) : []);
    for (const [id, clearFor] of this.staticContacts) {
      if (near.has(id) || hit?.obstacle.id === id) this.staticContacts.set(id, 0);
      else if (clearFor + dt > 1) this.staticContacts.delete(id);
      else this.staticContacts.set(id, clearFor + dt);
    }
    this._previousStaticPose = poseOf(this.ego);
    return !!hit;
  }

  // Where the ego is relative to the road network (cached per tick).
  roadInfo() {
    const rd = this.map.roadDistance(this.ego.x, this.ego.y);
    const near = this.map.nearestLane(this.ego.x, this.ego.y, this.ego.psi, 40);
    return {
      on_road: rd.distance < 1.0,
      distance_to_road: rd.distance,
      edge: near ? near.lane.edgeRef : rd.edge,
      lane: near ? near.lane : null,
      s: near ? near.s : 0,
      lateral: near ? near.lateral : 0,
      heading_error: near ? wrap(this.ego.psi - near.heading) : 0,
      name: (near ? near.lane.edgeRef : rd.edge)?.name || "",
      limit: (near ? near.lane.edgeRef : rd.edge)?.limit || 11.2,
    };
  }

  stepManual(dt, input) {
    let accel = 0;
    if (input.throttle) accel = this.ego.spec.maxAccel;
    if (input.brake) accel = this.ego.v > 0.2 ? -6 : -1.5;  // brake, then gently reverse
    if (input.hardBrake) accel = -this.ego.spec.maxBrake;
    // Keys are binary, unlike a steering wheel. Limit their angle at speed to a comfortable
    // cornering demand, then ramp it so a tap does not ask for full lock in a fast bend.
    const maxAngle = Math.min(this.ego.spec.maxSteer, Math.atan(3.2 * this.ego.spec.wheelbase / Math.max(1, this.ego.v ** 2)));
    const desired = (Number(!!input.left) - Number(!!input.right)) * maxAngle;
    const steer = this.ego.delta + Math.max(-0.8 * dt, Math.min(0.8 * dt, desired - this.ego.delta));
    if (input.brake && this.ego.v <= 0.2 && !input.hardBrake) {
      this.ego.step(dt, { steer, accel: -1.5, reverse: true });
      return;
    }
    this.ego.step(dt, { steer, accel });
  }

  // Called every physics tick after the ego (and NPCs) moved. Collisions and violations.
  // A collision counts once per contact: the pair must separate for a second before the next
  // one counts. Fault: "ego" when the moving ego ran into a car ahead going its way or standing
  // still; "other" when the ego was stopped or hit from behind; "shared" for crossing and oncoming
  // contacts, where right of way decides and the sim does not judge it.
  audit(dt, road) {
    this.events.length = 0;
    if (this.auditStatic(dt)) Object.assign(road, this.roadInfo());
    const egoBox = this.ego.obb();
    for (const n of this.obstaclesNear(this.ego.x, this.ego.y, 12)) {
      const touching = obbOverlap(egoBox, n.obb());
      if (touching && !n.contact) {
        const [cx, cy] = n.center;
        const rel = this.ego.toLocal(cx, cy);
        const egoCenterAhead = rel.ahead - (this.ego.spec.length / 2 - this.ego.spec.rearOverhang);
        const relHeading = Math.abs(wrap(n.psi - this.ego.psi));
        const fault = n.kind === "pedestrian" ? (this.ego.v < 0.5 ? "other" : "ego")
          : this.ego.v < 0.5 || egoCenterAhead < -1 ? "other"
          : egoCenterAhead > 0 && (relHeading < Math.PI / 4 || n.v < 0.5) ? "ego" : "shared";
        const atFault = fault === "ego";
        this.violations.collisions++;
        if (atFault) this.violations.collisions_at_fault++;
        this.events.push({
          type: "collision", with: n.id, kind: n.kind || "car", fault, at_fault: atFault, t: Math.round(this.t * 10) / 10,
          ego_v: Math.round(this.ego.v * 10) / 10, other_v: Math.round(n.v * 10) / 10,
          other_ahead: Math.round(egoCenterAhead * 10) / 10, other_right: Math.round(rel.right * 10) / 10,
          relative_heading_deg: Math.round(wrap(n.psi - this.ego.psi) * 180 / Math.PI),
        });
        this.ego.v = 0; this.ego.a = 0;
        n.v = 0; n.a = 0;
        n.frozen = 3;
      }
      if (touching) { n.contact = true; n.clearFor = 0; }
      else if (n.contact && (n.clearFor = (n.clearFor || 0) + dt) > 1) n.contact = false;
    }
    this.auditCrosswalks();
    if (!road.on_road) this.violations.off_road_s += dt;
    // The front bumper can reach a route's stop line while the rear axle is still on an
    // adjacent segment. Use the same upcoming route control as sensing instead of losing
    // stop memory when the closest physical lane belongs to that adjacent edge.
    const FRONT = this.ego.spec.length - this.ego.spec.rearOverhang;
    const routeProjection = this.route ? this.route.project(this.ego.x, this.ego.y) : null;
    const followsRoute = routeProjection && routeProjection.distance < AUDIT_ROUTE_CORRIDOR_M
      && Math.abs(wrap(this.ego.psi - routeProjection.heading)) < AUDIT_ROUTE_HEADING_RAD;
    const frontS = routeProjection ? routeProjection.s + FRONT : null;
    const rc = followsRoute ? this.route.controls.find((c) => c.sRoute + 12 >= frontS && c.sRoute - frontS <= 80) : null;
    const edge = rc ? this.map.edges.get(rc.edge) : road.edge;
    const control = rc ? rc.control : edge?.control;
    if (control && (rc || road.lane)) {
      // how far the front bumper is past the line: along the route when there is one, exactly as the
      // sensors measure it (a lane polyline's length differs from the centerline's on a bend), else
      // along the lane
      const past = rc ? frontS - rc.sRoute : road.s + FRONT - control.s_line;
      const key = rc ? `${rc.edge}:${control.id}` : `${edge.id}`;
      const crossed = past >= 0;
      if (this.lastRoad && this.lastRoad.edgeId === key && !this.lastRoad.crossed && crossed) {
        if (control.type === "signal") {
          const state = this.phase(control.id)[control.group];
          if (state === "red") { this.violations.red_lights_run++; this.events.push({ type: "red_light" }); }
        } else if (control.type === "stop" && !this.egoStop.completed) {
          this.violations.stop_signs_run++;
          this.events.push({ type: "stop_sign" });
        } else if (control.type === "yield" && ringBusy(this.map.roundabouts.get(control.roundabout), this.map.nodes.get(edge.to), this.npcs)) {
          this.violations.failed_to_yield++;
          this.events.push({ type: "failed_to_yield", to: "roundabout traffic" });
        }
      }
      this.lastRoad = { edgeId: key, crossed };
      const bumperToLine = -past;
      this.egoStop.update(control, bumperToLine, this.ego.v, dt);
    } else {
      this.lastRoad = edge ? { edgeId: edge.id, crossed: false } : null;
      this.egoStop.update(null, 0, 0, dt);
    }
  }
}

// The ego's front bumper swept across a crosswalk this tick while a pedestrian on it was within a
// lane's width of the car's line: a failure to yield (counted once per pedestrian and crossing).
World.prototype.auditCrosswalks = function () {
  const f = this.ego.front;
  const prev = this._lastFront;
  this._lastFront = f;
  if (!prev || this.ego.v < 0.3) return;
  for (const ped of this.crowd.list) {
    const c = ped.crossing;
    // someone crossing mid-block must yield to traffic: hitting them is a collision, not this
    if (!c || c.jaywalk || ped.yieldCounted === c) continue;
    const hit = segIntersect(prev, f, c.from, c.to);
    if (!hit) continue;
    const len = Math.hypot(c.to[0] - c.from[0], c.to[1] - c.from[1]);
    const along = ((ped.x - c.from[0]) * (c.to[0] - c.from[0]) + (ped.y - c.from[1]) * (c.to[1] - c.from[1])) / len;
    if (Math.abs(hit.u * len - along) < 3.0) {
      ped.yieldCounted = c;
      this.violations.failed_to_yield++;
      this.events.push({ type: "failed_to_yield", to: "pedestrian", with: ped.id });
    }
  }
};

function segIntersect(p, q, a, b) {
  const r = [q[0] - p[0], q[1] - p[1]], s = [b[0] - a[0], b[1] - a[1]];
  const den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-9) return null;
  const w = [a[0] - p[0], a[1] - p[1]];
  const t = (w[0] * s[1] - w[1] * s[0]) / den, u = (w[0] * r[1] - w[1] * r[0]) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? { t, u } : null;
}

export function wrap(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a <= -Math.PI) a += 2 * Math.PI;
  return a;
}

function lanePoint(lane, s) {
  const cum = lane.cum, pts = lane.pts;
  let i = 0;
  while (i < cum.length - 2 && cum[i + 1] <= s) i++;
  const seg = cum[i + 1] - cum[i];
  const t = seg > 0 ? (s - cum[i]) / seg : 0;
  return {
    pointAt: [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t],
    headingAt: Math.atan2(pts[i + 1][1] - pts[i][1], pts[i + 1][0] - pts[i][0]),
  };
}
