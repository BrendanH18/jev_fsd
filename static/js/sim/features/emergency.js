// Emergency vehicles (sim/emergency.js): an ambulance or a fire truck answering a call, lights flashing
// and siren on, sent past the car now and then in free drives (the fleet option `emergency`), and every
// driver giving way to one. Traffic's side is sim/emergency-traffic.js.
import { EmergencyTraffic } from "../emergency-traffic.js";
import { isEmergencyVehicle } from "../emergency.js";

export default {
  key: "emergency",
  // (the World keeps the vehicles a failure to yield was counted for)
  property: "evCounted",
  build: () => new Set(),
  buildFleet: (fleet, { enabled, seed }) => new EmergencyTraffic(fleet, enabled, seed),
  // Dispatched, and taken off, before the transit is managed.
  trafficManage: { at: "beforeTransit", run: (_world, fleet, dt) => fleet.emergency.manage(dt) },
  // One with its siren on drives itself, along the middle of the road.
  trafficManeuver: {
    at: "beforeSpecial",
    run(_world, fleet, n, dt, all, extraTraffic) {
      if (!isEmergencyVehicle(n)) return false;
      if (n.siren) {
        fleet.emergency.step(n, dt, extraTraffic.length ? all.concat(extraTraffic) : all);
        return true;
      }
      // Stood down: return to ordinary lane driving and junction priority. Keeping the
      // centre-of-road passing controller after the siren stops can hold a junction forever.
      n.age += dt;
      return false;
    },
  },
  trafficGiveWay: (_world, fleet, n, proj, dt) => fleet.emergency.giveWay(n, proj, dt),
  trafficPullOver: (_world, fleet, n, edge, front, dt, giveWay) =>
    fleet.emergency.pullOver(n, edge, front, dt, giveWay),
  trafficRejoin: (_world, fleet, n, offset, dt) => fleet.emergency.rejoin(n, offset, dt),
  trafficStopAt: (_world, fleet, n, front, giveWay) => fleet.emergency.stopFor(n, front, giveWay),
  trafficHangBack: (_world, fleet, n, path, front) => fleet.emergency.hangBack(n, path, front),
  checkpoint(_world, fleet) {
    if (fleet.emergency) fleet.emergency.fleet = fleet;
  },
};
