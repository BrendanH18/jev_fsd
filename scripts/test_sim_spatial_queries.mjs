import assert from "node:assert/strict";
import { test } from "node:test";
import { boxGap, corridorQuery, obbOverlap, pointBoxDist, polygonBounds } from "../static/js/sim/collision.js";
import { Visibility } from "../static/js/sim/visibility.js";
import { CAR, Vehicle } from "../static/js/sim/vehicle.js";
import { setWeather } from "../static/js/sim/weather.js";
globalThis.document = { querySelector: () => null };
const { StaticObstacles, obbCircleOverlap } = await import("../static/js/sim/static-obstacles.js");
const { segmentHitsBox } = await import("../static/js/sim/crosswalk.js");
const { fixtureWorld } = await import("../static/tests/jev-fixtures.js");

const rect = (x0, y0, x1, y1) => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];
const box = (x, y, halfLength = 2, halfWidth = 1, heading = 0) => ({
  center: [x, y],
  halfLength,
  halfWidth,
  heading,
});
const sightWith = (pts, h = 4) => new Visibility({ pack: { buildings: [{ pts, h }] } });
const carAt = (x, y, id) => Object.assign(new Vehicle(x, y), { id });

test("Fail a collision query whose close encounter has an invalid pose", () => {
  const stopped = box(0, 0);
  assert.throws(() => obbOverlap(stopped, box(NaN, 0)), /collision box pose/);
  assert.throws(() => obbOverlap(stopped, box(1, 0, 2, 1, Infinity)), /collision box pose/);
});

test("Compute each box's heading axes once across all collision projections", () => {
  let reads = 0;
  const a = {
    ...box(0, 0),
    get heading() {
      reads++;
      return Math.PI / 5;
    },
  };
  const b = {
    ...box(0, 0),
    get heading() {
      reads++;
      return Math.PI / 7;
    },
  };
  assert.equal(obbOverlap(a, b), true);
  assert.equal(reads, 2);
});

test("Preserve collision verdicts for swapped box order in angled encounters", () => {
  const a = box(17, -20, 2, 1, Math.PI / 3);
  for (const y of [-24, -22, -20, -18, -16]) {
    const b = box(17, y, 1.2, 0.4, Math.PI / 7);
    assert.equal(obbOverlap(a, b), obbOverlap(b, a));
  }
  assert.equal(obbOverlap(a, box(17, -20, 1.2, 0.4, Math.PI / 7)), true);
  assert.equal(obbOverlap(a, box(17, -16, 1.2, 0.4, Math.PI / 7)), false);
});

test("Treat tangent box bodies as contact and distinguish a positive gap", () => {
  assert.equal(obbOverlap(box(0, 0), box(4, 0)), true);
  assert.equal(boxGap(box(0, 0), box(4.25, 0)), 0.25);
});

test("Split collision clearance margins equally between two vehicle footprints", () => {
  assert.equal(obbOverlap(box(0, 0), box(0, 2.25), 0.25), true);
  assert.equal(obbOverlap(box(0, 0), box(0, 2.25), 0.24), false);
});

test("Measure point clearance in the rotated box frame", () => {
  assert.ok(Math.abs(pointBoxDist([2, 0], box(0, 0, 3, 1, Math.PI / 2)) - 1) < 1e-9);
  assert.equal(pointBoxDist([0, 2], box(0, 0, 3, 1, Math.PI / 2)), 0);
});

test("Separate diagonally offset vehicles whose world-axis bounding boxes overlap", () => {
  const a = box(0, 0, 2, 0.15, Math.PI / 4);
  const b = box(0, 1, 2, 0.15, Math.PI / 4);
  assert.equal(obbOverlap(a, b), false);
  assert.ok(boxGap(a, b) > 0.4);
});

test("Apply scenery margins to the vehicle half-extents before a circle contact test", () => {
  const b = box(0, 0);
  const post = { x: 2.5, y: 0, radius: 0.25 };
  assert.equal(obbCircleOverlap(b, post, 0.5), true);
  assert.equal(obbCircleOverlap(b, post, 0.49), false);
});

test("Clip pedestrian sight segments to a rotated moving vehicle footprint", () => {
  const b = box(0, 0, 2, 1, Math.PI / 2);
  assert.equal(segmentHitsBox([-4, 1.5], [4, 1.5], b), true);
  assert.equal(segmentHitsBox([-4, 2.5], [4, 2.5], b), false);
});

test("Build polygon bounds without spreading the vertices into call arguments", () => {
  const points = Array.from({ length: 150000 }, (_, i) => [(i % 9) - 5, (i % 17) - 10]);
  assert.deepEqual(polygonBounds(points), [-5, -10, 3, 6]);
});

test("Ignore malformed polygon vertices when indexing sightline obstructions", () => {
  const sight = sightWith([[NaN, 0], null, [0, 1]]);
  assert.equal(sight.occluded([-2, 0], [2, 0]), false);
  assert.equal(sight.grid.size, 0);
});

test("Visit static obstacle cells in coordinate order across zero even if the buildings were inserted in reverse", () => {
  const index = new StaticObstacles({
    pack: {
      buildings: [
        { id: "east", pts: rect(25, -2, 35, 2), h: 8 },
        { id: "west", pts: rect(-35, -2, -25, 2), h: 8 },
      ],
    },
  });
  assert.deepEqual(
    index.query([-40, -3, 40, 3]).map((o) => o.id),
    ["building:west", "building:east"],
  );
});

test("Avoid unbounded static grid iteration on non-finite or unsafe pose bounds", () => {
  const index = new StaticObstacles({ pack: { buildings: [] } });
  assert.equal(index.query([Infinity, 0, Infinity, 0]).length, 0);
  assert.equal(index.query([1e30, 0, 1e30, 0]).length, 0);
});

test("Distinguish already-touching scenery from a sweep that first makes contact later", () => {
  const index = new StaticObstacles({ pack: { buildings: [{ pts: rect(-2, -2, 4, 2), h: 8 }] } });
  const from = { x: 0, y: 0, psi: 0 };
  const hit = index.sweep(from, { x: 10, y: 0, psi: 0 }, CAR);
  assert.equal(hit.fraction, 0);
  assert.equal(hit.safePose.x, 0);
});

test("Find visibility blockers across negative and positive spatial grid cells", () => {
  const sight = sightWith(rect(-30, -26, -28, 26));
  assert.equal(sight.occluded([-60, -26], [30, 26]), true);
  assert.equal(sight.occluded([-60, 27], [30, 27]), false);
});

test("Treat a ray endpoint inside a building as an obstruction even without a wall crossing", () => {
  const sight = sightWith(rect(2, -2, 8, 2));
  assert.equal(sight.occluded([3, 0], [7, 0]), true);
});

test("Leave low mapped objects out of the building sightline index", () => {
  assert.equal(sightWith(rect(2, -2, 4, 2), 1.49).occluded([0, 0], [10, 0]), false);
  assert.equal(sightWith(rect(2, -2, 4, 2), 1.5).occluded([0, 0], [10, 0]), true);
});

test("Fail closed on invalid sight coordinates without consulting the scene or glare hook", () => {
  const sight = new Visibility({ pack: {} });
  sight.glare = () => assert.fail("invalid endpoints must be rejected before glare lookup");
  assert.equal(sight.canSee({ x: 0, y: 0 }, NaN, 2), false);
  assert.equal(sight.occluded([0, 0], [Infinity, 0]), true);
});

test("Keep an observer's extended passing reach bounded by daytime weather and glare", () => {
  const sight = new Visibility({ pack: {} });
  const observer = { x: 0, y: 0, psi: 0 };
  setWeather("dry");
  assert.equal(sight.canSee(observer, 150, 0, 200), true);
  sight.glare = () => 100;
  assert.equal(sight.canSee(observer, 150, 0, 200), false);
  sight.glare = null;
  setWeather("rain");
  assert.equal(sight.canSee(observer, 70, 0, 200), false);
  setWeather("dry");
});

test("Reject a sight target when the injected visibility range is not a number", () => {
  const sight = new Visibility({ pack: {} });
  sight.glare = () => NaN;
  assert.equal(sight.canSee({ x: 0, y: 0 }, 1, 0), false);
});

test("Stop visibility sampling once an actor's centre is seen", () => {
  const sight = new Visibility({ pack: {} });
  const calls = [];
  sight.canSee = (_observer, x, y) => {
    calls.push([x, y]);
    return true;
  };
  const object = {
    obb: () => ({
      center: [4, 6],
      get heading() {
        return assert.fail("needless end samples");
      },
    }),
  };
  assert.equal(sight.sees({ x: 0, y: 0 }, object), true);
  assert.deepEqual(calls, [[4, 6]]);
});

test("Retain nose-only and tail-only actor visibility around a building", () => {
  const sight = sightWith(rect(2, -5, 4, 1));
  const observer = { x: 0, y: 0, psi: 0 };
  const object = { obb: () => box(8, 0, 5, 1, Math.PI / 2) };
  assert.equal(sight.canSee(observer, 8, 0), false);
  assert.equal(sight.canSee(observer, 8, -5), false);
  assert.equal(sight.sees(observer, object), true);
  object.obb = () => box(8, 0, 5, 1, -Math.PI / 2);
  assert.equal(sight.sees(observer, object), true);
});

test("Keep corridor probes independent of the ego's route hint", () => {
  const route = {
    hint: 8,
    project(x, y, hint) {
      if (hint == null) this.hint = 99;
      return { s: x, lateral: y, distance: Math.abs(y), index: 99 };
    },
  };
  assert.equal(corridorQuery(route, 10, 50, 1, [carAt(20, 0, "lead")]).length, 1);
  assert.equal(route.hint, 8);
});

test("Sort corridor matches by progress while preserving order at equal distances", () => {
  const { route } = fixtureWorld();
  const cars = [carAt(35, 0, "far"), carAt(20, 0, "first"), carAt(20, 0, "second"), carAt(14, -4, "other-lane")];
  assert.deepEqual(
    corridorQuery(route, 10, 40, 1, cars).map((m) => m.vehicle.id),
    ["first", "second", "far"],
  );
});

test("Measure corridor occupancy in the lane frame after a road-lane transition", () => {
  const { route } = fixtureWorld();
  const cars = [carAt(20, -3.5, "changing-frame"), carAt(20, 0, "other-lane")];
  const results = corridorQuery(route, 10, 35, 1, cars, 0, 0, () => -3.5);
  assert.deepEqual(
    results.map((m) => m.vehicle.id),
    ["changing-frame"],
  );
  assert.equal(results[0].lateral, 0);
});
