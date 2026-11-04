import * as THREE from 'three';
import { pointAt, headingAt } from '../map/mapdata.js';
// Render-only regulatory signs, raised above the ground. A ban that applies only at certain times has a
// plate under it with its hours and days, as on the street ("7:00-9:00 MON-FRI").
const STEP = 1.3;  // (signs on one approach stack this far apart, room for an hours plate under each)
const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const clockText = (m) => `${m >= 1440 ? 24 : Math.floor(m / 60) % 24}:${String(m % 60).padStart(2, '0')}`;
function hoursText(c) {
  const d = [...c.days].sort((a, b) => a - b), run = d.every((x, i) => !i || x === d[i - 1] + 1);
  const days = d.length === 7 ? '' : d.length === 1 ? DAYS[d[0]] : run ? `${DAYS[d[0]]}-${DAYS[d.at(-1)]}` : d.map(x => DAYS[x]).join(' ');
  return `${clockText(c.start)}-${clockText(c.end)}${days ? ' ' + days : ''}`;
}
function hoursPlate(condition) {
  const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 80;
  const c = canvas.getContext('2d'); c.fillStyle = 'white'; c.fillRect(0, 0, 256, 80);
  c.strokeStyle = 'black'; c.lineWidth = 4; c.strokeRect(3, 3, 250, 74);
  c.fillStyle = 'black'; c.font = 'bold 30px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText(hoursText(condition), 128, 42, 236);
  return new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.28), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(canvas), side: THREE.DoubleSide }));
}
// The arrow, drawn as strokes (fonts often lack the arrow glyphs): straight on, a left or right turn, or a U-turn.
function drawArrow(c, kind) {
  c.strokeStyle = c.fillStyle = 'black'; c.lineWidth = 13; c.lineJoin = c.lineCap = 'round';
  const head = (x, y, dx, dy) => { c.beginPath(); c.moveTo(x + dx * 22, y + dy * 22); c.lineTo(x - dy * 18, y + dx * 18); c.lineTo(x + dy * 18, y - dx * 18); c.closePath(); c.fill(); };
  c.beginPath();
  if (kind.includes('u_turn')) { c.moveTo(80, 108); c.lineTo(80, 56); c.arc(62, 56, 18, 0, Math.PI, true); c.lineTo(44, 74); c.stroke(); head(44, 78, 0, 1); }
  else if (kind.includes('left')) { c.moveTo(78, 108); c.lineTo(78, 62); c.lineTo(46, 62); c.stroke(); head(42, 62, -1, 0); }
  else if (kind.includes('right')) { c.moveTo(50, 108); c.lineTo(50, 62); c.lineTo(82, 62); c.stroke(); head(86, 62, 1, 0); }
  else { c.moveTo(64, 108); c.lineTo(64, 44); c.stroke(); head(64, 40, 0, -1); }
}
export function buildRestrictions(map) {
  // (one sign for each kind of restriction on an approach, stacked up its pole)
  const group = new THREE.Group(), drawn = new Set(), stacked = new Map();
  for (const r of map.restrictions) {
    const key = `${r.from}:${r.kind}:${r.condition ? hoursText(r.condition) : ''}`;
    if (drawn.has(key)) continue;
    drawn.add(key);
    const level = stacked.get(r.from) || 0; stacked.set(r.from, level + 1);
    const e = map.edges.get(r.from), s = Math.max(0, e.length - 15);
    const p = pointAt(e.pts, e.cum, s), h = headingAt(e.pts, e.cum, s);
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
    const c = canvas.getContext('2d'); c.fillStyle = 'white'; c.fillRect(0,0,128,128);
    c.strokeStyle = 'black'; c.lineWidth = 4; c.strokeRect(3,3,122,122);
    drawArrow(c, r.kind);
    if (r.kind.startsWith('no_')) { c.strokeStyle = '#d11920'; c.lineWidth = 11; c.beginPath(); c.moveTo(18,110); c.lineTo(110,18); c.stroke(); }
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.9,0.9), new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(canvas), side:THREE.DoubleSide}));
    const right = (e.asphalt?.[1] || e.width/2) + 0.8;
    // (facing the traffic coming up to it, just in front of its pole)
    const x = p[0]+Math.sin(h)*right, z = -p[1]+Math.cos(h)*right;
    sign.position.set(x - Math.cos(h)*0.06, 2.6+level*STEP, z + Math.sin(h)*0.06); sign.rotation.y = h - Math.PI/2;
    const tall = level ? STEP : 2.6;  // (each sign above the first carries the pole up another STEP)
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(.035,.035,tall,6),new THREE.MeshStandardMaterial({color:0x999999}));
    pole.position.set(x, sign.position.y - tall / 2, z);
    group.add(sign,pole);
    if (r.condition) {
      const plate = hoursPlate(r.condition);
      plate.position.copy(sign.position); plate.position.y -= 0.6; plate.rotation.y = sign.rotation.y;
      group.add(plate);
    }
  }
  return group;
}
