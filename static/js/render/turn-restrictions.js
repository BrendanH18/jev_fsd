import * as THREE from 'three';
import { pointAt, headingAt } from '../map/mapdata.js';
// Render-only regulatory signs, raised above the ground.
export function buildRestrictions(map) {
  const group = new THREE.Group(), drawn = new Set();
  for (const r of map.restrictions) {
    if (drawn.has(r.from)) continue;
    drawn.add(r.from);
    const e = map.edges.get(r.from), s = Math.max(0, e.length - 15);
    const p = pointAt(e.pts, e.cum, s), h = headingAt(e.pts, e.cum, s);
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
    const c = canvas.getContext('2d'); c.fillStyle = 'white'; c.fillRect(0,0,128,128);
    c.strokeStyle = 'black'; c.lineWidth = 4; c.strokeRect(3,3,122,122);
    c.fillStyle = 'black'; c.font = 'bold 85px sans-serif'; c.textAlign = 'center';
    c.fillText(r.kind.includes('left') ? '↰' : r.kind.includes('right') ? '↱' : r.kind.includes('u_turn') ? '↶' : '↑',64,96);
    if (r.kind.startsWith('no_')) { c.strokeStyle = '#d11920'; c.lineWidth = 11; c.beginPath(); c.moveTo(18,110); c.lineTo(110,18); c.stroke(); }
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.9,0.9), new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(canvas), side:THREE.DoubleSide}));
    const right = (e.asphalt?.[1] || e.width/2) + 0.8;
    sign.position.set(p[0]+Math.sin(h)*right,2.6,-p[1]+Math.cos(h)*right); sign.rotation.y = h + Math.PI/2;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(.035,.035,2.6,6),new THREE.MeshStandardMaterial({color:0x999999}));
    pole.position.copy(sign.position); pole.position.y=1.3;
    group.add(sign,pole);
  }
  return group;
}
