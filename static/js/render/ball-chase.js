// A ball rolling into the street (sim/ball-chase.js): a bright playground ball, panelled in its colour
// and white so its spin shows as it rolls, resting on the asphalt (its centre BALL_R up, never below
// y = 0, and depth-tested, so cars hide it), squashed flat once a tyre has run over it (`burst`), and
// held in front of the child who fetched it. The child is one of the crowd, drawn as any child
// (render/people.js). Render-only: nothing in the sim reads any of this.

import * as THREE from "three";
import { BALL_R } from "../sim/ball-chase.js";

const DRAW_WITHIN_M = 130;
const CARRY_Y = 0.55,
  CARRY_AHEAD = 0.24;

// The ball's mesh: its octants alternate between `color` and white.
function createBallMesh(color) {
  const geo = new THREE.SphereGeometry(BALL_R, 20, 14).toNonIndexed();
  const pos = geo.attributes.position,
    n = pos.count,
    col = new Float32Array(n * 3);
  const a = new THREE.Color(color),
    w = new THREE.Color(0xf6f4ee);
  for (let f = 0; f < n; f += 3) {
    // (by the face's centre, so each panel is one colour)
    let x = 0,
      y = 0,
      z = 0;
    for (let k = 0; k < 3; k++) {
      x += pos.getX(f + k);
      y += pos.getY(f + k);
      z += pos.getZ(f + k);
    }
    const c = x * y * z > 0 ? a : w;
    for (let k = 0; k < 3; k++) {
      col[(f + k) * 3] = c.r;
      col[(f + k) * 3 + 1] = c.g;
      col[(f + k) * 3 + 2] = c.b;
    }
  }
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0 }),
  );
  mesh.castShadow = true;
  mesh.name = "ball";
  return mesh;
}

export class BallView {
  constructor(scene) {
    this.scene = scene;
    this.meshes = new Map();
    this.axis = new THREE.Vector3();
  }

  // Follow the simulation: each ball out of its gap, rolling (turned through the angle it has rolled
  // since last time, about the axis across its way), at rest, squashed, or carried.
  update(world, camera) {
    const balls = world.balls?.enabled ? world.balls.balls : [];
    const here = new Set();
    for (const b of balls) {
      if (b.phase === "waiting" || b.phase === "gone") continue;
      here.add(b.id);
      let m = this.meshes.get(b.id);
      if (!m) {
        m = createBallMesh(b.color);
        m.userData.spin = 0;
        this.scene.add(m);
        this.meshes.set(b.id, m);
      }
      if (b.phase === "carried" && b.child) {
        const c = b.child;
        m.position.set(c.x + Math.cos(c.psi) * CARRY_AHEAD, CARRY_Y, -(c.y + Math.sin(c.psi) * CARRY_AHEAD));
        m.scale.set(1, b.burst ? 0.35 : 1, 1);
      } else if (b.burst) {
        m.scale.set(1.25, 0.3, 1.25);
        m.rotation.set(0, 0, 0);
        m.position.set(b.x, BALL_R * 0.3, -b.y);
      } else {
        m.scale.setScalar(1);
        if (b.spin < m.userData.spin || m.userData.burst) {
          m.quaternion.identity();
          m.userData.spin = 0;
        }
        const turn = b.spin - m.userData.spin;
        // Rolling along (ax, ay) in the sim: turn around up × (ax, 0, -ay).
        if (turn > 1e-6) m.rotateOnWorldAxis(this.axis.set(-b.axis[1], 0, -b.axis[0]).normalize(), turn);
        m.position.set(b.x, BALL_R, -b.y);
      }
      m.userData.spin = b.spin;
      m.userData.burst = b.burst;
      m.visible = Math.hypot(m.position.x - camera.position.x, m.position.z - camera.position.z) < DRAW_WITHIN_M;
    }
    for (const [id, m] of this.meshes) {
      if (here.has(id)) continue;
      this.scene.remove(m);
      m.geometry.dispose();
      m.material.dispose();
      this.meshes.delete(id);
    }
  }
}

export const view = {
  mount: {
    order: 8,
    run({ scene, world }) {
      return world.balls?.enabled ? new BallView(scene) : null;
    },
    frame: (balls, { world, camera }) => balls.update(world, camera),
  },
  transientPeople: ["kid_ball_"],
};
