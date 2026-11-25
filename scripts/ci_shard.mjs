// Which scripts/test_*.mjs each parallel CI job runs (.github/workflows/demo.yml, ROADMAP 3.7).
// Every file goes to exactly one shard. Files are dealt out longest first, each to the shard with the
// least run time so far, using the seconds measured in scripts/ci_test_times.json; a file not in it
// counts as the median. The plan depends only on the file names and that table, so every job works
// out the same one. scripts/test_ci_shard.mjs checks it against the workflow.
//
// node scripts/ci_shard.mjs --shards 6 --shard 2   the files of shard 2, one per line
// node scripts/ci_shard.mjs --shards 6 --plan      every shard with its files and estimated time
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseOptions, wholeNumber } from "./cli_tools.mjs";

const USAGE = `Usage: node scripts/ci_shard.mjs --shards N (--shard I | --plan | --file NAME)
  --json              emit structured JSON for the requested view
  --times FILE        plan with another timing table
  --require-measured  fail if any discovered test is outside the timing table
  --help, -h          show this help`;

const SCRIPTS = fileURLToPath(new URL(".", import.meta.url));

export function testFiles(dir = SCRIPTS) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => (entry.isFile() || entry.isSymbolicLink()) && /^test_.*\.mjs$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

export function measuredTimes(path = `${SCRIPTS}ci_test_times.json`) {
  const times = JSON.parse(readFileSync(path, "utf8")).seconds;
  if (!times || Array.isArray(times) || typeof times !== "object")
    throw new Error(`${path}: expected a seconds object.`);
  for (const [name, seconds] of Object.entries(times))
    if (!Number.isFinite(seconds) || seconds < 0) throw new Error(`${path}: invalid time for ${name}.`);
  return times;
}

// The measured seconds of each file, the median for one not in `times`.
export function costs(files, times) {
  const known = files
    .map((f) => times[f])
    .filter((s) => Number.isFinite(s))
    .sort((a, b) => a - b);
  const fallback = known.length ? known[known.length >> 1] : 1;
  return (f) => (Number.isFinite(times[f]) ? times[f] : fallback);
}

// The files longest first, ties by name.
function longestFirst(files, times) {
  const cost = costs(files, times);
  return [...files].sort((a, b) => cost(b) - cost(a) || (a < b ? -1 : a > b ? 1 : 0));
}

// [{ files, seconds }] for `count` shards; files are bare names (test_x.mjs).
export function plan(files, times, count) {
  const cost = costs(files, times);
  const shards = Array.from({ length: count }, () => ({ files: [], seconds: 0 }));
  for (const f of longestFirst(files, times)) {
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
  }
  for (const s of shards) s.files.sort();
  return shards;
}

function main(argv) {
  const { help, args } = parseOptions(argv, ["shards", "shard", "times", "file"], ["plan", "json", "require-measured"]);
  if (help) {
    console.log(USAGE);
    return;
  }
  const count = wholeNumber("shards", args.shards, undefined, { min: 1, max: 10_000 });
  if (["plan", "shard", "file"].filter((name) => args[name] !== undefined).length !== 1)
    throw new Error("Choose one of --plan, --shard and --file.");
  const files = testFiles();
  const times = measuredTimes(args.times);
  if (args["require-measured"]) {
    const missing = files.filter((file) => !Object.hasOwn(times, file));
    if (missing.length) throw new Error(`Missing measured times: ${missing.join(", ")}`);
  }
  const shards = plan(files, times, count);
  if (args.plan) {
    if (args.json) console.log(JSON.stringify(shards));
    else
      shards.forEach((s, i) =>
        console.log(`shard ${i}: ${s.files.length} files, about ${Math.round(s.seconds)} s\n  ${s.files.join("\n  ")}`),
      );
    return;
  }
  if (args.file) {
    const index = shards.findIndex((shard) => shard.files.includes(args.file));
    if (index === -1) throw new Error(`No discovered check named ${args.file}.`);
    console.log(args.json ? JSON.stringify({ shard: index, file: args.file }) : index);
    return;
  }
  const index = wholeNumber("shard", args.shard, undefined, { min: 0, max: count - 1 });
  if (args.json) console.log(JSON.stringify({ shard: index, ...shards[index] }));
  else for (const f of shards[index].files) console.log(`scripts/${f}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
}
