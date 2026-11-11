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
    this.latSq = 0; this.latN = 0; this.maxLat = 0; this.laneChanges = 0; this.lastShift = null;
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
      // lane keeping is measured from the lane centre the car is tracking, which moves during a change
      const shift = snap.lane && snap.lane.from_delta !== null ? snap.lane.shift : null;
      if (shift && shift !== this.lastShift) this.laneChanges++;
      this.lastShift = shift;
      if (snap.onRoute) {
        const l = Math.abs(snap.lane ? snap.lane.lateral : snap.routeProj.lateral);
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
      ...(world.amberLightsSeen ? { amber_lights_run: v.amber_lights_run || 0 } : {}),
      stop_signs: v.stop_signs_run,
      failed_to_yield: v.failed_to_yield || 0,
      // (only for a drive a snow plow worked in: sim/snow-plow.js)
      ...(world.plowsSeen ? { plow_right_passes: v.plow_right_passes || 0 } : {}),
      // (only for a drive a lane closure stood in: sim/lane-closure.js)
      ...(world.closuresSeen ? { merge_cut_ins: v.merge_cut_ins || 0 } : {}),
      // (only for a drive in which traffic passes cyclists: sim/cyclist-pass.js)
      ...(world.passCyclists ? { close_passes: v.close_passes || 0 } : {}),
      // (only for a drive that crossed a speed hump with calming on: sim/traffic-calming.js)
      ...(world.busLanesSeen ? { bus_lane_driving: v.bus_lane_driving || 0 } : {}),
      ...(world.highBeamsSeen ? { glare_seconds: r(v.glare_seconds || 0, 2) } : {}),
      // (only for a drive in which a low sun dazzled the car: sim/sun-glare.js)
      ...(world.sunGlareSeen ? { glare_speeding_seconds: r(v.glare_speeding_seconds || 0, 2) } : {}),
      ...(world.pxoSeen ? { pxo_early_goes: v.pxo_early_goes || 0 } : {}),
      ...(world.restrictionsSeen ? { illegal_turns: v.illegal_turns || 0 } : {}),
      ...(world.calmingSeen ? { hump_hits: v.hump_hits || 0 } : {}),
      // (only for a drive a garbage truck stopped to collect in: sim/collection-truck.js)
      ...(world.collectionSeen ? { crew_close_passes: v.crew_close_passes || 0 } : {}),
      // (only for a drive a school crossing guard held up the STOP sign in: sim/crossing-guard.js)
      ...(world.guardsSeen ? { guard_violations: v.guard_violations || 0 } : {}),
      // (only for a drive a contraflow cyclist rode near the car in: sim/contraflow.js)
      ...(world.contraflowSeen ? { contraflow_conflicts: v.contraflow_conflicts || 0 } : {}),
      // (only for a drive a red-light runner committed near the car in: sim/red-light-runner.js)
      ...(world.redRunnersSeen ? { fresh_green_conflicts: v.fresh_green_conflicts || 0 } : {}),
      // (only for a drive a car backed out of a driveway near the car in: sim/driveway-reversers.js)
      ...(world.drivewaysSeen ? { reversing_conflicts: v.reversing_conflicts || 0 } : {}),
      // (only for a drive in which the car came near a pothole: sim/potholes.js)
      ...(world.potholesSeen ? { pothole_hits: v.pothole_hits || 0 } : {}),
      // (only for a drive in which a ball rolled into the street near the car: sim/ball-chase.js)
      ...(world.ballsSeen ? { ball_warnings_ignored: v.ball_warnings_ignored || 0 } : {}),
      // (only for a drive a gaggle of Canada geese crossed near the car in: sim/geese.js)
      ...(world.geeseSeen ? { wildlife_conflicts: v.wildlife_conflicts || 0 } : {}),
      // (only for a drive a tailgater followed the car in: sim/tailgaters.js)
      ...(world.tailgatersSeen ? { brake_checks: v.brake_checks || 0 } : {}),
      // (only for a drive in which the car came near black ice: sim/black-ice.js)
      ...(world.iceSeen ? { ice_overspeed: v.ice_overspeed || 0 } : {}),
      // (only for a drive in which the car came up to a stretch snowbanks narrow to one car: sim/snowbanks.js)
      ...(world.snowbanksSeen ? { snowbank_conflicts: v.snowbank_conflicts || 0 } : {}),
      // (only for a drive in which the car came up to a puddle with someone near it: sim/puddles.js)
      ...(world.puddlesSeen ? { pedestrians_splashed: v.pedestrians_splashed || 0 } : {}),
      // (only for a drive in which a car signalled to parallel park ahead of the car: sim/parkers.js)
      ...(world.parkersSeen ? { parking_conflicts: v.parking_conflicts || 0 } : {}),
      // (only for a drive in which the car came up to a block closed for an event: sim/road-closures.js)
      ...(world.roadClosuresSeen ? { closure_entries: v.closure_entries || 0 } : {}),
      // (only for a drive in which the car came up to a junction a police officer directed: sim/traffic-officer.js)
      ...(world.officersSeen ? { officer_violations: v.officer_violations || 0 } : {}),
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
      lane_changes: this.laneChanges,
      speeding_s: r(this.speeding),
      stopped_s: r(this.stopped),
      decisions: autopilot.totals.decisions,
      calls: autopilot.totals.calls,
      tokens: autopilot.totals.tokens,
      cost_usd: Math.round(autopilot.totals.cost * 1e6) / 1e6,
      latency_p50_ms: lat.length ? Math.round(lat[Math.floor(lat.length / 2)]) : null,
      latency_p95_ms: lat.length ? Math.round(lat[Math.min(lat.length - 1, Math.floor(lat.length * 0.95))]) : null,
      // (who made the decisions, for every driver but Rules, whose results stay as they were)
      ...decidedBy(autopilot),
    };
    out.failures = failures(out);
    out.pass = out.failures.length === 0;
    return out;
  }
}

// What makes a drive fail. Comfort metrics are reported, not failed on.
export function failures(m) {
  const f = [];
  if (m.simulation_error) f.push("simulation error");
  else if (!m.arrived) f.push(m.deadlocks ? "stuck" : "timeout");
  if (m.collisions) f.push("collision");
  if (m.red_lights) f.push("red light");
  if (m.amber_lights_run) f.push("failed to stop safely for amber");
  if (m.stop_signs) f.push("stop sign");
  if (m.failed_to_yield) f.push("failed to yield");
  if (m.off_road_s >= 1) f.push("off road");
  if (m.plow_right_passes) f.push("passed plow on the right");
  if (m.merge_cut_ins) f.push("merged out of turn");
  if (m.close_passes) f.push("passed a cyclist too close");
  if (m.bus_lane_driving > 1) f.push("drove in a reserved bus lane");
  if (m.glare_seconds > 0.8) f.push("failed to dip high beams");
  if (m.glare_speeding_seconds > 1) f.push("too fast for sun glare");
  if (m.illegal_turns) f.push("made a prohibited turn");
  if (m.hump_hits) f.push("took a speed hump too fast");
  if (m.pxo_early_goes) f.push("left a pedestrian crossover before the far curb");
  if (m.crew_close_passes) f.push("passed a garbage crew worker too close");
  if (m.guard_violations) f.push("drove past a crossing guard's stop sign");
  if (m.contraflow_conflicts) f.push("cut off or squeezed a contraflow cyclist");
  if (m.fresh_green_conflicts) f.push("entered on green ahead of a car running the red");
  if (m.reversing_conflicts) f.push("squeezed past or failed to stop for a car backing out");
  if (m.pothole_hits) f.push("hit a pothole too fast");
  if (m.ball_warnings_ignored) f.push("ignored a ball rolling into the street");
  if (m.wildlife_conflicts) f.push("drove into or too close to geese crossing the road");
  if (m.brake_checks) f.push("braked hard with a tailgater close behind");
  if (m.ice_overspeed) f.push("crossed black ice too fast, or braked or steered hard on it");
  if (m.snowbank_conflicts) f.push("entered a stretch narrowed by snowbanks out of turn");
  if (m.pedestrians_splashed) f.push("splashed a pedestrian from a puddle");
  if (m.parking_conflicts) f.push("blocked or went round a car parallel parking");
  if (m.closure_entries) f.push("drove onto a closed road");
  if (m.officer_violations) f.push("went on when a police officer signalled stop");
  // (a drive that parks at the destination, sim/parallel-park.js: arrived, but not parked within 30 cm
  // of the kerb)
  if (m.arrived && m.parked === false) f.push("not parked");
  return f;
}

// Who made a drive's decisions (Autopilot.decidedBy), for any driver but Rules: the counts, and the
// shares of all decisions that the driver made itself, that were answered locally with no call, and
// that fell back to Rules. `partial_decisions` are model decisions that left a route or headlight
// question to the default. A Rules drive, or a stand-in autopilot without a driver, adds nothing.
export const DECIDED_BY = ["model_decisions", "partial_decisions", "local_decisions", "fallback_decisions"];
export function decidedBy(autopilot) {
  if (!autopilot?.decidedBy || !autopilot.brainName || autopilot.brainName === "rules") return {};
  return decidedByCounts(autopilot.decidedBy);
}
// The same fields from the autopilot's counts `by`, less those it had at `since` (the app's drive
// report counts from the start of the drive: main.js).
export function decidedByCounts(by, since = {}) {
  const d = (k) => by[k] - (since[k] || 0);
  return withShares({ model_decisions: d("model"), partial_decisions: d("partial"), local_decisions: d("local"), fallback_decisions: d("fallback") });
}
function withShares(c) {
  const n = c.model_decisions + c.local_decisions + c.fallback_decisions;
  const share = (k) => (n ? Math.round((c[k] / n) * 1000) / 1000 : null);
  return { ...c, model_share: share("model_decisions"), local_share: share("local_decisions"), fallback_share: share("fallback_decisions") };
}
// The counts and shares over the results that report who decided: none for Rules, so its summaries
// stay as they were.
export function decidedByTotals(results) {
  return results.some((r) => r.model_decisions !== undefined)
    ? withShares(Object.fromEntries(DECIDED_BY.map((k) => [k, results.reduce((a, r) => a + (r[k] || 0), 0)]))) : {};
}
// "62% model · 30% local · 8% fallback" for a result or summary with the shares, else null.
export function decidedByText(r) {
  if (!r || r.model_share == null) return null;
  const pct = (x) => `${Math.round(x * 100)}%`;
  return `${pct(r.model_share)} model${r.partial_decisions ? ` (${r.partial_decisions} partial)` : ""} · ${pct(r.local_share)} local · ${pct(r.fallback_share)} fallback`;
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
    failed_to_yield: sum("failed_to_yield"),
    off_road_s: Math.round(sum("off_road_s") * 10) / 10,
    safety_brakes: sum("safety_brakes"), deadlocks: sum("deadlocks"), fallbacks: sum("fallbacks"),
    violations_per_km: km > 0 ? Math.round(((sum("collisions") + sum("red_lights") + sum("stop_signs") + sum("failed_to_yield")) / km) * 100) / 100 : null,
    avg_kmh: mean("avg_kmh"),
    min_gap_m: min("min_gap_m"), min_ttc_s: min("min_ttc_s"),
    hard_brakes: sum("hard_brakes"), rms_jerk: mean("rms_jerk"), max_lat_accel: mean("max_lat_accel"),
    lane_rms_m: mean("lane_rms_m"), lane_changes: sum("lane_changes"), speeding_s: Math.round(sum("speeding_s") * 10) / 10,
    decisions: sum("decisions"), calls: sum("calls"), tokens: sum("tokens"),
    cost_usd: Math.round(sum("cost_usd") * 1e6) / 1e6,
    ...decidedByTotals(results),
  };
}
