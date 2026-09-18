// A box-and-wheels car mesh. Local +X is forward; the rear axle sits at the group origin.

import * as THREE from "three";
import { CAR } from "../sim/vehicle.js";

const wheelGeo = new THREE.CylinderGeometry(0.33, 0.33, 0.22, 14);
wheelGeo.rotateX(Math.PI / 2);
const wheelMat = new THREE.MeshLambertMaterial({ color: 0x1a1a1a });

export function createCarMesh(color = 0x2f7cff) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(CAR.length, 0.7, CAR.width), new THREE.MeshLambertMaterial({ color }));
  body.position.set(CAR.length / 2 - CAR.rearOverhang, 0.65, 0);
  g.add(body);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(CAR.length * 0.5, 0.55, CAR.width * 0.86),
    new THREE.MeshLambertMaterial({ color: 0x1b2430 }));
  cabin.position.set(CAR.length / 2 - CAR.rearOverhang - 0.3, 1.25, 0);
  g.add(cabin);
  const wheels = [];
  for (const [lx, lz] of [[CAR.wheelbase, CAR.width / 2 - 0.05], [CAR.wheelbase, -CAR.width / 2 + 0.05], [0, CAR.width / 2 - 0.05], [0, -CAR.width / 2 + 0.05]]) {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.position.set(lx, 0.33, lz);
    g.add(w);
    wheels.push(w);
  }
  g.userData.wheels = wheels;
  g.userData.spin = 0;
  return g;
}

export function syncCar(mesh, vehicle, dt = 0) {
  mesh.position.set(vehicle.x, 0, -vehicle.y);
  mesh.rotation.y = vehicle.psi;
  mesh.userData.spin += vehicle.v * dt / 0.33;
  const wheels = mesh.userData.wheels;
  for (let i = 0; i < wheels.length; i++) {
    wheels[i].rotation.z = -mesh.userData.spin;
    if (i < 2) wheels[i].rotation.y = vehicle.delta;
  }
}
