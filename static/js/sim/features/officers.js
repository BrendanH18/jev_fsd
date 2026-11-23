// The registry adapters for junctions controlled by police (sim/traffic-officer.js).
import { r1 } from "../../common.js";
import { TAIL_STOP_DECEL } from "../tailgaters.js";
import {
  SEEN_M,
  createOfficers,
  officerAt,
  officerDirection,
  officerLight,
  officerSensing,
  officerStopLaw,
  stepOfficers,
} from "../traffic-officer.js";

// A police officer directing traffic at the junction ahead (sim/traffic-officer.js): their directions
// override the signal.
function officerClause(o, m, atLine) {
  const lead = `A police officer is directing traffic in the junction ${atLine ? "at the line" : `${m} m ahead`}; the officer's directions override the signal${o.signal === "dark" ? ", whose lights are out" : ""}.`;
  if (o.direction === "stop")
    return `${lead} The officer is holding the car${o.signal === "green" ? ", though its light is green" : ""}: ${atLine ? "hold still at the line until the officer waves the car on" : "stop at the line and wait there for the officer's wave (`wait_for_officer`)"}, never going on into the junction while held.`;
  return `${lead} The officer is waving the car through${o.against_light ? `, though its light is ${o.signal}` : ""}: go on (\`go_on_officer_wave\`), without stopping for the light, still yielding to pedestrians and traffic already in the junction, and, turning left, to oncoming traffic.`;
}

const directive = {
  stopReason: "police officer: stop",
  rejection: "passes_officer_stop",
  motionCriterion:
    ' (but not where a police officer directs traffic: then hold still only when the officer holds the car, `traffic_officer.direction` "stop", even on a green; waved through, keep moving, even on a red)',
  clause(m, atLine) {
    return officerClause(this.detail, m, atLine);
  },
};

function auditEntry(world, officer, control, edge, rc) {
  if (officerDirection(world, world.ego, edge.id) === "stop") {
    world.violations.officer_violations = (world.violations.officer_violations || 0) + 1;
    world.events.push({ type: "officer_violation", officer: officer.id, junction: control.id });
  }
  world.arrowCheck = null;
  const inter = world.map.intersections.get(control.id);
  if (!inter) return;
  const exit =
    rc && rc.sJunction !== null ? world.route.headingAt(Math.min(world.route.length, rc.sJunction + 15)) : null;
  const approach = rc ? world.route.headingAt(rc.sRoute) : world.map.headingIn(edge.id);
  world.lastSignal = {
    centre: [inter.x, inter.y],
    nodes: world.map.junctionNodes(inter),
    approaches: new Set(inter.approaches.map((a) => a.edge)),
    facing: approach + Math.PI,
    exit,
    counted: false,
  };
}

export default {
  rulesStop(snap, eligible) {
    const i = snap.intersection;
    return (
      i?.officer?.direction === "stop" &&
      !i.entered &&
      i.bumper_to_line_m < 1.5 &&
      i.bumper_to_line_m > -1 &&
      (snap.ego.v < 0.5 || !eligible.some((c) => c.id === "wait_for_officer"))
    );
  },
  rulesCost(c) {
    if (c.id === "wait_for_officer") return -12;
    if (c.id === "go_on_officer_wave") return -1;
    return 0;
  },
  legitimateStop(snap, clearing) {
    const i = snap?.intersection;
    return i?.officer?.direction === "stop" && i.bumper_to_line_m < 12 && i.bumper_to_line_m > -clearing;
  },
  cautious: {
    at: "beforeAmber",
    run: (snap, eligible) =>
      snap.traffic_officer?.direction === "stop" ? eligible.find((c) => c.id === "wait_for_officer") : null,
  },
  cautiousDrive: (candidate) => candidate.id === "wait_for_officer",
  key: "officers",
  seen: "officersSeen",
  calls: "officerCalls",
  build: (_world, { enabled, seed }) => createOfficers({ enabled, seed }),
  stepBeforeTraffic(world, _fleet, dt) {
    if (world.officers?.enabled) stepOfficers(world, dt);
  },
  controlDirection: officerDirection,
  controlAudit(world, control, edge, rc, past, entered) {
    const officer = officerAt(world, control.id);
    if (!officer) return false;
    if (Math.abs(past) < SEEN_M && world.visibility.canSee(world.ego, officer.x, officer.y)) world.officersSeen = true;
    if (entered) auditEntry(world, officer, control, edge, rc);
    return true;
  },
  controlSense(world, c, frontS) {
    const officer = officerSensing(world, c, frontS);
    if (!officer) return null;
    return {
      direction: officer.direction,
      fields: (signal) => ({ officer: officerLight(officer, signal) }),
    };
  },
  junctionPlan(intersection) {
    const detail = intersection?.officer;
    return detail ? { ...directive, direction: detail.direction, detail } : null;
  },
  trafficStart: {
    at: "beforeControl",
    run(_world, vehicle) {
      if (vehicle.officerHeld) vehicle.officerHeld = false;
    },
  },
  trafficControl(world, vehicle, edgeId) {
    const direction = officerDirection(world, vehicle, edgeId);
    if (direction) vehicle.officerHeld = direction === "stop";
    return direction;
  },
  sense: {
    at: "junctions",
    run(world, snap) {
      if (world.officers?.enabled) snap.traffic_officer = snap.intersection?.officer || null;
    },
  },
  hazard: { at: "late", run: (snap) => (snap.traffic_officer ? "traffic officer" : null) },
  candidates: {
    at: "junctions",
    run(ctx, out) {
      const { snap, world, FRONT, nudge, v, laneUntil, inLane, approach, stopAt, target } = ctx;
      const officer = snap.intersection?.officer;
      if (officer?.direction === "stop" && snap.intersection.bumper_to_line_m > 0.3) {
        out.push({
          id: "wait_for_officer",
          laneUntil,
          law: inLane({
            kind: "lane",
            offset: nudge,
            vTarget: Math.min(approach, Math.max(v, 3)),
            ...officerStopLaw(world.ego.spec, snap.tailgater ? TAIL_STOP_DECEL : Infinity),
            stopAtRoute: stopAt(snap.intersection.s_line_route - FRONT - 0.5),
          }),
          steer: "hold lane",
          speed: "stop at the line and wait for the officer's wave",
        });
      }
      if (officer?.direction === "go" && !snap.intersection.entered) {
        out.push({
          id: "go_on_officer_wave",
          laneUntil,
          law: inLane({ kind: "lane", vTarget: target }),
          steer: "hold lane",
          speed: `go on the officer's wave${officer.against_light ? `, though the light is ${officer.signal}` : ""}`,
        });
      }
    },
  },
  state: {
    at: "junctions",
    run(snap, state) {
      if (snap.traffic_officer) {
        const o = snap.traffic_officer;
        state.traffic_officer = {
          id: o.id,
          direction: o.direction,
          ...(o.direction === "stop" ? { wait_in_m: r1(Math.max(0, o.bumper_to_line_m)) } : {}),
          officer_waves:
            o.axis === null
              ? "nobody: everyone held"
              : o.axis === o.approach_group
                ? "the car's way"
                : "the crossing street",
          light_shows: o.signal,
          ...(o.against_light ? { against_the_light: true } : {}),
        };
      }
    },
  },
  outcome: {
    at: "ids",
    run(c, snap) {
      if (c.id === "wait_for_officer" && snap.intersection)
        return `clear, stops ${Math.max(0, r1(snap.intersection.bumper_to_line_m - c.sim.progress_m))} m ahead, at the line, as the officer holds the car`;
      if (c.id === "go_on_officer_wave") return `clear, goes on through the junction as the officer waves the car on`;
      return null;
    },
  },
  prompt: {
    at: "junctions",
    text: `- A police officer directing traffic at a junction (\`traffic_officer\`) overrides the signal, whatever it shows, even when its lights are out. When \`traffic_officer.direction\` is "stop", choose \`wait_for_officer\`: stop at the line and stay stopped there, even on a green, until the officer waves the car on. When it is "go", go on (\`go_on_officer_wave\`), even on a red, still yielding to pedestrians and traffic already in the junction and, turning left, to oncoming traffic.`,
  },
  metric: {
    at: "junctions",
    name: "officer_violations",
    failure: "went on when a police officer signalled stop",
    label: "Went on when a police officer directing traffic signalled stop",
    category: "right_of_way",
  },
};
