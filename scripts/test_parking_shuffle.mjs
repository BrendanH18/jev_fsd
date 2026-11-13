// Parallel parking (sim/parallel-park.js): with neither swing to square up having the room, the car moves a
// little way straight and swings again, rather than giving up. Kitsilano city seed 1 with parking (s1-12):
// on Vine Street the first arc into a 7.32 m space overshot to 35.7 degrees, the second arc's front corner
// would have come within CLEAR_M of the car in front, the swing the other way was blocked by it too, and
// the car gave up ("stuck") after one leg, 0.95 m off the kerb at 33.5 degrees.
// node --experimental-default-type=module scripts/test_parking_shuffle.mjs
import assert from "node:assert/strict";
globalThis.document = { querySelector: () => null };
const { MapData } = await import("../static/js/map/mapdata.js");
const { Route } = await import("../static/js/map/route.js");
const { World } = await import("../static/js/sim/world.js");
const { Vehicle, CAR } = await import("../static/js/sim/vehicle.js");
const { speedControl } = await import("../static/js/sim/controller.js");
const { obbOverlap } = await import("../static/js/sim/collision.js");
const P = await import("../static/js/sim/parallel-park.js");

const DT = 1 / 60;
// A straight two-way street (as in scripts/test_parking_ego.mjs): one lane each way, a 2.4 m parking lane
// each side, the kerb 5.9 m right of the centre line; travel is +x along `in`.
const L = 220, LANE = 1.75, KERB = 5.9;
const street = { lanes: 1, lane_width: 3.5, width: 11.8, lane_offsets: [LANE], asphalt: [-KERB, KERB], parking: [2.4, 2.4], cls: "residential", limit: 11.2, oneway: false, name: "Test Street" };
const MAP = new MapData({ bbox: [0, 0, 1, 1], extent: [-20, -40, L + 20, 40],
  edges: [{ id: "in", from: "a", to: "b", pts: [[0, 0], [L, 0]], length: L, ...street }, { id: "out", from: "b", to: "a", pts: [[L, 0], [0, 0]], length: L, ...street }],
  lanes: [{ edge: "in", idx: 0, pts: [[0, -LANE], [L, -LANE]] }, { edge: "out", idx: 0, pts: [[L, LANE], [0, LANE]] }],
  nodes: [{ id: "a", x: 0, y: 0 }, { id: "b", x: L, y: 0 }], intersections: [], stops: [], buildings: [] });
const PARKED_Y = -(KERB - 1.25);

// The space as on Vine Street: 7.32 m between the car behind and the car in front.
const A = 120, GAP = 7.32;
const world = new World(MAP, { parked: 1e-9, pedestrians: 0, park: true });
let n = 0;
for (const rear of [A - CAR.length, A + GAP]) {
  const c = new Vehicle(rear + CAR.rearOverhang, PARKED_Y, 0, 0);
  Object.assign(c, { id: `parked_${++n}`, edge: "in", curb: "right", stay: true });
  world.parked.add(c);
}
world.placeOnLane(MAP.lane("in", 0), 100);
const goal = A + GAP + 25, pts = [];
for (let k = 0; k <= goal; k++) pts.push([k, -LANE]);
world.route = new Route({ id: "r", polyline: pts, edges: ["in"], turns: [], start_s: 0, goal_s: goal }, MAP, world.ego.spec);
const plan = P.spacesAlong(world, world.route, CAR).find((p) => Math.abs(p.sFrom - A) < 0.2);
assert.ok(plan, "the space is found");
assert.ok(Math.abs(plan.sTo - (A + GAP)) < 0.2);

// Where the Vine Street car started its second arc: its rear axle 3.19 m behind the front of the space,
// 0.68 m short of its goal line out from the kerb, nose out at 35.7 degrees.
const law = P.planParking(plan);
const ego = world.ego;
Object.assign(ego, { x: plan.sTo - 3.19, y: -(plan.goalW - 0.68), psi: 35.7 * Math.PI / 180, v: 0, delta: ego.spec.maxSteer });
Object.assign(law, { phase: "in2", dir: -1, steer: 1, legs: 0, travelled: 0, sign: 1 });
world.parking = law;

const phases = new Set();
let touched = false;
for (let k = 0; k < 120 / DT && law.phase !== "parked" && law.phase !== "stuck"; k++) {
  P.stepParking(ego, law, world, DT, speedControl);
  phases.add(law.phase);
  touched ||= world.parked.list.some((c) => obbOverlap(ego.obb(), c.obb()));
}
assert.ok(phases.has("shuffle"), `a straight leg to make room (${[...phases].join(", ")})`);
assert.equal(law.phase, "parked", `parks (${law.phase} after ${law.legs} legs)`);
assert.equal(touched, false, "never touches the parked cars");
const pose = P.parkedPose(ego, plan, world);
assert.ok(pose.kerb_m >= 0 && pose.kerb_m <= P.KERB_MAX_M, `within the kerb (${pose.kerb_m} m)`);
assert.ok(pose.angle_deg < 3, `parallel (${pose.angle_deg} degrees)`);
for (const c of world.obstaclesNear(ego.x, ego.y, 10)) assert.equal(obbOverlap(ego.obb(), c.obb(), 0.3), false, `clear of ${c.id}`);
console.log(`Parks after ${law.legs} legs: ${pose.kerb_m} m off the kerb, ${pose.angle_deg} degrees`);
process.exit(0);
