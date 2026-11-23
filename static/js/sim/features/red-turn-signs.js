// No-turn-on-red signs (sim/red-turn-signs.js) as a feature record (sim/features/index.js,
// docs/feature-interface.md).
import { redTurnBanned, redTurnExits, routeRedTurnBanned } from "../red-turn-signs.js";

export default {
  key: "redTurnSigns",
  build: (_world, { enabled }) => !!enabled,
  redEntryBans: (world, edgeId) => (world.redTurnSigns ? redTurnExits(world, edgeId) : null),
  routeTurnOnRedBlocked: (world, control) => (routeRedTurnBanned(world, control) ? { no_turn_on_red: true } : null),
  turnOnRedBlocked: (world, from, to) => redTurnBanned(world, from, to),
  state: {
    at: "signal",
    run(snap, state) {
      if (snap.intersection?.no_turn_on_red) state.intersection.no_turn_on_red = true;
    },
  },
  clause: {
    at: "signal",
    run: (snap) =>
      snap.intersection?.no_turn_on_red
        ? "A sign prohibits this turn on red. Wait at the line while the signal for this turn is red, even if the cross street is empty; the sign does not prohibit turning on green."
        : null,
  },
};
