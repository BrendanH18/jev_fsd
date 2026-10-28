// School buses (sim/school-bus.js): a Type C bus built from boxes at its simulated size, in school
// bus yellow with black rub rails and bumpers, a short hood over the engine, a band of windows, the
// entrance door on the curb side behind the front wheel, "SCHOOL BUS" signs front and rear, and the
// eight-lamp warning system: an amber and a red lamp at each top corner, front and rear, flashing
// left and right in turn (the ambers as it slows to stop, the reds while it stands), and a red STOP
// arm that swings out from the driver's side while the reds flash. Indicators, brake lamps and
// headlamps as on the city bus. Local +X is forward, +Z is right, rear axle at the origin.

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { SCHOOL_BUS } from "../sim/vehicle.js";
import { blobTexture } from "./textures.js";
import { snowable } from "./weather.js";
import { wheel } from "./bus.js";

const FLASH_S = 1.1;   // one cycle: left lamps, then right
const box = (sx, sy, sz, x, y, z) => new THREE.BoxGeometry(sx, sy, sz).translate(x, y, z);
const merge = (parts) => mergeGeometries(parts.map((p) => p.toNonIndexed()), false);
const shared = {
  yellow: snowable(new THREE.MeshPhysicalMaterial({ color: 0xf2a900, metalness: 0.1, roughness: 0.42, clearcoat: 0.5 }), "car"),
  black: new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.6 }),
  glass: new THREE.MeshPhysicalMaterial({ color: 0x111820, metalness: 0.2, roughness: 0.08, clearcoat: 1, envMapIntensity: 1.6 }),
  door: new THREE.MeshPhysicalMaterial({ color: 0x18222c, metalness: 0.2, roughness: 0.1, clearcoat: 1 }),
  inside: new THREE.MeshStandardMaterial({ color: 0x2c2f33, roughness: 0.9 }),
  head: new THREE.MeshStandardMaterial({ color: 0xdfe6ee, emissive: 0xfff1dc, emissiveIntensity: 0.6, roughness: 0.1, metalness: 0.4 }),
  blink: new THREE.MeshBasicMaterial({ color: 0xffa21a }),
  blob: new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, color: 0x000000, opacity: 0.65 }),
};
let signMaterial = null, stopMaterial = null;

// "SCHOOL BUS" in black on yellow.
function sign() {
  if (signMaterial) return signMaterial;
  const c = document.createElement("canvas");
  c.width = 256; c.height = 64;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#f2b400"; ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = "#111111"; ctx.font = "bold 40px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText("SCHOOL BUS", c.width / 2, c.height / 2 + 2, c.width - 16);
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  return (signMaterial = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.5 }));
}

// The stop arm's sign: a red octagon with a white border and STOP.
function stopSign() {
  if (stopMaterial) return stopMaterial;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = "#c8102e";
  ctx.beginPath();
  for (let i = 0; i < 8; i++) { const a = Math.PI / 8 + i * Math.PI / 4; ctx.lineTo(64 + Math.cos(a) * 56, 64 + Math.sin(a) * 56); }
  ctx.fill();
  ctx.fillStyle = "#ffffff"; ctx.font = "bold 34px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText("STOP", 64, 66);
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  return (stopMaterial = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.5, side: THREE.DoubleSide, emissive: 0x000000 }));
}

const lamp = (color) => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0, roughness: 0.3 });

export function createSchoolBusMesh(id = "school_bus") {
  const spec = SCHOOL_BUS, xr = -spec.rearOverhang, xf = spec.length - spec.rearOverhang, w = spec.width, h = 3.0, floor = 0.45;
  const xh = xf - 1.5;   // where the hood meets the body
  const g = new THREE.Group();
  g.name = `school-bus-${id}`;
  const body = new THREE.Group();
  g.add(body);
  const add = (geometry, material, shadow, name) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name; mesh.castShadow = shadow; mesh.receiveShadow = true;
    body.add(mesh);
    return mesh;
  };
  const len = xh - xr, mid = (xr + xh) / 2;
  add(merge([
    box(len, h - floor, w, mid, floor + (h - floor) / 2, 0),
    box(len - 0.4, 0.12, w - 0.3, mid, h + 0.06, 0),
    box(xf - xh, 1.35 - floor, w - 0.5, (xh + xf) / 2, floor + (1.35 - floor) / 2, 0),   // the hood
  ]), shared.yellow, true, "bodywork");
  // black rub rails along both sides, and the bumpers
  add(merge([0.75, 1.15, 1.55].map((y) => box(len + 0.02, 0.07, w + 0.03, mid, y, 0))), shared.black, false, "rub-rails");
  add(merge([box(0.25, 0.3, w + 0.08, xf + 0.08, 0.55, 0), box(0.22, 0.32, w + 0.06, xr - 0.08, 0.5, 0)]), shared.black, false, "bumpers");
  add(box(0.04, 0.5, w - 0.7, xf + 0.005, 0.95, 0), shared.black, false, "grille");
  // side windows, the windscreen and the rear window (over the emergency door)
  add(merge([
    box(len - 1.2, 0.8, w + 0.02, mid - 0.3, 2.2, 0),
    box(0.06, 1.05, w - 0.2, xh + 0.005, 2.1, 0),
    box(0.06, 0.75, w - 1.0, xr - 0.005, 2.15, 0),
  ]), shared.glass, false, "windows");
  add(merge([box(0.06, 0.16, 0.3, xf + 0.03, 1.0, -(w / 2 - 0.45)), box(0.06, 0.16, 0.3, xf + 0.03, 1.0, w / 2 - 0.45)]), shared.head, false, "headlamps");
  for (const x of [xh + 0.02, xr - 0.02]) add(box(0.03, 0.26, 1.0, x, h - 0.2, 0), sign(), false, "sign").castShadow = false;
  // the entrance door, curb side (+Z), just behind the front wheel
  const doorX = xh - 0.6;
  add(box(0.95, 2.2, 0.02, doorX, floor + 1.1, w / 2 + 0.002), shared.inside, false, "doorway");
  const door = add(box(0.95, 2.2, 0.04, doorX, floor + 1.1, w / 2 + 0.015), shared.door, false, "door");
  // warning lamps: amber inboard, red outboard, at each top corner front and rear
  const lamps = { amber: { left: lamp(0xffa000), right: lamp(0xffa000) }, red: { left: lamp(0xe0101a), right: lamp(0xe0101a) } };
  for (const x of [xh + 0.03, xr - 0.03]) {
    for (const [side, z] of [["left", -1], ["right", 1]]) {
      add(new THREE.CylinderGeometry(0.11, 0.11, 0.05, 14).rotateZ(Math.PI / 2).translate(x, h - 0.2, z * 0.68), lamps.amber[side], false, "amber-lamp");
      add(new THREE.CylinderGeometry(0.11, 0.11, 0.05, 14).rotateZ(Math.PI / 2).translate(x, h - 0.2, z * 0.98), lamps.red[side], false, "red-lamp");
    }
  }
  // the stop arm, hinged on the driver's side (-Z) behind the driver's window: folded flat against
  // the body, it swings out square to it
  const arm = new THREE.Group();
  arm.position.set(xh - 1.7, 1.75, -(w / 2 + 0.03));
  const plate = new THREE.Mesh(new THREE.CircleGeometry(0.24, 8).rotateZ(Math.PI / 8).translate(-0.3, 0, 0), stopSign());
  plate.name = "stop-arm";
  arm.add(plate);
  body.add(arm);
  // indicators front and rear at each corner, red brake and tail lamps at the rear
  const brake = new THREE.MeshStandardMaterial({ color: 0x6a0b0b, emissive: 0xff1a1a, emissiveIntensity: 0.3, roughness: 0.3 });
  add(merge([box(0.05, 0.25, 0.22, xr - 0.03, 1.0, -(w / 2 - 0.25)), box(0.05, 0.25, 0.22, xr - 0.03, 1.0, w / 2 - 0.25)]), brake, false, "brake-lamps");
  const blinkers = { left: [], right: [] };
  for (const [side, z] of [["left", -(w / 2 - 0.12)], ["right", w / 2 - 0.12]]) {
    for (const x of [xf + 0.04, xr - 0.035]) {
      const m = new THREE.Mesh(box(0.04, 0.14, 0.16, x, x > 0 ? 1.2 : 1.35, x > 0 ? z * 0.82 : z), shared.blink);
      m.visible = false;
      body.add(m);
      blinkers[side].push(m);
    }
  }
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(spec.length + 0.6, w + 0.6).rotateX(-Math.PI / 2), shared.blob);
  blob.position.set((xr + xf) / 2, 0.02, 0);
  blob.renderOrder = 1;
  g.add(blob);
  const wheels = [], tire = 0.5, track = spec.track / 2;
  for (const [x, z, steer] of [[spec.wheelbase, -track, true], [spec.wheelbase, track, true], [0, -track, false], [0, track, false]]) {
    const pivot = new THREE.Group();
    pivot.position.set(x, tire, z);
    const wl = wheel(tire, steer ? 0.3 : 0.55);
    pivot.add(wl);
    g.add(pivot);
    wheels.push({ pivot, wheel: wl, steer });
  }
  g.userData = { schoolBus: true, wheels, tire, spin: 0, door, lamps, arm, swing: 0, blinkers, brake, prevV: 0, brakeLevel: 0, open: 0 };
  return g;
}

export function syncSchoolBus(mesh, vehicle, dt = 0, t = 0, lightsOn = 0) {
  mesh.position.set(vehicle.x, 0, -vehicle.y);
  mesh.rotation.y = vehicle.psi;
  const u = mesh.userData, sb = vehicle.school || {};
  u.spin += (vehicle.v * dt) / u.tire;
  for (const w of u.wheels) {
    w.wheel.rotation.z = -u.spin;
    w.pivot.rotation.y = w.steer ? vehicle.delta : 0;
  }
  // the door slides in and back over half a second
  u.open += ((vehicle.doors ? 1 : 0) - u.open) * Math.min(1, dt * 4);
  u.door.position.z = -0.06 * u.open; u.door.position.x = -0.8 * u.open;
  // the stop arm swings out with the reds, over about a second
  u.swing += ((sb.arm ? 1 : 0) - u.swing) * Math.min(1, dt * 3);
  u.arm.rotation.y = -Math.PI / 2 * u.swing;
  const left = (t % FLASH_S) < FLASH_S / 2;
  for (const color of ["amber", "red"]) {
    const on = sb.lights === color;
    u.lamps[color].left.emissiveIntensity = on && left ? 6 : 0;
    u.lamps[color].right.emissiveIntensity = on && !left ? 6 : 0;
  }
  const blink = (t % 0.8) < 0.45;
  for (const m of u.blinkers.left) m.visible = blink && vehicle.signal === "left";
  for (const m of u.blinkers.right) m.visible = blink && vehicle.signal === "right";
  if (dt > 0) {
    const decel = (u.prevV - vehicle.v) / dt;
    const target = decel > 0.6 || Math.abs(vehicle.v) < 0.15 ? 1 : 0;
    u.brakeLevel += (target - u.brakeLevel) * Math.min(1, dt * 12);
    u.prevV = vehicle.v;
    u.brake.emissiveIntensity = 0.3 + lightsOn * 1.5 + u.brakeLevel * (2.2 + lightsOn * 2);
  }
}
