// Street trees on the grass boulevards and a scatter of yard trees, the way Kitsilano looks from the
// road. Instanced per chunk: one draw call per part per chunk, culled like the buildings.

import * as THREE from "three";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { pointAt, headingAt } from "../map/mapdata.js";
import { hash01 } from "./geo.js";
import { toThree } from "./scene.js";

const CHUNK = 180;
const LEAF = [0x3f6b2a, 0x4b7a31, 0x58883a, 0x355d29, 0x62883a, 0x44722f, 0x4f6f2c];
const PLUM = 0x6a3a45;      // purple-leaf plums line many Vancouver side streets
const NEEDLE = [0x2c4a2c, 0x264232, 0x33553a];
const BOULEVARD = { residential: 1.8, living_street: 1.2, tertiary: 1.2, unclassified: 1.2 };

function blobGeometry(seed) {
  let g = new THREE.IcosahedronGeometry(1, 1);
  g.deleteAttribute("normal"); g.deleteAttribute("uv");
  g = mergeVertices(g);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const k = 0.82 + 0.3 * hash01(i, seed);
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.9, p.getZ(i) * k);
  }
  g = g.toNonIndexed();
  g.computeVertexNormals();
  return g;
}

export function buildTrees(map, roads, footprints) {
  const spots = [];   // {x, y, kind, size, key}
  const clear = (x, y, margin) => !footprints.near(x, y, margin) && map.roadDistance(x, y).distance > 1.0;

  // street trees on the boulevard, both sides
  for (const st of roads.streets) {
    const e = st.edge;
    const blvd = BOULEVARD[e.cls];
    if (!blvd) continue;
    const L = e.cum[e.cum.length - 1];
    const trim = (id) => ((roads.legs.get(id) || []).length >= 3 ? roads.nodeR.get(id) + 7 : 2);
    const from = trim(e.from), to = L - trim(e.to);
    for (const sign of [1, -1]) {
      const lat = sign > 0 ? e.asphalt[1] + 0.3 + 0.22 + blvd / 2 : e.asphalt[0] - 0.3 - 0.22 - blvd / 2;
      for (let s = from + 3 + hash01(e.id, sign) * 6; s < to; s += 10 + hash01(e.id + s, 7) * 5) {
        const key = `${e.id}:${sign}:${Math.round(s)}`;
        if (hash01(key, 1) < 0.14) continue;   // gaps for driveways
        const p = pointAt(e.pts, e.cum, s), h = headingAt(e.pts, e.cum, s);
        const x = p[0] + Math.sin(h) * lat, y = p[1] - Math.cos(h) * lat;
        if (!clear(x, y, 2.0)) continue;
        spots.push({ x, y, key, kind: hash01(key, 2) < 0.12 ? "plum" : "leaf", size: 0.8 + hash01(key, 3) * 0.35 });
      }
    }
  }

  // yard trees, away from streets and houses
  const [x0, y0, x1, y1] = map.extent;
  for (let x = x0; x < x1; x += 13) for (let y = y0; y < y1; y += 13) {
    const key = `${x},${y}`;
    if (hash01(key, 9) > 0.4) continue;
    const px = x + hash01(key, 10) * 13, py = y + hash01(key, 11) * 13;
    if (footprints.near(px, py, 2.5) || map.roadDistance(px, py).distance < 7) continue;
    spots.push({ x: px, y: py, key, kind: hash01(key, 12) < 0.3 ? "conifer" : "leaf", size: 0.8 + hash01(key, 13) * 0.6 });
  }

  const blobs = [blobGeometry(1), blobGeometry(2), blobGeometry(3)];
  const trunkGeo = new THREE.CylinderGeometry(0.1, 0.17, 1, 6).translate(0, 0.5, 0);
  const coneGeo = new THREE.ConeGeometry(1, 1, 7).translate(0, 0.5, 0);
  const leafMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, flatShading: true });
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a4636, roughness: 0.95 });

  const chunks = new Map();
  const bucket = (x, y) => {
    const k = `${Math.floor(x / CHUNK)},${Math.floor(y / CHUNK)}`;
    if (!chunks.has(k)) chunks.set(k, { trunk: [], cone: [], blob: [[], [], []] });
    return chunks.get(k);
  };
  const q = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0);
  const inst = (x, y, z, sx, sy, sz, rot, col = null) => ({ m: new THREE.Matrix4().compose(toThree(x, y, z), q.clone().setFromAxisAngle(Y, rot), new THREE.Vector3(sx, sy, sz)), col });
  for (const t of spots) {
    const b = bucket(t.x, t.y);
    const rot = hash01(t.key, 20) * Math.PI * 2;
    if (t.kind === "conifer") {
      const hgt = (7 + hash01(t.key, 21) * 5) * t.size, r = hgt * 0.24;
      const col = new THREE.Color(NEEDLE[Math.floor(hash01(t.key, 22) * NEEDLE.length)]);
      b.trunk.push(inst(t.x, t.y, 0, 1.3, 1.6, 1.3, rot));
      b.cone.push(inst(t.x, t.y, 1.0, r, hgt * 0.7, r, rot, col));
      b.cone.push(inst(t.x, t.y, 1.0 + hgt * 0.35, r * 0.72, hgt * 0.62, r * 0.72, rot + 1, col));
      continue;
    }
    const trunkH = (3.6 + hash01(t.key, 23) * 1.6) * t.size;
    const r = (2.0 + hash01(t.key, 24) * 1.4) * t.size;
    const base = new THREE.Color(t.kind === "plum" ? PLUM : LEAF[Math.floor(hash01(t.key, 25) * LEAF.length)]);
    b.trunk.push(inst(t.x, t.y, 0, 1.4 * t.size, trunkH + r * 0.6, 1.4 * t.size, rot));
    const v = Math.floor(hash01(t.key, 26) * 3);
    b.blob[v].push(inst(t.x, t.y, trunkH + r * 0.72, r, r, r, rot, base));
    const off = r * 0.55, a = rot * 1.7;
    b.blob[(v + 1) % 3].push(inst(t.x + Math.cos(a) * off, t.y + Math.sin(a) * off, trunkH + r * 0.95, r * 0.66, r * 0.66, r * 0.66, rot + 2,
      base.clone().multiplyScalar(0.9 + hash01(t.key, 27) * 0.25)));
  }

  const group = new THREE.Group();
  const emit = (geo, mat, list) => {
    if (!list.length) return;
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((it, i) => { mesh.setMatrixAt(i, it.m); if (it.col) mesh.setColorAt(i, it.col); });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  };
  for (const c of chunks.values()) {
    emit(trunkGeo, trunkMat, c.trunk);
    emit(coneGeo, leafMat, c.cone);
    c.blob.forEach((list, i) => emit(blobs[i], leafMat, list));
  }
  group.userData.count = spots.length;
  return group;
}
