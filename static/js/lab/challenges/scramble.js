// All walk: a right turn at a scramble crossing (sim/signals.js) where right turns on red are allowed
// elsewhere on the map, from an approach of the challenge's `street` (where it has one) reached
// straight on from the block before it, with no sign or signal there, and whose light (with the
// scramble running) is red from SCR_RED_S[0] to past the end of the all-walk, which starts within
// SCR_RED_S: the car, setting off SCR_START_M short of the line, arrives on red, and waits through
// the scramble. Two people stand at the corner opposite the one the car turns round
// (SCR_CORNER_M of its route through the junction): on the walk, one crosses diagonally to it at an
// even pace, the other at SCR_SLOW_MPS, still crossing as the car's light turns green.
import { pointAt, headingAt } from "../../map/mapdata.js";
import { CAR } from "../../sim/vehicle.js";
import { Pedestrian } from "../../sim/pedestrians.js";
import { sidewalkOffset } from "../../map/streets.js";
import { rng } from "../../common.js";
import { laneScenario, pick } from "./shared/kit.js";

export const challenge = { id: "scramble", title: "All walk", map: "victoria", weather: "dry", time: "afternoon", seed: 32042, icon: "✕", difficulty: "Patience", hazard: "scramble", scrambles: true, street: "Wharf Street",
  description: "You're turning right from Wharf Street onto Government Street, by the Empress, where the signal has a scramble crossing: every light turns red together while people cross every way, diagonally too. Your light turns red as you arrive.", lesson: "At a scramble crossing there is no turning right on red: the red stays red for everyone while people cross the junction every way at once, so wait at the line for your own green. When it comes, anyone still crossing, a slow walker finishing the diagonal say, still has the right of way: let them reach the kerb before you turn." };

const SCR_START_M = 75, SCR_RED_S = [12, 45], SCR_SLOW_MPS = 0.45;
const scrambleSiteCache = new WeakMap();
function scrambleSites(map, street) {
  if (!scrambleSiteCache.has(map)) {
    const sites = [], front = CAR.length - CAR.rearOverhang;
    for (const id of map.rightOnRed ? map.scrambles || [] : []) {
      const inter = map.intersections.get(id), plan = inter.scramblePlan;
      for (const a of inter.approaches) {
        const e = map.edges.get(a.edge), right = map.successors(e.id).find((x) => map.classifyTurn(map.turnAngle(e.id, x)) === "right");
        if (!right) continue;
        const before = (map.inn.get(e.from) || []).map((x) => map.edges.get(x)).find((p) => p.name === e.name && !p.control && Math.abs(map.turnAngle(p.id, e.id)) < 0.2);
        const reach = (before?.length || 0) + e.control.s_line;
        if (!before || reach < SCR_START_M + front - 1) continue;
        // (the light as it shows with the scramble running: the plan's own phases)
        const c = plan.cycle, at = (t) => ((t + (inter.offset_s || 0)) % c + c) % c, inA = (u, g) => { const d = u - plan[g].start; return d >= 0 && d < plan[g].green + plan[g].yellow; };
        const walkAt = [...Array(Math.round((SCR_RED_S[1] - SCR_RED_S[0]) * 2) + 1).keys()].map((k) => SCR_RED_S[0] + k / 2).find((t) => at(t) >= plan.scramble.start && at(t) < plan.scramble.start + 0.5);
        if (walkAt === undefined) continue;
        let red = true;
        for (let t = SCR_RED_S[0]; t <= walkAt + plan.scramble.walk + plan.scramble.flash && red; t += 0.5) red = !inA(at(t), a.group);
        if (!red) continue;
        const lane = map.lane(before.id, before.lanes - 1), approach = map.lane(e.id, e.lanes - 1), turn = map.lane(right, map.edges.get(right).lanes - 1);
        sites.push({ lane, approach, turn, startS: Math.max(2, (reach - SCR_START_M - front) * lane.length / before.length), scramble: { signal: id, edge: e.id, right } });
      }
    }
    sites.sort((a, b) => String(a.approach.edge).localeCompare(String(b.approach.edge)));
    scrambleSiteCache.set(map, sites);
  }
  const sites = scrambleSiteCache.get(map), on = sites.filter((s) => s.lane.edgeRef.name === street);
  return on.length ? on : sites;
}

// (on into the scramble crossing's approach, and right round the corner)
export const scenario = (map, challenge) => laneScenario(map, challenge, (map, challenge, random) => {
  const scr = pick(scrambleSites(map, challenge.street), random, "This map has no scramble crossing with a right turn, where right turns on red are allowed elsewhere and the car would arrive on a red that lasts through the all-walk.");
  return { lane: scr.lane, startS: scr.startS, through: [scr.approach, scr.turn], fields: { scramble: scr.scramble } };
});

// The two people at the corner opposite the one the car turns round (see scrambleSites), who cross
// diagonally to it on the walk, one of them slowly; and then on along the sidewalk, and away.
function placeScramble(world, { signal }, seed) {
  const map = world.map, random = rng(seed), inter = map.intersections.get(signal), route = world.route;
  const node = [...map.junctionNodes(inter)].find((n) => world.crowd.legsAt.get(n)?.inter === inter && world.crowd.legsAt.get(n).list.length >= 3), legs = node && world.crowd.legsAt.get(node);
  if (!legs || !route) return {};
  // (the corner the car turns round: the crosswalk end nearest its path a little into the junction)
  const c = route.controls.find((k) => k.control.id === signal), turnAt = route.pointAt(Math.min(route.length, c.sJunction ?? c.sRoute + 8));
  const d = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
  const ends = legs.list.flatMap((l) => [1, -1].map((side) => ({ leg: l, side, p: l.ends[side] })));
  const near = ends.reduce((a, b) => d(b.p, turnAt) < d(a.p, turnAt) ? b : a);
  const far = ends.filter((x) => x.leg !== near.leg).reduce((a, b) => d(b.p, near.p) > d(a.p, near.p) ? b : a);
  // (then 12 m along the sidewalk there, away from the junction)
  const e = near.leg.st.edge, L = e.cum.at(-1), s0 = Math.max(2, Math.min(L - 2, near.leg.s + (near.leg.out ? 12 : -12)));
  const q = pointAt(e.pts, e.cum, s0), h = headingAt(e.pts, e.cum, s0), lat = sidewalkOffset(e, near.side), away = [q[0] + Math.sin(h) * lat, q[1] - Math.cos(h) * lat];
  const ids = [];
  for (const [i, speed] of [1.3, SCR_SLOW_MPS].entries()) {
    const from = [far.p[0] + (i ? 0.5 : -0.5), far.p[1]];
    const ped = new Pedestrian({ id: `challenge_walker_${i + 1}`, x: from[0], y: from[1], psi: Math.atan2(near.p[1] - from[1], near.p[0] - from[0]), v: 0, speed, home: true,
      path: [{ p: near.p, cross: { node, leg: near.leg, from, to: near.p, diagonal: true } }, { p: away }], crossing: null, waiting: 0, phase: 0, look: Math.floor(random() * 1e6), at: null });
    world.crowd.list.push(ped);
    ids.push(ped.id);
  }
  return { walkerIds: ids, signalId: signal, at: [inter.x, inter.y] };
}

export function install(world, fleet, challenge, scenario) {
  Object.assign(world.challenge, placeScramble(world, scenario.scramble, challenge.seed));
}
