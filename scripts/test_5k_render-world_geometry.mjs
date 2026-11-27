import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { registerHooks } from "node:module";

const vendor = new URL("../static/vendor/three/", import.meta.url);
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "three") return next(new URL("build/three.module.js", vendor).href, context);
    if (specifier.startsWith("three/addons/"))
      return next(new URL(specifier.replace("three/addons/", "examples/jsm/"), vendor).href, context);
    return next(specifier, context);
  },
});

const THREE = await import("three");
const { MapData } = await import("../static/js/map/mapdata.js");
const { sceneryFor } = await import("../static/js/map/scenery.js");
const { buildBuildings, FootprintIndex } = await import("../static/js/render/buildings.js");
const { buildBusLanes } = await import("../static/js/render/bus-lanes.js");
const { buildCityIdentity } = await import("../static/js/render/city-identity.js");
const { buildStreetLights } = await import("../static/js/render/citylights.js");
const { GeoBuilder, RibbonPath } = await import("../static/js/render/geo.js");
const { chunkLOD } = await import("../static/js/render/lod.js");
const { buildRoads } = await import("../static/js/render/roads.js");
const { buildScrambleMarkings } = await import("../static/js/render/scrambles.js");
const { LAYER } = await import("../static/js/render/scene.js");
const { buildStreetSigns } = await import("../static/js/render/signs.js");
const { inVancouver, buildSurroundings } = await import("../static/js/render/surroundings.js");
const { cutoutTexture } = await import("../static/js/render/textures.js");
const { buildTrees } = await import("../static/js/render/trees.js");
const { lighting } = await import("../static/js/render/atmosphere.js");

let canvases = 0;
globalThis.document = {
  createElement() {
    canvases++;
    const strokes = [];
    const context = {
      fillRect() {},
      fillText(...args) {
        strokes.push(args.join(" "));
      },
      strokeRect() {},
      roundRect() {},
      quadraticCurveTo() {},
      clearRect() {},
      beginPath() {},
      moveTo() {},
      lineTo() {},
      closePath() {},
      stroke() {},
      fill() {},
      ellipse() {},
      arc() {},
      save() {},
      restore() {},
      translate() {},
      rotate() {},
      scale() {},
      createLinearGradient() {
        return { addColorStop() {} };
      },
      createRadialGradient() {
        return { addColorStop() {} };
      },
      measureText(text) {
        return { width: String(text).length * 19 };
      },
      createImageData(width, height) {
        return { width, height, data: new Uint8ClampedArray(width * height * 4) };
      },
      getImageData(_x, _y, width, height) {
        return this.createImageData(width, height);
      },
      putImageData() {},
    };
    return { getContext: () => context, strokes };
  },
};

const attrs = (b, attribute) => b.toGeometry().getAttribute(attribute).array.join(",");
const route = [
  [0, 0],
  [6, 0],
  [10, 3],
  [10, 8],
  [14, 8],
];
const prepared = new RibbonPath(route);
const draw = (points, from, to, uv = "along") => {
  const b = new GeoBuilder();
  b.ribbon(points, -1.5, 2, 0, { from, to, uv });
  return b;
};
const options = [5, 14];
const reused = draw(prepared, ...options);
const raw = draw(route, ...options);
assert.equal(attrs(reused, "position"), attrs(raw, "position"), "reused miter rows preserve the ribbon");
assert.equal(attrs(reused, "uv"), attrs(raw, "uv"), "reused miter rows preserve along-route UVs");
assert.equal(draw(prepared, 6, 11).pos.length, 18, "only the next segment is included at an exact start boundary");
assert.equal(draw(prepared, -5, 0).empty, true, "ranges before the street emit no geometry");
assert.equal(draw(prepared, 20, Infinity).empty, true, "ranges after the street emit no geometry");
assert.equal(draw(prepared, NaN, 10).empty, true, "NaN ranges cannot expose the full street");
for (const [left, right, z, scale] of [
  [NaN, 1, 0, 1],
  [-1, Infinity, 0, 1],
  [-1, 1, NaN, 1],
  [-1, 1, 0, 0],
  [-1, 1, 0, Infinity],
]) {
  const b = new GeoBuilder();
  b.ribbon(prepared, left, right, z, { scale });
  assert.equal(b.empty, true);
}
assert.equal(
  draw(
    [
      [0, 0],
      [NaN, 0],
      [10, 0],
    ],
    0,
    10,
  ).empty,
  true,
);
const triangle = new GeoBuilder({ colors: true });
triangle.polygon(
  [
    [0, 0],
    [0, 1],
    [1, 0],
  ],
  0,
);
assert.equal(triangle.pos.length, 9);
assert.equal(triangle.nrm[1], 1);
assert.equal(
  triangle.col.every((value) => value === 1),
  true,
  "missing vertex tint is white",
);
triangle.tri([0, 0, 0], [0, Infinity, 0], [1, 0, 0]);
triangle.polygon(
  [
    [0, 0],
    [0, 1],
    [1, 0],
  ],
  Infinity,
);
triangle.polygon([
  [0, 0],
  [1, NaN],
  [1, 0],
]);
triangle.polygon(
  [
    [0, 0],
    [0, 1],
    [1, 0],
  ],
  0,
  { scale: 0 },
);
triangle.rect(0, 0, 0, -1, 2);
assert.equal(triangle.pos.length, 9, "bad geometry never poisons the batch bounds");

const ring = [
  [-10, -10],
  [10, -10],
  [10, 10],
  [-10, 10],
];
const footprints = new FootprintIndex(
  [
    ring,
    [
      [0, 0],
      [5, 10],
      [NaN, 0],
    ],
    [
      [80, 80],
      [90, 90],
    ],
  ],
  0,
);
assert.equal(footprints.cell, 25);
assert.equal(footprints.near(-1, -1, 0), true);
assert.equal(footprints.near(-12, 0, 3), true);
assert.equal(footprints.near(12, 0, 1), false);
assert.equal(footprints.near(Infinity, 0, 2), false);
assert.equal(footprints.near(Number.MAX_VALUE, 0, 0), false);
assert.equal(footprints.near(0, 0, -1), false);
assert.equal(footprints.near(0, 0, Infinity), false);
assert.equal(footprints.near(1e6, 1e6, 2e6), true);
assert.equal(footprints.near(85, 85, 0), false);

const near = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
const far = near.clone();
near.position.set(42, 3, -90);
far.position.set(44, 3, -90);
near.visible = false;
const lod = chunkLOD(near, far, NaN);
assert.equal(near.visible, true);
assert.equal(far.visible, false);
assert.equal(near.getWorldPosition(new THREE.Vector3()).x, 42);
assert.equal(far.getWorldPosition(new THREE.Vector3()).x, 44);
assert.equal(lod.levels[1].distance > 100, true);

const image = { width: 3, height: 1, data: new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 255, 30, 10, 255]) };
const texture = cutoutTexture(image, 0.5);
assert.equal(texture.mipmaps.length, 2);
assert.equal(texture.mipmaps.at(-1).data[0], 255, "odd-width cutouts include the last column");
assert.equal(texture.mipmaps[0].data[0], 255, "transparent texels inherit edge color");
const vertical = cutoutTexture({ ...image, width: 1, height: 3 }, 0.5);
assert.equal(vertical.mipmaps.at(-1).data[0], 255, "odd-height cutouts include the last row");
const solid = cutoutTexture({ width: 1, height: 1, data: new Uint8Array([70, 80, 90, 255]) }, 0.5);
assert.equal(solid.mipmaps[0].data.join(","), "70,80,90,255");

const empty = { edges: new Map(), intersections: new Map() };
const fixture = {};
const placements = sceneryFor(fixture);
const emptyTrees = buildTrees(fixture);
assert.equal(emptyTrees.children.length, 0);
assert.equal(canvases, 0, "treeless maps skip procedural textures");
assert.equal(buildStreetSigns(fixture).userData.signCount, 0);
assert.equal(canvases, 0, "signless maps skip the atlas");
assert.equal(buildBuildings(fixture).children.length, 0);
assert.equal(canvases, 0, "empty building chunks do not generate facade or roof textures");
assert.equal(buildStreetLights(fixture, new THREE.Group()).lights, null);
assert.equal(buildRoads(empty).group.children.length, 0);
assert.equal(canvases, 0, "empty road layers skip surface textures");
assert.equal(buildScrambleMarkings({ ...empty, scrambles: new Set(["missing"]) }).children.length, 0);
assert.equal(buildCityIdentity(null, "constructor").children.length, 0);
assert.equal(inVancouver({ lat: NaN, lon: -123.16 }), false);
assert.equal(inVancouver({ lat: 49.265, lon: -123.16 }), true);
const outskirts = buildSurroundings({ extent: [0, 0, 100, 100], pack: { origin: { lat: NaN } } });
assert.equal(
  outskirts.children.some((mesh) => mesh.renderOrder === LAYER.water),
  false,
);
assert.equal(
  outskirts.children.some((mesh) => mesh.isInstancedMesh && mesh.count > 0),
  true,
);

for (let i = 0; i < 130; i++) {
  placements.streetSigns.push({ x: i * 2, y: 0, z: 2, heading: 0, text: `Street ${i}`, width: 2, height: 0.4 });
}
placements.streetSigns.push({ ...placements.streetSigns[0], text: "50", speed: true });
placements.streetSigns.push({ ...placements.streetSigns[0], x: 500 });
const signs = buildStreetSigns(fixture, { anisotropy: NaN });
const plates = signs.children.filter((mesh) => mesh.geometry.hasAttribute("signUv"));
const posts = signs.children.filter((mesh) => !mesh.geometry.hasAttribute("signUv"));
assert.equal(signs.userData.signCount, 132, "unique sign labels beyond one page still render");
assert.equal(signs.userData.atlasPages, 2);
assert.equal(
  plates.reduce((count, mesh) => count + mesh.count, 0),
  132,
);
assert.equal(new Set(posts.map((mesh) => mesh.geometry)).size, 1);
assert.equal(plates[0].material.map.anisotropy, 1);
assert.equal(plates[0].material.map.colorSpace, THREE.SRGBColorSpace);
assert.equal(plates[0].material.map.image.strokes.filter((line) => line.startsWith("Street 0 ")).length, 1);
const speedPlate = plates.find((mesh) => mesh.geometry.getAttribute("speedPlate").array.includes(1));
assert.equal(speedPlate.geometry.getAttribute("speedPlate").array.filter((v) => v === 1).length, 1);
const plateShader = {
  vertexShader: "#include <common>\n#include <uv_vertex>",
  fragmentShader: "#include <common>\n#include <map_fragment>",
};
speedPlate.material.onBeforeCompile(plateShader);
assert.match(plateShader.fragmentShader, /!gl_FrontFacing && vSpeedPlate/);
assert.match(plateShader.fragmentShader, /2\.0 \* vSignUv\.x \+ vSignUv\.z - vMapUv\.x/);

const lane = {
  pts: [
    [0, 0],
    [30, 0],
    [30, 45],
  ],
  cum: [0, 30, 75],
  length: 75,
  edgeRef: { lane_width: 3.6 },
};
const bus = buildBusLanes({
  buslanes: [
    { edge: "ok", lane: 0 },
    { edge: "missing", lane: 0 },
  ],
  lane: (id) => (id === "ok" ? lane : null),
});
assert.equal(bus.children.length, 2);
const [tint, paint] = bus.children;
assert.equal(tint.renderOrder, LAYER.asphalt + 1);
assert.equal(tint.material.transparent, false, "blend the tint within opaque ground ordering");
assert.equal(tint.material.blending, THREE.CustomBlending);
assert.equal(tint.geometry.getAttribute("position").count, 12, "surface follows both parts of the bend");
assert.equal(paint.renderOrder, LAYER.marking);
assert.equal(paint.isInstancedMesh, true);
assert.equal(paint.count, 1);
assert.equal(paint.material.alphaTest > 0, true);
assert.equal(
  bus.children.every((mesh) => mesh.material.depthTest && !mesh.material.depthWrite),
  true,
);
assert.equal(buildBusLanes({}).children.length, 0);

const lightGroup = new THREE.Group();
placements.lamps.push(
  { x: 0, y: 0, lx: 0, ly: 0, h: 7, heading: 0, tall: false },
  { x: 80, y: 0, lx: 80, ly: 0, h: 8.4, heading: 0, tall: true },
);
const streetLights = buildStreetLights(fixture, lightGroup);
assert.equal(streetLights.lights.lights.length, 2);
const camera = new THREE.PerspectiveCamera();
const parent = new THREE.Group();
parent.add(camera);
lighting.night.value = 1;
streetLights.lights.update(camera, 0);
const first = streetLights.lights.lights[0];
assert.equal(first.position.x, 0);
parent.position.x = 80;
streetLights.lights.update(camera, 0);
assert.equal(first.position.x, 80, "camera teleports reselect lamps even on a paused frame");
streetLights.setOutage(true);
assert.equal(first.parent.visible, false);
streetLights.setOutage(false);
assert.equal(first.parent.visible, true);
lighting.night.value = 0;
streetLights.lights.update(camera, 0);
assert.equal(first.intensity, 0);

const file = new URL("../data/maps/", import.meta.url);
const packName = readdirSync(file).find((name) => /^623b012bc8b5\.v\d+\.pack\.json$/.test(name));
assert.equal(typeof packName, "string", "Kitsilano pack present");
const map = new MapData(JSON.parse(readFileSync(new URL(packName, file), "utf8")));
map.crosswalks.push({ edge: "removed", markings: "lines" });
const roads = buildRoads(map);
const asphalt = roads.group.children.filter((mesh) => mesh.renderOrder === LAYER.asphalt);
assert.equal(asphalt.length > 1, true, "real streets cull in independent chunks");
assert.equal(new Set(asphalt.map((mesh) => mesh.material)).size, 1);
assert.equal(
  asphalt.every((mesh) => mesh.geometry.boundingSphere.radius > 0),
  true,
);
assert.equal(
  asphalt.every((mesh) => mesh.material.depthTest && !mesh.material.depthWrite),
  true,
);
// Pin the visual signal protocol independently of the simulation clock and map pack variants.
const signalsMap = { edges: new Map() };
const fixtures = sceneryFor(signalsMap);
const signal = { id: "alpha", plan: { advance: { style: "arrow", edge: "west" } } };
fixtures.signals.push(
  {
    inter: signal,
    a: { edge: "west", group: "A" },
    e: { lane_offsets: [1.8, 5.4] },
    heading: 0,
    x: 0,
    y: 0,
    poleLat: 8.2,
  },
  {
    inter: signal,
    a: { edge: "east", group: "B" },
    e: { lane_offsets: [1.8] },
    heading: Math.PI,
    x: 40,
    y: 0,
    poleLat: 4,
  },
);
const signalRoads = buildRoads(signalsMap);
const renderGroup = signalRoads.group;
const signalViews = signalRoads.signals;
const batches = renderGroup.children.filter((mesh) => mesh.geometry?.hasAttribute("signalStrength"));
assert.equal(batches.length, 6, "four map-wide face batches and two separately sorted mast glows");
assert.equal(
  batches.every((mesh) => mesh.isInstancedMesh && !mesh.castShadow),
  true,
);
assert.equal(
  renderGroup.children.some((object) => object.isSprite),
  false,
);
const active = (mesh) => {
  const { signalColor, signalStrength } = mesh.geometry.attributes;
  const colors = [];
  for (let i = 0; i < signalStrength.count; i++) {
    if (signalStrength.getX(i) > 0.04) {
      colors.push(new THREE.Color(signalColor.getX(i), signalColor.getY(i), signalColor.getZ(i)).getHex());
    }
  }
  return colors;
};
const namedActive = (name) => active(renderGroup.getObjectByName(name));
const balls = () => namedActive("Traffic signal lenses");
const arrows = () => namedActive("Traffic signal arrows");
const glows = () => namedActive("Traffic signal glows");
const walk = () => namedActive("Pedestrian walk signals").length;
const hand = () => namedActive("Pedestrian hand signals").length;
const face = (name) => renderGroup.getObjectByName(name).geometry.attributes.signalStrength.getX(0);
const red = 0xff2a1a,
  amber = 0xffb21a,
  green = 0x1aff8c;
assert.deepEqual(glows(), [], "new signal glows start unlit");
signalViews.set("alpha", { "@west": "arrow" }, 0.1);
assert.deepEqual(balls(), [red, red, red], "protected left retains the through red balls");
assert.deepEqual(arrows(), [green], "protected left lights only the green arrow");
assert.deepEqual(glows().sort(), [red, red, red, green].sort(), "each active lens gets a matching glow");
const versions = () => batches.map((mesh) => mesh.geometry.attributes.signalStrength.version);
const unchanged = versions();
signalViews.set("alpha", { "@west": "arrow" }, 0.2);
assert.deepEqual(versions(), unchanged, "steady phases leave instance buffers alone");
signalViews.set("alpha", { "@west": "arrow_yellow" });
assert.deepEqual(arrows(), [amber]);
assert.deepEqual(balls(), [red, red, red]);
signalViews.set("alpha", { "@west": "advance" }, 0.1);
assert.deepEqual(balls(), [green, green, green]);
assert.deepEqual(arrows(), []);
signalViews.set("alpha", { "@west": "advance" }, 0.6);
assert.deepEqual(balls(), []);
signalViews.set("alpha", { "@west": "flashing_amber" }, 0.1);
assert.deepEqual(balls(), [amber, amber, amber]);
signalViews.set("alpha", { "@west": "flashing_red" }, 0.1);
assert.deepEqual(balls(), [red, red, red]);
signalViews.set("alpha", { "@west": "dark", u: "green" }, 0.1);
assert.deepEqual(balls(), []);
assert.deepEqual(glows(), []);
assert.equal(renderGroup.getObjectByName("Traffic signal glows").visible, false, "dark masts submit no glow draw");
signalViews.set("alpha", { "@east": "green" });
assert.deepEqual(balls(), [green, green]);
const mastGlows = batches.filter((mesh) => mesh.name === "Traffic signal glows");
assert.deepEqual(
  mastGlows.map((mesh) => mesh.visible),
  [false, true],
  "skip the dark mast",
);
assert.deepEqual(mastGlows.map(active), [[], [green, green]], "one approach does not light the other mast");
signalViews.setPed("alpha", { A: "walk" }, 0.4);
assert.deepEqual([walk(), hand()], [1, 0]);
assert.equal(face("Pedestrian hand signals"), -1, "the opaque hand face cannot cover the walk symbol");
signalViews.setPed("alpha", { A: "flash" }, 0.3);
assert.deepEqual([walk(), hand()], [0, 1]);
signalViews.setPed("alpha", { A: "flash" }, 0.7);
assert.equal(hand(), 0);
signalViews.setPed("alpha", { A: "dont" }, 0.7);
assert.equal(hand(), 1);
signalViews.setPed("alpha", { A: "dark" }, 0.7);
assert.deepEqual([walk(), hand()], [0, 0]);
assert.equal(face("Pedestrian walk signals"), -1);
assert.equal(face("Pedestrian hand signals"), 0, "a dark head still shows an unlit face");

const crossings = [
  [0, 0],
  [1, 0],
  [10, 0],
  [10, 1],
];
const direct = draw(crossings, 0, Infinity, "world");
const firstUV = direct.toGeometry().getAttribute("uv");
const firstPosition = direct.toGeometry().getAttribute("position");
assert.equal(firstUV.getX(0), firstPosition.getX(0), "the world-space U coordinate follows the easting");
assert.equal(firstUV.getY(0), -firstPosition.getZ(0), "the world-space V coordinate follows the northing");
const uturn = draw(
  [
    [0, 0],
    [2, 0],
    [0, 0],
    [-2, 0],
  ],
  0,
  Infinity,
);
assert.equal(uturn.pos.every(Number.isFinite), true, "a backtracking input uses finite joins");
const straight = draw(
  [
    [-4, 0],
    [4, 0],
  ],
  0,
  Infinity,
);
assert.equal(straight.pos.length / 3, 6, "one straight strip emits exactly two triangles");
assert.equal(
  straight.nrm.filter((_, i) => i % 3 === 1).every((v) => v === 1),
  true,
);
assert.equal(direct.pos.every(Number.isFinite), true);

const identity = buildCityIdentity({ extent: [-700, -700, 300, 800] }, "saskatoon");
const arches = identity.children.filter((mesh) => mesh.geometry.type === "TorusGeometry");
assert.equal(arches.length, 5);
assert.equal(new Set(arches.map((mesh) => mesh.geometry)).size, 1);
assert.equal(
  arches.every((mesh) => mesh.position.z === -1280),
  true,
);
const toronto = buildCityIdentity({ extent: [-100, -100, 100, 100] }, "toronto");
assert.equal(
  toronto.children.some((mesh) => mesh.position.y > 190),
  true,
);
assert.equal(toronto.userData.decorative, true);
const house = buildBuildings({ pack: { buildings: [{ h: 8, pts: ring }] } });
const roofs = house.children.filter((mesh) => mesh.material.userData.surface === "roof");
assert.equal(roofs.length > 0, true);
assert.equal(
  roofs.every((mesh) => mesh.castShadow && mesh.receiveShadow),
  true,
);
assert.equal(house.userData.index.near(0, 0, 0), true);
console.log("World geometry, scenery, signs and street-light checks passed.");
