// node --experimental-default-type=module scripts/test_cinematic_photo.mjs
import assert from 'node:assert/strict';
globalThis.document = { querySelector: () => null };
const { CinematicCamera, CINEMATIC_SHOTS } = await import('../static/js/render/cinematic-camera.js');
const { photoFilename, clampLook, LOOK_RANGES } = await import('../static/js/ui/photo-mode.js');
const { VEHICLE_MODELS } = await import('../static/js/sim/vehicle-models.js');

const finite = pose => [...pose.position, ...pose.look, pose.fov, pose.lag].every(Number.isFinite);

// The director visits every shot in order, cuts exactly once per shot, and loops.
{
  const rig = new CinematicCamera();
  const ego = { x: 0, y: 0, psi: 0.4, v: 12, spec: VEHICLE_MODELS[1].spec };
  const state = JSON.stringify(ego);
  const seen = [];
  for (let i = 0; i < 60 * 90; i++) {
    const pose = rig.pose(ego, 1 / 60, 1.45);
    assert(finite(pose), `finite ${pose.shot}`);
    if (pose.cut) seen.push(pose.shot);
    ego.x += Math.cos(ego.psi) * ego.v / 60; ego.y += Math.sin(ego.psi) * ego.v / 60;
  }
  assert.deepEqual(seen.slice(0, CINEMATIC_SHOTS.length), CINEMATIC_SHOTS);
  assert.equal(seen[CINEMATIC_SHOTS.length], CINEMATIC_SHOTS[0], 'sequence loops');
  assert.equal(JSON.stringify({ ...ego, x: 0, y: 0 }), JSON.stringify({ ...JSON.parse(state), x: 0, y: 0 }), 'camera never modifies vehicle state');
}

// A trackside camera stays planted beside the road and cuts once the car has passed it.
{
  const rig = new CinematicCamera();
  const ego = { x: 100, y: 50, psi: 0, v: 15, spec: VEHICLE_MODELS[2].spec };
  const first = rig.pose(ego, 0);
  assert.equal(first.shot, 'trackside'); assert(first.cut);
  assert(first.position[0] > ego.x + 17, 'camera waits ahead of the car');
  assert(Math.abs(first.position[1] - ego.y) > 5, 'camera stands at the kerb, not in the lane');
  let pose, t = 0;
  do { ego.x += ego.v / 60; t += 1 / 60; pose = rig.pose(ego, 1 / 60); }
  while (!pose.cut && t < 20);
  assert(pose.cut && t < 9.1, 'a passing car ends the trackside shot');
  assert(ego.x - first.position[0] >= 21, 'the shot holds until the car is well past');
}

// A stopped car never reaches the trackside camera; the shot still ends at its maximum length.
{
  const rig = new CinematicCamera();
  const ego = { x: 0, y: 0, psi: 1, v: 0 };
  rig.pose(ego, 0);
  let t = 0, pose;
  do { pose = rig.pose(ego, 0.1); t += 0.1; } while (!pose.cut && t < 30);
  assert(Math.abs(t - 9.1) < 0.15, `stopped car cut after ${t}`);
  assert.equal(pose.shot, 'bumper');
}

// Consecutive trackside shots stand on opposite kerbs; reset restarts the sequence.
{
  const rig = new CinematicCamera();
  const ego = { x: 0, y: 0, psi: 0, v: 0 };
  rig.pose(ego, 0);
  const firstSide = Math.sign(rig.anchor[1]);
  for (let i = 0; i < 3; i++) rig.cut(ego);
  assert.equal(rig.shot.name, 'trackside');
  assert.equal(Math.sign(rig.anchor[1]), -firstSide);
  rig.reset(); assert.equal(rig.pose(ego, 0).shot, 'trackside');
}

// Aerial shots look down on the car and keep circling it.
{
  const rig = new CinematicCamera();
  const ego = { x: 10, y: 10, psi: 0, v: 0 };
  rig.index = 1; rig.cut(ego);
  const a = rig.pose(ego, 0), b = rig.pose(ego, 2);
  assert.equal(a.shot, 'aerial');
  assert(a.position[2] > 15);
  const r = p => Math.hypot(p.position[0] - p.look[0], p.position[1] - p.look[1]);
  assert(Math.abs(r(a) - r(b)) < 1e-9 && Math.abs(r(a) - 30) < 1e-9);
  assert.notDeepEqual(a.position, b.position);
}

// Photo filenames are readable, sortable and safe on every filesystem.
assert.equal(photoFilename('Saint-Roch, Québec City', new Date(2026, 9, 7, 19, 3, 9)), 'jev-saint-roch-quebec-city-2026-10-07-190309.png');
assert.equal(photoFilename('', new Date(2026, 0, 2, 3, 4, 5)), 'jev-drive-2026-01-02-030405.png');
assert.equal(photoFilename('../../etc/passwd', new Date(2026, 0, 1)), 'jev-etc-passwd-2026-01-01-000000.png');
assert.match(photoFilename('x'.repeat(200)), /^jev-x{48}-\d{4}-\d{2}-\d{2}-\d{6}\.png$/);

// Look adjustments are clamped to their ranges and reject junk.
for (const [key, range] of Object.entries(LOOK_RANGES)) {
  assert.equal(clampLook(key, 99), range.max);
  assert.equal(clampLook(key, -99), range.min);
  assert.equal(clampLook(key, 'nope'), 0);
}
assert.equal(clampLook('unknown', 1), 0);

console.log('Cinematic camera and photo mode checks passed: shot order, trackside cuts, stopped cars, kerb sides, aerial orbit, filenames and look ranges.');
