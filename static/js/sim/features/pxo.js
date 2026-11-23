// Ontario pedestrian crossovers (sim/pxo.js) as a feature record (sim/features/index.js,
// docs/feature-interface.md).
import { auditPxo, ontarioMap, pxoAhead } from "../pxo.js";

export default {
  rulesStop: (snap) => !!(snap.pxo?.bumper_to_crosswalk_m < 3.5),
  cautious: {
    at: "afterBusLanes",
    run: (snap, eligible) =>
      snap.pxo?.bumper_to_crosswalk_m < 3.5 ? eligible.find((c) => c.id === "stop_for_pedestrian") : null,
  },
  key: "pxo",
  coach: {
    init: () => ({
      pxoUsed: false,
      pxoEarlyGoes: 0,
    }),
    seen: "pxoUsed",
    events: {
      pxo_early_go(score) {
        score.pxoEarlyGoes++;
        score.incident("pxo_early_go", "Left a pedestrian crossover before everyone reached the far curb");
      },
    },
    reports: [{ at: "end", order: 2, read: (score) => (score.pxoUsed ? { pxo_early_goes: score.pxoEarlyGoes } : {}) }],
    deductions: [{ at: "safety", order: 1, counter: "pxoEarlyGoes", weight: 20 }],
    tips: [
      {
        at: "afterFollowing",
        order: 2,
        when: (score) => score.pxoEarlyGoes,
        text: "At an Ontario pedestrian crossover, stay stopped until everyone has reached the far curb across the whole roadway.",
      },
    ],
  },
  buildAt: "early",
  seen: "pxoSeen",
  calls: "pxoLines",
  build: (_world, { enabled, map }) => !!enabled && ontarioMap(map),
  metric: {
    at: "pxo",
    name: "pxo_early_goes",
    failure: "left a pedestrian crossover before the far curb",
    label: "Left a pedestrian crossover before the far curb",
    category: "right_of_way",
    eventType: "pxo_early_go",
  },

  audit: {
    at: "afterCalming",
    run(world) {
      if (world.pxo) auditPxo(world);
    },
  },
  sense: {
    at: "afterPedestrians",
    run(world, snap, { frontS }) {
      if (!world.pxo) return;
      const pxo = pxoAhead(world, frontS);
      if (pxo) {
        snap.pxo = pxo;
        const d = pxo.bumper_to_crosswalk_m;
        if (!snap.pedestrian || d < snap.pedestrian.bumper_to_crosswalk_m)
          snap.pedestrian = {
            id: pxo.pedestrian_ids[0],
            bumper_to_crosswalk_m: d,
            s_route: pxo.stop_s_route + 2,
            to_path_m: 0,
            speed: 0,
          };
      }
    },
  },

  state: {
    at: "afterFollowing",
    run(snap, state) {
      if (snap.pxo)
        state.pxo = {
          crossing: snap.pxo.id,
          occupied: true,
          wait_until: "everyone reaches the far curb across the whole roadway",
        };
    },
  },
  handlesPedestrian: (snap) => !!snap.pxo,
  clause: {
    at: "afterClosure",
    run: (snap) =>
      snap.pxo
        ? `An Ontario pedestrian crossover (PXO), with amber warning beacons rather than a traffic signal, is ${Math.max(0, Math.round(snap.pxo.bumper_to_crosswalk_m))} m ahead. Stop 2 m short of its centre (stop_for_pedestrian), and stay stopped until EVERY pedestrian has crossed the WHOLE roadway and reached the far curb, even after your lane clears. The beacons alone do not decide when to go.`
        : null,
  },
  prompt: {
    at: "pedestrian",
    inline: true,
    text: " At an Ontario pedestrian crossover (PXO), remain stopped until every pedestrian reaches the far curb across the whole roadway, even after the car’s lane clears.",
  },
};
