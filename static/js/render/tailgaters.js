import { rememberActorMaterial } from "./actor-resources.js";
import { tailgaterFlash } from "../sim/tailgaters.js";

// A tailgater flashing its headlights at the driven car (sim/tailgaters.js `tailgaterFlash`): render-only.
// Call after syncCar, which sets the headlamps' material again every frame.
export function syncTailgaterFlash(mesh, on) {
  const u = mesh?.userData;
  if (!u?.head || !on) return;
  u.flashHead ||= rememberActorMaterial(mesh, u.head.material.clone());
  u.flashHead.emissiveIntensity = 9;
  u.head.material = u.flashHead;
}

export const view = {
  car: {
    order: 2,
    effect(world, mesh, vehicle) {
      if (vehicle.tailgate && world.tailgaters?.enabled) syncTailgaterFlash(mesh, tailgaterFlash(world, vehicle));
    },
  },
};
