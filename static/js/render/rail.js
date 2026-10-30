// Railway tracks and level crossings (sim/rail.js), and the heritage streetcars that run on them.
// A track is a pair of rails on ties and ballast (drawn under the road surface, so where it crosses a
// street only the rails show, set in the asphalt), with its trolley wire 5.6 m over it on poles beside
// it for a line that has one. Each approach to a level crossing has a crossbuck on the right: two
// white boards in an X with a red border, the Canadian railway crossing sign. The streetcar is a
// double-truck wooden car of the 1910s built from boxes at its simulated size: a maroon body with a
// cream band of windows, a clerestory roof, a fender at each end, a headlamp, brake lamps, and its
// trolley pole trailing up to the wire. Local +X is forward, +Z is right, the rear axle at the origin.

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { HERITAGE_STREETCAR } from "../sim/vehicle.js";
import { RAIL_HALF_M, alongStreet, railIndex } from "../sim/rail.js";
import { pointAt, headingAt } from "../map/mapdata.js";
import { GeoBuilder } from "./geo.js";
import { LAYER, groundLayer } from "./scene.js";
import { blobTexture } from "./textures.js";
import { snowable } from "./weather.js";

const GAUGE_M = 1.435;
const RAIL_M = 0.07;
const BALLAST_M = 1.7;          // half the ballast's width
const TIE_EVERY_M = 0.65;
const WIRE_Y = 5.6;
const POLE_EVERY_M = 32;
const POLE_SIDE_M = 3.2;
const SIGN_BACK_M = 4;          // a crossbuck stands this far short of the nearest rail
const BALLAST_LAYER = LAYER.water + 1;   // (above the grass, under every street surface)
const box = (sx, sy, sz, x, y, z) => new THREE.BoxGeometry(sx, sy, sz).translate(x, y, z);
const merge = (parts) => mergeGeometries(parts.map((p) => p.toNonIndexed()), false);
const shared = {
  maroon: snowable(new THREE.MeshPhysicalMaterial({ color: 0x6e1a1c, metalness: 0.05, roughness: 0.45, clearcoat: 0.5 }), "car"),
  cream: new THREE.MeshStandardMaterial({ color: 0xe8dcb8, roughness: 0.55 }),
  roof: snowable(new THREE.MeshStandardMaterial({ color: 0x3b3430, roughness: 0.8 }), "car"),
  black: new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.6 }),
  gold: new THREE.MeshStandardMaterial({ color: 0xc9a44a, metalness: 0.6, roughness: 0.35 }),
  glass: new THREE.MeshPhysicalMaterial({ color: 0x1a2028, metalness: 0.2, roughness: 0.1, clearcoat: 1, envMapIntensity: 1.4 }),
  head: new THREE.MeshStandardMaterial({ color: 0xf2efe6, emissive: 0xfff1d0, emissiveIntensity: 0.8, roughness: 0.1, metalness: 0.4 }),
  blob: new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, color: 0x000000, opacity: 0.6 }),
  rail: new THREE.MeshStandardMaterial({ color: 0x8c8f93, metalness: 0.85, roughness: 0.35 }),
  ballast: new THREE.MeshStandardMaterial({ color: 0x7d746a, roughness: 1 }),
  tie: new THREE.MeshStandardMaterial({ color: 0x4a3a2c, roughness: 0.95 }),
  wire: new THREE.MeshBasicMaterial({ color: 0x1c1c1c, side: THREE.DoubleSide }),
  pole: new THREE.MeshStandardMaterial({ color: 0x5b4a3a, roughness: 0.9 }),
  white: new THREE.MeshStandardMaterial({ color: 0xf4f4f0, roughness: 0.5 }),
  red: new THREE.MeshStandardMaterial({ color: 0xc8202a, roughness: 0.5 }),
  post: new THREE.MeshStandardMaterial({ color: 0xb8bcbf, metalness: 0.6, roughness: 0.45 }),
};

export function createTrainMesh(id = "train") {
  const spec = HERITAGE_STREETCAR, xr = -spec.rearOverhang, xf = spec.length - spec.rearOverhang, w = spec.width, mid = (xr + xf) / 2, len = spec.length;
  const g = new THREE.Group();
  g.name = `train-${id}`;
  const add = (geometry, material, shadow, name) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name; mesh.castShadow = shadow; mesh.receiveShadow = true;
    g.add(mesh);
    return mesh;
  };
  // the body: maroon below the windows and at the ends, cream between them, the platforms at each end
  // a little narrower
  const floor = 0.75, sill = 1.55, top = 2.75;
  add(merge([box(len - 2.4, sill - floor, w, mid, (floor + sill) / 2, 0), box(1.15, sill - floor, w - 0.25, xr + 0.6, (floor + sill) / 2, 0), box(1.15, sill - floor, w - 0.25, xf - 0.6, (floor + sill) / 2, 0),
    box(len - 2.4, 0.16, w + 0.02, mid, top - 0.08, 0)]), shared.maroon, true, "bodywork");
  add(merge([box(len - 2.4, top - sill - 0.16, w - 0.04, mid, (sill + top - 0.16) / 2, 0), box(1.15, top - sill, w - 0.3, xr + 0.6, (sill + top) / 2, 0), box(1.15, top - sill, w - 0.3, xf - 0.6, (sill + top) / 2, 0)]), shared.cream, true, "upper");
  const panes = [];
  for (let x = xr + 1.7; x < xf - 1.6; x += 0.92) panes.push(box(0.72, 0.8, w + 0.02, x, sill + 0.55, 0));
  panes.push(box(0.04, 0.85, w - 0.5, xf + 0.005, sill + 0.55, 0), box(0.04, 0.85, w - 0.5, xr - 0.005, sill + 0.55, 0));
  add(merge(panes), shared.glass, false, "windows");
  add(box(len - 2.6, 0.05, w + 0.04, mid, sill - 0.05, 0), shared.gold, false, "lining");
  // the roof, its clerestory along the middle, and the trolley pole trailing up to the wire
  add(merge([box(len - 0.1, 0.18, w + 0.12, mid, top + 0.09, 0), box(len - 3, 0.3, 1.3, mid, top + 0.33, 0)]), shared.roof, true, "roof");
  const base = [xr + 2.6, top + 0.5], tip = [base[0] - 4.2, WIRE_Y - 0.05], dx = tip[0] - base[0], dy = tip[1] - base[1], pl = Math.hypot(dx, dy);
  const pole = box(pl, 0.06, 0.06, 0, 0, 0).rotateZ(Math.atan2(dy, dx)).translate((base[0] + tip[0]) / 2, (base[1] + tip[1]) / 2, 0);
  add(merge([pole, box(0.5, 0.18, 0.5, base[0], top + 0.55, 0), box(0.18, 0.08, 0.12, tip[0], tip[1], 0)]), shared.black, true, "trolley-pole");
  // trucks, the fenders at each end, the dash with its headlamp
  add(merge([box(2.3, 0.55, w - 0.5, 0, 0.42, 0), box(2.3, 0.55, w - 0.5, spec.wheelbase, 0.42, 0), box(0.5, 0.25, w - 0.2, xf + 0.15, 0.35, 0), box(0.5, 0.25, w - 0.2, xr - 0.15, 0.35, 0)]), shared.black, true, "trucks");
  add(merge([box(0.08, 0.2, 0.2, xf + 0.02, floor + 0.45, 0), box(0.08, 0.2, 0.2, xr - 0.02, top + 0.32, 0)]), shared.head, false, "headlamp");
  const brake = new THREE.MeshStandardMaterial({ color: 0x6a0b0b, emissive: 0xff1a1a, emissiveIntensity: 0.3, roughness: 0.3 });
  add(merge([box(0.05, 0.18, 0.18, xr - 0.03, floor + 0.3, -(w / 2 - 0.35)), box(0.05, 0.18, 0.18, xr - 0.03, floor + 0.3, w / 2 - 0.35)]), brake, false, "brake-lamps");
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(len + 0.6, w + 0.6).rotateX(-Math.PI / 2), shared.blob);
  blob.position.set(mid, 0.02, 0);
  blob.renderOrder = 1;
  g.add(blob);
  g.userData = { train: true, brake, prevV: 0, brakeLevel: 0 };
  return g;
}

export function syncTrain(mesh, vehicle, dt = 0, t = 0, lightsOn = 0) {
  mesh.position.set(vehicle.x, 0, -vehicle.y);
  mesh.rotation.y = vehicle.psi;
  const u = mesh.userData;
  if (dt > 0) {
    const decel = (u.prevV - vehicle.v) / dt;
    const target = decel > 0.4 || Math.abs(vehicle.v) < 0.15 ? 1 : 0;
    u.brakeLevel += (target - u.brakeLevel) * Math.min(1, dt * 12);
    u.prevV = vehicle.v;
    u.brake.emissiveIntensity = 0.3 + lightsOn * 1.5 + u.brakeLevel * (2.2 + lightsOn * 2);
  }
}

// The map's tracks (rails, ties and ballast, the trolley wire on its poles where the line has one)
// and a crossbuck at each approach to each level crossing.
export function buildRail(map) {
  const root = new THREE.Group();
  root.name = "rail";
  const index = railIndex(map);
  if (!index.tracks.size) return root;
  const rails = new GeoBuilder(), ballast = new GeoBuilder(), ties = new GeoBuilder(), wire = new GeoBuilder(), poles = [], boards = [], borders = [], posts = [];
  for (const t of index.tracks.values()) {
    for (const side of [-1, 1]) {
      const inner = side * GAUGE_M / 2, outer = inner + side * RAIL_M;
      rails.ribbon(t.pts, Math.min(inner, outer), Math.max(inner, outer), 0, { uv: "along" });
    }
    ballast.ribbon(t.pts, -BALLAST_M, BALLAST_M, 0);
    for (let s = 0.3; s < t.length; s += TIE_EVERY_M) {
      const p = pointAt(t.pts, t.cum, s), h = headingAt(t.pts, t.cum, s);
      ties.rect(p[0], p[1], h + Math.PI / 2, 2.4, 0.22, 0);
    }
    if (t.kind === "tram") {
      wire.ribbon(t.pts, -0.012, 0.012, WIRE_Y, { uv: "along" });
      for (let s = POLE_EVERY_M / 2; s < t.length; s += POLE_EVERY_M) {
        const p = pointAt(t.pts, t.cum, s), h = headingAt(t.pts, t.cum, s), side = Math.round(s / POLE_EVERY_M) % 2 ? 1 : -1;
        const x = p[0] + Math.sin(h) * POLE_SIDE_M * side, y = p[1] - Math.cos(h) * POLE_SIDE_M * side;
        poles.push(new THREE.CylinderGeometry(0.11, 0.14, WIRE_Y + 0.6, 6).translate(x, (WIRE_Y + 0.6) / 2, -y));
        // (the bracket arm out over the wire)
        const ax = (x + p[0]) / 2, ay = (y + p[1]) / 2;
        poles.push(box(POLE_SIDE_M, 0.07, 0.07, 0, 0, 0).rotateY(h + Math.PI / 2).translate(ax, WIRE_Y + 0.35, -ay));
      }
    }
  }
  // crossbucks: for each street a crossing crosses, on the right of its approach, SIGN_BACK_M short of
  // the nearest rail
  for (const c of index.crossings) for (const on of c.edges) {
    const e = map.edges.get(on.edge), a = Math.max(0.35, on.angle_deg * Math.PI / 180);
    const s = on.s - alongStreet(RAIL_HALF_M, a, 2) - SIGN_BACK_M;
    if (s < 1) continue;
    const p = pointAt(e.pts, e.cum, s), h = headingAt(e.pts, e.cum, s), right = (e.asphalt?.[1] ?? 4) + 0.7;
    const x = p[0] + Math.sin(h) * right, y = p[1] - Math.cos(h) * right, face = h + Math.PI;
    posts.push(new THREE.CylinderGeometry(0.045, 0.045, 3.2, 8).translate(x, 1.6, -y));
    for (const tilt of [Math.PI / 4, -Math.PI / 4]) {
      const place = (geometry, ahead) => geometry.rotateX(tilt).rotateY(face).translate(x + Math.cos(face) * ahead, 2.75, -(y + Math.sin(face) * ahead));
      boards.push(place(box(0.02, 0.2, 1.22, 0, 0, 0), 0.06));
      borders.push(place(box(0.02, 0.26, 1.28, 0, 0, 0), 0.045));
    }
  }
  const meshes = [[ballast.toGeometry(), shared.ballast, BALLAST_LAYER], [ties.toGeometry(), shared.tie, BALLAST_LAYER + 1], [rails.toGeometry(), shared.rail, LAYER.marking]];
  for (const [geometry, material, layer] of meshes) {
    const mesh = new THREE.Mesh(geometry, material);
    groundLayer(mesh, layer);
    mesh.receiveShadow = true;
    root.add(mesh);
  }
  if (!wire.empty) root.add(new THREE.Mesh(wire.toGeometry(), shared.wire));
  for (const [parts, material, name] of [[poles, shared.pole, "rail-poles"], [posts, shared.post, "crossbuck-posts"], [boards, shared.white, "crossbucks"], [borders, shared.red, "crossbuck-borders"]]) {
    if (!parts.length) continue;
    const mesh = new THREE.Mesh(merge(parts), material);
    mesh.name = name; mesh.castShadow = true; mesh.receiveShadow = true;
    root.add(mesh);
  }
  root.userData.crossings = index.crossings.length;
  return root;
}
