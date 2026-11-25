import assert from "node:assert/strict";
import { hull } from "../static/js/map/junctions.js";
import {
  MapData,
  cumulative,
  headingAt,
  joinLanes,
  onStreet,
  pointAt,
  projectPoint,
  roadRank,
  wrapAngle,
} from "../static/js/map/mapdata.js";
import { sidewalkOffset, streetOf } from "../static/js/map/streets.js";

const corner = [
  [0, 0],
  [10, 0],
  [10, 10],
];
const station = cumulative(corner);
assert.deepEqual(pointAt(corner, station, -1), [0, 0], "distance before start clamps");
assert.deepEqual(pointAt(corner, station, 21), [10, 10], "distance past end clamps");
assert.deepEqual(pointAt(corner, station, 15), [10, 5], "station follows arc-length through bends");
assert.equal(headingAt(corner, station, 10), Math.PI / 2, "heading at a vertex uses the departing segment");

const repeated = [
  [0, 0],
  [0, 0],
  [10, 0],
];
const projection = projectPoint(repeated, cumulative(repeated), [4, -2]);
assert.equal(projection.s, 4, "a duplicate point adds no distance");
assert.equal(projection.lateral, 2, "positive lateral is to the right");
assert.equal(projectPoint([], [0], [0, 0]), null, "an empty line has no closest segment");

const line = Array.from({ length: 80 }, (_, i) => [10 * i, 0]);
const meters = cumulative(line);
assert.equal(projectPoint(line, meters, [651, 2], 10).index, 65, "a stale hint falls back to the full line");
assert.equal(
  projectPoint(line, meters, [361, 0], 10).index,
  36,
  "a near hit at a hint boundary still searches outside it",
);
assert.equal(wrapAngle(-Math.PI), Math.PI, "the canonical half-turn is positive");

const before = [
  [0, 0],
  [10, 0],
];
assert.deepEqual(joinLanes(before, []), before);
assert.notEqual(joinLanes(before, []), before);
assert.deepEqual(
  joinLanes(before, [
    [10, 0],
    [12, 0],
  ]),
  [
    [0, 0],
    [10, 0],
    [12, 0],
  ],
);
assert.deepEqual(
  joinLanes(
    before,
    [
      [10, 5],
      [20, 5],
    ],
    { blend: 3 },
  ),
  [
    [0, 0],
    [7, 0],
    [13, 5],
    [20, 5],
  ],
);
const interior = [30, 0];
let reads = 0;
Object.defineProperty(interior, 0, {
  get() {
    reads++;
    return 30;
  },
});
joinLanes(before, [[10, 0], [20, 0], interior, [40, 0]]);
assert.equal(reads, 2, "the outgoing interior point is measured once per adjacent segment");

assert.deepEqual(
  hull([
    [2, 3],
    [2, 3],
    [2, 3],
  ]),
  [[2, 3]],
);
assert.deepEqual(
  hull([
    [2, 0],
    [0, 0],
    [1, 0],
    [1, 0],
  ]),
  [
    [0, 0],
    [2, 0],
  ],
);
const square = [
  [1, 1],
  [0, 0],
  [0.5, 0.5],
  [0, 1],
  [1, 0],
];
assert.deepEqual(hull(square), [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
]);
assert.deepEqual(square[0], [1, 1], "computing a junction hull does not reorder the input");

assert.equal(roadRank({ cls: "constructor" }), 1);
assert.deepEqual(streetOf({ cls: "secondary_link" }), [0, 2.6]);
assert.deepEqual(streetOf({ cls: "constructor" }), [1, 1.8]);
assert.deepEqual(streetOf({}), [1, 1.8]);
const asym = { cls: "residential", asphalt: [-3, 7] };
assert.ok(Math.abs(sidewalkOffset(asym, 1) - 10.07) < 1e-12);
assert.ok(Math.abs(sidewalkOffset(asym, -1) + 6.07) < 1e-12);

const edge = {
  ...asym,
  id: "east",
  from: "a",
  to: "b",
  pts: [
    [0, 0],
    [100, 0],
  ],
  length: 100,
  lanes: 1,
  lane_offsets: [2],
};
const map = new MapData({
  nodes: [
    { id: "a", x: 0, y: 0 },
    { id: "b", x: 100, y: 0 },
  ],
  edges: [edge],
  lanes: [
    {
      edge: "east",
      idx: 0,
      pts: [
        [0, -2],
        [100, -2],
      ],
    },
  ],
  stops: [],
  intersections: [],
});
assert.equal(map.lanesNear(51, -2).length, 1, "a lane crossing cells appears only once");
assert.equal(map.nearestLane(20, -2, Math.PI)?.lane.edge, "east", "heading mismatches get a distance-only fallback");
assert.equal(map.nearestLane(20, -20, null, 3), null, "candidate lanes outside the radius are excluded");
assert.equal(map.roadDistance(50, -8).distance, 1, "distance uses asymmetric edges of asphalt");
assert.equal(map.roadDistance(102, -2).distance, 2, "distance beyond an edge includes the overshoot");
assert.equal(map.roadDistance(500, 500).distance, Infinity, "the empty search returns no imaginary surface");

const street = map.edges.get("east");
assert.equal(onStreet(street, { x: 104, y: 0, psi: Math.PI })?.opposite, true);
assert.equal(onStreet(street, { x: 108, y: 0, psi: Math.PI }), null);
assert.equal(onStreet(street, { x: 50, y: 12, psi: 0 }), null);

console.log("Map helper contracts passed");
