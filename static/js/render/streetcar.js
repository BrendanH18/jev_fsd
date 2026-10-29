// Streetcars (sim/streetcar.js), their tracks and the trolley wire above them. A Flexity Outlook built
// from boxes at its simulated size: five sections in TTC red joined by dark bellows, a band of
// windows over a white stripe, a black-glass cab at the front with the route and destination lit
// above it, four double doors on the curb side that slide open at a stop, the pantograph and the
// equipment pods on the roof, bogies under a skirt, headlamps and brake lamps. Local +X is forward,
// +Z is right, its reference point (the rear axle, for other vehicles) at the origin. The tracks are a
// pair of rails along the lane each run of each streetcar route is laid in, with the wire 5.6 m over
// their middle.

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { STREETCAR } from "../sim/vehicle.js";
import { DOOR_M } from "../sim/streetcar.js";
import { GeoBuilder } from "./geo.js";
import { LAYER, groundLayer } from "./scene.js";
import { blobTexture } from "./textures.js";
import { snowable } from "./weather.js";

const GAUGE_M = 1.495;   // the TTC's track gauge, between the rails' inner faces
const RAIL_M = 0.07;     // a rail's head, as seen from above
const WIRE_Y = 5.6;
const box = (sx, sy, sz, x, y, z) => new THREE.BoxGeometry(sx, sy, sz).translate(x, y, z);
const merge = (parts) => mergeGeometries(parts.map((p) => p.toNonIndexed()), false);
const shared = {
  red: snowable(new THREE.MeshPhysicalMaterial({ color: 0xc8102e, metalness: 0.12, roughness: 0.38, clearcoat: 0.6 }), "car"),
  white: new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.5 }),
  roof: snowable(new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.6, metalness: 0.3 }), "car"),
  black: new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.6 }),
  bellows: new THREE.MeshStandardMaterial({ color: 0x232527, roughness: 0.95 }),
  glass: new THREE.MeshPhysicalMaterial({ color: 0x111820, metalness: 0.2, roughness: 0.08, clearcoat: 1, envMapIntensity: 1.6 }),
  door: new THREE.MeshPhysicalMaterial({ color: 0x1b232b, metalness: 0.2, roughness: 0.1, clearcoat: 1 }),
  inside: new THREE.MeshStandardMaterial({ color: 0xd8d4c4, emissive: 0x403a2a, emissiveIntensity: 0.4, roughness: 0.9 }),
  frame: new THREE.MeshStandardMaterial({ color: 0x2b2d30, metalness: 0.6, roughness: 0.5 }),
  head: new THREE.MeshStandardMaterial({ color: 0xdfe6ee, emissive: 0xfff1dc, emissiveIntensity: 0.6, roughness: 0.1, metalness: 0.4 }),
  blob: new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, color: 0x000000, opacity: 0.6 }),
  rail: new THREE.MeshStandardMaterial({ color: 0x8c8f93, metalness: 0.85, roughness: 0.35 }),
  wire: new THREE.MeshBasicMaterial({ color: 0x1c1c1c }),
};
const signs = new Map();

// The route and destination sign: amber LED lettering on black.
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

// Where its doors are, ahead of its rear bumper (as sim/streetcar.js doorPoints), and the joints
// between its five sections.
const DOORS = [STREETCAR.length - 3.4, STREETCAR.length * 0.62, STREETCAR.length * 0.36, DOOR_M + 0.6];
const JOINTS = [8.2, 13.0, 17.2, 22.0];
const DOOR_W = 1.3;

// `text`: its route number and where it goes, for its destination sign.
export function createStreetcarMesh(id = "streetcar", text = "") {
  const spec = STREETCAR, xr = -spec.rearOverhang, xf = spec.length - spec.rearOverhang, w = spec.width, h = 3.55, floor = 0.36;
  const g = new THREE.Group();
  g.name = `streetcar-${id}`;
  const body = new THREE.Group();
  g.add(body);
  const add = (geometry, material, shadow, name) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name; mesh.castShadow = shadow; mesh.receiveShadow = true;
    body.add(mesh);
    return mesh;
  };
  // sections between the joints, the cabs' ends tapered back a little above the windscreen
  const ends = [0, ...JOINTS, spec.length];
  const shells = [], windows = [], stripes = [], bellows = [];
  for (let i = 0; i < ends.length - 1; i++) {
    const a = xr + ends[i] + (i ? 0.25 : 0), b = xr + ends[i + 1] - (i < ends.length - 2 ? 0.25 : 0), len = b - a, mid = (a + b) / 2;
    shells.push(box(len, h - floor, w, mid, floor + (h - floor) / 2, 0));
    windows.push(box(len - 0.5, 1.15, w + 0.02, mid, 2.25, 0));
    stripes.push(box(len + 0.01, 0.12, w + 0.02, mid, 1.55, 0));
  }
  for (const j of JOINTS) bellows.push(box(0.5, h - floor - 0.25, w - 0.12, xr + j, floor + (h - floor) / 2, 0));
  add(merge(shells), shared.red, true, "bodywork");
  add(merge(stripes), shared.white, false, "stripe");
  add(merge(bellows), shared.bellows, true, "bellows");
  // the windscreen, wrapping round the cab, and the rear window
  windows.push(box(0.06, 1.7, w - 0.2, xf + 0.005, 2.1, 0), box(0.06, 1.0, w - 0.5, xr - 0.005, 2.3, 0));
  add(merge(windows), shared.glass, false, "windows");
  add(box(xf - xr - 0.6, 0.25, w - 0.3, (xr + xf) / 2, h + 0.12, 0), shared.roof, true, "roof");
  // pods on the roof and the pantograph over the middle section, its head up on the wire
  add(merge([box(3.2, 0.42, w - 0.6, xr + 4.5, h + 0.45, 0), box(3.2, 0.42, w - 0.6, xr + 25.6, h + 0.45, 0), box(2.4, 0.3, w - 0.9, xr + 15.1, h + 0.4, 0)]), shared.roof, true, "roof-pods");
  const px = xr + 15.1, armTop = WIRE_Y - 0.08;
  add(merge([box(0.9, 0.1, 0.9, px, h + 0.3, 0), box(0.05, armTop - h - 0.35, 0.05, px - 0.25, (h + 0.35 + armTop) / 2, 0), box(0.05, armTop - h - 0.35, 0.05, px + 0.25, (h + 0.35 + armTop) / 2, 0),
    box(0.55, 0.05, 0.05, px, armTop, 0), box(0.12, 0.05, 1.5, px, armTop + 0.04, 0)]), shared.frame, true, "pantograph");
  add(merge([box(0.3, 0.32, w + 0.04, xf + 0.02, floor + 0.12, 0), box(0.3, 0.32, w + 0.04, xr - 0.02, floor + 0.12, 0)]), shared.black, false, "bumpers");
  add(merge([box(0.06, 0.16, 0.3, xf + 0.03, 0.85, -(w / 2 - 0.3)), box(0.06, 0.16, 0.3, xf + 0.03, 0.85, w / 2 - 0.3)]), shared.head, false, "headlamps");
  const sign = add(box(0.04, 0.3, w - 0.5, xf + 0.02, h - 0.22, 0), destination(text || " "), false, "destination");
  sign.castShadow = false;
  // bogies and the skirt over them
  add(merge([0.0, 7.1, 15.1, 23.1, 30.2].map((d) => box(2.0, 0.42, w - 0.35, Math.min(xf - 1.1, Math.max(xr + 1.1, xr + d)), 0.3, 0))), shared.black, true, "bogies");
  // doors on the curb side (+Z): double leaves that slide apart, a lit inside behind them
  const doors = [];
  for (const d of DOORS) {
    const x = xr + d;
    add(box(DOOR_W, 2.3, 0.02, x, floor + 1.18, w / 2 + 0.002), shared.inside, false, "doorway");
    for (const side of [-1, 1]) {
      const leaf = add(box(DOOR_W / 2, 2.3, 0.04, x + side * DOOR_W / 4, floor + 1.18, w / 2 + 0.015), shared.door, false, "door");
      doors.push({ leaf, x: x + side * DOOR_W / 4, side });
    }
  }
  const brake = new THREE.MeshStandardMaterial({ color: 0x6a0b0b, emissive: 0xff1a1a, emissiveIntensity: 0.3, roughness: 0.3 });
  add(merge([box(0.05, 0.25, 0.25, xr - 0.03, 1.0, -(w / 2 - 0.25)), box(0.05, 0.25, 0.25, xr - 0.03, 1.0, w / 2 - 0.25)]), brake, false, "brake-lamps");
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(spec.length + 0.6, w + 0.6).rotateX(-Math.PI / 2), shared.blob);
  blob.position.set((xr + xf) / 2, 0.02, 0);
  blob.renderOrder = 1;
  g.add(blob);
  g.userData = { streetcar: true, doors, brake, prevV: 0, brakeLevel: 0, open: 0 };
  return g;
}

export function syncStreetcar(mesh, vehicle, dt = 0, t = 0, lightsOn = 0) {
  mesh.position.set(vehicle.x, 0, -vehicle.y);
  mesh.rotation.y = vehicle.psi;
  const u = mesh.userData;
  // the leaves slide out and apart, over about a second
  u.open += ((vehicle.doors ? 1 : 0) - u.open) * Math.min(1, dt * 3);
  for (const d of u.doors) { d.leaf.position.z = 0.1 * u.open; d.leaf.position.x = d.side * 0.55 * u.open; }
  if (dt > 0) {
    const decel = (u.prevV - vehicle.v) / dt;
    const target = decel > 0.5 || Math.abs(vehicle.v) < 0.15 ? 1 : 0;
    u.brakeLevel += (target - u.brakeLevel) * Math.min(1, dt * 12);
    u.prevV = vehicle.v;
    u.brake.emissiveIntensity = 0.3 + lightsOn * 1.5 + u.brakeLevel * (2.2 + lightsOn * 2);
  }
}

// The map's streetcar tracks: two rails along the lane each run is laid in, on every street of it,
// and the trolley wire over them. A street both ways' runs share is drawn once each way.
export function buildTracks(map) {
  const root = new THREE.Group();
  root.name = "streetcar-tracks";
  const rails = new GeoBuilder(), wire = new GeoBuilder(), seen = new Set();
  for (const route of map.transit?.routes || []) {
    if (route.mode !== "tram") continue;
    for (const run of route.runs) for (const id of run.edges) {
      const e = map.edges.get(id);
      if (!e) continue;
      const lane = Math.min(run.lane ?? 0, e.lanes - 1), key = `${id}:${lane}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const mid = e.lane_offsets[lane], half = GAUGE_M / 2;
      for (const side of [-1, 1]) {
        const inner = mid + side * half, outer = inner + side * RAIL_M;
        rails.ribbon(e.pts, Math.min(inner, outer), Math.max(inner, outer), 0, { uv: "along" });
      }
      wire.ribbon(e.pts, mid - 0.012, mid + 0.012, WIRE_Y, { uv: "along" });
    }
  }
  if (!rails.empty) {
    const mesh = new THREE.Mesh(rails.toGeometry(), shared.rail);
    groundLayer(mesh, LAYER.marking);
    root.add(mesh);
    const overhead = new THREE.Mesh(wire.toGeometry(), shared.wire);
    overhead.material.side = THREE.DoubleSide;
    root.add(overhead);
  }
  root.userData.edges = seen.size;
  return root;
}
