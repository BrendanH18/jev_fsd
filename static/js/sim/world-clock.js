// A simulation-time clock. Pausing the world pauses daylight too; changing the rate
// keeps the current time rather than jumping back to the start of the drive.
export class WorldClock {
  constructor(hour = 15.5, rate = 0) {
    this.hour = normalizeHour(hour);
    this.rate = validRate(rate);
    this.lastTime = null;
  }

  update(simTime) {
    if (!Number.isFinite(simTime)) return this.hour;
    if (this.lastTime !== null) {
      this.hour = normalizeHour(this.hour + Math.max(0, simTime - this.lastTime) * this.rate / 3600);
    }
    this.lastTime = simTime;
    return this.hour;
  }

  setHour(hour, simTime) { this.update(simTime); this.hour = normalizeHour(hour); }
  setRate(rate, simTime) { this.update(simTime); this.rate = validRate(rate); }
}

export function formatClock(hour) {
  const minutes = Math.floor(normalizeHour(hour) * 60 + 1e-7) % 1440;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export function worldOptions(params, defaultTraffic = 40) {
  const integer = (name, fallback, min, max) => {
    const raw = params.get(name);
    if (raw === null || !/^\d+$/.test(raw)) return fallback;
    return Math.max(min, Math.min(max, Number(raw)));
  };
  return {
    seed: integer("seed", 1, 1, 2147483647),
    traffic: integer("traffic", Math.max(0, Math.min(120, Math.round(defaultTraffic))), 0, 120),
    clockRate: validRate(Number(params.get("clock") || 0)),
  };
}

const normalizeHour = hour => Number.isFinite(hour) ? ((hour % 24) + 24) % 24 : 15.5;
const validRate = rate => [0, 1, 60].includes(rate) ? rate : 0;
