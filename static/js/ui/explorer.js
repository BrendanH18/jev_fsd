import { $, api, h, appUrl } from "../common.js";
import { preference } from "./preferences.js";

const sortPreference = preference("explorer-sort", "catalog", undefined, {
  valid: (value) => ["catalog", "city", "name"].includes(value),
});

const searchText = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

export function filterMaps(maps, { query = "", region = "", character = "" } = {}) {
  const words = searchText(query).trim().split(/\s+/).filter(Boolean);
  return maps.filter(
    (m) =>
      (!region || m.province === region) &&
      (!character || m.character === character) &&
      words.every((word) =>
        searchText([m.name, m.city, m.province, m.character, m.description].join(" ")).includes(word),
      ),
  );
}

export class Explorer {
  constructor({ map, getStart, onDrive, onMap, onOpen, onClose, request = api }) {
    Object.assign(this, { map, getStart, onDrive, onMap, onOpen, onClose, request });
    this.maps = [];
    this.previews = new WeakMap();
    this.drives = [];
    this.generation = 0;
    this.mapsLoading = false;
    this.loading = false;
    this.filters = { query: "", region: "", character: "" };
    this.dialog = h("dialog", {
      class: "drive-dialog explorer-dialog",
      "aria-label": "Explore neighbourhoods and drives",
    });
    // Native close events are queued: an old event must not cancel a newly opened session.
    this.dialog.addEventListener("close", () => {
      if (!this.dialog.open) this.finishClose();
    });
    this.dialog.addEventListener("cancel", (ev) => {
      ev.preventDefault();
      this.close();
    });
    this.dialog.addEventListener("click", (ev) => {
      if (ev.target === this.dialog) this.close();
    });
    this.buildView();
    document.body.append(this.dialog);
    $("#explore-world").addEventListener("click", () => this.open());
  }

  buildView() {
    this.summary = h("span", { class: "explorer-summary" });
    this.search = h("input", {
      type: "search",
      placeholder: "City, neighbourhood or road type",
      "aria-label": "Search neighbourhoods",
      "aria-controls": "explorer-maps",
      autocomplete: "off",
      oninput: () => {
        this.filters.query = this.search.value;
        this.renderMaps();
      },
    });
    this.region = h("select", {
      "aria-label": "Filter by region",
      "aria-controls": "explorer-maps",
      onchange: () => {
        this.filters.region = this.region.value;
        this.renderMaps();
      },
    });
    this.character = h("select", {
      "aria-label": "Filter by driving style",
      "aria-controls": "explorer-maps",
      onchange: () => {
        this.filters.character = this.character.value;
        this.renderMaps();
      },
    });
    this.sortMaps = h(
      "select",
      {
        "aria-label": "Sort neighbourhoods",
        "aria-controls": "explorer-maps",
        onchange: () => {
          sortPreference.write(this.sortMaps.value);
          this.renderMaps();
        },
      },
      h("option", { value: "catalog" }, "Catalog order"),
      h("option", { value: "city" }, "City A–Z"),
      h("option", { value: "name" }, "Neighbourhood A–Z"),
    );
    this.sortMaps.value = sortPreference.read();
    this.resetFilters = h(
      "button",
      {
        class: "chip-button",
        type: "button",
        hidden: true,
        onclick: () => this.clearFilters(),
      },
      "Clear filters",
    );
    this.mapsView = h("div", { id: "explorer-maps" });
    this.mapStatus = h("div", { class: "explorer-status", "aria-live": "polite", "aria-atomic": "true" });
    this.driveStatus = h("div", { class: "explorer-status", "aria-live": "polite", "aria-atomic": "true" });
    this.drivesView = h("div", { class: "explorer-drives" });
    this.dialog.append(
      h(
        "div",
        { class: "dialog-header" },
        h("span", { class: "label" }, "JEV / WORLD EXPLORER"),
        h("button", { class: "toggle", "aria-label": "Close explorer", onclick: () => this.close() }, "×"),
      ),
      h(
        "div",
        { class: "explorer-intro" },
        h(
          "div",
          {},
          h("h2", {}, "Find your next drive."),
          h("p", { class: "muted" }, "Real Canadian streets. Different neighbourhoods. New challenges."),
        ),
        h(
          "div",
          { class: "explorer-location" },
          h("span", { class: "label" }, "DRIVING HERE"),
          h("strong", {}, this.map.label),
        ),
      ),
      h("div", { class: "explorer-catalog-heading" }, h("h3", {}, "Choose a neighbourhood"), this.summary),
      h(
        "div",
        { class: "explorer-filters" },
        h("label", { class: "explorer-search" }, h("span", {}, "Search maps"), this.search),
        h("label", {}, h("span", {}, "Region"), this.region),
        h("label", {}, h("span", {}, "Driving style"), this.character),
        h("label", {}, h("span", {}, "Sort maps"), this.sortMaps),
        this.resetFilters,
      ),
      this.mapStatus,
      this.mapsView,
      h(
        "div",
        { class: "explorer-section" },
        h(
          "div",
          {},
          h("h3", {}, "Suggested drives"),
          h("span", { class: "muted" }, `From your current position in ${this.map.label}`),
        ),
        h("span", { class: "explorer-paused" }, "Simulation paused while you explore"),
      ),
      this.driveStatus,
      this.drivesView,
      h(
        "div",
        { class: "dialog-footer" },
        h(
          "span",
          { class: "muted" },
          "Map data © ",
          h(
            "a",
            { href: "https://www.openstreetmap.org/copyright", target: "_blank", rel: "noopener" },
            "OpenStreetMap contributors",
          ),
          " · ODbL",
        ),
        h(
          "a",
          {
            class: "text-button",
            href: appUrl(document.querySelector('meta[name="jev-demo"]') ? "bench.html" : "bench", {
              bbox: this.map.bbox.join(","),
            }),
            target: "_blank",
            rel: "noopener",
          },
          "Benchmark this map ↗",
        ),
        h("button", { class: "toggle", onclick: () => this.close() }, "Just drive"),
      ),
    );
    this.updateFilters();
  }

  updateFilters() {
    for (const [control, key, field, label] of [
      [this.region, "region", "province", "All regions"],
      [this.character, "character", "character", "All styles"],
    ]) {
      const values = [...new Set(this.maps.map((m) => m[field]).filter(Boolean))].sort((a, b) => a.localeCompare(b));
      if (!values.includes(this.filters[key])) this.filters[key] = "";
      control.replaceChildren(
        h("option", { value: "" }, label),
        ...values.map((value) => h("option", { value }, value)),
      );
      control.value = this.filters[key];
    }
  }

  async loadMaps() {
    this.mapRequest?.abort();
    const request = (this.mapRequest = new AbortController());
    this.mapsLoading = true;
    this.mapError = null;
    if (this.dialog.open) this.renderMaps();
    try {
      const data = await this.request("/api/maps", undefined, { signal: request.signal });
      if (request !== this.mapRequest) return;
      if (!Array.isArray(data?.maps)) throw new Error("The server returned an invalid map list.");
      const maps = new Map();
      for (const entry of data.maps) {
        if (typeof entry?.id === "string" && typeof entry.name === "string" && !maps.has(entry.id))
          maps.set(entry.id, entry);
      }
      this.maps = [...maps.values()];
      this.mapsLoaded = true;
      this.updateFilters();
    } catch (err) {
      if (request !== this.mapRequest || request.signal.aborted) return;
      this.mapError = err.message;
    }
    if (request !== this.mapRequest) return;
    this.mapRequest = null;
    this.mapsLoading = false;
    if (this.dialog.open) this.renderMaps();
  }

  finishClose() {
    if (!this.sessionOpen) return;
    this.sessionOpen = false;
    this.generation++;
    this.driveRequest?.abort();
    this.driveRequest = null;
    this.onClose();
  }

  close() {
    this.dialog.close();
    this.finishClose();
  }

  async open() {
    if (this.dialog.open) return;
    // Reconcile a native close even if its queued close event has not fired yet.
    this.finishClose();
    this.onOpen();
    this.sessionOpen = true;
    this.dialog.showModal();
    if (!this.mapsLoaded && !this.mapsLoading) this.loadMaps();
    this.search.focus();
    this.pendingMap = null;
    this.switchError = null;
    this.renderMaps();
    return this.loadDrives();
  }

  async loadDrives() {
    if (!this.dialog.open) return;
    this.driveRequest?.abort();
    const request = (this.driveRequest = new AbortController()),
      generation = ++this.generation;
    this.drives = [];
    this.driveError = null;
    this.loading = true;
    this.renderDrives();
    try {
      const data = await this.request(
        "/api/drives",
        { bbox: this.map.bbox.join(","), from: this.getStart() },
        { signal: request.signal },
      );
      if (generation !== this.generation || !this.dialog.open) return;
      if (!Array.isArray(data?.drives)) throw new Error("The server returned an invalid drive list.");
      this.drives = data.drives.filter(
        (drive) => drive?.route && typeof drive.title === "string" && Array.isArray(drive.destination),
      );
    } catch (err) {
      if (generation !== this.generation || request.signal.aborted || !this.dialog.open) return;
      this.driveError = err.message;
    }
    if (generation !== this.generation || !this.dialog.open) return;
    this.driveRequest = null;
    this.loading = false;
    this.renderDrives();
  }

  // Replace only results, so asynchronous requests never replace an active search control.
  render() {
    this.renderMaps();
    this.renderDrives();
  }

  renderMaps() {
    const visible = filterMaps(this.maps, this.filters),
      cityCount = new Set(visible.map((m) => m.city)).size;
    this.resetFilters.hidden = !visible.length || !Object.values(this.filters).some(Boolean);
    const sort = this.sortMaps.value;
    if (sort === "city" || sort === "name") {
      visible.sort(
        (a, b) =>
          String(a[sort] || "").localeCompare(b[sort] || "") || String(a.name || "").localeCompare(b.name || ""),
      );
    }
    this.summary.textContent = this.maps.length
      ? `${visible.length} of ${this.maps.length} neighbourhoods · ${cityCount} ${cityCount === 1 ? "city" : "cities"}`
      : "";
    this.mapsView.setAttribute("aria-busy", String(this.mapsLoading || !!this.pendingMap));
    this.mapStatus.replaceChildren();
    if (this.mapsLoading) this.mapStatus.append(h("p", { class: "explorer-loading" }, "Loading real street maps…"));
    else if (this.mapError)
      this.mapStatus.append(
        this.errorState("Could not load the map catalog.", this.mapError, "Retry maps", () => this.loadMaps()),
      );
    else if (this.switchError)
      this.mapStatus.append(
        this.errorState("Could not open this neighbourhood.", this.switchError, "Try again", () =>
          this.chooseMap(this.failedMap),
        ),
      );
    else if (this.pendingMap)
      this.mapStatus.append(
        h(
          "p",
          { class: "explorer-loading" },
          `Opening ${this.maps.find((m) => m.id === this.pendingMap)?.name || "neighbourhood"}…`,
        ),
      );
    else this.mapStatus.append(h("span", { class: "sr-only" }, this.summary.textContent));
    const activeMap = document.activeElement?.dataset?.map;
    this.mapsView.replaceChildren(
      visible.length
        ? h(
            "div",
            { class: "city-grid" },
            visible.map((m) => this.cityCard(m)),
          )
        : !this.mapsLoading && !this.mapError
          ? h(
              "div",
              { class: "explorer-empty" },
              h("strong", {}, this.maps.length ? "No neighbourhoods match your search." : "No maps available yet."),
              h(
                "p",
                { class: "muted" },
                this.maps.length
                  ? "Try another city, a wider region or a different driving style."
                  : "Retry the catalog to check for available street maps.",
              ),
              h(
                "button",
                { class: "toggle", onclick: () => (this.maps.length ? this.clearFilters() : this.loadMaps()) },
                this.maps.length ? "Clear filters" : "Retry maps",
              ),
            )
          : document.createDocumentFragment(),
    );
    if (activeMap)
      [...this.mapsView.querySelectorAll("[data-map]")]
        .find((node) => node.dataset.map === activeMap)
        ?.focus({ preventScroll: true });
  }

  clearFilters() {
    this.filters = { query: "", region: "", character: "" };
    this.search.value = "";
    this.region.value = "";
    this.character.value = "";
    this.renderMaps();
    this.search.focus();
  }

  renderDrives() {
    this.drivesView.setAttribute("aria-busy", String(this.loading));
    this.driveStatus.replaceChildren();
    if (this.loading)
      this.driveStatus.append(h("p", { class: "explorer-loading" }, "Finding reachable routes from your car…"));
    else if (this.driveError)
      this.driveStatus.append(
        this.errorState("Could not find suggested drives.", this.driveError, "Retry drives", () => this.loadDrives()),
      );
    this.drivesView.replaceChildren(
      this.loading || this.driveError
        ? document.createDocumentFragment()
        : this.drives.length
          ? h(
              "div",
              { class: "mission-grid" },
              this.drives.map((d) => this.driveCard(d)),
            )
          : h(
              "p",
              { class: "explorer-empty muted" },
              "No suggested routes from this position. Return to a lane or choose a destination on the minimap.",
            ),
    );
  }

  errorState(title, detail, action, retry) {
    return h(
      "div",
      { class: "explorer-error" },
      h("div", {}, h("strong", {}, title), h("p", {}, detail)),
      h("button", { class: "toggle", onclick: retry }, action),
    );
  }

  async chooseMap(id) {
    if (id === this.map.id || this.pendingMap || !this.maps.some((map) => map.id === id)) return;
    const generation = this.generation;
    this.pendingMap = id;
    this.switchError = null;
    this.renderMaps();
    try {
      const changed = await this.onMap(id);
      if (changed === false) throw new Error("Choose another neighbourhood or try again.");
    } catch (err) {
      if (generation !== this.generation) return;
      this.pendingMap = null;
      this.failedMap = id;
      this.switchError = err.message;
      if (this.dialog.open) this.renderMaps();
    }
  }

  cityCard(m) {
    const current = m.id === this.map.id;
    let canvas = this.previews.get(m);
    if (!canvas) {
      canvas = h("canvas", { width: 480, height: 200, "aria-hidden": "true" });
      drawMapPreview(canvas, m);
      this.previews.set(m, canvas);
    }
    const stats = m.stats || {};
    const roads = Number.isFinite(stats.roads)
      ? [count(stats.roads, "road segment"), count(stats.signals, "signal")].filter(Boolean).join(" · ")
      : "Street data on demand";
    return h(
      "button",
      {
        class: `city-card ${current ? "selected" : ""}`,
        "data-map": m.id,
        style: { "--city-accent": m.accent || "var(--accent)" },
        "aria-current": current ? "location" : null,
        "aria-label": `${m.name}, ${m.city}. ${m.character || "Street map"}.${current ? " Currently driving here." : " Open neighbourhood."}`,
        disabled: !!this.pendingMap || current,
        onclick: () => this.chooseMap(m.id),
      },
      h(
        "div",
        { class: "city-preview" },
        canvas,
        h("span", { class: "city-character" }, m.character || "Neighbourhood"),
        current ? h("span", { class: "city-current" }, "Driving here") : document.createDocumentFragment(),
      ),
      h(
        "div",
        { class: "city-card-body" },
        h("div", { class: "city-eyebrow" }, [m.city, m.province].filter(Boolean).join(" · ")),
        h("h3", {}, m.name),
        h("p", {}, m.description),
        h(
          "div",
          { class: "city-meta" },
          h("span", {}, roads),
          h(
            "b",
            {},
            current ? "Current map" : this.pendingMap === m.id ? "Opening…" : m.cached ? "Explore →" : "Load map →",
          ),
        ),
      ),
    );
  }

  driveCard(d) {
    return h(
      "button",
      {
        class: "mission-card",
        "data-drive": d.id,
        onclick: () => {
          this.close();
          this.onDrive(d);
        },
      },
      h("span", { class: "mission-difficulty" }, d.difficulty),
      h("h3", {}, d.title),
      h("p", {}, d.description),
      h(
        "div",
        { class: "mission-meta" },
        [
          Number.isFinite(d.length_m) ? `${(d.length_m / 1000).toFixed(1)} km` : "",
          count(d.turns, "turn"),
          count(d.signals, "light"),
          count(d.stops, "stop"),
        ]
          .filter(Boolean)
          .join(" · "),
      ),
      h("span", { class: "mission-start" }, "Start drive →"),
    );
  }
}

const count = (number, label) =>
  Number.isFinite(number) ? `${number.toLocaleString()} ${label}${number === 1 ? "" : "s"}` : "";

function drawMapPreview(canvas, map) {
  const ctx = canvas.getContext("2d"),
    w = canvas.width,
    height = canvas.height;
  if (!ctx) return;
  ctx.fillStyle = "#111e26";
  ctx.fillRect(0, 0, w, height);
  if (!Array.isArray(map.extent) || map.extent.length !== 4 || !map.extent.every(Number.isFinite)) return;
  const [x0, y0, x1, y1] = map.extent,
    scale = Math.min(w / Math.max(1, x1 - x0), height / Math.max(1, y1 - y0)) * 0.92;
  const x = (p) => w / 2 + (p[0] - (x0 + x1) / 2) * scale;
  const y = (p) => height / 2 - (p[1] - (y0 + y1) / 2) * scale;
  for (const major of [false, true]) {
    ctx.strokeStyle = major ? map.accent || "#6ec7a1" : "#374850";
    ctx.lineWidth = major ? 2.8 : 1.2;
    ctx.beginPath();
    for (const road of Array.isArray(map.preview) ? map.preview : []) {
      if (Boolean(road?.major) !== major || !Array.isArray(road?.pts)) continue;
      let penDown = false;
      for (const point of road.pts) {
        if (!Array.isArray(point) || point.length !== 2 || !point.every(Number.isFinite)) {
          penDown = false;
          continue;
        }
        if (penDown) ctx.lineTo(x(point), y(point));
        else ctx.moveTo(x(point), y(point));
        penDown = true;
      }
    }
    ctx.stroke();
  }
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, "#11192300");
  gradient.addColorStop(1, "#111923");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, w, height);
}
