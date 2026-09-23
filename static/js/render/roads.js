// Streets: asphalt, curbs, boulevards, sidewalks, junction fills, lane markings, stop lines and
// crosswalks, traffic-signal mast arms, stop signs, and street lights.
//
// Ground layers are painted in a fixed order (see LAYER in scene.js): sidewalk < curb < asphalt <
// markings. Where one street's sidewalk runs into another street, the other street's asphalt is
// painted over it, which is what a real intersection looks like.

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { pointAt, headingAt } from "../map/mapdata.js";
import { GeoBuilder } from "./geo.js";
import { LAYER, groundLayer, toThree } from "./scene.js";
import { asphaltTexture, concreteTexture, curbTexture, glowTexture, stopSignTexture, withMacroVariation } from "./textures.js";

const GUTTER = 0.3;         // painted asphalt beyond the outermost lane
const CURB = 0.22;
const STREET = {            // boulevard (grass between curb and sidewalk) and sidewalk widths, m
  residential: [1.8, 1.5], living_street: [1.2, 1.5], tertiary: [1.2, 1.9], unclassified: [1.2, 1.6],
  secondary: [0.0, 2.6], primary: [0.0, 3.2],
};
const streetOf = (e) => STREET[e.cls.replace("_link", "")] || [1.0, 1.8];
const ARTERIAL = new Set(["primary", "secondary", "tertiary", "primary_link", "secondary_link", "tertiary_link"]);
const Y_AXIS = new THREE.Vector3(0, 1, 0);

const surfaceHalf = (e) => Math.max(Math.abs(e.asphalt[0]), Math.abs(e.asphalt[1])) + GUTTER;

// Groups the directed edges into drawn streets (a two-way street is two edges) and computes, per
// node, the widest street meeting there.
function analyze(map) {
  const streets = [];
  const seen = new Map();
  for (const e of map.edges.values()) {
    const key = [e.from, e.to].sort().join("|") + "|" + Math.round(e.length);
    if (seen.has(key)) { seen.get(key).twin = e; continue; }
    const st = { edge: e, twin: null };
    seen.set(key, st);
    streets.push(st);
  }
  const legs = new Map();  // node id -> [{street, dir: +1 leaving from pts[0] | -1 arriving at pts[n-1]}]
  for (const st of streets) {
    const e = st.edge;
    if (!legs.has(e.from)) legs.set(e.from, []);
    if (!legs.has(e.to)) legs.set(e.to, []);
    legs.get(e.from).push({ st, out: true });
    legs.get(e.to).push({ st, out: false });
  }
  const nodeR = new Map();
  for (const [id, list] of legs) nodeR.set(id, Math.max(...list.map((l) => surfaceHalf(l.st.edge))));
  return { streets, legs, nodeR };
}

// Half the surface width of the widest other street at an edge's end node.
function crossingHalf(map, e) {
  let w = 0;
  for (const id of [...(map.inn.get(e.to) || []), ...(map.out.get(e.to) || [])]) {
    const o = map.edges.get(id);
    if ((o.from === e.from && o.to === e.to) || (o.from === e.to && o.to === e.from)) continue;
    w = Math.max(w, surfaceHalf(o));
  }
  return w;
}

// Leg of a street leaving a node: a point `d` meters out and the heading away from the node.
function legFrame(e, out, d) {
  const L = e.cum[e.cum.length - 1];
  const s = out ? Math.min(d, L * 0.5) : Math.max(L - d, L * 0.5);
  const p = pointAt(e.pts, e.cum, s);
  let h = headingAt(e.pts, e.cum, s);
  if (!out) h += Math.PI;
  return { p, h };
}

function hull(points) {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const p of pts) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
  upper.pop(); lower.pop();
  return lower.concat(upper);
}

export function buildRoads(map) {
  const group = new THREE.Group();
  const { streets, legs, nodeR } = analyze(map);
  const asphalt = new GeoBuilder(), curb = new GeoBuilder(), walk = new GeoBuilder();
  const white = new GeoBuilder(), yellow = new GeoBuilder();

  for (const st of streets) {
    const e = st.edge;
    const L = e.cum[e.cum.length - 1];
    const lo = e.asphalt[0] - GUTTER, hi = e.asphalt[1] + GUTTER;
    asphalt.ribbon(e.pts, lo, hi, 0, { scale: 7 });
    const [blvd, side] = streetOf(e);
    for (const sign of [1, -1]) {
      const edge = sign > 0 ? hi : lo;
      const a = edge, b = edge + sign * CURB;
      curb.ribbon(e.pts, Math.min(a, b), Math.max(a, b), 0, { uv: "along", scale: 1.2 });
      const w0 = b + sign * blvd, w1 = w0 + sign * side;
      walk.ribbon(e.pts, Math.min(w0, w1), Math.max(w0, w1), 0, { uv: "along", scale: 1.5 });
    }
    // markings stay out of junctions and stop short of stop lines
    let from = trimAt(nodeR, legs, e.from), to = L - trimAt(nodeR, legs, e.to);
    if (e.control) to = Math.min(to, e.control.s_line - 0.6);
    if (st.twin && st.twin.control) from = Math.max(from, st.twin.cum[st.twin.cum.length - 1] - st.twin.control.s_line + 0.6);
    if (to - from > 2) {
      if (st.twin && ARTERIAL.has(e.cls)) {
        yellow.ribbon(e.pts, -0.2, -0.08, 0, { from, to });
        yellow.ribbon(e.pts, 0.08, 0.2, 0, { from, to });
      }
      laneDashes(white, e, from, to);
      if (st.twin) laneDashes(white, st.twin, st.twin.cum[st.twin.cum.length - 1] - to, st.twin.cum[st.twin.cum.length - 1] - from);
    }
  }

  // junction fills: hull of each leg's cross-section a little way out from the node
  for (const [id, list] of legs) {
    const node = map.nodes.get(id);
    if (!node || list.length < 2) continue;
    if (list.length === 2) {
      const [a, b] = list.map((l) => legFrame(l.st.edge, l.out, 1).h);
      const bend = Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
      if (bend > Math.PI - 0.12) continue;  // straight through: ribbons already meet
    }
    const r = nodeR.get(id);
    const pts = [[node.x, node.y]];
    for (const l of list) {
      const half = surfaceHalf(l.st.edge);
      const { p, h } = legFrame(l.st.edge, l.out, r + 0.5);
      const nx = Math.sin(h), ny = -Math.cos(h);
      pts.push([p[0] + nx * half, p[1] + ny * half], [p[0] - nx * half, p[1] - ny * half]);
    }
    asphalt.polygon(hull(pts), 0, { scale: 7 });
  }

  // stop lines and, at signals, crosswalks
  for (const e of map.edges.values()) {
    const c = e.control;
    if (!c) continue;
    const L = e.cum[e.cum.length - 1];
    const left = e.oneway ? e.asphalt[0] + 0.15 : 0.12, right = e.asphalt[1] + GUTTER - 0.1;
    stopBar(white, e, c.s_line, left, right, c.type === "signal" ? 0.6 : 0.5);
    if (c.type === "signal" && c.s_line + 4.2 < L) crosswalk(white, e, c.s_line + 1.0, c.s_line + 4.0);
  }

  const asphaltMat = withMacroVariation(new THREE.MeshStandardMaterial({ map: asphaltTexture(), roughness: 0.92, metalness: 0 }), 0.05, 0.22);
  add(group, asphalt, asphaltMat, LAYER.asphalt);
  add(group, curb, new THREE.MeshStandardMaterial({ map: curbTexture(), roughness: 0.85, color: 0xb4b4b0 }), LAYER.curb);
  add(group, walk, withMacroVariation(new THREE.MeshStandardMaterial({ map: concreteTexture(), roughness: 0.9 }), 0.07, 0.15), LAYER.sidewalk);
  add(group, white, new THREE.MeshStandardMaterial({ color: 0xe6e6df, roughness: 0.6 }), LAYER.marking);
  add(group, yellow, new THREE.MeshStandardMaterial({ color: 0xe0b52c, roughness: 0.6 }), LAYER.marking);

  const signals = buildSignals(map, group);
  buildStopSigns(map, group);
  buildStreetLights(map, group, streets, nodeR, legs);
  return { group, signals, streets, nodeR, legs };
}

function trimAt(nodeR, legs, id) {
  const list = legs.get(id) || [];
  return list.length >= 3 ? nodeR.get(id) + 1.0 : list.length === 2 ? 0.5 : 0;
}

function add(group, builder, material, order) {
  if (builder.empty) return;
  const mesh = new THREE.Mesh(builder.toGeometry(), material);
  groundLayer(mesh, order);
  group.add(mesh);
}

// White dashes between same-direction lanes (3 m paint, 6 m gap).
function laneDashes(white, e, from, to) {
  for (let i = 1; i < e.lanes; i++) {
    const lat = (e.lane_offsets[i - 1] + e.lane_offsets[i]) / 2;
    for (let s = from + 1; s + 3 <= to; s += 9) white.ribbon(e.pts, lat - 0.075, lat + 0.075, 0, { from: s, to: s + 3 });
  }
}

function stopBar(white, e, s, left, right, thickness) {
  const p = pointAt(e.pts, e.cum, s), h = headingAt(e.pts, e.cum, s);
  const mid = (left + right) / 2;
  white.rect(p[0] + Math.sin(h) * mid, p[1] - Math.cos(h) * mid, h, thickness, right - left);
}

// Continental crosswalk: bars parallel to traffic across the whole roadway.
function crosswalk(white, e, s0, s1) {
  const s = (s0 + s1) / 2, len = s1 - s0;
  const p = pointAt(e.pts, e.cum, s), h = headingAt(e.pts, e.cum, s);
  const lo = e.asphalt[0], hi = e.asphalt[1];
  for (let lat = lo + 0.5; lat <= hi - 0.3; lat += 1.2) {
    white.rect(p[0] + Math.sin(h) * lat, p[1] - Math.cos(h) * lat, h, len, 0.55);
  }
}

// Place a geometry at sim (x, y, z) turned to heading h; local +x = heading, +z = right of it.
function placed(geo, x, y, z, h, local = null) {
  const m = new THREE.Matrix4().compose(toThree(x, y, z), new THREE.Quaternion().setFromAxisAngle(Y_AXIS, h), new THREE.Vector3(1, 1, 1));
  if (local) m.multiply(local);
  return geo.clone().applyMatrix4(m);
}
const T = (x, y, z) => new THREE.Matrix4().makeTranslation(x, y, z);

const metal = () => new THREE.MeshStandardMaterial({ color: 0x4a4f55, roughness: 0.45, metalness: 0.7 });

// Far-side mast arms: a pole on the far right corner of each approach with one head over each lane,
// the Vancouver style of yellow heads on black backplates.
function buildSignals(map, group) {
  const pole = new THREE.CylinderGeometry(0.13, 0.17, 6.4, 12).translate(0, 3.2, 0);
  const arm = (len) => new THREE.CylinderGeometry(0.07, 0.1, len, 8).rotateX(Math.PI / 2).translate(0, 6.1, -len / 2);
  const housing = new THREE.BoxGeometry(0.36, 1.08, 0.4);
  const backplate = new THREE.BoxGeometry(0.03, 1.42, 0.78);
  const hanger = new THREE.BoxGeometry(0.06, 0.4, 0.06);
  const hood = new THREE.BoxGeometry(0.22, 0.03, 0.34);
  const lens = new THREE.CircleGeometry(0.135, 20).rotateY(-Math.PI / 2);
  const poles = [], housings = [], plates = [];
  const lampGeos = new Map();   // "inter|group|color" -> geometries
  const sprites = new Map();    // "inter|group|color" -> sprites
  const colors = { red: 0xff2a1a, yellow: 0xffb21a, green: 0x1aff8c };
  const glowMats = Object.fromEntries(Object.entries(colors).map(([k, c]) => [k, new THREE.SpriteMaterial({
    map: glowTexture(), color: c, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.9,
  })]));
  for (const inter of map.intersections.values()) {
    for (const a of inter.approaches) {
      const e = map.edges.get(a.edge);
      if (!e) continue;
      const L = e.cum[e.cum.length - 1];
      const end = e.pts[e.pts.length - 1];
      const h = headingAt(e.pts, e.cum, L - 0.5);
      const ahead = crossingHalf(map, e) + 2.2;
      const poleLat = e.asphalt[1] + GUTTER + CURB + 1.0;
      const px = end[0] + Math.cos(h) * ahead + Math.sin(h) * poleLat;
      const py = end[1] + Math.sin(h) * ahead - Math.cos(h) * poleLat;
      const lanes = e.lane_offsets.slice(0, 3);
      const reach = poleLat - Math.min(...lanes) + 0.6;
      poles.push(placed(pole, px, py, 0, h), placed(arm(reach), px, py, 0, h));
      const heads = lanes.map((off) => poleLat - off);
      heads.push(0.35);  // a second head on the pole, at eye level
      heads.forEach((dz, i) => {
        const onPole = i === heads.length - 1;
        const y = onPole ? 3.4 : 5.25, z = onPole ? -0.35 : -dz;
        const x = onPole ? -0.2 : 0;
        housings.push(placed(housing, px, py, 0, h, T(x, y, z)));
        plates.push(placed(backplate, px, py, 0, h, T(x + 0.2, y, z)));
        if (!onPole) poles.push(placed(hanger, px, py, 0, h, T(x, 5.9, z)));
        ["red", "yellow", "green"].forEach((name, k) => {
          const ly = y + 0.34 - k * 0.34;
          housings.push(placed(hood, px, py, 0, h, T(x - 0.28, ly + 0.15, z)));
          const key = `${inter.id}|${a.group}|${name}`;
          if (!lampGeos.has(key)) { lampGeos.set(key, []); sprites.set(key, []); }
          lampGeos.get(key).push(placed(lens, px, py, 0, h, T(x - 0.185, ly, z)));
          const sp = new THREE.Sprite(glowMats[name]);
          const wp = new THREE.Vector3(x - 0.3, ly, z).applyMatrix4(new THREE.Matrix4().compose(toThree(px, py, 0), new THREE.Quaternion().setFromAxisAngle(Y_AXIS, h), new THREE.Vector3(1, 1, 1)));
          sp.position.copy(wp);
          sp.scale.setScalar(1.1);
          sp.visible = false;
          group.add(sp);
          sprites.get(key).push(sp);
        });
      });
    }
  }
  const addMerged = (geos, mat, shadow = true) => {
    if (!geos.length) return;
    const mesh = new THREE.Mesh(mergeGeometries(geos, false), mat);
    mesh.castShadow = shadow; mesh.receiveShadow = true;
    group.add(mesh);
  };
  addMerged(poles, metal());
  addMerged(housings, new THREE.MeshStandardMaterial({ color: 0xd7a91e, roughness: 0.55, metalness: 0.1 }));
  addMerged(plates, new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.7 }));
  const lampMats = new Map();
  for (const [key, geos] of lampGeos) {
    const name = key.split("|")[2];
    const mat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, emissive: colors[name], emissiveIntensity: 0.04, roughness: 0.3 });
    lampMats.set(key, mat);
    addMerged(geos, mat, false);
  }
  const last = new Map();
  return {
    set(intersectionId, phaseByGroup) {
      for (const g of ["A", "B"]) {
        const state = phaseByGroup[g] || "red";
        const key = `${intersectionId}|${g}`;
        if (last.get(key) === state) continue;
        last.set(key, state);
        for (const name of ["red", "yellow", "green"]) {
          const mat = lampMats.get(`${key}|${name}`);
          if (!mat) continue;
          const on = name === state;
          mat.emissiveIntensity = on ? 5 : 0.04;
          mat.color.setHex(on ? colors[name] : 0x1a1a1a);
          for (const sp of sprites.get(`${key}|${name}`)) sp.visible = on;
        }
      }
    },
  };
}

function octagon(r, facing) {
  // in the local YZ plane facing -x (facing = -1) or +x (+1); u runs along +z seen from the front
  const pos = [0, 0, 0], uv = [0.5, 0.5], idx = [];
  for (let i = 0; i < 8; i++) {
    const a = Math.PI / 8 + (i * Math.PI) / 4;
    pos.push(0, Math.sin(a) * r, -facing * Math.cos(a) * r);
    uv.push(0.5 + Math.cos(a) / 2, 0.5 + Math.sin(a) / 2);
  }
  for (let i = 0; i < 8; i++) idx.push(0, 1 + i, 1 + ((i + 1) % 8));
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function buildStopSigns(map, group) {
  const pole = new THREE.CylinderGeometry(0.035, 0.035, 2.35, 8).translate(0, 1.175, 0);
  const face = octagon(0.38, -1).translate(-0.07, 2.25, 0);
  const back = octagon(0.38, 1).translate(-0.06, 2.25, 0);
  const poles = [], faces = [], backs = [];
  for (const stop of map.stops.values()) {
    const e = map.edges.get(stop.edge);
    if (!e) continue;
    const s = Math.min(stop.s_line + 0.4, e.cum[e.cum.length - 1]);
    const p = pointAt(e.pts, e.cum, s), h = headingAt(e.pts, e.cum, s);
    const lat = e.asphalt[1] + GUTTER + CURB + 0.7;
    const x = p[0] + Math.sin(h) * lat, y = p[1] - Math.cos(h) * lat;
    poles.push(placed(pole, x, y, 0, h));
    faces.push(placed(face, x, y, 0, h));
    backs.push(placed(back, x, y, 0, h));
  }
  if (!poles.length) return;
  const mk = (geos, mat) => { const m = new THREE.Mesh(mergeGeometries(geos, false), mat); m.castShadow = true; m.receiveShadow = true; group.add(m); };
  mk(poles, new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.4, metalness: 0.8 }));
  mk(faces, new THREE.MeshStandardMaterial({ map: stopSignTexture(), roughness: 0.45, emissive: 0x220000, emissiveIntensity: 0.3 }));
  mk(backs, new THREE.MeshStandardMaterial({ color: 0x8d9298, roughness: 0.5, metalness: 0.6 }));
}

// Cobra-head street lights along arterials, on the right of each direction every ~38 m.
function buildStreetLights(map, group, streets, nodeR, legs) {
  const parts = [
    new THREE.CylinderGeometry(0.08, 0.13, 8.2, 8).translate(0, 4.1, 0),
    new THREE.CylinderGeometry(0.045, 0.05, 2.2, 6).rotateX(Math.PI / 2).rotateX(-0.12).translate(0, 8.25, -1.05),
    new THREE.BoxGeometry(0.34, 0.16, 0.7).translate(0, 8.3, -2.3),
  ];
  const geo = mergeGeometries(parts.map((p) => p.toNonIndexed()), false);
  const spots = [];
  for (const st of streets) {
    for (const e of [st.edge, st.twin]) {
      if (!e || !ARTERIAL.has(e.cls)) continue;
      const L = e.cum[e.cum.length - 1];
      const from = trimAt(nodeR, legs, e.from) + 4, to = L - trimAt(nodeR, legs, e.to) - 6;
      const lat = e.asphalt[1] + GUTTER + CURB + 0.45;
      for (let s = from + 6; s < to; s += 38) {
        const p = pointAt(e.pts, e.cum, s), h = headingAt(e.pts, e.cum, s);
        spots.push([p[0] + Math.sin(h) * lat, p[1] - Math.cos(h) * lat, h]);
      }
    }
  }
  if (!spots.length) return;
  const mesh = new THREE.InstancedMesh(geo, metal(), spots.length);
  const q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), m = new THREE.Matrix4();
  spots.forEach(([x, y, h], i) => { q.setFromAxisAngle(Y_AXIS, h); mesh.setMatrixAt(i, m.compose(toThree(x, y, 0), q, one)); });
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.computeBoundingSphere();
  group.add(mesh);
}
