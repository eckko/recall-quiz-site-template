#!/usr/bin/env python3
"""Put the user's own chapter notes (an EPUB made by xray-notes) into the
encrypted site, matched to chapter / section / subtopic nodes.

  add_notes.py --site SITE --key KEY --notes-epub NOTES.epub --report out.json

Chapter files u_chNN.xhtml (or chapter_N.xhtml, chN.xhtml; a unit
"Rule #N" takes u_ruleN.xhtml or ruleN.xhtml) -> the chapter with that
number, whatever its bundle prefix (cNN, uN); u_appendix.xhtml -> Appendix;
u_prologue.xhtml -> Prologue. A unit with no number (Foreword, Preface,
Introduction, Conclusion, Afterword, ...) takes every notes file whose
<h1> is the first word(s) of one of its sections ("Foreword" ->
"Foreword to the 50th Anniversary Edition: ..."): the blue box and opening
text become that section's note, h3/h4 headings match nodes by title and
any that do not match are kept on that section. Under each chapter:
  h3 = section note, h4 = subtopic note, the blue box before the first h3 is the
  chapter note (bundle.notesIntro). Part pages, architecture, 'how to read' and
  'not summarised' pages go to manifest.notesExtra. Unmatched blocks are kept
  under the chapter's 'Other notes' (never dropped) and listed in the report."""
import argparse, json, re, sys, zipfile, difflib
from pathlib import Path
from bs4 import BeautifulSoup
sys.path.insert(0, str(Path(__file__).parent))
from encfmt import encrypt, decrypt, load_key

ap = argparse.ArgumentParser()
ap.add_argument("--site", required=True); ap.add_argument("--key", required=True)
ap.add_argument("--notes-epub", required=True); ap.add_argument("--report")
a = ap.parse_args()
site, key = Path(a.site), load_key(a.key)
z = zipfile.ZipFile(a.notes_epub)

def norm(s):
    s = re.sub(r"[^\w ]", " ", s.lower().replace("’", "").replace("'", ""))
    return re.sub(r"\s+", " ", s).strip()

KEEP = {"p", "ul", "ol", "li", "strong", "em", "b", "i", "blockquote", "div",
        "table", "thead", "tbody", "tr", "td", "th", "br", "sup", "sub"}
def clean(node):
    """sanitised html of a tag: allowed tags, class only on div/p from a fixed list"""
    ok_cls = {"box", "blue", "gold", "goldlabel", "legend", "center"}
    out = BeautifulSoup(str(node), "html.parser")
    for t in out.find_all(True):
        if t.name not in KEEP:
            t.unwrap(); continue
        cls = [c for c in t.get("class", []) if c in ok_cls]
        t.attrs = {"class": cls} if cls else {}
    return str(out)

def find(title, pool):
    t = norm(title)
    for n in pool:
        if norm(n["title"]) == t: return n
    for n in pool:
        x = norm(n["title"])
        if min(len(x), len(t)) >= 12 and (x.startswith(t[:len(x)]) or t.startswith(x[:len(t)])): return n
    m = difflib.get_close_matches(t, [norm(n["title"]) for n in pool], 1, 0.8)
    return next((n for n in pool if m and norm(n["title"]) == m[0]), None)

def blocks(body):
    """-> (intro_html, [(level, title, html)]) in document order"""
    intro, cur, res = [], None, []
    for el in body.children:
        if getattr(el, "name", None) is None:
            continue
        if el.name in ("h3", "h4"):
            cur = [3 if el.name == "h4" else 2, el.get_text(" ", strip=True), [], "opening" in el.get("class", [])]
            res.append(cur); continue
        if el.name in ("h1", "h2") or "label" in el.get("class", []):
            continue
        (cur[2] if cur else intro).append(clean(el))
    return "".join(intro), [(l, t, "".join(h), o) for l, t, h, o in res]

# notes files that open with an <h1> (Foreword, Preface, Conclusion, ...) and
# are not chapter or extra pages: they belong to unnumbered units
NOT_UNIT_FILES = re.compile(
    r"nav|title|arch|architecture|notsum|u_.*|chapter_\d+|ch\d+|rule\d+|"
    r"part\d+")
heading_files = []
for entry in z.namelist():
    found = re.fullmatch(r"OEBPS/([^/]+)\.xhtml", entry)
    if not found or NOT_UNIT_FILES.fullmatch(found.group(1)):
        continue
    h1 = BeautifulSoup(z.read(entry), "html.parser").find("h1")
    if h1:
        heading_files.append((entry, norm(h1.get_text(" ", strip=True))))


def add_note(target, html):
    """Append html to a node's note."""
    target["notes"] = (target["notes"] or "") + html


def notes_by_section_files(c, pre):
    """Notes of an unnumbered unit: one notes file per section node, matched
    by the file's <h1>. Returns True when at least one file was placed."""
    bp = site / "data" / "ch" / f"{pre}.enc"
    b = json.loads(decrypt(bp.read_bytes(), key))
    nodes = b["nodes"]
    taken, pairs = set(), []
    for node in nodes:
        if node["level"] != 2:
            continue
        title = norm(node["title"])
        for entry, heading in heading_files:
            if entry not in taken and heading and (
                    title == heading or title.startswith(heading + " ")):
                taken.add(entry)
                pairs.append((node, entry))
                break
    if not pairs:
        return False
    for n in nodes:
        n["notes"] = None
    b["notesIntro"] = None
    blocks_seen = matched = 0
    for node, entry in pairs:
        intro, bl = blocks(BeautifulSoup(z.read(entry), "html.parser").body)
        add_note(node, intro)
        for level, title, html, is_open in bl:
            blocks_seen += 1
            target = find(title, [n for n in nodes if n is not node])
            if not html.strip():
                continue
            if target is not None:
                add_note(target, html)
                matched += 1
            else:
                add_note(node, f"<h4>{title}</h4>{html}")
    with_notes = sum(1 for n in nodes if n["notes"])
    bp.write_bytes(encrypt(json.dumps(b, ensure_ascii=False).encode("utf8"),
                           key))
    c["notes"] = with_notes
    tot["blocks"] += blocks_seen
    tot["matched"] += blocks_seen
    report["chapters"][pre] = {
        "files": [e for _, e in pairs], "blocks": blocks_seen,
        "matched_to_nodes": matched,
        "kept_on_their_section": blocks_seen - matched,
        "nodes_with_notes": with_notes, "nodes": len(nodes)}
    return True


man_p = site / "data" / "manifest.enc"
man = json.loads(decrypt(man_p.read_bytes(), key))
report = {"chapters": {}, "extra": []}
tot = {"blocks": 0, "matched": 0, "other": 0}
for c in man["chapters"]:
    pre = c["prefix"]
    unit = c.get("unit", "")
    chapter = re.fullmatch(r"Chapter (\d+)", unit)
    rule = re.fullmatch(r"Rule #(\d+)", unit)
    num = chapter.group(1) if chapter else (
        pre[1:] if re.fullmatch(r"c\d+", pre) else None)
    if pre == "app" or unit == "Appendix":
        names = ["u_appendix", "unit_appendix"]
    elif unit == "Prologue":
        names = ["u_prologue"]
    elif unit == "Introduction":
        names = ["u_intro", "unit0", "intro"]
    elif rule:
        names = [f"u_rule{rule.group(1)}", f"rule{rule.group(1)}"]
    else:
        names = [f"u_ch{num}", f"u_c{int(num):02d}", f"u_c{num}",
                 f"chapter_{num}", f"unit{num}", f"ch{num}"] if num else []
    name = next((n for n in names if f"OEBPS/{n}.xhtml" in z.namelist()), None)
    if not name and not num and not rule and notes_by_section_files(c, pre):
        continue
    if not name:
        report["chapters"][pre] = "no notes file"; continue
    bp = site / "data" / "ch" / f"{pre}.enc"
    b = json.loads(decrypt(bp.read_bytes(), key))
    body = BeautifulSoup(z.read(f"OEBPS/{name}.xhtml"), "html.parser").body
    intro, bl = blocks(body)
    b["notesIntro"] = intro or None
    for n in b["nodes"]:
        n["notes"] = None
    lvl2 = [n for n in b["nodes"] if n["level"] == 2]
    other, matched = [], 0
    last2 = None
    for level, title, html, is_open in bl:
        tot["blocks"] += 1
        target = None
        if is_open:
            target = lvl2[0] if lvl2 else None
        elif level == 2:
            pool = lvl2
            target = next((n for n in pool if norm(n["title"]) == norm(title)), None)
            if not target:
                m = difflib.get_close_matches(norm(title), [norm(n["title"]) for n in pool], 1, 0.85)
                target = next((n for n in pool if m and norm(n["title"]) == m[0]), None)
            if not target:
                target = find(title, [n for n in b["nodes"] if n["level"] == 3])
            else:
                last2 = target
        else:
            pool = [n for n in b["nodes"] if n["level"] == 3 and (last2 is None or n["parent"] == last2["id"])]
            target = find(title, pool) or find(title, [n for n in b["nodes"] if n["level"] == 3]) \
                or find(title, lvl2)
        if target is not None and not (html.strip() == ""):
            target["notes"] = (target["notes"] or "") + html
            matched += 1; tot["matched"] += 1
        elif html.strip():
            other.append(f"<h4>{title}</h4>{html}"); tot["other"] += 1
    if other:  # keep everything: unmatched notes ride on the chapter note
        b["notesIntro"] = (b["notesIntro"] or "") + "<div class='box'><p><strong>Other notes for this chapter</strong></p>" + "".join(other) + "</div>"
    bp.write_bytes(encrypt(json.dumps(b, ensure_ascii=False).encode("utf8"), key))
    c["notes"] = sum(1 for n in b["nodes"] if n["notes"]) + (1 if b["notesIntro"] else 0)
    report["chapters"][pre] = {"blocks": len(bl), "matched": matched, "unmatched": len(other),
                               "nodes_with_notes": c["notes"], "nodes": len(b["nodes"])}

extra = []
for f, title in [("title.xhtml", "How to read these notes"), ("arch.xhtml", "The architecture of the book"),
                 ("notsum.xhtml", "Not summarised"), ("architecture.xhtml", "The architecture of the book")] + [(f"u_part{i}.xhtml", f"Part {i} notes") for i in range(1, 5)] + [(f"part{i}.xhtml", f"Part {i} notes") for i in range(1, 5)] + [(f"u_p{i:02d}.xhtml", f"Part {i} notes") for i in range(1, 5)]:
    if f"OEBPS/{f}" in z.namelist():
        bd = BeautifulSoup(z.read(f"OEBPS/{f}"), "html.parser").body
        t = bd.find("h1").get_text(" ", strip=True) if bd.find("h1") else title
        html = "".join(clean(e) for e in bd.children if getattr(e, "name", None) and e.name not in ("h1",))
        extra.append({"id": f.split(".")[0], "title": f"{title}: {t}" if f.startswith(("u_part", "u_p0", "part")) else t, "html": html})
man["notesExtra"] = extra
man_p.write_bytes(encrypt(json.dumps(man, ensure_ascii=False).encode("utf8"), key))
report["extra"] = [e["title"] for e in extra]; report["totals"] = tot
if a.report: Path(a.report).write_text(json.dumps(report, indent=1))
print(json.dumps(tot), "extra pages:", len(extra))
for k, v in report["chapters"].items(): print(k, v)
