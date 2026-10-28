// School buses (BC MVA s. 149): where one may stop, who must stop for it with its reds flashing and
// where, the children it lets off (crossing in front of it only while its reds flash), traffic
// stopping for it both ways, sensing, candidates, what models are told, the audit, and closed-loop
// Rules drives coming toward one and up behind one.
// node --experimental-default-type=module scripts/test_school_buses.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
globalThis.document = { querySelector: () => null };
const { MapData, cumulative } = await import("../static/js/map/mapdata.js");
const { World } = await import("../static/js/sim/world.js");
const { NpcFleet } = await import("../static/js/sim/npc.js");
const { Vehicle, SCHOOL_BUS } = await import("../static/js/sim/vehicle.js");
const { setWeather } = await import("../static/js/sim/weather.js");
const { stepWorld } = await import("../static/js/sim/step.js");
const { AMBER_M, BEHIND_M, ONCOMING_M, SIDE_M, firstStop, isSchoolBus, redsOn, schoolBusHold, schoolBusRelation, stopRange } = await import("../static/js/sim/school-bus.js");
const { buildSnapshot } = await import("../static/js/brain/sensors.js");
const { sampleCandidates, simulateAll } = await import("../static/js/brain/candidates.js");
const { toJevState, buildQuestions, situationClauses } = await import("../static/js/brain/state.js");
const { Autopilot } = await import("../static/js/brain/brain.js");
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
  for (const [name, file] of [["transit", "transit"], ["crossings", "crossings"]]) {
    const url = new URL(`${key}.${file}.v1.json`, root);
    if (fs.existsSync(url)) pack[name] = JSON.parse(fs.readFileSync(url));
  }
  return new MapData(pack);
};
const KITS = load("623b012bc8b5");
const step = (ctx, input = null) => stepWorld({ ...ctx, input }, 1 / 60, ctx.world.t * 1000);
const idle = { enabled: false, step() {} };
const front = (v) => { const spec = v.spec || v; return spec.length - spec.rearOverhang; };
const twin = (map, e) => [...map.edges.values()].find((o) => o.from === e.to && o.to === e.from);

test("a school bus stops only mid-block on a two-way street with one lane each way, 50 km/h or less", () => {
  let streets = 0;
  for (const e of KITS.edges.values()) {
    const range = stopRange(KITS, e);
    if (!range) continue;
    streets++;
    assert.ok(e.lanes === 1 && !e.ring && e.limit <= 50 / 3.6 + 0.05 && twin(KITS, e), `${e.id} qualifies`);
    const L = e.cum.at(-1);
    assert.ok(range.lo >= SCHOOL_BUS.length + 15 - 1e-9 && range.hi <= L - 20 + 1e-9, `${e.id}: clear of both junctions`);
    if (e.control) assert.ok(range.hi <= e.control.s_line - 20 + 1e-9);
  }
  assert.ok(streets > 50, `${streets} streets in Kitsilano`);
  const multi = [...KITS.edges.values()].find((e) => e.lanes > 1);
  assert.equal(stopRange(KITS, multi), null, "not on a street with two lanes going one way");
  // (and clear of a marked crosswalk)
  const range = { lo: 20, hi: 100, blocked: [[30, 60], [55, 70]] };
  assert.equal(firstStop(range, 0), 20);
  assert.equal(firstStop(range, 35), 70);
  assert.equal(firstStop(range, 95), 95);
  assert.equal(firstStop(range, 101), null);
});

// A straight path along +x and a school bus somewhere about it.
const PATH = { pts: [[0, 0], [300, 0]] };
PATH.cum = cumulative(PATH.pts);
const busAt = (x, y, psi) => Object.assign(new Vehicle(x, y, psi, 0, SCHOOL_BUS), { kind: "school_bus", id: "sb", school: { lights: "red", stops: 1 } });

test("who stops, and where: behind it, 5 m behind its rear; coming toward it, 10 m short of its front", () => {
  const ahead = busAt(100, 0, 0), h = schoolBusHold(PATH.pts, PATH.cum, 20, ahead);
  assert.equal(h.relation, "behind");
  assert.ok(Math.abs(h.gap_m - (100 - SCHOOL_BUS.rearOverhang - 20)) < 1e-6 && Math.abs(h.gap_m - h.stop_m - BEHIND_M) < 1e-9);
  // in the next lane over, or coming the other way in the far lane
  assert.equal(schoolBusHold(PATH.pts, PATH.cum, 20, busAt(100, 3.5, 0)).relation, "behind");
  const toward = schoolBusHold(PATH.pts, PATH.cum, 20, busAt(100, 3.4, Math.PI));
  assert.equal(toward.relation, "oncoming");
  assert.ok(Math.abs(toward.gap_m - (100 - front(SCHOOL_BUS) - 20)) < 1e-6 && Math.abs(toward.gap_m - toward.stop_m - ONCOMING_M) < 1e-9);
  assert.equal(schoolBusHold(PATH.pts, PATH.cum, 20, busAt(100, 20, Math.PI / 2)), null, "not one on a street crossing the path");
  assert.equal(schoolBusHold(PATH.pts, PATH.cum, 20, busAt(100, SIDE_M + 3, Math.PI)), null, "nor one off the path's street");
  assert.equal(schoolBusHold(PATH.pts, PATH.cum, 99, ahead), null, "nor once level with it");
  // (the audit and the HUD, straight on as the car heads)
  const car = new Vehicle(10, 0, 0, 10), r = schoolBusRelation(car, busAt(100, -3.4, Math.PI));
  assert.equal(r.relation, "oncoming");
  assert.ok(Math.abs(r.ahead_m - (100 - front(SCHOOL_BUS) - 10 - front(car))) < 1e-6 && Math.abs(r.right_m - 3.4) < 1e-6);
});

// A free drive with school buses, the car standing still in the middle of Kitsilano.
function soak(seconds, { schoolBuses = 3, seed = 4, count = 25 } = {}) {
  setWeather("dry");
  const world = new World(KITS, { seed, pedestrians: 20 });
  const fleet = new NpcFleet(world, { count, bikes: 6, seed, schoolBuses });
  const log = { stops: new Map(), ambers: new Set(), kids: new Map(), crossed: new Set(), passes: [], waiting: 0 };
  const ctx = { world, fleet, autopilot: idle };
  const owed = new Map();
  for (let k = 0; k < 60 * seconds; k++) {
    step(ctx);
    for (const bus of fleet.schoolBuses) {
      const sb = bus.school, key = `${bus.id}:${sb.stops}`;
      if (sb.lights === "amber") log.ambers.add(`${bus.id}:${sb.stops + 1}`);
      if (redsOn(bus) && !log.stops.has(key)) log.stops.set(key, { bus, edge: sb.stop.edge, at: sb.stop.s });
      if (!redsOn(bus)) continue;
      // traffic that owes the stop never draws level with the bus while the reds flash
      for (const n of fleet.vehicles) {
        if (n === bus || n.kind === "ambulance" || n.kind === "fire_truck" || !n.schoolOwed?.[key]) continue;
        const r = schoolBusRelation(n, bus), was = owed.get(`${key}:${n.id}`);
        if (r && Math.abs(r.right_m) < SIDE_M) {
          if (was !== undefined && was > 0 && r.ahead_m <= 0 && n.v > 1) log.passes.push(`${n.id} past ${key}`);
          owed.set(`${key}:${n.id}`, r.ahead_m);
        }
      }
    }
    for (const p of world.crowd.list) {
      if (!p.child) continue;
      if (!log.kids.has(p.id)) log.kids.set(p.id, p);
      if (p.crossing) {
        log.crossed.add(p.id);
        const bus = fleet.vehicles.find((v) => v.id === p.crossing.school);
        if (!redsOn(bus)) log.waiting++;
      }
    }
  }
  return { world, fleet, log };
}
const free = soak(240);

test("in a free drive school buses stop where they may, ambers first, then reds", () => {
  const { log } = free;
  assert.ok(log.stops.size >= 3, `${log.stops.size} stops in 4 minutes`);
  for (const [key, { edge, at }] of log.stops) {
    const range = stopRange(KITS, KITS.edges.get(edge));
    assert.ok(range && at >= range.lo && at <= range.hi, `${key} stops where it may`);
    assert.ok(log.ambers.has(key), `${key} showed its ambers first`);
  }
});

test("children get off; some cross in front of the bus, only while its reds flash; all go home", () => {
  const { world, log } = free;
  assert.ok(log.kids.size >= log.stops.size, `${log.kids.size} children off ${log.stops.size} stops`);
  assert.ok(log.crossed.size >= 1, `${log.crossed.size} crossed`);
  assert.equal(log.waiting, 0, "nobody steps off with the reds off");
  for (const kid of log.kids.values()) {
    const cross = kid.path.find((w) => w.cross)?.cross;
    if (cross) assert.ok(cross.school && cross.jaywalk, "a mid-block crossing in front of its bus");
  }
  const left = world.crowd.list.filter((p) => p.child).length;
  assert.ok(left <= 6, `children go home (${left} still about)`);
});

test("traffic stops for a school bus with its reds flashing, and it moves off once they go off", () => {
  const { fleet, log } = free;
  assert.deepEqual(log.passes, []);
  const done = [...log.stops.values()].filter(({ bus }) => fleet.vehicles.includes(bus) && !redsOn(bus));
  assert.ok(done.length >= 1, "reds off again");
  assert.ok(fleet.schoolBuses.every((b) => b.school.phase !== "red" || b.school.t < 45 + 1e-6), "never held for good");
});

// A school bus standing on West 2nd Avenue with its reds on, nobody else about.
function standing({ t = 0, red = 20 } = {}) {
  setWeather("dry");
  const world = new World(KITS, { seed: 1, parked: 0, pedestrians: 0 });
  const fleet = new NpcFleet(world, { count: 0, bikes: 0, seed: 1 });
  const e = [...KITS.edges.values()].find((x) => x.name === "West 2nd Avenue" && stopRange(KITS, x) && x.cum.at(-1) > 150);
  const lane = KITS.lane(e.id, 0), range = stopRange(KITS, e), scale = lane.length / e.cum.at(-1);
  const bus = fleet.addSchoolBus(lane, range.lo * scale - front(SCHOOL_BUS), 0);
  Object.assign(bus.school, { phase: "red", lights: "red", arm: true, doors: true, t, red, stops: 1, stop: { edge: e.id, s: range.lo }, every: Infinity });
  // (the car standing nearby, behind it: school buses far from it leave)
  world.placeOnLane(lane, 1);
  world.resetContactHistory();
  return { world, fleet, bus, e, range, ctx: { world, fleet, autopilot: idle } };
}

test("the reds never go off with a child in the street", () => {
  const { world, bus, e, ctx } = standing({ t: 100, red: 10 });
  const kid = world.crowd.alight(bus, e, true, () => 0.5);
  kid.x = kid.path[0].p[0]; kid.y = kid.path[0].p[1]; kid.path.shift(); kid.crossing = kid.path[0].cross;
  for (let k = 0; k < 60 * 3; k++) {
    step(ctx);
    if (kid.crossing) assert.ok(redsOn(bus), "reds on while the child is in the street, long past 45 s");
  }
  for (let k = 0; k < 60 * 15 && redsOn(bus); k++) step(ctx);
  assert.ok(!kid.crossing && !redsOn(bus), "off once the child is across");
});

test("a school bus coming the other way stops for one with its reds on too", () => {
  const { fleet, bus, e, range, ctx } = standing();
  const back = KITS.lane(twin(KITS, e).id, 0), L = e.cum.at(-1);
  const other = fleet.addSchoolBus(back, (L - range.lo - 60) * back.length / L - front(SCHOOL_BUS), 8);
  assert.equal(schoolBusRelation(other, bus).relation, "oncoming");
  let minGap = Infinity;
  for (let k = 0; k < 60 * 12; k++) {
    step(ctx);
    const r = schoolBusRelation(other, bus);
    if (r && redsOn(bus)) minGap = Math.min(minGap, r.ahead_m);
  }
  assert.ok(fleet.vehicles.includes(other) && minGap > ONCOMING_M - 2, `stopped short of it (${minGap.toFixed(1)} m)`);
});

test("without school buses, traffic runs exactly as before", () => {
  setWeather("dry");
  const run = (opts) => {
    const world = new World(KITS, { seed: 2, pedestrians: 20 }), fleet = new NpcFleet(world, { count: 20, seed: 2, ...opts });
    for (let k = 0; k < 60 * 30; k++) step({ world, fleet, autopilot: idle });
    return fleet.vehicles.map((v) => `${v.id}:${v.x.toFixed(6)},${v.y.toFixed(6)}`).join(" ");
  };
  assert.equal(run({}), run({ schoolBuses: 0 }));
});

// Flashing reds, set up as the challenge: the school bus coming toward the car on West 2nd Avenue,
// stopped with its reds on, the child beside it. With `still`, nothing starts (the challenge does not
// trigger).
const challenge = CHALLENGES.find((c) => c.id === "school-bus");
function reds({ back = 60, v = 11, still = false } = {}) {
  const ctx = setupChallenge(KITS, challenge);
  const { world, fleet, scenario } = ctx;
  if (still) world.challenge = null;
  const bus = fleet.vehicles.find((n) => isSchoolBus(n));
  const lane = world.map.lane(scenario.start.edge, scenario.start.lane);
  // (the car's front `back` metres short of where it stops for the bus)
  const sFront = projectOnLane(lane, [bus.x + Math.cos(bus.psi) * front(bus), bus.y + Math.sin(bus.psi) * front(bus)]);
  world.placeOnLane(lane, sFront - ONCOMING_M - back - front(world.ego));
  world.ego.v = v;
  world.resetContactHistory();
  world._road = world.roadInfo();
  const child = world.crowd.list.find((c) => c.id === "challenge_child");
  return { ...ctx, bus, child };
}
function projectOnLane(lane, pt) {
  let best = null;
  for (let i = 0; i < lane.pts.length - 1; i++) {
    const a = lane.pts[i], b = lane.pts[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dy) / l2)), d = Math.hypot(pt[0] - a[0] - dx * t, pt[1] - a[1] - dy * t);
    if (!best || d < best.d) best = { d, s: lane.cum[i] + t * Math.sqrt(l2) };
  }
  return best.s;
}

test("challenge: a school bus coming the other way on West 2nd Avenue, its reds on and its arm out", () => {
  const { world, bus, child, scenario } = reds();
  assert.equal(world.map.edges.get(scenario.start.edge).name, "West 2nd Avenue");
  assert.ok(bus && redsOn(bus) && bus.school.arm && bus.doors, "standing with its reds on");
  assert.equal(world.map.edges.get(scenario.schoolBus.edge).from, world.map.edges.get(scenario.start.edge).to, "on the same street, coming the other way");
  assert.ok(child && child.child && child.path.some((w) => w.cross?.school === bus.id), "a child by its door, to cross in front of it");
  assert.equal(schoolBusRelation(world.ego, bus).relation, "oncoming");
});

test("the car is told to stop, offered a stop short of the bus, and driving on is rejected", () => {
  const { world } = reds({ back: 40, v: 11 });
  const snap = buildSnapshot(world);
  const sb = snap.school_bus;
  assert.ok(sb && sb.lights === "red" && sb.relation === "oncoming", "sensed");
  assert.ok(Math.abs(sb.bumper_to_stop_m - 40) < 1 && Math.abs(sb.gap_m - sb.bumper_to_stop_m - ONCOMING_M) < 1e-6, "stops 10 m short of its front");
  const candidates = sampleCandidates(snap, world);
  simulateAll(candidates, snap, world);
  assert.ok(candidates.find((c) => c.id === "stop_for_school_bus")?.eligible, "stop_for_school_bus on offer");
  const near = reds({ back: 9, v: 6 }), s2 = buildSnapshot(near.world), c2 = sampleCandidates(s2, near.world);
  simulateAll(c2, s2, near.world);
  const keep = c2.find((c) => c.id === "keep_lane_target");
  assert.ok(keep && keep.reject === "passes_stopped_school_bus", `driving on is rejected (${keep?.reject})`);
  assert.ok(s2.target.v < 7 && s2.target.reasons.includes("school bus stopped, red lights flashing"), "and the target speed slows the car for it");
});

test("decision models and LLMs are told about the school bus", () => {
  const { world } = reds({ back: 25, v: 9 });
  const snap = buildSnapshot(world);
  const candidates = sampleCandidates(snap, world);
  const { eligible } = simulateAll(candidates, snap, world);
  const state = toJevState(snap, candidates, {});
  assert.ok(state.school_bus?.stop === true && state.school_bus.coming_toward_car === true && state.school_bus.lights === "red");
  assert.ok(situationClauses(snap).some((c) => c.includes("red lights flashing") && c.includes("both ways") && c.includes("stop_for_school_bus")));
  const { questions } = buildQuestions(snap, eligible);
  assert.ok(questions.motion.criteria.stop.includes("school_bus.wait_in_m"));
  assert.ok(questions.vector.criteria.stop_for_school_bus.includes("short of the school bus"));
});

test("a car that cannot stop in time when it first sees the reds is not held", () => {
  const { world } = reds({ back: 4, v: 13 });
  assert.equal(buildSnapshot(world).school_bus, null);
});

test("with its ambers on, the car slows down, ready to stop, but is not held", () => {
  const { world, bus } = reds({ back: 15, v: 10 });
  Object.assign(bus.school, { lights: "amber", phase: "approach" });
  const snap = buildSnapshot(world);
  assert.equal(snap.school_bus?.lights, "amber");
  assert.ok(snap.target.v < 9 && snap.target.reasons.includes("school bus about to stop"), `target ${snap.target.v.toFixed(1)} m/s`);
  const candidates = sampleCandidates(snap, world);
  simulateAll(candidates, snap, world);
  assert.ok(!candidates.some((c) => c.id === "stop_for_school_bus" || c.reject === "passes_stopped_school_bus"));
  assert.ok(toJevState(snap, candidates, {}).school_bus.about_to_stop);
});

test("a child crosses in front of the bus only while its reds flash and what is coming can stop", () => {
  const { world, bus, child } = reds({ back: 4, v: 12, still: true });
  const cross = child.path.find((w) => w.cross).cross;
  assert.ok(!world.crowd.mayCross(cross, world.t), "the car is too close to stop: wait");
  world.ego.v = 0;
  assert.ok(world.crowd.mayCross(cross, world.t), "it has stopped");
  Object.assign(bus.school, { lights: null, phase: "leaving" });
  bus.v = 3;
  assert.ok(!world.crowd.mayCross(cross, world.t), "not once the reds are off and the bus moves off");
});

test("the audit: passing it at speed fails to yield, once", () => {
  const { world, fleet } = reds({ back: 50, v: 11, still: true });
  const ctx = { world, fleet, autopilot: idle };
  const failed = [];
  for (let k = 0; k < 60 * 8; k++) {
    step(ctx, { throttle: world.ego.v < 11 ? 0.5 : 0, brake: 0, steer: 0 });
    for (const e of world.events) if (e.type === "failed_to_yield") failed.push(e.to);
  }
  assert.deepEqual(failed, ["school bus"]);
});

test("Rules stops short of the bus coming the other way, waits for the child and the reds, then goes on", () => {
  const ctx = setupChallenge(KITS, challenge), { world, fleet } = ctx;
  const bus = fleet.vehicles.find(isSchoolBus);
  let stoppedAt = null, minGap = Infinity, wentOnWithReds = false, crossedInFront = false, passed = false, moving = false;
  for (let k = 0; k < 60 * 70 && !passed && ctx.autopilot.enabled; k++) {
    step(ctx);
    const r = schoolBusRelation(world.ego, bus);
    if (world.ego.v > 1) moving = true;
    if (r && redsOn(bus)) {
      minGap = Math.min(minGap, r.ahead_m);
      if (moving && Math.abs(world.ego.v) < 0.1 && stoppedAt === null) stoppedAt = r.ahead_m;
      if (stoppedAt !== null && world.ego.v > 0.5) wentOnWithReds = true;
    }
    const child = world.crowd.list.find((p) => p.id === "challenge_child");
    if (child?.crossing) crossedInFront = true;
    if (!r || r.ahead_m < -SCHOOL_BUS.length) passed = true;
  }
  assert.ok(stoppedAt !== null && stoppedAt > ONCOMING_M - 2 && stoppedAt < ONCOMING_M + 2, `stopped ${stoppedAt?.toFixed(1)} m short of its front`);
  assert.ok(minGap > ONCOMING_M - 2, "and never closer while its reds flashed");
  assert.ok(!wentOnWithReds, "it waited for the reds to go off");
  assert.ok(crossedInFront, "the child crossed in front of the bus");
  assert.ok(passed, "then it went on past the bus");
  assert.equal(world.violations.failed_to_yield, 0);
  assert.equal(world.violations.collisions, 0);
});

test("Rules stops behind a school bus that stops in its lane, and follows it once it moves off", () => {
  setWeather("dry");
  const world = new World(KITS, { seed: 1, parked: 0, pedestrians: 0 });
  const fleet = new NpcFleet(world, { count: 0, bikes: 0, seed: 1 });
  const e = [...KITS.edges.values()].find((x) => x.name === "West 2nd Avenue" && stopRange(KITS, x) && x.cum.at(-1) > 150);
  const lane = KITS.lane(e.id, 0), range = stopRange(KITS, e), scale = lane.length / e.cum.at(-1);
  const busS = range.hi * scale - front(SCHOOL_BUS);
  const bus = fleet.addSchoolBus(lane, busS, 0);
  Object.assign(bus.school, { phase: "red", lights: "red", arm: true, doors: true, t: 0, red: 20, stops: 1, stop: { edge: e.id, s: range.hi }, every: Infinity });
  const startS = busS - SCHOOL_BUS.rearOverhang - 70;
  assert.ok(startS > 1, "room behind it");
  world.placeOnLane(lane, startS);
  world.ego.v = 10;
  world.resetContactHistory();
  // (a route straight on along the street)
  world.route = new Route(routeFromLanes(KITS, [lane], startS, lane.length - 5), KITS, world.ego.spec);
  const autopilot = new Autopilot(world);
  autopilot.setBrain("rules");
  autopilot.setEnabled(true);
  const ctx = { world, fleet, autopilot };
  let minGap = Infinity, stopped = false;
  for (let k = 0; k < 60 * 35; k++) {
    step(ctx);
    const r = schoolBusRelation(world.ego, bus);
    if (r && redsOn(bus)) { minGap = Math.min(minGap, r.ahead_m); if (Math.abs(world.ego.v) < 0.1 && minGap < 20) stopped = true; }
  }
  assert.ok(stopped && minGap > BEHIND_M - 1.5, `stopped behind it (${minGap.toFixed(1)} m)`);
  assert.ok(!redsOn(bus) && bus.v > 1, "it moved off");
  assert.equal(world.violations.failed_to_yield, 0);
  assert.equal(world.violations.collisions, 0);
});

test("a checkpoint and restore brings back the children that had gone home", () => {
  const ctx = setupChallenge(KITS, challenge);
  const recorder = new DriveRecorder();
  recorder.record({ world: ctx.world, fleet: ctx.fleet, autopilot: ctx.autopilot, drive: {}, clock: {} }, true);
  const before = ctx.world.crowd.list.map((p) => p.id);
  ctx.world.crowd.list.length = 0;
  const target = { world: ctx.world, fleet: ctx.fleet, autopilot: ctx.autopilot, clock: { setHour() {}, update() {} }, setDrive() {} };
  recorder.restore(0, target);
  assert.deepEqual(target.world.crowd.list.map((p) => p.id), before);
});

console.log(`${checks} school bus checks passed`);
process.exit(0);
