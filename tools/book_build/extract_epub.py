#!/usr/bin/env python3
"""Cut a Calibre-style EPUB into chapters, sections and subtopics (trial).

usage: extract_epub.py EPUB_DIR CHAPTERS_JSON OUT_DIR
EPUB_DIR is the unzipped EPUB. Section titles come from chapters.json (the
existing chapter map); the EPUB is searched for them. Writes one JSON per
chapter to OUT_DIR/chapters/, the figures to OUT_DIR/media-plain/ (scratch
only, never committed) and OUT_DIR/extract-report.json.
"""
import json, os, re, shutil, sys, warnings
from pathlib import Path
from bs4 import BeautifulSoup, NavigableString, Tag
from html import escape
sys.path.insert(0, str(Path(__file__).parent))
from epubnav import read_ncx, first_word_key
from bs4 import XMLParsedAsHTMLWarning
warnings.filterwarnings("ignore", category=XMLParsedAsHTMLWarning)

epub, chapters_json, out = map(Path, sys.argv[1:4])
(out / "chapters").mkdir(parents=True, exist_ok=True)
(out / "media-plain").mkdir(parents=True, exist_ok=True)


def find_root(top):
    """Where the package file is: META-INF/container.xml names it, so
    EPUBs with an OEBPS/ folder and any file name work."""
    container = top / "META-INF" / "container.xml"
    if container.exists():
        m = re.search(r'full-path="([^"]+)"', container.read_text(encoding="utf8"))
        if m:
            return (top / m.group(1)).parent, top / m.group(1)
    return top, top / "content.opf"
epub, opf_path = find_root(epub)


def norm(text):
    text = text.replace("’", "'").replace("‘", "'")
    return re.sub(r"[^a-z0-9 ]", "", text.lower()).strip()


def slug(text):
    return re.sub(r"[^a-z0-9]+", "-", norm(text)).strip("-")[:48] or "x"


# ----- spine order and navigation
opf = BeautifulSoup(opf_path.read_text(encoding="utf8"), "xml")
manifest = {i["id"]: i["href"] for i in opf.find_all("item")}
spine = [manifest[r["idref"]] for r in opf.find_all("itemref")]
ncx = read_ncx(epub, opf_path.read_text(encoding="utf8"))
nav = re.findall(r"<navPoint[^>]*>.*?<text>(.*?)</text>.*?"
                 r'<content src="([^"#]+)', ncx, re.S)
nav_files = [(t, f) for t, f in nav]
file_index = {f: i for i, f in enumerate(spine)}
starts = sorted({file_index[f] for _, f in nav_files if f in file_index})


def file_range(start_file):
    first = file_index[start_file]
    later = [s for s in starts if s > first]
    last = (later[0] if later else len(spine)) - 1
    return spine[first:last + 1]


_map = json.loads(chapters_json.read_text(encoding="utf8"))
chapters = _map["chapters"]
book_id = _map["id"]
nav_by_number = {}
for title, f in nav_files:
    m = re.match(r"(?:Chapter\s+)?(\d+)\s*[-.:]\s", title, re.I)
    if m:
        nav_by_number[int(m.group(1))] = f
appendix_file = next(
    (f for t, f in nav_files if re.match(r"Appendix\b", t)), None)


def unit_sections_in_nav(sections):
    """For an unnumbered unit with text (Foreword, Introduction, Conclusion,
    Afterword, ...): {nav file: section title} for each section that has a
    navigation entry of its own. An entry matches a section when the
    section title starts with the entry's title up to its colon, so
    "Foreword: to the 50th ..." finds "Foreword to the 50th Anniversary
    Edition: Ten Lessons ..."."""
    found = {}
    for title, f in nav_files:
        key = first_word_key(title)
        if not key or re.match(r"(\d|chapter\b|part\b|appendix\b)", key):
            continue
        for section in sections:
            if re.match(re.escape(key) + r"\b", norm(section)):
                found.setdefault(f, section)
                break
    return found


# ----- inline cleaning
def inline(node, media_hook):
    parts = []
    for child in node.children:
        if isinstance(child, NavigableString):
            parts.append(escape(str(child)))
        elif isinstance(child, Tag):
            name = child.name
            cls = " ".join(child.get("class", []))
            inner = inline(child, media_hook)
            if name == "img":
                parts.append(media_hook(child))
            elif name in ("em", "i") or "italic" in cls:
                parts.append(f"<em>{inner}</em>")
            elif name in ("strong", "b") or cls.split() == ["bold"]:
                parts.append(f"<strong>{inner}</strong>")
            elif name == "sup":
                parts.append(f"<sup>{inner}</sup>")
            elif name == "br":
                parts.append("<br>")
            else:
                parts.append(inner)
    return "".join(parts)


def plain(tag):
    """Text of a block; drop-cap spans must not add a space."""
    pieces = []
    for node in tag.descendants:
        if isinstance(node, NavigableString):
            pieces.append(str(node))
        elif getattr(node, "name", None) == "br":
            pieces.append(" ")
    return re.sub(r"\s+", " ", "".join(pieces)).strip()


report = {"chapters": {}, "excluded": [], "images": {"found": 0, "placed": 0,
                                                       "alt_generated": 0}}
for c in chapters:
    unit = c["unit"]
    section_starts = {}   # file -> section title it opens (unnumbered units)
    if unit == "Appendix":
        files = [appendix_file]
    elif re.match(r"Chapter \d+$", unit):
        files = file_range(nav_by_number[int(unit.split()[1])])
    else:
        section_starts = unit_sections_in_nav(c["sections"])
        if not section_starts:
            continue      # the whole-book unit has no text to cut
        files = []
        for start in sorted(section_starts, key=file_index.get):
            files += [x for x in file_range(start) if x not in files]
    prefix = c["idPrefix"]
    wanted = {norm(s): s for s in c["sections"]}
    single = len(c["sections"]) == 1
    nodes = [{"id": f"{prefix}-" + (slug(c["sections"][0]) if single
                                      else "opening"), "level": 2,
              "title": c["sections"][0] if single else "Opening",
              "parent": None, "html": []}]
    current = nodes[0]
    section_node = nodes[0]
    media, found_titles = [], set()
    sub_count = 0

    def media_hook(img):
        src = img.get("src", "")
        name = Path(src).name
        mid = f"{book_id}/{prefix}/{Path(name).stem}"
        if not any(m["id"] == mid for m in media):
            alt = (img.get("alt") or "").strip()
            gen = not alt
            report["images"]["alt_generated"] += gen
            media.append({"id": mid, "file": name,
                          "alt": alt or f"Figure in {section_node['title']}",
                          "altGenerated": gen})
            # src is relative to the chapter file, which may sit in a folder
            image = Path(os.path.normpath((epub / f).parent / src))
            shutil.copy(image, out / "media-plain" / f"{prefix}-{name}")
            report["images"]["placed"] += 1
        return f'<figure data-media="{mid}"></figure>'

    seen_chapter_header = 0
    for f in files:
        soup = BeautifulSoup((epub / f).read_text(encoding="utf8"), "lxml")
        body = soup.body or soup
        opens = section_starts.get(f)
        in_title = bool(opens)    # still inside the file's own title blocks
        if opens:
            if single:       # the unit's only section already has its node
                node = nodes[0]
            else:
                node = {"id": f"{prefix}-{slug(opens)}", "level": 2,
                        "title": opens, "parent": None, "html": []}
                nodes.append(node)
            current = section_node = node
            found_titles.add(opens)
        for block in body.find_all(["p", "div", "li", "blockquote", "h1", "h2", "h3", "h4"],
                                   recursive=True):
            if block.find(["p", "div", "li", "blockquote"]):
                continue                      # only leaf blocks
            cls = " ".join(block.get("class", []))
            text = plain(block)
            has_img = block.find("img") is not None
            if "mbp_pagebreak" in cls or (not text and not has_img):
                continue
            if in_title:
                # the title is split over several blocks (heading, subtitle,
                # a title line): the node already carries it
                if block.name in ("h1", "h2") or (
                        len(text) < 120 and norm(text) and
                        norm(text) in norm(opens)):
                    continue
                in_title = False
            if cls == "calibre_17" and re.match(r"^CHAPTER \d+$", text):
                seen_chapter_header = 1
                continue
            if cls == "calibre_17" and not nodes[1:] and \
                    norm(text) == norm(c["unitTitle"].split(": ")[0]):
                continue
            if cls == "calibre_17" and seen_chapter_header and \
                    norm(text) == norm(c["unitTitle"]):
                continue
            key = norm(text)
            if key in wanted and len(text) < 120 and single:
                found_titles.add(wanted[key])
                continue
            if key in wanted and len(text) < 120:
                found_titles.add(wanted[key])
                node = {"id": f"{prefix}-{slug(wanted[key])}", "level": 2,
                        "title": wanted[key], "parent": None, "html": []}
                nodes.append(node)
                current = section_node = node
                continue
            is_short = len(text) <= 70 and not text.endswith((".", ",", ";"))
            if is_short and cls in ("calibre_31", "calibre_12", "calibre_43") \
                    and not has_img:
                sub_count += 1
                node = {"id": f"{section_node['id']}-t{sub_count}-"
                              f"{slug(text)}", "level": 3, "title": text.title()
                        if text.isupper() else text,
                        "parent": section_node["id"], "html": []}
                nodes.append(node)
                current = node
                continue
            body_html = inline(block, media_hook)
            if not body_html.strip():
                continue
            if cls in ("calibre_18",):
                current["html"].append(f'<p class="attr">{body_html}</p>')
            elif cls in ("calibre_42",):
                current["html"].append(f'<p class="epigraph">{body_html}</p>')
            elif body_html.startswith("<figure") and not text:
                current["html"].append(body_html)
            else:
                current["html"].append(f"<p>{body_html}</p>")
    for n in nodes:
        n["html"] = "\n".join(n["html"])
    if single:
        found_titles.add(c["sections"][0])
        report.setdefault("positional", []).append(unit)
    nodes = [n for n in nodes if n["html"] or n["level"] == 2 and
             n["id"] != f"{prefix}-opening"]
    missing = [s for s in c["sections"] if s not in found_titles]
    report["chapters"][unit] = {
        "unitTitle": c["unitTitle"], "files": files, "nodes": len(nodes),
        "sections_expected": len(c["sections"]),
        "sections_found": len(found_titles), "sections_missing": missing,
        "subtopics": sub_count, "figures": len(media),
        "words": sum(len(re.sub(r"<[^>]+>", " ", n["html"]).split())
                     for n in nodes)}
    (out / "chapters" / f"{prefix}.json").write_text(json.dumps(
        {"unit": unit, "unitTitle": c["unitTitle"], "idPrefix": prefix,
         "startFile": files[0], "nodes": nodes, "media": media}, ensure_ascii=False, indent=1),
        encoding="utf8")
report["images"]["found"] = len([p for p in epub.rglob("*") if p.suffix.lower() in (".jpg", ".jpeg", ".png", ".gif")])
(out / "extract-report.json").write_text(json.dumps(report, indent=1))
for unit, r in report["chapters"].items():
    flag = "" if not r["sections_missing"] else f"  MISSING {r['sections_missing']}"
    print(f"{unit:10} files {len(r['files']):2} sections {r['sections_found']}/"
          f"{r['sections_expected']} subtopics {r['subtopics']:2} figs "
          f"{r['figures']} words {r['words']}{flag}")
print(report["images"])
