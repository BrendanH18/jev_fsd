import assert from 'node:assert/strict';
import { capturePose, interpolatePose } from '../static/js/sim/interpolate.js';

const previous = { x: 0, y: 2, psi: 0 }, current = { x: 10, y: 4, psi: 0.2, v: 12, signal: 'left' };
const half = interpolatePose(current, previous, 0.5);
assert.equal(half.x, 5); assert.equal(half.y, 3); assert(Math.abs(half.psi - 0.1) < 1e-9); assert.equal(half.v, 12); assert.equal(half.signal, 'left');
assert.equal(current.x, 10); assert.equal(previous.x, 0);
const crossing = interpolatePose({ x: 0, y: 0, psi: -Math.PI + 0.1 }, { x: 0, y: 0, psi: Math.PI - 0.1 }, 0.5);
assert(Math.abs(crossing.psi - Math.PI) < 1e-9);
assert.equal(interpolatePose(current, previous, -1).x, 0);
assert.equal(interpolatePose(current, previous, 2).x, 10);
const teleport = { ...current, x: 200 }; assert.equal(interpolatePose(teleport, previous, 0.5), teleport);
assert.equal(interpolatePose(current, null, 0.5), current);
const reused = {}; assert.equal(capturePose(current, reused), reused); assert.deepEqual(reused, { x: 10, y: 4, psi: 0.2 });
console.log('Visual interpolation checks passed: midpoint, state isolation, angle wrapping, bounds, teleports, missing history and capture reuse');
