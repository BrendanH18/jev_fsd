"""Check repository-relative links and anchors in Markdown without network access."""

from __future__ import annotations

import bisect
import difflib
import html
import json
import re
import string
import sys
import unicodedata
from dataclasses import asdict, dataclass
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parent.parent
FENCE = re.compile(r"^ {0,3}(```+|~~~+)(.*)$")
QUOTE = re.compile(r"^ {0,3}>[ \t]?")
HEADING = re.compile(r"^ {0,3}#{1,6}(?:[ \t]+(.*)|$)")
SETEXT = re.compile(r"^ {0,3}(?:=+|-+)[ \t]*$")
DEFINITION = re.compile(r"^ {0,3}\[([^\[\]\n]+)\]:[ \t]*(.*)$")
LINE_ANCHOR = re.compile(r"L([1-9][0-9]*)(?:-L([1-9][0-9]*))?")
PERCENT_ERROR = re.compile(r"%(?![0-9a-f]{2})", re.I)
ESCAPE = re.compile(r"\\([" + re.escape(string.punctuation) + r"])")
TITLE = re.compile(r"""\s+(?:"[^"\n]*"|'[^'\n]*'|\([^()\n]*\))\s*\)""")
TICKS = re.compile(r"`+")
HTML_TAG = re.compile(
    r"""<!--.*?(?:-->|\Z)|</?(?:a|abbr|b|blockquote|br|code|dd|details|div|dl|dt|em|h[1-6]|i|iframe|img|kbd|li|ol|p|picture|pre|s|source|span|strong|sub|summary|sup|table|tbody|td|th|thead|tr|ul|video)(?=[\s/>])(?:[^'"<>]|"[^"]*"|'[^']*')*>""",
    re.S | re.I,
)


@dataclass(frozen=True)
class Link:
    line: int
    target: str


@dataclass(frozen=True)
class Finding:
    file: str
    line: int
    target: str
    reason: str
    suggestion: str | None = None

    def __str__(self) -> str:
        tip = f"; try {self.suggestion}" if self.suggestion else ""
        return f"{self.file}:{self.line}: {self.target} ({self.reason}{tip})"


def document_files(root: Path) -> list[Path]:
    return sorted({*root.glob("*.md"), *(root / "docs").rglob("*.md"), *(root / ".github").rglob("*.md")})


def _spaces(text: str) -> str:
    return re.sub(r"[^\n]", " ", text)


def _mask(source: str, spans) -> str:
    parts = []
    start = 0
    for first, last in spans:
        parts.extend((source[start:first], _spaces(source[first:last])))
        start = last
    return "".join([*parts, source[start:]])


def prose(source: str) -> tuple[str, str]:
    """Return scanner text and heading text, preserving line numbers in both."""
    source = _mask(source, (match.span() for match in re.finditer(r"<!--.*?(?:-->|\Z)", source, re.S)))
    lines = []
    fence = None
    for raw in source.splitlines(keepends=True):
        line = raw.rstrip("\r\n")
        while quote := QUOTE.match(line):
            raw = raw[quote.end() :]
            line = line[quote.end() :]
        match = FENCE.match(line)
        if fence:
            if match and match[1][0] == fence[0] and len(match[1]) >= len(fence) and not match[2].strip():
                fence = None
            lines.append(_spaces(raw))
        elif match and (match[1][0] == "~" or "`" not in match[2]):
            fence = match[1]
            lines.append(_spaces(raw))
        elif line.startswith(("    ", "\t")):
            lines.append(_spaces(raw))
        else:
            lines.append(raw)
    heading_source = "".join(lines)
    return _mask(heading_source, _inline_code_spans(heading_source)), heading_source


def _inline_code_spans(source: str):
    runs = list(TICKS.finditer(source))
    i = 0
    while i < len(runs):
        opening = runs[i]
        j = i + 1
        while j < len(runs) and "\n\n" not in source[opening.end() : runs[j].start()]:
            if len(opening[0]) == len(runs[j][0]):
                yield opening.start(), runs[j].end()
                i = j
                break
            j += 1
        i += 1


def clean(text: str) -> str:
    return html.unescape(ESCAPE.sub(r"\1", text))


def slug(heading: str) -> str:
    heading = re.sub(r"!?\[([^\]]*)\](?:\([^)]*\)|\[[^\]]*\])", r"\1", heading)
    heading = clean(HTML_TAG.sub("", heading)).strip().lower()
    return "".join(
        "-" if character in " \t" else character
        for character in heading
        if character in " \t-_" or unicodedata.category(character)[0] in "LMN"
    )


class HTMLLinks(HTMLParser):
    def __init__(self, text: str) -> None:
        super().__init__()
        self.links: list[Link] = []
        self.ids: set[str] = set()
        self.feed(text)
        self.close()

    def handle_starttag(self, tag, pairs):
        attrs = dict(pairs)
        if attrs.get("id"):
            self.ids.add(attrs["id"])
        if tag == "a" and attrs.get("name"):
            self.ids.add(attrs["name"])
        for attr in ("href", "src", "poster"):
            if attrs.get(attr):
                self.links.append(Link(self.getpos()[0], attrs[attr]))


def anchors(source: str, *, markdown: bool = True) -> set[str]:
    if not markdown:
        return HTMLLinks(source).ids
    scan, headings = prose(source)
    inline_html = _mask(scan, _tag_spans(scan, invert=True))
    explicit = HTMLLinks(inline_html).ids
    used = set()
    previous = ""
    for line in headings.splitlines():
        heading = HEADING.match(line)
        if heading:
            text = re.sub(r"[ \t]+#+[ \t]*$", "", heading[1] or "")
        elif previous and SETEXT.fullmatch(line):
            text = previous
        else:
            previous = (
                line.strip()
                if not DEFINITION.match(line) and not line.lstrip().startswith(("#", "|", "-", "*"))
                else ""
            )
            continue
        previous = ""
        base = slug(text)
        if not base:
            continue
        target, suffix = base, 0
        while target in used:
            suffix += 1
            target = f"{base}-{suffix}"
        used.add(target)
    return explicit | used


def _tag_spans(source: str, *, invert=False):
    offset = 0
    for match in HTML_TAG.finditer(source):
        if invert:
            yield offset, match.start()
        else:
            yield match.span()
        offset = match.end()
    if invert:
        yield offset, len(source)


def _close_bracket(text: str, start: int) -> int:
    depth = 1
    i = start + 1
    while i < len(text):
        char = text[i]
        if text.startswith("\n\n", i):
            break
        if char == "\\":
            i += 2
            continue
        if char == "[":
            depth += 1
        if char == "]":
            depth -= 1
            if not depth:
                return i
        i += 1
    return -1


def _destination(text: str, start: int) -> tuple[str, int] | None:
    """Read either <angle enclosed> or bare destinations, including balanced parentheses."""
    i = start
    while i < len(text) and text[i].isspace():
        if text.startswith("\n\n", i):
            return None
        i += 1
    start = i
    if text.startswith("<", start):
        end = text.find(">", start + 1)
        if end < 0 or "\n" in text[start:end]:
            return None
        return clean(text[start + 1 : end]), end + 1
    depth = 0
    while i < len(text):
        char = text[i]
        if char == "\\" and i + 1 < len(text) and text[i + 1] in string.punctuation:
            i += 2
            continue
        if char == ")" and not depth or char.isspace():
            break
        if char == "(":
            depth += 1
        if char == ")":
            depth -= 1
        i += 1
    if depth:
        return None
    return clean(text[start:i]), i


def _reference_key(label: str) -> str:
    return " ".join(clean(label).casefold().split())


def links(source: str):
    """Yield targets with source lines and explicit reference labels that lack a definition."""
    scan, _ = prose(source)
    html_source = _mask(scan, _tag_spans(scan, invert=True))
    yield from HTMLLinks(html_source).links
    scan = _mask(scan, _tag_spans(scan))
    definitions = {}
    spans = []
    offset = 0
    line_starts = [0]
    for number, line in enumerate(scan.splitlines(keepends=True), 1):
        if match := DEFINITION.match(line):
            raw = match[2].rstrip("\r\n")
            if not raw:
                raw = scan[offset + len(line) :].split("\n", 1)[0]
            if entry := _destination(raw, 0):
                target, _ = entry
                if target:
                    key = _reference_key(match[1])
                    if key not in definitions:
                        definitions[key] = target
                        yield Link(number, target)
                    spans.append((offset, offset + len(line)))
        offset += len(line)
        line_starts.append(offset)
    scan = _mask(scan, spans)
    i = 0
    while i < len(scan):
        if scan[i] == "\\":
            i += 2
            continue
        if scan[i] != "[":
            i += 1
            continue
        end = _close_bracket(scan, i)
        if end < 0:
            i += 1
            continue
        line = bisect.bisect_right(line_starts, i)
        if scan.startswith("(", end + 1) and (entry := _destination(scan, end + 2)):
            target, last = entry
            last_non_space = last + len(scan[last:]) - len(scan[last:].lstrip())
            title = TITLE.match(scan, last)
            if scan.startswith(")", last_non_space) or title:
                if target:
                    yield Link(line, target)
                i = title.end() if title else last_non_space + 1
                continue
        if scan.startswith("[", end + 1):
            ref_end = _close_bracket(scan, end + 1)
            if ref_end > 0:
                key = _reference_key(scan[end + 2 : ref_end] or scan[i + 1 : end])
                if key not in definitions:
                    yield Link(line, f"[{key}]")
                i = ref_end + 1
                continue
        i += 1


def local_parts(target: str) -> tuple[str, str] | None:
    parts = urlsplit(target)
    if parts.scheme or parts.netloc or target.startswith("/"):
        return None
    if PERCENT_ERROR.search(parts.path) or PERCENT_ERROR.search(parts.fragment):
        raise ValueError("invalid percent escape")
    path, anchor = unquote(parts.path, errors="strict"), unquote(parts.fragment, errors="strict")
    if any(ord(character) < 32 or character == "\\" for character in path):
        raise ValueError("invalid character in relative path")
    if path.startswith("/"):
        raise ValueError("encoded absolute path")
    return path, anchor


def case_mismatch(root: Path, candidate: Path) -> str | None:
    current = root
    for name in candidate.parts:
        if name == "..":
            current = current.parent
            continue
        if not current.is_dir():
            return None
        names = {entry.name for entry in current.iterdir()}
        if name not in names:
            return next((entry for entry in sorted(names) if entry.casefold() == name.casefold()), None)
        current /= name
    return None


def _read_cached(path: Path, cache):
    if path not in cache:
        cache[path] = path.read_text(encoding="utf-8-sig")
    return cache[path]


def check(root: Path = ROOT, files=None) -> list[Finding]:
    root = root.resolve()
    texts, anchor_cache = {}, {}
    findings = []
    for doc in document_files(root) if files is None else files:
        name = doc.relative_to(root).as_posix()
        if not doc.resolve().is_relative_to(root):
            findings.append(Finding(name, 1, name, "document points outside the repository"))
            continue
        try:
            source = _read_cached(doc, texts)
        except (OSError, UnicodeError) as error:
            findings.append(Finding(name, 1, name, f"could not read document: {error}"))
            continue
        for link in links(source):
            try:
                if link.target.startswith("[") and link.target.endswith("]"):
                    findings.append(Finding(name, link.line, link.target, "undefined reference link"))
                    continue
                parts = local_parts(link.target)
                if parts is None:
                    continue
                relative, anchor = parts
                candidate = doc.parent / relative if relative else doc
                dest = candidate.resolve()
                if not dest.is_relative_to(root):
                    findings.append(Finding(name, link.line, link.target, "link leaves the repository"))
                    continue
                if alternative := case_mismatch(root, candidate.relative_to(root)):
                    findings.append(Finding(name, link.line, link.target, "path uses incorrect case", alternative))
                    continue
                if not dest.exists():
                    findings.append(Finding(name, link.line, link.target, "no such file"))
                    continue
                if not anchor:
                    continue
                if dest.is_dir():
                    dest = dest / "README.md"
                    if not dest.is_file():
                        findings.append(Finding(name, link.line, link.target, "directory anchor requires a README.md"))
                        continue
                extension = dest.suffix.lower()
                if extension in (".md", ".html", ".htm"):
                    if dest not in anchor_cache:
                        anchor_cache[dest] = anchors(_read_cached(dest, texts), markdown=extension == ".md")
                    valid = anchor_cache[dest]
                    if anchor not in valid:
                        match = difflib.get_close_matches(anchor, sorted(valid), n=1)
                        findings.append(
                            Finding(name, link.line, link.target, "no such anchor", f"#{match[0]}" if match else None)
                        )
                elif line_range := LINE_ANCHOR.fullmatch(anchor):
                    start, end = (int(line_range[1]), int(line_range[2] or line_range[1]))
                    if end < start or end > len(_read_cached(dest, texts).splitlines()):
                        findings.append(Finding(name, link.line, link.target, "line range is outside the file"))
            except (OSError, ValueError, RuntimeError) as error:
                findings.append(Finding(name, link.line, link.target, str(error)))
    return sorted(set(findings), key=lambda item: (item.file, item.line, item.target, item.reason))


def check_paths(root: Path, paths: list[Path]) -> list[Finding]:
    files = set()
    for path in paths:
        path = path.resolve()
        if not path.is_relative_to(root):
            raise ValueError(f"path leaves the repository: {path}")
        if path.is_dir():
            files.update(path.rglob("*.md"))
        elif path.is_file() and path.suffix.lower() == ".md":
            files.add(path)
        else:
            raise ValueError(f"expected a Markdown file or directory: {path}")
    return check(root, sorted(files) if paths else None)


def emit_findings(findings: list[Finding], output_format: str) -> int:
    if output_format == "json":
        print(json.dumps([asdict(item) for item in findings], indent=2))
    elif output_format == "github":
        for item in findings:
            message = str(item).replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")
            file = item.file.replace("%", "%25").replace(",", "%2C").replace(":", "%3A")
            print(f"::error file={file},line={item.line}::{message}")
    elif findings:
        print("\n".join(map(str, findings)), file=sys.stderr)
    else:
        print("All repository-relative documentation links resolve.")
    return int(bool(findings))
