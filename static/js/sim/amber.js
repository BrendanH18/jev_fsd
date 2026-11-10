// Steady amber: stop if a safe stop was possible when the light was first seen.
// This is a conservative simulator stopping model, not a statutory distance: allow one
// decision interval and actuator lag, then brake at the current grip's comfortable rate.
// A dilemma that cannot clear before red uses firmer braking only when it safely fits.
// Drivers and the independent line-crossing audit use the same latched observation.
import { comfort, ROAD } from "./vehicle.js";
import { phaseOf, secondsToGreen, amberTimeLeft } from "./signals.js";

export const AMBER_REACTION_S = 0.4;
export const AMBER_SPEED_SLACK_MPS = 0.5;

export function amberStoppingDistance(vehicle) {
  const v = Math.max(0, vehicle.v);
  return 0.5 + v * (AMBER_REACTION_S + (vehicle.spec.accelLag || 0)) + v * v / (2 * comfort().decel);
}

// `key` identifies the physical approach, independently of the chosen route/candidate.
// The cycle start and displayed lamp distinguish separate ambers, including an arrow's.
// Maps live on vehicles, so normal checkpoints preserve them without global module state.
export function observeAmber(vehicle, key, signal, distance, intersection, shows, t) {
  if (signal !== "yellow") {
    // Keep the smooth profile only through this amber's following red, even if
    // the driver leaves and returns without observing the intervening green.
    const stopping = vehicle.amberChoices?.get(key);
    if (signal === "red" && stopping && (stopping.stop || distance < 0) && t < stopping.stop_until) return stopping;
    if (signal !== "unknown") vehicle.amberChoices?.delete(key);
    return null;
  }
  const phases = phaseOf(intersection, t);
  const cycleStart = Math.round((t - phases.u) * 1000);
  const phase = `${cycleStart}:${shows}`;
  vehicle.amberChoices ||= new Map();
  let choice = vehicle.amberChoices.get(key);
  // A first observation after entry cannot impose a new stop or a zero clearing
  // speed on a car that is already in the junction.
  if (distance < 0 && (!choice || choice.phase !== phase)) { vehicle.amberChoices.delete(key); return null; }
  if (!choice || choice.phase !== phase) {
    const stopping = amberStoppingDistance(vehicle);
    const speed = Math.max(0, vehicle.v);
    const arrow = shows === "arrow_yellow" ? intersection.plan.advance : null;
    const group = arrow ? arrow.group : phases.A === "yellow" ? "A" : "B";
    const untilGreen = secondsToGreen(intersection, group, t, arrow?.edge ?? null, arrow ? "left" : "straight");
    const room = Math.max(0.5, distance - 0.5 - speed * (AMBER_REACTION_S + (vehicle.spec.accelLag || 0)));
    // On low grip there can be a dilemma zone: a comfortable stop takes longer
    // than the amber, yet coasting cannot reach the line before red. Prefer a
    // firmer, physically safe stop to a clearing commitment that needs speeding up.
    const required = speed * speed / (2 * room);
    const cannotClear = speed > 0.2 && distance / speed >= amberTimeLeft(intersection, shows, t);
    const firmRoom = distance - 0.5 - speed * (AMBER_REACTION_S + (vehicle.spec.accelLag || 0));
    const firmDecel = speed * speed / (2 * firmRoom) * 1.1;
    const onIce = ROAD.gripAt && [0, vehicle.spec.wheelbase].some(d =>
      (ROAD.gripAt(vehicle.x + Math.cos(vehicle.psi) * d, vehicle.y + Math.sin(vehicle.psi) * d, vehicle.spec) ?? ROAD.mu) < ROAD.mu);
    const firm = !onIce && distance < stopping && cannotClear && firmRoom > 0 && firmDecel <= Math.min(vehicle.spec.maxBrake, comfort().hardDecel);
    choice = { phase, stop: (speed < 0.2 && distance >= 0) || distance >= stopping || firm, speed_mps: speed, distance_m: distance, stopping_distance_m: stopping,
      stop_until: t + untilGreen,
      reaction_s: AMBER_REACTION_S + (vehicle.spec.accelLag || 0),
      stop_decel: firm ? Math.max(comfort().decel, firmDecel) : Math.min(comfort().decel, Math.max(0.3, required)),
      ...(firm ? { firm: true } : {}) };
    vehicle.amberChoices.set(key, choice);
  }
  choice.max_speed_mps = Math.max(choice.max_speed_mps || choice.speed_mps, Math.max(0, vehicle.v));
  return choice;
}
