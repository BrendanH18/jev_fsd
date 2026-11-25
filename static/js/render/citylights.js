// Street lights. Cobra heads on tall poles along the arterials (both sides, about every 38 m) and
// shorter LED davit poles along residential streets (alternating sides, about every 45 m), the way
// Vancouver lights its streets. After dark the heads glow (and bloom), each throws a pool of light
// on the road and sidewalk below it, and the few lamps nearest the camera are real lights, so cars,
// walls, and trees close by are lit by them too.

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { sceneryFor } from "../map/scenery.js";
import { LAYER } from "./scene.js";
import { lampPoolTexture } from "./textures.js";
import { glowsAtNight, lighting } from "./atmosphere.js";

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const LAMP_COLOR = 0xffe4bf; // 4000 K LED, a touch warm
const REAL_LIGHTS = 6;

// Pole, arm, and head of each design, in the lamp's frame: +x along the street, -z toward the road.
function design(tall) {
  const h = tall ? 8.4 : 7.0,
    reach = tall ? 2.3 : 1.5;
  const pole = mergeGeometries(
    [
      new THREE.CylinderGeometry(tall ? 0.08 : 0.07, tall ? 0.13 : 0.11, h, 8).translate(0, h / 2, 0),
      new THREE.CylinderGeometry(0.045, 0.05, reach + 0.2, 6)
        .rotateX(Math.PI / 2)
        .rotateX(-0.12)
        .translate(0, h + 0.05, -reach / 2),
      new THREE.CylinderGeometry(0.2, 0.22, 0.35, 8).translate(0, 0.17, 0), // base
    ].map((g) => g.toNonIndexed()),
    false,
  );
  const head = tall
    ? new THREE.SphereGeometry(0.4, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2)
        .scale(0.55, 0.32, 1)
        .translate(0, h + 0.02, -reach - 0.1)
    : new THREE.BoxGeometry(0.28, 0.1, 0.62).translate(0, h, -reach - 0.1);
  const lens = new THREE.CircleGeometry(0.2, 12)
    .rotateX(Math.PI / 2)
    .scale(tall ? 1.1 : 0.8, 1, tall ? 1.7 : 1.4)
    .translate(0, h - 0.07, -reach - 0.1);
  return { pole, head, lens };
}

export function buildStreetLights(map, group) {
  const lamps = sceneryFor(map).lamps;
  if (!lamps.length) return { lamps, lights: null };

  const luminous = new THREE.Group();
  group.add(luminous);
  const metal = new THREE.MeshStandardMaterial({ color: 0x5b6066, roughness: 0.5, metalness: 0.6 });
  const headMat = new THREE.MeshStandardMaterial({ color: 0x3c4046, roughness: 0.45, metalness: 0.5 });
  const lensMat = glowsAtNight(
    new THREE.MeshStandardMaterial({ color: 0xd9dde2, emissive: LAMP_COLOR, roughness: 0.25 }),
    0.0,
    5,
  );
  const poolMat = glowsAtNight(
    new THREE.MeshBasicMaterial({
      map: lampPoolTexture(),
      color: LAMP_COLOR,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
    0,
    0.26,
    "opacity",
  );
  const q = new THREE.Quaternion(),
    position = new THREE.Vector3(),
    scale = new THREE.Vector3(1, 1, 1),
    m = new THREE.Matrix4();
  for (const tall of [true, false]) {
    const list = lamps.filter((l) => l.tall === tall);
    if (!list.length) continue;
    const d = design(tall);
    const emit = (geo, mat, shadow) => {
      const mesh = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((l, i) => {
        q.setFromAxisAngle(Y_AXIS, l.heading);
        mesh.setMatrixAt(i, m.compose(position.set(l.x, 0, -l.y), q, scale));
      });
      mesh.castShadow = shadow;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      (mat === lensMat ? luminous : group).add(mesh);
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
    pools.setMatrixAt(i, m.compose(position.set(l.lx, 0.035, -l.ly), q.identity(), scale.set(r, 1, r)));
  });
  pools.renderOrder = LAYER.pool;
  pools.computeBoundingSphere();
  luminous.add(pools);
  pools.matrixAutoUpdate = false;
  const lights = new NearLights(luminous, lamps, pools);
  return {
    lamps,
    lights,
    setOutage: (out) => {
      luminous.visible = !out;
      if (out) lights.next = 0;
    },
  };
}

// A handful of real point lights, moved to the lamps nearest the camera.
class NearLights {
  constructor(group, lamps, pools) {
    this.lamps = lamps;
    this.group = group;
    this.pools = pools;
    this.pools.visible = lighting.night.value > 0;
    this.lights = [];
    for (let i = 0; i < Math.min(REAL_LIGHTS, lamps.length); i++) {
      const l = new THREE.PointLight(LAMP_COLOR, 0, 24, 1.8);
      group.add(l);
      this.lights.push(l);
    }
    this.next = 0;
    this.dir = new THREE.Vector3();
    this.lastDir = new THREE.Vector3();
    this.position = new THREE.Vector3();
    this.lastPosition = new THREE.Vector3(Infinity, Infinity, Infinity);
    this.distances = new Float64Array(this.lights.length);
    this.nearest = new Array(this.lights.length);
  }

  update(camera, dt) {
    if (!this.group.visible) return;
    const k = lighting.night.value;
    this.pools.visible = k > 0;
    if (k <= 0.01) {
      this.next = 0;
      for (const l of this.lights) l.intensity = 0;
      return;
    }
    if (Number.isFinite(dt) && dt > 0) this.next -= dt;
    const center = camera.getWorldPosition(this.position);
    const dir = camera.getWorldDirection(this.dir);
    // Reselect immediately when changing views or jumping in a replay.
    if (this.next <= 0 || center.distanceToSquared(this.lastPosition) > 24 ** 2 || dir.dot(this.lastDir) < 0.85) {
      this.next = 0.25;
      this.lastPosition.copy(center);
      this.lastDir.copy(dir);
      this.distances.fill(Infinity);
      for (const lamp of this.lamps) {
        const dx = lamp.lx - center.x,
          dy = lamp.ly + center.z;
        const score = Math.hypot(dx, dy) - 0.3 * Math.max(0, dx * dir.x - dy * dir.z);
        let i = this.lights.length - 1;
        if (score >= this.distances[i]) continue;
        while (i > 0 && score < this.distances[i - 1]) {
          this.distances[i] = this.distances[i - 1];
          this.nearest[i] = this.nearest[i - 1];
          i--;
        }
        this.distances[i] = score;
        this.nearest[i] = lamp;
      }
      this.nearest.forEach((l, i) => this.lights[i].position.set(l.lx, l.h - 0.3, -l.ly));
    }
    for (const l of this.lights) l.intensity = k * 28;
  }
}
