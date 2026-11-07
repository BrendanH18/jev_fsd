// node --experimental-default-type=module scripts/test_left_on_red.mjs
import assert from "node:assert/strict";
globalThis.document = { querySelector: () => null };
const fs = await import("node:fs");
const { MapData, joinLanes, cumulative, pointAt } = await import("../static/js/map/mapdata.js");
const { Route } = await import("../static/js/map/route.js");
const { World } = await import("../static/js/sim/world.js");
const { Vehicle, CAR } = await import("../static/js/sim/vehicle.js");
const { setWeather } = await import("../static/js/sim/weather.js");
const { phaseOf, pedPhase, StopMemory, STOP_ZONE_M } = await import("../static/js/sim/signals.js");
const { stepWorld } = await import("../static/js/sim/step.js");
const { Pedestrian } = await import("../static/js/sim/pedestrians.js");
const { buildSnapshot } = await import("../static/js/brain/sensors.js");
const { sampleCandidates, simulateAll } = await import("../static/js/brain/candidates.js");
const { toJevState, buildQuestions, situationClauses } = await import("../static/js/brain/state.js");
const { buildLlmPrompt } = await import("../static/js/brain/llm-prompt.js");
const { RulesBrain } = await import("../static/js/brain/rules.js");
const { NpcFleet, NpcPath } = await import("../static/js/sim/npc.js");
const { CHALLENGES } = await import("../static/js/lab/challenges.js");
const { evaluateChallenge } = await import("../static/js/lab/evaluation.js");
const { rng } = await import("../static/js/common.js");

// Synthetic streets crossing at the origin (the driven approach and exit are marked one-way
// below), lanes 3.2 m wide; stop lines 8 m before the
// centre. The car comes from the west (travel +x, its lane at y = -1.6) and turns right to go south
// (x = -1.6). Traffic from its left comes from the north, southbound in the same lane line.
const ARM = 150, LINE = ARM - 8, HALF = 1.6;
const FRONT = CAR.length - CAR.rearOverhang;
const right = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy); return [dy / d, -dx / d]; };
const names = { w: "West Street", e: "West Street", n: "North Street", s: "North Street" };
const groups = { w: "A", e: "A", n: "B", s: "B" };
// (`arms` sets the angle of each arm, degrees counter-clockwise from east; `buildings` are footprints)
// (`westLanes: 2` gives the car's one-way approach two lanes: lane 0 on the left, lane 1 on the right)
function junction({ arms = { w: 180, e: 0, n: 90, s: -90 }, buildings = [], westLanes = 1 } = {}) {
  const ends = { c: [0, 0] }, edges = [], lanes = [];
  for (const [arm, deg] of Object.entries(arms)) ends[arm] = [ARM * Math.cos(deg * Math.PI / 180), ARM * Math.sin(deg * Math.PI / 180)].map((v) => Math.round(v * 1e6) / 1e6);
  for (const [id, from, to, control, arm] of Object.keys(arms).flatMap((arm) => [[`${arm}_in`, arm, "c", true, arm], [`${arm}_out`, "c", arm, false, arm]])) {
    const pts = [ends[from], ends[to]], [rx, ry] = right(...pts);
    const offsets = id === "w_in" && westLanes === 2 ? [-HALF, HALF] : [HALF];
    edges.push({ id, from, to, pts, length: ARM, lanes: offsets.length, lane_width: 3.2, lane_offsets: offsets, asphalt: [-3.2, 3.2], parking: [0, 0],
      cls: "secondary", limit: 13.9, oneway: false, name: names[arm], ...(control ? { control: { type: "signal", id: "sig", s_line: LINE, group: groups[arm] } } : {}) });
    offsets.forEach((o, idx) => lanes.push({ edge: id, idx, pts: pts.map(([x, y]) => [x + rx * o, y + ry * o]) }));
  }
  const map = new MapData({ bbox: [-75.71, 45.40, -75.68, 45.42], extent: [-ARM - 20, -ARM - 20, ARM + 20, ARM + 20], edges, lanes,
    nodes: Object.entries(ends).map(([id, [x, y]]) => ({ id, x, y })),
    intersections: [{ id: "sig", x: 0, y: 0, offset_s: 0, vertices: ["c"], approaches: Object.keys(arms).map((a) => ({ edge: `${a}_in`, group: groups[a], s_line: LINE })) }],
    stops: [], buildings });
  const routeData = (exit, dir, from = westLanes === 2 ? 1 : 0) => {
    const polyline = resample(joinLanes(map.lane("w_in", from).pts, map.lane(exit, 0).pts));
    return { id: `to_${exit}`, polyline, edges: ["w_in", exit], turns: dir ? [{ at_m: ARM, dir, street: names[exit[0]] }] : [], start_s: 0, goal_s: 120 };
  };
  return { map, routeData };
}
function resample(pts) {
  const cum = cumulative(pts), out = [];
  for (let s = 0; s < cum.at(-1); s += 1) out.push(pointAt(pts, cum, s));
  out.push(pts.at(-1));
  return out;
}
const { map, routeData } = junction();
map.edges.get("w_in").oneway = true;
map.edges.get("n_out").oneway = true;
const RIGHT = routeData("s_out", "right"), STRAIGHT = routeData("e_out", null), LEFT = routeData("n_out", "left");
const plan = map.intersections.get("sig").plan;
// red for the car (group A), green for the street from the left (group B), walk for people crossing
// the car's street beside it; and a red with that walk already over
const RED = plan.B.start + 1, LATE_RED = plan.B.start + 12;
assert.equal(phaseOf(map.intersections.get("sig"), RED).A, "red");
assert.equal(phaseOf(map.intersections.get("sig"), RED).B, "green");
assert.equal(phaseOf(map.intersections.get("sig"), LATE_RED).A, "red");
assert.notEqual(pedPhase(map.intersections.get("sig"), "B", LATE_RED + 4), "walk");

function car(id, x, y, psi, v = 0, extra = {}) {
  const n = new Vehicle(x, y, psi, v);
  return Object.assign(n, { id }, extra);
}
// from the left: southbound on North Street, `y` m north of the centre
const fromLeft = (y, v = 11, extra = {}) => car("cross", -HALF, y, -Math.PI / 2, v, extra);
const AT_LINE = -8 - 0.8 - FRONT;   // rear axle with the front bumper 0.8 m short of the line
function setup({ x = AT_LINE, y = -HALF, v = 0, npcs = [], route = LEFT, weather = "dry", t = RED, on = map, stopped = false } = {}) {
  setWeather(weather);
  const world = new World(on, { parked: 0, pedestrians: 0, weather, leftOnRed: true });
  world.t = t;
  Object.assign(world.ego, { x, y, psi: 0, v });
  world.route = route ? new Route(route, on) : null;
  world.destination = world.route ? world.route.endPoint() : null;
  world.npcs = npcs;
  world._road = world.roadInfo();
  if (stopped) for (let i = 0; i < 30; i++) world.audit(1 / 30, world.roadInfo());
  world._road = world.roadInfo();
  return world;
}
function decide(world) {
  const snap = buildSnapshot(world);
  const candidates = sampleCandidates(snap, world);
  return { snap, candidates, ...simulateAll(candidates, snap, world) };
}
const passesLine = (r) => r.eligible.some((c) => c.sim.progress_m + r.snap.ego.front_m + r.snap.routeProj.s > r.snap.intersection.s_line_route + 1);

function driveThrough(world, path, { speed = 5, seconds = 5 } = {}) {
  const dt = 1 / 30;
  let s = path.project(world.ego.x, world.ego.y).s;
  const events = [];
  for (let i = 0; i < seconds / dt; i++) {
    s += speed * dt;
    const [x, y] = path.pointAt(s);
    Object.assign(world.ego, { x, y, psi: path.headingAt(s), v: speed });
    for (const n of world.npcs) {
      if (n.path) { n.path.s += n.v * dt; n.path.extend(); const [px, py] = n.path.pointAt(n.path.s); Object.assign(n, { x: px, y: py, psi: n.path.headingAt(n.path.s) }); }
      else { n.x += Math.cos(n.psi) * n.v * dt; n.y += Math.sin(n.psi) * n.v * dt; }
    }
    world.t += dt;
    world.audit(dt, world.roadInfo());
    events.push(...world.events.filter((e) => e.type === "red_light" || e.type === "failed_to_yield"));
  }
  return events;
}
const types = (events) => events.map((e) => e.type + (e.to ? `:${e.to}` : ""));

function pedestrian(world, { crossing = false } = {}) {
  const info = world.crowd.legsAt.get("c"), leg = info.list.find((l) => l.st.edge.id.startsWith("w"));
  const side = leg.ends[1][1] < 0 ? 1 : -1, from = leg.ends[side], to = leg.ends[-side];
  const cross = { node: "c", leg, from, to };
  const at = crossing ? [from[0] + (to[0] - from[0]) * 0.3, from[1] + (to[1] - from[1]) * 0.3] : from;
  const ped = new Pedestrian({ id: "ped", x: at[0], y: at[1], psi: Math.PI / 2, v: crossing ? 1.3 : 0, speed: 1.3, path: [{ p: to, cross }], crossing: crossing ? cross : null, waiting: 0, phase: 0, look: 1 });
  world.crowd.list.push(ped);
  return ped;
}

const {leftOnRedRegion}=await import("../static/js/sim/left-on-red.js");
for(const box of [[-123.17,49.26,-123.15,49.27],[-123.38,48.42,-123.36,48.44],[-114.087,51.034,-114.063,51.045],[-106.7,52.12,-106.6,52.14],[-97.15,49.892,-97.131,49.903],[-75.71,45.40,-75.68,45.42],[-63.59,44.64,-63.57,44.66]]) assert.equal(leftOnRedRegion(box),true,String(box));
assert.equal(leftOnRedRegion([0,0,1,1]),false);
assert.equal(leftOnRedRegion([-75.75,45.45,-75.70,45.50]),false,"Gatineau must not inherit Ottawa eligibility");
const ready = () => decide(setup({ stopped: true }));
assert.equal(ready().snap.intersection.left_on_red?.go, true);
assert.equal(decide(setup()).snap.intersection.left_on_red?.go, false);
assert.equal(decide(setup({stopped:true})).snap.intersection.right_on_red, null);
for (const id of ["w_in", "n_out"]) {
  map.edges.get(id).oneway = false;
  assert.equal(ready().snap.intersection.left_on_red, undefined);
  map.edges.get(id).oneway = true;
}
for (const bbox of [[-73.59,45.51,-73.57,45.53],[-71.24,46.8,-71.21,46.82]]) {
  const prior = map.routingBbox; map.routingBbox = bbox;
  assert.equal(ready().snap.intersection.left_on_red, undefined);
  map.routingBbox = prior;
}
map.edges.get("w_in").control.no_left_on_red = true;
assert.equal(ready().snap.intersection.left_on_red, undefined);
map.edges.get("w_in").control.no_left_on_red = false;
const off = setup({stopped:true}); off.leftOnRed = false;
assert.equal(decide(off).snap.intersection.left_on_red, undefined);
assert.equal(off.leftOnRedSeen, false);
const pedWorld=setup({stopped:true}); pedestrian(pedWorld,{crossing:true});
assert.equal(decide(pedWorld).snap.intersection.left_on_red?.wait_for?.kind,"pedestrian");
const approaching = car("from_right", HALF, -45, Math.PI / 2, 11);
assert.equal(decide(setup({stopped:true,npcs:[approaching]})).snap.intersection.left_on_red?.go,false);
assert.equal(passesLine(decide(setup({x:-40,v:8}))),false,"no candidate crosses before the full stop");
assert.equal(passesLine(decide(setup({stopped:true,npcs:[approaching]}))),false,"no candidate crosses into traffic from the right");
assert.equal(passesLine(decide(off)),false,"disabled feature never permits crossing red");
const r = ready();
assert.equal(passesLine(r),true,"a safe candidate can cross after stopping");
assert.equal(new RulesBrain().decideSync(r.snap,r.eligible).motion,"drive");
assert.equal(toJevState(r.snap,r.eligible,{}).intersection.left_on_red.stop_completed,true);
assert.ok(situationClauses(r.snap).some(c=>c.includes("a left turn on red is allowed")));
const state=toJevState(r.snap,r.candidates,{}), {questions}=buildQuestions(r.snap,r.eligible);
assert.ok(questions.motion.criteria.stop.includes("the car may turn left on red"));
assert.ok(buildLlmPrompt(r.snap,{state,questions}).messages[0].content.includes("intersection.left_on_red"));
console.log("✓ eligibility, stop, signs, Québec, option off, traffic from right, sensing, prompts and Rules");

for (const [label, opts, expected] of [["legal", {stopped:true},0],["rolling",{},1],["straight",{stopped:true,route:STRAIGHT},1]]) {
 const w = setup(opts); const path = w.route;
 driveThrough(w,path,{seconds:10});
 assert.equal(w.violations.red_lights_run,expected,label);
}
for (const id of ["w_in","n_out"]) {
 map.edges.get(id).oneway=false;
 const w=setup({stopped:true}); driveThrough(w,w.route,{seconds:10});
 assert.equal(w.violations.red_lights_run,1,`audit two-way ${id}`);
 map.edges.get(id).oneway=true;
}
const cutOff=setup({stopped:true,npcs:[car("priority",HALF,-45,Math.PI/2,11)]});
driveThrough(cutOff,cutOff.route,{seconds:10});
assert.ok(cutOff.violations.failed_to_yield>0,"audit catches cutting off traffic from the right");
const manual=setup({stopped:true}), manualPath=manual.route;
manual.route=null; manual.destination=null;
driveThrough(manual,manualPath,{seconds:10});
assert.equal(manual.violations.red_lights_run,0,"manual legal left");
// From a two-lane one-way approach, only the leftmost lane may turn left on red.
{
 const two = junction({ westLanes: 2 });
 two.map.edges.get("w_in").oneway = true; two.map.edges.get("n_out").oneway = true;
 // (the wider approach lengthens its green: its own red, with the street from the left on green)
 const red2 = two.map.intersections.get("sig").plan.B.start + 1;
 assert.equal(phaseOf(two.map.intersections.get("sig"), red2).A, "red");
 for (const [label, lane, y, expected] of [["leftmost lane", 0, HALF, 0], ["right-hand lane", 1, -HALF, 1]]) {
  const w = setup({ stopped: true, on: two.map, route: two.routeData("n_out", "left", lane), y, t: red2 });
  driveThrough(w, w.route, { seconds: 10 });
  assert.equal(w.violations.red_lights_run, expected, `left on red from the ${label}`);
 }
}
// Scrambles are excluded even when the red is not currently in its all-walk phase.
const { setScrambles } = await import("../static/js/sim/signals.js");
const inter=map.intersections.get("sig");
inter.scramblePlan={...inter.plan, scramble:true};
const scrambleWorld=setup({stopped:true});
setScrambles(true);
assert.equal(decide(scrambleWorld).snap.intersection.left_on_red,undefined);
driveThrough(scrambleWorld,scrambleWorld.route,{seconds:10});
assert.equal(scrambleWorld.violations.red_lights_run,1,"scramble left is a red-light run");
setScrambles(false); delete inter.scramblePlan;
for(const bbox of [[-73.59,45.51,-73.57,45.53],[-71.24,46.8,-71.21,46.82]]) {
 const prior=map.routingBbox; map.routingBbox=bbox;
 const w=setup({stopped:true}); driveThrough(w,w.route,{seconds:10});
 assert.equal(w.violations.red_lights_run,1,"Québec left is a red-light run");
 map.routingBbox=prior;
}


{
 const w=setup({route:null}); Object.assign(w.ego,{x:100,y:100,v:0});
 const fleet=new NpcFleet(w,{count:0,bikes:0});
 const n=car("npc",-8-30-FRONT,-HALF,0,6,{v0:12,driver:{aMax:1.5,b:2,s0:2,T:1.2,react:0.5,lcRate:0},stopMem:new StopMemory(),frozen:0,waiting:0});
 n.path=new NpcPath(map,rng(2)); n.path.start("w_in",0,LINE-30-FRONT,[["n_out",0]]); fleet.vehicles.push(n);
 let stopped=0;
 for(let i=0;i<22*60&&n.y<20;i++){fleet.step(1/60);w.t+=1/60;if(n.v<0.2&&n.x<-8)stopped+=1/60;}
 assert.ok(n.y>20,"NPC turned left"); assert.ok(stopped>0.7,"NPC full stop");
 assert.equal(phaseOf(inter,w.t).A,"red","NPC turns during red");
}
const challenge = CHALLENGES.find(c=>c.id==="left-on-red");
const pack=JSON.parse(fs.readFileSync(new URL("../data/maps/a53c5bcf6438.v6.pack.json",import.meta.url)));
for(const layer of ["transit","crossings","zones","rail","calming","scrambles","buslanes","restrictions","contraflow","driveways", "parks"]) {
 const path=[2,1].map(v=>new URL(`../data/maps/a53c5bcf6438.${layer}.v${v}.json`,import.meta.url)).find(p=>fs.existsSync(p));
 if(path)pack[layer]=JSON.parse(fs.readFileSync(path));
}
const calgary = new MapData(pack);
const arenaResults=[];
for(const brain of ["rules","cautious"]) {
 const result = await evaluateChallenge(calgary,challenge,{brain});
 arenaResults.push(result);
 assert.equal(result.pass,true,JSON.stringify({brain,status:result.report?.status,failures:result.failures}));
 console.log(`✓ Left on red challenge passes with ${brain} in ${result.time_s} s`);
}
const { setupChallenge } = await import("../static/js/lab/evaluation.js");
for(const brain of ["rules","cautious"]) {
 const ctx=setupChallenge(calgary,challenge,{brain}); const w=ctx.world, path=w.route;
 const line=path.controls.find(c=>c.edge==="e594").sRoute, front=w.ego.spec.length-w.ego.spec.rearOverhang;
 let stop=0, crossed=false;
 for(let k=0;k<60*65&&w.route;k++) {
  const before=w.egoStop.completed;
  stepWorld(ctx,1/60,w.t*1000);
  if(ctx.autopilot.firing) await ctx.autopilot.firing;
  // Measure the physics each tick, independently of the slower sensing cadence.
  const distance=line-path.project(w.ego.x,w.ego.y,path.hint).s-front;
  if(Math.abs(w.ego.v)<0.2&&distance<STOP_ZONE_M&&distance>0)stop+=1/60;
  if(!crossed && w.lastSignal?.rightOnRed) {
   crossed=true;
   assert.equal(before,true,`${brain} full stop before crossing`);
   assert.equal(phaseOf(calgary.intersections.get(calgary.edges.get("e594").control.id),w.t)[calgary.edges.get("e594").control.group],"red",`${brain} turns on red`);
  }
 }
 ctx.autopilot.setEnabled(false);
 assert.equal(crossed,true,`${brain} crossed on red`); assert.ok(stop>=0.7-1e-8,`${brain} held stop for ${stop.toFixed(3)} s`);
 console.log(`✓ ${brain} crosses on red after a ${stop.toFixed(2)} s full stop`);
}
const {validateEvaluation,EVALUATION_SCHEMA}=await import("../static/js/lab/history.js");
const {CHALLENGE_VERSION}=await import("../static/js/lab/challenges.js");
const saved=validateEvaluation({schema:EVALUATION_SCHEMA,challenge_version:CHALLENGE_VERSION,created_at:new Date().toISOString(),status:"complete",results:arenaResults});
console.log(`Arena history: two runs each for Rules and cautious add ${(JSON.stringify(saved.results).length*4/(9*1024*1024)*100).toFixed(2)}% of the 9 MB cap`);
console.log("All left-on-red checks passed.");
process.exit(0);
