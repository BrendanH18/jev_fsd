import assert from "node:assert/strict";
import { test } from "node:test";
import { capturePose, interpolatePose } from "../static/js/sim/interpolate.js";
import { ROAD } from "../static/js/sim/vehicle.js";
import { WEATHER, current, setWeather } from "../static/js/sim/weather.js";
import { TIME_PRESETS, WorldClock, formatClock, parseHour, worldOptions } from "../static/js/sim/world-clock.js";

test("stale elapsed samples do not make the next forward clock interval count twice", () => {
  const clock = new WorldClock(12, 60);
  clock.update(10);
  clock.update(70);
  assert.equal(clock.update(40), 13);
  assert.equal(clock.update(100), 13.5);
});

test("a negative initial sample cannot anchor local time before the drive", () => {
  const clock = new WorldClock(12, 60);
  assert.equal(clock.update(-3600), 12);
  assert.equal(clock.lastTime, null);
  assert.equal(clock.update(0), 12);
});

test("a large elapsed timestamp preserves the clock by reducing whole weeks first", () => {
  const clock = new WorldClock(23.5, 60, 6);
  clock.update(0);
  const elapsed = Number.MAX_VALUE;
  const week = 7 * 24 * 60;
  const expected = 23.5 + (elapsed % week) / 60;
  assert.ok(Math.abs(clock.update(elapsed) - (expected % 24)) < 1e-9);
  assert.equal(clock.weekday, (6 + Math.floor(expected / 24)) % 7);
});

test("a clock with zero rate accepts a huge timestamp and stays paused", () => {
  const clock = new WorldClock(12, 0, 5);
  clock.update(0);
  assert.equal(clock.update(Number.MAX_VALUE), 12);
  assert.equal(clock.weekday, 5);
});

test("rate changes settle the previous elapsed interval with the old rate", () => {
  const clock = new WorldClock(12);
  clock.update(0);
  clock.setRate(60, 30);
  assert.equal(clock.update(90), 13);
  clock.setRate(1, 120);
  assert.equal(clock.hour, 13.5);
  assert.equal(clock.update(1920), 14);
});

test("an unsupported rate is treated as paused starting at the change instant", () => {
  const clock = new WorldClock(12, 60);
  clock.update(0);
  clock.setRate("1", 60);
  assert.equal(clock.hour, 13);
  assert.equal(clock.rate, 0);
  assert.equal(clock.update(120), 13);
});

test("setting the local hour first applies any elapsed midnight rollover", () => {
  const clock = new WorldClock(23.5, 60, 4);
  clock.update(0);
  clock.setHour(8, 60);
  assert.equal(clock.weekday, 5);
  assert.equal(clock.update(120), 9);
});

test("weekday is wrapped for safe integers and replaced for imprecise inputs", () => {
  assert.equal(new WorldClock(8, 0, -1).weekday, 6);
  assert.equal(new WorldClock(8, 0, 15).weekday, 1);
  assert.equal(new WorldClock(8, 0, 2.5).weekday, 0);
  assert.equal(new WorldClock(8, 0, Number.MAX_SAFE_INTEGER + 3).weekday, 0);
});

test("the constructor and formatted fallback share the afternoon default", () => {
  const clock = new WorldClock(NaN);
  assert.equal(clock.hour, TIME_PRESETS.afternoon);
  assert.equal(formatClock(Infinity), "15:30");
});

test("time text accepts midnight as 24:00 and rejects invalid 24-hour labels", () => {
  assert.equal(parseHour("24:00", 12), 0);
  assert.equal(parseHour("24:01", 12), 12);
  assert.equal(parseHour("99:45", 12), 12);
  assert.equal(parseHour("24.5", 12), 0.5);
});

test("a time preset has one immutable source shared by parser and clock", () => {
  assert.equal(Object.isFrozen(TIME_PRESETS), true);
  assert.equal(parseHour("afternoon"), new WorldClock().hour);
});

test("clock display pads both fields and does not let floating-point minutes lag by one", () => {
  assert.equal(formatClock(4 + 1 / 60), "04:01");
  assert.equal(formatClock(-1 / 60), "23:59");
  assert.equal(formatClock(24), "00:00");
});

test("options fall back to standard traffic when the configured default is not numeric", () => {
  const empty = new URLSearchParams();
  assert.equal(worldOptions(empty, NaN).traffic, 40);
  assert.equal(worldOptions(empty, "59").traffic, 40);
  assert.equal(worldOptions(empty, 57.5).traffic, 58);
  assert.equal(worldOptions(new URLSearchParams("traffic=0"), NaN).traffic, 0);
});

test("clock URL parameters accept the declared rates in plain decimal form", () => {
  const rate = (value) => worldOptions(new URLSearchParams({ clock: value })).clockRate;
  assert.equal(rate("60"), 60);
  assert.equal(rate("1"), 1);
  assert.equal(rate("0"), 0);
  assert.equal(rate("0x3c"), 0);
  assert.equal(rate("6e1"), 0);
});

test("seed and traffic cap enormous decimal URL values without admitting fractions", () => {
  const digits = "9".repeat(400);
  const huge = worldOptions(new URLSearchParams({ seed: digits, traffic: digits }));
  assert.equal(huge.seed, 2147483647);
  assert.equal(huge.traffic, 120);
  const fractional = worldOptions(new URLSearchParams("seed=1.5&traffic=3.5"));
  assert.equal(fractional.seed, 1);
  assert.equal(fractional.traffic, 40);
});

test("the weather table and its individual presets cannot drift through mutation", () => {
  assert.equal(Object.isFrozen(WEATHER), true);
  for (const name of ["dry", "rain", "fog", "snow"]) assert.equal(Object.isFrozen(WEATHER[name]), true);
  assert.throws(() => {
    WEATHER.rain.mu = 1;
  }, TypeError);
});

test("fog visibility and desired speed are distinct from fog grip", () => {
  try {
    assert.equal(setWeather("fog") === current, true);
    assert.equal(current.visibility, 28);
    assert.equal(current.speed, 0.8);
    assert.equal(ROAD.mu, WEATHER.fog.mu);
    assert.ok(WEATHER.fog.visibility < WEATHER.snow.visibility);
  } finally {
    setWeather("dry");
  }
});

test("infinite render fractions snap instead of extrapolating or using stale history", () => {
  const live = { x: 4, y: 4, psi: 0.1 };
  const old = { x: 3, y: 4, psi: 0 };
  assert.equal(interpolatePose(live, old, Infinity) === live, true);
  assert.equal(interpolatePose(live, old, -Infinity) === live, true);
});

test("string pose samples are rejected instead of coercing into the next position", () => {
  const live = { x: 4, y: 4, psi: 0.1 };
  assert.equal(interpolatePose(live, { x: "3", y: 4, psi: 0 }, 0.5) === live, true);
  assert.equal(interpolatePose(live, { x: 3, y: 4, psi: "0" }, 0.5) === live, true);
});

test("an exact render endpoint uses the current pose despite wrap and rounding", () => {
  const live = { x: 0.01, y: 0, psi: -Math.PI + 0.1 };
  const old = { x: 11.5, y: 0, psi: Math.PI - 0.1 };
  assert.equal(interpolatePose(live, old, 1) === live, true);
  assert.equal(interpolatePose(live, old, 2) === live, true);
});

test("a headingless actor has a finite render heading even at the endpoint", () => {
  const live = { x: 0.01, y: 0, v: 2 };
  const old = { x: 11.5, y: 0, psi: 0.1 };
  const end = interpolatePose(live, old, 1);
  assert.equal(end.x, live.x);
  assert.equal(end.v, live.v);
  assert.equal(end.psi, 0);
  assert.equal(Object.hasOwn(live, "psi"), false);
});

test("render interpolation ignores a corrupt saved heading before subtracting it", () => {
  const live = { x: 4, y: 4, psi: 0.1 };
  const old = { x: 3, y: 4, psi: Infinity };
  assert.equal(interpolatePose(live, old, 0.5) === live, true);
});

test("a 12 m translation still interpolates, and a longer translation snaps", () => {
  const old = { x: 0, y: 0, psi: 0 };
  const live = { x: 12, y: 0, psi: 0 };
  assert.equal(interpolatePose(live, old, 0.5).x, 6);
  live.x = 12.0001;
  assert.equal(interpolatePose(live, old, 0.5) === live, true);
});

test("a quarter-turn interpolates at the angular reset threshold", () => {
  const old = { x: 0, y: 0, psi: 0 };
  const live = { x: 1, y: 0, psi: Math.PI / 2 };
  assert.equal(interpolatePose(live, old, 0.5).psi, Math.PI / 4);
});

test("interpolation uses the short arc when headings cross the negative wrap", () => {
  const old = { x: 0, y: 0, psi: -Math.PI + 0.1 };
  const live = { x: 1, y: 0, psi: Math.PI - 0.1 };
  assert.ok(Math.abs(interpolatePose(live, old, 0.5).psi + Math.PI) < 1e-9);
});

test("capturing into an existing render sample does not leak unrelated current state", () => {
  const live = { x: 1, y: 2, psi: 0.1, v: 8, label: "actor" };
  const old = { x: 3, y: 4, psi: 0 };
  assert.equal(capturePose(live, old) === old, true);
  assert.equal(Object.hasOwn(old, "v"), false);
  assert.equal(Object.hasOwn(old, "label"), false);
});

test("corrupt replay clock fields recover without propagating non-finite elapsed time", () => {
  const clock = new WorldClock();
  Object.assign(clock, { hour: Infinity, weekday: 9, rate: NaN, lastTime: -1 });
  assert.equal(clock.update(20), TIME_PRESETS.afternoon);
  assert.equal(clock.weekday, 2);
  assert.equal(clock.rate, 0);
  assert.equal(clock.lastTime, 20);
});

test("invalid set-hour changes leave the local time at the elapsed sample", () => {
  const clock = new WorldClock(8, 60);
  clock.update(0);
  clock.setHour(NaN, 60);
  assert.equal(clock.hour, 9);
  assert.equal(clock.update(120), 10);
});

test("fractional minute rounding does not display midnight before the day changes", () => {
  assert.equal(formatClock(24 - 1e-10), "23:59");
  assert.equal(formatClock(24), "00:00");
});

test("restoring an earlier complete clock snapshot restores its corresponding elapsed anchor", () => {
  const clock = new WorldClock(23.5, 60, 3);
  clock.update(0);
  const frame = { ...clock };
  clock.update(120);
  Object.assign(clock, frame);
  assert.equal(clock.update(60), 0.5);
  assert.equal(clock.weekday, 4);
});

test("time parsing supports decimal exponents without treating radix notation as a clock value", () => {
  assert.equal(parseHour("7.5e0"), 7.5);
  assert.equal(parseHour("0x10", 4), 4);
});

test("weather query names accept case and surrounding whitespace", () => {
  try {
    assert.equal(setWeather("  RAIN ").name, "rain");
    assert.equal(current.mu, WEATHER.rain.mu);
  } finally {
    setWeather("dry");
  }
});

test("the active weather view has stable identity and fields protected against ad-hoc edits", () => {
  try {
    const profile = setWeather("snow");
    assert.equal(Object.isFrozen(profile), true);
    assert.throws(() => {
      profile.visibility = 500;
    }, TypeError);
    assert.equal(setWeather("fog") === profile, true);
    assert.equal(profile.visibility, WEATHER.fog.visibility);
    assert.equal(profile.description, WEATHER.fog.description);
  } finally {
    setWeather("dry");
  }
});

test("capture replaces an unusable destination and never overwrites a source aliased as its destination", () => {
  const live = { x: 3, y: 4 };
  assert.equal(capturePose(live, null).x, 3);
  assert.equal(capturePose(live, "frame").y, 4);
  assert.equal(capturePose(live, live) === live, false);
  assert.equal(Object.hasOwn(live, "psi"), false);
});

test("capturing corrupt axis values marks that history sample unavailable without coercion", () => {
  const old = capturePose({ x: "3", y: Infinity });
  assert.equal(old.x, NaN);
  assert.equal(old.y, NaN);
  assert.equal(old.psi, 0);
  assert.equal(capturePose(null).x, NaN);
});

test("interpolation handles an absent next actor and preserves the exact previous endpoint at alpha zero", () => {
  const previous = { x: -0, y: -0, psi: -0 };
  const live = { x: 4, y: 3, psi: 0.1, v: 5 };
  assert.equal(interpolatePose(null, previous, 0.5), null);
  const start = interpolatePose(live, previous, 0);
  assert.equal(start.x, -0);
  assert.equal(start.y, -0);
  assert.equal(start.psi, -0);
  assert.equal(start.v, 5);
});

test("teleport discontinuity snaps the current actor even when rendering the start of the interval", () => {
  const previous = { x: 0, y: 0, psi: 0 };
  const live = { x: 40, y: 0, psi: 0 };
  assert.equal(interpolatePose(live, previous, 0) === live, true);
});

test("the clock can advance over complete weeks without changing weekday", () => {
  const clock = new WorldClock(12, 1, 5);
  clock.update(0);
  clock.update((14 * 24 + 3) * 3600);
  assert.equal(clock.hour, 15);
  assert.equal(clock.weekday, 5);
});

test("render capture can replace an invalid sample as soon as the source recovers", () => {
  const live = { x: NaN, y: 4, psi: NaN };
  const sample = capturePose(live);
  live.x = 2;
  live.psi = 0.3;
  capturePose(live, sample);
  assert.equal(sample.x, 2);
  assert.equal(sample.psi, 0.3);
  live.x = 3;
  assert.equal(sample.x, 2);
});

test("the dry weather default and the ambient grip use the same reference coefficient", () => {
  assert.equal(setWeather("dry").mu, WEATHER.dry.mu);
  assert.equal(ROAD.mu, WEATHER.dry.mu);
});
