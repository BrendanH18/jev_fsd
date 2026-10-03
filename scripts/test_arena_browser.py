"""Optional Playwright integration checks against a running local app or static demo.

python3 scripts/test_arena_browser.py --url http://127.0.0.1:8322/arena
Requires Playwright and its Chromium browser (or --chromium /path/to/chromium).
"""
import argparse
import json
import tempfile
from pathlib import Path

from playwright.sync_api import expect, sync_playwright


def check(url, chromium=None, output=None):
    with sync_playwright() as p, tempfile.TemporaryDirectory() as directory:
        browser = p.chromium.launch(headless=True, executable_path=chromium, args=["--no-sandbox"])
        page = browser.new_page(viewport={"width": 1440, "height": 1050})
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(url)
        expect(page.locator("#arena-status")).to_contain_text("Ready")
        page.locator("#arena-run").click()
        expect(page.locator("#arena-import")).to_be_disabled()
        expect(page.locator("#arena-status")).to_contain_text("Complete", timeout=180000)
        expect(page.locator("#history-status")).to_contain_text("Saved on this browser")
        expect(page.locator("#arena-results tr")).to_have_count(12)
        expect(page.locator("#arena-results .pass")).to_have_count(12)
        expect(page.locator("#arena-summary .agent-summary")).to_have_count(2)
        page.locator("#arena-baseline").select_option("0")
        page.locator("#arena-baseline-agent").select_option("cautious")
        expect(page.locator("#comparison-status")).to_contain_text("12/12 attempts match")
        page.locator(".result-button").first.click()
        expect(page.locator("#arena-details")).to_be_visible()
        expect(page.locator("#details-content")).to_contain_text("Authored hazard triggered")
        assert "nullnull" not in page.locator("#details-content").inner_text()
        page.locator("#details-content .timeline details summary").first.click()
        expect(page.locator("#details-content .candidate-list").first).to_be_visible()
        if output:
            Path(output).mkdir(parents=True, exist_ok=True)
            page.screenshot(path=str(Path(output) / "arena-comparison.png"), full_page=True)
        with page.expect_download() as downloaded:
            page.locator("#arena-export").click()
        export = Path(directory) / "evaluation.json"
        downloaded.value.save_as(export)
        original = json.loads(export.read_text())
        assert original["schema"] == "jev-agent-evaluation-v2"
        assert all(r["decisions_trace"] for r in original["results"])
        assert all(r["events"] for r in original["results"])
        assert all(r["hard_brakes"] == sum(e["type"] == "hard_brake" for e in r["events"]) for r in original["results"])
        assert export.stat().st_size < 5 * 1024 * 1024
        page.reload()
        expect(page.locator("#arena-status")).to_contain_text("Ready")
        page.locator("#arena-history").select_option("0")
        expect(page.locator("#arena-results tr")).to_have_count(12)
        page.locator("#arena-baseline").select_option("0")
        page.locator("#arena-import").set_input_files(export)
        expect(page.locator("#arena-status")).to_contain_text("Imported 12 attempts")
        expect(page.locator("#comparison-status")).to_contain_text("12/12 attempts match")
        changed = json.loads(export.read_text())
        for r in changed["results"]:
            r["mode"] = "realtime"
        mismatch = Path(directory) / "different-clock.json"
        mismatch.write_text(json.dumps(changed))
        page.locator("#arena-import").set_input_files(mismatch)
        expect(page.locator("#comparison-status")).to_contain_text("0/12 attempts match")
        expect(page.locator("#arena-results .comparison-note").first).to_contain_text("decision clock")
        bad = Path(directory) / "bad.json"
        bad.write_text('{"schema":"other"}')
        page.locator("#arena-import").set_input_files(bad)
        expect(page.locator("#history-status")).to_contain_text("Import failed")
        expect(page.locator("#arena-results tr")).to_have_count(12)
        legacy = json.loads(export.read_text())
        legacy["schema"] = "jev-agent-evaluation-v1"
        legacy["challenge_version"] = 1
        for r in legacy["results"]:
            for key in ["decisions_trace", "events", "engine_version", "limit_s"]:
                r.pop(key, None)
        old = Path(directory) / "legacy.json"
        old.write_text(json.dumps(legacy))
        page.locator("#arena-import").set_input_files(old)
        expect(page.locator("#comparison-status")).to_contain_text("0/12 attempts match")
        page.locator(".result-button").first.click()
        expect(page.locator("#details-content")).to_contain_text("no decision context")
        page.locator("#arena-history").select_option("0")
        before = page.locator("#arena-history option").count()
        page.locator("#arena-delete").click()
        expect(page.locator("#arena-history option")).to_have_count(before - 1)
        expect(page.locator("#history-status")).to_contain_text("deleted")
        page.locator("#arena-mode").select_option("realtime")
        page.locator("#arena-run").click()
        expect(page.locator("#arena-status")).to_contain_text("1/12")
        page.locator("#arena-run").click()
        expect(page.locator("#arena-status")).to_contain_text("Stopped", timeout=10000)
        expect(page.locator("#arena-results")).to_contain_text("STOPPED")
        expect(page.locator("#arena-results .pass")).to_have_count(0)
        page.set_viewport_size({"width": 390, "height": 844})
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), "Arena overflows a narrow viewport"
        if output:
            page.screenshot(path=str(Path(output) / "arena-mobile.png"), full_page=True)
        page.close()
        blocked = browser.new_context()
        blocked.add_init_script("Object.defineProperty(window, 'localStorage', { get() { throw new Error('Storage blocked'); } });")
        page = blocked.new_page()
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(url)
        expect(page.locator("#arena-status")).to_contain_text("Ready")
        page.locator("#arena-import").set_input_files(export)
        expect(page.locator("#arena-status")).to_contain_text("Imported 12 attempts")
        expect(page.locator("#history-status")).to_contain_text("Could not save locally")
        expect(page.locator("#arena-export")).to_be_enabled()
        assert not errors, errors
        browser.close()
    print("Arena browser checks passed: evaluation, history, comparisons, details, export/import, legacy data, stop, narrow layout and blocked storage.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:8322/arena")
    parser.add_argument("--chromium")
    parser.add_argument("--output", help="Optional screenshot directory")
    args = parser.parse_args()
    check(args.url, args.chromium, args.output)
