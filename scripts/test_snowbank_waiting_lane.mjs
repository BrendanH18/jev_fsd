// Waiting outside a narrowing must leave the oncoming bus room to finish moving back right.
import assert from "node:assert/strict";
globalThis.document = { querySelector: () => null };
const { kitsilano } = await import("./progress_helpers.mjs");
const { World } = await import("../static/js/sim/world.js");
const { Route } = await import("../static/js/map/route.js");
const { routeFromLanes } = await import("../static/js/demo/routing.js");
const { NpcFleet } = await import("../static/js/sim/npc.js");
const { Vehicle } = await import("../static/js/sim/vehicle.js");
const { pointAt, headingAt } = await import("../static/js/map/mapdata.js");
const { Autopilot } = await import("../static/js/brain/brain.js");
const { stepWorld } = await import("../static/js/sim/step.js");
const { keepAt, pushedLat } = await import("../static/js/sim/snowbanks.js");
const { obbOverlap } = await import("../static/js/sim/collision.js");
for (const brain of ["rules", "cautious"]) {
  const map = kitsilano(), world = new World(map, { parked: 0, pedestrians: 0, weather: "snow", snowbanks: true, followingDistance: true });
  world.snowbanks.build({ narrowings: [{ edge: "e452", a: 20, b: 65 }] });
  const nw = world.snowbanks.narrowings[0], lane = map.lane(nw.opposite, 0);
  world.placeOnLane(lane, nw.L - nw.b - 18); world.ego.v = 3;
  world.route = new Route(routeFromLanes(map, [lane], 0, lane.length - 2), map);
  const fleet = new NpcFleet(world, { count: 0, bikes: 0 }); fleet.nextPull = fleet.nextPark = Infinity;
  const busLane = map.lane(nw.edge, 0), bus = fleet.addSchoolBus(busLane, nw.b - 35, 2);
  bus.school.every = Infinity;
  const shift = keepAt(busLane.edgeRef, bus.spec) - busLane.edgeRef.lane_offsets[0];
  bus.x += Math.sin(bus.psi) * shift; bus.y -= Math.cos(bus.psi) * shift; bus.sbShift = shift;
  for (const [id, a, b] of [[nw.edge, nw.a, nw.b], [nw.opposite, nw.L - nw.b, nw.L - nw.a]]) {
    const edge = map.edges.get(id), lat = pushedLat(edge);
    for (let s = a + 3; s < b - 3; s += 6.5) {
      const p = pointAt(edge.pts, edge.cum, s), h = headingAt(edge.pts, edge.cum, s);
      world.parked.add(Object.assign(new Vehicle(p[0] + Math.sin(h) * lat, p[1] - Math.cos(h) * lat, h, 0), { id: `parked_${id}_${s}`, edge: id, curb: "right" }));
    }
  }
  const route = world.route, autopilot = new Autopilot(world); autopilot.setBrain(brain); autopilot.setEnabled(true);
  let touched = false, waitedInLane = false;
  for (let k = 0; k < 70 * 60 && autopilot.enabled; k++) {
    stepWorld({ world, fleet, autopilot }, 1 / 60, world.t * 1000);
    if (autopilot.firing) await autopilot.firing;
    touched ||= [world.ego, ...world.parked.list].some(o => obbOverlap(bus.obb(), o.obb()));
    if (autopilot.snap?.snowbank?.narrowing?.wait && world.ego.v < 0.1)
      waitedInLane ||= Math.abs(world.roadInfo().lateral) < 0.1;
  }
  assert.equal(touched, false, `${brain}: the bus keeps clear of waiting and parked cars`);
  assert.equal(waitedInLane, true, `${brain}: waits in the approach lane, leaving the bus's exit clear`);
  assert.equal(route.project(world.ego.x, world.ego.y).s > nw.L - nw.a + 6, true, `${brain}: the bus exits and the car then clears the narrowing`);
  assert.equal(world.violations.collisions, 0);
  assert.equal(world.violations.snowbank_conflicts || 0, 0);
}
console.log("Waiting drivers leave the snowbank corridor's exit clear for an oncoming bus");
process.exit(0);
