// A police officer directing traffic in the middle of a junction (sim/traffic-officer.js): a person in a
// hi-vis vest with reflective bands, a peaked cap and white gloves, turned to face the traffic they hold.
// Waving one axis through, one arm is held up palm out toward the held traffic (STOP) and the other, out
// to the side, beckons the waved traffic on; holding everyone, both arms are out, still. Their cruiser,
// lights flashing, is drawn here when it stands up on the kerb (render-only); one parked in a bay is a
// parked car, drawn with the others (main.js). Render-only throughout; depth-tested, above the ground.

import * as THREE from "three";
import { createPersonMesh, syncPerson } from "./people.js";
import { createRoadsideMesh, syncRoadside } from "./roadside.js";

const TURN_RAD_S = 2.5;    // how fast the officer turns to face the traffic held
const WAVE_S = 1.1;        // one beckoning wave
const cap = new THREE.MeshStandardMaterial({ color: 0x141b2d, roughness: 0.6 });
const glove = new THREE.MeshStandardMaterial({ color: 0xf4f4f0, roughness: 0.7 });
const band = new THREE.MeshStandardMaterial({ color: 0xd9dde3, roughness: 0.25, metalness: 0.4, emissive: 0x222222 });

// The officer: a worker in hi-vis (render/people.js), with a cap, two reflective bands and white gloves.
export function createOfficerMesh(officer) {
  const m = createPersonMesh(`${officer.id}:officer`, { worker: true });
  const u = m.userData, hip = u.body.position.y;
  const hat = new THREE.Group();
  hat.add(new THREE.Mesh(new THREE.CylinderGeometry(0.118, 0.11, 0.07, 14), cap));
  hat.add(new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.012, 0.17).translate(0.11, -0.03, 0), cap));
  hat.position.set(0.005, 1.84 - hip, 0);
  u.body.add(hat);
  for (const y of [1.12, 1.3]) u.body.add(new THREE.Mesh(new THREE.CylinderGeometry(0.192, 0.18, 0.035, 12).scale(0.64, 1, 1).translate(0, y - hip, 0), band));
  for (const { elbow } of u.arms) elbow.add(new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6).translate(0, -0.28, 0), glove));
  m.name = "traffic-officer";
  u.officer = { psi: officer.face, t: 0 };
  return m;
}

// Place the officer, turn them toward the traffic they hold, and pose their arms. Call each frame.
export function syncOfficer(mesh, officer, dt, camera) {
  const u = mesh.userData, o = u.officer;
  const d = Math.atan2(Math.sin(officer.face - o.psi), Math.cos(officer.face - o.psi));
  o.psi += Math.max(-TURN_RAD_S * dt, Math.min(TURN_RAD_S * dt, d));
  o.t += dt;
  syncPerson(mesh, { x: officer.x, y: officer.y, psi: o.psi, v: 0, phase: 0, frozen: 0 }, camera);
  if (!mesh.visible) return;
  const right = u.arms.find((a) => a.side > 0), left = u.arms.find((a) => a.side < 0);
  // (the right hand up, palm out, toward the traffic held: STOP)
  right.shoulder.rotation.set(0, 0, Math.PI / 2);
  right.elbow.rotation.set(0, 0, Math.PI / 2);
  // (the left arm out to the side: beckoning the waved traffic on, or still while everyone is held)
  left.shoulder.rotation.set(Math.PI / 2, 0, 0);
  left.elbow.rotation.set(0, 0, officer.phase === "clear" ? 0 : 0.25 + 1.1 * (0.5 + 0.5 * Math.sin(2 * Math.PI * o.t / WAVE_S)));
}

// Every officer standing now, and their cruisers up on the kerb: a mesh each, by id, made and dropped as
// they come and go (a restored checkpoint included).
export class OfficerView {
  constructor(scene) { this.scene = scene; this.officers = new Map(); this.cruisers = new Map(); }
  sync(world, dt, camera, lightsOn = 0) {
    const ids = new Set();
    for (const o of world.officers?.list || []) {
      ids.add(o.id);
      let m = this.officers.get(o.id);
      if (!m) { m = createOfficerMesh(o); this.scene.add(m); this.officers.set(o.id, m); }
      syncOfficer(m, o, dt, camera);
      const car = o.cruiser && !o.cruiser.parked ? o.cruiser.vehicle : null;
      if (!car) continue;
      ids.add(car.id);
      let c = this.cruisers.get(car.id);
      if (!c) { c = createRoadsideMesh(car); this.scene.add(c); this.cruisers.set(car.id, c); }
      syncRoadside(c, car, dt, world.t, lightsOn);
    }
    for (const map of [this.officers, this.cruisers]) for (const [id, m] of map) if (!ids.has(id)) { this.scene.remove(m); map.delete(id); }
  }
}
