import { isScramble, scrambleNotice, scrambleState, setScrambles } from "../signals.js";

export default {
  key: "scrambles",
  view: () => import("../../render/scrambles.js"),
  flag: "scramble",
  buildAt: "early",
  build: (_world, { enabled }) => setScrambles(enabled),
  notice: { at: "end", order: -1, duration: 2500, read: scrambleNotice, style: "safety" },
  checkpoint: (world) => setScrambles(world.scrambles),
  coach: {
    init: () => ({ scrambleReds: 0 }),
    events: {
      red_light(score, event) {
        if (event.scramble) score.scrambleReds++;
      },
    },
    tips: [
      {
        at: "afterFollowing",
        order: 5,
        when: (score) => score.scrambleReds,
        text: "At a scramble crossing there is no right turn on red: every light turns red together while people cross every way, diagonally too. Wait at the line for your green.",
      },
    ],
  },
  phaseBansRedTurns: (inter) => isScramble(inter),
  diagonalCrossing: isScramble,
  redLightEvent(event, inter) {
    if (isScramble(inter)) event.scramble = true;
  },
  intersectionFields: {
    at: "afterRightTurn",
    run(world, inter, { control, replacement, policy }) {
      if (control.type === "signal" && isScramble(inter) && !replacement && !policy)
        return { scramble: { ...scrambleState(inter, world.t), right_on_red: false } };
      return null;
    },
  },
  state: {
    at: "signal",
    run(snap, state) {
      const sc = snap.intersection.scramble;
      if (!sc) return;
      state.intersection.scramble = {
        all_walk: sc.phase !== "dont",
        ...(sc.phase === "dont" ? { all_walk_in_s: sc.walk_in_s } : { ends_in_s: sc.ends_in_s }),
        right_on_red: false,
      };
    },
  },
  clause: {
    at: "signal",
    run: (snap) => (snap.intersection.scramble ? scrambleClause(snap.intersection) : null),
  },
  prompt: {
    at: "beforeBusLanes",
    text: `- At a scramble crossing (\`intersection.scramble\`), every light turns red together while people cross every way, diagonally too. There is no right turn on red there: wait at the line for the car's green, whichever way it turns.`,
  },
};

// A scramble crossing (sim/signals.js): an all-walk phase, and no right turn on red.
function scrambleClause(i) {
  const sc = i.scramble,
    right = i.turn === "right";
  if (sc.phase !== "dont")
    return `This junction is a scramble crossing, and its all-walk is on: every light is red, and people are crossing every way, diagonally too, for the next ${Math.round(sc.ends_in_s)} s. Wait at the line until the car's own light turns green, and then let anyone still crossing clear the car's path.`;
  return `This junction is a scramble crossing: every light turns red together while people cross every way${right ? ", and there is no right turn on red here: wait at the line for the green, even to turn right" : ", and nobody walks alongside a green"}.`;
}
