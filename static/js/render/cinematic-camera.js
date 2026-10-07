// An automatic director for the "cinematic" view. It cuts between a fixed sequence of shots, the way
// a car film would: a camera planted at the roadside as the car sweeps past, a low bumper chase, a
// slow helicopter orbit, a tracking shot from ahead, and a wheel-height side profile. Pure geometry
// in sim coordinates (x east, y north, z up), so it never touches vehicle state and is unit-testable.

const SHOTS = [
  { name: "trackside", min: 3, max: 9 },
  { name: "bumper", min: 6, max: 6 },
  { name: "aerial", min: 8, max: 8 },
  { name: "trackside", min: 3, max: 9 },
  { name: "lead", min: 6, max: 6 },
  { name: "profile", min: 5, max: 5 },
];

export class CinematicCamera {
  constructor() { this.reset(); }

  reset() {
    this.index = -1;
    this.elapsed = 0;
    this.anchor = null;
    this.side = 1;
    this.orbitStart = 0;
  }

  get shot() { return SHOTS[Math.max(0, this.index)]; }

  // Start the next shot. Each trackside shot alternates kerb sides so consecutive passes differ.
  cut(ego) {
    this.index = (this.index + 1) % SHOTS.length;
    this.elapsed = 0;
    const shot = SHOTS[this.index];
    if (shot.name === "trackside") {
      this.side = -this.side;
      const fx = Math.cos(ego.psi), fy = Math.sin(ego.psi);
      const lead = Math.min(45, Math.max(18, 18 + Math.abs(ego.v || 0) * 2.5));
      const lateral = 5.5 * this.side;
      this.anchor = [ego.x + fx * lead - fy * lateral, ego.y + fy * lead + fx * lateral, 1.1];
    } else this.anchor = null;
    if (shot.name === "aerial") this.orbitStart = ego.psi + Math.PI * 0.75;
  }

  // A trackside shot ends once the car is well past the camera (or never arrives, if it has stopped).
  finished(ego) {
    const shot = this.shot;
    if (this.elapsed >= shot.max) return true;
    if (this.elapsed < shot.min || shot.name !== "trackside") return false;
    const fx = Math.cos(ego.psi), fy = Math.sin(ego.psi);
    const ahead = (this.anchor[0] - ego.x) * fx + (this.anchor[1] - ego.y) * fy;
    return ahead < -22;
  }

  pose(ego, dt = 0, height = 1.45) {
    let cut = false;
    if (this.index < 0 || this.finished(ego)) { this.cut(ego); cut = true; }
    else this.elapsed += Math.max(0, dt);
    const fx = Math.cos(ego.psi), fy = Math.sin(ego.psi);
    const rx = fy, ry = -fx;                      // the car's right-hand side
    const len = ego.spec?.length || 4.5;
    const center = [ego.x + fx * (len / 2 - (ego.spec?.rearOverhang || 0.9)), ego.y + fy * (len / 2 - (ego.spec?.rearOverhang || 0.9)), height * 0.5];
    const at = (forward, right, z) => [center[0] + fx * forward + rx * right, center[1] + fy * forward + ry * right, z];
    const name = this.shot.name;
    let pose;
    if (name === "trackside") pose = { position: this.anchor.slice(), look: center, fov: 38, lag: 1e-4 };
    // Low shots sit toward the centre line (the car's left): parked cars line the right kerb.
    else if (name === "bumper") pose = { position: at(-len / 2 - 4, -0.45, 0.75), look: at(8, -0.1, 0.7), fov: 50, lag: 2e-3 };
    else if (name === "aerial") {
      const angle = this.orbitStart + this.elapsed * 0.14;
      pose = { position: [center[0] + Math.cos(angle) * 30, center[1] + Math.sin(angle) * 30, 20], look: center, fov: 42, lag: 0.05 };
    } else if (name === "lead") pose = { position: at(len / 2 + 6.5, -0.9, 1.25), look: at(0, 0, 0.85), fov: 40, lag: 2e-3 };
    else pose = { position: at(0.4, -3.6, 0.45), look: at(1.2, 0, 0.6), fov: 46, lag: 2e-3 };
    return { ...pose, cut, shot: name };
  }
}

export const CINEMATIC_SHOTS = SHOTS.map(shot => shot.name);
