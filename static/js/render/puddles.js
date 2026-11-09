// Puddles at the kerb (sim/puddles.js), drawn as standing water on the asphalt in the gutter: a smooth, pale,
// irregular sheet that mirrors the sky and the street as the wet road does, but much more sharply. And
// the water they throw: a spray of droplets from the wheels of any vehicle (the car or traffic) going
// through one faster than its splash speed, and anyone standing within reach of it flinching away from
// the kerb. All render-only: the sim's audit counts the car's splashes on its own.
//
// The water is coplanar ground (render/scene.js LAYER): just above the pothole holes, below the
// markings, nothing below y = 0. The droplets are one instanced mesh, depth-tested, above the ground.

import * as THREE from "three";
import { rng } from "../common.js";
import { LAYER, groundLayer } from "./scene.js";
import { wetReflective } from "./reflection.js";
import { puddlesLie, splashRisk, wheelsInWater } from "../sim/puddles.js";
import { wheelPoints } from "../sim/potholes.js";

const POINTS = 20;
// Droplets: at most this many at once; each lives this long, under gravity.
const CAPACITY = 360, LIFE_S = 0.9, GRAVITY = 9.8;
// A splashed person flinches for this long (leaning away from the kerb and stepping back).
const FLINCH_S = 1.2;
const DRAW_WITHIN_M = 140;

// A smooth irregular outline round a puddle: unit radii at POINTS angles, from its shape seed.
function outline(seed) {
  const random = rng(seed), waves = [2, 3, 4].map((k) => ({ k, a: (random() - 0.5) * 0.24 / k, p: random() * Math.PI * 2 }));
  return Array.from({ length: POINTS }, (_, i) => 1 + waves.reduce((sum, w) => sum + w.a * Math.cos(w.k * (i / POINTS) * Math.PI * 2 + w.p), 0));
}

// The puddles of `world`: one mesh, shown while they lie (sim/puddles.js puddlesLie).
export function buildPuddles(world) {
  const group = new THREE.Group();
  group.name = "puddles";
  const P = [], U = [], I = [];
  for (const h of world.puddles?.list || []) {
    const radii = outline(h.shape), base = P.length / 3, c = Math.cos(h.heading), s = Math.sin(h.heading);
    P.push(h.x, 0, -h.y); U.push(h.x / 4, h.y / 4);
    for (let i = 0; i < POINTS; i++) {
      const t = (i / POINTS) * Math.PI * 2;
      // (a squarer ellipse: long puddles along the gutter keep their width to near their ends)
      const ct = Math.cos(t), st = Math.sin(t), u = Math.sign(ct) * Math.abs(ct) ** 0.7 * h.a * radii[i], v = Math.sign(st) * Math.abs(st) ** 0.7 * h.b * radii[i];
      const x = h.x + c * u + s * v, y = h.y + s * u - c * v;
      P.push(x, 0, -y); U.push(x / 4, y / 4);
    }
    for (let i = 0; i < POINTS; i++) I.push(base, base + 1 + ((i + 1) % POINTS), base + 1 + i);
  }
  if (I.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(U, 2));
    g.setIndex(I);
    g.computeVertexNormals();
    group.add(groundLayer(new THREE.Mesh(g, wetReflective(new THREE.MeshStandardMaterial({ color: 0x8f9ba6, roughness: 0.02, metalness: 0.25, envMapIntensity: 2.4, side: THREE.DoubleSide }), 2.2)), LAYER.patch + 0.7));
  }
  group.visible = puddlesLie(world);
  return group;
}

// The spray and the flinching, every frame: `vehicles`, everything that drives through water (the car
// and traffic); `people`, the person meshes by id (after syncPerson has placed them).
export class PuddleView {
  constructor(scene, group) {
    this.group = group;
    this.mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.035, 5, 4), new THREE.MeshStandardMaterial({ color: 0xc9d4dc, roughness: 0.2, metalness: 0, transparent: true, opacity: 0.75 }), CAPACITY);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    scene.add(this.mesh);
    this.drops = [];
    this.flinch = new Map();
    this.random = rng(59042);
    this.m = new THREE.Matrix4();
    this.lastT = null;
  }

  update(world, vehicles, people, camera, dt) {
    const lie = puddlesLie(world);
    if (this.group) this.group.visible = lie;
    // (paused, or a frame replayed: nothing new is thrown)
    const fresh = this.lastT !== null && world.t > this.lastT;
    this.lastT = world.t;
    if (lie && fresh) {
      for (const v of vehicles) {
        if (!v || v.kind === "bike" || Math.abs(v.v) < 2) continue;
        if (Math.abs(v.x - camera.position.x) > DRAW_WITHIN_M || Math.abs(-v.y - camera.position.z) > DRAW_WITHIN_M) continue;
        for (const { h, over } of wheelsInWater(world, v)) {
          if (over <= 0) continue;
          this.spray(v, h, over, dt);
          for (const p of splashRisk(world, h)) if (!this.flinch.has(p.id)) this.flinch.set(p.id, { t: 0, psi: h.heading });
        }
      }
    }
    // (the droplets fly out, fall and are gone)
    let n = 0;
    for (const d of this.drops) {
      d.age += dt; d.vz -= GRAVITY * dt;
      d.x += d.vx * dt; d.y += d.vy * dt; d.z = Math.max(0.01, d.z + d.vz * dt);
      if (d.age >= LIFE_S || n >= CAPACITY) continue;
      const k = 1 - d.age / LIFE_S;
      this.m.makeScale(k + 0.3, k + 0.3, k + 0.3).setPosition(d.x, d.z, -d.y);
      this.mesh.setMatrixAt(n++, this.m);
    }
    this.drops = this.drops.filter((d) => d.age < LIFE_S);
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    // (a splashed person leans away from the road, arms up, and steps back toward the buildings)
    for (const [id, f] of this.flinch) {
      f.t += dt;
      const mesh = people.get(id);
      if (f.t > FLINCH_S || !mesh) { if (f.t > FLINCH_S) { this.flinch.delete(id); if (mesh) mesh.rotation.z = 0; } continue; }
      const k = Math.sin(Math.PI * Math.min(1, f.t / FLINCH_S));
      // (away from the kerb: right of the street's heading)
      mesh.position.x += Math.sin(f.psi) * 0.3 * k; mesh.position.z += Math.cos(f.psi) * 0.3 * k;
      mesh.rotation.y = f.psi - Math.PI / 2;
      mesh.rotation.z = -0.35 * k;
      for (const arm of mesh.userData.arms || []) { arm.shoulder.rotation.z = 2.2 * k; arm.elbow.rotation.z = 1.2 * k; }
    }
  }

  // Droplets thrown out to the kerb side from the tyres in puddle `h`, more the faster over the splash
  // speed the vehicle is going.
  spray(v, h, over, dt) {
    const wheels = wheelPoints(v), c = Math.cos(v.psi), s = Math.sin(v.psi), sp = Math.abs(v.v);
    const count = Math.min(14, Math.round((6 + 30 * over) * dt * 10));
    for (const [x, y] of [wheels[1], wheels[3]]) {
      for (let i = 0; i < count && this.drops.length < CAPACITY; i++) {
        const out = 1.5 + this.random() * (2 + over * 1.5), up = 1.2 + this.random() * (1.5 + over), fwd = sp * (0.2 + this.random() * 0.4);
        // (right of the vehicle, toward the kerb: (sin psi, -cos psi))
        this.drops.push({ x: x + (this.random() - 0.5) * 0.3, y: y + (this.random() - 0.5) * 0.3, z: 0.05, vx: c * fwd + s * out, vy: s * fwd - c * out, vz: up, age: this.random() * 0.1 });
      }
    }
  }
}
