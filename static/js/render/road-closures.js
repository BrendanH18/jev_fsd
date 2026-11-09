// A block closed for an event (sim/road-closures.js): at each end, a row of Type III barricades across the
// street (orange-and-white striped rails on white legs, an amber lamp flashing on top of each), a white
// ROAD CLOSED sign over the middle and an orange DETOUR sign with its arrow beside it, both facing the
// traffic coming up to the block, and a pair of orange cones at the kerbs; on the block itself, a few
// festival tents (render-only). Closures come and go during a free drive, so the view adds and removes
// them as the World's list changes. Everything is depth-tested and stands on the ground (never below it).

import * as THREE from "three";
import { coneMaterial, bandMaterial, cone, place, postMaterial, texture } from "./work-zone.js";

const RAILS = [0.45, 0.85, 1.25];   // rail heights (m)
const RAIL_H = 0.22, RAIL_T = 0.06;
const TENT_COLORS = [0xd94b3d, 0x2f6fb0, 0x3f9a5a, 0xe8b931];

// Orange and white diagonal stripes, as on a barricade's rails.
const stripes = () => texture("barricade-stripes", (ctx, n) => {
  ctx.fillStyle = "#f6f6f2"; ctx.fillRect(0, 0, n, n);
  ctx.fillStyle = "#f26a1b";
  for (let k = -n; k < 2 * n; k += n / 4) {
    ctx.beginPath(); ctx.moveTo(k, 0); ctx.lineTo(k + n / 8, 0); ctx.lineTo(k + n / 8 - n, n); ctx.lineTo(k - n, n); ctx.closePath(); ctx.fill();
  }
}, 128);
// "ROAD CLOSED": black on white, with a black border.
const closedSign = () => texture("road-closed", (ctx, n) => {
  ctx.fillStyle = "#111111"; ctx.fillRect(0, n * 0.22, n, n * 0.56);
  ctx.fillStyle = "#f8f8f4"; ctx.fillRect(n * 0.03, n * 0.25, n * 0.94, n * 0.5);
  ctx.fillStyle = "#111111"; ctx.font = `bold ${n * 0.17}px sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText("ROAD", n / 2, n * 0.38); ctx.fillText("CLOSED", n / 2, n * 0.62);
});
// "DETOUR" with an arrow: black on orange.
const detourSign = (dir) => texture(`detour-${dir}`, (ctx, n) => {
  ctx.fillStyle = "#111111"; ctx.fillRect(0, n * 0.22, n, n * 0.56);
  ctx.fillStyle = "#ff7a1a"; ctx.fillRect(n * 0.03, n * 0.25, n * 0.94, n * 0.5);
  ctx.fillStyle = "#111111"; ctx.font = `bold ${n * 0.15}px sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText("DETOUR", n / 2, n * 0.37);
  const y = n * 0.6, s = dir === "left" ? -1 : 1;
  ctx.fillRect(n * 0.3, y - n * 0.03, n * 0.4, n * 0.06);
  ctx.beginPath(); ctx.moveTo(n / 2 + s * n * 0.28, y); ctx.lineTo(n / 2 + s * n * 0.14, y - n * 0.09); ctx.lineTo(n / 2 + s * n * 0.14, y + n * 0.09); ctx.closePath(); ctx.fill();
});

const railMaterial = new THREE.MeshStandardMaterial({ map: null, roughness: 0.5, emissive: 0x2a1408 });
const legMaterial = new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.6 });
// (the lamps flash together: one material)
const lampMaterial = new THREE.MeshStandardMaterial({ color: 0xffb020, emissive: 0xffa000, emissiveIntensity: 0, roughness: 0.3 });
const tentMaterials = TENT_COLORS.map((color) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, side: THREE.DoubleSide }));

function signMesh(map, width) {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 2.2, 6).translate(0, 1.1, 0), postMaterial));
  g.add(new THREE.Mesh(new THREE.PlaneGeometry(width, width).rotateY(-Math.PI / 2).translate(-0.05, 2.0, 0),
    new THREE.MeshStandardMaterial({ map, transparent: true, alphaTest: 0.5, roughness: 0.5 })));
  return g;
}

// One end's barricades, in a group at the end's centre with local +x into the block and +z to its right.
function endMesh(closure, end) {
  const g = new THREE.Group(), boards = closure.boards.filter((b) => b.end === end.k);
  railMaterial.map ||= stripes();
  for (const b of boards) {
    const lat = (b.x - end.x) * Math.sin(end.psi) - (b.y - end.y) * Math.cos(end.psi), w = b.spec.width;
    for (const h of RAILS) g.add(new THREE.Mesh(new THREE.BoxGeometry(RAIL_T, RAIL_H, w).translate(0, h, lat), railMaterial));
    for (const side of [-1, 1]) g.add(new THREE.Mesh(new THREE.BoxGeometry(0.08, RAILS.at(-1) + 0.15, 0.08).translate(0, (RAILS.at(-1) + 0.15) / 2, lat + side * (w / 2 - 0.15)), legMaterial));
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.12, 10).translate(0, RAILS.at(-1) + 0.32, lat + w / 2 - 0.15), lampMaterial));
  }
  // the signs, over the middle and beside it, facing the traffic coming (local -x)
  const mid = (end.lo + end.hi) / 2;
  const closed = signMesh(closedSign(), 1.2); closed.position.set(-0.4, 0, mid - 0.7); g.add(closed);
  const detour = signMesh(detourSign(end.k === 0 ? "right" : "left"), 1.0); detour.position.set(-0.4, 0, mid + 0.8); g.add(detour);
  // a cone at each kerb
  const { body, band } = cone();
  for (const z of [end.lo + 0.4, end.hi - 0.4]) {
    const c = new THREE.Mesh(body, coneMaterial), s = new THREE.Mesh(band, bandMaterial);
    c.position.set(-1.2, 0, z); s.position.set(-1.2, 0, z); g.add(c, s);
  }
  g.position.set(end.x, 0, -end.y); g.rotation.y = end.psi;
  return g;
}

// A festival tent: a white-legged canopy in one of the tent colours.
function tentMesh(k) {
  const g = new THREE.Group(), m = tentMaterials[k % tentMaterials.length];
  g.add(new THREE.Mesh(new THREE.ConeGeometry(2.1, 0.7, 4, 1, true).rotateY(Math.PI / 4).translate(0, 2.55, 0), m));
  g.add(new THREE.Mesh(new THREE.BoxGeometry(3, 0.25, 3).translate(0, 2.1, 0), m));
  for (const [x, z] of [[-1.4, -1.4], [-1.4, 1.4], [1.4, -1.4], [1.4, 1.4]]) g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.1, 5).translate(x, 1.05, z), legMaterial));
  g.add(new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.75, 0.7).translate(0, 0.375, -1.0), legMaterial));
  return g;
}

export function createRoadClosureMesh(closure, map) {
  const g = new THREE.Group();
  g.name = `road-closure-${closure.id}`;
  for (const end of closure.ends) g.add(endMesh(closure, end));
  // festival tents along the block, alternately by each kerb
  const e = map.edges.get(closure.edges[0]), L = e.cum[e.cum.length - 1];
  for (let k = 0, s = L * 0.3; s < L * 0.75 && k < 4; s += Math.max(12, L * 0.2), k++) {
    const side = k % 2 ? -1 : 1, lat = side > 0 ? e.asphalt[1] - 2 : e.asphalt[0] + 2, p = place(e, s, lat);
    const t = tentMesh(k); t.position.set(p.x, 0, -p.y); t.rotation.y = p.psi; g.add(t);
  }
  g.userData.roadClosure = { id: closure.id };
  return g;
}

// The closures in the scene, kept in step with the World's (they come and go in a free drive, and a
// restored checkpoint may have others), their lamps flashing.
const keyOf = (c) => `${c.id}:${c.edges[0]}:${c.since}`;
export class RoadClosureView {
  constructor(scene) { this.scene = scene; this.meshes = new Map(); }
  sync(world, t = 0) {
    const list = world.roadClosures?.list || [], keys = new Set(list.map(keyOf));
    for (const c of list) if (!this.meshes.has(keyOf(c))) { const m = createRoadClosureMesh(c, world.map); this.scene.add(m); this.meshes.set(keyOf(c), m); }
    for (const [key, m] of this.meshes) if (!keys.has(key)) { this.scene.remove(m); this.meshes.delete(key); }
    lampMaterial.emissiveIntensity = t % 1 < 0.5 ? 3.5 : 0;
  }
}
