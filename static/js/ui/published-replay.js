import { h } from "../common.js";
import { replayPosition } from "../lab/playback.js";
import { interpolatePose } from "../sim/interpolate.js";

const SIZE = [1100, 600];
const SIGNALS = { red: "#ff7777", yellow: "#ffca66", green: "#80f2ad" };

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
  for (const { points, width } of replay.roads) {
    path(points);
    bg.lineWidth = width * scale;
    bg.stroke();
  }
  bg.strokeStyle = "#91d6c644";
  bg.lineWidth = 3;
  bg.setLineDash([9, 7]);
  path(replay.route);
  bg.stroke();
  const [goalX, goalY] = screen(...replay.route.at(-1));
  bg.fillStyle = "#90d8c7";
  bg.beginPath();
  bg.arc(goalX, goalY, 5, 0, 2 * Math.PI);
  bg.fill();

  function car(pose, colour) {
    const [x, y] = screen(pose.x, pose.y);
    const length = Math.max(19, 4.4 * scale),
      width = Math.max(10, 1.9 * scale);
    view.save();
    view.translate(x, y);
    view.rotate(-pose.psi);
    view.fillStyle = colour;
    view.beginPath();
    view.roundRect(-length / 2, -width / 2, length, width, 3);
    view.fill();
    view.fillStyle = "#273c4a";
    view.fillRect(1, -width / 2 + 2, 3, width - 4);
    view.restore();
  }

  return (frame, next, alpha) => {
    view.drawImage(landscape, 0, 0);
    replay.signals.forEach(([x, y], i) => {
      view.beginPath();
      view.arc(...screen(x, y), 6, 0, 2 * Math.PI);
      view.fillStyle = SIGNALS[frame.lights[i]] || "#81929a";
      view.fill();
      view.strokeStyle = "#172932";
      view.lineWidth = 2;
      view.stroke();
    });
    for (const [id, pose] of Object.entries(frame.traffic))
      car(interpolatePose(next?.traffic[id] || pose, pose, alpha), "#ededff");
    car(interpolatePose(next?.ego || frame.ego, frame.ego, alpha), "#83ebd0");
  };
}

const drives = [
  ["jev-right-on-red", "Jev · Right on red · Calgary", "right-on-red", "d068809918d0d0e7"],
  ["claude-haiku-flagger", "Claude Haiku · Flagger · Ottawa", "flagger", "a4599358446f908f"],
  ["jev-flagger", "Jev · Flagger · Ottawa", "flagger", "037cff94081ae1bc"],
  ["jev-unprotected-left", "Jev · The unprotected left · Ottawa", "unprotected-left", "6718f664d8f8681f"],
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
  ["flagger", ["ottawa", 56.15]],
  ["right-on-red", ["calgary", 65.667]],
  ["unprotected-left", ["ottawa", 28.817]],
]);

export function incidentDrive(config, incident) {
  const entry = incidentDrives.get(config.challenge);
  if (
    !entry ||
    config.version !== 1 ||
    config.pack !== "6" ||
    entry[0] !== config.map ||
    recordedMaps[config.map] !== config.map_sha ||
    incident.at_s > entry[1]
  )
    return null;
  return `jev-${config.challenge}`;
}

export async function loadPublishedDrive(id, signal) {
  const entry = drives.find(([candidate]) => candidate === id);
  if (!entry) throw new Error("Unknown published replay");
  const [, , challenge, resultSha] = entry;
  const response = await fetch(new URL(`../../replays/${id}.json`, import.meta.url), { signal });
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  const replay = await response.json();
  if (replay.format !== "jev-browser-replay/1" || !replay.choices || !(replay.frames?.length >= 2))
    throw new Error("Replay data is incomplete");
  if (replay.challenge !== challenge || replay.result_sha !== resultSha)
    throw new Error("Replay does not match the selected drive");
  return replay;
}

export function mountPublishedReplay(root) {
  const select = h(
    "select",
    { "aria-label": "Published drive" },
    ...drives.map(([value, title]) => h("option", { value }, title)),
  );
  const player = h("div");
  root.replaceChildren(select, player);
  let request;
  async function load() {
    request?.abort();
    request = new AbortController();
    const { signal } = request;
    player.replaceChildren(h("p", { role: "status" }, "Loading replay…"));
    try {
      const replay = await loadPublishedDrive(select.value, signal);
      if (signal.aborted) return;
      signal.addEventListener("abort", showDrive(player, replay).pause, { once: true });
    } catch (error) {
      if (!signal.aborted)
        player.replaceChildren(h("p", { role: "status" }, `Could not load the browser replay. ${error.message}.`));
    }
  }
  select.onchange = load;
  return load();
}

export function showDrive(root, replay, alignedTime) {
  const { frames } = replay,
    duration = frames.at(-1).t;
  const canvas = h("canvas", {
    width: SIZE[0],
    height: SIZE[1],
    role: "img",
    "aria-label": "Overhead street map of the recorded drive",
  });
  const draw = streetView(canvas, replay);
  const play = h("button", { class: "chip-button", type: "button" }, "Play replay");
  const scrub = h("input", {
    type: "range",
    min: 0,
    max: duration,
    step: 0.001,
    value: 0,
    "aria-label": "Replay time",
  });
  const readout = h("span", { class: "published-replay-readout" });
  const event = h("p", { class: "results-note", role: "status" });
  const choice = h("p", { class: "results-note" });
  let time = 0,
    startedAt = 0,
    animation = null;

  function render(at) {
    time = Math.max(0, Math.min(at, duration));
    const ended = time >= duration;
    const { index, alpha } = ended ? { index: frames.length - 1, alpha: 0 } : replayPosition(frames, 0, time);
    const frame = frames[index],
      next = frames[index + 1];
    draw(frame, next, alpha);
    scrub.value = time;
    scrub.setAttribute("aria-valuetext", `${time.toFixed(1)} of ${duration.toFixed(1)} seconds`);
    const speed = Math.round(frame.ego.speed + ((next?.ego.speed ?? frame.ego.speed) - frame.ego.speed) * alpha);
    readout.textContent = `${time.toFixed(1)} / ${duration.toFixed(1)} s · ${speed} km/h${frame.lights.length ? ` · Approach light ${frame.lights[0]}` : ""}`;
    const selected = replay.choices.findLast((c) => c.t <= time);
    choice.textContent = selected
      ? `Chosen: ${selected.id || selected.motion} · ${selected.motion}${selected.flag ? ` · Flagged: ${selected.flag}` : ""}`
      : "Awaiting first decision";
    const latest = replay.events.findLast((e) => e.t <= time)?.message;
    const message =
      latest === "Authored hazard triggered"
        ? triggerLabels[replay.challenge] || "Hazard begins"
        : latest || "Drive started";
    if (message !== event.textContent) event.textContent = message;
    return ended;
  }
  function pause() {
    if (animation !== null) cancelAnimationFrame(animation);
    animation = null;
    play.textContent = time >= duration ? "Play again" : "Play replay";
  }
  function advance(now) {
    if (render((now - startedAt) / 1000)) pause();
    else animation = requestAnimationFrame(advance);
  }
  play.onclick = () => {
    if (animation !== null) pause();
    else {
      if (time >= duration) render(0);
      startedAt = performance.now() - time * 1000;
      play.textContent = "Pause replay";
      animation = requestAnimationFrame(advance);
    }
  };
  scrub.oninput = () => {
    render(Number(scrub.value));
    pause();
  };

  root.replaceChildren(
    h("p", { class: "results-note" }, `${replay.model} · Open track · ${replay.pass ? "Pass" : "Fail"}`),
    canvas,
    h(
      "p",
      { class: "published-replay-legend results-note" },
      "Driven car in mint · Traffic in white · Dashed line for the planned route",
    ),
    alignedTime !== undefined ? readout : h("div", { class: "published-replay-controls" }, play, scrub, readout),
    choice,
    ...replay.choices
      .filter((c) => alignedTime === undefined && c.flag)
      .map((c) =>
        h(
          "button",
          {
            class: "chip-button",
            type: "button",
            onclick: () => {
              render(c.t);
              pause();
            },
          },
          `Flagged at ${c.t.toFixed(1)} s`,
        ),
      ),

    event,
  );
  render(alignedTime ?? 0);
  return { pause, render };
}
