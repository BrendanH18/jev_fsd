// Buses (sim/bus.js) and their stops. A 12 m low-floor city bus built from boxes at its simulated
// size: a white body over a blue skirt, a band of windows, two doors on the curb side that open at a
// stop, a lit destination sign with the route number, indicators, brake lights and headlamps.
// Local +X is forward, +Z is right, rear axle at the origin, as for cars. Each stop is a pole with a
// blue bus-stop flag facing along the street.

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { BUS } from "../sim/vehicle.js";
import { blobTexture } from "./textures.js";
import { snowable } from "./weather.js";

const box = (sx, sy, sz, x, y, z) => new THREE.BoxGeometry(sx, sy, sz).translate(x, y, z);
const merge = (parts) => mergeGeometries(parts.map((p) => p.toNonIndexed()), false);
const shared = {
  white: snowable(new THREE.MeshPhysicalMaterial({ color: 0xf1f1ec, metalness: 0.15, roughness: 0.4, clearcoat: 0.6 }), "car"),
  skirt: new THREE.MeshStandardMaterial({ color: 0x1d4f9a, roughness: 0.45, metalness: 0.2 }),
  stripe: new THREE.MeshStandardMaterial({ color: 0xf2b21b, roughness: 0.5 }),
  glass: new THREE.MeshPhysicalMaterial({ color: 0x111820, metalness: 0.2, roughness: 0.08, clearcoat: 1, envMapIntensity: 1.6 }),
  door: new THREE.MeshPhysicalMaterial({ color: 0x18222c, metalness: 0.2, roughness: 0.1, clearcoat: 1 }),
  inside: new THREE.MeshStandardMaterial({ color: 0x2c2f33, roughness: 0.9 }),
  trim: new THREE.MeshStandardMaterial({ color: 0x17191c, roughness: 0.7 }),
  tire: new THREE.MeshStandardMaterial({ color: 0x19191a, roughness: 0.92 }),
  rim: new THREE.MeshStandardMaterial({ color: 0xb4b9c0, metalness: 1, roughness: 0.3 }),
  head: new THREE.MeshStandardMaterial({ color: 0xdfe6ee, emissive: 0xfff1dc, emissiveIntensity: 0.6, roughness: 0.1, metalness: 0.4 }),
  blink: new THREE.MeshBasicMaterial({ color: 0xffa21a }),
  blob: new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, color: 0x000000, opacity: 0.65 }),
  pole: new THREE.MeshStandardMaterial({ color: 0x7b8585, roughness: 0.6, metalness: 0.65 }),
};
const signs = new Map();   // destination sign text -> material

// The destination sign: amber LED lettering on black, route number first.
function destination(text) {
  if (signs.has(text)) return signs.get(text);
  const c = document.createElement("canvas");
  c.width = 512; c.height = 64;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#050505"; ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = "#ffb21e"; ctx.textBaseline = "middle"; ctx.textAlign = "center";
  let size = 44;
  ctx.font = `bold ${size}px sans-serif`;
  while (ctx.measureText(text).width > c.width - 24 && size > 18) ctx.font = `bold ${--size}px sans-serif`;
  ctx.fillText(text, c.width / 2, c.height / 2 + 2, c.width - 24);
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshStandardMaterial({ map: texture, emissive: 0xffffff, emissiveMap: texture, emissiveIntensity: 1.4, roughness: 0.4 });
  signs.set(text, material);
  return material;
}

export function wheel(r, width) {
  const g = new THREE.Group();
  const tire = new THREE.Mesh(new THREE.CylinderGeometry(r, r, width, 20).rotateX(Math.PI / 2), shared.tire);
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.6, r * 0.6, width + 0.02, 12).rotateX(Math.PI / 2), shared.rim);
  tire.castShadow = true;
  g.add(tire, rim);
  return g;
}

// `text`: the route number and where it goes, for its destination sign.
export function createBusMesh(id = "bus", text = "") {
  const spec = BUS, xr = -spec.rearOverhang, xf = spec.length - spec.rearOverhang, w = spec.width, h = 3.05, floor = 0.32;
  const g = new THREE.Group();
  g.name = `bus-${id}`;
  const body = new THREE.Group();
  g.add(body);
  const add = (geometry, material, shadow, name) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name; mesh.castShadow = shadow; mesh.receiveShadow = true;
    body.add(mesh);
    return mesh;
  };
  const mid = (xr + xf) / 2, len = xf - xr;
  add(merge([box(len, h - 1.15, w, mid, 1.15 + (h - 1.15) / 2, 0), box(len * 0.55, 0.28, w - 0.5, mid - 1, h + 0.14, 0)]), shared.white, true, "bodywork");
  add(box(len + 0.01, 1.15 - floor, w + 0.01, mid, floor + (1.15 - floor) / 2, 0), shared.skirt, true, "skirt");
  add(box(len + 0.02, 0.1, w + 0.02, mid, 1.2, 0), shared.stripe, false, "stripe");
  // side windows, the windscreen and the rear window
  add(merge([
    box(len - 1.6, 1.05, w + 0.02, mid - 0.4, 2.0, 0),
    box(0.06, 1.75, w - 0.2, xf + 0.005, 1.75, 0),
    box(0.06, 0.7, w - 0.6, xr - 0.005, 2.15, 0),
  ]), shared.glass, false, "windows");
  add(merge([box(0.3, 0.3, w + 0.04, xf + 0.02, floor + 0.15, 0), box(0.25, 0.3, w + 0.04, xr - 0.02, floor + 0.15, 0)]), shared.trim, false, "bumpers");
  add(merge([box(0.06, 0.16, 0.32, xf + 0.03, 0.62, -(w / 2 - 0.3)), box(0.06, 0.16, 0.32, xf + 0.03, 0.62, w / 2 - 0.3)]), shared.head, false, "headlamps");
  const sign = add(box(0.04, 0.24, w - 0.4, xf + 0.02, h - 0.2, 0), destination(text || " "), false, "destination");
  sign.castShadow = false;
  // doors on the curb side (+Z): front, by the driver, and centre; closed panels hide the opening
  const doors = [];
  for (const x of [xf - 0.75, 1.1]) {
    add(box(1.15, 2.3, 0.02, x, floor + 1.2, w / 2 + 0.002), shared.inside, false, "doorway");
    const leaf = add(box(1.15, 2.3, 0.04, x, floor + 1.2, w / 2 + 0.015), shared.door, false, "door");
    doors.push({ leaf, x });
  }
  // lamps: amber indicators front and rear at each corner, red brake and tail lamps at the rear
  const brake = new THREE.MeshStandardMaterial({ color: 0x6a0b0b, emissive: 0xff1a1a, emissiveIntensity: 0.3, roughness: 0.3 });
  add(merge([box(0.05, 0.3, 0.22, xr - 0.03, 0.85, -(w / 2 - 0.2)), box(0.05, 0.3, 0.22, xr - 0.03, 0.85, w / 2 - 0.2)]), brake, false, "brake-lamps");
  const blinkers = { left: [], right: [] };
  for (const [side, z] of [["left", -(w / 2 - 0.12)], ["right", w / 2 - 0.12]]) {
    for (const x of [xf + 0.035, xr - 0.035]) {
      const m = new THREE.Mesh(box(0.04, 0.14, 0.16, x, 1.0, z), shared.blink);
      m.visible = false;
      body.add(m);
      blinkers[side].push(m);
    }
  }
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(spec.length + 0.6, w + 0.6).rotateX(-Math.PI / 2), shared.blob);
  blob.position.set(mid, 0.02, 0);
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
  g.userData = { bus: true, wheels, tire, spin: 0, doors, blinkers, brake, prevV: 0, brakeLevel: 0, open: 0 };
  return g;
}

export function syncBus(mesh, vehicle, dt = 0, t = 0, lightsOn = 0) {
  mesh.position.set(vehicle.x, 0, -vehicle.y);
  mesh.rotation.y = vehicle.psi;
  const u = mesh.userData;
  u.spin += (vehicle.v * dt) / u.tire;
  for (const w of u.wheels) {
    w.wheel.rotation.z = -u.spin;
    w.pivot.rotation.y = w.steer ? vehicle.delta : 0;
  }
  // the doors slide open outward and along, over about a second
  u.open += ((vehicle.doors ? 1 : 0) - u.open) * Math.min(1, dt * 3);
  for (const d of u.doors) { d.leaf.position.z = 0.12 * u.open; d.leaf.position.x = 0.55 * u.open; }
  const on = (t % 0.8) < 0.45;
  for (const m of u.blinkers.left) m.visible = on && vehicle.signal === "left";
  for (const m of u.blinkers.right) m.visible = on && vehicle.signal === "right";
  if (dt > 0) {
    const decel = (u.prevV - vehicle.v) / dt;
    const target = decel > 0.6 || Math.abs(vehicle.v) < 0.15 ? 1 : 0;
    u.brakeLevel += (target - u.brakeLevel) * Math.min(1, dt * 12);
    u.prevV = vehicle.v;
    u.brake.emissiveIntensity = 0.3 + lightsOn * 1.5 + u.brakeLevel * (2.2 + lightsOn * 2);
  }
}

// The map's bus stops: a pole with a flag at each, square to the street beside it.
export function buildBusStops(map) {
  const root = new THREE.Group();
  root.name = "bus-stops";
  const stops = map.transit?.stops || [];
  if (!stops.length) return root;
  const c = document.createElement("canvas");
  c.width = 64; c.height = 96;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#1d4f9a"; ctx.fillRect(0, 0, 64, 96);
  ctx.fillStyle = "#ffffff"; ctx.fillRect(6, 6, 52, 30);
  ctx.fillStyle = "#1d4f9a"; ctx.font = "bold 20px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText("BUS", 32, 22);
  ctx.fillStyle = "#ffffff"; ctx.font = "bold 13px sans-serif"; ctx.fillText("STOP", 32, 60);
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  const flag = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.6, side: THREE.DoubleSide });
  const flags = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.42, 0.63), flag, stops.length);
  const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.04, 0.04, 2.9, 6), shared.pole, stops.length);
  const o = new THREE.Object3D();
  stops.forEach((stop, i) => {
    const road = map.roadDistance(stop.x, stop.y), e = road?.edge;
    let heading = 0;
    if (e) {
      let best = Infinity;
      for (let k = 0; k < e.pts.length - 1; k++) {
        const [ax, ay] = e.pts[k], [bx, by] = e.pts[k + 1], dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
        const tt = Math.max(0, Math.min(1, ((stop.x - ax) * dx + (stop.y - ay) * dy) / l2)), d = Math.hypot(stop.x - ax - dx * tt, stop.y - ay - dy * tt);
        if (d < best) { best = d; heading = Math.atan2(dy, dx); }
      }
    }
    o.position.set(stop.x, 1.45, -stop.y); o.rotation.set(0, 0, 0); o.updateMatrix(); poles.setMatrixAt(i, o.matrix);
    // (the flag sticks out from the pole toward the road, read by traffic coming along it)
    o.position.set(stop.x, 2.55, -stop.y); o.rotation.set(0, heading - Math.PI / 2, 0); o.updateMatrix(); flags.setMatrixAt(i, o.matrix);
  });
  for (const m of [flags, poles]) { m.castShadow = true; m.receiveShadow = true; m.computeBoundingSphere(); root.add(m); }
  root.userData.stopCount = stops.length;
  return root;
}
