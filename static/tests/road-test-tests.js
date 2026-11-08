// Run on /tests: await import('/tests/road-test-tests.js').then(m => m.runRoadTestTests()).
// The Road tests section of the lab library, the examiner's directions in the HUD and the examiner's
// sheet in the drive report. Fixtures never write to browser storage.
import { DriveLab } from "../js/ui/lab.js";
import { DriveReport } from "../js/ui/drive-report.js";
import { ExaminerPrompt } from "../js/ui/road-test.js";
import { challengeConfig, challengeById } from "../js/lab/challenges.js";
import { ROAD_TESTS } from "../js/lab/road-tests.js";
import { ROAD_TEST_KEY } from "../js/lab/practice.js";

export async function runRoadTestTests() {
  const results = [], check = (name, ok, detail) => results.push({ name, ok: !!ok, ...(detail ? { detail } : {}) });
  const fixture = document.createElement("div");
  fixture.innerHTML = '<div class="hud-top-left"></div><div id="hud-right"></div><div id="hud-left"></div><div id="settings"></div>';
  document.body.prepend(fixture);
  const noop = () => {}, before = localStorage.getItem(ROAD_TEST_KEY);
  let lab, driveReport;
  const authoredLink = (anchor, test, driver) => {
    if (!anchor || anchor.tagName !== "A") return false;
    const url = new URL(anchor.href), expected = challengeConfig(test);
    return url.searchParams.get("drive") === driver && ["challenge", "map", "seed", "weather", "time", "traffic", "car", "clock"].every(key => url.searchParams.get(key) === String(expected[key]));
  };
  try {
    const kits = ROAD_TESTS[0];
    localStorage.setItem(ROAD_TEST_KEY, JSON.stringify({ [kits.id]: { version: kits.version, attempts: 2, passes: 1,
      best: { pass: true, demerits: 3, fails: 0, at: "2026-11-07T10:00:00Z" }, last_at: "2026-11-07T11:00:00Z" } }));
    lab = new DriveLab({ city: { city: "Vancouver" }, demo: true, onScenic: noop, onPause: noop, onSeek: noop, onBranch: noop, onLive: noop, onAgent: noop, onPerception: noop });
    lab.challenges();
    const cards = () => [...lab.dialog.querySelectorAll(".road-test-card")];
    check("The lab library has a Road tests section beside the challenges", lab.dialog.querySelector("#road-tests-heading")?.textContent === "Road tests"
      && cards().length === ROAD_TESTS.length && lab.dialog.querySelectorAll(".challenge-card").length > 0);
    check("Road test cards are authored manual links, by style and province", cards().every(a => authoredLink(a, challengeById(a.dataset.roadTest), "manual"))
      && cards().some(a => a.textContent.includes("Class 5-style road test")) && cards().some(a => a.textContent.includes("G2-style road test")));
    check("A road test card shows the best manual attempt and its status", lab.dialog.querySelector(`[data-road-test="${kits.id}"] .practice-completed`)?.textContent === "Passed"
      && lab.dialog.querySelector(`[data-road-test="${kits.id}"] .road-test-best`)?.textContent === "Best: Pass · 3 demerits"
      && lab.dialog.querySelector(`[data-road-test="${ROAD_TESTS[1].id}"] .practice-untried`)?.textContent === "Untried");
    lab.challengeDriver.value = "rules"; lab.challengeDriver.dispatchEvent(new Event("change", { bubbles: true }));
    check("Changing the driver lets an AI take the road test", cards().every(a => authoredLink(a, challengeById(a.dataset.roadTest), "rules")));
    lab.dialog.close();

    // the examiner's directions, along a straight stand-in route
    const pts = Array.from({ length: 301 }, (_, i) => [i, 0]), cum = pts.map((_, i) => i);
    const route = { pts, cum, length: 300, edges: [], turns: [], controls: [{ sRoute: 120, turn: "straight", control: { type: "stop", all_way: false } }],
      zoneMarks: [], laneShifts: () => [], map: null };
    const prompt = new ExaminerPrompt(kits, route), at = x => { prompt.lastUpdate = -Infinity; prompt.update({ ego: { x, y: 0 } }, null, 0); return prompt.text.textContent; };
    check("The examiner's directions start the test", at(0).startsWith("When you're ready"));
    check("The examiner announces the stop sign ahead before it", at(60) === "At the stop sign, come to a complete stop, then carry straight on.");
    check("The examiner asks for parking near the end", at(200).startsWith("Pull up on the right and parallel park"));
    check("Directions announce politely to assistive technology", prompt.text.getAttribute("aria-live") === "polite" && prompt.element.textContent.includes(kits.style));
    prompt.lastUpdate = -Infinity; prompt.update({ ego: { x: 280, y: 0 } }, { finished: "arrived" }, 0);
    check("The examiner ends the test once the drive is over", prompt.text.textContent.startsWith("That's the end of the test"));

    // the examiner's sheet
    driveReport = new DriveReport({ onFinish: noop, onNewDrive: noop });
    const report = { title: kits.title, map: kits.map, driver: "manual", status: "arrived", qualified: true, score: 90, grade: "A", distance_m: 1600, elapsed_s: 250, max_kmh: 50,
      categories: { safety: 100, legality: 100, comfort: 90, control: 100 }, tips: ["Keep scanning ahead."], started_at: "2026-11-07T12:00:00Z",
      config: challengeConfig(kits), branched: false, modified: false, collisions: 0, red_lights: 0, stop_signs: 0, failed_to_yield: 0, off_road_s: 0, resets: 0,
      speeding_s: 0, zone_speeding_s: 0, close_following_s: 0, danger_s: 0, hard_brakes: 1, practice: { outcome: "passed", saved: true },
      parking: { result: "parked", kerb_m: 0.14, angle_deg: 0.1, within_kerb: true, legs: 3, kerb_strikes: 0 },
      incidents: [{ type: "hard_brake", message: "Hard braking", at_s: 20, at_m: 200 }, { type: "turn_no_signal", message: "No signal for the left turn onto Larch Street", at_s: 54, at_m: 391 }] };
    const sheet = () => driveReport.dialog.querySelector(".examiner-sheet");
    driveReport.show(report);
    check("A road test report shows the examiner's sheet instead of the challenge debrief", sheet() && !driveReport.dialog.querySelector(".challenge-debrief:not(.examiner-sheet)")
      && sheet().querySelector(".examiner-verdict")?.textContent === "Pass" && sheet().dataset.result === "pass");
    check("The sheet lists every category with its count", sheet().querySelectorAll(".examiner-category").length === 7
      && sheet().querySelector('[data-category="speed"] .examiner-count')?.textContent === "1 demerit"
      && sheet().querySelector('[data-category="right_of_way"]')?.textContent.includes("No signal for the left turn onto Larch Street")
      && sheet().querySelector('[data-category="observation"] .examiner-count')?.textContent === "0");
    check("The sheet's summary counts violations and demerits against the allowance", sheet().querySelector(".examiner-summary")?.textContent === `0 dangerous actions or violations · 2 of ${kits.maxDemerits} demerits allowed`);
    check("A recorded manual road test notes the result and the best attempt", driveReport.dialog.querySelector(".challenge-practice-note")?.textContent.includes("Manual road test passed and recorded")
      && driveReport.dialog.querySelector(".challenge-practice-note")?.textContent.includes("Your best: Pass · 3 demerits"));
    let replayIndex = null;
    driveReport.onReplay = index => { replayIndex = index; };
    driveReport.getReplayTarget = (r, incident) => !incident || incident.at_s === 54 ? 7 : null;
    driveReport.show(report);
    const rewind = sheet().querySelector('[data-category="right_of_way"] .incident-replay');
    check("Examiner remarks reuse the report's rewind links, and expired ones explain why", !!rewind
      && sheet().querySelector('[data-category="speed"] .incident-replay-unavailable')?.textContent.includes("outside the current recording"));
    rewind?.click();
    check("A remark's rewind link seeks the recording before the event", replayIndex === 7 && !driveReport.dialog.open);
    driveReport.show({ ...report, red_lights: 1, incidents: [...report.incidents, { type: "red_lights_run", message: "Red light", at_s: 80, at_m: 600, count: 1 }], practice: { outcome: "failed", saved: true } });
    check("A violation fails the test, in its category", sheet().querySelector(".examiner-verdict")?.textContent === "Fail" && sheet().dataset.result === "fail"
      && sheet().querySelector('[data-category="right_of_way"] .examiner-remark.fail')?.textContent.includes("Entered the junction on a red light"));
    driveReport.show({ ...report, driver: "rules", practice: { outcome: null, saved: false } });
    check("AI road tests are marked but kept apart from manual attempts", sheet()?.querySelector(".examiner-verdict")?.textContent === "Pass"
      && driveReport.dialog.querySelector(".challenge-practice-note")?.textContent.includes("not recorded as your road test attempts"));
    driveReport.show({ ...report, off_road_s: undefined });
    check("Saved reports without audit counters cannot be marked", sheet()?.querySelector(".challenge-verdict")?.textContent === "Result unavailable");
  } finally {
    if (before === null) localStorage.removeItem(ROAD_TEST_KEY); else localStorage.setItem(ROAD_TEST_KEY, before);
    lab?.dialog.close(); lab?.dialog.remove(); lab?.replay.remove();
    driveReport?.dialog.close(); driveReport?.dialog.remove();
    fixture.remove();
  }
  return results;
}
