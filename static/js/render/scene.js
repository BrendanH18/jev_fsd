// Renderer, scene, lights, ground, and the two cameras. Sim coordinates (x east, y north, z up)
// map to Three.js as (x, z, -y).

import * as THREE from "three";

export const toThree = (x, y, z = 0) => new THREE.Vector3(x, z, -y);

export class SceneView {
  constructor(canvas, extent) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x9fc4e8);
    this.scene.fog = new THREE.Fog(0x9fc4e8, 250, 900);
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.5, 2000);
    this.mode = "chase";
    this.camPos = new THREE.Vector3();
    this.camLook = new THREE.Vector3();

    const hemi = new THREE.HemisphereLight(0xdfe9f5, 0x5c6b4e, 1.1);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(200, 400, 150);
    this.scene.add(sun);

    const [x0, y0, x1, y1] = extent;
    const w = (x1 - x0) + 800, hgt = (y1 - y0) + 800;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(w, hgt), new THREE.MeshLambertMaterial({ color: 0x6f8a5b }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set((x0 + x1) / 2, -0.05, -(y0 + y1) / 2);
    this.scene.add(ground);

    window.addEventListener("resize", () => this.resize());
    this.resize();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  toggleCamera() {
    const modes = ["chase", "top", "far"];
    this.mode = modes[(modes.indexOf(this.mode) + 1) % modes.length];
    return this.mode;
  }

  updateCamera(ego, dt) {
    const fx = Math.cos(ego.psi), fy = Math.sin(ego.psi);
    let target, look, up = new THREE.Vector3(0, 1, 0), lerp = 1 - Math.pow(0.001, dt);
    if (this.mode === "top") {
      target = toThree(ego.x, ego.y, 130);
      look = toThree(ego.x, ego.y, 0);
      up = new THREE.Vector3(0, 0, -1);
      lerp = 1 - Math.pow(0.02, dt);
    } else if (this.mode === "far") {
      target = toThree(ego.x - fx * 26, ego.y - fy * 26, 14);
      look = toThree(ego.x + fx * 10, ego.y + fy * 10, 0.5);
    } else {
      target = toThree(ego.x - fx * 9, ego.y - fy * 9, 4);
      look = toThree(ego.x + fx * 7, ego.y + fy * 7, 0.8);
    }
    if (this.camPos.lengthSq() === 0) { this.camPos.copy(target); this.camLook.copy(look); }
    this.camPos.lerp(target, lerp);
    this.camLook.lerp(look, lerp);
    this.camera.position.copy(this.camPos);
    this.camera.up.copy(up);
    this.camera.lookAt(this.camLook);
  }

  render() { this.renderer.render(this.scene, this.camera); }
}
