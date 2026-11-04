// Type A style X sign and amber warning beacons. Render-only: occupancy decides right of way.
import * as THREE from "three";
import { headingAt, pointAt } from "../map/mapdata.js";
import { LAYER, groundLayer } from "./scene.js";
import { pxoPedestrian } from "../sim/pxo.js";

export function buildPxos(world) {
  const group = new THREE.Group(), lights = [];
  const canvas = document.createElement("canvas"); canvas.width = 256; canvas.height = 256;
  const ctx = canvas.getContext("2d"); ctx.fillStyle = "#fff2ad"; ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = "#151515"; ctx.textAlign = "center"; ctx.font = "bold 100px sans-serif"; ctx.fillText("X", 128, 116);
  ctx.font = "bold 25px sans-serif"; ctx.fillText("STOP FOR", 128, 174); ctx.fillText("PEDESTRIANS", 128, 210);
  const texture = new THREE.CanvasTexture(canvas);
  for (const cw of world.crowd.marked.filter(c => c.pxo)) {
    const e = cw.st.edge, h = headingAt(e.pts, e.cum, cw.s), mid = pointAt(e.pts, e.cum, cw.s);
    const paint = new THREE.Group(); paint.position.set(mid[0], 0.025, -mid[1]); paint.rotation.y = h;
    const white = new THREE.MeshBasicMaterial({ color: 0xeeeeee });
    for (let z = e.asphalt[0] + 0.3; z < e.asphalt[1] - 0.2; z += 0.9) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(3, 0.015, 0.4), white);
      bar.position.z = z; paint.add(groundLayer(bar, LAYER.marking));
    }
    group.add(paint);
    for (const side of [1, -1]) {
      const p = cw.ends[side], pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 4.2, 8), new THREE.MeshStandardMaterial({ color: 0x888888 }));
      pole.position.set(p[0], 2.1, -p[1]); group.add(pole);
      const sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture })); sign.position.set(p[0], 3.4, -p[1]); sign.scale.set(1.5, 1.5, 1); group.add(sign);
      if (cw.beacons) {
        const material = new THREE.MeshBasicMaterial({ color: 0x6b4500 });
        const light = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), material); light.position.set(p[0], 4.35, -p[1]); group.add(light); lights.push({ cw, material });
      }
    }
  }
  return { group, update() {
    for (const { cw, material } of lights) {
      const occupied = world.crowd.list.some(p => p.crossing?.marked === cw.id && pxoPedestrian(world.crowd, p));
      material.color.setHex(occupied && Math.floor(world.t * 4) % 2 === 0 ? 0xffb000 : 0x6b4500);
    }
  } };
}
