import { nightFlashNotice } from "./sim/night-flash.js";
// Bootstrap: load the map, build the scene, wire the UI, run the loop.

import { api, $, h } from "./common.js";
import { MapData } from "./map/mapdata.js";
import { Route } from "./map/route.js";
import { World } from "./sim/world.js";
import { actorTime } from "./render/actor-motion.js";
import { SceneView } from "./render/scene.js";
import { mountActorViews, mountFeatureViews, mountTransitScenery, replayActorPose } from "./render/feature-views.js";
import { announceFeatureNotices, featureEventBadge, featureRouteOptions } from "./sim/features/index.js";
import { buildRoads, buildScrambleMarkings } from "./render/roads.js";
import { buildBuildings } from "./render/buildings.js";
import { buildTrees } from "./render/trees.js";
import { busYield, isBus } from "./sim/bus.js";
import { crossingNotice } from "./sim/rail.js";
import { boxNotice } from "./sim/junction-box.js";
import {
  IN_LANE_M as STREETCAR_IN_LANE_M,
  SIDE_M as STREETCAR_SIDE_M,
  doorsOpen,
  streetcarRelation,
} from "./sim/streetcar.js";
import { laneClosureNotice } from "./sim/lane-closure.js";
import { plowNotice } from "./sim/snow-plow.js";
import { parkNotice, spacesAlong, frameOf, parkedPose } from "./sim/parallel-park.js";
import { hazardNotice } from "./sim/hidden-hazards.js";
import { trafficNotice } from "./sim/hidden-traffic.js";
import { cyclistNotice } from "./sim/cyclist-pass.js";
import { SIDE_M as SCHOOL_SIDE_M, redsOn, schoolBusRelation } from "./sim/school-bus.js";
import { ZONE_NAMES, mapClock } from "./sim/speed-zones.js";
import { frontTo, looked, stoppedAt } from "./sim/crosswalk.js";
import { isEmergency, nearestCall, EMERGENCY_NAMES } from "./sim/emergency.js";
import { addHeadlights, createCarMesh, syncCarLights } from "./render/cars.js";
import { Minimap } from "./render/minimap.js";
import { Overlays } from "./render/overlays.js";
import { Hud } from "./ui/hud.js";
import { Input } from "./ui/input.js";
import { GamepadInput } from "./ui/gamepad.js";
import { TouchControls, touchWanted } from "./ui/touch.js";
import { Panel } from "./ui/panel.js";
import { Autopilot } from "./brain/brain.js";
import { agentDefinitions, agentAvailable, pillarOf } from "./brain/registry.js";
import { registerLlmAgents, checkLlmEndpoints, llmSummary, defaultLlmId, llmBrainFor } from "./brain/llm.js";
import {
  registerDecisionAgents,
  checkDecisionEndpoints,
  decisionSummary,
  defaultDecisionId,
  decisionBrainFor,
} from "./brain/decision.js";
import { ModelSetup, ModelMenu, KINDS } from "./ui/model-setup.js";
import { NpcFleet } from "./sim/npc.js";
import { stepWorld } from "./sim/step.js";
import { setupScenario } from "./bench/runner.js";
import { DriveMetrics, decidedByCounts } from "./bench/metrics.js";
import { challengeScoreInputs } from "./lab/score-inputs.js";
import { WeatherView } from "./render/weather.js";
import { setWeather } from "./sim/weather.js";
import { advanceNotice, approachPhase, pedPhase } from "./sim/signals.js";
import { atmosphereFor, parseHour, TIME_PRESETS, lighting } from "./render/atmosphere.js";
import { buildSurroundings, tintSurroundings, inVancouver } from "./render/surroundings.js";
import { DriveScore, saveDrive } from "./sim/drive-score.js";
import { DriveReport } from "./ui/drive-report.js";
import { Explorer } from "./ui/explorer.js";
import { buildStreetSigns } from "./render/signs.js";
import { DriveAudio } from "./ui/drive-audio.js";
import { Cockpit } from "./ui/cockpit.js";
import { capturePose, interpolatePose } from "./sim/interpolate.js";
import { WorldClock, formatClock, worldOptions } from "./sim/world-clock.js";
import { freeDriveOptions } from "./sim/free-drive.js";
import { getVehicleModel, vehicleOptions, PAINT_COLORS } from "./sim/vehicle-models.js";
import { OrbitControls } from "./ui/orbit-controls.js";
import { bindMapPicker } from "./ui/map-picker.js";
import { preference } from "./ui/preferences.js";
import { describeClock } from "./ui/readouts.js";
import { readWatchReplay } from "./ui/replay-link.js";
import { RouteRequest } from "./ui/route-request.js";
import { PhotoMode } from "./ui/photo-mode.js";
import { challengeById, challengeConfig } from "./lab/challenges.js";
import { practiceEligible, savePractice } from "./lab/practice.js";
import { saveRoadTest } from "./lab/practice.js";
import { RoadTestObserver, examine } from "./lab/examiner.js";
import { ExaminerPrompt } from "./ui/road-test.js";
import { DriveRecorder } from "./lab/recorder.js";
import { reportIncidentTarget } from "./lab/playback.js";
import { DriveLab } from "./ui/lab.js";
import { PerceptionView } from "./render/perception.js";
import { setupChallenge } from "./lab/evaluation.js";
import { CITY_STYLES, buildCityIdentity } from "./render/city-identity.js";
import { buildSnapshot, drivenMetricSnapshot } from "./brain/sensors.js";
import { sampleCandidates, simulateAll } from "./brain/candidates.js";
import { mapFingerprint } from "./brain/recording.js";

const FIXED_DT = 1 / 60;
const loadingText = $("#loading-text");

export async function boot() {
  loadingText.textContent = "Checking simulator status…";
  let simulationError = null;
  let graphicsLost = false;
  const params = new URLSearchParams(location.search);
  const challenge = challengeById(params.get("challenge"));
  if (params.has("challenge") && !challenge)
    throw new Error("Unknown challenge. Open the drive lab to choose an available challenge.");
  if (challenge) for (const [key, value] of Object.entries(challengeConfig(challenge))) params.set(key, String(value));
  const replay = challenge ? null : readWatchReplay(params);
  const garage = vehicleOptions(replay ? new URLSearchParams() : params);
  const mapQuery = challenge?.map || params.get("bbox") || params.get("map") || replay?.bbox?.join(",") || "";
  const query = mapQuery ? `?bbox=${encodeURIComponent(mapQuery)}` : "";
  const status = await api(`/api/status${query}`);
  if (!Array.isArray(status?.map?.bbox)) throw new Error("The simulator returned incomplete map settings.");
  loadingText.textContent = "Loading streets and traffic controls…";
  // The three pillars: Rules, decision models (Jev plus decision:<name>) and LLMs (llm:<name>).
  registerDecisionAgents(status.decision, { demo: !!status.demo });
  registerLlmAgents(status.llm);
  const options = worldOptions(params, status.npcs);
  const pack = await api(`/api/map${query}`);
  if (!Array.isArray(pack?.edges) || !pack.edges.length) throw new Error("The map contains no drivable streets.");
  loadingText.textContent = `Building ${pack.edges.length} road segments…`;
  const map = new MapData(pack);
  const hud = new Hud();
  $("#current-city").textContent = status.map.synthetic ? "Practice grid" : status.map.label;
  const qualitySetting = preference("quality", "high", undefined, {
    legacy: true,
    valid: (value) => [...hud.el.quality.options].some((o) => o.value === value),
  });
  const requestedQuality = params.get("quality");
  const quality = [...hud.el.quality.options].some((o) => o.value === requestedQuality)
    ? requestedQuality
    : qualitySetting.read();
  let hour = replay?.hour ?? parseHour(params.get("time"));
  const clock = new WorldClock(hour, options.clockRate, challenge ? 0 : Number(params.get("weekday") || 0));
  loadingText.textContent = "Starting 3D graphics…";
  const canvas = $("#view");
  let view;
  try {
    view = new SceneView(canvas, map.extent, { quality });
  } catch (error) {
    throw new Error("3D graphics could not start. Check that WebGL is enabled in your browser.", { cause: error });
  }
  loadingText.textContent = "Building the neighbourhood…";
  const graphicsNotice = h(
    "div",
    { class: "simulation-error", role: "alert", hidden: true },
    h("strong", {}, "3D graphics disconnected"),
    h("p", {}, "The drive is paused. Reload the page to reconnect to the graphics device."),
    h("button", { class: "chip-button", onclick: () => location.reload() }, "Reload graphics"),
  );
  document.body.append(graphicsNotice);
  hud.setQuality(view.quality);
  const roads = buildRoads(map);
  view.scene.add(roads.group);
  const signs = buildStreetSigns(map, { anisotropy: view.renderer.capabilities.getMaxAnisotropy() });
  view.addScenery(signs);
  const cityStyle = CITY_STYLES[status.map.id];
  const buildings = buildBuildings(map, { houseColors: cityStyle?.houses });
  view.scene.add(buildings);
  view.addScenery(buildTrees(map));
  mountTransitScenery(view, map);
  view.scene.add(buildSurroundings(map));
  view.scene.add(buildCityIdentity(map, status.map.id));
  view.backdrop.visible = inVancouver(pack.origin); // the North Shore mountains
  const egoMesh = createCarMesh(parseInt(garage.paint, 16), "ego", garage.vehicle.id);
  view.vehicleCamera = egoMesh.userData.hoodCamera;
  view.vehicleHeight = garage.vehicle.height;
  addHeadlights(egoMesh);
  view.scene.add(egoMesh);
  const overlays = new Overlays(view.scene);
  const perception = new PerceptionView(view.scene);
  const recorder = new DriveRecorder();
  let lab;
  let challengeModified = false;
  let examinerPrompt = null;
  let drive = null,
    arrivalPending = false,
    driveReport;
  let decidedAtStart = null; // the autopilot's decision counts when the drive started (bench/metrics.js)
  const callbacks = {
    onDecision: (d) => {
      hud.recordDecision(d.meta);
      panel.set(d);
      overlays.setCandidates(d.candidates, d.chosenId);
    },
    onEvent: (ev) => {
      recorder.mark(world.t, ev.type);
      if (ev.type === "arrived") {
        arrivalPending = true;
        drive?.noteArrival(ev);
        hud.badge(
          ev.parked
            ? "PARKED"
            : ev.parked === false
              ? ev.stuck
                ? "ARRIVED · STUCK PARTWAY IN"
                : "ARRIVED · STOPPED IN LANE"
              : "ARRIVED",
          "stop",
          1500,
        );
        hud.setAutopilot(false);
        overlays.setRoute(null);
        overlays.setCandidates(null);
      } else if (ev.type === "safety") hud.badge("SAFETY BRAKE", "safety", 700);
      else if (ev.type === "fallback") hud.badge(`fallback: ${ev.error}`, "safety", 1800);
      else if (ev.type === "reroute") {
        hud.badge(`re-routed (${ev.count} options)`, "", 1000);
        overlays.setRoute(world.route);
      } else if (ev.type === "deadlock") hud.badge("DEADLOCK: creeping", "safety", 1200);
      else if (ev.type === "error") hud.badge(ev.error, "safety", 1500);
    },
  };
  // A benchmark scenario opened with "watch" replays with the same start, route, and traffic seed.
  let world, fleet, autopilot;
  if (challenge) {
    ({ world, fleet, autopilot } = setupChallenge(map, challenge, callbacks));
    autopilot.setEnabled(false);
  } else if (replay) {
    ({ world, fleet, autopilot } = setupScenario(map, replay.scenario, {
      brain: agentAvailable(replay.brain) ? replay.brain : "rules",
      npcs: replay.npcs,
      weather: replay.weather || "dry",
      features: replay.features || "bare",
      park: replay.park || false,
      hour: replay.hour,
      without: replay.without || [],
      cover: replay.cover,
      // (an open-track benchmark run watched on its own track, brain/tracks.js)
      track: replay.track === "open" ? "open" : "guarded",
      ...callbacks,
    }));
  } else {
    // every opt-in feature of a free drive, each on unless its query parameter is "0" (sim/free-drive.js)
    const free = freeDriveOptions(params, { hour });
    world = new World(map, {
      seed: options.seed,
      weather: params.get("weather") || "dry",
      vehicleSpec: garage.vehicle.spec,
      ...free.world,
    });
    fleet = new NpcFleet(world, { count: options.traffic, seed: options.seed + 6, ...free.fleet });
    autopilot = new Autopilot(world, callbacks);
  }
  const featureViews = mountFeatureViews(view, world);
  // and the diagonal crosswalks of scramble crossings, where the world runs them (sim/signals.js)
  if (world.scrambles && map.scrambles.size) view.scene.add(buildScrambleMarkings(map, world.crowd));
  const actors = mountActorViews(view, world, fleet);
  const previousEgo = {};
  loadingText.textContent = "Preparing the drive…";
  world._road = world.roadInfo();
  if (!agentAvailable(autopilot.brainName)) autopilot.setBrain("rules");
  hud.setBrain(autopilot.brainName);
  const panel = new Panel(autopilot, hud);
  overlays.showCandidates = panel.candidateToggle.checked;
  panel.onShowCandidates = (on) => {
    overlays.showCandidates = on || perception.group.visible;
    const decision = autopilot.lastDecision;
    overlays.setCandidates(overlays.showCandidates ? decision?.candidates : null, decision?.chosenId);
  };
  const weatherView = new WeatherView(view);
  const applySky = (skyHour = hour, skyWeather = world.weather, preview = false) => {
    // (a sun glare challenge's clock has its date and time zone, and the sky draws that day's sun:
    // sim/sun-glare.js)
    const sunDay =
      world.sunGlare.enabled && world.clock?.day !== undefined
        ? { day: world.clock.day, utcOffset: world.clock.utc_offset ?? pack.origin.lon / 15 }
        : {};
    const a = atmosphereFor(skyHour, skyWeather, {
      latitude: pack.origin.lat,
      longitude: pack.origin.lon,
      utcOffset: status.map.utc_offset ?? -7,
      ...sunDay,
    });
    view.setAtmosphere(a);
    tintSurroundings(a);
    if (preview) return;
    world.visibility.setNight(a.night);
    syncClock();
  };
  // school and playground zones go by the time of day (sim/speed-zones.js); a benchmark replay, as
  // the benchmark itself, drives none
  // (and, with sun glare on, so does the sun: a challenge's date and time zone stay; a free drive has the
  // sky's sun, at the city's offset: sim/sun-glare.js)
  const sunClock = () =>
    !world.sunGlare.enabled
      ? {}
      : world.clock?.day !== undefined
        ? {
            day: world.clock.day,
            ...(world.clock.utc_offset !== undefined ? { utc_offset: world.clock.utc_offset } : {}),
          }
        : challenge
          ? {}
          : { utc_offset: status.map.utc_offset ?? -7 };
  function syncClock() {
    if (!replay)
      world.setClock({
        ...mapClock(hour, map),
        ...(world.restrictions || world.busLanes || world.redTurnSigns ? { weekday: clock.weekday } : {}),
        ...sunClock(),
      });
  }
  clock.update(world.t);
  function rememberConditions() {
    const next = new URL(location.href);
    next.searchParams.set("weather", world.weather);
    next.searchParams.set("time", formatClock(hour));
    next.searchParams.set("clock", String(clock.rate));
    history.replaceState(history.state, "", next);
  }
  weatherView.apply(world.weather);
  applySky();
  hud.setWeather(world.weather);
  hud.setTime(describeClock(hour, TIME_PRESETS));
  hud.onWeatherChange((name) => {
    world.weather = setWeather(name).name;
    weatherView.apply(world.weather);
    applySky();
    autopilot.bumpEpoch();
    rememberConditions();
    hud.badge(`weather: ${name}`, "", 800);
  });
  function setHour(value) {
    if (challenge && parseHour(value) !== clock.hour) challengeModified = true;
    clock.setHour(parseHour(value), world.t);
    hour = clock.hour;
    applySky();
    hud.setTime(describeClock(hour, TIME_PRESETS));
    autopilot.bumpEpoch();
    rememberConditions();
  }
  hud.onTimeChange((name) => {
    setHour(name);
    hud.badge(`time: ${formatClock(hour)}`, "", 800);
  });
  $("#clock-rate").value = String(clock.rate);
  $("#clock-rate").addEventListener("change", (ev) => {
    clock.setRate(Number(ev.target.value), world.t);
    rememberConditions();
  });
  const trafficSelect = $("#traffic-density");
  const trafficCount = replay ? fleet.vehicles.filter((n) => n.kind !== "bike").length : options.traffic;
  if (![...trafficSelect.options].some((o) => Number(o.value) === trafficCount)) {
    trafficSelect.add(new Option(`Custom · ${trafficCount}`, String(trafficCount)));
  }
  trafficSelect.value = String(trafficCount);
  $("#world-seed").value = String(replay ? replay.scenario.traffic_seed : options.seed);
  let selectedVehicle = garage.vehicle,
    selectedPaint = garage.paint;
  function updateGarage() {
    $("#vehicle-options").style.setProperty("--vehicle-paint", `#${selectedPaint}`);
    document.querySelectorAll("[data-vehicle]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.vehicle === selectedVehicle.id));
    });
    document.querySelectorAll("[data-paint]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.paint === selectedPaint));
    });
    const spec = selectedVehicle.spec;
    $("#vehicle-spec").textContent =
      `${selectedVehicle.name} · ${spec.length.toFixed(2)} × ${spec.width.toFixed(2)} m · ${spec.mass.toLocaleString()} kg · ${Math.round(spec.power / 1000)} kW at wheels · ${selectedVehicle.drive}`;
  }
  $("#vehicle-options").addEventListener("click", (ev) => {
    const button = ev.target.closest("[data-vehicle]");
    if (!button) return;
    selectedVehicle = getVehicleModel(button.dataset.vehicle);
    updateGarage();
  });
  $("#paint-options").addEventListener("click", (ev) => {
    const button = ev.target.closest("[data-paint]");
    if (!button || !PAINT_COLORS.includes(button.dataset.paint)) return;
    selectedPaint = button.dataset.paint;
    updateGarage();
  });
  updateGarage();
  $("#restart-world").addEventListener("click", () => {
    const seed = $("#world-seed");
    if (!seed.reportValidity()) return;
    if (drive && !drive.finished && drive.distance > 1) saveDrive(withDecidedBy(drive.finish("world restarted")));
    autopilot.setEnabled(false);
    const next = new URL(location.href);
    next.searchParams.delete("replay");
    next.searchParams.delete("explore");
    next.searchParams.set("seed", seed.value);
    next.searchParams.set("traffic", trafficSelect.value);
    next.searchParams.set("car", selectedVehicle.id);
    next.searchParams.set("paint", selectedPaint);
    next.searchParams.set("time", formatClock(hour));
    next.searchParams.set("weather", world.weather);
    next.searchParams.set("quality", view.quality);
    next.searchParams.set("clock", String(clock.rate));
    location.assign(next);
  });
  hud.onQualityChange((name) => {
    view.setQuality(name);
    hud.setQuality(view.quality);
    const saved = qualitySetting.write(view.quality);
    const next = new URL(location.href);
    if (next.searchParams.has("quality")) {
      if (saved) next.searchParams.delete("quality");
      else next.searchParams.set("quality", view.quality);
      history.replaceState(history.state, "", next);
    }
    hud.badge(`graphics: ${view.quality}`, "", 800);
  });
  const minimap = new Minimap($("#minimap"), map, (pt) => setDestination(pt), {
    clearButton: $("#clear-route"),
    onClearRoute: challenge || replay ? null : () => clearDestination(),
  });
  bindMapPicker($("#minimap"), $("#minimap-cursor"), {
    fromCar: () => minimap.toPx(world.ego.x, world.ego.y),
    bounds: () => minimap.pxBounds(),
    onSelect: (x, y) => minimap.pickKeyboard(x, y),
  });
  $("#feature-switches").hidden = Boolean(challenge || replay);
  const showMapNote = () =>
    hud.setMapNote(
      status.map.synthetic
        ? `Synthetic grid (map fetch failed: ${status.map.error})`
        : `© OpenStreetMap contributors (ODbL) · ${pack.edges.length} roads · ${pack.intersections.length} signals · ${pack.stops.length} stops`,
      agentAvailable("jev") ? "" : "no TypeSafe key, Jev unavailable",
    );
  showMapNote();

  function toggleAutopilot() {
    if (simulationError || graphicsLost || photo?.active) return;
    if (lab?.reviewing) {
      lab.branch("manual");
      return;
    }
    if (!autopilot.enabled && !world.route) {
      hud.badge("Set a destination on the minimap or choose a suggested drive in Explore cities.", "", 2400);
      return;
    }
    autopilot.setEnabled(!autopilot.enabled);
    hud.setAutopilot(autopilot.enabled);
    hud.badge(autopilot.enabled ? `AUTOPILOT: ${autopilot.brainName.toUpperCase()}` : "MANUAL", "", 900);
    if (!autopilot.enabled) overlays.setCandidates(null);
  }
  hud.onAutopilotClick(toggleAutopilot);
  // The Decision and LLM buttons each drive with the last model chosen in their pillar (Decision
  // defaults to Jev); their ▾ menus pick another or open the Connect a model dialog.
  const modelPreference = {
    decision: preference("decision", "", undefined, { legacy: true }),
    llm: preference("llm", "", undefined, { legacy: true }),
  };
  const remembered = { decision: modelPreference.decision.read(), llm: modelPreference.llm.read() };
  let pausedBeforeSetup = false;
  const pillarDefault = (pillar) => {
    const current = pillarOf(autopilot.brainName) === pillar ? autopilot.brainName : remembered[pillar];
    return pillar === "decision" ? defaultDecisionId(current) : defaultLlmId(current);
  };
  function showPillars() {
    for (const pillar of ["decision", "llm"]) {
      const d = agentDefinitions().find((agent) => agent.id === pillarDefault(pillar));
      hud.setPillar(pillar, {
        label: d?.label || "",
        available: d ? d.available !== false : false,
        offered: pillar === "decision" || !status.demo,
        menu: !status.demo,
      });
    }
  }
  const agentNote = () => `${decisionSummary(status)} ${llmSummary(status)}`;
  function agentsChanged() {
    lab?.refreshAgents(agentNote());
    showPillars();
    showMapNote();
  }
  // Models added, changed or removed in the setup dialog get fresh brains; removing the active one hands back to Rules.
  function syncBrains(changed) {
    for (const id of changed) {
      const brain = id.startsWith("decision:") ? decisionBrainFor(id) : llmBrainFor(id);
      if (brain) autopilot.brains[id] = brain;
      else delete autopilot.brains[id];
      if (autopilot.brainName === id) {
        if (brain) autopilot.bumpEpoch();
        else selectBrain("rules");
      }
    }
  }
  async function checkEndpoints() {
    const checks = [
      status.decision?.endpoints?.length && checkDecisionEndpoints(),
      status.llm?.endpoints?.length && checkLlmEndpoints(),
    ];
    await Promise.allSettled(checks.filter(Boolean)); // a failed probe leaves the agent "configured"
    agentsChanged();
  }
  async function modelsChanged(result) {
    if (result.decision) status.decision = result.decision;
    if (result.llm) status.llm = result.llm;
    status.configured = !!status.decision?.jev?.configured;
    syncBrains([...registerDecisionAgents(status.decision), ...registerLlmAgents(status.llm)]);
    setup.setStatus("decision", status.decision);
    setup.setStatus("llm", status.llm);
    agentsChanged();
    await checkEndpoints();
  }
  const setup = new ModelSetup({
    onSaved: modelsChanged,
    onUse: (id) => selectBrain(id),
    onPause: (on) => {
      if (on) {
        pausedBeforeSetup = world.paused;
        world.paused = true;
        input.clear();
      } else world.paused = pausedBeforeSetup;
    },
  });
  setup.setStatus("decision", status.decision);
  setup.setStatus("llm", status.llm);
  new ModelMenu($("#decision-menu-toggle"), {
    agents: KINDS.decision.agents,
    onPick: (id) => selectBrain(id),
    onSetup: () => setup.open("decision"),
    current: () => pillarDefault("decision"),
    label: "decision models",
  });
  new ModelMenu($("#llm-menu-toggle"), {
    agents: KINDS.llm.agents,
    onPick: (id) => selectBrain(id),
    onSetup: () => setup.open("llm"),
    current: () => pillarDefault("llm"),
  });
  function selectBrain(name) {
    if (name === "decision" || name === "llm") {
      const pillar = name;
      name = pillarDefault(pillar);
      if (!name) {
        hud.setBrain(autopilot.brainName);
        setup.open(pillar);
        return;
      }
    }
    if (!Object.hasOwn(autopilot.brains, name) || !autopilot.brains[name]) {
      hud.badge("Unknown agent. Choose a driver in Settings.", "safety", 1500);
      return;
    }
    const definition = agentDefinitions().find((agent) => agent.id === name);
    if (definition?.available === false) {
      hud.badge(`${definition.label}: ${definition.note || "unavailable"}`, "safety", 2200);
      hud.setBrain(autopilot.brainName);
      // No key yet: offer to add one (Jev's is the TypeSafe key).
      const endpoint = definition.decision || definition.llm;
      if (!status.demo && (name === "jev" || (endpoint && !endpoint.usable)))
        setup.open(pillarOf(name), name === "jev" ? "typesafe" : null);
      return;
    }
    const pillar = pillarOf(name);
    if (pillar in remembered) {
      remembered[pillar] = name;
      modelPreference[pillar].write(name);
    }
    showPillars();
    if (name === autopilot.brainName) return;
    autopilot.setBrain(name);
    hud.setBrain(name);
    lab?.setAgent(name);
    const label = agentDefinitions().find((agent) => agent.id === name)?.label || name;
    hud.badge(`brain: ${label}`, "", 800);
  }
  hud.onBrainChange(selectBrain);
  const audio = new DriveAudio($("#drive-sound"));
  const volume = $("#drive-volume");
  const volumePreference = preference("volume", 100, undefined, { valid: (v) => v >= 0 && v <= 100 });
  volume.value = String(volumePreference.read());
  const applyVolume = () => {
    audio.setVolume(Number(volume.value) / 100);
    $("#drive-volume-value").textContent = `${volume.value}%`;
    volume.setAttribute("aria-valuetext", `${volume.value} percent`);
  };
  applyVolume();
  volume.addEventListener("input", () => {
    applyVolume();
    volumePreference.write(Number(volume.value));
  });
  const cockpit = new Cockpit();
  function cameraChanged() {
    const orbit = view.mode === "orbit";
    $("#camera-view").textContent = `View: ${orbit ? "360°" : view.mode}`;
    if (photo?.active) photo.setCamera(view.mode);
    $("#camera-orbit").setAttribute("aria-pressed", String(orbit));
    $("#orbit-actions").hidden = !orbit;
    $("#camera-help").hidden = !orbit;
  }
  function enableOrbit() {
    if (view.mode !== "orbit") {
      view.setCamera("orbit");
      cameraChanged();
    }
  }
  const switchCamera = () => {
    view.toggleCamera();
    cameraChanged();
    hud.badge(`camera: ${view.mode === "orbit" ? "360°" : view.mode}`, "", 700);
  };
  $("#camera-view").addEventListener("click", switchCamera);
  $("#camera-orbit").addEventListener("click", () => {
    view.setCamera(view.mode === "orbit" ? "chase" : "orbit");
    cameraChanged();
  });
  const zoomCamera = (delta) => {
    enableOrbit();
    view.orbit.zoom(delta, world.ego.spec);
  };
  $("#camera-zoom-out").addEventListener("click", () => zoomCamera(160));
  $("#camera-zoom-in").addEventListener("click", () => zoomCamera(-160));
  $("#camera-recenter").addEventListener("click", () => {
    view.orbit.reset();
  });
  new OrbitControls($("#view"), {
    rotate: (dx, dy) => {
      enableOrbit();
      view.orbit.rotate(dx, dy);
    },
    zoom: zoomCamera,
    pinch: (scale) => {
      enableOrbit();
      view.orbit.setDistance(view.orbit.distance * scale, world.ego.spec);
    },
  });
  const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  const motionPreference = preference("camera-motion", "", undefined, { valid: (v) => ["", "on", "off"].includes(v) });
  const resetMotion = h(
    "button",
    {
      type: "button",
      class: "chip-button",
      onclick: () => {
        motionOverride = "";
        motionPreference.reset();
        applyMotion();
      },
    },
    "Use system camera motion",
  );
  const cameraMotion = $("#camera-motion");
  cameraMotion.closest("label").after(resetMotion);
  let motionOverride = motionPreference.read();
  const applyMotion = () => {
    cameraMotion.checked = motionOverride ? motionOverride === "on" : !motionQuery.matches;
    view.cameraMotion = cameraMotion.checked;
    resetMotion.hidden = !motionOverride;
  };
  applyMotion();
  motionQuery.addEventListener("change", applyMotion);
  cameraMotion.addEventListener("change", () => {
    motionOverride = cameraMotion.checked ? "on" : "off";
    motionPreference.write(motionOverride);
    applyMotion();
  });
  for (const id of ["wipers", "letter-shortcuts", "left-handed-touch"]) {
    const control = $(`#${id}`);
    const setting = preference(id, control.checked);
    control.checked = setting.read();
    control.addEventListener("change", () => setting.write(control.checked));
  }
  const handedness = $("#left-handed-touch");
  const applyHandedness = () => document.body.classList.toggle("left-handed-touch", handedness.checked);
  handedness.addEventListener("change", applyHandedness);
  applyHandedness();
  let pausedBeforePhoto = false;
  let photoHour, photoWeather;
  const photo = new PhotoMode({
    view,
    place: status.map.synthetic ? "practice grid" : status.map.label,
    getHour: () => hour,
    setHour: (value) => {
      photoHour = parseHour(value);
      if (photo.active) applySky(photoHour, photoWeather, true);
    },
    getWeather: () => world.weather,
    setWeather: (value) => {
      photoWeather = value;
      if (!photo.active) return;
      weatherView.apply(photoWeather);
      applySky(photoHour, photoWeather, true);
    },
    onEnter: () => {
      photoHour = hour;
      photoWeather = world.weather;
      pausedBeforePhoto = world.paused;
      world.paused = true;
      input.clear();
      touch?.release();
      hud.toggleKeys(false);
    },
    onExit: () => {
      weatherView.apply(world.weather);
      applySky();
      input.clear();
      world.paused = lab?.reviewing ? true : pausedBeforePhoto;
      cameraChanged();
    },
  });
  $("#photo-mode").addEventListener("click", () => photo.enter());
  let manualSignal = null;
  function togglePause() {
    if (simulationError || graphicsLost || photo?.active) return; // photo mode holds the world still until it closes
    if (lab?.reviewing) {
      lab.togglePlay();
      return;
    }
    world.paused = !world.paused;
    hud.badge(world.paused ? "PAUSED" : "RESUMED", "", 700);
  }
  const pauseButton = $("#pause-world");
  pauseButton.addEventListener("click", togglePause);
  const conditionsReadout = $("#world-conditions");
  const wipers = $("#wipers");
  const leftIndicator = $("#left-indicator");
  const rightIndicator = $("#right-indicator");
  function signal(side) {
    if (autopilot.enabled) return;
    world.ego.signal = world.ego.signal === side ? null : side;
    manualSignal = world.ego.signal ? { t: world.t, heading: world.ego.psi } : null;
  }
  const shortcutSetting = $("#letter-shortcuts");
  const input = new Input({
    shortcutsEnabled: () => shortcutSetting.checked,
    interceptKey: (key, repeat) => {
      if (photo.active) {
        if ([" ", "h"].includes(key)) {
          if (!repeat) photo.handleKey(key);
          return true;
        }
        // Hold back driving and other shortcuts; Tab, Enter and other navigation keys reach the panel.
        const shortcut = /^[a-z0-9/?]$/.test(key) || key.startsWith("arrow");
        return shortcut && !["o", "m", "c"].includes(key);
      }
      if (key !== " " || !lab?.isReviewing()) return false;
      if (!repeat) lab.togglePlay();
      return true;
    },
    autopilot: toggleAutopilot,
    camera: switchCamera,
    signalLeft: () => signal("left"),
    signalRight: () => signal("right"),
    horn: () => audio.horn(),
    inspector: () => panel.toggle(),
    perception: () => lab.toggleEyes(),
    telemetry: () => lab.toggleTelemetry(),
    sound: () => audio.toggle(),
    explorer: () => explorer.open(),
    lab: () => lab.home(),
    reset: () => {
      if (photo.active || lab?.reviewing) return;
      if (challenge) challengeModified = true;
      drive?.reset();
      world.resetToLane();
      autopilot.bumpEpoch();
      autopilot.executing = null;
    },
    pause: togglePause,
    brain1: () => selectBrain("decision"),
    brain2: () => selectBrain("rules"),
    brain3: () => selectBrain("llm"),
    help: () => hud.toggleKeys(),
    photo: () => photo.toggle(),
    escape: () => {
      if (photo.active) {
        photo.exit();
        return;
      }
      if (!hud.el.keysHelp.hidden) hud.toggleKeys(false);
      else if (!panel.el.hidden) panel.toggle(false);
      else hud.toggleSettings(false);
    },
  });
  shortcutSetting.addEventListener("change", () => {
    input.clearKeys();
    input.refreshShortcutHints();
  });
  input.refreshShortcutHints();
  // A gamepad and, on touch screens, the on-screen controls drive through the same input (ui/gamepad.js,
  // ui/touch.js); they change nothing in the simulation.
  input.addSource(
    new GamepadInput({
      actions: input.actions,
      blocked: () => input.isBlocked() || photo.active,
      onConnect: (pad) =>
        hud.badge(
          `GAMEPAD CONNECTED · ${String(pad.id || "pad")
            .split("(")[0]
            .trim()
            .slice(0, 32)} · RT go, LT brake, Y autopilot`,
          "",
          3500,
        ),
      onDisconnect: () => hud.badge("GAMEPAD DISCONNECTED", "", 1500),
    }),
  );
  let touch = null;
  const coarsePointer = window.matchMedia?.("(pointer: coarse)");
  const touchSetting = $("#touch-setting");
  const touchPreference = preference("touch", "auto", undefined, {
    valid: (v) => ["auto", "show", "hide"].includes(v),
  });
  const touchOverride = params.get("touch");
  touchSetting.value = ["1", "true"].includes(touchOverride)
    ? "show"
    : ["0", "false"].includes(touchOverride)
      ? "hide"
      : touchPreference.read();
  touchSetting.addEventListener("change", () => {
    touchPreference.write(touchSetting.value);
    if (new URLSearchParams(location.search).has("touch")) {
      const next = new URL(location.href);
      next.searchParams.delete("touch");
      history.replaceState(history.state, "", next);
    }
    showTouch();
  });
  const showTouch = () => {
    const on = touchSetting.value === "auto" ? touchWanted("", coarsePointer?.matches) : touchSetting.value === "show";
    if (on && !touch) {
      touch = input.addSource(new TouchControls({ actions: input.actions }));
      input.refreshShortcutHints(touch.el);
    }
    if (touch) {
      if (!on && touch.el.contains(document.activeElement)) {
        const focusTarget = touchSetting.getClientRects().length ? touchSetting : $("#settings-toggle");
        focusTarget.focus({ preventScroll: true });
      }
      touch.el.hidden = !on;
      if (!on) touch.release();
    }
    document.body.classList.toggle("touch-driving", on);
    // (the HUD stands above the drive replay deck too, which sits on the controls: app.css --replay-h)
    const deck = document.querySelector(".replay-deck");
    if (on && deck && !showTouch.deck && typeof ResizeObserver === "function") {
      showTouch.deck = new ResizeObserver(() =>
        document.body.style.setProperty("--replay-h", `${deck.offsetHeight ? deck.offsetHeight + 8 : 0}px`),
      );
      showTouch.deck.observe(deck);
    }
  };

  let pausedBeforeReport = false;
  driveReport = new DriveReport({
    onFinish: () => finishDrive("finished"),
    onNewDrive: () => explorer.open(),
    getReplayTarget: (report, incident) => reportIncidentTarget(recorder, report, incident),
    onReplay: (index, comparison) => {
      lab.update(recorder, performance.now());
      lab.openReplay(index, comparison);
    },
    onOpen: () => {
      pausedBeforeReport = world.paused;
      world.paused = true;
    },
    onClose: () => {
      world.paused = lab?.reviewing ? true : pausedBeforeReport;
    },
  });
  function startDrive(title, route = null) {
    if (challenge && drive) challengeModified = true; // Only the original authored attempt counts.
    if (drive && !drive.finished && drive.distance > 1) saveDrive(withDecidedBy(drive.finish("replaced")));
    drive = new DriveScore(world, {
      title,
      route,
      map: pack.synthetic ? "Practice grid" : status.map.label,
      driver: autopilot.enabled ? autopilot.brainName : "manual",
    });
    if (challenge && !challengeModified && route && drive.driver === "manual")
      drive.metrics = new DriveMetrics(route.length);
    if (challenge?.roadTest) drive.observer = new RoadTestObserver(); // (the road test's examiner: lab/examiner.js)
    arrivalPending = false;
    recorder.reset();
    lab?.endReview();
    driveReport.lastUpdate = -Infinity;
    driveReport.update(drive);
    decidedAtStart = { ...autopilot.decidedBy };
    recorder.record({ world, fleet, autopilot, drive, clock }, true);
  }
  // Who made an AI drive's decisions (bench/metrics.js): none for a manual or Rules drive. Counted from
  // this autopilot's start of the drive; one made since, by a world rebuilt, has no share.
  function withDecidedBy(report) {
    if (!["manual", "rules"].includes(report.driver ?? drive?.driver) && decidedAtStart) {
      const decided = decidedByCounts(autopilot.decidedBy, decidedAtStart);
      if (decided.model_share !== null && Object.values(decided).every((n) => n === null || n >= 0))
        Object.assign(report, decided);
    }
    return report;
  }
  function finishDrive(reason) {
    if (lab?.reviewing) return;
    if (!drive || drive.finished) return;
    if (drive.simulationError) reason = "error";
    // A manual driver finishes parking with the review button; the AI reports its own arrival.
    if (
      reason === "finished" &&
      challenge?.park &&
      drive.driver === "manual" &&
      world.route &&
      Math.abs(world.ego.v) < 0.05
    ) {
      const car = world.ego,
        spec = car.spec;
      const space = spacesAlong(world, world.route, spec).find((p) => {
        const f = frameOf(car, p),
          side = (spec.width / 2) * Math.abs(Math.sin(f.phi));
        return (
          parkedPose(car, p).within_kerb &&
          f.u - spec.rearOverhang * Math.cos(f.phi) - side >= p.sFrom &&
          f.u + (spec.length - spec.rearOverhang) * Math.cos(f.phi) + side <= p.sTo
        );
      });
      if (space) {
        drive.noteArrival({ parked: true, ...parkedPose(car, space) });
        reason = "arrived";
      }
    }
    if (autopilot.enabled) {
      autopilot.setEnabled(false);
      hud.setAutopilot(false);
      overlays.setCandidates(null);
    }
    const report = drive.finish(reason);
    report.config = challenge
      ? challengeConfig(challenge)
      : {
          map: status.map.id,
          seed: options.seed,
          traffic: options.traffic,
          weather: world.weather,
          time: formatClock(hour),
          clock: clock.rate,
          car: garage.vehicle.id,
        };
    report.branched = recorder.branched;
    report.recording_id = recorder.recordingId;
    report.config.pack = pack.pack_version;
    report.modified = challengeModified;
    if (challenge && practiceEligible(challenge, report)) {
      report.config.map_sha = mapFingerprint(map);
      if (drive.metrics?.jerkN)
        report.benchmarkMetrics = challengeScoreInputs(
          drive.metrics.summary(world, autopilot, report.status === "arrived"),
          report.hard_brakes,
        );
    }
    withDecidedBy(report);
    if (challenge) {
      const practice = challenge.roadTest
        ? saveRoadTest(challenge, report, examine(challenge, report))
        : savePractice(challenge, report);
      lab.practice = practice;
      report.practice = { outcome: practice.outcome, saved: practice.available };
    }
    recorder.record({ world, fleet, autopilot, drive, clock }, true);
    const saved = saveDrive(report);
    driveReport.lastUpdate = -Infinity;
    driveReport.update(drive);
    driveReport.show(report, saved);
  }

  let pausedBeforeExplorer = false;
  const explorer = new Explorer({
    map: status.map,
    getStart: () => ({ x: world.ego.x, y: world.ego.y, heading: world.ego.psi }),
    onOpen: () => {
      if (lab?.reviewing) lab.live();
      pausedBeforeExplorer = world.paused;
      world.paused = true;
    },
    onClose: () => {
      world.paused = pausedBeforeExplorer;
    },
    onDrive: async (d) => {
      const installed = await routeRequests.choose(d.destination, {
        route: d.route,
        title: d.title,
        check: Object.keys(featureRouteOptions(world)).length > 0,
      });
      if (!installed && !routeStatus.hidden)
        hud.badge(`Could not start the suggested drive. ${routeStatus.textContent}`, "safety", 2500);
    },
    onMap: (id) => {
      if (drive && !drive.finished && drive.distance > 1) saveDrive(withDecidedBy(drive.finish("map changed")));
      autopilot.setEnabled(false);
      const next = new URL(location.href);
      next.searchParams.delete("bbox");
      next.searchParams.delete("replay");
      next.searchParams.delete("challenge");
      next.searchParams.delete("drive");
      next.searchParams.set("map", id);
      next.searchParams.set("explore", "1");
      next.searchParams.set("weather", world.weather);
      next.searchParams.set("time", formatClock(hour));
      next.searchParams.set("clock", String(clock.rate));
      next.searchParams.set("quality", view.quality);
      location.assign(next);
    },
  });

  const routeStatus = $("#route-status");
  const mapCanvas = $("#minimap");
  const routeRequests = new RouteRequest({
    request: api,
    payload: (point) => ({
      bbox: status.map.bbox.join(","),
      from: { x: world.ego.x, y: world.ego.y, heading: world.ego.psi },
      to: { x: point[0], y: point[1] },
      k: 1,
      ...featureRouteOptions(world),
    }),
    install: installRoute,
    show: (message, busy = false) => {
      routeStatus.hidden = !message;
      routeStatus.textContent = message;
      mapCanvas.setAttribute("aria-busy", String(busy));
    },
    canInstall: () => !simulationError && !graphicsLost && !lab?.reviewing,
  });
  canvas.addEventListener("webglcontextlost", () => {
    graphicsLost = true;
    world.paused = true;
    input.clear();
    routeRequests.cancel();
    graphicsNotice.hidden = false;
  });
  function replaceDriveRoute(route, destination) {
    autopilot.parker.clear(world);
    world.route = route;
    world.destination = destination;
    world.turnaround = null;
    autopilot.pausedTurnaround = null;
    autopilot.turnaroundRoute = null;
    autopilot.pendingRoutes = null;
    autopilot.detourRouting = null;
    autopilot.offRouteFor = 0;
    autopilot.bumpEpoch();
    autopilot.executing = null;
    overlays.setRoute(route);
    overlays.setCandidates(null);
  }

  function clearDestination() {
    if (simulationError || lab?.reviewing) return;
    routeRequests.cancel();
    replaceDriveRoute(null, null);
    autopilot.setEnabled(false);
    hud.setAutopilot(false);
    if (drive && !drive.finished) {
      const report = withDecidedBy(drive.finish("route cleared"));
      if (drive.distance > 1) saveDrive(report);
      driveReport.lastUpdate = -Infinity;
      driveReport.update(drive);
    }
    if (drive) recorder.record({ world, fleet, autopilot, drive, clock }, true);
    hud.badge("Route cleared", "", 1000);
  }
  function installRoute(data, pt, title) {
    const route = new Route(data, map, world.ego.spec);
    if (challenge) challengeModified = true;
    replaceDriveRoute(route, pt);
    hud.badge(`route: ${world.route.summary}`, "", 2200);
    if (!autopilot.enabled) toggleAutopilot();
    startDrive(title || `Drive to ${map.nearestLane(...pt)?.lane.edgeRef.name || "your destination"}`, world.route);
  }

  let pausedBeforeLab = false;
  const replayTarget = {
    world,
    fleet,
    autopilot,
    clock,
    setDrive: (restored) => {
      drive = restored;
    },
  };
  function restoreFrame(index) {
    routeRequests.cancel();
    recorder.restore(index, replayTarget);
    input.clearKeys();
    arrivalPending = false;
    capturePose(world.ego, previousEgo);
    actors.restore(egoMesh, !lab.playing);
    world._road = world.roadInfo();
    panel.set(autopilot.lastDecision);
    hud.setBrain(autopilot.brainName);
    lab.setAgent(autopilot.brainName);
    hud.setAutopilot(autopilot.enabled);
    overlays.setRoute(world.route);
    overlays.setCandidates(autopilot.lastDecision?.candidates, autopilot.lastDecision?.chosenId);
    hour = clock.hour;
    setWeather(world.weather);
    weatherView.apply(world.weather);
    applySky();
    hud.setWeather(world.weather);
    hud.setTime(describeClock(hour, TIME_PRESETS));
    $("#clock-rate").value = String(clock.rate);
    skyAt = world.t;
    acc = 0;
    lastWeather = null;
    manualSignal = world.ego.signal && !autopilot.enabled ? { t: world.t, heading: world.ego.psi } : null;
    driveReport.lastUpdate = -Infinity;
    driveReport.update(drive);
  }
  lab = new DriveLab({
    city: { ...status.map, ...cityStyle },
    demo: !!status.demo,
    agentNote: agentNote(),
    onConnectModel: () => setup.open(),
    onPause: (on) => {
      if (on) {
        if (lab?.reviewing) lab.live();
        pausedBeforeLab = world.paused;
        world.paused = true;
        input.clearKeys();
      } else world.paused = pausedBeforeLab;
    },
    onScenic: async (driver) => {
      const { drives } = await api("/api/drives", {
        bbox: status.map.bbox.join(","),
        from: { x: world.ego.x, y: world.ego.y, heading: world.ego.psi },
      });
      if (!drives.length) throw new Error("Try another position or city in Explore cities.");
      setHour("golden");
      selectBrain("rules");
      const scenic = drives[0];
      if (
        !(await routeRequests.choose(scenic.destination, {
          route: scenic.route,
          title: scenic.title,
          check: Object.keys(featureRouteOptions(world)).length > 0,
        }))
      )
        return;
      if (driver === "manual") {
        autopilot.setEnabled(false);
        hud.setAutopilot(false);
        drive.driver = "manual";
      }
      world.paused = false;
    },
    onSeek: restoreFrame,
    onLive: () => {
      restoreFrame(recorder.frames.length - 1);
      recorder.restoreSpend(autopilot);
      world.paused = false;
    },
    onBranch: (index, driver) => {
      restoreFrame(index);
      let alternative, branchSnap, candidates;
      if (driver.startsWith("candidate:")) {
        branchSnap = buildSnapshot(world);
        candidates = sampleCandidates(branchSnap, world);
        const { eligible } = simulateAll(candidates, branchSnap, world);
        alternative = eligible.find((c) => c.id === driver.slice(10));
        if (!alternative) {
          hud.badge("That manoeuvre no longer passes safety checks. Choose another.", "safety", 2000);
          return false;
        }
      }
      recorder.branch(index);
      recorder.restoreSpend(autopilot);
      if (drive) {
        drive.finished = null;
        drive.driver = "mixed";
        drive.incident(
          "takeover",
          alternative ? "Replay branch with an alternate manoeuvre" : `Replay branch with ${driver}`,
        );
      }
      if (alternative) {
        autopilot.setEnabled(true);
        autopilot.apply(
          {
            motion: alternative.law.vTarget <= 0.1 ? "stop" : "drive",
            candidateId: alternative.id,
            meta: { source: "replay_choice", model: "replay", latency_ms: 0, input_tokens: 0, cost_usd: 0 },
          },
          branchSnap,
          candidates,
          { state: autopilot.lastDecision?.state || {}, questions: {}, flags: [] },
        );
        autopilot.lastStart = world.t * 1000 + 1000;
      } else if (driver === "manual") autopilot.setEnabled(false);
      else {
        selectBrain(driver);
        autopilot.setEnabled(!!world.route);
      }
      if (!alternative) autopilot.executing = null;
      world.paused = false;
      hud.setAutopilot(autopilot.enabled);
    },
    onAgent: (name, definition) => {
      if (definition) autopilot.brains[name] = definition.create();
      selectBrain(name);
    },
    onPerception: (on) => {
      perception.setEnabled(on);
      overlays.showCandidates = on || panel.candidateToggle.checked;
      overlays.setCandidates(autopilot.lastDecision?.candidates, autopilot.lastDecision?.chosenId);
    },
  });
  // (after the drive lab, whose replay deck the touch layout makes room for)
  showTouch();
  coarsePointer?.addEventListener?.("change", showTouch);

  function setDestination(pt) {
    if (simulationError) return;
    if (lab?.reviewing) lab.live();
    return routeRequests.choose(pt);
  }

  // Turn-by-turn guidance for manual drivers; the autopilot's own snapshot is used when it drives.
  let cachedNav = null,
    navRoute = null,
    navAt = -Infinity;
  function routeNav(now) {
    const route = world.route;
    if (!route) {
      navRoute = null;
      cachedNav = null;
      return null;
    }
    if (route === navRoute && now - navAt < 100) return cachedNav;
    navRoute = route;
    navAt = now;
    const p = route.project(world.ego.x, world.ego.y);
    if (p.distance > 25) return (cachedNav = null);
    const remaining = route.remaining(p.s),
      next = route.turnsAfter(p.s)[0];
    return (cachedNav = {
      next_turn: next ? next.dir : "none",
      exit: next?.exit ?? null,
      turn_in_m: next ? next.at_m - p.s : remaining,
      turn_street: next?.street || "",
      remaining_m: remaining,
      arrived: remaining < 3.5,
    });
  }

  if (challenge) {
    const requested = params.get("drive") || "manual";
    const driver = requested === "manual" || agentAvailable(requested) ? requested : "manual";
    selectBrain(driver === "manual" ? "rules" : driver);
    if (driver !== requested)
      hud.badge("Requested driver unavailable. The challenge starts in manual mode.", "safety", 3000);
    autopilot.setEnabled(driver !== "manual");
    hud.setAutopilot(autopilot.enabled);
    overlays.setRoute(world.route);
    startDrive(challenge.title, world.route);
    if (challenge.roadTest) examinerPrompt = new ExaminerPrompt(challenge, world.route);
    $(".hud-top-left").append(
      examinerPrompt?.element ||
        h("div", { class: "challenge-banner" }, h("strong", {}, challenge.title), challenge.lesson),
    );
    for (const selector of ["#weather", "#time", "#clock-rate", "#traffic-density", "#world-seed", "#restart-world"])
      $(selector).disabled = true;
  }
  if (replay) {
    overlays.setRoute(world.route);
    hud.setAutopilot(true);
    hud.badge(`REPLAY ${replay.scenario.id}: ${autopilot.brainName.toUpperCase()}`, "", 2200);
    startDrive(`Replay ${replay.scenario.id}`, world.route);
  }
  showPillars();
  checkEndpoints();
  window.__jev = {
    world,
    map,
    view,
    autopilot,
    fleet,
    setDestination,
    overlays,
    signs,
    audio,
    cockpit,
    clock,
    driveReport,
    explorer,
    egoMesh,
    vehicle: garage.vehicle,
    recorder,
    lab,
    perception,
    photo,
    input,
    get touch() {
      return touch;
    },
    get drive() {
      return drive;
    },
    get simulationError() {
      return simulationError;
    },
    finishDrive,
    setTime: setHour,
  };
  $("#loading").hidden = true;
  canvas.inert = false;
  hud.show();
  if (params.has("explore")) explorer.open();
  else if (!challenge && !replay && !params.has("drive")) lab.home();

  let last = performance.now();
  let acc = 0;
  const announcedFeatures = new Map();
  let indicatorLit = false,
    announcedEv = null,
    announcedAt = -Infinity,
    announcedBus = null,
    announcedCrosswalk = null,
    announcedSchool = null,
    announcedZone = null,
    announcedStreetcar = null,
    announcedCrossing = null,
    announcedBox = null,
    announcedAdvance = null,
    announcedClosure = null,
    announcedNightFlash = null,
    announcedPlow = null,
    announcedPark = null,
    announcedHazard = null,
    announcedTraffic = null,
    announcedCyclist = null,
    announcedLeftRed = null;
  let lastWeather, lastClockLabel, lastSight;
  let skyAt = world.t;
  function frame(now) {
    // Schedule before stepping: a failed simulation must not permanently stop rendering or controls.
    if (!manual) requestAnimationFrame(frame);
    if (simulationError || graphicsLost) world.paused = true;
    // A pulse queued while driving was suspended never reaches physics, even if this poll resumes it.
    if (simulationError || world.paused || photo.active) input.stepped();
    input.poll();
    touch?.setAutopilot(autopilot.enabled);
    lab.update(recorder, now);
    // never negative: headless runs advance the clock by hand, ahead of requestAnimationFrame
    const dt = Math.max(0, Math.min(0.25, (now - last) / 1000));
    last = now;
    if (!simulationError && !world.paused && !photo.active) {
      acc = Math.min(acc + dt, FIXED_DT * 5);
      let steps = 0;
      while (acc >= FIXED_DT && steps < 5) {
        if (input.anyDriving && (!drive || drive.finished)) startDrive("Free drive");
        if (autopilot.enabled && input.anyDriving) {
          toggleAutopilot();
        }
        if (drive && !drive.finished && !arrivalPending) {
          const driver = autopilot.enabled ? autopilot.brainName : "manual";
          if (driver !== drive.driver) drive.driver = "mixed";
        }
        capturePose(world.ego, previousEgo);
        actors.capture();
        let road;
        try {
          road = stepWorld({ world, fleet, autopilot, input }, FIXED_DT, world.t * 1000);
          input.stepped();
        } catch (error) {
          simulationError = String(error?.message || error || "Unknown simulation error").slice(0, 240);
          console.error("Simulation stopped", error);
          world.paused = true;
          autopilot.setEnabled(false);
          hud.setAutopilot(false);
          input.clear();
          routeRequests.cancel();
          acc = 0;
          drive?.incident("simulation_error", simulationError);
          document.body.append(
            h(
              "div",
              { id: "simulation-error", class: "simulation-error", role: "alert" },
              h("strong", {}, "Drive stopped after a simulation error"),
              h("p", {}, simulationError),
              h("button", { class: "chip-button", onclick: () => location.reload() }, "Restart drive"),
            ),
          );
          break;
        }
        if (
          drive?.metrics &&
          !drive.finished &&
          drive.driver === "manual" &&
          !challengeModified &&
          !recorder.branched
        ) {
          try {
            drive.metrics.record(world, drivenMetricSnapshot(world), road, FIXED_DT);
          } catch (error) {
            drive.metrics = null;
            console.warn("Benchmark score unavailable", error);
          }
        }
        if (drive && !drive.finished && !autopilot.enabled && world.route && Math.abs(world.ego.v) < 0.5) {
          const projection = world.route.project(world.ego.x, world.ego.y);
          if (projection.distance < 4 && world.route.remaining(projection.s) < 3.5) {
            arrivalPending = true;
            world.route = null;
            world.destination = null;
            overlays.setRoute(null);
            overlays.setCandidates(null);
            hud.badge("ARRIVED", "stop", 1500);
          }
        }
        drive?.record(world, world._road, FIXED_DT);
        if (arrivalPending) {
          arrivalPending = false;
          finishDrive("arrived");
        }
        for (const ev of world.events) {
          recorder.mark(world.t, ev.type);
          if (ev.type === "collision") {
            hud.flash();
            hud.badge(`COLLISION · ${(ev.kind || "object").replace(/_/g, " ").toUpperCase()}`, "alert", 1500);
          } else if (ev.type === "red_light") hud.badge("RAN A RED LIGHT", "alert", 1500);
          else if (ev.type === "stop_sign")
            hud.badge(
              ev.flagger ? "WENT PAST THE FLAGGER'S STOP" : ev.dark ? "NO STOP AT A DARK SIGNAL" : "RAN A STOP SIGN",
              "alert",
              1500,
            );
          else if (ev.type === "failed_to_yield") hud.badge(`FAILED TO YIELD TO ${ev.to.toUpperCase()}`, "alert", 1500);
          else if (ev.type === "merged_out_of_turn") hud.badge("MERGED OUT OF TURN", "alert", 1500);
          else if (ev.type === "close_pass") hud.badge("PASSED A CYCLIST TOO CLOSE", "alert", 1500);
          else if (ev.type === "kerb_strike") hud.badge("KERB STRIKE", "alert", 1200);
          else {
            const notice = featureEventBadge(ev);
            if (notice) hud.badge(notice, "alert", 1500);
          }
        }
        if (drive && !drive.finished) recorder.record({ world, fleet, autopilot, drive, clock });
        acc -= FIXED_DT;
        steps++;
        if (world.paused) {
          acc = 0;
          break;
        }
      }
    } else {
      input.stepped(); // no live steps while paused, reviewing or in Photo mode: drop one-step pulses
    }
    hour = clock.update(world.t);
    syncClock();
    if (world.t - skyAt >= 1) {
      if (clock.rate) applySky();
      skyAt = world.t;
    }
    const clockLabel = formatClock(hour);
    const sight = Math.round(world.visibility.range);
    if (world.weather !== lastWeather || clockLabel !== lastClockLabel || sight !== lastSight) {
      lastWeather = world.weather;
      lastClockLabel = clockLabel;
      lastSight = sight;
      const conditions = `${garage.vehicle.name} · ${clockLabel} · ${world.weather[0].toUpperCase() + world.weather.slice(1)} · ${sight} m sight`;
      conditionsReadout.textContent = conditions;
    }
    touch?.setPressed("pause", world.paused);
    touch?.setPressed("signalLeft", world.ego.signal === "left");
    touch?.setPressed("signalRight", world.ego.signal === "right");
    if (pauseButton.getAttribute("aria-pressed") !== String(world.paused)) {
      pauseButton.setAttribute("aria-pressed", String(world.paused));
      pauseButton.textContent = world.paused ? "Resume" : "Pause";
    }
    const alpha = world.paused || photo.active ? 1 : acc / FIXED_DT;
    const replayNext = lab.reviewing ? recorder.frames[Number(lab.slider.value) + 1]?.state : null;
    const replayAlpha = lab.replayAlpha;
    const renderEgo = replayNext
      ? replayActorPose(world.ego, replayNext.world.ego, replayAlpha)
      : Number.isFinite(previousEgo.x)
        ? interpolatePose(world.ego, previousEgo, alpha)
        : world.ego;
    for (const inter of map.intersections.values()) {
      // (with an advance green, each approach shows its own lights; with the power out, none do)
      const dark = world.outages.isDark(inter.id);
      roads.signals.set(
        inter.id,
        inter.plan?.advance
          ? Object.fromEntries(
              inter.approaches.map((a) => [`@${a.edge}`, dark ? "dark" : approachPhase(inter, a.edge, world.t)]),
            )
          : dark
            ? { A: "dark", B: "dark" }
            : world.phase(inter.id),
        world.t,
      );
      roads.signals.setPed(
        inter.id,
        dark ? { A: "dark", B: "dark" } : { A: pedPhase(inter, "A", world.t), B: pedPhase(inter, "B", world.t) },
        world.t,
      );
    }
    actors.sync();
    if (manualSignal && !autopilot.enabled) {
      const turned =
        Math.abs(
          Math.atan2(Math.sin(world.ego.psi - manualSignal.heading), Math.cos(world.ego.psi - manualSignal.heading)),
        ) > 0.5;
      if (world.t - manualSignal.t > 12 || (turned && Math.abs(world.ego.delta) < 0.08)) {
        world.ego.signal = null;
        manualSignal = null;
      }
    }
    const lightsOn = syncCarLights(lighting.night.value, weatherView.name !== "dry");
    const actorDt = (world.paused || photo.active) && !lab.playing ? 0 : dt;
    beamIndicator.hidden = !world.highBeams || !world.ego.highBeam;
    actors.updateEgo(egoMesh, renderEgo, actorDt, lightsOn, actorTime(world.t, replayNext?.world.t, replayAlpha));
    featureViews.updateSignals();
    actors.updateVehicles(actorDt, lightsOn, alpha, replayNext, replayAlpha);
    // an emergency vehicle calling on the car to give way: say so once, and sound its siren
    const evs = fleet.vehicles.filter(isEmergency);
    const call = evs.length ? nearestCall(world.ego, evs) : null;
    // (kept up for as long as it calls on the car)
    if (call && (call.ev.id !== announcedEv || world.t - announcedAt > 1)) {
      announcedEv = call.ev.id;
      announcedAt = world.t;
      hud.badge(
        `${EMERGENCY_NAMES[call.ev.kind].toUpperCase()} ${call.relation === "behind" ? "BEHIND" : call.relation === "ahead" ? "AHEAD" : `FROM THE ${call.relation.toUpperCase()}`} · PULL OVER AND STOP`,
        "safety",
        2500,
      );
    }
    if (!call) announcedEv = null;
    const nearestEv = audio.enabled
      ? evs.reduce((best, n) => Math.min(best, Math.hypot(n.x - world.ego.x, n.y - world.ego.y)), Infinity)
      : Infinity;
    audio.siren(nearestEv, world.t, world.paused || document.hidden);
    // a bus ahead signalling to pull out from its stop, with the right of way: say so once
    const bus = fleet.buses?.find((b) => busYield(world.ego, b) && world.visibility.sees(world.ego, b));
    const busKey = bus ? `${bus.id}:${bus.transit.departures}` : null;
    if (bus && busKey !== announcedBus) {
      hud.badge(`BUS ${bus.ref || ""} PULLING OUT · YIELD`.replace("  ", " "), "safety", 2500);
    }
    announcedBus = busKey;
    // a vehicle stopped at a crosswalk ahead in the next lane, that the car must not pass: say so once
    const cw = world.crowd.marked.find((c) => {
      const d = frontTo(c, world.ego);
      return d !== null && d > 0 && d < 50 && !looked(world, c);
    });
    const stopped = cw && stoppedAt(world, cw, world.ego).find((n) => world.visibility.sees(world.ego, n));
    const cwKey = stopped ? `${cw.id}:${stopped.id}` : null;
    if (stopped && cwKey !== announcedCrosswalk) {
      hud.badge(`${isBus(stopped) ? "BUS" : "CAR"} STOPPED AT CROSSWALK · DON'T PASS`, "safety", 2500);
    }
    announcedCrosswalk = cwKey;
    // a school bus ahead with its reds flashing, either way, that the car must stop for: say so once
    const school = fleet.schoolBuses?.find((b) => {
      const r = redsOn(b) && schoolBusRelation(world.ego, b);
      return (
        r &&
        r.ahead_m > 0 &&
        r.ahead_m < 70 &&
        Math.abs(r.right_m) < SCHOOL_SIDE_M &&
        world.visibility.sees(world.ego, b)
      );
    });
    const schoolKey = school ? `${school.id}:${school.school.stops}` : null;
    if (school && schoolKey !== announcedSchool) {
      hud.badge("SCHOOL BUS · RED LIGHTS FLASHING · STOP", "safety", 2500);
    }
    announcedSchool = schoolKey;
    // a streetcar ahead with its doors open, that the car must stop behind: say so once
    const tram = fleet.streetcars?.find((c) => {
      const r = doorsOpen(c) && streetcarRelation(world.ego, c);
      return (
        r &&
        r.ahead_m > 0 &&
        r.ahead_m < 70 &&
        r.right_m > -STREETCAR_IN_LANE_M &&
        r.right_m < STREETCAR_SIDE_M &&
        world.visibility.sees(world.ego, c)
      );
    });
    const tramKey = tram ? `${tram.id}:${tram.transit.departures}` : null;
    if (tram && tramKey !== announcedStreetcar) {
      hud.badge("STREETCAR · DOORS OPEN · STOP BEHIND THE DOORS", "safety", 2500);
    }
    announcedStreetcar = tramKey;
    // a level crossing ahead to wait at, for a train coming or for room past the tracks: say so once,
    // and sound the gong of a train ringing nearby
    const crossing = crossingNotice(world);
    if (crossing && crossing.key !== announcedCrossing) {
      announcedCrossing = crossing.key;
      hud.badge(crossing.text, "safety", 2500);
    }
    if (!crossing) announcedCrossing = null;
    // a signal ahead the car could not clear, for traffic past the junction: say so once
    const box = boxNotice(world);
    if (box && box.key !== announcedBox) {
      announcedBox = box.key;
      hud.badge(box.text, "safety", 2500);
    }
    if (!box) announcedBox = null;
    // an advance green on the car's approach: whether its turn is protected, or the arrow is not its
    // light: say so once
    const advance = advanceNotice(world);
    if (advance && advance.key !== announcedAdvance) {
      announcedAdvance = advance.key;
      hud.badge(advance.text, advance.protected ? "stop" : "safety", 2500);
    }
    if (!advance) announcedAdvance = null;
    announceFeatureNotices("beforeMerge", world, autopilot, featureViews, announcedFeatures, hud);
    // a lane closed ahead: use both lanes to the merge point, then take turns (said again as the turn changes)
    const closure = laneClosureNotice(world);
    if (closure && closure.key !== announcedClosure) {
      announcedClosure = closure.key;
      hud.badge(closure.text, closure.stop ? "safety" : "", 2500);
    }
    if (!closure) announcedClosure = null;
    // a signal ahead with its lights out: an all-way stop, said once each time the car's part changes
    const nightNotice = nightFlashNotice(world);
    if (nightNotice && nightNotice.key !== announcedNightFlash) {
      announcedNightFlash = nightNotice.key;
      hud.badge(nightNotice.text, "stop", 2500);
    }
    if (!nightNotice) announcedNightFlash = null;
    announceFeatureNotices("beforePlow", world, autopilot, featureViews, announcedFeatures, hud);
    // a snow plow ahead: stay back of it, never pass it on the right, back in only well ahead of it
    const plowLine = plowNotice(world);
    if (plowLine && plowLine.key !== announcedPlow) {
      announcedPlow = plowLine.key;
      hud.badge(plowLine.text, plowLine.wait ? "safety" : "", 2500);
    }
    if (!plowLine) announcedPlow = null;
    // parking at the destination: the space, checking behind, reversing in, parked
    const parkLine = parkNotice(world);
    if (parkLine && parkLine.key !== announcedPark) {
      announcedPark = parkLine.key;
      hud.badge(parkLine.text, parkLine.wait ? "safety" : "stop", 2500);
    }
    if (!parkLine) announcedPark = null;
    // cars parked at the kerb that hide the sidewalk ahead, and someone stepping out from between them
    const hazardLine = hazardNotice(world);
    if (hazardLine && hazardLine.key !== announcedHazard) {
      announcedHazard = hazardLine.key;
      hud.badge(hazardLine.text, hazardLine.wait ? "safety" : "", 2500);
    }
    if (!hazardLine) announcedHazard = null;
    // a vehicle hiding a lane the car must give way to (sim/hidden-traffic.js)
    const trafficLine = trafficNotice(world, autopilot.snap);
    if (trafficLine && trafficLine.key !== announcedTraffic) {
      announcedTraffic = trafficLine.key;
      hud.badge(trafficLine.text, trafficLine.wait ? "safety" : "", 2500);
    }
    if (!trafficLine) announcedTraffic = null;
    // a cyclist riding in the lane ahead, on a street with one lane each way: stay behind, and why, or
    // the way is clear to pass with the minimum passing distance (said again as that changes)
    const cyclistLine = cyclistNotice(world);
    if (cyclistLine && cyclistLine.key !== announcedCyclist) {
      announcedCyclist = cyclistLine.key;
      hud.badge(cyclistLine.text, cyclistLine.wait ? "safety" : "", 2500);
    }
    if (!cyclistLine) announcedCyclist = null;
    // a cyclist riding against a one-way street the car waits or moves over for (sim/contraflow.js)
    announceFeatureNotices("beforeLeftOnRed", world, autopilot, featureViews, announcedFeatures, hud);
    // a scramble crossing ahead: every light red while people cross every way; no right turn on red
    const leftRed = autopilot.snap?.intersection?.left_on_red;
    const leftRedKey = leftRed ? `${autopilot.snap.intersection.id}:${leftRed.stop_completed}:${leftRed.clear}` : null;
    if (leftRedKey && leftRedKey !== announcedLeftRed)
      hud.badge(
        leftRed.go
          ? "LEFT ON RED · CLEAR TO TURN"
          : !leftRed.stop_completed
            ? "LEFT ON RED · FULL STOP FIRST"
            : "LEFT ON RED · YIELD TO PEDESTRIANS AND TRAFFIC",
        "safety",
        2500,
      );
    announcedLeftRed = leftRedKey;
    announceFeatureNotices("end", world, autopilot, featureViews, announcedFeatures, hud);
    if (audio.enabled) {
      let ringing = Infinity;
      for (const train of fleet.trains || [])
        if (train.rail.gong) ringing = Math.min(ringing, Math.hypot(train.x - world.ego.x, train.y - world.ego.y));
      audio.gong(ringing, world.t, world.paused || document.hidden);
    }
    announceFeatureNotices("beforeZone", world, autopilot, featureViews, announcedFeatures, hud);
    // into a school or playground zone in effect: say so once
    const zone = world._road?.zone;
    if (zone && zone.id !== announcedZone)
      hud.badge(`${ZONE_NAMES[zone.kind].toUpperCase()} · ${Math.round(world._road.limit * 3.6)} KM/H`, "", 2500);
    announcedZone = zone?.id ?? null;
    actors.updatePeople(alpha, replayNext, replayAlpha, weatherView.name);
    overlays.tick(world.t);
    lab.showPerception(perception.update(world, now, autopilot.lastDecision, autopilot.executing));
    weatherView.update(dt);
    roads.streetLights.setOutage?.(!!world.streetLightsOut);
    if (roads.streetLights.lights) roads.streetLights.lights.update(view.camera, dt);
    view.updateCamera(renderEgo, dt);
    featureViews.update(fleet, actors.people, actorDt, lightsOn);
    if (!graphicsLost) view.render(dt, photo.active);
    cockpit.update(view.mode, world.weather, world.t, wipers.checked);
    audio.update(world.ego, world.weather, world.paused, view.mode === "hood");
    const blink = world.ego.signal && world.t % 0.8 < 0.45;
    if (blink && !indicatorLit && !world.paused) audio.tick();
    indicatorLit = blink;
    leftIndicator.classList.toggle("active", !!blink && world.ego.signal === "left");
    rightIndicator.classList.toggle("active", !!blink && world.ego.signal === "right");
    minimap.draw({
      ego: world.ego,
      npcs: world.contraflow.riders.length ? [...fleet.vehicles, ...world.contraflow.riders] : fleet.vehicles,
      route: world.route,
      destination: world.destination,
    });
    const snap = autopilot.enabled ? autopilot.snap : null;
    hud.update(
      {
        ego: world.ego,
        road: world._road,
        nav: snap?.nav || routeNav(now),
        violations: world.violations,
        decision: autopilot.lastDecision,
        totals: autopilot.totals,
        paused: world.paused,
        autopilot: autopilot.enabled,
        hasRoute: !!world.route,
      },
      now,
    );
    panel.render(now);
    driveReport.update(drive, now);
    examinerPrompt?.update(world, drive, now);
    if (lab.reviewing) driveReport.finishButton.disabled = true;
  }
  // Headless screenshots run in a hidden page where requestAnimationFrame never fires; they advance
  // frames by hand through window.__jev.advance(seconds).
  let manual = false;
  window.__jev.advance = (seconds, fps = 30) => {
    manual = true;
    try {
      for (let t = 0; t < seconds; t += 1 / fps) frame(last + 1000 / fps);
    } finally {
      manual = false;
    }
  };
  requestAnimationFrame(frame);
}

const beamIndicator = document.createElement("div");
beamIndicator.textContent = "≋ HIGH BEAM";
beamIndicator.hidden = true;
beamIndicator.style.cssText =
  "position:fixed;right:24px;bottom:calc(var(--touch-h, 0px) + 100px);color:#59aaff;background:#102341;padding:6px 10px;border-radius:6px;z-index:20;font:600 13px sans-serif;pointer-events:none";
document.body.append(beamIndicator);
