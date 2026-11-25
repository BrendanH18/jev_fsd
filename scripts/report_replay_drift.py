#!/usr/bin/env python3
"""List the published tapes and report replay fidelity for a checkout in scheduled CI."""

import argparse
import json
import os
import re
import socket
import subprocess
import tempfile
import time
from pathlib import Path
from urllib.error import URLError
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "data" / "results.json"
RUNNERS = ("arena_node.mjs", "bench_node.mjs")


def replay_matrix(rows: list[dict]) -> dict:
    jobs = {}
    for row in rows:
        tape = row.get("recording")
        if not tape:
            continue
        manifest = row.get("manifest") or {}
        if not isinstance(manifest, dict):
            raise ValueError(f"{tape} needs a manifest object")
        tree = manifest.get("source_commit") or row.get("replay_source_commit")
        engine = manifest.get("engine") or row.get("engine")
        node = re.fullmatch(r"node v(\d+\.\d+\.\d+)", engine) if isinstance(engine, str) else None
        if not isinstance(tree, str) or not re.fullmatch(r"[0-9a-f]{40}", tree) or not node:
            raise ValueError(f"{tape} needs a source revision and a Node version for replay CI")
        count = row.get("total")
        if not isinstance(count, int) or isinstance(count, bool) or count < 1:
            raise ValueError(f"{tape} needs a positive drive count for replay CI")
        if manifest.get("source_dirty", False) is not False:
            raise ValueError(f"{tape} was recorded with uncommitted changes")
        job = {
            "tape": tape,
            "tree": tree,
            "node": node[1],
            "runner": "bench_node.mjs" if row.get("map") else "arena_node.mjs",
            "count": count,
        }
        if jobs.setdefault(tape, job) != job:
            raise ValueError(f"{tape} has conflicting replay settings in published rows")
    return {"include": list(jobs.values())}


def replay_status(stdout: str, returncode: int, count: int) -> tuple[str, str]:
    if returncode:
        return "Error", f"Replay runner exited with status {returncode}"
    # Older trees have the same replay output but only support the combined verdict check.
    lines = [line for line in stdout.splitlines() if line.startswith("replay: ")]
    if len(lines) != 1:
        return "Error", "Replay runner did not report fidelity for one tape"
    if lines[0] == f"replay: all {count} drives played out as recorded":
        return "Exact", f"{count} {'drive' if count == 1 else 'drives'} matched"
    drifted = re.fullmatch(r"replay: ([\w-]+(?:, [\w-]+)*) did not play out as recorded", lines[0])
    if drifted:
        ids = drifted[1].split(", ")
        if len(ids) <= count and len(ids) == len(set(ids)):
            return "Drift", drifted[1]
    return "Error", f"Expected {count} drives. {lines[0]}"


def run_replay(checkout: Path, tape: Path, runner: str, count: int, *, timeout=1200) -> tuple[str, str]:
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
                return "Error", "The local server did not start"

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
                text=True,
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
    number = int(value)
    if number < 1:
        raise argparse.ArgumentTypeError("expected a positive integer")
    return number


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_subparsers(dest="mode", required=True)
    matrix = modes.add_parser("matrix", help="list the published tapes and their replay revisions")
    matrix.add_argument("--results", type=Path, default=OUTPUT, help="read an alternate published results index")
    matrix.add_argument("--runner", choices=RUNNERS, help="select arena or benchmark replay jobs")
    matrix.add_argument("--tape", action="append", help="select a specific published tape path (repeatable)")
    run = modes.add_parser("run", help="report the result of a tape replay on a checkout")
    run.add_argument("checkout", type=Path)
    run.add_argument("tape", type=Path)
    run.add_argument("runner", choices=RUNNERS)
    run.add_argument("count", type=positive_int)
    run.add_argument("target", choices=("published", "main"))
    run.add_argument("--timeout", type=positive_int, default=1200, help="runner timeout in seconds")
    run.add_argument("--check", action="store_true", help="exit 1 on drift or runner error")
    args = parser.parse_args()

    if args.mode == "matrix":
        try:
            data = replay_matrix(json.loads(args.results.read_text(encoding="utf-8-sig"))["rows"])
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
    print(summary if status == "Exact" else f"::warning::{annotation}")
    if summary_path := os.environ.get("GITHUB_STEP_SUMMARY"):
        with Path(summary_path).open("a") as output:
            output.write(f"- {' '.join(summary.splitlines())}\n")
    return int(args.check and status != "Exact")


if __name__ == "__main__":
    raise SystemExit(main())
