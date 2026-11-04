// A school crossing guard's hand-held STOP sign (sim/crossing-guard.js): a round red sign with a white
// border and STOP on both faces, on a pole in the guard's right hand. The guard is a person in a hi-vis
// vest (render/people.js `worker`); the sign goes on that person's mesh, held up high, the arm raised,
// while it is up, and carried low at the guard's side while it is down.

import * as THREE from "three";
import { postMaterial, texture } from "./work-zone.js";

const POLE_M = 1.55;
const DISC_R = 0.23;

const face = () => texture("guard-stop", (ctx, n) => {
  ctx.beginPath(); ctx.arc(n / 2, n / 2, n / 2 - 2, 0, Math.PI * 2); ctx.fillStyle = "#ffffff"; ctx.fill();
  ctx.beginPath(); ctx.arc(n / 2, n / 2, n / 2 - 14, 0, Math.PI * 2); ctx.fillStyle = "#c8102e"; ctx.fill();
  ctx.fillStyle = "#ffffff"; ctx.font = `bold ${n * 0.27}px sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("STOP", n / 2, n / 2 + 4);
});

// Put the sign in a person mesh's right hand (local +X is forward, +Z the right side). Returns the mesh.
export function addGuardSign(mesh) {
  const sign = new THREE.Group();
  sign.name = "crossing-guard-sign";
  sign.add(new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, POLE_M, 6).translate(0, POLE_M / 2, 0), postMaterial));
  const material = new THREE.MeshStandardMaterial({ map: face(), transparent: true, alphaTest: 0.5, roughness: 0.5 });
  for (const side of [1, -1]) {
    const disc = new THREE.Mesh(new THREE.CircleGeometry(DISC_R, 24), material);
    disc.rotation.y = side * Math.PI / 2;
    disc.position.set(side * 0.012, POLE_M + DISC_R * 0.8, 0);
    sign.add(disc);
  }
  sign.position.set(0.18, 0, 0.3);
  mesh.add(sign);
  mesh.userData.guardSign = sign;
  mesh.userData.guardArm = mesh.userData.arms?.find((a) => a.side > 0) || null;
  return mesh;
}

// Raise or lower the sign as the guard holds it (`ped.paddle` "up" or "down"). Call after syncPerson.
export function syncGuardSign(mesh, ped) {
  const sign = mesh?.userData.guardSign;
  if (!sign) return;
  const up = ped.paddle === "up";
  sign.position.y = up ? 0.5 : 0.05;
  sign.rotation.z = up ? 0 : -0.25;   // (carried low, tipped forward)
  const arm = mesh.userData.guardArm;
  if (arm && up) { arm.shoulder.rotation.z = 0.5; arm.shoulder.rotation.x = -0.2; arm.elbow.rotation.z = 1.1; }
}
