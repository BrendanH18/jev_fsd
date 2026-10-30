// Advance greens and left-turn arrows: which junctions get one and how it shows by province, each
// approach's lights through a cycle, the walk alongside it held back, traffic turning left on the arrow
// while traffic going straight waits, a right turn on red held while the approach opposite has one,
// sensing (the light for the car's own movement, a protected left), what models are told, the audit,
// the HUD, and the "Not your arrow" challenge with Rules, the cautious agent, and a driver who goes with
// the cars turning left.
// node --experimental-default-type=module scripts/test_advance_green.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
globalThis.document = { querySelector: () => null };
const { MapData } = await import("../static/js/map/mapdata.js");
const { Route } = await import("../static/js/map/route.js");
const { routeFromLanes } = await import("../static/js/demo/routing.js");
const { Vehicle, CAR } = await import("../static/js/sim/vehicle.js");
const { NpcFleet, NpcPath } = await import("../static/js/sim/npc.js");
const signals = await import("../static/js/sim/signals.js");
const { stepWorld } = await import("../static/js/sim/step.js");
const { buildSnapshot } = await import("../static/js/brain/sensors.js");
const { sampleCandidates, simulateAll } = await import("../static/js/brain/candidates.js");
const { toJevState, situationClauses } = await import("../static/js/brain/state.js");
const { CHALLENGES } = await import("../static/js/lab/challenges.js");
const { setupChallenge, evaluateChallenge } = await import("../static/js/lab/evaluation.js");
const { approachPhase, movementSignal, protectedLeft, advanceStyle, advanceHolds, secondsToGreen, pedPhase, advanceNotice, ADVANCE_S, ADVANCE_CLEAR_S, StopMemory } = signals;

let checks = 0;
function test(name, fn) { fn(); checks++; console.log(`✓ ${name}`); }
async function testAsync(name, fn) { await fn(); checks++; console.log(`✓ ${name}`); }
const root = new URL("../data/maps/", import.meta.url);
const KEYS = { kitsilano: "623b012bc8b5", mount_pleasant: "7165f1c807a8", victoria: "d7454a9751b7", montreal: "bb9df59633e0", toronto: "4a96d42cb3f2", ottawa: "d25b07def0d2",
  calgary: "a53c5bcf6438", edmonton: "3e794edbefcb", winnipeg: "19bb885c9cae", halifax: "49db0d437c8c", saskatoon: "ca5573a8d934", quebec_city: "8e99888cb743" };
const load = (key) => {
  const pack = JSON.parse(fs.readFileSync(new URL(`${key}.v6.pack.json`, root)));
  for (const name of ["transit", "crossings", "zones", "rail"]) {
    const url = new URL(`${key}.${name}.v1.json`, root);
    if (fs.existsSync(url)) pack[name] = JSON.parse(fs.readFileSync(url));
  }
  return new MapData(pack);
};
const MAPS = Object.fromEntries(Object.entries(KEYS).map(([id, key]) => [id, load(key)]));
const WINNIPEG = MAPS.winnipeg, OTTAWA = MAPS.ottawa;
const CHALLENGE = CHALLENGES.find((c) => c.id === "left-arrow");
const FRONT = CAR.length - CAR.rearOverhang;
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);
const step = (ctx, input = null) => stepWorld({ ...ctx, input }, 1 / 60, ctx.world.t * 1000);
// (Isabel Street northbound at William Avenue: its left arrow from 25 s to 33 s, yellow to 36 s, red
// to 37 s, then the whole group green to 62.5 s; Isabel southbound, opposite, red until 37 s)
const SIG16 = WINNIPEG.intersections.get("sig16"), ISABEL = "e272", OPPOSITE = "e482";
const sequence = (inter, edge, until = inter.plan.cycle) => {
  const out = []; let prev = null;
  for (let t = 0; t < until; t += 0.5) { const s = approachPhase(inter, edge, t); if (s !== prev) { out.push([t, s]); prev = s; } }
  return out;
};

test("advance greens show as a flashing green in Ontario and Québec, and as a left arrow everywhere else (never a flashing green in BC)", () => {
  for (const id of ["toronto", "ottawa", "montreal", "quebec_city"]) assert.equal(MAPS[id].advanceStyle, "flash", id);
  for (const id of ["kitsilano", "mount_pleasant", "victoria", "calgary", "edmonton", "winnipeg", "halifax", "saskatoon"]) assert.equal(MAPS[id].advanceStyle, "arrow", id);
  // (Gatineau, across the river from Ottawa; Moncton, New Brunswick; Kelowna, BC)
  assert.equal(advanceStyle([-75.75, 45.47, -75.7, 45.49]), "flash");
  assert.equal(advanceStyle([-64.8, 46.08, -64.76, 46.1]), "arrow");
  assert.equal(advanceStyle([-119.5, 49.87, -119.48, 49.89]), "arrow");
  assert.equal(advanceStyle(null), "arrow");
});

test("an advance goes to one multi-lane approach on a major street with one opposite it and a left turn, where another crosses, and is the same every time", () => {
  let total = 0;
  for (const [id, map] of Object.entries(MAPS)) {
    for (const inter of map.intersections.values()) {
      const adv = inter.plan.advance;
      if (!adv) continue;
      total++;
      const e = map.edges.get(adv.edge), a = inter.approaches.find((x) => x.edge === adv.edge);
      assert.ok(["primary", "secondary"].includes(e.cls) && e.lanes >= 2, `${id} ${inter.id}`);
      assert.equal(a.group, adv.group);
      assert.equal(adv.style, map.advanceStyle);
      assert.ok(inter.approaches.some((o) => o.group === adv.group && o.edge !== adv.edge && Math.abs(Math.abs(((o.heading_deg - a.heading_deg + 540) % 360) - 180)) > 150), `${id} ${inter.id}: one opposite`);
      assert.ok(map.successors(e.id).some((x) => map.classifyTurn(map.turnAngle(e.id, x)) === "left"));
      assert.ok(inter.approaches.some((o) => o.group !== adv.group && ["primary", "secondary"].includes(map.edges.get(o.edge).cls) && map.edges.get(o.edge).lanes >= 2), `${id} ${inter.id}: crossed by another`);
    }
  }
  assert.ok(total >= 40, `${total} advances`);
  // (Saint-Roch has none; built again, a map gets the same ones)
  assert.ok([...MAPS.quebec_city.intersections.values()].every((i) => !i.plan.advance));
  const again = load(KEYS.ottawa);
  assert.deepEqual([...again.intersections.values()].map((i) => i.plan), [...OTTAWA.intersections.values()].map((i) => i.plan));
});

test("the advance adds itself and its clearance to its group's green and the cycle; the other group keeps its green", () => {
  // (the same junction without one: a map that cannot say where the turns go gives none)
  const plan = SIG16.plan, plain = signals.timingPlan(SIG16, { edges: WINNIPEG.edges });
  assert.deepEqual(plan.advance, { edge: ISABEL, group: "A", length: ADVANCE_S, clear: ADVANCE_CLEAR_S, style: "arrow" });
  assert.equal(plain.advance, undefined);
  assert.equal(plan.cycle, plain.cycle + ADVANCE_S + ADVANCE_CLEAR_S);
  assert.equal(plan.A.green, Math.round((plain.A.green + 12) * 10) / 10);
  assert.equal(plan.B.green, plain.B.green);
});

test("a left arrow: green for the turn while the approach opposite waits on red, then 3 s of yellow and 1 s of red, then the whole group's green", () => {
  assert.deepEqual(sequence(SIG16, ISABEL), [[0, "red"], [25, "arrow"], [33, "arrow_yellow"], [36, "red"], [37, "green"], [62.5, "yellow"], [65.5, "red"]]);
  assert.deepEqual(sequence(SIG16, OPPOSITE), [[0, "red"], [37, "green"], [62.5, "yellow"], [65.5, "red"]]);
  // (the street across goes as it did; the group view still says A is green from 25 s)
  assert.equal(signals.phaseOf(SIG16, 30).A, "green");
  assert.equal(approachPhase(SIG16, "e342", 10), "green");
  // (under the arrow only the turn goes)
  assert.equal(movementSignal("arrow", "left"), "green"); assert.equal(movementSignal("arrow", "uturn"), "green");
  assert.equal(movementSignal("arrow", "straight"), "red"); assert.equal(movementSignal("arrow", "right"), "red");
  assert.equal(movementSignal("arrow_yellow", "left"), "yellow"); assert.equal(movementSignal("arrow_yellow", "straight"), "red");
  assert.ok(protectedLeft("arrow", "left") && !protectedLeft("arrow", "straight") && !protectedLeft("arrow_yellow", "left") && !protectedLeft("green", "left"));
  // (until the car's own movement turns green)
  near(secondsToGreen(SIG16, "A", 20, ISABEL, "left"), 5, 0.2, "to the arrow");
  near(secondsToGreen(SIG16, "A", 20, ISABEL, "straight"), 17, 0.2, "to the green going straight");
  assert.equal(secondsToGreen(SIG16, "A", 30, ISABEL, "left"), 0);
  near(secondsToGreen(SIG16, "A", 30, OPPOSITE, "straight"), 7, 0.2, "opposite");
  assert.equal(secondsToGreen(SIG16, "A", 30), 0, "the group's green");
});

test("a flashing green: any way goes, steady through its clearance, while the approach opposite waits on red", () => {
  const inter = [...OTTAWA.intersections.values()].find((i) => i.plan.advance), adv = inter.plan.advance;
  assert.equal(adv.style, "flash");
  const opposite = inter.approaches.find((a) => a.group === adv.group && a.edge !== adv.edge).edge;
  const mine = sequence(inter, adv.edge), start = mine.find(([, s]) => s === "advance")[0];
  assert.deepEqual(mine.filter(([t]) => t >= start).slice(0, 2), [[start, "advance"], [start + ADVANCE_S, "green"]]);
  assert.equal(approachPhase(inter, adv.edge, start + ADVANCE_S + ADVANCE_CLEAR_S - 0.5), "green");
  for (const dt of [0, 5, ADVANCE_S + 1]) assert.equal(approachPhase(inter, opposite, start + dt), "red", `${dt} s in`);
  assert.equal(approachPhase(inter, opposite, start + ADVANCE_S + ADVANCE_CLEAR_S + 0.5), "green");
  for (const turn of ["left", "straight", "right"]) assert.equal(movementSignal("advance", turn), "green");
  assert.ok(protectedLeft("advance", "left") && !protectedLeft("advance", "straight"));
});

test("people walking alongside a group led by an advance start their walk once it is over", () => {
  assert.equal(pedPhase(SIG16, "A", 26), "dont");
  assert.equal(pedPhase(SIG16, "A", 36.5), "dont");
  assert.equal(pedPhase(SIG16, "A", 37.5), "walk");
  assert.equal(pedPhase(SIG16, "A", 44.5), "flash");
  assert.equal(pedPhase(SIG16, "B", SIG16.plan.B.start + 1 - (SIG16.offset_s || 0) + SIG16.plan.cycle), "walk", "the other group's walk as ever");
});

test("a right turn on red waits while the approach opposite has its advance and clearance", () => {
  assert.ok(advanceHolds(SIG16, OPPOSITE, 26) && advanceHolds(SIG16, OPPOSITE, 36.5));
  assert.ok(!advanceHolds(SIG16, OPPOSITE, 37.5) && !advanceHolds(SIG16, OPPOSITE, 20));
  assert.ok(!advanceHolds(SIG16, ISABEL, 26), "not the approach with it");
  assert.ok(!advanceHolds(SIG16, "e342", 26), "not the street across");
});

// The challenge's world (the car in the right lane of Isabel Street, going straight on, or on `route`
// from the left lane), its car placed with its front `toLine` metres short of the line at `v`, at `t`
// seconds.
function atIsabel({ toLine = 1.5, v = 0, t = 26, route = null } = {}) {
  const ctx = setupChallenge(WINNIPEG, CHALLENGE), { world } = ctx;
  const e = WINNIPEG.edges.get(ISABEL), lane = WINNIPEG.lane(ISABEL, route ? 0 : e.lanes - 1);
  // (turning left, from the left lane: the cars waiting there to turn are taken off)
  if (route) {
    world.route = new Route(route, WINNIPEG, world.ego.spec);
    for (const id of world.challenge.turnerIds) ctx.fleet.vehicles.splice(ctx.fleet.vehicles.findIndex((n) => n.id === id), 1);
  }
  world.placeOnLane(lane, e.control.s_line * lane.length / e.length - toLine - FRONT);
  world.ego.v = v; world.t = t; world.egoStop = new StopMemory();
  return ctx;
}
const leftRoute = () => {
  const left = WINNIPEG.successors(ISABEL).find((x) => WINNIPEG.classifyTurn(WINNIPEG.turnAngle(ISABEL, x)) === "left");
  return routeFromLanes(WINNIPEG, [WINNIPEG.lane(ISABEL, 0), WINNIPEG.lane(left, 0)], 20, 80);
};
const decide = (ctx) => {
  const snap = buildSnapshot(ctx.world), cands = sampleCandidates(snap, ctx.world);
  simulateAll(cands, snap, ctx.world);
  return { snap, cands, by: (id) => cands.find((c) => c.id === id), drives: cands.filter((c) => c.id === "keep_lane_limit" || c.id === "keep_lane_hold") };
};
// An oncoming car coming down Isabel Street southbound, `back` metres short of its line at `v`.
function oncoming(ctx, back, v) {
  const e = WINNIPEG.edges.get(OPPOSITE), lane = WINNIPEG.lane(OPPOSITE, 0), s = e.control.s_line * lane.length / e.length - back;
  const n = new Vehicle(0, 0, 0, v);
  Object.assign(n, { id: "oncoming_t", v0: 11, driver: { aMax: 1.5, b: 2, s0: 2, T: 1.2, react: 0.5, lcRate: 0 }, stopMem: new StopMemory(), path: new NpcPath(WINNIPEG, ctx.fleet.random), frozen: 0, waiting: 0 });
  n.path.start(OPPOSITE, 0, s);
  const [px, py] = n.path.offsetPointAt(n.path.s, 0); n.x = px; n.y = py; n.psi = n.path.headingAt(n.path.s);
  ctx.fleet.vehicles.push(n);
  return n;
}

test("going straight on, the car's light is red under the arrow: it is told so, offered the stop, and driving on at the limit runs the red", () => {
  const { snap, by } = decide(atIsabel({ toLine: 25, v: 8 }));
  const i = snap.intersection;
  assert.equal(i.id, "sig16"); assert.equal(i.turn, "straight");
  assert.equal(i.signal, "red");
  assert.deepEqual(i.advance, { light: "left_arrow", protected: false });
  near(i.seconds_to_green, 11, 0.2, "to its green");
  assert.ok(by("stop_at_line")?.eligible);
  assert.equal(by("keep_lane_limit")?.reject, "runs_red");
  const said = situationClauses(snap).join(" ");
  assert.match(said, /green left arrow shows, for left turns only/);
  assert.match(said, /do not go with the cars turning left beside it/);
  assert.deepEqual(toJevState(snap, [], {}).intersection.advance, { light: "left_arrow" });
  // (and once the arrow turns yellow, its light is still red; at the group's green it goes)
  assert.equal(decide(atIsabel({ t: 34 })).snap.intersection.signal, "red");
  const green = decide(atIsabel({ t: 38 }));
  assert.equal(green.snap.intersection.signal, "green"); assert.equal(green.snap.intersection.advance, null);
});

test("turning left on the arrow, the turn is protected: green, no waiting for oncoming traffic, and models are told so", () => {
  const ctx = atIsabel({ route: leftRoute(), toLine: 10, v: 6 });
  oncoming(ctx, 30, 0);
  const { snap, by } = decide(ctx);
  const i = snap.intersection;
  assert.equal(i.turn, "left"); assert.equal(i.signal, "green");
  assert.deepEqual(i.advance, { light: "left_arrow", protected: true });
  assert.equal(i.oncoming, null);
  assert.ok(by("keep_lane_limit")?.eligible || by("keep_lane_hold")?.eligible);
  assert.match(situationClauses(snap).join(" "), /left turn is protected, and oncoming traffic is held on red/);
  assert.deepEqual(toJevState(snap, [], {}).intersection.advance, { light: "left_arrow", protected_left: true });
  // (on the yellow arrow it is told the protection is ending; on the group's green it yields again)
  const yellow = decide(atIsabel({ route: leftRoute(), toLine: 25, v: 8, t: 34 })).snap;
  assert.equal(yellow.intersection.signal, "yellow");
  assert.match(situationClauses(yellow).join(" "), /left arrow has turned yellow/);
  const after = atIsabel({ route: leftRoute(), toLine: 1, v: 0, t: 40 });
  oncoming(after, 25, 11);
  assert.equal(decide(after).snap.intersection.advance, null);
  assert.ok(decide(after).snap.intersection.oncoming, "yields to oncoming traffic on the plain green");
});

test("on the approach opposite, the car is held: told why, and a right turn on red waits for the advance to end", () => {
  const right = WINNIPEG.successors(OPPOSITE).find((x) => WINNIPEG.classifyTurn(WINNIPEG.turnAngle(OPPOSITE, x)) === "right");
  const ctx = setupChallenge(WINNIPEG, CHALLENGE), { world } = ctx;
  for (const id of world.challenge.turnerIds) ctx.fleet.vehicles.splice(ctx.fleet.vehicles.findIndex((n) => n.id === id), 1);
  const e = WINNIPEG.edges.get(OPPOSITE), lane = WINNIPEG.lane(OPPOSITE, e.lanes - 1);
  world.route = new Route(routeFromLanes(WINNIPEG, [lane, WINNIPEG.lane(right, WINNIPEG.edges.get(right).lanes - 1)], 30, 40), WINNIPEG, world.ego.spec);
  world.placeOnLane(lane, e.control.s_line * lane.length / e.length - 1 - FRONT);
  world.ego.v = 0; world.t = 24;
  for (let k = 0; k < 90; k++) step(ctx);   // (a full stop at the line, on the red)
  world.t = 27;
  const { snap } = decide(ctx);
  assert.equal(snap.intersection.signal, "red");
  assert.deepEqual(snap.intersection.advance, { light: "held", protected: false });
  assert.deepEqual(snap.intersection.right_on_red.wait_for, { kind: "advance" });
  assert.equal(snap.intersection.right_on_red.go, false);
  assert.match(situationClauses(snap).join(" "), /approach opposite has an advance green, and its protected left turns/);
});

test("traffic turns left on the arrow without waiting, while traffic going straight beside it waits for its green", () => {
  const ctx = setupChallenge(WINNIPEG, CHALLENGE), { world, fleet } = ctx;
  ctx.autopilot.setEnabled(false);
  const e = WINNIPEG.edges.get(ISABEL), lane = WINNIPEG.lane(ISABEL, e.lanes - 1);
  world.placeOnLane(WINNIPEG.lane(ISABEL, e.lanes - 1), 5);
  const through = new Vehicle(0, 0, 0, 0);
  Object.assign(through, { id: "through_t", v0: 11, driver: { aMax: 1.5, b: 2, s0: 2, T: 1.2, react: 0.5, lcRate: 0 }, stopMem: new StopMemory(), path: new NpcPath(WINNIPEG, fleet.random), frozen: 0, waiting: 0 });
  const ahead = WINNIPEG.successors(ISABEL).find((x) => WINNIPEG.classifyTurn(WINNIPEG.turnAngle(ISABEL, x)) === "straight");
  through.path.start(ISABEL, e.lanes - 1, e.control.s_line * lane.length / e.length - 1 - FRONT, [[ahead, WINNIPEG.edges.get(ahead).lanes - 1]]);
  [through.x, through.y] = through.path.offsetPointAt(through.path.s, 0); through.psi = through.path.headingAt(through.path.s);
  fleet.vehicles.push(through);
  const turner = () => fleet.vehicles.find((n) => n.id === "challenge_turner_1");
  const from = [through.x, through.y], moved = () => Math.hypot(through.x - from[0], through.y - from[1]);
  while (world.t < 32) step(ctx, { throttle: 0, brake: 1, steer: 0 });
  assert.ok(turner().v > 2, `the first turner moving at ${turner().v.toFixed(1)} m/s`);
  assert.ok(moved() < 1.5, `straight on waits: ${moved().toFixed(2)} m`);
  while (world.t < 42) step(ctx, { throttle: 0, brake: 1, steer: 0 });
  assert.ok(moved() > 5, "and goes on its green");
});

test("the HUD says whether the arrow is the car's light, or its turn is protected", () => {
  const straight = atIsabel({ toLine: 20, v: 5 });
  assert.deepEqual(advanceNotice(straight.world), { key: "sig16:arrow", text: "LEFT ARROW · NOT YOUR LIGHT · WAIT FOR GREEN", protected: false });
  assert.equal(advanceNotice(atIsabel({ t: 20 }).world), null, "no arrow yet");
  const left = atIsabel({ route: leftRoute(), toLine: 20, v: 5 });
  assert.deepEqual(advanceNotice(left.world), { key: "sig16:arrow", text: "LEFT ARROW · TURN PROTECTED", protected: true });
});

await testAsync("challenge: Isabel Street at William Avenue, a red, the arrow for the cars beside the car; Rules and the cautious agent wait for their own green", async () => {
  const { world, scenario } = setupChallenge(WINNIPEG, CHALLENGE);
  assert.equal(scenario.start.edge, ISABEL);
  assert.equal(scenario.start.lane, 1);
  assert.equal(scenario.leftArrow.signal, "sig16");
  assert.equal(world.route.controls.find((c) => c.control.id === "sig16").turn, "straight");
  assert.equal(world.challenge.turnerIds.length, 3);
  for (const brain of ["rules", "cautious"]) {
    const result = await evaluateChallenge(WINNIPEG, CHALLENGE, { brain });
    assert.ok(result.pass, `${brain}: ${JSON.stringify(result.failures)}`);
    assert.ok(result.events.some((e) => e.type === "hazard"));
  }
});

test("a driver who goes with the cars turning left runs the red", () => {
  const ctx = setupChallenge(WINNIPEG, CHALLENGE), { world } = ctx;
  // (Rules to the line; on the arrow, straight on at a walking pace)
  while (world.t < 25.5) step(ctx);
  ctx.autopilot.setEnabled(false);
  while (world.t < 40 && Math.hypot(world.ego.x - SIG16.x, world.ego.y - SIG16.y) < 20 || world.t < 30) step(ctx, { throttle: world.ego.v < 4 ? 0.4 : 0, brake: 0, steer: 0 });
  assert.equal(world.violations.red_lights_run, 1);
  assert.equal(world.violations.collisions, 0);
  // (and a car turning left on the arrow does not)
  const left = atIsabel({ route: leftRoute(), toLine: 3, v: 3 });
  left.world.autopilot = left.autopilot;
  for (let k = 0; k < 60 * 10; k++) step(left);
  assert.equal(left.world.violations.red_lights_run, 0);
  assert.ok(Math.hypot(left.world.ego.x - SIG16.x, left.world.ego.y - SIG16.y) > 15, "through the turn");
});

test("a car that crossed on an arrow is judged on its way out of the junction, however wide: a left turn is fine, straight on is a red", () => {
  const ctx = setupChallenge(WINNIPEG, CHALLENGE), { world } = ctx, ego = world.ego;
  const put = (x, y, psi) => { ego.x = x; ego.y = y; ego.psi = psi; world.auditArrow(); };
  for (const [exit, runs] of [[Math.PI / 2, 0], [0, 1]]) {
    const before = world.violations.red_lights_run;
    // (crossing the line 20 m short of a wide junction's centre, facing straight on along +x)
    world.arrowCheck = { id: "sig16", centre: [20, 0], approach: 0, stopped: false };
    put(0, 0, 0);
    assert.equal(world.violations.red_lights_run, before, "not judged before it is in the junction");
    put(15, 0, exit / 2);
    put(20 + 20 * Math.cos(exit), 20 * Math.sin(exit), exit);
    assert.equal(world.violations.red_lights_run - before, runs, exit ? "turned left" : "went straight on");
    assert.equal(world.arrowCheck, null);
  }
});

console.log(`\n${checks} advance green checks passed`);
process.exit(0);
