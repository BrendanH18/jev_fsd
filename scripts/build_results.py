#!/usr/bin/env python3
"""Build data/results.json and the README's results table from the committed records (ROADMAP 2.7).

Every number comes from a committed file, and each row names it:

- the challenge set (60 challenges and 2 road tests): `data/results/<date>/<name>.json`, the
  per-drive results published with docs/model-results.md, and for a model driver the recording
  `data/recordings/<name>-<date>.json.gz` it replays from (its results must agree with the file);
- the seeded benchmark: `data/runs/*.json` (docs/rules-baseline.md), the newest run for each
  driver, map, preset and weather on a named map (older runs that name their map by hash predate
  the current packs).

    uv run scripts/build_results.py           # rewrite data/results.json and the README block
    uv run scripts/build_results.py --check   # fail if either is out of date

Python standard library only. The output has no timestamps, so it changes only with the records.
"""

from __future__ import annotations

import argparse
import gzip
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RUNS = ROOT / "data" / "runs"
RESULTS = ROOT / "data" / "results"
RECORDINGS = ROOT / "data" / "recordings"
OUTPUT = ROOT / "data" / "results.json"
README = ROOT / "README.md"
FORMAT = "jev-results/1"
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
ORDER = ["rules", "cautious", "jev", "llm:deepseek", "llm:luna", "decision:liquid-d1", "llm:granite"]
KIND_NOTES = {"jev": "decision model (TypeSafe)", "decision": "decision model", "llm": "LLM"}


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


def challenge_rows(drivers: dict) -> list[dict]:
    rows = []
    for path in sorted(RESULTS.glob("*/*.json")):
        date, name = path.parent.name, path.stem
        published = json.loads(path.read_text())
        summary, results = published["summary"], published["results"]
        driver = summary["brain"]
        recording_path = RECORDINGS / f"{name}-{date}.json.gz"
        row_results, cost, cost_basis, model, requested = results, summary.get("cost_usd") or 0, None, None, None
        sources = [rel(path)]
        if recording_path.is_file():
            recording = read_recording(recording_path)
            header = recording["header"]
            if header.get("driver") != driver:
                raise ValueError(f"{rel(recording_path)} is for {header.get('driver')}, {rel(path)} for {driver}")
            row_results = list(recording["results"].values())
            mine = {r["challenge"]: r["pass"] for r in results}
            theirs = {r["challenge"]: r["pass"] for r in row_results}
            if mine != theirs:
                raise ValueError(f"{rel(recording_path)} and {rel(path)} disagree on which drives passed")
            sources.append(rel(recording_path))
            models, billed, _ = answered_by(recording)
            requested = header.get("model")
            model = models[0] if models else requested
            if billed is not None:
                cost, cost_basis = billed, "billed by the provider (usage.cost in each recorded reply)"
            drivers.setdefault(driver, model_driver(header, model))
        if cost_basis is None:
            cost_basis = "none" if not cost else "as recorded (the cost the server counted for each call)"
        full = summary.get("set") == "all"
        failed = [
            {"id": r["challenge"], "map": r["map"], "failures": r["failures"]} for r in row_results if not r["pass"]
        ]
        rows.append(
            {
                "driver": driver,
                "suite": "challenges" if full else "pilot",
                "label": "60 challenges and 2 road tests"
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
                "driving_s": round(sum(r.get("time_s") or 0 for r in row_results), 1),
                "cost_usd": round(cost, 6),
                "cost_basis": cost_basis,
                "failed": failed,
                "drives": [
                    {"id": r["challenge"], "map": r["map"], "pass": r["pass"], "time_s": r.get("time_s")}
                    for r in row_results
                ],
                "sources": sources,
                "recording": rel(recording_path) if recording_path.is_file() else None,
            }
        )
    return rows


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
VARIANT_KEYS = ("heldout", "park", "hour", "cover", "without")


def run_rows() -> list[dict]:
    newest = {}
    for path in committed_runs():
        run = json.loads(path.read_text())
        config = run.get("config") or {}
        key = map_key(config)
        if not key or not run.get("results"):
            continue
        # (`is`, not `in`: hour 0 and cover row 0 are variants, and 0 == False in Python)
        if any(
            config.get(k) is not None and config.get(k) is not False and config.get(k) not in ([], "")
            for k in VARIANT_KEYS
        ):
            continue
        preset = config.get("features") or "bare"
        group = (
            config.get("brain"),
            preset,
            key,
            config.get("weather") or "dry",
            config.get("count"),
            config.get("seed"),
        )
        if group not in newest or run["name"] > newest[group][0]["name"]:
            newest[group] = (run, path)
    rows = []
    for (driver, preset, key, weather, count, seed), (run, path) in newest.items():
        results, summary = run["results"], run.get("summary") or {}
        rows.append(
            {
                "driver": driver,
                "suite": "city" if preset == "city" else preset,
                "label": f"{MAP_NAMES.get(key, key)}, {preset} preset, {weather}",
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
                "model": None,
                "model_requested": None,
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
                "sources": [rel(path)],
                "recording": None,
            }
        )
    return rows


def build() -> dict:
    drivers = {k: dict(v) for k, v in BUILT_IN.items()}
    rows = challenge_rows(drivers) + run_rows()
    order = {d: i for i, d in enumerate(ORDER)}
    suite_order = {"challenges": 0, "city": 1, "bare": 2, "pilot": 3}
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


def readme_block(data: dict) -> str:
    rows, drivers = data["rows"], data["drivers"]
    city_rows = [r for r in rows if r["suite"] == "city"]
    other_maps = sorted({r["map"] for r in city_rows if r["map"] != HOME_MAP})
    lines = [
        f"| Driver | Model | 60 challenges + 2 road tests | City suite, {data['maps'][HOME_MAP]}: {' · '.join(WEATHERS)} "
        f"| City suite, {len(other_maps)} other maps (dry) | Own decisions | Cost of the challenges |",
        "|---|---|---|---|---|---|---|",
    ]
    pilots = []
    for driver, info in drivers.items():
        mine = [r for r in rows if r["driver"] == driver]
        full = next((r for r in mine if r["suite"] == "challenges"), None)
        city = {(r["map"], r["weather"]): r for r in mine if r["suite"] == "city"}
        if not full and not city:
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
        challenge = "not run"
        if full:
            challenge = f"{full['passed']}/{full['total']}"
            if full["failed"]:
                challenge = f"**{challenge}** (failed {', '.join('`' + f['id'] + '`' for f in full['failed'])})"
        share = full.get("model_share") if full else None
        model = f"`{info['model']}`" if info.get("model") else "none"
        cost = money(full["cost_usd"]) if full else "$0"
        lines.append(
            f"| {info['label']} | {model} | {challenge} | {home} | {other} | {percent(share) if full and 'model_share' in full else 'n/a'} | {cost} |"
        )
    dates = sorted({r["date"] for r in rows if r["suite"] in ("challenges", "city")})
    plain = lambda values: " or ".join(str(v) for v in sorted(set(values), key=str))  # noqa: E731
    notes = [
        "",
        f"Built from the committed records ({dates[0]} to {dates[-1]}) by `scripts/build_results.py`, which also writes "
        "[`data/results.json`](data/results.json) with each row's source files; the "
        f"[leaderboard]({LEADERBOARD}) shows every run and drive. Each city cell is the newest committed run "
        f"(suite seed {plain(r['seed'] for r in city_rows)}, {plain(r['mode'] for r in city_rows)} clock, "
        f"{plain(r['traffic'] for r in city_rows)} traffic cars); a driver's runs may come from different dates. "
        '"Own decisions" are the share of the challenge decisions the driver made itself, not answered locally or by a Rules fallback. '
        "Model drives are recorded under `data/recordings/` and replay without a key. "
        "Details, failures and costs: [model results](docs/model-results.md) and [Rules baseline](docs/rules-baseline.md).",
    ]
    if pilots:
        notes += ["", "One-challenge pilots: " + "; ".join(pilots) + "."]
    return "\n".join(lines + notes)


def render(data: dict) -> str:
    return json.dumps(data, indent=1, ensure_ascii=False) + "\n"


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
