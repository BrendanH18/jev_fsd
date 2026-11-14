// School zone: the car starts 4 m into a street that is a school zone (in effect at the challenge's
// time) with a higher limit of its own and a parking lane on the right, and a child waits at the
// curb 85 m on, between two parked cars, with at least 40 m of zone before them and no stop line
// within 30 m after. Once the car's front is 15 m from them they run out across the street: at
// 30 km/h the car stops short of them, at the street's 50 it cannot.
import { pointAt, headingAt } from "../../map/mapdata.js";
import { Vehicle } from "../../sim/vehicle.js";
import { Pedestrian } from "../../sim/pedestrians.js";
import { ZONE_LIMIT_MPS } from "../../sim/speed-zones.js";
import { frontWithin, laneScenario, pick, releasePedestrian, stepAuthored } from "./shared/kit.js";

export const challenge = { id: "school-zone", title: "School zone", map: "kitsilano", weather: "dry", time: "morning", seed: 16042, icon: "◭", difficulty: "Anticipation", hazard: "school-zone", street: "West 11th Avenue",
  description: "West 11th Avenue past Lord Tennyson Elementary, at 9 in the morning. The street's limit is 50 km/h, but this block is a school zone, and the cars parked along it hide the curb.", lesson: "In BC a school zone's 30 km/h holds from 8:00 to 17:00 on school days, and a playground zone's from dawn to dusk every day. At 30 km/h a car stops in about a third of the distance it needs at 50, so a child running out between parked cars can be missed." };

const ZONE_START_M = 4, CHILD_AT_M = 85, CHILD_ZONE_BEFORE_M = 40, CHILD_TRIGGER_M = 15, CHILD_MPS = 2.4;
const zoneSiteCache = new WeakMap();
function zoneSites(map, street) {
  if (!zoneSiteCache.has(map)) {
    const sites = [];
    for (const lane of map.laneList) {
      const e = lane.edgeRef, hazard = ZONE_START_M + CHILD_AT_M;
      if (e.ring || lane.idx !== e.lanes - 1 || !(e.parking?.[1] > 0) || e.limit <= ZONE_LIMIT_MPS + 1) continue;
      if (e.control && e.control.s_line < hazard + 30) continue;
      const span = (map.zoneSpans.get(e.id) || []).find((x) => x.zone.kind === "school" && x.from <= Math.min(ZONE_START_M, hazard - CHILD_ZONE_BEFORE_M) && x.to >= hazard + 10);
      if (!span) continue;
      const scale = lane.length / Math.max(1, e.length);
      sites.push({ lane, startS: ZONE_START_M * scale, hazardS: hazard * scale, zone: span.zone.id });
    }
    sites.sort((a, b) => String(a.lane.edge).localeCompare(String(b.lane.edge)));
    zoneSiteCache.set(map, sites);
  }
  const sites = zoneSiteCache.get(map), on = sites.filter((s) => s.lane.edgeRef.name === street);
  return on.length ? on : sites;
}

export const scenario = (map, challenge) => laneScenario(map, challenge, (map, challenge, random) => {
  const zone = pick(zoneSites(map, challenge.street), random, "This map has no school zone on a street with a parking lane and a higher limit of its own.");
  return { lane: zone.lane, startS: zone.startS, fields: { child: { s: zone.hazardS, zone: zone.zone } } };
});

// Two cars parked 11 m apart (centre to centre) in the parking lane, and a child at the curb between
// them, who will run straight across the street to the far curb without looking (`dart`: unlike the
// crowd, they do not wait for a car that could not stop for them).
function placeChild(world, lane, s, seed) {
  const e = lane.edgeRef, p = pointAt(lane.pts, lane.cum, s), psi = headingAt(lane.pts, lane.cum, s);
  const off = (q, right) => [q[0] + Math.sin(psi) * right, q[1] - Math.cos(psi) * right];
  const ep = pointAt(e.pts, e.cum, s * e.cum.at(-1) / Math.max(1, lane.length));
  const laneOffset = (p[0] - ep[0]) * Math.sin(psi) - (p[1] - ep[1]) * Math.cos(psi);
  const curb = e.asphalt[1] - laneOffset, parked = curb - (e.parking[1] || 2.1) / 2;
  [-5.5, 5.5].forEach((ds, i) => {
    const q = off(pointAt(lane.pts, lane.cum, s + ds), parked), car = new Vehicle(q[0], q[1], psi, 0);
    Object.assign(car, { id: `challenge_parked_${i + 1}`, color: i ? 0x6b7f8c : 0xc9c3b6, curb: "right", edge: lane.edge });
    world.parked.add(car);
  });
  const from = off(p, curb - 0.4), to = off(p, e.asphalt[0] - laneOffset + 0.4);
  const ped = new Pedestrian({ id: "challenge_child", x: from[0], y: from[1], psi: psi + Math.PI / 2, v: 0, speed: CHILD_MPS, child: true, dart: true,
    path: [{ p: to, cross: { node: null, from, to, jaywalk: true } }], crossing: null, waiting: 0, phase: 0, look: seed, at: null });
  ped.frozen = 1e6;
  world.crowd.list.push(ped);
  return { pedestrianId: ped.id };
}

export function install(world, fleet, challenge, scenario, at) {
  Object.assign(world.challenge, placeChild(world, at.lane, scenario.child.s, challenge.seed));
}

export const step = (world, fleet) => stepAuthored(world, fleet, {
  trigger: frontWithin(CHILD_TRIGGER_M),
  release: (world, fleet, state) => releasePedestrian(world, state),
});
