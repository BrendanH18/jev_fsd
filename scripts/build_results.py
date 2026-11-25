#!/usr/bin/env python3
"""Build data/results.json and the README's results table from the committed records (ROADMAP 2.7).

Every number comes from a committed file, and each row names it:

- the challenge set (60 challenges and 2 road tests): `data/results/<date>/<name>.json`, the
  per-drive results published with docs/model-results.md, and for a model driver the recording
  `data/recordings/<name>-<date>.json.gz` it replays from (its results must agree with the file);
- the seeded benchmark: `data/runs/*.json` (docs/rules-baseline.md), the newest run for each
  driver, map, preset and weather on a named map (older runs that name their map by hash predate
  the current packs).
- outside-driver runs: `data/submissions/<date>/<name>.json` and its matching `.json.gz` tape,
  written by `scripts/driver_submission.mjs publish` after exact offline replay.

    uv run scripts/build_results.py           # rewrite data/results.json and the README block
    uv run scripts/build_results.py --check   # fail if either is out of date

Numbered benchmark tapes also use Node 22 to verify their ordered scenario fingerprint.
The output has no timestamps, so it changes only with the records.
"""

from __future__ import annotations

import argparse
import difflib
import gzip
import hashlib
import json
import math
import os
import re
import subprocess
import sys
import tempfile
import zlib
from datetime import date as calendar_date
from datetime import datetime
from pathlib import Path
from stat import S_IMODE

ROOT = Path(__file__).resolve().parent.parent
RUNS = ROOT / "data" / "runs"
RESULTS = ROOT / "data" / "results"
RECORDINGS = ROOT / "data" / "recordings"
SUBMISSIONS = ROOT / "data" / "submissions"
COMPARISON_SCORES = ROOT / "data" / "score-comparisons"
OUTPUT = ROOT / "data" / "results.json"
README = ROOT / "README.md"
FORMAT = "jev-results/1"
LEGACY_MANIFEST_FORMAT = "jev-run-manifest/1"
MANIFEST_FORMAT = "jev-run-manifest/2"
LEGACY_SUITE = "legacy"
CUSTOM_SUITE = "custom"
LEGACY_RESULTS_THROUGH = "2026-11-20"
START, END = "<!-- results:start -->", "<!-- results:end -->"
HOME_MAP = "kitsilano"
LEADERBOARD = "https://brendanh18.github.io/jev_fsd/results.html"
WEATHERS = ("dry", "fog", "rain", "snow")


def nonblank(value) -> bool:
    return isinstance(value, str) and bool(value.strip())


def nonnegative_integer(value) -> bool:
    return type(value) is int and 0 <= value <= 2**53 - 1


def fingerprint(value) -> bool:
    return isinstance(value, str) and re.fullmatch(r"[0-9a-f]{16}", value) is not None


def distinct_ids(value, *, allow_empty=False) -> bool:
    return (
        isinstance(value, list)
        and (value or allow_empty)
        and all(nonblank(item) for item in value)
        and len(value) == len(set(value))
    )


def read_json(path: Path):
    def unique_keys(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError(f"duplicate JSON key {key!r}")
            result[key] = value
        return result

    def invalid_constant(value):
        raise ValueError(f"invalid JSON number {value}")

    try:
        return json.loads(
            path.read_text(encoding="utf-8-sig"), object_pairs_hook=unique_keys, parse_constant=invalid_constant
        )
    except (OSError, ValueError) as error:
        raise ValueError(f"{rel(path)}: {error}") from error


def _load_map_names() -> dict[str, str]:
    """Derive bundled map display names from jev.config.PRESET_BBOXES and jev.maps.MAP_CATALOG."""
    root = str(ROOT)
    if root not in sys.path:
        sys.path.insert(0, root)
    from jev.config import PRESET_BBOXES
    from jev.maps import MAP_CATALOG

    city_counts: dict[str, int] = {}
    for item in MAP_CATALOG:
        city_counts[item["city"]] = city_counts.get(item["city"], 0) + 1
    return {
        item["id"]: item["name"] if city_counts[item["city"]] > 1 else item["city"]
        for item in MAP_CATALOG
        if item["id"] in PRESET_BBOXES
    }


# The bundled maps (jev/config.py PRESET_BBOXES), with the names the docs use.
MAP_NAMES = _load_map_names()
# Drivers without a recording (no model) and the order drivers are listed in. A model driver's
# label and model come from its recording's header.
BUILT_IN = {
    "rules": {
        "label": "Rules",
        "kind": "rules",
        "model": None,
        "about": "Deterministic code that scores each safe manoeuvre; tuned on the seeded city suite in Phase 1.",
    },
    "cautious": {
        "label": "Cautious agent",
        "kind": "agent",
        "model": None,
        "about": "The starter browser agent (static/js/agents/cautious.js); no model calls.",
    },
}
ORDER = [
    "rules",
    "cautious",
    "jev",
    "llm:claude-haiku-5-5",
    "llm:deepseek",
    "llm:luna",
    "decision:liquid-d1",
    "llm:granite",
]
KIND_NOTES = {"jev": "decision model (TypeSafe)", "decision": "decision model", "llm": "LLM"}

# Published tapes that predate source revisions in run manifests.
LEGACY_REPLAY_SOURCES = {
    **dict.fromkeys(
        (
            "jev-arena-2026-11-11.json.gz",
            "deepseek-arena-2026-11-11.json.gz",
            "deepseek-door-zone-2026-11-11.json.gz",
            "granite-local-2026-11-11.json.gz",
            "liquid-d1-door-zone-2026-11-11.json.gz",
            "luna-door-zone-2026-11-11.json.gz",
        ),
        "dcfc663dc72f2bcf709e744288a8a5c789cbc974",
    ),
    **dict.fromkeys(
        (
            "jev-open-2026-11-20.json.gz",
            "claude-haiku-arena-2026-11-20.json.gz",
            "claude-haiku-open-2026-11-20.json.gz",
        ),
        "a6164696eacb242a1fc01a3a6fc366b31aed8677",
    ),
}


def rel(path: Path) -> str:
    return path.relative_to(ROOT).as_posix() if path.is_relative_to(ROOT) else str(path)


def calendar_day(value: str) -> bool:
    try:
        return isinstance(value, str) and calendar_date.fromisoformat(value).isoformat() == value
    except ValueError:
        return False


def load_suite_definitions(directory: Path) -> dict:
    """Check frozen definitions before using them to qualify a publication."""
    definitions = {}
    for path in sorted(directory.glob("v*.json")):
        version = path.stem
        definition = read_json(path)

        def require(ok, detail, source=path):
            if not ok:
                raise ValueError(f"{rel(source)}: {detail}")

        require(re.fullmatch(r"v[1-9][0-9]*", version), "expected a numbered suite filename")
        require(isinstance(definition, dict), "expected a suite object")
        require(definition.get("version") == version, "suite version disagrees with filename")
        commit = definition.get("defined_from")
        require(isinstance(commit, str) and re.fullmatch(r"[0-9a-f]{40}", commit), "invalid defined_from commit")
        maps = definition.get("maps")
        require(isinstance(maps, dict) and maps, "missing suite map fingerprints")
        for key, sha in maps.items():
            require(key in MAP_NAMES and fingerprint(sha), f"invalid suite map fingerprint for {key!r}")
        arena = definition.get("arena")
        drives = arena.get("drives") if isinstance(arena, dict) else None
        require(isinstance(drives, dict) and drives, "missing suite arena drives")
        for key, drive in drives.items():
            require(nonblank(key) and isinstance(drive, dict), f"invalid suite arena drive {key!r}")
            require(isinstance(drive.get("map"), str) and drive["map"] in maps, f"unknown suite map for {key!r}")
            require(nonnegative_integer(drive.get("seed")), f"invalid suite arena seed for {key!r}")
            require(
                nonnegative_integer(drive.get("version")) and drive["version"] > 0,
                f"invalid suite arena version for {key!r}",
            )
        bench = definition.get("bench")
        config = bench.get("config") if isinstance(bench, dict) else None
        require(isinstance(config, dict), "missing suite benchmark config")
        require(isinstance(config.get("map"), str) and config["map"] in maps, "unknown suite benchmark map")
        require(config.get("features") in ("bare", "city"), "invalid suite benchmark preset")
        require(config.get("mode") == "lockstep", "suite benchmark must be lockstep")
        require(nonnegative_integer(config.get("seed")), "invalid suite benchmark seed")
        require(nonnegative_integer(config.get("npcs")), "invalid suite benchmark traffic count")
        require(nonnegative_integer(config.get("count")) and config["count"] > 0, "invalid suite benchmark route count")
        weathers = bench.get("weathers")
        require(
            distinct_ids(weathers) and all(weather in WEATHERS for weather in weathers), "invalid suite weather list"
        )
        ids = bench.get("ids")
        require(distinct_ids(ids) and len(ids) == config["count"], "invalid suite benchmark route IDs")
        require(fingerprint(bench.get("route_sha")), "invalid suite benchmark route fingerprint")
        heldout = bench.get("heldout")
        require(isinstance(heldout, dict), "missing suite held-out plan")
        seeds = heldout.get("seeds")
        require(
            isinstance(seeds, list)
            and seeds
            and all(nonnegative_integer(seed) for seed in seeds)
            and len(seeds) == len(set(seeds))
            and config["seed"] not in seeds,
            "invalid suite held-out seed list",
        )
        require(
            nonnegative_integer(heldout.get("count")) and heldout["count"] > 0, "invalid suite held-out route count"
        )
        require(fingerprint(heldout.get("route_sha")), "invalid suite held-out route fingerprint")
        definitions[version] = definition
    if "v1" not in definitions:
        raise ValueError(f"{rel(directory)}: suite v1 is required for legacy arena coverage")
    return definitions


try:
    CANONICAL = load_suite_definitions(ROOT / "data" / "suites")
except ValueError as error:
    if __name__ == "__main__":
        sys.exit(f"Could not load frozen suites: {error}")
    raise


def round_share(value):
    return None if value is None else round(value, 4)


def map_key(config: dict) -> str | None:
    """The map a run drove, when it names one of the bundled maps. Runs from before the maps had
    names (September and October 2026) give a bbox hash and are history, not results."""
    key = config.get("map")
    return key if key in MAP_NAMES else None


def shares(results: list[dict]) -> dict:
    """Who made the decisions, weighted by decisions (ROADMAP 2.4). Counts where the records have
    them; otherwise each drive's share times its decisions. Empty for Rules, whose results have none."""
    decisions = sum(r.get("decisions") or 0 for r in results)
    if not decisions or not any("model_share" in r for r in results):
        return {}
    out = {"decisions": decisions}
    for name in ("model", "local", "fallback"):
        if all(f"{name}_decisions" in r for r in results):
            count = sum(r[f"{name}_decisions"] or 0 for r in results)
            out[f"{name}_decisions"] = count
            out[f"{name}_share"] = round_share(count / decisions)
        else:
            out[f"{name}_share"] = round_share(
                sum((r.get(f"{name}_share") or 0) * (r.get("decisions") or 0) for r in results) / decisions
            )
    return out


def read_recording(path: Path) -> dict:
    with (gzip.open if path.suffix == ".gz" else open)(path, "rt", encoding="utf-8-sig") as f:
        return json.load(f)


_FACTS: dict[Path, tuple[tuple, dict]] = {}


def recording_facts(path: Path) -> dict:
    """What build() reads from a recording: everything but its drives, which it only counts, with
    answered_by() of them under "answered". Cached by file, modification time and size, since the
    tests build many times and the drives come to over a gigabyte once parsed. Callers must not
    change what it returns."""
    try:
        resolved = path.resolve()
        stat = path.stat()
        key = (stat.st_ino, stat.st_mtime_ns, stat.st_ctime_ns, stat.st_size)
        cached = _FACTS.get(resolved)
        if cached is not None and cached[0] == key:
            return cached[1]
        full = read_recording(path)
        if not isinstance(full, dict):
            raise ValueError("recording must be an object")
        for field in ("header", "results", "drives"):
            if not isinstance(full.get(field), dict):
                raise ValueError(f"recording needs a {field} object")
        if any(not nonblank(drive_id) or not isinstance(row, dict) for drive_id, row in full["results"].items()):
            raise ValueError("recording results need drive IDs and result objects")
        facts = {**{k: v for k, v in full.items() if k != "drives"}, "answered": answered_by(full)}
        _FACTS[resolved] = (key, facts)
        return facts
    except _ARTIFACT_ERRORS as error:
        raise ValueError(f"{rel(path)}: {error}") from error


def answered_by(recording: dict) -> tuple[list[str], float | None, int]:
    """The model ids that answered (from each reply's meta), the cost billed by the provider when
    every reply carries `usage.cost`, and the number of replies."""
    models, billed, replies, with_cost = {}, 0.0, 0, 0
    for drive_id, drive in recording["drives"].items():
        if not nonblank(drive_id) or not isinstance(drive, dict):
            raise ValueError(f"invalid recording drive {drive_id!r}")
        for channel, calls in drive.items():
            label = f"recording drive {drive_id!r}, {channel}"
            if not isinstance(calls, list):
                raise ValueError(f"{label}: expected a call array")
            for index, call in enumerate(calls, 1):
                if not isinstance(call, dict):
                    raise ValueError(f"{label} call {index}: expected an object")
                reply = call.get("response")
                if reply is None or reply == {}:
                    continue
                if not isinstance(reply, dict):
                    raise ValueError(f"{label} call {index}: expected a response object")
                meta = reply.get("meta")
                if meta is not None and not isinstance(meta, dict):
                    raise ValueError(f"{label} call {index}: expected response metadata")
                replies += 1
                model = (meta or {}).get("model")
                if model is not None and not isinstance(model, str):
                    raise ValueError(f"{label} call {index}: invalid responding model ID")
                if model:
                    models[model] = models.get(model, 0) + 1
                trace = reply.get("trace")
                if trace is not None and not isinstance(trace, dict):
                    raise ValueError(f"{label} call {index}: expected a response trace object")
                wire = (trace or {}).get("response")
                if wire is not None and not isinstance(wire, dict):
                    raise ValueError(f"{label} call {index}: expected a provider response object")
                usage = (wire or {}).get("usage")
                if usage is not None and not isinstance(usage, dict):
                    raise ValueError(f"{label} call {index}: expected a provider usage object")
                if usage and "cost" in usage:
                    if not nonnegative_number(usage["cost"]):
                        raise ValueError(f"{label} call {index}: invalid provider usage cost")
                    billed += usage["cost"]
                    if not finite_number(billed):
                        raise ValueError(f"{label} call {index}: total provider cost is out of range")
                    with_cost += 1
    ranked = sorted(models, key=lambda m: -models[m])
    return ranked, (round(billed, 6) if replies and with_cost == replies else None), replies


def model_driver(header: dict, model: str | None) -> dict:
    """A model driver as its recording's header describes it: "DeepSeek V4.1 Flash (OpenRouter)"
    gives the label "DeepSeek V4.1 Flash" and the provider "OpenRouter"."""
    kind = header.get("kind")
    match = re.fullmatch(r"(.*?)\s*\(([^)]*)\)", (header.get("endpoint") or {}).get("label") or "")
    label, where = (
        (match.group(1), match.group(2))
        if match
        else ("Jev" if header.get("driver") == "jev" else header.get("driver"), None)
    )
    about = KIND_NOTES.get(kind, kind or "")
    return {"label": label, "kind": kind, "model": model, "about": f"{about}, {where}" if where else about}


def comparable_bench_result(result: dict) -> dict:
    # Match comparableResult in static/js/brain/recording.js.
    ignored = ("wall_ms", "model_recording", "diagnostics", "suite_version")
    compact = {key: value for key, value in result.items() if key not in ignored}
    if isinstance(compact.get("report"), dict):
        compact["report"] = {key: value for key, value in compact["report"].items() if key != "started_at"}
    return compact


def bench_route_fingerprint(scenarios: list[dict]) -> str:
    # Use the runner's canonical JSON, including JavaScript's number formatting.
    script = """
        import { readFileSync } from "node:fs";
        import { benchRouteFingerprint } from "./scripts/run_manifest.mjs";
        console.log(benchRouteFingerprint(JSON.parse(readFileSync(0, "utf8"))));
    """
    try:
        sha = subprocess.run(
            ["node", "--experimental-default-type=module", "--input-type=module", "-e", script],
            cwd=ROOT,
            input=json.dumps(scenarios, allow_nan=False),
            check=True,
            capture_output=True,
            text=True,
            timeout=30,
        ).stdout.strip()
    except FileNotFoundError as error:
        raise ValueError("Node 22 is required to fingerprint numbered benchmark tape scenarios") from error
    except subprocess.TimeoutExpired as error:
        raise ValueError("Node timed out fingerprinting benchmark tape scenarios") from error
    except subprocess.CalledProcessError as error:
        detail = next((line for line in error.stderr.splitlines() if "Error:" in line), f"status {error.returncode}")
        raise ValueError(f"Node could not fingerprint benchmark tape scenarios ({detail})") from error
    if not fingerprint(sha):
        raise ValueError("Node returned an invalid benchmark route fingerprint")
    return sha


def canonical_mismatch(run: dict, manifest: dict, definition: dict) -> str | None:
    """The first mismatch with the applicable frozen suite, if any."""
    suite, maps = manifest["suite"], manifest["maps"]
    results = run["results"]
    if run.get("stopped"):
        return "report stopped early"
    if suite.get("only"):
        return "route selection is partial"
    if any(result.get("stopped") for result in results):
        return "a drive stopped early"
    if suite["kind"] == "arena":
        drives = definition["arena"]["drives"]
        if suite["set"] != "all":
            return "arena set must be all"
        if suite["drives"] != drives:
            return "authored drive definitions differ"
        if len(results) != len(drives) or {r["challenge"] for r in results} != drives.keys():
            return "arena report does not contain the complete drive set"
        if {key: value["fingerprint"] for key, value in maps.items()} != definition["maps"]:
            return "arena map fingerprints differ"
        return None
    config, bench = run["config"], definition["bench"]
    for key, value in bench["config"].items():
        if config.get("heldout") and key in ("seed", "count"):
            continue
        if type(config.get(key)) is not type(value) or config[key] != value:
            return f"benchmark config {key} differs from the definition"
    if config.get("weather") not in bench["weathers"]:
        return "benchmark weather is outside the suite"
    if maps[config["map"]]["fingerprint"] != definition["maps"][config["map"]]:
        return "benchmark map fingerprint differs"
    if config.get("park"):
        return "destination parking is outside the suite"
    if "hour" in config:
        return "a custom hour is outside the suite"
    if "cover" in config:
        return "a feature covering row is outside the suite"
    if config.get("without"):
        return "omitting features is outside the suite"
    if manifest["track"] != "guarded":
        return "benchmark track must be guarded"
    if config.get("heldout"):
        seeds, count = bench["heldout"]["seeds"], bench["heldout"]["count"]
        expected = [f"s{seed}-{i + 1}" for seed in seeds for i in range(count)]
        planned = config.get("seeds")
        if not isinstance(planned, list) or not all(nonnegative_integer(seed) for seed in planned) or planned != seeds:
            return "held-out seed list differs"
        if not nonnegative_integer(config.get("seed")) or config["seed"] != seeds[0]:
            return "first held-out seed differs"
        if not nonnegative_integer(config.get("count")) or config["count"] != len(expected):
            return "held-out route count differs"
        if suite.get("route_sha") != bench["heldout"]["route_sha"]:
            return "held-out route fingerprint differs"
    else:
        expected = bench["ids"]
        if suite.get("route_sha") != bench["route_sha"]:
            return "benchmark route fingerprint differs"
    if suite["ids"] != expected:
        return "reported routes differ from the frozen order"
    if suite.get("generated_ids") != expected:
        return "generated routes differ from the frozen order"
    return None


def checked_manifest(path: Path, run: dict, date: str, recording: dict | None = None) -> dict | None:
    """Validate the declared run settings and bind the manifest to any model or local tape."""

    def require(ok, message):
        if not ok:
            raise ValueError(f"{rel(path)}: {message}")

    manifest = run.get("manifest")
    header = recording.get("header") if recording is not None else {}
    if recording is not None:
        require(isinstance(header, dict), "recording needs a header object")
        require(isinstance(recording.get("results"), dict), "recording needs a results object")
        require(all(isinstance(row, dict) for row in recording["results"].values()), "invalid recorded drive result")

    version = run.get("suite_version", LEGACY_SUITE)
    require(version in (LEGACY_SUITE, CUSTOM_SUITE, *CANONICAL), f"unknown suite_version {version!r}")
    require(
        all(r.get("suite_version") == run.get("suite_version") for r in run["results"]),
        "run and results disagree on suite_version",
    )
    if recording is not None:
        require(
            header.get("suite_version", LEGACY_SUITE) == version
            and all(r.get("suite_version") == header.get("suite_version") for r in recording["results"].values()),
            "recording and results disagree on suite_version",
        )
    if manifest is None and date <= LEGACY_RESULTS_THROUGH and "manifest" not in header:
        require(version == LEGACY_SUITE, "numbered or custom suites require a manifest")
        return None
    require(
        isinstance(manifest, dict) and manifest.get("format") in (LEGACY_MANIFEST_FORMAT, MANIFEST_FORMAT),
        "run manifest is required",
    )
    if manifest["format"] == MANIFEST_FORMAT:
        require(version != LEGACY_SUITE, "manifest version 2 requires a custom or numbered suite")
        require(
            run.get("suite_version") == manifest.get("suite_version") == version,
            "report and manifest disagree on suite_version",
        )
    else:
        require(version == LEGACY_SUITE and "suite_version" not in manifest, "legacy manifests have no suite version")
    commit = manifest.get("source_commit")
    require(
        isinstance(commit, str) and re.fullmatch(r"[0-9a-f]{40}", commit),
        "the manifest must identify a clean source commit (invalid source_commit)",
    )
    require(
        manifest.get("source_dirty") is False,
        "the manifest must identify a clean source commit (source_dirty must be false)",
    )
    config, summary, results = run.get("config"), run["summary"], run["results"]
    settings = config if config is not None else summary
    driver, engine, track = settings.get("brain"), settings.get("engine"), settings.get("track") or "guarded"
    require(nonblank(driver) and manifest.get("driver") == driver, "driver disagrees with the manifest")
    require(nonblank(engine) and manifest.get("engine") == engine, "engine disagrees with the manifest")
    require(track in ("guarded", "open") and manifest.get("track") == track, "track disagrees with the manifest")
    require(nonblank(manifest.get("engine_version")), "missing V8 version")
    verify_cost(results, summary, manifest, require)
    maps, suite = manifest.get("maps"), manifest.get("suite")
    require(isinstance(maps, dict) and maps, "missing map provenance")
    require(isinstance(suite, dict), "missing suite provenance")
    for key, data in maps.items():
        require(nonblank(key) and isinstance(data, dict), f"invalid map provenance for {key!r}")
        require(fingerprint(data.get("fingerprint")), f"invalid map fingerprint for {key!r}")
        pack = data.get("pack_version")
        require(pack is None or nonblank(pack) or nonnegative_integer(pack), f"invalid pack version for {key!r}")
        components = data.get("components")
        require(isinstance(components, dict) and components, f"missing map component fingerprints for {key!r}")
        for component, sha in components.items():
            require(
                nonblank(component) and fingerprint(sha), f"invalid map component fingerprint for {key!r}.{component}"
            )
    if config is None:
        drives = suite.get("drives")
        require(
            suite.get("kind") == "arena" and suite.get("set") == summary.get("set") and isinstance(drives, dict),
            "arena set disagrees with the manifest",
        )
        require(
            all(
                nonblank(key)
                and isinstance(d, dict)
                and isinstance(d.get("map"), str)
                and d["map"] in maps
                and nonnegative_integer(d.get("seed"))
                for key, d in drives.items()
            ),
            "invalid authored map or seed",
        )
        require(
            all(r["challenge"] in drives and drives[r["challenge"]]["map"] == r["map"] for r in results),
            "arena drives disagree with the manifest",
        )
        require(len({r["challenge"] for r in results}) == len(results), "arena report repeats a drive ID")
        for row in results:
            if "pack" in row:
                require(
                    row["pack"] == maps[row["map"]].get("pack_version"),
                    f"arena pack version disagrees for {row['challenge']!r}",
                )
        if version != LEGACY_SUITE:
            for drive_id, drive in drives.items():
                require(
                    nonnegative_integer(drive.get("version")) and drive["version"] > 0,
                    f"invalid challenge version for {drive_id!r}",
                )
            require(
                all(all(r.get(key) == drives[r["challenge"]].get(key) for key in ("version", "seed")) for r in results),
                "arena versions or seeds disagree with the manifest",
            )
    else:
        key = config.get("map")
        require(suite.get("kind") == "bench", "expected a benchmark manifest suite")
        require(suite.get("config") == config, "benchmark settings disagree with the manifest")
        ids = [r["id"] for r in results]
        planned = suite.get("ids")
        require(
            distinct_ids(planned, allow_empty=True) and ids == (planned[: len(ids)] if run.get("stopped") else planned),
            "benchmark routes disagree with the manifest",
        )
        generated = suite.get("generated_ids", planned)
        require(distinct_ids(generated, allow_empty=True), "invalid generated benchmark route IDs")
        require("only" not in suite or type(suite["only"]) is bool, "benchmark only must be a boolean")
        selected = set(planned)
        require(
            planned == [route for route in generated if route in selected]
            and (suite.get("only") is True or generated == planned or run.get("stopped")),
            "benchmark selection differs from the generated route order",
        )
        require("route_sha" not in suite or fingerprint(suite["route_sha"]), "invalid benchmark route fingerprint")
        require(isinstance(key, str) and set(maps) == {key}, "benchmark map disagrees with the manifest")
        require(maps[key].get("pack_version") == config.get("pack"), f"map pack version disagrees for {key!r}")
    if version in CANONICAL:
        mismatch = canonical_mismatch(run, manifest, CANONICAL[version])
        require(mismatch is None, f"run is outside the canonical {version} suite ({mismatch})")
    model, prompt = manifest.get("model"), manifest.get("prompt_hash")
    is_model = driver == "jev" or driver.startswith(("decision:", "llm:"))
    is_local = recording is not None and recording.get("format") == "jev-local-recording/1"
    if is_model:
        require(nonblank(model), "invalid model id in the manifest")
        require(fingerprint(prompt), "invalid prompt fingerprint in the manifest")
        require(recording is not None, "model runs need a corresponding recording")
        require(not is_local, "model runs need a model recording")
    elif is_local:
        require(config is None and model is None and fingerprint(prompt), "invalid local agent provenance")
    else:
        require(model is None and prompt is None, "non-model runs cannot declare a model or prompt")
    if is_model or is_local:
        require(header.get("manifest") == manifest, "recording and results disagree on their manifest")
        require(header.get("driver") == driver, "recording driver disagrees with the manifest")
        require(header.get("model") == model, "recording model disagrees with the manifest")
        require(header.get("engine") == engine, "recording engine disagrees with the manifest")
        if driver.startswith("llm:"):
            versions = header.get("versions")
            require(isinstance(versions, dict) and versions.get("llm_prompt") == prompt, "recording prompt disagrees")
        fingerprints = {key: data["fingerprint"] for key, data in maps.items()}
        recorded_maps = header.get("maps") if config is None else {config["map"]: header.get("map_sha")}
        require(fingerprints == recorded_maps, "recording map data disagrees with the manifest")
        recorded = recording.get("results", {})
        id_key = "challenge" if config is None else "id"
        require(
            len(recorded) == len(results) and recorded.keys() == {result[id_key] for result in results},
            "recording and report have different drives",
        )
        if config is None:
            recorded_arena = header.get("arena")
            require(isinstance(recorded_arena, dict), "recording needs an arena header")
            require(
                (recorded_arena.get("track") or "guarded") == track, "arena recording track disagrees with the manifest"
            )
            require(
                recorded_arena.get("set") == suite["set"]
                and distinct_ids(recorded_arena.get("ids"))
                and set(recorded_arena["ids"]) == suite["drives"].keys(),
                "arena recording set or drive list disagrees with the manifest",
            )
            if version in CANONICAL:
                require(
                    not any(result.get("stopped") for result in recorded.values()),
                    "canonical arena recording contains a stopped drive",
                )
            # The arena report exports only a subset of the fields kept in the tape.
            for result in results:
                drive = result[id_key]
                tape_row = recorded[drive]
                difference = next(
                    (
                        key
                        for key, value in result.items()
                        if key != "suite_version" and (key not in tape_row or tape_row[key] != value)
                    ),
                    None,
                )
                require(
                    difference is None, f"arena report and recording disagree on per-drive data ({drive}: {difference})"
                )
                require(
                    tape_row.get("seed") == suite["drives"][drive]["seed"],
                    f"arena recording seed disagrees for {drive!r}",
                )
        else:
            if version in CANONICAL:
                scenarios = recording.get("scenarios", {})
                require(
                    isinstance(scenarios, dict) and header.get("bench") == config and list(scenarios) == suite["ids"],
                    "benchmark recording settings or scenarios disagree with the manifest",
                )
                require(
                    bench_route_fingerprint(list(scenarios.values())) == suite["route_sha"],
                    "benchmark recording routes disagree with the canonical suite",
                )
            for result in results:
                drive = result[id_key]
                report_row, tape_row = comparable_bench_result(result), comparable_bench_result(recorded[drive])
                if report_row != tape_row:
                    different = sorted(
                        key
                        for key in report_row.keys() | tape_row.keys()
                        if key not in report_row or key not in tape_row or report_row[key] != tape_row[key]
                    )
                    require(
                        False,
                        f"benchmark report and recording disagree on per-drive data ({drive}: {', '.join(different)})",
                    )
    return manifest


def verify_cost(results, summary, manifest, require):
    total = 0.0
    for index, result in enumerate(results, 1):
        cost = result.get("cost_usd")
        require(
            cost is None or nonnegative_number(cost),
            f"invalid cost_usd for drive {result.get('challenge', result.get('id', index))!r}",
        )
        total += cost or 0
    require(nonnegative_number(total) and total <= (2**53 - 1) / 1e6, "run cost is out of range")
    # Match Math.round at six decimals rather than Python's ties-to-even rounding.
    scaled = total * 1e6
    whole = math.floor(scaled)
    cost = (whole + (scaled - whole >= 0.5)) / 1e6
    require(
        nonnegative_number(summary.get("cost_usd")) and summary["cost_usd"] == cost,
        "summary cost disagrees with drive costs",
    )
    require(
        nonnegative_number(manifest.get("cost_usd")) and manifest["cost_usd"] == cost,
        "cost disagrees with the manifest",
    )


def finite_number(value) -> bool:
    return type(value) is int or (type(value) is float and math.isfinite(value))


def nonnegative_number(value) -> bool:
    return finite_number(value) and 0 <= value <= sys.float_info.max


SCORE_NUMERIC = ("progress", "distance_m", "rms_jerk", "hard_brakes", "max_lat_accel", "collisions", "safety_brakes")
SCORE_NULLABLE = ("min_ttc_s", "min_headway_s")


def has_score_inputs(result: dict) -> bool:
    return (
        isinstance(result.get("arrived"), bool)
        and all(finite_number(result.get(k)) for k in (*SCORE_NUMERIC, "time_s"))
        and all(k in result and (result[k] is None or finite_number(result[k])) for k in SCORE_NULLABLE)
    )


def published_drive(result: dict, map_sha: str | None = None, comparison: dict | None = None) -> dict:
    seconds = result.get("time_s")
    drive = {
        "id": result["challenge"],
        "map": result["map"],
        "pass": result["pass"],
        "time_s": seconds if finite_number(seconds) else None,
    }
    drive.update({key: result[key] for key in ("version", "pack") if key in result})
    flagged = result.get("flagged_choices")
    if type(flagged) is int and flagged >= 0:
        drive["flagged_choices"] = flagged
    if map_sha:
        drive["map_sha"] = map_sha
    drive["incident_counts"] = {
        k: result[k] for k in ("collisions", "hard_brakes", "safety_brakes") if finite_number(result.get(k))
    }
    if has_score_inputs(result):
        score_inputs = {k: result[k] for k in ("arrived", *SCORE_NUMERIC, *SCORE_NULLABLE)}
        tags = result.get("tags")
        if isinstance(tags, dict) and finite_number(tags.get("length_m")):
            score_inputs["tags"] = {"length_m": tags["length_m"]}
        drive["score_inputs"] = score_inputs
    inputs = result.get("comparison_score_inputs")
    if comparison is not None:
        if not result.get("result_sha") or comparison.get("result_sha") != result["result_sha"] or inputs is not None:
            raise ValueError(f"{result['challenge']}: comparison measurements disagree with the recording")
        if not isinstance(comparison.get("score_inputs"), dict):
            raise ValueError(f"{result['challenge']}: missing comparison score inputs")
        inputs = comparison["score_inputs"]
    if inputs is not None:
        shared = (
            "arrived",
            "time_s",
            "distance_m",
            "rms_jerk",
            "hard_brakes",
            "max_lat_accel",
            "collisions",
            "safety_brakes",
        )
        if (
            not isinstance(inputs, dict)
            or inputs.get("method") != "driven-corridor-v1"
            or not has_score_inputs(inputs)
            or any(inputs[k] != result.get(k) for k in shared)
        ):
            raise ValueError(f"{result['challenge']}: invalid driven-corridor score measurements")
        drive["comparison_score_inputs"] = inputs
    return drive


def _read_submission_source(path: Path) -> tuple[Path, dict, Path, str]:
    entry = read_json(path)

    def require(ok, detail):
        if not ok:
            raise ValueError(f"{rel(path)}: invalid published submission ({detail})")

    require(isinstance(entry, dict), "expected an object")
    submitter, digest = entry.get("submitter"), entry.get("recording_sha256")
    require(entry.get("format") == "jev-published-submission/1", "unsupported format")
    require(isinstance(submitter, str) and re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,38}", submitter), "invalid submitter ID")
    require(isinstance(digest, str) and re.fullmatch(r"[0-9a-f]{64}", digest), "invalid recording SHA-256")
    require(calendar_day(path.parent.name), "submission date must be YYYY-MM-DD")
    require(re.fullmatch(r"[a-z0-9][a-z0-9_-]*", path.stem), "invalid submission filename")
    require(isinstance(entry.get("report"), dict), "missing report object")
    tape = path.with_suffix(".json.gz")
    if not tape.is_file():
        raise ValueError(f"{rel(path)}: the submitted recording is missing")
    checksum = hashlib.sha256()
    with tape.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            checksum.update(chunk)
    if checksum.hexdigest() != digest:
        raise ValueError(f"{rel(tape)}: the submitted recording checksum has changed")
    return path, entry["report"], tape, submitter


def challenge_sources():
    for path in sorted(RESULTS.glob("*/*.json")):
        name = f"{path.stem}-{path.parent.name}"
        yield path, read_json(path), RECORDINGS / f"{name}.json.gz", None
    for path in sorted(SUBMISSIONS.glob("*/*.json")):
        yield _read_submission_source(path)


def submission_driver(path: Path, report: dict, recording: dict, manifest: dict, submitter: str) -> tuple[str, dict]:
    summary, results = report["summary"], report["results"]
    driver = summary["brain"]
    local = recording.get("format") == "jev-local-recording/1"
    if (
        not manifest
        or manifest["format"] != MANIFEST_FORMAT
        or not (local or recording.get("format") == "jev-model-recording/1")
        or not re.fullmatch(r"[a-z][a-z0-9_-]{0,39}" if local else r"jev|(?:llm|decision):[a-z0-9_-]+", driver)
        or (local and driver in BUILT_IN)
        or len(results) != len(manifest["suite"]["drives"])
        or not results
        or summary.get("drives") != len(results)
        or summary.get("passed") != sum(r["pass"] for r in results)
        or any(r.get("stopped") or r.get("simulation_error") for r in recording["results"].values())
    ):
        raise ValueError(f"{rel(path)}: invalid submitted arena report or recording")
    return f"submission:{submitter}:{driver}", {
        "label": driver,
        "kind": "agent" if local else recording["header"].get("kind"),
        "model": manifest["model"],
        "about": f"External submission by @{submitter}",
        "submitter": submitter,
    }


def _build_challenge_row(
    path: Path, published: dict, recording_path: Path, submitter: str | None, drivers: dict
) -> dict:
    date, name = path.parent.name, path.stem
    if not calendar_day(date):
        raise ValueError(f"{rel(path)}: arena results date must be YYYY-MM-DD")
    summary, results = check_arena_shape(published)
    driver = summary["brain"]
    # (the guarded track, every earlier record's, or the open one: static/js/brain/tracks.js)
    track = summary.get("track") or "guarded"
    comparison_path = COMPARISON_SCORES / f"{name}-{date}.json"
    comparisons = {}
    row_results, cost, cost_basis, model, requested = results, summary.get("cost_usd") or 0, None, None, None
    sources = [rel(path)]
    recording = recording_facts(recording_path) if recording_path.is_file() else None
    manifest = checked_manifest(path, published, date, recording)
    replay_source = LEGACY_REPLAY_SOURCES.get(recording_path.name) if recording and manifest is None else None
    map_shas = {key: entry["fingerprint"] for key, entry in manifest["maps"].items()} if manifest else {}
    row_driver = driver
    if recording is not None:
        header = recording["header"]
        map_shas = header.get("maps") or map_shas
        if header.get("driver") != driver:
            raise ValueError(f"{rel(recording_path)} is for {header.get('driver')}, {rel(path)} for {driver}")
        if ((header.get("arena") or {}).get("track") or "guarded") != track:
            raise ValueError(f"{rel(recording_path)} and {rel(path)} were driven on different tracks")
        row_results = list(recording["results"].values())
        check_result_rows(row_results, "challenge")
        mine = {r["challenge"]: r["pass"] for r in results}
        theirs = {r["challenge"]: r["pass"] for r in row_results}
        if mine != theirs:
            raise ValueError(f"{rel(recording_path)} and {rel(path)} disagree on which drives passed")
        sources.append(rel(recording_path))
        models, billed, _ = recording["answered"]
        requested = header.get("model")
        model = models[0] if models and not submitter else requested
        if submitter:
            row_driver, info = submission_driver(path, published, recording, manifest, submitter)
            drivers.setdefault(row_driver, info)
            cost_basis = "as recorded in the submission"
        else:
            if billed is not None:
                cost, cost_basis = billed, "billed by the provider (usage.cost in each recorded reply)"
            drivers.setdefault(driver, model_driver(header, model))
    if not submitter and comparison_path.is_file():
        comparisons = read_json(comparison_path)
        if not isinstance(comparisons, dict) or any(not isinstance(value, dict) for value in comparisons.values()):
            raise ValueError(f"{rel(comparison_path)}: expected comparison measurement objects keyed by drive")
        if track != "guarded" or recording is None or comparisons.keys() - recording["results"].keys():
            raise ValueError(f"{rel(comparison_path)} must match its guarded source recording")
        sources.append(rel(comparison_path))
    if cost_basis is None:
        cost_basis = "none" if not cost else "as recorded (the cost the server counted for each call)"
    # (the whole set, every challenge and road test: a run of some of them, or one stopped part way,
    # is a pilot, never the full set)
    version = published.get("suite_version", LEGACY_SUITE)
    full = (
        summary.get("set") == "all"
        and not published.get("stopped")
        and not any(result.get("stopped") for result in row_results)
        and {r["challenge"] for r in row_results} == full_set_ids(version)
    )
    failed = [{"id": r["challenge"], "map": r["map"], "failures": r["failures"]} for r in row_results if not r["pass"]]
    return {
        "driver": row_driver,
        **({"submitter": submitter, "submitted_driver": driver} if submitter else {}),
        "suite_version": version,
        "suite": ("open" if track == "open" else "challenges") if full else "pilot",
        "track": track,
        "label": ("Open track: challenges and road tests" if track == "open" else "Challenges and road tests")
        if full
        else ", ".join(sorted(r["challenge"] for r in row_results)),
        "map": None,
        "preset": None,
        "weather": "authored per challenge",
        "passed": sum(1 for r in row_results if r["pass"]),
        "total": len(row_results),
        "date": date,
        "seed": "authored per challenge",
        "mode": "lockstep",
        "engine": summary.get("engine"),
        "model": model,
        "model_requested": requested if requested != model else None,
        **shares(row_results),
        "fallbacks": sum(r.get("fallbacks") or 0 for r in row_results),
        "hard_brakes": sum(r.get("hard_brakes") or 0 for r in row_results),
        "safety_brakes": sum(r.get("safety_brakes") or 0 for r in row_results),
        # (the open track: how often the car went on with a manoeuvre that broke a road rule)
        **({"flagged_choices": sum(r.get("flagged_choices") or 0 for r in row_results)} if track == "open" else {}),
        "driving_s": round(sum(r.get("time_s") or 0 for r in row_results), 1),
        "cost_usd": round(cost, 6),
        "cost_basis": cost_basis,
        "failed": failed,
        "drives": [published_drive(r, map_shas.get(r["map"]), comparisons.get(r["challenge"])) for r in row_results],
        "sources": sources,
        "recording": rel(recording_path) if recording_path.is_file() else None,
        **({"manifest": manifest} if manifest else {}),
        **({"replay_source_commit": replay_source} if replay_source else {}),
    }


def challenge_rows(drivers: dict) -> list[dict]:
    rows = []
    for path, published, recording_path, submitter in challenge_sources():
        try:
            rows.append(_build_challenge_row(path, published, recording_path, submitter, drivers))
        except _ARTIFACT_ERRORS as error:
            raise ValueError(_format_validation_error(path, error)) from error
    return rows


def full_set_ids(version: str = LEGACY_SUITE) -> set[str]:
    # The historical tables describe the original 62-drive set, independent of later authored edits.
    return set(CANONICAL.get(version, CANONICAL["v1"])["arena"]["drives"])


def committed_runs() -> list[Path]:
    """The runs in data/runs/ that git tracks. The folder is gitignored, so an ordinary saved benchmark
    lands there too; only committed baselines are published."""
    paths = sorted(RUNS.glob("*.json"))
    try:
        out = subprocess.run(["git", "ls-files", "-z", "--", str(RUNS)], cwd=ROOT, capture_output=True, check=True)
    except (OSError, subprocess.CalledProcessError):
        return paths  # not a git checkout (a release archive): everything there is what was shipped
    tracked = {(ROOT / p).resolve() for p in out.stdout.decode().split("\0") if p}
    return [p for p in paths if p.resolve() in tracked]


# Suite variants that are reported elsewhere, never as the plain suite's cell: held-out routes
# (bench/heldout.js, reported apart), destination parking, a time of day, features left out and
# covering rows.
VARIANT_KEYS = ("heldout", "park", "hour", "cover", "without", "track")


def check_result_rows(results: list, id_key: str) -> None:
    seen = set()
    for index, row in enumerate(results, 1):
        if not isinstance(row, dict) or not nonblank(row.get(id_key)) or type(row.get("pass")) is not bool:
            raise ValueError(
                f"result {index} needs a {'route' if id_key == 'id' else 'challenge'} ID and boolean verdict"
            )
        drive = row[id_key]
        if drive in seen:
            raise ValueError(f"run repeats {'route' if id_key == 'id' else 'challenge'} ID {drive!r}")
        seen.add(drive)
        if id_key == "challenge" and not nonblank(row.get("map")):
            raise ValueError(f"{drive}: missing arena map ID")
        failures = row.get("failures")
        if (failures is not None or (id_key == "challenge" and not row["pass"])) and (
            not isinstance(failures, list) or any(not nonblank(item) for item in failures)
        ):
            raise ValueError(f"{drive}: failures must be an array of labels")
        for field in ("time_s", "cost_usd"):
            if field in row and row[field] is not None and not nonnegative_number(row[field]):
                raise ValueError(f"{drive}: {field} must be a finite nonnegative number")
        for field in (
            "fallbacks",
            "hard_brakes",
            "safety_brakes",
            "collisions",
            "flagged_choices",
            "decisions",
            "model_decisions",
            "local_decisions",
            "fallback_decisions",
        ):
            if field in row and row[field] is not None and not nonnegative_integer(row[field]):
                raise ValueError(f"{drive}: {field} must be a nonnegative integer")
        for field in ("model_share", "local_share", "fallback_share"):
            if field in row and row[field] is not None and (not nonnegative_number(row[field]) or row[field] > 1):
                raise ValueError(f"{drive}: {field} must be between zero and one")
        if row["pass"] and row.get("simulation_error"):
            raise ValueError(f"{drive}: a simulation error cannot pass")


def check_summary_cost(summary):
    if summary.get("cost_usd") is not None and not nonnegative_number(summary["cost_usd"]):
        raise ValueError("summary cost_usd must be a finite nonnegative number")


def check_arena_shape(report):
    if not isinstance(report, dict) or not isinstance(report.get("summary"), dict):
        raise ValueError("arena report needs a summary object")
    summary, results = report["summary"], report.get("results")
    if not nonblank(summary.get("brain")):
        raise ValueError("arena summary needs a driver ID")
    if summary.get("track") not in (None, "guarded", "open"):
        raise ValueError("arena summary has an invalid track")
    if not isinstance(results, list):
        raise ValueError("arena report needs a results array")
    check_result_rows(results, "challenge")
    for key, expected in (("drives", len(results)), ("passed", sum(r["pass"] for r in results))):
        if key in summary and (not nonnegative_integer(summary[key]) or summary[key] != expected):
            raise ValueError(f"arena summary {key} disagrees with results")
    check_summary_cost(summary)
    return summary, results


def _check_run_shape(run):
    if not isinstance(run, dict):
        raise ValueError("benchmark run must be an object")
    config, summary, results = run.get("config"), run.get("summary"), run.get("results")
    if not isinstance(config, dict) or not isinstance(summary, dict):
        raise ValueError("benchmark run needs config and summary objects")
    for key, value in (
        ("name", run.get("name")),
        ("saved_at", run.get("saved_at")),
        ("driver", config.get("brain")),
        ("map", config.get("map")),
    ):
        if not nonblank(value):
            raise ValueError(f"benchmark run needs a {key}")
    try:
        datetime.fromisoformat(run["saved_at"].removesuffix("Z"))
    except ValueError as error:
        raise ValueError("benchmark saved_at must be an ISO date or timestamp") from error
    if not calendar_day(run["saved_at"][:10]):
        raise ValueError("benchmark saved_at date must be YYYY-MM-DD")
    stop_reason = run.get("stopped")
    if stop_reason is not None and not nonblank(stop_reason):
        raise ValueError("benchmark stopped must be a nonblank stop reason")
    if not isinstance(results, list) or (not results and not nonblank(stop_reason)):
        raise ValueError("benchmark run needs a results list with drives or a stop reason")
    check_result_rows(results, "id")
    check_summary_cost(summary)
    if summary.get("km") is not None and not nonnegative_number(summary["km"]):
        raise ValueError("benchmark summary km must be a finite nonnegative number")
    for field, minimum in (("seed", 0), ("count", 1), ("npcs", 0)):
        if field in config and (not nonnegative_integer(config[field]) or config[field] < minimum):
            raise ValueError(f"benchmark config {field} must be an integer >= {minimum}")
    if config.get("track") not in (None, "guarded", "open"):
        raise ValueError("benchmark config has an invalid track")


def _validated_run(path: Path, *, validate_filtered=False):
    run = read_json(path)
    if not isinstance(run, dict):
        raise ValueError("benchmark run must be an object")
    config = run.get("config")
    if not isinstance(config, dict):
        raise ValueError("benchmark run needs a config object")
    if config.get("map") is not None and not isinstance(config["map"], str):
        raise ValueError("benchmark map must be a string")
    if validate_filtered:
        _check_run_shape(run)
    key = map_key(config)
    if not validate_filtered and (not key or not run.get("results")):
        return None
    # (`is`, not `in`: hour 0 and cover row 0 are variants, and 0 == False in Python)
    variant = any(
        config.get(k) is not None and config.get(k) is not False and config.get(k) not in ([], "") for k in VARIANT_KEYS
    )
    version = run.get("suite_version", LEGACY_SUITE)
    manifest_data = run.get("manifest")
    manifest_suite = manifest_data.get("suite") if isinstance(manifest_data, dict) else None
    partial = bool(run.get("stopped")) or (isinstance(manifest_suite, dict) and manifest_suite.get("only") is True)
    excluded = (
        not key
        or not run.get("results")
        or (version == LEGACY_SUITE and (partial or variant))
        or (version == CUSTOM_SUITE and (config.get("heldout") or run.get("stopped")))
    )
    if excluded and not validate_filtered:
        return None
    if not validate_filtered:
        _check_run_shape(run)
    recording_path = RECORDINGS / f"{path.stem}.json.gz"
    recording = recording_facts(recording_path) if recording_path.is_file() else None
    manifest = checked_manifest(path, run, run["saved_at"][:10], recording)
    # Numbered held-out results are reported apart.
    skip = excluded or (variant and version != CUSTOM_SUITE)
    if skip and not validate_filtered:
        return None
    if recording is not None:
        header = recording["header"]
        published_verdicts = {r["id"]: r["pass"] for r in run["results"]}
        recorded_verdicts = {k: r["pass"] for k, r in recording["results"].items()}
        if (
            header.get("driver") != config["brain"]
            or header.get("bench") != config
            or published_verdicts != recorded_verdicts
        ):
            raise ValueError(f"{rel(recording_path)} disagrees with the driver, config or verdicts in {rel(path)}")
    if skip:
        return None
    preset = config.get("features") or "bare"
    group = (
        config.get("brain"),
        version,
        preset,
        key,
        config.get("weather") or "dry",
        config.get("count"),
        config.get("seed"),
        path if version == CUSTOM_SUITE else None,
    )
    return group, (run, path, manifest, recording, recording_path)


def run_rows(drivers: dict) -> list[dict]:
    newest = {}
    for path in committed_runs():
        try:
            entry = _validated_run(path)
        except _ARTIFACT_ERRORS as error:
            raise ValueError(_format_validation_error(path, error)) from error
        if entry is None:
            continue
        group, value = entry
        if group not in newest or value[0]["name"] > newest[group][0]["name"]:
            newest[group] = value
    rows = []
    for (driver, version, preset, key, weather, count, seed, _custom_path), (
        run,
        path,
        manifest,
        recording,
        recording_path,
    ) in newest.items():
        results, summary = run["results"], run.get("summary") or {}
        label = f"{MAP_NAMES.get(key, key)}, {preset} preset, {weather}"
        if version == CUSTOM_SUITE:
            label += f" · {run['name']}"
        sources, model, requested = [rel(path)], None, None
        if recording is not None:
            sources.append(rel(recording_path))
            models, _, _ = recording["answered"]
            header = recording["header"]
            requested = header.get("model")
            model = models[0] if models else requested
            drivers.setdefault(driver, model_driver(header, model))
        rows.append(
            {
                "driver": driver,
                "suite_version": version,
                "suite": "city" if preset == "city" else preset,
                "track": run["config"].get("track") or "guarded",
                "label": label,
                "map": key,
                "preset": preset,
                "weather": weather,
                "passed": sum(1 for r in results if r.get("pass")),
                "total": len(results),
                "date": run["saved_at"][:10],
                "seed": seed,
                "mode": run["config"].get("mode"),
                "traffic": run["config"].get("npcs"),
                "engine": run["config"].get("engine"),
                "model": model,
                "model_requested": requested if requested != model else None,
                **shares(results),
                "fallbacks": sum(r.get("fallbacks") or 0 for r in results),
                "hard_brakes": sum(r.get("hard_brakes") or 0 for r in results),
                "safety_brakes": sum(r.get("safety_brakes") or 0 for r in results),
                "driving_s": round(sum(r.get("time_s") or 0 for r in results), 1),
                "km": summary.get("km"),
                "cost_usd": round(summary.get("cost_usd") or 0, 6),
                "cost_basis": "none" if not summary.get("cost_usd") else "as the server counted it",
                "failed": [
                    {"id": r["id"], "map": key, "failures": r.get("failures") or []}
                    for r in results
                    if not r.get("pass")
                ],
                "sources": sources,
                "recording": rel(recording_path) if recording is not None else None,
                **({"manifest": manifest} if manifest else {}),
            }
        )
    return rows


def build() -> dict:
    drivers = {k: dict(v) for k, v in BUILT_IN.items()}
    rows = challenge_rows(drivers) + run_rows(drivers)
    order = {d: i for i, d in enumerate(ORDER)}
    suite_order = {"challenges": 0, "open": 1, "city": 2, "bare": 3, "pilot": 4}
    map_order = {k: i for i, k in enumerate([HOME_MAP] + sorted(k for k in MAP_NAMES if k != HOME_MAP))}
    weather_order = {w: i for i, w in enumerate(WEATHERS)}
    # newest first within equal keys (the sort is stable), so the README and the page, which take a driver's
    # first challenge row, show its latest full run, with earlier ones kept after it as history
    rows.sort(key=lambda r: r["date"] or "", reverse=True)
    rows.sort(
        key=lambda r: (
            order.get(r["driver"], len(order)),
            r["driver"],
            suite_order.get(r["suite"], 9),
            map_order.get(r["map"], 99),
            r["map"] or "",
            weather_order.get(r["weather"], 9),
            r["label"],
        )
    )
    used = list(dict.fromkeys(r["driver"] for r in rows))
    return {
        "format": FORMAT,
        "about": "Every result committed to this repository, one row per suite run, each with the files it came from. "
        "Built by scripts/build_results.py; do not edit by hand.",
        "maps": {
            k: MAP_NAMES.get(k, k)
            for k in sorted({r["map"] for r in rows if r["map"]}, key=lambda k: map_order.get(k, 99))
        },
        "drivers": {d: drivers.get(d, {"label": d, "kind": None, "model": None, "about": ""}) for d in used},
        "rows": rows,
    }


# The README table: one line per driver that ran the full challenge set or the city suite.
def money(value: float) -> str:
    return "$0" if not value else f"${value:,.2f}"


def percent(value) -> str:
    if value is None:
        return "n/a"
    text = f"{value * 100:.2f}".rstrip("0").rstrip(".")
    return f"{text}%"


def submission_markdown(value: str) -> str:
    return value.translate({**{ord(ch): f"&#{ord(ch)};" for ch in r"&<>|`[]()!*_~\#"}, 13: " ", 10: " "})


def readme_cohort(data: dict, rows: list[dict]) -> str:
    drivers = data["drivers"]
    city_rows = [r for r in rows if r["suite"] == "city"]
    home_map = data["maps"].get(HOME_MAP, MAP_NAMES[HOME_MAP])
    other_maps = sorted({r["map"] for r in city_rows if r["map"] != HOME_MAP})
    lines = [
        f"| Driver | Model | Challenges and road tests | Open track | City suite, {home_map}: {' · '.join(WEATHERS)} "
        f"| City suite, {len(other_maps)} other maps (dry) | Own decisions | Cost of the challenges |",
        "|---|---|---|---|---|---|---|---|",
    ]
    pilots = []
    for driver, info in drivers.items():
        mine = [r for r in rows if r["driver"] == driver]
        full = next((r for r in mine if r["suite"] == "challenges"), None)
        opened = next((r for r in mine if r["suite"] == "open"), None)
        city: dict[tuple[str, str], dict] = {}
        newest_city = sorted(
            (r for r in mine if r["suite"] == "city"),
            key=lambda r: (r["date"], r["sources"][0]),
            reverse=True,
        )
        for r in newest_city:
            city.setdefault((r["map"], r["weather"]), r)
        label = info["label"]
        submitter = info.get("submitter")
        if submitter:
            label = f"{submission_markdown(label)} (submitted by @{submitter})"
        if not full and not city and not opened:
            pilot = [r for r in mine if r["suite"] == "pilot"]
            if pilot:
                passed, total = sum(r["passed"] for r in pilot), sum(r["total"] for r in pilot)
                labels = [r["label"] for r in pilot]
                model = f"`{info['model']}`"
                if submitter:
                    labels = [submission_markdown(text) for text in labels]
                    model = submission_markdown(info["model"]) if info["model"] else "none"
                pilots.append(f"{label} ({model}) {passed}/{total} ({', '.join(labels)})")
            continue
        home = " · ".join(
            f"{city[(HOME_MAP, w)]['passed']}/{city[(HOME_MAP, w)]['total']}" if (HOME_MAP, w) in city else "–"
            for w in WEATHERS
        )
        others = [r for (k, w), r in city.items() if k != HOME_MAP and w == "dry"]
        other = f"{sum(r['passed'] for r in others)}/{sum(r['total'] for r in others)}" if others else "not run"
        if not city:
            home = "not run"

        def verdict(run):
            if not run:
                return "not run"
            text = f"{run['passed']}/{run['total']}"
            if run["failed"]:
                text = f"**{text}** (failed {', '.join('`' + f['id'] + '`' for f in run['failed'])})"
            return text

        challenge, open_track = verdict(full), verdict(opened)
        if opened:
            open_track += f", {opened.get('flagged_choices', 0)} flagged choices"
        share = full.get("model_share") if full else None
        model_id = (full or opened or next(iter(city.values()))).get("model")
        model = f"`{model_id}`" if model_id else "none"
        if submitter and model_id:
            model = submission_markdown(model_id)
        # (a driver run on the open track alone: that run's cost, said so)
        cost = money(full["cost_usd"]) if full else f"{money(opened['cost_usd'])} (open track)" if opened else "$0"
        lines.append(
            f"| {label} | {model} | {challenge} | {open_track} | {home} | {other} | {percent(share) if full and 'model_share' in full else 'n/a'} | {cost} |"
        )
    dates = sorted({r["date"] for r in rows if r["suite"] in ("challenges", "open", "city")})
    plain = lambda values: " or ".join(str(v) for v in sorted(set(values), key=str))  # noqa: E731
    notes = [
        "",
        f"Built from the committed records ({dates[0]} to {dates[-1]}) by `scripts/build_results.py`, which also writes "
        "[`data/results.json`](data/results.json) with each row's source files. The "
        f"[leaderboard]({LEADERBOARD}) shows published challenge results and the newest standard benchmark run "
        "for each suite version, driver, map, preset, weather, suite size and seed. "
        + (
            f"City runs in this table use suite seed {plain(r['seed'] for r in city_rows)}, "
            f"{plain(r['mode'] for r in city_rows)} clock, {plain(r['traffic'] for r in city_rows)} traffic cars. "
            if city_rows
            else ""
        )
        + "A driver's runs may come from different dates. "
        "On the open track the safety filter flags a manoeuvre that breaks a road rule instead of removing it, "
        "so the driver's own judgment decides ([how](docs/reference/benchmarks.md#benchmarks-and-validation)). "
        '"Flagged choices" counts how often the driver went on with one. '
        '"Own decisions" are the share of the challenge decisions the driver made itself, not answered locally or by a Rules fallback. '
        "Model drives are recorded under `data/recordings/` and replay without a key. "
        "Details, failures and costs: [model results](docs/model-results.md) and [Rules baseline](docs/rules-baseline.md).",
    ]
    if pilots:
        notes += ["", "One-challenge pilots: " + "; ".join(pilots) + "."]
    return "\n".join(lines + notes)


def readme_block(data: dict) -> str:
    blocks = []
    versions = sorted(CANONICAL, key=lambda version: int(version[1:]), reverse=True)
    for version in [*versions, LEGACY_SUITE]:
        title = "Legacy results" if version == LEGACY_SUITE else f"Suite {version}"
        rows = [r for r in data["rows"] if r["suite_version"] == version]
        if any(r["suite"] in ("challenges", "open", "city") for r in rows):
            blocks.append(f"### {title}\n\n" + readme_cohort(data, rows))
    return "\n\n".join(blocks)


def render(data: dict) -> str:
    return json.dumps(data, indent=1, ensure_ascii=False, allow_nan=False) + "\n"


def readme_with(text: str, block: str) -> str:
    pattern = re.compile(re.escape(START) + r".*?" + re.escape(END), re.S)
    if not pattern.search(text):
        raise ValueError(f"README.md has no {START} ... {END} block")
    if text.count(START) != 1 or text.count(END) != 1:
        raise ValueError("README.md must contain exactly one pair of results markers")
    newline = "\r\n" if "\r\n" in text else "\n"
    return pattern.sub(lambda _: newline.join((START, block.replace("\n", newline), END)), text, count=1)


def _format_validation_error(path: Path, err: Exception) -> str:
    label = rel(path)
    text = str(err)
    return text if text.startswith(f"{label}:") else f"{label}: {text}"


_ARTIFACT_ERRORS = (
    OSError,
    ValueError,
    KeyError,
    TypeError,
    AttributeError,
    EOFError,
    OverflowError,
    RecursionError,
    zlib.error,
)


def validate_all() -> list[str]:
    """Validate every result, submission, and committed run, returning all errors found."""
    errors: list[str] = []
    drivers: dict = {k: dict(v) for k, v in BUILT_IN.items()}
    for path in sorted(RESULTS.glob("*/*.json")):
        try:
            published = read_json(path)
            name = f"{path.stem}-{path.parent.name}"
            _build_challenge_row(path, published, RECORDINGS / f"{name}.json.gz", None, drivers)
        except _ARTIFACT_ERRORS as err:
            errors.append(_format_validation_error(path, err))
    for path in sorted(SUBMISSIONS.glob("*/*.json")):
        try:
            sub_path, report, tape, submitter = _read_submission_source(path)
            _build_challenge_row(sub_path, report, tape, submitter, drivers)
        except _ARTIFACT_ERRORS as err:
            errors.append(_format_validation_error(path, err))
    for path in committed_runs():
        try:
            _validated_run(path, validate_filtered=True)
        except _ARTIFACT_ERRORS as err:
            errors.append(_format_validation_error(path, err))
    return errors


def write_publication(files: tuple[tuple[Path, str], ...]) -> None:
    pending = []
    try:
        for path, text in files:
            with tempfile.NamedTemporaryFile(
                mode="wb", dir=path.parent, prefix=f".{path.name}.", delete=False
            ) as stream:
                stage = Path(stream.name)
                pending.append((stage, path))
                stream.write(text.encode("utf-8"))
            stage.chmod(S_IMODE(path.stat().st_mode) if path.exists() else 0o644)
        for stage, path in pending:
            os.replace(stage, path)
    finally:
        for stage, _ in pending:
            stage.unlink(missing_ok=True)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "--check", action="store_true", help="fail if data/results.json or the README block is out of date"
    )
    parser.add_argument(
        "--diff",
        action="store_true",
        help="print a unified diff when data/results.json or the README block is out of date (implies --check)",
    )
    parser.add_argument(
        "--validate-all",
        action="store_true",
        help="validate every manifest, result, run and submission and report all errors",
    )
    parser.add_argument("--json", action="store_true", help="emit the --validate-all verdict and errors as JSON")
    args = parser.parse_args(argv)
    if args.json and (not args.validate_all or args.check or args.diff):
        parser.error("--json requires --validate-all without --check or --diff")
    if args.validate_all:
        errors = validate_all()
        if args.json:
            print(json.dumps({"valid": not errors, "errors": errors}, ensure_ascii=False))
            return int(bool(errors))
        if errors:
            print(f"Validation failed with {len(errors)} error(s):", file=sys.stderr)
            for err in errors:
                print(f"  - {err}", file=sys.stderr)
            return 1
        if not args.check and not args.diff:
            print("All manifests, results, runs and submissions are valid.")
            return 0
    try:
        data = build()
        output, readme = render(data), readme_with(README.read_bytes().decode("utf-8"), readme_block(data))
    except _ARTIFACT_ERRORS as err:
        print(f"Could not generate published results: {err}", file=sys.stderr)
        return 1
    if args.check or args.diff:
        stale = []
        for p, want in ((OUTPUT, output), (README, readme)):
            try:
                current = p.read_bytes()
            except FileNotFoundError:
                current = None
            except OSError as error:
                print(f"Could not check {rel(p)}: {error}", file=sys.stderr)
                return 1
            if current != want.encode("utf-8"):
                stale.append(p.name)
                if args.diff:
                    label = rel(p)
                    diff = difflib.unified_diff(
                        (current or b"").decode("utf-8", errors="replace").splitlines(keepends=True),
                        want.splitlines(keepends=True),
                        fromfile=f"a/{label}",
                        tofile=f"b/{label}",
                    )
                    sys.stdout.writelines(diff)
        if stale:
            print(f"Out of date: {', '.join(stale)}. Run: uv run scripts/build_results.py", file=sys.stderr)
            return 1
        print(f"data/results.json and the README results table are up to date ({len(data['rows'])} rows).")
        return 0
    try:
        write_publication(((OUTPUT, output), (README, readme)))
    except OSError as error:
        print(f"Could not write published results: {error}", file=sys.stderr)
        return 1
    print(f"Wrote {rel(OUTPUT)} ({len(data['rows'])} rows) and the README results table.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
