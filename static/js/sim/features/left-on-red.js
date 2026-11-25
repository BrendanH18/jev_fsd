import { leftOnRedAllowed, leftOnRedExit } from "../left-on-red.js";

const observe = (world) => {
  world.leftOnRedSeen = true;
};

export default {
  key: "leftOnRed",
  seen: "leftOnRedSeen",
  build: (_world, { enabled }) => !!enabled,

  senseRedTurn(world, control, sense) {
    return control.turn === "left" && leftOnRedExit(world, control) ? { left_on_red: sense() } : null;
  },
  extraRedTurn(intersection) {
    const move = intersection?.left_on_red;
    if (!move) return null;
    return {
      move,
      direction: "left",
      lane: 0,
      observe,
      motionCriterion: move.go
        ? " (except when intersection.left_on_red.stop_completed and clear are both true: the car may turn left on red)"
        : null,
    };
  },
  trafficRedTurnLane(world, from, to) {
    return leftOnRedAllowed(world, from, to) ? { lane: 0 } : null;
  },
  redTurnMemory(world, edge, bannedExits) {
    if (!world.leftOnRed) return null;
    const { map, ego } = world;
    const lane = map.nearestLane(ego.x, ego.y, ego.psi, 8)?.lane;
    if (lane?.edge !== edge.id || lane.idx !== 0) return null;
    const exits = (map.out.get(edge.to) || []).filter((id) => leftOnRedAllowed(world, edge.id, id));
    return exits.length ? { leftAllowed: true, ...(bannedExits ? { leftExits: exits } : {}) } : null;
  },
  redTurnExit(world, memory, edge) {
    if (
      !memory.leftAllowed ||
      !(memory.leftExits ? memory.leftExits.includes(edge.id) : leftOnRedAllowed(world, memory.edge, edge.id))
    )
      return null;
    return () => {
      memory.exit = world.map.headingOut(edge.id);
      observe(world);
    };
  },
  state: {
    at: "signal",
    run(snap, state) {
      const move = snap.intersection.left_on_red;
      if (move)
        state.intersection.left_on_red = {
          allowed: true,
          stop_completed: move.stop_completed,
          clear: move.clear,
          ...(move.wait_for ? { wait_for: move.wait_for.id || move.wait_for.kind } : {}),
        };
    },
  },
  notice: {
    at: "afterTurnNotice",
    order: 0,
    duration: 2500,
    style: "safety",
    read(_world, autopilot) {
      const intersection = autopilot.snap?.intersection;
      const move = intersection?.left_on_red;
      return move
        ? {
            key: `${intersection.id}:${move.stop_completed}:${move.clear}`,
            text: move.go
              ? "LEFT ON RED · CLEAR TO TURN"
              : !move.stop_completed
                ? "LEFT ON RED · FULL STOP FIRST"
                : "LEFT ON RED · YIELD TO PEDESTRIANS AND TRAFFIC",
          }
        : null;
    },
  },
  prompt: {
    at: "beforeRightOnRed",
    text: "- A left turn on red is allowed only when `intersection.left_on_red` is present: from one one-way street onto another, after a full stop, yielding to pedestrians and traffic from the right. Never at a scramble, in Québec, or where a sign forbids it. When stop_completed and clear are true, the candidate at target makes the turn.",
  },
};
