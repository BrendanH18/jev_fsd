import assert from "node:assert/strict";
import { MapData } from "../static/js/map/mapdata.js";
import { AllWayStops } from "../static/js/sim/all-way.js";
import { behindInLane, followingPolicy } from "../static/js/sim/following.js";
import { boxBlocker, boxEnd, boxStart, boxHold, routeBoxAhead, waitsAt } from "../static/js/sim/junction-box.js";
import { NpcFleet, NpcPath, stripOffset } from "../static/js/sim/npc.js";
import { approachTo } from "../static/js/sim/priority.js";
import {
  crossingGap,
  laneChangeBodyGap,
  laneChangeGap,
  pathLine,
  pickSpawnLane,
} from "../static/js/sim/traffic-geometry.js";
import { CAR, Vehicle } from "../static/js/sim/vehicle.js";

function scene() {
  const control = { id: "signal", type: "signal", s_line: 193 };
  const edge = (id, from, to, pts, lanes, settings = {}) => ({
    id,
    from,
    to,
    pts,
    length: Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]),
    lanes,
    lane_offsets: lanes === 2 ? [-1.75, 1.75] : [0],
    lane_width: 3.5,
    parking: [0, 0],
    asphalt: [-3.5, 3.5],
    cls: "secondary",
    limit: 12,
    ...settings,
  });
  const edges = [
    edge(
      "main",
      "west",
      "corner",
      [
        [0, 0],
        [200, 0],
      ],
      2,
      { control },
    ),
    edge(
      "ahead",
      "corner",
      "east",
      [
        [200, 0],
        [400, 0],
      ],
      1,
    ),
    edge(
      "left",
      "corner",
      "north",
      [
        [200, 0],
        [200, 200],
      ],
      1,
    ),
    edge(
      "right",
      "corner",
      "south",
      [
        [200, 0],
        [200, -200],
      ],
      2,
    ),
    edge(
      "cross",
      "north",
      "corner",
      [
        [200, 200],
        [200, 0],
      ],
      1,
    ),
  ];
  const map = new MapData({
    extent: [0, -200, 400, 200],
    nodes: [
      { id: "west", x: 0, y: 0 },
      { id: "east", x: 400, y: 0 },
      { id: "corner", x: 200, y: 0 },
      { id: "north", x: 200, y: 200 },
      { id: "south", x: 200, y: -200 },
    ],
    edges,
    lanes: edges.flatMap((road) =>
      road.lane_offsets.map((offset, idx) => ({
        edge: road.id,
        idx,
        pts: road.pts.map(([x, y]) => (road.id === "main" || road.id === "ahead" ? [x, y - offset] : [x - offset, y])),
      })),
    ),
    stops: [],
    intersections: [],
  });
  const ego = new Vehicle(-100, -100, 0, 0);
  const world = { map, ego, t: 3, tick: 30, parked: { slots: [], list: [] } };
  const fleet = new NpcFleet(world, { count: 0, bikes: 0 });
  function npc({ x = 40, y = 1.75, h = 0, speed = 7, lane = 0, next = "right" } = {}) {
    const v = new Vehicle(x, y, h, speed);
    v.id = `actor-${fleet.vehicles.length}`;
    v.v0 = 12;
    v.path = new NpcPath(map, () => 0);
    v.path.start("main", lane, x, next ? [[next, 0]] : []);
    fleet.vehicles.push(v);
    return v;
  }
  return { map, world, fleet, npc };
}

const span = { sStart: 10, sEnd: 70 };
const line = [
  [0, 0],
  [200, 0],
];
const distances = [0, 200];
const box = (actors) => boxBlocker(line, distances, 70, 100, CAR, actors);
const rel = (heading, turn = "straight", arrived = 0, going = false) => ({ heading, turn, arrived, going });
const influence = () => new AllWayStops(null);
const checks = [];
function test(name, expected, actual) {
  checks.push([name, expected, actual]);
}

// Checks that exercise each code change.
test("control lines use distance along the joined lane", 40, () => pathLine(span, 120, 60));
test("spawn sampling uses a stable cumulative boundary with one RNG draw", "a:1", () => {
  let draws = 0;
  const next = pickSpawnLane(
    [
      { id: "a", length: 1 },
      { id: "b", length: 3 },
    ],
    4,
    () => {
      draws++;
      return 0.25;
    },
  );
  return `${next.id}:${draws}`;
});
test(
  "crossing gap retains the default and the driver's headway",
  "5:6.6",
  () => `${crossingGap(null)}:${crossingGap({ T: 2 })}`,
);
test("lane-change clearance accounts for faster traffic behind", 18, () => laneChangeGap(-8, 6, 10));
test("lane-change body clearance uses the dimensions in physical order", 6, () =>
  laneChangeBodyGap(-10, { length: 4, rearOverhang: 1 }, { length: 7, rearOverhang: 2 }),
);
test("no eligible lane leaves car spawning empty", 0, () => {
  const { fleet, map } = scene();
  map.laneList = [];
  fleet.random = () => assert.fail("empty lane pool should not draw");
  fleet.spawn(2);
  return fleet.vehicles.length;
});
test("extending a path before start returns false", false, () => new NpcPath(scene().map).extend());
test("lane switch ignores an absent lane without rebuilding the path", true, () => {
  const { npc } = scene();
  const { path } = npc();
  const edges = path.edges;
  path.switchLane(99, 20);
  return path.edges === edges && path.s === 40;
});
test("path trim retains its edge when no valid arc-length cut exists", 3, () => {
  const path = new NpcPath(null, null);
  Object.assign(path, { edges: [{ sEnd: 75 }, { sStart: 20 }, {}], s: 60, cum: [0, 10] });
  path.trim();
  return path.edges.length;
});
test("unknown priority approach gives way to nobody", false, () => {
  const { fleet, npc } = scene();
  return fleet.givesWay(npc(), "stale", 7);
});
test("unmapped stop approach has no unsigned conflicting approach", false, () => {
  const { fleet, npc } = scene();
  return fleet.unsignedComing(npc(), "stale");
});
test("orphaned adjacency does not hide a real junction", true, () => {
  const { fleet, map } = scene();
  map.out.get("corner").push("stale");
  return fleet.isJunction("corner");
});
test("a stale parking-strip cursor returns no forward parking obstruction", Infinity, () => {
  const { fleet, npc } = scene();
  return fleet.stripEnd(npc().path, { id: "main" }, 25);
});
test("lane changes ignore a declared target without a lane polyline", true, () => {
  const { fleet, npc, map } = scene();
  const driver = npc();
  map.lanes.delete("main:1");
  fleet.maybeChangeLane(driver, driver.path.currentEdge(), 43.6);
  return driver.lc == null;
});
test("an approach without a control does not attempt a red turn", false, () => {
  const { fleet, npc, map } = scene();
  map.rightOnRed = true;
  const driver = npc({ lane: 1, y: -1.75 });
  const edge = driver.path.currentEdge();
  edge.control = null;
  return fleet.rightOnRed(driver, edge, 0, 193, 1);
});
test("an orphaned curb slot does not corrupt the parked-span cache", 0, () => {
  const { fleet, map, world } = scene();
  world.parked.slots.push({ edge: "missing", curb: "right", x: 15, y: -5 });
  return fleet.parkedAlong(map.edges.get("main")).length;
});

// Path planning and turn lane selection.
test("a lane change carries its new index into a two-lane straight continuation", 1, () => {
  const { map, npc } = scene();
  map.edges.get("ahead").lanes = 2;
  map.lanes.set("ahead:1", map.lane("ahead", 0));
  const { path } = npc({ next: "ahead" });
  path.switchLane(1, 40);
  return path.edges[1].lane;
});
test("a lane change keeps the planned road when the next street is narrower", "ahead:0", () => {
  const { npc } = scene();
  const { path } = npc({ next: "ahead" });
  path.switchLane(1, 40);
  return `${path.edges[1].id}:${path.edges[1].lane}`;
});
test("a left turn enters the innermost lane", 0, () => {
  const { npc } = scene();
  return npc().path.laneInto("main", 1, "left");
});
test("a right turn enters the curb lane regardless of incoming lane", 1, () => {
  const { npc } = scene();
  return npc().path.laneInto("main", 0, "right");
});
test("a dead-end path keeps the last edge after its endpoint", "ahead", () => {
  const { npc } = scene();
  const { path } = npc({ next: "ahead" });
  path.s = path.length + 1;
  return path.currentEdge().id;
});
test("a shared path boundary selects the departing edge", "ahead", () => {
  const { npc } = scene();
  const { path } = npc({ next: "ahead" });
  path.s = path.edges[0].sEnd;
  return path.currentEdge().id;
});
test("a positive offset points to the right on eastbound traffic paths", -2, () => {
  const p = new NpcPath(null, null);
  Object.assign(p, { pts: line, cum: distances });
  return p.offsetPointAt(30, 2)[1];
});
test("a zero-width parking strip never becomes a bicycle lane", null, () => {
  const { map } = scene();
  return stripOffset(map.edges.get("main"), 1);
});
test("an inbound bicycle does not ride a strip beside an inner lane", null, () => {
  const { map } = scene();
  return stripOffset({ ...map.edges.get("main"), asphalt: [-3.5, 7] }, 0);
});
test("the mapped ring does not expose a parking strip to bicycles", null, () => {
  const { map } = scene();
  return stripOffset({ ...map.edges.get("main"), asphalt: [-3.5, 8], ring: "ring" }, 1);
});

function change({ x = 40, speed = 7, cooldown = 0, kind, curbward = false, other } = {}) {
  const { fleet, npc } = scene();
  const driver = npc({ x, speed });
  driver.lcCooldown = cooldown;
  driver.kind = kind;
  if (other) fleet.vehicles.push(other);
  fleet.maybeChangeLane(driver, driver.path.currentEdge(), x + 3.6, curbward);
  return driver.lc?.to ?? null;
}
test("traffic starts an unobstructed mid-block move for a right turn", 1, () => change());
test("ordinary traffic does not initiate a lane change while crawling", null, () => change({ speed: 2 }));
test("curbward yielding may initiate a lane change from rest", 1, () => change({ speed: 0, curbward: true }));
test("traffic leaves a cooldown before initiating another lane change", null, () => change({ cooldown: 0.1 }));
test("approach distance is measured at the nose before initiating a turn lane change", null, () => change({ x: 169 }));
test("bicycles keep their own lateral movement system during a curbward request", null, () =>
  change({ kind: "bike", curbward: true }),
);
test("gap checks see a fast rear approach in the target lane", null, () =>
  change({ other: new Vehicle(16, -1.75, 0, 15) }),
);
test("moving away releases the same front gap", 1, () => change({ other: new Vehicle(56, -1.75, 0, 15) }));
test("a vehicle near the adjacent lane does not block from outside its lateral corridor", 1, () =>
  change({ other: new Vehicle(39, -4.1, 0, 7) }),
);
test("sufficient end distance allows a curbward yield after the ordinary cutoff", 1, () =>
  change({ x: 174, curbward: true }),
);

// Crossing arrivals and unprotected turn conflicts.
function arrival(method, other, driver = {}, extra = 0) {
  const { fleet, npc } = scene();
  const me = npc();
  Object.assign(me, driver);
  fleet.vehicles.push(other);
  return fleet[method](me, "corner", extra);
}
test("a vehicle heading away from the left-turn junction is ignored", false, () =>
  arrival("oncoming", new Vehicle(185, 1, Math.PI, 10)),
);
test("an opposing vehicle six seconds out does not delay a left turn", false, () =>
  arrival("oncoming", new Vehicle(260, 0, Math.PI, 10)),
);
test("a faster opposing vehicle inside the look radius delays a left turn", true, () =>
  arrival("oncoming", new Vehicle(275, 0, Math.PI, 15)),
);
test("forward traffic is not counted as a crossing approach", false, () =>
  arrival("crossComing", new Vehicle(160, 0, 0, 12)),
);
test("crossing traffic five seconds away is outside the default acceptance gap", false, () =>
  arrival("crossComing", new Vehicle(200, 50, -Math.PI / 2, 10)),
);
test("the additional red-turn gap holds for the same crossing approach", true, () =>
  arrival("crossComing", new Vehicle(200, 50, -Math.PI / 2, 10), {}, 1.5),
);
test("a stopped vehicle does not generate an arrival conflict", false, () =>
  arrival("crossComing", new Vehicle(200, 2, -Math.PI / 2, 0)),
);
test("a rear-axle point in the crossing radius counts as box occupancy", true, () => {
  const { fleet, npc } = scene();
  const me = npc();
  fleet.vehicles.push(new Vehicle(208.9, 0, Math.PI / 2, 0));
  return fleet.boxBusy(me, me.path.currentEdge());
});
test("parallel traffic in the crossing radius does not count as crossing occupancy", false, () => {
  const { fleet, npc } = scene();
  const me = npc();
  fleet.vehicles.push(new Vehicle(201, 0, 0, 0));
  return fleet.boxBusy(me, me.path.currentEdge());
});
test("approach timing uses an NPC's planned edge and skips its completed crossing", null, () => {
  const { map, npc } = scene();
  const me = npc({ next: "ahead" });
  me.path.s = me.path.edges[0].sEnd;
  return approachTo(map, me, "corner");
});

// Queue order without stepping or mutating the rest of the world.
test("an earlier conflicting arrival wins outside the tie window", true, () =>
  influence().precedes(rel(-Math.PI / 2), rel(0, "straight", 2)),
);
test("an earlier vehicle in the same lane does not create a crossing conflict", false, () =>
  influence().precedes(rel(0), rel(0, "straight", 3)),
);
test("near-simultaneous arrivals yield to the one on the right", true, () =>
  influence().precedes(rel(Math.PI / 2, "straight", 0.7), rel(0)),
);
test("a crossing vehicle keeps the turn even when a waiting one arrived earlier", true, () =>
  influence().precedes(rel(-Math.PI / 2, "straight", 5, true), rel(0)),
);
test("opposed straight approaches share a turn", false, () => influence().precedes(rel(Math.PI), rel(0)));
test("an opposing U-turn yields to through traffic on tied arrival", true, () =>
  influence().precedes(rel(Math.PI), rel(0, "uturn")),
);
test("an approach already going does not yield its turn", false, () =>
  influence().precedes(rel(Math.PI / 2), rel(0, "straight", 0, true)),
);
test("an all-way approach whose driver never stopped stays off the queue", 0, () => {
  const { world, map, npc } = scene();
  const queue = new AllWayStops(map);
  queue.note(npc(), { junction: "corner" }, "main", "right", 0.1, 0.5, world);
  return queue.entries.size;
});
test("the same queue entry is removed after the approach changes", "right", () => {
  const { world, map, npc } = scene();
  const queue = new AllWayStops(map);
  const me = npc();
  queue.note(me, { junction: "corner" }, "main", "right", 0.1, 0, world);
  queue.note(me, { junction: "corner" }, "right", "straight", 0.1, 0, world);
  return queue.entries.get(me).edge;
});
test("the all-way queue expires unrefreshed stop claims", 0, () => {
  const { world, map, npc } = scene();
  const queue = new AllWayStops(map);
  queue.note(npc(), { junction: "corner" }, "main", "right", 0.1, 0, world);
  world.tick += 3;
  return queue.at("corner", world).length;
});

// Room beyond a junction and follower geometry.
test("the far side uses the incoming paved width when wider than the cross street", 208, () => {
  const { map } = scene();
  map.edges.get("main").asphalt = [-8, 5];
  map.crossingHalfWidth = () => 4;
  return boxEnd(map, "main", 200);
});
test("the near side uses the width of the crossing street", 196, () => {
  const { map } = scene();
  map.crossingHalfWidth = () => 4;
  return boxStart(map, "main", 200);
});
test("a driver already in the crossing only waits while still short of the cross street", false, () =>
  waitsAt(-2, 0.5, 0),
);
test("the creep exception ends at its exact speed threshold", false, () => waitsAt(-2, 1, 2));
test("a blocker at queue speed is moving too quickly to reserve box space", null, () =>
  box([new Vehicle(103, 0, 0, 3)]),
);
test(
  "the nearest rear bumper is selected even when vehicles are unsorted",
  "near",
  () =>
    box([
      Object.assign(new Vehicle(106, 0, 0, 0), { id: "far" }),
      Object.assign(new Vehicle(103, 0, 0, 0), { id: "near" }),
    ])?.vehicle.id,
);
test("a vehicle just short of the stop line does not occupy the outgoing box", null, () =>
  box([new Vehicle(70, 0, 0, 0)]),
);
test("the box room check ignores stopped vehicles facing against the planned lane", null, () =>
  box([new Vehicle(103, 0, Math.PI, 0)]),
);
test(
  "the queue footprint is projected from the rear of the body",
  true,
  () => Math.abs(box([new Vehicle(103, 0, 0, 0)]).rear_m - 2.1) < 1e-9,
);
test("a bike is exempt from motor-vehicle box holds", null, () => boxHold(null, { kind: "bike" }, 60, []));
test("unsignalled control entries are skipped by the route box lookup", null, () =>
  routeBoxAhead(null, { controls: [{ control: { type: "stop" }, sJunction: 80 }] }, 60, 0),
);

test("bumper-to-bumper following does not measure from axle to axle", 5.5, () =>
  behindInLane(new Vehicle(), new Vehicle(-10, 0, 0), 20),
);
test("a follower one lane to the side is excluded", null, () =>
  behindInLane(new Vehicle(), new Vehicle(-10, 3.5, 0), 20),
);
test("a follower facing away is excluded", null, () => behindInLane(new Vehicle(), new Vehicle(-10, 0, Math.PI), 20));
test(
  "a follower slightly overlapping the rear bumper retains a signed gap",
  true,
  () => Math.abs(behindInLane(new Vehicle(), new Vehicle(-4.25, 0, 0), 20) + 0.25) < 1e-9,
);
test("following distance scale applies only above the standstill minimum", true, () => {
  const me = new Vehicle(0, 0, 0, 10);
  const lead = { speed: 8, gap_m: 40 };
  const usual = followingPolicy(me, lead);
  const doubled = followingPolicy(me, lead, { scale: 2 });
  return Math.abs(doubled.target_gap_m - 3 - 2 * (usual.target_gap_m - 3)) < 1e-9;
});
test("a geometry-only leader specification can constrain the follower", true, () => {
  const me = new Vehicle(0, 0, 0, 10);
  const p = followingPolicy(me, { speed: 0, gap_m: 15, vehicle: { spec: { width: 1, length: 1 } } });
  return Number.isFinite(p.safe_speed_mps) && p.safe_speed_mps < me.v;
});
test("negative current acceleration does not shorten the reserved response time", true, () => {
  const me = new Vehicle(0, 0, 0, 10);
  const lead = { speed: 5, gap_m: 25 };
  const before = followingPolicy(me, lead).reaction_s;
  me.a = -1;
  return followingPolicy(me, lead).reaction_s === before;
});
test("loss of a time gap while the leader is pulling away does not demand acceleration", true, () => {
  const me = new Vehicle(0, 0, 0, 5);
  return followingPolicy(me, { speed: 9, gap_m: 6 }).safe_speed_mps <= 5;
});
test(
  "a weaker follower spec limits its comfortable braking envelope",
  0.5,
  () => followingPolicy(new Vehicle(0, 0, 0, 5, { ...CAR, maxBrake: 0.5 }), { speed: 0, gap_m: 20 }).braking_mps2,
);

for (const [name, expected, actual] of checks) assert.equal(actual(), expected, name);
console.log(`${checks.length} traffic behavior checks passed`);
