// Street lights. Cobra heads on tall poles along the arterials (both sides, about every 38 m) and
// shorter LED davit poles along residential streets (alternating sides, about every 45 m), the way
// Vancouver lights its streets. After dark the heads glow (and bloom), each throws a pool of light
// on the road and sidewalk below it, and the few lamps nearest the camera are real lights, so cars,
// walls, and trees close by are lit by them too.

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { pointAt, headingAt } from "../map/mapdata.js";
import { toThree, LAYER } from "./scene.js";
import { lampPoolTexture } from "./textures.js";
import { glowsAtNight, lighting } from "./atmosphere.js";
import { hash01 } from "./geo.js";
import { GUTTER, CURB } from "../map/streets.js";

const ARTERIAL = new Set(["primary", "secondary", "tertiary", "primary_link", "secondary_link", "tertiary_link"]);
const LIT = new Set([...ARTERIAL, "residential", "unclassified", "living_street"]);
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const LAMP_COLOR = 0xffe4bf;       // 4000 K LED, a touch warm
const REAL_LIGHTS = 6;

// Pole, arm, and head of each design, in the lamp's frame: +x along the street, -z toward the road.
function design(tall) {
  const h = tall ? 8.4 : 7.0, reach = tall ? 2.3 : 1.5;
  const pole = mergeGeometries([
    new THREE.CylinderGeometry(tall ? 0.08 : 0.07, tall ? 0.13 : 0.11, h, 8).translate(0, h / 2, 0),
    new THREE.CylinderGeometry(0.045, 0.05, reach + 0.2, 6).rotateX(Math.PI / 2).rotateX(-0.12).translate(0, h + 0.05, -reach / 2),
    new THREE.CylinderGeometry(0.2, 0.22, 0.35, 8).translate(0, 0.17, 0),   // base
  ].map((g) => g.toNonIndexed()), false);
  const head = tall
    ? new THREE.SphereGeometry(0.4, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(0.55, 0.32, 1).translate(0, h + 0.02, -reach - 0.1)
    : new THREE.BoxGeometry(0.28, 0.1, 0.62).translate(0, h, -reach - 0.1);
  const lens = new THREE.CircleGeometry(0.2, 12).rotateX(Math.PI / 2).scale(tall ? 1.1 : 0.8, 1, tall ? 1.7 : 1.4).translate(0, h - 0.07, -reach - 0.1);
  return { pole, head: head.toNonIndexed(), lens, h, reach };
}

export function buildStreetLights(map, group, streets, trimAt) {
  const lamps = [];   // { x, y, h, heading, tall, lx, ly } (lx, ly: the point under the head)
  for (const st of streets) {
    for (const e of [st.edge, st.twin]) {
      if (!e || !LIT.has(e.cls)) continue;
      const tall = ARTERIAL.has(e.cls);
      // a two-way residential street gets lights on alternating sides: each direction lights one
      // half; a one-way street lights both
      const L = e.cum[e.cum.length - 1];
      const from = trimAt(e.from) + 4, to = L - trimAt(e.to) - 6;
      const spacing = tall ? 38 : 45;
      const lat = e.asphalt[1] + GUTTER + CURB + 0.45;
      const phase = tall ? 0 : (st.twin && e === st.twin ? spacing / 2 : 0);
      for (let s = from + 6 + phase + hash01(e.id, 3) * 4; s < to; s += spacing) {
        const p = pointAt(e.pts, e.cum, s), h = headingAt(e.pts, e.cum, s);
        const nx = Math.sin(h), ny = -Math.cos(h);   // right of travel
        const x = p[0] + nx * lat, y = p[1] + ny * lat;
        const d = design(tall);
        lamps.push({ x, y, h: d.h, heading: h, tall, lx: x - nx * (d.reach + 0.1), ly: y - ny * (d.reach + 0.1) });
      }
    }
  }
  if (!lamps.length) return { lamps, lights: null };

  const designs = { true: design(true), false: design(false) };
  const metal = new THREE.MeshStandardMaterial({ color: 0x5b6066, roughness: 0.5, metalness: 0.6 });
  const headMat = new THREE.MeshStandardMaterial({ color: 0x3c4046, roughness: 0.45, metalness: 0.5 });
  const lensMat = glowsAtNight(new THREE.MeshStandardMaterial({ color: 0xd9dde2, emissive: LAMP_COLOR, roughness: 0.25 }), 0.0, 5);
  const poolMat = glowsAtNight(new THREE.MeshBasicMaterial({ map: lampPoolTexture(), color: LAMP_COLOR, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }), 0, 0.26, "opacity");
  const q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), m = new THREE.Matrix4();
  for (const tall of [true, false]) {
    const list = lamps.filter((l) => l.tall === tall);
    if (!list.length) continue;
    const d = designs[tall];
    const emit = (geo, mat, shadow) => {
      const mesh = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((l, i) => { q.setFromAxisAngle(Y_AXIS, l.heading); mesh.setMatrixAt(i, m.compose(toThree(l.x, l.y, 0), q, one)); });
      mesh.castShadow = shadow;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      group.add(mesh);
    };
    emit(d.pole, metal, true);
    emit(d.head, headMat, true);
    emit(d.lens, lensMat, false);
  }
  // pools of light on the ground under each head
  const poolGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const pools = new THREE.InstancedMesh(poolGeo, poolMat, lamps.length);
  lamps.forEach((l, i) => {
    const r = l.tall ? 22 : 17;
    pools.setMatrixAt(i, m.compose(toThree(l.lx, l.ly, 0.035), q.identity(), new THREE.Vector3(r, 1, r)));
  });
  pools.renderOrder = LAYER.pool;
  pools.computeBoundingSphere();
  group.add(pools);
  return { lamps, lights: new NearLights(group, lamps) };
}

// A handful of real point lights, moved to the lamps nearest the camera.
class NearLights {
  constructor(group, lamps) {
    this.lamps = lamps;
    this.lights = [];
    for (let i = 0; i < REAL_LIGHTS; i++) {
      const l = new THREE.PointLight(LAMP_COLOR, 0, 24, 1.8);
      group.add(l);
      this.lights.push(l);
    }
    this.next = 0;
    this.dir = new THREE.Vector3();
  }

  update(camera, dt) {
    const k = lighting.night.value;
    this.next -= dt;
    if (this.next <= 0 && k > 0.01) {
      this.next = 0.25;
      const cx = camera.position.x, cy = -camera.position.z;
      const dir = camera.getWorldDirection(this.dir);
      const fx = dir.x, fy = -dir.z;
      const ranked = this.lamps
        .map((l) => ({ l, d: Math.hypot(l.lx - cx, l.ly - cy) - 0.3 * Math.max(0, (l.lx - cx) * fx + (l.ly - cy) * fy) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, this.lights.length);
      ranked.forEach(({ l }, i) => this.lights[i].position.copy(toThree(l.lx, l.ly, l.h - 0.3)));
    }
    for (const l of this.lights) l.intensity = k * 28;
  }
}
