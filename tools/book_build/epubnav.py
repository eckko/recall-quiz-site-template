"""Small helpers shared by the EPUB build tools."""
import re
from pathlib import Path

NCX_TYPE = "application/x-dtbncx+xml"


def read_ncx(opf_dir, opf_text):
    """The navigation (NCX) text of an unzipped EPUB.

    Uses toc.ncx next to the package file when there is one, otherwise the
    NCX file the package declares (some EPUBs name it <isbn>_toc.ncx)."""
    plain = Path(opf_dir) / "toc.ncx"
    if plain.exists():
        return plain.read_text(encoding="utf8")
    for item in re.findall(r"<item\b[^>]*>", opf_text):
        if NCX_TYPE in item:
            href = re.search(r'href="([^"]+)"', item)
            declared = Path(opf_dir) / href.group(1) if href else None
            if declared and declared.exists():
                return declared.read_text(encoding="utf8")
    raise SystemExit("no navigation file: the EPUB has no toc.ncx and its "
                     "package file declares no NCX")


def first_word_key(text):
    """Lower-case first part of a title before a colon, for matching an
    EPUB navigation entry ("Foreword: to the 50th ...") with a section
    title ("Foreword to the 50th Anniversary Edition: ...")."""
    text = text.replace("’", "'").replace("‘", "'")
    head = text.split(":")[0]
    return re.sub(r"[^a-z0-9 ]", "", head.lower()).strip()
