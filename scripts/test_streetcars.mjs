// Streetcars (Ontario HTA s. 166): their routes on their tracks in The Annex, who must stop behind a
// streetcar with its doors open and where, the riders getting off and on across the lane beside it,
// traffic holding back for them, sensing, candidates, what models are told, the audit, the challenge
// with Rules, and the same drive with the doors shut.
// node --experimental-default-type=module scripts/test_streetcars.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
globalThis.document = { querySelector: () => null };
const { MapData, cumulative } = await import("../static/js/map/mapdata.js");
const { World } = await import("../static/js/sim/world.js");
const { NpcFleet } = await import("../static/js/sim/npc.js");
const { Vehicle, STREETCAR } = await import("../static/js/sim/vehicle.js");
const { setWeather } = await import("../static/js/sim/weather.js");
const { stepWorld } = await import("../static/js/sim/step.js");
const { obbOverlap } = await import("../static/js/sim/collision.js");
const { DOOR_M, HOLD_M, STOP_M, SIDE_M, IN_LANE_M, doorPoints, doorsOpen, isStreetcar, streetcarHold, streetcarRelation } = await import("../static/js/sim/streetcar.js");
const { isBus } = await import("../static/js/sim/bus.js");
const { buildSnapshot } = await import("../static/js/brain/sensors.js");
const { sampleCandidates, simulateAll } = await import("../static/js/brain/candidates.js");
const { toJevState, buildQuestions, situationClauses } = await import("../static/js/brain/state.js");
const { CHALLENGES } = await import("../static/js/lab/challenges.js");
const { setupChallenge } = await import("../static/js/lab/evaluation.js");
const { DriveRecorder } = await import("../static/js/lab/recorder.js");

let checks = 0;
function test(name, fn) { fn(); checks++; console.log(`✓ ${name}`); }
const root = new URL("../data/maps/", import.meta.url);
const load = (key) => {
  const pack = JSON.parse(fs.readFileSync(new URL(`${key}.v6.pack.json`, root)));
  for (const name of ["transit", "crossings", "zones"]) {
    const url = new URL(`${key}.${name}.v1.json`, root);
    if (fs.existsSync(url)) pack[name] = JSON.parse(fs.readFileSync(url));
  }
  return new MapData(pack);
};
const ANNEX = load("4a96d42cb3f2");
const step = (ctx, input = null) => stepWorld({ ...ctx, input }, 1 / 60, ctx.world.t * 1000);
const idle = { enabled: false, step() {} };
const front = (v) => { const spec = v.spec || v; return spec.length - spec.rearOverhang; };

test("The Annex's 511 Bathurst runs both ways along Bathurst Street, in the inner lane, stopping at Lennox and Harbord", () => {
  const trams = ANNEX.transit.routes.filter((r) => r.mode === "tram");
  assert.deepEqual(trams.map((r) => r.ref), ["511", "511"]);
  for (const route of trams) {
    assert.equal(route.runs.length, 1);
    const run = route.runs[0];
    assert.equal(run.lane, 0);
    assert.ok(run.length > 700, `${route.name}: ${run.length} m`);
    for (const id of run.edges) assert.equal(ANNEX.edges.get(id).name, "Bathurst Street");
    for (let i = 1; i < run.edges.length; i++) assert.equal(ANNEX.edges.get(run.edges[i - 1]).to, ANNEX.edges.get(run.edges[i]).from, "joined end to end");
    const names = run.stops.map((st) => ANNEX.transit.stops.find((x) => x.id === st.id).name).sort();
    assert.deepEqual(names, ["Harbord Street", "Lennox Street"]);
  }
  // (the bus routes are as they were)
  assert.equal(ANNEX.transit.routes.filter((r) => r.mode !== "tram").length, 15);
});

// A straight path along +x and a streetcar on it.
const PATH = { pts: [[0, 0], [300, 0]] };
PATH.cum = cumulative(PATH.pts);
const tramAt = (x, y, psi = 0) => Object.assign(new Vehicle(x, y, psi, 0, STREETCAR), { kind: "streetcar", id: "sc", transit: { doors: true, departures: 0, phase: "dwell" } });

test("who stops, and where: beside it, 4 m behind its rear doors; behind it in its lane, 4 m behind it", () => {
  // (the path 3.5 m right of its centreline: the lane beside it, on the curb side)
  const beside = tramAt(100, 3.5), h = streetcarHold(PATH.pts, PATH.cum, 20, beside);
  const rear = 100 - STREETCAR.rearOverhang;
  assert.ok(h.beside && Math.abs(h.gap_m - (rear - 20)) < 1e-6, "its rear, along the path");
  assert.ok(Math.abs(h.stop_m - (rear + DOOR_M - STOP_M - 20)) < 1e-6, "4 m behind its rear doors");
  const behind = streetcarHold(PATH.pts, PATH.cum, 20, tramAt(100, 0));
  assert.ok(!behind.beside && Math.abs(behind.stop_m - (rear - STOP_M - 20)) < 1e-6, "4 m behind it in its lane");
  // not on the far side from its riders, nor coming the other way, nor once past where it must stop
  assert.equal(streetcarHold(PATH.pts, PATH.cum, 20, tramAt(100, -3.5)), null, "the lane on its left");
  assert.equal(streetcarHold(PATH.pts, PATH.cum, 20, tramAt(100, 3.5, Math.PI)), null, "coming the other way");
  assert.equal(streetcarHold(PATH.pts, PATH.cum, 20, tramAt(100, SIDE_M + 2)), null, "a street over");
  assert.ok(streetcarHold(PATH.pts, PATH.cum, rear + 1, beside).stop_m < 0, "just past where it stops, still held");
  assert.equal(streetcarHold(PATH.pts, PATH.cum, rear + DOOR_M + 0.1, beside), null, "not once level with its doors");
  // (the audit and the HUD, by where the driver is now)
  const car = new Vehicle(40, -3.5, 0, 10), r = streetcarRelation(car, tramAt(100, 0));
  assert.ok(r.beside && Math.abs(r.right_m - 3.5) < 1e-6 && Math.abs(r.ahead_m - (rear + DOOR_M - STOP_M - 40 - front(car))) < 1e-6);
  assert.ok(Math.abs(streetcarRelation(new Vehicle(40, 0.5, 0, 10), tramAt(100, 0)).right_m) < IN_LANE_M);
});

// A free drive with streetcars, the car far off so that nothing is taken off for being near it.
function soak(seconds, { seed = 3, count = 25, streetcars = true, buses = true } = {}) {
  setWeather("dry");
  const world = new World(ANNEX, { seed, pedestrians: 30, buses });
  world.ego.x = -3000; world.ego.y = -3000;
  const fleet = new NpcFleet(world, { count, bikes: 6, seed, buses, streetcars });
  const log = { stops: new Set(), off: new Set(), on: new Set(), outOfLane: 0, hits: new Set(), passes: [], early: [], spawned: new Set() };
  const ctx = { world, fleet, autopilot: idle };
  const seen = new Map();
  for (let k = 0; k < 60 * seconds; k++) {
    step(ctx);
    for (const car of fleet.streetcars) {
      log.spawned.add(car.id);
      const t = car.transit, pe = car.path.currentEdge();
      if (pe.lane !== 0 || Math.abs(t.shift) > 1e-9) log.outOfLane++;
      if (doorsOpen(car)) log.stops.add(`${car.id}:${t.departures}`);
      for (const o of [...fleet.vehicles, ...world.crowd.list]) if (o !== car && obbOverlap(car.obb(), o.obb(), 0)) log.hits.add(`${car.id}/${o.id}`);
      // nobody owing it gets past its rear doors while they are open
      const key = `${car.id}:${t.departures}`;
      for (const n of fleet.vehicles) {
        if (n === car || n.kind === "ambulance" || n.kind === "fire_truck") continue;
        const r = streetcarRelation(n, car);
        if (!r || r.right_m < -IN_LANE_M || r.right_m > SIDE_M) continue;
        const was = seen.get(`${key}:${n.id}`);
        if (doorsOpen(car) && n.streetcarOwed?.[key] && was !== undefined && was > HOLD_M - STOP_M && r.ahead_m <= HOLD_M - STOP_M && n.v > 1) log.passes.push(`${n.id} past ${key}`);
        seen.set(`${key}:${n.id}`, r.ahead_m);
      }
    }
    for (const p of world.crowd.list) {
      if (!p.streetcar) continue;
      (p.boarding ? log.on : log.off).add(p.id);
      // (a rider steps into the street only with the doors open)
      const car = fleet.vehicles.find((v) => v.id === p.streetcar);
      if (p.crossing && p.boarding && !doorsOpen(car)) log.early.push(p.id);
    }
  }
  return { world, fleet, log };
}
const free = soak(300);

test("in a free drive streetcars keep to their track, stop with their doors open, and are replaced", () => {
  const { fleet, log } = free;
  assert.equal(log.outOfLane, 0, "always in the lane their track is laid in");
  assert.ok(log.stops.size >= 3, `${log.stops.size} stops in 5 minutes`);
  assert.ok(log.spawned.size >= 4, `${log.spawned.size} streetcars came and went`);
  assert.ok(fleet.streetcars.length <= 2 && fleet.streetcars.every((c) => c.transit.tram), "two at a time");
  assert.ok(fleet.buses.every((b) => !b.transit.tram), "buses run bus routes only");
  assert.deepEqual([...log.hits], [], "they hit nothing");
});

test("riders get off and on across the lane beside it, only while its doors are open", () => {
  const { log } = free;
  assert.ok(log.off.size >= 2 && log.on.size >= 2, `${log.off.size} off, ${log.on.size} on`);
  assert.deepEqual(log.early, []);
});

test("traffic owing the stop never gets past its rear doors while they are open", () => {
  assert.deepEqual(free.log.passes, []);
});

test("without streetcars, traffic runs exactly as before", () => {
  setWeather("dry");
  const run = (opts) => {
    const world = new World(ANNEX, { seed: 2, pedestrians: 20, buses: true }), fleet = new NpcFleet(world, { count: 20, seed: 2, buses: true, ...opts });
    for (let k = 0; k < 60 * 30; k++) step({ world, fleet, autopilot: idle });
    return fleet.vehicles.map((v) => `${v.id}:${v.x.toFixed(6)},${v.y.toFixed(6)}`).join(" ");
  };
  assert.equal(run({}), run({ streetcars: false }));
});

// Behind the doors, set up as the challenge: the streetcar at its stop on Bathurst Street, doors open,
// the rider at the curb abreast of its rear doors. `back`: the car's front that far short of where it
// stops; with `still`, nothing starts.
const challenge = CHALLENGES.find((c) => c.id === "streetcar");
function doors({ back = 40, v = 11, still = false } = {}) {
  const ctx = setupChallenge(ANNEX, challenge);
  const { world, fleet, scenario } = ctx;
  if (still) world.challenge = null;
  const tram = fleet.vehicles.find(isStreetcar);
  const lane = world.map.lane(scenario.start.edge, scenario.start.lane);
  const r = streetcarRelation(world.ego, tram);
  world.placeOnLane(lane, scenario.start.s + r.ahead_m - back);
  world.ego.v = v;
  world.resetContactHistory();
  world._road = world.roadInfo();
  return { ...ctx, tram, rider: world.crowd.list.find((p) => p.id === "challenge_rider") };
}

test("challenge: a 511 at its stop on Bathurst Street in the lane beside the car, doors open, a rider at the curb", () => {
  const { world, tram, rider, scenario } = doors();
  assert.equal(world.map.edges.get(scenario.start.edge).name, "Bathurst Street");
  assert.ok(tram && doorsOpen(tram) && tram.ref === "511" && tram.v === 0, "standing with its doors open");
  assert.ok(scenario.start.lane === world.map.edges.get(scenario.start.edge).lanes - 1, "the car in the curb lane");
  const r = streetcarRelation(world.ego, tram);
  assert.ok(r.beside && r.ahead_m > 0, "beside its track, behind it");
  assert.ok(rider && rider.held && rider.path[0].cross.streetcar === tram.id, "a rider waiting to walk out to its doors");
  const door = doorPoints(tram)[3];
  assert.ok(Math.hypot(rider.path[0].p[0] - door[0], rider.path[0].p[1] - door[1]) < 1e-6, "to its rear doors");
});

test("the car is told to stop, offered a stop behind the doors, and driving on is rejected", () => {
  const { world } = doors({ back: 40, v: 11 });
  const snap = buildSnapshot(world), sc = snap.streetcar;
  assert.ok(sc && sc.doors && sc.beside, "sensed");
  assert.ok(Math.abs(sc.bumper_to_stop_m - 40) < 1, `stops 4 m behind its rear doors (${sc.bumper_to_stop_m.toFixed(1)} m)`);
  const candidates = sampleCandidates(snap, world);
  simulateAll(candidates, snap, world);
  assert.ok(candidates.find((c) => c.id === "stop_for_streetcar")?.eligible, "stop_for_streetcar on offer");
  const near = doors({ back: 6, v: 5 }), s2 = buildSnapshot(near.world), c2 = sampleCandidates(s2, near.world);
  simulateAll(c2, s2, near.world);
  const keep = c2.find((c) => c.id === "keep_lane_target");
  assert.ok(keep && keep.reject === "passes_streetcar_doors", `driving on is rejected (${keep?.reject})`);
  assert.ok(s2.target.v < 6 && s2.target.reasons.includes("streetcar stopped, doors open"), "and the target speed slows the car for it");
});

test("decision models and LLMs are told about the streetcar", () => {
  const { world } = doors({ back: 25, v: 9 });
  const snap = buildSnapshot(world);
  const candidates = sampleCandidates(snap, world);
  const { eligible } = simulateAll(candidates, snap, world);
  const state = toJevState(snap, candidates, {});
  assert.ok(state.streetcar?.doors_open === true && state.streetcar.stop === true && state.streetcar.beside_it === true && state.streetcar.route === "511");
  assert.ok(situationClauses(snap).some((c) => c.includes("doors open") && c.includes("2 m of its rear doors") && c.includes("stop_for_streetcar")));
  const { questions } = buildQuestions(snap, eligible);
  assert.ok(questions.motion.criteria.stop.includes("streetcar.wait_in_m"));
  assert.ok(questions.vector.criteria.stop_for_streetcar.includes("rear doors"));
});

test("a car that cannot stop in time when it first sees the doors open is not held", () => {
  const { world } = doors({ back: 4, v: 13 });
  assert.equal(buildSnapshot(world).streetcar, null);
});

test("slowing for its stop, the car slows down, ready to stop, but is not held", () => {
  // (close enough that it, not the school zone's 30 km/h there, slows the car)
  const { world, tram } = doors({ back: 8, v: 7 });
  Object.assign(tram.transit, { phase: "in", doors: false });
  tram.doors = false;
  const snap = buildSnapshot(world);
  assert.ok(snap.streetcar?.stopping && !snap.streetcar.doors);
  assert.ok(snap.target.v < 7 && snap.target.reasons.includes("streetcar stopping"), `target ${snap.target.v.toFixed(1)} m/s (${snap.target.reasons})`);
  const candidates = sampleCandidates(snap, world);
  simulateAll(candidates, snap, world);
  assert.ok(!candidates.some((c) => c.id === "stop_for_streetcar" || c.reject === "passes_streetcar_doors"));
  assert.ok(toJevState(snap, candidates, {}).streetcar.stopping);
});

test("a rider steps into the street only with the doors open and what is coming able to stop", () => {
  const { world, tram, rider } = doors({ back: 3, v: 12, still: true });
  const cross = rider.path[0].cross;
  assert.ok(!world.crowd.mayCross(cross, world.t), "the car is too close to stop: wait");
  world.ego.v = 0;
  assert.ok(world.crowd.mayCross(cross, world.t), "it has stopped");
  tram.transit.doors = false;
  assert.ok(!world.crowd.mayCross(cross, world.t), "not to get on once the doors have shut");
});

test("its doors never close with a rider in the street", () => {
  const { world, fleet, tram } = doors({ back: 60, v: 0, still: true });
  Object.assign(tram.transit, { held: false, t: 100, dwell: 0, off: 0, on: 0 });
  const e = world.map.edges.get(tram.path.currentEdge().id);
  const rider = world.crowd.rideOff(tram, e, () => 0.5);
  rider.crossing = rider.path[0].cross;
  const ctx = { world, fleet, autopilot: idle };
  for (let k = 0; k < 60 * 10 && rider.crossing; k++) { step(ctx); if (rider.crossing) assert.ok(doorsOpen(tram), "open while the rider crosses"); }
  for (let k = 0; k < 60 * 5 && doorsOpen(tram); k++) step(ctx);
  assert.ok(!doorsOpen(tram), "and shut once they are across");
});

test("the audit: passing its open doors at speed fails to yield, once", () => {
  const { world, fleet } = doors({ back: 50, v: 11, still: true });
  const ctx = { world, fleet, autopilot: idle };
  const failed = [];
  for (let k = 0; k < 60 * 8; k++) {
    step(ctx, { throttle: world.ego.v < 11 ? 0.5 : 0, brake: 0, steer: 0 });
    for (const e of world.events) if (e.type === "failed_to_yield") failed.push(e.to);
  }
  assert.deepEqual(failed, ["streetcar"]);
});

// The challenge, driven by Rules, with the streetcar's doors open (as authored) or shut.
function drive({ shut = false } = {}) {
  setWeather("dry");
  const ctx = setupChallenge(ANNEX, challenge), { world, fleet } = ctx;
  const tram = fleet.vehicles.find(isStreetcar);
  if (shut) { Object.assign(tram.transit, { doors: false, phase: "drive" }); tram.doors = false; tram.frozen = 1e6; }
  let stoppedAt = null, minAhead = Infinity, crossed = false, boarded = false, passed = false, moving = false, speedAtTrigger = null;
  for (let k = 0; k < 60 * 60 && !passed && ctx.autopilot.enabled; k++) {
    step(ctx);
    const r = streetcarRelation(world.ego, tram);
    if (world.ego.v > 1) moving = true;
    if (world.challenge.triggered && speedAtTrigger === null) speedAtTrigger = world.ego.v;
    if (r && doorsOpen(tram)) {
      minAhead = Math.min(minAhead, r.ahead_m);
      if (moving && Math.abs(world.ego.v) < 0.1 && stoppedAt === null) stoppedAt = r.ahead_m;
    }
    const rider = world.crowd.list.find((p) => p.id === "challenge_rider");
    if (rider?.crossing) crossed = true;
    if (world.challenge.triggered && !rider) boarded = true;
    if (!r || r.ahead_m < -STREETCAR.length || world.violations.collisions) passed = true;
  }
  return { world, tram, stoppedAt, minAhead, crossed, boarded, passed, speedAtTrigger };
}

test("Rules stops behind the open doors, never within 2 m of them, lets the rider cross, and goes on once they shut", () => {
  const { world, tram, stoppedAt, minAhead, crossed, boarded, passed } = drive();
  assert.ok(stoppedAt !== null && stoppedAt > HOLD_M - STOP_M && stoppedAt < 2.5, `stopped ${(stoppedAt + STOP_M)?.toFixed(1)} m behind the doors`);
  assert.ok(minAhead > HOLD_M - STOP_M, `and never within 2 m of them while they were open (${(minAhead + STOP_M).toFixed(1)} m)`);
  assert.ok(crossed && boarded, "the rider crossed in front of the car and got on");
  assert.ok(!doorsOpen(tram) && tram.v > 0.5 || passed, "the streetcar moved off");
  assert.ok(passed, "then the car went on past it");
  assert.equal(world.violations.failed_to_yield, 0);
  assert.equal(world.violations.collisions, 0);
});

test("with the doors shut, Rules comes by at the limit and the rider who steps out is hit", () => {
  const { world, speedAtTrigger } = drive({ shut: true });
  assert.ok(speedAtTrigger > 10, `at ${(speedAtTrigger * 3.6).toFixed(0)} km/h when they step out`);
  assert.ok(world.violations.collisions >= 1, "the rule is what keeps them safe");
});

test("a collision with a streetcar's front section is found, 25 m from its reference point", () => {
  setWeather("dry");
  const world = new World(ANNEX, { seed: 1, parked: 0, pedestrians: 0 });
  const fleet = new NpcFleet(world, { count: 0, bikes: 0, seed: 1 });
  world.ego.x = 23; world.ego.y = 0; world.ego.psi = 0;
  const tram = Object.assign(tramAt(0, 0), { id: "streetcar_test" });
  fleet.vehicles.push(tram);
  assert.ok(obbOverlap(world.ego.obb(), tram.obb(), 0), "the car is in its front section");
  assert.ok(world.obstaclesNear(world.ego.x, world.ego.y, 12).includes(tram), "found near the car");
  world.audit(1 / 60, {});
  assert.equal(world.violations.collisions, 1);
});

test("a checkpoint and restore brings back the streetcar's riders", () => {
  const ctx = setupChallenge(ANNEX, challenge);
  const recorder = new DriveRecorder();
  recorder.record({ world: ctx.world, fleet: ctx.fleet, autopilot: ctx.autopilot, drive: {}, clock: {} }, true);
  const before = ctx.world.crowd.list.map((p) => p.id), tram = ctx.fleet.vehicles.find(isStreetcar).id;
  ctx.world.crowd.list.length = 0;
  ctx.fleet.vehicles.length = 0;
  const target = { world: ctx.world, fleet: ctx.fleet, autopilot: ctx.autopilot, clock: { setHour() {}, update() {} }, setDrive() {} };
  recorder.restore(0, target);
  assert.deepEqual(target.world.crowd.list.map((p) => p.id), before);
  assert.ok(doorsOpen(target.fleet.vehicles.find((v) => v.id === tram)), "the streetcar, doors open");
  assert.ok(target.fleet.streetcars.some((v) => v.id === tram), "and the fleet's list of them");
});

console.log(`${checks} streetcar checks passed`);
process.exit(0);
