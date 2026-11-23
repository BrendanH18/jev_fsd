// Compare a trusted local driver with the built-in drivers and published model results.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { driverDisplayName } from "../static/js/lab/results.js";

const usage = `Usage: node --experimental-default-type=module scripts/check_driver.mjs --agent path [--set challenges|road-tests|all] [--only id,id] [--port 8331]`;
const { values } = parseArgs({
  options: {
    agent: { type: "string" },
    set: { type: "string", default: "challenges" },
    only: { type: "string" },
    port: { type: "string" },
    help: { type: "boolean" },
  },
});
if (values.help) {
  console.log(usage);
  process.exit(0);
}
if (!values.agent) {
  console.error(usage);
  process.exit(1);
}

const arena = fileURLToPath(new URL("./arena_node.mjs", import.meta.url));
const leaderboard = JSON.parse(readFileSync(new URL("../data/results.json", import.meta.url), "utf8"));
const outputDir = mkdtempSync(join(tmpdir(), "jev-driver-"));
const output = join(outputDir, "result.json");
const arenaArgs = ["--experimental-default-type=module", arena, "--set", values.set, "--json", output];
if (values.port) arenaArgs.push("--port", values.port);
if (values.only) arenaArgs.push("--only", values.only);

function evaluate(track, label, ...options) {
  console.error(`Running ${label} on the ${track} track`);
  rmSync(output, { force: true });
  execFileSync(process.execPath, [...arenaArgs, "--track", track, ...options], {
    stdio: ["ignore", "ignore", "inherit"],
  });
  const { summary, results } = JSON.parse(readFileSync(output, "utf8"));
  return { summary, drives: new Map(results.map((drive) => [`${drive.map}/${drive.challenge}`, drive])) };
}

function publishedDrives(track, selected) {
  const rows = leaderboard.rows.filter((r) => r.recording && !r.map && r.track === track);
  const drivers = new Map();
  rows.sort((a, b) => b.date.localeCompare(a.date));
  for (const row of rows) {
    if (!drivers.has(row.driver)) drivers.set(row.driver, new Map());
    const drives = drivers.get(row.driver);
    for (const drive of row.drives) {
      const key = `${drive.map}/${drive.id}`;
      if (selected.has(key) && !drives.has(key)) drives.set(key, { ...drive, date: row.date });
    }
  }
  return drivers;
}

function verdict(drive) {
  if (!drive) return "—";
  return `${drive.pass ? "PASS" : "FAIL"}${Number.isFinite(drive.time_s) ? ` ${drive.time_s}s` : ""}${drive.date ? ` (${drive.date})` : ""}`;
}

try {
  for (const track of ["guarded", "open"]) {
    const custom = evaluate(track, "your driver", "--agent", values.agent);
    const rules = evaluate(track, "Rules", "--brain", "rules");
    const cautious = evaluate(track, "Cautious", "--brain", "cautious");
    const published = publishedDrives(track, custom.drives);
    console.log(`\n${track} track`);
    console.log(
      [custom, rules, cautious]
        .map(({ summary }) => `${summary.brain} ${summary.passed}/${summary.drives}`)
        .join(" | "),
    );
    console.table(
      Object.fromEntries(
        [...custom.drives].map(([key, drive]) => [
          drive.challenge,
          {
            Map: drive.map,
            "Your driver": verdict(drive),
            Rules: verdict(rules.drives.get(key)),
            Cautious: verdict(cautious.drives.get(key)),
            ...Object.fromEntries(
              [...published]
                .filter(([, drives]) => drives.size)
                .map(([driver, drives]) => [driverDisplayName(leaderboard, driver), verdict(drives.get(key))]),
            ),
          },
        ]),
      ),
    );
  }
} catch (error) {
  console.error(`Driver check could not finish: ${error.message}`);
  process.exitCode = 1;
} finally {
  rmSync(outputDir, { recursive: true, force: true });
}
