#!/usr/bin/env python3
"""Run last (after build_site / add_media / add_notes). Writes, per chapter,
an outline (topics with sub-topic titles and counts) into the encrypted manifest so the
home page and the contents drawer need no chapter downloads.
  finalize_manifest.py --site SITE --key KEY"""
import argparse, json, re, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from encfmt import encrypt, decrypt, load_key
ap = argparse.ArgumentParser(); ap.add_argument("--site", required=True); ap.add_argument("--key", required=True)
a = ap.parse_args(); site, key = Path(a.site), load_key(a.key)
mp = site / "data" / "manifest.enc"; man = json.loads(decrypt(mp.read_bytes(), key))
def own(n):
    return {"ideas": len(n["ideas"]), "questions": len(n["questions"]),
            "figures": len(re.findall(r'data-media="', n["html"] or "")),
            "visuals": len(n.get("visuals", [])), "notes": 1 if n.get("notes") else 0}
for c in man["chapters"]:
    b = json.loads(decrypt((site / "data" / "ch" / f"{c['prefix']}.enc").read_bytes(), key))
    topics, cur = [], None
    for n in b["nodes"]:
        o = own(n)
        if n["level"] == 2:
            cur = {"id": n["id"], "title": n["title"], "subs": [], **o}; topics.append(cur)
        elif cur is not None:
            cur["subs"].append({"id": n["id"], "title": n["title"], **o})
            for k in ("ideas", "questions", "figures", "visuals", "notes"): cur[k] += o[k]
    for t in topics: t["subCount"] = len(t["subs"])
    c["outline"] = topics; c["hasIntroNotes"] = bool(b.get("notesIntro"))
mp.write_bytes(encrypt(json.dumps(man, ensure_ascii=False).encode("utf8"), key))
print("outline written for", len(man["chapters"]), "chapters")
