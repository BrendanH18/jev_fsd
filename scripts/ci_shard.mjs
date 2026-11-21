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

const SCRIPTS = fileURLToPath(new URL(".", import.meta.url));

export function testFiles(dir = SCRIPTS) {
  return readdirSync(dir)
    .filter((f) => /^test_.*\.mjs$/.test(f))
    .sort();
}

export function measuredTimes(path = `${SCRIPTS}ci_test_times.json`) {
  return JSON.parse(readFileSync(path, "utf8")).seconds;
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
    for (let i = 1; i < count; i++) if (shards[i].seconds < shards[best].seconds) best = i;
    shards[best].files.push(f);
    shards[best].seconds += cost(f);
  }
  for (const s of shards) s.files.sort();
  return shards;
}

function main(argv) {
  const arg = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const count = Number(arg("--shards"));
  if (!Number.isInteger(count) || count < 1) throw new Error("--shards N (a positive whole number) is required");
  const shards = plan(testFiles(), measuredTimes(), count);
  if (argv.includes("--plan")) {
    shards.forEach((s, i) =>
      console.log(`shard ${i}: ${s.files.length} files, about ${Math.round(s.seconds)} s\n  ${s.files.join("\n  ")}`),
    );
    return;
  }
  const index = Number(arg("--shard"));
  if (!Number.isInteger(index) || index < 0 || index >= count)
    throw new Error(`--shard must be a whole number from 0 to ${count - 1}`);
  for (const f of shards[index].files) console.log(`scripts/${f}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
}
