// Cars backing out of driveways: the driveways layer; the way a car backs out (the shared car model in
// reverse, creeping, looking, into the near lane, then off as traffic); the one conflict test shared by
// sensing, candidates, traffic and the audit; parked cars hiding it; pedestrians waiting for it; what
// models are told; the "Reverse lights" challenge with Rules and the cautious agent, and a driver who
// ignores the car backing out; checkpoints; and nothing computed, drawn or reported with the option off.
// node --experimental-default-type=module scripts/test_driveway_reversers.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
globalThis.document = { querySelector: () => null };
const { MapData, pointAt, headingAt, projectPoint } = await import("../static/js/map/mapdata.js");
const { World } = await import("../static/js/sim/world.js");
const { NpcFleet, NpcPath } = await import("../static/js/sim/npc.js");
const { Vehicle, CAR } = await import("../static/js/sim/vehicle.js");
const { StopMemory } = await import("../static/js/sim/signals.js");
const { stepWorld } = await import("../static/js/sim/step.js");
const { setWeather } = await import("../static/js/sim/weather.js");
const { applyLaw } = await import("../static/js/sim/controller.js");
const { Pedestrian } = await import("../static/js/sim/pedestrians.js");
const RV = await import("../static/js/sim/driveway-reversers.js");
const { obbOverlap } = await import("../static/js/sim/collision.js");
const { DriveMetrics, failures } = await import("../static/js/bench/metrics.js");
const { buildSnapshot } = await import("../static/js/brain/sensors.js");
const { sampleCandidates, simulateAll } = await import("../static/js/brain/candidates.js");
const { toJevState, situationClauses, buildQuestions } = await import("../static/js/brain/state.js");
const { SYSTEM_PROMPT } = await import("../static/js/brain/llm-prompt.js");
const { CHALLENGES, challengeScenario } = await import("../static/js/lab/challenges.js");
const { setupChallenge, evaluateChallenge } = await import("../static/js/lab/evaluation.js");
const { DriveRecorder } = await import("../static/js/lab/recorder.js");
const { Route } = await import("../static/js/map/route.js");
const { routeFromLanes } = await import("../static/js/demo/routing.js");
const { DriveScore } = await import("../static/js/sim/drive-score.js");

let checks = 0;
async function test(name, fn) { await fn(); checks++; console.log(`✓ ${name}`); }
const root = new URL("../data/maps/", import.meta.url);
const load = (key) => {
  const pack = JSON.parse(fs.readFileSync(new URL(`${key}.v6.pack.json`, root)));
  for (const name of ["transit", "crossings", "zones", "rail", "calming", "scrambles", "buslanes", "restrictions", "contraflow", "driveways", "parks"]) {
    const url = [2, 1].map(v => new URL(`${key}.${name}.v${v}.json`, root)).find(u => fs.existsSync(u));
    if (url) pack[name] = JSON.parse(fs.readFileSync(url));
  }
  return new MapData(pack);
};
const CGY = load("a53c5bcf6438"), OTT = load("d25b07def0d2");
const step = (ctx) => stepWorld(ctx, 1 / 60, ctx.world.t * 1000);
const idle = { enabled: false, step() {} };
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const lesson = CHALLENGES.find(c => c.id === "reverse-lights");
const scenario = challengeScenario(CGY, lesson);
const D = CGY.driveways.find(d => d.id === scenario.reverser.driveway);

function world({ map = CGY, driveways = true, seed = 3, hazards = false, traffic = 0, parked = 0, pedestrians = 0 } = {}) {
  setWeather("dry");
  const w = new World(map, { seed, parked, pedestrians, driveways, hazards });
  const fleet = new NpcFleet(w, { count: traffic, bikes: 0, seed: 5 });
  w.parked.nextDoor = 1e9; fleet.nextPark = 1e9; fleet.nextPull = 1e9;
  if (driveways) w.driveways.target = 0;
  return { world: w, fleet, autopilot: idle };
}
// The driven car in the kerb lane of the challenge's street, `back` metres short of the driveway, with a
// route along it past it.
function egoAt(ctx, back, v = 0) {
  const e = CGY.edges.get(D.edge), lane = CGY.lane(e.id, e.lanes - 1), k = lane.length / e.length;
  const s = (D.s - back) * k - (CAR.length - CAR.rearOverhang);
  ctx.world.placeOnLane(lane, s);
  ctx.world.ego.v = v;
  ctx.world.route = new Route(routeFromLanes(CGY, [lane], s, (D.s + 30) * k), CGY, ctx.world.ego.spec);
  return lane;
}
function runUntil(ctx, cond, seconds) {
  for (let k = 0; k < seconds * 60; k++) { step(ctx); if (cond()) return true; }
  return false;
}

await test("the layer: driveways beside every pack, mapped onto two-way streets' right side", () => {
  for (const map of [CGY, OTT]) {
    assert.equal(map.driveways.length > 100, true);
    for (const d of map.driveways) {
      const e = map.edges.get(d.edge);
      assert.equal(!!e, true);
      if (d.side === "left") assert.equal(!!e.oneway, true, d.id);
    }
  }
  assert.equal(D.side, "right");
  assert.equal(CGY.edges.get(D.edge).name, "13 Avenue SW");
});

await test("the way out: straight back across the sidewalk, then an arc into the near lane, facing the traffic", () => {
  const g = RV.drivewayGeometry(CGY, D, CAR), e = g.e;
  assert.equal(g.laneIdx, e.lanes - 1);
  assert.equal(g.sCheck > 1 && g.sCheck < g.sEnd - 3, true);
  // (it starts behind the sidewalk, nose in, and ends in the lane's centre facing the edge's way)
  const lp = projectPoint(g.lane.pts, g.lane.cum, [g.end.x, g.end.y]);
  assert.equal(Math.abs(lp.lateral) < 0.05, true);
  assert.equal(Math.abs(wrap(g.end.psi - g.h)) < 0.01, true);
  assert.equal(Math.abs(wrap(g.start.psi - (g.h - Math.PI / 2))) < 0.01, true);
  // (where it stops to look, all of its body is LOOK_GAP_M outside the lane)
  const p = g.path.pointAt(g.sCheck), psi = g.path.headingAt(g.sCheck) + Math.PI, f = CAR.length / 2 - CAR.rearOverhang;
  const box = { center: [p[0] + Math.cos(psi) * f, p[1] + Math.sin(psi) * f], heading: psi, halfLength: CAR.length / 2, halfWidth: CAR.width / 2 };
  const laneBox = { center: pointAt(g.lane.pts, g.lane.cum, g.laneS - 4), heading: g.h, halfLength: 12, halfWidth: e.lane_width / 2 };
  assert.equal(RV.boxGap(box, laneBox) > RV.LOOK_GAP_M - 0.15, true);
});

await test("the car model in reverse: creep, look, back into the lane, pause, then off as traffic", () => {
  const ctx = world();
  egoAt(ctx, 160);
  const r = ctx.world.driveways.place(D);
  assert.equal(r.phase, "creep"); assert.equal(r.reverseLamps, true);
  const seen = new Set(); let fastest = 0, lampsInOut = true;
  const done = runUntil(ctx, () => {
    if (r.phase !== "gone") { seen.add(r.phase); fastest = Math.max(fastest, -r.v); if (r.phase === "out" && !r.reverseLamps) lampsInOut = false; }
    return r.phase === "gone";
  }, 40);
  assert.equal(done, true);
  assert.deepEqual([...seen], ["creep", "look", "out", "pause"]);
  assert.equal(fastest <= RV.REVERSE_MPS + 0.1, true, `reversed at ${fastest}`);
  assert.equal(lampsInOut, true);
  // (it drives on in the lane as an ordinary car, from where it stopped, facing the traffic)
  const car = ctx.fleet.vehicles.find(v => v.id === `${r.id}_away`);
  assert.equal(!!car, true);
  const g = r.geo, lp = projectPoint(g.lane.pts, g.lane.cum, [car.x, car.y]);
  assert.equal(Math.abs(lp.lateral) < 0.35, true, `lateral ${lp.lateral}`);
  assert.equal(Math.abs(wrap(car.psi - g.h)) < 6 * Math.PI / 180, true);
  assert.equal(ctx.world.driveways.cars.length, 0);
  runUntil(ctx, () => false, 5);
  assert.equal(car.v > 2, true);
  assert.equal(ctx.world.violations.collisions, 0);
});

await test("the conflict test: slow for one backing out toward the lane, stop for one coming into it; only along its lane", () => {
  const ctx = world();
  egoAt(ctx, 60);
  const r = ctx.world.driveways.place(D, { trigger: 0, routeS: 0 });
  const route = ctx.world.route, front = route.project(ctx.world.ego.x, ctx.world.ego.y).s + CAR.length - CAR.rearOverhang;
  assert.equal(RV.reverserConflict(r, route, { front }), null);   // (still parked)
  r.phase = "look";
  const coming = RV.reverserConflict(r, route, { front });
  assert.equal(coming.kind, "coming");
  assert.equal(coming.gap_m > 40 && coming.gap_m < 60, true, `gap ${coming.gap_m}`);
  r.phase = "out";
  assert.equal(RV.reverserConflict(r, route, { front }).kind, "in_lane");
  // (traffic coming the other way, in the other lane, is not in its way)
  const e = CGY.edges.get(D.edge), twin = [...CGY.edges.values()].find(o => o.from === e.to && o.to === e.from);
  const other = CGY.lane(twin.id, twin.lanes - 1);
  assert.equal(RV.reverserConflict(r, other, { front: 5 }), null);
  // (the caution speed: CAUTION_MPS by CAUTION_AT_M short of it, more further off)
  assert.equal(Math.abs(RV.cautionSpeed(RV.CAUTION_AT_M) - RV.CAUTION_MPS) < 1e-9, true);
  assert.equal(RV.cautionSpeed(40) > RV.cautionSpeed(20), true);
});

await test("it looks before going into the lane: waits for a car coming close, goes for one far off or waiting", () => {
  const ctx = world();
  egoAt(ctx, 25, 9);
  const r = ctx.world.driveways.place(D, { trigger: 0, routeS: 0 });
  r.phase = "look";
  assert.equal(ctx.world.driveways.laneClear(r), false);
  ctx.world.ego.v = 0;
  assert.equal(ctx.world.driveways.laneClear(r), true);   // (standing short of it: waiting for it)
  egoAt(ctx, 110, 9);
  assert.equal(ctx.world.driveways.laneClear(r), true);
});

await test("cars parked at the kerb hide it from the driven car (hidden hazards on), and the driven car from it", () => {
  const ctx = world({ hazards: true });
  egoAt(ctx, 45);
  const r = ctx.world.driveways.place(D, { trigger: 0, routeS: 0 });
  // (a wall of parked cars along the kerb short of the driveway)
  const e = CGY.edges.get(D.edge), lat = e.asphalt[1] - e.parking[1] / 2;
  for (let s = D.s - 46; s < D.s - 5; s += 5) {
    const p = pointAt(e.pts, e.cum, s), h = headingAt(e.pts, e.cum, s);
    const c = new Vehicle(p[0] + Math.sin(h) * lat, p[1] - Math.cos(h) * lat, h, 0);
    Object.assign(c, { id: `wall_${Math.round(s)}`, stay: true }); ctx.world.parked.add(c);
  }
  assert.equal(RV.reverserHidden(ctx.world, ctx.world.ego, r), true);
  assert.equal(ctx.world.sees(ctx.world.ego, r), false);
  ctx.world.hazards = false;
  assert.equal(ctx.world.sees(ctx.world.ego, r), true);
});

await test("the driven car's sensing, candidates and rejections", () => {
  const ctx = world();
  egoAt(ctx, 45, 8);
  const r = ctx.world.driveways.place(D, { trigger: 0, routeS: 0 });
  r.phase = "look"; r.reverseLamps = true;
  let snap = buildSnapshot(ctx.world);
  assert.equal(snap.reversing_vehicle.wait, false);
  assert.equal(snap.reversing_vehicle.reverse_lights, true);
  assert.equal(snap.limit <= snap.reversing_vehicle.limit_mps + 1e-9, true);
  r.phase = "out";
  egoAt(ctx, 32, 8);
  snap = buildSnapshot(ctx.world);
  const rv = snap.reversing_vehicle;
  assert.equal(rv.wait, true);
  assert.equal(rv.bumper_to_stop_m > 8 && rv.bumper_to_stop_m < 25, true, `stop in ${rv.bumper_to_stop_m}`);
  assert.equal(snap.target.v < Math.sqrt(2 * 3 * rv.bumper_to_stop_m), true);
  const cands = sampleCandidates(snap, ctx.world);
  const { eligible } = simulateAll(cands, snap, ctx.world);
  const yieldTo = cands.find(c => c.id === "yield_to_reversing");
  assert.equal(!!yieldTo && yieldTo.eligible, true);
  assert.equal(Math.abs(yieldTo.law.stopAtRoute - (rv.stop_s_route - (CAR.length - CAR.rearOverhang) - 0.5)) < 1e-6, true);
  // (driving on at speed takes the car past where it stops for it)
  const on = { id: "keep_on", law: { ...yieldTo.law, stopAtRoute: undefined, stopAt: undefined, vTarget: 9 } };
  delete on.law.stopAtRoute;
  simulateAll([on], snap, ctx.world);
  assert.equal(on.reject, "passes_reversing_vehicle_too_close");
  assert.equal(eligible.some(c => c.id === "yield_to_reversing"), true);
  // what models are told
  const state = toJevState(snap, eligible, {});
  assert.equal(state.reversing_vehicle.yield, true);
  assert.equal(situationClauses(snap).some(c => c.includes("`yield_to_reversing`")), true);
  assert.equal(!!buildQuestions(snap, eligible).questions.motion, true);
  assert.equal(buildQuestions(snap, eligible).questions.motion.criteria.stop.includes("reversing_vehicle.wait_in_m"), true);
  assert.equal(SYSTEM_PROMPT.includes("`yield_to_reversing`"), true);
});

await test("traffic slows for one backing out and stops for one coming into its lane, then goes on", () => {
  const ctx = world();
  egoAt(ctx, 200);
  const e = CGY.edges.get(D.edge), lane = CGY.lane(e.id, e.lanes - 1), k = lane.length / e.length;
  const s0 = (D.s - 60) * k, p = pointAt(lane.pts, lane.cum, s0);
  const car = new Vehicle(p[0], p[1], headingAt(lane.pts, lane.cum, s0), 8);
  Object.assign(car, { id: "through", color: 0, v0: 8, driver: { aMax: 1.3, b: 2, s0: 2, T: 1.4, react: 0.5, lcRate: 0 }, stopMem: new StopMemory(), path: new NpcPath(CGY, ctx.fleet.random), frozen: 0, waiting: 0 });
  car.path.start(e.id, lane.idx, s0); ctx.fleet.vehicles.push(car);
  const r = ctx.world.driveways.place(D, { trigger: 0, routeS: 0 });
  // (out at once, the through car 60 m off)
  r.phase = "look"; r.waited = 10; r.reverseLamps = true;
  let stopped = false, minGap = Infinity;
  runUntil(ctx, () => {
    if (r.phase === "out" || r.phase === "pause") { if (car.v < 0.1) stopped = true; minGap = Math.min(minGap, RV.boxGap(car.obb(), r.obb())); }
    return r.phase === "gone";
  }, 40);
  assert.equal(stopped, true);
  assert.equal(minGap > 1.5, true, `gap ${minGap}`);
  runUntil(ctx, () => false, 8);
  assert.equal(car.v > 2, true);
  assert.equal(ctx.world.violations.collisions, 0);
});

await test("people on the sidewalk wait for it to go by", () => {
  const ctx = world();
  egoAt(ctx, 200);
  const r = ctx.world.driveways.place(D);
  const g = r.geo, e = g.e, h = g.h;
  // (on the sidewalk, 4 m upstream of the driveway, walking toward it)
  const out = e.asphalt[1] + 0.3 + 0.22 + 1.8 + 0.75, q = [g.q[0] - Math.cos(h) * 4 + Math.sin(h) * out, g.q[1] - Math.sin(h) * 4 - Math.cos(h) * out];
  const to = [q[0] + Math.cos(h) * 30, q[1] + Math.sin(h) * 30];
  const ped = new Pedestrian({ id: "walker", x: q[0], y: q[1], psi: h, v: 0, speed: 1.3, home: true, path: [{ p: to }], crossing: null, waiting: 0, phase: 0, look: 0 });
  ctx.world.crowd.list.push(ped);
  let held = 0;
  runUntil(ctx, () => { if (ped.pause > 0 && (r.phase === "creep" || r.phase === "look" || r.phase === "out")) held++; return r.phase === "gone"; }, 40);
  assert.equal(held > 30, true, `held ${held}`);
  assert.equal(ctx.world.violations.collisions, 0);
});

await test("someone already in its way walks on, and it goes once they are by", () => {
  const ctx = world();
  egoAt(ctx, 200);
  const r = ctx.world.driveways.place(D);
  const g = r.geo, e = g.e, h = g.h;
  // (on the sidewalk, 2 m upstream of the driveway, walking toward it: close enough to be in its way)
  const out = e.asphalt[1] + 0.3 + 0.22 + 1.8 + 0.75, q = [g.q[0] - Math.cos(h) * 2 + Math.sin(h) * out, g.q[1] - Math.sin(h) * 2 - Math.cos(h) * out];
  const to = [q[0] + Math.cos(h) * 30, q[1] + Math.sin(h) * 30];
  const ped = new Pedestrian({ id: "close_walker", x: q[0], y: q[1], psi: h, v: 0, speed: 1.3, home: true, path: [{ p: to }], crossing: null, waiting: 0, phase: 0, look: 0 });
  ctx.world.crowd.list.push(ped);
  const start = [ped.x, ped.y];
  runUntil(ctx, () => r.phase === "gone", 60);
  assert.equal(r.phase, "gone");
  assert.equal(Math.hypot(ped.x - start[0], ped.y - start[1]) > 5, true);
  assert.equal(ctx.world.violations.collisions, 0);
});

for (const brain of ["rules", "cautious"]) await test(`"Reverse lights", ${brain}: slows, stops for the car backing out, and arrives cleanly`, async () => {
  const ctx = setupChallenge(CGY, lesson, { brain }), { world: w, autopilot } = ctx;
  assert.equal(w.driveways.enabled, true); assert.equal(w.hazards, true);
  let stoppedFor = false, minGap = Infinity;
  for (let k = 0; k < 90 * 60 && autopilot.enabled; k++) {
    step(ctx);
    if (autopilot.firing) await autopilot.firing;
    const r = w.driveways.cars.find(c => c.id === "challenge_reversing");
    if (r && (r.phase === "out" || r.phase === "pause")) { if (w.ego.v < 0.2) stoppedFor = true; minGap = Math.min(minGap, RV.boxGap(w.ego.obb(), r.obb())); }
  }
  assert.equal(stoppedFor, true);
  assert.equal(minGap > 2, true, `gap ${minGap}`);
  const result = await evaluateChallenge(CGY, lesson, { brain });
  assert.equal(result.pass, true, JSON.stringify(result.failures));
  assert.equal(result.reversing_conflicts, 0);
  assert.equal(result.collisions, 0);
  assert.equal(result.report.reversing_conflicts, 0);
});

await test(`"Reverse lights": a driver who keeps going fails, with reversing_conflicts`, () => {
  const ctx = setupChallenge(CGY, lesson, { brain: "rules" }), w = ctx.world;
  ctx.autopilot.setEnabled(false);
  const blind = { ...ctx, autopilot: idle };
  const metrics = new DriveMetrics(w.route.length);
  const law = { kind: "lane", offset: 0, vTarget: 9 };
  for (let k = 0; k < 40 * 60; k++) {
    const p = w.route.project(w.ego.x, w.ego.y);
    applyLaw(w.ego, { ...law, s0: p.s }, w.route, p.s, 1 / 60, w);
    const road = step(blind);
    metrics.record(w, null, road, 1 / 60);
  }
  assert.equal(w.drivewaysSeen, true);
  assert.equal((w.violations.reversing_conflicts || 0) >= 1, true, JSON.stringify(w.violations));
  const summary = metrics.summary(w, ctx.autopilot, true);
  assert.equal(summary.reversing_conflicts >= 1, true);
  assert.equal(failures(summary).includes("squeezed past or failed to stop for a car backing out"), true);
  console.log(`  (the driver who kept going: ${JSON.stringify({ reversing_conflicts: w.violations.reversing_conflicts, collisions: w.violations.collisions })})`);
});

await test("the challenge's car waits in its driveway however long the driver takes to come along", () => {
  const ctx = { ...setupChallenge(CGY, lesson, { brain: "rules" }), autopilot: idle };
  for (let k = 0; k < 125 * 60; k++) step(ctx);
  const r = ctx.world.driveways.cars.find(c => c.id === "challenge_reversing");
  assert.equal(!!r, true);
  assert.equal(r.phase, "parked");
});

await test("checkpoints: a restored drive replays the car backing out exactly", () => {
  const ctx = setupChallenge(CGY, lesson, { brain: "rules" }), recorder = new DriveRecorder(), clock = {};
  for (let k = 0; k < 9 * 60; k++) step(ctx);
  recorder.record({ ...ctx, drive: null, clock }, true);
  const sig = () => JSON.stringify({ ego: [ctx.world.ego.x, ctx.world.ego.y, ctx.world.ego.v], cars: ctx.world.driveways.cars.map(r => [r.id, r.phase, r.x, r.y, r.v]), npcs: ctx.fleet.vehicles.map(n => [n.id, n.x, n.y]), t: ctx.world.t });
  for (let k = 0; k < 600; k++) step(ctx);
  const first = sig();
  recorder.restore(0, { ...ctx, clock, setDrive: () => {} }); ctx.world.paused = false;
  for (let k = 0; k < 600; k++) step(ctx);
  assert.equal(sig(), first);
});

await test("free drives: one now and then in a driveway ahead on the route, clear of parked cars, from its own stream", () => {
  setWeather("dry");
  // (nothing parked across a driveway's way out, with the option on; as before with it off)
  const parkedOn = new World(CGY, { seed: 4, pedestrians: 0, driveways: true }), parkedOff = new World(CGY, { seed: 4, pedestrians: 0 });
  assert.equal(parkedOn.parked.list.length < parkedOff.parked.list.length, true);
  assert.equal(CGY.driveways.every(d => { const g = RV.drivewayGeometry(CGY, d, CAR); return !g || parkedOn.driveways.clearWay(g); }), true);
  // (and no free parking bay is left there for traffic to park in later)
  let openAcross = 0;
  for (const d of CGY.driveways) {
    const g = RV.drivewayGeometry(CGY, d, CAR);
    if (!g) continue;
    const bays = parkedOn.parked.slots.filter(sl => !sl.occupant && !sl.reserved && Math.abs(sl.x - g.q[0]) < 20 && Math.abs(sl.y - g.q[1]) < 20);
    for (const sl of bays) {
      const box = new Vehicle(sl.x, sl.y, sl.psi, 0, CAR).obb();
      for (let s = 0; s <= g.sEnd; s += 0.5) if (obbOverlap(RV.poseBox(g.path, s, CAR), box, 0.3)) { openAcross++; break; }
    }
  }
  assert.equal(openAcross, 0, `${openAcross} free bays across driveways`);
  const w = new World(CGY, { seed: 4, parked: 0, pedestrians: 0, driveways: true });
  const fleet = new NpcFleet(w, { count: 0, bikes: 0, seed: 5 });
  const ctx = { world: w, fleet, autopilot: idle };
  const e = CGY.edges.get(D.edge), lane = CGY.lane(e.id, e.lanes - 1);
  w.placeOnLane(lane, 2);
  w.route = new Route(routeFromLanes(CGY, [lane], 2, lane.length - 2), CGY, w.ego.spec);
  assert.equal(typeof w.driveways.random, "function");
  w.driveways.next = 0;
  // (on the route's street, AHEAD_M along it, nothing parked across its way out)
  const r = w.driveways.spawn();
  assert.equal(!!r, true);
  {
    assert.equal(r.geo.e.id, e.id);
    assert.equal(r.phase, "parked");
    assert.equal(w.driveways.clearWay(r.geo), false);   // (it stands there itself now)
    w.driveways.retire(r);
    assert.equal(w.driveways.clearWay(r.geo), true);
  }
  // (the drive score reports reversing_conflicts once one has backed out near the car)
  const score = new DriveScore(w, {});
  score.record(w, w.roadInfo(), 1 / 60);
  assert.equal("reversing_conflicts" in score.snapshot(), false);
  w.drivewaysSeen = true; score.record(w, w.roadInfo(), 1 / 60);
  assert.equal(score.snapshot().reversing_conflicts, 0);
});

await test("with the option off nothing is built, drawn or reported", () => {
  const ctx = world({ driveways: false, traffic: 10 }), w = ctx.world;
  assert.equal(w.driveways.enabled, false);
  assert.equal(w.driveways.random, null);
  assert.equal(w.driveways.next, Infinity);
  egoAt(ctx, 60, 8);
  for (let k = 0; k < 300; k++) step(ctx);
  assert.equal(w.driveways.cars.length, 0);
  assert.equal(w.drivewaysSeen, false);
  assert.equal("reversing_conflicts" in w.violations, false);
  const snap = buildSnapshot(w);
  assert.equal("reversing_vehicle" in snap, false);
  const metrics = new DriveMetrics(w.route.length);
  metrics.record(w, snap, w.roadInfo(), 1 / 60);
  assert.equal("reversing_conflicts" in metrics.summary(w, { totals: {} }, false), false);
  // (no other challenge turns it on)
  assert.deepEqual(CHALLENGES.filter(c => c.driveways).map(c => c.id), ["reverse-lights"]);
  // (and a world without it steps exactly as one built before the option existed: the same random draws)
  const a = world({ driveways: false, traffic: 10, seed: 9 }), b = world({ driveways: false, traffic: 10, seed: 9 });
  delete b.world.driveways.enabled; b.world.driveways = { enabled: false, cars: [] };
  for (let k = 0; k < 300; k++) { step(a); step(b); }
  assert.equal(JSON.stringify(a.fleet.vehicles.map(n => [n.x, n.y])), JSON.stringify(b.fleet.vehicles.map(n => [n.x, n.y])));
});

// Optional: the live-model case (`uv run scripts/verify_jev.py data/snapshots/reverse_lights.json`), from
// the challenge at the moment the car backing out comes into the lane, generated by the production pipeline.
if (process.argv.includes("--write-snapshots")) {
  const ctx = setupChallenge(CGY, lesson, { brain: "rules" }), w = ctx.world;
  let snap = null, candidates = null, eligible = null, rejected = null;
  for (let k = 0; k < 40 * 60 && !snap; k++) {
    step(ctx);
    if (ctx.autopilot.firing) await ctx.autopilot.firing;
    const s = buildSnapshot(w);
    if (!s.reversing_vehicle?.wait || s.reversing_vehicle.bumper_to_stop_m < 3) continue;
    const cs = sampleCandidates(s, w), sim = simulateAll(cs, s, w);
    // (once giving it room is on offer: the first moment the car can still stop comfortably for it)
    if (sim.eligible.some(c => c.id === "yield_to_reversing")) { snap = s; candidates = cs; ({ eligible, rejected } = sim); }
  }
  const { questions, local } = buildQuestions(snap, eligible);
  const state = toJevState(snap, candidates, { rejected });
  const slowing = eligible.filter(c => c.id === "yield_to_reversing" || (c.sim.end_speed < snap.ego.v - 0.5 && Math.abs(c.sim.lane_err_end) < 0.8)).map(c => c.id);
  fs.writeFileSync(new URL("../data/snapshots/reverse_lights.json", import.meta.url), JSON.stringify({ name: "reverse_lights", state, questions, local,
    expect: { ...(questions.motion ? { motion: "drive" } : {}), vector_in: slowing } }, null, 2) + "\n");
  console.log(`wrote data/snapshots/reverse_lights.json (stop in ${snap.reversing_vehicle.bumper_to_stop_m.toFixed(1)} m, ${eligible.length} eligible)`);
}
console.log(`${checks} driveway reverser checks passed`);
process.exit(0);
