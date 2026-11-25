import assert from "node:assert/strict";
import { buildSnapshot, snapshotIssues } from "../static/js/brain/sensors.js";
import { MapData } from "../static/js/map/mapdata.js";
import { Route } from "../static/js/map/route.js";
import { World } from "../static/js/sim/world.js";
import { CAR } from "../static/js/sim/vehicle.js";

const sections = [
  [
    "",
    [
      ["t", 0, -1],
      ["tick", 0, 0.25],
      ["limit", 3, -1],
      ["onRoute", true, 1],
      ["control_line_m", -1, NaN],
      ["ego", {}, []],
      ["road", {}, []],
      ["visibility", {}, []],
      ["target", {}, []],
      ["route", {}, []],
      ["routeProj", {}, []],
      ["nav", {}, []],
      ["lane", {}, []],
      ["traffic", [], {}],
      ["roadside", [], {}],
    ],
  ],
  [
    "ego",
    [
      ["x", -1, NaN],
      ["y", -1, NaN],
      ["psi", -1, NaN],
      ["v", -1, NaN],
      ["front_m", 2, NaN],
    ],
  ],
  [
    "road",
    [
      ["on_road", true, 1],
      ["distance_to_road", Infinity, -Infinity],
      ["s", 0, -1],
      ["lateral", -1, NaN],
      ["heading_error", Math.PI, 4],
      ["limit", 3, -1],
    ],
  ],
  [
    "visibility",
    [
      ["range_m", Infinity, -Infinity],
      ["safe_speed_mps", 3, -1],
      ["clear_path_m", -1, NaN],
    ],
  ],
  [
    "target",
    [
      ["v", 3, -1],
      ["reasons", ["road limit"], [""]],
    ],
  ],
  [
    "routeProj",
    [
      ["s", 0, -1],
      ["lateral", -1, NaN],
      ["headingErr", Math.PI, 4],
      ["distance", 0, -1],
      ["point", [0, 1], [1]],
      ["index", 0, 0.25],
    ],
  ],
  [
    "nav",
    [
      ["next_turn", "straight", "invalid"],
      ["exit", 0, 0.25],
      ["turn_in_m", -1, NaN],
      ["remaining_m", 0, -1],
      ["turn_round_in_m", -1, NaN],
    ],
  ],
  [
    "nav.destination",
    [
      ["right", -1, NaN],
      ["ahead", -1, NaN],
    ],
  ],
  [
    "lane",
    [
      ["lanes", 1, 0],
      ["index", 0, 0.25],
      ["route_index", 0, 0.25],
      ["delta", 0, 1.2],
      ["center", -1, NaN],
      ["until_s", -1, NaN],
      ["lateral", -1, NaN],
      ["shift", {}, []],
      ["from_center", -1, NaN],
    ],
  ],
  [
    "lane.shift",
    [
      ["start", -1, NaN],
      ["len", 2, NaN],
    ],
  ],
  [
    "intersection",
    [
      ["id", "actor-1", ""],
      ["control", "stop", "invalid"],
      ["signal", "reading", ""],
      ["bumper_to_line_m", -1, NaN],
      ["s_line_route", -1, NaN],
      ["entered", true, 1],
      ["turn", "straight", "invalid"],
      ["stop_completed", true, 1],
      ["all_way", true, 1],
      ["cross_traffic_moving", true, 1],
    ],
  ],
  [
    "intersection.priority",
    [
      ["arrived", true, 1],
      ["go", true, 1],
      ["waiting", [], {}],
    ],
  ],
  [
    "intersection.give_way",
    [
      ["rule", "reading", ""],
      ["need_s", 0, -1],
      ["sight_m", 0, -1],
      ["peek_s_route", -1, NaN],
      ["peeked", true, 1],
      ["hold_s_route", -1, NaN],
      ["bumper_to_hold_m", -1, NaN],
      ["go", true, 1],
    ],
  ],
  [
    "following",
    [
      ["id", "actor-1", ""],
      ["gap_m", -1, NaN],
      ["speed", -1, NaN],
      ["closing_mps", -1, NaN],
      ["s", -1, NaN],
    ],
  ],
  [
    "rear_follower",
    [
      ["gap_m", -1, NaN],
      ["closing_mps", -1, NaN],
    ],
  ],
  [
    "pedestrian",
    [
      ["id", "actor-1", ""],
      ["bumper_to_crosswalk_m", -1, NaN],
      ["s_route", -1, NaN],
      ["to_path_m", 0, -1],
      ["speed", -1, NaN],
    ],
  ],
  [
    "right_hook",
    [
      ["id", "actor-1", ""],
      ["eta_s", 0, -1],
      ["need_s", 0, -1],
      ["yield_s_route", -1, NaN],
      ["bumper_to_yield_m", -1, NaN],
    ],
  ],
  [
    "emergency",
    [
      ["id", "actor-1", ""],
      ["distance_m", 0, -1],
      ["eta_s", 0, -1],
      ["seen", true, 1],
      ["stop_s_route", -1, NaN],
      ["bumper_to_stop_m", -1, NaN],
      ["offset_m", -1, NaN],
      ["steer_at_stop", true, 1],
      ["max_speed_mps", 3, -1],
      ["clearing", true, 1],
      ["lead", true, 1],
    ],
  ],
  [
    "emergency_ahead",
    [
      ["gap_m", 0, -1],
      ["speed", 3, -1],
    ],
  ],
  ["school_bus", [["lights", "red", "green"]]],
  ["streetcar", [["doors", true, 1]]],
  ["level_crossing", [["wait", "train", "amber"]]],
  [
    "speed_zone",
    [
      ["limit_mps", 3, -1],
      ["in_zone", true, 1],
      ["starts_in_m", -1, NaN],
    ],
  ],
  [
    "parking",
    [
      ["mode", "in", "across"],
      ["phase", "reading", ""],
      ["legs", 0, 0.25],
      ["executing", true, 1],
      ["idle_s", 0, -1],
    ],
  ],
  [
    "turnaround",
    [
      ["legs", 0, 0.25],
      ["executing", true, 1],
      ["idle_s", 0, -1],
    ],
  ],
  ["stuck", [["for_s", 2, NaN]]],
  ["current_path_hazard", [["in_s", 0, -1]]],
];

// Deliberately break just one field on a complete section, then require a diagnostic at its path.
for (const [section, fields] of sections) {
  const parts = section ? section.split(".") : [];
  const record = Object.fromEntries(fields.map(([name, value]) => [name, value]));
  const wrap = (value) => parts.reduceRight((child, key) => ({ [key]: child }), value);
  for (const [name, , invalid] of fields) {
    const path = section ? `${section}.${name}` : name;
    const prefix = `${path}: invalid `;
    assert.equal(
      snapshotIssues(wrap(record)).some((entry) => entry.startsWith(prefix)),
      false,
      path,
    );
    assert.equal(
      snapshotIssues(wrap({ ...record, [name]: invalid })).some((entry) => entry.startsWith(prefix)),
      true,
      path,
    );
  }
}

const points = [
  [0, 0],
  [80, 0],
  [160, 0],
];
const map = new MapData({
  bbox: [0, 0, 1, 1],
  extent: [0, -6, 160, 6],
  nodes: [
    { id: "a", x: 0, y: 0 },
    { id: "b", x: 160, y: 0 },
  ],
  edges: [
    {
      id: "in",
      from: "a",
      to: "b",
      pts: points,
      length: 160,
      lanes: 1,
      lane_width: 3.5,
      width: 3.5,
      lane_offsets: [0],
      asphalt: [-1.75, 1.75],
      cls: "residential",
      limit: 13.9,
      oneway: true,
    },
  ],
  lanes: [{ edge: "in", idx: 0, pts: points }],
  intersections: [],
  stops: [],
  buildings: [],
});
const world = new World(map, { parked: 0, pedestrians: 0 });
world.route = new Route({ polyline: points, edges: ["in"], lanes: [0], turns: [] }, map);
world.ego.x = 30;
world.ego.v = 6;
const snapshot = buildSnapshot(world, null, { validate: true });
const front = snapshot.routeProj.s + CAR.length - CAR.rearOverhang;
const control = {
  id: "stop",
  control: "stop",
  signal: null,
  bumper_to_line_m: 5,
  s_line_route: front + 5,
  entered: false,
  turn: "straight",
  stop_completed: false,
  all_way: false,
  cross_traffic_moving: false,
};
const giveWay = { hold_s_route: front + 1, bumper_to_hold_m: 1 };
const emergency = { lead: true, stop_s_route: null, bumper_to_stop_m: null };
const projected = (overrides) => ({ ...snapshot.routeProj, ...overrides });

const inconsistent = [
  ["snapshot", null, "expected a sensing record"],
  ["intersection.priority", { intersection: { priority: "arrived" } }, "expected a sensing record"],
  ["route.length", { route: { length: 0 } }, "expected a positive route length"],
  ["onRoute", { route: null }, "route following requires an active route"],
  ["routeProj", { routeProj: null }, "active route requires a projection"],
  ["nav", { nav: null }, "active route requires navigation"],
  ["lane", { lane: null }, "active route requires lane sensing"],
  ["routeProj", { route: null, onRoute: false }, "projection requires an active route"],
  ["routeProj.s", { routeProj: projected({ s: world.route.length + 1 }) }, "station exceeds route length"],
  ["road.on_road", { road: { on_road: true, distance_to_road: 1 } }, "disagrees with the road-surface distance"],
  ["lane.index", { lane: { ...snapshot.lane, index: 1 } }, "index is outside the current street"],
  ["lane.route_index", { lane: { ...snapshot.lane, route_index: 1 } }, "route index is outside the current street"],
  [
    "lane.delta",
    { lane: { ...snapshot.lane, delta: 1 } },
    "does not match the difference between current and route lane indexes",
  ],
  ["lane.from_center", { lane: { ...snapshot.lane, from_center: 0 } }, "origin center requires a lane shift"],
  [
    "intersection.entered",
    { intersection: { ...control, entered: true } },
    "disagrees with the position of the front bumper",
  ],
  [
    "intersection.bumper_to_line_m",
    { intersection: { ...control, s_line_route: front + 6 } },
    "does not match the reported route station",
  ],
  [
    "pedestrian.bumper_to_crosswalk_m",
    { pedestrian: { s_route: front + 9, bumper_to_crosswalk_m: 8 } },
    "does not match the reported route station",
  ],
  [
    "right_hook.bumper_to_yield_m",
    { right_hook: { yield_s_route: front + 4, bumper_to_yield_m: 0 } },
    "does not match the reported route station",
  ],
  [
    "intersection.give_way",
    { intersection: { ...control, give_way: { ...giveWay, bumper_to_hold_m: null } } },
    "hold station and bumper distance must be present together",
  ],
  [
    "emergency.lead",
    { emergency: { ...emergency, stop_s_route: front, bumper_to_stop_m: 0 } },
    "drive-on authorization cannot also require a pull-over stop",
  ],
  [
    "emergency",
    { emergency: { ...emergency, lead: false, bumper_to_stop_m: 0 } },
    "stop station and bumper distance must be present together",
  ],
  [
    "following.closing_mps",
    { following: { speed: world.ego.v - 2, closing_mps: 3 } },
    "does not match the difference between ego and leader speeds",
  ],
];
for (const [path, overrides, reason] of inconsistent) {
  assert.equal(snapshotIssues(overrides && { ...snapshot, ...overrides }).includes(`${path}: ${reason}`), true, path);
}

const heading = world.ego.psi;
world.ego.psi = Infinity;
assert.throws(() => buildSnapshot(world), /Snapshot needs a finite ego heading/);
world.ego.psi = heading;

const project = world.route.project.bind(world.route);
world.route.project = (...args) => ({ ...project(...args), heading: Infinity });
assert.throws(() => buildSnapshot(world), /Route projection needs a finite heading/);
world.route.project = project;

world.ego.v = NaN;
assert.equal(Number.isNaN(buildSnapshot(world).ego.v), true);
assert.throws(() => buildSnapshot(world, null, { validate: true }), /ego.v: invalid signed ego speed/);
world.ego.v = 6;

assert.equal(snapshotIssues(buildSnapshot(world)).length, 0);
world.route = null;
assert.equal(snapshotIssues(buildSnapshot(world, null, { validate: true })).length, 0);
world.ego.x = 1e6;
const offRoad = buildSnapshot(world, null, { validate: true });
assert.equal(offRoad.road.distance_to_road, Infinity);
assert.equal(offRoad.road.on_road, false);
console.log("Snapshot field and consistency diagnostics passed.");
