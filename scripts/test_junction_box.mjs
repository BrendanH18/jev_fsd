// Keeping the junction clear (Québec's Highway Safety Code): where the box of a signal ends, who
// leaves no room past it, traffic waiting at the line for room even on a green (but not a cyclist or
// an ambulance with its siren on), sensing, candidates, what models are told, the audit and the score,
// the HUD, the "Keep the box clear" challenge with Rules, and the same drive with a driver who follows
// the queue into the junction.
// node --experimental-default-type=module scripts/test_junction_box.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
globalThis.document = { querySelector: () => null };
const { MapData } = await import("../static/js/map/mapdata.js");
const { World } = await import("../static/js/sim/world.js");
const { NpcFleet, NpcPath } = await import("../static/js/sim/npc.js");
const { Vehicle, CAR, BIKE } = await import("../static/js/sim/vehicle.js");
const { StopMemory } = await import("../static/js/sim/signals.js");
const { stepWorld } = await import("../static/js/sim/step.js");
const box = await import("../static/js/sim/junction-box.js");
const { EMERGENCY_SPECS } = await import("../static/js/sim/emergency.js");
const { DriveScore } = await import("../static/js/sim/drive-score.js");
const { buildSnapshot } = await import("../static/js/brain/sensors.js");
const { sampleCandidates, simulateAll } = await import("../static/js/brain/candidates.js");
const { toJevState, buildQuestions, situationClauses } = await import("../static/js/brain/state.js");
const { DeadlockDetector } = await import("../static/js/brain/safety.js");
const { CHALLENGES } = await import("../static/js/lab/challenges.js");
const { setupChallenge } = await import("../static/js/lab/evaluation.js");

let checks = 0;
function test(name, fn) { fn(); checks++; console.log(`✓ ${name}`); }
const root = new URL("../data/maps/", import.meta.url);
const load = (key) => {
  const pack = JSON.parse(fs.readFileSync(new URL(`${key}.v6.pack.json`, root)));
  for (const name of ["transit", "crossings", "zones", "rail"]) {
    const url = new URL(`${key}.${name}.v1.json`, root);
    if (fs.existsSync(url)) pack[name] = JSON.parse(fs.readFileSync(url));
  }
  return new MapData(pack);
};
const MONTREAL = load("bb9df59633e0");
const CHALLENGE = CHALLENGES.find((c) => c.id === "junction-box");
const step = (ctx, input = null) => stepWorld({ ...ctx, input }, 1 / 60, ctx.world.t * 1000);
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);
const FRONT = CAR.length - CAR.rearOverhang;
// (Avenue du Mont-Royal Est, eastbound, at Rue Saint-Denis)
const E191 = MONTREAL.edges.get("e191"), LANE191 = MONTREAL.lane("e191", 0);

// The challenge's world, its car placed with its front `toLine` metres short of the line on Mont-Royal
// at `v`, at `t` seconds (its light green from 2.7 s to 21.4 s, red from 24.4 s), with the queue past
// the junction (or without it: `queue` false).
function atSaintDenis({ toLine = 20, v = 8, t = 8, queue = true } = {}) {
  const ctx = setupChallenge(MONTREAL, CHALLENGE), { world, fleet } = ctx;
  if (!queue) for (const id of world.challenge.boxQueueIds) fleet.vehicles.splice(fleet.vehicles.findIndex((n) => n.id === id), 1);
  const scale = LANE191.length / E191.length;
  world.placeOnLane(LANE191, E191.control.s_line * scale - toLine - FRONT);
  world.ego.v = v; world.t = t;
  return ctx;
}
const decide = (ctx) => {
  const snap = buildSnapshot(ctx.world), cands = sampleCandidates(snap, ctx.world);
  simulateAll(cands, snap, ctx.world);
  return { snap, cands, by: (id) => cands.find((c) => c.id === id), drives: cands.filter((c) => c.id === "keep_lane_limit" || c.id === "keep_lane_hold") };
};
const queueOf = (ctx) => ctx.world.challenge.boxQueueIds.map((id) => ctx.fleet.vehicles.find((n) => n.id === id));

test("the box of a signal runs from its line to the far side of the widest street across it", () => {
  // (Saint-Denis has two lanes each way: 7 m from its centre to each side)
  assert.equal(MONTREAL.crossingHalfWidth("e191"), 7);
  near(box.boxEnd(MONTREAL, "e191", 100), 107, 1e-9, "the far side");
  near(box.boxStart(MONTREAL, "e191", 100), 93, 1e-9, "the near side");
  // (a front barely over the line still waits there; further in, barely moving and short of the
  // street across, too; in the junction, or moving on over the line, it has entered and goes on)
  assert.ok(box.waitsAt(0.5, 4, 8) && box.waitsAt(-0.8, 3, 8) && box.waitsAt(-2, 1, 1));
  assert.ok(!box.waitsAt(-2, 1, 5) && !box.waitsAt(-3, -0.5, 0));
});

test("the room past the box counts the gap a driver stops behind a car, and a car level with a short path's end but far beyond it is not in the way", () => {
  // (a straight path along x, its line at 10 m and its box ending at 25 m: a car needs its length,
  // the 2.5 m it stops behind another and 1 m)
  const pts = [[0, 0], [60, 0]], cum = [0, 60], need = 25 + CAR.length + box.ROOM_M;
  const at = (rear) => new Vehicle(rear + CAR.rearOverhang, 0, 0, 0, CAR);
  near(box.ROOM_M, 3.5, 1e-9, "room");
  assert.ok(box.boxBlocker(pts, cum, 10, 25, CAR, [at(25 + CAR.length + 2)], null), "its length and 2 m: no room");
  assert.equal(box.boxBlocker(pts, cum, 10, 25, CAR, [at(need + 0.5)], null), null);
  // (a path ending 3 m past the box, and a car stopped 30 m beyond its end)
  assert.equal(box.boxBlocker([[0, 0], [28, 0]], [0, 28], 10, 25, CAR, [at(58)], null), null);
});

test("challenge: Mont-Royal Est at Saint-Denis on the green, a queue back from Rue Rivard to just past the junction", () => {
  const ctx = setupChallenge(MONTREAL, CHALLENGE), { world, scenario } = ctx;
  assert.equal(scenario.start.edge, "e191");
  assert.equal(scenario.junctionBox.signal, "sig14");
  assert.deepEqual(scenario.junctionBox.queue.edges, ["e187", "e179"]);
  const cars = queueOf(ctx);
  assert.ok(cars.length >= 6, `${cars.length} cars`);
  assert.equal(cars[0].signal, "left");
  assert.ok(cars.every((n) => n.frozen > 1000));
  const c = world.route.controls.find((x) => x.control.id === "sig14"), far = box.boxEnd(MONTREAL, c.edge, c.sJunction);
  const b = box.boxBlocker(world.route.pts, world.route.cum, c.sRoute, far, world.ego.spec, cars, world.ego);
  assert.equal(b?.vehicle, cars.at(-1));
  assert.ok(b.rear_m > 1.5 && b.rear_m < world.ego.spec.length + 1, `${b.rear_m.toFixed(2)} m past the junction`);
  // (the car's light is green as it comes up, and turns red while the queue is still there)
  for (const t of [4, 10, 20]) { world.t = t; assert.equal(world.phase("sig14").B, "green", `${t} s`); }
  world.t = 26; assert.equal(world.phase("sig14").B, "red");
});

test("with the queue past the junction the car is told to wait at the line on the green, offered the wait, and driving on is rejected", () => {
  const { snap, by, drives } = decide(atSaintDenis());
  const jb = snap.junction_box;
  assert.ok(jb, "junction_box");
  assert.equal(jb.id, "sig14");
  assert.equal(jb.signal, "green");
  near(jb.bumper_to_stop_m, 19, 0.6, "19 m to where it aims to stop, a metre short of the line");
  assert.ok(jb.room_m < jb.need_m);
  assert.ok(by("wait_short_of_junction")?.eligible);
  // (close to the line, it is what stops the car)
  assert.ok(decide(atSaintDenis({ toLine: 1.8, v: 1 })).snap.target.reasons.includes("no room past the junction"));
  assert.ok(drives.length && drives.every((c) => !c.eligible && c.reject === "blocks_junction"), JSON.stringify(drives.map((c) => [c.id, c.reject])));
});

test("with room past the junction, or the queue moving off, the car is not held", () => {
  assert.equal(decide(atSaintDenis({ queue: false })).snap.junction_box, null);
  const ctx = atSaintDenis(), tail = queueOf(ctx).at(-1);
  tail.v = box.QUEUE_MPS + 0.5;
  assert.equal(decide(ctx).snap.junction_box, null, "moving off");
  // (a cyclist past the junction keeps right, and does not count)
  const bike = atSaintDenis({ queue: false }), q = queueOf(atSaintDenis()).at(-1);
  bike.fleet.vehicles.push(Object.assign(new Vehicle(q.x, q.y, q.psi, 0, BIKE), { id: "bike_t", kind: "bike" }));
  assert.equal(decide(bike).snap.junction_box, null, "a cyclist");
});

test("a car barely over the line still waits; one in the junction is committed and drives on", () => {
  const over = decide(atSaintDenis({ toLine: -0.5, v: 0 })).snap.junction_box;
  assert.ok(over && over.bumper_to_stop_m < 0);
  const ctx = atSaintDenis({ toLine: -0.5, v: 0 }), { snap, drives } = decide(ctx);
  assert.ok(drives.every((c) => !c.eligible), "no driving on");
  assert.ok(snap.target.v < 0.1);
  // (its front past the near side of Saint-Denis)
  assert.equal(decide(atSaintDenis({ toLine: -5, v: 0.5 })).snap.junction_box, null);
});

test("decision models and LLMs are told there is no room past the junction, and why to wait", () => {
  const { snap, cands } = decide(atSaintDenis());
  const state = toJevState(snap, cands, {});
  assert.ok(state.junction_box.no_room_past && state.junction_box.stop && state.junction_box.signal === "green");
  assert.ok(state.junction_box.room_past_m < state.junction_box.needs_m);
  const said = situationClauses(snap).join(" ");
  assert.ok(said.includes("never enter a junction the car cannot clear") && said.includes("wait_short_of_junction"), said);
  const q = buildQuestions(snap, cands.filter((c) => c.eligible)).questions;
  assert.ok(q.motion.criteria.stop.includes("junction_box.wait_in_m"));
});

test("the deadlock detector does not override a wait at the line for room", () => {
  const ctx = atSaintDenis({ toLine: 0.5, v: 0 }), snap = buildSnapshot(ctx.world);
  const d = new DeadlockDetector();
  let stuck = 0;
  for (let i = 0; i < 600; i++) stuck = Math.max(stuck, d.update(ctx.world, snap, 0.1));
  assert.equal(stuck, 0);
});

// A traffic car on Mont-Royal coming up to Saint-Denis behind the car's place in the challenge, the car
// itself out of the way, at `t`; `kind`: a car, a cyclist or an ambulance with its siren on.
function trafficAt(kind = "car", t = 6) {
  const ctx = setupChallenge(MONTREAL, CHALLENGE), { world, fleet, autopilot } = ctx;
  autopilot.setEnabled(false);
  world.placeOnLane(MONTREAL.lane("e1", 0), 50); world.t = t;
  const spec = kind === "bike" ? BIKE : kind === "ambulance" ? EMERGENCY_SPECS.ambulance : CAR, s = 15;
  const n = Object.assign(new Vehicle(0, 0, 0, 8, spec), { id: `t_${kind}`, kind, v0: 11, driver: { aMax: 1.5, b: 2, s0: 2, T: 1.2, react: 0.5, lcRate: 0 },
    stopMem: new StopMemory(), frozen: 0, waiting: 0, ...(kind === "ambulance" ? { siren: true } : {}) });
  n.path = new NpcPath(MONTREAL, () => 0.5);
  n.path.start("e191", 0, s, [["e187", 0], ["e179", 0], ["e1", 0]]);
  const p = n.path.offsetPointAt(n.path.s, 0); n.x = p[0]; n.y = p[1]; n.psi = n.path.headingAt(n.path.s);
  fleet.vehicles.push(n);
  return { ...ctx, n };
}

// (traffic stops with its front 2 m short of a line, the driver model's gap at a standstill)
test("traffic waits at the line for room past the junction, even on the green, and goes once the queue has moved off", () => {
  const ctx = trafficAt(), { world, n } = ctx;
  const c = { line: n.path.edges[0].sStart + E191.control.s_line * (n.path.edges[0].sEnd - n.path.edges[0].sStart) / E191.length };
  const nearSide = box.boxStart(MONTREAL, "e191", n.path.edges[0].sEnd);
  let deepest = -Infinity, held = false, through = false;
  for (let i = 0; i < 60 * 70; i++) {
    step(ctx);
    const front = n.path.s + FRONT;
    if (!world.challenge.released) { deepest = Math.max(deepest, front - nearSide); if (n.v < 0.1 && c.line - front > -1 && c.line - front < 3) held = true; }
    if (front > box.boxEnd(MONTREAL, "e191", n.path.edges[0].sEnd) + 5) through = true;
  }
  assert.ok(held, "waited at the line");
  assert.ok(deepest < 0, `${deepest.toFixed(2)} m into the junction`);
  assert.ok(through, "through once there was room");
});

test("a cyclist, and an ambulance with its siren on, are not held", () => {
  for (const kind of ["bike", "ambulance"]) {
    const { world, fleet, n } = trafficAt(kind);
    assert.equal(box.boxHold(MONTREAL, n, n.path.s + n.spec.length - n.spec.rearOverhang, [world.ego, ...fleet.vehicles]), null, kind);
  }
  const { world, fleet, n } = trafficAt("car");
  assert.ok(box.boxHold(MONTREAL, n, n.path.s + FRONT, [world.ego, ...fleet.vehicles]) !== null, "a car");
});

test("the HUD tells the car to wait at the line on the green, and says nothing on the red", () => {
  assert.equal(box.boxNotice(atSaintDenis().world)?.text, "JUNCTION · NO ROOM PAST IT · WAIT AT THE LINE");
  assert.equal(box.boxNotice(atSaintDenis({ t: 30 }).world), null);
  assert.equal(box.boxNotice(atSaintDenis({ queue: false }).world), null);
});

// A free drive in Le Plateau with buses and streetcars: whether traffic ever hits anything or waits for
// ever, and how often a driver other than a bus stands in a signal's junction on its red.
function soak(seconds, seed = 3) {
  const world = new World(MONTREAL, { seed }), fleet = new NpcFleet(world, { count: 40, seed: seed + 6, buses: true });
  const idle = { enabled: false, step() {} }, out = { collisions: 0, maxStill: 0, inBox: 0 }, still = new Map();
  for (let i = 0; i < seconds * 60; i++) {
    stepWorld({ world, fleet, autopilot: idle, input: null }, 1 / 60, world.t * 1000);
    out.collisions += world.events.filter((e) => e.type === "npc_collision").length;
    if (i % 30) continue;
    for (const n of fleet.vehicles) {
      if (!n.path || n.kind === "bike" || n.transit || n.parked) continue;
      const front = n.path.s + n.spec.length - n.spec.rearOverhang;
      const s = n.v < 0.2 && box.boxHold(MONTREAL, n, front, [world.ego, ...fleet.vehicles]) !== null ? (still.get(n.id) || 0) + 0.5 : 0;
      still.set(n.id, s); out.maxStill = Math.max(out.maxStill, s);
      for (const e of n.path.edges) {
        if (e.control?.type !== "signal" || e.sEnd < n.path.s - 25 || e.sEnd > n.path.s + 30) continue;
        if (n.v < 0.3 && front > box.boxStart(MONTREAL, e.id, e.sEnd) + 0.5 && n.path.s - n.spec.rearOverhang < box.boxEnd(MONTREAL, e.id, e.sEnd) && world.phase(e.control.id)[e.control.group] === "red") out.inBox++;
      }
    }
  }
  return out;
}

if (process.env.SKIP_SOAK) console.log("- in a free drive traffic hits nothing, never waits for room for ever, and keeps signals' junctions clear on the red (skipped)");
else test("in a free drive traffic hits nothing, never waits for room for ever, and keeps signals' junctions clear on the red", () => {
  const r = soak(240);
  assert.equal(r.collisions, 0);
  assert.ok(r.maxStill < 120, `waited ${r.maxStill} s for room`);
  assert.equal(r.inBox, 0);
});

// The challenge, closed loop: Rules (or a driver that just follows the car ahead into the junction).
function drive({ follower = false } = {}) {
  const ctx = setupChallenge(MONTREAL, CHALLENGE, { brain: "rules" }), { world, fleet, autopilot } = ctx;
  const route = world.route, score = new DriveScore(world, { route });
  const c = route.controls.find((x) => x.control.id === "sig14"), nearSide = box.boxStart(MONTREAL, c.edge, c.sJunction);
  if (follower) autopilot.setEnabled(false);
  const out = { deepestHeld: -Infinity, waited: false, arrived: false, events: [], safety: 0 };
  for (let i = 0; i < 60 * (follower ? 45 : 150); i++) {
    let input = null;
    if (follower) {
      // (throttle up to 30 km/h, and brake to stop 2 m behind whatever is ahead in its lane)
      const ahead = fleet.vehicles.map((n) => world.ego.toLocal(n.x, n.y)).filter((l) => l.ahead > 0 && Math.abs(l.right) < 1.5).map((l) => l.ahead - CAR.rearOverhang - FRONT - 2);
      const room = Math.min(Infinity, ...ahead), want = Math.min(8.3, Math.sqrt(2 * 2.5 * Math.max(0, room)));
      input = { throttle: world.ego.v < want - 0.3, brake: world.ego.v > want + 0.3 };
    }
    step(ctx, input);
    score.record(world, world._road, 1 / 60);
    out.events.push(...world.events.filter((e) => e.type === "failed_to_yield" || e.type === "collision" || e.type === "red_light"));
    if (autopilot.snap?.junction_box) out.waited = true;
    if (!world.challenge.released) out.deepestHeld = Math.max(out.deepestHeld, route.project(world.ego.x, world.ego.y).s + FRONT - nearSide);
    if (!follower && !autopilot.enabled) { out.arrived = true; break; }
  }
  return { ...out, violations: world.violations, report: score.finish("done"), world };
}

test("Rules waits at the line through the green for room, never enters the junction while the queue is there, and arrives", () => {
  const r = drive();
  assert.ok(r.arrived, "arrived");
  assert.ok(r.waited);
  assert.ok(r.deepestHeld < 0, `${r.deepestHeld.toFixed(2)} m into the junction`);
  assert.deepEqual(r.events, []);
  assert.equal(r.violations.failed_to_yield + r.violations.collisions + r.violations.red_lights_run + r.violations.safety_brakes, 0);
  assert.equal(r.report.blocked_junction, 0);
});

test("a driver who follows the queue into the junction is stuck there when its light turns red: it fails to yield, and is coached", () => {
  const r = drive({ follower: true });
  assert.ok(r.deepestHeld > 0);
  const yields = r.events.filter((e) => e.type === "failed_to_yield");
  assert.equal(yields.length, 1);
  assert.deepEqual([yields[0].to, yields[0].junction, yields[0].blocking], ["cross traffic", "sig14", true]);
  assert.ok(!r.events.some((e) => e.type === "red_light"), "it entered on the green");
  assert.equal(r.report.blocked_junction, 1);
  assert.ok(r.report.incidents.some((i) => i.type === "blocked_junction"));
  assert.ok(r.report.tips.some((t) => t.startsWith("Even on a green, don’t enter a junction")));
});

test("the audit: a car that entered with room past the junction is not failed when its light turns red", () => {
  const ctx = atSaintDenis({ toLine: 2, v: 3, queue: false }), { world } = ctx;
  // (driving in, then braking to a stop 2 m into the junction: a brake held at a standstill reverses)
  const inside = () => world.route.project(world.ego.x, world.ego.y).s + FRONT > box.boxStart(MONTREAL, "e191", world.route.controls[0].sJunction) + 2;
  for (let i = 0; i < 60 * 25; i++) { world.stepManual(1 / 60, inside() ? { brake: world.ego.v > 0.2 } : { throttle: world.ego.v < 3 }); world.t += 1 / 60; world.audit(1 / 60, world.roadInfo()); }
  assert.ok(world.inBox && !world.inBox.noRoom, "standing in it, entered with room");
  assert.equal(world.phase("sig14").B, "red");
  assert.equal(world.violations.failed_to_yield, 0);
});

console.log(`${checks} junction box checks passed`);
process.exit(0);
