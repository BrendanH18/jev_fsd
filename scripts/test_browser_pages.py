"""Playwright checks for the in-browser suites against a running local app.

uv run --with playwright python scripts/test_browser_pages.py --url http://127.0.0.1:8322
Runs the /tests page (simulation, HUD and explorer assertions), the WebGL renderer assertions from
the simulator page, and a layout check that the pilot controls fit the HUD panel. Requires
Playwright and its Chromium browser (or --chromium /path/to/chromium).

--group runs one part, so CI can run them side by side (each takes about 5 minutes there):
pages (the /tests page, renderer and HUD layout), practice (Pothole season finishes) and parking
(Squeeze in finishes, debrief replay and simulation error recovery). Without it, all three run.
"""

import argparse
import sys

from playwright.sync_api import sync_playwright

# Software WebGL (SwiftShader) is slow; the first simulator frame can take a while on CI runners.
TIMEOUT_MS = 240_000

# Rules | Decision ▾ | LLM ▾ and the autopilot switch stay inside the panel's content box, and the
# pillar buttons share one line (the switch may wrap below them).
PILOT_ROW_FITS = """() => {
  const panel = document.querySelector('.hud-top-left'), style = getComputedStyle(panel), box = panel.getBoundingClientRect();
  const left = box.left + parseFloat(style.paddingLeft), right = box.right - parseFloat(style.paddingRight);
  const pillars = [...document.querySelectorAll('.pilot-row .segmented > button:not([hidden])')].map(b => b.getBoundingClientRect());
  const all = [...pillars, document.querySelector('#autopilot').getBoundingClientRect()];
  const inside = all.every(r => r.width > 0 && r.left >= left - 0.5 && r.right <= right + 0.5);
  const oneLine = pillars.every(r => Math.abs(r.top - pillars[0].top) < 1);
  return [{ name: 'Rules, Decision and LLM with their menus, and the autopilot switch, fit the HUD panel', ok: pillars.length === 5 && inside && oneLine,
    detail: JSON.stringify({ content: [Math.round(left), Math.round(right)], rects: all.map(r => [Math.round(r.left), Math.round(r.right), Math.round(r.top)]) }) }];
}"""

# Exercise the real finish hook, using fresh authored challenges rather than synthetic reports.
PRACTICE_FINISH = """async kind => {
  const { PRACTICE_KEY, readPractice, challengeFailures } = await import('/js/lab/practice.js');
  const { HISTORY_KEY } = await import('/js/sim/drive-score.js');
  const keys = [PRACTICE_KEY, HISTORY_KEY], before = keys.map(key => localStorage.getItem(key));
  try {
    keys.forEach(key => localStorage.removeItem(key));
    const app = window.__jev;
    let keptFailedDrive = true, errorFinishAvailable = true;
    if (kind === 'resume') {
      app.world.violations.collisions++;
      app.world.paused = false; app.advance(0.05); // Sample the injected violation before finishing.
      app.finishDrive('finished');
      app.driveReport.dialog.close();
      await new Promise(resolve => setTimeout(resolve, 0));
      app.world.paused = false;
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w' }));
      app.advance(0.1);
      window.dispatchEvent(new KeyboardEvent('keyup', { key: 'w' }));
      const route = app.world.route, [x, y] = route.pointAt(route.length);
      Object.assign(app.world.ego, { x, y, psi: route.headingAt(route.length), v: 0, a: 0 });
      route.hint = route.pts.length - 2;
      app.advance(0.1);
      const reports = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
      const record = readPractice().records['pothole-season'];
      return [{ name: 'Finishing and resuming cannot erase the original failed attempt', ok: reports.length === 2
        && reports[1].collisions === 1 && reports[0].status === 'arrived' && reports[0].title === 'Free drive'
        && reports[0].modified === true && record?.attempts === 1 && record.completed === false,
        detail: JSON.stringify({ reports: reports.map(r => ({ title: r.title, status: r.status, modified: r.modified, collisions: r.collisions })), record }) }];
    }
    const parking = ['parked', 'wide-kerb', 'outside-space', 'simulation-error'].includes(kind);
    if (kind === 'early') {
      app.world.paused = false;
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w' }));
      app.advance(2);
      window.dispatchEvent(new KeyboardEvent('keyup', { key: 'w' }));
    }
    if (kind === 'modified') app.setTime('morning');
    if (kind === 'branched') app.recorder.branched = true;
    if (parking) {
      const { spacesAlong } = await import('/js/sim/parallel-park.js');
      const car = app.world.ego, space = spacesAlong(app.world, app.world.route, car.spec)[0];
      const u = kind === 'outside-space' ? space.sTo + car.spec.length : space.goalU;
      const w = space.goalW - (kind === 'wide-kerb' ? 1 : 0);
      Object.assign(car, { x: space.ox + u * Math.cos(space.h) + w * Math.sin(space.h),
        y: space.oy + u * Math.sin(space.h) - w * Math.cos(space.h), psi: space.h, v: 0 });
      if (kind === 'simulation-error') {
        app.world.parked.step = () => { throw new Error('Injected parked drive failure'); };
        app.world.paused = false; app.advance(0.1);
        const failedDrive = app.drive, failedRoute = app.world.route;
        await app.setDestination(failedRoute.pointAt(failedRoute.length));
        keptFailedDrive = app.drive === failedDrive && app.world.route === failedRoute;
        app.driveReport.lastUpdate = -Infinity; app.driveReport.update(app.drive);
        errorFinishAvailable = !app.driveReport.finishButton.disabled;
        app.driveReport.finishButton.click();
      } else {
        app.finishDrive('finished');
      }
    } else if (kind === 'arrived') {
      const route = app.world.route, [x, y] = route.pointAt(route.length);
      Object.assign(app.world.ego, { x, y, psi: route.headingAt(route.length), v: 0 });
      route.hint = route.pts.length - 2;
      app.world.paused = false; app.advance(0.1);
    } else app.finishDrive(kind === 'early' ? 'finished' : 'arrived');
    const report = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]')[0];
    const record = readPractice().records[parking ? 'parallel-park' : 'pothole-season'];
    const allowed = (['early', 'arrived'].includes(kind) || parking) && kind !== 'simulation-error';
    const completed = ['arrived', 'parked'].includes(kind);
    return [{ name: `Manual practice finish integration: ${kind}`, ok: !!report
      && report.status === (kind === 'simulation-error' ? 'error' : kind === 'early' || parking && !completed ? 'finished' : 'arrived')
      && (allowed ? record?.attempts === 1 && record.completed === completed : !record)
      && (kind !== 'simulation-error' || report.simulation_error === 'Injected parked drive failure'
        && keptFailedDrive && errorFinishAvailable && app.driveReport.finishButton.disabled
        && report.parking?.result !== 'parked' && challengeFailures({ park: true }, report).includes('simulation error'))
      && (kind !== 'modified' || report.modified === true)
      && (kind !== 'branched' || report.branched === true)
      && (kind !== 'rules' || report.driver === 'rules'),
      detail: JSON.stringify({ status: report?.status, driver: report?.driver, modified: report?.modified, branched: report?.branched, keptFailedDrive, errorFinishAvailable, record }) }];
  } finally {
    keys.forEach((key, i) => before[i] === null ? localStorage.removeItem(key) : localStorage.setItem(key, before[i]));
  }
}"""


# Exercise the actual report wiring, including a button rendered before a branch.
DEBRIEF_REPLAY = """async () => {
  const app = window.__jev;
  // Renderer assertions run separately. Avoid queuing software-GPU draws while stepping and
  // restoring checkpoints in this report-wiring fixture; leave the replay handlers intact.
  const render = app.view.render;
  app.view.render = () => {};
  try {
  app.world.paused = false; app.advance(8);
  app.drive.incident('test', 'Test incident');
  app.advance(2); app.finishDrive('finished');
  const { readHistory } = await import('/js/sim/drive-score.js');
  const report = readHistory()[0], incident = report.incidents[0], frames = app.recorder.frames;
  const eventTime = frames[0].t - frames[0].state.drive.elapsed + incident.at_s;
  app.driveReport.dialog.querySelector('details').open = true;
  const button = app.driveReport.dialog.querySelector('.incident-replay');
  button.focus(); const focused = document.activeElement === button;
  button.click();
  const chosen = frames[Number(app.lab.slider.value)].t;
  const replay = focused && app.lab.reviewing && !app.lab.playing && app.world.paused
    && !app.driveReport.dialog.open && eventTime - chosen >= 3 - 1e-6 && eventTime - chosen < 3.6;
  app.driveReport.show(report);
  const oldButton = app.driveReport.dialog.querySelector('.incident-replay');
  app.recorder.branch(0); oldButton.click();
  const revalidated = app.driveReport.dialog.open && !app.lab.playing
    && app.driveReport.dialog.textContent.includes('Replay unavailable');
  app.driveReport.showHistory(); app.driveReport.dialog.querySelector('.history-entry').click();
  const history = app.driveReport.dialog.textContent.includes('Replay unavailable')
    && !app.driveReport.dialog.querySelector('.incident-replay');
  app.recorder.reset(); app.driveReport.show(report);
  const replaced = app.driveReport.dialog.textContent.includes('Replay unavailable')
    && !app.driveReport.dialog.querySelector('.incident-replay');
  return [{ name: 'Real report opens paused replay before incident', ok: replay,
    detail: JSON.stringify({ focused, eventTime, chosen }) },
    { name: 'A stale incident button revalidates after branching', ok: revalidated },
    { name: 'History and replaced recordings do not seek discarded events', ok: history && replaced }];
  } finally {
    app.view.render = render;
  }
}"""


def report(label, results):
    failed = [r for r in results if not r.get("ok")]
    for r in failed:
        print("FAIL %s: %s %s" % (label, r.get("name"), r.get("detail") or ""), flush=True)
    print("%s: %d/%d passed" % (label, len(results) - len(failed), len(results)), flush=True)
    return not failed and len(results) > 0


def check_published_replay(page, url):
    writes = []
    page.on("request", lambda request: writes.append(request.url) if request.method == "POST" else None)
    page.goto(url + "#replay-heading", wait_until="domcontentloaded", timeout=TIMEOUT_MS)
    page.get_by_text("committed runs,", exact=False).wait_for()
    heading_visible = page.locator("#replay-heading").evaluate(
        "heading => heading.getBoundingClientRect().bottom > 0 && heading.getBoundingClientRect().top < innerHeight"
    )
    replay = page.locator("#published-replay")
    canvas = replay.get_by_role("img")
    play = replay.get_by_role("button", name="Play replay", exact=True)
    play.wait_for()
    first = canvas.evaluate("canvas => canvas.toDataURL()")
    play.click()
    page.wait_for_function("Number(document.querySelector('#published-replay input').value) > 0.3")
    replay.get_by_role("button", name="Pause replay").click()
    slider = replay.get_by_role("slider", name="Replay time")
    seek_trigger = "slider => { slider.value = 5; slider.dispatchEvent(new Event('input')); }"
    slider.evaluate(seek_trigger)
    assert replay.get_by_role("status").inner_text() == "Cross traffic released"
    slider.press("End")
    ended = replay.get_by_role("status").inner_text() == "Reached the destination"
    changed = first != canvas.evaluate("canvas => canvas.toDataURL()")
    replay.get_by_role("button", name="Play again").click()
    page.wait_for_function("Number(document.querySelector('#published-replay input').value) < 1")
    slider.evaluate("slider => { slider.value = Number(slider.max) - 0.25; slider.dispatchEvent(new Event('input')); }")
    play.click()
    replay.get_by_role("button", name="Play again").wait_for()
    reached_last_frame = slider.input_value() == slider.get_attribute("max")
    select = replay.get_by_role("combobox", name="Published drive")
    for drive, verdict, flag, trigger in [
        ("claude-haiku-flagger", "Fail", "runs_flagger_stop", "Oncoming traffic enters the work zone"),
        ("jev-flagger", "Pass", None, "Oncoming traffic enters the work zone"),
        ("jev-unprotected-left", "Pass", "fails_to_yield_to_oncoming", "Oncoming traffic released"),
    ]:
        select.select_option(drive)
        replay.get_by_text(f"Open track · {verdict}", exact=False).wait_for()
        play.click()
        page.wait_for_function("Number(document.querySelector('#published-replay input').value) > 0.3")
        slider.evaluate(seek_trigger)
        assert replay.get_by_role("status").inner_text() == trigger
        if flag:
            replay.get_by_role("button", name="Flagged at").first.click()
            replay.get_by_text(f"Flagged: {flag}", exact=False).wait_for()
    page.route("**/jev-flagger.json", lambda route: route.fulfill(status=503))
    select.select_option("jev-flagger")
    replay.get_by_text("Could not load the browser replay. Request failed (503).", exact=True).wait_for()
    assert canvas.count() == 0
    page.unroute("**/jev-flagger.json")
    return report(
        "published browser replay",
        [
            {
                "name": "Play, pause, seek, restart and finish the recorded drive without a POST",
                "ok": heading_visible and ended and changed and reached_last_frame and not writes,
            }
        ],
    )


def check_incident_comparison(page):
    replay_requests = []
    page.on("request", lambda req: replay_requests.append(req.url) if "/replays/" in req.url else None)
    page.evaluate("""() => {
      const app = window.__jev;
      app.world.paused = false;
      window.dispatchEvent(new KeyboardEvent('keydown', {key: 'w'}));
      app.advance(9);
      window.dispatchEvent(new KeyboardEvent('keyup', {key: 'w'}));
      app.finishDrive('finished');
    }""")
    dialog = page.get_by_role("dialog", name="Drive report")
    print("Recorded events:", dialog.locator(".incident-replay").all_text_contents(), flush=True)
    stop = dialog.locator(".incident-replay").filter(has_text="Missed stop").first
    stop.wait_for(state="attached")
    stop.locator("xpath=ancestor::details").evaluate("d => d.open = true")
    print("Manual incident:", stop.inner_text(), flush=True)
    assert not replay_requests
    model = page.get_by_role("complementary", name="Model incident replay")
    page.route("**/jev-flagger.json", lambda route: route.fulfill(status=503))
    stop.locator("..").get_by_role("button", name="Compare with Jev").click()
    retry = stop.locator("..").get_by_role("button", name="Model replay unavailable")
    retry.wait_for()
    assert dialog.is_visible() and model.count() == 0 and page.evaluate("!window.__jev.lab.reviewing")
    page.unroute("**/jev-flagger.json")
    retry.click()
    model.get_by_text("Matched by elapsed challenge time", exact=False).wait_for()
    print("Aligned model view:", model.inner_text(), flush=True)
    assert len(replay_requests) == 2 and all(url.endswith("/jev-flagger.json") for url in replay_requests)
    assert model.get_by_text("Open track · Pass", exact=False).is_visible()
    deck = page.get_by_role("region", name="Recorded drive replay")
    # Step the replay clock through the event in one browser task so software WebGL
    # cannot skip to the end while Playwright is waiting to press Pause.
    incident_time = float(model.locator("strong").inner_text().split()[-2])
    sync = deck.evaluate(
        """(deck, incidentTime) => {
      const lab = window.__jev.lab, play = deck.querySelector('.replay-buttons button');
      play.click();
      const start = lab.recorder.frames[Number(lab.slider.value)].state.drive.elapsed;
      lab.update(lab.recorder, lab.lastTick + (incidentTime - start) * 1000);
      play.click();
      const elapsed = lab.recorder.frames[Number(lab.slider.value)].state.drive.elapsed + lab.replayElapsed;
      return [elapsed, document.querySelector('.incident-model .published-replay-readout').textContent];
    }""",
        incident_time,
    )
    print("Paused manual time and model readout:", sync, flush=True)
    assert abs(sync[0] - incident_time) < 0.01 and sync[1].startswith(f"{sync[0]:.1f} /"), sync
    reset_guard, rewind, model_time = deck.evaluate("""deck => {
      const {lab, world} = window.__jev;
      const ego = () => [world.ego.x, world.ego.y, world.ego.psi, world.ego.v];
      const before = ego();
      window.dispatchEvent(new KeyboardEvent('keydown', {key: 'r'}));
      window.dispatchEvent(new KeyboardEvent('keyup', {key: 'r'}));
      const resetGuard = ego().every((value, i) => value === before[i]);
      const slider = deck.querySelector('input[type="range"]');
      slider.value = Math.max(0, Number(slider.value) - 2);
      slider.dispatchEvent(new Event('input'));
      lab.update(lab.recorder, performance.now());
      const elapsed = lab.recorder.frames[Number(slider.value)].state.drive.elapsed;
      return [resetGuard, elapsed, document.querySelector('.incident-model .published-replay-readout').textContent];
    }""")
    assert reset_guard
    assert rewind < sync[0] and model_time.startswith(f"{rewind:.1f} /"), (rewind, model_time)
    deck.get_by_role("button", name="Return to drive").click()
    assert not model.is_visible()

    page.evaluate("""async () => {
      const {readHistory} = await import('./js/sim/drive-score.js');
      const fetchReplay = window.fetch;
      window.fetch = (url, options) => {
        if (!String(url).endsWith('/jev-flagger.json')) return fetchReplay(url, options);
        window.pendingIncidentReplay = options.signal;
        return new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () => {
            window.fetch = fetchReplay;
            reject(options.signal.reason);
          }, {once: true});
        });
      };
      window.__jev.driveReport.show(readHistory()[0]);
    }""")
    stop.locator("xpath=ancestor::details").evaluate("d => d.open = true")
    compare = stop.locator("..").get_by_role("button", name="Compare with Jev")
    pending_button = compare.element_handle()
    compare.click()
    page.wait_for_function("!!window.pendingIncidentReplay")
    page.evaluate("window.__jev.driveReport.dialog.close()")
    page.wait_for_function("window.pendingIncidentReplay.aborted")
    page.wait_for_function("button => !button.disabled", arg=pending_button)
    assert page.evaluate("!window.__jev.lab.reviewing") and not model.is_visible()

    negatives = page.evaluate("""async () => {
      const app = window.__jev, { readHistory } = await import('./js/sim/drive-score.js');
      const report = readHistory()[0], outcomes = [];
      const {challengeById, challengeConfig} = await import('./js/lab/challenges.js');
      const unexported = challengeConfig(challengeById('pothole-season'));
      for (const [name, config] of [['changed map data', {map_sha:'changed'}], ['old pack', {pack:'5'}], ['old author version', {version:2}], ['wrong map', {map:'toronto'}], ['different seed', {seed:0}], ['different weather', {weather:'rain'}], ['different time', {time:'night'}], ['no exported drive', unexported]]) {
        app.driveReport.show({...report, config: {...report.config, ...config}});
        outcomes.push([name, app.driveReport.dialog.querySelectorAll('.incident-replay').length,
          app.driveReport.dialog.textContent.includes('Compare with Jev')]);
      }
      app.recorder.reset();
      app.driveReport.show(report);
      outcomes.push(['recording discarded', app.driveReport.dialog.querySelectorAll('.incident-replay').length,
        app.driveReport.dialog.textContent.includes('Compare with Jev')]);
      return outcomes;
    }""")
    print("Nonmatches (rewinds, compare offered):", negatives, flush=True)
    assert all(n > 0 and not offered for _, n, offered in negatives[:-1])
    assert negatives[-1][1:] == [0, False] and len(replay_requests) == 2


GROUPS = ["pages", "practice", "parking"]
# Practice finish fixtures by the challenge they drive; the parking ones end in Squeeze in.
PRACTICE_KINDS = ["early", "arrived", "rules", "modified", "branched", "resume"]
PARKING_KINDS = ["parked", "wide-kerb", "outside-space", "simulation-error"]


def check(url, chromium=None, groups=GROUPS):
    ok = True
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            executable_path=chromium,
            args=["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
        )
        errors = []

        def open_page(path, render=True):
            # The app's CSP forbids eval, which Playwright's wait/evaluate helpers rely on.
            page = browser.new_page(viewport={"width": 1440, "height": 900}, bypass_csp=True)
            page.on("pageerror", lambda error: errors.append(str(error)))
            if path is not None:
                page.goto(url.rstrip("/") + path, wait_until="domcontentloaded", timeout=TIMEOUT_MS)
                page.wait_for_function("!!window.__jev?.advance", timeout=TIMEOUT_MS)
                # Report and replay wiring needs no 3D view. Each software-WebGL frame queued here
                # (advance() draws one per step) holds up the next page until the GPU process has
                # drawn it: up to 6 minutes after a 2 s advance.
                if not render:
                    page.evaluate("() => { window.__jev.view.render = () => {}; }")
            return page

        if "pages" in groups:
            page = open_page(None)
            ok &= check_published_replay(page, url.rstrip("/") + "/results")
            page.goto(url.rstrip("/") + "/tests")
            page.wait_for_function("Array.isArray(window.__results)", timeout=TIMEOUT_MS)
            ok &= report("browser tests", page.evaluate("window.__results"))

            page.goto(url.rstrip("/") + "/")
            page.wait_for_function("!!window.__jev?.view", timeout=TIMEOUT_MS)
            page.evaluate("window.__jev.advance(1)")
            results = page.evaluate("import('/tests/render-tests.js').then(m => m.runRenderTests())")
            ok &= report("renderer tests", results)
            ok &= report("HUD layout", page.evaluate(PILOT_ROW_FITS))
            page.close()  # Release the renderer's software-WebGL workload before the finish fixtures.

        kinds = (PRACTICE_KINDS if "practice" in groups else []) + (PARKING_KINDS if "parking" in groups else [])
        for kind in kinds:
            driver = "rules" if kind == "rules" else "manual"
            challenge = "parallel-park" if kind in PARKING_KINDS else "pothole-season"
            page = open_page(f"/?challenge={challenge}&drive={driver}&quality=low", render=False)
            page.evaluate("window.__jev.world.paused = true")
            ok &= report("practice integration", page.evaluate(PRACTICE_FINISH, kind))
            comparison = page.locator(".drive-comparison")
            if kind in ("arrived", "early", "parked"):
                comparison.locator("tbody tr").nth(3).wait_for(timeout=TIMEOUT_MS)
                assert comparison.locator("tbody th").all_text_contents() == ["You", "Rules", "Jev", "Claude Haiku 5.5"]
                assert comparison.locator("tbody td").nth(0).inner_text() == ("Fail" if kind == "early" else "Pass")
                if kind == "early":
                    score = comparison.locator("tbody tr").first.locator("td").nth(2).inner_text()
                    assert float(score) > 0, score
                    published = comparison.locator("tbody tr:not(:first-child) td:nth-of-type(3)").all_text_contents()
                    assert published[0] == "Unavailable", published
                    assert all(0 <= float(value) <= 100 for value in published[1:]), published
            elif kind in ("rules", "branched", "modified"):
                assert comparison.count() == 0
            page.close()

        if "practice" in groups:
            page = open_page("/?challenge=flagger&drive=manual&quality=low", render=False)
            check_incident_comparison(page)
            page.close()

            page = open_page("/?challenge=bus-lanes&drive=manual&quality=low&weekday=6", render=False)
            assert page.evaluate("window.__jev.world.clock.weekday") == 0
            assert page.evaluate("""() => {
              const app = window.__jev, before = app.world.t;
              app.drive.metrics.record = () => { throw new Error('Injected benchmark sampling failure'); };
              app.world.paused = false;
              app.advance(0.2);
              return app.world.t > before && app.drive.metrics === null && app.simulationError === null;
            }""")
            page.evaluate("window.__jev.finishDrive('finished')")
            assert page.locator(".drive-comparison tbody tr").first.locator("td").nth(2).inner_text() == "Unmeasured"
            page.close()

            page = open_page("/?challenge=road-test-kitsilano&drive=manual&quality=low", render=False)
            page.evaluate("window.__jev.finishDrive('finished')")
            comparison = page.locator(".drive-comparison")
            comparison.locator("tbody tr").nth(3).wait_for(timeout=TIMEOUT_MS)
            assert comparison.get_by_role("columnheader", name="Benchmark verdict").is_visible()
            assert "The examiner’s sheet determines road-test completion." in comparison.inner_text()
            assert comparison.locator("tbody td").first.inner_text() == "Fail"
            assert comparison.locator("tbody tr:not(:first-child) td:nth-of-type(3)").all_text_contents() == [
                "Unavailable",
                "Unavailable",
                "Unavailable",
            ]

            for endpoint in ("**/api/results", "**/demo-data/results.json"):
                page.route(endpoint, lambda route: route.fulfill(status=503))
            page.evaluate("""async () => {
              const { readHistory } = await import('/js/sim/drive-score.js');
              window.__jev.driveReport.show(readHistory()[0]);
            }""")
            comparison.get_by_text("Published comparisons could not be loaded.", exact=True).wait_for(
                timeout=TIMEOUT_MS
            )
            assert comparison.get_by_text(
                "The examiner’s sheet determines road-test completion.", exact=True
            ).is_visible()
            assert comparison.locator("tbody th").all_text_contents() == ["You"]
            page.close()

        if "parking" in groups:
            page = open_page("/?challenge=pothole-season&drive=manual&quality=low")
            ok &= report("debrief replay integration", page.evaluate(DEBRIEF_REPLAY))
            page.close()

            page = open_page("/?challenge=door-zone&drive=rules&quality=low")
            page.evaluate("""() => {
              const app = window.__jev, render = app.view.render.bind(app.view);
              window.__containedRenders = 0;
              app.view.render = (...args) => { window.__containedRenders++; return render(...args); };
              app.world.parked.step = () => { throw new Error('Injected simulation step failure'); };
              app.world.paused = false;
            }""")
            # Let the actual animation loop encounter the throw, and prove it keeps rendering afterwards.
            page.wait_for_selector("#simulation-error", timeout=TIMEOUT_MS)
            page.wait_for_function("window.__containedRenders >= 3", timeout=TIMEOUT_MS)
            ok &= report(
                "simulation error containment",
                page.evaluate("""() => {
              const app = window.__jev, tick = app.world.tick;
              document.querySelector('#pause-world').click();
              document.querySelector('#autopilot').click();
              app.advance(0.1);
              document.querySelector('#settings-toggle').click();
              return [{ name: 'A thrown step pauses the drive, explains the error and leaves controls usable',
                ok: app.world.paused && !app.autopilot.enabled && app.world.tick === tick
                  && app.simulationError === 'Injected simulation step failure'
                  && document.querySelector('#simulation-error').textContent.includes(app.simulationError)
                  && !document.querySelector('#settings').hidden,
                detail: JSON.stringify({ tick, after: app.world.tick, paused: app.world.paused, error: app.simulationError }) }];
            }"""),
            )
            page.get_by_role("button", name="Restart drive", exact=True).click(timeout=TIMEOUT_MS)
            page.wait_for_function("!!window.__jev?.advance && !window.__jev.simulationError", timeout=TIMEOUT_MS)
            ok &= report(
                "simulation error restart",
                page.evaluate("""() => {
              const app = window.__jev, tick = app.world.tick;
              app.world.paused = false; app.advance(0.1);
              return [{ name: 'Restart replaces the broken world with a drive that steps again',
                ok: app.world.tick > tick && !app.simulationError && !document.querySelector('#simulation-error') }];
            }"""),
            )
            page.close()

        if errors:
            ok = False
            print("Page errors:\n  " + "\n  ".join(errors))
        browser.close()
    return ok


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:8322")
    parser.add_argument("--chromium")
    parser.add_argument("--group", choices=GROUPS, help="run only this part")
    args = parser.parse_args()
    sys.exit(0 if check(args.url, args.chromium, [args.group] if args.group else GROUPS) else 1)
