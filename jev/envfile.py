"""Read and write the project's `.env` file safely.

The app can save the TypeSafe API key here so it survives restarts. Before writing, the
server checks that the file cannot be committed by accident (it must be gitignored and not already
tracked), writes atomically, and sets owner-only permissions. Nothing here ever prints a key.
"""

from __future__ import annotations

import os
import re
import shutil
import stat
import subprocess
import tempfile
from pathlib import Path
from typing import Dict, List, Optional

KEY_NAME = "TYPESAFE_API_KEY"
_LINE = re.compile(r"^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$")


class EnvFileError(Exception):
    pass


def parse(text: str) -> Dict[str, str]:
    values: Dict[str, str] = {}
    for line in text.splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        m = _LINE.match(line)
        if not m:
            continue
        value = m.group(2)
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        elif " #" in value:
            value = value.split(" #", 1)[0].rstrip()
        values[m.group(1)] = value
    return values


def read(path: Path) -> Dict[str, str]:
    try:
        return parse(path.read_text())
    except FileNotFoundError:
        return {}


def _git(root: Path, *args: str) -> Optional[subprocess.CompletedProcess]:
    if not shutil.which("git"):
        return None
    try:
        return subprocess.run(["git", "-C", str(root), *args], capture_output=True, text=True, timeout=5)
    except (OSError, subprocess.SubprocessError):
        return None


def in_git_repo(root: Path) -> bool:
    result = _git(root, "rev-parse", "--is-inside-work-tree")
    return bool(result and result.returncode == 0 and result.stdout.strip() == "true")


def gitignore_covers(root: Path, name: str = ".env") -> bool:
    """True when git (or, without git, the .gitignore file itself) says `name` is ignored."""
    if in_git_repo(root):
        result = _git(root, "check-ignore", "-q", name)
        if result is not None:
            return result.returncode == 0
    try:
        lines = [ln.strip() for ln in (root / ".gitignore").read_text().splitlines()]
    except FileNotFoundError:
        return False
    return any(ln in (name, "/" + name, name + "*", "*.env", ".env*") for ln in lines)


def tracked_by_git(root: Path, name: str = ".env") -> bool:
    if not in_git_repo(root):
        return False
    result = _git(root, "ls-files", "--error-unmatch", name)
    return bool(result and result.returncode == 0)


def preflight(root: Path, name: str = ".env") -> List[str]:
    """Reasons the key must NOT be written. Empty list means it is safe to proceed."""
    problems = []
    if tracked_by_git(root, name):
        problems.append("%s is tracked by git. Run `git rm --cached %s` first." % (name, name))
    if not gitignore_covers(root, name):
        problems.append("%s is not listed in .gitignore, so it could be committed." % name)
    if not os.access(root, os.W_OK):
        problems.append("The project folder is not writable.")
    return problems


def _atomic_write(path: Path, text: str) -> None:
    fd, tmp = tempfile.mkstemp(prefix=".env.", dir=str(path.parent))
    try:
        os.fchmod(fd, stat.S_IRUSR | stat.S_IWUSR)
        with os.fdopen(fd, "w") as handle:
            handle.write(text)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise
    os.chmod(path, stat.S_IRUSR | stat.S_IWUSR)


def write_key(root: Path, key: str, name: str = ".env") -> Path:
    """Insert or replace TYPESAFE_API_KEY in `.env`, keeping every other line intact."""
    problems = preflight(root, name)
    if problems:
        raise EnvFileError(" ".join(problems))
    if not key or any(ch.isspace() for ch in key) or len(key) > 512:
        raise EnvFileError("That does not look like an API key.")
    path = root / name
    try:
        lines = path.read_text().splitlines()
    except FileNotFoundError:
        lines = []
    new_line = "%s=%s" % (KEY_NAME, key)
    replaced = False
    for i, line in enumerate(lines):
        m = _LINE.match(line)
        if m and m.group(1) == KEY_NAME:
            lines[i] = new_line
            replaced = True
    if not replaced:
        lines.append(new_line)
    _atomic_write(path, "\n".join(lines).rstrip("\n") + "\n")
    return path


def forget_key(root: Path, name: str = ".env") -> bool:
    """Remove the key line. Deletes the file if nothing else is in it. Returns True if a key was removed."""
    path = root / name
    try:
        lines = path.read_text().splitlines()
    except FileNotFoundError:
        return False
    kept = []
    removed = False
    for line in lines:
        m = _LINE.match(line)
        if m and m.group(1) == KEY_NAME:
            removed = True
            continue
        kept.append(line)
    if not removed:
        return False
    if any(ln.strip() for ln in kept):  # keep the user's other settings and comments
        _atomic_write(path, "\n".join(kept).rstrip("\n") + "\n")
    else:
        path.unlink()
    return True


def permissions_ok(path: Path) -> Optional[bool]:
    """None if the file does not exist; False if group/other can read it."""
    try:
        mode = path.stat().st_mode
    except FileNotFoundError:
        return None
    return not (mode & (stat.S_IRGRP | stat.S_IROTH | stat.S_IWGRP | stat.S_IWOTH))
