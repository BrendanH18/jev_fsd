import { rng } from "../common.js";
import { projectPoint } from "../map/mapdata.js";
import { detourAt, lookahead } from "./controller.js";
import { DECIDE_M, PASS_DECEL, PASS_MPS, VAN_LOOK_M, queuedAhead, wayRound } from "./double-parked.js";
import { NpcPath } from "./npc.js";
import { StopMemory } from "./signals.js";
import { CAR, DELIVERY_VAN, Vehicle } from "./vehicle.js";
import { current as weather } from "./weather.js";

// A driver this far past its waiting point is too close to pull out round the van.
const WAIT_SLACK_M = 1.5;

// A van in the driver's lane ahead, and the path arc lengths for going round it. A driver goes
// once it is close enough, nobody waits ahead of it, and there is time to clear the oncoming lane.
// Once it has started across it carries on round.
function vanAhead(world, vans, n, front, all, defaultDriver) {
  const path = n.path;
  for (const e of path.edges) {
    if (e.sEnd < path.s) continue;
    if (e.sStart - front > VAN_LOOK_M) break;
    for (const d of vans.on(e.id)) {
      const k = (e.sEnd - e.sStart) / Math.max(1, world.map.edges.get(e.id).length),
        at = (s) => e.sStart + s * k;
      if (front > at(d.detour.to) || at(d.rear) - front > VAN_LOOK_M) continue;
      const detour = {
        from: at(d.detour.from),
        full: at(d.detour.full),
        back: at(d.detour.back),
        to: at(d.detour.to),
        shift: d.detour.shift,
      };
      let go = n.vanGo === d.id;
      if (!go && at(d.rear) - front < DECIDE_M && front < at(d.wait) + WAIT_SLACK_M) {
        // A long vehicle needs time to get its extra length back into its own lane.
        const sFront = (front - e.sStart) / k,
          extra = Math.max(0, n.spec.length - CAR.length),
          D = n.driver || defaultDriver;
        const self = { accel: D.aMax, react: D.react || 0, vmax: n.v0 * weather.speed };
        if (
          !queuedAhead(world, d, sFront, n, all) &&
          wayRound(
            world,
            d,
            sFront - extra,
            n.v,
            all.filter((o) => o !== n),
            null,
            self,
          ).clear
        ) {
          go = true;
          if (path.s + lookahead(n.v) > detour.from + 2) n.vanGo = d.id;
        }
      }
      const shift = go ? detourAt(detour, path.s + lookahead(n.v)) : 0,
        waitGap = at(d.wait) - front;
      // Brake to PASS_MPS by the waiting point and stay at that speed until back in lane.
      return {
        shift,
        lineAt: go ? (s) => detourAt(detour, s) - shift : null,
        ignore: go ? d.van : null,
        waitGap: !go && waitGap > -1 ? waitGap : null,
        limit:
          front > detour.to + 2 ? Infinity : Math.sqrt(PASS_MPS * PASS_MPS + 2 * PASS_DECEL * Math.max(0, waitGap)),
      };
    }
  }
  return null;
}

export const doubleParkedTraffic = {
  trafficManage: {
    at: "beforePlows",
    run(world, fleet) {
      const vans = world.doubleParked;
      if (!vans?.vans.length) return;
      // A van whose driver is back can depart in sight by joining traffic from where it stands.
      for (const d of vans.vans.filter((x) => x.leaving)) {
        const old = d.van,
          lane = fleet.map.lane(d.edge, 0);
        vans.retire(d);
        if (!lane) continue;
        const s = projectPoint(lane.pts, lane.cum, [old.x, old.y], null).s;
        const v = new Vehicle(old.x, old.y, old.psi, 0, DELIVERY_VAN);
        Object.assign(v, {
          id: `${old.id}_away`,
          kind: "delivery_van",
          color: old.color,
          v0: lane.edgeRef.limit * 0.9,
          driver: { aMax: 1.2, b: 2, s0: 2.5, T: 1.4, react: 1.0, lcRate: 0 },
          stopMem: new StopMemory(),
          frozen: 0,
          waiting: 0,
        });
        // Keep its turns on their own stream.
        v.path = new NpcPath(fleet.map, rng(7919 * (Number(d.id.slice(4)) || 1) + 11));
        v.path.start(d.edge, 0, s);
        fleet.vehicles.push(v);
      }
    },
  },
  trafficBypass(world, n, front, all, defaultDriver) {
    const vans = world.doubleParked;
    // A cyclist using the empty parking lane goes by on the right.
    const plan =
      vans?.vans.length && !(n.kind === "bike" && n.side > 1.2)
        ? vanAhead(world, vans, n, front, all, defaultDriver)
        : null;
    if (!plan && n.vanGo) n.vanGo = null;
    return plan;
  },
  trafficSpawnBlocked: (world, x, y) => world.doubleParked?.covers(x, y),
};
