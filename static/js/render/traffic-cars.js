import * as THREE from "three";

// Keep batches spatial so reflection, shadow and main cameras can still cull distant traffic.
const BATCH_CELL = 120;

export class TrafficCarBatches {
  constructor(scene) {
    this.scene = scene;
    this.buckets = new Map();
  }

  add(car) {
    const { x, z } = car.position;
    const cell = `${Math.floor(x / BATCH_CELL)},${Math.floor(z / BATCH_CELL)}`;
    const { body, wheels, tail } = car.userData;
    car.updateMatrixWorld();
    for (const part of body.children)
      if (part.isMesh && part.material !== tail && !part.material.transparent) this.addPart(cell, part);
    for (const { wheel } of wheels) this.addPart(cell, wheel);
  }

  addPart(cell, part) {
    // Keep the source mesh as the animation target. Its visibility still belongs to the animator.
    part.layers.enable(0);
    const materialId = Array.isArray(part.material) ? part.material[0].id : part.material.id;
    const key = `${cell}:${part.geometry.id}:${materialId}`;
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { present: false, parts: [], batch: null };
      this.buckets.set(key, bucket);
    }
    bucket.present = true;
    for (let object = part; object; object = object.parent) {
      if (!object.visible) return;
    }
    bucket.parts.push(part);
  }

  flush() {
    for (const [key, bucket] of this.buckets) {
      const { parts } = bucket;
      const count = parts.length;
      if (!bucket.present) {
        this.retire(bucket.batch);
        this.buckets.delete(key);
        continue;
      }
      // A lone part keeps its tight culling. Keep the buffer when lamps blink off and back on.
      if (count < 2) {
        if (bucket.batch) {
          bucket.batch.count = 0;
          bucket.batch.visible = false;
        }
      } else {
        const first = parts[0];
        if (!bucket.batch || bucket.batch.instanceMatrix.count < count) {
          this.retire(bucket.batch);
          const capacity = Math.max(count, (bucket.batch?.instanceMatrix.count ?? 0) * 2);
          const batch = new THREE.InstancedMesh(first.geometry, first.material, capacity);
          batch.name = "moving-traffic-batch";
          batch.castShadow = first.castShadow;
          batch.receiveShadow = first.receiveShadow;
          batch.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
          this.scene.add(batch);
          bucket.batch = batch;
        }
        const { batch } = bucket;
        batch.count = count;
        batch.visible = true;
        for (let i = 0; i < count; i++) {
          const part = parts[i];
          batch.setMatrixAt(i, part.matrixWorld);
          part.layers.disable(0);
        }
        batch.instanceMatrix.clearUpdateRanges();
        batch.instanceMatrix.addUpdateRange(0, count * 16);
        batch.instanceMatrix.needsUpdate = true;
        batch.computeBoundingSphere();
      }
      bucket.present = false;
      parts.length = 0;
    }
  }

  retire(batch) {
    if (!batch) return;
    batch.removeFromParent();
    // The source car factory owns the shared geometry and materials.
    batch.dispose();
  }
}
