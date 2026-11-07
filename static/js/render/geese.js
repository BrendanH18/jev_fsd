// Canada geese crossing the road (sim/geese.js). Low-poly, vertex-coloured: an adult has a brown-grey
// body over a pale belly, a black tail, a long black neck and head with the white chinstrap, and black
// legs and bill; a gosling is half the size and yellow-grey all over. Each kind is drawn two ways, neck
// up (walking, or standing alert) and head down (grazing on the grass), as instanced meshes, so a
// gaggle costs four draw calls however many geese it has. They waddle as they walk, bobbing and rolling
// from foot to foot with the distance walked, so their feet do not slide. Depth-tested, standing on the
// ground (never below it); geese far from the car are not drawn.

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { onRoadway } from "../sim/geese.js";

const CAPACITY = 48;
const DRAW_WITHIN_M = 160;
const BODY = 0x7d6c5a, BELLY = 0xd8d0c2, BLACK = 0x161616, WHITE = 0xf4f2ec, LEG = 0x242424;
const DOWN = 0xbfae72, DOWN_DARK = 0x9c8f5e, DOWN_BILL = 0x4a4a42;

const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });

function tint(geo, hex) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const c = new THREE.Color(hex), n = g.attributes.position.count, col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  if (g.attributes.uv) g.deleteAttribute("uv");
  if (g.attributes.normal) g.computeVertexNormals();
  return g;
}
const ellipsoid = (rx, ry, rz) => new THREE.SphereGeometry(1, 8, 6).scale(rx, ry, rz);
// A cylinder from point a to point b (in the x-y plane), radius r0 at a and r1 at b.
function stalk(a, b, r0, r1) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const g = new THREE.CylinderGeometry(r1, r0, len, 6).translate(0, len / 2, 0);
  g.rotateZ(-Math.atan2(b[0] - a[0], b[1] - a[1]));
  return g.translate(a[0], a[1], 0);
}

// One goose, local +x forward, +y up, +z right, standing on y = 0. `grazing`: head down at the grass.
function gooseGeometry({ gosling = false, grazing = false } = {}) {
  const body = gosling ? DOWN : BODY, belly = gosling ? DOWN : BELLY, neck = gosling ? DOWN_DARK : BLACK, chin = gosling ? DOWN_DARK : WHITE, bill = gosling ? DOWN_BILL : BLACK;
  const neckFrom = [0.22, 0.36], neckTo = grazing ? [0.42, 0.13] : [0.3, 0.64];
  const head = grazing ? [0.46, 0.09] : [0.335, 0.665];
  const billDir = grazing ? [0.5, -0.86] : [1, -0.12];
  const parts = [
    tint(ellipsoid(0.3, 0.155, 0.15).translate(0, 0.31, 0), body),
    tint(ellipsoid(0.24, 0.1, 0.125).translate(0.03, 0.25, 0), belly),
    tint(ellipsoid(0.1, 0.05, 0.08).rotateZ(0.35).translate(-0.29, 0.35, 0), BLACK),
    tint(stalk(neckFrom, neckTo, 0.045, 0.032), neck),
    tint(ellipsoid(0.07, 0.05, 0.045).rotateZ(grazing ? -1.0 : -0.1).translate(head[0], head[1], 0), neck),
    // (the white chinstrap: a band across the cheeks and under the chin)
    tint(ellipsoid(0.045, 0.032, 0.05).rotateZ(grazing ? -1.0 : -0.1).translate(head[0] - (grazing ? 0.01 : 0.012), head[1] - (grazing ? 0.0 : 0.018), 0), chin),
    tint(new THREE.ConeGeometry(0.02, 0.07, 5).rotateZ(-Math.PI / 2).rotateZ(Math.atan2(billDir[1], billDir[0])).translate(head[0] + billDir[0] * 0.08, head[1] + billDir[1] * 0.08, 0), bill),
    tint(stalk([0.02, 0.0], [0.0, 0.2], 0.012, 0.014).translate(0, 0, 0.055), LEG),
    tint(stalk([0.02, 0.0], [0.0, 0.2], 0.012, 0.014).translate(0, 0, -0.055), LEG),
    tint(new THREE.BoxGeometry(0.08, 0.01, 0.06).translate(0.045, 0.005, 0.055), LEG),
    tint(new THREE.BoxGeometry(0.08, 0.01, 0.06).translate(0.045, 0.005, -0.055), LEG),
  ];
  const g = mergeGeometries(parts);
  return gosling ? g.scale(0.5, 0.5, 0.5) : g;
}

export class GeeseView {
  constructor(scene) {
    this.meshes = {};
    for (const gosling of [false, true]) for (const grazing of [false, true]) {
      const mesh = new THREE.InstancedMesh(gooseGeometry({ gosling, grazing }), material, CAPACITY);
      mesh.count = 0; mesh.frustumCulled = false; mesh.castShadow = true; mesh.name = `geese_${gosling ? "goslings" : "adults"}${grazing ? "_grazing" : ""}`;
      scene.add(mesh);
      this.meshes[`${gosling}:${grazing}`] = mesh;
    }
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.e = new THREE.Euler(0, 0, 0, "YXZ"); this.p = new THREE.Vector3(); this.s = new THREE.Vector3(1, 1, 1);
  }

  sync(world, t) {
    const counts = {};
    for (const key of Object.keys(this.meshes)) counts[key] = 0;
    const ego = world.ego;
    for (const g of world.geese?.gaggles || []) {
      if (Math.hypot(g.geo.mid[0] - ego.x, g.geo.mid[1] - ego.y) > DRAW_WITHIN_M) continue;
      const grass = g.phase === "waiting" || g.phase === "across";
      for (const o of g.geese) {
        // (grazing on the grass, now and then looking up; standing in the road, alert)
        const grazing = grass && o.v < 0.03 && !onRoadway(g, o) && Math.sin(t * 0.6 + o.wobble * 3 + (o.gosling ? 1 : 0)) > -0.35;
        const key = `${o.gosling}:${grazing}`, mesh = this.meshes[key];
        if (counts[key] >= CAPACITY) continue;
        // (the waddle: a bob and a roll from foot to foot, with the distance walked)
        const stride = o.gosling ? 0.12 : 0.2, phase = (o.u / stride) * Math.PI;
        const moving = Math.min(1, o.v / 0.3), size = o.gosling ? 0.5 : 1;
        this.p.set(o.x, Math.abs(Math.sin(phase)) * 0.018 * size * moving, -o.y);
        this.e.set(0.12 * Math.sin(phase) * moving, o.psi, 0.04 * Math.sin(phase * 2) * moving);
        this.q.setFromEuler(this.e);
        this.m.compose(this.p, this.q, this.s);
        mesh.setMatrixAt(counts[key]++, this.m);
      }
    }
    for (const [key, mesh] of Object.entries(this.meshes)) {
      mesh.count = counts[key];
      mesh.instanceMatrix.needsUpdate = true;
    }
  }
}
