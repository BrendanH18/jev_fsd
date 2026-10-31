import { routeFromLanes } from "../demo/routing.js";
import { pointAt, headingAt, wrapAngle, projectPoint } from "../map/mapdata.js";
import { Vehicle, BIKE, BUS, CAR, DELIVERY_VAN, SCHOOL_BUS, STREETCAR, TOW_TRUCK } from "../sim/vehicle.js";
import { NpcPath, stripOffset } from "../sim/npc.js";
import { isJunction } from "../sim/emergency.js";
import { BUS_YIELD_LIMIT_MPS, busStopFront, curbShift } from "../sim/bus.js";
import { HOLD_M } from "../sim/crosswalk.js";
import { ONCOMING_M, firstStop, stopRange } from "../sim/school-bus.js";
import { Pedestrian } from "../sim/pedestrians.js";
import { StopMemory, approachPhase, movementSignal, phaseOf } from "../sim/signals.js";
import { rng } from "../common.js";
import { Visibility } from "../sim/visibility.js";
import { ZONE_LIMIT_MPS } from "../sim/speed-zones.js";
import { SLOW_FAST_MPS, SLOW_MPS, curbOffset, endsOf } from "../sim/roadside.js";
import { doorPoints } from "../sim/streetcar.js";
import { approach, crossingsAhead, railIndex, trainSpan } from "../sim/rail.js";
import { boxEnd } from "../sim/junction-box.js";
import { SPAN_M as WZ_SPAN_M, WZ_LIMIT_MPS, workZoneSites } from "../sim/work-zone.js";
import { vanSites } from "../sim/double-parked.js";

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
  { id: "bus-pulling-out", title: "Pulling out", map: "kitsilano", weather: "dry", time: "afternoon", seed: 13042, icon: "▤", difficulty: "Courtesy", hazard: "bus", street: "West 4th Avenue",
    description: "A bus at its stop on West 4th Avenue signals to pull out just as you come up behind it in its lane.", lesson: "In BC, where the limit is 60 km/h or less, traffic behind a bus at a stop must let it pull out once it signals. Ease off early, stop behind it if you have to, and let it go first." },
  { id: "multiple-threat", title: "The multiple threat", map: "kitsilano", weather: "dry", time: "afternoon", seed: 14042, icon: "⋕", difficulty: "Sight lines", hazard: "crosswalk", street: "West Broadway",
    description: "A car in the curb lane has stopped at a marked crosswalk on West Broadway. The lane beside it is open. Why did it stop?", lesson: "Never pass a vehicle stopped at a crosswalk: it may be hiding the person it stopped for. In BC it is the law. Stop beside it, look, and go on only once nobody is crossing in your path." },
  { id: "school-bus", title: "Flashing reds", map: "kitsilano", weather: "dry", time: "afternoon", seed: 15042, icon: "▣", difficulty: "Courtesy", hazard: "school-bus", street: "West 2nd Avenue",
    description: "A school bus coming the other way on West 2nd Avenue has stopped with its red lights flashing. Your side of the road is clear.", lesson: "In BC, traffic going both ways must stop for a school bus stopped with its red lights flashing, and stay stopped until it moves off or the lights go off. Children getting off often cross the street in front of it." },
  { id: "school-zone", title: "School zone", map: "kitsilano", weather: "dry", time: "morning", seed: 16042, icon: "◭", difficulty: "Anticipation", hazard: "school-zone", street: "West 11th Avenue",
    description: "West 11th Avenue past Lord Tennyson Elementary, at 9 in the morning. The street's limit is 50 km/h, but this block is a school zone, and the cars parked along it hide the curb.", lesson: "In BC a school zone's 30 km/h holds from 8:00 to 17:00 on school days, and a playground zone's from dawn to dusk every day. At 30 km/h a car stops in about a third of the distance it needs at 50, so a child running out between parked cars can be missed." },
  { id: "move-over", title: "Move over", map: "winnipeg", weather: "dry", time: "afternoon", seed: 17042, icon: "⚠", difficulty: "Courtesy", hazard: "roadside", street: "Princess Street",
    description: "A tow truck is at the curb on Princess Street with its amber lights flashing, hooking up a car. You're in the lane right beside it.", lesson: "Slow down and move over: passing a vehicle stopped at the roadside with its lights flashing, slow to 40 km/h where the limit is under 80 (70 where it is 80 or more), and move out of the lane next to it if you safely can. That is BC's law, and every province has one like it. The people working there stand at the edge of that lane, and step into it." },
  { id: "streetcar", title: "Behind the doors", map: "toronto", weather: "dry", time: "afternoon", seed: 18042, icon: "▥", difficulty: "Courtesy", hazard: "streetcar", street: "Bathurst Street",
    description: "A 511 streetcar has stopped at its stop on Bathurst Street, in the lane beside yours, with its doors open. Your lane is clear.", lesson: "In Ontario, traffic behind a streetcar that has stopped to let people on or off must stop at least 2 m behind its rear doors and wait until they have got on, or reached the curb. Its riders cross your lane to get to it." },
  { id: "level-crossing", title: "Clear the tracks", map: "edmonton", weather: "dry", time: "afternoon", seed: 19042, icon: "╫", difficulty: "Judgement", hazard: "level-crossing", street: "106 Street NW",
    description: "106 Street crosses the High Level Bridge Streetcar's tracks on the level, with crossbucks and nothing else: no lights, no gates, no bell. Past them, traffic is backed up from 86 Avenue behind a car waiting to turn left.", lesson: "Never stop on the tracks: don't start across a level crossing unless there is room for all of your car past it. And when a train is coming, stop at least 5 m back from the nearest rail and wait until it has passed (Alberta's Use of Highway and Rules of the Road Regulation, s. 42). A streetcar can't steer round you, and takes far longer to stop than a car." },
  { id: "junction-box", title: "Keep the box clear", map: "montreal", weather: "dry", time: "afternoon", seed: 20042, icon: "⊠", difficulty: "Judgement", hazard: "junction-box", street: "Avenue du Mont-Royal Est",
    description: "Avenue du Mont-Royal Est meets Rue Saint-Denis at a light that is green as you come up. Past it, traffic is backed up from Rue Rivard, behind a car waiting to turn left, to just beyond Saint-Denis.", lesson: "Even on a green, don't enter a junction unless there is room for all of your car past it: wait at the line until there is. That is Québec's Highway Safety Code, and Montréal police fine drivers who block an intersection. A driver who follows the queue in is stuck in the middle when the light changes, and the cross street can't go." },
  { id: "left-arrow", title: "Not your arrow", map: "winnipeg", weather: "dry", time: "afternoon", seed: 21042, icon: "⇠", difficulty: "Judgement", hazard: "left-arrow", street: "Isabel Street",
    description: "You're going straight on Isabel Street at William Avenue, first at a red light in the right lane. Beside you, cars wait in the left lane to turn left. Then a green arrow comes on, and they go.", lesson: "A green arrow is for the way it points, and no other: going straight, your light is still red. Wait for your own green, even while the lane beside you moves." },
  { id: "flagger", title: "Follow the flagger", map: "ottawa", weather: "dry", time: "afternoon", seed: 22042, icon: "⚑", difficulty: "Patience", hazard: "work-zone", street: "Queen Street",
    description: "A road crew has closed your lane on Queen Street, leaving one lane for both directions. The flagger at your end holds up a STOP paddle while cars come the other way through it.", lesson: "A flagger's paddle is a traffic sign: on STOP, stop before reaching them and stay stopped; on SLOW, go on with care, at the work zone's speed. Where your lane is closed you go round the work in the other lane, so wait until you're waved through: oncoming traffic has that lane until then. That is Ontario's Highway Traffic Act, and every province has a rule like it." },
  { id: "lights-out", title: "Lights out", map: "halifax", weather: "dry", time: "afternoon", seed: 23042, icon: "☇", difficulty: "Judgement", hazard: "outage", street: "Barrington Street",
    description: "A storm has knocked out the power in downtown Halifax, and the traffic lights where Barrington Street meets Morris Street are dark. A car from your right gets there first, another queues behind it, and an oncoming car wants to turn left.", lesson: "When traffic lights are out, treat the junction as an all-way stop: stop at the line, then go in turn. Whoever stops first goes first; stop together and the car on the right goes first. Never drive through as if your light were green: the cross street has no red either. Driver's handbooks across Canada say the same." },
  { id: "double-parked", title: "Round the van", map: "toronto", weather: "dry", time: "afternoon", seed: 24042, icon: "◫", difficulty: "Patience", hazard: "double-parked", street: "Brunswick Avenue",
    description: "A delivery van has stopped in your lane on Brunswick Avenue, its hazards flashing, beside the parked cars. The only way past is the oncoming lane, and you can't see far down it yet.", lesson: "Going round something stopped in your lane takes you into the oncoming lane, and oncoming traffic has the right of way. Stop a car length back, where you can see past it and have room to pull out, and go round only once the way is clear for the whole distance round and back. Driver's handbooks across Canada say the same." },
];
export const challengeById = id => CHALLENGES.find(c => c.id === id) || null;

// Follow the flagger: a work zone (sim/work-zone.js) where the car's lane is closed, on a block of the
// challenge's `street` (where it has one) with a limit above the zone's, with room for the car to
// start from a standstill WZ_START_M short of its stop line and for WZ_CARS cars, WZ_CAR_GAP_M apart,
// to wait short of the stop line at the other end. The flaggers show STOP to the car and hold it
// there (`held`); once the car's front is WZ_TRIGGER_M from its line those cars set off through the
// one lane, and once the last of them is past its own line (or after WZ_HOLD_MAX_S) the flaggers go
// on as usual: STOP both ways until the one lane is clear, then SLOW for the car.
const WZ_START_M = 65, WZ_TRIGGER_M = 45, WZ_CARS = 3, WZ_CAR_GAP_M = 12, WZ_HOLD_MAX_S = 40;
const workZoneSiteCache = new WeakMap();
function flaggerSites(map, street) {
  if (!workZoneSiteCache.has(map)) {
    const sites = [], front = CAR.length - CAR.rearOverhang;
    for (const site of workZoneSites(map)) {
      const e = map.edges.get(site.closed);
      if (e.limit <= WZ_LIMIT_MPS + 1) continue;
      const a = Math.min(site.hi, Math.max(site.lo, WZ_START_M + front + 4)), lane = map.lane(site.closed, 0);
      const startS = (a - WZ_START_M - front) * lane.length / e.length;
      if (startS < 2 || e.length - a - WZ_SPAN_M < WZ_CARS * WZ_CAR_GAP_M + 6) continue;
      sites.push({ lane, startS, zone: { closed: site.closed, open: site.open, a } });
    }
    workZoneSiteCache.set(map, sites);
  }
  const sites = workZoneSiteCache.get(map), on = sites.filter((s) => s.lane.edgeRef.name === street);
  return on.length ? on : sites;
}

// Round the van: a delivery van double-parked (sim/double-parked.js) in the car's lane on a block of
// the challenge's `street` (where it has one), beside VAN_PARKED cars parked at the curb, with the car
// starting from a standstill, its front VAN_START_M short of the van. Once its front is VAN_TRIGGER_M
// from the van, VAN_CARS cars, VAN_CAR_GAP_M apart, come down the oncoming lane at the street's limit,
// the first from VAN_ONCOMING_M past the van's front: out of the car's sight at first, and in the way
// round just as it gets to the van. Going round straight away, it would meet them there; past them the
// way is clear. The route ends VAN_PAST_M past the van, on its street.
const VAN_START_M = 62, VAN_TRIGGER_M = 40, VAN_CARS = 2, VAN_CAR_GAP_M = 14, VAN_ONCOMING_M = 70, VAN_PAST_M = 45, VAN_PARKED = 4;
const vanSiteCache = new WeakMap();
function doubleParkSites(map, street) {
  if (!vanSiteCache.has(map)) {
    const sites = [], front = CAR.length - CAR.rearOverhang;
    for (const site of vanSites(map)) {
      const e = map.edges.get(site.edge), lane = map.lane(site.edge, 0);
      const rear = Math.min(site.hi, Math.max(site.lo, VAN_START_M + front + 4)), van = rear + DELIVERY_VAN.length;
      const startS = (rear - VAN_START_M - front) * lane.length / e.length;
      if (startS < 2 || !e.parking?.[1] || e.length - van < VAN_ONCOMING_M + (VAN_CARS - 1) * VAN_CAR_GAP_M + 6 || van + VAN_PAST_M > (e.control?.s_line ?? e.length) - 3) continue;
      sites.push({ lane, startS, goalS: (van + VAN_PAST_M) * lane.length / e.length, van: { edge: site.edge, rear } });
    }
    vanSiteCache.set(map, sites);
  }
  const sites = vanSiteCache.get(map), on = sites.filter((s) => s.lane.edgeRef.name === street);
  return on.length ? on : sites;
}

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
    // (a plain green: not an advance green, under which the turn would be protected)
    for (let t = LEFT_GREEN_S[0]; t <= LEFT_GREEN_S[1] && green; t += 0.5) green = approachPhase(inter, edge.id, t) === "green" && approachPhase(inter, opposite, t) === "green";
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
    let ok = true;
    for (let t = RIGHT_RED_S[0]; t <= RIGHT_RED_S[1] && ok; t += 0.5) ok = approachPhase(inter, edge.id, t) === "red";
    for (let t = CROSS_GREEN_S[0]; t <= CROSS_GREEN_S[1] && ok; t += 0.5) ok = movementSignal(approachPhase(inter, fromLeft, t), "straight") === "green";
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

// Lights out: a signal with four approaches at one node, where the approach (on the challenge's
// `street`, where it has one) and the approaches from the right and opposite meet allWaySites' terms
// for an all-way stop. Its lights are out (sim/outage.js), so it is one.
const darkSiteCache = new WeakMap();
function darkSites(map, street) {
  if (!darkSiteCache.has(map)) {
    const sites = [];
    const exit = (id, dir, min = 0) => map.successors(id).find(o => map.classifyTurn(map.turnAngle(id, o)) === dir && map.edges.get(o).length > min);
    for (const inter of map.intersections.values()) {
      if ((inter.vertices || []).length !== 1 || inter.approaches.length !== 4) continue;
      for (const { edge: id } of inter.approaches) {
        const edge = map.edges.get(id);
        if (edge.length < 90 || edge.control.s_line < 75) continue;
        const at = (turn, min) => inter.approaches.map(a => a.edge).find(o => o !== id && Math.abs(wrapAngle(map.headingIn(o) - map.headingIn(id) - turn)) < 0.35 && map.edges.get(o).control.s_line >= min);
        const straight = exit(id, "straight", 60), fromRight = at(Math.PI / 2, 40), opposite = at(Math.PI, 60);
        const across = fromRight && exit(fromRight, "straight"), left = opposite && exit(opposite, "left");
        if (straight && across && left) sites.push({ lane: map.lane(id, edge.lanes - 1), signal: inter.id, straight, fromRight, across, opposite, left });
      }
    }
    sites.sort((a, b) => String(a.lane.edge).localeCompare(String(b.lane.edge)));
    darkSiteCache.set(map, sites);
  }
  const sites = darkSiteCache.get(map), on = sites.filter(s => s.lane.edgeRef.name === street);
  return on.length ? on : sites;
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

// A bus at its stop: a stop on a bus route, on a street limited to 60 km/h or less that the route
// comes straight on into, with room on it and the street before for the car to start 100 m behind
// the bus, in its lane (the curb lane). On the challenge's `street` where it has one.
const busSiteCache = new WeakMap();
function busSites(map, street) {
  if (!busSiteCache.has(map)) {
    const sites = [], seen = new Set();
    (map.transit?.routes || []).forEach((route) => route.mode !== "tram" && route.runs.forEach((run, runIndex) => {
      for (const stop of run.stops) {
        const k = run.edges.indexOf(stop.edge), e = map.edges.get(stop.edge), prev = map.edges.get(run.edges[k - 1]);
        if (k < 1 || !e || !prev || seen.has(stop.id) || e.ring || prev.ring || e.limit > BUS_YIELD_LIMIT_MPS) continue;
        const front = busStopFront(map, e.id, stop.s);
        if (front === null || map.classifyTurn(map.turnAngle(prev.id, e.id)) !== "straight") continue;
        const rear = front - BUS.length;
        if (rear < 3 || prev.length + rear < BUS_START_M + 10) continue;
        seen.add(stop.id);
        sites.push({ prev: map.lane(prev.id, prev.lanes - 1), lane: map.lane(e.id, e.lanes - 1), rear, bus: { route: route.id, run: runIndex, stop: stop.id, edge: e.id, front } });
      }
    }));
    sites.sort((a, b) => a.bus.stop.localeCompare(b.bus.stop));
    busSiteCache.set(map, sites);
  }
  const sites = busSiteCache.get(map), on = sites.filter((s) => s.lane.edgeRef.name === street);
  return on.length ? on : sites;
}

// The multiple threat: a marked crosswalk between junctions (map.crosswalks) on a street with two or
// more lanes going the car's way, limited to 60 km/h or less, the crosswalk at least 115 m along its
// edge with no other crosswalk or control in the 115 m before it. The car starts 110 m before the
// crosswalk in the lane beside the curb lane. A car stands in the curb lane, its front 3.5 m short of
// the crosswalk's centre, and a person stands just in front of it on the crosswalk, hidden from the
// car by it; once the car is 45 m from the crosswalk, they walk on across the street, out into the
// car's lane. On the challenge's `street` where it has one.
const THREAT_START_M = 110, THREAT_MIN_M = 115;
const threatSiteCache = new WeakMap();
function threatSites(map, street) {
  if (!threatSiteCache.has(map)) {
    const sites = [];
    for (const c of map.crosswalks || []) {
      const base = map.edges.get(c.edge);
      for (const e of [base, ...[...map.edges.values()].filter(o => o.from === base.to && o.to === base.from)]) {
        if (e.lanes < 2 || e.ring || e.limit > BUS_YIELD_LIMIT_MPS) continue;
        const curb = map.lane(e.id, e.lanes - 1), inner = map.lane(e.id, e.lanes - 2);
        const s = projectPoint(inner.pts, inner.cum, [c.x, c.y]).s;
        if (s < THREAT_MIN_M || inner.length - s < 10) continue;
        const along = (o) => projectPoint(e.pts, e.cum, [o.x, o.y]);
        const before = (map.crosswalks || []).some(o => o !== c && (o.edge === e.id || o.edge === base.id) && (() => { const q = along(o); return q.distance < 3 && q.s < s && q.s > s - THREAT_MIN_M; })());
        if (before || (e.control && e.control.s_line < s && e.control.s_line > s - THREAT_MIN_M)) continue;
        sites.push({ crosswalk: c.id, lane: inner, curb, s, sCurb: projectPoint(curb.pts, curb.cum, [c.x, c.y]).s });
      }
    }
    sites.sort((a, b) => a.crosswalk.localeCompare(b.crosswalk) || String(a.lane.edge).localeCompare(String(b.lane.edge)));
    threatSiteCache.set(map, sites);
  }
  const sites = threatSiteCache.get(map), on = sites.filter((s) => s.lane.edgeRef.name === street);
  return on.length ? on : sites;
}

// Flashing reds: a school bus coming toward the car, stopped with its reds flashing where a school
// bus may stop (sim/school-bus.js stopRange) on a two-way street with one lane each way, limited to
// 50 km/h or less. The car starts in its lane on the same street, SCHOOL_START_M before where it
// stops for the bus (ONCOMING_M short of its front), so the bus stops as near the end of its own
// street as it may. Once the car is 45 m from the bus's front, a child who has just got off walks
// forward past its front and crosses the street in front of it, into the car's lane. On the
// challenge's `street` where it has one.
// School zone: the car starts 4 m into a street that is a school zone (in effect at the challenge's
// time) with a higher limit of its own and a parking lane on the right, and a child waits at the
// curb 85 m on, between two parked cars, with at least 40 m of zone before them and no stop line
// within 30 m after. Once the car's front is 15 m from them they run out across the street: at
// 30 km/h the car stops short of them, at the street's 50 it cannot.
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

const SCHOOL_START_M = 100;
const schoolSiteCache = new WeakMap();
function schoolSites(map, street) {
  if (!schoolSiteCache.has(map)) {
    const sites = [];
    for (const e of map.edges.values()) {
      const r = [...map.edges.values()].find(o => o.from === e.to && o.to === e.from && o.lanes === 1);
      if (!r || e.lanes !== 1 || e.ring || !stopRange(map, r)) continue;
      const L = e.cum[e.cum.length - 1], at = firstStop(stopRange(map, r), 0);
      const start = L - at - ONCOMING_M - SCHOOL_START_M;
      if (at === null || start < 3) continue;
      sites.push({ lane: map.lane(e.id, 0), startS: start * map.lane(e.id, 0).length / Math.max(1, L), bus: { edge: r.id, s: at } });
    }
    sites.sort((a, b) => String(a.lane.edge).localeCompare(String(b.lane.edge)));
    schoolSiteCache.set(map, sites);
  }
  const sites = schoolSiteCache.get(map), on = sites.filter((s) => s.lane.edgeRef.name === street);
  return on.length ? on : sites;
}

// Move over: a street with two or more lanes going the car's way and a parking lane on the right,
// whose limit the rule brings down (above 40 km/h, under 80), going straight on into a street with as
// many lanes, with no marked crosswalk on it. A tow truck stands at its right curb, its front
// TOW_CLEAR_M short of the street's end (or its stop line), with the car it is about to tow parked
// OPERATOR_GAP_M behind it and its operator between them, on the traffic side. The car starts in the
// curb lane with its front ROADSIDE_START_M behind the truck's rear. Once its front is
// OPERATOR_TRIGGER_M from the operator they step out, without looking, into the curb lane, to
// OPERATOR_OUT_M right of its centre, stand there for OPERATOR_PAUSE_S and step back. In the lane
// beside it the car is clear of them; in the curb lane at 40 km/h it can stop for them, at 50 it cannot.
const TOW_CLEAR_M = 25, ROADSIDE_START_M = 76, OPERATOR_GAP_M = 1.6, OPERATOR_TRIGGER_M = 16, OPERATOR_OUT_M = 0.4, OPERATOR_PAUSE_S = 3, OPERATOR_MPS = 1.3;
const roadsideSiteCache = new WeakMap();
function roadsideSites(map, street) {
  if (!roadsideSiteCache.has(map)) {
    const sites = [];
    for (const e of map.edges.values()) {
      if (e.ring || e.lanes < 2 || !(e.parking?.[1] >= 1.8) || e.limit <= SLOW_MPS + 1 || e.limit >= SLOW_FAST_MPS + 10 / 3.6) continue;
      if ((map.crosswalks || []).some(c => c.edge === e.id)) continue;
      const straight = map.successors(e.id).find(id => map.classifyTurn(map.turnAngle(e.id, id)) === "straight" && map.edges.get(id).lanes >= e.lanes && !map.edges.get(id).ring);
      const L = e.cum.at(-1), to = Math.min(L, e.control?.s_line ?? L) - TOW_CLEAR_M, from = to - (TOW_TRUCK.length + CAR.length + OPERATOR_GAP_M + 0.4);
      const lane = map.lane(e.id, e.lanes - 1), scale = lane.length / Math.max(1, L);
      const startS = (to - 0.2 - TOW_TRUCK.length - ROADSIDE_START_M) * scale - (CAR.length - CAR.rearOverhang);
      if (!straight || startS < 4) continue;
      sites.push({ lane, startS, stop: { edge: e.id, from, to } });
    }
    sites.sort((a, b) => String(a.lane.edge).localeCompare(String(b.lane.edge)));
    roadsideSiteCache.set(map, sites);
  }
  const sites = roadsideSiteCache.get(map), on = sites.filter((s) => s.lane.edgeRef.name === street);
  return on.length ? on : sites;
}

// Behind the doors: a streetcar stopped at a stop of its route's run (sim/streetcar.js), with its
// doors open, on a street with another lane going its way on the curb side of its track, with no
// junction and no school or playground zone between it and the car. The car starts in that lane,
// TRAM_START_M behind the streetcar's rear. A rider waits at the curb abreast of
// its rear doors; once the car's front is RIDER_TRIGGER_M from them, they walk out across the car's
// lane to the doors without looking, and get on. The streetcar closes its doors RIDER_ABOARD_S
// later and moves off.
// On the challenge's `street` where it has one.
const TRAM_START_M = 75, RIDER_TRIGGER_M = 10, RIDER_MPS = 1.4, RIDER_ABOARD_S = 4;
const tramSiteCache = new WeakMap();
function tramSites(map, street) {
  if (!tramSiteCache.has(map)) {
    const sites = [];
    (map.transit?.routes || []).forEach((route) => route.mode === "tram" && route.runs.forEach((run, runIndex) => {
      for (const stop of run.stops) {
        const k = run.edges.indexOf(stop.edge), e = map.edges.get(stop.edge), front = busStopFront(map, stop.edge, stop.s, STREETCAR.length);
        if (k < 0 || !e || front === null || e.lanes < 2 || (run.lane ?? 0) >= e.lanes - 1) continue;
        const lengths = run.edges.map((id) => map.edges.get(id).length);
        let at = lengths.slice(0, k).reduce((a, l) => a + l, 0) + front - STREETCAR.length - TRAM_START_M - (CAR.length - CAR.rearOverhang), j = 0;
        if (at < 3) continue;
        while (j < k && at > lengths[j]) at -= lengths[j++];
        if (j < k || map.zoneSpans.has(stop.edge)) continue;
        const lane = map.lane(run.edges[j], map.edges.get(run.edges[j]).lanes - 1);
        if (!lane || lane.idx <= (run.lane ?? 0)) continue;
        sites.push({ lane, startS: at * lane.length / Math.max(1, lengths[j]), streetcar: { route: route.id, run: runIndex, stop: stop.id, edge: stop.edge, front } });
      }
    }));
    sites.sort((a, b) => a.streetcar.stop.localeCompare(b.streetcar.stop) || a.streetcar.route.localeCompare(b.streetcar.route));
    tramSiteCache.set(map, sites);
  }
  const sites = tramSiteCache.get(map), on = sites.filter((s) => s.lane.edgeRef.name === street);
  return on.length ? on : sites;
}

// Clear the tracks: a level crossing (sim/rail.js) on a street that ends at a junction where traffic
// can turn left, with 12 to 30 m of it between the far side of the train's envelope and where a car
// waits to turn there, and room for the car to come up to the crossing (TRACKS_START_M before where
// it stops, on the street straight before it where this one is too short). A car waits at the
// junction to turn left, and a queue of QUEUE_CARS stands behind it, the last TAIL_ROOM_M past the
// envelope: no room for the car past the tracks. Once the car's front is TRACKS_TRIGGER_M from the
// crossing, a streetcar standing TRAIN_START_M along its track sets off toward it, ringing; once it has
// passed by, QUEUE_CLEAR_S later (or QUEUE_MAX_S after it set off, whatever happens: a car stopped on
// the tracks holds the streetcar up), the car at the junction turns and the queue moves off. On the
// challenge's `street` where it has one.
const TRACKS_START_M = 95, TRACKS_TRIGGER_M = 30, TRAIN_START_M = 100, TAIL_ROOM_M = 2.5, QUEUE_CLEAR_S = 4, QUEUE_MAX_S = 30, QUEUE_GAP_M = [1.8, 4.5];
const trackSiteCache = new WeakMap();
function trackSites(map, street) {
  if (!trackSiteCache.has(map)) {
    const sites = [];
    for (const c of railIndex(map).crossings) for (const on of c.edges) {
      const e = map.edges.get(on.edge), lane = map.lane(on.edge, e.lanes - 1);
      if (!lane || e.ring || e.control) continue;
      const left = map.successors(on.edge).find((id) => map.classifyTurn(map.turnAngle(on.edge, id)) === "left");
      const straight = map.successors(on.edge).find((id) => map.classifyTurn(map.turnAngle(on.edge, id)) === "straight");
      if (!left || !straight) continue;
      const scale = lane.length / Math.max(1, e.length), x = crossingsAhead(map, lane.pts, lane.cum, 0, CAR, lane.length)[0];
      if (!x || x.c !== c) continue;
      const far = x.exit_m - CAR.length, lead = lane.length - map.crossingHalfWidth(on.edge) - 1, room = lead - far;
      if (room < 12 || room > 30) continue;
      // (the car starts on this street, or on the one straight before it)
      let start = lane, startS = x.stop_m - TRACKS_START_M;
      if (startS < 5) {
        const before = (map.inn.get(e.from) || []).map((id) => map.edges.get(id)).find((b) => !b.ring && !b.control && map.classifyTurn(map.turnAngle(b.id, on.edge)) === "straight" && b.length + startS > 8);
        if (!before) continue;
        start = map.lane(before.id, Math.min(lane.idx, before.lanes - 1)); startS += start.length;
      }
      sites.push({ lane: start, startS, ahead: start === lane ? null : lane, crossing: c.id, queue: { edge: on.edge, lane: lane.idx, lead: lead / scale, tail: (far + TAIL_ROOM_M) / scale, left, straight } });
    }
    sites.sort((a, b) => a.crossing.localeCompare(b.crossing) || a.queue.edge.localeCompare(b.queue.edge));
    trackSiteCache.set(map, sites);
  }
  const sites = trackSiteCache.get(map), on = sites.filter((s) => s.queue && map.edges.get(s.queue.edge).name === street);
  return on.length ? on : sites;
}

// Keep the box clear: a signalled approach in one lane whose light is green from BOX_GREEN_S[0] to
// BOX_GREEN_S[1] s into the drive, going straight on, along streets of one lane without a signal, to a
// junction within BOX_AHEAD_EDGES streets where traffic can turn left, with BOX_ROOM_M of them between
// the far side of the signal's junction (sim/junction-box.js boxEnd) and the line a car waits at to
// turn there (its sign's or give-way line, else just short of the junction). A car waits there to
// turn left, and a queue of cars stands behind it, the last BOX_TAIL_M past the signal's junction: no
// room for the car beyond it. The car starts BOX_START_M before the line (on the street straight
// before it where this one is too short), so it comes up on the green. BOX_RED_S after its light
// turns red (or BOX_MAX_S into the drive, whatever happens), the car at the far junction turns and
// the queue moves off; the car's light turns green again a while later. On the challenge's `street`
// where it has one. Positions along the streets past the signal (`queue`) are lane arc length from
// the junction's node.
const BOX_START_M = 60, BOX_ROUTE_M = 180, BOX_GREEN_S = [4, 20], BOX_ROOM_M = [15, 70], BOX_TAIL_M = 2.5, BOX_RED_S = 6, BOX_MAX_S = 90, BOX_AHEAD_EDGES = 3;
const boxSiteCache = new WeakMap();
function boxSites(map, street) {
  if (!boxSiteCache.has(map)) {
    const sites = [];
    const turn = (from, dir) => map.successors(from).find((id) => map.classifyTurn(map.turnAngle(from, id)) === dir);
    for (const e of map.edges.values()) {
      const c = e.control, inter = c?.type === "signal" ? map.intersections.get(c.id) : null;
      if (!inter || e.lanes !== 1 || e.ring) continue;
      let green = true;
      for (let t = BOX_GREEN_S[0]; t <= BOX_GREEN_S[1] && green; t += 0.5) green = movementSignal(approachPhase(inter, e.id, t), "straight") === "green";
      if (!green) continue;
      // (straight on past it to a junction where traffic can turn left)
      const ahead = [];
      let cur = e.id, length = 0, left = null, straight = null;
      for (let k = 0; k < BOX_AHEAD_EDGES; k++) {
        const next = turn(cur, "straight"), ne = next && map.edges.get(next);
        if (!ne || ne.lanes !== 1 || ne.ring || ne.control?.type === "signal") break;
        ahead.push(next); cur = next;
        if (isJunction(map, ne.to)) { left = turn(next, "left"); straight = turn(next, "straight"); break; }
        length += map.lane(next, 0).length;
      }
      if (!left || !straight) continue;
      const last = map.edges.get(cur), lane = map.lane(cur, 0), scale = lane.length / Math.max(1, last.length);
      const line = last.control?.s_line ?? map.priorityOf(cur)?.s_line ?? last.length - map.crossingHalfWidth(cur) - 1;
      const lead = length + line * scale, far = boxEnd(map, e.id, 0), room = lead - far;
      if (room < BOX_ROOM_M[0] || room > BOX_ROOM_M[1]) continue;
      // (the car starts on this street, or on the one straight before it)
      let start = map.lane(e.id, 0), startS = c.s_line * start.length / Math.max(1, e.length) - BOX_START_M;
      const approachLane = start;
      if (startS < 5) {
        const before = (map.inn.get(e.from) || []).map((id) => map.edges.get(id)).find((b) => !b.ring && !b.control && map.classifyTurn(map.turnAngle(b.id, e.id)) === "straight" && b.length + startS > 8);
        if (!before) continue;
        start = map.lane(before.id, 0); startS += start.length;
      }
      sites.push({ lane: start, startS, ahead: start === approachLane ? null : approachLane, signal: c.id, group: c.group, queue: { edges: ahead, lead, tail: far + BOX_TAIL_M, left, straight } });
    }
    sites.sort((a, b) => a.signal.localeCompare(b.signal) || a.queue.edges[0].localeCompare(b.queue.edges[0]));
    boxSiteCache.set(map, sites);
  }
  const sites = boxSiteCache.get(map), on = sites.filter((s) => (s.ahead || s.lane).edgeRef.name === street);
  return on.length ? on : sites;
}

// Not your arrow: an approach whose advance green shows as a left arrow (sim/signals.js), at least 90 m
// long with its line at least ARROW_START_M + 5 m along, with two lanes or more, a street straight
// on at least 60 m long and one to the left; where the light is red from 3 s and the arrow comes on
// between ARROW_AT_S, so the car is stopped at the line on the red before it does. The car starts
// ARROW_START_M before the line in the right lane, going straight; two cars wait at the line in the
// left lane to turn left, and a third comes up beside the car (ARROW_TURNERS). The route ends
// ARROW_ROUTE_M from the start, on the street straight on.
const ARROW_START_M = 95, ARROW_ROUTE_M = 220, ARROW_AT_S = [16, 32], ARROW_TURNERS = [{ back: 1, v: 0 }, { back: 8.5, v: 0 }, { back: 50, v: 9 }];
const arrowSiteCache = new WeakMap();
function arrowSites(map, street) {
  if (!arrowSiteCache.has(map)) {
    const sites = [];
    for (const inter of map.intersections.values()) {
      const adv = inter.plan?.advance, e = adv?.style === "arrow" ? map.edges.get(adv.edge) : null;
      if (!e || e.length < 90 || e.control?.s_line < ARROW_START_M + 5 || e.lanes < 2) continue;
      const turn = (dir, min) => map.successors(e.id).find((id) => map.classifyTurn(map.turnAngle(e.id, id)) === dir && map.edges.get(id).length > min);
      const straight = turn("straight", 60), left = turn("left", 40);
      if (!straight || !left) continue;
      let at = null;
      for (let t = 3; t <= ARROW_AT_S[1] && at === null; t += 0.5) {
        const shows = approachPhase(inter, e.id, t);
        if (shows === "arrow") at = t;
        else if (shows !== "red") break;
      }
      if (at === null || at < ARROW_AT_S[0]) continue;
      sites.push({ lane: map.lane(e.id, e.lanes - 1), signal: inter.id, straight, left, arrowAt: at });
    }
    sites.sort((a, b) => a.signal.localeCompare(b.signal));
    arrowSiteCache.set(map, sites);
  }
  const sites = arrowSiteCache.get(map), on = sites.filter((s) => s.lane.edgeRef.name === street);
  return on.length ? on : sites;
}
// The cars turning left on the arrow, in the left lane: held at their red like any driver.
function placeTurners(world, fleet, { edge, left }, seed) {
  const map = world.map, random = rng(seed), lane = map.lane(edge, 0), line = map.edges.get(edge).control.s_line * lane.length / Math.max(1, map.edges.get(edge).length);
  return ARROW_TURNERS.map(({ back, v }, i) => {
    const s = line - back - (CAR.length - CAR.rearOverhang), p = pointAt(lane.pts, lane.cum, s);
    const car = new Vehicle(p[0], p[1], headingAt(lane.pts, lane.cum, s), v);
    Object.assign(car, { id: `challenge_turner_${i + 1}`, color: [0x6b2737, 0xb0b5b9, 0x3d5a80][i], v0: 11, driver: { aMax: 1.5, b: 2, s0: 2, T: 1.2, react: 0.5 + random() * 0.3, lcRate: 0 },
      stopMem: new StopMemory(), path: new NpcPath(map, fleet.random), frozen: 0, waiting: 0 });
    car.path.start(edge, 0, s, [[left, 0]]); fleet.vehicles.push(car);
    return car.id;
  });
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
  const darks = challenge.hazard === "outage" ? darkSites(map, challenge.street) : null;
  if (darks && !darks.length) throw new Error("This map has no signal with four approaches, traffic from the right and ahead, and room to queue on each.");
  const stop = stops ? stops[Math.floor(random() * stops.length)] : darks ? darks[Math.floor(random() * darks.length)] : null;
  const blinds = challenge.hazard === "two-way" ? twoWaySites(map) : null;
  if (blinds && !blinds.length) throw new Error("This map has no two-way stop with a building hiding the through road.");
  const blind = blinds ? blinds[Math.floor(random() * blinds.length)] : null;
  const hooks = challenge.hazard === "right-hook" ? hookSites(map) : null;
  if (hooks && !hooks.length) throw new Error("This map has no right turn with a parking lane a cyclist rides straight on past.");
  const hook = hooks ? hooks[Math.floor(random() * hooks.length)] : null;
  const sirens = challenge.hazard === "emergency" ? sirenSites(map) : null;
  if (sirens && !sirens.length) throw new Error("This map has no long two-way street with a parking lane ending at a junction without a sign.");
  const siren = sirens ? sirens[Math.floor(random() * sirens.length)] : null;
  const buses = challenge.hazard === "bus" ? busSites(map, challenge.street) : null;
  if (buses && !buses.length) throw new Error("This map has no bus stop on a street with a limit of 60 km/h or less.");
  const bus = buses ? buses[Math.floor(random() * buses.length)] : null;
  const threats = challenge.hazard === "crosswalk" ? threatSites(map, challenge.street) : null;
  if (threats && !threats.length) throw new Error("This map has no marked crosswalk on a street with two lanes each way and a limit of 60 km/h or less.");
  const threat = threats ? threats[Math.floor(random() * threats.length)] : null;
  const schools = challenge.hazard === "school-bus" ? schoolSites(map, challenge.street) : null;
  if (schools && !schools.length) throw new Error("This map has no two-way street with one lane each way and a limit of 50 km/h or less long enough for a school bus to stop on.");
  const school = schools ? schools[Math.floor(random() * schools.length)] : null;
  const zones = challenge.hazard === "school-zone" ? zoneSites(map, challenge.street) : null;
  if (zones && !zones.length) throw new Error("This map has no school zone on a street with a parking lane and a higher limit of its own.");
  const zone = zones ? zones[Math.floor(random() * zones.length)] : null;
  const roadsides = challenge.hazard === "roadside" ? roadsideSites(map, challenge.street) : null;
  if (roadsides && !roadsides.length) throw new Error("This map has no street with two lanes going one way, a parking lane on the right and a limit between 40 and 80 km/h.");
  const roadside = roadsides ? roadsides[Math.floor(random() * roadsides.length)] : null;
  const trams = challenge.hazard === "streetcar" ? tramSites(map, challenge.street) : null;
  if (trams && !trams.length) throw new Error("This map has no streetcar stop on a street with another lane going its way beside the track.");
  const tram = trams ? trams[Math.floor(random() * trams.length)] : null;
  const tracks = challenge.hazard === "level-crossing" ? trackSites(map, challenge.street) : null;
  if (tracks && !tracks.length) throw new Error("This map has no level crossing with room for a short queue between the tracks and a junction past them.");
  const track = tracks ? tracks[Math.floor(random() * tracks.length)] : null;
  const boxes = challenge.hazard === "junction-box" ? boxSites(map, challenge.street) : null;
  if (boxes && !boxes.length) throw new Error("This map has no signalled junction on a one-lane street with room past it for a short queue before the next junction.");
  const box = boxes ? boxes[Math.floor(random() * boxes.length)] : null;
  const arrows = challenge.hazard === "left-arrow" ? arrowSites(map, challenge.street) : null;
  if (arrows && !arrows.length) throw new Error("This map has no signal with a left arrow on a street with two lanes or more, where the car can wait at a red before the arrow comes on.");
  const arrow = arrows ? arrows[Math.floor(random() * arrows.length)] : null;
  const flaggers = challenge.hazard === "work-zone" ? flaggerSites(map, challenge.street) : null;
  if (flaggers && !flaggers.length) throw new Error("This map has no straight block of a two-way street with one lane each way, a limit above 30 km/h and room for a work zone.");
  const flagger = flaggers ? flaggers[Math.floor(random() * flaggers.length)] : null;
  const vans = challenge.hazard === "double-parked" ? doubleParkSites(map, challenge.street) : null;
  if (vans && !vans.length) throw new Error("This map has no straight block of a two-way street with one lane each way and a parking lane, with room for a van to double-park.");
  const van = vans ? vans[Math.floor(random() * vans.length)] : null;
  const start = van?.lane || flagger?.lane || arrow?.lane || box?.lane || track?.lane || tram?.lane || roadside?.lane || zone?.lane || school?.lane || threat?.lane || site?.lane || left?.lane || right?.lane || stop?.lane || blind?.lane || hook?.lane || siren?.lane || bus?.prev || lanes[Math.floor(random() * lanes.length)];
  // a left or right turn, or a stop sign, starts 70 m before the stop line; a right hook, 95 m
  // before the corner
  const startS = site ? site.hazardS - 65 : left || right || stop || blind ? start.edgeRef.control.s_line - 70 : arrow ? start.edgeRef.control.s_line - ARROW_START_M : hook ? start.length - HOOK_START_M : siren ? start.length - SIREN_START_M
    : bus ? Math.max(5, start.length - (BUS_START_M - bus.rear)) : threat ? threat.s - THREAT_START_M : school ? school.startS : zone ? zone.startS : roadside ? roadside.startS : tram ? tram.startS : track ? track.startS : box ? box.startS : flagger ? flagger.startS : van ? van.startS : Math.max(8, Math.min(20, start.length * 0.15));
  const chain = [start], seen = new Set([start.edge]);
  let length = start.length - startS;
  if (left) { const turn = map.lane(left.left, 0); chain.push(turn); seen.add(left.left); length += turn.length; }
  const turnRight = right?.right || hook?.right;
  if (turnRight) { const e = map.edges.get(turnRight), turn = map.lane(turnRight, e.lanes - 1); chain.push(turn); seen.add(turnRight); length += turn.length; }
  const straight = arrow?.straight || stop?.straight || blind?.straight || siren?.straight || bus?.lane.edge || track?.ahead?.edge || box?.ahead?.edge;
  if (straight) { const ahead = bus ? bus.lane : track ? track.ahead : box?.ahead ? box.ahead : map.lane(straight, Math.min(start.idx, map.edges.get(straight).lanes - 1)); chain.push(ahead); seen.add(straight); length += ahead.length; }
  // (through the signal, along the queue past it)
  for (const id of box?.queue.edges || []) { const lane = map.lane(id, 0); chain.push(lane); seen.add(id); length += lane.length; }
  // (past a box, only as far as the street after the queue: the queue moves off ahead of the car)
  // (past a double-parked van, along its street only)
  for (let i = 0; i < 12 && !van && length < (box ? BOX_ROUTE_M : arrow ? ARROW_ROUTE_M : 260); i++) {
    const previous = chain.at(-1);
    const successors = map.successors(previous.edge).filter(id => !seen.has(id) && Math.abs(map.turnAngle(previous.edge, id)) < 130 * Math.PI / 180);
    successors.sort((a, b) => Math.abs(map.turnAngle(previous.edge, a)) - Math.abs(map.turnAngle(previous.edge, b)) || String(a).localeCompare(String(b)));
    if (!successors.length) break;
    const id = successors[0], edge = map.edges.get(id), turn = map.classifyTurn(map.turnAngle(previous.edge, id));
    const lane = map.lane(id, turn === "left" ? 0 : edge.lanes - 1);
    chain.push(lane); seen.add(id); length += lane.length;
  }
  // (past an arrow, ARROW_ROUTE_M in all, the destination on the last street short of its end)
  const last = chain.at(-1), goalS = arrow ? Math.min(last.length - 10, Math.max(10, last.length - (length - ARROW_ROUTE_M))) : van ? van.goalS : last.length - 10;
  const route = routeFromLanes(map, chain, startS, Math.max(10, goalS));
  const p = pointAt(start.pts, start.cum, startS);
  return { id: challenge.id, start: { edge: start.edge, lane: start.idx, s: startS, x: p[0], y: p[1], psi: headingAt(start.pts, start.cum, startS) },
    route, goal: route.polyline.at(-1), traffic_seed: challenge.seed,
    ...(site ? { crossing: { hazardS: site.hazardS, from: site.from, to: site.to } } : {}),
    ...(left ? { oncoming: { edge: left.opposite, then: left.straight } } : {}),
    ...(right ? { oncoming: { edge: right.fromLeft, then: right.right, lane: "curb" } } : {}),
    ...(stop ? { allWay: allWayCars(map, stop) } : {}),
    ...(stop?.signal ? { outage: { signal: stop.signal } } : {}),
    ...(blind ? { twoWay: twoWayCars(map, blind) } : {}),
    ...(hook ? { cyclist: { edge: hook.lane.edge, s: startS + HOOK_LEAD_M, then: hook.straight } } : {}),
    ...(siren ? { emergency: { kind: "ambulance", relation: "behind", distance: SIREN_BACK_M } } : {}),
    ...(bus ? { bus: bus.bus } : {}),
    ...(school ? { schoolBus: school.bus } : {}),
    ...(zone ? { child: { s: zone.hazardS, zone: zone.zone } } : {}),
    ...(roadside ? { roadside: roadside.stop } : {}),
    ...(flagger ? { workZone: flagger.zone } : {}),
    ...(van ? { doubleParked: van.van } : {}),
    ...(tram ? { streetcar: tram.streetcar } : {}),
    ...(track ? { levelCrossing: { crossing: track.crossing, queue: track.queue } } : {}),
    ...(box ? { junctionBox: { signal: box.signal, group: box.group, queue: box.queue } } : {}),
    ...(arrow ? { leftArrow: { signal: arrow.signal, edge: start.edge, left: arrow.left } } : {}),
    ...(threat ? { multiThreat: { crosswalk: threat.crosswalk, s: threat.s, curb: { edge: threat.curb.edge, lane: threat.curb.idx, s: threat.sCurb } } } : {}),
    tags: { length_m: Math.round(length), signals: chain.filter(l => l.edgeRef.control?.type === "signal").length,
      stops: chain.filter(l => l.edgeRef.control?.type === "stop").length, lefts: route.turns.filter(t => t.dir === "left").length, rights: route.turns.filter(t => t.dir === "right").length } };
}

export function installChallenge(world, fleet, challenge, scenario) {
  const lane = world.map.lane(scenario.start.edge, scenario.start.lane);
  // an oncoming hazard is placed at the stop line
  const hazardS = scenario.crossing?.hazardS ?? scenario.multiThreat?.s ?? scenario.child?.s ?? (scenario.oncoming || scenario.allWay || scenario.twoWay ? lane.edgeRef.control.s_line : scenario.cyclist || scenario.emergency ? lane.length : Math.min(lane.length - 15, scenario.start.s + 65));
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
  if (scenario.bus) Object.assign(world.challenge, placeBus(world, fleet, scenario.bus));
  if (scenario.multiThreat) Object.assign(world.challenge, placeThreat(world, fleet, scenario.multiThreat, challenge.seed));
  if (scenario.schoolBus) Object.assign(world.challenge, placeSchoolBus(world, fleet, scenario.schoolBus, challenge.seed));
  if (scenario.child) Object.assign(world.challenge, placeChild(world, lane, scenario.child.s, challenge.seed));
  if (scenario.roadside) Object.assign(world.challenge, placeTowTruck(world, scenario.roadside, challenge.seed));
  if (scenario.streetcar) Object.assign(world.challenge, placeStreetcar(world, fleet, scenario.streetcar, challenge.seed));
  if (scenario.levelCrossing) Object.assign(world.challenge, placeLevelCrossing(world, fleet, scenario.levelCrossing, challenge.seed));
  if (scenario.junctionBox) Object.assign(world.challenge, placeBoxQueue(world, fleet, scenario.junctionBox, challenge.seed));
  if (scenario.workZone) Object.assign(world.challenge, placeWorkZone(world, fleet, scenario.workZone, challenge.seed));
  if (scenario.doubleParked) Object.assign(world.challenge, placeVan(world, fleet, scenario.doubleParked, challenge.seed));
  // (the signal's lights are out for the whole drive)
  if (scenario.outage) { world.outages.cut(scenario.outage.signal); world.challenge.signalId = scenario.outage.signal; }
  if (scenario.leftArrow) {
    const inter = world.map.intersections.get(scenario.leftArrow.signal);
    Object.assign(world.challenge, { turnerIds: placeTurners(world, fleet, scenario.leftArrow, challenge.seed), signalId: scenario.leftArrow.signal, arrowEdge: scenario.leftArrow.edge, ...(inter ? { at: [inter.x, inter.y] } : {}) });
  }
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
    : state.hazard === "school-zone" ? local.ahead < CHILD_TRIGGER_M + world.ego.spec.length - world.ego.spec.rearOverhang
    : state.hazard === "roadside" ? local.ahead < OPERATOR_TRIGGER_M + world.ego.spec.length - world.ego.spec.rearOverhang
    : state.hazard === "streetcar" ? local.ahead < RIDER_TRIGGER_M + world.ego.spec.length - world.ego.spec.rearOverhang
    : state.hazard === "level-crossing" ? local.ahead < TRACKS_TRIGGER_M + world.ego.spec.length - world.ego.spec.rearOverhang
    : state.hazard === "work-zone" ? local.ahead < WZ_TRIGGER_M + world.ego.spec.length - world.ego.spec.rearOverhang
    : state.hazard === "double-parked" ? local.ahead < VAN_TRIGGER_M + world.ego.spec.length - world.ego.spec.rearOverhang
    // (the arrow comes on, and the cars beside the car turn)
    : state.hazard === "left-arrow" ? approachPhase(world.map.intersections.get(state.signalId), state.arrowEdge, world.t) === "arrow"
    : local.ahead < (state.hazard === "pull" ? 65 : ["oncoming", "cross", "all-way", "outage", "right-hook", "emergency", "bus", "crosswalk", "school-bus"].includes(state.hazard) ? ONCOMING_TRIGGER_M : 43);
  if (!state.triggered && trigger && local.ahead > 0) {
    state.triggered = true;
    if (state.oncoming) state.oncomingIds = releaseOncoming(world, fleet, state.oncoming);
    if (state.allWay) state.allWayIds = releaseAllWay(world, fleet, state.allWay);
    if (state.twoWay) state.twoWayIds = releaseThrough(world, fleet, state.twoWay);
    if (state.emergency) state.emergencyId = fleet.dispatchEmergency(state.emergency)?.id || null;
    // (its doors close and it signals to pull out)
    const bus = state.busId && fleet.vehicles.find(v => v.id === state.busId);
    if (bus && bus.transit.phase === "dwell") bus.transit.dwell = bus.transit.t;
    if (state.carId) {
      const car = world.parked.list.find(c => c.id === state.carId);
      if (state.hazard === "pull") { const merging = fleet.startPullOut(car); state.mergingId = merging?.id || null; }
      else world.parked.openDoor(car);
    }
    if (state.pedestrianId) {
      const ped = world.crowd.list.find(p => p.id === state.pedestrianId);
      ped.frozen = 0; ped.crossing = ped.path[0].cross;
    }
    // (the stopped car waits for them as any driver would)
    const stopper = state.stopperId && fleet.vehicles.find(v => v.id === state.stopperId);
    if (stopper) stopper.frozen = 0;
    // (the school bus keeps its reds on until the child is across, and a few seconds more)
    const school = state.schoolBusId && fleet.vehicles.find(v => v.id === state.schoolBusId);
    if (school?.school.phase === "red") Object.assign(school.school, { held: false, t: 0, red: SCHOOL_RED_S });
    const child = state.childId && world.crowd.list.find(p => p.id === state.childId);
    if (child) child.held = false;
    // (the rider walks out to the streetcar's doors)
    const rider = state.riderId && world.crowd.list.find(p => p.id === state.riderId);
    if (rider) { rider.held = false; rider.crossing = rider.path[0].cross; }
    // (the streetcar sets off toward the crossing, ringing)
    const train = state.trainId && fleet.vehicles.find(v => v.id === state.trainId);
    if (train) Object.assign(train.rail, { held: false, dwell: 0 });
    // (the cars at the far end of the work zone set off through its one lane)
    for (const id of state.zoneCarIds || []) { const car = fleet.vehicles.find(v => v.id === id); if (car) car.frozen = 0; }
    // (the cars coming the other way past the double-parked van set off down the oncoming lane)
    for (const id of state.vanCarIds || []) { const car = fleet.vehicles.find(v => v.id === id); if (car) { car.frozen = 0; car.v = car.v0; } }
  }
  // (once the last of them is past its stop line, the flaggers go on as usual)
  if (state.workZoneId && state.triggered && !state.released) {
    const z = world.workZones.zones.find(w => w.id === state.workZoneId), e = z && world.map.edges.get(z.open);
    state.setOff ??= world.t;
    const past = (car) => !car || projectPoint(e.pts, e.cum, [car.x, car.y], null).s + car.spec.length - car.spec.rearOverhang > e.length - z.b + 1;
    if (!z || state.zoneCarIds.every(id => past(fleet.vehicles.find(v => v.id === id))) || world.t - state.setOff >= WZ_HOLD_MAX_S) {
      state.released = true;
      if (z) z.held = false;
    }
  }
  // (once it has passed by the crossing, QUEUE_CLEAR_S later the car at the junction turns, and the
  // queue behind it moves off)
  if (state.queueIds && state.triggered && !state.released) {
    const train = fleet.vehicles.find(v => v.id === state.trainId), c = railIndex(world.map).crossings.find(x => x.id === state.crossingId);
    const passed = !train || train.rail.gone || (c && !approach(train, c) && train.rail.dir * (trainSpan(train).rear - c.s) > 0);
    if (passed) state.passedAt ??= world.t;
    state.setOff ??= world.t;
    if ((state.passedAt !== undefined && world.t - state.passedAt >= QUEUE_CLEAR_S) || world.t - state.setOff >= QUEUE_MAX_S) {
      state.released = true;
      for (const id of state.queueIds) { const car = fleet.vehicles.find(v => v.id === id); if (car) car.frozen = 0; }
    }
  }
  // (BOX_RED_S after the car's light turns red, the car at the far junction turns, and the queue
  // behind it moves off)
  if (state.boxQueueIds && !state.released) {
    if (world.phase(state.signalId)[state.signalGroup] === "red" && world.t > BOX_GREEN_S[1]) state.redAt ??= world.t;
    if ((state.redAt !== undefined && world.t - state.redAt >= BOX_RED_S) || world.t >= BOX_MAX_S) {
      state.released = true;
      for (const id of state.boxQueueIds) { const car = fleet.vehicles.find(v => v.id === id); if (car) car.frozen = 0; }
    }
  }
  // (once the rider is aboard, the streetcar closes its doors RIDER_ABOARD_S later and moves off)
  const tram = state.streetcarId && state.triggered ? fleet.vehicles.find(v => v.id === state.streetcarId) : null;
  if (tram?.transit.held && !world.crowd.list.some(p => p.id === state.riderId)) Object.assign(tram.transit, { held: false, dwell: tram.transit.t + RIDER_ABOARD_S });
  const ped = state.pedestrianId && world.crowd.list.find(p => p.id === state.pedestrianId);
  // (the tow truck's operator stands in the lane a moment before stepping back)
  if (ped && state.hazard === "roadside" && state.triggered && !state.paused && ped.path.length === 1) { state.paused = true; ped.frozen = OPERATOR_PAUSE_S; }
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

// Pulling out: the car starts 100 m behind a bus standing at its stop, doors open. Once the car is
// 45 m from the bus's rear the bus shuts its doors and signals to pull out.
const BUS_START_M = 100;
function placeBus(world, fleet, { route: routeId, run: runIndex, stop: stopId, edge, front }) {
  const map = world.map, route = map.transit.routes.find(r => r.id === routeId), run = route.runs[runIndex];
  const k = run.edges.indexOf(edge), before = run.edges.slice(0, k).reduce((a, id) => a + map.edges.get(id).length, 0);
  const bus = fleet.spawnBus(0, { route, run }, before + front - (BUS.length - BUS.rearOverhang));
  if (!bus) return { busId: null };
  // standing at its stop, pulled in to the curb, doors open, until the car comes up behind it
  const e = map.edges.get(edge), shift = curbShift(e, e.lanes - 1);
  bus.x += Math.sin(bus.psi) * shift; bus.y -= Math.cos(bus.psi) * shift; bus.v = 0;
  Object.assign(bus.transit, { phase: "dwell", stop: { id: stopId, edge, front }, curb: shift, shift, t: 0, dwell: Infinity, doors: true });
  bus.doors = true;
  return { busId: bus.id, at: [bus.x - Math.cos(bus.psi) * BUS.rearOverhang, bus.y - Math.sin(bus.psi) * BUS.rearOverhang] };
}
// The multiple threat: the car stopped at the crosswalk in the curb lane, and the person on the
// crosswalk just in front of it, 0.6 m right of its middle, about to walk on across to the far
// sidewalk. Both wait for the car to come up.
function placeThreat(world, fleet, { crosswalk, curb }, seed) {
  const map = world.map, cw = world.crowd.marked.find(c => c.id === crosswalk);
  const lane = map.lane(curb.edge, curb.lane), front = CAR.length - CAR.rearOverhang;
  const at = (s) => pointAt(lane.pts, lane.cum, s), psi = headingAt(lane.pts, lane.cum, curb.s);
  const p = at(curb.s - HOLD_M - front);
  const car = new Vehicle(p[0], p[1], psi, 0);
  Object.assign(car, { id: "challenge_stopped", color: 0x5a6b7a, v0: 11, driver: { aMax: 1.2, b: 2, s0: 2, T: 1.4, react: 0.8, lcRate: 0 },
    stopMem: new StopMemory(), path: new NpcPath(map, fleet.random), frozen: 1e6, waiting: 0 });
  car.path.start(curb.edge, curb.lane, curb.s - HOLD_M - front); fleet.vehicles.push(car);
  if (!cw) return { stopperId: car.id, pedestrianId: null };
  // the far side of the street from the curb lane
  const c = at(curb.s), right = (q) => (q[0] - c[0]) * Math.sin(psi) - (q[1] - c[1]) * Math.cos(psi);
  const near = right(cw.ends[1]) > 0 ? 1 : -1, from = cw.ends[near], to = cw.ends[-near];
  const start = [c[0] + Math.sin(psi) * 0.6, c[1] - Math.cos(psi) * 0.6];
  const ped = new Pedestrian({ id: "challenge_pedestrian", x: start[0], y: start[1], psi: Math.atan2(to[1] - start[1], to[0] - start[0]),
    v: 0, speed: 1.35, path: [{ p: to, cross: { node: null, marked: cw.id, from, to } }], crossing: null, waiting: 0, phase: 0, look: seed, at: null });
  ped.frozen = 1e6;
  world.crowd.list.push(ped);
  return { stopperId: car.id, pedestrianId: ped.id };
}
// Flashing reds: the school bus standing at its stop, coming toward the car, its reds flashing and its
// stop arm out, and a child just off it by its door, about to walk forward past its front and cross
// in front of it to the far sidewalk. Both wait for the car to come up; the reds then stay on until
// the child is across and for SCHOOL_RED_S from when the car came up.
const SCHOOL_RED_S = 6;
function placeSchoolBus(world, fleet, { edge, s }, seed) {
  const map = world.map, e = map.edges.get(edge), lane = map.lane(edge, 0), scale = lane.length / Math.max(1, e.cum[e.cum.length - 1]);
  const bus = fleet.addSchoolBus(lane, s * scale - (SCHOOL_BUS.length - SCHOOL_BUS.rearOverhang), 0);
  Object.assign(bus.school, { phase: "red", lights: "red", arm: true, doors: true, held: true, t: 0, red: Infinity, stops: 1, stop: { edge, s }, every: Infinity });
  bus.doors = true;
  const child = world.crowd.alight(bus, e, true, rng(seed));
  child.id = "challenge_child";
  child.held = true;
  const front = SCHOOL_BUS.length - SCHOOL_BUS.rearOverhang;
  return { schoolBusId: bus.id, childId: child.id, at: [bus.x + Math.cos(bus.psi) * front, bus.y + Math.sin(bus.psi) * front] };
}
// School zone: two cars parked 11 m apart (centre to centre) in the parking lane, and a child at the
// curb between them, who will run straight across the street to the far curb without looking
// (`dart`: unlike the crowd, they do not wait for a car that could not stop for them).
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
// Move over: the tow truck at the curb, lights flashing, the car it is about to tow parked behind it,
// and its operator between the two, at the traffic side, about to step out into the curb lane (see
// roadsideSites).
function placeTowTruck(world, { edge, from, to }, seed) {
  const e = world.map.edges.get(edge), stop = world.roadside.place({ edge, from, to, kind: "tow_truck", gap: OPERATOR_GAP_M, color: 0x6b7f8c });
  const truck = stop.vehicle, h = truck.psi, { rear } = endsOf(truck);
  const at = (back, right) => [rear[0] - Math.cos(h) * back + Math.sin(h) * right, rear[1] - Math.sin(h) * back - Math.cos(h) * right];
  const toLane = e.lane_offsets[e.lanes - 1] - curbOffset(e, TOW_TRUCK);
  const start = at(OPERATOR_GAP_M / 2, -(TOW_TRUCK.width / 2 - 0.4)), out = at(OPERATOR_GAP_M / 2, toLane + OPERATOR_OUT_M);
  const ped = new Pedestrian({ id: "challenge_operator", x: start[0], y: start[1], psi: Math.atan2(out[1] - start[1], out[0] - start[0]), v: 0, speed: OPERATOR_MPS, dart: true, worker: true,
    path: [{ p: out, cross: { node: null, from: start, to: out, jaywalk: true } }, { p: start }], crossing: null, waiting: 0, phase: 0, look: seed, at: null });
  ped.frozen = 1e6;
  world.crowd.list.push(ped);
  return { pedestrianId: ped.id, roadsideId: truck.id, at: start };
}
// Behind the doors: the streetcar standing at its stop, doors open, held there until its rider is
// aboard; and the rider at the curb abreast of its rear doors, who will walk out to them across the
// lane beside it without looking (`dart`), and get on (see tramSites).
function placeStreetcar(world, fleet, { route: routeId, run: runIndex, stop: stopId, edge, front }, seed) {
  const map = world.map, route = map.transit.routes.find(r => r.id === routeId), run = route.runs[runIndex];
  const k = run.edges.indexOf(edge), before = run.edges.slice(0, k).reduce((a, id) => a + map.edges.get(id).length, 0);
  const car = fleet.spawnBus(0, { route, run }, before + front - (STREETCAR.length - STREETCAR.rearOverhang), true);
  if (!car) return { streetcarId: null };
  car.v = 0;
  Object.assign(car.transit, { phase: "dwell", stop: { id: stopId, edge, front }, t: 5, dwell: Infinity, doors: true, held: true });
  car.doors = true;
  const e = map.edges.get(edge), door = doorPoints(car)[3], q = projectPoint(e.pts, e.cum, door, null);
  const h = headingAt(e.pts, e.cum, q.s), curb = [q.point[0] + Math.sin(h) * (e.asphalt[1] + 0.3), q.point[1] - Math.cos(h) * (e.asphalt[1] + 0.3)];
  const rider = new Pedestrian({ id: "challenge_rider", x: curb[0], y: curb[1], psi: Math.atan2(door[1] - curb[1], door[0] - curb[0]), v: 0, speed: RIDER_MPS, dart: true,
    path: [{ p: door, cross: { node: null, from: curb, to: door, jaywalk: true, streetcar: car.id, boarding: true } }], crossing: null, waiting: 0, phase: 0, look: seed, at: null,
    streetcar: car.id, boarding: true, home: true, held: true });
  world.crowd.list.push(rider);
  return { streetcarId: car.id, riderId: rider.id, at: curb };
}
// Clear the tracks: the car waiting at the junction to turn left, its indicator on, and the queue
// behind it, all held until the streetcar has passed by; and the streetcar, standing on its track
// TRAIN_START_M from the crossing on the side hidden from the car where one is, held until the car
// comes up (see trackSites).
function placeLevelCrossing(world, fleet, { crossing, queue }, seed) {
  const map = world.map, e = map.edges.get(queue.edge), lane = map.lane(queue.edge, queue.lane), scale = lane.length / Math.max(1, e.length);
  const random = rng(seed), ids = [], front = CAR.length - CAR.rearOverhang;
  let at = queue.lead * scale;
  const tail = queue.tail * scale, count = Math.max(1, Math.floor((at - tail + QUEUE_GAP_M[0]) / (CAR.length + QUEUE_GAP_M[0])));
  const gap = count > 1 ? Math.min(QUEUE_GAP_M[1], (at - tail - count * CAR.length) / (count - 1)) : 0;
  for (let i = 0; i < count; i++) {
    const s = at - front, p = pointAt(lane.pts, lane.cum, s);
    const car = new Vehicle(p[0], p[1], headingAt(lane.pts, lane.cum, s), 0);
    Object.assign(car, { id: `challenge_queue_${i + 1}`, color: [0x3d5a80, 0xb0b5b9, 0x6b2737, 0x2f4f3a][i % 4], v0: 11, driver: { aMax: 1.4, b: 2, s0: 2, T: 1.3, react: 0.6 + random() * 0.4, lcRate: 0 },
      stopMem: new StopMemory(), path: new NpcPath(map, fleet.random), frozen: 1e6, waiting: 0, ...(i === 0 ? { signal: "left" } : {}) });
    car.path.start(queue.edge, queue.lane, s, [[i === 0 ? queue.left : queue.straight, 0]]);
    fleet.vehicles.push(car); ids.push(car.id);
    at -= CAR.length + gap;
  }
  const c = railIndex(map).crossings.find(x => x.id === crossing), track = c && railIndex(map).tracks.get(c.track);
  if (!track) return { queueIds: ids, crossingId: crossing, trainId: null };
  // (from whichever side the car cannot see the track from, where it starts: else from the far end)
  const ego = world.ego, sides = [1, -1].map(dir => ({ dir, front: c.s - dir * TRAIN_START_M })).filter(o => o.front > 15 && o.front < track.length - 15);
  const hidden = sides.find(o => { const p = pointAt(track.pts, track.cum, o.front); return world.visibility.occluded([ego.x, ego.y], p); }) || sides.at(-1);
  const train = hidden && fleet.spawnTrain(false, track, hidden.front, hidden.dir);
  if (train) { train.v = 0; Object.assign(train.rail, { phase: "dwell", held: true, dwell: Infinity, t: 0 }); }
  return { queueIds: ids, crossingId: crossing, trainId: train?.id || null, at: [c.x, c.y] };
}
// Keep the box clear: the car waiting at the far junction to turn left, its indicator on, and the
// queue behind it back to just past the signal's junction, all held until the car's light has been
// red a while (see boxSites).
function placeBoxQueue(world, fleet, { signal, group, queue }, seed) {
  const map = world.map, random = rng(seed), ids = [], front = CAR.length - CAR.rearOverhang;
  const lanes = queue.edges.map((id) => map.lane(id, 0));
  const count = Math.max(1, Math.floor((queue.lead - queue.tail + QUEUE_GAP_M[0]) / (CAR.length + QUEUE_GAP_M[0])));
  const gap = count > 1 ? Math.min(QUEUE_GAP_M[1], (queue.lead - queue.tail - count * CAR.length) / (count - 1)) : 0;
  // (from the last of the queue, its rear BOX_TAIL_M past the junction, up to the car turning left)
  for (let i = count - 1; i >= 0; i--) {
    let s = queue.tail + i * (CAR.length + gap) + CAR.rearOverhang, k = 0;
    while (k < lanes.length - 1 && s > lanes[k].length) { s -= lanes[k].length; k++; }
    const lane = lanes[k], p = pointAt(lane.pts, lane.cum, s), lead = i === count - 1;
    const car = new Vehicle(p[0], p[1], headingAt(lane.pts, lane.cum, s), 0);
    Object.assign(car, { id: `challenge_queue_${count - i}`, color: [0x3d5a80, 0xb0b5b9, 0x6b2737, 0x2f4f3a][(count - i - 1) % 4], v0: 11, driver: { aMax: 1.4, b: 2, s0: 2, T: 1.3, react: 0.6 + random() * 0.4, lcRate: 0 },
      stopMem: new StopMemory(), path: new NpcPath(map, fleet.random), frozen: 1e6, waiting: 0, ...(lead ? { signal: "left" } : {}) });
    car.path.start(lane.edge, 0, s, [...queue.edges.slice(k + 1).map((id) => [id, 0]), [lead ? queue.left : queue.straight, 0]]);
    fleet.vehicles.push(car); ids.push(car.id);
  }
  const inter = map.intersections.get(signal);
  return { boxQueueIds: ids, signalId: signal, signalGroup: group, ...(inter ? { at: [inter.x, inter.y] } : {}) };
}
// The work zone (see flaggerSites), its flaggers holding STOP for the car, and the cars waiting at its
// far end, short of their stop line, until the car comes up.
function placeWorkZone(world, fleet, { closed, open, a }, seed) {
  const map = world.map, random = rng(seed), z = world.workZones.place({ closed, open, a, phase: "open" }), ids = [];
  z.held = true;
  const e = map.edges.get(open), lane = map.lane(open, 0), line = e.length - z.b;
  for (let i = 0; i < WZ_CARS; i++) {
    // (rear axles: the first one's front 4 m short of its line)
    const s = (line - 4 - (CAR.length - CAR.rearOverhang) - i * WZ_CAR_GAP_M) * lane.length / e.length;
    const p = pointAt(lane.pts, lane.cum, s), car = new Vehicle(p[0], p[1], headingAt(lane.pts, lane.cum, s), 0);
    Object.assign(car, { id: `challenge_zone_${i + 1}`, color: [0x2b3a55, 0xb0b5b9, 0x9b1e1e][i % 3], v0: 11, driver: { aMax: 1.4, b: 2, s0: 2, T: 1.3, react: 0.5 + random() * 0.3, lcRate: 0 },
      stopMem: new StopMemory(), path: new NpcPath(map, fleet.random), frozen: 1e6, waiting: 0 });
    car.path.start(open, 0, s);
    fleet.vehicles.push(car); ids.push(car.id);
  }
  return { workZoneId: z.id, zoneCarIds: ids, at: z.flaggers.closed };
}
// The double-parked van (see doubleParkSites), held there, the cars parked at the curb beside it, and
// the cars that will come down the oncoming lane, waiting out of sight until the car comes up.
function placeVan(world, fleet, { edge, rear }, seed) {
  const map = world.map, random = rng(seed), d = world.doubleParked.place({ edge, rear, color: 0xf2f2ee }), ids = [];
  d.held = true;
  const e = map.edges.get(edge), lat = curbOffset(e, CAR);
  for (let i = 0; i < VAN_PARKED; i++) {
    const s = rear - 13 + i * 6.5 + CAR.rearOverhang, p = pointAt(e.pts, e.cum, s), h = headingAt(e.pts, e.cum, s);
    const car = new Vehicle(p[0] + Math.sin(h) * lat, p[1] - Math.cos(h) * lat, h, 0);
    Object.assign(car, { id: `challenge_parked_${i + 1}`, color: [0x2b3a55, 0x8d9299, 0x9b1e1e, 0x1a1c20][i % 4], style: [0, 3, 1, 5][i % 4], curb: "right", edge, stay: true });
    world.parked.add(car);
  }
  const o = map.edges.get(d.opposite), lane = map.lane(o.id, 0);
  for (let i = 0; i < VAN_CARS; i++) {
    // (rear axles, in the oncoming edge's own `s`: the first one's front VAN_ONCOMING_M past the van's front)
    const s = (o.length - (d.front + VAN_ONCOMING_M + i * VAN_CAR_GAP_M) + (CAR.length - CAR.rearOverhang)) * lane.length / o.length;
    const p = pointAt(lane.pts, lane.cum, s), car = new Vehicle(p[0], p[1], headingAt(lane.pts, lane.cum, s), 0);
    Object.assign(car, { id: `challenge_oncoming_${i + 1}`, color: [0x9b1e1e, 0xb0b5b9][i % 2], v0: o.limit, driver: { aMax: 1.4, b: 2, s0: 2, T: 1.3, react: 0.5 + random() * 0.3, lcRate: 0 },
      stopMem: new StopMemory(), path: new NpcPath(map, fleet.random), frozen: 1e6, waiting: 0 });
    car.path.start(o.id, 0, s);
    fleet.vehicles.push(car); ids.push(car.id);
  }
  return { vanId: d.van.id, vanCarIds: ids, at: pointAt(e.pts, e.cum, rear) };
}
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
