#!/usr/bin/env python3
"""Tests for the subject site tools (tools/site). Run: python3 tests/test_site_tools.py"""

import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools" / "site"))

import add_book  # noqa: E402
import build_hub  # noqa: E402
import set_template_tag  # noqa: E402

PAGE = ('<script src="https://cdn.jsdelivr.net/gh/o/r@%(t)s/js/unlock.js">'
        '</script>')


def make_book(folder, book_id="b1", title="Book One", tag="3.0.0",
              views=("read", "quiz")):
    """Create a minimal valid book (as a private repo's output) in folder."""
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "index.html").write_text(PAGE % {"t": tag}, encoding="utf-8")
    (folder / "book.json").write_text(json.dumps({
        "id": book_id, "title": title,
        "views": {v: "index.html?view=" + v for v in views}}),
        encoding="utf-8")
    if "read" in views:
        (folder / "data" / "ch").mkdir(parents=True)
        (folder / "media").mkdir()
        (folder / "read.html").write_text(PAGE % {"t": tag}, encoding="utf-8")
        (folder / "data" / "manifest.enc").write_bytes(b"RQE1")
        (folder / "data" / "ch" / "c01.enc").write_bytes(b"RQE1")
        (folder / "media" / "f1.enc").write_bytes(b"RQE1")
    if "quiz" in views:
        (folder / "quiz" / "media").mkdir(parents=True)
        (folder / "quiz.html").write_text(PAGE % {"t": tag}, encoding="utf-8")
        (folder / "quiz" / "questions.enc").write_bytes(b"RQE1")
        (folder / "quiz" / "media" / "p1.enc").write_bytes(b"RQE1")


class SiteCase(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.site = self.tmp / "site"
        self.site.mkdir()
        (self.site / "subject.json").write_text('{"title": "T"}')
        (self.site / "index.html").write_text("<html></html>")
        self.src = self.tmp / "src"
        self.src.mkdir()

    def tearDown(self):
        shutil.rmtree(self.tmp)


class AddBookTests(SiteCase):
    def test_adds_a_valid_book_and_writes_books_json(self):
        make_book(self.src)
        self.assertEqual(add_book.add_book(self.src, "b1", self.site), [])
        self.assertTrue((self.site / "b1" / "data" / "manifest.enc").is_file())
        books = json.loads((self.site / "books.json").read_text())["books"]
        self.assertEqual(books[0]["id"], "b1")
        self.assertEqual(build_hub.main(["--check", "--subject-root", str(self.site)]), 0)

    def test_only_the_allowed_items_are_copied(self):
        make_book(self.src)
        (self.src / "references").mkdir()
        (self.src / "references" / "book.epub").write_bytes(b"plain")
        (self.src / "notes.docx").write_bytes(b"plain")
        self.assertEqual(add_book.add_book(self.src, "b1", self.site), [])
        self.assertEqual({p.name for p in (self.site / "b1").iterdir()},
                         {"index.html", "read.html", "quiz.html", "book.json",
                          "data", "media", "quiz"})

    def test_refuses_a_plain_file_in_data_or_media(self):
        make_book(self.src)
        (self.src / "media" / "cover.png").write_bytes(b"plain")
        self.assertTrue(add_book.add_book(self.src, "b1", self.site))
        self.assertFalse((self.site / "b1").exists())
        (self.src / "media" / "cover.png").unlink()
        (self.src / "quiz" / "questions.json").write_text("{}")
        self.assertTrue(add_book.add_book(self.src, "b1", self.site))
        (self.src / "quiz" / "questions.json").unlink()
        (self.src / "data" / "ch" / "c02.json").write_text("{}")
        self.assertTrue(add_book.add_book(self.src, "b1", self.site))

    def test_refuses_a_branch_a_v_prefix_or_mixed_tags(self):
        for bad in ("main", "v3.0.0", "3.0"):
            make_book(self.src / ("x" + bad), tag=bad)
            self.assertTrue(add_book.add_book(self.src / ("x" + bad), "b1", self.site), bad)
        make_book(self.src / "mix")
        (self.src / "mix" / "index.html").write_text(
            PAGE % {"t": "3.1.0"})
        self.assertTrue(add_book.add_book(self.src / "mix", "b1", self.site))

    def test_refuses_duplicate_ids_and_keeps_site_unchanged(self):
        make_book(self.src / "a", book_id="same")
        make_book(self.src / "b", book_id="same")
        self.assertEqual(add_book.add_book(self.src / "a", "a", self.site), [])
        before = (self.site / "books.json").read_text()
        self.assertTrue(add_book.add_book(self.src / "b", "b", self.site))
        self.assertEqual((self.site / "books.json").read_text(), before)
        self.assertFalse((self.site / "b").exists())

    def test_a_view_needs_its_files_and_its_files_need_the_view(self):
        make_book(self.src / "q", views=("quiz",))
        self.assertEqual(add_book.add_book(self.src / "q", "q", self.site), [])
        entries, _ = build_hub.check_site(self.site)
        self.assertEqual(entries[0]["views"], ["quiz"])
        make_book(self.src / "r", book_id="r1")
        (self.src / "r" / "quiz" / "questions.enc").unlink()
        self.assertTrue(add_book.add_book(self.src / "r", "r", self.site))
        make_book(self.src / "s", book_id="s1", views=("quiz",))
        (self.src / "s" / "data").mkdir()
        (self.src / "s" / "data" / "manifest.enc").write_bytes(b"RQE1")
        self.assertTrue(add_book.add_book(self.src / "s", "s", self.site))

    def test_missing_manifest_is_refused(self):
        make_book(self.src)
        (self.src / "data" / "manifest.enc").unlink()
        self.assertTrue(add_book.add_book(self.src, "b1", self.site))


class HubTests(SiteCase):
    def test_stale_books_json_fails_check(self):
        make_book(self.site / "b1")
        self.assertEqual(build_hub.main(["--check", "--subject-root", str(self.site)]), 1)
        self.assertEqual(build_hub.main(["--subject-root", str(self.site)]), 0)
        self.assertEqual(build_hub.main(["--check", "--subject-root", str(self.site)]), 0)

    def test_unexpected_top_level_file_is_a_problem(self):
        (self.site / "book.epub").write_bytes(b"plain")
        _, problems = build_hub.check_site(self.site)
        self.assertTrue(any("book.epub" in p for p in problems))

    def test_extra_item_in_a_book_folder_is_a_problem(self):
        make_book(self.site / "b1")
        (self.site / "b1" / "questions.json").write_text("{}")
        _, problems = build_hub.check_site(self.site)
        self.assertTrue(any("questions.json" in p for p in problems))


class TagTests(SiteCase):
    def test_sets_the_tag_in_every_book(self):
        make_book(self.site / "a")
        make_book(self.site / "b", book_id="b2")
        self.assertEqual(set_template_tag.main(["3.2.0", "--subject-root", str(self.site)]), 0)
        for name in ("a", "b"):
            for page in ("index.html", "read.html", "quiz.html"):
                text = (self.site / name / page).read_text()
                self.assertEqual(text.count("@3.2.0/"), 1)
                self.assertNotIn("@3.0.0", text)

    def test_refuses_a_branch_or_v_prefix(self):
        make_book(self.site / "a")
        for bad in ("main", "v3.2.0", "1.0"):
            self.assertEqual(set_template_tag.main([bad, "--subject-root", str(self.site)]), 1)
        self.assertIn("@3.0.0", (self.site / "a" / "index.html").read_text())


class SubjectJsonTests(SiteCase):
    def test_template_tag_must_be_exact(self):
        for bad in ("main", "v3.1.0", "3.1"):
            (self.site / "subject.json").write_text(
                json.dumps({"title": "T", "templateTag": bad}))
            _, problems = build_hub.load_subject(self.site)
            self.assertTrue(problems, bad)
        (self.site / "subject.json").write_text(
            json.dumps({"title": "T", "templateTag": "3.1.0"}))
        self.assertEqual(build_hub.load_subject(self.site)[1], [])


class PublishScriptTests(SiteCase):
    def git(self, *args, cwd):
        subprocess.run(["git", *args], cwd=cwd, check=True,
                       capture_output=True)

    def test_publishes_a_built_book_and_pushes(self):
        origin = self.tmp / "origin.git"
        self.git("init", "--bare", "-b", "main", str(origin), cwd=self.tmp)
        self.git("init", "-b", "main", cwd=self.site)
        self.git("remote", "add", "origin", str(origin), cwd=self.site)
        self.git("add", "-A", cwd=self.site)
        self.git("-c", "user.name=t", "-c", "user.email=t@t", "commit",
                 "-m", "start", cwd=self.site)
        self.git("push", "origin", "main", cwd=self.site)
        make_book(self.src)
        script = ROOT / "tools" / "site" / "publish_book.sh"
        result = subprocess.run(
            ["bash", str(script), str(self.src), "b1", str(self.site)],
            capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        check = self.tmp / "check"
        self.git("clone", str(origin), str(check), cwd=self.tmp)
        self.assertTrue((check / "b1" / "quiz" / "questions.enc").is_file())
        books = json.loads((check / "books.json").read_text())["books"]
        self.assertEqual(books[0]["folder"], "b1")


if __name__ == "__main__":
    unittest.main()
