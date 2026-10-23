// The exact JSON sent to Jev, and the questions. Numbers are rounded, labels are computed in code,
// and only fields relevant to the situation are included. This is what the JSON panel shows.

import { r1 } from "../common.js";
import { speedVsTarget } from "./candidates.js";
import { STOP_ZONE_M } from "../sim/signals.js";
import { current as weather } from "../sim/weather.js";
import { CLEARING_M, waitsItsTurn } from "./sensors.js";

export const DEFAULT_STYLE = "cautious city driver: obeys limits, stops fully at stop signs, keeps a safe gap, smooth steering, takes turns slowly";
const PREAMBLE = "You are the driving policy of a car in city traffic. Obey traffic controls and drive as described in `driving_style`.";

const gapLabel = (gap, closing) => (gap < 4 || (closing > 0 && gap / closing < 1.5)) ? "dangerous" : gap < 8 ? "short" : gap < 25 ? "comfortable" : "far";
const laneLabel = (d) => Math.abs(d) < 0.3 ? "centered" : Math.abs(d) < 0.8 ? `slightly ${d > 0 ? "right" : "left"}` : `far ${d > 0 ? "right" : "left"}`;
const distLabel = (m) => m < STOP_ZONE_M ? "at" : m < 25 ? "close" : m < 60 ? "approaching" : "far";
const speedVsLimit = (v, limit) => v > limit + 0.5 ? "over" : v > limit - 1 ? "at" : "under";
const laneName = (index, count) => count === 2 ? (index === 0 ? "left" : "right") : index === 0 ? "left" : index === count - 1 ? "right" : count === 3 ? "middle" : `lane ${index + 1} from the left`;
const passing = (snap) => snap.lane && Object.values(snap.lane.sides).find((side) => side.offer === "pass" && side.gap_ok);

export function toJevState(snap, candidates, meta, style = DEFAULT_STYLE) {
  const { ego, limit } = snap;
  const state = {
    driving_style: style,
    units: "meters, m/s, seconds. right/ahead are relative to the car; negative ahead is behind.",
    car: { speed: r1(ego.v), limit: r1(limit), speed_vs_limit: speedVsLimit(ego.v, limit) },
  };
  if (snap.target) {
    state.car.target_speed = r1(snap.target.v);
    state.car.target_reason = snap.target.reasons.length ? snap.target.reasons.join(", ") : "speed limit";
    state.car.speed_vs_target = speedVsTarget(ego.v, snap.target.v);
  }
  if (snap.visibility) state.visibility = { range_m: snap.visibility.range_m, ...(snap.visibility.clear_path_m !== undefined ? { clear_path_m: r1(snap.visibility.clear_path_m) } : {}), safe_speed_mps: r1(snap.visibility.safe_speed_mps), building_occlusion: true, note: "Traffic and signal phases are observed only within range and line of sight. Unseen traffic may exist." };
  if (snap.roadside?.length) state.roadside = snap.roadside.map((o) => ({ ...o, right: r1(o.right), ahead: r1(o.ahead) }));
  if (snap.nav) {
    state.nav = {
      next_turn: snap.nav.next_turn, turn_in_m: r1(snap.nav.turn_in_m), remaining_m: r1(snap.nav.remaining_m),
      destination: { right: r1(snap.nav.destination.right), ahead: r1(snap.nav.destination.ahead) }, on_route: snap.onRoute,
    };
    if (snap.nav.turn_street) state.nav.turn_street = snap.nav.turn_street;
    if (snap.nav.exit) state.nav.roundabout_exit = snap.nav.exit;
  }
  const laneLateral = snap.lane ? snap.lane.lateral : snap.routeProj ? snap.routeProj.lateral : snap.road.lateral;
  state.road = {
    name: snap.road.name || "unnamed", on_road: snap.road.on_road,
    lane_offset_m: r1(laneLateral),
    lane_position: laneLabel(laneLateral),
    heading_error_deg: r1((snap.routeProj ? snap.routeProj.headingErr : snap.road.heading_error) * 180 / Math.PI),
  };
  if (!snap.road.on_road) state.road.distance_to_road_m = r1(snap.road.distance_to_road);
  if (snap.lane && snap.lane.lanes > 1) {
    const l = snap.lane;
    state.lanes = { count: l.lanes, car_lane: laneName(l.index, l.lanes), route_lane: laneName(l.route_index, l.lanes) };
    if (l.shift) state.lanes.changing_to = laneName(l.index, l.lanes);
    if (l.delta) state.lanes.return_within_m = r1(Math.max(0, l.until_s - snap.routeProj.s - snap.ego.front_m));
    for (const side of Object.values(l.sides)) {
      state.lanes[side.dir] = {
        gap_ok: side.gap_ok, ...(side.alongside ? { alongside: true } : {}),
        ...(side.leader ? { ahead_gap_m: r1(side.leader.gap_m), ahead_speed: r1(side.leader.speed) } : {}),
        ...(side.rear ? { behind_gap_m: r1(side.rear.gap_m), behind_speed: r1(side.rear.speed) } : {}),
      };
    }
  }
  if (weather.name !== "dry") state.road.conditions = weather.description;
  if (snap.intersection) {
    const i = snap.intersection;
    state.intersection = {
      control: i.control, ...(i.signal ? { signal: i.signal } : {}),
      bumper_to_line_m: r1(i.bumper_to_line_m), distance: distLabel(i.bumper_to_line_m), entered: i.entered,
      ...(i.control === "stop" ? { stop_completed: i.stop_completed, all_way: i.all_way } : {}),
      ...(i.control === "yield" ? { roundabout: true, ring_traffic: i.cross_traffic_moving } : { cross_traffic_moving: i.cross_traffic_moving }),
    };
    if ((i.control === "signal" || i.control === "stop") && (i.turn === "left" || i.turn === "uturn" || i.right_on_red)) state.intersection.turn = i.turn;
    if (i.priority) {
      const p = i.priority;
      state.intersection.priority = p.arrived ? { stopped_at_line: true, your_turn: p.go, ...(p.wait_for ? { wait_for: p.wait_for } : {}), ...(p.waiting.length ? { goes_first: p.waiting } : {}) }
        : { stopped_at_line: false, ...(p.waiting.length ? { waiting_at_junction: p.waiting } : {}) };
    }
    if (i.right_on_red) {
      const r = i.right_on_red, w = r.wait_for;
      state.intersection.right_on_red = { allowed: true, stop_completed: r.stop_completed, clear: r.clear, ...(w ? { wait_for: w.id || w.kind } : {}) };
    }
    if (i.oncoming) state.intersection.oncoming = { id: i.oncoming.id, arrives_in_s: r1(i.oncoming.eta_s), needed_s: r1(i.oncoming.need_s), wait_in_m: r1(Math.max(0, i.oncoming.bumper_to_yield_m)), yield: true };
  }
  if (snap.following) {
    const f = snap.following;
    state.following = { id: f.id, ...(f.kind !== "car" ? { kind: f.kind } : {}), gap_m: r1(f.gap_m), gap: gapLabel(f.gap_m, f.closing_mps), speed: r1(f.speed), closing_mps: r1(f.closing_mps) };
  }
  if (snap.pedestrian) {
    const p = snap.pedestrian;
    state.pedestrian = { crossing_m: r1(Math.max(0, p.bumper_to_crosswalk_m)), distance: distLabel(p.bumper_to_crosswalk_m - 2), in_path: p.to_path_m < 1.8, yield: true, ...(p.mid_block ? { mid_block: true } : {}) };
  }
  if (snap.rear_follower && snap.rear_follower.gap_m < 12) state.rear_follower = { id: snap.rear_follower.id, gap_m: r1(snap.rear_follower.gap_m) };
  if (snap.traffic.length) {
    state.traffic = snap.traffic.map((t) => ({ id: t.id, ...(t.kind !== "car" ? { kind: t.kind } : {}), right: r1(t.right), ahead: r1(t.ahead), speed: r1(t.speed), heading: t.heading, moving: t.moving }));
  }
  if (snap.current_path_hazard) state.current_path_hazard = snap.current_path_hazard;
  if (snap.stuck) state.stuck = { for_s: Math.round(snap.stuck.for_s) };
  if (meta.routeOptions) state.route_options = meta.routeOptions.map((r) => ({ id: r.id, summary: r.summary }));
  const target = snap.target ? snap.target.v : limit;
  state.candidates = candidates.filter((c) => c.eligible).map((c) => ({
    id: c.id, steer: c.steer, speed: c.speed, end_speed: r1(c.sim.end_speed), vs_target: speedVsTarget(c.sim.end_speed, c.laneTarget ?? target),
    max_accel: r1(c.sim.max_accel || 0), max_decel: r1(c.sim.max_decel || 0), max_lateral_accel: r1(c.sim.max_lateral_accel || 0),
    ...(Number.isFinite(c.sim.min_clearance_m) ? { min_clearance_m: r1(c.sim.min_clearance_m) } : {}),
    progress_m: r1(c.sim.progress_m), lane: laneLabel(c.sim.lane_err_end), outcome: outcomeLabel(c, snap),
  }));
  if (meta.rejected && Object.keys(meta.rejected).length) state.rejected = meta.rejected;
  return state;
}

function outcomeLabel(c, snap) {
  if (c.id === "stop_at_line" && snap.intersection) return `clear, stops ${Math.max(0, r1(snap.intersection.bumper_to_line_m - c.sim.progress_m))} m before the line`;
  if (c.id === "stop_at_destination") return "clear, reaches the destination";
  if (c.id === "stop_for_oncoming" && snap.intersection?.oncoming) return `clear, waits ${Math.max(0, r1(snap.intersection.oncoming.bumper_to_yield_m - c.sim.progress_m))} m short of oncoming traffic's path`;
  if (c.id === "stop_for_pedestrian" && snap.pedestrian) return `clear, stops ${Math.max(0, r1(snap.pedestrian.bumper_to_crosswalk_m - c.sim.progress_m))} m before the ${snap.pedestrian.mid_block ? "crossing pedestrian" : "crosswalk"}`;
  if (!c.sim.stays_on_road) return c.sim.off_road_fraction > 0.5 ? "leaves the road" : "touches the road edge";
  if (c.change) return `clear, ${c.change.offer === "pass" || c.change.prepare ? "moves into" : "moves back into"} the ${c.change.dir} lane${c.sim.min_gap_m < 8 ? `, ${r1(c.sim.min_gap_m)} m behind a car` : ""}`;
  if (!c.sim.stays_in_lane) return "clear, drifts out of lane";
  if (c.sim.min_gap_m < 4) return `clear, but closes to ${r1(c.sim.min_gap_m)} m of a car`;
  return "clear";
}

export function situationClauses(snap) {
  const out = [];
  const i = snap.intersection;
  const m = i ? Math.max(0, Math.round(i.bumper_to_line_m)) : 0;
  const atLine = i && i.bumper_to_line_m < STOP_ZONE_M;
  if (i && i.control === "signal") {
    if (i.bumper_to_line_m < -CLEARING_M && i.signal !== "green") out.push(`The car is already inside the intersection and the signal has turned ${i.signal}: clear the intersection${i.oncoming ? " once oncoming traffic has passed" : ""}.`);
    else if (i.signal === "unknown") out.push(`The signal phase ${m} m ahead is not visible: approach cautiously and stop at the line unless a permitted phase becomes visible.`);
    else if (i.signal === "red" && i.right_on_red) out.push(rightOnRedClause(i, m, atLine));
    else if (i.signal === "red") out.push(atLine ? "The car is at the line and the signal is red: hold still until it turns green." : `The signal ${m} m ahead is red: keep rolling toward the line and stop just before it${i.entered ? ", unless the car has already entered the intersection" : ""}.`);
    else if (i.signal === "yellow") out.push(`The signal ${m} m ahead is yellow: stop before the line if that is comfortable, otherwise clear the intersection.`);
    else out.push(`The signal ${m} m ahead is green; proceed unless the path is blocked.`);
    if (i.oncoming) out.push(oncomingClause(i));
  } else if (i && i.control === "stop") {
    const p = i.priority;
    if (!i.stop_completed) {
      if (!p) out.push(atLine ? "The car is at the stop line and the stop is not completed yet: hold still until it is." : `A stop sign is ${m} m ahead: keep rolling toward it, come to a full stop at the line, then go when cross traffic is clear.`);
      else {
        const first = p.waiting.length ? ` ${p.waiting.map((id) => `\`${id}\``).join(", ")} stopped at ${p.waiting.length > 1 ? "their lines" : "its line"} before the car and ${p.waiting.length > 1 ? "go" : "goes"} first.` : "";
        out.push(atLine ? `The car is at the line of an all-way stop and the stop is not completed yet: hold still until it is. Vehicles go in the order they stopped at their lines.${first}` : `An all-way stop is ${m} m ahead: keep rolling toward it and come to a full stop at the line. Vehicles go in the order they stopped at their lines, and one that stops at the same time on the car's right goes first.${first}`);
      }
    } else if (waitsItsTurn(i)) out.push(`The car has stopped at an all-way stop and it is not its turn: \`${p.wait_for}\` goes first, because it stopped first or stopped at the same time on the car's right (or ahead, when the car turns left). Hold still until it has gone.`);
    else if (i.cross_traffic_moving) out.push("The stop is completed but cross traffic is moving through the junction: hold until it is clear.");
    else out.push(p ? "The car has stopped at an all-way stop and it is its turn: go when the junction is clear." : "The stop is completed and no crossing traffic is visible: check sight lines before proceeding.");
    if (i.oncoming) out.push(oncomingClause(i));
  } else if (i && i.control === "yield") {
    const exit = snap.nav && snap.nav.exit ? ` and take exit ${snap.nav.exit}` : "";
    if (i.entered) out.push(`The car is in a roundabout: keep circulating counter-clockwise${exit}.`);
    else if (i.cross_traffic_moving) out.push(atLine ? "The car is at a roundabout's yield line and a car in the roundabout has the right of way: hold still until it has passed." : `A roundabout is ${m} m ahead and a car in it has the right of way: slow down and stop at the yield line if it has not passed.`);
    else out.push(`A roundabout is ${m} m ahead and no approaching ring traffic is visible: check sight lines and enter cautiously, go counter-clockwise${exit}.`);
  }
  if (snap.pedestrian) {
    const p = snap.pedestrian, m = Math.max(0, Math.round(p.bumper_to_crosswalk_m));
    const where = p.mid_block ? "mid-block, outside a crosswalk" : "in the crosswalk";
    out.push(p.bumper_to_crosswalk_m < STOP_ZONE_M ? `A pedestrian is crossing ${where} right in front of the car: hold still until they have cleared the car's path.` : `A pedestrian is crossing ${where} ${m} m ahead: slow down and stop short of them until they have cleared the car's path.`);
  }
  if (snap.following) {
    const label = gapLabel(snap.following.gap_m, snap.following.closing_mps);
    if (snap.following.kind === "cyclist" && snap.following.gap_m < 30) out.push("A cyclist is riding ahead in the lane: stay behind it at a safe gap; passing needs at least 1 m of space, and the candidates that would pass too close have already been removed.");
    else if (label === "dangerous" || label === "short") out.push(`The ${snap.following.kind === "parked car" ? "parked car" : "car"} ahead is close; keep a safe gap.`);
  }
  if (snap.nav && snap.nav.next_turn !== "none" && snap.nav.next_turn !== "roundabout" && snap.nav.turn_in_m < 40) out.push(`A ${snap.nav.next_turn === "uturn" ? "U-turn" : snap.nav.next_turn + " turn"} is coming in ${Math.round(snap.nav.turn_in_m)} m; \`car.target_speed\` already accounts for it.`);
  if (weather.name !== "dry") out.push(`Conditions: ${weather.description}. Grip is reduced, so \`car.target_speed\` sits below the limit and braking needs more room.`);
  if (snap.visibility) out.push(`Objects beyond ${snap.visibility.range_m} m or behind buildings are unseen; an empty traffic list does not prove the road is clear.`);
  const pass = passing(snap);
  if (pass) out.push(`The ${snap.following.kind} ahead is slower than this lane allows and the ${pass.dir} lane has room: a \`change_${pass.dir}_*\` candidate passes it, and staying behind is also acceptable. Change lanes only to get past it.`);
  if (snap.lane && snap.lane.delta && !snap.lane.shift) {
    const back = snap.lane.delta < 0 ? "right" : "left";
    const within = Math.max(0, Math.round(snap.lane.until_s - snap.routeProj.s - snap.ego.front_m));
    const car = laneName(snap.lane.index, snap.lane.lanes), route = laneName(snap.lane.route_index, snap.lane.lanes);
    const turn = snap.nav && (snap.nav.next_turn === "left" || snap.nav.next_turn === "right") ? ` for the ${snap.nav.next_turn} turn${snap.nav.turn_street ? ` onto ${snap.nav.turn_street}` : ""}` : " for a turn";
    if (snap.lane.route_ahead) out.push(`The car is in the ${car} lane, and its route moves to the ${route} lane ahead${turn}. Choose a \`change_${back}_*\` candidate to move into it when one is offered; the car must be in that lane within ${within} m.`);
    else out.push(`The car is in the ${car} lane, but its route continues in the ${route} lane. Choose a \`change_${back}_*\` candidate to return when one is offered; the car must be back within ${within} m.`);
  }
  if (snap.roadside?.length) out.push("Parked cars may conceal people or open doors. A visible open door, parking maneuver or pull-out requires extra clearance or slowing; assess the listed candidate outcomes.");
  if (!snap.road.on_road) out.push("The car is off the road; the candidates steer back toward the lane.");
  if (snap.stuck) out.push(`The car has been stopped with nothing blocking it for ${Math.round(snap.stuck.for_s)} s; if the way is clear, drive.`);
  if (snap.nav && snap.nav.remaining_m < 15) out.push("The destination is within reach; stop at it.");
  return out;
}

// Turning left (or around) with oncoming traffic coming, at a signal or a stop sign.
function oncomingClause(i) {
  const o = i.oncoming, w = Math.max(0, Math.round(o.bumper_to_yield_m));
  return `The car turns ${i.turn === "uturn" ? "around" : "left"} here and oncoming traffic has the right of way: \`${o.id}\` reaches the junction in ${r1(o.eta_s)} s, too soon for the car to turn in front of it (it needs ${r1(o.need_s)} s). ${w < 2 ? "Hold still until it has passed." : `Slow down and wait ${w} m ahead, short of its path, until it has passed (\`stop_for_oncoming\`).`}`;
}

// A red light where the car turns right and a right turn on red is allowed after a full stop.
function rightOnRedClause(i, m, atLine) {
  const r = i.right_on_red, w = r.wait_for;
  if (r.go) return r.entered ? "The car is turning right on the red light: complete the turn." : "The car has stopped fully at the red light and turns right here, where a right turn on red is allowed. Nothing it must yield to is in the way: it may turn now, or keep waiting for the green.";
  if (!r.stop_completed) return atLine ? "The car is at the line and the signal is red. It turns right here, and a right turn on red is allowed only after a full stop: hold still until the stop is completed." : `The signal ${m} m ahead is red and the car turns right there. A right turn on red is allowed only after a full stop: keep rolling toward the line and stop just before it.`;
  const why = !w ? "" : w.kind === "pedestrian" ? `: \`${w.id}\` is crossing or about to cross` : w.kind === "view" ? ": the car cannot see far enough along the street to its left to know it is clear" : w.kind === "junction" ? `: \`${w.id}\` is crossing the junction` : w.kind === "lane" ? ": it can turn on red only from the curb lane" : `: \`${w.id}\` is coming from the left and has the green`;
  return `The car has stopped fully at the red light and turns right here. A right turn on red is allowed, but it must yield first${why}. Hold still at the line until it is clear or the light turns green.`;
}

export function needsMotionQuestion(snap) {
  return !!((snap.intersection && (snap.intersection.bumper_to_line_m < 30 || snap.intersection.oncoming)) || (snap.following && snap.following.gap_m < 12) || (snap.pedestrian && snap.pedestrian.bumper_to_crosswalk_m < 30)
    || snap.roadside?.some((o) => o.kind !== "parked car" && o.ahead < 25) || snap.traffic.some((t) => t.ahead > 0 && t.ahead < 25 && Math.abs(t.right) < 4) || snap.stuck || (snap.nav && snap.nav.remaining_m < 30));
}

// Returns { questions, local } where `local` holds answers resolved without the model.
export function buildQuestions(snap, eligible, meta = {}) {
  const clauses = situationClauses(snap).join(" ");
  const pre = clauses ? `${PREAMBLE} ${clauses}` : PREAMBLE;
  const questions = {};
  const local = {};
  if (needsMotionQuestion(snap)) {
    // Waiting to turn left across oncoming traffic is a reason to hold still only while it applies,
    // so the criteria for every other situation read exactly as before.
    const waitLeft = snap.intersection?.oncoming ? ", when the car is turning left and has reached the point where it waits for oncoming traffic (`intersection.oncoming.wait_in_m` under 2)" : "";
    // A red light the car may turn right on is a reason to hold still only while the turn is not clear.
    const redOk = snap.intersection?.right_on_red?.go ? " (but not at a red signal where `intersection.right_on_red.stop_completed` and `clear` are both true: the car may turn right on red)" : "";
    // Likewise waiting its turn at an all-way stop.
    const turnWait = waitsItsTurn(snap.intersection) ? ", when the car has stopped at an all-way stop and it is not its turn (`intersection.priority.your_turn` is false)" : "";
    questions.motion = {
      type: "choice",
      instructions: `${pre} Decide whether the car should keep moving or hold still right now.`,
      criteria: {
        drive: "Keep moving: cruising, slowing down, or rolling up to a stop line that is not reached yet all count as driving. Use this while safely approaching a line, obstacle, crossing pedestrian (including mid-block), or destination still ahead; slow or brake as needed.",
        stop: `Hold completely still right now. Correct only when the car is already at the line (\`intersection.distance\` is "at") with a red or unseen signal${redOk}, a stop not yet completed, or a roundabout yield line with \`ring_traffic\` true, when a pedestrian is crossing right in front (\`pedestrian.distance\` is "at")${waitLeft}${turnWait}, when the path directly ahead is blocked, or when the car has reached the destination.`,
      },
    };
  } else {
    local.motion = { type: "choice", choice: "drive", probabilities: { drive: 1 }, confidence: 1, local: true };
  }
  if (eligible.length >= 2) {
    const criteria = {};
    for (const c of eligible) criteria[c.id] = `${c.steer}, ${c.speed}, +${r1(c.sim.progress_m)} m, ${outcomeLabel(c, snap)}`;
    questions.vector = {
      type: "choice",
      instructions: `${pre} Choose the maneuver for the next second using driving_style and the visible situation. The 3-second predictions have passed collision and road-rule checks against observed objects only; unseen objects and later changes remain possible. Weigh progress against braking, cornering, nearby clearance, roadside activity and limited sight lines. car.target_speed is a planning reference for limits, curves and stopping room, not a required choice. You may slow earlier or choose a safe lateral clearance when the situation or style warrants it. Keep moving when there is adequate visible room; hold still only for a present obstruction or a required stop at the car's current position.`,
      criteria,
    };
  } else if (eligible.length === 1) {
    local.vector = { type: "choice", choice: eligible[0].id, probabilities: { [eligible[0].id]: 1 }, confidence: 1, local: true };
  }
  if (meta.routeOptions && meta.routeOptions.length > 1) {
    const criteria = {};
    for (const r of meta.routeOptions) criteria[r.id] = r.summary;
    questions.route = {
      type: "choice",
      instructions: "The car has left its planned route. Choose which route to follow from the car's current position.",
      criteria,
    };
  }
  return { questions, local };
}
