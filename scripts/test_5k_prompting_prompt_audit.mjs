import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { linkSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkAuditPath, promptAudit } from "./prompt_audit.mjs";

const question = (instructions, criteria = { a: "é", b: null }) => ({ type: "choice", instructions, criteria });
const first = {
  state: {
    text: "🚗",
    traffic: [{}, {}],
    candidates: [{}],
    rejected: { off_road: 1, red_light: 3 },
    route_options: [{}, {}, {}],
    pedestrian: { in_path: true },
  },
  tick: 1,
  epoch: 2,
  questions: { vector: question("🚗".repeat(4000)), motion: question("Choose!") },
};
const second = {
  state: { text: "🚗".repeat(2060) },
  questions: { vector: question("🚗".repeat(6001), Object.fromEntries(Array.from({ length: 33 }, (_, i) => [i, ""]))) },
};
const expect = { candidate: ["a", "b"], headlights: ["low"], route: ["r1"], motion: ["drive"] };
const user = {
  driving_style: "🚗🚕",
  observed: { car: { speed: 2 } },
  situation: ["slow", "curve ahead"],
  candidates: [{ id: "b" }, { id: "a" }],
  route_options: { r1: "first" },
  motion_options: { drive: "go" },
  answer: expect,
};
const chat = (input = user, options = expect) => ({
  expect: options,
  messages: [
    { role: "system", content: "Private prompt contents" },
    { role: "user", content: JSON.stringify(input) },
    { role: "assistant", content: "go" },
  ],
});
const audits = promptAudit({ top: 1 });
for (const request of [
  first,
  second,
  chat(),
  chat(),
  { ...chat(), messages: [{ role: "system", content: "different" }, ...chat().messages.slice(1)] },
])
  audits.observe(request);
const report = audits.result();
assert.equal(report.requests, 5);
assert.equal(report.malformed_requests, 0);
assert.equal(report.request_shapes["questions/motion+vector"], 1);
assert.equal(report.request_shapes["questions/vector"], 1);
assert.equal(report.request_shapes["chat/motion+candidate+headlights+route"], 3);
assert.equal(report.llm_system_variants, 2);
const s = report.sizes;
assert.equal(s.request_json_bytes.samples, 5);
assert.equal(s.state_json_bytes.min, Buffer.byteLength(JSON.stringify(first.state)));
assert.equal(s.state_server_bytes_floor.max > 24576, true);
assert.equal(s.questions_json_bytes.samples, 2);
assert.equal(s.questions_per_call.total, 3);
assert.equal(s.state_traffic_rows.max, 2);
assert.equal(s.state_candidates_rows.max, 1);
assert.equal(s.rejection_categories.max, 2);
assert.equal(s.rejected_candidates.total, 4);
assert.equal(s.state_route_options_rows.max, 3);
assert.equal(s.pedestrian_observation_bytes.max, Buffer.byteLength(JSON.stringify(first.state.pedestrian)));
assert.equal(s.vector_instruction_chars.min, 4000);
assert.equal(s.vector_instruction_chars.p50, 4000);
assert.equal(s.vector_instruction_chars.p95, 6001);
assert.equal(s.vector_instruction_chars.max, 6001);
assert.equal(s.vector_instruction_chars.total, 10001);
assert.equal(s.vector_criterion_chars.samples, 34);
assert.equal(s.vector_criterion_chars.max, 1);
assert.equal(s.vector_choice_id_chars.max, 2);
assert.equal(s.vector_criteria_json_bytes.min, Buffer.byteLength(JSON.stringify(first.questions.vector.criteria)));
assert.equal(s.vector_choices.max, 33);
assert.equal(s.messages_per_call.min, 3);
assert.equal(s.llm_system_chars.samples, 3);
assert.equal(s.llm_user_chars.min, Array.from(JSON.stringify(user)).length);
assert.equal(s.llm_assistant_chars.max, 2);
assert.equal(s.chat_prompt_chars.samples, 3);
assert.equal(s.observed_json_bytes.max, Buffer.byteLength(JSON.stringify(user.observed)));
assert.equal(s.situation_clauses.max, 2);
assert.equal(s.situation_json_bytes.min, Buffer.byteLength(JSON.stringify(user.situation)));
assert.equal(s.candidate_rows.min, 2);
assert.equal(s.candidate_json_bytes.total, 3 * Buffer.byteLength(JSON.stringify(user.candidates)));
assert.equal(s.route_options_json_bytes.max, Buffer.byteLength(JSON.stringify(user.route_options)));
assert.equal(s.motion_options_json_bytes.max, Buffer.byteLength(JSON.stringify(user.motion_options)));
assert.equal(s.answer_schema_json_bytes.max, Buffer.byteLength(JSON.stringify(expect)));
assert.equal(s.expected_candidate_choices.max, 2);
assert.equal(s.expected_motion_choices.max, 1);
assert.equal(s.expected_headlights_choices.max, 1);
assert.equal(s.expected_route_choices.max, 1);
assert.equal(s.expect_json_bytes.max, Buffer.byteLength(JSON.stringify(expect)));
assert.equal(s.driving_style_chars.max, 2);
assert.equal(report.over_budget.question_over_target, 1);
assert.equal(report.over_budget.question_too_large, 1);
assert.equal(report.over_budget.state_too_large, 1);
assert.equal(report.over_budget.too_many_choices, 1);
assert.equal(report.largest.vector_instruction_chars.length, 1);
assert.equal(report.largest.vector_instruction_chars[0].request, 2);
assert.equal(report.largest.chat_prompt_chars[0].request, 3);
assert.equal(report.prompts.vector.over_4000, 1);
assert.equal("sizes" in audits.result({ detailed: false }), false);
assert.equal(JSON.stringify(report).includes("Private prompt contents"), false);
assert.equal(JSON.stringify(report).includes('"different"'), false);
report.prompts.vector.samples = 0;
report.largest.vector_instruction_chars[0].amount = 0;
assert.equal(audits.result().prompts.vector.samples, 2);
assert.equal(audits.result().largest.vector_instruction_chars[0].amount, 6001);

const malformed = promptAudit();
for (const value of [
  null,
  { questions: {} },
  {
    state: {},
    tick: false,
    epoch: 1.5,
    questions: {
      stranger: {},
      motion: { type: "number", instructions: " ", criteria: { " ": 4 } },
      vector: null,
      headlights: question("dip", {}),
    },
  },
  {
    questions: {},
    messages: [
      { role: "bad", content: 123 },
      { role: "user", content: "invalid JSON" },
      { role: "user", content: "[]" },
      { role: "user", content: "{}" },
    ],
  },
  chat({ ...user, answer: { motion: ["stop"] }, candidates: [{ id: "a" }, { id: "a" }, { id: "other" }, null] }),
  chat(user, { motion: ["reverse", "reverse"], candidate: [" "], route: [], headlights: "low", extra: ["x"] }),
  chat(user, null),
  { messages: [], expect: {} },
  { messages: Array.from({ length: 7 }, () => ({ role: "system", content: "x".repeat(10000) })), expect: {} },
])
  malformed.observe(value);
const bad = malformed.result();
assert.equal(bad.malformed_requests, 9);
for (const [key, count] of Object.entries({
  unknown_request: 1,
  missing_state: 1,
  no_questions: 1,
  unknown_questions: 1,
  invalid_question_type: 2,
  blank_instructions: 1,
  missing_instructions: 1,
  blank_choice_id: 1,
  invalid_criterion_description: 1,
  empty_criteria: 1,
  missing_criteria: 1,
  invalid_tick: 1,
  invalid_epoch: 1,
  ambiguous_request: 1,
  invalid_message: 1,
  missing_system_message: 2,
  missing_user_message: 2,
  user_message_not_json: 1,
  user_json_not_object: 1,
  missing_observations: 1,
  missing_answer_schema: 1,
  answer_schema_mismatch: 2,
  duplicate_candidate_row: 1,
  invalid_candidate_row: 1,
  unoffered_candidate_row: 5,
  missing_candidate_row: 2,
  unknown_expected_fields: 1,
  invalid_expected_choices: 1,
  invalid_expected_choice_id: 1,
  invalid_expected_motion: 1,
  duplicate_expected_choices: 1,
  empty_expected_choices: 1,
  missing_expect: 2,
  no_expected_fields: 2,
}))
  assert.equal(bad.issues[key], count, key);
assert.equal(bad.over_budget.chat_too_large, 1);
assert.equal(bad.over_budget.too_many_messages, 1);

const cmd = (...args) => spawnSync(process.execPath, ["scripts/prompt_audit.mjs", ...args], { encoding: "utf8" });
const stdin = (input, ...args) =>
  spawnSync(process.execPath, ["scripts/prompt_audit.mjs", ...args, "-"], { input, encoding: "utf8" });
const dir = mkdtempSync(join(tmpdir(), "jev-prompt-audit-"));
try {
  const file = join(dir, "requests.jsonl");
  const write = (body) => writeFileSync(file, JSON.stringify(body));
  const rows = [first, chat()].map((row) => JSON.stringify(row)).join("\r\n");
  assert.equal(cmd("-h").stdout.includes("--require-complete"), true);
  assert.equal(cmd().status, 1);
  assert.equal(cmd(file, file).status, 1);
  assert.equal(cmd("--top", "101", file).status, 1);
  assert.match(cmd(file).stderr, /ENOENT/);
  assert.equal(JSON.parse(stdin(`\uFEFF${rows}\r\n\r\n`, "--top", "0").stdout).requests, 2);
  const noTop = JSON.parse(stdin(rows, "--top", "0").stdout).largest;
  assert.equal(noTop.vector_instruction_chars.length, 0);
  const invalidJSON = stdin(`${rows}\n\n{{\n`);
  assert.equal(invalidJSON.status, 1);
  assert.match(invalidJSON.stderr, /line 4/);
  assert.equal(invalidJSON.stdout, "");
  assert.equal(stdin("\n", "--require-complete").status, 1);
  assert.equal(stdin("null", "--require-complete").status, 1);
  assert.equal(stdin(rows, "--require-complete").status, 0);
  write({ state: {}, questions: { motion: question("x".repeat(4001)) } });
  assert.equal(cmd("--check", file).status, 0);
  assert.equal(cmd("--check-target", file).status, 1);
  assert.match(cmd("--check-target", file).stderr, /question_over_target=1/);
  write(second);
  assert.equal(cmd("--check", file).status, 1);
  assert.match(cmd("--check", file).stderr, /question_too_large=1/);
  assert.equal(JSON.parse(cmd("--check", file).stdout).requests, 1);

  const fail = (message) => {
    throw new Error(message);
  };
  const own = /need different files/;
  const hard = join(dir, "hard-link");
  const sym = join(dir, "same-file");
  const alias = join(dir, "alias");
  const child = join(dir, "subdir");
  const dangling = join(dir, "dangling.json");
  mkdirSync(child);
  linkSync(file, hard);
  symlinkSync(file, sym);
  symlinkSync(child, alias);
  symlinkSync("future.json", dangling);
  assert.throws(() => checkAuditPath(hard, [file], fail), own);
  assert.throws(() => checkAuditPath(sym, [file], fail), own);
  assert.throws(() => checkAuditPath(join(alias, "future.json"), [join(child, "future.json")], fail), own);
  assert.throws(() => checkAuditPath(dangling, [join(dir, "future.json")], fail), /dangling symbolic link/);
  assert.throws(() => checkAuditPath(child, [], fail), /must name a file/);
  assert.throws(() => checkAuditPath(join(dir, "future.json"), [join(dir, "future.json")], fail), own);
  assert.equal(checkAuditPath(join(dir, "future.json"), [undefined, file], fail), undefined);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
console.log("Request-size audit checks passed.");
