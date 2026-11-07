import { $, h } from "../common.js";
import { readHistory } from "../sim/drive-score.js";
import { exportDriveCard, copyDriveLink, driveLink } from "../lab/share.js";
import { CHALLENGES, challengeById, challengeConfig } from "../lab/challenges.js";
import { readPractice, practiceStatus, challengeFailures } from "../lab/practice.js";
import { examinerSheet, roadTestNote } from "./road-test.js";

const time = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const labels = { safety: "Safety", legality: "Road rules", comfort: "Smoothness", control: "Control" };

export class DriveReport {
  constructor({ onFinish, onNewDrive, onReplay, getReplayTarget = () => null, onOpen = () => {}, onClose = () => {} }) {
    this.onReplay = onReplay;
    this.getReplayTarget = getReplayTarget;
    this.current = null; this.lastUpdate = -Infinity;
    this.onOpen = onOpen;
    this.card = h("section", { class: "drive-card panel", "aria-label": "Drive score" },
      h("div", { class: "drive-heading" }, h("span", { class: "label" }, "DRIVE COACH"),
        h("button", { class: "text-button", onclick: () => this.showHistory() }, "History ↗")),
      h("div", { class: "drive-score-row" }, this.number = h("strong", { class: "drive-number" }, "—"),
        h("div", {}, this.title = h("div", { class: "drive-title" }, "Your next great drive"), this.stats = h("div", { class: "muted" }, "Select a destination or take the wheel"))),
      this.bars = h("div", { class: "drive-bars" }),
      this.coach = h("p", { class: "drive-coach" }, "A score for safety, road rules, smoothness and control."),
      h("div", { class: "drive-actions" }, h("button", { id: "new-drive", class: "toggle", onclick: onNewDrive }, "Explore drives"),
        this.finishButton = h("button", { id: "finish-drive", class: "toggle", disabled: true, onclick: onFinish }, "Finish & review")));
    ($("#hud-left") || $("#hud")).append(this.card);
    this.dialog = h("dialog", { class: "drive-dialog", "aria-label": "Drive report" });
    this.dialog.addEventListener("click", ev => { if (ev.target === this.dialog) this.dialog.close(); });
    this.dialog.addEventListener("close", onClose);
    document.body.append(this.dialog);
  }

  update(session, now = performance.now()) {
    if (now - this.lastUpdate < 200) return;
    this.lastUpdate = now;
    if (!session) return;
    const r = this.current = session.snapshot();
    this.number.textContent = r.qualified ? r.score : "—";
    this.number.dataset.grade = r.grade;
    this.number.dataset.qualified = String(r.qualified);
    this.title.textContent = r.title;
    this.stats.textContent = `${(r.distance_m / 1000).toFixed(2)} km · ${time(r.elapsed_s)} · ${r.qualified ? `Grade ${r.grade}` : "100 m to qualify"}`;
    const reached = r.parking?.result === "parked" ? "Parked at the destination" : r.parking && r.parking.result !== "not yet" ? `Destination reached · ${r.parking.result}` : "Destination reached";
    this.coach.textContent = r.status === "active" ? r.coach : `${r.status === "arrived" ? reached : "Drive finished"} · ${r.tips[0]}`;
    this.finishButton.disabled = r.status !== "active";
    this.bars.replaceChildren(...this.categoryBars(r));
  }

  categoryBars(r) {
    return Object.entries(r.categories).map(([key, value]) => h("div", { class: "score-category" },
      h("span", {}, labels[key]), h("div", { class: "score-track" }, h("i", { style: { width: `${value}%`, background: value >= 80 ? "var(--good)" : value >= 60 ? "var(--warn)" : "var(--bad)" } })), h("b", {}, value)));
  }

  debrief(challenge, report) {
    const reasons = challengeFailures(challenge, report);
    const messages = reasons?.map(reason => ({ timeout: "Destination not reached.", stuck: "Destination not reached: the car got stuck.",
      "not parked": "Not parked within 30 cm of the kerb at the destination." }[reason] || reason));
    if (report.resets > 0) messages?.push("Returned the car to its lane. Retry without resetting to earn manual completion.");
    const clean = messages?.length === 0;
    return h("section", { class: "challenge-debrief", "aria-label": "Challenge debrief" },
      h("span", { class: "label" }, "CHALLENGE DEBRIEF"),
      h("strong", { class: `challenge-verdict${clean ? " clean" : ""}` },
        reasons === null ? "Completion unavailable" : clean ? "Clean arrival" : "Not completed cleanly"),
      reasons === null ? h("p", {}, "This saved report does not contain enough information to confirm a clean arrival.")
        : clean ? h("p", {}, "Reached the destination with no challenge failures. The coaching grade is separate.")
          : h("div", {}, h("p", {}, "What prevented a clean completion:"), h("ul", { class: "report-tips challenge-failures" }, messages.map(message => h("li", {}, message)))),
      h("h3", {}, "The lesson"), h("p", { class: "challenge-lesson" }, challenge.lesson),
      report.config?.version !== (challenge.version || 1) ? h("p", { class: "muted" }, "The lesson shown is from the current challenge version; this report used an earlier version.") : null);
  }

  replayIncident(report, incident) {
    // Revalidate when clicked: a new drive or replay branch can replace the recording.
    const index = this.getReplayTarget(report, incident);
    if (!this.onReplay || !Number.isInteger(index)) return false;
    this.onReplay(index); this.dialog.close();
    return true;
  }

  incidentRow(report, incident) {
    const text = `${time(incident.at_s)} · ${incident.at_m} m · ${incident.message}`;
    const available = this.onReplay && Number.isInteger(this.getReplayTarget(report, incident));
    const row = h("li");
    const unavailable = () => row.replaceChildren(text, h("small", { class: "incident-replay-unavailable" }, "Replay unavailable · event is outside the current recording."));
    if (available) row.append(h("button", { class: "incident-replay", type: "button", onclick: () => {
      if (!this.replayIncident(report, incident)) unavailable();
    } }, text, h("span", {}, "Rewind before event →")));
    else unavailable();
    return row;
  }

  show(report, saved = true) {
    const challenge = challengeById(report.config?.challenge);
    const records = challenge ? readPractice().records : {};
    const remaining = challenge ? CHALLENGES.filter(c => c.id !== challenge.id) : [];
    const next = remaining.find(c => practiceStatus(c, records) === "attempted") || remaining.find(c => practiceStatus(c, records) === "untried");
    const practiceNote = report.practice?.outcome === "completed" ? "Clean manual arrival. Challenge completed."
      : report.practice?.outcome === "attempted" ? "Manual attempt recorded. Retry for a clean arrival."
      : "AI, mixed-driver, modified and replay drives do not change your manual practice progress.";
    // (a road test, lab/road-tests.js, is marked on the examiner's sheet instead: ui/road-test.js)
    const roadTest = !!challenge?.roadTest;
    this.dialog.replaceChildren(
      h("div", { class: "dialog-header" }, h("span", { class: "label" }, "DRIVE REPORT"), h("button", { class: "toggle", "aria-label": "Close report", onclick: () => this.dialog.close() }, "×")),
      h("h2", {}, report.title), h("p", { class: "muted" }, `${report.map} · ${report.driver} · ${report.status}${report.parking && report.parking.result !== "not yet" ? ` · ${report.parking.result}${report.parking.result === "parked" ? `, ${Math.round(report.parking.kerb_m * 100)} cm from the kerb` : ""}` : ""}${report.modified ? " · modified challenge" : ""}`),
      roadTest ? examinerSheet(challenge, report, incident => this.incidentRow(report, incident)) : challenge ? this.debrief(challenge, report) : null,
      h("div", { class: "report-score" }, h("strong", {}, report.qualified ? report.score : "—"), h("span", {}, report.qualified ? `Grade ${report.grade} / 100` : "Practice drive · not yet graded")),
      h("div", { class: "report-metrics" }, h("span", {}, `${(report.distance_m / 1000).toFixed(2)} km`), h("span", {}, time(report.elapsed_s)), h("span", {}, `${report.max_kmh} km/h peak`)),
      h("div", { class: "report-categories" }, this.categoryBars(report)),
      h("h3", {}, "For your next drive"), h("ul", { class: "report-tips" }, report.tips.map(t => h("li", {}, t))),
      h("details", {}, h("summary", {}, `${report.incidents.length} recorded events`),
        h("ol", { class: "report-events" }, report.incidents.map(i => this.incidentRow(report, i)))),
      h("p", { class: "score-explanation" }, `Score = 40% safety + 30% road rules + 20% smoothness + 10% control. Collisions cap the score at 59; red lights and failures to yield at 69. Waiting at lights carries no penalty. Simulation coaching model v1.${report.branched ? " This drive includes a replay takeover." : ""}`),
      challenge ? h("p", { class: "challenge-practice-note" }, roadTest ? roadTestNote(challenge, report) : practiceNote,
        report.practice?.outcome ? (report.practice.saved ? " Progress saved in this browser." : " Browser storage is unavailable; progress could not be saved.") : "") : null,
      this.shareStatus = h("p", { class: "report-share-status", role: "status" }),
      h("div", { class: "dialog-footer" }, h("span", { class: "muted" }, saved ? "Saved on this device" : "Storage unavailable · export to keep this drive"),
        h("button", { id: "export-drive", class: "toggle", onclick: () => this.export(report) }, "Export JSON"),
        h("button", { class: "toggle", onclick: () => this.share(() => exportDriveCard(report, report.config), "Image saved. Share it with your challenge link.") }, "Save score card"),
        report.config ? h("button", { class: "toggle", onclick: () => this.share(() => copyDriveLink(report.config), "Link copied. It recreates the setup, not the recorded drive.") }, report.config.challenge ? "Copy challenge link" : "Copy setup link") : null,
        report.config?.challenge ? h("a", { class: "toggle", href: driveLink({ ...report.config, drive: "rules" }) }, "Try with Rules") : null,
        challenge ? h("a", { class: "toggle", href: driveLink({ ...challengeConfig(challenge), drive: "manual" }) }, "Retry manually") : null,
        next ? h("a", { class: "toggle", href: driveLink({ ...challengeConfig(next), drive: "manual" }) }, `Practise next: ${next.title}`) : null,
        this.onReplay && Number.isInteger(this.getReplayTarget(report)) ? h("button", { class: "toggle", onclick: () => this.replayIncident(report) }, "Review replay") : null));
    this.open();
  }

  showHistory() {
    const history = readHistory();
    this.dialog.replaceChildren(h("div", { class: "dialog-header" }, h("span", { class: "label" }, "YOUR DRIVES"), h("button", { class: "toggle", "aria-label": "Close history", onclick: () => this.dialog.close() }, "×")),
      h("h2", {}, "Every drive, a little better."), h("p", { class: "muted" }, "Your last 20 drives, saved on this device."),
      history.length ? h("div", { class: "history-list" }, history.map(r => h("button", { class: "history-entry", onclick: () => this.show(r) },
        h("strong", {}, r.qualified ? `${r.score} / ${r.grade}` : "Practice"), h("span", {}, r.title, h("small", {}, `${r.map} · ${(r.distance_m / 1000).toFixed(2)} km · ${new Date(r.started_at).toLocaleDateString()}`)))))
        : h("p", { class: "empty-state" }, "Your first drive starts with a destination. Finish it to see your report here."));
    this.open();
  }

  open() { if (!this.dialog.open) { this.onOpen(); this.dialog.showModal(); } }

  export(report) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
    const a = h("a", { href: url, download: "jev-drive-report.json" }); a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async share(action, success) {
    try { await action(); this.shareStatus.textContent = success; }
    catch (error) { this.shareStatus.replaceChildren(error.message, error.link ? h("input", { value: error.link, readonly: true, "aria-label": "Challenge link", style: { width: "100%", marginTop: "8px" }, onfocus: ev => ev.target.select() }) : null); }
  }
}
