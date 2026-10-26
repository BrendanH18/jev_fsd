// Turning round where the route makes a U-turn: a dead end 6.4 m wide with no parking lanes, too
// narrow for the car to come round in one sweep. The turnaround on offer, its room checks, what
// models are told, the safety brake and the audit when reversing, and a closed-loop Rules drive
// that makes a three-point turn and arrives back down the street.
// node --experimental-default-type=module scripts/test_turnaround.mjs
import assert from "node:assert/strict";
globalThis.document = { querySelector: () => null };
const { MapData } = await import("../static/js/map/mapdata.js");
const { Route } = await import("../static/js/map/route.js");
const { World } = await import("../static/js/sim/world.js");
const { Vehicle } = await import("../static/js/sim/vehicle.js");
const { stepWorld } = await import("../static/js/sim/step.js");
const { buildSnapshot } = await import("../static/js/brain/sensors.js");
const { sampleCandidates, simulateAll } = await import("../static/js/brain/candidates.js");
const { toJevState, buildQuestions, situationClauses } = await import("../static/js/brain/state.js");
const { RulesBrain } = await import("../static/js/brain/rules.js");
const { Autopilot } = await import("../static/js/brain/brain.js");
const { safetyBrake } = await import("../static/js/brain/safety.js");
const { planTurnaround, legRoom } = await import("../static/js/sim/turnaround.js");

// A two-way street from x = 0 to its dead end at x = 60. Travel in is +x, in the lane right of the
// centreline (y = -1.6); the way out is the other lane (y = +1.6).
const END = 60, LANE = 1.6;
const street = { lanes: 1, lane_width: 3.2, width: 6.4, lane_offsets: [LANE], asphalt: [-3.2, 3.2], parking: [0, 0], cls: "residential", limit: 11.2, oneway: false, name: "Dead End" };
const map = new MapData({ bbox: [0, 0, 1, 1], extent: [-20, -40, END + 20, 40],
  edges: [{ id: "in", from: "a", to: "b", pts: [[0, 0], [END, 0]], length: END, ...street }, { id: "out", from: "b", to: "a", pts: [[END, 0], [0, 0]], length: END, ...street }],
  lanes: [{ edge: "in", idx: 0, pts: [[0, -LANE], [END, -LANE]] }, { edge: "out", idx: 0, pts: [[END, LANE], [0, LANE]] }],
  nodes: [{ id: "a", x: 0, y: 0 }, { id: "b", x: END, y: 0 }], intersections: [], stops: [], buildings: [] });
// as the router chains the lanes: in to the dead end, across, and back out
const polyline = [];
for (let x = 0; x <= END; x++) polyline.push([x, -LANE]);
for (let x = END; x >= 0; x--) polyline.push([x, LANE]);
const TURN_AT = END;
const routeData = { id: "r", polyline, edges: ["in", "out"], turns: [{ at_m: TURN_AT, dir: "uturn", street: "Dead End" }], start_s: 0, goal_s: END };
const GOAL_X = 15;

function setup({ x = 20, v = 0, npcs = [] } = {}) {
  const world = new World(map, { parked: 0, pedestrians: 0 });
  Object.assign(world.ego, { x, y: -LANE, psi: 0, v, delta: 0 });
  world.route = new Route({ ...routeData, polyline: polyline.filter(([px, py]) => py < 0 || px >= GOAL_X) }, map);
  world.destination = [GOAL_X, LANE];
  world.npcs = npcs;
  world._road = world.roadInfo();
  return world;
}
function decide(world, executing = null) {
  const snap = buildSnapshot(world, executing);
  const candidates = sampleCandidates(snap, world);
  const result = simulateAll(candidates, snap, world);
  return { snap, candidates, ...result };
}
function parkedCar(id, x, y, psi = 0) {
  const n = new Vehicle(x, y, psi, 0);
  n.id = id;
  return n;
}

{
  const route = new Route(routeData, map);
  const law = planTurnaround(route, route.turns[0]);
  assert.equal(law.kind, "turnaround");
  assert.equal(law.side, 1, "a U-turn goes left");
  assert.ok(Math.abs(Math.abs(law.psiOut) - Math.PI) < 0.01, "the way out faces back down the street");
  assert.ok(route.cum[law.outLo] <= TURN_AT && route.cum[law.outLo + 1] > TURN_AT - 1, "the lane out is looked for from the U-turn on");
  console.log("✓ a turnaround planned for a dead end turns left, to face back down the street");
}

{
  // far from the dead end nothing is offered; close and slow, the turnaround is, and Rules takes it
  const far = decide(setup({ x: 30, v: 3 }));
  assert.ok(far.snap.turnaround === null && !far.candidates.some((c) => c.id === "turn_around"), "not offered 30 m out");
  const fast = decide(setup({ x: 54, v: 5 }));
  assert.ok(fast.snap.turnaround === null, "not offered while the car is still moving at speed");
  const world = setup({ x: 54, v: 0.5 });
  const { snap, candidates, eligible } = decide(world);
  assert.equal(snap.turnaround?.phase, "start");
  const turn = eligible.find((c) => c.id === "turn_around");
  assert.ok(turn, candidates.map((c) => `${c.id}:${c.reject}`).join(" "));
  const choice = new RulesBrain().decideSync(snap, eligible);
  assert.equal(choice.candidateId, "turn_around");
  assert.equal(choice.motion, "drive");
  const state = toJevState(snap, candidates, {}, "test");
  assert.equal(state.turnaround?.under_way, false);
  assert.ok(state.candidates.some((c) => c.id === "turn_around" && c.outcome === "clear, turns the car round"));
  assert.ok(situationClauses(snap).some((c) => c.includes("three-point turn") && c.includes("`turn_around`")));
  const { questions } = buildQuestions(snap, eligible);
  assert.ok(questions.vector.criteria.turn_around.startsWith("turn round: a three-point turn"));
  console.log("✓ close to the dead end and slow, a three-point turn is offered, and Rules takes it");
}

{
  // the room a leg has: the asphalt (a bumper may reach 0.2 m over the kerb) and what stands still
  const world = setup();
  const lock = world.ego.spec.maxSteer;
  const front = world.ego.spec.length - world.ego.spec.rearOverhang;
  Object.assign(world.ego, { x: END - front - 1, y: -LANE, psi: 0 });
  assert.ok(legRoom(world.ego, world, 0, 0.5), "half a metre short of the end of the street");
  Object.assign(world.ego, { x: END - front + 0.1 });
  assert.ok(!legRoom(world.ego, world, 0, 0.5), "not past the end of the asphalt");
  Object.assign(world.ego, { x: 40, y: 0, psi: Math.PI / 2 });
  assert.ok(!legRoom(world.ego, world, lock, 0.5), "not across the kerb, facing it");
  Object.assign(world.ego, { x: 40, y: -LANE, psi: 0 });
  assert.ok(legRoom(world.ego, world, -lock, -0.5), "room to back up");
  world.npcs = [parkedCar("behind", 40 - world.ego.spec.rearOverhang - 4.5 + 0.9 - 0.3, -LANE)];
  assert.ok(!legRoom(world.ego, world, -lock, -0.5), "not into a car standing right behind");
  console.log("✓ a leg stops short of the kerb, the end of the street and a car standing behind");
}

{
  // reversing: the safety brake looks behind, not ahead, and backing into something is the car's fault
  const world = setup({ x: 40 });
  const behind = parkedCar("behind", 40 - 4.5 - 0.3, -LANE);
  world.npcs = [behind, parkedCar("ahead", 45.5, -LANE)];
  Object.assign(world.ego, { v: -0.8 });
  const snap = buildSnapshot(world);
  const brake = safetyBrake(world, snap, null);
  assert.equal(brake?.reason, "behind");
  Object.assign(world.ego, { v: 0 });
  const law = { ...planTurnaround(world.route, world.route.turns[0]), phase: "reverse" };
  world.turnaround = law;
  world.npcs = [parkedCar("ahead", 45.5, -LANE)];
  assert.equal(safetyBrake(world, buildSnapshot(world, { law }), { law }), null, "a car just ahead does not hold up a leg back");
  const fresh = setup({ x: 40 });
  fresh.npcs = [parkedCar("touching", 40 - 4.4, -LANE)];
  Object.assign(fresh.ego, { v: -1 });
  fresh.audit(1 / 60, fresh.roadInfo());
  assert.equal(fresh.violations.collisions, 1);
  assert.equal(fresh.violations.collisions_at_fault, 1);
  console.log("✓ reversing, the safety brake watches behind, and backing into a car is the car's fault");
}

{
  // closed loop: Rules drives to the dead end, turns round with legs forward and back, never over the
  // kerb, and drives back down the street to its destination
  const world = setup({ x: 20, v: 5 });
  const autopilot = new Autopilot(world);
  autopilot.brainName = "rules";
  autopilot.setEnabled(true);
  const fleet = { step() {} };
  const dt = 1 / 30;
  let legs = 0, reversed = false, overKerb = 0, turnedAt = null;
  for (let i = 0; i < 90 / dt && world.route; i++) {
    stepWorld({ world, fleet, autopilot }, dt, world.t * 1000);
    if (world.turnaround) legs = Math.max(legs, world.turnaround.legs);
    if (world.ego.v < -0.3) reversed = true;
    if (turnedAt === null && Math.abs(Math.abs(world.ego.psi) - Math.PI) < 0.35) turnedAt = world.t;
    for (const [px, py] of world.ego.corners()) overKerb = Math.max(overKerb, map.roadDistance(px, py).distance);
  }
  assert.ok(world.route === null, `arrived (car at ${world.ego.x.toFixed(1)}, ${world.ego.y.toFixed(1)})`);
  assert.equal(world.violations.collisions, 0);
  assert.equal(world.violations.deadlock_overrides, 0);
  assert.equal(world.violations.safety_brakes, 0);
  assert.equal(world.violations.off_road_s, 0);
  assert.ok(reversed, "backed up on a leg");
  assert.ok(legs >= 2, `${legs} legs`);
  assert.ok(overKerb <= 0.25, `bumpers stay within reach of the kerb (${overKerb.toFixed(2)} m)`);
  assert.ok(Math.abs(world.ego.y - LANE) < 0.6, `in the lane out at the end (y=${world.ego.y.toFixed(2)})`);
  console.log(`✓ Rules turns round in ${legs + 1} legs, faces out at ${turnedAt?.toFixed(1)} s and arrives at ${world.t.toFixed(1)} s`);
}

{
  // A street as wide as Willcocks Common in Toronto, 10.6 m of asphalt with a parking lane each
  // side, but with cars parked along both kerbs up to the dead end: the car turns round in the
  // 6.4 m between them, keeping clear of them
  const wide = new MapData({ bbox: [0, 0, 1, 1], extent: [-20, -40, END + 20, 40],
    edges: map.edges.size && [...map.edges.values()].map((e) => ({ id: e.id, from: e.from, to: e.to, pts: e.pts, length: e.length, ...street, asphalt: [-5.3, 5.3], parking: [2.1, 2.1] })),
    lanes: [{ edge: "in", idx: 0, pts: [[0, -LANE], [END, -LANE]] }, { edge: "out", idx: 0, pts: [[END, LANE], [0, LANE]] }],
    nodes: [{ id: "a", x: 0, y: 0 }, { id: "b", x: END, y: 0 }], intersections: [], stops: [], buildings: [] });
  const kerbside = [];
  for (const x of [45, 50.5, 56]) kerbside.push(parkedCar(`right_${x}`, x, -4.25, 0), parkedCar(`left_${x}`, x + 3.6, 4.25, Math.PI));
  const world = new World(wide, { parked: 0, pedestrians: 0 });
  Object.assign(world.ego, { x: 20, y: -LANE, psi: 0, v: 5, delta: 0 });
  world.route = new Route({ ...routeData, polyline: polyline.filter(([px, py]) => py < 0 || px >= GOAL_X) }, wide);
  world.destination = [GOAL_X, LANE];
  world.npcs = kerbside;
  const autopilot = new Autopilot(world);
  autopilot.brainName = "rules";
  autopilot.setEnabled(true);
  const fleet = { step() {} };
  const dt = 1 / 30;
  let legs = 0;
  for (let i = 0; i < 120 / dt && world.route; i++) {
    stepWorld({ world, fleet, autopilot }, dt, world.t * 1000);
    if (world.turnaround) legs = Math.max(legs, world.turnaround.legs);
  }
  assert.ok(world.route === null, `arrived (car at ${world.ego.x.toFixed(1)}, ${world.ego.y.toFixed(1)})`);
  assert.equal(world.violations.collisions, 0);
  assert.equal(world.violations.deadlock_overrides, 0);
  assert.equal(world.violations.safety_brakes, 0);
  assert.ok(legs >= 2, `${legs} legs`);
  console.log(`✓ between cars parked along both kerbs, Rules turns round in ${legs + 1} legs and arrives (${world.t.toFixed(1)} s)`);
}

{
  // the same dead end facing each way: the turn goes left whichever way round the half turn
  // works out
  for (const deg of [90, 180, 270]) {
    const a = deg * Math.PI / 180, c = Math.cos(a), sn = Math.sin(a);
    const rot = ([x, y]) => [x * c - y * sn, x * sn + y * c];
    const turned = new MapData({ bbox: [0, 0, 1, 1], extent: [-100, -100, 100, 100],
      edges: [...map.edges.values()].map((e) => ({ id: e.id, from: e.from, to: e.to, pts: e.pts.map(rot), length: e.length, ...street })),
      lanes: [{ edge: "in", idx: 0, pts: [[0, -LANE], [END, -LANE]].map(rot) }, { edge: "out", idx: 0, pts: [[END, LANE], [0, LANE]].map(rot) }],
      nodes: [{ id: "a", x: 0, y: 0 }, { id: "b", ...Object.fromEntries(rot([END, 0]).map((v, k) => [k ? "y" : "x", v])) }], intersections: [], stops: [], buildings: [] });
    const world = new World(turned, { parked: 0, pedestrians: 0 });
    const [x, y] = rot([20, -LANE]);
    Object.assign(world.ego, { x, y, psi: a, v: 5, delta: 0 });
    world.route = new Route({ ...routeData, polyline: polyline.filter(([px, py]) => py < 0 || px >= GOAL_X).map(rot) }, turned);
    world.destination = rot([GOAL_X, LANE]);
    world.npcs = [];
    const law = planTurnaround(world.route, world.route.turns[0]);
    assert.equal(law.side, 1, `turns left facing ${deg} degrees`);
    const autopilot = new Autopilot(world);
    autopilot.brainName = "rules";
    autopilot.setEnabled(true);
    const fleet = { step() {} };
    const dt = 1 / 30;
    for (let i = 0; i < 90 / dt && world.route; i++) stepWorld({ world, fleet, autopilot }, dt, world.t * 1000);
    assert.ok(world.route === null, `arrived facing ${deg} degrees`);
    assert.equal(world.violations.deadlock_overrides, 0);
    assert.equal(world.violations.off_road_s, 0);
  }
  console.log("✓ the same dead end facing any way round is turned the same way, and the car arrives");
}

{
  // held by the safety brake before a leg has moved (something just in front, about to go): the
  // car waits with its turnaround intact, and turns round once the way is clear
  const world = setup({ x: 50, v: 0 });
  const front = world.ego.spec.length - world.ego.spec.rearOverhang;
  const leaving = new Vehicle(50 + front + 0.92, -LANE, 0, 1);
  leaving.id = "leaving";
  world.npcs = [leaving];
  const autopilot = new Autopilot(world);
  autopilot.brainName = "rules";
  autopilot.setEnabled(true);
  const fleet = { step() {} };
  const dt = 1 / 30;
  let started = false;
  for (let i = 0; i < 1.5 / dt; i++) {
    stepWorld({ world, fleet, autopilot }, dt, world.t * 1000);
    if (world.turnaround) started = true;
  }
  assert.ok(started, "the turnaround was chosen");
  assert.ok(world.turnaround && world.turnaround.legs === 0 && world.turnaround.phase === "forward", `still on its first leg (${world.turnaround?.phase}/${world.turnaround?.legs})`);
  world.npcs = [];
  for (let i = 0; i < 90 / dt && world.route; i++) stepWorld({ world, fleet, autopilot }, dt, world.t * 1000);
  assert.ok(world.route === null, "arrived once the way was clear");
  assert.equal(world.violations.deadlock_overrides, 0);
  console.log("✓ held before its first leg moves, the turnaround waits and then turns round");
}

{
  // a destination just beyond the U-turn, in the lane out: the drive ends only once the car is in
  // that lane, facing along it (not standing between legs in the lane coming in, where the route's
  // end is just as near)
  for (const goalX of [50, 56]) {
    const world = setup({ x: 20, v: 5 });
    world.route = new Route({ ...routeData, polyline: polyline.filter(([px, py]) => py < 0 || px >= goalX) }, map);
    world.destination = [goalX, LANE];
    const autopilot = new Autopilot(world);
    autopilot.brainName = "rules";
    autopilot.setEnabled(true);
    const fleet = { step() {} };
    const dt = 1 / 30;
    let overKerb = 0;
    for (let i = 0; i < 90 / dt && world.route; i++) {
      stepWorld({ world, fleet, autopilot }, dt, world.t * 1000);
      for (const [px, py] of world.ego.corners()) overKerb = Math.max(overKerb, map.roadDistance(px, py).distance);
    }
    const y = world.ego.y, heading = Math.abs(world.ego.psi) * 180 / Math.PI;
    assert.ok(world.route === null, `goal ${goalX}: arrived (car at ${world.ego.x.toFixed(1)}, ${y.toFixed(1)})`);
    assert.ok(Math.abs(y - LANE) < 1, `goal ${goalX}: in the lane out at the end (y=${y.toFixed(2)})`);
    assert.ok(heading > 150, `goal ${goalX}: facing the way out (${heading.toFixed(0)} degrees)`);
    assert.equal(world.violations.collisions, 0);
    assert.equal(world.violations.deadlock_overrides, 0);
    assert.ok(overKerb <= 0.25, `goal ${goalX}: bumpers stay within reach of the kerb (${overKerb.toFixed(2)} m)`);
  }
  console.log("✓ a destination just beyond the U-turn: the drive ends once the car is in the lane out");
}

{
  // autopilot switched off partway round: the turnaround is dropped, so it does not outlive the
  // drive (the oncoming-traffic audit skips the car while one is under way)
  const world = setup({ x: 50, v: 0 });
  const autopilot = new Autopilot(world);
  autopilot.brainName = "rules";
  autopilot.setEnabled(true);
  const fleet = { step() {} };
  const dt = 1 / 30;
  for (let i = 0; i < 3 / dt && !world.turnaround; i++) stepWorld({ world, fleet, autopilot }, dt, world.t * 1000);
  assert.ok(world.turnaround, "the turnaround was chosen");
  autopilot.setEnabled(false);
  assert.equal(world.turnaround, null);
  console.log("✓ switching autopilot off sets a turnaround under way aside");
}

{
  // switched off and on again partway round, with the destination just beyond the U-turn: the
  // turnaround is taken up again, so the drive still ends only once the car is in the lane out
  const goalX = 50;
  const world = setup({ x: 20, v: 5 });
  world.route = new Route({ ...routeData, polyline: polyline.filter(([px, py]) => py < 0 || px >= goalX) }, map);
  world.destination = [goalX, LANE];
  const autopilot = new Autopilot(world);
  autopilot.brainName = "rules";
  autopilot.setEnabled(true);
  const fleet = { step() {} };
  const dt = 1 / 30;
  let toggled = false;
  for (let i = 0; i < 90 / dt && world.route; i++) {
    stepWorld({ world, fleet, autopilot }, dt, world.t * 1000);
    if (!toggled && world.turnaround?.phase === "out") {
      autopilot.setEnabled(false);
      autopilot.setEnabled(true);
      toggled = true;
      assert.ok(world.turnaround?.phase === "out", "taken up again");
    }
  }
  assert.ok(toggled, "switched off and on in the out phase");
  assert.ok(world.route === null, `arrived (car at ${world.ego.x.toFixed(1)}, ${world.ego.y.toFixed(1)})`);
  assert.ok(Math.abs(world.ego.y - LANE) < 1, `in the lane out at the end (y=${world.ego.y.toFixed(2)})`);
  console.log("✓ switched off and on partway round, the car finishes turning round before it arrives");
}
