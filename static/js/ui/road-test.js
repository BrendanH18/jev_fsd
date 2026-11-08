// Road test UI (lab/road-tests.js): the examiner's directions in the HUD while the test is driven, and
// the examiner's sheet in the drive report (ui/drive-report.js), which reuses the report's incident rows
// and their rewind links.
import { h } from "../common.js";
import { projectPoint } from "../map/mapdata.js";
import { examine, examinerScript, instructionAt } from "../lab/examiner.js";
import { readRoadTests, roadTestRecord } from "../lab/practice.js";

const DONE = "That's the end of the test. Select Finish & review, or wait for the report, to see the examiner's sheet.";

export class ExaminerPrompt {
  constructor(test, route) {
    this.route = route; this.script = route ? examinerScript(route) : []; this.hint = null; this.lastUpdate = -Infinity;
    this.element = h("div", { class: "challenge-banner road-test-banner" },
      h("strong", {}, `${test.title} · ${test.style}`),
      h("span", { class: "label" }, "EXAMINER"),
      this.text = h("p", { class: "examiner-instruction", role: "status", "aria-live": "polite" }, this.script[0]?.text || "Follow the road ahead."));
  }

  update(world, drive, now = performance.now()) {
    if (now - this.lastUpdate < 250 || !this.route) return;
    this.lastUpdate = now;
    let text;
    if (drive?.finished) text = DONE;
    else {
      const p = projectPoint(this.route.pts, this.route.cum, [world.ego.x, world.ego.y], this.hint);
      this.hint = p && p.distance < 15 ? p.index : null;
      text = !p || p.distance >= 15 ? "Return to the route: follow the highlighted line." : instructionAt(this.script, p.s)?.text || "Follow the road ahead.";
    }
    if (this.text.textContent !== text) this.text.textContent = text;
  }
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// The examiner's sheet for a road test report. `incidentRow(incident)` is the drive report's row, with
// its rewind link where the event is still in the recording.
export function examinerSheet(test, report, incidentRow) {
  const sheet = examine(test, report);
  if (!sheet.available) return h("section", { class: "challenge-debrief examiner-sheet", "aria-label": "Examiner's sheet" },
    h("span", { class: "label" }, `EXAMINER'S SHEET · ${test.style.toUpperCase()}`), h("strong", { class: "challenge-verdict" }, "Result unavailable"),
    h("p", {}, "This saved report does not contain enough information to mark the test."));
  const summary = `${sheet.fails.length} dangerous ${sheet.fails.length === 1 ? "action or violation" : "actions or violations"} · ${sheet.demerits} of ${sheet.max_demerits} demerits allowed`;
  return h("section", { class: "challenge-debrief examiner-sheet", "aria-label": "Examiner's sheet", "data-result": sheet.pass ? "pass" : "fail" },
    h("span", { class: "label" }, `EXAMINER'S SHEET · ${test.style.toUpperCase()}`),
    h("strong", { class: `challenge-verdict examiner-verdict${sheet.pass ? " clean" : ""}` }, sheet.pass ? "Pass" : "Fail"),
    h("p", { class: "examiner-summary" }, summary),
    h("p", { class: "muted" }, "Any dangerous action or violation fails the test. Minor errors are one demerit each; a repeated one is marked at most three times."),
    h("ol", { class: "examiner-categories" }, sheet.categories.map(c => h("li", { class: "examiner-category", "data-category": c.key },
      h("div", { class: "examiner-category-head" }, h("span", {}, c.label),
        h("b", { class: c.fails ? "examiner-count fail" : c.demerits ? "examiner-count minor" : "examiner-count" },
          c.fails ? `${plural(c.fails, "fail")}${c.demerits ? ` · ${c.demerits}` : ""}` : c.demerits ? plural(c.demerits, "demerit") : "0")),
      c.remarks.length ? h("ul", { class: "examiner-remarks" }, c.remarks.map(r => h("li", { class: `examiner-remark ${r.kind}` },
        h("span", { class: "examiner-mark" }, r.kind === "fail" ? "FAIL" : `−${r.points}`), h("span", {}, r.remark),
        r.incident ? h("ol", { class: "report-events examiner-events" }, incidentRow(r.incident)) : null))) : null))),
    h("h3", {}, "The examiner's advice"), h("p", { class: "challenge-lesson" }, test.lesson),
    report.config?.version !== (test.version || 1) ? h("p", { class: "muted" }, "This report used an earlier version of the test; it is marked with the current examiner.") : null);
}

// The practice note under a road test report: this attempt, and the best eligible manual attempt.
export function roadTestNote(test, report) {
  const best = roadTestRecord(test, readRoadTests().records)?.best;
  const outcome = report.practice?.outcome;
  return [outcome === "passed" ? "Manual road test passed and recorded." : outcome === "failed" ? "Manual road test recorded. Retry to pass."
    : "AI, mixed-driver, modified and replay drives are not recorded as your road test attempts.",
  best ? ` Your best: ${best.pass ? "Pass" : "Fail"} · ${plural(best.demerits, "demerit")} (${new Date(best.at).toLocaleDateString()}).` : ""].join("");
}
