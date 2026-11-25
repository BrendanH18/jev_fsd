"""Playwright checks for the in-browser suites against a running local app.

uv run --with playwright python scripts/test_browser_pages.py --url http://127.0.0.1:8322
Runs the /tests page (simulation, HUD and explorer assertions), the WebGL renderer assertions from
the simulator page, and a layout check that the pilot controls fit the HUD panel. Requires
Playwright and its Chromium browser (or --chromium /path/to/chromium).

--group runs one part, so CI can run them side by side (each takes about 5 minutes there):
pages (the /tests page, renderer and HUD layout), practice (Pothole season finishes) and parking
(Squeeze in finishes, debrief replay and simulation error recovery). Without it, all three run.
Use --group ui to run just the driving app controls and startup recovery from the pages group.
"""

import argparse
import csv
import json
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
  const { readHistory, saveDrive } = await import('/js/sim/drive-score.js');
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
  app.driveReport.showHistory();
  const deleteDrive = app.driveReport.dialog.querySelector('.history-delete');
  saveDrive({ ...report, title: 'Drive saved while history was open' });
  deleteDrive.click();
  const keptNewDrive = readHistory()[0]?.title === 'Drive saved while history was open'
    && app.driveReport.dialog.querySelector('.history-entry').textContent.includes('Drive saved while history was open');
  app.recorder.reset(); app.driveReport.show(report);
  const replaced = app.driveReport.dialog.textContent.includes('Replay unavailable')
    && !app.driveReport.dialog.querySelector('.incident-replay');
  return [{ name: 'Real report opens paused replay before incident', ok: replay,
    detail: JSON.stringify({ focused, eventTime, chosen }) },
    { name: 'A stale incident button revalidates after branching', ok: revalidated },
    { name: 'History and replaced recordings do not seek discarded events', ok: history && replaced },
    { name: 'Deleting a drive retains newer history entries', ok: keptNewDrive }];
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
    driver_header = page.locator("#results-challenges thead th").nth(1)
    sort_button = driver_header.get_by_role("button")
    sort_button.focus()
    for direction in ("descending", "ascending", "none"):
        page.keyboard.press("Enter")
        assert driver_header.get_attribute("aria-sort") == direction
        assert sort_button.evaluate("button => button === document.activeElement")
    city = page.locator("#results-city")
    coverage = city.get_by_role("combobox", name="Coverage")
    coverage.select_option("complete")
    assert city.locator("tbody tr").count() == 1
    assert "not run" not in city.locator("tbody").inner_text()
    coverage.select_option("missing")
    assert city.locator("tbody tr").count() > 1
    assert all("not run" in row for row in city.locator("tbody tr").all_inner_texts())
    coverage.select_option("")
    # Lab item: Preserve the active suite in the leaderboard URL when its picker changes.
    page.locator("#results-version").evaluate("(select) => { select.dispatchEvent(new Event('change')); }")
    assert (
        page.evaluate("new URL(location.href).searchParams.get('suite')")
        == page.locator("#results-version").input_value()
    )
    replay = page.locator("#published-replay")
    canvas = replay.get_by_role("img", name="Overhead street map of the recorded drive")
    play = replay.get_by_role("button", name="Play replay", exact=True)
    play.wait_for()
    first = canvas.evaluate("canvas => canvas.toDataURL()")
    play.click()
    page.wait_for_function("Number(document.querySelector('#published-replay input').value) > 0.3")
    replay.get_by_role("button", name="Pause replay").click()
    slider = replay.get_by_role("slider", name="Replay time")
    replay.get_by_role("combobox", name="Playback speed").select_option("2")
    slider.press("Home")
    replay.get_by_role("button", name="+1 s", exact=True).click()
    assert float(slider.input_value()) == 1
    replay.get_by_role("img", name="Ego vehicle speed over time").click()
    assert abs(float(slider.input_value()) / float(slider.get_attribute("max")) - 0.5) < 0.02
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
            replay.get_by_role("button", name="Next flag", exact=True).click()
            replay.get_by_text(f"Flagged: {flag}", exact=False).wait_for()
    page.route("**/jev-flagger.json", lambda route: route.fulfill(status=503))
    select.select_option("jev-flagger")
    replay.get_by_text("Could not load the browser replay. Request failed (503).", exact=True).wait_for()
    assert canvas.count() == 0
    page.unroute("**/jev-flagger.json")
    replay.get_by_role("button", name="Retry replay").click()
    replay.get_by_text("Open track · Pass", exact=False).wait_for()
    recovered = canvas.count() == 1 and select.input_value() == "jev-flagger"
    replay.get_by_role("button", name="Next decision", exact=True).click()
    highlighted = replay.locator(".published-replay-log button[aria-current=step]").count() == 1
    lifecycle = page.evaluate("""async () => {
      const player = document.querySelector('.published-replay-player');
      const button = player.querySelector('.published-replay-bar button');
      button.click();
      Object.defineProperty(document, 'hidden', { value: true, configurable: true });
      try { document.dispatchEvent(new Event('visibilitychange')); }
      finally { delete document.hidden; }
      const hidden = button.textContent === 'Play replay';
      button.click();
      player.remove();
      await new Promise(requestAnimationFrame);
      return { hidden, removed: button.textContent === 'Play replay' };
    }""")
    check_result_controls(page, url)
    check_published_debrief(page, url)
    return report(
        "published browser replay",
        [
            {
                "name": "Play, pause, seek, restart and finish the recorded drive without a POST",
                "ok": heading_visible and ended and changed and reached_last_frame and not writes,
            },
            {"name": "Retry loads the selected drive without changing it", "ok": recovered},
            {"name": "The active decision history entry exposes its current step", "ok": highlighted},
            {"name": "Switching tabs pauses replay immediately", "ok": lifecycle["hidden"]},
            {"name": "Removing a replay stops its animation", "ok": lifecycle["removed"]},
        ],
    )


def check_result_controls(page, url):
    page.goto(url + "?replay=jev-flagger&at=12.345&city-weather=rain#replay-heading")
    city = page.locator("#results-city")
    city.get_by_role("combobox", name="Filter by weather").wait_for()
    assert city.get_by_role("combobox", name="Filter by weather").input_value() == "rain"
    assert city.locator("tbody tr").count() == 1
    with page.expect_download() as event:
        city.get_by_role("button", name="Export CSV").click()
    with event.value.path().open(encoding="utf-8-sig") as saved:
        headers, row = list(csv.reader(saved))
    assert headers[:4] == ["Map", "Map ID", "Weather", "Suite version"]
    assert row[1:3] == ["kitsilano", "rain"]
    assert any(label.endswith(" total") for label in headers)
    with page.expect_download() as event:
        city.get_by_role("button", name="Export JSON").click()
    with event.value.path().open(encoding="utf-8") as saved:
        payload = json.load(saved)
    assert payload["filters"]["weather"] == "rain"
    assert payload["rows"][0]["map_name"] == "Kitsilano"
    city.get_by_role("button", name="Reset filters").click()
    assert page.evaluate("document.activeElement.getAttribute('aria-label')") == "Search city or weather"
    assert page.evaluate("!new URL(location.href).searchParams.has('city-weather')")
    replay = page.locator("#published-replay")
    select = replay.get_by_role("combobox", name="Published drive")
    slider = replay.get_by_role("slider", name="Replay time")
    slider.wait_for()
    assert select.input_value() == "jev-flagger"
    assert float(slider.input_value()) == 12.345
    assert replay.get_by_role("combobox", name="Playback speed").locator("option[value='0.25']").count() == 1
    replay.get_by_role("button", name="Start", exact=True).click()
    assert float(slider.input_value()) == 0
    replay.get_by_role("button", name="Next event", exact=True).click()
    assert float(slider.input_value()) > 0
    replay.get_by_role("button", name="End", exact=True).click()
    assert slider.input_value() == slider.get_attribute("max")
    with page.expect_download() as event:
        replay.get_by_role("button", name="Download replay JSON").click()
    assert event.value.suggested_filename == "jev-flagger-replay.json"
    with event.value.path().open(encoding="utf-8") as saved:
        assert json.load(saved)["challenge"] == "flagger"
    terminal = page.locator("#results-replay")
    terminal.get_by_role("searchbox", name="Search terminal replays").fill("no-such-recording")
    assert terminal.get_by_role("status").inner_text() == "No terminal replays match."
    challenges = page.locator("#results-challenges")
    open_track = page.locator("#results-open")
    kinds = challenges.get_by_role("combobox", name="Drive type")
    kinds.select_option("road-test")
    assert all("Road test" in title for title in challenges.locator("tbody th").all_text_contents())
    assert challenges.locator("tbody tr").count() > 1
    challenges.get_by_role("combobox", name="Filter by map").select_option("kitsilano")
    assert challenges.locator("tbody tr").count() == 1
    assert "Kitsilano" in challenges.locator("tbody tr").inner_text()
    challenges.get_by_role("combobox", name="Driver column sort metric").select_option("duration")
    challenges.get_by_role("button", name="Rules", exact=True).click()
    assert challenges.get_by_role("columnheader", name="Rules").get_attribute("aria-sort") == "ascending"
    with page.expect_download() as event:
        challenges.get_by_role("button", name="Export JSON").click()
    with event.value.path().open(encoding="utf-8") as saved:
        payload = json.load(saved)
    assert payload["track"] == "guarded"
    assert payload["filters"]["sort"] == "driver-rules"
    assert payload["rows"][0]["kind"] == "road-test"
    assert payload["rows"][0]["map_name"] == "Kitsilano"
    with page.expect_download() as event:
        challenges.get_by_role("button", name="Export CSV").click()
    with event.value.path().open(encoding="utf-8-sig") as saved:
        headers, row = list(csv.reader(saved))
    assert row[2:7] == ["road test", "Kitsilano", "kitsilano", "guarded", payload["version"]]
    assert "Rules failures" in headers and "Rules path score" in headers
    challenges.get_by_role("button", name="Reset filters").click()
    outcome = challenges.get_by_role("combobox", name="Result outcome")
    outcome.select_option("fail")
    assert challenges.locator("tbody tr").count() > 0
    assert challenges.locator("tbody tr").count() == challenges.locator("tbody tr:has(.fail)").count()
    outcome.select_option("pass")
    assert challenges.locator("tbody tr:has(.fail)").count() == 0
    outcome.select_option("split")
    assert challenges.locator("tbody tr").count() == challenges.locator("tbody tr:has(.pass):has(.fail)").count()
    open_track.get_by_role("combobox", name="Result outcome").select_option("flags")
    assert open_track.locator("tbody tr").count() > 0
    assert open_track.locator("tbody tr").count() == open_track.locator("tbody tr:has(.flagged-count)").count()
    assert (
        open_track.get_by_role("combobox", name="Driver column sort metric").locator("option[value='flags']").count()
        == 1
    )
    assert challenges.get_by_role("button", name="Map", exact=True).count() == 1
    assert city.get_by_role("combobox", name="City driver sort metric").locator("option").count() == 5

    page.evaluate("""() => Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: () => Promise.reject(new Error('denied')) },
      configurable: true
    })""")
    replay.get_by_role("button", name="Start", exact=True).click()
    replay.get_by_role("button", name="+1 s", exact=True).click()
    replay.get_by_role("button", name="Copy link to this moment").click()
    copied = replay.get_by_role("textbox", name="Link to replay moment")
    copied.wait_for()
    assert "replay=jev-flagger" in copied.input_value() and "at=1.000" in copied.input_value()
    assert copied.evaluate("(input) => input.selectionEnd === input.value.length")
    terminal.get_by_role("searchbox", name="Search terminal replays").fill("")
    terminal.get_by_role("button", name="Copy command").first.click()
    terminal.get_by_text("Use your keyboard to copy the selected command.", exact=True).wait_for()


def check_published_debrief(page, url):
    comparison = page.evaluate("""async () => {
      const { DriveReport } = await import(new URL('js/ui/drive-report.js', location.href).href);
      const { api } = await import(new URL('js/common.js', location.href).href);
      const data = await api('/api/results');
      const drive = data.rows.find((run) => run.suite === 'challenges' && run.driver === 'rules').drives[0];
      const challenge = { id: drive.id };
      const config = { ...drive, challenge: drive.id };
      const report = {
        config, elapsed_s: drive.time_s, status: 'arrived', incidents: [],
        collisions: 0, red_lights: 0, stop_signs: 0, failed_to_yield: 0, off_road_s: 0, resets: 0,
      };
      const build = (value) => {
        const section = DriveReport.prototype.comparison.call({}, challenge, value);
        document.body.append(section);
        return section;
      };
      const sections = [
        build({ ...report, config: { ...config, map_sha: undefined }, off_road_s: undefined }),
        build(report),
        build({ ...report, config: { ...config, map_sha: 'other' } }),
      ];
      for (let i = 0; i < 60 && sections[2].querySelectorAll('tbody tr').length < 4; i++)
        await new Promise((resolve) => setTimeout(resolve, 10));
      const [missing, matched, changed] = sections;
      const link = new URL(matched.querySelector('a').href);
      const observed = {
        unavailable: missing.querySelector('tbody td').textContent,
        missingFingerprint: missing.querySelector('[role=status]').textContent,
        query: link.searchParams.get('challenges-query'),
        jump: link.hash,
        challenge: drive.id,
        tied: matched.textContent.includes('Tied at this precision'),
        mismatched: changed.querySelector('[role=status]').textContent,
      };
      sections.forEach((section) => section.remove());
      return observed;
    }""")
    assert comparison["unavailable"] == "Unavailable"
    assert "no map fingerprint" in comparison["missingFingerprint"]
    assert comparison["query"] == comparison["challenge"] and comparison["jump"] == "#challenges-heading"
    assert comparison["tied"]
    assert "No guarded results match" in comparison["mismatched"]

    for endpoint in ("**/api/results", "**/demo-data/results.json"):
        page.route(endpoint, lambda route: route.fulfill(status=503))
    page.goto(url)
    retry = page.get_by_role("button", name="Retry results")
    retry.wait_for()
    for endpoint in ("**/api/results", "**/demo-data/results.json"):
        page.unroute(endpoint)
    retry.click()
    page.get_by_text("committed runs,", exact=False).wait_for()


def check_snapshot_form(page):
    # Let new decisions arrive both before the next paint and while the name field is open.
    page.evaluate("""() => {
        const app = window.__jev;
        app.view.render = () => {};
        if (app.lab.dialog.open) app.lab.dialog.close();
        window.showSnapshotDecision = label => app.autopilot.onDecision({
          meta: {}, candidates: [], questions: { vector: label }, state: { label }
        });
        window.showSnapshotDecision('displayed');
    }""")
    page.keyboard.press("i")
    page.wait_for_function("document.querySelector('#panel-body').textContent.includes('displayed')")
    page.evaluate("""() => {
        window.showSnapshotDecision('awaiting paint');
        document.querySelector('#save-snapshot').click();
        window.showSnapshotDecision('newer');
    }""")
    page.wait_for_function("document.querySelector('#panel-body').textContent.includes('newer')")
    page.route("**/api/snapshot/save", lambda route: route.fulfill(json={"saved": "fixture"}))
    page.locator("#panel-inline-input").fill("fixture")
    with page.expect_request("**/api/snapshot/save") as request:
        page.locator("#panel-inline-submit").click()
    payload = request.value.post_data_json
    assert payload["state"] == {"label": "displayed"}
    assert payload["questions"] == {"vector": "displayed"}
    print("Inspector snapshot kept the displayed decision", flush=True)
    copied = page.evaluate("""() => {
        let text;
        const writeText = navigator.clipboard.writeText;
        navigator.clipboard.writeText = (value) => { text = value; };
        try {
          window.showSnapshotDecision('awaiting another paint');
          document.querySelector('#copy-json').click();
          document.querySelector('#pin-decision').click();
          const state = JSON.parse(text);
          document.querySelector('#panel [data-tab="state"]').click();
          document.querySelector('#panel [data-tab="questions"]').click();
          document.querySelector('#copy-json').click();
          return [state, JSON.parse(text)];
        } finally {
          navigator.clipboard.writeText = writeText;
        }
    }""")
    assert copied == [{"label": "newer"}, {"vector": "newer"}], copied
    assert "newer" in page.locator("#panel-body").inner_text()
    page.locator("#pin-decision").click()
    page.wait_for_function("document.querySelector('#panel-body').textContent.includes('awaiting another paint')")
    print("Inspector copy and pin use the displayed decision", flush=True)


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


def check_library_progress(page):
    page.evaluate("""async () => {
      const { PRACTICE_KEY, ROAD_TEST_KEY } = await import('/js/lab/practice.js');
      const last_at = '2026-11-24T00:00:00Z';
      localStorage.setItem(PRACTICE_KEY, JSON.stringify({
        'door-zone': { version: 1, attempts: 2, completed: true, best_score: 92, last_at },
        'pothole-season': { version: 1, attempts: 1, completed: true, best_score: 75, last_at },
      }));
      localStorage.setItem(ROAD_TEST_KEY, JSON.stringify({
        'road-test-kitsilano': {
          version: 1, attempts: 3, passes: 2, last_at,
          best: { pass: true, demerits: 1, fails: 0, at: last_at },
        },
      }));
      window.__jev.lab.challenges();
    }""")
    # Lab item: See the best clean coaching score on a completed challenge card.
    assert "Best: 92/100" in page.locator('[data-challenge="door-zone"]').inner_text()
    # Lab item: See the pass count and attempt count together on each road-test card.
    assert "2/3 attempts passed" in page.locator('[data-road-test="road-test-kitsilano"]').inner_text()
    # Lab item: Sort challenges by best clean score with unscored attempts last.
    page.get_by_role("combobox", name="Sort challenges").select_option("score")
    cards = page.locator(".challenge-grid [data-challenge]")
    assert cards.nth(0).get_attribute("data-challenge") == "door-zone"
    assert cards.nth(1).get_attribute("data-challenge") == "pothole-season"


GROUPS = ["pages", "practice", "parking"]
# Practice finish fixtures by the challenge they drive; the parking ones end in Squeeze in.
PRACTICE_KINDS = ["early", "arrived", "rules", "modified", "branched", "resume"]
PARKING_KINDS = ["parked", "wide-kerb", "outside-space", "simulation-error"]


def check_driving_ui(page):
    """Exercise the wired controls without queueing extra software WebGL frames."""
    ok = report(
        "driving app controls",
        page.evaluate("""async () => {
          const app = window.__jev, $ = id => document.getElementById(id);
          const results = [];
          const check = (name, ok) => results.push({name, ok: !!ok});
          const key = (node, k, extra = {}) => node.dispatchEvent(new KeyboardEvent('keydown',
            { key: k, bubbles: true, cancelable: true, ...extra }));
          const change = node => node.dispatchEvent(new Event('change', {bubbles: true}));
          const settings = $('settings-toggle');
          app.view.render = () => {};
          app.world.paused = true;
          check('The road canvas becomes focusable only after startup', !$('view').inert);
          const cluster = $('speed-warning').closest('.cluster');
          cluster.classList.add('speeding'); $('speed-warning').hidden = false;
          check('Compact instruments keep the overspeed warning visible', $('speed-warning').getBoundingClientRect().height > 0);
          cluster.classList.remove('speeding'); $('speed-warning').hidden = true;
          settings.click();
          $('weather').focus();
          key($('weather'), 'Escape');
          check('Escape closes Settings even within a field', $('settings').hidden && document.activeElement === settings);
          settings.click();
          const volume = $('drive-volume');
          volume.value = '27'; volume.dispatchEvent(new Event('input'));
          check('Volume changes update the audio gain setting and accessible percentage', app.audio.volume === 0.27
            && volume.getAttribute('aria-valuetext') === '27 percent');
          check('Volume is saved as a numeric percentage', localStorage.getItem('jev-fsd-ui-volume') === '27');
          const deadzone = $('gamepad-deadzone');
          deadzone.value = '50'; deadzone.dispatchEvent(new Event('input'));
          check('The dead zone slider reaches 50 percent and announces the applied value',
            deadzone.value === '50' && deadzone.getAttribute('aria-valuetext') === '50 percent');
          const wipers = $('wipers');
          wipers.checked = false; change(wipers);
          check('Cabin wiper preference can remain off after reload', localStorage.getItem('jev-fsd-ui-wipers') === 'false');
          const motion = $('camera-motion');
          check('A fresh profile follows the system camera motion setting', !motion.checked && !app.view.cameraMotion);
          motion.checked = true; change(motion);
          check('An explicit camera motion choice can override the system setting', app.view.cameraMotion
            && localStorage.getItem('jev-fsd-ui-camera-motion') === '"on"');
          const shortcuts = $('letter-shortcuts');
          shortcuts.checked = false; change(shortcuts);
          $('view').focus(); key($('view'), 'c');
          check('Disabling letter shortcuts suppresses the camera shortcut', app.view.mode === 'chase');
          key($('view'), 'ArrowUp');
          check('Arrow driving stays available with single-character shortcuts disabled', app.input.throttle === 1);
          app.input.clear();
          shortcuts.checked = true; change(shortcuts);
          key($('view'), 'c', {isComposing: true});
          check('An input-method composition cannot change the camera', app.view.mode === 'chase');
          key($('view'), 'c', {repeat: true});
          check('Holding a shortcut does not cycle cameras repeatedly', app.view.mode === 'chase');

          const touchSetting = $('touch-setting');
          touchSetting.value = 'show'; change(touchSetting);
          check('Touch controls can be enabled without a touch screen', !app.touch.el.hidden && document.body.classList.contains('touch-driving'));
          $('left-handed-touch').checked = true; change($('left-handed-touch'));
          check('Swapping controls puts the accelerator side before the steering pad', app.touch.pedalEls.throttle.getBoundingClientRect().x
            < app.touch.wheel.getBoundingClientRect().x);
          const touchAction = name => app.touch.buttons.find(button => button.dataset.action === name);
          check('Touch-only actions expose the matching keyboard shortcuts',
            touchAction('horn').getAttribute('aria-keyshortcuts') === 'H'
            && touchAction('reset').getAttribute('aria-keyshortcuts') === 'R'
            && touchAction('camera').getAttribute('aria-keyshortcuts') === 'C');
          shortcuts.checked = false; change(shortcuts);
          check('Unavailable shortcuts are removed from main and touch controls',
            !$('camera-view').hasAttribute('aria-keyshortcuts') && !touchAction('horn').hasAttribute('aria-keyshortcuts'));
          shortcuts.checked = true; change(shortcuts);
          check('Re-enabling character keys restores touch shortcut hints',
            touchAction('signalLeft').getAttribute('aria-keyshortcuts') === 'Q'
            && touchAction('signalRight').getAttribute('aria-keyshortcuts') === 'E');
          app.advance(0.02);
          check('The touch pause button reflects the live paused state', touchAction('pause').getAttribute('aria-pressed') === 'true');
          touchAction('signalLeft').click(); app.advance(0.02);
          check('The left indicator reports its current state before manual driving resumes',
            touchAction('signalLeft').getAttribute('aria-pressed') === 'true');
          touchAction('signalRight').click(); app.advance(0.02);
          check('Switching to the right indicator updates both touch controls',
            touchAction('signalLeft').getAttribute('aria-pressed') === 'false'
            && touchAction('signalRight').getAttribute('aria-pressed') === 'true');
          touchAction('signalRight').click(); app.advance(0.02);
          touchAction('horn').focus();
          touchSetting.value = 'hide'; change(touchSetting);
          check('Hiding the touch controls restores focus to the setting', document.activeElement === touchSetting);
          check('Touch controls can be hidden without changing the driving mode', app.touch.el.hidden && !document.body.classList.contains('touch-driving'));
          check('The touch setting persists independently of the world URL', localStorage.getItem('jev-fsd-ui-touch') === '"hide"');

          const edit = $('settings-inspect');
          edit.focus(); edit.click();
          check('Opening the inspector puts focus on its selected tab', document.activeElement.id === 'inspector-state');
          key(document.activeElement, 'End');
          check('The inspector panel is named by its active tab', $('panel-body').getAttribute('aria-labelledby') === 'inspector-meta');
          check('The inspector has a focusable scrolling content region', $('panel-body').tabIndex === 0);
          $('copy-json').click();
          check('Copy JSON explains why an empty inspector cannot copy', $('badge').textContent.includes('No decision'));
          $('copy-curl').click();
          check('Copy request explains why the model request is missing', $('badge').textContent.includes('No model request'));
          key(document.activeElement, 'Home');
          $('pin-decision').click();
          const sample = { meta: {}, candidates: [], questions: { vector: 'fixture' }, state: { sample: 42 } };
          app.autopilot.onDecision(sample);
          $('inspector-questions').click(); $('inspector-state').click();
          check('Pinning before the first decision freezes the empty inspector', $('panel-body').textContent.includes('No decision'));
          $('pin-decision').click();
          $('inspector-questions').click(); $('inspector-state').click();
          const baseFetch = window.fetch;
          let resolveSave, saves = 0;
          window.fetch = (url, options) => String(url).endsWith('/api/snapshot/save')
            ? new Promise(resolve => { saves++; resolveSave = resolve; })
            : baseFetch(url, options);
          try {
            $('save-snapshot').click();
            $('panel-inline').requestSubmit();
            $('panel-inline').requestSubmit();
            $('edit-style').click();
            check('An in-flight snapshot blocks additional submissions and edits',
              saves === 1 && $('panel-inline-submit').disabled && $('panel-inline-submit').textContent === 'Save');
            resolveSave({ok: true, json: async () => ({saved: 'fixture'})});
            await new Promise(resolve => setTimeout(resolve, 0));
          } finally { window.fetch = baseFetch; }
          $('edit-style').focus(); $('edit-style').click();
          key($('panel-inline-input'), 'Escape');
          check('Canceling an inspector edit returns focus to its trigger', document.activeElement.id === 'edit-style');
          app.autopilot.style = 'old style';
          $('edit-style').click();
          check('The style edit opens with its saved value', !$('panel-inline').hidden && $('panel-inline-input').value === 'old style');
          $('panel-inline-input').value = '';
          $('panel-inline').requestSubmit();
          check('An empty custom style clears the previous override', app.autopilot.style === '');
          $('panel-close').click();
          check('The inspector returns focus to the control that opened it', document.activeElement === edit);
          settings.click();

          const menu = ['llm-menu-toggle', 'decision-menu-toggle'].map($).find(b => !b.hidden);
          menu.focus(); key(menu, 'ArrowUp');
          const popup = $(menu.getAttribute('aria-controls'));
          check('Arrow Up opens the model menu at its last enabled item', popup.contains(document.activeElement)
            && document.activeElement === popup.querySelector('button:last-child'));
          key(document.activeElement, 'Home');
          check('Home moves to the first enabled model action', document.activeElement === popup.querySelector('button:not([disabled])'));
          $('view').focus();
          check('Leaving a model menu closes it and clears expanded state', popup.hidden && menu.getAttribute('aria-expanded') === 'false');

          const photo = $('photo-mode');
          photo.focus(); photo.click();
          check('Photo mode freezes an already paused drive', app.world.paused && app.photo.active);
          const clock = app.photo.timeInput;
          clock.value = '23.75'; clock.dispatchEvent(new Event('input'));
          check('Photo lighting announces a clock time for keyboard users', clock.getAttribute('aria-valuetext') === '23:45');
          const photoKey = (target, k) => {
            const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
            target.dispatchEvent(ev);
            return ev.defaultPrevented;
          };
          check('Photo mode lets Tab and Enter reach its controls',
            !photoKey(app.photo.captureButton, 'Tab') && !photoKey(app.photo.captureButton, 'Enter'));
          check('Photo mode still holds back driving shortcuts', photoKey(document.body, 'r'));
          const canvas = $('view'), capture = canvas.toBlob, render = app.view.render;
          let complete, captures = 0;
          canvas.toBlob = cb => { captures++; complete = cb; };
          app.view.render = () => {};
          app.photo.capture(); app.photo.capture();
          check('Repeated capture requests wait for the current photo', app.photo.captureButton.disabled && captures === 1);
          complete(null);
          check('A failed photo capture reports the failure and can be retried', !app.photo.captureButton.disabled
            && app.photo.status.textContent.includes('could not save'));
          canvas.toBlob = () => { throw new DOMException('Capture denied', 'SecurityError'); };
          app.photo.capture();
          check('A synchronous capture error leaves the save control usable', !app.photo.captureButton.disabled);
          canvas.toBlob = capture; app.view.render = render;
          app.photo.exit();
          check('Leaving Photo mode restores the invoking button', document.activeElement === photo);
          check('Leaving Photo mode preserves an existing pause', app.world.paused);
          check('Closing Photo mode restores the previous camera', app.view.mode === 'chase');

          const routeFetch = window.fetch;
          const requests = [];
          window.fetch = (url, options) => String(url).endsWith('/api/route')
            ? new Promise((resolve, reject) => {
                const {signal} = options;
                requests.push({resolve, signal});
                signal?.addEventListener('abort', () => reject(signal.reason), {once: true});
              })
            : routeFetch(url, options);
          try {
            const map = $('minimap');
            map.focus(); key(map, 'ArrowRight'); key(map, 'Enter');
            check('Keyboard map selection calls the normal routing endpoint', requests.length === 1 && !app.input.anyDriving);
            check('The minimap announces a pending route request', map.getAttribute('aria-busy') === 'true'
              && $('route-status').textContent.includes('Finding route'));
            key(map, 'ArrowRight'); key(map, 'Enter');
            check('Selecting a newer destination cancels the old request', requests.length === 2 && requests[0].signal.aborted);
            requests[1].resolve({ok: true, json: async () => ({routes: []})});
            await new Promise(resolve => setTimeout(resolve, 0));
            check('An unreachable destination has a persistent recovery message', !$('route-status').hidden
              && $('route-status').textContent.includes('Choose another street') && map.getAttribute('aria-busy') === 'false');
            const suggested = app.explorer.onDrive({ destination: [0, 0], route: null, title: 'Broken route' });
            requests[2]?.resolve({ok: false, status: 503, json: async () => ({error: 'Route unavailable'})});
            await suggested;
            check('Suggested routing errors appear in a visible HUD message', $('badge').textContent.includes('Could not start the suggested drive'));
          } finally { window.fetch = routeFetch; }
          return results;
        }"""),
    )
    menu = page.locator("#llm-menu-toggle")
    menu.click()
    expanded = menu.get_attribute("aria-expanded") == "true"
    menu.click()
    ok &= report(
        "model menu pointer",
        [
            {
                "name": "Clicking the same model menu button again closes it",
                "ok": expanded and menu.get_attribute("aria-expanded") == "false",
            }
        ],
    )
    return ok


def check_startup_recovery(page, url):
    page.goto(url.rstrip("/") + "/?challenge=missing-challenge", wait_until="domcontentloaded")
    retry = page.locator("#retry-start")
    retry.wait_for()
    return report(
        "startup recovery",
        page.evaluate("""() => {
          const retry = document.querySelector('#retry-start'), free = document.querySelector('#start-free-drive');
          return [
            {name: 'Startup failures focus the retry action while the road canvas stays inert', ok: document.activeElement === retry
              && document.querySelector('#view').inert},
            {name: 'A broken deep link offers a URL without the failing parameters', ok: !free.hidden && new URL(free.href).search === '?drive=manual'},
            {name: 'Startup errors stop the loading animation and are announced', ok: document.querySelector('.loading-mark').hidden
              && document.querySelector('#loading-text').getAttribute('role') === 'alert'}
          ];
        }"""),
    )


def check_startup_preferences(page, url):
    base = url.rstrip("/")
    page.add_init_script("""
      localStorage.setItem('jev-fsd-quality', 'low');
      localStorage.removeItem('jev-fsd-replay');
    """)
    page.goto(base + "/?drive=manual&quality=unknown&time=11:12", wait_until="domcontentloaded")
    page.wait_for_function("!!window.__jev?.advance", timeout=TIMEOUT_MS)
    ok = report(
        "startup preferences",
        page.evaluate("""async () => {
      const app = window.__jev, $ = (id) => document.getElementById(id);
      const initial = app.view.quality === 'low' && $('time').selectedOptions[0]?.textContent === '11:12';
      app.view.render = () => {};
      history.replaceState({ retained: true }, '', location.href);
      app.setTime('11:16');
      const time = history.state.retained && $('time').selectedOptions[0]?.textContent === '11:16';
      const weather = $('weather');
      weather.value = 'rain'; weather.dispatchEvent(new Event('change'));
      $('quality').dispatchEvent(new Event('change'));
      const quality = !new URL(location.href).searchParams.has('quality') && localStorage.getItem('jev-fsd-quality') === 'low';
      const { checkQualityFallback } = await import('/tests/ui-tests.js');
      const qualityFallback = checkQualityFallback(app);
      const before = app.world.tick;
      const originalFetch = window.fetch;
      let pendingRoute;
      window.fetch = (url, options) => String(url).endsWith('/api/route')
        ? new Promise((_resolve, reject) => {
            pendingRoute = options.signal;
            pendingRoute.addEventListener('abort', () => reject(pendingRoute.reason), { once: true });
          })
        : originalFetch(url, options);
      let routeCancelled;
      try {
        const lookup = app.setDestination([2, 3]);
        $('view').dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
        await lookup;
        routeCancelled = pendingRoute?.aborted && $('minimap').getAttribute('aria-busy') === 'false';
      } finally {
        window.fetch = originalFetch;
      }
      app.advance(0.1);
      return [
        { name: 'An invalid quality override uses saved graphics and keeps the exact clock time', ok: initial },
        { name: 'Reflecting conditions in the URL preserves history state', ok: time && history.state.retained },
        { name: 'A graphics selection replaces the old URL override', ok: quality },
        qualityFallback,
        { name: 'Losing graphics pauses stepping and offers recovery', ok: app.world.paused
          && app.world.tick === before && !document.querySelector('.simulation-error').hidden },
        { name: 'Losing graphics cancels pending routes', ok: routeCancelled },
      ];
    }"""),
    )
    page.goto(base + "/?replay=1&bbox=kitsilano&quality=low&weather=rain", wait_until="domcontentloaded")
    page.locator("#retry-start").wait_for(timeout=TIMEOUT_MS)
    ok &= report(
        "watch link recovery",
        page.evaluate("""() => {
      const url = new URL(document.querySelector('#start-free-drive').href);
      return [
        { name: 'A missing Watch hand-off gives recovery instructions', ok: document.querySelector('#loading-text')
          .textContent.includes('no saved drive') && document.querySelector('#view').inert },
        { name: 'Free drive recovery retains display and weather parameters', ok: !url.searchParams.has('replay')
          && !url.searchParams.has('bbox') && url.searchParams.get('quality') === 'low'
          && url.searchParams.get('weather') === 'rain' && url.searchParams.get('drive') === 'manual' },
      ];
    }"""),
    )
    return ok


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
            check_snapshot_form(page)
            page.close()  # Release the renderer's software-WebGL workload before the finish fixtures.

        if "pages" in groups or "ui" in groups:
            page = open_page(None)
            page.emulate_media(reduced_motion="reduce")
            page.set_viewport_size({"width": 860, "height": 900})
            page.goto(url.rstrip("/") + "/?drive=manual&quality=low", wait_until="domcontentloaded")
            page.wait_for_function("!!window.__jev?.advance", timeout=TIMEOUT_MS)
            ok &= check_driving_ui(page)
            ok &= report(
                "Photo Mode routing",
                page.evaluate("import('/tests/ui-tests.js').then(async m => [await m.checkPhotoRoutes(window.__jev)])"),
            )
            for skip_id, target_id in (("skip-drive-settings", "settings-toggle"), ("skip-drive-map", "minimap")):
                skip_link = page.locator(f"#{skip_id}")
                skip_link.focus()
                skip_link.press("Enter")
                ok &= report(
                    "keyboard bypass",
                    [
                        {
                            "name": f"{skip_id} moves keyboard focus",
                            "ok": page.locator(f"#{target_id}:focus").count() == 1,
                        }
                    ],
                )
            if "ui" in groups:
                ok &= report("UI fixtures", page.evaluate("import('/tests/ui-tests.js').then(m => m.runUiTests())"))
            page.set_viewport_size({"width": 320, "height": 360})
            page.emulate_media(contrast="more", forced_colors="active")
            ok &= report(
                "compact and high-contrast controls",
                page.evaluate("""() => {
                  const app = window.__jev, setting = document.querySelector('#touch-setting');
                  setting.value = 'show';
                  setting.dispatchEvent(new Event('change'));
                  const touch = app.touch;
                  const elementBounds = [touch.wheel, ...touch.buttons, ...Object.values(touch.pedalEls)]
                    .map(element => element.getBoundingClientRect());
                  const inside = elementBounds.every(rect => rect.width > 0 && rect.top >= 0
                    && rect.left >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight);
                  const contrast = getComputedStyle(document.body).getPropertyValue('--muted').trim() === '#c9d1df';
                  const cursor = getComputedStyle(document.querySelector('#minimap-cursor')).forcedColorAdjust;
                  setting.value = 'hide';
                  setting.dispatchEvent(new Event('change'));
                  return [
                    { name: 'The narrow touch layout fits a 320 by 360 viewport', ok: inside },
                    { name: 'The HUD honours higher contrast', ok: contrast },
                    { name: 'The minimap cursor retains its contrasting outline in forced colours', ok: cursor === 'none' },
                  ];
                }"""),
            )
            page.emulate_media(contrast="no-preference", forced_colors="none")
            page.set_viewport_size({"width": 420, "height": 360})
            ok &= report(
                "short photo viewport",
                page.evaluate("""() => {
                  const app = window.__jev;
                  app.photo.enter();
                  const panel = app.photo.panel;
                  const rect = panel.getBoundingClientRect();
                  const ok = rect.top >= 0 && rect.bottom <= innerHeight
                    && panel.scrollHeight > panel.clientHeight && getComputedStyle(panel).overflowY === 'auto';
                  app.photo.exit();
                  return [{ name: 'Photo controls can scroll on short screens', ok }];
                }"""),
            )
            page.close()
            page = open_page(None)
            ok &= check_startup_recovery(page, url)
            page.close()
            page = open_page(None)
            ok &= check_startup_preferences(page, url)
            page.close()

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
                    published_scores = comparison.locator("tbody tr:not(:first-child) td:nth-of-type(3)")
                    published = published_scores.locator(".comparison-score").all_text_contents()
                    assert published[0] == "Unavailable", published
                    assert all(0 <= float(value) <= 100 for value in published[1:]), published
                    assert published_scores.locator(".comparison-delta").count() == 2
            elif kind in ("rules", "branched", "modified"):
                assert comparison.count() == 0
            page.close()

        if "practice" in groups:
            page = open_page("/?challenge=road-test-kitsilano&drive=manual&quality=low", render=False)
            check_library_progress(page)
            page.close()

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
            # Reload to clear the in-page results cache while keeping the saved road test.
            page.reload(wait_until="domcontentloaded", timeout=TIMEOUT_MS)
            page.wait_for_function("!!window.__jev?.advance", timeout=TIMEOUT_MS)
            page.evaluate("() => { window.__jev.view.render = () => {}; }")
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
    parser.add_argument("--group", choices=(*GROUPS, "ui"), help="run only this part")
    args = parser.parse_args()
    sys.exit(0 if check(args.url, args.chromium, [args.group] if args.group else GROUPS) else 1)
