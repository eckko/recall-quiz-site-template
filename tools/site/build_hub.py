#!/usr/bin/env python3
"""Check every book folder of a subject site and write books.json.

    python3 build_hub.py [--subject-root DIR]          # check, then write
    python3 build_hub.py --check [--subject-root DIR]  # check only; exit 1
                                  # on a problem or when books.json is stale

DIR is the subject site (default: the current folder). Every top-level folder
is a book, except the reserved ones (tools, tests, templates) and folders
starting with a dot. A book folder may hold only what the build of a private
book repo writes (see tools/book_build/build_book.py):

    index.html    the gate; read.html and quiz.html start the two views.
                  Each loads js/unlock.js from the CDN by an exact tag
    book.json     {"id": "...", "title": "...", "views": {...}}: public, used
                  by the hub; "views" says which of read / quiz exist
    data/ media/  the reader's encrypted files only (*.enc)
    quiz/         the quiz's questions.enc and pictures (*.enc only)

Anything else is a problem, so a plain book file, a figure or a reference
file cannot reach the public site by accident. Book ids must be unique within
this site. (Progress is saved per book id in the reader's browser and account,
and all your Pages sites share one address, so keep ids different across your
subject sites too; this tool can only check this one.)
"""

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path.cwd()
RESERVED_FOLDERS = {"tools", "tests", "templates"}
ALLOWED_ROOT_FILES = {
    "index.html", "books.json", "subject.json", "README.md", "CLAUDE.md",
    ".gitignore", ".nojekyll", "CNAME", "LICENSE",
}
BOOK_ITEMS = {"index.html", "read.html", "quiz.html", "book.json",
              "data", "media", "quiz"}
ENCRYPTED_FOLDERS = ("data", "media", "quiz")
# what each view needs in the book folder
VIEW_FILES = {
    "read": ("read.html", "data/manifest.enc"),
    "quiz": ("quiz.html", "quiz/questions.enc"),
}
VIEW_LINK = "index.html?view="
FOLDER_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-]*$")
ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-]*$")
# an exact tag is X.Y.Z with no "v" and no branch name
CDN_URL = r"https://cdn\.jsdelivr\.net/gh/[\w.-]+/[\w.-]+@(\d+\.\d+\.\d+)/"
PINNED_UNLOCK = re.compile(CDN_URL + r"js/unlock\.js")
BOOKS_FILE = "books.json"


def load_subject(root):
    """Read subject.json.

    @param root: the subject site folder
    @return: (settings dict, list of problems)
    """
    path = root / "subject.json"
    try:
        settings = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        return {}, ["subject.json cannot be read: %s" % error]
    problems = []
    if not isinstance(settings.get("title"), str):
        problems.append("subject.json needs a text \"title\"")
    tag = settings.get("templateTag")
    if tag is not None and not (isinstance(tag, str)
                                and re.fullmatch(r"\d+\.\d+\.\d+", tag)):
        problems.append("subject.json: \"templateTag\" must be an exact "
                        "tag like 3.1.0 (no \"v\", no branch)")
    return settings, problems


def check_contents(folder, views):
    """Check that a book folder holds only the allowed things.

    @param folder: path of the book folder
    @param views: the views book.json lists ("read" and/or "quiz")
    @return: list of problems
    """
    problems = []
    name = folder.name
    for item in sorted(folder.iterdir()):
        if item.name not in BOOK_ITEMS:
            problems.append("%s/%s is not one of the allowed items"
                            % (name, item.name))
    for part in ENCRYPTED_FOLDERS:
        base = folder / part
        for item in sorted(base.rglob("*")) if base.is_dir() else []:
            if item.is_file() and item.suffix != ".enc":
                problems.append("%s/%s/%s is not an encrypted .enc file"
                                % (name, part,
                                   item.relative_to(base).as_posix()))
    for view, needed in VIEW_FILES.items():
        for path in needed:
            has = (folder / path).is_file()
            if view in views and not has:
                problems.append("%s/%s is missing (book.json lists the %s "
                                "view)" % (name, path, view))
            if view not in views and has:
                problems.append("%s/%s exists but book.json does not list "
                                "the %s view" % (name, path, view))
    return problems


def check_loader(folder, views):
    """Check that every page loads js/unlock.js from one exact CDN tag.

    @param folder: path of the book folder
    @param views: the views book.json lists
    @return: list of problems
    """
    tags, problems = set(), []
    pages = ["index.html"] + [VIEW_FILES[v][0] for v in views
                              if v in VIEW_FILES]
    for name in pages:
        try:
            text = (folder / name).read_text(encoding="utf-8")
        except OSError:
            problems.append("%s/%s is missing" % (folder.name, name))
            continue
        found = PINNED_UNLOCK.search(text)
        if not found:
            problems.append("%s/%s must load js/unlock.js from the CDN by "
                            "an exact tag such as @3.0.0 (no \"v\", no "
                            "branch)" % (folder.name, name))
        else:
            tags.add(found.group(1))
    if len(tags) > 1:
        problems.append("%s: the pages use different template tags"
                        % folder.name)
    return problems


def read_book(folder):
    """Read the id, title and views from a book's book.json.

    @param folder: path of the book folder
    @return: (entry dict or None, list of problems)
    """
    try:
        data = json.loads(
            (folder / "book.json").read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        return None, ["%s/book.json cannot be read: %s"
                      % (folder.name, error)]
    book_id, title = data.get("id"), data.get("title")
    problems = []
    if not isinstance(book_id, str) or not ID_PATTERN.match(book_id):
        problems.append("%s/book.json: \"id\" must be lower-case "
                        "letters, digits and dashes" % folder.name)
    if not isinstance(title, str) or not title.strip():
        problems.append("%s/book.json: \"title\" is missing" % folder.name)
    views = data.get("views")
    if (not isinstance(views, dict) or not views
            or set(views) - set(VIEW_FILES)
            or any(v != VIEW_LINK + k for k, v in views.items())):
        problems.append("%s/book.json: \"views\" must list read and/or "
                        "quiz, for example {\"quiz\": \"%squiz\"}"
                        % (folder.name, VIEW_LINK))
    if problems:
        return None, problems
    return {"folder": folder.name, "id": book_id, "title": title.strip(),
            "views": sorted(views)}, []


def check_book(folder):
    """Check one book folder completely.

    @param folder: path of the book folder (its name is the URL name)
    @return: (entry dict or None, list of problems)
    """
    if not FOLDER_PATTERN.match(folder.name):
        return None, ["folder \"%s\": use lower-case letters, digits and "
                      "dashes" % folder.name]
    if not (folder / "book.json").is_file():
        return None, ["%s/book.json is missing" % folder.name]
    entry, problems = read_book(folder)
    if entry:
        problems = check_contents(folder, entry["views"]) \
            + check_loader(folder, entry["views"])
    return entry, problems


def book_folders(root):
    """@return: sorted list of the folders that count as books"""
    return sorted(
        item for item in root.iterdir()
        if item.is_dir() and not item.name.startswith(".")
        and item.name not in RESERVED_FOLDERS)


def check_site(root):
    """Check the whole site.

    @param root: the subject site folder
    @return: (list of book entries, list of problems)
    """
    settings, problems = load_subject(root)
    for item in sorted(root.iterdir()):
        if item.is_file() and item.name not in ALLOWED_ROOT_FILES:
            problems.append("%s: unexpected file at the top level" % item.name)
    entries = []
    for folder in book_folders(root):
        entry, found = check_book(folder)
        problems += found
        if entry:
            entries.append(entry)
    seen = {}
    for entry in entries:
        if entry["id"] in seen:
            problems.append("id \"%s\" is used by both %s and %s"
                            % (entry["id"], seen[entry["id"]],
                               entry["folder"]))
        seen[entry["id"]] = entry["folder"]
    entries.sort(key=lambda entry: (entry["title"].lower(), entry["folder"]))
    return entries, problems


def render(entries):
    """@return: the text of books.json for the given entries"""
    return json.dumps({"books": entries}, indent=2, ensure_ascii=False) + "\n"


def main(argv=None):
    """Run the tool. @return: the exit status"""
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--check", action="store_true",
                        help="do not write books.json; fail if it is stale")
    parser.add_argument("--subject-root", type=Path, default=ROOT,
                        help="the subject site folder (default: the "
                             "current folder)")
    args = parser.parse_args(argv)
    root = args.subject_root.resolve()
    entries, problems = check_site(root)
    for problem in problems:
        print("PROBLEM:", problem, file=sys.stderr)
    if problems:
        return 1
    wanted = render(entries)
    path = root / BOOKS_FILE
    current = path.read_text(encoding="utf-8") if path.is_file() else ""
    if args.check:
        if current != wanted:
            print("PROBLEM: books.json is out of date; run "
                  "python3 tools/build_hub.py", file=sys.stderr)
            return 1
        print("OK: %d book(s)" % len(entries))
        return 0
    if current != wanted:
        path.write_text(wanted, encoding="utf-8")
    print("books.json lists %d book(s)" % len(entries))
    return 0


if __name__ == "__main__":
    sys.exit(main())
