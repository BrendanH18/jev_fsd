// Kinematic bicycle model with a powertrain/brake actuator and tire grip. State at the rear axle:
// x, y (m), psi (rad, CCW from +x), v (m/s), delta (steering angle, rad), a (actual longitudinal
// acceleration, m/s^2). The same model runs the ego car, the NPCs, and the candidate
// forward-simulations, so predictions match what actually happens.
//
// Actuator: the commanded acceleration is reached through a first-order lag and a jerk limit, so
// a car cannot flip from full throttle to full braking in one tick.
// Grip: braking and cornering share one friction circle of radius mu * g. Asked to turn tighter
// than the tires allow, the car understeers (follows a wider arc), which is what makes a turn
// taken too fast leave the road.

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
  accelLag: 0.25,         // s, first-order actuator time constant
  jerkMax: 15.0,          // m/s^3
};

// Road surface. mu ~0.9 dry asphalt, ~0.55 wet, ~0.2 snow.
export const ROAD = { mu: 0.9 };
const G = 9.81;

export class Vehicle {
  constructor(x = 0, y = 0, psi = 0, v = 0) {
    this.x = x; this.y = y; this.psi = psi; this.v = v; this.delta = 0;
    this.a = 0; this.latAccel = 0;
  }

  clone() {
    const c = new Vehicle(this.x, this.y, this.psi, this.v);
    c.delta = this.delta;
    c.a = this.a;
    return c;
  }

  // steer: desired steering angle (rad); accel: m/s^2. Both are clamped to the car's limits.
  step(dt, { steer = 0, accel = 0, reverse = false } = {}) {
    const target = Math.max(-CAR.maxSteer, Math.min(CAR.maxSteer, steer));
    const maxDelta = CAR.steerRate * dt;
    this.delta += Math.max(-maxDelta, Math.min(maxDelta, target - this.delta));
    let cmd = Math.max(-CAR.maxBrake, Math.min(CAR.maxAccel, accel));
    if (cmd === 0) cmd = -0.02 * this.v;  // rolling drag
    const da = (cmd - this.a) * Math.min(1, dt / CAR.accelLag);
    this.a += Math.max(-CAR.jerkMax * dt, Math.min(CAR.jerkMax * dt, da));
    const grip = ROAD.mu * G;
    const a = Math.max(-grip, Math.min(grip, this.a));
    // curvature the tires can hold after the share of grip used for braking or accelerating
    let curvature = Math.tan(this.delta) / CAR.wheelbase;
    const latMax = Math.sqrt(Math.max(0, grip * grip - a * a));
    const v2 = this.v * this.v;
    if (v2 * Math.abs(curvature) > latMax) curvature = Math.sign(curvature) * latMax / v2;
    this.latAccel = v2 * curvature;
    this.x += this.v * Math.cos(this.psi) * dt;
    this.y += this.v * Math.sin(this.psi) * dt;
    this.psi += this.v * curvature * dt;
    if (this.psi > Math.PI) this.psi -= 2 * Math.PI;
    if (this.psi <= -Math.PI) this.psi += 2 * Math.PI;
    const v0 = this.v;
    this.v += a * dt;
    // braking never reverses the car on its own; reversing is an explicit choice
    if (a < 0 && v0 >= 0 && this.v < 0 && !reverse) this.v = 0;
    if (a > 0 && v0 < 0 && this.v > 0) this.v = 0;
    // held on the brakes at a standstill the car does not accelerate backwards
    if (this.v === 0 && this.a < 0 && !reverse) this.a = 0;
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
