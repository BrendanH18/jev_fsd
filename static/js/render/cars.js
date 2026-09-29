// Car meshes: a side profile extruded to the car's width with rounded edges, a glass cabin with a
// painted roof and pillars, lights, plates, and wheels with rims. Three body styles share the sim's
// footprint (CAR). Local +X is forward, +Z is the right side; the rear axle sits at the origin.
// Cyclists are here too; pedestrians are in people.js.

import * as THREE from "three";
import { mergeGeometries, toCreasedNormals } from "three/addons/utils/BufferGeometryUtils.js";
import { CAR } from "../sim/vehicle.js";
import { blobTexture, glowTexture, poolTexture } from "./textures.js";
import { hash01 } from "./geo.js";
import { snowable } from "./weather.js";
import { createPersonMesh, poseRider } from "./people.js";
import { chunkLOD } from "./lod.js";

const XR = -CAR.rearOverhang, XF = CAR.length - CAR.rearOverhang, W = CAR.width;
const BEVEL = 0.09;
const CG_X = CAR.wheelbase - CAR.cgToFront, CG_Y = 0.5;
const PITCH_PER_MS2 = 0.0045;   // rad of nose dive per m/s^2 of braking (about 2 deg at 8 m/s^2)
const ROLL_PER_MS2 = 0.007;     // rad of body roll per m/s^2 of cornering (about 3.5 deg at 0.9 g)

// Profiles in (x forward, y up). `body` is the lower shell and `glass` the greenhouse; the painted
// roof is the top of the greenhouse, clipped off and extruded a touch wider. Arches are cut around
// wheels of radius `tire`.
const STYLES = {
  sedan: {
    tire: 0.33, sill: 0.3, belt: 1.0,
    nose: [[XF, 0.42], [XF + 0.02, 0.62], [XF - 0.08, 0.76], [XF - 0.5, 0.86], [2.35, 0.95], [2.05, 0.99]],
    tail: [[-0.3, 1.0], [XR + 0.15, 0.99], [XR, 0.86], [XR - 0.03, 0.6], [XR + 0.04, 0.36]],
    glass: [[-0.42, 0.97], [2.08, 0.97], [1.3, 1.42], [0.1, 1.45]],
    pillar: 0.78,
  },
  hatch: {
    tire: 0.32, sill: 0.3, belt: 1.0,
    nose: [[XF, 0.42], [XF + 0.02, 0.62], [XF - 0.1, 0.78], [XF - 0.55, 0.88], [2.3, 0.97], [2.0, 1.0]],
    tail: [[XR + 0.12, 1.02], [XR, 0.9], [XR - 0.03, 0.6], [XR + 0.04, 0.36]],
    glass: [[XR + 0.14, 1.0], [2.02, 0.99], [1.3, 1.46], [XR + 0.4, 1.5], [XR + 0.16, 1.2]],
    pillar: 0.62,
  },
  suv: {
    tire: 0.37, sill: 0.4, belt: 1.12,
    nose: [[XF, 0.5], [XF + 0.02, 0.78], [XF - 0.1, 0.94], [XF - 0.6, 1.02], [2.25, 1.1], [2.0, 1.13]],
    tail: [[XR + 0.1, 1.14], [XR, 1.0], [XR - 0.03, 0.66], [XR + 0.04, 0.44]],
    glass: [[XR + 0.12, 1.12], [2.02, 1.12], [1.38, 1.7], [XR + 0.2, 1.74], [XR + 0.1, 1.4]],
    pillar: 0.72,
  },
};

// Extrude a side profile across the car's width, then shape it: the sides lean in toward the top
// (tumblehome) and the corners round off in plan view, so the body reads as pressed metal rather
// than a slab. `tuck` is how far the plan view pulls in at the very nose and tail.
function extrude(outline, width, bevel = BEVEL, { tumble = 0, tuck = 0, top = 1.5 } = {}) {
  const s = new THREE.Shape();
  s.moveTo(outline[0][0], outline[0][1]);
  for (const [x, y] of outline.slice(1)) s.lineTo(x, y);
  s.closePath();
  const depth = Math.max(0.01, width - 2 * bevel);
  let geo = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel * 0.7, bevelSegments: 3, curveSegments: 10 });
  geo.translate(0, 0, -depth / 2);
  if (tumble || tuck) {
    const p = geo.attributes.position;
    const mid = (XR + XF) / 2, half = (XF - XR) / 2;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i);
      const endness = Math.min(1, Math.abs(x - mid) / half);
      let k = 1 - tuck * Math.pow(endness, 6);
      k *= 1 - tumble * Math.max(0, (y - 0.55) / (top - 0.55));
      p.setZ(i, p.getZ(i) * k);
    }
  }
  geo = toCreasedNormals(geo, Math.PI / 5);
  return geo;
}

// The lower shell: along the bottom from rear to front with an arch over each wheel, up the nose,
// back along the beltline and hood, down the tail. Counter-clockwise seen from +Z.
function bodyOutline(st) {
  const pts = [[XR + 0.08, st.sill]];
  for (const cx of [0, CAR.wheelbase]) {
    const r = st.tire + 0.07, cy = st.tire;
    for (let k = 0; k <= 10; k++) {
      const a = Math.PI - (k / 10) * Math.PI;
      pts.push([cx + Math.cos(a) * r, Math.max(st.sill, cy + Math.sin(a) * r)]);
    }
  }
  pts.push([XF - 0.08, st.sill]);
  return pts.concat(st.nose, st.tail);
}

const roofLine = (st) => Math.max(...st.glass.map((p) => p[1])) - 0.07;

// The part of a polygon above y = cut (Sutherland-Hodgman against one edge).
function clipAbove(poly, cut) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const ina = a[1] >= cut, inb = b[1] >= cut;
    if (ina) out.push(a);
    if (ina !== inb) {
      const t = (cut - a[1]) / (b[1] - a[1]);
      out.push([a[0] + (b[0] - a[0]) * t, cut]);
    }
  }
  return out;
}

const box = (sx, sy, sz, x, y, z) => new THREE.BoxGeometry(sx, sy, sz).translate(x, y, z).toNonIndexed();
// a box with rounded edges, for lamps and trim
const pill = (sx, sy, sz, x, y, z, r = 0.03) => {
  const shape = new THREE.Shape();
  const w = sz / 2 - r, h = sy / 2 - r;
  shape.moveTo(-w, -sy / 2); shape.lineTo(w, -sy / 2); shape.quadraticCurveTo(sz / 2, -sy / 2, sz / 2, -h);
  shape.lineTo(sz / 2, h); shape.quadraticCurveTo(sz / 2, sy / 2, w, sy / 2); shape.lineTo(-w, sy / 2);
  shape.quadraticCurveTo(-sz / 2, sy / 2, -sz / 2, h); shape.lineTo(-sz / 2, -h); shape.quadraticCurveTo(-sz / 2, -sy / 2, -w, -sy / 2);
  const g = new THREE.ExtrudeGeometry(shape, { depth: sx, bevelEnabled: false, curveSegments: 3 });
  g.translate(0, 0, -sx / 2).rotateY(Math.PI / 2).translate(x, y, z);
  return g.toNonIndexed();
};
const merge = (parts) => mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)), false);

// Every static part of a style merged per material, so a car is a handful of draw calls.
const geoCache = new Map();
function styleGeometry(name) {
  if (geoCache.has(name)) return geoCache.get(name);
  const st = STYLES[name];
  const noseY = st.nose[1][1] - 0.02, tailY = st.tail[st.tail.length - 3][1] - 0.02;
  const roof = roofLine(st);
  const shape = { tumble: 0.06, tuck: 0.1, top: roof };
  const glassShape = { tumble: 0.16, tuck: 0.0, top: roof + 0.05 };
  const side = (fn) => [fn(-1), fn(1)];
  const zLamp = W / 2 - 0.34;
  const g = {
    tailY,
    paint: merge([
      extrude(bodyOutline(st), W, BEVEL, shape),
      extrude(clipAbove(st.glass, roof), W * 0.86 + 0.02, 0.06, glassShape),
      box(0.12, roof - st.belt + 0.02, W * 0.8, st.pillar, (st.belt + roof) / 2, 0),
      ...side((s) => box(0.2, 0.08, 0.14, 1.92, st.belt + 0.1, s * (W / 2 + 0.03))),        // mirrors
    ]),
    glass: extrude(st.glass, W * 0.86, 0.06, glassShape),
    trim: merge([
      pill(0.06, 0.22, W * 0.56, XF + 0.04, st.sill + 0.14, 0, 0.05),                       // grille
      box(CAR.length - 0.5, 0.12, W - 0.1, (XR + XF) / 2, st.sill - 0.02, 0),                // underbody
      ...side((s) => box(CAR.length - 1.6, 0.07, 0.03, (XR + XF) / 2, st.sill + 0.05, s * (W / 2 - 0.02))),   // rocker trim
      ...side((s) => box(2.6, 0.035, 0.03, 0.85, st.belt - 0.01, s * (W / 2 - 0.035))),      // window seal along the beltline
      box(0.08, 0.1, W * 0.84, XF + 0.02, st.sill + 0.01, 0),                               // front lip
      box(0.08, 0.12, W * 0.84, XR - 0.02, st.sill + 0.04, 0),                              // rear bumper insert
    ]),
    chrome: merge([
      ...side((s) => box(0.14, 0.025, 0.02, 1.25, st.belt - 0.18, s * (W / 2 - 0.02))),     // front door handles
      ...side((s) => box(0.14, 0.025, 0.02, 0.2, st.belt - 0.18, s * (W / 2 - 0.02))),      // rear door handles
    ]),
    plate: merge([box(0.03, 0.12, 0.48, XF + 0.08, st.sill + 0.14, 0), box(0.03, 0.14, 0.5, XR - 0.07, st.sill + 0.26, 0)]),
    head: merge(side((s) => pill(0.08, 0.12, 0.44, XF + 0.01, noseY, s * zLamp, 0.05))),
    drl: merge(side((s) => box(0.07, 0.025, 0.4, XF + 0.035, noseY + 0.075, s * zLamp))),
    tail: merge([
      ...side((s) => pill(0.08, 0.13, 0.5, XR - 0.02, tailY, s * (W / 2 - 0.32), 0.04)),
      box(0.05, 0.035, W * 0.46, XR - 0.035, tailY + 0.02, 0),                               // light bar between the lamps
    ]),
    // indicators: front and rear corner on each side (local +z is the right side)
    blinkL: merge([box(0.07, 0.07, 0.16, XF + 0.02, noseY - 0.1, -(W / 2 - 0.14)), box(0.07, 0.08, 0.16, XR - 0.04, tailY - 0.1, -(W / 2 - 0.16))]),
    blinkR: merge([box(0.07, 0.07, 0.16, XF + 0.02, noseY - 0.1, W / 2 - 0.14), box(0.07, 0.08, 0.16, XR - 0.04, tailY - 0.1, W / 2 - 0.16)]),
  };
  geoCache.set(name, g);
  return g;
}

const shared = {
  glass: new THREE.MeshPhysicalMaterial({ color: 0x141c24, metalness: 0.2, roughness: 0.03, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 2.2 }),
  trim: new THREE.MeshStandardMaterial({ color: 0x121315, roughness: 0.6 }),
  chrome: new THREE.MeshStandardMaterial({ color: 0xd8dde2, metalness: 1.0, roughness: 0.18 }),
  tire: new THREE.MeshStandardMaterial({ color: 0x19191a, roughness: 0.92 }),
  rim: new THREE.MeshStandardMaterial({ color: 0xb4b9c0, metalness: 1.0, roughness: 0.28 }),
  plate: new THREE.MeshStandardMaterial({ color: 0xe9ecef, roughness: 0.5 }),
  // headlamps are a lens over a chrome reflector: pale and shiny by day, blazing (and blooming) at night
  head: new THREE.MeshStandardMaterial({ color: 0xdfe6ee, emissive: 0xfff1dc, emissiveIntensity: 0.35, roughness: 0.08, metalness: 0.4 }),
  drl: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xf4f8ff, emissiveIntensity: 2.2, roughness: 0.2 }),
  blink: new THREE.MeshStandardMaterial({ color: 0xffa31a, emissive: 0xff8c00, emissiveIntensity: 4, roughness: 0.3 }),
  blob: new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, color: 0x000000, opacity: 0.65 }),
  pool: new THREE.MeshBasicMaterial({ map: poolTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xfff0d8, opacity: 0, toneMapped: true }),
};
const paints = new Map();
function paint(hex) {
  if (!paints.has(hex)) {
    paints.set(hex, snowable(new THREE.MeshPhysicalMaterial({ color: hex, metalness: 0.5, roughness: 0.32, clearcoat: 1.0, clearcoatRoughness: 0.06 }), "car"));
  }
  return paints.get(hex);
}

function wheelGeometry(r) {
  const key = "wheel" + r;
  if (geoCache.has(key)) return geoCache.get(key);
  // tire: a lathe with a rounded shoulder and sidewall, so it is not a hockey puck
  const half = 0.12, pts = [];
  const inner = r * 0.66;
  pts.push(new THREE.Vector2(inner, -half));
  for (let k = 0; k <= 6; k++) {
    const a = -Math.PI / 2 + (k / 6) * Math.PI;
    pts.push(new THREE.Vector2(r - 0.05 + Math.cos(a) * 0.05, Math.sin(a) * half));
  }
  pts.push(new THREE.Vector2(inner, half));
  const tire = new THREE.LatheGeometry(pts, 28).rotateX(Math.PI / 2);
  tire.deleteAttribute("uv");
  const parts = [new THREE.CylinderGeometry(inner, inner, 0.2, 24).rotateX(Math.PI / 2)];
  for (let k = 0; k < 5; k++) {
    const spoke = new THREE.BoxGeometry(0.07, inner * 1.75, 0.03).translate(0, inner * 0.12, 0.105);
    spoke.rotateZ((k / 5) * Math.PI * 2);
    parts.push(spoke, spoke.clone().translate(0, 0, -0.21));
  }
  parts.push(new THREE.CylinderGeometry(0.06, 0.06, 0.24, 10).rotateX(Math.PI / 2));   // hub
  const rim = mergeParts(parts);
  const g = mergeGeometries([tire.index ? tire.toNonIndexed() : tire, rim.toNonIndexed()], true);
  geoCache.set(key, g);
  return g;
}

function mergeParts(parts) {
  // Box and cylinder geometries share attributes, so a manual concat is enough.
  const pos = [], nrm = [], idx = [];
  let base = 0;
  for (const p of parts) {
    pos.push(...p.attributes.position.array);
    nrm.push(...p.attributes.normal.array);
    for (const i of p.index.array) idx.push(i + base);
    base += p.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
  out.setIndex(idx);
  return out;
}

export function createCarMesh(color = 0x2f7cff, id = "ego", styleIndex = null) {
  const style = id === "ego" ? "sedan" : STYLE_NAMES[styleIndex ?? Math.floor(hash01(id, 4) * 5)];
  const st = STYLES[style];
  const geo = styleGeometry(style);
  const g = new THREE.Group();
  // The body hangs from a pivot at the center of gravity, so it can pitch under braking and roll
  // in bends while the wheels stay on the road.
  const pivot = new THREE.Group();
  pivot.position.set(CG_X, CG_Y, 0);
  const body = new THREE.Group();
  body.position.set(-CG_X, -CG_Y, 0);
  pivot.add(body);
  g.add(pivot);
  const add = (geometry, material, shadow) => {
    const m = new THREE.Mesh(geometry, material);
    m.castShadow = shadow; m.receiveShadow = true;
    body.add(m);
    return m;
  };
  const tail = new THREE.MeshStandardMaterial({ color: 0x5a0808, emissive: 0xff1a0a, emissiveIntensity: 0.3, roughness: 0.15, metalness: 0.1 });
  add(geo.paint, paint(color), true);
  add(geo.glass, shared.glass, true);
  add(geo.trim, shared.trim, false);
  add(geo.chrome, shared.chrome, false);
  add(geo.plate, shared.plate, false);
  add(geo.head, shared.head, false);
  add(geo.drl, shared.drl, false);
  add(geo.tail, tail, false);
  const blinkers = { left: new THREE.Mesh(geo.blinkL, shared.blink), right: new THREE.Mesh(geo.blinkR, shared.blink) };
  blinkers.left.visible = blinkers.right.visible = false;
  body.add(blinkers.left, blinkers.right);

  const brake = [];
  for (const z of [-(W / 2 - 0.32), W / 2 - 0.32]) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xff1a0a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
    s.position.set(XR - 0.2, geo.tailY, z);
    s.scale.setScalar(0.8);
    s.visible = false;
    body.add(s);
    brake.push(s);
  }

  const blob = new THREE.Mesh(new THREE.PlaneGeometry(CAR.length + 0.5, W + 0.5).rotateX(-Math.PI / 2), shared.blob);
  blob.position.set((XR + XF) / 2, 0.02, 0);
  blob.renderOrder = 1;
  g.add(blob);
  // the patch of road the headlights light up at night (a real light only for the driven car)
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(16, 7).rotateX(-Math.PI / 2), shared.pool);
  pool.position.set(XF + 8, 0.03, 0);
  pool.renderOrder = 2;
  pool.visible = false;
  g.add(pool);

  const wg = wheelGeometry(st.tire);
  const wheels = [];
  for (const [lx, lz] of [[CAR.wheelbase, W / 2 - 0.17], [CAR.wheelbase, -W / 2 + 0.17], [0, W / 2 - 0.17], [0, -W / 2 + 0.17]]) {
    const pivot = new THREE.Group();   // steering turns the pivot; rolling spins the wheel inside it
    pivot.position.set(lx, st.tire, lz);
    const wheel = new THREE.Mesh(wg, [shared.tire, shared.rim]);
    wheel.castShadow = true;
    pivot.add(wheel);
    g.add(pivot);
    wheels.push({ pivot, wheel });
  }
  g.userData = { wheels, spin: 0, tire: st.tire, tail, brake, blinkers, prevV: 0, brakeLevel: 0, pivot, pitch: 0, roll: 0, pool, body };
  return g;
}

// The driven car's headlights: two real spot lights (one casts shadows), on only after dark or in
// poor weather.
export function addHeadlights(mesh) {
  const lights = [];
  for (const z of [-(W / 2 - 0.34), W / 2 - 0.34]) {
    const l = new THREE.SpotLight(0xfff1dc, 0, 70, 0.42, 0.55, 1.6);
    l.position.set(XF, 0.72, z);
    l.target.position.set(XF + 20, -0.6, z * 0.4);
    l.castShadow = lights.length === 0;
    l.shadow.mapSize.set(1024, 1024);
    l.shadow.bias = -0.0006;
    l.shadow.camera.near = 0.5;
    mesh.userData.body.add(l, l.target);
    lights.push(l);
  }
  mesh.userData.headlights = lights;
}

// Lights that follow the time of day: every car's headlamps and running lights, the ground they
// light, and the driven car's real spot lights.
export function syncCarLights(night, poorWeather = false) {
  const on = Math.max(night, poorWeather ? 0.6 : 0);
  shared.head.emissiveIntensity = 0.35 + on * 7;
  shared.pool.opacity = on * 0.55;
  return on;
}

export function syncCar(mesh, vehicle, dt = 0, t = 0, lightsOn = 0) {
  mesh.position.set(vehicle.x, 0, -vehicle.y);
  mesh.rotation.y = vehicle.psi;
  const u = mesh.userData;
  u.spin += (vehicle.v * dt) / u.tire;
  for (let i = 0; i < u.wheels.length; i++) {
    u.wheels[i].wheel.rotation.z = -u.spin;
    u.wheels[i].pivot.rotation.y = i < 2 ? vehicle.delta : 0;
  }
  // pitch and roll follow the car's accelerations through a soft suspension
  if (dt > 0) {
    const k = Math.min(1, dt * 8);
    u.pitch += ((vehicle.ax || 0) * PITCH_PER_MS2 - u.pitch) * k;
    u.roll += ((vehicle.latAccel || 0) * ROLL_PER_MS2 - u.roll) * k;
    u.pivot.rotation.set(u.roll, 0, u.pitch);
  }
  // indicators blink at about 75 per minute
  const on = (t % 0.8) < 0.45;
  u.blinkers.left.visible = on && vehicle.signal === "left";
  u.blinkers.right.visible = on && vehicle.signal === "right";
  u.pool.visible = lightsOn > 0.02;
  if (u.headlights) for (const l of u.headlights) l.intensity = lightsOn * 60;
  // brake lights: on while decelerating or held stopped; the tail lamps glow dimly at night
  if (dt > 0) {
    const decel = (u.prevV - vehicle.v) / dt;
    const target = decel > 0.6 || Math.abs(vehicle.v) < 0.15 ? 1 : 0;
    u.brakeLevel += (target - u.brakeLevel) * Math.min(1, dt * 12);
    u.prevV = vehicle.v;
    u.tail.emissiveIntensity = 0.3 + lightsOn * 1.5 + u.brakeLevel * (2.2 + lightsOn * 2);
    for (const s of u.brake) { s.material.opacity = u.brakeLevel * 0.5 + lightsOn * 0.25; s.visible = s.material.opacity > 0.02; }
  }
}

// Distant parked cars keep their body silhouette, glass and wheel colors, without tiny trim,
// beveled panels or individual spokes. The driven car and moving traffic always use full detail.
function distantCarGeometry(style) {
  const key = `distant-${style}`;
  if (geoCache.has(key)) return geoCache.get(key);
  const st = STYLES[style], roof = roofLine(st);
  const shape = { tumble: 0.06, tuck: 0.1, top: roof };
  const geo = {
    paint: merge([
      extrude(bodyOutline(st), W, 0, shape),
      extrude(clipAbove(st.glass, roof), W * 0.86 + 0.02, 0, { tumble: 0.16, top: roof + 0.05 }),
      box(0.12, roof - st.belt + 0.02, W * 0.8, st.pillar, (st.belt + roof) / 2, 0),
    ]),
    glass: extrude(st.glass, W * 0.86, 0, { tumble: 0.16, top: roof + 0.05 }),
    trim: box(CAR.length - 0.5, 0.12, W - 0.1, (XR + XF) / 2, st.sill - 0.02, 0),
    wheels: mergeGeometries([
      new THREE.CylinderGeometry(st.tire, st.tire, 0.24, 10).rotateX(Math.PI / 2).toNonIndexed(),
      new THREE.CylinderGeometry(st.tire * 0.66, st.tire * 0.66, 0.25, 10).rotateX(Math.PI / 2).toNonIndexed(),
    ], true),
  };
  geoCache.set(key, geo);
  return geo;
}

// Parked parts are instanced per chunk to keep draw calls low as the camera crosses the city.
// Both detail levels retain instance references, so a pull-out removes the car at any distance.
const PARKED_CHUNK = 360;
const STYLE_NAMES = ["sedan", "sedan", "hatch", "suv", "suv"];
export function buildParkedCars(cars) {
  const group = new THREE.Group();
  const white = snowable(new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0.5, roughness: 0.32, clearcoat: 1.0, clearcoatRoughness: 0.06 }), "car");
  const tailOff = new THREE.MeshStandardMaterial({ color: 0x4a0606, roughness: 0.25 });
  const headOff = new THREE.MeshStandardMaterial({ color: 0xc9d0d8, roughness: 0.15, metalness: 0.3 });
  const chunks = new Map();
  for (const car of cars) {
    const key = `${Math.floor(car.x / PARKED_CHUNK)},${Math.floor(car.y / PARKED_CHUNK)}|${STYLE_NAMES[car.style || 0]}`;
    if (!chunks.has(key)) chunks.set(key, []);
    chunks.get(key).push(car);
  }
  const Y = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
  for (const [key, list] of chunks) {
    const style = key.split("|")[1];
    const st = STYLES[style], geo = styleGeometry(style), distant = distantCarGeometry(style);
    const near = new THREE.Group(), far = new THREE.Group();
    const mats = list.map((c) => new THREE.Matrix4().compose(new THREE.Vector3(c.x, 0, -c.y), new THREE.Quaternion().setFromAxisAngle(Y, c.psi), one));
    for (const c of list) c.instances = [];
    const emit = (level, geometry, material, matrices, colors = null, shadow = false) => {
      const mesh = new THREE.InstancedMesh(geometry, material, matrices.length);
      const per = matrices.length / list.length;   // 1, or 4 for the wheels
      matrices.forEach((m, i) => { mesh.setMatrixAt(i, m); if (colors) mesh.setColorAt(i, colors[i]); list[Math.floor(i / per)].instances.push({ mesh, i }); });
      mesh.castShadow = shadow;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      level.add(mesh);
    };
    const colors = list.map((c) => new THREE.Color(c.color));
    emit(near, geo.paint, white, mats, colors, true);
    emit(near, geo.glass, shared.glass, mats, null, true);
    emit(near, geo.trim, shared.trim, mats);
    emit(near, geo.chrome, shared.chrome, mats);
    emit(near, geo.plate, shared.plate, mats);
    emit(near, geo.head, headOff, mats);
    emit(near, geo.tail, tailOff, mats);
    const wheels = [];
    for (const m of mats) {
      for (const [lx, lz] of [[CAR.wheelbase, W / 2 - 0.17], [CAR.wheelbase, -W / 2 + 0.17], [0, W / 2 - 0.17], [0, -W / 2 + 0.17]]) {
        wheels.push(m.clone().multiply(new THREE.Matrix4().makeTranslation(lx, st.tire, lz)));
      }
    }
    emit(near, wheelGeometry(st.tire), [shared.tire, shared.rim], wheels);
    emit(far, distant.paint, white, mats, colors, true);
    emit(far, distant.glass, shared.glass, mats, null, true);
    emit(far, distant.trim, shared.trim, mats);
    emit(far, distant.wheels, [shared.tire, shared.rim], wheels);
    group.add(chunkLOD(near, far));
  }
  group.userData.count = cars.length;
  return group;
}

// A parked car has pulled out: collapse its instances (it is drawn as traffic from now on).
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);
export function hideParkedCar(car) {
  for (const { mesh, i } of car.instances || []) { mesh.setMatrixAt(i, HIDDEN); mesh.instanceMatrix.needsUpdate = true; }
}

// Street-side door panel: match the simulation hinge, angle, length and thickness exactly.
export function createDoorMesh(car) {
  const group = new THREE.Group();
  const swing = new THREE.Group();
  const panel = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.65, 0.12), paint(car.color));
  panel.position.y = 0.72;
  const window = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.38, 0.07), shared.glass);
  window.position.y = 1.2;
  swing.add(panel, window);
  // Parked bodies are batched geometry. Cover the closed panel with a recessed dark cabin
  // opening while its separate door swings, without rebuilding thousands of instances.
  const opening = new THREE.Mesh(new THREE.BoxGeometry(1.08, 0.85, 0.025), shared.trim);
  opening.position.set(1.55, 0.84, (car.curb === "right" ? -1 : 1) * (W / 2 + 0.015));
  group.add(opening, swing);
  group.userData.swing = swing;
  panel.castShadow = window.castShadow = true;
  return group;
}

export function syncDoor(mesh, door) {
  const car = door.owner, dx = door.x - car.x, dy = door.y - car.y;
  mesh.position.set(car.x, 0, -car.y);
  mesh.rotation.y = car.psi;
  const swing = mesh.userData.swing;
  swing.position.set(dx * Math.cos(car.psi) + dy * Math.sin(car.psi), 0, dx * Math.sin(car.psi) - dy * Math.cos(car.psi));
  swing.rotation.y = door.psi - car.psi;
}

// A cyclist: a bicycle (two wheels, a diamond frame, bars, saddle) and a rider whose legs pedal
// with the wheels. Local +X is forward from the rear axle, as for the cars.
const bikeShared = {
  tire: new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9 }),
  metal: new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 0.8, roughness: 0.35 }),
  helmet: new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.4 }),
};
const rod = (x0, y0, x1, y1, r = 0.022) => {
  const len = Math.hypot(x1 - x0, y1 - y0);
  const g = new THREE.CylinderGeometry(r, r, len, 6);
  g.rotateZ(Math.atan2(y1 - y0, x1 - x0) - Math.PI / 2);
  return g.translate((x0 + x1) / 2, (y0 + y1) / 2, 0);
};
export function createBikeMesh(color = 0x2b6cb0, look = 0) {
  const g = new THREE.Group();
  const R = 0.34, wb = 1.05;
  const frameMat = new THREE.MeshStandardMaterial({ color, metalness: 0.5, roughness: 0.35 });
  const wheels = [];
  for (const x of [0, wb]) {
    const w = new THREE.Mesh(new THREE.TorusGeometry(R, 0.025, 6, 24), bikeShared.tire);
    w.position.set(x, R, 0);
    g.add(w);
    wheels.push(w);
  }
  const crank = [0.45, 0.3], seat = [0.3, 0.85], head = [0.92, 0.82];
  const frame = mergeGeometries([
    rod(0, R, crank[0], crank[1]), rod(0, R, seat[0], seat[1]), rod(crank[0], crank[1], seat[0], seat[1]),
    rod(crank[0], crank[1], head[0], head[1] - 0.08), rod(seat[0], seat[1] - 0.05, head[0], head[1]),
    rod(head[0], head[1], wb, R), rod(head[0], head[1], head[0] - 0.05, head[1] + 0.18),
  ], false);
  g.add(new THREE.Mesh(frame, frameMat));
  const bars = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.55, 6).rotateX(Math.PI / 2).translate(head[0] - 0.05, head[1] + 0.18, 0), bikeShared.metal);
  g.add(bars);
  // rider: a person in the saddle, leaning over the bars, pedaling
  const rider = createPersonMesh(look);
  rider.position.set(seat[0] - 0.05, seat[1] + 0.02 - 0.92 * rider.scale.y, 0);
  poseRider(rider, 0);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1.15, 0.9, 1), bikeShared.helmet);
  helmet.position.set(0, 1.77 - 0.92, 0);   // on the head, in the rider's hip frame
  rider.userData.body.add(helmet);
  g.add(rider);
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.6).rotateX(-Math.PI / 2), shared.blob);
  blob.position.set(wb / 2, 0.02, 0);
  g.add(blob);
  g.traverse((m) => { if (m.isMesh && m !== blob) { m.castShadow = true; m.receiveShadow = true; } });
  g.userData = { bike: true, wheels, rider, spin: 0, crank: 0 };
  return g;
}

export function syncBike(mesh, vehicle, dt = 0) {
  mesh.position.set(vehicle.x, 0, -vehicle.y);
  mesh.rotation.y = vehicle.psi;
  // lean into turns: tan(lean) = v^2 * curvature / g
  mesh.rotation.x = Math.atan((vehicle.latAccel || 0) / 9.81) * -0.9;
  const u = mesh.userData;
  u.spin += (vehicle.v * dt) / 0.34;
  for (const w of u.wheels) w.rotation.z = -u.spin;
  u.crank += (vehicle.v * dt) / 0.34 * 0.55;
  poseRider(u.rider, u.crank);
}
