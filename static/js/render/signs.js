// Street-name and speed-limit plates share paged texture atlases. Boards and posts are batched into
// spatial chunks, so hundreds of readable signs add only a few visible draw calls.
import * as THREE from "three";
import { sceneryFor } from "../map/scenery.js";

const TILE_W = 256,
  TILE_H = 128,
  COLS = 8,
  ROWS = 16,
  CHUNK = 250;

export function buildStreetSigns(map, { anisotropy = 8 } = {}) {
  const root = new THREE.Group();
  const signs = sceneryFor(map).streetSigns;
  root.userData.signCount = 0;
  if (!signs.length) return root;
  const labels = new Map();
  const pages = [];
  function label(text, speed) {
    const key = `${speed ? "speed" : "street"}:${text}`;
    if (labels.has(key)) return labels.get(key);
    const pageIndex = Math.floor(labels.size / (COLS * ROWS));
    if (!pages[pageIndex]) pages.push(makePage(anisotropy));
    const page = pages[pageIndex];
    const { canvas, ctx } = page;
    const index = labels.size % (COLS * ROWS),
      x = (index % COLS) * TILE_W,
      y = Math.floor(index / COLS) * TILE_H;
    ctx.fillStyle = speed ? "#eeeae0" : "#244f46";
    ctx.fillRect(x, y, TILE_W, TILE_H);
    // Draw into a rectangle with the board's actual proportions. The rest of the cell is a
    // same-colour gutter, so filtering cannot immediately pick up a neighbouring sign.
    const w = speed ? 86 : 240,
      h = speed ? 112 : 46;
    const left = x + (TILE_W - w) / 2,
      top = y + (TILE_H - h) / 2;
    ctx.strokeStyle = speed ? "#202c30" : "#d2e5dd";
    ctx.lineWidth = 2;
    ctx.strokeRect(left + 3, top + 3, w - 6, h - 6);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = speed ? "#172128" : "#eff6f0";
    if (speed) {
      ctx.font = "bold 11px sans-serif";
      ctx.fillText("MAXIMUM", left + w / 2, top + 21);
      ctx.font = "bold 60px sans-serif";
      ctx.fillText(text, left + w / 2, top + 70, w - 14);
    } else {
      let size = 32;
      ctx.font = `bold ${size}px sans-serif`;
      while (ctx.measureText(text).width > w - 18 && size > 16) {
        size--;
        ctx.font = `bold ${size}px sans-serif`;
      }
      ctx.fillText(text, left + w / 2, top + h / 2, w - 18);
    }
    // Half-texel insets keep linear sampling within the printed board.
    const rect = [
      (left + 0.5) / canvas.width,
      1 - (top + h - 0.5) / canvas.height,
      (w - 1) / canvas.width,
      (h - 1) / canvas.height,
    ];
    const tile = { page, uv: rect };
    labels.set(key, tile);
    return tile;
  }
  for (const plate of signs) {
    const { page, uv } = label(plate.text, plate.speed);
    const key = `${Math.floor(plate.x / CHUNK)},${Math.floor(plate.y / CHUNK)}`;
    if (!page.chunks.has(key)) page.chunks.set(key, []);
    page.chunks.get(key).push({ ...plate, uv });
  }
  const poleMaterial = new THREE.MeshStandardMaterial({ color: 0x7b8585, roughness: 0.6, metalness: 0.65 });
  const poleGeometry = new THREE.CylinderGeometry(0.035, 0.035, 1, 5);
  const transform = new THREE.Object3D();
  for (const page of pages)
    for (const batch of page.chunks.values()) {
      const geometry = new THREE.PlaneGeometry(1, 1),
        uv = new Float32Array(batch.length * 4),
        speed = new Float32Array(batch.length);
      const plates = new THREE.InstancedMesh(geometry, page.material, batch.length);
      const posts = new THREE.InstancedMesh(poleGeometry, poleMaterial, batch.length);
      batch.forEach((item, i) => {
        transform.position.set(item.x, item.z, -item.y);
        transform.rotation.set(0, item.heading - Math.PI / 2, 0);
        transform.scale.set(item.width, item.height, 1);
        transform.updateMatrix();
        plates.setMatrixAt(i, transform.matrix);
        uv.set(item.uv, i * 4);
        speed[i] = item.speed ? 1 : 0;
        transform.position.y = item.z / 2;
        transform.rotation.set(0, 0, 0);
        transform.scale.set(1, item.z, 1);
        transform.updateMatrix();
        posts.setMatrixAt(i, transform.matrix);
      });
      geometry.setAttribute("signUv", new THREE.InstancedBufferAttribute(uv, 4));
      geometry.setAttribute("speedPlate", new THREE.InstancedBufferAttribute(speed, 1));
      for (const mesh of [plates, posts]) {
        mesh.computeBoundingSphere();
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        root.add(mesh);
      }
    }
  root.userData.signCount = signs.length;
  root.userData.atlas = pages[0].texture;
  root.userData.atlasPages = pages.length;
  return root;
}

function makePage(anisotropy) {
  const canvas = document.createElement("canvas");
  canvas.width = TILE_W * COLS;
  canvas.height = TILE_H * ROWS;
  const ctx = canvas.getContext("2d");
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Number.isFinite(anisotropy) ? Math.max(1, Math.min(8, anisotropy)) : 1;
  const plateMaterial = new THREE.MeshStandardMaterial({
    map: texture,
    roughness: 0.65,
    metalness: 0.1,
    side: THREE.DoubleSide,
  });
  plateMaterial.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nattribute vec4 signUv;\nattribute float speedPlate;\nvarying vec4 vSignUv;\nvarying float vSpeedPlate;",
      )
      .replace(
        "#include <uv_vertex>",
        "#include <uv_vertex>\nvSignUv = signUv;\nvSpeedPlate = speedPlate;\nvMapUv = vMapUv * signUv.zw + signUv.xy;",
      );
    // Street plates are printed on both sides; the rear must not mirror the lettering.
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec4 vSignUv;\nvarying float vSpeedPlate;")
      .replace(
        "#include <map_fragment>",
        `if (!gl_FrontFacing && vSpeedPlate > 0.5) {
          diffuseColor.rgb *= vec3(0.29, 0.32, 0.33);
        } else {
          ${THREE.ShaderChunk.map_fragment.replace(
            "vMapUv",
            "vec2(gl_FrontFacing ? vMapUv.x : 2.0 * vSignUv.x + vSignUv.z - vMapUv.x, vMapUv.y)",
          )}
        }`,
      );
  };
  plateMaterial.customProgramCacheKey = () => "street-sign-atlas-v3";
  return { canvas, ctx, texture, material: plateMaterial, chunks: new Map() };
}
