// Compare a trusted local driver with the built-in drivers and published model results.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { driverScores, driveScores } from "../static/js/bench/scores.js";
import { driverDisplayName } from "../static/js/lab/results.js";
import { benchPage, commaList, loopbackPort, wholeNumber } from "./cli_tools.mjs";
import { checkedLocalDefinition } from "./local_recording.mjs";
import { scaffoldDriver } from "./driver_scaffold.mjs";
import { readArtifactJson, writeNewJson } from "./recording_artifacts.mjs";
import { publishedDrives } from "./driver_comparison.mjs";

const usage = [
  "Usage: node --experimental-default-type=module scripts/check_driver.mjs --agent path [options]",
  "       check_driver.mjs --scaffold FILE.mjs [--id ID] [--label LABEL]",
  "       check_driver.mjs --agent FILE.mjs --validate",
  "  --agent <path>             local driver module path (required)",
  "  --set <name>               challenges (default), road-tests, or all",
  "  --only <id,id>             run only these drive ids",
  "  --track <guarded|open|all> track(s) to evaluate (default: all)",
  "  --no-baselines             skip running Rules and Cautious baselines",
  "  --no-published             skip published model comparisons",
  "  --json                     print machine-readable JSON output",
  "  --check                    exit with status 1 if any drive of your driver fails",
  "  --port <port>              local server port (default: 8331)",
  "  --out <file[.gz]>          write the comparison JSON to a new file",
  "  --timeout <ms>             maximum time for each Arena invocation",
  "  --published <file[.gz]>    read a different saved leaderboard",
  "  --expect-drives <N>        require exactly N matches per track or baseline",
  "  --help, -h                 show this help",
].join("\n");

let values, explicit;
try {
  const parsed = parseArgs({
    tokens: true,
    options: {
      agent: { type: "string" },
      scaffold: { type: "string" },
      id: { type: "string" },
      label: { type: "string" },
      validate: { type: "boolean" },
      out: { type: "string" },
      published: { type: "string" },
      timeout: { type: "string" },
      "expect-drives": { type: "string" },
      set: { type: "string", default: "challenges" },
      only: { type: "string" },
      port: { type: "string" },
      track: { type: "string", default: "all" },
      "no-baselines": { type: "boolean", default: false },
      "no-published": { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      check: { type: "boolean", default: false },
      help: { type: "boolean", short: "h" },
    },
  });
  ({ values } = parsed);
  explicit = new Set();
  for (const token of parsed.tokens) {
    if (token.kind !== "option") continue;
    if (explicit.has(token.name)) throw new Error(`Specify --${token.name} only once.`);
    explicit.add(token.name);
  }
} catch (error) {
  console.error(`${error.message}\n${usage}`);
  process.exit(1);
}

if (values.help) {
  console.log(usage);
  process.exit(0);
}
if (values.scaffold !== undefined || values.validate) {
  try {
    if (values.scaffold !== undefined) {
      if ([...explicit].some((name) => !["scaffold", "id", "label"].includes(name)))
        throw new Error("--scaffold uses only --id and --label.");
      scaffoldDriver(values.scaffold, values.id, values.label);
      console.log(`Created ${values.scaffold}`);
    } else {
      if (!values.agent || [...explicit].some((name) => !["agent", "validate"].includes(name)))
        throw new Error("--validate requires only --agent.");
      const { default: definition } = await import(pathToFileURL(values.agent).href);
      const checked = checkedLocalDefinition(definition);
      const first = checked.create();
      const second = checked.create();
      if (first === second) throw new Error("create() must return a fresh driver instance.");
      console.log(JSON.stringify({
        id: checked.id, label: checked.label,
        questionDriven: first.questionDriven ?? false, timeoutMs: first.timeoutMs ?? null,
      }));
    }
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
  process.exit(0);
}
if (values.id !== undefined || values.label !== undefined) {
  console.error("--id and --label require --scaffold.");
  process.exit(1);
}
if (!values.agent?.trim()) {
  console.error("--agent must name a local module. Use --help for usage.");
  process.exit(1);
}
if (!["guarded", "open", "all"].includes(values.track)) {
  console.error(`Unknown --track "${values.track}": use guarded, open, or all.`);
  process.exit(1);
}
if (!["challenges", "road-tests", "all"].includes(values.set)) {
  console.error(`Unknown --set "${values.set}": use challenges, road-tests, or all.`);
  process.exit(1);
}

const tracks = values.track === "all" ? ["guarded", "open"] : [values.track];
let port, timeout;
try {
  port = loopbackPort(values.port ?? process.env.PORT ?? "8331");
  commaList("only", values.only);
  if (values["expect-drives"] !== undefined)
    wholeNumber("expect-drives", values["expect-drives"], undefined, { min: 1 });
  if (values.timeout !== undefined)
    timeout = wholeNumber("timeout", values.timeout, undefined, { min: 1, max: 2 ** 31 - 1 });
  if (values.out !== undefined && !/\.json(?:\.gz)?$/.test(values.out))
    throw new Error("--out must end in .json or .json.gz.");
  if (values.published !== undefined && values["no-published"])
    throw new Error("--published cannot be used with --no-published.");
  await benchPage(port);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
const arena = fileURLToPath(new URL("./arena_node.mjs", import.meta.url));
const outputDir = mkdtempSync(join(tmpdir(), "jev-driver-"));
const output = join(outputDir, "result.json");
const arenaArgs = ["--experimental-default-type=module", arena, "--set", values.set, "--json", output, "--port", port];
if (values.only) arenaArgs.push("--only", values.only);
if (values["expect-drives"]) arenaArgs.push("--expect-drives", values["expect-drives"]);
const machine = values.json || values.out;

function evaluate(track, label, ...options) {
  console.error(`Running ${label} on the ${track} track`);
  rmSync(output, { force: true });
  try {
    execFileSync(process.execPath, [...arenaArgs, "--track", track, ...options], {
      stdio: ["ignore", machine ? "ignore" : "inherit", "inherit"],
      timeout,
      killSignal: "SIGKILL",
    });
  } catch (error) {
    if (error.code === "ETIMEDOUT") throw new Error(`${label} on ${track} exceeded --timeout ${timeout} ms.`, { cause: error });
    throw new Error(`Arena could not evaluate ${label} on ${track}. See its diagnostic above.`, { cause: error });
  }
  const { summary, results } = JSON.parse(readFileSync(output, "utf8"));
  return { summary, drives: new Map(results.map((drive) => [`${drive.map}/${drive.challenge}`, drive])) };
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
  const leaderboard = values["no-published"]
    ? { rows: [] }
    : values.published ? readArtifactJson(values.published)
      : JSON.parse(readFileSync(new URL("../data/results.json", import.meta.url), "utf8"));
  let anyFailed = false;
  const jsonTracks = {};
  for (const track of tracks) {
    const custom = evaluate(track, "your driver", "--agent", values.agent);
    const rules = values["no-baselines"] ? null : evaluate(track, "Rules", "--brain", "rules");
    const cautious = values["no-baselines"] ? null : evaluate(track, "Cautious", "--brain", "cautious");
    const published = publishedDrives(leaderboard, track, custom.drives);
    const customList = [...custom.drives.values()];
    const customScores = driverScores(customList);
    if (customList.some((drive) => !drive.pass)) anyFailed = true;

    if (machine) {
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
            ...(drive.flagged_choices !== undefined ? { flagged_choices: drive.flagged_choices } : {}),
            ...(drive.fallbacks !== undefined ? { fallbacks: drive.fallbacks } : {}),
            ...(drive.safety_brakes !== undefined ? { safety_brakes: drive.safety_brakes } : {}),
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
  if (machine) {
    const result = { agent: values.agent, set: values.set, tracks: jsonTracks };
    if (values.out) writeNewJson(values.out, result, 2);
    if (values.json) console.log(JSON.stringify(result, null, 2));
  }
  if (values.check && anyFailed) process.exitCode = 1;
} catch (error) {
  console.error(`Driver check could not finish: ${error.message}`);
  process.exitCode = 1;
} finally {
  rmSync(outputDir, { recursive: true, force: true });
}
