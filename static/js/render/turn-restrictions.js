import * as THREE from 'three';
import { pointAt, headingAt } from '../map/mapdata.js';
// Render-only regulatory signs, raised above the ground.
export function buildRestrictions(map) {
  // (one sign for each kind of restriction on an approach, stacked up its pole)
  const group = new THREE.Group(), drawn = new Set(), stacked = new Map();
  for (const r of map.restrictions) {
    if (drawn.has(`${r.from}:${r.kind}`)) continue;
    drawn.add(`${r.from}:${r.kind}`);
    const level = stacked.get(r.from) || 0; stacked.set(r.from, level + 1);
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
    sign.position.set(p[0]+Math.sin(h)*right,2.6+level,-p[1]+Math.cos(h)*right); sign.rotation.y = h + Math.PI/2;
    const tall = level ? 1 : 2.6;  // (each sign above the first carries the pole up another metre)
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(.035,.035,tall,6),new THREE.MeshStandardMaterial({color:0x999999}));
    pole.position.copy(sign.position); pole.position.y = sign.position.y - tall / 2;
    group.add(sign,pole);
  }
  return group;
}
