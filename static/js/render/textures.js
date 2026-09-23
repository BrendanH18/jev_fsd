// Procedural textures drawn on canvases at startup: no image assets to download or license.
// Noise is tileable so surfaces repeat without seams; a second low-frequency "macro" texture is
// sampled at a much larger scale to break up the visible repetition on big surfaces.

import * as THREE from "three";

let maxAnisotropy = 8;
export function setMaxAnisotropy(n) { maxAnisotropy = Math.max(1, n); }

function hash(x, y, seed) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed + 1, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Tileable value noise; x, y in cells, wraps every `period` cells.
function valueNoise(x, y, period, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const w = (a) => ((a % period) + period) % period;
  const a = hash(w(xi), w(yi), seed), b = hash(w(xi + 1), w(yi), seed);
  const c = hash(w(xi), w(yi + 1), seed), d = hash(w(xi + 1), w(yi + 1), seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

// Fractal noise in [0, 1] at pixel (px, py) of an N-pixel tile, `period` cells across at the base octave.
function fbm(px, py, N, period, octaves, seed) {
  let sum = 0, amp = 0.5, norm = 0, f = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise((px / N) * period * f, (py / N) * period * f, period * f, seed + o * 31);
    norm += amp; amp *= 0.5; f *= 2;
  }
  return sum / norm;
}

function canvas(size) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  return c;
}

function toTexture(c, { srgb = true, repeat = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = maxAnisotropy;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

// Fill every pixel from fn(px, py) -> [r, g, b] (0..255).
function paint(size, fn) {
  const c = canvas(size);
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const [r, g, b] = fn(x, y);
    const i = (y * size + x) * 4;
    img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

const clamp255 = (v) => Math.max(0, Math.min(255, v));
const cache = new Map();
const once = (key, make) => { if (!cache.has(key)) cache.set(key, make()); return cache.get(key); };

export const asphaltTexture = () => once("asphalt", () => toTexture(paint(512, (x, y) => {
  const n = fbm(x, y, 512, 8, 4, 1);
  const grain = hash(x, y, 9);
  let v = 86 + (n - 0.5) * 24 + (grain - 0.5) * 18;
  if (grain > 0.985) v += 40;           // light aggregate
  else if (grain < 0.01) v -= 18;       // dark pits
  return [clamp255(v), clamp255(v + 1), clamp255(v + 4)];
})));

export const grassTexture = () => once("grass", () => toTexture(paint(512, (x, y) => {
  const patch = fbm(x, y, 512, 6, 4, 3);
  const blade = hash(x, y, 5);
  const dry = fbm(x, y, 512, 3, 2, 7);
  const t = patch * 0.8 + blade * 0.35;
  let r = 62 + t * 34, g = 96 + t * 40, b = 40 + t * 16;
  if (dry > 0.62) { const k = (dry - 0.62) * 2.2; r += 40 * k; g += 16 * k; }
  return [clamp255(r), clamp255(g), clamp255(b)];
})));

// Low-frequency variation, sampled at a large scale on grass and asphalt.
export const macroTexture = () => once("macro", () => toTexture(paint(256, (x, y) => {
  const v = fbm(x, y, 256, 4, 5, 13) * 255;
  return [v, v, v];
}), { srgb: false }));

// Sidewalk concrete; u runs along the sidewalk, one tile per 1.5 m slab, with the joint at u = 0.
export const concreteTexture = () => once("concrete", () => {
  const c = paint(256, (x, y) => {
    const n = fbm(x, y, 256, 6, 4, 21);
    const g = hash(x, y, 4);
    const v = 176 + (n - 0.5) * 26 + (g - 0.5) * 12;
    return [clamp255(v), clamp255(v - 1), clamp255(v - 4)];
  });
  const ctx = c.getContext("2d");
  ctx.fillStyle = "rgba(60,60,60,0.55)";
  ctx.fillRect(0, 0, 3, 256);
  return toTexture(c);
});

export const curbTexture = () => once("curb", () => toTexture(paint(128, (x, y) => {
  const v = 196 + (fbm(x, y, 128, 4, 3, 17) - 0.5) * 24;
  return [v, v, v - 3];
})));

// Asphalt shingles: rows every 1/16 of the tile with staggered tab gaps and per-tab shade.
export const shingleTexture = () => once("shingle", () => {
  const rows = 16, tabs = 8, size = 512;
  const rowH = size / rows, tabW = size / tabs;
  return toTexture(paint(size, (x, y) => {
    const row = Math.floor(y / rowH);
    const off = (row % 2) * tabW / 2;
    const tab = Math.floor(((x + off) % size) / tabW);
    const inRow = (y % rowH) / rowH;
    const gap = ((x + off) % tabW) < 2;
    let v = 200 + (hash(tab, row, 3) - 0.5) * 50 + (hash(x, y, 8) - 0.5) * 30;
    v *= 0.72 + 0.28 * inRow;            // shadow under the row above
    if (gap || inRow < 0.08) v *= 0.45;
    return [clamp255(v), clamp255(v), clamp255(v)];
  }));
});

export const flatRoofTexture = () => once("flatroof", () => toTexture(paint(256, (x, y) => {
  const n = fbm(x, y, 256, 5, 4, 29);
  const g = hash(x, y, 2);
  const v = 150 + (n - 0.5) * 40 + (g - 0.5) * 30;
  return [clamp255(v), clamp255(v), clamp255(v + 2)];
})));

// Facades: one tile is 12 m x 12 m (4 bays x 4 floors of 3 m). Returns { map, mask } where mask is
// white where the building's tint applies (wall) and black on glass and trim.
export function facadeTextures(kind) {
  return once("facade:" + kind, () => {
    const size = 512, m = size / 12;           // pixels per meter
    const map = canvas(size), mask = canvas(size);
    const c = map.getContext("2d"), k = mask.getContext("2d");
    const Y = (h) => size - h * m;             // canvas y of a height (v = 0 is the ground)
    k.fillStyle = "#fff"; k.fillRect(0, 0, size, size);
    if (kind === "house") {
      c.fillStyle = "#f4f2ee"; c.fillRect(0, 0, size, size);
      // lap siding: a shadow line every 0.2 m
      for (let h = 0; h < 12; h += 0.2) {
        c.fillStyle = "rgba(0,0,0,0.10)"; c.fillRect(0, Y(h) - 2, size, 2);
        c.fillStyle = "rgba(255,255,255,0.10)"; c.fillRect(0, Y(h), size, 1);
      }
    } else {
      c.fillStyle = "#efece6"; c.fillRect(0, 0, size, size);
      const img = c.getImageData(0, 0, size, size);
      for (let i = 0; i < img.data.length; i += 4) {
        const d = (hash(i >> 2, 0, 55) - 0.5) * 14;
        img.data[i] += d; img.data[i + 1] += d; img.data[i + 2] += d;
      }
      c.putImageData(img, 0, 0);
      for (let f = 1; f < 4; f++) { c.fillStyle = "rgba(0,0,0,0.12)"; c.fillRect(0, Y(f * 3) - 3, size, 3); }
    }
    for (let floor = 0; floor < 4; floor++) {
      for (let bay = 0; bay < 4; bay++) {
        const r = hash(bay, floor, kind === "house" ? 41 : 43);
        if (kind === "house" && r < 0.18) continue;          // blank wall
        const store = kind === "block" && floor === 0;
        const w = store ? 2.6 : kind === "house" ? (r > 0.8 ? 1.9 : 1.1) : 1.8;
        const hgt = store ? 2.4 : kind === "house" ? 1.35 : 1.6;
        const sill = store ? 0.25 : 0.95;
        const x0 = (bay * 3 + (3 - w) / 2) * m, y0 = Y(floor * 3 + sill + hgt);
        const pw = w * m, ph = hgt * m;
        const trim = 0.09 * m;
        c.fillStyle = kind === "house" ? "#fbfbf8" : "#6b6e72";
        c.fillRect(x0 - trim, y0 - trim, pw + 2 * trim, ph + 2 * trim);
        if (kind === "house") { c.fillStyle = "#e9e7e1"; c.fillRect(x0 - trim * 1.6, y0 + ph + trim, pw + trim * 3.2, trim * 1.4); }
        const g = c.createLinearGradient(0, y0, 0, y0 + ph);
        const lit = hash(bay, floor, 77);
        g.addColorStop(0, lit > 0.5 ? "#8fa4b8" : "#7890a6");
        g.addColorStop(0.45, "#3b4a58");
        g.addColorStop(1, "#1f2a33");
        c.fillStyle = g; c.fillRect(x0, y0, pw, ph);
        if (lit > 0.7 && !store) { c.fillStyle = "rgba(226,214,188,0.55)"; c.fillRect(x0 + pw * 0.06, y0 + ph * 0.1, pw * 0.26, ph * 0.85); }
        // sky reflection streak
        c.fillStyle = "rgba(255,255,255,0.10)";
        c.beginPath(); c.moveTo(x0 + pw * 0.55, y0); c.lineTo(x0 + pw * 0.8, y0); c.lineTo(x0 + pw * 0.4, y0 + ph); c.lineTo(x0 + pw * 0.15, y0 + ph); c.fill();
        // mullions
        c.fillStyle = kind === "house" ? "#fbfbf8" : "#50545a";
        c.fillRect(x0 + pw / 2 - 1.5, y0, 3, ph);
        if (!store) c.fillRect(x0, y0 + ph * 0.42, pw, 3);
        k.fillStyle = "#000";
        k.fillRect(x0 - trim * 1.6, y0 - trim, pw + trim * 3.2, ph + trim * 2.4);
      }
    }
    // a darker foundation band at the bottom of each tile
    c.fillStyle = "rgba(40,36,32,0.35)"; c.fillRect(0, Y(0.35), size, 0.35 * m);
    k.fillStyle = "#000"; k.fillRect(0, Y(0.35), size, 0.35 * m);
    return { map: toTexture(map), mask: toTexture(mask, { srgb: false }) };
  });
}

export const stopSignTexture = () => once("stop", () => {
  const size = 256, c = canvas(size), ctx = c.getContext("2d");
  const oct = (r) => {
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = Math.PI / 8 + (i * Math.PI) / 4;
      const x = size / 2 + Math.cos(a) * r, y = size / 2 - Math.sin(a) * r;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.closePath();
  };
  ctx.fillStyle = "#ffffff"; oct(size / 2); ctx.fill();
  ctx.fillStyle = "#c8161d"; oct(size / 2 - 12); ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 78px Helvetica, Arial, sans-serif";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText("STOP", size / 2, size / 2 + 4);
  return toTexture(c, { repeat: false });
});

export const glowTexture = () => once("glow", () => {
  const size = 128, c = canvas(size), ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.18, "rgba(255,255,255,0.75)");
  g.addColorStop(0.45, "rgba(255,255,255,0.16)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  return toTexture(c, { repeat: false });
});

// Soft dark ellipse for contact shadows under cars.
export const blobTexture = () => once("blob", () => {
  const size = 128, c = canvas(size), ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(0,0,0,0.75)");
  g.addColorStop(0.55, "rgba(0,0,0,0.45)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  return toTexture(c, { repeat: false, srgb: false });
});

// Vertical fade for the destination beam: opaque at the bottom, clear at the top.
export const beamTexture = () => once("beam", () => {
  const c = canvas(64), ctx = c.getContext("2d");
  const g = ctx.createLinearGradient(0, 64, 0, 0);
  g.addColorStop(0, "rgba(255,255,255,0.9)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  return toTexture(c, { repeat: false });
});

// Blend the material's map with a large-scale macro texture to hide tiling. `macroScale` is how many
// map tiles one macro tile spans (inverse); `strength` is the brightness swing.
export function withMacroVariation(material, macroScale, strength = 0.35) {
  const macro = macroTexture();
  material.onBeforeCompile = (shader) => {
    shader.uniforms.macroMap = { value: macro };
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <map_pars_fragment>", "#include <map_pars_fragment>\nuniform sampler2D macroMap;")
      .replace("#include <map_fragment>", `#include <map_fragment>
        float macroV = texture2D( macroMap, vMapUv * ${macroScale.toFixed(5)} ).r * 0.6 + texture2D( macroMap, vMapUv * ${(macroScale * 3.7).toFixed(5)} + 0.31 ).r * 0.4;
        diffuseColor.rgb *= 1.0 + (macroV - 0.5) * ${(strength * 2).toFixed(3)};`);
  };
  material.customProgramCacheKey = () => "macro" + macroScale + ":" + strength;
  return material;
}
