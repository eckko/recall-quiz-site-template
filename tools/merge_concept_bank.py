#!/usr/bin/env python3
"""Check every chapter's ideas and questions and merge questions.json.

    python3 tools/merge_concept_bank.py PLAN_FILE [--output questions.json]
        [--book-text BOOK_TEXT]

    python3 tools/merge_concept_bank.py PLAN_FILE --only a

--only checks one chapter (by its idPrefix) and writes nothing; chapter
writers run it before handing their file back.

PLAN_FILE is concept-plan.json from plan_concept_bank.py. Each chapter's
part file (the "file" named in the plan, relative to the plan's folder)
is a JSON object:

    {"concepts": [ ...concepts... ], "questions": [ ...questions... ]}

Errors (the merge stops): a question the quiz cannot show or mark
correctly, an id used twice or without the chapter's prefix, a concept
without a valid HTRAB tag, a question whose concept is not in the same
part file, and anything tools/validate_bank.py reports as an error.

Warnings (read them): a chapter far from its planned size, testable
HTRAB subtopics under the chapter's "htrab" prefixes that no idea
covers, and quotes that are not word-for-word in the book (only with
--book-text).

Writes questions.json and concept-bank-report.md (next to the plan).
"""

import argparse
import json
import subprocess
import sys
from collections import Counter
from pathlib import Path

TOOLS = Path(__file__).resolve().parent
sys.path.insert(0, str(TOOLS))
from list_htrab_tags import all_tags, load_tags  # noqa: E402
from merge_question_bank import (  # noqa: E402
    question_problems, quotes_in, normalise)

SIZE_TOLERANCE = 0.25
SHORTEST_QUOTE_IN_WORDS = 4
errors = []
warnings = []


def load_part(plan_folder, unit):
    """Read one chapter's part file; return (concepts, questions)."""
    path = plan_folder / unit["file"]
    if not path.exists():
        errors.append(f"{unit['unit']}: {unit['file']} is missing")
        return [], []
    try:
        part = json.loads(path.read_text())
    except json.JSONDecodeError as problem:
        errors.append(f"{unit['file']}: not valid JSON ({problem})")
        return [], []
    if not isinstance(part, dict):
        errors.append(f"{unit['file']}: must be an object with "
                      "'concepts' and 'questions'")
        return [], []
    return part.get("concepts", []), part.get("questions", [])


def check_ids(unit, concepts, questions, seen):
    """Prefix, uniqueness, unit and concept links for one chapter."""
    prefix = unit["idPrefix"] + "-" if unit["idPrefix"] else ""
    own_concepts = {c.get("id") for c in concepts if isinstance(c, dict)}
    for kind, items in (("concept", concepts), ("question", questions)):
        for item in items:
            if not isinstance(item, dict):
                errors.append(f"{unit['file']}: a {kind} is not an object")
                continue
            label = f"{kind} {item.get('id')}"
            if not isinstance(item.get("id"), str):
                errors.append(f"{unit['file']}: a {kind} has no id")
            elif not item["id"].startswith(prefix):
                errors.append(f"{label}: id should start with {prefix!r}")
            elif (kind, item["id"]) in seen:
                errors.append(f"{label}: id used twice")
            else:
                seen.add((kind, item["id"]))
            if item.get("unit") != unit["unit"]:
                errors.append(f"{label}: unit should be {unit['unit']!r}")
    for question in questions:
        if isinstance(question, dict) and \
                question.get("concept") not in own_concepts:
            errors.append(f"question {question.get('id')}: concept "
                          f"{question.get('concept')!r} is not in "
                          f"{unit['file']}")


def check_questions(questions):
    """Per-question checks shared with the plain recall banks."""
    for question in questions:
        if isinstance(question, dict):
            for problem in question_problems(question):
                errors.append(f"question {question.get('id')}: {problem}")


def check_concept_tags(concepts, known):
    """Every concept needs a real HTRAB tag (questions inherit it)."""
    for concept in concepts:
        tag = concept.get("htrab") if isinstance(concept, dict) else None
        if not tag:
            errors.append(f"concept {concept.get('id')}: missing htrab tag")
        elif tag not in known:
            errors.append(f"concept {concept.get('id')}: htrab tag "
                          f"{tag!r} is not in htrab/tags.json")


def check_size(unit, concepts, questions):
    """Warn if a chapter is far from the planned size."""
    planned = unit["questionCount"]
    if abs(len(questions) - planned) > planned * SIZE_TOLERANCE:
        warnings.append(f"{unit['unit']}: {len(questions)} questions, "
                        f"plan says {planned}")
    if len(concepts) < 2:
        warnings.append(f"{unit['unit']}: only {len(concepts)} idea(s)")


def uncovered_subtopics(unit, concepts, tree):
    """Testable subtopics under the chapter's prefixes no idea covers."""
    wanted = unit.get("htrab", [])
    used = {c.get("htrab") for c in concepts if isinstance(c, dict)}
    missing = []
    for tag, title, testable, _chapter in all_tags(tree):
        under = any(tag == p or tag.startswith(p + "/") for p in wanted)
        if under and testable and tag not in used:
            missing.append((tag, title))
    return missing


def check_quotes(questions, book_text):
    """Warn about quoted phrases that are not word-for-word in the book."""
    body = normalise(book_text)
    for question in questions:
        for text in [question.get("q", ""), question.get("explain", "")]:
            for groups in quotes_in(text):
                quote = next(part for part in groups if part)
                if len(quote.split()) < SHORTEST_QUOTE_IN_WORDS:
                    continue
                if normalise(quote) not in body:
                    warnings.append(f"question {question.get('id')}: "
                                    f"quote not in book: {quote[:50]!r}")


def assemble(plan, parts):
    """The merged bank dictionary, in plan order."""
    bank = {"id": plan["id"], "book": plan["book"]}
    if plan.get("summary"):
        bank["summary"] = plan["summary"]
    if plan.get("labels"):
        bank["labels"] = plan["labels"]
    bank["unitSummaries"] = {
        unit["unit"]: unit["unitSummary"] for unit in plan["chapters"]
        if unit.get("unitSummary") and parts[unit["unit"]][0]}
    bank["concepts"] = [c for unit in plan["chapters"]
                        for c in parts[unit["unit"]][0]]
    bank["questions"] = [q for unit in plan["chapters"]
                         for q in parts[unit["unit"]][1]]
    return bank


def keep_known_requires(bank):
    """For --only: forget requires that point at other chapters."""
    own = {c.get("id") for c in bank["concepts"]}
    for concept in bank["concepts"]:
        concept["requires"] = [r for r in concept.get("requires", [])
                               if r in own]


def run_validator(bank, folder):
    """Write the bank to a scratch file and run validate_bank.py."""
    scratch = folder / ".bank-check.json"
    scratch.write_text(json.dumps(bank, ensure_ascii=False))
    try:
        result = subprocess.run(
            [sys.executable, str(TOOLS / "validate_bank.py"), str(scratch)],
            capture_output=True, text=True)
    finally:
        scratch.unlink()
    return result.returncode, result.stdout


def build_report(plan, parts, missing_by_unit, validator_output):
    """The report as text."""
    lines = [f"# Concept bank report: {plan['book']}", ""]
    lines.append("| unit | ideas | questions | planned |")
    lines.append("|---|---|---|---|")
    for unit in plan["chapters"]:
        concepts, questions = parts[unit["unit"]]
        lines.append(f"| {unit['unit']} | {len(concepts)} | "
                     f"{len(questions)} | {unit['questionCount']} |")
    levels = Counter()
    for unit in plan["chapters"]:
        for concept in parts[unit["unit"]][0]:
            levels[str(concept.get("htrab", "?")).split("/")[0]] += 1
    lines += ["", "Ideas per HTRAB level: " + ", ".join(
        f"{name} {count}" for name, count in sorted(levels.items())), ""]
    for unit_name, missing in missing_by_unit.items():
        if missing:
            lines.append(f"Subtopics with no idea in {unit_name}:")
            lines += [f"- {tag} ({title})" for tag, title in missing]
            lines.append("")
    lines += ["Warnings:"] + [f"- {text}" for text in warnings]
    lines += ["", "Errors:"] + [f"- {text}" for text in errors]
    lines += ["", "validate_bank.py:", "```", validator_output.strip(), "```"]
    return "\n".join(lines) + "\n"


def main():
    """Check, merge, write the report, and exit 1 on errors."""
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("plan_file", type=Path)
    parser.add_argument("--output", type=Path, default=Path("questions.json"))
    parser.add_argument("--book-text", type=Path)
    parser.add_argument("--only", metavar="ID_PREFIX")
    arguments = parser.parse_args()
    plan = json.loads(arguments.plan_file.read_text())
    folder = arguments.plan_file.parent
    if arguments.only:
        plan["chapters"] = [u for u in plan["chapters"]
                            if u["idPrefix"] == arguments.only]
        if not plan["chapters"]:
            raise SystemExit(f"No chapter has idPrefix {arguments.only!r}")
    tree = load_tags()
    known = {tag for tag, *_ in all_tags(tree)}
    seen, parts, missing_by_unit = set(), {}, {}
    for unit in plan["chapters"]:
        concepts, questions = load_part(folder, unit)
        parts[unit["unit"]] = (concepts, questions)
        check_ids(unit, concepts, questions, seen)
        check_questions(questions)
        check_concept_tags(concepts, known)
        check_size(unit, concepts, questions)
        missing_by_unit[unit["unit"]] = uncovered_subtopics(
            unit, concepts, tree)
    bank = assemble(plan, parts)
    if arguments.book_text:
        check_quotes(bank["questions"], arguments.book_text.read_text())
    if arguments.only:
        keep_known_requires(bank)
        bank.setdefault("summary", "Part check.")
    code, output = run_validator(bank, folder) if bank["questions"] \
        else (1, "no questions")
    if code:
        errors.append("validate_bank.py found errors (see below)")
    report = build_report(plan, parts, missing_by_unit, output)
    if arguments.only:
        print(report)
        raise SystemExit(1 if errors else 0)
    (folder / "concept-bank-report.md").write_text(report)
    print(report)
    if errors:
        raise SystemExit(f"{len(errors)} error(s): questions.json "
                         "was not written.")
    arguments.output.write_text(
        json.dumps(bank, indent=1, ensure_ascii=False) + "\n")
    print(f"Wrote {len(bank['questions'])} questions and "
          f"{len(bank['concepts'])} ideas to {arguments.output}")


if __name__ == "__main__":
    main()
