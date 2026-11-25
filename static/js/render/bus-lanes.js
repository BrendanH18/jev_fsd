import * as THREE from "three";
import { pointAt, headingAt } from "../map/mapdata.js";
import { GeoBuilder } from "./geo.js";
import { groundLayer, LAYER } from "./scene.js";
// Fixed ground ordering: surface over asphalt, paint with other road markings.
export function buildBusLanes(map) {
  const group = new THREE.Group();
  group.name = "bus-lanes";
  const surface = new GeoBuilder();
  const stencils = [];
  for (const { edge, lane: index } of map.buslanes ?? []) {
    const lane = map.lane(edge, index);
    if (!lane) continue;
    const width = lane.edgeRef.lane_width * 0.92;
    if (lane.length > 8) surface.ribbon(lane.pts, -width / 2, width / 2, 0, { from: 4, to: lane.length - 4 });
    for (let s = 20; s < lane.length - 10; s += 45) {
      const [x, y] = pointAt(lane.pts, lane.cum, s);
      stencils.push({ x, y, heading: headingAt(lane.pts, lane.cum, s), width });
    }
  }
  if (!surface.empty) {
    const material = new THREE.MeshBasicMaterial({
      color: 0x994137,
      opacity: 0.55,
      blending: THREE.CustomBlending,
      blendSrc: THREE.SrcAlphaFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    group.add(groundLayer(new THREE.Mesh(surface.toGeometry(), material), LAYER.asphalt + 1));
  }
  if (!stencils.length) return group;
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff5e6";
  ctx.textAlign = "center";
  ctx.font = "bold 64px sans-serif";
  ctx.fillText("BUS", 128, 330);
  ctx.fillText("ONLY", 128, 410);
  ctx.beginPath();
  ctx.moveTo(128, 30);
  ctx.lineTo(200, 130);
  ctx.lineTo(128, 230);
  ctx.lineTo(56, 130);
  ctx.closePath();
  ctx.lineWidth = 12;
  ctx.strokeStyle = "#fff5e6";
  ctx.stroke();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshBasicMaterial({ map: texture, alphaTest: 0.42 });
  const geometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).rotateY(-Math.PI / 2);
  const mesh = new THREE.InstancedMesh(geometry, material, stencils.length);
  const transform = new THREE.Object3D();
  stencils.forEach(({ x, y, heading, width }, i) => {
    transform.position.set(x, 0, -y);
    transform.rotation.y = heading;
    transform.scale.set(8, 1, width * 0.85);
    transform.updateMatrix();
    mesh.setMatrixAt(i, transform.matrix);
  });
  mesh.computeBoundingSphere();
  group.add(groundLayer(mesh, LAYER.marking));
  return group;
}
