// Buses on their routes: where they stop, pulling in, waiting and pulling out, traffic and the car
// yielding to a bus pulling out (BC MVA s. 169.1), what models are told, closed-loop Rules drives,
// the audit, bus zones, and that the benchmark's traffic is unchanged without them.
// node --experimental-default-type=module scripts/test_buses.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
globalThis.document = { querySelector: () => null };
const { MapData, joinLanes, cumulative, pointAt } = await import("../static/js/map/mapdata.js");
const { Route } = await import("../static/js/map/route.js");
const { World } = await import("../static/js/sim/world.js");
const { Vehicle } = await import("../static/js/sim/vehicle.js");
const { setWeather } = await import("../static/js/sim/weather.js");
const { stepWorld } = await import("../static/js/sim/step.js");
const { buildSnapshot } = await import("../static/js/brain/sensors.js");
const { sampleCandidates, simulateAll } = await import("../static/js/brain/candidates.js");
const { toJevState, buildQuestions, situationClauses } = await import("../static/js/brain/state.js");
const { Autopilot } = await import("../static/js/brain/brain.js");
const { NpcFleet, NpcPath } = await import("../static/js/sim/npc.js");
const { StopMemory } = await import("../static/js/sim/signals.js");
const { busStopFront, busYield, busZones, curbShift, isBus } = await import("../static/js/sim/bus.js");

// One street, West Street, crossing North Street at the origin: one lane each way 3.2 m wide with a
// 2.1 m parking lane, arms 200 m long. A bus route runs east along it with a stop 120 m along the
// western arm (80 m short of the junction).
const ARM = 200, HALF = 1.6;
const ARMS = { w: 180, e: 0, n: 90, s: -90 };
const right = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy); return [dy / d, -dx / d]; };
function junction({ limit = 11.1, stopAt = 120 } = {}) {
  const ends = { c: [0, 0] }, edges = [], lanes = [];
  for (const [arm, deg] of Object.entries(ARMS)) ends[arm] = [ARM * Math.cos(deg * Math.PI / 180), ARM * Math.sin(deg * Math.PI / 180)].map((v) => Math.round(v * 1e6) / 1e6);
  for (const [arm] of Object.entries(ARMS)) for (const [id, from, to] of [[`${arm}_in`, arm, "c"], [`${arm}_out`, "c", arm]]) {
    const pts = [ends[from], ends[to]], [rx, ry] = right(...pts);
    edges.push({ id, from, to, pts, length: ARM, lanes: 1, lane_width: 3.2, lane_offsets: [HALF], asphalt: [-5.3, 5.3], parking: [2.1, 2.1],
      cls: arm === "w" || arm === "e" ? "secondary" : "residential", limit, oneway: false, name: arm === "w" || arm === "e" ? "West Street" : "North Street" });
    lanes.push({ edge: id, idx: 0, pts: pts.map(([x, y]) => [x + rx * HALF, y + ry * HALF]) });
  }
  const transit = { routes: [{ id: "r1", ref: "9", name: "Boundary", runs: [{ edges: ["w_in", "e_out"], length: 400, stops: [{ id: "s1", edge: "w_in", s: stopAt }] }] }],
    stops: [{ id: "s1", name: "West St at Test", x: -ARM + stopAt, y: -6.4 }] };
  const map = new MapData({ bbox: [0, 0, 1, 1], extent: [-ARM - 20, -ARM - 20, ARM + 20, ARM + 20], edges, lanes, transit,
    nodes: Object.entries(ends).map(([id, [x, y]]) => ({ id, x, y })), intersections: [], stops: [], buildings: [] });
  const routeData = { id: "east", polyline: resample(joinLanes(map.lane("w_in", 0).pts, map.lane("e_out", 0).pts)), edges: ["w_in", "e_out"], turns: [], start_s: 0, goal_s: 380 };
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

// The car with its front at x = `front` going east at `v` along West Street, and a bus `busAt`
// metres along the western arm (its rear axle), on its route.
function setup({ front = -190, v = 0, busAt = 60, j = J, buses = true } = {}) {
  setWeather("dry");
  const world = new World(j.map, { parked: 0, pedestrians: 0, buses });
  Object.assign(world.ego, { x: front - FRONT, y: -HALF, psi: 0, v });
  world.resetContactHistory();
  world.route = new Route(j.routeData, j.map);
  world.destination = world.route.endPoint();
  const fleet = new NpcFleet(world, { count: 0, bikes: 0, seed: 3 });
  const bus = busAt === null ? null : fleet.spawnBus(0, fleet.busRuns()[0], busAt);
  world._road = world.roadInfo();
  return { world, fleet, bus };
}
const idle = { enabled: false, step() {} };
const step = (world, fleet, input = {}, autopilot = idle) => stepWorld({ world, fleet, autopilot, input }, 1 / 60, world.t * 1000);
// Run until the bus reaches `phase` (or `seconds` pass); returns whether it did.
function until(world, fleet, bus, phase, seconds = 60, each = () => {}) {
  for (let k = 0; k < seconds * 60; k++) {
    step(world, fleet);
    each(world);
    if (bus.transit.phase === phase) return true;
  }
  return false;
}
function test(name, fn) { fn(); console.log(`✓ ${name}`); }

test("a stop's bus stands 1 m past its sign, clear of the junction behind it and short of the one ahead", () => {
  const m = J.map;
  assert.ok(Math.abs(busStopFront(m, "w_in", 120) - 121) < 1e-9, "1 m past the sign");
  // (the far side of a junction: its rear clear of the crossing street, 5.3 m, plus a metre)
  assert.ok(Math.abs(busStopFront(m, "e_out", 2) - (5.3 + 12.2 + 1)) < 1e-9, "far side, rear clear of the junction");
  assert.ok(busStopFront(m, "w_in", 196) === null, "no room before the junction ahead");
  assert.ok(Math.abs(curbShift(m.edges.get("w_in"), 0) - (5.3 - 1.6 - 1.275 - 0.3)) < 1e-9, "into the parking lane, 0.3 m off the curb");
  const zones = busZones(m).get("w_in");
  assert.ok(zones.length === 1 && Math.abs(zones[0][0] - (121 - 12.2 - 10)) < 1e-9 && Math.abs(zones[0][1] - 124) < 1e-9, "a bus zone around it");
});

test("nobody parks in a bus zone when buses run, and parking is as before when they don't", () => {
  const before = new World(J.map, { pedestrians: 0 }), off = new World(J.map, { pedestrians: 0, buses: false }), on = new World(J.map, { pedestrians: 0, buses: true });
  const key = (w) => w.parked.list.map((c) => `${c.x.toFixed(3)},${c.y.toFixed(3)}`).join(";");
  assert.ok(key(before) === key(off) && before.parked.slots.length === off.parked.slots.length, "unchanged without buses");
  const inZone = (w) => w.parked.slots.filter((s) => s.edge === "w_in" && s.curb === "right" && s.x > -ARM + 98 && s.x < -ARM + 124).length;
  assert.ok(inZone(off) > 0, "bays there without buses");
  assert.ok(inZone(on) === 0, "none in the bus zone with buses");
});

test("a bus signals, pulls in to the curb, waits with its doors open, signals left and pulls out", () => {
  const { world, fleet, bus } = setup();
  assert.ok(bus && isBus(bus) && bus.transit.stops.length === 1, "placed on its run with its stop ahead");
  let signalledRight = false;
  assert.ok(until(world, fleet, bus, "in", 40), "approaches its stop");
  assert.ok(until(world, fleet, bus, "dwell", 40, () => { signalledRight ||= bus.signal === "right"; }), "stops");
  assert.ok(signalledRight, "signalling right as it pulls in");
  const sFront = bus.x + bus.spec.length - bus.spec.rearOverhang + ARM;
  assert.ok(Math.abs(sFront - 121) < 2.5, `front at the stop (${sFront.toFixed(1)} m along)`);
  const shift = -bus.y - HALF;
  assert.ok(shift > 1.8 && shift < 2.2, `pulled in to the curb (${shift.toFixed(2)} m)`);
  assert.ok(bus.doors === true, "doors open");
  const dwellStart = world.t;
  assert.ok(until(world, fleet, bus, "leaving", 30), "done at the stop");
  const dwell = world.t - dwellStart;
  assert.ok(dwell >= 10 - 0.05 && dwell <= 25 + 0.05, `waits 10 to 25 s (${dwell.toFixed(1)})`);
  assert.ok(bus.doors === false && bus.signal === "left", "doors shut, signalling left");
  const leaveStart = world.t;
  assert.ok(until(world, fleet, bus, "out", 10), "pulls out");
  assert.ok(world.t - leaveStart >= 2 - 1e-6 && world.t - leaveStart < 2.2, "after signalling for 2 s, with nothing coming");
  assert.ok(until(world, fleet, bus, "drive", 15), "back in its lane");
  assert.ok(Math.abs(-bus.y - HALF) < 0.3 && bus.v > 2, `driving on along its lane (${(-bus.y - HALF).toFixed(2)} m, ${bus.v.toFixed(1)} m/s)`);
});

test("traffic coming up behind lets a bus pulling out go first, and the bus waits for one that can't stop", () => {
  const add = (world, fleet, x, v) => {
    const car = new Vehicle(x, -HALF, 0, v);
    Object.assign(car, { id: `car_${x.toFixed(0)}`, v0: 11, driver: { aMax: 1.5, b: 2, T: 1.2, s0: 2, react: 0.5, lcRate: 0 }, stopMem: new StopMemory(), frozen: 0, waiting: 0 });
    car.path = new NpcPath(J.map, () => 0.5);
    car.path.start("w_in", 0, x + ARM);
    fleet.vehicles.push(car);
    return car;
  };
  {
    // signalling: a car 50 m behind at 10 m/s (it can stop 2 m behind braking at 1 m/s^2) waits
    const { world, fleet, bus } = setup();
    assert.ok(until(world, fleet, bus, "leaving", 80), "at its stop, done");
    const rear = bus.x - bus.spec.rearOverhang, car = add(world, fleet, rear - 50 - (4.5 - 0.9), 10);
    let passed = false, minGap = Infinity;
    assert.ok(until(world, fleet, bus, "drive", 30, () => {
      const g = (bus.x - bus.spec.rearOverhang) - (car.x + 4.5 - 0.9);
      if (bus.transit.phase !== "drive") minGap = Math.min(minGap, g);
      passed ||= g < 0;
    }), "the bus pulls out");
    assert.ok(!passed, "the car never draws level with it");
    assert.ok(minGap > 1, `the car stops behind it (${minGap.toFixed(1)} m)`);
    assert.ok(world.violations.collisions === 0, "nothing touches");
  }
  {
    // coming up fast, 20 m behind at 11 m/s (it would need 20.2 m braking at 3 m/s^2) and then
    // beside it: the bus pulls out only when the car can stop behind it, and never while it is beside
    for (const [back, v] of [[20, 11], [-6, 3]]) {
      const { world, fleet, bus } = setup();
      assert.ok(until(world, fleet, bus, "leaving", 80), "at its stop, done");
      for (let k = 0; k < 60 * 1.9; k++) step(world, fleet);   // (signalling for most of 2 s)
      const car = add(world, fleet, bus.x - bus.spec.rearOverhang - back - (4.5 - 0.9), v);
      // (beside it, it has eased over to pass it)
      if (back < 0) { car.nudge = -0.45; car.y = -HALF + 0.45; }
      let outAt = null, roomAtOut = null, vAtOut = null, beside = null;
      for (let k = 0; k < 60 * 12 && outAt === null; k++) {
        step(world, fleet);
        if (bus.transit.phase === "out") {
          outAt = world.t; vAtOut = car.v;
          roomAtOut = (bus.x - bus.spec.rearOverhang) - (car.x + 4.5 - 0.9) - 2;
          beside = car.x + 4.5 - 0.9 > bus.x - bus.spec.rearOverhang && car.x - 0.9 < bus.x + bus.spec.length - bus.spec.rearOverhang;
        }
      }
      assert.ok(outAt !== null, `${back} m: it pulls out in the end`);
      assert.ok(!beside, `${back} m: not while the car is beside it`);
      assert.ok(roomAtOut < 0 || roomAtOut >= vAtOut ** 2 / 6 - 1e-6, `${back} m: only once the car can stop behind it (${roomAtOut.toFixed(1)} m at ${vAtOut.toFixed(1)} m/s)`);
      assert.ok(world.violations.collisions === 0, "nothing touches");
    }
  }
  {
    // on a road over 60 km/h, traffic need not yield: the bus waits for a gap
    const fast = junction({ limit: 19.5 });
    const { world, fleet, bus } = setup({ j: fast });
    assert.ok(until(world, fleet, bus, "leaving", 80), "at its stop, done");
    const rear = bus.x - bus.spec.rearOverhang, car = add(world, fleet, rear - 60 - (4.5 - 0.9), 16);
    assert.ok(busYield(car, bus) === null, "no duty to yield over 60 km/h");
    let outBefore = false;
    for (let k = 0; k < 60 * 3; k++) { step(world, fleet); outBefore ||= bus.transit.phase === "out"; }
    assert.ok(!outBefore, "the bus waits for the car");
  }
});

// The car on its route, `front` along West Street (x), behind a bus at its stop that is about to
// signal; runs Rules closed loop.
function drive(world, fleet, seconds, each = () => {}) {
  const autopilot = new Autopilot(world);
  autopilot.setBrain("rules");
  autopilot.setEnabled(true);
  const out = { failed: 0 };
  for (let k = 0; k < seconds * 60; k++) {
    step(world, fleet, {}, autopilot);
    for (const e of world.events) if (e.type === "failed_to_yield") out.failed++;
    each(world, out);
    if (!autopilot.enabled) break;
  }
  out.collisions = world.violations.collisions;
  out.arrived = !autopilot.enabled;
  return out;
}

test("the car sees a bus signalling ahead, is told to let it out, and models get it", () => {
  const { world, fleet, bus } = setup({ front: -190 });
  assert.ok(until(world, fleet, bus, "leaving", 80), "at its stop, done");
  // (the car 20 m behind it at 7 m/s)
  const rear = bus.x - bus.spec.rearOverhang;
  Object.assign(world.ego, { x: rear - 20 - FRONT, y: -HALF, psi: 0, v: 7 });
  world.resetContactHistory();
  const snap = buildSnapshot(world);
  assert.ok(snap.bus && snap.bus.id === bus.id && snap.bus.ref === "9", "sensed");
  assert.ok(Math.abs(snap.bus.bumper_to_stop_m - 18) < 0.5, `stops 2 m behind it (${snap.bus.bumper_to_stop_m.toFixed(1)} m)`);
  const candidates = sampleCandidates(snap, world);
  simulateAll(candidates, snap, world);
  const yieldTo = candidates.find((c) => c.id === "yield_to_bus");
  assert.ok(yieldTo && yieldTo.eligible, "a candidate that stops behind it");
  assert.ok(candidates.filter((c) => c.eligible && c.law.kind === "lane").every((c) => c.sim.progress_m < 18 + 1.5), "nothing eligible carries on past it");
  assert.ok(candidates.some((c) => c.reject === "fails_to_yield_to_bus"), `carrying on is rejected (${candidates.map((c) => `${c.id}:${c.reject}:${c.sim.progress_m.toFixed(1)}`).join(" ")})`);
  const state = toJevState(snap, candidates, {});
  assert.ok(state.bus_pulling_out?.route === "9" && state.bus_pulling_out.yield === true, "the state says so");
  assert.ok(situationClauses(snap).some((l) => l.includes("yield_to_bus") && l.includes("must let it out")), "the situation says to let it out");
  assert.ok(buildQuestions(snap, candidates.filter((c) => c.eligible)).questions.motion.criteria.stop.includes("bus_pulling_out"), "the stop criterion covers waiting for it");
  // too close to stop braking at 3 m/s^2 when it sees the signal: it carries on, and is not told to yield
  const late = setup({ front: -190 });
  assert.ok(until(late.world, late.fleet, late.bus, "leaving", 80), "at its stop, done");
  Object.assign(late.world.ego, { x: late.bus.x - late.bus.spec.rearOverhang - 12 - FRONT, y: -HALF, psi: 0, v: 11 });
  late.world.resetContactHistory();
  assert.ok(buildSnapshot(late.world).bus === null, "too late to stop: not owed");
});

test("closed loop: Rules slows or stops behind a bus pulling out, lets it out, follows it and arrives", () => {
  for (const [behind, v] of [[45, 9], [16, 5]]) {
    const { world, fleet, bus } = setup({ front: -190, busAt: 70 });
    assert.ok(until(world, fleet, bus, "dwell", 40), "at its stop");
    // (the car `behind` metres back at `v` as the bus finishes, with half a second to go)
    bus.transit.dwell = bus.transit.t + 0.5;
    Object.assign(world.ego, { x: bus.x - bus.spec.rearOverhang - behind - FRONT, y: -HALF, psi: 0, v });
    world.resetContactHistory();
    let vAtSignal = null, minV = Infinity, outGap = null, levelWhileSignalling = false;
    const out = drive(world, fleet, 70, (w) => {
      const g = (bus.x - bus.spec.rearOverhang) - (w.ego.x + FRONT), ph = bus.transit.phase;
      if (ph === "leaving") { vAtSignal ??= w.ego.v; minV = Math.min(minV, w.ego.v); if (g < 0) levelWhileSignalling = true; }
      if (ph === "out" && outGap === null) outGap = g;
    });
    assert.ok(vAtSignal !== null && minV < vAtSignal - 1, `${behind} m: slows for it as it signals (${vAtSignal?.toFixed(1)} to ${minV.toFixed(1)} m/s)`);
    assert.ok(!levelWhileSignalling && outGap > 0, `${behind} m: the bus pulls out ahead of it (${outGap?.toFixed(1)} m)`);
    assert.ok(out.failed === 0 && out.collisions === 0, `${behind} m: no failure to yield, no collision (${out.failed}, ${out.collisions})`);
    assert.ok(out.arrived, `${behind} m: arrives`);
  }
});

test("the audit: driving past a bus pulling out that it could have stopped for fails to yield, once", () => {
  const { world, fleet, bus } = setup({ front: -190 });
  assert.ok(until(world, fleet, bus, "leaving", 80), "at its stop, done");
  // the bus keeps signalling (something holds it): the car, 45 m back at 9 m/s, drives on regardless
  bus.transit.t = -100;
  Object.assign(world.ego, { x: bus.x - bus.spec.rearOverhang - 45 - FRONT, y: -HALF, psi: 0, v: 9 });
  world.resetContactHistory();
  let failures = 0;
  for (let k = 0; k < 60 * 8; k++) {
    // (steering round it: a little left of its lane)
    Object.assign(world.ego, { y: -HALF + Math.min(1.2, Math.max(0, (world.ego.x - (bus.x - 25)) / 10)), psi: 0, v: 9 });
    step(world, fleet);
    failures += world.events.filter((e) => e.type === "failed_to_yield" && e.to === "bus").length;
  }
  assert.ok(failures === 1, `counted once (${failures})`);
  // one that could not have stopped when it first saw the signal is not counted
  const late = setup({ front: -190 });
  assert.ok(until(late.world, late.fleet, late.bus, "leaving", 80), "at its stop, done");
  late.bus.transit.t = -100;
  Object.assign(late.world.ego, { x: late.bus.x - late.bus.spec.rearOverhang - 10 - FRONT, y: -HALF + 1.2, psi: 0, v: 10 });
  late.world.resetContactHistory();
  let lateFailures = 0;
  for (let k = 0; k < 60 * 5; k++) {
    Object.assign(late.world.ego, { y: -HALF + 1.2, psi: 0, v: 10 });
    step(late.world, late.fleet);
    lateFailures += late.world.events.filter((e) => e.type === "failed_to_yield" && e.to === "bus").length;
  }
  assert.ok(lateFailures === 0, "not counted when it could not stop");
  // hidden when it starts to signal, then seen with room to stop: owed from when it is seen
  const hid = setup({ front: -190 });
  assert.ok(until(hid.world, hid.fleet, hid.bus, "leaving", 80), "at its stop, done");
  hid.bus.transit.t = -100;
  Object.assign(hid.world.ego, { x: hid.bus.x - hid.bus.spec.rearOverhang - 60 - FRONT, y: -HALF, psi: 0, v: 9 });
  hid.world.resetContactHistory();
  const sees = hid.world.visibility.sees.bind(hid.world.visibility);
  hid.world.visibility.sees = (a, b) => (b === hid.bus && hid.world.t < hid.t0 + 1 ? false : sees(a, b));
  hid.t0 = hid.world.t;
  let hidFailures = 0;
  for (let k = 0; k < 60 * 10; k++) {
    Object.assign(hid.world.ego, { y: -HALF + Math.min(1.2, Math.max(0, (hid.world.ego.x - (hid.bus.x - 25)) / 10)), psi: 0, v: 9 });
    step(hid.world, hid.fleet);
    hidFailures += hid.world.events.filter((e) => e.type === "failed_to_yield" && e.to === "bus").length;
  }
  assert.ok(hidFailures === 1, `counted once it was seen (${hidFailures})`);
});

test("bundled maps: every bus run is on the map's streets, every stop on a run edge, and traffic without buses is unchanged", () => {
  const root = new URL("../data/maps/", import.meta.url);
  const files = fs.readdirSync(root).filter((f) => f.endsWith(".transit.v1.json"));
  assert.ok(files.length === 12, `a transit file per bundled map (${files.length})`);
  let runs = 0, stops = 0;
  for (const f of files) {
    const transit = JSON.parse(fs.readFileSync(new URL(f, root))), pack = JSON.parse(fs.readFileSync(new URL(f.replace(".transit.v1.json", ".v6.pack.json"), root)));
    const edges = new Map(pack.edges.map((e) => [e.id, e]));
    for (const route of transit.routes) for (const run of route.runs) {
      runs++;
      assert.ok(run.edges.every((id) => edges.has(id)), `${f}: run edges exist`);
      assert.ok(run.edges.every((id, i) => i === 0 || edges.get(run.edges[i - 1]).to === edges.get(id).from), `${f}: run edges join up`);
      for (const st of run.stops) { stops++; assert.ok(run.edges.includes(st.edge) && st.s >= 0 && st.s <= edges.get(st.edge).length + 0.1, `${f}: stop on its run`); }
    }
  }
  assert.ok(runs > 100 && stops > 300, `routes and stops (${runs} runs, ${stops} stops)`);
  // Kitsilano, the benchmark's own traffic, with and without its transit: the same
  const kits = (withTransit) => {
    const pack = JSON.parse(fs.readFileSync(new URL("623b012bc8b5.v6.pack.json", root)));
    if (withTransit) pack.transit = JSON.parse(fs.readFileSync(new URL("623b012bc8b5.transit.v1.json", root)));
    setWeather("dry");
    const world = new World(new MapData(pack), { seed: 5 });
    const fleet = new NpcFleet(world, { count: 30, seed: 5 });
    for (let k = 0; k < 60 * 20; k++) step(world, fleet);
    return { buses: fleet.vehicles.filter(isBus).length, key: fleet.vehicles.map((v) => `${v.id}:${v.x.toFixed(4)},${v.y.toFixed(4)}`).join(";"), parked: world.parked.list.length };
  };
  const a = kits(false), b = kits(true);
  assert.ok(a.buses === 0 && b.buses === 0, "no buses unless asked for");
  assert.ok(a.key === b.key && a.parked === b.parked, "the same traffic and parking with the transit file loaded");
  // and with buses asked for, they run
  const pack = JSON.parse(fs.readFileSync(new URL("623b012bc8b5.v6.pack.json", root)));
  pack.transit = JSON.parse(fs.readFileSync(new URL("623b012bc8b5.transit.v1.json", root)));
  const world = new World(new MapData(pack), { seed: 5, buses: true });
  const fleet = new NpcFleet(world, { count: 30, seed: 5, buses: true });
  assert.ok(fleet.vehicles.filter(isBus).length === 4, "four buses on Kitsilano's routes");
});
