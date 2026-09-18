// Road ribbons, lane markings, junction fills, stop lines, traffic-signal heads, and stop signs.

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { pointAt, headingAt } from "../map/mapdata.js";

const ASPHALT = 0x3a3d42;
const MARK_WHITE = 0xe8e8e8;
const MARK_YELLOW = 0xe3c04a;

function ribbon(pts, left, right, z) {
  // left/right are signed lateral extents (right of travel positive)
  const positions = [];
  const idx = [];
  const n = pts.length;
  const normals = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = pts[i + 1][0] - pts[i][0], dy = pts[i + 1][1] - pts[i][1];
    const l = Math.hypot(dx, dy) || 1;
    normals.push([dy / l, -dx / l]);
  }
  for (let i = 0; i < n; i++) {
    let nx, ny, scale = 1;
    if (i === 0) [nx, ny] = normals[0];
    else if (i === n - 1) [nx, ny] = normals[n - 2];
    else {
      const a = normals[i - 1], b = normals[i];
      nx = a[0] + b[0]; ny = a[1] + b[1];
      const l = Math.hypot(nx, ny);
      if (l < 1e-6) { [nx, ny] = a; } else { nx /= l; ny /= l; scale = Math.min(2, 1 / Math.max(0.3, a[0] * nx + a[1] * ny)); }
    }
    positions.push(pts[i][0] + nx * right * scale, z, -(pts[i][1] + ny * right * scale));
    positions.push(pts[i][0] + nx * left * scale, z, -(pts[i][1] + ny * left * scale));
  }
  for (let i = 0; i < n - 1; i++) {
    const a = i * 2;
    idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

function dashes(pts, cum, offset, z, dash = 3, gap = 6, width = 0.15) {
  const geos = [];
  const total = cum[cum.length - 1];
  for (let s = 2; s + dash < total; s += dash + gap) {
    const a = pointAt(pts, cum, s), b = pointAt(pts, cum, s + dash);
    const h = headingAt(pts, cum, s);
    const ox = Math.sin(h) * offset, oy = -Math.cos(h) * offset;
    geos.push(ribbon([[a[0] + ox, a[1] + oy], [b[0] + ox, b[1] + oy]], -width / 2, width / 2, z));
  }
  return geos;
}

function bar(pts, cum, s, left, right, thickness, z) {
  const a = pointAt(pts, cum, Math.max(0, s - thickness / 2)), b = pointAt(pts, cum, Math.min(cum[cum.length - 1], s + thickness / 2));
  return ribbon([a, b], left, right, z);
}

function disk(x, y, r, z) {
  const geo = new THREE.CircleGeometry(r, 20);
  geo.deleteAttribute("uv");  // ribbons have no uv; merged geometries must match
  geo.rotateX(-Math.PI / 2);
  geo.translate(x, z, -y);
  return geo;
}

export function buildRoads(map) {
  const group = new THREE.Group();
  const asphalt = [], white = [], yellow = [];
  const drawn = new Set();
  for (const e of map.edges.values()) {
    const key = [e.from, e.to].sort().join("|") + "|" + Math.round(e.length);
    const twin = drawn.has(key);
    if (!twin) {
      drawn.add(key);
      asphalt.push(ribbon(e.pts, e.asphalt[0] - 0.3, e.asphalt[1] + 0.3, 0));
      if (!e.oneway) yellow.push(...dashes(e.pts, e.cum, 0, 0.02, 4, 4, 0.14));
    }
    // white dashes between same-direction lanes
    for (let i = 1; i < e.lanes; i++) {
      const boundary = (e.lane_offsets[i - 1] + e.lane_offsets[i]) / 2;
      white.push(...dashes(e.pts, e.cum, boundary, 0.02));
    }
    if (e.control) {
      const laneLeft = e.oneway ? e.asphalt[0] + 0.3 : 0.15;
      const laneRight = e.asphalt[1] - 0.3;
      white.push(bar(e.pts, e.cum, e.control.s_line, laneLeft, laneRight, 0.5, 0.03));
    }
  }
  for (const node of map.nodes.values()) {
    const incident = [...(map.inn.get(node.id) || []), ...(map.out.get(node.id) || [])];
    if (!incident.length) continue;
    const r = Math.max(...incident.map((id) => map.edges.get(id).width / 2)) + 0.3;
    asphalt.push(disk(node.x, node.y, r, 0.005));
  }
  const add = (geos, color, z) => {
    if (!geos.length) return;
    const mesh = new THREE.Mesh(mergeGeometries(geos, false), new THREE.MeshLambertMaterial({ color }));
    mesh.position.y = z;
    group.add(mesh);
  };
  add(asphalt, ASPHALT, 0);
  add(white, MARK_WHITE, 0.01);
  add(yellow, MARK_YELLOW, 0.01);

  const signals = buildSignals(map, group);
  buildStopSigns(map, group);
  return { group, signals };
}

function rightOfLane(e, s, extra = 1.2) {
  const p = pointAt(e.pts, e.cum, s), h = headingAt(e.pts, e.cum, s);
  const d = e.asphalt[1] + extra;
  return { x: p[0] + Math.sin(h) * d, y: p[1] - Math.cos(h) * d, heading: h };
}

function buildSignals(map, group) {
  const poleMat = new THREE.MeshLambertMaterial({ color: 0x2b2f36 });
  const housingMat = new THREE.MeshLambertMaterial({ color: 0x1c1f24 });
  const lampGeo = new THREE.SphereGeometry(0.22, 12, 10);
  const colors = { red: 0xff3b3b, yellow: 0xffc832, green: 0x3ddc6a };
  const lamps = new Map(); // intersection id -> [{group, lamps: {red, yellow, green}}]
  for (const inter of map.intersections.values()) {
    const list = [];
    for (const a of inter.approaches) {
      const e = map.edges.get(a.edge);
      if (!e) continue;
      const pos = rightOfLane(e, a.s_line, 1.0);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 4.2, 8), poleMat);
      pole.position.set(pos.x, 2.1, -pos.y);
      group.add(pole);
      const housing = new THREE.Mesh(new THREE.BoxGeometry(0.45, 1.3, 0.35), housingMat);
      housing.position.set(pos.x, 3.7, -pos.y);
      housing.rotation.y = pos.heading;
      group.add(housing);
      const set = {};
      ["red", "yellow", "green"].forEach((name, i) => {
        const m = new THREE.Mesh(lampGeo, new THREE.MeshLambertMaterial({ color: colors[name], emissive: colors[name], emissiveIntensity: 0.1 }));
        // lamps face the approaching traffic: place them on the side facing backward along the edge
        const back = -0.2;
        m.position.set(pos.x + Math.cos(pos.heading) * back, 4.15 - i * 0.42, -(pos.y + Math.sin(pos.heading) * back));
        group.add(m);
        set[name] = m;
      });
      list.push({ group: a.group, lamps: set });
    }
    lamps.set(inter.id, list);
  }
  return {
    set(intersectionId, phaseByGroup) {
      const list = lamps.get(intersectionId);
      if (!list) return;
      for (const item of list) {
        const state = phaseByGroup[item.group] || "red";
        for (const [name, mesh] of Object.entries(item.lamps)) {
          const on = name === state;
          mesh.material.emissiveIntensity = on ? 1.6 : 0.08;
        }
      }
    },
  };
}

function buildStopSigns(map, group) {
  const poleMat = new THREE.MeshLambertMaterial({ color: 0x8c8f94 });
  const signGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.04, 8);
  const signMat = new THREE.MeshLambertMaterial({ color: 0xd8262c, emissive: 0x5a0a0d, emissiveIntensity: 0.3 });
  for (const stop of map.stops.values()) {
    const e = map.edges.get(stop.edge);
    if (!e) continue;
    const pos = rightOfLane(e, stop.s_line, 0.9);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.4, 6), poleMat);
    pole.position.set(pos.x, 1.2, -pos.y);
    group.add(pole);
    const sign = new THREE.Mesh(signGeo, signMat);
    sign.position.set(pos.x, 2.5, -pos.y);
    sign.rotation.z = Math.PI / 2;
    sign.rotation.y = pos.heading + Math.PI / 2;
    group.add(sign);
  }
}
