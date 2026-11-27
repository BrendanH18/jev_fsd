import { rng } from "../../common.js";
import { CREW_CLEAR_M, CREW_PASS_MPS, CollectionTrucks, TRUCK_NAME, crewNear, isTruck } from "../collection-truck.js";
import { PED } from "../pedestrians.js";

export default {
  key: "collection",
  view: () => import("../../render/collection-truck.js"),
  coach: {
    init: () => ({
      crewPasses: 0,
      collected: false,
    }),
    seen: "collected",
    events: {
      crew_close_pass(score, ev) {
        score.crewPasses++;
        score.incident("crew_close_pass", "Passed a garbage crew worker too close", {
          worker: ev.worker,
          clearance_m: ev.clearance_m,
          kmh: ev.kmh,
        });
      },
    },
    reports: [
      { at: "end", order: 5, read: (score) => (score.collected ? { crew_close_passes: score.crewPasses } : {}) },
    ],
    deductions: [{ at: "safety", order: 0, counter: "crewPasses", weight: 20 }],
    tips: [
      {
        at: "afterFollowing",
        order: 3,
        when: (score) => score.crewPasses,
        text: "Behind a garbage truck at work, wait well back while its crew is in the street, and go round only when they are at the kerb and the oncoming lane is clear, slowly, with room to spare.",
      },
    ],
  },
  property: "crewPassed",
  defaultCount: 1,
  seen: "collectionSeen",
  build: () => new Set(),
  buildFleet: (fleet, { enabled, seed, makePath }) =>
    new CollectionTrucks(fleet, { count: enabled, random: rng(seed * 141650939 + 43), makePath }),
  metric: {
    at: "afterCalming",
    name: "crew_close_passes",
    failure: "passed a garbage crew worker too close",
    label: "Passed a garbage crew worker too close",
    category: "space",
    eventType: "crew_close_pass",
  },
  prompt: {
    at: "afterParking",
    text: `- A garbage truck stopped in the car's lane (\`double_parked\` with \`truck\`) is gone round the same way, and also only once none of its crew is out in the street (\`double_parked.crew_in_road\`): until then choose \`wait_behind_van\`. Behind one on the move, follow it: it is about to stop again.`,
  },
  obstacle: {
    test: (vehicle) => isTruck(vehicle),
    traffic: true,
    long: true,
    parkedClearance: (vehicle) => !!vehicle.collect,
    noParking: (vehicle) => !!vehicle.collect,
    get label() {
      return TRUCK_NAME;
    },
  },
  trafficManage: {
    at: "afterPlows",
    run(_world, fleet, dt) {
      const collection = fleet.collection;
      if (collection.trucks.length || collection.target) collection.manage(dt);
    },
  },
  trafficManeuver: {
    at: "beforeSpecial",
    run(_world, fleet, n, dt) {
      if (n.collect?.phase !== "work" || !fleet.collection.work(n, dt)) return false;
      n.a = 0;
      return true;
    },
  },
  trafficStop(_world, fleet, n, front, dt) {
    if (!n.collect) return null;
    const stop = fleet.collection.plan(n, front, dt);
    return stop === "work" ? 0.05 : stop;
  },
  audit: {
    at: "afterCalming",
    run(world) {
      const { ego, crewPassed } = world;
      if (!world.collectionSeen || ego.v <= CREW_PASS_MPS) return;
      const front = ego.spec.length - ego.spec.rearOverhang,
        rear = ego.spec.rearOverhang,
        half = ego.spec.width / 2;
      for (const p of crewNear(world, ego.x, ego.y, 12)) {
        if (crewPassed.has(p.id) || p.frozen > 0) continue;
        const l = ego.toLocal(p.x, p.y),
          dx = Math.max(0, -rear - l.ahead, l.ahead - front),
          dy = Math.max(0, Math.abs(l.right) - half);
        const clear = Math.hypot(dx, dy) - PED.width / 2;
        if (clear >= CREW_CLEAR_M) continue;
        crewPassed.add(p.id);
        world.violations.crew_close_passes = (world.violations.crew_close_passes || 0) + 1;
        world.events.push({
          type: "crew_close_pass",
          worker: p.id,
          truck: p.truck,
          clearance_m: Math.round(Math.max(0, clear) * 10) / 10,
          kmh: Math.round(ego.v * 36) / 10,
        });
      }
    },
  },
  checkpoint(world, fleet) {
    if (!fleet.collection) return;
    fleet.collection.world = world;
    fleet.collection.fleet = fleet;
  },
};
