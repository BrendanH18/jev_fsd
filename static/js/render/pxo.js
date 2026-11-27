// Type A style X sign and amber warning beacons. Render-only: occupancy decides right of way.
import * as THREE from "three";
import { headingAt, pointAt } from "../map/mapdata.js";
import { LAYER, groundLayer } from "./scene.js";
import { pxoPedestrian } from "../sim/pxo.js";
import { GeoBuilder } from "./geo.js";

export function buildPxos(world) {
  const group = new THREE.Group();
  const lights = new Map();
  const crossings = world.crowd.marked.filter((c) => c.pxo);
  if (!crossings.length) return { group, update() {} };
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff2ad";
  ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = "#151515";
  ctx.textAlign = "center";
  ctx.font = "bold 100px sans-serif";
  ctx.fillText("X", 128, 116);
  ctx.font = "bold 25px sans-serif";
  ctx.fillText("STOP FOR", 128, 174);
  ctx.fillText("PEDESTRIANS", 128, 210);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const poleShape = new THREE.CylinderGeometry(0.07, 0.07, 4.2, 8);
  const poleMaterial = new THREE.MeshStandardMaterial({ color: 0x888888 });
  const signShape = new THREE.PlaneGeometry(1.1, 1.1).rotateY(-Math.PI / 2);
  const signMaterial = new THREE.MeshBasicMaterial({ map: texture });
  const lightShape = new THREE.SphereGeometry(0.22, 10, 8);
  const paint = new GeoBuilder();
  for (const cw of crossings) {
    const e = cw.st.edge,
      h = headingAt(e.pts, e.cum, cw.s),
      mid = pointAt(e.pts, e.cum, cw.s);
    for (let z = e.asphalt[0] + 0.3; z < e.asphalt[1] - 0.2; z += 0.9)
      paint.rect(mid[0] + Math.sin(h) * z, mid[1] - Math.cos(h) * z, h, 3, 0.4);
    const beacon = cw.beacons ? new THREE.MeshBasicMaterial({ color: 0x6b4500 }) : null;
    if (beacon) lights.set(cw.id, beacon);
    for (const side of [1, -1]) {
      const p = cw.ends[side];
      const pole = new THREE.Mesh(poleShape, poleMaterial);
      pole.position.set(p[0], 2.1, -p[1]);
      group.add(pole);
      const sign = new THREE.Mesh(signShape, signMaterial);
      sign.rotation.y = side > 0 ? h : h + Math.PI;
      sign.position.set(p[0] - side * Math.cos(h) * 0.08, 3.4, -p[1] + side * Math.sin(h) * 0.08);
      group.add(sign);
      if (beacon) {
        const light = new THREE.Mesh(lightShape, beacon);
        light.position.set(p[0], 4.35, -p[1]);
        group.add(light);
      }
    }
  }
  if (!paint.empty)
    group.add(
      groundLayer(new THREE.Mesh(paint.toGeometry(), new THREE.MeshBasicMaterial({ color: 0xeeeeee })), LAYER.marking),
    );
  return {
    group,
    update() {
      const occupied = new Set();
      if (lights.size && Math.floor(world.t * 4) % 2 === 0)
        for (const p of world.crowd.list) {
          const id = p.crossing?.marked;
          if (lights.has(id) && !occupied.has(id) && pxoPedestrian(world.crowd, p)) occupied.add(id);
        }
      for (const [id, material] of lights) material.color.setHex(occupied.has(id) ? 0xffb000 : 0x6b4500);
    },
  };
}

export const view = {
  mount: {
    order: 15,
    run({ scene, world }) {
      const crossing = world.pxo ? buildPxos(world) : null;
      if (crossing) scene.add(crossing.group);
      return crossing;
    },
    signals: (crossing) => crossing.update(),
  },
};
