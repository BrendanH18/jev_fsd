// Deliberately limited to the bundled Canadian map regions. Unknown regions fail closed.
import { turnBanned } from "./turn-restrictions.js";
import { redTurnBanned } from "./red-turn-signs.js";
// Centres of the supported packs must lie in these reviewed city regions. A new map needs
// its jurisdiction checked before adding it; never guess a province across the Ottawa River.
const REGIONS = [
  [-123.17, 49.26, -123.15, 49.27],       // BC: Kitsilano
  [-123.112, 49.257, -123.094, 49.268],   // BC: Mount Pleasant
  [-123.374, 48.419, -123.357, 48.432],   // BC: Victoria
  [-114.087, 51.034, -114.063, 51.045],   // Alberta: Calgary
  [-113.512, 53.513, -113.488, 53.523],   // Alberta: Edmonton
  [-106.672, 52.117, -106.65, 52.131],    // Saskatchewan: Saskatoon
  [-97.15, 49.892, -97.131, 49.903],      // Manitoba: Winnipeg
  [-79.412, 43.66, -79.394, 43.671],      // Ontario: Toronto
  [-75.708, 45.407, -75.687, 45.421],     // Ontario: Ottawa
  [-63.59, 44.64, -63.57, 44.652],        // Nova Scotia: Halifax
];
export function leftOnRedRegion(bbox) {
  if (!Array.isArray(bbox) || bbox.length !== 4) return false;
  const x = (bbox[0] + bbox[2]) / 2, y = (bbox[1] + bbox[3]) / 2;
  return REGIONS.some(([w, south, east, north]) => x >= w && x <= east && y >= south && y <= north);
}
// Geometry and signs only; the shared turn-on-red machinery checks stops, pedestrians and gaps.
export function leftOnRedAllowed(world, from, to) {
  if (!world.leftOnRed || !leftOnRedRegion(world.map.routingBbox)) return false;
  const map = world.map, a = map.edges.get(from), b = map.edges.get(to);
  return !!(a?.oneway && b?.oneway && !a.control?.no_left_on_red && !a.no_left_on_red
    && !redTurnBanned(world, from, to)
    && !turnBanned(map, from, to, world.clock)
    && map.classifyTurn(map.turnAngle(from, to)) === "left");
}
export function leftOnRedExit(world, control) {
  const edges = world.route?.edges || [], i = edges.indexOf(control.edge);
  return i >= 0 && leftOnRedAllowed(world, control.edge, edges[i + 1]);
}
