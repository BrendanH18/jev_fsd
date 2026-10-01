// node --experimental-default-type=module scripts/test_vendor_uuid.mjs
import assert from 'node:assert/strict';
import {
  BoxGeometry, MathUtils, Mesh, MeshStandardMaterial, Scene, Texture,
} from '../static/vendor/three/build/three.core.js';

const originalRandom = Math.random;
const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
const secureCrypto = globalThis.crypto;
const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const setCrypto = value => Object.defineProperty(globalThis, 'crypto', {
  configurable: true, value,
});

try {
  // UUID generation must not quietly return to a non-cryptographic source.
  Math.random = () => { throw new Error('UUID generation used Math.random'); };
  let calls = 0;
  const buffers = new Set();
  setCrypto({ getRandomValues(words) {
    assert(words instanceof Uint32Array);
    assert.equal(words.length, 4);
    assert(!buffers.has(words), 'each UUID must request fresh entropy');
    buffers.add(words);
    words.fill(calls++ === 0 ? 0 : 0xffffffff);
    return words;
  } });
  assert.equal(MathUtils.generateUUID(), '00000000-0000-4000-8000-000000000000');
  assert.equal(MathUtils.generateUUID(), 'ffffffff-ffff-4fff-bfff-ffffffffffff');
  assert.equal(calls, 2);
  console.log('✓ UUIDs request 128 secure bits and retain version, variant and formatting');

  const entropyError = new Error('secure entropy unavailable');
  setCrypto({ getRandomValues() { throw entropyError; } });
  assert.throws(() => MathUtils.generateUUID(), error => error === entropyError);
  console.log('✓ entropy failures propagate without a weak randomness fallback');

  setCrypto(secureCrypto);
  const ids = new Set();
  for (let i = 0; i < 1000; i++) {
    const id = MathUtils.generateUUID();
    assert.match(id, uuidV4);
    assert(!ids.has(id), 'independent secure calls must produce distinct UUIDs');
    ids.add(id);
  }
  console.log('✓ real Web Crypto produces unique, lowercase version 4 UUIDs');

  const texture = new Texture();
  const material = new MeshStandardMaterial({ map: texture });
  const geometry = new BoxGeometry();
  const mesh = new Mesh(geometry, material);
  const scene = new Scene();
  scene.add(mesh);
  const objects = [texture, material, geometry, mesh, scene, mesh.clone()];
  for (const object of objects) assert.match(object.uuid, uuidV4);
  assert.equal(new Set(objects.map(object => object.uuid)).size, objects.length);
  const serialized = scene.toJSON();
  assert.equal(serialized.object.children[0].uuid, mesh.uuid);
  assert.equal(serialized.object.children[0].geometry, geometry.uuid);
  assert.equal(serialized.object.children[0].material, material.uuid);
  assert.equal(serialized.materials[0].map, texture.uuid);
  console.log('✓ graphics objects, cloning and scene serialization preserve UUID references');
} finally {
  Math.random = originalRandom;
  if (originalCrypto) Object.defineProperty(globalThis, 'crypto', originalCrypto);
  else delete globalThis.crypto;
}
