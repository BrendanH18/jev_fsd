const TAU = 2 * Math.PI;

export function animationTime(dt) {
  return Number.isFinite(dt) && dt > 0 ? dt : 0;
}

export function advanceRotation(angle, speed, dt, radius) {
  if (!Number.isFinite(speed) || !animationTime(dt)) return angle;
  return (angle + (speed * dt) / radius) % TAU;
}

export function rollWheels(actor, vehicle, dt, radius) {
  actor.spin = advanceRotation(actor.spin, vehicle.v, dt, radius);
  for (const { wheel, pivot, steer } of actor.wheels) {
    wheel.rotation.z = -actor.spin;
    pivot.rotation.y = steer && Number.isFinite(vehicle.delta) ? vehicle.delta : 0;
  }
}

export function followAnimation(current, target, dt, rate) {
  if (current == null) return target;
  return current + (target - current) * Math.min(1, animationTime(dt) * rate);
}

export function readBrakeLevel(actor, speed, dt, threshold = 0.6) {
  if (!Number.isFinite(speed)) return actor.brakeLevel;
  const stopped = Math.abs(speed) < 0.15;
  if (actor.prevV == null) {
    actor.prevV = speed;
    actor.brakeLevel = Number(stopped);
  } else if (animationTime(dt)) {
    const slowing = (Math.abs(actor.prevV) - Math.abs(speed)) / dt > threshold;
    actor.brakeLevel = followAnimation(actor.brakeLevel, Number(stopped || slowing), dt, 12);
    actor.prevV = speed;
  }
  return actor.brakeLevel;
}

export function syncBrakeMaterial(actor, speed, dt, lightsOn, threshold) {
  const level = readBrakeLevel(actor, speed, dt, threshold);
  actor.brake.emissiveIntensity = 0.3 + lightsOn * 1.5 + level * (2.2 + lightsOn * 2);
}

export function flashPhase(t, period, offset = 0) {
  if (!Number.isFinite(t) || !Number.isFinite(offset)) return 0;
  const phase = ((t + offset) % period) / period;
  return phase < 0 ? phase + 1 : phase;
}

export function actorTime(t, next, alpha) {
  if (!Number.isFinite(next) || next <= t || !Number.isFinite(alpha)) return t;
  return t + (next - t) * Math.max(0, Math.min(1, alpha));
}

// A renderer that keeps motion history of its own on a mesh says how to clear it, under its own name.
export function onMotionReset(mesh, name, reset) {
  (mesh.userData.motionResets ??= new Map()).set(name, reset);
}

export function resetActorMotion(mesh) {
  const actor = mesh.userData;
  if (Object.hasOwn(actor, "prevV")) actor.prevV = null;
  for (const reset of actor.motionResets?.values() ?? []) reset(mesh);
  mesh.position.y = 0;
  mesh.rotation.z = 0;
  if (Object.hasOwn(actor, "spin")) actor.spin = 0;
  if (Object.hasOwn(actor, "crank")) actor.crank = 0;
  if (Object.hasOwn(actor, "open")) actor.open = null;
  if (Object.hasOwn(actor, "swing")) actor.swing = null;
  if (actor.pivot) {
    actor.pitch = actor.roll = 0;
    actor.pivot.rotation.set(0, 0, 0);
  }
}

// Commercial vehicles get independent lens materials. A light changing on one vehicle must not
// alter the full fleet's lenses through a shared material.
export function syncHeadMaterial(material, lightsOn) {
  material.emissiveIntensity = 0.6 + lightsOn * 6;
}

export function syncAmberLenses(lenses, vehicle, lit) {
  for (const lens of lenses) {
    lens.mesh.material.emissiveIntensity = lit && (vehicle.hazards || vehicle.signal === lens.side) ? 6 : 0;
  }
}
