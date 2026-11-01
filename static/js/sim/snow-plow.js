// Snow plows. While it snows, city plows clear the main streets: slow, with their blue and amber lamps
// flashing, a blade angled across the nose throwing the snow off to the right. Manitoba's Highway
// Traffic Act (since 2026) says to stay 30 m back from a plow with its blue warning lamps on where the
// limit is 80 km/h or less (100 m above that), and not to pass one where blowing snow hides the view
// ahead or passing would get in the way of its work. The City of Winnipeg adds never to pass one on
// the right, the side the snow and debris are plowed to, and Ontario that a plow may be passed only
// in a lane clear of every part of it (its wing blade reaches up to 3 m to its right). Other
// provinces' handbooks say much the same.
//
// So the driven car stays STAY_BACK_M behind a plow in its lane, and behind one in the lane to its
// left as well: it never draws level with one on its right. It passes one only on the left, in a lane
// going its way (never across the centre line), and only with nothing hiding the road ahead (as far as
// it ever sees, DAYLIGHT_RANGE_M: in falling snow, fog, rain or darkness it stays behind, even one in
// the lane to its right), and it moves back in front of it only once its rear is the stay-back distance
// ahead of the plow's front. A plow signalling a left turn is a vehicle turning left, and may be passed
// on the right as any other. Where the stay-back distance is further than the car can see (100 m), it
// keeps back as far as it can see. Traffic keeps to the same rules (sim/npc.js); the driven car's sensing
// reports `snow_plow` (brain/sensors.js), and the audit counts passing one on the right
// (sim/world.js), which fails a drive (bench/metrics.js).
//
// In a free drive (`?plows=0` takes them off) one plow at a time works the primary, secondary and
// tertiary streets while it snows, put down out of the car's sight 150 to 450 m from it, and taken
// off again once it is out of sight 500 m away; another is put down 30 to 90 s later. It drives on as
// traffic at PLOW_MPS, turning where the streets take it. When the snow stops, no more come. The
// seeded benchmark and the other challenges have none.

import { DAYLIGHT_RANGE_M } from "./visibility.js";

export const PLOW_NAME = "snow plow";
export const PLOW_MPS = 18 / 3.6;          // clearing speed, blade down
export const STAY_BACK_M = 30;             // limit 80 km/h or less
export const STAY_BACK_FAST_M = 100;       // above 80 km/h
const FAST_LIMIT_MPS = 80 / 3.6;
export const SAME_LANE_M = 1.7;            // a plow whose centre line is within this of the car's is in its lane
export const NEXT_LANE_M = 8.8;            // and within this, in a lane beside it (up to two lanes over)
export const PLOW_LOOK_M = 60;             // the car looks out for one this far ahead
export const PASS_SIGHT_M = DAYLIGHT_RANGE_M;
const SAME_WAY = Math.PI / 4;
// Free drive: how many work at once, where they are put down, and when they come and go.
export const PLOW_COUNT = 1;
export const PLOW_SPAWN_M = [150, 450];
export const PLOW_GONE_M = 500;
export const PLOW_EVERY_S = [30, 90];
export const PLOW_COLOR = 0xe8712a;
export const PLOW_CLASSES = new Set(["primary", "secondary", "tertiary"]);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export const isPlow = (o) => !!o && o.kind === "snow_plow";
// The distance to stay back from a plow on a street with limit `limit` (m/s).
export const stayBack = (limit) => (limit > FAST_LIMIT_MPS + 0.1 ? STAY_BACK_FAST_M : STAY_BACK_M);
// A plow signalling a left turn (sim/npc.js signals within 35 m of the junction) is turning off.
export const turningLeft = (plow) => plow.signal === "left";

// Plow `plow` as vehicle `v` sees it, going its way (or null when it is not): { gap_m (v's front to
// the plow's rear, along v's heading; negative once alongside), ahead_m (centre to centre), right_m
// (the plow's centre line right of v's), lane ("same", in a lane "left" of v, "right" of v, or null
// further across), clear_m (v's rear past the plow's front; positive once v is wholly ahead of it) }.
export function plowRelation(v, plow) {
  if (Math.abs(wrap(plow.psi - v.psi)) > SAME_WAY) return null;
  const vs = v.spec, ps = plow.spec;
  const c = v.toLocal(...plow.center), ahead = c.ahead - (vs.length / 2 - vs.rearOverhang);
  const lane = Math.abs(c.right) < SAME_LANE_M ? "same" : c.right < 0 && c.right > -NEXT_LANE_M ? "left" : c.right > 0 && c.right < NEXT_LANE_M ? "right" : null;
  return { gap_m: ahead - vs.length / 2 - ps.length / 2, ahead_m: ahead, right_m: c.right, lane, clear_m: -ahead - vs.length / 2 - ps.length / 2 };
}

// The lanes a plow may be put down on in a free drive: on the main streets, long enough.
const laneCache = new WeakMap();
export function plowLanes(map) {
  if (!laneCache.has(map)) laneCache.set(map, map.laneList.filter((l) => l.length > 40 && !l.edgeRef.ring && PLOW_CLASSES.has(l.edgeRef.cls)));
  return laneCache.get(map);
}

// The plow the driven car must reckon with, as far as it can see, sensing-free (for the HUD and the
// coaching score): the nearest one going its way in its lane or a lane beside it, from PLOW_LOOK_M (or
// the stay-back distance) ahead of it until the car's rear is the stay-back distance past its front.
// { plow, rel, keep (the stay-back distance), holds (the car must stay back of it: in its lane, in the
// lane to its left and not turning left, or short of it in the lane to its right in poor sight),
// passing (the car is beside or ahead of it, on its left) }, or null.
export function egoPlow(world, limit = 11.2) {
  const ego = world.ego, keep = stayBack(limit), look = Math.max(PLOW_LOOK_M, keep), sight = world.visibility.range >= PASS_SIGHT_M;
  let best = null;
  for (const n of world.npcs || []) {
    if (!isPlow(n) || Math.abs(n.x - ego.x) > look + 20 || Math.abs(n.y - ego.y) > look + 20) continue;
    const rel = plowRelation(ego, n);
    if (!rel?.lane || rel.gap_m > look || rel.clear_m > keep || !world.sees(ego, n)) continue;
    if (best && Math.abs(rel.ahead_m) >= Math.abs(best.rel.ahead_m)) continue;
    const holds = rel.lane === "same" || (rel.lane === "left" && !turningLeft(n)) || (rel.lane === "right" && !sight && rel.gap_m >= 0);
    best = { plow: n, rel, keep, holds, passing: rel.lane === "right" && rel.gap_m < 0 };
  }
  return best;
}

// What the HUD tells the driver of the car about a plow ahead: stay back, don't pass on the right, or
// move back in only well ahead of it. { key, text, wait }, or null.
export function plowNotice(world) {
  const view = egoPlow(world, world._road?.limit ?? 11.2);
  if (!view) return null;
  const { plow, rel, keep, holds, passing } = view;
  if (passing) return { key: `${plow.id}:passing`, wait: false, text: `PASSING THE SNOW PLOW · BACK IN ONLY ${keep} M AHEAD OF IT` };
  if (!holds || rel.gap_m < -1) return null;
  if (rel.lane === "left") return { key: `${plow.id}:right`, wait: true, text: `SNOW PLOW · NEVER PASS ON THE RIGHT · STAY ${keep} M BACK` };
  if (rel.lane === "right") return { key: `${plow.id}:sight`, wait: true, text: `SNOW PLOW · CAN'T SEE TO PASS · STAY ${keep} M BACK` };
  return { key: `${plow.id}:behind`, wait: rel.gap_m < keep, text: `SNOW PLOW AHEAD · STAY ${keep} M BACK` };
}
