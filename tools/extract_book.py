#!/usr/bin/env python3
"""Turn a book file (EPUB or PDF) into plain text for writing questions.

    python3 tools/extract_book.py BOOK_FILE OUTPUT_FOLDER

Writes into OUTPUT_FOLDER:

    parts/0001.txt ...     the text, one file per EPUB chapter file or
                           per PDF page, with headings marked "## "
    book-outline.json      one entry per file: its table-of-contents
                           title, first heading, word count and page
                           estimate, plus the book's table of contents
    book-text.txt          all the text in reading order (used later to
                           check that quotes are exact)

Pages: a PDF has real pages. An EPUB has none, so pages are estimated
as words / 300 (a typical printed page).

Needs only the Python standard library for EPUB. For PDF it uses
pdftotext (poppler) if installed, otherwise the pypdf package.
"""

import json
import re
import shutil
import subprocess
import sys
import zipfile
from html.parser import HTMLParser
from pathlib import Path, PurePosixPath
from urllib.parse import unquote
from xml.etree import ElementTree

WORDS_PER_PAGE = 300
# A PDF page with less text than this is probably a scanned image.
FEW_CHARACTERS_ON_A_PAGE = 200


# ------------------------------------------------------------- EPUB


class TextFromHtml(HTMLParser):
    """Collect the visible text of an XHTML file, marking headings.

    Headings are <h1> to <h6>, plus any element whose class name
    contains "head", "title" or "chapter" (publishers often style
    sub-headings with classes instead of heading tags).
    """

    BLOCK_TAGS = {"p", "div", "li", "br", "tr", "blockquote", "section",
                  "h1", "h2", "h3", "h4", "h5", "h6", "figcaption"}
    SKIPPED_TAGS = {"script", "style", "head"}

    def __init__(self):
        super().__init__()
        self.lines = []
        self.current_line = []
        self.heading_depth = 0
        self.skip_depth = 0
        self.open_tags = []

    def handle_starttag(self, tag, attributes):
        class_name = dict(attributes).get("class", "") or ""
        is_heading = (re.fullmatch(r"h[1-6]", tag) is not None or
                      re.search(r"head|title|chapter", class_name, re.I))
        self.open_tags.append((tag, bool(is_heading)))
        if tag in self.SKIPPED_TAGS:
            self.skip_depth += 1
        if tag in self.BLOCK_TAGS:
            self.end_line()
        if is_heading:
            self.end_line()
            self.heading_depth += 1

    def handle_endtag(self, tag):
        while self.open_tags:
            open_tag, was_heading = self.open_tags.pop()
            if open_tag in self.SKIPPED_TAGS:
                self.skip_depth -= 1
            if was_heading:
                self.end_line()
                self.heading_depth -= 1
            if open_tag == tag:
                break
        if tag in self.BLOCK_TAGS:
            self.end_line()

    def handle_data(self, data):
        if self.skip_depth == 0:
            self.current_line.append(data)

    def end_line(self):
        """Finish the line being collected, marking it if a heading."""
        text = re.sub(r"\s+", " ", "".join(self.current_line)).strip()
        self.current_line = []
        if not text:
            return
        if self.heading_depth > 0:
            # Join a heading split over two elements (number + title).
            if self.lines and self.lines[-1].startswith("## ") \
                    and len(self.lines[-1]) < 12:
                self.lines[-1] += " " + text
                return
            text = "## " + text
        self.lines.append(text)

    def text(self):
        """All collected lines as one string."""
        self.end_line()
        return "\n".join(self.lines)


def read_xml(book_zip, name):
    """Parse an XML file inside the EPUB."""
    return ElementTree.fromstring(book_zip.read(name))


def local_name(element):
    """Tag name without its XML namespace."""
    return element.tag.rsplit("}", 1)[-1]


def find_package_file(book_zip):
    """Path of the .opf file that lists the book's contents."""
    container = read_xml(book_zip, "META-INF/container.xml")
    for element in container.iter():
        if local_name(element) == "rootfile":
            return element.get("full-path")
    raise SystemExit("This EPUB has no package file (container.xml).")


def read_table_of_contents(book_zip, manifest, package_folder):
    """Return [{title, file}] from nav.xhtml (EPUB 3) or toc.ncx (2)."""
    entries = []
    for item in manifest.values():
        path = str(PurePosixPath(package_folder) / item["href"])
        if "nav" in (item.get("properties") or ""):
            parser = TableOfContentsFromNav()
            parser.feed(book_zip.read(path).decode("utf-8", "replace"))
            folder = str(PurePosixPath(path).parent)
            for title, href in parser.entries:
                entries.append({"title": title,
                                "file": join_href(folder, href)})
            return entries
    for item in manifest.values():
        if item["media-type"] == "application/x-dtbncx+xml":
            path = str(PurePosixPath(package_folder) / item["href"])
            folder = str(PurePosixPath(path).parent)
            for point in read_xml(book_zip, path).iter():
                if local_name(point) != "navPoint":
                    continue
                title = first_text(point)
                source = next(element.get("src") for element in point.iter()
                              if local_name(element) == "content")
                entries.append({"title": title,
                                "file": join_href(folder, source)})
    return entries


def first_text(nav_point):
    """The label of an NCX navPoint."""
    for element in nav_point.iter():
        if local_name(element) == "text":
            return " ".join("".join(element.itertext()).split())
    return ""


def join_href(folder, href):
    """Resolve a link relative to a folder, dropping any #fragment."""
    path = unquote(href.split("#", 1)[0])
    parts = []
    for part in (folder + "/" + path).split("/"):
        if part == "..":
            parts.pop() if parts else None
        elif part not in ("", "."):
            parts.append(part)
    return "/".join(parts)


class TableOfContentsFromNav(HTMLParser):
    """Collect (title, href) for every link inside <nav epub:type=toc>."""

    def __init__(self):
        super().__init__()
        self.entries = []
        self.inside_toc = False
        self.link = None
        self.link_text = []

    def handle_starttag(self, tag, attributes):
        attributes = dict(attributes)
        if tag == "nav" and "toc" in (attributes.get("epub:type") or
                                      attributes.get("role") or "toc"):
            self.inside_toc = True
        if self.inside_toc and tag == "a" and attributes.get("href"):
            self.link = attributes["href"]
            self.link_text = []

    def handle_endtag(self, tag):
        if tag == "a" and self.link is not None:
            title = " ".join("".join(self.link_text).split())
            self.entries.append((title, self.link))
            self.link = None
        if tag == "nav":
            self.inside_toc = False

    def handle_data(self, data):
        if self.link is not None:
            self.link_text.append(data)


def extract_epub(book_path, output_folder):
    """Write one text file per spine item and return the outline."""
    with zipfile.ZipFile(book_path) as book_zip:
        package_path = find_package_file(book_zip)
        package_folder = str(PurePosixPath(package_path).parent)
        package = read_xml(book_zip, package_path)
        manifest = {}
        for item in package.iter():
            if local_name(item) == "item":
                manifest[item.get("id")] = {
                    "href": item.get("href"),
                    "media-type": item.get("media-type"),
                    "properties": item.get("properties"),
                }
        spine = [item.get("idref") for item in package.iter()
                 if local_name(item) == "itemref"]
        contents = read_table_of_contents(book_zip, manifest,
                                          package_folder)
        titles_by_file = {}
        for entry in contents:
            titles_by_file.setdefault(entry["file"], entry["title"])

        outline = []
        for number, item_id in enumerate(spine, start=1):
            item = manifest[item_id]
            path = join_href(package_folder, item["href"])
            parser = TextFromHtml()
            parser.feed(book_zip.read(path).decode("utf-8", "replace"))
            text = parser.text()
            outline.append(write_part(output_folder, number, text, {
                "sourceFile": path,
                "tocTitle": titles_by_file.get(path, ""),
            }))
    return {"format": "epub", "pagesAreEstimated": True,
            "tableOfContents": contents, "parts": outline}


# ------------------------------------------------------------- PDF


def pdf_page_texts(book_path):
    """Return a list with the text of every page."""
    if shutil.which("pdftotext"):
        page_count = pdf_page_count(book_path)
        texts = []
        for page in range(1, page_count + 1):
            result = subprocess.run(
                ["pdftotext", "-f", str(page), "-l", str(page),
                 str(book_path), "-"],
                capture_output=True, text=True, check=True)
            texts.append(result.stdout)
        return texts
    from pypdf import PdfReader
    return [page.extract_text() or "" for page in PdfReader(book_path).pages]


def pdf_page_count(book_path):
    """Number of pages, from pdfinfo."""
    result = subprocess.run(["pdfinfo", str(book_path)],
                            capture_output=True, text=True, check=True)
    match = re.search(r"^Pages:\s+(\d+)", result.stdout, re.M)
    return int(match.group(1))


def pdf_bookmarks(book_path):
    """The PDF's own table of contents as [{title, page, level}]."""
    try:
        from pypdf import PdfReader
    except ImportError:
        return []
    reader = PdfReader(book_path)
    bookmarks = []

    def walk(items, level):
        for item in items:
            if isinstance(item, list):
                walk(item, level + 1)
                continue
            try:
                page = reader.get_destination_page_number(item) + 1
            except Exception:
                page = None
            bookmarks.append({"title": item.title, "page": page,
                              "level": level})

    walk(reader.outline, 1)
    return bookmarks


def extract_pdf(book_path, output_folder):
    """Write one text file per page and return the outline."""
    texts = pdf_page_texts(book_path)
    outline = []
    for number, text in enumerate(texts, start=1):
        outline.append(write_part(output_folder, number, text.strip(),
                                  {"page": number}))
    nearly_empty = sum(1 for text in texts
                       if len(text.strip()) < FEW_CHARACTERS_ON_A_PAGE)
    return {
        "format": "pdf",
        "pagesAreEstimated": False,
        "pageCount": len(texts),
        "looksScanned": nearly_empty > len(texts) * 0.5,
        "tableOfContents": pdf_bookmarks(book_path),
        "parts": outline,
    }


# ------------------------------------------------------------- shared


def write_part(output_folder, number, text, details):
    """Save one part's text and return its outline entry."""
    name = f"{number:04d}.txt"
    (output_folder / "parts" / name).write_text(text)
    words = len(text.split())
    headings = [line[3:] for line in text.splitlines()
                if line.startswith("## ")]
    return {
        "part": name,
        **details,
        "firstHeading": headings[0] if headings else "",
        "headings": headings[:40],
        "words": words,
        "estimatedPages": round(words / WORDS_PER_PAGE, 1),
        "opening": " ".join(text.split()[:25]),
    }


def main():
    """Read the command line, extract, and print a short summary."""
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    book_path = Path(sys.argv[1])
    output_folder = Path(sys.argv[2])
    (output_folder / "parts").mkdir(parents=True, exist_ok=True)

    suffix = book_path.suffix.lower()
    if suffix == ".epub":
        outline = extract_epub(book_path, output_folder)
    elif suffix == ".pdf":
        outline = extract_pdf(book_path, output_folder)
    else:
        raise SystemExit("Give an .epub or .pdf file.")

    outline["wordsPerPage"] = WORDS_PER_PAGE
    outline["totalWords"] = sum(part["words"] for part in outline["parts"])
    (output_folder / "book-outline.json").write_text(
        json.dumps(outline, indent=1, ensure_ascii=False))
    all_text = "\n\n".join(
        (output_folder / "parts" / part["part"]).read_text()
        for part in outline["parts"])
    (output_folder / "book-text.txt").write_text(all_text)

    print(f"{len(outline['parts'])} parts, "
          f"{outline['totalWords']} words, "
          f"about {outline['totalWords'] // WORDS_PER_PAGE} pages of text")
    if outline.get("looksScanned"):
        print("WARNING: most pages have almost no text. This PDF is "
              "probably scanned and needs OCR first.")


if __name__ == "__main__":
    main()
