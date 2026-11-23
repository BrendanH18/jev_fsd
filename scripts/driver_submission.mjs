import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { linkSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { gunzipSync, gzipSync } from "node:zlib";
import { readSubmission, SUBMISSION_FORMAT, verifySubmissionReport } from "./submission_bundle.mjs";

const usage = [
  "Usage: node --experimental-default-type=module scripts/driver_submission.mjs",
  "  pack --recording tape.json.gz --report report.json --out submission.json.gz",
  "  verify --bundle submission.json.gz [--checkout path] [--port 8322]",
  "  publish --bundle submission.json.gz --submitter handle --out data/submissions/YYYY-MM-DD/name.json [--checkout path] [--port 8322]",
].join("\n");
const MAX_BYTES = 128 * 1024 * 1024;
const read = (path) => {
  if (statSync(path).size > MAX_BYTES) throw new Error(`${path} exceeds 128 MiB.`);
  const bytes = readFileSync(path);
  return JSON.parse(path.endsWith(".gz") ? gunzipSync(bytes, { maxOutputLength: MAX_BYTES }) : bytes);
};
const write = (path, value, indent) => {
  const text = `${JSON.stringify(value, null, indent)}\n`;
  if (Buffer.byteLength(text) > MAX_BYTES) throw new Error(`${path} exceeds 128 MiB before compression.`);
  const bytes = path.endsWith(".gz") ? gzipSync(text, { level: 9 }) : text;
  writeFileSync(path, bytes, { flag: "wx" });
  return bytes;
};

function verify({ recording, report }, { checkout, port }) {
  const arena = checkout
    ? resolve(checkout, "scripts/arena_node.mjs")
    : fileURLToPath(new URL("./arena_node.mjs", import.meta.url));
  const dir = mkdtempSync(join(tmpdir(), "jev-submission-"));
  try {
    const tape = join(dir, "recording.json");
    const replay = join(dir, "report.json");
    write(tape, recording);
    execFileSync(
      process.execPath,
      [
        "--experimental-default-type=module",
        arena,
        "--replay",
        tape,
        "--check",
        "submission",
        "--json",
        replay,
        "--port",
        port ?? "8322",
      ],
      { stdio: "inherit", timeout: 360_000, killSignal: "SIGKILL" },
    );
    verifySubmissionReport(report, read(replay));
    console.log(`Verified ${report.results.length} drives from ${recording.header.driver}.`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function publish({ bundle: bundlePath, submitter, out, checkout, port }) {
  if (!/^[a-z0-9][a-z0-9_-]{0,38}$/.test(submitter))
    throw new Error("Use a submitter handle with 1–39 lowercase letters, digits, hyphens or underscores.");
  const dayDir = dirname(resolve(out));
  const submissions = dirname(dayDir);
  const day = basename(dayDir);
  const date = new Date(`${day}T00:00:00Z`);
  if (
    basename(submissions) !== "submissions" ||
    basename(dirname(submissions)) !== "data" ||
    !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(day) ||
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== day
  )
    throw new Error("Write the publication under data/submissions/YYYY-MM-DD/ using a valid calendar date.");
  if (!/^[a-z0-9][a-z0-9_-]*\.json$/.test(basename(out)))
    throw new Error("Name the publication report with lowercase letters, digits, hyphens or underscores and .json.");
  const tape = `${out}.gz`;
  if ([out, tape].some((path) => statSync(path, { throwIfNoEntry: false })))
    throw new Error("The publication report and tape must both be new files.");
  const bundle = readSubmission(read(bundlePath));
  verify(bundle, { checkout, port });
  const staging = mkdtempSync(join(dirname(out), ".jev-submission-"));
  const stagedTape = join(staging, "recording.json.gz");
  const stagedReport = join(staging, "report.json");
  try {
    const bytes = write(stagedTape, bundle.recording);
    write(
      stagedReport,
      {
        format: "jev-published-submission/1",
        submitter,
        recording_sha256: createHash("sha256").update(bytes).digest("hex"),
        report: bundle.report,
      },
      1,
    );
    linkSync(stagedTape, tape);
    try {
      linkSync(stagedReport, out);
    } catch (error) {
      rmSync(tape);
      throw error;
    }
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
  console.log(`Published source files written to ${out} and ${tape}.`);
}

try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      recording: { type: "string" },
      report: { type: "string" },
      out: { type: "string" },
      bundle: { type: "string" },
      submitter: { type: "string" },
      checkout: { type: "string" },
      port: { type: "string" },
      help: { type: "boolean" },
    },
  });
  const [command] = positionals;
  if (values.help) console.log(usage);
  else if (positionals.length === 1 && command === "pack" && values.recording && values.report && values.out) {
    const bundle = readSubmission({
      format: SUBMISSION_FORMAT,
      recording: read(values.recording),
      report: read(values.report),
    });
    write(values.out, bundle);
    console.log(`Packed ${bundle.report.results.length} drives to ${values.out}.`);
  } else if (positionals.length === 1 && command === "verify" && values.bundle) {
    verify(readSubmission(read(values.bundle)), values);
  } else if (positionals.length === 1 && command === "publish" && values.bundle && values.submitter && values.out) {
    publish(values);
  } else throw new Error(usage);
} catch (error) {
  console.error(`Submission could not be processed: ${error.message}`);
  process.exitCode = 1;
}
