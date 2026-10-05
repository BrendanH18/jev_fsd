// Dynamic bicycle (Fiala tires, load transfer, yaw inertia), blended to kinematic below walking
// speed. Same model for ego, NPCs, bikes, and candidate forward-sims so predictions match execution.
// State: rear-axle x,y (m); heading psi (rad); forward speed v and CG lateral speed vy (m/s);
// yaw rate r (rad/s); steer delta (rad); actuator acceleration command a (m/s²).
// Actuator lag + jerk limit; powertrain power/drag cap; per-axle friction circle after long force.
// Weight transfer: hard braking in a bend unloads the rear (oversteer); turn-in washout is understeer.

export const CAR = {
  kind: "car",
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
  mass: 1500,             // kg
  yawInertia: 2500,       // kg m^2
  cgToFront: 1.2,         // m, center of gravity to the front axle (the rest of the wheelbase is behind it)
  cgHeight: 0.55,         // m
  track: 1.6,             // m, between left and right tires
  frontStiffness: 9.8,    // cornering stiffness per newton of axle load, 1/rad (about 80 kN/rad at rest)
  rearStiffness: 16.8,    // stiffer rear: a stable car understeers mildly (about 110 kN/rad at rest)
  brakeFront: 0.65,       // share of braking force on the front axle
  driveFront: 1.0,        // front-wheel drive
  rollFront: 0.55,        // share of lateral load transfer taken by the front axle
  power: 80000,           // W usable at the wheels, a typical compact sedan
  cdA: 0.68,              // m^2, drag coefficient times frontal area
  crr: 0.012,             // rolling resistance coefficient
};
const AIR = 1.2;          // kg/m^3

// A bicycle with its rider. No mass is given, so it always runs the kinematic model: a bicycle
// leans rather than slides, and nothing in this sim pushes one to its tire limits.
export const BIKE = {
  kind: "bike",
  wheelbase: 1.05,
  length: 1.8,
  width: 0.65,
  rearOverhang: 0.35,
  maxSteer: 40 * Math.PI / 180,
  steerRate: 120 * Math.PI / 180,
  maxAccel: 1.2,
  maxBrake: 4.0,
  maxSpeed: 10.0,
  maxReverse: 0,
  accelLag: 0.3,
  jerkMax: 8.0,
};

// Road grip from weather. mu ~0.9 dry asphalt, ~0.55 wet, ~0.25 packed snow.
export const ROAD = { mu: 0.9 };
export const G = 9.81;
const LOAD_SENSITIVITY = 0.12;   // a tire at twice its static load grips 12% less per newton
const KINEMATIC_BELOW = 3.0;     // m/s: below this the kinematic model is used
const SUBSTEP = 0.01;            // s, the dynamic model's integration step

export class Vehicle {
  constructor(x = 0, y = 0, psi = 0, v = 0, spec = CAR) {
    this.spec = spec;
    this.x = x; this.y = y; this.psi = psi; this.v = v; this.delta = 0;
    this.a = 0; this.vy = 0; this.r = 0;
    this.ax = 0; this.latAccel = 0;
    this.slipping = 0;   // 0..1: how much of the available grip the most loaded axle uses beyond its limit
  }

  clone() {
    const c = new Vehicle(this.x, this.y, this.psi, this.v, this.spec);
    c.delta = this.delta; c.a = this.a; c.vy = this.vy; c.r = this.r; c.ax = this.ax; c.latAccel = this.latAccel;
    return c;
  }

  // steer: desired steering angle (rad); accel: m/s^2. Both are clamped to the vehicle's limits.
  step(dt, { steer = 0, accel = 0, reverse = false } = {}) {
    const P = this.spec;
    const target = Math.max(-P.maxSteer, Math.min(P.maxSteer, steer));
    const maxDelta = P.steerRate * dt;
    this.delta += Math.max(-maxDelta, Math.min(maxDelta, target - this.delta));
    let cmd = Math.max(-P.maxBrake, Math.min(P.maxAccel, accel));
    if (cmd === 0) cmd = -0.02 * this.v;  // rolling drag
    if (P.power && this.v > 0 && cmd > 0) {
      const resist = P.crr * G + 0.5 * AIR * P.cdA * this.v * this.v / P.mass;
      cmd = Math.min(cmd, P.power / (P.mass * Math.max(this.v, 2)) - resist);
    }
    const da = (cmd - this.a) * Math.min(1, dt / P.accelLag);
    this.a += Math.max(-P.jerkMax * dt, Math.min(P.jerkMax * dt, da));

    const v0 = this.v;
    if (Math.abs(this.v) < KINEMATIC_BELOW || !P.mass) this.kinematic(dt);
    else {
      const n = Math.max(1, Math.ceil(dt / SUBSTEP - 1e-9));
      for (let i = 0; i < n; i++) this.dynamic(dt / n);
    }
    // braking never reverses the car on its own; reversing is an explicit choice
    if (this.a < 0 && v0 >= 0 && this.v < 0 && !reverse) this.v = 0;
    if (this.a > 0 && v0 < 0 && this.v > 0) this.v = 0;
    // held on the brakes at a standstill the car does not accelerate backwards
    if (this.v === 0 && this.a < 0 && !reverse) this.a = 0;
    if (this.v === 0) { this.vy = 0; this.r = 0; }
    this.v = Math.max(-P.maxReverse, Math.min(P.maxSpeed, this.v));
    wrapPsi(this);
  }

  // Walking pace: the car goes where its wheels point, limited by the friction circle.
  kinematic(dt) {
    const P = this.spec;
    const grip = ROAD.mu * G;
    const a = Math.max(-grip, Math.min(grip, this.a));
    let curvature = Math.tan(this.delta) / P.wheelbase;
    const latMax = Math.sqrt(Math.max(0, grip * grip - a * a));
    const v2 = this.v * this.v;
    if (v2 * Math.abs(curvature) > latMax) curvature = Math.sign(curvature) * latMax / v2;
    this.latAccel = v2 * curvature;
    this.ax = a;
    this.slipping = 0;
    this.x += this.v * Math.cos(this.psi) * dt;
    this.y += this.v * Math.sin(this.psi) * dt;
    this.psi += this.v * curvature * dt;
    this.r = this.v * curvature;
    this.vy = (P.wheelbase - (P.cgToFront ?? P.wheelbase / 2)) * this.r;
    this.v += a * dt;
  }

  dynamic(h) {
    const P = this.spec;
    const L = P.wheelbase, lf = P.cgToFront, lr = L - lf, m = P.mass;
    const mu = ROAD.mu;
    // axle loads with longitudinal transfer (from the last step's acceleration)
    const Fzf = Math.max(0, m * (G * lr - this.ax * P.cgHeight) / L);
    const Fzr = Math.max(0, m * (G * lf + this.ax * P.cgHeight) / L);
    // lateral transfer: the axle's grip falls because the outside tire is over its static load
    const dFz = m * Math.abs(this.latAccel) * P.cgHeight / P.track;
    const muF = axleMu(mu, Fzf, dFz * P.rollFront, m * G * lr / L);
    const muR = axleMu(mu, Fzr, dFz * (1 - P.rollFront), m * G * lf / L);
    const vx = this.v, vy = this.vy, r = this.r, d = this.delta;
    const alphaF = Math.atan2(vy + lf * r, vx) - d;
    const alphaR = Math.atan2(vy - lr * r, vx);
    // longitudinal forces, capped per axle by anti-lock brakes, traction control, and stability
    // control, which leave each axle the grip its cornering needs so braking in a bend does not
    // spin the car
    const Fx = m * this.a;
    let Fxf, Fxr;
    if (Fx >= 0) { Fxf = Fx * P.driveFront; Fxr = Fx * (1 - P.driveFront); }
    else { Fxf = Fx * P.brakeFront; Fxr = Fx * (1 - P.brakeFront); }
    Fxf = clampAbs(Fxf, longCap(muF * Fzf, P.frontStiffness * Fzf * Math.abs(Math.tan(alphaF))));
    Fxr = clampAbs(Fxr, longCap(muR * Fzr, P.rearStiffness * Fzr * Math.abs(Math.tan(alphaR))));
    const FyMaxF = Math.sqrt(Math.max(0, (muF * Fzf) ** 2 - Fxf * Fxf));
    const FyMaxR = Math.sqrt(Math.max(0, (muR * Fzr) ** 2 - Fxr * Fxr));
    const Fyf = fiala(alphaF, P.frontStiffness * Fzf, FyMaxF);
    const Fyr = fiala(alphaR, P.rearStiffness * Fzr, FyMaxR);
    const cd = Math.cos(d), sd = Math.sin(d);
    const fx = Fxf * cd - Fyf * sd + Fxr;
    const fy = Fxf * sd + Fyf * cd + Fyr;
    const ax = fx / m, ay = fy / m;
    const dvx = ax + vy * r;
    const dvy = ay - vx * r;
    const dr = (lf * (Fxf * sd + Fyf * cd) - lr * Fyr) / P.yawInertia;
    // the rear axle moves with the body's forward speed and the CG's sideways speed minus yaw
    const c = Math.cos(this.psi), s = Math.sin(this.psi);
    const vyRear = vy - lr * r;
    this.x += (vx * c - vyRear * s) * h;
    this.y += (vx * s + vyRear * c) * h;
    this.psi += r * h;
    this.v += dvx * h;
    this.vy += dvy * h;
    this.r += dr * h;
    this.ax = ax;
    this.latAccel = ay;
    const useF = FyMaxF > 1 ? Math.abs(alphaF) / Math.max(1e-6, slideAngle(P.frontStiffness * Fzf, FyMaxF)) : 1;
    const useR = FyMaxR > 1 ? Math.abs(alphaR) / Math.max(1e-6, slideAngle(P.rearStiffness * Fzr, FyMaxR)) : 1;
    this.slipping = Math.max(0, Math.min(1, Math.max(useF, useR) - 1));
  }

  // Sideslip angle of the body at the CG (rad): how far the car is moving sideways to its heading.
  get beta() { return Math.abs(this.v) > 0.5 ? Math.atan2(this.vy, Math.abs(this.v)) : 0; }

  get center() {
    const f = this.spec.length / 2 - this.spec.rearOverhang;
    return [this.x + Math.cos(this.psi) * f, this.y + Math.sin(this.psi) * f];
  }
  get front() {
    const f = this.spec.length - this.spec.rearOverhang;
    return [this.x + Math.cos(this.psi) * f, this.y + Math.sin(this.psi) * f];
  }

  obb() {
    return { center: this.center, heading: this.psi, halfLength: this.spec.length / 2, halfWidth: this.spec.width / 2 };
  }

  corners() {
    const [cx, cy] = this.center;
    const c = Math.cos(this.psi), s = Math.sin(this.psi);
    const hl = this.spec.length / 2, hw = this.spec.width / 2;
    return [[hl, hw], [hl, -hw], [-hl, -hw], [-hl, hw]].map(([lx, ly]) => [cx + lx * c - ly * s, cy + lx * s + ly * c]);
  }

  // A point in the world expressed in the car's frame: ahead (+forward) and right (+right).
  toLocal(px, py) {
    const dx = px - this.x, dy = py - this.y;
    const c = Math.cos(this.psi), s = Math.sin(this.psi);
    return { ahead: dx * c + dy * s, right: dx * s - dy * c };
  }
}

function wrapPsi(v) {
  if (v.psi > Math.PI) v.psi -= 2 * Math.PI;
  if (v.psi <= -Math.PI) v.psi += 2 * Math.PI;
}

const clampAbs = (x, lim) => Math.max(-lim, Math.min(lim, x));

// Longitudinal force an axle may use: what its friction circle has left after the cornering force
// it is being asked for, and never less than a quarter of its grip.
function longCap(grip, lateralDemand) {
  const lat = Math.min(grip, lateralDemand) * 0.9;
  return Math.max(0.25 * grip, Math.sqrt(Math.max(0, (0.98 * grip) ** 2 - lat * lat)));
}

// Friction coefficient of an axle whose two tires carry Fz/2 +- dFz, with load sensitivity: each
// tire's mu drops linearly as its load rises above the static load `Fz0` (for the whole axle).
function axleMu(mu, Fz, dFz, Fz0) {
  if (Fz <= 0) return mu;
  const half = Fz / 2, nominal = Fz0 / 2;
  const t = Math.min(dFz, half);
  const tireMu = (load) => mu * Math.max(0.5, 1 - LOAD_SENSITIVITY * (load / nominal - 1));
  return ((half + t) * tireMu(half + t) + (half - t) * tireMu(half - t)) / Fz;
}

// Fiala brush tire: lateral force (N) for slip angle alpha, cornering stiffness C (N/rad), and the
// grip available for cornering Fmax (N). Opposes the slip.
function fiala(alpha, C, Fmax) {
  if (Fmax <= 0 || C <= 0) return 0;
  const t = Math.tan(alpha);
  const tSl = 3 * Fmax / C;
  if (Math.abs(t) >= tSl) return -Fmax * Math.sign(alpha);
  const a = Math.abs(t);
  return -Math.sign(alpha) * (C * a - (C * C * a * a) / (3 * Fmax) + (C * C * C * a * a * a) / (27 * Fmax * Fmax));
}

// Slip angle at which the Fiala tire is fully sliding.
function slideAngle(C, Fmax) { return C > 0 ? Math.atan(3 * Fmax / C) : 0; }

// Comfortable limits a sensible driver keeps to on this surface: cornering and braking scale down
// with grip, so a wet or snowy road means slower bends and earlier braking.
export function comfort() {
  const k = Math.min(1, ROAD.mu / 0.9);
  return { lat: 2.2 * Math.max(0.35, k), decel: 2.5 * Math.max(0.35, k), hardDecel: Math.min(7, ROAD.mu * G * 0.8) };
}
