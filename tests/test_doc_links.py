"""Check repository docs and pin the link checker's interpretation of GitHub headings."""

import unittest
import contextlib
import io
import json
import subprocess
import sys
import tempfile
from pathlib import Path
from unittest.mock import patch

import helpers  # noqa: F401
from scripts import build_demo, demo_doc_links as docs


class SlugTest(unittest.TestCase):
    def test_github_slugs(self):
        self.assertEqual(docs.slug("High beams (`sim/high-beams.js`)"), "high-beams-simhigh-beamsjs")
        self.assertEqual(docs.slug("Phase 6: grow the world again"), "phase-6-grow-the-world-again")
        self.assertEqual(docs.slug("A ball, then a child"), "a-ball-then-a-child")
        self.assertEqual(docs.slug("Rue Berri — Montréal"), "rue-berri--montréal")


class DocLinksTest(unittest.TestCase):
    def test_every_relative_link_resolves(self):
        broken = docs.check()
        self.assertEqual(broken, [], "broken links:\n" + "\n".join(map(str, broken)))


class MarkdownScannerTests(unittest.TestCase):
    def test_code_fences_and_comments_do_not_create_links(self):
        text = """<!-- [missing](one.md)
also [missing](two.md) -->
> ~~~~md
> ```
> ~~~
> [also missing](three.md)
> ~~~~
``a ` [missing](four.md)``

    [missing](five.md)
[keep](actual.md)
"""
        self.assertEqual(list(docs.links(text)), [docs.Link(11, "actual.md")])

    def test_link_destinations_keep_path_syntax(self):
        text = (
            "[contains [nested] label](notes/thing(2).md)\n"
            "[long\nlabel](\n  <space name.md> 'Title')\n"
            '![image](asset\\(2\\).svg "Caption")\n'
            "[other](details.md (Title))\n"
            "[query](target.md?mode=1&other=2#heading)\n"
            "<img alt='test'\n src='media/a.svg'>\n"
            "<video poster='media/still.png'></video>\n"
            "<a href='target.md#header'>Go</a>\n"
        )
        found = set(docs.links(text))
        self.assertEqual(
            found,
            {
                docs.Link(1, "notes/thing(2).md"),
                docs.Link(2, "space name.md"),
                docs.Link(5, "asset(2).svg"),
                docs.Link(6, "details.md"),
                docs.Link(7, "target.md?mode=1&other=2#heading"),
                docs.Link(8, "media/a.svg"),
                docs.Link(10, "media/still.png"),
                docs.Link(11, "target.md#header"),
            },
        )

    def test_references_use_first_definition_with_case_and_whitespace_normalized(self):
        text = """[go][A Ref]
[other][A   REF]
[A Ref][]
[bad][missing]
[A ref]:
  manual.md#part
[a  ref]: ignored.md
"""
        self.assertEqual(
            set(docs.links(text)),
            {docs.Link(4, "[missing]"), docs.Link(5, "manual.md#part")},
        )

    def test_heading_slugs_include_setext_unicode_and_html_ids(self):
        source = """# A &amp; B ###
# A & B
# A & B-1
# Résumé
New chapter
===========
> ## Quoted title
## Title with `--save`
<h2 class="section" id='Pinned'>Pinned</h2>
<a title='Jump' name='old-anchor'></a>
<!-- <a id='hidden'></a> -->
```
# Invisible
```
"""
        self.assertEqual(
            docs.anchors(source),
            {
                "a--b",
                "a--b-1",
                "a--b-1-1",
                "résumé",
                "new-chapter",
                "quoted-title",
                "title-with---save",
                "Pinned",
                "old-anchor",
            },
        )

    def test_colliding_numbered_heading_advances_to_unused_suffix(self):
        self.assertEqual(docs.anchors("# Test\n# Test-1\n# Test"), {"test", "test-1", "test-2"})


class RepositoryLinkChecks(unittest.TestCase):
    def test_repository_resolution_and_diagnostics(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "docs").mkdir()
            (root / "docs/README.md").write_text("# Inside\n", encoding="utf-8")
            (root / "docs/target.md").write_text("\ufeff# Actual anchor\n", encoding="utf-8")
            (root / "docs/sample.html").write_text("<span id='MixedCase'></span>", encoding="utf-8")
            (root / "docs/code.js").write_text("one\ntwo\nthree", encoding="utf-8")
            src = root / "README.md"
            src.write_text(
                "[good](docs/target.md?tab=docs#actual-anchor)\n"
                "[directory](docs/#inside)\n"
                "[good](docs/sample.html#MixedCase)\n"
                "[good](docs/code.js#L1-L3)\n"
                "[case](docs/Target.md)\n"
                "[anchor](docs/target.md#actal-anchor)\n"
                "[bounds](docs/code.js#L2-L4)\n"
                "[reversed](docs/code.js#L3-L2)\n"
                "[bad encoding](docs/%zz.md)\n"
                "[invalid UTF8](docs/%fe.md)\n"
                "[control](docs/%00.md)\n"
                "[backslash](docs/%5C.md)\n"
                "[encoded slash](%2Fdocs/target.md)\n"
                "[outside](../unrelated.md)\n"
                "[no file](unknown.md)\n"
                "[bad hash](docs/sample.html#mixedcase)\n"
                "[external](https://example.invalid/docs/)\n"
                "[live app](/bench)\n",
                encoding="utf-8",
            )
            found = docs.check(root)
            self.assertEqual([item.line for item in found], list(range(5, 17)))
            self.assertEqual(found[0].suggestion, "target.md")
            self.assertEqual(found[1].suggestion, "#actual-anchor")
            self.assertEqual(found[8].reason, "encoded absolute path")
            self.assertEqual(found[9].reason, "link leaves the repository")
            self.assertEqual(found[10].reason, "no such file")

    def test_discovers_root_and_issue_template_docs(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / ".github/ISSUE_TEMPLATE").mkdir(parents=True)
            for name in ("CHANGELOG.md", ".github/ISSUE_TEMPLATE/report.md"):
                (root / name).write_text("[missing](unknown.md)", encoding="utf-8")
            self.assertEqual(
                [item.file for item in docs.check(root)], [".github/ISSUE_TEMPLATE/report.md", "CHANGELOG.md"]
            )

    def test_cli_annotations_escape_the_fields_and_return_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "notes,release.md"
            source.write_text("[broken](not%20available.md)\n", encoding="utf-8")
            output = io.StringIO()
            with patch.object(build_demo, "ROOT", root), contextlib.redirect_stdout(output):
                self.assertEqual(build_demo.main(["--format", "github", "--check-docs", str(source)]), 1)
            self.assertIn("::error file=notes%2Crelease.md,line=1::", output.getvalue())
            self.assertIn("not%2520available.md", output.getvalue())

    def test_unreadable_document_does_not_hide_other_failures(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "bad.md").write_bytes(b"\xff")
            (root / "other.md").write_text("[missing](unknown.md)", encoding="utf-8")
            findings = docs.check(root)
            self.assertIn("could not read document", findings[0].reason)
            self.assertEqual(findings[1].reason, "no such file")

    def test_cli_can_check_one_file_and_emit_json(self):
        cli = [sys.executable, str(docs.ROOT / "scripts/build_demo.py")]
        proc = subprocess.run(
            [*cli, "--format", "json", "--check-docs", "docs/browser-demo.md"],
            cwd=docs.ROOT,
            check=True,
            capture_output=True,
            text=True,
        )
        self.assertEqual(json.loads(proc.stdout), [])
        rejected = subprocess.run(
            [*cli, "--check-docs", "pyproject.toml"], cwd=docs.ROOT, capture_output=True, text=True
        )
        self.assertEqual(rejected.returncode, 2)
        self.assertIn("expected a Markdown file or directory", rejected.stderr)


if __name__ == "__main__":
    unittest.main()
