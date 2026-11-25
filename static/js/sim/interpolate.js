// Visual interpolation only: the physics, sensing and scoring always use fixed-step poses.
export function capturePose(state, previous = {}) {
  previous.x = state.x;
  previous.y = state.y;
  previous.psi = Number.isFinite(state.psi) ? state.psi : 0;
  return previous;
}

export function interpolatePose(state, previous, alpha) {
  if (!previous || typeof alpha !== "number" || Number.isNaN(alpha)) return state;
  const dx = state.x - previous.x,
    dy = state.y - previous.y;
  const heading = (Number.isFinite(state.psi) ? state.psi : 0) - previous.psi;
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || !Number.isFinite(heading)) return state;
  const angle = Math.atan2(Math.sin(heading), Math.cos(heading));
  // Teleports and lane resets should snap rather than sweep the car through buildings.
  if (Math.hypot(dx, dy) > 12 || Math.abs(angle) > Math.PI / 2) return state;
  const t = Math.max(0, Math.min(1, alpha));
  return {
    ...state,
    x: previous.x + dx * t,
    y: previous.y + dy * t,
    psi: previous.psi + angle * t,
  };
}
