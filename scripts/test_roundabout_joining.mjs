// Coming up to a roundabout's yield line, the car also gives way to a vehicle about to come into the
// ring at another entry, which will be in it first (sim/roundabout.js ringJoining). Before, only
// vehicles already in the ring counted: on Kitsilano's West 8th Avenue traffic circle (city suite at
// 23:30, s1-4) the car and a cyclist from the opposite entry reached the ring together, and the
// audit, which counts the cyclist once it is at the ring, found the car had entered in front of it.
// node --experimental-default-type=module scripts/test_roundabout_joining.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
globalThis.document = { querySelector: () => null };
const { MapData, pointAt, headingAt } = await import("../static/js/map/mapdata.js");
const { CHALLENGES } = await import("../static/js/lab/challenges.js");
const { setupChallenge } = await import("../static/js/lab/evaluation.js");
const { ringBusy, ringJoining } = await import("../static/js/sim/roundabout.js");
const { Vehicle } = await import("../static/js/sim/vehicle.js");
const { buildSnapshot } = await import("../static/js/brain/sensors.js");

// A mini traffic circle at the origin, as on West 8th Avenue: the car's entry on the west side.
const rb = { x: 0, y: 0, island_r: 2.9, lane_r: 5.3, outer_r: 7.3, ccw: true };
const west = { x: -7.3, y: 0 };
const v = (x, y, deg, speed, a = 0) => ({ x, y, psi: deg * Math.PI / 180, v: speed, a });
{
  // a cyclist coming in from the east at 6.3 m/s, 4 m short of the ring: in it in 0.6 s, at the car's
  // entry 2.5 s after that
  const bike = v(11.5, 1.6, 180, 6.3);
  assert.equal(ringBusy(rb, west, [bike]), false, "not yet in the ring");
  assert.equal(ringJoining(rb, west, [bike]), true, "but on its way in, due at the car's entry within the window");
  assert.equal(ringJoining(rb, west, [{ ...bike, v: 0 }]), false, "waiting at its own line");
  assert.equal(ringJoining(rb, west, [{ ...bike, a: -6 }]), false, "braking to stop at its line");
  assert.equal(ringJoining(rb, west, [v(11.5, -1.6, 0, 6.3)]), false, "leaving the ring");
  assert.equal(ringJoining(rb, west, [v(40, 1.6, 180, 6.3)]), false, "still a block away");
  assert.equal(ringJoining(rb, west, [v(-11.5, -1.6, 0, 6.3)]), false, "behind the car at its own entry: queueing");
  // (from further out, the window is wider while the car is still on its way to the line)
  const far = v(17, 1.6, 180, 6.3);
  assert.equal(ringJoining(rb, west, [far]), false);
  assert.equal(ringJoining(rb, west, [far], 2), true);
  console.log("✓ a vehicle about to come into the ring at another entry is due at the car's entry");
}

{
  // The car's sensing on the Halifax ring of the "roundabout-gap" challenge, its traffic taken away
  // and one car put on another entry's approach, short of the ring and heading in.
  const pack = JSON.parse(fs.readFileSync(new URL("../data/maps/49db0d437c8c.v6.pack.json", import.meta.url)));
  const map = new MapData(pack), challenge = CHALLENGES.find((c) => c.id === "roundabout-gap");
  const { world, fleet } = setupChallenge(map, challenge);
  fleet.vehicles.length = 0; world.npcs.length = 0;
  const c = world.route.controls[0], ring = map.roundabouts.get(c.control.roundabout), entry = map.nodes.get(map.edges.get(c.edge).to);
  assert.equal(buildSnapshot(world).intersection.cross_traffic_moving, false, "an empty ring");
  // (the window sensing uses for a car still on its way to the line: its time to the line, up to 4 s)
  const snap0 = buildSnapshot(world), extra = Math.min(4, Math.max(0, snap0.intersection.bumper_to_line_m) / Math.max(1, world.ego.v));
  let joining = 0, further = 0;
  for (const e of map.edges.values()) {
    if (e.control?.type !== "yield" || e.control.roundabout !== ring.id || e.id === c.edge) continue;
    // its front 3 m short of its line, at 6 m/s
    const lane = map.lane(e.id, e.lanes - 1), s = Math.max(0, lane.length - (e.length - e.control.s_line) - 3 - 3.8);
    const [x, y] = pointAt(lane.pts, lane.cum, s), heading = headingAt(lane.pts, lane.cum, s);
    const n = Object.assign(new Vehicle(x, y, heading, 6), { id: `joining_${e.id}` });
    world.npcs = [n];
    if (!world.sees(world.ego, n)) continue;
    assert.equal(ringBusy(ring, entry, world.npcs), false, "not yet in the ring");
    const joins = ringJoining(ring, entry, world.npcs, extra);
    if (joins) joining++; else further++;
    assert.equal(buildSnapshot(world).intersection.cross_traffic_moving, joins, `the car gives way to the car coming in on ${e.id} only if it is due at its entry soon`);
  }
  assert.ok(joining > 0, "an entry in sight whose traffic comes round to the car's soon");
  assert.ok(further > 0, "and one far enough round the ring not to hold the car up");
  world.npcs = [];
  console.log("✓ the car's sensing gives way to it at the yield line");
}
process.exit(0);
