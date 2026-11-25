// Dynamic bicycle (Fiala tires, load transfer, yaw inertia) at 3 m/s and above. The model switches
// to kinematic below that threshold and for bicycles. Ego, NPCs and predictions use the same step.
// State: rear-axle x,y (m); heading psi (rad); forward speed v and CG lateral speed vy (m/s);
// yaw rate r (rad/s); steer delta (rad); actuator acceleration command a (m/s²).
// Actuator lag + jerk limit; powertrain power/drag cap; per-axle friction circle after long force.
// Weight transfer: hard braking in a bend unloads the rear (oversteer); turn-in washout is understeer.

export const CAR = {
  kind: "car",
  wheelbase: 2.7,
  length: 4.5,
  width: 1.9,
  rearOverhang: 0.9, // rear axle to rear bumper
  maxSteer: (35 * Math.PI) / 180,
  steerRate: (90 * Math.PI) / 180,
  maxAccel: 3.0,
  maxBrake: 8.0,
  maxSpeed: 40.0,
  maxReverse: 3.0,
  accelLag: 0.25, // s, first-order actuator time constant
  jerkMax: 15.0, // m/s^3
  mass: 1500, // kg
  yawInertia: 2500, // kg m^2
  cgToFront: 1.2, // m, center of gravity to the front axle (the rest of the wheelbase is behind it)
  cgHeight: 0.55, // m
  track: 1.6, // m, between left and right tires
  frontStiffness: 9.8, // cornering stiffness per newton of axle load, 1/rad (about 80 kN/rad at rest)
  rearStiffness: 16.8, // stiffer rear: a stable car understeers mildly (about 110 kN/rad at rest)
  brakeFront: 0.65, // share of braking force on the front axle
  driveFront: 1.0, // front-wheel drive
  rollFront: 0.55, // share of lateral load transfer taken by the front axle
  power: 80000, // W usable at the wheels, a typical compact sedan
  cdA: 0.68, // m^2, drag coefficient times frontal area
  crr: 0.012, // rolling resistance coefficient
};
const AIR = 1.2; // kg/m^3

// A bicycle with its rider. No mass is given, so it always runs the kinematic model: a bicycle
// leans rather than slides, and nothing in this sim pushes one to its tire limits.
export const BIKE = {
  kind: "bike",
  wheelbase: 1.05,
  length: 1.8,
  width: 0.65,
  rearOverhang: 0.35,
  maxSteer: (40 * Math.PI) / 180,
  steerRate: (120 * Math.PI) / 180,
  maxAccel: 1.2,
  maxBrake: 4.0,
  maxSpeed: 10.0,
  maxReverse: 0,
  accelLag: 0.3,
  jerkMax: 8.0,
};

// Emergency vehicles answering a call (sim/emergency.js): a box ambulance on a van chassis and a
// pumper fire truck, with their size, weight and power. Body width excludes mirrors.
export const AMBULANCE = {
  ...CAR,
  kind: "ambulance",
  wheelbase: 3.9,
  length: 6.7,
  width: 2.15,
  rearOverhang: 1.6,
  maxSteer: (38 * Math.PI) / 180,
  maxAccel: 2.6,
  maxSpeed: 30,
  mass: 4500,
  yawInertia: 9500,
  cgToFront: 1.7,
  cgHeight: 1.0,
  track: 1.75,
  power: 160000,
  cdA: 3.2,
  crr: 0.011,
};
export const FIRE_TRUCK = {
  ...CAR,
  kind: "fire_truck",
  wheelbase: 5.0,
  length: 9.8,
  width: 2.45,
  rearOverhang: 2.7,
  maxSteer: (42 * Math.PI) / 180,
  maxAccel: 1.8,
  maxSpeed: 27,
  mass: 18000,
  yawInertia: 125000,
  cgToFront: 2.4,
  cgHeight: 1.3,
  track: 2.05,
  power: 330000,
  cdA: 6.8,
  crr: 0.009,
  brakeFront: 0.6,
  driveFront: 0,
  accelLag: 0.4,
};

// A 12 m (40 ft) low-floor city bus, as TransLink and most Canadian cities run (sim/bus.js): its
// size, weight with a typical load, and power. Rear-engined, driving its rear axle.
export const BUS = {
  ...CAR,
  kind: "bus",
  wheelbase: 6.2,
  length: 12.2,
  width: 2.55,
  rearOverhang: 3.3,
  maxSteer: (45 * Math.PI) / 180,
  maxAccel: 1.3,
  maxSpeed: 25,
  mass: 15000,
  yawInertia: 160000,
  cgToFront: 3.6,
  cgHeight: 1.1,
  track: 2.1,
  power: 210000,
  cdA: 6.4,
  crr: 0.009,
  brakeFront: 0.6,
  driveFront: 0,
  accelLag: 0.45,
};

// A Type C ("conventional", engine under a short hood) school bus of about 70 seats, as most
// Canadian school districts run (sim/school-bus.js): its size, weight with children aboard, and
// power. Front-engined, driving its rear axle.
export const SCHOOL_BUS = {
  ...CAR,
  kind: "school_bus",
  wheelbase: 6.1,
  length: 11.4,
  width: 2.44,
  rearOverhang: 3.1,
  maxSteer: (42 * Math.PI) / 180,
  maxAccel: 1.2,
  maxSpeed: 25,
  mass: 12500,
  yawInertia: 120000,
  cgToFront: 3.2,
  cgHeight: 1.1,
  track: 2.0,
  power: 190000,
  cdA: 6.6,
  crr: 0.009,
  brakeFront: 0.6,
  driveFront: 0,
  accelLag: 0.45,
};

// A Flexity Outlook, the TTC's low-floor streetcar (sim/streetcar.js): 30.2 m long in five sections,
// 2.54 m wide, about 56 t with a typical load, eight 85 kW motors. Its bogies run on rails: modelled as
// one rigid body, it only ever follows its track, along the lane it is laid in.
export const STREETCAR = {
  ...CAR,
  kind: "streetcar",
  wheelbase: 20.2,
  length: 30.2,
  width: 2.54,
  rearOverhang: 5.0,
  maxSteer: (12 * Math.PI) / 180,
  maxAccel: 1.3,
  maxSpeed: 19.4,
  mass: 56000,
  yawInertia: 4.3e6,
  cgToFront: 10.1,
  cgHeight: 1.0,
  track: 1.49,
  power: 680000,
  cdA: 8.5,
  crr: 0.002,
  brakeFront: 0.5,
  driveFront: 0.5,
  accelLag: 0.5,
};

// A heritage streetcar on the High Level Bridge line (sim/rail.js), as the Edmonton Radial Railway
// Society runs: a double-truck wooden car of the 1910s, about 13.7 m long and 2.6 m wide, some 18 t,
// its trucks 7.3 m apart. It runs on its own track, off the street, and only along it.
export const HERITAGE_STREETCAR = {
  ...CAR,
  kind: "train",
  wheelbase: 7.3,
  length: 13.7,
  width: 2.6,
  rearOverhang: 3.2,
  maxSteer: 0,
  maxAccel: 0.8,
  maxSpeed: 11,
  mass: 18000,
  yawInertia: 3.0e5,
  cgToFront: 3.65,
  cgHeight: 1.1,
  track: 1.44,
  power: 120000,
  cdA: 7.5,
  crr: 0.002,
  brakeFront: 0.5,
  driveFront: 0.5,
  accelLag: 0.5,
};

// Vehicles stopped at the roadside with their lights flashing (sim/roadside.js), which never move: a
// light-duty wheel-lift tow truck on a one-ton cab-and-chassis, and a police SUV, at the size of the
// sim's other cars.
export const TOW_TRUCK = {
  ...CAR,
  kind: "tow_truck",
  wheelbase: 3.6,
  length: 6.6,
  width: 2.2,
  rearOverhang: 2.1,
  mass: 6500,
  cgHeight: 0.9,
  track: 1.75,
};
export const POLICE_CAR = { ...CAR, kind: "police" };
// A high-roof delivery van (a long-wheelbase cargo van), double-parked while its driver runs a parcel
// to a door (sim/double-parked.js), and driving off as traffic once they are back.
export const DELIVERY_VAN = {
  ...CAR,
  kind: "delivery_van",
  wheelbase: 3.66,
  length: 5.95,
  width: 2.05,
  rearOverhang: 1.25,
  mass: 3200,
  cgHeight: 0.85,
  track: 1.72,
  maxSpeed: 30,
  power: 105000,
  cdA: 1.3,
  yawInertia: 7500,
  cgToFront: 1.65, // (an empty cargo van, a little over half its weight on the front axle)
};

// A city snow plow (sim/snow-plow.js): a single-axle dump truck with a salt spreader on its box, a
// one-way front blade angled across its nose (2.9 m long, at 30 degrees it spans its 2.6 m width) and a
// wing blade folded up along its right side, loaded with salt and sand. Its length takes in the blade.
export const SNOW_PLOW = {
  ...CAR,
  kind: "snow_plow",
  wheelbase: 5.2,
  length: 9.8,
  width: 2.6,
  rearOverhang: 1.9,
  maxSteer: (40 * Math.PI) / 180,
  maxAccel: 1.2,
  maxSpeed: 25,
  mass: 16000,
  yawInertia: 110000,
  cgToFront: 2.3,
  cgHeight: 1.3,
  track: 2.0,
  power: 250000,
  cdA: 7.5,
  crr: 0.01,
  brakeFront: 0.6,
  driveFront: 0,
  accelLag: 0.45,
};

// A rear-loading garbage truck on a single-axle chassis (sim/collection-truck.js): its packer body
// overhangs the rear axle by the length of its hopper, where the crew works.
export const COLLECTION_TRUCK = {
  ...CAR,
  kind: "collection_truck",
  wheelbase: 5.0,
  length: 9.6,
  width: 2.5,
  rearOverhang: 2.9,
  maxSteer: (40 * Math.PI) / 180,
  maxAccel: 1.2,
  maxSpeed: 25,
  mass: 15000,
  yawInertia: 100000,
  cgToFront: 2.4,
  cgHeight: 1.3,
  track: 2.0,
  power: 200000,
  cdA: 7.0,
  crr: 0.01,
  brakeFront: 0.6,
  driveFront: 0,
  accelLag: 0.45,
};

// Road grip from weather. mu ~0.9 dry asphalt, ~0.55 wet, ~0.25 packed snow.
// `gripAt`: where grip varies from place to place (black ice, sim/black-ice.js), a function (x, y, spec)
// giving the friction coefficient under a tyre at (x, y), or null where it is `mu`. It is null in every
// world without such a surface, and then nothing about it is computed.
export const DRY_ROAD_MU = 0.9;
export const ROAD = { mu: DRY_ROAD_MU, gripAt: null };
export const G = 9.81;
export const MAX_PHYSICS_STEP_S = 1; // a step integrates one tick, never time spent paused
const LOAD_SENSITIVITY = 0.12; // a tire at twice its static load grips 12% less per newton
const KINEMATIC_BELOW = 3.0; // m/s: below this the kinematic model is used
const SUBSTEP = 0.01; // s, the dynamic model's integration step
const FULL_TURN = 2 * Math.PI;
const validatedSpecs = new WeakSet();

// Only the built-in records are shared as read-only inputs. A caller may still supply an editable
// spec, which is checked again after any edit because its identity is unchanged.
for (const spec of [
  CAR,
  BIKE,
  AMBULANCE,
  FIRE_TRUCK,
  BUS,
  SCHOOL_BUS,
  STREETCAR,
  HERITAGE_STREETCAR,
  TOW_TRUCK,
  POLICE_CAR,
  DELIVERY_VAN,
  SNOW_PLOW,
  COLLECTION_TRUCK,
]) {
  Object.freeze(spec);
}

function specRange(field, value, min, max = Infinity, { openMin = false, openMax = false } = {}) {
  if (!Number.isFinite(value) || (openMin ? value <= min : value < min) || (openMax ? value >= max : value > max))
    throw new RangeError(`Invalid vehicle spec field ${field}`);
}

function validateMotionSpec(spec) {
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) throw new TypeError("Vehicle spec must be an object");
  if (validatedSpecs.has(spec)) return;
  const positive = { openMin: true };
  specRange("wheelbase", spec.wheelbase, 0, Infinity, positive);
  specRange("maxSteer", spec.maxSteer, 0, Math.PI / 2, { openMax: true });
  for (const key of ["steerRate", "maxAccel", "maxBrake", "maxSpeed", "maxReverse", "accelLag", "jerkMax"])
    specRange(key, spec[key], 0);
  specRange("mass", spec.mass ?? 0, 0);
  if (spec.mass) {
    specRange("cgToFront", spec.cgToFront, 0, spec.wheelbase, { openMin: true, openMax: true });
    specRange("track", spec.track, 0, Infinity, positive);
    specRange("yawInertia", spec.yawInertia, 0, Infinity, positive);
    for (const key of ["cgHeight", "frontStiffness", "rearStiffness"]) specRange(key, spec[key], 0);
    for (const key of ["brakeFront", "driveFront", "rollFront"]) specRange(key, spec[key], 0, 1);
  } else if (spec.cgToFront != null) {
    specRange("cgToFront", spec.cgToFront, 0, spec.wheelbase);
  }
  if (spec.power != null) {
    specRange("power", spec.power, 0);
    if (spec.power) {
      if (!spec.mass) throw new RangeError("A powered vehicle spec requires positive mass");
      specRange("cdA", spec.cdA, 0);
      specRange("crr", spec.crr, 0);
    }
  }
  // A frozen object can still contain getters. Cache only specs made of own data properties.
  if (
    Object.isFrozen(spec) &&
    Object.getPrototypeOf(spec) === Object.prototype &&
    Object.values(Object.getOwnPropertyDescriptors(spec)).every((descriptor) => Object.hasOwn(descriptor, "value"))
  )
    validatedSpecs.add(spec);
}

export function validateStepDuration(dt) {
  if (!Number.isFinite(dt) || dt < 0 || dt > MAX_PHYSICS_STEP_S)
    throw new RangeError("Invalid vehicle step duration (seconds)");
}

// Preserve the single-turn arithmetic used for ordinary headings. The remainder bounds the
// work for a heading loaded from an unwrapped trace or supplied by an external driver.
export function wrapHeading(angle) {
  if (angle > 3 * Math.PI || angle <= -3 * Math.PI) angle %= FULL_TURN;
  if (angle > Math.PI) angle -= FULL_TURN;
  if (angle <= -Math.PI) angle += FULL_TURN;
  return angle;
}

export class Vehicle {
  constructor(x = 0, y = 0, psi = 0, v = 0, spec = CAR) {
    this.spec = spec;
    this.x = x;
    this.y = y;
    this.psi = psi;
    this.v = v;
    this.delta = 0;
    this.a = 0;
    this.vy = 0;
    this.r = 0;
    this.ax = 0;
    this.latAccel = 0;
    this.slipping = 0; // 0..1: how much of the available grip the most loaded axle uses beyond its limit
  }

  clone() {
    const c = new Vehicle(this.x, this.y, this.psi, this.v, this.spec);
    c.delta = this.delta;
    c.a = this.a;
    c.vy = this.vy;
    c.r = this.r;
    c.ax = this.ax;
    c.latAccel = this.latAccel;
    c.slipping = this.slipping;
    return c;
  }

  // dt in seconds, steer in radians and accel in m/s². Positive steer turns left.
  step(dt, command = {}) {
    validateStepDuration(dt);
    if (dt === 0) return;
    if (command === null || typeof command !== "object" || Array.isArray(command))
      throw new TypeError("Vehicle command must be an object");
    const { steer = 0, accel = 0, reverse = false } = command;
    if (!Number.isFinite(steer) || !Number.isFinite(accel)) throw new RangeError("Non-finite vehicle command");
    if (typeof reverse !== "boolean") throw new TypeError("Vehicle reverse command must be a boolean");
    if (!Number.isFinite(this.x) || !Number.isFinite(this.y) || !Number.isFinite(this.psi) || !Number.isFinite(this.v))
      throw new RangeError("Invalid vehicle pose");
    if (!Number.isFinite(this.delta) || !Number.isFinite(this.a))
      throw new RangeError("Invalid vehicle actuator state");
    if (!Number.isFinite(this.vy) || !Number.isFinite(this.r)) throw new RangeError("Invalid vehicle lateral motion");
    if (!Number.isFinite(this.ax) || !Number.isFinite(this.latAccel))
      throw new RangeError("Invalid vehicle load-transfer acceleration");
    const mu = roadGrip();
    if (ROAD.gripAt != null && typeof ROAD.gripAt !== "function")
      throw new TypeError("ROAD.gripAt must be a function or null");
    validateMotionSpec(this.spec);

    const { x, y, psi, v, delta, a, vy, r, ax, latAccel, slipping } = this;
    try {
      integrate(this, dt, steer, accel, reverse, mu);
      if (
        !Number.isFinite(this.x) ||
        !Number.isFinite(this.y) ||
        !Number.isFinite(this.psi) ||
        !Number.isFinite(this.v) ||
        !Number.isFinite(this.delta) ||
        !Number.isFinite(this.a) ||
        !Number.isFinite(this.vy) ||
        !Number.isFinite(this.r) ||
        !Number.isFinite(this.ax) ||
        !Number.isFinite(this.latAccel) ||
        !Number.isFinite(this.slipping)
      )
        throw new RangeError("Vehicle integration produced non-finite state");
    } catch (error) {
      // This also handles errors raised by a surface hook partway through a dynamic tick.
      Object.assign(this, { x, y, psi, v, delta, a, vy, r, ax, latAccel, slipping });
      throw error;
    }
  }

  // Sideslip angle of the body at the CG (rad): how far the car is moving sideways to its heading.
  get beta() {
    return Math.abs(this.v) > 0.5 ? Math.atan2(this.vy, Math.abs(this.v)) : 0;
  }

  get center() {
    return pointAhead(this, bodyLength(this.spec) / 2 - this.spec.rearOverhang);
  }
  get front() {
    return pointAhead(this, bodyLength(this.spec) - this.spec.rearOverhang);
  }

  obb() {
    return {
      center: this.center,
      heading: this.psi,
      halfLength: this.spec.length / 2,
      halfWidth: halfWidth(this.spec),
    };
  }

  corners() {
    const [cx, cy] = this.center;
    const c = Math.cos(this.psi),
      s = Math.sin(this.psi);
    const hl = this.spec.length / 2,
      hw = halfWidth(this.spec);
    return [
      [hl, hw],
      [hl, -hw],
      [-hl, -hw],
      [-hl, hw],
    ].map(([lx, ly]) => {
      const x = cx + lx * c - ly * s;
      const y = cy + lx * s + ly * c;
      if (!Number.isFinite(x) || !Number.isFinite(y))
        throw new RangeError("Vehicle corner exceeds the coordinate range");
      return [x, y];
    });
  }

  // A point in the world expressed in the car's frame: ahead (+forward) and right (+right).
  toLocal(px, py) {
    if (!Number.isFinite(px) || !Number.isFinite(py))
      throw new RangeError("Invalid point for vehicle-local projection");
    if (!Number.isFinite(this.x) || !Number.isFinite(this.y) || !Number.isFinite(this.psi))
      throw new RangeError("Invalid pose for vehicle-local projection");
    const dx = px - this.x,
      dy = py - this.y;
    const c = Math.cos(this.psi),
      s = Math.sin(this.psi);
    const ahead = dx * c + dy * s;
    const right = dx * s - dy * c;
    if (!Number.isFinite(ahead) || !Number.isFinite(right)) throw new RangeError("Invalid vehicle-local projection");
    return { ahead, right };
  }
}

// Restored replay objects keep the Vehicle prototype and ordinary motion fields. Module helpers
// let those objects and new instances use the same integration and projection paths.
function integrate(vehicle, dt, steer, accel, reverse, mu) {
  const P = vehicle.spec;
  const target = Math.max(-P.maxSteer, Math.min(P.maxSteer, steer));
  const maxDelta = P.steerRate * dt;
  vehicle.delta += Math.max(-maxDelta, Math.min(maxDelta, target - vehicle.delta));
  let cmd = Math.max(-P.maxBrake, Math.min(P.maxAccel, accel));
  if (cmd === 0) cmd = -0.02 * vehicle.v; // rolling drag
  if (P.power && vehicle.v > 0 && cmd > 0) {
    const resist = P.crr * G + (0.5 * AIR * P.cdA * vehicle.v * vehicle.v) / P.mass;
    cmd = Math.min(cmd, P.power / (P.mass * Math.max(vehicle.v, 2)) - resist);
  }
  const da = (cmd - vehicle.a) * Math.min(1, dt / P.accelLag);
  vehicle.a += Math.max(-P.jerkMax * dt, Math.min(P.jerkMax * dt, da));

  const v0 = vehicle.v;
  if (Math.abs(vehicle.v) < KINEMATIC_BELOW || !P.mass) kinematic(vehicle, dt, mu);
  else {
    const n = Math.max(1, Math.ceil(dt / SUBSTEP - 1e-9));
    const h = dt / n;
    for (let i = 0; i < n; i++) dynamic(vehicle, h, mu);
  }
  if (!Number.isFinite(vehicle.v)) throw new RangeError("Vehicle integration produced non-finite speed");
  // braking never reverses the car on its own; reversing is an explicit choice
  if (vehicle.a < 0 && v0 >= 0 && vehicle.v < 0 && !reverse) vehicle.v = 0;
  if (vehicle.a > 0 && v0 < 0 && vehicle.v > 0) vehicle.v = 0;
  // held on the brakes at a standstill the car does not accelerate backwards
  if (vehicle.v === 0 && vehicle.a < 0 && !reverse) vehicle.a = 0;
  if (vehicle.v === 0) {
    vehicle.vy = 0;
    vehicle.r = 0;
  }
  vehicle.v = Math.max(-P.maxReverse, Math.min(P.maxSpeed, vehicle.v));
  vehicle.psi = wrapHeading(vehicle.psi);
}

// Walking pace: the car goes where its wheels point, limited by the friction circle.
function kinematic(vehicle, dt, mu) {
  const P = vehicle.spec;
  // (where grip varies, the slipperier axle's: ROAD.gripAt)
  const grip = (ROAD.gripAt ? Math.min(...axleGrip(vehicle, mu)) : mu) * G;
  const a = Math.max(-grip, Math.min(grip, vehicle.a));
  let curvature = Math.tan(vehicle.delta) / P.wheelbase;
  const latMax = Math.sqrt(Math.max(0, grip * grip - a * a));
  const v2 = vehicle.v * vehicle.v;
  if (v2 * Math.abs(curvature) > latMax) curvature = (Math.sign(curvature) * latMax) / v2;
  vehicle.latAccel = v2 * curvature;
  vehicle.ax = a;
  vehicle.slipping = 0;
  vehicle.x += vehicle.v * Math.cos(vehicle.psi) * dt;
  vehicle.y += vehicle.v * Math.sin(vehicle.psi) * dt;
  vehicle.psi += vehicle.v * curvature * dt;
  vehicle.r = vehicle.v * curvature;
  vehicle.vy = (P.wheelbase - (P.cgToFront ?? P.wheelbase / 2)) * vehicle.r;
  vehicle.v += a * dt;
}

function dynamic(vehicle, h, mu) {
  const P = vehicle.spec;
  const L = P.wheelbase,
    lf = P.cgToFront,
    lr = L - lf,
    m = P.mass;
  // axle loads with longitudinal transfer (from the last step's acceleration)
  const Fzf = Math.max(0, (m * (G * lr - vehicle.ax * P.cgHeight)) / L);
  const Fzr = Math.max(0, (m * (G * lf + vehicle.ax * P.cgHeight)) / L);
  // lateral transfer: the axle's grip falls because the outside tire is over its static load
  const dFz = (m * Math.abs(vehicle.latAccel) * P.cgHeight) / P.track;
  // (where grip varies, each axle's own: ROAD.gripAt; elsewhere both are ROAD.mu, untouched)
  let muFront = mu,
    muRear = mu;
  if (ROAD.gripAt) [muFront, muRear] = axleGrip(vehicle, mu);
  const muF = axleMu(muFront, Fzf, dFz * P.rollFront, (m * G * lr) / L);
  const muR = axleMu(muRear, Fzr, dFz * (1 - P.rollFront), (m * G * lf) / L);
  const vx = vehicle.v,
    vy = vehicle.vy,
    r = vehicle.r,
    d = vehicle.delta;
  const alphaF = Math.atan2(vy + lf * r, vx) - d;
  const alphaR = Math.atan2(vy - lr * r, vx);
  // longitudinal forces, capped per axle by anti-lock brakes, traction control, and stability
  // control, which leave each axle the grip its cornering needs so braking in a bend does not
  // spin the car
  const Fx = m * vehicle.a;
  let Fxf, Fxr;
  if (Fx >= 0) {
    Fxf = Fx * P.driveFront;
    Fxr = Fx * (1 - P.driveFront);
  } else {
    Fxf = Fx * P.brakeFront;
    Fxr = Fx * (1 - P.brakeFront);
  }
  Fxf = clampAbs(Fxf, longCap(muF * Fzf, P.frontStiffness * Fzf * Math.abs(Math.tan(alphaF))));
  Fxr = clampAbs(Fxr, longCap(muR * Fzr, P.rearStiffness * Fzr * Math.abs(Math.tan(alphaR))));
  const FyMaxF = Math.sqrt(Math.max(0, (muF * Fzf) ** 2 - Fxf * Fxf));
  const FyMaxR = Math.sqrt(Math.max(0, (muR * Fzr) ** 2 - Fxr * Fxr));
  const Fyf = fiala(alphaF, P.frontStiffness * Fzf, FyMaxF);
  const Fyr = fiala(alphaR, P.rearStiffness * Fzr, FyMaxR);
  const cd = Math.cos(d),
    sd = Math.sin(d);
  const fx = Fxf * cd - Fyf * sd + Fxr;
  const fy = Fxf * sd + Fyf * cd + Fyr;
  const ax = fx / m,
    ay = fy / m;
  const dvx = ax + vy * r;
  const dvy = ay - vx * r;
  const dr = (lf * (Fxf * sd + Fyf * cd) - lr * Fyr) / P.yawInertia;
  // the rear axle moves with the body's forward speed and the CG's sideways speed minus yaw
  const c = Math.cos(vehicle.psi),
    s = Math.sin(vehicle.psi);
  const vyRear = vy - lr * r;
  vehicle.x += (vx * c - vyRear * s) * h;
  vehicle.y += (vx * s + vyRear * c) * h;
  vehicle.psi += r * h;
  vehicle.v += dvx * h;
  vehicle.vy += dvy * h;
  vehicle.r += dr * h;
  vehicle.ax = ax;
  vehicle.latAccel = ay;
  const useF = FyMaxF > 1 ? Math.abs(alphaF) / Math.max(1e-6, slideAngle(P.frontStiffness * Fzf, FyMaxF)) : 1;
  const useR = FyMaxR > 1 ? Math.abs(alphaR) / Math.max(1e-6, slideAngle(P.rearStiffness * Fzr, FyMaxR)) : 1;
  vehicle.slipping = Math.max(0, Math.min(1, Math.max(useF, useR) - 1));
}

function pointAhead(vehicle, metres) {
  if (!Number.isFinite(vehicle.psi)) throw new RangeError("Invalid heading for vehicle body projection");
  const x = vehicle.x + Math.cos(vehicle.psi) * metres;
  const y = vehicle.y + Math.sin(vehicle.psi) * metres;
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new RangeError("Invalid projected vehicle position");
  return [x, y];
}

function bodyLength(spec) {
  const length = spec?.length;
  if (!Number.isFinite(length) || length <= 0) throw new RangeError("Vehicle body length must be positive");
  if (!Number.isFinite(spec.rearOverhang) || spec.rearOverhang < 0 || spec.rearOverhang > length)
    throw new RangeError("Vehicle rear overhang must place the rear axle within the body");
  return length;
}

function halfWidth(spec) {
  const width = spec.width / 2;
  if (!Number.isFinite(spec.width) || width <= 0) throw new RangeError("Vehicle body width must be positive");
  return width;
}

const clampAbs = (x, lim) => Math.max(-lim, Math.min(lim, x));

// The road's grip under a vehicle's front and rear axles, where it varies (ROAD.gripAt): [front, rear].
function axleGrip(v, fallback) {
  const at = ROAD.gripAt,
    P = v.spec,
    wb = P.wheelbase;
  const front = at(v.x + Math.cos(v.psi) * wb, v.y + Math.sin(v.psi) * wb, P),
    rear = at(v.x, v.y, P);
  return [validGrip(front, fallback), validGrip(rear, fallback)];
}

const validGrip = (mu, fallback) => (Number.isFinite(mu) && mu >= 0 ? mu : fallback);

function roadGrip() {
  const mu = ROAD.mu;
  if (!Number.isFinite(mu) || mu < 0) throw new RangeError("ROAD.mu must be a finite nonnegative friction coefficient");
  return mu;
}

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
  const half = Fz / 2,
    nominal = Fz0 / 2;
  const t = Math.min(dFz, half);
  const tireMu = (load) => mu * Math.max(0.5, 1 - LOAD_SENSITIVITY * (load / nominal - 1));
  return ((half + t) * tireMu(half + t) + (half - t) * tireMu(half - t)) / Fz;
}

// Fiala brush tire: lateral force (N) for slip angle alpha, cornering stiffness C (N/rad), and the
// grip available for cornering Fmax (N). Opposes the slip.
function fiala(alpha, C, Fmax) {
  if (Fmax <= 0 || C <= 0) return 0;
  const t = Math.tan(alpha);
  const tSl = (3 * Fmax) / C;
  if (Math.abs(t) >= tSl) return -Fmax * Math.sign(alpha);
  const a = Math.abs(t);
  const force = C * a - (C * C * a * a) / (3 * Fmax) + (C * C * C * a * a * a) / (27 * Fmax * Fmax);
  if (Number.isFinite(force)) return -Math.sign(alpha) * force;
  // Extreme stiffness can overflow intermediate terms in the expanded cubic even at zero slip.
  // Express the same force as a fraction of available grip in that case.
  const u = a / tSl;
  return -Math.sign(alpha) * Fmax * (u * (3 - u * (3 - u)));
}

// Slip angle at which the Fiala tire is fully sliding.
function slideAngle(C, Fmax) {
  return C > 0 ? Math.atan((3 * Fmax) / C) : 0;
}

// Comfortable limits a sensible driver keeps to on this surface: cornering and braking scale down
// with grip, so a wet or snowy road means slower bends and earlier braking.
export function comfort() {
  const mu = roadGrip();
  const scale = Math.max(0.35, Math.min(1, mu / DRY_ROAD_MU));
  return { lat: 2.2 * scale, decel: 2.5 * scale, hardDecel: Math.min(7, mu * G * 0.8) };
}
