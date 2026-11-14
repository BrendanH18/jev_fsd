// The unprotected left: a left turn on a plain green (shared/kit.js oncomingSites). The car starts
// 70 m before its line; once it is 45 m from it, two oncoming cars set off (releaseOncoming).
import { ONCOMING_TRIGGER_M, laneScenario, oncomingSites, pick, reach, releaseOncoming, stepAuthored } from "./shared/kit.js";

export const challenge = { id: "unprotected-left", title: "The unprotected left", map: "ottawa", weather: "dry", time: "afternoon", seed: 7042, icon: "↰", difficulty: "Judgement", hazard: "oncoming",
  description: "A left turn on a green in Centretown, with two oncoming cars close together. Wait for a gap you can use.", lesson: "Oncoming traffic has the right of way. Pull into the junction, wait, and turn once the gap is long enough." };

export const scenario = (map, challenge) => laneScenario(map, challenge, (map, challenge, random) => {
  const left = pick(oncomingSites(map), random, "This map has no signalled left turn with oncoming traffic.");
  return { lane: left.lane, startS: left.lane.edgeRef.control.s_line - 70, through: [map.lane(left.left, 0)],
    fields: { oncoming: { edge: left.opposite, then: left.straight } } };
});

export const step = (world, fleet) => stepAuthored(world, fleet, {
  trigger: reach(ONCOMING_TRIGGER_M),
  release: (world, fleet, state) => { state.oncomingIds = releaseOncoming(world, fleet, state.oncoming); },
});
