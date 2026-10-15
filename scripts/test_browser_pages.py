"""Playwright checks for the in-browser suites against a running local app.

uv run --with playwright python scripts/test_browser_pages.py --url http://127.0.0.1:8322
Runs the /tests page (simulation, HUD and explorer assertions) and the WebGL renderer assertions
from the simulator page. Requires Playwright and its Chromium browser (or --chromium /path/to/chromium).
"""
import argparse
import sys

from playwright.sync_api import sync_playwright

# Software WebGL (SwiftShader) is slow; the first simulator frame can take a while on CI runners.
TIMEOUT_MS = 240_000


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
