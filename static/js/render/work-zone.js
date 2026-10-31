// A work zone with a flagger at each end (sim/work-zone.js): orange cones angled across the closed lane
// and lining its edge past the work, a crew's dump truck with an amber light bar and a flashing arrow
// board pointing traffic left, two workers in hi-vis, an orange "flagger ahead" sign before each end,
// and the two flaggers on the sidewalk, each holding a STOP/SLOW paddle that turns with the phase.
// Everything is placed in world coordinates in one group at the origin.

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { pointAt, headingAt } from "../map/mapdata.js";
import { addLightBars, flashLights, shared, wheel } from "./emergency.js";
import { createPersonMesh, syncPerson } from "./people.js";
import { snowable } from "./weather.js";
import { paddle } from "../sim/work-zone.js";

const ORANGE = 0xff6a13;
const CONE_EVERY_M = 3;
const ENTRY_TAPER_M = 12;   // the cones angle across the closed lane over this much, before the work
const EXIT_TAPER_M = 6;     // and back over this much after it
const box = (sx, sy, sz, x, y, z) => new THREE.BoxGeometry(sx, sy, sz).translate(x, y, z);
const merge = (parts) => mergeGeometries(parts.map((p) => p.toNonIndexed()), false);
const coneMaterial = snowable(new THREE.MeshStandardMaterial({ color: ORANGE, roughness: 0.6 }), "car");
const bandMaterial = new THREE.MeshStandardMaterial({ color: 0xf4f4f0, emissive: 0x30302a, roughness: 0.4 });
const postMaterial = new THREE.MeshStandardMaterial({ color: 0x8a8f96, metalness: 0.6, roughness: 0.4 });
const textures = new Map();

// Where a point `lat` metres right of edge `e`'s centre line, `s` along it, is in the scene.
function place(e, s, lat) {
  const p = pointAt(e.pts, e.cum, s), h = headingAt(e.pts, e.cum, s);
  return { x: p[0] + Math.sin(h) * lat, y: p[1] - Math.cos(h) * lat, psi: h };
}

// A canvas texture, drawn once by `draw(ctx, size)`.
function texture(key, draw, size = 256) {
  if (textures.has(key)) return textures.get(key);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  draw(canvas.getContext("2d"), size);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  textures.set(key, t);
  return t;
}

function octagon(ctx, c, r) {
  ctx.beginPath();
  for (let k = 0; k < 8; k++) { const a = Math.PI / 8 + k * Math.PI / 4; ctx.lineTo(c + r * Math.cos(a), c + r * Math.sin(a)); }
  ctx.closePath();
}

// The paddle's faces: a red STOP octagon, and an orange SLOW diamond on a black octagon.
const stopFace = () => texture("stop", (ctx, n) => {
  octagon(ctx, n / 2, n / 2 - 2); ctx.fillStyle = "#ffffff"; ctx.fill();
  octagon(ctx, n / 2, n / 2 - 12); ctx.fillStyle = "#c8102e"; ctx.fill();
  ctx.fillStyle = "#ffffff"; ctx.font = `bold ${n * 0.3}px sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("STOP", n / 2, n / 2 + 4);
});
const slowFace = () => texture("slow", (ctx, n) => {
  octagon(ctx, n / 2, n / 2 - 2); ctx.fillStyle = "#1a1a1a"; ctx.fill();
  ctx.beginPath(); ctx.moveTo(n / 2, 10); ctx.lineTo(n - 10, n / 2); ctx.lineTo(n / 2, n - 10); ctx.lineTo(10, n / 2); ctx.closePath();
  ctx.fillStyle = "#ff7a1a"; ctx.fill();
  ctx.fillStyle = "#111111"; ctx.font = `bold ${n * 0.22}px sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("SLOW", n / 2, n / 2 + 3);
});
// "Flagger ahead": an orange diamond with a flagger holding up a paddle.
const flaggerSign = () => texture("flagger-ahead", (ctx, n) => {
  ctx.beginPath(); ctx.moveTo(n / 2, 4); ctx.lineTo(n - 4, n / 2); ctx.lineTo(n / 2, n - 4); ctx.lineTo(4, n / 2); ctx.closePath();
  ctx.fillStyle = "#111111"; ctx.fill();
  ctx.beginPath(); ctx.moveTo(n / 2, 14); ctx.lineTo(n - 14, n / 2); ctx.lineTo(n / 2, n - 14); ctx.lineTo(14, n / 2); ctx.closePath();
  ctx.fillStyle = "#ff7a1a"; ctx.fill();
  ctx.strokeStyle = ctx.fillStyle = "#111111"; ctx.lineWidth = n * 0.035; ctx.lineCap = "round";
  const x = n * 0.47, y = n * 0.36;
  ctx.beginPath(); ctx.arc(x, y, n * 0.045, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.moveTo(x, y + n * 0.06); ctx.lineTo(x, y + n * 0.25);            // body
  ctx.moveTo(x, y + n * 0.25); ctx.lineTo(x - n * 0.06, y + n * 0.4);                    // legs
  ctx.moveTo(x, y + n * 0.25); ctx.lineTo(x + n * 0.06, y + n * 0.4);
  ctx.moveTo(x, y + n * 0.1); ctx.lineTo(x + n * 0.12, y + n * 0.06);                   // arm, to the pole
  ctx.moveTo(x + n * 0.13, y - n * 0.05); ctx.lineTo(x + n * 0.13, y + n * 0.33); ctx.stroke();
  ctx.beginPath(); ctx.arc(x + n * 0.13, y - n * 0.07, n * 0.06, 0, Math.PI * 2); ctx.fill();
});

function cone() {
  return {
    body: merge([new THREE.CylinderGeometry(0.035, 0.17, 0.7, 12).translate(0, 0.37, 0), box(0.42, 0.04, 0.42, 0, 0.02, 0)]),
    band: new THREE.CylinderGeometry(0.085, 0.115, 0.12, 12, 1, true).translate(0, 0.45, 0),
  };
}

// The crew's dump truck: a cab, a dump body and a lowered arrow board on the back, rear axle at the
// origin, local +X forward.
function crewTruck() {
  const g = new THREE.Group(), xr = -2.4, xf = 4.4, w = 2.4, wb = 4.2;
  const paint = snowable(new THREE.MeshPhysicalMaterial({ color: ORANGE, metalness: 0.3, roughness: 0.4, clearcoat: 0.6 }), "car");
  const add = (geometry, material, name) => { const m = new THREE.Mesh(geometry, material); m.name = name; m.castShadow = true; m.receiveShadow = true; g.add(m); return m; };
  add(merge([box(1.9, 1.75, w - 0.1, xf - 1.65, 0.75 + 1.75 / 2, 0), box(0.8, 0.7, w - 0.2, xf - 0.35, 0.75 + 0.35, 0)]), paint, "cab");
  add(merge([box(xf - 2.7 - xr, 0.12, w, (xr + xf - 2.7) / 2, 1.0, 0), ...[-1, 1].map((side) => box(xf - 2.7 - xr, 0.9, 0.08, (xr + xf - 2.7) / 2, 1.5, side * (w / 2 - 0.04))),
    box(0.08, 0.9, w, xr + 0.04, 1.5, 0), box(0.08, 1.3, w, xf - 2.74, 1.7, 0)]), postMaterial, "dump-body");
  add(box(0.06, 0.6, w - 0.4, xf - 1.66 + 0.95, 2.0, 0), shared.glass, "windscreen");
  add(box(xf - xr - 0.3, 0.3, w - 0.3, (xr + xf) / 2, 0.55, 0), shared.trim, "chassis");
  // the arrow board: a black panel of lamps behind the body, its chevron flashing
  add(box(0.12, 1.1, 2.0, xr - 0.15, 2.35, 0), shared.trim, "arrow-board");
  const arrow = new THREE.Group();
  const lampMaterial = new THREE.MeshStandardMaterial({ color: 0xffb020, emissive: 0xffa000, emissiveIntensity: 0, roughness: 0.3 });
  // (pointing left, for traffic behind it: toward -Z)
  for (const [y, z] of [[0, -0.75], [0, -0.45], [0, -0.15], [0, 0.15], [0, 0.45], [0, 0.75], [0.25, -0.5], [-0.25, -0.5], [0.45, -0.3], [-0.45, -0.3]]) {
    const m = new THREE.Mesh(new THREE.CircleGeometry(0.07, 10).rotateY(-Math.PI / 2).translate(xr - 0.22, 2.35 + y, z), lampMaterial);
    arrow.add(m);
  }
  g.add(arrow);
  const lenses = addLightBars(g, [{ x: xf - 1.65, y: 0.75 + 1.75 + 0.07, z: 0, len: 0.28, span: w - 0.5 }], [0xffa21a, 0xffa21a, 0xffe0a0]);
  for (const [x, z] of [[wb, -0.95], [wb, 0.95], [0, -0.95], [0, 0.95]]) { const wh = wheel(0.5, x ? 0.3 : 0.55); wh.position.set(x, 0.5, z); g.add(wh); }
  return { g, lenses, lampMaterial };
}

// A flagger's paddle on its pole, the STOP face toward local +X (the traffic it faces), the SLOW face
// on the back: turning the pole half round shows SLOW.
function paddleMesh() {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.9, 6).translate(0, 0.95, 0), postMaterial));
  const front = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.46).rotateY(Math.PI / 2).translate(0.015, 2.05, 0), new THREE.MeshStandardMaterial({ map: stopFace(), transparent: true, alphaTest: 0.5, roughness: 0.5 }));
  const back = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.46).rotateY(-Math.PI / 2).translate(-0.015, 2.05, 0), new THREE.MeshStandardMaterial({ map: slowFace(), transparent: true, alphaTest: 0.5, roughness: 0.5 }));
  g.add(front, back);
  return g;
}

function signMesh() {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.3, 6).translate(0, 1.15, 0), postMaterial));
  const face = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9).rotateY(Math.PI / 2).translate(0.05, 2.3, 0), new THREE.MeshStandardMaterial({ map: flaggerSign(), transparent: true, alphaTest: 0.5, roughness: 0.5 }));
  g.add(face);
  return g;
}

export function createWorkZoneMesh(zone, map) {
  const e = map.edges.get(zone.closed), g = new THREE.Group();
  g.name = `work-zone-${zone.id}`;
  const lane = e.lane_offsets?.[0] ?? e.lane_width / 2, edge = Math.min(e.asphalt[1], lane + e.lane_width / 2), inner = 0.35;
  // cones: angled across the closed lane before the work, lining it past the work, and back after it
  const spots = [];
  for (let d = 0; d <= ENTRY_TAPER_M; d += CONE_EVERY_M) spots.push(place(e, zone.r - ENTRY_TAPER_M + d, edge - 0.3 - (edge - 0.3 - inner) * d / ENTRY_TAPER_M));
  for (let s = zone.r + CONE_EVERY_M; s < zone.f; s += CONE_EVERY_M) spots.push(place(e, s, inner));
  for (let d = 0; d <= EXIT_TAPER_M; d += CONE_EVERY_M) spots.push(place(e, zone.f + d, inner + (edge - 0.3 - inner) * d / EXIT_TAPER_M));
  const { body, band } = cone(), bodies = new THREE.InstancedMesh(body, coneMaterial, spots.length), bands = new THREE.InstancedMesh(band, bandMaterial, spots.length);
  const m = new THREE.Matrix4();
  spots.forEach((p, i) => { m.makeTranslation(p.x, 0, -p.y); bodies.setMatrixAt(i, m); bands.setMatrixAt(i, m); });
  bodies.castShadow = true; bodies.name = "cones"; bands.name = "cone-bands";
  g.add(bodies, bands);
  // the truck at the start of the work, its back to the traffic coming into the closed lane
  const truck = crewTruck(), at = place(e, zone.r + 3.2, lane + 0.3);
  truck.g.position.set(at.x, 0, -at.y); truck.g.rotation.y = at.psi;
  g.add(truck.g);
  // two workers past it, one with a shovel
  const people = [];
  for (const [k, ds, lat, turn] of [[1, 13, lane - 0.2, 2.2], [2, 18, lane + 0.9, -1.4]]) {
    const p = place(e, zone.r + ds, lat), mesh = createPersonMesh(`${zone.id}:${k}`, { worker: true });
    g.add(mesh);
    people.push({ mesh, pose: { x: p.x, y: p.y, psi: p.psi + turn, v: 0, phase: 0, frozen: 0 } });
  }
  // the flaggers, facing the traffic they hold, each with a paddle in the hand nearer the street (their
  // right)
  const flaggers = {};
  for (const side of ["closed", "open"]) {
    const [x, y] = zone.flaggers[side], psi = side === "closed" ? zone.heading + Math.PI : zone.heading;
    const mesh = createPersonMesh(`${zone.id}:flagger:${side}`, { worker: true }), pole = paddleMesh();
    // (the pole stands 0.3 m in front of them and 0.3 m to their right)
    pole.position.set(x + Math.cos(psi) * 0.3 + Math.sin(psi) * 0.3, 0, -(y + Math.sin(psi) * 0.3 - Math.cos(psi) * 0.3));
    g.add(mesh, pole);
    const arm = mesh.userData.arms?.find((a) => a.side > 0);
    flaggers[side] = { mesh, pole, arm, psi, pose: { x, y, psi, v: 0, phase: 0, frozen: 0 }, turn: 0 };
  }
  for (const side of ["closed", "open"]) {
    const at = zone.signs[side];
    if (!at) continue;
    const s = signMesh(), psi = side === "closed" ? zone.heading + Math.PI : zone.heading;
    s.position.set(at[0], 0, -at[1]); s.rotation.y = psi;
    g.add(s);
  }
  g.userData.workZone = { lenses: truck.lenses, arrow: truck.lampMaterial, people, flaggers };
  return g;
}

// Turn each flagger's paddle toward what it shows (half a turn in 0.4 s), flash the truck's lights and
// arrow board, and pose the people (culled by `camera` when given).
export function syncWorkZone(mesh, zone, t = 0, camera = null) {
  const u = mesh?.userData.workZone;
  if (!u) return;
  flashLights(u.lenses, true, t, 0.17);
  u.arrow.emissiveIntensity = t % 1 < 0.55 ? 6 : 0;
  const view = camera || { position: { x: zone.x, z: -zone.y } };
  for (const p of u.people) syncPerson(p.mesh, p.pose, view);
  for (const [side, f] of Object.entries(u.flaggers)) {
    const want = paddle(zone, side) === "slow" ? Math.PI : 0;
    f.turn += Math.sign(want - f.turn) * Math.min(Math.abs(want - f.turn), Math.PI * 0.04);
    f.pole.rotation.y = f.psi + f.turn;
    syncPerson(f.mesh, f.pose, view);
    // (the arm that holds the pole, bent up to it)
    if (f.arm) { f.arm.shoulder.rotation.z = 0.5; f.arm.elbow.rotation.z = 1.1; }
  }
}
