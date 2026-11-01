// Parallel parking at the destination (sim/parallel-park.js): where the car may park and which spaces
// it fits, the reverse in, Rules closed loop, traffic and cyclists behind, a car stopped too close
// behind backing up, no space at all, pulling out again, what models are told, the kerb-strike audit,
// coaching and the report, the HUD, checkpoints, and the "Squeeze in" challenge.
// node --experimental-default-type=module scripts/test_parking_ego.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
globalThis.document = { querySelector: () => null };
const { MapData, projectPoint } = await import("../static/js/map/mapdata.js");
const { Route } = await import("../static/js/map/route.js");
const { World } = await import("../static/js/sim/world.js");
const { Vehicle, CAR, BIKE } = await import("../static/js/sim/vehicle.js");
const { NpcFleet, NpcPath } = await import("../static/js/sim/npc.js");
const { StopMemory } = await import("../static/js/sim/signals.js");
const { stepWorld } = await import("../static/js/sim/step.js");
const { speedControl } = await import("../static/js/sim/controller.js");
const { obbOverlap } = await import("../static/js/sim/collision.js");
const { busZones } = await import("../static/js/sim/bus.js");
const { railIndex } = await import("../static/js/sim/rail.js");
const { getVehicleModel } = await import("../static/js/sim/vehicle-models.js");
const P = await import("../static/js/sim/parallel-park.js");
const { DriveScore } = await import("../static/js/sim/drive-score.js");
const { Autopilot } = await import("../static/js/brain/brain.js");
const { buildSnapshot } = await import("../static/js/brain/sensors.js");
const { sampleCandidates, simulateAll } = await import("../static/js/brain/candidates.js");
const { toJevState, situationClauses, buildQuestions } = await import("../static/js/brain/state.js");
const { SYSTEM_PROMPT } = await import("../static/js/brain/llm-prompt.js");
const { CHALLENGES } = await import("../static/js/lab/challenges.js");
const { evaluateChallenge, setupChallenge } = await import("../static/js/lab/evaluation.js");
const { DriveRecorder } = await import("../static/js/lab/recorder.js");
const { setupScenario } = await import("../static/js/bench/runner.js");

let checks = 0;
async function test(name, fn) { await fn(); checks++; console.log(`✓ ${name}`); }
const DT = 1 / 60;

// A straight two-way street, one lane each way (centre 1.75 m right of the centre line), with a 2.4 m
// parking lane each side: the kerb 5.9 m right of the centre line. Travel is +x along `in`.
const L = 220, LANE = 1.75, KERB = 5.9;
const street = { lanes: 1, lane_width: 3.5, width: 11.8, lane_offsets: [LANE], asphalt: [-KERB, KERB], parking: [2.4, 2.4], cls: "residential", limit: 11.2, oneway: false, name: "Test Street" };
const MAP = new MapData({ bbox: [0, 0, 1, 1], extent: [-20, -40, L + 20, 40],
  edges: [{ id: "in", from: "a", to: "b", pts: [[0, 0], [L, 0]], length: L, ...street }, { id: "out", from: "b", to: "a", pts: [[L, 0], [0, 0]], length: L, ...street }],
  lanes: [{ edge: "in", idx: 0, pts: [[0, -LANE], [L, -LANE]] }, { edge: "out", idx: 0, pts: [[L, LANE], [0, LANE]] }],
  nodes: [{ id: "a", x: 0, y: 0 }, { id: "b", x: L, y: 0 }], intersections: [], stops: [], buildings: [] });
const PARKED_Y = -(KERB - 1.25);

// A world on the test street with cars parked at the right kerb from x = 30 to 170, a space from `a`
// `gap` metres long, the car at `x` in its lane and a route to `goal`.
function street1({ gap = 7.3, a = 120, x = 40, goal = a + gap + 25, spec = CAR, park = true, full = false, row = true } = {}) {
  // (the kerb's parking slots, for reserving, but none of its seeded parked cars)
  const world = new World(MAP, { parked: 1e-9, pedestrians: 0, park, vehicleSpec: spec });
  let n = 0;
  const add = (rear) => { const c = new Vehicle(rear + CAR.rearOverhang, PARKED_Y, 0, 0); Object.assign(c, { id: `parked_${++n}`, edge: "in", curb: "right", stay: true }); world.parked.add(c); };
  if (row) {
    for (let r = a - CAR.length; r > 30; r -= CAR.length + 1.2) add(r);
    for (let r = a + gap; r < 170; r += CAR.length + 1.2) add(r);
    if (full) add(a + (gap - CAR.length) / 2);
  }
  world.placeOnLane(MAP.lane("in", 0), x);
  const pts = [];
  for (let k = 0; k <= goal; k++) pts.push([k, -LANE]);
  world.route = new Route({ id: "r", polyline: pts, edges: ["in"], turns: [], start_s: 0, goal_s: goal }, MAP, world.ego.spec);
  world.destination = [goal, -LANE];
  const fleet = new NpcFleet(world, { count: 0, bikes: 0, seed: 1 });
  fleet.nextPark = 1e9; fleet.nextPull = 1e9; world.parked.nextDoor = 1e9;
  return { world, fleet };
}
function pilot(world, brain = "rules") {
  const events = [];
  const autopilot = new Autopilot(world, { onEvent: (e) => events.push(e) });
  autopilot.setBrain(brain); autopilot.setEnabled(true);
  return { autopilot, events };
}
// Steps until the autopilot arrives (or `seconds`), recording contacts and signals.
async function run(ctx, seconds = 120, each = () => {}) {
  const out = { contacts: 0, kerb: 0, signals: new Set() };
  for (let k = 0; k < seconds / DT && ctx.autopilot.enabled; k++) {
    stepWorld(ctx, DT, ctx.world.t * 1000);
    if (ctx.autopilot.firing) await ctx.autopilot.firing;
    for (const e of ctx.world.events) { if (e.type === "collision") out.contacts++; if (e.type === "kerb_strike") out.kerb++; }
    out.signals.add(ctx.world.ego.signal || "none");
    each(ctx.world);
  }
  return out;
}
function car(world, fleet, id, x, v, { kind = "car" } = {}) {
  const spec = kind === "bike" ? BIKE : CAR, y = kind === "bike" ? -(LANE + 1.1) : -LANE;
  const n = new Vehicle(x, y, 0, v, spec);
  Object.assign(n, { id, kind, color: 0x888888, v0: v || 8, driver: { aMax: 1.5, b: 2, s0: 2, T: 1.2, react: 0.5, lcRate: 0 }, stopMem: new StopMemory(), path: new NpcPath(MAP, fleet.random, kind === "bike" ? { bike: true } : undefined), frozen: 0, waiting: 0 });
  n.path.start("in", 0, x);
  fleet.vehicles.push(n);
  return n;
}

// The gap between two vehicles' bodies: the least distance from a corner of one to the other's box.
function gapBetween(a, b) {
  const corners = (v) => { const o = v.obb(), c = Math.cos(o.heading), s = Math.sin(o.heading); return [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([p, q]) => [o.center[0] + p * o.halfLength * c - q * o.halfWidth * s, o.center[1] + p * o.halfLength * s + q * o.halfWidth * c]); };
  const toBox = (pt, v) => { const o = v.obb(), c = Math.cos(o.heading), s = Math.sin(o.heading), dx = pt[0] - o.center[0], dy = pt[1] - o.center[1];
    const u = Math.abs(dx * c + dy * s) - o.halfLength, w = Math.abs(-dx * s + dy * c) - o.halfWidth; return Math.hypot(Math.max(0, u), Math.max(0, w)); };
  return Math.min(...corners(a).map((p) => toBox(p, b)), ...corners(b).map((p) => toBox(p, a)));
}

const root = new URL("../data/maps/", import.meta.url);
const load = (key) => {
  const pack = JSON.parse(fs.readFileSync(new URL(`${key}.v6.pack.json`, root)));
  for (const name of ["transit", "crossings", "zones", "rail"]) {
    const url = new URL(`${key}.${name}.v1.json`, root);
    if (fs.existsSync(url)) pack[name] = JSON.parse(fs.readFileSync(url));
  }
  pack.utc_offset = -7;
  return new MapData(pack);
};
const KITS = load("623b012bc8b5");

await test("a space between parked cars is the car's if it can reverse into it in one go: longer for a longer car", () => {
  const found = (gap, spec = CAR) => {
    const { world } = street1({ gap, spec });
    return P.spacesAlong(world, world.route, world.ego.spec).filter((p) => p.sFrom > 110 && p.sTo < 135).length;
  };
  assert.equal(found(7.3), 1, "7.3 m, the sedan");
  assert.equal(found(6.9), 0, "6.9 m is too short for the sedan");
  assert.equal(found(6.8, getVehicleModel("compact").spec), 1, "the compact fits 6.8 m");
  assert.equal(found(7.3, getVehicleModel("pickup").spec), 0, "the pickup does not fit 7.3 m");
  assert.equal(found(8.6, getVehicleModel("pickup").spec), 1, "it fits 8.6 m");
  // an empty kerb running on past the destination: a space short of it
  const open = street1({ row: false });
  const near = P.spacesAlong(open.world, open.world.route, CAR);
  assert.ok(near.length && near[0].goalS + CAR.length - CAR.rearOverhang <= open.world.route.length + 2 && near[0].stopS <= open.world.route.length - 1.5, "an empty kerb past the destination");
  // the space is found only before the destination, near it
  const { world } = street1({ gap: 7.3, goal: 200 });
  assert.equal(P.spacesAlong(world, world.route, world.ego.spec).filter((p) => p.sFrom > 110 && p.sTo < 135).length, 0, "more than 60 m before the destination");
});

await test("legal stretches keep out of junctions, crosswalks and the 6 m before them, the 6 m before a stop line, and bus zones (BC MVA s. 189(1))", () => {
  const check = (map) => {
    let lines = 0, walks = 0, zones = 0;
    for (const e of map.edges.values()) {
      const legal = P.legalStretches(map, e);
      if (!e.parking?.[1] || e.ring) { assert.equal(legal.length, 0, `${e.id}: no parking lane, nowhere to park`); continue; }
      for (const [lo, hi] of legal) assert.ok(lo >= 0 && hi <= e.cum.at(-1) + 1e-6 && hi > lo, `${e.id}: a stretch on the street`);
      if (e.control && legal.length) { lines++; assert.ok(Math.max(...legal.map(([, hi]) => hi)) <= e.control.s_line - 6 + 1e-6, `${e.id}: 6 m before its line`); }
      for (const c of map.crosswalks.filter((w) => w.edge === e.id)) {
        const s = projectPoint(e.pts, e.cum, [c.x, c.y]).s;
        walks++;
        assert.ok(legal.every(([lo, hi]) => hi <= s - 1.5 - 6 + 1e-6 || lo >= s + 1.5 - 1e-6), `${e.id}: clear of the crosswalk at ${s.toFixed(1)}`);
      }
      for (const [za, zb] of busZones(map).get(e.id) || []) { zones++; assert.ok(legal.every(([lo, hi]) => hi <= za + 1e-6 || lo >= zb - 1e-6), `${e.id}: clear of the bus zone`); }
    }
    return { lines, walks, zones };
  };
  const k = check(KITS), t = check(load("4a96d42cb3f2"));
  assert.ok(k.lines > 20 && k.walks > 0 && t.zones > 0, JSON.stringify({ k, t }));
  // never on a street a level crossing is on (Edmonton has some)
  const EDM = load("3e794edbefcb");
  const railed = railIndex(EDM).crossings.flatMap((c) => c.edges.map((on) => on.edge));
  assert.ok(railed.length > 0);
  for (const id of railed) assert.equal(P.legalStretches(EDM, EDM.edges.get(id)).length, 0, `${id}: level crossing`);
});

await test("the S into a space: two arcs on full lock, or with a straight between them, end parallel D out and X back", () => {
  const R = P.turnRadius(CAR);
  for (const [X, D] of [[0, 2.85], [6.68, 2.85], [8, 2.5], [6.2, 3.1]]) {
    const s = P.solveS(R, X || Infinity, D);
    const along = 2 * R * Math.sin(s.phi1) + s.d * Math.cos(s.phi1), out = 2 * R * (1 - Math.cos(s.phi1)) + s.d * Math.sin(s.phi1);
    assert.ok(Math.abs(out - D) < 1e-6, `lateral ${out.toFixed(3)} vs ${D}`);
    assert.ok(Math.abs(along - s.X) < 1e-6 && s.d >= -1e-9, `along ${along.toFixed(3)}`);
    if (X && X > s.X - 1e-6) assert.ok(Math.abs(s.X - X) < 1e-3, `back ${s.X.toFixed(3)} vs ${X}`);
  }
});

await test("on its own, the manoeuvre parks the car parallel, within 30 cm of the kerb, without touching anything, tight or roomy", () => {
  for (const [gap, model] of [[7.1, "sedan"], [8.5, "sedan"], [14, "sedan"], [6.65, "compact"], [7.5, "suv"]]) {
    const spec = getVehicleModel(model).spec;
    const { world } = street1({ gap, spec });
    const plan = P.spacesAlong(world, world.route, spec).find((p) => p.sFrom > 110 && p.sTo < 140);
    assert.ok(plan, `${model}: a ${gap} m space`);
    const law = P.planParking(plan);
    Object.assign(world.ego, { x: plan.startU + 0.6, y: -plan.startW, psi: 0, v: 0, delta: 0 });
    let touched = false, kerb = false;
    for (let t = 0; t < 90 && law.phase !== "parked" && law.phase !== "stuck"; t += DT) {
      P.stepParking(world.ego, law, world, DT, speedControl);
      const box = world.ego.obb();
      if (world.parked.list.some((c) => obbOverlap(box, c.obb(), 0.05))) touched = true;
      if (P.tyres(world.ego, spec).some((p) => MAP.roadDistance(p[0], p[1]).distance > 0.02)) kerb = true;
    }
    assert.equal(law.phase, "parked", `${model} in ${gap} m`);
    const pose = P.parkedPose(world.ego, law, world);
    assert.ok(pose.within_kerb && pose.kerb_m >= 0 && pose.kerb_m <= P.KERB_MAX_M, `${model} in ${gap} m: ${pose.kerb_m} m from the kerb at ${pose.angle_deg} deg`);
    assert.ok(!touched && !kerb, `${model} in ${gap} m: touched ${touched}, kerb ${kerb}`);
    assert.ok(law.legs <= 4, `${model} in ${gap} m: ${law.legs + 1} legs`);
  }
});

await test("Rules, closed loop: it signals right, stops alongside the car in front, reverses in, and arrives parked", async () => {
  const { world, fleet } = street1({ gap: 7.3 });
  const { autopilot, events } = pilot(world);
  let pulledUp = false;
  const r = await run({ world, fleet, autopilot }, 120, (w) => { if (w.park?.status === "waiting") pulledUp = true; });
  const arrived = events.find((e) => e.type === "arrived");
  assert.ok(arrived && arrived.parked === true, JSON.stringify(arrived));
  assert.ok(arrived.within_kerb && arrived.kerb_m <= 0.3, `${arrived.kerb_m} m from the kerb`);
  assert.ok(pulledUp && r.signals.has("right"), "pulled up, signalling right");
  assert.equal(world.ego.signal, null, "the signal is off once parked");
  assert.equal(r.contacts + r.kerb, 0);
  // the space stays the car's while it stands there
  assert.ok(world.parkedIn && world.parked.slots.filter((s) => s.reserved === world.ego).length >= 1);
  process.stdout.write(`  (parked at ${world.t.toFixed(1)} s, ${arrived.kerb_m} m from the kerb, ${arrived.legs} legs)\n`);
});

await test("traffic coming up behind keeps back while the car reverses in, and goes by once it is in", async () => {
  const { world, fleet } = street1({ gap: 7.3, x: 70 });
  const follower = car(world, fleet, "follower", 40, 8);
  const { autopilot, events } = pilot(world);
  let closest = Infinity, passed = false, wasParking = false;
  const r = await run({ world, fleet, autopilot }, 120, (w) => {
    if (w.parking && w.parking.phase !== "start") {
      wasParking = true;
      closest = Math.min(closest, gapBetween(w.ego, follower));
      if (w.ego.toLocal(follower.x, follower.y).ahead > 0) passed = true;
    }
  });
  assert.ok(wasParking && events.some((e) => e.type === "arrived" && e.parked));
  assert.ok(!passed, "it never went by while the car was parking");
  assert.ok(closest > 2, `it kept ${closest.toFixed(1)} m back`);
  assert.equal(r.contacts, 0);
  for (let k = 0; k < 15 / DT; k++) stepWorld({ world, fleet, autopilot }, DT, world.t * 1000);
  assert.ok(world.ego.toLocal(follower.x, follower.y).ahead > 5, "then it went by");
});

await test("a car stopped too close behind backs up to let it in; a cyclist coming up behind has it wait", async () => {
  const { world, fleet } = street1({ gap: 7.3 });
  const plan = P.spacesAlong(world, world.route, world.ego.spec).find((p) => p.sFrom > 110 && p.sTo < 135);
  world.placeOnLane(MAP.lane("in", 0), plan.startU);
  world.ego.y = -plan.startW;
  const close = car(world, fleet, "close", plan.startU - CAR.length - 2.5, 0);
  const { autopilot, events } = pilot(world);
  let waitedFor = null, backed = false;
  await run({ world, fleet, autopilot }, 90, (w) => { if (w.park?.blocked) waitedFor = w.park.blocked; if (close.backoff) backed = true; });
  assert.equal(waitedFor, "close");
  assert.ok(backed, "it backed up");
  assert.ok(events.some((e) => e.type === "arrived" && e.parked), JSON.stringify(events.at(-1)));
  // a cyclist riding up behind, in the lane
  const second = street1({ gap: 7.3 });
  const p2 = P.spacesAlong(second.world, second.world.route, second.world.ego.spec).find((p) => p.sFrom > 110 && p.sTo < 135);
  second.world.placeOnLane(MAP.lane("in", 0), p2.startU);
  second.world.park = { ...p2, mode: "in", status: "waiting", waited: 0 };
  car(second.world, second.fleet, "rider", p2.startU - 20, 5, { kind: "bike" });
  assert.equal(P.blockerBehind(second.world, p2), "rider");
});

await test("with no space to be had it stops in its lane at the destination; without parking nothing changes", async () => {
  const { world, fleet } = street1({ gap: 7.3, full: true });
  const { autopilot, events } = pilot(world);
  await run({ world, fleet, autopilot }, 60);
  const arrived = events.find((e) => e.type === "arrived");
  assert.ok(arrived && arrived.parked === false, JSON.stringify(arrived));
  assert.ok(Math.abs(world.ego.y + LANE) < 0.6, "in its lane");
  const off = street1({ gap: 7.3, park: false });
  const second = pilot(off.world);
  await run({ world: off.world, fleet: off.fleet, autopilot: second.autopilot }, 60, (w) => assert.ok(!w.park && !w.parking));
  const plain = second.events.find((e) => e.type === "arrived");
  assert.ok(plain && !("parked" in plain), JSON.stringify(plain));
});

await test("pulling out: it backs up, waits for traffic coming up the lane, pulls out on full lock, waits for anyone in the way out, and lets the space go", async () => {
  const { world, fleet } = street1({ gap: 7.3 });
  const first = pilot(world);
  await run({ world, fleet, autopilot: first.autopilot }, 120);
  assert.ok(world.parkedIn);
  const reserved = world.parkedIn.slots, firstSpace = world.parkedIn.id;
  const x0 = Math.round(world.ego.x);
  const pts = [];
  for (let k = x0; k <= 210; k++) pts.push([k, -LANE]);
  world.route = new Route({ id: "r2", polyline: pts, edges: ["in"], turns: [], start_s: x0, goal_s: 210 }, MAP, world.ego.spec);
  world.destination = [210, -LANE];
  const coming = car(world, fleet, "coming", world.ego.x - 45, 8);
  const autopilot = first.autopilot;
  autopilot.setEnabled(true);
  let waitedFor = null, out = false, wentFirst = null, blocker = null, heldFor = 0;
  const r = await run({ world, fleet, autopilot }, 120, (w) => {
    if (w.park?.mode === "out" && w.park.blocked) waitedFor = w.park.blocked;
    if (w.parking?.mode === "out" && w.parking.phase === "out1" && !out) { out = true; wentFirst = w.ego.toLocal(coming.x, coming.y).ahead > 0; }
    // halfway out, a car stops in the way for 6 s, then drives off: the car waits, then carries on out
    if (w.parking?.mode === "out" && w.parking.phase === "out2" && !blocker) {
      const h = w.ego.psi, x = w.ego.x + Math.cos(h) * 7.5, y = -LANE;
      blocker = car(w, fleet, "blocker", x, 0);
      blocker.frozen = 1e6;
    }
    if (blocker && fleet.vehicles.includes(blocker) && (heldFor += DT) > 6) fleet.vehicles.splice(fleet.vehicles.indexOf(blocker), 1);
    if (blocker && w.parking?.mode === "out") assert.notEqual(w.parking.phase, "stuck", "a car in the way out does not leave it stuck");
  });
  assert.ok(blocker && heldFor > 6, "a car stopped in the way out");
  assert.equal(waitedFor, "coming");
  assert.ok(out && r.signals.has("left"), "pulled out, signalling left");
  assert.equal(r.contacts + r.kerb, 0);
  assert.ok(first.events.filter((e) => e.type === "arrived").length === 2, "and drove on to the next destination");
  assert.ok(world.parkedIn?.id !== firstSpace, "parked somewhere else, or in its lane, at the next destination");
  assert.ok(reserved.every((s) => s.reserved !== world.ego), "the first space is let go");
  assert.equal(wentFirst, true, "the car coming went first");
});

await test("models are told: parking state, a situation line, the motion criterion and the prompt", () => {
  const { world } = street1({ gap: 7.3, x: 95 });
  world.ego.v = 6;
  const autopilot = new Autopilot(world, {}); autopilot.setBrain("rules"); autopilot.setEnabled(true);
  autopilot.parker.update(world, world.route.project(world.ego.x, world.ego.y).s, DT);
  const snap = buildSnapshot(world, null);
  assert.equal(snap.parking?.mode, "in");
  const candidates = sampleCandidates(snap, world);
  const { eligible } = simulateAll(candidates, snap, world);
  assert.ok(eligible.some((c) => c.id === "wait_to_park"), candidates.map((c) => `${c.id}:${c.reject}`).join(" "));
  assert.ok(!candidates.some((c) => c.id === "stop_at_destination"), "the space is the destination now");
  const state = toJevState(snap, candidates, { rejected: {} });
  assert.ok(state.parking && state.parking.space_m > 7 && state.parking.stop_in_m > 0);
  assert.ok(situationClauses(snap).some((c) => c.includes("space to park in") && c.includes("wait_to_park")));
  const { questions } = buildQuestions(snap, eligible);
  assert.ok(questions.motion.criteria.drive.includes("Parking (`park`)") && questions.motion.criteria.stop.includes("only once the car is parked"));
  assert.ok(SYSTEM_PROMPT.includes("`wait_to_park`") && SYSTEM_PROMPT.includes("`park`") && SYSTEM_PROMPT.includes("`pull_out`"));
});

await test("the audit counts a tyre on the kerb while parking as a kerb strike, once a contact; coaching and the report know", () => {
  const { world } = street1({ gap: 7.3 });
  const plan = P.spacesAlong(world, world.route, world.ego.spec).find((p) => p.sFrom > 110 && p.sTo < 135);
  world.parking = { ...P.planParking(plan), phase: "in2", dir: -1 };
  const score = new DriveScore(world, {});
  Object.assign(world.ego, { x: 118, y: -(KERB - 0.85), psi: 0 });
  let strikes = 0;
  for (let k = 0; k < 5; k++) { world.audit(DT, world.roadInfo()); strikes += world.events.filter((e) => e.type === "kerb_strike").length; score.record(world, world.roadInfo(), DT); }
  assert.equal(strikes, 1);
  score.noteArrival({ type: "arrived", parked: true, kerb_m: 0.45, angle_deg: 0.5, within_kerb: false, legs: 4 });
  const report = score.finish("arrived");
  assert.equal(report.parking.result, "parked");
  assert.equal(report.parking.kerb_strikes, 1);
  assert.ok(report.tips.some((t) => t.includes("kerb")) && report.tips.some((t) => t.includes("30 cm")));
  // a drive without parking reports nothing about it
  const plain = new DriveScore(street1({ park: false }).world, {}).finish("arrived");
  assert.ok(!("parking" in plain));
});

await test("the HUD says where it is: space ahead, checking behind, reversing in, pulling out", () => {
  const texts = [];
  for (const p of [{ id: "s", mode: "in", status: "approach" }, { id: "s", mode: "in", status: "waiting", blocked: "x" }, { id: "s", mode: "in", status: "waiting", blocked: null }, { id: "s", mode: "in", status: "parking" }, { id: "o", mode: "out", status: "waiting", blocked: "x" }, { id: "o", mode: "out", status: "leaving" }]) {
    texts.push(P.parkNotice({ park: p })?.text);
  }
  assert.deepEqual(texts, ["PARKING SPACE AHEAD · SIGNAL RIGHT · PULL UP ALONGSIDE THE CAR IN FRONT", "PARKING · CHECKING BEHIND · WAIT", "PARKING · CLEAR BEHIND · REVERSE IN", "PARKING · REVERSING IN", "PULLING OUT · TRAFFIC COMING · WAIT", "PULLING OUT"]);
  assert.equal(P.parkNotice({ park: { status: "none" } }), null);
});

await test("a checkpoint taken partway in restores the space, the manoeuvre and its reservation", async () => {
  const { world, fleet } = street1({ gap: 7.3 });
  const { autopilot, events } = pilot(world);
  const recorder = new DriveRecorder();
  const drive = new DriveScore(world, {});
  for (let k = 0; k < 120 / DT && !(world.parking?.phase === "back"); k++) stepWorld({ world, fleet, autopilot }, DT, world.t * 1000);
  assert.equal(world.parking?.phase, "back");
  recorder.record({ world, fleet, autopilot, drive, clock: {} }, true);
  const phase = world.parking.phase, x = world.ego.x;
  for (let k = 0; k < 3 / DT; k++) stepWorld({ world, fleet, autopilot }, DT, world.t * 1000);
  recorder.restore(0, { world, fleet, autopilot, clock: {}, setDrive: () => {} });
  assert.equal(world.parking.phase, phase);
  assert.equal(world.ego.x, x);
  assert.ok(world.park.slots.length > 0 && world.park.slots.every((s) => s.reserved === world.ego), "the slots are reserved for this world's car");
  assert.ok(world.park.slots.every((s) => world.parked.slots.includes(s)), "and they are this world's slots");
  world.paused = false;
  const r = await run({ world, fleet, autopilot }, 60);
  assert.ok(events.some((e) => e.type === "arrived" && e.parked), "and it carries on and parks");
  assert.equal(r.contacts, 0);
});

await test("the challenge, closed loop: Rules and the cautious agent pull up, keep the car behind back, and park within 30 cm of the kerb", async () => {
  const challenge = CHALLENGES.find((c) => c.id === "parallel-park");
  assert.ok(challenge && challenge.park && challenge.map === "kitsilano");
  for (const brain of ["rules", "cautious"]) {
    const r = await evaluateChallenge(KITS, challenge, { brain });
    assert.ok(r.pass && r.parked && r.report.parking.within_kerb, `${brain}: ${JSON.stringify({ failures: r.failures, parking: r.report.parking })}`);
    assert.equal(r.collisions, 0);
    process.stdout.write(`  (${brain}: parked at ${r.time_s} s, ${r.report.parking.kerb_m} m from the kerb, ${r.report.parking.legs} legs)\n`);
  }
  // the car behind comes up as the car pulls up, and waits until it is in
  const ctx = setupChallenge(KITS, challenge, { brain: "rules" });
  let behind = Infinity;
  for (let k = 0; k < 90 / DT && ctx.autopilot.enabled; k++) {
    stepWorld(ctx, DT, ctx.world.t * 1000);
    if (ctx.world.parking) behind = Math.min(behind, gapBetween(ctx.world.ego, ctx.fleet.vehicles.find((v) => v.id === "challenge_follower")));
  }
  assert.ok(behind > 2 && behind < 15, `it waited ${behind.toFixed(1)} m from the car`);
  // nothing else parks: the other challenges and the benchmark stop in their lane
  assert.equal(CHALLENGES.filter((c) => c.park).length, 1);
  const lane = [...KITS.lanes.values()][0];
  const bench = setupScenario(KITS, { start: { edge: lane.edge, lane: lane.idx, s: 2 }, route: { id: "x", polyline: [lane.pts[0], lane.pts.at(-1)], edges: [lane.edge], turns: [] }, goal: lane.pts.at(-1), traffic_seed: 1 }, { npcs: 0 });
  assert.equal(bench.world.parkAtGoal, false);
});

console.log(`\n${checks} checks passed`);
process.exit(0);
