import assert from "node:assert/strict";
import { test } from "node:test";
import { cumulative } from "../static/js/map/mapdata.js";
import * as rail from "../static/js/sim/rail.js";
import { CAR, HERITAGE_STREETCAR, Vehicle } from "../static/js/sim/vehicle.js";

const track = {
  id: "rails",
  kind: "tram",
  pts: [
    [50, -100],
    [50, 100],
  ],
  cum: [0, 200],
  length: 200,
  ends: ["edge", "terminus"],
  stops: [],
  crossings: [],
};
const crossing = {
  id: "crossing",
  track: track.id,
  x: 50,
  y: 0,
  s: 100,
  half_m: 4,
  near: [
    [50, -30],
    [50, 30],
  ],
  edges: [{ edge: "road", angle_deg: 90 }],
};
const road = [
  [0, 0],
  [120, 0],
];
const cum = [0, 120];
const makeMap = (tracks = [track], crossings = [crossing]) => ({
  rail: { tracks, crossings },
  edges: new Map([["road", { width: 8 }]]),
});

function train(gap, dir = 1, v = 3) {
  const front = crossing.s - dir * (gap + crossing.half_m);
  return Object.assign(new Vehicle(0, 0, 0, v, HERITAGE_STREETCAR), rail.trainState(track, front, dir, v), {
    kind: "train",
  });
}

test("reuse a track index for repeated queries of the same map", () => {
  const map = makeMap();
  const index = rail.railIndex(map);
  assert.equal(rail.railIndex(map) === index, true);
});

test("default rail tracks without end or station metadata to terminals", () => {
  const parsed = rail.railIndex(makeMap([{ ...track, ends: undefined, stops: undefined }])).tracks.get(track.id);
  assert.equal(parsed.ends.join(","), "terminus,terminus");
  assert.equal(parsed.stops.length, 0);
});

test("skip rail records without a traversable polyline", () => {
  const parsed = rail.railIndex(
    makeMap([
      { ...track, id: "short", pts: [[0, 0]] },
      {
        ...track,
        id: "infinite",
        pts: [
          [0, 0],
          [Infinity, 0],
        ],
      },
      {
        ...track,
        id: "point",
        pts: [
          [0, 0],
          [0, 0],
        ],
      },
      null,
      track,
    ]),
  );
  assert.equal(parsed.tracks.size, 1);
});

test("extend both clipped ends of a track with repeated endpoint coordinates", () => {
  const parsed = rail
    .railIndex(makeMap([{ ...track, ends: ["edge", "edge"], pts: [[50, -100], ...track.pts, [50, 100]] }]))
    .tracks.get(track.id);
  assert.equal(parsed.pts[0][1], -160);
  assert.equal(parsed.pts.at(-1)[1], 160);
  assert.equal(parsed.length, 320);
});

test("shift stations and crossings along a clipped track without changing the source records", () => {
  const stop = { id: "stop", s: 55 };
  const map = makeMap([{ ...track, stops: [stop, null, { s: NaN }] }]);
  const index = rail.railIndex(map);
  assert.equal(index.tracks.get(track.id).stops.length, 1);
  assert.equal(index.tracks.get(track.id).stops[0].s, 115);
  assert.equal(index.crossings[0].s, 160);
  assert.equal(stop.s, 55);
  assert.equal(crossing.s, 100);
});

test("discard invalid rail crossings and individual invalid street references", () => {
  const result = rail.railIndex(
    makeMap(
      [track],
      [
        { ...crossing, edges: [{ edge: "missing", angle_deg: 45 }] },
        { ...crossing, edges: [{ edge: "road", angle_deg: Infinity }] },
        { ...crossing, edges: [{ edge: "road", angle_deg: 120 }] },
        { ...crossing, edges: null },
        { ...crossing, s: 600 },
        { ...crossing, x: NaN },
        { ...crossing, edges: [null, ...crossing.edges] },
      ],
    ),
  );
  assert.equal(result.crossings.length, 1);
  assert.equal(result.crossings[0].edges.length, 1);
});

test("cut each crossing's local track to the surrounding 30 metres", () => {
  const result = rail.railIndex(makeMap()).crossings[0];
  assert.equal(result.near[0][1], -30);
  assert.equal(result.near.at(-1)[1], 30);
});

test("sort crossings along the track for the train", () => {
  const result = rail.railIndex(makeMap([track], [crossing, { ...crossing, id: "earlier", s: 50, y: -50 }]));
  assert.equal(
    result.tracks
      .get(track.id)
      .crossings.map((c) => c.id)
      .join(","),
    "earlier,crossing",
  );
});

test("treat touching the near crossing boundary as zero ETA", () => {
  const n = train(0);
  assert.equal(rail.approach(n, crossing)?.eta_s, 0);
  assert.equal(rail.approach(n, crossing)?.coming, true);
});

test("clear the crossing once the train's rear reaches the far boundary", () => {
  const clear = HERITAGE_STREETCAR.length + 2 * crossing.half_m;
  assert.equal(rail.approach(train(-clear + 0.01), crossing)?.on, true);
  assert.equal(rail.approach(train(-clear - 0.01), crossing), null);
});

test("the moving threshold is strict at the approach and inclusive at the gong distance", () => {
  assert.equal(rail.approach(train(rail.GONG_M, 1, 0.3), crossing), null);
  assert.equal(rail.approach(train(rail.GONG_M, 1, 0.31), crossing)?.coming, true);
  assert.equal(rail.approach(train(rail.GONG_M + 0.01), crossing), null);
});

test("cap closing-time division for a crawling train", () => {
  assert.equal(rail.approach(train(8, 1, 0.4), crossing)?.eta_s, 16);
});

test("ignore trains that are gone or on a different track", () => {
  const n = train(10);
  n.rail.gone = true;
  assert.equal(rail.approach(n, crossing), null);
  n.rail.gone = false;
  n.rail.track = "siding";
  assert.equal(rail.approach(n, crossing), null);
});

test("reject malformed train and crossing envelopes without manufacturing a zero ETA", () => {
  const n = train(10);
  assert.equal(rail.approach(n, { ...crossing, half_m: Infinity }), null);
  n.rail.dir = 0;
  assert.equal(rail.approach(n, crossing), null);
  n.rail.dir = 1;
  n.v = Infinity;
  assert.equal(rail.approach(n, crossing), null);
});

test("choose the shortest ETA across trains travelling in both directions", () => {
  const near = train(10, 1, 1);
  const far = train(20, -1, 5);
  assert.equal(rail.trainAt([near, far], crossing)?.train === far, true);
});

test("keep the first train when two arrival estimates tie", () => {
  const a = train(18, 1, 3);
  const b = train(24, 1, 4);
  assert.equal(rail.trainAt([b, a], crossing)?.train === b, true);
});

test("return no crossing intersection outside the path distance window", () => {
  assert.equal(rail.crossingOnPath(road, cum, crossing, 51), null);
  assert.equal(rail.crossingOnPath(road, cum, crossing, 0, 49), null);
  assert.equal(rail.crossingOnPath(road, cum, crossing, 50, 50)?.s, 50);
});

test("skip parallel street geometry and examine the next segment", () => {
  const pts = [
    [40, -30],
    [40, 0],
    [80, 0],
  ];
  assert.equal(rail.crossingOnPath(pts, cumulative(pts), crossing)?.s, 40);
});

test("fold the crossing angle to be acute with either travel direction", () => {
  const pts = [
    [10, -40],
    [90, 40],
  ];
  const a = rail.crossingOnPath(pts, cumulative(pts), crossing);
  pts.reverse();
  const b = rail.crossingOnPath(pts, cumulative(pts), crossing);
  assert.ok(Math.abs(a.angle - Math.PI / 4) < 1e-9);
  assert.ok(Math.abs(a.angle - b.angle) < 1e-9);
});

test("reject misaligned cumulative distances in crossing geometry", () => {
  assert.equal(rail.crossingOnPath(road, [0], crossing), null);
  assert.equal(rail.crossingOnPath(road, [0, Infinity], crossing), null);
  assert.equal(rail.crossingOnPath(road, cum, crossing, 51, 49), null);
});

test("return crossings in the order of the road path even if the index is reversed", () => {
  const parallel = {
    ...track,
    id: "par",
    pts: [
      [20, -100],
      [20, 100],
    ],
  };
  const map = makeMap([track, parallel], [crossing, { ...crossing, track: "par", x: 20, id: "earlier" }]);
  assert.equal(
    rail
      .crossingsAhead(map, road, cum, 0, CAR)
      .map(({ c }) => c.id)
      .join(","),
    "earlier,crossing",
  );
});

test("preserve the crossing hold when slightly over its target at walking speed", () => {
  const x = { fouling: false, stop_m: -1.1, entry_m: 1 };
  assert.equal(rail.waitsAt(x, 1), true);
  assert.equal(rail.waitsAt(x, 2), false);
});

test("release the crossing hold for a vehicle occupying the envelope", () => {
  assert.equal(rail.waitsAt({ fouling: true, stop_m: 1, entry_m: 1 }, 0), false);
});

test("exclude a quickly departing queue from the room requirement", () => {
  const x = rail.crossingsAhead(makeMap(), road, cum, 10, CAR)[0];
  const car = new Vehicle(55, 0, 0, rail.QUEUE_MPS);
  assert.equal(rail.roomBlocker(road, cum, 10, CAR, x, [car]), null);
});

test("ignore malformed room blockers and unprojectable paths", () => {
  const x = rail.crossingsAhead(makeMap(), road, cum, 10, CAR)[0];
  const car = new Vehicle(55, 0, 0, 0);
  assert.equal(rail.roomBlocker(road, cum, 10, CAR, x, [null, { ...car, v: NaN }]), null);
  assert.equal(rail.roomBlocker([[0, 0]], [0], 10, CAR, x, [car]), null);
});

test("choose the closest eligible room blocker by the rear bumper", () => {
  const x = rail.crossingsAhead(makeMap(), road, cum, 10, CAR)[0];
  const a = new Vehicle(55, 0, 0, 0);
  const b = new Vehicle(58, 0, 0, 0);
  assert.equal(rail.roomBlocker(road, cum, 10, CAR, x, [b, a])?.vehicle === a, true);
});

test("detect stationary cross traffic on the envelope, with no hold for it past the tracks", () => {
  const x = rail.crossingsAhead(makeMap(), road, cum, 10, CAR)[0];
  const car = new Vehicle(50, 0, Math.PI / 2, 0);
  assert.equal(rail.roomBlocker(road, cum, 10, CAR, x, [car])?.vehicle === car, true);
  car.x = 54;
  assert.equal(rail.roomBlocker(road, cum, 10, CAR, x, [car]), null);
});

test("choose a train hold ahead of a room hold for the same crossing", () => {
  const car = new Vehicle(55, 0, 0, 0);
  const n = train(10);
  const hold = rail.crossingHold(makeMap(), road, cum, 10, CAR, 0, { trains: [n], vehicles: [car] });
  assert.equal(hold?.why, "train");
});

test("capture a room hold even when the driver cannot owe a stop for the train", () => {
  const car = new Vehicle(55, 0, 0, 0);
  const n = train(10);
  const hold = rail.crossingHold(makeMap(), road, cum, 10, CAR, 0, { trains: [n], vehicles: [car], owes: () => false });
  assert.equal(hold?.why, "room");
});

test("allow a crossing inquiry before actor lists are initialised", () => {
  assert.equal(rail.crossingHold(makeMap(), road, cum, 10, CAR, 0), null);
});

test("reject an invalid train timestep before changing the train", () => {
  const n = train(10);
  const at = n.rail.s;
  assert.throws(
    () =>
      rail.stepTrain(
        n,
        track,
        -1,
        [],
        () => true,
        () => 0,
      ),
    RangeError,
  );
  assert.equal(n.rail.s, at);
  assert.equal(n.v, 3);
});

test("place a train without poisoning an equilibrium zero-duration step", () => {
  const n = train(10, 1, rail.LINE_MPS);
  const at = n.rail.s;
  rail.stepTrain(
    n,
    track,
    0,
    [],
    () => true,
    () => 0,
  );
  assert.equal(n.a, 0);
  assert.equal(n.v, rail.LINE_MPS);
  assert.equal(n.rail.s, at);
  assert.equal(n.x, 50);
});

test("do not query the box of a car when the crossing refers to a missing track", () => {
  const car = new Vehicle(50, 0);
  assert.equal(rail.fouling(car, { ...crossing, track: "missing" }, makeMap()), false);
});

test("ignore an approaching train without vehicle dimensions", () => {
  const n = train(5);
  delete n.spec;
  assert.equal(rail.trainAt([n], crossing), null);
});

test("derive the envelope from the widest of the referenced roads", () => {
  const angled = { edge: "wide", angle_deg: 45 };
  const map = makeMap([track], [{ ...crossing, edges: [...crossing.edges, angled] }]);
  map.edges.set("wide", { width: 16 });
  const result = rail.railIndex(map).crossings[0];
  assert.equal(result.half_m, rail.alongStreet(8, Math.PI / 4, HERITAGE_STREETCAR.width));
});

test("use the vehicle length to keep a crossing fouled after its front clears", () => {
  const map = makeMap();
  const front = 50 + rail.ENVELOPE_M + CAR.length / 2;
  assert.equal(rail.crossingsAhead(map, road, cum, front, CAR)[0].fouling, true);
  assert.equal(rail.crossingsAhead(map, road, cum, front + CAR.length, CAR).length, 0);
});

test("require an operational train brake speed at a crossing", () => {
  assert.equal(rail.canStopFor(Infinity, Infinity), false);
  assert.equal(rail.canStopFor(7, 7), true);
});
