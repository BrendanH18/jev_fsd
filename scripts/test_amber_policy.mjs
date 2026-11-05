// Node 22: node --experimental-default-type=module scripts/test_amber_policy.mjs
import assert from "node:assert/strict";
globalThis.document = { querySelector: () => null };
const { MapData, joinLanes, cumulative, pointAt } = await import("../static/js/map/mapdata.js");
const { Route } = await import("../static/js/map/route.js");
const { Vehicle, CAR } = await import("../static/js/sim/vehicle.js");
const { World } = await import("../static/js/sim/world.js");
const { setWeather } = await import("../static/js/sim/weather.js");
const { amberStoppingDistance, observeAmber } = await import("../static/js/sim/amber.js");
const { buildSnapshot } = await import("../static/js/brain/sensors.js");
const { sampleCandidates, simulateAll } = await import("../static/js/brain/candidates.js");
const { toJevState, situationClauses } = await import("../static/js/brain/state.js");
const { RulesBrain } = await import("../static/js/brain/rules.js");
const { CautiousAgent } = await import("../static/js/agents/cautious.js");
const { routeFromLanes } = await import("../static/js/demo/routing.js");
const { DriveScore } = await import("../static/js/sim/drive-score.js");
const { DriveMetrics, failures } = await import("../static/js/bench/metrics.js");
const { cloneState, DriveRecorder } = await import("../static/js/lab/recorder.js");
const { NpcFleet, NpcPath } = await import("../static/js/sim/npc.js");
const { StopMemory } = await import("../static/js/sim/signals.js");
const { stepWorld } = await import("../static/js/sim/step.js");
const ARM = 150, LINE = 142, FRONT = CAR.length - CAR.rearOverhang;
const nodes = [{ id: "w", x: -ARM, y: 0 }, { id: "c", x: 0, y: 0 }, { id: "e", x: ARM, y: 0 }, { id: "n", x: 0, y: ARM }, { id: "s", x: 0, y: -ARM }];
const edges = [], lanes = [];
for (const arm of ["w", "e", "n", "s"]) for (const inbound of [true, false]) {
  const from = inbound ? arm : "c", to = inbound ? "c" : arm, a = nodes.find(n => n.id === from), b = nodes.find(n => n.id === to);
  const id = `${arm}_${inbound ? "in" : "out"}`, pts = [[a.x, a.y], [b.x, b.y]], rx = (b.y - a.y) / ARM, ry = -(b.x - a.x) / ARM;
  edges.push({ id, from, to, pts, length: ARM, lanes: 1, lane_width: 3.2, lane_offsets: [1.6], asphalt: [-3.2, 3.2], parking: [0, 0], cls: "secondary", limit: 13.9, oneway: false, name: `${arm} Street`, ...(inbound ? { control: { type: "signal", id: "sig", s_line: LINE, group: ["w", "e"].includes(arm) ? "A" : "B" } } : {}) });
  lanes.push({ edge: id, idx: 0, pts: pts.map(([x, y]) => [x + rx * 1.6, y + ry * 1.6]) });
}
const map = new MapData({ bbox: [0, 0, 1, 1], extent: [-170, -170, 170, 170], edges, lanes, nodes, buildings: [], stops: [],
  intersections: [{ id: "sig", x: 0, y: 0, offset_s: 0, vertices: ["c"], approaches: edges.filter(e => e.control).map(e => ({ edge: e.id, group: e.control.group, s_line: LINE })) }] });
const inter = map.intersections.get("sig"), yellowAt = inter.plan.A.green + 0.01;
const pts = joinLanes(map.lane("w_in", 0).pts, map.lane("e_out", 0).pts), cum = cumulative(pts), polyline = [];
for (let s = 0; s < cum.at(-1); s++) polyline.push(pointAt(pts, cum, s));
polyline.push(pts.at(-1));
function setup(distance, speed = 10, { weather = "dry", enabled = true, route = true } = {}) {
  const world = new World(map, { parked: 0, pedestrians: 0, amberLights: enabled, weather });
  Object.assign(world.ego, { x: -8 - FRONT - distance, y: -1.6, psi: 0, v: speed });
  world.t = yellowAt;
  world.route = route ? new Route({ id: "straight", polyline, edges: ["w_in", "e_out"], turns: [], start_s: 0, goal_s: 290 }, map) : null;
  world.destination = world.route?.endPoint();
  return world;
}
function decide(world) {
  const snap = buildSnapshot(world), candidates = sampleCandidates(snap, world), result = simulateAll(candidates, snap, world);
  return { snap, candidates, ...result, choice: new RulesBrain().decideSync(snap, result.eligible) };
}
let checks = 0;
async function test(name, fn) { await fn(); checks++; console.log(`✓ ${name}`); }

await test("safe stopping distance includes reaction, actuator delay and grip", () => {
  const vehicle = new Vehicle(0, 0, 0, 10);
  setWeather("dry"); const dry = amberStoppingDistance(vehicle);
  setWeather("snow"); const snow = amberStoppingDistance(vehicle);
  assert.equal(dry > 26 && dry < 28, true);
  assert.equal(snow > 60, true);
  assert.equal(snow > dry * 2, true);
  const dryWorld = setup(28), dryChoice = buildSnapshot(dryWorld).intersection.amber;
  const snowWorld = setup(28, 10, { weather: "snow" }), snowChoice = buildSnapshot(snowWorld).intersection.amber;
  assert.equal(dryChoice.stop, true); assert.equal(snowChoice.stop, false);
});
await test("amber decisions stay latched through braking and reset for a new phase", () => {
  const w = setup(50), first = buildSnapshot(w).intersection.amber;
  w.ego.x = -8 - FRONT - 2; w.ego.v = 1;
  const later = buildSnapshot(w).intersection.amber;
  assert.equal(later.stop, true); assert.equal(later.distance_m, first.distance_m);
  assert.equal(cloneState(w.ego).amberChoices.get("w_in:sig").stop, true);
  observeAmber(w.ego, "w_in:sig", "green", 2, inter, "green", 0);
  const next = observeAmber(w.ego, "w_in:sig", "yellow", 0.5, inter, "yellow", yellowAt + inter.plan.cycle);
  assert.equal(next.stop, false);
});
await test("Rules and candidates stop when safe, and permit clearing without speeding up when too close", () => {
  const stop = decide(setup(50));
  assert.equal(stop.snap.intersection.amber.stop, true); assert.equal(stop.mustStop, true);
  assert.equal(stop.eligible.some(c => c.sim.crosses_stop_line), false);
  assert.equal(situationClauses(stop.snap).some(s => s.includes("safe stop was possible")), true);
  const go = decide(setup(10));
  assert.equal(go.snap.intersection.amber.stop, false); assert.equal(go.mustStop, false);
  assert.equal(go.eligible.some(c => c.sim.progress_m > 15), true);
  assert.equal(go.choice.motion, "drive");
  assert.equal(go.candidates.every(c => c.law.vTarget == null || c.law.vTarget <= 10), true);
  const state = toJevState(go.snap, go.eligible, {});
  assert.equal(state.intersection.amber.stop, false);
  assert.equal(situationClauses(go.snap).some(s => s.includes("without speeding up")), true);
});
await test("audit independently catches a missed safe amber stop, once, even without a route", () => {
  for (const route of [true, false]) {
    const w = setup(50, 10, { route }), score = new DriveScore(w), metrics = new DriveMetrics(200);
    w.audit(1 / 60, w.roadInfo());
    assert.equal(w.amberLightsSeen, true);
    w.ego.x = -8 - FRONT + 0.2; w.audit(1 / 60, w.roadInfo());
    assert.equal(w.violations.amber_lights_run, 1);
    assert.equal(w.violations.red_lights_run, 0);
    score.record(w, w.roadInfo(), 1 / 60);
    assert.equal(score.snapshot().amber_lights_run, 1);
    assert.equal(score.snapshot().categories.legality, 75);
    assert.equal(score.snapshot().tips.some(s => s.includes("amber")), true);
    const summary = metrics.summary(w, { totals: { decisions: 0, calls: 0, tokens: 0, cost: 0 } }, true);
    assert.equal(summary.amber_lights_run, 1);
    assert.equal(failures(summary).includes("failed to stop safely for amber"), true);
    w.audit(1 / 60, w.roadInfo()); assert.equal(w.violations.amber_lights_run, 1);
    const recorder = new DriveRecorder(); recorder.mark(w.t, "amber_light"); assert.equal(recorder.markers.length, 1);
  }
});
await test("a too-close driver can clear amber, but speeding up or entering on red still fails", () => {
  for (const [speed, red, amberFails, redFails] of [[10, false, 0, 0], [11, false, 1, 0], [10, true, 0, 1]]) {
    const w = setup(10); w.audit(1 / 60, w.roadInfo());
    w.ego.x = -8 - FRONT + 0.2; w.ego.v = speed;
    if (red) w.t = inter.plan.A.green + inter.plan.A.yellow + 0.01;
    w.audit(1 / 60, w.roadInfo());
    assert.equal(w.violations.amber_lights_run || 0, amberFails);
    assert.equal(w.violations.red_lights_run, redFails);
  }
});
await test("slowing again at the line does not pardon accelerating to beat amber", () => {
  const w = setup(10); w.audit(1 / 60, w.roadInfo());
  w.ego.x += 2; w.ego.v = 11; w.audit(1 / 60, w.roadInfo());
  w.ego.x = -8 - FRONT + 0.2; w.ego.v = 10; w.audit(1 / 60, w.roadInfo());
  assert.equal(w.violations.amber_lights_run, 1);
  assert.equal(w.events.some(e => e.type === "amber_light" && e.reason === "sped_up"), true);
});
await test("unseen signals remain unknown, and disabled worlds retain their sensing and metrics", () => {
  const w = setup(50); w.visibility.canSee = () => false;
  const snap = buildSnapshot(w);
  assert.equal(snap.intersection.signal, "unknown"); assert.equal(snap.intersection.amber, null);
  const off = setup(50, 10, { enabled: false });
  assert.equal("amber" in buildSnapshot(off).intersection, false);
  off.audit(1 / 60, off.roadInfo()); off.ego.x = -8 - FRONT + 0.2; off.audit(1 / 60, off.roadInfo());
  assert.equal(off.amberLightsSeen, false); assert.equal(off.ego.amberChoices, undefined);
  const result = new DriveMetrics(200).summary(off, { totals: { decisions: 0, calls: 0, tokens: 0, cost: 0 } }, true);
  assert.equal("amber_lights_run" in result, false);
});
await test("a driver already across the line clears the junction when red follows", () => {
  const w = setup(10); w.audit(1 / 60, w.roadInfo());
  w.ego.x = -8 - FRONT + 0.2; w.audit(1 / 60, w.roadInfo());
  w.t = inter.plan.A.green + inter.plan.A.yellow + 0.01;
  const d = decide(w);
  assert.equal(d.snap.intersection.entered, true);
  assert.equal(d.mustStop, false);
  assert.equal(d.snap.target.v > 5, true);
  assert.equal(d.choice.motion, "drive");
  assert.equal(w.violations.red_lights_run, 0);
});
await test("red profiles survive the following red across a cycle boundary, then expire before a later visit", () => {
  const w = setup(50); buildSnapshot(w);
  w.t = inter.plan.A.green + inter.plan.A.yellow + 0.01;
  assert.equal(buildSnapshot(w).intersection.amber.stop, true);
  w.t += inter.plan.cycle;
  assert.equal(buildSnapshot(w).intersection.amber, null, "a later red is not the observed amber's red");
  const vehicle = new Vehicle(0, 0, 0, 10), b = inter.plan.B;
  const observed = observeAmber(vehicle, "b:sig", "yellow", 50, inter, "yellow", b.start + b.green + 0.01);
  assert.equal(observeAmber(vehicle, "b:sig", "red", 20, inter, "red", inter.plan.cycle + 0.01).stop, observed.stop,
    "B's following red spans the global cycle boundary");
  assert.equal(observeAmber(vehicle, "b:sig", "red", 50, inter, "red", inter.plan.cycle * 2 + 0.01), null);
  const original = inter.plan.advance;
  inter.plan.advance = { edge: "w_in", group: "A", length: 8, clear: 4, style: "arrow" };
  try {
    const car = new Vehicle(0, 0, 0, 10);
    observeAmber(car, "w_in:sig:arrow", "yellow", 50, inter, "arrow_yellow", 8.01);
    assert.equal(observeAmber(car, "w_in:sig:arrow", "red", 20, inter, "red", 11.01).stop, true);
    assert.equal(observeAmber(car, "w_in:sig:arrow", "red", 50, inter, "red", inter.plan.A.green + inter.plan.A.yellow + 0.01), null,
      "a later solid-red visit must not reuse an earlier amber arrow");
  } finally { if (original) inter.plan.advance = original; else delete inter.plan.advance; }
});
await test("ordinary NPCs share the latched stop decision and clearing speed ceiling", () => {
  for (const distance of [50, 10]) {
    const w = setup(distance), fleet = new NpcFleet(w, { count: 0, bikes: 0 });
    const n = new Vehicle(w.ego.x, w.ego.y, w.ego.psi, 10);
    w.ego.x = w.ego.y = 1e5; w.route = null;
    Object.assign(n, { id: "amber_test", v0: 13.9, side: 0, color: 0, stopMem: new StopMemory(), path: new NpcPath(map, fleet.random), frozen: 0, waiting: 0 });
    n.path.start("w_in", 0, LINE - FRONT - distance, [["e_out", 0]]); fleet.vehicles.push(n);
    let observed = false, crossed = false, fastest = 0;
    for (let k = 0; k < 180; k++) {
      stepWorld({ world: w, fleet, autopilot: { enabled: false } }, 1 / 60, w.t * 1000);
      const choice = n.amberChoices?.get("w_in:sig");
      if (choice) {
        observed = true; assert.equal(choice.stop, distance === 50);
        if (n.path.s - n.spec.rearOverhang <= ARM + map.crossingHalfWidth("w_in")) fastest = Math.max(fastest, n.v);
      }
      if (n.path.s + FRONT >= LINE) crossed = true;
    }
    assert.equal(observed, true);
    assert.equal(crossed, distance === 10);
    if (distance === 10) assert.equal(fastest <= 10.5, true);
  }
});
await test("an amber permission never overrides a stopped vehicle ahead", () => {
  const w = setup(10);
  const obstacle = new Vehicle(w.ego.x + 7, w.ego.y, 0, 0); obstacle.id = "blocked";
  w.npcs = [obstacle];
  const d = decide(w);
  assert.equal(d.snap.intersection.amber.stop, false);
  assert.equal(d.snap.target.v < 2, true);
  assert.equal(d.eligible.some(c => c.sim.progress_m > 10 && c.law.kind !== "hard_brake"), false);
});
await test("stationary NPCs at the line wait safely; those already inside can clear without NaN", () => {
  for (const distance of [0.1, -0.5]) {
    const w = setup(distance, 0), fleet = new NpcFleet(w, { count: 0, bikes: 0 });
    const n = new Vehicle(w.ego.x, w.ego.y, w.ego.psi, 0);
    w.ego.x = w.ego.y = 1e5; w.route = null;
    Object.assign(n, { id: "stationary_amber", v0: 13.9, side: 0, stopMem: new StopMemory(), path: new NpcPath(map, fleet.random), frozen: 0, waiting: 0 });
    n.path.start("w_in", 0, LINE - FRONT - distance, [["e_out", 0]]); fleet.vehicles.push(n);
    for (let k = 0; k < 60; k++) {
      stepWorld({ world: w, fleet, autopilot: { enabled: false } }, 1 / 60, w.t * 1000);
      assert.equal(Number.isFinite(n.x) && Number.isFinite(n.y) && Number.isFinite(n.v), true);
    }
    if (distance > 0) assert.equal(n.v < 0.2, true);
    else assert.equal(n.v > 0.2, true);
  }
});
await test("manual amber-arrow entries are judged by the actual exit", () => {
  const original = inter.plan.advance;
  inter.plan.advance = { edge: "w_in", group: "A", length: 8, clear: 4, style: "arrow" };
  try {
    for (const route of [false, true]) for (const [distance, speed, exit, amberFails, redFails] of [[50, 10, Math.PI / 2, 1, 0], [10, 10, Math.PI / 2, 0, 0], [50, 10, 0, 0, 1]]) {
      const w = setup(distance, speed, { route }); w.t = 8.01;
      if (route) buildSnapshot(w); // manual takeover retains navigation and HUD sensing
      w.audit(1 / 60, w.roadInfo());
      assert.equal(w.amberLightsSeen, true);
      w.ego.x = -8 - FRONT + 0.2; w.audit(1 / 60, w.roadInfo());
      assert.equal(w.violations.amber_lights_run || 0, 0, "wait for the actual exit");
      w.ego.x = -2; w.auditArrow();
      w.ego.x = 20 * Math.cos(exit); w.ego.y = 20 * Math.sin(exit); w.ego.psi = exit; w.auditArrow();
      assert.equal(w.violations.amber_lights_run || 0, amberFails);
      assert.equal(w.violations.red_lights_run, redFails);
    }
  } finally { if (original) inter.plan.advance = original; else delete inter.plan.advance; }
});
await test("a completed amber stop permits an otherwise legal turn on the following red", () => {
  const w = setup(50);
  w.route = new Route(routeFromLanes(map, [map.lane("w_in", 0), map.lane("s_out", 0)], 0, 100), map);
  assert.equal(buildSnapshot(w).intersection.amber.stop, true);
  w.ego.x = -8 - FRONT - 0.5; w.ego.v = 0;
  w.t = inter.plan.A.green + inter.plan.A.yellow + 0.01;
  w.egoStop.update({ type: "signal", id: "sig" }, 0.5, 0, 1);
  const d = decide(w);
  assert.equal(d.snap.intersection.right_on_red.go, true);
  assert.equal(d.snap.intersection.amber.stop, true, "keep the observation for replay and audit");
  for (const field of ["right_on_red", "left_on_red"]) {
    const permission = d.snap.intersection.right_on_red;
    const i = { ...d.snap.intersection, right_on_red: null, [field]: permission };
    for (const driver of [new RulesBrain(), new CautiousAgent()]) {
      const choice = driver.decideSync({ ...d.snap, intersection: i }, d.eligible);
      assert.equal(choice.motion, "drive");
      assert.equal(choice.candidateId !== "stop_at_line", true);
      assert.equal(d.eligible.find(c => c.id === choice.candidateId).sim.progress_m > 1, true);
    }
  }
});
console.log(`${checks} amber policy checks passed`);
process.exit(0);
