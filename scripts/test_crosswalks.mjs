// Marked crosswalks between junctions: the bundled crossings, people crossing at them (stepping off
// only when what is coming can stop), vehicles hiding the people behind them, and not passing a
// vehicle stopped at one (BC MVA s. 179(3)): sensing, candidates, what models are told, stopping to
// look, the audit and closed-loop Rules drives.
// node --experimental-default-type=module scripts/test_crosswalks.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
globalThis.document = { querySelector: () => null };
const { MapData } = await import("../static/js/map/mapdata.js");
const { World } = await import("../static/js/sim/world.js");
const { NpcFleet } = await import("../static/js/sim/npc.js");
const { Vehicle, BIKE } = await import("../static/js/sim/vehicle.js");
const { setWeather } = await import("../static/js/sim/weather.js");
const { stepWorld } = await import("../static/js/sim/step.js");
const { Pedestrian } = await import("../static/js/sim/pedestrians.js");
const { HOLD_M, LOOK_S, frontTo, hiddenByTraffic, stoppedAt } = await import("../static/js/sim/crosswalk.js");
const { buildSnapshot } = await import("../static/js/brain/sensors.js");
const { sampleCandidates, simulateAll } = await import("../static/js/brain/candidates.js");
const { toJevState, buildQuestions, situationClauses } = await import("../static/js/brain/state.js");
const { Autopilot } = await import("../static/js/brain/brain.js");
const { CHALLENGES } = await import("../static/js/lab/challenges.js");
const { setupChallenge } = await import("../static/js/lab/evaluation.js");
const { DriveRecorder } = await import("../static/js/lab/recorder.js");

let checks = 0;
function test(name, fn) { fn(); checks++; console.log(`✓ ${name}`); }
const root = new URL("../data/maps/", import.meta.url);
const KEYS = ["623b012bc8b5", "7165f1c807a8", "d7454a9751b7", "4a96d42cb3f2", "bb9df59633e0", "a53c5bcf6438", "d25b07def0d2", "19bb885c9cae", "8e99888cb743", "ca5573a8d934", "3e794edbefcb", "49db0d437c8c"];
const load = (key) => {
  const pack = JSON.parse(fs.readFileSync(new URL(`${key}.v6.pack.json`, root)));
  const crossings = new URL(`${key}.crossings.v1.json`, root);
  if (fs.existsSync(crossings)) pack.crossings = JSON.parse(fs.readFileSync(crossings));
  return new MapData(pack);
};
const KITS = load("623b012bc8b5");
const step = (ctx, input = null) => stepWorld({ ...ctx, input }, 1 / 60, ctx.world.t * 1000);
const idle = { enabled: false, step() {} };

test("every bundled map has its crosswalk file, and the crowd finds each crosswalk's street", () => {
  let total = 0;
  for (const key of KEYS) {
    const map = load(key);
    assert.ok(Array.isArray(map.pack.crossings?.crossings), `${key} has crossings`);
    const world = new World(map, { parked: 0, pedestrians: 0 });
    assert.equal(world.crowd.marked.length, map.crosswalks.length, `${key}: every crosswalk on a street`);
    for (const cw of world.crowd.marked) {
      const e = cw.st.edge, width = e.asphalt[1] - e.asphalt[0];
      const span = Math.hypot(cw.ends[1][0] - cw.ends[-1][0], cw.ends[1][1] - cw.ends[-1][1]);
      assert.ok(span > width && span < width + 12, `${cw.id} reaches from sidewalk to sidewalk (${span.toFixed(1)} m)`);
    }
    total += map.crosswalks.length;
  }
  assert.ok(total > 50, `${total} crosswalks in all`);
});

test("a vehicle in traffic hides a person behind it; a parked car or a cyclist does not", () => {
  const observer = { x: 0, y: 0, psi: 0 }, ped = { x: 20, y: 0 };
  const car = new Vehicle(8, 0, 0, 0), aside = new Vehicle(8, 4, 0, 0), bike = new Vehicle(8, 0, 0, 0, BIKE);
  bike.kind = "bike";
  assert.ok(hiddenByTraffic(observer, ped, [car]));
  assert.ok(!hiddenByTraffic(observer, ped, [aside]));
  assert.ok(!hiddenByTraffic(observer, ped, [bike]));
  car.parked = true;
  assert.ok(!hiddenByTraffic(observer, ped, [car]));
  // (and nothing hides someone right beside the driver, or beyond what anyone sees)
  assert.ok(!hiddenByTraffic(observer, { x: 0.5, y: 0 }, [new Vehicle(0.2, 0, 0, 0)]));
});

// A world on Kitsilano with nobody about but the car, and one crosswalk on West Broadway.
const CW = "x4842686858";
function broadway() {
  setWeather("dry");
  const world = new World(KITS, { parked: 0, pedestrians: 0 });
  const fleet = new NpcFleet(world, { count: 0, bikes: 0, seed: 3 });
  const cw = world.crowd.marked.find((c) => c.id === CW);
  return { world, fleet, cw, autopilot: idle };
}
// Put the car `back` metres short of the crosswalk (its front) at `v`, along the edge the crosswalk
// was mapped on, in lane `idx`.
function placeBefore(world, cw, back, v, idx = 0) {
  const c = KITS.crosswalks.find((x) => x.id === cw.id), lane = KITS.lane(c.edge, idx);
  const front = world.ego.spec.length - world.ego.spec.rearOverhang;
  world.placeOnLane(lane, c.s - back - front);
  world.ego.v = v;
  world.resetContactHistory();
}

test("someone at a marked crosswalk steps off only when what is coming can still stop", () => {
  const { world, cw } = broadway();
  const cross = { node: null, marked: cw.id, from: cw.ends[1], to: cw.ends[-1] };
  placeBefore(world, cw, 15, 13);
  assert.ok(!world.crowd.mayCross(cross, 0), "a car 15 m off at 13 m/s cannot stop: wait");
  placeBefore(world, cw, 70, 13);
  assert.ok(world.crowd.mayCross(cross, 0), "one 70 m off can");
  placeBefore(world, cw, 3, 0);
  assert.ok(world.crowd.mayCross(cross, 0), "one stopped short of it has stopped");
  placeBefore(world, cw, -1, 0);
  assert.ok(!world.crowd.mayCross(cross, 0), "not with a car standing in it");
});

test("walking past a marked crosswalk, people may cross there, sidewalk to sidewalk", () => {
  const { world, cw } = broadway();
  const ped = new Pedestrian({ id: "p", x: 0, y: 0, psi: 0, v: 0, speed: 1.3, path: [], crossing: null, waiting: 0, phase: 0, look: 1 });
  world.crowd.marking = () => 0;
  world.crowd.walkAlong(ped, cw.st, 1, cw.s - 40, 1);
  const wp = ped.path.find((w) => w.cross);
  assert.ok(wp && wp.cross.marked === cw.id && !wp.cross.jaywalk, "crosses at the crosswalk");
  assert.ok(wp.cross.from === cw.ends[1] && wp.cross.to === cw.ends[-1], "from this sidewalk to the other");
  assert.ok(ped.at.side === -1, "and walks on along the other side");
  world.crowd.marking = () => 0.99;
  world.crowd.walkAlong(ped, cw.st, 1, cw.s - 40, 1);
  assert.ok(!ped.path.some((w) => w.cross?.marked), "or walks on by");
});

test("in a soak the crowd crosses at marked crosswalks, and drivers let them", () => {
  setWeather("dry");
  const map = load("d7454a9751b7");
  const world = new World(map, { seed: 5 });
  const fleet = new NpcFleet(world, { count: 40, seed: 5 });
  const seen = new Set();
  let longest = 0;
  for (let k = 0; k < 60 * 300; k++) {
    stepWorld({ world, fleet, autopilot: idle }, 1 / 60, world.t * 1000);
    for (const p of world.crowd.list) {
      if (p.crossing?.marked) seen.add(`${p.id}:${p.crossing.marked}`);
      longest = Math.max(longest, p.waiting);
    }
  }
  assert.ok(seen.size >= 3, `${seen.size} crossings at marked crosswalks in 5 minutes`);
  assert.ok(longest < 60, `nobody waits a minute at a curb (${longest.toFixed(0)} s)`);
});

// The multiple threat, set up as the challenge: a car stopped in the curb lane at West Broadway's
// crosswalk, someone on it in front of it, the car in the lane beside. With `still`, neither moves
// (the challenge does not trigger).
const challenge = CHALLENGES.find((c) => c.id === "multiple-threat");
function threat({ back = 60, v = 12, still = false } = {}) {
  const ctx = setupChallenge(KITS, challenge);
  const { world, fleet, scenario } = ctx;
  if (still) world.challenge = null;
  const lane = world.map.lane(scenario.start.edge, scenario.start.lane);
  const front = world.ego.spec.length - world.ego.spec.rearOverhang;
  world.placeOnLane(lane, scenario.multiThreat.s - back - front);
  world.ego.v = v;
  world.resetContactHistory();
  world._road = world.roadInfo();
  const car = fleet.vehicles.find((n) => n.id === "challenge_stopped");
  const ped = world.crowd.list.find((p) => p.id === "challenge_pedestrian");
  const cw = world.crowd.marked.find((c) => c.id === scenario.multiThreat.crosswalk);
  return { ...ctx, car, ped, cw };
}

test("challenge: the car stands at the crosswalk in the curb lane, hiding the person in front of it", () => {
  const { world, car, ped, cw } = threat();
  assert.ok(car && ped && cw, "set up");
  assert.ok(Math.abs(frontTo(cw, car) - HOLD_M) < 0.2, "its front 3.5 m short of the crosswalk's centre");
  assert.equal(stoppedAt(world, cw, world.ego).length, 1, "stopped there, in the next lane, ahead of the car");
  assert.ok(!world.sees(world.ego, ped), "the person is hidden from 60 m back");
  assert.ok(world.visibility.sees(world.ego, ped), "by the car, not by a building");
});

test("the car is told not to pass, offered a stop short of the crosswalk, and passing is rejected", () => {
  const { world, cw } = threat({ back: 60, v: 12 });
  const snap = buildSnapshot(world);
  const hold = snap.crosswalk_stop;
  assert.ok(hold && hold.id === "challenge_stopped" && hold.crosswalk === cw.id && hold.stopped, "sensed");
  assert.ok(Math.abs(hold.bumper_to_crosswalk_m - 60) < 0.5 && Math.abs(hold.bumper_to_crosswalk_m - hold.bumper_to_stop_m - HOLD_M) < 1e-6, "stops 3.5 m short");
  const candidates = sampleCandidates(snap, world);
  simulateAll(candidates, snap, world);
  const stop = candidates.find((c) => c.id === "stop_at_crosswalk");
  assert.ok(stop && stop.eligible, "stop_at_crosswalk on offer");
  // close up, driving on at speed would pass it
  const near = threat({ back: 9, v: 6 }), s2 = buildSnapshot(near.world);
  const c2 = sampleCandidates(s2, near.world);
  simulateAll(c2, s2, near.world);
  const keep = c2.find((c) => c.id === "keep_lane_target");
  assert.ok(s2.crosswalk_stop, "still told");
  assert.ok(keep && keep.reject === "passes_car_stopped_at_crosswalk", `driving on is rejected (${keep?.reject})`);
  assert.ok(s2.target.v < 6, "and the target speed slows the car for it");
});

test("decision models and LLMs are told about the stopped car", () => {
  const { world } = threat({ back: 30, v: 10 });
  const snap = buildSnapshot(world);
  const candidates = sampleCandidates(snap, world);
  const { eligible } = simulateAll(candidates, snap, world);
  const state = toJevState(snap, candidates, {});
  assert.ok(state.stopped_at_crosswalk?.do_not_pass === true && state.stopped_at_crosswalk.id === "challenge_stopped");
  assert.ok(situationClauses(snap).some((c) => c.includes("must not be passed") && c.includes("stop_at_crosswalk")));
  const { questions } = buildQuestions(snap, eligible);
  assert.ok(questions.motion.criteria.stop.includes("stopped_at_crosswalk.wait_in_m"));
  assert.ok(questions.vector.criteria.stop_at_crosswalk.includes("short of the crosswalk"));
});

test("a car that cannot stop in time when it first sees the stopped car is not held", () => {
  const { world } = threat({ back: 12, v: 13 });
  assert.equal(buildSnapshot(world).crosswalk_stop, null);
  // (reset, standing still, it is decided afresh)
  world.resetToLane();
  assert.ok(buildSnapshot(world).crosswalk_stop, "held after a reset");
});

test("once it has stood still at the crosswalk for 2 s it may go on, looking", () => {
  const { world, fleet } = threat({ back: HOLD_M, v: 0, still: true });
  const ctx = { world, fleet, autopilot: idle };
  assert.ok(buildSnapshot(world).crosswalk_stop, "held at first");
  for (let k = 0; k < 60 * (LOOK_S - 0.5); k++) step(ctx, {});
  assert.ok(buildSnapshot(world).crosswalk_stop, "still held after 1.5 s");
  for (let k = 0; k < 60; k++) step(ctx, {});
  assert.equal(buildSnapshot(world).crosswalk_stop, null, "released after 2.5 s");
  assert.ok(world.sees(world.ego, world.crowd.list.find((p) => p.id === "challenge_pedestrian")), "and from beside the car it sees the person in front of it");
});

test("a stop it creeps on from before 2 s is up does not count as looking", () => {
  const { world, fleet } = threat({ back: HOLD_M + 1, v: 0, still: true });
  const ctx = { world, fleet, autopilot: idle };
  assert.ok(buildSnapshot(world).crosswalk_stop, "held");
  for (let k = 0; k < 30; k++) step(ctx, {});
  // (then creep on at about 0.5 m/s for 2 s)
  for (let k = 0; k < 120; k++) step(ctx, world.ego.v < 0.5 ? { throttle: 1 } : {});
  assert.ok(buildSnapshot(world).crosswalk_stop, "still held");
});

test("the audit: passing it at speed fails to yield, once", () => {
  const { world, fleet } = threat({ back: 50, v: 12, still: true });
  const ctx = { world, fleet, autopilot: idle };
  const failed = [];
  for (let k = 0; k < 60 * 6; k++) {
    step(ctx, { throttle: world.ego.v < 12 ? 0.5 : 0, brake: 0, steer: 0 });
    for (const e of world.events) if (e.type === "failed_to_yield") failed.push(e.to);
  }
  assert.deepEqual(failed, ["vehicle stopped at a crosswalk"]);
});

test("Rules stops beside the stopped car, looks, then goes on, without failing to yield", () => {
  const { world, fleet, cw } = threat({ back: 70, v: 10, still: true });
  const autopilot = new Autopilot(world);
  autopilot.setBrain("rules");
  autopilot.setEnabled(true);
  const ctx = { world, fleet, autopilot };
  let stoppedNear = false, passed = false;
  for (let k = 0; k < 60 * 40 && !passed; k++) {
    step(ctx);
    const d = frontTo(cw, world.ego);
    if (d !== null && d > HOLD_M - 1.5 && d < HOLD_M + 1.5 && Math.abs(world.ego.v) < 0.2) stoppedNear = true;
    if (d !== null && d < -3) passed = true;
  }
  assert.ok(stoppedNear, "stopped short of the crosswalk, beside the car");
  assert.ok(passed, "then went on past it");
  assert.equal(world.violations.failed_to_yield, 0);
  assert.equal(world.violations.collisions, 0);
});

test("a checkpoint keeps the crosswalks shared with the live world", () => {
  const ctx = threat({ back: 40, v: 8 });
  const recorder = new DriveRecorder();
  recorder.record({ world: ctx.world, fleet: ctx.fleet, autopilot: ctx.autopilot, drive: {}, clock: {} }, true);
  const frame = recorder.frames[0];
  assert.ok(frame.state.world.crowd.marked === ctx.world.crowd.marked, "not copied");
});

console.log(`${checks} crosswalk checks passed`);
process.exit(0);
