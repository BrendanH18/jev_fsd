// Which scripts/test_*.mjs each parallel CI job runs (.github/workflows/demo.yml, ROADMAP 3.7).
// Every file goes to exactly one shard. Files are dealt out longest first, each to the shard with the
// least run time so far, using the seconds measured in scripts/ci_test_times.json; a file not in it
// counts as the median. The plan depends only on the file names and that table, so every job works
// out the same one. scripts/test_ci_shard.mjs checks it against the workflow.
//
// node scripts/ci_shard.mjs --shards 6 --shard 2   the files of shard 2, one per line
// node scripts/ci_shard.mjs --shards 6 --plan      every shard with its files and estimated time
import { readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isMain, parseOptions, readJson, wholeNumber } from "./cli_tools.mjs";

const USAGE = `Usage: node scripts/ci_shard.mjs --shards N (--shard I | --plan | --file NAME | --audit | --matrix | --timings)
  --json              emit structured JSON for the requested view
  --times FILE        plan with another timing table
  --from-run FILE     overlay timings from passing checks in a Node report
  --timings           print the current timing table as reusable JSON
  --require-measured  fail if any discovered test is outside the timing table
  --directory DIR     discover checks in another directory
  --fallback S        use this estimate for unmeasured checks
  --require-current   fail if the timing table lists removed tests
  --require-nonempty  fail if any shard receives no checks
  --max-seconds S     fail if any estimated shard exceeds this budget
  --dispatch-order    list checks longest first within each shard
  --help, -h          show this help`;

const SCRIPTS = fileURLToPath(new URL(".", import.meta.url));

export function testFiles(dir = SCRIPTS) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => (entry.isFile() || entry.isSymbolicLink()) && /^test_[^\r\n]*\.mjs$/.test(entry.name))
    .filter((entry) => entry.isFile() || statSync(join(dir, entry.name), { throwIfNoEntry: false })?.isFile())
    .map((entry) => entry.name)
    .sort();
}

export function measuredTimes(path = `${SCRIPTS}ci_test_times.json`) {
  const times = readJson(path)?.seconds;
  if (!times || Array.isArray(times) || typeof times !== "object")
    throw new Error(`${path}: expected a seconds object.`);
  for (const [name, seconds] of Object.entries(times)) {
    if (!/^test_[^/\\\r\n]*\.mjs$/.test(name)) throw new Error(`${path}: invalid check name ${JSON.stringify(name)}.`);
    if (!Number.isFinite(seconds) || seconds < 0) throw new Error(`${path}: invalid time for ${name}.`);
  }
  return times;
}

function overlayRun(times, file, discovered) {
  const report = readJson(file, { maxBytes: 128 * 1024 ** 2 });
  if (!Array.isArray(report?.checks)) throw new Error(`${file}: expected a Node check report.`);
  const observed = new Set();
  for (const check of report.checks) {
    if (typeof check?.file !== "string" || typeof check.ok !== "boolean")
      throw new Error(`${file}: a check is missing its file or pass status.`);
    if (!check.ok) continue;
    const name = basename(check.file);
    if (!discovered.has(name)) continue;
    if (observed.has(name)) throw new Error(`${file}: more than one passing result for ${name}.`);
    if (!Number.isFinite(check.seconds) || check.seconds < 0)
      throw new Error(`${file}: invalid passed duration for ${name}.`);
    observed.add(name);
    times[name] = check.seconds;
  }
}

// The measured seconds of each file, the median for one not in `times`.
function measured(times, file) {
  return Object.hasOwn(times, file) && Number.isFinite(times[file]) && times[file] >= 0;
}

function medianEstimate(files, times) {
  const known = files
    .filter((f) => measured(times, f))
    .map((f) => times[f])
    .sort((a, b) => a - b);
  return known.length ? known[known.length >> 1] : 1;
}

export function costs(files, times, fallback = medianEstimate(files, times)) {
  return (f) => (measured(times, f) ? times[f] : fallback);
}

// The files longest first, ties by name.
function longestFirst(files, cost) {
  return [...files].sort((a, b) => cost(b) - cost(a) || (a < b ? -1 : a > b ? 1 : 0));
}

// [{ files, seconds }] for `count` shards; files are bare names (test_x.mjs).
export function plan(files, times, count, { fallback, dispatchOrder = false } = {}) {
  wholeNumber("shards", count, undefined, { min: 1, max: 10_000 });
  if (new Set(files).size !== files.length) throw new Error("Each check may appear only once in a shard plan.");
  if (fallback !== undefined && (!Number.isFinite(fallback) || fallback < 0))
    throw new Error("The fallback estimate must be finite and non-negative.");
  const cost = costs(files, times, fallback);
  const shards = Array.from({ length: count }, () => ({ files: [], seconds: 0 }));
  for (const f of longestFirst(files, cost)) {
    let best = 0;
    for (let i = 1; i < count; i++) {
      if (
        shards[i].seconds < shards[best].seconds ||
        (shards[i].seconds === shards[best].seconds && shards[i].files.length < shards[best].files.length)
      )
        best = i;
    }
    shards[best].files.push(f);
    shards[best].seconds += cost(f);
    if (!Number.isFinite(shards[best].seconds)) throw new Error(`Estimated time overflowed on shard ${best}.`);
  }
  if (!dispatchOrder) for (const s of shards) s.files.sort();
  return shards;
}

function main(argv) {
  const { help, args } = parseOptions(
    argv,
    ["shards", "shard", "times", "file", "directory", "fallback", "max-seconds", "from-run"],
    [
      "plan",
      "json",
      "require-measured",
      "require-current",
      "require-nonempty",
      "dispatch-order",
      "audit",
      "matrix",
      "timings",
    ],
  );
  if (help) {
    console.log(USAGE);
    return;
  }
  const count = wholeNumber("shards", args.shards, undefined, { min: 1, max: 10_000 });
  const views = ["plan", "shard", "file", "audit", "matrix", "timings"];
  if (views.filter((name) => args[name] !== undefined).length !== 1)
    throw new Error("Choose one of --plan, --shard, --file, --audit, --matrix and --timings.");
  const files = testFiles(args.directory);
  const times = measuredTimes(args.times);
  const discovered = new Set(files);
  if (args["from-run"]) overlayRun(times, args["from-run"], discovered);
  const missing = files.filter((file) => !measured(times, file));
  const stale = Object.keys(times)
    .filter((file) => !discovered.has(file))
    .sort();
  if (args["require-measured"] && missing.length) throw new Error(`Missing measured times: ${missing.join(", ")}`);
  if (args["require-current"] && stale.length) throw new Error(`Stale measured times: ${stale.join(", ")}`);
  const fallback = args.fallback === undefined ? medianEstimate(files, times) : wholeNumber("fallback", args.fallback);
  const shards = plan(files, times, count, { fallback, dispatchOrder: args["dispatch-order"] });
  const empty = shards.flatMap((shard, index) => (shard.files.length ? [] : [index]));
  if (args["require-nonempty"] && empty.length) throw new Error(`Empty shards: ${empty.join(", ")}`);
  const maxSeconds = wholeNumber("max-seconds", args["max-seconds"], Number.MAX_SAFE_INTEGER);
  const over = shards.flatMap((shard, index) => (shard.seconds > maxSeconds ? [`${index} (${shard.seconds} s)`] : []));
  if (args["max-seconds"] !== undefined && over.length)
    throw new Error(`Shards exceeding ${maxSeconds} s: ${over.join(", ")}`);
  if (args.timings) {
    console.log(
      JSON.stringify(
        {
          seconds: Object.fromEntries(
            Object.keys(times)
              .sort()
              .map((file) => [file, times[file]]),
          ),
        },
        null,
        2,
      ),
    );
    return;
  }
  if (args.matrix) {
    console.log(JSON.stringify({ shard: shards.map((_, index) => index) }));
    return;
  }
  if (args.audit) {
    const loads = shards.map(({ seconds }) => seconds);
    const totalSeconds = loads.reduce((sum, seconds) => sum + seconds, 0);
    if (!Number.isFinite(totalSeconds)) throw new Error("Total estimated time overflowed.");
    const audit = {
      files: files.length,
      measured: files.length - missing.length,
      missing,
      stale,
      empty_shards: empty,
      fallback_seconds: fallback,
      total_seconds: totalSeconds,
      mean_seconds: totalSeconds / count,
      slowest_shard: loads.indexOf(Math.max(...loads)),
      slowest_seconds: Math.max(...loads),
    };
    if (args.json) console.log(JSON.stringify(audit));
    else {
      console.log(`${audit.measured}/${audit.files} checks measured; ${fallback} s estimated per unmeasured check`);
      console.log(
        `Estimated ${totalSeconds.toFixed(1)} s of checks over ${count} shards (mean ${audit.mean_seconds.toFixed(1)} s)`,
      );
      console.log(`Slowest shard: ${audit.slowest_shard} (${audit.slowest_seconds.toFixed(1)} s)`);
      if (missing.length) console.log(`Missing measured times: ${missing.join(", ")}`);
      if (stale.length) console.log(`Stale measured times: ${stale.join(", ")}`);
      if (empty.length) console.log(`Empty shards: ${empty.join(", ")}`);
    }
    return;
  }
  if (args.plan) {
    if (args.json) console.log(JSON.stringify(shards));
    else
      shards.forEach((s, i) =>
        console.log(`shard ${i}: ${s.files.length} files, about ${Math.round(s.seconds)} s\n  ${s.files.join("\n  ")}`),
      );
    return;
  }
  if (args.file) {
    const file = basename(args.file);
    const index = shards.findIndex((shard) => shard.files.includes(file));
    if (index === -1) throw new Error(`No discovered check named ${args.file}.`);
    console.log(args.json ? JSON.stringify({ shard: index, file }) : index);
    return;
  }
  const index = wholeNumber("shard", args.shard, undefined, { min: 0, max: count - 1 });
  if (args.json) console.log(JSON.stringify({ shard: index, ...shards[index] }));
  else for (const f of shards[index].files) console.log(args.directory ? join(args.directory, f) : `scripts/${f}`);
}

if (isMain(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
}
