import { roadRank } from "../../map/mapdata.js";
import {
  flashControl,
  flashing,
  flashState,
  NIGHT_CAUTION_MPS,
  nightFlashNotice,
  setNightFlash,
} from "../night-flash.js";
import { approachTo } from "../priority.js";

const FLASHING_AMBER = "flashing_amber";
const FLASHING_RED = "flashing_red";

export default {
  key: "nightFlash",
  seen: "nightFlashSeen",
  buildAt: "early",
  build(world, { enabled }) {
    setNightFlash(world, enabled);
    return !!enabled;
  },
  checkpoint: (world) => setNightFlash(world),
  controlReplace(world, control, edge) {
    const resolved = flashControl(world, control, edge);
    return resolved === control ? null : resolved;
  },
  specialSignalPhase(intersection, world) {
    const main = flashing(intersection, world);
    return main
      ? {
          A: main === "A" ? FLASHING_AMBER : FLASHING_RED,
          B: main === "B" ? FLASHING_AMBER : FLASHING_RED,
          u: 0,
        }
      : null;
  },
  observeControl(world, control, past) {
    if (
      world.nightFlash &&
      Math.abs(past) < 60 &&
      (control.night_flash ||
        (control.type === "signal" && flashState(world.map.intersections.get(control.id), control.group, world)))
    )
      world.nightFlashSeen = true;
  },
  priorityLevel(world, edge) {
    if (!world?.nightFlash || edge.control?.type !== "signal") return null;
    const flash = flashState(world.map.intersections.get(edge.control.id), edge.control.group, world);
    return flash ? { level: flash === FLASHING_RED ? 0 : roadRank(edge) } : null;
  },
  priorityJunction(world, control, traffic) {
    if (!traffic) return control.night_flash ? world.map.intersections.get(control.junction) : null;
    if (!world.nightFlash || control?.type !== "signal") return null;
    const inter = world.map.intersections.get(control.id);
    return flashing(inter, world) ? inter : null;
  },
  priorityTrafficOutside(world, control, vehicle, rule, traffic) {
    if (!world.nightFlash) return false;
    const inter = traffic
      ? this.priorityJunction(world, control, true)
      : rule === "major"
        ? world.map.intersections.get(control.id)
        : null;
    const a = inter ? approachTo(world.map, vehicle, inter.id, traffic) : null;
    return a && a.to_node_m > world.map.crossingHalfWidth(a.edge) + 0.1;
  },
  visibleSignalPolicy(world, c, inter) {
    const signal = flashState(inter, c.control.group, world);
    if (signal === FLASHING_RED) return { signal, control: flashControl(world, c.control, c.edge) };
    if (signal !== FLASHING_AMBER) return null;
    return {
      signal,
      speed: NIGHT_CAUTION_MPS,
      allowsTurn: true,
      yieldControl: { ...c.control, type: "uncontrolled", rule: "major" },
    };
  },
  trafficSignalPolicy(fleet, n, edge, signal) {
    return signal === FLASHING_AMBER ? { speed: NIGHT_CAUTION_MPS, hold: fleet.boxBusy(n, edge) } : null;
  },
  signalClause({ intersection }) {
    return intersection.signal === FLASHING_AMBER
      ? "Flashing amber: proceed cautiously at no more than 20 km/h, yielding to pedestrians and vehicles already in the junction."
      : null;
  },
  clause: {
    at: "stopStart",
    run({ intersection }) {
      return intersection.signal === FLASHING_RED
        ? "Flashing red: make a full stop, then yield to the main street until clear. This is a two-way stop, not an all-way stop."
        : null;
    },
  },
  prompt: {
    at: "introduction",
    text: "Flashing amber means slow and proceed cautiously, yielding to pedestrians and vehicles already in the junction. Flashing red means a full stop, then yield to main-street traffic as at a two-way stop; neither is an advance green or a right-on-red decision.",
  },
  notice: { at: "beforePlow", order: -2, duration: 2500, read: nightFlashNotice, style: "stop" },
};
