import assert from 'node:assert/strict';
import fs from 'node:fs';
globalThis.document = { querySelector: () => null };
const { MapData } = await import('../static/js/map/mapdata.js');
const { sceneryFor } = await import('../static/js/map/scenery.js');
const { World } = await import('../static/js/sim/world.js');
const { Vehicle } = await import('../static/js/sim/vehicle.js');
const { headlights, auditHighBeams, npcHighBeam } = await import('../static/js/sim/high-beams.js');
const { RulesBrain } = await import('../static/js/brain/rules.js');
const { CautiousAgent } = await import('../static/js/agents/cautious.js');
const { evaluateChallenge, setupChallenge } = await import('../static/js/lab/evaluation.js');
const { CHALLENGES } = await import('../static/js/lab/challenges.js');
const { buildSnapshot } = await import('../static/js/brain/sensors.js');
const { toJevState, buildQuestions } = await import('../static/js/brain/state.js');
const { EvaluationTrace } = await import('../static/js/lab/trace.js');
const { failures } = await import('../static/js/bench/metrics.js');
const { buildLlmPrompt } = await import('../static/js/brain/llm-prompt.js');
const { llmDecision } = await import('../static/js/brain/llm.js');
const { decisionResult } = await import('../static/js/brain/jev.js');
const { DriveRecorder } = await import('../static/js/lab/recorder.js');
const pack = JSON.parse(fs.readFileSync(new URL('../data/maps/ca5573a8d934.v6.pack.json', import.meta.url)));
for (const name of ['transit','crossings','zones','rail','calming','scrambles','buslanes','restrictions','contraflow']) {
 const file = [2,1].map(v=>new URL(`../data/maps/ca5573a8d934.${name}.v${v}.json`,import.meta.url)).find(u=>fs.existsSync(u));
 if(file) pack[name]=JSON.parse(fs.readFileSync(file));
}
const map=new MapData(pack), ch=CHALLENGES.find(c=>c.id==='dip-your-lights');
let checks=0;
function test(name,fn){fn();checks++;console.log('✓ '+name);}
function world(on=true){const w=new World(map,{highBeams:on,parked:0,pedestrians:0});w.visibility.setNight(1);w.streetLightsOut=true;w.ego.x=0;w.ego.y=0;w.ego.psi=0;return w;}
// Geometry-only unit fixtures keep buildings out of this policy boundary test.
function open(w){w.visibility.occluded=()=>false;return w;}
test('dip distance boundaries, headings, rear and adjacent traffic',()=>{
 const w=open(world());const n=new Vehicle(0,0,Math.PI,8);
 const front=w.ego.spec.length-w.ego.spec.rearOverhang, otherFront=n.spec.length-n.spec.rearOverhang;
 w.npcs=[n];n.x=150+front+otherFront;assert.equal(headlights(w).high_allowed,false);
 n.x+=.01;assert.equal(headlights(w).high_allowed,true);n.psi=0;n.x=60+front+n.spec.rearOverhang;assert.equal(headlights(w).high_allowed,false);
 n.x+=.01;assert.equal(headlights(w).high_allowed,true);n.x=-20;assert.equal(headlights(w).high_allowed,true);
 n.x=20;n.y=30;assert.equal(headlights(w).high_allowed,true);
});
test('a contraflow cyclist coming the other way is traffic to dip for, in sensing and in the audit',()=>{
 const w=open(world());w.npcs=[];w.ego.highBeam=true;
 const r=new Vehicle(80,0,Math.PI,5);r.kind='bike';r.contra=true;w.contraflow={riders:[r]};
 assert.equal(headlights(w).high_allowed,false);
 // (as sensing asks: brain/sensors.js)
 assert.equal(headlights(w,w.ego,undefined,25).high_allowed,false);
 auditHighBeams(w,1);assert.equal(w.violations.glare_seconds,1);
});
test('weather, daylight, streetlights and building occlusion',()=>{
 const w=open(world());assert.equal(headlights(w).high_allowed,true);
 for(const weather of ['snow','fog']){w.weather=weather;assert.equal(headlights(w).high_allowed,false);}
 w.weather='dry';w.visibility.setNight(0);assert.equal(headlights(w).high_allowed,false);
 w.visibility.setNight(1);w.npcs=[new Vehicle(50,0,Math.PI,5)];w.visibility.occluded=()=>true;assert.equal(headlights(w).high_allowed,true);
 const ctx=setupChallenge(map,ch);ctx.world.streetLightsOut=false;

 const lamp=sceneryFor(map).lamps[0];ctx.world.ego.x=lamp.lx;ctx.world.ego.y=lamp.ly;
 assert.equal(headlights(ctx.world).well_lit,true);assert.equal(headlights(ctx.world).high_allowed,false);
});
test('feature off omits sensing and audit, high beams extend forward pedestrian visibility',()=>{
 const w=open(world(false));w.ego.highBeam=true;auditHighBeams(w,1);assert.equal(w.highBeamsSeen,false);assert.equal(w.violations.glare_seconds,undefined);
 assert.equal('headlights' in buildSnapshot(w),false);
 const p=new Vehicle(65,0,0,0);p.kind='pedestrian';assert.equal(w.sees(w.ego,p),false);
 w.highBeams=true;assert.equal(w.sees(w.ego,p),true);w.ego.highBeam=false;assert.equal(w.sees(w.ego,p),false);
});
test('audit uses elapsed seconds, gates metrics, and NPC flashes never mutate sim',()=>{
 const w=open(world());w.ego.highBeam=true;w.npcs=[new Vehicle(40,0,0,5)];auditHighBeams(w,.5);auditHighBeams(w,.5);
 assert.equal(w.violations.glare_seconds,1);assert.equal(w.highBeamsSeen,true);assert.equal(failures({arrived:true,glare_seconds:1}).includes('failed to dip high beams'),true);
 w.npcs[0].psi=Math.PI;w.t=0;assert.equal(npcHighBeam(w,w.npcs[0]),true);w.t=.5;assert.equal(npcHighBeam(w,w.npcs[0]),false);
 w.weather='fog';w.t=0;assert.equal(npcHighBeam(w,w.npcs[0]),false);
 w.npcs=[];auditHighBeams(w,.5);assert.equal(w.violations.glare_seconds,1.5);
 w.npcs=[new Vehicle(40,0,Math.PI,5)];
 const before=JSON.stringify(w.npcs[0]);npcHighBeam(w,w.npcs[0]);assert.equal(JSON.stringify(w.npcs[0]),before);
});
test('local brains choose beams, models get a question, and trace folding preserves changes',()=>{
 const {world:w}=setupChallenge(map,ch);const s=buildSnapshot(w);assert.equal(s.headlights.high_allowed,true);
 const c={id:'keep',sim:{progress_m:1,end_speed:1,lane_err_end:0,heading_err_deg:0,min_gap_m:10},law:{}};
 assert.equal(new RulesBrain().decideSync(s,[c]).headlights,'high');assert.equal(new CautiousAgent().decideSync(s,[c]).headlights,'high');
 const request=buildQuestions(s,[c]);request.state=toJevState(s,[],{});
 assert.equal(buildLlmPrompt(s,request).expect.headlights.join(','),'high,low');
 assert.equal(llmDecision({headlights:'low'},request,{}).answers.headlights.choice,'low');
 assert.equal(decisionResult({answers:{headlights:{choice:'high'}}},request,[c],{}).answers.headlights.choice,'high');
 assert.equal(!!buildQuestions(s,[c]).questions.headlights,true);assert.equal(toJevState(s,[],{}).headlights.dark,true);
 const t=new EvaluationTrace();for(const [i,headlights] of ['high','high','low'].entries())t.decision({chosenId:'keep',motion:'drive',headlights},i);
 const ds=t.export().decisions_trace;assert.equal(ds.length,2);assert.equal(ds[0].repeats,2);assert.equal(ds[1].headlights,'low');
});
test('missing and invalid model beam answers use Rules; valid answers actuate and are audited',()=>{
 const ctx=setupChallenge(map,ch), s=buildSnapshot(ctx.world);
 const request={state:{},flags:[]};
 const apply=extra=>ctx.autopilot.apply({motion:'drive',candidateId:null,meta:{input_tokens:0,cost_usd:0},...extra},s,[],request);
 apply({});assert.equal(ctx.world.ego.highBeam,true);
 apply({headlights:'invalid'});assert.equal(ctx.world.ego.highBeam,true);
 apply({answers:{headlights:{choice:'low'}}});assert.equal(ctx.world.ego.highBeam,false);
 assert.equal(ctx.autopilot.lastDecision.headlights,'low');
});
test('checkpoint restores beam actuation and gated audit together',()=>{
 const ctx=setupChallenge(map,ch), recorder=new DriveRecorder();
 ctx.world.ego.highBeam=true;ctx.world.highBeamsSeen=true;ctx.world.violations.glare_seconds=.4;
 recorder.record(ctx,true);ctx.world.ego.highBeam=false;ctx.world.violations.glare_seconds=3;
 recorder.restore(0,{...ctx,clock:{},setDrive:()=>{}});
 assert.equal(ctx.world.ego.highBeam,true);assert.equal(ctx.world.highBeamsSeen,true);assert.equal(ctx.world.violations.glare_seconds,.4);
});
for (const brain of ['rules','cautious']) {
 const r=await evaluateChallenge(map,ch,{brain});console.log(brain,r.pass,r.time_s,r.failures, r.glare_seconds);
 assert.equal(r.pass,true);assert.equal(r.glare_seconds<=.8,true);
 const beams=new Set(r.decisions_trace.map(d=>d.headlights));assert.equal(beams.has('high'),true);assert.equal(beams.has('low'),true);
 assert.equal(r.decisions_trace.filter((d,i,a)=>!i||a[i-1].headlights!==d.headlights).length>=4,true);
 checks++;
}
console.log(`${checks} high-beam checks passed`);process.exit(0);
