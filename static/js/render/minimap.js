// 2D overview: roads, route, cars, destination. Click to set a destination.

const EMERGENCY_KINDS = new Set(["ambulance", "fire_truck"]);
const TRANSIT_KINDS = new Set(["bus", "school_bus", "streetcar", "train"]);

export class Minimap {
  constructor(canvas, map, onClick, { onClearRoute = null, clearButton = null } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.map = map;
    this._onClearRoute = onClearRoute;
    this.clearButton = clearButton || canvas.parentElement?.querySelector("#clear-route") || null;
    this.clearButton?.addEventListener("click", () => this._onClearRoute?.());
    const [x0, y0, x1, y1] = map.extent;
    this.x0 = x0;
    this.y0 = y0;
    this.x1 = x1;
    this.y1 = y1;
    const w = canvas.width,
      h = canvas.height;
    this.scale = Math.min(w / (x1 - x0), h / (y1 - y0));
    this.ox = (w - (x1 - x0) * this.scale) / 2;
    this.oy = (h - (y1 - y0) * this.scale) / 2;
    this.roads = document.createElement("canvas");
    this.roads.width = w;
    this.roads.height = h;
    this.drawRoads();
    canvas.addEventListener("click", (ev) => {
      const rect = canvas.getBoundingClientRect();
      const px = (ev.clientX - rect.left) * (canvas.width / rect.width);
      const py = (ev.clientY - rect.top) * (canvas.height / rect.height);
      onClick(this.toWorld(px, py));
    });
  }

  onClearRoute(fn) {
    this._onClearRoute = fn;
  }

  toPx(x, y) {
    return [this.ox + (x - this.x0) * this.scale, this.oy + (this.y1 - y) * this.scale];
  }
  toWorld(px, py) {
    return [this.x0 + (px - this.ox) / this.scale, this.y1 - (py - this.oy) / this.scale];
  }

  drawRoads() {
    const c = this.roads.getContext("2d");
    c.fillStyle = "#11151c";
    c.fillRect(0, 0, this.roads.width, this.roads.height);
    c.fillStyle = "#1c222c";
    for (const b of this.map.pack.buildings) {
      c.beginPath();
      b.pts.forEach(([x, y], i) => {
        const [px, py] = this.toPx(x, y);
        i ? c.lineTo(px, py) : c.moveTo(px, py);
      });
      c.fill();
    }
    c.lineCap = "round";
    for (const e of this.map.edges.values()) {
      c.strokeStyle = e.cls === "residential" || e.cls === "living_street" ? "#3a4250" : "#586275";
      c.lineWidth = Math.max(1, e.width * this.scale * 0.8);
      c.beginPath();
      e.pts.forEach(([x, y], i) => {
        const [px, py] = this.toPx(x, y);
        i ? c.lineTo(px, py) : c.moveTo(px, py);
      });
      c.stroke();
    }
    for (const inter of this.map.intersections.values()) {
      const [px, py] = this.toPx(inter.x, inter.y);
      c.fillStyle = "#e0b33c";
      c.beginPath();
      c.arc(px, py, 1.6, 0, Math.PI * 2);
      c.fill();
    }
  }

  drawCompass(c) {
    const x = this.canvas.width - 14,
      y = 18;
    c.save();
    c.fillStyle = "rgba(11, 14, 19, 0.72)";
    c.beginPath();
    c.arc(x, y, 10, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = "#d6e2ea";
    c.beginPath();
    c.moveTo(x, y - 8);
    c.lineTo(x - 3, y - 3);
    c.lineTo(x + 3, y - 3);
    c.closePath();
    c.fill();
    c.font = "700 8px system-ui, sans-serif";
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText("N", x, y + 3.5);
    c.restore();
  }

  draw({ ego, npcs = [], route = null, destination = null }) {
    const c = this.ctx;
    c.drawImage(this.roads, 0, 0);
    if (this.clearButton) {
      const shouldHide = !route || !this._onClearRoute;
      if (this.clearButton.hidden !== shouldHide) this.clearButton.hidden = shouldHide;
    }
    if (route) {
      c.strokeStyle = "#4cc2ff";
      c.lineWidth = 2;
      c.beginPath();
      route.pts.forEach(([x, y], i) => {
        const [px, py] = this.toPx(x, y);
        i ? c.lineTo(px, py) : c.moveTo(px, py);
      });
      c.stroke();
    }
    for (const n of npcs) {
      const [px, py] = this.toPx(n.x, n.y);
      if (EMERGENCY_KINDS.has(n.kind)) {
        if (n.siren) {
          c.strokeStyle = "rgba(255, 79, 216, 0.65)";
          c.lineWidth = 1.2;
          c.beginPath();
          c.arc(px, py, 4.5, 0, Math.PI * 2);
          c.stroke();
        }
        c.fillStyle = "#ff4fd8";
        c.beginPath();
        c.arc(px, py, 2.5, 0, Math.PI * 2);
        c.fill();
      } else if (TRANSIT_KINDS.has(n.kind)) {
        c.fillStyle = "#38d9f5";
        c.fillRect(px - 2, py - 2, 4, 4);
      } else if (n.kind === "bike") {
        c.fillStyle = "#9be564";
        c.beginPath();
        c.arc(px, py, 1.7, 0, Math.PI * 2);
        c.fill();
      } else {
        c.fillStyle = "#ffd166";
        c.fillRect(px - 1.5, py - 1.5, 3, 3);
      }
    }
    if (destination) {
      const [px, py] = this.toPx(destination[0], destination[1]);
      c.strokeStyle = "#57d27f";
      c.lineWidth = 2;
      c.beginPath();
      c.arc(px, py, 5, 0, Math.PI * 2);
      c.stroke();
    }
    if (ego) {
      const [px, py] = this.toPx(ego.x, ego.y);
      c.save();
      c.translate(px, py);
      c.rotate(-ego.psi);
      c.fillStyle = "#4cc2ff";
      c.beginPath();
      c.moveTo(7, 0);
      c.lineTo(-5, 4);
      c.lineTo(-5, -4);
      c.closePath();
      c.fill();
      c.restore();
    }
    this.drawCompass(c);
  }
}
