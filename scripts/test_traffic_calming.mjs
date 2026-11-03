// Speed humps, tables, cushions and bumps: the devices on the map and along a route, their shape, who
// slows for them, the driven car's sensing and target speed, traffic slowing, closed-loop Rules, the
// audit of hard hits and its metrics, what models are told, nothing at all with the option off, and
// the "Over the humps" challenge with Rules and the cautious agent.
// node --experimental-default-type=module scripts/test_traffic_calming.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
globalThis.document = { querySelector: () => null };
const { MapData, pointAt, headingAt } = await import("../static/js/map/mapdata.js");
const { World } = await import("../static/js/sim/world.js");
const { NpcFleet, NpcPath } = await import("../static/js/sim/npc.js");
const { Vehicle, CAR, BIKE, BUS } = await import("../static/js/sim/vehicle.js");
const { StopMemory } = await import("../static/js/sim/signals.js");
const { stepWorld } = await import("../static/js/sim/step.js");
const { setWeather } = await import("../static/js/sim/weather.js");
const { rng } = await import("../static/js/common.js");
const { DEVICES, HIT_OVER_MPS, calmingAhead, calmingNotice, liftAt, pathCalmLimit, riseAt, slowsFor } = await import("../static/js/sim/traffic-calming.js");
const { DriveScore } = await import("../static/js/sim/drive-score.js");
const { DriveMetrics, failures } = await import("../static/js/bench/metrics.js");
const { buildSnapshot } = await import("../static/js/brain/sensors.js");
const { toJevState, situationClauses } = await import("../static/js/brain/state.js");
const { SYSTEM_PROMPT } = await import("../static/js/brain/llm-prompt.js");
const { Autopilot } = await import("../static/js/brain/brain.js");
const { CHALLENGES, challengeScenario } = await import("../static/js/lab/challenges.js");
const { setupChallenge, evaluateChallenge } = await import("../static/js/lab/evaluation.js");
const { Route } = await import("../static/js/map/route.js");
const { routeFromLanes } = await import("../static/js/demo/routing.js");

let checks = 0;
async function test(name, fn) { await fn(); checks++; console.log(`✓ ${name}`); }
const root = new URL("../data/maps/", import.meta.url);
const load = (key) => {
  const pack = JSON.parse(fs.readFileSync(new URL(`${key}.v6.pack.json`, root)));
  for (const name of ["transit", "crossings", "zones", "rail", "calming", "scrambles"]) {
    const url = new URL(`${key}.${name}.v1.json`, root);
    if (fs.existsSync(url)) pack[name] = JSON.parse(fs.readFileSync(url));
  }
  pack.utc_offset = -4;
  return new MapData(pack);
};
const OTTAWA = load("d25b07def0d2");
const step = (ctx) => stepWorld(ctx, 1 / 60, ctx.world.t * 1000);
const idle = { enabled: false, step() {} };
// Gloucester Street, Centretown: one-way, 50 km/h, a speed hump about 85 m along each block (Bank to
// Kent, then Kent to Lyon).
const BLOCK = "e491", NEXT = "e492";
const lane = OTTAWA.lane(BLOCK, 0), next = OTTAWA.lane(NEXT, 0);
const hump = OTTAWA.calmingSpans.get(BLOCK)[0];

function street({ calming = true, seed = 3 } = {}) {
  setWeather("dry");
  const world = new World(OTTAWA, { seed, parked: 0, pedestrians: 0, calming });
  const fleet = new NpcFleet(world, { count: 0, bikes: 0, seed: 5 });
  world.placeOnLane(lane, 4);
  world.route = new Route(routeFromLanes(OTTAWA, [lane, next], 4, 150), OTTAWA, world.ego.spec);
  return { world, fleet };
}

function npc(world, fleet, id, s, spec = CAR, v = 13.9) {
  const p = pointAt(lane.pts, lane.cum, s), car = new Vehicle(p[0], p[1], headingAt(lane.pts, lane.cum, s), v, spec);
  Object.assign(car, { id, kind: spec.kind === "bike" ? "bike" : spec === BUS ? "bus" : "car", color: 0x777777, v0: spec.kind === "bike" ? 5 : 13.9,
    driver: { aMax: 1.5, b: 2, s0: 2, T: 1.2, react: 0.8, lcRate: 0 }, stopMem: new StopMemory(), path: new NpcPath(OTTAWA, rng(9), { bike: spec.kind === "bike" }), frozen: 0, waiting: 0 });
  car.path.start(BLOCK, 0, s, [[NEXT, 0]]);
  fleet.vehicles.push(car);
  return car;
}

// The speed vehicle `n` (or the car) crosses edge BLOCK's hump at with its front axle.
function crossingSpeed(ctx, n, max_s = 30) {
  const a = OTTAWA.edges.get(BLOCK), [hx, hy] = [hump.device.x, hump.device.y];
  let before = null;
  for (let i = 0; i < 60 * max_s; i++) {
    step(ctx);
    if (ctx.autopilot.firing) { /* lockstep below */ }
    const c = Math.cos(n.psi), s = Math.sin(n.psi), ahead = (hx - n.x) * c + (hy - n.y) * s - n.spec.wheelbase;
    if (before !== null && before > 0 && ahead <= 0) return n.v;
    before = ahead;
  }
  return null;
}

await test("Ottawa's devices lie on its own edges, and a route over Gloucester Street has its humps in order", () => {
  assert.ok(OTTAWA.calming.length > 40);
  for (const d of OTTAWA.calming) {
    assert.ok(DEVICES[d.kind], d.kind);
    for (const a of d.at) assert.ok(OTTAWA.edges.has(a.edge) && a.s >= 0 && a.s <= OTTAWA.edges.get(a.edge).length);
  }
  assert.equal(hump.device.kind, "hump");
  assert.ok(hump.s > 80 && hump.s < 90, `${hump.s}`);
  const r = new Route(routeFromLanes(OTTAWA, [lane, next], 4, 150), OTTAWA, CAR);
  assert.equal(r.calmingMarks.length, 2);
  assert.ok(r.calmingMarks[0].at < r.calmingMarks[1].at);
  assert.ok(Math.abs(r.calmingMarks[0].at - (hump.s - 4)) < 2, `${r.calmingMarks[0].at}`);
});

await test("each kind has its shape: a hump peaks at its centre, a table is flat on top, nothing past either end", () => {
  const h = { kind: "hump" }, t = { kind: "table" }, b = { kind: "bump" };
  assert.equal(riseAt(h, 0), DEVICES.hump.height);
  assert.ok(riseAt(h, 1) < DEVICES.hump.height && riseAt(h, 1) > 0);
  assert.equal(riseAt(h, DEVICES.hump.length / 2), 0);
  assert.equal(riseAt(t, 1.2), DEVICES.table.height);
  assert.ok(riseAt(t, 2.5) > 0 && riseAt(t, 2.5) < DEVICES.table.height);
  assert.equal(riseAt(b, 0.5), 0);
  assert.equal(liftAt(OTTAWA, hump.device.x, hump.device.y), DEVICES.hump.height);
  assert.equal(liftAt(OTTAWA, hump.device.x + 30, hump.device.y + 30), 0);
});

await test("cars slow for every kind; cyclists for none; buses straddle cushions but not humps", () => {
  assert.equal(slowsFor(CAR, { kind: "hump" }), true);
  assert.equal(slowsFor(CAR, { kind: "cushion" }), true);
  assert.equal(slowsFor(BIKE, { kind: "hump" }), false);
  assert.equal(slowsFor(BUS, { kind: "hump" }), true);
  assert.equal(slowsFor(BUS, { kind: "cushion" }), false);
  const path = new NpcPath(OTTAWA, rng(1));
  const at = hump.s - 25;
  path.start(BLOCK, 0, at, [[NEXT, 0]]);
  assert.equal(pathCalmLimit(OTTAWA, path, at + 3.6, BIKE, 0.25), Infinity);
  const v = pathCalmLimit(OTTAWA, path, at + 3.6, CAR, 0.9);
  assert.ok(v > DEVICES.hump.mps && v < 13.9, `${v}`);
});

await test("the car senses the next hump, and its limit and target come down to 30 km/h by it; off, nothing", () => {
  const { world, fleet } = street();
  world.placeOnLane(lane, hump.s - 30);
  world.ego.v = 13.9;
  const snap = buildSnapshot(world, null);
  assert.ok(snap.traffic_calming, "senses it");
  assert.equal(snap.traffic_calming.kind, "hump");
  assert.ok(snap.traffic_calming.starts_in_m > 15 && snap.traffic_calming.starts_in_m < 30);
  assert.ok(snap.limit < 13.9 && snap.limit > DEVICES.hump.mps, `${snap.limit}`);
  assert.ok(snap.target.v <= snap.limit + 1e-9);
  assert.ok(snap.target.reasons.includes("speed hump ahead"), snap.target.reasons.join());
  world.placeOnLane(lane, hump.s - 2);
  const over = buildSnapshot(world, null);
  assert.equal(over.traffic_calming.over, true);
  assert.ok(Math.abs(over.limit - DEVICES.hump.mps) < 1e-6);
  const off = street({ calming: false }).world;
  off.placeOnLane(lane, hump.s - 30);
  off.ego.v = 13.9;
  const s0 = buildSnapshot(off, null);
  assert.equal(s0.traffic_calming, null);
  assert.ok(Math.abs(s0.limit - OTTAWA.edges.get(BLOCK).limit) < 1e-6);
  assert.equal(fleet.vehicles.length, 0);
});

await test("closed-loop Rules crosses both humps at about 30 km/h; with calming off it takes them at the limit", async () => {
  for (const calming of [true, false]) {
    const { world, fleet } = street({ calming });
    const autopilot = new Autopilot(world, {});
    autopilot.setBrain("rules"); autopilot.setEnabled(true);
    const ctx = { world, fleet, autopilot }, speeds = [];
    const marks = world.route.calmingMarks.map((m) => m.at);
    let last = 0;
    while (world.t < 40 && world.route && speeds.length < 2) {
      step(ctx);
      if (autopilot.firing) await autopilot.firing;
      const p = world.route?.project(world.ego.x, world.ego.y, world.route.hint);
      if (!p) break;
      for (const m of marks) if (last < m - CAR.wheelbase && p.s >= m - CAR.wheelbase) speeds.push(world.ego.v);
      last = p.s;
    }
    assert.equal(speeds.length, 2);
    for (const v of speeds) {
      if (calming) assert.ok(v < DEVICES.hump.mps + 1.5 / 3.6, `crossed at ${v * 3.6} km/h`);
      else assert.ok(v > DEVICES.hump.mps + HIT_OVER_MPS, `crossed at ${v * 3.6} km/h with calming off`);
    }
    if (calming) assert.equal(world.violations.hump_hits || 0, 0);
    autopilot.setEnabled(false);
  }
});

await test("traffic slows for a hump, a cyclist rides over it, and with calming off nobody slows", () => {
  for (const calming of [true, false]) {
    const { world, fleet } = street({ calming });
    world.placeOnLane(OTTAWA.lane("e490", 0), 10);   // (the car out of the way, on the block before)
    const car = npc(world, fleet, "calm_car", 10);
    const v = crossingSpeed({ world, fleet, autopilot: idle }, car);
    assert.ok(v !== null);
    if (calming) assert.ok(v < 38 / 3.6, `traffic crossed at ${v * 3.6} km/h`);
    else assert.ok(v > 12, `traffic crossed at ${v * 3.6} km/h with calming off`);
  }
  const { world, fleet } = street();
  world.placeOnLane(OTTAWA.lane("e490", 0), 10);
  const bike = npc(world, fleet, "calm_bike", 40, BIKE, 5);
  const v = crossingSpeed({ world, fleet, autopilot: idle }, bike);
  assert.ok(v > 4.5, `cyclist ${v}`);
});

await test("taking a hump at 50 km/h is a hard hit: counted once, in the metrics and the coaching, and fails the drive", () => {
  for (const calming of [true, false]) {
    const { world, fleet } = street({ calming });
    const score = new DriveScore(world, { title: "test" }), metrics = new DriveMetrics(world.route.length);
    let s = hump.s - 30;
    world.placeOnLane(lane, s);
    for (let i = 0; i < 60 * 4; i++) {
      s += 13.9 / 60;
      const p = pointAt(lane.pts, lane.cum, s);
      Object.assign(world.ego, { x: p[0], y: p[1], psi: headingAt(lane.pts, lane.cum, s), v: 13.9 });
      const road = step({ world, fleet, autopilot: idle });
      score.record(world, road, 1 / 60); metrics.record(world, null, road, 1 / 60);
    }
    const sum = metrics.summary(world, { totals: { decisions: 0, calls: 0, tokens: 0, cost: 0 } }, true), report = score.snapshot();
    if (calming) {
      assert.equal(world.violations.hump_hits, 1);
      assert.equal(sum.hump_hits, 1);
      assert.ok(failures(sum).includes("took a speed hump too fast"));
      assert.equal(report.hump_hits, 1);
      assert.ok(report.incidents.some((x) => x.type === "hump_hit"));
      assert.ok(report.tips.some((t) => /speed humps/.test(t)));
    } else {
      assert.equal(world.violations.hump_hits, undefined);
      assert.equal("hump_hits" in sum, false);
      assert.equal("hump_hits" in report, false);
      assert.equal(world.calmingSeen, false);
    }
  }
});

await test("crossing slowly is no hit, but the device is seen, and the metric is reported as 0", () => {
  const { world, fleet } = street();
  const metrics = new DriveMetrics(world.route.length);
  let s = hump.s - 10;
  world.placeOnLane(lane, s);
  for (let i = 0; i < 60 * 4; i++) {
    s += 8 / 60;
    const p = pointAt(lane.pts, lane.cum, s);
    Object.assign(world.ego, { x: p[0], y: p[1], psi: headingAt(lane.pts, lane.cum, s), v: 8 });
    metrics.record(world, null, step({ world, fleet, autopilot: idle }), 1 / 60);
  }
  assert.equal(world.calmingSeen, true);
  const sum = metrics.summary(world, { totals: { decisions: 0, calls: 0, tokens: 0, cost: 0 } }, true);
  assert.equal(sum.hump_hits, 0);
  assert.equal(failures(sum).includes("took a speed hump too fast"), false);
});

await test("models are told about the hump in the state, the situation and the prompt; the HUD says so", () => {
  const { world } = street();
  world.placeOnLane(lane, hump.s - 30);
  world.ego.v = 13.9;
  const snap = buildSnapshot(world, null), state = toJevState(snap, [], {});
  assert.equal(state.traffic_calming.kind, "speed hump");
  assert.equal(state.traffic_calming.speed, Math.round(DEVICES.hump.mps * 10) / 10);
  assert.ok(situationClauses(snap).some((c) => /speed hump lies across the street/.test(c)));
  assert.match(SYSTEM_PROMPT, /traffic_calming/);
  const notice = calmingNotice(world);
  assert.ok(notice && /SPEED HUMP AHEAD · SLOW TO 30 KM\/H/.test(notice.text), notice?.text);
  const off = street({ calming: false }).world;
  off.placeOnLane(lane, hump.s - 30);
  assert.equal(calmingNotice(off), null);
  assert.equal("traffic_calming" in toJevState(buildSnapshot(off, null), [], {}), false);
});

await test("Over the humps: Rules and the cautious agent cross both humps without a hard hit and arrive", async () => {
  const ch = CHALLENGES.find((c) => c.id === "speed-humps");
  assert.ok(ch && ch.calming);
  const scenario = challengeScenario(OTTAWA, ch);
  assert.equal(scenario.start.edge, BLOCK);
  const ctx = setupChallenge(OTTAWA, ch);
  assert.equal(ctx.world.calming, true);
  assert.equal(ctx.world.route.calmingMarks.length, 2);
  ctx.autopilot.setEnabled(false);
  for (const brain of ["rules", "cautious"]) {
    const r = await evaluateChallenge(OTTAWA, ch, { brain });
    assert.equal(r.pass, true, `${brain}: ${r.failures}`);
    assert.equal(r.hump_hits, 0);
    assert.equal(r.collisions, 0);
  }
});

console.log(`${checks} checks passed`);
process.exit(0);
