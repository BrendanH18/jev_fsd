// Giving way at a junction without a sign (or at a stop sign), the car stops anywhere from its line to
// the point it looks from (Route `sPeek`), short of the junction. Already stopped there when an
// emergency vehicle calls, or crawling up to it and stopping there, it has no more room to pull over
// than at a control line, and holding that stop as the vehicle passes is yielding (World.auditEmergency).
// In Winnipeg's city smoke s1-1 the car had crept 3 m past its give-way line on Martha Street towards
// where it looks from when an ambulance called from behind; it stopped there, in the curb lane, 9 m
// from the centre of a wide junction, and the audit counted the ambulance drawing level as a failure
// to yield. A car with room to pull over, or one that only stopped there after the call, still fails.
// node --experimental-default-type=module scripts/test_emergency_give_way_look.mjs
import assert from "node:assert/strict";
globalThis.document = { querySelector: () => null };
const { MapData, joinLanes, cumulative, pointAt } = await import("../static/js/map/mapdata.js");
const { Route } = await import("../static/js/map/route.js");
const { World } = await import("../static/js/sim/world.js");
const { Vehicle, AMBULANCE } = await import("../static/js/sim/vehicle.js");

// West Street (residential, one 3.2 m lane each way) meets the wide North Street (secondary, 9 m of
// asphalt either side of its centre) at the origin; neither has a sign, so West Street gives way.
// The car comes from the west (travel +x, its lane at y = -1.6) and goes straight on.
const ARM = 150,
  HALF = 1.6;
const ARMS = { w: 180, e: 0, n: 90, s: -90 };
function junction(stopAt = null) {
  const ends = { c: [0, 0] },
    edges = [],
    lanes = [];
  for (const [arm, deg] of Object.entries(ARMS))
    ends[arm] = [ARM * Math.cos((deg * Math.PI) / 180), ARM * Math.sin((deg * Math.PI) / 180)].map(
      (v) => Math.round(v * 1e6) / 1e6,
    );
  for (const arm of Object.keys(ARMS))
    for (const [id, from, to] of [
      [`${arm}_in`, arm, "c"],
      [`${arm}_out`, "c", arm],
    ]) {
      const pts = [ends[from], ends[to]],
        d = Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]);
      const rx = (pts[1][1] - pts[0][1]) / d,
        ry = -(pts[1][0] - pts[0][0]) / d;
      const west = arm === "w" || arm === "e";
      edges.push({
        id,
        from,
        to,
        pts,
        length: ARM,
        lanes: 1,
        lane_width: 3.2,
        lane_offsets: [HALF],
        asphalt: west ? [-3.2, 3.2] : [-9, 9],
        parking: [0, 0],
        cls: west ? "residential" : "secondary",
        limit: 11.1,
        oneway: false,
        name: west ? "West Street" : "North Street",
        // (a stop sign `stopAt` metres along West Street, coming in from the west)
        ...(stopAt !== null && id === "w_in"
          ? { control: { type: "stop", id: "stop_w", s_line: stopAt, all_way: false } }
          : {}),
      });
      lanes.push({ edge: id, idx: 0, pts: pts.map(([x, y]) => [x + rx * HALF, y + ry * HALF]) });
    }
  return new MapData({
    bbox: [0, 0, 1, 1],
    extent: [-ARM - 20, -ARM - 20, ARM + 20, ARM + 20],
    edges,
    lanes,
    nodes: Object.entries(ends).map(([id, [x, y]]) => ({ id, x, y })),
    intersections: [],
    stops: [],
    buildings: [],
  });
}
let MAP = junction();
function straight() {
  const pts = joinLanes(MAP.lane("w_in", 0).pts, MAP.lane("e_out", 0).pts),
    cum = cumulative(pts),
    out = [];
  for (let s = 0; s < cum.at(-1); s += 1) out.push(pointAt(pts, cum, s));
  out.push(pts.at(-1));
  return { id: "straight", polyline: out, edges: ["w_in", "e_out"], turns: [], start_s: 0, goal_s: 120 };
}

// The car's front `front` metres along its route at `v` m/s when an ambulance coming up behind it, in
// the other lane, calls on it.
function setup(front, v = 0) {
  const world = new World(MAP, { parked: 0, pedestrians: 0 });
  world.route = new Route(straight(), MAP);
  const FRONT = world.ego.spec.length - world.ego.spec.rearOverhang;
  Object.assign(world.ego, { x: front - ARM - FRONT, y: -HALF, psi: 0, v });
  const pts = [
    [-ARM, HALF],
    [ARM, HALF],
  ];
  const ev = Object.assign(new Vehicle(world.ego.x - 40, HALF, 0, 12, AMBULANCE), {
    id: "ambulance",
    kind: "ambulance",
    siren: true,
    path: { pts, cum: cumulative(pts), length: 2 * ARM, s: 0 },
  });
  ev.path.s = ev.x + ARM;
  world.npcs.push(ev);
  world.auditEmergency(world.roadInfo());
  return { world, ev, FRONT };
}
// (the car's front `front` metres along its route, stopped)
function moveTo(world, FRONT, front, t) {
  Object.assign(world.ego, { x: front - ARM - FRONT, v: 0 });
  world.t = t;
  world.auditEmergency(world.roadInfo());
}
// The ambulance's middle passes the car's middle 10 s after the call.
function pass(world, ev) {
  const middle = world.ego.spec.length / 2 - world.ego.spec.rearOverhang;
  for (const [t, ahead] of [
    [9.9, -0.1],
    [10, 0.1],
  ]) {
    ev.x = world.ego.x + middle + ahead - (ev.spec.length / 2 - ev.spec.rearOverhang);
    ev.path.s = ev.x + ARM;
    world.t = t;
    world.auditEmergency(world.roadInfo());
  }
}

const control = new Route(straight(), MAP).controls[0];
assert.deepEqual([control?.control.type, control?.control.rule], ["uncontrolled", "minor"], "West Street gives way");
const line = control.sRoute,
  peek = control.sPeek;
assert.ok(peek - line > 2, `it looks from ${(peek - line).toFixed(1)} m past its line`);
assert.ok(ARM - peek > 8.5, "where it looks from is outside the junction box the audit measures");

{
  // stopped between its line and where it looks from when the call comes
  const { world, ev } = setup((line + peek) / 2);
  pass(world, ev);
  assert.equal(world.violations.failed_to_yield, 0, "holding a give-way stop is yielding");
}
{
  // creeping up to where it looks from at 1.3 m/s, 1.5 m short of it, then stopping there (Winnipeg s1-1)
  const { world, ev, FRONT } = setup(peek - 1.5, 1.3);
  moveTo(world, FRONT, peek - 0.3, 2);
  pass(world, ev);
  assert.equal(world.violations.failed_to_yield, 0, "a crawl that stops where it looks from is yielding");
}
console.log("✓ stopped between a give-way line and where it looks from, the car may hold that stop");

{
  // stopped well short of the line: room to pull over
  const { world, ev } = setup(line - 30);
  pass(world, ev);
  assert.equal(world.violations.failed_to_yield, 1, "a stop with room to pull over is not a line stop");
}
{
  // 30 m back at 8 m/s when the call came: stopping at the junction later does not excuse it
  const { world, ev, FRONT } = setup(line - 30, 8);
  moveTo(world, FRONT, peek - 0.3, 5);
  pass(world, ev);
  assert.equal(world.violations.failed_to_yield, 1, "a stop made after the call was a chance to pull over");
}
{
  // stopped there, then backing off it before the ambulance passes (driving on would put its front in
  // the junction box, which the audit excuses on its own)
  const { world, ev, FRONT } = setup((line + peek) / 2);
  moveTo(world, FRONT, line - 3, 5);
  pass(world, ev);
  assert.equal(world.violations.failed_to_yield, 1, "leaving the stop ends the exception");
}
console.log("✓ room to pull over, a late stop and leaving the stop still fail the audit");

// A stop sign set back from its junction: 75 m along a 150 m street whose junction the car looks from at
// about 140 m. The street between the sign and where it looks from is room to pull over in.
MAP = junction(75);
const signed = new Route(straight(), MAP).controls[0];
assert.equal(signed.control.type, "stop");
assert.ok(
  signed.sPeek - signed.sRoute > 50,
  `${(signed.sPeek - signed.sRoute).toFixed(1)} m from its sign to where it looks`,
);
{
  // stopped in its lane halfway between the sign and the junction: it could have pulled over
  const { world, ev } = setup((signed.sRoute + signed.sPeek) / 2);
  pass(world, ev);
  assert.equal(world.violations.failed_to_yield, 1, "a stop mid-block is not a line stop");
}
{
  // stopped a few metres short of where it looks from, at the junction: as at a give-way line's look point
  const { world, ev } = setup(signed.sPeek - 3);
  pass(world, ev);
  assert.equal(world.violations.failed_to_yield, 0, "holding still where it looks from is yielding");
}
{
  // crawling mid-block 12.7 m short of where it looks from at 2.5 m/s, then rolling on to stop 7.7 m short of
  // it without pulling over: the crawl had room to pull over, so the later stop excuses nothing
  const { world, ev, FRONT } = setup(signed.sPeek - 12.7, 2.5);
  moveTo(world, FRONT, signed.sPeek - 7.7, 2);
  pass(world, ev);
  assert.equal(world.violations.failed_to_yield, 1, "a crawl mid-block that stops near the junction still fails");
}
console.log("✓ a stop sign set back from its junction excuses only stops at the sign or where the car looks from");

// A crawl just over its stop line when the call comes, stopping between the line and where it looks from.
MAP = junction(136);
const near = new Route(straight(), MAP).controls[0];
assert.ok(near.sPeek - near.sRoute > 2 && near.sPeek - near.sRoute < 8, "the sign close to its junction");
{
  const { world, ev, FRONT } = setup(near.sRoute + 0.25, 1.3);
  moveTo(world, FRONT, near.sRoute + 1.8, 1.5);
  pass(world, ev);
  assert.equal(
    world.violations.failed_to_yield,
    0,
    "a crawl over the line that stops short of where it looks is yielding",
  );
}
console.log("✓ a crawl just over a stop line that stops before where it looks from is yielding");
process.exit(0);
