import * as THREE from 'three';
import { pointAt, headingAt } from '../map/mapdata.js';
import { groundLayer, LAYER } from './scene.js';
// Fixed ground ordering: surface over asphalt, paint with other road markings.
export function buildBusLanes(map) {
  const group = new THREE.Group(); group.name = 'bus-lanes';
  const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 512;
  const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff5e6'; ctx.textAlign = 'center';
  ctx.font = 'bold 64px sans-serif'; ctx.fillText('BUS',128,330); ctx.fillText('ONLY',128,410);
  ctx.beginPath(); ctx.moveTo(128,30); ctx.lineTo(200,130); ctx.lineTo(128,230); ctx.lineTo(56,130); ctx.closePath(); ctx.lineWidth = 12; ctx.strokeStyle = '#fff5e6'; ctx.stroke();
  const texture = new THREE.CanvasTexture(canvas);
  for (const record of map.buslanes) {
    const lane = map.lane(record.edge, record.lane); if (!lane) continue;
    const width = lane.edgeRef.lane_width * .92;
    for (let s = 4; s < lane.length - 4; s += 3) {
      const p = pointAt(lane.pts,lane.cum,s), h = headingAt(lane.pts,lane.cum,s);
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(3.1,width).rotateX(-Math.PI/2),new THREE.MeshBasicMaterial({color:0x994137,transparent:true,opacity:.55}));
      mesh.rotation.y = h; mesh.position.set(p[0],0,-p[1]); groundLayer(mesh,LAYER.asphalt+1); group.add(mesh);
    }
    for (let s = 20; s < lane.length - 10; s += 45) {
      const p = pointAt(lane.pts,lane.cum,s), h = headingAt(lane.pts,lane.cum,s);
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width*.85,8).rotateX(-Math.PI/2).rotateY(-Math.PI/2),new THREE.MeshBasicMaterial({map:texture,transparent:true}));
      mesh.rotation.y = h; mesh.position.set(p[0],0,-p[1]); groundLayer(mesh,LAYER.marking); group.add(mesh);
    }
  }
  return group;
}
