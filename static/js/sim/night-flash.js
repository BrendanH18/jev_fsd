// Overnight operation is a deterministic simulation policy, not an assertion about a city's
// actual signal programming. Only strictly separated road-class groups qualify; no random draws.
import { roadRank } from "../map/mapdata.js";
// Simulator caution target, not a posted/statutory limit; grip and sight may require slower travel.
export const NIGHT_CAUTION_MPS = 20 / 3.6;
let activeWorld = null;
export function setNightFlash(world) { activeWorld = world?.nightFlash ? world : null; }
const selections = new WeakMap();
export function flashMain(inter, map) {
  if (!inter) return null;
  if (!selections.has(inter)) {
    const ranks = g => inter.approaches.filter(a => a.group === g).map(a => roadRank(map.edges.get(a.edge)));
    const a = ranks("A"), b = ranks("B");
    selections.set(inter, !a.length || !b.length ? null : Math.min(...a) > Math.max(...b) ? "A" : Math.min(...b) > Math.max(...a) ? "B" : null);
  }
  return selections.get(inter);
}
export function flashing(inter, world = activeWorld) {
  if (!world?.nightFlash || !world.clock || !(world.clock.hour >= 23 || world.clock.hour < 5) || world.outages?.isDark(inter?.id)) return null;
  return flashMain(inter, world.map);
}
export function flashState(inter, group, world = activeWorld) {
  const main = flashing(inter, world);
  return main ? group === main ? "flashing_amber" : "flashing_red" : null;
}
const stops = new WeakMap();
export function flashControl(world, control, edge) {
  if (control?.type !== "signal") return control;
  const state = flashState(world.map.intersections.get(control.id), control.group, world);
  if (state !== "flashing_red") return control;
  let stop = stops.get(control);
  if (!stop) stops.set(control, stop = { ...control, id: `${control.id}@${edge}:flash`, junction: control.id, type: "stop", all_way: false, night_flash: true });
  return stop;
}
export function nightFlashNotice(world) {
  if (!world.nightFlash || !world.route) return null;
  const { ego, route } = world, p = route.project(ego.x, ego.y, route.hint);
  if (!p || p.distance > 4) return null;
  const front = p.s + ego.spec.length - ego.spec.rearOverhang;
  const c = route.controls.find(c => c.sRoute > front - 1);
  if (!c || c.sRoute - front > 60) return null;
  const i = world.map.intersections.get(c.control.id), state = flashState(i, c.control.group, world);
  if (!state || !world.visibility.canSee(ego, i.x, i.y)) return null;
  return { key: `${i.id}:${state}`, text: state === "flashing_red" ? "FLASHING RED · STOP, THEN GO WHEN CLEAR" : "FLASHING AMBER · SLOW · YIELD TO PEOPLE AND TRAFFIC IN THE JUNCTION" };
}
