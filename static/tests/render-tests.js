// Run from the simulator console (its import map provides Three.js):
// await import('/tests/render-tests.js').then(m => m.runRenderTests())
import * as THREE from "three";
import { chunkLOD } from "../js/render/lod.js";
import { buildParkedCars, hideParkedCar } from "../js/render/cars.js";
import { buildTrees } from "../js/render/trees.js";
import { SceneView, groundLayer, LAYER } from "../js/render/scene.js";
import { GroundReflection, reflection } from "../js/render/reflection.js";
import { lighting } from "../js/render/atmosphere.js";
import { PostFX } from "../js/render/post.js";

export function runRenderTests() {
  const results = [];
  const check = (name, ok) => results.push({ name, ok: !!ok });
  const camera = new THREE.PerspectiveCamera();
  const at = (x, y, z) => { camera.position.set(x, y, z); camera.updateMatrixWorld(); };

  const car = { x: 1020, y: -540, psi: 0.7, color: 0x3377aa, style: 0 };
  const neighbor = { ...car, x: 1030, style: 1 };
  const parked = buildParkedCars([car, neighbor]);
  parked.updateMatrixWorld(true);
  const lod = parked.children[0];
  const matrix = new THREE.Matrix4(), worldMatrix = new THREE.Matrix4();
  const expected = new THREE.Matrix4().makeRotationY(car.psi).setPosition(car.x, 0, -car.y);
  for (const [level, object] of lod.levels.entries()) {
    const body = object.object.children[0];
    body.getMatrixAt(0, matrix);
    worldMatrix.multiplyMatrices(body.matrixWorld, matrix);
    check(`parked level ${level} preserves world pose`, worldMatrix.elements.every((v, i) => Math.abs(v - expected.elements[i]) < 1e-5));
    const color = new THREE.Color();
    body.getColorAt(0, color);
    check(`parked level ${level} preserves paint`, Math.abs(color.r - new THREE.Color(car.color).r) < 1e-6);
  }
  at(car.x, 3, -car.y);
  lod.update(camera);
  check("near parked car uses detailed wheels and trim", lod.getCurrentLevel() === 0 && lod.levels[0].object.visible && !lod.levels[1].object.visible);
  at(car.x + 1000, 3, -car.y);
  lod.update(camera);
  check("distant parked car uses cheaper geometry", lod.getCurrentLevel() === 1 && !lod.levels[0].object.visible && lod.levels[1].object.visible);
  const triangles = (level) => {
    let total = 0;
    level.traverse(o => { if (o.isMesh) total += (o.geometry.index?.count || o.geometry.attributes.position.count) / 3 * o.count; });
    return total;
  };
  check("distant parked geometry removes at least half the triangles", triangles(lod.levels[1].object) < triangles(lod.levels[0].object) / 2);
  hideParkedCar(car);
  check("pull-out removes every near and far instance", car.instances.every(({ mesh, i }) => {
    mesh.getMatrixAt(i, matrix);
    return matrix.elements[0] === 0 && matrix.elements[5] === 0 && matrix.elements[10] === 0;
  }));
  check("pull-out leaves neighboring parked instances intact", neighbor.instances.every(({ mesh, i }) => {
    mesh.getMatrixAt(i, matrix);
    return Math.abs(matrix.determinant() - 1) < 1e-5;
  }));

  // A wide batch keeps an object at its closest edge detailed. Hysteresis avoids flicker when
  // the camera oscillates around the switch distance, including in top-down views.
  const near = new THREE.Group(), far = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(200, 10, 20));
  mesh.position.set(500, 5, 600);
  near.add(mesh); far.add(mesh.clone());
  const chunk = chunkLOD(near, far);
  at(395, 5, 600); chunk.update(camera);
  check("near edge of a wide chunk retains detail", chunk.getCurrentLevel() === 0);
  const threshold = chunk.levels[1].distance;
  at(500 + threshold + 1, 5, 600); chunk.update(camera);
  at(500 + threshold - 1, 5, 600); chunk.update(camera);
  check("detail switch has hysteresis", chunk.getCurrentLevel() === 1);
  at(500 + threshold * 0.8, 5, 600); chunk.update(camera);
  check("detail returns when camera approaches", chunk.getCurrentLevel() === 0);

  const trees = buildTrees({ extent: [1000, 500, 1080, 580], roundabouts: new Map(),
    roadDistance: () => ({ distance: 20 }) }, { streets: [] }, { near: () => false });
  check("tree fixture contains foliage", trees.userData.count > 0);
  check("distant tree batches reduce triangles and draw calls", trees.children.every(tree =>
    triangles(tree.levels[1].object) < triangles(tree.levels[0].object) / 2 &&
    tree.levels[1].object.children.length <= tree.levels[0].object.children.length));
  check("only detailed scenery casts shadows", [...parked.children, ...trees.children].every(tree =>
    tree.levels[0].object.children.some(o => o.castShadow) && tree.levels[1].object.children.every(o => !o.castShadow)));

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.MeshBasicMaterial());
  const paint = new THREE.Mesh(ground.geometry, new THREE.MeshBasicMaterial());
  groundLayer(ground, LAYER.grass); groundLayer(paint, LAYER.marking);
  check("road paint keeps a single stable ground depth", ground.material.depthWrite && !paint.material.depthWrite && paint.material.polygonOffset && paint.material.depthFunc === THREE.LessEqualDepth);

  const calls = [], renderer = { shadowMap: { autoUpdate: true } };
  const view = { renderer, camera, sceneryLODs: [lod],
    reflection: { render: () => { calls.push(renderer.shadowMap.autoUpdate); return true; } },
    post: { render: () => calls.push(renderer.shadowMap.autoUpdate) } };
  SceneView.prototype.render.call(view, 0);
  check("wet main pass reuses fresh reflection-pass shadows", calls.length === 2 && calls[0] === true && calls[1] === false && renderer.shadowMap.autoUpdate === true);
  view.post.render = () => { throw new Error("test render failure"); };
  try { SceneView.prototype.render.call(view, 0); } catch { /* verify state restoration below */ }
  check("render errors restore shadow updates", renderer.shadowMap.autoUpdate);
  const registration = { scene: new THREE.Scene(), sceneryLODs: [] };
  SceneView.prototype.addScenery.call(registration, parked);
  check("reflection camera cannot independently select detail", registration.sceneryLODs.includes(lod) && !lod.autoUpdate);

  const savedReflection = { texture: reflection.texture.value, matrix: reflection.matrix.value.clone(),
    strength: reflection.strength.value, wet: lighting.wet.value };
  let target = null;
  let reflectionSampler;
  const fakeRenderer = { getRenderTarget: () => target, setRenderTarget: value => { target = value; }, clear: () => {},
    render: () => { reflectionSampler = reflection.texture.value; } };
  const mirror = new GroundReflection(fakeRenderer, new THREE.Scene(), camera);
  try {
    lighting.wet.value = 1;
    camera.position.set(0, 3, 8); camera.lookAt(0, 0, -20); camera.updateMatrixWorld();
    mirror.setSize(1280, 800); mirror.render();
    const project = (y) => new THREE.Vector4(0, y, -10, 1).applyMatrix4(mirror.mirror.matrixWorldInverse).applyMatrix4(mirror.mirror.projectionMatrix);
    const above = project(1), below = project(-1);
    check("reflection clips geometry below the road", above.z >= -above.w && below.z < -below.w);
    check("high reflections use quarter-size buffers", mirror.rt.width === 320 && mirror.rt.height === 200);
    check("mirror pass unbinds its attached reflection texture", reflectionSampler === null && reflection.texture.value === mirror.rt.texture);
    fakeRenderer.render = () => { throw new Error("test reflection failure"); };
    try { mirror.render(); } catch { /* verify state restoration below */ }
    check("reflection errors restore target, strength and sampler", target === null && reflection.strength.value === 1 && reflection.texture.value === mirror.rt.texture);
  } finally {
    mirror.dispose();
    reflection.texture.value = savedReflection.texture; reflection.matrix.value.copy(savedReflection.matrix);
    reflection.strength.value = savedReflection.strength; lighting.wet.value = savedReflection.wet;
  }

  const post = new PostFX({ getDrawingBufferSize: size => size.set(64, 32) }, new THREE.Scene(), camera);
  try {
    post.setAO(true); post.setSize(100, 50);
    check("enabling AO after a resize uses the scene depth and half-size buffers", post.ao.depthTexture === post.sceneRT.depthTexture && post.ao.width === 50 && post.ao.height === 25);
    post.setAO(false);
    check("disabling AO releases its extra render targets", post.ao === null && post.blendRT === null);
    post.setAO(true); post.setAO(false);
    check("repeated quality transitions release AO cleanly", post.ao === null && post.blendRT === null);
  } finally { post.dispose(); }

  // Exercise the real WebGL pipeline too: a uniform value of zero alone does not prevent an
  // attached texture/sampler feedback loop, which mocks cannot detect.
  const live = window.__jev?.view;
  if (live) {
    const quality = live.quality, wet = lighting.wet.value, gl = live.renderer.getContext();
    for (let i = 0; i < 10 && gl.getError() !== gl.NO_ERROR; i++) { /* drain earlier errors */ }
    try {
      lighting.wet.value = 1;
      for (const [i, quality] of ['high', 'ultra', 'high', 'low'].entries()) {
        live.setQuality(quality);
        // setQuality reapplies the atmosphere, so re-enable wet sampling for each case.
        lighting.wet.value = 1;
        live.render(0);
        check(`wet WebGL frame after quality transition ${i} (${quality})`, gl.getError() === gl.NO_ERROR);
      }
    } finally { live.setQuality(quality); lighting.wet.value = wet; }
  }

  // Dispose fixture buffers; materials/geometries shared with the live scene stay cached.
  const buffers = new Set();
  for (const root of [parked, trees, chunk]) root.traverse(o => {
    if (o.isInstancedMesh) o.dispose();
    if (root !== parked && o.geometry) buffers.add(o.geometry);
  });
  for (const geometry of buffers) geometry.dispose();
  ground.geometry.dispose(); ground.material.dispose(); paint.material.dispose();
  return results;
}
