// Speed humps, tables, cushions and bumps (sim/traffic-calming.js), drawn where they rise across the
// street, with white triangles painted on them pointing each way along it as Canadian cities mark
// them, and the cars riding over them: a car's body rises with the height under its axles and
// pitches with the difference between them (render only; the sim's car stays on the road).

import * as THREE from "three";
import { headingAt, pointAt } from "../map/mapdata.js";
import { asphaltTexture } from "./textures.js";
import { deviceOf, liftAt, riseAt } from "../sim/traffic-calming.js";
import { snowable } from "./weather.js";
import { wetReflective } from "./reflection.js";

// Drawn after the ground's markings (render/scene.js LAYER.marking), above them: the device writes
// depth, so cars hide it.
const RENDER_ORDER = -18;
const STEPS = 12;

// Paint on a device: a white triangle every PAINT_M across, pointing along the street, on its near
// slope going each way.
const PAINT_M = 1.5;

function markingTexture() {
  const size = 256, c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = "#ecebe4";
  // (u across the canvas is along the street, v down it is across: one triangle per tile, pointing +u
  // on the near half and -u on the far one)
  const tri = (x0, x1, dir) => { ctx.beginPath(); ctx.moveTo(dir > 0 ? x0 : x1, 40); ctx.lineTo(dir > 0 ? x0 : x1, 216); ctx.lineTo(dir > 0 ? x1 : x0, 128); ctx.closePath(); ctx.fill(); };
  tri(24, 104, 1);
  tri(152, 232, -1);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

// One mesh for the devices' asphalt and one for their paint.
export function buildCalming(map) {
  const group = new THREE.Group();
  group.name = "traffic-calming";
  const pos = [], uv = [], idx = [], paintPos = [], paintUv = [], paintIdx = [];
  for (const device of map.calming || []) {
    const a = device.at.find((x) => map.edges.has(x.edge));
    if (!a) continue;
    const e = map.edges.get(a.edge), k = deviceOf(device), scale = e.cum[e.cum.length - 1] / Math.max(1e-6, e.length);
    const s0 = a.s * scale, lo = e.asphalt[0] + 0.15, hi = e.asphalt[1] - 0.15;
    const quad = (P, U, I, across, lift, vScale) => {
      const base = P.length / 3;
      for (let i = 0; i <= STEPS; i++) {
        const u = -k.length / 2 + (k.length * i) / STEPS, s = s0 + u, p = pointAt(e.pts, e.cum, s), h = headingAt(e.pts, e.cum, s);
        const y = riseAt(device, u) + lift;
        for (const v of across) {
          P.push(p[0] + Math.sin(h) * v, y, -(p[1] - Math.cos(h) * v));
          U.push(i / STEPS, v / vScale);
        }
      }
      const n = across.length;
      for (let i = 0; i < STEPS; i++) for (let j = 0; j < n - 1; j++) {
        const a0 = base + i * n + j, b0 = a0 + n;
        I.push(a0, b0, a0 + 1, a0 + 1, b0, b0 + 1);
      }
    };
    quad(pos, uv, idx, [lo, hi], 0.006, 7);
    // (the bump is too short to paint)
    if (k.length >= 2) quad(paintPos, paintUv, paintIdx, [lo + 0.3, hi - 0.3], 0.01, PAINT_M);
  }
  const mesh = (P, U, I, material) => {
    if (!I.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(U, 2));
    g.setIndex(I);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, material);
    m.renderOrder = RENDER_ORDER;
    m.receiveShadow = true;
    group.add(m);
  };
  mesh(pos, uv, idx, wetReflective(snowable(new THREE.MeshStandardMaterial({ map: asphaltTexture(), color: 0x9a9a98, roughness: 0.9, side: THREE.DoubleSide }), "asphalt"), 1));
  mesh(paintPos, paintUv, paintIdx, wetReflective(snowable(new THREE.MeshStandardMaterial({ map: markingTexture(), transparent: true, alphaTest: 0.5, roughness: 0.6, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), "paint"), 0.7));
  return group;
}

// Lift and pitch a vehicle's mesh (placed with rotation.y = heading, local +x forward) by the devices
// under its axles. Call after the mesh's own sync, every frame.
export function rideOver(map, mesh, vehicle) {
  if (!mesh || !vehicle) return;
  const wb = vehicle.spec?.wheelbase || 2.7, c = Math.cos(vehicle.psi), s = Math.sin(vehicle.psi);
  const rear = liftAt(map, vehicle.x, vehicle.y), front = liftAt(map, vehicle.x + c * wb, vehicle.y + s * wb);
  mesh.position.y = (rear + front) / 2;
  mesh.rotation.z = Math.atan2(front - rear, wb);
}
