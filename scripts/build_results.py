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
import gzip
import hashlib
import html
import json
import math
import re
import subprocess
import sys
from datetime import date as calendar_date
from pathlib import Path

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
CANONICAL = {path.stem: json.loads(path.read_text()) for path in sorted((ROOT / "data" / "suites").glob("v*.json"))}
LEGACY_SUITE = "legacy"
CUSTOM_SUITE = "custom"
LEGACY_RESULTS_THROUGH = "2026-11-20"
START, END = "<!-- results:start -->", "<!-- results:end -->"
HOME_MAP = "kitsilano"
LEADERBOARD = "https://brendanh18.github.io/jev_fsd/results.html"
WEATHERS = ("dry", "fog", "rain", "snow")

# The bundled maps (jev/config.py PRESET_BBOXES), with the names the docs use. Add a new map here.
MAP_NAMES = {
    "kitsilano": "Kitsilano",
    "mount_pleasant": "Mount Pleasant",
    "victoria": "Victoria",
    "calgary": "Calgary",
    "edmonton": "Edmonton",
    "halifax": "Halifax",
    "montreal": "Montréal",
    "ottawa": "Ottawa",
    "quebec_city": "Québec City",
    "saskatoon": "Saskatoon",
    "toronto": "Toronto",
    "winnipeg": "Winnipeg",
}
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
    return path.relative_to(ROOT).as_posix()


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
            count = sum(r[f"{name}_decisions"] for r in results)
            out[f"{name}_decisions"] = count
            out[f"{name}_share"] = round_share(count / decisions)
        else:
            out[f"{name}_share"] = round_share(
                sum((r.get(f"{name}_share") or 0) * (r.get("decisions") or 0) for r in results) / decisions
            )
    return out


def read_recording(path: Path) -> dict:
    with gzip.open(path, "rt") if path.suffix == ".gz" else open(path) as f:
        return json.load(f)


_FACTS: dict[tuple, dict] = {}


def recording_facts(path: Path) -> dict:
    """What build() reads from a recording: everything but its drives, which it only counts, with
    answered_by() of them under "answered". Cached by file, modification time and size, since the
    tests build many times and the drives come to over a gigabyte once parsed. Callers must not
    change what it returns."""
    stat = path.stat()
    key = (path.resolve(), stat.st_mtime_ns, stat.st_size)
    if key not in _FACTS:
        full = read_recording(path)
        _FACTS[key] = {**{k: v for k, v in full.items() if k != "drives"}, "answered": answered_by(full)}
    return _FACTS[key]


def answered_by(recording: dict) -> tuple[list[str], float | None, int]:
    """The model ids that answered (from each reply's meta), the cost billed by the provider when
    every reply carries `usage.cost`, and the number of replies."""
    models, billed, replies, with_cost = {}, 0.0, 0, 0
    for drive in recording["drives"].values():
        for calls in drive.values():
            for call in calls:
                reply = call.get("response")
                if not reply:
                    continue
                replies += 1
                model = (reply.get("meta") or {}).get("model")
                if model:
                    models[model] = models.get(model, 0) + 1
                usage = ((reply.get("trace") or {}).get("response") or {}).get("usage") or {}
                if "cost" in usage:
                    billed += usage["cost"]
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
        return subprocess.run(
            ["node", "--experimental-default-type=module", "--input-type=module", "-e", script],
            cwd=ROOT,
            input=json.dumps(scenarios, allow_nan=False),
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
    except (FileNotFoundError, subprocess.CalledProcessError) as error:
        raise ValueError("Node 22 is required to fingerprint numbered benchmark tape scenarios") from error


def canonical_member(run: dict, manifest: dict, definition: dict) -> bool:
    """Whether the complete run is one of the frozen suite's members."""
    suite, maps = manifest["suite"], manifest["maps"]
    results = run["results"]
    if run.get("stopped") or suite.get("only") or any(result.get("stopped") for result in results):
        return False
    if suite["kind"] == "arena":
        drives = definition["arena"]["drives"]
        return (
            suite["set"] == "all"
            and suite["drives"] == drives
            and len(results) == len(drives)
            and {r["challenge"]: (r["map"], r.get("seed"), r.get("version")) for r in results}
            == {key: (d["map"], d["seed"], d["version"]) for key, d in drives.items()}
            and {key: value["fingerprint"] for key, value in maps.items()} == definition["maps"]
            and manifest["track"] in ("guarded", "open")
        )
    config, bench = run["config"], definition["bench"]
    if any(
        config.get(key) != value and not (config.get("heldout") and key in ("seed", "count"))
        for key, value in bench["config"].items()
    ):
        return False
    if (
        config.get("weather") not in bench["weathers"]
        or maps[config["map"]]["fingerprint"] != definition["maps"][config["map"]]
        or config.get("park")
        or "hour" in config
        or "cover" in config
        or config.get("without")
        or (config.get("track") or "guarded") != "guarded"
    ):
        return False
    if config.get("heldout"):
        seeds, count = bench["heldout"]["seeds"], bench["heldout"]["count"]
        expected = [f"s{seed}-{i + 1}" for seed in seeds for i in range(count)]
        if (
            config.get("seeds") != seeds
            or config["seed"] != seeds[0]
            or config["count"] != len(expected)
            or suite.get("route_sha") != bench["heldout"]["route_sha"]
        ):
            return False
    else:
        expected = bench["ids"]
        if suite.get("route_sha") != bench["route_sha"]:
            return False
    return suite["ids"] == expected and suite.get("generated_ids") == expected


def checked_manifest(path: Path, run: dict, date: str, recording: dict | None = None) -> dict | None:
    """Validate the declared run settings and bind the manifest to any model or local tape."""

    def require(ok, message):
        if not ok:
            raise ValueError(f"{rel(path)}: {message}")

    def fingerprint(value):
        return isinstance(value, str) and re.fullmatch(r"[0-9a-f]{16}", value)

    manifest = run.get("manifest")
    header = recording["header"] if recording is not None else {}
    version = run.get("suite_version", LEGACY_SUITE)
    require(version in (LEGACY_SUITE, CUSTOM_SUITE, *CANONICAL), "unknown suite_version")
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
        require(
            run.get("suite_version") == manifest.get("suite_version") == version,
            "report and manifest disagree on suite_version",
        )
    else:
        require(version == LEGACY_SUITE and "suite_version" not in manifest, "legacy manifests have no suite version")
    commit = manifest.get("source_commit")
    require(
        isinstance(commit, str) and re.fullmatch(r"[0-9a-f]{40}", commit) and manifest.get("source_dirty") is False,
        "the manifest must identify a clean source commit",
    )
    config, summary, results = run.get("config"), run["summary"], run["results"]
    settings = config if config is not None else summary
    driver, engine, track = settings["brain"], settings.get("engine"), settings.get("track") or "guarded"
    require(
        manifest.get("driver") == driver and manifest.get("engine") == engine and manifest.get("track") == track,
        "driver, engine or track disagrees with the manifest",
    )
    require(isinstance(manifest.get("engine_version"), str) and manifest["engine_version"], "missing V8 version")
    cost = round(sum(r.get("cost_usd") or 0 for r in results), 6)
    require(manifest.get("cost_usd") == summary.get("cost_usd") == cost, "cost disagrees with the manifest")
    maps, suite = manifest.get("maps"), manifest.get("suite")
    require(isinstance(maps, dict) and isinstance(suite, dict), "missing map or suite provenance")
    for data in maps.values():
        require(isinstance(data, dict) and fingerprint(data.get("fingerprint")), "invalid map fingerprint")
        components = data.get("components")
        require(
            isinstance(components, dict) and components and all(fingerprint(v) for v in components.values()),
            "invalid map component fingerprints",
        )
    if config is None:
        drives = suite.get("drives")
        require(
            suite.get("kind") == "arena" and suite.get("set") == summary.get("set") and isinstance(drives, dict),
            "arena set disagrees with the manifest",
        )
        require(
            all(isinstance(d, dict) and d.get("map") in maps and type(d.get("seed")) is int for d in drives.values()),
            "invalid authored map or seed",
        )
        require(
            all(r["challenge"] in drives and drives[r["challenge"]]["map"] == r["map"] for r in results),
            "arena drives disagree with the manifest",
        )
        if version != LEGACY_SUITE:
            require(
                all(all(r.get(key) == drives[r["challenge"]].get(key) for key in ("version", "seed")) for r in results),
                "arena versions or seeds disagree with the manifest",
            )
    else:
        key = config.get("map")
        require(
            suite.get("kind") == "bench"
            and suite.get("config") == config
            and suite.get("ids") == [r["id"] for r in results]
            and (suite.get("only") is True or suite.get("generated_ids", suite["ids"]) == suite["ids"]),
            "benchmark settings or routes disagree with the manifest",
        )
        require(
            set(maps) == {key} and maps[key].get("pack_version") == config.get("pack"),
            "map disagrees with the manifest",
        )
    if version in CANONICAL:
        require(canonical_member(run, manifest, CANONICAL[version]), f"run is outside the canonical {version} suite")
    model, prompt = manifest.get("model"), manifest.get("prompt_hash")
    is_model = driver == "jev" or driver.startswith(("decision:", "llm:"))
    is_local = recording is not None and recording.get("format") == "jev-local-recording/1"
    if is_model:
        require(isinstance(model, str) and model and fingerprint(prompt), "invalid model id or prompt fingerprint")
        require(recording is not None, "model runs need a corresponding recording")
        require(not is_local, "model runs need a model recording")
    elif is_local:
        require(config is None and model is None and fingerprint(prompt), "invalid local agent provenance")
    else:
        require(model is None and prompt is None, "non-model runs cannot declare a model or prompt")
    if is_model or is_local:
        require(header.get("manifest") == manifest, "recording and results disagree on their manifest")
        require(header.get("driver") == driver, "recording driver disagrees with the manifest")
        require(header.get("model") == model and header.get("engine") == engine, "recording model or engine disagrees")
        if driver.startswith("llm:"):
            require(header.get("versions", {}).get("llm_prompt") == prompt, "recording prompt disagrees")
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
            recorded_arena = header.get("arena") or {}
            require(
                (recorded_arena.get("track") or "guarded") == track, "arena recording track disagrees with the manifest"
            )
            require(
                recorded_arena.get("set") == suite["set"]
                and set(recorded_arena.get("ids", [])) == suite["drives"].keys(),
                "arena recording set or drive list disagrees with the manifest",
            )
            if version in CANONICAL:
                require(
                    not any(result.get("stopped") for result in recorded.values()),
                    "canonical arena recording contains a stopped drive",
                )
            # The arena report exports only a subset of the fields kept in the tape.
            require(
                all(
                    all(
                        key in recorded[result[id_key]] and recorded[result[id_key]][key] == value
                        for key, value in result.items()
                        if key != "suite_version"
                    )
                    and recorded[result[id_key]].get("seed") == suite["drives"][result[id_key]]["seed"]
                    for result in results
                ),
                "arena report and recording disagree on per-drive data",
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
            require(
                all(
                    comparable_bench_result(result) == comparable_bench_result(recorded[result[id_key]])
                    for result in results
                ),
                "benchmark report and recording disagree on per-drive data",
            )
    return manifest


def finite_number(value) -> bool:
    return type(value) is int or (type(value) is float and math.isfinite(value))


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
    if map_sha:
        drive["map_sha"] = map_sha
    drive["incident_counts"] = {
        k: result[k] for k in ("collisions", "hard_brakes", "safety_brakes") if finite_number(result.get(k))
    }
    if has_score_inputs(result):
        drive["score_inputs"] = {k: result[k] for k in ("arrived", *SCORE_NUMERIC, *SCORE_NULLABLE)}
    inputs = result.get("comparison_score_inputs")
    if comparison is not None:
        if not result.get("result_sha") or comparison.get("result_sha") != result["result_sha"] or inputs is not None:
            raise ValueError(f"{result['challenge']}: comparison measurements disagree with the recording")
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
            inputs.get("method") != "driven-corridor-v1"
            or not has_score_inputs(inputs)
            or any(inputs[k] != result.get(k) for k in shared)
        ):
            raise ValueError(f"{result['challenge']}: invalid driven-corridor score measurements")
        drive["comparison_score_inputs"] = inputs
    return drive


def challenge_sources():
    for path in sorted(RESULTS.glob("*/*.json")):
        name = f"{path.stem}-{path.parent.name}"
        yield path, json.loads(path.read_text()), RECORDINGS / f"{name}.json.gz", None
    for path in sorted(SUBMISSIONS.glob("*/*.json")):
        entry = json.loads(path.read_text())
        submitter, digest = entry.get("submitter"), entry.get("recording_sha256")
        day = path.parent.name
        try:
            valid_date = day == calendar_date.fromisoformat(day).isoformat()
        except ValueError:
            valid_date = False
        if (
            entry.get("format") != "jev-published-submission/1"
            or not isinstance(submitter, str)
            or not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,38}", submitter)
            or not isinstance(digest, str)
            or not re.fullmatch(r"[0-9a-f]{64}", digest)
            or not valid_date
            or not re.fullmatch(r"[a-z0-9][a-z0-9_-]*", path.stem)
            or not isinstance(entry.get("report"), dict)
        ):
            raise ValueError(f"{rel(path)}: invalid published submission")
        tape = path.with_suffix(".json.gz")
        if not tape.is_file():
            raise ValueError(f"{rel(path)}: the submitted recording is missing")
        checksum = hashlib.sha256()
        with tape.open("rb") as stream:
            while chunk := stream.read(1024 * 1024):
                checksum.update(chunk)
        if checksum.hexdigest() != digest:
            raise ValueError(f"{rel(tape)}: the submitted recording checksum has changed")
        yield path, entry["report"], tape, submitter


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


def challenge_rows(drivers: dict) -> list[dict]:
    rows = []
    for path, published, recording_path, submitter in challenge_sources():
        date, name = path.parent.name, path.stem
        summary, results = published["summary"], published["results"]
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
            comparisons = json.loads(comparison_path.read_text())
            if track != "guarded" or recording is None or comparisons.keys() - recording["results"].keys():
                raise ValueError(f"{rel(comparison_path)} must match its guarded source recording")
            sources.append(rel(comparison_path))
        if cost_basis is None:
            cost_basis = "none" if not cost else "as recorded (the cost the server counted for each call)"
        # (the whole set, every challenge and road test: a run of some of them, or one stopped part way,
        # is a pilot, never the full set)
        version = published.get("suite_version", LEGACY_SUITE)
        full = summary.get("set") == "all" and {r["challenge"] for r in row_results} == full_set_ids(version)
        failed = [
            {"id": r["challenge"], "map": r["map"], "failures": r["failures"]} for r in row_results if not r["pass"]
        ]
        rows.append(
            {
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
                **(
                    {"flagged_choices": sum(r.get("flagged_choices") or 0 for r in row_results)}
                    if track == "open"
                    else {}
                ),
                "driving_s": round(sum(r.get("time_s") or 0 for r in row_results), 1),
                "cost_usd": round(cost, 6),
                "cost_basis": cost_basis,
                "failed": failed,
                "drives": [
                    published_drive(r, map_shas.get(r["map"]), comparisons.get(r["challenge"])) for r in row_results
                ],
                "sources": sources,
                "recording": rel(recording_path) if recording_path.is_file() else None,
                **({"manifest": manifest} if manifest else {}),
                **({"replay_source_commit": replay_source} if replay_source else {}),
            }
        )
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


def run_rows(drivers: dict) -> list[dict]:
    newest = {}
    for path in committed_runs():
        run = json.loads(path.read_text())
        config = run.get("config") or {}
        key = map_key(config)
        if not key or not run.get("results"):
            continue
        # (`is`, not `in`: hour 0 and cover row 0 are variants, and 0 == False in Python)
        variant = any(
            config.get(k) is not None and config.get(k) is not False and config.get(k) not in ([], "")
            for k in VARIANT_KEYS
        )
        version = run.get("suite_version", LEGACY_SUITE)
        manifest_data = run.get("manifest")
        partial = isinstance(manifest_data, dict) and (
            run.get("stopped") or (manifest_data.get("suite") or {}).get("only") is True
        )
        if (version == LEGACY_SUITE and (partial or variant)) or (
            version == CUSTOM_SUITE and (config.get("heldout") or run.get("stopped"))
        ):
            continue
        recording_path = RECORDINGS / f"{path.stem}.json.gz"
        recording = recording_facts(recording_path) if recording_path.is_file() else None
        manifest = checked_manifest(path, run, run["saved_at"][:10], recording)
        if variant and version != CUSTOM_SUITE:  # Numbered held-out results are reported apart.
            continue
        if recording is not None:
            header = recording["header"]
            published_verdicts = {r["id"]: r["pass"] for r in run["results"]}
            recorded_verdicts = {key: r["pass"] for key, r in recording["results"].items()}
            if (
                header.get("driver") != config["brain"]
                or header.get("bench") != config
                or published_verdicts != recorded_verdicts
            ):
                raise ValueError(f"{rel(recording_path)} disagrees with the driver, config or verdicts in {rel(path)}")
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
        if group not in newest or run["name"] > newest[group][0]["name"]:
            newest[group] = (run, path, manifest, recording, recording_path)
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
        city = {(r["map"], r["weather"]): r for r in mine if r["suite"] == "city"}
        if not full and not city and not opened:
            pilot = [r for r in mine if r["suite"] == "pilot"]
            if pilot:
                passed, total = sum(r["passed"] for r in pilot), sum(r["total"] for r in pilot)
                pilots.append(
                    f"{info['label']} (`{info['model']}`) {passed}/{total} ({', '.join(r['label'] for r in pilot)})"
                )
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
        label = info["label"]
        if submitter := info.get("submitter"):
            label += f" (submitted by @{submitter})"
            if model_id:
                model = html.escape(model_id).translate(
                    str.maketrans({"|": "&#124;", "`": "&#96;", "[": "&#91;", "]": "&#93;", "\r": " ", "\n": " "})
                )
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
    return pattern.sub(lambda _: f"{START}\n{block}\n{END}", text, count=1)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "--check", action="store_true", help="fail if data/results.json or the README block is out of date"
    )
    args = parser.parse_args(argv)
    data = build()
    output, readme = render(data), readme_with(README.read_text(), readme_block(data))
    if args.check:
        stale = [p.name for p, want in ((OUTPUT, output), (README, readme)) if not p.is_file() or p.read_text() != want]
        if stale:
            print(f"Out of date: {', '.join(stale)}. Run: uv run scripts/build_results.py", file=sys.stderr)
            return 1
        print(f"data/results.json and the README results table are up to date ({len(data['rows'])} rows).")
        return 0
    OUTPUT.write_text(output)
    README.write_text(readme)
    print(f"Wrote {rel(OUTPUT)} ({len(data['rows'])} rows) and the README results table.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
