// Compare a trusted local driver with the built-in drivers and published model results.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { driverScores, driveScores } from "../static/js/bench/scores.js";
import { driverDisplayName } from "../static/js/lab/results.js";
import { loopbackPort } from "./cli_tools.mjs";

const usage = [
  "Usage: node --experimental-default-type=module scripts/check_driver.mjs --agent path [options]",
  "  --agent <path>             local driver module path (required)",
  "  --set <name>               challenges (default), road-tests, or all",
  "  --only <id,id>             run only these drive ids",
  "  --track <guarded|open|all> track(s) to evaluate (default: all)",
  "  --no-baselines             skip running Rules and Cautious baselines",
  "  --json                     print machine-readable JSON output",
  "  --check                    exit with status 1 if any drive of your driver fails",
  "  --port <port>              local server port (default: 8331)",
  "  --help, -h                 show this help",
].join("\n");

let values;
try {
  ({ values } = parseArgs({
    options: {
      agent: { type: "string" },
      set: { type: "string", default: "challenges" },
      only: { type: "string" },
      port: { type: "string" },
      track: { type: "string", default: "all" },
      "no-baselines": { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      check: { type: "boolean", default: false },
      help: { type: "boolean", short: "h" },
    },
  }));
} catch (error) {
  console.error(`${error.message}\n${usage}`);
  process.exit(1);
}

if (values.help) {
  console.log(usage);
  process.exit(0);
}
if (!values.agent) {
  console.error(usage);
  process.exit(1);
}
if (!["guarded", "open", "all"].includes(values.track)) {
  console.error(`Unknown --track "${values.track}": use guarded, open, or all.`);
  process.exit(1);
}

const tracks = values.track === "all" ? ["guarded", "open"] : [values.track];
let port;
try {
  port = loopbackPort(values.port ?? process.env.PORT ?? "8331");
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
const arena = fileURLToPath(new URL("./arena_node.mjs", import.meta.url));
const leaderboard = JSON.parse(readFileSync(new URL("../data/results.json", import.meta.url), "utf8"));
const outputDir = mkdtempSync(join(tmpdir(), "jev-driver-"));
const output = join(outputDir, "result.json");
const arenaArgs = ["--experimental-default-type=module", arena, "--set", values.set, "--json", output, "--port", port];
if (values.only) arenaArgs.push("--only", values.only);

function evaluate(track, label, ...options) {
  console.error(`Running ${label} on the ${track} track`);
  rmSync(output, { force: true });
  execFileSync(process.execPath, [...arenaArgs, "--track", track, ...options], {
    stdio: ["ignore", values.json ? "ignore" : "inherit", "inherit"],
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

function failureDetails(drive) {
  const details = [];
  if (drive.failures?.length) details.push(drive.failures.join(", "));
  if (drive.simulation_error) details.push(`error: ${drive.simulation_error}`);
  return details.join("; ");
}

function verdict(drive) {
  if (!drive) return "—";
  const base = `${drive.pass ? "PASS" : "FAIL"}${Number.isFinite(drive.time_s) ? ` ${drive.time_s}s` : ""}${drive.date ? ` (${drive.date})` : ""}`;
  if (drive.pass) return base;
  const details = failureDetails(drive);
  return details ? `${base} [${details}]` : base;
}

try {
  let anyFailed = false;
  const jsonTracks = {};
  for (const track of tracks) {
    const custom = evaluate(track, "your driver", "--agent", values.agent);
    const rules = values["no-baselines"] ? null : evaluate(track, "Rules", "--brain", "rules");
    const cautious = values["no-baselines"] ? null : evaluate(track, "Cautious", "--brain", "cautious");
    const published = publishedDrives(track, custom.drives);
    const customList = [...custom.drives.values()];
    const customScores = driverScores(customList);
    if (customList.some((drive) => !drive.pass)) anyFailed = true;

    if (values.json) {
      jsonTracks[track] = {
        summary: custom.summary,
        scores: customScores,
        baselines: values["no-baselines"]
          ? null
          : {
              rules: { summary: rules.summary, scores: driverScores([...rules.drives.values()]) },
              cautious: { summary: cautious.summary, scores: driverScores([...cautious.drives.values()]) },
            },
        drives: [...custom.drives].map(([key, drive]) => {
          const scores = driveScores(drive);
          return {
            id: drive.challenge,
            map: drive.map,
            pass: drive.pass,
            time_s: drive.time_s ?? null,
            failures: drive.failures ?? [],
            ...(drive.simulation_error ? { simulation_error: drive.simulation_error } : {}),
            scores: {
              score: scores.score,
              comfort: scores.comfort,
              margin: scores.margin,
              pace: scores.pace,
              progress: scores.progress,
            },
            ...(rules ? { rules: rules.drives.get(key) ?? null } : {}),
            ...(cautious ? { cautious: cautious.drives.get(key) ?? null } : {}),
            published: Object.fromEntries(
              [...published]
                .filter(([, drives]) => drives.size && drives.has(key))
                .map(([driver, drives]) => [driver, drives.get(key)]),
            ),
          };
        }),
      };
      continue;
    }

    console.log(`\n${track} track`);
    const summaryParts = [custom, rules, cautious].filter(Boolean).map(({ summary, drives }) => {
      const s = driverScores([...drives.values()]);
      return `${summary.brain} ${summary.passed}/${summary.drives} (score=${s.score ?? "-"} comfort=${s.comfort ?? "-"} margin=${s.margin ?? "-"})`;
    });
    console.log(summaryParts.join(" | "));
    console.table(
      Object.fromEntries(
        [...custom.drives].map(([key, drive]) => {
          const scores = driveScores(drive);
          return [
            drive.challenge,
            {
              Map: drive.map,
              "Your driver": verdict(drive),
              Score: scores.score,
              Comfort: scores.comfort,
              Margin: scores.margin,
              ...(rules ? { Rules: verdict(rules.drives.get(key)) } : {}),
              ...(cautious ? { Cautious: verdict(cautious.drives.get(key)) } : {}),
              ...Object.fromEntries(
                [...published]
                  .filter(([, drives]) => drives.size)
                  .map(([driver, drives]) => [driverDisplayName(leaderboard, driver), verdict(drives.get(key))]),
              ),
            },
          ];
        }),
      ),
    );
    const failedDrives = customList.filter((drive) => !drive.pass);
    for (const drive of failedDrives) {
      const details = failureDetails(drive);
      console.log(`  FAIL ${drive.challenge} (${drive.map})${details ? ` — ${details}` : ""}`);
    }
  }
  if (values.json) {
    console.log(JSON.stringify({ agent: values.agent, set: values.set, tracks: jsonTracks }, null, 2));
  }
  if (values.check && anyFailed) process.exitCode = 1;
} catch (error) {
  console.error(`Driver check could not finish: ${error.message}`);
  process.exitCode = 1;
} finally {
  rmSync(outputDir, { recursive: true, force: true });
}
