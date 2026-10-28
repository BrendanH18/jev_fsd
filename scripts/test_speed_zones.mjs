// School and playground zones (BC MVA s. 147): the zones on each map, when they are in effect, the
// limit the world, traffic and the car keep to there, what models are told, the signs, coaching, and
// the "School zone" challenge, where the zone's 30 km/h is what lets the car stop for a child.
// node --experimental-default-type=module scripts/test_speed_zones.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
globalThis.document = { querySelector: () => null };
const { MapData } = await import("../static/js/map/mapdata.js");
const { World } = await import("../static/js/sim/world.js");
const { NpcFleet, NpcPath } = await import("../static/js/sim/npc.js");
const { Vehicle } = await import("../static/js/sim/vehicle.js");
const { StopMemory } = await import("../static/js/sim/signals.js");
const { stepWorld } = await import("../static/js/sim/step.js");
const { ZONE_LIMIT_MPS, inEffect, mapClock, zoneAt, zoneLimit } = await import("../static/js/sim/speed-zones.js");
const { parseHour } = await import("../static/js/sim/world-clock.js");
const { DriveScore, SPEED_GRACE_MPS } = await import("../static/js/sim/drive-score.js");
const { buildSnapshot } = await import("../static/js/brain/sensors.js");
const { toJevState, situationClauses } = await import("../static/js/brain/state.js");
const { SYSTEM_PROMPT } = await import("../static/js/brain/llm-prompt.js");
const { CHALLENGES } = await import("../static/js/lab/challenges.js");
const { setupChallenge, evaluateChallenge } = await import("../static/js/lab/evaluation.js");
const { DriveRecorder } = await import("../static/js/lab/recorder.js");
const { Route } = await import("../static/js/map/route.js");
const { routeFromLanes } = await import("../static/js/demo/routing.js");
const { sceneryFor } = await import("../static/js/map/scenery.js");

let checks = 0;
function test(name, fn) { fn(); checks++; console.log(`✓ ${name}`); }
async function testAsync(name, fn) { await fn(); checks++; console.log(`✓ ${name}`); }
const root = new URL("../data/maps/", import.meta.url);
const load = (key, { zones = true } = {}) => {
  const pack = JSON.parse(fs.readFileSync(new URL(`${key}.v6.pack.json`, root)));
  for (const name of ["transit", "crossings", ...(zones ? ["zones"] : [])]) {
    const url = new URL(`${key}.${name}.v1.json`, root);
    if (fs.existsSync(url)) pack[name] = JSON.parse(fs.readFileSync(url));
  }
  pack.utc_offset = -7;
  return new MapData(pack);
};
const KITS = load("623b012bc8b5");
const kmh = (v) => Math.round(v * 3.6);
const at = (hour) => mapClock(hour, KITS);
const laneOn = (map, id) => { const e = map.edges.get(id); return map.lane(id, e.lanes - 1); };

test("the map's zones are each street's stretches beside a school or playground", () => {
  assert.ok(KITS.zones.length > 10);
  assert.ok(KITS.zones.some((z) => z.kind === "school") && KITS.zones.some((z) => z.kind === "playground"));
  for (const [id, spans] of KITS.zoneSpans) {
    assert.ok(KITS.edges.has(id));
    for (const s of spans) assert.ok(s.from < s.to && s.to <= KITS.edges.get(id).length + 0.1);
  }
  assert.equal(load("623b012bc8b5", { zones: false }).zoneSpans.size, 0, "a map without the file has none");
});

test("a school zone is in effect 8:00 to 17:00, a playground zone dawn to dusk", () => {
  assert.ok(!inEffect("school", at(7.9)) && inEffect("school", at(8)) && inEffect("school", at(16.99)) && !inEffect("school", at(17)));
  assert.ok(!inEffect("playground", at(5)) && inEffect("playground", at(7)) && inEffect("playground", at(19.2)) && !inEffect("playground", at(21)));
  assert.ok(!inEffect("school", null) && !inEffect("playground", null), "no clock, no zone");
  assert.equal(parseHour("morning"), 9);
  // (the sun as the sky draws it: up about 7:20 in Vancouver in late September, down about 19:05;
  // civil dawn and dusk some 35 minutes either side)
  assert.ok(at(7.0).sun_deg < 0 && at(7.5).sun_deg > 0 && at(19.0).sun_deg > 0 && at(19.3).sun_deg < 0);
  assert.ok(!inEffect("playground", at(6.5)) && !inEffect("playground", at(19.75)));
  assert.ok(Math.abs(at(13.2).sun_deg - 39) < 2, "about 39 deg at solar noon");
});

test("the world's limit is the zone's where one is in effect, the street's otherwise", () => {
  const world = new World(KITS, { seed: 1, parked: 0, pedestrians: 0 });
  const lane = laneOn(KITS, "e131");   // West 11th Avenue past Lord Tennyson Elementary, 50 km/h
  world.placeOnLane(lane, 60);
  assert.equal(kmh(world.roadInfo().limit), 50);
  assert.equal(world.roadInfo().zone, null, "no clock: the seeded benchmark drives no zones");
  world.setClock(at(9));
  const road = world.roadInfo();
  assert.equal(kmh(road.limit), 30); assert.equal(road.zone.kind, "school"); assert.equal(road.zone.name, "Lord Tennyson Elementary School");
  world.setClock(at(22));
  assert.equal(kmh(world.roadInfo().limit), 50); assert.equal(world.roadInfo().zone, null);
  // a zone never raises a street's limit
  assert.equal(zoneLimit(20 / 3.6, { zone: {} }), 20 / 3.6);
  assert.equal(zoneLimit(50 / 3.6, null), 50 / 3.6);
  // where a school and a playground zone overlap, the school's is reported
  const both = [...KITS.zoneSpans].find(([, spans]) => spans.some((s) => s.zone.kind === "school") && spans.some((s) => s.zone.kind === "playground"));
  if (both) {
    const [id, spans] = both, s = spans.find((x) => x.zone.kind === "school"), p = spans.find((x) => x.zone.kind === "playground");
    const mid = Math.max(s.from, p.from) + 0.1;
    if (mid < Math.min(s.to, p.to)) assert.equal(zoneAt(KITS.zoneSpans, id, mid, at(9)).zone.kind, "school");
  }
});

// West 7th Avenue past General Gordon Elementary: 50 km/h, with the school zone starting 80 m in
function seventh(s, v) {
  const world = new World(KITS, { seed: 1, parked: 0, pedestrians: 0 });
  world.setClock(at(9));
  const lane = laneOn(KITS, "e235"), next = KITS.successors("e235").map((id) => laneOn(KITS, id)).sort((a, b) => Math.abs(KITS.turnAngle("e235", a.edge)) - Math.abs(KITS.turnAngle("e235", b.edge)))[0];
  world.route = new Route(routeFromLanes(KITS, [lane, next], s, next.length - 5), KITS, world.ego.spec);
  world.placeOnLane(lane, s); world.ego.v = v; world._road = world.roadInfo();
  return world;
}

test("coming up to a zone in effect, the car is down to its limit by the sign", () => {
  const world = seventh(50, 50 / 3.6), snap = buildSnapshot(world);
  const z = snap.speed_zone;
  assert.equal(z.kind, "school"); assert.equal(z.in_zone, false);
  assert.ok(z.starts_in_m > 20 && z.starts_in_m < 30, `starts ${z.starts_in_m} m ahead`);
  assert.equal(kmh(snap.limit), 50, "not yet in it");
  assert.ok(snap.target.v < 50 / 3.6 && snap.target.reasons.includes("school zone ahead"));
  // far off, nothing yet; outside the zone's hours, nothing at all
  assert.ok(!buildSnapshot(seventh(10, 50 / 3.6)).target.reasons.includes("school zone ahead"));
  // (after school the playground beside it keeps a zone in effect until dusk)
  const evening = seventh(50, 50 / 3.6); evening.setClock(at(18));
  assert.equal(buildSnapshot(evening).speed_zone.kind, "playground");
  const night = seventh(50, 50 / 3.6); night.setClock(at(22));
  assert.equal(buildSnapshot(night).speed_zone, null);
  // in it: the limit is 30 and the reason says why
  const inside = seventh(88, 30 / 3.6), s2 = buildSnapshot(inside);
  assert.equal(s2.speed_zone.in_zone, true); assert.equal(kmh(s2.limit), 30);
  assert.ok(s2.target.v <= ZONE_LIMIT_MPS + 1e-6 && s2.target.reasons.includes("school zone"));
  // (it carries on 18 m into the next block: stretches that meet are one)
  assert.ok(s2.speed_zone.ends_in_m > 20 && s2.speed_zone.ends_in_m < 35, `ends in ${s2.speed_zone.ends_in_m} m`);
});

test("models are told about the zone, where it starts and when it is in effect", () => {
  const world = seventh(50, 50 / 3.6), snap = buildSnapshot(world);
  const state = toJevState(snap, [], {});
  assert.deepEqual(Object.keys(state.speed_zone).sort(), ["ends_in_m", "in_effect", "kind", "limit", "name", "starts_in_m"]);
  assert.equal(state.speed_zone.in_effect, "8:00 to 17:00 on school days");
  assert.equal(state.speed_zone.limit, 8.3);
  const line = situationClauses(snap).find((c) => c.includes("school zone"));
  assert.ok(line && /starts \d+ m ahead: slow to 30 km\/h/.test(line), line);
  const inside = buildSnapshot(seventh(88, 8));
  assert.ok(situationClauses(inside).some((c) => c.startsWith("The car is in a school zone by General Gordon Elementary School")));
  assert.equal(toJevState(inside, [], {}).speed_zone.in_zone, true);
  assert.ok(SYSTEM_PROMPT.includes("`speed_zone`"));
  const night = seventh(50, 8); night.setClock(at(22));
  assert.equal(toJevState(buildSnapshot(night), [], {}).speed_zone, undefined, "no zone in effect, no field");
});

test("traffic keeps to a zone's limit, slowing on the way in", () => {
  const world = new World(KITS, { seed: 3, parked: 0, pedestrians: 0 }), fleet = new NpcFleet(world, { count: 0, bikes: 0, seed: 3 });
  world.setClock(at(9));
  const lane = laneOn(KITS, "e131");
  const car = new Vehicle(...lane.pts[0], Math.atan2(lane.pts[1][1] - lane.pts[0][1], lane.pts[1][0] - lane.pts[0][0]), 13.9);
  Object.assign(car, { id: "zone_test_car", color: 0xffffff, v0: 14.5, driver: { aMax: 1.5, b: 2, s0: 2, T: 1.2, react: 0.5, lcRate: 0 },
    stopMem: new StopMemory(), path: new NpcPath(KITS, fleet.random), frozen: 0, waiting: 0 });
  car.path.start("e131", lane.idx, 1); fleet.vehicles.push(car);
  assert.equal(fleet.zoneLimit(car.path, 5), ZONE_LIMIT_MPS);
  let top = 0;
  for (let i = 0; i < 60 * 12; i++) {
    fleet.step(1 / 60); world.t += 1 / 60;
    if (i > 60 * 5 && car.path.currentEdge().id === "e131" && car.path.s < 140) top = Math.max(top, car.v);
  }
  assert.ok(top > 0 && top <= ZONE_LIMIT_MPS * 1.05 + 0.2, `${kmh(top)} km/h in the zone`);
  world.setClock(null);
  assert.equal(fleet.zoneLimit(car.path, 5), Infinity);
});

test("signs stand where each zone starts and, short of its street's end, where it ends", () => {
  const signs = sceneryFor(KITS).zoneSigns;
  assert.ok(signs.some((s) => s.kind === "school" && !s.end) && signs.some((s) => s.kind === "playground" && !s.end) && signs.some((s) => s.end));
  const gordon = signs.filter((s) => s.id.startsWith("zone_post:e235:school"));
  assert.deepEqual(gordon.map((s) => s.end), [false], "West 7th's runs to the end of its block: a start sign only");
  for (const s of signs) {
    assert.ok(KITS.edges.has(s.id.split(":")[1]) && Number.isFinite(s.heading));
    assert.ok(KITS.roadDistance(s.x, s.y).distance > 0.5, `${s.id} stands off the road`);
  }
});

test("coaching counts speeding in a zone once a visit, with its own tip", () => {
  const world = new World(KITS, { seed: 1, parked: 0, pedestrians: 0 }), score = new DriveScore(world);
  const zone = { id: "sw1", kind: "school", name: "" };
  world.ego.v = ZONE_LIMIT_MPS + SPEED_GRACE_MPS + 2;
  for (let i = 0; i < 180; i++) score.record(world, { limit: ZONE_LIMIT_MPS, zone, on_road: true }, 1 / 60);
  assert.match(score.coach, /Slow to 30\. You’re in a school zone\./);
  for (let i = 0; i < 60; i++) score.record(world, { limit: 50 / 3.6, zone: null, on_road: true }, 1 / 60);
  for (let i = 0; i < 60; i++) score.record(world, { limit: ZONE_LIMIT_MPS, zone, on_road: true }, 1 / 60);
  const report = score.snapshot();
  assert.equal(report.incidents.filter((i) => i.type === "zone_speeding").length, 2, "once each time into the zone");
  assert.ok(report.zone_speeding_s > 3 && report.zone_speeding_s <= report.speeding_s);
  assert.ok(report.tips.some((t) => t.startsWith("Slow to 30 km/h in school and playground zones")));
});

const challenge = CHALLENGES.find((c) => c.id === "school-zone");
test("challenge: a school zone on West 11th Avenue at 9:00, a child at the curb between parked cars", () => {
  const { world, scenario } = setupChallenge(KITS, challenge);
  assert.equal(KITS.edges.get(scenario.start.edge).name, "West 11th Avenue");
  assert.equal(kmh(KITS.edges.get(scenario.start.edge).limit), 50);
  assert.equal(world.clock.hour, 9);
  assert.equal(world.roadInfo().zone?.kind, "school"); assert.equal(kmh(world.roadInfo().limit), 30);
  const child = world.crowd.list.find((p) => p.id === "challenge_child");
  assert.ok(child?.child && child.frozen > 0);
  assert.deepEqual(world.parked.list.map((c) => c.id).sort(), ["challenge_parked_1", "challenge_parked_2"]);
  const local = world.ego.toLocal(child.x, child.y);
  assert.ok(local.ahead > 80 && local.ahead < 95 && local.right > 3, `the child ${Math.round(local.ahead)} m ahead, ${local.right.toFixed(1)} m right`);
  const recorder = new DriveRecorder(), ctx = setupChallenge(KITS, challenge);
  recorder.record({ ...ctx, drive: null, clock: { hour: 9 } }, true);
  assert.ok(recorder.frames[0].shared.has(ctx.world.route.zoneMarks), "the route's zone marks are shared, not copied");
  assert.deepEqual(recorder.frames[0].state.world.clock, ctx.world.clock);
});

await testAsync("challenge: Rules keeps to 30 in the zone and stops for the child; so does the cautious agent", async () => {
  for (const brain of ["rules", "cautious"]) {
    const result = await evaluateChallenge(KITS, challenge, { brain });
    assert.ok(result.pass, `${brain}: ${JSON.stringify(result.failures)}`);
    assert.equal(result.report.collisions, 0);
    assert.equal(result.report.zone_speeding_s, 0, `${brain} never speeds in the zone`);
    assert.ok(result.report.max_kmh <= 30 + 5, `${brain} tops out at ${result.report.max_kmh} km/h`);
    assert.ok(result.events.some((e) => e.type === "hazard"));
  }
});

await testAsync("challenge: without the zone, the same Rules driver reaches the child too fast to stop", async () => {
  const ctx = setupChallenge(KITS, challenge), { world } = ctx;
  world.setClock(null);
  let atTrigger = null, hit = null;
  while (world.t < 60 && ctx.autopilot.enabled && !hit) {
    stepWorld(ctx, 1 / 60, world.t * 1000);
    if (ctx.autopilot.firing) await ctx.autopilot.firing;
    if (atTrigger === null && world.challenge.triggered) atTrigger = world.ego.v;
    hit = world.events.find((e) => e.type === "collision") || null;
  }
  assert.ok(atTrigger > 45 / 3.6, `${kmh(atTrigger)} km/h when the child runs out`);
  // (the child runs out rather than waiting at the curb for the car to stop, and the car hits them
  // still moving, its fault)
  assert.equal(hit?.with, "challenge_child", "it hits the child");
  assert.ok(hit.at_fault && hit.ego_v > 3, `at ${kmh(hit.ego_v)} km/h, ${hit.fault}'s fault`);
});

console.log(`\n${checks} speed-zone checks passed`);
process.exit(0);   // the runner's MessageChannel would otherwise keep Node alive
