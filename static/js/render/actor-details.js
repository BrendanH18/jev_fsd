import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { shareActorResources } from "./actor-resources.js";

const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 });
shareActorResources([material]);
const geometries = new Map();

export const RUBBER = 0x24272a;
export const STEEL = 0x8c969b;
export const REFLECT_RED = 0xc32425;
export const REFLECT_AMBER = 0xec9e28;
export const REFLECT_WHITE = 0xdde1dd;

export function boxDetail(name, color, width, height, depth, x, y, z) {
  return { name, color, geometry: new THREE.BoxGeometry(width, height, depth).translate(x, y, z) };
}

export function mirroredDetails(build) {
  return [-1, 1].flatMap(build);
}

// Batch small rigid details into one mesh per vehicle, sharing the buffers among vehicles of that
// model. Keep the part ranges on the geometry for inspection without adding more draw calls.
export function addActorDetails(parent, model, build) {
  let geometry = geometries.get(model);
  if (!geometry) {
    const parts = build();
    let start = 0;
    const ranges = new Map();
    const colored = [];
    for (const part of parts) {
      const g = part.geometry.index ? part.geometry.toNonIndexed() : part.geometry;
      const color = new THREE.Color(part.color);
      const count = g.attributes.position.count;
      const rgb = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) color.toArray(rgb, i * 3);
      g.setAttribute("color", new THREE.BufferAttribute(rgb, 3));
      const range = { start, count };
      if (!ranges.has(part.name)) ranges.set(part.name, []);
      ranges.get(part.name).push(range);
      start += count;
      colored.push(g);
    }
    geometry = mergeGeometries(colored);
    geometry.userData.parts = Object.fromEntries(ranges);
    geometries.set(model, geometry);
    shareActorResources([geometry]);
  }
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "body-details";
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}
