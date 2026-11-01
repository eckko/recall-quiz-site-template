#!/usr/bin/env python3
"""Copy the publishable things of a private book repo into this site.

    python3 tools/add_book.py ../private-book-repo --name clean-code

Copies exactly: index.html, read.html, quiz.html, book.json, data/, media/
and quiz/ (those that exist). Everything else in
the book repo (references, notes, plain extracts, ...) is never read. The copy
is checked first (see tools/build_hub.py); when it has a problem, nothing in
this site is changed. On success the book's folder is replaced and books.json
is rewritten.

    --name         the folder (and URL) name; default: the book repo's folder
    --subject-root the subject site folder; default: the current folder
"""

import argparse
import shutil
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import build_hub  # noqa: E402

ROOT = Path.cwd()


def copy_items(source, target):
    """Copy only the publishable files.

    @param source: the book repo checkout
    @param target: an empty folder to fill
    @return: list of problems (missing required items)
    """
    problems = []
    for name in ("index.html", "book.json"):
        if not (source / name).is_file():
            problems.append("%s is missing in the book repo" % name)
    for name in sorted(build_hub.BOOK_ITEMS):
        if (source / name).is_file():
            shutil.copy2(source / name, target / name)
        elif (source / name).is_dir():
            shutil.copytree(source / name, target / name)
    return problems


def add_book(source, name, root):
    """Check a book and, when it is fine, put it into the site.

    @param source: the book repo checkout
    @param name: the folder name to publish it under
    @param root: the subject site folder
    @return: list of problems; empty when the book was added
    """
    _, problems = build_hub.load_subject(root)
    if problems:
        return problems
    with tempfile.TemporaryDirectory(dir=root, prefix=".stage-") as scratch:
        staged = Path(scratch) / name
        staged.mkdir()
        problems = copy_items(source, staged)
        if problems:
            return problems
        entry, problems = build_hub.check_book(staged)
        if problems:
            return problems
        for other in build_hub.book_folders(root):
            if other.name == name:
                continue
            found, _ = build_hub.read_book(other)
            if found and found["id"] == entry["id"]:
                return ["id \"%s\" is already used by %s"
                        % (entry["id"], other.name)]
        destination = root / name
        if destination.exists():
            shutil.rmtree(destination)
        shutil.move(str(staged), str(destination))
    entries, problems = build_hub.check_site(root)
    if problems:
        return problems
    (root / build_hub.BOOKS_FILE).write_text(
        build_hub.render(entries), encoding="utf-8")
    return []


def main(argv=None):
    """Run the tool. @return: the exit status"""
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("book_repo", type=Path)
    parser.add_argument("--name")
    parser.add_argument("--subject-root", type=Path, default=ROOT)
    args = parser.parse_args(argv)
    source = args.book_repo.resolve()
    name = args.name or source.name
    problems = add_book(source, name, args.subject_root.resolve())
    for problem in problems:
        print("PROBLEM:", problem, file=sys.stderr)
    if problems:
        return 1
    print("Added %s" % name)
    return 0


if __name__ == "__main__":
    sys.exit(main())
