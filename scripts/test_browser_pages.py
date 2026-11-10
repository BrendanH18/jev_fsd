"""Playwright checks for the in-browser suites against a running local app.

uv run --with playwright python scripts/test_browser_pages.py --url http://127.0.0.1:8322
Runs the /tests page (simulation, HUD and explorer assertions), the WebGL renderer assertions from
the simulator page, and a layout check that the pilot controls fit the HUD panel. Requires
Playwright and its Chromium browser (or --chromium /path/to/chromium).
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
      }
      app.finishDrive('finished');
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
        && report.parking?.result !== 'parked' && challengeFailures({ park: true }, report).includes('simulation error'))
      && (kind !== 'modified' || report.modified === true)
      && (kind !== 'branched' || report.branched === true)
      && (kind !== 'rules' || report.driver === 'rules'),
      detail: JSON.stringify({ status: report?.status, driver: report?.driver, modified: report?.modified, branched: report?.branched, record }) }];
  } finally {
    keys.forEach((key, i) => before[i] === null ? localStorage.removeItem(key) : localStorage.setItem(key, before[i]));
  }
}"""


# Exercise the actual report wiring, including a button rendered before a branch.
DEBRIEF_REPLAY = """async () => {
  const app = window.__jev;
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
}"""


def report(label, results):
    failed = [r for r in results if not r.get("ok")]
    for r in failed:
        print("FAIL %s: %s %s" % (label, r.get("name"), r.get("detail") or ""))
    print("%s: %d/%d passed" % (label, len(results) - len(failed), len(results)))
    return not failed and len(results) > 0


def check(url, chromium=None):
    ok = True
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, executable_path=chromium,
                                    args=["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
        # The app's CSP forbids eval, which Playwright's wait/evaluate helpers rely on.
        page = browser.new_page(viewport={"width": 1440, "height": 900}, bypass_csp=True)
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))

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

        for kind in ["early", "arrived", "rules", "modified", "branched", "parked", "wide-kerb", "outside-space", "simulation-error", "resume"]:
            page = browser.new_page(viewport={"width": 1440, "height": 900}, bypass_csp=True)
            page.on("pageerror", lambda error: errors.append(str(error)))
            driver = "rules" if kind == "rules" else "manual"
            challenge = "parallel-park" if kind in ["parked", "wide-kerb", "outside-space", "simulation-error"] else "pothole-season"
            page.goto(url.rstrip("/") + f"/?challenge={challenge}&drive={driver}&quality=low",
                      wait_until="domcontentloaded", timeout=TIMEOUT_MS)
            page.wait_for_function("!!window.__jev?.advance", timeout=TIMEOUT_MS)
            page.evaluate("window.__jev.world.paused = true")
            ok &= report("practice integration", page.evaluate(PRACTICE_FINISH, kind))
            page.close()

        page = browser.new_page(viewport={"width": 1440, "height": 900}, bypass_csp=True)
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(url.rstrip("/") + "/?challenge=pothole-season&drive=manual&quality=low",
                  wait_until="domcontentloaded", timeout=TIMEOUT_MS)
        page.wait_for_function("!!window.__jev?.advance", timeout=TIMEOUT_MS)
        ok &= report("debrief replay integration", page.evaluate(DEBRIEF_REPLAY))
        page.close()

        page = browser.new_page(viewport={"width": 1440, "height": 900}, bypass_csp=True)
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(url.rstrip("/") + "/?challenge=door-zone&drive=rules&quality=low",
                  wait_until="domcontentloaded", timeout=TIMEOUT_MS)
        page.wait_for_function("!!window.__jev?.advance", timeout=TIMEOUT_MS)
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
        ok &= report("simulation error containment", page.evaluate("""() => {
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
        }"""))
        page.get_by_role("button", name="Restart drive", exact=True).click()
        page.wait_for_function("!!window.__jev?.advance && !window.__jev.simulationError", timeout=TIMEOUT_MS)
        ok &= report("simulation error restart", page.evaluate("""() => {
          const app = window.__jev, tick = app.world.tick;
          app.world.paused = false; app.advance(0.1);
          return [{ name: 'Restart replaces the broken world with a drive that steps again',
            ok: app.world.tick > tick && !app.simulationError && !document.querySelector('#simulation-error') }];
        }"""))
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
    args = parser.parse_args()
    sys.exit(0 if check(args.url, args.chromium) else 1)
