import { CATEGORIES } from "../lab/examiner-categories.js";

// The coach dispatch and its validation use the same stages.
export const COACH_SLOTS = {
  tips: [
    "afterSpeed",
    "afterBlind",
    "beforeMerge",
    "afterMerge",
    "passingCyclists",
    "afterCyclists",
    "beforeJunction",
    "afterFollowing",
    "afterBusLanes",
  ],
  reports: ["beforeMerge", "passingCyclists", "afterSpeed", "afterFlagger", "afterBrakes", "end"],
  guidance: ["afterBlindSpeed", "afterDirection", "afterBlind", "beforeSample", "afterSample"],
  deductions: ["safety", "followingRules", "beforeLegality", "afterSpeed", "legality", "comfort", "post"],
};

const WORLD_FIELDS = ["property", "seen", "calls"];
const PREDICATES = ["motion", "parkingTraffic"];
const CLOCK_FIELDS = ["day", "utcOffset"];
const DISPLAY_MAPS = ["flagText", "perceptionRejections", "eventBadges"];
const FIELDS = new Set([
  "key",
  "flag",
  ...WORLD_FIELDS,
  "defaultCount",
  "buildAt",
  "snapshot",
  "build",
  "buildFleet",
  "obstacle",
  "priority",
  ...DISPLAY_MAPS,
  "coach",
  ...PREDICATES,
  ...CLOCK_FIELDS,
]);

const text = (value) => typeof value === "string" && !!value.trim();
const fieldName = (value) =>
  typeof value === "string" && /^[A-Za-z][A-Za-z0-9_]*$/.test(value) && !Object.hasOwn(Object.prototype, value);
const queryFlag = (value) => typeof value === "string" && /^[a-z][a-z0-9]*$/.test(value);
const object = (value) =>
  value != null && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const optional = (value, test) => value === undefined || test(value);
const callback = (value) => typeof value === "function";
const boolean = (value) => typeof value === "boolean";
const nonnegative = (value) => Number.isFinite(value) && value >= 0;
const obstacleFlags = ["traffic", "fixed", "likePedestrian", "long", "fixedCruise", "noCyclistPass"];
const obstacleCallbacks = ["predict", "visible", "oncoming", "parkedClearance", "noParking"];
const metricFields = [
  "at",
  "name",
  "failure",
  "label",
  "category",
  "decimals",
  "threshold",
  "traceType",
  "eventType",
  "initial",
  "reportWhenEnabled",
];
const noticeFields = ["at", "read", "order", "duration", "style", "hold"];
const coachEntryFields = {
  reports: ["at", "order", "read"],
  guidance: ["at", "order", "read"],
  tips: ["at", "order", "when", "text"],
  deductions: ["at", "order", "counter", "weight", "category"],
};

function unknownField(name, value, allowed) {
  for (const key of Reflect.ownKeys(value)) {
    if (!allowed.includes(key)) return `${name} has an unknown field "${String(key)}"`;
  }
  return null;
}

function mapProblem(name, map, test) {
  if (!object(map)) return `${name} must be an object`;
  for (const key of Reflect.ownKeys(map)) {
    if (!fieldName(key)) return `${name} has an invalid key "${String(key)}"`;
    if (!Object.getOwnPropertyDescriptor(map, key).enumerable) return `${name} has a hidden entry "${key}"`;
    if (!test(map[key])) return `${name} has an invalid value for "${key}"`;
  }
  return null;
}

function obstacleProblem(obstacle) {
  if (!object(obstacle) || !callback(obstacle.test)) return "obstacle needs a test function";
  for (const field of obstacleFlags)
    if (!optional(obstacle[field], boolean)) return `obstacle.${field} must be a boolean`;
  for (const field of obstacleCallbacks)
    if (!optional(obstacle[field], callback)) return `obstacle.${field} must be a function`;
  // An accessor can refer to a model constant in a module that is still loading.
  const label = Object.getOwnPropertyDescriptor(obstacle, "label");
  if (label?.set) return "obstacle.label must be read-only";
  if (label && !label.get && !text(label.value)) return "obstacle.label must be nonempty text";
  return unknownField("obstacle", obstacle, ["test", "label", ...obstacleFlags, ...obstacleCallbacks]);
}

function metricProblem(metric) {
  for (const field of ["name", "failure", "label"]) if (!text(metric[field])) return `metric has no ${field}`;
  if (!fieldName(metric.name)) return "metric has an invalid name";
  if (!optional(metric.reportWhenEnabled, boolean)) return "metric.reportWhenEnabled must be a boolean";
  if (!optional(metric.initial, nonnegative)) return "metric.initial must be a nonnegative finite number";
  if (!optional(metric.category, (category) => typeof category === "string" && Object.hasOwn(CATEGORIES, category)))
    return "metric has an unknown category";
  if (!optional(metric.decimals, (n) => Number.isSafeInteger(n) && n >= 0 && n <= 15))
    return "metric.decimals must be an integer from 0 to 15";
  if (!optional(metric.threshold, nonnegative)) return "metric.threshold must be a nonnegative finite number";
  for (const field of ["traceType", "eventType"])
    if (!optional(metric[field], fieldName)) return `metric.${field} has an invalid event type`;
  if (metric.traceType !== undefined && metric.threshold === undefined) return "metric.traceType needs a threshold";
  if (metric.traceType !== undefined && metric.eventType !== undefined)
    return "metric must choose traceType or eventType";
  return unknownField("metric", metric, metricFields);
}

function noticeProblem(notice) {
  if (!callback(notice.read)) return "notice needs a read function";
  if (!Number.isSafeInteger(notice.order)) return "notice.order must be an integer";
  if (!Number.isFinite(notice.duration) || notice.duration <= 0) return "notice.duration must be a positive number";
  if (typeof notice.style !== "string" && !callback(notice.style)) return "notice.style must be text or a function";
  if (!optional(notice.hold, boolean)) return "notice.hold must be a boolean";
  return unknownField("notice", notice, noticeFields);
}

function coachEntryProblem(field, entry) {
  if (!object(entry)) return `coach.${field} entries must be objects`;
  const prefix = `coach.${field}`;
  if (!COACH_SLOTS[field].includes(entry.at)) return `${prefix} has an unknown slot "${String(entry.at)}"`;
  if (!Number.isSafeInteger(entry.order)) return `${prefix} order must be an integer`;
  if ((field === "reports" || field === "guidance") && !callback(entry.read)) return `${prefix} needs a read function`;
  if (field === "tips") {
    if (!callback(entry.when)) return `${prefix} needs a when function`;
    if (!text(entry.text)) return `${prefix} needs tip text`;
  }
  if (field === "deductions") {
    if (!fieldName(entry.counter)) return `${prefix} needs a counter name`;
    if (!nonnegative(entry.weight)) return `${prefix} weight must be a nonnegative finite number`;
    if (entry.at === "post" && !["safety", "legality", "comfort", "control"].includes(entry.category))
      return `${prefix} needs a score category at "post"`;
    if (entry.at !== "post" && entry.category !== undefined) return `${prefix} can specify a category only at "post"`;
  }
  return unknownField(prefix, entry, coachEntryFields[field]);
}

function coachProblem(coach, seen) {
  if (!object(coach)) return "coach must be an object";
  for (const [field, value] of Object.entries(coach)) {
    if (Object.hasOwn(COACH_SLOTS, field)) {
      if (!Array.isArray(value)) return `coach.${field} must be an array`;
      for (const entry of value) {
        const problem = coachEntryProblem(field, entry);
        if (problem) return problem;
      }
    } else if (field === "seen" || field === "cap") {
      if (!fieldName(value)) return `coach.${field} must be a counter or flag name`;
      if (field === "seen" && !seen) return "coach.seen requires a World seen flag";
    } else if (field === "events") {
      const problem = mapProblem("coach.events", value, callback);
      if (problem) return problem;
    } else if (["init", "observe", "frame", "directionExempt"].includes(field)) {
      if (!callback(value)) return `coach.${field} must be a function`;
    } else return `unknown coach field ${field}`;
  }
  return null;
}

export const slotOf = (hook) => (typeof hook === "function" ? "end" : (hook?.at ?? "end"));
const dataChecks = {
  metric: metricProblem,
  notice: noticeProblem,
  prompt: (prompt) => {
    if (!text(prompt.text)) return "prompt needs text";
    if (!optional(prompt.inline, boolean)) return "prompt.inline must be a boolean";
    return unknownField("prompt", prompt, ["at", "text", "inline"]);
  },
};

function hookProblem(name, hook, slots) {
  if (!Object.hasOwn(slots, name)) return `has an unknown hook or field ${name}`;
  if (Object.hasOwn(dataChecks, name) && !object(hook)) return `${name} must be an object`;
  const at = hook?.at === null && !callback(hook) ? null : slotOf(hook);
  if (!slots[name].includes(at))
    return `${name} is at "${String(at)}", which the core never runs: use ${slots[name].join(", ")}`;
  if (Object.hasOwn(dataChecks, name)) return dataChecks[name](hook);
  if (callback(hook)) return null;
  if (!object(hook) || !callback(hook.run)) return `${name} needs a run function`;
  return unknownField(name, hook, ["at", "run"]);
}

export function featureRecordProblem(record, slots) {
  if (!object(record)) return "a record must be an object";
  const { key } = record;
  if (!fieldName(key)) return "a record has no valid key";
  for (const field of Reflect.ownKeys(record)) {
    if (typeof field !== "string") return `${key}: invalid symbol field ${String(field)}`;
    if (!Object.getOwnPropertyDescriptor(record, field).enumerable) return `${key}: hidden declaration "${field}"`;
  }
  const problem = recordFieldsProblem(record, slots);
  return problem ? `${key}: ${problem}` : null;
}

function recordFieldsProblem(record, slots) {
  if (
    (record.seen !== undefined || (record.metric !== undefined && !record.metric?.reportWhenEnabled)) &&
    !fieldName(record.seen)
  )
    return "metric or record has no seen flag";
  if (record.buildAt !== undefined && !["early", "afterSpawn"].includes(record.buildAt))
    return "has an unknown build position";
  for (const field of ["property", "calls"])
    if (!optional(record[field], fieldName)) return `${field} must be a valid World field name`;
  if (!optional(record.flag, queryFlag)) return "flag must be a lowercase query parameter name";
  if (!optional(record.defaultCount, (value) => Number.isSafeInteger(value) && value > 0))
    return "defaultCount must be a positive integer";
  if (!callback(record.build)) return "has no build function";
  if (!optional(record.buildFleet, callback)) return "buildFleet must be a function";
  for (const field of PREDICATES) if (!optional(record[field], callback)) return `${field} must be a function`;
  for (const field of CLOCK_FIELDS) if (!optional(record[field], boolean)) return `${field} must be a boolean`;
  if (record.priority !== undefined && (!Array.isArray(record.priority) || ![...record.priority].every(fieldName)))
    return "priority must contain candidate names";
  if (record.metric?.reportWhenEnabled === true) {
    if (record.seen !== undefined) return "metric.reportWhenEnabled cannot also use a seen flag";
    if (record.buildFleet) return "metric.reportWhenEnabled needs a World option";
    if (record.defaultCount !== undefined) return "metric.reportWhenEnabled needs a boolean option";
  }
  for (const field of DISPLAY_MAPS) {
    if (record[field] === undefined) continue;
    const problem = mapProblem(
      field,
      record[field],
      (value) => text(value) || (field === "eventBadges" && callback(value)),
    );
    if (problem) return problem;
  }
  if (record.snapshot !== undefined) {
    const problem = mapProblem("snapshot", record.snapshot, (value) => value !== undefined);
    if (problem) return problem;
  }
  if (record.obstacle !== undefined) {
    const problem = obstacleProblem(record.obstacle);
    if (problem) return problem;
  }
  if (record.coach !== undefined) {
    const problem = coachProblem(record.coach, record.seen);
    if (problem) return problem;
  }
  for (const [name, value] of Object.entries(record)) {
    if (FIELDS.has(name)) continue;
    const problem = hookProblem(name, value, slots);
    if (problem) return problem;
  }
  return null;
}

export function featureRegistryProblem(records, slots) {
  if (!Array.isArray(records)) return "records must be an array";
  const owners = new Map();
  for (const record of records) {
    const problem = featureRecordProblem(record, slots);
    if (problem) return problem;
    const { key, metric, notice } = record;
    const reserved = [
      ["option", key],
      ["query flag", record.flag ?? key.toLowerCase()],
      ["World field", record.property ?? key],
    ];
    for (const field of ["seen", "calls"]) if (record[field]) reserved.push(["World field", record[field]]);
    if (metric) {
      reserved.push(["metric", metric.name]);
      const marker = metric.eventType ?? metric.traceType;
      if (marker !== undefined) reserved.push(["replay marker", marker]);
    }
    for (const id of record.priority ?? []) reserved.push(["priority candidate", id]);
    for (const [field, entries] of Object.entries(record.coach ?? {})) {
      if (Object.hasOwn(COACH_SLOTS, field))
        for (const { at, order } of entries) reserved.push([`coach.${field} order`, `${at}/${order}`]);
    }
    if (notice) reserved.push(["notice order", `${notice.at ?? "end"}/${notice.order}`]);
    for (const field of ["snapshot", ...DISPLAY_MAPS])
      for (const name of Object.keys(record[field] || {})) reserved.push([field, name]);
    for (const [field, name] of reserved) {
      const entry = `${field}/${name}`;
      if (owners.has(entry)) return `${key}: ${field} "${name}" already belongs to ${owners.get(entry)}`;
      owners.set(entry, key);
    }
  }
  return null;
}
