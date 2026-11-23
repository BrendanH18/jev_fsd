import { r1 } from "../common.js";

// A van double-parked in the car's lane ahead (sim/double-parked.js).
function vanClause(d) {
  const w = d.way,
    at = Math.max(0, Math.round(d.bumper_to_stop_m)),
    kmh = Math.round(d.limit_mps * 3.6);
  const where = d.gap_m > 0 ? `${Math.round(d.gap_m)} m ahead` : "beside the car",
    it = d.truck ? "the truck" : "the van";
  const lead = d.truck
    ? `A ${d.kind} (\`${d.van_id}\`) is stopped in the car's lane ${where}, its hazard lights flashing, while its crew empties the bins: they walk between its rear and the kerbs, now and then across the street behind it. The only way past is round it through the oncoming lane, and oncoming traffic has the right of way: go round only when the oncoming lane is clear for the whole way round and back, and none of the crew is out in the street.`
    : `A ${d.kind} (\`${d.van_id}\`) is double-parked in the car's lane ${where}, its hazard lights flashing. The only way past is round it through the oncoming lane, and oncoming traffic has the right of way: go round only when the oncoming lane is clear for the whole way round and back.`;
  const round = ` The car's candidates then take it round ${it} through the oncoming lane and back into its own lane past it.`;
  if (d.going_round)
    return `${lead} The car has started round it: carry on round at no more than ${kmh} km/h (\`car.target_speed\` already does), and back into its own lane past it.`;
  const stop =
    at < 2
      ? "Hold still where the car is."
      : `Slow down and stop ${at} m ahead, back far enough to pull out round it${d.truck ? " and clear of the crew at its rear" : ""} (\`wait_behind_van\`).`;
  if (d.queued) return `${lead} \`${d.queued}\` is waiting behind it ahead of the car: wait in turn behind it. ${stop}`;
  if (!w.clear) {
    const why = d.crew_in_road
      ? `\`${d.crew_in_road}\`, one of its crew, is out in the street`
      : w.oncoming
        ? `\`${w.oncoming.id}\`, coming the other way, would get there in ${Math.round(w.oncoming.eta_s)} s, and the car needs ${Math.round(w.need_s)} s to get round`
        : "the car cannot see far enough along the oncoming lane to know it is clear";
    return `${lead} It is not clear now: ${why}. Wait behind ${it} until it is. ${stop}${round}`;
  }
  return `${lead} The oncoming lane is clear for the whole way round now: go round it at no more than ${kmh} km/h (\`car.target_speed\` already does).${round}`;
}

export const doubleParkedModel = {
  flagText: { no_room_to_go_round: "it goes round the double-parked van without room in the oncoming lane" },
  state: {
    at: "parking",
    run(snap, state) {
      if (snap.double_parked) {
        const d = snap.double_parked,
          w = d.way;
        state.double_parked = {
          id: d.van_id,
          kind: d.kind,
          ...(d.truck ? { truck: true } : {}),
          hazards: true,
          ...(d.gap_m > 0 ? { gap_m: r1(d.gap_m) } : { beside_car: true }),
          way_round: d.going_round
            ? "car is going round"
            : w.clear
              ? "clear"
              : d.crew_in_road
                ? "its crew is in the road"
                : !w.sees_far_enough
                  ? "cannot see far enough"
                  : "oncoming traffic",
          ...(d.crew_in_road && !d.going_round ? { crew_in_road: d.crew_in_road } : {}),
          ...(w.oncoming && !d.going_round
            ? { oncoming: { id: w.oncoming.id, arrives_in_s: r1(w.oncoming.eta_s) }, needs_s: r1(w.need_s) }
            : {}),
          ...(d.queued ? { waiting_ahead: d.queued } : {}),
          pass_at: r1(d.limit_mps),
          ...(d.wait ? { stop: true, wait_in_m: r1(Math.max(0, d.bumper_to_stop_m)) } : { go_round: true }),
        };
      }
    },
  },
  outcome: {
    at: "ids",
    run(c, snap) {
      if (c.id === "wait_behind_van" && snap.double_parked)
        return `clear, stops ${Math.max(0, r1(snap.double_parked.bumper_to_stop_m - c.sim.progress_m))} m short of where the car waits behind the double-parked van`;
      return null;
    },
  },
  clause: {
    at: "parking",
    run: (snap) => (snap.double_parked ? vanClause(snap.double_parked) : null),
  },
  motion: (snap) => snap.double_parked?.wait,
  holdStill: {
    at: "parking",
    run: (snap) =>
      snap.double_parked?.wait
        ? ", when a van is double-parked in the car's lane ahead, the oncoming lane is not clear to go round it, and the car has stopped behind it (`double_parked.wait_in_m` under 2)"
        : "",
  },
  prompt: {
    at: "parking",
    text: `- Choose \`wait_behind_van\` when \`situation\` says a van double-parked in the car's lane ahead cannot be gone round yet: stop behind it, and keep the car stopped there until \`situation\` says the oncoming lane is clear for the whole way round. Then the car's candidates already take it round the van through the oncoming lane; carry on round once started.`,
  },
};
