// Right hooks: cyclists keep right in an empty parking lane, and a car turning right waits for a
// cyclist on its right. Where cyclists ride, what the car senses, what models are told, traffic
// waiting too, closed-loop drives and the audit.
// node --experimental-default-type=module scripts/test_right_hook.mjs
import assert from "node:assert/strict";
globalThis.document = { querySelector: () => null };
const { MapData, joinLanes, cumulative, pointAt, headingAt } = await import("../static/js/map/mapdata.js");
const { Route } = await import("../static/js/map/route.js");
const { World } = await import("../static/js/sim/world.js");
const { Vehicle, BIKE } = await import("../static/js/sim/vehicle.js");
const { setWeather } = await import("../static/js/sim/weather.js");
const { StopMemory } = await import("../static/js/sim/signals.js");
const { stepWorld } = await import("../static/js/sim/step.js");
const { buildSnapshot } = await import("../static/js/brain/sensors.js");
const { sampleCandidates, simulateAll } = await import("../static/js/brain/candidates.js");
const { toJevState, buildQuestions, situationClauses } = await import("../static/js/brain/state.js");
const { buildLlmPrompt } = await import("../static/js/brain/llm-prompt.js");
const { RulesBrain } = await import("../static/js/brain/rules.js");
const { Autopilot } = await import("../static/js/brain/brain.js");
const { NpcFleet, NpcPath, stripOffset } = await import("../static/js/sim/npc.js");
const { obbOverlap } = await import("../static/js/sim/collision.js");
const { rng } = await import("../static/js/common.js");

// Two-way streets crossing at the origin, one lane each way 3.2 m wide with a 2.1 m parking lane
// beside it. West to east is the larger road, so the car (from the west, travel +x, its lane at
// y = -1.6) has the right of way and turns right, south, without a sign. Arms: w, e, n, s.
const ARM = 150, HALF = 1.6;
const ARMS = { w: 180, e: 0, n: 90, s: -90 };
const right = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy); return [dy / d, -dx / d]; };
function junction({ parking = 2.1 } = {}) {
  const ends = { c: [0, 0] }, edges = [], lanes = [];
  for (const [arm, deg] of Object.entries(ARMS)) ends[arm] = [ARM * Math.cos(deg * Math.PI / 180), ARM * Math.sin(deg * Math.PI / 180)].map((v) => Math.round(v * 1e6) / 1e6);
  for (const [arm] of Object.entries(ARMS)) for (const [id, from, to] of [[`${arm}_in`, arm, "c"], [`${arm}_out`, "c", arm]]) {
    const pts = [ends[from], ends[to]], [rx, ry] = right(...pts);
    edges.push({ id, from, to, pts, length: ARM, lanes: 1, lane_width: 3.2, lane_offsets: [HALF], asphalt: [-3.2 - parking, 3.2 + parking], parking: [parking, parking],
      cls: arm === "w" || arm === "e" ? "secondary" : "residential", limit: 11.1, oneway: false, name: arm === "w" || arm === "e" ? "West Street" : "North Street" });
    lanes.push({ edge: id, idx: 0, pts: pts.map(([x, y]) => [x + rx * HALF, y + ry * HALF]) });
  }
  const map = new MapData({ bbox: [0, 0, 1, 1], extent: [-ARM - 20, -ARM - 20, ARM + 20, ARM + 20], edges, lanes,
    nodes: Object.entries(ends).map(([id, [x, y]]) => ({ id, x, y })), intersections: [], stops: [], buildings: [] });
  const routeData = (exit) => ({ id: `to_${exit}`, polyline: resample(joinLanes(map.lane("w_in", 0).pts, map.lane(exit, 0).pts)), edges: ["w_in", exit],
    turns: exit === "e_out" ? [] : [{ at_m: ARM, dir: exit === "s_out" ? "right" : "left" }], start_s: 0, goal_s: 120 });
  return { map, routeData };
}
function resample(pts) {
  const cum = cumulative(pts), out = [];
  for (let s = 0; s < cum.at(-1); s += 1) out.push(pointAt(pts, cum, s));
  out.push(pts.at(-1));
  return out;
}
const FRONT = (() => { const c = new Vehicle(0, 0, 0, 0); return c.spec.length - c.spec.rearOverhang; })();
const BIKE_FRONT = BIKE.length - BIKE.rearOverhang;

function setup(j, { front = -30, v = 6, exit = "s_out" } = {}) {
  setWeather("dry");
  const world = new World(j.map, { parked: 0, pedestrians: 0 });
  Object.assign(world.ego, { x: front - FRONT, y: -HALF, psi: 0, v });
  world.resetContactHistory();
  world.route = new Route(j.routeData(exit), j.map);
  world.destination = world.route.endPoint();
  world.npcs = [];
  world._road = world.roadInfo();
  return world;
}
// A cyclist on the car's street with its front wheel at x = `front`, riding `side` metres right of
// its lane's centre (the parking lane, unless given), straight on to the east.
function cyclist(world, id, front, { v = 5, side = null, fleet = null } = {}) {
  const e = world.map.edges.get("w_in"), lane = world.map.lane("w_in", 0), s = ARM + front - BIKE_FRONT;
  const d = side ?? stripOffset(e, 0), p = pointAt(lane.pts, lane.cum, s);
  const b = new Vehicle(p[0], p[1] - d, 0, v, BIKE);
  Object.assign(b, { id, kind: "bike", v0: v || 5, side: d, strip: side === null, driver: { aMax: 0.9, b: 2, s0: 2, T: 1.5, react: 0.5, lcRate: 0 }, stopMem: new StopMemory(), frozen: 0, waiting: 0 });
  b.path = new NpcPath(world.map, fleet?.random || rng(1), { bike: true });
  b.path.start("w_in", 0, s, [["e_out", 0]]);
  (fleet ? fleet.vehicles : world.npcs).push(b);
  return b;
}
function decide(world) {
  const snap = buildSnapshot(world);
  const candidates = sampleCandidates(snap, world);
  return { snap, candidates, ...simulateAll(candidates, snap, world) };
}
const rules = new RulesBrain();
const J = junction();

{
  // where a cyclist rides in the parking lane: 2.6 m right of the lane's centre, clear of the curb;
  // nowhere on a street without one, or in a lane away from the curb
  const e = J.map.edges.get("w_in");
  assert.ok(Math.abs(stripOffset(e, 0) - 2.6) < 1e-9, `${stripOffset(e, 0)}`);
  assert.equal(stripOffset(junction({ parking: 0 }).map.edges.get("w_in"), 0), null);
  assert.equal(stripOffset(junction({ parking: 1.2 }).map.edges.get("w_in"), 0), null, "too narrow");
  assert.equal(stripOffset({ ...e, lanes: 2, lane_offsets: [1.6, 4.8], asphalt: [-3.2, 8.5] }, 0), null, "not the curb lane");
  console.log("✓ a cyclist rides 2.6 m right of the lane's centre in a parking lane at least 1.5 m wide");
}

{
  // turning right: a cyclist coming up in the parking lane on the right holds the car short of its
  // line; one following the car in its lane, or one too far back, does not
  const world = setup(J, { front: -30, v: 8 });
  cyclist(world, "rider", -34, { v: 5.5 });
  const { snap, eligible, rejected } = decide(world);
  const h = snap.right_hook;
  assert.equal(h?.id, "rider");
  assert.ok(h.eta_s < h.need_s, `${h.eta_s} < ${h.need_s}`);
  assert.ok(h.bumper_to_yield_m > 15 && h.bumper_to_yield_m < 30, `waits ${h.bumper_to_yield_m} m ahead`);
  assert.ok(rejected.fails_to_yield_to_cyclist > 0, JSON.stringify(rejected));
  assert.ok(eligible.some((c) => c.id === "stop_for_cyclist"), eligible.map((c) => c.id).join());
  assert.ok(eligible.every((c) => c.sim.progress_m < h.bumper_to_yield_m + 0.6));
  const follower = setup(J, { front: -30, v: 8 });
  cyclist(follower, "behind", -38, { v: 5.5, side: 0.85 });
  assert.equal(decide(follower).snap.right_hook, null, "a cyclist following in the lane is not passing on the right");
  const far = setup(J, { front: -30, v: 8 });
  cyclist(far, "far", -70, { v: 5.5 });
  assert.equal(decide(far).snap.right_hook, null, "too far back to reach the corner first");
  const straight = setup(J, { front: -30, v: 8, exit: "e_out" });
  cyclist(straight, "rider", -34, { v: 5.5 });
  assert.equal(decide(straight).snap.right_hook, null, "going straight on, the car does not cross its line");
  const left = setup(J, { front: -30, v: 8, exit: "n_out" });
  cyclist(left, "rider", -34, { v: 5.5 });
  assert.equal(decide(left).snap.right_hook, null, "nor turning left");
  // standing still at the corner (at a light, say), it is not waited for until it moves off
  const still = setup(J, { front: -12, v: 3 });
  cyclist(still, "still", -9, { v: 0 });
  assert.equal(decide(still).snap.right_hook, null);
  console.log("✓ turning right, the car waits for a cyclist coming up on its right, not one following it");
}

{
  // too late to stop short of its line: the car carries on
  const world = setup(J, { front: -7.5, v: 7 });
  cyclist(world, "rider", -9, { v: 5.5 });
  assert.equal(decide(world).snap.right_hook, null);
  // at the point where it waits, the Rules driver holds still
  const at = setup(J, { front: -30, v: 0 });
  const rider = cyclist(at, "rider", -36, { v: 5.5 });
  const h = decide(at).snap.right_hook;
  Object.assign(at.ego, { x: at.ego.x + h.bumper_to_yield_m - 0.5 });
  at.resetContactHistory(); at._road = at.roadInfo();
  rider.x += h.bumper_to_yield_m - 3;
  const d = decide(at);
  assert.ok(d.snap.right_hook && d.snap.right_hook.bumper_to_yield_m < 2);
  assert.equal(d.snap.target.v, 0);
  assert.ok(d.snap.target.reasons.includes("cyclist on the right"), d.snap.target.reasons.join());
  assert.equal(rules.decideSync(d.snap, d.eligible).motion, "stop");
  console.log("✓ the car stops short of the cyclist's line, or carries on once it cannot");
}

{
  // what decision models and LLMs see
  const world = setup(J, { front: -30, v: 8 });
  cyclist(world, "rider", -34, { v: 5.5 });
  const { snap, candidates, eligible } = decide(world);
  const state = toJevState(snap, candidates, {}, "test");
  assert.equal(state.cyclist_on_right.id, "rider");
  assert.equal(state.cyclist_on_right.yield, true);
  assert.ok(state.cyclist_on_right.wait_in_m > 15);
  assert.ok(state.candidates.some((c) => c.id === "stop_for_cyclist" && c.outcome.includes("short of the cyclist's path")));
  const clause = situationClauses(snap).find((c) => c.includes("cyclist `rider`"));
  assert.ok(clause && clause.includes("right of way") && clause.includes("`stop_for_cyclist`"), clause);
  const { questions } = buildQuestions(snap, eligible);
  assert.ok(questions.motion.criteria.stop.includes("`cyclist_on_right.wait_in_m` under 2"));
  const { messages } = buildLlmPrompt(snap, { state, questions });
  assert.ok(messages[0].content.includes("`stop_for_cyclist`"));
  assert.ok(JSON.parse(messages[1].content).observed.cyclist_on_right);
  console.log("✓ models get the cyclist on the right, a situation line, a candidate and a motion criterion");
}

{
  // the audit: turning across the line of a cyclist that rode on the car's right, due within 2 s,
  // fails to yield, seen or not; turning behind it, or across one following the car, does not
  const run = ({ riderFront, side = null, v = 5.5 } = {}) => {
    const world = setup(J, { front: -25, v: 5 });
    world.visibility.sees = () => false;
    const rider = cyclist(world, "rider", riderFront, { v, side });
    const out = [];
    let s = world.route.project(world.ego.x, world.ego.y).s;
    for (let k = 0; k < 150; k++) {
      s += 5 / 30;
      const [x, y] = world.route.pointAt(s);
      Object.assign(world.ego, { x, y, psi: world.route.headingAt(s + 1.2), v: 5 });
      rider.path.s += v / 30;
      const [bx, by] = rider.path.offsetPointAt(rider.path.s, rider.side);
      Object.assign(rider, { x: bx, y: by, psi: rider.path.headingAt(rider.path.s) });
      world.tick++; world.t += 1 / 30;
      world.audit(1 / 30, world.roadInfo());
      out.push(...world.events.filter((e) => e.type === "failed_to_yield").map((e) => [e.to, e.with]));
    }
    return out;
  };
  assert.deepEqual(run({ riderFront: -32 }), [["cyclist", "rider"]], "a right hook");
  assert.deepEqual(run({ riderFront: -8 }), [], "the cyclist was past the corner first");
  assert.deepEqual(run({ riderFront: -70 }), [], "far enough back");
  assert.deepEqual(run({ riderFront: -34, side: 0.85 }), [], "following the car in its lane");
  // resetting the car (to its lane, say) forgets which cyclists it has been counted for
  const reset = setup(J);
  reset.hookCounted.set("rider", reset.t);
  reset.besideRight.set("rider", reset.t);
  reset.resetContactHistory();
  assert.ok(reset.hookCounted.size === 0 && reset.besideRight.size === 0, "cleared on reset");
  console.log("✓ turning right across a cyclist on the car's right counts as a failure to yield, seen or not");
}

// closed loop with real traffic drivers
function drive(world, fleet, { seconds = 40, watch = () => {} } = {}) {
  const autopilot = new Autopilot(world);
  autopilot.brainName = "rules";
  autopilot.setEnabled(true);
  const dt = 1 / 30;
  for (let i = 0; i < seconds / dt && world.route; i++) {
    stepWorld({ world, fleet, autopilot }, dt, world.t * 1000);
    watch(world, autopilot);
  }
  return autopilot;
}
function withFleet(world) {
  const fleet = new NpcFleet(world, { count: 0, bikes: 0, seed: 3 });
  fleet.nextPull = fleet.nextPark = 1e9;
  return fleet;
}
// whoever first has its front past x = -2 heading south of y = -8 (turned) or east past x = 2
const counts = (world) => [world.violations.collisions, world.violations.failed_to_yield, world.violations.deadlock_overrides];

{
  // the car catches up a cyclist in the parking lane before its right turn, lets it go by, then turns
  const world = setup(J, { front: -60, v: 9 });
  const fleet = withFleet(world);
  const rider = cyclist(world, "rider", -48, { v: 5.5, fleet });
  let waited = false, riderAcross = null, egoTurned = null;
  drive(world, fleet, { seconds: 30, watch: (w, a) => {
    if (a.executing?.candidate?.id === "stop_for_cyclist" || a.snap?.right_hook) waited = true;
    if (riderAcross === null && rider.x > 4) riderAcross = w.t;
    if (egoTurned === null && w.ego.y < -9) egoTurned = w.t;
  } });
  assert.ok(world.route === null, "arrives");
  assert.ok(waited, "it waited for the cyclist");
  assert.ok(riderAcross !== null && egoTurned !== null && riderAcross < egoTurned, `cyclist across at ${riderAcross}, car turned at ${egoTurned}`);
  assert.deepEqual(counts(world), [0, 0, 0], counts(world).join());
  assert.ok(rider.v > 4, "the cyclist kept going");
  console.log("✓ closed loop: the car lets a cyclist on its right go by, then turns behind it");
}

{
  // traffic does the same: a traffic car turning right waits for a cyclist on its right, whether it
  // starts level with it or comes up behind it at the limit
  const turning = ({ carFront, carV, riderFront }) => {
    const world = setup(J, { front: -120, v: 0, exit: "e_out" });
    world.route = null;
    const fleet = withFleet(world);
    const lane = world.map.lane("w_in", 0), s = ARM + carFront - FRONT, p = pointAt(lane.pts, lane.cum, s);
    const car = new Vehicle(p[0], p[1], headingAt(lane.pts, lane.cum, s), carV);
    Object.assign(car, { id: "turner", v0: carV, driver: { aMax: 1.5, b: 2, s0: 2, T: 1.2, react: 0.5, lcRate: 0 }, stopMem: new StopMemory(), frozen: 0, waiting: 0 });
    car.path = new NpcPath(world.map, fleet.random);
    car.path.start("w_in", 0, s, [["s_out", 0]]);
    fleet.vehicles.push(car);
    const rider = cyclist(world, "rider", riderFront, { v: 5.5, fleet });
    let riderAcross = null, carTurned = null, closest = Infinity, slowest = Infinity;
    for (let i = 0; i < 25 * 30; i++) {
      fleet.step(1 / 30); world.t += 1 / 30; world.tick++;
      if (riderAcross === null && rider.x > 4) riderAcross = world.t;
      if (carTurned === null && car.y < -9) carTurned = world.t;
      closest = Math.min(closest, Math.hypot(car.x - rider.x, car.y - rider.y));
      if (riderAcross === null) slowest = Math.min(slowest, rider.v);
    }
    return { first: riderAcross !== null && carTurned !== null && riderAcross < carTurned, closest, slowest, fleet, car, world };
  };
  for (const c of [{ carFront: -40, carV: 8, riderFront: -44 }, { carFront: -40, carV: 11.1, riderFront: -30 }]) {
    const r = turning(c);
    assert.ok(r.first, `cyclist across first (${JSON.stringify(c)})`);
    assert.ok(r.closest > 1.5 && r.slowest > 5, `closest ${r.closest}, cyclist slowed to ${r.slowest} (${JSON.stringify(c)})`);
  }
  // a cyclist going the same way on another street, 100 m to the right, is not on the car's right
  const { fleet, car, world } = turning({ carFront: -40, carV: 8, riderFront: -44 });
  const lane = world.map.lane("w_in", 0), s = ARM - 30 - FRONT, p = pointAt(lane.pts, lane.cum, s);
  Object.assign(car, { x: p[0], y: p[1], psi: 0, v: 8 });
  const far = cyclist(world, "parallel", -32, { v: 5.5 });
  far.y -= 100;
  fleet.vehicles = [car, far];
  assert.equal(fleet.cyclistOnRight(car, "c", 30, 5.3), false);
  far.y += 100;
  assert.equal(fleet.cyclistOnRight(car, "c", 30, 5.3), true, "on its own street it is");
  console.log("✓ a traffic car turning right waits for a cyclist on its right");
}

{
  // cyclists in traffic: one in the lane takes the empty parking lane to the end of the block and
  // keeps it past the junction; before a parked car it moves back into the lane, waiting in the
  // parking lane while a car is beside it
  const world = setup(J, { front: -140, v: 0, exit: "e_out" });
  world.route = null;
  const fleet = withFleet(world);
  const rider = cyclist(world, "rider", -60, { v: 5, side: 0.85, fleet });
  let maxSide = 0;
  for (let i = 0; i < 6 * 30; i++) { fleet.step(1 / 30); world.t += 1 / 30; world.tick++; maxSide = Math.max(maxSide, rider.side); }
  assert.ok(rider.strip && maxSide > 2.5, `in the parking lane (${maxSide})`);
  // a car parked on the next block, 20 m past the junction, with a car alongside in the lane
  const e = world.map.edges.get("e_out"), plane = world.map.lane("e_out", 0);
  const at = (s, d) => { const q = pointAt(plane.pts, plane.cum, s); return [q[0], q[1] - d]; };
  const [px, py] = at(20 + 0.9, stripOffset(e, 0));
  const parked = new Vehicle(px, py, 0, 0);
  Object.assign(parked, { id: "parked_test", edge: "e_out", curb: "right" });
  world.parked.add(parked);
  // (standing in the lane at the junction, where the cyclist moves back across)
  const bl = world.map.lane("w_in", 0), [ax, ay] = pointAt(bl.pts, bl.cum, ARM - 7);
  const beside = new Vehicle(ax, ay, 0, 0);
  Object.assign(beside, { id: "beside", v0: 0, driver: { aMax: 1.5, b: 2, s0: 2, T: 1.2, react: 0.5, lcRate: 0 }, stopMem: new StopMemory(), frozen: 1e6, waiting: 0 });
  beside.path = new NpcPath(world.map, fleet.random); beside.path.start("w_in", 0, ARM - 7, [["e_out", 0]]);
  fleet.vehicles.push(beside);
  let held = false, passing = 0, touched = false;
  for (let i = 0; i < 30 * 30; i++) {
    fleet.step(1 / 30); world.t += 1 / 30; world.tick++;
    if (rider.stripHold != null) held = true;
    // (where it passes the parked car)
    if (rider.front[0] > px - 1 && rider.x < px + 3.6) passing = Math.max(passing, rider.side);
    if (obbOverlap(rider.obb(), parked.obb()) || obbOverlap(rider.obb(), beside.obb())) touched = true;
  }
  assert.ok(held, "it waited in the parking lane while the car was beside it");
  assert.ok(passing > 0 && passing < 1.2, `back in the lane past the parked car (${passing})`);
  assert.ok(rider.x > px + 6 && !touched, `and past it (${rider.x})`);
  assert.ok(rider.strip, "then back in the empty parking lane beyond it");
  console.log("✓ a cyclist rides the empty parking lane, and moves back into the lane before a parked car once nothing is beside it");
}

{
  // waiting in the parking lane behind a parked car while a car stands beside it, then moving out
  // round the parked car from rest once that car has gone, without touching it
  const world = setup(J, { front: -140, v: 0, exit: "e_out" });
  world.route = null;
  const fleet = withFleet(world);
  const e = world.map.edges.get("w_in"), plane = world.map.lane("w_in", 0);
  const q = pointAt(plane.pts, plane.cum, ARM - 20), parked = new Vehicle(q[0], q[1] - stripOffset(e, 0), 0, 0);
  Object.assign(parked, { id: "parked_test", edge: "w_in", curb: "right" });
  world.parked.add(parked);
  const rider = cyclist(world, "rider", -32, { v: 2, fleet });
  rider.v0 = 5;
  const b = pointAt(plane.pts, plane.cum, ARM - 33), beside = new Vehicle(b[0], b[1], 0, 0);
  Object.assign(beside, { id: "beside", v0: 0, driver: { aMax: 1.5, b: 2, s0: 2, T: 1.2, react: 0.5, lcRate: 0 }, stopMem: new StopMemory(), frozen: 1e6, waiting: 0 });
  beside.path = new NpcPath(world.map, fleet.random); beside.path.start("w_in", 0, ARM - 33, [["e_out", 0]]);
  fleet.vehicles.push(beside);
  let stoppedFor = 0, touched = false;
  for (let i = 0; i < 25 * 30; i++) {
    fleet.step(1 / 30); world.t += 1 / 30; world.tick++;
    if (rider.v < 0.1 && rider.stripHold != null) stoppedFor += 1 / 30;
    if (stoppedFor > 1 && beside.frozen > 0) { beside.frozen = 0; beside.v0 = 8; }
    if (obbOverlap(rider.obb(), parked.obb())) touched = true;
  }
  assert.ok(stoppedFor > 1, "it stopped in the parking lane");
  assert.ok(!touched, "and did not touch the parked car");
  assert.ok(rider.x > parked.x + 8, `it got round it (${rider.x})`);
  // stopped closer than that, it shuffles across before it rolls on
  for (const back of [3, 0.5]) {
    const w = setup(J, { front: -140, v: 0, exit: "e_out" });
    w.route = null;
    const f = withFleet(w);
    const car = new Vehicle(q[0], q[1] - stripOffset(e, 0), 0, 0);
    Object.assign(car, { id: "parked_test", edge: "w_in", curb: "right" });
    w.parked.add(car);
    const r = cyclist(w, "rider", -20 - 0.9 - back, { v: 0, fleet: f });
    let hit = false;
    for (let i = 0; i < 30 * 30; i++) { f.step(1 / 30); w.t += 1 / 30; w.tick++; if (obbOverlap(r.obb(), car.obb())) hit = true; }
    assert.ok(!hit && r.x > car.x + 8, `${back} m behind: touched ${hit}, at ${r.x}`);
  }
  // nor angled toward it
  {
    const w = setup(J, { front: -140, v: 0, exit: "e_out" });
    w.route = null;
    const f = withFleet(w);
    const car = new Vehicle(-20, -4.2, 0, 0);
    Object.assign(car, { id: "parked_test", edge: "w_in", curb: "right" });
    w.parked.add(car);
    const r = cyclist(w, "rider", -22.85 + BIKE_FRONT, { v: 0, fleet: f });
    Object.assign(r, { x: -22.85, y: -4.2, psi: -0.2 });
    assert.ok(!obbOverlap(r.obb(), car.obb()), "clear to start with");
    let hit = false;
    for (let i = 0; i < 30 * 30; i++) { f.step(1 / 30); w.t += 1 / 30; w.tick++; if (obbOverlap(r.obb(), car.obb())) hit = true; }
    assert.ok(!hit && r.x > car.x + 8, `angled: touched ${hit}, at ${r.x}`);
  }
  // and shuffling across never brings it into another cyclist standing beside it
  {
    const w = setup(J, { front: -140, v: 0, exit: "e_out" });
    w.route = null;
    const f = withFleet(w);
    const a1 = cyclist(w, "a", -70, { v: 0, side: 0.85, fleet: f }), a2 = cyclist(w, "b", -70, { v: 0, side: 1.55, fleet: f });
    a2.frozen = 1e6;
    assert.ok(!obbOverlap(a1.obb(), a2.obb()), "clear to start with");
    let hit = false;
    for (let i = 0; i < 10 * 30; i++) { f.step(1 / 30); w.t += 1 / 30; w.tick++; if (obbOverlap(a1.obb(), a2.obb())) hit = true; }
    assert.ok(!hit, "the two cyclists never touch");
  }
  console.log("✓ a cyclist waiting behind a parked car moves out round it from rest without touching it");
}

{
  // a cyclist stops for a car body across its way, even when the car's middle is out of its path
  const world = setup(J, { front: -140, v: 0, exit: "e_out" });
  world.route = null;
  const fleet = withFleet(world);
  const rider = cyclist(world, "rider", -30, { v: 5, side: 0.85, fleet });
  // a car standing across the lane 6 m ahead, nose first across the cyclist's path: its middle is 1 m
  // to the right of it and its rear axle 2.2 m
  const blocker = new Vehicle(rider.x + 1.45 + 6 - 1.35 * Math.cos(1.1), -1.6 - 0.85 - 1 - 1.35 * Math.sin(1.1), 1.1, 0);
  Object.assign(blocker, { id: "across", v0: 0, driver: { aMax: 1.5, b: 2, s0: 2, T: 1.2, react: 0.5, lcRate: 0 }, stopMem: new StopMemory(), frozen: 1e6, waiting: 0 });
  blocker.path = new NpcPath(world.map, fleet.random); blocker.path.start("w_in", 0, 10);
  fleet.vehicles.push(blocker);
  let touched = false;
  for (let i = 0; i < 6 * 30; i++) { fleet.step(1 / 30); world.t += 1 / 30; world.tick++; if (obbOverlap(rider.obb(), blocker.obb())) touched = true; }
  assert.ok(rider.v < 0.3, `stopped (${rider.v})`);
  assert.ok(!touched, "short of the car");
  console.log("✓ a cyclist stops for any part of a car across its way");
}

console.log("All right-hook checks passed.");
process.exit(0);
