import { $, api, h } from "../common.js";

const searchText = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export function filterMaps(maps, { query = "", region = "", character = "" } = {}) {
  const words = searchText(query).trim().split(/\s+/).filter(Boolean);
  return maps.filter(m => (!region || m.province === region) && (!character || m.character === character)
    && words.every(word => searchText([m.name, m.city, m.province, m.character, m.description].join(" ")).includes(word)));
}

export class Explorer {
  constructor({ map, getStart, onDrive, onMap, onOpen, onClose, request = api }) {
    Object.assign(this, { map, getStart, onDrive, onMap, onOpen, onClose, request });
    this.maps = []; this.drives = []; this.generation = 0;
    this.mapsLoading = false; this.loading = false; this.filters = { query: "", region: "", character: "" };
    this.dialog = h("dialog", { class: "drive-dialog explorer-dialog", "aria-label": "Explore neighbourhoods and drives" });
    // Native close events are queued: an old event must not cancel a newly opened session.
    this.dialog.addEventListener("close", () => { if (!this.dialog.open) this.finishClose(); });
    this.dialog.addEventListener("cancel", ev => { ev.preventDefault(); this.close(); });
    this.dialog.addEventListener("click", ev => { if (ev.target === this.dialog) this.close(); });
    this.buildView();
    document.body.append(this.dialog);
    $("#explore-world").addEventListener("click", () => this.open());
    this.loadMaps();
  }

  buildView() {
    this.summary = h("span", { class: "explorer-summary" });
    this.search = h("input", { type: "search", placeholder: "City, neighbourhood or road type", "aria-label": "Search neighbourhoods", "aria-controls": "explorer-maps", autocomplete: "off",
      oninput: () => { this.filters.query = this.search.value; this.renderMaps(); } });
    this.region = h("select", { "aria-label": "Filter by region", "aria-controls": "explorer-maps", onchange: () => { this.filters.region = this.region.value; this.renderMaps(); } });
    this.character = h("select", { "aria-label": "Filter by driving style", "aria-controls": "explorer-maps", onchange: () => { this.filters.character = this.character.value; this.renderMaps(); } });
    this.mapsView = h("div", { id: "explorer-maps" });
    this.mapStatus = h("div", { class: "explorer-status", "aria-live": "polite", "aria-atomic": "true" });
    this.driveStatus = h("div", { class: "explorer-status", "aria-live": "polite", "aria-atomic": "true" });
    this.drivesView = h("div", { class: "explorer-drives" });
    this.dialog.append(
      h("div", { class: "dialog-header" }, h("span", { class: "label" }, "JEV / WORLD EXPLORER"), h("button", { class: "toggle", "aria-label": "Close explorer", onclick: () => this.close() }, "×")),
      h("div", { class: "explorer-intro" }, h("div", {}, h("h2", {}, "Find your next drive."), h("p", { class: "muted" }, "Real Canadian streets. Different neighbourhoods. New challenges.")),
        h("div", { class: "explorer-location" }, h("span", { class: "label" }, "DRIVING HERE"), h("strong", {}, this.map.label))),
      h("div", { class: "explorer-catalog-heading" }, h("h3", {}, "Choose a neighbourhood"), this.summary),
      h("div", { class: "explorer-filters" }, h("label", { class: "explorer-search" }, h("span", {}, "Search maps"), this.search),
        h("label", {}, h("span", {}, "Region"), this.region), h("label", {}, h("span", {}, "Driving style"), this.character)),
      this.mapStatus, this.mapsView,
      h("div", { class: "explorer-section" }, h("div", {}, h("h3", {}, "Suggested drives"), h("span", { class: "muted" }, `From your current position in ${this.map.label}`)),
        h("span", { class: "explorer-paused" }, "Simulation paused while you explore")),
      this.driveStatus, this.drivesView,
      h("div", { class: "dialog-footer" }, h("span", { class: "muted" }, "Map data © ", h("a", { href: "https://www.openstreetmap.org/copyright", target: "_blank", rel: "noopener" }, "OpenStreetMap contributors"), " · ODbL"),
        h("a", { class: "text-button", href: `/bench?bbox=${encodeURIComponent(this.map.bbox.join(","))}`, target: "_blank", rel: "noopener" }, "Benchmark this map ↗"),
        h("button", { class: "toggle", onclick: () => this.close() }, "Just drive")));
    this.updateFilters();
  }

  updateFilters() {
    for (const [control, key, field, label] of [[this.region, "region", "province", "All regions"], [this.character, "character", "character", "All styles"]]) {
      const values = [...new Set(this.maps.map(m => m[field]).filter(Boolean))].sort((a, b) => a.localeCompare(b));
      if (!values.includes(this.filters[key])) this.filters[key] = "";
      control.replaceChildren(h("option", { value: "" }, label), ...values.map(value => h("option", { value }, value)));
      control.value = this.filters[key];
    }
  }

  async loadMaps() {
    this.mapRequest?.abort();
    const request = this.mapRequest = new AbortController();
    this.mapsLoading = true; this.mapError = null;
    if (this.dialog.open) this.renderMaps();
    try {
      const data = await this.request("/api/maps", undefined, { signal: request.signal });
      if (request !== this.mapRequest) return;
      if (!Array.isArray(data.maps)) throw new Error("The server returned an invalid map list.");
      this.maps = data.maps;
      this.updateFilters();
    } catch (err) {
      if (request !== this.mapRequest || request.signal.aborted) return;
      this.mapError = err.message;
    }
    if (request !== this.mapRequest) return;
    this.mapsLoading = false;
    if (this.dialog.open) this.renderMaps();
  }

  finishClose() {
    if (!this.sessionOpen) return;
    this.sessionOpen = false; this.generation++; this.driveRequest?.abort(); this.onClose();
  }

  close() {
    this.dialog.close(); this.finishClose();
  }

  async open() {
    if (this.dialog.open) return;
    // Reconcile a native close even if its queued close event has not fired yet.
    this.finishClose();
    this.onOpen(); this.sessionOpen = true; this.dialog.showModal(); this.pendingMap = null; this.switchError = null;
    this.renderMaps();
    return this.loadDrives();
  }

  async loadDrives() {
    if (!this.dialog.open) return;
    this.driveRequest?.abort();
    const request = this.driveRequest = new AbortController(), generation = ++this.generation;
    this.drives = []; this.driveError = null; this.loading = true;
    this.renderDrives();
    try {
      const data = await this.request("/api/drives", { bbox: this.map.bbox.join(","), from: this.getStart() }, { signal: request.signal });
      if (generation !== this.generation || !this.dialog.open) return;
      if (!Array.isArray(data.drives)) throw new Error("The server returned an invalid drive list.");
      this.drives = data.drives;
    } catch (err) {
      if (generation !== this.generation || request.signal.aborted || !this.dialog.open) return;
      this.driveError = err.message;
    }
    if (generation !== this.generation || !this.dialog.open) return;
    this.loading = false; this.renderDrives();
  }

  // Replace only results, so asynchronous requests never replace an active search control.
  render() { this.renderMaps(); this.renderDrives(); }

  renderMaps() {
    const visible = filterMaps(this.maps, this.filters), cityCount = new Set(this.maps.map(m => m.city)).size;
    this.summary.textContent = this.maps.length ? `${visible.length} of ${this.maps.length} neighbourhoods · ${cityCount} ${cityCount === 1 ? "city" : "cities"}` : "";
    this.mapsView.setAttribute("aria-busy", String(this.mapsLoading || !!this.pendingMap));
    this.mapStatus.replaceChildren();
    if (this.mapsLoading) this.mapStatus.append(h("p", { class: "explorer-loading" }, "Loading real street maps…"));
    else if (this.mapError) this.mapStatus.append(this.errorState("Could not load the map catalog.", this.mapError, "Retry maps", () => this.loadMaps()));
    else if (this.switchError) this.mapStatus.append(this.errorState("Could not open this neighbourhood.", this.switchError, "Try again", () => this.chooseMap(this.failedMap)));
    else if (this.pendingMap) this.mapStatus.append(h("p", { class: "explorer-loading" }, `Opening ${this.maps.find(m => m.id === this.pendingMap)?.name || "neighbourhood"}…`));
    else this.mapStatus.append(h("span", { class: "explorer-result-count" }, this.maps.length ? `${visible.length} neighbourhood${visible.length === 1 ? "" : "s"} available` : ""));
    const activeMap = document.activeElement?.dataset?.map;
    this.mapsView.replaceChildren(visible.length ? h("div", { class: "city-grid" }, visible.map(m => this.cityCard(m)))
      : !this.mapsLoading && !this.mapError ? h("div", { class: "explorer-empty" }, h("strong", {}, this.maps.length ? "No neighbourhoods match your search." : "No maps available yet."),
        h("p", { class: "muted" }, this.maps.length ? "Try another city, a wider region or a different driving style." : "Retry the catalog to check for available street maps."),
        h("button", { class: "toggle", onclick: () => this.maps.length ? this.clearFilters() : this.loadMaps() }, this.maps.length ? "Clear filters" : "Retry maps")) : document.createDocumentFragment());
    if (activeMap) [...this.mapsView.querySelectorAll("[data-map]")].find(node => node.dataset.map === activeMap)?.focus({ preventScroll: true });
  }

  clearFilters() {
    this.filters = { query: "", region: "", character: "" };
    this.search.value = ""; this.region.value = ""; this.character.value = "";
    this.renderMaps(); this.search.focus();
  }

  renderDrives() {
    this.drivesView.setAttribute("aria-busy", String(this.loading));
    this.driveStatus.replaceChildren();
    if (this.loading) this.driveStatus.append(h("p", { class: "explorer-loading" }, "Finding reachable routes from your car…"));
    else if (this.driveError) this.driveStatus.append(this.errorState("Could not find suggested drives.", this.driveError, "Retry drives", () => this.loadDrives()));
    this.drivesView.replaceChildren(this.loading || this.driveError ? document.createDocumentFragment()
      : this.drives.length ? h("div", { class: "mission-grid" }, this.drives.map(d => this.driveCard(d)))
      : h("p", { class: "explorer-empty muted" }, "No suggested routes from this position. Return to a lane or choose a destination on the minimap."));
  }

  errorState(title, detail, action, retry) {
    return h("div", { class: "explorer-error" }, h("div", {}, h("strong", {}, title), h("p", {}, detail)), h("button", { class: "toggle", onclick: retry }, action));
  }

  async chooseMap(id) {
    if (id === this.map.id || this.pendingMap) return;
    const generation = this.generation;
    this.pendingMap = id; this.switchError = null; this.renderMaps();
    try { await this.onMap(id); }
    catch (err) { if (generation !== this.generation) return; this.pendingMap = null; this.failedMap = id; this.switchError = err.message; if (this.dialog.open) this.renderMaps(); }
  }

  cityCard(m) {
    const current = m.id === this.map.id, canvas = h("canvas", { width: 480, height: 200, "aria-hidden": "true" });
    drawMapPreview(canvas, m);
    const stats = m.stats || {}, roads = stats.roads == null ? "Street data on demand" : `${stats.roads.toLocaleString()} road segments · ${stats.signals || 0} signals`;
    return h("button", { class: `city-card ${current ? "selected" : ""}`, "data-map": m.id, style: { "--city-accent": m.accent || "var(--accent)" },
      "aria-current": current ? "location" : null, "aria-label": `${m.name}, ${m.city}. ${m.character || "Street map"}.${current ? " Currently driving here." : " Open neighbourhood."}`,
      disabled: !!this.pendingMap, onclick: () => this.chooseMap(m.id) },
      h("div", { class: "city-preview" }, canvas, h("span", { class: "city-character" }, m.character || "Neighbourhood"),
        current ? h("span", { class: "city-current" }, "Driving here") : document.createDocumentFragment()),
      h("div", { class: "city-card-body" }, h("div", { class: "city-eyebrow" }, `${m.city} · ${m.province}`), h("h3", {}, m.name),
        h("p", {}, m.description), h("div", { class: "city-meta" }, h("span", {}, roads), h("b", {}, current ? "Current map" : this.pendingMap === m.id ? "Opening…" : m.cached ? "Explore →" : "Load map →"))));
  }

  driveCard(d) {
    return h("button", { class: "mission-card", "data-drive": d.id, onclick: () => { this.close(); this.onDrive(d); } },
      h("span", { class: "mission-difficulty" }, d.difficulty), h("h3", {}, d.title), h("p", {}, d.description),
      h("div", { class: "mission-meta" }, `${(d.length_m / 1000).toFixed(1)} km · ${d.turns} turns · ${d.signals} lights · ${d.stops} stops`),
      h("span", { class: "mission-start" }, "Start drive →"));
  }
}

function drawMapPreview(canvas, map) {
  const ctx = canvas.getContext("2d"), w = canvas.width, height = canvas.height;
  if (!ctx) return;
  ctx.fillStyle = "#111e26"; ctx.fillRect(0, 0, w, height);
  if (!map.extent) return;
  const [x0, y0, x1, y1] = map.extent, scale = Math.max(w / Math.max(1, x1 - x0), height / Math.max(1, y1 - y0)) * 0.92;
  const x = p => w / 2 + (p[0] - (x0 + x1) / 2) * scale;
  const y = p => height / 2 - (p[1] - (y0 + y1) / 2) * scale;
  for (const major of [false, true]) {
    ctx.strokeStyle = major ? map.accent || "#6ec7a1" : "#374850"; ctx.lineWidth = major ? 2.8 : 1.2;
    ctx.beginPath();
    for (const road of map.preview || []) if (road.major === major && road.pts?.length) {
      ctx.moveTo(x(road.pts[0]), y(road.pts[0]));
      for (const p of road.pts.slice(1)) ctx.lineTo(x(p), y(p));
    }
    ctx.stroke();
  }
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, "#11192300"); gradient.addColorStop(1, "#111923");
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, w, height);
}
