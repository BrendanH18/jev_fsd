// One deterministic source of roadside placements for rendering and collision geometry.
// This module has no browser/Three dependency, so headless worlds see the same solid scenery.
import { pointAt, headingAt } from "./mapdata.js";
import { GUTTER, CURB } from "./streets.js";
import { sceneryHash } from "./scenery-hash.js";
import { buildingShapes, boxPolygon } from "./building-scenery.js";
export { sceneryHash } from "./scenery-hash.js";

const cache = new WeakMap();
const BOULEVARD = {
  residential: 1.8,
  living_street: 1.2,
  tertiary: 1.2,
  unclassified: 1.2,
};
const ARTERIAL = new Set([
  "primary",
  "secondary",
  "tertiary",
  "primary_link",
  "secondary_link",
  "tertiary_link",
]);
const LIT = new Set([
  ...ARTERIAL,
  "residential",
  "unclassified",
  "living_street",
]);
export const surfaceHalf = (e) =>
  Math.max(Math.abs(e.asphalt[0]), Math.abs(e.asphalt[1])) + GUTTER;
export function analyzeStreets(map) {
  const streets = [],
    seen = new Map(),
    legs = new Map(),
    nodeR = new Map();
  for (const e of (map.edges || new Map()).values()) {
    const key = [e.from, e.to].sort().join("|") + "|" + Math.round(e.length);
    if (seen.has(key)) {
      seen.get(key).twin = e;
      continue;
    }
    const st = { edge: e, twin: null };
    seen.set(key, st);
    streets.push(st);
  }
  for (const st of streets) {
    for (const [id, out] of [
      [st.edge.from, true],
      [st.edge.to, false],
    ]) {
      if (!legs.has(id)) legs.set(id, []);
      legs.get(id).push({ st, out });
    }
  }
  for (const [id, list] of legs)
    nodeR.set(id, Math.max(...list.map((l) => surfaceHalf(l.st.edge))));
  return { streets, legs, nodeR };
}
export function trimAt(nodeR, legs, id) {
  const list = legs.get(id) || [];
  return list.length >= 3 ? nodeR.get(id) + 1 : list.length === 2 ? 0.5 : 0;
}
export function crossingHalf(map, e) {
  let w = 0;
  for (const id of [
    ...(map.inn?.get(e.to) || []),
    ...(map.out?.get(e.to) || []),
  ]) {
    const o = map.edges.get(id);
    if (
      (o.from === e.from && o.to === e.to) ||
      (o.from === e.to && o.to === e.from)
    )
      continue;
    w = Math.max(w, surfaceHalf(o));
  }
  return w;
}

// Match the renderer's inset building walls when keeping trees clear of buildings.
function buildingClearance(map) {
  const cell = 25,
    grid = new Map();
  for (const { pts } of buildingShapes(map)) {
    const xs = pts.map((p) => p[0]),
      ys = pts.map((p) => p[1]);
    for (
      let x = Math.floor(Math.min(...xs) / cell);
      x <= Math.floor(Math.max(...xs) / cell);
      x++
    )
      for (
        let y = Math.floor(Math.min(...ys) / cell);
        y <= Math.floor(Math.max(...ys) / cell);
        y++
      ) {
        const key = `${x},${y}`;
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push(pts);
      }
  }
  return (x, y, margin) => {
    const seen = new Set(),
      gx = Math.floor(x / cell),
      gy = Math.floor(y / cell),
      r = Math.ceil(margin / cell);
    for (let i = gx - r; i <= gx + r; i++)
      for (let j = gy - r; j <= gy + r; j++)
        for (const pts of grid.get(`${i},${j}`) || []) {
          if (seen.has(pts)) continue;
          seen.add(pts);
          let inside = false;
          for (let a = 0, b = pts.length - 1; a < pts.length; b = a++) {
            const [xi, yi] = pts[a],
              [xj, yj] = pts[b];
            if (
              yi > y !== yj > y &&
              x < ((xj - xi) * (y - yi)) / (yj - yi) + xi
            )
              inside = !inside;
            const dx = xj - xi,
              dy = yj - yi,
              l2 = dx * dx + dy * dy,
              t = l2
                ? Math.max(0, Math.min(1, ((x - xi) * dx + (y - yi) * dy) / l2))
                : 0;
            if (Math.hypot(x - xi - dx * t, y - yi - dy * t) < margin)
              return true;
          }
          if (inside) return true;
        }
    return false;
  };
}
function roadside(e, s, offset) {
  const p = pointAt(e.pts, e.cum, s),
    heading = headingAt(e.pts, e.cum, s);
  return {
    x: p[0] + Math.sin(heading) * offset,
    y: p[1] - Math.cos(heading) * offset,
    heading,
  };
}

export function sceneryFor(map) {
  if (cache.has(map)) return cache.get(map);
  const result = {
    trees: [],
    lamps: [],
    streetSigns: [],
    stopSigns: [],
    yieldSigns: [],
    signals: [],
    circles: [],
    polygons: [],
  };
  cache.set(map, result);
  for (const building of buildingShapes(map))
    for (const box of building.boxes) {
      // Roofs and printed doors are above/outside the sedan's impact envelope. Decks,
      // steps, supporting posts and hedges occupy the vehicle's ground-level footprint.
      if (!["porch", "porch_step", "porch_post", "hedge"].includes(box.part))
        continue;
      result.polygons.push({
        id: box.id,
        kind: box.part,
        pts: boxPolygon(box),
      });
    }
  const roads = analyzeStreets(map);
  result.roads = roads;
  const nearBuilding = buildingClearance(map),
    hash01 = sceneryHash;
  const spots = result.trees;
  const clear = (x, y, margin) =>
    !nearBuilding(x, y, margin) &&
    typeof map.roadDistance === "function" &&
    map.roadDistance(x, y).distance > 1;
  for (const st of roads.streets) {
    const e = st.edge,
      blvd = BOULEVARD[e.cls];
    if (!blvd) continue;
    const L = e.cum.at(-1),
      trim = (id) =>
        (roads.legs.get(id) || []).length >= 3 ? roads.nodeR.get(id) + 7 : 2;
    for (const sign of [1, -1]) {
      const lat =
        sign > 0
          ? e.asphalt[1] + GUTTER + CURB + blvd / 2
          : e.asphalt[0] - GUTTER - CURB - blvd / 2;
      for (
        let s = trim(e.from) + 3 + hash01(e.id, sign) * 6;
        s < L - trim(e.to);
        s += 10 + hash01(e.id + s, 7) * 5
      ) {
        const key = `${e.id}:${sign}:${Math.round(s)}`;
        if (hash01(key, 1) < 0.14) continue;
        const { x, y } = roadside(e, s, lat);
        if (!clear(x, y, 2)) continue;
        spots.push({
          x,
          y,
          key,
          kind: hash01(key, 2) < 0.12 ? "plum" : "leaf",
          size: 0.8 + hash01(key, 3) * 0.35,
        });
      }
    }
  }
  for (const rb of (map.roundabouts || new Map()).values())
    spots.push({
      x: rb.x,
      y: rb.y,
      key: rb.id,
      kind: "leaf",
      size: Math.min(0.85, 0.35 + rb.island_r * 0.12),
    });
  const [x0, y0, x1, y1] =
    typeof map.roadDistance === "function"
      ? map.extent || [0, 0, 0, 0]
      : [0, 0, 0, 0];
  for (let x = x0; x < x1; x += 13)
    for (let y = y0; y < y1; y += 13) {
      const key = `${x},${y}`;
      if (hash01(key, 9) > 0.4) continue;
      const px = x + hash01(key, 10) * 13,
        py = y + hash01(key, 11) * 13;
      if (nearBuilding(px, py, 2.5) || map.roadDistance(px, py).distance < 7)
        continue;
      spots.push({
        x: px,
        y: py,
        key,
        kind: hash01(key, 12) < 0.3 ? "conifer" : "leaf",
        size: 0.8 + hash01(key, 13) * 0.6,
      });
    }
  for (const t of spots)
    result.circles.push({
      id: `tree:${t.key}`,
      kind: "tree",
      x: t.x,
      y: t.y,
      radius: t.kind === "conifer" ? 0.17 * 1.2 : 0.17 * 1.5 * t.size,
    });
  for (const st of roads.streets)
    for (const e of [st.edge, st.twin]) {
      if (!e || !LIT.has(e.cls)) continue;
      const tall = ARTERIAL.has(e.cls),
        spacing = tall ? 38 : 45,
        phase = !tall && st.twin && e === st.twin ? spacing / 2 : 0;
      const from = trimAt(roads.nodeR, roads.legs, e.from) + 4,
        to = e.cum.at(-1) - trimAt(roads.nodeR, roads.legs, e.to) - 6;
      for (
        let s = from + 6 + phase + hash01(e.id, 3) * 4;
        s < to;
        s += spacing
      ) {
        const p = roadside(e, s, e.asphalt[1] + GUTTER + CURB + 0.45),
          reach = tall ? 2.3 : 1.5;
        const lamp = {
          ...p,
          h: tall ? 8.4 : 7,
          tall,
          lx: p.x - Math.sin(p.heading) * (reach + 0.1),
          ly: p.y + Math.cos(p.heading) * (reach + 0.1),
          id: `lamp_post:${e.id}:${s}`,
        };
        result.lamps.push(lamp);
        result.circles.push({
          id: lamp.id,
          kind: "lamp_post",
          x: lamp.x,
          y: lamp.y,
          radius: 0.22,
        });
      }
    }
  const labels = new Set(),
    seen = new Set();
  for (const e of (map.edges || new Map()).values()) {
    if (e.length < 45) continue;
    const key = [e.from, e.to].sort().join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    const plates = [];
    if (e.length > 80)
      plates.push({
        s: Math.min(25, e.length * 0.3),
        speed: true,
        text: String(Math.round((e.limit * 3.6) / 5) * 5),
        width: 0.65,
        height: 0.85,
      });
    if (e.name)
      plates.push({
        s: Math.max(15, e.length - 18),
        text: e.name,
        width: 2.2,
        height: 0.42,
      });
    for (const plate of plates) {
      const label = `${plate.speed ? "speed" : "street"}:${plate.text}`;
      if (!labels.has(label) && labels.size >= 128) continue;
      labels.add(label);
      const item = {
        ...plate,
        ...roadside(e, plate.s, e.asphalt[1] + 1.25),
        z: plate.speed ? 2.3 : 2.7,
        id: `sign_post:${e.id}:${plate.speed ? "speed" : "street"}`,
      };
      result.streetSigns.push(item);
      result.circles.push({
        id: item.id,
        kind: "sign_post",
        x: item.x,
        y: item.y,
        radius: 0.035,
      });
    }
  }
  for (const stop of (map.stops || new Map()).values()) {
    const e = map.edges.get(stop.edge);
    if (!e) continue;
    const item = {
      ...roadside(
        e,
        Math.min(stop.s_line + 0.4, e.cum.at(-1)),
        e.asphalt[1] + GUTTER + CURB + 0.7,
      ),
      id: `stop_post:${stop.id}`,
    };
    result.stopSigns.push(item);
    result.circles.push({ ...item, kind: "stop_post", radius: 0.035 });
  }
  for (const e of (map.edges || new Map()).values()) {
    if (e.control?.type !== "yield") continue;
    const item = {
      ...roadside(
        e,
        Math.max(0, e.control.s_line - 0.6),
        e.asphalt[1] + GUTTER + CURB + 0.7,
      ),
      id: `yield_post:${e.id}`,
    };
    result.yieldSigns.push(item);
    result.circles.push({ ...item, kind: "yield_post", radius: 0.035 });
  }
  for (const inter of (map.intersections || new Map()).values())
    for (const a of inter.approaches || []) {
      const e = map.edges.get(a.edge);
      if (!e) continue;
      const end = e.pts.at(-1),
        heading = headingAt(e.pts, e.cum, e.cum.at(-1) - 0.5),
        ahead = crossingHalf(map, e) + 2.2,
        poleLat = e.asphalt[1] + GUTTER + CURB + 1;
      const item = {
        inter,
        a,
        e,
        heading,
        poleLat,
        x: end[0] + Math.cos(heading) * ahead + Math.sin(heading) * poleLat,
        y: end[1] + Math.sin(heading) * ahead - Math.cos(heading) * poleLat,
        id: `signal_post:${inter.id}:${a.edge}`,
      };
      result.signals.push(item);
      result.circles.push({
        id: item.id,
        kind: "signal_post",
        x: item.x,
        y: item.y,
        radius: 0.17,
      });
    }
  return result;
}
