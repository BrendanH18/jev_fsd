// Slow down, move over (BC MVA Regulations s. 47.02): the speed to pass a vehicle stopped at the
// roadside with its lights flashing at, who the rule holds for, the free-drive stops, traffic slowing
// past them, the car's sensing, its move-over lane change, what models are told, coaching, and the
// "Move over" challenge, where moving over (or slowing to 40) is what keeps the tow truck's operator
// safe.
// node --experimental-default-type=module scripts/test_roadside.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
globalThis.document = { querySelector: () => null };
const { MapData, pointAt, headingAt } = await import("../static/js/map/mapdata.js");
const { World } = await import("../static/js/sim/world.js");
const { NpcFleet, NpcPath } = await import("../static/js/sim/npc.js");
const { Vehicle, CAR, TOW_TRUCK } = await import("../static/js/sim/vehicle.js");
const { StopMemory } = await import("../static/js/sim/signals.js");
const { stepWorld } = await import("../static/js/sim/step.js");
const { setWeather } = await import("../static/js/sim/weather.js");
const { APPROACH_M, ROADSIDE_COUNT, SLOW_MPS, endsOf, passLimit, roadsideRelation } = await import("../static/js/sim/roadside.js");
const { DriveScore, SPEED_GRACE_MPS } = await import("../static/js/sim/drive-score.js");
const { buildSnapshot } = await import("../static/js/brain/sensors.js");
const { sampleCandidates } = await import("../static/js/brain/candidates.js");
const { toJevState, situationClauses } = await import("../static/js/brain/state.js");
const { SYSTEM_PROMPT } = await import("../static/js/brain/llm-prompt.js");
const { CHALLENGES } = await import("../static/js/lab/challenges.js");
const { setupChallenge } = await import("../static/js/lab/evaluation.js");
const { DriveRecorder } = await import("../static/js/lab/recorder.js");
const { Route } = await import("../static/js/map/route.js");
const { routeFromLanes } = await import("../static/js/demo/routing.js");

let checks = 0;
function test(name, fn) { fn(); checks++; console.log(`✓ ${name}`); }
const root = new URL("../data/maps/", import.meta.url);
const load = (key) => {
  const pack = JSON.parse(fs.readFileSync(new URL(`${key}.v6.pack.json`, root)));
  for (const name of ["transit", "crossings", "zones", "rail"]) {
    const url = new URL(`${key}.${name}.v1.json`, root);
    if (fs.existsSync(url)) pack[name] = JSON.parse(fs.readFileSync(url));
  }
  pack.utc_offset = -6;
  return new MapData(pack);
};
const WPG = load("19bb885c9cae");
const kmh = (v) => v * 3.6;
const step = (ctx) => stepWorld(ctx, 1 / 60, ctx.world.t * 1000);
const idle = { enabled: false, step() {} };
const challenge = CHALLENGES.find((c) => c.id === "move-over");
// Princess Street, three lanes one way with parking on both sides: a tow truck at the right curb 90 m
// along it, and a world with nothing else in it
const PRINCESS = WPG.edges.get("e420");
function princess({ kind = "tow_truck" } = {}) {
  setWeather("dry");
  const world = new World(WPG, { seed: 3, parked: 0, pedestrians: 0 });
  const stop = world.roadside.place({ edge: PRINCESS.id, from: 85, to: 98, kind });
  return { world, stop, truck: stop.vehicle };
}
// The car `back` metres behind the truck's rear (front bumper), in lane `idx` (2 is the curb lane),
// at `v`, with a route straight on.
function drive(world, truck, { idx = 2, back = 50, v = 13.9 } = {}) {
  const lane = WPG.lane(PRINCESS.id, idx), FRONT = CAR.length - CAR.rearOverhang;
  const s = 91.2 - back - FRONT;
  world.placeOnLane(lane, s);
  world.ego.v = v;
  world.resetContactHistory();
  const next = WPG.lane("e421", idx);
  world.route = new Route(routeFromLanes(WPG, [lane, next], s, next.length - 5), WPG, world.ego.spec);
  return lane;
}

test("the speed to pass at: 40 km/h under an 80 km/h limit, 70 at 80 or more, never above the limit", () => {
  assert.equal(Math.round(kmh(passLimit(50 / 3.6))), 40);
  assert.equal(Math.round(kmh(passLimit(30 / 3.6))), 30);
  assert.equal(Math.round(kmh(passLimit(79 / 3.6))), 40);
  assert.equal(Math.round(kmh(passLimit(80 / 3.6))), 70);
  assert.equal(Math.round(kmh(passLimit(100 / 3.6))), 70);
});

test("it holds from 30 m short of the vehicle's rear until past it, for drivers going its way with it on their right", () => {
  const { world, truck } = princess();
  const at = (idx, s, psi = null) => { const lane = WPG.lane(PRINCESS.id, idx); world.placeOnLane(lane, s); if (psi !== null) world.ego.psi += psi; return roadsideRelation(world.ego, truck); };
  const curb = at(2, 50);
  assert.ok(curb && curb.adjacent && curb.ahead_m > APPROACH_M && !curb.holds, "40 m back: not yet");
  assert.ok(at(2, 70).holds && at(2, 70).adjacent, "20 m back, in the curb lane: it holds, in the lane next to it");
  const middle = at(1, 70);
  assert.ok(middle.holds && !middle.adjacent, "in the next lane over it still holds, but that lane is not next to it");
  assert.ok(at(2, 90).holds && at(2, 90).ahead_m < 0, "beside it");
  assert.equal(at(2, 99 + TOW_TRUCK.length), null, "past it");
  assert.equal(at(2, 70, Math.PI), null, "not coming the other way");
  truck.flashing = false;
  assert.equal(at(2, 70), null, "and not with its lights off");
});

test("in a free drive two stand in bays at the right curb, out of the car's sight; they leave once the car is well away", () => {
  const world = new World(WPG, { seed: 5, roadside: ROADSIDE_COUNT, pedestrians: 0 });
  assert.equal(world.roadside.stops.length, ROADSIDE_COUNT);
  const kinds = new Set();
  for (const stop of world.roadside.stops) {
    const { vehicle: v, car } = stop;
    kinds.add(v.kind);
    assert.ok(world.parked.list.includes(v) && world.parked.list.includes(car), "parked, with the car that goes with it");
    assert.ok(v.flashing && v.stay && car.stay && v.curb === "right");
    const d = Math.hypot(v.x - world.ego.x, v.y - world.ego.y);
    assert.ok(d >= 150 && d <= 460 && !world.visibility.canSee(world.ego, v.x, v.y), `${Math.round(d)} m away, out of sight`);
    assert.ok(stop.bays.length === 2 && stop.bays.every((b) => b.reserved === v), "its two bays are taken");
    // (and nothing else is parked across them)
    for (const o of world.parked.near(v.x, v.y, 15)) if (o !== v && o !== car) assert.ok(Math.hypot(o.x - v.x, o.y - v.y) > 5.5, `${o.id} clear of ${v.id}`);
  }
  assert.ok(new World(WPG, { seed: 5 }).roadside.vehicles.length === 0, "none unless asked for: the benchmark and the challenges have none");
  const stop = world.roadside.stops[0];
  stop.left = 0;
  world.roadside.step(0.1);
  assert.ok(!world.parked.list.includes(stop.vehicle) && !world.roadside.vehicles.includes(stop.vehicle), "its time up and the car away, it leaves");
  assert.ok(stop.bays.every((b) => b.reserved === null), "and frees its bays");
  for (let t = 0; t < 6; t += 0.5) world.roadside.step(0.5);
  assert.equal(world.roadside.stops.length, ROADSIDE_COUNT, "and another turns up elsewhere");
  // (kinds over many: both turn up)
  for (let seed = 1; seed < 8; seed++) new World(WPG, { seed, roadside: 2, pedestrians: 0 }).roadside.stops.forEach((s) => kinds.add(s.kind));
  assert.deepEqual([...kinds].sort(), ["police", "tow_truck"]);
});

test("the cars at a roadside stop never open a door or pull out", () => {
  const world = new World(WPG, { seed: 5, roadside: ROADSIDE_COUNT, pedestrians: 0 });
  const fleet = new NpcFleet(world, { count: 0, bikes: 0, seed: 5 });
  const stay = new Set(world.roadside.stops.flatMap((s) => [s.vehicle, s.car]));
  for (const { vehicle } of world.roadside.stops) {
    // the car 40 m behind it, in the curb lane
    const near = WPG.nearestLane(...endsOf(vehicle).rear, vehicle.psi, 8);
    world.placeOnLane(near.lane, Math.max(1, near.s - 40));
    for (let k = 0; k < 30; k++) {
      world.parked.nextDoor = 0; world.parked.step(0.1, world);
      const pulled = fleet.maybePullOut();
      assert.ok(!pulled || ![...stay].some((c) => c.id === pulled.id || (Math.abs(c.x - pulled.x) < 0.01 && Math.abs(c.y - pulled.y) < 0.01)), "no pull-out from a stop");
    }
    assert.ok(![...stay].some((c) => c.door), "no door opened");
  }
});

test("traffic slows to 40 km/h past one, in every lane going its way, and speeds up again after", () => {
  const { world, truck } = princess();
  const fleet = new NpcFleet(world, { count: 0, bikes: 0, seed: 2 });
  world.placeOnLane(WPG.lane("e421", 0), 50);   // (the driven car out of the way)
  const cars = [2, 1].map((idx, i) => {
    const lane = WPG.lane(PRINCESS.id, idx), s = 5;
    const car = new Vehicle(...pointAt(lane.pts, lane.cum, s), headingAt(lane.pts, lane.cum, s), 13.9);
    Object.assign(car, { id: `t${i}`, v0: 13.9, driver: { aMax: 1.5, b: 2, s0: 2, T: 1.2, react: 0.5, lcRate: 0 }, stopMem: new StopMemory(), path: new NpcPath(WPG, fleet.random), frozen: 0, waiting: 0 });
    car.path.start(PRINCESS.id, idx, s, [["e421", idx]]);
    fleet.vehicles.push(car);
    return car;
  });
  const ctx = { world, fleet, autopilot: idle };
  const top = cars.map(() => 0), after = cars.map(() => 0);
  for (let k = 0; k < 60 * 18; k++) {
    step(ctx);
    cars.forEach((c, i) => {
      const r = roadsideRelation(c, truck);
      if (r?.holds) top[i] = Math.max(top[i], c.v);
      else if (!r && c.v > after[i]) after[i] = c.v;
    });
  }
  cars.forEach((c, i) => {
    assert.ok(top[i] > 0 && kmh(top[i]) < 40 + SPEED_GRACE_MPS * 3.6, `lane ${2 - i}: ${kmh(top[i]).toFixed(1)} km/h past it`);
    assert.ok(kmh(after[i]) > 40 + SPEED_GRACE_MPS * 3.6, `then back up to ${kmh(after[i]).toFixed(1)} km/h`);
  });
});

test("sensing: the car in the lane next to it slows, and is offered the lane to its left to move over into", () => {
  const { world, truck } = princess();
  drive(world, truck, { back: 50 });
  const snap = buildSnapshot(world), rs = snap.roadside_stop;
  assert.ok(rs && rs.id === truck.id && rs.kind === "tow_truck" && rs.lights === "amber");
  assert.ok(Math.abs(rs.gap_m - 50) < 1.5, `${rs.gap_m.toFixed(1)} m to its rear`);
  assert.equal(Math.round(kmh(rs.limit_mps)), 40);
  assert.ok(rs.in_adjacent_lane && rs.other_lane && rs.adjacent_delta === 0);
  assert.ok(snap.target.v < 13.9 && snap.target.reasons.includes("tow truck ahead, lights flashing"));
  assert.equal(snap.lane.sides.left.offer, "move_over");
  const change = sampleCandidates(snap, world).find((c) => c.change?.offer === "move_over");
  assert.ok(change && change.id.startsWith("change_left") && /move over to the left lane, away from the stopped tow truck/.test(change.steer));
  // within 30 m of it, 40 km/h is the limit: nothing faster is on offer
  drive(world, truck, { back: 20 });
  const close = buildSnapshot(world);
  assert.equal(Math.round(kmh(close.limit)), 40);
  assert.ok(close.target.reasons.includes("passing a tow truck with its lights flashing"));
  assert.ok(sampleCandidates(close, world).every((c) => !c.law.vTarget || c.law.vTarget <= close.limit + 1e-6));
  // in the next lane over: slowed, but nothing to move over for
  drive(world, truck, { idx: 1, back: 20 });
  const middle = buildSnapshot(world);
  assert.ok(middle.roadside_stop && !middle.roadside_stop.in_adjacent_lane && Math.round(kmh(middle.limit)) === 40);
  assert.ok(!Object.values(middle.lane.sides).some((s) => s.offer === "move_over"));
  // too close to it to start moving over
  drive(world, truck, { back: 3 });
  assert.ok(!Object.values(buildSnapshot(world).lane.sides).some((s) => s.offer === "move_over"));
  // out of sight it is not sensed, and with its lights off it is a parked truck
  truck.flashing = false;
  drive(world, truck, { back: 60 });
  assert.equal(buildSnapshot(world).roadside_stop, null);
});

test("on a street with one lane its way the car slows, with no lane to move over into", () => {
  setWeather("dry");
  const world = new World(WPG, { seed: 3, parked: 0, pedestrians: 0 });
  // (the first such street along which the car sees it: one without a bend)
  let truck = null, lane = null;
  for (const e of [...WPG.edges.values()].filter((x) => x.lanes === 1 && !x.ring && x.parking?.[1] > 1.8 && x.cum.at(-1) > 110 && x.limit > SLOW_MPS + 1)) {
    const stop = world.roadside.place({ edge: e.id, from: 70, to: 83, kind: "police" });
    lane = WPG.lane(e.id, 0);
    world.placeOnLane(lane, 40);
    if (world.sees(world.ego, stop.vehicle)) { truck = stop.vehicle; break; }
    world.roadside.retire(stop);
  }
  assert.ok(truck, "a straight street with one lane each way and a parking lane");
  world.route = new Route(routeFromLanes(WPG, [lane], 40, lane.length - 2), WPG, world.ego.spec);
  const snap = buildSnapshot(world);
  assert.ok(snap.roadside_stop && snap.roadside_stop.id === truck.id && snap.roadside_stop.lights === "red and blue");
  assert.ok(snap.roadside_stop.in_adjacent_lane && !snap.roadside_stop.other_lane);
  assert.ok(situationClauses(snap).some((l) => /police car .* red and blue lights flashing.*no other lane going the car's way/.test(l)));
});

test("decision models and LLMs are told to slow down and move over", () => {
  const { world, truck } = princess();
  drive(world, truck, { back: 60 });
  const snap = buildSnapshot(world), candidates = sampleCandidates(snap, world);
  for (const c of candidates) c.sim = { end_speed: 11, progress_m: 30, lane_err_end: 0, heading_err_deg: 0, max_decel: 0, max_lateral_accel: 0, min_clearance_m: 3, min_gap_m: Infinity, collision: null, stays_on_road: true, stays_in_lane: true };
  const state = toJevState(snap, candidates, {});
  assert.deepEqual(state.roadside_vehicle, { id: truck.id, kind: "tow truck", lights: "amber", gap_m: state.roadside_vehicle.gap_m, pass_at: 11.1, in_lane_next_to_it: true, move_over: true });
  const line = situationClauses(snap).find((l) => l.includes(truck.id));
  assert.ok(/Slow to 40 km\/h/.test(line) && /move over: a `change_left_\*` candidate/.test(line), line);
  assert.ok(candidates.some((c) => c.change?.offer === "move_over"));
  assert.ok(SYSTEM_PROMPT.includes("roadside_vehicle") && SYSTEM_PROMPT.includes("away from a vehicle stopped at the roadside"));
  // moved over, its route in the curb lane: told to stay out of the lane next to it until past it
  drive(world, truck, { back: 20 });
  world.ego.x -= Math.sin(world.ego.psi) * PRINCESS.lane_width; world.ego.y += Math.cos(world.ego.psi) * PRINCESS.lane_width;
  const over = buildSnapshot(world);
  assert.ok(situationClauses(over).some((l) => /keep out of the lane next to it until past it/.test(l)));
  assert.ok(situationClauses(over).some((l) => /to return once past the tow truck/.test(l)));
});

test("coaching: passing too fast, and in the lane next to it, each counted once", () => {
  const { world, truck } = princess();
  drive(world, truck, { back: 40 });
  const score = new DriveScore(world, { title: "test" });
  // straight on down the curb lane at 50 km/h
  for (let t = 0; t < 7; t += 1 / 60) {
    world.ego.x += Math.cos(world.ego.psi) * 13.9 / 60; world.ego.y += Math.sin(world.ego.psi) * 13.9 / 60; world.ego.v = 13.9;
    score.record(world, world.roadInfo(), 1 / 60);
  }
  const report = score.finish();
  assert.equal(report.incidents.filter((i) => i.type === "roadside_speeding").length, 1);
  assert.equal(report.incidents.filter((i) => i.type === "no_move_over").length, 1);
  assert.ok(report.roadside_speeding_s > 2 && report.no_move_over === 1 && report.categories.legality < 90);
  assert.ok(report.tips.some((t) => /move out of the lane next to it/.test(t)));
  // at 40 in the next lane over: nothing
  const quiet = princess();
  drive(quiet.world, quiet.truck, { idx: 1, back: 40, v: SLOW_MPS });
  const calm = new DriveScore(quiet.world, { title: "test" });
  for (let t = 0; t < 8; t += 1 / 60) {
    const ego = quiet.world.ego;
    ego.x += Math.cos(ego.psi) * SLOW_MPS / 60; ego.y += Math.sin(ego.psi) * SLOW_MPS / 60;
    calm.record(quiet.world, quiet.world.roadInfo(), 1 / 60);
  }
  const fine = calm.finish();
  assert.equal(fine.roadside_speeding_s, 0); assert.equal(fine.no_move_over, 0);
  // boxed in, a car alongside in the lane to the left all the way up: not counted
  const boxed = princess();
  drive(boxed.world, boxed.truck, { back: 40, v: SLOW_MPS });
  const beside = new Vehicle(boxed.world.ego.x - Math.sin(boxed.world.ego.psi) * PRINCESS.lane_width, boxed.world.ego.y + Math.cos(boxed.world.ego.psi) * PRINCESS.lane_width, boxed.world.ego.psi, SLOW_MPS);
  boxed.world.npcs = [beside];
  const held = new DriveScore(boxed.world, { title: "test" });
  for (let t = 0; t < 7; t += 1 / 60) {
    for (const o of [boxed.world.ego, beside]) { o.x += Math.cos(o.psi) * SLOW_MPS / 60; o.y += Math.sin(o.psi) * SLOW_MPS / 60; }
    held.record(boxed.world, boxed.world.roadInfo(), 1 / 60);
  }
  assert.equal(held.finish().no_move_over, 0, "it could not move over");
  // nor with a faster car coming up close behind in the lane to the left all the way up
  const closing = princess();
  drive(closing.world, closing.truck, { back: 40, v: SLOW_MPS });
  const e = closing.world.ego, back = new Vehicle(e.x - Math.sin(e.psi) * PRINCESS.lane_width - Math.cos(e.psi) * 15, e.y + Math.cos(e.psi) * PRINCESS.lane_width - Math.sin(e.psi) * 15, e.psi, SLOW_MPS + 3);
  closing.world.npcs = [back];
  const blocked = new DriveScore(closing.world, { title: "test" });
  for (let t = 0; t < 4.5; t += 1 / 60) {
    for (const o of [e, back]) { o.x += Math.cos(o.psi) * o.v / 60; o.y += Math.sin(o.psi) * o.v / 60; }
    blocked.record(closing.world, closing.world.roadInfo(), 1 / 60);
  }
  assert.equal(blocked.finish().no_move_over, 0, "the gap behind was never long enough");
  // nor when the lane to the left clears only a few metres short of it, too late to get across
  const late = princess();
  drive(late.world, late.truck, { back: 30, v: SLOW_MPS });
  const le = late.world.ego, along = new Vehicle(le.x - Math.sin(le.psi) * PRINCESS.lane_width, le.y + Math.cos(le.psi) * PRINCESS.lane_width, le.psi, SLOW_MPS);
  late.world.npcs = [along];
  const tooLate = new DriveScore(late.world, { title: "test" });
  for (let t = 0; t < 5; t += 1 / 60) {
    for (const o of [le, along]) { o.x += Math.cos(o.psi) * o.v / 60; o.y += Math.sin(o.psi) * o.v / 60; }
    if (roadsideRelation(le, late.truck)?.ahead_m < 4) late.world.npcs = [];
    tooLate.record(late.world, late.world.roadInfo(), 1 / 60);
  }
  assert.equal(tooLate.finish().no_move_over, 0, "it cleared too late to move over");
  // and at 70 km/h, clearing 20 m short of it is too late too (1.5 s is 29 m)
  const fastLate = princess();
  drive(fastLate.world, fastLate.truck, { back: 30, v: 70 / 3.6 });
  const fe = fastLate.world.ego, alongFast = new Vehicle(fe.x - Math.sin(fe.psi) * PRINCESS.lane_width, fe.y + Math.cos(fe.psi) * PRINCESS.lane_width, fe.psi, fe.v);
  fastLate.world.npcs = [alongFast];
  const fastScore = new DriveScore(fastLate.world, { title: "test" });
  for (let t = 0; t < 3; t += 1 / 60) {
    for (const o of [fe, alongFast]) { o.x += Math.cos(o.psi) * o.v / 60; o.y += Math.sin(o.psi) * o.v / 60; }
    if (roadsideRelation(fe, fastLate.truck)?.ahead_m < 20) fastLate.world.npcs = [];
    fastScore.record(fastLate.world, fastLate.world.roadInfo(), 1 / 60);
  }
  assert.equal(fastScore.finish().no_move_over, 0, "at 70 km/h it cleared too late");
  assert.ok(SPEED_GRACE_MPS > 0);
});

// The challenge, closed-loop.
const WINNIPEG = WPG;
function runChallenge({ brain = "rules", lightsOff = false, limit = null } = {}) {
  const ctx = setupChallenge(WINNIPEG, challenge, { brain }), { world } = ctx;
  const truck = world.roadside.vehicles[0], edge = world.map.edges.get(truck.edge), was = edge.limit;
  if (lightsOff) truck.flashing = false;
  if (limit) edge.limit = limit;
  const out = { top: 0, adjacentBeside: false, moved: false, collision: null, triggered: false, passed: false };
  for (let k = 0; k < 60 * 30 && ctx.autopilot.enabled && !out.passed; k++) {
    step(ctx);
    const r = roadsideRelation(world.ego, { ...truck, flashing: true, roadside: true, spec: truck.spec, x: truck.x, y: truck.y, psi: truck.psi });
    if (r?.holds) out.top = Math.max(out.top, world.ego.v);
    if (r && r.ahead_m < 0 && r.adjacent) out.adjacentBeside = true;
    if (r && !r.adjacent && r.ahead_m < 30) out.moved = true;
    out.collision ||= world.events.find((e) => e.type === "collision") || null;
    out.triggered ||= world.challenge.triggered;
    if (!r && world.ego.toLocal(truck.x, truck.y).ahead < -15) out.passed = true;
  }
  edge.limit = was;
  return { ...out, world };
}

test("challenge: a tow truck at the curb on Princess Street, Winnipeg, its operator between it and the car it tows", () => {
  const { world, scenario } = setupChallenge(WINNIPEG, challenge);
  const truck = world.roadside.vehicles[0], op = world.crowd.list.find((p) => p.id === "challenge_operator");
  assert.ok(truck.kind === "tow_truck" && truck.flashing && WINNIPEG.edges.get(truck.edge).name === "Princess Street");
  assert.ok(op && op.dart && op.frozen > 0, "the operator waits for the car");
  const r = roadsideRelation(world.ego, truck);
  assert.ok(r.adjacent && r.ahead_m > 70 && r.ahead_m < 82, `the car starts in the lane next to it, ${r.ahead_m.toFixed(1)} m back`);
  assert.equal(scenario.roadside.edge, truck.edge);
});

test("Rules moves over and slows to 40, and goes by clear of the operator", () => {
  const run = runChallenge();
  assert.ok(run.triggered && run.passed, "the operator stepped out, and the car went by");
  assert.ok(run.moved && !run.adjacentBeside, "it was in the next lane over as it passed");
  assert.ok(kmh(run.top) < 40 + SPEED_GRACE_MPS * 3.6, `${kmh(run.top).toFixed(1)} km/h at most`);
  assert.equal(run.collision, null);
  assert.equal(run.world.violations.failed_to_yield, 0);
});

test("with the truck's lights off, Rules comes by in the curb lane at 50 and hits the operator; at 40 it stops for them", () => {
  const fast = runChallenge({ lightsOff: true });
  assert.ok(fast.adjacentBeside || fast.collision, "it stayed in the lane next to the truck");
  assert.ok(fast.collision && fast.collision.with === "challenge_operator" && fast.collision.at_fault && fast.collision.ego_v > 3, `hit them at ${fast.collision?.ego_v} m/s`);
  const slow = runChallenge({ lightsOff: true, limit: 40 / 3.6 });
  assert.equal(slow.collision, null, "at 40 km/h it stops short of them");
});

test("a checkpoint and restore brings back the roadside stop, tied to the live world", () => {
  const ctx = setupChallenge(WINNIPEG, challenge), { world } = ctx;
  const recorder = new DriveRecorder();
  recorder.record({ world, fleet: ctx.fleet, autopilot: ctx.autopilot, drive: {}, clock: {} }, true);
  const before = world.roadside.vehicles.map((v) => v.id);
  world.roadside.retire(world.roadside.stops[0]);
  assert.equal(world.roadside.vehicles.length, 0);
  const target = { world, fleet: ctx.fleet, autopilot: ctx.autopilot, clock: { setHour() {}, update() {} }, setDrive() {} };
  recorder.restore(0, target);
  assert.deepEqual(world.roadside.vehicles.map((v) => v.id), before);
  assert.ok(world.roadside.vehicles.every((v) => world.parked.list.includes(v)), "the same objects, still parked");
  assert.ok(world.roadside.world === world, "stepping it steps the live world");
});

console.log(`${checks} slow down, move over checks passed`);
process.exit(0);
