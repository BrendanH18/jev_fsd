import { $, api, appUrl, h } from "../common.js";
import { HISTORY_KEY, readHistory } from "../sim/drive-score.js";
import { exportDriveCard, copyDriveLink, driveLink, exportFilename } from "../lab/share.js";
import { CHALLENGES, challengeById, challengeConfig } from "../lab/challenges.js";
import { readPractice, practiceStatus, practiceEligible, challengeFailures } from "../lab/practice.js";
import { examinerSheet, roadTestNote } from "./road-test.js";
import { decidedByText } from "../bench/metrics.js";

import { driveScores } from "../bench/scores.js";
import { CHALLENGE_SCORE_METHOD } from "../lab/score-inputs.js";
import { checkResults, compatibleChallengeDrive, driverDisplayName } from "../lab/results.js";
import { incidentDrive, loadPublishedDrive } from "./published-replay.js";

const time = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const labels = { safety: "Safety", legality: "Road rules", comfort: "Smoothness", control: "Control" };
const signed = (n, digits = 1) => `${n > 0 ? "+" : ""}${n.toFixed(digits)}`;
const norm = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

let cachedResultsPromise = null;

function fetchResultsCached(signal) {
  if (!cachedResultsPromise) {
    cachedResultsPromise = api("/api/results")
      .then(checkResults)
      .catch((err) => {
        cachedResultsPromise = null;
        throw err;
      });
  }
  if (!signal) return cachedResultsPromise;
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new DOMException("Request aborted", "AbortError"));
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    cachedResultsPromise.then(
      (data) => {
        signal.removeEventListener("abort", onAbort);
        resolve(data);
      },
      (err) => {
        signal.removeEventListener("abort", onAbort);
        reject(err);
      },
    );
  });
}

function writeHistory(list) {
  try {
    globalThis.localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, 20)));
    return true;
  } catch {
    return false;
  }
}

export class DriveReport {
  constructor({ onFinish, onNewDrive, onReplay, getReplayTarget = () => null, onOpen = () => {}, onClose = () => {} }) {
    this.onReplay = onReplay;
    this.getReplayTarget = getReplayTarget;
    this.current = null;
    this.comparisonRequest = null;
    this.resultsRequest = null;
    this.lastUpdate = -Infinity;
    this.onOpen = onOpen;
    this.card = h(
      "section",
      { class: "drive-card panel", "aria-label": "Drive score" },
      h(
        "div",
        { class: "drive-heading" },
        h("span", { class: "label" }, "DRIVE COACH"),
        h("button", { class: "text-button", onclick: () => this.showHistory() }, "History ↗"),
      ),
      h(
        "div",
        { class: "drive-score-row" },
        (this.number = h("strong", { class: "drive-number" }, "—")),
        h(
          "div",
          {},
          (this.title = h("div", { class: "drive-title" }, "Your next great drive")),
          (this.stats = h("div", { class: "muted" }, "Select a destination or take the wheel")),
        ),
      ),
      (this.bars = h("div", { class: "drive-bars" })),
      (this.coach = h("p", { class: "drive-coach" }, "A score for safety, road rules, smoothness and control.")),
      h(
        "div",
        { class: "drive-actions" },
        h("button", { id: "new-drive", class: "toggle", onclick: onNewDrive }, "Explore drives"),
        (this.finishButton = h(
          "button",
          { id: "finish-drive", class: "toggle", disabled: true, onclick: onFinish },
          "Finish & review",
        )),
      ),
    );
    ($("#hud-left") || $("#hud")).append(this.card);
    this.dialog = h("dialog", { class: "drive-dialog", "aria-label": "Drive report" });
    this.dialog.addEventListener("click", (ev) => {
      if (ev.target === this.dialog) this.dialog.close();
    });
    this.dialog.addEventListener("close", () => {
      if (!this.dialog.open) this.cancelComparisons();
      onClose();
    });
    document.body.append(this.dialog);
  }

  update(session, now = performance.now()) {
    if (now - this.lastUpdate < 200) return;
    this.lastUpdate = now;
    if (!session) return;
    const r = (this.current = session.snapshot());
    this.number.textContent = r.qualified ? r.score : "—";
    this.number.dataset.grade = r.grade;
    this.number.dataset.qualified = String(r.qualified);
    this.title.textContent = r.title;
    this.stats.textContent = `${(r.distance_m / 1000).toFixed(2)} km · ${time(r.elapsed_s)} · ${r.qualified ? `Grade ${r.grade}` : "100 m to qualify"}`;
    const reached =
      r.parking?.result === "parked"
        ? "Parked at the destination"
        : r.parking && r.parking.result !== "not yet"
          ? `Destination reached · ${r.parking.result}`
          : "Destination reached";
    this.coach.textContent =
      r.status === "active" ? r.coach : `${r.status === "arrived" ? reached : "Drive finished"} · ${r.tips[0]}`;
    this.finishButton.disabled = !!session.finished;
    this.bars.replaceChildren(...this.categoryBars(r));
  }

  categoryBars(r) {
    return Object.entries(r.categories).map(([key, value]) =>
      h(
        "div",
        { class: "score-category" },
        h("span", {}, labels[key]),
        h(
          "div",
          {
            class: "score-track",
            role: "progressbar",
            "aria-label": labels[key],
            "aria-valuenow": String(Math.round(value)),
            "aria-valuemin": "0",
            "aria-valuemax": "100",
          },
          h("i", {
            style: {
              width: `${value}%`,
              background: value >= 80 ? "var(--good)" : value >= 60 ? "var(--warn)" : "var(--bad)",
            },
          }),
        ),
        h("b", {}, value),
      ),
    );
  }

  debrief(challenge, report) {
    const reasons = challengeFailures(challenge, report);
    const messages = reasons?.map(
      (reason) =>
        ({
          timeout: "Destination not reached.",
          stuck: "Destination not reached: the car got stuck.",
          "not parked": "Not parked within 30 cm of the kerb at the destination.",
        })[reason] || reason,
    );
    if (report.resets > 0)
      messages?.push("Returned the car to its lane. Retry without resetting to earn manual completion.");
    const clean = messages?.length === 0;
    return h(
      "section",
      { class: "challenge-debrief", "aria-label": "Challenge debrief" },
      h("span", { class: "label" }, "CHALLENGE DEBRIEF"),
      h(
        "strong",
        { class: `challenge-verdict${clean ? " clean" : ""}` },
        reasons === null ? "Completion unavailable" : clean ? "Clean arrival" : "Not completed cleanly",
      ),
      reasons === null
        ? h("p", {}, "This saved report does not contain enough information to confirm a clean arrival.")
        : clean
          ? h("p", {}, "Reached the destination with no challenge failures. The coaching grade is separate.")
          : h(
              "div",
              {},
              h("p", {}, "What prevented a clean completion:"),
              h(
                "ul",
                { class: "report-tips challenge-failures" },
                messages.map((message) => h("li", {}, message)),
              ),
            ),
      h("h3", {}, "The lesson"),
      h("p", { class: "challenge-lesson" }, challenge.lesson),
      report.config?.version !== (challenge.version || 1)
        ? h(
            "p",
            { class: "muted" },
            "The lesson shown is from the current challenge version; this report used an earlier version.",
          )
        : null,
    );
  }

  comparison(challenge, report) {
    const reasons = challengeFailures(challenge, report);
    const manualInputs = report.benchmarkMetrics;
    const method = manualInputs?.method === CHALLENGE_SCORE_METHOD ? manualInputs.method : null;
    const manualScore = method ? driveScores(manualInputs).score : null;
    const manualDuration = Number.isFinite(report.elapsed_s) && report.elapsed_s >= 0 ? report.elapsed_s : null;

    const deltaTag = (diff, unit = "", higherBetter = true) => {
      if (!Number.isFinite(diff)) return null;
      const tied = Math.abs(diff) < 0.05;
      const cls = tied ? "" : diff > 0 === higherBetter ? " better" : " worse";
      return h(
        "small",
        { class: `comparison-delta${cls}` },
        tied ? "Tied at this precision" : `you ${signed(diff, 1)}${unit}`,
      );
    };

    const row = (driver, verdict, seconds, score, incidents, { durationDelta = null, scoreDelta = null } = {}) =>
      h(
        "tr",
        {},
        h("th", { scope: "row" }, driver),
        h("td", {}, verdict),
        h("td", {}, Number.isFinite(seconds) ? `${seconds.toFixed(1)} s` : "—", durationDelta),
        h("td", {}, h("span", { class: "comparison-score" }, score), scoreDelta),
        h("td", {}, incidents),
      );

    const manual = row(
      "You",
      reasons === null ? "Unavailable" : reasons.length ? "Fail" : "Pass",
      manualDuration,
      manualScore ?? "Unmeasured",
      [...new Set([...(reasons ?? []), ...report.incidents.map((i) => i.message)])].join(" · ") || "None recorded",
    );
    const body = h("tbody", {}, manual);
    const status = h("p", { class: "muted", role: "status" }, "Loading published drives…");
    const resultsPage = document.querySelector('meta[name="jev-demo"]') ? "results.html" : "results";
    const leaderboard = new URL(appUrl(resultsPage, { "challenges-query": challenge.id }));
    leaderboard.hash = "challenges-heading";
    const section = h(
      "section",
      { class: "drive-comparison", "aria-label": "Same-drive comparison" },
      h("h3", {}, "Your drive beside theirs"),
      h(
        "table",
        {},
        h(
          "thead",
          {},
          h(
            "tr",
            {},
            ["Driver", "Benchmark verdict", "Duration", "Benchmark score / 100", "Incidents"].map((label) =>
              h("th", { scope: "col" }, label),
            ),
          ),
        ),
        body,
      ),
      challenge.roadTest ? h("p", { class: "muted" }, "The examiner’s sheet determines road-test completion.") : null,
      status,
      h("a", { href: leaderboard.href }, "Find this drive on the leaderboard"),
    );
    this.resultsRequest?.abort();
    if (!report.config?.map_sha) {
      status.textContent = "This report has no map fingerprint for matching published drives.";
      return section;
    }
    const request = new AbortController();
    this.resultsRequest = request;
    fetchResultsCached(request.signal)
      .then((data) => {
        if (request.signal.aborted || !body.isConnected) return;
        let matched = 0;
        for (const id of ["rules", "jev", "llm:claude-haiku-5-5"]) {
          const cell = compatibleChallengeDrive(data, id, report.config);
          const label = driverDisplayName(data, id);
          if (!cell) {
            body.append(row(label, "No matching published drive", null, "—", "—"));
            continue;
          }
          matched++;
          const counts = Object.entries(cell.incident_counts || {})
            .filter(([, value]) => value > 0)
            .map(([key, value]) => `${key.replaceAll("_", " ")}: ${value}`);
          const incidents =
            [...new Set([...cell.failures, ...counts])].join(" · ") ||
            (cell.incident_counts ? "None recorded" : "Incident counts unavailable");
          const theirScore =
            method && cell.comparison_score_inputs?.method === method
              ? driveScores(cell.comparison_score_inputs).score
              : null;
          const durationDelta =
            manualDuration !== null && Number.isFinite(cell.time_s)
              ? deltaTag(manualDuration - cell.time_s, " s", false)
              : null;
          const scoreDelta =
            manualScore !== null && Number.isFinite(theirScore) ? deltaTag(manualScore - theirScore, "", true) : null;
          body.append(
            row(label, cell.pass ? "Pass" : "Fail", cell.time_s, theirScore ?? "Unavailable", incidents, {
              durationDelta,
              scoreDelta,
            }),
          );
        }
        status.textContent = matched
          ? "Published rows use the guarded track. Deltas show your drive minus theirs. Scores here use measurements from the car’s path."
          : "No guarded results match this challenge version and map.";
      })
      .catch((err) => {
        if (!request.signal.aborted && err?.name !== "AbortError" && status.isConnected)
          status.textContent = "Published comparisons could not be loaded.";
      })
      .finally(() => {
        if (this.resultsRequest === request) this.resultsRequest = null;
      });
    return section;
  }

  replayIncident(report, incident, comparison) {
    // Revalidate when clicked: a new drive or replay branch can replace the recording.
    const index = this.getReplayTarget(report, incident);
    if (!this.onReplay || !Number.isInteger(index)) return false;
    this.onReplay(index, comparison);
    this.dialog.close();
    return true;
  }

  cancelIncidentComparison() {
    this.comparisonRequest?.abort();
    this.comparisonRequest = null;
  }

  cancelComparisons() {
    this.cancelIncidentComparison();
    this.resultsRequest?.abort();
    this.resultsRequest = null;
  }

  incidentRow(report, incident) {
    const text = `${time(incident.at_s)} · ${incident.at_m} m · ${incident.message}`;
    const available = this.onReplay && Number.isInteger(this.getReplayTarget(report, incident));
    const row = h("li");
    const unavailable = () =>
      row.replaceChildren(
        text,
        h(
          "small",
          { class: "incident-replay-unavailable" },
          "Replay unavailable · event is outside the current recording.",
        ),
      );
    if (available)
      row.append(
        h(
          "button",
          {
            class: "incident-replay",
            type: "button",
            onclick: () => {
              if (!this.replayIncident(report, incident)) unavailable();
            },
          },
          text,
          h("span", {}, "Rewind before event →"),
        ),
      );
    else unavailable();
    const challenge = challengeById(report.config?.challenge);
    const id =
      available &&
      challenge &&
      practiceEligible(challenge, report) &&
      challengeFailures(challenge, report).length &&
      incidentDrive(report.config, incident);
    if (id) {
      const compare = h("button", { class: "chip-button", type: "button" }, "Compare with Jev");
      compare.onclick = async () => {
        this.cancelIncidentComparison();
        const request = new AbortController();
        this.comparisonRequest = request;
        compare.disabled = true;
        compare.textContent = "Loading model replay…";
        try {
          const replay = await loadPublishedDrive(id, request.signal);
          if (
            !request.signal.aborted &&
            this.dialog.open &&
            row.isConnected &&
            !this.replayIncident(report, incident, { replay, incident })
          )
            unavailable();
        } catch {
          if (!request.signal.aborted) compare.textContent = "Model replay unavailable";
        } finally {
          compare.disabled = false;
          if (request.signal.aborted) compare.textContent = "Compare with Jev";
          if (this.comparisonRequest === request) this.comparisonRequest = null;
        }
      };
      row.append(compare);
    }
    return row;
  }

  show(report, saved = true) {
    this.cancelComparisons();
    const challenge = challengeById(report.config?.challenge);
    const records = challenge ? readPractice().records : {};
    const remaining = challenge ? CHALLENGES.filter((c) => c.id !== challenge.id) : [];
    const next =
      remaining.find((c) => practiceStatus(c, records) === "attempted") ||
      remaining.find((c) => practiceStatus(c, records) === "untried");
    const practiceNote =
      report.practice?.outcome === "completed"
        ? "Clean manual arrival. Challenge completed."
        : report.practice?.outcome === "attempted"
          ? "Manual attempt recorded. Retry for a clean arrival."
          : "AI, mixed-driver, modified and replay drives do not change your manual practice progress.";
    // (a road test, lab/road-tests.js, is marked on the examiner's sheet instead: ui/road-test.js)
    const roadTest = !!challenge?.roadTest;
    // (sections a report does not have are null: left out, not shown as "null")
    this.dialog.replaceChildren(
      ...[
        h(
          "div",
          { class: "dialog-header" },
          h("span", { class: "label" }, "DRIVE REPORT"),
          h("button", { class: "toggle", "aria-label": "Close report", onclick: () => this.dialog.close() }, "×"),
        ),
        h("h2", {}, report.title),
        h(
          "p",
          { class: "muted" },
          `${report.map} · ${report.driver} · ${report.status}${report.parking && report.parking.result !== "not yet" ? ` · ${report.parking.result}${report.parking.result === "parked" ? `, ${Math.round(report.parking.kerb_m * 100)} cm from the kerb` : ""}` : ""}${report.modified ? " · modified challenge" : ""}`,
        ),
        // (an AI drive's decisions: the model's own, answered locally, or Rules after a fallback, main.js)
        decidedByText(report) ? h("p", { class: "muted report-decided" }, `Decisions: ${decidedByText(report)}`) : null,
        roadTest
          ? examinerSheet(challenge, report, (incident) => this.incidentRow(report, incident))
          : challenge
            ? this.debrief(challenge, report)
            : null,
        challenge && practiceEligible(challenge, report) ? this.comparison(challenge, report) : null,
        h(
          "div",
          { class: "report-score" },
          h("strong", {}, report.qualified ? report.score : "—"),
          h("span", {}, report.qualified ? `Grade ${report.grade} / 100` : "Practice drive · not yet graded"),
        ),
        h(
          "div",
          { class: "report-metrics" },
          h("span", {}, `${(report.distance_m / 1000).toFixed(2)} km`),
          h("span", {}, time(report.elapsed_s)),
          h("span", {}, `${report.max_kmh} km/h peak`),
        ),
        h("div", { class: "report-categories" }, this.categoryBars(report)),
        h("h3", {}, "For your next drive"),
        h(
          "ul",
          { class: "report-tips" },
          report.tips.map((t) => h("li", {}, t)),
        ),
        h(
          "details",
          {},
          h("summary", {}, `${report.incidents.length} recorded events`),
          h(
            "ol",
            { class: "report-events" },
            report.incidents.map((i) => this.incidentRow(report, i)),
          ),
        ),
        h(
          "p",
          { class: "score-explanation" },
          `Score = 40% safety + 30% road rules + 20% smoothness + 10% control. Collisions cap the score at 59; red lights and failures to yield at 69. Waiting at lights carries no penalty. Simulation coaching model v1.${report.branched ? " This drive includes a replay takeover." : ""}`,
        ),
        challenge
          ? h(
              "p",
              { class: "challenge-practice-note" },
              roadTest ? roadTestNote(challenge, report) : practiceNote,
              report.practice?.outcome
                ? report.practice.saved
                  ? " Progress saved in this browser."
                  : " Browser storage is unavailable; progress could not be saved."
                : "",
            )
          : null,
        (this.shareStatus = h("p", { class: "report-share-status", role: "status" })),
        h(
          "div",
          { class: "dialog-footer" },
          h(
            "span",
            { class: "muted" },
            saved ? "Saved on this device" : "Storage unavailable · export to keep this drive",
          ),
          h("button", { id: "export-drive", class: "toggle", onclick: () => this.export(report) }, "Export JSON"),
          h(
            "button",
            {
              class: "toggle",
              onclick: () =>
                this.share(
                  () => exportDriveCard(report, report.config),
                  "Image saved. Share it with your challenge link.",
                ),
            },
            "Save score card",
          ),
          report.config
            ? h(
                "button",
                {
                  class: "toggle",
                  onclick: () =>
                    this.share(
                      () => copyDriveLink(report.config),
                      "Link copied. It recreates the setup, not the recorded drive.",
                    ),
                },
                report.config.challenge ? "Copy challenge link" : "Copy setup link",
              )
            : null,
          report.config?.challenge
            ? h("a", { class: "toggle", href: driveLink({ ...report.config, drive: "rules" }) }, "Try with Rules")
            : null,
          challenge
            ? h(
                "a",
                { class: "toggle", href: driveLink({ ...challengeConfig(challenge), drive: "manual" }) },
                "Retry manually",
              )
            : null,
          next
            ? h(
                "a",
                { class: "toggle", href: driveLink({ ...challengeConfig(next), drive: "manual" }) },
                `Practise next: ${next.title}`,
              )
            : null,
          this.onReplay && Number.isInteger(this.getReplayTarget(report))
            ? h("button", { class: "toggle", onclick: () => this.replayIncident(report) }, "Review replay")
            : null,
        ),
      ].filter(Boolean),
    );
    this.open();
  }

  showHistory() {
    this.cancelComparisons();
    let history = readHistory();
    const state = { query: "", type: "", city: "", driver: "" };
    const trendEl = h("div", { class: "history-trend" });
    const listWrap = h("div", { class: "history-list" });
    const statusEl = h("p", { class: "muted", role: "status", "aria-live": "polite" });

    const cities = [...new Set(history.map((r) => r.map).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    const drivers = [...new Set(history.map((r) => r.driver).filter(Boolean))].sort((a, b) => a.localeCompare(b));

    const searchInput = h("input", {
      type: "search",
      placeholder: "Search drives…",
      "aria-label": "Search drive history",
      oninput: () => {
        state.query = searchInput.value;
        renderList();
      },
    });
    const typeSelect = h(
      "select",
      {
        "aria-label": "Filter by drive type",
        onchange: () => {
          state.type = typeSelect.value;
          renderList();
        },
      },
      h("option", { value: "" }, "All types"),
      h("option", { value: "challenge" }, "Challenges"),
      h("option", { value: "free" }, "Free drives"),
    );
    const citySelect = h(
      "select",
      {
        "aria-label": "Filter by city",
        onchange: () => {
          state.city = citySelect.value;
          renderList();
        },
      },
      h("option", { value: "" }, "All cities"),
      ...cities.map((c) => h("option", { value: c }, c)),
    );
    const driverSelect = h(
      "select",
      {
        "aria-label": "Filter by driver",
        onchange: () => {
          state.driver = driverSelect.value;
          renderList();
        },
      },
      h("option", { value: "" }, "All drivers"),
      ...drivers.map((d) => h("option", { value: d }, d)),
    );

    let clearArmed = false,
      clearTimer = null;
    const clearBtn = h(
      "button",
      {
        type: "button",
        class: "chip-button history-clear",
        disabled: !history.length,
        onclick: () => {
          if (!clearArmed) {
            clearArmed = true;
            clearBtn.textContent = "Confirm clear?";
            clearBtn.classList.add("confirming");
            clearTimer = setTimeout(() => {
              clearArmed = false;
              clearBtn.textContent = "Clear history";
              clearBtn.classList.remove("confirming");
            }, 4000);
            return;
          }
          clearTimeout(clearTimer);
          clearArmed = false;
          clearBtn.textContent = "Clear history";
          clearBtn.classList.remove("confirming");
          if (!writeHistory([])) {
            statusEl.textContent = "Could not clear drive history.";
            return;
          }
          history = [];
          statusEl.textContent = "Drive history cleared.";
          renderList();
        },
      },
      "Clear history",
    );

    const renderList = () => {
      const terms = norm(state.query).trim().split(/\s+/).filter(Boolean);
      const filtered = history.filter((r) => {
        if (state.type === "challenge" && !r.config?.challenge) return false;
        if (state.type === "free" && r.config?.challenge) return false;
        if (state.city && r.map !== state.city) return false;
        if (state.driver && r.driver !== state.driver) return false;
        if (!terms.length) return true;
        const hay = norm(`${r.title} ${r.map} ${r.driver} ${r.status}`);
        return terms.every((t) => hay.includes(t));
      });

      const qualified = filtered.filter((r) => r.qualified && Number.isFinite(r.score));
      const avg = qualified.length
        ? Math.round(qualified.reduce((acc, r) => acc + r.score, 0) / qualified.length)
        : null;
      const best = qualified.length ? Math.max(...qualified.map((r) => r.score)) : null;
      trendEl.hidden = !history.length;
      trendEl.replaceChildren(
        h("span", {}, "Drives: ", h("strong", {}, String(filtered.length))),
        h("span", {}, "Average score: ", h("strong", {}, avg !== null ? `${avg}/100` : "—")),
        h("span", {}, "Best score: ", h("strong", {}, best !== null ? `${best}/100` : "—")),
      );
      clearBtn.disabled = !history.length;

      if (!history.length) {
        listWrap.replaceChildren(
          h(
            "p",
            { class: "empty-state" },
            "Your first drive starts with a destination. Finish it to see your report here.",
          ),
        );
        return;
      }
      if (!filtered.length) {
        listWrap.replaceChildren(h("p", { class: "empty-state muted" }, "No drives match the current filters."));
        return;
      }
      listWrap.replaceChildren(
        ...filtered.map((r) =>
          h(
            "div",
            { class: "history-row" },
            h(
              "button",
              { type: "button", class: "history-entry", onclick: () => this.show(r) },
              h("strong", {}, r.qualified ? `${r.score} / ${r.grade}` : "Practice"),
              h(
                "span",
                {},
                r.title,
                h(
                  "small",
                  {},
                  `${r.map} · ${r.driver} · ${(r.distance_m / 1000).toFixed(2)} km · ${new Date(r.started_at).toLocaleDateString()}`,
                ),
              ),
            ),
            h(
              "button",
              {
                type: "button",
                class: "chip-button history-delete",
                "aria-label": `Delete ${r.title}`,
                title: "Delete drive",
                onclick: () => {
                  const latest = readHistory();
                  const record = JSON.stringify(r);
                  const index = latest.findIndex((drive) => JSON.stringify(drive) === record);
                  if (index !== -1) {
                    latest.splice(index, 1);
                    if (!writeHistory(latest)) {
                      statusEl.textContent = "Could not save the updated history.";
                      return;
                    }
                  }
                  history = latest;
                  statusEl.textContent = index === -1 ? "That drive is already gone." : `Deleted "${r.title}".`;
                  renderList();
                },
              },
              "×",
            ),
          ),
        ),
      );
    };

    this.dialog.replaceChildren(
      h(
        "div",
        { class: "dialog-header" },
        h("span", { class: "label" }, "YOUR DRIVES"),
        h("button", { class: "toggle", "aria-label": "Close history", onclick: () => this.dialog.close() }, "×"),
      ),
      h("h2", {}, "Every drive, a little better."),
      h("p", { class: "muted" }, "Your last 20 drives, saved on this device."),
      trendEl,
      history.length
        ? h("div", { class: "history-filters" }, searchInput, typeSelect, citySelect, driverSelect, clearBtn)
        : null,
      statusEl,
      listWrap,
    );
    renderList();
    this.open();
  }

  open() {
    if (!this.dialog.open) {
      this.onOpen();
      this.dialog.showModal();
    }
  }

  export(report) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
    const a = h("a", { href: url, download: exportFilename(report, "json", "jev-report") });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async share(action, success) {
    try {
      await action();
      this.shareStatus.textContent = success;
    } catch (error) {
      this.shareStatus.replaceChildren(
        error.message,
        error.link
          ? h("input", {
              value: error.link,
              readonly: true,
              "aria-label": "Challenge link",
              style: { width: "100%", marginTop: "8px" },
              onfocus: (ev) => ev.target.select(),
            })
          : null,
      );
    }
  }
}
