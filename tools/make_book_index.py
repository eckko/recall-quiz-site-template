#!/usr/bin/env python3
"""Write a book site's index.html so the shared code comes from a CDN.

    python3 tools/make_book_index.py 2.1.0 ../my-book/index.html

A book site then needs only index.html, questions.json and images/ (plus
media/ or banks/ when the book uses them). The index.html this tool
writes does nothing but show the book's favicon and load js/boot.js from
one tagged copy of this template on jsDelivr; boot.js then loads the
quiz page and every css/, js/ and htrab/ file from the same place. A new
template release reaches a book by running this tool again with the new
tag.

Use an exact tag such as 2.1.0 (not a branch): a tag never changes, so
the book never changes under you. The tool checks that the tag holds
js/boot.js (skip that with --no-check, for example when offline).

With --full the tool instead writes the whole quiz page with the CDN
addresses already in it. That page starts a little faster (no second
download), but it is long and must be rewritten for every release.
The page is read from that tag on the CDN, or from --source FILE.
"""

import argparse
import re
import sys
import urllib.request
from pathlib import Path

CDN_FOLDER = "https://cdn.jsdelivr.net/gh/eckko/recall-quiz-site-template"
SHARED_FOLDERS = ("css", "js", "htrab")
BOOK_FOLDERS = ("images", "media", "banks")
BASE_SCRIPT = "js/asset-base.js"
BOOT_SCRIPT = "js/boot.js"
VERSION_PATTERN = re.compile(r"^\d+(\.\d+){0,2}$")
DOWNLOAD_TIMEOUT_SECONDS = 30
SHARED_ADDRESS = re.compile(
    r'(?P<attribute>\b(?:href|src)=")'
    r"(?P<folder>" + "|".join(SHARED_FOLDERS) + r")/")
ANY_ADDRESS = re.compile(r'\b(?:href|src)="([^"]*)"')
SHELL_PAGE = """<!doctype html>
<!--
  Made by tools/make_book_index.py (recall-quiz-site-template). This page
  only shows the favicon and starts js/boot.js, which loads the quiz page
  and every css/ and js/ file from the CDN at tag {version}.
  To move this book to another template tag, run the tool again with that
  tag. questions.json and images/ (and media/, banks/ if used) stay here.
-->
<html lang="en">
<head>
  <meta charset="utf-8">
  <link rel="icon" href="images/favicon.png" type="image/png">
  <script src="{base}/js/boot.js"></script>
</head>
<body></body>
</html>
"""


def cdn_base(version):
    """The CDN folder that holds one tag of the template (no trailing
    slash)."""
    return f"{CDN_FOLDER}@{version}"


def shell_page(version):
    """The tiny page: favicon plus the boot script of that tag."""
    return SHELL_PAGE.format(version=version, base=cdn_base(version))


def download_text(address):
    """The text at an address, or a clear message and exit."""
    try:
        with urllib.request.urlopen(
                address, timeout=DOWNLOAD_TIMEOUT_SECONDS) as response:
            return response.read().decode("utf-8")
    except OSError as problem:
        sys.exit(f"Could not download {address}: {problem}")


def read_template_page(version, source_file):
    """The template's index.html: from a file when one is given,
    otherwise from that tag on the CDN."""
    if source_file:
        return Path(source_file).read_text(encoding="utf-8")
    return download_text(f"{cdn_base(version)}/index.html")


def point_at_cdn(page, base):
    """The page with every css/, js/ and htrab/ address put behind the
    CDN folder `base`."""
    def add_base(found):
        return f"{found['attribute']}{base}/{found['folder']}/"
    return SHARED_ADDRESS.sub(add_base, page)


def leftover_addresses(page):
    """Relative addresses in the page that are neither a book file nor
    handled by this tool, so a person can check them."""
    leftovers = []
    for address in ANY_ADDRESS.findall(page):
        is_outside = address.startswith(("https://", "http://", "#",
                                         "data:", "mailto:"))
        is_book_file = address.split("/")[0] in BOOK_FOLDERS
        if address and not is_outside and not is_book_file:
            leftovers.append(address)
    return leftovers


def parse_arguments():
    """Read the command line."""
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("version", help="exact template tag, e.g. 2.1.0")
    parser.add_argument("output", help="the book's index.html to write")
    parser.add_argument("--full", action="store_true",
                        help="write the whole quiz page with CDN addresses"
                        " instead of the small loader page")
    parser.add_argument("--source", help="with --full: read this index.html"
                        " instead of downloading it from the tag")
    parser.add_argument("--no-check", action="store_true",
                        help="do not check that the tag holds js/boot.js")
    return parser.parse_args()


def write_shell(arguments):
    """Write the small loader page."""
    if not arguments.no_check:
        download_text(f"{cdn_base(arguments.version)}/{BOOT_SCRIPT}")
    Path(arguments.output).write_text(shell_page(arguments.version),
                                      encoding="utf-8")
    print(f"Wrote {arguments.output}: it loads {BOOT_SCRIPT} from "
          f"{cdn_base(arguments.version)}/")


def write_full_page(arguments):
    """Write the whole quiz page with CDN addresses."""
    page = read_template_page(arguments.version, arguments.source)
    if BASE_SCRIPT not in page:
        sys.exit(f"This page has no {BASE_SCRIPT}, so it cannot load from "
                 "a CDN. Use a tag made after that file was added.")
    book_page = point_at_cdn(page, cdn_base(arguments.version))
    Path(arguments.output).write_text(book_page, encoding="utf-8")
    shared = len(SHARED_ADDRESS.findall(page))
    print(f"Wrote {arguments.output}: {shared} addresses now point at "
          f"{cdn_base(arguments.version)}/")
    for address in leftover_addresses(book_page):
        print(f"  Check this address (left as it was): {address}")


def main():
    """Write the book's index.html and report anything unusual."""
    arguments = parse_arguments()
    if not VERSION_PATTERN.match(arguments.version):
        sys.exit(f"'{arguments.version}' is not a tag like 2.1.0. Use an "
                 "exact tag, not a branch.")
    if arguments.full:
        write_full_page(arguments)
    else:
        write_shell(arguments)


if __name__ == "__main__":
    main()
