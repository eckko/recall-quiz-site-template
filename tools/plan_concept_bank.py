#!/usr/bin/env python3
"""Plan a concept bank: how many ideas and questions per chapter.

    python3 tools/plan_concept_bank.py CHAPTERS_FILE [--per-page N]

CHAPTERS_FILE (written after reading the book) looks like this:

    {
      "id": "how-to-read-a-book",
      "book": "How to Read a Book",
      "summary": "One sentence (40 words or fewer) on the whole book.",
      "labels": {"unit": "Part", "units": "parts"},
      "chapters": [
        {"unit": "Part A", "unitTitle": "Inspectional reading",
         "unitSummary": "One sentence, 30 words or fewer.",
         "pages": 30.0, "weight": 1.2,
         "sections": ["Systematic skimming"],
         "htrab": ["inspectional/the-second-level-of-reading-inspectional"
                   "-reading"],
         "idPrefix": "a"}
      ]
    }

- pages: real pages (PDF) or estimated pages (EPUB, words / 300).
- weight: 0.7 (light) to 1.3 (dense). Moves questions between chapters;
  never changes the total.
- htrab: tag prefixes ("level", "level/topic" or "level/topic/subtopic")
  the chapter's ideas should cover. The concept writer is told to cover
  every testable subtopic under them.
- idPrefix (optional): start of every concept and question id in the
  chapter ("a-skimming"). Default: a short name from the unit. "" turns
  the prefix check off (used only to re-merge an older bank).

Total questions = total pages x questions per page (default 8). One idea
takes 5 to 7 questions (a pretest and a ladder of 4 to 6), so an idea
count is planned too.

Writes concept-plan.json next to CHAPTERS_FILE and prints a table.
"""

import argparse
import json
import re
from pathlib import Path

DEFAULT_QUESTIONS_PER_PAGE = 8
LIGHTEST_WEIGHT = 0.7
HEAVIEST_WEIGHT = 1.3
FEWEST_QUESTIONS_PER_UNIT = 10
QUESTIONS_PER_IDEA = 6


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
    """"Part A" -> "a"; "Chapter 9" -> "c09"; "Whole book" -> "wholeb"."""
    number = re.search(r"\d+", unit)
    if number:
        return "c" + number.group().zfill(2)
    last_word = unit.split()[-1].lower()
    if len(last_word) == 1:
        return last_word
    return re.sub(r"[^a-z]", "", unit.lower())[:6] or "u"


def unit_weight(chapter):
    """The chapter's weight, kept between the lightest and heaviest."""
    weight = float(chapter.get("weight", 1.0))
    return min(HEAVIEST_WEIGHT, max(LIGHTEST_WEIGHT, weight))


def build_plan(book, questions_per_page):
    """The full plan as a dictionary ready to save.

    @param book  the parsed chapters file
    @param questions_per_page  how dense the bank should be
    @returns dict
    """
    units = book["chapters"]
    total_pages = sum(unit["pages"] for unit in units)
    total = round(total_pages * questions_per_page)
    shares = {index: unit["pages"] * unit_weight(unit)
              for index, unit in enumerate(units)}
    counts = split_by_largest_remainder(total, shares)
    planned = []
    for index, unit in enumerate(units):
        count = max(counts[index], FEWEST_QUESTIONS_PER_UNIT)
        prefix = unit.get("idPrefix", default_id_prefix(unit["unit"]))
        planned.append({
            "unit": unit["unit"],
            "unitTitle": unit.get("unitTitle", ""),
            "unitSummary": unit.get("unitSummary", ""),
            "idPrefix": prefix,
            "pages": unit["pages"],
            "weight": unit_weight(unit),
            "sections": unit.get("sections", []),
            "htrab": unit.get("htrab", []),
            "questionCount": count,
            "ideaCount": max(2, round(count / QUESTIONS_PER_IDEA)),
            "file": f"parts/{prefix or 'u' + str(index + 1)}.json",
        })
    return {
        "id": book["id"],
        "book": book["book"],
        "summary": book.get("summary", ""),
        "labels": book.get("labels", {}),
        "questionsPerPage": questions_per_page,
        "totalPages": round(total_pages, 1),
        "totalQuestions": sum(unit["questionCount"] for unit in planned),
        "chapters": planned,
    }


def print_plan(plan):
    """A readable table of the plan."""
    print(f"{plan['book']}: {plan['totalPages']} pages x "
          f"{plan['questionsPerPage']} = {plan['totalQuestions']} questions")
    print(f"{'unit':<18}{'prefix':<8}{'pages':>6}{'wt':>5}"
          f"{'ideas':>7}{'questions':>11}")
    for unit in plan["chapters"]:
        print(f"{unit['unit'][:17]:<18}{unit['idPrefix']:<8}"
              f"{unit['pages']:>6}{unit['weight']:>5}"
              f"{unit['ideaCount']:>7}{unit['questionCount']:>11}")


def main():
    """Read the chapters file, plan, save and print."""
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("chapters_file", type=Path)
    parser.add_argument("--per-page", type=float,
                        default=DEFAULT_QUESTIONS_PER_PAGE)
    arguments = parser.parse_args()
    book = json.loads(arguments.chapters_file.read_text())
    plan = build_plan(book, arguments.per_page)
    prefixes = [unit["idPrefix"] for unit in plan["chapters"]
                if unit["idPrefix"]]
    if len(prefixes) != len(set(prefixes)):
        raise SystemExit("Two chapters share an idPrefix; set them by hand.")
    output = arguments.chapters_file.parent / "concept-plan.json"
    output.write_text(json.dumps(plan, indent=1, ensure_ascii=False))
    print_plan(plan)
    print(f"\nSaved {output}")


if __name__ == "__main__":
    main()
