import { showDrive } from "./published-replay.js";
import { describe } from "./hud.js";
import { $, h, appUrl } from "../common.js";
import { CHALLENGES, challengeConfig } from "../lab/challenges.js";
import { driveLink } from "../lab/share.js";
import { agentDefinitions, registerAgent, agentOptionLabel } from "../brain/registry.js";
import { replayPosition } from "../lab/playback.js";
import {
  challengeCity,
  challengeNeighbourhood,
  challengeProvince,
  exportPracticeBackup,
  filterChallenges,
  importPracticeBackup,
  practiceStatus,
  readPractice,
  readRoadTests,
  resetPractice,
  roadTestRecord,
  roadTestStatus,
} from "../lab/practice.js";
import { ROAD_TESTS } from "../lab/road-tests.js";

const PRACTICE_LABELS = { untried: "Untried", attempted: "Attempted", completed: "Completed cleanly" };
const ROAD_TEST_LABELS = { untried: "Untried", attempted: "Not yet passed", passed: "Passed" };
// Challenges where committed model runs in data/results.json failed.
const AI_FAILED_CHALLENGES = {
  flagger: "Claude Haiku 5.5 failed this challenge on the open track",
  "on-your-bumper": "Claude Haiku 5.5 failed this challenge on the guarded track",
  "double-parked": "DeepSeek V4.1 Flash failed this challenge on the guarded track",
};
// Numeric positions preserve the display order when a registered feature supplies a line.
const PERCEPTION_FIELDS = [
  [5, "emergency", "Emergency"],
  [6, "bus", "Bus"],
  [7, "crosswalk", "Crosswalk"],
  [8, "school", "School bus"],
  [9, "streetcar", "Streetcar"],
  [10, "crossing", "Rail crossing"],
  [11, "box", "Junction box"],
  [12, "workZone", "Work zone"],
  [13, "closure", "Lane closure"],
  [16, "scramble", "Scramble"],
  [17, "plow", "Snow plow"],
  [18, "cyclist", "Cyclist"],
  [29, "blind", "Blind spot"],
  [30, "lane", "Lane"],
  [32, "zone", "Zone"],
];

export class DriveLab {
  constructor({
    city,
    demo,
    agentNote = "",
    onScenic,
    onPause,
    onSeek,
    onBranch,
    onLive,
    onAgent,
    onPerception,
    onConnectModel,
  }) {
    Object.assign(this, { onSeek, onBranch, onLive, onAgent });
    this.dialog = h("dialog", { class: "lab-dialog", "aria-label": "Drive lab" });
    this.dialog.addEventListener("click", (ev) => {
      if (ev.target === this.dialog) this.dialog.close();
    });
    this.dialog.addEventListener("close", () => onPause(false));
    document.body.append(this.dialog);
    this.city = city;
    this.demo = demo;
    this.onPause = onPause;
    this.onScenic = onScenic;
    this.onPerception = onPerception;
    this.rejectionsExpanded = false;
    this.lastPerceptionData = null;
    const actions = h(
      "div",
      { class: "lab-actions" },
      h("button", { class: "chip-button", onclick: () => this.home() }, "Drive lab"),
      h("button", { class: "chip-button", onclick: () => this.challenges() }, "Challenges"),
      (this.eyes = h(
        "button",
        {
          class: "chip-button",
          "aria-pressed": "false",
          onclick: () => this.toggleEyes(),
        },
        "AI eyes",
      )),
      (this.inspect = h(
        "button",
        {
          class: "chip-button",
          "aria-pressed": "false",
          onclick: () => this.toggleTelemetry(),
        },
        "Telemetry",
      )),
    );
    $(".hud-top-left").append(actions);
    this.perception = h(
      "section",
      { class: "perception-panel panel", hidden: true, "aria-label": "Geometric perception" },
      h("span", { class: "label" }, "AI EYES / GEOMETRIC SENSING"),
      (this.sight = h("div", { class: "perception-sight" }, h("p", {}, "Observing the street…"))),
      h("p", { class: "perception-legend" }, "Green: visible · Red: hidden from driver · Yellow: selected path"),
      h("p", { class: "muted" }, "Hidden-object boxes use world truth for inspection; the driver cannot see them."),
      (this.rejections = h("div", { class: "candidate-rejections" })),
    );
    $("#hud-right").append(this.perception);
    this.replay = h(
      "section",
      { class: "replay-deck panel", hidden: true, "aria-label": "Recorded drive replay" },
      h(
        "div",
        { class: "replay-heading" },
        h("span", { class: "label" }, "DRIVE REPLAY"),
        (this.replayStatus = h("span", { class: "muted" }, "Recording · last 120 seconds")),
        h("button", { class: "chip-button", onclick: () => this.openReplay() }, "Rewind"),
      ),
      (this.controls = h(
        "div",
        { class: "replay-controls", hidden: true },
        h(
          "div",
          { class: "replay-slider-wrap" },
          (this.slider = h("input", {
            id: "slider",
            type: "range",
            min: 0,
            max: 0,
            step: 1,
            value: 0,
            "aria-label": "Replay time",
            oninput: () => this.seek(Number(this.slider.value)),
          })),
          (this.incidentTicks = h("div", { class: "replay-ticks", "aria-hidden": "true" })),
        ),
        h(
          "div",
          { class: "replay-buttons" },
          (this.play = h("button", { class: "chip-button", onclick: () => this.togglePlayback() }, "Play replay")),
          (this.speedSelect = h(
            "select",
            {
              class: "replay-speed",
              "aria-label": "Replay speed",
              onchange: () => {
                this.replaySpeed = Number(this.speedSelect.value) || 1;
                this.lastTick = performance.now();
              },
            },
            h("option", { value: "0.5" }, "0.5×"),
            h("option", { value: "1", selected: true }, "1×"),
            h("option", { value: "2" }, "2×"),
          )),
          h("button", { class: "chip-button", onclick: () => this.stepFrame(-1) }, "−0.5 s"),
          h("button", { class: "chip-button", onclick: () => this.stepFrame(1) }, "+0.5 s"),
          h("button", { class: "chip-button", onclick: () => this.previousIncident() }, "Before incident"),
          h("button", { class: "chip-button", onclick: () => this.nextIncident() }, "Next incident"),
          h("button", { class: "chip-button", onclick: () => this.branch("manual") }, "Take over here"),
          (this.branchAgent = h("select", { "aria-label": "Branch driver" })),
          h("button", { class: "chip-button", onclick: () => this.branch(this.branchAgent.value) }, "Try this driver"),
          (this.branchCandidate = h("select", { "aria-label": "Alternate manoeuvre" })),
          h(
            "button",
            { class: "chip-button", onclick: () => this.branch(`candidate:${this.branchCandidate.value}`) },
            "Try manoeuvre",
          ),
          h("button", { class: "chip-button", onclick: () => this.live() }, "Return to drive"),
        ),
      )),
    );
    document.body.append(this.replay);
    const settings = $("#settings");
    settings.append(
      h("h3", { class: "settings-section-heading" }, "Driving agents"),
      h(
        "label",
        { class: "wide" },
        h("span", { class: "label" }, "Active agent"),
        (this.agent = h("select", { "aria-label": "Active agent", onchange: () => onAgent(this.agent.value) })),
      ),
      (this.modelsStatus = h("p", { class: "muted wide", role: "status" }, agentNote)),
      demo ? null : h("button", { class: "toggle wide", onclick: () => onConnectModel?.() }, "Connect a model"),
      h(
        "label",
        { class: "wide" },
        h("span", { class: "label" }, "Local agent module"),
        (this.module = h("input", {
          type: "text",
          placeholder: "/js/agents/my-agent.js",
          "aria-label": "Local agent module",
        })),
      ),
      h("button", { class: "toggle wide", onclick: () => this.loadAgent() }, "Load agent"),
      (this.agentStatus = h(
        "p",
        { class: "muted wide", role: "status" },
        "Trusted JavaScript modules run in this browser.",
      )),
    );
    this.lastTick = -Infinity;
    this.playing = false;
    this.reviewing = false;
    this.replaySpeed = 1;
    this.replayElapsed = 0;
    this.replayAlpha = 0;
    this.refreshAgents();
  }
  toggleEyes(force) {
    const enabled = force === undefined ? this.eyes.getAttribute("aria-pressed") !== "true" : !!force;
    this.eyes.setAttribute("aria-pressed", String(enabled));
    this.perception.hidden = !enabled;
    this.onPerception?.(enabled);
  }
  toggleTelemetry(force) {
    const enabled = force === undefined ? !document.body.classList.contains("telemetry-expanded") : !!force;
    document.body.classList.toggle("telemetry-expanded", enabled);
    this.inspect.setAttribute("aria-pressed", String(enabled));
  }
  isReviewing() {
    return !!this.reviewing;
  }
  togglePlay() {
    return this.togglePlayback();
  }
  // Rebuild the driver pickers, e.g. after endpoints report whether they are reachable.
  refreshAgents(agentNote) {
    if (agentNote !== undefined) this.modelsStatus.textContent = agentNote;
    const agents = agentDefinitions();
    const active = this.agent.value,
      branch = this.branchAgent.value;
    this.agent.replaceChildren(
      ...agents.map((a) => h("option", { value: a.id, disabled: a.available === false }, agentOptionLabel(a))),
    );
    this.branchAgent.replaceChildren(
      ...agents.filter((a) => a.available !== false).map((a) => h("option", { value: a.id }, agentOptionLabel(a))),
    );
    if (active) this.agent.value = active;
    if (branch && agents.some((a) => a.id === branch && a.available !== false)) this.branchAgent.value = branch;
  }
  open(content) {
    this.dialog.replaceChildren(
      h(
        "div",
        { class: "lab-dialog-top" },
        h("span", { class: "brand" }, "JEV / DRIVE LAB"),
        h(
          "button",
          { class: "chip-button", "aria-label": "Close drive lab", onclick: () => this.dialog.close() },
          "Back to street ↗",
        ),
      ),
      content,
    );
    if (!this.dialog.open) {
      this.onPause(true);
      this.dialog.showModal();
    }
  }
  home() {
    this.open(
      h(
        "div",
        {},
        h("div", { class: "lab-eyebrow" }, `${this.city.city || "Canada"} · REAL STREETS / OPEN SOURCE`),
        h("h1", { class: "lab-hero-title" }, "Your city.", h("br"), h("span", {}, "A different driver.")),
        h(
          "p",
          { class: "lab-hero-copy" },
          "Take the wheel, challenge an AI, or look inside its next decision. Every drive has something to teach you.",
        ),
        h(
          "div",
          { class: "welcome-options" },
          this.welcomeCard(
            "01",
            "Take a scenic drive",
            "Real neighbourhoods. Golden light. Find your rhythm.",
            "Start cruising →",
            () => this.scenic("manual"),
          ),
          this.welcomeCard(
            "02",
            "Can you beat the AI?",
            `${CHALLENGES.length} authored challenges. The same conditions for every driver.`,
            "Pick a challenge →",
            () => this.challenges(),
          ),
          this.welcomeCard(
            "03",
            "Watch the AI drive",
            "Follow its choices, then rewind and try your own.",
            "Watch Rules →",
            () => this.scenic("rules"),
          ),
        ),
        h(
          "div",
          { class: "lab-footer" },
          h("span", {}, "12 neighbourhoods · 11 Canadian cities · No key needed for Rules"),
          h(
            "span",
            { class: "lab-footer-links" },
            this.resultsLink(),
            h(
              "a",
              { href: "https://github.com/BrendanH18/jev_fsd", target: "_blank", rel: "noopener" },
              "Star on GitHub ↗",
            ),
          ),
        ),
        h(
          "p",
          { class: "lab-footnote" },
          this.demo
            ? "Public browser demo · Rules and starter agents run locally in your browser. Drive with keyboard, touch or gamepad."
            : "Local drive lab · WASD or arrows to drive · J for autopilot · P to pause. Research simulator.",
        ),
      ),
    );
  }
  // The leaderboard of committed results (results.html, ui/results.js).
  resultsLink() {
    return h(
      "a",
      { href: appUrl(this.demo ? "results.html" : "results"), target: "_blank", rel: "noopener" },
      "How the AI drivers did ↗",
    );
  }
  welcomeCard(number, title, copy, action, onclick) {
    return h(
      "button",
      { class: "welcome-card", onclick },
      h("span", { class: "welcome-number" }, number),
      h("h2", {}, title),
      h("p", {}, copy),
      h("strong", {}, action),
    );
  }
  async scenic(driver) {
    this.dialog.close();
    try {
      await this.onScenic(driver);
    } catch (error) {
      this.open(
        h(
          "div",
          {},
          h("h2", {}, "Could not find a scenic drive."),
          h("p", {}, error.message),
          h("button", { class: "toggle", onclick: () => this.scenic(driver) }, "Try again"),
        ),
      );
    }
  }
  challenges() {
    let practice = this.practice?.available === false ? this.practice : readPractice();
    let roadTests = readRoadTests();
    const filters = (this.challengeFilters ||= {
      query: "",
      city: "",
      province: "",
      skill: "",
      weather: "",
      time: "",
      progress: "",
      sort: "",
    });
    const controls = {};
    const unique = (values) => [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
    const picker = (key, label, options, ariaLabel = `Filter by ${label.toLowerCase()}`, defaultLabel = null) =>
      h(
        "label",
        {},
        h("span", {}, label),
        (controls[key] = h(
          "select",
          {
            "aria-label": ariaLabel,
            onchange: () => {
              filters[key] = controls[key].value;
              render();
            },
          },
          h(
            "option",
            { value: "" },
            defaultLabel ||
              {
                city: "All cities",
                province: "All provinces",
                skill: "All skills",
                weather: "Any weather",
                time: "Any time",
                progress: "Any progress",
                sort: "Default order",
              }[key],
          ),
          options.map(([value, text]) => h("option", { value, selected: filters[key] === value }, text)),
        )),
      );
    const grid = h("div", { class: "challenge-grid" });
    const count = h("p", { class: "challenge-results", role: "status", "aria-live": "polite", "aria-atomic": "true" });
    const next = h("a", { class: "chip-button challenge-next" });
    const backupStatus = h("span", { class: "practice-backup-status muted", role: "status", "aria-live": "polite" });
    const reset = () => {
      for (const key of Object.keys(filters)) {
        filters[key] = "";
        if (controls[key]) controls[key].value = "";
      }
      render();
      controls.query.focus();
    };
    const empty = h(
      "div",
      { class: "challenge-empty", hidden: true },
      h("h2", {}, "No matching challenges"),
      h("p", {}, "Try another search or clear your filters to see every drive."),
      h("button", { class: "chip-button", onclick: reset }, "Clear filters"),
    );
    const challengeUrl = (challenge) => driveLink({ ...challengeConfig(challenge), drive: this.challengeDriver.value });
    // (road tests, lab/road-tests.js: a longer drive marked like an examiner's sheet)
    const roadGrid = h("div", { class: "challenge-grid road-test-grid" });
    const renderRoadTests = () =>
      roadGrid.replaceChildren(
        ...ROAD_TESTS.map((t) => {
          const status = roadTestStatus(t, roadTests.records),
            record = roadTestRecord(t, roadTests.records),
            best = record?.best;
          return h(
            "a",
            { class: "road-test-card", "data-road-test": t.id, href: challengeUrl(t) },
            h(
              "div",
              { class: "challenge-card-top" },
              h("span", { class: "challenge-icon", "aria-hidden": "true" }, t.icon),
              h("span", { class: "label" }, t.style),
            ),
            h("h2", {}, t.title),
            h(
              "span",
              { class: `practice-badge practice-${status === "passed" ? "completed" : status}` },
              ROAD_TEST_LABELS[status],
            ),
            best
              ? h(
                  "span",
                  { class: "road-test-best" },
                  `Best: ${best.pass ? "Pass" : "Fail"} · ${best.demerits} demerit${best.demerits === 1 ? "" : "s"}`,
                )
              : null,
            record
              ? h("span", { class: "practice-badge" }, `${record.passes}/${record.attempts} attempts passed`)
              : null,
            h("p", {}, t.description),
            h("div", { class: "challenge-card-meta" }, `${challengeCity(t)} · ${t.region} · ${t.weather} · ${t.time}`),
            h("strong", {}, status === "untried" ? "Take the test →" : "Retake the test →"),
          );
        }),
      );
    const cleanScore = (challenge) =>
      practiceStatus(challenge, practice.records) === "completed" ? practice.records[challenge.id].best_score : null;
    const sortMatches = (matches) => {
      if (!filters.sort) return matches;
      const statusRank = { untried: 0, attempted: 1, completed: 2 };
      const attemptRank = { attempted: 0, untried: 1, completed: 2 };
      return [...matches].sort((a, b) => {
        if (filters.sort === "untried") {
          return (
            statusRank[practiceStatus(a, practice.records)] - statusRank[practiceStatus(b, practice.records)] ||
            a.title.localeCompare(b.title)
          );
        }
        if (filters.sort === "attempted") {
          return (
            attemptRank[practiceStatus(a, practice.records)] - attemptRank[practiceStatus(b, practice.records)] ||
            a.title.localeCompare(b.title)
          );
        }
        if (filters.sort === "city") {
          return challengeCity(a).localeCompare(challengeCity(b)) || a.title.localeCompare(b.title);
        }
        if (filters.sort === "difficulty") {
          return a.difficulty.localeCompare(b.difficulty) || a.title.localeCompare(b.title);
        }
        if (filters.sort === "score") {
          return (cleanScore(b) ?? -1) - (cleanScore(a) ?? -1) || a.title.localeCompare(b.title);
        }
        if (filters.sort === "title") {
          return a.title.localeCompare(b.title);
        }
        return 0;
      });
    };
    const render = () => {
      renderRoadTests();
      const filtered = filterChallenges(CHALLENGES, filters, practice.records);
      const matches = sortMatches(filtered);
      const completed = CHALLENGES.filter((c) => practiceStatus(c, practice.records) === "completed").length;
      count.textContent = `${matches.length} of ${CHALLENGES.length} challenges · ${completed} completed cleanly by you`;
      empty.hidden = matches.length > 0;
      grid.replaceChildren(
        ...matches.map((c) => {
          const status = practiceStatus(c, practice.records);
          const best = cleanScore(c);
          const aiFail = AI_FAILED_CHALLENGES[c.id];
          const city = challengeCity(c);
          const neighbourhood = challengeNeighbourhood(c);
          const place = neighbourhood.toLowerCase() === city.toLowerCase() ? city : `${city} · ${neighbourhood}`;
          return h(
            "a",
            { class: "challenge-card", "data-challenge": c.id, href: challengeUrl(c) },
            h(
              "div",
              { class: "challenge-card-top" },
              h("span", { class: "challenge-icon", "aria-hidden": "true" }, c.icon),
              h("span", { class: "label" }, c.difficulty),
            ),
            h("h2", {}, c.title),
            h(
              "div",
              { class: "challenge-badges" },
              h("span", { class: `practice-badge practice-${status}` }, PRACTICE_LABELS[status]),
              best == null ? null : h("span", { class: "practice-badge" }, `Best: ${best}/100`),
              aiFail ? h("span", { class: "practice-badge beat-ai-badge", title: aiFail }, "Beat the AI") : null,
            ),
            h("p", {}, c.description),
            h("div", { class: "challenge-card-meta" }, `${place} · ${c.weather} · ${c.time}`),
            h(
              "strong",
              {},
              status === "attempted"
                ? "Retry challenge →"
                : status === "completed"
                  ? "Practise again →"
                  : "Try challenge →",
            ),
          );
        }),
      );
      const recommendation =
        matches.find((c) => practiceStatus(c, practice.records) === "attempted") ||
        matches.find((c) => practiceStatus(c, practice.records) === "untried") ||
        matches[0];
      next.hidden = !recommendation;
      next.textContent = recommendation ? `Practise next: ${recommendation.title} →` : "Practise next";
      if (recommendation) next.href = challengeUrl(recommendation);
      else next.removeAttribute("href");
    };

    // Practice backup controls live in their own `.practice-backup` container so `.challenge-library-actions` keeps "Clear filters" first.
    let resetArmed = false,
      resetTimer = null;
    const resetProgressBtn = h(
      "button",
      {
        type: "button",
        class: "chip-button",
        onclick: () => {
          if (!resetArmed) {
            resetArmed = true;
            resetProgressBtn.textContent = "Confirm reset?";
            resetProgressBtn.classList.add("confirming");
            clearTimeout(resetTimer);
            resetTimer = setTimeout(() => {
              resetArmed = false;
              resetProgressBtn.textContent = "Reset progress";
              resetProgressBtn.classList.remove("confirming");
            }, 4000);
            return;
          }
          clearTimeout(resetTimer);
          resetArmed = false;
          resetProgressBtn.textContent = "Reset progress";
          resetProgressBtn.classList.remove("confirming");
          const result = resetPractice();
          if (result.available) {
            this.practice = practice = { records: {}, available: true };
            roadTests = { records: {}, available: true };
          }
          backupStatus.textContent = result.available
            ? "Practice and road-test progress cleared."
            : "Browser storage is unavailable.";
          render();
        },
      },
      "Reset progress",
    );
    const importInput = h("input", {
      type: "file",
      accept: ".json,application/json",
      "aria-label": "Import practice progress JSON",
      onchange: async () => {
        const file = importInput.files?.[0];
        if (!file) return;
        try {
          const parsed = JSON.parse(await file.text());
          const imported = importPracticeBackup(parsed, undefined, () =>
            window.confirm("Replace all saved challenge and road-test progress on this browser with this backup?"),
          );
          if (!imported) {
            backupStatus.textContent = "Import cancelled. Your saved progress was kept.";
            return;
          }
          practice = { records: imported.practice, available: imported.available };
          roadTests = { records: imported.roadTests, available: imported.available };
          this.practice = practice;
          backupStatus.textContent = `Imported ${imported.practiceCount} challenges and ${imported.roadTestCount} road tests.`;
          render();
        } catch (err) {
          backupStatus.textContent = `Import failed: ${err.message}`;
        } finally {
          importInput.value = "";
        }
      },
    });
    const exportProgress = () => {
      const payload = exportPracticeBackup();
      if (!payload) {
        backupStatus.textContent = "Could not read saved practice progress.";
        return;
      }
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
      const url = URL.createObjectURL(
        new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: "application/json" }),
      );
      const a = h("a", { href: url, download: `jev-practice-backup-${stamp}.json` });
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      backupStatus.textContent = "Practice backup exported.";
    };

    this.open(
      h(
        "div",
        {},
        h("div", { class: "lab-eyebrow" }, "SAME STREET. SAME HAZARD. YOUR MOVE."),
        h("h1", { class: "challenge-title" }, "Can you beat the AI?"),
        h(
          "p",
          { class: "lab-hero-copy" },
          "Choose a short drive. Compare complete arrivals under the same conditions; a higher score alone does not mean a safer driver.",
        ),
        h(
          "label",
          { class: "challenge-driver" },
          "Drive with ",
          (this.challengeDriver = h(
            "select",
            { "aria-label": "Challenge driver", onchange: render },
            h("option", { value: "manual" }, "Me · manual"),
            ...agentDefinitions()
              .filter((a) => a.available !== false)
              .map((a) => h("option", { value: a.id }, agentOptionLabel(a))),
          )),
        ),
        h(
          "section",
          { class: "road-test-library", "aria-labelledby": "road-tests-heading" },
          h("h2", { id: "road-tests-heading", class: "road-test-heading" }, "Road tests"),
          h(
            "p",
            { class: "lab-footnote" },
            `Longer licence-style drives on a fixed route, with an examiner's directions and sheet. Any dangerous action or violation fails; minor errors are demerits. Any driver can take one; only an unchanged manual attempt is recorded as yours${roadTests.available ? "" : ", and browser storage is unavailable"}.`,
          ),
          roadGrid,
        ),
        h("h2", { class: "road-test-heading" }, "Challenges"),
        h(
          "div",
          { class: "challenge-filters", role: "group", "aria-label": "Find a challenge" },
          h(
            "label",
            { class: "challenge-search" },
            h("span", {}, "Search challenges"),
            (controls.query = h("input", {
              type: "search",
              value: filters.query,
              placeholder: "Title, place, conditions or lesson",
              "aria-label": "Search challenges",
              oninput: () => {
                filters.query = controls.query.value;
                render();
              },
            })),
          ),
          picker(
            "city",
            "City",
            unique(CHALLENGES.map(challengeCity)).map((value) => [value, value]),
          ),
          picker(
            "province",
            "Province",
            unique(CHALLENGES.map(challengeProvince)).map((value) => [value, value]),
          ),
          picker(
            "skill",
            "Skill",
            unique(CHALLENGES.map((c) => c.difficulty)).map((value) => [value, value]),
          ),
          picker(
            "weather",
            "Weather",
            unique(CHALLENGES.map((c) => c.weather)).map((value) => [value, value]),
          ),
          picker(
            "time",
            "Time of day",
            unique(CHALLENGES.map((c) => c.time)).map((value) => [value, value]),
          ),
          picker("progress", "Progress", Object.entries(PRACTICE_LABELS)),
          picker(
            "sort",
            "Sort",
            [
              ["untried", "Untried first"],
              ["attempted", "Attempted first"],
              ["city", "City"],
              ["difficulty", "Difficulty"],
              ["title", "A–Z"],
              ["score", "Best clean score"],
            ],
            "Sort challenges",
            "Default order",
          ),
        ),
        h(
          "p",
          { class: "lab-footnote" },
          practice.available
            ? "Your manual practice is saved in this browser. A clean completion means arriving under the authored conditions with no challenge failures. AI, mixed-driver, modified and replay attempts stay separate."
            : "Browser storage is unavailable. Practice progress cannot be saved on this device.",
        ),
        h(
          "div",
          { class: "practice-backup" },
          h("span", { class: "label" }, "Progress backup"),
          h("button", { type: "button", class: "chip-button", onclick: exportProgress }, "Export JSON"),
          h("label", { class: "chip-button practice-import-label" }, "Import JSON", importInput),
          resetProgressBtn,
          backupStatus,
        ),
        h(
          "div",
          { class: "challenge-library-actions" },
          count,
          h("button", { class: "chip-button", onclick: reset }, "Clear filters"),
          next,
        ),
        grid,
        empty,
        h(
          "div",
          { class: "lab-footer" },
          h("button", { class: "chip-button", onclick: () => this.home() }, "← Drive lab"),
          h(
            "span",
            { class: "lab-footer-links" },
            this.resultsLink(),
            h(
              "a",
              { href: appUrl(this.demo ? "arena.html" : "arena"), target: "_blank", rel: "noopener" },
              "Evaluate agents ↗",
            ),
          ),
        ),
      ),
    );
    render();
  }
  setAgent(name) {
    this.agent.value = name;
  }
  async loadAgent() {
    try {
      const url = new URL(this.module.value, location.href);
      if (url.origin !== location.origin || !url.pathname.endsWith(".js"))
        throw new Error("Use a trusted .js module served by this app.");
      const { default: definition } = await import(url.href);
      registerAgent(definition);
      this.onAgent(definition.id, definition);
      this.refreshAgents();
      this.agent.value = definition.id;
      this.agentStatus.textContent = `${definition.label} loaded. Set a destination and enable autopilot.`;
    } catch (error) {
      this.agentStatus.textContent = error.message;
    }
  }
  showPerception(data) {
    if (!data) return;
    this.lastPerceptionData = data;
    const lines = PERCEPTION_FIELDS.map(([order, key, label]) => ({ order, label, text: data[key] }));
    lines.push(...(data.featureLines || []));
    const badges = [];
    const seenTexts = new Set();
    for (const { label, text } of lines.sort((a, b) => a.order - b.order)) {
      if (!text || seenTexts.has(text)) continue;
      seenTexts.add(text);
      badges.push(h("span", { class: "perception-badge", title: label }, text));
    }
    this.sight.replaceChildren(
      ...(badges.length ? [h("div", { class: "perception-badges" }, ...badges)] : []),
      h(
        "p",
        { class: "perception-summary" },
        `${data.seen} visible · ${data.hidden} hidden · ${Math.round(data.range)} m sight · ${Math.round(data.safeSpeed)} km/h sight-limited target`,
      ),
    );
    this.renderRejections(data.rejected || []);
  }
  renderRejections(rejected) {
    const visible = this.rejectionsExpanded ? rejected : rejected.slice(0, 4);
    const hiddenCount = rejected.length - 4;
    this.rejections.replaceChildren(
      ...visible.map((c) => h("div", {}, h("span", {}, c.id.replaceAll("_", " ")), h("b", {}, c.reason))),
      hiddenCount > 0
        ? h(
            "button",
            {
              type: "button",
              class: "chip-button perception-more",
              onclick: () => {
                this.rejectionsExpanded = !this.rejectionsExpanded;
                this.renderRejections(this.lastPerceptionData?.rejected || rejected);
              },
            },
            this.rejectionsExpanded ? "Show fewer" : `+${hiddenCount} more`,
          )
        : null,
    );
  }
  renderIncidentTicks() {
    if (!this.incidentTicks || !this.recorder?.frames?.length) return;
    const frames = this.recorder.frames;
    const firstT = frames[0].t;
    const span = Math.max(0.001, frames.at(-1).t - firstT);
    const markers = this.recorder.markers || [];
    this.incidentTicks.replaceChildren(
      ...markers.map((m) =>
        h("span", {
          class: "replay-tick",
          style: { left: `${Math.max(0, Math.min(100, ((m.t - firstT) / span) * 100))}%` },
          title: `${m.t.toFixed(1)} s · ${m.type.replaceAll("_", " ")}`,
        }),
      ),
    );
  }
  update(recorder, now) {
    this.recorder = recorder;
    this.replay.hidden = recorder.frames.length < 2;
    if (this.reviewing && this.playing) {
      const rate = this.replaySpeed || 1;
      const position = replayPosition(
        recorder.frames,
        Number(this.slider.value),
        this.replayElapsed + (Math.max(0, now - this.lastTick) / 1000) * rate,
      );
      if (position.index !== Number(this.slider.value)) this.seek(position.index);
      this.replayElapsed = position.elapsed;
      this.replayAlpha = position.alpha;
      if (position.ended) {
        this.playing = false;
        this.play.textContent = "Play replay";
      }
      this.lastTick = now;
    }
    if (this.modelPlayer) {
      const at = recorder.frames[Number(this.slider.value)].state.drive.elapsed + this.replayElapsed;
      if (this.modelTime !== at) this.modelPlayer.render(at);
      this.modelTime = at;
    }
    if (!this.reviewing) {
      this.slider.max = Math.max(0, recorder.frames.length - 1);
      this.slider.value = this.slider.max;
    }
  }
  togglePlayback() {
    if (!this.reviewing || !this.recorder?.frames.length) return;
    if (!this.playing && Number(this.slider.value) === this.recorder.frames.length - 1) this.seek(0);
    this.playing = !this.playing;
    this.lastTick = performance.now();
    this.play.textContent = this.playing ? "Pause replay" : "Play replay";
  }
  stepFrame(delta) {
    if (!this.reviewing || !this.recorder?.frames.length) return;
    this.playing = false;
    this.play.textContent = "Play replay";
    const next = Math.max(0, Math.min(this.recorder.frames.length - 1, Number(this.slider.value) + delta));
    this.seek(next);
  }
  openReplay(index, comparison) {
    if (!this.recorder?.frames.length || (this.reviewing && index === undefined)) return;
    let modelView = null,
      modelPlayer = null,
      modelTime;
    if (comparison) {
      const player = h("div");
      modelView = h(
        "aside",
        { class: "incident-model panel", "aria-label": "Model incident replay" },
        h(
          "strong",
          {},
          `Matched by elapsed challenge time · Your incident at ${comparison.incident.at_s.toFixed(1)} s`,
        ),
        player,
      );
      modelTime = this.recorder.frames[index].state.drive.elapsed;
      modelPlayer = showDrive(player, comparison.replay, modelTime);
    }
    this.modelView?.remove();
    if (modelView) document.body.append(modelView);
    this.modelView = modelView;
    this.modelPlayer = modelPlayer;
    this.modelTime = modelTime;
    this.reviewing = true;
    this.controls.hidden = false;
    this.playing = false;
    this.play.textContent = "Play replay";
    this.slider.max = this.recorder.frames.length - 1;
    this.renderIncidentTicks();
    this.seek(index === undefined ? Math.max(0, this.recorder.frames.length - 11) : index);
  }
  seek(index) {
    this.replayElapsed = 0;
    this.replayAlpha = 0;
    this.lastTick = performance.now();
    this.slider.value = index;
    this.onSeek(index);
    const frame = this.recorder.frames[index];
    this.branchCandidate.replaceChildren(
      ...(frame?.state.pilot.lastDecision?.candidates || [])
        // (only those that passed the safety checks: not the open track's flagged ones, brain/tracks.js)
        .filter((c) => c.eligible && !c.flagged)
        .map((c) => h("option", { value: c.id }, describe(c))),
    );
    this.replayStatus.textContent = `${frame?.t.toFixed(1) || 0} s · recorded checkpoints every 0.5 s`;
  }
  previousIncident() {
    const t = this.recorder.frames[Number(this.slider.value)]?.t ?? Infinity;
    const marker = [...this.recorder.markers].reverse().find((m) => m.t < t);
    const target = marker ? Math.max(this.recorder.frames[0].t, marker.t - 3) : this.recorder.frames[0].t;
    this.seek(
      Math.max(
        0,
        this.recorder.frames.findLastIndex((f) => f.t <= target),
      ),
    );
  }
  nextIncident() {
    if (!this.recorder?.frames.length) return;
    const currentIndex = Number(this.slider.value);
    const t = this.recorder.frames[currentIndex]?.t ?? -Infinity;
    const markers = this.recorder.markers || [];
    const marker = markers.find((m) => m.t > t + 0.05);
    if (!marker) {
      this.seek(this.recorder.frames.length - 1);
      return;
    }
    const leadTarget = Math.max(this.recorder.frames[0].t, marker.t - 3);
    const leadIndex = Math.max(
      0,
      this.recorder.frames.findLastIndex((f) => f.t <= leadTarget),
    );
    if (leadIndex > currentIndex) {
      this.seek(leadIndex);
    } else {
      const exactIndex = Math.max(
        0,
        this.recorder.frames.findLastIndex((f) => f.t <= marker.t + 1e-9),
      );
      this.seek(Math.min(this.recorder.frames.length - 1, Math.max(currentIndex + 1, exactIndex)));
    }
  }
  branch(driver) {
    if (this.onBranch(Number(this.slider.value), driver) !== false) this.endReview();
  }
  live() {
    this.onLive();
    this.endReview();
  }
  endReview() {
    this.modelPlayer = null;
    this.modelView?.remove();
    this.modelView = null;
    this.reviewing = false;
    this.playing = false;
    this.replayElapsed = 0;
    this.replayAlpha = 0;
    this.controls.hidden = true;
    this.play.textContent = "Play replay";
    this.replayStatus.textContent = "Recording · last 120 seconds";
  }
}
