// Visual interpolation only: the physics, sensing and scoring always use fixed-step poses.
export function capturePose(state, previous = {}) {
  previous.x = state.x; previous.y = state.y; previous.psi = state.psi || 0;
  return previous;
}

export function interpolatePose(state, previous, alpha) {
  if (!previous) return state;
  const angle = Math.atan2(Math.sin((state.psi || 0) - previous.psi), Math.cos((state.psi || 0) - previous.psi));
  // Teleports and lane resets should snap rather than sweep the car through buildings.
  if (Math.hypot(state.x - previous.x, state.y - previous.y) > 12 || Math.abs(angle) > Math.PI / 2) return state;
  const t = Math.max(0, Math.min(1, alpha));
  return { ...state, x: previous.x + (state.x - previous.x) * t,
    y: previous.y + (state.y - previous.y) * t, psi: previous.psi + angle * t };
}
