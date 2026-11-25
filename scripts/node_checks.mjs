// Run Node checks locally, in Boat and in the CI shards.
import { spawn } from "node:child_process";
import { appendFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { costs, measuredTimes, testFiles } from "./ci_shard.mjs";
import { checkFiles, isMain, readJson, wholeNumber, writeArtifact } from "./cli_tools.mjs";

const USAGE = `Usage: node scripts/node_checks.mjs [options] [FILE...]
  --jobs N         parallel workers (default: CPU count)
  --timeout S      seconds per check (default: NODE_TEST_TIMEOUT or 360)
  --kill-grace S   seconds between SIGTERM and SIGKILL on timeout (default: 10)
  --output-kib N   retain at most N KiB per check (default: 256; 0 discards output)
  --node-arg ARG   repeatable Node flag (also accepts --node-arg=ARG)
  --match TEXT     keep files whose names contain TEXT
  --exclude TEXT   omit files whose names contain TEXT
  --times FILE     use another timing table
  --order ORDER    dispatch by measured time, name or input order
  --list           print the planned files in dispatch order
  --show-output    include output from passing checks
  --fail-fast      stop starting files after the first failed check
  --rerun PATH     run failures from a saved report
  --include-skipped  also rerun queued checks skipped in that report
  --slowest N      show this many slowest checks (default: 8; 0 hides the section)
  --quiet          omit per-check success lines
  --github         emit GitHub Actions annotations for failed checks
  --summary PATH   append a Markdown run summary (for example, GITHUB_STEP_SUMMARY)
  --json PATH      write a machine-readable run report (supports .gz or - for stdout)
  --               treat following arguments as paths
  -h, --help       show this help`;

const SCRIPTS = fileURLToPath(new URL(".", import.meta.url));
const REPO = path.resolve(SCRIPTS, "..");
const MAX_TIMER_S = Math.floor((2 ** 31 - 1) / 1000);
const MAX_REPORT_BYTES = 128 * 1024 ** 2;
const switches = new Set(["list", "show-output", "fail-fast", "include-skipped", "quiet", "github"]);
const values = new Set([
  "jobs",
  "timeout",
  "kill-grace",
  "output-kib",
  "node-arg",
  "match",
  "exclude",
  "times",
  "order",
  "rerun",
  "slowest",
  "summary",
  "json",
]);

function parseArgs(argv) {
  const opts = { files: [], nodeArgs: [] };
  const seen = new Set();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") return { help: true };
    if (a === "--") {
      opts.files.push(...argv.slice(i + 1));
      break;
    }
    if (!a.startsWith("-")) {
      opts.files.push(a);
      continue;
    }
    if (!a.startsWith("--")) throw new Error(`unknown option ${a}; use -- before paths beginning with a hyphen`);
    const [name, ...parts] = a.slice(2).split("=");
    if (seen.has(name) && name !== "node-arg") throw new Error(`Specify --${name} only once.`);
    seen.add(name);
    if (switches.has(name) && !parts.length) opts[name] = true;
    else if (values.has(name)) {
      const value = parts.length ? parts.join("=") : argv[++i];
      if (
        !value ||
        (!parts.length && (value === "--" || (name !== "node-arg" && /^-{1,2}/.test(value) && value !== "-")))
      )
        throw new Error(`--${name} needs a value`);
      if (name === "node-arg") {
        if (!value.startsWith("-") || value === "-")
          throw new Error("--node-arg must be a Node flag; put flag values after '='.");
        if (/^(?:-[peci]|--(?:eval|print|check|interactive|test|run|watch)(?:=|$))/.test(value))
          throw new Error(`--node-arg ${value} changes how Node runs the check file.`);
        opts.nodeArgs.push(value);
      } else opts[name] = value;
    } else throw new Error(`unknown option ${a}`);
  }
  opts.jobs = wholeNumber("jobs", opts.jobs, os.availableParallelism(), { min: 1 });
  opts.timeout = wholeNumber("timeout", opts.timeout ?? (process.env.NODE_TEST_TIMEOUT || undefined), 360, {
    min: 1,
    max: MAX_TIMER_S,
  });
  opts.grace = wholeNumber("kill-grace", opts["kill-grace"], 10, { max: MAX_TIMER_S });
  opts.keepBytes = wholeNumber("output-kib", opts["output-kib"], 256, { max: 16384 }) * 1024;
  opts.slowest = wholeNumber("slowest", opts.slowest, 8);
  opts.order ??= "measured";
  if (!["measured", "name", "input"].includes(opts.order)) throw new Error("--order must be measured, name or input.");
  if (opts["include-skipped"] && !opts.rerun) throw new Error("--include-skipped requires --rerun.");
  if (opts.rerun && opts.files.length) throw new Error("--rerun cannot be combined with explicit check files.");
  if (opts.list && (opts.json || opts.summary)) throw new Error("--list cannot be combined with --json or --summary.");
  if (opts.json === "-" && opts.github) throw new Error("--github cannot be used with JSON on stdout.");
  return opts;
}

function reportPath(file) {
  const relative = path.relative(REPO, file);
  return relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)
    ? file
    : relative.split(path.sep).join("/");
}

function rerunPath(saved, label) {
  if (!saved || !path.isAbsolute(saved)) return path.resolve(REPO, saved ?? label);
  // Older CI reports stored the runner's absolute path alongside a repo-relative label.
  const local = path.resolve(REPO, label);
  if (
    !path.isAbsolute(label) &&
    !path.isAbsolute(reportPath(local)) &&
    !statSync(saved, { throwIfNoEntry: false }) &&
    statSync(local, { throwIfNoEntry: false })?.isFile()
  )
    return local;
  return saved;
}

function rerunFiles(file, includeSkipped) {
  const report = readJson(file, { maxBytes: MAX_REPORT_BYTES });
  const validLabel = (label) => typeof label === "string" && label.length > 0;
  const validCheck = (check) =>
    validLabel(check?.file) && typeof check.ok === "boolean" && (check.path === undefined || validLabel(check.path));
  if (
    !Array.isArray(report?.checks) ||
    !report.checks.every(validCheck) ||
    !Array.isArray(report.skipped) ||
    !report.skipped.every(validLabel) ||
    (report.skipped_paths !== undefined &&
      (!Array.isArray(report.skipped_paths) ||
        report.skipped_paths.length !== report.skipped.length ||
        !report.skipped_paths.every(validLabel)))
  )
    throw new Error(`${file}: expected a Node check report.`);
  const failed = report.checks.filter((check) => !check.ok).map((check) => rerunPath(check.path, check.file));
  if (includeSkipped)
    failed.push(...report.skipped.map((label, index) => rerunPath(report.skipped_paths?.[index], label)));
  if (!failed.length) throw new Error(`${file}: no checks to rerun.`);
  return failed;
}

// Runs one file in its own process group so the timeout and cancellation cover descendants.
function runFile(file, { timeout, grace = 10, keepBytes = 256 * 1024, nodeArgs = [] }, running) {
  return new Promise((resolve) => {
    const started = performance.now();
    const grouped = process.platform !== "win32";
    const child = spawn(process.execPath, ["--experimental-default-type=module", ...nodeArgs, file], {
      stdio: ["ignore", "pipe", "pipe"],
      detached: grouped,
    });
    const chunks = [];
    let kept = 0;
    let cut = false;
    const keep = (chunk) => {
      if (keepBytes === 0) {
        cut ||= chunk.length > 0;
        return;
      }
      chunks.push(chunk);
      kept += chunk.length;
      while (kept - chunks[0].length >= keepBytes) {
        kept -= chunks.shift().length;
        cut = true;
      }
    };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    const signalGroup = (sig) => {
      if (!child.pid) return;
      try {
        if (grouped) process.kill(-child.pid, sig);
        else child.kill(sig);
      } catch {
        // Already gone.
      }
    };
    let timedOut = false;
    let interrupted = false;
    let killer;
    const cancel = () => {
      interrupted = true;
      signalGroup("SIGKILL");
    };
    running.add(cancel);
    const timer = setTimeout(() => {
      timedOut = true;
      signalGroup(grace ? "SIGTERM" : "SIGKILL");
      if (grace) killer = setTimeout(() => signalGroup("SIGKILL"), grace * 1000);
    }, timeout * 1000);
    // A descendant can keep stdout open even after Node exits. Kill the group here so
    // close can drain the remaining bytes without waiting for the timeout.
    child.once("exit", () => {
      clearTimeout(timer);
      clearTimeout(killer);
      signalGroup("SIGKILL");
      running.delete(cancel);
    });
    let done = false;
    const finish = (code, signal, error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearTimeout(killer);
      running.delete(cancel);
      const output = Buffer.concat(chunks);
      resolve({
        file,
        ok: code === 0 && !timedOut && !interrupted && !error,
        code,
        signal,
        timedOut,
        interrupted,
        error,
        seconds: (performance.now() - started) / 1000,
        output: output.subarray(Math.max(0, output.length - keepBytes)),
        cut: cut || kept > keepBytes,
      });
    };
    child.once("error", (error) => finish(null, null, error));
    child.once("close", (code, signal) => finish(code, signal, null));
  });
}

function verdict(r, timeoutS) {
  if (r.ok) return "ok";
  if (r.error) return `could not start: ${r.error.message}`;
  if (r.timedOut) return `timed out after ${timeoutS} s`;
  if (r.interrupted) return "interrupted";
  if (r.signal === "SIGKILL") return "was killed (out of memory?)";
  if (r.signal) return `ended by ${r.signal}`;
  return `failed with exit code ${r.code}`;
}

function byLabel(a, b) {
  return a.label < b.label ? -1 : a.label > b.label ? 1 : 0;
}

function queueChecks({ files = [], match, exclude, rerun, order = "measured", times, ...opts }) {
  const requested = rerun ? rerunFiles(rerun, opts["include-skipped"]) : files;
  const checks = requested.length
    ? [...new Map(requested.map((f) => [path.resolve(f), f])).entries()].map(([file, label]) => ({ file, label }))
    : testFiles().map((f) => ({ file: path.join(SCRIPTS, f), label: `scripts/${f}` }));
  const selected = checks.filter(({ file }) => {
    const name = path.basename(file);
    return (!match || name.includes(match)) && (!exclude || !name.includes(exclude));
  });
  if (!selected.length) throw new Error("No Node checks match the selection.");
  for (const { file, label } of selected)
    if (!statSync(file, { throwIfNoEntry: false })?.isFile()) throw new Error(`No such check file: ${label}`);
  if (order === "input") return selected;
  if (order === "name") return selected.sort(byLabel);
  const cost = costs(
    selected.map((c) => path.basename(c.file)),
    measuredTimes(times),
  );
  return selected.sort((a, b) => cost(path.basename(b.file)) - cost(path.basename(a.file)) || byLabel(a, b));
}

function safeLog(value) {
  // Actions interprets workflow commands anywhere on a line, including a child test's output.
  return value.replaceAll("::", ": :").replaceAll("##[", "# #[");
}

function workflowEscape(value, property = false) {
  const message = String(value).replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
  return property ? message.replaceAll(":", "%3A").replaceAll(",", "%2C") : message;
}

export async function runChecks(opts, log = console.log, selected = queueChecks(opts)) {
  const jobs = wholeNumber("jobs", opts.jobs, os.availableParallelism(), { min: 1 });
  const timeout = wholeNumber("timeout", opts.timeout, 360, { min: 1, max: MAX_TIMER_S });
  const queue = [...selected];
  const total = queue.length;
  const parallel = Math.min(jobs, total);
  const running = new Set();
  const cancelRunning = () => {
    for (const cancel of running) cancel();
  };
  opts.signal?.addEventListener("abort", cancelRunning, { once: true });
  const results = [];
  let halt = false;
  let lowestFree = os.freemem();
  const sampler = setInterval(() => {
    lowestFree = Math.min(lowestFree, os.freemem());
  }, 500);
  sampler.unref();
  const started = performance.now();
  log(`node-checks: ${total} files, ${parallel} at a time, ${timeout} s each`);
  const worker = async () => {
    while (queue.length && !halt && !opts.signal?.aborted) {
      const { file, label } = queue.shift();
      const r = await runFile(file, { ...opts, timeout }, running);
      r.label = label;
      results.push(r);
      const line = `${r.ok ? "ok  " : "FAIL"} ${r.seconds.toFixed(1).padStart(6)} s  ${label}`;
      if (!r.ok || !opts.quiet) log(r.ok ? line : `${line}: ${verdict(r, timeout)}`);
      if (!r.ok && opts["fail-fast"]) halt = true;
      if (!r.ok || opts["show-output"]) {
        const size = (opts.keepBytes ?? 256 * 1024) / 1024;
        log(`---- output of ${label}${r.cut ? ` (its last ${size} KiB)` : ""}`);
        log(r.output.toString("utf8").trimEnd());
        log(`---- end of ${label}`);
      }
    }
  };
  try {
    await Promise.all(Array.from({ length: parallel }, worker));
  } finally {
    clearInterval(sampler);
    opts.signal?.removeEventListener("abort", cancelRunning);
  }
  const wall = (performance.now() - started) / 1000;
  const busy = results.reduce((s, r) => s + r.seconds, 0);
  const failed = results.filter((r) => !r.ok).sort(byLabel);
  const skipped = queue.map(({ label }) => label);
  if (skipped.length)
    log(`node-checks: ${skipped.length} skipped after ${opts.signal?.aborted ? "an interrupt" : "a failed check"}`);
  log(
    `node-checks: ${results.length - failed.length} of ${total} passed in ${wall.toFixed(0)} s ` +
      `(${busy.toFixed(0)} s of checks, ${parallel} at a time; lowest free memory ${(lowestFree / 2 ** 30).toFixed(1)} GiB)`,
  );
  if (opts.slowest !== 0) {
    log("node-checks: slowest:");
    for (const r of [...results].sort((a, b) => b.seconds - a.seconds || byLabel(a, b)).slice(0, opts.slowest ?? 8))
      log(`  ${r.seconds.toFixed(1).padStart(6)} s  ${r.label}`);
  }
  if (failed.length) {
    log("node-checks: failed:");
    for (const r of failed) log(`  ${r.label}: ${verdict(r, timeout)}`);
  }
  return { results, failed, skipped, skippedPaths: queue.map(({ file }) => file), wall, busy, parallel, lowestFree };
}

function report({ results, skipped, skippedPaths, wall, busy, parallel, lowestFree }, opts) {
  const checks = [...results].sort(byLabel).map((r) => ({
    file: path.isAbsolute(r.label) ? reportPath(r.file) : r.label,
    path: reportPath(r.file),
    ok: r.ok,
    seconds: r.seconds,
    code: r.code,
    signal: r.signal,
    timed_out: r.timedOut,
    interrupted: r.interrupted,
    ...(!r.ok || opts["show-output"] ? { output: r.output.toString("utf8"), truncated: r.cut } : {}),
    ...(!r.ok ? { reason: verdict(r, opts.timeout) } : {}),
  }));
  return {
    wall_s: wall,
    busy_s: busy,
    workers: parallel,
    lowest_free_bytes: lowestFree,
    timeout_s: opts.timeout,
    checks,
    skipped: skipped.map((label) => (path.isAbsolute(label) ? reportPath(label) : label)),
    skipped_paths: skippedPaths.map(reportPath),
  };
}

function appendSummary(file, { results, failed, skipped, wall }, timeout) {
  const markdown = (value) =>
    String(value)
      .replace(/[\r\n]+/g, " ")
      .replace(
        /[<>&]/g,
        (c) =>
          ({
            "<": "&lt;",
            ">": "&gt;",
            "&": "&amp;",
          })[c],
      )
      .replace(/[^\w\s./&;-]/g, (c) => `\\${c}`);
  const lines = [
    "## Node checks",
    "",
    `${results.length - failed.length} passed, ${failed.length} failed, ${skipped.length} skipped in ${wall.toFixed(1)} s.`,
    "",
    ...failed.slice(0, 50).map((r) => `- ${markdown(r.label)} — ${markdown(verdict(r, timeout))}`),
  ];
  if (failed.length > 50) lines.push(`- ${failed.length - 50} more failures are listed in the job log.`);
  appendFileSync(file, `${lines.join("\n")}\n\n`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(USAGE);
    return;
  }
  const selected = queueChecks(opts);
  if (opts.list) {
    for (const { label } of selected) console.log(label);
    return;
  }
  const outputs = { json: opts.json === "-" ? undefined : opts.json, summary: opts.summary };
  if (outputs.json || outputs.summary) {
    checkFiles({}, outputs);
    const inputs = opts.rerun
      ? selected.map(({ file }) => file)
      : opts.files.length
        ? opts.files
        : testFiles().map((file) => path.join(SCRIPTS, file));
    for (const file of inputs) checkFiles({ check: file }, outputs);
    checkFiles({ rerun: opts.rerun }, outputs);
    checkFiles({ times: opts.times ?? path.join(SCRIPTS, "ci_test_times.json") }, outputs);
  }
  const cancellation = new AbortController();
  const onSignal = (signal) => {
    if (cancellation.signal.aborted) process.exit(cancellation.signal.reason);
    cancellation.abort(signal === "SIGINT" ? 130 : 143);
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  opts.signal = cancellation.signal;
  const log = opts.json === "-" ? console.error : opts.github ? (line) => console.log(safeLog(line)) : console.log;
  try {
    const run = await runChecks(opts, log, selected);
    if (opts.github) {
      for (const r of run.failed) {
        const file = workflowEscape(path.relative(process.cwd(), r.file), true);
        console.log(`::error file=${file}::${workflowEscape(`${r.label}: ${verdict(r, opts.timeout)}`)}`);
      }
    }
    if (opts.summary) appendSummary(opts.summary, run, opts.timeout);
    if (opts.json) {
      const json = `${JSON.stringify(report(run, opts))}\n`;
      if (opts.json === "-") process.stdout.write(json);
      else writeArtifact(opts.json, json, { gzip: opts.json.endsWith(".gz") });
    }
    return opts.signal.reason ?? (run.failed.length ? 1 : 0);
  } finally {
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
  }
}

if (isMain(import.meta.url)) {
  try {
    process.exitCode = (await main()) ?? 0;
  } catch (error) {
    console.error(`node-checks: ${error.message}`);
    process.exitCode = 2;
  }
}
