// A tailgater flashing its headlights at the driven car (sim/tailgaters.js `tailgaterFlash`): render-only.
// Call after syncCar, which sets the headlamps' material again every frame.
export function syncTailgaterFlash(mesh, on) {
  const u = mesh?.userData;
  if (!u?.head || !on) return;
  u.flashHead ||= u.head.material.clone();
  u.flashHead.emissiveIntensity = 9;
  u.head.material = u.flashHead;
}
