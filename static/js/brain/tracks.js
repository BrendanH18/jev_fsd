// Two tracks for the same drive (ROADMAP 4.2). On the guarded track, the default and every earlier
// record's, the safety filter (brain/candidates.js simulateAll) removes every manoeuvre that fails a
// collision or road-rule check, and a driver only chooses among those left. On the open track the
// filter advises: a manoeuvre that fails a road-rule check stays on offer, flagged with the check it
// failed, and the driver's own judgment decides the outcome, which the audit (bench/metrics.js
// failures) judges as on the guarded track. A predicted collision is still removed, and the emergency
// brake (brain/safety.js) still brakes for one about to happen, on both tracks.
//
// Rules and the built-in agents keep to the unflagged manoeuvres, so they drive the open track exactly
// as the guarded one: they are the reference. A flagged manoeuvre keeps `reject` (the check it failed)
// with `eligible` true; an agent module sees it in `eligible` and may choose it.

import { FEATURE_FLAG_TEXT } from "../sim/features/index.js";

export const TRACKS = ["guarded", "open"];
export const DEFAULT_TRACK = "guarded";
export const isTrack = (t) => TRACKS.includes(t);

// The rejections the open track still enforces.
const ENFORCED = new Set(["collision"]);

// The open track's candidates: those the filter rejected for anything but a predicted collision become
// eligible, flagged. A manoeuvre whose forward sim collides stays removed whatever check rejected it
// first (a road closure's barricade, say, is checked before collisions). Returns the same shape as
// simulateAll; `rejected` counts only what stays removed.
export function openTrack(candidates, sim) {
  for (const c of candidates) {
    if (c.sim?.collision) {
      c.eligible = false;
      c.reject ||= "collision";
      delete c.flagged;
    } else if (c.reject && !ENFORCED.has(c.reject)) {
      c.eligible = true;
      c.flagged = true;
    } else delete c.flagged;
  }
  const rejected = {};
  for (const c of candidates) if (!c.eligible) rejected[c.reject] = (rejected[c.reject] || 0) + 1;
  return { ...sim, eligible: candidates.filter((c) => c.eligible), rejected };
}

// Those of `eligible` that passed every check: what Rules and the built-in agents choose among.
export const unflagged = (eligible) => eligible.filter((c) => !c.flagged);

// What each road-rule check means, for a driver reading a flagged manoeuvre: what the prediction found,
// in the words the situation clauses use. A check without an entry reads by its id.
export const FLAG_TEXT = {
  bus_lane_driving: "it drives in a reserved bus lane while the lane is in effect",
  lane_change_gap: "the gap in the next lane is too small for this lane change",
  lane_change_too_late: "it changes lanes too late, too close to the turn or junction",
  must_return_to_route_lane: "it leaves no room to get back to the route's lane before that lane ends",
  visibility_stopping_distance: "it is too fast to stop within the distance the car can see",
  passes_cyclist_too_close: "it passes a cyclist with less than 1 m of room",
  passes_cyclist_without_room: "it passes a cyclist with less than the legal passing distance",
  crosses_into_oncoming_traffic: "it crosses into the oncoming lane into the way of oncoming traffic",
  off_road: "it leaves the road",
  passes_officer_stop: "it goes on past the line while the police officer signals stop",
  runs_red: "it crosses the stop line where the signal requires the car to stop",
  fails_to_yield: "it enters without giving way to traffic that has the right of way",
  runs_stop: "it crosses the line without completing the stop",
  fails_to_yield_to_pedestrian: "it does not stop for a pedestrian crossing",
  fails_to_yield_to_oncoming: "it turns across oncoming traffic that has the right of way",
  fails_to_yield_to_cyclist: "it turns right across a cyclist on its right",
  passes_reversing_vehicle_too_close: "it passes a car backing out of a driveway too close",
  passes_ball_gap_too_fast: "it passes where a ball rolled out too fast to stop for a child following it",
  crosses_ice_too_fast: "it reaches the black ice faster than is safe on it",
  brakes_on_ice: "it brakes, accelerates or steers hard on black ice, or skids on it",
  enters_narrowing_out_of_turn: "it enters a stretch narrowed by snowbanks while it is the oncoming car's turn",
  blocks_parking_car: "it blocks or goes round a car parallel parking ahead",
  fails_to_yield_to_emergency: "it does not give way to an emergency vehicle",
  fails_to_yield_to_bus: "it does not let a bus pull out from its stop",
  passes_car_stopped_at_crosswalk: "it passes a vehicle stopped at a crosswalk without stopping first",
  passes_stopped_school_bus: "it passes a school bus with its red lights flashing",
  passes_streetcar_doors: "it passes a streetcar's open doors",
  crosses_in_front_of_train: "it crosses the level crossing with a train coming",
  no_room_past_tracks: "it stops on the level crossing, with no room past the tracks",
  blocks_junction: "it enters a junction it has no room to clear",
  merges_out_of_turn: "it merges at the lane closure out of turn",
  takes_merge_turn: "it takes the turn of the car merging at the lane closure",
  into_closed_lane: "it moves into a closed lane",
  merges_early: "it leaves the closed lane before the merge point",
  passes_plow_on_right: "it passes a snow plow on the right",
  follows_plow_too_close: "it closes in behind a snow plow inside its stay-back distance",
  enters_unseen_junction: "it enters a junction before it can see that it is clear",
  passes_turn_round_point: "it drives past the point where the route turns round",
  passes_parking_space: "it drives past the parking space at the destination",
  splashes_pedestrian: "it splashes a pedestrian from a puddle",
  hits_pothole_too_fast: "it hits a pothole too fast",
  drives_into_geese: "it drives into geese crossing the road",
  enters_closed_road: "it drives onto a road closed by barricades",
  ...FEATURE_FLAG_TEXT,
};
export const flagText = (reject) => {
  if (typeof reject !== "string" || !reject) return "unknown road-rule check";
  return Object.hasOwn(FLAG_TEXT, reject) ? FLAG_TEXT[reject] : reject.replaceAll("_", " ");
};
