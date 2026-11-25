import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { inspectMapPack, MapData, cumulative, projectPoint } from "../static/js/map/mapdata.js";

const points = [
  [0, 0],
  [100, 0],
];
const east = {
  id: "east",
  from: "a",
  to: "b",
  pts: points,
  lanes: 1,
  lane_offsets: [0],
  length: 100,
  limit: 10,
  asphalt: [-2, 2],
  lane_width: 3.2,
  cls: "residential",
  name: "East",
  oneway: true,
  control: { id: "sig", type: "signal", group: "A", s_line: 90 },
};
const west = {
  ...east,
  id: "west",
  from: "b",
  to: "a",
  pts: [...points].reverse(),
  control: null,
};
const span = { edge: "east", from: 20, to: 25 };
const position = { x: 20, y: 0 };
const interval = { days: [0, 3], start: 1320, end: 120 };
const pack = {
  nodes: [
    { id: "a", x: 0, y: 0 },
    { id: "b", x: 100, y: 0 },
  ],
  edges: [east, west],
  lanes: [east, west].map((edge) => ({ edge: edge.id, idx: 0, pts: edge.pts })),
  intersections: [
    {
      ...position,
      id: "sig",
      vertices: ["b"],
      approaches: [{ edge: "east", s_line: 90, group: "A" }],
      cycle_s: 60,
      offset_s: 10,
    },
  ],
  stops: [{ id: "stop", edge: "west", s_line: 90, all_way: false }],
  yields: [{ id: "yield", edge: "west", s_line: 75 }],
  roundabouts: [
    { id: "ring", ...position, edges: ["west"], vertices: ["b"], island_r: 3, lane_r: 6, outer_r: 9, ccw: true },
  ],
  bbox: [-123.1, 49.2, -123, 49.3],
  routing_bbox: [-123.1, 49.2, -123, 49.3],
  extent: [0, -60, 100, 60],
  utc_offset: -7,
  crossings: {
    crossings: [{ id: "x1", edge: "east", s: 20, ...position, island: false, pxo: true, markings: "lines" }],
  },
  calming: { devices: [{ id: "calm", kind: "hump", ...position, at: [{ edge: "east", s: 20 }] }] },
  contraflow: { edges: [{ edge: "east", side: "left", kind: "track" }] },
  driveways: { driveways: [{ id: "d", edge: "east", side: "right", length: 10, heading: 0, s: 20, ...position }] },
  buslanes: { lanes: [{ edge: "east", lane: 0, allowed: ["bus"], hours: [interval] }] },
  zones: { zones: [{ kind: "school", name: "School", spans: [span] }] },
  parks: {
    areas: [
      {
        id: "park",
        kind: "grass",
        closed: true,
        rings: [
          [
            [0, 0],
            [0, 2],
            [2, 2],
          ],
        ],
        lines: [points],
      },
    ],
    spans: [{ ...span, left: "park", right: "park", water: false }],
  },
  bridges: { spans: [{ ...span, name: "Bridge", kind: "yes" }] },
  scrambles: { scrambles: [{ signal: "sig" }] },
  transit: {
    stops: [{ id: "stop1", name: "S", ...position }],
    routes: [
      {
        id: "transit1",
        mode: "bus",
        ref: "R",
        colour: "#00f",
        runs: [{ edges: ["east"], stops: [{ id: "stop1", s: 10 }] }],
      },
    ],
  },
  rail: {
    tracks: [{ id: "rail", pts: points, length: 100, kind: "rail", ends: ["edge", "edge"], stops: [{ s: 50 }] }],
    crossings: [
      {
        id: "railx",
        track: "rail",
        s: 20,
        ...position,
        heading_deg: 8,
        lights: true,
        gates: true,
        bell: false,
        edges: [{ edge: "east", s: 60, angle_deg: 90 }],
      },
    ],
  },
  buildings: [
    {
      pts: [
        [1, 1],
        [1, 10],
        [10, 1],
      ],
      h: 5,
    },
  ],
};

const check = (path, value, expected = path) => {
  const input = structuredClone(pack);
  const parts = path.replaceAll(/\[(\d+)\]/g, ".$1").split(".");
  const parent = parts.slice(0, -1).reduce((item, key) => item[key], input);
  parent[parts.at(-1)] = value;
  const issues = inspectMapPack(input);
  assert.equal(
    issues.some((issue) => issue.path === expected && issue.expected.length > 0),
    true,
    path,
  );
  assert.equal(parent[parts.at(-1)] === value, true, `${path} was mutated`);
};
assert.equal(inspectMapPack(pack).length, 0, JSON.stringify(inspectMapPack(pack)));
assert.equal(inspectMapPack(null)[0].path, "pack");

for (const [path, value, expected] of [
  ["nodes", {}, "nodes"],
  ["nodes[0]", null],
  ["nodes[0].id", "b", "nodes[1].id"],
  ["nodes[0].x", null],
  ["nodes[0].y", "north"],
  ["edges", {}],
  ["edges[0]", null],
  ["edges[0].id", "west", "edges[1].id"],
  ["edges[0].from", "missing"],
  ["edges[0].to", "missing"],
  ["edges[0].pts", [[0, 0]]],
  ["edges[0].length", -1],
  ["edges[0].limit", -1],
  ["edges[0].lanes", 0],
  ["edges[0].lane_offsets", [null]],
  ["edges[0].asphalt", [2, -2]],
  ["edges[0].lane_width", -3],
  ["edges[0].cls", false],
  ["edges[0].name", []],
  ["edges[0].oneway", "false"],
  ["lanes", {}],
  ["lanes[0]", null],
  ["lanes[0].edge", "missing"],
  ["lanes[0].idx", -1],
  ["lanes[0].idx", 2],
  ["lanes[0].edge", "west", "lanes[1].idx"],
  ["lanes[0].pts", [[0, 0], null]],
  ["bbox", [1, 4, 0, 3]],
  ["routing_bbox", ["-123", 2, -122, 3]],
  ["extent", { xmin: 0 }],
  ["utc_offset", 20],
  ["intersections", {}],
  ["intersections[0]", null],
  ["intersections[0].id", ""],
  ["intersections[0].x", "12"],
  ["intersections[0].y", null],
  ["intersections[0].vertices", "a"],
  ["intersections[0].approaches", {}],
  ["intersections[0].approaches[0].edge", "absent"],
  ["intersections[0].approaches[0].s_line", -1],
  ["intersections[0].approaches[0].group", "C"],
  ["intersections[0].cycle_s", 0],
  ["intersections[0].offset_s", -10],
  ["stops", {}],
  ["stops[0]", null],
  ["stops[0].id", ""],
  ["stops[0].edge", "missing"],
  ["stops[0].s_line", -2],
  ["stops[0].all_way", 1],
  ["yields", {}],
  ["yields[0].id", false],
  ["yields[0].edge", "missing"],
  ["yields[0].s_line", -2],
  ["roundabouts", {}],
  ["roundabouts[0].id", 8],
  ["roundabouts[0].vertices", [null]],
  ["roundabouts[0].edges", ["missing"]],
  ["roundabouts[0].x", null],
  ["roundabouts[0].y", null],
  ["roundabouts[0].island_r", -1],
  ["roundabouts[0].lane_r", 2],
  ["roundabouts[0].outer_r", 5],
  ["roundabouts[0].ccw", "true"],
  ["edges[0].control", "signal"],
  ["edges[0].control.id", ""],
  ["edges[0].control.type", "green"],
  ["edges[0].control.s_line", -5],
  ["edges[0].control.group", "C"],
  ["crossings", []],
  ["crossings.crossings[0].id", ""],
  ["crossings.crossings[0].edge", "missing"],
  ["crossings.crossings[0].x", null],
  ["crossings.crossings[0].y", null],
  ["crossings.crossings[0].s", -1],
  ["crossings.crossings[0].island", "false"],
  ["crossings.crossings[0].pxo", "yes"],
  ["crossings.crossings[0].markings", 4],
  ["calming.devices[0].id", ""],
  ["calming.devices[0].kind", "unknown"],
  ["calming.devices[0].x", null],
  ["calming.devices[0].y", null],
  ["calming.devices[0].at", {}],
  ["calming.devices[0].at[0].edge", "missing"],
  ["calming.devices[0].at[0].s", -10],
  ["contraflow.edges[0].edge", "missing"],
  ["edges[0].oneway", false, "contraflow.edges[0].edge"],
  ["contraflow.edges[0].side", "middle"],
  ["contraflow.edges[0].kind", "separated"],
  ["driveways.driveways[0].id", ""],
  ["driveways.driveways[0].edge", "missing"],
  ["driveways.driveways[0].side", "west"],
  ["driveways.driveways[0].s", -1],
  ["driveways.driveways[0].x", null],
  ["driveways.driveways[0].y", null],
  ["driveways.driveways[0].heading", "north"],
  ["driveways.driveways[0].length", 0],
  ["buslanes.lanes[0].edge", "gone"],
  ["buslanes.lanes[0].lane", 2],
  ["buslanes.lanes[0].allowed", [3]],
  ["buslanes.lanes[0].hours", [{ ...interval, start: -1 }]],
  ["zones.zones[0].kind", "hospital"],
  ["zones.zones[0].name", 3],
  ["zones.zones[0].spans[0].edge", "missing"],
  ["zones.zones[0].spans[0].from", -10],
  ["zones.zones[0].spans[0].to", 10],
  ["parks.areas[0].id", ""],
  ["parks.areas[0].kind", "parking"],
  ["parks.areas[0].closed", "yes"],
  ["parks.areas[0].rings", [points]],
  ["parks.areas[0].lines", ["river"]],
  ["parks.spans[0].edge", "gone"],
  ["parks.spans[0].from", -1],
  ["parks.spans[0].to", 19],
  ["parks.spans[0].left", "missing"],
  ["parks.spans[0].right", "missing"],
  ["parks.spans[0].water", 1],
  ["bridges.spans[0].edge", "gone"],
  ["bridges.spans[0].from", -1],
  ["bridges.spans[0].to", 19],
  ["bridges.spans[0].name", 1],
  ["bridges.spans[0].kind", 1],
  ["scrambles.scrambles[0].signal", "gone"],
  ["transit.stops[0].id", ""],
  ["transit.stops[0].name", []],
  ["transit.stops[0].x", null],
  ["transit.stops[0].y", null],
  ["transit.routes[0].id", ""],
  ["transit.routes[0].mode", "foot"],
  ["transit.routes[0].ref", 169],
  ["transit.routes[0].colour", 0],
  ["transit.routes[0].runs", {}],
  ["transit.routes[0].runs[0].edges", []],
  ["transit.routes[0].runs[0].stops", {}],
  ["transit.routes[0].runs[0].stops[0].s", -1],
  ["rail.tracks[0].id", ""],
  ["rail.tracks[0].pts", []],
  ["rail.tracks[0].length", 0],
  ["rail.tracks[0].kind", false],
  ["rail.tracks[0].ends", ["edge"]],
  ["rail.tracks[0].stops[0].s", -1],
  ["rail.crossings[0].id", ""],
  ["rail.crossings[0].track", "missing"],
  ["rail.crossings[0].s", -1],
  ["rail.crossings[0].x", null],
  ["rail.crossings[0].y", null],
  ["rail.crossings[0].heading_deg", "inbound"],
  ["rail.crossings[0].lights", "yes"],
  ["rail.crossings[0].gates", "yes"],
  ["rail.crossings[0].bell", "yes"],
  ["rail.crossings[0].edges[0].edge", "missing"],
  ["rail.crossings[0].edges[0].s", -1],
  ["rail.crossings[0].edges[0].angle_deg", "north"],
  ["buildings[0].pts", points],
  ["buildings[0].h", -5],
])
  check(path, value, expected);

const runtime = (input, pattern) => assert.throws(() => new MapData(input), pattern);
runtime(null, /Map pack pack requires an? map pack object/);
runtime({ ...pack, lanes: {} }, /Map pack lanes requires an array/);
runtime({ ...pack, stops: [null] }, /stops\[0\] requires an object/);
runtime({ ...pack, intersections: [null] }, /intersections\[0\] requires an object/);
runtime({ ...pack, lanes: [{ ...pack.lanes[0], edge: "gone" }] }, /lanes\[0\]\.edge requires an existing road id/);
runtime({ ...pack, lanes: [pack.lanes[0], pack.lanes[0]] }, /a unique lane index/);
runtime(
  {
    ...pack,
    lanes: [
      {
        ...pack.lanes[0],
        pts: [
          [0, 0],
          [1e20, 0],
        ],
      },
    ],
  },
  /too long to index/,
);
const valid = new MapData(pack);
const damaged = new MapData({
  ...pack,
  crossings: { crossings: [null, ...pack.crossings.crossings] },
  contraflow: { edges: [null, ...pack.contraflow.edges] },
  driveways: { driveways: [null, ...pack.driveways.driveways] },
  parks: { ...pack.parks, spans: [null, ...pack.parks.spans] },
  bridges: { spans: [null, ...pack.bridges.spans] },
  calming: { devices: [null, { ...pack.calming.devices[0], at: [null, ...pack.calming.devices[0].at] }] },
});
assert.equal(damaged.pxos.length, valid.pxos.length);
assert.equal(damaged.crosswalks.length, 0);
assert.equal(damaged.contraflow.size, valid.contraflow.size);
assert.equal(damaged.driveways.length, valid.driveways.length);
assert.equal(damaged.parkSpans.length, valid.parkSpans.length);
assert.equal(damaged.bridges.length, valid.bridges.length);
assert.equal(damaged.calmingSpans.get("east").length, valid.calmingSpans.get("east").length);

assert.equal(valid.lanesNear(30, 0, 1e70).length, 2);
assert.equal(valid.lanesNear(1e70, 0).length, 0);
assert.equal(valid.lanesNear(30, 0, Infinity).length, 0);
assert.equal(valid.lanesNear(30, 0, -1).length, 0);
assert.equal(valid.lanesNear(NaN, 0).length, 0);
assert.equal(valid.nearestLane(30, 0, Infinity), null);
assert.equal(valid.nearestLane(30, 0, 0, 60, -1), null);
assert.equal(valid.successors("gone").length, 0);
assert.equal(valid.controlOf("gone"), null);
assert.equal(valid.headingIn("gone"), NaN);
assert.equal(valid.headingOut("gone"), NaN);
assert.equal(valid.classifyTurn(NaN), null);
assert.equal(valid.crossingHalfWidth("gone"), 0);
assert.equal(valid.junctionNodes({ approaches: [{ edge: "gone" }] }).size, 0);
// An exactly equidistant lane chosen in the dense lookup wins in the sparse lookup too.
assert.equal(valid.nearestLane(30, 0, null, 0).lane.edge, valid.nearestLane(30, 0, null, 1e80).lane.edge);
let reads = 0;
const counting = [0, 0];
Object.defineProperty(counting, 0, {
  get: () => {
    reads++;
    return 0;
  },
});
const lane = valid.lane("east", 0);
lane.pts = [counting, points[1]];
const center = [30, 0];
projectPoint(lane.pts, cumulative(points), center);
const oneProjection = reads;
reads = 0;
valid.nearestLane(...center, Math.PI / 2);
assert.equal(reads, oneProjection, "distance fallback projects the lane once");

// Canonical packs and layers provide a second, real-world sample for the inspection contract.
const dir = new URL("../data/maps/", import.meta.url);
const files = readdirSync(dir);
let total = 0;
for (const file of files.filter((name) => name.endsWith(".v6.pack.json"))) {
  const data = JSON.parse(readFileSync(new URL(file, dir), "utf8"));
  const key = file.split(".")[0];
  for (const layer of files.filter((name) => name.startsWith(`${key}.`) && /\.v\d+\.json$/.test(name))) {
    const [, name] = layer.split(".");
    data[name] = JSON.parse(readFileSync(new URL(layer, dir), "utf8"));
  }
  const issues = inspectMapPack(data);
  assert.equal(issues.length, 0, `${key}: ${JSON.stringify(issues.slice(0, 8))}`);
  total++;
}
assert.equal(total >= 12, true);
console.log(`Map lookup and inspection checks passed, including ${total} bundled packs`);
process.exit(0);
