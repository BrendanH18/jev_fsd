// Snowbanks (sim/snowbanks.js) along the kerbs: white, lumpy mounds on the gutter and the boulevard,
// higher at the corners, grey-brown with road grit and slush where they face the street. One mesh for
// all of them (render only: banks are scenery, not obstacles).

import * as THREE from "three";
import { headingAt, pointAt } from "../map/mapdata.js";

// Drawn after the ground's markings (render/scene.js LAYER.marking), like a speed hump: the banks rise
// above the ground and write depth, so cars hide them.
const RENDER_ORDER = -18;
const STEP_M = 1.0;      // along the kerb
const ACROSS = 7;        // points across a bank
const LIFT = 0.012;      // the foot of a bank, just above the ground
const CLEAN = [0.93, 0.94, 0.96], GRIT = [0.43, 0.40, 0.36], ICE = [0.80, 0.84, 0.88];

// A small deterministic noise: lumps that stay put frame to frame.
const hash = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
const smooth = (u) => { const t = Math.max(0, Math.min(1, u)); return t * t * (3 - 2 * t); };

// The height of run `run` at `s` along it, from its lumps (evenly along it), tapering at its ends.
function heightAt(run, s) {
  const k = (s - run.s0) / ((run.s1 - run.s0) / (run.h.length - 1)), i = Math.max(0, Math.min(run.h.length - 2, Math.floor(k))), f = smooth(k - i);
  const h = run.h[i] * (1 - f) + run.h[i + 1] * f;
  const taper = Math.min(smooth((s - run.s0) / 1.2), smooth((run.s1 - s) / 1.2));
  return h * (0.35 + 0.65 * taper);
}

export function buildSnowbanks(world) {
  const group = new THREE.Group();
  group.name = "snowbanks";
  const map = world.map, pos = [], col = [], idx = [];
  for (const run of world.snowbanks.geo.runs) {
    const e = map.edges.get(run.edge);
    if (!e) continue;
    const len = run.s1 - run.s0, n = Math.max(2, Math.ceil(len / STEP_M) + 1), base = pos.length / 3;
    for (let i = 0; i < n; i++) {
      const s = run.s0 + (len * i) / (n - 1), p = pointAt(e.pts, e.cum, s), h = headingAt(e.pts, e.cum, s);
      const top = heightAt(run, s);
      // (the face toward the street wanders in and out a little; the bank is highest just kerb-side of its middle)
      const inner = run.inner - run.side * (hash(s, run.inner) - 0.5) * 0.25, outer = run.outer + run.side * (hash(s, run.outer) - 0.5) * 0.3;
      for (let j = 0; j < ACROSS; j++) {
        const u = j / (ACROSS - 1), lat = inner + (outer - inner) * u;
        const shape = Math.pow(Math.sin(Math.PI * Math.min(1, u / 0.9)), 0.7) * (u > 0.9 ? 1 - (u - 0.9) * 6 : 1);
        const lumpy = 1 + (hash(s * 1.7, u * 9.3 + run.dirt) - 0.5) * 0.18;
        const y = LIFT + Math.max(0, top * shape * lumpy);
        pos.push(p[0] + Math.sin(h) * lat, y, -(p[1] - Math.cos(h) * lat));
        // (grit and slush thrown up by traffic on the street side, low down; icy where it is packed hard)
        const dirt = Math.max(0, 1 - u * 2.2) * (0.55 + 0.45 * run.dirt) * Math.max(0, 1 - y / (top + 0.01) * 0.8);
        const ice = 0.25 * (hash(s, u) > 0.85 ? 1 : 0);
        for (let c = 0; c < 3; c++) col.push(CLEAN[c] * (1 - dirt - ice) + GRIT[c] * dirt + ICE[c] * ice);
      }
    }
    for (let i = 0; i < n - 1; i++) for (let j = 0; j < ACROSS - 1; j++) {
      const a = base + i * ACROSS + j, b = a + ACROSS;
      // (wound so the faces look up whichever kerb it is)
      if (run.side > 0) idx.push(a, b, a + 1, a + 1, b, b + 1); else idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  if (!idx.length) return group;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, metalness: 0, side: THREE.DoubleSide }));
  mesh.renderOrder = RENDER_ORDER;
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  group.add(mesh);
  return group;
}
