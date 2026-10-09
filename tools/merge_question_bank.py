#!/usr/bin/env python3
"""Check every chapter's questions and merge them into questions.json.

    python3 tools/merge_question_bank.py PLAN_FILE \\
        [--book-text BOOK_TEXT] [--output questions.json]

    python3 tools/merge_question_bank.py PLAN_FILE --only c09 \\
        [--book-text BOOK_TEXT]

--only checks one chapter (by its idPrefix) and writes nothing; chapter
writers use it before handing their file back.

PLAN_FILE is question-plan.json from plan_question_bank.py. Each
chapter's questions are read from the "file" named in the plan
(relative to the plan's folder): a JSON list of questions.

Errors (the merge stops): a question the quiz cannot show or mark
correctly, such as a missing field, an answer index out of range, a
duplicate id, or a sort question without exactly two groups.

Warnings (the merge goes on, but read them): a chapter or question
type far from the plan, a missing explanation, near-duplicate
questions, right answers bunched in one position, and quotes that are
not word-for-word in the book (only with --book-text).

Writes the merged questions.json and question-bank-report.md (next to
the plan), and prints the report.
"""

import argparse
import json
import re
import unicodedata
from collections import Counter
from pathlib import Path

KINDS = ("mcq", "tf", "multi", "fill", "order", "match", "sort", "recall")
CHAPTER_COUNT_TOLERANCE = 0.10
TYPE_COUNT_TOLERANCE = 0.25
NEAR_DUPLICATE_SIMILARITY = 0.8
MOST_ANSWERS_IN_ONE_POSITION = 0.40
SHORTEST_QUOTE_IN_WORDS = 4

errors = []
warnings = []


# ------------------------------------------------------------- one question


def question_problems(question):
    """Return a list of reasons this question cannot be used."""
    problems = []
    for field in ("id", "unit", "section", "kind", "q"):
        if not isinstance(question.get(field), str) or not question[field]:
            problems.append(f"missing {field}")
    kind = question.get("kind")
    if kind not in KINDS:
        return problems + [f"unknown kind {kind!r}"]
    check_kind = KIND_CHECKS[kind]
    problems.extend(check_kind(question))
    for text in all_texts(question):
        if re.search(r"<[a-z/][^>]*>", text, re.I):
            problems.append("contains HTML (shown literally)")
            break
    return problems


def unique_strings(values, smallest, largest, what):
    """Problems with a list that must hold unique, non-empty strings."""
    if not isinstance(values, list):
        return [f"{what} must be a list"]
    problems = []
    if not smallest <= len(values) <= largest:
        problems.append(f"{what}: needs {smallest} to {largest}, "
                        f"has {len(values)}")
    if any(not isinstance(value, str) or not value.strip()
           for value in values):
        problems.append(f"{what}: empty or not text")
    elif len(set(values)) != len(values):
        problems.append(f"{what}: repeated entries")
    return problems


def check_multiple_choice(question):
    """mcq: 3 to 5 options and one right index."""
    options = question.get("options")
    problems = unique_strings(options, 3, 5, "options")
    answer = question.get("answer")
    if not isinstance(answer, int) or isinstance(answer, bool) or \
            not isinstance(options, list) or \
            not 0 <= answer < len(options):
        problems.append("answer is not an index into options")
    return problems


def check_true_false(question):
    """tf: answer is true or false."""
    if not isinstance(question.get("answer"), bool):
        return ["answer must be true or false"]
    return []


def check_select_all(question):
    """multi: 4 to 6 options, at least one right and one wrong."""
    options = question.get("options")
    problems = unique_strings(options, 4, 6, "options")
    answers = question.get("answers")
    if not isinstance(answers, list) or not answers or \
            not isinstance(options, list):
        return problems + ["answers must be a non-empty list"]
    if any(not isinstance(index, int) or not 0 <= index < len(options)
           for index in answers) or len(set(answers)) != len(answers):
        problems.append("answers must be distinct indexes into options")
    if len(set(answers)) >= len(options):
        problems.append("every option is right; add a wrong one")
    return problems


def check_fill_in(question):
    """fill: a ____ blank in the question and accepted answers."""
    problems = []
    if "____" not in question.get("q", ""):
        problems.append("question has no ____ blank")
    accept = question.get("accept")
    if not isinstance(accept, list) or not accept or \
            any(not isinstance(word, str) or not word.strip()
                for word in accept):
        problems.append("accept must list the accepted answers")
    return problems


def check_put_in_order(question):
    """order: 3 to 7 unique items, in the right order."""
    return unique_strings(question.get("items"), 3, 7, "items")


def check_match_pairs(question):
    """match: 3 to 6 pairs, unique on both sides."""
    pairs = question.get("pairs")
    if not isinstance(pairs, list) or \
            any(not isinstance(pair, list) or len(pair) != 2
                for pair in pairs):
        return ["pairs must be a list of [left, right]"]
    return (unique_strings([pair[0] for pair in pairs], 3, 6, "left side")
            + unique_strings([pair[1] for pair in pairs], 3, 6,
                             "right side"))


def check_sort_into_groups(question):
    """sort: exactly two groups, 4 to 8 items, both groups used."""
    problems = unique_strings(question.get("groups"), 2, 2, "groups")
    items = question.get("items")
    if not isinstance(items, list) or \
            any(not isinstance(item, dict) for item in items):
        return problems + ["items must be a list of {t, g}"]
    problems += unique_strings([item.get("t") for item in items], 4, 8,
                               "items")
    groups_used = {item.get("g") for item in items}
    if not groups_used <= {0, 1}:
        problems.append("each item's g must be 0 or 1")
    elif groups_used != {0, 1}:
        problems.append("both groups need at least one item")
    return problems


def check_recall(question):
    """recall: a model answer."""
    if not isinstance(question.get("a"), str) or not question["a"].strip():
        return ["recall needs a model answer in a"]
    return []


KIND_CHECKS = {
    "mcq": check_multiple_choice,
    "tf": check_true_false,
    "multi": check_select_all,
    "fill": check_fill_in,
    "order": check_put_in_order,
    "match": check_match_pairs,
    "sort": check_sort_into_groups,
    "recall": check_recall,
}


def all_texts(question):
    """Every piece of text a reader sees in this question."""
    texts = [question.get("q", ""), question.get("explain", ""),
             question.get("a", "")]
    for field in ("options", "items", "groups", "accept"):
        for value in question.get(field) or []:
            texts.append(value["t"] if isinstance(value, dict) else value)
    for pair in question.get("pairs") or []:
        texts.extend(pair)
    return [text for text in texts if isinstance(text, str)]


# ------------------------------------------------------------- one chapter


def words_of(text):
    """Lower-case words, for comparing questions."""
    return set(re.findall(r"[a-z0-9']+", text.lower()))


def similarity(first, second):
    """Share of words two texts have in common (0 to 1)."""
    if not first or not second:
        return 0.0
    return len(first & second) / len(first | second)


def warn_about_near_duplicates(chapter, questions):
    """Warn when two questions in a chapter ask nearly the same thing."""
    word_sets = [(question["id"], words_of(question["q"]))
                 for question in questions]
    for index, (first_id, first_words) in enumerate(word_sets):
        for second_id, second_words in word_sets[index + 1:]:
            if similarity(first_words, second_words) >= \
                    NEAR_DUPLICATE_SIMILARITY:
                warnings.append(f"{chapter['unit']}: {first_id} and "
                                f"{second_id} ask nearly the same thing")


def warn_about_answer_positions(chapter, questions):
    """Warn when right answers bunch in one position, or tf leans."""
    positions = Counter(question["answer"] for question in questions
                        if question["kind"] == "mcq")
    mcq_count = sum(positions.values())
    if mcq_count >= 8:
        position, count = positions.most_common(1)[0]
        if count / mcq_count > MOST_ANSWERS_IN_ONE_POSITION:
            warnings.append(f"{chapter['unit']}: {count} of {mcq_count} "
                            f"multiple-choice answers are option "
                            f"{position + 1}; vary the position")
    true_false = [question["answer"] for question in questions
                  if question["kind"] == "tf"]
    if len(true_false) >= 6:
        true_share = sum(true_false) / len(true_false)
        if not 0.3 <= true_share <= 0.7:
            warnings.append(f"{chapter['unit']}: {sum(true_false)} of "
                            f"{len(true_false)} true/false answers are "
                            f"true; balance them")


def warn_about_plan_differences(chapter, questions):
    """Warn when a chapter's counts are far from the plan."""
    planned = chapter["questionCount"]
    actual = len(questions)
    if abs(actual - planned) > max(2, planned * CHAPTER_COUNT_TOLERANCE):
        warnings.append(f"{chapter['unit']}: {actual} questions, "
                        f"plan was {planned}")
    kinds = Counter(question["kind"] for question in questions)
    for kind, planned_count in chapter["types"].items():
        if abs(kinds[kind] - planned_count) > \
                max(2, planned_count * TYPE_COUNT_TOLERANCE):
            warnings.append(f"{chapter['unit']}: {kinds[kind]} {kind}, "
                            f"plan was {planned_count}")


def check_chapter(chapter, questions, seen_ids):
    """Check one chapter's questions; return the usable ones."""
    usable = []
    prefix = chapter["idPrefix"] + "-"
    for position, question in enumerate(questions, start=1):
        if not isinstance(question, dict):
            errors.append(f"{chapter['file']} #{position}: not an object")
            continue
        label = question.get("id") or f"{chapter['file']} #{position}"
        problems = question_problems(question)
        if question.get("unit") != chapter["unit"]:
            problems.append(f"unit should be {chapter['unit']!r}")
        if isinstance(question.get("id"), str) and \
                not question["id"].startswith(prefix):
            problems.append(f"id should start with {prefix!r}")
        if question.get("id") in seen_ids:
            problems.append("duplicate id")
        if problems:
            errors.append(f"{label}: " + "; ".join(problems))
            continue
        seen_ids.add(question["id"])
        if question["kind"] != "recall" and not question.get("explain"):
            warnings.append(f"{label}: no explanation")
        if re.search(r"\b(first|second|third|fourth|last|option [a-d1-6])"
                     r"\b(?= option|\b)", question.get("explain", ""),
                     re.I) and "option" in question.get("explain", ""):
            warnings.append(f"{label}: explanation points at an option "
                            "by position; name its idea instead")
        usable.append(question)
    warn_about_near_duplicates(chapter, usable)
    warn_about_answer_positions(chapter, usable)
    warn_about_plan_differences(chapter, usable)
    return usable


# ------------------------------------------------------------- quotes


def normalise(text):
    """Lower case, straight quotes, single spaces, no punctuation."""
    text = unicodedata.normalize("NFKC", text).lower()
    text = re.sub(r"[‘’“”\"'`]", "", text)
    text = re.sub(r"[^\w\s]", " ", text)
    return " ".join(text.split())


def quotes_in(text):
    """Text inside curly or straight double quotes."""
    return re.findall(r"“([^”]+)”|\"([^\"]+)\"", text)


def warn_about_inexact_quotes(questions, book_text):
    """Warn about quoted phrases that are not word-for-word in the book.

    Quotes may skip words with an ellipsis; each piece is checked.
    """
    book = normalise(book_text)
    inexact = 0
    for question in questions:
        for text in (question.get("explain", ""), question.get("a", ""),
                     question.get("q", "")):
            for curly, straight in quotes_in(text):
                quote = curly or straight
                for piece in re.split(r"…|\.\.\.|\[[^\]]*\]", quote):
                    piece = normalise(piece)
                    if len(piece.split()) >= SHORTEST_QUOTE_IN_WORDS and \
                            piece not in book:
                        inexact += 1
                        warnings.append(f"{question['id']}: quote not "
                                        f"found in the book: "
                                        f"“{piece[:70]}”")
    return inexact


# ------------------------------------------------------------- report


def build_report(plan, merged_by_chapter, inexact_quotes):
    """A short markdown report of what was merged."""
    lines = [f"# Question bank: {plan['book']}", ""]
    total = sum(len(questions) for questions in merged_by_chapter.values())
    lines.append(f"{total} questions (plan: {plan['totalQuestions']} = "
                 f"{plan['totalPages']} pages x "
                 f"{plan['questionsPerPage']} per page).")
    lines.append("")
    lines.append("| Chapter | Pages | Planned | Written | "
                 + " | ".join(KINDS) + " |")
    lines.append("|---|---|---|---|" + "---|" * len(KINDS))
    for chapter in plan["chapters"]:
        questions = merged_by_chapter.get(chapter["unit"], [])
        kinds = Counter(question["kind"] for question in questions)
        lines.append(f"| {chapter['unit']} | {chapter['pages']} | "
                     f"{chapter['questionCount']} | {len(questions)} | "
                     + " | ".join(str(kinds[kind]) for kind in KINDS)
                     + " |")
    all_kinds = Counter(question["kind"]
                        for questions in merged_by_chapter.values()
                        for question in questions)
    lines += ["", "Mix: " + ", ".join(
        f"{kind} {round(100 * all_kinds[kind] / max(total, 1))}%"
        for kind in KINDS)]
    if inexact_quotes is not None:
        lines.append(f"Quotes not word-for-word in the book: "
                     f"{inexact_quotes}")
    lines += ["", f"## Errors ({len(errors)})", ""]
    lines += [f"- {error}" for error in errors] or ["None."]
    lines += ["", f"## Warnings ({len(warnings)})", ""]
    lines += [f"- {warning}" for warning in warnings] or ["None."]
    return "\n".join(lines) + "\n"


def print_chapter_check(merged_by_chapter):
    """Short result of an --only check; exit 1 on errors."""
    for unit, questions in merged_by_chapter.items():
        kinds = Counter(question["kind"] for question in questions)
        print(f"{unit}: {len(questions)} usable questions "
              f"({', '.join(f'{k} {kinds[k]}' for k in KINDS)})")
    for error in errors:
        print(f"ERROR    {error}")
    for warning in warnings:
        print(f"WARNING  {warning}")
    if errors:
        raise SystemExit(1)
    print("No errors." if not warnings else "No errors; read the warnings.")


def main():
    """Check, merge, write the report, and exit 1 on errors."""
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("plan_file", type=Path)
    parser.add_argument("--book-text", type=Path)
    parser.add_argument("--output", type=Path, default=Path("questions.json"))
    parser.add_argument("--only", metavar="ID_PREFIX")
    arguments = parser.parse_args()
    plan = json.loads(arguments.plan_file.read_text())
    plan_folder = arguments.plan_file.parent
    if arguments.only:
        plan["chapters"] = [chapter for chapter in plan["chapters"]
                            if chapter["idPrefix"] == arguments.only]
        if not plan["chapters"]:
            raise SystemExit(f"No chapter has idPrefix {arguments.only!r}")

    seen_ids = set()
    merged_by_chapter = {}
    for chapter in plan["chapters"]:
        path = plan_folder / chapter["file"]
        if not path.exists():
            errors.append(f"{chapter['unit']}: {chapter['file']} is missing")
            continue
        try:
            questions = json.loads(path.read_text())
        except json.JSONDecodeError as problem:
            errors.append(f"{chapter['file']}: not valid JSON ({problem})")
            continue
        if isinstance(questions, dict):
            questions = questions.get("questions", [])
        merged_by_chapter[chapter["unit"]] = check_chapter(
            chapter, questions, seen_ids)

    all_questions = [question for chapter in plan["chapters"]
                     for question in merged_by_chapter.get(chapter["unit"],
                                                           [])]
    inexact_quotes = None
    if arguments.book_text:
        inexact_quotes = warn_about_inexact_quotes(
            all_questions, arguments.book_text.read_text())

    if arguments.only:
        print_chapter_check(merged_by_chapter)
        return
    report = build_report(plan, merged_by_chapter, inexact_quotes)
    (plan_folder / "question-bank-report.md").write_text(report)
    print(report)
    if errors:
        raise SystemExit(f"{len(errors)} error(s): questions.json "
                         "was not written.")
    book = {"id": plan["id"], "book": plan["book"]}
    if plan.get("labels"):
        book["labels"] = plan["labels"]
    book["questions"] = all_questions
    arguments.output.write_text(
        json.dumps(book, indent=1, ensure_ascii=False) + "\n")
    print(f"Wrote {len(all_questions)} questions to {arguments.output}")


if __name__ == "__main__":
    main()
