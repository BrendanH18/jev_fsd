// One-way streets cyclists may ride both ways (sim/contraflow.js), drawn where the world runs them: a
// painted contraflow lane along the driver's left edge (a solid white line, a bicycle and an arrow
// against the traffic every LANE_EVERY_M), or, on a shared street, sharrows pointing against the
// traffic; and, where the street starts, a ONE WAY sign with an EXCEPT BICYCLES tab under it (in
// Québec, SENS UNIQUE and EXCEPTÉ VÉLOS).

import * as THREE from "three";
import { cumulative, headingAt, pointAt } from "../map/mapdata.js";
import { groundLayer, LAYER } from "./scene.js";
import { LANE_M, contraLine, contraflowOf, rideLateral } from "../sim/contraflow.js";

const LANE_EVERY_M = 30;
const SHARROW_EVERY_M = 35;
const PAINT = "#ecebe4";

function canvas(w, h, draw) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  draw(c.getContext("2d"));
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 4;
  return t;
}

// A bicycle seen from above, then an arrow (or, for a sharrow, two chevrons) pointing up the canvas.
function bikeAndArrow(sharrow) {
  return canvas(128, 512, (ctx) => {
    ctx.strokeStyle = PAINT; ctx.fillStyle = PAINT; ctx.lineWidth = 9; ctx.lineCap = "round";
    // the bicycle: two wheels and a frame
    ctx.beginPath(); ctx.arc(64, 300, 30, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(64, 420, 30, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(64, 300); ctx.lineTo(64, 420); ctx.moveTo(40, 330); ctx.lineTo(88, 330); ctx.stroke();
    if (sharrow) {
      for (const y of [150, 220]) { ctx.beginPath(); ctx.moveTo(18, y + 40); ctx.lineTo(64, y); ctx.lineTo(110, y + 40); ctx.stroke(); }
    } else {
      ctx.beginPath(); ctx.moveTo(64, 30); ctx.lineTo(108, 110); ctx.lineTo(78, 110); ctx.lineTo(78, 220); ctx.lineTo(50, 220); ctx.lineTo(50, 110); ctx.lineTo(20, 110); ctx.closePath(); ctx.fill();
    }
  });
}

// The sign: a black ONE WAY arrow plate (the arrow pointing right, or left), and a white tab under it.
function signTexture(french, left) {
  return canvas(256, 192, (ctx) => {
    ctx.fillStyle = "#111"; ctx.fillRect(0, 0, 256, 96);
    ctx.fillStyle = "#fff"; ctx.beginPath();
    if (left) { ctx.moveTo(14, 48); ctx.lineTo(60, 14); ctx.lineTo(60, 30); ctx.lineTo(242, 30); ctx.lineTo(242, 66); ctx.lineTo(60, 66); ctx.lineTo(60, 82); }
    else { ctx.moveTo(242, 48); ctx.lineTo(196, 14); ctx.lineTo(196, 30); ctx.lineTo(14, 30); ctx.lineTo(14, 66); ctx.lineTo(196, 66); ctx.lineTo(196, 82); }
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#111"; ctx.font = "bold 26px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(french ? "SENS UNIQUE" : "ONE WAY", left ? 150 : 106, 49);
    ctx.fillStyle = "#fff"; ctx.fillRect(18, 104, 220, 84);
    ctx.strokeStyle = "#111"; ctx.lineWidth = 5; ctx.strokeRect(20, 106, 216, 80);
    ctx.fillStyle = "#111"; ctx.font = "bold 28px sans-serif";
    ctx.fillText(french ? "EXCEPTÉ" : "EXCEPT", 128, 130); ctx.fillText(french ? "VÉLOS" : "BICYCLES", 128, 164);
  });
}

// (Québec signs in French: the map is in Québec where its routing box is)
const inQuebec = (map) => { const [w, s, e, n] = map.routingBbox || map.bbox || [0, 0, 0, 0]; return w > -79.8 && e < -57 && s > 44.9 && n < 62.6 && !(w > -77 && e < -75 && s < 45.5); };

export function buildContraflow(map) {
  const group = new THREE.Group();
  group.name = "contraflow";
  if (!map.contraflow?.size) return group;
  const lane = new THREE.MeshBasicMaterial({ map: bikeAndArrow(false), transparent: true });
  const shar = new THREE.MeshBasicMaterial({ map: bikeAndArrow(true), transparent: true });
  const line = new THREE.MeshBasicMaterial({ color: PAINT });
  const french = inQuebec(map);
  const signs = [false, true].map((left) => new THREE.MeshBasicMaterial({ map: signTexture(french, left) }));
  const pole = new THREE.MeshLambertMaterial({ color: 0x8a8d91 });
  const plane = (w, l) => new THREE.PlaneGeometry(w, l).rotateX(-Math.PI / 2);
  const symbolGeo = plane(0.75, 3.0);
  for (const c of map.contraflow.values()) {
    const e = map.edges.get(c.edge);
    if (!e || e.length < 8) continue;
    // (the rider's line, from the edge's `to` end, and the lane line beside it)
    const pts = contraLine(e, c.side), cum = cumulative(pts), len = cum[cum.length - 1];
    if (c.kind !== "shared") {
      const at = c.side === "right" ? rideLateral(e, "right") - (LANE_M - 0.6) - 0.3 : rideLateral(e, "left") + (LANE_M - 0.6) + 0.3;
      const edgeLine = e.pts.map((p, i) => {
        const a = e.pts[Math.max(0, i - 1)], b = e.pts[Math.min(e.pts.length - 1, i + 1)], h = Math.atan2(b[1] - a[1], b[0] - a[0]);
        return [p[0] + Math.sin(h) * at, p[1] - Math.cos(h) * at];
      });
      const lc = cumulative(edgeLine), total = lc[lc.length - 1];
      // (in 2 m pieces, so it follows a bend; local +x along the street)
      for (let s = 3; s < total - 3; s += 2) {
        const piece = Math.min(2, total - 3 - s), p = pointAt(edgeLine, lc, s + piece / 2), h = headingAt(edgeLine, lc, s + piece / 2);
        const m = new THREE.Mesh(plane(piece, 0.12), line);
        m.rotation.y = h; m.position.set(p[0], 0, -p[1]); groundLayer(m, LAYER.marking); group.add(m);
      }
    }
    // (symbols facing the cyclist: pointing the way it rides)
    const every = c.kind === "shared" ? SHARROW_EVERY_M : LANE_EVERY_M;
    for (let s = Math.min(8, len / 2); s < len - 4; s += every) {
      const p = pointAt(pts, cum, s), h = headingAt(pts, cum, s);
      const m = new THREE.Mesh(symbolGeo, c.kind === "shared" ? shar : lane);
      m.rotation.y = h - Math.PI / 2; m.position.set(p[0], 0, -p[1]); groundLayer(m, LAYER.marking); group.add(m);
    }
    // the sign, at the street's entrance (its `from` end) on the right-hand kerb, parallel to the street
    // with its arrow along it, a plate facing each way across, unless the contraflow block before it
    // carries straight on
    const before = (map.inn.get(e.from) || []).some((id) => contraflowOf(map, id) && Math.abs(map.turnAngle(id, e.id)) < 0.4);
    if (before || e.length < 25) continue;
    const h = map.headingOut(e.id), side = e.asphalt[1] + 0.8, [x0, y0] = e.pts[0];
    const x = x0 + Math.cos(h) * 4 + Math.sin(h) * side, y = y0 + Math.sin(h) * 4 - Math.cos(h) * side;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.6, 6), pole);
    post.position.set(x, 1.3, -y); group.add(post);
    // (facing the right: its arrow, on the plate's right, points along the street; facing the left, the
    // arrow is on its left)
    for (const [k, turn] of [[0, 0], [1, Math.PI]]) {
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.675), signs[k]);
      plate.rotation.y = h + turn; plate.position.set(x + Math.sin(h) * (k ? -0.01 : 0.01), 2.3, -(y - Math.cos(h) * (k ? -0.01 : 0.01))); group.add(plate);
    }
  }
  return group;
}
