import assert from "node:assert/strict";
import { test } from "node:test";

class Element {
  constructor(text = "") {
    this.text = text;
    this.children = [];
  }

  get textContent() {
    return this.text + this.children.map((child) => child.textContent).join("");
  }

  setAttribute() {}

  append(child) {
    this.children.push(child);
  }
}

globalThis.Node = Element;
globalThis.document = {
  querySelector: () => null,
  createElement: () => new Element(),
  createTextNode: (text) => new Element(text),
};
const { examine, examinerScript, instructionAt } = await import("../static/js/lab/examiner.js");
const { ROAD_TESTS, roadTestScenario, roadTestSpace } = await import("../static/js/lab/road-tests.js");
const { examinerSheet } = await import("../static/js/ui/road-test.js");
const { DriveReport } = await import("../static/js/ui/drive-report.js");
const { load } = await import("./drive_lab_maps.mjs");

const kits = ROAD_TESTS[0];
const arrived = {
  status: "arrived",
  parking: { result: "parked", within_kerb: true },
  collisions: 0,
  red_lights: 0,
  stop_signs: 0,
  failed_to_yield: 0,
  off_road_s: 0,
  resets: 0,
};
const route = () => ({
  turns: [{ dir: "left", street: "A Street", at_m: 300 }],
  controls: [],
  edges: ["a", "b"],
  laneShifts: () => [{ at: 220, by: -3 }],
  length: 500,
});
const event = (type, at_s = 8) => ({ type, at_s, at_m: 10, message: "Incident" });

test("authored setup diagnoses missing or unusable parking and start geometry", () => {
  assert.throws(() => roadTestSpace({ edges: new Map() }, kits), /road-test-kitsilano parking edge .* missing/);
  assert.throws(() => roadTestScenario({}, { ...kits, edges: [] }), /needs an authored edge chain/);
  const map = load(kits.map);
  assert.throws(() => roadTestScenario(map, { ...kits, startS: -1 }), /starts outside its first lane/);
  assert.throws(() => roadTestScenario(map, { ...kits, startS: Infinity }), /starts outside its first lane/);
});
test("all-way stop prompt specifies where to stop and when to go straight", () => {
  const data = {
    ...route(),
    controls: [{ turn: "straight", sRoute: 100, control: { type: "stop", all_way: true } }],
  };
  assert.match(
    examinerScript(data).find((line) => line.kind === "straight").text,
    /behind the line.*your turn.*straight/,
  );
});
test("stop-controlled turn prompt includes the full stop and yield", () => {
  const data = {
    ...route(),
    controls: [{ edge: "a", turn: "left", sRoute: 300, control: { type: "stop" } }],
    map: {
      edges: new Map([
        ["a", { id: "a", name: "B Street" }],
        ["b", { id: "b", name: "A Street" }],
      ]),
      turnAngle: () => 1,
      classifyTurn: () => "left",
    },
  };
  assert.match(
    examinerScript(data).find((line) => line.kind === "turn").text,
    /behind the line, yield, then turn left/,
  );
});
test("uncontrolled turn and lane-shift prompts identify the next action", () => {
  const script = examinerScript(route());
  assert.match(script.find((line) => line.kind === "turn").text, /At the next junction, turn left onto A Street/);
  assert.match(script.find((line) => line.kind === "lane").text, /mirror and blind spot, then signal/);
});
test("prompt lookup handles unsorted and nonfinite progress inputs", () => {
  const script = [
    { from: 0, at: 99 },
    { from: 0, at: 10 },
    { from: 0, at: 12 },
  ];
  assert.equal(instructionAt(script, 8)?.at, 10);
  assert.equal(instructionAt(script, Infinity), null);
  assert.equal(instructionAt(script, NaN), null);
});
test("the examiner describes the failure and uses the matching recorded incident", () => {
  for (const [counter, value, type, wording] of [
    ["simulation_error", "internal error", null, /simulator stopped/],
    ["amber_lights_run", 1, null, /room to stop safely/],
    ["bus_lane_driving", 2, null, /outside the permitted turn approach/],
    ["plow_right_passes", 1, "plow_right_pass", /throws snow and debris/],
    ["merge_cut_ins", 1, "merge_cut_in", /whose turn it was/],
    ["close_passes", 1, "close_pass", /cyclist/],
  ]) {
    const incidents = [event("kerb", 1), ...(type ? [event(type, 2)] : [])];
    const result = examine(kits, { ...arrived, [counter]: value, incidents });
    assert.equal(result.pass, false);
    assert.match(result.fails[0].remark, wording);
    assert.equal(result.fails[0].incident?.at_s ?? null, type ? 2 : null);
  }
});
test("old or malformed incident streams cannot make the examiner sheet unreadable", () => {
  for (const incidents of [null, { type: "hard_brake" }, "hard_brake", [null, undefined, true]]) {
    const result = examine(kits, { ...arrived, incidents });
    assert.equal(result.available, true);
    assert.equal(result.pass, true);
  }
  const result = examine(kits, {
    ...arrived,
    collisions: 1,
    incidents: [null, event("constructor"), event("collisions", 12), { type: ["late_stop"] }, { type: "late_stop" }],
  });
  assert.equal(result.fails[0].incident.at_s, 12);
  assert.equal(result.demerits, 1);
  assert.equal(result.minors[0].remark, "Late stop");
});
test("sheet tells automatic failures apart from demerit-only failures", () => {
  const node = examinerSheet(
    kits,
    {
      ...arrived,
      speeding_s: 9,
      close_following_s: 12,
      incidents: Array.from({ length: 3 }, () => event("lane_position")).concat(
        Array.from({ length: 3 }, () => event("turn_no_signal")),
      ),
    },
    () => new Element("Replay"),
  );
  assert.match(node.textContent, /0 automatic failures · 12 of 10 demerits allowed/);
  assert.match(node.textContent, /speeding or following too closely can add up to three demerits each/);
});
test("sheet spells out demerits in a category that also has a failure", () => {
  const node = examinerSheet(
    kits,
    { ...arrived, red_lights: 1, incidents: [event("turn_no_signal")] },
    () => new Element("Replay"),
  );
  assert.match(node.textContent, /1 fail · 1 demerit/);
});
test("debrief distinguishes a simulation interruption from parking success", () => {
  const debrief = (report) => DriveReport.prototype.debrief(kits, report).textContent;
  assert.match(debrief(arrived), /Parked within 30 cm of the kerb/);
  assert.match(debrief({ ...arrived, status: "finished", simulation_error: "internal error" }), /simulator stopped/);
});

// Additional bounds and grouping checks.
test("two prompts with the same route distance preserve authored order", () => {
  const script = [
    { from: 2, at: 5, text: "first" },
    { from: 0, at: 5, text: "second" },
  ];
  assert.equal(instructionAt(script, 2)?.text, "first");
  assert.equal(instructionAt(script, 1)?.text, "second");
});
test("an examiner prompt expires after the five-metre grace distance", () => {
  const script = [{ from: 0, at: 90 }];
  assert.equal(instructionAt(script, 95)?.at, 90);
  assert.equal(instructionAt(script, 95.001), null);
});
test("an older unrelated incident cannot become an unknown failure's replay link", () => {
  const result = examine(kits, { ...arrived, status: "finished", incidents: [{ message: "Legacy note", at_s: 1 }] });
  assert.equal(result.fails[0].reason, "timeout");
  assert.equal(result.fails[0].incident, null);
});
