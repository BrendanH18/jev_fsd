#!/usr/bin/env python3
"""List the published tapes and report replay fidelity for a checkout in scheduled CI."""

import argparse
import contextlib
import json
import os
import re
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path, PurePosixPath, PureWindowsPath
from urllib.error import URLError
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "data" / "results.json"
RUNNERS = ("arena_node.mjs", "bench_node.mjs")


def replay_matrix(rows: list[dict], *, driver=None, track=None, suite=None, map_id=None) -> dict:
    if not isinstance(rows, list):
        raise ValueError("published rows must be an array")
    jobs = {}
    selected = set()
    for index, row in enumerate(rows, 1):
        if not isinstance(row, dict):
            raise ValueError(f"published row {index} must be an object")
        tape = row.get("recording")
        if tape is None:
            continue
        if not isinstance(tape, str) or not tape.strip() or not tape.endswith(".json.gz"):
            raise ValueError(f"published row {index} needs a .json.gz recording path")
        path = PurePosixPath(tape)
        if (
            PureWindowsPath(tape).drive
            or "\\" in tape
            or path.is_absolute()
            or ".." in path.parts
            or tape != path.as_posix()
            or any(ord(char) < 32 or ord(char) == 127 for char in tape)
        ):
            raise ValueError(f"published row {index} needs a normalized repository-relative recording path")
        manifest = row.get("manifest")
        if manifest is None:
            manifest = {}
        if not isinstance(manifest, dict):
            raise ValueError(f"{tape} needs a manifest object")
        tree = manifest.get("source_commit", row.get("replay_source_commit"))
        engine = manifest.get("engine", row.get("engine"))
        if "engine" in manifest and row.get("engine", engine) != engine:
            raise ValueError(f"{tape} has conflicting engines in its row and manifest")
        if "source_commit" in manifest and row.get("replay_source_commit", tree) != tree:
            raise ValueError(f"{tape} has conflicting source revisions in its row and manifest")
        version = row.get("suite_version", "legacy")
        if not isinstance(version, str) or not re.fullmatch(r"(?:legacy|custom|v[1-9][0-9]*)", version):
            raise ValueError(f"{tape} has an invalid suite version")
        if "suite_version" in manifest and manifest["suite_version"] != version:
            raise ValueError(f"{tape} has conflicting suite versions in its row and manifest")
        row_track = row.get("track", "guarded")
        if row_track not in ("open", "guarded"):
            raise ValueError(f"{tape} has an invalid replay track")
        if "track" in manifest and manifest["track"] != row_track:
            raise ValueError(f"{tape} has conflicting tracks in its row and manifest")
        row_map = row.get("map")
        if row_map is not None and (not isinstance(row_map, str) or not row_map.strip()):
            raise ValueError(f"{tape} has an invalid replay map")
        provenance = manifest.get("suite")
        if "suite" in manifest and (
            not isinstance(provenance, dict) or provenance.get("kind") != ("bench" if row_map else "arena")
        ):
            raise ValueError(f"{tape} has a manifest suite inconsistent with its replay runner")
        node = re.fullmatch(r"node v(\d+\.\d+\.\d+)", engine) if isinstance(engine, str) else None
        if not isinstance(tree, str) or not re.fullmatch(r"[0-9a-f]{40}", tree):
            raise ValueError(f"{tape} needs a full source revision for replay CI")
        if not node:
            raise ValueError(f"{tape} needs an exact Node version for replay CI")
        count = row.get("total")
        if type(count) is not int or not 0 < count <= 2**53 - 1:
            raise ValueError(f"{tape} needs a positive drive count for replay CI")
        passed = row.get("passed", 0)
        if type(passed) is not int or not 0 <= passed <= count:
            raise ValueError(f"{tape} has a passed count outside its drive count")
        if manifest.get("source_dirty", False) is not False:
            raise ValueError(f"{tape} was recorded with uncommitted changes")
        job = {
            "tape": tape,
            "tree": tree,
            "node": node[1],
            "runner": "bench_node.mjs" if row_map else "arena_node.mjs",
            "count": count,
        }
        if jobs.setdefault(tape, job) != job:
            raise ValueError(f"{tape} has conflicting replay settings in published rows")
        if all(
            expected is None or expected == actual
            for expected, actual in (
                (driver, row.get("driver")),
                (track, row_track),
                (suite, version),
                (map_id, row_map),
            )
        ):
            selected.add(tape)
    return {"include": [job for tape, job in jobs.items() if tape in selected]}


def replay_status(stdout: str, returncode: int, count: int) -> tuple[str, str]:
    if returncode:
        return "Error", f"Replay runner exited with status {returncode}"
    # Older trees have the same replay output but only support the combined verdict check.
    lines = [line for line in stdout.splitlines() if line.startswith("replay: ")]
    if not lines:
        return "Error", "Replay runner did not report fidelity"
    if len(lines) > 1:
        return "Error", f"Replay runner reported fidelity {len(lines)} times"
    exact = re.fullmatch(r"replay: all ([0-9]+) drives? played out as recorded", lines[0])
    if exact:
        if exact[1] != str(count):
            return "Error", f"Expected {count} drives, but the runner replayed {exact[1]}"
        return "Exact", f"{count} {'drive' if count == 1 else 'drives'} matched"
    drifted = re.fullmatch(r"replay: ([a-zA-Z0-9_.:-]+(?:, [a-zA-Z0-9_.:-]+)*) did not play out as recorded", lines[0])
    if drifted:
        ids = drifted[1].split(", ")
        if len(ids) > count:
            return "Error", f"Runner reported {len(ids)} drifted drives out of {count}"
        if len(ids) != len(set(ids)):
            return "Error", "Runner repeated a drifted drive ID"
        return "Drift", drifted[1]
    return "Error", f"Expected {count} drives. {lines[0]}"


def run_replay(checkout: Path, tape: Path, runner: str, count: int, *, timeout=1200) -> tuple[str, str]:
    if runner not in RUNNERS:
        raise ValueError("unknown replay runner")
    tape = tape.resolve()
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = str(sock.getsockname()[1])
    with (
        tempfile.TemporaryFile(mode="w+") as server_log,
        subprocess.Popen(
            ["uv", "run", "--locked", "server.py"],
            cwd=checkout,
            env={**os.environ, "PORT": port, "PYTHONUNBUFFERED": "1"},
            stdout=server_log,
            stderr=subprocess.STDOUT,
        ) as server,
    ):
        try:
            deadline = time.monotonic() + 60
            while server.poll() is None and time.monotonic() < deadline:
                try:
                    with urlopen(f"http://127.0.0.1:{port}/bench", timeout=2):
                        break
                except (URLError, TimeoutError):
                    time.sleep(1)
            else:
                status = server.poll()
                if status is not None:
                    return "Error", f"The local server exited before replay (status {status})"
                return "Error", "The local server did not become ready within 60 seconds"

            result = subprocess.run(
                [
                    "node",
                    "--experimental-default-type=module",
                    f"scripts/{runner}",
                    "--port",
                    port,
                    "--replay",
                    str(tape),
                ],
                cwd=checkout,
                capture_output=True,
                encoding="utf-8",
                errors="replace",
                timeout=timeout,
                check=False,
            )
            print(result.stdout, end="")
            print(result.stderr, end="")
            return replay_status(result.stdout, result.returncode, count)
        except subprocess.TimeoutExpired as error:
            for stream in (error.stdout, error.stderr):
                print(stream.decode(errors="replace") if isinstance(stream, bytes) else stream or "", end="")
            duration = "20 minutes" if timeout == 1200 else f"{timeout} seconds"
            return "Error", f"The replay exceeded {duration}"
        finally:
            if server.poll() is None:
                server.terminate()
                try:
                    server.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    server.kill()
                    server.wait()
            server_log.seek(0)
            print(server_log.read(), end="")


def positive_int(value):
    try:
        number = int(value)
    except ValueError as error:
        raise argparse.ArgumentTypeError("expected a positive integer") from error
    if number < 1 or number > 2**53 - 1:
        raise argparse.ArgumentTypeError("expected a positive integer")
    return number


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_subparsers(dest="mode", required=True)
    matrix = modes.add_parser("matrix", help="list the published tapes and their replay revisions")
    matrix.add_argument("--results", type=Path, default=OUTPUT, help="read an alternate published results index")
    matrix.add_argument("--runner", choices=RUNNERS, help="select arena or benchmark replay jobs")
    matrix.add_argument("--tape", action="append", help="select a specific published tape path (repeatable)")
    matrix.add_argument("--driver", help="select a published driver ID")
    matrix.add_argument("--track", choices=("guarded", "open"), help="select a replay track")
    matrix.add_argument("--suite-version", help="select a numbered, legacy or custom suite")
    matrix.add_argument("--map", dest="map_id", help="select benchmark replays for a map preset")
    run = modes.add_parser("run", help="report the result of a tape replay on a checkout")
    run.add_argument("checkout", type=Path)
    run.add_argument("tape", type=Path)
    run.add_argument("runner", choices=RUNNERS)
    run.add_argument("count", type=positive_int)
    run.add_argument("target", choices=("published", "main"))
    run.add_argument("--timeout", type=positive_int, default=1200, help="runner timeout in seconds")
    run.add_argument("--check", action="store_true", help="exit 1 on drift or runner error")
    run.add_argument("--json", action="store_true", help="print one JSON verdict and send runner output to stderr")
    args = parser.parse_args(argv)

    if args.mode == "matrix":
        try:
            index = json.loads(args.results.read_text(encoding="utf-8-sig"))
            if not isinstance(index, dict) or "rows" not in index:
                raise ValueError("expected a published index with rows")
            data = replay_matrix(
                index["rows"], driver=args.driver, track=args.track, suite=args.suite_version, map_id=args.map_id
            )
        except (OSError, ValueError, TypeError, KeyError, AttributeError) as error:
            parser.error(f"{args.results}: {error}")
        if args.runner:
            data["include"] = [job for job in data["include"] if job["runner"] == args.runner]
        if args.tape:
            requested = set(args.tape)
            missing = requested - {job["tape"] for job in data["include"]}
            if missing:
                parser.error(f"no matching replay jobs for: {', '.join(sorted(missing))}")
            data["include"] = [job for job in data["include"] if job["tape"] in requested]
        print(json.dumps(data, separators=(",", ":")))
        return 0

    tape = ROOT / args.tape
    try:
        if not tape.is_file():
            raise FileNotFoundError(f"Replay tape does not exist: {tape}")
        if not args.checkout.is_dir():
            raise FileNotFoundError(f"Replay checkout does not exist: {args.checkout}")
        if not (args.checkout / "scripts" / args.runner).is_file():
            raise FileNotFoundError(f"Replay runner is missing from the checkout: {args.runner}")
        redirect = contextlib.redirect_stdout(sys.stderr) if args.json else contextlib.nullcontext()
        with redirect:
            status, detail = run_replay(args.checkout, tape, args.runner, args.count, timeout=args.timeout)
    except OSError as error:
        status, detail = "Error", str(error)
    try:
        revision = subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"], cwd=args.checkout, text=True, stderr=subprocess.DEVNULL
        ).strip()
    except (OSError, subprocess.CalledProcessError):
        revision = "unknown revision"
    summary = f"{tape.name} on {args.target} ({revision}) — {status}. {detail}"
    annotation = summary.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")
    if args.json:
        print(
            json.dumps(
                {
                    "status": status,
                    "detail": detail,
                    "tape": str(args.tape),
                    "target": args.target,
                    "revision": revision,
                    "runner": args.runner,
                    "count": args.count,
                }
            )
        )
    else:
        print(summary if status == "Exact" else f"::warning::{annotation}")
    if summary_path := os.environ.get("GITHUB_STEP_SUMMARY"):
        try:
            with Path(summary_path).open("a", encoding="utf-8") as output:
                line = " ".join(summary.splitlines())
                escaped = re.sub(r"([\\`*_{}\[\]<>#!|])", r"\\\1", line)
                output.write(f"- {escaped}\n")
        except OSError as error:
            print(f"Could not write the replay step summary: {error}", file=sys.stderr)
    return int(args.check and status != "Exact")


if __name__ == "__main__":
    raise SystemExit(main())
