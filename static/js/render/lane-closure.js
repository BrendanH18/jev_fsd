// A lane closure with a zipper merge (sim/lane-closure.js): orange cones angled across the closed lane
// from the merge point, lining it past the work and angling back after it, the crew's truck with its
// amber light bar and flashing arrow board pointing traffic left, two workers in hi-vis, an orange "right
// lane closed ahead" sign AHEAD_M before the merge point and a "take turns" sign beside it. Everything is
// placed in world coordinates in one group at the origin.

import * as THREE from "three";
import { flashLights } from "./emergency.js";
import { createPersonMesh, syncPerson } from "./people.js";
import { bandMaterial, cone, coneMaterial, crewTruck, place, postMaterial, texture } from "./work-zone.js";

const CONE_EVERY_M = 3;
const EXIT_TAPER_M = 9;   // the cones angle back across the closed lane over this much, after the work

const diamond = (ctx, n, inset, color) => {
  ctx.beginPath(); ctx.moveTo(n / 2, inset); ctx.lineTo(n - inset, n / 2); ctx.lineTo(n / 2, n - inset); ctx.lineTo(inset, n / 2); ctx.closePath();
  ctx.fillStyle = color; ctx.fill();
};
// "Right lane closed ahead": an orange diamond with two lane lines, the right one ending and bending in.
const closedSign = () => texture("lane-closed-ahead", (ctx, n) => {
  diamond(ctx, n, 4, "#111111"); diamond(ctx, n, 14, "#ff7a1a");
  ctx.strokeStyle = "#111111"; ctx.lineWidth = n * 0.05; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(n * 0.4, n * 0.78); ctx.lineTo(n * 0.4, n * 0.22); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(n * 0.6, n * 0.78); ctx.lineTo(n * 0.6, n * 0.5); ctx.quadraticCurveTo(n * 0.6, n * 0.4, n * 0.47, n * 0.32); ctx.stroke();
});
// "Take turns": the merge sign Ontario posts at a zipper merge, black on orange.
const turnsSign = () => texture("take-turns", (ctx, n) => {
  ctx.fillStyle = "#111111"; ctx.fillRect(0, n * 0.18, n, n * 0.64);
  ctx.fillStyle = "#ff7a1a"; ctx.fillRect(n * 0.03, n * 0.21, n * 0.94, n * 0.58);
  ctx.fillStyle = "#111111"; ctx.font = `bold ${n * 0.15}px sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText("TAKE TURNS", n / 2, n * 0.38); ctx.fillText("AT MERGE", n / 2, n * 0.62);
});

function signMesh(map, wide = false) {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.3, 6).translate(0, 1.15, 0), postMaterial));
  const face = new THREE.Mesh(new THREE.PlaneGeometry(wide ? 1.1 : 0.9, wide ? 1.1 : 0.9).rotateY(Math.PI / 2).translate(0.05, 2.3, 0), new THREE.MeshStandardMaterial({ map, transparent: true, alphaTest: 0.5, roughness: 0.5 }));
  g.add(face);
  return g;
}

export function createLaneClosureMesh(zone, map) {
  const e = map.edges.get(zone.edge), g = new THREE.Group();
  g.name = `lane-closure-${zone.id}`;
  const co = e.lane_offsets[zone.closed], oo = e.lane_offsets[zone.open], inner = (co + oo) / 2 + 0.3, edge = Math.min(e.asphalt[1], co + e.lane_width / 2) - 0.3;
  // cones: across the closed lane over the taper, along its line past the work, and back after it
  const spots = [], taper = zone.r - zone.m;
  for (let d = 0; d <= taper; d += CONE_EVERY_M) spots.push(place(e, zone.m + d, edge - (edge - inner) * d / taper));
  for (let s = zone.r + CONE_EVERY_M; s < zone.f; s += CONE_EVERY_M) spots.push(place(e, s, inner));
  for (let d = 0; d <= EXIT_TAPER_M; d += CONE_EVERY_M) spots.push(place(e, zone.f + d, inner + (edge - inner) * d / EXIT_TAPER_M));
  const { body, band } = cone(), bodies = new THREE.InstancedMesh(body, coneMaterial, spots.length), bands = new THREE.InstancedMesh(band, bandMaterial, spots.length);
  const m = new THREE.Matrix4();
  spots.forEach((p, i) => { m.makeTranslation(p.x, 0, -p.y); bodies.setMatrixAt(i, m); bands.setMatrixAt(i, m); });
  bodies.castShadow = true; bodies.name = "cones"; bands.name = "cone-bands";
  g.add(bodies, bands);
  // the truck at the start of the work, its arrow board to the traffic coming up the closed lane
  const truck = crewTruck(), at = place(e, zone.r + 3.2, co + 0.2);
  truck.g.position.set(at.x, 0, -at.y); truck.g.rotation.y = at.psi;
  g.add(truck.g);
  // two workers past it
  const people = [];
  for (const [k, ds, lat, turn] of [[1, 12, co - 0.4, 2.0], [2, 18, co + 0.6, -1.3]]) {
    const p = place(e, zone.r + ds, lat), mesh = createPersonMesh(`${zone.id}:${k}`, { worker: true });
    g.add(mesh);
    people.push({ mesh, pose: { x: p.x, y: p.y, psi: p.psi + turn, v: 0, phase: 0, frozen: 0 } });
  }
  // the signs, facing the traffic coming
  for (const [key, map] of [["ahead", closedSign()], ["merge", turnsSign()]]) {
    const p = zone.signs[key];
    if (!p) continue;
    const s = signMesh(map, key === "merge");
    s.position.set(p[0], 0, -p[1]); s.rotation.y = zone.heading + Math.PI;
    g.add(s);
  }
  g.userData.laneClosure = { lenses: truck.lenses, arrow: truck.lampMaterial, people };
  return g;
}

// Flash the truck's lights and arrow board, and pose the workers (culled by `camera` when given).
export function syncLaneClosure(mesh, zone, t = 0, camera = null) {
  const u = mesh?.userData.laneClosure;
  if (!u) return;
  flashLights(u.lenses, true, t, 0.17);
  u.arrow.emissiveIntensity = t % 1 < 0.55 ? 6 : 0;
  const view = camera || { position: { x: zone.x, z: -zone.y } };
  for (const p of u.people) syncPerson(p.mesh, p.pose, view);
}
