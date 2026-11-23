import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { gunzipSync, gzipSync } from "node:zlib";
import { readSubmission, SUBMISSION_FORMAT, verifySubmissionReport } from "./submission_bundle.mjs";

const usage = [
  "Usage: node --experimental-default-type=module scripts/driver_submission.mjs",
  "  pack --recording tape.json.gz --report report.json --out submission.json.gz",
  "  verify --bundle submission.json.gz [--port 8322]",
].join("\n");
const MAX_BYTES = 128 * 1024 * 1024;
const read = (path) => {
  if (statSync(path).size > MAX_BYTES) throw new Error(`${path} exceeds 128 MiB.`);
  const bytes = readFileSync(path);
  return JSON.parse(path.endsWith(".gz") ? gunzipSync(bytes, { maxOutputLength: MAX_BYTES }) : bytes);
};
const write = (path, value) => {
  const text = `${JSON.stringify(value)}\n`;
  if (Buffer.byteLength(text) > MAX_BYTES) throw new Error(`${path} exceeds 128 MiB before compression.`);
  writeFileSync(path, path.endsWith(".gz") ? gzipSync(text, { level: 9 }) : text, { flag: "wx" });
};

try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      recording: { type: "string" },
      report: { type: "string" },
      out: { type: "string" },
      bundle: { type: "string" },
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
    const { recording, report } = readSubmission(read(values.bundle));
    const dir = mkdtempSync(join(tmpdir(), "jev-submission-"));
    try {
      const tape = join(dir, "recording.json");
      const replay = join(dir, "report.json");
      write(tape, recording);
      const args = [
        "--experimental-default-type=module",
        fileURLToPath(new URL("./arena_node.mjs", import.meta.url)),
        "--replay",
        tape,
        "--check",
        "submission",
        "--json",
        replay,
        "--port",
        values.port ?? "8322",
      ];
      execFileSync(process.execPath, args, { stdio: "inherit", timeout: 360_000, killSignal: "SIGKILL" });
      verifySubmissionReport(report, read(replay));
      console.log(`Verified ${report.results.length} drives from ${recording.header.driver}.`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  } else throw new Error(usage);
} catch (error) {
  console.error(`Submission could not be processed: ${error.message}`);
  process.exitCode = 1;
}
