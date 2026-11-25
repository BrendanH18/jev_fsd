// The JavaScript side of the rules that exist in both Python and JavaScript (ROADMAP 3.8): reads
// tests/fixtures/parity_cases.json and prints what the browser code makes of each case as JSON.
// tests/test_parity.py runs this, works out the Python side and compares the two.
// node --experimental-default-type=module scripts/parity_js.mjs [cases.json]
import { fileURLToPath } from "node:url";
import { parseOptions, readJson } from "./cli_tools.mjs";
const DEFAULT_CASES = fileURLToPath(new URL("../tests/fixtures/parity_cases.json", import.meta.url));
const USAGE = `Usage: parity_js.mjs [CASES.json] [--kind turns|joins] [--case NAME] [--list]
       parity_js.mjs [--fixture CASES.json] [--pretty]
Write the JavaScript side of the routing parity cases to stdout.`;

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateLine(line, label) {
  if (!Array.isArray(line) || line.length < 2) throw new Error(`${label} must have at least two points`);
  for (const [i, point] of line.entries())
    if (!Array.isArray(point) || point.length !== 2 || !point.every(Number.isFinite))
      throw new Error(`${label}[${i}] must be a finite [x, y] pair`);
  const meters = length(line);
  if (!Number.isFinite(meters) || meters <= 0) throw new Error(`${label} must have positive, finite length`);
}

function fixture(file) {
  const cases = readJson(file, { maxBytes: 8 * 1024 ** 2 });
  if (!object(cases)) throw new Error(`${file}: expected a fixture object`);
  for (const [kind, fields] of [
    ["turns", ["in", "out"]],
    ["joins", ["before", "after"]],
  ]) {
    const list = cases[kind];
    if (!Array.isArray(list)) throw new Error(`${file}: ${kind} must be an array`);
    const seen = new Set();
    for (const [index, item] of list.entries()) {
      const location = `${file}: ${kind}[${index}]`;
      if (!object(item) || typeof item.name !== "string" || !item.name.trim())
        throw new Error(`${location} needs a non-empty case name`);
      const label = `${location} (${item.name})`;
      if (seen.has(item.name)) throw new Error(`${label} duplicates another case name in ${kind}`);
      seen.add(item.name);
      for (const field of fields) validateLine(item[field], `${label}.${field}`);
      if (kind === "turns") {
        const [x, y] = item.in.at(-1);
        const [px, py] = item.in.at(-2);
        if (x === px && y === py) throw new Error(`${label} has no incoming direction at the junction`);
        if (x !== item.out[0][0] || y !== item.out[0][1])
          throw new Error(`${label} must join its incoming and outgoing edges at the same point`);
        if (item.angle_deg !== undefined && (!Number.isFinite(item.angle_deg) || Math.abs(item.angle_deg) > 180))
          throw new Error(`${label}.angle_deg must be within -180 to 180`);
      }
      if (
        item.known_difference !== undefined &&
        (typeof item.known_difference !== "string" || !item.known_difference.trim())
      )
        throw new Error(`${label}.known_difference needs an explanation`);
    }
  }
  if (cases.tolerance_m !== undefined && (!Number.isFinite(cases.tolerance_m) || cases.tolerance_m < 0))
    throw new Error(`${file}: tolerance_m must be finite and non-negative`);
  return cases;
}

const length = (pts) => pts.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0);
const key = (p) => `${p[0]},${p[1]}`;

// A pack of single-lane one-way edges whose lane is the edge's own line, joined where their ends meet.
function packOf(MapData, lines) {
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

function turnResult(c, { MapData, NpcFleet, browserRoute }) {
  // a second way on, straight ahead, so that "out" is never the only successor
  const end = c.in.at(-1),
    dir = [end[0] - c.in.at(-2)[0], end[1] - c.in.at(-2)[1]],
    n = Math.hypot(...dir);
  const map = packOf(MapData, {
    in: c.in,
    out: c.out,
    ahead: [end, [end[0] + (dir[0] / n) * 50, end[1] + (dir[1] / n) * 50]],
  });
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
}

function joinResult(c, { MapData, routeFromLanes }) {
  const map = packOf(MapData, { before: c.before, after: c.after });
  const route = routeFromLanes(map, [map.lane("before", 0), map.lane("after", 0)], 0, map.lane("after", 0).length);
  return { name: c.name, polyline: route.polyline };
}

async function main(argv) {
  const positional = argv[0] && !argv[0].startsWith("-") ? argv.shift() : undefined;
  const { help, args } = parseOptions(argv, ["fixture", "kind", "case", "match"], ["list", "pretty"]);
  if (help) {
    console.log(USAGE);
    return;
  }
  if (positional && args.fixture) throw new Error("Pass the fixture path once, as a positional argument or --fixture.");
  const kinds = ["turns", "joins"];
  if (args.kind && !kinds.includes(args.kind)) throw new Error("--kind must be turns or joins.");
  const cases = fixture(positional ?? args.fixture ?? DEFAULT_CASES);
  const requested = (kind) => !args.kind || args.kind === kind;
  const seen = new Set(kinds.filter(requested).flatMap((kind) => cases[kind].map(({ name }) => name)));
  if (args.case && !seen.has(args.case)) throw new Error(`Unknown parity case: ${args.case}`);
  const input = Object.fromEntries(
    kinds.map((kind) => [
      kind,
      requested(kind)
        ? cases[kind].filter(
            ({ name }) => (!args.case || name === args.case) && (!args.match || name.includes(args.match)),
          )
        : [],
    ]),
  );
  let output;
  if (args.list) {
    output = Object.fromEntries(kinds.map((kind) => [kind, input[kind].map(({ name }) => name)]));
  } else {
    globalThis.document = { querySelector: () => null };
    const { MapData } = await import("../static/js/map/mapdata.js");
    const { routeFromLanes, browserRoute } = await import("../static/js/demo/routing.js");
    const { NpcFleet } = await import("../static/js/sim/npc.js");
    output = {
      turns: input.turns.map((item) => turnResult(item, { MapData, NpcFleet, browserRoute })),
      joins: input.joins.map((item) => joinResult(item, { MapData, routeFromLanes })),
    };
  }
  process.stdout.write(`${JSON.stringify(output, null, args.pretty ? 2 : 0)}\n`);
}

try {
  await main(process.argv.slice(2));
} catch (error) {
  console.error(`parity-js: ${error.message}`);
  process.exitCode = 2;
}
