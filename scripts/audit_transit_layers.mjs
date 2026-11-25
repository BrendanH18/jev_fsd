// Inspect transit and rail data offline, using the same street packs as the arena.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { auditTransitLayers } from "../static/js/sim/transit-validation.js";
import { commaList, parseOptions, readJson } from "./cli_tools.mjs";
import { names } from "./drive_lab_maps.mjs";

const bundledMaps = { ...names, quebec_city: "8e99888cb743" };

const USAGE = `Usage: node --experimental-default-type=module scripts/audit_transit_layers.mjs [options]
  --map ID[,ID...]   select bundled maps (default: all)
  --pack PATH       inspect a custom street pack with the listed layers
  --transit PATH    supply a transit layer for the custom pack
  --rail PATH       supply a rail layer for the custom pack
  --json            print structured results to stdout
  --strict          fail on warnings as well as errors
  -h, --help        show this help`;

function bundled(map) {
  if (!Object.hasOwn(bundledMaps, map))
    throw new Error(`Unknown map "${map}". Choose ${Object.keys(bundledMaps).join(", ")}.`);
  const path = (suffix) => fileURLToPath(new URL(`../data/maps/${bundledMaps[map]}.${suffix}.json`, import.meta.url));
  const optional = (suffix) => (existsSync(path(suffix)) ? readJson(path(suffix)) : undefined);
  return auditTransitLayers(readJson(path("v6.pack")), {
    transit: optional("transit.v1"),
    rail: optional("rail.v1"),
  });
}

function printReport(reports) {
  for (const { map, diagnostics, totals } of reports) {
    console.log(map);
    if (totals?.transit) {
      const { routes, runs, stops, placements, busKm, streetcarKm } = totals.transit;
      console.log(`  Transit: ${routes} routes, ${runs} runs, ${stops} signs, ${placements} placements`);
      console.log(`  Run distance: ${busKm.toFixed(2)} km bus, ${streetcarKm.toFixed(2)} km streetcar`);
    }
    if (totals?.rail) {
      const { tracks, stations, crossings, crossingEdges, trackKm } = totals.rail;
      console.log(
        `  Rail: ${tracks} tracks, ${trackKm.toFixed(2)} km, ${stations} stations, ${crossings} crossings across ${crossingEdges} street approaches`,
      );
    }
    if (totals && Object.keys(totals).length === 0) console.log("  No transit or rail layer.");
    for (const { severity, code, path, message } of diagnostics)
      console.log(`  ${severity} [${code}] ${path}: ${message}`);
  }
}

function main(argv) {
  const { help, args } = parseOptions(argv, ["map", "pack", "transit", "rail"], ["json", "strict"]);
  if (help) {
    console.log(USAGE);
    return 0;
  }
  if (args.map && args.pack) throw new Error("Choose either bundled maps or a custom street pack.");
  if (!args.pack && (args.transit || args.rail)) throw new Error("--transit and --rail require --pack.");
  if (args.pack && !args.transit && !args.rail) throw new Error("--pack requires at least one layer to inspect.");
  const reports = args.pack
    ? [
        {
          map: args.pack,
          ...auditTransitLayers(readJson(args.pack), {
            transit: args.transit ? readJson(args.transit) : undefined,
            rail: args.rail ? readJson(args.rail) : undefined,
          }),
        },
      ]
    : (commaList("map", args.map) ?? Object.keys(bundledMaps)).map((map) => ({ map, ...bundled(map) }));
  if (args.json) console.log(JSON.stringify(reports, null, 2));
  else printReport(reports);
  return reports.some((r) => r.diagnostics.some((d) => d.severity === "error" || args.strict)) ? 1 : 0;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 2;
}
