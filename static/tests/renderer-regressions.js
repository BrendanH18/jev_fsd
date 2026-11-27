import * as THREE from "three";
import { atmosphereFor, lighting } from "../js/render/atmosphere.js";
import { BallView } from "../js/render/ball-chase.js";
import { IceView } from "../js/render/black-ice.js";
import { CinematicCamera } from "../js/render/cinematic-camera.js";
import { GeoBuilder, planarUV } from "../js/render/geo.js";
import { chunkLOD } from "../js/render/lod.js";
import { Minimap } from "../js/render/minimap.js";
import { OrbitCamera } from "../js/render/orbit-camera.js";
import { Overlays } from "../js/render/overlays.js";
import { PuddleView, buildPuddles } from "../js/render/puddles.js";
import { buildPxos } from "../js/render/pxo.js";
import { GroundReflection, reflection } from "../js/render/reflection.js";
import { RoadClosureView } from "../js/render/road-closures.js";
import { LAYER, SceneView, groundLayer, toThree } from "../js/render/scene.js";
import { WeatherView, snowable } from "../js/render/weather.js";
import { wheelPoints } from "../js/sim/potholes.js";
import { CAR } from "../js/sim/vehicle.js";

const close = (a, b) => Math.abs(a - b) < 1e-5;
const key = (arr) => arr.join(",");
const syncAt = (camera, x, y, z) => {
  camera.position.set(x, y, z);
  camera.updateMatrixWorld();
};

function geometryChecks(check) {
  check("Lock the east-up-south transformation used by scene objects", key(toThree(5, 7, 11).toArray()) === "5,11,-7");
  const b = new GeoBuilder();
  b.tri([0, 0, 0], [1, 0, 0], [2, 0, 0]);
  check("Omit zero-area triangles from scenery geometry", b.empty);
  b.tri(
    [0, 0, 1],
    [0, 1, 1],
    [1, 0, 1],
    [
      [0, 0],
      [0, 1],
      [1, 0],
    ],
    null,
    [0, 0, 1],
  );
  check("Keep UVs on their vertices when reversing triangle winding", key(b.uv) === "0,0,1,0,0,1");
  const poly = new GeoBuilder();
  poly.polygon(
    [
      [0, 0, 99],
      [1, 0, 99],
      [0, 1, 99],
    ],
    2,
  );
  check(
    "Use the requested polygon height for points with extra coordinates",
    poly.pos.filter((_, i) => i % 3 === 1).every((y) => y === 2),
  );
  const concave = new GeoBuilder();
  concave.polygon([
    [0, 0],
    [2, 0],
    [2, 2],
    [1, 1],
    [0, 2],
  ]);
  check("Cover triangulation of concave scenery footprints", concave.pos.length === 27);
  const ribbon = new GeoBuilder();
  ribbon.ribbon(
    [
      [0, 0],
      [0, 0],
      [5, 0],
      [5, 0],
    ],
    1,
    2,
    0,
    { uv: "along", scale: 2, from: 1, to: 4 },
  );
  const expected = new GeoBuilder();
  expected.ribbon(
    [
      [0, 0],
      [5, 0],
    ],
    1,
    2,
    0,
    { uv: "along", scale: 2, from: 1, to: 4 },
  );
  check(
    "Keep ribbon width at duplicated polyline endpoints",
    key(ribbon.pos) === key(expected.pos) && ribbon.pos.length === 18,
  );
  check(
    "Cover fractional ribbon clipping without resetting texture phase",
    Math.min(...ribbon.uv.filter((_, i) => i % 2 === 0)) === 0.5 && Math.max(...ribbon.uv) === 2,
  );
  const empty = new GeoBuilder();
  empty.ribbon(
    [
      [0, 0],
      [5, 0],
    ],
    0,
    1,
    0,
    { from: 4, to: 2 },
  );
  check("Skip ribbons with an inverted clipping interval", empty.empty);
  check("Keep wall textures level as height changes", key(planarUV([2, 4, 7], [1, 0, 0])) === "4,7");
}

function cameraChecks(check) {
  const ego = { x: 10, y: 20, psi: 0, v: 12, spec: { length: 6, rearOverhang: 0 } };
  const orbit = new OrbitCamera();
  orbit.setDistance(Number.NaN, ego.spec);
  check("Keep an invalid zoom delta from corrupting the orbit rig", orbit.distance === 10);
  orbit.setDistance(3, { length: 45 });
  check("Give the orbit camera clearance around a long vehicle", orbit.distance === 40.5);
  orbit.reset();
  check("Centre the orbit on vehicles with no rear overhang", orbit.pose(ego).look[0] === 13);
  const director = new CinematicCamera();
  const first = director.pose(ego);
  const highSpeed = new CinematicCamera().pose({ ...ego, v: 80 });
  check("Limit the roadside camera lead at high vehicle speeds", highSpeed.position[0] === ego.x + 45);
  const passed = { ...ego, x: 80 };
  check(
    "Hold the roadside composition through its minimum shot length",
    director.pose(passed, 2).position[0] === first.position[0],
  );
  check(
    "Cut as soon as a completed roadside pass reaches its minimum duration",
    director.pose(passed, 1).shot === "bumper",
  );
  check("Frame the bumper chase behind the rear axle", director.pose(ego).position[0] < ego.x);
  const aerial = director.pose(ego, 6);
  check(
    "Aim the aerial shot at the middle of the vehicle cabin",
    aerial.shot === "aerial" && aerial.look[2] === 1.45 * 0.5,
  );
  const aerialNext = director.pose({ ...ego, v: 0 }, 1);
  check(
    "Cover the aerial camera's angular speed independent of vehicle motion",
    close(aerialNext.position[0], 13 + Math.cos(Math.PI * 0.75 + 0.14) * 30),
  );
  const otherSide = director.pose(ego, 7);
  const yawed = director.pose({ ...ego, psi: Math.PI / 2 }, 1);
  check(
    "Keep the roadside rig planted when the vehicle turns mid-shot",
    yawed.shot === "trackside" && key(otherSide.position) === key(yawed.position),
  );
  const lead = director.pose(ego, 9);
  check(
    "Centre the lead shot on the body of vehicles with no rear overhang",
    lead.shot === "lead" && lead.look[0] === 13 && lead.position[0] > lead.look[0],
  );
  const profile = director.pose({ ...ego, psi: Math.PI / 2 }, 6);
  check(
    "Place the profile view to the left of the actual vehicle heading",
    profile.shot === "profile" && profile.position[0] < ego.x,
  );
  check(
    "Give the narrow profile shot a tighter field of view than the bumper camera",
    profile.fov < 50 && profile.look[2] > profile.position[2],
  );

  const camera = new THREE.PerspectiveCamera();
  const rig = Object.assign(Object.create(SceneView.prototype), {
    camera,
    cinematic: director,
    orbit,
    camPos: new THREE.Vector3(),
    camLook: new THREE.Vector3(),
    sky: new THREE.Object3D(),
    followShadow() {},
  });
  rig.setCamera("unknown");
  check("Fall back to the chase rig when a camera name is unknown", rig.mode === "chase");
  rig.setCamera("hood");
  rig.updateCamera({ ...ego, ax: 3, latAccel: 3 }, 1 / 30);
  check(
    "Cover the hood rig's acceleration pitch and lateral roll",
    rig.cameraPitch > 0 && rig.cameraRoll > 0 && rig.camera.fov === 64,
  );
  rig.cameraMotion = false;
  rig.updateCamera(ego, 0);
  check(
    "Clear stored hood movement when camera motion is disabled",
    rig.cameraPitch === 0 && rig.cameraRoll === 0 && camera.up.y === 1,
  );
  rig.setCamera("top");
  rig.updateCamera(ego, 0);
  check("Cover north-up alignment of the overhead camera", key(camera.up.toArray()) === "0,0,-1");
  rig.setCamera("far");
  rig.updateCamera(ego, 0);
  check(
    "Snap directly to a distant camera when changing modes on a paused frame",
    camera.position.x === ego.x - 28 && camera.position.y === 17,
  );
}

function weatherChecks(check) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  const material = snowable(new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.9 }), "asphalt");
  const roof = snowable(new THREE.MeshStandardMaterial(), "roof");
  const dirt = new THREE.MeshStandardMaterial({ color: 0x64412d });
  const shared = new THREE.BoxGeometry();
  scene.add(new THREE.Mesh(shared, [material, dirt, roof]), new THREE.Mesh(shared, material));
  const dry = material.color.r;
  const weather = new WeatherView({ scene, camera });
  weather.apply("rain");
  const rain = weather.rain.mesh;
  const spray = weather.spray.mesh;
  check(
    "Cover wet-road darkening and gloss without affecting roof roughness",
    material.color.r < dry && material.roughness < 0.3 && roof.roughness === 1,
  );
  check("Keep untagged surfaces out of weather recolouring", dirt.color.getHex() === 0x64412d);
  check(
    "Seed all rain streaks as instances of a single quad",
    rain.geometry.attributes.position.count === 4 &&
      rain.geometry.instanceCount === rain.geometry.attributes.dropSeed.count &&
      rain.geometry.attributes.dropSeed.array.some((x) => x !== 0),
  );
  const wet = material.color.r;
  weather.apply("rain");
  check("Keep live rain particles and their phase when reapplying rain", weather.rain.mesh === rain);
  check("Cover repeatable wet tint on materials shared by multiple meshes", material.color.r === wet);
  const disposed = new Set();
  for (const [name, resource] of [
    ["geometry", rain.geometry],
    ["material", rain.material],
    ["spray geometry", spray.geometry],
    ["spray material", spray.material],
  ])
    resource.addEventListener("dispose", () => disposed.add(name));
  weather.apply("snow");
  const snow = weather.snow.mesh;
  check(
    "Keep precipitation seeds in static GPU buffers",
    rain.geometry.attributes.dropSeed.usage === THREE.StaticDrawUsage &&
      snow.geometry.attributes.position.usage === THREE.StaticDrawUsage,
  );
  check(
    "Release obsolete weather particle resources on a weather change",
    disposed.size === 4 && rain.parent === null && spray.parent === null && snow.parent === scene,
  );
  check(
    "Cover the plowed-road snow level relative to rooftop accumulation",
    roof.userData.snow.value > material.userData.snow.value && material.userData.snow.value > 0,
  );
  syncAt(camera, -400, 60, 120);
  weather.update(1 / 60);
  const flakes = snow.geometry.attributes.position;
  check(
    "Update snowfall's camera anchor and clock without rewriting seed data",
    weather.snow.uniforms.weatherCamera.value.equals(camera.position) &&
      weather.snow.uniforms.weatherTime.value === 1 / 60 &&
      flakes.version === 0,
  );
  const flakeTexture = snow.material.map;
  let textureReleased = false;
  flakeTexture.addEventListener(
    "dispose",
    () => {
      textureReleased = true;
    },
    { once: true },
  );
  weather.apply("fog");
  check("Keep shared flake textures alive when removing a snow particle system", !textureReleased);
  check(
    "Render fog without precipitation and with partial wet sheen",
    !weather.rain && !weather.snow && !weather.spray && material.color.r > wet && material.color.r < dry,
  );
  weather.apply("constructor");
  check(
    "Use dry weather for names inherited from the JavaScript object prototype",
    weather.name === "dry" && atmosphereFor(12, "constructor").weather === "dry",
  );
  check(
    "Cover clean restoration of dry material colours and snow weights",
    close(material.color.r, dry) && roof.userData.snow.value === 0,
  );
  weather.apply("rain");
  check(
    "Restart rain with the same seeds and the current camera anchor",
    weather.rain.mesh.geometry.attributes.dropSeed.getY(0) === rain.geometry.attributes.dropSeed.getY(0) &&
      weather.rain.uniforms.weatherCamera.value.equals(camera.position) &&
      weather.rain.uniforms.weatherTime.value === 0,
  );
  weather.apply("dry");
  shared.dispose();
  material.dispose();
  roof.dispose();
  dirt.dispose();
  const noon = atmosphereFor(12);
  const night = atmosphereFor(0);
  check(
    "Cover the daytime to nighttime switch in sky and key-light levels",
    noon.stars === 0 && night.stars > 0.9 && night.key.intensity < noon.key.intensity,
  );
  check(
    "Cover the fog preset's cloud-deck suppression and stronger distance attenuation",
    atmosphereFor(12, "fog").clouds.cover === 0 &&
      atmosphereFor(12, "fog").fogDensity > atmosphereFor(12, "rain").fogDensity,
  );
}

export function checkWeatherDraws(renderer, check) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0);
  scene.fog = new THREE.FogExp2(0, 0.016);
  const camera = new THREE.PerspectiveCamera(58, 2, 0.3, 100);
  camera.position.set(-8, 2, 0);
  camera.lookAt(0, 0.5, 0);
  const weather = new WeatherView({ scene, camera });
  const target = new THREE.WebGLRenderTarget(160, 80);
  const previous = renderer.getRenderTarget();
  const pixels = new Uint8Array(160 * 80 * 4);
  function showsParticles(inView = () => true) {
    renderer.render(scene, camera);
    renderer.readRenderTargetPixels(target, 0, 0, 160, 80, pixels);
    return pixels.some((value, i) => i % 4 !== 3 && value > 0 && inView(Math.floor(i / 4) % 160));
  }
  try {
    renderer.setRenderTarget(target);
    weather.apply("rain");
    weather.update(0.3);
    check("The rain shader draws visible streaks", showsParticles());
    camera.position.set(0, 28, 0);
    camera.up.set(0, 0, -1);
    camera.lookAt(0, 0, 0);
    weather.update(0);
    check(
      "Overhead rain covers the left and right edges",
      showsParticles((x) => x < 40) && showsParticles((x) => x > 120),
    );
    camera.position.set(-8, 2, 0);
    camera.up.set(0, 1, 0);
    camera.lookAt(0, 0.5, 0);
    weather.update(0);
    weather.rain.mesh.visible = false;
    const car = { x: 0, y: 0, v: 13, psi: 0, spec: CAR };
    weather.spray.begin(camera, 0.25);
    weather.spray.add(car);
    weather.spray.end();
    check("The tire spray shader draws a moving car's spray", showsParticles());
    weather.apply("snow");
    weather.update(0.3);
    check("The snow shader draws visible flakes", showsParticles());
    check("Rain, spray and snow draw without WebGL errors", renderer.getContext().getError() === 0);
  } finally {
    weather.apply("dry");
    renderer.setRenderTarget(previous);
    target.dispose();
  }
}

function minimapChecks(check) {
  const canvas = document.createElement("canvas");
  canvas.width = 200;
  canvas.height = 100;
  canvas.getBoundingClientRect = () => ({ left: 20, top: 10, width: 100, height: 50 });
  const clearButton = document.createElement("button");
  const edges = new Map([
    [
      "main",
      {
        pts: [
          [0, 10],
          [100, 10],
        ],
        cls: "primary",
        width: 5,
      },
    ],
    [
      "side",
      {
        pts: [
          [0, 10],
          [100, 10],
        ],
        cls: "residential",
        width: 5,
      },
    ],
  ]);
  const ring = [
    [10, 90],
    [10, 70],
    [30, 70],
    [30, 90],
    [10, 90],
  ];
  const map = {
    extent: [0, 0, 100, 100],
    edges,
    pack: { buildings: [] },
    intersections: new Map(),
    parks: [
      { kind: "garden", closed: true, rings: [ring] },
      { kind: "water", closed: true, rings: [ring.map(([x, y]) => [x + 30, y])] },
      {
        kind: "creek",
        closed: false,
        lines: [
          [
            [0, 55],
            [100, 55],
          ],
        ],
      },
    ],
    rail: {
      tracks: [
        {
          pts: [
            [0, 28.5],
            [100, 28.5],
          ],
        },
      ],
    },
  };
  const clicks = [];
  const minimap = new Minimap(canvas, map, (p) => clicks.push(p), { clearButton });
  const click = (x, y) => canvas.dispatchEvent(new MouseEvent("click", { clientX: x, clientY: y }));
  const pixel = (x, y) => key(minimap.ctx.getImageData(x, y, 1, 1).data);
  check(
    "Cover reversible minimap coordinates with north toward the top",
    key(minimap.toWorld(...minimap.toPx(20, 75))) === "20,75" && minimap.toPx(20, 75)[1] < minimap.toPx(20, 25)[1],
  );
  click(70, 35);
  check(
    "Convert pointer positions at CSS scale to geographic destinations",
    clicks.length === 1 && key(clicks[0]) === "50,50",
  );
  click(21, 35);
  check("Ignore destination clicks in the minimap's letterboxing", clicks.length === 1);
  {
    const [left, top, right, bottom] = minimap.pxBounds();
    const [x0, y0, x1, y1] = map.extent;
    const picked = minimap.pickKeyboard(right, bottom) && minimap.pickKeyboard(left, top);
    const [east, south] = clicks.at(-2);
    const [west, north] = clicks.at(-1);
    check(
      "Keyboard destinations at the map's projected edges stay inside its extent",
      picked && east <= x1 && south >= y0 && west >= x0 && north <= y1,
    );
    check("Keyboard destinations in the letterbox are ignored", !minimap.pickKeyboard(left - 1, top));
    clicks.length = 1;
  }
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 0, height: 0 });
  click(0, 0);
  check("Ignore destination clicks while the minimap has no visible size", clicks.length === 1);
  minimap.draw({});
  check("Distinguish the road network bounds from the minimap margin", pixel(10, 50) !== pixel(60, 50));
  check("Draw green groundcover for mapped gardens and parks", pixel(70, 20) === "37,59,49,255");
  check("Draw mapped standing water in blue", pixel(100, 20) === "33,59,81,255");
  check("Draw linear waterways independently of area polygons", pixel(95, 45) !== pixel(95, 50));
  check(
    "Show mapped railway alignment as a dashed line",
    [80, 81, 82, 83, 84].some((x) => pixel(x, 71) === "178,148,121,255") &&
      [80, 81, 82, 83, 84].some((x) => pixel(x, 71) === "23,29,38,255"),
  );
  check("Keep major streets visible where residential roads overlap", pixel(88, 90) === "88,98,117,255");
  const route = {
    pts: [
      [10, 40],
      [90, 40],
    ],
  };
  minimap.draw({ route, destination: [25, 25], ego: { x: 35, y: 35, psi: 0 } });
  const path = minimap.routePath;
  minimap.draw({ route, destination: [25, 25], ego: { x: 35, y: 35, psi: 0 } });
  check(
    "Reuse the minimap route path while its points stay the same",
    path === minimap.routePath && pixel(95, 60) === "76,194,255,255",
  );
  check("Outline the route so it remains distinguishable from underlying lines", pixel(95, 61) === "17,38,59,255");
  check("Mark the exact destination inside its target ring", pixel(75, 75) === "87,210,127,255");
  check(
    "Outline the ego arrow against bright roads and overlays",
    pixel(85, 65) === "76,194,255,255" && pixel(79, 65) === "16,37,48,255",
  );
  minimap.draw({});
  check(
    "Drop the cached minimap path when clearing the route",
    minimap.routePath === null && pixel(95, 60) !== "76,194,255,255",
  );
}

function overlayChecks(check) {
  const scene = new THREE.Scene();
  const overlays = new Overlays(scene);
  const route = {
    pts: [
      [0, 0],
      [4, 0],
    ],
    endPoint: () => [4, 0],
  };
  overlays.setRoute(route);
  const routeMesh = overlays.routeMesh;
  overlays.setRoute(route);
  check("Reuse unchanged 3D route geometry on repeated route updates", overlays.routeMesh === routeMesh);
  let disposed = false;
  routeMesh.geometry.addEventListener("dispose", () => {
    disposed = true;
  });
  overlays.setRoute(null);
  check("Cover route removal and its GPU geometry release", disposed && !overlays.marker.visible && !routeMesh.parent);
  overlays.setRoute({
    pts: [
      [1, 2],
      [1, 2],
    ],
    endPoint: () => [1, 2],
  });
  check(
    "Show the endpoint without creating a mesh for a zero-length route",
    !overlays.routeMesh && overlays.marker.visible && key(overlays.marker.position.toArray()) === "1,0,-2",
  );
  const trace = [
    [0, 0],
    [5, 0],
  ];
  overlays.setCandidates(
    [
      { id: "eligible-1", trace, eligible: true },
      { id: "eligible-2", trace, eligible: true },
      { id: "flagged", trace, eligible: true, flagged: true },
      { id: "rejected", trace },
      { id: "chosen", trace, flagged: true },
      {
        id: "duplicate",
        trace: [
          [0, 0],
          [0, 0],
        ],
        eligible: true,
      },
    ],
    "chosen",
  );
  const meshOf = (status) => overlays.candidateMeshes.find((m) => m.material === overlays.mats[status]);
  check(
    "Batch candidate ribbons of the same status into one draw call",
    overlays.candidateMeshes.length === 4 && meshOf("eligible").geometry.attributes.position.count === 12,
  );
  check(
    "Cover distinct visual treatment for flagged and rejected paths",
    meshOf("flagged").material.color.getHex() !== meshOf("rejected").material.color.getHex(),
  );
  check(
    "Cover selected candidate order and width when the selected path was flagged",
    meshOf("chosen").renderOrder > meshOf("flagged").renderOrder &&
      close(meshOf("chosen").geometry.boundingSphere.radius, Math.hypot(2.5, 0.16)),
  );
  check(
    "Keep candidate overlays occluded by vehicles without writing their own depth",
    overlays.candidateMeshes.every((m) => m.material.depthTest && !m.material.depthWrite),
  );
  const removed = [];
  for (const mesh of overlays.candidateMeshes) mesh.geometry.addEventListener("dispose", () => removed.push(mesh));
  overlays.showCandidates = false;
  overlays.setCandidates([{ id: "flagged", trace }]);
  check(
    "Cover releasing candidate buffers when their display is turned off",
    removed.length === 4 && overlays.group.children.length === 0,
  );
}

function actorChecks(check) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  const balls = new BallView(scene);
  const ball = { id: "fixture", phase: "waiting", x: 1, y: 2, spin: 1.2, axis: [1, 0], color: 0xe43845 };
  const world = { balls: { enabled: true, balls: [ball] } };
  balls.update(world, camera);
  check("Cover hiding the playground ball before it emerges", balls.meshes.size === 0);
  ball.phase = "rolling";
  balls.update(world, camera);
  const mesh = balls.meshes.get(ball.id);
  check(
    "Reflect accumulated spin when a rolling ball first appears during replay",
    close(mesh.quaternion.z, -Math.sin(0.6)),
  );
  const position = mesh.geometry.attributes.position;
  const normal = mesh.geometry.attributes.normal;
  const unit = new THREE.Vector3().fromBufferAttribute(position, 7).normalize();
  check(
    "Use round shading with sharp colour panels on the playground ball",
    new THREE.Vector3().fromBufferAttribute(normal, 7).dot(unit) > 0.999,
  );
  ball.burst = true;
  balls.update(world, camera);
  check(
    "Cover squashing a run-over ball against the ground",
    mesh.scale.y === 0.3 && mesh.position.y < position.getY(0),
  );
  ball.burst = false;
  ball.spin = 0.1;
  balls.update(world, camera);
  check(
    "Restore the ball's round profile and roll angle on replay rewind",
    mesh.scale.y === 1 && close(mesh.quaternion.z, -Math.sin(0.05)),
  );
  ball.phase = "carried";
  ball.child = { x: 300, y: 0, psi: Math.PI / 2 };
  syncAt(camera, 300, 2, 0);
  balls.update(world, camera);
  check(
    "Cull a carried ball by its actual position in the child's hands",
    mesh.visible && close(mesh.position.z, -0.24),
  );
  let disposed = false;
  mesh.material.addEventListener("dispose", () => {
    disposed = true;
  });
  ball.phase = "gone";
  balls.update(world, camera);
  check("Cover retiring gone balls and their material resources", balls.meshes.size === 0 && disposed && !mesh.parent);

  const ice = new IceView(scene);
  const iceWorld = {
    ice: {
      enabled: true,
      version: 0,
      list: [
        {
          pts: [
            [0, 0],
            [20, 0],
          ],
          cum: [0, 20],
          len: 20,
          lo: -2,
          hi: 2,
          shape: 2,
        },
      ],
    },
  };
  ice.sync(iceWorld);
  const sheet = ice.group.children[0];
  const alpha = sheet.geometry.getAttribute("color");
  check("Cover feathered black-ice margins and a visible patch interior", alpha.getW(0) === 0 && alpha.getW(30) > 0);
  check(
    "Cover coplanar ice below road markings with depth testing",
    sheet.renderOrder < LAYER.marking &&
      sheet.material.depthTest &&
      !sheet.material.depthWrite &&
      sheet.geometry.getAttribute("position").getY(4) === 0,
  );
  iceWorld.ice.enabled = false;
  ice.sync(iceWorld);
  check("Hide stale black-ice geometry after its feature is disabled", !ice.group.visible);
  let iceReleased = false;
  sheet.geometry.addEventListener("dispose", () => {
    iceReleased = true;
  });
  Object.assign(iceWorld.ice, { enabled: true, list: [], version: 1 });
  ice.sync(iceWorld);
  check(
    "Cover releasing replaced black-ice buffers after a patch version change",
    iceReleased && ice.group.children.length === 0,
  );
  ice.material.dispose();

  const end = { k: 0, x: 3, y: 5, psi: 0, lo: -2, hi: 2 };
  const closure = { id: 1, edges: ["missing"], ends: [end], boards: [{ end: 0, x: 3, y: 5, spec: { width: 2 } }] };
  const closureWorld = { map: { edges: new Map() }, roadClosures: { list: [closure] } };
  const closures = new RoadClosureView(scene);
  closures.sync(closureWorld, 0.25);
  const barricade = Array.from(closures.meshes.values())[0];
  check(
    "Keep closure barricades visible when the decorative tent edge is missing",
    barricade.children.length === 1 && key(barricade.children[0].position.toArray()) === "3,0,-5",
  );
  const resources = new Set();
  let releases = 0;
  barricade.traverse((child) => {
    if (child.isMesh && !resources.has(child.geometry)) {
      resources.add(child.geometry);
      child.geometry.addEventListener("dispose", () => releases++);
    }
  });
  const lamp = barricade.children[0].children[5].material;
  const on = lamp.emissiveIntensity;
  closures.sync(closureWorld, 0.75);
  check("Cover the visible on and off phases of closure lamps", on > 0 && lamp.emissiveIntensity === 0);
  const sign = barricade.children[0].children.find((child) => child.isGroup).children[1].material;
  closureWorld.roadClosures.list = [{ ...closure, id: 2 }];
  closures.sync(closureWorld);
  const other = Array.from(closures.meshes.values())[0];
  check(
    "Share reusable sign materials across successive road closures",
    other.children[0].children.find((child) => child.isGroup).children[1].material === sign &&
      sign.alphaTest > 0 &&
      sign.depthWrite,
  );
  check(
    "Release each removed road closure geometry once despite shared cone parts",
    releases === resources.size && !barricade.parent,
  );
  closureWorld.roadClosures.list = [];
  closures.sync(closureWorld);
}

function wetRoadChecks(check) {
  const scene = new THREE.Scene();
  const car = { x: 0, y: 0, psi: 0, spec: CAR, v: -8 };
  const [x, y] = wheelPoints(car)[0];
  const patch = { x, y, heading: Math.PI, a: 0.25, b: 0.1, shape: 1 };
  const world = { puddles: { enabled: true, list: [patch] }, weather: "rain", t: 4 };
  const surface = buildPuddles(world);
  check(
    "Cover puddle water resting above potholes and below road markings",
    surface.visible &&
      surface.children[0].renderOrder > LAYER.patch + 0.5 &&
      surface.children[0].renderOrder < LAYER.marking,
  );
  const view = new PuddleView(scene, surface);
  const camera = new THREE.PerspectiveCamera();
  const person = new THREE.Object3D();
  const people = new Map([["walker", person]]);
  view.update(world, [], people, camera, 0);
  view.spray(car, patch, 2, 0.1);
  check(
    "Emit splash spray only from the wheels actually touching standing water",
    view.drops.length === 14 && view.drops.every((d) => Math.hypot(d.x - x, d.y - y) < 0.22),
  );
  check(
    "Carry spray in the vehicle's signed direction of motion when it reverses",
    view.drops.every((d) => d.vx < 0),
  );
  check(
    "Throw standing water toward the curb on roads with an opposing vehicle heading",
    view.drops.every((d) => d.vy > 0),
  );
  view.flinch.set("walker", { t: 0.1, psi: 0 });
  view.update(world, [], people, camera, 1 / 60);
  check(
    "Upload only active water droplets without writing transparent depth",
    !view.mesh.material.depthWrite && view.mesh.instanceMatrix.updateRanges[0].count === 14 * 16,
  );
  world.t = 1;
  view.update(world, [], people, camera, 0);
  check(
    "Clear spray and pedestrian flinches from later times on a replay rewind",
    view.mesh.count === 0 && view.flinch.size === 0 && person.rotation.z === 0,
  );
  view.mesh.dispose();
  view.mesh.geometry.dispose();
  view.mesh.material.dispose();
  surface.children[0].geometry.dispose();
  surface.children[0].material.dispose();
}

function crossoverChecks(check) {
  const edge = {
    pts: [
      [0, 0],
      [20, 0],
    ],
    cum: [0, 20],
    asphalt: [-4, 4],
  };
  const crossing = {
    id: "crosswalk",
    pxo: true,
    s: 10,
    st: { edge },
    ends: { 1: [10, -5], "-1": [10, 5] },
    beacons: true,
  };
  const world = { t: 0, crowd: { pxo: true, marked: [], list: [] } };
  check(
    "Skip crossover mesh creation on maps with no pedestrian crossovers",
    buildPxos(world).group.children.length === 0,
  );
  world.crowd.marked.push(crossing, { ...crossing, id: "quiet", s: 18, beacons: false });
  const rendering = buildPxos(world);
  const children = rendering.group.children;
  const signs = children.filter((o) => o.material.map);
  check(
    "Orient fixed crossover signs toward the approaching lanes",
    signs.length === 4 &&
      signs.every((o) => o.isMesh) &&
      close(Math.sin(signs[1].rotation.y - signs[0].rotation.y), 0) &&
      close(Math.cos(signs[1].rotation.y - signs[0].rotation.y), -1),
  );
  const bars = children.filter((o) => o.renderOrder === LAYER.marking);
  check(
    "Batch crossover bars as a coplanar road-marking mesh",
    bars.length === 1 &&
      bars[0].geometry.attributes.position.count > 40 &&
      bars[0].geometry.attributes.position.getY(4) === 0,
  );
  const lights = children.filter((o) => o.geometry.type === "SphereGeometry");
  check(
    "Share synchronized warning light materials only on beacon-equipped crossovers",
    lights.length === 2 && lights[0].material === lights[1].material,
  );
  world.crowd.list.push({ x: 10, y: -4.2, crossing: { marked: "crosswalk" } });
  rendering.update();
  const illuminated = lights[0].material.color.getHex();
  world.t = 0.3;
  rendering.update();
  const darkPhase = lights[0].material.color.getHex();
  world.t = 0.5;
  world.crowd.list[0].y = -4.5;
  rendering.update();
  check(
    "Cover crossover beacon flashing until a pedestrian clears the far curb",
    illuminated === 0xffb000 && darkPhase === 0x6b4500 && lights[0].material.color.getHex() === darkPhase,
  );
  for (const geometry of new Set(children.map((m) => m.geometry))) geometry.dispose();
  for (const material of new Set(children.map((m) => m.material))) {
    material.map?.dispose();
    material.dispose();
  }
}

function sceneChecks(check) {
  const saved = {
    texture: reflection.texture.value,
    strength: reflection.strength.value,
    matrix: reflection.matrix.value.clone(),
    wet: lighting.wet.value,
  };
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  let passes = 0;
  const renderer = { render: () => passes++, clear() {}, getRenderTarget: () => null, setRenderTarget() {} };
  const mirror = new GroundReflection(renderer, scene, camera);
  try {
    lighting.wet.value = 1;
    syncAt(camera, 0, 0, 0);
    check(
      "Skip the singular wet reflection when the camera lies on the ground plane",
      !mirror.render() && passes === 0 && reflection.strength.value === 0,
    );
    const rig = new THREE.Group();
    rig.position.y = 10;
    rig.rotation.z = 0.3;
    camera.position.y = 3;
    rig.add(camera);
    rig.updateMatrixWorld(true);
    const worldUp = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1).normalize();
    worldUp.y *= -1;
    check(
      "Reflect the world-space camera orientation of a parented rig",
      mirror.render() && mirror.mirror.up.distanceTo(worldUp) < 1e-5,
    );
    mirror.dispose();
    check(
      "Clear the reflection sampler when disposing its current render target",
      reflection.texture.value === null && reflection.strength.value === 0,
    );
  } finally {
    reflection.texture.value = saved.texture;
    reflection.matrix.value.copy(saved.matrix);
    reflection.strength.value = saved.strength;
    lighting.wet.value = saved.wet;
  }
  const ground = groundLayer(
    new THREE.Mesh(new THREE.PlaneGeometry(), [new THREE.MeshBasicMaterial(), new THREE.MeshBasicMaterial()]),
    LAYER.marking,
  );
  check(
    "Cover the ground layer preset on multi-material road geometry",
    ground.material.every((m) => m.depthTest && !m.depthWrite && m.polygonOffset),
  );
  ground.material[0].userData.coverageEdges = true;
  scene.add(ground);
  const view = { scene, post: { sceneRT: { samples: 4 } } };
  SceneView.prototype.applyCoverage.call(view);
  check(
    "Apply alpha-to-coverage to tagged entries on multi-material scenery",
    ground.material[0].alphaToCoverage && !ground.material[1].alphaToCoverage,
  );
  ground.geometry.dispose();
  for (const material of ground.material) material.dispose();
  const near = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  const far = near.clone();
  const lod = chunkLOD(near, far);
  check("Keep only the detailed scenery level visible before the first LOD update", near.visible && !far.visible);
  near.geometry.dispose();
  near.material.dispose();
  lod.clear();
}

export function runRendererRegressions(check) {
  geometryChecks(check);
  cameraChecks(check);
  weatherChecks(check);
  minimapChecks(check);
  overlayChecks(check);
  actorChecks(check);
  wetRoadChecks(check);
  crossoverChecks(check);
  sceneChecks(check);
}
