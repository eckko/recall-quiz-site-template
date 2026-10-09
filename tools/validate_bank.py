#!/usr/bin/env python3
"""Check a questions.json that teaches (a bank with "concepts").

    python3 tools/validate_bank.py questions.json

Prints every problem and a short summary, and exits with 1 if any error
was found. Warnings do not fail the check, but read them.

A bank without "concepts" is an ordinary recall bank: only the old
per-question checks run. The rules for a teaching bank are written in
ai-context/learning-design.md.
"""

import json
import re
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from merge_question_bank import question_problems  # noqa: E402

ROLES = ("pretest", "warmup", "extend", "apply", "transfer",
         "discriminate", "predict", "spot-error")
PRETEST_KINDS = ("mcq", "tf", "fill", "multi")
LEAST_LADDER_QUESTIONS = 4
LEAST_LADDER_KINDS = 3
MOST_PARAGRAPH_WORDS = 70
MOST_EXAMPLE_WORDS = 80
MOST_ANSWERS_IN_ONE_POSITION = 0.5
MOST_SUMMARY_WORDS = 40
MOST_UNIT_SUMMARY_WORDS = 30
MOST_LIMITS_WORDS = 50
MOST_CORE_SHARE = 0.5
HTRAB_TAGS_FILE = Path(__file__).resolve().parent.parent / "htrab" / "tags.json"
LOADED_WORDS = re.compile(
    r"\b(obviously|just|merely|simply|clearly|of course|everyone knows|"
    r"surely|naturally)\b", re.I)
ABSOLUTES = re.compile(r"\b(always|never)\b", re.I)
LOADED_WHY = re.compile(
    r"^why (is|are|do|does|did)\b.*\b(so|too|still)\b", re.I)
QUOTED_TERM = re.compile(
    r"[\u201c\"]([^\u201d\"\n]{2,40})[\u201d\"]|"
    r"(?<![\w])'([^'\n]{2,40})'(?![\w])")
SLUG_PATTERN = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
HTML_PATTERN = re.compile(r"<[a-z/][^>]*>", re.I)

errors = []
warnings = []
HTRAB_TAGS = None   # set in main() from htrab/tags.json


def error(where, message):
    """Remember a problem that makes the bank unusable."""
    errors.append(f"{where}: {message}")


def warn(where, message):
    """Remember something worth a second look."""
    warnings.append(f"{where}: {message}")


def is_text(value):
    """True for a non-empty string."""
    return isinstance(value, str) and bool(value.strip())


def word_count(text):
    """Number of words in a text."""
    return len(text.split())


# ------------------------------------------------------------------ text


def check_text_field(where, text):
    """HTML and unbalanced formula marks in any reader-facing text."""
    if HTML_PATTERN.search(text):
        error(where, "contains HTML (it would be shown literally)")
    opened = text.count("\\(") + text.count("\\[")
    closed = text.count("\\)") + text.count("\\]")
    if opened != closed:
        error(where, "formula marks \\( \\) are not balanced")
    if text.count("$$") % 2:
        error(where, "$$ formula marks are not balanced")


def reader_texts(question):
    """Every extra text a question of this bank shows."""
    texts = []
    for field in ("hint", "rule", "teaches"):
        if field in question:
            texts.append((field, question[field]))
    for index, text in enumerate(question.get("optionExplain") or []):
        texts.append((f"optionExplain[{index}]", text))
    return [(name, text) for name, text in texts if isinstance(text, str)]


# ----------------------------------------------------------- HTRAB tags


def load_htrab_tags():
    """{tag: stage} from htrab/tags.json, or None if the module is gone."""
    if not HTRAB_TAGS_FILE.exists():
        return None
    tree = json.loads(HTRAB_TAGS_FILE.read_text())
    tags = {}
    for level in tree["levels"]:
        for topic in level["topics"]:
            for sub in topic["subtopics"]:
                tag = f"{level['id']}/{topic['id']}/{sub['id']}"
                tags[tag] = {"stage": topic.get("stage"),
                             "level": level["id"],
                             "testable": sub.get("testable", True)}
    return tags


def check_htrab_tag(where, tag, known):
    """A tag must be level/topic/subtopic and exist in htrab/tags.json."""
    if not is_text(tag) or tag.count("/") != 2:
        error(where, "htrab must be 'level/topic/subtopic'")
    elif known is None:
        warn(where, "htrab tag not checked: htrab/tags.json is missing")
    elif tag not in known:
        error(where, f"htrab tag {tag!r} is not in htrab/tags.json")
    elif not known[tag]["testable"]:
        warn(where, f"htrab tag {tag!r} has too little advice to test")


def check_htrab_order(concepts, known):
    """Understanding before judging: an idea tagged stage 3 (is it true?)
    should build on an idea tagged stage 1 or 2."""
    if not known:
        return
    stage = {c.get("id"): (known.get(c.get("htrab")) or {}).get("stage")
             for c in concepts if isinstance(c, dict)}
    parents = {c.get("id"): c.get("requires") or []
               for c in concepts if isinstance(c, dict)}

    def ancestors(concept_id, seen=None):
        seen = seen if seen is not None else set()
        for parent in parents.get(concept_id, []):
            if parent not in seen:
                seen.add(parent)
                ancestors(parent, seen)
        return seen

    for concept_id, value in stage.items():
        if value == "3" and not any(
                stage.get(a) in ("1", "2") for a in ancestors(concept_id)):
            warn(f"concept {concept_id}",
                 "criticism (stage 3) should build on an idea that checks "
                 "understanding (stage 1 or 2): understand before judging")


# ----------------------------------------------------------- writing rules


def check_wording(where, question):
    """Warn about wording that biases or muddles a question."""
    stem = question.get("q") or ""
    options = question.get("options") or []
    texts = [("question", stem)] + [
        (f"option {i + 1}", t) for i, t in enumerate(options)
        if isinstance(t, str)]
    for name, text in texts:
        found = LOADED_WORDS.search(text)
        if found:
            warn(where, f"{name} uses loaded wording {found.group(0)!r}")
    if ABSOLUTES.search(stem):
        warn(where, "the question says 'always' or 'never': check it is "
             "really absolute")
    if stem.count("?") > 1:
        warn(where, "two questions in one stem (more than one '?')")
    if LOADED_WHY.match(stem.strip()):
        warn(where, "'Why is it so/too/still ...' may smuggle in an "
             "assumption the reader never accepted")
    if question.get("kind") == "mcq" and len(options) == 2:
        warn(where, "a two-option mcq is a coin flip: use tf or add "
             "a plausible option")


def card_text(concept):
    """All the words of a concept card, lower case."""
    card = concept.get("card") or {}
    parts = list(card.get("paragraphs") or [])
    parts += [card.get("example") or "", card.get("rule") or "",
              card.get("limits") or "", concept.get("title") or ""]
    return " ".join(p for p in parts if isinstance(p, str)).lower()


def check_key_terms(bank):
    """A term in quotation marks in a question should be defined in the
    card of its idea or of an earlier idea."""
    concepts = bank.get("concepts") or []
    order = {c.get("id"): i for i, c in enumerate(concepts)
             if isinstance(c, dict)}
    for question in bank.get("questions") or []:
        index = order.get(question.get("concept"))
        if index is None:
            continue
        known = " ".join(card_text(c) for c in concepts[:index + 1]
                         if isinstance(c, dict))
        for match in QUOTED_TERM.finditer(question.get("q") or ""):
            term = (match.group(1) or match.group(2)).strip().lower()
            if term and term not in known:
                warn(f"question {question.get('id')}",
                     f"the term {term!r} is not defined in any card up "
                     "to this idea")


# --------------------------------------------------------------- concepts


def check_concepts(concepts):
    """Concept fields, requirements and cards. Returns {id: concept}."""
    by_id = {}
    for position, concept in enumerate(concepts):
        where = f"concept #{position + 1} ({concept.get('id')})"
        if not isinstance(concept, dict):
            error(where, "must be an object")
            continue
        check_concept_fields(where, concept, by_id)
        for required in concept.get("requires") or []:
            if required not in by_id:
                error(where, f"requires {required!r}, which is not an "
                      "earlier concept")
        if is_text(concept.get("id")):
            by_id[concept["id"]] = concept
    return by_id


def check_concept_fields(where, concept, seen):
    """The plain fields of one concept and its card."""
    concept_id = concept.get("id")
    if not is_text(concept_id) or not SLUG_PATTERN.match(concept_id):
        error(where, "id must be a lower-case slug such as 'remainders'")
    elif concept_id in seen:
        error(where, "id is used twice")
    for field in ("unit", "unitTitle", "section", "title"):
        if not is_text(concept.get(field)):
            error(where, f"missing {field}")
    if not isinstance(concept.get("requires"), list):
        error(where, "requires must be a list (use [] for none)")
    check_card(where, concept.get("card"))
    check_orienting_question(where, concept.get("question"))
    if "core" in concept and not isinstance(concept["core"], bool):
        error(where, "core must be true or false")


def check_orienting_question(where, text):
    """One short question to keep in mind while reading the card."""
    if not is_text(text):
        warn(where, "no orienting question (`question`) for the card")
        return
    check_text_field(f"{where} question", text)
    if text.count("?") != 1 or not text.strip().endswith("?"):
        error(where, "question must be exactly one question ending in ?")
    if word_count(text) > 25:
        warn(where, "question has over 25 words")


def check_card(where, card):
    """A concept card: 1 to 4 short paragraphs and a rule."""
    if not isinstance(card, dict):
        error(where, "missing card")
        return
    paragraphs = card.get("paragraphs")
    if not isinstance(paragraphs, list) or not 1 <= len(paragraphs) <= 4:
        error(where, "card.paragraphs needs 1 to 4 paragraphs")
        paragraphs = []
    for index, paragraph in enumerate(paragraphs):
        if not is_text(paragraph):
            error(where, f"card paragraph {index + 1} is empty")
            continue
        check_text_field(f"{where} card paragraph {index + 1}", paragraph)
        if word_count(paragraph) > MOST_PARAGRAPH_WORDS:
            warn(where, f"card paragraph {index + 1} has over "
                 f"{MOST_PARAGRAPH_WORDS} words")
    if not is_text(card.get("rule")):
        error(where, "card.rule is required")
    else:
        check_text_field(f"{where} card rule", card["rule"])
    limits = card.get("limits")
    if not is_text(limits):
        warn(where, "card.limits missing: say where the rule stops "
             "working")
    else:
        check_text_field(f"{where} card limits", limits)
        if word_count(limits) > MOST_LIMITS_WORDS:
            warn(where, f"card limits has over {MOST_LIMITS_WORDS} words")
    example = card.get("example")
    if example is not None:
        if not is_text(example):
            error(where, "card.example must be text if present")
        else:
            check_text_field(f"{where} card example", example)
            if word_count(example) > MOST_EXAMPLE_WORDS:
                warn(where, f"card example has over {MOST_EXAMPLE_WORDS}"
                     " words")


# -------------------------------------------------------------- questions


def check_question(question, concepts_by_id):
    """Old per-question checks plus the teaching fields."""
    where = f"question {question.get('id')}"
    for problem in question_problems(question):
        error(where, problem)
    concept = concepts_by_id.get(question.get("concept"))
    if concept is None:
        error(where, f"concept {question.get('concept')!r} does not exist")
    else:
        for field in ("unit", "section", "unitTitle"):
            if question.get(field) != concept.get(field):
                error(where, f"{field} {question.get(field)!r} differs from "
                      f"the concept's {concept.get(field)!r}")
    check_role_and_rung(where, question)
    check_feedback_fields(where, question)
    check_wording(where, question)
    if "htrab" in question:
        check_htrab_tag(where, question["htrab"], HTRAB_TAGS)
    for name, text in reader_texts(question):
        check_text_field(f"{where} {name}", text)
    for field in ("q", "explain", "a"):
        if isinstance(question.get(field), str):
            check_text_field(f"{where} {field}", question[field])


def check_role_and_rung(where, question):
    """role and rung: valid values, and pretests are rung 0."""
    role = question.get("role")
    rung = question.get("rung")
    if role not in ROLES:
        error(where, f"role must be one of {', '.join(ROLES)}")
    if not isinstance(rung, int) or isinstance(rung, bool) or rung < 0:
        error(where, "rung must be a whole number, 0 or more")
    elif (role == "pretest") != (rung == 0):
        error(where, "rung 0 is for the pretest, and only for it")
    if role == "pretest" and question.get("kind") not in PRETEST_KINDS:
        error(where, "a pretest must be mcq, tf, fill or multi")


def check_feedback_fields(where, question):
    """explain, optionExplain, teaches, rule and hint."""
    kind = question.get("kind")
    if kind != "recall" and not is_text(question.get("explain")):
        error(where, "explain is required")
    options = question.get("options")
    explanations = question.get("optionExplain")
    if kind in ("mcq", "multi"):
        if not isinstance(explanations, list) or \
                not isinstance(options, list) or \
                len(explanations) != len(options):
            error(where, "optionExplain needs one text per option")
        elif not all(is_text(text) for text in explanations):
            error(where, "optionExplain has an empty entry")
    elif explanations is not None:
        error(where, "optionExplain is only for mcq and multi")
    if question.get("role") in ("extend", "transfer") and \
            not is_text(question.get("teaches")):
        error(where, "an extend or transfer question needs 'teaches'")
    if not is_text(question.get("rule")):
        warn(where, "no rule to remember")
    for field in ("hint", "teaches", "rule"):
        if field in question and not is_text(question[field]):
            error(where, f"{field} must be text if present")


# ---------------------------------------------------------------- ladders


def check_ladders(concepts_by_id, questions):
    """Each concept has a pretest and a ladder of the right shape."""
    by_concept = {concept_id: [] for concept_id in concepts_by_id}
    for question in questions:
        by_concept.get(question.get("concept"), []).append(question)
    for concept_id, members in by_concept.items():
        where = f"concept {concept_id}"
        pretests = [q for q in members if q.get("role") == "pretest"]
        ladder = [q for q in members if q.get("role") != "pretest"]
        if len(pretests) != 1:
            error(where, f"needs exactly one pretest, has {len(pretests)}")
        check_ladder_shape(where, ladder)


def check_ladder_shape(where, ladder):
    """Rungs 1..n, enough questions, the roles and the variety."""
    if len(ladder) < LEAST_LADDER_QUESTIONS:
        error(where, f"needs at least {LEAST_LADDER_QUESTIONS} ladder "
              f"questions, has {len(ladder)}")
    rungs = sorted(q.get("rung") for q in ladder
                   if isinstance(q.get("rung"), int))
    if rungs != list(range(1, len(rungs) + 1)) or len(rungs) != len(ladder):
        error(where, f"ladder rungs must be 1, 2, 3 ... with no gaps or "
              f"repeats (found {rungs})")
    roles = [q.get("role") for q in sorted(
        ladder, key=lambda q: q.get("rung") if isinstance(
            q.get("rung"), int) else 0)]
    if roles and roles[0] != "warmup":
        error(where, "rung 1 must be a warmup")
    for needed in ("apply", "transfer"):
        if needed not in roles:
            error(where, f"the ladder needs an {needed} question")
    kinds = {q.get("kind") for q in ladder}
    if len(kinds) < LEAST_LADDER_KINDS:
        error(where, f"the ladder needs at least {LEAST_LADDER_KINDS} "
              f"different kinds, has {sorted(kinds)}")


def warn_about_answer_positions(questions):
    """Warn when right answers sit in one position too often."""
    positions = [q["answer"] for q in questions
                 if q.get("kind") == "mcq" and isinstance(q.get("answer"),
                                                          int)]
    if len(positions) < 8:
        return
    position, count = Counter(positions).most_common(1)[0]
    if count / len(positions) > MOST_ANSWERS_IN_ONE_POSITION:
        warn("mcq answers", f"{count} of {len(positions)} right answers "
             f"are option {position + 1}")


# ------------------------------------------------------------------- main


def check_top_level(bank):
    """id, book and the questions list. Returns the list or None."""
    for field in ("id", "book"):
        if not is_text(bank.get(field)):
            error("questions.json", f"missing {field}")
    questions = bank.get("questions")
    if not isinstance(questions, list) or not questions:
        error("questions.json", "questions must be a non-empty list")
        return None
    ids = [q.get("id") for q in questions if isinstance(q, dict)]
    for repeated in sorted({i for i in ids if ids.count(i) > 1}):
        error("questions.json", f"question id {repeated!r} is used twice")
    return questions


def check_core_and_summaries(bank):
    """How many ideas are core, and the one-sentence summaries."""
    concepts = [c for c in bank.get("concepts") or []
                if isinstance(c, dict)]
    core = [c for c in concepts if c.get("core") is True]
    if len(concepts) >= 4 and not core:
        warn("concepts", "no idea is marked core: the 5-minute session "
             "needs the few ideas that give most of the value")
    if concepts and len(core) / len(concepts) > MOST_CORE_SHARE:
        warn("concepts", f"{len(core)} of {len(concepts)} ideas are core: "
             "core means the few that matter most")
    summary = bank.get("summary")
    if not is_text(summary):
        warn("questions.json", "no book `summary` (one sentence)")
    elif word_count(summary) > MOST_SUMMARY_WORDS:
        warn("questions.json", "summary is over "
             f"{MOST_SUMMARY_WORDS} words")
    summaries = bank.get("unitSummaries") or {}
    units = []
    for concept in concepts:
        if concept.get("unit") not in units:
            units.append(concept.get("unit"))
    for unit in units:
        text = summaries.get(unit)
        if not is_text(text):
            warn(f"unit {unit}", "no unitSummaries entry (one sentence)")
        elif word_count(text) > MOST_UNIT_SUMMARY_WORDS:
            warn(f"unit {unit}", "summary is over "
                 f"{MOST_UNIT_SUMMARY_WORDS} words")


def print_summary(bank):
    """How many concepts, questions, roles and kinds."""
    questions = bank["questions"]
    concepts = bank.get("concepts") or []
    print(f"{bank.get('book')}: {len(concepts)} concepts, "
          f"{len(questions)} questions")
    for title, field in (("roles", "role"), ("kinds", "kind")):
        counts = Counter(q.get(field) for q in questions)
        text = ", ".join(f"{name} {count}"
                         for name, count in sorted(counts.items(),
                                                   key=str))
        print(f"  {title}: {text}")


def main():
    """Read the file named on the command line and report."""
    global HTRAB_TAGS
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(2)
    HTRAB_TAGS = load_htrab_tags()
    try:
        bank = json.loads(Path(sys.argv[1]).read_text())
    except (OSError, json.JSONDecodeError) as problem:
        print(f"Cannot read {sys.argv[1]}: {problem}")
        sys.exit(1)
    questions = check_top_level(bank)
    if questions is not None:
        concepts = bank.get("concepts")
        if concepts is None:
            for question in questions:
                for problem in question_problems(question):
                    error(f"question {question.get('id')}", problem)
        else:
            by_id = check_concepts(concepts)
            for concept in concepts:
                if isinstance(concept, dict) and "htrab" in concept:
                    check_htrab_tag(f"concept {concept.get('id')}",
                                    concept["htrab"], HTRAB_TAGS)
            for question in questions:
                check_question(question, by_id)
            check_ladders(by_id, questions)
            check_core_and_summaries(bank)
            check_key_terms(bank)
            check_htrab_order(concepts, HTRAB_TAGS)
            warn_about_answer_positions(questions)
        print_summary(bank)
    for message in warnings:
        print(f"  warning: {message}")
    for message in errors:
        print(f"  ERROR: {message}")
    print(f"{len(errors)} error(s), {len(warnings)} warning(s)")
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
