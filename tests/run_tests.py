#!/usr/bin/env python3
"""Browser tests for the quiz. Run from the project folder:

    python3 tests/run_tests.py

Needs Playwright once:  pip install playwright && playwright install chromium

The script starts a small web server, opens the page in a headless
browser and checks that every question type, the confidence check, the
timed session, saved progress, book labels and themes all work. It
prints PASS or FAIL for each check and exits with 1 if anything failed.

Every question is checked for correct fields. In the browser, a large
bank is sampled (a few questions of each type); add --all to answer
every question right and wrong (slow: about a second per question).
"""

import json
import re
import subprocess
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))
from merge_question_bank import question_problems  # noqa: E402

SITE_FOLDER = Path(__file__).resolve().parent.parent
PORT = 8765
PAGE_URL = f"http://localhost:{PORT}/index.html"
# The tests run against a fixed sample bank, so they pass whatever
# questions.json the site holds. (The real file is still validated.)
BOOK = json.loads(
    (SITE_FOLDER / "tests/fixtures/clock-arithmetic.json").read_text())

ANSWER_EVERY_QUESTION = "--all" in sys.argv
SAMPLE_PER_KIND = 3
failures = []


def check(description, condition, detail=""):
    """Print one test result and remember failures."""
    if condition:
        print(f"  PASS  {description}")
    else:
        print(f"  FAIL  {description}  ({detail})")
        failures.append(description)


# ------------------------------------------------------------- answering


def item(css, text):
    """Selector for the element showing this text. Text with a formula
    is matched by the TeX the typesetter keeps in its annotation."""
    formula = re.search(r"\\\((.+?)\\\)", text)
    if formula:
        tex = formula.group(1).replace("\\", "\\\\").replace('"', '\\"')
        return f'{css}:has(annotation:text-is("{tex}"))'
    return f'{css}:text-is("{text}")'


def answer_question(page, question, answer_wrongly):
    """Answer one question on screen, right or wrong on purpose."""
    kind = question["kind"]
    if kind == "tf":
        right_key = 1 if question["answer"] else 2
        page.keyboard.press(str(3 - right_key if answer_wrongly
                                else right_key))
    elif kind == "mcq":
        right_key = question["answer"] + 1
        wrong_key = 1 if right_key != 1 else 2
        page.keyboard.press(str(wrong_key if answer_wrongly else right_key))
    elif kind == "multi":
        if answer_wrongly:
            ticks = [index for index in range(len(question["options"]))
                     if index not in question["answers"]][:1]
        else:
            ticks = question["answers"]
        for index in ticks:
            page.keyboard.press(str(index + 1))
        page.keyboard.press("Enter")
    elif kind == "fill":
        typed = "banana" if answer_wrongly else question["accept"][0]
        page.fill(".fill-input", typed)
        page.keyboard.press("Enter")
        if answer_wrongly:
            page.click(".self-rating .miss")
    elif kind == "order":
        items = question["items"]
        for text in (list(reversed(items)) if answer_wrongly else items):
            page.click(item(".order-pool .order-item", text))
        page.click("text=Check order")
    elif kind == "match":
        pairs = question["pairs"]
        partners = pairs[::-1] if answer_wrongly else pairs
        for (left, _), (_, right) in zip(pairs, partners):
            page.click(item(".match-column:nth-child(1) .match-item", left))
            page.click(item(".match-column:nth-child(2) .match-item",
                            right))
        page.click("text=Check matches")
    elif kind == "sort":
        for entry in question["items"]:
            group = 1 - entry["g"] if answer_wrongly else entry["g"]
            page.click(item(".sort-pool .sort-chip", entry["t"]))
            page.click(f".sort-group:nth-child({group + 1}) "
                       ".sort-group-head")
        page.click("text=Check groups")
    elif kind == "recall":
        page.keyboard.press("Space")
        page.keyboard.press("1" if answer_wrongly else "3")


def open_page(browser, questions=None, book=None, width=430, bank=None,
              block=None, view="ideas"):
    """Open the quiz, optionally with a made-up questions.json, a bank
    from banks/ (bank="how-to-read-a-book") or some files blocked."""
    page = browser.new_page(viewport={"width": width, "height": 900})
    page.errors = []
    page.on("pageerror", lambda error: page.errors.append(str(error)))
    page.on("dialog", lambda dialog: dialog.accept())
    page.route("**/fonts.googleapis.com/**", lambda route: route.abort())
    page.route("**/js/sync/sync-config.js", lambda route: route.fulfill(
        content_type="application/javascript",
        body='window.RecallQuizSyncConfig = {provider: "none"};'))
    if view:
        # Most tests click ideas straight under a chapter (ideas view).
        page.add_init_script(
            f"localStorage.setItem('recall-quiz-home-view', '{view}')")
    if block:
        page.route(block, lambda route: route.abort())
    served = dict(book or BOOK)
    if questions is not None:
        served["questions"] = questions
    page.route("**/questions.json", lambda route: route.fulfill(json=served))
    page.goto(PAGE_URL + (f"?bank=banks/{bank}.json" if bank else ""))
    page.wait_for_selector("#book-title:not(:text-is('Recall Quiz'))")
    return page


def start_session(page, confidence=False, timed=False):
    """Pick "Everything", all questions, and press Start."""
    if not page.eval_on_selector("#custom-practice", "d => d.open"):
        page.click("#custom-practice summary")
    page.click("#question-filter-choice button[data-value='all']")
    if not confidence:
        page.click("#confidence-choice button[data-value='off']")
    page.fill("#question-count-input", "")
    if timed:
        page.click("#session-length-choice button[data-value='time']")
    page.click("#start-button")


def current_step(page):
    """The step on screen, read from the session state."""
    return page.evaluate(
        "() => { const s = window.RecallQuiz.session.state;"
        " return s.questions[s.currentIndex]; }")


def play_learn_session(page, answer_wrongly=False, log=None):
    """Play the whole Learn session on screen. Returns the steps seen."""
    seen = []
    for _ in range(80):
        if page.is_visible(".result"):
            break
        step = current_step(page)
        seen.append(step)
        if step["kind"] == "lesson":
            page.keyboard.press("Enter")
            page.wait_for_timeout(50)
            continue
        if step.get("isPretestRun") or answer_wrongly is False:
            wrong = bool(step.get("isPretestRun")) or answer_wrongly
        else:
            wrong = answer_wrongly
        if page.is_visible(".confidence-row"):
            page.click(".confidence-row .pill-button >> nth=1")
        answer_question(page, step, wrong)
        if step["kind"] != "recall":
            page.wait_for_selector("#question-card .verdict")
            if log is not None:
                log.append(page.inner_text("#question-card"))
        page.keyboard.press("Enter")
        page.wait_for_timeout(50)
    return seen


# ------------------------------------------------------------- tests


def test_every_question_is_well_formed():
    """Every question has the fields its type needs (no browser)."""
    print("Every question in questions.json has the right fields")
    questions = BOOK["questions"]
    broken = [f"{question.get('id')}: {'; '.join(problems)}"
              for question in questions
              for problems in [question_problems(question)] if problems]
    ids = [question.get("id") for question in questions]
    repeated = sorted({qid for qid in ids if ids.count(qid) > 1}) \
        if len(ids) != len(set(ids)) else []
    check(f"all {len(questions)} questions are well formed", not broken,
          "; ".join(broken[:5]))
    check("question ids are unique", not repeated, ", ".join(repeated[:5]))


def questions_to_answer():
    """All questions for a small bank or with --all; else a sample.

    The sample takes a few questions of each type, spread across the
    book, so every type is tried without taking an hour.
    """
    questions = BOOK["questions"]
    if ANSWER_EVERY_QUESTION or len(questions) <= 8 * SAMPLE_PER_KIND:
        return questions
    sample = []
    kinds = sorted({question["kind"] for question in questions})
    for kind in kinds:
        of_kind = [question for question in questions
                   if question["kind"] == kind]
        step = max(1, len(of_kind) // SAMPLE_PER_KIND)
        sample.extend(of_kind[::step][:SAMPLE_PER_KIND])
    return sample


def test_every_question_type(browser):
    """Each question, right gives 1 mark and wrong gives 0."""
    questions = questions_to_answer()
    print(f"{len(questions)} of {len(BOOK['questions'])} questions, "
          "answered right and wrong")
    for question in questions:
        for answer_wrongly in (False, True):
            page = open_page(browser, questions=[question])
            start_session(page)
            answer_question(page, question, answer_wrongly)
            if question["kind"] != "recall":
                page.wait_for_selector("#question-card .verdict")
                page.keyboard.press("Enter")
            marks = page.inner_text(".result-marks")
            expected = "Marks: 0 out of 1" if answer_wrongly \
                else "Marks: 1 out of 1"
            how = "wrong" if answer_wrongly else "right"
            check(f"{question['id']} ({question['kind']}) answered {how}",
                  marks == expected and not page.errors,
                  marks if marks != expected else "; ".join(page.errors))
            page.close()


def test_confidence_check(browser):
    """Answers wait for a confidence level; certain misses are flagged."""
    print("Confidence check")
    question = next(q for q in BOOK["questions"] if q["kind"] == "tf")
    page = open_page(browser, questions=[question])
    start_session(page, confidence=True)
    is_locked = page.eval_on_selector(
        ".confidence-row ~ div", "area => area.matches('.is-locked')")
    check("answers are locked until a confidence level is picked",
          is_locked)
    page.click(".confidence-row .pill-button:has-text('Certain')")
    answer_question(page, question, answer_wrongly=True)
    page.wait_for_selector("#question-card .confident-miss")
    page.keyboard.press("Enter")
    check("a certain-but-wrong answer is flagged on the results",
          page.is_visible(".result .confident-miss"))
    page.close()


def test_timed_session(browser):
    """A timed session shows the clock in the pill and on the card."""
    print("Timed session")
    page = open_page(browser)
    start_session(page, timed=True)
    pill = page.inner_text("#session-pill")
    check("the pill shows the time left", pill.startswith("Time left"),
          pill)
    check("the card shows a session clock",
          page.is_visible("#question-card .session-clock"))
    page.close()


def test_question_timer_runs_out(browser):
    """An unanswered question is marked when its timer runs out."""
    print("Timer per question")
    question = next(q for q in BOOK["questions"] if q["kind"] == "mcq")
    page = open_page(browser, questions=[question])
    page.clock.install()
    page.click("#question-timer-choice button[data-value='15']")
    start_session(page)
    page.clock.run_for(16000)
    verdict = page.inner_text("#question-card .verdict")
    check("an unanswered question is marked when time runs out",
          verdict == "Time's up.", verdict)
    page.close()


def test_old_progress_is_upgraded(browser):
    """Version-1 saved progress is read and re-saved as version 2."""
    print("Saved progress from the older version")
    first_id = BOOK["questions"][0]["id"]
    old_progress = {
        "items": {first_id: {"box": 1, "seen": 2, "missed": 1,
                             "due": 0, "last": 0}},
        "days": [],
        "history": [{"t": 1759660000000, "pct": 75, "marks": 3,
                     "total": 4, "v": "pass", "scope": "Whole book",
                     "limit": 0, "mins": 0}],
    }
    page = open_page(browser)
    page.evaluate(
        "([key, value]) => localStorage.setItem(key, value)",
        [f"recall-quiz:{BOOK['id']}", json.dumps(old_progress)])
    page.reload()
    page.wait_for_selector("#recent-results .history-row")
    history_score = page.inner_text("#recent-results .history-score")
    learning = page.inner_text("#progress-tally div:nth-child(2) b")
    check("old results appear in Your recent results",
          history_score.startswith("75%"), history_score)
    check("old question progress counts as Learning", learning == "1",
          learning)
    saved = json.loads(page.evaluate(
        f"localStorage.getItem('recall-quiz:{BOOK['id']}')"))
    check("it is saved again in the new format",
          saved.get("version") == 2 and first_id in saved["questions"])
    page.close()


def test_backup_without_version_keeps_progress(browser):
    """A version-2 backup that lost its version field is not wiped."""
    print("Loading a backup")
    first_id = BOOK["questions"][0]["id"]
    backup = {"questions": {first_id: {
        "memoryLevel": 3, "timesSeen": 3, "timesMissed": 0,
        "nextReview": 0, "lastAnswered": 0, "confidentMisses": 0}},
        "daysPracticed": [], "recentResults": []}
    page = open_page(browser)
    page.set_input_files("#progress-file-input", files=[{
        "name": "backup.json", "mimeType": "application/json",
        "buffer": json.dumps(backup).encode()}])
    page.wait_for_function(
        "document.querySelector('#progress-tally b').textContent === '1'")
    solid = page.inner_text("#progress-tally div:nth-child(1) b")
    check("a backup without a version field is loaded, not wiped",
          solid == "1", solid)
    page.close()


def test_book_labels(browser):
    """labels in questions.json change the words on the page."""
    print("Book labels from questions.json")
    book = dict(BOOK)
    book["labels"] = {"unit": "Lesson", "units": "lessons",
                      "topic": "Section", "whole": "Whole course"}
    # Relabelling applies to numbered units ("Chapter 3"); named units
    # such as "Introduction" or "Rule #1" are shown as they are.
    book["questions"] = [
        dict(question, unit="Chapter 1") for question in BOOK["questions"]]
    page = open_page(browser, book=book)
    check("the chapter picker says Lesson",
          page.inner_text("#unit-picker-label") == "Lesson")
    # "1 lesson" for a one-chapter book, "3 lessons" otherwise.
    check("the summary counts lessons",
          "lesson" in page.inner_text("#book-summary"))
    start_session(page)
    chip = page.inner_text(".unit-chip")
    check("the question shows the Lesson label", chip.startswith("Lesson"),
          chip)
    page.close()


def test_sanskrit_answers(browser):
    """Devanagari, IAST and plain Roman spellings count as the same."""
    print("Sanskrit and Devanagari answers in fill-in questions")
    question = {
        "id": "t-fill", "unit": "Chapter 1", "section": "Words",
        "kind": "fill", "q": "The Sanskrit word for duty is ____.",
        "accept": ["धर्म", "dharma"], "explain": "x"}
    cases = [
        ("धर्म", True), ("dharma", True), ("Dharma", True),
        ("dharmā", True), ("dhārma", True), ("karma", False),
        ("कर्म", False), ("yoga", False)]
    for typed, should_match in cases:
        page = open_page(browser, questions=[question])
        start_session(page)
        page.fill(".fill-input", typed)
        page.keyboard.press("Enter")
        page.wait_for_selector(".fill-input.is-correct, "
                               ".fill-input.is-incorrect")
        matched = page.eval_on_selector(
            ".fill-input", "e => e.classList.contains('is-correct')")
        check(f"typing {typed} is {'accepted' if should_match else 'not accepted'}",
              matched == should_match and not page.errors,
              "; ".join(page.errors))
        page.close()
    other = dict(question, accept=["संस्कृतम्", "saṃskṛtam"])
    for typed, should_match in [("samskritam", True), ("संस्कृतम्", True),
                                ("sanskaram", False)]:
        page = open_page(browser, questions=[other])
        start_session(page)
        page.fill(".fill-input", typed)
        page.keyboard.press("Enter")
        page.wait_for_selector(".fill-input.is-correct, "
                               ".fill-input.is-incorrect")
        matched = page.eval_on_selector(
            ".fill-input", "e => e.classList.contains('is-correct')")
        check(f"typing {typed} for saṃskṛtam is "
              f"{'accepted' if should_match else 'not accepted'}",
              matched == should_match, "")
        page.close()


def test_formulas(browser):
    """Formulas show as typeset maths; prices stay plain text."""
    print("Formulas")
    math_question = {
        "id": "t-math", "unit": "Chapter 1", "section": "Algebra",
        "kind": "mcq",
        "q": "What is \\(x^2 + 1\\) when \\(x = 3\\)?",
        "options": ["\\(10\\)", "\\(7\\)", "\\(9\\)", "\\(4\\)"],
        "answer": 0, "explain": "Since \\(3^2 = 9\\), the sum is 10."}
    page = open_page(browser, questions=[math_question])
    start_session(page)
    page.wait_for_selector("#question-card .katex")
    shown = page.locator("#question-card .katex").count()
    check("the question and options show typeset maths", shown >= 5,
          f"{shown} formulas")
    raw = page.inner_text("#question-card")
    check("the raw \\( marks are gone", "\\(" not in raw, raw[:80])
    page.keyboard.press("1")
    page.wait_for_selector("#question-card .verdict")
    check("the explanation formula is typeset too",
          page.locator("#question-card .explanation .katex, "
                       "#question-card .feedback .katex").count() >= 1
          or page.locator("#question-card .katex").count() > shown,
          "no new formula in feedback")
    check("no page errors", not page.errors, "; ".join(page.errors))
    page.close()

    price_question = {
        "id": "t-price", "unit": "Chapter 1", "section": "Money",
        "kind": "tf", "q": "True or false: $5 plus $10 is $15.",
        "answer": True, "explain": "Costs $15 in total."}
    requests = []
    page = browser.new_page(viewport={"width": 430, "height": 900})
    page.on("request", lambda request: requests.append(request.url))
    page.route("**/fonts.googleapis.com/**", lambda route: route.abort())
    served = dict(BOOK, questions=[price_question])
    page.route("**/questions.json", lambda route: route.fulfill(json=served))
    page.goto(PAGE_URL)
    page.wait_for_selector("#book-title:not(:text-is('Recall Quiz'))")
    start_session(page)
    page.wait_for_selector("#question-card")
    text = page.inner_text("#question-card")
    check("dollar prices stay as text", "$5 plus $10 is $15" in text, text[:90])
    check("a book without formulas never loads the maths library",
          not any("vendor/katex" in url for url in requests), "")
    page.close()


def test_themes(browser):
    """Every theme folder is in the picker and choices are remembered."""
    print("Themes")
    theme_folders = [folder for folder in (SITE_FOLDER / "themes").iterdir()
                     if (folder / "theme.json").exists()]
    page = open_page(browser)
    page.click("#settings-button")
    check("Appearance is folded by default",
          not page.is_visible("#theme-tiles"))
    page.click("#appearance-section summary")
    groups = page.locator("#theme-groups button").count()
    check("themes are grouped", groups >= 3, str(groups))
    all_tiles = page.evaluate(
        "() => document.querySelectorAll('#theme-tiles .theme-tile').length")
    visible_tiles = page.locator("#theme-tiles .theme-tile:visible").count()
    check("only one group of tiles shows at a time",
          0 < visible_tiles < all_tiles, f"{visible_tiles}/{all_tiles}")
    tile_count = all_tiles
    check("every theme folder has a tile in the picker",
          tile_count == len(theme_folders),
          f"{tile_count} tiles, {len(theme_folders)} folders")
    page.click("#theme-groups button[data-group='Playful']")
    page.click("#theme-groups button[data-group='Playful']")
    page.click(".theme-tile[data-theme-id='lego']")
    page.click("#theme-mode-choice button[data-theme-mode='dark']")
    root = page.evaluate("""() => [
        document.documentElement.dataset.theme,
        document.documentElement.dataset.scheme]""")
    check("choosing Lego and Dark switches the page",
          root == ["lego", "dark"], str(root))
    page.reload()
    root = page.evaluate("() => document.documentElement.dataset.theme")
    check("the choice is remembered after a reload", root == "lego")
    page.close()


def test_home_views(browser):
    """The chapter list can show the book's structure or its ideas."""
    print("Chapter structure and ideas views")
    page = open_page(browser, view=None)
    check("the view switch is shown",
          page.is_visible(".view-switch"))
    check("the structure view is the default",
          page.get_attribute(".view-switch [data-view='structure']",
                             "aria-pressed") == "true")
    check("chapters hold topics (sub-headings)",
          page.locator(".section-row").count() > 0)
    check("no idea list sits directly under a chapter",
          page.locator(".unit-progress > .concept-list").count() == 0)
    page.locator(".section-row > summary").first.evaluate(
        "e => e.parentElement.open = true")
    check("a topic opens to its ideas",
          page.locator(".section-row .concept-row").count() > 0)
    page.click(".view-switch [data-view='ideas']")
    check("the ideas view lists ideas under each chapter",
          page.locator(".unit-progress > .concept-list").count() > 0
          and page.locator(".section-row").count() == 0)
    page.reload()
    page.wait_for_selector(".view-switch")
    check("the choice is remembered after a reload",
          page.get_attribute(".view-switch [data-view='ideas']",
                             "aria-pressed") == "true")
    page.close()

    plain = {"id": "plain", "book": "Plain book",
             "questions": [dict(question, unit="Chapter 1")
                           for question in BOOK["questions"][:3]]}
    for question in plain["questions"]:
        question.pop("concept", None)
    page = open_page(browser, book=plain, view=None)
    check("a book without ideas still shows the switch",
          page.is_visible(".view-switch"))
    check("its structure view lists topics",
          page.locator(".unit-progress .topic-list").count() > 0)
    page.click(".view-switch [data-view='ideas']")
    note = page.inner_text("#where-you-stand .empty-note")
    check("the ideas view explains there are no ideas",
          "no teaching ideas" in note, note)
    page.close()


def open_synced_page(browser, account_theme=None, local_theme=None,
                     account_layout=None):
    """Open the quiz signed in to the test account (example-in-browser),
    with an optional theme already in the account or in this browser."""
    page = browser.new_page(viewport={"width": 430, "height": 900})
    page.errors = []
    page.on("pageerror", lambda error: page.errors.append(str(error)))
    page.route("**/fonts.googleapis.com/**", lambda route: route.abort())
    page.route("**/js/sync/sync-config.js", lambda route: route.fulfill(
        content_type="application/javascript",
        body='window.RecallQuizSyncConfig = {provider: "example-in-browser",'
             ' saveDelaySeconds: 1, "example-in-browser": {}};'))
    lines = ["sessionStorage.setItem('recall-quiz-example-account', "
             "'example-user');"]
    if account_theme:
        lines.append(
            "sessionStorage.setItem('recall-quiz-example-store:"
            "example-user/_settings', JSON.stringify({theme: "
            + json.dumps(account_theme) + "}));")
    if account_layout:
        lines.append(
            "sessionStorage.setItem('recall-quiz-example-store:"
            "example-user/_settings', JSON.stringify({layout: "
            + json.dumps(account_layout) + "}));")
    if local_theme:
        lines.append("localStorage.setItem('recall-quiz:theme', "
                     "JSON.stringify(" + json.dumps(local_theme) + "));")
    page.add_init_script("if (!sessionStorage.getItem('seeded')) {"
                         + "".join(lines)
                         + "sessionStorage.setItem('seeded', '1'); }")
    page.goto(PAGE_URL)
    page.wait_for_selector("#book-title:not(:text-is('Recall Quiz'))")
    return page


def account_theme(page):
    """The theme saved in the test account, or None."""
    return page.evaluate(
        "() => { const text = sessionStorage.getItem("
        "'recall-quiz-example-store:example-user/_settings');"
        " return text ? JSON.parse(text).theme : null; }")


def test_theme_follows_the_account(browser):
    """The theme is saved with the account and restored on a new device."""
    print("Theme saved to the account")
    page = open_synced_page(
        browser, account_theme={"t": "lego", "m": "dark", "a": 2000000000000})
    page.wait_for_function(
        "document.documentElement.dataset.theme === 'lego'", timeout=8000)
    root = page.evaluate("() => document.documentElement.dataset.mode")
    check("a theme saved in the account is applied on this device",
          root == "dark", str(root))
    page.close()

    page = open_synced_page(browser)
    page.click("#settings-button")
    page.click("#appearance-section summary")
    page.click("#theme-groups button[data-group='Playful']")
    page.click(".theme-tile[data-theme-id='lego']")
    page.wait_for_function(
        "sessionStorage.getItem('recall-quiz-example-store:example-user/"
        "_settings') !== null", timeout=8000)
    saved = account_theme(page)
    check("choosing a theme saves it to the account",
          saved and saved["t"] == "lego", str(saved))
    page.close()

    page = open_synced_page(
        browser,
        account_theme={"t": "classic", "m": "light", "a": 1000},
        local_theme={"t": "lego", "m": "dark", "a": 1900000000000})
    page.wait_for_function(
        "sessionStorage.getItem('recall-quiz-example-store:example-user/"
        "_settings').includes('lego')", timeout=8000)
    theme = page.evaluate("() => document.documentElement.dataset.theme")
    check("a newer choice here beats an older one in the account",
          theme == "lego" and not page.errors, "; ".join(page.errors))
    page.close()


def add_recent_result(page):
    """Put one finished session in the history so the panel shows."""
    page.evaluate("""() => {
        RecallQuiz.progress.saved.recentResults.push({
          verdict: "pass", finishedAt: Date.now(), scopeName: "Whole book",
          percent: 60, marks: 6, questionCount: 10});
        RecallQuiz.homeScreen.refresh(); }""")


def test_home_layout(browser):
    """Fold panels, expand/collapse all, and the saved settings."""
    print("Home layout and settings")
    page = open_page(browser, view=None)
    add_recent_result(page)
    for panel, body in [("#session-setup", "#keep-going-block"),
                        ("#progress-panel", ".progress-overview"),
                        ("#recent-results", ".history-row"),
                        ("#where-you-stand", ".view-switch")]:
        check(panel + " starts open", page.is_visible(panel + " " + body))
        page.click(panel + " .panel-toggle")
        check(panel + " folds when its heading is clicked",
              not page.is_visible(panel + " " + body))
        page.click(panel + " .panel-toggle")
        check(panel + " opens again", page.is_visible(panel + " " + body))
    page.click("#where-you-stand .expand-controls button:text('Expand all')")
    closed = page.locator("#where-you-stand details:not([open])").count()
    check("Expand all opens every chapter, topic and idea", closed == 0,
          str(closed))
    page.click(
        "#where-you-stand .expand-controls button:text('Collapse all')")
    opened = page.locator("#where-you-stand details[open]").count()
    check("Collapse all closes them all", opened == 0, str(opened))

    check("the practice choices are on the home screen",
          page.is_visible("#question-timer-choice")
          and page.is_visible("#confidence-choice")
          and page.is_visible("#unit-picker"))
    page.click("#settings-button")
    check("Settings opens as a screen of its own",
          page.is_visible("#settings-screen")
          and not page.is_visible("#where-you-stand"))
    for section in ["appearance-section", "practice-section",
                    "home-section", "progress-file-panel"]:
        check(section + " is on the Settings screen",
              page.is_visible("#" + section))
    check("the progress file is not on the home screen",
          page.locator("#home-screen #progress-file-panel").count() == 0)
    check("Theme moved into Settings",
          page.locator("#theme-button").count() == 0)
    page.click("[data-layout='timer'] [data-value='30']")
    page.click("[data-layout='confidence'] [data-value='off']")
    for name, value in [("setup", "closed"), ("progress", "closed"),
                        ("recent", "closed"), ("chapters", "open"),
                        ("inner", "open")]:
        page.click(f"[data-layout='{name}'] [data-value='{value}']")
    page.click("#settings-button")
    choices = page.evaluate("() => RecallQuiz.settings.readChoices()")
    check("the home screen starts from the saved defaults",
          choices["timer"] == 30 and choices["confidence"] is False
          and page.get_attribute(
              "#question-timer-choice [data-value='30']",
              "aria-pressed") == "true", str(choices))
    check("panels follow the Home screen settings",
          not page.is_visible("#session-setup #keep-going-block")
          and not page.is_visible("#progress-panel .progress-overview")
          and not page.is_visible("#recent-results .history-row"))
    closed = page.locator("#where-you-stand details:not([open])").count()
    check("All open plus Open starts everything open", closed == 0,
          str(closed))
    page.reload()
    page.wait_for_selector("#where-you-stand .unit-progress")
    add_recent_result(page)
    choices = page.evaluate("() => RecallQuiz.settings.readChoices()")
    check("everything is remembered after a reload",
          not page.is_visible("#session-setup #keep-going-block")
          and choices["timer"] == 30
          and page.locator("#where-you-stand details:not([open])").count()
          == 0 and not page.is_visible("#recent-results .history-row"))

    # Overrides on the home screen leave the defaults alone.
    page.click("#session-setup .panel-toggle")
    page.click("#question-timer-choice [data-value='60']")
    page.reload()
    page.wait_for_selector("#where-you-stand .unit-progress")
    choices = page.evaluate("() => RecallQuiz.settings.readChoices()")
    check("a home-screen change lasts for the visit (survives a reload)",
          choices["timer"] == 60, str(choices))
    saved = page.evaluate(
        "() => JSON.parse(localStorage.getItem("
        "'recall-quiz-home-layout')).timer")
    check("...but the saved default stays 30s", saved == 30, str(saved))
    page.click("#settings-button")
    check("Settings still shows the default",
          page.get_attribute("[data-layout='timer'] [data-value='30']",
                             "aria-pressed") == "true")
    page.click("[data-layout='timer'] [data-value='15']")
    page.click("#settings-button")
    choices = page.evaluate("() => RecallQuiz.settings.readChoices()")
    check("setting a new default replaces the home choice",
          choices["timer"] == 15, str(choices))
    check("no errors", not page.errors, "; ".join(page.errors))
    page.close()

    page = open_synced_page(browser)
    page.wait_for_selector("#account-body .button-row button",
                           state="attached")
    check("the home screen shows no bar once signed in",
          not page.is_visible("#cloud-sync-bar"))
    page.click("#settings-button")
    check("the account is at the top of Settings, with Sign out",
          page.is_visible("#account-section")
          and page.is_visible("#account-body button:text('Sign out')")
          and page.locator(".settings-section").first.get_attribute("id")
          == "account-section")
    page.click("[data-layout='stand'] [data-value='closed']")
    page.click("[data-layout='timer'] [data-value='15']")
    page.wait_for_function(
        "(sessionStorage.getItem('recall-quiz-example-store:example-user/"
        "_settings') || '').includes('\"t\":15')", timeout=8000)
    saved = page.evaluate(
        "() => JSON.parse(sessionStorage.getItem("
        "'recall-quiz-example-store:example-user/_settings')).layout")
    check("settings are saved to the account",
          saved and saved["w"] == "closed" and saved["t"] == 15
          and saved["f"] is True, str(saved))
    page.click("#settings-button")
    page.click("#question-timer-choice [data-value='60']")
    page.wait_for_timeout(1500)
    saved = page.evaluate(
        "() => JSON.parse(sessionStorage.getItem("
        "'recall-quiz-example-store:example-user/_settings')).layout.t")
    check("a home-screen override is not saved to the account",
          saved == 15, str(saved))
    page.close()

    page = open_synced_page(browser, account_layout={
        "s": "closed", "w": "open", "c": "closed", "i": "open",
        "p": "open", "r": "open", "t": 60, "f": False, "h": False,
        "u": {}, "a": 2000000000000})
    page.wait_for_function(
        "RecallQuiz.settings.readChoices().timer === 60", timeout=8000)
    check("settings saved in the account are used on this device",
          not page.is_visible("#session-setup #keep-going-block")
          and not page.evaluate(
              "() => RecallQuiz.settings.readChoices().confidence"))
    page.close()


def test_phone_width(browser):
    """Nothing scrolls sideways at phone width."""
    print("Phone width (375px)")
    page = open_page(browser, width=375)
    scrolls_sideways = page.evaluate(
        "() => document.documentElement.scrollWidth > innerWidth")
    check("the home screen does not scroll sideways",
          not scrolls_sideways)
    page.close()


def test_bank_passes_the_validator():
    """tools/validate_bank.py finds no errors in questions.json."""
    print("Teaching bank")
    result = subprocess.run(
        [sys.executable, str(SITE_FOLDER / "tools" / "validate_bank.py"),
         str(SITE_FOLDER / "questions.json")],
        capture_output=True, text=True)
    check("the validator reports no errors", result.returncode == 0,
          result.stdout[-300:])


def saved_progress(page):
    """The progress record of the open book, from local storage."""
    return page.evaluate(
        "() => { const key = Object.keys(localStorage)"
        ".find(k => k.startsWith('recall-quiz:'));"
        " return key ? JSON.parse(localStorage[key]) : null; }")


def open_concept(page, index):
    """Open the idea at this position in the first lesson's list."""
    unit = page.locator("#where-you-stand details.unit-progress").first
    if not unit.evaluate("d => d.open"):
        unit.locator("summary").first.click()
    row = page.locator(".concept-row").nth(index)
    row.locator("summary").click()
    return row


def scored_steps(seen):
    """The steps of a session that are real, scored questions."""
    return [step for step in seen
            if step["kind"] != "lesson" and not step.get("isPretestRun")]


def test_keep_going_teaches_the_next_idea(browser):
    """Keep me going: warm-up guess, card, ladder; pretests are not
    scored; feedback teaches."""
    print("Keep me going")
    page = open_page(browser)
    check("there is no Learn or Review switch",
          not page.is_visible("#mode-choice"))
    check("the sign-in bar stays hidden while sync is off",
          not page.is_visible("#cloud-sync-bar"))
    summary = page.inner_text("#keep-going-summary")
    check("the button says what comes next", "learn" in summary, summary)
    page.click("#confidence-choice button[data-value='off']")
    page.click("#keep-going-button")
    log = []
    seen = play_learn_session(page, log=log)
    order = [("pretest" if step.get("isPretestRun") else step["kind"])
             for step in seen]
    check("it starts with a warm-up guess, then the card",
          order[:2] == ["pretest", "lesson"], str(order[:3]))
    check("only one idea is taught per press",
          order.count("lesson") == 1, str(order))
    check("results say the warm-up guess was not scored",
          "not scored" in page.inner_text(".result"))
    counts = [int(n) for n in re.findall(
        r"\d+", page.inner_text(".score-tally"))]
    check("the tally counts only the scored questions",
          sum(counts) == len(scored_steps(seen)), f"{counts} {len(seen)}")
    saved = saved_progress(page)["questions"]
    pretest_ids = [step["id"] for step in seen if step.get("isPretestRun")]
    check("a pretest is recorded but never scored",
          all(saved[i]["timesSeen"] == 0 and saved[i].get("pretested")
              for i in pretest_ids), str({i: saved.get(i)
                                          for i in pretest_ids}))
    mcq_feedback = next((text for text in log if "Why each option" in text),
                        "")
    check("a multiple-choice answer explains every option",
          "RIGHT ANSWER" in mcq_feedback.upper()
          and "NOT THIS ONE" in mcq_feedback.upper())
    check("feedback shows the rule to remember",
          any("Rule to remember" in text for text in log))
    check("the results button is Keep going",
          page.is_visible(".result >> text=Keep going"))
    check("no page errors in a whole session", not page.errors,
          "; ".join(page.errors))
    page.close()


def test_any_order(browser):
    """No idea is locked. Teach me and Test me work on any idea."""
    print("Any order")
    page = open_page(browser)
    row = open_concept(page, 1)
    rows = page.inner_text(".concept-list")
    check("no idea is shown as locked", "Locked" not in rows, rows[:200])
    body = row.inner_text()
    check("a later idea says what it builds on, and can still start",
          "Builds on" in body and "Teach me" in body, body[-200:])
    row.get_by_text("Teach me", exact=True).click()
    first = current_step(page)
    check("Teach me on the second idea starts with its warm-up guess",
          first.get("isPretestRun") and first["concept"] == "congruence",
          str(first.get("concept")))
    check("a warm-up guess has no Show the idea button",
          not page.is_visible(".idea-again"))
    page.click("text=End session")
    page.close()

    page = open_page(browser)
    row = open_concept(page, 0)
    row.get_by_text("Test me", exact=True).click()
    steps = [current_step(page)]
    check("Test me goes straight to the ladder, no card or warm-up",
          steps[0]["kind"] != "lesson"
          and not steps[0].get("isPretestRun")
          and steps[0].get("role") != "pretest", str(steps[0].get("role")))
    check("a question offers Read the idea before it is answered",
          page.inner_text(".idea-again summary").startswith("Read the idea"),
          page.inner_text(".idea-again summary"))
    page.click(".idea-again summary")
    check("opening it shows the card",
          page.is_visible(".idea-again .idea-rule"))
    check("no page errors", not page.errors, "; ".join(page.errors))
    page.close()


def test_review_includes_unseen_ideas(browser):
    """Custom practice can ask about ideas not taught in the app."""
    print("Custom practice")
    page = open_page(browser)
    page.click("#custom-practice summary")
    summary = page.inner_text("#ready-summary")
    check("Due and new includes questions of ideas not yet taught",
          "ready" in summary and "Nothing is due" not in summary, summary)
    page.close()


def test_second_keep_going_reviews_first(browser):
    """After wrong answers the next Keep me going starts with reviews
    and then teaches the next idea."""
    print("Second Keep me going")
    page = open_page(browser)
    page.click("#confidence-choice button[data-value='off']")
    page.click("#keep-going-button")
    play_learn_session(page, answer_wrongly=True)
    page.click("text=Back to start")
    summary = page.inner_text("#keep-going-summary")
    check("the summary mentions the due reviews",
          "review" in summary and "then" in summary, summary)
    page.click("#keep-going-button")
    first = current_step(page)
    check("the session starts with a review question",
          first.get("isReviewRun"), str(first.get("id")))
    seen = play_learn_session(page)
    concepts = [step["concept"] for step in seen
                if step["kind"] == "lesson"]
    check("then it teaches the next core idea first",
          concepts == ["add-multiply"], str(concepts))
    check("no page errors", not page.errors, "; ".join(page.errors))
    page.close()


def test_sync_bar_appears_when_turned_on(browser):
    """With a provider named in sync-config.js the sign-in bar shows."""
    print("Cloud sync")
    page = browser.new_page(viewport={"width": 430, "height": 900})
    page.errors = []
    page.on("pageerror", lambda error: page.errors.append(str(error)))
    page.route("**/fonts.googleapis.com/**", lambda route: route.abort())
    page.route("**/js/sync/sync-config.js", lambda route: route.fulfill(
        content_type="application/javascript",
        body='window.RecallQuizSyncConfig = {provider: "example-in-browser",'
             ' saveDelaySeconds: 1, "example-in-browser": {}};'))
    page.goto(PAGE_URL)
    page.wait_for_selector("#book-title:not(:text-is('Recall Quiz'))")
    page.wait_for_timeout(800)
    check("the sign-in bar is shown", page.is_visible("#cloud-sync-bar"),
          page.inner_html("#cloud-sync-bar")[:100])
    check("no page errors with sync on", not page.errors,
          "; ".join(page.errors))
    page.close()


def test_firebase_sync_is_on_in_this_edition():
    """The published config uses Firebase; tests route it off."""
    config = (SITE_FOLDER / "js/sync/sync-config.js").read_text()
    check("sync-config.js sets provider firebase",
          'provider: "firebase"' in config)
    check("the Firebase project id is filled in",
          'projectId: "reading-progress-39717"' in config)


def test_every_linked_file_exists():
    """Every script, stylesheet and theme file index.html points to
    must exist, so an incomplete upload is caught before publishing."""
    html = (SITE_FOLDER / "index.html").read_text()
    links = re.findall(r'(?:src|href)="([^"#:]+\.(?:js|css|json|svg))"', html)
    missing = [name for name in links if not (SITE_FOLDER / name).exists()]
    check("every file linked from index.html exists", not missing,
          f"missing: {missing}")
    check("helpers.js loads before the other app scripts",
          html.index("js/helpers.js") < html.index("js/book.js"))


# ------------------------------------------------------------- M3 tests

HTRAB_BANK = json.loads(
    (SITE_FOLDER / "banks" / "how-to-read-a-book.json").read_text())
SCRATCH = Path(__file__).resolve().parent


def run_validator(bank):
    """Validate a bank dict; returns the validator's text output."""
    path = SCRATCH / "_bank_under_test.json"
    path.write_text(json.dumps(bank))
    try:
        result = subprocess.run(
            [sys.executable, str(SITE_FOLDER / "tools" / "validate_bank.py"),
             str(path)], capture_output=True, text=True)
    finally:
        path.unlink()
    return result.stdout


def test_validator_writer_rules():
    """The validator warns about loaded wording, double questions,
    two-option mcq, undefined terms and idea order."""
    print("Validator writer rules")
    bank = json.loads(json.dumps(BOOK))
    first = bank["questions"][1]
    first["q"] = "Why is this obviously so? And what is \"flux\"?"
    bank["questions"][2]["kind"] = "mcq"
    bank["questions"][2]["options"] = ["A", "B"]
    bank["concepts"][0].pop("question")
    bank["concepts"][0]["card"].pop("limits")
    for concept in bank["concepts"]:
        concept["core"] = True
    out = run_validator(bank)
    for needle, label in (
            ("loaded wording", "loaded words are flagged"),
            ("two questions in one stem", "two questions are flagged"),
            ("smuggle", "a loaded 'Why is it so' is flagged"),
            ("two-option mcq", "a two-option mcq is flagged"),
            ("'flux' is not defined", "an undefined quoted term is flagged"),
            ("no orienting question", "a missing orienting question"),
            ("card.limits missing", "missing limits are flagged"),
            ("are core", "too many core ideas are flagged")):
        check(label, needle in out, out[-400:])
    tags = json.loads(SCRATCH.parent.joinpath(
        "htrab", "tags.json").read_text())
    judge = json.loads(json.dumps(HTRAB_BANK))
    for concept in judge["concepts"]:
        if concept["id"] == "suspending-judgment":
            concept["requires"] = []
    out = run_validator(judge)
    check("a criticism idea with no understanding idea is flagged",
          "understand before judging" in out, out[-300:])
    judge["concepts"][0]["htrab"] = "analytical/nope/nope"
    out = run_validator(judge)
    check("an unknown HTRAB tag is an error", "ERROR" in out
          and "not in htrab/tags.json" in out, out[-300:])
    check("the tag file lists the levels",
          [level["id"] for level in tags["levels"]][:4]
          == ["elementary", "inspectional", "analytical", "syntopical"])


def test_new_bank_fields_show(browser):
    """The orienting question, limits, core chip, summaries and the
    days-practised count appear."""
    print("M3 home screen and card")
    page = open_page(browser)
    check("the book summary sentence is shown",
          BOOK["summary"] in page.inner_text("#book-blurb"))
    row = open_concept(page, 0)
    check("the idea row shows its reading question",
          "Read to answer" in row.inner_text())
    check("the idea row marks core ideas",
          row.locator(".core-chip").count() == 1)
    check("the card says where the rule stops working",
          "Where it stops working" in row.inner_text())
    check("the unit summary is shown above the ideas",
          BOOK["unitSummaries"]["Lesson 1"]
          in page.inner_text("#where-you-stand"))
    check("the streak shows days practised",
          "practised" in page.inner_text("#day-streak"))
    page.click("#confidence-choice button[data-value='off']")
    page.click("#keep-going-button")
    check("the card step starts with the reading question",
          page.is_visible("#question-card"))
    seen = []
    for _ in range(3):
        step = current_step(page)
        seen.append(step)
        if step["kind"] == "lesson":
            check("the card step shows the orienting question",
                  page.is_visible(".idea-question"))
            check("the card step shows its limits",
                  page.is_visible(".idea-limits"))
            break
        answer_question(page, step, True)
        page.keyboard.press("Enter")
    check("no page errors", not page.errors, "; ".join(page.errors))
    page.close()


def test_results_are_gentle(browser):
    """Results lead with what went right, use 'Needs work', and show an
    average with a noise reminder after two sessions."""
    print("Results wording")
    page = open_page(browser)
    page.click("#confidence-choice button[data-value='off']")
    page.click("#keep-going-button")
    play_learn_session(page, answer_wrongly=True)
    text = page.inner_text(".result")
    check("a poor session says Needs work, not Fail",
          "NEEDS WORK" in text.upper() and "FAIL" not in text.upper(),
          text[:200])
    check("the tally says Not yet", "Not yet" in text)
    check("no 'Missed' label on the tally", "MISSED" not in
          page.inner_text(".score-tally").upper())
    check("no average on the first session",
          not page.is_visible(".average-note"))
    page.click("text=Back to start")
    page.click("#keep-going-button")
    play_learn_session(page)
    check("what went right comes before the question list",
          page.is_visible(".went-right"))
    order = page.evaluate(
        "() => { const r = document.querySelector('.result');"
        " const a = r.querySelector('.went-right');"
        " const b = r.querySelector('.revisit-list');"
        " return !b || (a.compareDocumentPosition(b) & 4) > 0; }")
    check("what went right is listed first", order)
    check("an average of recent sessions is shown with a caution",
          "noisy" in page.inner_text(".average-note"),
          page.inner_text(".result")[:300])
    check("the history shows Needs work too",
          "Needs work" in page.inner_text("#recent-results")
          or "Needs work" in page.inner_text("body"))
    page.close()


def test_weak_part_and_easy_ending(browser):
    """A shaky part of an idea is named with a button that practises just
    it; a session ends on an easy review."""
    print("Weak part and easy ending")
    page = open_page(browser)
    page.click("#confidence-choice button[data-value='off']")
    page.click("#keep-going-button")
    play_learn_session(page, answer_wrongly=True)
    page.click("text=Back to start")
    row = open_concept(page, 0)
    check("the idea names where it breaks",
          row.locator(".concept-weak").count() == 1, row.inner_text()[-300:])
    row.get_by_text("Practise the weak part").click()
    steps = page.evaluate(
        "() => window.RecallQuiz.session.state.questions.map(q => q.role)")
    check("it practises only questions from the ideas's weak part",
          0 < len(steps) < 6 and "pretest" not in steps, str(steps))
    page.click("text=End session")
    page.evaluate("""() => {
      const quiz = window.RecallQuiz;
      const q = quiz.progress.saved.questions;
      ['remainders-1', 'remainders-2'].forEach(id => {
        q[id] = { memoryLevel: 3, timesSeen: 3, timesMissed: 0,
          nextReview: Date.now() + 864e5, lastAnswered: Date.now(),
          confidentMisses: 0 };
      });
      quiz.progress.saveProgress();
    }""")
    plan = page.evaluate(
        "() => { const p = window.RecallQuiz.settings.chooseKeepGoing();"
        " return p.questions.map(q => [q.id, !!q.isEasyEnding]); }")
    check("the plan ends with one easy review",
          bool(plan) and plan[-1][1], str(plan[-3:]))
    check("no page errors", not page.errors, "; ".join(page.errors))
    page.close()


def test_five_minute_session(browser):
    """The 5-minute session teaches core ideas only."""
    print("5-minute session")
    page = open_page(browser)
    core = {c["id"] for c in BOOK["concepts"] if c.get("core")}
    page.click("#confidence-choice button[data-value='off']")
    page.click("#quick-session-button")
    seen = play_learn_session(page)
    ideas = {step["concept"] for step in seen}
    check("only core ideas are taught", ideas <= core, str(ideas))
    check("it is a short session", len(seen) <= 10, str(len(seen)))
    page.close()


def htrab_session_matches(page, prefix):
    """True if every question in the running session carries a tag that
    starts with this prefix."""
    return page.evaluate(
        "(prefix) => window.RecallQuiz.session.state.questions"
        ".every(q => (q.htrab || '').startsWith(prefix))", prefix)


def test_htrab_overlay(browser):
    """The HTRAB switch, picker, filtered test, chips and advice."""
    print("HTRAB overlay")
    page = open_page(browser)
    check("a bank without tags shows no HTRAB switch",
          page.locator(".htrab-switch").count() == 0)
    page.close()

    page = open_page(browser, bank="how-to-read-a-book")
    check("a tagged bank has an HTRAB switch in Settings",
          page.locator(".htrab-switch").count() == 1)
    check("the picker is hidden while the method is off",
          not page.is_visible("#htrab-level"))
    page.click("#keep-going-button")
    page.wait_for_selector("#question-card .question-meta")
    check("no reading-step chip while off",
          page.locator(".htrab-chip").count() == 0)
    page.click("text=End session")

    page.click(".htrab-switch button[data-value='on']")
    page.wait_for_selector("#htrab-level")
    page.wait_for_function(
        "document.querySelectorAll('#htrab-level option').length > 1")
    levels = page.eval_on_selector_all(
        "#htrab-level option", "o => o.map(x => x.value)")
    check("the level list holds only levels in the bank",
          levels == ["", "inspectional", "analytical"], str(levels))
    page.select_option("#htrab-level", "analytical")
    check("a stage list appears for the analytical level",
          page.is_visible("#htrab-stage"))
    stages = page.eval_on_selector_all(
        "#htrab-stage option", "o => o.map(x => x.value)")
    check("stages 1, 2 and 3 are offered", stages == ["", "1", "2", "3"],
          str(stages))
    page.select_option("#htrab-stage", "2")
    topics = page.eval_on_selector_all(
        "#htrab-topic option", "o => o.map(x => x.value)")
    check("the topic list narrows to the stage",
          topics == ["", "determining-an-authors-message"], str(topics))
    page.select_option("#htrab-topic", "determining-an-authors-message")
    page.select_option("#htrab-sub", "finding-the-propositions")
    count = page.inner_text("#htrab-count")
    expected = sum(1 for q in HTRAB_BANK["questions"]
                   if q.get("htrab", "").endswith("finding-the-propositions")
                   and q["role"] != "pretest")
    check("the count matches the tagged questions",
          count.startswith(str(expected)), f"{count} vs {expected}")
    page.click("#confidence-choice button[data-value='off']")
    page.click("#htrab-start")
    tag = ("analytical/determining-an-authors-message/"
           "finding-the-propositions")
    check("the test holds only questions with that tag",
          htrab_session_matches(page, tag))
    check("a reading-step chip is shown", page.is_visible(".htrab-chip"),
          page.inner_text(".question-meta"))
    step = current_step(page)
    answer_question(page, step, True)
    page.wait_for_selector("#question-card .verdict")
    check("feedback shows Adler's advice for the step",
          page.is_visible(".htrab-advice summary"))
    advice = page.inner_text(".htrab-advice")
    check("the advice has an action, a check and a quote",
          "Ask yourself" in advice and "“" in advice, advice[:200])
    check("a missed question opens the advice",
          page.eval_on_selector(".htrab-advice", "d => d.open"))
    page.click("text=End session")
    page.click(".htrab-switch button[data-value='off']")
    check("switching off hides the picker", not page.is_visible("#htrab-level"))
    page.reload()
    page.wait_for_selector("#book-title:not(:text-is('Recall Quiz'))")
    check("it stays off after a reload",
          not page.is_visible("#htrab-level"))
    page.click(".htrab-switch button[data-value='on']")
    page.reload()
    page.wait_for_selector("#book-title:not(:text-is('Recall Quiz'))")
    page.wait_for_selector("#htrab-level")
    check("being on is remembered after a reload",
          page.is_visible("#htrab-level"))
    page.click(".htrab-switch button[data-value='off']")
    page.click("#settings-button")
    check("the home switch never changes the saved HTRAB default",
          page.get_attribute(".htrab-default button[data-value='off']",
                             "aria-pressed") == "true")
    page.click(".htrab-default button[data-value='on']")
    page.click("#settings-button")
    check("setting the default on switches the home screen on",
          page.get_attribute(".htrab-switch button[data-value='on']",
                             "aria-pressed") == "true"
          and page.is_visible("#htrab-level"))
    page.click("#confidence-choice button[data-value='off']")
    page.click("#keep-going-button")
    for _ in range(8):
        step = current_step(page)
        if step["kind"] == "lesson":
            break
        answer_question(page, step, True)
        page.wait_for_selector("#question-card .verdict")
        page.keyboard.press("Enter")
        page.wait_for_timeout(80)
    page.wait_for_selector("#question-card .idea-card")
    check("the concept card shows the reading step and Adler's advice",
          page.is_visible(".htrab-chip") and page.is_visible(".htrab-advice"))
    check("no page errors", not page.errors, "; ".join(page.errors))
    page.close()


def test_htrab_is_removable(browser):
    """With the htrab/ files unreachable the quiz still works."""
    print("HTRAB removable")
    page = open_page(browser, block="**/htrab/**")
    check("the quiz still opens", page.is_visible("#keep-going-button"))
    check("no HTRAB panel without the module",
          page.locator(".htrab-switch").count() == 0)
    page.click("#confidence-choice button[data-value='off']")
    page.click("#keep-going-button")
    play_learn_session(page)
    check("a whole session works", page.is_visible(".result"))
    check("no page errors", not page.errors, "; ".join(page.errors))
    page.close()
    page = open_page(browser, bank="how-to-read-a-book",
                     block="**/htrab/**")
    check("a tagged bank still plays without the module",
          page.is_visible("#keep-going-button"))
    check("no switch appears", page.locator(".htrab-switch").count() == 0)
    page.close()


def main():
    """Start a web server, run every test, and report."""
    server = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(PORT)],
        cwd=SITE_FOLDER, stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL)
    time.sleep(1)
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch()
            test_every_linked_file_exists()
            test_firebase_sync_is_on_in_this_edition()
            test_every_question_is_well_formed()
            test_bank_passes_the_validator()
            test_keep_going_teaches_the_next_idea(browser)
            test_any_order(browser)
            test_review_includes_unseen_ideas(browser)
            test_second_keep_going_reviews_first(browser)
            test_sync_bar_appears_when_turned_on(browser)
            test_validator_writer_rules()
            test_new_bank_fields_show(browser)
            test_results_are_gentle(browser)
            test_weak_part_and_easy_ending(browser)
            test_five_minute_session(browser)
            test_htrab_overlay(browser)
            test_htrab_is_removable(browser)
            test_every_question_type(browser)
            test_confidence_check(browser)
            test_timed_session(browser)
            test_question_timer_runs_out(browser)
            test_old_progress_is_upgraded(browser)
            test_backup_without_version_keeps_progress(browser)
            test_book_labels(browser)
            test_sanskrit_answers(browser)
            test_formulas(browser)
            test_themes(browser)
            test_home_views(browser)
            test_theme_follows_the_account(browser)
            test_home_layout(browser)
            test_phone_width(browser)
            browser.close()
    finally:
        server.kill()
    print()
    if failures:
        print(f"{len(failures)} check(s) failed.")
        sys.exit(1)
    print("All checks passed.")


if __name__ == "__main__":
    main()
