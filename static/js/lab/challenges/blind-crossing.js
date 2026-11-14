// Around the corner: a person steps out from behind a mapped building and walks across the street.
// They are hidden from the car 43 m back and in view from 20 m, and walk once the car is 43 m away.
import { pointAt, headingAt } from "../../map/mapdata.js";
import { Visibility } from "../../sim/visibility.js";
import { laneScenario, pick, placeCrossingPedestrian, releasePedestrian, stepAuthored } from "./shared/kit.js";

export const challenge = { id: "blind-crossing", title: "Around the corner", map: "kitsilano", weather: "dry", time: "afternoon", seed: 6042, icon: "◧", difficulty: "Sight lines", hazard: "occluded-pedestrian",
  description: "A person emerges from behind a mapped building. Your view opens as you approach.", lesson: "Leave stopping room when a building blocks your view of the sidewalk." };

const blindSites = new WeakMap();
function occludedCrossings(map, lanes) {
  if (blindSites.has(map)) return blindSites.get(map);
  const visibility = new Visibility(map), sites = [];
  for (const lane of lanes) {
    for (let s = 85; s < lane.length - 25; s += 5) {
      const p = pointAt(lane.pts, lane.cum, s), psi = headingAt(lane.pts, lane.cum, s);
      const offset = right => [p[0] + Math.sin(psi) * right, p[1] - Math.cos(psi) * right];
      const far = pointAt(lane.pts, lane.cum, s - 43), near = pointAt(lane.pts, lane.cum, s - 20);
      for (const right of [6, -6, 8, -8, 10, -10]) {
        const from = offset(right), to = offset(-Math.sign(right) * 6);
        // The entire person starts hidden, becomes visible on approach, and has a clear crossing path.
        if (![right - 0.25, right, right + 0.25].every(r => visibility.occluded(far, offset(r)))
          || visibility.occluded(near, from) || visibility.occluded(from, to)) continue;
        sites.push({ lane, hazardS: s, from, to });
        break;
      }
    }
  }
  blindSites.set(map, sites); return sites;
}

export const scenario = (map, challenge) => laneScenario(map, challenge, (map, challenge, random, lanes) => {
  const site = pick(occludedCrossings(map, lanes), random, "This map has no clear crossing with a building-obstructed approach.");
  return { lane: site.lane, startS: site.hazardS - 65, fields: { crossing: { hazardS: site.hazardS, from: site.from, to: site.to } } };
});

export function install(world, fleet, challenge, scenario, at) {
  placeCrossingPedestrian(world, challenge, scenario, at);
}

export const step = (world, fleet) => stepAuthored(world, fleet, { release: (world, fleet, state) => releasePedestrian(world, state) });
