// Garbage trucks on collection day: the streets they stop on, a truck's round (driving, stopping,
// its crew to the bins and back, one now and then across the street, driving on), the crew waiting for
// a gap to cross, the way round not clear while one of the crew is in the street (for the driven car,
// one it can see), traffic waiting behind and going round, the driven car's sensing and what models
// and the HUD are told, the audit of close passes, nothing at all with the option off, a free-drive
// soak, and the "Collection day" challenge with Rules and the cautious agent.
// node --experimental-default-type=module scripts/test_collection_trucks.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
globalThis.document = { querySelector: () => null };
const { MapData, pointAt, headingAt, projectPoint } = await import("../static/js/map/mapdata.js");
const { World } = await import("../static/js/sim/world.js");
const { NpcFleet, NpcPath } = await import("../static/js/sim/npc.js");
const { Vehicle, CAR, COLLECTION_TRUCK } = await import("../static/js/sim/vehicle.js");
const { StopMemory } = await import("../static/js/sim/signals.js");
const { stepWorld } = await import("../static/js/sim/step.js");
const { setWeather } = await import("../static/js/sim/weather.js");
const { rng } = await import("../static/js/common.js");
const { CREW_CLEAR_M, DWELL_S, TRUCK_MPS, TRUCK_NAME, TRUCK_WAIT_M, crewInRoad, isTruck, truckSites } = await import("../static/js/sim/collection-truck.js");
const { isVan, vanNotice, wayRound } = await import("../static/js/sim/double-parked.js");
const { QUIET } = await import("../static/js/sim/hidden-hazards.js");
const { DriveScore } = await import("../static/js/sim/drive-score.js");
const { DriveMetrics, failures } = await import("../static/js/bench/metrics.js");
const { buildSnapshot } = await import("../static/js/brain/sensors.js");
const { toJevState, situationClauses } = await import("../static/js/brain/state.js");
const { SYSTEM_PROMPT } = await import("../static/js/brain/llm-prompt.js");
const { CHALLENGES } = await import("../static/js/lab/challenges.js");
const { setupChallenge, evaluateChallenge } = await import("../static/js/lab/evaluation.js");
const { DriveRecorder } = await import("../static/js/lab/recorder.js");

let checks = 0;
async function test(name, fn) { await fn(); checks++; console.log(`✓ ${name}`); }
const root = new URL("../data/maps/", import.meta.url);
const load = (key) => {
  const pack = JSON.parse(fs.readFileSync(new URL(`${key}.v6.pack.json`, root)));
  for (const name of ["transit", "crossings", "zones", "rail", "calming", "scrambles", "buslanes", "restrictions"]) {
    const url = [2, 1].map(v => new URL(`${key}.${name}.v${v}.json`, root)).find(u => fs.existsSync(u));
    if (url) pack[name] = JSON.parse(fs.readFileSync(url));
  }
  pack.utc_offset = -7;
  return new MapData(pack);
};
const KITS = load("623b012bc8b5");
const step = (ctx) => stepWorld(ctx, 1 / 60, ctx.world.t * 1000);
const idle = { enabled: false, step() {} };
const CH = CHALLENGES.find((c) => c.id === "collection");
const { sites } = truckSites(KITS);
// The challenge's block of West 5th Avenue: a collection street with a parking lane.
const SITE = sites.find((s) => s.edge === "e228") || sites[0];
const E = KITS.edges.get(SITE.edge), LANE = KITS.lane(SITE.edge, 0);

function street({ collection = 1, seed = 4 } = {}) {
  setWeather("dry");
  const world = new World(KITS, { seed, parked: 0, pedestrians: 0 });
  const fleet = new NpcFleet(world, { count: 0, bikes: 0, seed: 5, collection });
  fleet.collection.target = 0;   // (no free-drive spawning: the tests put trucks down themselves)
  // (the car out of the way, on another street)
  world.placeOnLane(KITS.lane("e129", 0), 20);
  return { world, fleet, ctx: { world, fleet, autopilot: idle } };
}
// A truck standing at a stop with its rear `rear` along SITE's edge.
function standing(fleet, rear = SITE.lo + 5, cross = false) {
  const truck = fleet.collection.add(LANE, (rear + COLLECTION_TRUCK.rearOverhang) * LANE.length / E.length, 0, [], { path: new NpcPath(KITS, rng(3)) });
  truck.collect.stop = { edge: SITE.edge, rear };
  fleet.collection.arrive(truck, { cross });
  return truck;
}
function car(world, fleet, id, lane, s, v = 0) {
  const p = pointAt(lane.pts, lane.cum, s), c = new Vehicle(p[0], p[1], headingAt(lane.pts, lane.cum, s), v, CAR);
  Object.assign(c, { id, kind: "car", color: 0x777777, v0: lane.edgeRef.limit, driver: { aMax: 1.5, b: 2, s0: 2, T: 1.2, react: 0.6, lcRate: 0 },
    stopMem: new StopMemory(), path: new NpcPath(KITS, rng(8)), frozen: 0, waiting: 0 });
  c.path.start(lane.edge, lane.idx, s);
  fleet.vehicles.push(c);
  return c;
}

await test("trucks stop only on quiet two-way streets with one lane each way, with room for their length", () => {
  assert.ok(sites.length > 10, `${sites.length}`);
  for (const s of sites) {
    const e = KITS.edges.get(s.edge);
    assert.ok(QUIET.has(e.cls) && !e.oneway && e.lanes === 1, s.edge);
    assert.ok(s.hi > s.lo && s.hi + COLLECTION_TRUCK.length < e.length);
  }
  assert.ok(E.parking?.[1] > 0);
});

await test("a truck drives its round at its pace, stops, and stands as a double-parked record while its crew works", () => {
  const { world, fleet, ctx } = street();
  const truck = fleet.collection.add(LANE, (SITE.lo - 30) * LANE.length / E.length, TRUCK_MPS, [], { path: new NpcPath(KITS, rng(3)) });
  assert.ok(isTruck(truck) && !isVan(truck));
  let stood = null, top = 0;
  for (let i = 0; i < 60 * 60 && !stood; i++) {
    step(ctx);
    top = Math.max(top, truck.v);
    if (truck.collect.phase === "work") stood = truck.collect.record;
  }
  assert.ok(stood, "it stopped");
  assert.ok(top <= TRUCK_MPS + 0.3, `drove at ${top}`);
  assert.equal(stood.truck, true);
  assert.equal(stood.name, TRUCK_NAME);
  assert.equal(stood.van.id, truck.id);
  assert.ok(isVan(truck) && truck.hazards);
  assert.ok(Math.abs(stood.rear - stood.wait - TRUCK_WAIT_M) < 1e-6);
  assert.ok(world.doubleParked.vans.some((x) => x.id === stood.id));
  assert.ok(world.collectionSeen);
  assert.ok(stood.rear >= SITE.lo - 1 && stood.rear <= SITE.hi + 1, `${stood.rear}`);
  const crew = world.crowd.list.filter((p) => p.crew === stood.id);
  assert.ok(crew.length >= 1 && crew.every((p) => p.worker));
  // (the crew back on, it drives on; its record goes, and it stops again further on)
  let left = false, again = false;
  for (let i = 0; i < 60 * 90 && !again; i++) {
    step(ctx);
    if (!left && truck.collect.phase === "drive") { left = true; assert.equal(world.doubleParked.vans.some((x) => x.id === stood.id), false); assert.equal(isVan(truck), false); assert.equal(world.crowd.list.some((p) => p.crew === stood.id), false); }
    if (left && truck.collect.phase === "work") again = true;
  }
  assert.ok(left, "drove on");
  assert.ok(world.t > DWELL_S[0]);
});

await test("a worker crossing behind the truck waits for a gap in the oncoming lane, and is in the road while crossing", () => {
  const { world, fleet, ctx } = street();
  const truck = standing(fleet, SITE.lo + 5, true), d = truck.collect.record;
  const o = KITS.edges.get(d.opposite), ol = KITS.lane(o.id, 0);
  // (a car coming the other way, 2 s off)
  const s = (o.length - d.rear + 25) * ol.length / o.length;
  car(world, fleet, "oncoming", ol, Math.max(1, s - 22), 11);
  const crosser = world.crowd.list.find((p) => p.crew === d.id && p.path.some((w) => w.cross?.worker));
  assert.ok(crosser);
  let waitedFor = false, inRoad = false;
  for (let i = 0; i < 60 * 30; i++) {
    step(ctx);
    const near = fleet.vehicles.find((v) => v.id === "oncoming");
    if (!crosser.crossing && crosser.path[0]?.cross && near && Math.hypot(near.x - crosser.x, near.y - crosser.y) < 25) waitedFor = true;
    if (crosser.crossing && crewInRoad(world, d)?.id === crosser.id) inRoad = true;
  }
  assert.ok(waitedFor, "waited for the oncoming car");
  assert.ok(inRoad, "was in the road while crossing");
});

await test("the way round is not clear while a worker is in the street; the driven car counts only one it can see", () => {
  const { world, fleet } = street();
  const truck = standing(fleet, SITE.lo + 5, true), d = truck.collect.record;
  const crosser = world.crowd.list.find((p) => p.crew === d.id && p.path.some((w) => w.cross?.worker));
  // (put the worker out in the oncoming lane behind the truck)
  const [x, y] = pointAt(E.pts, E.cum, d.rear - 1);
  const h = headingAt(E.pts, E.cum, d.rear - 1), lat = -1.6;
  Object.assign(crosser, { x: x + Math.sin(h) * lat, y: y - Math.cos(h) * lat });
  assert.equal(crewInRoad(world, d)?.id, crosser.id);
  const way = wayRound(world, d, d.rear - 12, 0, []);
  assert.equal(way.clear, false);
  assert.equal(way.crew?.id, crosser.id);
  const sees = world.sees;
  world.sees = (obs, o) => (o === crosser ? false : sees.call(world, obs, o));
  assert.equal(crewInRoad(world, d, world.ego)?.id ?? null, null);
  world.sees = sees;
  // (at the far kerb, still to cross back, the way is not clear either; back on its step, it is)
  const far = [x + Math.sin(h) * (E.asphalt[0] - 0.4), y - Math.cos(h) * (E.asphalt[0] - 0.4)];
  Object.assign(crosser, { x: far[0], y: far[1], crossing: null });
  assert.equal(crewInRoad(world, d)?.id, crosser.id);
  const stepAt = crosser.path.at(-1).p;
  Object.assign(crosser, { x: stepAt[0], y: stepAt[1], path: [] });
  assert.equal(crewInRoad(world, d)?.id ?? null, null);
  assert.equal(wayRound(world, d, d.rear - 12, 0, []).clear, true);
});

await test("traffic waits well back of a working truck while its crew is out, then goes round once clear", () => {
  const { world, fleet, ctx } = street();
  const truck = standing(fleet, SITE.lo + 10, true), d = truck.collect.record;
  truck.collect.held = true;
  const follower = car(world, fleet, "follower", LANE, Math.max(1, (d.rear - 45) * LANE.length / E.length), 8);
  let minGap = Infinity, roundWithCrew = false, round = false;
  for (let i = 0; i < 60 * 45; i++) {
    step(ctx);
    const q = projectPoint(E.pts, E.cum, [follower.x, follower.y], null);
    if (!q) continue;
    const front = q.s + CAR.length - CAR.rearOverhang;
    if (follower.v < 0.3 && q.lateral > 0.5 && front < d.rear) minGap = Math.min(minGap, d.rear - front);
    if (q.lateral < 0 && front > d.rear - 5 && front < d.front) { round = true; if (crewInRoad(world, d)) roundWithCrew = true; }
  }
  assert.ok(minGap > TRUCK_WAIT_M - 1 && minGap < 30, `waited ${minGap} m back`);
  assert.ok(round, "went round");
  assert.equal(roundWithCrew, false);
});

await test("the car senses the truck, waits for its crew, and models and the HUD are told so", () => {
  const ctx = setupChallenge(KITS, CH);
  ctx.autopilot.setEnabled(false);
  const { world, fleet } = ctx, truck = fleet.vehicles.find((v) => v.id === world.challenge.truckId), d = truck.collect.record;
  for (const p of world.crowd.list) if (p.crew) p.held = false;
  const crosser = world.crowd.list.find((p) => p.crew === d.id && p.path.some((w) => w.cross?.worker));
  const [x, y] = pointAt(E.pts, E.cum, d.rear - 1), h = headingAt(E.pts, E.cum, d.rear - 1);
  Object.assign(crosser, { x: x + Math.sin(h) * -1.6, y: y - Math.cos(h) * -1.6, path: [{ p: [crosser.x, crosser.y] }] });
  world.placeOnLane(LANE, (d.rear - 25) * LANE.length / E.length);
  const snap = buildSnapshot(world, null), dp = snap.double_parked;
  assert.ok(dp);
  assert.equal(dp.kind, TRUCK_NAME);
  assert.equal(dp.truck, true);
  assert.equal(dp.crew_in_road, crosser.id);
  assert.equal(dp.wait, true);
  const state = toJevState(snap, [], {});
  assert.equal(state.double_parked.truck, true);
  assert.equal(state.double_parked.way_round, "its crew is in the road");
  assert.ok(situationClauses(snap).some((c) => /garbage truck .* its crew empties the bins.* one of its crew, is out in the street/.test(c)));
  assert.match(SYSTEM_PROMPT, /garbage truck/);
  assert.equal(vanNotice(world)?.text, "GARBAGE TRUCK · CREW IN THE ROAD · WAIT BEHIND IT");
});

await test("passing a worker in the street within 1.5 m at speed counts once, in the metrics and the coaching, and fails the drive", () => {
  for (const collected of [true, false]) {
    const { world, fleet, ctx } = street();
    const score = new DriveScore(world, { title: "t" }), metrics = new DriveMetrics(100);
    let worker = null;
    if (collected) {
      const truck = standing(fleet, SITE.lo + 5, false);
      truck.collect.held = true;
      worker = world.crowd.list.find((p) => p.crew);
      worker.held = true;
    }
    // (the car drives along the oncoming lane past where the worker stands, a metre from them)
    const o = KITS.edges.get(E.id === SITE.edge ? truckSites(KITS).byEdge.get(SITE.edge).opposite : E.id), ol = KITS.lane(o.id, 0);
    let s = 60;
    if (worker) { const q = projectPoint(ol.pts, ol.cum, [worker.x, worker.y], null), h = headingAt(ol.pts, ol.cum, q.s); Object.assign(worker, { x: q.point[0] - Math.sin(h) * 2.0, y: q.point[1] + Math.cos(h) * 2.0 }); s = q.s - 30; }
    world.placeOnLane(ol, s);
    for (let i = 0; i < 60 * 12; i++) {
      s += 5.5 / 60;
      if (s > ol.length - 2) break;
      const p = pointAt(ol.pts, ol.cum, s);
      Object.assign(world.ego, { x: p[0], y: p[1], psi: headingAt(ol.pts, ol.cum, s), v: 5.5 });
      const road = step(ctx);
      score.record(world, road, 1 / 60); metrics.record(world, null, road, 1 / 60);
    }
    const sum = metrics.summary(world, { totals: { decisions: 0, calls: 0, tokens: 0, cost: 0 } }, true), report = score.snapshot();
    if (collected) {
      assert.equal(world.violations.crew_close_passes, 1);
      assert.equal(sum.crew_close_passes, 1);
      assert.ok(failures(sum).includes("passed a garbage crew worker too close"));
      assert.equal(report.crew_close_passes, 1);
      assert.ok(report.tips.some((t) => /garbage truck at work/.test(t)));
    } else {
      assert.equal("crew_close_passes" in sum, false);
      assert.equal("crew_close_passes" in report, false);
    }
  }
  assert.ok(CREW_CLEAR_M === 1.5);
});

await test("with collection off there are no trucks and no crew, and nothing is reported", () => {
  const { world, fleet, ctx } = street({ collection: 0 });
  for (let i = 0; i < 60 * 20; i++) step(ctx);
  assert.equal(fleet.collection.trucks.length, 0);
  assert.equal(fleet.vehicles.some(isTruck), false);
  assert.equal(world.crowd.list.some((p) => p.crew), false);
  assert.equal(world.collectionSeen, false);
});

await test("in a free drive a truck turns up out of sight by day, works its round and nobody is knocked down", () => {
  setWeather("dry");
  const world = new World(KITS, { seed: 5 });
  world.visibility.setNight(0);
  const fleet = new NpcFleet(world, { count: 30, seed: 11, collection: 1 }), ctx = { world, fleet, autopilot: idle };
  let stops = 0, phase = null, seenAtStart = false;
  for (let i = 0; i < 60 * 60 * 4; i++) {
    step(ctx);
    const t = fleet.collection.trucks[0];
    if (t && i < 5 && world.visibility.canSee(world.ego, t.x, t.y)) seenAtStart = true;
    if (t && t.collect.phase === "work" && phase !== "work") stops++;
    phase = t?.collect.phase ?? null;
    assert.equal(world.crowd.list.some((p) => p.crew && p.frozen > 0), false);
  }
  assert.equal(seenAtStart, false);
  assert.ok(fleet.collection.made >= 1);
  assert.ok(stops >= 1, `${stops} stops`);
  // (and at night, none turns up)
  const dark = new World(KITS, { seed: 5 });
  dark.visibility.setNight(1);
  const df = new NpcFleet(dark, { count: 0, bikes: 0, seed: 11, collection: 1 });
  for (let i = 0; i < 60 * 30; i++) step({ world: dark, fleet: df, autopilot: idle });
  assert.equal(df.collection.made, 0);
});

await test("a replay restored before a truck's first stop collects into the live world, and its trucks take the same turns", () => {
  const { world, fleet, ctx } = street();
  const autopilot = { enabled: false, step() {}, brains: null, onDecision: null, onEvent: null, totals: { cost: 0, tokens: 0, calls: 0 }, epoch: 0, bumpEpoch() { this.epoch++; } };
  const recorder = new DriveRecorder({ seconds: 30 }), context = () => ({ world, fleet, autopilot, drive: null, clock: {} });
  const truck = fleet.collection.add(LANE, (SITE.lo - 30) * LANE.length / E.length, TRUCK_MPS, [], { path: new NpcPath(KITS, rng(3)) });
  recorder.record(context(), true);
  // (a truck put down from the trucks' own stream: the turns it picks)
  const turns = () => { const t = fleet.collection.add(KITS.lane("e129", 0), 30); t.path.extend(); const ids = t.path.edges.map((e) => e.id).join(","); fleet.collection.remove(t); return ids; };
  const before = turns();
  for (let i = 0; i < 60 * 5; i++) step(ctx);
  recorder.restore(0, { world, fleet, autopilot, clock: {}, setDrive() {} });
  world.paused = false;
  assert.equal(fleet.collection.world === world && fleet.collection.fleet === fleet, true);
  assert.equal(turns(), before);
  const live = fleet.vehicles.find((v) => v.id === truck.id);
  for (let i = 0; i < 60 * 60 && live.collect.phase !== "work"; i++) step(ctx);
  assert.equal(live.collect.phase, "work");
  assert.equal(world.collectionSeen, true);
  assert.ok(world.doubleParked.vans.some((d) => d.van.id === live.id));
});

await test("a truck is never retired to make room for a car pulling out, nor sent to park at the kerb", () => {
  setWeather("dry");
  const world = new World(KITS, { seed: 4, pedestrians: 0 });
  const fleet = new NpcFleet(world, { count: 0, bikes: 0, seed: 5, collection: 1 });
  fleet.collection.target = 0;
  world.placeOnLane(KITS.lane("e129", 0), 20);
  const truck = standing(fleet, SITE.lo + 5);
  // (a car pulls out far from the truck: with no other traffic, the truck is the only one it could replace)
  const car = world.parked.list.filter((c) => !c.stay && Math.hypot(c.x - truck.x, c.y - truck.y) > 40).find((c) => fleet.startPullOut(c));
  assert.ok(car, "a car pulled out");
  assert.equal(fleet.vehicles.some((v) => v.id === truck.id), true);
  // (driving on along a street with free kerb space ahead, it is never sent to park)
  fleet.collection.add(LANE, 5, TRUCK_MPS, [], { path: new NpcPath(KITS, rng(3)) });
  for (const c of [...world.parked.list]) if ((c.edge === SITE.edge || c.edge === SITE.opposite) && !c.stay) world.parked.remove(c);
  for (let i = 0; i < 20; i++) fleet.maybePark();
  assert.equal(fleet.collection.trucks.some((t) => t.parking), false);
});

await test("Collection day: Rules and the cautious agent wait for the crew and the oncoming cars, then go round slowly", async () => {
  assert.ok(CH);
  for (const brain of ["rules", "cautious"]) {
    const r = await evaluateChallenge(KITS, CH, { brain });
    assert.equal(r.pass, true, `${brain}: ${r.failures}`);
    assert.equal(r.crew_close_passes, 0);
    assert.equal(r.failed_to_yield, 0);
    assert.equal(r.collisions, 0);
    assert.ok(r.stopped_s > 3, `${brain} waited ${r.stopped_s} s`);
  }
});

console.log(`${checks} checks passed`);
process.exit(0);
