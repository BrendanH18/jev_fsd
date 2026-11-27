// High-beam headlights (sim/high-beams.js) as a feature record (sim/features/index.js,
// docs/feature-interface.md).
import { GLARE_THRESHOLD_S, auditHighBeams, beamChoice, headlights, wellLit } from "../high-beams.js";

export default {
  key: "highBeams",
  view: () => import("../../render/high-beams.js"),
  coach: {
    init: () => ({
      glareSeconds: 0,
      highBeamsSeen: false,
    }),
    observe(score, world) {
      if (world.highBeamsSeen) {
        score.highBeamsSeen = true;
        score.glareSeconds = Math.max(0, (world.violations.glare_seconds || 0) - (score.baseline.glare_seconds || 0));
      }
      if (score.glareSeconds > 0.8 && !score.glareRecorded) {
        score.glareRecorded = true;
        score.incident("glare", "Failed to dip high beams");
      }
    },
    reports: [
      {
        at: "end",
        order: 0,
        read: (score, round) => (score.highBeamsSeen ? { glare_seconds: round(score.glareSeconds, 2) } : {}),
      },
    ],
    deductions: [{ at: "safety", order: 2, counter: "glareSeconds", weight: 5 }],
    tips: [
      {
        at: "afterFollowing",
        order: 0,
        when: (score) => score.glareSeconds > 0.8,
        text: "Dip high beams for oncoming and leading vehicles, fog and snow.",
      },
    ],
  },
  seen: "highBeamsSeen",
  build: (_world, { enabled }) => !!enabled,
  metric: {
    at: "headlights",
    name: "glare_seconds",
    failure: "failed to dip high beams",
    label: "Failed to dip high beams",
    category: "right_of_way",
    decimals: 2,
    threshold: GLARE_THRESHOLD_S,
    traceType: "glare",
  },

  visionRange(world, observer) {
    return !!(
      world.highBeams &&
      observer === world.ego &&
      observer.highBeam &&
      world.visibility.night > 0.5 &&
      world.weather !== "fog" &&
      world.weather !== "snow" &&
      !wellLit(world)
    );
  },
  audit: {
    at: "beforeCollisions",
    run(world, dt) {
      if (world.highBeams) auditHighBeams(world, dt);
    },
  },
  sense(world, snap) {
    if (world.highBeams) snap.headlights = headlights(world, world.ego, undefined, 25);
  },

  state: {
    at: "afterFollowing",
    run(snap, state) {
      if (snap.headlights) state.headlights = { ...snap.headlights };
    },
  },
  questions(snap, questions) {
    if (snap.headlights)
      questions.headlights = {
        type: "choice",
        instructions: "Which headlight beam should the car use now?",
        criteria: {
          high: "Use high only when headlights.high_allowed is true: a dark unlit street, no fog or snow, no oncoming vehicle within 150 m and no leading vehicle within 60 m. The observation includes a safety margin for the next decision.",
          low: "Use low when headlights.high_allowed is false: daylight, a lit street, fog or snow, or another road user within the dip distance.",
        },
      };
  },
  prompt: {
    at: "headlights",
    text: "When headlights is present, answer headlights with high only when headlights.high_allowed is true; otherwise low. Dip for oncoming traffic within 150 m, following within 60 m, fog, snow and lit streets.",
  },
  decisionFields: (snap) => (snap.headlights ? { headlights: beamChoice(snap) } : null),
};
