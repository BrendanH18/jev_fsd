// Street-name and speed-limit plates share one texture atlas. Boards and posts are batched into
// spatial chunks, so hundreds of readable signs add only a few visible draw calls.
import * as THREE from "three";
import { pointAt, headingAt } from "../map/mapdata.js";

const TILE_W = 256, TILE_H = 128, COLS = 8, ROWS = 16, CHUNK = 250;

export function buildStreetSigns(map) {
  const root = new THREE.Group(), labels = new Map(), items = [], seen = new Set();
  const canvas = document.createElement("canvas"); canvas.width = TILE_W * COLS; canvas.height = TILE_H * ROWS;
  const ctx = canvas.getContext("2d");
  function label(text, speed = false) {
    const key = `${speed ? "speed" : "street"}:${text}`;
    if (labels.has(key)) return labels.get(key);
    if (labels.size >= COLS * ROWS) return null;
    const index = labels.size, x = index % COLS * TILE_W, y = Math.floor(index / COLS) * TILE_H;
    ctx.fillStyle = speed ? "#eeeae0" : "#244f46"; ctx.fillRect(x, y, TILE_W, TILE_H);
    ctx.strokeStyle = speed ? "#202c30" : "#d2e5dd"; ctx.lineWidth = 3; ctx.strokeRect(x + 6, y + 6, TILE_W - 12, TILE_H - 12);
    ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillStyle = speed ? "#172128" : "#eff6f0";
    if (speed) {
      ctx.font = "bold 22px sans-serif"; ctx.fillText("MAXIMUM", x + TILE_W / 2, y + 28);
      ctx.font = "bold 65px sans-serif"; ctx.fillText(text, x + TILE_W / 2, y + 81);
    } else {
      let size = 30; ctx.font = `600 ${size}px sans-serif`;
      while (ctx.measureText(text).width > TILE_W - 24 && size > 14) { size--; ctx.font = `600 ${size}px sans-serif`; }
      ctx.fillText(text, x + TILE_W / 2, y + TILE_H / 2, TILE_W - 20);
    }
    const rect = [x / canvas.width, 1 - (y + TILE_H) / canvas.height, 1 / COLS, 1 / ROWS];
    labels.set(key, rect); return rect;
  }
  for (const edge of map.edges.values()) {
    if (edge.length < 45) continue;
    const key = [edge.from, edge.to].sort().join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    const speed = Math.round(edge.limit * 3.6 / 5) * 5;
    const placements = [];
    if (edge.length > 80) placements.push({ s: Math.min(25, edge.length * 0.3), speed: true, text: String(speed), width: 0.65, height: 0.85 });
    if (edge.name) placements.push({ s: Math.max(15, edge.length - 18), text: edge.name, width: 2.2, height: 0.42 });
    for (const plate of placements) {
      const uv = label(plate.text, plate.speed); if (!uv) continue;
      const p = pointAt(edge.pts, edge.cum, plate.s), heading = headingAt(edge.pts, edge.cum, plate.s);
      const offset = edge.asphalt[1] + 1.25;
      const x = p[0] + Math.sin(heading) * offset, y = p[1] - Math.cos(heading) * offset;
      // The plate faces approaching traffic; the thin metal pole sits outside the asphalt.
      items.push({ x, y, heading, uv, width: plate.width, height: plate.height, z: plate.speed ? 2.3 : 2.7 });
    }
  }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const plateMaterial = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.65, metalness: 0.1, side: THREE.DoubleSide });
  plateMaterial.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace("#include <common>", "#include <common>\nattribute vec4 signUv;")
      .replace("#include <uv_vertex>", "#include <uv_vertex>\nvMapUv = vMapUv * signUv.zw + signUv.xy;");
  };
  plateMaterial.customProgramCacheKey = () => "street-sign-atlas-v1";
  const poleMaterial = new THREE.MeshStandardMaterial({ color: 0x7b8585, roughness: 0.6, metalness: 0.65 });
  const chunks = new Map();
  for (const item of items) {
    const key = `${Math.floor(item.x / CHUNK)},${Math.floor(item.y / CHUNK)}`;
    if (!chunks.has(key)) chunks.set(key, []);
    chunks.get(key).push(item);
  }
  const transform = new THREE.Object3D();
  for (const batch of chunks.values()) {
    const geometry = new THREE.PlaneGeometry(1, 1), uv = new Float32Array(batch.length * 4);
    const plates = new THREE.InstancedMesh(geometry, plateMaterial, batch.length);
    const posts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.035, 0.035, 1, 5), poleMaterial, batch.length);
    batch.forEach((item, i) => {
      transform.position.set(item.x, item.z, -item.y); transform.rotation.set(0, item.heading - Math.PI / 2, 0); transform.scale.set(item.width, item.height, 1); transform.updateMatrix();
      plates.setMatrixAt(i, transform.matrix); uv.set(item.uv, i * 4);
      transform.position.y = item.z / 2; transform.rotation.set(0, 0, 0); transform.scale.set(1, item.z, 1); transform.updateMatrix(); posts.setMatrixAt(i, transform.matrix);
    });
    geometry.setAttribute("signUv", new THREE.InstancedBufferAttribute(uv, 4));
    for (const mesh of [plates, posts]) { mesh.computeBoundingSphere(); mesh.receiveShadow = true; mesh.matrixAutoUpdate = false; root.add(mesh); }
  }
  root.userData.signCount = items.length; root.userData.atlas = texture;
  return root;
}
