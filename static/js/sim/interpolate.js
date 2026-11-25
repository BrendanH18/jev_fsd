// Visual interpolation only: the physics, sensing and scoring always use fixed-step poses.
const TELEPORT_M = 12;
const HEADING_RESET_RAD = Math.PI / 2;

export function capturePose(state, previous = {}) {
  if (previous === state || previous === null || typeof previous !== "object" || Array.isArray(previous)) previous = {};
  previous.x = Number.isFinite(state?.x) ? state.x : NaN;
  previous.y = Number.isFinite(state?.y) ? state.y : NaN;
  previous.psi = Number.isFinite(state?.psi) ? state.psi : 0;
  return previous;
}

export function interpolatePose(state, previous, alpha) {
  if (!state || !previous || !Number.isFinite(alpha)) return state;
  if (
    !Number.isFinite(state.x) ||
    !Number.isFinite(state.y) ||
    !Number.isFinite(previous.x) ||
    !Number.isFinite(previous.y)
  )
    return state;
  if (!Number.isFinite(previous.psi)) return state;
  const psi = Number.isFinite(state.psi) ? state.psi : 0;
  const dx = state.x - previous.x,
    dy = state.y - previous.y;
  const heading = psi - previous.psi;
  if (!Number.isFinite(heading)) return state;
  const angle = Math.atan2(Math.sin(heading), Math.cos(heading));
  // Teleports and lane resets should snap rather than sweep the car through buildings.
  if (Math.hypot(dx, dy) > TELEPORT_M || Math.abs(angle) > HEADING_RESET_RAD) return state;
  // Use the actual endpoint so roundoff in previous + delta cannot leave a replay frame short.
  // Walking actors can omit heading and still get the same zero heading as capturePose.
  if (alpha >= 1) return psi === state.psi ? state : { ...state, psi };
  if (alpha <= 0) return { ...state, x: previous.x, y: previous.y, psi: previous.psi };
  return {
    ...state,
    x: previous.x + dx * alpha,
    y: previous.y + dy * alpha,
    psi: previous.psi + angle * alpha,
  };
}
