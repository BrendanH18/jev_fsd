import assert from "node:assert/strict";
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
const { atmosphereFor, glowsAtNight, lighting, sunPosition, updateNightMaterials } = await import(
  "../static/js/render/atmosphere.js"
);
const { buildBackdrop, tintBackdrop } = await import("../static/js/render/backdrop.js");
const { CinematicCamera, CINEMATIC_SHOTS } = await import("../static/js/render/cinematic-camera.js");
const { Minimap } = await import("../static/js/render/minimap.js");
const { OrbitCamera } = await import("../static/js/render/orbit-camera.js");
const { Overlays } = await import("../static/js/render/overlays.js");
const { PostFX } = await import("../static/js/render/post.js");
const { GroundReflection, reflection, wetReflective } = await import("../static/js/render/reflection.js");
const { SceneView } = await import("../static/js/render/scene.js");
const { setMaxAnisotropy, withMacroVariation } = await import("../static/js/render/textures.js");
const { snowable, WeatherView } = await import("../static/js/render/weather.js");

class Context {
  calls = [];
  save() {}
  restore() {}
  fillText() {}
  fillRect() {}
  beginPath() {}
  rect() {}
  clip() {}
  moveTo() {}
  lineTo() {}
  stroke() {}
  closePath() {}
  translate() {}
  rotate() {}
  setLineDash() {}
  drawImage() {}
  fill(rule) {
    this.calls.push(rule);
  }
  arc(x, y) {
    assert.equal(Number.isFinite(x) && Number.isFinite(y), true);
  }
  createImageData(width, height) {
    return { width, height, data: new Uint8ClampedArray(width * height * 4) };
  }
  putImageData() {}
  createLinearGradient() {
    return { addColorStop() {} };
  }
  createRadialGradient() {
    return { addColorStop() {} };
  }
}
class Canvas extends EventTarget {
  width = 200;
  height = 150;
  ctx = new Context();
  getContext() {
    return this.ctx;
  }
  getBoundingClientRect() {
    return { width: 100, height: 75, left: 10, top: 20 };
  }
}
globalThis.document = { createElement: () => new Canvas() };
globalThis.Image = class {};
globalThis.Path2D = Context;

const ego = { x: 0, y: 0, psi: 0, v: 6 };
const orbit = new OrbitCamera();
const azimuth = orbit.azimuth;
orbit.rotate(NaN, 10);
assert.equal(orbit.azimuth, azimuth);
assert.equal(orbit.elevation < 0.34, true);
const elevation = orbit.elevation;
orbit.rotate(10, Infinity);
assert.equal(orbit.elevation, elevation);
assert.equal(orbit.azimuth !== azimuth, true);
orbit.setDistance(1, { length: NaN });
assert.equal(orbit.distance, 4.2);
orbit.setDistance(1, { length: -4 });
assert.equal(orbit.distance, 4.2);
assert.equal(orbit.pose(ego, NaN).z, orbit.pose(ego).z);

const director = new CinematicCamera();
const reverse = director.pose({ ...ego, v: -6 });
assert.equal(reverse.position[0] < 0, true);
assert.equal(director.pose({ ...ego, x: -70 }, 2).shot, "trackside");
assert.equal(director.pose({ ...ego, x: -70 }, 2).shot, "bumper");
director.reset();
director.pose(ego);
director.pose(ego, NaN);
director.pose(ego, Infinity);
director.pose(ego, -1);
assert.equal(director.elapsed, 0);
assert.equal(
  director.pose({ ...ego, x: 70, psi: Math.PI }, 4).shot,
  "bumper",
  "a turn after the pass cannot extend the shot",
);
director.reset();
assert.equal(director.pose({ ...ego, v: Infinity }).position[0], 18);
assert.equal(Object.isFrozen(CINEMATIC_SHOTS), true);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(58, 1, 0.3, 6000);
let projectionUpdates = 0;
const originalUpdate = camera.updateProjectionMatrix.bind(camera);
camera.updateProjectionMatrix = () => {
  projectionUpdates++;
  originalUpdate();
};
const view = Object.assign(Object.create(SceneView.prototype), {
  camera,
  scene,
  camPos: new THREE.Vector3(),
  camLook: new THREE.Vector3(),
  orbit,
  cinematic: director,
  sky: new THREE.Object3D(),
  sceneryLODs: new Set(),
  look: { exposure: 0, contrast: 0, saturation: 0, vignette: 0 },
  applyLook() {},
  followShadow() {},
});
view.setCamera("chase");
view.updateCamera(ego, 0);
const back = camera.position.x;
view.updateCamera({ ...ego, x: 10 }, -10);
assert.equal(camera.position.x, back, "negative frame time cannot extrapolate the camera");
view.updateCamera({ ...ego, x: 10 }, NaN);
assert.equal(camera.position.x, back);
assert.equal(projectionUpdates, 0, "steady camera field of view reuses the projection");
view.setCamera("hood");
view.updateCamera({ ...ego, ax: Infinity, latAccel: NaN }, 0.1);
assert.equal(Number.isFinite(camera.quaternion.x), true);
assert.equal(view.cameraPitch, 0);
assert.equal(view.cameraRoll, 0);
assert.equal(projectionUpdates, 1);
view.updateCamera(ego, 0.1);
assert.equal(projectionUpdates, 1);
const changes = view.setLook(JSON.parse('{"__proto__":1,"constructor":2,"exposure":1.2}'));
assert.equal(Object.hasOwn(changes, "constructor"), false);
assert.equal(Object.getPrototypeOf(view.look) === Object.prototype, true);
assert.equal(changes.exposure, 1.2);

const canvas = new Canvas();
const clear = new EventTarget();
const picks = [];
let clears = 0;
const empty = new Map();
const map = {
  extent: [0, 0, 100, 100],
  pack: {},
  edges: empty,
  intersections: empty,
  parks: [
    {
      closed: true,
      kind: "park",
      rings: [
        [
          [0, 0],
          [4, 0],
          [4, 4],
        ],
        [
          [1, 1],
          [1, 2],
          [2, 2],
        ],
      ],
    },
  ],
};
const mini = new Minimap(canvas, map, (point) => picks.push(point.join(",")), {
  clearButton: clear,
  onClearRoute: () => clears++,
});
assert.equal(mini.roads.ctx.calls.includes("evenodd"), true);
assert.equal(mini.pick(25, 0), true);
assert.equal(picks.at(-1), "0,100");
const planned = {
  pts: [
    [0, 0],
    [50, 50],
  ],
};
mini.draw({ route: planned, ego, destination: [NaN, 0], npcs: [{ x: NaN, y: 0 }] });
assert.equal(clear.hidden, false);
const path = mini.routePath;
canvas.width = 300;
mini.draw({ route: planned });
assert.equal(mini.routePath === path, false, "resize invalidates projected route pixels");
assert.equal(mini.roads.width, 300);
assert.equal(mini.pick(74, 0), false);
assert.equal(mini.pick(75, 0), true);
canvas.height = 0;
mini.draw({ route: planned });
assert.equal(clear.hidden, true);
assert.equal(mini.pickKeyboard(0, 0), false);
clear.dispatchEvent(new Event("click"));
assert.equal(clears, 1);
mini.dispose();
clear.dispatchEvent(new Event("click"));
assert.equal(clears, 1);
canvas.height = 150;
const click = new Event("click");
Object.assign(click, { clientX: 60, clientY: 50 });
canvas.dispatchEvent(click);
assert.equal(picks.length, 2, "dispose removes the pointer listener");
assert.equal(mini.roads.width, 0);
const invalid = new Minimap(new Canvas(), { ...map, extent: [0, 0, 0, 10] });
assert.equal(invalid.pick(0, 0), false);

const marker = new Overlays(scene);
marker.setRoute({
  pts: [
    [0, 0],
    [5, 0],
  ],
  endPoint: () => [NaN, 2],
});
assert.equal(marker.marker.visible, false);
assert.equal(marker.routeMesh.material.forceSinglePass, true);
marker.setRoute({
  pts: [
    [0, 0],
    [5, 0],
  ],
  endPoint: () => [5, 0],
});
marker.tick(1);
const pulse = marker.ring.scale.x;
marker.tick(Infinity);
assert.equal(marker.ring.scale.x, pulse);
const candidates = [
  {
    id: "a",
    eligible: true,
    trace: [
      [0, 0],
      [5, 0],
    ],
  },
];
marker.setCandidates(candidates, "a");
const chosen = marker.candidateMeshes[0];
marker.setCandidates(candidates, "a");
assert.equal(marker.candidateMeshes[0] === chosen, true);
marker.setCandidates(candidates, "b");
assert.equal(marker.candidateMeshes[0] === chosen, false);
marker.showCandidates = false;
marker.setCandidates(candidates, "b");
assert.equal(marker.candidateMeshes.length, 0);

const mock = new THREE.MeshStandardMaterial();
glowsAtNight(mock, 0, 2);
glowsAtNight(mock, 1, 3);
glowsAtNight(mock, 0.25, 1, "opacity");
lighting.night.value = 0.5;
updateNightMaterials();
assert.equal(mock.emissiveIntensity, 2);
assert.equal(mock.opacity, 0.625);
mock.dispose();
lighting.night.value = 1;
updateNightMaterials();
assert.equal(mock.emissiveIntensity, 2, "disposed materials leave the night-light registry");
assert.equal(atmosphereFor(NaN).hour, 15.5);
assert.equal(sunPosition(Infinity).dir.length(), sunPosition(15.5).dir.length());
const backdrop = buildBackdrop(new THREE.Vector3());
tintBackdrop(backdrop, atmosphereFor(15.5, "snow"));
assert.equal(backdrop.material.uniforms.snowCover.value, 1);
assert.equal(backdrop.material.uniforms.visible.value < 1, true);
tintBackdrop(backdrop, { ...atmosphereFor(15.5), weather: "constructor" });
assert.equal(backdrop.material.uniforms.visible.value, 1);

const weatherScene = new THREE.Scene();
const weatherCamera = new THREE.PerspectiveCamera();
const parent = new THREE.Group();
parent.add(weatherCamera);
parent.position.set(100, 90, -100);
const weather = new WeatherView({ scene: weatherScene, camera: weatherCamera });
const inherited = snowable(new THREE.MeshStandardMaterial(), "constructor");
const basic = new THREE.MeshBasicMaterial();
basic.userData.surface = "asphalt";
const plainGeo = new THREE.BoxGeometry();
weatherScene.add(new THREE.Mesh(plainGeo, [undefined, inherited, basic]));
weather.apply("rain");
assert.equal(Number.isFinite(inherited.color.r), true);
assert.equal(inherited.userData.snow.value, 0);
assert.equal(Object.hasOwn(basic, "roughness"), false);
assert.equal(Object.hasOwn(basic, "envMapIntensity"), false);
const rain = weather.rain.mesh.geometry.getAttribute("dropSeed");
const rainUniforms = weather.rain.mesh.material.uniforms;
assert.deepEqual(rainUniforms.weatherCamera.value.toArray(), [100, 90, -100]);
const rainVersion = rain.version;
weather.update(0);
weather.update(NaN);
weather.update(-1);
assert.equal(rain.version, rainVersion);
assert.equal(rainUniforms.weatherTime.value, 0);
parent.position.x += 80;
weather.update(0.1);
assert.equal(rain.version, rainVersion);
assert.equal(rainUniforms.weatherCamera.value.x, 180);
assert.equal(rainUniforms.weatherTime.value, 0.1);
const spray = weather.spray;
const carPose = { x: 100, y: 20, psi: 0, v: 10, spec: { track: 1.5, wheelbase: 2.5 } };
spray.begin(carPose, 0.25);
spray.add({ ...carPose, v: 0 });
spray.add({ ...carPose, x: 200 });
spray.add(carPose);
spray.add({ ...carPose, v: -5 });
spray.end();
assert.equal(spray.count, 2);
assert.deepEqual(Array.from(spray.vehicles.slice(0, 5)), [100, -20, 0.75, 10, 1]);
assert.deepEqual(Array.from(spray.vehicles.slice(8, 13)), [102.5, -20, 0.75, 5, -1]);
assert.equal(spray.phase.value, 0.5);
assert.equal(spray.mesh.visible, true);
spray.begin(carPose, 0.25);
spray.end();
assert.equal(spray.mesh.visible, false);
assert.equal(spray.mesh.geometry.attributes.spraySeed.version, 0);
weather.apply("snow");
const snow = weather.snow.mesh.geometry.getAttribute("position");
const snowUniforms = weather.snow.uniforms;
const snowVersion = snow.version;
weather.update(Infinity);
assert.equal(snowUniforms.weatherTime.value, 0);
weather.update(0.1);
assert.equal(snow.version, snowVersion);
assert.equal(snowUniforms.weatherTime.value, 0.1);

setMaxAnisotropy(NaN);
const material = new THREE.MeshStandardMaterial();
material.onBeforeCompile = function (shader) {
  shader.uniforms.previous = this;
};
material.customProgramCacheKey = () => "prior";
withMacroVariation(material, 0.1, 0.2);
snowable(material, "roof");
const coverage = material.userData.snow;
snowable(material, "grass");
wetReflective(material, 0.6);
const shader = {
  uniforms: {},
  vertexShader: "#include <common>\n#include <defaultnormal_vertex>\n#include <project_vertex>",
  fragmentShader:
    "#include <common>\n#include <map_pars_fragment>\n#include <map_fragment>\n#include <opaque_fragment>",
};
material.onBeforeCompile(shader, null);
assert.equal(shader.uniforms.previous === material, true);
assert.equal(shader.uniforms.uSnow === coverage, true);
assert.equal(shader.uniforms.macroMap.value.anisotropy, 1);
assert.match(shader.vertexShader, /transpose\(mat3\(viewMatrix\)\) \* transformedNormal/);
assert.match(material.customProgramCacheKey(), /wet-0\.6-snow-macro0\.1:0\.2-prior$/);
assert.equal(shader.fragmentShader.match(/uniform float uSnow;/g).length, 1);

const oldTarget = new THREE.WebGLRenderTarget(4, 4);
let active = oldTarget;
let face = 4;
let mip = 2;
let throwInRender = false;
const gl = {
  capabilities: { maxSamples: 2 },
  clearColor: new THREE.Color(0x123456),
  clearAlpha: 0.75,
  getDrawingBufferSize: (v) => v.set(101, 81),
  getRenderTarget: () => active,
  getActiveCubeFace: () => face,
  getActiveMipmapLevel: () => mip,
  autoClear: true,
  getClearColor(out) {
    return out.copy(this.clearColor);
  },
  getClearAlpha() {
    return this.clearAlpha;
  },
  setClearColor(color, alpha) {
    this.clearColor.copy(color);
    this.clearAlpha = alpha;
  },
  setRenderTarget(target, f = 0, m = 0) {
    active = target;
    face = f;
    mip = m;
  },
  clear() {},
  render() {
    assert.equal(reflection.texture.value, null, "mirror cannot sample the texture it is writing");
    if (throwInRender) throw new Error("mirror draw failed");
  },
};
const wet = new GroundReflection(gl, scene, weatherCamera);
lighting.wet.value = 1;
weatherCamera.setViewOffset(800, 600, 100, 80, 350, 350);
assert.equal(wet.render(), true);
assert.equal(wet.mirror.projectionMatrix.elements[8], weatherCamera.projectionMatrix.elements[8]);
assert.equal(active === oldTarget && face === 4 && mip === 2, true);
wet.setSize(111, 222);
assert.equal(wet.rt.width, 28);
assert.equal(wet.rt.height, 56);
assert.equal(reflection.texture.value, null, "resize invalidates the reflection sampler");
assert.equal(wet.render(), true);
wet.setSamples(2);
assert.equal(reflection.texture.value, null);
assert.equal(wet.rt.samples, 2);
assert.equal(wet.render(), true);
const matrix = reflection.matrix.value.elements.join(",");
parent.position.x += 2;
throwInRender = true;
assert.throws(() => wet.render(), /mirror draw failed/);
assert.equal(active === oldTarget && face === 4 && mip === 2, true);
assert.equal(reflection.strength.value, 0);
assert.equal(reflection.texture.value, null);
assert.equal(reflection.matrix.value.elements.join(","), matrix);
let releases = 0;
wet.rt.addEventListener("dispose", () => releases++);
wet.dispose();
wet.dispose();
assert.equal(releases, 1);
assert.equal(wet.render(), false);
wet.setSize(1200, 1000);
assert.equal(wet.rt.width, 28);

const post = new PostFX(gl, scene, camera);
assert.equal(post.sceneRT.samples, 2);
assert.equal(post.ldrRT.depthBuffer || post.gradeRT.depthBuffer, false);
assert.equal(post.smaa._edgesRT.depthBuffer || post.smaa._weightsRT.depthBuffer, false);
post.setAO(true);
assert.equal(post.sceneRT.stencilBuffer, true);
assert.equal(post.sceneRT.samples, 0);
assert.equal(post.ao.depthTexture === post.sceneRT.depthTexture, true);
assert.equal(post.blendRT.depthBuffer, false);
let gtaoReleased = 0;
post.ao.gtaoMaterial.addEventListener("dispose", () => gtaoReleased++);
post.ao.blendMaterial.addEventListener("dispose", () => gtaoReleased++);
post.setAO(false);
assert.equal(gtaoReleased, 2);
assert.equal(post.sceneRT.samples, 2);
post.setSize(0, 0);
assert.equal(post.sceneRT.width, 1);
post.setSize(Infinity, 10);
assert.equal(post.sceneRT.width, 1);
post.setSize(103.5, 83.5);
assert.equal(post.sceneRT.width, 103);
assert.equal(post.sceneRT.height, 83);
post.renderPasses = () => {
  gl.setRenderTarget(null);
  gl.setClearColor(new THREE.Color(0xffffff), 0);
  gl.autoClear = false;
  throw new Error("post draw failed");
};
assert.throws(() => post.render(), /post draw failed/);
assert.equal(gl.clearColor.getHex(), 0x123456);
assert.equal(gl.clearAlpha, 0.75);
assert.equal(gl.autoClear, true);
assert.equal(active === oldTarget && face === 4 && mip === 2, true);
let postReleases = 0;
post.sceneRT.addEventListener("dispose", () => postReleases++);
post.dispose();
post.dispose();
post.render();
assert.equal(postReleases, 1);

// Check quality and resource ownership with the real Three scene graph and a recording renderer.
globalThis.window = { devicePixelRatio: 2.5, innerWidth: 101, innerHeight: 81 };
const rendererSize = new THREE.Vector2();
let dpr = 1;
let resizeCalls = 0;
let pixelRatioCalls = 0;
Object.assign(gl, {
  getPixelRatio: () => dpr,
  setPixelRatio(value) {
    dpr = value;
    pixelRatioCalls++;
  },
  getSize: (out) => out.copy(rendererSize),
  setSize(w, h) {
    resizeCalls++;
    rendererSize.set(w, h);
  },
  getDrawingBufferSize: (out) => out.set(Math.floor(rendererSize.x * dpr) || 1, Math.floor(rendererSize.y * dpr) || 1),
  getContextAttributes: () => ({ antialias: true }),
  toneMappingExposure: 1,
  shadowMap: { autoUpdate: true },
});
const atmosphere = atmosphereFor(23, "rain");
view.applyLook = SceneView.prototype.applyLook;
view.atmosphere = atmosphere;
view.renderer = gl;
view.drawingBufferSize = new THREE.Vector2();
view.rendererSize = new THREE.Vector2();
view.sun = new THREE.DirectionalLight();
view.sun.shadow.mapSize.set(2048, 2048);
view.reflection = new GroundReflection(gl, scene, camera);
view.post = null;
const cover = new THREE.MeshStandardMaterial();
cover.userData.coverageEdges = true;
const sampleMesh = new THREE.Mesh(new THREE.PlaneGeometry(), [cover, undefined]);
scene.add(sampleMesh);
assert.equal(view.setQuality("constructor"), "high", "an unrecognised preset uses high quality");
assert.equal(dpr, 1);
assert.equal(resizeCalls, 1);
assert.equal(view.post.bloom.strength, atmosphere.bloom.strength);
assert.equal(view.post.grade.uniforms.tint.value.equals(atmosphere.grade.tint), true);
assert.equal(cover.alphaToCoverage, true);
assert.equal(view.reflection.rt.samples, 2);
const shadowRT = new THREE.WebGLRenderTarget(2, 2);
const shadowPass = new THREE.WebGLRenderTarget(2, 2);
let shadowReleases = 0;
for (const target of [shadowRT, shadowPass]) target.addEventListener("dispose", () => shadowReleases++);
view.sun.shadow.map = shadowRT;
view.sun.shadow.mapPass = shadowPass;
view.setQuality("ultra");
assert.equal(dpr, 2);
assert.equal(view.sun.shadow.mapSize.x, 4096);
assert.equal(shadowReleases, 2);
assert.equal(view.sun.shadow.map === null && view.sun.shadow.mapPass === null, true);
assert.equal(view.reflection.resolutionScale, 0.5);
assert.equal(view.reflection.rt.samples, 0);
assert.equal(cover.alphaToCoverage, false);
assert.equal(view.post.ao.width, Math.ceil(view.post.sceneRT.width / 2));
view.setQuality("ultra");
assert.equal(pixelRatioCalls, 1);
assert.equal(resizeCalls, 1);
window.devicePixelRatio = NaN;
view.setQuality("low");
assert.equal(dpr, 1);
assert.equal(view.post === null, true);
assert.equal(view.reflection.enabled, false);
assert.equal(cover.alphaToCoverage, true);
view.setLook({ exposure: 10000, vignette: 10 });
assert.equal(Number.isFinite(gl.toneMappingExposure), true);
view.setLook({ contrast: -100, saturation: -100 });
view.setQuality("high");
assert.equal(view.post.grade.uniforms.vignette.value, 1);
assert.equal(view.post.grade.uniforms.saturation.value, 0);
assert.equal(view.post.grade.uniforms.contrast.value, 0.5);

const lod = new THREE.LOD();
const scenery = new THREE.Group();
scenery.add(lod);
let lodCalls = 0;
let chosenCamera = false;
lod.update = (activeCamera) => {
  lodCalls++;
  chosenCamera = activeCamera === camera;
};
view.addScenery(scenery);
view.addScenery(scenery);
assert.equal(view.sceneryLODs.size, 1);
view.sky.material = { uniforms: { cloudTime: { value: 0 } } };
const frameStages = [];
view.reflection.render = () => {
  frameStages.push("mirror");
  return true;
};
view.post.render = () => {
  frameStages.push("main");
  assert.equal(gl.shadowMap.autoUpdate, false);
};
const skyTime = lighting.time.value;
view.render(Infinity);
assert.equal(lighting.time.value, skyTime);
assert.equal(lodCalls, 1);
assert.equal(chosenCamera, true);
assert.equal(frameStages.join(","), "mirror,main");
assert.equal(gl.shadowMap.autoUpdate, true);
scenery.removeFromParent();
view.render(0.125);
assert.equal(lodCalls, 1);
assert.equal(view.sceneryLODs.size, 0);
assert.equal(view.sky.material.uniforms.cloudTime.value, skyTime + 0.125);
view.post.render = () => {
  throw new Error("composite failed");
};
assert.throws(() => view.render(0), /composite failed/);
assert.equal(gl.shadowMap.autoUpdate, true);

const high = view.post;
high.render = PostFX.prototype.render;
const order = [];
gl.render = () => order.push("scene");
high.bloom.render = () => order.push("bloom");
high.output.render = () => order.push("output");
high.gradeQuad.render = () => order.push("grade");
high.smaa.render = () => order.push("smaa");
high.grade.uniforms.seed.value = 63;
high.render();
assert.equal(high.grade.uniforms.seed.value, 0);
assert.equal(order.join(","), "scene,bloom,output,grade,smaa");
assert.equal(high.grade.uniforms.tDiffuse.value === high.ldrRT.texture, true);
high.dispose();

// Probe refreshes are keyed by weather and meaningful motion of the sun.
const atmosphereView = Object.assign(Object.create(SceneView.prototype), {
  renderer: {},
  scene: new THREE.Scene(),
  sky: {
    material: {
      uniforms: Object.fromEntries(
        ["zenith", "horizon", "groundColor", "glowColor", "sunColor", "cloudLit", "cloudShade"]
          .map((key) => [key, { value: new THREE.Color() }])
          .concat([
            ["sunDir", { value: new THREE.Vector3() }],
            ...["sunGlow", "stars", "cloudCover"].map((key) => [key, { value: 0 }]),
          ]),
      ),
    },
  },
  hemi: new THREE.HemisphereLight(),
  sun: new THREE.DirectionalLight(),
  keyDir: new THREE.Vector3(),
  backdrop,
  environmentScene: new THREE.Scene(),
  environmentSun: new THREE.Vector3(),
  shadowCenter: new THREE.Vector3(),
  shadowSnap: new THREE.Vector3(),
  look: { exposure: 0, contrast: 0, saturation: 0, vignette: 0 },
});
atmosphereView.scene.background = new THREE.Color();
atmosphereView.scene.fog = new THREE.FogExp2();
let probes = 0;
let drops = 0;
atmosphereView.environmentGenerator = {
  fromScene(input) {
    assert.equal(input === atmosphereView.environmentScene, true);
    probes++;
    const target = new THREE.WebGLRenderTarget(4, 4);
    target.addEventListener("dispose", () => drops++);
    return target;
  },
};
const dry = atmosphereFor(15.5, "dry");
atmosphereView.environmentSun.copy(dry.sun.dir);
atmosphereView.environmentWeather = dry.weather;
atmosphereView.setAtmosphere(dry);
assert.equal(probes, 1, "a matching key cannot hide a missing probe");
atmosphereView.setAtmosphere(atmosphereFor(15.5001, "dry"));
assert.equal(probes, 1, "sub-degree sun motion retains the probe");
atmosphereView.setAtmosphere(atmosphereFor(15.5, "rain"));
assert.equal(probes, 2);
assert.equal(drops, 1, "replacement releases only the previous probe");
assert.equal(atmosphereView.scene.environment === atmosphereView.environmentTarget.texture, true);
assert.equal(atmosphereView.scene.fog.color.equals(atmosphereView.scene.background), true);
assert.equal(atmosphereView.scene.environmentIntensity, atmosphereView.atmosphere.env);
const keyDir = atmosphereView.keyDir.clone();
atmosphereView.followShadow(120, -97);
const toLight = atmosphereView.sun.position.clone().sub(atmosphereView.sun.target.position);
assert.equal(Math.abs(toLight.length() - 400) < 1e-8, true);
assert.equal(keyDir.dot(toLight.normalize()) > 0.999999, true);
const { right, up } = atmosphereView._basis;
const texel = 140 / atmosphereView.sun.shadow.mapSize.x;
for (const axis of [right, up]) {
  const steps = atmosphereView.sun.target.position.dot(axis) / texel;
  assert.equal(Math.abs(Math.round(steps) - steps) < 1e-8, true);
}
assert.equal(backdrop.renderOrder < 0, true);
assert.equal(backdrop.geometry.getAttribute("position").getY(0), -30);
assert.equal(backdrop.geometry.getAttribute("position").getY(1), 0, "the ridge tapers at the start of its arc");
assert.equal(dry.sky.sun.equals(atmosphereFor(15.5, "rain").sky.sun), true);
atmosphereView.environmentTarget.dispose();

console.log("World camera, atmosphere, minimap, overlay and render-pass checks passed.");
