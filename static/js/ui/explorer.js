import { $, api, h } from "../common.js";

export class Explorer {
  constructor({ map, getStart, onDrive, onMap, onOpen, onClose }) {
    Object.assign(this, { map, getStart, onDrive, onMap, onOpen });
    this.maps = []; this.drives = []; this.generation = 0;
    this.dialog = h("dialog", { class: "drive-dialog explorer-dialog", "aria-label": "Explore cities and drives" });
    this.dialog.addEventListener("close", () => { this.generation++; onClose(); });
    this.dialog.addEventListener("click", ev => { if (ev.target === this.dialog) this.dialog.close(); });
    document.body.append(this.dialog);
    $("#explore-world").addEventListener("click", () => this.open());
    this.loadMaps();
  }

  async loadMaps() {
    try { this.maps = (await api("/api/maps")).maps; }
    catch (err) { this.mapError = err.message; }
    if (this.dialog.open) this.render();
  }

  async open() {
    if (this.dialog.open) return;
    this.onOpen(); this.dialog.showModal(); this.drives = []; this.driveError = null; this.loading = true;
    this.render();
    const generation = ++this.generation;
    try {
      const { drives } = await api("/api/drives", { bbox: this.map.bbox.join(","), from: this.getStart() });
      if (generation !== this.generation) return;
      this.drives = drives;
    } catch (err) { if (generation === this.generation) this.driveError = err.message; }
    if (generation !== this.generation) return;
    this.loading = false; this.render();
  }

  render() {
    this.dialog.replaceChildren(
      h("div", { class: "dialog-header" }, h("span", { class: "label" }, "JEV / WORLD EXPLORER"), h("button", { class: "toggle", "aria-label": "Close explorer", onclick: () => this.dialog.close() }, "×")),
      h("h2", {}, "A different city. A better drive."), h("p", { class: "muted" }, "Real Canadian streets. Your own pace. Every drive is a chance to improve."),
      h("div", { class: "city-grid" }, this.maps.map(m => this.cityCard(m))),
      this.mapError ? h("p", { class: "error-note" }, `Map list unavailable: ${this.mapError}`) : document.createDocumentFragment(),
      h("div", { class: "explorer-section" }, h("h3", {}, `Start from here · ${this.map.label}`), h("span", { class: "muted" }, "Reachable routes from your car’s current position")),
      this.loading ? h("p", { class: "empty-state" }, "Finding a few good drives…") : this.driveError ? h("p", { class: "error-note" }, `Could not find drives: ${this.driveError}`)
        : this.drives.length ? h("div", { class: "mission-grid" }, this.drives.map(d => this.driveCard(d)))
        : h("p", { class: "empty-state" }, "No suggested routes here. Return to a lane or choose a destination on the minimap."),
      h("div", { class: "dialog-footer" }, h("span", { class: "muted" }, "Map data © OpenStreetMap contributors · ODbL"),
        h("a", { class: "text-button", href: `/bench?bbox=${encodeURIComponent(this.map.bbox.join(","))}`, target: "_blank", rel: "noopener" }, "Benchmark this city ↗"),
        h("button", { class: "toggle", onclick: () => this.dialog.close() }, "Just drive")));
  }

  cityCard(m) {
    const current = m.id === this.map.id;
    const canvas = h("canvas", { width: 480, height: 220, "aria-hidden": "true" });
    drawMapPreview(canvas, m);
    return h("button", { class: `city-card ${current ? "selected" : ""}`, "data-map": m.id, style: { "--city-accent": m.accent },
      onclick: () => { if (!current) this.onMap(m.id); } }, canvas,
      h("div", { class: "city-card-body" }, h("div", { class: "city-eyebrow" }, m.province), h("h3", {}, m.city), h("strong", {}, m.name),
        h("p", {}, m.description), h("div", { class: "city-meta" }, h("span", {}, `${m.stats.roads || "—"} roads · ${m.stats.signals || 0} signals`),
          h("b", {}, current ? "Driving here" : m.cached ? "Explore ↗" : "Download ↗"))));
  }

  driveCard(d) {
    return h("button", { class: "mission-card", "data-drive": d.id, onclick: () => { this.dialog.close(); this.onDrive(d); } },
      h("span", { class: "mission-difficulty" }, d.difficulty), h("h3", {}, d.title), h("p", {}, d.description),
      h("div", { class: "mission-meta" }, `${(d.length_m / 1000).toFixed(1)} km · ${d.turns} turns · ${d.signals} lights · ${d.stops} stops`),
      h("span", { class: "mission-start" }, "Start drive →"));
  }
}

function drawMapPreview(canvas, map) {
  const ctx = canvas.getContext("2d"), w = canvas.width, height = canvas.height;
  ctx.fillStyle = "#111e26"; ctx.fillRect(0, 0, w, height);
  if (!map.extent) return;
  const [x0, y0, x1, y1] = map.extent, scale = Math.max(w / (x1 - x0), height / (y1 - y0)) * 0.92;
  const x = p => w / 2 + (p[0] - (x0 + x1) / 2) * scale;
  const y = p => height / 2 - (p[1] - (y0 + y1) / 2) * scale;
  for (const major of [false, true]) {
    ctx.strokeStyle = major ? map.accent : "#374850"; ctx.lineWidth = major ? 2.8 : 1.2;
    ctx.beginPath();
    for (const road of map.preview) if (road.major === major) {
      ctx.moveTo(x(road.pts[0]), y(road.pts[0]));
      for (const p of road.pts.slice(1)) ctx.lineTo(x(p), y(p));
    }
    ctx.stroke();
  }
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, "#11192300"); gradient.addColorStop(1, "#111923");
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, w, height);
}
