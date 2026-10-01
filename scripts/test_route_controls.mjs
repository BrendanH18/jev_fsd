// node --experimental-default-type=module scripts/test_route_controls.mjs
import assert from 'node:assert/strict';
globalThis.document = { querySelector: () => null };
const { MapData } = await import('../static/js/map/mapdata.js');
const { World } = await import('../static/js/sim/world.js');
const { stepWorld } = await import('../static/js/sim/step.js');

function fixture(type = 'stop') {
  const control = { id: type, type, s_line: 2, all_way: false, group: type === 'signal' ? 'A' : null };
  const edges = [
    { id: 'before', from: 'a', to: 'b', pts: [[-50, 0], [0, 0]], length: 50 },
    { id: 'controlled', from: 'b', to: 'c', pts: [[0, 0], [50, 0]], length: 50, control },
  ].map((e) => ({ ...e, lanes: 1, lane_offsets: [0], asphalt: [-4, 4], parking: [0, 0], cls: 'residential', limit: 11.2 }));
  const map = new MapData({ bbox: [0, 0, 1, 1], extent: [-60, -60, 60, 60], edges,
    lanes: edges.map((e) => ({ edge: e.id, idx: 0, pts: e.pts })),
    nodes: [{ id: 'a', x: -50, y: 0 }, { id: 'b', x: 0, y: 0 }, { id: 'c', x: 50, y: 0 }],
    intersections: [], stops: [], buildings: [] });
  const world = new World(map, { parked: 0, pedestrians: 0 });
  world.placeOnLane(map.lane('before', 0), 47.4);
  world.route = { project(x) { return { s: x + 50, distance: 0, heading: 0 }; }, controls: [{ edge: 'controlled', control, sRoute: 52 }] };
  return world;
}
function tick(world, dt = 1 / 60) {
  return stepWorld({ world, fleet: { step() {} }, autopilot: { enabled: false }, input: {} }, dt, world.t * 1000);
}

{
  const world = fixture();
  assert.equal(world.roadInfo().edge.id, 'before');
  assert.equal(world.roadInfo().edge.control, undefined);
  for (let i = 0; i < 60; i++) tick(world);
  assert.equal(world.egoStop.controlId, 'stop');
  assert.equal(world.egoStop.completed, true);
  world.ego.v = 2; tick(world, 1);
  assert(world.ego.front[0] > 2);
  assert.equal(world.violations.stop_signs_run, 0);
  console.log('✓ full stop on adjacent route segment is remembered and allows legal departure');
}
{
  const world = fixture();
  tick(world);
  world.ego.v = 5; tick(world, 0.5);
  assert(world.ego.front[0] > 2);
  assert.equal(world.violations.stop_signs_run, 1);
  tick(world);
  assert.equal(world.violations.stop_signs_run, 1);
  console.log('✓ rolling through route stop line is audited once before rear axle changes edges');
}
{
  const world = fixture();
  world.route = null;
  world.placeOnLane(world.map.lane('controlled', 0), 0.2);
  tick(world);
  assert.equal(world.egoStop.controlId, 'stop');
  console.log('✓ manual driving retains physical-lane traffic control auditing');
}
{
  for (const phase of ['red', 'green']) {
    const world = fixture('signal');
    world.phase = () => ({ A: phase });
    tick(world); world.ego.v = 5; tick(world, 0.5); tick(world);
    assert.equal(world.violations.red_lights_run, phase === 'red' ? 1 : 0);
  }
  console.log('✓ route signal crossings retain phase-aware red-light auditing');
}
{
  const world = fixture();
  world.route.project = (x) => ({ s: x + 50, distance: 100, heading: 0 });
  for (let i = 0; i < 60; i++) tick(world);
  assert.equal(world.egoStop.controlId, null);
  world.ego.v = 5; tick(world, 0.5);
  assert.equal(world.violations.stop_signs_run, 0);
  // An active route elsewhere must also leave physical-lane traffic control in charge.
  world.placeOnLane(world.map.lane('controlled', 0), 0.2);
  tick(world);
  assert.equal(world.egoStop.controlId, 'stop');
  console.log('✓ an active remote route creates no imaginary crossing and preserves physical-lane controls');
}
{
  const world = fixture();
  world.route.project = (x) => ({ s: x + 50, distance: 0, heading: Math.PI });
  for (let i = 0; i < 60; i++) tick(world);
  assert.equal(world.egoStop.controlId, null);
  world.ego.v = 5; tick(world, 0.5);
  assert.equal(world.violations.stop_signs_run, 0);
  console.log('✓ crossing the old route in the opposite direction does not audit its stop line');
}
console.log('6 route control regression tests passed');
