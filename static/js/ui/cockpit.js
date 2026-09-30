const svgNode = (tag, attrs = {}) => {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
};

// Hood-view glass and two sweeping blades. A DOM layer keeps this out of shadow/reflection passes.
export class Cockpit {
  constructor() {
    this.root = svgNode("svg", { class: "cockpit", viewBox: "0 0 1600 1000", preserveAspectRatio: "none", "aria-hidden": "true" });
    this.root.style.display = "none";
    // Pillars and dashboard are solid trim. Translucency here let roadside grass and wet
    // reflections show through as moving green patches around the lower windshield.
    const frame = svgNode("path", { d: "M0 0 L75 0 L185 900 Q800 835 1415 900 L1525 0 L1600 0 L1600 1000 L0 1000 Z", fill: "#081017" });
    this.drops = svgNode("g", { class: "windshield-drops", opacity: ".28" });
    // The swept centre stays clear; beads accumulate around the unswept glass edges.
    for (let i = 0; i < 80; i++) {
      const x = 170 + ((i * 317) % 1250), y = 35 + ((i * 173) % 710);
      if (x > 390 && x < 1260 && y > 220) continue;
      this.drops.append(svgNode("ellipse", { cx: x, cy: y, rx: 2 + i % 3, ry: 4 + i % 5, fill: "#d7ebf5", stroke: "#0e2030", "stroke-width": ".8" }));
    }
    this.blades = [550, 1030].map(x => {
      const g = svgNode("g");
      g.append(svgNode("path", { d: `M${x} 990 L${x - 70} 810 L${x - 255} 610`, fill: "none", stroke: "#070b10", "stroke-width": "7", "stroke-linecap": "round" }),
        svgNode("path", { d: `M${x - 150} 730 L${x - 330} 505`, fill: "none", stroke: "#090e13", "stroke-width": "12", "stroke-linecap": "round" }),
        svgNode("path", { d: `M${x - 150} 730 L${x - 330} 505`, fill: "none", stroke: "#83949d", "stroke-opacity": ".35", "stroke-width": "2" }));
      return { g, x };
    });
    this.root.append(this.drops, frame, ...this.blades.map(b => b.g));
    document.body.append(this.root);
  }

  update(mode, weather, t, enabled = true) {
    const hood = mode === "hood";
    this.root.style.display = hood ? "block" : "none";
    if (!hood) return;
    const raining = weather === "rain";
    this.drops.style.display = raining ? "block" : "none";
    const angle = raining && enabled ? -20 + (0.5 - 0.5 * Math.cos(t * Math.PI * 2 / 1.8)) * 96 : -20;
    for (const blade of this.blades) blade.g.setAttribute("transform", `rotate(${angle.toFixed(2)} ${blade.x} 990)`);
  }
}
