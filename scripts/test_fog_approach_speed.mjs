// Coming up to a traffic circle in fog, the car slows as for a stop until it can see round the ring.
// Sensing used to take a ring with no traffic in sight as an empty one, however little of it the
// car could see. On Kitsilano's Trafalgar Street and West 6th Avenue circle with 28 m of sight
// (city suite in fog, s1-3, once traffic's lane joins matched the router's:
// docs/validation/lane-join-parity-2026-11-26.md) Rules came up to the yield line at the street's
// limit, a car coming in at the opposite entry came into view with the line 6 m away, and the audit,
// which counts every vehicle in the ring, seen or not, found the car had entered in front of it.
// node --experimental-default-type=module scripts/test_fog_approach_speed.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
globalThis.document = { querySelector: () => null };
const { MapData } = await import("../static/js/map/mapdata.js");
const { World } = await import("../static/js/sim/world.js");
const { NpcFleet } = await import("../static/js/sim/npc.js");
const { Vehicle, comfort } = await import("../static/js/sim/vehicle.js");
const { stepWorld } = await import("../static/js/sim/step.js");
const { setWeather } = await import("../static/js/sim/weather.js");
const { ringBusy, ringLookPoint } = await import("../static/js/sim/roundabout.js");
const { Route } = await import("../static/js/map/route.js");
const { routeFromLanes } = await import("../static/js/demo/routing.js");
const { buildSnapshot } = await import("../static/js/brain/sensors.js");
const { sampleCandidates, simulateAll } = await import("../static/js/brain/candidates.js");
const { RulesBrain } = await import("../static/js/brain/rules.js");
const { Autopilot } = await import("../static/js/brain/brain.js");

const pack = JSON.parse(fs.readFileSync(new URL("../data/maps/623b012bc8b5.v6.pack.json", import.meta.url)));
const map = new MapData(pack);
// North up Trafalgar Street, right round the circle, east along West 6th Avenue.
const lanes = ["e271", "e535", "e219"].map((id) => map.lane(id, 0));
const approachEdge = map.edges.get("e271"),
  yieldLine = approachEdge.control,
  ring = map.roundabouts.get(yieldLine.roundabout),
  entry = map.nodes.get(approachEdge.to);
assert.equal(yieldLine.type, "yield");
const round = (x) => Math.round(x * 100) / 100;

{
  // Where a vehicle that would hold the entry can be: on this small circle, as far as its far side.
  const [x, y] = ringLookPoint(ring, entry, approachEdge.limit);
  assert.equal(round(Math.hypot(x - ring.x, y - ring.y)), ring.lane_r);
  assert.equal(round(Math.hypot(x - entry.x, y - entry.y)) > 2 * ring.lane_r - 2.5, true, "the far side");
  // (a vehicle there, at the street's limit, holds the entry; the audit says so)
  assert.equal(ringBusy(ring, entry, [{ x, y, v: approachEdge.limit }]), true);
  // on a ring ten times the size, the same few seconds of travel back from the entry
  const big = { ...ring, lane_r: ring.lane_r * 10 };
  const out = big.lane_r / Math.hypot(entry.x - ring.x, entry.y - ring.y);
  const far = { x: ring.x + (entry.x - ring.x) * out, y: ring.y + (entry.y - ring.y) * out };
  const [bx, by] = ringLookPoint(big, far, 8);
  const chord = Math.hypot(bx - far.x, by - far.y);
  assert.equal(chord > 20 && chord < 28, true, `${round(chord)} m back round the ring`);
  console.log("✓ the look point is as far round the ring as a vehicle that would hold the entry");
}

// The car `toLine` metres (front bumper) short of the yield line at `v` m/s.
function approach(weather, toLine, v, brain = null) {
  setWeather(weather);
  const world = new World(map, { seed: 3, parked: 0, pedestrians: 0, weather });
  const fleet = new NpcFleet(world, { count: 0, bikes: 0, seed: 5 });
  const front = world.ego.spec.length - world.ego.spec.rearOverhang;
  world.placeOnLane(lanes[0], yieldLine.s_line - toLine - front);
  world.ego.v = v;
  world.route = new Route(routeFromLanes(map, lanes, 0, 60), map, world.ego.spec);
  world._road = world.roadInfo();
  const autopilot = new Autopilot(world, {});
  if (brain) {
    autopilot.setBrain(brain);
    autopilot.setEnabled(true);
  }
  return { world, fleet, autopilot };
}
function decide(world) {
  const snap = buildSnapshot(world);
  const candidates = sampleCandidates(snap, world);
  const result = simulateAll(candidates, snap, world);
  return { snap, candidates, ...result };
}
const FOG_MPS = 6.64; // this street's limit, slowed for fog

{
  // Nobody about. 10 m short of the line the far side of the ring is 29 m off, beyond the fog's 28 m,
  // and the car has to be slowing by now to stop at the line.
  const { world } = approach("fog", 10, FOG_MPS);
  const { snap, candidates, mustStop } = decide(world);
  assert.equal(snap.visibility.range_m, 28);
  assert.equal(snap.intersection.control, "yield");
  assert.equal(Math.abs(snap.intersection.bumper_to_line_m - 10) < 1, true);
  assert.equal(snap.intersection.cross_traffic_moving, true, "an unseen ring is not an empty one");
  assert.equal(mustStop, true);
  assert.equal(snap.target.v < FOG_MPS, true, `slowing as for a stop: ${round(snap.target.v)} m/s`);
  const on = candidates.filter((c) => c.law.kind === "lane" && c.law.vTarget >= FOG_MPS - 0.1 && !c.law.stopAtRoute);
  assert.equal(on.length > 0, true);
  assert.equal(
    on.every((c) => c.reject === "fails_to_yield"),
    true,
    "driving on over the line at speed is not offered",
  );
  console.log("✓ within stopping distance of the line in fog, a ring out of sight is taken as occupied");
}

{
  // Further back there is no need yet; nearer, the whole ring is in view and it is empty.
  const dry = [40, 25, 13, 7];
  for (const [toLine, why] of [
    [40, "not yet within stopping distance"],
    [7, "the far side is in view"],
    [3, "at the line"],
  ]) {
    const { world } = approach("fog", toLine, toLine > 10 ? FOG_MPS : 4);
    assert.equal(buildSnapshot(world).intersection.cross_traffic_moving, false, why);
  }
  // In clear daylight the car sees the ring from well back.
  for (const toLine of dry) {
    const { world } = approach("dry", toLine, 8.3);
    assert.equal(buildSnapshot(world).intersection.cross_traffic_moving, false, `dry, ${toLine} m`);
  }
  console.log("✓ not before the car must slow, not once the ring is in view, and not in clear weather");
}

// A car coming south down Trafalgar Street into the ring at the opposite entry and round it to the
// west, as in the drive: at 7 m/s, `lead` metres short of the ring when the driven car sets off.
function southbound(lead) {
  const north = Math.PI / 2;
  const n = Object.assign(new Vehicle(ring.x - 1.6, ring.y + ring.lane_r + lead, -north, 7), { id: "southbound" });
  let turned = 0;
  return {
    n,
    move(dt) {
      if (n.y > ring.y + ring.lane_r * Math.sin(north + turned) && turned === 0) n.y -= n.v * dt;
      else {
        // (round the ring anticlockwise, a quarter of the way, then off to the west)
        turned += (n.v * dt) / ring.lane_r;
        if (turned < Math.PI / 2 + 0.3) {
          const theta = north + 0.26 + turned;
          n.x = ring.x + ring.lane_r * Math.cos(theta);
          n.y = ring.y + ring.lane_r * Math.sin(theta);
          n.psi = theta + Math.PI / 2;
        } else {
          n.x -= n.v * dt;
          n.psi = Math.PI;
        }
      }
    },
  };
}

// Closed loop with Rules from 45 m back.
async function drive(lead) {
  const ctx = approach("fog", 45, FOG_MPS, new RulesBrain());
  const { world, autopilot } = ctx;
  const front = world.ego.spec.length - world.ego.spec.rearOverhang;
  const other = lead === null ? null : southbound(lead);
  let inView = null,
    atLine = null,
    t = 0;
  for (let k = 0; k < 40 * 60 && atLine === null; k++) {
    if (other) {
      other.move(1 / 60);
      world.npcs = [other.n];
    }
    stepWorld(ctx, 1 / 60, world.t * 1000);
    if (autopilot.firing) await autopilot.firing;
    t = world.t;
    const toLine = yieldLine.s_line - world.route.project(world.ego.x, world.ego.y, world.route.hint).s - front;
    const [x, y] = ringLookPoint(ring, entry, approachEdge.limit);
    if (inView === null && Math.hypot(x - world.ego.x, y - world.ego.y) <= 28) inView = { toLine, v: world.ego.v };
    if (toLine <= 0) atLine = world.ego.v;
  }
  return { inView, atLine, t, failed: world.violations.failed_to_yield, collisions: world.collisions?.length ?? 0 };
}

let alone = 0;
{
  const { inView, atLine, t, failed } = await drive(null);
  alone = t;
  assert.notEqual(atLine, null, "with the ring empty it goes on in");
  assert.equal(t < 20, true, `without stopping long: ${round(t)} s`);
  assert.equal(failed, 0);
  // When the far side comes into view the car can still stop at the line at an easy rate.
  const needed = (inView.v * inView.v) / (2 * (inView.toLine - 0.5));
  assert.equal(
    needed <= comfort().decel + 0.6,
    true,
    `${round(inView.v)} m/s with ${round(inView.toLine)} m to the line needs ${round(needed)} m/s²`,
  );
  console.log(
    `✓ Rules has the ring in view ${round(inView.toLine)} m short of the line at ${round(inView.v)} m/s, and enters at ${round(atLine)} m/s`,
  );
}

{
  // The other car timed as in the drive, to be coming into the ring as the driven car reaches its
  // line: before, the driven car was at the line at the street's limit for each of these arrivals
  // and entered in front of it. Now it has slowed, sees the car come out of the fog and waits.
  // (Not closed: with 28 m of sight a car can still come in at the far entry after the driven car
  // has seen the ring empty and gone, about 12 m further back than these; ROADMAP 1.8.)
  for (const lead of [40, 42, 44, 46]) {
    const { atLine, failed, t } = await drive(lead);
    assert.notEqual(atLine, null, `lead ${lead}: it gets in`);
    assert.equal(failed, 0, `lead ${lead}: entered in front of the car in the ring`);
    assert.equal(t > alone + 1.5, true, `lead ${lead}: it waited`);
  }
  // and one well ahead of it, or well behind, does not hold it up
  for (const lead of [10, 70]) {
    const { failed, t } = await drive(lead);
    assert.equal(failed, 0);
    assert.equal(t < alone + 1.5, true, `lead ${lead}`);
  }
  console.log("✓ a car coming into the ring out of the fog as the driven car arrives is given way to");
}
process.exit(0);
