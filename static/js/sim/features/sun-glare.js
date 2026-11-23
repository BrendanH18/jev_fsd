import { sunGlareNotice } from "../sun-glare.js";
import { r1 } from "../../common.js";
import {
  GLARE_SPEEDING_THRESHOLD_S,
  auditSunGlare,
  glareRange,
  npcGlareCeiling,
  sunGlareSensing,
} from "../sun-glare.js";

export default {
  key: "sunGlare",
  coach: {
    init: () => ({
      glareSpeeding: 0,
      sunGlareSeen: false,
    }),
    observe(score, world) {
      if (world.sunGlareSeen) {
        score.sunGlareSeen = true;
        score.glareSpeeding = Math.max(
          0,
          (world.violations.glare_speeding_seconds || 0) - (score.baseline.glare_speeding_seconds || 0),
        );
      }
      if (score.glareSpeeding > 1 && !score.sunGlareRecorded) {
        score.sunGlareRecorded = true;
        score.incident("sun_glare", "Drove too fast to stop within sight in sun glare");
      }
    },
    reports: [
      {
        at: "end",
        order: 1,
        read: (score, round) => (score.sunGlareSeen ? { glare_speeding_seconds: round(score.glareSpeeding, 2) } : {}),
      },
    ],
    deductions: [{ at: "safety", order: 4, counter: "glareSpeeding", weight: 3 }],
    tips: [
      {
        at: "afterFollowing",
        order: 1,
        when: (score) => score.glareSpeeding > 1,
        text: "When the sun is in your eyes, slow down to what you can see, leave more room, and look for signals and people early.",
      },
    ],
  },
  notice: {
    at: "beforeLeftOnRed",
    order: 14,
    duration: 2500,
    read: (world) => sunGlareNotice(world),
    style: (line) => (line.slow ? "safety" : ""),
  },
  seen: "sunGlareSeen",
  day: true,
  utcOffset: true,
  build(world, { enabled }) {
    world.sunGlareCall = null;
    if (enabled) world.visibility.glare = (observer, x, y) => glareRange(world, observer, x, y);
    return { enabled: !!enabled };
  },
  audit: {
    at: "beforeCollisions",
    run(world, dt) {
      if (world.sunGlare.enabled) auditSunGlare(world, dt);
    },
  },
  sense: {
    at: "afterCalming",
    run(world, snap) {
      if (world.sunGlare.enabled) {
        snap.sun_glare = sunGlareSensing(world);
        if (snap.sun_glare) snap.limit = Math.min(snap.limit, snap.sun_glare.ceiling_mps);
      }
    },
  },
  target: {
    at: "beforeCurve",
    run(snap, v, reasons) {
      const ceiling = snap.sun_glare?.ceiling_mps;
      if (ceiling <= v + 0.05) {
        reasons.push("sun glare");
        return Math.min(v, ceiling);
      }
      return v;
    },
  },
  trafficSpeed: {
    at: "ordinary",
    run: (world, n) => (world.sunGlare.enabled && n.kind !== "bike" ? npcGlareCeiling(world, n) : Infinity),
  },
  state: {
    at: "afterCalming",
    run(snap, state) {
      if (snap.sun_glare) {
        const g = snap.sun_glare;
        state.sun_glare = {
          severity: g.severity,
          sight_m: g.sight_m,
          speed_ceiling: r1(g.ceiling_mps),
          sun_elevation_deg: g.sun_elevation_deg,
          sun_off_heading_deg: g.off_heading_deg,
        };
      }
    },
  },
  clause: {
    at: "afterCalming",
    run(snap) {
      const g = snap.sun_glare;
      if (!g) return null;
      const kmh = Math.round(g.ceiling_mps * 3.6);
      return `The car is driving into a low sun (${g.sun_elevation_deg}° above the horizon, ${g.off_heading_deg}° off its heading): glare washes out signals and people ahead, so the car sees only about ${g.sight_m} m that way. Keep to ${kmh} km/h or less, the speed it can stop from within that, and look for signals and people early (\`car.target_speed\` already does): prefer a candidate whose \`end_speed\` is at or below it, and leave more room.`;
    },
  },
  prompt: {
    at: "afterBusLanes",
    text: `- Driving into a low sun (\`sun_glare\`), glare hides signals and people ahead beyond \`sun_glare.sight_m\`: keep to \`sun_glare.speed_ceiling\` or less, the speed the car can stop from within that sight. Prefer a candidate whose \`end_speed\` is at or below \`car.target_speed\`, leave more room, and treat a signal or crossing not yet seen as one that may need a stop.`,
  },
  metric: {
    at: "afterHeadlights",
    name: "glare_speeding_seconds",
    failure: "too fast for sun glare",
    label: "Drove too fast to stop within sight in sun glare",
    category: "speed",
    decimals: 2,
    threshold: GLARE_SPEEDING_THRESHOLD_S,
    traceType: "sun_glare",
  },
};
