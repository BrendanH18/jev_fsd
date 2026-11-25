import assert from "node:assert/strict";
import { browserDrives, browserRoute, routeFromLanes } from "../static/js/demo/routing.js";
import { buildingShapes, minRect } from "../static/js/map/building-scenery.js";
import { onJunctionFill } from "../static/js/map/junctions.js";
import {
  cumulative,
  headingAt,
  joinLanes,
  MapData,
  onStreet,
  pointAt,
  projectPoint,
  rightOnRedAllowed,
  wrapAngle,
} from "../static/js/map/mapdata.js";
import { Route } from "../static/js/map/route.js";

const east = [
  [0, 0],
  [100, 0],
];
const north = [
  [100, 0],
  [100, 100],
];
const a = {
  id: "a",
  from: "1",
  to: "2",
  pts: east,
  length: 100,
  lanes: 1,
  lane_offsets: [0],
  asphalt: [-2, 2],
  limit: 10,
  name: "East",
};
const b = { ...a, id: "b", from: "2", to: "3", pts: north, name: "North", limit: 8 };
const map = new MapData({
  edges: [a, b],
  lanes: [a, b].map((edge) => ({ edge: edge.id, idx: 0, pts: edge.pts })),
  nodes: [
    { id: "1", x: 0, y: 0 },
    { id: "2", x: 100, y: 0 },
    { id: "3", x: 100, y: 100 },
  ],
  stops: [],
  intersections: [],
});
const from = { x: 10, y: 0 };
const to = { x: 100, y: 70 };
const chain = [map.lane("a", 0), map.lane("b", 0)];
const routeData = browserRoute(map, from, to);

for (const [start, goal, options, pattern] of [
  [null, to, {}, /from must be a pose/],
  [from, [], {}, /to must be a pose/],
  [{ ...from, x: NaN }, to, {}, /from\.x/],
  [{ ...from, y: "0" }, to, {}, /from\.y/],
  [from, { ...to, x: 1 / 0 }, {}, /to\.x/],
  [from, { ...to, y: null }, {}, /to\.y/],
  [{ ...from, heading: false }, to, {}, /from\.heading/],
  [from, to, null, /Route options must be an object/],
  [from, to, { restrictions: 1 }, /restrictions must be a boolean/],
  [from, to, { hour: "12" }, /hour must be a finite number/],
  [from, to, { weekday: 1.5 }, /weekday must be an integer/],
  [from, to, { avoid: "b" }, /avoid must be a list/],
  [from, to, { avoid: [null] }, /avoid must be a list/],
])
  assert.throws(() => browserRoute(map, start, goal, options), pattern);
assert.throws(() => browserDrives(map, { ...from, x: NaN }), /from\.x/);
for (const [lanes, start, end, pattern] of [
  [[], 0, 76, /at least one lane/],
  [chain, NaN, 76, /start distance/],
  [chain, 0, Infinity, /goal distance/],
  [[chain[0], null], 0, 76, /lane 1 is missing/],
  [[{ ...chain[0], pts: [] }], 0, 76, /requires geometry/],
  [[{ ...chain[0], cum: [0] }], 0, 76, /matching arc lengths/],
  [[{ ...chain[0], length: NaN }], 0, 76, /requires a finite length/],
  [[{ ...chain[0], edgeRef: null }], 0, 76, /requires an edge/],
  [
    [
      {
        ...chain[0],
        pts: [
          [0, 0],
          [1e20, 0],
        ],
        cum: [0, 1e20],
        length: 1e20,
      },
    ],
    0,
    null,
    /too long to resample/,
  ],
])
  assert.throws(() => routeFromLanes(map, lanes, start, end), pattern);

assert.equal(routeData.edges.join(","), "a,b");
assert.equal(routeData.turns[0].dir, "left");
assert.equal(routeData.turns[0].at_m, 90);
assert.equal(routeData.turns[0].street, "North");
assert.equal(routeData.polyline[0][0], 10);
assert.equal(routeData.polyline.at(-1)[1], 70);
assert.equal(browserRoute(map, from, to, { avoid: ["a"] }).edges.join(","), "a,b");
assert.equal(browserRoute(map, from, to, { avoid: ["b"] }), null);
assert.equal(browserRoute(map, from, { x: 9, y: 0 }), null);
assert.equal(browserRoute(map, from, { x: 50, y: 0 }).edges.join(","), "a");
assert.equal(browserRoute(map, from, { x: 500, y: 0 }), null);
assert.equal(browserRoute(map, { x: 500, y: 0 }, to), null);
const disconnected = {
  edges: map.edges,
  nearestLane: map.nearestLane.bind(map),
  successors: map.successors.bind(map),
  turnAngle: map.turnAngle.bind(map),
  classifyTurn: map.classifyTurn.bind(map),
  lane: () => undefined,
};
assert.equal(browserRoute(disconnected, from, to), null);

for (const [data, pattern] of [
  [null, /Route data must be an object/],
  [{ ...routeData, polyline: [] }, /at least one point/],
  [
    {
      ...routeData,
      polyline: [
        [0, 0],
        [0, Infinity],
      ],
    },
    /point 1 must have finite/,
  ],
  [
    {
      ...routeData,
      polyline: [
        [-1e308, 0],
        [1e308, 0],
      ],
    },
    /length must be finite/,
  ],
  [{ ...routeData, edges: "a" }, /edges must be an array/],
  [{ ...routeData, edges: ["gone"] }, /unknown road gone/],
  [{ ...routeData, start_s: "1" }, /start_s must be finite/],
  [{ ...routeData, goal_s: Infinity }, /goal_s must be finite/],
  [{ ...routeData, turns: {} }, /turns must be an array/],
  [{ ...routeData, turns: [null] }, /requires a direction/],
  [{ ...routeData, turns: [{ dir: "left", at_m: NaN }] }, /requires a finite distance/],
])
  assert.throws(() => new Route(data, map), pattern);
const legacy = new Route({ polyline: east, edges: ["a"] }, map);
assert.equal(legacy.turnsAfter(0).length, 0);
const endOnly = new Route({ polyline: [[10, 0]], edges: ["a"], turns: [{ dir: "uturn", at_m: 10 }] }, map);
assert.equal(endOnly.turnsAfter(0)[0].at_m, 10);
assert.equal(endOnly.headingAt(0), 0);
assert.equal(endOnly.project(10, 3).distance, 3);
assert.equal(endOnly.offsetPointAt(0, 2)[1], -2);
assert.equal(legacy.offsetPointAt(NaN, 2), undefined);
assert.equal(legacy.offsetPointAt(0, NaN), undefined);
assert.equal(legacy.curveSpeedAt(0), Infinity);
assert.throws(() => legacy.curveSpeedAt(0, 15, -1), /Lateral acceleration/);
const route = new Route(routeData, map);
route.project(60, 0);
const oldHint = route.hint;
assert.equal(route.project(NaN, 0), null);
assert.equal(route.hint, oldHint);
assert.equal(route.project(10, 0, 0).index, 0);
assert.equal(route.hint, oldHint);
assert.equal(route.remaining(route.length + 5), 0);
assert.equal(route.limitMarks[0].limit, 8);
assert.equal(route.limitsAhead(route.limitMarks[0].at, 2).length, 0);
assert.equal(route.limitsAhead(route.limitMarks[0].at - 2, 2).length, 1);

const cum = cumulative(east);
assert.equal(pointAt([], [0], 1), undefined);
assert.equal(pointAt(east, cum, NaN), undefined);
assert.equal(pointAt(east, [0], 1), undefined);
assert.equal(pointAt([east[0]], [0], NaN), undefined);
assert.equal(pointAt([east[0]], [0], 100), east[0]);
assert.equal(headingAt([], [0], 0), NaN);
assert.equal(headingAt(east, cum, NaN), NaN);
assert.equal(headingAt(east, [0], 0), NaN);
assert.equal(projectPoint(east, [0], [10, 0]), null);
assert.equal(projectPoint(east, cum, [10, Infinity]), null);
assert.equal(projectPoint(east, cum, [10, 1], 1.25).distance, 1);
assert.equal(projectPoint([east[0]], [0], [3, 4]).distance, 5);
assert.equal(projectPoint([east[0]], [0], [3, 4]).lateral, 0);
assert.equal(projectPoint(east, cum, [20, -2]).lateral, 2);
assert.equal(projectPoint(east, cum, [20, 2]).lateral, -2);
assert.equal(projectPoint(east, cum, [105, -2]).s, 100);
assert.equal(wrapAngle(Infinity), NaN);
assert.equal(Number.isFinite(wrapAngle(1e100)), true);
assert.equal(wrapAngle(-Math.PI), Math.PI);
assert.equal(rightOnRedAllowed(["-73.58", 45.5, -73.57, 45.51]), true);
assert.equal(rightOnRedAllowed([-73.58, 45.5, -73.57, 45.51]), false);
assert.throws(() => joinLanes(east, north, { blend: -1 }), /blend must be finite and nonnegative/);
assert.throws(() => joinLanes(east, north, { radius: NaN }), /radius must be finite and nonnegative/);
assert.equal(onStreet(map.edges.get("a"), { ...from, psi: NaN }), null);
assert.equal(onJunctionFill(null, Infinity, 5), false);

assert.equal(minRect([null, [0, 1]]), null);
assert.equal(
  minRect([
    [0, 0],
    [1, 0],
  ]).hw,
  0,
);
const triangle = [
  [0, 0],
  [0, 4],
  [4, 0],
];
const buildings = buildingShapes({
  edges: new Map(),
  pack: {
    buildings: [
      null,
      { pts: [null, ...triangle], h: 5 },
      { pts: triangle, h: null },
      {
        pts: [
          [0, 0],
          [0, 1e307],
          [1e307, 0],
        ],
        h: 5,
      },
      { pts: triangle, h: 5 },
    ],
  },
});
assert.equal(buildings.length, 1);
assert.equal(buildings[0].i, 4);
console.log("Browser route, projection and scenery edge cases passed");
process.exit(0);
