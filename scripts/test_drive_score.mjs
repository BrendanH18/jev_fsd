import assert from 'node:assert/strict';
import { DriveScore, readHistory, saveDrive } from '../static/js/sim/drive-score.js';

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log(`✓ ${name}`); };
const road = { on_road: true, limit: 13.9, heading_error: 0 };
function world(speed = 10) {
  return { paused: false, ego: { x: 0, y: 0, psi: 0, v: speed, latAccel: 0, toLocal(x, y) { return { ahead: x - this.x, right: -y }; } },
    violations: { collisions: 0, collisions_at_fault: 0, red_lights_run: 0, stop_signs_run: 0, failed_to_yield: 0 }, obstaclesNear: () => [] };
}
function drive(w, s, seconds = 20, dt = 1 / 60, r = road) {
  for (let t = 0; t < seconds - 1e-8; t += dt) { w.ego.x += w.ego.v * dt; s.record(w, r, dt); }
  return s.snapshot();
}
test('clean 200 m drive earns A and full category scores', () => {
  const w = world(), s = new DriveScore(w); const r = drive(w, s);
  assert.equal(r.score, 100); assert.equal(r.grade, 'A'); assert.equal(r.distance_m, 200);
});
test('short drive never earns an inflated grade', () => {
  const w = world(), r = drive(w, new DriveScore(w), 5); assert.equal(r.grade, '—'); assert.equal(r.qualified, false);
});
test('waiting at a traffic light does not damage the score or qualify a drive', () => {
  const w = world(0), r = drive(w, new DriveScore(w), 120); assert.equal(r.score, 100); assert.equal(r.qualified, false);
});
test('collisions cannot be averaged into an excellent drive, fault remains separate', () => {
  const w = world(), s = new DriveScore(w); w.violations.collisions = 1; const r = drive(w, s);
  assert.equal(r.score, 59); assert.equal(r.at_fault, 0); assert.equal(r.incidents.filter(i => i.type === 'collisions').length, 1);
});
test('at-fault collisions incur an additional safety deduction', () => {
  const w = world(), s = new DriveScore(w); w.violations.collisions = 1; w.violations.collisions_at_fault = 1;
  assert.equal(drive(w, s).categories.safety, 50);
});
test('red lights and failed yields cap the overall score', () => {
  for (const key of ['red_lights_run', 'failed_to_yield']) {
    const w = world(), s = new DriveScore(w); w.violations[key] = 1; assert.equal(drive(w, s).score, 69);
  }
});
test('a new drive does not inherit previous violations', () => {
  const w = world(); w.violations.collisions = 2; const r = drive(w, new DriveScore(w));
  assert.equal(r.collisions, 0); assert.equal(r.score, 100);
});
test('speeding deductions grow with duration and retain a 5 km/h grace', () => {
  const w = world(road.limit + 1), s = new DriveScore(w); assert.equal(drive(w, s).speeding_s, 0);
  w.ego.v = 18; const r = drive(w, s, 10); assert.equal(r.speeding_s, 10); assert.equal(r.categories.legality, 88);
});
test('scoring is independent of frame rate and pause duration', () => {
  const w1 = world(18), s1 = new DriveScore(w1), w2 = world(18), s2 = new DriveScore(w2);
  const a = drive(w1, s1, 20, 1 / 60), b = drive(w2, s2, 20, 1 / 30);
  assert.equal(a.score, b.score); assert.deepEqual(a.categories, b.categories);
  w1.paused = true; drive(w1, s1, 10); assert.equal(s1.snapshot().elapsed_s, a.elapsed_s);
});
test('sustained hard braking counts once; moving steadily does not count', () => {
  const w = world(15), s = new DriveScore(w);
  for (let t = 0; t < 2; t += 1 / 60) { w.ego.v -= 5 / 60; s.record(w, road, 1 / 60); }
  assert.equal(s.snapshot().hard_brakes, 1); assert(s.snapshot().categories.comfort < 100);
});
test('close following is measured for manual driving too', () => {
  const w = world(), s = new DriveScore(w); w.obstaclesNear = () => [{ center: [w.ego.x + 10, 0], length: 4.5, width: 1.8, v: 5, psi: 0 }];
  const r = drive(w, s); assert(r.close_following_s > 19); assert(r.danger_s > 19); assert(r.categories.safety < 60);
});
test('adjacent-lane cars do not become following-gap violations', () => {
  const w = world(), s = new DriveScore(w); w.obstaclesNear = () => [{ center: [w.ego.x + 10, 3.5], length: 4.5, width: 1.8, v: 5, psi: 0 }];
  assert.equal(drive(w, s).categories.safety, 100);
});
test('off-road time, wrong-way travel and resets reduce control', () => {
  const w = world(), s = new DriveScore(w); s.reset(); drive(w, s, 2, 1 / 60, { ...road, on_road: false });
  const r = drive(w, s, 2, 1 / 60, { ...road, heading_error: Math.PI });
  assert.equal(r.categories.control, 69); assert.equal(r.resets, 1);
});
test('finished reports are immutable and finish is idempotent', () => {
  const w = world(), s = new DriveScore(w); drive(w, s); const r = s.finish('arrived');
  drive(w, s); assert.deepEqual(s.finish('finished'), r); r.incidents.push({}); assert.equal(s.snapshot().incidents.length, 0);
});
test('route progress is bounded and stored independently of world route removal', () => {
  const w = world(), route = { length: 100, project(x) { return { s: x, distance: 0 }; } }, s = new DriveScore(w, { route });
  assert.equal(drive(w, s).progress, 1); assert.equal(s.finish('arrived').status, 'arrived');
});
test('history survives reload, stays bounded, handles corruption and blocked storage', () => {
  const memory = new Map(), storage = { getItem: k => memory.get(k) || null, setItem: (k, v) => memory.set(k, v) };
  const w = world(), r = drive(w, new DriveScore(w));
  for (let i = 0; i < 25; i++) saveDrive({ ...r, title: `Drive ${i}` }, storage);
  assert.equal(readHistory(storage).length, 20); assert.equal(readHistory(storage)[0].title, 'Drive 24');
  assert.deepEqual(readHistory({ getItem() { return '{'; } }), []);
  assert.equal(saveDrive(r, { getItem() { throw Error(); }, setItem() { throw Error(); } }), false);
});
test('invalid step times cannot corrupt a score', () => {
  const w = world(), s = new DriveScore(w); for (const dt of [0, -1, NaN, Infinity]) s.record(w, road, dt);
  assert.equal(s.snapshot().elapsed_s, 0); assert.equal(s.snapshot().score, 100);
});
console.log(`${passed} drive scoring tests passed`);
