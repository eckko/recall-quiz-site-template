#!/usr/bin/env python3
"""Point the book pages at one exact tag of the quiz template.

    python3 tools/set_template_tag.py 0.2.0            # every book folder
    python3 tools/set_template_tag.py 0.2.0 --book sample

The tag must look like X.Y.Z (no "v", never a branch name). It rewrites the
@TAG in the CDN addresses in each book's index.html, read.html and quiz.html.
Run tools/build_hub.py afterwards (add_book.py does it for you).
"""

import argparse
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import build_hub  # noqa: E402

ROOT = Path.cwd()
TAG = re.compile(r"^\d+\.\d+\.\d+$")
ADDRESS = re.compile(
    r"(https://cdn\.jsdelivr\.net/gh/[\w.-]+/[\w.-]+@)[^/\"' ]+(/(?:js|reader)/)")


def set_tag(page, tag):
    """Rewrite the tag in one index.html.

    @param page: path of the book's index.html
    @param tag: the new exact tag
    @return: True when the file changed
    """
    text = page.read_text(encoding="utf-8")
    new = ADDRESS.sub(lambda m: m.group(1) + tag + m.group(2), text)
    if new != text:
        page.write_text(new, encoding="utf-8")
    return new != text


def main(argv=None):
    """Run the tool. @return: the exit status"""
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("tag")
    parser.add_argument("--book", help="only this book folder")
    parser.add_argument("--subject-root", type=Path, default=ROOT)
    args = parser.parse_args(argv)
    if not TAG.match(args.tag):
        print("PROBLEM: the tag must look like 0.2.0 (no \"v\", no branch)",
              file=sys.stderr)
        return 1
    root = args.subject_root.resolve()
    folders = [root / args.book] if args.book else build_hub.book_folders(root)
    changed = 0
    for folder in folders:
        page = folder / "index.html"
        if not page.is_file():
            print("PROBLEM: %s has no index.html" % folder.name,
                  file=sys.stderr)
            return 1
        for name in ("index.html", "read.html", "quiz.html"):
            if (folder / name).is_file():
                changed += set_tag(folder / name, args.tag)
    print("Set tag %s in %d book page(s)" % (args.tag, changed))
    return 0


if __name__ == "__main__":
    sys.exit(main())
