// Export a read-only street view of an arena replay. The viewer never re-simulates the drive.
import { headingAt, pointAt } from "../static/js/map/mapdata.js";
import { analyzeStreets, surfaceHalf } from "../static/js/map/scenery.js";

const round = (value) => Math.round(value * 1000) / 1000;
const point = (p) => p.map(round);

export function captureBrowserReplay() {
  const frames = [];
  let context, route, signals;

  function sample({ world, fleet }) {
    const pose = (vehicle) => {
      const [x, y] = vehicle.center;
      return { x: round(x), y: round(y), psi: round(vehicle.psi) };
    };
    frames.push({
      t: round(world.t),
      ego: { ...pose(world.ego), speed: round(world.ego.v * 3.6) },
      traffic: Object.fromEntries(fleet.vehicles.map((car) => [car.id, pose(car)])),
      lights: signals.map(({ id, edge, turn }) => world.light(id, edge, turn)),
    });
  }

  return {
    onStep(ctx) {
      context = ctx;
      if (!route) {
        const { world, scenario } = ctx;
        route = world.route.pts.map(point);
        signals = [
          [scenario.start.edge, scenario.route.turns[0]?.dir || "straight"],
          ...(scenario.oncoming ? [[scenario.oncoming.edge, "straight"]] : []),
        ].flatMap(([edge, turn]) => {
          const e = world.map.edges.get(edge);
          if (e?.control?.type !== "signal") return [];
          const lane = world.map.lane(edge, e.lanes - 1),
            s = e.control.s_line,
            [x, y] = pointAt(lane.pts, lane.cum, s),
            psi = headingAt(lane.pts, lane.cum, s);
          return [{ id: e.control.id, edge, turn, at: point([x + Math.sin(psi) * 3, y - Math.cos(psi) * 3]) }];
        });
      }
      if (ctx.world.tick % 6 === 0) sample(ctx);
    },

    finish(challenge, recordingPath, recording, result) {
      if (frames.at(-1)?.t !== round(context.world.t)) sample(context);
      const { map } = context.world;
      const coordinates = (index) => route.map((p) => p[index]);
      const bounds = [
        Math.min(...coordinates(0)) - 36,
        Math.min(...coordinates(1)) - 36,
        Math.max(...coordinates(0)) + 36,
        Math.max(...coordinates(1)) + 36,
      ];
      const overlaps = (pts) => {
        const xs = pts.map(([x]) => x),
          ys = pts.map(([, y]) => y);
        return (
          Math.max(...xs) >= bounds[0] &&
          Math.max(...ys) >= bounds[1] &&
          Math.min(...xs) <= bounds[2] &&
          Math.min(...ys) <= bounds[3]
        );
      };
      return {
        format: "jev-browser-replay/1",
        challenge: challenge.id,
        model: recording.header.model,
        source: recordingPath,
        result_sha: recording.results[challenge.id].result_sha,
        pass: result.pass,
        bounds: bounds.map(round),
        route,
        roads: analyzeStreets(map).streets.flatMap(({ edge }) =>
          overlaps(edge.pts) ? [{ points: edge.pts.map(point), width: round(surfaceHalf(edge) * 2) }] : [],
        ),
        buildings: (map.pack.buildings || []).flatMap(({ pts }) => (pts && overlaps(pts) ? [pts.map(point)] : [])),
        signals: signals.map(({ at }) => at),
        frames,
        events: result.events.map(({ at_s, message }) => ({ t: at_s, message })),
      };
    },
  };
}
