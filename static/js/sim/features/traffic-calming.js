import { calmingNotice } from "../traffic-calming.js";
import { r1 } from "../../common.js";
import { CALM_EARLY_M, HIT_OVER_MPS, calmingAhead, deviceOf, pathCalmLimit, slowsFor } from "../traffic-calming.js";
import { comfort } from "../vehicle.js";
import { current as weather } from "../weather.js";

// The speed to cross a speed hump or the like at (see traffic_calming), and short of it, the speed
// from which the car slows to it comfortably by CALM_EARLY_M before it; in poor weather, no faster than
// the weather allows.
function calmingSpeed(tc) {
  const lim = tc.speed_mps * Math.min(weather.speed, 1);
  return tc.over ? lim : Math.sqrt(lim * lim + 2 * comfort().decel * 0.6 * Math.max(0, tc.starts_in_m - CALM_EARLY_M));
}

// Crossing a speed hump, table, cushion or bump with the front axle faster than its speed plus
// HIT_OVER_MPS is a hard hit (sim/traffic-calming.js): counted once a device a crossing, going
// forward over it.
function auditCalming(world) {
  const ego = world.ego,
    near = world.map.calmingGrid?.get(`${Math.floor(ego.x / 20)},${Math.floor(ego.y / 20)}`) || [];
  const axle = ego.spec.wheelbase,
    seen = new Set();
  for (const { device, h, w } of near) {
    const dx = device.x - ego.x,
      dy = device.y - ego.y,
      c = Math.cos(ego.psi),
      sn = Math.sin(ego.psi);
    const ahead = dx * c + dy * sn,
      across = Math.abs(dx * sn - dy * c);
    // (on the street, going along it, not across it)
    if (across > w + 1 || Math.abs(Math.cos(ego.psi - h)) < 0.7) continue;
    seen.add(device.id);
    const before = world.calmingAxle.get(device.id);
    world.calmingAxle.set(device.id, ahead - axle);
    if (before === undefined || !(before > 0 && ahead - axle <= 0) || ego.v <= 0) continue;
    world.calmingSeen = true;
    if (slowsFor(ego.spec, device) && ego.v > deviceOf(device).mps + HIT_OVER_MPS) {
      world.violations.hump_hits = (world.violations.hump_hits || 0) + 1;
      world.events.push({ type: "hump_hit", device: device.id, kind: device.kind, kmh: Math.round(ego.v * 36) / 10 });
    }
  }
  for (const id of world.calmingAxle.keys()) if (!seen.has(id)) world.calmingAxle.delete(id);
}

export default {
  key: "calming",
  view: () => import("../../render/traffic-calming.js"),
  coach: {
    init: () => ({
      humpHits: 0,
      calmed: false,
    }),
    seen: "calmed",
    events: {
      hump_hit(score, ev) {
        score.humpHits++;
        score.incident(
          "hump_hit",
          `Took a ${ev.kind === "table" ? "speed table" : `speed ${ev.kind}`} at ${Math.round(ev.kmh)} km/h`,
          { device: ev.device, kmh: ev.kmh },
        );
      },
    },
    reports: [{ at: "end", order: 4, read: (score) => (score.calmed ? { hump_hits: score.humpHits } : {}) }],
    deductions: [{ at: "comfort", order: 0, counter: "humpHits", weight: 8 }],
    tips: [
      {
        at: "afterBusLanes",
        order: 1,
        when: (score) => score.humpHits,
        text: "Slow right down for speed humps: 30 km/h for a hump or a cushion, 40 for a speed table and a crawl for a bump. Brake before it, not on it, and keep to that speed until the rear wheels are over.",
      },
    ],
  },
  notice: {
    at: "beforeLeftOnRed",
    order: 13,
    duration: 2000,
    read: (world) => calmingNotice(world),
    style: (line) => (line.slow ? "safety" : ""),
  },
  perceptionLine(snap) {
    const tc = snap.traffic_calming;
    const text = tc
      ? `${tc.name[0].toUpperCase()}${tc.name.slice(1)} ${tc.over ? "under the car" : `${Math.round(Math.max(0, tc.starts_in_m))} m ahead`}: ${Math.round(tc.speed_mps * 3.6)} km/h`
      : null;
    return text ? { order: 15, label: "Traffic calming", text } : null;
  },
  seen: "calmingSeen",
  calls: "calmingAxle",
  snapshot: { traffic_calming: null },
  build: (_world, { enabled }) => !!enabled,
  audit: {
    at: "afterCalming",
    run(world) {
      if (world.calming) auditCalming(world);
    },
  },
  sense: {
    at: "afterCalming",
    run(world, snap) {
      if (!world.calming || !snap.route || !snap.routeProj) return;
      const spec = world.ego.spec;
      const c = calmingAhead(snap.route, snap.routeProj.s, snap.ego.front_m, spec.rearOverhang);
      if (!c || !slowsFor(spec, c)) return;
      snap.traffic_calming = c;
      snap.limit = Math.min(snap.limit, calmingSpeed(c));
    },
  },
  target: {
    at: "beforeRoadside",
    run(snap, v, reasons) {
      const c = snap.traffic_calming;
      if (!c) return v;
      const ceiling = calmingSpeed(c);
      if (ceiling < v + 0.05) {
        reasons.push(c.over ? `over a ${c.name}` : `${c.name} ahead`);
        return Math.min(v, ceiling);
      }
      return v;
    },
  },
  trafficSpeed: {
    at: "ordinary",
    run(world, n, front) {
      return world.calming && world.map.calmingSpans?.size
        ? pathCalmLimit(world.map, n.path, front, n.spec, n.spec.rearOverhang, weather.speed)
        : Infinity;
    },
  },
  state: {
    at: "afterCalming",
    run(snap, state) {
      if (snap.traffic_calming) {
        const c = snap.traffic_calming;
        state.traffic_calming = {
          kind: c.name,
          speed: r1(c.speed_mps),
          ...(c.over ? { over: true } : { starts_in_m: r1(Math.max(0, c.starts_in_m)) }),
        };
      }
    },
  },
  clause: {
    at: "afterCalming",
    run(snap) {
      if (!snap.traffic_calming) return null;
      const c = snap.traffic_calming,
        kmh = Math.round(c.speed_mps * 3.6);
      return c.over
        ? `The car is going over a ${c.name}: keep to ${kmh} km/h until its rear wheels are over it (\`car.target_speed\` already does).`
        : `A ${c.name} lies across the street ${Math.round(Math.max(0, c.starts_in_m))} m ahead: slow to ${kmh} km/h by the time the car reaches it, and keep to that over it; taken faster it jolts the car and everyone in it. \`car.target_speed\` already does.`;
    },
  },
  prompt: {
    at: "afterGlare",
    text: `- Coming up to a speed hump, speed table, speed cushion or speed bump (\`traffic_calming\`), slow to \`traffic_calming.speed\` by the time the car reaches it, and keep to that over it: prefer a candidate whose \`end_speed\` is at or below \`car.target_speed\`.`,
  },
  metric: {
    at: "afterRestrictions",
    name: "hump_hits",
    failure: "took a speed hump too fast",
    label: "Took a speed hump too fast",
    category: "speed",
    eventType: "hump_hit",
  },
};
