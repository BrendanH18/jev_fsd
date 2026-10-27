// Emergency vehicles: an ambulance or fire truck with its siren on, and everyone giving way to it.
// Who it calls on, what the car senses and plans, what models are told, traffic pulling over,
// closed-loop drives with Rules and the audit.
// node --experimental-default-type=module scripts/test_emergency.mjs
import assert from "node:assert/strict";
globalThis.document = { querySelector: () => null };
const { MapData, joinLanes, cumulative, pointAt } = await import("../static/js/map/mapdata.js");
const { Route } = await import("../static/js/map/route.js");
const { World } = await import("../static/js/sim/world.js");
const { Vehicle } = await import("../static/js/sim/vehicle.js");
const { setWeather } = await import("../static/js/sim/weather.js");
const { StopMemory } = await import("../static/js/sim/signals.js");
const { stepWorld } = await import("../static/js/sim/step.js");
const { buildSnapshot } = await import("../static/js/brain/sensors.js");
const { sampleCandidates, simulateAll } = await import("../static/js/brain/candidates.js");
const { toJevState, buildQuestions, situationClauses } = await import("../static/js/brain/state.js");
const { buildLlmPrompt } = await import("../static/js/brain/llm-prompt.js");
const { RulesBrain } = await import("../static/js/brain/rules.js");
const { Autopilot } = await import("../static/js/brain/brain.js");
const { NpcFleet, NpcPath } = await import("../static/js/sim/npc.js");
const { emergencyCall, evOffset, pullOverOffset } = await import("../static/js/sim/emergency.js");
const { obbOverlap } = await import("../static/js/sim/collision.js");

// Two-way streets crossing at the origin, one lane each way 3.2 m wide with a 2.1 m parking lane
// beside it, arms 200 m long: w, e, n, s. West Street (w-e) is the larger road; nothing has a sign.
const ARM = 200, HALF = 1.6;
const ARMS = { w: 180, e: 0, n: 90, s: -90 };
const right = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy); return [dy / d, -dx / d]; };
function junction({ lanes: count = 1 } = {}) {
  const offsets = Array.from({ length: count }, (_, i) => HALF + i * 3.2), outer = count * 3.2 + 2.1;
  const ends = { c: [0, 0] }, edges = [], lanes = [];
  for (const [arm, deg] of Object.entries(ARMS)) ends[arm] = [ARM * Math.cos(deg * Math.PI / 180), ARM * Math.sin(deg * Math.PI / 180)].map((v) => Math.round(v * 1e6) / 1e6);
  for (const [arm] of Object.entries(ARMS)) for (const [id, from, to] of [[`${arm}_in`, arm, "c"], [`${arm}_out`, "c", arm]]) {
    const pts = [ends[from], ends[to]], [rx, ry] = right(...pts);
    edges.push({ id, from, to, pts, length: ARM, lanes: count, lane_width: 3.2, lane_offsets: offsets, asphalt: [-outer, outer], parking: [2.1, 2.1],
      cls: arm === "w" || arm === "e" ? "secondary" : "residential", limit: 11.1, oneway: false, name: arm === "w" || arm === "e" ? "West Street" : "North Street" });
    offsets.forEach((d, idx) => lanes.push({ edge: id, idx, pts: pts.map(([x, y]) => [x + rx * d, y + ry * d]) }));
  }
  const map = new MapData({ bbox: [0, 0, 1, 1], extent: [-ARM - 20, -ARM - 20, ARM + 20, ARM + 20], edges, lanes,
    nodes: Object.entries(ends).map(([id, [x, y]]) => ({ id, x, y })), intersections: [], stops: [], buildings: [] });
  const routeData = { id: "east", polyline: resample(joinLanes(map.lane("w_in", 0).pts, map.lane("e_out", 0).pts)), edges: ["w_in", "e_out"], turns: [], start_s: 0, goal_s: 190 };
  return { map, routeData };
}
function resample(pts) {
  const cum = cumulative(pts), out = [];
  for (let s = 0; s < cum.at(-1); s += 1) out.push(pointAt(pts, cum, s));
  out.push(pts.at(-1));
  return out;
}
const FRONT = (() => { const c = new Vehicle(0, 0, 0, 0); return c.spec.length - c.spec.rearOverhang; })();
const J = junction();

// The car with its front at x = `front` going east at `v`, on its route along West Street (in its
// inner lane, on `j` with several).
function setup({ front = -120, v = 10, j = J } = {}) {
  setWeather("dry");
  const world = new World(j.map, { parked: 0, pedestrians: 0 });
  Object.assign(world.ego, { x: front - FRONT, y: -HALF, psi: 0, v });
  world.resetContactHistory();
  world.route = new Route(j.routeData, j.map);
  world.destination = world.route.endPoint();
  const fleet = new NpcFleet(world, { count: 0, bikes: 0, seed: 3 });
  world._road = world.roadInfo();
  return { world, fleet };
}
const J2 = junction({ lanes: 2 });
const decide = (world) => { const snap = buildSnapshot(world); const candidates = sampleCandidates(snap, world); return { snap, candidates, ...simulateAll(candidates, snap, world) }; };
const rules = new RulesBrain();

{
  // where it drives and where others pull over to
  const e = J.map.edges.get("w_in");
  assert.ok(Math.abs(evOffset(e, 0, { width: 2.15 }) + 1.6) < 1e-9, "astride the centre line");
  assert.ok(Math.abs(pullOverOffset(e, 0, 1.9, false) - 0.3) < 1e-9, "to 0.35 m short of the lane's edge");
  assert.ok(Math.abs(pullOverOffset(e, 0, 1.9, true) - 1.5) < 1e-9, "into an empty parking lane");
  const oneway = { ...e, oneway: true, lanes: 2, lane_offsets: [-1.6, 1.6], asphalt: [-5.3, 5.3] };
  assert.ok(Math.abs(evOffset(oneway, 1, { width: 2.15 }) - (-3.2 + 1.075 + 0.2 - 1.6)) < 1e-9, "one-way: along the left");
  assert.ok(Math.abs(pullOverOffset(oneway, 0, 1.9, true) - 0.3) < 1e-9, "not the curb lane: the lane's edge");
  console.log("✓ it drives astride the centre line; others pull over to the edge of their lane or into an empty parking lane");
}

{
  // who it calls on: a car ahead of it in either direction, one on a side street heading for its
  // path, not one it has passed, one following it, or one well away
  const { world, fleet } = setup({ front: -60, v: 10 });
  const ev = fleet.dispatchEmergency({ relation: "behind", kind: "ambulance", distance: 60 });
  assert.ok(ev && ev.siren && ev.kind === "ambulance", "dispatched");
  assert.ok(Math.abs(world.ego.x - ev.x - 60) < 0.5, `${ev.x}`);
  assert.equal(emergencyCall(world.ego, ev)?.relation, "behind");
  const oncoming = new Vehicle(-40, HALF, Math.PI, 8);
  assert.equal(emergencyCall(oncoming, ev)?.relation, "ahead", "coming the other way");
  const follower = new Vehicle(ev.x - 15, -HALF, 0, 8);
  assert.equal(emergencyCall(follower, ev), null, "following it");
  const passed = new Vehicle(ev.x - 8, -HALF + 2.4, 0, 0);
  assert.equal(emergencyCall(passed, ev), null, "behind its tail: passed");
  const far = new Vehicle(-HALF, -150, Math.PI / 2, 8);
  assert.equal(emergencyCall(far, ev), null, "too far");
  const other = setup({ front: -20, v: 10 });
  const ev2 = other.fleet.dispatchEmergency({ relation: "behind", kind: "ambulance", distance: 60 });
  const side = new Vehicle(-HALF, -25, Math.PI / 2, 8);
  assert.equal(emergencyCall(side, ev2)?.relation, "left", "on a side street, heading for its path, it comes from the left");
  ev.siren = false;
  assert.equal(emergencyCall(world.ego, ev), null, "no siren");
  console.log("✓ it calls on vehicles ahead of it either way and on side streets, not ones it has passed or that follow it");
}

{
  // the car hears it coming up behind, plans to pull over and stop, and Rules does
  const { world, fleet } = setup({ front: -120, v: 10 });
  const ev = fleet.dispatchEmergency({ relation: "behind", kind: "ambulance", distance: 70 });
  ev.v = 15;
  const { snap, eligible } = decide(world);
  const e = snap.emergency;
  assert.ok(e && e.id === ev.id && e.from === "behind" && e.kind === "ambulance", JSON.stringify(e && { ...e }));
  assert.ok(Math.abs(e.bumper_to_stop_m - 100 / 3) < 0.01, `stops ${e.bumper_to_stop_m} m on`);
  assert.ok(Math.abs(e.offset_m - 1.5) < 1e-9, `${e.offset_m}`);
  assert.ok(!e.clearing && !e.lead);
  assert.ok(eligible.some((c) => c.id === "pull_over"), eligible.map((c) => c.id).join());
  assert.equal(rules.decideSync(snap, eligible).candidateId, "pull_over");
  // nearer the stop, carrying on past it is ruled out
  world.ego.x += 18;
  const near = decide(world);
  assert.ok(near.rejected.fails_to_yield_to_emergency > 0, JSON.stringify(near.rejected));
  assert.ok(near.eligible.every((c) => c.sim.progress_m < near.snap.emergency.bumper_to_stop_m + 1.6));
  world.ego.x -= 18;
  // the stop is kept as the car slows (not pushed on each decision)
  world.ego.v = 6; world.ego.x += 5;
  const later = buildSnapshot(world);
  assert.ok(Math.abs(later.emergency.bumper_to_stop_m - (e.bumper_to_stop_m - 5)) < 0.01);
  assert.ok(later.target.reasons.includes("pulling over for the ambulance"), later.target.reasons.join());
  console.log("✓ coming up behind, the car plans to pull over and stop, and Rules does");
}

{
  // near a junction: stop short of it, or clear it when too close to stop
  const near = setup({ front: -40, v: 10 });
  near.fleet.dispatchEmergency({ relation: "behind", kind: "ambulance", distance: 70 });
  const a = buildSnapshot(near.world).emergency;
  assert.ok(!a.clearing && a.stop_s_route - near.world.route.project(near.world.ego.x, near.world.ego.y).s - FRONT <= 40 - 5.3 - 2.5 + 0.01, `${a.bumper_to_stop_m}`);
  const close = setup({ front: -10, v: 10 });
  close.fleet.dispatchEmergency({ relation: "behind", kind: "ambulance", distance: 70 });
  const b = buildSnapshot(close.world).emergency;
  assert.ok(b.clearing && b.bumper_to_stop_m > 10 + 5.3, `${b.bumper_to_stop_m}`);
  const inside = setup({ front: 2, v: 6 });
  inside.fleet.dispatchEmergency({ relation: "behind", kind: "ambulance", distance: 70 });
  const c = buildSnapshot(inside.world).emergency;
  assert.ok(c.clearing && c.bumper_to_stop_m > 5.3 + 4.5 - 2, `${c.bumper_to_stop_m}`);
  // (its rear past the junction's centre, still in it)
  const past = setup({ front: 4, v: 1 });
  past.fleet.dispatchEmergency({ relation: "behind", kind: "ambulance", distance: 70 });
  const d = buildSnapshot(past.world).emergency;
  assert.ok(d.clearing && d.bumper_to_stop_m >= 5.3 + 1 - 4 + FRONT - 0.01, `clears it: stops ${d.bumper_to_stop_m} m on`);
  console.log("✓ it stops short of a junction, or clears it first when too close to stop");
}

{
  // what decision models and LLMs are told
  const { world, fleet } = setup({ front: -120, v: 10 });
  fleet.dispatchEmergency({ relation: "behind", kind: "fire_truck" });
  const { snap, candidates, eligible, rejected } = decide(world);
  const state = toJevState(snap, candidates, { rejected });
  assert.equal(state.emergency_vehicle.kind, "fire truck");
  assert.equal(state.emergency_vehicle.pull_over, true);
  assert.equal(state.emergency_vehicle.coming_from, "behind");
  const clause = situationClauses(snap).find((c) => c.includes("fire truck"));
  assert.ok(clause && clause.includes("`pull_over`") && clause.startsWith("A fire truck"), clause);
  const { questions } = buildQuestions(snap, eligible);
  assert.ok(questions.motion.criteria.stop.includes("emergency_vehicle.stop_in_m"));
  assert.ok(questions.vector.criteria.pull_over.includes("pulls over to the right"), questions.vector.criteria.pull_over);
  const prompt = buildLlmPrompt(snap, { state, questions });
  assert.ok(prompt.messages[0].content.includes("Choose `pull_over`"));
  assert.ok(prompt.expect.candidate.includes("pull_over"));
  console.log("✓ decision models and LLMs get the vehicle, a situation line, `pull_over` and a motion criterion");
}

// Run the world with Rules driving the route; returns what happened.
function drive(world, fleet, seconds, each = () => {}) {
  const autopilot = new Autopilot(world);
  autopilot.setBrain("rules");
  autopilot.setEnabled(true);
  const out = { minV: Infinity, maxRight: 0, failed: 0, collisions: 0, overlaps: 0 };
  for (let k = 0; k < seconds * 60; k++) {
    stepWorld({ world, fleet, autopilot }, 1 / 60, world.t * 1000);
    for (const e of world.events) if (e.type === "failed_to_yield") out.failed++;
    each(world, out);
    if (!autopilot.enabled) break;
  }
  out.collisions = world.violations.collisions;
  out.arrived = !autopilot.enabled;
  out.t = world.t;
  return out;
}

{
  // closed loop: the ambulance comes up behind; the car pulls over and stops, it goes by, and the
  // car carries on, keeping back from it, and arrives
  const { world, fleet } = setup({ front: -110, v: 10 });
  const ev = fleet.dispatchEmergency({ relation: "behind", kind: "ambulance", distance: 70 });
  let passedAt = null, stoppedAt = null, pulled = 0, touched = false;
  const out = drive(world, fleet, 60, (w) => {
    if (w.ego.v < 0.05 && stoppedAt === null && w.t > 1) { stoppedAt = w.t; pulled = w.roadInfo().lateral; }
    if (ev.x > w.ego.x + 8 && passedAt === null) passedAt = w.t;
    if (fleet.vehicles.includes(ev) && obbOverlap(ev.obb(), w.ego.obb(), 0)) touched = true;
  });
  assert.ok(pulled > 1.2, `pulled over ${pulled} m`);
  assert.ok(stoppedAt !== null && passedAt !== null && stoppedAt < passedAt, `stopped ${stoppedAt}, passed ${passedAt}`);
  assert.equal(touched, false, "never touched");
  assert.equal(out.failed, 0);
  assert.equal(out.collisions, 0);
  assert.ok(out.arrived, `arrived by ${out.t}`);
  assert.equal(world.violations.deadlock_overrides, 0);
  console.log(`✓ Rules pulls over and stops (${stoppedAt.toFixed(1)} s), the ambulance goes by (${passedAt.toFixed(1)} s), and the car arrives (${out.t.toFixed(1)} s)`);
}

// A traffic car with its rear axle at x (on West Street, going east unless `west`), straight on.
function trafficCar(world, fleet, id, x, { v = 9, west = false } = {}) {
  const edge = !west ? "w_in" : x > 0 ? "e_in" : "w_out", lane = world.map.lane(edge, 0), s = !west ? ARM + x : x > 0 ? ARM - x : -x;
  const p = pointAt(lane.pts, lane.cum, s);
  const car = new Vehicle(p[0], p[1], west ? Math.PI : 0, v);
  Object.assign(car, { id, v0: v, driver: { aMax: 1.5, b: 2, s0: 2, T: 1.2, react: 0.5, lcRate: 0 }, stopMem: new StopMemory(), frozen: 0, waiting: 0 });
  car.path = new NpcPath(world.map, fleet.random);
  car.path.start(edge, 0, s, edge === "w_out" ? [] : [[west ? "w_out" : "e_out", 0]]);
  fleet.vehicles.push(car);
  return car;
}

{
  // traffic gives way too: a car ahead going the same way and one coming the other way pull over
  // and stop, and the ambulance threads between them without touching either
  const { world, fleet } = setup({ front: -190, v: 0 });
  world.ego.x = -400; world.ego.y = 400;   // (out of the way)
  const ahead = trafficCar(world, fleet, "ahead", -120, { v: 9 });
  const oncoming = trafficCar(world, fleet, "oncoming", -20, { v: 9, west: true });
  const ev = fleet.dispatchEmergency({ relation: "behind", kind: "ambulance", distance: 1 });
  assert.equal(ev, null, "nothing to dispatch past with the car off the streets");
  const lane = world.map.lane("w_in", 0), p = pointAt(lane.pts, lane.cum, 10);
  const amb = new Vehicle(p[0], 0, 0, 13, (await import("../static/js/sim/vehicle.js")).AMBULANCE);
  Object.assign(amb, { id: "ambulance_t", kind: "ambulance", siren: true, side: -HALF, age: 0, v0: 15, driver: { aMax: 2.2, b: 3, s0: 3, T: 0.9, react: 0.3, lcRate: 0 }, stopMem: new StopMemory(), frozen: 0, waiting: 0, blockedBy: null, blockedFor: 0 });
  amb.path = new NpcPath(world.map, fleet.random);
  amb.path.start("w_in", 0, 10, [["e_out", 0]]);
  fleet.vehicles.push(amb);
  let aheadStopped = false, oncomingStopped = false, aheadRight = 0, oncomingRight = 0, touched = false, passedBoth = false;
  for (let k = 0; k < 40 * 60 && !passedBoth; k++) {
    fleet.step(1 / 60);
    world.t += 1 / 60;
    if (ahead.v < 0.05) { aheadStopped = true; aheadRight = Math.max(aheadRight, -HALF - ahead.y); }
    if (oncoming.v < 0.05) { oncomingStopped = true; oncomingRight = Math.max(oncomingRight, oncoming.y - HALF); }
    for (const o of [ahead, oncoming]) if (obbOverlap(amb.obb(), o.obb(), 0)) touched = true;
    passedBoth = amb.x - amb.spec.rearOverhang > Math.max(ahead.x, oncoming.x) + 5;
  }
  assert.ok(aheadStopped && oncomingStopped, `stopped: ahead ${aheadStopped}, oncoming ${oncomingStopped}`);
  assert.ok(aheadRight > 1.2 && oncomingRight > 0.4, `pulled over ${aheadRight.toFixed(2)} and ${oncomingRight.toFixed(2)} m`);
  assert.ok(passedBoth, `the ambulance got past both (at x = ${amb.x.toFixed(1)})`);
  assert.equal(touched, false);
  // and they carry on once it has gone by
  for (let k = 0; k < 6 * 60; k++) { fleet.step(1 / 60); world.t += 1 / 60; }
  assert.ok(ahead.v > 2 && oncoming.v > 2, `moving again: ${ahead.v.toFixed(1)}, ${oncoming.v.toFixed(1)}`);
  console.log("✓ traffic both ways pulls over and stops, the ambulance threads between, and traffic carries on");
}

{
  // the audit: a car that keeps going fails to yield, once; a car stopped in the lane holding the
  // ambulance up does too; Rules pulling over does not (above)
  const keeps = setup({ front: -120, v: 10 });
  keeps.fleet.dispatchEmergency({ relation: "behind", kind: "ambulance", distance: 70 });
  let failed = 0, to = null;
  for (let k = 0; k < 15 * 60; k++) {
    const autopilot = { enabled: false, step() {} };
    stepWorld({ world: keeps.world, fleet: keeps.fleet, autopilot, input: { throttle: keeps.world.ego.v < 9 } }, 1 / 60, keeps.world.t * 1000);
    for (const e of keeps.world.events) if (e.type === "failed_to_yield") { failed++; to = e.to; }
  }
  assert.equal(failed, 1);
  assert.equal(to, "emergency vehicle");
  // (a car stopped the other way beside it, and one parked beyond that, leave no gap a fire truck
  // fits through)
  const blocks = setup({ front: -120, v: 0 });
  trafficCar(blocks.world, blocks.fleet, "beside", blocks.world.ego.x + 2, { v: 0, west: true }).frozen = 1e9;
  blocks.world.parked.add(Object.assign(new Vehicle(blocks.world.ego.x + 4, HALF + 2.65, Math.PI, 0), { id: "parked_left", edge: "w_out", curb: "right" }));
  const amb = blocks.fleet.dispatchEmergency({ relation: "behind", kind: "fire_truck", distance: 60 });
  let blockFails = 0;
  for (let k = 0; k < 20 * 60; k++) {
    stepWorld({ world: blocks.world, fleet: blocks.fleet, autopilot: { enabled: false, step() {} }, input: {} }, 1 / 60, blocks.world.t * 1000);
    for (const e of blocks.world.events) if (e.type === "failed_to_yield") blockFails++;
  }
  assert.ok(amb.blockedFor > 6 || !amb.siren, "held up behind the car");
  assert.equal(blockFails, 1, "standing in the lane, it held the fire truck up");
  console.log("✓ the audit counts a car that keeps going, and one that holds the vehicle up in its lane, once each");
}

{
  // too narrow to get by: with cars parked along its curb the car can pull over only to the edge of
  // its lane, and a car stopped the other way beside it (one parked beyond that) leaves a fire truck
  // no room, so once it has been held up for 3 s, the car drives on ahead of it: no failure to yield
  const { world, fleet } = setup({ front: -110, v: 8 });
  for (let x = -160; x <= 40; x += 6.5) if (Math.abs(x) > 12) world.parked.add(Object.assign(new Vehicle(x, -HALF - 2.65, 0, 0), { id: `parked_${x}`, edge: x < 0 ? "w_in" : "e_out", curb: "right" }));
  const truck = fleet.dispatchEmergency({ relation: "behind", kind: "fire_truck", distance: 60 });
  let led = false, failed = 0, stopped = null, touched = false, pulled = 0;
  const out = drive(world, fleet, 70, (w) => {
    const e = buildSnapshot(w).emergency;
    if (e?.lead) led = true;
    if (w.ego.v < 0.05 && stopped === null && w.t > 1) {
      stopped = w.ego.x; pulled = w.roadInfo().lateral;
      const beside = trafficCar(w, fleet, "beside", w.ego.x + 2, { v: 0, west: true }); beside.frozen = 1e9;
      w.parked.add(Object.assign(new Vehicle(w.ego.x + 4, HALF + 2.65, Math.PI, 0), { id: "parked_left", edge: "w_out", curb: "right" }));
    }
    if (fleet.vehicles.includes(truck) && obbOverlap(truck.obb(), w.ego.obb(), 0)) touched = true;
  });
  assert.ok(stopped !== null && pulled > 0.2 && pulled < 0.5, `stopped at the lane's edge (${pulled.toFixed(2)} m)`);
  assert.ok(led, "told to drive on ahead");
  assert.equal(out.failed, 0);
  assert.equal(touched, false);
  assert.equal(out.collisions, 0);
  assert.ok(out.arrived, `arrived by ${out.t.toFixed(1)} s`);
  console.log("✓ where a fire truck cannot get by, the car drives on ahead of it once it has held it up, without failing to yield");
}

{
  // on a street with two lanes each way, the car in the inner lane moves across into the curb lane
  // and pulls over there; an ambulance it let go by along the middle of the road is kept 150 m ahead
  const { world, fleet } = setup({ front: -120, v: 10, j: J2 });
  const amb = fleet.dispatchEmergency({ relation: "behind", kind: "ambulance", distance: 70 });
  const e = buildSnapshot(world).emergency;
  assert.ok(Math.abs(e.offset_m - (3.2 + 1.5)) < 1e-9, `across and over: ${e.offset_m}`);
  let right = 0, ahead = null;
  const out = drive(world, fleet, 40, (w) => {
    right = Math.max(right, -w.ego.y - HALF);
    if (ahead === null && amb.x - w.ego.x > 25 && fleet.vehicles.includes(amb)) ahead = buildSnapshot(w).emergency_ahead;
  });
  assert.ok(right > 3.2 + 1.2, `moved ${right.toFixed(2)} m right`);
  assert.ok(ahead && ahead.id === amb.id, "the ambulance on the centre line is ahead of it");
  assert.equal(out.failed, 0);
  assert.equal(out.collisions, 0);
  console.log("✓ on a street with two lanes each way the car moves into the curb lane to pull over, and keeps back from the ambulance on the centre line");
}

{
  // traffic in the inner lane moves into the curb lane to pull over, and traffic behind an ambulance
  // it let go by hangs back
  const { world, fleet } = setup({ front: -190, v: 0, j: J2 });
  world.ego.x = -400; world.ego.y = 400;
  const lane = world.map.lane("w_in", 0), p = pointAt(lane.pts, lane.cum, 120);
  const car = new Vehicle(p[0], p[1], 0, 9);
  Object.assign(car, { id: "inner", v0: 9, driver: { aMax: 1.5, b: 2, s0: 2, T: 1.2, react: 0.5, lcRate: 0 }, stopMem: new StopMemory(), frozen: 0, waiting: 0 });
  car.path = new NpcPath(world.map, fleet.random);
  car.path.start("w_in", 0, 120, [["e_out", 0]]);
  fleet.vehicles.push(car);
  const lp = pointAt(lane.pts, lane.cum, 20);
  const amb = new Vehicle(lp[0], 0, 0, 13, (await import("../static/js/sim/vehicle.js")).AMBULANCE);
  Object.assign(amb, { id: "ambulance_t", kind: "ambulance", siren: true, side: -HALF, age: 0, v0: 15, driver: { aMax: 2.2, b: 3, s0: 3, T: 0.9, react: 0.3, lcRate: 0 }, stopMem: new StopMemory(), frozen: 0, waiting: 0, blockedBy: null, blockedFor: 0 });
  amb.path = new NpcPath(world.map, fleet.random);
  amb.path.start("w_in", 0, 20, [["e_out", 0]]);
  fleet.vehicles.push(amb);
  fleet.retireEmergency = () => {};   // (the driven car is off the streets)
  let right = 0, clear = false, closest = Infinity;
  for (let k = 0; k < 30 * 60; k++) {
    fleet.step(1 / 60);
    world.t += 1 / 60;
    right = Math.max(right, -car.y - HALF);
    const gap = amb.x - amb.spec.rearOverhang - (car.x + 3.6);
    if (gap > 40) clear = true;
    if (clear) closest = Math.min(closest, gap);
  }
  assert.ok(right > 3.2 - 0.2, `moved ${right.toFixed(2)} m right, into the curb lane`);
  assert.ok(clear && closest > 30, `hung back: ${closest.toFixed(1)} m at closest once it was 40 m ahead`);
  // and does not close in on one standing 123 m ahead
  amb.frozen = 1e9; amb.v = 0;
  car.x = amb.x - amb.spec.rearOverhang - 123 - 3.6; car.y = -HALF - 3.2; car.v = 0; car.path.start("w_in", 1, ARM + car.x, [["e_out", 1]]);
  const start = car.x;
  for (let k = 0; k < 15 * 60; k++) { fleet.step(1 / 60); world.t += 1 / 60; }
  assert.ok(car.x - start < 0.5, `stayed back: moved ${(car.x - start).toFixed(2)} m`);
  console.log("✓ traffic moves into the curb lane to pull over, and hangs back from the ambulance once it has gone by");
}

{
  // a car that stands in its lane without pulling over fails to yield when the ambulance gets past
  // it anyway
  const { world, fleet } = setup({ front: -120, v: 0 });
  fleet.dispatchEmergency({ relation: "behind", kind: "ambulance", distance: 70 });
  let failed = 0;
  for (let k = 0; k < 25 * 60; k++) {
    stepWorld({ world, fleet, autopilot: { enabled: false, step() {} }, input: {} }, 1 / 60, world.t * 1000);
    for (const e of world.events) if (e.type === "failed_to_yield") failed++;
  }
  assert.equal(failed, 1);
  console.log("✓ the audit counts a car that stands in its lane while the vehicle gets past it");
}
