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
        map_requests = []
        page.on("request", lambda request: map_requests.append(request.url) if "/api/map?" in request.url else None)
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(url)
        expect(page.locator("#arena-status")).to_contain_text("Ready")
        # every challenge, once for each of the two drivers the arena starts with
        n = 2 * page.evaluate(
            """() => import(new URL("./challenges.js", document.querySelector('script[type="module"][src*="arena"]').src)).then((m) => m.CHALLENGES.length)"""
        )
        page.locator("#arena-run").click()
        expect(page.locator("#arena-import")).to_be_disabled()
        # Running both drivers on every challenge can take several minutes on a shared CI runner.
        expect(page.locator("#arena-status")).to_contain_text("Complete", timeout=480_000)
        expect(page.locator("#history-status")).to_contain_text("Saved on this browser. Up to 20 recent evaluations")
        assert page.evaluate("localStorage.getItem('jev-fsd-evaluations-v2')") is None, "saved runs belong in IndexedDB"
        expect(page.locator("#arena-results tr")).to_have_count(n)
        expect(page.locator("#arena-results .pass")).to_have_count(n)
        # Lab item: Fetch each map once per Arena evaluation even when several drives share it.
        if not page.locator('meta[name="jev-demo"]').count():
            assert map_requests and len(map_requests) == len(set(map_requests)), map_requests
        # Lab item: Announce the visible attempt count when Arena search changes.
        search = page.locator("#arena-search")
        search.fill("no such drive")
        expect(page.locator("#arena-match-count")).to_have_text(f"0 of {n} attempts")
        search.clear()
        expect(page.locator("#arena-match-count")).to_have_text(f"{n} of {n} attempts")
        expect(page.locator("#arena-summary .agent-summary")).to_have_count(2)
        page.locator("#arena-baseline").select_option("0")
        page.locator("#arena-baseline-agent").select_option("cautious")
        expect(page.locator("#comparison-status")).to_contain_text(f"{n}/{n} attempts match")
        # Lab item: Show duration deltas on matching Arena attempts.
        time_cell = page.locator("#arena-results tr").first.locator("td").nth(4)
        expect(time_cell.locator("small")).to_contain_text(" s vs baseline")
        page.locator(".result-button").first.click()
        expect(page.locator("#arena-details")).to_be_visible()
        expect(page.locator("#details-content")).to_contain_text("Authored hazard triggered")
        assert "nullnull" not in page.locator("#details-content").inner_text()
        event_type = page.locator("#details-content").get_by_role("combobox", name="Event type")
        event_type.select_option("hazard")
        expect(page.locator("#details-content .timeline > li")).to_have_count(1)
        event_type.select_option("")
        page.locator("#details-content .timeline details summary").first.click()
        expect(page.locator("#details-content .candidate-list").first).to_be_visible()
        # Lab item: Close Arena details and return keyboard focus to the inspected row.
        page.locator("#arena-close-details").click()
        expect(page.locator("#arena-details")).to_be_hidden()
        expect(page.locator(".result-button").first).to_be_focused()
        if output:
            Path(output).mkdir(parents=True, exist_ok=True)
            page.screenshot(path=str(Path(output) / "arena-comparison.png"), full_page=True)
        with page.expect_download() as downloaded:
            page.locator("#arena-export").click()
        export = Path(directory) / "evaluation.json"
        downloaded.value.save_as(export)
        original = json.loads(export.read_text())
        assert original["schema"] == "jev-agent-evaluation-v3"
        assert all(r["decisions_trace"] for r in original["results"])
        assert all(r["events"] for r in original["results"])
        assert all(r["hard_brakes"] == sum(e["type"] == "hard_brake" for e in r["events"]) for r in original["results"])
        assert export.stat().st_size < 5 * 1024 * 1024
        page.reload()
        expect(page.locator("#arena-status")).to_contain_text("Ready")
        page.locator("#arena-history").select_option("0")
        expect(page.locator("#arena-results tr")).to_have_count(n)
        page.locator("#arena-baseline").select_option("0")
        page.locator("#arena-baseline-agent").select_option("cautious")
        page.evaluate("""() => {
            const text = File.prototype.text;
            File.prototype.text = async function () {
                File.prototype.text = text;
                await new Promise((resolve) => { window.finishArenaImport = resolve; });
                return text.call(this);
            };
        }""")
        page.locator("#arena-import").set_input_files(export)
        expect(page.locator("#arena-run")).to_be_disabled()
        expect(page.locator("#arena-delete")).to_be_disabled()
        page.evaluate("window.finishArenaImport()")
        expect(page.locator("#arena-status")).to_contain_text(f"Imported {n} attempts")
        expect(page.locator("#comparison-status")).to_contain_text(f"{n}/{n} attempts match")
        old_clock = json.loads(export.read_text())
        for r in old_clock["results"]:
            r["engine_version"] = "drive-lab-3"
        old_clock_path = Path(directory) / "old-time-limit.json"
        old_clock_path.write_text(json.dumps(old_clock))
        page.locator("#arena-import").set_input_files(old_clock_path)
        expect(page.locator("#comparison-status")).to_contain_text(f"0/{n} attempts match")
        expect(page.locator("#arena-results .comparison-note").first).to_contain_text("simulation version")
        changed = json.loads(export.read_text())
        for r in changed["results"]:
            r["mode"] = "realtime"
        mismatch = Path(directory) / "different-clock.json"
        mismatch.write_text(json.dumps(changed))
        page.locator("#arena-import").set_input_files(mismatch)
        expect(page.locator("#comparison-status")).to_contain_text(f"0/{n} attempts match")
        expect(page.locator("#arena-results .comparison-note").first).to_contain_text("decision clock")
        bad = Path(directory) / "bad.json"
        bad.write_text('{"schema":"other"}')
        page.locator("#arena-import").set_input_files(bad)
        expect(page.locator("#history-status")).to_contain_text("Import failed")
        expect(page.locator("#arena-results tr")).to_have_count(n)
        legacy = json.loads(export.read_text())
        legacy["schema"] = "jev-agent-evaluation-v1"
        legacy["challenge_version"] = 1
        for r in legacy["results"]:
            for key in ["decisions_trace", "events", "engine_version", "limit_s"]:
                r.pop(key, None)
        old = Path(directory) / "legacy.json"
        old.write_text(json.dumps(legacy))
        page.locator("#arena-import").set_input_files(old)
        expect(page.locator("#comparison-status")).to_contain_text(f"0/{n} attempts match")
        page.locator(".result-button").first.click()
        expect(page.locator("#details-content")).to_contain_text("no decision context")
        page.locator("#arena-history").select_option("0")
        before = page.locator("#arena-history option").count()
        baseline = int(page.locator("#arena-baseline").input_value())
        page.locator("#arena-delete").click()
        expect(page.locator("#arena-history option")).to_have_count(before - 1)
        expect(page.locator("#history-status")).to_contain_text("deleted")
        expect(page.locator("#arena-baseline")).to_have_value(str(baseline - 1))
        expect(page.locator("#arena-baseline-agent")).to_have_value("cautious")
        large = Path(directory) / "large-evaluation.json"
        large_run = json.loads(export.read_text())
        large_run["results"] = large_run["results"][:1]
        decision = next(d for d in large_run["results"][0]["decisions_trace"] if d.get("context_recorded"))
        decision["state"]["observations"] = "x" * (5 * 1024 * 1024)
        large.write_text(json.dumps(large_run))
        page.locator("#arena-import").set_input_files(large)
        expect(page.locator("#arena-status")).to_contain_text("Imported 1 attempts")
        expect(page.locator("#history-status")).to_contain_text("Saved on this browser")
        page.locator("#arena-mode").select_option("realtime")
        page.locator("#arena-run").click()
        expect(page.locator("#arena-status")).to_contain_text(f"1/{n}")
        page.locator("#arena-run").click()
        expect(page.locator("#arena-status")).to_contain_text("Stopped", timeout=10000)
        expect(page.locator("#arena-results")).to_contain_text("STOPPED")
        expect(page.locator("#arena-results .pass")).to_have_count(0)
        guarded_and_open = json.loads(export.read_text())
        guarded, opened = guarded_and_open["results"][:2]
        opened.update(track="open", flagged_choices=1, flagged_by_check={"red light": 1})
        guarded_and_open["results"] = [guarded, opened]
        tracks = Path(directory) / "mixed-tracks.json"
        tracks.write_text(json.dumps(guarded_and_open))
        page.locator("#arena-import").set_input_files(tracks)
        expect(page.locator("#arena-status")).to_contain_text("Imported 2 attempts")
        # Lab item: Show tracks explicitly when viewing a mixed imported run.
        expect(page.locator("#arena-results tr").first.locator("td").nth(5)).to_have_text("guarded")
        expect(page.locator("#arena-results tr").last.locator("td").nth(5)).to_have_text("open")
        # Lab item: Keep a measured Open Track flag count distinct from an unmeasured Guarded count.
        expect(page.locator("#arena-results tr").first.locator("td").nth(6)).to_have_text("—")
        expect(page.locator("#arena-results tr").last.locator("td").nth(6)).to_have_text("1")
        # Lab item: Export the current Arena track selection in CSV.
        page.locator("#arena-filter-track").select_option("open")
        with page.expect_download() as filtered_csv:
            page.locator("#arena-csv").click()
        csv = filtered_csv.value.path().read_text()
        assert "Track,Flagged choices" in csv
        assert len(csv.splitlines()) == 2 and ",open,1," in csv, csv
        # Lab item: Clear the Arena filters together and resume keyboard search.
        page.locator("#arena-clear-filters").click()
        expect(page.locator("#arena-filter-track")).to_have_value("")
        expect(page.locator("#arena-results tr")).to_have_count(2)
        expect(page.locator("#arena-search")).to_be_focused()
        expect(page.locator("#arena-clear-filters")).to_be_disabled()
        page.set_viewport_size({"width": 390, "height": 844})
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), "Arena overflows a narrow viewport"
        if output:
            page.screenshot(path=str(Path(output) / "arena-mobile.png"), full_page=True)
        page.close()
        # history saved in localStorage before IndexedDB moves into IndexedDB, and the old key goes
        moved = browser.new_context()
        moved.add_init_script(
            "if (location.origin === new URL(%s).origin && !sessionStorage.getItem('seeded')) {"
            " sessionStorage.setItem('seeded', '1');"
            " localStorage.setItem('jev-fsd-evaluations-v2', JSON.stringify([%s])); }"
            % (json.dumps(url), json.dumps(legacy))
        )
        page = moved.new_page()
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(url)
        expect(page.locator("#arena-status")).to_contain_text("Ready")
        expect(page.locator("#arena-history option")).to_have_count(2)
        assert page.evaluate("localStorage.getItem('jev-fsd-evaluations-v2')") is None
        page.reload()
        expect(page.locator("#arena-status")).to_contain_text("Ready")
        page.locator("#arena-history").select_option("0")
        expect(page.locator("#arena-results tr")).to_have_count(n)
        moved.close()
        blocked = browser.new_context()
        blocked.add_init_script(
            "for (const name of ['localStorage', 'indexedDB']) Object.defineProperty(window, name, { get() { throw new Error('Storage blocked'); } });"
        )
        page = blocked.new_page()
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(url)
        expect(page.locator("#arena-status")).to_contain_text("Ready")
        page.locator("#arena-import").set_input_files(export)
        expect(page.locator("#arena-status")).to_contain_text(f"Imported {n} attempts")
        expect(page.locator("#history-status")).to_contain_text("Could not save locally")
        expect(page.locator("#arena-export")).to_be_enabled()
        assert not errors, errors
        browser.close()
    print(
        "Arena browser checks passed: evaluation, history, comparisons, details, export/import, legacy data, the move of localStorage history into IndexedDB, stop, narrow layout and blocked storage."
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:8322/arena")
    parser.add_argument("--chromium")
    parser.add_argument("--output", help="Optional screenshot directory")
    args = parser.parse_args()
    check(args.url, args.chromium, args.output)
