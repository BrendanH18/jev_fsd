import { r1 } from "../../common.js";
import { AMBER_SPEED_SLACK_MPS, observeAmber } from "../amber.js";
import { approachPhase, movementSignal } from "../signals.js";
import { redTurnAllowed } from "./index.js";

const counter = "amber_lights_run";
const SAFE_STOP = "safe_stop";
const SPED_UP = "sped_up";
const stop = (snap) => snap.intersection?.amber?.stop && !redTurnAllowed(snap.intersection);
const clearing = (snap) => snap.amber_clear || snap.intersection?.amber;
const key = (edge, control) => `${edge}:${control.id}`;

function violation(world, reason) {
  world.violations[counter] = (world.violations[counter] || 0) + 1;
  world.events.push({ type: "amber_light", reason });
}

export default {
  key: "amberLights",
  seen: "amberLightsSeen",
  buildAt: "early",
  build: (_world, { enabled }) => !!enabled,
  observeSignal(world, control, edge, rc, past, crossed) {
    const inter = world.amberLights ? world.map.intersections.get(control.id) : null;
    if (!inter || !world.visibility.canSee(world.ego, inter.x, inter.y)) return null;
    // Manual steering can take a different exit from the route. Track the displayed arrow separately.
    const shows = approachPhase(inter, edge.id, world.t);
    const arrow = shows === "arrow_yellow";
    const signal = movementSignal(shows, arrow ? "left" : rc?.turn || "straight");
    const choice = observeAmber(world.ego, `${key(edge.id, control)}${arrow ? ":arrow" : ""}`, signal, -past, inter, shows, world.t);
    if (!choice) return null;
    if (!crossed) world.amberLightsSeen = true;
    if (signal !== "yellow") return null;
    const reason = choice.stop
      ? SAFE_STOP
      : choice.max_speed_mps > choice.speed_mps + AMBER_SPEED_SLACK_MPS
        ? SPED_UP
        : null;
    if (!reason) return null;
    return () => {
      if (arrow) return { amberViolation: reason };
      violation(world, reason);
      return null;
    };
  },
  arrowExitAudit(world, arrow) {
    if (arrow.amberViolation) violation(world, arrow.amberViolation);
  },
  routeControlSense(world, snap, p, frontS) {
    if (!world.amberLights) return;
    const { ego, map, route } = world;
    for (const c of route.controls) {
      const choice = ego.amberChoices?.get(key(c.edge, c.control));
      const clearAt = (c.sJunction ?? c.sRoute + 8) + map.crossingHalfWidth(c.edge);
      if (
        choice &&
        !choice.stop &&
        world.t < choice.stop_until &&
        frontS >= c.sRoute &&
        p.s - ego.spec.rearOverhang <= clearAt &&
        (!snap.amber_clear || choice.speed_mps < snap.amber_clear.speed_mps)
      )
        snap.amber_clear = choice;
    }
  },
  intersectionFields: {
    at: "beforeLine",
    run(world, inter, { control, c, directive, signal, shows, bumperToLine }) {
      return world.amberLights && control.type === "signal" && inter && !directive
        ? { amber: observeAmber(world.ego, key(c.edge, control), signal, bumperToLine, inter, shows, world.t) }
        : null;
    },
  },
  // Clear an intersection already entered, even through the following red.
  signalEntryFields: (world, _inter, { entered, control }) =>
    world.amberLights && entered && control.type === "signal" ? { clear_entered: true } : null,
  signalDecision: (intersection) => intersection?.amber,
  clearingLimit(snap) {
    const choice = clearing(snap);
    return choice && !choice.stop
      ? { speed: choice.speed_mps, reason: "too close to stop safely for amber: do not speed up" }
      : null;
  },
  lineStop: {
    at: "beforeFollower",
    run({ intersection }) {
      const choice = intersection.amber;
      return choice?.stop
        ? {
            stopDecel: choice.stop_decel,
            stopReaction: choice.reaction_s,
            ...(choice.firm ? { stopFirm: true } : {}),
          }
        : null;
    },
  },
  adjust: {
    at: "finish",
    run({ snap }, list) {
      const choice = clearing(snap);
      if (!choice || choice.stop) return;
      for (const { law } of list) if (law.vTarget != null) law.vTarget = Math.min(law.vTarget, choice.speed_mps);
    },
  },
  trafficSignalDecision(world, vehicle, edge, control, signal, distance) {
    if (!world.amberLights) return null;
    const inter = world.map.intersections.get(control.id);
    return observeAmber(vehicle, key(edge.id, control), signal, distance, inter, approachPhase(inter, edge.id, world.t), world.t);
  },
  trafficSpeed: {
    at: "clearing",
    run(world, vehicle, front) {
      let cap = Infinity;
      if (!world.amberLights) return cap;
      const { path } = vehicle;
      const { map } = world;
      for (const edge of path.edges) {
        const choice = edge.control && vehicle.amberChoices?.get(key(edge.id, edge.control));
        if (!choice || choice.stop || world.t >= choice.stop_until) continue;
        const line = edge.sStart + (edge.control.s_line / Math.max(1, map.edges.get(edge.id).length)) * (edge.sEnd - edge.sStart);
        if (front >= line && path.s - vehicle.spec.rearOverhang <= edge.sEnd + map.crossingHalfWidth(edge.id))
          cap = Math.min(cap, choice.speed_mps);
      }
      return cap;
    },
  },
  rulesCost: {
    at: "beforeSignalStop",
    run: (c, snap) => (c.id === "stop_at_line" && stop(snap) && !snap.emergency ? -12 : 0),
  },
  stopAtLineDrive: (snap, candidate) => candidate?.id === "stop_at_line" && stop(snap),
  cautious: {
    at: "signalStop",
    run: (snap, eligible) => (stop(snap) ? eligible.find((c) => c.id === "stop_at_line") : null),
  },
  intersectionModelFields: {
    at: "afterCrossTraffic",
    run({ amber }) {
      return amber
        ? {
            amber: {
              stop: amber.stop,
              speed_at_observation_mps: r1(amber.speed_mps),
              distance_at_observation_m: r1(amber.distance_m),
              stopping_distance_m: r1(amber.stopping_distance_m),
            },
          }
        : null;
    },
  },
  yellowSignalClause({ intersection: { amber } }, m) {
    return !amber
      ? null
      : amber.stop
        ? `The signal ${m} m ahead is yellow. A safe stop was possible when amber was first observed: stop before the line and wait for green.`
        : `The signal ${m} m ahead is yellow. The car was too close for a safe stop when amber was first observed: continue carefully if the path is clear, without speeding up above ${r1(amber.speed_mps)} m/s. Amber never overrides pedestrians, oncoming traffic or a blocked exit; red does not grant a new entry.`;
  },
  prompt: {
    at: "amberDecision",
    text: "- On yellow with `intersection.amber.stop=false`, continue only with a clear path and never speed up above `intersection.amber.speed_at_observation_mps`. Red still requires stopping before entry.",
  },
  metric: {
    at: "afterRedLights",
    name: counter,
    label: "Ignored a safe amber stop or sped up to beat the light",
    failure: "failed to stop safely for amber",
    category: "right_of_way",
    eventType: "amber_light",
  },
  coach: {
    init: () => ({ amberLightsSeen: false }),
    seen: "amberLightsSeen",
    capDelta: counter,
    events: {
      amber_light(score, event) {
        score.incident(
          "amber_light",
          event.reason === SPED_UP ? "Sped up to beat an amber light" : "Passed amber when a safe stop was possible",
        );
      },
    },
    deductions: [{ at: "firstLegality", order: 0, counter, weight: 25, delta: true }],
    tips: [{
      at: "beforeGeneralJunction",
      order: 0,
      when: (score) => score.counterDelta(counter),
      text: "When the light turns amber, stop if you can do so safely. If you are too close to stop safely, continue carefully without speeding up; keep yielding to people and traffic, and never enter on red.",
    }],
    reports: [{
      at: "beforeFeatureSummary",
      order: 1,
      read: (score) => (score.amberLightsSeen ? { [counter]: score.counterDelta(counter) } : null),
    }],
  },
};
