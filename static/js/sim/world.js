// The simulation world: map, ego car, traffic, signals, time, and honest counters.

import { Vehicle, CAR } from "./vehicle.js";
import { phaseOf, StopMemory } from "./signals.js";
import { obbOverlap } from "./collision.js";

export class World {
  constructor(map, { seed = 1 } = {}) {
    this.map = map;
    this.seed = seed;
    this.t = 0;
    this.tick = 0;
    this.ego = new Vehicle();
    this.npcs = [];
    this.route = null;
    this.destination = null;
    this.paused = false;
    this.egoStop = new StopMemory();
    this.violations = { collisions: 0, red_lights_run: 0, stop_signs_run: 0, off_road_s: 0, safety_brakes: 0, fallbacks: 0, deadlock_overrides: 0 };
    this.events = [];  // transient per-step events for the UI
    this.lastRoad = null;
    this.spawnEgo();
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
    this.ego.x = pointAt[0]; this.ego.y = pointAt[1]; this.ego.psi = headingAt; this.ego.v = 0; this.ego.delta = 0;
    this.egoStop.reset();
  }

  resetToLane() {
    const near = this.map.nearestLane(this.ego.x, this.ego.y, this.ego.psi, 80);
    if (near) {
      this.ego.x = near.point[0]; this.ego.y = near.point[1]; this.ego.psi = near.heading; this.ego.v = 0; this.ego.delta = 0;
    }
    this.events.push({ type: "reset" });
  }

  phase(intersectionId) { return phaseOf(this.map.intersections.get(intersectionId), this.t); }

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
    if (input.throttle) accel = 2.5;
    if (input.brake) accel = this.ego.v > 0.2 ? -6 : -1.5;  // brake, then gently reverse
    if (input.hardBrake) accel = -8;
    let steer = 0;
    if (input.left) steer = CAR.maxSteer;
    if (input.right) steer = -CAR.maxSteer;
    if (input.brake && this.ego.v <= 0.2 && !input.hardBrake) {
      this.ego.step(dt, { steer, accel: 0 });
      this.ego.v = Math.max(-CAR.maxReverse, this.ego.v - 1.5 * dt);
      return;
    }
    this.ego.step(dt, { steer, accel });
  }

  // Called every physics tick after the ego (and NPCs) moved. Collisions and violations.
  audit(dt, road) {
    this.events.length = 0;
    const egoBox = this.ego.obb();
    for (const n of this.npcs) {
      if (n.frozen > 0) continue;
      if (obbOverlap(egoBox, n.obb())) {
        this.violations.collisions++;
        this.ego.v = 0;
        n.frozen = 3;
        this.events.push({ type: "collision", with: n.id });
      }
    }
    if (!road.on_road) this.violations.off_road_s += dt;
    // stop-line crossings on the edge the ego is on
    const edge = road.edge;
    if (edge && edge.control && road.lane) {
      const front = road.s + (CAR.length - CAR.rearOverhang);
      const key = `${edge.id}`;
      const crossed = front >= edge.control.s_line;
      if (this.lastRoad && this.lastRoad.edgeId === key && !this.lastRoad.crossed && crossed) {
        if (edge.control.type === "signal") {
          const state = this.phase(edge.control.id)[edge.control.group];
          if (state === "red") { this.violations.red_lights_run++; this.events.push({ type: "red_light" }); }
        } else if (edge.control.type === "stop" && !this.egoStop.completed) {
          this.violations.stop_signs_run++;
          this.events.push({ type: "stop_sign" });
        }
      }
      this.lastRoad = { edgeId: key, crossed };
      const bumperToLine = edge.control.s_line - front;
      this.egoStop.update(edge.control, bumperToLine, this.ego.v, dt);
    } else {
      this.lastRoad = edge ? { edgeId: edge.id, crossed: false } : null;
      this.egoStop.update(null, 0, 0, dt);
    }
  }
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
