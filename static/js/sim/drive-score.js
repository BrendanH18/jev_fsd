// Deterministic coaching model, independent of the driver. Deductions accumulate in simulation
// time, so pauses, frame rate and the decision API cannot change the score.
export const SCORE_VERSION = 1;
export const SCORE_WEIGHTS = { safety: 0.4, legality: 0.3, comfort: 0.2, control: 0.1 };
export const SPEED_GRACE_MPS = 5 / 3.6;
const clamp = (n, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
const round = (n, digits = 1) => Math.round(n * 10 ** digits) / 10 ** digits;
const COUNTERS = { collisions: "Collision", red_lights_run: "Red light", stop_signs_run: "Missed stop", failed_to_yield: "Failed to yield" };

export class DriveScore {
  constructor(world, { title = "Free drive", map = "", driver = "manual", route = null } = {}) {
    this.title = title; this.map = map; this.driver = driver; this.route = route;
    this.baseline = { ...world.violations }; this.lastCounters = { ...world.violations };
    this.elapsed = 0; this.distance = 0; this.moving = 0; this.speeding = 0;
    this.closeFollowing = 0; this.danger = 0; this.offRoad = 0; this.wrongWay = 0;
    this.harsh = 0; this.cornering = 0; this.jerk = 0; this.resets = 0;
    this.sample = 0; this.lastV = world.ego.v; this.lastA = null; this.brakingFor = 0;
    this.brakingCounted = false; this.lastGap = Infinity; this.lastTtc = Infinity;
    this.laneHeading = null;
    this.hardBrakes = 0; this.minGap = Infinity; this.maxSpeed = 0; this.progress = 0;
    this.incidents = []; this.coach = "Settle in. Look ahead and leave room.";
    this.finished = null; this.startedAt = new Date().toISOString();
  }

  incident(type, message, extra = {}) {
    if (this.incidents.length < 100) this.incidents.push({ type, message, at_s: round(this.elapsed), at_m: Math.round(this.distance), ...extra });
  }

  reset() { this.resets++; this.incident("reset", "Returned the car to its lane"); this.lastA = null; this.lastV = null; }

  record(world, road, dt) {
    if (this.finished || !Number.isFinite(dt) || dt <= 0 || world.paused) return;
    const ego = world.ego, speed = Math.abs(ego.v);
    this.elapsed += dt; this.distance += speed * dt; this.maxSpeed = Math.max(this.maxSpeed, speed);
    if (speed > 0.5) this.moving += dt;
    const speeding = !!road && speed > road.limit + SPEED_GRACE_MPS;
    const offRoad = road?.on_road === false;
    const headingError = this.laneHeading === null ? road?.heading_error || 0 : ego.psi - this.laneHeading;
    const wrongWay = !!road?.on_road && speed > 2 && Math.cos(headingError) < 0;
    if (speeding) this.speeding += dt;
    if (offRoad) this.offRoad += dt;
    if (wrongWay) this.wrongWay += dt;
    if (Math.abs(ego.latAccel || 0) > 3.0) this.cornering += dt;
    if (this.route) {
      const p = this.route.project(ego.x, ego.y);
      if (p && p.distance < 12) this.progress = Math.max(this.progress, p.s / Math.max(1, this.route.length));
    }
    for (const [key, message] of Object.entries(COUNTERS)) {
      const count = Math.max(0, (world.violations[key] || 0) - (this.lastCounters[key] || 0));
      if (count) this.incident(key, message, { count });
    }
    this.lastCounters = { ...world.violations };
    this.coach = offRoad ? "Ease off and return to the road."
      : wrongWay ? "Check your direction of travel."
      : speeding ? "Ease off. You’re above the speed limit."
      : Math.abs(ego.latAccel || 0) > 3 ? "Slow down before the bend."
      : this.lastTtc < 1.5 ? "Brake gently now. The gap is closing."
      : this.lastGap / Math.max(speed, 0.1) < 1.2 ? "Leave more space to the vehicle ahead."
      : "Look ahead. Keep your inputs smooth.";

    this.sample += dt;
    if (this.sample + 1e-9 < 0.1) return;
    const h = this.sample; this.sample = 0;
    // Navigation favours lanes aligned with the car. Evaluate direction from the physically
    // closest lane instead, without penalising ambiguous junction mouths.
    if (world.map?.nearestLane) {
      const nearest = world.map.nearestLane(ego.x, ego.y, null, 12);
      this.laneHeading = nearest && nearest.distance < 2.3 && nearest.s > 6 && nearest.s < nearest.lane.length - 6 ? nearest.heading : null;
    }
    if (this.lastV !== null) {
      const a = (ego.v - this.lastV) / h;
      if (a < -3.5) {
        this.harsh += h; this.brakingFor += h;
        if (this.brakingFor + 1e-9 >= 0.2 && !this.brakingCounted) { this.brakingCounted = true; this.hardBrakes++; this.incident("hard_brake", "Hard braking"); }
      } else { this.brakingFor = 0; this.brakingCounted = false; }
      if (this.lastA !== null && Math.abs((a - this.lastA) / h) > 5) this.jerk += h;
      this.lastA = a;
    }
    this.lastV = ego.v;
    // Use physical gaps, including objects outside the driver's observation. This evaluates the
    // drive, not what the model believed it could see. At most ten local queries per second.
    let gap = Infinity, ttc = Infinity;
    if (speed > 2) for (const other of world.obstaclesNear(ego.x, ego.y, 35)) {
      const [x, y] = other.center || [other.x, other.y];
      const rel = ego.toLocal(x, y);
      if (rel.ahead <= 0 || Math.abs(rel.right) > 1.4 + (other.width || 1.8) / 2) continue;
      const g = rel.ahead - 3.6 - (other.length || 0.6) / 2;
      if (g <= 0) continue; // physical overlaps belong to collision auditing
      gap = Math.min(gap, g);
      const forwardSpeed = (other.v || 0) * Math.cos((other.psi || 0) - ego.psi);
      if (speed - forwardSpeed > 0.5) ttc = Math.min(ttc, g / (speed - forwardSpeed));
    }
    this.minGap = Math.min(this.minGap, gap);
    this.lastGap = gap; this.lastTtc = ttc;
    if (gap / Math.max(speed, 0.1) < 1.2) this.closeFollowing += h;
    if (ttc < 1.5) this.danger += h;
    if (!offRoad && !wrongWay && !speeding) {
      if (ttc < 1.5) this.coach = "Brake gently now. The gap is closing.";
      else if (gap / Math.max(speed, 0.1) < 1.2) this.coach = "Leave more space to the vehicle ahead.";
    }
  }

  snapshot() {
    const delta = (k) => Math.max(0, (this.lastCounters[k] || 0) - (this.baseline[k] || 0));
    const collisions = delta("collisions"), atFault = delta("collisions_at_fault");
    const reds = delta("red_lights_run"), stops = delta("stop_signs_run"), yields = delta("failed_to_yield");
    const categories = {
      safety: Math.round(clamp(100 - collisions * 35 - atFault * 15 - this.danger * 3 - this.closeFollowing * 0.6)),
      legality: Math.round(clamp(100 - reds * 35 - stops * 20 - yields * 25 - this.speeding * 1.2)),
      comfort: Math.round(clamp(100 - this.harsh * 3 - this.cornering * 1.5 - this.jerk * 0.8)),
      control: Math.round(clamp(100 - this.offRoad * 5 - this.wrongWay * 3 - this.resets * 15)),
    };
    let score = Math.round(Object.entries(SCORE_WEIGHTS).reduce((sum, [key, weight]) => sum + categories[key] * weight, 0));
    // A collision or a red-light violation cannot be averaged into an excellent drive.
    if (collisions) score = Math.min(score, 59);
    if (reds || yields) score = Math.min(score, 69);
    const qualified = this.distance >= 100 && this.elapsed >= 10;
    const grade = !qualified ? "—" : score >= 90 ? "A" : score >= 80 ? "B" : score >= 70 ? "C" : score >= 60 ? "D" : "E";
    const tips = [];
    if (collisions) tips.push("Leave more stopping room and anticipate crossing traffic. Collision fault is reported separately.");
    if (reds || stops || yields) tips.push("Slow early for junctions. Stop fully and check crossings before entering.");
    if (this.speeding > 1) tips.push("Watch the speed-limit sign, especially when entering residential streets.");
    if (this.closeFollowing > 1 || this.danger > 0.5) tips.push("Aim for at least a two-second following gap when conditions allow.");
    if (this.harsh + this.jerk + this.cornering > 2) tips.push("Lift off earlier, brake progressively and reduce speed before turning.");
    if (this.offRoad + this.wrongWay > 0.5 || this.resets) tips.push("Keep to your lane and plan turns before reaching the junction.");
    if (!qualified) tips.push("Drive at least 100 m and 10 seconds to receive a grade.");
    if (!tips.length) tips.push("A composed drive. Keep scanning ahead and make room for people crossing.");
    return { model_version: SCORE_VERSION, title: this.title, map: this.map, driver: this.driver,
      started_at: this.startedAt, status: this.finished || "active", score, grade, qualified, categories,
      elapsed_s: round(this.elapsed), distance_m: Math.round(this.distance), moving_s: round(this.moving),
      max_kmh: round(this.maxSpeed * 3.6), progress: round(clamp(this.progress, 0, 1), 3),
      collisions, at_fault: atFault, red_lights: reds, stop_signs: stops, failed_to_yield: yields,
      speeding_s: round(this.speeding), off_road_s: round(this.offRoad), wrong_way_s: round(this.wrongWay),
      close_following_s: round(this.closeFollowing), danger_s: round(this.danger), hard_brakes: this.hardBrakes,
      min_gap_m: Number.isFinite(this.minGap) ? round(this.minGap) : null, resets: this.resets,
      coach: this.coach, tips, incidents: this.incidents.map(i => ({ ...i })) };
  }

  finish(status = "finished") { this.finished ||= status; return this.snapshot(); }
}

export const HISTORY_KEY = "jev-fsd-drives-v1";
export function readHistory(storage = globalThis.localStorage) {
  try {
    const data = JSON.parse(storage.getItem(HISTORY_KEY));
    return Array.isArray(data) ? data.filter(d => d?.model_version === SCORE_VERSION && Number.isFinite(d.score)
      && typeof d.title === "string" && typeof d.map === "string" && Array.isArray(d.tips) && Array.isArray(d.incidents)
      && Object.keys(SCORE_WEIGHTS).every(key => Number.isFinite(d.categories?.[key]))).slice(0, 20) : [];
  }
  catch { return []; }
}
export function saveDrive(report, storage = globalThis.localStorage) {
  const history = [report, ...readHistory(storage)].slice(0, 20);
  try { storage.setItem(HISTORY_KEY, JSON.stringify(history)); return true; } catch { return false; }
}
