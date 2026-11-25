// Request-size audit for a benchmark recording/replay or a stream of saved request bodies.
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
  characterCount,
  isChatChoiceId,
  isObject,
  MAX_CHAT_CHARS,
  MAX_CHAT_MESSAGES,
  MAX_CHOICES,
  MAX_QUESTION_CHARS,
  MAX_STATE_BYTES,
  nonblank,
  own,
  QUESTION_CHAR_TARGET,
  QUESTION_FIELDS,
  stateSizeFloor,
} from "../static/js/brain/model-contract.js";

import { checkFiles } from "./cli_tools.mjs";

export function checkAuditPath(path, otherPaths, fail) {
  const outputs = { "prompt-audit": path };
  try {
    checkFiles({}, outputs);
    for (const other of otherPaths.filter(Boolean)) checkFiles({ artifact: other }, outputs);
  } catch (error) {
    fail(error.message);
  }
}

const jsonBytes = (value) => Buffer.byteLength(JSON.stringify(value));
const QUESTIONS = Object.keys(QUESTION_FIELDS);
const FIELDS = Object.values(QUESTION_FIELDS);
const ROLES = ["system", "user", "assistant"];

function distribution(result, key, value) {
  const counts = result.get(key) ?? new Map();
  counts.set(value, (counts.get(value) ?? 0) + 1);
  result.set(key, counts);
}

function describe(counts) {
  const sorted = [...counts].sort(([a], [b]) => a - b);
  const samples = sorted.reduce((sum, [, n]) => sum + n, 0);
  let seen = 0;
  let median;
  let p95;
  let total = 0;
  for (const [value, n] of sorted) {
    total += value * n;
    seen += n;
    if (seen >= Math.ceil(samples * 0.5)) median ??= value;
    if (seen >= Math.ceil(samples * 0.95)) p95 ??= value;
  }
  return { samples, total, min: sorted[0][0], p50: median, p95, max: sorted.at(-1)[0] };
}

function shareTop(worst, item, count) {
  if (!count) return;
  if (worst.length >= count && item.amount <= worst.at(-1).amount) return;
  worst.push(item);
  worst.sort((a, b) => b.amount - a.amount || a.request - b.request);
  if (worst.length > count) worst.pop();
}

export function promptAudit({ top = 3 } = {}) {
  const prompts = new Map();
  const sizes = new Map();
  const shapes = new Map();
  const budget = {};
  const worst = {};
  const prefixes = new Set();
  const issues = {};
  let requests = 0;
  let malformed = 0;
  let issueCount = 0;

  function sample(key, amount, limits = {}) {
    distribution(sizes, key, amount);
    for (const [name, limit] of Object.entries(limits)) if (amount > limit) budget[name] = (budget[name] ?? 0) + 1;
    if (Object.keys(limits).length) shareTop((worst[key] ??= []), { request: requests, amount }, top);
  }

  function issue(code) {
    issueCount++;
    issues[code] = (issues[code] ?? 0) + 1;
  }

  function count(prompt, chars, question) {
    const stat = prompts.get(prompt) || { samples: 0, max_chars: 0, ...(question ? { over_4000: 0 } : {}) };
    stat.samples++;
    stat.max_chars = Math.max(stat.max_chars, chars);
    if (question && chars > QUESTION_CHAR_TARGET) stat.over_4000++;
    prompts.set(prompt, stat);
  }

  function inspectQuestions(body) {
    const { state, questions } = body;
    if (isObject(state)) {
      sample("state_json_bytes", jsonBytes(state));
      sample("state_server_bytes_floor", stateSizeFloor(state), { state_too_large: MAX_STATE_BYTES });
      for (const key of ["traffic", "candidates", "route_options"])
        if (Array.isArray(state[key])) sample(`state_${key}_rows`, state[key].length);
      if (isObject(state.rejected)) {
        const rejections = Object.values(state.rejected);
        sample("rejection_categories", rejections.length);
        if (rejections.every((n) => Number.isSafeInteger(n) && n >= 0))
          sample(
            "rejected_candidates",
            rejections.reduce((sum, count) => sum + count, 0),
          );
      }
      if (isObject(state.pedestrian)) sample("pedestrian_observation_bytes", jsonBytes(state.pedestrian));
    } else issue("missing_state");
    sample("questions_json_bytes", jsonBytes(questions));
    sample("questions_per_call", Object.keys(questions).length);
    const asked = [];
    for (const id of QUESTIONS) {
      if (!Object.hasOwn(questions, id)) continue;
      asked.push(id);
      const question = questions[id];
      if (own(question, "type") !== "choice") issue("invalid_question_type");
      const instructions = own(question, "instructions");
      if (typeof instructions === "string") {
        const chars = characterCount(instructions);
        count(id, chars, true);
        sample(`${id}_instruction_chars`, chars, {
          question_over_target: QUESTION_CHAR_TARGET,
          question_too_large: MAX_QUESTION_CHARS,
        });
        if (!nonblank(instructions)) issue("blank_instructions");
      } else issue("missing_instructions");
      const criteria = own(question, "criteria");
      if (isObject(criteria)) {
        const choices = Object.entries(criteria);
        sample(`${id}_choices`, choices.length, { too_many_choices: MAX_CHOICES });
        if (!choices.length) issue("empty_criteria");
        sample(`${id}_criteria_json_bytes`, jsonBytes(criteria));
        for (const [choice, description] of choices) {
          sample(`${id}_choice_id_chars`, characterCount(choice));
          if (!nonblank(choice)) issue("blank_choice_id");
          if (typeof description === "string") sample(`${id}_criterion_chars`, characterCount(description));
          else if (description !== null) issue("invalid_criterion_description");
        }
      } else issue("missing_criteria");
    }
    if (!asked.length) issue("no_questions");
    if (Object.keys(questions).length !== asked.length) issue("unknown_questions");
    return `questions/${asked.join("+") || "none"}`;
  }

  function inspectUser(content, expect) {
    let value;
    try {
      value = JSON.parse(content);
    } catch {
      // Saved request streams can include custom chat content.
      issue("user_message_not_json");
      return;
    }
    if (!isObject(value)) {
      issue("user_json_not_object");
      return;
    }
    if (isObject(value.observed)) sample("observed_json_bytes", jsonBytes(value.observed));
    else issue("missing_observations");
    if (Array.isArray(value.situation)) {
      sample("situation_clauses", value.situation.length);
      sample("situation_json_bytes", jsonBytes(value.situation));
    }
    const candidates = value.candidates;
    if (Array.isArray(candidates)) {
      sample("candidate_rows", candidates.length);
      sample("candidate_json_bytes", jsonBytes(candidates));
      const offered = Array.isArray(expect?.candidate) ? new Set(expect.candidate) : new Set();
      const seen = new Set();
      for (const candidate of candidates) {
        const id = own(candidate, "id");
        if (!isChatChoiceId(id)) {
          issue("invalid_candidate_row");
          continue;
        }
        if (seen.has(id)) issue("duplicate_candidate_row");
        if (!offered.has(id)) issue("unoffered_candidate_row");
        seen.add(id);
      }
      if ([...offered].some((id) => !seen.has(id))) issue("missing_candidate_row");
    } else if (Array.isArray(expect?.candidate)) issue("missing_candidate_row");
    if (isObject(value.route_options)) sample("route_options_json_bytes", jsonBytes(value.route_options));
    if (isObject(value.motion_options)) sample("motion_options_json_bytes", jsonBytes(value.motion_options));
    if (isObject(value.answer)) {
      sample("answer_schema_json_bytes", jsonBytes(value.answer));
      if (isObject(expect)) {
        const matches = (field) => JSON.stringify(own(value.answer, field)) === JSON.stringify(own(expect, field));
        if (Object.keys(value.answer).length !== Object.keys(expect).length || !FIELDS.every(matches))
          issue("answer_schema_mismatch");
      }
    } else issue("missing_answer_schema");
    if (typeof value.driving_style === "string") sample("driving_style_chars", characterCount(value.driving_style));
  }

  function inspectChat({ messages, expect }) {
    sample("messages_per_call", messages.length, { too_many_messages: MAX_CHAT_MESSAGES });
    const system = [];
    let total = 0;
    let user = false;
    for (const message of messages) {
      if (!ROLES.includes(message?.role) || typeof message?.content !== "string") {
        issue("invalid_message");
        continue;
      }
      const { role, content } = message;
      const chars = characterCount(content);
      total += chars;
      sample(`llm_${role}_chars`, chars);
      if (role === "system") {
        count("llm_system", chars, false);
        system.push(content);
      } else if (role === "user" && nonblank(content)) {
        user = true;
        inspectUser(content, expect);
      }
    }
    if (!user) issue("missing_user_message");
    if (system.length) prefixes.add(createHash("sha256").update(JSON.stringify(system)).digest("hex"));
    else issue("missing_system_message");
    sample("chat_prompt_chars", total, { chat_too_large: MAX_CHAT_CHARS });
    const asked = [];
    if (isObject(expect)) {
      for (const field of FIELDS) {
        if (!Object.hasOwn(expect, field)) continue;
        asked.push(field);
        const choices = expect[field];
        if (!Array.isArray(choices)) {
          issue("invalid_expected_choices");
          continue;
        }
        sample(`expected_${field}_choices`, choices.length, { too_many_choices: MAX_CHOICES });
        if (!choices.length) issue("empty_expected_choices");
        if (new Set(choices).size !== choices.length) issue("duplicate_expected_choices");
        if (!choices.every(isChatChoiceId)) issue("invalid_expected_choice_id");
        if (field === "motion" && choices.some((id) => id !== "drive" && id !== "stop"))
          issue("invalid_expected_motion");
      }
      if (!asked.length) issue("no_expected_fields");
      if (Object.keys(expect).length !== asked.length) issue("unknown_expected_fields");
      sample("expect_json_bytes", jsonBytes(expect));
    } else issue("missing_expect");
    return `chat/${asked.join("+") || "none"}`;
  }

  return {
    observe(body) {
      requests++;
      const previousIssues = issueCount;
      if (!isObject(body) || (!isObject(body.questions) && !Array.isArray(body.messages))) {
        issue("unknown_request");
      } else {
        sample("request_json_bytes", jsonBytes(body));
        if (Object.hasOwn(body, "tick") && !Number.isSafeInteger(body.tick)) issue("invalid_tick");
        if (Object.hasOwn(body, "epoch") && !Number.isSafeInteger(body.epoch)) issue("invalid_epoch");
        if (Object.hasOwn(body, "messages") && Object.hasOwn(body, "questions")) issue("ambiguous_request");
        const shape = Array.isArray(body.messages) ? inspectChat(body) : inspectQuestions(body);
        shapes.set(shape, (shapes.get(shape) ?? 0) + 1);
      }
      if (issueCount !== previousIssues) malformed++;
    },
    result({ detailed = true } = {}) {
      return {
        requests,
        prompts: Object.fromEntries([...prompts].map(([key, value]) => [key, { ...value }])),
        ...(detailed
          ? {
              malformed_requests: malformed,
              issues: { ...issues },
              request_shapes: Object.fromEntries(shapes),
              llm_system_variants: prefixes.size,
              sizes: Object.fromEntries(Array.from(sizes, ([key, counts]) => [key, describe(counts)])),
              over_budget: { ...budget },
              largest: Object.fromEntries(
                Object.entries(worst).map(([key, list]) => [key, list.map((item) => ({ ...item }))]),
              ),
            }
          : {}),
      };
    },
  };
}

const USAGE = [
  "Usage: node --experimental-default-type=module scripts/prompt_audit.mjs [options] <requests.jsonl | ->",
  "  --top <N>            retain up to N largest requests per budgeted measurement (default 3, max 100)",
  "  --check              fail if requests exceed the prompt or choice limits",
  "  --check-target       also fail above the 4,000-character question target",
  "  --require-complete   fail for empty input or malformed request entries",
  "  --help, -h           show this help",
].join("\n");

async function main() {
  const { values, positionals } = parseArgs({
    options: {
      top: { type: "string" },
      check: { type: "boolean" },
      "check-target": { type: "boolean" },
      "require-complete": { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });
  if (values.help) {
    console.log(USAGE);
    return;
  }
  if (positionals.length !== 1) throw new Error(USAGE);
  const top = Number(values.top ?? 3);
  if (!/^\d+$/.test(values.top ?? "3") || !Number.isSafeInteger(top) || top > 100)
    throw new Error("--top must be a whole number from 0 to 100.");
  const [path] = positionals;
  const input = path === "-" ? process.stdin : createReadStream(path);
  const lines = createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY });
  const audit = promptAudit({ top });
  let lineNumber = 0;
  for await (const line of lines) {
    lineNumber++;
    const text = lineNumber === 1 ? line.replace(/^\uFEFF/u, "") : line;
    if (!text.trim()) continue;
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error(`Could not parse request JSON on line ${lineNumber}.`);
    }
    audit.observe(body);
  }
  const report = audit.result();
  console.log(JSON.stringify(report, null, 2));
  const exceeded = Object.entries(report.over_budget)
    .filter(
      ([key]) =>
        (values["check-target"] && key === "question_over_target") || (values.check && key !== "question_over_target"),
    )
    .map(([key, n]) => `${key}=${n}`);
  if (exceeded.length) {
    console.error(`Prompt budget exceeded (${exceeded.join(", ")}).`);
    process.exitCode = 1;
  }
  if (values["require-complete"] && (!report.requests || report.malformed_requests)) {
    console.error(`Need complete requests (read ${report.requests}, ${report.malformed_requests} malformed).`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
