// node --experimental-default-type=module scripts/test_scenery_collision.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
globalThis.document = { querySelector: () => null };
const { MapData, projectPoint } = await import('../static/js/map/mapdata.js');
const { Route } = await import('../static/js/map/route.js');
const { Autopilot } = await import('../static/js/brain/brain.js');
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
  const pack=JSON.parse(fs.readFileSync(new URL('../data/maps/623b012bc8b5.v6.pack.json',import.meta.url),'utf8'));
  const map=new MapData(pack),manifest=sceneryFor(map),index=new StaticObstacles(map);
  assert(manifest.trees.length>500&&manifest.circles.length>1000);
  assert(index.query([-5,-5,5,5]).length<30);
  for(const kind of ['tree','sign_post','signal_post','stop_post','yield_post','lamp_post','porch','porch_step','hedge'])assert(index.list.some(o=>o.kind===kind),kind);
});
test('a far-side signal pole stands beyond the curb of a wider street the approach continues into',()=>{
  // A one-lane approach (asphalt 3.5 m right of its centre) continues straight into a street whose
  // right lane is centred 5.25 m right of the same line; a cross street makes the junction.
  const two=(id,from,to,pts,lanes,asphalt,offs)=>({id,from,to,pts,length:Math.hypot(pts[1][0]-pts[0][0],pts[1][1]-pts[0][1]),lanes,lane_width:3.5,lane_offsets:offs,asphalt,parking:[0,0],cls:'primary',limit:13.9,oneway:false,name:id});
  const edges=[two('in','w','j',[[-100,0],[0,0]],1,[-3.5,3.5],[1.75]),two('out','j','e',[[0,0],[100,0]],2,[-7,7],[1.75,5.25]),
    two('cross','n','j',[[0,100],[0,0]],1,[-3.5,3.5],[1.75]),two('cross_back','j','n',[[0,0],[0,100]],1,[-3.5,3.5],[1.75])];
  const lanes=edges.flatMap(e=>e.lane_offsets.map((d,idx)=>{const [a,b]=e.pts,h=Math.atan2(b[1]-a[1],b[0]-a[0]),nx=Math.sin(h),ny=-Math.cos(h);return {edge:e.id,idx,pts:[[a[0]+nx*d,a[1]+ny*d],[b[0]+nx*d,b[1]+ny*d]]};}));
  const map=new MapData({bbox:[0,0,1,1],extent:[-120,-120,120,120],edges,lanes,nodes:['w','j','e','n'].map(id=>({id,x:0,y:0})),
    intersections:[{id:'sig',x:0,y:0,vertices:['j'],approaches:[{edge:'in',group:'A',s_line:90},{edge:'cross',group:'B',s_line:90}]}],stops:[],buildings:[]});
  const pole=sceneryFor(map).signals.find(p=>p.a.edge==='in');
  assert(pole&&pole.x>0,'the pole stays on the far side');
  assert(-pole.y>=7+0.17,`the pole stands beyond the wider street's asphalt (${(-pole.y).toFixed(2)} m)`);
  assert.equal(pole.poleLat,-pole.y);
});
test('no post or trunk stands in a lane or on the asphalt of any bundled map',()=>{
  const dir=new URL('../data/maps/',import.meta.url);
  // The twelve bundled packs (docs/maps.md); packs built for custom areas share the directory.
  const packs=['623b012bc8b5','7165f1c807a8','d7454a9751b7','4a96d42cb3f2','bb9df59633e0','a53c5bcf6438','d25b07def0d2','8e99888cb743','49db0d437c8c','19bb885c9cae','3e794edbefcb','ca5573a8d934'].map(h=>`${h}.v6.pack.json`);
  for(const file of packs) {
    const map=new MapData(JSON.parse(fs.readFileSync(new URL(file,dir),'utf8')));
    const bad=[];
    for(const c of sceneryFor(map).circles) {
      const lanes=map.lanesNear(c.x,c.y,15),edges=new Set(lanes.map(l=>l.edgeRef));
      const inLane=lanes.find(l=>projectPoint(l.pts,l.cum,[c.x,c.y]).distance<(l.edgeRef.lane_width||3.5)/2+c.radius);
      const onAsphalt=[...edges].find(e=>{const p=projectPoint(e.pts,e.cum,[c.x,c.y]);return p.distance<=Math.abs(p.lateral)+0.01&&p.lateral>e.asphalt[0]-c.radius&&p.lateral<e.asphalt[1]+c.radius;});
      if(inLane||onAsphalt)bad.push(`${c.id} ${inLane?`in a lane of ${inLane.edgeRef.id}`:`on ${onAsphalt.id}`}`);
    }
    assert.deepEqual(bad,[],`${map.pack.name}: ${bad.slice(0,5).join('; ')}`);
    // two-way streets: every lane lies within its street's asphalt
    for(const e of map.edges.values())for(const d of e.lane_offsets)assert(d+(e.lane_width||3.5)/2<=e.asphalt[1]+1e-6&&d-(e.lane_width||3.5)/2>=e.asphalt[0]-1e-6,`${map.pack.name} ${e.id}`);
  }
});
test('a car stuck behind solid scenery does not creep into it',()=>{
  const edge={id:'road',from:'a',to:'b',pts:[[0,0],[140,0]],length:140,cls:'residential',name:'Blocked Street',limit:11.2,lanes:1,lane_width:3.5,lane_offsets:[0],asphalt:[-4,4],parking:[0,0],oneway:true};
  const map=new MapData({bbox:[0,0,1,1],extent:[-10,-60,150,60],edges:[edge],lanes:[{edge:'road',idx:0,pts:edge.pts}],nodes:[{id:'a',x:0,y:0},{id:'b',x:140,y:0}],intersections:[],stops:[],buildings:[]});
  sceneryFor(map).circles.length=0;
  sceneryFor(map).circles.push({id:'tree:block',kind:'tree',x:30,y:0,radius:2.5});
  const world=new World(map,{parked:0,pedestrians:0});
  Object.assign(world.ego,{x:22,y:0,psi:0,v:0});world.resetContactHistory();
  world.route=new Route({id:'r',polyline:Array.from({length:141},(_,i)=>[i,0]),edges:['road'],turns:[],start_s:0,goal_s:140},map);
  world.destination=[140,0];
  const autopilot=new Autopilot(world);autopilot.setBrain('rules');autopilot.setEnabled(true);
  for(let i=0;i<60*20;i++){autopilot.step(1/60,world.t*1000);world.t+=1/60;world.audit(1/60,world.roadInfo());}
  assert.equal(world.violations.collisions,0);
  assert.equal(world.violations.deadlock_overrides,0);
  assert(world.stuckFor>12,'the car is stuck long enough for the deadlock creep');
  assert(world.ego.x<23,'the car stays behind the tree');
});
function blockedStreet(circles,{npcs=[],brain=null,psi=0,seconds=25}={}) {
  const edge={id:'road',from:'a',to:'b',pts:[[0,0],[140,0]],length:140,cls:'residential',name:'Post Street',limit:11.2,lanes:1,lane_width:3.5,lane_offsets:[0],asphalt:[-4,4],parking:[0,0],oneway:true};
  const map=new MapData({bbox:[0,0,1,1],extent:[-10,-60,150,60],edges:[edge],lanes:[{edge:'road',idx:0,pts:edge.pts}],nodes:[{id:'a',x:0,y:0},{id:'b',x:140,y:0}],intersections:[],stops:[],buildings:[]});
  sceneryFor(map).circles.length=0;sceneryFor(map).circles.push(...circles);
  const world=new World(map,{parked:0,pedestrians:0});
  Object.assign(world.ego,{x:22,y:0,psi,v:0});world.resetContactHistory();world.npcs=npcs;
  world.route=new Route({id:'r',polyline:Array.from({length:141},(_,i)=>[i,0]),edges:['road'],turns:[],start_s:0,goal_s:140},map);
  world.destination=[140,0];
  const autopilot=new Autopilot(world);
  if(brain){autopilot.brains.slow=brain;autopilot.brainName='slow';}else autopilot.setBrain('rules');
  autopilot.setEnabled(true);
  for(let i=0;i<60*seconds;i++){autopilot.step(1/60,world.t*1000);world.t+=1/60;world.audit(1/60,world.roadInfo());}
  return world;
}
test('a predicted contact with a car alongside does not hide a post ahead from the creep check',()=>{
  const parked=new Vehicle(22,2.1,0,0);parked.id='alongside';
  const world=blockedStreet([{id:'lamp_post:ahead',kind:'lamp_post',x:25.92,y:0,radius:0.22}],{npcs:[parked]});
  assert.equal(world.violations.collisions,0);
});
test('a creep that outlives its check while a model answer is pending stops short of a post',()=>{
  const pending={timeoutMs:60000,decide:()=>new Promise(()=>{})};
  const world=blockedStreet([{id:'lamp_post:ahead',kind:'lamp_post',x:34,y:0,radius:0.22}],{brain:pending});
  assert(world.violations.deadlock_overrides>0,'the creep starts');
  assert.equal(world.violations.collisions,0);
  assert(world.ego.x<34);
});
test('a creep stopped for a post further on keeps steering around a nearer one',()=>{
  const pending={timeoutMs:60000,decide:()=>new Promise(()=>{})};
  const world=blockedStreet([{id:'lamp_post:near',kind:'lamp_post',x:26.32,y:1.9,radius:0.1},{id:'lamp_post:far',kind:'lamp_post',x:30.5,y:0,radius:0.1}],{brain:pending,psi:0.3,seconds:14});
  assert(world.violations.deadlock_overrides>0,'the creep starts');
  assert.equal(world.violations.collisions,0);
});
{
  // Belleville Street in Victoria's Old Town, westbound in the curb lane toward Government Street,
  // where it turns right: a mapped building's corner stands 0.4 m from the lane's centre, closer than
  // half the car's width. With no traffic about, the car used to stop short of it for good.
  const pack=JSON.parse(fs.readFileSync(new URL('../data/maps/d7454a9751b7.v6.pack.json',import.meta.url)));
  const map=new MapData(pack);
  const { routeFromLanes }=await import('../static/js/demo/routing.js');
  const { NpcFleet }=await import('../static/js/sim/npc.js');
  const { stepWorld }=await import('../static/js/sim/step.js');
  const e=map.edges.get('e392'),right=map.successors('e392').find(id=>map.classifyTurn(map.turnAngle('e392',id))==='right');
  const lane=map.lane('e392',e.lanes-1),turn=map.lane(right,map.edges.get(right).lanes-1);
  const route=routeFromLanes(map,[lane,turn],5,Math.min(40,turn.length-5));
  const world=new World(map,{seed:3});
  world.placeOnLane(lane,5);
  const ctx={world,fleet:new NpcFleet(world,{count:0,seed:3}),autopilot:new Autopilot(world)};
  ctx.autopilot.setBrain('rules');
  world.route=new Route(route,map,world.ego.spec); world.destination=route.polyline.at(-1);
  ctx.autopilot.setEnabled(true);
  const { buildSnapshot }=await import('../static/js/brain/sensors.js');
  const { sampleCandidates }=await import('../static/js/brain/candidates.js');
  // (10 m along at 4 m/s, the candidates run past the cap of 15)
  world.placeOnLane(lane,10); world.ego.v=4;
  const offered=sampleCandidates(buildSnapshot(world),world).map(c=>c.id);
  world.placeOnLane(lane,5); world.ego.v=0;
  const line=ctx.world.route.controls.find(c=>c.control.id==='sig36').sRoute;
  let past=null;
  while(ctx.world.t<60&&past===null){
    stepWorld(ctx,1/60,ctx.world.t*1000);
    const p=ctx.world.route.project(ctx.world.ego.x,ctx.world.ego.y);
    if(p.s>line+2)past=ctx.world.t;
  }
  test('with a building corner in the lane ahead, full-metre nudges either way are offered, within the cap on candidates',()=>{
    for(const id of ['left_1_hold','left_1_target','right_1_hold','right_1_target'])assert(offered.includes(id),`${id}: ${offered.join(' ')}`);
  });
  test('a building corner standing in the curb lane: the car moves over a metre to pass it, stops at the line beside it, and turns',()=>{
    assert.equal(ctx.world.violations.collisions,0);
    assert.notEqual(past,null,'past the line within 60 s');
    assert.equal(ctx.world.violations.red_lights_run,0);
  });
}
console.log(`${passed} scenery collision tests passed`);
