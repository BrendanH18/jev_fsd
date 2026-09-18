// Kinematic bicycle model. State at the rear axle: x, y (m), psi (rad, CCW from +x), v (m/s),
// delta (steering angle, rad). The same model runs the ego car, the NPCs, and the candidate
// forward-simulations, so predictions match what actually happens.

export const CAR = {
  wheelbase: 2.7,
  length: 4.5,
  width: 1.9,
  rearOverhang: 0.9,      // rear axle to rear bumper
  maxSteer: 35 * Math.PI / 180,
  steerRate: 90 * Math.PI / 180,
  maxAccel: 3.0,
  maxBrake: 8.0,
  maxSpeed: 40.0,
  maxReverse: 3.0,
};

export class Vehicle {
  constructor(x = 0, y = 0, psi = 0, v = 0) {
    this.x = x; this.y = y; this.psi = psi; this.v = v; this.delta = 0;
  }

  clone() {
    const c = new Vehicle(this.x, this.y, this.psi, this.v);
    c.delta = this.delta;
    return c;
  }

  // steer: desired steering angle (rad); accel: m/s^2. Both are clamped to the car's limits.
  step(dt, { steer = 0, accel = 0 } = {}) {
    const target = Math.max(-CAR.maxSteer, Math.min(CAR.maxSteer, steer));
    const maxDelta = CAR.steerRate * dt;
    this.delta += Math.max(-maxDelta, Math.min(maxDelta, target - this.delta));
    let a = Math.max(-CAR.maxBrake, Math.min(CAR.maxAccel, accel));
    if (a === 0) a = -0.02 * this.v;  // rolling drag
    this.x += this.v * Math.cos(this.psi) * dt;
    this.y += this.v * Math.sin(this.psi) * dt;
    this.psi += (this.v / CAR.wheelbase) * Math.tan(this.delta) * dt;
    if (this.psi > Math.PI) this.psi -= 2 * Math.PI;
    if (this.psi <= -Math.PI) this.psi += 2 * Math.PI;
    const v0 = this.v;
    this.v += a * dt;
    // braking never reverses the car on its own; reverse needs an explicit negative target speed
    if (accel < 0 && v0 > 0 && this.v < 0) this.v = 0;
    if (accel > 0 && v0 < 0 && this.v > 0) this.v = 0;
    this.v = Math.max(-CAR.maxReverse, Math.min(CAR.maxSpeed, this.v));
  }

  get center() {
    const f = CAR.length / 2 - CAR.rearOverhang;
    return [this.x + Math.cos(this.psi) * f, this.y + Math.sin(this.psi) * f];
  }
  get front() {
    const f = CAR.length - CAR.rearOverhang;
    return [this.x + Math.cos(this.psi) * f, this.y + Math.sin(this.psi) * f];
  }

  obb() {
    return { center: this.center, heading: this.psi, halfLength: CAR.length / 2, halfWidth: CAR.width / 2 };
  }

  corners() {
    const [cx, cy] = this.center;
    const c = Math.cos(this.psi), s = Math.sin(this.psi);
    const hl = CAR.length / 2, hw = CAR.width / 2;
    return [[hl, hw], [hl, -hw], [-hl, -hw], [-hl, hw]].map(([lx, ly]) => [cx + lx * c - ly * s, cy + lx * s + ly * c]);
  }

  // A point in the world expressed in the car's frame: ahead (+forward) and right (+right).
  toLocal(px, py) {
    const dx = px - this.x, dy = py - this.y;
    const c = Math.cos(this.psi), s = Math.sin(this.psi);
    return { ahead: dx * c + dy * s, right: dx * s - dy * c };
  }
}
