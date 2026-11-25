// Right on red: the car starts 70 m before its line; once it is 45 m from it, two cars set off from
// the left in the curb lane of the street it turns into (shared/kit.js releaseOncoming).
//
// Right turns on red: a signalled approach at least 90 m long whose route turns right onto a street
// at least 60 m long, where traffic on the approach from the left (another approach of the same
// signal, heading within 20 deg of that street, its line at least 70 m along) goes straight on into
// it. The car's light is red from 3 s to 30 s and the street from the left has a green from 6 s to
// 20 s, so the car arrives on a red while that traffic is moving. From the line the car sees 75 m
// along the street to its left, so once the traffic has passed it may turn.
import { pointAt, wrapAngle } from "../../map/mapdata.js";
import { approachPhase, movementSignal } from "../../sim/signals.js";
import { Visibility } from "../../sim/visibility.js";
import {
  ONCOMING_TRIGGER_M,
  laneScenario,
  oncomingStarts,
  pick,
  reach,
  releaseOncoming,
  stepAuthored,
} from "./shared/kit.js";

export const challenge = {
  id: "right-on-red",
  title: "Right on red",
  map: "calgary",
  weather: "dry",
  time: "afternoon",
  seed: 8042,
  icon: "↱",
  difficulty: "Judgement",
  hazard: "cross",
  description:
    "Your right turn in the Beltline has a red light. Two cars approach from the left on their green while you wait at the line.",
  lesson:
    "Stop fully first, then look left for a usable gap and check the crosswalk before turning. You can wait for green if either is unclear. On the island of Montréal, wait for green even if both are clear.",
};

const RIGHT_RED_S = [3, 30],
  CROSS_GREEN_S = [6, 20];
const rightSites = new WeakMap();
function crossSites(map) {
  if (!map.rightOnRed) return [];
  if (rightSites.has(map)) return rightSites.get(map);
  const sites = [],
    visibility = new Visibility(map);
  const openView = (edge, fromLeft) => {
    const lane = map.lane(edge.id, edge.lanes - 1),
      at = pointAt(lane.pts, lane.cum, edge.control.s_line - 1.5);
    const e = map.edges.get(fromLeft),
      L = e.cum.at(-1);
    return L >= 75 && [15, 30, 45, 60, 75].every((back) => !visibility.occluded(at, pointAt(e.pts, e.cum, L - back)));
  };
  for (const edge of map.edges.values()) {
    const control = edge.control;
    if (control?.type !== "signal" || edge.length < 90 || control.s_line < 75) continue;
    const right = map
      .successors(edge.id)
      .find((id) => map.classifyTurn(map.turnAngle(edge.id, id)) === "right" && map.edges.get(id).length > 60);
    const fromLeft =
      right &&
      (map.inn.get(edge.to) || []).find((id) => {
        const other = map.edges.get(id);
        return (
          id !== edge.id &&
          other.control?.type === "signal" &&
          other.control.id === control.id &&
          other.control.s_line > 70 &&
          Math.abs(wrapAngle(map.headingIn(id) - map.headingOut(right))) < 0.35 &&
          map.successors(id).includes(right)
        );
      });
    const inter = map.intersections.get(control.id);
    if (!fromLeft || !inter || !oncomingStarts(map, fromLeft).every(Boolean) || !openView(edge, fromLeft)) continue;
    let ok = true;
    for (let t = RIGHT_RED_S[0]; t <= RIGHT_RED_S[1] && ok; t += 0.5) ok = approachPhase(inter, edge.id, t) === "red";
    for (let t = CROSS_GREEN_S[0]; t <= CROSS_GREEN_S[1] && ok; t += 0.5)
      ok = movementSignal(approachPhase(inter, fromLeft, t), "straight") === "green";
    if (ok) sites.push({ lane: map.lane(edge.id, edge.lanes - 1), right, fromLeft });
  }
  sites.sort((a, b) => String(a.lane.edge).localeCompare(String(b.lane.edge)));
  rightSites.set(map, sites);
  return sites;
}

export const scenario = (map, challenge) =>
  laneScenario(map, challenge, (map, _challenge, random) => {
    const right = pick(
      crossSites(map),
      random,
      map.rightOnRed
        ? "This map has no signalled right turn with traffic from the left."
        : "Right turns on red are not allowed on this map.",
    );
    const turn = map.lane(right.right, map.edges.get(right.right).lanes - 1);
    return {
      lane: right.lane,
      startS: right.lane.edgeRef.control.s_line - 70,
      through: [turn],
      fields: { oncoming: { edge: right.fromLeft, then: right.right, lane: "curb" } },
    };
  });

export const step = (world, fleet) =>
  stepAuthored(world, fleet, {
    trigger: reach(ONCOMING_TRIGGER_M),
    release: (world, fleet, state) => {
      state.oncomingIds = releaseOncoming(world, fleet, state.oncoming);
    },
  });
