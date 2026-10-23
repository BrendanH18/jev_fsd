// The simulation world: map, ego car, traffic, signals, time, and honest counters.

import { Vehicle, CAR } from "./vehicle.js";
import { headingAt } from "../map/mapdata.js";
import { phaseOf, StopMemory } from "./signals.js";
import { obbOverlap } from "./collision.js";
import { ringBusy } from "./roundabout.js";
import { ParkedCars, PARKED_DENSITY } from "./parking.js";
import { Crowd, PEDESTRIANS } from "./pedestrians.js";
import { Visibility } from "./visibility.js";
import { setWeather } from "./weather.js";
import { StaticObstacles, poseOf } from "./static-obstacles.js";
import { AllWayStops } from "./all-way.js";

const AUDIT_ROUTE_CORRIDOR_M = 4;
const AUDIT_ROUTE_HEADING_RAD = Math.PI / 3;
// Past a signal's line, the car fails to yield when its front bumper enters the path of an
// oncoming vehicle (seen or not) due at the junction's centre within this many seconds. The path
// is the one the vehicle is actually following, so only a left turn or a U-turn takes the car into
// it and the check needs no route: a free drive is audited too. It runs until the front is this
// far from the junction's centre.
const AUDIT_ONCOMING_S = 2.0;
const AUDIT_JUNCTION_M = 30;
const AUDIT_PATH_M = 50;
const AUDIT_CORNER_M = 8;   // a turn's rounded corner starts about this far before the node it turns at   // how far along an oncoming vehicle's path the car's front is looked for
// As in sensing (brain/sensors.js): an oncoming vehicle heads within 60 deg of straight at the car's
// approach and comes toward the junction, or is within 12 m of its centre turning (up to 105 deg),
// in which case it is already there.
const AUDIT_BOX_M = 12;
// Crossing a red light's line after a full stop on a map that allows right turns on red is legal
// if the car turns right, judged from the street it is on, as routes judge their turns
// (MapData.classifyTurn from the approach): once its front is this far past the junction's centre
// on another street, or on leaving the junction. A lane change or a swerve on the way straight
// through does not count. A right turn on
// red fails to yield, as above, when the car's front enters the path of a vehicle coming from its
// left (heading within 60 deg of the way the car turns) due at the junction within 2 s, or that
// would reach the car within 2 s along the street both are in.
const AUDIT_RTOR_OUT_M = 15;

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
    this.allWay = new AllWayStops(map);
    this.allWayCounted = null;   // the all-way stop it went out of turn at (counted once a visit)
    this.violations = { collisions: 0, collisions_at_fault: 0, red_lights_run: 0, stop_signs_run: 0, failed_to_yield: 0, off_road_s: 0, safety_brakes: 0, fallbacks: 0, deadlock_overrides: 0 };
    this.events = [];  // transient per-step events for the UI
    this.lastRoad = null;
    this.lastSignal = null;
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
    this.allWay.forget(this.ego);
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
    this.lastSignal = null;
    this.allWayCounted = null;
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
          const inter = this.map.intersections.get(control.id);
          // after a full stop, where turning right on red is allowed, which way it turns decides
          const pending = state === "red" && this.map.rightOnRed && inter && this.egoStop.controlId === control.id && this.egoStop.completed;
          if (state === "red" && !pending) { this.violations.red_lights_run++; this.events.push({ type: "red_light" }); }
          // the approach's heading and, on a route, the street it turns into (without one, the
          // street the car is heading into is the way it faces)
          if (inter) {
            const exit = rc && rc.sJunction !== null ? this.route.headingAt(Math.min(this.route.length, rc.sJunction + 15)) : null;
            const approach = rc ? this.route.headingAt(rc.sRoute) : this.map.headingIn(edge.id);
            this.lastSignal = { centre: [inter.x, inter.y], nodes: this.map.junctionNodes(inter), approaches: new Set(inter.approaches.map((a) => a.edge)), facing: approach + Math.PI, exit, counted: false,
              ...(pending ? { rightOnRed: { edge: edge.id, approach, exit: exit ?? approach - Math.PI / 2, turned: false } } : {}) };
          }
        } else if (control.type === "stop" && !this.egoStop.completed) {
          this.violations.stop_signs_run++;
          this.events.push({ type: "stop_sign" });
        } else if (control.type === "yield" && ringBusy(this.map.roundabouts.get(control.roundabout), this.map.nodes.get(edge.to), this.npcs)) {
          this.violations.failed_to_yield++;
          this.events.push({ type: "failed_to_yield", to: "roundabout traffic" });
        }
        // A left turn at a stop sign yields to oncoming traffic as at a signal, and is checked the same way.
        const node = control.type === "stop" ? this.map.nodes.get(edge.to) : null;
        if (node) {
          const exit = Number.isFinite(rc?.sJunction) ? this.route.headingAt(Math.min(this.route.length, rc.sJunction + 15)) : null;
          const approach = rc ? this.route.headingAt(rc.sRoute) : this.map.headingIn(edge.id);
          this.lastSignal = { centre: [node.x, node.y], nodes: new Set([edge.to]), approaches: new Set(this.map.inn.get(edge.to) || []), facing: approach + Math.PI, exit, counted: false };
        }
      }
      // (keyed on the stop itself: with or without a route, it is the same line)
      if (this.allWayCounted !== control.id) this.allWayCounted = null;
      this.lastRoad = { edgeId: key, crossed };
      const bumperToLine = -past;
      this.egoStop.update(control, bumperToLine, this.ego.v, dt);
      // Crossing an all-way stop's line, or leaving its queue past the line, without its turn is going
      // out of turn (whether or not the car could see who stopped first), wherever along the line it
      // made its stop; counted once per visit to the line.
      const missed = control.type === "stop" && control.all_way ? this.allWay.note(this.ego, control, edge.id, rc?.turn || this.ego.signal || "straight", bumperToLine, this.ego.v, this) : null;
      if (missed && !this.allWayCounted) {
        this.allWayCounted = control.id;
        this.violations.failed_to_yield++;
        this.events.push({ type: "failed_to_yield", to: "all-way stop", with: missed.id });
      }
    } else {
      this.lastRoad = edge ? { edgeId: edge.id, crossed: false } : null;
      this.allWayCounted = null;
      this.egoStop.update(null, 0, 0, dt);
    }
    this.auditOncoming();
  }

  auditOncoming() {
    const j = this.lastSignal;
    if (!j) return;
    const FRONT = this.ego.spec.length - this.ego.spec.rearOverhang;
    const fx = this.ego.x + Math.cos(this.ego.psi) * FRONT, fy = this.ego.y + Math.sin(this.ego.psi) * FRONT;
    const [jx, jy] = j.centre;
    const rtor = j.rightOnRed;
    if (rtor && !rtor.turned) {
      // crossed on red after a full stop: legal if it has turned right, else it ran the red, judged
      // from the street the car is on. In a lane of a street the way the car faces, one leaving the
      // junction to the right starts a right turn (`via`), which carries on along the streets it
      // leads to; any other street ends it (so does a right turn further on, off a street the car
      // went straight on into). Going on past the centre other than by that right turn runs
      // the red there and then; a right turn (which stays short of the centre) holds only once the
      // car leaves the junction on it, as do a sharp left and a U-turn (which head back behind the
      // centre), so a swerve toward a shallow right-hand exit and back does not count.
      const out = Math.hypot(fx - jx, fy - jy);
      const past = (fx - jx) * Math.cos(rtor.approach) + (fy - jy) * Math.sin(rtor.approach);
      const at = this.map.nearestLane(fx, fy, this.ego.psi, 8), on = at?.lane.edgeRef;
      if (on && on.id !== rtor.edge && on.id !== rtor.via?.id && Math.abs(wrap(at.heading - this.ego.psi)) <= Math.PI / 3) {
        if (this.map.classifyTurn(this.map.turnAngle(rtor.edge, on.id)) === "right" && (j.nodes.has(on.from) || on.from === this.map.edges.get(rtor.edge)?.to)) rtor.via = on;
        else rtor.via = rtor.via && on.from === rtor.via.to ? on : null;
      }
      if ((out > AUDIT_RTOR_OUT_M && past > 0) || out > AUDIT_JUNCTION_M) {
        if (on && on.id === rtor.via?.id) { if (out > AUDIT_JUNCTION_M) rtor.turned = true; }
        else {
          this.violations.red_lights_run++;
          this.events.push({ type: "red_light" });
          j.rightOnRed = null;
        }
      }
    }
    if (Math.hypot(fx - jx, fy - jy) > AUDIT_JUNCTION_M) { this.lastSignal = null; return; }
    if (j.counted) return;
    // as in sensing: traffic better aligned with coming down the street the car turns into is in
    // that street's other lane. Turning right on red, the traffic that counts comes from the left,
    // heading the way the car turns.
    const facing = j.rightOnRed ? j.rightOnRed.exit : j.facing, down = j.rightOnRed ? null : (j.exit ?? this.ego.psi) + Math.PI;
    const due = this.npcs.find((n) => {
      const rel = Math.abs(wrap(n.psi - facing)), path = n.path?.pts ? n.path : null;
      if (n.v < 1 || (down !== null && Math.abs(wrap(n.psi - down)) < rel)) return false;
      // without a route, a vehicle signalling a left turn is taken to be turning (see below)
      if (!path && n.signal === "left" && !j.rightOnRed) return false;
      // turning right on red, one that came the same way as the car is following it, not crossing
      if (j.rightOnRed && path?.edges.some((e) => e.id === j.rightOnRed.edge)) return false;
      const ux = Math.cos(n.psi), uy = Math.sin(n.psi), dx = jx - n.x, dy = jy - n.y, d = Math.hypot(dx, dy);
      const closing = (dx * ux + dy * uy) / Math.max(d, 1e-6), inBox = d < AUDIT_BOX_M;
      // turning right on red, traffic from the left already through the junction, still within
      // 15 m of its centre down the street the car turns into, can still be cut off (the check
      // along its path below)
      const through = j.rightOnRed && path && rel < Math.PI / 6 && closing <= 0 && d < AUDIT_RTOR_OUT_M;
      if (!through && !(rel < Math.PI / 3 && closing > 0) && !(inBox && rel < Math.PI * 7 / 12 && closing > -0.5)) return false;
      if (!inBox && !through && d / n.v >= AUDIT_ONCOMING_S) return false;
      // braking to stop short of the junction (for its own light, say)
      if (!inBox && !through && n.a < -0.5 && n.v * n.v / (-2 * n.a) < d - 6) return false;
      // the car's front is in its path, ahead of it: along the lanes it is following (a street
      // that jogs or bends keeps it in its own lane), else straight on along its heading
      const reach = (this.ego.spec.width + (n.spec || CAR).width) / 2;
      // (measured from where it actually is beside them: changing lanes, pulling out, a cyclist
      // keeping right)
      if (path) {
        const own = nearestOnPath(path, n.x, n.y, path.s - 2, path.s + 2), p = nearestOnPath(path, fx, fy, path.s, path.s + AUDIT_PATH_M);
        const beside = own ? own.lateral : 0;
        if (!p || !(p.s > path.s) || Math.abs(p.lateral - beside) >= reach || p.distance >= reach + Math.abs(beside)) return false;
        // Heading the same way along its path (down the street both turned into, say), the car is
        // ahead of it: that is a cut-off only if it would reach the car within the same 2 s.
        const along = Math.abs(wrap(this.ego.psi - headingAt(path.pts, path.cum, p.s))) < Math.PI / 6;
        if ((along || through) && (p.s - path.s) / n.v >= AUDIT_ONCOMING_S) return false;
        // A vehicle turning its own left at this junction must itself yield, where the car meets it
        // on its turn (known from its route: its indicator goes off mid-turn, and shows a lane change
        // too). Met before it turns, on the way through, it has the right of way.
        if (j.rightOnRed) return true;
        const left = leftTurnAt(this.map, path, j);
        return left === null || p.s < left - AUDIT_CORNER_M;
      }
      const ax = fx - n.x, ay = fy - n.y;
      return ax * ux + ay * uy > 0 && Math.abs(ax * uy - ay * ux) < reach;
    });
    if (due) {
      j.counted = true;
      this.violations.failed_to_yield++;
      this.events.push({ type: "failed_to_yield", to: j.rightOnRed ? "cross traffic" : "oncoming traffic", with: due.id });
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

// The closest point to (x, y) on the stretch of a path between arc lengths s0 and s1 (searching
// only there, so a path that loops back past the same spot later is not mistaken for it): its arc
// length, distance and signed lateral offset (right of travel positive).
function nearestOnPath(path, x, y, s0, s1) {
  const { pts, cum } = path;
  let best = null;
  for (let i = 0; i < pts.length - 1; i++) {
    if (cum[i + 1] < s0 || cum[i] > s1) continue;
    const [ax, ay] = pts[i], dx = pts[i + 1][0] - ax, dy = pts[i + 1][1] - ay, len = Math.hypot(dx, dy);
    if (len < 1e-9) continue;
    const t = Math.max((s0 - cum[i]) / len, 0, Math.min(1, (s1 - cum[i]) / len, ((x - ax) * dx + (y - ay) * dy) / (len * len)));
    const qx = ax + dx * t, qy = ay + dy * t, d = Math.hypot(x - qx, y - qy);
    if (!best || d < best.distance) best = { s: cum[i] + t * len, distance: d, lateral: ((x - qx) * dy - (y - qy) * dx) / len };
  }
  return best;
}

// Where an NPC's planned path turns left (or around) at a signal's junction, as arc length along
// it (the start of the edge it turns onto), or null when it does not. Read from the edge of its path
// that is one of the junction's approaches (it may already be past it, turning; not a street that
// led onto the approach), across the junction's short links, never on to the next junction.
function leftTurnAt(map, path, { approaches, nodes }) {
  const k = path.edges.findIndex((e) => e.sEnd > path.s - 30 && approaches.has(e.id));
  if (k < 0) return null;
  const { turn, at } = map.turnThrough(path.edges.map((e) => e.id), k, nodes);
  return turn === "left" || turn === "uturn" ? path.edges[at].sStart : null;
}
