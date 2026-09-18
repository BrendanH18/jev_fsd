// Browser-run assertions for the simulation and brain modules. Open /tests in the app server.

import { api } from "../js/common.js";
import { MapData } from "../js/map/mapdata.js";
import { Route } from "../js/map/route.js";
import { Vehicle, CAR } from "../js/sim/vehicle.js";
import { purePursuit, speedControl } from "../js/sim/controller.js";
import { obbOverlap } from "../js/sim/collision.js";
import { World } from "../js/sim/world.js";
import { buildSnapshot } from "../js/brain/sensors.js";
import { sampleCandidates, simulateAll } from "../js/brain/candidates.js";
import { toJevState, buildQuestions } from "../js/brain/state.js";
import { RulesBrain } from "../js/brain/rules.js";

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
  // full lock traces a circle of radius L / tan(delta_max)
  {
    const car = new Vehicle(0, 0, 0, 5);
    car.delta = CAR.maxSteer;
    const start = [car.x, car.y];
    let maxDist = 0;
    for (let t = 0; t < 20; t += 0.01) { car.step(0.01, { steer: CAR.maxSteer, accel: speedControl(car.v, 5) }); maxDist = Math.max(maxDist, Math.hypot(car.x - start[0], car.y - start[1])); }
    const r = CAR.wheelbase / Math.tan(CAR.maxSteer);
    assertClose("full-lock circle diameter", maxDist, 2 * r, 0.3);
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
    const world = new World(map);
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
    // put a stationary NPC 10 m ahead
    const blocker = new Vehicle(); blocker.id = "car_x";
    const f = world.ego.front;
    blocker.x = world.ego.x + Math.cos(world.ego.psi) * 12; blocker.y = world.ego.y + Math.sin(world.ego.psi) * 12; blocker.psi = world.ego.psi; blocker.v = 0;
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
    const allowed = new Set(["driving_style", "units", "car", "nav", "road", "intersection", "following", "rear_follower", "traffic", "current_path_hazard", "stuck", "route_options", "candidates", "rejected"]);
    check("state has only schema fields", Object.keys(state).every((k) => allowed.has(k)), Object.keys(state).join(","));
    const { questions, local } = buildQuestions(snap, sim.eligible);
    check("motion asked when following closely", !!questions.motion);
    check("vector asked with several eligible", !!questions.vector && Object.keys(questions.vector.criteria).length === sim.eligible.length);
    const r = new RulesBrain().decideSync(snap, sim.eligible);
    check("rules brain picks an eligible candidate", sim.eligible.some((c) => c.id === r.candidateId), r.candidateId);
    check("rules brain slows behind a stopped car", r.candidateId !== "keep_lane_hold" && r.candidateId !== "keep_lane_limit", r.candidateId);
    void f;
  }
  const ok = results.filter((r) => r.ok).length;
  out.innerHTML = results.map((r) => `<span class="${r.ok ? "ok" : "fail"}">${r.ok ? "PASS" : "FAIL"}</span> ${r.name}${r.detail ? ` <span class="muted">${r.detail}</span>` : ""}`).join("\n") + `\n\n${ok}/${results.length} passed`;
  window.__results = results;
}

run().catch((err) => { out.textContent = `ERROR ${err.message}\n${err.stack || ""}`; window.__results = [{ name: "run", ok: false, detail: String(err) }]; });
