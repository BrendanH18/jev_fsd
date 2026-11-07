// The exact JSON sent to Jev, and the questions. Numbers are rounded, labels are computed in code,
// and only fields relevant to the situation are included. This is what the JSON panel shows.

import { r1 } from "../common.js";
import { speedVsTarget } from "./candidates.js";
import { STOP_ZONE_M } from "../sim/signals.js";
import { current as weather } from "../sim/weather.js";
import { CLEARING_M, waitsItsTurn } from "./sensors.js";
import { FOLLOW_M } from "../sim/emergency.js";
import { ZONE_HOURS, ZONE_NAMES } from "../sim/speed-zones.js";
import { STEP_OUT_M } from "../sim/hidden-hazards.js";
import { isCyclistPass } from "../sim/cyclist-pass.js";

export const DEFAULT_STYLE = "cautious city driver: obeys limits, stops fully at stop signs, keeps a safe gap, smooth steering, takes turns slowly";
const PREAMBLE = "You are the driving policy of a car in city traffic. Obey traffic controls and drive as described in `driving_style`.";

const gapLabel = (gap, closing) => (gap < 4 || (closing > 0 && gap / closing < 1.5)) ? "dangerous" : gap < 8 ? "short" : gap < 25 ? "comfortable" : "far";
const laneLabel = (d) => Math.abs(d) < 0.3 ? "centered" : Math.abs(d) < 0.8 ? `slightly ${d > 0 ? "right" : "left"}` : `far ${d > 0 ? "right" : "left"}`;
const distLabel = (m) => m < STOP_ZONE_M ? "at" : m < 25 ? "close" : m < 60 ? "approaching" : "far";
const speedVsLimit = (v, limit) => v > limit + 0.5 ? "over" : v > limit - 1 ? "at" : "under";
const laneName = (index, count) => count === 2 ? (index === 0 ? "left" : "right") : index === 0 ? "left" : index === count - 1 ? "right" : count === 3 ? "middle" : `lane ${index + 1} from the left`;
const RIGHT_OF_WAY = { equal: "no sign: give way to traffic from the right", minor: "no sign: give way to the larger road", major: "no sign: the car's road has the right of way" };
const EV_FROM = { behind: "behind", ahead: "ahead, the other way", left: "the left", right: "the right" };
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
    if (snap.nav.turn_round_in_m !== undefined) state.nav.turn_round_in_m = r1(Math.max(0, snap.nav.turn_round_in_m));
  }
  const laneLateral = snap.lane ? snap.lane.lateral : snap.routeProj ? snap.routeProj.lateral : snap.road.lateral;
  state.road = {
    name: snap.road.name || "unnamed", on_road: snap.road.on_road,
    lane_offset_m: r1(laneLateral),
    lane_position: laneLabel(laneLateral),
    heading_error_deg: r1((snap.routeProj ? snap.routeProj.headingErr : snap.road.heading_error) * 180 / Math.PI),
  };
  if (!snap.road.on_road) state.road.distance_to_road_m = r1(snap.road.distance_to_road);
  if (snap.speed_zone) {
    const z = snap.speed_zone;
    state.speed_zone = { kind: z.kind, ...(z.name ? { name: z.name } : {}), limit: r1(z.limit_mps), in_effect: ZONE_HOURS[z.kind],
      ...(z.in_zone ? { in_zone: true } : { starts_in_m: r1(Math.max(0, z.starts_in_m)) }), ...(z.ends_in_m !== null ? { ends_in_m: r1(z.ends_in_m) } : {}) };
  }
  if (snap.bus_lane) state.bus_lane = snap.bus_lane;
  if (snap.turn_restriction) state.turn_restriction = snap.turn_restriction;
  if (snap.traffic_calming) {
    const c = snap.traffic_calming;
    state.traffic_calming = { kind: c.name, speed: r1(c.speed_mps), ...(c.over ? { over: true } : { starts_in_m: r1(Math.max(0, c.starts_in_m)) }) };
  }
  if (snap.sun_glare) {
    const g = snap.sun_glare;
    state.sun_glare = { severity: g.severity, sight_m: g.sight_m, speed_ceiling: r1(g.ceiling_mps), sun_elevation_deg: g.sun_elevation_deg, sun_off_heading_deg: g.off_heading_deg };
  }
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
      ...(i.dark ? { lights_out: true } : {}),
      ...(i.control === "yield" ? { roundabout: true, ring_traffic: i.cross_traffic_moving } : { cross_traffic_moving: i.cross_traffic_moving }),
    };
    if (i.amber) state.intersection.amber = { stop: i.amber.stop, speed_at_observation_mps: r1(i.amber.speed_mps), distance_at_observation_m: r1(i.amber.distance_m), stopping_distance_m: r1(i.amber.stopping_distance_m) };
    if (i.control === "uncontrolled") state.intersection.right_of_way = RIGHT_OF_WAY[i.rule];
    if ((i.control === "signal" || i.control === "stop" || i.control === "uncontrolled") && (i.turn === "left" || i.turn === "uturn" || i.right_on_red)) state.intersection.turn = i.turn;
    if (i.give_way) {
      const g = i.give_way;
      state.intersection.give_way = { clear: g.go, ...(g.wait_for ? { wait_for: g.wait_for.id || g.wait_for.kind } : {}),
        ...(g.view_clear === false ? { view: g.waiting_to_see ? `hidden by \`${g.hidden_by}\`, waiting for it to move` : g.peeked ? "hidden, looked from as far forward as it can go" : g.hidden_by ? `hidden by \`${g.hidden_by}\`` : "hidden by buildings", sees_m: r1(g.sight_m) } : {}),
        ...(g.bumper_to_hold_m !== null ? { stop_in_m: r1(Math.max(0, g.bumper_to_hold_m)) } : {}) };
    }
    if (i.priority) {
      const p = i.priority;
      state.intersection.priority = p.arrived ? { stopped_at_line: true, your_turn: p.go, ...(p.wait_for ? { wait_for: p.wait_for } : {}), ...(p.waiting.length ? { goes_first: p.waiting } : {}) }
        : { stopped_at_line: false, ...(p.waiting.length ? { waiting_at_junction: p.waiting } : {}) };
    }
    if (i.advance) state.intersection.advance = { light: i.advance.light, ...(i.advance.protected ? { protected_left: true } : {}) };
    if (i.no_turn_on_red) state.intersection.no_turn_on_red = true;
    if (i.scramble) state.intersection.scramble = { all_walk: i.scramble.phase !== "dont", ...(i.scramble.phase === "dont" ? { all_walk_in_s: i.scramble.walk_in_s } : { ends_in_s: i.scramble.ends_in_s }), right_on_red: false };
    if (i.left_on_red) {
      const r = i.left_on_red;
      state.intersection.left_on_red = { allowed: true, stop_completed: r.stop_completed, clear: r.clear, ...(r.wait_for ? { wait_for: r.wait_for.id || r.wait_for.kind } : {}) };
    }
    if (i.right_on_red) {
      const r = i.right_on_red, w = r.wait_for;
      state.intersection.right_on_red = { allowed: true, stop_completed: r.stop_completed, clear: r.clear, ...(w ? { wait_for: w.id || w.kind } : {}) };
    }
    if (i.oncoming) {
      const o = i.oncoming, hidden = o.view ? { lane_hidden_by: o.view.hidden_by, sees_lane_m: r1(o.view.sight_m) } : {};
      state.intersection.oncoming = o.id === null ? { ...hidden, needed_s: r1(o.need_s), wait_in_m: r1(Math.max(0, o.bumper_to_yield_m)), yield: true }
        : { id: o.id, arrives_in_s: r1(o.eta_s), needed_s: r1(o.need_s), wait_in_m: r1(Math.max(0, o.bumper_to_yield_m)), yield: true, ...hidden };
    }
  }
  if (snap.following) {
    const f = snap.following;
    state.following = { id: f.id, ...(f.kind !== "car" ? { kind: f.kind } : {}), gap_m: r1(f.gap_m), gap: gapLabel(f.gap_m, f.closing_mps), speed: r1(f.speed), closing_mps: r1(f.closing_mps) };
    if (f.policy) Object.assign(state.following, { target_gap_m: r1(f.policy.target_gap_m), safe_speed_mps: r1(f.policy.safe_speed_mps),
      target_headway_s: r1(f.policy.headway_s), gap: state.following.gap === "dangerous" ? "dangerous" : f.gap_m < f.policy.target_gap_m - 1 ? "short" : "comfortable" });
  }
  if (snap.headlights) state.headlights = { ...snap.headlights };
  if (snap.pxo) state.pxo = { crossing: snap.pxo.id, occupied: true, wait_until: "everyone reaches the far curb across the whole roadway" };
  if (snap.pedestrian) {
    const p = snap.pedestrian;
    state.pedestrian = { crossing_m: r1(Math.max(0, p.bumper_to_crosswalk_m)), distance: distLabel(p.bumper_to_crosswalk_m - 2), in_path: p.to_path_m < 1.8, yield: true, ...(p.mid_block ? { mid_block: true } : {}) };
  }
  if (snap.right_hook) {
    const h = snap.right_hook;
    state.cyclist_on_right = { id: h.id, arrives_in_s: r1(h.eta_s), needed_s: r1(h.need_s), wait_in_m: r1(Math.max(0, h.bumper_to_yield_m)), yield: true };
  }
  if (snap.contraflow_cyclist?.relation === "entering") state.contraflow_street = { street: snap.contraflow_cyclist.street, cyclists_may_come_against_the_traffic: true, can_see_into_it: false, target_speed: r1(snap.contraflow_cyclist.entry_limit_mps) };
  else if (snap.contraflow_cyclist) {
    const c = snap.contraflow_cyclist;
    state.contraflow_cyclist = { id: c.cyclist_id, riding: "against the one-way, as cyclists may on this street", relation: CONTRAFLOW_RELATION[c.relation], ...(c.street ? { street: c.street } : {}),
      lane: c.lane_kind === "shared" ? "no lane: it shares the street" : "a painted contraflow lane on the driver's left", gap_m: r1(c.gap_m), speed: r1(c.speed),
      ...(c.wait ? { yield: true, wait_in_m: r1(Math.max(0, c.bumper_to_stop_m)), ...(c.eta_s !== null ? { arrives_in_s: r1(c.eta_s), needed_s: r1(c.need_s) } : {}) } : {}),
      ...(c.shift_m > 0 ? { move_right_m: r1(c.shift_m) } : {}), min_passing_distance_m: c.min_pass_m };
  }
  if (snap.red_light_runner) {
    const r = snap.red_light_runner;
    state.red_light_runner = { id: r.id, coming_from: r.from, speed: r.speed, ...(r.relation === "in_junction" ? { in_junction: true } : { cannot_stop_before_its_line: true, its_line_in_m: r.to_line_m }),
      ...(r.green_for_s !== null ? { car_green_for_s: r.green_for_s } : {}), ...(r.wait ? { wait: true, wait_in_m: r1(Math.max(0, r.bumper_to_stop_m)) } : {}) };
  }
  if (snap.reversing_vehicle) {
    const r = snap.reversing_vehicle;
    state.reversing_vehicle = { id: r.id, backing_out_of: `a driveway on the ${r.side}`, reverse_lights: r.reverse_lights, now: REVERSING_PHASE[r.phase], gap_m: r1(r.gap_m),
      ...(r.wait ? { yield: true, wait_in_m: r1(Math.max(0, r.bumper_to_stop_m)) } : { slow_to: r1(r.limit_mps) }), min_passing_distance_m: r.min_pass_m };
  }
  if (snap.pothole) {
    const h = snap.pothole;
    state.pothole = { id: h.id, ...(h.starts_in_m > 0 ? { ahead_m: r1(h.starts_in_m) } : { under_car: true }), right_of_lane_centre_m: r1(h.lateral_m), length_m: h.length_m, width_m: h.width_m, depth_cm: h.depth_cm,
      ...(weather.name === "rain" || weather.name === "snow" ? { full_of_water: true } : {}),
      ...(h.room ? { room_in_lane: true, ...(h.shift_m ? { ease_to_m: r1(h.shift_m) } : { between_the_wheels: true }) } : { room_in_lane: false, drive_over_at: r1(h.speed_mps) }),
      ...(snap.potholes_ahead.length > 1 ? { more_ahead: snap.potholes_ahead.length - 1 } : {}) };
  }
  if (snap.ball_in_road) {
    const b = snap.ball_in_road;
    state.ball_in_road = { rolled_out_from: `between the parked cars on the ${b.side}`, gap_m: r1(b.gap_m), ball: b.ball, child: BALL_CHILD[b.child],
      ...(b.limit_mps != null ? { warning: true, slow_to: r1(b.limit_mps), ...(b.cover_left_s != null ? { warning_lifts_in_s: r1(b.cover_left_s) } : {}) } : { warning: false }) };
  }
  if (snap.geese_crossing) {
    const g = snap.geese_crossing;
    state.geese_crossing = { id: g.id, geese: g.geese, ...(g.goslings ? { goslings: g.goslings } : {}), coming_from: g.from, now: GEESE_PHASE[g.phase], on_road: g.on_road,
      ...(g.stopped_on_road ? { standing_in_road: g.stopped_on_road } : {}), gap_m: r1(g.gap_m),
      ...(g.wait ? { wait: true, wait_in_m: r1(Math.max(0, g.bumper_to_stop_m)) } : {}), slow_to: r1(g.limit_mps) };
  }
  if (snap.tailgater) {
    const t = snap.tailgater;
    state.tailgater = { id: t.id, behind_m: r1(t.gap_m), headway_s: t.headway_s, closing_mps: r1(t.closing_mps), ...(t.flashing ? { flashing_headlights: true } : {}),
      brake_no_harder_than_mps2: r1(t.gentle_mps2), ...(t.need_for ? { ahead_requires_mps2: r1(t.need_mps2), because_of: t.need_for } : {}), gap_ahead: "twice the usual",
      ...(t.can_move_right ? { move_right_to_let_it_pass: true } : { lane_to_the_right: t.lane_right }) };
  }
  if (snap.black_ice) {
    const a = snap.black_ice;
    state.black_ice = { id: a.id, on: ICE_WHERE[a.kind], ...(a.name ? { street: a.name } : {}), ...(a.on_ice ? { under_car: true, ends_in_m: r1(Math.max(0, a.ends_in_m)) } : { ahead_m: r1(a.starts_in_m) }),
      length_m: a.length_m, grip: "about a tenth of dry asphalt", safe_speed: r1(a.safe_mps), cross_at: r1(a.speed_mps),
      ...(snap.black_ice_ahead.length > 1 ? { more_ahead: snap.black_ice_ahead.length - 1 } : {}) };
  }
  if (snap.ice_caution) {
    const k = snap.ice_caution, b = k.bridge;
    state.ice_caution = { conditions: k.text, ice_forms_first_on: "bridges, overpasses and shaded stretches", ...(b ? { bridge: { ...(b.name ? { name: b.name } : {}), ...(b.on ? { on_it: true, ends_in_m: r1(Math.max(0, b.ends_in_m)) } : { ahead_m: r1(b.starts_in_m) }), keep_to: r1(k.slow.mps) } } : {}) };
  }
  if (snap.emergency) {
    const e = snap.emergency;
    state.emergency_vehicle = { id: e.id, kind: e.kind, siren: true, coming_from: EV_FROM[e.from], distance_m: r1(e.distance_m), reaches_car_in_s: r1(e.eta_s), seen: e.seen,
      ...(e.lead ? { stuck_behind_car: true } : { pull_over: true, stop_in_m: r1(Math.max(0, e.bumper_to_stop_m)), pull_right_m: r1(e.offset_m), ...(e.clearing ? { clear_junction_first: true } : {}) }) };
  }
  if (snap.bus) state.bus_pulling_out = { id: snap.bus.id, route: snap.bus.ref, gap_m: r1(Math.max(0, snap.bus.gap_m)), wait_in_m: r1(Math.max(0, snap.bus.bumper_to_stop_m)), moving_out: snap.bus.moving_out, yield: true };
  if (snap.crosswalk_stop) {
    const c = snap.crosswalk_stop;
    state.stopped_at_crosswalk = { id: c.id, ...(c.kind !== "car" ? { kind: c.kind } : {}), crosswalk_m: r1(Math.max(0, c.bumper_to_crosswalk_m)), wait_in_m: r1(Math.max(0, c.bumper_to_stop_m)), do_not_pass: true };
  }
  if (snap.school_bus) {
    const b = snap.school_bus;
    state.school_bus = { id: b.id, coming_toward_car: b.relation === "oncoming", lights: b.lights, gap_m: r1(Math.max(0, b.gap_m)),
      ...(b.lights === "red" ? { stop: true, wait_in_m: r1(Math.max(0, b.bumper_to_stop_m)) } : { about_to_stop: true }) };
  }
  if (snap.streetcar) {
    const c = snap.streetcar;
    state.streetcar = { id: c.id, ...(c.ref ? { route: c.ref } : {}), beside_it: c.beside, gap_m: r1(Math.max(0, c.gap_m)),
      ...(c.doors ? { doors_open: true, stop: true, wait_in_m: r1(Math.max(0, c.bumper_to_stop_m)) } : { stopping: true }) };
  }
  if (snap.level_crossing) {
    const x = snap.level_crossing, t = x.train;
    state.level_crossing = { id: x.id, track: x.kind === "tram" ? "streetcar line" : "railway", to_nearest_rail_m: r1(Math.max(0, x.to_rail_m)), ...(x.on_tracks ? { on_tracks: true } : {}),
      ...(t ? { train: { id: t.id, ...(t.on ? { on_crossing: true } : { arrives_in_s: r1(t.eta_s) }), seen: t.seen, heard: t.heard } } : {}),
      ...(x.blocker ? { no_room_past_tracks: true } : {}), ...(x.wait ? { stop: true, wait_for: x.wait === "train" ? "train" : "room", wait_in_m: r1(Math.max(0, x.bumper_to_stop_m)) } : {}) };
  }
  if (snap.junction_box) {
    const b = snap.junction_box;
    state.junction_box = { id: b.id, ...(b.signal ? { signal: b.signal } : {}), no_room_past: true, blocked_by: b.blocker.id, room_past_m: r1(Math.max(0, b.room_m)), needs_m: r1(b.need_m),
      stop: true, wait_in_m: r1(Math.max(0, b.bumper_to_stop_m)) };
  }
  if (snap.work_zone) {
    const w = snap.work_zone;
    state.work_zone = { id: w.id, lane: w.side === "closed" ? "closed: go round through the other lane" : "open", flagger: w.paddle === "stop" ? "STOP" : "SLOW",
      ...(w.bumper_to_stop_m > 0 ? { stop_line_m: r1(w.bumper_to_stop_m) } : {}), one_lane: w.in_one_lane ? "car is in it" : `starts ${r1(Math.max(0, w.one_lane.from_s - snap.routeProj.s - snap.ego.front_m))} m ahead`,
      pass_at: r1(w.limit_mps), ...(w.wait ? { stop: true, wait_in_m: r1(Math.max(0, w.bumper_to_stop_m)) } : {}) };
  }
  if (snap.lane_closure) {
    const l = snap.lane_closure, closed = l.side === "closed";
    state.lane_closure = { id: l.id, closed_lane: l.closed_lane, lane: closed ? (l.merged ? "closed: across into the open lane, past the merge point" : "closed: merge into the open lane at the merge point, in turn") : "open",
      ...(l.merged ? { merge_point: "car is past it" } : { merge_point_m: r1(Math.max(0, l.bumper_to_merge_m)) }), turn: `${l.turn} lane`,
      ...(closed && !l.merged ? { at_merge: l.at_merge, your_turn: l.let_in } : {}), pass_at: r1(l.limit_mps),
      ...(l.wait ? { stop: true, wait_in_m: r1(Math.max(0, l.bumper_to_stop_m)), ...(l.wait_for ? { goes_first: l.wait_for } : {}) } : {}),
      ...(l.let_in_for ? { let_in: l.let_in_for, stop: true, wait_in_m: r1(Math.max(0, l.bumper_to_stop_m)) } : {}) };
  }
  if (snap.double_parked) {
    const d = snap.double_parked, w = d.way;
    state.double_parked = { id: d.van_id, kind: d.kind, ...(d.truck ? { truck: true } : {}), hazards: true, ...(d.gap_m > 0 ? { gap_m: r1(d.gap_m) } : { beside_car: true }),
      way_round: d.going_round ? "car is going round" : w.clear ? "clear" : d.crew_in_road ? "its crew is in the road" : !w.sees_far_enough ? "cannot see far enough" : "oncoming traffic",
      ...(d.crew_in_road && !d.going_round ? { crew_in_road: d.crew_in_road } : {}),
      ...(w.oncoming && !d.going_round ? { oncoming: { id: w.oncoming.id, arrives_in_s: r1(w.oncoming.eta_s) }, needs_s: r1(w.need_s) } : {}),
      ...(d.queued ? { waiting_ahead: d.queued } : {}), pass_at: r1(d.limit_mps),
      ...(d.wait ? { stop: true, wait_in_m: r1(Math.max(0, d.bumper_to_stop_m)) } : { go_round: true }) };
  }
  if (snap.cyclist_pass) {
    const c = snap.cyclist_pass, w = c.way;
    state.cyclist_pass = { id: c.cyclist_id, ...(c.gap_m > 0 ? { gap_m: r1(c.gap_m) } : { beside_car: true }), speed: r1(c.speed), min_passing_distance_m: c.min_pass_m,
      pass: c.going ? (c.go ? "car is passing" : "falling back in behind: the way is no longer clear") : !c.possible ? `not here: ${CYCLIST_NOT_HERE[c.why]}` : c.queued ? "wait in turn" : c.too_close ? "drop back first" : w.clear ? "clear" : !w.sees_far_enough ? "cannot see far enough" : "oncoming traffic",
      ...(w?.oncoming && !c.go ? { oncoming: { id: w.oncoming.id, arrives_in_s: r1(w.oncoming.eta_s) }, needs_s: r1(w.need_s) } : {}),
      ...(c.queued ? { waiting_ahead: c.queued } : {}), pass_at: r1(c.limit_mps),
      ...(c.go ? { go_round: true } : { stay_behind: true, follow_gap_m: c.follow_gap_m }) };
  }
  if (snap.crossing_guard) {
    const g = snap.crossing_guard;
    state.crossing_guard = { id: g.guard_id, crosswalk: g.crosswalk_id, ...(g.school ? { school: g.school } : {}), stop_sign: g.paddle === "up" ? "held up" : "down",
      ...(g.in_road.length ? { in_road: g.in_road } : {}), ...(g.waiting ? { children_waiting: g.waiting } : {}), crosswalk_m: r1(Math.max(0, g.bumper_to_crosswalk_m)),
      ...(g.wait ? { stop: true, wait_in_m: r1(Math.max(0, g.bumper_to_stop_m)) } : {}) };
  }
  if (snap.snow_plow) {
    const p = snap.snow_plow;
    state.snow_plow = { id: p.id, kind: p.kind, lights: "blue and amber, flashing", lane: p.lane === "same" ? "the car's lane" : `a lane to the car's ${p.lane}`,
      ...(p.gap_m > 0 ? { gap_m: r1(p.gap_m) } : p.clear_m > 0 ? { behind_car_m: r1(p.clear_m) } : { beside_car: true }), speed: r1(p.speed), keep_back_m: p.keep_back_m,
      ...(p.turning_left ? { turning_left: true } : {}),
      pass: p.passing ? `car is passing it on the left: back in only ${p.keep_back_m} m ahead of it` : p.holds && !p.may_pass ? "do not pass" : "on the left only" };
  }
  if (snap.roadside_stop) {
    const r = snap.roadside_stop;
    state.roadside_vehicle = { id: r.id, kind: r.name, lights: r.lights, ...(r.gap_m > 0 ? { gap_m: r1(r.gap_m) } : { beside_car: true }), pass_at: r1(r.limit_mps),
      in_lane_next_to_it: r.in_adjacent_lane, ...(r.in_adjacent_lane && r.other_lane ? { move_over: true } : {}) };
  }
  if (snap.blind_spot) {
    const b = snap.blind_spot;
    state.blind_spot = { side: b.side, ...(b.from_m > 0 ? { parked_cars_from_m: r1(b.from_m) } : { beside_car: true }), parked_cars_to_m: r1(Math.max(0, b.to_m)),
      clearance_m: r1(b.gap_m), street: b.why, hides: "the sidewalk: someone may step out from between the parked cars", stop_within_m: STEP_OUT_M, pass_at: r1(b.limit_mps) };
  }
  if (snap.emergency_ahead) state.emergency_vehicle_ahead = { id: snap.emergency_ahead.id, kind: snap.emergency_ahead.kind, gap_m: r1(snap.emergency_ahead.gap_m), keep_back_m: FOLLOW_M };
  if (snap.turnaround) state.turnaround = { under_way: snap.turnaround.phase !== "start", ...(snap.turnaround.phase !== "start" ? { leg: snap.turnaround.phase, legs_done: snap.turnaround.legs } : {}) };
  if (snap.parking) state.parking = parkingState(snap.parking);
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

// Why a cyclist cannot be passed here (sim/cyclist-pass.js planPass), for models.
const CYCLIST_NOT_HERE = { too_fast: "it rides too near the limit to get by quickly", no_room: "there is no room for the car between it and the far side of the oncoming lane",
  junction: "the pass would not be over before the junction ahead", crosswalk: "a marked crosswalk is ahead", level_crossing: "a level crossing is ahead", work_zone: "a work zone is on the street",
  lane_closure: "a lane is closed on the street", double_parked: "a van is double-parked on the street", school_bus: "a school bus is stopped with its red lights flashing",
  streetcar: "a streetcar is stopped ahead", no_room_ahead: "there is no room to move back in ahead of it" };

function outcomeLabel(c, snap) {
  if (c.id === "stop_at_line" && snap.intersection) return `clear, stops ${Math.max(0, r1(snap.intersection.bumper_to_line_m - c.sim.progress_m))} m before the line`;
  if (c.id === "stop_at_destination") return "clear, reaches the destination";
  if (c.law.kind === "turnaround") return "clear, turns the car round";
  if (c.id === "stop_to_turn_round") return "clear, stops where the car turns round";
  if (c.law.kind === "park") return c.law.mode === "out" ? "clear, pulls out of the parking space into the lane" : "clear, parks the car in the space";
  if (c.id === "wait_to_park" && snap.parking) return snap.parking.stop_in_m > 0.3 ? `clear, stops ${Math.max(0, r1(snap.parking.stop_in_m - c.sim.progress_m))} m short of where the car reverses into the space` : "clear, holds still where the car reverses into the space";
  if (c.id === "stop_for_oncoming" && snap.intersection?.oncoming) return `clear, waits ${Math.max(0, r1(snap.intersection.oncoming.bumper_to_yield_m - c.sim.progress_m))} m short of oncoming traffic's path`;
  if (c.id === "yield_to_contraflow_cyclist" && snap.contraflow_cyclist?.wait) return `clear, waits ${Math.max(0, r1(snap.contraflow_cyclist.bumper_to_stop_m - c.sim.progress_m))} m ahead for the cyclist riding against the one-way`;
  if (c.id === "wait_for_runner" && snap.red_light_runner) return `clear, waits ${Math.max(0, r1(snap.red_light_runner.bumper_to_stop_m - c.sim.progress_m))} m ahead, at the line, for the car running the red`;
  if (c.id === "slow_for_ball" && snap.ball_in_road) return `clear, slows to ${r1(c.sim.end_speed)} m/s, able to stop short of where the ball came out`;
  if (c.id === "let_tailgater_pass" && snap.tailgater) return `clear, moves over into the right lane at the car's speed and lets the tailgater by${c.sim.min_gap_m < 8 ? `, ${r1(c.sim.min_gap_m)} m behind a car` : ""}`;
  if (c.id === "ease_off_for_tailgater" && snap.tailgater) return `clear, eases off gently to ${r1(c.sim.end_speed)} m/s so the tailgater can get by, leaving more room ahead`;
  if (c.id === "wait_for_geese" && snap.geese_crossing) return snap.geese_crossing.wait ? `clear, stops ${Math.max(0, r1(snap.geese_crossing.bumper_to_stop_m - c.sim.progress_m))} m short of the geese's way across` : "clear, slows for the geese by the road";
  if (c.id === "yield_to_reversing" && snap.reversing_vehicle) return snap.reversing_vehicle.wait ? `clear, stops ${Math.max(0, r1(snap.reversing_vehicle.bumper_to_stop_m - c.sim.progress_m))} m short of where it waits for the car backing out` : "clear, slows for the car backing out";
  if (c.id === "stop_for_cyclist" && snap.right_hook) return `clear, waits ${Math.max(0, r1(snap.right_hook.bumper_to_yield_m - c.sim.progress_m))} m short of the cyclist's path`;
  if (c.id === "stop_at_crosswalk" && snap.crosswalk_stop) return `clear, stops ${Math.max(0, r1(snap.crosswalk_stop.bumper_to_stop_m - c.sim.progress_m))} m short of the crosswalk, beside the stopped ${snap.crosswalk_stop.kind}`;
  if (c.id === "stop_for_streetcar" && snap.streetcar) return `clear, stops ${Math.max(0, r1(snap.streetcar.bumper_to_stop_m - c.sim.progress_m))} m short of the streetcar's ${snap.streetcar.beside ? "rear doors" : "rear"}`;
  if (c.id === "wait_short_of_junction" && snap.junction_box) return `clear, waits ${Math.max(0, r1(snap.junction_box.bumper_to_stop_m - c.sim.progress_m))} m short of the junction, at the line`;
  if (c.id === "wait_behind_van" && snap.double_parked) return `clear, stops ${Math.max(0, r1(snap.double_parked.bumper_to_stop_m - c.sim.progress_m))} m short of where the car waits behind the double-parked van`;
  if (c.id === "wait_to_merge" && snap.lane_closure) return `clear, stops ${Math.max(0, r1(snap.lane_closure.bumper_to_stop_m - c.sim.progress_m))} m short of the merge point, to wait for the car's turn`;
  if (c.id === "let_merge_in" && snap.lane_closure) return `clear, stops ${Math.max(0, r1(snap.lane_closure.bumper_to_stop_m - c.sim.progress_m))} m short of where it lets \`${snap.lane_closure.let_in_for}\` in`;
  if (c.id === "stop_for_crossing_guard" && snap.crossing_guard) return `clear, stops ${Math.max(0, r1(snap.crossing_guard.bumper_to_stop_m - c.sim.progress_m))} m short of where the car waits for the crossing guard, short of the crosswalk`;
  if (c.id === "stop_for_flagger" && snap.work_zone) return `clear, stops ${Math.max(0, r1(snap.work_zone.bumper_to_stop_m - c.sim.progress_m))} m short of the flagger, at the line`;
  if (c.id === "stop_before_tracks" && snap.level_crossing) return `clear, stops ${Math.max(0, r1(snap.level_crossing.bumper_to_stop_m - c.sim.progress_m))} m short of the level crossing, 7 m back from the nearest rail`;
  if (c.id === "stop_for_school_bus" && snap.school_bus) return `clear, stops ${Math.max(0, r1(snap.school_bus.bumper_to_stop_m - c.sim.progress_m))} m short of the school bus`;
  if (c.id === "yield_to_bus" && snap.bus) return `clear, stops ${Math.max(0, r1(snap.bus.bumper_to_stop_m - c.sim.progress_m))} m behind the bus`;
  if (c.id === "pull_over" && snap.emergency) return snap.emergency.bumper_to_stop_m - c.sim.progress_m > 0.3
    ? `clear, pulls over to the right and stops ${Math.max(0, r1(snap.emergency.bumper_to_stop_m - c.sim.progress_m))} m before its stop` : "clear, pulls over to the right and stops";
  if (c.id === "stop_for_pedestrian" && snap.pedestrian) return `clear, stops ${Math.max(0, r1(snap.pedestrian.bumper_to_crosswalk_m - c.sim.progress_m))} m before the ${snap.pedestrian.mid_block ? "crossing pedestrian" : "crosswalk"}`;
  if (c.id === "follow_cyclist" && snap.cyclist_pass) return `clear, stays behind the cyclist, ${snap.cyclist_pass.follow_gap_m} m back`;
  if (c.id === "ease_round_pothole" && snap.pothole) return `clear, eases ${Math.abs(r1(snap.pothole.shift_m))} m ${snap.pothole.shift_m < 0 ? "left" : "right"} inside the lane so that both wheels miss the pothole, keeping its speed, and back`;
  if (!c.sim.stays_on_road) return c.sim.off_road_fraction > 0.5 ? "leaves the road" : "touches the road edge";
  if (snap.cyclist_pass && isCyclistPass(c.law.detour) && c.law.kind === "lane") return `clear, ${snap.cyclist_pass.going ? "carries on round" : "goes round"} the cyclist through the oncoming lane, at least ${snap.cyclist_pass.min_pass_m} m clear of it, and back into the lane ahead of it`;
  if (c.change?.offer === "move_over" && snap.roadside_stop) return `clear, moves over into the ${c.change.dir} lane, away from the stopped ${snap.roadside_stop.name}${c.sim.min_gap_m < 8 ? `, ${r1(c.sim.min_gap_m)} m behind a car` : ""}`;
  if (c.change) return `clear, ${c.change.offer === "pass" || c.change.prepare ? "moves into" : "moves back into"} the ${c.change.dir} lane${c.sim.min_gap_m < 8 ? `, ${r1(c.sim.min_gap_m)} m behind a car` : ""}`;
  if (!c.sim.stays_in_lane) return "clear, drifts out of lane";
  // (its wheels would cross a pothole: it slows to drive over it, sim/potholes.js)
  if (c.law.slowTo && snap.pothole) return `clear, slows to ${r1(Math.min(...c.law.slowTo.map((x) => x.mps)))} m/s to drive over the pothole`;
  // (black ice it has seen: it eases off to cross it steadily, sim/black-ice.js)
  if (c.id === "slow_for_ice" && snap.black_ice) return snap.black_ice.on_ice ? `clear, eases off to ${r1(snap.black_ice.speed_mps)} m/s without braking and holds steady across the ice` : `clear, eases off early, on the dry road, to ${r1(snap.black_ice.speed_mps)} m/s before the black ice and holds it across, without braking on it`;
  if (c.law.slowTo && snap.black_ice && c.sim.end_speed > 0.5) return `clear, slows to ${r1(snap.black_ice.speed_mps)} m/s by the black ice and holds it across`;
  if (c.sim.min_gap_m < 4) return `clear, but closes to ${r1(c.sim.min_gap_m)} m of a car`;
  return "clear";
}

export function situationClauses(snap) {
  const out = [];
  const i = snap.intersection;
  const m = i ? Math.max(0, Math.round(i.bumper_to_line_m)) : 0;
  const atLine = i && i.bumper_to_line_m < STOP_ZONE_M;
  if (i && i.control === "signal") {
    if (i.signal === "flashing_amber") out.push("Flashing amber: proceed cautiously at no more than 20 km/h, yielding to pedestrians and vehicles already in the junction.");
    else if ((i.clear_entered || i.bumper_to_line_m < -CLEARING_M) && i.signal !== "green") out.push(`The car is already inside the intersection and the signal has turned ${i.signal}: clear the intersection${i.oncoming ? " once oncoming traffic has passed" : ""}.`);
    else if (i.signal === "unknown") out.push(`The signal phase ${m} m ahead is not visible: approach cautiously and stop at the line unless a permitted phase becomes visible.`);
    else if (i.signal === "red" && i.left_on_red) out.push(turnOnRedClause(i, m, atLine, true));
    else if (i.signal === "red" && i.right_on_red) out.push(turnOnRedClause(i, m, atLine));
    else if (i.signal === "red") out.push(atLine ? "The car is at the line and the signal is red: hold still until it turns green." : `The signal ${m} m ahead is red: keep rolling toward the line and stop just before it${i.entered ? ", unless the car has already entered the intersection" : ""}.`);
    else if (i.signal === "yellow") out.push(i.amber
      ? i.amber.stop ? `The signal ${m} m ahead is yellow. A safe stop was possible when amber was first observed: stop before the line and wait for green.`
        : `The signal ${m} m ahead is yellow. The car was too close for a safe stop when amber was first observed: continue carefully if the path is clear, without speeding up above ${r1(i.amber.speed_mps)} m/s. Amber never overrides pedestrians, oncoming traffic or a blocked exit; red does not grant a new entry.`
      : `The signal ${m} m ahead is yellow: stop before the line if that is comfortable, otherwise clear the intersection.`);
    else out.push(snap.red_light_runner ? `The signal ${m} m ahead is green, but a car crossing the car's way is running the red (below).` : `The signal ${m} m ahead is green; proceed unless the path is blocked.`);
    if (i.advance) out.push(advanceClause(i));
    if (i.no_turn_on_red) out.push("A sign prohibits this turn on red. Wait at the line while the signal for this turn is red, even if the cross street is empty; the sign does not prohibit turning on green.");
    if (i.scramble) out.push(scrambleClause(i));
    if (i.oncoming) out.push(oncomingClause(i));
  } else if (i && i.control === "stop") {
    const p = i.priority;
    if (i.signal === "flashing_red") out.push("Flashing red: make a full stop, then yield to the main street until clear. This is a two-way stop, not an all-way stop.");
    if (i.dark) out.push(`The traffic lights at the junction ${i.entered ? "the car is in" : `${m} m ahead`} are out: treat it as an all-way stop. Every driver stops at the line, then goes in turn.`);
    if (!i.stop_completed) {
      if (!p) out.push(atLine ? "The car is at the stop line and the stop is not completed yet: hold still until it is." : `A stop sign is ${m} m ahead: keep rolling toward it, come to a full stop at the line, then go when cross traffic is clear.`);
      else {
        const first = p.waiting.length ? ` ${p.waiting.map((id) => `\`${id}\``).join(", ")} stopped at ${p.waiting.length > 1 ? "their lines" : "its line"} before the car and ${p.waiting.length > 1 ? "go" : "goes"} first.` : "";
        out.push(atLine ? `The car is at the line of an all-way stop and the stop is not completed yet: hold still until it is. Vehicles go in the order they stopped at their lines.${first}` : `An all-way stop is ${m} m ahead: keep rolling toward it and come to a full stop at the line. Vehicles go in the order they stopped at their lines, and one that stops at the same time on the car's right goes first.${first}`);
      }
    } else if (waitsItsTurn(i)) out.push(`The car has stopped at an all-way stop and it is not its turn: \`${p.wait_for}\` goes first, because it stopped first or stopped at the same time on the car's right (or ahead, when the car turns left). Hold still until it has gone.`);
    else if (i.cross_traffic_moving) out.push("The stop is completed but cross traffic is moving through the junction: hold until it is clear.");
    else if (p) out.push("The car has stopped at an all-way stop and it is its turn: go when the junction is clear.");
    else out.push(giveWayClause(i, "The stop is completed", "the through road"));
    if (i.oncoming) out.push(oncomingClause(i));
  } else if (i && i.control === "uncontrolled") {
    if (i.rule === "major") out.push(`The junction ${m} m ahead has no sign or signal, and the car's road has the right of way there.`);
    else {
      const who = i.rule === "equal" ? "traffic coming from the right" : "traffic on the larger road";
      out.push(giveWayClause(i, `The junction ${m} m ahead has no sign or signal, so the car gives way to ${who} and to anything already in the junction`, who));
    }
    if (i.oncoming) out.push(oncomingClause(i));
  } else if (i && i.control === "yield") {
    const exit = snap.nav && snap.nav.exit ? ` and take exit ${snap.nav.exit}` : "";
    if (i.entered) out.push(`The car is in a roundabout: keep circulating counter-clockwise${exit}.`);
    else if (i.cross_traffic_moving) out.push(atLine ? "The car is at a roundabout's yield line and a car in the roundabout has the right of way: hold still until it has passed." : `A roundabout is ${m} m ahead and a car in it has the right of way: slow down and stop at the yield line if it has not passed.`);
    else out.push(`A roundabout is ${m} m ahead and no approaching ring traffic is visible: check sight lines and enter cautiously, go counter-clockwise${exit}.`);
  }
  if (snap.pedestrian && !snap.pxo) {
    const p = snap.pedestrian, m = Math.max(0, Math.round(p.bumper_to_crosswalk_m));
    const where = p.mid_block ? "mid-block, outside a crosswalk" : "in the crosswalk";
    out.push(p.bumper_to_crosswalk_m < STOP_ZONE_M ? `A pedestrian is crossing ${where} right in front of the car: hold still until they have cleared the car's path.` : `A pedestrian is crossing ${where} ${m} m ahead: slow down and stop short of them until they have cleared the car's path.`);
  }
  if (snap.turn_restriction?.banned) out.push("The planned turn is prohibited now: stop before the junction and follow a legal detour.");
  if (snap.speed_zone) {
    const z = snap.speed_zone, kmh = Math.round(z.limit_mps * 3.6), where = z.name ? ` by ${z.name}` : "";
    out.push(z.in_zone
      ? `The car is in a ${ZONE_NAMES[z.kind]}${where}, in effect now (${ZONE_HOURS[z.kind]}): the limit is ${kmh} km/h${z.ends_in_m !== null ? ` for the next ${Math.round(z.ends_in_m)} m` : ""}, and children may step out from between parked cars. Keep to it; \`car.target_speed\` already does.`
      : `A ${ZONE_NAMES[z.kind]}${where}, in effect now (${ZONE_HOURS[z.kind]}), starts ${Math.round(Math.max(0, z.starts_in_m))} m ahead: slow to ${kmh} km/h by its sign; \`car.target_speed\` already does.`);
  }
  if (snap.bus_lane?.in_effect) out.push(`Bus-only lane: stay out except within the final 50 m before a right turn or to park/pull out at the curb.`);
  if (snap.traffic_calming) {
    const c = snap.traffic_calming, kmh = Math.round(c.speed_mps * 3.6);
    out.push(c.over
      ? `The car is going over a ${c.name}: keep to ${kmh} km/h until its rear wheels are over it (\`car.target_speed\` already does).`
      : `A ${c.name} lies across the street ${Math.round(Math.max(0, c.starts_in_m))} m ahead: slow to ${kmh} km/h by the time the car reaches it, and keep to that over it; taken faster it jolts the car and everyone in it. \`car.target_speed\` already does.`);
  }
  if (snap.sun_glare) {
    const g = snap.sun_glare, kmh = Math.round(g.ceiling_mps * 3.6);
    out.push(`The car is driving into a low sun (${g.sun_elevation_deg}° above the horizon, ${g.off_heading_deg}° off its heading): glare washes out signals and people ahead, so the car sees only about ${g.sight_m} m that way. Keep to ${kmh} km/h or less, the speed it can stop from within that, and look for signals and people early (\`car.target_speed\` already does): prefer a candidate whose \`end_speed\` is at or below it, and leave more room.`);
  }
  if (snap.right_hook) out.push(rightHookClause(snap.right_hook));
  if (snap.contraflow_cyclist) out.push(contraflowClause(snap.contraflow_cyclist));
  if (snap.red_light_runner) out.push(runnerClause(snap.red_light_runner));
  if (snap.reversing_vehicle) out.push(reversingClause(snap.reversing_vehicle));
  if (snap.pothole) out.push(potholeClause(snap.pothole, snap.potholes_ahead));
  if (snap.ball_in_road) out.push(ballClause(snap.ball_in_road));
  if (snap.black_ice || snap.ice_caution) out.push(iceClause(snap.black_ice, snap.ice_caution, snap.black_ice_ahead));
  if (snap.geese_crossing) out.push(geeseClause(snap.geese_crossing));
  if (snap.tailgater) out.push(tailgaterClause(snap.tailgater));
  if (snap.emergency) out.push(emergencyClause(snap.emergency));
  if (snap.bus) {
    const b = snap.bus, w = Math.max(0, Math.round(b.bumper_to_stop_m));
    out.push(`Bus \`${b.id}\`${b.ref ? ` (route ${b.ref})` : ""}, stopped ${Math.round(Math.max(0, b.gap_m))} m ahead at a bus stop in the car's lane, is ${b.moving_out ? "pulling out" : "signalling to pull out"} into it. Traffic behind a bus pulling out from a stop must let it out: ${w < 2 ? "hold still behind it until it has pulled out." : `slow down and stop ${w} m ahead, 2 m behind it (\`yield_to_bus\`), until it has pulled out.`}`);
  }
  if (snap.crosswalk_stop) {
    const c = snap.crosswalk_stop, w = Math.max(0, Math.round(c.bumper_to_stop_m));
    out.push(`A ${c.kind} (\`${c.id}\`) in the next lane is ${c.stopped ? "stopped" : "stopping"} at a marked crosswalk ${Math.round(Math.max(0, c.bumper_to_crosswalk_m))} m ahead, maybe for someone crossing whom it hides. A vehicle stopped at a crosswalk must not be passed: ${w < 2 ? "hold still short of the crosswalk and look; once the car has stood still there for 2 s it may go on if nobody is crossing in its path." : `slow down and stop ${w} m ahead, short of the crosswalk (\`stop_at_crosswalk\`), and look before going on.`}`);
  }
  if (snap.school_bus) {
    const b = snap.school_bus, w = Math.max(0, Math.round(b.bumper_to_stop_m)), where = b.relation === "behind" ? `${Math.round(Math.max(0, b.gap_m))} m ahead, going the car's way` : `${Math.round(Math.max(0, b.gap_m))} m ahead, coming toward the car`;
    out.push(b.lights === "red"
      ? `School bus \`${b.id}\`, ${where}, is stopped with its red lights flashing, letting children off; they may cross in front of it, hidden by it. Traffic both ways must stop for it and stay stopped until it moves off or the lights go off: ${w < 2 ? "hold still where the car is." : `slow down and stop ${w} m ahead, short of it (\`stop_for_school_bus\`).`}`
      : `School bus \`${b.id}\`, ${where}, has its amber lights flashing: it is about to stop and let children off, and traffic both ways will have to stop for it. Slow down, ready to stop short of it; \`car.target_speed\` already does.`);
  }
  if (snap.streetcar) {
    const c = snap.streetcar, w = Math.max(0, Math.round(c.bumper_to_stop_m)), name = `Streetcar \`${c.id}\`${c.ref ? ` (route ${c.ref})` : ""}`;
    out.push(c.doors
      ? `${name}, ${Math.round(Math.max(0, c.gap_m))} m ahead ${c.beside ? "in the next lane" : "in the car's lane"}, going the car's way, is stopped with its doors open: its riders cross the street between it and the curb${c.beside ? ", through the car's lane" : ""}. Traffic behind it must not pass it, or come within 2 m of its rear doors, until they close: ${w < 2 ? "hold still where the car is." : `slow down and stop ${w} m ahead (\`stop_for_streetcar\`).`}`
      : `${name}, ${Math.round(Math.max(0, c.gap_m))} m ahead ${c.beside ? "in the next lane" : "in the car's lane"}, going the car's way, is slowing for its stop. Once it stops its doors open, and traffic behind it will have to stop behind its rear doors while its riders cross between it and the curb. Slow down, ready to stop; \`car.target_speed\` already does.`);
  }
  if (snap.level_crossing) out.push(crossingClause(snap));
  if (snap.junction_box) {
    const b = snap.junction_box, w = Math.max(0, Math.round(b.bumper_to_stop_m));
    out.push(`Traffic past the signal ahead (\`${b.id}\`${b.signal ? `, ${b.signal} for the car` : ""}) is stopped, \`${b.blocker.id}\` ${Math.round(Math.max(0, b.room_m))} m past the junction, and leaves no room for the car beyond it (it needs ${Math.round(b.need_m)} m). Even on a green, never enter a junction the car cannot clear: it would block the cross street when the light changes. Wait at the line until there is room: ${w < 2 ? "hold still where the car is." : `stop ${w} m ahead (\`wait_short_of_junction\`).`}`);
  }
  if (snap.crossing_guard) out.push(guardClause(snap.crossing_guard));
  if (snap.work_zone) out.push(workZoneClause(snap));
  if (snap.lane_closure) out.push(closureClause(snap.lane_closure));
  if (snap.pxo) out.push(`An Ontario pedestrian crossover (PXO), with amber warning beacons rather than a traffic signal, is ${Math.max(0, Math.round(snap.pxo.bumper_to_crosswalk_m))} m ahead. Stop 2 m short of its centre (stop_for_pedestrian), and stay stopped until EVERY pedestrian has crossed the WHOLE roadway and reached the far curb, even after your lane clears. The beacons alone do not decide when to go.`);
  if (snap.double_parked) out.push(vanClause(snap));
  if (snap.snow_plow) out.push(plowClause(snap.snow_plow));
  if (snap.cyclist_pass) out.push(cyclistClause(snap.cyclist_pass));
  if (snap.roadside_stop) out.push(roadsideClause(snap));
  if (snap.blind_spot) out.push(blindClause(snap.blind_spot));
  if (snap.emergency_ahead) out.push(`${/^[aeiou]/.test(snap.emergency_ahead.kind) ? "An" : "A"} ${snap.emergency_ahead.kind} with its siren on is ${Math.round(snap.emergency_ahead.gap_m)} m ahead, going the car's way: do not follow it within ${FOLLOW_M} m; \`car.target_speed\` already keeps the car back.`);
  if (snap.following) {
    const label = gapLabel(snap.following.gap_m, snap.following.closing_mps);
    if (snap.following.policy) out.push(`Leave braking room behind the leader: the current gap is ${r1(snap.following.gap_m)} m and the target for this speed and grip is ${r1(snap.following.policy.target_gap_m)} m. Ease off to rebuild a short gap; do not accelerate to close it. Brake harder if needed to avoid a collision.`);
    if (snap.following.kind === "cyclist" && snap.following.gap_m < 30 && !snap.cyclist_pass) out.push("A cyclist is riding ahead in the lane: stay behind it at a safe gap; passing needs at least 1 m of space, and the candidates that would pass too close have already been removed.");
    else if (label === "dangerous" || label === "short") out.push(`The ${snap.following.kind === "parked car" ? "parked car" : "car"} ahead is close; keep a safe gap.`);
  }
  if (snap.parking) out.push(parkingClause(snap.parking));
  if (!snap.turnaround && snap.nav?.turn_round_in_m !== undefined && snap.nav.turn_in_m < 40) out.push(`The route makes a U-turn ${Math.round(snap.nav.turn_in_m)} m ahead, at a dead end: slow down and stop ${Math.max(0, Math.round(snap.nav.turn_round_in_m))} m ahead, where the car will turn round (\`stop_to_turn_round\`), then turn round with a three-point turn.`);
  else if (snap.turnaround) out.push(snap.turnaround.phase === "start"
    ? "The route makes a U-turn here, where the street is too narrow to come round in one sweep: turn round with a three-point turn (`turn_around`), forward and back on full lock at walking pace."
    : "The car is turning round with a three-point turn: carry on with `turn_around` while it is offered, and hold still only to let something go by.");
  else if (snap.nav && snap.nav.next_turn !== "none" && snap.nav.next_turn !== "roundabout" && snap.nav.turn_in_m < 40) out.push(`A ${snap.nav.next_turn === "uturn" ? "U-turn" : snap.nav.next_turn + " turn"} is coming in ${Math.round(snap.nav.turn_in_m)} m; \`car.target_speed\` already accounts for it.`);
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
    // (moved over for a vehicle stopped at the roadside: not until past it)
    else out.push(`The car is in the ${car} lane, but its route continues in the ${route} lane. Choose a \`change_${back}_*\` candidate to return ${snap.roadside_stop && !snap.roadside_stop.in_adjacent_lane ? `once past the ${snap.roadside_stop.name}, ` : snap.snow_plow?.passing ? `once ${snap.snow_plow.keep_back_m} m ahead of the snow plow, ` : ""}when one is offered; the car must be back within ${within} m.`);
  }
  if (snap.roadside?.length) out.push("Parked cars may conceal people or open doors. A visible open door, parking maneuver or pull-out requires extra clearance or slowing; assess the listed candidate outcomes.");
  if (!snap.road.on_road) out.push("The car is off the road; the candidates steer back toward the lane.");
  if (snap.stuck) out.push(`The car has been stopped with nothing blocking it for ${Math.round(snap.stuck.for_s)} s; if the way is clear, drive.`);
  if (snap.nav && snap.nav.remaining_m < 15) out.push("The destination is within reach; stop at it.");
  return out;
}

// Giving way at a two-way stop once the stop is made, or at a junction without a sign or signal.
function giveWayClause(i, lead, who) {
  const g = i.give_way;
  if (!g || g.go) return `${lead}${g?.peeked ? "; the car has crept forward as far as it can to look, and nothing it can see is coming" : g && g.view_clear === false ? "" : ", and nothing it can see would reach the junction before the car can cross it"}: go when the junction is clear.`;
  const at = g.bumper_to_hold_m < 2;
  if (g.wait_for) {
    const what = g.wait_for.kind === "junction" ? `\`${g.wait_for.id}\` is crossing the junction` : `\`${g.wait_for.id}\` has the right of way, or is too close to stop, and would reach the junction before the car could cross it`;
    return `${lead}, but ${what}: ${at ? "hold still until it has passed" : `slow down and stop ${Math.round(g.bumper_to_hold_m)} m ahead until it has passed${g.hold_s_route > i.s_line_route ? " (`wait_to_give_way`)" : ""}`}.`;
  }
  if (g.waiting_to_see) return `${lead}, and the car has crept forward as far as it can to look, but \`${g.hidden_by}\` hides ${who} beyond ${Math.round(g.sight_m)} m: hold still until it moves and the car can see.`;
  return `${lead}, but ${g.hidden_by ? `\`${g.hidden_by}\` hides` : "buildings hide"} ${who} beyond ${Math.round(g.sight_m)} m: slow down so the car can stop, and creep forward to look (\`creep_to_look\`), stopping ${Math.round(Math.max(0, g.bumper_to_hold_m))} m ahead if it still cannot see.`;
}

// Turning left (or around) with oncoming traffic coming, at a signal or a stop sign.
function oncomingClause(i) {
  const o = i.oncoming, w = Math.max(0, Math.round(o.bumper_to_yield_m));
  // (hidden traffic: a vehicle hides an oncoming lane, sim/hidden-traffic.js)
  if (o.id === null) return `The car turns ${i.turn === "uturn" ? "around" : "left"} here and oncoming traffic has the right of way, but \`${o.view.hidden_by}\` hides the oncoming lane beyond ${Math.round(o.view.sight_m)} m, so the car cannot see whether anything is coming through in it. ${w < 2 ? "Hold still until it can see that the lane is clear." : `Slow down and wait ${w} m ahead, short of oncoming traffic's path, until it can see that the lane is clear (\`stop_for_oncoming\`).`}`;
  return `The car turns ${i.turn === "uturn" ? "around" : "left"} here and oncoming traffic has the right of way: \`${o.id}\` reaches the junction in ${r1(o.eta_s)} s, too soon for the car to turn in front of it (it needs ${r1(o.need_s)} s). ${w < 2 ? "Hold still until it has passed." : `Slow down and wait ${w} m ahead, short of its path, until it has passed (\`stop_for_oncoming\`).`}`;
}

// Turning right with a cyclist coming up on the car's right.
function rightHookClause(h) {
  const w = Math.max(0, Math.round(h.bumper_to_yield_m));
  return `The car turns right ahead and cyclist \`${h.id}\` is coming up on its right, going its way: it reaches the corner in ${r1(h.eta_s)} s, too soon for the car to turn across its path (it needs ${r1(h.need_s)} s). A cyclist on the right going straight on has the right of way. ${w < 2 ? "Hold still until it has passed." : `Slow down and wait ${w} m ahead, short of its path, until it has passed (\`stop_for_cyclist\`).`}`;
}

// A pothole in the car's lane ahead (sim/potholes.js).
function potholeClause(h, ahead) {
  const where = h.starts_in_m > 0 ? `${Math.round(h.starts_in_m)} m ahead` : "under the car";
  const side = Math.abs(h.lateral_m) < 0.25 ? "in the middle of the car's lane" : `${r1(Math.abs(h.lateral_m))} m ${h.lateral_m < 0 ? "left" : "right"} of the middle of the car's lane`;
  const water = weather.name === "rain" || weather.name === "snow" ? " It is full of water, so it looks like any puddle." : "";
  const lead = `A pothole \`${h.id}\` ${where}, ${side}, is ${h.width_m} m wide and about ${h.depth_cm} cm deep.${water}`;
  const more = ahead?.length > 1 ? ` ${ahead.length - 1} more ${ahead.length > 2 ? "are" : "is"} further along the lane.` : "";
  if (h.room && !h.shift_m) return `${lead} It lies between the car's wheels: keep to the middle of the lane and drive on.${more}`;
  if (h.room) return `${lead} There is room to go round it inside the lane: choose \`ease_round_pothole\` to ease ${r1(Math.abs(h.shift_m))} m ${h.shift_m < 0 ? "left" : "right"} so that both wheels miss it, keeping its speed, then back to the middle. Never cross a lane line to go round a pothole.${more}`;
  const kmh = Math.round(h.speed_mps * 3.6);
  return `${lead} There is no room to go round it without leaving the lane, so the car must drive over it: slow to ${kmh} km/h by the time the front wheels reach it and keep to that until the rear wheels are over it (\`car.target_speed\` already does). Taken faster, it can burst a tyre or bend a wheel. Never cross a lane line to go round it.${more}`;
}

// What a car backing out of a driveway (sim/driveway-reversers.js) is doing, for models.
const REVERSING_PHASE = { backing_out: "backing out toward the lane, across the sidewalk", backing_into_lane: "backing into the car's lane", stopped_in_lane: "stopped in the car's lane, about to drive off" };

// A car backing out of a driveway ahead (sim/driveway-reversers.js).
function reversingClause(r) {
  const w = Math.max(0, Math.round(r.bumper_to_stop_m ?? 0));
  const lead = `Car \`${r.id}\` ahead, ${Math.round(r.gap_m)} m from where its way meets the car's, is ${REVERSING_PHASE[r.phase]} from a driveway on the ${r.side}${r.reverse_lights ? ", its reverse lights on" : ""}.`;
  if (r.wait) return `${lead} It is coming into the car's lane: give it room to finish. ${w < 2 ? "Hold still until it has driven off." : `Slow down and stop ${w} m ahead (\`yield_to_reversing\`), and stay stopped until it has driven off.`} Never squeeze past behind it.`;
  return `${lead} It may back out into the car's lane at any moment: slow to ${r1(r.limit_mps)} m/s, ready to stop (\`car.target_speed\` already does), and pass it no closer than ${r.min_pass_m} m.`;
}

// Who models are told has come after a ball that rolled into the street (sim/ball-chase.js).
const BALL_CHILD = { not_seen: "not seen yet: may be hidden behind the parked cars", in_road: "in the road after the ball", clear: "back at the kerb" };

// A ball rolled into the street ahead from between parked cars (sim/ball-chase.js).
function ballClause(b) {
  const lead = `A ball has rolled into the street from between the parked cars on the ${b.side}, ${Math.max(0, Math.round(b.gap_m))} m ahead.`;
  if (b.limit_mps == null) return b.child === "clear" ? `${lead} The child who ran out after it is back at the kerb; drive on with care.` : `${lead} The car is past where it came out.`;
  if (b.child === "in_road") return `${lead} A child has run out after it and is in the road: stop for them (\`pedestrian\`), and keep to ${r1(b.limit_mps)} m/s or less (\`car.target_speed\` already does) until they are back at the kerb.`;
  return `${lead} A child may run out after it at any moment, hidden by the parked cars until they are in the road. Choose \`slow_for_ball\` while this warning stands: slow to ${r1(b.limit_mps)} m/s or less (\`car.target_speed\` already does), the speed from which the car can stop short of where the ball came out, and keep to it until the child has come and gone back to the kerb${b.cover_left_s != null ? `, or ${Math.round(b.cover_left_s)} s more pass with no child` : ""}.`;
}

// What a gaggle of Canada geese (sim/geese.js) is doing, for models.
const GEESE_PHASE = { about_to_cross: "on the grass by the road, walking up to the kerb", crossing: "crossing the road in single file", stopped_in_road: "crossing the road in single file, one or more standing still in it" };

// Canada geese by the road ahead, or crossing it (sim/geese.js).
function geeseClause(g) {
  const w = Math.max(0, Math.round(g.bumper_to_stop_m ?? 0));
  const who = `${g.geese} Canada geese${g.goslings ? `, ${g.goslings} of them goslings,` : ""}`;
  const lead = `A gaggle of ${who} ${Math.round(g.gap_m)} m ahead, coming from the ${g.from}, is ${GEESE_PHASE[g.phase]}${g.on_road ? ` (${g.on_road} on the road${g.stopped_on_road ? `, ${g.stopped_on_road} standing still` : ""})` : ""}.`;
  if (g.wait) return `${lead} Stop short of their way across and wait until the last goose is off the road, on the far side, however long they take: never drive through a gap between geese, and never creep toward the file. ${w < 2 ? "Hold still until the last goose is off the road." : `Slow down and stop ${w} m ahead (\`wait_for_geese\`).`}`;
  if (g.phase === "about_to_cross") return `${lead} They may step into the road at any moment: slow to ${r1(g.limit_mps)} m/s, ready to stop for them (\`car.target_speed\` already does).`;
  return `${lead} The car is already at their way across: keep to ${r1(g.limit_mps)} m/s and keep clear of them.`;
}

// A car tailgating the driven car, close behind it in its lane (sim/tailgaters.js).
function tailgaterClause(t) {
  const lead = `Car \`${t.id}\` is tailgating the car, ${Math.max(0, Math.round(t.gap_m))} m behind (${r1(t.headway_s)} s)${t.flashing ? ", flashing its headlights" : ""}: far too close to stop if the car brakes suddenly.`;
  const brake = `Never brake-check it, and never brake harder than ${r1(t.gentle_mps2)} m/s^2 unless something ahead calls for more${t.need_for ? ` (the ${t.need_for} ahead needs ${r1(t.need_mps2)} m/s^2)` : ""}; never speed up to please it either. Leave twice the usual gap to whatever is ahead (\`car.target_speed\` already does), so the car can brake early and gently.`;
  const by = t.can_move_right ? "Another lane goes the car's way on the right and it is clear: choose `let_tailgater_pass` to move over at the car's speed and let it by."
    : "There is no lane to move right into: ease off a little, gently (`ease_off_for_tailgater`, where it is offered), so it can pass when it is safe.";
  return `${lead} ${brake} ${by}`;
}

// Where a patch of black ice (sim/black-ice.js) lies, for models.
const ICE_WHERE = { bridge: "a bridge deck", shade: "a stretch in the shade of tall buildings" };

// Black ice the car has seen, and the caution while conditions favour it (sim/black-ice.js).
function iceClause(a, k, ahead) {
  const caution = k ? `Conditions favour black ice (${k.text}): it forms first on bridges, overpasses and shaded stretches, thin and nearly invisible, while the rest of the road looks dry or damp.` : "";
  const bridge = k?.bridge ? k.bridge.on ? ` The car is on a bridge${k.bridge.name ? ` (${k.bridge.name})` : ""}: keep to ${r1(k.slow.mps)} m/s or less until the end of it, ${Math.max(0, Math.round(k.bridge.ends_in_m))} m on.` : ` A bridge${k.bridge.name ? ` (${k.bridge.name})` : ""} starts ${Math.max(0, Math.round(k.bridge.starts_in_m))} m ahead: ease off to ${r1(k.slow.mps)} m/s before it (\`car.target_speed\` already does).` : "";
  if (!a) return `${caution}${bridge}`;
  const where = `on ${ICE_WHERE[a.kind]}${a.name ? ` (${a.name})` : ""}`;
  const more = ahead?.length > 1 ? ` ${ahead.length - 1} more patch${ahead.length > 2 ? "es are" : " is"} further on.` : "";
  const lead = a.on_ice ? `The car is on black ice ${where}, ${Math.max(0, Math.round(a.ends_in_m))} m from the end of it: its tyres have about a tenth of their grip.` : `The road ${Math.round(a.starts_in_m)} m ahead, ${where}, has a glossy sheen: black ice, ${a.length_m} m of it, where the tyres have about a tenth of their grip.`;
  const how = a.on_ice ? ` Do not brake, accelerate or steer sharply: ease off and hold steady at ${r1(a.speed_mps)} m/s or less until all four wheels are off it (\`slow_for_ice\`, or \`car.target_speed\`). Braking hard here slides the car.`
    : ` Slow down now, on the dry road, to ${r1(a.speed_mps)} m/s by the time the front wheels reach it, then cross it steadily, without braking, accelerating or steering sharply (choose \`slow_for_ice\`; \`car.target_speed\` already slows for it). Leave more room to anything ahead: on the ice the car can hardly stop.`;
  return `${caution}${bridge} ${lead}${how}${more}`.trim();
}

// How a contraflow cyclist (sim/contraflow.js) meets the car's way, for models.
const CONTRAFLOW_RELATION = { turning_in: "coming out of the street the car is about to enter", oncoming: "coming the other way along the car's street",
  turning_off: "coming the other way, across the car's way at the junction ahead", crossing: "coming out of its street, across the car's way" };

// A cyclist riding against a one-way street that allows it (sim/contraflow.js).
function contraflowClause(c) {
  if (c.relation === "entering") return `The car is about to enter ${c.street || "a one-way street"} where cyclists may ride against the traffic, on the driver's left, and it cannot see into it yet: come up slowly, ready to stop short of the junction, and look both ways (\`car.target_speed\` already does).`;
  const w = Math.max(0, Math.round(c.bumper_to_stop_m ?? 0)), where = c.street ? ` on ${c.street}` : "";
  const lead = `Cyclist \`${c.cyclist_id}\` is riding against the one-way${where}, as cyclists may there (${c.lane_kind === "shared" ? "no lane: it shares the street" : "in a painted contraflow lane on the driver's left"}), ${Math.round(c.gap_m)} m away. Look both ways on such a street: a cyclist can come from the "wrong" way.`;
  const hold = w < 2 ? "Hold still until it has gone by." : `Slow down and wait ${w} m ahead (\`yield_to_contraflow_cyclist\`) until it has gone by.`;
  if (c.wait && c.relation === "turning_in") return `${lead} It is coming out of the street the car is about to enter: give way to it before entering, short of the junction. ${hold}`;
  if (c.wait && c.relation === "oncoming") return `${lead} It is coming the other way along the car's street, and there is not room to pass it with the minimum passing distance (${c.min_pass_m} m) even moved over to the right: move over and stop, and let it go by. ${hold}`;
  if (c.wait) return `${lead} Its way crosses the car's ${c.relation === "turning_off" ? "turn at the junction ahead, as oncoming traffic's would" : "way"}, and it would get there first (in ${r1(c.eta_s)} s; the car needs ${r1(c.need_s)} s to be clear): give way to it as to oncoming traffic. ${hold}`;
  return `${lead} It is coming the other way: keep to the right, ${r1(c.shift_m)} m over (the car's candidates already do), leaving it at least ${c.min_pass_m} m as it goes by.`;
}

// A car running the red across the car's way while its light is green (sim/red-light-runner.js).
function runnerClause(r) {
  const w = Math.max(0, Math.round(r.bumper_to_stop_m));
  const fresh = r.green_for_s !== null && r.green_for_s < 4 ? "The car's light has just turned green, but " : "The car's light is green, but ";
  const what = r.relation === "in_junction" ? `car \`${r.id}\` from the ${r.from} has entered the junction on its red and is crossing the car's way` : `car \`${r.id}\` coming from the ${r.from} at ${r1(r.speed)} m/s cannot stop before its red light's line (${Math.round(r.to_line_m)} m away) and will run the red across the car's way`;
  if (!r.wait) return `${fresh}${what}. The car is too close to stop before the line: look both ways and keep clear of it.`;
  return `${fresh}${what}. A green light never makes the way clear: look both ways and let a driver who cannot stop clear the junction first. ${w < 2 ? "Hold still at the line until it has gone through." : `Slow down and stop ${w} m ahead, at the line (\`wait_for_runner\`), until it has gone through.`}`;
}

// An emergency vehicle with its lights and siren on calling on the car to give way.
function emergencyClause(e) {
  const name = `${/^[aeiou]/.test(e.kind) ? "An" : "A"} ${e.kind}`;
  const where = e.from === "behind" ? "coming up behind the car" : e.from === "ahead" ? "coming toward the car" : `coming from the ${e.from}`;
  const lead = `${name} with flashing lights and a siren is ${where}, ${Math.round(e.distance_m)} m away${e.seen ? "" : " (heard, not yet seen)"}. Every driver must give way to it: pull over as close to the right-hand edge of the road as possible, clear of any junction, and stop until it has passed`;
  if (e.lead) return `${lead}. It is stuck behind the car and cannot get past: drive on ahead of it, at the usual speed, and pull over where there is room.`;
  const w = Math.max(0, Math.round(e.bumper_to_stop_m));
  if (w < 2) return `${lead}. The car has pulled over: hold still at the side of the road until it has passed (\`pull_over\`).`;
  return `${lead}. ${e.clearing ? "The car is too close to the junction ahead to stop short of it, or already in it: clear the junction, then " : ""}${e.clearing ? "pull" : "Pull"} over ${r1(e.offset_m)} m to the right and stop ${w} m ahead (\`pull_over\`).`;
}

// An advance green at the signal ahead: a flashing green ball or a green left arrow on the car's
// approach, or one on the approach opposite holding the car on red (sensors.js).
function advanceClause(i) {
  const a = i.advance, left = i.turn === "left" || i.turn === "uturn", way = i.turn === "right" ? "turns right" : "goes straight on";
  if (a.light === "held") return "The approach opposite has an advance green: its left turns cross in front of the car, and oncoming traffic there is protected. The car's light stays red until the advance is over.";
  if (a.light === "flashing_green") return a.protected ? "The light is a flashing green, an advance green: oncoming traffic is held on red, so the car's left turn is protected and need not wait for it." : "The light is a flashing green, an advance green: the car may go; oncoming traffic is held on red.";
  if (a.light === "left_arrow") return a.protected ? "A green left arrow shows: the car's left turn is protected, and oncoming traffic is held on red." : `A green left arrow shows, for left turns only. The car ${way}, so its light is red: do not go with the cars turning left beside it, and wait for its own green.`;
  return left ? i.amber ? "The left arrow has turned yellow: the protected turn is ending. Follow the amber stop decision above; once the arrow goes out, yield to oncoming traffic." : "The left arrow has turned yellow: the protected turn is ending. Stop before the line if that is comfortable; once the arrow goes out, oncoming traffic has the green and the car must yield to it." : `The left arrow beside the car is turning yellow, but it is for left turns only. The car ${way}, and its light is still red.`;
}

// A red light where the car turns right and a right turn on red is allowed after a full stop.
// A scramble crossing (sim/signals.js): an all-walk phase, and no right turn on red.
function scrambleClause(i) {
  const sc = i.scramble, right = i.turn === "right";
  if (sc.phase !== "dont") return `This junction is a scramble crossing, and its all-walk is on: every light is red, and people are crossing every way, diagonally too, for the next ${Math.round(sc.ends_in_s)} s. Wait at the line until the car's own light turns green, and then let anyone still crossing clear the car's path.`;
  return `This junction is a scramble crossing: every light turns red together while people cross every way${right ? ", and there is no right turn on red here: wait at the line for the green, even to turn right" : ", and nobody walks alongside a green"}.`;
}

function turnOnRedClause(i, m, atLine, left = false) {
  const r = left ? i.left_on_red : i.right_on_red, w = r.wait_for;
  const turn = left ? "left" : "right", side = left ? "right" : "left", lane = left ? "leftmost lane" : "curb lane";
  if (r.go) return r.entered ? `The car is turning ${turn} on the red light: complete the turn.` : `The car has stopped fully at the red light and turns ${turn} here, where a ${turn} turn on red is allowed. Nothing it must yield to is in the way: it may turn now, or keep waiting for the green.`;
  if (!r.stop_completed) return atLine ? `The car is at the line and the signal is red. It turns ${turn} here, and a ${turn} turn on red is allowed only after a full stop: hold still until the stop is completed.` : `The signal ${m} m ahead is red and the car turns ${turn} there. A ${turn} turn on red is allowed only after a full stop: keep rolling toward the line and stop just before it.`;
  const why = !w ? "" : w.kind === "pedestrian" ? `: \`${w.id}\` is crossing or about to cross` : w.kind === "view" ? `: ${w.hidden_by ? `\`${w.hidden_by}\` hides the street to its ${side}, and ` : ""}the car cannot see far enough along ${w.hidden_by ? "it" : `the street to its ${side}`} to know it is clear` : w.kind === "junction" ? `: \`${w.id}\` is crossing the junction` : w.kind === "lane" ? `: it can turn on red only from the ${lane}` : w.kind === "advance" ? ": the approach opposite has an advance green, and its protected left turns come into the street the car turns into" : `: \`${w.id}\` is coming from the ${side} and has the green`;
  return `The car has stopped fully at the red light and turns ${turn} here. A ${turn} turn on red is allowed, but it must yield first${why}. Hold still at the line until it is clear or the light turns green.`;
}

// Slowing down and moving over for a vehicle stopped at the roadside with its lights flashing
// (sim/roadside.js).
function roadsideClause(snap) {
  const r = snap.roadside_stop, kmh = Math.round(r.limit_mps * 3.6);
  const where = r.gap_m > 0 ? `${Math.round(r.gap_m)} m ahead on the right` : "beside the car on the right";
  const lead = `A ${r.name} (\`${r.id}\`) is stopped at the roadside ${where} with its ${r.lights} lights flashing; people may be working beside it, at the edge of the lane next to it. Slow to ${kmh} km/h to pass it (\`car.target_speed\` already does)`;
  if (!r.in_adjacent_lane) return `${lead}, and keep out of the lane next to it until past it.`;
  if (!r.other_lane) return `${lead}; there is no other lane going the car's way to move over into, so stay in this one.`;
  const offered = snap.lane && Object.values(snap.lane.sides).some((side) => side.offer === "move_over");
  return offered ? `${lead}, and move over: a \`change_left_*\` candidate moves the car into the lane to its left, away from it. Stay in that lane until past it.`
    : `${lead}. Move over into the lane to the left once that is safe; until then stay in this lane.`;
}

// Cars parked at the kerb that hide the sidewalk beside the car's way (sim/hidden-hazards.js).
function blindClause(b) {
  const kmh = Math.round(b.limit_mps * 3.6), where = b.from_m > 0 ? `from ${Math.round(b.from_m)} m ahead` : "beside the car";
  return `Cars parked along the ${b.side} ${where}, ${r1(b.gap_m)} m from the car's side, hide the sidewalk${b.why === "quiet street" ? " on this quiet street" : ` in this ${b.why}`}: someone could step out from between them, unseen until they do. Keep to ${kmh} km/h beside them, a speed from which the car can stop for someone who steps out ${STEP_OUT_M} m ahead (\`car.target_speed\` already does).`;
}

// A school crossing guard at a crosswalk on the route ahead (sim/crossing-guard.js).
function guardClause(g) {
  const at = Math.max(0, Math.round(g.bumper_to_crosswalk_m)), w = Math.max(0, Math.round(g.bumper_to_stop_m));
  const lead = `A school crossing guard (\`${g.guard_id}\`) works the marked crosswalk ${at < 2 ? "in front of the car" : `${at} m ahead`}${g.school ? `, by ${g.school}` : ""}.`;
  const who = g.in_road.length ? ` ${g.in_road.length === 1 ? "One person is" : `${g.in_road.length} people are`} still in the road (${g.in_road.map((id) => `\`${id}\``).join(", ")}).` : "";
  if (g.wait) return `${lead} The guard ${g.paddle === "up" ? "is holding up the STOP sign" : "has lowered the STOP sign"}, walking children across.${who} Traffic both ways must stop short of the crosswalk and stay stopped until the guard and every child are off the road, not just out of the car's lane: ${w < 2 ? "hold still where the car is." : `slow down and stop ${w} m ahead (\`stop_for_crossing_guard\`).`}`;
  if (g.paddle === "up" || g.in_road.length) return `${lead} The guard is holding up the STOP sign, but the car was too close to stop for it when it went up: go on slowly, giving way to anyone in its path.${who}`;
  if (g.ready) return `${lead} ${g.waiting === 1 ? "A child is" : `${g.waiting} children are`} waiting at the curb with the guard, who will step out with the STOP sign once traffic can stop: slow down, ready to stop short of the crosswalk; \`car.target_speed\` already does.`;
  return `${lead} Nobody is crossing now: go on with care.`;
}

// A work zone with a flagger on the route ahead (sim/work-zone.js).
function workZoneClause(snap) {
  const w = snap.work_zone, at = Math.max(0, Math.round(w.bumper_to_stop_m)), kmh = Math.round(w.limit_mps * 3.6);
  const lead = `A road crew has closed ${w.side === "closed" ? "the car's lane" : "the oncoming lane"} ahead (work zone \`${w.id}\`), leaving one lane for both directions in turn; a flagger ${w.bumper_to_stop_m > 0 ? `${at} m ahead` : "at the line"} holds a paddle that shows ${w.paddle === "stop" ? "STOP" : "SLOW"} to the car.`;
  const round = w.side === "closed" ? " The car's candidates already take it round the work through the other lane, and back into its own past it." : "";
  if (w.wait) return `${lead} Stop at the line and do not go on until the paddle turns to SLOW: traffic coming the other way has the one lane now. ${at < 2 ? "Hold still where the car is." : `Slow down and stop ${at} m ahead (\`stop_for_flagger\`).`}${round}`;
  if (w.paddle === "stop") return `${lead} The car was too close to stop for it when it turned: keep going through the one lane at ${kmh} km/h, with care.${round}`;
  return `${lead} Go on with care at no more than ${kmh} km/h (\`car.target_speed\` already does): the crew works beside the lane.${round}`;
}

// A lane closed ahead by a road crew, where the two lanes zipper merge (sim/lane-closure.js).
function closureClause(l) {
  const kmh = Math.round(l.limit_mps * 3.6), at = Math.max(0, Math.round(l.bumper_to_merge_m)), stop = Math.max(0, Math.round(l.bumper_to_stop_m ?? 0));
  const lead = `A road crew has closed the ${l.closed_lane} lane ahead (lane closure \`${l.id}\`), and its traffic merges into the other lane ${l.merged ? "behind the car" : `${at} m ahead, at the merge point`}: a zipper merge, where drivers use both lanes up to the merge point and then take turns, one from each lane. Keep to ${kmh} km/h through it (\`car.target_speed\` already does).`;
  if (l.side === "closed" && !l.merged) {
    const keep = " Do not change lanes before the merge point: the car's candidates already take it across into the open lane there, once it is let in.";
    if (l.let_in) return `${lead} It is the car's turn and the lane beside it is clear: merge now.${keep}`;
    if (l.wait) return `${lead} It is not the car's turn yet${l.wait_for ? `: \`${l.wait_for}\` in the open lane goes first` : l.at_merge ? ": the open lane is not clear beside it" : ": others in its lane go first"}. Stop at the merge point and wait (${stop < 2 ? "hold still where the car is" : `\`wait_to_merge\`, ${stop} m ahead`}); never force in.${keep}`;
    if (!l.at_merge) return `${lead} Keep to the car's lane up to the merge point, behind anyone ahead in it, and take the car's turn there.${keep}`;
    return `${lead} The car is too close to stop at the merge point: merge with care.${keep}`;
  }
  if (l.merged) return `${lead} The car is past the merge point: carry on through the closure at no more than ${kmh} km/h, and do not change lanes before its end.`;
  if (l.let_in_for) return `${lead} The car is in the open lane, and \`${l.let_in_for}\` in the closed lane has its turn to merge in front of it: let it in. Stop ${stop < 2 ? "where the car is" : `${stop} m ahead (\`let_merge_in\`)`}, short of the merge point, and go once it is across in front of the car. Do not move into the closed lane.`;
  return `${lead} The car is in the open lane: keep to it, and let in the one whose turn it is.`;
}

// A snow plow ahead of the car, or beside it (sim/snow-plow.js).
function plowClause(p) {
  const where = p.lane === "same" ? "in the car's lane" : `in a lane to the car's ${p.lane}`, kmh = Math.round(p.speed * 3.6);
  const lead = `A snow plow (\`${p.id}\`), its blue and amber lamps flashing, is clearing the road ${p.gap_m > 0 ? `${Math.round(p.gap_m)} m ahead` : "beside the car"} ${where}, going the car's way at ${kmh} km/h, throwing snow to its right.`;
  const keep = `Stay at least ${p.keep_back_m} m behind it: \`car.target_speed\` already keeps the car back.`;
  if (p.passing) return `${lead} The car is passing it on the left: carry on past, and move back into its lane only once the car is ${p.keep_back_m} m ahead of it (the candidates offer that only then).`;
  if (p.lane === "right") return p.holds ? `${lead} The road ahead cannot be seen clearly enough to pass it: stay behind it, even in this lane. ${keep}` : `${lead} The car may pass it on the left, in the lane it is in.`;
  if (p.turning_left) return `${lead} It is signalling a left turn: let it turn.`;
  if (p.lane === "left") return `${lead} Never pass a snow plow on the right, the side its blade throws snow and debris: stay behind it in this lane. ${keep}`;
  return `${lead} ${keep} ${p.may_pass ? "Pass it only on the left, through the lane to the car's left (a `change_left_*` candidate, when one is offered), never on the right." : "Do not pass it: the road ahead cannot be seen clearly enough, or there is no lane going the car's way to its left."}`;
}

// A van double-parked in the car's lane ahead (sim/double-parked.js).
function vanClause(snap) {
  const d = snap.double_parked, w = d.way, at = Math.max(0, Math.round(d.bumper_to_stop_m)), kmh = Math.round(d.limit_mps * 3.6);
  const where = d.gap_m > 0 ? `${Math.round(d.gap_m)} m ahead` : "beside the car", it = d.truck ? "the truck" : "the van";
  const lead = d.truck
    ? `A ${d.kind} (\`${d.van_id}\`) is stopped in the car's lane ${where}, its hazard lights flashing, while its crew empties the bins: they walk between its rear and the kerbs, now and then across the street behind it. The only way past is round it through the oncoming lane, and oncoming traffic has the right of way: go round only when the oncoming lane is clear for the whole way round and back, and none of the crew is out in the street.`
    : `A ${d.kind} (\`${d.van_id}\`) is double-parked in the car's lane ${where}, its hazard lights flashing. The only way past is round it through the oncoming lane, and oncoming traffic has the right of way: go round only when the oncoming lane is clear for the whole way round and back.`;
  const round = ` The car's candidates then take it round ${it} through the oncoming lane and back into its own lane past it.`;
  if (d.going_round) return `${lead} The car has started round it: carry on round at no more than ${kmh} km/h (\`car.target_speed\` already does), and back into its own lane past it.`;
  const stop = at < 2 ? "Hold still where the car is." : `Slow down and stop ${at} m ahead, back far enough to pull out round it${d.truck ? " and clear of the crew at its rear" : ""} (\`wait_behind_van\`).`;
  if (d.queued) return `${lead} \`${d.queued}\` is waiting behind it ahead of the car: wait in turn behind it. ${stop}`;
  if (!w.clear) {
    const why = d.crew_in_road ? `\`${d.crew_in_road}\`, one of its crew, is out in the street` : w.oncoming ? `\`${w.oncoming.id}\`, coming the other way, would get there in ${Math.round(w.oncoming.eta_s)} s, and the car needs ${Math.round(w.need_s)} s to get round` : "the car cannot see far enough along the oncoming lane to know it is clear";
    return `${lead} It is not clear now: ${why}. Wait behind ${it} until it is. ${stop}${round}`;
  }
  return `${lead} The oncoming lane is clear for the whole way round now: go round it at no more than ${kmh} km/h (\`car.target_speed\` already does).${round}`;
}

// A cyclist riding in the car's lane ahead, on a two-way street with one lane each way
// (sim/cyclist-pass.js).
function cyclistClause(c) {
  const w = c.way, room = `${c.min_pass_m} m`, kmh = Math.round(c.limit_mps * 3.6);
  const lead = `A cyclist (\`${c.cyclist_id}\`) is riding in the car's lane ${c.gap_m > 0 ? `${Math.round(c.gap_m)} m ahead` : "beside the car"}, at ${Math.round(c.speed * 3.6)} km/h. With one lane each way there is no room to pass it within the lane: passing means moving into the oncoming lane, at least ${room} clear of the cyclist (the minimum passing distance where the limit is ${c.min_pass_m === 1 ? "50 km/h or less" : "over 50 km/h"}), and only when the oncoming lane is clear for the whole pass and back. Never squeeze past it in the lane.`;
  if (c.going && c.go) return `${lead} The car is passing it: carry on round at up to ${kmh} km/h, and back into the lane only well ahead of it; the car's candidates already do.`;
  const behind = ` Stay behind it, ${c.follow_gap_m} m back (\`follow_cyclist\`).`;
  if (c.going) return `${lead} The car had started round it, but the oncoming lane is no longer clear: fall back in behind it.${behind}`;
  if (!c.possible) return `${lead} It cannot be passed here: ${CYCLIST_NOT_HERE[c.why]}.${behind}`;
  if (c.queued) return `${lead} \`${c.queued}\` is behind it, ahead of the car: wait in turn.${behind}`;
  if (c.too_close) return `${lead} The car is too close behind it to pull out with room: drop back first.${behind}`;
  if (!w.clear) {
    const why = w.oncoming ? `\`${w.oncoming.id}\`, coming the other way, would get there in ${Math.round(w.oncoming.eta_s)} s, and the pass takes ${Math.round(w.need_s)} s` : "the car cannot see far enough along the oncoming lane to know it is clear";
    return `${lead} It is not clear now: ${why}.${behind}`;
  }
  return `${lead} The oncoming lane is clear for the whole pass now: pass it (\`pass_cyclist\`), at up to ${kmh} km/h, ${room} clear; the car's candidates take it round through the oncoming lane and back into its own lane ahead of the cyclist.`;
}

function crossingClause(snap) {
  const x = snap.level_crossing, t = x.train, w = Math.max(0, Math.round(x.bumper_to_stop_m));
  const where = `Level crossing \`${x.id}\` (a ${x.kind === "tram" ? "streetcar line" : "railway"}, crossbucks only), ${x.on_tracks ? "under the car: it is on the tracks" : `${Math.round(Math.max(0, x.to_rail_m))} m ahead`}.`;
  const train = t ? ` A ${x.kind === "tram" ? "streetcar" : "train"} \`${t.id}\` is ${t.on ? "on the crossing" : `coming, due in ${Math.round(t.eta_s)} s`} (${t.seen ? "seen" : "heard, ringing its gong"}).` : "";
  if (x.on_tracks) return `${where}${train} Never stop on the tracks: drive on until all of the car is clear of them.`;
  if (x.wait === "train") return `${where}${train} The car must stop no closer than 5 m from the nearest rail and wait until it has passed: ${w < 2 ? "hold still where the car is." : `slow down and stop ${w} m ahead (\`stop_before_tracks\`).`}`;
  if (x.wait === "room") return `${where}${train} Traffic past the tracks is stopped, and leaves no room for the car beyond them: never stop on the tracks. Wait short of them until there is room: ${w < 2 ? "hold still where the car is." : `stop ${w} m ahead (\`stop_before_tracks\`).`}`;
  return `${where}${train} ${t ? "The car cannot stop short of it in time: keep going and clear the tracks." : "No train is coming and there is room past it: cross without stopping on the tracks."}`;
}

// Parking at the destination, or pulling out of the space the car is parked in (sim/parallel-park.js).
function parkingState(p) {
  if (p.mode === "out") return { pulling_out: true, ...(p.phase ? { leg: p.phase, legs_done: p.legs } : {}), ...(p.wait_for ? { wait_for: p.wait_for } : {}) };
  return { space_m: r1(p.length_m), kerb: p.kerb, ...(p.phase ? { under_way: true, leg: p.phase, legs_done: p.legs } : { stop_in_m: r1(Math.max(0, p.stop_in_m)), ...(p.wait_for ? { wait_for: p.wait_for } : {}), ...(p.ready ? { clear_behind: true } : {}) }) };
}

function parkingClause(p) {
  if (p.mode === "out") return p.phase && p.phase !== "out_back" && p.phase !== "out_wait"
    ? "The car is pulling out of the parking space it was parked in: carry on with `pull_out` while it is offered; it hands back to the lane once the car is in it."
    : `The car is parked at the kerb and pulls out of the space to start (\`pull_out\`): it backs up, signals left, and waits until nothing is coming up the lane beside it${p.wait_for ? ` (\`${p.wait_for}\` is coming now)` : ""}; then it pulls out on full lock.`;
  if (p.phase) return "The car is parallel parking in the space at the destination: carry on with `park` while it is offered, and hold still only to let something go by.";
  const at = Math.max(0, Math.round(p.stop_in_m));
  if (p.wait_for) return `There is a space to park in at the destination, on the right. The car is alongside the car in front of it, signalling right, but \`${p.wait_for}\` is behind it, in the way back or coming: hold still where the car is (\`wait_to_park\`) until it is clear behind. Never back into anyone.`;
  if (p.ready) return "There is a space to park in at the destination, on the right, and it is clear behind: park in it with `park`, reversing in on full lock toward the kerb, then the other way.";
  return `There is a space to park in at the destination, on the right, ${Math.round(p.length_m * 10) / 10} m long. Signal right, slow down and stop ${at} m ahead, alongside the car in front of it (\`wait_to_park\`), to reverse into it. The space is the destination now: do not drive on past it.`;
}

export function needsMotionQuestion(snap) {
  return !!((snap.intersection && (snap.intersection.bumper_to_line_m < 30 || snap.intersection.oncoming)) || (snap.following && snap.following.gap_m < 12) || (snap.pedestrian && snap.pedestrian.bumper_to_crosswalk_m < 30) || snap.right_hook || snap.contraflow_cyclist?.wait || snap.red_light_runner?.wait || snap.reversing_vehicle?.wait || snap.geese_crossing?.wait || snap.emergency || snap.bus || snap.crosswalk_stop || snap.school_bus || snap.streetcar || snap.level_crossing?.wait || snap.level_crossing?.on_tracks || snap.junction_box || snap.work_zone?.wait || snap.crossing_guard?.wait || snap.lane_closure?.stop_s_route != null || snap.double_parked?.wait || snap.cyclist_pass || snap.parking
    || snap.roadside?.some((o) => o.kind !== "parked car" && o.ahead < 25) || snap.traffic.some((t) => t.ahead > 0 && t.ahead < 25 && Math.abs(t.right) < 4) || snap.stuck || (snap.nav && snap.nav.remaining_m < 30));
}

// Returns { questions, local } where `local` holds answers resolved without the model.
export function buildQuestions(snap, eligible, meta = {}) {
  const clauses = situationClauses(snap).join(" ");
  const pre = clauses ? `${PREAMBLE} ${clauses}` : PREAMBLE;
  const questions = {};
  const local = {};
  if (snap.headlights) questions.headlights = { type: "choice", instructions: "Which headlight beam should the car use now?", criteria: {
    high: "Use high only when headlights.high_allowed is true: a dark unlit street, no fog or snow, no oncoming vehicle within 150 m and no leading vehicle within 60 m. The observation includes a safety margin for the next decision.",
    low: "Use low when headlights.high_allowed is false: daylight, a lit street, fog or snow, or another road user within the dip distance." } };
  if (needsMotionQuestion(snap)) {
    // Waiting to turn left across oncoming traffic is a reason to hold still only while it applies,
    // so the criteria for every other situation read exactly as before.
    const waitLeft = snap.intersection?.oncoming ? ", when the car is turning left and has reached the point where it waits for oncoming traffic (`intersection.oncoming.wait_in_m` under 2)" : "";
    // A red light the car may turn right on is a reason to hold still only while the turn is not clear.
    const redOk = snap.intersection?.left_on_red?.go ? " (except when intersection.left_on_red.stop_completed and clear are both true: the car may turn left on red)" : snap.intersection?.right_on_red?.go ? " (but not at a red signal where `intersection.right_on_red.stop_completed` and `clear` are both true: the car may turn right on red)" : "";
    // Likewise waiting its turn at an all-way stop.
    const turnWait = waitsItsTurn(snap.intersection) ? ", when the car has stopped at an all-way stop and it is not its turn (`intersection.priority.your_turn` is false)" : "";
    // And giving way at a junction, once the car has reached the point where it waits.
    const giveWait = snap.intersection?.give_way?.wait_for ? ", when the car gives way at a junction and has reached the point where it waits (`intersection.give_way.stop_in_m` under 2)" : "";
    // And letting a cyclist on the right go by before turning right.
    const hookWait = snap.right_hook ? ", when the car turns right and has reached the point where it waits for a cyclist on its right (`cyclist_on_right.wait_in_m` under 2)" : "";
    // And waiting for a cyclist riding against the one-way.
    const contraWait = snap.contraflow_cyclist?.wait ? ", when a cyclist riding against a one-way street is coming and the car has reached the point where it waits for it (`contraflow_cyclist.wait_in_m` under 2)" : "";
    // And waiting at the line on a green for a car running the red.
    const runnerWait = snap.red_light_runner?.wait ? ", when the car's light is green but a car crossing its way is running the red and the car has reached the line it waits at (`red_light_runner.wait_in_m` under 2)" : "";
    // And giving a car backing out of a driveway room to finish.
    const reverseWait = snap.reversing_vehicle?.wait ? ", when a car backing out of a driveway is coming into the car's lane and the car has reached the point where it stops for it (`reversing_vehicle.wait_in_m` under 2)" : "";
    // And waiting for geese crossing the road.
    const geeseWait = snap.geese_crossing?.wait ? ", when Canada geese are crossing the road ahead (`geese_crossing.wait` true) and the car has reached the point where it stops for them (`geese_crossing.wait_in_m` under 2), until the last goose is off the road" : "";
    // And giving way to an emergency vehicle, once pulled over.
    const evWait = snap.emergency && !snap.emergency.lead ? ", when an emergency vehicle is coming and the car has pulled over where it stops for it (`emergency_vehicle.stop_in_m` under 2)" : "";
    // And letting a bus pull out from its stop.
    const busWait = snap.bus ? ", when a bus ahead is pulling out from its stop and the car has stopped behind it (`bus_pulling_out.wait_in_m` under 2)" : "";
    // And looking past a vehicle stopped at a crosswalk before passing it.
    const cwWait = snap.crosswalk_stop ? ", when a vehicle in the next lane is stopped at a crosswalk and the car has stopped short of it (`stopped_at_crosswalk.wait_in_m` under 2)" : "";
    // And waiting for a school bus with its reds flashing.
    const schoolWait = snap.school_bus?.lights === "red" ? ", when a school bus with its red lights flashing is ahead and the car has stopped short of it (`school_bus.wait_in_m` under 2)" : "";
    // And waiting behind a streetcar's open doors.
    const tramWait = snap.streetcar?.doors ? ", when a streetcar ahead has its doors open and the car has stopped behind them (`streetcar.wait_in_m` under 2)" : "";
    // And waiting short of a level crossing.
    const railWait = snap.level_crossing?.wait ? ", when the car has stopped short of a level crossing it must wait at (`level_crossing.wait_in_m` under 2)" : "";
    // And waiting at a signal's line for room past the junction.
    const boxWait = snap.junction_box ? ", when traffic past the junction ahead leaves no room for the car and it has stopped at the line (`junction_box.wait_in_m` under 2), even on a green" : "";
    // And waiting at a work zone's flagger showing STOP.
    const flaggerWait = snap.work_zone?.wait ? ", when a work zone's flagger shows STOP to the car and it has stopped at the line (`work_zone.wait_in_m` under 2)" : "";
    // And waiting for a school crossing guard and the children with them.
    const guardWait = snap.crossing_guard?.wait ? ", when a school crossing guard holds up the STOP sign, or the guard or a child is still in the road, and the car has stopped short of the crosswalk (`crossing_guard.wait_in_m` under 2)" : "";
    // And waiting at a lane closure's merge point for the car's turn, or letting one in there.
    const mergeWait = snap.lane_closure?.wait ? ", when a lane closure's merge point is ahead in the car's lane, it is not the car's turn and it has stopped there (`lane_closure.wait_in_m` under 2)"
      : snap.lane_closure?.let_in_for ? ", when the car is letting a car at a lane closure's merge point in and has stopped for it (`lane_closure.wait_in_m` under 2)" : "";
    // And waiting behind a double-parked van until the way round is clear.
    const vanWait = snap.double_parked?.wait ? ", when a van is double-parked in the car's lane ahead, the oncoming lane is not clear to go round it, and the car has stopped behind it (`double_parked.wait_in_m` under 2)" : "";
    // And waiting to reverse into a space, or to pull out of one, for traffic behind.
    const parkWait = snap.parking?.wait_for ? (snap.parking.mode === "out" ? ", when the car is parked and waiting to pull out for traffic coming up the lane beside it (`parking.wait_for`)" : ", when the car has pulled up to reverse into a parking space and something is behind it (`parking.wait_for`)") : "";
    // Parking, the space is the destination: the car has not reached it until it is parked.
    const parkGoal = snap.parking ? " (while parking, the destination is reached only once the car is parked)" : "";
    questions.motion = {
      type: "choice",
      instructions: `${pre} Decide whether the car should keep moving or hold still right now.`,
      criteria: {
        drive: `Keep moving: cruising, slowing down, or rolling up to a stop line that is not reached yet all count as driving. Use this while safely approaching a line, obstacle, crossing pedestrian (including mid-block), or destination still ahead; slow or brake as needed.${snap.turnaround ? " Turning round (`turn_around`) is driving too, its legs back included." : ""}${snap.parking ? ` ${snap.parking.mode === "out" ? "Pulling out of a parking space (`pull_out`)" : "Parking (`park`)"} is driving too, its legs back included.` : ""}${snap.cyclist_pass ? " Staying behind a cyclist (`follow_cyclist`), at its speed, and passing it (`pass_cyclist`) are driving too." : ""}`,
        stop: `Hold completely still right now. Correct only when the car is already at the line (\`intersection.distance\` is "at") with a red or unseen signal${redOk}, a stop not yet completed, or a roundabout yield line with \`ring_traffic\` true, when a pedestrian is crossing right in front (\`pedestrian.distance\` is "at")${waitLeft}${turnWait}${giveWait}${hookWait}${contraWait}${runnerWait}${reverseWait}${geeseWait}${evWait}${busWait}${cwWait}${schoolWait}${tramWait}${railWait}${boxWait}${flaggerWait}${guardWait}${mergeWait}${vanWait}${parkWait}, when the path directly ahead is blocked, or when the car has reached the destination${parkGoal}.`,
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
