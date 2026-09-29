// Reproducible decision cases built with the production sensing, prediction and question code.
// Browser tests compare these against committed JSON used by scripts/verify_jev.py.
import { MapData } from "../js/map/mapdata.js";
import { Route } from "../js/map/route.js";
import { World } from "../js/sim/world.js";
import { Vehicle, BIKE } from "../js/sim/vehicle.js";
import { PED } from "../js/sim/pedestrians.js";
import { setWeather } from "../js/sim/weather.js";
import { buildSnapshot } from "../js/brain/sensors.js";
import { sampleCandidates, simulateAll } from "../js/brain/candidates.js";
import { toJevState, buildQuestions } from "../js/brain/state.js";

export function fixtureWorld({ weather = "dry", buildings = [] } = {}) {
  const map = new MapData({ extent: [-1, -10, 201, 10], buildings,
    nodes: [{ id: "a", x: 0, y: 0 }, { id: "b", x: 200, y: 0 }],
    edges: [{ id: "street", from: "a", to: "b", pts: [[0, 0], [200, 0]], length: 200,
      cls: "residential", lanes: 1, lane_offsets: [0], lane_width: 3.5, asphalt: [-5, 5],
      parking: [0, 0], limit: 13.9, name: "Test Street" }],
    lanes: [{ edge: "street", idx: 0, pts: [[0, 0], [200, 0]] }], intersections: [], stops: [], roundabouts: [],
  });
  const world = new World(map, { parked: 0, pedestrians: 0, weather });
  world.ego = new Vehicle(20, 0, 0, 5);
  world.route = new Route({ id: "straight", polyline: [[0, 0], [200, 0]], edges: ["street"], turns: [], summary: "straight" }, map);
  return world;
}

export function crossingPedestrian(x, y = 0, midBlock = true) {
  const ped = new Vehicle(x, y, -Math.PI / 2, 1.3, PED);
  ped.id = "ped_test"; ped.kind = "pedestrian";
  ped.crossing = { from: [x, 6], to: [x, -6], jaywalk: midBlock };
  return ped;
}

export function buildRealismCases() {
  const cases = [];
  const capture = (name, world, expect) => {
    const snap = buildSnapshot(world), candidates = sampleCandidates(snap, world);
    const { eligible, rejected } = simulateAll(candidates, snap, world);
    const state = toJevState(snap, candidates, { rejected });
    const { questions, local } = buildQuestions(snap, eligible);
    cases.push({ name, state, questions, local, expect });
  };
  for (const midBlock of [true, false]) {
    for (const at of [false, true]) {
      const world = fixtureWorld();
      if (at) world.ego.v = 0;
      world.crowd.list = [crossingPedestrian(at ? 25 : 46, 0, midBlock)];
      capture(`${midBlock ? "mid_block" : "crosswalk"}_${at ? "at" : "approach"}`, world, { motion: at ? "stop" : "drive", motion_min_p: 0.7 });
    }
  }
  {
    const world = fixtureWorld();
    world.crowd.list = [crossingPedestrian(25, -5)];
    capture("mid_block_cleared", world, { motion_absent: true, vector_not_in: ["hard_brake", "keep_lane_stop"] });
  }
  {
    const world = fixtureWorld({ weather: "fog" });
    const car = new Vehicle(65, 0, 0, 0); car.id = "unseen_car";
    world.npcs = [car];
    capture("fog_unseen_traffic", world, { motion_absent: true, vector_not_in: ["keep_lane_limit"] });
  }
  {
    const world = fixtureWorld({ buildings: [{ pts: [[30, -6], [35, -6], [35, 6], [30, 6]], h: 8 }] });
    const car = new Vehicle(44, 0, 0, 0); car.id = "hidden_car";
    world.npcs = [car];
    capture("building_hidden_traffic", world, { motion_absent: true });
  }
  {
    const world = fixtureWorld();
    const car = new Vehicle(38, -2.6, 0, 0); car.id = "parked_test"; car.curb = "right";
    world.parked.add(car);
    const door = world.parked.openDoor(car); door.t = 1; world.parked.poseDoor(door);
    capture("open_door", world, { motion: "drive", motion_min_p: 0.6 });
  }
  for (const activity of ["parking", "pull"]) {
    const world = fixtureWorld();
    const car = new Vehicle(42, -1.5, 0, 2); car.id = "active_car"; car[activity] = {}; car.signal = activity === "parking" ? "right" : "left";
    world.npcs = [car];
    capture(activity === "parking" ? "parking_car" : "pulling_out", world, { motion: "drive", motion_min_p: 0.6 });
  }
  {
    const world = fixtureWorld();
    const bike = new Vehicle(42, 0, 0, 4, BIKE); bike.id = "bike_test"; bike.kind = "bike";
    world.npcs = [bike];
    capture("cyclist_ahead", world, { motion: "drive", motion_min_p: 0.6, vector_not_in: ["hard_brake"] });
  }
  setWeather("dry");
  return cases;
}
