// Node 22: node --experimental-default-type=module scripts/test_night_flash.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
globalThis.document = { querySelector: () => null };
const { MapData, pointAt, headingAt } = await import("../static/js/map/mapdata.js");
const { Vehicle, CAR, BIKE } = await import("../static/js/sim/vehicle.js");
const { NpcFleet, NpcPath } = await import("../static/js/sim/npc.js");
const { StopMemory } = await import("../static/js/sim/signals.js");
const { stepWorld } = await import("../static/js/sim/step.js");
const { World } = await import("../static/js/sim/world.js");
const { controlAt } = await import("../static/js/sim/outage.js");
const { flashing, flashMain, flashState, NIGHT_CAUTION_MPS, nightFlashNotice } = await import("../static/js/sim/night-flash.js");
const { approachPhase, advanceHolds, pedPhase, scrambleState } = await import("../static/js/sim/signals.js");
const { outranks } = await import("../static/js/sim/priority.js");
const { buildSnapshot } = await import("../static/js/brain/sensors.js");
const { situationClauses } = await import("../static/js/brain/state.js");
const { CHALLENGES } = await import("../static/js/lab/challenges.js");
const { setupChallenge, evaluateChallenge } = await import("../static/js/lab/evaluation.js");
const pack = JSON.parse(fs.readFileSync(new URL("../data/maps/49db0d437c8c.v6.pack.json", import.meta.url)));
for (const layer of ["transit", "crossings", "zones", "rail", "calming", "scrambles", "buslanes", "restrictions"]) {
  const u = [2,1].map(v => new URL(`../data/maps/49db0d437c8c.${layer}.v${v}.json`, import.meta.url)).find(u => fs.existsSync(u));
  if (u) pack[layer] = JSON.parse(fs.readFileSync(u));
}
const map = new MapData(pack), challenge = CHALLENGES.find(c => c.id === "after-midnight");
let checks = 0;
async function test(name, fn) { await fn(); checks++; console.log(`✓ ${name}`); }
await test("strict class separation, clock boundaries, no clock and opt-out", () => {
  const world = new World(map, { nightFlash: true, parked: 0, pedestrians: 0 });
  const i = map.intersections.get("sig24");
  assert.equal(flashMain(i, map), "A");
  assert.equal(flashing(i, world), null);
  for (const [hour, on] of [[23,true],[0,true],[4.999,true],[5,false],[22.999,false]]) {
    world.clock = { hour }; assert.equal(!!flashing(i, world), on);
  }
  world.nightFlash = false; world.clock.hour = 1; assert.equal(flashing(i, world), null);
  const equal = { approaches: [{edge:"e153",group:"A"},{edge:"e156",group:"B"}] };
  assert.equal(flashMain(equal,map), null);
});
await test("red is an approach-specific two-way stop; amber has priority; outages supersede both", () => {
  const { world } = setupChallenge(map,challenge), edge = map.edges.get("e334"), inter = map.intersections.get(edge.control.id);
  const c = controlAt(world,edge.control,edge.id);
  assert.equal(c.type,"stop"); assert.equal(c.all_way,false); assert.equal(c.night_flash,true);
  assert.equal(approachPhase(inter,edge.id,0),"flashing_red");
  assert.equal(world.light(inter.id,"e153"),"flashing_amber");
  assert.equal(outranks(map,"e153",edge.id,world),true);
  assert.equal(advanceHolds(inter,edge.id,0),false); assert.equal(scrambleState(inter,0),null);
  assert.equal(pedPhase(inter,"A",0),"dark");
  world.outages.cut(inter.id); assert.equal(controlAt(world,edge.control,edge.id).all_way,true);
  assert.equal(flashing(inter,world),null);
});
await test("sensing, wording, HUD and stop audit", () => {
  const {world,scenario} = setupChallenge(map,challenge);
  world.placeOnLane(map.lane(scenario.start.edge,scenario.start.lane), map.edges.get(scenario.start.edge).control.s_line - 25);
  const s = buildSnapshot(world);
  assert.equal(s.intersection.signal,"flashing_red"); assert.equal(s.intersection.control,"stop");
  assert.equal(s.intersection.right_on_red,null); assert.equal(s.intersection.advance,null);
  assert.equal(s.intersection.seconds_to_green,null);
  assert.equal(nightFlashNotice(world)?.text.includes("FLASHING RED"),true);
  const canSee = world.visibility.canSee;
  world.visibility.canSee = () => false;
  assert.equal(buildSnapshot(world).intersection.signal,"unknown");
  world.visibility.canSee = canSee;
  assert.equal(situationClauses(s).some(x=>x.includes("Flashing red")),true);
  // Move across the line at speed, retaining the previous audit frame.
  const lane = map.lane(scenario.start.edge,scenario.start.lane), line = lane.edgeRef.control.s_line;
  world.placeOnLane(lane,line - 5); world.ego.v=5; world.audit(1/60,world.roadInfo());
  const previous = world.lastRoad; world.placeOnLane(lane,line); world.lastRoad = previous; world.ego.v=5; world.audit(1/60,world.roadInfo());
  assert.equal(world.nightFlashSeen,true);
  assert.equal(world.violations.stop_signs_run,1);
});

await test("red departure in front of main-street traffic fails to yield", () => {
  const {world,fleet} = setupChallenge(map,challenge);
  const edge = map.edges.get("e153"), lane = map.lane(edge.id,0), at = lane.length-8;
  const p = pointAt(lane.pts,lane.cum,at), n = new Vehicle(...p,headingAt(lane.pts,lane.cum,at),10);
  const then = map.successors(edge.id).find(id=>map.classifyTurn(map.turnAngle(edge.id,id)) === "straight");
  Object.assign(n,{id:"main",path:new NpcPath(map,fleet.random)}); n.path.start(edge.id,0,at,[[then,0]]);
  world.npcs = [n];
  const c = world.route.controls[0], front = world.ego.spec.length-world.ego.spec.rearOverhang;
  const position = at => { const p=world.route.pointAt(at); Object.assign(world.ego,{x:p[0],y:p[1],psi:world.route.headingAt(at)}); };
  position(c.sRoute-front-0.5); world.ego.v=0;
  for(let k=0;k<60;k++) { world.audit(1/60,world.roadInfo()); world.t+=1/60; world.tick++; }
  assert.equal(world.egoStop.completed,true);
  for(let d=0;d<25;d+=0.2) { position(c.sRoute-front+d); world.ego.v=5; world.audit(1/60,world.roadInfo()); world.t+=1/60; world.tick++; }
  assert.equal(world.violations.stop_signs_run,0);
  assert.equal(world.violations.failed_to_yield,1);
});
await test("NPC cars and cyclists stop on red and slow on amber", () => {
  for (const spec of [CAR, BIKE]) for (const edgeId of ["e334", "e153"]) {
    const world = new World(map, { nightFlash: true, parked: 0, pedestrians: 0 });
    world.setClock({hour:1}); world.ego.x = world.ego.y = 1e5;
    const fleet = new NpcFleet(world, {count:0,bikes:0,seed:39042});
    const edge = map.edges.get(edgeId), lane = map.lane(edgeId,0), start = edge.control.s_line - 35 - (spec.length - spec.rearOverhang);
    const pos = pointAt(lane.pts,lane.cum,start), n = new Vehicle(...pos,headingAt(lane.pts,lane.cum,start),6,spec);
    const then = map.successors(edgeId).find(id=>map.classifyTurn(map.turnAngle(edgeId,id)) === "straight");
    Object.assign(n,{id:"test",v0:10,kind:spec === BIKE ? "bike" : "car",side:0,color:0,stopMem:new StopMemory(),path:new NpcPath(map,fleet.random),frozen:0,waiting:0});
    n.path.start(edgeId,0,start,[[then,0]]); fleet.vehicles.push(n);
    let lowest = Infinity, crossed = false;
    for (let k=0;k<1800;k++) {
      stepWorld({world,fleet,autopilot:{enabled:false}},1/60,world.t*1000);
      const e = n.path.edges.find(e=>e.id === edgeId);
      if (!e) break;
      const b = e.sStart + edge.control.s_line / edge.length * (e.sEnd-e.sStart) - n.path.s - (spec.length-spec.rearOverhang);
      if (Math.abs(b)<6) lowest = Math.min(lowest,n.v);
      if (b<0) { crossed=true; break; }
    }
    assert.equal(crossed,true,`${edgeId}: clears the line`);
    assert.equal(lowest < (edgeId === "e334" ? 0.2 : NIGHT_CAUTION_MPS+0.2),true,`${edgeId}: required approach speed`);
  }
});
for (const brain of ["rules","cautious"]) await test(`After midnight passes with ${brain}`,async()=>{
  const r = await evaluateChallenge(map,challenge,{brain});
  console.log(JSON.stringify({brain,pass:r.pass,arrived:r.arrived,failures:r.failures,time:r.time_s}));
  assert.equal(r.pass,true); assert.equal(r.stop_signs,0); assert.equal(r.failed_to_yield,0);
});
console.log(`${checks} night flash checks passed`);
process.exit(0);
