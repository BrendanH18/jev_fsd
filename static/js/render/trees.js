// Street trees on the grass boulevards and a scatter of yard trees, the way Kitsilano looks from the
// road. Instanced per chunk: one draw call per part per chunk, culled like the buildings.
//
// A broadleaf crown is a few hundred leaf-cluster cards scattered through an ellipsoid around a
// darker core, with normals that point out from the crown's center, so light wraps round the whole
// crown the way it does on a real tree rather than catching individual cards. The cards are
// alpha-tested (they cast dappled shadows too) and sway in the wind in the vertex shader. Trunks
// fork into a few limbs that reach up into the crown. Conifers are stacked tiers of drooping,
// ragged needle cones.

import * as THREE from "three";
import { mergeGeometries, mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { pointAt, headingAt } from "../map/mapdata.js";
import { hash01 } from "./geo.js";
import { toThree } from "./scene.js";
import { snowable } from "./weather.js";
import { lighting } from "./atmosphere.js";
import { leafTexture, needleTexture, barkTexture } from "./textures.js";
import { chunkLOD } from "./lod.js";

const CHUNK = 180;
const LEAF = [0x4d7a2e, 0x5a8a34, 0x668f3a, 0x42692c, 0x6f9440, 0x547f31, 0x5b7a2f];
const PLUM = 0x7a3c4c;      // purple-leaf plums line many Vancouver side streets
const NEEDLE = [0x33502f, 0x2d4a36, 0x3b5a3c];
const BOULEVARD = { residential: 1.8, living_street: 1.2, tertiary: 1.2, unclassified: 1.2 };
const VARIANTS = 3;

// A unit crown (radius ~1, centered on the origin) of leaf cards around a core.
function crownGeometry(seed, count = 150) {
  const rnd = mulberry(seed * 7919 + 13);
  const cards = [];
  for (let i = 0; i < count; i++) {
    // points biased toward the surface of a slightly flattened, lumpy ellipsoid
    const u = rnd() * 2 - 1, th = rnd() * Math.PI * 2;
    const r = Math.sqrt(1 - u * u);
    const dir = new THREE.Vector3(r * Math.cos(th), u * 0.85, r * Math.sin(th));
    const lump = 0.8 + 0.25 * Math.sin(th * 3 + seed) * Math.cos(u * 4 + seed);
    const depth = 0.55 + 0.45 * Math.pow(rnd(), 0.5);
    const c = dir.clone().multiplyScalar(lump * depth);
    const size = 0.55 + rnd() * 0.35;
    const g = new THREE.PlaneGeometry(size, size);
    g.rotateX(rnd() * Math.PI); g.rotateY(rnd() * Math.PI * 2); g.rotateZ(rnd() * Math.PI);
    g.translate(c.x, c.y, c.z);
    // crown-space normals: out from the center, a little toward the card's own position
    const pos = g.attributes.position, nrm = g.attributes.normal;
    for (let k = 0; k < pos.count; k++) {
      const n = new THREE.Vector3(pos.getX(k), pos.getY(k) * 1.2, pos.getZ(k)).normalize();
      nrm.setXYZ(k, n.x, n.y, n.z);
    }
    cards.push(g);
  }
  return mergeGeometries(cards, false);
}

// The crown's dark interior, so gaps between cards read as shade rather than sky.
function coreGeometry(seed, detail = 2) {
  let g = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute("normal"); g.deleteAttribute("uv");
  g = mergeVertices(g);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const k = 0.62 + 0.14 * hash01(i, seed);
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.82, p.getZ(i) * k);
  }
  g.computeVertexNormals();
  g.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(p.count * 2), 2));
  return g;
}

// Trunk with three or four limbs forking into the crown; unit height of trunk to the fork.
function trunkGeometry(seed) {
  const rnd = mulberry(seed * 104729 + 1);
  const parts = [new THREE.CylinderGeometry(0.1, 0.17, 1, 7).translate(0, 0.5, 0)];
  const limbs = 3 + Math.floor(rnd() * 2);
  for (let i = 0; i < limbs; i++) {
    const len = 0.7 + rnd() * 0.4;
    const g = new THREE.CylinderGeometry(0.035, 0.08, len, 5).translate(0, len / 2, 0);
    g.rotateZ(0.45 + rnd() * 0.35);
    g.rotateY((i / limbs) * Math.PI * 2 + rnd());
    g.translate(0, 0.92, 0);
    parts.push(g);
  }
  return mergeGeometries(parts.map((p) => p.toNonIndexed()), false);
}

// Conifer: tiers of ragged, drooping cones, each a little narrower than the one below.
function coniferGeometry(seed, detailed = true) {
  const rnd = mulberry(seed * 3571 + 5);
  const tiers = [];
  const n = 5;
  for (let t = 0; t < n; t++) {
    const f = t / n;
    const r = 1 - f * 0.78, h = 0.34;
    const g = new THREE.ConeGeometry(r, h, detailed ? 14 : 7, detailed ? 2 : 1, true);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      if (p.getY(i) < -h / 2 + 1e-3) {
        // ragged, drooping rim
        const a = Math.atan2(p.getZ(i), p.getX(i));
        const k = 1 + 0.18 * Math.sin(a * 7 + t * 2 + seed) + 0.1 * (rnd() - 0.5);
        p.setXYZ(i, p.getX(i) * k, p.getY(i) - 0.06 * k, p.getZ(i) * k);
      }
    }
    g.computeVertexNormals();
    g.translate(0, 0.12 + f * 0.8 + h / 2, 0);
    tiers.push(g);
  }
  tiers.push(new THREE.ConeGeometry(0.16, 0.22, 8).translate(0, 1.06, 0));
  const out = mergeGeometries(tiers.map((g) => g.toNonIndexed()), false);
  // soften: normals lean outward and up, like the crown's
  const pos = out.attributes.position, nrm = out.attributes.normal;
  for (let i = 0; i < pos.count; i++) {
    const n = new THREE.Vector3(nrm.getX(i), nrm.getY(i), nrm.getZ(i));
    const radial = new THREE.Vector3(pos.getX(i), 0.35, pos.getZ(i)).normalize();
    n.lerp(radial, 0.55).normalize();
    nrm.setXYZ(i, n.x, n.y, n.z);
  }
  return out;
}

// Leaves sway: the higher and further out on the crown, the more; each tree on its own phase.
function withWind(material, amount) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    if (prev) prev(shader, renderer);
    shader.uniforms.uTime = lighting.time;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uTime;")
      .replace("#include <begin_vertex>", `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 treePos = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        #else
          vec3 treePos = vec3(0.0);
        #endif
        float ph = dot(treePos.xz, vec2(0.13, 0.071));
        float reach = clamp(length(position.xz) * 0.8 + position.y * 0.4, 0.0, 1.5);
        float gust = 0.6 + 0.4 * sin(uTime * 0.45 + ph * 0.3);
        transformed.x += ${amount.toFixed(3)} * reach * gust * (sin(uTime * 1.7 + ph + position.y * 2.0) + 0.4 * sin(uTime * 4.1 + ph * 2.3 + position.x * 5.0));
        transformed.z += ${amount.toFixed(3)} * reach * gust * 0.7 * cos(uTime * 1.3 + ph * 1.4 + position.z * 3.0);`);
  };
  const prevKey = material.customProgramCacheKey ? material.customProgramCacheKey.bind(material) : () => "";
  material.customProgramCacheKey = () => `wind-${amount}-${prevKey()}`;
  return material;
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

  // one tree on each roundabout island, as on Vancouver's planted traffic circles
  for (const rb of (map.roundabouts || new Map()).values()) {
    spots.push({ x: rb.x, y: rb.y, key: rb.id, kind: "leaf", size: Math.min(0.85, 0.35 + rb.island_r * 0.12) });
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

  const crowns = [], cores = [], trunks = [], conifers = [];
  for (let v = 0; v < VARIANTS; v++) {
    crowns.push(crownGeometry(v + 1)); cores.push(coreGeometry(v + 1)); trunks.push(trunkGeometry(v + 1)); conifers.push(coniferGeometry(v + 1));
  }
  const distantCrown = crownGeometry(1, 40), distantCore = coreGeometry(1, 0);
  const distantTrunk = new THREE.CylinderGeometry(0.1, 0.17, 1, 5).translate(0, 0.5, 0);
  const distantConifer = coniferGeometry(1, false);
  const leafMap = leafTexture();
  const leafMat = withWind(snowable(new THREE.MeshStandardMaterial({ map: leafMap, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.78, metalness: 0 }), "leaf"), 0.05);
  const leafDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: leafMap, alphaTest: 0.45, side: THREE.DoubleSide });
  const coreMat = snowable(new THREE.MeshStandardMaterial({ color: 0x9aa597, roughness: 0.95 }), "leaf");
  const needleMat = withWind(snowable(new THREE.MeshStandardMaterial({ map: needleTexture(), side: THREE.DoubleSide, roughness: 0.85 }), "leaf"), 0.02);
  const barkMat = new THREE.MeshStandardMaterial({ map: barkTexture(), color: 0x8a7462, roughness: 0.95 });

  const chunks = new Map();
  const bucket = (x, y) => {
    const k = `${Math.floor(x / CHUNK)},${Math.floor(y / CHUNK)}`;
    if (!chunks.has(k)) chunks.set(k, { trunk: [[], [], []], crown: [[], [], []], core: [[], [], []], conifer: [[], [], []] });
    return chunks.get(k);
  };
  const q = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0);
  const inst = (x, y, z, sx, sy, sz, rot, col = null) => ({ m: new THREE.Matrix4().compose(toThree(x, y, z), q.clone().setFromAxisAngle(Y, rot), new THREE.Vector3(sx, sy, sz)), col });
  for (const t of spots) {
    const b = bucket(t.x, t.y);
    const rot = hash01(t.key, 20) * Math.PI * 2;
    const v = Math.floor(hash01(t.key, 26) * VARIANTS);
    if (t.kind === "conifer") {
      const hgt = (8 + hash01(t.key, 21) * 6) * t.size, r = hgt * 0.26;
      const c = new THREE.Color(NEEDLE[Math.floor(hash01(t.key, 22) * NEEDLE.length)]);
      b.trunk[v].push(inst(t.x, t.y, 0, 1.2, hgt * 0.3, 1.2, rot));
      b.conifer[v].push(inst(t.x, t.y, 0, r, hgt, r, rot, c));
      continue;
    }
    const trunkH = (2.6 + hash01(t.key, 23) * 1.2) * t.size;
    const r = (2.3 + hash01(t.key, 24) * 1.5) * t.size;
    const base = new THREE.Color(t.kind === "plum" ? PLUM : LEAF[Math.floor(hash01(t.key, 25) * LEAF.length)]);
    base.multiplyScalar(0.9 + hash01(t.key, 27) * 0.2);
    b.trunk[v].push(inst(t.x, t.y, 0, 1.5 * t.size, trunkH, 1.5 * t.size, rot));
    const cz = trunkH + r * 0.72;
    b.crown[v].push(inst(t.x, t.y, cz, r, r * 0.95, r, rot, base));
    b.core[v].push(inst(t.x, t.y, cz, r, r * 0.95, r, rot, base.clone().multiplyScalar(0.45)));
  }

  const group = new THREE.Group();
  const emit = (level, geo, mat, list, depthMat = null) => {
    if (!list.length) return;
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((it, i) => { mesh.setMatrixAt(i, it.m); if (it.col) mesh.setColorAt(i, it.col); });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    if (depthMat) mesh.customDepthMaterial = depthMat;
    mesh.computeBoundingSphere();
    level.add(mesh);
  };
  for (const c of chunks.values()) {
    const near = new THREE.Group(), far = new THREE.Group();
    for (let v = 0; v < VARIANTS; v++) {
      emit(near, trunks[v], barkMat, c.trunk[v]);
      emit(near, cores[v], coreMat, c.core[v]);
      emit(near, crowns[v], leafMat, c.crown[v], leafDepth);
      emit(near, conifers[v], needleMat, c.conifer[v]);
    }
    // Merge distant variants into one batch per part; per-instance color and scale preserve variety.
    emit(far, distantTrunk, barkMat, c.trunk.flat());
    emit(far, distantCore, coreMat, c.core.flat());
    emit(far, distantCrown, leafMat, c.crown.flat(), leafDepth);
    emit(far, distantConifer, needleMat, c.conifer.flat());
    group.add(chunkLOD(near, far));
  }
  group.userData.count = spots.length;
  return group;
}

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
