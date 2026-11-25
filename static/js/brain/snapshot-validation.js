// Optional diagnostics for completed, in-memory snapshots. Core readers can carry actor and
// route references. Inspect just the values consumed by sensing, planning, and display.
const finite = Number.isFinite;
const time = (n) => finite(n) && n >= 0;
const positive = (n) => finite(n) && n > 0;
const integer = Number.isSafeInteger;
const count = (n) => integer(n) && n >= 0;
const extended = (n) => time(n) || n === Infinity;
const bool = (value) => typeof value === "boolean";
const string = (value) => typeof value === "string";
const text = (value) => string(value) && value.trim().length > 0;
const id = (value) => text(value) || integer(value);
const object = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const array = Array.isArray;
const strings = (values) => array(values) && Array.from(values).every(text);
const xy = (value) => array(value) && value.length === 2 && finite(value[0]) && finite(value[1]);
const angle = (n) => finite(n) && Math.abs(n) <= Math.PI;
const oneOf =
  (...options) =>
  (value) =>
    options.includes(value);
const turn = oneOf("none", "straight", "left", "right", "uturn", "roundabout");
const control = oneOf("signal", "stop", "yield", "uncontrolled");
const schoolLights = oneOf("amber", "red");
const railWait = oneOf(null, "room", "train");
const parkingMode = oneOf("in", "out");
const speed = time;
const whole = (n) => integer(n) && n > 0;
const nullable = (check) => (value) => value === null || check(value);
const optional = (check) => (value) => value === undefined || check(value);

const root = {
  t: [time, "simulation time"],
  tick: [count, "physics tick"],
  limit: [speed, "effective speed ceiling"],
  onRoute: [bool, "route-following verdict"],
  control_line_m: [nullable(finite), "nearest control-line offset"],
  ego: [object, "ego reading"],
  road: [object, "road reading"],
  visibility: [object, "visibility reading"],
  target: [object, "speed target"],
  route: [nullable(object), "active route"],
  routeProj: [nullable(object), "route projection"],
  nav: [nullable(object), "navigation reading"],
  lane: [nullable(object), "current lane reading"],
  traffic: [array, "visible traffic list"],
  roadside: [array, "roadside observation list"],
};
const ego = {
  x: [finite, "ego easting"],
  y: [finite, "ego northing"],
  psi: [finite, "ego heading"],
  v: [finite, "signed ego speed"],
  front_m: [positive, "front axle-reference distance"],
};
const road = {
  on_road: [bool, "road-surface verdict"],
  distance_to_road: [extended, "unsigned road-surface distance"],
  s: [time, "road station"],
  lateral: [finite, "signed offset from the street"],
  heading_error: [angle, "error relative to the road heading"],
  limit: [speed, "posted or zoned limit"],
};
const visibility = {
  range_m: [extended, "sight range"],
  safe_speed_mps: [speed, "speed safe within sight"],
  clear_path_m: [optional(finite), "visible route distance"],
};
const target = {
  v: [speed, "commanded target speed"],
  reasons: [strings, "ordered speed-reason labels"],
};
const routeProj = {
  s: [time, "rear-axle route station"],
  lateral: [finite, "signed lateral route offset"],
  headingErr: [angle, "signed heading difference from the route"],
  distance: [time, "unsigned projection distance"],
  point: [xy, "nearest point on the route"],
  index: [count, "route segment index"],
};
const nav = {
  next_turn: [turn, "next-exit turn direction"],
  exit: [nullable(count), "roundabout exit number"],
  turn_in_m: [finite, "distance to the next turn"],
  remaining_m: [time, "distance remaining"],
  turn_round_in_m: [optional(finite), "turnaround start offset"],
};
const nav_destination = {
  right: [finite, "destination lateral coordinate"],
  ahead: [finite, "destination longitudinal coordinate"],
};
const lane = {
  lanes: [whole, "same-direction lane count"],
  index: [count, "current lane index"],
  route_index: [count, "route lane index"],
  delta: [integer, "signed lane-index difference"],
  center: [finite, "tracked lane center offset"],
  until_s: [nullable(finite), "tracked lane end station"],
  lateral: [finite, "signed offset from the tracked lane"],
  shift: [nullable(object), "active lane shift"],
  from_center: [nullable(finite), "lane-change origin center"],
};
const lane_shift = {
  start: [finite, "lane-change start station"],
  len: [positive, "lane-change length"],
};
const intersection = {
  id: [id, "approached control ID"],
  control: [control, "control type"],
  signal: [nullable(text), "displayed signal phase"],
  bumper_to_line_m: [finite, "signed front-bumper distance to the control line"],
  s_line_route: [finite, "station of the control line"],
  entered: [bool, "junction entry verdict"],
  turn: [turn, "controlled turn direction"],
  stop_completed: [nullable(bool), "stop completion memory"],
  all_way: [nullable(bool), "all-way stop designation"],
  cross_traffic_moving: [bool, "crossing-traffic verdict"],
};
const intersection_priority = {
  arrived: [bool, "stop-queue arrival"],
  go: [bool, "stop-queue right of way"],
  waiting: [array, "queued vehicles"],
};
const intersection_give_way = {
  rule: [text, "junction priority rule"],
  need_s: [nullable(time), "required crossing time"],
  sight_m: [nullable(time), "unobstructed sight distance"],
  peek_s_route: [finite, "peek-point station"],
  peeked: [bool, "peek completion flag"],
  hold_s_route: [nullable(finite), "give-way hold station"],
  bumper_to_hold_m: [nullable(finite), "front-bumper distance to the give-way hold"],
  go: [bool, "give-way clearance verdict"],
};
const following = {
  id: [id, "lead-vehicle ID"],
  gap_m: [finite, "signed bumper gap to the leader"],
  speed: [finite, "lead vehicle speed"],
  closing_mps: [finite, "signed following closing speed"],
  s: [finite, "projected lead position"],
};
const rear_follower = {
  gap_m: [finite, "signed gap to the rear vehicle"],
  closing_mps: [finite, "rear-vehicle closing speed"],
};
const pedestrian = {
  id: [id, "pedestrian ID"],
  bumper_to_crosswalk_m: [finite, "front-bumper distance to the pedestrian crossing"],
  s_route: [finite, "pedestrian crossing station"],
  to_path_m: [time, "pedestrian distance to the route"],
  speed: [finite, "pedestrian speed"],
};
const right_hook = {
  id: [id, "cyclist ID for a right-turn conflict"],
  eta_s: [time, "cyclist time to the conflict"],
  need_s: [time, "time needed to clear the cyclist"],
  yield_s_route: [finite, "right-hook yield station"],
  bumper_to_yield_m: [finite, "front-bumper distance to the right-hook yield"],
};
const emergency = {
  id: [id, "emergency call ID"],
  distance_m: [time, "distance to the emergency vehicle"],
  eta_s: [time, "time to the emergency vehicle"],
  seen: [bool, "emergency-vehicle visibility"],
  stop_s_route: [nullable(finite), "pull-over stop station"],
  bumper_to_stop_m: [nullable(finite), "signed distance to the pull-over stop"],
  offset_m: [finite, "lateral pull-over target"],
  steer_at_stop: [bool, "pull-over steering-at-stop directive"],
  max_speed_mps: [speed, "pull-over speed envelope"],
  clearing: [bool, "junction clearing flag during a pull-over"],
  lead: [bool, "drive-on authorization"],
};
const emergency_ahead = {
  gap_m: [time, "gap to the emergency leader"],
  speed: [speed, "emergency leader speed"],
};
const school_bus = {
  lights: [schoolLights, "school-bus warning-light colour"],
};
const streetcar = {
  doors: [bool, "streetcar door state"],
};
const level_crossing = {
  wait: [railWait, "level-crossing hold reason"],
};
const speed_zone = {
  limit_mps: [speed, "school or playground speed limit"],
  in_zone: [bool, "current zone membership"],
  starts_in_m: [finite, "signed distance to the zone start"],
};
const parking = {
  mode: [parkingMode, "parking direction"],
  phase: [nullable(text), "active parking phase"],
  legs: [count, "parking direction-change count"],
  executing: [bool, "parking execution flag"],
  idle_s: [time, "elapsed parking idle time"],
};
const turnaround = {
  legs: [count, "turnaround leg count"],
  executing: [bool, "turnaround execution flag"],
  idle_s: [optional(time), "elapsed turnaround idle time"],
};
const stuck = {
  for_s: [positive, "elapsed stalled time"],
};
const current_path_hazard = {
  in_s: [time, "time to predicted contact"],
};

const sections = {
  ego,
  road,
  visibility,
  target,
  routeProj,
  nav,
  "nav.destination": nav_destination,
  lane,
  "lane.shift": lane_shift,
  intersection,
  "intersection.priority": intersection_priority,
  "intersection.give_way": intersection_give_way,
  following,
  rear_follower,
  pedestrian,
  right_hook,
  emergency,
  emergency_ahead,
  school_bus,
  streetcar,
  level_crossing,
  speed_zone,
  parking,
  turnaround,
  stuck,
  current_path_hazard,
};

const matches = (a, b) => Math.abs(a - b) <= 1e-6;

// Validate only completed snapshots. A diagnostic should distinguish a missing section
// from malformed readings within it and keep going so one capture can reveal several problems.
export function snapshotIssues(snapshot) {
  if (!object(snapshot)) return ["snapshot: expected a sensing record"];
  const issues = [];
  const check = (record, fields, prefix = "") => {
    for (const [key, [accept, label]] of Object.entries(fields)) {
      if (!accept(record[key])) issues.push(`${prefix}${key}: invalid ${label}`);
    }
  };
  const issue = (present, path, reason) => {
    if (present) issues.push(`${path}: ${reason}`);
  };
  check(snapshot, root);
  for (const [path, fields] of Object.entries(sections)) {
    const record = path.split(".").reduce((base, key) => base?.[key], snapshot);
    if (object(record)) check(record, fields, `${path}.`);
    else if (record != null && !Object.hasOwn(root, path)) issue(true, path, "expected a sensing record");
  }

  const {
    ego: car,
    road: street,
    lane: current,
    route: active,
    routeProj: projection,
    intersection: control,
  } = snapshot;
  const front = finite(projection?.s) && finite(car?.front_m) ? projection.s + car.front_m : NaN;
  issue(object(active) && !positive(active.length), "route.length", "expected a positive route length");
  issue(!active && snapshot.onRoute === true, "onRoute", "route following requires an active route");
  issue(object(active) && !object(projection), "routeProj", "active route requires a projection");
  issue(object(active) && !object(snapshot.nav), "nav", "active route requires navigation");
  issue(object(active) && !object(current), "lane", "active route requires lane sensing");
  issue(!active && !!projection, "routeProj", "projection requires an active route");
  issue(
    positive(active?.length) && finite(projection?.s) && projection.s > active.length + 1e-6,
    "routeProj.s",
    "station exceeds route length",
  );
  issue(
    extended(street?.distance_to_road) && bool(street?.on_road) && street.on_road !== street.distance_to_road < 1,
    "road.on_road",
    "disagrees with the road-surface distance",
  );
  issue(
    whole(current?.lanes) && count(current?.index) && current.index >= current.lanes,
    "lane.index",
    "index is outside the current street",
  );
  issue(
    whole(current?.lanes) && count(current?.route_index) && current.route_index >= current.lanes,
    "lane.route_index",
    "route index is outside the current street",
  );
  issue(
    count(current?.index) &&
      count(current?.route_index) &&
      integer(current?.delta) &&
      current.index - current.route_index !== current.delta,
    "lane.delta",
    "does not match the difference between current and route lane indexes",
  );
  issue(!current?.shift && finite(current?.from_center), "lane.from_center", "origin center requires a lane shift");
  issue(
    finite(control?.bumper_to_line_m) && bool(control?.entered) && control.entered !== control.bumper_to_line_m < 0,
    "intersection.entered",
    "disagrees with the position of the front bumper",
  );
  const relativeStation = (record, station, relative, path) => {
    if (finite(front) && finite(record?.[station]) && finite(record?.[relative])) {
      issue(!matches(record[station] - front, record[relative]), path, "does not match the reported route station");
    }
  };
  relativeStation(control, "s_line_route", "bumper_to_line_m", "intersection.bumper_to_line_m");
  relativeStation(snapshot.pedestrian, "s_route", "bumper_to_crosswalk_m", "pedestrian.bumper_to_crosswalk_m");
  relativeStation(snapshot.right_hook, "yield_s_route", "bumper_to_yield_m", "right_hook.bumper_to_yield_m");
  const give = control?.give_way;
  issue(
    object(give) && (give.hold_s_route === null) !== (give.bumper_to_hold_m === null),
    "intersection.give_way",
    "hold station and bumper distance must be present together",
  );
  const call = snapshot.emergency;
  issue(
    call?.lead === true && (call.stop_s_route !== null || call.bumper_to_stop_m !== null),
    "emergency.lead",
    "drive-on authorization cannot also require a pull-over stop",
  );
  issue(
    object(call) && (call.stop_s_route === null) !== (call.bumper_to_stop_m === null),
    "emergency",
    "stop station and bumper distance must be present together",
  );
  const leader = snapshot.following;
  issue(
    finite(car?.v) &&
      finite(leader?.speed) &&
      finite(leader?.closing_mps) &&
      !matches(car.v - leader.speed, leader.closing_mps),
    "following.closing_mps",
    "does not match the difference between ego and leader speeds",
  );
  return issues;
}
