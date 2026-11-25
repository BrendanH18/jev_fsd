import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { auditTransitLayers } from "../static/js/sim/transit-validation.js";

function fixture() {
  const pack = {
    name: "fixture",
    edges: [
      {
        id: "a",
        from: "w",
        to: "m",
        length: 100,
        lanes: 1,
        pts: [
          [0, 0],
          [100, 0],
        ],
      },
      {
        id: "b",
        from: "m",
        to: "e",
        length: 100,
        lanes: 1,
        pts: [
          [100, 0],
          [200, 0],
        ],
      },
    ],
  };
  const stop = { id: "stop", name: "Main Street", x: 30, y: -2 };
  const placement = { id: "stop", edge: "a", s: 30 };
  const run = { edges: ["a", "b"], length: 200, stops: [placement] };
  const route = { id: "route", ref: "4", mode: "bus", name: "Main", runs: [run] };
  const transit = { name: pack.name, transit_version: "1", stops: [stop], routes: [route] };
  const station = { id: "station", name: "Main Street", s: 25 };
  const track = {
    id: "t",
    kind: "tram",
    name: "Track",
    operator: "Local transit",
    usage: "",
    ends: ["edge", "terminus"],
    pts: [
      [50, -50],
      [50, 50],
    ],
    length: 100,
    stops: [station],
  };
  const approach = { edge: "a", s: 50, angle_deg: 90 };
  const crossing = {
    id: "c",
    track: "t",
    s: 50,
    x: 50,
    y: 0,
    heading_deg: 90,
    lights: false,
    gates: false,
    bell: false,
    edges: [approach],
  };
  const rail = { name: pack.name, rail_version: "1", tracks: [track], crossings: [crossing] };
  return { pack, transit, rail, stop, placement, run, route, station, track, approach, crossing };
}

const warnings = new Set([
  "bus-lane",
  "duplicate-track-point",
  "station-order",
  "stop-far-from-street",
  "stop-near-run-end",
  "stop-order",
  "track-no-crossing",
  "tram-lane-clamp",
  "unused-stop",
]);

const cases = [
  [
    "array",
    "transit.routes",
    ({ transit }) => {
      transit.routes = false;
    },
  ],
  [
    "bus-lane",
    "runs[0].lane",
    ({ run }) => {
      run.lane = 1;
    },
  ],
  [
    "crossing-angle",
    "edges[0].angle_deg",
    ({ approach }) => {
      approach.angle_deg = 19;
    },
  ],
  [
    "crossing-control",
    ".lights",
    ({ crossing }) => {
      crossing.lights = 1;
    },
  ],
  [
    "crossing-distance",
    "crossings[0].s",
    ({ crossing }) => {
      crossing.s = 101;
    },
  ],
  [
    "crossing-edge",
    "edges[0].edge",
    ({ approach }) => {
      approach.edge = "gone";
    },
  ],
  [
    "crossing-heading",
    "heading_deg",
    ({ crossing }) => {
      crossing.heading_deg = 181;
    },
  ],
  [
    "crossing-no-road",
    "crossings[0].edges",
    ({ crossing }) => {
      crossing.edges = [];
    },
  ],
  [
    "crossing-off-street",
    "crossings[0].edges[0]",
    ({ crossing }) => {
      crossing.y = 4;
    },
  ],
  [
    "crossing-off-track",
    "crossings[0]",
    ({ crossing }) => {
      crossing.x = 52;
    },
  ],
  [
    "crossing-position",
    "crossings[0]",
    ({ crossing }) => {
      crossing.x = Infinity;
    },
  ],
  [
    "crossing-road-distance",
    "edges[0].s",
    ({ approach }) => {
      approach.s = -1;
    },
  ],
  [
    "crossing-roundabout",
    "edges[0].edge",
    ({ pack }) => {
      pack.edges[0].ring = true;
    },
  ],
  [
    "crossing-street-position",
    "edges[0].s",
    ({ approach }) => {
      approach.s = 60;
    },
  ],
  [
    "crossing-track",
    "crossings[0].track",
    ({ crossing }) => {
      crossing.track = "gone";
    },
  ],
  [
    "duplicate-crossing",
    "crossings[1]",
    ({ rail, crossing }) => {
      rail.crossings.push({ ...crossing });
    },
  ],
  [
    "duplicate-crossing-edge",
    "edges[1]",
    ({ crossing, approach }) => {
      crossing.edges.push({ ...approach });
    },
  ],
  [
    "duplicate-id",
    "transit.stops[1].id",
    ({ transit, stop }) => {
      transit.stops.push({ ...stop });
    },
  ],
  [
    "duplicate-placement",
    "runs[0].stops[1]",
    ({ run, placement }) => {
      run.stops.push({ ...placement });
    },
  ],
  [
    "duplicate-run",
    "runs[1]",
    ({ route, run }) => {
      route.runs.push({ ...run });
    },
  ],
  [
    "duplicate-track-point",
    "tracks[0].pts[1]",
    ({ track }) => {
      track.pts.unshift(track.pts[0]);
    },
  ],
  [
    "empty-route",
    "routes[0].runs",
    ({ route }) => {
      route.runs = [];
    },
  ],
  [
    "empty-run",
    "runs[0].edges",
    ({ run }) => {
      run.edges = [];
    },
  ],
  [
    "id",
    "routes[0].id",
    ({ route }) => {
      route.id = " ";
    },
  ],
  [
    "layer",
    "transit",
    (f) => {
      f.transit = null;
    },
  ],
  [
    "layer-name",
    "transit.name",
    ({ transit }) => {
      delete transit.name;
    },
  ],
  [
    "layer-version",
    "transit",
    ({ transit }) => {
      transit.transit_version = "2";
    },
  ],
  [
    "off-run-stop",
    "stops[0].edge",
    ({ placement }) => {
      placement.edge = "gone";
    },
  ],
  [
    "record",
    "transit.routes[0]",
    ({ transit }) => {
      transit.routes[0] = null;
    },
  ],
  [
    "route-colour",
    "routes[0].colour",
    ({ route }) => {
      route.colour = 4;
    },
  ],
  [
    "route-mode",
    "routes[0].mode",
    ({ route }) => {
      route.mode = "train";
    },
  ],
  [
    "route-name",
    "routes[0].name",
    ({ route }) => {
      route.name = "";
    },
  ],
  [
    "route-ref",
    "routes[0].ref",
    ({ route }) => {
      route.ref = "";
    },
  ],
  [
    "run-disconnected",
    "runs[0].edges[1]",
    ({ run }) => {
      run.edges.reverse();
    },
  ],
  [
    "run-edge",
    "runs[0].edges[1]",
    ({ run }) => {
      run.edges[1] = "gone";
    },
  ],
  [
    "run-length",
    "runs[0].length",
    ({ run }) => {
      run.length = 0;
    },
  ],
  [
    "run-length-drift",
    "runs[0].length",
    ({ run }) => {
      run.length += 2;
    },
  ],
  [
    "short-polyline",
    "tracks[0].pts",
    ({ track }) => {
      track.pts.pop();
    },
  ],
  [
    "station-distance",
    "tracks[0].stops[0].s",
    ({ station }) => {
      station.s = -3;
    },
  ],
  [
    "station-name",
    "tracks[0].stops[0].name",
    ({ station }) => {
      station.name = 4;
    },
  ],
  [
    "station-order",
    "tracks[0].stops[1]",
    ({ track }) => {
      track.stops.push({ id: "previous", s: 1, name: "" });
    },
  ],
  [
    "stop-distance",
    "runs[0].stops[0].s",
    ({ placement }) => {
      placement.s = 120;
    },
  ],
  [
    "stop-far-from-street",
    "runs[0].stops[0]",
    ({ stop }) => {
      stop.y = -60;
    },
  ],
  [
    "stop-name",
    "transit.stops[0].name",
    ({ stop }) => {
      stop.name = null;
    },
  ],
  [
    "stop-near-run-end",
    "runs[0].stops[0]",
    ({ placement }) => {
      placement.s = 1;
    },
  ],
  [
    "stop-order",
    "runs[0].stops[1]",
    ({ run, placement }) => {
      run.stops.push({ ...placement, s: 20 });
    },
  ],
  [
    "stop-position",
    "transit.stops[0]",
    ({ stop }) => {
      stop.y = NaN;
    },
  ],
  [
    "street-length",
    "runs[0].edges[1]",
    ({ pack }) => {
      pack.edges[1].length = -50;
    },
  ],
  [
    "street-pack",
    "pack",
    (f) => {
      f.pack = [];
    },
  ],
  [
    "track-degenerate",
    "tracks[0].pts",
    ({ track }) => {
      track.pts[1] = track.pts[0];
    },
  ],
  [
    "track-ends",
    "tracks[0].ends",
    ({ track }) => {
      track.ends = ["end", "terminus"];
    },
  ],
  [
    "track-kind",
    "tracks[0].kind",
    ({ track }) => {
      track.kind = "subway";
    },
  ],
  [
    "track-length",
    "tracks[0].length",
    ({ track }) => {
      track.length = 0;
    },
  ],
  [
    "track-length-drift",
    "tracks[0].length",
    ({ track }) => {
      track.length = 120;
    },
  ],
  [
    "track-name",
    "tracks[0].name",
    ({ track }) => {
      track.name = false;
    },
  ],
  [
    "track-no-crossing",
    "tracks[0]",
    ({ rail }) => {
      rail.crossings = [];
    },
  ],
  [
    "track-operator",
    "tracks[0].operator",
    ({ track }) => {
      delete track.operator;
    },
  ],
  [
    "track-point",
    "tracks[0].pts[1]",
    ({ track }) => {
      track.pts[1] = [50, "100"];
    },
  ],
  [
    "track-usage",
    "tracks[0].usage",
    ({ track }) => {
      track.usage = null;
    },
  ],
  [
    "tram-lane",
    "runs[0].lane",
    ({ route }) => {
      route.mode = "tram";
    },
  ],
  [
    "tram-lane-clamp",
    "runs[0].edges[0]",
    ({ route, run }) => {
      route.mode = "tram";
      run.lane = 1;
    },
  ],
  [
    "unlisted-stop",
    "runs[0].stops[0].id",
    ({ placement }) => {
      placement.id = "gone";
    },
  ],
  [
    "unused-stop",
    "transit.stops[0]",
    ({ run }) => {
      run.stops = [];
    },
  ],
  [
    "wrong-map",
    "transit.name",
    ({ transit }) => {
      transit.name = "other";
    },
  ],
];

for (const [code, suffix, mutate] of cases) {
  test(`report ${code} at its data path`, () => {
    const input = fixture();
    mutate(input);
    const { diagnostics } = auditTransitLayers(input.pack, input);
    const result = diagnostics.find((d) => d.code === code && d.path.endsWith(suffix));
    assert.equal(result?.severity, warnings.has(code) ? "warning" : "error");
    assert.ok(result.message.length > 0);
  });
}

test("count shared signs separately from route placements and aggregate distance by mode", () => {
  const input = fixture();
  const { transit, route, run } = input;
  const snapshot = JSON.stringify(transit);
  const good = auditTransitLayers(input.pack, input);
  assert.equal(good.diagnostics.length, 0);
  assert.equal(good.totals.transit.busKm, 0.2);
  assert.equal(good.totals.transit.runs, 1);
  assert.equal(good.totals.rail.trackKm, 0.1);
  assert.equal(good.totals.rail.stations, 1);
  assert.equal(good.totals.rail.crossingEdges, 1);
  assert.equal(JSON.stringify(transit), snapshot);
  transit.routes.push({ ...route, id: "tram", ref: "5", mode: "tram", runs: [{ ...run, lane: 0 }] });
  const multi = auditTransitLayers(input.pack, input);
  assert.equal(multi.diagnostics.length, 0);
  assert.equal(multi.totals.transit.stops, 1);
  assert.equal(multi.totals.transit.placements, 2);
  assert.equal(multi.totals.transit.streetcarKm, 0.2);
});

test("treat a junction shared by multiple tracks as more than one crossing", () => {
  const f = fixture();
  f.rail.tracks.push({ ...f.track, id: "parallel" });
  f.rail.crossings.push({ ...f.crossing, track: "parallel" });
  const { diagnostics, totals } = auditTransitLayers(f.pack, f);
  assert.equal(diagnostics.length, 0);
  assert.equal(totals.rail.tracks, 2);
  assert.equal(totals.rail.crossings, 2);
});

function cli(...args) {
  const run = spawnSync(
    process.execPath,
    ["--experimental-default-type=module", "scripts/audit_transit_layers.mjs", ...args],
    { encoding: "utf8" },
  );
  if (run.error) throw run.error;
  return run;
}

test("inspect all bundled maps offline", () => {
  const result = cli("--json");
  assert.equal(result.status, 0, result.stderr || result.stdout.slice(0, 5000));
  const reports = JSON.parse(result.stdout);
  assert.equal(
    reports.some((r) => r.map === "edmonton" && r.totals.rail.crossings > 0),
    true,
  );
  assert.equal(
    reports.some((r) => r.map === "toronto" && r.totals.transit.streetcarKm > 0),
    true,
  );
  assert.equal(
    reports.some((r) => r.map === "quebec_city" && r.totals.transit.runs > 0),
    true,
  );
  assert.equal(reports.length, 12);
});

test("select several bundled maps in the requested order", () => {
  const result = cli("--map", "edmonton,kitsilano", "--json");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    JSON.parse(result.stdout)
      .map((r) => r.map)
      .join(","),
    "edmonton,kitsilano",
  );
});

test("report usage errors independently from data diagnostics", () => {
  assert.equal(cli("--help").status, 0);
  assert.match(cli("--map", "unknown").stderr, /Unknown map/);
  assert.equal(cli("--map", "edmonton,edmonton").status, 2);
  assert.equal(cli("--map", "edmonton", "--pack", "none").status, 2);
  assert.equal(cli("--transit", "none").status, 2);
  assert.equal(cli("--pack", "none").status, 2);
});

test("inspect custom files, optionally fail on warnings, and keep malformed input diagnostics on stderr", () => {
  const dir = mkdtempSync(join(tmpdir(), "jev-transit-layers-"));
  try {
    const input = fixture();
    const pack = join(dir, "custom pack.json");
    const layer = join(dir, "transit.json");
    writeFileSync(pack, JSON.stringify(input.pack));
    const options = ["--pack", pack, "--transit", layer];
    writeFileSync(layer, JSON.stringify(input.transit));
    assert.match(cli(...options).stdout, /1 routes, 1 runs, 1 signs, 1 placements/);
    input.route.runs[0].lane = 0;
    writeFileSync(layer, JSON.stringify(input.transit));
    assert.equal(cli(...options).status, 0);
    assert.equal(cli(...options, "--strict").status, 1);
    input.route.ref = null;
    writeFileSync(layer, JSON.stringify(input.transit));
    assert.equal(cli(...options).status, 1);
    writeFileSync(layer, "not json");
    assert.match(cli(...options).stderr, /Cannot read.*transit\.json/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("choose the next eligible occurrence of a stop on a looped run", () => {
  const f = fixture();
  f.pack.edges[1].to = "w";
  f.run.edges.push("a");
  f.run.length += 100;
  f.run.stops.push({ ...f.placement, s: 20 });
  const { diagnostics } = auditTransitLayers(f.pack, f);
  assert.equal(diagnostics.length, 0);
});

test("ignore absent layers and report malformed transit and rail arrays independently", () => {
  const f = fixture();
  const noLayers = auditTransitLayers(f.pack);
  assert.equal(Object.keys(noLayers.totals).length, 0);
  assert.equal(noLayers.diagnostics.length, 0);
  f.transit.routes = null;
  f.rail.tracks = null;
  const { diagnostics } = auditTransitLayers(f.pack, f);
  assert.equal(
    diagnostics.some((d) => d.path === "transit.routes"),
    true,
  );
  assert.equal(
    diagnostics.some((d) => d.path === "rail.tracks"),
    true,
  );
});

test("inspect the rail layer of a standalone pack without transit", () => {
  const dir = mkdtempSync(join(tmpdir(), "jev-rail-layer-"));
  try {
    const f = fixture();
    const pack = join(dir, "pack.json");
    const track = join(dir, "rail.json");
    writeFileSync(pack, JSON.stringify(f.pack));
    writeFileSync(track, JSON.stringify(f.rail));
    const result = cli("--pack", pack, "--rail", track);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /1 tracks, 0.10 km, 1 stations, 1 crossings across 1 street approaches/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
