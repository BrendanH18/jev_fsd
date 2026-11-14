"""Every relative Markdown link and anchor in the project docs resolves.

Covers README.md, AGENTS.md, ROADMAP.md and docs/**/*.md. Anchors follow GitHub's heading slugs.
Absolute URLs, site paths (`/bench`) and links inside code are not checked.
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path
from urllib.parse import unquote

import helpers  # noqa: F401  (fixes sys.path like the other tests)

ROOT = Path(__file__).resolve().parent.parent

FENCE = re.compile(r"^\s*(```|~~~)")
INLINE_CODE = re.compile(r"(`+)(?:(?!\1).)+?\1")
LINK = re.compile(r"!?\[(?:[^\[\]]|\[[^\]]*\])*\]\(\s*<?([^)\s>]*)>?(?:\s+\"[^\"]*\")?\s*\)")
REF_DEF = re.compile(r"^\s{0,3}\[[^\]]+\]:\s*<?(\S+?)>?(?:\s+.*)?$")
HEADING = re.compile(r"^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$")
HTML_ANCHOR = re.compile(r"<a\s+(?:name|id)=\"([^\"]+)\"", re.I)


def doc_files() -> list[Path]:
    files = [ROOT / "README.md", ROOT / "AGENTS.md", ROOT / "ROADMAP.md"]
    files += sorted((ROOT / "docs").rglob("*.md"))
    return [f for f in files if f.exists()]


def prose_lines(text: str):
    """(line number, line) outside fenced code blocks, with inline code removed."""
    fenced = False
    for i, line in enumerate(text.splitlines(), 1):
        if FENCE.match(line):
            fenced = not fenced
            continue
        if not fenced:
            yield i, INLINE_CODE.sub("", line)


def slug(heading: str) -> str:
    """GitHub's anchor for a heading's text (before de-duplication)."""
    text = re.sub(r"!\[([^\]]*)\]\([^)]*\)", r"\1", heading)  # images keep their alt text
    text = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", text)  # links keep their text
    text = re.sub(r"<[^>]+>", "", text)  # inline HTML tags vanish
    text = text.lower()
    text = re.sub(r"[^\w\- ]", "", text)  # punctuation goes, letters/digits/_/-/space stay
    return text.replace(" ", "-")


def anchors(path: Path, cache: dict[Path, set[str]]) -> set[str]:
    if path not in cache:
        seen: dict[str, int] = {}
        found: set[str] = set()
        fenced = False
        for line in path.read_text(encoding="utf-8").splitlines():
            if FENCE.match(line):
                fenced = not fenced
                continue
            if fenced:
                continue
            found.update(HTML_ANCHOR.findall(line))
            m = HEADING.match(line)
            if not m:
                continue
            base = slug(m.group(2))
            n = seen.get(base, 0)
            seen[base] = n + 1
            found.add(base if n == 0 else f"{base}-{n}")
        cache[path] = found
    return cache[path]


def broken_links() -> list[str]:
    cache: dict[Path, set[str]] = {}
    broken = []
    for doc in doc_files():
        for lineno, line in prose_lines(doc.read_text(encoding="utf-8")):
            targets = LINK.findall(line)
            ref = REF_DEF.match(line)
            if ref:
                targets.append(ref.group(1))
            for target in targets:
                if not target or re.match(r"^[a-z][a-z0-9+.-]*:", target, re.I) or target.startswith(("/", "//")):
                    continue
                file_part, _, anchor = target.partition("#")
                dest = (doc.parent / unquote(file_part)).resolve() if file_part else doc
                where = f"{doc.relative_to(ROOT)}:{lineno}: {target}"
                if not dest.exists():
                    broken.append(f"{where} (no such file)")
                    continue
                if anchor and dest.suffix == ".md" and unquote(anchor).lower() not in anchors(dest, cache):
                    broken.append(f"{where} (no such anchor)")
    return broken


class SlugTest(unittest.TestCase):
    def test_github_slugs(self):
        self.assertEqual(slug("High beams (`sim/high-beams.js`)"), "high-beams-simhigh-beamsjs")
        self.assertEqual(slug("Phase 6: grow the world again"), "phase-6-grow-the-world-again")
        self.assertEqual(slug("A ball, then a child"), "a-ball-then-a-child")
        self.assertEqual(slug("Rue Berri — Montréal"), "rue-berri--montréal")


class DocLinksTest(unittest.TestCase):
    def test_every_relative_link_resolves(self):
        broken = broken_links()
        self.assertEqual(broken, [], "broken links:\n" + "\n".join(broken))


if __name__ == "__main__":
    unittest.main()
