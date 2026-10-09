#!/usr/bin/env python3
"""Tests for the bank-building tools (no browser needed).

    python3 tests/test_tools.py

Splits banks/how-to-read-a-book.json into part files, plans and merges
them again, and checks the result equals the original. Also checks that
the merge refuses bad parts.
"""

import json
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TOOLS = ROOT / "tools"
SAMPLE = ROOT / "banks" / "how-to-read-a-book.json"
failures = []


def check(name, condition):
    """Print PASS or FAIL for one check and remember failures."""
    print(f"  {'PASS' if condition else 'FAIL'}  {name}")
    if not condition:
        failures.append(name)


def run(*arguments, cwd):
    """Run a tool and return the finished process."""
    return subprocess.run([sys.executable, *map(str, arguments)],
                          cwd=cwd, capture_output=True, text=True)


def write_chapters_file(bank, folder):
    """A chapters.json for the sample bank, one chapter per unit."""
    units = []
    for unit in bank["unitSummaries"]:
        concepts = [c for c in bank["concepts"] if c["unit"] == unit]
        units.append({
            "unit": unit, "unitTitle": concepts[0]["unitTitle"],
            "unitSummary": bank["unitSummaries"][unit],
            "pages": 20.0, "idPrefix": "",
            "htrab": [], "sections": []})
    path = folder / "chapters.json"
    path.write_text(json.dumps({
        "id": bank["id"], "book": bank["book"], "summary": bank["summary"],
        "labels": bank["labels"], "chapters": units}))
    return path


def write_parts(bank, folder):
    """Split the bank into the part files named by the plan."""
    plan = json.loads((folder / "concept-plan.json").read_text())
    (folder / "parts").mkdir(exist_ok=True)
    for unit in plan["chapters"]:
        part = {
            "concepts": [c for c in bank["concepts"]
                         if c["unit"] == unit["unit"]],
            "questions": [q for q in bank["questions"]
                          if q["unit"] == unit["unit"]]}
        (folder / unit["file"]).write_text(json.dumps(part))
    return plan


def test_round_trip():
    """Plan, split and merge give back the original bank."""
    bank = json.loads(SAMPLE.read_text())
    with tempfile.TemporaryDirectory() as name:
        folder = Path(name)
        chapters = write_chapters_file(bank, folder)
        planned = run(TOOLS / "plan_concept_bank.py", chapters, cwd=folder)
        check("planner runs", planned.returncode == 0)
        plan = write_parts(bank, folder)
        check("planner defaults to 8 questions per page",
              plan["questionsPerPage"] == 8)
        merged = run(TOOLS / "merge_concept_bank.py",
                     folder / "concept-plan.json",
                     "--output", folder / "out.json", cwd=folder)
        check("merge succeeds on the sample bank", merged.returncode == 0)
        out = json.loads((folder / "out.json").read_text())
        check("merged questions equal the original",
              out["questions"] == bank["questions"])
        check("merged concepts equal the original",
              out["concepts"] == bank["concepts"])
        check("unit summaries survive",
              out["unitSummaries"] == bank["unitSummaries"])
        check("report is written",
              (folder / "concept-bank-report.md").exists())
        only = run(TOOLS / "merge_concept_bank.py",
                   folder / "concept-plan.json", "--only",
                   plan["chapters"][0]["idPrefix"], cwd=folder)
        check("--only checks one chapter", only.returncode == 0)


def test_refusals():
    """The merge stops on a bad tag and on a duplicate id."""
    bank = json.loads(SAMPLE.read_text())
    with tempfile.TemporaryDirectory() as name:
        folder = Path(name)
        chapters = write_chapters_file(bank, folder)
        run(TOOLS / "plan_concept_bank.py", chapters, cwd=folder)
        plan = write_parts(bank, folder)
        path = folder / plan["chapters"][0]["file"]
        part = json.loads(path.read_text())
        part["concepts"][0]["htrab"] = "analytical/nope/nothing"
        path.write_text(json.dumps(part))
        result = run(TOOLS / "merge_concept_bank.py",
                     folder / "concept-plan.json",
                     "--output", folder / "out.json", cwd=folder)
        check("unknown tag stops the merge", result.returncode != 0)
        check("no questions.json written on error",
              not (folder / "out.json").exists())
        part["concepts"][0]["htrab"] = bank["concepts"][0]["htrab"]
        part["concepts"][1]["id"] = part["concepts"][0]["id"]
        path.write_text(json.dumps(part))
        result = run(TOOLS / "merge_concept_bank.py",
                     folder / "concept-plan.json", cwd=folder)
        check("duplicate concept id stops the merge",
              result.returncode != 0)


def test_tag_lister():
    """The tag lister prints full tags."""
    result = run(TOOLS / "list_htrab_tags.py", "--level", "inspectional",
                 cwd=ROOT)
    check("tag lister prints inspectional tags",
          result.returncode == 0 and "inspectional/" in result.stdout)


if __name__ == "__main__":
    print("Bank tools")
    test_round_trip()
    test_refusals()
    test_tag_lister()
    if failures:
        raise SystemExit(f"{len(failures)} check(s) failed")
    print("All checks passed.")
