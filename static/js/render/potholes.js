// Spring potholes (sim/potholes.js), drawn as broken asphalt: a ragged rim of cracked, crumbled surface
// round a dark hole. In rain or snow the hole holds water, a puddle that mirrors the sky like the wet
// road round it, so it is much harder to tell from it. And the cars driving over them: a tyre dropping
// into one jolts the body (render only; the sim's car stays on the road).
//
// They are coplanar ground (render/scene.js LAYER): the rim on the `patch` layer, above the asphalt, and
// the hole just above it, below the markings, nothing below y = 0.

import * as THREE from "three";
import { rng } from "../common.js";
import { LAYER, groundLayer } from "./scene.js";
import { asphaltTexture } from "./textures.js";
import { snowable } from "./weather.js";
import { wetReflective } from "./reflection.js";
import { dipAt, wheelPoints } from "../sim/potholes.js";

const POINTS = 18;
// The rim reaches this far past the hole (a share of its size), raggedly.
const RIM = 1.28;

// A ragged outline round a pothole: unit radii at POINTS angles, from its shape seed.
function outline(seed, rough) {
  const random = rng(seed), waves = [1, 2, 3, 5, 7].map((k) => ({ k, a: (random() - 0.5) * rough / Math.sqrt(k), p: random() * Math.PI * 2 }));
  return Array.from({ length: POINTS }, (_, i) => {
    const t = (i / POINTS) * Math.PI * 2;
    return 1 + waves.reduce((sum, w) => sum + w.a * Math.cos(w.k * t + w.p), 0) + (random() - 0.5) * rough * 0.35;
  });
}

// A fan of triangles round the pothole's centre, `scale` times its size, ragged by `radii`.
function fan(h, radii, scale, P, U, I) {
  const base = P.length / 3, c = Math.cos(h.heading), s = Math.sin(h.heading);
  P.push(h.x, 0, -h.y); U.push(h.x / 4, h.y / 4);
  for (let i = 0; i < POINTS; i++) {
    const t = (i / POINTS) * Math.PI * 2, u = Math.cos(t) * h.a * scale * radii[i], v = Math.sin(t) * h.b * scale * radii[i];
    // (u along the lane, v right of it: right is (sin h, -cos h))
    const x = h.x + c * u + s * v, y = h.y + s * u - c * v;
    P.push(x, 0, -y); U.push(x / 4, y / 4);
  }
  for (let i = 0; i < POINTS; i++) I.push(base, base + 1 + ((i + 1) % POINTS), base + 1 + i);
}

// The potholes of `world`, in its weather: one mesh for the rims and one for the holes.
export function buildPotholes(world) {
  const group = new THREE.Group();
  group.name = "potholes";
  const wet = world.weather === "rain" || world.weather === "snow";
  const rim = { P: [], U: [], I: [] }, hole = { P: [], U: [], I: [] };
  for (const h of world.potholes?.list || []) {
    fan(h, outline(h.shape * 7 + 1, 0.5), RIM, rim.P, rim.U, rim.I);
    fan(h, outline(h.shape, 0.35), 1, hole.P, hole.U, hole.I);
  }
  const mesh = ({ P, U, I }, material, order) => {
    if (!I.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(U, 2));
    g.setIndex(I);
    g.computeVertexNormals();
    group.add(groundLayer(new THREE.Mesh(g, material), order));
  };
  // (the rim: crumbled asphalt, lighter and rougher than the road; the weather wets and snows it as it
  // does the road)
  mesh(rim, wetReflective(snowable(new THREE.MeshStandardMaterial({ map: asphaltTexture(), color: wet ? 0x8a8984 : 0x9d9a93, roughness: 1, side: THREE.DoubleSide }), "asphalt"), 0.8), LAYER.patch);
  // (the hole: dark, or full of water, mirroring the sky as the wet road does, and much like it)
  mesh(hole, wet
    ? wetReflective(new THREE.MeshStandardMaterial({ color: 0x3e4349, roughness: 0.06, metalness: 0.05, envMapIntensity: 1.6, side: THREE.DoubleSide }), 1.6)
    : new THREE.MeshStandardMaterial({ map: asphaltTexture(), color: 0x2c2a27, roughness: 1, side: THREE.DoubleSide }), LAYER.patch + 0.5);
  return group;
}

// Jolt a vehicle's mesh (placed with rotation.y = heading) as its tyres drop into potholes: the body
// heaves down and pitches, then settles in a few tenths of a second. Call after the mesh's own sync
// (and render/traffic-calming.js rideOver), every frame. `calmed`: rideOver has set the pitch already.
const SETTLE_S = 0.16, PERIOD_S = 0.32, MAX_DROP_M = 0.06;
export function potholeJolt(world, mesh, vehicle, dt, calmed = false) {
  if (!mesh || !vehicle) return;
  const u = mesh.userData.potholeJolt ||= { t: Infinity, amp: 0, pitch: 0, inside: false };
  const wheels = wheelPoints(vehicle), dips = wheels.map(([x, y]) => dipAt(world.potholes, x, y));
  const inside = dips.some((d) => d > 0);
  if (inside && !u.inside) {
    const front = Math.max(dips[0], dips[1]) > 0;
    u.t = 0; u.amp = Math.min(MAX_DROP_M, Math.max(...dips) * (0.4 + Math.abs(vehicle.v) / 8)); u.pitch = front ? 1 : -1;
  }
  u.inside = inside;
  u.t += dt;
  const k = u.t < 6 * SETTLE_S ? Math.exp(-u.t / SETTLE_S) * Math.cos(2 * Math.PI * u.t / PERIOD_S) : 0;
  const wb = vehicle.spec?.wheelbase || 2.7;
  mesh.position.y -= u.amp * k;
  mesh.rotation.z = (calmed ? mesh.rotation.z : 0) - u.pitch * Math.atan2(u.amp * k, wb);
}
