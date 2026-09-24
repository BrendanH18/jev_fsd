// Per-drive measurements for the benchmark: safety (violations, closest gap, time to collision),
// comfort (acceleration, jerk, lateral acceleration), lane keeping, legality, and progress.
// Kinematics are sampled every 0.1 s so the numbers describe the car, not integration noise.

const SAMPLE_S = 0.1;
const HARD_BRAKE = -3.5;     // m/s^2, sustained for 0.2 s counts as a hard brake
const SPEEDING = 1.1;        // over 110% of the limit counts as speeding

export class DriveMetrics {
  constructor(routeLength) {
    this.routeLength = routeLength;
    this.t = 0; this.distance = 0;
    this.acc = 0; this.lastV = null; this.lastA = null;
    this.maxAccel = 0; this.maxDecel = 0; this.jerkSq = 0; this.jerkN = 0; this.maxJerk = 0;
    this.maxLatAccel = 0; this.hardBrakes = 0; this.hardFor = 0;
    this.latSq = 0; this.latN = 0; this.maxLat = 0;
    this.minGap = Infinity; this.minTtc = Infinity; this.minHeadway = Infinity;
    this.speeding = 0; this.stopped = 0; this.maxProgress = 0;
    this.latencies = [];
  }

  // Once per physics step, after the world moved.
  record(world, snap, road, dt) {
    const v = world.ego.v;
    this.t += dt;
    this.distance += Math.abs(v) * dt;
    if (Math.abs(v) < 0.3) this.stopped += dt;
    if (road && v > road.limit * SPEEDING) this.speeding += dt;
    const lat = Math.abs(world.ego.latAccel || 0);
    this.maxLatAccel = Math.max(this.maxLatAccel, lat);
    if (snap && snap.routeProj) {
      this.maxProgress = Math.max(this.maxProgress, snap.routeProj.s);
      if (snap.onRoute) {
        const l = Math.abs(snap.routeProj.lateral);
        this.latSq += l * l; this.latN++; this.maxLat = Math.max(this.maxLat, l);
      }
    }
    // a non-positive gap is a car alongside in the detection corridor, not one ahead (a real
    // overlap is counted as a collision)
    if (snap && snap.following && v > 0.5 && snap.following.gap_m > 0) {
      const f = snap.following;
      const gap = f.gap_m;
      this.minGap = Math.min(this.minGap, gap);
      if (f.closing_mps > 0.3) this.minTtc = Math.min(this.minTtc, gap / f.closing_mps);
      if (v > 2) this.minHeadway = Math.min(this.minHeadway, gap / v);
    }
    this.acc += dt;
    if (this.acc + 1e-9 < SAMPLE_S) return;
    const h = this.acc;
    this.acc = 0;
    if (this.lastV !== null) {
      const a = (v - this.lastV) / h;
      this.maxAccel = Math.max(this.maxAccel, a);
      this.maxDecel = Math.min(this.maxDecel, a);
      if (a < HARD_BRAKE) { this.hardFor += h; if (this.hardFor >= 0.2 && this.hardFor - h < 0.2) this.hardBrakes++; } else this.hardFor = 0;
      if (this.lastA !== null) {
        const j = (a - this.lastA) / h;
        this.jerkSq += j * j; this.jerkN++; this.maxJerk = Math.max(this.maxJerk, Math.abs(j));
      }
      this.lastA = a;
    }
    this.lastV = v;
  }

  summary(world, autopilot, arrived) {
    const v = world.violations;
    const r = (x, d = 1) => (Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : null);
    const lat = [...this.latencies].sort((a, b) => a - b);
    const out = {
      arrived,
      time_s: r(this.t),
      distance_m: r(this.distance, 0),
      progress: r(Math.min(1, this.maxProgress / Math.max(1, this.routeLength)), 3),
      avg_kmh: r((this.distance / Math.max(1e-6, this.t)) * 3.6),
      collisions: v.collisions,
      at_fault: v.collisions_at_fault,
      red_lights: v.red_lights_run,
      stop_signs: v.stop_signs_run,
      off_road_s: r(v.off_road_s),
      safety_brakes: v.safety_brakes,
      deadlocks: v.deadlock_overrides,
      fallbacks: v.fallbacks,
      min_gap_m: r(this.minGap),
      min_ttc_s: r(this.minTtc),
      min_headway_s: r(this.minHeadway, 2),
      max_accel: r(this.maxAccel, 2),
      max_decel: r(this.maxDecel, 2),
      hard_brakes: this.hardBrakes,
      rms_jerk: r(Math.sqrt(this.jerkSq / Math.max(1, this.jerkN)), 2),
      max_jerk: r(this.maxJerk, 1),
      max_lat_accel: r(this.maxLatAccel, 2),
      lane_rms_m: r(Math.sqrt(this.latSq / Math.max(1, this.latN)), 2),
      lane_max_m: r(this.maxLat, 2),
      speeding_s: r(this.speeding),
      stopped_s: r(this.stopped),
      decisions: autopilot.totals.decisions,
      calls: autopilot.totals.calls,
      tokens: autopilot.totals.tokens,
      cost_usd: Math.round(autopilot.totals.cost * 1e6) / 1e6,
      latency_p50_ms: lat.length ? Math.round(lat[Math.floor(lat.length / 2)]) : null,
      latency_p95_ms: lat.length ? Math.round(lat[Math.min(lat.length - 1, Math.floor(lat.length * 0.95))]) : null,
    };
    out.failures = failures(out);
    out.pass = out.failures.length === 0;
    return out;
  }
}

// What makes a drive fail. Comfort metrics are reported, not failed on.
export function failures(m) {
  const f = [];
  if (!m.arrived) f.push(m.deadlocks ? "stuck" : "timeout");
  if (m.collisions) f.push("collision");
  if (m.red_lights) f.push("red light");
  if (m.stop_signs) f.push("stop sign");
  if (m.off_road_s >= 1) f.push("off road");
  return f;
}

export function aggregate(results) {
  const n = results.length || 1;
  const sum = (k) => results.reduce((a, r) => a + (r[k] || 0), 0);
  const mean = (k) => {
    const xs = results.map((r) => r[k]).filter((x) => x !== null && Number.isFinite(x));
    return xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 : null;
  };
  const min = (k) => {
    const xs = results.map((r) => r[k]).filter((x) => x !== null && Number.isFinite(x));
    return xs.length ? Math.min(...xs) : null;
  };
  const km = sum("distance_m") / 1000;
  return {
    scenarios: results.length,
    pass_rate: Math.round((results.filter((r) => r.pass).length / n) * 1000) / 1000,
    arrived_rate: Math.round((results.filter((r) => r.arrived).length / n) * 1000) / 1000,
    km: Math.round(km * 100) / 100,
    collisions: sum("collisions"), at_fault: sum("at_fault"), red_lights: sum("red_lights"), stop_signs: sum("stop_signs"),
    off_road_s: Math.round(sum("off_road_s") * 10) / 10,
    safety_brakes: sum("safety_brakes"), deadlocks: sum("deadlocks"), fallbacks: sum("fallbacks"),
    violations_per_km: km > 0 ? Math.round(((sum("collisions") + sum("red_lights") + sum("stop_signs")) / km) * 100) / 100 : null,
    avg_kmh: mean("avg_kmh"),
    min_gap_m: min("min_gap_m"), min_ttc_s: min("min_ttc_s"),
    hard_brakes: sum("hard_brakes"), rms_jerk: mean("rms_jerk"), max_lat_accel: mean("max_lat_accel"),
    lane_rms_m: mean("lane_rms_m"), speeding_s: Math.round(sum("speeding_s") * 10) / 10,
    decisions: sum("decisions"), calls: sum("calls"), tokens: sum("tokens"),
    cost_usd: Math.round(sum("cost_usd") * 1e6) / 1e6,
  };
}
