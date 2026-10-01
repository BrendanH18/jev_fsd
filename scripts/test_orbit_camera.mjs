// node --experimental-default-type=module scripts/test_orbit_camera.mjs
import assert from 'node:assert/strict';
import { OrbitCamera } from '../static/js/render/orbit-camera.js';
import { OrbitControls } from '../static/js/ui/orbit-controls.js';
import { VEHICLE_MODELS } from '../static/js/sim/vehicle-models.js';

const near = (a, b) => assert(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
const rig = new OrbitCamera();
const ego = { x: 20, y: -30, psi: 0.3, spec: VEHICLE_MODELS[5].spec };
const state = JSON.stringify(ego), start = rig.pose(ego, 1.87);
rig.rotate(2 * Math.PI / 0.007, 0);
const roundTrip = rig.pose(ego, 1.87);
near(start.x, roundTrip.x); near(start.y, roundTrip.y);
rig.rotate(Math.PI / 0.007, 0);
const front = rig.pose(ego, 1.87);
near(front.x + start.x, 2 * start.look[0]); near(front.y + start.y, 2 * start.look[1]);
const moved = rig.pose({ ...ego, x: ego.x + 100, y: ego.y - 50 }, 1.87);
near(moved.x - front.x, 100); near(moved.y - front.y, -50);
assert.equal(JSON.stringify(ego), state, 'camera never modifies vehicle state');
rig.rotate(0, 1e9); assert(rig.pose(ego).z > 0);
rig.rotate(0, -1e9); assert(rig.elevation < Math.PI / 2);
for (const model of VEHICLE_MODELS) {
  rig.zoom(-1e9, model.spec);
  assert(rig.distance >= model.spec.length * 0.9);
  rig.zoom(1e9, model.spec); rig.zoom(1e9, model.spec);
  assert(rig.distance <= 35);
  assert(Object.values(rig.pose({ ...ego, spec: model.spec })).slice(0, 3).every(Number.isFinite));
}
rig.reset(); near(rig.distance, 10); near(rig.azimuth, Math.PI);

globalThis.window = new EventTarget();
globalThis.document = new EventTarget();
class Canvas extends EventTarget {
  constructor() { super(); this.captures = new Set(); this.clientHeight = 800; this.classList = { add() {}, remove() {} }; }
  focus() { this.focused = true; }
  setPointerCapture(id) { this.captures.add(id); }
  hasPointerCapture(id) { return this.captures.has(id); }
  releasePointerCapture(id) { this.captures.delete(id); emit(this, 'lostpointercapture', { pointerId: id }); }
}
function emit(target, type, fields = {}) {
  const ev = new Event(type, { cancelable: true }); Object.assign(ev, fields); target.dispatchEvent(ev); return ev;
}
const canvas = new Canvas(), calls = [];
const controls = new OrbitControls(canvas, {
  rotate: (x, y) => calls.push(['rotate', x, y]), zoom: delta => calls.push(['zoom', delta]), pinch: scale => calls.push(['pinch', scale]),
});
const pointer = (type, id, x, y, extra = {}) => emit(canvas, type, { pointerId: id, clientX: x, clientY: y, pointerType: 'mouse', button: 0, ...extra });
pointer('pointerdown', 1, 100, 100);
pointer('pointermove', 1, 140, 110);
assert.deepEqual(calls.pop(), ['rotate', 40, 10]); assert(canvas.focused && canvas.hasPointerCapture(1));
pointer('pointerup', 1, 140, 110);
assert.equal(controls.points.size, 0);
pointer('pointermove', 1, 190, 110); assert.equal(calls.length, 0);
pointer('pointerdown', 2, 0, 0, { button: 2 }); assert.equal(controls.points.size, 0);
pointer('pointerdown', 3, 0, 0, { pointerType: 'touch' });
pointer('pointerdown', 4, 100, 0, { pointerType: 'touch' });
pointer('pointermove', 4, 200, 0, { pointerType: 'touch' });
assert.deepEqual(calls.splice(0), [['pinch', 0.5], ['rotate', 50, 0]]);
pointer('pointercancel', 4, 200, 0, { pointerType: 'touch' });
pointer('pointermove', 3, 10, 0, { pointerType: 'touch' });
assert.deepEqual(calls.pop(), ['rotate', 10, 0]);
emit(window, 'blur'); assert.equal(controls.points.size, 0); assert.equal(canvas.captures.size, 0);
const wheel = emit(canvas, 'wheel', { deltaY: 3, deltaMode: 1 });
assert(wheel.defaultPrevented); assert.deepEqual(calls.pop(), ['zoom', 48]);
const browserZoom = emit(canvas, 'wheel', { deltaY: 3, ctrlKey: true });
assert(!browserZoom.defaultPrevented); assert.equal(calls.length, 0);
const keyboard = emit(canvas, 'keydown', { key: 'ArrowLeft', shiftKey: true });
assert(keyboard.defaultPrevented); assert.deepEqual(calls.pop(), ['rotate', -24, 0]);
const driving = emit(canvas, 'keydown', { key: 'ArrowLeft' });
assert(!driving.defaultPrevented); assert.equal(calls.length, 0);
console.log('Orbit camera checks passed: 360° wrap, following, vehicle clearance, bounds, state isolation, reset, drag capture, pinch, cancellation, blur, wheel units, browser zoom and keyboard separation.');
