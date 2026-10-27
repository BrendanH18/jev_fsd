import { routeFromLanes } from "../demo/routing.js";
import { pointAt, headingAt, wrapAngle } from "../map/mapdata.js";
import { Vehicle, BIKE } from "../sim/vehicle.js";
import { NpcPath, stripOffset } from "../sim/npc.js";
import { isJunction } from "../sim/emergency.js";
import { Pedestrian } from "../sim/pedestrians.js";
import { StopMemory, phaseOf } from "../sim/signals.js";
import { rng } from "../common.js";
import { Visibility } from "../sim/visibility.js";

export const CHALLENGE_VERSION = 2;
export const CHALLENGES = [
  { id: "door-zone", title: "The door zone", map: "kitsilano", weather: "dry", time: "afternoon", seed: 1042, icon: "↔", difficulty: "Anticipation", hazard: "door",
    description: "A cyclist. A parked car. One opening door. Leave room before you need it.", lesson: "Look for curb activity and give the cyclist room." },
  { id: "fog-junction", title: "Into the unknown", map: "victoria", weather: "fog", time: "morning", seed: 2042, icon: "◌", difficulty: "Visibility", hazard: "signal",
    description: "A Victoria junction with only 28 metres of sight. Can you stop within what you can see?", lesson: "An unseen signal is unknown. Slow early, then observe." },
  { id: "rain-crossing", version: 2, title: "Rain check", map: "montreal", weather: "rain", time: "night", seed: 3042, icon: "☂", difficulty: "Patience", hazard: "pedestrian",
    description: "A person crosses a wet Montréal street after dark. Smooth braking matters.", lesson: "Leave extra braking room on wet roads." },
  { id: "snow-stop", title: "Winter composure", map: "toronto", weather: "snow", time: "afternoon", seed: 4042, icon: "❄", difficulty: "Control", hazard: "stop",
    description: "A snowy Toronto block and a full stop. Stay composed when grip is limited.", lesson: "Lift off early. A complete stop beats a late hard brake." },
  { id: "curb-merge", title: "Joining the flow", map: "kitsilano", weather: "dry", time: "afternoon", seed: 5042, icon: "↗", difficulty: "Anticipation", hazard: "pull",
    description: "A parked car signals and joins your lane. Notice the indicator and leave a gap.", lesson: "Ease off for a merging car rather than closing the gap." },
  { id: "blind-crossing", title: "Around the corner", map: "kitsilano", weather: "dry", time: "afternoon", seed: 6042, icon: "◧", difficulty: "Sight lines", hazard: "occluded-pedestrian",
    description: "A person emerges from behind a mapped building. Your view opens as you approach.", lesson: "Leave stopping room when a building blocks your view of the sidewalk." },
  { id: "unprotected-left", title: "The unprotected left", map: "ottawa", weather: "dry", time: "afternoon", seed: 7042, icon: "↰", difficulty: "Judgement", hazard: "oncoming",
    description: "A left turn on a green in Centretown, with two oncoming cars close together. Wait for a gap you can use.", lesson: "Oncoming traffic has the right of way. Pull into the junction, wait, and turn once the gap is long enough." },
  { id: "right-on-red", title: "Right on red", map: "calgary", weather: "dry", time: "afternoon", seed: 8042, icon: "↱", difficulty: "Judgement", hazard: "cross",
    description: "A red light in the Beltline and a right turn. Two cars are coming from the left on their green. Stop, look, and pick your moment.", lesson: "A right turn on red needs a full stop first, then a gap in traffic from the left and a clear crosswalk. Waiting for the green is always allowed, and on the island of Montréal it is the only option." },
  { id: "four-way-stop", title: "Four-way stop", map: "toronto", weather: "dry", time: "afternoon", seed: 9042, icon: "✣", difficulty: "Judgement", hazard: "all-way",
    description: "An all-way stop in The Annex. A car from your right gets there first, another queues behind it, and an oncoming car wants to turn left. Who goes when?", lesson: "At an all-way stop, whoever stops first goes first. Stop together and the car on the right goes first. A car that pulls up after you waits for you, even if it was queued before you arrived." },
  { id: "blind-corner", title: "The blind corner", map: "mount_pleasant", weather: "dry", time: "afternoon", seed: 10042, icon: "◩", difficulty: "Sight lines", hazard: "two-way",
    description: "A two-way stop in Mount Pleasant with a building on the corner. The cross street doesn't stop, and you can't see along it from the line.", lesson: "Stop at the line, then creep forward until you can see. Traffic on the through road has the right of way from both sides, so wait until neither side is close." },
  { id: "right-hook", title: "The right hook", map: "kitsilano", weather: "dry", time: "afternoon", seed: 11042, icon: "↳", difficulty: "Anticipation", hazard: "right-hook",
    description: "A right turn off a Kitsilano bikeway, with a cyclist riding the empty parking lane. Catch them up, and they're on your right at the corner.", lesson: "Before a right turn, check your mirror and over your shoulder. A cyclist going straight on your right has the right of way: slow down, let them by, then turn behind them." },
  { id: "lights-and-sirens", title: "Lights and sirens", map: "edmonton", weather: "dry", time: "afternoon", seed: 12042, icon: "✚", difficulty: "Awareness", hazard: "emergency",
    description: "An ambulance comes up behind you with its siren on, just before a junction. Get out of its way, but not into the junction.", lesson: "When you hear a siren, pull over as close to the right-hand edge of the road as you can, clear of any junction, and stop until it has gone by. Then let it get well ahead before you follow." },
];
export const challengeById = id => CHALLENGES.find(c => c.id === id) || null;

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

// Unprotected left turns: a signalled approach at least 90 m long whose route turns left onto a
// street at least 60 m long, opposite an approach of the same signal (heading within 20 deg of
// straight at it, its line at least 70 m along) that continues straight through. The approach's
// light is green from 3 s to 26 s, so the car arrives on a green with time to wait for the gap.
const LEFT_GREEN_S = [3, 26];
const leftSites = new WeakMap();
function oncomingSites(map) {
  if (leftSites.has(map)) return leftSites.get(map);
  const sites = [];
  for (const edge of map.edges.values()) {
    const control = edge.control;
    if (control?.type !== "signal" || edge.length < 90 || control.s_line < 75) continue;
    const left = map.successors(edge.id).find(id => map.classifyTurn(map.turnAngle(edge.id, id)) === "left" && map.edges.get(id).length > 60);
    const opposite = (map.inn.get(edge.to) || []).find(id => {
      const other = map.edges.get(id);
      return id !== edge.id && other.control?.type === "signal" && other.control.id === control.id && other.control.s_line > 70
        && Math.abs(Math.abs(wrapAngle(map.headingIn(id) - map.headingIn(edge.id))) - Math.PI) < 0.35;
    });
    const straight = opposite && map.successors(opposite).find(id => map.classifyTurn(map.turnAngle(opposite, id)) === "straight");
    const inter = map.intersections.get(control.id);
    if (!left || !straight || !inter || !oncomingStarts(map, opposite).every(Boolean)) continue;
    let green = true;
    for (let t = LEFT_GREEN_S[0]; t <= LEFT_GREEN_S[1] && green; t += 0.5) green = phaseOf(inter, t)[control.group] === "green";
    if (green) sites.push({ lane: map.lane(edge.id, 0), left, opposite, straight });
  }
  sites.sort((a, b) => String(a.lane.edge).localeCompare(String(b.lane.edge)));
  leftSites.set(map, sites); return sites;
}

// Right turns on red: a signalled approach at least 90 m long whose route turns right onto a street
// at least 60 m long, where traffic on the approach from the left (another approach of the same
// signal, heading within 20 deg of that street, its line at least 70 m along) goes straight on into
// it. The car's light is red from 3 s to 30 s and the street from the left has a green from 6 s to
// 20 s, so the car arrives on a red while that traffic is moving. From the line the car sees 75 m
// along the street to its left, so once the traffic has passed it may turn.
const RIGHT_RED_S = [3, 30], CROSS_GREEN_S = [6, 20];
const rightSites = new WeakMap();
function crossSites(map) {
  if (!map.rightOnRed) return [];
  if (rightSites.has(map)) return rightSites.get(map);
  const sites = [], visibility = new Visibility(map);
  const openView = (edge, fromLeft) => {
    const lane = map.lane(edge.id, edge.lanes - 1), at = pointAt(lane.pts, lane.cum, edge.control.s_line - 1.5);
    const e = map.edges.get(fromLeft), L = e.cum.at(-1);
    return L >= 75 && [15, 30, 45, 60, 75].every(back => !visibility.occluded(at, pointAt(e.pts, e.cum, L - back)));
  };
  for (const edge of map.edges.values()) {
    const control = edge.control;
    if (control?.type !== "signal" || edge.length < 90 || control.s_line < 75) continue;
    const right = map.successors(edge.id).find(id => map.classifyTurn(map.turnAngle(edge.id, id)) === "right" && map.edges.get(id).length > 60);
    const fromLeft = right && (map.inn.get(edge.to) || []).find(id => {
      const other = map.edges.get(id);
      return id !== edge.id && other.control?.type === "signal" && other.control.id === control.id && other.control.s_line > 70
        && Math.abs(wrapAngle(map.headingIn(id) - map.headingOut(right))) < 0.35 && map.successors(id).includes(right);
    });
    const inter = map.intersections.get(control.id);
    if (!fromLeft || !inter || !oncomingStarts(map, fromLeft).every(Boolean) || !openView(edge, fromLeft)) continue;
    const group = map.edges.get(fromLeft).control.group;
    let ok = true;
    for (let t = RIGHT_RED_S[0]; t <= RIGHT_RED_S[1] && ok; t += 0.5) ok = phaseOf(inter, t)[control.group] === "red";
    for (let t = CROSS_GREEN_S[0]; t <= CROSS_GREEN_S[1] && ok; t += 0.5) ok = phaseOf(inter, t)[group] === "green";
    if (ok) sites.push({ lane: map.lane(edge.id, edge.lanes - 1), right, fromLeft });
  }
  sites.sort((a, b) => String(a.lane.edge).localeCompare(String(b.lane.edge)));
  rightSites.set(map, sites); return sites;
}

// All-way stops: an approach at least 90 m long, its line at least 75 m along, going straight on
// into a street at least 60 m long, at a junction where the approach from the right (heading within
// 20 deg of a quarter turn left of it, its line at least 40 m along) goes straight on and the
// opposite approach (its line at least 60 m along) can turn left, both with all-way stops too.
const allWaySiteCache = new WeakMap();
function allWaySites(map) {
  if (allWaySiteCache.has(map)) return allWaySiteCache.get(map);
  const sites = [], allWay = (id) => map.edges.get(id).control?.type === "stop" && map.edges.get(id).control.all_way;
  const exit = (id, dir, min = 0) => map.successors(id).find(o => map.classifyTurn(map.turnAngle(id, o)) === dir && map.edges.get(o).length > min);
  for (const edge of map.edges.values()) {
    if (!allWay(edge.id) || edge.length < 90 || edge.control.s_line < 75) continue;
    const straight = exit(edge.id, "straight", 60), others = (map.inn.get(edge.to) || []).filter(id => id !== edge.id && allWay(id));
    const at = (turn, min) => others.find(id => Math.abs(wrapAngle(map.headingIn(id) - map.headingIn(edge.id) - turn)) < 0.35 && map.edges.get(id).control.s_line >= min);
    const fromRight = at(Math.PI / 2, 40), opposite = at(Math.PI, 60);
    const across = fromRight && exit(fromRight, "straight"), left = opposite && exit(opposite, "left");
    if (straight && across && left) sites.push({ lane: map.lane(edge.id, edge.lanes - 1), straight, fromRight, across, opposite, left });
  }
  sites.sort((a, b) => String(a.lane.edge).localeCompare(String(b.lane.edge)));
  allWaySiteCache.set(map, sites); return sites;
}

// Blind two-way stops: an approach with a stop sign at least 90 m long, its line at least 75 m
// along, going straight on into a street at least 60 m long, where the streets from the right and the
// left (heading within 20 deg of a quarter turn either way, at least 70 m long) are the through road
// and go straight on. From the stop line a building hides the street to the right 45 to 60 m from the
// junction (where the car from the right starts); from 0.3 m short of the crossing road's asphalt,
// where the car stops to look, nothing hides the first 60 m.
const twoWaySiteCache = new WeakMap();
function twoWaySites(map) {
  if (twoWaySiteCache.has(map)) return twoWaySiteCache.get(map);
  const sites = [], visibility = new Visibility(map);
  const exit = (id) => map.successors(id).find(o => map.classifyTurn(map.turnAngle(id, o)) === "straight" && map.edges.get(o).length > 60);
  for (const edge of map.edges.values()) {
    const control = edge.control;
    if (control?.type !== "stop" || control.all_way || edge.length < 90 || control.s_line < 75) continue;
    const at = (turn) => (map.inn.get(edge.to) || []).find(id => Math.abs(wrapAngle(map.headingIn(id) - map.headingIn(edge.id) - turn)) < 0.35
      && map.priorityOf(id)?.rule === "major" && map.edges.get(id).length > 70 && exit(id));
    const straight = exit(edge.id), fromRight = at(Math.PI / 2), fromLeft = at(-Math.PI / 2);
    if (!straight || !fromRight || !fromLeft) continue;
    const lane = map.lane(edge.id, edge.lanes - 1), e = map.edges.get(fromRight), L = e.cum.at(-1);
    // where the car's rear axle is with its front bumper at route arc length s along the lane
    const eye = (frontS) => pointAt(lane.pts, lane.cum, frontS - 3.6);
    const back = (m) => pointAt(e.pts, e.cum, L - m), peekS = lane.length - map.crossingHalfWidth(edge.id) - 0.3;
    const hidden = [45, 50, 55, 60].find(m => visibility.occluded(eye(control.s_line), back(m)));
    if (hidden && [10, 20, 30, 40, 50, 60].every(m => !visibility.occluded(eye(peekS), back(m))) && map.edges.get(fromLeft).length > 75)
      sites.push({ lane, straight, fromRight, fromLeft, across: [exit(fromRight), exit(fromLeft)], hidden });
  }
  sites.sort((a, b) => String(a.lane.edge).localeCompare(String(b.lane.edge)));
  twoWaySiteCache.set(map, sites); return sites;
}

// Right hooks: an approach at least 110 m long with an empty parking lane, the right of way at its
// far end (no sign or signal, on the larger road or with nobody to give way to), whose route turns
// right onto a street at least 60 m long, and which goes straight on into a street at least 40 m
// long with a parking lane too, so a cyclist riding in it carries straight on past the corner. Bike
// routes come first.
const hookSiteCache = new WeakMap();
function hookSites(map) {
  if (hookSiteCache.has(map)) return hookSiteCache.get(map);
  let sites = [];
  const exit = (id, dir, min) => map.successors(id).find(o => map.classifyTurn(map.turnAngle(id, o)) === dir && map.edges.get(o).length > min
    && (dir !== "straight" || stripOffset(map.edges.get(o), map.edges.get(o).lanes - 1) !== null));
  for (const edge of map.edges.values()) {
    if (edge.control || edge.length < 110 || stripOffset(edge, edge.lanes - 1) === null || map.priorityOf(edge.id)?.rule !== "major") continue;
    const right = exit(edge.id, "right", 60), straight = exit(edge.id, "straight", 40);
    if (right && straight) sites.push({ lane: map.lane(edge.id, edge.lanes - 1), right, straight, bike: !!edge.bike });
  }
  if (sites.some(s => s.bike)) sites = sites.filter(s => s.bike);
  sites.sort((a, b) => String(a.lane.edge).localeCompare(String(b.lane.edge)));
  hookSiteCache.set(map, sites); return sites;
}

// An emergency vehicle from behind: a long two-way street with a parking lane on the right, ending
// at a junction without a sign or signal where the car goes straight on, the car in its curb lane.
// The vehicle is sent once the car is 45 m from the junction (see installChallenge). Streets the
// car has the right of way along come first.
const sirenSiteCache = new WeakMap();
function sirenSites(map) {
  if (sirenSiteCache.has(map)) return sirenSiteCache.get(map);
  let sites = [];
  for (const edge of map.edges.values()) {
    if (edge.control || edge.oneway || edge.ring || edge.length < SIREN_EDGE_M || !(edge.parking?.[1] > 1.5) || !isJunction(map, edge.to)) continue;
    const straight = map.successors(edge.id).find(o => map.classifyTurn(map.turnAngle(edge.id, o)) === "straight" && map.edges.get(o).length > 60 && !map.edges.get(o).ring);
    if (straight) sites.push({ lane: map.lane(edge.id, edge.lanes - 1), straight, major: map.priorityOf(edge.id)?.rule === "major" });
  }
  if (sites.some(s => s.major)) sites = sites.filter(s => s.major);
  sites.sort((a, b) => String(a.lane.edge).localeCompare(String(b.lane.edge)));
  sirenSiteCache.set(map, sites); return sites;
}

export function challengeScenario(map, challenge) {
  let lanes = map.laneList.filter(l => l.length > 110 && l.idx === l.edgeRef.lanes - 1 && !l.edgeRef.ring);
  const matching = lanes.filter(l => ["door", "pull"].includes(challenge.hazard) ? l.edgeRef.parking?.[1] > 0
    : challenge.hazard === "signal" ? l.edgeRef.control?.type === "signal"
    : challenge.hazard === "stop" ? l.edgeRef.control?.type === "stop" : !l.edgeRef.control);
  if (matching.length) lanes = matching;
  if (!lanes.length) lanes = map.laneList.filter(l => l.length > 65 && !l.edgeRef.ring);
  if (!lanes.length) throw new Error("This map has no suitable challenge lane.");
  lanes.sort((a, b) => String(a.edge).localeCompare(String(b.edge)) || a.idx - b.idx);
  const random = rng(challenge.seed);
  const sites = challenge.hazard === "occluded-pedestrian" ? occludedCrossings(map, lanes) : null;
  if (sites && !sites.length) throw new Error("This map has no clear crossing with a building-obstructed approach.");
  const site = sites ? sites[Math.floor(random() * sites.length)] : null;
  const lefts = challenge.hazard === "oncoming" ? oncomingSites(map) : null;
  if (lefts && !lefts.length) throw new Error("This map has no signalled left turn with oncoming traffic.");
  const left = lefts ? lefts[Math.floor(random() * lefts.length)] : null;
  const rights = challenge.hazard === "cross" ? crossSites(map) : null;
  if (rights && !rights.length) throw new Error(map.rightOnRed ? "This map has no signalled right turn with traffic from the left." : "Right turns on red are not allowed on this map.");
  const right = rights ? rights[Math.floor(random() * rights.length)] : null;
  const stops = challenge.hazard === "all-way" ? allWaySites(map) : null;
  if (stops && !stops.length) throw new Error("This map has no all-way stop with traffic from the right and ahead.");
  const stop = stops ? stops[Math.floor(random() * stops.length)] : null;
  const blinds = challenge.hazard === "two-way" ? twoWaySites(map) : null;
  if (blinds && !blinds.length) throw new Error("This map has no two-way stop with a building hiding the through road.");
  const blind = blinds ? blinds[Math.floor(random() * blinds.length)] : null;
  const hooks = challenge.hazard === "right-hook" ? hookSites(map) : null;
  if (hooks && !hooks.length) throw new Error("This map has no right turn with a parking lane a cyclist rides straight on past.");
  const hook = hooks ? hooks[Math.floor(random() * hooks.length)] : null;
  const sirens = challenge.hazard === "emergency" ? sirenSites(map) : null;
  if (sirens && !sirens.length) throw new Error("This map has no long two-way street with a parking lane ending at a junction without a sign.");
  const siren = sirens ? sirens[Math.floor(random() * sirens.length)] : null;
  const start = site?.lane || left?.lane || right?.lane || stop?.lane || blind?.lane || hook?.lane || siren?.lane || lanes[Math.floor(random() * lanes.length)];
  // a left or right turn, or a stop sign, starts 70 m before the stop line; a right hook, 95 m
  // before the corner
  const startS = site ? site.hazardS - 65 : left || right || stop || blind ? start.edgeRef.control.s_line - 70 : hook ? start.length - HOOK_START_M : siren ? start.length - SIREN_START_M : Math.max(8, Math.min(20, start.length * 0.15));
  const chain = [start], seen = new Set([start.edge]);
  let length = start.length - startS;
  if (left) { const turn = map.lane(left.left, 0); chain.push(turn); seen.add(left.left); length += turn.length; }
  const turnRight = right?.right || hook?.right;
  if (turnRight) { const e = map.edges.get(turnRight), turn = map.lane(turnRight, e.lanes - 1); chain.push(turn); seen.add(turnRight); length += turn.length; }
  const straight = stop?.straight || blind?.straight || siren?.straight;
  if (straight) { const ahead = map.lane(straight, Math.min(start.idx, map.edges.get(straight).lanes - 1)); chain.push(ahead); seen.add(straight); length += ahead.length; }
  for (let i = 0; i < 12 && length < 260; i++) {
    const previous = chain.at(-1);
    const successors = map.successors(previous.edge).filter(id => !seen.has(id) && Math.abs(map.turnAngle(previous.edge, id)) < 130 * Math.PI / 180);
    successors.sort((a, b) => Math.abs(map.turnAngle(previous.edge, a)) - Math.abs(map.turnAngle(previous.edge, b)) || String(a).localeCompare(String(b)));
    if (!successors.length) break;
    const id = successors[0], edge = map.edges.get(id), turn = map.classifyTurn(map.turnAngle(previous.edge, id));
    const lane = map.lane(id, turn === "left" ? 0 : edge.lanes - 1);
    chain.push(lane); seen.add(id); length += lane.length;
  }
  const route = routeFromLanes(map, chain, startS, Math.max(10, chain.at(-1).length - 10));
  const p = pointAt(start.pts, start.cum, startS);
  return { id: challenge.id, start: { edge: start.edge, lane: start.idx, s: startS, x: p[0], y: p[1], psi: headingAt(start.pts, start.cum, startS) },
    route, goal: route.polyline.at(-1), traffic_seed: challenge.seed,
    ...(site ? { crossing: { hazardS: site.hazardS, from: site.from, to: site.to } } : {}),
    ...(left ? { oncoming: { edge: left.opposite, then: left.straight } } : {}),
    ...(right ? { oncoming: { edge: right.fromLeft, then: right.right, lane: "curb" } } : {}),
    ...(stop ? { allWay: allWayCars(map, stop) } : {}),
    ...(blind ? { twoWay: twoWayCars(map, blind) } : {}),
    ...(hook ? { cyclist: { edge: hook.lane.edge, s: startS + HOOK_LEAD_M, then: hook.straight } } : {}),
    ...(siren ? { emergency: { kind: "ambulance", relation: "behind", distance: SIREN_BACK_M } } : {}),
    tags: { length_m: Math.round(length), signals: chain.filter(l => l.edgeRef.control?.type === "signal").length,
      stops: chain.filter(l => l.edgeRef.control?.type === "stop").length, lefts: route.turns.filter(t => t.dir === "left").length, rights: route.turns.filter(t => t.dir === "right").length } };
}

export function installChallenge(world, fleet, challenge, scenario) {
  const lane = world.map.lane(scenario.start.edge, scenario.start.lane);
  // an oncoming hazard is placed at the stop line
  const hazardS = scenario.crossing?.hazardS ?? (scenario.oncoming || scenario.allWay || scenario.twoWay ? lane.edgeRef.control.s_line : scenario.cyclist || scenario.emergency ? lane.length : Math.min(lane.length - 15, scenario.start.s + 65));
  const p = pointAt(lane.pts, lane.cum, hazardS), psi = headingAt(lane.pts, lane.cum, hazardS);
  const offset = right => [p[0] + Math.sin(psi) * right, p[1] - Math.cos(psi) * right];
  world.challenge = { id: challenge.id, hazard: challenge.hazard, triggered: false, at: p, carId: null, pedestrianId: null, ...(scenario.oncoming ? { oncoming: scenario.oncoming } : {}), ...(scenario.allWay ? { allWay: scenario.allWay } : {}), ...(scenario.twoWay ? { twoWay: scenario.twoWay, stopId: lane.edgeRef.control.id } : {}), ...(scenario.emergency ? { emergency: scenario.emergency } : {}) };
  if (["door", "pull"].includes(challenge.hazard)) {
    const ep = pointAt(lane.edgeRef.pts, lane.edgeRef.cum, hazardS);
    const laneOffset = (p[0] - ep[0]) * Math.sin(psi) - (p[1] - ep[1]) * Math.cos(psi);
    const curb = Math.max(2.4, lane.edgeRef.asphalt[1] - (lane.edgeRef.parking?.[1] || 2.4) / 2 - laneOffset);
    const cp = offset(curb), car = new Vehicle(cp[0], cp[1], psi, 0);
    Object.assign(car, { id: "challenge_parked", color: 0xd9b685, curb: "right", edge: lane.edge });
    world.parked.add(car); world.challenge.carId = car.id;
  }
  if (challenge.hazard === "door") {
    const bp = pointAt(lane.pts, lane.cum, scenario.start.s + 30);
    const bike = new Vehicle(bp[0], bp[1], headingAt(lane.pts, lane.cum, scenario.start.s + 30), 3, BIKE);
    Object.assign(bike, { id: "challenge_bike", kind: "bike", color: 0x4cc2ff, v0: 3.5, driver: { aMax: 0.8, b: 2, s0: 2, T: 1.5, react: 0.6, lcRate: 0 },
      stopMem: new StopMemory(), path: new NpcPath(world.map, fleet.random, { bike: true }), frozen: 0, waiting: 0 });
    bike.path.start(lane.edge, lane.idx, scenario.start.s + 30); fleet.vehicles.push(bike);
  }
  if (scenario.cyclist) world.challenge.cyclistId = placeCyclist(world, fleet, scenario.cyclist);
  if (["pedestrian", "occluded-pedestrian"].includes(challenge.hazard)) {
    const from = scenario.crossing?.from || offset(5.5), to = scenario.crossing?.to || offset(-5.5);
    const crossing = { node: null, from, to, jaywalk: true };
    const ped = new Pedestrian({ id: "challenge_pedestrian", x: from[0], y: from[1], psi: psi + Math.PI / 2,
      v: 0, speed: 1.35, path: [{ p: to, cross: crossing }], crossing: null, waiting: 0, phase: 0, look: challenge.seed,
      at: null });
    ped.frozen = 1e6;
    world.crowd.list.push(ped); world.challenge.pedestrianId = ped.id;
  }
  // Background curb events are disabled to isolate the authored hazard.
  world.parked.nextDoor = 1e9; fleet.nextPark = 1e9; fleet.nextPull = 1e9;
}

export function stepChallenge(world, fleet) {
  const state = world.challenge;
  if (!state) return;
  const local = world.ego.toLocal(...state.at);
  // (at a two-way stop, once the car has stopped at the line, or its front is past it)
  const trigger = state.hazard === "two-way" ? (world.egoStop.completed && world.egoStop.controlId === state.stopId) || local.ahead < world.ego.spec.length - world.ego.spec.rearOverhang
    : local.ahead < (state.hazard === "pull" ? 65 : ["oncoming", "cross", "all-way", "right-hook", "emergency"].includes(state.hazard) ? ONCOMING_TRIGGER_M : 43);
  if (!state.triggered && trigger && local.ahead > 0) {
    state.triggered = true;
    if (state.oncoming) state.oncomingIds = releaseOncoming(world, fleet, state.oncoming);
    if (state.allWay) state.allWayIds = releaseAllWay(world, fleet, state.allWay);
    if (state.twoWay) state.twoWayIds = releaseThrough(world, fleet, state.twoWay);
    if (state.emergency) state.emergencyId = fleet.dispatchEmergency(state.emergency)?.id || null;
    if (state.carId) {
      const car = world.parked.list.find(c => c.id === state.carId);
      if (state.hazard === "pull") { const merging = fleet.startPullOut(car); state.mergingId = merging?.id || null; }
      else world.parked.openDoor(car);
    }
    if (state.pedestrianId) {
      const ped = world.crowd.list.find(p => p.id === state.pedestrianId);
      ped.frozen = 0; ped.crossing = ped.path[0].cross;
    }
  }
  const ped = state.pedestrianId && world.crowd.list.find(p => p.id === state.pedestrianId);
  if (ped && !ped.path.length) { ped.frozen = 1e6; ped.v = 0; }
}

// With the car 45 m from its stop line, two cars 20 m apart (1.8 s at 11 m/s, too short a gap to
// turn in) set off on the opposite approach, the first 60 m before its own line, both going straight
// through. They start out of sight, beyond the 80 m a driver can see in clear daylight. For a right
// turn on red the same two cars come from the left, in its curb lane.
const ONCOMING_TRIGGER_M = 45;
// Where each oncoming car starts: [edge, s, edges before the approach's own], or null when there is
// no room. A start before the approach begins is on the street leading straight into it.
function oncomingStarts(map, edge) {
  const approach = map.edges.get(edge), line = approach.control.s_line;
  return [line - 60, line - 80].map(s => {
    if (s >= 2) return [edge, s, []];
    const before = (map.inn.get(approach.from) || []).find(p => map.classifyTurn(map.turnAngle(p, edge)) === "straight" && map.edges.get(p).length + s > 2);
    return before ? [before, s + map.edges.get(before).length, [[edge, 0]]] : null;
  });
}
function releaseOncoming(world, fleet, { edge, then, lane: which }) {
  const map = world.map, v = Math.min(11, map.edges.get(edge).limit || 11);
  const laneOf = (id) => which === "curb" ? map.edges.get(id).lanes - 1 : 0;
  return oncomingStarts(map, edge).map(([id, s, through], i) => {
    const plan = [...through.map(([e]) => [e, laneOf(e)]), [then, laneOf(then)]];
    const lane = map.lane(id, laneOf(id)), p = pointAt(lane.pts, lane.cum, s);
    const car = new Vehicle(p[0], p[1], headingAt(lane.pts, lane.cum, s), v);
    Object.assign(car, { id: `challenge_${which === "curb" ? "cross" : "oncoming"}_${i + 1}`, color: i ? 0x2b3a55 : 0x9b1e1e, v0: v, driver: { aMax: 1.5, b: 2, s0: 2, T: 1.2, react: 0.5, lcRate: 0 },
      stopMem: new StopMemory(), path: new NpcPath(map, fleet.random), frozen: 0, waiting: 0 });
    car.path.start(id, laneOf(id), s, plan); fleet.vehicles.push(car);
    return car.id;
  });
}

// At an all-way stop, with the car 45 m from its line: from the right, a hesitant driver 22 m from
// its line (it waits 3 s once it may go, so it is still there when the car stops) and a second car
// 10 m behind it, which reaches the line only after the first has gone, and so after the car; and
// an oncoming car 55 m out that turns left, also arriving after the car. They come at 7 to 9 m/s.
function allWayCars(map, site) {
  return [
    { id: "challenge_right_1", edge: site.fromRight, back: 22, then: site.across, v: 7, react: 3 },
    { id: "challenge_right_2", edge: site.fromRight, back: 32, then: site.across, v: 7, react: 0.6 },
    { id: "challenge_oncoming_left", edge: site.opposite, back: 55, then: site.left, v: 9, react: 0.6 },
  ].filter(c => map.edges.get(c.edge).control.s_line - c.back >= 2);
}
function releaseAllWay(world, fleet, cars) {
  const map = world.map;
  return cars.map(({ id, edge, back, then, v, react }, i) => {
    const e = map.edges.get(edge), lane = map.lane(edge, e.lanes - 1), s = e.control.s_line - back;
    const turn = map.classifyTurn(map.turnAngle(edge, then)), next = map.edges.get(then);
    const p = pointAt(lane.pts, lane.cum, s), car = new Vehicle(p[0], p[1], headingAt(lane.pts, lane.cum, s), v);
    Object.assign(car, { id, color: [0x9b1e1e, 0x2b3a55, 0xeeeeea][i % 3], v0: Math.min(11, e.limit || 11), driver: { aMax: 1.5, b: 2, s0: 2, T: 1.2, react, lcRate: 0 },
      stopMem: new StopMemory(), path: new NpcPath(map, fleet.random), frozen: 0, waiting: 0 });
    car.path.start(edge, lane.idx, s, [[then, turn === "left" ? 0 : Math.min(lane.idx, next.lanes - 1)]]); fleet.vehicles.push(car);
    return car.id;
  });
}

// At a blind two-way stop, once the car has made its stop at the line (or crossed it without): a car
// on the through road from the right, where the building hides it from the line, and one from the
// left 75 m out, both at up to 10 m/s going straight on. The first reaches the junction about when
// the car has crept forward to look; the second close enough after it that the car waits for it too.
function twoWayCars(map, site) {
  return [
    { id: "challenge_through_right", edge: site.fromRight, back: site.hidden, then: site.across[0] },
    { id: "challenge_through_left", edge: site.fromLeft, back: 75, then: site.across[1] },
  ].map(c => ({ ...c, start: [c.edge, map.edges.get(c.edge).length - c.back, []] }));
}
function releaseThrough(world, fleet, cars) {
  const map = world.map;
  return cars.map(({ id, start: [edge, s, through], then }, i) => {
    const e = map.edges.get(edge), lane = map.lane(edge, e.lanes - 1), v = Math.min(10, e.limit || 10);
    const plan = [...through, then].map(id => [id, map.edges.get(id).lanes - 1]);
    const p = pointAt(lane.pts, lane.cum, s), car = new Vehicle(p[0], p[1], headingAt(lane.pts, lane.cum, s), v);
    Object.assign(car, { id, color: [0x9b1e1e, 0x2b3a55][i % 2], v0: v, driver: { aMax: 1.5, b: 2, s0: 2, T: 1.2, react: 0.6, lcRate: 0 },
      stopMem: new StopMemory(), path: new NpcPath(map, fleet.random), frozen: 0, waiting: 0 });
    car.path.start(edge, lane.idx, s, plan); fleet.vehicles.push(car);
    return car.id;
  });
}

// A right hook: the car starts 95 m before the corner, and a cyclist 15 m ahead of it rides the
// empty parking lane at 5.5 m/s, straight on past the corner. The car catches it up on the way, so
// it is beside or just behind the car as the car slows for the turn.
const HOOK_START_M = 95, HOOK_LEAD_M = 15;

// Lights and sirens: the car starts 110 m before the junction, and once it is 45 m from it an
// ambulance sets off 75 m behind it, on its street, siren on.
const SIREN_EDGE_M = 135, SIREN_START_M = 110, SIREN_BACK_M = 75;
function placeCyclist(world, fleet, { edge, s, then }) {
  const map = world.map, e = map.edges.get(edge), lane = map.lane(edge, e.lanes - 1), side = stripOffset(e, lane.idx);
  const p = pointAt(lane.pts, lane.cum, s), psi = headingAt(lane.pts, lane.cum, s);
  const bike = new Vehicle(p[0] + Math.sin(psi) * side, p[1] - Math.cos(psi) * side, psi, 5.5, BIKE);
  Object.assign(bike, { id: "challenge_cyclist", kind: "bike", color: 0x2f855a, v0: 5.5, side, strip: true, driver: { aMax: 0.9, b: 2, s0: 2, T: 1.5, react: 0.6, lcRate: 0 },
    stopMem: new StopMemory(), path: new NpcPath(map, fleet.random, { bike: true }), frozen: 0, waiting: 0 });
  bike.path.start(edge, lane.idx, s, [[then, map.edges.get(then).lanes - 1]]); fleet.vehicles.push(bike);
  return bike.id;
}

export function challengeConfig(challenge) {
  return { version: challenge.version || 1, challenge: challenge.id, map: challenge.map, seed: challenge.seed,
    weather: challenge.weather, time: challenge.time, traffic: 0, car: "compact", clock: 0 };
}
