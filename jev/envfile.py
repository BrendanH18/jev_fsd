"""Read and write the project's `.env` file safely.

The app can save API keys here (the TypeSafe key, or a provider key entered in the LLM setup
dialog) so they survive restarts. Before writing, the server checks that the file cannot be committed
by accident (it must be gitignored and not already tracked), writes atomically, and sets owner-only
permissions. Nothing here ever prints a key.
"""

from __future__ import annotations

import os
import re
import shutil
import stat
import subprocess
import tempfile
import threading
from fnmatch import fnmatchcase
from pathlib import Path
from typing import Dict, List, Optional

KEY_NAME = "TYPESAFE_API_KEY"
VAR_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,63}$")
_QUOTED = re.compile(r"""^(['"])(.*?)\1(?:\s+#.*)?$""")
_LINE = re.compile(r"^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$")
_INLINE_COMMENT = re.compile(r"\s+#")
_PLAIN_KEY = re.compile(r"[A-Za-z0-9._~-]+")
_EDIT_LOCK = threading.Lock()
MAX_ENV_BYTES = 1024 * 1024


class EnvFileError(Exception):
    pass


def parse(text: str) -> Dict[str, str]:
    values: Dict[str, str] = {}
    for line in text.removeprefix("\ufeff").splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        m = _LINE.match(line)
        if not m:
            continue
        value, _ = _value_and_comment(m)
        quoted = _QUOTED.fullmatch(value)
        values[m.group(1)] = quoted.group(2) if quoted else value
    return values


def _value_and_comment(match: re.Match) -> tuple[str, str]:
    start, end = match.span(2)
    line = match.string
    raw = match.group(2)
    if (quoted := _QUOTED.fullmatch(raw)) is not None:
        end = start + quoted.end(2) + 1
    elif raw.startswith("#") and line[start - 1].isspace():
        end = start
    elif (comment := _INLINE_COMMENT.search(raw)) is not None:
        end = start + comment.start()
    return line[start:end], line[end:]


def read(path: Path) -> Dict[str, str]:
    try:
        return parse(_read_text(path))
    except FileNotFoundError:
        return {}


def _read_text(path: Path) -> str:
    info = path.stat()
    if not stat.S_ISREG(info.st_mode):
        raise OSError(f"{path.name} must be a regular file")
    if info.st_size > MAX_ENV_BYTES:
        raise OSError(f"{path.name} exceeds {MAX_ENV_BYTES} bytes")
    with path.open("rb") as handle:
        data = handle.read(MAX_ENV_BYTES + 1)
    if len(data) > MAX_ENV_BYTES:
        raise OSError(f"{path.name} exceeds {MAX_ENV_BYTES} bytes")
    try:
        return data.decode("utf-8")
    except UnicodeError:
        raise OSError(f"{path.name} must contain UTF-8 text") from None


def _git(root: Path, *args: str) -> Optional[subprocess.CompletedProcess]:
    if not shutil.which("git"):
        return None
    try:
        environ = {
            name: value
            for name, value in os.environ.items()
            if name not in ("GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR", "GIT_LITERAL_PATHSPECS")
        }
        return subprocess.run(
            ["git", "-C", str(root), *args],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            env=environ,
            timeout=5,
        )
    except (OSError, subprocess.SubprocessError):
        return None


def in_git_repo(root: Path) -> bool:
    result = _git(root, "rev-parse", "--is-inside-work-tree")
    return bool(result and result.returncode == 0 and result.stdout.strip() == "true")


def gitignore_covers(root: Path, name: str = ".env") -> bool:
    """True when git (or, without git, the .gitignore file itself) says `name` is ignored."""
    if in_git_repo(root):
        result = _git(root, "check-ignore", "-q", "--", name)
        return result is not None and result.returncode == 0
    absolute = root.resolve()
    if any((parent / ".git").exists() for parent in (absolute, *absolute.parents)):
        return False
    try:
        lines = _read_text(root / ".gitignore").splitlines()
    except OSError:
        return False
    # Without a repository only rely on simple patterns that match a basename. Honor
    # negation conservatively if a git wildmatch pattern cannot be evaluated here.
    ignored = False
    for line in lines:
        pattern = line.rstrip()
        if not pattern or pattern.startswith("#"):
            continue
        negate = pattern.startswith("!")
        if negate:
            pattern = pattern[1:]
        pattern = pattern.lstrip("/")
        if any(ch in pattern for ch in "\\["):
            if negate:
                ignored = False
            continue
        if "/" not in pattern and fnmatchcase(name, pattern):
            ignored = not negate
    return ignored


def tracked_by_git(root: Path, name: str = ".env") -> bool:
    if not in_git_repo(root):
        return False
    result = _git(root, "ls-files", "--error-unmatch", "--", name)
    return bool(result and result.returncode == 0)


def preflight(root: Path, name: str = ".env") -> List[str]:
    """Reasons the key must NOT be written. Empty list means it is safe to proceed."""
    if not _safe_name(name):
        return ["The key file name must be a single file name."]
    problems = []
    if tracked_by_git(root, name):
        problems.append("%s is tracked by git. Run `git rm --cached %s` first." % (name, name))
    if not gitignore_covers(root, name):
        problems.append("%s is not listed in .gitignore, so it could be committed." % name)
    if not os.access(root, os.W_OK):
        problems.append("The project folder is not writable.")
    if (root / name).is_symlink():
        problems.append("The key file is a symbolic link. Use a regular file in the project folder.")
    elif (root / name).exists() and not (root / name).is_file():
        problems.append("The key file must be a regular file.")
    return problems


def _safe_name(name: str) -> bool:
    return (
        isinstance(name, str)
        and name not in ("", ".", "..")
        and not any(ch in name for ch in "/\\:*?[]")
        and name.isprintable()
    )


def _atomic_write(path: Path, text: str) -> None:
    fd, tmp = tempfile.mkstemp(prefix=".env.", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def write_key(root: Path, key: str, name: str = ".env", var: str = KEY_NAME) -> Path:
    """Insert or replace `var` (TYPESAFE_API_KEY by default) in `.env`, keeping every other line intact."""
    _validate_var(var)
    if (
        not isinstance(key, str)
        or not key
        or len(key) > 512
        or any(not 33 <= ord(ch) <= 126 or ch in "\"'#" for ch in key)
    ):
        raise EnvFileError("That does not look like an API key.")
    with _EDIT_LOCK:
        problems = preflight(root, name)
        if problems:
            raise EnvFileError(" ".join(problems))
        path = root / name
        try:
            text = _read_text(path)
        except FileNotFoundError:
            text = ""
        value = key if _PLAIN_KEY.fullmatch(key) else f"'{key}'"
        _atomic_write(path, _edit_assignment(text, var, value))
        return path


def _validate_var(var: str) -> None:
    if not isinstance(var, str) or not VAR_NAME.fullmatch(var):
        raise EnvFileError("Not an environment variable name.")


def _edit_assignment(text: str, var: str, replacement: str | None) -> str:
    # Match parser line boundaries while retaining each untouched line's exact bytes.
    bom = "\ufeff" if text.startswith("\ufeff") else ""
    lines = text.removeprefix("\ufeff").splitlines(keepends=True)
    edited = []
    first_ending = re.search(r"\r\n|\r|\n", text)
    newline = first_ending.group() if first_ending is not None else "\n"
    remaining = replacement
    for line in lines:
        content = line.splitlines()[0]
        match = _LINE.fullmatch(content)
        if match is None or match.group(1) != var:
            edited.append(line)
        elif remaining is not None:
            ending = line[len(content) :]
            prefix = content[: match.start(2)]
            _, comment = _value_and_comment(match)
            # For an empty commented assignment the original spaces are in the
            # prefix, so also leave a separator between the value and comment.
            if comment.startswith("#"):
                comment = " " + comment
            edited.append(f"{prefix}{remaining}{comment}{ending}")
            remaining = None
    result = "".join(edited)
    if remaining is not None:
        if edited and edited[-1].splitlines()[0] == edited[-1]:
            result += newline
        result += f"{var}={remaining}{newline}"
    return bom + result


def forget_key(root: Path, name: str = ".env", var: str = KEY_NAME) -> bool:
    """Remove the `var` line. Deletes the file if nothing else is in it. Returns True if a key was removed."""
    _validate_var(var)
    if not _safe_name(name):
        raise EnvFileError("The key file name must be a single file name.")
    with _EDIT_LOCK:
        path = root / name
        if path.is_symlink():
            raise OSError("The key file is a symbolic link")
        try:
            text = _read_text(path)
        except FileNotFoundError:
            return False
        updated = _edit_assignment(text, var, None)
        if updated == text:
            return False
        if updated.lstrip("\ufeff").strip():
            _atomic_write(path, updated)
        else:
            path.unlink()
        return True


def permissions_ok(path: Path) -> Optional[bool]:
    """None if the file does not exist; False if group/other can read it."""
    try:
        mode = path.lstat().st_mode
    except FileNotFoundError:
        return None
    return stat.S_ISREG(mode) and not (mode & (stat.S_IRWXG | stat.S_IRWXO))
