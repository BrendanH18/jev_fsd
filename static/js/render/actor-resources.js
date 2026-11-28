// Materials and geometries may outlive an actor when another mesh or a factory cache shares them.
// Textures are managed by the modules that cache them.
const shared = new WeakSet();
const replaceableMaterials = new WeakMap();

export function shareActorResources(resources) {
  for (const resource of resources) shared.add(resource);
}

export function rememberActorMaterial(root, material) {
  let materials = replaceableMaterials.get(root);
  if (!materials) {
    materials = new Set();
    replaceableMaterials.set(root, materials);
  }
  materials.add(material);
  return material;
}

export function retireActor(root) {
  root.removeFromParent();
  const geometry = new Set();
  const materials = replaceableMaterials.get(root) ?? new Set();
  root.traverse((object) => {
    if (object.geometry && !shared.has(object.geometry)) geometry.add(object.geometry);
    if (object.material) {
      for (const material of Array.isArray(object.material) ? object.material : [object.material])
        if (!shared.has(material)) materials.add(material);
    }
    // Instanced meshes allocate instance attributes separately from their geometry.
    if (object.isInstancedMesh) object.dispose();
    if (object.isSkinnedMesh) object.skeleton.dispose();
  });
  for (const resource of geometry) resource.dispose();
  for (const material of materials) material.dispose();
  replaceableMaterials.delete(root);
}
