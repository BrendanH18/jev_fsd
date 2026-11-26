import assert from "node:assert/strict";
import { NpcFleet, NpcPath } from "../static/js/sim/npc.js";
import { Vehicle } from "../static/js/sim/vehicle.js";
import { StopMemory } from "../static/js/sim/signals.js";

function fixture() {
  const control = { id: "stop", type: "stop", s_line: 55 };
  const map = {
    edges: new Map([
      ["a", { from: "source", to: "corner", lanes: 2, limit: 12, control }],
      ["b", { from: "corner", to: "destination", lanes: 2, limit: 10 }],
    ]),
    nodes: new Map([["corner", { x: 60, y: 0 }]]),
    lane: () => ({
      pts: [
        [0, 0],
        [60, 0],
      ],
    }),
  };
  const fleet = Object.create(NpcFleet.prototype);
  const actor = new Vehicle(20, 0, 0, 5);
  const rng = () => assert.fail("inspection must not draw random numbers");
  const queue = {
    vehicle: actor,
    junction: "corner",
    edge: "a",
    heading: 0,
    arrived: 7,
    lastB: 0.5,
    turn: "right",
    tick: 10,
    going: true,
    since: 8,
  };
  const slot = { reserved: { owner: actor, sFrom: 30, sTo: 35 } };
  Object.assign(fleet, {
    map,
    vehicles: [actor],
    target: 1,
    pulled: 0,
    nextPull: 1,
    nextPark: 2,
    nextEmergency: -1,
    nextPlow: 18,
    buses: { next: 14, target: 0 },
    streetcars: { next: 15, target: 0 },
    schoolBuses: { next: 16, target: 0 },
    trains: { next: 17, target: 0 },
    plowTarget: 0,
  });
  fleet.world = {
    map,
    npcs: fleet.vehicles,
    ego: new Vehicle(),
    t: 10,
    tick: 10,
    allWay: { entries: new Map([[actor, queue]]) },
    parked: { slots: [slot] },
  };
  const path = new NpcPath(map, rng, { world: fleet.world });
  Object.assign(path, {
    pts: [
      [0, 0],
      [60, 0],
      [120, 0],
    ],
    cum: [0, 60, 120],
    length: 120,
    s: 20,
    edges: [
      { id: "a", lane: 0, to: "corner", limit: 12, sStart: 0, sEnd: 60, control: { ...control } },
      { id: "b", lane: 0, to: "destination", limit: 10, sStart: 60, sEnd: 120, control: null },
    ],
  });
  Object.assign(actor, {
    id: "car_1",
    spec: { ...actor.spec },
    path,
    v0: 12,
    driver: { aMax: 1.5, b: 2, T: 1.2, s0: 2, react: 0.5, lcRate: 1 },
    lead: { gap: -0.5, v: -2 },
    stopMem: Object.assign(new StopMemory(), { state: "completed", controlId: "stop", stoppedFor: 0.7, stops: 1 }),
  });
  return { fleet, actor, queue, slot };
}
const fixtures = [
  // Fleet
  [
    "fleet_world_link",
    ({ fleet }) => {
      fleet.world.npcs = [];
    },
  ],
  [
    "fleet_map_link",
    ({ fleet }) => {
      fleet.world.map = { ...fleet.map };
    },
  ],
  [
    "fleet_ego_member",
    ({ fleet }) => {
      fleet.vehicles.push(fleet.world.ego);
    },
  ],
  [
    "fleet_duplicate_object",
    ({ fleet, actor }) => {
      fleet.vehicles.push(actor);
    },
  ],
  [
    "fleet_duplicate_id",
    ({ fleet, actor }) => {
      fleet.vehicles.push({ ...actor });
    },
  ],
  [
    "fleet_clock",
    ({ fleet }) => {
      fleet.world.t = NaN;
    },
  ],
  [
    "fleet_tick",
    ({ fleet }) => {
      fleet.world.tick = 1.3;
    },
  ],
  [
    "fleet_car_target",
    ({ fleet }) => {
      fleet.target = -1;
    },
  ],
  [
    "fleet_pull_sequence",
    ({ fleet }) => {
      fleet.pulled = 0.5;
    },
  ],
  [
    "fleet_pull_timer",
    ({ fleet }) => {
      fleet.nextPull = Infinity;
    },
  ],
  [
    "fleet_park_timer",
    ({ fleet }) => {
      fleet.nextPark = NaN;
    },
  ],
  [
    "fleet_emergency_timer",
    ({ fleet }) => {
      fleet.nextEmergency = NaN;
    },
  ],
  [
    "fleet_bus_timer",
    ({ fleet }) => {
      fleet.buses.next = NaN;
    },
  ],
  [
    "fleet_tram_timer",
    ({ fleet }) => {
      fleet.streetcars.next = Infinity;
    },
  ],
  [
    "fleet_school_timer",
    ({ fleet }) => {
      fleet.schoolBuses.next = -1;
    },
  ],
  [
    "fleet_train_timer",
    ({ fleet }) => {
      fleet.trains.next = Infinity;
    },
  ],
  [
    "fleet_plow_timer",
    ({ fleet }) => {
      fleet.nextPlow = NaN;
    },
  ],
  [
    "fleet_bus_target",
    ({ fleet }) => {
      fleet.buses.target = -1;
    },
  ],
  [
    "fleet_tram_target",
    ({ fleet }) => {
      fleet.streetcars.target = 0.5;
    },
  ],
  [
    "fleet_school_target",
    ({ fleet }) => {
      fleet.schoolBuses.target = NaN;
    },
  ],
  [
    "fleet_train_target",
    ({ fleet }) => {
      fleet.trains.target = Infinity;
    },
  ],
  [
    "fleet_plow_target",
    ({ fleet }) => {
      fleet.plowTarget = -1;
    },
  ],

  // Actor
  [
    "actor_identity",
    ({ actor }) => {
      delete actor.id;
    },
  ],
  [
    "actor_position",
    ({ actor }) => {
      actor.y = NaN;
    },
  ],
  [
    "actor_heading",
    ({ actor }) => {
      actor.psi = Infinity;
    },
  ],
  [
    "actor_speed",
    ({ actor }) => {
      actor.v = NaN;
    },
  ],
  [
    "actor_lateral_speed",
    ({ actor }) => {
      actor.vy = NaN;
    },
  ],
  [
    "actor_yaw_rate",
    ({ actor }) => {
      actor.r = Infinity;
    },
  ],
  [
    "actor_steering",
    ({ actor }) => {
      actor.delta = Infinity;
    },
  ],
  [
    "actor_pedal",
    ({ actor }) => {
      actor.a = NaN;
    },
  ],
  [
    "actor_signal",
    ({ actor }) => {
      actor.signal = "forward";
    },
  ],
  [
    "actor_spec",
    ({ actor }) => {
      delete actor.spec;
    },
  ],
  [
    "actor_length",
    ({ actor }) => {
      actor.spec.length = 0;
    },
  ],
  [
    "actor_width",
    ({ actor }) => {
      actor.spec.width = -1;
    },
  ],
  [
    "actor_overhang",
    ({ actor }) => {
      actor.spec.rearOverhang = 6;
    },
  ],
  [
    "actor_wheelbase",
    ({ actor }) => {
      actor.spec.wheelbase = 0;
    },
  ],
  [
    "actor_brake",
    ({ actor }) => {
      actor.spec.maxBrake = 0;
    },
  ],
  [
    "actor_cap",
    ({ actor }) => {
      actor.v0 = NaN;
    },
  ],
  [
    "actor_frozen",
    ({ actor }) => {
      actor.frozen = Infinity;
    },
  ],
  [
    "actor_waiting",
    ({ actor }) => {
      actor.waiting = -1;
    },
  ],
  [
    "actor_ready",
    ({ actor }) => {
      actor.ready = NaN;
    },
  ],
  [
    "actor_standoff",
    ({ actor }) => {
      actor.standoff = NaN;
    },
  ],
  [
    "actor_hold",
    ({ actor }) => {
      actor.holdFor = Infinity;
    },
  ],
  [
    "actor_park_wait",
    ({ actor }) => {
      actor.parkWait = NaN;
    },
  ],
  [
    "actor_path",
    ({ actor }) => {
      delete actor.path;
    },
  ],
  [
    "actor_parked",
    ({ actor }) => {
      actor.parked = true;
    },
  ],
  [
    "actor_parking_conflict",
    ({ actor }) => {
      actor.parking = {};
      actor.pull = {};
    },
  ],
  [
    "actor_lane_change_conflict",
    ({ actor }) => {
      actor.parking = {};
      actor.lc = {};
    },
  ],

  // Driver
  [
    "driver_positive_accel",
    ({ actor }) => {
      actor.driver.aMax = 0;
    },
  ],
  [
    "driver_comfort_brake",
    ({ actor }) => {
      actor.driver.b = 0;
    },
  ],
  [
    "driver_headway",
    ({ actor }) => {
      actor.driver.T = -1;
    },
  ],
  [
    "driver_standstill_gap",
    ({ actor }) => {
      actor.driver.s0 = -1;
    },
  ],
  [
    "driver_reaction",
    ({ actor }) => {
      actor.driver.react = Infinity;
    },
  ],
  [
    "driver_lane_change_rate",
    ({ actor }) => {
      actor.driver.lcRate = NaN;
    },
  ],

  // Path
  [
    "path_map",
    ({ fleet, actor }) => {
      actor.path.map = { ...fleet.map };
    },
  ],
  [
    "path_points",
    ({ actor }) => {
      actor.path.pts = [[0, 0]];
    },
  ],
  [
    "path_cumulative_size",
    ({ actor }) => {
      actor.path.cum.pop();
    },
  ],
  [
    "path_cumulative_origin",
    ({ actor }) => {
      actor.path.cum[0] = 1;
    },
  ],
  [
    "path_length",
    ({ actor }) => {
      actor.path.length = -1;
    },
  ],
  [
    "path_length_table",
    ({ actor }) => {
      actor.path.length = 130;
    },
  ],
  [
    "path_progress",
    ({ actor }) => {
      actor.path.s = NaN;
    },
  ],
  [
    "path_progress_range",
    ({ actor }) => {
      actor.path.s = 130;
    },
  ],
  [
    "path_edges",
    ({ actor }) => {
      actor.path.edges = [];
    },
  ],
  [
    "path_constraints_world",
    ({ actor }) => {
      actor.path.constraintsWorld = {};
    },
  ],
  [
    "path_random",
    ({ actor }) => {
      actor.path.random = null;
    },
  ],

  // Point
  [
    "path_point_shape",
    ({ actor }) => {
      actor.path.pts[1] = [60];
    },
    "vertex_index",
    1,
  ],
  [
    "path_point_coordinate",
    ({ actor }) => {
      actor.path.pts[1][0] = NaN;
    },
    "vertex_index",
    1,
  ],
  [
    "path_distance_sample",
    ({ actor }) => {
      actor.path.cum[1] = NaN;
    },
    "vertex_index",
    1,
  ],
  [
    "path_distance_order",
    ({ actor }) => {
      actor.path.cum[1] = -1;
    },
    "vertex_index",
    1,
  ],
  [
    "path_distance_geometry",
    ({ actor }) => {
      actor.path.cum[1] = 50;
    },
    "vertex_index",
    1,
  ],

  // Edge
  [
    "path_edge_record",
    ({ actor }) => {
      actor.path.edges[1] = null;
    },
    "edge_index",
    1,
  ],
  [
    "path_edge_unmapped",
    ({ actor }) => {
      actor.path.edges[1].id = "missing";
    },
    "edge_index",
    1,
  ],
  [
    "path_edge_lane",
    ({ actor }) => {
      actor.path.edges[1].lane = 3;
    },
    "edge_index",
    1,
  ],
  [
    "path_edge_lane_geometry",
    ({ fleet }) => {
      fleet.map.lane = (id) => (id === "a" ? {} : null);
    },
    "edge_index",
    1,
  ],
  [
    "path_edge_interval",
    ({ actor }) => {
      actor.path.edges[1].sEnd = -1;
    },
    "edge_index",
    1,
  ],
  [
    "path_edge_order",
    ({ actor }) => {
      actor.path.edges[1].sStart += 2;
    },
    "edge_index",
    1,
  ],
  [
    "path_edge_connection",
    ({ fleet }) => {
      fleet.map.edges.get("b").from = "other";
    },
    "edge_index",
    1,
  ],
  [
    "path_edge_end",
    ({ actor }) => {
      actor.path.edges[1].sEnd -= 5;
    },
    "edge_index",
    1,
  ],
  [
    "path_edge_destination",
    ({ actor }) => {
      actor.path.edges[1].to = "wrong";
    },
    "edge_index",
    1,
  ],
  [
    "path_edge_limit",
    ({ actor }) => {
      actor.path.edges[1].limit = 0;
    },
    "edge_index",
    1,
  ],
  [
    "path_edge_limit_mapped",
    ({ actor }) => {
      actor.path.edges[1].limit = 99;
    },
    "edge_index",
    1,
  ],
  [
    "path_edge_control_presence",
    ({ actor }) => {
      actor.path.edges[1].control = { type: "stop", id: "stop", s_line: 20 };
    },
    "edge_index",
    1,
  ],
  [
    "path_edge_control_identity",
    ({ actor }) => {
      actor.path.edges[0].control.id = "wrong";
    },
    "edge_index",
    0,
  ],
  [
    "path_edge_control_type",
    ({ actor }) => {
      actor.path.edges[0].control.type = "go";
    },
    "edge_index",
    0,
  ],
  [
    "path_edge_control_point",
    ({ actor }) => {
      actor.path.edges[0].control.s_line = NaN;
    },
    "edge_index",
    0,
  ],
  [
    "path_edge_control_stale",
    ({ actor }) => {
      actor.path.edges[0].control.s_line += 1;
    },
    "edge_index",
    0,
  ],

  // Maneuver
  [
    "lane_change_direction",
    ({ actor }) => {
      actor.lc = { dir: 1, to: 1, edge: "a", width: 3.5, t: 0, T: 3.5 };
      actor.lc.dir = 0;
    },
  ],
  [
    "lane_change_lane",
    ({ actor }) => {
      actor.lc = { dir: 1, to: 1, edge: "a", width: 3.5, t: 0, T: 3.5 };
      actor.lc.to = 8;
    },
  ],
  [
    "lane_change_edge",
    ({ actor }) => {
      actor.lc = { dir: 1, to: 1, edge: "a", width: 3.5, t: 0, T: 3.5 };
      actor.lc.edge = "missing";
    },
  ],
  [
    "lane_change_adjacency",
    ({ actor }) => {
      actor.lc = { dir: 1, to: 1, edge: "a", width: 3.5, t: 0, T: 3.5 };
      actor.lc.to = 0;
    },
  ],
  [
    "lane_change_width",
    ({ actor }) => {
      actor.lc = { dir: 1, to: 1, edge: "a", width: 3.5, t: 0, T: 3.5 };
      actor.lc.width = 0;
    },
  ],
  [
    "lane_change_duration",
    ({ actor }) => {
      actor.lc = { dir: 1, to: 1, edge: "a", width: 3.5, t: 0, T: 3.5 };
      actor.lc.T = 0;
    },
  ],
  [
    "lane_change_elapsed",
    ({ actor }) => {
      actor.lc = { dir: 1, to: 1, edge: "a", width: 3.5, t: 0, T: 3.5 };
      actor.lc.t = -1;
    },
  ],
  [
    "lane_change_cooldown",
    ({ actor }) => {
      actor.lcCooldown = NaN;
    },
  ],
  [
    "pull_offset",
    ({ actor }) => {
      actor.pull = { lat: 3, T: 3.5, t: 0, wait: 1 };
      actor.pull.lat = NaN;
    },
  ],
  [
    "pull_duration",
    ({ actor }) => {
      actor.pull = { lat: 3, T: 3.5, t: 0, wait: 1 };
      actor.pull.T = 0;
    },
  ],
  [
    "pull_elapsed",
    ({ actor }) => {
      actor.pull = { lat: 3, T: 3.5, t: 0, wait: 1 };
      actor.pull.t = -1;
    },
  ],
  [
    "pull_wait",
    ({ actor }) => {
      actor.pull = { lat: 3, T: 3.5, t: 0, wait: 1 };
      actor.pull.wait = Infinity;
    },
  ],
  [
    "backoff_distance",
    ({ actor }) => {
      actor.backoff = { left: 5, t: 1 };
      actor.backoff.left = Infinity;
    },
  ],
  [
    "backoff_timer",
    ({ actor }) => {
      actor.backoff = { left: 5, t: 1 };
      actor.backoff.t = NaN;
    },
  ],
  [
    "parking_distance",
    ({ actor, slot }) => {
      actor.parking = { slot, start: 20, end: 34, lat: 3, t: 1 };
      actor.parking.end = 1;
    },
  ],
  [
    "parking_side",
    ({ actor, slot }) => {
      actor.parking = { slot, start: 20, end: 34, lat: 3, t: 1 };
      actor.parking.lat = NaN;
    },
  ],
  [
    "parking_timer",
    ({ actor, slot }) => {
      actor.parking = { slot, start: 20, end: 34, lat: 3, t: 1 };
      actor.parking.t = -1;
    },
  ],
  [
    "parking_slot",
    ({ actor, slot }) => {
      actor.parking = { slot, start: 20, end: 34, lat: 3, t: 1 };
      actor.parking.slot = {};
    },
  ],
  [
    "parking_owner",
    ({ actor, slot }) => {
      actor.parking = { slot, start: 20, end: 34, lat: 3, t: 1 };
      actor.parking.slot.reserved.owner = {};
    },
  ],
  [
    "parking_occupant",
    ({ actor, slot }) => {
      actor.parking = { slot, start: 20, end: 34, lat: 3, t: 1 };
      actor.parking.slot.occupant = {};
    },
  ],

  // Queue
  [
    "stop_queue_key",
    ({ queue }) => {
      queue.vehicle = {};
    },
    "queue",
    true,
  ],
  [
    "stop_queue_junction",
    ({ queue }) => {
      queue.junction = "missing";
    },
    "queue",
    true,
  ],
  [
    "stop_queue_edge",
    ({ queue }) => {
      queue.edge = "missing";
    },
    "queue",
    true,
  ],
  [
    "stop_queue_heading",
    ({ queue }) => {
      queue.heading = Infinity;
    },
    "queue",
    true,
  ],
  [
    "stop_queue_arrival",
    ({ queue }) => {
      queue.arrived = 20;
    },
    "queue",
    true,
  ],
  [
    "stop_queue_progress",
    ({ queue }) => {
      queue.lastB = NaN;
    },
    "queue",
    true,
  ],
  [
    "stop_queue_turn",
    ({ queue }) => {
      queue.turn = "unknown";
    },
    "queue",
    true,
  ],
  [
    "stop_queue_tick",
    ({ queue }) => {
      queue.tick = 20;
    },
    "queue",
    true,
  ],
  [
    "stop_queue_departure",
    ({ queue }) => {
      queue.since = -1;
    },
    "queue",
    true,
  ],

  // Leader
  [
    "leader_gap",
    ({ actor }) => {
      actor.lead.gap = Infinity;
    },
  ],
  [
    "leader_speed",
    ({ actor }) => {
      actor.lead.v = NaN;
    },
  ],

  // Memory
  [
    "stop_memory_state",
    ({ actor }) => {
      actor.stopMem.state = "ready";
    },
  ],
  [
    "stop_memory_time",
    ({ actor }) => {
      actor.stopMem.stoppedFor = NaN;
    },
  ],
  [
    "stop_memory_count",
    ({ actor }) => {
      actor.stopMem.stops = -1;
    },
  ],
  [
    "stop_memory_control",
    ({ actor }) => {
      actor.stopMem.controlId = null;
    },
  ],
  [
    "actor_record",
    ({ fleet }) => {
      fleet.vehicles.push(null);
    },
    "vehicle_index",
    1,
  ],
  [
    "stop_queue_record",
    ({ fleet, actor }) => {
      fleet.world.allWay.entries.set(actor, null);
    },
    "queue",
    true,
  ],
];

{
  const { fleet, actor, queue } = fixture();
  const snapshot = fleet.inspectTraffic();
  assert.equal(snapshot.issues.length, 0, JSON.stringify(snapshot.issues));
  assert.equal(snapshot.tick, 10);
  assert.equal(snapshot.time_s, 10);
  assert.equal(snapshot.vehicle_count, 1);
  assert.equal(fleet.world.allWay.entries.get(actor) === queue, true);
  assert.equal(actor.stopMem.completed, true);
}

for (const [code, damage, field, expected] of fixtures) {
  const state = fixture();
  damage(state);
  const issues = state.fleet.inspectTraffic().issues;
  const issue = issues.find((each) => each.code === code);
  assert.ok(Boolean(issue), `${code}: got ${issues.map((each) => each.code).join(", ")}`);
  if (field) assert.equal(issue[field], expected, code);
  if (!code.startsWith("fleet_") && code !== "actor_identity" && code !== "actor_record")
    assert.equal(issue.vehicle_id, "car_1", code);
  assert.equal(typeof JSON.stringify(issues), "string", code);
}
console.log(`${fixtures.length} traffic invariant fixtures passed`);
