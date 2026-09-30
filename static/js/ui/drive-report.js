import { $, h } from "../common.js";
import { readHistory } from "../sim/drive-score.js";

const time = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const labels = { safety: "Safety", legality: "Road rules", comfort: "Smoothness", control: "Control" };

export class DriveReport {
  constructor({ onFinish, onNewDrive, onOpen = () => {}, onClose = () => {} }) {
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
    $("#hud").append(this.card);
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
    this.title.textContent = r.title;
    this.stats.textContent = `${(r.distance_m / 1000).toFixed(2)} km · ${time(r.elapsed_s)} · ${r.qualified ? `Grade ${r.grade}` : "100 m to qualify"}`;
    this.coach.textContent = r.status === "active" ? r.coach : `${r.status === "arrived" ? "Destination reached" : "Drive finished"} · ${r.tips[0]}`;
    this.finishButton.disabled = r.status !== "active";
    this.bars.replaceChildren(...this.categoryBars(r));
  }

  categoryBars(r) {
    return Object.entries(r.categories).map(([key, value]) => h("div", { class: "score-category" },
      h("span", {}, labels[key]), h("div", { class: "score-track" }, h("i", { style: { width: `${value}%`, background: value >= 80 ? "var(--good)" : value >= 60 ? "var(--warn)" : "var(--bad)" } })), h("b", {}, value)));
  }

  show(report, saved = true) {
    this.dialog.replaceChildren(
      h("div", { class: "dialog-header" }, h("span", { class: "label" }, "DRIVE REPORT"), h("button", { class: "toggle", "aria-label": "Close report", onclick: () => this.dialog.close() }, "×")),
      h("h2", {}, report.title), h("p", { class: "muted" }, `${report.map} · ${report.driver} · ${report.status}`),
      h("div", { class: "report-score" }, h("strong", {}, report.qualified ? report.score : "—"), h("span", {}, report.qualified ? `Grade ${report.grade} / 100` : "Practice drive · not yet graded")),
      h("div", { class: "report-metrics" }, h("span", {}, `${(report.distance_m / 1000).toFixed(2)} km`), h("span", {}, time(report.elapsed_s)), h("span", {}, `${report.max_kmh} km/h peak`)),
      h("div", { class: "report-categories" }, this.categoryBars(report)),
      h("h3", {}, "For your next drive"), h("ul", { class: "report-tips" }, report.tips.map(t => h("li", {}, t))),
      h("details", {}, h("summary", {}, `${report.incidents.length} recorded events`),
        h("ol", { class: "report-events" }, report.incidents.map(i => h("li", {}, `${time(i.at_s)} · ${i.at_m} m · ${i.message}`)))),
      h("p", { class: "score-explanation" }, "Score = 40% safety + 30% road rules + 20% smoothness + 10% control. Collisions cap the score at 59; red lights and failures to yield at 69. Waiting at lights carries no penalty. Simulation coaching model v1."),
      h("div", { class: "dialog-footer" }, h("span", { class: "muted" }, saved ? "Saved on this device" : "Storage unavailable · export to keep this drive"),
        h("button", { id: "export-drive", class: "toggle", onclick: () => this.export(report) }, "Export JSON")));
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
}
