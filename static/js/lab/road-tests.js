// Road tests: one longer drive on a fixed route that strings everyday situations together (stop signs,
// a school zone, a signalled left turn, a lane change on an arterial, residential streets and parallel
// parking at the end), scored like an examiner's sheet (lab/examiner.js). A road test is authored like a
// challenge and plays through the same setup (lab/evaluation.js `setupChallenge`): `challengeById` finds
// it, `challengeScenario` builds its route here, and `installChallenge` calls `installRoadTest`. Only
// existing world features are switched on; nothing here changes how anything drives.
//
// The route is the authored chain of edges, each taken in the lane the router would take (the leftmost
// before a left turn, else the rightmost: jev/routing.py `_lane_index`), so where a multi-lane street
// leads to a left turn the car changes lanes on the block before it. The test ends past a gap left in a
// short row of cars parked at the kerb of its last street (`park: true`, sim/parallel-park.js).
//
// The wording is generic: these are styled on a province's licence road test, not any organisation's.

import { routeFromLanes } from "../demo/routing.js";
import { pointAt, headingAt, cumulative } from "../map/mapdata.js";
import { Vehicle, CAR } from "../sim/vehicle.js";
import { legalStretches } from "../sim/parallel-park.js";
import { curbOffset } from "../sim/roadside.js";

export const SPACE_M = 7.2;                   // the gap left for the car, a little over 1.55 compact lengths
const ROW_GAP_M = 1.4, ROW_CARS = 2;          // the cars parked either side of it, bumper to bumper
const PAST_M = 25;                            // the route ends this far past the space

export const ROAD_TESTS = [
  { id: "road-test-kitsilano", version: 1, roadTest: true, hazard: "road-test", style: "Class 5-style road test", region: "British Columbia",
    title: "Kitsilano road test", map: "kitsilano", weather: "dry", time: "morning", seed: 61042, icon: "✎", difficulty: "Road test",
    park: true, amberLights: true, followingDistance: true, population: { traffic: 16, pedestrians: 40 }, maxDemerits: 10, limit_s: 600,
    street: "West 10th Avenue",
    // West 10th Avenue east (two-way stop at Trafalgar, then the Kitsilano Secondary school zone), left up
    // Larch Street (across West Broadway at the lights, stop signs at 8th and 7th), left at the lights onto
    // West 4th Avenue, into the left lane, left at the lights onto Stephens Street (stop at 5th), right at the
    // stop sign onto West 7th Avenue and park.
    edges: ["e39", "e37", "e445", "e447", "e114", "e112", "e110", "e108", "e106", "e184", "e182", "e290", "e288", "e286", "e334"],
    startS: 20, spaceS: 70,
    description: "About 1.7 km of Kitsilano at 9 in the morning: stop signs, a school zone, two signalled left turns, a lane change on West 4th Avenue and a parallel park to finish. An examiner marks every manoeuvre.",
    lesson: "Follow the examiner's directions. Stop fully at every stop sign and behind the line, keep to 30 km/h in the school zone, signal and check before every turn and lane change, and finish parked parallel within 30 cm of the kerb. One dangerous action or violation ends the test." },
  { id: "road-test-toronto", version: 1, roadTest: true, hazard: "road-test", style: "G2-style road test", region: "Ontario",
    title: "Annex road test", map: "toronto", weather: "dry", time: "morning", seed: 62042, icon: "✎", difficulty: "Road test",
    park: true, amberLights: true, followingDistance: true, population: { traffic: 16, pedestrians: 40 }, maxDemerits: 10, limit_s: 600,
    street: "Huron Street",
    // Huron Street south through the Huron Street Junior school zone (all-way stop at Lowther), right at the
    // lights onto Bloor Street West, left at the lights onto Spadina Avenue, into the left lane, left at the
    // lights onto Sussex Avenue, through the all-way stop at Huron and park.
    edges: ["e224", "e135", "e166", "e373", "e371", "e369", "e265", "e391", "e343", "e71", "e72", "e37", "e17", "e19"],
    startS: 150, spaceS: 50,
    description: "About 1.2 km of the Annex at 9 in the morning: a school zone with all-way stops, a right and two left turns at the lights, a lane change on Spadina Avenue and a parallel park to finish. An examiner marks every manoeuvre.",
    lesson: "Follow the examiner's directions. At an all-way stop, stop fully behind the line and go in turn. Keep to the school zone limit, signal and check your mirrors and blind spot before every turn and lane change, and finish parked parallel within 30 cm of the kerb. One dangerous action or violation ends the test." },
];

export const roadTestById = id => ROAD_TESTS.find(t => t.id === id) || null;

// The lane the router takes on each edge of the chain.
function chainLanes(map, ids) {
  return ids.map((id, i) => {
    const e = map.edges.get(id);
    if (!e) throw new Error(`Road test edge ${id} is missing from the map.`);
    if (i && !map.successors(ids[i - 1]).includes(id)) throw new Error(`Road test edges ${ids[i - 1]} and ${id} do not connect.`);
    const left = i + 1 < ids.length && map.classifyTurn(map.turnAngle(id, ids[i + 1])) === "left";
    return map.lane(id, e.lanes <= 1 || left ? 0 : e.lanes - 1);
  });
}

// The gap left for the car on the last street: SPACE_M from `spaceS` along it, inside a legal stretch.
export function roadTestSpace(map, test) {
  const e = map.edges.get(test.edges.at(-1));
  const a = test.spaceS, b = a + SPACE_M, row = ROW_CARS * (CAR.length + ROW_GAP_M);
  if (!legalStretches(map, e).some(([lo, hi]) => lo <= a - row && hi >= b + row)) throw new Error(`No legal parking either side of the road test space on ${e.name}.`);
  return { edge: e.id, a, b };
}

export function roadTestScenario(map, test) {
  const chain = chainLanes(map, test.edges), first = chain[0], last = chain.at(-1);
  const space = roadTestSpace(map, test), k = last.length / last.edgeRef.length;
  const route = routeFromLanes(map, chain, test.startS, Math.min(last.length - 3, (space.b + PAST_M) * k));
  const p = pointAt(first.pts, first.cum, test.startS);
  return { id: test.id, start: { edge: first.edge, lane: first.idx, s: test.startS, x: p[0], y: p[1], psi: headingAt(first.pts, first.cum, test.startS) },
    route, goal: route.polyline.at(-1), traffic_seed: test.seed, roadTest: { space },
    tags: { length_m: Math.round(cumulative(route.polyline).at(-1)), signals: chain.filter(l => l.edgeRef.control?.type === "signal").length,
      stops: chain.filter(l => l.edgeRef.control?.type === "stop").length, lefts: route.turns.filter(t => t.dir === "left").length, rights: route.turns.filter(t => t.dir === "right").length } };
}

// Traffic and people out on foot (from the world's and the fleet's own seeded streams, so the same every
// time), and the cars parked either side of the space.
export function installRoadTest(world, fleet, test, scenario) {
  const { traffic = 0, pedestrians = 0 } = test.population || {};
  if (pedestrians) world.crowd.spawn(pedestrians);
  if (traffic) { fleet.target = traffic; fleet.spawn(traffic); }
  const { edge, a, b } = scenario.roadTest.space, e = world.map.edges.get(edge), lat = curbOffset(e, CAR);
  const colors = [0x2b3a55, 0x8d9299, 0x9b1e1e, 0xeeeeea], step = CAR.length + ROW_GAP_M;
  const rears = [...Array(ROW_CARS).keys()].flatMap(i => [a - CAR.length - i * step, b + i * step]).sort((x, y) => x - y);
  for (const [i, rear] of rears.entries()) {
    const s = rear + CAR.rearOverhang, p = pointAt(e.pts, e.cum, s), h = headingAt(e.pts, e.cum, s);
    const car = new Vehicle(p[0] + Math.sin(h) * lat, p[1] - Math.cos(h) * lat, h, 0);
    Object.assign(car, { id: `road_test_parked_${i + 1}`, color: colors[i % colors.length], style: [0, 3, 1, 5][i % 4], curb: "right", edge, stay: true });
    world.parked.add(car);
  }
}
