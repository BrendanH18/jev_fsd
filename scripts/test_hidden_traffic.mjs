// Hidden traffic (sim/hidden-traffic.js): with hidden hazards on, road vehicles hide other vehicles and
// cyclists from the driven car; turning left it waits until it can see along the oncoming lanes, giving
// way it waits for a vehicle hiding the street it crosses to move, and it turns right on red only when
// no vehicle hides the street to its left. What models are told, the HUD, coaching, and the "Blind
// left" challenge, where a van waiting to turn left opposite hides a car coming straight through. With
// hazards off (the default, the seeded benchmark and every other challenge but one) nothing changes.
// node --experimental-default-type=module scripts/test_hidden_traffic.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
globalThis.document = { querySelector: () => null };
const { MapData, joinLanes, cumulative, pointAt } = await import("../static/js/map/mapdata.js");
const { Route } = await import("../static/js/map/route.js");
const { World } = await import("../static/js/sim/world.js");
const { NpcFleet } = await import("../static/js/sim/npc.js");
const { Vehicle, CAR, BIKE, DELIVERY_VAN } = await import("../static/js/sim/vehicle.js");
const { stepWorld } = await import("../static/js/sim/step.js");
const { setWeather } = await import("../static/js/sim/weather.js");
const T = await import("../static/js/sim/hidden-traffic.js");
const { DriveScore } = await import("../static/js/sim/drive-score.js");
const { buildSnapshot } = await import("../static/js/brain/sensors.js");
const { toJevState, situationClauses } = await import("../static/js/brain/state.js");
const { SYSTEM_PROMPT } = await import("../static/js/brain/llm-prompt.js");
const { Autopilot } = await import("../static/js/brain/brain.js");
const { CHALLENGES, challengeScenario } = await import("../static/js/lab/challenges.js");
const { setupChallenge, evaluateChallenge } = await import("../static/js/lab/evaluation.js");

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
const BLIND = CHALLENGES.find((c) => c.id === "blind-left");

// Two-way streets crossing at the origin, one lane each way 3.2 m wide, a stop sign on the arm from the
// west (line 8 m before the centre). The car comes from the west along y = -1.6, going straight on.
const ARM = 150, LINE = ARM - 8, HALF = 1.6;
const ARMS = { w: 180, e: 0, n: 90, s: -90 };
function junction() {
  const ends = { c: [0, 0] }, edges = [], lanes = [], stops = [];
  for (const [arm, deg] of Object.entries(ARMS)) ends[arm] = [ARM * Math.cos(deg * Math.PI / 180), ARM * Math.sin(deg * Math.PI / 180)].map((v) => Math.round(v * 1e6) / 1e6);
  for (const arm of Object.keys(ARMS)) for (const [id, from, to, inbound] of [[`${arm}_in`, arm, "c", true], [`${arm}_out`, "c", arm, false]]) {
    const pts = [ends[from], ends[to]], dx = pts[1][0] - pts[0][0], dy = pts[1][1] - pts[0][1], d = Math.hypot(dx, dy), rx = dy / d, ry = -dx / d;
    const signed = inbound && arm === "w";
    if (signed) stops.push({ id: "stop_w", edge: id, s_line: LINE, all_way: false, junction: "c" });
    edges.push({ id, from, to, pts, length: ARM, lanes: 1, lane_width: 3.2, lane_offsets: [HALF], asphalt: [-3.2, 3.2], parking: [0, 0], cls: "residential", limit: 11.1, oneway: false,
      name: arm === "w" || arm === "e" ? "West Street" : "North Street", ...(signed ? { control: { type: "stop", id: "stop_w", s_line: LINE, all_way: false } } : {}) });
    lanes.push({ edge: id, idx: 0, pts: pts.map(([x, y]) => [x + rx * HALF, y + ry * HALF]) });
  }
  return new MapData({ bbox: [0, 0, 1, 1], extent: [-ARM - 20, -ARM - 20, ARM + 20, ARM + 20], edges, lanes,
    nodes: Object.entries(ends).map(([id, [x, y]]) => ({ id, x, y })), intersections: [], stops, buildings: [] });
}
function resample(pts) {
  const cum = cumulative(pts), out = [];
  for (let s = 0; s < cum.at(-1); s += 1) out.push(pointAt(pts, cum, s));
  out.push(pts.at(-1));
  return out;
}
// The car stopped with its front at x = `front` on the arm from the west, its stop made, and its route
// straight on across.
function atStop(map, { hazards = true, front = -6.6 } = {}) {
  setWeather("dry");
  const world = new World(map, { parked: 0, pedestrians: 0, hazards });
  const FRONT = world.ego.spec.length - world.ego.spec.rearOverhang;
  Object.assign(world.ego, { x: front - FRONT, y: -HALF, psi: 0, v: 0 });
  world.route = new Route({ id: "r", polyline: resample(joinLanes(map.lane("w_in", 0).pts, map.lane("e_out", 0).pts)), edges: ["w_in", "e_out"], turns: [], start_s: 0, goal_s: 250 }, map);
  world.route.project(world.ego.x, world.ego.y);
  world._road = world.roadInfo();
  world.egoStop = { controlId: "stop_w", completed: true };
  return world;
}
const car = (id, x, y, psi, v = 0, spec = CAR) => Object.assign(new Vehicle(x, y, psi, v, spec), { id });

await test("with hazards on, a vehicle in traffic hides a car or a cyclist behind it; a parked car does not, a double-parked van does; with hazards off nothing hides them", () => {
  const map = junction();
  for (const hazards of [true, false]) {
    const world = atStop(map, { hazards }), ego = world.ego;
    // straight ahead along West Street: a van stopped in the car's lane 15 m ahead, a car and a cyclist 30 m ahead behind it
    const van = car("van", ego.x + 15, -HALF, 0, 0, DELIVERY_VAN), hidden = car("hidden", ego.x + 30, -HALF, Math.PI, 8), bike = Object.assign(car("bike", ego.x + 26, -HALF, 0, 4, BIKE), { kind: "bike" });
    world.npcs.push(van, hidden, bike);
    assert.equal(world.sees(ego, hidden), !hazards, `hidden car, hazards ${hazards}`);
    assert.equal(world.sees(ego, bike), !hazards, `hidden cyclist, hazards ${hazards}`);
    assert.equal(world.sees(ego, van), true);
    // (a cyclist hides nothing)
    world.npcs.splice(world.npcs.indexOf(van), 1);
    const small = Object.assign(car("bike2", ego.x + 15, -HALF, 0, 4, BIKE), { kind: "bike" });
    world.npcs.push(small);
    assert.equal(world.sees(ego, hidden), true, "behind a cyclist");
    // (nor does a car parked at the kerb; a van double-parked does)
    world.npcs.splice(world.npcs.indexOf(small), 1);
    const parked = car("parked", ego.x + 15, -HALF, 0); world.parked.add(parked);
    assert.equal(world.sees(ego, hidden), true, "behind a parked car");
    world.parked.remove(parked);
    const dp = Object.assign(car("dp", ego.x + 15, -HALF, 0, 0, DELIVERY_VAN), { doubleParked: true }); world.parked.add(dp);
    assert.equal(world.sees(ego, hidden), !hazards, "behind a double-parked van");
    // (and a nose that shows past it is seen)
    hidden.y = -HALF + 2.2;
    assert.equal(world.sees(ego, hidden), true, "showing past it");
  }
});

await test("along a lane, a standing vehicle covers what is behind it, but one coming along it does not", () => {
  const map = junction(), world = atStop(map), ego = world.ego, lane = map.lane("s_in", 0);
  // a van stopped in the southbound lane (from the north) hides the northbound lane from the south behind it
  const van = car("van", -HALF, -13, -Math.PI / 2, 0, DELIVERY_VAN);
  world.npcs.push(van);
  const seen = T.laneSight(world, ego, lane, 6, 60);
  assert.ok(seen && seen.hidden_by === "van" && seen.sight_m >= 6 && seen.sight_m < 20, JSON.stringify(seen && { ...seen, at: null }));
  // a car standing in that lane, in view, short of the shadow: nothing behind it can come first
  const queued = car("queued", HALF, -12, Math.PI / 2, 0); world.npcs.push(queued);
  assert.equal(T.laneSight(world, ego, lane, 6, 60), null);
  // coming along it instead: what follows it must be seen too
  queued.v = 8;
  assert.ok(T.laneSight(world, ego, lane, 6, 60), "a moving car covers nothing");
});

await test("giving way at a two-way stop, the car waits where it looks from for a vehicle hiding the street to move, up to 8 s", () => {
  const map = junction(), world = atStop(map), ego = world.ego;
  const van = car("van", -HALF, -13, -Math.PI / 2, 0, DELIVERY_VAN); world.npcs.push(van);
  // at the line: creep up to look
  let g = buildSnapshot(world).intersection.give_way;
  assert.equal(g.view_clear, false); assert.equal(g.hidden_by, "van"); assert.ok(!g.go);
  // stopped where it looks from: it waits there for the van to move
  const peekFront = world.route.controls[0].sPeek;
  ego.x = -ARM + peekFront - (ego.spec.length - ego.spec.rearOverhang) - 0.2; world.route.project(ego.x, ego.y);
  world.egoPeek = "stop_w"; world.egoPeekAt = world.t;
  g = buildSnapshot(world).intersection.give_way;
  assert.equal(g.waiting_to_see, true); assert.equal(g.go, false);
  const clause = situationClauses(buildSnapshot(world)).join(" ");
  assert.ok(clause.includes("`van` hides") && clause.includes("hold still until it moves"), clause);
  assert.match(T.trafficNotice(world, buildSnapshot(world)).text, /THE VAN HIDES THE CROSS STREET · WAIT UNTIL YOU CAN SEE/);
  // 8 s later it goes as it would past a building, once nothing it can see is coming
  world.t += 8.1;
  g = buildSnapshot(world).intersection.give_way;
  assert.equal(g.waiting_to_see, undefined); assert.equal(g.peeked, true); assert.equal(g.go, true);
  // without hazards it sees through the van
  const off = atStop(map, { hazards: false }); off.npcs.push(van);
  assert.equal(buildSnapshot(off).intersection.give_way.view_clear, true);
});

await test("turning right on red, a vehicle hiding the street to the left keeps the car waiting", async () => {
  const map = load("a53c5bcf6438"), challenge = { ...CHALLENGES.find((c) => c.id === "right-on-red"), hidden: true };
  const { world, fleet, autopilot } = setupChallenge(map, challenge);
  let rtor = null;
  for (let k = 0; k < 40 / DT && !(rtor?.stop_completed); k++) {
    stepWorld({ world, fleet, autopilot }, DT, world.t * 1000);
    if (autopilot.firing) await autopilot.firing;
    rtor = autopilot.snap?.intersection?.right_on_red;
  }
  assert.ok(rtor?.stop_completed, "stopped at the red");
  // a van standing across the line of sight to the street to the left, 30 m along it
  const c = world.route.controls.find((x) => x.control.type === "signal"), inter = map.intersections.get(c.control.id);
  const from = inter.approaches.map((a) => map.edges.get(a.edge)).find((e) => e.id !== c.edge && Math.abs(Math.atan2(Math.sin(map.headingIn(e.id) - world.route.headingAt(c.sJunction + 15)), Math.cos(map.headingIn(e.id) - world.route.headingAt(c.sJunction + 15)))) < Math.PI / 4);
  const p = T.laneBack(map.lane(from.id, from.lanes - 1), 30), mid = [(p[0] + world.ego.x) / 2, (p[1] + world.ego.y) / 2];
  const van = Object.assign(car("van", mid[0], mid[1], Math.atan2(p[1] - world.ego.y, p[0] - world.ego.x) + Math.PI / 2, 0, DELIVERY_VAN), { doubleParked: true });
  world.parked.add(van);
  for (const n of [...fleet.vehicles]) fleet.vehicles.splice(fleet.vehicles.indexOf(n), 1);
  const snap = buildSnapshot(world), r = snap.intersection.right_on_red;
  assert.equal(r.wait_for?.kind, "view"); assert.equal(r.wait_for.hidden_by, "van"); assert.equal(r.go, false);
  assert.ok(situationClauses(snap).join(" ").includes("`van` hides the street to its left"));
  assert.match(T.trafficNotice(world, snap).text, /HIDES TRAFFIC FROM THE LEFT/);
});

// Blind left: drive it, every tick noting what holds the car, where it is, and whether it sees the car
// coming through behind the van.
async function blindLeft(hazards, brain = "rules") {
  const { world, fleet, autopilot, scenario } = setupChallenge(KITS, { ...BLIND, hidden: hazards }, { brain });
  const c = world.route.controls.find((x) => x.control.type === "signal");
  const edgeS = c.sJunction - KITS.crossingHalfWidth(c.edge), FRONT = world.ego.spec.length - world.ego.spec.rearOverhang;
  const out = { viewOnly: null, deepest: -Infinity, vanTurnedAt: null, egoTurnedAt: null, seenHiddenAt: null, minGap: Infinity, state: null, notice: null };
  for (let k = 0; k < 80 / DT && autopilot.enabled; k++) {
    stepWorld({ world, fleet, autopilot }, DT, world.t * 1000);
    if (autopilot.firing) await autopilot.firing;
    if (!world.route) break;
    const snap = autopilot.snap, o = snap?.intersection?.oncoming, hidden = fleet.vehicles.find((v) => v.id === "challenge_hidden"), van = fleet.vehicles.find((v) => v.id === "challenge_van");
    const frontS = world.route.project(world.ego.x, world.ego.y).s + FRONT;
    if (van && van.frozen <= 0 && out.vanTurnedAt === null) out.vanTurnedAt = world.t;
    if (o?.id === null && o.bumper_to_yield_m < 2 && hidden && !world.sees(world.ego, hidden) && !out.viewOnly) {
      // at its wait point, held only by what it cannot see: is the car coming through due?
      const node = KITS.nodes.get(KITS.edges.get(scenario.blindLeft.edge).to), d = Math.hypot(node.x - hidden.x, node.y - hidden.y);
      out.viewOnly = { seen: world.sees(world.ego, hidden), eta: d / Math.max(0.1, hidden.v), need: o.need_s, t: world.t };
      out.state = toJevState(snap, [], {}); out.clauses = situationClauses(snap).join(" "); out.notice = T.trafficNotice(world, snap);
    }
    if (o?.id === null && Math.abs(world.ego.v) < 0.05) out.deepest = Math.max(out.deepest, frontS - edgeS);
    if (hidden && out.seenHiddenAt === null && world.sees(world.ego, hidden)) out.seenHiddenAt = Math.hypot(hidden.x - world.ego.x, hidden.y - world.ego.y);
    if (out.egoTurnedAt === null && frontS > c.sJunction) out.egoTurnedAt = world.t;
    if (hidden) out.minGap = Math.min(out.minGap, Math.hypot(hidden.x - world.ego.x, hidden.y - world.ego.y));
  }
  return { ...out, arrived: !autopilot.enabled, violations: { ...world.violations } };
}

await test("Blind left: the car waits at the edge of the cross street until it can see past the van, then turns once the van has gone", async () => {
  const r = await blindLeft(true);
  assert.ok(r.viewOnly, "held by the hidden lane alone");
  // (the car coming through is hidden then, and due before the car could have turned in front of it)
  assert.equal(r.viewOnly.seen, false); assert.ok(r.viewOnly.eta < r.viewOnly.need, `${r.viewOnly.eta.toFixed(1)} s < ${r.viewOnly.need.toFixed(1)} s`);
  assert.ok(r.seenHiddenAt !== null && r.seenHiddenAt < 40, `seen only as it comes out from behind the van (${r.seenHiddenAt?.toFixed(0)} m)`);
  assert.ok(r.deepest <= 0.5, `waits no further in than the cross street's edge (${r.deepest.toFixed(1)} m)`);
  assert.ok(r.vanTurnedAt !== null && r.egoTurnedAt > r.vanTurnedAt + 1, `turns after the van (${r.vanTurnedAt?.toFixed(1)} s, ${r.egoTurnedAt?.toFixed(1)} s)`);
  assert.equal(r.violations.collisions, 0); assert.equal(r.violations.failed_to_yield, 0); assert.equal(r.arrived, true);
  // what models are told, and the HUD
  assert.equal(r.state.intersection.oncoming.lane_hidden_by, "challenge_van"); assert.equal(r.state.intersection.oncoming.id, undefined);
  assert.ok(r.clauses.includes("`challenge_van` hides the oncoming lane") && r.clauses.includes("`stop_for_oncoming`") || r.clauses.includes("Hold still until it can see"), r.clauses);
  assert.match(r.notice.text, /THE VAN HIDES THE ONCOMING LANE · WAIT UNTIL YOU CAN SEE/);
  assert.ok(SYSTEM_PROMPT.includes("`intersection.oncoming.lane_hidden_by`"));
  process.stdout.write(`  (held by the hidden lane at ${r.viewOnly.t.toFixed(1)} s with the car ${r.viewOnly.eta.toFixed(1)} s out, seen at ${r.seenHiddenAt.toFixed(0)} m; van turned at ${r.vanTurnedAt.toFixed(1)} s, the car at ${r.egoTurnedAt.toFixed(1)} s)\n`);
});

await test("Blind left without hidden hazards: the car sees through the van and waits for the car coming through as it would for any", async () => {
  const r = await blindLeft(false);
  assert.equal(r.viewOnly, null);
  assert.ok(r.seenHiddenAt > 60, `${r.seenHiddenAt}`);
  assert.equal(r.violations.collisions, 0); assert.equal(r.violations.failed_to_yield, 0); assert.equal(r.arrived, true);
});

await test("Blind left passes with Rules and the cautious agent", async () => {
  for (const brain of ["rules", "cautious"]) {
    const result = await evaluateChallenge(KITS, BLIND, { brain });
    assert.equal(result.pass, true, `${brain}: ${result.failures}`);
    assert.equal(result.collisions, 0);
    assert.equal(result.report.hidden_cutoffs, 0);
  }
  assert.ok(challengeScenario(KITS, BLIND).blindLeft, "a site on West 4th Avenue");
});

await test("coaching counts pulling out in front of a vehicle hidden behind another, with a tip, only with hazards on", () => {
  for (const hazards of [true, false]) {
    const world = new World(KITS, { parked: 0, pedestrians: 0, hazards });
    const score = new DriveScore(world, { title: "t", map: "m", driver: "manual" });
    world.events = [{ type: "failed_to_yield", to: "oncoming traffic", with: "x", ...(hazards ? { unseen: true } : {}) }];
    world.violations.failed_to_yield = 1;
    score.record(world, world.roadInfo(), DT);
    const report = score.finish("arrived");
    assert.equal(report.hidden_cutoffs, hazards ? 1 : undefined);
    assert.equal(report.tips.some((t) => t.includes("can hide traffic in the lane beside it")), hazards);
  }
});

console.log(`\n${checks} checks passed`);
process.exit(0);
