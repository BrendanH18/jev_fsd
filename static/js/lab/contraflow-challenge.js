// "Both ways": turning into a one-way street cyclists may ride both ways (sim/contraflow.js), with a
// cyclist coming out of it the "wrong" way. The site: a contraflow block of the challenge's `street`,
// with a painted contraflow lane, that the car turns right into from a one-way street of the same class
// at a junction without a sign (`junction`, where the cyclist comes from the car's right, so the car
// gives way to it twice over), and where the cyclist gives way only to traffic from its right. The car
// starts from a standstill, its front CF_START_M short of the junction; the cyclist rides down the
// street toward it, CF_RIDER_M from the junction (on the block before, where it is that far), at
// CF_RIDER_MPS, so it is still in the narrow block, coming out, as the car gets to the corner: a car that
// turned in then would meet it head on, with no room to pass. The route ends CF_GOAL_M into the block, or,
// where the street carries straight on past the next junction, CF_GOAL_M into the next block.
import { routeFromLanes } from "../demo/routing.js";
import { cumulative, headingAt, pointAt } from "../map/mapdata.js";
import { CAR } from "../sim/vehicle.js";
import { contraControl, contraflowOf } from "../sim/contraflow.js";

export const CF_START_M = 45, CF_RIDER_M = 65, CF_RIDER_MPS = 4.5, CF_GOAL_M = 40;

export function contraflowSites(map, street = null) {
  const sites = [];
  for (const c of map.contraflow?.values() || []) {
    const e = map.edges.get(c.edge);
    if (!e || c.kind === "shared" || e.length < CF_GOAL_M + 10 || (street && e.name !== street)) continue;
    const control = contraControl(map, e);
    if (control?.type !== "yield" || control.rule !== "equal") continue;
    for (const id of map.inn.get(e.from) || []) {
      const a = map.edges.get(id);
      if (a.from === e.to || a.control || a.length < CF_START_M + 10 || map.classifyTurn(map.turnAngle(a.id, e.id)) !== "right" || map.priorityOf(a.id)?.rule !== "equal") continue;
      sites.push({ edge: e.id, approach: a.id });
    }
  }
  return sites.sort((x, y) => String(x.edge).localeCompare(String(y.edge)) || String(x.approach).localeCompare(String(y.approach)));
}

export function contraflowScenario(map, challenge) {
  const site = contraflowSites(map, challenge.street)[0];
  if (!site) throw new Error(`No block of ${challenge.street} with a painted contraflow lane that a car turns right into at a junction without a sign.`);
  const e = map.edges.get(site.edge), a = map.edges.get(site.approach);
  const lane = map.lane(a.id, a.lanes - 1), into = map.lane(e.id, e.lanes - 1);
  const front = CAR.length - CAR.rearOverhang, s = lane.length - CF_START_M * lane.length / a.length - front;
  const p = pointAt(lane.pts, lane.cum, s);
  // (the cyclist: on the block, or the contraflow block of the street before it, straight on)
  const up = (map.inn.get(e.to) || []).map((id) => map.edges.get(id)).find((u) => contraflowOf(map, u.id) && u.from !== e.from && Math.abs(map.turnAngle(u.id, e.id)) < 0.3);
  // (the street straight on past the block, for the car; the next contraflow block, where it is one)
  const on = (map.out.get(e.to) || []).map((id) => map.edges.get(id)).find((o) => o.to !== e.from && o.length > CF_GOAL_M + 10 && Math.abs(map.turnAngle(e.id, o.id)) < 0.3);
  const ahead = on ? map.lane(on.id, on.lanes - 1) : null;
  const route = ahead ? routeFromLanes(map, [lane, into, ahead], s, CF_GOAL_M * ahead.length / on.length) : routeFromLanes(map, [lane, into], s, CF_GOAL_M * into.length / e.length);
  const rider = CF_RIDER_M <= e.length - 2 || !up ? { edge: e.id, at: Math.max(2, e.length - CF_RIDER_M) } : { edge: up.id, at: Math.max(2, up.length + e.length - CF_RIDER_M) };
  return { id: challenge.id, start: { edge: lane.edge, lane: lane.idx, s, x: p[0], y: p[1], psi: headingAt(lane.pts, lane.cum, s) }, route, goal: route.polyline.at(-1), traffic_seed: challenge.seed,
    contraflow: { ...rider, v: CF_RIDER_MPS, junction: e.from, kind: contraflowOf(map, e.id).kind },
    tags: { length_m: Math.round(cumulative(route.polyline).at(-1)), signals: 0, stops: 0, lefts: 0, rights: 1 } };
}

// Put the cyclist down (World option `contraflow`, its own riders off), riding out of the block.
export function placeContraflowRider(world, spec) {
  world.contraflow.target = 0;
  const n = world.contraflow.place({ edge: spec.edge, at: spec.at, v: spec.v, v0: spec.v, color: 0x0f766e });
  if (!n) throw new Error(`Could not place the contraflow cyclist on ${spec.edge}.`);
  const node = world.map.nodes.get(spec.junction);
  return { cyclistId: n.id, at: [node.x, node.y], triggered: true };
}
