import { $, h, appUrl } from "../common.js";
import { CHALLENGES, challengeConfig } from "../lab/challenges.js";
import { driveLink } from "../lab/share.js";
import { agentDefinitions, registerAgent } from "../brain/registry.js";
import { replayPosition } from "../lab/playback.js";

export class DriveLab {
  constructor({ city, demo, configured, onScenic, onPause, onSeek, onBranch, onLive, onAgent, onPerception }) {
    Object.assign(this, { configured, onSeek, onBranch, onLive, onAgent });
    this.dialog = h("dialog", { class: "lab-dialog", "aria-label": "Drive lab" });
    this.dialog.addEventListener("close", () => onPause(false));
    document.body.append(this.dialog);
    this.city = city; this.demo = demo; this.onPause = onPause; this.onScenic = onScenic;
    const actions = h("div", { class: "lab-actions" },
      h("button", { class: "chip-button", onclick: () => this.home() }, "Drive lab"),
      h("button", { class: "chip-button", onclick: () => this.challenges() }, "Challenges"),
      this.eyes = h("button", { class: "chip-button", "aria-pressed": "false", onclick: () => {
        const enabled = this.eyes.getAttribute("aria-pressed") !== "true";
        this.eyes.setAttribute("aria-pressed", String(enabled)); this.perception.hidden = !enabled; onPerception(enabled);
      } }, "AI eyes"),
      this.inspect = h("button", { class: "chip-button", "aria-pressed": "false", onclick: () => {
        const enabled = !document.body.classList.contains("telemetry-expanded");
        document.body.classList.toggle("telemetry-expanded", enabled); this.inspect.setAttribute("aria-pressed", String(enabled));
      } }, "Telemetry"));
    $(".hud-top-left").append(actions);
    this.perception = h("section", { class: "perception-panel panel", hidden: true, "aria-label": "Geometric perception" },
      h("span", { class: "label" }, "AI EYES / GEOMETRIC SENSING"),
      this.sight = h("p", {}, "Observing the street…"),
      h("p", { class: "perception-legend" }, "Green: visible · Red: hidden from driver · Yellow: selected path"),
      h("p", { class: "muted" }, "Hidden-object boxes use world truth for inspection; the driver cannot see them."),
      this.rejections = h("div", { class: "candidate-rejections" }));
    $("#hud-right").append(this.perception);
    this.replay = h("section", { class: "replay-deck panel", hidden: true, "aria-label": "Recorded drive replay" },
      h("div", { class: "replay-heading" }, h("span", { class: "label" }, "DRIVE REPLAY"), this.replayStatus = h("span", { class: "muted" }, "Recording · last 120 seconds"),
        h("button", { class: "chip-button", onclick: () => this.openReplay() }, "Rewind")),
      this.controls = h("div", { class: "replay-controls", hidden: true },
        this.slider = h("input", { type: "range", min: 0, max: 0, step: 1, value: 0, "aria-label": "Replay time", oninput: () => this.seek(Number(this.slider.value)) }),
        h("div", { class: "replay-buttons" },
          this.play = h("button", { class: "chip-button", onclick: () => this.togglePlayback() }, "Play replay"),
          h("button", { class: "chip-button", onclick: () => this.previousIncident() }, "Before incident"),
          h("button", { class: "chip-button", onclick: () => this.branch("manual") }, "Take over here"),
          this.branchAgent = h("select", { "aria-label": "Branch driver" }, ...agentDefinitions().filter(a => a.id !== "jev" || configured).map(a => h("option", { value: a.id }, a.label))),
          h("button", { class: "chip-button", onclick: () => this.branch(this.branchAgent.value) }, "Try this driver"),
          this.branchCandidate = h("select", { "aria-label": "Alternate manoeuvre" }),
          h("button", { class: "chip-button", onclick: () => this.branch(`candidate:${this.branchCandidate.value}`) }, "Try manoeuvre"),
          h("button", { class: "chip-button", onclick: () => this.live() }, "Return to drive"))));
    document.body.append(this.replay);
    const settings = $("#settings");
    settings.append(h("h3", { class: "settings-section-heading" }, "Driving agents"),
      h("label", { class: "wide" }, h("span", { class: "label" }, "Active agent"), this.agent = h("select", { "aria-label": "Active agent", onchange: () => onAgent(this.agent.value) }, ...agentDefinitions().map(a => h("option", { value: a.id, disabled: a.id === "jev" && !configured }, a.label)))),
      h("label", { class: "wide" }, h("span", { class: "label" }, "Local agent module"), this.module = h("input", { type: "text", placeholder: "/js/agents/my-agent.js", "aria-label": "Local agent module" })),
      h("button", { class: "toggle wide", onclick: () => this.loadAgent() }, "Load agent"), this.agentStatus = h("p", { class: "muted wide", role: "status" }, "Trusted JavaScript modules run in this browser."));
    this.lastTick = -Infinity; this.playing = false; this.reviewing = false;
    this.replayElapsed = 0; this.replayAlpha = 0;
  }
  open(content) {
    this.dialog.replaceChildren(h("div", { class: "lab-dialog-top" }, h("span", { class: "brand" }, "JEV / DRIVE LAB"),
      h("button", { class: "chip-button", "aria-label": "Close drive lab", onclick: () => this.dialog.close() }, "Back to street ↗")), content);
    if (!this.dialog.open) { this.onPause(true); this.dialog.showModal(); }
  }
  home() {
    this.open(h("div", {},
      h("div", { class: "lab-eyebrow" }, `${this.city.city || "Canada"} · REAL STREETS / OPEN SOURCE`),
      h("h1", { class: "lab-hero-title" }, "Your city.", h("br"), h("span", {}, "A different driver.")),
      h("p", { class: "lab-hero-copy" }, "Take the wheel, challenge an AI, or look inside its next decision. Every drive has something to teach you."),
      h("div", { class: "welcome-options" },
        this.welcomeCard("01", "Take a scenic drive", "Real neighbourhoods. Golden light. Find your rhythm.", "Start cruising →", () => this.scenic("manual")),
        this.welcomeCard("02", "Can you beat the AI?", "Six authored challenges. The same conditions for every driver.", "Pick a challenge →", () => this.challenges()),
        this.welcomeCard("03", "Watch the AI drive", "Follow its choices, then rewind and try your own.", "Watch Rules →", () => this.scenic("rules"))),
      h("div", { class: "lab-footer" }, h("span", {}, "8 neighbourhoods · 7 Canadian cities · No key needed for Rules"),
        h("a", { href: "https://github.com/BrendanH18/jev_fsd", target: "_blank", rel: "noopener" }, "Star on GitHub ↗")),
      h("p", { class: "lab-footnote" }, this.demo ? "Public browser demo · Rules and starter agents run locally in your browser. Keyboard driving on desktop." : "Local drive lab · WASD to drive · J for autopilot · P to pause. Research simulator.")));
  }
  welcomeCard(number, title, copy, action, onclick) {
    return h("button", { class: "welcome-card", onclick }, h("span", { class: "welcome-number" }, number), h("h2", {}, title), h("p", {}, copy), h("strong", {}, action));
  }
  async scenic(driver) {
    this.dialog.close();
    try { await this.onScenic(driver); } catch (error) { this.open(h("div", {}, h("h2", {}, "Could not find a scenic drive."), h("p", {}, error.message), h("button", { class: "toggle", onclick: () => this.scenic(driver) }, "Try again"))); }
  }
  challenges() {
    this.open(h("div", {}, h("div", { class: "lab-eyebrow" }, "SAME STREET. SAME HAZARD. YOUR MOVE."),
      h("h1", { class: "challenge-title" }, "Can you beat the AI?"),
      h("p", { class: "lab-hero-copy" }, "Choose a short drive. Compare complete arrivals under the same conditions; a higher score alone does not mean a safer driver."),
      h("label", { class: "challenge-driver" }, "Drive with ", this.challengeDriver = h("select", { "aria-label": "Challenge driver" },
        h("option", { value: "manual" }, "Me · manual"), ...agentDefinitions().filter(a => a.id !== "jev" || this.configured).map(a => h("option", { value: a.id }, a.label)))),
      h("div", { class: "challenge-grid" }, CHALLENGES.map(c => h("button", { class: "challenge-card", onclick: () => location.assign(driveLink({ ...challengeConfig(c), drive: this.challengeDriver.value })) },
        h("div", { class: "challenge-card-top" }, h("span", { class: "challenge-icon" }, c.icon), h("span", { class: "label" }, c.difficulty)),
        h("h2", {}, c.title), h("p", {}, c.description), h("div", { class: "challenge-card-meta" }, `${c.map.replaceAll("_", " ")} · ${c.weather} · ${c.time}`), h("strong", {}, "Try challenge →")))),
      h("div", { class: "lab-footer" }, h("button", { class: "chip-button", onclick: () => this.home() }, "← Drive lab"),
        h("a", { href: appUrl(this.demo ? "arena.html" : "arena"), target: "_blank", rel: "noopener" }, "Evaluate agents ↗"))));
  }
  setAgent(name) { this.agent.value = name; }
  async loadAgent() {
    try {
      const url = new URL(this.module.value, location.href);
      if (url.origin !== location.origin || !url.pathname.endsWith(".js")) throw new Error("Use a trusted .js module served by this app.");
      const { default: definition } = await import(url.href);
      registerAgent(definition); this.onAgent(definition.id, definition);
      for (const select of [this.agent, this.branchAgent]) select.append(h("option", { value: definition.id }, definition.label));
      this.agent.value = definition.id; this.agentStatus.textContent = `${definition.label} loaded. Set a destination and enable autopilot.`;
    } catch (error) { this.agentStatus.textContent = error.message; }
  }
  showPerception(data) {
    if (!data) return;
    this.sight.textContent = `${data.seen} visible · ${data.hidden} hidden · ${Math.round(data.range)} m sight · ${Math.round(data.safeSpeed)} km/h sight-limited target`;
    this.rejections.replaceChildren(...data.rejected.slice(0, 4).map(c => h("div", {}, h("span", {}, c.id.replaceAll("_", " ")), h("b", {}, c.reason))));
  }
  update(recorder, now) {
    this.recorder = recorder; this.replay.hidden = recorder.frames.length < 2;
    if (this.reviewing && this.playing) {
      const position = replayPosition(recorder.frames, Number(this.slider.value), this.replayElapsed + Math.max(0, now - this.lastTick) / 1000);
      if (position.index !== Number(this.slider.value)) this.seek(position.index);
      this.replayElapsed = position.elapsed; this.replayAlpha = position.alpha;
      if (position.ended) { this.playing = false; this.play.textContent = "Play replay"; }
      this.lastTick = now;
    }
    if (!this.reviewing) { this.slider.max = Math.max(0, recorder.frames.length - 1); this.slider.value = this.slider.max; }
  }
  togglePlayback() {
    if (!this.reviewing || !this.recorder?.frames.length) return;
    if (!this.playing && Number(this.slider.value) === this.recorder.frames.length - 1) this.seek(0);
    this.playing = !this.playing; this.lastTick = performance.now();
    this.play.textContent = this.playing ? "Pause replay" : "Play replay";
  }
  openReplay() {
    if (!this.recorder?.frames.length || this.reviewing) return;
    this.reviewing = true; this.controls.hidden = false;
    this.slider.max = this.recorder.frames.length - 1; this.seek(Math.max(0, this.recorder.frames.length - 11));
  }
  seek(index) {
    this.replayElapsed = 0; this.replayAlpha = 0; this.lastTick = performance.now();
    this.slider.value = index; this.onSeek(index);
    const frame = this.recorder.frames[index];
    this.branchCandidate.replaceChildren(...(frame?.state.pilot.lastDecision?.candidates || []).filter(c => c.eligible).map(c => h("option", { value: c.id },
      `${c.steer || "Hold lane"} · ${Number.isFinite(c.law.vTarget) ? `${Math.round(c.law.vTarget * 3.6)} km/h` : c.speed || "stop"}`)));
    this.replayStatus.textContent = `${frame?.t.toFixed(1) || 0} s · recorded checkpoints every 0.5 s`;
  }
  previousIncident() {
    const t = this.recorder.frames[Number(this.slider.value)]?.t ?? Infinity;
    const marker = [...this.recorder.markers].reverse().find(m => m.t < t);
    const target = marker ? Math.max(this.recorder.frames[0].t, marker.t - 3) : this.recorder.frames[0].t;
    this.seek(Math.max(0, this.recorder.frames.findLastIndex(f => f.t <= target)));
  }
  branch(driver) { if (this.onBranch(Number(this.slider.value), driver) !== false) this.endReview(); }
  live() { this.onLive(); this.endReview(); }
  endReview() { this.reviewing = false; this.playing = false; this.replayElapsed = 0; this.replayAlpha = 0; this.controls.hidden = true; this.play.textContent = "Play replay"; this.replayStatus.textContent = "Recording · last 120 seconds"; }
}
