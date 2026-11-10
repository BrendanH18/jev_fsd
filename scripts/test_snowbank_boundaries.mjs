// Partial routes through snowbank narrowings and priority after a car appears inside.
// node --experimental-default-type=module scripts/test_snowbank_boundaries.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
globalThis.document = { querySelector: () => null };
const { MapData, pointAt, headingAt, projectPoint } = await import("../static/js/map/mapdata.js");
const { routeFromLanes } = await import("../static/js/demo/routing.js");
const { NpcFleet, NpcPath } = await import("../static/js/sim/npc.js");
const { Route } = await import("../static/js/map/route.js");
const { World } = await import("../static/js/sim/world.js");
const { Snowbanks, narrowingTurn, auditSnowbanks } = await import("../static/js/sim/snowbanks.js");
const { Vehicle } = await import("../static/js/sim/vehicle.js");
const { rng } = await import("../static/js/common.js");
const { buildSnapshot } = await import("../static/js/brain/sensors.js");
const { sampleCandidates, simulateAll } = await import("../static/js/brain/candidates.js");

const root = new URL("../data/maps/", import.meta.url), key = "623b012bc8b5";
const pack = JSON.parse(fs.readFileSync(new URL(`${key}.v6.pack.json`, root)));
for (const name of ["transit", "crossings", "zones", "rail", "calming", "scrambles", "buslanes", "restrictions", "contraflow", "driveways", "parks", "bridges"]) {
  const url = [2, 1].map(v => new URL(`${key}.${name}.v${v}.json`, root)).find(u => fs.existsSync(u));
  if (url) pack[name] = JSON.parse(fs.readFileSync(url));
}
const map = new MapData(pack);
function make(edge) {
  const w = new World(map, { seed: 3, pedestrians: 0, weather: "snow" });
  const sb = w.snowbanks = new Snowbanks(w);
  sb.enabled = true; sb.random = rng(3);
  const L = map.edges.get(edge).cum.at(-1);
  sb.build({ narrowings: [{ edge, a: 25, b: L - 25 }] });
  return w;
}
let checks = 0;
for (const edge of ["e127", "e335"]) for (const reverse of [false, true]) {
  const w = make(edge), sb = w.snowbanks, nw = sb.narrowings[0];
  const lane = map.lane(reverse ? nw.opposite : nw.edge, 0), mid = lane.length / 2;
  w.placeOnLane(lane, mid);
  w.route = new Route(routeFromLanes(map, [lane], mid, lane.length - 5), map);
  const ends = sb.alongRoute(w.route, nw);
  assert.equal(!!ends, true, `${edge} ${reverse}: a route starting inside retains its narrowing`);
  assert.equal(ends.en < 0, true);
  assert.equal(ends.ex > 0, true);
  const s = buildSnapshot(w);
  assert.equal(s.snowbank?.narrowing?.id, nw.id);
  assert.equal(s.snowbank.narrowing.inside, true);
  assert.equal(s.snowbank.narrowing.detour.shift < 0, true);
  const lateral = projectPoint(lane.pts, lane.cum, [w.ego.x, w.ego.y], null).lateral;
  assert.equal(lateral < -0.3, true, "spawn in the narrowed corridor");
  const { eligible } = simulateAll(sampleCandidates(s, w), s, w);
  assert.equal(eligible.some(c => c.id === "keep_lane_target" && c.sim.progress_m > 4), true, "drive ahead without intersecting pushed parked cars");
  w.resetToLane();
  assert.equal(Math.abs(projectPoint(lane.pts, lane.cum, [w.ego.x, w.ego.y], null).lateral - lateral) < 0.02, true, "reset keeps the same corridor");
  // The other boundary, and both boundaries inside the same stretch.
  for (const start of [5, mid - 8]) {
    w.route = new Route(routeFromLanes(map, [lane], start, mid), map);
    const end = sb.alongRoute(w.route, nw);
    assert.equal(!!end, true);
    assert.equal(end.ex > w.route.length + 5, true, "retain the exit beyond the destination");
    if (start > 5) assert.equal(end.en < 0, true);
  }
  checks++;
}
{
  const w = make("e127"), sb = w.snowbanks, nw = sb.narrowings[0], ego = w.ego;
  const other = new Vehicle(ego.x, ego.y, ego.psi + Math.PI, 1);
  other.id = "pulling_out";
  const c = { v: ego, id: "ego", dir: 1, gap: 5.5, inside: false, speed: 2.2 };
  const o = { v: other, id: other.id, dir: -1, gap: -30, inside: true, speed: 1 };
  sb.tick = w.tick; sb.lists.set(nw.id, [c, o]); sb.go.set(`ego|${nw.id}`, true);
  assert.equal(narrowingTurn(sb, nw, c).committed, false);
  assert.equal(narrowingTurn(sb, nw, c, () => false).mayEnter, true, "sensing still considers only visible vehicles");
  assert.equal(narrowingTurn(sb, nw, c).mayEnter, false, "a latched turn yields to a car newly inside while it can stop");
  assert.equal(narrowingTurn(sb, nw, { ...c, inside: true, gap: -1 }).mayEnter, true, "already inside: clear the stretch");
  assert.equal(narrowingTurn(sb, nw, { ...c, speed: 10 }).mayEnter, true, "too close to stop even braking hard: clear");
  o.inside = false; o.gap = 3;
  assert.equal(narrowingTurn(sb, nw, c).mayEnter, true, "a latched turn still holds against the waiting approach");
  checks++;
}
{
  const w = make("e127"), sb = w.snowbanks, nw = sb.narrowings[0];
  const fleet = new NpcFleet(w, { count: 0, bikes: 0 });
  const lane = map.lane(nw.opposite, 0), s = lane.length - nw.a - 20;
  const pos = pointAt(lane.pts, lane.cum, s), h = headingAt(lane.pts, lane.cum, s);
  const parked = new Vehicle(pos[0] + Math.sin(h) * 2, pos[1] - Math.cos(h) * 2, h, 0);
  parked.id = "curb"; parked.path = new NpcPath(map, () => 0.5); parked.path.start(lane.edge, 0, s);
  parked.pull = { t: 0, T: 3.5, lat: 2, wait: 2 };
  assert.equal(sb.claimFor(nw, parked) === null, true, "waiting at the kerb does not occupy the narrowing");
  const egoClaim = { v: w.ego, id: "ego", dir: 1, gap: 5, inside: false, speed: 1 };
  sb.tick = w.tick; sb.lists.set(nw.id, [egoClaim]); sb.go.set(`ego|${nw.id}`, true);
  assert.equal(sb.canPullOut(parked), false, "a pull-out must wait for the approaching driver's latched turn");
  assert.equal(fleet.pullClear(parked), false);
  egoClaim.inside = true; egoClaim.gap = -10;
  assert.equal(sb.canPullOut(parked), false, "wait while the opposing driver is inside");
  sb.lists.set(nw.id, []);
  assert.equal(sb.canPullOut(parked), true, "pull out once the corridor clears");
  // The longitudinal crossing audit must not mistake this stationary kerb waiter for an
  // oncoming car occupying the corridor (city snow s1-6).
  fleet.vehicles.push(parked);
  const egoLane = map.lane(nw.edge, 0);
  w.route = new Route(routeFromLanes(map, [egoLane], 0, egoLane.length - 3), map);
  const front = w.ego.spec.length - w.ego.spec.rearOverhang;
  const placeFront = (at) => w.placeOnLane(egoLane, at - front);
  sb.tick = -1;
  placeFront(nw.a - 0.3); w.ego.v = 1;
  assert.equal(w.sees(w.ego, parked), true);
  auditSnowbanks(w);
  placeFront(nw.a + 0.3); w.ego.v = 1; w.tick++;
  auditSnowbanks(w);
  assert.equal(w.violations.snowbank_conflicts || 0, 0, "passing a kerb waiter is not an out-of-turn entry");
  parked.pull.moving = true;
  assert.equal(sb.claimFor(nw, parked)?.inside, true, "a moving pull-out then claims its place");
  checks++;
}
console.log(`${checks} snowbank boundary and priority checks passed`);
process.exit(0);
