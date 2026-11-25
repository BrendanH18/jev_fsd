// simTime is elapsed simulation seconds. hour is local time in decimal hours, weekday is Monday
// (0) through Sunday (6), and rate is local-clock seconds per simulated second.
const HOURS_PER_DAY = 24;
const DAYS_PER_WEEK = 7;
const SECONDS_PER_HOUR = 3600;
const DEFAULT_TRAFFIC = 40;
const DEFAULT_HOUR = 15.5;

export class WorldClock {
  constructor(hour = DEFAULT_HOUR, rate = 0, weekday = 0) {
    this.weekday = normalizeWeekday(weekday);
    this.hour = normalizeHour(hour);
    this.rate = validRate(rate);
    this.lastTime = null;
  }

  update(simTime) {
    // Replay restoration assigns the public clock fields from the saved frame.
    if (!Number.isFinite(this.hour) || this.hour < 0 || this.hour >= HOURS_PER_DAY)
      this.hour = normalizeHour(this.hour);
    if (!Number.isInteger(this.weekday) || this.weekday < 0 || this.weekday >= DAYS_PER_WEEK)
      this.weekday = normalizeWeekday(this.weekday);
    this.rate = validRate(this.rate);
    if (this.lastTime !== null && (!Number.isFinite(this.lastTime) || this.lastTime < 0)) this.lastTime = null;
    if (!Number.isFinite(simTime) || simTime < 0) return this.hour;
    if (this.lastTime !== null) {
      // An older sample must not move the anchor, or part of the next interval is counted twice.
      // Replay seek restores the saved anchor with the rest of the clock state.
      if (simTime < this.lastTime) return this.hour;
      const elapsed = simTime - this.lastTime;
      let advanced = (elapsed * this.rate) / SECONDS_PER_HOUR;
      if (!Number.isSafeInteger(Math.floor(advanced))) {
        const week = (HOURS_PER_DAY * DAYS_PER_WEEK * SECONDS_PER_HOUR) / this.rate;
        advanced = ((elapsed % week) * this.rate) / SECONDS_PER_HOUR;
      }
      const next = this.hour + advanced;
      this.weekday = (this.weekday + Math.floor(next / HOURS_PER_DAY)) % DAYS_PER_WEEK;
      this.hour = normalizeHour(next);
    }
    this.lastTime = simTime;
    return this.hour;
  }

  setHour(hour, simTime) {
    this.update(simTime);
    if (Number.isFinite(hour)) this.hour = normalizeHour(hour);
  }
  setRate(rate, simTime) {
    this.update(simTime);
    this.rate = validRate(rate);
  }
}

export function formatClock(hour) {
  const minutes = Math.min(HOURS_PER_DAY * 60 - 1, Math.floor(normalizeHour(hour) * 60 + 1e-7));
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export function worldOptions(params, defaultTraffic = DEFAULT_TRAFFIC) {
  const integer = (name, fallback, min, max) => {
    const raw = params.get(name);
    if (raw === null || !/^\d+$/.test(raw)) return fallback;
    return Math.max(min, Math.min(max, Number(raw)));
  };
  const traffic = Number.isFinite(defaultTraffic)
    ? Math.max(0, Math.min(120, Math.round(defaultTraffic)))
    : DEFAULT_TRAFFIC;
  const clock = params.get("clock");
  return {
    seed: integer("seed", 1, 1, 2147483647),
    traffic: integer("traffic", traffic, 0, 120),
    clockRate: clock === "1" ? 1 : clock === "60" ? 60 : 0,
  };
}

const normalizeHour = (hour) =>
  Number.isFinite(hour) ? ((hour % HOURS_PER_DAY) + HOURS_PER_DAY) % HOURS_PER_DAY : DEFAULT_HOUR;
const normalizeWeekday = (weekday) =>
  Number.isSafeInteger(weekday) ? ((weekday % DAYS_PER_WEEK) + DAYS_PER_WEEK) % DAYS_PER_WEEK : 0;
const validRate = (rate) => (rate === 1 || rate === 60 ? rate : 0);

// Parse "17:30", "17.5", or a named preset into hours.
export const TIME_PRESETS = Object.freeze({
  dawn: 7.1,
  morning: 9.0,
  noon: 13.2,
  afternoon: DEFAULT_HOUR,
  golden: 18.3,
  dusk: 19.2,
  night: 22.5,
});
export function parseHour(value, fallback = TIME_PRESETS.afternoon) {
  if (typeof value === "number") return Number.isFinite(value) ? normalizeHour(value) : fallback;
  if (typeof value !== "string") return fallback;
  const text = value.trim();
  if (Object.hasOwn(TIME_PRESETS, text)) return TIME_PRESETS[text];
  const clock = /^(\d{1,2}):([0-5]\d)$/.exec(text);
  if (clock) {
    const hours = Number(clock[1]);
    const minutes = Number(clock[2]);
    if (hours === HOURS_PER_DAY && minutes === 0) return 0;
    return hours < HOURS_PER_DAY ? hours + minutes / 60 : fallback;
  }
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) return fallback;
  const hour = Number(text);
  return Number.isFinite(hour) ? normalizeHour(hour) : fallback;
}
