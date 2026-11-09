// The road test examiner (lab/road-tests.js). Two parts:
//
// `RoadTestObserver` watches a road test drive the way an examiner in the passenger seat would and adds
// what it notices to the drive's own incident stream (sim/drive-score.js `incident`), so every remark
// is in the report, in the recorded events and replay links, and survives checkpoints with the drive.
// It reads the world and never changes it: a turn or lane change without a signal, a turn taken too
// fast, wide or across the corner, a stop past the line, a lane change into too small a gap, drifting
// out of lane position, and stopping with the road clear. It is attached only to road test drives
// (`drive.observer`), so nothing else is measured or reported differently.
//
// `examine(test, report)` turns a finished report into the examiner's sheet. Dangerous actions and
// violations fail the test outright: every reason the shared verdict gives (`challengeFailures`, which
// is bench/metrics.js `failures()`, so audits added later fail a road test without being listed here),
// and the few the coaching report counts that it does not (school zone speeding, driving on the wrong
// side, the examiner taking over). Minor errors are demerits, one each, a repeated one marked at most
// MAX_REPEAT times; more than the test's `maxDemerits` fails. Remarks are grouped by category; anything
// not recognised goes under "Other".

import { projectPoint } from "../map/mapdata.js";
import { challengeFailures } from "./practice.js";

export const EXAMINER_VERSION = 1;
export const MAX_REPEAT = 3;
export const CATEGORIES = { observation: "Observation", speed: "Speed control", space: "Space management",
  steering: "Steering and lane position", right_of_way: "Signals and right of way", parking: "Parking", other: "Other" };

const SIGNAL_LOOK_M = 60;      // a turn's signal counts from this far before the junction
const SIGNAL_RECENT_S = 8;     // a lane change's signal counts if it was on this recently
const TURN_KMH = { right: 25, left: 32, uturn: 15 };
const WIDE_M = 2.0;            // off the turn's path, outward or across the corner
const LATE_STOP_M = 1.0;       // the front this far past the stop line at the first stop there
const DRIFT_M = 1.2, DRIFT_S = 4;
const STILL_S = 6;
const LANE_MOVE_M = 2.4;       // a lane change: this far across the street's lanes
const round = (n, d = 1) => Math.round(n * 10 ** d) / 10 ** d;
const streetOf = (route, edge) => route.map?.edges.get(edge)?.name || "";

export class RoadTestObserver {
  constructor() {
    this.hint = null; this.turn = 0; this.turnState = null; this.control = 0; this.stop = null; this.bends = null;
    this.signalAt = { left: -Infinity, right: -Infinity }; this.anchor = null; this.laneChangeAt = -Infinity;
    this.drift = 0; this.driftCounted = false; this.still = 0; this.stillCounted = false;
  }

  // Once per physics step from DriveScore.record, after the elapsed time and distance moved on.
  record(world, road, dt, score) {
    const route = score.route, ego = world.ego;
    if (!route || !ego) return;
    const t = score.elapsed, v = Math.abs(ego.v), front = ego.spec.length - ego.spec.rearOverhang;
    if (ego.signal) this.signalAt[ego.signal] = t;
    // (with its own hint, so the ego's own route tracking is left alone: map/route.js `project`)
    const p = projectPoint(route.pts, route.cum, [ego.x, ego.y], this.hint);
    if (!p || p.distance > 8) { this.hint = null; this.anchor = null; return; }
    this.hint = p.index;
    const s = p.s, nearTurn = route.turns.some(x => Math.abs(s - x.at_m) < 25);
    this.turns(route, s, p, v, t, score, ego);
    this.stops(route, s + front, v, t, score);
    this.laneChange(world, route, s, p, v, t, dt, score, ego, front, route.turns.some(x => s > x.at_m - 20 && s < x.at_m + 12));
    // lane position, away from turns and lane changes
    if (road?.lane && v > 3 && !nearTurn && t - this.laneChangeAt > 4 && Math.abs(road.lateral) > DRIFT_M) {
      this.drift += dt;
      if (this.drift >= DRIFT_S && !this.driftCounted) { this.driftCounted = true; score.incident("lane_position", `Drifted out of lane position on ${road.name || "the street"}`); }
    } else { this.drift = 0; this.driftCounted = false; }
    // stopped with the road clear: no line, junction, vehicle or person close ahead, before the parking
    if (v < 0.3 && t > 5 && route.length - s > 100) {
      const lineAhead = route.controls.some(c => s + front > c.sRoute - 30 && s + front < (c.sJunction ?? c.sRoute) + 8);
      const blocked = world.obstaclesNear(ego.x, ego.y, 30).some(o => {
        const [x, y] = o.center || [o.x, o.y], rel = ego.toLocal(x, y);
        return o.kind === "pedestrian" ? Math.hypot(rel.ahead, rel.right) < 20 : rel.ahead > 0 && rel.ahead < 28 && Math.abs(rel.right) < 3;
      });
      if (!lineAhead && !blocked) {
        this.still += dt;
        if (this.still >= STILL_S && !this.stillCounted) { this.stillCounted = true; score.incident("hesitation", "Hesitated: stopped with the road ahead clear"); }
      } else this.still = 0;
    } else if (v > 1) { this.still = 0; this.stillCounted = false; }
  }

  // A turn the route makes onto another street (a bend in the same street is not one).
  turns(route, s, p, v, t, score, ego) {
    this.bends ||= examinerTurns(route).map(x => x.bend);
    const next = route.turns[this.turn];
    if (!next) return;
    const bend = this.bends[this.turn], side = next.dir === "uturn" ? "left" : next.dir;
    if (s > next.at_m - SIGNAL_LOOK_M && !bend) {
      const st = this.turnState ||= { signalled: false, kmh: 0, outward: 0, inward: 0, at_s: null, at_m: null };
      if (ego.signal === side && s < next.at_m + 5) st.signalled = true;
      if (s > next.at_m - 12 && s < next.at_m + 8) st.kmh = Math.max(st.kmh, v * 3.6);
      if (st.at_s === null && s >= next.at_m - 10) { st.at_s = round(t); st.at_m = Math.round(score.distance); }
      if (s > next.at_m - 8 && s < next.at_m + 15) {
        // right of the path is positive: outward is left for a right turn, right for a left one
        const out = side === "right" ? -p.lateral : p.lateral;
        st.outward = Math.max(st.outward, out); st.inward = Math.max(st.inward, -out);
      }
    }
    if (s <= next.at_m + 20) return;
    const st = this.turnState, onto = next.street ? ` onto ${next.street}` : "", when = !st || st.at_s === null ? {} : { at_s: st.at_s, at_m: st.at_m };
    if (st && !st.signalled) score.incident("turn_no_signal", `No signal for the ${next.dir === "uturn" ? "U-" : `${next.dir} `}turn${onto}`, when);
    if (st && st.kmh > TURN_KMH[next.dir]) score.incident("turn_too_fast", `Took the ${next.dir} turn${onto} too fast (${Math.round(st.kmh)} km/h)`, when);
    if (st && st.outward > WIDE_M) score.incident("wide_turn", `Swung wide on the ${next.dir} turn${onto}`, when);
    else if (st && st.inward > WIDE_M) score.incident("wide_turn", `Cut the corner on the ${next.dir} turn${onto}`, when);
    this.turn++; this.turnState = null;
  }

  stops(route, frontS, v, t, score) {
    const controls = route.controls;
    while (this.control < controls.length && frontS > controls[this.control].sRoute + 12) {
      const c = controls[this.control], first = this.stop;
      if (first && first.past > LATE_STOP_M) {
        const where = streetOf(route, c.edge);
        score.incident("late_stop", c.control.type === "stop" ? `Stopped past the stop line${where ? ` on ${where}` : ""}` : `Stopped over the line at the lights${where ? ` on ${where}` : ""}`, { at_s: first.at_s, at_m: first.at_m });
      }
      this.control++; this.stop = null;
    }
    const c = controls[this.control];
    // the first stop near the line (a stop further back, in a queue, is not judged)
    if (c && (c.control.type === "stop" || c.control.type === "signal") && v < 0.2 && !this.stop && frontS > c.sRoute - 3)
      this.stop = { past: frontS - c.sRoute, at_s: round(t), at_m: Math.round(score.distance) };
  }

  // A lane change is the car moving a lane's width across the road, measured from the route in the frame
  // of the street's lanes (the route's own moves to another lane added back: map/route.js `frameShift`),
  // so the lane geometry of a bend or a junction never counts as one. Not near a turn or the parking.
  laneChange(world, route, s, p, v, t, dt, score, ego, front, nearTurn) {
    const q = p.lateral + route.frameShift(s);
    if (nearTurn || v < 2 || route.length - s < 70) { this.anchor = null; return; }
    if (this.anchor === null) { this.anchor = q; return; }
    const moved = q - this.anchor;
    // (following slow drift within the lane)
    if (Math.abs(moved) < LANE_MOVE_M) { if (Math.abs(moved) < 0.5) this.anchor += moved * Math.min(1, dt / 3); return; }
    this.anchor = q; this.laneChangeAt = t;
    const dir = moved < 0 ? "left" : "right";
    if (t - this.signalAt[dir] > SIGNAL_RECENT_S) score.incident("lane_change_no_signal", `Changed lanes to the ${dir} without signalling`);
    // into too small a gap: someone close behind in the new lane, or the car pulled in close ahead of it
    const tight = world.npcs.some(o => {
      if (!o.spec || Math.cos((o.psi || 0) - ego.psi) < 0.7) return false;
      const [x, y] = o.center || [o.x, o.y], rel = ego.toLocal(x, y), half = (o.spec.length || 4.5) / 2;
      if (Math.abs(rel.right) > 1.6) return false;
      const behind = -rel.ahead - ego.spec.rearOverhang - half, ahead = rel.ahead - front - half;
      return (behind > -0.5 && behind < Math.max(4, Math.abs(o.v || 0) * 1.0)) || (ahead > -0.5 && ahead < Math.max(4, v * 0.8));
    });
    if (tight) score.incident("lane_change_space", `Changed lanes to the ${dir} into too small a gap`);
  }
}

// The route's turns as the examiner sees them: each of `route.turns`, with whether it is only a bend in
// the same street (`bend`) and the control at its junction (`control`: "signal", "stop" or null).
export function examinerTurns(route) {
  const map = route.map, out = [];
  for (let i = 1; map && i < route.edges.length; i++) {
    const a = map.edges.get(route.edges[i - 1]), b = map.edges.get(route.edges[i]);
    if (map.classifyTurn(map.turnAngle(a.id, b.id)) === "straight") continue;
    const c = route.controls.find(x => x.edge === a.id);
    out.push({ bend: !!a.name && a.name === b.name, control: c && c.control.type !== "uncontrolled" ? c.control.type : null });
  }
  return route.turns.map((turn, k) => ({ ...turn, bend: out[k]?.bend ?? false, control: out[k]?.control ?? null }));
}

// What the examiner says, and where: each line is shown from `from` until the car is past `at` (route
// arc length), the nearest manoeuvre first. Built from the route, so it matches what is marked.
const SAY_M = 150, SAY_STOP_M = 110;
export function examinerScript(route) {
  const lines = [], map = route.map, first = map?.edges.get(route.edges[0])?.name;
  lines.push({ kind: "start", from: -Infinity, at: 25, text: `When you're ready, check around you and move off${first ? ` along ${first}` : ""}. Follow the road until I ask you to turn.` });
  const turns = examinerTurns(route).filter(t => !t.bend);
  for (const c of route.controls) {
    if (c.turn !== "straight" || !["stop", "signal"].includes(c.control.type)) continue;
    lines.push({ kind: "straight", from: c.sRoute - SAY_STOP_M, at: c.sRoute, text: c.control.type === "signal" ? "Carry straight on at the lights."
      : c.control.all_way ? "At the all-way stop, stop behind the line, then go in turn, straight on." : "At the stop sign, come to a complete stop, then carry straight on." });
  }
  for (const t of turns) {
    const onto = t.street ? ` onto ${t.street}` : "", way = t.dir === "uturn" ? "make a U-turn" : `turn ${t.dir}${onto}`;
    lines.push({ kind: "turn", from: t.at_m - SAY_M, at: t.at_m, text: t.control === "signal" ? `At the lights, ${way}.`
      : t.control === "stop" ? `At the stop sign, stop, then ${way}.` : `Take the next ${t.dir === "uturn" ? "chance to make a U-turn" : `${t.dir}${onto}`}.` });
  }
  for (const sh of route.laneShifts?.() || []) {
    const turn = turns.find(t => t.at_m > sh.at), side = sh.by < 0 ? "left" : "right";
    lines.push({ kind: "lane", from: sh.at - SAY_M, at: sh.at, text: `When it's safe, move into the ${side} lane${turn?.dir === side ? `, ready to turn ${side}` : ""}.` });
  }
  const zones = new Set();
  for (const z of route.zoneMarks || []) {
    if (zones.has(z.zone.id)) continue;
    zones.add(z.zone.id);
    const kind = z.zone.kind === "school" ? "School" : "Playground", by = z.zone.name ? `, by ${z.zone.name}` : "";
    // (one the test starts in is mentioned once the car is under way)
    lines.push(z.from < 30 ? { kind: "zone", from: 26, at: 70, text: `This is a ${kind.toLowerCase()} zone${by}. Watch your speed.` }
      : { kind: "zone", from: z.from - 80, at: z.from + 15, text: `${kind} zone ahead${by}. Watch your speed.` });
  }
  lines.push({ kind: "park", from: route.length - SAY_M, at: route.length + 5, text: "Pull up on the right and parallel park in the gap between the parked cars, within 30 cm of the kerb." });
  return lines.sort((a, b) => a.at - b.at);
}
// The line to show `s` metres along the route: the nearest manoeuvre already announced and not yet past.
export const instructionAt = (script, s) => script.filter(l => s >= l.from && s <= l.at + 5).sort((a, b) => a.at - b.at)[0] || null;

// How each failure reason and examiner remark is grouped. Failure reasons are the strings
// bench/metrics.js `failures()` returns; one this does not know goes under "other".
const FAIL_CATEGORY = { timeout: "other", stuck: "other", collision: "space", "red light": "right_of_way", "failed to stop safely for amber": "right_of_way",
  "stop sign": "right_of_way", "failed to yield": "right_of_way", "off road": "steering", "passed plow on the right": "space", "merged out of turn": "right_of_way",
  "passed a cyclist too close": "space", "drove in a reserved bus lane": "steering", "failed to dip high beams": "right_of_way", "too fast for sun glare": "speed",
  "made a prohibited turn": "right_of_way", "took a speed hump too fast": "speed", "left a pedestrian crossover before the far curb": "right_of_way",
  "passed a garbage crew worker too close": "space", "drove past a crossing guard's stop sign": "right_of_way", "cut off or squeezed a contraflow cyclist": "space",
  "entered on green ahead of a car running the red": "observation", "squeezed past or failed to stop for a car backing out": "observation",
  "hit a pothole too fast": "speed", "ignored a ball rolling into the street": "observation", "drove into or too close to geese crossing the road": "observation",
  "splashed a pedestrian from a puddle": "speed",
  "not parked": "parking" };
const FAIL_REMARK = { timeout: "Did not complete the route", stuck: "Did not complete the route: the car got stuck", collision: "Collision",
  "red light": "Entered the junction on a red light", "stop sign": "Did not come to a complete stop at a stop sign", "failed to yield": "Failed to yield the right of way",
  "off road": "Left the road", "not parked": "Did not finish parked within 30 cm of the kerb" };
// Minor errors from the incident stream: the observer's and the coaching report's own.
const MINOR = { turn_no_signal: "right_of_way", lane_change_no_signal: "right_of_way", late_stop: "right_of_way", blocked_junction: "right_of_way",
  turn_too_fast: "speed", hard_brake: "speed", wide_turn: "steering", lane_position: "steering", lane_change_space: "observation", hesitation: "observation",
  blind_spot_speeding: "observation", kerb: "parking" };
const MINOR_REMARK = { hard_brake: "Braked harshly", blocked_junction: "Stopped in the junction", blind_spot_speeding: "Passed parked cars too fast to stop for someone stepping out",
  kerb: "Touched the kerb" };

const capital = text => text.charAt(0).toUpperCase() + text.slice(1);
// A failure reason's category; one added to `failures()` later, and not listed here, is "other".
export const failureCategory = reason => Object.hasOwn(FAIL_CATEGORY, reason) ? FAIL_CATEGORY[reason] : "other";
export const MINOR_TYPES = Object.keys(MINOR);

// The examiner's sheet for a finished report, or `available: false` where the report lacks the audit
// counters to judge it (as `challengeFailures` decides).
export function examine(test, report) {
  const reasons = challengeFailures(test, report), maxDemerits = test.maxDemerits ?? 10;
  if (!reasons) return { available: false, pass: false, demerits: 0, max_demerits: maxDemerits, fails: [], minors: [], categories: [] };
  const fails = reasons.map(reason => ({ category: failureCategory(reason), remark: FAIL_REMARK[reason] || capital(reason), reason,
    incident: report.incidents?.find(i => ({ collision: "collisions", "red light": "red_lights_run", "stop sign": "stop_signs_run", "failed to yield": "failed_to_yield" })[reason] === i.type) || null }));
  const incidentOf = type => report.incidents?.find(i => i.type === type) || null;
  if (report.zone_speeding_s > 1) fails.push({ category: "speed", remark: "Exceeded the school or playground zone limit", reason: "zone speeding", incident: incidentOf("zone_speeding") });
  if (report.wrong_way_s > 1) fails.push({ category: "steering", remark: "Drove on the wrong side of the road", reason: "wrong way", incident: null });
  if (report.speeding_s > 10) fails.push({ category: "speed", remark: "Repeatedly exceeded the speed limit", reason: "speeding", incident: null });
  if (report.resets > 0) fails.push({ category: "steering", remark: "The examiner had to intervene: the car was returned to its lane", reason: "reset", incident: incidentOf("reset") });
  if (report.no_move_over > 0 || report.roadside_speeding_s > 0.5) fails.push({ category: "right_of_way", remark: "Did not slow down and move over for a stopped vehicle with its lights flashing", reason: "move over", incident: incidentOf("no_move_over") || incidentOf("roadside_speeding") });
  if (report.flagger_stops_run > 0) fails.push({ category: "right_of_way", remark: "Went past a flagger's STOP paddle", reason: "flagger", incident: null });
  if (report.stopped_on_tracks > 0) fails.push({ category: "space", remark: "Stopped on the tracks", reason: "tracks", incident: incidentOf("stopped_on_tracks") });

  const minors = [], counts = {};
  const mark = (key, category, remark, incident = null, points = 1) => {
    counts[key] = (counts[key] || 0) + 1;
    if (counts[key] <= MAX_REPEAT) minors.push({ key, category, remark, incident, points });
  };
  for (const i of report.incidents || []) {
    if (!MINOR[i.type] || (i.type === "kerb" && !report.parking)) continue;
    mark(i.type, MINOR[i.type], MINOR_REMARK[i.type] || i.message, i);
  }
  if (report.speeding_s >= 0.5 && report.speeding_s <= 10) mark("speeding", "speed", `Exceeded the speed limit briefly (${round(report.speeding_s)} s in all)`, null, Math.min(MAX_REPEAT, Math.ceil(report.speeding_s / 3)));
  if (report.close_following_s >= 2) mark("following", "space", `Followed too closely (${round(report.close_following_s)} s in all)`, null, Math.min(MAX_REPEAT, 1 + Math.floor((report.close_following_s - 2) / 5)));
  if (report.danger_s > 0.5) mark("closing", "space", "Closed in fast on a road user ahead");
  if (report.off_road_s > 0 && report.off_road_s < 1) mark("edge", "steering", "Put a wheel off the edge of the road");
  const park = report.parking;
  if (park?.result === "parked" && park.within_kerb) {
    if (park.kerb_m > 0.2) mark("park_far", "parking", `Parked ${Math.round(park.kerb_m * 100)} cm from the kerb: closer is better`);
    if (Math.abs(park.angle_deg) > 4) mark("park_angle", "parking", "Finished at an angle to the kerb");
    if (park.legs > 5) mark("park_moves", "parking", "Needed extra moves to straighten up in the space");
  }
  const demerits = minors.reduce((sum, m) => sum + m.points, 0);
  if (demerits > maxDemerits) fails.push({ category: "other", remark: `Too many minor errors: ${demerits} demerits, more than ${maxDemerits}`, reason: "demerits", incident: null });
  const categories = Object.entries(CATEGORIES).map(([key, label]) => {
    const f = fails.filter(x => x.category === key), m = minors.filter(x => x.category === key);
    return { key, label, fails: f.length, demerits: m.reduce((sum, x) => sum + x.points, 0), remarks: [...f.map(x => ({ ...x, kind: "fail" })), ...m.map(x => ({ ...x, kind: "minor" }))] };
  });
  return { available: true, version: EXAMINER_VERSION, pass: fails.length === 0, demerits, max_demerits: maxDemerits, fails, minors, categories };
}
