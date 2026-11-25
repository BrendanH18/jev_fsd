// Overnight operation is a deterministic simulation policy, not an assertion about a city's
// actual signal programming. Only strictly separated road-class groups qualify; no random draws.
import { roadRank } from "../map/mapdata.js";
// Simulator caution target, not a posted/statutory limit; grip and sight may require slower travel.
export const NIGHT_CAUTION_MPS = 20 / 3.6;
let activeWorld = null;
export function setNightFlash(world, enabled = world?.nightFlash) {
  activeWorld = enabled ? world : null;
}
const selections = new WeakMap();
export function flashMain(inter, map) {
  if (!inter || !map?.edges || !Array.isArray(inter.approaches)) return null;
  let byIntersection = selections.get(map);
  if (!byIntersection) selections.set(map, (byIntersection = new WeakMap()));
  if (byIntersection.has(inter)) return byIntersection.get(inter);
  const ranks = { A: { low: Infinity, high: -Infinity }, B: { low: Infinity, high: -Infinity } };
  for (const approach of inter.approaches) {
    if (approach?.group !== "A" && approach?.group !== "B") return null;
    const edge = map.edges.get(approach.edge);
    if (!edge) return null;
    const rank = roadRank(edge);
    const group = ranks[approach.group];
    group.low = Math.min(group.low, rank);
    group.high = Math.max(group.high, rank);
  }
  const { A, B } = ranks;
  const main = A.high === -Infinity || B.high === -Infinity ? null : A.low > B.high ? "A" : B.low > A.high ? "B" : null;
  byIntersection.set(inter, main);
  return main;
}

export function flashing(inter, world = activeWorld) {
  if (
    !world?.nightFlash ||
    !Number.isFinite(world.clock?.hour) ||
    world.clock.hour < 0 ||
    world.clock.hour >= 24 ||
    !(world.clock.hour >= 23 || world.clock.hour < 5) ||
    world.outages?.isDark(inter?.id)
  )
    return null;
  return flashMain(inter, world.map);
}
export function flashState(inter, group, world = activeWorld) {
  const main = flashing(inter, world);
  return main ? (group === main ? "flashing_amber" : "flashing_red") : null;
}
const stops = new WeakMap();
export function flashControl(world, control, edge) {
  if (control?.type !== "signal" || edge == null) return control;
  const state = flashState(world.map.intersections.get(control.id), control.group, world);
  if (state !== "flashing_red") return control;
  let approaches = stops.get(control);
  if (!approaches) stops.set(control, (approaches = new Map()));
  let stop = approaches.get(edge);
  if (!stop)
    approaches.set(
      edge,
      (stop = {
        ...control,
        id: `${control.id}@${edge}:flash`,
        junction: control.id,
        type: "stop",
        all_way: false,
        night_flash: true,
      }),
    );
  return stop;
}
export function nightFlashNotice(world) {
  if (!world.nightFlash || !world.route || !world.clock) return null;
  const { ego, route } = world,
    p = route.project(ego.x, ego.y, route.hint);
  if (!p || p.distance > 4) return null;
  const front = p.s + ego.spec.length - ego.spec.rearOverhang;
  const c = route.controls.find((c) => c.sRoute > front - 1);
  if (!c || c.sRoute - front > 60) return null;
  const i = world.map.intersections.get(c.control.id),
    state = flashState(i, c.control.group, world);
  if (!state || !world.visibility.canSee(ego, i.x, i.y)) return null;
  return {
    key: `${i.id}:${state}`,
    text:
      state === "flashing_red"
        ? "FLASHING RED · STOP, THEN GO WHEN CLEAR"
        : "FLASHING AMBER · SLOW · YIELD TO PEOPLE AND TRAFFIC IN THE JUNCTION",
  };
}
