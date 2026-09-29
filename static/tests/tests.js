// Browser-run assertions for the simulation and brain modules. Open /tests in the app server.

import { api } from "../js/common.js";
import { MapData } from "../js/map/mapdata.js";
import { Route } from "../js/map/route.js";
import { Vehicle, CAR, ROAD, comfort } from "../js/sim/vehicle.js";
import { ringBusy } from "../js/sim/roundabout.js";
import { crosswalkConflict } from "../js/sim/pedestrians.js";
import { setWeather } from "../js/sim/weather.js";
import { purePursuit, speedControl } from "../js/sim/controller.js";
import { obbOverlap } from "../js/sim/collision.js";
import { World } from "../js/sim/world.js";
import { NpcFleet } from "../js/sim/npc.js";
import { phaseOf, pedPhase } from "../js/sim/signals.js";
import { buildSnapshot } from "../js/brain/sensors.js";
import { sampleCandidates, simulateAll } from "../js/brain/candidates.js";
import { toJevState, buildQuestions } from "../js/brain/state.js";
import { RulesBrain } from "../js/brain/rules.js";
import { safetyBrake } from "../js/brain/safety.js";
import { Visibility } from "../js/sim/visibility.js";
import { fixtureWorld, crossingPedestrian, buildRealismCases } from "./jev-fixtures.js";

const out = document.getElementById("out");
const results = [];
function check(name, cond, detail = "") {
  results.push({ name, ok: !!cond, detail });
}
function assertClose(name, a, b, tol) { check(name, Math.abs(a - b) <= tol, `${a} vs ${b} (tol ${tol})`); }

function straightRoute(map, length = 200) {
  const pts = [];
  for (let s = 0; s <= length; s += 1) pts.push([s, 0]);
  return new Route({ id: "test", polyline: pts, edges: [], turns: [], summary: "straight", start_s: 0 }, map);
}

async function run() {
  const pack = await api("/api/map");
  const map = new MapData(pack);
  const route = straightRoute(map);

  // pure pursuit converges from a 2 m offset within 4 s
  {
    const car = new Vehicle(0, 2, 0, 8);
    let s = 0;
    for (let t = 0; t < 4; t += 1 / 60) {
      const p = route.project(car.x, car.y);
      s = p.s;
      car.step(1 / 60, { steer: purePursuit(car, route, s, 0), accel: speedControl(car.v, 8) });
    }
    check("pure pursuit converges", Math.abs(car.y) < 0.2 && Math.abs(car.psi) < 0.05, `y=${car.y.toFixed(2)} psi=${car.psi.toFixed(3)}`);
  }
  // at walking pace, full lock traces a circle of radius L / tan(delta_max)
  {
    const car = new Vehicle(0, 0, 0, 2);
    car.delta = CAR.maxSteer;
    const start = [car.x, car.y];
    let maxDist = 0;
    for (let t = 0; t < 30; t += 0.01) { car.step(0.01, { steer: CAR.maxSteer, accel: speedControl(car.v, 2) }); maxDist = Math.max(maxDist, Math.hypot(car.x - start[0], car.y - start[1])); }
    const r = CAR.wheelbase / Math.tan(CAR.maxSteer);
    assertClose("full-lock circle diameter at 2 m/s", maxDist, 2 * r, 0.3);
  }
  // at speed the tires slip: a fixed steering angle traces a wider circle (mild understeer)
  {
    const steer = 3 * Math.PI / 180;
    const car = new Vehicle(0, 0, 0, 15);
    for (let t = 0; t < 8; t += 1 / 60) car.step(1 / 60, { steer, accel: speedControl(car.v, 15) });
    const R = car.v / car.r, kin = CAR.wheelbase / Math.tan(steer);
    check("understeer at 15 m/s", R > kin * 1.1 && R < kin * 2, `R=${R.toFixed(1)} kinematic=${kin.toFixed(1)}`);
  }
  // braking hard in a bend on a dry road stays stable (stability control keeps the rear in line)
  {
    const car = new Vehicle(0, 0, 0, 14);
    const steer = 6 * Math.PI / 180;
    for (let t = 0; t < 4; t += 1 / 60) car.step(1 / 60, { steer, accel: speedControl(car.v, 14) });
    let maxBeta = 0;
    for (let t = 0; t < 3; t += 1 / 60) { car.step(1 / 60, { steer, accel: -8 }); maxBeta = Math.max(maxBeta, Math.abs(car.beta)); }
    check("brake in a bend: sideslip under 8 deg", maxBeta < 8 * Math.PI / 180, `${(maxBeta * 180 / Math.PI).toFixed(1)} deg`);
  }
  // on snow the same bend at 10 m/s saturates the tires and the car runs wide
  {
    const saved = ROAD.mu;
    ROAD.mu = 0.2;
    const steer = 6 * Math.PI / 180;
    const car = new Vehicle(0, 0, 0, 10);
    for (let t = 0; t < 6; t += 1 / 60) car.step(1 / 60, { steer, accel: speedControl(car.v, 10) });
    ROAD.mu = saved;
    check("snow: lateral grip capped near 0.2 g", Math.abs(car.latAccel) < 0.25 * 9.81 && car.slipping > 0, `ay=${car.latAccel.toFixed(2)} slipping=${car.slipping.toFixed(2)}`);
  }
  // OBB overlap
  {
    const a = { center: [0, 0], heading: 0, halfLength: 2.25, halfWidth: 0.95 };
    check("obb overlap: touching side by side", obbOverlap(a, { center: [0, 1.8], heading: 0, halfLength: 2.25, halfWidth: 0.95 }));
    check("obb no overlap: 3 m apart laterally", !obbOverlap(a, { center: [0, 3], heading: 0, halfLength: 2.25, halfWidth: 0.95 }));
    check("obb overlap: crossing at 90 deg", obbOverlap(a, { center: [1, 1], heading: Math.PI / 2, halfLength: 2.25, halfWidth: 0.95 }));
    check("obb no overlap: ahead 6 m", !obbOverlap(a, { center: [6, 0], heading: 0, halfLength: 2.25, halfWidth: 0.95 }));
  }
  // candidates on the real map: sampler always includes hard_brake; a stationary car ahead is rejected
  {
    const world = new World(map, { parked: 0, pedestrians: 0 });
    const near = map.nearestLane(world.ego.x, world.ego.y, world.ego.psi, 40);
    const res = await api("/api/route", { from: { x: world.ego.x, y: world.ego.y, heading: world.ego.psi }, to: (() => { const p = near.lane.pts[near.lane.pts.length - 1]; return { x: p[0], y: p[1] }; })(), k: 1 });
    check("route to the end of the current lane", res.routes.length > 0);
    world.route = new Route(res.routes[0], map);
    world.ego.v = 8;
    world._road = world.roadInfo();
    let snap = buildSnapshot(world);
    let cands = sampleCandidates(snap, world);
    check("sampler includes hard_brake", cands.some((c) => c.id === "hard_brake"));
    check("sampler excludes reverse on the road", !cands.some((c) => c.id === "reverse"));
    let { eligible } = simulateAll(cands, snap, world);
    check("clear road: most candidates eligible", eligible.length >= cands.length - 2, `${eligible.length}/${cands.length}`);
    // put a stationary NPC ~9.5 m ahead: far enough that braking gently still works (the brakes lag)
    const blocker = new Vehicle(); blocker.id = "car_x";
    const f = world.ego.front;
    blocker.x = world.ego.x + Math.cos(world.ego.psi) * 14; blocker.y = world.ego.y + Math.sin(world.ego.psi) * 14; blocker.psi = world.ego.psi; blocker.v = 0;
    world.npcs = [blocker];
    snap = buildSnapshot(world);
    check("following detected", snap.following && snap.following.gap_m < 10, JSON.stringify(snap.following && { gap: snap.following.gap_m }));
    cands = sampleCandidates(snap, world);
    const sim = simulateAll(cands, snap, world);
    const hold = cands.find((c) => c.id === "keep_lane_hold");
    check("hold-speed candidate predicts a collision", hold && hold.sim.collision && hold.sim.collision.t > 0.3 && hold.sim.collision.t < 2.0, JSON.stringify(hold && hold.sim.collision));
    check("hard_brake stays eligible", cands.find((c) => c.id === "hard_brake").eligible);
    check("rejected counts collisions", sim.rejected.collision >= 1, JSON.stringify(sim.rejected));
    const state = toJevState(snap, cands, { rejected: sim.rejected });
    const text = JSON.stringify(state);
    check("state has no long decimals", !/\d\.\d{2,}/.test(text), text.match(/\d\.\d{2,}/)?.[0]);
    const allowed = new Set(["driving_style", "units", "car", "nav", "road", "intersection", "following", "rear_follower", "traffic", "current_path_hazard", "stuck", "route_options", "candidates", "rejected", "pedestrian", "visibility", "roadside"]);
    check("state has only schema fields", Object.keys(state).every((k) => allowed.has(k)), Object.keys(state).join(","));
    const { questions, local } = buildQuestions(snap, sim.eligible);
    check("motion asked when following closely", !!questions.motion);
    check("vector asked with several eligible", !!questions.vector && Object.keys(questions.vector.criteria).length === sim.eligible.length);
    const r = new RulesBrain().decideSync(snap, sim.eligible);
    check("rules brain picks an eligible candidate", sim.eligible.some((c) => c.id === r.candidateId), r.candidateId);
    check("rules brain slows behind a stopped car", r.candidateId !== "keep_lane_hold" && r.candidateId !== "keep_lane_limit", r.candidateId);
    void f;
  }
  // parked cars sit in the parking lane, clear of every travel lane
  {
    const world = new World(map, { seed: 3 });
    const list = world.parked.list;
    check("parked cars spawned", list.length > 500, `${list.length}`);
    let worst = Infinity;
    for (const car of list.slice(0, 400)) {
      const [cx, cy] = car.center;
      const near = map.nearestLane(cx, cy, car.psi, 15);
      if (near) worst = Math.min(worst, Math.abs(near.lateral));
    }
    check("parked cars clear of the lanes", worst > 1.9, `closest lane center ${worst.toFixed(2)} m`);
    check("parked cars found by obstaclesNear", world.obstaclesNear(list[0].center[0], list[0].center[1], 3).includes(list[0]));
  }
  // roundabout: a car circulating just upstream of an entry blocks it; one just past it does not
  {
    const rb = [...map.roundabouts.values()][0];
    if (rb) {
      const node = map.nodes.get(rb.vertices[0]);
      const entry = Math.atan2(node.y - rb.y, node.x - rb.x);
      const at = (a) => { const v = new Vehicle(rb.x + Math.cos(a) * rb.lane_r, rb.y + Math.sin(a) * rb.lane_r, a + Math.PI / 2, 4); return v; };
      check("roundabout: circulating car upstream blocks the entry", ringBusy(rb, node, [at(entry - 1.2)]));
      check("roundabout: car well past the entry does not", !ringBusy(rb, node, [at(entry + 1.5)]));
    } else check("roundabout present on the map", false);
  }
  // crosswalks: a pedestrian starting across the path is a conflict; one on the far sidewalk is not
  {
    const pts = []; for (let x = 0; x <= 60; x += 1) pts.push([x, 0]);
    const cum = pts.map((p) => p[0]);
    const crowd = { list: [{ x: 30, y: 6, v: 1.3, crossing: { from: [30, 8], to: [30, -8] } }] };
    const c = crosswalkConflict(pts, cum, 0, 50, crowd);
    check("crosswalk conflict found ahead", c && Math.abs(c.s - 30) < 0.5, JSON.stringify(c && { s: c.s }));
    crowd.list[0].y = -7.5;
    check("pedestrian past the lane is no conflict", !crosswalkConflict(pts, cum, 0, 50, crowd));
  }
  // signal timing: yellow from the approach speed (ITE), all-red to clear the junction, a walk
  // signal that starts with the parallel green and runs out before its yellow
  {
    const inter = [...map.intersections.values()][0];
    const plan = inter.plan;
    check("signal plan: cycle adds up", Math.abs(plan.A.green + plan.A.yellow + plan.A.allRed + plan.B.green + plan.B.yellow + plan.B.allRed - plan.cycle) < 0.05, JSON.stringify(plan));
    check("signal plan: yellow 3 to 5 s", [plan.A, plan.B].every((p) => p.yellow >= 3 && p.yellow <= 5));
    check("signal plan: all-red 1 to 3 s", [plan.A, plan.B].every((p) => p.allRed >= 1 && p.allRed <= 3));
    const t0 = -inter.offset_s;   // u = 0: A turns green
    check("A green at the start of the cycle, B red", phaseOf(inter, t0 + 0.5).A === "green" && phaseOf(inter, t0 + 0.5).B === "red");
    check("A yellow after its green", phaseOf(inter, t0 + plan.A.green + 0.2).A === "yellow");
    check("all red between the phases", (() => { const p = phaseOf(inter, t0 + plan.A.green + plan.A.yellow + 0.1); return p.A === "red" && p.B === "red"; })());
    check("walk alongside A's green, then the flashing hand", pedPhase(inter, "A", t0 + 1) === "walk" && pedPhase(inter, "A", t0 + plan.A.green - 0.5) === "flash" && pedPhase(inter, "A", t0 + plan.A.green + 1) === "dont");
  }
  // powertrain: full throttle at highway speed gives far less than the car manages from rest
  {
    const slow = new Vehicle(0, 0, 0, 1), fast = new Vehicle(0, 0, 0, 30);
    for (let t = 0; t < 1; t += 1 / 60) { slow.step(1 / 60, { accel: 3 }); fast.step(1 / 60, { accel: 3 }); }
    const gainSlow = slow.v - 1, gainFast = fast.v - 30;
    check("power limits acceleration at speed", gainFast < gainSlow * 0.8 && gainFast > 0.5, `from rest +${gainSlow.toFixed(2)}, at 30 m/s +${gainFast.toFixed(2)}`);
  }
  // traffic at a two-way stop waits for a car coming on the through road
  {
    const world = new World(map, { seed: 5, parked: 0, pedestrians: 0 });
    const fleet = new NpcFleet(world, { count: 0, bikes: 0, seed: 5 });
    const node = [...map.nodes.values()][0];
    const n = new Vehicle(node.x - 15, node.y, 0, 0); n.driver = { T: 1.2 };
    const through = new Vehicle(node.x, node.y - 40, Math.PI / 2, 12);
    world.ego = through;
    check("stop-sign gap: a car 3.3 s out blocks the crossing", fleet.crossComing(n, node.id));
    through.y = node.y - 90;
    check("stop-sign gap: one 7.5 s out does not", !fleet.crossComing(n, node.id));
  }
  // a parked car ahead of the ego can pull out: it leaves the parking lane and joins traffic
  {
    const world = new World(map, { seed: 2, pedestrians: 0 });
    const fleet = new NpcFleet(world, { count: 5, bikes: 0, seed: 2 });
    const before = world.parked.list.length;
    let car = null;
    for (let k = 0; k < 20 && !car; k++) car = fleet.maybePullOut();
    check("a parked car pulled out", car && car.pull && world.parked.list.length === before - 1 && fleet.vehicles.includes(car), car ? car.id : "none nearby");
  }
  // weather sets road grip and the comfort targets
  {
    setWeather("snow");
    const snow = { mu: ROAD.mu, decel: comfort().decel };
    setWeather("dry");
    check("snow lowers grip and comfortable braking", snow.mu < 0.3 && snow.decel < 1.0 && ROAD.mu === 0.9, JSON.stringify(snow));
  }
  // Occluded objects must not leak through the planner or emergency brake. Collision auditing
  // still uses the full world, so losing sight of something does not remove its physical body.
  {
    const world = fixtureWorld({ buildings: [{ pts: [[28, -5], [32, -5], [32, 5], [28, 5]], h: 8 }] });
    const hidden = new Vehicle(36, 0, 0, 0); hidden.id = "hidden";
    world.npcs = [hidden];
    world.crowd.list = [crossingPedestrian(38)];
    const snap = buildSnapshot(world);
    check("building hides traffic and crossing pedestrians", !snap.following && !snap.traffic.length && !snap.pedestrian && !snap.observed.includes(hidden));
    const candidates = sampleCandidates(snap, world); simulateAll(candidates, snap, world);
    check("prediction cannot see a hidden vehicle", !candidates.find((c) => c.id === "keep_lane_hold").sim.collision);
    check("emergency brake cannot see a hidden vehicle", safetyBrake(world, snap, null) === null);
    world.ego.x = 32.5;
    check("hazard appears after clearing the corner", buildSnapshot(world).following?.id === "hidden");
    world.ego.x = hidden.x;
    world.audit(1 / 60, world.roadInfo());
    check("collision audit keeps unseen physical obstacles", world.violations.collisions > 0);
    const sight = new Visibility({ pack: { buildings: [{ pts: [[24.9, 0.1], [25.1, 0.1], [25.1, 0.3], [24.9, 0.3]], h: 3 }] } });
    check("sight ray catches a narrow footprint across cell boundaries", !sight.canSee({ x: 20, y: 0 }, 30, 0.4));
    check("clear sight beside a footprint", sight.canSee({ x: 20, y: 1 }, 30, 1));
  }
  {
    const world = fixtureWorld({ weather: "fog" });
    const far = new Vehicle(65, 0, 0, 0); far.id = "fog_hidden"; world.npcs = [far];
    const snap = buildSnapshot(world), candidates = sampleCandidates(snap, world);
    const sim = simulateAll(candidates, snap, world);
    check("fog limits sensed traffic to 28 m", snap.visibility.range_m === 28 && !snap.following && !snap.traffic.length);
    check("speed permits stopping within fog range", snap.target.reasons.includes("limited visibility") && snap.target.v < 8);
    check("planner rejects acceleration beyond visible stopping room", sim.rejected.visibility_stopping_distance > 0);
    setWeather("dry");
    check("clearing fog reveals the same car", buildSnapshot(world).following?.id === far.id);
  }
  {
    const world = fixtureWorld({ weather: "fog" });
    const inter = { ...[...map.intersections.values()][0], x: 80, y: 0 };
    world.map.intersections.set(inter.id, inter);
    world.route.controls.push({ edge: "street", sRoute: 74, control: { id: inter.id, type: "signal", group: "A" } });
    const snap = buildSnapshot(world);
    const candidates = sampleCandidates(snap, world), sim = simulateAll(candidates, snap, world);
    check("unseen signal phase is unknown", snap.intersection.signal === "unknown");
    check("unknown signal requires a stopping approach", sim.mustStop);
    world.ego.x = 60;
    check("signal phase appears inside visibility range", buildSnapshot(world).intersection.signal !== "unknown");
    setWeather("dry");
  }
  {
    const world = fixtureWorld();
    const car = new Vehicle(38, -2.6, 0, 0); car.id = "door_car"; car.curb = "right";
    world.parked.add(car);
    const door = world.parked.openDoor(car);
    world.parked.step(1, world);
    check("street-side door swings into the lane", door.angle > 1 && door.y > car.y + 1.3);
    check("open door is a separate sensed obstacle", buildSnapshot(world).roadside.some((o) => o.kind === "open door") && world.obstaclesNear(door.x, door.y, 2).includes(door));
    const snap = buildSnapshot(world), candidates = sampleCandidates(snap, world); simulateAll(candidates, snap, world);
    check("door blocks a predicted centered maneuver", candidates.some((c) => c.sim.collision?.id === door.id));
    check("car cannot pull out with its door open", !world.parked.remove(car));
    world.ego.x = door.x - 2; world.ego.v = 4;
    check("safety brake detects the door panel", safetyBrake(world, buildSnapshot(world), null) !== null);
    world.ego.x = door.x; world.ego.y = door.y;
    world.audit(1 / 60, world.roadInfo());
    check("door contact is counted as a collision", world.events.some((e) => e.type === "collision" && e.kind === "door"));
    world.parked.step(6, world);
    check("door closes and leaves the obstacle list", !car.door && !world.parked.doorsNear(door.x, door.y, 20).length);
  }
  {
    const world = new World(map, { seed: 2, pedestrians: 0 });
    const fleet = new NpcFleet(world, { count: 40, bikes: 0, seed: 2 });
    const n = fleet.maybePark(), slot = n?.parking.slot;
    check("traffic reserves a vacant curb bay", n && slot.reserved === n && !slot.occupant);
    if (n) {
      world.npcs = fleet.vehicles = [n]; world.ego.x = -1e5;
      let clear = true, maxSpeed = 0;
      for (let k = 0; k < 2105 && n.parking; k++) {
        fleet.parkStep(n, 1 / 60); maxSpeed = Math.max(maxSpeed, n.v);
        clear &&= world.parked.near(n.x, n.y, 8).every((o) => o === n || !obbOverlap(n.obb(), o.obb()));
      }
      check("traffic parks at low speed without hitting neighbors", clear && maxSpeed < 3.6 && n.parked);
      check("parking transfers the same body to the curb grid", !fleet.vehicles.includes(n) && slot.occupant === n && !slot.reserved && world.parked.near(n.x, n.y, 5).includes(n));
      check("parking releases its bay when removed", world.parked.remove(n) && !slot.occupant);
    }
  }
  {
    const world = fixtureWorld();
    const car = new Vehicle(42, -2.6, 0, 0); car.id = "curb_signal"; car.pull = { wait: 2 };
    world.npcs = [car];
    check("waiting pull-out does not stop the through lane", !buildSnapshot(world).following);
    car.pull.wait = 0; car.v = 1;
    check("moving pull-out is followed before it reaches lane center", buildSnapshot(world).following?.id === car.id);
    // A production path from a real fleet is rebased without changing the physical body.
    const real = new World(map, { parked: 0, pedestrians: 0 });
    const realFleet = new NpcFleet(real, { count: 1, bikes: 0 });
    const driver = realFleet.vehicles[0];
    driver.v = 7;
    const pose = [driver.x, driver.y, driver.psi, driver.v];
    realFleet.recoverPath(driver);
    check("NPC path recovery preserves pose and velocity", JSON.stringify(pose) === JSON.stringify([driver.x, driver.y, driver.psi, driver.v]));
  }
  // Fixture drift is an error: live validation must exercise the same wording as the app.
  const fixtures = buildRealismCases();
  window.__jevFixtures = fixtures;
  for (const fixture of fixtures) {
    const saved = await (await fetch(`/tests/fixtures/jev/${fixture.name}.json`)).json();
    check(`Jev fixture matches current pipeline: ${fixture.name}`, JSON.stringify(saved) === JSON.stringify(fixture));
    check(`Jev question fits API limits: ${fixture.name}`, Object.values(fixture.questions).every((q) => q.instructions.length <= 2000));
  }
  const approach = fixtures.find((f) => f.name === "mid_block_approach"), at = fixtures.find((f) => f.name === "mid_block_at");
  check("mid-block wording distinguishes approaching and holding", approach.questions.motion.instructions.includes("22 m ahead") && at.questions.motion.instructions.includes("right in front") && approach.state.pedestrian.mid_block && at.state.pedestrian.distance === "at");
  check("Jev receives clearance and comfort tradeoffs", approach.state.candidates.some((c) => "max_decel" in c) && !approach.questions.vector.instructions.includes("normally pick the centered candidate"));
  const ok = results.filter((r) => r.ok).length;
  out.innerHTML = results.map((r) => `<span class="${r.ok ? "ok" : "fail"}">${r.ok ? "PASS" : "FAIL"}</span> ${r.name}${r.detail ? ` <span class="muted">${r.detail}</span>` : ""}`).join("\n") + `\n\n${ok}/${results.length} passed`;
  window.__results = results;
}

run().catch((err) => { out.textContent = `ERROR ${err.message}\n${err.stack || ""}`; window.__results = [{ name: "run", ok: false, detail: String(err) }]; });
