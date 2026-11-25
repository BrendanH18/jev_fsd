// Diagnostics for the browser's view of a map pack. Optional layer warnings are available
// without constructing a MapData or silently dropping records from the source data.

const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const id = (value) => typeof value === "string" && value.length > 0;
const finite = Number.isFinite;
const positive = (value) => finite(value) && value > 0;
const nonnegative = (value) => finite(value) && value >= 0;
const index = (value) => Number.isSafeInteger(value) && value >= 0;
const text = (value) => typeof value === "string";
const boolean = (value) => typeof value === "boolean";
const pair = (value) => Array.isArray(value) && value.length === 2 && finite(value[0]) && finite(value[1]);
const orderedPair = (value) => pair(value) && value[0] <= value[1];
const side = (value) => value === "left" || value === "right";
const line = (value) => Array.isArray(value) && value.length >= 2 && Array.from(value).every(pair);
const polygon = (value) => line(value) && value.length >= 3;
const oneOf =
  (...values) =>
  (value) =>
    values.includes(value);
const ids = (value) => Array.isArray(value) && Array.from(value).every(id);
const phase = oneOf("A", "B");
const clockRange = (value) =>
  record(value) &&
  Array.isArray(value.days) &&
  Array.from(value.days).every((day) => index(day) && day < 7) &&
  nonnegative(value.start) &&
  value.start <= 1440 &&
  nonnegative(value.end) &&
  value.end <= 1440;

function diagnostics() {
  const issues = [];
  const require = (path, value, predicate, expected) => {
    if (predicate(value)) return true;
    issues.push({ path, expected });
    return false;
  };
  const optional = (path, value, predicate, expected) => {
    if (value != null) require(path, value, predicate, expected);
  };
  const each = (path, items, visit) => {
    if (!require(path, items, Array.isArray, "an array of records")) return;
    for (const [i, value] of items.entries()) {
      const field = `${path}[${i}]`;
      if (require(field, value, record, "an object")) visit(value, field);
    }
  };
  const known = (path, value, lookup, entity) =>
    require(path, value, (key) => lookup.has(key), `an existing ${entity} id`);
  return { issues, require, optional, each, known };
}

function graph(pack, checks, detailed) {
  const { require, optional, each, known } = checks;
  const nodes = new Set(),
    edges = new Map(),
    lanes = new Set();
  each("nodes", pack.nodes, (node, path) => {
    if (require(`${path}.id`, node.id, id, "a node id") && detailed)
      require(`${path}.id`, node.id, (key) => !nodes.has(key), "a unique node id");
    nodes.add(node.id);
    require(`${path}.x`, node.x, finite, "a finite east coordinate");
    require(`${path}.y`, node.y, finite, "a finite north coordinate");
  });
  each("edges", pack.edges, (edge, path) => {
    if (require(`${path}.id`, edge.id, id, "a road id"))
      require(`${path}.id`, edge.id, (key) => !edges.has(key), "a unique road id");
    edges.set(edge.id, edge);
    require(`${path}.from`, edge.from, id, "a source node id");
    require(`${path}.to`, edge.to, id, "a destination node id");
    require(`${path}.pts`, edge.pts, line, "a polyline with at least two finite x/y points");
    if (!detailed) return;
    if (id(edge.from)) known(`${path}.from`, edge.from, nodes, "source node");
    if (id(edge.to)) known(`${path}.to`, edge.to, nodes, "destination node");
    require(`${path}.length`, edge.length, positive, "a positive road length in metres");
    require(`${path}.limit`, edge.limit, positive, "a positive speed limit in metres per second");
    require(`${path}.lanes`, edge.lanes, (value) => index(value) && value > 0, "a positive lane count");
    require(`${path}.lane_offsets`, edge.lane_offsets, (value) =>
      Array.isArray(value) &&
      value.length === edge.lanes &&
      Array.from(value).every(finite), "one finite centreline offset per lane");
    require(`${path}.asphalt`, edge.asphalt, orderedPair, "ordered left and right asphalt limits");
    optional(`${path}.lane_width`, edge.lane_width, positive, "a positive lane width");
    optional(`${path}.cls`, edge.cls, id, "a road class");
    optional(`${path}.name`, edge.name, text, "a street name");
    optional(`${path}.oneway`, edge.oneway, boolean, "a one-way flag");
  });
  each("lanes", pack.lanes, (lane, path) => {
    if (known(`${path}.edge`, lane.edge, edges, "road") && require(`${path}.idx`, lane.idx, index, "a lane index")) {
      const key = `${lane.edge}:${lane.idx}`;
      require(`${path}.idx`, key, (key) => !lanes.has(key), "a unique lane index on this road");
      lanes.add(key);
      if (detailed)
        require(`${path}.idx`, lane.idx, (value) =>
          value < edges.get(lane.edge).lanes, "an index in the road's lane count");
    }
    require(`${path}.pts`, lane.pts, line, "a lane polyline with at least two finite x/y points");
  });
  return { nodes, edges, lanes };
}

function mapControls(pack, edges, checks) {
  const { require, optional, each, known } = checks;
  const approaches = (items, path, visit) =>
    each(path, items, (a, field) => {
      known(`${field}.edge`, a.edge, edges, "approach road");
      require(`${field}.s_line`, a.s_line, nonnegative, "a nonnegative stop-line distance");
      visit?.(a, field);
    });
  each("intersections", pack.intersections, (inter, path) => {
    require(`${path}.id`, inter.id, id, "a signal id");
    require(`${path}.x`, inter.x, finite, "a finite signal east coordinate");
    require(`${path}.y`, inter.y, finite, "a finite signal north coordinate");
    optional(`${path}.vertices`, inter.vertices, ids, "a list of signal junction nodes");
    approaches(inter.approaches, `${path}.approaches`, (a, field) =>
      require(`${field}.group`, a.group, phase, "signal phase group A or B"),
    );
    optional(`${path}.cycle_s`, inter.cycle_s, positive, "a positive signal cycle duration");
    optional(`${path}.offset_s`, inter.offset_s, nonnegative, "a nonnegative signal cycle offset");
  });
  each("stops", pack.stops, (stop, path) => {
    require(`${path}.id`, stop.id, id, "a stop sign id");
    optional(`${path}.edge`, stop.edge, (value) => edges.has(value), "an existing stop approach road id");
    optional(`${path}.s_line`, stop.s_line, nonnegative, "a nonnegative distance along the stop approach");
    optional(`${path}.all_way`, stop.all_way, boolean, "an all-way stop flag");
  });
  if (pack.yields != null)
    each("yields", pack.yields, (yieldLine, path) => {
      require(`${path}.id`, yieldLine.id, id, "a yield control id");
      optional(`${path}.edge`, yieldLine.edge, (value) => edges.has(value), "an existing yield approach road id");
      optional(`${path}.s_line`, yieldLine.s_line, nonnegative, "a nonnegative distance along the yield approach");
    });
  if (pack.roundabouts != null)
    each("roundabouts", pack.roundabouts, (ring, path) => {
      require(`${path}.id`, ring.id, id, "a roundabout id");
      require(`${path}.vertices`, ring.vertices, ids, "a list of roundabout junction nodes");
      require(`${path}.edges`, ring.edges, (value) =>
        ids(value) && value.every((key) => edges.has(key)), "roads on the roundabout");
      require(`${path}.x`, ring.x, finite, "a finite roundabout centre east coordinate");
      require(`${path}.y`, ring.y, finite, "a finite roundabout centre north coordinate");
      require(`${path}.island_r`, ring.island_r, nonnegative, "a nonnegative island radius");
      require(`${path}.lane_r`, ring.lane_r, (value) =>
        positive(value) && value > ring.island_r, "a lane radius beyond the island");
      require(`${path}.outer_r`, ring.outer_r, (value) =>
        positive(value) && value > ring.lane_r, "an outer radius beyond the lane");
      optional(`${path}.ccw`, ring.ccw, boolean, "a counter-clockwise travel flag");
    });
  if (Array.isArray(pack.edges))
    for (const [i, edge] of pack.edges.entries()) {
      if (!record(edge) || edge.control == null) continue;
      const c = edge.control;
      const path = `edges[${i}].control`;
      if (!require(path, c, record, "a road control object")) continue;
      require(`${path}.id`, c.id, id, "a control id");
      require(`${path}.type`, c.type, oneOf("signal", "stop", "yield"), "a signal, stop or yield control");
      require(`${path}.s_line`, c.s_line, nonnegative, "a nonnegative road control distance");
      if (c.type === "signal") require(`${path}.group`, c.group, phase, "signal phase group A or B");
    }
}

function layerIssues(pack, edges, lanes, checks) {
  const { require, optional, each, known } = checks;
  const records = (layer, key, visit) => {
    if (pack[layer] == null) return;
    if (!require(layer, pack[layer], record, "a map layer object")) return;
    each(`${layer}.${key}`, pack[layer][key], visit);
  };
  const xy = (item, path, label) => {
    require(`${path}.x`, item.x, finite, `a finite ${label} east coordinate`);
    require(`${path}.y`, item.y, finite, `a finite ${label} north coordinate`);
  };
  const road = (item, path) => known(`${path}.edge`, item.edge, edges, "road");
  const span = (item, path) => {
    road(item, path);
    require(`${path}.from`, item.from, nonnegative, "a nonnegative span start");
    require(`${path}.to`, item.to, (value) => finite(value) && value > item.from, "an end beyond the span start");
  };
  records("crossings", "crossings", (crossing, path) => {
    require(`${path}.id`, crossing.id, id, "a crossing id");
    road(crossing, path);
    xy(crossing, path, "crossing");
    require(`${path}.s`, crossing.s, nonnegative, "a nonnegative crosswalk distance along the road");
    optional(`${path}.island`, crossing.island, boolean, "a pedestrian refuge flag");
    optional(`${path}.pxo`, crossing.pxo, boolean, "an Ontario pedestrian crossover flag");
    optional(`${path}.markings`, crossing.markings, text, "a crosswalk marking type");
  });
  records("calming", "devices", (device, path) => {
    require(`${path}.id`, device.id, id, "a traffic-calming device id");
    require(`${path}.kind`, device.kind, oneOf(
      "hump",
      "table",
      "cushion",
      "bump",
    ), "a supported traffic-calming device");
    xy(device, path, "device");
    each(`${path}.at`, device.at, (location, field) => {
      road(location, field);
      require(`${field}.s`, location.s, nonnegative, "a nonnegative calming device distance along the road");
    });
  });
  records("contraflow", "edges", (entry, path) => {
    if (road(entry, path)) require(`${path}.edge`, entry.edge, (key) => edges.get(key).oneway, "a one-way road");
    require(`${path}.side`, entry.side, side, "the left or right side of the road");
    require(`${path}.kind`, entry.kind, oneOf("lane", "track", "shared"), "a contra-flow lane, track or shared road");
  });
  records("driveways", "driveways", (driveway, path) => {
    require(`${path}.id`, driveway.id, id, "a driveway id");
    road(driveway, path);
    require(`${path}.s`, driveway.s, nonnegative, "a nonnegative driveway distance along the road");
    require(`${path}.side`, driveway.side, side, "the kerb side of the driveway");
    xy(driveway, path, "driveway");
    require(`${path}.heading`, driveway.heading, finite, "a finite driveway heading");
    require(`${path}.length`, driveway.length, positive, "a positive driveway length");
  });
  records("buslanes", "lanes", (busLane, path) => {
    if (road(busLane, path))
      require(`${path}.lane`, busLane.lane, (value) =>
        index(value) && lanes.has(`${busLane.edge}:${value}`), "a lane on the referenced road");
    require(`${path}.allowed`, busLane.allowed, ids, "the permitted bus-lane vehicle classes");
    optional(
      `${path}.hours`,
      busLane.hours,
      (value) => Array.isArray(value) && Array.from(value).every(clockRange),
      "bus-lane schedule intervals",
    );
  });
  records("zones", "zones", (zone, path) => {
    require(`${path}.kind`, zone.kind, oneOf("school", "playground"), "a school or playground zone");
    optional(`${path}.name`, zone.name, text, "a zone name");
    each(`${path}.spans`, zone.spans, span);
  });
  const parkIds = new Set();
  records("parks", "areas", (area, path) => {
    require(`${path}.id`, area.id, id, "a park or water area id");
    parkIds.add(area.id);
    require(`${path}.kind`, area.kind, oneOf("park", "garden", "grass", "river", "water"), "a park or water area kind");
    require(`${path}.closed`, area.closed, boolean, "a closed area flag");
    require(`${path}.rings`, area.rings, (value) =>
      Array.isArray(value) && Array.from(value).every(polygon), "area outline polygons");
    require(`${path}.lines`, area.lines, (value) =>
      Array.isArray(value) && Array.from(value).every(line), "water or park polylines");
  });
  records("parks", "spans", (item, path) => {
    span(item, path);
    if (item.left != null) known(`${path}.left`, item.left, parkIds, "left-side park or water area");
    if (item.right != null) known(`${path}.right`, item.right, parkIds, "right-side park or water area");
    require(`${path}.water`, item.water, boolean, "the adjacent water flag");
  });
  records("bridges", "spans", (bridge, path) => {
    span(bridge, path);
    optional(`${path}.name`, bridge.name, text, "a bridge name");
    optional(`${path}.kind`, bridge.kind, text, "a bridge kind");
  });
  const signals = new Set((Array.isArray(pack.intersections) ? pack.intersections : []).map((i) => i?.id));
  records("scrambles", "scrambles", (scramble, path) =>
    known(`${path}.signal`, scramble.signal, signals, "scramble signal"),
  );
  records("transit", "stops", (stop, path) => {
    require(`${path}.id`, stop.id, id, "a transit stop id");
    optional(`${path}.name`, stop.name, text, "a transit stop name");
    xy(stop, path, "transit stop");
  });
  records("transit", "routes", (route, path) => {
    require(`${path}.id`, route.id, id, "a transit line id");
    require(`${path}.mode`, route.mode, oneOf("bus", "tram", "trolleybus"), "a road transit mode");
    optional(`${path}.ref`, route.ref, text, "a transit line reference");
    optional(`${path}.colour`, route.colour, text, "a transit line colour");
    each(`${path}.runs`, route.runs, (run, field) => {
      require(`${field}.edges`, run.edges, (value) => ids(value) && value.length > 0, "a nonempty road chain");
      each(`${field}.stops`, run.stops, (stop, place) =>
        require(`${place}.s`, stop.s, nonnegative, "a nonnegative boarding position on the stop road"),
      );
    });
  });
  const railTracks = new Set();
  records("rail", "tracks", (track, path) => {
    if (require(`${path}.id`, track.id, id, "a rail track id")) railTracks.add(track.id);
    require(`${path}.pts`, track.pts, line, "a rail centreline with at least two finite points");
    require(`${path}.length`, track.length, positive, "a positive rail track length");
    optional(`${path}.kind`, track.kind, id, "a rail track kind");
    optional(`${path}.ends`, track.ends, (value) => ids(value) && value.length === 2, "two rail endpoint types");
    if (track.stops != null)
      each(`${path}.stops`, track.stops, (stop, field) =>
        require(`${field}.s`, stop.s, nonnegative, "a nonnegative rail stop distance along the track"),
      );
  });
  records("rail", "crossings", (item, path) => {
    require(`${path}.id`, item.id, id, "a level crossing id");
    known(`${path}.track`, item.track, railTracks, "rail track");
    require(`${path}.s`, item.s, nonnegative, "a nonnegative crossing distance along the track");
    xy(item, path, "rail crossing");
    optional(`${path}.heading_deg`, item.heading_deg, finite, "a finite rail crossing heading in degrees");
    optional(`${path}.lights`, item.lights, boolean, "a crossing lights flag");
    optional(`${path}.gates`, item.gates, boolean, "a crossing barriers flag");
    optional(`${path}.bell`, item.bell, boolean, "a crossing bell flag");
    each(`${path}.edges`, item.edges, (crossing, field) => {
      road(crossing, field);
      require(`${field}.s`, crossing.s, nonnegative, "a nonnegative rail crossing distance along the road");
      optional(`${field}.angle_deg`, crossing.angle_deg, finite, "a finite road-to-rail angle in degrees");
    });
  });
}

export function inspectMapPack(pack) {
  const checks = diagnostics();
  if (!checks.require("pack", pack, record, "a map pack object")) return checks.issues;
  const { edges, lanes } = graph(pack, checks, true);
  const bounds = (value) =>
    Array.isArray(value) &&
    value.length === 4 &&
    Array.from(value).every(finite) &&
    value[0] <= value[2] &&
    value[1] <= value[3];
  checks.optional("bbox", pack.bbox, bounds, "an ordered finite geographic bounding box");
  checks.optional("routing_bbox", pack.routing_bbox, bounds, "an ordered finite routing bounding box");
  checks.optional("extent", pack.extent, bounds, "an ordered finite projected extent");
  checks.optional(
    "utc_offset",
    pack.utc_offset,
    (value) => finite(value) && value >= -12 && value <= 14,
    "a UTC offset in hours",
  );
  mapControls(pack, edges, checks);
  layerIssues(pack, edges, lanes, checks);
  if (pack.buildings != null)
    checks.each("buildings", pack.buildings, (building, path) => {
      checks.require(`${path}.pts`, building.pts, polygon, "a finite building footprint polygon");
      checks.require(`${path}.h`, building.h, positive, "a positive building height");
    });
  return checks.issues;
}

// Fail early before indexing malformed geometry. The more detailed inspection remains available
// for reporting optional layer and metadata issues without imposing a new map-pack format.
export function requireMapGraph(pack) {
  const checks = diagnostics();
  if (checks.require("pack", pack, record, "a map pack object")) {
    graph(pack, checks, false);
    checks.each("intersections", pack.intersections, () => {});
    checks.each("stops", pack.stops, () => {});
  }
  if (checks.issues.length) {
    const { path, expected } = checks.issues[0];
    throw new TypeError(`Map pack ${path} requires ${expected}`);
  }
}
