// Street and yard trees, instanced per chunk. Broadleaf crowns use outward normals from the crown
// center so light wraps the volume; alpha-tested cards cast dappled shadows and sway in the vertex
// shader. Conifers are stacked drooping needle tiers.

import * as THREE from "three";
import { mergeGeometries, mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { sceneryFor } from "../map/scenery.js";
import { hash01 } from "./geo.js";
import { toThree } from "./scene.js";
import { snowable } from "./weather.js";
import { lighting } from "./atmosphere.js";
import { leafTexture, needleTexture, barkTexture, LEAF_CUTOFF } from "./textures.js";
import { chunkLOD } from "./lod.js";

const CHUNK = 180;
const LEAF = [0x4d7a2e, 0x5a8a34, 0x668f3a, 0x42692c, 0x6f9440, 0x547f31, 0x5b7a2f];
const PLUM = 0x7a3c4c;      // purple-leaf plums line many Vancouver side streets
const NEEDLE = [0x33502f, 0x2d4a36, 0x3b5a3c];
const VARIANTS = 3;

// A unit crown (radius ~1, centered on the origin) of leaf cards around a core. Distant crowns
// have fewer, larger cards, so they keep the same leaf cover with fewer triangles.
function crownGeometry(seed, count = 150, cardScale = 1) {
  const rnd = mulberry(seed * 7919 + 13);
  const cards = [];
  for (let i = 0; i < count; i++) {
    // points biased toward the surface of a slightly flattened, lumpy ellipsoid
    const u = rnd() * 2 - 1, th = rnd() * Math.PI * 2;
    const r = Math.sqrt(1 - u * u);
    const dir = new THREE.Vector3(r * Math.cos(th), u * 0.85, r * Math.sin(th));
    const lump = 0.8 + 0.25 * Math.sin(th * 3 + seed) * Math.cos(u * 4 + seed);
    const depth = 0.55 + 0.45 * Math.pow(rnd(), 0.5);
    // larger cards sit a little deeper, so the crown's silhouette keeps its size
    const c = dir.clone().multiplyScalar(lump * depth / Math.sqrt(cardScale));
    const size = (0.55 + rnd() * 0.35) * cardScale;
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
    const k = 0.5 + 0.12 * hash01(i, seed);
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.82, p.getZ(i) * k);
  }
  g.computeVertexNormals();
  g.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(p.count * 2), 2));
  return g;
}

// The core used to be a smooth, evenly lit ball that showed through every gap as a dark sphere.
// Texture it with the leaf clusters themselves (projected along the three axes, so the
// icosphere needs no UV seams): leaves where the card is opaque, deep shade between them.
function leafyCore(material, leafMap) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    if (prev) prev(shader, renderer);
    shader.uniforms.coreLeaves = { value: leafMap };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vCorePos;\nvarying vec3 vCoreNormal;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvCorePos = position;\nvCoreNormal = normal;");
    shader.fragmentShader = shader.fragmentShader
      // The leaf card texture clamps at its edges; tile it here, with gradients taken from the
      // continuous coordinate so the wrap does not pick a blurry mip level along a seam.
      .replace("#include <common>", `#include <common>
        uniform sampler2D coreLeaves;
        varying vec3 vCorePos;
        varying vec3 vCoreNormal;
        vec4 coreLeafSample(vec2 uv) { return textureGrad(coreLeaves, fract(uv), dFdx(uv), dFdy(uv)); }`)
      .replace("#include <map_fragment>", `#include <map_fragment>
        vec3 coreW = pow(abs(normalize(vCoreNormal)), vec3(4.0));
        coreW /= coreW.x + coreW.y + coreW.z;
        vec4 leaves = coreLeafSample(vCorePos.yz * 2.2) * coreW.x
          + coreLeafSample(vCorePos.xz * 2.2 + 0.31) * coreW.y
          + coreLeafSample(vCorePos.xy * 2.2 + 0.67) * coreW.z;
        diffuseColor.rgb *= mix(vec3(0.35), leaves.rgb * 1.8, leaves.a);`);
  };
  const prevKey = material.customProgramCacheKey ? material.customProgramCacheKey.bind(material) : () => "";
  material.customProgramCacheKey = () => `leafy-core-${prevKey()}`;
  return material;
}

// Crown normals point out of the crown, not out of each card. A double-sided material normally
// flips the normal on a card's back face, which turned the shading inside out on about half of
// all leaves: a salt-and-pepper mix of lit and dark cards. Keep the crown normal on both faces,
// and let leaves deeper inside the crown take less sky light, as the outer leaves shade them.
function crownShading(material) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    if (prev) prev(shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying float vCrownDepth;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvCrownDepth = length(position);");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vCrownDepth;")
      .replace("#include <normal_fragment_begin>", `#include <normal_fragment_begin>
        #ifdef DOUBLE_SIDED
          normal *= faceDirection;
          nonPerturbedNormal = normal;
        #endif`)
      .replace("#include <aomap_fragment>", `#include <aomap_fragment>
        reflectedLight.indirectDiffuse *= mix(0.45, 1.0, smoothstep(0.35, 1.0, vCrownDepth));`);
  };
  const prevKey = material.customProgramCacheKey ? material.customProgramCacheKey.bind(material) : () => "";
  material.customProgramCacheKey = () => `crown-shading-${prevKey()}`;
  return material;
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
  return mergeGeometries(parts.map((p) => p.index ? p.toNonIndexed() : p), false);
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
  const spots = sceneryFor(map).trees;

  const crowns = [], cores = [], trunks = [], conifers = [];
  for (let v = 0; v < VARIANTS; v++) {
    crowns.push(crownGeometry(v + 1)); cores.push(coreGeometry(v + 1)); trunks.push(trunkGeometry(v + 1)); conifers.push(coniferGeometry(v + 1));
  }
  const distantCrown = crownGeometry(1, 40, 1.6), distantCore = coreGeometry(1, 1);
  const distantTrunk = new THREE.CylinderGeometry(0.1, 0.17, 1, 5).translate(0, 0.5, 0);
  const distantConifer = coniferGeometry(1, false);
  const leafMap = leafTexture();
  // Alpha to coverage turns the cutout edge into a partial-coverage edge wherever the target is
  // multisampled (Low draws to the antialiased canvas, High to a multisampled scene target); on
  // single-sample targets it behaves as the plain alpha test.
  const leafMat = withWind(crownShading(snowable(new THREE.MeshStandardMaterial({ map: leafMap, alphaTest: LEAF_CUTOFF, alphaToCoverage: true,
    side: THREE.DoubleSide, roughness: 0.78, metalness: 0 }), "leaf")), 0.05);
  // Shadows sway with the leaves. A still shadow caster under moving leaves shadowed each card by
  // its own offset copy, so dark blotches swam across the crowns in any wind.
  const leafDepth = withWind(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: leafMap, alphaTest: LEAF_CUTOFF, side: THREE.DoubleSide }), 0.05);
  const coreMat = leafyCore(snowable(new THREE.MeshStandardMaterial({ roughness: 0.95 }), "leaf"), leafMap);
  const needleMat = withWind(snowable(new THREE.MeshStandardMaterial({ map: needleTexture(), side: THREE.DoubleSide, roughness: 0.85 }), "leaf"), 0.02);
  const needleDepth = withWind(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide }), 0.02);
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
    b.core[v].push(inst(t.x, t.y, cz, r, r * 0.95, r, rot, base.clone().multiplyScalar(0.8)));
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
      emit(near, conifers[v], needleMat, c.conifer[v], needleDepth);
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
