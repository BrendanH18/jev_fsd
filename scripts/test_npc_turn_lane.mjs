// Traffic turns only from a lane it can reach the turn's lane from (Toronto city, seed 2, s2-1,
// Bloor Street West). A traffic car's way is planned a street at a time (NpcPath.extend), and it changes
// into the lane for a turn mid-block (NpcFleet.maybeChangeLane), no later than 30 m before the street
// ends. After two short blocks of Bloor Street West (e388, e184: 21 m each) its way turned right onto
// e343 from the left lane: it could never change lanes, swung across the curb lane at the junction and
// hit the driven car passing in it. A turn from a lane the planned streets leave no room to leave is no
// longer planned; where there is room, it still is, and the car changes lanes on the way.
// node --experimental-default-type=module scripts/test_npc_turn_lane.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
globalThis.document = { querySelector: () => null };
const { MapData } = await import("../static/js/map/mapdata.js");
const { NpcPath } = await import("../static/js/sim/npc.js");
const { rng } = await import("../static/js/common.js");

// The planned (edge, lane) pairs of a path started `s` m along `edge`'s lane `lane` with seed `seed`.
function plan(map, edge, lane, seed, s = 0) {
  const path = new NpcPath(map, rng(seed));
  path.start(edge, lane, s);
  return path.edges.map((e) => [e.id, e.lane]);
}
const turns = (planned, from, to) => planned.filter(([id], k) => id === from && planned[k + 1]?.[0] === to).map(([, lane]) => lane);

// Toronto: Bloor Street West widens to two lanes at e388, and traffic coming along it (e182, e336, one
// lane) carries on in the left lane. From there, never right onto e343; from the curb lane, still.
{
  const map = new MapData(JSON.parse(fs.readFileSync("data/maps/4a96d42cb3f2.v6.pack.json")));
  assert.equal(map.edges.get("e184").length < 30, true, "e184 is too short to change lanes on");
  assert.equal(map.classifyTurn(map.turnAngle("e184", "e343")), "right", "e184 to e343 is a right turn");
  let left = 0, curb = 0;
  for (let seed = 1; seed <= 400; seed++) {
    const along = plan(map, "e182", 0, seed);
    assert.equal(along.find(([id]) => id === "e388")?.[1], 0, "coming along Bloor, the left lane of e388");
    left += turns(along, "e184", "e343").filter((lane) => lane === 0).length + turns(plan(map, "e388", 0, seed), "e184", "e343").filter((lane) => lane === 0).length;
    curb += turns(plan(map, "e388", 1, seed), "e184", "e343").filter((lane) => lane === 1).length;
  }
  assert.equal(left, 0, "no right turn onto e343 from the left lane");
  assert.ok(curb > 0, `from the curb lane the turn is still taken (${curb} of 400)`);
  console.log(`Bloor Street West: right onto e343 from the curb lane in ${curb} of 400 ways from its curb lane, never from the left lane`);
}

// A synthetic two-lane street: a long block, a short link (`link` m) and a junction where the way goes
// on or turns right. Lane 0 is the left lane.
function junction(link) {
  const x0 = -200 - link, x1 = -link;
  const edge = (id, from, to, pts) => ({ id, from, to, pts, length: Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]), lanes: 2, lane_width: 3.5,
    lane_offsets: [1.75, 5.25], asphalt: [-3.5, 7], parking: [0, 0], cls: "secondary", limit: 11.1, oneway: false });
  const edges = [edge("long", "a", "b", [[x0, 0], [x1, 0]]), edge("link", "b", "c", [[x1, 0], [0, 0]]),
    edge("on", "c", "d", [[0, 0], [200, 0]]), edge("right", "c", "r", [[0, 0], [0, -200]])];
  // (lanes right of each edge's centreline: y below an eastbound edge, x left of the southbound one)
  const lanes = edges.flatMap((e) => e.lane_offsets.map((o, idx) => ({ edge: e.id, idx,
    pts: e.id === "right" ? e.pts.map(([x, y]) => [x - o, y]) : e.pts.map(([x, y]) => [x, y - o]) })));
  return new MapData({ bbox: [0, 0, 1, 1], extent: [x0 - 20, -220, 220, 20],
    nodes: [{ id: "a", x: x0, y: 0 }, { id: "b", x: x1, y: 0 }, { id: "c", x: 0, y: 0 }, { id: "d", x: 200, y: 0 }, { id: "r", x: 0, y: -200 }],
    edges, lanes, intersections: [], stops: [], buildings: [] });
}
for (const [link, reachable] of [[12, true], [25, false]]) {
  const map = junction(link);
  let fromLeft = 0, fromCurb = 0;
  for (let seed = 1; seed <= 100; seed++) {
    fromLeft += turns(plan(map, "long", 0, seed, 100), "link", "right").length;
    fromCurb += turns(plan(map, "link", 1, seed), "link", "right").length;
  }
  // (a link shorter than 20 m is looked through, so the lanes change on the long block before it)
  if (reachable) assert.ok(fromLeft > 0, `after a ${link} m link, the right turn from the left lane is still planned`);
  else assert.equal(fromLeft, 0, `after a ${link} m block, no right turn from the left lane`);
  assert.ok(fromCurb > 0, `from the curb lane of the ${link} m block, the right turn is planned`);
}
console.log("Traffic plans a turn only from a lane it can reach the turn's lane from");
process.exit(0);
