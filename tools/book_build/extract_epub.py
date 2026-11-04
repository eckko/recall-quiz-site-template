#!/usr/bin/env python3
"""Cut a Calibre-style EPUB into chapters, sections and subtopics (trial).

Chapters are found by number ("Chapter 3: ...", "3. ...") or, when the
navigation titles carry no numbers, by the chapter title of chapters.json.
An appendix unit ("Appendix", "Appendices A and D") reads every file from
the first appendix entry to the next other entry. A picture placed straight
in a wrapper div beside its caption is kept.


A chapter may also carry "subsections": the titles from "sections" that are
subtopics (level 3) of the section listed before them, for books whose EPUB
has no heading tags to show the nesting. Tables (a play script set as a
two-column table) are kept as paragraphs, one per speaker.

usage: extract_epub.py EPUB_DIR CHAPTERS_JSON OUT_DIR
EPUB_DIR is the unzipped EPUB. Section titles come from chapters.json (the
existing chapter map); the EPUB is searched for them. Writes one JSON per
chapter to OUT_DIR/chapters/, the figures to OUT_DIR/media-plain/ (scratch
only, never committed) and OUT_DIR/extract-report.json.
"""
import colorsys, json, os, re, shutil, sys, warnings
from pathlib import Path
from bs4 import BeautifulSoup, NavigableString, Tag
from html import escape, unescape
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
# the navigation file writes an apostrophe as &#39; and & as &amp;
nav_files = [(unescape(t), f) for t, f in nav]
file_index = {f: i for i, f in enumerate(spine)}


def file_range(start_file, section_titles=()):
    """Files of one chapter: from its first file up to the next navigation
    entry that is not one of its own sections. A section entry can point
    into a later file of the same chapter (Calibre splits long chapters
    into part0007_split_000.html, part0007_split_001.html, ...); such an
    entry must not end the chapter."""
    skip = {norm(t) for t in section_titles}
    first = file_index[start_file]
    later = sorted({file_index[f] for t, f in nav_files
                    if f in file_index and file_index[f] > first
                    and norm(t) not in skip})
    last = (later[0] if later else len(spine)) - 1
    return spine[first:last + 1]


_map = json.loads(chapters_json.read_text(encoding="utf8"))
chapters = _map["chapters"]
book_id = _map["id"]
nav_by_number = {}
for title, f in nav_files:
    m = re.match(r"(?:Chapter\s+|#\s*)?(\d+)\s*[-.:]\s", title, re.I)
    if m:
        nav_by_number[int(m.group(1))] = f
APPENDIX_TITLE = r"Appendi(?:x|ces)\b"
appendix_nav = [(t, f) for t, f in nav_files
                if re.match(APPENDIX_TITLE, t, re.I)]
appendix_titles = [t for t, f in appendix_nav]
appendix_file = appendix_nav[0][1] if appendix_nav else None


def chapter_nav_file(number, unit_title):
    """The navigation file of chapter `number`: the entry numbered
    "Chapter 3: ..." or "3. ...", else (titles without numbers) the entry
    whose title is the chapter's title in chapters.json."""
    if number in nav_by_number:
        return nav_by_number[number]
    key = norm(unit_title)
    for title, f in nav_files:
        if f in file_index and key and norm(title) == key:
            return f
    for title, f in nav_files:
        if f in file_index and key and norm(title).startswith(key):
            return f
    return None


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


def unit_nav_file(unit):
    """For a unit like "Rule #1" or "Part 2 Step 3" whose own navigation
    entry starts with the unit name ("Rule #1: Work Deeply"): the file that
    entry points to, else None. Its sections are headings inside the
    unit's files, not navigation entries of their own."""
    key = norm(unit)
    for title, f in nav_files:
        if f in file_index and re.match(re.escape(key) + r"\b", norm(title)):
            return f
    return None


# ----- text colours
# The book builder keeps only em, strong, sup and br, but a book that colours
# words (red variable names, blue terms) loses that when the span is dropped.
# A clearly coloured span is kept as <span class="c-red"> (or orange, yellow,
# green, blue, purple); reader/style.css gives each name a colour that stays
# readable on every reading theme. Black, white and grey are not colours.
COLOUR_HUES = ((15, "red"), (45, "orange"), (70, "yellow"), (170, "green"),
               (260, "blue"), (345, "purple"), (361, "red"))


def colour_name(value):
    """"red", "blue", ... for a CSS colour (#rgb, #rrggbb or rgb(r, g, b))
    that is clearly a colour; "" for black, white, grey or anything else."""
    value = value.strip().lower()
    short = re.fullmatch(r"#([0-9a-f])([0-9a-f])([0-9a-f])", value)
    if short:
        value = "#" + "".join(c * 2 for c in short.groups())
    full = re.fullmatch(r"#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})", value)
    if full:
        red, green, blue = (int(c, 16) for c in full.groups())
    else:
        rgb = re.fullmatch(r"rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)", value)
        if not rgb:
            return ""
        red, green, blue = (int(c) for c in rgb.groups())
    hue, saturation, bright = colorsys.rgb_to_hsv(red / 255, green / 255,
                                                  blue / 255)
    if saturation < 0.4 or bright < 0.25:
        return ""
    degrees = hue * 360
    return next(name for limit, name in COLOUR_HUES if degrees < limit)


def class_colours():
    """Class name -> colour name, from the colour: rules of the EPUB's
    stylesheets (background-color is not text colour and is skipped)."""
    found = {}
    for item in opf.find_all("item"):
        href = item.get("href", "")
        if item.get("media-type") != "text/css" and not href.endswith(".css"):
            continue
        path = opf_path.parent / href
        if not path.exists():
            continue
        css = path.read_text(encoding="utf8", errors="ignore")
        for rule in re.finditer(r"\.([\w-]+)\s*\{([^}]*)\}", css):
            colour = re.search(r"(?<![-\w])color\s*:\s*([^;}]+)", rule.group(2))
            if colour and colour_name(colour.group(1)):
                found[rule.group(1)] = colour_name(colour.group(1))
    return found


CLASS_COLOURS = class_colours()


def tag_colour(tag):
    """Colour name of a tag's own text colour: a class that a stylesheet
    colours, a class like fg-D50000, or an inline style color:."""
    for name in tag.get("class", []):
        if name in CLASS_COLOURS:
            return CLASS_COLOURS[name]
        hexed = re.fullmatch(r"fg-([0-9A-Fa-f]{6})", name)
        if hexed and colour_name("#" + hexed.group(1)):
            return colour_name("#" + hexed.group(1))
    style = re.search(r"(?<![-\w])color\s*:\s*([^;]+)", tag.get("style", ""))
    return colour_name(style.group(1)) if style else ""


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
            colour = tag_colour(child) if name not in ("img", "br") else ""
            if colour and inner.strip():
                parts[-1] = f'<span class="c-{colour}">{parts[-1]}</span>'
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


def tables_to_paragraphs(soup):
    """Replace each <table> by paragraphs so its text is not lost. A row
    whose first cell has text (a speaker's name) starts a paragraph; a row
    with an empty first cell continues the paragraph above."""
    for table in soup.find_all("table"):
        paragraphs = []
        for row in table.find_all("tr"):
            cells = row.find_all(["td", "th"])
            if not cells:
                continue
            label = plain(cells[0]) if len(cells) > 1 else ""
            if label or not paragraphs:
                paragraphs.append(soup.new_tag("p"))
            else:
                paragraphs[-1].append(" ")
            for k, cell in enumerate(cells):
                if k and (label or len(paragraphs[-1].contents) > 1):
                    paragraphs[-1].append(" ")
                paragraphs[-1].extend(list(cell.contents))
        for new in paragraphs:
            table.insert_before(new)
        table.decompose()


def title_forms(unit_title):
    """Every way a chapter's own title line can be written: the whole title,
    the parts either side of ": ", each without a leading "Chapter N"."""
    forms = {unit_title}
    forms |= set(unit_title.split(": "))
    forms |= {re.sub(r"^chapter\s+\d+\s*", "", f, flags=re.I)
              for f in list(forms)}
    return {norm(f) for f in forms if norm(f)}


def is_quote_line(block, text):
    """True for a quoted line that is not a heading tag: a myth or epigraph
    such as "You have to be born funny." must not open a section that is
    also a real heading later in the chapter."""
    quoted = text[:1] in ("“", '"') and text[-1:] in ("”", '"')
    return quoted and not re.fullmatch(r"h[1-6]", block.name)


def is_title_line(block, text, forms, heading_keys):
    """True for the chapter's own title line written as an h1/h2 before any
    section: it equals the chapter title (or its tail after "Chapter N" or
    ": ") and the same words come again as a real heading below it."""
    key = norm(text)
    if block.name not in ("h1", "h2") or not key:
        return False
    like = key in forms or (len(key) > 3 and any(
        f.endswith(key) for f in forms))
    return like and heading_keys.count(key) > 1


report = {"chapters": {}, "excluded": [], "images": {"found": 0, "placed": 0,
                                                       "alt_generated": 0}}
for c in chapters:
    unit = c["unit"]
    section_starts = {}   # file -> section title it opens (unnumbered units)
    if re.match(APPENDIX_TITLE, unit, re.I):
        if not appendix_file:
            continue      # the EPUB has no appendix entry to cut
        files = file_range(appendix_file, appendix_titles + c["sections"])
    elif re.match(r"Chapter \d+$", unit):
        start = chapter_nav_file(int(unit.split()[1]), c["unitTitle"])
        if not start:
            print(f"{unit}: no navigation entry numbered {unit.split()[1]} "
                  f"or titled {c['unitTitle']!r}; skipped")
            continue
        files = file_range(start, c["sections"])
    else:
        section_starts = unit_sections_in_nav(c["sections"])
        own_file = unit_nav_file(unit) if not section_starts else None
        if not section_starts and not own_file:
            continue      # the whole-book unit has no text to cut
        files = []
        if own_file:
            files = file_range(own_file, c["sections"])
        for start in sorted(section_starts, key=file_index.get):
            files += [x for x in file_range(start, c["sections"])
                      if x not in files]
    prefix = c["idPrefix"]
    wanted = {norm(s): s for s in c["sections"]}
    sub_titles = set(c.get("subsections", []))
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
    section_depth = None   # heading level (h2 = 2) of the current topic

    def unique_id(base):
        """A node id nobody has used yet: books repeat titles such as
        "Closing notes" under several topics."""
        taken = {n["id"] for n in nodes}
        candidate, number = base, 2
        while candidate in taken:
            candidate, number = f"{base}-{number}", number + 1
        return candidate
    for f in files:
        soup = BeautifulSoup((epub / f).read_text(encoding="utf8"), "lxml")
        body = soup.body or soup
        tables_to_paragraphs(body)
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
        heading_keys = [norm(h.get_text(" ", strip=True)) for h in
                        body.find_all(["h1", "h2", "h3", "h4"])]
        block_list = body.find_all(["p", "div", "li", "blockquote", "h1", "h2", "h3", "h4"],
                                   recursive=True)
        for position, block in enumerate(block_list):
            if block.find(["p", "div", "li", "blockquote"]):
                # a picture placed straight in a wrapper div beside its
                # caption paragraph is kept; the wrapper's text blocks
                # are read on their own
                for img in block.find_all("img", recursive=False):
                    current["html"].append(media_hook(img))
                continue
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
            forms = title_forms(c["unitTitle"])
            if cls == "calibre_17" and not nodes[1:] and (
                    norm(text) in forms or (len(norm(text)) > 3 and any(
                        f.endswith(norm(text)) for f in forms))):
                continue
            if cls == "calibre_17" and seen_chapter_header and \
                    norm(text) == norm(c["unitTitle"]):
                continue
            if not nodes[1:] and is_title_line(
                    block, text, forms, heading_keys):
                continue
            key = norm(text)
            if (re.fullmatch(r"\d{1,3}", text) and key not in wanted
                    and position + 1 < len(block_list)):
                # a heading printed as a number line and a title line: the
                # number belongs to the heading that follows, not to the
                # text above
                after = plain(block_list[position + 1])
                if len(after) < 120 and norm(after) in wanted:
                    continue
            if (current is nodes[0] and not single and
                    key == norm(c["unitTitle"]) and not current["html"]):
                continue      # the unit's own title line is not text
            if is_quote_line(block, text):
                key = ""          # a quotation is never a section heading
            if key in wanted and len(text) < 120 and single:
                found_titles.add(wanted[key])
                continue
            if key in wanted and len(text) < 120:
                found_titles.add(wanted[key])
                depth = int(block.name[1]) if re.fullmatch(
                    r"h[1-6]", block.name) else None
                listed_sub = wanted[key] in sub_titles
                if ((listed_sub or (depth and section_depth
                                    and depth > section_depth))
                        and section_node["level"] == 2
                        and section_node["id"] != f"{prefix}-opening"):
                    # a deeper heading (h3 inside an h2 topic) that the
                    # chapter map lists as a section: a subtopic of the
                    # topic above, not a topic of its own
                    sub_count += 1
                    node = {"id": unique_id(f"{prefix}-{slug(wanted[key])}"),
                            "level": 3, "title": wanted[key],
                            "parent": section_node["id"],
                            "sectionKey": wanted[key], "html": []}
                    nodes.append(node)
                    current = node
                    continue
                node = {"id": unique_id(f"{prefix}-{slug(wanted[key])}"),
                        "level": 2, "title": wanted[key], "parent": None,
                        "html": []}
                nodes.append(node)
                current = section_node = node
                section_depth = depth
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
