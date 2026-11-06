// Low sun glare, drawn (render only; nothing in the sim reads it): looking towards a low sun in clear
// weather, a bright flare over the sky's sun disc, a few faint lens ghosts across the view, and a warm
// haze over the whole view. Built only where the world has sun glare on (sim/sun-glare.js).
import * as THREE from "three";

const FLARE_M = 1500;     // how far out along the sun's direction the flare sprites sit
// (the haze veil sits out there too, along the view, scaled to cover it)
const GHOSTS = [[0.35, 70, 0.18, 0xffc98a], [0.62, 40, 0.14, 0x9fd0ff], [1.25, 110, 0.10, 0xffb070], [1.6, 55, 0.08, 0xbfe2ff]];

function radialTexture(stops) {
  const size = 128, c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d"), grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [at, color] of stops) grad.addColorStop(at, color);
  g.fillStyle = grad; g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function sprite(texture, color, order) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, color, transparent: true, opacity: 0, depthTest: false, depthWrite: false,
    blending: THREE.AdditiveBlending, fog: false, toneMapped: false }));
  s.renderOrder = order; s.frustumCulled = false; s.visible = false;
  return s;
}

export class SunGlareView {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.name = "sun-glare";
    const glow = radialTexture([[0, "rgba(255,255,255,1)"], [0.12, "rgba(255,240,210,0.85)"], [0.35, "rgba(255,190,120,0.25)"], [1, "rgba(255,160,90,0)"]]);
    const ring = radialTexture([[0, "rgba(255,255,255,0)"], [0.7, "rgba(255,255,255,0.05)"], [0.85, "rgba(255,255,255,0.5)"], [1, "rgba(255,255,255,0)"]]);
    this.flare = sprite(glow, 0xfff1d8, 9990);
    this.halo = sprite(glow, 0xffb878, 9989);
    this.ghosts = GHOSTS.map(([at, size, alpha, color]) => Object.assign(sprite(ring, color, 9991), { userData: { at, size, alpha } }));
    // (a plain warm tint, normally blended: a textured, additive veil over the whole view shows
    // blotches in WebKit)
    this.haze = sprite(null, 0xffc890, 9992);
    this.haze.material.blending = THREE.NormalBlending;
    this.group.add(this.halo, this.flare, ...this.ghosts, this.haze);
    scene.add(this.group);
    this.strength = 0;
    this._sun = new THREE.Vector3(); this._fwd = new THREE.Vector3(); this._p = new THREE.Vector3(); this._ndc = new THREE.Vector3();
  }

  // `a`: the atmosphere (render/atmosphere.js); `glare`: the driven car's glare severity (0 when
  // none), which keeps the haze up while the sun dazzles the driver even in a chase view.
  update(camera, a, glare = 0) {
    const el = a?.elevationDeg ?? -90;
    const low = el > -0.5 && el < 22 ? Math.min(1, (el + 0.5) / 2) * Math.min(1, (22 - el) / 8) : 0;
    const clear = 1 - (a?.cloud ?? 1);
    camera.getWorldDirection(this._fwd);
    this._sun.copy(a?.sun?.dir || this._fwd);
    const facing = Math.max(0, this._fwd.dot(this._sun));
    const target = low * clear * Math.max(Math.pow(facing, 6), glare * 0.6);
    // ease, so a glance does not flash
    this.strength += (target - this.strength) * 0.15;
    const k = this.strength, on = k > 0.01;
    for (const s of [this.flare, this.halo, this.haze, ...this.ghosts]) s.visible = on;
    if (!on) return;
    const sunAt = this._p.copy(this._sun).multiplyScalar(FLARE_M).add(camera.position);
    this.flare.position.copy(sunAt); this.flare.scale.setScalar(FLARE_M * 0.16); this.flare.material.opacity = Math.min(1, 1.2 * k);
    this.halo.position.copy(sunAt); this.halo.scale.setScalar(FLARE_M * 0.75); this.halo.material.opacity = 0.55 * k;
    // ghosts lie on the line from the sun through the middle of the view, as in a camera lens
    this._ndc.copy(sunAt).project(camera);
    const inView = this._ndc.z < 1 && Math.abs(this._ndc.x) < 1.3 && Math.abs(this._ndc.y) < 1.3;
    for (const g of this.ghosts) {
      g.visible = inView;
      if (!inView) continue;
      const { at, size, alpha } = g.userData;
      g.position.set(this._ndc.x * (1 - 2 * at), this._ndc.y * (1 - 2 * at), 0.5).unproject(camera).sub(camera.position).normalize().multiplyScalar(FLARE_M).add(camera.position);
      g.scale.setScalar(size * FLARE_M / 400); g.material.opacity = alpha * k;
    }
    // the warm veil over the whole view
    const cover = 2 * FLARE_M * Math.tan(camera.fov * Math.PI / 360) * Math.max(1, camera.aspect) * 1.6;
    this.haze.position.copy(this._fwd).multiplyScalar(FLARE_M).add(camera.position);
    this.haze.scale.setScalar(cover); this.haze.material.opacity = 0.22 * k;
  }

  dispose(scene) {
    scene.remove(this.group);
    this.group.traverse(o => { o.material?.map?.dispose(); o.material?.dispose(); });
  }
}
