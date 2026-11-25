// Browser-side checks for the wire formats in jev/decide.py and jev/llm.py.
export const QUESTION_CHAR_TARGET = 4000;
export const MAX_QUESTION_CHARS = 6000;
export const MAX_STATE_BYTES = 24 * 1024;
export const MAX_CHAT_MESSAGES = 6;
export const MAX_CHAT_CHARS = 64 * 1024;
export const MAX_CHOICES = 32;
export const QUESTION_FIELDS = Object.freeze({
  motion: "motion",
  vector: "candidate",
  headlights: "headlights",
  route: "route",
});

export const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
export const own = (record, field) => (record && Object.hasOwn(record, field) ? record[field] : undefined);
export const nonblank = (value) => typeof value === "string" && value.trim().length > 0;

export function characterCount(text) {
  let count = 0;
  for (const _character of text) count++;
  return count;
}

export function invalidRequest(message) {
  throw new Error(`invalid model request: ${message}`);
}

export function checkCoordinates({ tick, epoch }) {
  if (!Number.isSafeInteger(tick)) invalidRequest("tick must be a safe integer");
  if (!Number.isSafeInteger(epoch)) invalidRequest("epoch must be a safe integer");
}

export function questionCriteria(questions, id) {
  const question = own(questions, id);
  const criteria = isObject(question) && own(question, "criteria");
  if (!isObject(criteria)) invalidRequest(`question ${id} needs a criteria object`);
  const choices = Object.keys(criteria);
  if (!choices.length || choices.length > MAX_CHOICES)
    invalidRequest(`question ${id} needs 1–${MAX_CHOICES} choices (got ${choices.length})`);
  return criteria;
}

export function questionIds(questions) {
  if (!isObject(questions)) invalidRequest("questions must be an object");
  const ids = Object.keys(questions);
  for (const id of ids) if (!Object.hasOwn(QUESTION_FIELDS, id)) invalidRequest(`unknown question ${id}`);
  return ids;
}

// Lower bound for Python's ASCII JSON encoding. Replacing numbers avoids relying on JS and Python
// formatting a given float the same way. Non-ASCII code units take six ASCII bytes each.
export function stateSizeFloor(state) {
  const json = JSON.stringify(state, (_key, value) => (typeof value === "number" ? 0 : value));
  if (typeof json !== "string" || json[0] !== "{") throw new TypeError("expected a JSON object");
  let size = json.length;
  for (let i = 0; i < json.length; i++) if (json.charCodeAt(i) >= 127) size += 5;
  return size;
}

export function checkJevRequest({ state, questions }) {
  if (!isObject(state)) invalidRequest("state must be an object");
  let bytes;
  try {
    bytes = stateSizeFloor(state);
  } catch {
    invalidRequest("decision state cannot be encoded as a JSON object");
  }
  if (bytes > MAX_STATE_BYTES)
    invalidRequest(`decision state exceeds the server's ${MAX_STATE_BYTES}-byte limit (at least ${bytes} bytes)`);
  const ids = questionIds(questions);
  if (!ids.length) invalidRequest("at least one question is required");
  for (const id of ids) {
    const question = questions[id];
    if (own(question, "type") !== "choice") invalidRequest(`question ${id} must be a choice`);
    const criteria = questionCriteria(questions, id);
    const instructions = own(question, "instructions");
    if (!nonblank(instructions)) invalidRequest(`question ${id} needs text instructions`);
    const chars = characterCount(instructions);
    if (chars > MAX_QUESTION_CHARS)
      invalidRequest(`question ${id} instructions have ${chars} characters (limit ${MAX_QUESTION_CHARS})`);
    for (const [choice, description] of Object.entries(criteria)) {
      if (!nonblank(choice)) invalidRequest(`question ${id} has a blank choice id`);
      if (description !== null && typeof description !== "string")
        invalidRequest(`question ${id} choice descriptions must be strings or null`);
    }
  }
}

const SHORT_ID = /^[A-Za-z0-9_.:-]{1,64}$/u;
export const isChatChoiceId = (value) => typeof value === "string" && SHORT_ID.test(value);
export function chatChoices(questions, id) {
  const criteria = questionCriteria(questions, id);
  const choices = Object.keys(criteria);
  const field = QUESTION_FIELDS[id];
  if (choices.some((choice) => !isChatChoiceId(choice)))
    invalidRequest(`expect.${field} contains a choice id that the chat endpoint cannot accept`);
  if (id === "motion" && choices.some((choice) => choice !== "drive" && choice !== "stop"))
    invalidRequest("expect.motion only accepts drive and stop");
  if (
    (id === "motion" || id === "route") &&
    Object.values(criteria).some((text) => text !== null && typeof text !== "string")
  )
    invalidRequest(`question ${id} choice descriptions must be strings or null`);
  return choices;
}

// Configured endpoints expose seconds. Match their upper bound and retain the margin for the server's
// diagnostic. A recording may carry an older endpoint entry without a timeout.
export function endpointTimeout(seconds, defaultSeconds) {
  const duration = Number.isFinite(seconds) && seconds > 0 ? Math.min(60, seconds) : defaultSeconds;
  return Math.round(duration * 1000) + 750;
}

export async function callModel(brain, path, body, signal) {
  signal?.throwIfAborted();
  const started = performance.now();
  const response = await brain.transport(path, body, { signal });
  signal?.throwIfAborted();
  const meta = {
    ...(isObject(own(response, "meta")) ? response.meta : {}),
    source: brain.name,
    ...(brain.name === "jev" ? {} : { live_call: true }),
    round_trip_ms: Math.round(performance.now() - started),
  };
  const trace = own(response, "trace");
  const invalid = (message) => {
    const prefix = path === "/api/llm/decide" ? "invalid output" : "invalid answer";
    throw Object.assign(new Error(`${prefix}: ${message}`), { meta: { ...meta, live_call: true }, trace });
  };
  for (const key of ["tick", "epoch"]) {
    if (Object.hasOwn(response ?? {}, key) && response[key] !== body[key])
      invalid(`reply ${key} does not match the request`);
  }
  const verdict = own(response, "invalid");
  if (verdict || (verdict != null && typeof verdict !== "string" && verdict !== false)) {
    invalid(nonblank(verdict) ? limitedText(verdict, 300) : "malformed invalid-output verdict");
  }
  return { response, meta, trace, invalid };
}

export function limitedText(text, limit) {
  // Fast path for ASCII and the common short reasons. Slice by code point when the limit matters.
  return text.length <= limit ? text : Array.from(text).slice(0, limit).join("");
}

export function replyError(response) {
  const error = own(response, "error");
  return nonblank(error) ? limitedText(error, 300) : null;
}
