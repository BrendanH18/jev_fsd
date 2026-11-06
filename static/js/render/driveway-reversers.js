// Driveways and the cars backing out of them (sim/driveway-reversers.js), drawn where the world has them
// back out: a concrete apron with a dropped kerb across the curb, boulevard and sidewalk at each mapped
// driveway (a ground layer between the curb and the asphalt, see LAYER in render/scene.js), and white
// reverse lamps on a car while it backs out (`reverseLamps`, render-only: nothing in the sim reads them).

import * as THREE from "three";
import { headingAt, pointAt } from "../map/mapdata.js";
import { groundLayer, LAYER } from "./scene.js";
import { glowTexture } from "./textures.js";
import { GUTTER, CURB, streetOf } from "../map/streets.js";

const APRON_HALF_M = 1.8;
const APRON_BACK_M = 0.6;
const APRON_ORDER = LAYER.curb + 1;

export function buildDriveways(map) {
  const group = new THREE.Group();
  group.name = "driveways";
  const pos = [];
  for (const d of map.driveways || []) {
    const e = map.edges.get(d.edge);
    if (!e) continue;
    const sigma = d.side === "left" ? -1 : 1;
    const s = Math.max(0, Math.min(e.length, d.s)) * e.cum[e.cum.length - 1] / Math.max(1e-6, e.length);
    const q = pointAt(e.pts, e.cum, s), h = headingAt(e.pts, e.cum, s);
    const t = [Math.cos(h), Math.sin(h)], n = [Math.sin(h) * sigma, -Math.cos(h) * sigma];
    const [blvd, walk] = streetOf(e);
    const kerb = sigma > 0 ? e.asphalt[1] : -e.asphalt[0];
    const a = kerb, b = kerb + GUTTER + CURB + blvd + walk + APRON_BACK_M;
    // (a trapezoid: flared where it meets the street)
    const corner = (out, along) => [q[0] + n[0] * out + t[0] * along, q[1] + n[1] * out + t[1] * along];
    const c = [corner(a, -APRON_HALF_M - 0.6), corner(a, APRON_HALF_M + 0.6), corner(b, APRON_HALF_M), corner(b, -APRON_HALF_M)];
    const v = (p) => [p[0], 0, -p[1]];
    // (two triangles, wound to face up whichever side of the street it is on)
    const tri = sigma > 0 ? [c[0], c[2], c[1], c[0], c[3], c[2]] : [c[0], c[1], c[2], c[0], c[2], c[3]];
    for (const p of tri) pos.push(...v(p));
  }
  if (!pos.length) return group;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xbdbab2, roughness: 0.92, side: THREE.DoubleSide }));
  mesh.name = "driveway-aprons";
  group.add(groundLayer(mesh, APRON_ORDER));
  return group;
}

// White reverse lamps at the rear of a car mesh (render/cars.js createCarMesh), lit while it backs out.
export function syncReverseLamps(mesh, vehicle) {
  if (!mesh) return;
  const u = mesh.userData;
  if (!u.reverseLamps) {
    if (!vehicle.reverseLamps) return;
    const spec = vehicle.spec, xr = -spec.rearOverhang, w = spec.width;
    u.reverseLamps = [];
    for (const z of [-(w / 2 - 0.45), w / 2 - 0.45]) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.95 }));
      sprite.position.set(xr - 0.12, u.body ? 0.78 : 0.8, z);
      sprite.scale.setScalar(0.85);
      (u.body || mesh).add(sprite);
      u.reverseLamps.push(sprite);
    }
  }
  for (const s of u.reverseLamps) s.visible = !!vehicle.reverseLamps;
}
