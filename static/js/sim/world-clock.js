// A simulation-time clock. Pausing the world pauses daylight too; changing the rate
// keeps the current time rather than jumping back to the start of the drive.
export class WorldClock {
  constructor(hour = 15.5, rate = 0, weekday = 0) {
    this.weekday = Number.isInteger(weekday) ? ((weekday % 7) + 7) % 7 : 0;
    this.hour = normalizeHour(hour);
    this.rate = validRate(rate);
    this.lastTime = null;
  }

  update(simTime) {
    if (!Number.isFinite(simTime)) return this.hour;
    if (this.lastTime !== null) {
      const next = this.hour + (Math.max(0, simTime - this.lastTime) * this.rate) / 3600;
      this.weekday = (this.weekday + Math.floor(next / 24)) % 7;
      this.hour = normalizeHour(next);
    }
    this.lastTime = simTime;
    return this.hour;
  }

  setHour(hour, simTime) {
    this.update(simTime);
    this.hour = normalizeHour(hour);
  }
  setRate(rate, simTime) {
    this.update(simTime);
    this.rate = validRate(rate);
  }
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

const normalizeHour = (hour) => (Number.isFinite(hour) ? ((hour % 24) + 24) % 24 : 15.5);
const validRate = (rate) => ([0, 1, 60].includes(rate) ? rate : 0);

// Parse "17:30", "17.5", or a named preset into hours.
export const TIME_PRESETS = {
  dawn: 7.1,
  morning: 9.0,
  noon: 13.2,
  afternoon: 15.5,
  golden: 18.3,
  dusk: 19.2,
  night: 22.5,
};
export function parseHour(value, fallback = TIME_PRESETS.afternoon) {
  if (typeof value === "number") return Number.isFinite(value) ? normalizeHour(value) : fallback;
  if (typeof value !== "string") return fallback;
  const text = value.trim();
  if (Object.hasOwn(TIME_PRESETS, text)) return TIME_PRESETS[text];
  const clock = /^(\d{1,2}):([0-5]\d)$/.exec(text);
  if (clock) return (+clock[1] % 24) + +clock[2] / 60;
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) return fallback;
  const hour = Number(text);
  return Number.isFinite(hour) ? normalizeHour(hour) : fallback;
}
