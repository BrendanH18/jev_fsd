// Streets: asphalt, curbs, boulevards, sidewalks, junction fills, lane markings, stop lines and
// crosswalks, traffic-signal mast arms, stop signs, and street lights (citylights.js).
//
// Ground layers are painted in a fixed order (see LAYER in scene.js): sidewalk < curb < asphalt <
// markings. Where one street's sidewalk runs into another street, the other street's asphalt is
// painted over it, which is what a real intersection looks like.

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { pointAt, headingAt } from "../map/mapdata.js";
import { GeoBuilder, RibbonPath } from "./geo.js";
import { LAYER, groundLayer, toThree } from "./scene.js";
import {
  asphaltTexture,
  concreteTexture,
  crosswalkSignTexture,
  zoneSignTexture,
  curbTexture,
  grassTexture,
  stopSignTexture,
  withMacroVariation,
  walkSignalTexture,
  handSignalTexture,
  leftArrowTexture,
} from "./textures.js";
import { snowable } from "./weather.js";
import { buildStreetLights } from "./citylights.js";
import { wetReflective } from "./reflection.js";
import { SignalBatch, signalGlowMaterial, signalLensMaterial } from "./signal-lamps.js";

import { GUTTER, CURB, streetOf } from "../map/streets.js";
import { sceneryFor, analyzeStreets, trimAt } from "../map/scenery.js";
import { junctionFills } from "../map/junctions.js";
const ARTERIAL = new Set(["primary", "secondary", "tertiary", "primary_link", "secondary_link", "tertiary_link"]);
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const SIGNAL_MASKS = { dark: 0, red: 1, yellow: 2, green: 4, arrow_yellow: 9, arrow_green: 16, arrow: 17 };
const FLASH_MASKS = { flashing_red: 1, flashing_amber: 2, advance: 4 };

export function buildRoads(map) {
  const group = new THREE.Group();
  const { streets, legs, nodeR } = analyzeStreets(map);
  const chunks = new Map();
  function chunk([x, y]) {
    const key = `${Math.floor(x / 260)},${Math.floor(y / 260)}`;
    if (!chunks.has(key))
      chunks.set(key, {
        asphalt: new GeoBuilder(),
        curb: new GeoBuilder(),
        walk: new GeoBuilder(),
        curbFace: new GeoBuilder(),
        white: new GeoBuilder(),
        yellow: new GeoBuilder(),
        islandCurb: new GeoBuilder(),
        island: new GeoBuilder(),
      });
    return chunks.get(key);
  }
  const edgeChunk = (e) => chunk(e.pts[e.pts.length >> 1]);

  for (const st of streets) {
    const e = st.edge;
    const { asphalt, curb, walk, white, yellow } = edgeChunk(e);
    const path = new RibbonPath(e.pts);
    const L = e.cum[e.cum.length - 1];
    const lo = e.asphalt[0] - GUTTER,
      hi = e.asphalt[1] + GUTTER;
    asphalt.ribbon(path, lo, hi, 0, { scale: 7 });
    const [blvd, side] = streetOf(e);
    for (const sign of [1, -1]) {
      const edge = sign > 0 ? hi : lo;
      const a = edge,
        b = edge + sign * CURB;
      curb.ribbon(path, Math.min(a, b), Math.max(a, b), 0, { uv: "along", scale: 1.2 });
      const w0 = b + sign * blvd,
        w1 = w0 + sign * side;
      walk.ribbon(path, Math.min(w0, w1), Math.max(w0, w1), 0, { uv: "along", scale: 1.5 });
    }
    // markings stay out of junctions and stop short of stop lines
    let from = trimAt(nodeR, legs, e.from),
      to = L - trimAt(nodeR, legs, e.to);
    if (e.control) to = Math.min(to, e.control.s_line - 0.6);
    if (st.twin?.control) from = Math.max(from, st.twin.cum[st.twin.cum.length - 1] - st.twin.control.s_line + 0.6);
    if (to - from > 2) {
      if (st.twin && ARTERIAL.has(e.cls)) {
        yellow.ribbon(path, -0.2, -0.08, 0, { from, to });
        yellow.ribbon(path, 0.08, 0.2, 0, { from, to });
      }
      laneDashes(white, e, from, to, path);
      if (st.twin)
        laneDashes(
          white,
          st.twin,
          st.twin.cum[st.twin.cum.length - 1] - to,
          st.twin.cum[st.twin.cum.length - 1] - from,
        );
    }
  }

  // raised curbs: a 15 cm face along each side of the street between junctions (the flat curb
  // strip above is its top); they stop at the junction mouths
  for (const st of streets) {
    const e = st.edge;
    const L = e.cum[e.cum.length - 1];
    const from = trimAt(nodeR, legs, e.from) + 1.5,
      to = L - trimAt(nodeR, legs, e.to) - 1.5;
    if (to - from < 3) continue;
    const { curbFace } = edgeChunk(e);
    const lo = e.asphalt[0] - GUTTER,
      hi = e.asphalt[1] + GUTTER;
    for (const [lat, sign] of [
      [hi, 1],
      [lo, -1],
    ]) {
      let prev = null;
      for (let s0 = from; s0 <= to + 1e-6; s0 = Math.min(to, s0 + 2) + (s0 >= to ? 1 : 0)) {
        const p = pointAt(e.pts, e.cum, s0),
          h = headingAt(e.pts, e.cum, s0);
        const nx = Math.sin(h),
          ny = -Math.cos(h);
        const a = [p[0] + nx * lat, p[1] + ny * lat],
          b = [p[0] + nx * (lat + sign * CURB), p[1] + ny * (lat + sign * CURB)];
        if (prev) {
          const face = [-nx * sign, -ny * sign, 0]; // faces the road
          curbFace.quad(
            [prev.a[0], prev.a[1], 0],
            [a[0], a[1], 0],
            [a[0], a[1], 0.15],
            [prev.a[0], prev.a[1], 0.15],
            null,
            null,
            face,
          );
          curbFace.quad(
            [prev.a[0], prev.a[1], 0.15],
            [a[0], a[1], 0.15],
            [b[0], b[1], 0.15],
            [prev.b[0], prev.b[1], 0.15],
            null,
            null,
            [0, 0, 1],
          );
        }
        prev = { a, b };
        if (s0 >= to) break;
      }
    }
  }

  // roundabouts: a disc of asphalt out to the ring's outer edge; the island is painted over it
  for (const rb of (map.roundabouts || new Map()).values()) {
    const { asphalt, islandCurb, island } = chunk([rb.x, rb.y]);
    asphalt.polygon(circle(rb.x, rb.y, rb.outer_r + GUTTER, 40), 0, { scale: 7 });
    if (rb.island_r > 0) islandCurb.polygon(circle(rb.x, rb.y, rb.island_r, 32), 0);
    if (rb.island_r > 0.3) island.polygon(circle(rb.x, rb.y, rb.island_r - 0.3, 32), 0, { scale: 14 });
  }

  // junction fills: hull of each leg's cross-section a little way out from the node (map/junctions.js,
  // which the driving checks count as road too)
  for (const { poly } of junctionFills(map)) chunk(poly[0]).asphalt.polygon(poly, 0, { scale: 7 });

  // stop lines and, at signals, crosswalks
  for (const e of map.edges.values()) {
    const c = e.control;
    if (!c) continue;
    const { white } = edgeChunk(e);
    const L = e.cum[e.cum.length - 1];
    const left = e.oneway ? e.asphalt[0] + 0.15 : 0.12,
      right = e.asphalt[1] + GUTTER - 0.1;
    if (c.type === "yield") {
      sharkTeeth(white, e, c.s_line, left, right - (e.parking ? e.parking[1] : 0));
      continue;
    }
    stopBar(white, e, c.s_line, left, right, c.type === "signal" ? 0.6 : 0.5);
    if (c.type === "signal" && c.s_line + 4.2 < L) crosswalk(white, e, c.s_line + 1.0, c.s_line + 4.0);
  }
  // marked crosswalks between junctions (jev/osm/crossings.py): bars along the traffic, or two lines
  // across it, 3 m apart
  for (const c of map.crosswalks || []) {
    const e = map.edges.get(c.edge);
    if (!e) continue;
    const { white } = edgeChunk(e);
    if (c.markings === "lines")
      for (const s of [c.s - 1.5, c.s + 1.5]) stopBar(white, e, s, e.asphalt[0], e.asphalt[1], 0.3);
    else crosswalk(white, e, c.s - 1.5, c.s + 1.5);
  }

  // Chunks share their layer materials, but cull independently in the view and shadow passes.
  const surfaces = {
    asphalt: [
      LAYER.asphalt,
      () =>
        wetReflective(
          snowable(
            withMacroVariation(
              new THREE.MeshStandardMaterial({ map: asphaltTexture(), roughness: 0.92, metalness: 0 }),
              0.05,
              0.22,
            ),
            "asphalt",
          ),
          1,
        ),
    ],
    curb: [LAYER.curb, curbMaterial],
    walk: [
      LAYER.sidewalk,
      () =>
        wetReflective(
          snowable(
            withMacroVariation(new THREE.MeshStandardMaterial({ map: concreteTexture(), roughness: 0.9 }), 0.07, 0.15),
            "concrete",
          ),
          0.35,
        ),
    ],
    islandCurb: [LAYER.islandCurb, curbMaterial],
    island: [
      LAYER.island,
      () =>
        snowable(
          withMacroVariation(new THREE.MeshStandardMaterial({ map: grassTexture(), roughness: 0.95 }), 0.06, 0.3),
          "grass",
        ),
    ],
    white: [LAYER.marking, () => paintMaterial(0xe6e6df)],
    yellow: [LAYER.marking, () => paintMaterial(0xe0b52c)],
  };
  const materials = {};
  const layers = Object.entries(surfaces);
  for (const builders of chunks.values()) {
    for (const [surface, [layer, make]] of layers) {
      if (builders[surface].empty) continue;
      materials[surface] ??= make();
      add(group, builders[surface], materials[surface], layer);
    }
    if (!builders.curbFace.empty) {
      materials.curbFace ??= snowable(new THREE.MeshStandardMaterial({ color: 0xbdbcb6, roughness: 0.85 }), "curb");
      const faces = new THREE.Mesh(builders.curbFace.toGeometry(), materials.curbFace);
      faces.receiveShadow = true;
      faces.matrixAutoUpdate = false;
      group.add(faces);
    }
  }

  const signals = buildSignals(map, group);
  buildStopSigns(map, group);
  buildYieldSigns(map, group);
  buildCrosswalkSigns(map, group);
  buildZoneSigns(map, group);
  const streetLights = buildStreetLights(map, group);
  return { group, signals, streets, nodeR, legs, streetLights };
}

function curbMaterial() {
  return snowable(new THREE.MeshStandardMaterial({ map: curbTexture(), roughness: 0.85, color: 0xb4b4b0 }), "curb");
}

export function paintMaterial(color) {
  return wetReflective(snowable(new THREE.MeshStandardMaterial({ color, roughness: 0.6 }), "paint"), 0.7);
}

// (a feature that paints the road adds its marking the same way)
export { add as addGroundMesh };
function add(group, builder, material, order) {
  if (builder.empty) return;
  const mesh = new THREE.Mesh(builder.toGeometry(), material);
  groundLayer(mesh, order);
  mesh.matrixAutoUpdate = false;
  group.add(mesh);
}

// White dashes between same-direction lanes (3 m paint, 6 m gap).
function laneDashes(white, e, from, to, path = e.lanes > 1 ? new RibbonPath(e.pts) : null) {
  for (let i = 1; i < e.lanes; i++) {
    const lat = (e.lane_offsets[i - 1] + e.lane_offsets[i]) / 2;
    for (let s = from + 1; s + 3 <= to; s += 9) white.ribbon(path, lat - 0.075, lat + 0.075, 0, { from: s, to: s + 3 });
  }
}

function stopBar(white, e, s, left, right, thickness) {
  const p = pointAt(e.pts, e.cum, s),
    h = headingAt(e.pts, e.cum, s);
  const mid = (left + right) / 2;
  white.rect(p[0] + Math.sin(h) * mid, p[1] - Math.cos(h) * mid, h, thickness, right - left);
}

// A regular polygon approximating a circle, counter-clockwise.
function circle(cx, cy, r, n) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return pts;
}

// Yield line: a row of white triangles across the lane, each pointing at the approaching driver.
function sharkTeeth(white, e, s, left, right) {
  const p = pointAt(e.pts, e.cum, s),
    h = headingAt(e.pts, e.cum, s);
  const fx = Math.cos(h),
    fy = Math.sin(h),
    rx = Math.sin(h),
    ry = -Math.cos(h);
  const base = 0.55,
    depth = 0.6;
  for (let lat = left + 0.15; lat + base <= right; lat += base + 0.25) {
    const a = [p[0] + rx * lat, p[1] + ry * lat],
      b = [p[0] + rx * (lat + base), p[1] + ry * (lat + base)];
    const tip = [p[0] + rx * (lat + base / 2) - fx * depth, p[1] + ry * (lat + base / 2) - fy * depth];
    white.polygon([a, tip, b], 0);
  }
}

// Continental crosswalk: bars parallel to traffic across the whole roadway.
function crosswalk(white, e, s0, s1) {
  const s = (s0 + s1) / 2,
    len = s1 - s0;
  const p = pointAt(e.pts, e.cum, s),
    h = headingAt(e.pts, e.cum, s);
  const lo = e.asphalt[0],
    hi = e.asphalt[1];
  const rx = Math.sin(h),
    ry = -Math.cos(h);
  for (let lat = lo + 0.5; lat <= hi - 0.3; lat += 1.2) {
    white.rect(p[0] + rx * lat, p[1] + ry * lat, h, len, 0.55);
  }
}

// Place a geometry at sim (x, y, z) turned to heading h; local +x = heading, +z = right of it.
function placement(x, y, z, h) {
  return new THREE.Matrix4().compose(
    toThree(x, y, z),
    new THREE.Quaternion().setFromAxisAngle(Y_AXIS, h),
    new THREE.Vector3(1, 1, 1),
  );
}
function placed(geo, matrix, local = null) {
  return geo.clone().applyMatrix4(local ? matrix.clone().multiply(local) : matrix);
}
const T = (x, y, z) => new THREE.Matrix4().makeTranslation(x, y, z);

const metal = () => new THREE.MeshStandardMaterial({ color: 0x4a4f55, roughness: 0.45, metalness: 0.7 });

// Far-side mast arms: a pole on the far right corner of each approach with one head over each lane,
// the Vancouver style of yellow heads on black backplates. At a junction with an advance green
// (sim/signals.js) each approach's heads light on their own, and where it shows as a left arrow the
// head over the approach's left lane has two more sections below: a yellow arrow and a green arrow.
// Where it shows as a flashing green, the green ball blinks.
function buildSignals(map, group) {
  const approaches = sceneryFor(map).signals;
  if (!approaches.length) return { set() {}, setPed() {} };
  const pole = new THREE.CylinderGeometry(0.13, 0.17, 6.4, 12).translate(0, 3.2, 0);
  const arm = (len) => new THREE.CylinderGeometry(0.07, 0.1, len, 8).rotateX(Math.PI / 2).translate(0, 6.1, -len / 2);
  const housing = new THREE.BoxGeometry(0.36, 1.08, 0.4);
  const backplate = new THREE.BoxGeometry(0.03, 1.42, 0.78);
  const hanger = new THREE.BoxGeometry(0.06, 0.4, 0.06);
  const hood = new THREE.BoxGeometry(0.22, 0.03, 0.34);
  const poles = [],
    housings = [],
    plates = [];
  // pedestrian heads: on each far-corner pole, facing back across the cross street, for people
  // walking alongside this approach's traffic
  const pedHousing = new THREE.BoxGeometry(0.22, 0.42, 0.36);
  const pedestrianHeads = new Map(); // "inter|group" -> pedestrian head instances
  const vehicleHeads = new Map(); // "inter|head" -> mast approaches (head: the group, or "@edge")
  const colors = [0xff2a1a, 0xffb21a, 0x1aff8c, 0xffb21a, 0x1aff8c];
  const arrowHousing = new THREE.BoxGeometry(0.36, 0.72, 0.4);
  const arrowPlate = new THREE.BoxGeometry(0.03, 0.72, 0.78);
  const lens = new THREE.CircleGeometry(0.135, 20).rotateY(-Math.PI / 2);
  const balls = new SignalBatch(
    "Traffic signal lenses",
    lens,
    signalLensMaterial({ color: 0x1a1a1a, roughness: 0.3, colorLens: true }),
  );
  const arrows = new SignalBatch(
    "Traffic signal arrows",
    lens.clone(),
    signalLensMaterial({ color: 0x1a1a1a, roughness: 0.3, texture: leftArrowTexture() }),
  );
  const pedLens = new THREE.PlaneGeometry(0.3, 0.3).rotateY(-Math.PI / 2);
  const walks = new SignalBatch(
    "Pedestrian walk signals",
    pedLens,
    signalLensMaterial({ color: 0x111111, roughness: 0.4, texturedFace: true, texture: walkSignalTexture() }),
  );
  const hands = new SignalBatch(
    "Pedestrian hand signals",
    pedLens.clone(),
    signalLensMaterial({ color: 0x111111, roughness: 0.4, texturedFace: true, texture: handSignalTexture() }),
  );
  const glowMaterial = signalGlowMaterial();
  function at(matrix, x, y, z) {
    return matrix.clone().multiply(T(x, y, z));
  }
  for (const { inter, a, e, heading: h, poleLat, x: px, y: py } of approaches) {
    const matrix = placement(px, py, 0, h);
    const adv = inter.plan?.advance,
      head = adv ? `@${a.edge}` : a.group;
    const hasArrow = adv?.style === "arrow" && adv.edge === a.edge;
    const pedKey = `${inter.id}|${a.group}`;
    if (!pedestrianHeads.has(pedKey)) pedestrianHeads.set(pedKey, []);
    const position = at(matrix, -0.305, 2.75, 0.3);
    const walk = walks.add(position, 0xf4f6ff, -1);
    const hand = hands.add(position, 0xff8a1e, 0);
    pedestrianHeads.get(pedKey).push({ walk, hand });
    housings.push(placed(pedHousing, matrix, T(-0.19, 2.75, 0.3)));
    const lanes = e.lane_offsets.slice(0, 3);
    poles.push(placed(pole, matrix));
    if (lanes.length) {
      const reach = poleLat - Math.min(...lanes) + 0.6;
      const mast = arm(reach);
      poles.push(placed(mast, matrix));
      mast.dispose();
    }
    const heads = lanes.map((off) => poleLat - off);
    heads.push(0.35); // a second head on the pole, at eye level
    const key = `${inter.id}|${head}`;
    if (!vehicleHeads.has(key)) vehicleHeads.set(key, []);
    const lamps = [];
    // Additive glows can share draws along a mast, but must sort at that mast's depth
    // relative to glass and weather, even when other signals are much closer or farther away.
    const glows = new SignalBatch("Traffic signal glows", new THREE.PlaneGeometry(1, 1), glowMaterial);
    heads.forEach((dz, i) => {
      const onPole = i === heads.length - 1;
      const y = onPole ? 3.4 : 5.25,
        z = onPole ? -0.35 : -dz;
      const x = onPole ? -0.2 : 0;
      housings.push(placed(housing, matrix, T(x, y, z)));
      plates.push(placed(backplate, matrix, T(x + 0.2, y, z)));
      if (!onPole) poles.push(placed(hanger, matrix, T(x, 5.9, z)));
      // (the left arrow: under the head over the left lane)
      const withArrow = hasArrow && i === 0;
      if (withArrow) {
        housings.push(placed(arrowHousing, matrix, T(x, y - 0.9, z)));
        plates.push(placed(arrowPlate, matrix, T(x + 0.2, y - 0.9, z)));
      }
      for (let k = 0; k < (withArrow ? 5 : 3); k++) {
        const ly = y + 0.34 - k * 0.34;
        housings.push(placed(hood, matrix, T(x - 0.28, ly + 0.15, z)));
        const arrow = k >= 3;
        const batch = arrow ? arrows : balls;
        const index = batch.add(at(matrix, x - 0.185, ly, z), colors[k], 0.04);
        const position = new THREE.Vector3(x - 0.3, ly, z).applyMatrix4(matrix);
        const size = arrow ? 0.7 : 1.1;
        const glow = glows.add(new THREE.Matrix4().makeScale(size, size, size).setPosition(position), colors[k], 0);
        lamps.push({ bit: 1 << k, batch, index, glow });
      }
    });
    const glowMesh = glows.mount(group, false);
    glowMesh.visible = false;
    vehicleHeads.get(key).push({ lamps, glows, glowMesh, mask: hasArrow ? 0b11111 : 0b00111 });
  }
  addMerged(group, poles, metal());
  addMerged(group, housings, new THREE.MeshStandardMaterial({ color: 0xd7a91e, roughness: 0.55, metalness: 0.1 }));
  addMerged(group, plates, new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.7 }));
  for (const batch of [balls, arrows, walks, hands]) batch.mount(group);
  const last = new Map();
  const pedestrians = new Map();
  return {
    // the pedestrian heads: walk, flashing hand, or a steady hand, for each group's side
    setPed(intersectionId, pedByGroup, t = 0) {
      const blink = t % 1 < 0.55;
      for (const g of ["A", "B"]) {
        const state = pedByGroup[g];
        const key = `${intersectionId}|${g}`;
        const shown = state === "walk" ? 1 : state === "dont" || (state === "flash" && blink) ? 2 : 0;
        if ((pedestrians.get(key) ?? 0) === shown) continue;
        const heads = pedestrianHeads.get(key);
        if (!heads) continue;
        pedestrians.set(key, shown);
        for (const { walk, hand } of heads) {
          // The faces share a plane. Hide the other face and retain the unlit hand face in the dark.
          walks.setStrength(walk, shown === 1 ? 3 : -1);
          hands.setStrength(hand, shown === 1 ? -1 : shown === 2 ? 3 : 0);
        }
      }
    },
    // `phases`: what each group shows ({ A, B }), or at a junction with an advance green, each
    // approach ("@<edge>": sim/signals.js approachPhase), "dark" while its lights are out
    // (sim/outage.js); `t` blinks a flashing green
    set(intersectionId, phases, t = 0) {
      const blink = t % 1 < 0.5;
      for (const [head, state] of Object.entries(phases)) {
        if (head === "u") continue;
        const key = `${intersectionId}|${head}`;
        const shown = Object.hasOwn(FLASH_MASKS, state)
          ? blink
            ? FLASH_MASKS[state]
            : 0
          : Object.hasOwn(SIGNAL_MASKS, state)
            ? SIGNAL_MASKS[state]
            : state
              ? 0
              : SIGNAL_MASKS.red;
        const previous = last.get(key) ?? 0;
        if (previous === shown) continue;
        last.set(key, shown);
        for (const { lamps, glows, glowMesh, mask } of vehicleHeads.get(key) ?? []) {
          if ((previous & mask) === (shown & mask)) continue;
          glowMesh.visible = (shown & mask) !== 0;
          for (const { bit, batch, index, glow } of lamps) {
            if ((previous & bit) === (shown & bit)) continue;
            const on = (shown & bit) !== 0;
            batch.setStrength(index, on ? 5 : 0.04);
            glows.setStrength(glow, on ? 1 : 0);
          }
        }
      }
    },
  };
}

function addMerged(group, geos, material, shadow = true) {
  if (!geos.length) {
    material.dispose();
    return;
  }
  const geometry = mergeGeometries(geos);
  for (const source of geos) source.dispose();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = shadow;
  mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false;
  group.add(mesh);
}

function octagon(r, facing) {
  // in the local YZ plane facing -x (facing = -1) or +x (+1); u runs along +z seen from the front
  const pos = [0, 0, 0],
    uv = [0.5, 0.5],
    idx = [];
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
  const signs = sceneryFor(map).stopSigns;
  if (!signs.length) return;
  const pole = new THREE.CylinderGeometry(0.035, 0.035, 2.35, 8).translate(0, 1.175, 0);
  const face = octagon(0.38, -1).translate(-0.07, 2.25, 0);
  const back = octagon(0.38, 1).translate(-0.06, 2.25, 0);
  const poles = [],
    faces = [],
    backs = [];
  for (const { x, y, heading: h } of signs) {
    const matrix = placement(x, y, 0, h);
    poles.push(placed(pole, matrix));
    faces.push(placed(face, matrix));
    backs.push(placed(back, matrix));
  }
  addMerged(group, poles, new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.4, metalness: 0.8 }));
  addMerged(
    group,
    faces,
    new THREE.MeshStandardMaterial({
      map: stopSignTexture(),
      roughness: 0.45,
      emissive: 0x220000,
      emissiveIntensity: 0.3,
    }),
  );
  addMerged(group, backs, new THREE.MeshStandardMaterial({ color: 0x8d9298, roughness: 0.5, metalness: 0.6 }));
}

// Crosswalk signs at marked crosswalks between junctions (map/scenery.js places them): a square
// sign on a post at the curb, facing the traffic coming toward the crosswalk.
function buildCrosswalkSigns(map, group) {
  const signs = sceneryFor(map).crosswalkSigns;
  if (!signs.length) return;
  const pole = new THREE.CylinderGeometry(0.035, 0.035, 2.5, 8).translate(0, 1.25, 0);
  const face = new THREE.PlaneGeometry(0.6, 0.6).rotateY(-Math.PI / 2).translate(-0.07, 2.25, 0);
  const back = new THREE.PlaneGeometry(0.6, 0.6).rotateY(Math.PI / 2).translate(-0.06, 2.25, 0);
  const poles = [],
    faces = [],
    backs = [];
  for (const { x, y, heading: h } of signs) {
    const matrix = placement(x, y, 0, h);
    poles.push(placed(pole, matrix));
    faces.push(placed(face, matrix));
    backs.push(placed(back, matrix));
  }
  addMerged(group, poles, new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.4, metalness: 0.8 }));
  addMerged(
    group,
    faces,
    new THREE.MeshStandardMaterial({
      map: crosswalkSignTexture(),
      roughness: 0.45,
      emissive: 0x111111,
      emissiveIntensity: 0.3,
    }),
  );
  addMerged(group, backs, new THREE.MeshStandardMaterial({ color: 0x8d9298, roughness: 0.5, metalness: 0.6 }));
}

// School and playground zone signs where each zone starts and ends (map/scenery.js places them): a
// square face on a post at the curb, facing the traffic going into the zone, one mesh per sign face.
function buildZoneSigns(map, group) {
  const signs = sceneryFor(map).zoneSigns;
  if (!signs.length) return;
  const pole = new THREE.CylinderGeometry(0.035, 0.035, 2.6, 8).translate(0, 1.3, 0);
  const face = new THREE.PlaneGeometry(0.8, 0.8).rotateY(-Math.PI / 2).translate(-0.07, 2.3, 0);
  const back = new THREE.PlaneGeometry(0.62, 0.62).rotateY(Math.PI / 2).translate(-0.06, 2.3, 0);
  const poles = [],
    backs = [],
    faces = new Map();
  for (const { x, y, heading: h, kind, end } of signs) {
    const matrix = placement(x, y, 0, h);
    poles.push(placed(pole, matrix));
    backs.push(placed(back, matrix));
    const key = `${kind}:${end}`;
    if (!faces.has(key)) faces.set(key, []);
    faces.get(key).push(placed(face, matrix));
  }
  addMerged(group, poles, new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.4, metalness: 0.8 }));
  for (const [key, geos] of faces) {
    const [kind, end] = key.split(":");
    addMerged(
      group,
      geos,
      new THREE.MeshStandardMaterial({
        map: zoneSignTexture(kind, end === "true"),
        transparent: true,
        alphaTest: 0.5,
        roughness: 0.45,
        emissive: 0x111111,
        emissiveIntensity: 0.3,
      }),
    );
  }
  addMerged(group, backs, new THREE.MeshStandardMaterial({ color: 0x8d9298, roughness: 0.5, metalness: 0.6 }));
}

// Yield signs at roundabout entries: a white inverted triangle with a red border, on a post at the
// right curb just before the yield line.
function buildYieldSigns(map, group) {
  const signs = sceneryFor(map).yieldSigns;
  if (!signs.length) return;
  const tri = (r, x) => {
    // in the local YZ plane facing -x, point down
    const g = new THREE.BufferGeometry();
    const pts = [0, -r, 0, 0, r / 2, r * 0.866, 0, r / 2, -r * 0.866];
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    g.computeVertexNormals();
    return g.translate(x, 2.2, 0);
  };
  const pole = new THREE.CylinderGeometry(0.035, 0.035, 2.3, 8).translate(0, 1.15, 0);
  const poles = [],
    reds = [],
    whites = [];
  const border = tri(0.45, -0.06);
  const inset = tri(0.3, -0.075);
  for (const { x, y, heading: h } of signs) {
    const matrix = placement(x, y, 0, h);
    poles.push(placed(pole, matrix));
    reds.push(placed(border, matrix));
    whites.push(placed(inset, matrix));
  }
  addMerged(group, poles, new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.4, metalness: 0.8 }));
  addMerged(
    group,
    reds,
    new THREE.MeshStandardMaterial({
      color: 0xc8102e,
      roughness: 0.45,
      side: THREE.DoubleSide,
      emissive: 0x220000,
      emissiveIntensity: 0.3,
    }),
  );
  addMerged(
    group,
    whites,
    new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.45, side: THREE.DoubleSide }),
  );
}
