// The exact JSON sent to Jev, and the questions. Numbers are rounded, labels are computed in code,
// and only fields relevant to the situation are included. This is what the JSON panel shows.

import { r1 } from "../common.js";

export const DEFAULT_STYLE = "cautious city driver: obeys limits, stops fully at stop signs, keeps a safe gap, smooth steering, takes turns slowly";
const PREAMBLE = "You are the driving policy of a car in city traffic. Obey traffic controls and drive as described in `driving_style`.";

const gapLabel = (gap, closing) => (gap < 4 || (closing > 0 && gap / closing < 1.5)) ? "dangerous" : gap < 8 ? "short" : gap < 25 ? "comfortable" : "far";
const laneLabel = (d) => Math.abs(d) < 0.3 ? "centered" : Math.abs(d) < 0.8 ? `slightly ${d > 0 ? "right" : "left"}` : `far ${d > 0 ? "right" : "left"}`;
const distLabel = (m) => m < 3 ? "at" : m < 25 ? "close" : m < 60 ? "approaching" : "far";
const speedVsLimit = (v, limit) => v > limit + 0.5 ? "over" : v > limit - 1 ? "at" : "under";

export function toJevState(snap, candidates, meta, style = DEFAULT_STYLE) {
  const { ego, limit } = snap;
  const state = {
    driving_style: style,
    units: "meters, m/s, seconds. right/ahead are relative to the car; negative ahead is behind.",
    car: { speed: r1(ego.v), limit: r1(limit), speed_vs_limit: speedVsLimit(ego.v, limit) },
  };
  if (snap.nav) {
    state.nav = {
      next_turn: snap.nav.next_turn, turn_in_m: r1(snap.nav.turn_in_m), remaining_m: r1(snap.nav.remaining_m),
      destination: { right: r1(snap.nav.destination.right), ahead: r1(snap.nav.destination.ahead) }, on_route: snap.onRoute,
    };
    if (snap.nav.turn_street) state.nav.turn_street = snap.nav.turn_street;
  }
  state.road = {
    name: snap.road.name || "unnamed", on_road: snap.road.on_road,
    lane_offset_m: r1(snap.routeProj ? snap.routeProj.lateral : snap.road.lateral),
    lane_position: laneLabel(snap.routeProj ? snap.routeProj.lateral : snap.road.lateral),
    heading_error_deg: r1((snap.routeProj ? snap.routeProj.headingErr : snap.road.heading_error) * 180 / Math.PI),
  };
  if (!snap.road.on_road) state.road.distance_to_road_m = r1(snap.road.distance_to_road);
  if (snap.intersection) {
    const i = snap.intersection;
    state.intersection = {
      control: i.control, ...(i.signal ? { signal: i.signal } : {}),
      bumper_to_line_m: r1(i.bumper_to_line_m), distance: distLabel(i.bumper_to_line_m), entered: i.entered,
      ...(i.control === "stop" ? { stop_completed: i.stop_completed, all_way: i.all_way } : {}),
      cross_traffic_moving: i.cross_traffic_moving,
    };
  }
  if (snap.following) {
    const f = snap.following;
    state.following = { id: f.id, gap_m: r1(f.gap_m), gap: gapLabel(f.gap_m, f.closing_mps), speed: r1(f.speed), closing_mps: r1(f.closing_mps) };
  }
  if (snap.rear_follower && snap.rear_follower.gap_m < 12) state.rear_follower = { id: snap.rear_follower.id, gap_m: r1(snap.rear_follower.gap_m) };
  if (snap.traffic.length) {
    state.traffic = snap.traffic.map((t) => ({ id: t.id, right: r1(t.right), ahead: r1(t.ahead), speed: r1(t.speed), heading: t.heading, moving: t.moving }));
  }
  if (snap.current_path_hazard) state.current_path_hazard = snap.current_path_hazard;
  if (snap.stuck) state.stuck = { for_s: Math.round(snap.stuck.for_s) };
  if (meta.routeOptions) state.route_options = meta.routeOptions.map((r) => ({ id: r.id, summary: r.summary }));
  state.candidates = candidates.filter((c) => c.eligible).map((c) => ({
    id: c.id, steer: c.steer, speed: c.speed, end_speed: r1(c.sim.end_speed), progress_m: r1(c.sim.progress_m),
    lane: laneLabel(c.sim.lane_err_end), outcome: outcomeLabel(c, snap),
  }));
  if (meta.rejected && Object.keys(meta.rejected).length) state.rejected = meta.rejected;
  return state;
}

function outcomeLabel(c, snap) {
  if (c.id === "stop_at_line" && snap.intersection) return `clear, stops ${Math.max(0, r1(snap.intersection.bumper_to_line_m - c.sim.progress_m))} m before the line`;
  if (c.id === "stop_at_destination") return "clear, reaches the destination";
  if (!c.sim.stays_on_road) return c.sim.off_road_fraction > 0.5 ? "leaves the road" : "touches the road edge";
  if (!c.sim.stays_in_lane) return "clear, drifts out of lane";
  if (c.sim.min_gap_m < 4) return `clear, but closes to ${r1(c.sim.min_gap_m)} m of a car`;
  return "clear";
}

export function situationClauses(snap) {
  const out = [];
  const i = snap.intersection;
  if (i && i.control === "signal") {
    if (i.signal === "red") out.push("The next signal is red: stop before the line unless the car has already entered the intersection.");
    else if (i.signal === "yellow") out.push("The next signal is yellow: stop before the line if that is comfortable, otherwise clear the intersection.");
    else out.push("The next signal is green; proceed unless the path is blocked.");
  } else if (i && i.control === "stop") {
    if (!i.stop_completed) out.push("A stop sign applies: come to a full stop at the line, then go when cross traffic is clear.");
    else out.push("The stop is completed; proceed when cross_traffic_moving is false.");
  }
  if (snap.following) {
    const label = gapLabel(snap.following.gap_m, snap.following.closing_mps);
    if (label === "dangerous" || label === "short") out.push("The car ahead is close; keep a safe gap.");
  }
  if (snap.nav && snap.nav.next_turn !== "none" && snap.nav.turn_in_m < 40) out.push(`A ${snap.nav.next_turn === "uturn" ? "U-turn" : snap.nav.next_turn + " turn"} is coming; slow to a comfortable turning speed.`);
  if (!snap.road.on_road) out.push("The car is off the road; the candidates steer back toward the lane.");
  if (snap.stuck) out.push(`The car has been stopped with nothing blocking it for ${Math.round(snap.stuck.for_s)} s; if the way is clear, drive.`);
  if (snap.nav && snap.nav.remaining_m < 15) out.push("The destination is within reach; stop at it.");
  return out;
}

export function needsMotionQuestion(snap) {
  return !!((snap.intersection && snap.intersection.bumper_to_line_m < 80) || (snap.following && snap.following.gap_m < 12)
    || snap.traffic.some((t) => t.ahead > 0 && t.ahead < 25 && Math.abs(t.right) < 4) || snap.stuck || (snap.nav && snap.nav.remaining_m < 30));
}

// Returns { questions, local } where `local` holds answers resolved without the model.
export function buildQuestions(snap, eligible, meta = {}) {
  const clauses = situationClauses(snap).join(" ");
  const pre = clauses ? `${PREAMBLE} ${clauses}` : PREAMBLE;
  const questions = {};
  const local = {};
  if (needsMotionQuestion(snap)) {
    questions.motion = {
      type: "choice",
      instructions: `${pre} Decide whether the car should keep moving or hold still right now.`,
      criteria: {
        drive: "Keep moving along the route; slowing down or approaching a line still counts as driving.",
        stop: "Come to a complete stop and wait: for a red or yellow light, a stop sign not yet completed, a blocked path, or the destination.",
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
      instructions: `${pre} Pick the maneuver to execute for the next second. Every listed candidate is predicted safe for 3 seconds. Prefer staying centered in the lane and making progress; slow down when following closely, approaching a turn, or approaching a stop line.`,
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
