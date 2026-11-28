"""Keyboard destinations and accessibility associations for server and demo markup."""

import re
import unittest
from collections import Counter
from html.parser import HTMLParser
from pathlib import Path

STATIC = Path(__file__).resolve().parents[1] / "static"
VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}


class Page(HTMLParser):
    def __init__(self, name):
        super().__init__()
        self.elements = []
        self.ids = {}
        self.stack = []
        self.feed((STATIC / f"{name}.html").read_text(encoding="utf-8"))
        self.close()

    def handle_starttag(self, tag, attrs):
        attributes = {key: value or "" for key, value in attrs}
        node = {"tag": tag, "attrs": attributes, "text": "", "parent": self.stack[-1] if self.stack else None}
        self.elements.append(node)
        if "id" in attributes:
            self.ids[attributes["id"]] = node
        if tag not in VOID:
            self.stack.append(node)

    def handle_endtag(self, tag):
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i]["tag"] == tag:
                del self.stack[i:]
                break

    def handle_data(self, data):
        for node in self.stack:
            node["text"] += data


# Each field needs different context and can regress independently when the form is edited.
HELP_FIELDS = {
    "index": """
        weather time quality clock-rate traffic-density world-seed randomize-seed drive-volume gamepad-deadzone
        letter-shortcuts left-handed-touch touch-setting wipers camera-motion restart-world vehicle-options
        paint-options pin-decision copy-json copy-curl save-snapshot edit-style show-candidates
    """,
    "arena": """
        arena-mode arena-track arena-road-tests arena-custom agent-module arena-export arena-import arena-delete
        arena-baseline arena-baseline-agent arena-csv
    """,
    "bench": """
        brain bench-map count npcs seed features track park hour without cover bench-diagnostics bench-save
        heldout mode compare saved-run bench-csv bench-json
    """,
}

DRIVE_SHORTCUTS = {
    "explore-world": "X",
    "brain-rules": "2",
    "brain-decision": "1",
    "brain-llm": "3",
    "autopilot": "J",
    "camera-view": "C",
    "drive-sound": "M",
    "keys-toggle": "? /",
    "photo-mode": "O",
    "pause-world": "P",
    "panel-toggle": "I",
}


# Markup contracts that need something more specific than a valid ARIA reference.
ELEMENTS = {
    "index": (
        ("hud", "main", {"aria-label": "Driving simulator"}, None),
        ("skip-drive-settings", "a", {"href": "#settings-toggle"}, None),
        ("skip-drive-map", "a", {"href": "#minimap"}, None),
        ("explore-world", "button", {"aria-haspopup": "dialog"}, None),
        ("start-free-drive", "a", {"aria-description": "Starts without a challenge or a stored replay."}, None),
        ("retry-start", "button", {"aria-label": "Retry loading the driving simulator"}, None),
        ("brain-rules", "button", {"aria-checked": "true"}, None),
        ("brain-decision", "button", {"aria-checked": "false", "tabindex": "-1"}, None),
        ("brain-llm", "button", {"aria-checked": "false", "tabindex": "-1"}, None),
        ("decision-menu-toggle", "button", {"aria-keyshortcuts": "ArrowDown ArrowUp", "data-local-keys": ""}, None),
        ("llm-menu-toggle", "button", {"aria-keyshortcuts": "ArrowDown ArrowUp", "data-local-keys": ""}, None),
        ("keys-toggle", "button", {"aria-haspopup": "dialog"}, None),
        ("panel-close", "button", {"aria-keyshortcuts": "Escape"}, None),
        ("keys-close", "button", {"aria-keyshortcuts": "Escape"}, None),
        ("keys-help", "div", {"data-local-keys": ""}, None),
        (
            "view",
            "canvas",
            {"aria-description": "Interactive view of the simulated street."},
            "This browser cannot display the driving canvas.",
        ),
        (
            "minimap",
            "canvas",
            {
                "aria-keyshortcuts": "Enter Home ArrowUp ArrowDown ArrowLeft ArrowRight Shift+ArrowUp Shift+ArrowDown Shift+ArrowLeft Shift+ArrowRight Escape"
            },
            None,
        ),
        ("minimap", "canvas", {}, "This browser cannot display the route minimap."),
        ("map-view-toggle", "button", {"aria-controls": "minimap", "aria-expanded": "false"}, "Full map"),
        ("clear-route", "button", {"aria-description": "Removes the current destination and route guidance."}, None),
        ("nav-card", "div", {"role": "group", "aria-label": "Route guidance"}, None),
        ("decision-options", "div", {"role": "group", "aria-label": "Manoeuvre options"}, None),
        ("settings", "div", {"role": "region", "aria-label": "Driving settings"}, None),
        ("feature-switches-all", "button", {"aria-label": "All on, enable every free-drive feature"}, None),
        ("feature-switches-none", "button", {"aria-label": "All off, disable every free-drive feature"}, None),
        ("feature-switches-apply", "button", {"aria-label": "Apply switches for free drive"}, None),
        ("panel-inline-input", "input", {"spellcheck": "false"}, None),
        ("limit-sign", "div", {"role": "group", "aria-label": "Speed limit in kilometres per hour"}, None),
        ("speed-readout", "div", {"role": "group", "aria-label": "Current speed"}, None),
        ("conditions-group", "div", {"role": "group", "aria-label": "World conditions"}, None),
        ("instrument-group", "div", {"role": "group", "aria-label": "Driving instruments"}, None),
        ("median-latency-label", "span", {}, "Median decision latency"),
        ("decision-rate-label", "span", {}, "Decisions per minute"),
        ("token-count-label", "span", {}, "model tokens"),
        ("model-cost-label", "span", {}, "model cost"),
        ("failed-yield-label", "small", {}, "missed yields"),
        ("red-light-label", "small", {}, "red lights run"),
        ("stop-sign-label", "small", {}, "stops missed"),
        ("offroad-label", "small", {}, "time off-road"),
        ("keys-help-title", "h2", {}, None),
        ("gamepad-help-heading", "h3", {}, None),
        ("keyboard-drive-help", "dd", {}, "brake and reverse"),
        ("gamepad-triggers-help", "dd", {}, "Without triggers"),
        ("shortcut-help-keys", "dd", {}, "Show or hide this list"),
        ("world-seed-label", "label", {"for": "world-seed"}, "world seed"),
        ("keys-toggle", "button", {"aria-expanded": "false"}, None),
    ),
    "arena": (
        ("skip-evaluation", "a", {"href": "#evaluation-controls"}, None),
        ("skip-arena-results", "a", {"href": "#arena-results-section"}, None),
        ("arena-navigation", "nav", {"aria-label": "Arena navigation"}, None),
        ("arena-table-wrap", "div", {"tabindex": "0", "aria-label": "Scrollable evaluation table"}, None),
        ("arena-result-table", "table", {"aria-label": "Evaluation attempts"}, None),
        ("llm-status", "p", {"role": "status"}, None),
        ("arena-subset", "select", {"aria-controls": "arena-custom-wrap"}, None),
        ("arena-progress", "progress", {"aria-describedby": "arena-status"}, None),
        ("arena-run", "button", {"aria-controls": "arena-progress arena-results-section"}, None),
        ("arena-match-count", "span", {"aria-atomic": "true"}, None),
        ("comparison-status", "p", {"role": "status"}, None),
        ("arena-clear-filters", "button", {"aria-controls": "arena-results-section"}, None),
        ("agent-module", "input", {"autocapitalize": "none", "spellcheck": "false", "autocomplete": "off"}, None),
        ("manual-attempts-section", "section", {"aria-labelledby": "manual-attempts-heading"}, None),
        ("evaluation-controls", "section", {"tabindex": "-1"}, None),
        ("arena-results-section", "section", {"tabindex": "-1"}, None),
    ),
    "bench": (
        ("skip-bench-controls", "a", {"href": "#benchmark-controls"}, None),
        ("skip-bench-results", "a", {"href": "#benchmark-results"}, None),
        ("benchmark-main", "main", {}, None),
        ("summary", "section", {"aria-label": "Run summary"}, None),
        ("benchmark-table-wrap", "section", {"tabindex": "0", "aria-label": "Scrollable route table"}, None),
        ("results", "table", {"aria-label": "Route results"}, None),
        ("run", "button", {"aria-controls": "status benchmark-results"}, None),
        ("map-note", "span", {"role": "status"}, None),
        ("bench-search", "input", {"aria-controls": "results"}, None),
        ("bench-failures", "input", {"aria-controls": "results"}, None),
        ("without", "input", {"autocapitalize": "none", "autocomplete": "off", "spellcheck": "false"}, None),
        ("benchmark-controls", "section", {"aria-label": "Benchmark controls"}, None),
        ("benchmark-results", "section", {"aria-label": "Benchmark results"}, None),
    ),
    "results": (
        ("skip-results-summary", "a", {"href": "#summary-heading"}, None),
        ("summary-heading", "h2", {"tabindex": "-1"}, None),
        ("challenges-heading", "h2", {"tabindex": "-1"}, None),
        ("open-heading", "h2", {"tabindex": "-1"}, None),
        ("city-heading", "h2", {"tabindex": "-1"}, None),
        ("replay-heading", "h2", {"tabindex": "-1"}, None),
        ("results-version", "select", {"aria-description": "Shows results from the selected suite definition."}, None),
        ("results-navigation", "nav", {"aria-label": "Results navigation"}, None),
    ),
}


class AccessibleMarkupTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pages = {name: Page(name) for name in ("index", "arena", "bench", "results")}

    def test_elements(self):
        for name, elements in ELEMENTS.items():
            for id_, tag, attrs, text in elements:
                with self.subTest(page=name, element=id_):
                    node = self.pages[name].ids[id_]
                    self.assertEqual(node["tag"], tag)
                    for attr, value in attrs.items():
                        self.assertEqual(node["attrs"].get(attr), value, attr)
                    if text:
                        self.assertIn(text, " ".join(node["text"].split()))

    def test_contextual_help(self):
        for name, fields in HELP_FIELDS.items():
            page = self.pages[name]
            for field in fields.split():
                with self.subTest(page=name, field=field):
                    description = page.ids[field]["attrs"].get("aria-describedby")
                    self.assertEqual(description, f"{field}-help")
                    self.assertTrue(page.ids[description]["text"].strip(), "The description is empty")

    def test_shortcut_hints(self):
        page = self.pages["index"]
        for id_, shortcut in DRIVE_SHORTCUTS.items():
            with self.subTest(element=id_):
                self.assertEqual(page.ids[id_]["attrs"].get("data-drive-shortcut"), shortcut)

    def test_document_contract(self):
        for name, page in self.pages.items():
            with self.subTest(page=name):
                ids = Counter(node["attrs"]["id"] for node in page.elements if "id" in node["attrs"])
                self.assertTrue(all(count == 1 for count in ids.values()), ids)
                self.assertEqual(sum(node["tag"] == "main" for node in page.elements), 1)
                self.assertTrue(any(node["tag"] == "html" and node["attrs"]["lang"] == "en" for node in page.elements))
                self.assertTrue(
                    any(
                        node["tag"] == "meta"
                        and node["attrs"].get("name") == "viewport"
                        and "user-scalable=no" not in node["attrs"]["content"].replace(" ", "")
                        for node in page.elements
                    )
                )
                self.assertTrue(any(node["attrs"].get("href") == "/css/a11y.css" for node in page.elements))

    def test_relationship_targets(self):
        # Photo Mode creates its panel at startup.
        for name, page in self.pages.items():
            for node in page.elements:
                for attr in ("aria-controls", "aria-describedby", "aria-labelledby"):
                    for target in node["attrs"].get(attr, "").split():
                        with self.subTest(page=name, element=node["attrs"].get("id"), relation=attr):
                            runtime_target = (
                                name == "index" and node["attrs"].get("id") == "photo-mode" and target == "photo-panel"
                            )
                            self.assertTrue(target in page.ids or runtime_target, f"Missing element #{target}")

    def test_keyboard_bypass(self):
        for name, page in self.pages.items():
            skips = [node for node in page.elements if "skip-link" in node["attrs"].get("class", "").split()]
            self.assertTrue(skips, name)
            for node in skips:
                href = node["attrs"]["href"]
                self.assertTrue(href.startswith("#"))
                destination = page.ids[href[1:]]
                self.assertTrue(
                    destination["tag"] == "button" or destination["attrs"].get("tabindex") in {"0", "-1"},
                    href,
                )

    def test_existing_driving_states(self):
        page = self.pages["index"]
        self.assertIn("inert", page.ids["view"]["attrs"], "the canvas must be inert until startup finishes")
        self.assertEqual(page.ids["loading-text"]["attrs"]["role"], "status")
        self.assertEqual(page.ids["autopilot"]["attrs"]["role"], "switch")
        self.assertEqual(page.ids["autopilot"]["attrs"]["aria-checked"], "false")
        self.assertEqual(page.ids["minimap"]["attrs"]["tabindex"], "0")
        self.assertIn("hidden", page.ids["minimap-cursor"]["attrs"])
        self.assertEqual(page.ids["route-status"]["attrs"]["role"], "status")
        self.assertIn("hidden", page.ids["settings"]["attrs"])
        self.assertEqual(page.ids["settings-toggle"]["attrs"]["aria-expanded"], "false")
        self.assertEqual(page.ids["settings-toggle"]["attrs"]["aria-controls"], "settings")
        self.assertIn("hidden", page.ids["keys-help"]["attrs"])
        self.assertEqual(page.ids["keys-help"]["attrs"]["aria-modal"], "false")

    def test_existing_inspector_contract(self):
        page = self.pages["index"]
        self.assertIn("hidden", page.ids["panel"]["attrs"])
        self.assertEqual(page.ids["panel-body"]["attrs"]["role"], "tabpanel")
        tabs = [node for node in page.elements if node["attrs"].get("role") == "tab"]
        selected = [node for node in tabs if node["attrs"].get("aria-selected") == "true"]
        self.assertEqual(len(selected), 1)
        self.assertEqual(selected[0]["attrs"]["id"], "inspector-state")
        self.assertEqual(sum(node["attrs"]["tabindex"] == "0" for node in tabs), 1)
        self.assertTrue(all(node["attrs"]["aria-controls"] == "panel-body" for node in tabs))
        self.assertEqual(page.ids["panel-inline-input"]["attrs"]["autocomplete"], "off")
        self.assertEqual(page.ids["panel-inline-label"]["attrs"]["for"], "panel-inline-input")

    def test_existing_report_controls(self):
        arena = self.pages["arena"].ids
        bench = self.pages["bench"].ids
        self.assertIn("hidden", arena["arena-custom-wrap"]["attrs"])
        self.assertIn("multiple", arena["arena-custom"]["attrs"])
        self.assertEqual(arena["arena-import"]["attrs"]["type"], "file")
        self.assertEqual(arena["arena-import"]["attrs"]["accept"], ".json,application/json")
        self.assertIn("disabled", arena["arena-delete"]["attrs"])
        self.assertIn("disabled", arena["arena-baseline-agent"]["attrs"])
        self.assertEqual(arena["details-heading"]["attrs"]["tabindex"], "-1")
        self.assertIn("disabled", bench["run"]["attrs"])
        self.assertIn("disabled", bench["bench-json"]["attrs"])
        self.assertIn("disabled", bench["bench-csv"]["attrs"])
        self.assertEqual(bench["status"]["attrs"]["role"], "status")

    def test_own_settings_label(self):
        page = self.pages["index"]
        self.assertIsNot(page.ids["randomize-seed"]["parent"], page.ids["world-seed-label"])
        self.assertEqual(page.ids["world-seed-label"]["parent"], page.ids["world-seed"]["parent"]["parent"])

    def test_css_keyboard_and_preference_rules(self):
        css = (STATIC / "css/a11y.css").read_text(encoding="utf-8")
        patterns = (
            r"\.skip-link:not\(:focus\)\s*\{[^}]*clip-path:",
            r"\.skip-link:focus\s*\{[^}]*background:",
            r"\.settings :is\([^\n]+:focus\s*\{[^}]*scroll-margin-block-end:",
            r"#view:focus-visible\s*\{[^}]*box-shadow:",
            r"\.llm-menu button:focus-visible\s*\{[^}]*outline:",
            r"\.import-button:focus-within\s*\{[^}]*outline:",
            r"\.touch-controls\.autopilot :is\([^\n]+\s*\{[^}]*opacity: 1",
            r"\.touch-pedal\.active\s*\{[^}]*box-shadow:",
            r"max-height: 460px\)\s*\{\s*body.touch-driving\s*\{[^}]*166px",
            r"max-width: 340px\)\s*\{\s*body.touch-driving\s*\{[^}]*216px",
            r"prefers-contrast: more\)\s*\{\s*:root\s*\{[^}]*--muted:",
            r"forced-colors: active\)\s*\{[^\n]*\s*\.touch-steer-knob[^}]*ButtonText",
            r"\.paint-option\[aria-pressed=\"true\"\]\s*\{[^}]*Highlight",
            r"#minimap-cursor\s*\{[^}]*forced-color-adjust: none",
        )
        for pattern in patterns:
            with self.subTest(pattern=pattern):
                self.assertIsNotNone(re.search(pattern, css))


if __name__ == "__main__":
    unittest.main()
