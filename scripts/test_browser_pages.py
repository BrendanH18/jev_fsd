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
  const { PRACTICE_KEY, readPractice } = await import('/js/lab/practice.js');
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
    const parking = ['parked', 'wide-kerb', 'outside-space'].includes(kind);
    if (kind === 'modified') app.setTime('morning');
    if (kind === 'branched') app.recorder.branched = true;
    if (parking) {
      const { spacesAlong } = await import('/js/sim/parallel-park.js');
      const car = app.world.ego, space = spacesAlong(app.world, app.world.route, car.spec)[0];
      const u = kind === 'outside-space' ? space.sTo + car.spec.length : space.goalU;
      const w = space.goalW - (kind === 'wide-kerb' ? 1 : 0);
      Object.assign(car, { x: space.ox + u * Math.cos(space.h) + w * Math.sin(space.h),
        y: space.oy + u * Math.sin(space.h) - w * Math.cos(space.h), psi: space.h, v: 0 });
      app.finishDrive('finished');
    } else if (kind === 'arrived') {
      const route = app.world.route, [x, y] = route.pointAt(route.length);
      Object.assign(app.world.ego, { x, y, psi: route.headingAt(route.length), v: 0 });
      route.hint = route.pts.length - 2;
      app.world.paused = false; app.advance(0.1);
    } else app.finishDrive(kind === 'early' ? 'finished' : 'arrived');
    const report = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]')[0];
    const record = readPractice().records[parking ? 'parallel-park' : 'pothole-season'];
    const allowed = ['early', 'arrived'].includes(kind) || parking;
    const completed = ['arrived', 'parked'].includes(kind);
    return [{ name: `Manual practice finish integration: ${kind}`, ok: !!report
      && report.status === (kind === 'early' || parking && !completed ? 'finished' : 'arrived')
      && (allowed ? record?.attempts === 1 && record.completed === completed : !record)
      && (kind !== 'modified' || report.modified === true)
      && (kind !== 'branched' || report.branched === true)
      && (kind !== 'rules' || report.driver === 'rules'),
      detail: JSON.stringify({ status: report?.status, driver: report?.driver, modified: report?.modified, branched: report?.branched, record }) }];
  } finally {
    keys.forEach((key, i) => before[i] === null ? localStorage.removeItem(key) : localStorage.setItem(key, before[i]));
  }
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

        for kind in ["early", "arrived", "rules", "modified", "branched", "parked", "wide-kerb", "outside-space", "resume"]:
            page = browser.new_page(viewport={"width": 1440, "height": 900}, bypass_csp=True)
            page.on("pageerror", lambda error: errors.append(str(error)))
            driver = "rules" if kind == "rules" else "manual"
            challenge = "parallel-park" if kind in ["parked", "wide-kerb", "outside-space"] else "pothole-season"
            page.goto(url.rstrip("/") + f"/?challenge={challenge}&drive={driver}&quality=low",
                      wait_until="domcontentloaded", timeout=TIMEOUT_MS)
            page.wait_for_function("!!window.__jev?.advance", timeout=TIMEOUT_MS)
            page.evaluate("window.__jev.world.paused = true")
            ok &= report("practice integration", page.evaluate(PRACTICE_FINISH, kind))
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
