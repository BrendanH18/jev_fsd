// Scramble crossings: the all-walk phase in the signal plan, exclusive walks, no right turn on red for
// the driven car or for traffic, people crossing diagonally, the audit, what models and the HUD are
// told, everything exactly as before with the option off, and the "All walk" challenge with Rules
// and the cautious agent.
// node --experimental-default-type=module scripts/test_scrambles.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
globalThis.document = { querySelector: () => null };
const { MapData, pointAt, headingAt } = await import("../static/js/map/mapdata.js");
const { World } = await import("../static/js/sim/world.js");
const { NpcFleet, NpcPath } = await import("../static/js/sim/npc.js");
const { Vehicle, CAR } = await import("../static/js/sim/vehicle.js");
const S = await import("../static/js/sim/signals.js");
const { stepWorld } = await import("../static/js/sim/step.js");
const { rng } = await import("../static/js/common.js");
const { Pedestrian } = await import("../static/js/sim/pedestrians.js");
const { DriveScore } = await import("../static/js/sim/drive-score.js");
const { buildSnapshot } = await import("../static/js/brain/sensors.js");
const { toJevState, situationClauses } = await import("../static/js/brain/state.js");
const { SYSTEM_PROMPT } = await import("../static/js/brain/llm-prompt.js");
const { CHALLENGES } = await import("../static/js/lab/challenges.js");
const { setupChallenge, evaluateChallenge } = await import("../static/js/lab/evaluation.js");

let checks = 0;
async function test(name, fn) { await fn(); checks++; console.log(`✓ ${name}`); }
const root = new URL("../data/maps/", import.meta.url);
const load = (key, layers = ["transit", "crossings", "zones", "rail", "calming", "scrambles", "restrictions"]) => {
  const pack = JSON.parse(fs.readFileSync(new URL(`${key}.v6.pack.json`, root)));
  for (const name of layers) {
    const url = new URL(`${key}.${name}.v1.json`, root);
    if (fs.existsSync(url)) pack[name] = JSON.parse(fs.readFileSync(url));
  }
  pack.utc_offset = -7;
  return new MapData(pack);
};
const VIC = load("d7454a9751b7");
const PLAIN = load("d7454a9751b7", ["transit", "crossings", "zones", "rail", "calming"]);
const step = (ctx) => stepWorld(ctx, 1 / 60, ctx.world.t * 1000);
const idle = { enabled: false, step() {} };
// Government Street at Wharf Street and Humboldt Street, by the Empress: Wharf (group A) is the car's
// approach, turning right onto Government Street southbound.
const SIG = "sig32", WHARF = "e28", GOVT_S = "e145";
const inter = VIC.intersections.get(SIG);
const CH = CHALLENGES.find((c) => c.id === "scramble");

await test("a scramble's plan adds the all-walk to the end of the cycle; the plan of every other signal is as before", () => {
  assert.deepEqual([...VIC.scrambles], [SIG]);
  const sp = inter.scramblePlan, p = inter.plan;
  assert.ok(sp.scramble && !p.scramble);
  assert.deepEqual(sp.A, p.A); assert.deepEqual(sp.B, p.B);
  assert.equal(sp.scramble.start, p.cycle);
  assert.equal(sp.scramble.walk, S.SCRAMBLE_WALK_S);
  assert.ok(sp.scramble.flash >= S.WALK_S);
  assert.equal(sp.cycle, p.cycle + sp.scramble.walk + sp.scramble.flash + sp.scramble.allRed);
  for (const [id, i] of VIC.intersections) if (id !== SIG) assert.equal(i.scramblePlan, undefined, id);
});

await test("with scrambles off every signal, scramble or not, shows exactly what it did without the file", () => {
  new World(VIC, { seed: 1, parked: 0, pedestrians: 0 });
  assert.equal(S.isScramble(inter), false);
  for (const [id, i] of VIC.intersections) {
    const j = PLAIN.intersections.get(id);
    for (let t = 0; t < 200; t += 0.7) {
      for (const a of i.approaches) assert.equal(S.approachPhase(i, a.edge, t), S.approachPhase(j, a.edge, t));
      for (const g of ["A", "B"]) assert.equal(S.pedPhase(i, g, t), S.pedPhase(j, g, t));
      assert.equal(S.secondsToGreen(i, "A", t), S.secondsToGreen(j, "A", t));
    }
    assert.equal(S.scrambleState(i, 0), null);
  }
});

await test("on, every approach is red through the all-walk, and nobody walks alongside a green", () => {
  new World(VIC, { seed: 1, parked: 0, pedestrians: 0, scrambles: true });
  assert.equal(S.isScramble(inter), true);
  const sc = inter.scramblePlan.scramble, c = inter.scramblePlan.cycle;
  let walks = 0;
  for (let t = 0; t < 2 * c; t += 0.25) {
    const u = ((t + inter.offset_s) % c + c) % c, d = u - sc.start, all = d >= 0 && d < sc.walk + sc.flash + sc.allRed;
    const st = S.scrambleState(inter, t);
    for (const a of inter.approaches) if (all) assert.equal(S.approachPhase(inter, a.edge, t), "red", `t=${t}`);
    for (const g of ["A", "B"]) {
      const ped = S.pedPhase(inter, g, t);
      assert.equal(ped, d >= 0 && d < sc.walk ? "walk" : d >= 0 && d < sc.walk + sc.flash ? "flash" : "dont");
      if (ped === "walk") walks++;
    }
    assert.equal(st.phase, d >= 0 && d < sc.walk ? "walk" : d >= 0 && d < sc.walk + sc.flash ? "flash" : "dont");
    if (st.phase === "walk") assert.equal(st.walk_in_s, 0);
  }
  assert.ok(walks > 0);
  new World(VIC, { seed: 1, parked: 0, pedestrians: 0 });
});

// The challenge's car, stopped at Wharf Street's line on red before the all-walk, after a full stop.
async function atTheLine(scrambles) {
  const ctx = setupChallenge(VIC, { ...CH, scrambles });
  ctx.autopilot.setEnabled(false);
  const { world } = ctx;
  const lane = VIC.lane(WHARF, VIC.edges.get(WHARF).lanes - 1), line = VIC.edges.get(WHARF).control.s_line - (CAR.length - CAR.rearOverhang) - 0.5;
  world.placeOnLane(lane, line * lane.length / VIC.edges.get(WHARF).length);
  while (world.t < 16) step({ ...ctx, autopilot: idle });
  return ctx;
}

await test("the driven car is offered no right turn on red at a scramble, and is told so; off, it is", async () => {
  const on = await atTheLine(true), snap = buildSnapshot(on.world, null);
  const i = snap.intersection;
  assert.equal(i.signal, "red");
  assert.equal(i.turn, "right");
  assert.equal(i.right_on_red, null);
  assert.equal(i.scramble.right_on_red, false);
  const state = toJevState(snap, [], {});
  assert.equal(state.intersection.scramble.right_on_red, false);
  assert.ok(situationClauses(snap).some((c) => /scramble crossing.*no right turn on red here/.test(c)));
  assert.match(SYSTEM_PROMPT, /intersection\.scramble/);
  const notice = S.scrambleNotice(on.world);
  assert.equal(notice?.text, "SCRAMBLE CROSSING · NO RIGHT TURN ON RED");
  const off = await atTheLine(false), snap0 = buildSnapshot(off.world, null);
  assert.ok(snap0.intersection.right_on_red, "offered with scrambles off");
  assert.equal("scramble" in snap0.intersection, false);
  assert.equal(S.scrambleNotice(off.world), null);
});

await test("during the all-walk the car is told every light is red and people cross every way", async () => {
  const ctx = await atTheLine(true);
  while (S.scrambleState(inter, ctx.world.t).phase !== "walk") step({ ...ctx, autopilot: idle });
  const snap = buildSnapshot(ctx.world, null);
  assert.equal(snap.intersection.scramble.phase, "walk");
  assert.equal(toJevState(snap, [], {}).intersection.scramble.all_walk, true);
  assert.ok(situationClauses(snap).some((c) => /all-walk is on: every light is red/.test(c)));
  assert.equal(S.scrambleNotice(ctx.world)?.text, "SCRAMBLE CROSSING · ALL WALK · EVERY LIGHT RED");
});

await test("turning right on red at a scramble is a red light, flagged, and coached; off, it is legal after a stop", async () => {
  for (const scrambles of [true, false]) {
    const ctx = await atTheLine(scrambles), { world } = ctx, score = new DriveScore(world, { title: "t" });
    // (a full stop at the line, then round the corner by hand on red)
    const lane = VIC.lane(WHARF, VIC.edges.get(WHARF).lanes - 1);
    let s = world.route.project(world.ego.x, world.ego.y).s;
    for (let k = 0; k < 60 * 4 && S.approachPhase(inter, WHARF, world.t) === "red"; k++) {
      s += 4 / 60;
      const p = world.route.pointAt(s), h = world.route.headingAt(s);
      Object.assign(world.ego, { x: p[0], y: p[1], psi: h, v: 4 });
      score.record(world, step({ ...ctx, autopilot: idle }), 1 / 60);
    }
    if (scrambles) {
      assert.equal(world.violations.red_lights_run, 1);
      assert.ok(score.snapshot().tips.some((t) => /scramble crossing there is no right turn on red/.test(t)));
    } else assert.equal(world.violations.red_lights_run, 0);
    assert.equal(lane.edge, WHARF);
  }
});

await test("traffic waits for the green at a scramble instead of turning right on red; off, it turns on red", async () => {
  for (const scrambles of [true, false]) {
    const world = new World(VIC, { seed: 2, parked: 0, pedestrians: 0, scrambles });
    const fleet = new NpcFleet(world, { count: 0, bikes: 0, seed: 3 });
    world.placeOnLane(VIC.lane("e185", 0), 40);   // (the car out of the way)
    const lane = VIC.lane(WHARF, VIC.edges.get(WHARF).lanes - 1), sStart = 5, p = pointAt(lane.pts, lane.cum, sStart);
    const car = new Vehicle(p[0], p[1], headingAt(lane.pts, lane.cum, sStart), 0, CAR);
    Object.assign(car, { id: "rtor", kind: "car", color: 0x777777, v0: 11, driver: { aMax: 1.5, b: 2, s0: 2, T: 1.2, react: 0.8, lcRate: 0 },
      stopMem: new S.StopMemory(), path: new NpcPath(VIC, rng(4)), frozen: 0, waiting: 0 });
    car.path.start(WHARF, lane.idx, sStart, [[GOVT_S, 0]]);
    fleet.vehicles.push(car);
    // (from 14 s, on red, until the car's approach turns green again)
    while (world.t < 14) { world.t += 1 / 60; }
    let turnedOnRed = false;
    for (let k = 0; k < 60 * 60; k++) {
      step({ world, fleet, autopilot: idle });
      if (car.path.currentEdge().id === GOVT_S && S.approachPhase(inter, WHARF, world.t) === "red") turnedOnRed = true;
    }
    assert.equal(turnedOnRed, !scrambles, `scrambles ${scrambles}`);
  }
});

await test("at a scramble some people at a corner cross diagonally, on the all-walk; off, nobody does", () => {
  for (const scrambles of [true, false]) {
    const world = new World(VIC, { seed: 7, parked: 0, pedestrians: 0, scrambles });
    const node = [...VIC.junctionNodes(inter)].find((n) => world.crowd.legsAt.get(n)?.inter === inter);
    const info = world.crowd.legsAt.get(node), leg = info.list[0];
    let diagonal = 0;
    for (let k = 0; k < 60; k++) {
      const [x, y] = leg.ends[1];
      const ped = new Pedestrian({ id: `p${k}`, x, y, psi: 0, v: 0, speed: 1.3, path: [], crossing: null, waiting: 0, phase: 0, look: k,
        at: { node, st: leg.st, side: 1, s: leg.s, dir: leg.out ? -1 : 1 } });
      world.crowd.plan(ped);
      const cross = ped.path.find((w) => w.cross)?.cross;
      if (cross?.diagonal) {
        diagonal++;
        assert.ok(Math.hypot(cross.to[0] - cross.from[0], cross.to[1] - cross.from[1]) > 10);
        assert.equal(world.crowd.mayCross(cross, 0), S.pedPhase(inter, "A", 0) === "walk");
      }
    }
    if (scrambles) assert.ok(diagonal > 10 && diagonal < 40, `${diagonal} of 60`);
    else assert.equal(diagonal, 0);
  }
  new World(VIC, { seed: 1, parked: 0, pedestrians: 0 });
});

await test("All walk: Rules and the cautious agent wait through the scramble, let the slow walker finish, and turn on green", async () => {
  assert.ok(CH && CH.scrambles);
  for (const brain of ["rules", "cautious"]) {
    const r = await evaluateChallenge(VIC, CH, { brain });
    assert.equal(r.pass, true, `${brain}: ${r.failures}`);
    assert.equal(r.red_lights, 0);
    assert.equal(r.collisions, 0);
    assert.ok(r.time_s > 66, `${brain} arrived at ${r.time_s} s: it should have waited for the green`);
  }
  // (and with the scramble off, Rules turns right on red at once: it is the scramble that holds it)
  const off = await evaluateChallenge(VIC, { ...CH, scrambles: false }, { brain: "rules" });
  assert.ok(off.pass && off.time_s < 60, `${off.time_s}`);
});

console.log(`${checks} checks passed`);
process.exit(0);
