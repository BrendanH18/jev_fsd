// Static scenery keeps its detailed mesh near the camera and a cheaper silhouette farther away.
// Instances use world-space matrices. Offset both levels back from the LOD's center so they keep
// the same world positions, and pad the switch distance by the chunk's radius: every nearby
// object stays detailed, even when it sits at the closest edge of a large chunk.
import * as THREE from "three";

export function chunkLOD(near, far, distance = 100, lod = new THREE.LOD()) {
  const bounds = new THREE.Box3().setFromObject(near);
  const sphere = bounds.getBoundingSphere(new THREE.Sphere());
  lod.position.copy(sphere.center);
  near.position.sub(sphere.center);
  far.position.sub(sphere.center);
  lod.addLevel(near, 0);
  const range = Number.isFinite(distance) ? Math.max(0, distance) : 100;
  lod.addLevel(far, range + Math.max(0, sphere.radius), 0.1);
  near.visible = true;
  far.visible = false;
  // The sun's shadow patch follows the car. Distant scenery contributes its silhouette to the
  // main/reflection views, but only nearby detail casts shadows into that patch.
  far.traverse((object) => {
    if (object.isMesh) object.castShadow = false;
  });
  lod.updateMatrixWorld(true);
  // These chunks never move. Instance-buffer edits (such as a parked car pulling out) still
  // upload normally, but neither level needs its object transforms rebuilt each render pass.
  lod.traverse((object) => {
    object.matrixAutoUpdate = false;
    object.matrixWorldAutoUpdate = false;
  });
  return lod;
}
