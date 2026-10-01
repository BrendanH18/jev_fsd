// node --experimental-default-type=module scripts/test_static_collision.mjs
import assert from 'node:assert/strict';
import { obbPolygonOverlap } from '../static/js/sim/collision.js';
import { StaticObstacles, poseOf } from '../static/js/sim/static-obstacles.js';
import { Vehicle, CAR } from '../static/js/sim/vehicle.js';
import { DriveScore } from '../static/js/sim/drive-score.js';
import { stepWorld } from '../static/js/sim/step.js';

globalThis.document = { querySelector: () => null };
const { World } = await import('../static/js/sim/world.js');
const { MapData } = await import('../static/js/map/mapdata.js');
const { simulateAll, pathHazard } = await import('../static/js/brain/candidates.js');
const { applyLaw } = await import('../static/js/sim/controller.js');

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log(`✓ ${name}`); };
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const index = (pts) => new StaticObstacles({ pack: { buildings: pts.map((p) => ({ pts: p, h: 8 })) } });
function makeWorld(buildings = [rect(10, -8, 11, 8)]) {
  const edge = { id: 'e', from: 'a', to: 'b', pts: [[-50, 0], [50, 0]], length: 100,
    cls: 'residential', limit: 13.9, lanes: 1, lane_offsets: [0], asphalt: [-4, 4], parking: [0, 0], name: 'Test Street' };
  const map = new MapData({ bbox: [0, 0, 1, 1], extent: [-60, -60, 60, 60], edges: [edge],
    lanes: [{ edge: 'e', idx: 0, pts: edge.pts }], nodes: [{ id: 'a', x: -50, y: 0 }, { id: 'b', x: 50, y: 0 }],
    intersections: [], stops: [], buildings: buildings.map((pts) => ({ pts, h: 8 })) });
  return new World(map, { seed: 42, parked: 0, pedestrians: 0 });
}
function tick(world, dt = 1 / 60, input = {}) {
  return stepWorld({ world, fleet: { step() {} }, autopilot: { enabled: false }, input }, dt, world.t * 1000);
}
function snap(world) {
  return { ego: world.ego, road: world.roadInfo(), route: null, routeProj: null, onRoute: false,
    observed: [], intersection: null, pedestrian: null, visibility: { safe_speed_mps: 40 } };
}

test('footprints detect enclosing buildings, wall segments and rotated corners', () => {
  const box = { center: [0, 0], heading: Math.PI / 4, halfLength: 2, halfWidth: 1 };
  assert(obbPolygonOverlap(box, rect(-5, -5, 5, 5)));
  assert(obbPolygonOverlap(box, rect(-5, -0.05, 5, 0.05)));
  assert(obbPolygonOverlap(box, rect(1.7, 0.65, 1.9, 0.85)));
  assert(!obbPolygonOverlap(box, rect(1.8, -1.8, 2, -1.6)));
  assert(!obbPolygonOverlap(box, rect(10, 10, 11, 11)));
});
test('concave recesses remain drivable rather than becoming solid bounding boxes', () => {
  const pts = [[-6, -6], [6, -6], [6, 6], [3, 6], [3, -2], [-3, -2], [-3, 6], [-6, 6]];
  assert(!obbPolygonOverlap({ center: [0, 2], heading: 0, halfLength: 1, halfWidth: 1 }, pts));
  assert(obbPolygonOverlap({ center: [4, 2], heading: 0, halfLength: 1, halfWidth: 1 }, pts));
});
test('spatial queries include large buildings across cells, deduplicate and stay local', () => {
  const obstacles = index([rect(-100, -100, 100, 100), ...Array.from({ length: 2000 }, (_, i) => rect(1000 + i * 20, 500, 1005 + i * 20, 505))]);
  assert.equal(obstacles.query([-1, -1, 1, 1]).length, 1);
  assert.equal(obstacles.overlaps(new Vehicle().obb()).length, 1);
  assert.equal(obstacles.query([-1000, -1000, -900, -900]).length, 0);
});
test('invalid and empty footprints are ignored', () => {
  assert.equal(index([[], [[0, 0], [1, 1]], [[0, 0], [1, 1], [2, 2]], [[0, 0], [NaN, 2], [3, 0]]]).list.length, 0);
  assert.equal(index([]).sweep({ x: 0, y: 0, psi: 0 }, { x: 100, y: 0, psi: 0 }, CAR), null);
});
test('sweeps catch thin walls between endpoints and return a nonpenetrating pose', () => {
  const obstacles = index([rect(10, -5, 10.05, 5)]);
  const hit = obstacles.sweep({ x: 0, y: 0, psi: 0 }, { x: 30, y: 0, psi: 0 }, CAR);
  assert(hit && hit.fraction > 0 && hit.fraction < 1);
  assert(Math.abs(hit.safePose.x - (10 - (CAR.length - CAR.rearOverhang))) < 0.001);
  assert.equal(obstacles.overlaps(new Vehicle(hit.safePose.x, 0, 0).obb()).length, 0);
});
test('sweeps include reverse motion and corner travel while rotating', () => {
  const rear = index([rect(-5, -5, -4.95, 5)]);
  assert(rear.sweep({ x: 0, y: 0, psi: 0 }, { x: -20, y: 0, psi: 0 }, CAR));
  const corner = index([rect(1.8, 1.8, 2, 2)]);
  assert.equal(corner.overlaps(new Vehicle().obb()).length, 0);
  assert(corner.sweep({ x: 0, y: 0, psi: 0 }, { x: 0, y: 0, psi: Math.PI / 2 }, CAR));
});
test('production physics resolves wall penetration and audits an at-fault collision', () => {
  const world = makeWorld();
  world.ego.v = 30; world.ego.vy = 0.2; world.ego.r = 0.02;
  tick(world, 1);
  assert.equal(world.violations.collisions, 1);
  assert.equal(world.violations.collisions_at_fault, 1);
  assert.equal(world.events[0].kind, 'building');
  assert.equal(world.events[0].fault, 'ego');
  assert.equal(world.staticObstacles.overlaps(world.ego.obb()).length, 0);
  for (const key of ['v', 'a', 'vy', 'r', 'ax', 'latAccel']) assert.equal(world.ego[key], 0);
});
test('continued throttle against a wall counts once; separation permits another incident', () => {
  const world = makeWorld(); world.ego.v = 20; tick(world, 1);
  for (let i = 0; i < 300; i++) tick(world, 1 / 60, { throttle: true });
  assert.equal(world.violations.collisions, 1);
  assert(world.ego.front[0] < 10);
  for (let i = 0; i < 180; i++) tick(world, 1 / 60, { brake: true });
  assert(world.ego.x < 5);
  for (let i = 0; i < 480; i++) tick(world, 1 / 60, { throttle: true });
  assert.equal(world.violations.collisions, 2);
});
test('lane resets clear sweep history and residual lateral/yaw motion', () => {
  const world = makeWorld(); world.ego.v = 20; tick(world, 1);
  world.ego.vy = 4; world.ego.r = 2;
  world.placeOnLane(world.map.lane('e', 0), 20);
  tick(world);
  assert.equal(world.violations.collisions, 1);
  assert.equal(world.staticContacts.size, 0);
  assert.equal(world.ego.vy, 0); assert.equal(world.ego.r, 0);
  // This explicit placement crosses the building in world coordinates, without driving there.
  world.placeOnLane(world.map.lane('e', 0), 80);
  tick(world);
  assert.equal(world.violations.collisions, 1);
  world.resetToLane(); tick(world);
  assert.equal(world.violations.collisions, 1);
});
test('static collisions inherit the score cap and separate at-fault counter', () => {
  const world = makeWorld(), score = new DriveScore(world);
  world.ego.v = 20; tick(world, 1); score.record(world, world.roadInfo(), 1);
  const report = score.snapshot();
  assert.equal(report.collisions, 1); assert.equal(report.at_fault, 1); assert(report.score <= 59);
});
test('candidate safety rejects buildings with no observed traffic, and exposes path hazards', () => {
  const world = makeWorld(); world.ego.v = 5;
  const candidates = [{ id: 'forward', law: { kind: 'steer', steer: 0, vTarget: 5 } }, { id: 'brake', law: { kind: 'hard_brake' } }];
  const result = simulateAll(candidates, snap(world), world);
  assert.equal(candidates[0].reject, 'collision');
  assert.equal(candidates[0].sim.collision.kind, 'building');
  assert(candidates[0].sim.collision.t < 2);
  assert.equal(candidates[1].eligible, true); assert.equal(result.eligible.length, 1);
  assert.equal(pathHazard({ candidate: candidates[0] }, snap(world), world).kind, 'building');
  assert.deepEqual(world.obstaclesNear(world.ego.x, world.ego.y, 60), []);
});
test('safe prediction agrees with executing the same production controller/vehicle path', () => {
  const world = makeWorld([rect(10, 5, 12, 8)]); world.ego.v = 5;
  const candidate = { id: 'forward', law: { kind: 'steer', steer: 0, vTarget: 5 } };
  simulateAll([candidate], snap(world), world);
  assert.equal(candidate.eligible, true);
  for (let i = 0; i < 30; i++) {
    applyLaw(world.ego, candidate.law, null, 0, 0.1);
    world.t += 0.1; world.audit(0.1, world.roadInfo());
  }
  assert.equal(world.violations.collisions, 0);
  assert(Math.hypot(world.ego.x - candidate.sim.end[0], world.ego.y - candidate.sim.end[1]) < 1e-9);
});
test('predicted first building impact matches executing that maneuver', () => {
  const world = makeWorld(); world.ego.v = 5;
  const candidate = { id: 'forward', law: { kind: 'steer', steer: 0, vTarget: 5 } };
  simulateAll([candidate], snap(world), world);
  let impact = null;
  for (let i = 0; i < 30 && !impact; i++) {
    applyLaw(world.ego, candidate.law, null, 0, 0.1);
    world.t += 0.1; world.audit(0.1, world.roadInfo());
    impact = world.events.find((e) => e.type === 'collision');
  }
  assert(impact);
  assert.equal(candidate.sim.collision.id, impact.with);
  assert(Math.abs(candidate.sim.collision.t - impact.t) <= 0.100001);
});
console.log(`${passed} static collision tests passed`);
