// Hidden hazards (sim/hidden-hazards.js): cars parked at the kerb hide the people behind them, the
// blind-spot speed and where it holds, the driven car's sensing and target speed, what models are told,
// coaching, the HUD, free-drive step-outs, and the "Between the cars" challenge, where keeping to the
// blind-spot speed is what lets the car stop for the child who steps out. With hazards off (the default,
// the seeded benchmark and every other challenge) nothing changes.
// node --experimental-default-type=module scripts/test_hidden_hazards.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
globalThis.document = { querySelector: () => null };
const { MapData } = await import("../static/js/map/mapdata.js");
const { Route } = await import("../static/js/map/route.js");
const { World } = await import("../static/js/sim/world.js");
const { NpcFleet } = await import("../static/js/sim/npc.js");
const { Vehicle, CAR, comfort } = await import("../static/js/sim/vehicle.js");
const { Pedestrian } = await import("../static/js/sim/pedestrians.js");
const { stepWorld } = await import("../static/js/sim/step.js");
const { setWeather } = await import("../static/js/sim/weather.js");
const H = await import("../static/js/sim/hidden-hazards.js");
const { DriveScore } = await import("../static/js/sim/drive-score.js");
const { buildSnapshot, hazardFlags } = await import("../static/js/brain/sensors.js");
const { toJevState, situationClauses } = await import("../static/js/brain/state.js");
const { SYSTEM_PROMPT } = await import("../static/js/brain/llm-prompt.js");
const { Autopilot } = await import("../static/js/brain/brain.js");
const { CHALLENGES, challengeScenario } = await import("../static/js/lab/challenges.js");
const { setupChallenge, evaluateChallenge } = await import("../static/js/lab/evaluation.js");
const { setupScenario } = await import("../static/js/bench/runner.js");
const { DriveRecorder } = await import("../static/js/lab/recorder.js");

let checks = 0;
async function test(name, fn) { await fn(); checks++; console.log(`✓ ${name}`); }
const root = new URL("../data/maps/", import.meta.url);
const load = (key) => {
  const pack = JSON.parse(fs.readFileSync(new URL(`${key}.v6.pack.json`, root)));
  for (const name of ["transit", "crossings", "zones", "rail"]) {
    const url = new URL(`${key}.${name}.v1.json`, root);
    if (fs.existsSync(url)) pack[name] = JSON.parse(fs.readFileSync(url));
  }
  return new MapData(pack);
};
const KITS = load("623b012bc8b5");
const DT = 1 / 60;
const FRONT = CAR.length - CAR.rearOverhang;

// A straight quiet two-way street, 300 m long, one lane each way and a parking lane on each side; the
// car drives east along y = -1.75, the right kerb's parked cars stand at y = -4.65.
function street(cls = "residential") {
  const s = { lanes: 1, lane_width: 3.5, width: 11.8, lane_offsets: [1.75], asphalt: [-5.9, 5.9], parking: [2.4, 2.4], cls, limit: 13.9, oneway: false, name: "Test Street" };
  return new MapData({ bbox: [0, 0, 1, 1], extent: [-20, -40, 320, 40],
    edges: [{ id: "in", from: "a", to: "b", pts: [[0, 0], [300, 0]], length: 300, ...s }, { id: "out", from: "b", to: "a", pts: [[300, 0], [0, 0]], length: 300, ...s }],
    lanes: [{ edge: "in", idx: 0, pts: [[0, -1.75], [300, -1.75]] }, { edge: "out", idx: 0, pts: [[300, 1.75], [0, 1.75]] }],
    nodes: [{ id: "a", x: 0, y: 0 }, { id: "b", x: 300, y: 0 }], intersections: [], stops: [], buildings: [] });
}
// Cars parked along the right kerb with rears at `rears`, a person between the two either side of `at`
// (0.6 m in from their traffic side), and the car at `x` doing `v`, on a route along the street.
function scene({ hazards = true, cls = "residential", rears = [60, 66.1, 72.2, 78.3, 84.4, 90.5, 96.6], at = 83.6, x = 20, v = 0, weather = "dry" } = {}) {
  setWeather(weather);
  const map = street(cls);
  const world = new World(map, { parked: 0, pedestrians: 0, hazards });
  rears.forEach((rear, i) => { const c = new Vehicle(rear + CAR.rearOverhang, -4.65, 0, 0); Object.assign(c, { id: `p${i}`, edge: "in", curb: "right" }); world.parked.add(c); });
  const outer = -4.65 + CAR.width / 2;
  const ped = new Pedestrian({ id: "hidden", x: at, y: outer - 0.6, psi: Math.PI / 2, v: 0, speed: 1.5, path: [], crossing: null, waiting: 0, phase: 0, look: 1, at: null, held: true });
  world.crowd.list.push(ped);
  Object.assign(world.ego, { x, y: -1.75, psi: 0, v });
  const pts = [];
  for (let px = 0; px <= 290; px += 2) pts.push([px, -1.75]);
  world.route = new Route({ id: "r", polyline: pts, edges: ["in"], turns: [], start_s: 0, goal_s: 290 }, map);
  world.route.project(world.ego.x, world.ego.y);
  world._road = world.roadInfo();
  return { world, ped, map };
}

await test("the blind-spot speed stops the car within the step-out distance, braking firmly, and follows the grip", () => {
  const speeds = {};
  for (const w of ["dry", "rain", "snow"]) {
    setWeather(w);
    const v = H.blindSpeed(), a = H.BLIND_BRAKE * comfort().hardDecel;
    assert.ok(Math.abs(v * H.BLIND_REACT_S + v * v / (2 * a) - (H.STEP_OUT_M - H.BLIND_MARGIN_M)) < 1e-9, w);
    speeds[w] = Math.round(v * 3.6);
  }
  setWeather("dry");
  assert.deepEqual(speeds, { dry: 32, rain: 27, snow: 19 });
  // at the blind-spot speed from STEP_OUT_M + BLIND_LEAD_M short of the first car, and gently down to it
  // before that
  const v = H.blindSpeed();
  assert.equal(H.blindApproach(v, H.STEP_OUT_M + H.BLIND_LEAD_M), v);
  assert.equal(H.blindApproach(v, 0), v);
  assert.ok(H.blindApproach(v, 60) > v + 3);
});

await test("with hidden hazards on, parked cars hide someone standing between them until they step out; off, they do not", () => {
  const on = scene(), off = scene({ hazards: false });
  assert.equal(on.world.sees(on.world.ego, on.ped), false);
  assert.equal(off.world.sees(off.world.ego, off.ped), true);
  // stepping out past the cars' traffic side, they are seen
  on.ped.y += 0.95;
  assert.equal(on.world.sees(on.world.ego, on.ped), true);
  // and alongside the gap, close up, the car sees into it
  on.ped.y -= 0.95;
  on.world.ego.x = on.ped.x - FRONT + 0.5;
  assert.equal(on.world.sees(on.world.ego, on.ped), true);
  // the hidden person is not in what the car's sensing observes
  const { world, ped } = scene();
  assert.ok(!buildSnapshot(world).observed.includes(ped));
});

await test("a blind spot: parked cars beside the car's way on a quiet street, with the speed to keep to; not on a main road, nor with hazards off", () => {
  const { world } = scene({ x: 10 });
  const bs = H.blindSpot(world);
  assert.equal(bs.side, "right");
  assert.equal(bs.why, "quiet street");
  assert.equal(bs.first, "p0");
  assert.equal(bs.edge, "in");
  assert.ok(Math.abs(bs.from_m - (60 - 10 - FRONT)) < 0.01, `${bs.from_m}`);
  assert.ok(Math.abs(bs.gap_m - 1) < 1e-6, `${bs.gap_m}`);
  assert.equal(bs.cars, 3);   // (those within BLIND_LOOK_M of its front)
  assert.equal(bs.limit_mps, H.blindSpeed());
  // beyond the look-ahead, or once past the last of them, nothing
  assert.equal(H.blindSpot(scene({ x: -60 }).world), null);
  assert.equal(H.blindSpot(scene({ x: 110 }).world), null);
  assert.equal(H.blindSpot(scene({ cls: "secondary" }).world), null);
  assert.equal(H.blindSpot(scene({ hazards: false }).world), null);
  // cars parked on the far side of a two-way street are too far from the car's side to count
  const far = scene({ rears: [] });
  for (const [i, rear] of [60, 66.1, 72.2].entries()) { const c = new Vehicle(rear + 4.5 - CAR.rearOverhang, 4.65, Math.PI, 0); Object.assign(c, { id: `f${i}`, edge: "out", curb: "right" }); far.world.parked.add(c); }
  assert.equal(H.blindSpot(far.world), null);
});

await test("sensing reports the blind spot, caps the speed limit and the target speed at it, and decides more often beside it", () => {
  const { world } = scene({ x: 30, v: 13 });
  const snap = buildSnapshot(world);
  assert.equal(snap.blind_spot.side, "right");
  assert.ok(Math.abs(snap.limit - H.blindApproach(H.blindSpeed(), snap.blind_spot.from_m)) < 1e-9);
  assert.ok(snap.target.v <= snap.limit + 1e-9);
  assert.ok(snap.target.reasons.includes("parked cars ahead hide the sidewalk"), snap.target.reasons.join("/"));
  // (decisions come every 250 ms from 10 m before the step-out distance)
  assert.ok(!hazardFlags(snap).includes("blind spot"));
  assert.ok(hazardFlags(buildSnapshot(scene({ x: 45, v: 9 }).world)).includes("blind spot"));
  // with hazards off, the same street asks nothing of the car
  const off = buildSnapshot(scene({ hazards: false, x: 30, v: 13 }).world);
  assert.equal(off.blind_spot, null);
  assert.equal(off.limit, 13.9);
  assert.ok(!hazardFlags(off).includes("blind spot"));
});

await test("models are told: a blind_spot field, a situation line, and a prompt line", () => {
  const { world } = scene({ x: 50, v: 9 });
  const snap = buildSnapshot(world);
  const state = toJevState(snap, [], {});
  assert.equal(state.blind_spot.side, "right");
  assert.equal(state.blind_spot.street, "quiet street");
  assert.equal(state.blind_spot.stop_within_m, H.STEP_OUT_M);
  assert.equal(state.blind_spot.pass_at, Math.round(H.blindSpeed() * 10) / 10);
  const line = situationClauses(snap).find((c) => c.startsWith("Cars parked along the right"));
  assert.ok(line && line.includes("32 km/h") && line.includes("step out"), line);
  assert.ok(SYSTEM_PROMPT.includes("`blind_spot`"));
  assert.equal(toJevState(buildSnapshot(scene({ hazards: false, x: 50, v: 9 }).world), [], {}).blind_spot, undefined);
});

await test("coaching counts passing parked cars too fast to stop for someone stepping out, once a street, with a tip; only with hazards on", () => {
  const { world } = scene({ x: 30, v: 13.5, rears: [60, 66.1, 72.2, 78.3, 84.4, 90.5, 96.6, 102.7, 108.8] });
  const score = new DriveScore(world, { title: "t" });
  for (let k = 0; k < 6 / DT; k++) {
    world.ego.x += world.ego.v * DT; world.t += DT;
    const road = world.roadInfo(); world._road = road;
    score.record(world, road, DT);
  }
  const r = score.finish();
  assert.ok(r.blind_spot_speeding_s > 2, `${r.blind_spot_speeding_s}`);
  assert.equal(r.incidents.filter((i) => i.type === "blind_spot_speeding").length, 1);
  assert.ok(r.tips.some((t) => t.includes("step out from between them")));
  const off = scene({ hazards: false, x: 30, v: 13.5 }), s2 = new DriveScore(off.world, { title: "t" });
  for (let k = 0; k < 120; k++) { off.world.ego.x += off.world.ego.v * DT; const road = off.world.roadInfo(); s2.record(off.world, road, DT); }
  assert.equal("blind_spot_speeding_s" in s2.finish(), false);
});

await test("the HUD says so: parked cars hiding the sidewalk ahead, then someone stepping out", () => {
  const { world } = scene({ x: 30, v: 9 });
  const n = H.hazardNotice(world);
  assert.equal(n.text, "PARKED CARS HIDE THE SIDEWALK · 32 KM/H");
  assert.equal(n.key, "blind:in:right");
  assert.equal(H.hazardNotice(scene({ hazards: false, x: 30 }).world), null);
  // once the challenge's child steps out and the car can see them
  const ctx = setupChallenge(KITS, CHALLENGES.find((c) => c.id === "step-out"), { brain: "rules" });
  let said = null;
  for (let k = 0; k < 40 / DT && ctx.autopilot.enabled && !said; k++) {
    stepWorld(ctx, DT, ctx.world.t * 1000);
    const line = H.hazardNotice(ctx.world);
    if (line?.wait) said = line;
  }
  assert.equal(said?.text, "CHILD STEPPING OUT FROM THE PARKED CARS · STOP");
});

await test("free drive: someone waits hidden between parked cars ahead, steps out when the car is 15 m away, and Rules stops short of them", async () => {
  // Stephens Street, Kitsilano, lined with the usual parked cars; the first step-out is due at once
  const challenge = CHALLENGES.find((c) => c.id === "step-out"), sc = challengeScenario(KITS, challenge);
  let done = null;
  for (let seed = 1; seed <= 12 && !done; seed++) {
    setWeather("dry");
    const world = new World(KITS, { seed, pedestrians: 0, hazards: true, stepOuts: H.STEP_OUT_COUNT });
    world.placeOnLane(KITS.lane(sc.start.edge, sc.start.lane), sc.start.s);
    const fleet = new NpcFleet(world, { count: 0, bikes: 0, seed });
    // (no parked car pulls out ahead: with anyone else on the street ahead, nobody steps out)
    world.parked.nextDoor = 1e9; fleet.nextPark = 1e9; fleet.nextPull = 1e9;
    const autopilot = new Autopilot(world, {}); autopilot.setBrain("rules");
    world.route = new Route(sc.route, KITS, world.ego.spec); world.destination = sc.goal;
    autopilot.setEnabled(true);
    world.stepOuts.wait = 0;
    let placed = null, hiddenAtPlace = null, out = null, seenAt = null, minGap = Infinity;
    for (let k = 0; k < 40 / DT && autopilot.enabled; k++) {
      stepWorld({ world, fleet, autopilot }, DT, world.t * 1000);
      const p = world.stepOuts.people[0] || (placed && { ped: placed, state: "out" });
      if (!p) continue;
      if (!placed) { placed = p.ped; hiddenAtPlace = !world.sees(world.ego, p.ped); }
      const l = world.ego.toLocal(placed.x, placed.y);
      if (p.state === "out" && !out) out = { toLine: l.ahead - FRONT, v: world.ego.v };
      if (out && seenAt === null && world.sees(world.ego, placed)) seenAt = l.ahead - FRONT;
      if (out && Math.abs(l.right) < 1.5 && l.ahead > 0) minGap = Math.min(minGap, l.ahead - FRONT);
    }
    if (out) done = { seed, hiddenAtPlace, out, seenAt, minGap, collisions: world.violations.collisions, joined: world.crowd.list.includes(placed) && !placed.held };
  }
  assert.ok(done, "a step-out happened");
  assert.equal(done.hiddenAtPlace, true);
  assert.ok(done.out.toLine <= H.STEP_OUT_M + 0.3 && done.out.toLine > H.STEP_OUT_M - 1, `${done.out.toLine}`);
  assert.ok(done.out.v <= H.blindSpeed() + 0.6, `${done.out.v}`);
  assert.ok(done.seenAt > 11 && done.seenAt <= H.STEP_OUT_M + 0.3, `${done.seenAt}`);
  assert.ok(done.minGap > 1, `${done.minGap}`);
  assert.equal(done.collisions, 0);
  assert.equal(done.joined, true);
  process.stdout.write(`  (seed ${done.seed}: out at ${done.out.toLine.toFixed(1)} m, ${(done.out.v * 3.6).toFixed(0)} km/h, seen at ${done.seenAt.toFixed(1)} m, stopped ${done.minGap.toFixed(1)} m short)\n`);
});

await test("step-outs never happen with hazards off, and a world without them draws nothing from its random streams", () => {
  const world = new World(KITS, { seed: 3, pedestrians: 0, stepOuts: 1 });
  assert.equal(world.hazards, false);
  assert.equal(world.stepOuts.count, 0);
  assert.equal(world.stepOuts.random, null);
  world.stepOuts.step(100);
  assert.equal(world.stepOuts.people.length, 0);
});

await test("the challenge, closed loop: Rules and the cautious agent keep to the blind-spot speed, see the child only as they step out, and stop short", async () => {
  const challenge = CHALLENGES.find((c) => c.id === "step-out");
  assert.ok(challenge && challenge.hidden && challenge.map === "kitsilano");
  for (const brain of ["rules", "cautious"]) {
    const r = await evaluateChallenge(KITS, challenge, { brain });
    assert.ok(r.pass, `${brain}: ${JSON.stringify(r.failures)}`);
    assert.equal(r.collisions, 0);
    assert.equal(r.report.blind_spot_speeding_s, 0);
    process.stdout.write(`  (${brain}: arrived at ${r.time_s} s)\n`);
  }
  const run = (hidden) => {
    const ctx = setupChallenge(KITS, { ...challenge, hidden }, { brain: "rules" }), { world } = ctx;
    const child = world.crowd.list.find((p) => p.id === "challenge_child");
    let out = null, seenAt = null;
    for (let k = 0; k < 60 / DT && ctx.autopilot.enabled; k++) {
      stepWorld(ctx, DT, world.t * 1000);
      const l = world.ego.toLocal(child.x, child.y);
      if (world.challenge.triggered && !out) out = { v: world.ego.v, toLine: l.ahead - FRONT };
      if (seenAt === null && world.sees(world.ego, child)) seenAt = l.ahead - FRONT;
    }
    return { out, seenAt, collisions: world.violations.collisions };
  };
  const on = run(true), off = run(false);
  assert.ok(on.out.v <= H.blindSpeed() + 0.3, `${on.out.v}`);
  assert.ok(on.seenAt > 12 && on.seenAt <= H.STEP_OUT_M + 0.3, `${on.seenAt}`);
  assert.equal(on.collisions, 0);
  // without hidden hazards the car sees the child all along but has no reason to slow for them: it is
  // doing about 50 when they step out, and cannot stop
  assert.ok(off.out.v > 13, `${off.out.v}`);
  assert.ok(off.seenAt > 60);
  assert.equal(off.collisions, 1);
  // nothing else has hidden hazards but "Blind left" (scripts/test_hidden_traffic.mjs): the other
  // challenges and the benchmark
  assert.deepEqual(CHALLENGES.filter((c) => c.hidden).map((c) => c.id), ["step-out", "blind-left"]);
  const lane = [...KITS.lanes.values()][0];
  const bench = setupScenario(KITS, { start: { edge: lane.edge, lane: lane.idx, s: 2 }, route: { id: "x", polyline: [lane.pts[0], lane.pts.at(-1)], edges: [lane.edge], turns: [] }, goal: lane.pts.at(-1), traffic_seed: 1 }, { npcs: 0 });
  assert.equal(bench.world.hazards, false);
  assert.equal(bench.world.stepOuts.count, 0);
});

await test("a restored checkpoint ties the step-outs back to the live world, with the person waiting where they were", () => {
  setWeather("dry");
  const world = new World(KITS, { seed: 2, pedestrians: 0, hazards: true, stepOuts: 1 });
  const fleet = new NpcFleet(world, { count: 0, bikes: 0, seed: 2 });
  const autopilot = new Autopilot(world, {});
  const ped = new Pedestrian({ id: "stepout_9", x: 1, y: 2, psi: 0, v: 0, speed: 1.5, path: [], crossing: null, waiting: 0, phase: 0, look: 1, at: null, held: true });
  world.crowd.list.push(ped);
  world.stepOuts.people.push({ ped, psi: 0, since: 0, state: "waiting" });
  const recorder = new DriveRecorder();
  recorder.record({ world, fleet, autopilot, drive: {}, clock: {} }, true);
  world.stepOuts.people.length = 0;
  recorder.restore(0, { world, fleet, autopilot, clock: { setHour() {}, update() {} }, setDrive() {} });
  assert.equal(world.stepOuts.people.length, 1);
  assert.ok(world.crowd.list.includes(world.stepOuts.people[0].ped), "the same person, in the live crowd");
  assert.ok(world.stepOuts.world === world, "stepping it steps the live world");
});

console.log(`\n${checks} checks passed`);
process.exit(0);
