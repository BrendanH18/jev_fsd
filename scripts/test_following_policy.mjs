// Node 22: pure following policy and a real-physics sudden-braking check.
import assert from "node:assert/strict";
import { CAR, Vehicle } from "../static/js/sim/vehicle.js";
import { setWeather } from "../static/js/sim/weather.js";
import { followingPolicy, FOLLOWING_STANDSTILL_M } from "../static/js/sim/following.js";

let checks = 0;
function test(name, fn) { fn(); checks++; console.log(`✓ ${name}`); }
const ego = (v, spec = CAR, a = 0) => ({ v, spec, a });
const policy = (v, speed, gap = 30, spec = CAR) => followingPolicy(ego(v, spec), { speed, gap_m: gap });

test("rain and snow ask for longer following gaps and lower speeds at the same spacing", () => {
  const samples = ["dry", "rain", "snow"].map(weather => {
    setWeather(weather); return policy(10, 10);
  });
  for (let i = 1; i < samples.length; i++) {
    assert.equal(samples[i].target_gap_m > samples[i - 1].target_gap_m, true);
    assert.equal(samples[i].headway_s > samples[i - 1].headway_s, true);
    assert.equal(samples[i].safe_speed_mps < samples[i - 1].safe_speed_mps, true);
  }
});
test("target spacing holds a matched leader speed under every supported weather", () => {
  for (const weather of ["dry", "rain", "fog", "snow"]) for (const speed of [1, 5, 10, 20]) {
    setWeather(weather);
    const target = policy(speed, speed).target_gap_m;
    assert.equal(Math.abs(policy(speed, speed, target).safe_speed_mps - speed) < 1e-9, true);
    assert.equal(policy(speed, speed, target - 1).safe_speed_mps < speed, true);
    assert.equal(policy(speed, speed, target + 1).safe_speed_mps > speed, true);
  }
});
test("speed, closing speed, lag and the jerk ramp increase the needed room", () => {
  setWeather("dry");
  assert.equal(policy(20, 20).target_gap_m > policy(10, 10).target_gap_m, true);
  assert.equal(policy(10, 0).target_gap_m > policy(10, 10).target_gap_m, true);
  const standard = policy(15, 10, 50);
  const slow = policy(15, 10, 50, { ...CAR, accelLag: 0.8, jerkMax: 5 });
  assert.equal(slow.reaction_s > standard.reaction_s, true);
  assert.equal(slow.target_gap_m > standard.target_gap_m, true);
  assert.equal(slow.safe_speed_mps < standard.safe_speed_mps, true);
  const accelerating = followingPolicy(ego(15, CAR, 2), { speed: 10, gap_m: 30 });
  assert.equal(accelerating.reaction_s > standard.reaction_s, true);
  assert.equal(accelerating.target_gap_m > standard.target_gap_m, true);
});
test("the leader's stronger brakes leave less stopping credit", () => {
  setWeather("dry");
  const standard = policy(15, 10, 45);
  const weakLeader = followingPolicy(ego(15), { speed: 10, gap_m: 45, vehicle: { spec: { ...CAR, maxBrake: 3 } } });
  assert.equal(standard.target_gap_m > weakLeader.target_gap_m, true);
  assert.equal(standard.safe_speed_mps < weakLeader.safe_speed_mps, true);
});
test("a cut-in asks for a gap recovery without acceleration or a gap/headway speed jump", () => {
  setWeather("dry");
  // At a low speed the nominal two-second gap governs; a small deficit should
  // call for a gentle correction even though the instantaneous headway is short.
  const target = policy(5, 5).target_gap_m, gap = target - 2;
  const p = policy(5, 5, gap);
  assert.equal(p.safe_speed_mps < 5 && p.safe_speed_mps > 4, true);
  assert.equal(p.safe_speed_mps > (gap - FOLLOWING_STANDSTILL_M) / p.headway_s, true);
  assert.equal(policy(5, 10, gap).safe_speed_mps <= 5, true);
});
test("standstill spacing remains finite and a queue can set off", () => {
  for (const weather of ["dry", "rain", "snow"]) {
    setWeather(weather);
    assert.equal(policy(0, 0, 3).target_gap_m, FOLLOWING_STANDSTILL_M);
    assert.equal(policy(0, 0, 3).safe_speed_mps, 0);
    assert.equal(policy(0, 1, 3).safe_speed_mps, 0);
    assert.equal(policy(0, 1, 4).safe_speed_mps > 0, true);
    assert.equal(policy(0, 0, 5).safe_speed_mps > 0, true);
    assert.equal(policy(10, 20, 1).safe_speed_mps, 0);
    assert.equal(policy(-1, -1, -1).safe_speed_mps, 0);
  }
});
test("more physical room never lowers the speed ceiling", () => {
  for (const weather of ["dry", "rain", "snow"]) for (const speed of [0, 5, 15, 30]) {
    setWeather(weather); let previous = -1;
    for (const gap of [0, 2, 3, 4, 10, 20, 40, 80, 160]) {
      const p = policy(speed, speed / 2, gap);
      assert.equal(Object.values(p).every(Number.isFinite), true);
      assert.equal(p.safe_speed_mps >= previous, true);
      previous = p.safe_speed_mps;
    }
  }
});
test("the stopping ceiling obeys its reaction and braking envelope", () => {
  for (const weather of ["dry", "rain", "snow"]) {
    setWeather(weather);
    const p = policy(15, 0, 30), v = p.safe_speed_mps;
    assert.equal(v * p.reaction_s + v * v / (2 * p.braking_mps2) <= 27 + 1e-9, true);
  }
});
test("a real car stops behind a suddenly braking leader from its target gap", () => {
  for (const weather of ["dry", "rain", "snow"]) {
    setWeather(weather);
    const follower = new Vehicle(0, 0, 0, 10), lead = new Vehicle(0, 0, 0, 10);
    const target = followingPolicy(follower, { speed: lead.v, gap_m: 0 }).target_gap_m;
    lead.x = target + CAR.length;
    let minGap = Infinity;
    for (let k = 0; k < 60 * 60; k++) {
      const gap = lead.x - follower.x - CAR.length;
      minGap = Math.min(minGap, gap);
      // The lead starts maximum braking immediately. The follower reacts only
      // after a decision interval; its own lag/jerk remain in Vehicle.step.
      const p = followingPolicy(follower, { speed: lead.v, gap_m: gap, vehicle: lead });
      const accel = k < 24 ? 0 : Math.max(-CAR.maxBrake, Math.min(CAR.maxAccel, 1.5 * (p.safe_speed_mps - follower.v)));
      follower.step(1 / 60, { accel });
      lead.step(1 / 60, { accel: -CAR.maxBrake });
    }
    assert.equal(minGap > 2, true, `${weather}: minimum bumper gap ${minGap}`);
    assert.equal(follower.v < 0.05, true, `${weather}: follower did not stop`);
  }
});
setWeather("dry");
console.log(`${checks} following policy checks passed`);
