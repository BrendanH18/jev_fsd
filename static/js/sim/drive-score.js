// Deterministic coaching model, independent of the driver. Deductions accumulate in simulation
// time, so pauses, frame rate and the decision API cannot change the score.
import { STEP_OUT_M, blindSpot } from "./blind-spot.js";
import { egoPlow } from "./snow-plow.js";
export const SCORE_VERSION = 1;
export const SCORE_WEIGHTS = { safety: 0.4, legality: 0.3, comfort: 0.2, control: 0.1 };
export const SPEED_GRACE_MPS = 5 / 3.6;
const clamp = (n, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
const round = (n, digits = 1) => Math.round(n * 10 ** digits) / 10 ** digits;
// Closer than the stay-back distance less this, moving, behind a snow plow the car must stay back of,
// is following it too closely (sim/snow-plow.js).
const PLOW_CLOSE_SLACK_M = 10;
const COUNTERS = { collisions: "Collision", red_lights_run: "Red light", stop_signs_run: "Missed stop", failed_to_yield: "Failed to yield" };

export class DriveScore {
  constructor(world, { title = "Free drive", map = "", driver = "manual", route = null } = {}) {
    this.title = title; this.map = map; this.driver = driver; this.route = route;
    this.baseline = { ...world.violations }; this.lastCounters = { ...world.violations };
    this.elapsed = 0; this.distance = 0; this.moving = 0; this.speeding = 0;
    // (of which in a school or playground zone in effect, and the zone it was last counted in)
    this.zoneSpeeding = 0; this.zoneCounted = null;
    // (passing a vehicle stopped at the roadside with its lights flashing: too fast, and without
    // moving over, and the vehicles each was counted for)
    this.roadsideSpeeding = 0; this.noMoveOver = 0; this.roadsideCounted = new Set(); this.moveOverCounted = new Set();
    // (the vehicles the car had room to move over for, on the way up to them)
    this.moveOverRoom = new Set();
    // (standing on the tracks at a level crossing, sim/rail.js: how often, and where it last was)
    this.onTracks = 0; this.tracksCounted = null;
    // (standing in a signal's junction with no room past it, sim/junction-box.js: how often, and where)
    this.blockedJunctions = 0; this.boxCounted = null;
    // (through a work zone, sim/work-zone.js: too fast, the zones that was counted for, and going past
    // a flagger's STOP paddle, which the audit counts as a missed stop)
    this.workZoneSpeeding = 0; this.workZoneCounted = new Set(); this.flaggerStops = 0;
    // (a missed stop, or going out of turn, at a signal whose lights are out: sim/outage.js)
    this.darkSignals = 0;
    // (going round a double-parked van into the way of oncoming traffic, which the audit counts as a
    // failure to yield: sim/double-parked.js)
    this.vanCutoffs = 0;
    // (parking at the destination, sim/parallel-park.js: how it ended, and the kerb strikes on the way in
    // or out; reported only for a drive with parking)
    this.parking = null; this.kerbStrikes = 0;
    // (with hidden hazards on, sim/hidden-hazards.js: beside cars parked at the kerb that hide the
    // sidewalk, faster than the car could stop from for someone stepping out, and the streets (each
    // side of each) that was counted for; reported only for a drive with hidden hazards)
    this.hazards = !!world.hazards; this.blindSpeeding = 0; this.blindCounted = new Set();
    // (and with hidden traffic, sim/hidden-traffic.js: failures to yield to a vehicle the car could
    // not see as it pulled out, hidden behind another)
    this.hiddenCutoffs = 0;
    // (with a snow plow at work, sim/snow-plow.js: time following one too closely, passing one on the
    // right, and moving back in front of one too soon after passing it on the left; reported only for
    // a drive a plow worked in)
    this.plows = false; this.plowClose = 0; this.plowCounted = null; this.plowRightPasses = 0; this.plowCutIns = 0;
    // (with a lane closure, sim/lane-closure.js: merging out of turn, not letting someone in, and merging
    // early; reported only for a drive a closure stood in)
    this.closures = false; this.mergeCutIns = 0; this.mergeTurnsTaken = 0; this.earlyMerges = 0;
    // (with traffic passing cyclists, sim/cyclist-pass.js: passing one closer than the minimum passing
    // distance, and into the way of oncoming traffic; reported only for such a drive)
    this.cyclists = !!world.passCyclists; this.closePasses = 0; this.cyclistCutoffs = 0;
    this.closeFollowing = 0; this.danger = 0; this.offRoad = 0; this.wrongWay = 0;
    this.harsh = 0; this.cornering = 0; this.jerk = 0; this.resets = 0;
    this.sample = 0; this.lastV = world.ego.v; this.lastA = null; this.brakingFor = 0;
    this.brakingCounted = false; this.lastGap = Infinity; this.lastTtc = Infinity;
    this.laneHeading = null;
    this.hardBrakes = 0; this.minGap = Infinity; this.maxSpeed = 0; this.progress = 0;
    this.incidents = []; this.coach = "Settle in. Look ahead and leave room.";
    this.finished = null; this.startedAt = new Date().toISOString();
  }

  // The autopilot's arrival, with parking at the destination (Autopilot.step's "arrived" event):
  // parked, and how well, or stopped in its lane.
  noteArrival(ev) {
    if (this.finished || ev?.parked === undefined) return;
    this.parking = ev.parked ? { result: "parked", kerb_m: ev.kerb_m, angle_deg: ev.angle_deg, within_kerb: !!ev.within_kerb, legs: ev.legs }
      : { result: ev.stuck ? "stuck partway in" : "stopped in lane" };
    this.incident("parking", ev.parked ? `Parked, ${Math.round(ev.kerb_m * 100)} cm from the kerb` : ev.stuck ? "Gave up partway into the space" : "No space to park in: stopped in the lane");
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
    // (going round a work zone's closed stretch through the other lane, sim/work-zone.js, is not, and
    // nor is going round a double-parked van through the oncoming lane, sim/double-parked.js)
    // (a lane closure's limit holds the same way, from its merge point: sim/lane-closure.js)
    const zonePass = world.workZones?.passing(road?.limit ?? 11.2) || world.laneClosures?.passing(road?.limit ?? 11.2) || null;
    const wrongWay = !!road?.on_road && speed > 2 && Math.cos(headingError) < 0 && zonePass?.side !== "closed" && !world.doubleParked?.passing() && !(this.cyclists && world.passingCyclist?.());
    if (speeding) this.speeding += dt;
    const zone = road?.zone;
    if (speeding && zone) {
      this.zoneSpeeding += dt;
      if (this.zoneCounted !== zone.id) { this.zoneCounted = zone.id; this.incident("zone_speeding", `Speeding in a ${zone.kind} zone`, { zone: zone.id }); }
    }
    if (!zone) this.zoneCounted = null;
    // slow down and move over (sim/roadside.js): past a vehicle stopped at the roadside with its lights
    // flashing, its speed is the limit; drawing level with it in the lane next to it, where there is
    // another lane going the car's way that was clear at some point on the way up, is not moving over
    const passing = world.roadside?.passing(road?.limit ?? 11.2) || null, name = passing?.name;
    const roadsideFast = !!passing && speed > passing.limit + SPEED_GRACE_MPS;
    if (roadsideFast) {
      this.roadsideSpeeding += dt;
      if (!speeding) this.speeding += dt;
      if (!this.roadsideCounted.has(passing.vehicle.id)) { this.roadsideCounted.add(passing.vehicle.id); this.incident("roadside_speeding", `Passed a stopped ${name} too fast`, { vehicle: passing.vehicle.id }); }
    }
    if (passing?.room && passing.relation.ahead_m > 0) this.moveOverRoom.add(passing.vehicle.id);
    if (passing && passing.relation.adjacent && passing.other_lane && passing.relation.ahead_m <= 0 && speed > 1 && this.moveOverRoom.has(passing.vehicle.id) && !this.moveOverCounted.has(passing.vehicle.id)) {
      this.moveOverCounted.add(passing.vehicle.id); this.noMoveOver++;
      this.incident("no_move_over", `Didn’t move over for a stopped ${name}`, { vehicle: passing.vehicle.id });
    }
    // never stop on the tracks at a level crossing (sim/rail.js): standing on them for a second is
    // counted once a visit
    const tracks = world.onTracks;
    if (tracks && tracks.still > 1 && this.tracksCounted !== `${tracks.id}:${tracks.since}`) {
      this.tracksCounted = `${tracks.id}:${tracks.since}`; this.onTracks++;
      this.incident("stopped_on_tracks", "Stopped on the tracks", { crossing: tracks.id });
    }
    // don't block the junction (sim/junction-box.js): standing in it for a second with traffic past it
    // leaving no room is counted once a visit
    const box = world.inBox, blocking = box?.blocked && box.still > 0.5;
    if (blocking && box.still > 1 && this.boxCounted !== `${box.key}:${box.since}`) {
      this.boxCounted = `${box.key}:${box.since}`; this.blockedJunctions++;
      this.incident("blocked_junction", "Stopped in the junction", { junction: box.id });
    }
    // a work zone (sim/work-zone.js): its limit holds from the stop line to the end of the one-lane
    // section
    const workZoneFast = !!zonePass && speed > zonePass.limit + SPEED_GRACE_MPS;
    if (workZoneFast) {
      this.workZoneSpeeding += dt;
      if (!speeding) this.speeding += dt;
      if (!this.workZoneCounted.has(zonePass.zone.id)) { this.workZoneCounted.add(zonePass.zone.id); this.incident("work_zone_speeding", "Too fast through a work zone", { zone: zonePass.zone.id }); }
    }
    // cars parked at the kerb that hide the sidewalk (sim/hidden-hazards.js): within STEP_OUT_M of them,
    // the blind-spot speed holds
    const blind = this.hazards ? blindSpot(world, ego, road) : null;
    const blindFast = !!blind && blind.from_m <= STEP_OUT_M && speed > blind.limit_mps + SPEED_GRACE_MPS;
    if (blindFast) {
      this.blindSpeeding += dt;
      const key = `${blind.edge}:${blind.side}`;
      if (!this.blindCounted.has(key)) { this.blindCounted.add(key); this.incident("blind_spot_speeding", "Passed parked cars too fast to stop for someone stepping out", { edge: blind.edge }); }
    }
    // a snow plow (sim/snow-plow.js): stay back of it
    if (world.plowsSeen) this.plows = true;
    if (world.closuresSeen) this.closures = true;
    const plow = this.plows ? egoPlow(world, road?.limit ?? 11.2) : null;
    const plowClose = !!plow?.holds && speed > 1 && plow.rel.gap_m > -1 && plow.rel.gap_m < plow.keep - PLOW_CLOSE_SLACK_M;
    if (plowClose) {
      this.plowClose += dt;
      if (this.plowCounted !== plow.plow.id) { this.plowCounted = plow.plow.id; this.incident("plow_close", "Followed a snow plow too closely", { plow: plow.plow.id }); }
    }
    for (const ev of world.events || []) {
      if (ev.type === "passed_plow_on_right") { this.plowRightPasses++; this.incident("plow_right_pass", "Passed a snow plow on the right", { plow: ev.plow }); }
      if (ev.type === "merged_out_of_turn") { this.mergeCutIns++; this.incident("merge_cut_in", "Merged out of turn: forced in ahead of the car whose turn it was", { zone: ev.zone, cut: ev.cut }); }
      if (ev.type === "took_merge_turn") { this.mergeTurnsTaken++; this.incident("merge_turn_taken", "Didn’t let the car in the closed lane take its turn at the merge", { zone: ev.zone }); }
      if (ev.type === "merged_early") { this.earlyMerges++; this.incident("early_merge", "Merged early instead of using the lane to the merge point", { zone: ev.zone }); }
      if (ev.type === "cut_in_front_of_plow") { this.plowCutIns++; this.incident("plow_cut_in", "Moved back in too close in front of a snow plow", { plow: ev.plow }); }
      if (ev.type === "stop_sign" && ev.flagger) this.flaggerStops++;
      if ((ev.type === "stop_sign" || ev.type === "failed_to_yield") && ev.dark) this.darkSignals++;
      if (ev.type === "failed_to_yield" && ev.double_parked) this.vanCutoffs++;
      if (ev.type === "close_pass") { this.closePasses++; this.incident("close_pass", "Passed a cyclist closer than the minimum passing distance", { cyclist: ev.with, clearance_m: ev.clearance_m, min_m: ev.min_m }); }
      if (ev.type === "failed_to_yield" && ev.cyclist_pass) this.cyclistCutoffs++;
      if (ev.type === "failed_to_yield" && ev.unseen) { this.hiddenCutoffs++; this.incident("hidden_cutoff", "Pulled out in front of a vehicle hidden behind another", { with: ev.with }); }
      if (ev.type === "kerb_strike") { this.kerbStrikes++; this.incident("kerb", ev.reversing ? "Backed a wheel onto the kerb" : "Drove a wheel onto the kerb"); }
    }
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
      : speeding && zone ? `Slow to ${Math.round(road.limit * 3.6)}. You’re in a ${zone.kind} zone.`
      : tracks?.still > 0.5 ? "Clear the tracks. Never stop on them."
      : blocking ? "You’re blocking the junction. Next time, wait at the line until there’s room past it."
      : workZoneFast ? `Slow to ${Math.round(zonePass.limit * 3.6)}. You’re in a work zone.`
      : plowClose ? `Drop back. Stay ${plow.keep} m behind the snow plow.`
      : blindFast ? `Slow to ${Math.round(blind.limit_mps * 3.6)}. Parked cars hide the sidewalk: someone could step out.`
      : roadsideFast ? `Slow to ${Math.round(passing.limit * 3.6)} and move over. A ${name} is stopped with its lights flashing.`
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
      if (rel.ahead <= 0 || Math.abs(rel.right) > (ego.spec?.width || 1.9) / 2 + 0.45 + (other.spec?.width || other.width || 1.8) / 2) continue;
      const front = ego.spec ? ego.spec.length - ego.spec.rearOverhang : 3.6;
      const g = rel.ahead - front - (other.spec?.length || other.length || 0.6) / 2;
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
      safety: Math.round(clamp(100 - collisions * 35 - atFault * 15 - this.danger * 3 - this.closeFollowing * 0.6 - this.blindSpeeding * 1.2 - this.plowClose * 0.6)),
      legality: Math.round(clamp(100 - reds * 35 - stops * 20 - yields * 25 - this.speeding * 1.2 - this.noMoveOver * 10 - this.plowRightPasses * 20 - this.plowCutIns * 10 - this.mergeCutIns * 20 - this.mergeTurnsTaken * 10 - this.closePasses * 20)),
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
    if (this.zoneSpeeding > 1) tips.push("Slow to 30 km/h in school and playground zones while they are in effect. Children can step out from anywhere.");
    else if (this.speeding > 1) tips.push("Watch the speed-limit sign, especially when entering residential streets.");
    if (this.roadsideSpeeding > 0.5 || this.noMoveOver) tips.push("Passing a vehicle stopped with its lights flashing, slow to 40 km/h (70 where the limit is 80 or more) and move out of the lane next to it if you can. People work right beside it.");
    if (this.blindSpeeding > 0.5) tips.push("Beside cars parked at the kerb on quiet streets and in school zones, slow to a speed you can stop from in about 15 m. Someone can step out from between them before you can see them.");
    if (this.darkSignals) tips.push("Where a signal’s lights are out, treat the junction as an all-way stop: stop at the line, then go in turn. Whoever stopped first goes first.");
    if (this.hiddenCutoffs) tips.push("A vehicle waiting to turn left opposite you, or one stopped near a corner, can hide traffic in the lane beside it. Don't turn across a lane you can't see: wait until you can see that it is clear.");
    if (this.plowRightPasses) tips.push("Never pass a snow plow on the right. Its blade throws snow and debris that way, and a wing blade can reach well into the next lane.");
    if (this.plowClose > 1 || this.plowCutIns) tips.push("Stay at least 30 m behind a snow plow with its lights flashing (100 m where the limit is over 80 km/h). Pass one only on the left, where you can see the road ahead is clear, and move back in well ahead of it.");
    if (this.mergeCutIns || this.mergeTurnsTaken) tips.push("Where a lane is closed, zipper merge: use both lanes right up to the merge point, then take turns, one vehicle from each lane. Don't force your way in out of turn, and don't close the gap on someone whose turn it is.");
    if (this.earlyMerges) tips.push("In slow traffic, don't merge early into the open lane. Stay in your lane to the merge point and take your turn there: using both lanes keeps the queue shorter, and everyone gets through sooner.");
    if (this.closePasses) tips.push("Give cyclists room: leave at least 1 m when you pass one where the limit is 50 km/h or less, 1.5 m above. On a street with one lane each way that means moving into the oncoming lane, so stay behind until it is clear.");
    if (this.cyclistCutoffs) tips.push("Passing a cyclist through the oncoming lane, wait behind them until that lane is clear for the whole pass and back. Oncoming traffic has the right of way.");
    if (this.vanCutoffs) tips.push("Going round a vehicle stopped in your lane, wait behind it until the oncoming lane is clear for the whole way round and back. Oncoming traffic has the right of way.");
    if (this.kerbStrikes) tips.push("Parking, creep in slowly and stop before a wheel touches the kerb. Turn the wheel only while the car is moving if you have to, and check your mirror on the kerb side.");
    if (this.parking?.result === "parked" && !this.parking.within_kerb) tips.push("Park parallel to the kerb with your wheels within 30 cm of it. If you end up further out, pull forward and reverse in again.");
    if (this.parking?.result === "stuck partway in") tips.push("Choose a space at least one and a half times your car's length, and start with your rear bumper level with the car in front, about a door's width from it.");
    if (this.flaggerStops) tips.push("At a work zone, stop for the flagger’s STOP paddle and wait for it to turn to SLOW. Traffic coming the other way has the one lane until then.");
    if (this.workZoneSpeeding > 0.5) tips.push("Keep to 30 km/h through a work zone. The crew works right beside the lane.");
    if (this.blockedJunctions) tips.push("Even on a green, don’t enter a junction unless there is room for all of your car past it. Wait at the line, or you’ll block the cross street when the light changes.");
    if (this.onTracks) tips.push("Never stop on the tracks at a level crossing. Wait short of them, at least 5 m back from the nearest rail, until there is room for all of your car past them.");
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
      speeding_s: round(this.speeding), zone_speeding_s: round(this.zoneSpeeding), roadside_speeding_s: round(this.roadsideSpeeding), no_move_over: this.noMoveOver, work_zone_speeding_s: round(this.workZoneSpeeding), flagger_stops_run: this.flaggerStops, van_cutoffs: this.vanCutoffs, stopped_on_tracks: this.onTracks, blocked_junction: this.blockedJunctions, off_road_s: round(this.offRoad), wrong_way_s: round(this.wrongWay),
      close_following_s: round(this.closeFollowing), danger_s: round(this.danger), hard_brakes: this.hardBrakes,
      min_gap_m: Number.isFinite(this.minGap) ? round(this.minGap) : null, resets: this.resets,
      ...(this.plows ? { plow_close_s: round(this.plowClose), plow_right_passes: this.plowRightPasses, plow_cut_ins: this.plowCutIns } : {}),
      ...(this.closures ? { merge_cut_ins: this.mergeCutIns, merge_turns_taken: this.mergeTurnsTaken, early_merges: this.earlyMerges } : {}),
      ...(this.cyclists ? { close_passes: this.closePasses, cyclist_cutoffs: this.cyclistCutoffs } : {}),
      ...(this.hazards ? { blind_spot_speeding_s: round(this.blindSpeeding), hidden_cutoffs: this.hiddenCutoffs } : {}),
      ...(this.parking || this.kerbStrikes ? { parking: { ...(this.parking || { result: "not yet" }), kerb_strikes: this.kerbStrikes } } : {}),
      coach: this.coach, tips, incidents: this.incidents.map(i => ({ ...i })) };
  }

  finish(status = "finished") { this.finished ||= status; return this.snapshot(); }
}

export const HISTORY_KEY = "jev-fsd-drives-v1";
export function readHistory(storage) {
  try {
    storage ||= globalThis.localStorage;
    const data = JSON.parse(storage.getItem(HISTORY_KEY));
    return Array.isArray(data) ? data.filter(d => d?.model_version === SCORE_VERSION && Number.isFinite(d.score)
      && typeof d.title === "string" && typeof d.map === "string" && Array.isArray(d.tips) && Array.isArray(d.incidents)
      && Object.keys(SCORE_WEIGHTS).every(key => Number.isFinite(d.categories?.[key]))).slice(0, 20) : [];
  }
  catch { return []; }
}
export function saveDrive(report, storage) {
  try {
    storage ||= globalThis.localStorage;
    const history = [report, ...readHistory(storage)].slice(0, 20);
    storage.setItem(HISTORY_KEY, JSON.stringify(history)); return true;
  } catch { return false; }
}
