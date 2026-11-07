// Run on /tests: await import('/tests/practice-tests.js').then(m => m.runPracticeTests()).
// Mount a minimal HUD fixture; manual-progress fixtures never write to browser storage.
import { DriveLab } from "../js/ui/lab.js";
import { DriveReport } from "../js/ui/drive-report.js";
import { CHALLENGES, challengeConfig } from "../js/lab/challenges.js";
import { readPractice, practiceStatus } from "../js/lab/practice.js";

export async function runPracticeTests() {
  const results = [], check = (name, ok) => results.push({ name, ok: !!ok });
  const fixture = document.createElement("div");
  fixture.innerHTML = '<div class="hud-top-left"></div><div id="hud-right"></div><div id="hud-left"></div><div id="settings"></div>';
  document.body.prepend(fixture);
  const noop = () => {}, previousFocus = document.activeElement;
  let lab, driveReport;
  const completed = CHALLENGES[0], attempted = CHALLENGES.find(c => c.id === "rain-crossing");
  const record = (challenge, clean) => ({ version: challenge.version || 1, attempts: 1, completed: clean,
    best_score: clean ? 95 : null, last_at: "2026-11-07T10:00:00Z" });
  const authoredLink = (anchor, challenge, driver) => {
    if (!anchor || anchor.tagName !== "A") return false;
    const url = new URL(anchor.href), expected = challengeConfig(challenge);
    return url.searchParams.get("drive") === driver
      && ["challenge", "map", "seed", "weather", "time", "traffic", "car", "clock"]
        .every(key => url.searchParams.get(key) === String(expected[key]));
  };
  try {
    lab = new DriveLab({ city: { city: "Vancouver" }, demo: true, onScenic: noop, onPause: noop,
      onSeek: noop, onBranch: noop, onLive: noop, onAgent: noop, onPerception: noop });
    lab.practice = { records: { [completed.id]: record(completed, true), [attempted.id]: record(attempted, false) }, available: false };
    lab.home();
    check("Practice library welcome count follows the authored catalog", lab.dialog.textContent.includes(`${CHALLENGES.length} authored challenges`)
      && !lab.dialog.textContent.includes("Six authored challenges"));
    lab.challenges();
    const cards = () => [...lab.dialog.querySelectorAll(".challenge-card")];
    const control = label => lab.dialog.querySelector(`[aria-label="${label}"]`);
    const search = () => control("Search challenges");
    const type = value => { search().value = value; search().dispatchEvent(new Event("input", { bubbles: true })); };
    const choose = (label, value) => { const node = control(`Filter by ${label}`); node.value = value; node.dispatchEvent(new Event("change", { bubbles: true })); };
    const clear = () => lab.dialog.querySelector(".challenge-library-actions button").click();
    check("Practice library initially exposes every challenge and clean completion count", cards().length === CHALLENGES.length
      && lab.dialog.querySelector(".challenge-results").textContent === `${CHALLENGES.length} of ${CHALLENGES.length} challenges · 1 completed cleanly by you`);
    check("Practice library badges distinguish manual attempts and clean completions", lab.dialog.querySelector(`[data-challenge="${completed.id}"] .practice-completed`)?.textContent === "Completed cleanly"
      && lab.dialog.querySelector(`[data-challenge="${attempted.id}"] .practice-attempted`)?.textContent === "Attempted"
      && lab.dialog.querySelector(`[data-challenge="${attempted.id}"] strong`)?.textContent === "Retry challenge →");
    check("Practise next prioritizes an attempted challenge before an untried one", authoredLink(lab.dialog.querySelector(".challenge-next"), attempted, "manual"));
    check("Challenge cards are authored manual links", cards().every(anchor => authoredLink(anchor, CHALLENGES.find(c => c.id === anchor.dataset.challenge), "manual")));
    lab.challengeDriver.value = "rules"; lab.challengeDriver.dispatchEvent(new Event("change", { bubbles: true }));
    check("Changing the challenge driver updates card and next links", cards().every(anchor => authoredLink(anchor, CHALLENGES.find(c => c.id === anchor.dataset.challenge), "rules"))
      && authoredLink(lab.dialog.querySelector(".challenge-next"), attempted, "rules"));
    check("City filters group Vancouver neighbourhoods once", [...control("Filter by city").options].filter(option => option.value === "Vancouver").length === 1);
    const input = search(); input.focus(); type("mOnTrÉaL");
    // Search includes lessons: Calgary's right-on-red lesson also discusses Montréal.
    const montrealIds = CHALLENGES.filter(c => c.map === "montreal" || c.id === "right-on-red").map(c => c.id).sort().join();
    const foundIds = () => cards().map(anchor => anchor.dataset.challenge).sort().join();
    check("Practice search ignores case while preserving its node and focus", foundIds() === montrealIds
      && search() === input && document.activeElement === input && input.value === "mOnTrÉaL");
    type("montreal");
    check("Practice search finds accented cities and lesson references without typing accents", foundIds() === montrealIds);
    choose("city", "Montréal"); choose("skill", attempted.difficulty); choose("weather", attempted.weather); choose("progress", "attempted");
    check("Practice search, city, skill, weather and progress filters combine", cards().length === 1 && cards()[0].dataset.challenge === attempted.id);
    lab.dialog.close(); await new Promise(resolve => setTimeout(resolve, 0)); lab.challenges();
    check("Reopening the library preserves search and filter choices", search().value === "montreal" && control("Filter by city").value === "Montréal"
      && control("Filter by skill").value === attempted.difficulty && control("Filter by weather").value === attempted.weather
      && control("Filter by progress").value === "attempted" && cards().length === 1);
    type("no matching challenge qvzt");
    check("Empty challenge searches expose recovery and hide stale next links", cards().length === 0
      && !lab.dialog.querySelector(".challenge-empty").hidden && lab.dialog.querySelector(".challenge-next").hidden
      && !lab.dialog.querySelector(".challenge-next").hasAttribute("href"));
    lab.dialog.querySelector(".challenge-empty button").click();
    check("Clearing empty-search filters restores the catalog and search focus", cards().length === CHALLENGES.length
      && [...lab.dialog.querySelectorAll(".challenge-filters input, .challenge-filters select")].every(node => node.value === "")
      && document.activeElement === search() && lab.dialog.querySelector(".challenge-empty").hidden);
    choose("progress", "completed");
    check("Completed progress filter shows only clean manual completions", cards().length === 1 && cards()[0].dataset.challenge === completed.id);
    clear();
    check("Challenge result counts announce changes to assistive technology", lab.dialog.querySelector(".challenge-results")?.getAttribute("role") === "status"
      && lab.dialog.querySelector(".challenge-results")?.getAttribute("aria-live") === "polite");
    lab.dialog.close();

    driveReport = new DriveReport({ onFinish: noop, onNewDrive: noop });
    const report = { title: completed.title, map: completed.map, driver: "rules", status: "arrived", qualified: true,
      score: 95, grade: "A", distance_m: 200, elapsed_s: 30, max_kmh: 40, categories: { safety: 100, legality: 100, comfort: 90, control: 100 },
      tips: ["Keep scanning ahead."], incidents: [], started_at: "2026-11-07T10:00:00Z",
      config: { ...challengeConfig(completed), seed: 9999, weather: "snow", car: "sport" }, practice: { outcome: null, saved: false } };
    driveReport.show(report);
    const links = () => [...driveReport.dialog.querySelectorAll("a")];
    const retry = links().find(anchor => anchor.textContent === "Retry manually");
    check("Report retry restores authored conditions and manual driving after an AI drive", authoredLink(retry, completed, "manual"));
    const next = links().find(anchor => anchor.textContent.startsWith("Practise next:"));
    const records = readPractice().records;
    const remaining = CHALLENGES.some(c => c.id !== completed.id && practiceStatus(c, records) !== "completed");
    const nextChallenge = next && CHALLENGES.find(c => c.id === new URL(next.href).searchParams.get("challenge"));
    check("Report next links select remaining authored manual practice", remaining
      ? !!nextChallenge && nextChallenge.id !== completed.id && practiceStatus(nextChallenge, records) !== "completed" && authoredLink(next, nextChallenge, "manual")
      : !next);
    check("AI reports explain their separation from manual practice", driveReport.dialog.querySelector(".challenge-practice-note")?.textContent.includes("do not change your manual practice progress"));
    driveReport.show({ ...report, driver: "manual", practice: { outcome: "attempted", saved: false } });
    check("Unsaved manual reports explain retry and storage failure", driveReport.dialog.querySelector(".challenge-practice-note")?.textContent.includes("Retry for a clean arrival")
      && driveReport.dialog.querySelector(".challenge-practice-note")?.textContent.includes("could not be saved"));
  } finally {
    lab?.dialog.close(); lab?.dialog.remove(); lab?.replay.remove();
    driveReport?.dialog.close(); driveReport?.dialog.remove();
    fixture.remove();
    if (previousFocus?.isConnected) previousFocus.focus();
  }
  return results;
}
