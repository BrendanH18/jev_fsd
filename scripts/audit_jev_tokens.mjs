// Summarise provider-reported Jev input tokens from a saved tape without replaying the drives.
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { ModelRecording } from "../static/js/brain/recording.js";

const INPUT_TOKEN_TARGET = 5500;

function auditDrive(answers) {
  const stats = { calls: 0, with_usage: 0, total_input_tokens: 0, max_input_tokens: null, over_target: 0 };
  for (const outcomes of Object.values(answers)) {
    for (const outcome of outcomes) {
      stats.calls++;
      const tokens = outcome.response?.trace?.response?.usage?.input_tokens;
      if (!Number.isSafeInteger(tokens) || tokens < 0) continue;
      stats.with_usage++;
      stats.total_input_tokens += tokens;
      stats.max_input_tokens = Math.max(stats.max_input_tokens ?? 0, tokens);
      if (tokens > INPUT_TOKEN_TARGET) stats.over_target++;
    }
  }
  return stats;
}

try {
  const [path, ...extra] = process.argv.slice(2);
  if (!path || extra.length)
    throw new Error(
      "Usage: node --experimental-default-type=module scripts/audit_jev_tokens.mjs <recording.json[.gz]>",
    );
  const raw = readFileSync(path);
  const tape = ModelRecording.parse((path.endsWith(".gz") ? gunzipSync(raw) : raw).toString());
  if (tape.header.driver !== "jev") throw new Error("This audit needs a Jev recording.");
  const drives = Object.fromEntries(Object.entries(tape.drives).map(([id, answers]) => [id, auditDrive(answers)]));
  console.log(JSON.stringify({ input_token_target: INPUT_TOKEN_TARGET, drives }, null, 2));
} catch (error) {
  console.error(error instanceof SyntaxError ? "Could not parse the recording JSON." : error.message);
  process.exitCode = 1;
}
