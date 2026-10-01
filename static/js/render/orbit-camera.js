// A car-relative camera rig. Pure geometry keeps controls independent of rendering/physics.
const clamp = (x, min, max) => Math.max(min, Math.min(max, x));
const wrap = x => Math.atan2(Math.sin(x), Math.cos(x));

export class OrbitCamera {
  constructor() { this.reset(); }

  reset() { this.azimuth = Math.PI; this.elevation = 0.34; this.distance = 10; }

  rotate(dx, dy) {
    this.azimuth = wrap(this.azimuth - dx * 0.007);
    this.elevation = clamp(this.elevation - dy * 0.005, 0.12, 1.36);
  }

  zoom(delta, spec) { this.setDistance(this.distance * Math.exp(clamp(delta, -2000, 2000) * 0.0015), spec); }

  setDistance(distance, spec) {
    // Leave clearance around the longest vehicle, even at the lowest camera angle.
    this.distance = clamp(distance, Math.max(4.2, (spec?.length || 4.5) * 0.9), 35);
  }

  pose(ego, height = 1.45) {
    this.setDistance(this.distance, ego.spec);
    const center = (ego.spec?.length || 4.5) / 2 - (ego.spec?.rearOverhang || 0.9);
    const cx = ego.x + Math.cos(ego.psi) * center, cy = ego.y + Math.sin(ego.psi) * center;
    const z = height * 0.55, angle = ego.psi + this.azimuth;
    const radius = this.distance * Math.cos(this.elevation);
    return { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius,
      z: z + this.distance * Math.sin(this.elevation), look: [cx, cy, z] };
  }
}
