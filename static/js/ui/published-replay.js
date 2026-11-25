import { copyText, h } from "../common.js";
import { REPORT_INCIDENT_TIME_TOLERANCE_S } from "../lab/playback.js";
import { interpolatePose } from "../sim/interpolate.js";

import { downloadJson } from "./export.js";
import { repositoryArtifact, suiteLabel } from "../lab/results.js";

const SIZE = [1100, 600];
const SIGNALS = { red: "#ff7777", yellow: "#ffca66", green: "#80f2ad" };

const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

function streetView(canvas, replay) {
  const [width, height] = SIZE;
  const [left, bottom, right, top] = replay.bounds;
  const scale = Math.min(width / (right - left), height / (top - bottom));
  const screen = (x, y) => [
    width / 2 + (x - (left + right) / 2) * scale,
    height / 2 - (y - (bottom + top) / 2) * scale,
  ];
  const landscape = document.createElement("canvas");
  [landscape.width, landscape.height] = SIZE;
  const bg = landscape.getContext("2d");
  const view = canvas.getContext("2d");
  if (!bg || !view) throw new Error("2D canvas is unavailable");
  const path = (points) => {
    bg.beginPath();
    points.forEach(([x, y], i) => (i === 0 ? bg.moveTo(...screen(x, y)) : bg.lineTo(...screen(x, y))));
  };

  bg.fillStyle = "#172932";
  bg.fillRect(0, 0, width, height);
  bg.fillStyle = "#263e46";
  for (const building of replay.buildings) {
    path(building);
    bg.fill();
  }
  bg.lineCap = "round";
  bg.lineJoin = "round";
  bg.strokeStyle = "#43545b";
  for (const { points, width: roadWidth } of replay.roads) {
    path(points);
    bg.lineWidth = roadWidth * scale;
    bg.stroke();
  }
  // On-canvas street labels when present on roads or replay.labels / replay.streets.
  const drawnLabels = new Set();
  const labelSources = [
    ...replay.roads
      .filter((r) => r.name && r.points?.length >= 2)
      .map((r) => {
        const mid = r.points[Math.floor(r.points.length / 2)];
        const prev = r.points[Math.max(0, Math.floor(r.points.length / 2) - 1)];
        const next = r.points[Math.min(r.points.length - 1, Math.floor(r.points.length / 2) + 1)];
        return { name: r.name, x: mid[0], y: mid[1], angle: Math.atan2(-(next[1] - prev[1]), next[0] - prev[0]) };
      }),
    ...(Array.isArray(replay.streets) ? replay.streets : []),
    ...(Array.isArray(replay.labels) ? replay.labels : []),
  ];
  if (labelSources.length) {
    bg.save();
    bg.font = "600 13px system-ui, sans-serif";
    bg.textAlign = "center";
    bg.textBaseline = "middle";
    for (const item of labelSources) {
      const name = item?.name || item?.label;
      if (!name || drawnLabels.has(name) || !Number.isFinite(item.x) || !Number.isFinite(item.y)) continue;
      drawnLabels.add(name);
      const [lx, ly] = screen(item.x, item.y);
      let angle = Number.isFinite(item.angle) ? item.angle : 0;
      if (angle > Math.PI / 2) angle -= Math.PI;
      if (angle < -Math.PI / 2) angle += Math.PI;
      bg.save();
      bg.translate(lx, ly);
      bg.rotate(angle);
      bg.lineWidth = 3;
      bg.strokeStyle = "rgba(23, 41, 50, 0.85)";
      bg.strokeText(name, 0, 0);
      bg.fillStyle = "#c8dde3";
      bg.fillText(name, 0, 0);
      bg.restore();
    }
    bg.restore();
  }
  bg.strokeStyle = "#91d6c644";
  bg.lineWidth = 3;
  bg.setLineDash([9, 7]);
  path(replay.route);
  bg.stroke();
  bg.setLineDash([]);
  const [goalX, goalY] = screen(...replay.route.at(-1));
  bg.fillStyle = "#90d8c7";
  bg.beginPath();
  bg.arc(goalX, goalY, 5, 0, 2 * Math.PI);
  bg.fill();

  function car(pose, colour, cues = null) {
    const [x, y] = screen(pose.x, pose.y);
    const length = Math.max(19, 4.4 * scale),
      carWidth = Math.max(10, 1.9 * scale);
    view.save();
    view.translate(x, y);
    view.rotate(-pose.psi);
    view.fillStyle = colour;
    view.beginPath();
    if (view.roundRect) view.roundRect(-length / 2, -carWidth / 2, length, carWidth, 3);
    else view.rect(-length / 2, -carWidth / 2, length, carWidth);
    view.fill();
    view.fillStyle = "#273c4a";
    view.fillRect(1, -carWidth / 2 + 2, 3, carWidth - 4);
    if (cues?.braking) {
      view.fillStyle = "#ff4545";
      view.fillRect(-length / 2 - 1, -carWidth / 2 + 1, 3, 3);
      view.fillRect(-length / 2 - 1, carWidth / 2 - 4, 3, 3);
    }
    if (cues?.signal && cues.blink) {
      const sy = cues.signal === "left" ? -carWidth / 2 - 1 : carWidth / 2 - 2;
      view.fillStyle = "#ffb833";
      view.beginPath();
      view.arc(length / 2 - 2, sy + 1.5, 2.5, 0, Math.PI * 2);
      view.arc(-length / 2 + 2, sy + 1.5, 2.5, 0, Math.PI * 2);
      view.fill();
    }
    view.restore();
  }

  return (frame, next, alpha, cues = null) => {
    view.drawImage(landscape, 0, 0);
    replay.signals.forEach(([x, y], i) => {
      view.beginPath();
      view.arc(...screen(x, y), 6, 0, 2 * Math.PI);
      view.fillStyle = Object.hasOwn(SIGNALS, frame.lights[i]) ? SIGNALS[frame.lights[i]] : "#81929a";
      view.fill();
      view.strokeStyle = "#172932";
      view.lineWidth = 2;
      view.stroke();
    });
    for (const [id, pose] of Object.entries(frame.traffic))
      car(interpolatePose(next?.traffic[id] || pose, pose, alpha), "#ededff");
    car(interpolatePose(next?.ego || frame.ego, frame.ego, alpha), "#83ebd0", cues);
  };
}

function speedChart(canvas, frames, duration, flaggedTimes) {
  const chart = document.createElement("canvas");
  const w = (chart.width = canvas.width);
  const ht = (chart.height = canvas.height);
  const ctx = chart.getContext("2d");
  const view = canvas.getContext("2d");
  if (!ctx || !view) return null;
  const peakSpeed = frames.reduce((max, f) => Math.max(max, Math.abs(f.ego.speed)), 0);
  const maxSpeed = Math.max(20, peakSpeed);
  const padX = 6,
    padY = 6;
  const xFor = (t) => padX + (t / duration) * (w - padX * 2);
  const yFor = (spd) => ht - padY - (Math.abs(spd) / maxSpeed) * (ht - padY * 2);

  // Subtle horizontal reference grid
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padX, yFor(maxSpeed / 2));
  ctx.lineTo(w - padX, yFor(maxSpeed / 2));
  ctx.stroke();

  // Flagged choice bands
  if (flaggedTimes.length) {
    ctx.strokeStyle = "rgba(255, 119, 119, 0.45)";
    for (const ft of flaggedTimes) {
      const fx = xFor(ft);
      ctx.beginPath();
      ctx.moveTo(fx, 2);
      ctx.lineTo(fx, ht - 2);
      ctx.stroke();
    }
  }

  // Speed curve
  ctx.strokeStyle = "#83d9c4";
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  frames.forEach((f, i) => {
    const x = xFor(f.t),
      y = yFor(f.ego.speed || 0);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  ctx.fillStyle = "#8da3b1";
  ctx.font = "10px ui-monospace, monospace";
  ctx.fillText(`Peak ${Math.round(peakSpeed)} km/h`, padX + 2, 12);

  return {
    draw(time) {
      view.clearRect(0, 0, w, ht);
      view.drawImage(chart, 0, 0);
      const x = xFor(time);
      view.strokeStyle = "#ffffff";
      view.lineWidth = 1.5;
      view.beginPath();
      view.moveTo(x, 2);
      view.lineTo(x, ht - 2);
      view.stroke();
    },
    timeAt(fraction) {
      return clampReplayTime(((fraction * w - padX) / (w - 2 * padX)) * duration, duration);
    },
  };
}

const drives = [
  ["jev-right-on-red", "Jev · Right on red · Calgary", "right-on-red", "d068809918d0d0e7", "jev-latest"],
  ["claude-haiku-flagger", "Claude Haiku · Flagger · Ottawa", "flagger", "a4599358446f908f", "claude-haiku-5-5"],
  ["jev-flagger", "Jev · Flagger · Ottawa", "flagger", "037cff94081ae1bc", "jev-latest"],
  ["jev-unprotected-left", "Jev · The unprotected left · Ottawa", "unprotected-left", "6718f664d8f8681f", "jev-latest"],
];
const triggerLabels = {
  "right-on-red": "Cross traffic released",
  flagger: "Oncoming traffic enters the work zone",
  "unprotected-left": "Oncoming traffic released",
};

// Jev open-track exports. The map, versions and end time describe the recorded
// run, independent of the version of the currently installed challenge.
const recordedMaps = { ottawa: "c18b8436019517f5", calgary: "d8c3b4c3921cb359" };
const incidentDrives = new Map([
  ["flagger", { map: "ottawa", seed: 22042, end: 56.15 }],
  ["right-on-red", { map: "calgary", seed: 8042, end: 65.667 }],
  ["unprotected-left", { map: "ottawa", seed: 7042, end: 28.817 }],
]);

export function incidentDrive(config, incident) {
  const entry = incidentDrives.get(config?.challenge);
  if (
    !entry ||
    config.version !== 1 ||
    config.pack !== "6" ||
    entry.seed !== config.seed ||
    config.weather !== "dry" ||
    config.time !== "afternoon" ||
    entry.map !== config.map ||
    recordedMaps[config.map] !== config.map_sha ||
    !Number.isFinite(incident?.at_s) ||
    incident.at_s < 0 ||
    incident.at_s > entry.end + REPORT_INCIDENT_TIME_TOLERANCE_S
  )
    return null;
  return `jev-${config.challenge}`;
}

const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value) => typeof value === "string" && value.trim().length > 0;
const points = (values, minimum = 0) =>
  Array.isArray(values) &&
  values.length >= minimum &&
  values.every((xy) => Array.isArray(xy) && xy.length === 2 && xy.every(Number.isFinite));
const pose = (value) => record(value) && [value.x, value.y, value.psi].every(Number.isFinite);

export function validatePublishedReplay(replay) {
  const require = (valid, field) => {
    if (!valid) throw new Error(`Replay data is incomplete or invalid (${field})`);
  };
  require(replay?.format === "jev-browser-replay/1", "format");
  const { bounds, route, roads, buildings, signals, frames, choices, events } = replay;
  require(text(replay.model), "recorded model");
  require(typeof replay.pass === "boolean", "verdict");
  require(replay.source == null || repositoryArtifact(replay.source), "recording path");
  require(Array.isArray(bounds) && bounds.length === 4 && bounds.every(Number.isFinite), "map bounds");
  const dx = bounds[2] - bounds[0],
    dy = bounds[3] - bounds[1];
  require(Number.isFinite(dx) && dx > 0 && Number.isFinite(dy) && dy > 0, "map dimensions");
  require(points(route, 2), "route");
  require(Array.isArray(roads) && roads.every((road) => points(road?.points, 2)), "road geometry");
  require(roads.every((road) => Number.isFinite(road.width) && road.width > 0), "road widths");
  require(Array.isArray(buildings) && buildings.every((building) => points(building, 3)), "building geometry");
  require(points(signals), "signal locations");
  require(Array.isArray(frames) && frames.length >= 2, "frame count");
  require(frames[0]?.t === 0, "first frame time");
  for (const [i, frame] of frames.entries()) {
    require(Number.isFinite(frame?.t) && (!i || frame.t > frames[i - 1].t), `frame ${i + 1} time`);
    require(pose(frame.ego), `frame ${i + 1} driven vehicle`);
    require(Number.isFinite(frame.ego.speed), `frame ${i + 1} speed`);
    require(record(frame.traffic) && Object.values(frame.traffic).every(pose), `frame ${i + 1} traffic`);
    require(Array.isArray(frame.lights) &&
      frame.lights.length === signals.length &&
      frame.lights.every(text), `frame ${i + 1} lights`);
  }
  // Events can be rounded independently of the last frame.
  const end = frames.at(-1).t + REPORT_INCIDENT_TIME_TOLERANCE_S;
  const validTimes = (items) =>
    Array.isArray(items) &&
    items.every(
      (item, i) => Number.isFinite(item?.t) && item.t >= 0 && item.t <= end && (!i || item.t >= items[i - 1].t),
    );
  require(validTimes(choices), "decision times");
  require(choices.every((choice) => ["drive", "stop", "reverse"].includes(choice.motion)), "decision motion");
  require(choices.every((choice) => choice.id == null || text(choice.id)), "manoeuvre ID");
  require(choices.every((choice) => choice.flag == null || text(choice.flag)), "flag reason");
  require(validTimes(events), "event times");
  require(events.every((event) => text(event.message)), "event message");
  return replay;
}

const clampReplayTime = (value, duration) => (Number.isFinite(value) ? Math.max(0, Math.min(value, duration)) : 0);

// Latest item at or before the cursor, with the last of any same-time events.
export function replayIndex(items, time) {
  let low = 0,
    high = items.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (items[mid].t <= time) low = mid + 1;
    else high = mid;
  }
  return low - 1;
}

export function replayMoment(items, time, direction, wrap = false) {
  if (direction < 0) return items.findLast((item) => item.t < time)?.t ?? (wrap ? items.at(-1)?.t : null) ?? null;
  return items[replayIndex(items, time) + 1]?.t ?? (wrap ? items[0]?.t : null) ?? null;
}

export function replaySelection(url) {
  const id = url.searchParams.get("replay");
  const time = url.searchParams.get("at");
  const valid = drives.some(([value]) => value === id);
  return {
    id: valid ? id : drives[0][0],
    time: valid && /^(?:\d+(?:\.\d+)?)$/.test(time ?? "") && Number.isFinite(Number(time)) ? Number(time) : 0,
  };
}

export async function loadPublishedDrive(id, signal) {
  const entry = drives.find(([candidate]) => candidate === id);
  if (!entry) throw new Error("Unknown published replay");
  const [, , challenge, resultSha, model] = entry;
  const response = await fetch(new URL(`../../replays/${id}.json`, import.meta.url), { signal });
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  const replay = validatePublishedReplay(
    await response.json().catch((error) => {
      if (signal?.aborted) throw error;
      throw new Error("Replay response is not valid JSON", { cause: error });
    }),
  );
  signal?.throwIfAborted();
  if (replay.challenge !== challenge || replay.result_sha !== resultSha || replay.model !== model)
    throw new Error("Replay does not match the selected drive");
  return replay;
}

export function mountPublishedReplay(root) {
  if (!root) return;
  const current = () => replaySelection(new URL(location.href));
  const select = h(
    "select",
    { "aria-label": "Published drive" },
    ...drives.map(([value, title]) => h("option", { value }, title)),
  );
  const player = h("div");
  const actions = h("div", { class: "published-replay-bar" });
  const toolbar = h("div", { class: "published-replay-bar" }, select, actions);
  root.replaceChildren(toolbar, player);
  let request;
  async function load(time = 0, focus = false) {
    request?.abort();
    request = new AbortController();
    const { signal } = request;
    const id = select.value;
    actions.replaceChildren();
    player.setAttribute("aria-busy", "true");
    player.replaceChildren(h("p", { role: "status" }, "Loading replay…"));
    try {
      const replay = await loadPublishedDrive(id, signal);
      if (signal.aborted || !root.isConnected) return;
      const controls = showDrive(player, replay, undefined, time);
      signal.addEventListener("abort", controls.pause, { once: true });
      const fallback = h("textarea", { readonly: true, hidden: true, "aria-label": "Link to replay moment" });
      const feedback = h("span", { "aria-live": "polite" });
      actions.append(
        h(
          "button",
          {
            type: "button",
            class: "chip-button",
            onclick: async () => {
              const url = new URL(location.href);
              url.hash = "replay-heading";
              url.searchParams.set("replay", id);
              url.searchParams.set("at", controls.time().toFixed(3));
              const copied = await copyText(url.href);
              if (signal.aborted) return;
              fallback.hidden = copied;
              feedback.textContent = copied ? "Replay link copied." : "Copy the selected link.";
              if (!copied) {
                fallback.value = url.href;
                fallback.select();
                fallback.focus();
              }
            },
          },
          "Copy link to this moment",
        ),
        h(
          "button",
          { type: "button", class: "chip-button", onclick: () => downloadJson(`${id}-replay.json`, replay) },
          "Download replay JSON",
        ),
        fallback,
        feedback,
      );
      if (focus && document.activeElement === document.body) controls.focus();
    } catch (error) {
      if (!signal.aborted) {
        const retry = h(
          "button",
          { type: "button", class: "chip-button", onclick: () => load(time, true) },
          "Retry replay",
        );
        player.replaceChildren(
          h("p", { role: "status" }, `Could not load the browser replay. ${error.message}.`),
          retry,
        );
        if (focus && document.activeElement === document.body) retry.focus();
      }
    } finally {
      if (!signal.aborted) player.removeAttribute("aria-busy");
    }
  }
  select.onchange = () => {
    const url = new URL(location.href);
    url.searchParams.set("replay", select.value);
    url.searchParams.delete("at");
    history.replaceState(history.state, "", url);
    load();
  };
  const fromUrl = () => {
    const { id, time } = current();
    select.value = id;
    return load(time);
  };
  window.addEventListener("popstate", fromUrl);
  return fromUrl();
}

export function showDrive(root, replay, alignedTime, initialTime = 0) {
  const { frames } = replay,
    duration = frames.at(-1).t,
    interactive = alignedTime === undefined;
  const flaggedChoices = replay.choices.filter((c) => c.flag);
  const flaggedTimes = flaggedChoices.map((c) => c.t);

  const canvas = h("canvas", {
    class: "published-replay-stage",
    width: SIZE[0],
    height: SIZE[1],
    role: "img",
    "aria-label": "Overhead street map of the recorded drive",
  });
  const draw = streetView(canvas, replay);
  const play = h("button", { class: "chip-button", type: "button", disabled: duration <= 0 }, "Play replay");
  const scrub = h("input", {
    type: "range",
    min: 0,
    max: duration,
    step: 0.001,
    value: 0,
    "aria-label": "Replay time",
  });
  const speedSelect = h(
    "select",
    { "aria-label": "Playback speed" },
    h("option", { value: "0.25" }, "0.25×"),
    h("option", { value: "0.5" }, "0.5×"),
    h("option", { value: "1", selected: true }, "1×"),
    h("option", { value: "1.5" }, "1.5×"),
    h("option", { value: "2" }, "2×"),
  );
  const readout = h("span", { class: "published-replay-readout" });
  const event = h("p", { class: "results-note", role: "status" });
  const choice = h("p", { class: "results-note" });
  const sparkline = interactive
    ? h("canvas", {
        class: "published-replay-sparkline",
        width: 720,
        height: 48,
        role: "img",
        "aria-label": "Ego vehicle speed over time",
        title: "Click to seek along speed chart",
      })
    : null;
  const chart = sparkline ? speedChart(sparkline, frames, duration, flaggedTimes) : null;
  let time = 0,
    speedRate = 1,
    startedAt = 0,
    animation = null,
    activeChoiceIndex = -1;

  const logItems = interactive
    ? replay.choices.map((c, idx) => {
        const li = h(
          "li",
          { class: c.flag ? "flagged" : "" },
          h(
            "button",
            {
              type: "button",
              onclick: () => {
                seek(c.t);
              },
            },
            h("span", { class: "log-time" }, `${c.t.toFixed(1)}s`),
            h("span", {}, `${c.id || c.motion} · ${c.motion}`),
            c.flag ? h("span", { class: "log-flag" }, c.flag) : null,
          ),
        );
        li.dataset.index = String(idx);
        return li;
      })
    : [];
  const logList = interactive && logItems.length ? h("ol", { class: "published-replay-log" }, ...logItems) : null;

  function egoCues(index, selected) {
    const frame = frames[index];
    const prev = frames[Math.max(0, index - 1)];
    const dt = Math.max(0.05, frame.t - prev.t);
    const decelKmhPerS = (prev.ego.speed - frame.ego.speed) / dt;
    const braking =
      decelKmhPerS > 5 || selected?.id === "hard_brake" || (selected?.motion === "stop" && frame.ego.speed > 0.5);
    let signal = frame.ego.signal || null;
    if (!signal) {
      const look = frames[Math.max(index, replayIndex(frames, frame.t + 1.5))];
      const dPsi = wrapAngle((look?.ego.psi ?? frame.ego.psi) - frame.ego.psi);
      if (dPsi > 0.28 || /left/.test(selected?.id || "")) signal = "left";
      else if (dPsi < -0.28 || /right/.test(selected?.id || "")) signal = "right";
    }
    return { braking, signal, blink: time % 0.8 < 0.45 };
  }

  function render(at) {
    time = clampReplayTime(at, duration);
    const ended = time >= duration;
    const index = replayIndex(frames, time);
    const frame = frames[index],
      next = frames[index + 1];
    const alpha = next ? (time - frame.t) / (next.t - frame.t) : 0;
    const selectedIndex = replayIndex(replay.choices, time);
    const selected = selectedIndex >= 0 ? replay.choices[selectedIndex] : null;
    draw(frame, next, alpha, egoCues(index, selected));
    scrub.value = time;
    scrub.setAttribute("aria-valuetext", `${time.toFixed(1)} of ${duration.toFixed(1)} seconds`);
    const speed = Math.round(frame.ego.speed + ((next?.ego.speed ?? frame.ego.speed) - frame.ego.speed) * alpha);
    readout.textContent = `${time.toFixed(1)} / ${duration.toFixed(1)} s · ${Math.abs(speed)} km/h${speed < 0 ? " reversing" : ""}${frame.lights.length ? ` · Approach light ${frame.lights[0]}` : ""}`;
    choice.textContent = selected
      ? `Chosen: ${selected.id || selected.motion} · ${selected.motion}${selected.flag ? ` · Flagged: ${selected.flag}` : ""}`
      : "Awaiting first decision";
    const latest =
      replay.events[replayIndex(replay.events, ended ? duration + REPORT_INCIDENT_TIME_TOLERANCE_S : time)]?.message;
    const message =
      latest === "Authored hazard triggered"
        ? triggerLabels[replay.challenge] || "Hazard begins"
        : latest || "Drive started";
    if (message !== event.textContent) event.textContent = message;
    chart?.draw(time);
    if (logList && selectedIndex !== activeChoiceIndex) {
      if (activeChoiceIndex >= 0 && logItems[activeChoiceIndex]) {
        logItems[activeChoiceIndex].classList.remove("active");
        logItems[activeChoiceIndex].firstElementChild.removeAttribute("aria-current");
      }
      activeChoiceIndex = selectedIndex;
      if (activeChoiceIndex >= 0 && logItems[activeChoiceIndex]) {
        const li = logItems[activeChoiceIndex];
        li.classList.add("active");
        li.firstElementChild.setAttribute("aria-current", "step");
        const item = li.getBoundingClientRect();
        const sheet = logList.getBoundingClientRect();
        if (!logList.contains(document.activeElement) && (item.top < sheet.top || item.bottom > sheet.bottom))
          logList.scrollTop += item.top - sheet.top - (logList.clientHeight - item.height) / 2;
      }
    }
    return ended;
  }
  function pauseOnHide() {
    if (document.hidden) pause();
  }
  function pause() {
    document.removeEventListener("visibilitychange", pauseOnHide);
    if (animation !== null) cancelAnimationFrame(animation);
    animation = null;
    play.textContent = time >= duration ? "Play again" : "Play replay";
  }
  function advance(now) {
    if (!root.contains(canvas) || !root.isConnected || document.hidden) pause();
    else if (render(((now - startedAt) / 1000) * speedRate)) pause();
    else animation = requestAnimationFrame(advance);
  }
  function togglePlay() {
    if (animation !== null) pause();
    else {
      if (time >= duration) render(0);
      startedAt = performance.now() - (time * 1000) / speedRate;
      play.textContent = "Pause replay";
      document.addEventListener("visibilitychange", pauseOnHide);
      animation = requestAnimationFrame(advance);
    }
  }
  function stepTime(delta) {
    seek(time + delta);
  }
  function seek(to) {
    if (to === null) return;
    render(to);
    pause();
  }
  const stepDecision = (dir) => seek(replayMoment(replay.choices, time, dir));
  const stepFlag = (dir) => seek(replayMoment(flaggedChoices, time, dir, true));
  const stepEvent = (dir) => seek(replayMoment(replay.events, time, dir));

  play.onclick = togglePlay;
  speedSelect.onchange = () => {
    speedRate = Number(speedSelect.value) || 1;
    if (animation !== null) startedAt = performance.now() - (time * 1000) / speedRate;
  };
  scrub.oninput = () => {
    seek(Number(scrub.value));
  };
  if (chart) {
    sparkline.addEventListener("click", (ev) => {
      const rect = sparkline.getBoundingClientRect();
      const frac = Math.max(0, Math.min(1, (ev.clientX - rect.left) / Math.max(1, rect.width)));
      seek(chart.timeAt(frac));
    });
  }

  const markerButtons = interactive
    ? [
        ...replay.events.map((e) => {
          const isHazard = e.message === "Authored hazard triggered";
          const label = isHazard ? triggerLabels[replay.challenge] || "Hazard begins" : e.message;
          return h("button", {
            type: "button",
            class: `published-replay-marker${isHazard ? " marker-hazard" : ""}`,
            style: { left: `${duration > 0 ? (clampReplayTime(e.t, duration) / duration) * 100 : 0}%` },
            title: `${e.t.toFixed(1)} s · ${label}`,
            "aria-label": `Jump to ${label} at ${e.t.toFixed(1)} seconds`,
            onclick: () => seek(e.t),
          });
        }),
        ...flaggedChoices.map((c) =>
          h("button", {
            type: "button",
            class: "published-replay-marker marker-flag",
            style: { left: `${duration > 0 ? (clampReplayTime(c.t, duration) / duration) * 100 : 0}%` },
            title: `${c.t.toFixed(1)} s · Flagged: ${c.flag}`,
            "aria-label": `Jump to flagged choice at ${c.t.toFixed(1)} seconds`,
            onclick: () => seek(c.t),
          }),
        ),
      ]
    : [];

  const controls = interactive
    ? h(
        "div",
        { class: "published-replay-controls" },
        h(
          "div",
          { class: "published-replay-bar" },
          play,
          speedSelect,
          h("button", { class: "chip-button", type: "button", onclick: () => seek(0) }, "Start"),
          h("button", { class: "chip-button", type: "button", onclick: () => seek(duration) }, "End"),
          h("button", { class: "chip-button", type: "button", onclick: () => stepTime(-1) }, "−1 s"),
          h("button", { class: "chip-button", type: "button", onclick: () => stepTime(1) }, "+1 s"),
          h(
            "button",
            { class: "chip-button", type: "button", onclick: () => stepDecision(-1), disabled: !replay.choices.length },
            "Prev decision",
          ),
          h(
            "button",
            { class: "chip-button", type: "button", onclick: () => stepDecision(1), disabled: !replay.choices.length },
            "Next decision",
          ),
          h(
            "button",
            { class: "chip-button", type: "button", onclick: () => stepEvent(-1), disabled: !replay.events.length },
            "Prev event",
          ),
          h(
            "button",
            { class: "chip-button", type: "button", onclick: () => stepEvent(1), disabled: !replay.events.length },
            "Next event",
          ),
          h(
            "button",
            {
              class: "chip-button",
              type: "button",
              disabled: !flaggedChoices.length,
              onclick: () => stepFlag(-1),
            },
            "Prev flag",
          ),
          h(
            "button",
            {
              class: "chip-button",
              type: "button",
              disabled: !flaggedChoices.length,
              onclick: () => stepFlag(1),
            },
            "Next flag",
          ),
        ),
        h(
          "div",
          { class: "published-replay-track" },
          scrub,
          markerButtons.length ? h("div", { class: "published-replay-markers" }, ...markerButtons) : null,
        ),
        readout,
      )
    : readout;

  const wrapper = h(
    "div",
    {
      class: "published-replay-player",
      tabindex: interactive ? "0" : null,
      onkeydown: interactive
        ? (ev) => {
            if (
              ev.altKey ||
              ev.ctrlKey ||
              ev.metaKey ||
              ev.defaultPrevented ||
              ev.target?.matches?.("select, input, textarea")
            )
              return;
            if (ev.key === " " && ev.target?.tagName !== "BUTTON") {
              ev.preventDefault();
              togglePlay();
            } else if (ev.key === "ArrowLeft") {
              ev.preventDefault();
              stepTime(ev.shiftKey ? -5 : -1);
            } else if (ev.key === "ArrowRight") {
              ev.preventDefault();
              stepTime(ev.shiftKey ? 5 : 1);
            } else if (ev.target === wrapper && (ev.key === "Home" || ev.key === "End")) {
              ev.preventDefault();
              seek(ev.key === "Home" ? 0 : duration);
            }
          }
        : null,
    },
    h(
      "p",
      { class: "results-note" },
      `${replay.model} · Open track · ${replay.pass ? "Pass" : "Fail"}${replay.suite_version ? ` · ${suiteLabel(replay.suite_version)}` : ""}`,
    ),
    interactive
      ? h(
          "p",
          { class: "results-note" },
          `${flaggedChoices.length} flagged choices in ${replay.choices.length} logged decisions`,
        )
      : null,
    canvas,
    h(
      "p",
      { class: "published-replay-legend results-note" },
      "Driven car in mint (red tail = braking, amber = signal) · Traffic in white · Dashed line for the planned route",
    ),
    controls,
    chart ? sparkline : null,
    choice,
    event,
    logList,
  );

  root.replaceChildren(wrapper);
  render(alignedTime ?? initialTime);
  pause();
  return { pause, render, time: () => time, focus: () => play.focus() };
}
