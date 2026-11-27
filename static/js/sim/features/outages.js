import { OUTAGE_COUNT, Outages, darkControl, outageNotice } from "../outage.js";
import { comfort } from "../vehicle.js";

const CAUGHT_WITHIN_S = 0.5;
const CLEAR_WITHIN_S = 10;
const countDark = (score, event) => {
  if (event.dark) score.darkSignals++;
};

export default {
  key: "outages",
  // (with the power out a signal's lamps show nothing)
  signalLamp: (world, id) => (world.outages.isDark(id) ? "dark" : null),
  defaultCount: OUTAGE_COUNT,
  buildAt: "afterSpawn",
  build: (world, { enabled, seed }) => new Outages(world, { count: enabled, seed }),
  stepBeforeTraffic: { at: "afterMerge", run: (world, _fleet, dt) => world.outages.step(dt) },
  controlReplace(world, control, edge) {
    return control?.type === "signal" && world.outages?.isDark(control.id) ? darkControl(control, edge) : null;
  },
  alternateSignal: (world, id) => (world.outages?.isDark(id) ? "dark" : null),
  senseSignalControl(_world, routeControl, signal) {
    return signal === "dark"
      ? { control: darkControl(routeControl.control, routeControl.edge), fields: { dark: true } }
      : null;
  },
  trafficReleaseControl(world, vehicle, edge, control, state, bumperToLine) {
    if (!control.dark) return false;
    if (
      state === "approaching" &&
      world.t - world.outages.since(control.junction) < CAUGHT_WITHIN_S &&
      bumperToLine < (vehicle.v * vehicle.v) / (2 * Math.min(4, comfort().hardDecel)) + 1
    )
      vehicle.darkGo = { edge: edge.id, t: world.t };
    return vehicle.darkGo?.edge === edge.id && world.t - vehicle.darkGo.t < CLEAR_WITHIN_S;
  },
  controlEvent: (control) => (control.dark ? { dark: true } : null),
  eventBadge: (event) => (event.type === "stop_sign" && event.dark ? "NO STOP AT A DARK SIGNAL" : null),
  intersectionModelFields: {
    at: "beforeCrossTraffic",
    run: (intersection) => (intersection.dark ? { lights_out: true } : null),
  },
  clause: {
    at: "stopStart",
    run({ intersection }, m) {
      return intersection.dark
        ? `The traffic lights at the junction ${intersection.entered ? "the car is in" : `${m} m ahead`} are out: treat it as an all-way stop. Every driver stops at the line, then goes in turn.`
        : null;
    },
  },
  prompt: {
    at: "afterAllWay",
    text: `- Where a signal's lights are out (\`intersection.lights_out\`), the junction is an all-way stop: stop at the line, then go in turn, as at any all-way stop.`,
  },
  notice: {
    at: "beforePlow",
    order: -1,
    duration: 2500,
    read: outageNotice,
    style: (line) => (line.stop ? "safety" : "stop"),
  },
  checkpoint(world) {
    world.outages.world = world;
  },
  coach: {
    init: () => ({ darkSignals: 0 }),
    events: { stop_sign: countDark, failed_to_yield: countDark },
    tips: [
      {
        at: "afterBlind",
        order: 0,
        when: (score) => score.darkSignals,
        text: "Where a signal’s lights are out, treat the junction as an all-way stop: stop at the line, then go in turn. Whoever stopped first goes first.",
      },
    ],
  },
};
