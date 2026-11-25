// Malformed internal laws are simulation errors. Let the drive fail with the candidate id and
// field path before a broken prediction can be offered to a driver or reach the controller.
const LAW_KINDS = new Set(["lane", "hard_brake", "steer", "reverse", "turnaround", "park"]);
const TURN_PHASES = new Set(["forward", "reverse", "out", "stuck"]);
const PARK_PHASES = {
  in: new Set(["start", "align", "settle", "in1", "back", "in2", "square", "shuffle", "parked", "stuck"]),
  out: new Set(["out_back", "out_wait", "out1", "out2", "out3", "done"]),
};
const record = (x) => !!x && typeof x === "object" && !Array.isArray(x);
const id = (x) => typeof x === "string" && x.trim() !== "";
const finite = Number.isFinite;
const nonnegative = (x) => finite(x) && x >= 0;
const fraction = (x) => nonnegative(x) && x <= 1;
const positive = (x) => finite(x) && x > 0;
const count = (x) => Number.isInteger(x) && x >= 0;
const direction = (x) => x === -1 || x === 1;
const point = (x) => Array.isArray(x) && x.length === 2 && finite(x[0]) && finite(x[1]);
const unboundedDistance = (x) => finite(x) || x === Infinity;

const OPTIONAL_NUMBERS = {
  offset: finite,
  center: finite,
  lane: Number.isInteger,
  laneIdx: count,
  s0: finite,
  stopAt: finite,
  stopAtRoute: finite,
  stopDecel: nonnegative,
  stopReaction: nonnegative,
};
const TURN_FIELDS = {
  id,
  sTurn: finite,
  psiOut: finite,
  side: direction,
  outLo: count,
  outHi: count,
  legs: count,
  travelled: nonnegative,
};
const PARK_FIELDS = {
  id,
  ox: finite,
  oy: finite,
  h: finite,
  kerbW: finite,
  R: positive,
  phi1: nonnegative,
  backU: finite,
  frontU: finite,
  legs: count,
  travelled: nonnegative,
};
const SIM_FIELDS = {
  max_accel: nonnegative,
  max_decel: nonnegative,
  max_lateral_accel: nonnegative,
  min_clearance_m: unboundedDistance,
  end_speed: finite,
  progress_m: finite,
  lane_err_end: finite,
  heading_err_deg: finite,
  off_road_fraction: fraction,
  min_gap_m: unboundedDistance,
  end: point,
};

function checkFields(object, checks, field, fail, optional = false) {
  for (const [name, valid] of checks) {
    const value = object[name];
    if (optional && value == null) continue;
    if (!valid(value)) fail(`${field}.${name}`);
  }
}
const optionalNumbers = Object.entries(OPTIONAL_NUMBERS);
const turnFields = Object.entries(TURN_FIELDS);
const parkFields = Object.entries(PARK_FIELDS);
const simFields = Object.entries(SIM_FIELDS);

function validateLaw(law, fail) {
  if (!record(law)) fail("law");
  if (!LAW_KINDS.has(law.kind)) fail("law.kind");
  if (law.kind !== "hard_brake" && law.kind !== "reverse" && !nonnegative(law.vTarget)) fail("law.vTarget");
  if (law.kind === "steer" && !finite(law.steer)) fail("law.steer");
  if (law.kind === "reverse" && law.target != null && !point(law.target)) fail("law.target");
  checkFields(law, optionalNumbers, "law", fail, true);
  if (law.shift != null) {
    if (!record(law.shift)) fail("law.shift");
    if (!finite(law.shift.from)) fail("law.shift.from");
    if (!finite(law.shift.start)) fail("law.shift.start");
    if (!positive(law.shift.len)) fail("law.shift.len");
  }
  if (law.detour != null) {
    const d = law.detour;
    if (!record(d)) fail("law.detour");
    if (!(finite(d.from) && finite(d.full) && finite(d.back) && finite(d.to))) fail("law.detour bounds");
    if (!(d.from <= d.full && d.full <= d.back && d.back <= d.to)) fail("law.detour order");
    if (!finite(d.shift)) fail("law.detour.shift");
  }
  if (law.slowTo != null) {
    if (!Array.isArray(law.slowTo)) fail("law.slowTo");
    for (const [index, slow] of law.slowTo.entries()) {
      if (!record(slow)) fail(`law.slowTo[${index}]`);
      if (!finite(slow.from) || !finite(slow.to) || slow.from > slow.to) fail(`law.slowTo[${index}] bounds`);
      if (!nonnegative(slow.mps)) fail(`law.slowTo[${index}].mps`);
    }
  }
  if (law.kind === "turnaround") {
    if (!TURN_PHASES.has(law.phase)) fail("law.phase");
    checkFields(law, turnFields, "law", fail);
    if (law.outHi <= law.outLo) fail("law.outHi range");
  }
  if (law.kind === "park") {
    if (!Object.hasOwn(PARK_PHASES, law.mode)) fail("law.mode");
    if (!PARK_PHASES[law.mode].has(law.phase)) fail("law.phase");
    checkFields(law, parkFields, "law", fail);
    if (law.frontU < law.backU) fail("law parking bounds");
    if (law.mode === "in") {
      if (!finite(law.goalU) || !finite(law.goalW)) fail("law parking goal");
      if (!finite(law.startU)) fail("law.startU");
    } else {
      if (!finite(law.laneW) || !finite(law.startW)) fail("law pull-out lateral frame");
      if (!finite(law.endU)) fail("law.endU");
    }
  }
}

export function assertCandidateBatch(candidates) {
  if (!Array.isArray(candidates)) throw new TypeError("Candidate batch must be an array");
  const seen = new Set();
  for (const [index, candidate] of candidates.entries()) {
    if (!record(candidate) || !id(candidate.id)) throw new TypeError(`Candidate at index ${index} needs an id`);
    if (seen.has(candidate.id)) throw new Error(`Duplicate candidate id: ${candidate.id}`);
    seen.add(candidate.id);
    const fail = (field) => {
      throw new TypeError(`Candidate ${candidate.id} has invalid ${field}`);
    };
    validateLaw(candidate.law, fail);
    if (candidate.laneUntil != null && !unboundedDistance(candidate.laneUntil)) fail("laneUntil");
    if (candidate.laneTarget != null && !nonnegative(candidate.laneTarget)) fail("laneTarget");
  }
}

export function assertPrediction(candidate) {
  const fail = (field) => {
    throw new TypeError(`Candidate ${candidate.id} has invalid prediction ${field}`);
  };
  if (!record(candidate.sim)) fail("sim");
  checkFields(candidate.sim, simFields, "sim", fail);
}
