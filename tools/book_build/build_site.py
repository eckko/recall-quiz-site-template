#!/usr/bin/env python3
"""Build the encrypted data of one book (data/ and media/ only).

usage: build_site.py REPO WORK SITE KEYFILE EPUB_DIR
REPO      the private book repo (questions.json, book-structure/)
WORK      output of extract_epub.py
SITE      output folder (only encrypted files go here; the page is written by build_book.py)
KEYFILE   test key (hex). Created if missing. Never committed anywhere.
Also writes WORK/match-report.json (not published).
"""
import json, math, re, os, re, sys, secrets
from pathlib import Path
from encfmt import encrypt, load_key
from epubnav import read_ncx

repo, work, site, keyfile, epub = map(Path, sys.argv[1:6])
if not keyfile.exists():
    keyfile.write_text(secrets.token_hex(32))
    os.chmod(keyfile, 0o600)
key = load_key(keyfile)
(site / "data" / "ch").mkdir(parents=True, exist_ok=True)
(site / "media").mkdir(parents=True, exist_ok=True)

bank = json.loads((repo / "questions.json").read_text(encoding="utf8"))
chapters = json.loads((repo / "book-structure" / "chapters.json")
                      .read_text(encoding="utf8"))["chapters"]

# ----- parts from the EPUB navigation
import re as _re0
_c0 = epub / "META-INF" / "container.xml"
_m0 = _re0.search(r'full-path="([^"]+)"', _c0.read_text(encoding="utf8")) if _c0.exists() else None
opf_dir = (epub / _m0.group(1)).parent if _m0 else epub
from bs4 import BeautifulSoup
import re as _re
_c = epub / "META-INF" / "container.xml"
_m = _re.search(r'full-path="([^"]+)"', _c.read_text(encoding="utf8")) if _c.exists() else None
opf_path = epub / _m.group(1) if _m else epub / "content.opf"
opf = BeautifulSoup(opf_path.read_text(encoding="utf8"), "xml")
ncx = read_ncx(opf_dir, opf_path.read_text(encoding="utf8"))
nav = re.findall(r"<navPoint[^>]*>.*?<text>(.*?)</text>.*?"
                 r'<content src="([^"#]+)', ncx, re.S)
# the navigation file writes an apostrophe as &#39; and & as &amp;
from html import unescape as _unescape
nav = [(_unescape(t), f) for t, f in nav]
manifest_items = {i["id"]: i["href"] for i in opf.find_all("item")}
spine = [manifest_items[r["idref"]] for r in opf.find_all("itemref")]
pos = {f: i for i, f in enumerate(spine)}
parts = [(t, pos[f]) for t, f in nav if t.lower().startswith("part ")]
chapter_start = {int(m.group(1)): pos[f] for t, f in nav
                 if (m := re.match(r"(?:Chapter\s+|#\s*)?(\d+)\s*[-.:]\s", t, re.I))}


def group_of(unit, start_file=None):
    """The part a unit belongs to. A unit with text is placed by where its
    first file sits in the book (so a Foreword comes before Part I and a
    Conclusion falls under the last part); a numbered chapter is placed by its
    navigation entry, or by its first file when titles carry no numbers; a
    unit without text (the
    whole-book unit) is "The whole book"."""
    if unit == "Appendix":
        return "Appendix"
    number = int(unit.split()[1]) if re.match(r"Chapter \d+$", unit) else 0
    if number in chapter_start:
        here = chapter_start[number]
    elif start_file in pos:
        here = pos[start_file]
    else:
        return "The whole book"
    best = None
    for title, start in parts:
        if start <= here:
            best = title
    return best or "Before Part I"


# ----- index the bank by (unit, section)
ideas_by = {}
for c in bank["concepts"]:
    ideas_by.setdefault((c["unit"], c["section"]), []).append(c)
qs_by = {}
for q in bank["questions"]:
    qs_by.setdefault((q["unit"], q["section"]), []).append(q)

STOP = set("the a an and or of to in on for with that this is are was were be been it its as at by from not but they their them he she his her you your we our can will would should could have has had do does did so than then into more most very what which who how when where why there these those if about just also only one".split())
def txt(h):
    h = re.sub(r"<[^>]+>", " ", h).lower()
    return [w for w in re.findall(r"[a-z]{3,}", h) if w not in STOP]

report = {"units": {}, "unplaced_ideas": 0, "unplaced_questions": 0}
manifest_chapters, group_order = [], []
media_ids = []
for c in chapters:
    unit, prefix = c["unit"], c["idPrefix"]
    # a unit with no extracted text (the whole-book unit) gets one empty node
    whole = not (work / "chapters" / f"{prefix}.json").exists()
    if whole:
        bundle = {"unit": unit, "unitTitle": c["unitTitle"], "idPrefix": prefix,
                  "nodes": [{"id": f"{prefix}-whole", "level": 2,
                             "title": c["sections"][0] if c["sections"]
                             else c["unitTitle"], "parent": None,
                             "html": "", "sectionKey": c["unitTitle"]}],
                  "media": []}
    else:
        bundle = json.loads((work / "chapters" / f"{prefix}.json")
                            .read_text(encoding="utf8"))
    start_file = bundle.pop("startFile", None)
    for n in bundle["nodes"]:
        n.setdefault("sectionKey", n["title"] if n["level"] == 2 else None)
        n["notes"] = None
        n["visuals"] = []
        n["ideas"], n["questions"] = [], []
    # a bank section is a topic, or a subtopic the chapter map lists as a
    # section (extract_epub.py gives those a sectionKey of their own)
    by_title = {n["sectionKey"]: n for n in bundle["nodes"]
                if n["sectionKey"] and n["sectionKey"] != "Opening"}
    ideas, questions = {}, []
    keys = {k for k in set(ideas_by) | set(qs_by) if k[0] == unit}
    matched = unmatched = 0
    placed = {}
    # --- place each idea at the best subtopic (level 3) or the section itself
    kids = {}
    for n in bundle["nodes"]:
        if n["level"] == 3:
            kids.setdefault(n["parent"], []).append(n)
    corpus = [txt(n["title"] + " " + n["html"]) for n in bundle["nodes"]]
    df = {}
    for t in corpus:
        for w in set(t):
            df[w] = df.get(w, 0) + 1
    N = max(1, len(corpus))
    def vec(words):
        v = {}
        for w in words:
            v[w] = v.get(w, 0) + 1
        return {w: c * math.log(1 + N / (1 + df.get(w, 0))) for w, c in v.items()}
    def sim(a, b):
        num = sum(a[w] * b[w] for w in a if w in b)
        den = math.sqrt(sum(x * x for x in a.values())) * math.sqrt(sum(x * x for x in b.values()))
        return num / den if den else 0.0
    qs_of = {}
    for (u, sec), lst in qs_by.items():
        if u == unit:
            for q in lst:
                qs_of.setdefault(q["concept"], []).append(q)
    for (u, sec) in sorted(keys):
        # a unit without text keeps every idea on its single node
        node = bundle["nodes"][0] if whole else by_title.get(sec)
        for idea in ideas_by.get((u, sec), []):
            if node is None and not bundle["nodes"]:
                unmatched += 1
                continue
            card = idea["card"]
            slim = {k: v for k, v in idea.items() if k != "card"}
            slim["card"] = {"blocks": card.get("blocks", []),
                            "rule": card.get("rule"),
                            "limits": card.get("limits")}
            itext = " ".join([idea["title"], idea.get("question", "")] +
                             [b.get("text", "") for b in card.get("blocks", [])])
            iv = vec(txt(itext))
            if node is None:
                # The bank's section name is not a printed heading (some
                # books print none). Keep the idea: put it on the block of
                # this chapter that its text is closest to, else the first.
                scored = sorted(((sim(iv, vec(txt(c["title"] + " " + c["html"]))), c)
                                 for c in bundle["nodes"]), key=lambda x: -x[0])
                first = next((c for c in bundle["nodes"] if c["level"] == 2),
                             bundle["nodes"][0])
                target = scored[0][1] if scored[0][0] >= 0.06 else first
                level = "subtopic" if target["level"] == 3 else "fallback"
            else:
                target, level = node, "section"
                cands = kids.get(node["id"], [])
                if cands:
                    scored = sorted(((sim(iv, vec(txt(c["title"] + " " + c["html"]))), c)
                                     for c in cands), key=lambda x: -x[0])
                    own = sim(iv, vec(txt(node["title"] + " " + node["html"])))
                    if scored[0][0] >= 0.06 and scored[0][0] > own:
                        target, level = scored[0][1], "subtopic"
            ideas[idea["id"]] = slim
            target["ideas"].append(idea["id"])
            placed[level] = placed.get(level, 0) + 1
            matched += 1
            for q in qs_of.get(idea["id"], []):
                q["ideaId"] = idea["id"]
                questions.append(q)
                target["questions"].append(q["id"])
        # questions whose idea is missing from the bank
        known = {i["id"] for i in ideas_by.get((u, sec), [])}
        for q in qs_by.get((u, sec), []):
            if q["concept"] not in known:
                unmatched += 1
    report["unplaced_ideas"] += 0
    report["units"][unit] = {
        "nodes": len(bundle["nodes"]), "ideas": len(ideas),
        "questions": len(questions), "unmatched_items": unmatched,
        "placed": placed, "bank_sections": sorted({s for (u, s) in keys}),
        "sections_without_original_text": [
            n["title"] for n in bundle["nodes"] if n["level"] == 2
            and not n["html"] and n["sectionKey"] != "Opening" and not whole]}
    bundle["ideas"], bundle["questions"] = ideas, questions
    bundle["summary"] = bank.get("unitSummaries", {}).get(unit, "")
    for m in bundle["media"]:
        media_ids.append(m["id"])
        src = work / "media-plain" / f"{prefix}-{m['file']}"
        (site / "media" / (m["id"].replace("/", "_") + ".enc")).write_bytes(
            encrypt(src.read_bytes(), key, compress=False))
    (site / "data" / "ch" / f"{prefix}.enc").write_bytes(encrypt(
        json.dumps(bundle, ensure_ascii=False).encode("utf8"), key))
    group = group_of(unit, start_file)
    if group not in group_order:
        group_order.append(group)
    manifest_chapters.append({
        "prefix": prefix, "unit": unit, "title": c["unitTitle"],
        "group": group, "nodes": len(bundle["nodes"]),
        "sections": sum(1 for n in bundle["nodes"] if n["level"] == 2),
        "ideas": len(ideas), "questions": len(questions),
        "figures": len(bundle["media"]), "visuals": 0})

cover_id = f'{bank["id"]}/front/cover'
cover_meta = opf.find("meta", attrs={"name": "cover"})
cover_href = None
if cover_meta is not None:
    cover_href = manifest_items.get(cover_meta.get("content"))
if cover_href is None:     # EPUB 3 marks the cover image by a property
    cover_href = next((i["href"] for i in opf.find_all("item")
                       if "cover-image" in (i.get("properties") or "")), None)
cover_src = opf_dir / cover_href if cover_href else Path("/nonexistent")
if cover_src.exists():
    (site / "media" / (cover_id.replace("/", "_") + ".enc")).write_bytes(
        encrypt(cover_src.read_bytes(), key, compress=False))
else:
    cover_id = None
manifest = {"format": 1, "book": {"id": bank["id"], "title": bank["book"],
                                   "summary": bank.get("summary", ""),
                                   "cover": cover_id},
            "groups": group_order, "chapters": manifest_chapters}
(site / "data" / "manifest.enc").write_bytes(
    encrypt(json.dumps(manifest, ensure_ascii=False).encode("utf8"), key))
Path(work / "match-report.json").write_text(
    json.dumps(report, indent=1, ensure_ascii=False))
tot = lambda k: sum(c[k] for c in manifest_chapters)
print("chapters", len(manifest_chapters), "ideas", tot("ideas"), "of",
      len(bank["concepts"]), "| questions", tot("questions"), "of",
      len(bank["questions"]), "| figures", tot("figures"))
print("groups:", group_order)
print("placement", {k: sum(u["placed"].get(k,0) for u in report["units"].values()) for k in ("subtopic","section","fallback")})
print("unmatched items:", sum(u["unmatched_items"]
                              for u in report["units"].values()))

print("cover:", cover_id)
