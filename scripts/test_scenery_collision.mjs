// node --experimental-default-type=module scripts/test_scenery_collision.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
globalThis.document = { querySelector: () => null };
const { MapData } = await import('../static/js/map/mapdata.js');
const { sceneryFor, sceneryHash } = await import('../static/js/map/scenery.js');
const { buildingShapes, boxPolygon } = await import('../static/js/map/building-scenery.js');
const { StaticObstacles, obbCircleOverlap } = await import('../static/js/sim/static-obstacles.js');
const { World } = await import('../static/js/sim/world.js');
const { Vehicle, CAR } = await import('../static/js/sim/vehicle.js');
const { simulateAll } = await import('../static/js/brain/candidates.js');
const { DriveScore } = await import('../static/js/sim/drive-score.js');
let passed=0;
const test=(name,fn)=>{fn();passed++;console.log(`✓ ${name}`);};
const rect=(x,y,w,h)=>[[x-w,y-h],[x+w,y-h],[x+w,y+h],[x-w,y+h]];
function fixture() {
  const edge={id:'road',from:'a',to:'b',pts:[[-70,0],[70,0]],length:140,cls:'residential',name:'Scenery Street',limit:11.2,lanes:1,lane_offsets:[0],asphalt:[-4,4],parking:[0,0],control:{type:'yield',id:'yield',s_line:95,roundabout:'island'}};
  return new MapData({bbox:[0,0,1,1],extent:[-80,-60,80,60],edges:[edge],lanes:[{edge:'road',idx:0,pts:edge.pts}],nodes:[{id:'a',x:-70,y:0},{id:'b',x:70,y:0}],
    intersections:[{id:'signal',x:70,y:0,vertices:['b'],approaches:[{edge:'road',group:'A'}]}],stops:[{id:'stop',edge:'road',s_line:90}],roundabouts:[{id:'island',x:40,y:40,island_r:3,vertices:[]}],
    buildings:Array.from({length:8},(_,i)=>({pts:rect(-60+i*17,25,5,4),h:8}))});
}
function circlesOnly(circles) {
  const map={pack:{buildings:[]}};
  sceneryFor(map).circles.push(...circles);
  return new StaticObstacles(map);
}
const snap=w=>({ego:w.ego,road:w.roadInfo(),route:null,routeProj:null,onRoute:false,observed:[],intersection:null,pedestrian:null,visibility:{safe_speed_mps:40}});

test('minimal renderer and headless fixtures remain compatible',()=>{
  assert.equal(sceneryFor({pack:{buildings:[]}}).circles.length,0);
  assert(sceneryFor({extent:[1000,500,1080,580],roundabouts:new Map(),roadDistance:()=>({distance:20})}).trees.length>0);
  const e={id:'e',from:'a',to:'b',length:120,name:'Government Street',limit:50/3.6,pts:[[0,0],[120,0]],cum:[0,120],asphalt:[-4,4]};
  assert.equal(sceneryFor({edges:new Map([['e',e]])}).streetSigns.length,2);
});
test('one deterministic manifest supplies every rendered trunk/post and exterior collider',()=>{
  const map=fixture(),a=sceneryFor(map),b=sceneryFor(fixture());
  assert.equal(a,sceneryFor(map));
  assert.deepEqual(a.circles,b.circles);
  assert.deepEqual(a.polygons,b.polygons);
  assert(a.trees.length>10&&a.lamps.length>0&&a.streetSigns.length>0&&a.stopSigns.length&&a.yieldSigns.length&&a.signals.length);
  assert.equal(a.circles.length,a.trees.length+a.lamps.length+a.streetSigns.length+a.stopSigns.length+a.yieldSigns.length+a.signals.length);
  assert.equal(new Set([...a.circles,...a.polygons].map(o=>o.id)).size,a.circles.length+a.polygons.length);
  for(const tree of a.trees)assert(Math.abs(a.circles.find(o=>o.id===`tree:${tree.key}`).radius-(tree.kind==='conifer'?0.204:0.255*tree.size))<1e-12);
  assert(a.polygons.some(o=>o.kind==='hedge')&&a.polygons.some(o=>o.kind==='porch'));
});
test('street sign atlas capacity creates no invisible collision posts',()=>{
  const edges=new Map(Array.from({length:150},(_,i)=>[`e${i}`,{id:`e${i}`,from:`a${i}`,to:`b${i}`,length:60,name:`Street ${i}`,limit:11.2,pts:[[i*80,0],[i*80+60,0]],cum:[0,60],asphalt:[-4,4]}]));
  const manifest=sceneryFor({edges});
  assert.equal(manifest.streetSigns.length,128);
  assert.equal(manifest.circles.filter(o=>o.kind==='sign_post').length,128);
});
test('circle-vs-oriented-footprint respects corner distance rather than square bounds',()=>{
  const box={center:[0,0],heading:Math.PI/4,halfLength:2,halfWidth:1};
  const world=(x,y)=>({x:x*Math.cos(box.heading)-y*Math.sin(box.heading),y:x*Math.sin(box.heading)+y*Math.cos(box.heading),radius:0.2});
  assert(obbCircleOverlap(box,world(2.1,1.1)));
  assert(!obbCircleOverlap(box,world(2.19,1.19)));
  assert(obbCircleOverlap(box,world(0,0)));
});
test('analytic translating sweep catches a thin post corner graze between samples',()=>{
  const obstacles=circlesOnly([{id:'thin',kind:'sign_post',x:10.013,y:CAR.width/2+0.035-1e-7,radius:0.035}]);
  const start={x:0,y:0,psi:0},end={x:20,y:0,psi:0};
  assert.equal(obstacles.overlaps(new Vehicle().obb()).length,0);
  assert.equal(obstacles.overlaps(new Vehicle(20,0,0).obb()).length,0);
  const hit=obstacles.sweep(start,end,CAR);
  assert(hit&&hit.obstacle.id==='thin'&&hit.fraction>0&&hit.fraction<1);
  assert.equal(obstacles.overlaps(new Vehicle(hit.safePose.x,hit.safePose.y,hit.safePose.psi).obb()).length,0);
  assert.equal(obstacles.sweep(start,end,CAR,0)?.obstacle.kind,'sign_post');
});
test('rotating corner travel catches slender poles without sampling through contact',()=>{
  const angle=0.4137,c=Math.cos(angle),s=Math.sin(angle),fx=CAR.length-CAR.rearOverhang,fy=-CAR.width/2;
  const radius=0.035;
  const circle={id:'rotating',kind:'sign_post',x:(fx+radius-1e-6)*c-fy*s,y:(fx+radius-1e-6)*s+fy*c,radius};
  const obstacles=circlesOnly([circle]);
  const hit=obstacles.sweep({x:0,y:0,psi:0},{x:0,y:0,psi:0.8},CAR);
  assert(hit&&hit.obstacle.id===circle.id);
  assert.equal(obstacles.overlaps(new Vehicle(hit.safePose.x,hit.safePose.y,hit.safePose.psi).obb()).length,0);
});
test('a car pressed against a post can reverse away with slight steering',()=>{
  const obstacles=circlesOnly([{id:'post',kind:'sign_post',x:10,y:0,radius:0.035}]);
  let pose=obstacles.sweep({x:0,y:0,psi:0},{x:12,y:0,psi:0},CAR).safePose;
  for(let i=0;i<30;i++)pose=obstacles.sweep(pose,{...pose,x:pose.x+0.001},CAR).safePose;
  assert.equal(obstacles.overlaps(new Vehicle(pose.x,pose.y,pose.psi).obb()).length,0);
  assert.equal(obstacles.sweep(pose,{...pose,x:pose.x-0.02,psi:0.001},CAR),null);
  assert(obstacles.sweep(pose,{...pose,x:pose.x+0.02,psi:0.001},CAR));
});
test('driving into a rendered tree blocks motion, counts once and caps scoring',()=>{
  const map=fixture(),world=new World(map,{parked:0,pedestrians:0}),tree=sceneryFor(map).trees.find(t=>t.key==='island');
  const score=new DriveScore(world);
  world.ego.x=tree.x-10;world.ego.y=tree.y;world.ego.psi=0;world.resetContactHistory();world.ego.v=20;
  world.ego.step(0.5,{accel:0});world.t+=0.5;world.audit(0.5,world.roadInfo());
  assert.equal(world.events.find(e=>e.type==='collision')?.kind,'tree');
  assert.equal(world.ego.v,0);assert.equal(world.violations.collisions,1);assert.equal(world.violations.collisions_at_fault,1);
  assert.equal(world.staticObstacles.overlaps(world.ego.obb()).length,0);
  for(let i=0;i<120;i++){world.ego.step(1/60,{accel:2.5});world.t+=1/60;world.audit(1/60,world.roadInfo());}
  assert.equal(world.violations.collisions,1);
  score.record(world,world.roadInfo(),1);assert(score.snapshot().score<=59);
});
test('candidate prediction rejects the same tree and stops distinguishing canopy as solid',()=>{
  const map=fixture(),world=new World(map,{parked:0,pedestrians:0}),tree=sceneryFor(map).trees.find(t=>t.key==='island');
  Object.assign(world.ego,{x:tree.x-10,y:tree.y,psi:0,v:5});world.resetContactHistory();
  const candidates=[{id:'tree',law:{kind:'steer',steer:0,vTarget:5}},{id:'brake',law:{kind:'hard_brake'}}];
  simulateAll(candidates,snap(world),world);
  assert.equal(candidates[0].sim.collision.kind,'tree');assert.equal(candidates[0].reject,'collision');assert.equal(candidates[1].eligible,true);
  assert(!world.obstaclesNear(tree.x,tree.y,50).some(o=>o.kind==='tree'));
  assert(!obbCircleOverlap(new Vehicle(tree.x-1.35,tree.y+2,0).obb(),{...tree,radius:0.255*tree.size}));
});
test('every rendered porch/hedge boundary is indexed with identical geometry',()=>{
  const map=fixture(),manifest=sceneryFor(map),index=new StaticObstacles(map);
  for(const building of buildingShapes(map))for(const box of building.boxes) {
    if(!['porch','porch_step','porch_post','hedge'].includes(box.part))continue;
    const collider=index.list.find(o=>o.id===box.id);assert(collider);assert.deepEqual(collider.pts,boxPolygon(box));
    assert(index.overlaps({center:[box.cx,box.cy],heading:Math.atan2(box.uy,box.ux),halfLength:0.05,halfWidth:0.05}).some(o=>o.id===box.id));
  }
  assert(!manifest.polygons.some(o=>o.kind==='porch_roof'));
});
test('real map scenery remains spatially bounded for physics queries',()=>{
  const pack=JSON.parse(fs.readFileSync(new URL('../data/maps/623b012bc8b5.v5.pack.json',import.meta.url),'utf8'));
  const map=new MapData(pack),manifest=sceneryFor(map),index=new StaticObstacles(map);
  assert(manifest.trees.length>500&&manifest.circles.length>1000);
  assert(index.query([-5,-5,5,5]).length<30);
  for(const kind of ['tree','sign_post','signal_post','stop_post','yield_post','lamp_post','porch','porch_step','hedge'])assert(index.list.some(o=>o.kind===kind),kind);
});
console.log(`${passed} scenery collision tests passed`);
