#!/usr/bin/env python3
"""Write a book site's index.html so the shared files come from a CDN.

    python3 tools/make_book_index.py 2.1.0 ../my-book/index.html

A book site then needs only index.html, questions.json and images/ (plus
media/ or banks/ when the book uses them). Every css/, js/ and htrab/
file is loaded from one tagged copy of this template on jsDelivr, so a
new template release reaches a book by running this tool again.

The page is read from that tag on the CDN (or from --source FILE, for
tests and for working offline), and every css/, js/ and htrab/ address
in it gets the tag's CDN folder put in front. The book's own addresses
(images/, questions.json) are left alone. Use an exact tag such as
2.1.0 (not a branch): a tag never changes, so the book never changes
under you.
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
VERSION_PATTERN = re.compile(r"^\d+(\.\d+){0,2}$")
DOWNLOAD_TIMEOUT_SECONDS = 30
SHARED_ADDRESS = re.compile(
    r'(?P<attribute>\b(?:href|src)=")'
    r"(?P<folder>" + "|".join(SHARED_FOLDERS) + r")/")
ANY_ADDRESS = re.compile(r'\b(?:href|src)="([^"]*)"')


def cdn_base(version):
    """The CDN folder that holds one tag of the template (no trailing
    slash)."""
    return f"{CDN_FOLDER}@{version}"


def read_template_page(version, source_file):
    """The template's index.html: from a file when one is given,
    otherwise from that tag on the CDN."""
    if source_file:
        return Path(source_file).read_text(encoding="utf-8")
    address = f"{cdn_base(version)}/index.html"
    try:
        with urllib.request.urlopen(
                address, timeout=DOWNLOAD_TIMEOUT_SECONDS) as response:
            return response.read().decode("utf-8")
    except OSError as problem:
        sys.exit(f"Could not download {address}: {problem}\n"
                 "Check the tag exists, or pass --source FILE.")


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
    parser.add_argument("--source", help="read this index.html instead of"
                        " downloading it from the tag")
    return parser.parse_args()


def main():
    """Write the book's index.html and report anything unusual."""
    arguments = parse_arguments()
    if not VERSION_PATTERN.match(arguments.version):
        sys.exit(f"'{arguments.version}' is not a tag like 2.1.0. Use an "
                 "exact tag, not a branch.")
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


if __name__ == "__main__":
    main()
