// The JavaScript side of the rules that exist in both Python and JavaScript (ROADMAP 3.8): reads
// tests/fixtures/parity_cases.json and prints what the browser code makes of each case as JSON.
// tests/test_parity.py runs this, works out the Python side and compares the two.
// node --experimental-default-type=module scripts/parity_js.mjs [cases.json]
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
globalThis.document = { querySelector: () => null };
const { MapData } = await import("../static/js/map/mapdata.js");
const { routeFromLanes, browserRoute } = await import("../static/js/demo/routing.js");
const { NpcFleet } = await import("../static/js/sim/npc.js");

const path = process.argv[2] || fileURLToPath(new URL("../tests/fixtures/parity_cases.json", import.meta.url));
const cases = JSON.parse(readFileSync(path, "utf8"));

const length = (pts) => pts.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0);
const key = (p) => `${p[0]},${p[1]}`;

// A pack of single-lane one-way edges whose lane is the edge's own line, joined where their ends meet.
function packOf(lines) {
  const nodes = new Map();
  const node = (p) => {
    if (!nodes.has(key(p))) nodes.set(key(p), { id: `n${nodes.size}`, x: p[0], y: p[1] });
    return nodes.get(key(p)).id;
  };
  const edges = Object.entries(lines).map(([id, pts]) => ({
    id,
    from: node(pts[0]),
    to: node(pts.at(-1)),
    pts,
    lanes: 1,
    lane_offsets: [0],
    length: length(pts),
    name: id,
    oneway: true,
    limit: 13.9,
    cls: "residential",
  }));
  return new MapData({
    bbox: [0, 0, 1, 1],
    extent: {},
    nodes: [...nodes.values()],
    edges,
    lanes: edges.map((e) => ({ edge: e.id, idx: 0, pts: e.pts })),
    intersections: [],
    stops: [],
  });
}

const at = (pts, f) => {
  const a = pts[0],
    b = pts.at(-1);
  return { x: a[0] + (b[0] - a[0]) * f, y: a[1] + (b[1] - a[1]) * f };
};

const turns = cases.turns.map((c) => {
  // a second way on, straight ahead, so that "out" is never the only successor
  const end = c.in.at(-1),
    dir = [end[0] - c.in.at(-2)[0], end[1] - c.in.at(-2)[1]],
    n = Math.hypot(...dir);
  const map = packOf({ in: c.in, out: c.out, ahead: [end, [end[0] + (dir[0] / n) * 50, end[1] + (dir[1] / n) * 50]] });
  const angle = map.turnAngle("in", "out");
  const from = at(c.in, 0.2),
    to = at(c.out, 0.8);
  const route = browserRoute(map, { ...from, heading: Math.atan2(dir[1], dir[0]) }, to);
  return {
    name: c.name,
    turn_angle: angle,
    kind: map.classifyTurn(angle),
    // traffic (sim/npc.js): the successor it may take other than "ahead"
    npc_allowed: NpcFleet.prototype.otherWay.call({ map, world: {} }, {}, "in", new Set(["ahead"])) === "out",
    // the browser router (demo/routing.js): a route from "in" onto "out"
    browser_allowed: !!route && route.edges.join(",") === "in,out",
  };
});

const joins = cases.joins.map((c) => {
  const map = packOf({ before: c.before, after: c.after });
  const route = routeFromLanes(map, [map.lane("before", 0), map.lane("after", 0)], 0, map.lane("after", 0).length);
  return { name: c.name, polyline: route.polyline };
});

process.stdout.write(JSON.stringify({ turns, joins }) + "\n");
