// 2D overview: roads, route, cars, destination. Click to set a destination.

export class Minimap {
  constructor(canvas, map, onClick) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.map = map;
    const [x0, y0, x1, y1] = map.extent;
    this.x0 = x0; this.y0 = y0; this.x1 = x1; this.y1 = y1;
    const w = canvas.width, h = canvas.height;
    this.scale = Math.min(w / (x1 - x0), h / (y1 - y0));
    this.ox = (w - (x1 - x0) * this.scale) / 2;
    this.oy = (h - (y1 - y0) * this.scale) / 2;
    this.roads = document.createElement("canvas");
    this.roads.width = w; this.roads.height = h;
    this.drawRoads();
    canvas.addEventListener("click", (ev) => {
      const rect = canvas.getBoundingClientRect();
      const px = (ev.clientX - rect.left) * (canvas.width / rect.width);
      const py = (ev.clientY - rect.top) * (canvas.height / rect.height);
      onClick(this.toWorld(px, py));
    });
  }

  toPx(x, y) { return [this.ox + (x - this.x0) * this.scale, this.oy + (this.y1 - y) * this.scale]; }
  toWorld(px, py) { return [this.x0 + (px - this.ox) / this.scale, this.y1 - (py - this.oy) / this.scale]; }

  drawRoads() {
    const c = this.roads.getContext("2d");
    c.fillStyle = "#11151c";
    c.fillRect(0, 0, this.roads.width, this.roads.height);
    c.lineCap = "round";
    for (const e of this.map.edges.values()) {
      c.strokeStyle = e.cls === "residential" || e.cls === "living_street" ? "#3a4250" : "#586275";
      c.lineWidth = Math.max(1, e.width * this.scale * 0.8);
      c.beginPath();
      e.pts.forEach(([x, y], i) => { const [px, py] = this.toPx(x, y); i ? c.lineTo(px, py) : c.moveTo(px, py); });
      c.stroke();
    }
    for (const inter of this.map.intersections.values()) {
      const [px, py] = this.toPx(inter.x, inter.y);
      c.fillStyle = "#e0b33c";
      c.beginPath(); c.arc(px, py, 1.6, 0, Math.PI * 2); c.fill();
    }
  }

  draw({ ego, npcs = [], route = null, destination = null, candidates = null }) {
    const c = this.ctx;
    c.drawImage(this.roads, 0, 0);
    if (route) {
      c.strokeStyle = "#4cc2ff"; c.lineWidth = 2; c.beginPath();
      route.pts.forEach(([x, y], i) => { const [px, py] = this.toPx(x, y); i ? c.lineTo(px, py) : c.moveTo(px, py); });
      c.stroke();
    }
    c.fillStyle = "#ffd166";
    for (const n of npcs) { const [px, py] = this.toPx(n.x, n.y); c.fillRect(px - 1.5, py - 1.5, 3, 3); }
    if (destination) {
      const [px, py] = this.toPx(destination[0], destination[1]);
      c.strokeStyle = "#57d27f"; c.lineWidth = 2; c.beginPath(); c.arc(px, py, 5, 0, Math.PI * 2); c.stroke();
    }
    if (ego) {
      const [px, py] = this.toPx(ego.x, ego.y);
      c.save(); c.translate(px, py); c.rotate(-ego.psi);
      c.fillStyle = "#4cc2ff"; c.beginPath(); c.moveTo(7, 0); c.lineTo(-5, 4); c.lineTo(-5, -4); c.closePath(); c.fill();
      c.restore();
    }
  }
}
