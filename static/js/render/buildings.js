// Extruded building footprints, merged into one mesh with a slight per-building tint.

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

export function buildBuildings(map) {
  const geos = [];
  const palette = [0xb9b3a8, 0xc9c2b4, 0xa8a49c, 0xd2c8b6, 0xb0b8c0, 0xc4b8a4];
  let i = 0;
  for (const b of map.pack.buildings) {
    const shape = new THREE.Shape(b.pts.map(([x, y]) => new THREE.Vector2(x, y)));
    const geo = new THREE.ExtrudeGeometry(shape, { depth: b.h, bevelEnabled: false, curveSegments: 1 });
    geo.rotateX(-Math.PI / 2);   // shape (x, y) -> (x, ., -y); extrusion depth -> up
    const color = new THREE.Color(palette[i++ % palette.length]);
    const colors = new Float32Array(geo.attributes.position.count * 3);
    for (let k = 0; k < colors.length; k += 3) { colors[k] = color.r; colors[k + 1] = color.g; colors[k + 2] = color.b; }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geos.push(geo);
  }
  if (!geos.length) return new THREE.Group();
  const merged = mergeGeometries(geos, false);
  const mesh = new THREE.Mesh(merged, new THREE.MeshLambertMaterial({ vertexColors: true }));
  return mesh;
}
