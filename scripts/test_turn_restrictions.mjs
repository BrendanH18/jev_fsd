import assert from 'node:assert/strict';
import fs from 'node:fs';
globalThis.document = { querySelector: () => null };
const { MapData, pointAt, headingAt } = await import('../static/js/map/mapdata.js');
const { World } = await import('../static/js/sim/world.js');
const { NpcPath } = await import('../static/js/sim/npc.js');
const { Route } = await import('../static/js/map/route.js');
const { CHALLENGES, challengeScenario } = await import('../static/js/lab/challenges.js');
const { restrictionActive, turnBanned, auditRestrictions } = await import('../static/js/sim/turn-restrictions.js');
const { buildSnapshot } = await import('../static/js/brain/sensors.js');
const { routeFromLanes, browserRoute } = await import('../static/js/demo/routing.js');
const { WorldClock } = await import('../static/js/sim/world-clock.js');
const { failures, DriveMetrics } = await import('../static/js/bench/metrics.js');
const { rng } = await import('../static/js/common.js');
const { sampleCandidates, simulateAll } = await import('../static/js/brain/candidates.js');
const { RulesBrain } = await import('../static/js/brain/rules.js');
const { CautiousAgent } = await import('../static/js/agents/cautious.js');
let checks = 0;
function test(name, fn) { fn(); checks++; console.log('✓ '+name); }
const pack = JSON.parse(fs.readFileSync(new URL('../data/maps/4a96d42cb3f2.v6.pack.json', import.meta.url)));
for (const name of ['transit','crossings','zones','rail','calming','scrambles','buslanes','restrictions']) {
  const file = [2, 1].map(v => new URL(`../data/maps/4a96d42cb3f2.${name}.v${v}.json`, import.meta.url)).find(u => fs.existsSync(u));
  if (file) pack[name] = JSON.parse(fs.readFileSync(file));
}
const map = new MapData(pack), ch = CHALLENGES.find(c => c.id === 'no-left-turn'), scenario = challengeScenario(map, ch);
const fromLane = map.lane(scenario.start.edge, scenario.start.lane);
const record = map.restrictions.find(r=>r.id===scenario.restriction);
const toLane = map.lane(record.to[0], 0);
function world(restrictions=true) {
  const w = new World(map, { parked:0, pedestrians:0, restrictions });
  w.placeOnLane(fromLane, scenario.start.s); w.setClock({hour:9,weekday:0});
  w.route = new Route(scenario.route, map); return w;
}
test('conditional boundaries and midnight calendar rollover',()=>{
 const r = {condition:{days:[0,1,2,3,4],start:420,end:540}};
 assert.equal(restrictionActive(r,{hour:8,weekday:0}),true);
 assert.equal(restrictionActive(r,{hour:9,weekday:0}),false);
 assert.equal(restrictionActive(r,{hour:8,weekday:5}),false);
 const clock=new WorldClock(23.99,60,4);clock.update(0);clock.update(2);assert.equal(clock.weekday,5);
});
test('real challenge detours around banned shortest route',()=>{
 assert.equal(scenario.street,'Bathurst Street');
 for(let i=1;i<scenario.route.edges.length;i++) assert.equal(turnBanned(map,scenario.route.edges[i-1],scenario.route.edges[i],{hour:9}),false);
 const p=pointAt(fromLane.pts,fromLane.cum,scenario.start.s);
 const direct=browserRoute(map,{x:p[0],y:p[1],heading:headingAt(fromLane.pts,fromLane.cum,scenario.start.s)},{x:scenario.goal[0],y:scenario.goal[1]});
 assert.equal(direct.edges.some((e,i)=>e===record.from && direct.edges[i+1]===record.to[0]),true);
});
test('sensing reports signs and disabled state omits field',()=>{
 const w=world(); const s=buildSnapshot(w,null);assert.equal(s.turn_restriction.in_effect,true);assert.equal(s.turn_restriction.banned,false);
 assert.equal('turn_restriction' in buildSnapshot(world(false),null),false);
});
test('an illegal planned turn offers a stopping law to both local brains',()=>{
 const w=world(); w.placeOnLane(fromLane,fromLane.length-40);
 w.route=new Route(routeFromLanes(map,[fromLane,toLane],5,30),map);
 const snap=buildSnapshot(w,null);assert.equal(snap.turn_restriction.banned,true);
 const candidates=sampleCandidates(snap,w), {eligible}=simulateAll(candidates,snap,w);

 assert.equal(eligible.some(c=>c.id==='stop_for_turn_restriction'),true);
 assert.equal(new CautiousAgent().decideSync(snap,eligible).candidateId,'stop_for_turn_restriction');
 assert.equal(new RulesBrain().decideSync(snap,eligible).candidateId,'stop_for_turn_restriction');
});
test('audit actual forbidden transition once; disabled audit never runs',()=>{
 const w=world(); w.placeOnLane(fromLane,fromLane.length-15);auditRestrictions(w);
 assert.equal(w.restrictionsSeen,true);
 const p=pointAt(toLane.pts,toLane.cum,15); w.ego.x=p[0];w.ego.y=p[1];w.ego.psi=headingAt(toLane.pts,toLane.cum,15);
 auditRestrictions(w);auditRestrictions(w);assert.equal(w.violations.illegal_turns,1);
 assert.equal(failures({illegal_turns:1}).includes('made a prohibited turn'),true);
});
test('NPC choices respect bans; option off retains exact random stream',()=>{
 const w=world(), a=new NpcPath(map,rng(3),{world:w}); a.start(record.from,0,fromLane.length-20);
 for(let i=1;i<a.edges.length;i++) assert.equal(turnBanned(map,a.edges[i-1].id,a.edges[i].id,w.clock),false);
 const random=rng(13), copy=rng(13), off=new NpcPath(map,random,{world:world(false)}), old=new NpcPath(map,copy);
 off.start(record.from,0,0);old.start(record.from,0,0);
 assert.equal(JSON.stringify(off.edges),JSON.stringify(old.edges));assert.equal(random(),copy());
});
const { evaluateChallenge } = await import('../static/js/lab/evaluation.js');
for (const brain of ['rules', 'cautious']) {
  const result = await evaluateChallenge(map, ch, { brain, limit: 240 });
  console.log(brain, result.arrived, result.pass, result.illegal_turns ?? 0, result.failures);
  assert.equal(result.illegal_turns || 0, 0);
  assert.equal(result.pass, true);
  checks++;
}
console.log(`${checks} turn restriction checks passed`);
process.exit(0);
