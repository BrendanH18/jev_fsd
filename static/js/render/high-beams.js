// High beams (sim/high-beams.js): the lamps of the cars that carry them, and the driver's tell-tale.
import { npcHighBeam } from "../sim/high-beams.js";

function tellTale() {
  const host = globalThis.document?.body;
  if (!host) return null;
  const lamp = document.createElement("div");
  lamp.textContent = "≋ HIGH BEAM";
  lamp.hidden = true;
  lamp.style.cssText =
    "position:fixed;right:24px;bottom:calc(var(--touch-h, 0px) + 100px);color:#59aaff;background:#102341;padding:6px 10px;border-radius:6px;z-index:20;font:600 13px sans-serif;pointer-events:none";
  host.append(lamp);
  return lamp;
}

export const view = {
  mount: {
    order: 17,
    run: ({ world }) => (world.highBeams ? tellTale() : null),
    frame(lamp, { world }) {
      lamp.hidden = !world.ego.highBeam;
    },
  },
  car: {
    order: 1,
    pose: (world, vehicle, pose) => (world.highBeams ? { ...pose, highBeam: npcHighBeam(world, vehicle) } : pose),
  },
  // (the pose is the adapter's own copy: the supplied ego state keeps no render-only override)
  ego: { order: 1, pose: (world, pose) => (world.highBeams ? { ...pose, highBeam: !!world.ego.highBeam } : pose) },
};
