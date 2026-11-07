// Black ice (sim/black-ice.js), drawn as it looks: hardly at all. A thin, clear glaze over the asphalt
// that darkens it a little and turns it glossy, so that it catches the headlights at night and a low
// sun or the sky's glare by day, in streaks where the road looks wet though it is not raining. Its
// edges are ragged and feathered into the dry road round it.
//
// It is coplanar ground (render/scene.js LAYER): on the `patch` layer, above the asphalt and below the
// markings, which show through it; nothing below y = 0. It is shown while its patches lie on the road
// (the world's conditions favour ice), and rebuilt when a challenge places its own.

import * as THREE from "three";
import { rng } from "../common.js";
import { LAYER, groundLayer } from "./scene.js";

// Across a patch, this many columns of vertices; along it, a row every STEP_M.
const COLUMNS = 8, STEP_M = 1.5;
// How far its edges feather into the dry road, and how strongly the glaze shows at its heart.
const FEATHER_M = 1.6, ALPHA = 0.7;

// Value noise along a patch (s metres) and across it (u, 0 to 1), from its shape seed: the glaze is
// thicker in streaks along the wheel paths and thins in places.
function noise(random) {
  const waves = Array.from({ length: 4 }, (_, k) => ({ f: 0.08 + random() * 0.25 * (k + 1), g: 2 + random() * 5, p: random() * 6.283, a: 0.4 / (k + 1) }));
  return (s, u) => waves.reduce((sum, w) => sum + w.a * Math.sin(w.f * s + w.g * u + w.p), 0);
}

// The glaze of patch `p`, into the position, colour (with alpha) and index arrays.
function strip(p, P, C, I) {
  const random = rng(p.shape * 7 + 3), wobble = noise(random), ends = [random() * 1.5, random() * 1.5];
  const rows = Math.max(2, Math.ceil(p.len / STEP_M) + 1), base = P.length / 3;
  for (let r = 0; r < rows; r++) {
    const s = Math.min(p.len, r * STEP_M), q = pointAtOf(p, s), h = headingOf(p, s);
    const sx = Math.sin(h), sy = -Math.cos(h);
    for (let c = 0; c <= COLUMNS; c++) {
      const u = c / COLUMNS, lat = p.lo + (p.hi - p.lo) * u, x = q[0] + sx * lat, y = q[1] + sy * lat;
      // (feathered at its sides and ragged ends, thicker in streaks)
      const side = Math.min(1, Math.min(lat - p.lo, p.hi - lat) / FEATHER_M);
      const end = Math.min(1, Math.max(0, (Math.min(s - ends[0], p.len - ends[1] - s) + wobble(s, u) * 1.5) / FEATHER_M));
      const a = ALPHA * side * end * Math.max(0.25, Math.min(1, 0.75 + wobble(s * 0.7, u * 3)));
      P.push(x, 0, -y);
      C.push(1, 1, 1, Math.max(0, a));
    }
  }
  for (let r = 0; r + 1 < rows; r++) for (let c = 0; c < COLUMNS; c++) {
    const i = base + r * (COLUMNS + 1) + c, j = i + COLUMNS + 1;
    I.push(i, j, i + 1, i + 1, j, j + 1);
  }
}
const pointAtOf = (p, s) => {
  let i = 0;
  while (i + 2 < p.cum.length && p.cum[i + 1] < s) i++;
  const seg = p.cum[i + 1] - p.cum[i], t = seg > 0 ? (s - p.cum[i]) / seg : 0;
  return [p.pts[i][0] + (p.pts[i + 1][0] - p.pts[i][0]) * t, p.pts[i][1] + (p.pts[i + 1][1] - p.pts[i][1]) * t];
};
const headingOf = (p, s) => {
  let i = 0;
  while (i + 2 < p.cum.length && p.cum[i + 1] < s) i++;
  return Math.atan2(p.pts[i + 1][1] - p.pts[i][1], p.pts[i + 1][0] - p.pts[i][0]);
};

// The black ice of a world: one mesh for every patch it may have, shown while they lie on the road.
export class IceView {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.name = "black-ice";
    this.group.visible = false;
    scene.add(this.group);
    this.version = -1;
    // (a dark, clear glaze: a mirror-smooth surface that darkens the asphalt a little and catches
    // specular light, the headlights' and the sun's, at a glancing angle)
    this.material = new THREE.MeshStandardMaterial({ color: 0x3d4b58, emissive: 0x2a3a4a, roughness: 0.04, metalness: 0.0, envMapIntensity: 1.8, transparent: true, vertexColors: true, side: THREE.DoubleSide });
  }

  // Follow the world's ice: rebuilt when its patches change, shown while any lie on the road.
  sync(world) {
    const ice = world.ice;
    if (!ice?.enabled) return;
    if (ice.version !== this.version) {
      this.version = ice.version;
      for (const m of this.group.children) m.geometry.dispose();
      this.group.clear();
      const P = [], C = [], I = [];
      for (const p of ice.list) strip(p, P, C, I);
      if (I.length) {
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
        g.setAttribute("color", new THREE.Float32BufferAttribute(C, 4));
        g.setIndex(I);
        g.computeVertexNormals();
        // (normals up: the strip is flat on the road)
        const n = g.getAttribute("normal");
        for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
        this.group.add(groundLayer(new THREE.Mesh(g, this.material), LAYER.patch + 0.25));
      }
    }
    this.group.visible = ice.list.length > 0;
  }
}
