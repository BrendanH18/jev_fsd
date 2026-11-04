// node --experimental-default-type=module scripts/test_pxo.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
globalThis.document = { querySelector: () => null };
const { MapData } = await import('../static/js/map/mapdata.js');
const { World } = await import('../static/js/sim/world.js');
const { crosswalkConflict } = await import('../static/js/sim/pedestrians.js');
const { pxoPedestrian, auditPxo } = await import('../static/js/sim/pxo.js');
const { frontTo } = await import('../static/js/sim/crosswalk.js');
const { buildSnapshot } = await import('../static/js/brain/sensors.js');
const { situationClauses, toJevState } = await import('../static/js/brain/state.js');
const { CHALLENGES } = await import('../static/js/lab/challenges.js');
const { setupChallenge, evaluateChallenge } = await import('../static/js/lab/evaluation.js');
const { cloneState } = await import('../static/js/lab/recorder.js');
const { failures, DriveMetrics } = await import('../static/js/bench/metrics.js');
const { DriveScore } = await import('../static/js/sim/drive-score.js');
const root = new URL('../data/maps/', import.meta.url);
function load(key, version = 2) {
  const pack = JSON.parse(fs.readFileSync(new URL(`${key}.v6.pack.json`, root)));
  for (const layer of ['transit','crossings','zones','rail','calming','scrambles']) {
    const p = new URL(`${key}.${layer}.v${layer === 'crossings' ? version : 1}.json`, root);
    if (fs.existsSync(p)) pack[layer] = JSON.parse(fs.readFileSync(p));
  }
  return new MapData(pack);
}
const keys = fs.readdirSync(root).filter(f => f.endsWith('.crossings.v2.json'));
const maps = keys.map(f => load(f.split('.')[0]));
const map = maps.find(m => m.pxos.some(c => c.id === 'x2317854682'));
const old = load(keys.find(f => JSON.parse(fs.readFileSync(new URL(f,root))).crossings.some(c=>c.id==='x2317854682')).split('.')[0],1);
const challenge = CHALLENGES.find(c=>c.id==='pxo-far-curb');
let checks=0;
async function test(name,fn){ await fn(); console.log(`✓ ${name}`); checks++; }
await test('three explicit OSM PXOs on Ontario maps; ordinary crossings unchanged',()=>{
 assert.equal(maps.reduce((n,m)=>n+m.pxos.length,0),3);
 assert.deepEqual(map.crosswalks.map(c=>c.id),old.crosswalks.map(c=>c.id));
});
await test('option off preserves crowd geometry, pedestrians and random streams',()=>{
 const a=new World(map,{seed:4,parked:0,pedestrians:30}),b=new World(old,{seed:4,parked:0,pedestrians:30});
 assert.equal(a.pxo,false); assert.deepEqual(a.crowd.marked.map(c=>c.id),b.crowd.marked.map(c=>c.id));
 assert.deepEqual(a.crowd.list.map(p=>[p.id,p.x,p.y,p.speed]),b.crowd.list.map(p=>[p.id,p.x,p.y,p.speed]));
 assert.equal(a.crowd.marking(),b.crowd.marking());
 assert.equal(Object.hasOwn(new DriveMetrics(100).summary(a, { totals: {} }, false),'pxo_early_goes'),false);
});
await test('PXO sensing, whole-road occupancy and traffic conflict persist after lane clears',()=>{
 const {world}=setupChallenge(map,challenge),ped=world.crowd.list[0],cw=world.crowd.marked.find(c=>c.pxo&&c.id===ped.crossing.marked);
 const route=world.route, p=route.project(world.ego.x,world.ego.y,0);
 let sawCleared=false;
 for(let u=0.1;u<0.95;u+=0.05){
  ped.x=ped.crossing.from[0]*(1-u)+ped.crossing.to[0]*u;ped.y=ped.crossing.from[1]*(1-u)+ped.crossing.to[1]*u;
  const plain=crosswalkConflict(route.pts,route.cum,0,route.length,{list:[ped]});
  const full=crosswalkConflict(route.pts,route.cum,0,route.length,world.crowd);
  if(!plain&&pxoPedestrian(world.crowd,ped)){assert.equal(!!full,true);sawCleared=true;break;}
 }
 assert.equal(sawCleared,true,'challenge must expose lane-clear interval');
 const snap=buildSnapshot(world); assert.equal(!!snap.pxo,true);
 assert.equal(toJevState(snap, [], {}).pxo.occupied,true);
 assert.match(situationClauses(snap).join(' '),/WHOLE roadway/);
 ped.crossing=null;assert.equal(pxoPedestrian(world.crowd,ped),false);assert.equal(!!buildSnapshot(world).pxo,false);
});
await test('audit counts a line crossing once, and reports only after use',()=>{
 const {world}=setupChallenge(map,challenge),ped=world.crowd.list[0],cw=world.crowd.marked.find(c=>c.id===ped.crossing.marked);
 // Put the walker in the roadway, clear of the car itself.
 ped.x=(cw.ends[1][0]+cw.ends[-1][0])/2;ped.y=(cw.ends[1][1]+cw.ends[-1][1])/2;
 const score=new DriveScore(world);
 const car=world.ego,d=frontTo(cw,car),h=car.psi;
 car.x+=(d-3)*Math.cos(h);car.y+=(d-3)*Math.sin(h);car.v=2;auditPxo(world);
 car.x+=2*Math.cos(h);car.y+=2*Math.sin(h);auditPxo(world);auditPxo(world);
 assert.equal(world.violations.pxo_early_goes,1);assert.equal(world.pxoSeen,true);
 score.record(world,null,1/60);assert.equal(score.snapshot().pxo_early_goes,1);
 assert.equal(new DriveMetrics(100).summary(world,{totals:{}},false).pxo_early_goes,1);
 assert.equal(failures({pxo_early_goes:1}).includes('left a pedestrian crossover before the far curb'),true);
});
await test('every walker must clear; replay preserves occupancy and line memory',()=>{
 const {world}=setupChallenge(map,challenge),ped=world.crowd.list[0],cross=ped.crossing;
 ped.x=(cross.from[0]+cross.to[0])/2;ped.y=(cross.from[1]+cross.to[1])/2;
 const second=Object.assign(Object.create(Object.getPrototypeOf(ped)),ped,{id:'second_pxo_walker'});
 world.crowd.list.push(second);ped.crossing=null;
 assert.equal(buildSnapshot(world).pxo.pedestrian_ids.includes(second.id),true);
 world.pxoLines.set(cross.marked,3);
 const copy=cloneState(world,new Set([map]));
 assert.equal(copy.pxoLines.get(cross.marked),3);assert.equal(copy.crowd.pxo,true);
 second.crossing=null;assert.equal(!!buildSnapshot(world).pxo,false);
});
await test('Ontario gate excludes other maps; free-drive corner legs use the real PXO',()=>{
 const nonOntario=Object.create(map);nonOntario.routingBbox=[-123.2,49.2,-123.1,49.3];
 const off=new World(nonOntario,{pxo:true,parked:0,pedestrians:0});assert.equal(off.pxo,false);
 const {world}=setupChallenge(map,challenge);
 const legs=[...world.crowd.legsAt.values()].flatMap(i=>i.list).filter(l=>l.pxo);
 assert.ok(legs.some(l=>l.pxo==='x2317854682'));
 for(const l of legs){const cw=world.crowd.marked.find(c=>c.id===l.pxo);assert.equal(l.s,cw.s);}
});
for(const brain of ['rules','cautious']) await test(`challenge finishes with ${typeof brain==='string'?brain:'cautious'}`,async()=>{
 const run=await evaluateChallenge(map,challenge,{brain,limit:90});
 console.log(JSON.stringify({brain,time_s:run.time_s,arrived:run.arrived,failures:run.failures,pxo_early_goes:run.pxo_early_goes}));
 assert.equal(run.pxo_early_goes,0); assert.equal(run.arrived,true); assert.equal(run.pass,true,run.failures.join(', '));
});
console.log(`${checks} PXO checks passed`);process.exit(0);
