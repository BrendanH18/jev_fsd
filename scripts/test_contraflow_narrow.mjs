// Contraflow cyclists on a street too narrow to pass them (sim/contraflow.js): Rue Caron, Québec City,
// a one-way 3.2 m wide with a painted contraflow lane, across Boulevard Charest Est at sig15. The
// merged-tree city run (Québec seed 1, s1-1) deadlocked there: a car turning in from Charest stopped in
// the junction for a rider held at its line, a police officer could not end the all-stop with it in the
// box, and later a rider stood nose to nose with the driven car, stopped 0.1 m short of where it meant
// to move over. Checks:
// - traffic turning into the street with a rider standing in its mouth waits at its own signal line
//   (out of the box), the room it has measured on the narrow street, not the wide one it comes from;
// - a rider held at its line with a vehicle standing face to face in its way rides off out of the car's
//   sight (as when held up anywhere else);
// - a rider squeezes by a vehicle standing face to face along the kerb, never touching it.
// node --experimental-default-type=module scripts/test_contraflow_narrow.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
globalThis.document = { querySelector: () => null };
const { MapData, pointAt, headingAt } = await import("../static/js/map/mapdata.js");
const { World } = await import("../static/js/sim/world.js");
const { NpcPath } = await import("../static/js/sim/npc.js");
const { Vehicle, CAR, BIKE } = await import("../static/js/sim/vehicle.js");
const { setWeather } = await import("../static/js/sim/weather.js");
const { trafficYield } = await import("../static/js/sim/contraflow.js");
const { placeOfficer } = await import("../static/js/sim/traffic-officer.js");
const { obbOverlap } = await import("../static/js/sim/collision.js");
const { rng } = await import("../static/js/common.js");

let checks = 0;
async function test(name, fn) {
  await fn();
  checks++;
  console.log(`✓ ${name}`);
}
const root = new URL("../data/maps/", import.meta.url);
function loadMap(key) {
  const pack = JSON.parse(fs.readFileSync(new URL(`${key}.v6.pack.json`, root)));
  for (const name of [
    "transit",
    "crossings",
    "zones",
    "rail",
    "calming",
    "scrambles",
    "buslanes",
    "restrictions",
    "contraflow",
    "driveways",
    "parks",
    "bridges",
  ]) {
    const url = [2, 1].map((v) => new URL(`${key}.${name}.v${v}.json`, root)).find((u) => fs.existsSync(u));
    if (url) pack[name] = JSON.parse(fs.readFileSync(url));
  }
  return new MapData(pack);
}
const QC = loadMap("8e99888cb743");
// Charest Est (e560, signal sig15, group A) into Rue Caron (e549, contraflow); Caron's other block (e746,
// group B) beyond the junction.
const CHAREST = "e560",
  CARON = "e549";
const FRONT = CAR.length - CAR.rearOverhang;
const DT = 1 / 60;

function world({ officers = false } = {}) {
  setWeather("dry");
  const w = new World(QC, { seed: 3, parked: 0, pedestrians: 0, contraflow: true, officers });
  w.contraflow.target = 0;
  return w;
}
// The driven car far off, out of sight of Rue Caron.
function egoAway(w) {
  const lane = QC.laneList
    .filter((l) => Math.hypot(l.pts[0][0] + 110, l.pts[0][1] - 245) > 230)
    .sort(
      (a, b) => Math.hypot(a.pts[0][0] + 110, a.pts[0][1] - 245) - Math.hypot(b.pts[0][0] + 110, b.pts[0][1] - 245),
    )[0];
  w.placeOnLane(lane, Math.min(5, lane.length / 2));
}
// A rider on Rue Caron, its rear axle `at` metres along its way from Caron's far end, standing at a stop
// it means to make just ahead of it, as at a line it is held at.
function heldRider(w, at = 37.3) {
  const n = w.contraflow.place({ edge: CARON, at, v: 0 });
  Object.assign(n, { v: 0, held: true, stopS: n.path.s + n.spec.length - n.spec.rearOverhang + 0.2 });
  return n;
}
// A traffic car on Charest, its front `front` metres along it, at `v`, turning into Caron.
function trafficCar(front, v) {
  const d = new Vehicle(0, 0, 0, v, CAR);
  d.id = "car_test";
  d.path = new NpcPath(QC, rng(9));
  d.path.start(CHAREST, 0, front - FRONT, [[CARON, 0]]);
  const [x, y] = d.path.pointAt(d.path.s);
  Object.assign(d, { x, y, psi: d.path.headingAt(d.path.s), side: 0 });
  return d;
}
const lineOf = (path, id) => {
  const e = path.edges.find((g) => g.id === id);
  return e.sStart + (e.control.s_line / QC.edges.get(id).length) * (e.sEnd - e.sStart);
};

await test("the street: Rue Caron is too narrow for a car to pass a rider standing in it", () => {
  const e = QC.edges.get(CARON);
  assert.equal(e.asphalt[1] - e.asphalt[0], 3.2);
  assert.ok(QC.contraflow.has(CARON));
  assert.equal(QC.edges.get(CHAREST).control?.type, "signal");
});

await test("traffic turning in waits at its own signal line for a rider standing in the street's mouth", () => {
  const w = world();
  egoAway(w);
  heldRider(w);
  for (const [front, v] of [
    [85, 4],
    [95, 2],
  ]) {
    const d = trafficCar(front, v),
      y = trafficYield(w, d, front);
    const line = lineOf(d.path, CHAREST),
      caron = d.path.edges.find((g) => g.id === CARON).sStart;
    assert.ok(y && y.hold !== null, `a hold from ${front} m`);
    assert.ok(
      y.hold <= line + 0.01,
      `waits at the line (${line.toFixed(1)}), not at ${y.hold.toFixed(1)} past Caron's start ${caron.toFixed(1)}`,
    );
    // (the room is the narrow street's: on Charest the car could move over far further)
    assert.ok(y.shift <= 0.5, `moves over ${y.shift.toFixed(2)} m at most`);
  }
});

await test("traffic already past where it could stop short of the junction still stops short of the rider", () => {
  const w = world();
  egoAway(w);
  const n = heldRider(w);
  const d = trafficCar(112, 4),
    y = trafficYield(w, d, 112);
  assert.ok(y && y.hold !== null && y.hold > 112, "a hold ahead of it");
  const [rx, ry] = n.path.pointAt(n.path.s);
  const [hx, hy] = d.path.pointAt(y.hold);
  assert.ok(Math.hypot(rx - hx, ry - hy) > 2, "short of the rider");
});

await test("a rider held at its line, a car standing face to face in its way, rides off out of the car's sight", () => {
  const w = world({ officers: true });
  egoAway(w);
  // (the officer waves Charest, group A, and holds Caron, the rider's axis, for good)
  assert.ok(placeOfficer(w, "sig15", { wave: "A", phase: "A" }));
  const n = w.contraflow.place({ edge: CARON, at: 30, v: 2 });
  const lane = QC.lane(CARON, 0),
    [x, y] = pointAt(lane.pts, lane.cum, 6);
  const car = new Vehicle(x, y, headingAt(lane.pts, lane.cum, 6), 0, CAR);
  car.id = "car_standing";
  w.npcs.push(car);
  let held = false;
  for (let t = 0; t < 30 && !n.gone; t += DT) {
    w.contraflow.ride(n, DT);
    w.t += DT;
    if (n.held) held = true;
    assert.equal(w.sees(w.ego, n), false, "out of the car's sight");
  }
  assert.ok(held, "held at its line");
  assert.equal(n.gone, true, "rode off");
});

await test("a rider squeezes by the driven car standing face to face, short of moving over, along the kerb", () => {
  const w = world();
  const n = w.contraflow.place({ edge: CARON, at: 8, v: 3 });
  // (the car facing it 20 m on, 0.35 m right of its lane's centre: 0.1 m short of all the room there is)
  const lane = QC.lane(CARON, 0),
    s = 22,
    h = headingAt(lane.pts, lane.cum, s),
    [x, y] = pointAt(lane.pts, lane.cum, s);
  w.placeOnLane(lane, s);
  Object.assign(w.ego, { x: x + Math.sin(h) * 0.35, y: y - Math.cos(h) * 0.35, psi: h, v: 0 });
  let passed = false;
  for (let t = 0; t < 40 && !passed; t += DT) {
    w.contraflow.ride(n, DT);
    w.t += DT;
    assert.equal(obbOverlap(n.obb(), w.ego.obb(), 0), false, `touching the car at ${t.toFixed(1)} s`);
    const local = w.ego.toLocal(n.x, n.y);
    if (local.ahead < -CAR.rearOverhang - n.spec.length) passed = true;
  }
  assert.ok(passed, "went by");
});

await test("a rider can use the remaining asphalt beside a stationary car centred on 81 Avenue NW", () => {
  const map = loadMap("3e794edbefcb");
  const lane = map.lane("e261", 0);
  for (const [start, speed, obstruction, shouldPass, carAt = 100] of [
    [110, 2, null, true],
    [19, 2, null, true, 9], // Lookahead reaches the end of the block before the rear clears.
    [106, 0, null, false], // A clear strip alongside, but too little approach to steer onto it.
    [106, 0, "traffic", false],
    [110, 2, "parked", false],
    [110, 2, "driveway", false],
    [110, 2, "entering", true],
    [110, 2, "traffic_blocked", false],
    [110, 2, "moving", true],
    [110, 2, "moving_clear", true],
  ]) {
    const w = new World(map, { seed: 1, parked: 0, pedestrians: 0, contraflow: true });
    w.placeOnLane(lane, carAt);
    const rider = w.contraflow.place({ edge: "e261", at: lane.length - start, v: speed });
    // Split the straight at the meeting point, as an interior OSM vertex would.
    const at = rider.path.s + 10;
    const i = rider.path.cum.findIndex((s) => s > at);
    rider.path.pts.splice(i, 0, rider.path.pointAt(at));
    rider.path.cum.splice(i, 0, at);
    // A bicycle left against the kerb beside the car occupies only the rider's wider line.
    const h = w.ego.psi;
    const parked = new Vehicle(w.ego.x - 2.1 * Math.sin(h), w.ego.y + 2.1 * Math.cos(h), h, 0, BIKE);
    if (obstruction === "parked") w.parked.add(parked);
    if (obstruction === "driveway" || obstruction === "traffic_blocked") w.driveways.cars.push(parked);
    let car = w.ego;
    if (obstruction === "traffic" || obstruction === "traffic_blocked") {
      car = w.ego.clone();
      w.npcs.push(car);
      w.placeOnLane(lane, 85);
    }
    let reverser = null;
    let enteredAt = null;
    let waited = false;
    let passed = false;
    for (let t = 0; t < 40 && !passed; t += DT) {
      w.contraflow.ride(rider, DT);
      w.t += DT;
      assert.ok(!rider.gone, "rider remains on the street");
      assert.equal(
        obbOverlap(rider.obb(), car.obb(), 0),
        false,
        `rides clear of the stationary car (start=${start}, t=${t.toFixed(2)})`,
      );
      if (obstruction === "parked" || obstruction === "driveway")
        assert.equal(obbOverlap(rider.obb(), parked.obb(), 0), false, "avoids the parked bicycle");
      for (const [x, y] of rider.corners())
        assert.ok(car.toLocal(x, y).right >= lane.edgeRef.asphalt[0], "stays inside the kerb");
      const along = rider.corners().map(([x, y]) => car.toLocal(x, y).ahead);
      if (Math.min(...along) < -CAR.rearOverhang && Math.max(...along) > -CAR.rearOverhang) {
        assert.ok(Math.abs(rider.hug) > 0.2, "keeps the wider line until the rear passes");
        assert.ok(rider.v <= 2.05, "keeps its squeeze speed until the rear passes");
      }
      if (obstruction === "moving_clear" && Math.min(...along) < -CAR.rearOverhang) enteredAt ??= t;
      if ((obstruction === "moving" || obstruction === "moving_clear") && enteredAt !== null) {
        car.v = t - enteredAt < 0.7 ? 0.5 : 0;
        car.x += car.v * DT * Math.cos(h);
        car.y += car.v * DT * Math.sin(h);
      }
      if (
        (obstruction === "entering" || obstruction === "moving") &&
        Math.min(...along) < -CAR.rearOverhang &&
        enteredAt === null
      ) {
        // The nose is past the car, with the rear beside it. A driveway vehicle enters
        // the riding line two metres past the rear bumper.
        const distance = 2 * CAR.rearOverhang + 2;
        reverser = new Vehicle(
          car.x - 1.4 * Math.sin(h) - distance * Math.cos(h),
          car.y + 1.4 * Math.cos(h) - distance * Math.sin(h),
          h + Math.PI,
          0,
          CAR,
        );
        w.driveways.cars.push(reverser);
        enteredAt = t;
      }
      if (reverser) {
        assert.equal(obbOverlap(rider.obb(), reverser.obb(), 0), false, "brakes for the driveway vehicle");
        if (t - enteredAt > 3) {
          assert.ok(rider.v < 0.05, "stopped for the driveway vehicle");
          assert.ok(Math.max(...along) >= -CAR.rearOverhang, "waits alongside the car");
          waited = true;
          w.driveways.cars.splice(w.driveways.cars.indexOf(reverser), 1);
          reverser = null;
        }
      }
      passed = car.toLocal(rider.x, rider.y).ahead < -CAR.rearOverhang - rider.spec.length;
    }
    if (obstruction === "entering" || obstruction === "moving")
      assert.ok(waited, "encountered and waited for the driveway vehicle");
    assert.equal(passed, shouldPass, "passes when the approach and gap are clear");
  }
});

console.log(`${checks} checks passed`);
process.exit(0);
