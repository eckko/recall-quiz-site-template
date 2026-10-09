#!/usr/bin/env python3
"""Decide how many questions each chapter gets, and of which types.

    python3 tools/plan_question_bank.py CHAPTERS_FILE [--per-page N]

CHAPTERS_FILE (written after reading the book) looks like this:

    {
      "id": "thinking-fast-and-slow",
      "book": "Thinking, Fast and Slow",
      "labels": {"unit": "Chapter", "units": "chapters"},
      "chapters": [
        {"unit": "Chapter 1", "unitTitle": "The Characters of the Story",
         "pages": 14.0, "weight": 1.1,
         "sections": ["Two Systems", "Plot Synopsis"],
         "typeWeights": {"order": 1.5}}
      ]
    }

- pages: real pages (PDF) or estimated pages (EPUB, words / 300).
- weight: 0.7 (light: stories, recaps) to 1.3 (dense: definitions,
  arguments, models). Default 1.0. Weights move questions between
  chapters; they never change the total.
- typeWeights (optional): favour or avoid a question type in this
  chapter, e.g. {"order": 1.5} for a chapter that is a process,
  {"sort": 0.5} for one with few categories.
- idPrefix (optional): start of every question id in the chapter.
  Default: "c" plus the chapter number ("c01"), or a short name.

Total questions = total pages x questions per page (default 6).

Writes question-plan.json next to CHAPTERS_FILE and prints a table.
"""

import argparse
import json
import re
from pathlib import Path

DEFAULT_QUESTIONS_PER_PAGE = 6
LIGHTEST_WEIGHT = 0.7
HEAVIEST_WEIGHT = 1.3
FEWEST_QUESTIONS_PER_CHAPTER = 8

# Share of each question type before any chapter adjustments.
# Recall and fill-in (retrieval) are the best for memory; multiple
# choice is quick; the rest test structure and relationships.
DEFAULT_TYPE_MIX = {
    "mcq": 0.25,
    "recall": 0.17,
    "fill": 0.15,
    "multi": 0.10,
    "tf": 0.10,
    "order": 0.08,
    "match": 0.08,
    "sort": 0.07,
}


def split_by_largest_remainder(total, shares):
    """Split a whole number in proportion to shares, summing exactly.

    @param total  the whole number to split
    @param shares  {name: share}, any positive numbers
    @returns {name: whole number}
    """
    share_sum = sum(shares.values())
    if total <= 0 or share_sum <= 0:
        return {name: 0 for name in shares}
    exact = {name: total * share / share_sum
             for name, share in shares.items()}
    counts = {name: int(value) for name, value in exact.items()}
    left_over = total - sum(counts.values())
    by_remainder = sorted(exact, key=lambda name: exact[name] - counts[name],
                          reverse=True)
    for name in by_remainder[:left_over]:
        counts[name] += 1
    return counts


def default_id_prefix(unit):
    """"Chapter 9" -> "c09"; "Introduction" -> "intro"."""
    number = re.search(r"\d+", unit)
    if number:
        return "c" + number.group().zfill(2)
    return re.sub(r"[^a-z]", "", unit.lower())[:6] or "u"


def chapter_weight(chapter):
    """The chapter's weight, kept between the lightest and heaviest."""
    weight = float(chapter.get("weight", 1.0))
    return min(HEAVIEST_WEIGHT, max(LIGHTEST_WEIGHT, weight))


def plan_chapter_counts(chapters, total):
    """Questions per chapter: pages x weight, then a minimum each."""
    shares = {index: chapter["pages"] * chapter_weight(chapter)
              for index, chapter in enumerate(chapters)}
    counts = split_by_largest_remainder(total, shares)
    # Short chapters still get enough questions to cover their ideas.
    for index in counts:
        counts[index] = max(counts[index], FEWEST_QUESTIONS_PER_CHAPTER)
    return counts


def plan_type_counts(chapter, question_count):
    """Questions of each type in one chapter."""
    adjustments = chapter.get("typeWeights", {})
    shares = {kind: share * float(adjustments.get(kind, 1.0))
              for kind, share in DEFAULT_TYPE_MIX.items()}
    return split_by_largest_remainder(question_count, shares)


def build_plan(book, questions_per_page):
    """The full plan as a dictionary ready to save."""
    chapters = book["chapters"]
    total_pages = sum(chapter["pages"] for chapter in chapters)
    total = round(total_pages * questions_per_page)
    chapter_counts = plan_chapter_counts(chapters, total)
    planned_chapters = []
    for index, chapter in enumerate(chapters):
        count = chapter_counts[index]
        planned_chapters.append({
            "unit": chapter["unit"],
            "unitTitle": chapter.get("unitTitle", ""),
            "idPrefix": chapter.get("idPrefix")
                or default_id_prefix(chapter["unit"]),
            "pages": chapter["pages"],
            "weight": chapter_weight(chapter),
            "sections": chapter.get("sections", []),
            "questionCount": count,
            "types": plan_type_counts(chapter, count),
            "file": "questions/"
                + (chapter.get("idPrefix")
                   or default_id_prefix(chapter["unit"])) + ".json",
        })
    return {
        "id": book["id"],
        "book": book["book"],
        "labels": book.get("labels", {}),
        "questionsPerPage": questions_per_page,
        "totalPages": round(total_pages, 1),
        "totalQuestions": sum(c["questionCount"] for c in planned_chapters),
        "chapters": planned_chapters,
    }


def print_plan(plan):
    """A readable table of the plan."""
    kinds = list(DEFAULT_TYPE_MIX)
    print(f"{plan['book']}: {plan['totalPages']} pages x "
          f"{plan['questionsPerPage']} = {plan['totalQuestions']} questions")
    print(f"{'unit':<16}{'pages':>6}{'wt':>5}{'total':>7}  "
          + " ".join(f"{kind:>6}" for kind in kinds))
    for chapter in plan["chapters"]:
        print(f"{chapter['unit'][:15]:<16}{chapter['pages']:>6}"
              f"{chapter['weight']:>5}{chapter['questionCount']:>7}  "
              + " ".join(f"{chapter['types'][kind]:>6}" for kind in kinds))


def main():
    """Read the chapters file, plan, save and print."""
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("chapters_file", type=Path)
    parser.add_argument("--per-page", type=float,
                        default=DEFAULT_QUESTIONS_PER_PAGE)
    arguments = parser.parse_args()
    book = json.loads(arguments.chapters_file.read_text())
    plan = build_plan(book, arguments.per_page)
    prefixes = [chapter["idPrefix"] for chapter in plan["chapters"]]
    if len(prefixes) != len(set(prefixes)):
        raise SystemExit("Two chapters share an idPrefix; set them by hand.")
    output = arguments.chapters_file.parent / "question-plan.json"
    output.write_text(json.dumps(plan, indent=1, ensure_ascii=False))
    print_plan(plan)
    print(f"\nSaved {output}")


if __name__ == "__main__":
    main()
