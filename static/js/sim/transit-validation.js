// Offline diagnostics for the map data consumed by buses, streetcars and trains.
import { cumulative, pointAt, projectPoint } from "../map/mapdata.js";

const ROUNDED_M = 0.051;
const STOP_END_M = 15;
const MIN_CROSSING_DEG = 20;
const MAX_ROAD_SNAP_M = 3.03; // Builder's 3 m snap, plus coordinate rounding.
const MODES = new Set(["bus", "trolleybus", "tram"]);
const TRACK_KINDS = new Set(["rail", "light_rail", "tram", "narrow_gauge"]);
const END_KINDS = new Set(["edge", "terminus"]);
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const idString = (value) => typeof value === "string" && value.trim().length > 0;
const positive = (value) => Number.isFinite(value) && value > 0;
const coordinates = (x, y) => Number.isFinite(x) && Number.isFinite(y);
const within = (s, length) => Number.isFinite(s) && s >= 0 && s <= length + ROUNDED_M;

// Report malformed entries in place and continue checking the independent entries.
function array(value, path, report) {
  if (Array.isArray(value)) return value;
  report("array", path, "Expected an array.");
  return [];
}

function index(entries, path, report) {
  const seen = new Map();
  for (const [i, entry] of entries.entries()) {
    const at = `${path}[${i}]`;
    if (!record(entry)) {
      report("record", at, "Expected an object.");
      continue;
    }
    if (!idString(entry.id)) report("id", `${at}.id`, "Expected a nonempty identifier.");
    else if (seen.has(entry.id)) report("duplicate-id", `${at}.id`, `Already declared at ${seen.get(entry.id)}.`);
    else seen.set(entry.id, at);
  }
  return seen;
}

function header(layer, kind, pack, report) {
  if (!record(layer)) {
    report("layer", kind, "Expected a layer object.");
    return false;
  }
  if (layer[`${kind}_version`] !== "1") report("layer-version", kind, "Expected layer version 1.");
  if (typeof layer.name !== "string") report("layer-name", `${kind}.name`, "Expected the map name.");
  else if (typeof pack.name === "string" && layer.name !== pack.name)
    report("wrong-map", `${kind}.name`, `Expected "${pack.name}", the name in the street pack.`);
  return true;
}

function roadCumulative(edge, cache) {
  if (!cache.has(edge.id)) {
    const points = edge.pts;
    const usable = Array.isArray(points) && points.length >= 2 && points.every((p) => coordinates(p?.[0], p?.[1]));
    cache.set(edge.id, usable ? cumulative(points) : null);
  }
  return cache.get(edge.id);
}

function auditTransit(layer, pack, graph, report) {
  const totals = { routes: 0, runs: 0, stops: 0, placements: 0, busKm: 0, streetcarKm: 0 };
  if (!header(layer, "transit", pack, report)) return totals;
  const routes = array(layer.routes, "transit.routes", report);
  const signs = array(layer.stops, "transit.stops", report);
  const knownStops = index(signs, "transit.stops", report);
  const streetGeometry = new Map();
  index(routes, "transit.routes", report);
  totals.routes = routes.length;
  totals.stops = signs.length;
  const used = new Set();
  const signById = new Map(signs.filter(record).map((sign) => [sign.id, sign]));
  const signatures = new Set();
  for (const [i, sign] of signs.entries()) {
    if (!record(sign)) continue;
    const at = `transit.stops[${i}]`;
    if (!coordinates(sign.x, sign.y)) report("stop-position", at, "Expected finite stop coordinates in metres.");
    if (typeof sign.name !== "string") report("stop-name", `${at}.name`, "Expected a string, which may be empty.");
  }
  for (const [i, route] of routes.entries()) {
    if (!record(route)) continue;
    const at = `transit.routes[${i}]`;
    if (!MODES.has(route.mode)) report("route-mode", `${at}.mode`, "Expected bus, trolleybus or tram.");
    if (!idString(route.ref)) report("route-ref", `${at}.ref`, "Expected a nonempty public route reference.");
    if (!idString(route.name)) report("route-name", `${at}.name`, "Expected a nonempty headsign.");
    if ("colour" in route && !idString(route.colour))
      report("route-colour", `${at}.colour`, "Expected a nonempty colour string when supplied.");
    const runs = array(route.runs, `${at}.runs`, report);
    if (Array.isArray(route.runs) && !runs.length)
      report("empty-route", `${at}.runs`, "The route has no drivable run.");
    totals.runs += runs.length;
    for (const [j, run] of runs.entries()) {
      const path = `${at}.runs[${j}]`;
      if (!record(run)) {
        report("record", path, "Expected a run object.");
        continue;
      }
      const ids = array(run.edges, `${path}.edges`, report);
      const placements = array(run.stops, `${path}.stops`, report);
      totals.placements += placements.length;
      if (Array.isArray(run.edges) && !ids.length) report("empty-run", `${path}.edges`, "A run needs a starting edge.");
      if (!positive(run.length)) report("run-length", `${path}.length`, "Expected a positive run length in metres.");
      else if (route.mode === "tram") totals.streetcarKm += run.length / 1000;
      else if (MODES.has(route.mode)) totals.busKm += run.length / 1000;
      if (route.mode === "tram" && (!Number.isInteger(run.lane) || run.lane < 0))
        report("tram-lane", `${path}.lane`, "Expected a nonnegative lane index for a tram run.");
      if (route.mode !== "tram" && "lane" in run)
        report("bus-lane", `${path}.lane`, "Bus runs select lanes at runtime.", "warning");
      let length = 0;
      let complete = true;
      let previous = null;
      const offsets = new Map();
      for (const [k, id] of ids.entries()) {
        const edgeAt = `${path}.edges[${k}]`;
        const edge = graph.get(id);
        if (!edge) {
          report("run-edge", edgeAt, `Street edge "${String(id)}" is absent from the pack.`);
          complete = false;
          previous = null;
          continue;
        }
        if (!positive(edge.length)) {
          report("street-length", edgeAt, "The referenced street edge needs a positive length.");
          complete = false;
        }
        if (previous && previous.to !== edge.from)
          report("run-disconnected", edgeAt, `Edge "${id}" does not continue from "${previous.id}".`);
        if (route.mode === "tram" && Number.isInteger(run.lane) && run.lane >= edge.lanes)
          report(
            "tram-lane-clamp",
            edgeAt,
            `Edge "${id}" cannot fit lane ${run.lane}. The simulator clamps it.`,
            "warning",
          );
        if (!offsets.has(id)) offsets.set(id, []);
        offsets.get(id).push(length);
        length += edge.length;
        previous = edge;
      }
      if (complete && positive(run.length) && Math.abs(length - run.length) > ROUNDED_M)
        report("run-length-drift", `${path}.length`, `Street edges total ${length.toFixed(2)} m.`);
      if (ids.length && ids.every(idString)) {
        const sig = JSON.stringify([route.ref, ids]);
        if (signatures.has(sig))
          report("duplicate-run", path, "The same public route already uses these edges in this order.");
        signatures.add(sig);
      }
      let last = -Infinity;
      const placed = new Set();
      for (const [k, stop] of placements.entries()) {
        const stopAt = `${path}.stops[${k}]`;
        if (!record(stop)) {
          report("record", stopAt, "Expected a stop placement object.");
          continue;
        }
        if (!knownStops.has(stop.id))
          report("unlisted-stop", `${stopAt}.id`, `No stop sign matches "${String(stop.id)}".`);
        else used.add(stop.id);
        const placement = JSON.stringify([stop.id, stop.edge, stop.s]);
        if (placed.has(placement))
          report("duplicate-placement", stopAt, "This sign is already placed at the same position.");
        placed.add(placement);
        if (!offsets.has(stop.edge)) {
          report("off-run-stop", `${stopAt}.edge`, "The stop's street edge is absent from this run.");
          continue;
        }
        const edge = graph.get(stop.edge);
        if (!within(stop.s, edge.length)) {
          report("stop-distance", `${stopAt}.s`, "The stop must be within its street edge.");
          continue;
        }
        if (edge.pts && knownStops.has(stop.id)) {
          const cum = roadCumulative(edge, streetGeometry);
          const sign = signById.get(stop.id);
          if (coordinates(sign?.x, sign?.y) && cum?.at(-1) > 0) {
            const pos = pointAt(edge.pts, cum, (cum.at(-1) * stop.s) / edge.length);
            if (Math.hypot(pos[0] - sign.x, pos[1] - sign.y) > 30)
              report("stop-far-from-street", stopAt, "The sign is more than 30 m from its run placement.", "warning");
          }
        }
        if (!complete) continue;
        const positions = offsets.get(stop.edge);
        const atOrAfterLast = positions.find((offset) => offset + stop.s >= last - ROUNDED_M);
        if (atOrAfterLast === undefined) {
          report("stop-order", stopAt, "This stop occurs before the preceding stop on the run.", "warning");
          continue;
        }
        const along = atOrAfterLast + stop.s;
        if (along < STOP_END_M - ROUNDED_M || along > length - STOP_END_M + ROUNDED_M)
          report("stop-near-run-end", stopAt, "The stop is within 15 m of the start or end of the run.", "warning");
        last = along;
      }
    }
  }
  for (const [id, at] of knownStops) {
    if (!used.has(id)) report("unused-stop", at, "No run visits this sign.", "warning");
  }
  return totals;
}

function auditTrack(track, at, report) {
  if (!TRACK_KINDS.has(track.kind)) report("track-kind", `${at}.kind`, "Expected a supported railway type.");
  if (typeof track.name !== "string") report("track-name", `${at}.name`, "Expected a string, which may be empty.");
  if (typeof track.operator !== "string") report("track-operator", `${at}.operator`, "Expected an operator string.");
  if (typeof track.usage !== "string") report("track-usage", `${at}.usage`, "Expected a usage string.");
  if (!Array.isArray(track.ends) || track.ends.length !== 2 || !track.ends.every((end) => END_KINDS.has(end)))
    report("track-ends", `${at}.ends`, "Expected two ends, each an edge or a terminus.");
  if (!positive(track.length)) report("track-length", `${at}.length`, "Expected a positive track length in metres.");
  const pts = array(track.pts, `${at}.pts`, report);
  if (Array.isArray(track.pts) && pts.length < 2)
    report("short-polyline", `${at}.pts`, "A rail polyline needs at least two points.");
  let usable = pts.length >= 2;
  for (const [i, p] of pts.entries()) {
    const prev = pts[i - 1];
    if (!Array.isArray(p) || p.length !== 2 || !coordinates(p[0], p[1])) {
      report("track-point", `${at}.pts[${i}]`, "Expected a pair of finite coordinates in metres.");
      usable = false;
    } else if (prev?.[0] === p[0] && prev[1] === p[1])
      report("duplicate-track-point", `${at}.pts[${i}]`, "The previous point has the same coordinates.", "warning");
  }
  const cum = usable ? cumulative(pts) : null;
  if (cum && !positive(cum.at(-1))) report("track-degenerate", `${at}.pts`, "The polyline covers no distance.");
  // The geometry is rounded to centimetres and recorded length to decimetres.
  if (cum && positive(track.length) && Math.abs(cum.at(-1) - track.length) > ROUNDED_M + pts.length * 0.015)
    report("track-length-drift", `${at}.length`, `The polyline measures ${cum.at(-1).toFixed(2)} m.`);
  const stops = array(track.stops, `${at}.stops`, report);
  index(stops, `${at}.stops`, report);
  let last = -Infinity;
  for (const [i, st] of stops.entries()) {
    if (!record(st)) continue;
    const stopAt = `${at}.stops[${i}]`;
    if (typeof st.name !== "string") report("station-name", `${stopAt}.name`, "Expected a string, which may be empty.");
    if (!within(st.s, track.length)) {
      report("station-distance", `${stopAt}.s`, "A station must be within its track.");
      continue;
    }
    if (st.s < last) report("station-order", stopAt, "Stations should be ordered along the track.", "warning");
    last = st.s;
  }
  return cum;
}

function auditRail(layer, pack, graph, report) {
  const totals = { tracks: 0, stations: 0, crossings: 0, crossingEdges: 0, trackKm: 0 };
  if (!header(layer, "rail", pack, report)) return totals;
  const tracks = array(layer.tracks, "rail.tracks", report);
  const crossings = array(layer.crossings, "rail.crossings", report);
  index(tracks, "rail.tracks", report);
  // An OSM node may serve more than one track. Crossing IDs are scoped to a track.
  const crossingIds = new Set();
  const tracksById = new Map();
  totals.tracks = tracks.length;
  totals.crossings = crossings.length;
  for (const [i, track] of tracks.entries()) {
    if (!record(track)) continue;
    const at = `rail.tracks[${i}]`;
    const cum = auditTrack(track, at, report);
    if (positive(track.length)) totals.trackKm += track.length / 1000;
    if (Array.isArray(track.stops)) totals.stations += track.stops.length;
    if (idString(track.id) && !tracksById.has(track.id)) tracksById.set(track.id, { track, cum, at });
  }
  const used = new Set();
  const roadGeometry = new Map();
  for (const [i, crossing] of crossings.entries()) {
    const at = `rail.crossings[${i}]`;
    if (!record(crossing)) {
      report("record", at, "Expected a crossing object.");
      continue;
    }
    if (!idString(crossing.id)) report("id", `${at}.id`, "Expected a nonempty crossing identifier.");
    else {
      const key = JSON.stringify([crossing.track, crossing.id]);
      if (crossingIds.has(key))
        report("duplicate-crossing", at, "This crossing is already declared for the same track.");
      crossingIds.add(key);
    }
    const ref = tracksById.get(crossing.track);
    if (!ref) report("crossing-track", `${at}.track`, "The crossing's track is absent from the layer.");
    else {
      used.add(crossing.track);
      if (!within(crossing.s, ref.track.length))
        report("crossing-distance", `${at}.s`, "The crossing must be within its track.");
      else if (ref.cum && coordinates(crossing.x, crossing.y)) {
        const pos = pointAt(ref.track.pts, ref.cum, crossing.s);
        if (Math.hypot(pos[0] - crossing.x, pos[1] - crossing.y) > 1)
          report(
            "crossing-off-track",
            at,
            "The crossing's coordinates differ from its rail position by more than 1 m.",
          );
      }
    }
    if (!coordinates(crossing.x, crossing.y))
      report("crossing-position", at, "Expected finite crossing coordinates in metres.");
    if (!(crossing.heading_deg >= -180 && crossing.heading_deg <= 180 && Number.isFinite(crossing.heading_deg)))
      report("crossing-heading", `${at}.heading_deg`, "Expected a heading from -180 to 180 degrees.");
    for (const flag of ["lights", "gates", "bell"]) {
      if (typeof crossing[flag] !== "boolean")
        report("crossing-control", `${at}.${flag}`, "Expected a boolean crossing-control flag.");
    }
    const roads = array(crossing.edges, `${at}.edges`, report);
    if (Array.isArray(crossing.edges) && !roads.length)
      report("crossing-no-road", `${at}.edges`, "A level crossing needs at least one street edge.");
    totals.crossingEdges += roads.length;
    const seen = new Set();
    for (const [j, on] of roads.entries()) {
      const roadAt = `${at}.edges[${j}]`;
      if (!record(on)) {
        report("record", roadAt, "Expected a crossing street approach object.");
        continue;
      }
      const edge = graph.get(on.edge);
      if (!edge) report("crossing-edge", `${roadAt}.edge`, "The crossing's street edge is absent from the pack.");
      else {
        if (edge.ring) report("crossing-roundabout", `${roadAt}.edge`, "A roundabout ring cannot carry this crossing.");
        if (!within(on.s, edge.length))
          report("crossing-road-distance", `${roadAt}.s`, "The crossing must be within its street edge.");
        if (coordinates(crossing.x, crossing.y) && edge.pts) {
          const cum = roadCumulative(edge, roadGeometry);
          const snap = cum && projectPoint(edge.pts, cum, [crossing.x, crossing.y], null);
          if (snap && snap.distance > MAX_ROAD_SNAP_M)
            report("crossing-off-street", roadAt, "The crossing lies more than 3 m from the street centreline.");
          if (
            snap &&
            within(on.s, edge.length) &&
            cum.at(-1) > 0 &&
            Math.abs((snap.s * edge.length) / cum.at(-1) - on.s) > 0.15
          )
            report(
              "crossing-street-position",
              `${roadAt}.s`,
              "The recorded position differs from the projection onto this street.",
            );
        }
      }
      if (seen.has(on.edge)) report("duplicate-crossing-edge", roadAt, "This street edge is already listed here.");
      seen.add(on.edge);
      if (!Number.isFinite(on.angle_deg) || on.angle_deg < MIN_CROSSING_DEG || on.angle_deg > 90)
        report(
          "crossing-angle",
          `${roadAt}.angle_deg`,
          "Expected the acute track-to-street angle, from 20 to 90 degrees.",
        );
    }
  }
  for (const [id, { at }] of tracksById) {
    if (!used.has(id)) report("track-no-crossing", at, "No level crossing refers to this track.", "warning");
  }
  return totals;
}

export function auditTransitLayers(pack, { transit, rail } = {}) {
  const diagnostics = [];
  const report = (code, path, message, severity = "error") => diagnostics.push({ code, path, message, severity });
  if (!record(pack)) {
    report("street-pack", "pack", "Expected a street pack object.");
    return { diagnostics };
  }
  const streets = array(pack.edges, "pack.edges", report);
  const graph = new Map(streets.filter(record).map((edge) => [edge.id, edge]));
  const totals = {};
  if (transit !== undefined) totals.transit = auditTransit(transit, pack, graph, report);
  if (rail !== undefined) totals.rail = auditRail(rail, pack, graph, report);
  return { totals, diagnostics };
}
