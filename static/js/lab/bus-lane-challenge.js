import { routeFromLanes } from '../demo/routing.js';
import { pointAt, headingAt } from '../map/mapdata.js';
export function busLaneScenario(map, challenge) {
  for (const record of map.buslanes) {
    const e = map.edges.get(record.edge);
    if (e.name !== challenge.street || e.lanes < 2 || e.length < 100) continue;
    const next = map.successors(e.id).find(id => map.classifyTurn(map.turnAngle(e.id,id)) === 'right');
    if (!next) continue;
    const start = map.lane(e.id, record.lane - 1), end = map.lane(next, map.edges.get(next).lanes - 1);
    const s = 10, p = pointAt(start.pts,start.cum,s);
    const route = routeFromLanes(map,[map.lane(e.id, record.lane),end],s,Math.min(50,end.length-10));
    return { id:challenge.id, start:{edge:e.id,lane:start.idx,s,x:p[0],y:p[1],psi:headingAt(start.pts,start.cum,s)}, route, goal:route.polyline.at(-1),traffic_seed:challenge.seed,
      tags:{length_m:Math.round(route.length || e.length),signals:0,stops:0,lefts:0,rights:1} };
  }
  throw new Error('No mapped bus-lane block with a right turn for Buses only');
}
