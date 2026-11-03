#!/usr/bin/env python3
"""Tests for the bank-building tools (no browser needed).

    python3 tests/test_tools.py

Splits banks/how-to-read-a-book.json into part files, plans and merges
them again, and checks the result equals the original. Also checks that
the merge refuses bad parts.
"""

import json
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TOOLS = ROOT / "tools"
SAMPLE = ROOT / "banks" / "how-to-read-a-book.json"
failures = []


def check(name, condition):
    """Print PASS or FAIL for one check and remember failures."""
    print(f"  {'PASS' if condition else 'FAIL'}  {name}")
    if not condition:
        failures.append(name)


def run(*arguments, cwd):
    """Run a tool and return the finished process."""
    return subprocess.run([sys.executable, *map(str, arguments)],
                          cwd=cwd, capture_output=True, text=True)


def write_chapters_file(bank, folder):
    """A chapters.json for the sample bank, one chapter per unit."""
    units = []
    for unit in bank["unitSummaries"]:
        concepts = [c for c in bank["concepts"] if c["unit"] == unit]
        units.append({
            "unit": unit, "unitTitle": concepts[0]["unitTitle"],
            "unitSummary": bank["unitSummaries"][unit],
            "pages": 20.0, "idPrefix": "",
            "htrab": [], "sections": []})
    path = folder / "chapters.json"
    path.write_text(json.dumps({
        "id": bank["id"], "book": bank["book"], "summary": bank["summary"],
        "labels": bank["labels"], "chapters": units}))
    return path


def write_parts(bank, folder):
    """Split the bank into the part files named by the plan."""
    plan = json.loads((folder / "concept-plan.json").read_text())
    (folder / "parts").mkdir(exist_ok=True)
    for unit in plan["chapters"]:
        part = {
            "concepts": [c for c in bank["concepts"]
                         if c["unit"] == unit["unit"]],
            "questions": [q for q in bank["questions"]
                          if q["unit"] == unit["unit"]]}
        (folder / unit["file"]).write_text(json.dumps(part))
    return plan


def test_round_trip():
    """Plan, split and merge give back the original bank."""
    bank = json.loads(SAMPLE.read_text())
    with tempfile.TemporaryDirectory() as name:
        folder = Path(name)
        chapters = write_chapters_file(bank, folder)
        planned = run(TOOLS / "plan_concept_bank.py", chapters, cwd=folder)
        check("planner runs", planned.returncode == 0)
        plan = write_parts(bank, folder)
        check("planner defaults to 8 questions per page",
              plan["questionsPerPage"] == 8)
        merged = run(TOOLS / "merge_concept_bank.py",
                     folder / "concept-plan.json",
                     "--output", folder / "out.json", cwd=folder)
        check("merge succeeds on the sample bank", merged.returncode == 0)
        out = json.loads((folder / "out.json").read_text())
        check("merged questions equal the original",
              out["questions"] == bank["questions"])
        check("merged concepts equal the original",
              out["concepts"] == bank["concepts"])
        check("unit summaries survive",
              out["unitSummaries"] == bank["unitSummaries"])
        check("report is written",
              (folder / "concept-bank-report.md").exists())
        only = run(TOOLS / "merge_concept_bank.py",
                   folder / "concept-plan.json", "--only",
                   plan["chapters"][0]["idPrefix"], cwd=folder)
        check("--only checks one chapter", only.returncode == 0)


def test_refusals():
    """The merge stops on a bad tag and on a duplicate id."""
    bank = json.loads(SAMPLE.read_text())
    with tempfile.TemporaryDirectory() as name:
        folder = Path(name)
        chapters = write_chapters_file(bank, folder)
        run(TOOLS / "plan_concept_bank.py", chapters, cwd=folder)
        plan = write_parts(bank, folder)
        path = folder / plan["chapters"][0]["file"]
        part = json.loads(path.read_text())
        part["concepts"][0]["htrab"] = "analytical/nope/nothing"
        path.write_text(json.dumps(part))
        result = run(TOOLS / "merge_concept_bank.py",
                     folder / "concept-plan.json",
                     "--output", folder / "out.json", cwd=folder)
        check("unknown tag stops the merge", result.returncode != 0)
        check("no questions.json written on error",
              not (folder / "out.json").exists())
        part["concepts"][0]["htrab"] = bank["concepts"][0]["htrab"]
        part["concepts"][1]["id"] = part["concepts"][0]["id"]
        path.write_text(json.dumps(part))
        result = run(TOOLS / "merge_concept_bank.py",
                     folder / "concept-plan.json", cwd=folder)
        check("duplicate concept id stops the merge",
              result.returncode != 0)


def test_tag_lister():
    """The tag lister prints full tags."""
    result = run(TOOLS / "list_htrab_tags.py", "--level", "inspectional",
                 cwd=ROOT)
    check("tag lister prints inspectional tags",
          result.returncode == 0 and "inspectional/" in result.stdout)


def test_media_encryption():
    """encrypt_media.py: same bytes every time, id-bound, reversible."""
    import os
    import sys
    sys.path.insert(0, str(TOOLS))
    import encrypt_media
    from cryptography.exceptions import InvalidTag
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    key, content = os.urandom(32), b"a secret picture"
    first = encrypt_media.encrypt(key, "u01/i01/f01", content)
    check("the same file gives the same bytes",
          first == encrypt_media.encrypt(key, "u01/i01/f01", content))
    check("the plain content is not in the file", content not in first)
    check("another id gives other bytes",
          first != encrypt_media.encrypt(key, "u01/i01/f02", content))
    file_key = encrypt_media.derive(key, "file:u01/i01/f01", 32)
    check("the file opens with its key and id",
          AESGCM(file_key).decrypt(first[:12], first[12:],
                                   b"u01/i01/f01") == content)
    try:
        AESGCM(file_key).decrypt(first[:12], first[12:], b"u01/i01/f02")
        swapped = True
    except InvalidTag:
        swapped = False
    check("a file cannot be passed off under another id", not swapped)


def test_reencrypt_media():
    """reencrypt_media.py: placeholder key to a real key, safe to repeat."""
    import base64
    import os
    import subprocess
    import sys
    import tempfile
    sys.path.insert(0, str(TOOLS))
    import encrypt_media
    with tempfile.TemporaryDirectory() as folder:
        root = Path(folder)
        source = root / "pic.bin"
        source.write_bytes(b"a pretend picture")
        subprocess.run([sys.executable, str(TOOLS / "encrypt_media.py"),
                        "placeholder", "u01/fig-1", str(source),
                        "--out", str(root / "media")],
                       check=True, capture_output=True)
        stored = root / "media" / "u01" / "fig-1.enc"
        check("a file made with the placeholder opens with it",
              encrypt_media.decrypt(encrypt_media.placeholder_key(),
                                    "u01/fig-1", stored.read_bytes())
              == b"a pretend picture")
        key_file = root / "real.key"
        key = os.urandom(32)
        key_file.write_text(base64.b64encode(key).decode())
        run = [sys.executable, str(TOOLS / "reencrypt_media.py"),
               "placeholder", str(key_file), "--media", str(root / "media")]
        out = subprocess.run(run, check=True, capture_output=True,
                             text=True).stdout
        check("one file is moved to the new key", "1 file(s) moved" in out)
        check("it opens with the real key",
              encrypt_media.decrypt(key, "u01/fig-1", stored.read_bytes())
              == b"a pretend picture")
        again = stored.read_bytes()
        out = subprocess.run(run, check=True, capture_output=True,
                             text=True).stdout
        check("running it again changes nothing",
              "0 file(s) moved" in out and stored.read_bytes() == again)


def test_book_index_shell():
    """make_book_index.py writes a small page that only shows the
    favicon and loads boot.js from the tag on the CDN."""
    import re
    base = "https://cdn.jsdelivr.net/gh/eckko/recall-quiz-site-template@2.1.0/"
    with tempfile.TemporaryDirectory() as folder:
        output = Path(folder) / "index.html"
        result = run(TOOLS / "make_book_index.py", "2.1.0", output,
                     "--no-check", cwd=folder)
        page = output.read_text() if output.exists() else ""
        check("the loader page is written",
              result.returncode == 0 and bool(page))
        check("it loads boot.js from the tagged CDN folder",
              'src="' + base + 'js/boot.js"' in page)
        check("it shows the book's favicon",
              'rel="icon" href="images/favicon.png"' in page)
        check("it loads nothing else",
              len(re.findall(r'(?:href|src)="', page)) == 2)
        check("it is small", len(page) < 1500)
        output.unlink()
        branch = run(TOOLS / "make_book_index.py", "main", output,
                     "--no-check", cwd=folder)
        check("a branch name is refused for the loader page",
              branch.returncode != 0 and not output.exists())


def test_book_index_tool():
    """make_book_index.py --full moves the shared files to the CDN, leaves
    the book's own files alone, and refuses what cannot load from one."""
    import re
    page = (ROOT / "index.html").read_text()
    base = "https://cdn.jsdelivr.net/gh/eckko/recall-quiz-site-template@2.1.0/"
    shared = r'(?:href|src)="(?:css|js|htrab)/'
    with tempfile.TemporaryDirectory() as folder:
        output = Path(folder) / "index.html"
        result = run(TOOLS / "make_book_index.py", "2.1.0", output,
                     "--full", "--source", ROOT / "index.html", cwd=folder)
        book = output.read_text() if output.exists() else ""
        check("the book page is written",
              result.returncode == 0 and bool(book))
        check("no shared file is left on the book's own site",
              re.search(shared, book) is None)
        check("every shared address now starts with the CDN folder",
              book.count('="' + base) == len(re.findall(shared, page)))
        check("the book's own files keep their address",
              'href="images/favicon.png"' in book)
        check("nothing else in the page changed",
              book.replace(base, "") == page)
        check("the base script is loaded from the CDN",
              'src="' + base + 'js/asset-base.js"' in book)
        output.unlink()
        branch = run(TOOLS / "make_book_index.py", "main", output,
                     "--full", "--source", ROOT / "index.html", cwd=folder)
        check("a branch name is refused", branch.returncode != 0
              and not output.exists())
        old_page = Path(folder) / "old.html"
        old_page.write_text(page.replace("js/asset-base.js", "js/other.js"))
        old = run(TOOLS / "make_book_index.py", "2.0.0", output,
                  "--full", "--source", old_page, cwd=folder)
        check("a page without the base script is refused",
              old.returncode != 0 and not output.exists())


def test_study_blocks():
    """Verse-study blocks: the block cap, lines and words are checked."""
    sys.path.insert(0, str(TOOLS))
    import check_rich_content as rich
    plain = [{"label": f"B{n}", "text": "x"} for n in range(7)]
    check("7 plain blocks are still refused",
          rich.check_blocks(plain)[0][0] == "error")
    study = [dict(block, study=True) for block in plain] + [
        {"label": "B8", "text": "x"}]
    check("a card with study blocks may hold 8 blocks",
          rich.check_blocks(study) == [])
    check("9 blocks are refused even with study blocks",
          rich.check_blocks(study + [{"label": "B9", "text": "x"}])[0][0]
          == "error")
    verse = {"label": "V", "study": True, "lines": ["a", "b"],
             "words": [[{"w": "a", "gloss": "g", "gram": "n."}]]}
    check("lines and words are accepted", rich.check_blocks([verse]) == [])
    bad = {"label": "V", "words": [[{"w": "a"}]]}
    check("a word without a gloss is refused",
          rich.check_blocks([bad])[0][0] == "error")
    romanised = {"label": "V", "study": True, "lines": ["dīrghaṃ"]}
    check("romanised verse lines get a warning",
          rich.check_blocks([romanised])[0][0] == "warn")
    check("empty lines are refused",
          rich.check_blocks([{"label": "V", "lines": []}])[0][0] == "error")


def test_aids():
    """Memory aids on a block: shape checks."""
    sys.path.insert(0, str(TOOLS))
    import check_rich_content as rich
    good = [{"aid": "chain", "label": "Chain", "steps": ["a", "b", "c"]},
            {"aid": "story", "label": "Story", "text": "a short story"},
            {"aid": "diagram", "label": "Ledges",
             "groups": [{"label": "Top", "items": ["x", "y"]}]},
            {"aid": "metre", "label": "Metre", "lines": ["a | b"]}]
    block = {"label": "Aids", "study": True, "aids": good}
    check("a block of aids is accepted", rich.check_blocks([block]) == [])
    bad_kind = [dict(good[0], aid="Chain!")]
    check("an aid id must be a lower-case word",
          rich.check_blocks([dict(block, aids=bad_kind)])[0][0] == "error")
    check("two aids of one kind on a card are refused",
          rich.check_blocks([dict(block, aids=[good[0], good[0]])])[0][0]
          == "error")
    check("an aid with no content is refused",
          rich.check_blocks([dict(block, aids=[
              {"aid": "chain", "label": "C"}])])[0][0] == "error")
    check("one step is not a chain",
          rich.check_blocks([dict(block, aids=[
              {"aid": "chain", "label": "C", "steps": ["a"]}])])[0][0]
          == "error")
    pic = {"aid": "pegs", "label": "P", "text": "t",
           "image": {"src": "images/aids/a.svg",
                     "alt": "a rope and an umbrella"}}
    check("an aid with a picture and alt text is accepted",
          rich.check_blocks([dict(block, aids=[pic])]) == [])
    check("a picture without alt text is refused",
          rich.check_blocks([dict(block, aids=[dict(
              pic, image={"src": "images/aids/a.svg", "alt": "rope"})])]
          )[0][0] == "error")
    check("a picture from another site is refused",
          rich.check_blocks([dict(block, aids=[dict(
              pic, image={"src": "https://x.test/a.svg",
                          "alt": "a rope and an umbrella"})])])[0][0]
          == "error")
    check("an aid needs a label",
          rich.check_blocks([dict(block, aids=[
              {"aid": "chain", "steps": ["a", "b"]}])])[0][0] == "error")


def test_study_colours():
    """Every theme's study colour is clearly different from its accents."""
    sys.path.insert(0, str(TOOLS))
    import build_themes as themes
    worst = 180
    for theme_id in themes.find_theme_ids():
        theme = themes.load_theme(theme_id)
        for scheme in ("light", "dark"):
            colours = {**themes.study_colors(
                theme[scheme]["colors"], scheme), **theme[scheme]["colors"]}
            gap = min(themes.hue_gap(themes.hex_hue(colours["study"]),
                                     themes.hex_hue(colours[key]))
                      for key in ("accent", "accent2"))
            worst = min(worst, gap)
    check("study hue is at least 45 degrees from both accents everywhere",
          worst >= 45)


def test_subject_pages_and_build():
    """The encrypted-book pages and the quiz part of build_book.py."""
    import base64
    import os
    import shutil
    sys.path.insert(0, str(TOOLS))
    import make_subject_pages
    import encrypt_media
    pages = make_subject_pages.make_pages("3.0.0", "A & B", ("quiz",))
    check("quiz-only book gets index.html and quiz.html only",
          sorted(pages) == ["index.html", "quiz.html"])
    check("pages load js/unlock.js from the exact tag",
          "recall-quiz-site-template@3.0.0/js/unlock.js" in pages["quiz.html"])
    check("the gate lists only the views the book has",
          "Test only" in pages["index.html"]
          and "Read book" not in pages["index.html"])
    for bad in ("v3.0.0", "main", "3.0"):
        result = run(TOOLS / "make_subject_pages.py", bad, "x", cwd=ROOT)
        check(f"refuses tag {bad}", result.returncode != 0)
    folder = Path(tempfile.mkdtemp())
    try:
        book = folder / "book"
        (book / "media" / "u1").mkdir(parents=True)
        (book / "questions.json").write_text(json.dumps(
            {"id": "t1", "book": "T", "questions": []}))
        (book / "media" / "u1" / "f1.enc").write_bytes(
            encrypt_media.encrypt(encrypt_media.placeholder_key(),
                                  "u1/f1", b"picture"))
        subject_key = base64.b64encode(os.urandom(32)).decode()
        env = {**os.environ, "SUBJECT_KEY": subject_key}
        out = folder / "out"
        result = subprocess.run(
            [sys.executable, str(TOOLS / "book_build" / "build_book.py"),
             "--book", str(book), "--template-tag", "3.0.0",
             "--out", str(out)], capture_output=True, text=True, env=env)
        check("quiz-only build succeeds", result.returncode == 0)
        names = sorted(path.name for path in out.iterdir())
        check("output is only pages, book.json and quiz/",
              names == ["book.json", "index.html", "quiz", "quiz.html"])
        picture = out / "quiz" / "media" / "u1" / "f1.enc"
        key = base64.b64decode(subject_key)
        check("picture now opens with the subject key, not the placeholder",
              encrypt_media.decrypt(key, "u1/f1", picture.read_bytes())
              == b"picture")
        info = json.loads((out / "book.json").read_text())
        check("book.json lists only the quiz view",
              list(info["views"]) == ["quiz"])
        result = subprocess.run(
            [sys.executable, str(TOOLS / "book_build" / "build_book.py"),
             "--book", str(book), "--template-tag", "v3.0.0",
             "--out", str(out)], capture_output=True, text=True, env=env)
        check("build refuses a v-prefixed tag", result.returncode != 0)
    finally:
        shutil.rmtree(folder, ignore_errors=True)


def test_extract_epub_in_subfolder():
    """An EPUB whose chapters sit in text/ (images at ../images/) and whose
    appendix entry reads "Appendix: ..." is cut without error."""
    check_appendix_label("Appendix: A Guide")


def test_extract_epub_uppercase_appendix():
    """The same EPUB with the appendix entry in capitals ("APPENDIX: ...",
    as Calibre-converted EPUBs often print it) is cut without error."""
    check_appendix_label("APPENDIX: A Guide")


def check_appendix_label(label):
    """Build a small EPUB whose appendix navigation entry reads `label`,
    cut it with extract_epub.py and check the appendix chapter is written."""
    import shutil
    folder = Path(tempfile.mkdtemp())
    try:
        epub = folder / "epub"
        (epub / "text").mkdir(parents=True)
        (epub / "images").mkdir()
        (epub / "images" / "a.jpeg").write_bytes(b"not really a picture")
        (epub / "content.opf").write_text(
            '<package><manifest>'
            '<item id="a" href="text/part0001.html"/>'
            '<item id="b" href="text/part0002.html"/>'
            '</manifest><spine><itemref idref="a"/><itemref idref="b"/>'
            '</spine></package>')
        (epub / "toc.ncx").write_text(
            '<ncx><navMap>'
            '<navPoint><navLabel><text>1. First</text></navLabel>'
            '<content src="text/part0001.html#x"/></navPoint>'
            '<navPoint><navLabel><text>%s</text></navLabel>' % label +
            '<content src="text/part0002.html#y"/></navPoint>'
            '</navMap></ncx>')
        page = "<html><body><p>Some words.</p>%s</body></html>"
        (epub / "text" / "part0001.html").write_text(
            page % '<p><img src="../images/a.jpeg"/></p>')
        (epub / "text" / "part0002.html").write_text(page % "")
        chapters = folder / "chapters.json"
        chapters.write_text(json.dumps({"id": "t1", "chapters": [
            {"unit": "Chapter 1", "unitTitle": "First", "idPrefix": "u1",
             "sections": ["Only"]},
            {"unit": "Appendix", "unitTitle": "A Guide", "idPrefix": "ap",
             "sections": ["Only"]}]}))
        out = folder / "out"
        result = run(TOOLS / "book_build" / "extract_epub.py", epub,
                     chapters, out, cwd=ROOT)
        if result.returncode != 0:
            print(result.stderr[-300:])
        check(f"extract_epub reads a text/ folder and {label[:8]!r} title",
              result.returncode == 0)
        check("the picture is copied from ../images/",
              (out / "media-plain" / "u1-a.jpeg").exists())
        check("the appendix chapter is written",
              (out / "chapters" / "ap.json").exists())
    finally:
        shutil.rmtree(folder, ignore_errors=True)


def test_extract_epub_unnumbered_titles_figures_appendices():
    """Chapter titles without numbers are found by their title, a picture
    in a div beside its caption is kept, and an appendix unit reads every
    appendix file (Appendix A, B ...) up to the next other entry."""
    import shutil
    folder = Path(tempfile.mkdtemp())
    try:
        epub = folder / "epub"
        (epub / "text").mkdir(parents=True)
        (epub / "images").mkdir()
        (epub / "images" / "f.jpeg").write_bytes(b"not really a picture")
        names = ["part0001", "part0002", "part0003", "part0004"]
        (epub / "content.opf").write_text(
            "<package><manifest>" + "".join(
                f'<item id="{n}" href="text/{n}.html"/>' for n in names) +
            "</manifest><spine>" + "".join(
                f'<itemref idref="{n}"/>' for n in names) +
            "</spine></package>")
        entries = [("The Quiet Start", "part0001"), ("Appendix A", "part0002"),
                   ("Appendix B", "part0003"), ("Notes", "part0004")]
        (epub / "toc.ncx").write_text("<ncx><navMap>" + "".join(
            f"<navPoint><navLabel><text>{t}</text></navLabel>"
            f'<content src="text/{f}.html"/></navPoint>'
            for t, f in entries) + "</navMap></ncx>")
        page = "<html><body>%s</body></html>"
        pictured = ('<p>Words before.</p><div class="q"><img src='
                    '"../images/f.jpeg"/><p class="caption">Figure 1-1: A'
                    ' thing</p></div>')
        pages = [pictured, "<p>Alpha text.</p>", "<p>Beta text.</p>",
                 "<p>Notes text.</p>"]
        for n, body in zip(names, pages):
            (epub / "text" / f"{n}.html").write_text(page % body)
        chapters = folder / "chapters.json"
        chapters.write_text(json.dumps({"id": "t2", "chapters": [
            {"unit": "Chapter 1", "unitTitle": "The Quiet Start",
             "idPrefix": "c1", "sections": []},
            {"unit": "Appendices A and B", "unitTitle": "Appendices",
             "idPrefix": "app", "sections": []}]}))
        out = folder / "out"
        result = run(TOOLS / "book_build" / "extract_epub.py", epub,
                     chapters, out, cwd=ROOT)
        if result.returncode != 0:
            print(result.stderr[-300:])
        check("unnumbered chapter titles are read", result.returncode == 0
              and (out / "chapters" / "c1.json").exists())
        first = json.loads((out / "chapters" / "c1.json").read_text())
        check("a picture beside its caption is kept", len(first["media"]) == 1)
        check("the caption text is kept", "Figure 1-1" in json.dumps(first))
        appendix = (out / "chapters" / "app.json").read_text()
        check("both appendix files are read",
              "Alpha text" in appendix and "Beta text" in appendix)
        check("the next entry is not part of the appendix",
              "Notes text" not in appendix)
    finally:
        shutil.rmtree(folder, ignore_errors=True)


def test_extract_epub_split_chapter():
    """A chapter split into two files (Calibre part0007_split_001) whose
    second file has a navigation entry for one of its own sections is read
    to its end, not cut at that entry."""
    import shutil
    folder = Path(tempfile.mkdtemp())
    try:
        epub = folder / "epub"
        (epub / "text").mkdir(parents=True)
        files = ["part0001_split_000", "part0001_split_001", "part0002"]
        (epub / "content.opf").write_text(
            "<package><manifest>"
            + "".join(f'<item id="{n}" href="text/{n}.html"/>' for n in files)
            + "</manifest><spine>"
            + "".join(f'<itemref idref="{n}"/>' for n in files)
            + "</spine></package>")
        (epub / "toc.ncx").write_text(
            "<ncx><navMap>"
            "<navPoint><navLabel><text>1. First</text></navLabel>"
            '<content src="text/part0001_split_000.html"/></navPoint>'
            "<navPoint><navLabel><text>Alpha</text></navLabel>"
            '<content src="text/part0001_split_000.html#a"/></navPoint>'
            "<navPoint><navLabel><text>Beta</text></navLabel>"
            '<content src="text/part0001_split_001.html#b"/></navPoint>'
            "<navPoint><navLabel><text>2. Second</text></navLabel>"
            '<content src="text/part0002.html"/></navPoint>'
            "</navMap></ncx>")
        page = "<html><body><h2>%s</h2><p>%s</p></body></html>"
        (epub / "text" / "part0001_split_000.html").write_text(
            page % ("Alpha", "First half words."))
        (epub / "text" / "part0001_split_001.html").write_text(
            page % ("Beta", "Second half words."))
        (epub / "text" / "part0002.html").write_text(
            page % ("Gamma", "Next chapter words."))
        chapters = folder / "chapters.json"
        chapters.write_text(json.dumps({"id": "t2", "chapters": [
            {"unit": "Chapter 1", "unitTitle": "First", "idPrefix": "u1",
             "sections": ["Alpha", "Beta"]},
            {"unit": "Chapter 2", "unitTitle": "Second", "idPrefix": "u2",
             "sections": ["Gamma"]}]}))
        out = folder / "out"
        result = run(TOOLS / "book_build" / "extract_epub.py", epub,
                     chapters, out, cwd=ROOT)
        if result.returncode != 0:
            print(result.stderr[-300:])
        check("extract_epub runs on a split chapter", result.returncode == 0)
        first = (out / "chapters" / "u1.json").read_text()
        check("the second file of the split chapter is included",
              "Second half words." in first)
        check("the next chapter's text is not pulled in",
              "Next chapter words." not in first)
    finally:
        shutil.rmtree(folder, ignore_errors=True)


def test_extract_epub_keeps_text_colours():
    """A word the book colours (by a stylesheet class, a class like
    fg-D50000 or an inline style) is kept as <span class="c-red"> etc.;
    black and grey text is not, and em and strong are still kept."""
    import shutil
    folder = Path(tempfile.mkdtemp())
    try:
        epub = folder / "epub"
        (epub / "text").mkdir(parents=True)
        (epub / "styles").mkdir()
        (epub / "content.opf").write_text(
            '<package><manifest><item id="a" href="text/a.html"/>'
            '<item id="s" href="styles/s.css" media-type="text/css"/>'
            '</manifest><spine><itemref idref="a"/></spine></package>')
        (epub / "styles" / "s.css").write_text(
            ".hot { color:#D50000; }\n.cool { color:#002BE1; }\n"
            ".dull { color:#333333; }\n.bg { background-color:#D50000; }\n")
        (epub / "toc.ncx").write_text(
            "<ncx><navMap><navPoint><navLabel><text>1. First</text>"
            '</navLabel><content src="text/a.html"/></navPoint>'
            "</navMap></ncx>")
        (epub / "text" / "a.html").write_text(
            "<html><body><h2>Alpha</h2><p>"
            '<span class="hot">red one</span> '
            '<strong><span class="cool">blue one</span></strong> '
            '<span class="fg-00B050">green one</span> '
            '<span style="color: rgb(123, 47, 191)">purple one</span> '
            '<span class="dull">grey one</span> '
            '<span class="bg">no colour</span> <em>slanted</em>'
            "</p></body></html>")
        chapters = folder / "chapters.json"
        chapters.write_text(json.dumps({"id": "t3", "chapters": [
            {"unit": "Chapter 1", "unitTitle": "First", "idPrefix": "u1",
             "sections": ["Alpha"]}]}))
        out = folder / "out"
        result = run(TOOLS / "book_build" / "extract_epub.py", epub,
                     chapters, out, cwd=ROOT)
        check("extract_epub runs on a book with coloured text",
              result.returncode == 0)
        html = json.loads((out / "chapters" / "u1.json").read_text()
                          )["nodes"][0]["html"]
        check("a stylesheet class colour is kept",
              '<span class="c-red">red one</span>' in html)
        check("a coloured word inside strong is kept",
              '<strong><span class="c-blue">blue one</span></strong>'
              in html)
        check("an fg-RRGGBB class is kept",
              '<span class="c-green">green one</span>' in html)
        check("an inline style colour is kept",
              '<span class="c-purple">purple one</span>' in html)
        check("grey text and background colours are not kept",
              "grey one" in html and "no colour" in html
              and html.count('class="c-') == 4)
        check("em is still kept", "<em>slanted</em>" in html)
    finally:
        shutil.rmtree(folder, ignore_errors=True)


def test_extract_epub_rule_units():
    """A unit like "Rule #1" has one navigation entry ("Rule #1: Name")
    and its sections are headings inside the file; it is still cut."""
    import shutil
    folder = Path(tempfile.mkdtemp())
    try:
        epub = folder / "epub"
        epub.mkdir()
        files = ["rule1", "rule2"]
        (epub / "content.opf").write_text(
            "<package><manifest>"
            + "".join(f'<item id="{n}" href="{n}.html"/>' for n in files)
            + "</manifest><spine>"
            + "".join(f'<itemref idref="{n}"/>' for n in files)
            + "</spine></package>")
        (epub / "toc.ncx").write_text(
            "<ncx><navMap>"
            "<navPoint><navLabel><text>Rule #1: Work Deeply</text>"
            '</navLabel><content src="rule1.html"/></navPoint>'
            "<navPoint><navLabel><text>Rule #2: Rest</text></navLabel>"
            '<content src="rule2.html"/></navPoint></navMap></ncx>')
        (epub / "rule1.html").write_text(
            "<html><body><h1>Rule #1: Work Deeply</h1><p>Intro words.</p>"
            "<h2>Decide Your Depth</h2><p>Depth words.</p></body></html>")
        (epub / "rule2.html").write_text(
            "<html><body><h1>Rule #2: Rest</h1><p>Rest words.</p>"
            "</body></html>")
        chapters = folder / "chapters.json"
        chapters.write_text(json.dumps({"id": "t3", "chapters": [
            {"unit": "Rule #1", "unitTitle": "Work Deeply",
             "idPrefix": "r1", "sections": ["Decide Your Depth"]},
            {"unit": "Rule #2", "unitTitle": "Rest", "idPrefix": "r2",
             "sections": ["Rest"]}]}))
        out = folder / "out"
        result = run(TOOLS / "book_build" / "extract_epub.py", epub,
                     chapters, out, cwd=ROOT)
        check("extract_epub runs on Rule units", result.returncode == 0)
        first = out / "chapters" / "r1.json"
        check("a Rule unit gets its text",
              first.exists() and "Depth words." in first.read_text())
        check("a Rule unit stops at the next Rule",
              "Rest words." not in first.read_text())
    finally:
        shutil.rmtree(folder, ignore_errors=True)


def test_add_notes_by_unit():
    """Notes files are found by the chapter's unit, so bundle prefixes such
    as u1 work as well as c1."""
    import os
    import shutil
    import zipfile
    sys.path.insert(0, str(TOOLS / "book_build"))
    import encfmt
    folder = Path(tempfile.mkdtemp())
    try:
        key = os.urandom(32)
        (folder / "key.txt").write_text(key.hex())
        (folder / "site" / "data" / "ch").mkdir(parents=True)
        manifest = {"chapters": [
            {"prefix": "u1", "unit": "Chapter 1", "title": "First"}]}
        node = {"id": "u1-i", "level": 2, "title": "I.", "parent": None,
                "html": "text", "sectionKey": "I.", "notes": None,
                "visuals": [], "ideas": [], "questions": []}
        bundle = {"nodes": [node], "media": [], "ideas": {}, "questions": []}
        (folder / "site" / "data" / "manifest.enc").write_bytes(
            encfmt.encrypt(json.dumps(manifest).encode(), key))
        (folder / "site" / "data" / "ch" / "u1.enc").write_bytes(
            encfmt.encrypt(json.dumps(bundle).encode(), key))
        page = ("<html><body>"
                '<div class="box blue"><p><strong>Place</strong></p>'
                "<p>chapter note</p></div><h3>I.</h3>"
                "<ul><li>section note</li></ul></body></html>")
        with zipfile.ZipFile(folder / "notes.epub", "w") as epub:
            epub.writestr("OEBPS/u_ch1.xhtml", page)
        result = run(TOOLS / "book_build" / "add_notes.py",
                     "--site", folder / "site", "--key", folder / "key.txt",
                     "--notes-epub", folder / "notes.epub", cwd=ROOT)
        check("add_notes runs", result.returncode == 0)
        stored = json.loads(encfmt.decrypt(
            (folder / "site" / "data" / "ch" / "u1.enc").read_bytes(), key))
        check("the section note is placed on its section",
              "section note" in (stored["nodes"][0]["notes"] or ""))
        check("the blue box becomes the chapter note",
              "chapter note" in (stored["notesIntro"] or ""))
    finally:
        shutil.rmtree(folder, ignore_errors=True)


def test_book_build_front_back_units(chapter_label="1. First"):
    """A Foreword and a Conclusion (units with no number) are cut from the
    EPUB, get their ideas, questions and notes, and a unit with no text keeps
    its ideas on one node. The EPUB declares its NCX under another name and
    marks its cover by property; the notes use chapter_N.xhtml names."""
    import base64
    import os
    import shutil
    import zipfile
    sys.path.insert(0, str(TOOLS / "book_build"))
    import encfmt
    folder = Path(tempfile.mkdtemp())
    try:
        book = folder / "book"
        (book / "references").mkdir(parents=True)
        (book / "book-structure").mkdir()
        page = ("<html><body>%s</body></html>")
        files = {
            "META-INF/container.xml": '<container><rootfiles><rootfile '
            'full-path="OEBPS/content.opf"/></rootfiles></container>',
            "OEBPS/content.opf": (
                '<package><metadata><meta name="cover" content="none"/>'
                '</metadata><manifest>'
                '<item id="n" href="x_toc.ncx" '
                'media-type="application/x-dtbncx+xml"/>'
                '<item id="pic" href="images/c.jpg" properties="cover-image" '
                'media-type="image/jpeg"/>'
                '<item id="a" href="text/fw.xhtml"/>'
                '<item id="b" href="text/ch1.xhtml"/>'
                '<item id="c" href="text/end.xhtml"/></manifest>'
                '<spine><itemref idref="a"/><itemref idref="b"/>'
                '<itemref idref="c"/></spine></package>'),
            "OEBPS/x_toc.ncx": (
                '<ncx><navMap>'
                '<navPoint><navLabel><text>Foreword: to the Edition'
                '</text></navLabel><content src="text/fw.xhtml#a"/>'
                '</navPoint><navPoint><navLabel><text>' + chapter_label +
                '</text></navLabel><content src="text/ch1.xhtml#b"/>'
                '</navPoint>'
                '<navPoint><navLabel><text>Conclusion:</text></navLabel>'
                '<content src="text/end.xhtml#c"/></navPoint></navMap>'
                '</ncx>'),
            "OEBPS/images/c.jpg": b"cover bytes",
            "OEBPS/text/fw.xhtml": page % (
                '<h2>Foreword</h2><h2>to the Edition</h2>'
                '<p class="x">Ten Lessons</p><p>Opening words of the '
                'foreword.</p><p>More foreword words.</p>'),
            "OEBPS/text/ch1.xhtml": page % (
                "<p>Alpha</p><p>Alpha body words.</p>"
                "<p>Beta</p><p>Beta body words.</p>"),
            "OEBPS/text/end.xhtml": page % (
                '<h2>Conclusion:</h2><h2>The End</h2>'
                '<p>Closing words of the book.</p>')}
        with zipfile.ZipFile(book / "references" / "b.epub", "w") as z:
            z.writestr("mimetype", "application/epub+zip")
            for name, data in files.items():
                z.writestr(name, data)
        notes = {
            "OEBPS/foreword.xhtml": page % (
                '<h1>Foreword</h1><div class="box blue"><p>Place note</p>'
                '</div><h3>#1: Lesson</h3><ul><li>lesson note</li></ul>'),
            "OEBPS/conclusion.xhtml": page % (
                '<h1>Conclusion:</h1><div class="box blue"><p>End note</p>'
                '</div><ul><li>end text</li></ul>'),
            "OEBPS/chapter_1.xhtml": page % (
                '<p class="label">CHAPTER 1</p><h2>First</h2>'
                '<div class="box blue"><p>Chapter note</p></div>'
                '<h3>Alpha</h3><ul><li>alpha note</li></ul>')}
        with zipfile.ZipFile(book / "references" / "n.epub", "w") as z:
            for name, data in notes.items():
                z.writestr(name, data)
        units = [
            ("Front", "Foreword", "intro",
             ["Foreword to the Edition: Ten Lessons"]),
            ("Chapter 1", "First", "c1", ["Alpha", "Beta"]),
            ("Conclusion", "The End", "end", ["Conclusion: The End"]),
            ("The end", "The end", "whole", [])]
        (book / "book-structure" / "chapters.json").write_text(json.dumps({
            "id": "t1", "chapters": [
                {"unit": u, "unitTitle": t, "idPrefix": i, "sections": sec}
                for u, t, i, sec in units]}))
        sections = {"Front": "Foreword to the Edition: Ten Lessons",
                    "Chapter 1": "Alpha", "Conclusion": "Conclusion: The End",
                    "The end": "The whole book"}
        concepts, questions = [], []
        for u, t, i, sec in units:
            for n in range(2):
                cid = f"{i}-idea-{n}"
                concepts.append({
                    "id": cid, "unit": u, "unitTitle": t,
                    "section": sections[u], "title": f"Idea {n}",
                    "card": {"blocks": [{"label": "L", "text": "t"}]},
                    "question": "Q?"})
                questions.append({
                    "id": f"{i}-q-{n}", "unit": u, "unitTitle": t,
                    "section": sections[u], "concept": cid, "kind": "tf",
                    "q": "True or false: x", "answer": True})
        (book / "questions.json").write_text(json.dumps(
            {"id": "t1", "book": "T", "concepts": concepts,
             "questions": questions}))
        out = folder / "out"
        key = os.urandom(32)
        env = {**os.environ, "SUBJECT_KEY": base64.b64encode(key).decode()}
        result = subprocess.run(
            [sys.executable, str(TOOLS / "book_build" / "build_book.py"),
             "--book", str(book), "--epub", "references/b.epub",
             "--notes-epub", "references/n.epub", "--template-tag", "3.2.4",
             "--out", str(out)], capture_output=True, text=True, env=env)
        if result.returncode != 0:
            print(result.stdout[-400:], result.stderr[-400:])
        check("a book with Foreword and Conclusion builds",
              result.returncode == 0)

        def read(name):
            """A decrypted JSON file of the output."""
            return json.loads(encfmt.decrypt(
                (out / name).read_bytes(), key))
        manifest = read("data/manifest.enc")
        check("every idea and question is placed in the reader",
              sum(c["ideas"] for c in manifest["chapters"]) == 8
              and sum(c["questions"] for c in manifest["chapters"]) == 8)
        groups = {c["prefix"]: c["group"] for c in manifest["chapters"]}
        check("text units share a group; the unit with no text is "
              "'The whole book'",
              groups == {"intro": "Before Part I", "c1": "Before Part I",
                         "end": "Before Part I", "whole": "The whole book"})
        check("the cover marked by property is found",
              manifest["book"]["cover"] == "t1/front/cover")
        front = read("data/ch/intro.enc")
        node = front["nodes"][0]
        check("the foreword is cut as one section with its own title",
              node["title"] == "Foreword to the Edition: Ten Lessons"
              and "Opening words" in node["html"])
        check("the split heading is not repeated in the text",
              "Ten Lessons" not in node["html"]
              and "<p>Foreword</p>" not in node["html"])
        check("the foreword has its ideas",
              len(node["ideas"]) == 2 and len(node["questions"]) == 2)
        check("the foreword notes land on the foreword; an unmatched "
              "heading is kept there",
              "Place note" in (node["notes"] or "")
              and "lesson note" in (node["notes"] or ""))
        end = read("data/ch/end.enc")["nodes"][0]
        check("the conclusion text and notes are placed",
              "Closing words" in end["html"]
              and "End note" in (end["notes"] or "")
              and len(end["ideas"]) == 2)
        chapter = read("data/ch/c1.enc")
        check("chapter_N.xhtml notes are found",
              "Chapter note" in (chapter["notesIntro"] or ""))
        whole = read("data/ch/whole.enc")["nodes"]
        check("a unit with no text keeps its ideas on its one node",
              len(whole) == 1 and len(whole[0]["ideas"]) == 2
              and len(whole[0]["questions"]) == 2)
        check("no start file is left in the bundle",
              "startFile" not in front)
    finally:
        shutil.rmtree(folder, ignore_errors=True)


if __name__ == "__main__":
    print("Bank tools")
    test_subject_pages_and_build()
    test_add_notes_by_unit()
    test_extract_epub_in_subfolder()
    test_extract_epub_uppercase_appendix()
    test_extract_epub_unnumbered_titles_figures_appendices()
    test_extract_epub_split_chapter()
    test_extract_epub_keeps_text_colours()
    test_extract_epub_rule_units()
    test_book_build_front_back_units()
    test_book_build_front_back_units("First")  # unnumbered title
    test_study_blocks()
    test_aids()
    test_study_colours()
    test_round_trip()
    test_refusals()
    test_tag_lister()
    test_media_encryption()
    test_reencrypt_media()
    test_book_index_shell()
    test_book_index_tool()
    if failures:
        raise SystemExit(f"{len(failures)} check(s) failed")
    print("All checks passed.")
