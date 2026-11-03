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
import make_book_index  # noqa: E402

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


OPEN_SECTIONS_SCRIPT = """
document.addEventListener('click', (event) => {
  if (!event.target.closest('#settings-button')) return;
  setTimeout(() => {
    if (!document.body.classList.contains('in-settings')) return;
    document.querySelectorAll('#settings-screen details.settings-section')
      .forEach((section) => { section.open = true; });
  }, 0);
}, true);
"""


# A saved layout that shows every control and opens every panel, so most
# tests can reach what they click. The fresh defaults hide and fold them.
LEGACY_LAYOUT = (
    '{show: {keepGoing: true, timer: true, confidence: true, htrab: true,'
    ' quick: true}, confidence: true, progress: "open", recent: "open",'
    ' stand: "open", chapters: "next", customStart: "auto"}')


def open_page(browser, questions=None, book=None, width=430, bank=None,
              block=None, view="ideas", keep_going=True,
              open_sections=True, sync_config=None, init_script=None):
    """Open the quiz, optionally with a made-up questions.json, a bank
    from banks/ (bank="how-to-read-a-book") or some files blocked.

    The fresh defaults (js/default-settings.js) hide Keep me going, the
    timer, the confidence check, HTRAB and the 5-minute button, and fold
    the home panels. Most tests need those controls, so by default the
    page opens with a saved record for the book (only if the book has none
    yet) that shows them and opens the panels (LEGACY_LAYOUT). Pass
    keep_going=False to see the real fresh defaults.

    Settings sections start folded on every visit, so most tests open
    them all as the screen opens. Pass open_sections=False to see the
    sections folded."""
    page = browser.new_page(viewport={"width": width, "height": 900})
    page.errors = []
    page.on("pageerror", lambda error: page.errors.append(str(error)))
    page.on("dialog", lambda dialog: dialog.accept())
    page.route("**/fonts.googleapis.com/**", lambda route: route.abort())
    page.route("**/js/sync/sync-config.js", lambda route: route.fulfill(
        content_type="application/javascript",
        body=sync_config
        or 'window.RecallQuizSyncConfig = {provider: "none"};'))
    if init_script:
        page.add_init_script(init_script)
    if open_sections:
        page.add_init_script(OPEN_SECTIONS_SCRIPT)
    if view:
        # Most tests click ideas straight under a chapter (ideas view).
        page.add_init_script(
            f"localStorage.setItem('recall-quiz-home-view', '{view}')")
    if block:
        page.route(block, lambda route: route.abort())
    served = dict(book or BOOK)
    if questions is not None:
        served["questions"] = questions
    if keep_going:
        book_id = served.get("id", "book")
        if bank:
            bank_file = SITE_FOLDER / "banks" / f"{bank}.json"
            book_id = json.loads(bank_file.read_text()).get("id", "book")
        key = "recall-quiz-book:" + book_id
        page.add_init_script(
            f"if (!localStorage.getItem('{key}')) localStorage.setItem("
            f"'{key}', JSON.stringify({{version: 2, layout: "
            f"{LEGACY_LAYOUT}, flags: {{}}, ideaFlags: {{}}}}))")
    page.route("**/questions.json", lambda route: route.fulfill(json=served))
    page.goto(PAGE_URL + (f"?bank=banks/{bank}.json" if bank else ""))
    page.wait_for_selector("#book-title:not(:text-is('Recall Quiz'))")
    return page


def start_session(page, confidence=False, timed=False):
    """Pick "Everything", all questions, and press Start."""
    if not page.eval_on_selector("#custom-practice", "d => d.open"):
        page.click("#custom-practice summary")
    page.click("#question-filter-choice button[data-value='all']")
    off_button = "#confidence-choice button[data-value='off']"
    if not confidence and page.is_visible(off_button):
        page.click(off_button)
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


def test_verse_study_card(browser):
    """A card with verse, word and study blocks shows lines, tappable word
    chips and its own colour, different from the accent."""
    print("Verse-study card")
    book = json.loads(json.dumps(BOOK))
    card = book["concepts"][0]["card"]
    card["blocks"] = [
        {"label": "Verse", "study": True,
         "lines": ["दीर्घं जीवितम्", "इन्द्रमुग्रतपा"]},
        {"label": "Words", "study": True,
         "words": [[{"w": "दीर्घम्", "gloss": "long", "gram": "n. acc. sg."}],
                   [{"w": "इन्द्रम्", "gloss": "Indra", "gram": "m. acc."}]]},
        {"label": "Plain", "text": "x"}]
    page = open_page(browser, book=book)
    concept = book["concepts"][0]["id"]
    page.evaluate("(id) => document.querySelector(`.concept-row"
                  "[data-concept-id='${id}']`).open = true", concept)
    check("verse lines are shown one per line",
          page.locator(".verse-line").count() == 2)
    check("word chips are shown, one row per line",
          page.locator(".word-row").count() == 2
          and page.locator(".word-chip").count() == 2)
    chip = page.locator(".word-chip").first
    check("the grammar is hidden until the chip is tapped",
          not chip.locator(".word-gram").is_visible())
    chip.click()
    check("tapping a chip shows its grammar",
          chip.locator(".word-gram").is_visible()
          and chip.get_attribute("aria-expanded") == "true")
    page.click(".grammar-toggle")
    check("the grammar button opens every chip",
          page.locator(".word-chip.is-open").count() == 2
          and page.get_attribute(".grammar-toggle", "aria-pressed") == "true")
    page.click(".grammar-toggle")
    check("and closes them again",
          page.locator(".word-chip.is-open").count() == 0)
    study = page.eval_on_selector(
        ".idea-block.is-study", "e => getComputedStyle(e).backgroundColor")
    plain = page.eval_on_selector(
        ".idea-block:not(.is-study)",
        "e => getComputedStyle(e).backgroundColor")
    check("study blocks have their own background", study != plain,
          f"{study} vs {plain}")
    check("no errors", not page.errors, "; ".join(page.errors))
    page.close()


SANSKRIT_BLOCKS = [
    {"label": "Reference", "key": "ref", "text": "Charaka, Su. 1"},
    {"label": "Verse", "key": "verse", "study": True,
     "lines": ["दीर्घं जीवितम्"]},
    {"label": "Words", "key": "words", "study": True,
     "words": [[{"w": "दीर्घम्", "gloss": "long", "gram": "n. acc."}]]},
    {"label": "Hindi", "key": "hindi", "study": True, "text": "लम्बा जीवन"},
    {"label": "English", "key": "english", "study": True,
     "text": "a long life"},
    {"label": "Explanation", "key": "explain", "study": True,
     "text": "why it matters"},
    {"label": "Aids", "key": "aids", "study": True, "aids": [
        {"aid": "chain", "label": "Chain", "steps": ["a", "b", "c"]},
        {"aid": "story", "label": "Story", "text": "a short story",
         "image": {"src": "images/aids/none.svg",
                   "alt": "a small picture of a story"}}]},
    {"label": "Note", "key": "note", "text": "spelling note"}]
VISIBLE_ITEMS = ("(selector) => Array.from(document.querySelectorAll("
                 "selector)).filter(e => getComputedStyle(e).display "
                 "!== 'none').map(e => e.dataset.part || e.dataset.aid)")


def sanskrit_book():
    """A copy of the test book whose first card is a Sanskrit card."""
    book = json.loads(json.dumps(BOOK))
    book["concepts"][0]["card"]["blocks"] = json.loads(
        json.dumps(SANSKRIT_BLOCKS))
    return book


def test_study_aids(browser):
    """Memory aids show on a card; Settings can switch each kind off, all
    are on at first, and the choice is saved with the book settings."""
    print("Memory aids and the Sanskrit settings card")
    book = sanskrit_book()
    page = open_page(browser, book=book)
    concept = book["concepts"][0]["id"]
    page.evaluate("(id) => document.querySelector(`.concept-row"
                  "[data-concept-id='${id}']`).open = true", concept)
    check("every aid is shown at first",
          page.locator(".aid-item:visible").count() == 2)
    check("a picture is drawn with its alt text",
          page.get_attribute(".aid-item[data-aid='story'] img.aid-image",
                             "alt") == "a small picture of a story")
    check("steps are drawn as a chain",
          page.locator(".aid-steps li").count() == 3)
    page.click("#settings-button")
    check("the Sanskrit section is shown for a book with such cards",
          page.is_visible("#sanskrit-section"))
    check("the Sanskrit section lists every kind",
          page.locator("#sanskrit-aids-list .choice-group").count() == 13)
    check("and every part of the card",
          page.locator("#sanskrit-parts-list .choice-group").count() == 8)
    check("it starts with all on",
          page.inner_text("#sanskrit-section-current") == "All on")
    page.click("#sanskrit-aids-list [data-sanskrit='aid:chain'] "
               "button[data-value='hide']")
    check("hiding a kind hides it on the card at once",
          page.evaluate(VISIBLE_ITEMS, ".aid-item") == ["story"])
    check("the summary counts what is on",
          page.inner_text("#sanskrit-section-current") == "20 of 21 on")
    page.click("#sanskrit-aids-list [data-sanskrit='aid:story'] "
               "button[data-value='hide']")
    check("a block with every aid hidden disappears",
          page.evaluate("getComputedStyle(document.querySelector("
                        "'.aid-block')).display") == "none")
    record = page.evaluate(
        "() => JSON.parse(localStorage.getItem('recall-quiz-book:' + "
        "RecallQuiz.book.bookId()))")
    check("the choice is saved in the book settings (version 3)",
          record["version"] == 3
          and sorted(record["sanskrit"]["off"])
          == ["aid:chain", "aid:story"] and record["sanskrit"]["at"] > 0,
          str(record.get("sanskrit")))
    page.click("#sanskrit-aids-all")
    check("Show all aids switches every kind back on",
          len(page.evaluate(VISIBLE_ITEMS, ".aid-item")) == 2
          and page.inner_text("#sanskrit-section-current") == "All on")
    check("no errors", not page.errors, "; ".join(page.errors))
    page.close()


def test_sanskrit_parts_and_font(browser):
    """Every part of a Sanskrit card can be switched off; the verse font
    can be chosen; both survive a reload; an old aid choice is moved."""
    print("Sanskrit cards: parts, verse font, old choice")
    book = sanskrit_book()
    concept = book["concepts"][0]["id"]
    page = open_page(browser, book=book)
    page.evaluate("(id) => document.querySelector(`.concept-row"
                  "[data-concept-id='${id}']`).open = true", concept)
    parts = page.evaluate(VISIBLE_ITEMS, ".idea-block[data-part]")
    check("all eight parts show at first", len(parts) == 8, str(parts))
    page.click("#settings-button")
    for part in ("hindi", "english", "note"):
        page.click("#sanskrit-parts-list [data-sanskrit='part:" + part
                   + "'] button[data-value='hide']")
    parts = page.evaluate(VISIBLE_ITEMS, ".idea-block[data-part]")
    check("switched-off parts disappear from the card",
          parts == ["ref", "verse", "words", "explain", "aids"], str(parts))
    page.click("#sanskrit-parts-list [data-sanskrit='part:aids'] "
               "button[data-value='hide']")
    check("hiding the aids part hides the whole aids block",
          "aids" not in page.evaluate(VISIBLE_ITEMS,
                                      ".idea-block[data-part]"))
    page.select_option("#sanskrit-font-choice", "kalam")
    check("the preview shows sample text in that font",
          page.locator("#sanskrit-font-preview .font-preview-row").count()
          == 3 and "Kalam" in page.evaluate(
              "getComputedStyle(document.querySelector("
              "'#sanskrit-font-preview span')).fontFamily"))
    font = page.evaluate("document.documentElement.style"
                         ".getPropertyValue('--font-verse')")
    check("the verse font is set", "Kalam" in font, font)
    verse_font = page.evaluate(
        "getComputedStyle(document.querySelector('.verse-line')).fontFamily")
    check("the verse text uses it", "Kalam" in verse_font, verse_font)
    page.reload()
    page.wait_for_selector("#where-you-stand .unit-progress",
                           state="attached")
    check("the font is kept after a reload",
          "Kalam" in page.evaluate("document.documentElement.style"
                                   ".getPropertyValue('--font-verse')"))
    check("so are the hidden parts",
          page.evaluate("document.documentElement.getAttribute("
                        "'data-hide-parts')") == "hindi english aids note"
          or sorted(page.evaluate("document.documentElement.getAttribute("
                                  "'data-hide-parts')").split())
          == ["aids", "english", "hindi", "note"])
    page.click("#settings-button")
    page.click("#sanskrit-parts-all")
    page.select_option("#sanskrit-font-choice", "")
    check("Show all parts and Theme font reset the card",
          page.inner_text("#sanskrit-section-current") == "All on"
          and page.evaluate("document.documentElement.style"
                            ".getPropertyValue('--font-verse')") == "")
    check("no errors", not page.errors, "; ".join(page.errors))
    page.close()

    page = open_page(browser, book=book, init_script=(
        "if (!localStorage.getItem('moved')) {"
        " localStorage.setItem('moved', '1');"
        " localStorage.setItem('recall-quiz-aids:" + book["id"]
        + "', JSON.stringify({v: 1, off: ['pegs']})); }"))
    off = page.evaluate("() => RecallQuiz.bookSettings.readSanskrit().off")
    check("an old local aid choice is moved into the settings",
          off == ["aid:pegs"], str(off))
    page.close()


def test_sanskrit_section_hidden_without_cards(browser):
    """A book with no Sanskrit cards never shows the section."""
    print("Sanskrit section only for Sanskrit books")
    page = open_page(browser)
    page.click("#settings-button")
    check("the section is hidden", not page.is_visible("#sanskrit-section"))
    page.close()


def test_sanskrit_choice_syncs(browser):
    """The Sanskrit choice goes to the account and comes back from it."""
    print("Sanskrit cards: account sync")
    page = open_synced_page(browser)
    page.wait_for_selector("#account-body .button-row button",
                           state="attached")
    page.evaluate("() => RecallQuiz.bookSettings.saveSanskrit("
                  "{off: ['part:hindi', 'aid:pegs'], font: 'baloo'})")
    page.wait_for_function(
        "(key) => { const t = sessionStorage.getItem(key);"
        " return t && JSON.parse(t).sanskrit"
        " && JSON.parse(t).sanskrit.off.length === 2; }",
        arg=SETTINGS_STORE_KEY, timeout=8000)
    doc = page.evaluate("(key) => JSON.parse(sessionStorage.getItem(key))",
                        SETTINGS_STORE_KEY)
    check("the choice is saved to the account (version 3)",
          doc["v"] == 3 and doc["sanskrit"]["font"] == "baloo"
          and doc["sanskrit"]["off"] == ["part:hindi", "aid:pegs"],
          str(doc)[:200])
    page.close()

    newer = {"v": 3, "layout": {}, "flags": {}, "ideaFlags": {},
             "sanskrit": {"off": ["part:note"], "font": "kalam",
                          "at": 4102444800000}}
    page = browser.new_page(viewport={"width": 430, "height": 900})
    page.errors = []
    page.on("pageerror", lambda error: page.errors.append(str(error)))
    page.route("**/fonts.googleapis.com/**", lambda route: route.abort())
    page.route("**/js/sync/sync-config.js", lambda route: route.fulfill(
        content_type="application/javascript",
        body='window.RecallQuizSyncConfig = {provider: "example-in-browser",'
             ' saveDelaySeconds: 1, "example-in-browser": {}};'))
    page.add_init_script(
        "if (!sessionStorage.getItem('seeded')) {"
        "sessionStorage.setItem('recall-quiz-example-account', "
        "'example-user');sessionStorage.setItem('" + SETTINGS_STORE_KEY
        + "', JSON.stringify(" + json.dumps(newer) + "));"
        "sessionStorage.setItem('seeded', '1'); }")
    page.goto(PAGE_URL)
    page.wait_for_selector("#book-title:not(:text-is('Recall Quiz'))")
    page.wait_for_function(
        "() => RecallQuiz.bookSettings.readSanskrit().font === 'kalam'",
        timeout=8000)
    local = page.evaluate("() => RecallQuiz.bookSettings.readSanskrit()")
    check("a newer account choice is used here",
          local["off"] == ["part:note"], str(local))
    check("no errors", not page.errors, "; ".join(page.errors))
    page.close()


def test_scroll_buttons_are_gone(browser):
    """The jump buttons were replaced by the bar; a book that still asks
    for them is not an error and gets nothing."""
    print("No jump to top / bottom buttons")
    book = json.loads(json.dumps(BOOK))
    book["scrollButtons"] = True
    page = open_page(browser, book=book)
    check("a book that asks gets no buttons",
          page.locator(".scroll-jump").count() == 0)
    check("no errors", not page.errors, "; ".join(page.errors))
    page.close()


def test_title_bar_home(browser):
    """The bar on the home screen and its two drawers."""
    print("Title bar: home screen")
    page = open_page(browser, view="structure")
    check("the bar shows the book name",
          page.inner_text(".title-bar h1") == BOOK["book"])
    page.evaluate("document.body.style.minHeight = '6000px'")
    page.evaluate("window.scrollTo(0, 800)")
    top = page.eval_on_selector(
        ".title-bar", "e => e.getBoundingClientRect().top")
    check("the bar stays at the top while the page scrolls", top == 0,
          str(top))
    page.evaluate("window.scrollTo(0, 0)")
    page.click("#contents-button")
    rows = page.locator("#contents-drawer-list .drawer-row")
    check("the left drawer lists chapters and topics",
          rows.count() >= 3 and page.locator(
              "#contents-drawer-list .is-chapter").count() ==
          len({q["unit"] for q in BOOK["questions"]}))
    first_topic = page.locator("#contents-drawer-list .is-topic").first
    check("chapters start closed (no topic is shown)",
          not first_topic.is_visible())
    toggle = page.locator("#contents-drawer-list .drawer-toggle").first
    toggle.click()
    check("the chevron opens a chapter", first_topic.is_visible())
    check("and says so for screen readers",
          toggle.get_attribute("aria-expanded") == "true")
    toggle.click()
    check("it closes again", not first_topic.is_visible())
    page.click("#contents-drawer-list .drawer-tools button >> nth=0")
    check("Open all opens every chapter", first_topic.is_visible())
    page.click("#contents-drawer-list .drawer-tools button >> nth=1")
    check("Close all closes them", not first_topic.is_visible())
    page.click("#contents-drawer-list .drawer-tools button >> nth=0")
    topic_name = first_topic.inner_text()
    first_topic.click()
    check("tapping a topic closes the drawer",
          not page.is_visible("#contents-drawer"))
    check("and opens that topic on the home screen",
          page.eval_on_selector_all(
              "#where-you-stand .section-row",
              "(rows, name) => rows.some(r => r.dataset.section === name"
              " && r.open)", topic_name))
    page.click("#ideas-button")
    check("idea chapters start closed",
          not page.locator("#ideas-drawer-list .is-idea").first.is_visible())
    page.click("#ideas-drawer-list .drawer-tools button >> nth=0")
    chips = page.locator("#ideas-drawer-list .status-chip")
    check("the right drawer lists ideas with status chips",
          chips.count() == len(BOOK["concepts"]), str(chips.count()))
    page.locator("#ideas-drawer-list .is-idea").nth(1).click()
    check("tapping an idea opens it on the home screen",
          page.locator("#where-you-stand .concept-row[open]").count() >= 1)
    page.click("#contents-button")
    page.keyboard.press("Escape")
    check("Escape closes a drawer", not page.is_visible("#contents-drawer"))
    check("no errors", not page.errors, "; ".join(page.errors))
    page.close()


def test_title_bar_session(browser):
    """The bar and the session list during a session."""
    print("Title bar: in a session")
    page = open_page(browser)
    start_session(page)
    step = current_step(page)
    check("the bar shows the topic of the question",
          page.inner_text("#title-bar-topic") == step["section"])
    check("and the chapter above it",
          step["unit"] in page.text_content("#title-bar-kicker"))
    check("the book name is hidden while a question shows",
          not page.is_visible(".title-bar h1"))
    bar_bottom = page.eval_on_selector(
        ".title-bar", "e => e.getBoundingClientRect().bottom")
    pill_top = page.eval_on_selector(
        "#session-pill", "e => e.getBoundingClientRect().top")
    check("the pill sits under the bar", pill_top >= bar_bottom,
          f"{pill_top} < {bar_bottom}")
    page.click("#ideas-button")
    steps = page.evaluate(
        "window.RecallQuiz.session.state.questions.length")
    rows = page.locator("#ideas-drawer-list .is-step")
    check("the right drawer lists every step", rows.count() == steps,
          f"{rows.count()} != {steps}")
    check("the step on screen is marked",
          page.locator("#ideas-drawer-list .is-step.is-current").count() == 1)
    last = rows.nth(steps - 1)
    last.click()
    index = page.evaluate("window.RecallQuiz.session.state.currentIndex")
    check("tapping an unseen step jumps to it", index == steps - 1,
          str(index))
    check("no errors", not page.errors, "; ".join(page.errors))
    page.close()


def test_session_list_reviews_without_recording(browser):
    """An answered question opens read-only and is not recorded twice."""
    print("Title bar: answered questions are read-only")
    question = next(q for q in BOOK["questions"] if q["kind"] == "tf")
    others = [q for q in BOOK["questions"] if q["kind"] == "tf"][:3]
    page = open_page(browser, questions=others)
    start_session(page)
    first = current_step(page)
    answer_question(page, first, False)
    page.wait_for_selector("#question-card .verdict")
    page.keyboard.press("Enter")
    page.wait_for_function(
        "window.RecallQuiz.session.state.currentIndex === 1")
    page.click("#ideas-button")
    marks = page.locator("#ideas-drawer-list .drawer-mark").all_inner_texts()
    check("the answered step has a tick", marks[0] == "\u2713", str(marks))
    page.locator("#ideas-drawer-list .is-step").first.click()
    check("it opens with a read-only banner",
          page.is_visible("#question-card .review-banner"))
    check("with the verdict", page.is_visible("#question-card .verdict"))
    got = page.evaluate("window.RecallQuiz.session.state.score.got")
    check("looking again records nothing", got == 1, str(got))
    page.click("text=Back to the session")
    index = page.evaluate("window.RecallQuiz.session.state.currentIndex")
    check("Back returns to the question that was open", index == 1)
    check("no errors", not page.errors, "; ".join(page.errors))
    page.close()
    del question


def test_left_drawer_leaves_a_session(browser):
    """The left drawer asks before it leaves a session for the home
    screen, then scrolls there."""
    print("Title bar: leaving a session")
    page = open_page(browser)
    seen = []
    page.remove_listener("dialog", page.listeners("dialog")[0]) \
        if hasattr(page, "listeners") else None
    page.on("dialog", lambda dialog: seen.append(dialog.message))
    start_session(page)
    page.click("#contents-button")
    page.locator("#contents-drawer-list .is-chapter").first.click()
    check("it asks before leaving", "End this session?" in seen, str(seen))
    check("the home screen is back",
          page.is_visible("#where-you-stand") and
          not page.is_visible("#question-card"))
    page.close()


def swipe(page, move_x, move_y=0):
    """Send a one-finger swipe to the question card."""
    page.evaluate(
        """([moveX, moveY]) => {
          const card = document.getElementById("question-card");
          const send = (type, x, y) => {
            const event = new Event(type, { bubbles: true });
            const point = [{ clientX: x, clientY: y }];
            event.touches = type === "touchend" ? [] : point;
            event.changedTouches = point;
            card.dispatchEvent(event);
          };
          send("touchstart", 200, 300);
          send("touchend", 200 + moveX, 300 + moveY);
        }""", [move_x, move_y])


def test_session_navigation(browser):
    """Back, "Question n of N", Next and swipe in a session."""
    print("Session: Back, Next and swipe")
    three = [q for q in BOOK["questions"] if q["kind"] == "tf"][:3]
    page = open_page(browser, questions=three)
    start_session(page)
    state = "window.RecallQuiz.session.state"
    check("it says which question this is",
          page.inner_text("#question-card .step-nav-middle b") ==
          "Question 1 of 3")
    check("Back is off on the first question",
          page.is_disabled("#question-card .step-nav-button >> nth=0"))
    page.click("#question-card .step-nav-button >> nth=1")
    check("Next goes to the second question",
          page.evaluate(state + ".currentIndex") == 1)
    check("and the count follows",
          page.inner_text("#question-card .step-nav-middle b") ==
          "Question 2 of 3")
    swipe(page, -120)
    check("a swipe left goes to the next question",
          page.evaluate(state + ".currentIndex") == 2)
    check("Next is off on the last question",
          page.is_disabled("#question-card .step-nav-button >> nth=1"))
    swipe(page, 20, 160)
    check("a mostly vertical drag does nothing",
          page.evaluate(state + ".currentIndex") == 2)
    swipe(page, 40)
    check("a short swipe does nothing",
          page.evaluate(state + ".currentIndex") == 2)
    swipe(page, 120)
    check("a swipe right goes back",
          page.evaluate(state + ".currentIndex") == 1)
    page.click("#question-card .step-nav-button >> nth=1")
    answer_question(page, current_step(page), False)
    page.wait_for_selector("#question-card .verdict")
    page.keyboard.press("Enter")
    check("skipped questions come back after the last one",
          page.evaluate(state + ".currentIndex") == 0,
          str(page.evaluate(state + ".currentIndex")))
    page.click("#question-card .step-nav-button >> nth=1")
    check("an unanswered question is asked again",
          page.evaluate(state + ".currentIndex") == 1 and
          not page.is_visible("#question-card .review-banner"))
    page.click("#question-card .step-nav-button >> nth=1")
    check("an answered one opens read-only",
          page.is_visible("#question-card .review-banner"))
    check("with the same Back and Next",
          page.inner_text("#question-card .step-nav-middle b") ==
          "Question 3 of 3")
    got = page.evaluate(state + ".score.got")
    check("looking records nothing more", got == 1, str(got))
    check("the page scrolls up and down as usual",
          page.evaluate(
              "getComputedStyle(document.getElementById("
              "'question-card')).touchAction").startswith("pan-y"))
    check("no errors", not page.errors, "; ".join(page.errors))
    page.close()


def test_check_button_and_phone_bar(browser):
    """A button that cannot be used yet looks it; a long book name
    does not break the bar."""
    print("Disabled buttons and the bar on a phone")
    sorts = [q for q in BOOK["questions"] if q["kind"] == "sort"]
    page = open_page(browser, questions=sorts[:1], width=375)
    start_session(page)
    button = ".is-check"
    check("Check groups is disabled before anything is placed",
          page.is_disabled(button))
    opacity = page.eval_on_selector(
        button, "e => getComputedStyle(e).opacity")
    check("and looks disabled", float(opacity) < 0.6, opacity)
    chips = page.locator(".sort-pool .sort-chip").count()
    for _ in range(chips):
        page.click(".sort-pool .sort-chip >> nth=0")
        page.click(".sort-group-head >> nth=0")
    check("it works once every item is placed",
          not page.is_disabled(button))
    page.click(button)
    check("and checks the groups", page.is_visible("#question-card .verdict"))
    page.close()
    page = open_page(browser, width=375, view="structure")
    page.evaluate(
        "document.getElementById('book-title').textContent = "
        "'Essentialism: The Disciplined Pursuit of Less and More Again'")
    sideways = page.evaluate(
        "document.documentElement.scrollWidth - window.innerWidth")
    check("a long book name does not widen the page", sideways <= 0,
          str(sideways))
    right_edge = page.eval_on_selector(
        "#ideas-button", "e => e.getBoundingClientRect().right")
    check("the right button stays on screen", right_edge <= 375,
          str(right_edge))
    gap = page.evaluate(
        "document.getElementById('ideas-button').getBoundingClientRect()"
        ".left - document.querySelector('.title-bar-text')"
        ".getBoundingClientRect().right")
    check("the name does not run under the button", gap >= 0, str(gap))
    check("no errors", not page.errors, "; ".join(page.errors))
    page.close()


def test_reading_panel(browser):
    """The gear: font, spacing, colours, theme, footer buttons."""
    print("Reading settings (gear)")
    page = open_page(browser)
    check("the gear is in the corner",
          page.is_visible("#reading-gear"))
    page.click("#reading-gear")
    check("the panel opens", page.is_visible("#reading-panel"))
    titles = page.locator("#reading-panel h4").all_inner_texts()
    check("it has the reader's sections", titles == [
        "MODE", "THEME", "FONT SIZE", "FONT", "LINE SPACING",
        "PAGE WIDTH", "BACKGROUND", "TEXT COLOUR"] or titles == [
        "Mode", "Theme", "Font size", "Font", "Line spacing",
        "Page width", "Background", "Text colour"], str(titles))
    check("white is the first background swatch and is named",
          page.get_attribute(
              "#reading-panel .reading-swatches >> nth=0 >> "
              ".reading-swatch >> nth=0", "data-caption") == "White")
    page.fill("#reading-panel input[type=range]", "22")
    page.dispatch_event("#reading-panel input[type=range]", "input")
    size = page.evaluate(
        "getComputedStyle(document.documentElement).fontSize")
    check("the font size scales the page", size == "22px", size)
    page.click("#reading-panel .reading-choices >> nth=1 >> text=Sans")
    check("the font is switched",
          page.get_attribute("html", "data-reading-font") == "sans")
    page.click("#reading-panel .reading-choices >> nth=3 >> text=Wide")
    width = page.evaluate(
        "getComputedStyle(document.querySelector('main')).maxWidth")
    check("the page width changes", width == "960px", width)
    page.click("#reading-panel .reading-swatch[aria-label='Background "
               "#000000']")
    page_colour = page.evaluate(
        "getComputedStyle(document.body).backgroundColor")
    check("a dark page colour is applied",
          page_colour == "rgb(0, 0, 0)", page_colour)
    text_colour = page.evaluate("getComputedStyle(document.body).color")
    check("and the text turns light by itself",
          text_colour == "rgb(242, 242, 242)", text_colour)
    page.reload()
    page.wait_for_selector("#book-title:not(:text-is('Recall Quiz'))")
    check("the choices are kept for the book",
          page.evaluate("getComputedStyle(document.documentElement)"
                        ".fontSize") == "22px")
    page.click("#reading-gear")
    page.click("#reading-panel .reading-panel-foot .reading-reset")
    size = page.evaluate(
        "getComputedStyle(document.documentElement).fontSize")
    check("Reset goes back to the quiz's own look (17px on a phone)",
          size == "17px", size)
    labels = page.locator(
        "#reading-panel .reading-panel-foot button").all_inner_texts()
    check("the footer has Reset and Quiz home (no subject page here)",
          labels == ["Reset", "Quiz home"], str(labels))
    check("no errors", not page.errors, "; ".join(page.errors))
    page.close()


def test_reading_panel_theme_and_home(browser):
    """The theme row changes the theme; Quiz home leaves a session."""
    print("Reading settings: theme and Quiz home")
    page = open_page(browser)
    page.click("#reading-gear")
    tile = page.locator("#reading-panel .reading-theme").nth(2)
    theme_id = tile.get_attribute("data-theme-id")
    tile.click()
    page.wait_for_function(
        "id => document.documentElement.dataset.theme === id", arg=theme_id)
    check("a theme tile switches the theme", True)
    start_session(page)
    page.click("#reading-gear")
    page.click("#reading-panel .reading-panel-foot button >> text=Quiz home")
    page.wait_for_selector("#where-you-stand", state="visible")
    check("Quiz home returns to the home screen",
          not page.is_visible("#question-card"))
    check("no errors", not page.errors, "; ".join(page.errors))
    page.close()


READER_FOLDER = Path(__file__).resolve().parent / "_reader_book"
READER_URL = f"http://localhost:{PORT}/tests/_reader_book/read.html"
READER_PAGE = """<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Reader test</title>
<script src="/js/unlock.js"></script>
<link rel="stylesheet" href="/reader/style.css"></head><body>
<script>SubjectUnlock.ready().then(function () {
  return SubjectUnlock.loadScript("/reader/app.js");
});</script></body></html>
"""


def write_reader_book(key_bytes, extra_questions=0):
    """A tiny encrypted book (one chapter) in tests/_reader_book/, with
    extra_questions more true/false questions in its section."""
    sys.path.insert(0, str(SITE_FOLDER / "tools" / "book_build"))
    import encfmt
    chapter_folder = READER_FOLDER / "data" / "ch"
    chapter_folder.mkdir(parents=True, exist_ok=True)
    outline = [{"id": "s1", "title": "Remainders", "subs": [], "subCount": 0,
                "ideas": 1, "questions": 2, "figures": 0, "visuals": 0}]
    manifest = {
        "book": {"id": "reader-test", "title": "Reader Test Book",
                 "summary": "A tiny book.", "cover": None},
        "chapters": [{"prefix": "c01", "title": "Wrapping around",
                      "unit": "Lesson 1", "group": "Part 1", "sections": 1,
                      "ideas": 1, "questions": 2, "figures": 0,
                      "outline": outline}],
        "notesExtra": []}
    chapter = {
        "summary": "", "notesIntro": "", "media": [],
        "nodes": [{"id": "s1", "title": "Remainders", "level": 2,
                   "html": "<p>A clock has twelve positions.</p>",
                   "notes": "", "visuals": [], "ideas": ["i1"],
                   "questions": ["q1", "q2"]}],
        "ideas": {"i1": {"title": "Remainders and the clock",
                         "question": "What does the clock show?",
                         "card": {"blocks": [{"label": "Core",
                                              "text": "Only the remainder "
                                              "matters."}],
                                  "rule": "Divide by 12.", "limits": ""}}},
        "questions": [
            {"id": "q1", "kind": "mcq", "q": "27 hours after 10 o'clock?",
             "options": ["3", "13", "1", "10"], "answer": 0,
             "explain": "37 mod 12 is 1; the clock shows 1.", "ideaId": "i1",
             "role": "apply"},
            {"id": "q2", "kind": "tf", "q": "15 and 3 are the same place.",
             "answer": True, "explain": "", "ideaId": "i1",
             "role": "apply"}]}
    for number in range(extra_questions):
        chapter["questions"].append(
            {"id": f"x{number}", "kind": "tf", "q": f"Statement {number}.",
             "answer": True, "explain": "", "ideaId": "i1", "role": "apply"})
        chapter["nodes"][0]["questions"].append(f"x{number}")
    for path, data in (("data/manifest.enc", manifest),
                       ("data/ch/c01.enc", chapter)):
        blob = encfmt.encrypt(json.dumps(data).encode(), key_bytes)
        (READER_FOLDER / path).write_bytes(blob)
    (READER_FOLDER / "read.html").write_text(READER_PAGE)


def test_reader(browser):
    """The ereader wears the quiz themes and shares the reading settings."""
    print("Ereader: themes, gear, questions")
    import os
    import shutil
    key_bytes = os.urandom(32)
    write_reader_book(key_bytes)
    try:
        page = browser.new_page(viewport={"width": 430, "height": 900})
        page.errors = []
        page.on("pageerror", lambda error: page.errors.append(str(error)))
        page.route("**/fonts.googleapis.com/**", lambda route: route.abort())
        page.goto(READER_URL + "#key=" + key_bytes.hex())
        page.wait_for_selector("body[data-ready='1']", timeout=20000)
        check("the book home shows the chapter card",
              page.is_visible(".chcard"))
        check("the reader starts in the quiz's default theme",
              page.evaluate("document.documentElement.dataset.theme")
              == page.evaluate("RecallQuizDefaults.theme.id"))
        same_colour = page.evaluate("""() => {
          const probe = document.createElement('div');
          probe.style.background = 'var(--color-page)';
          document.body.appendChild(probe);
          const themed = getComputedStyle(probe).backgroundColor;
          probe.remove();
          return themed === getComputedStyle(document.body)
            .backgroundColor && themed !== 'rgba(0, 0, 0, 0)';
        }""")
        check("the page colour is the theme's page colour", same_colour)
        page.click("#reading-gear")
        check("the gear opens the shared panel",
              page.is_visible("#reading-panel"))
        titles = page.locator("#reading-panel h4").all_inner_texts()
        check("it has the shared sections and the ereader's Show",
              [t.lower() for t in titles] == [
                  "mode", "theme", "font size", "font", "line spacing",
                  "page width", "background", "text colour", "show"],
              str(titles))
        check("the Show section has four toggles",
              page.locator("#reading-panel .reading-toggle").count() == 4)
        labels = page.locator(
            "#reading-panel .reading-panel-foot button").all_inner_texts()
        check("the footer: Reset, Subject page, Book home",
              labels == ["Reset", "Subject page", "Book home"], str(labels))
        tile = page.locator("#reading-panel .reading-theme").nth(3)
        theme_id = tile.get_attribute("data-theme-id")
        tile.click()
        page.wait_for_function(
            "id => document.documentElement.dataset.theme === id",
            arg=theme_id)
        check("a theme tile re-colours the reader", True)
        page.fill("#reading-panel input[type=range]", "24")
        page.dispatch_event("#reading-panel input[type=range]", "input")
        check("font size is shared and applied",
              page.evaluate("getComputedStyle(document.documentElement)"
                            ".fontSize") == "24px")
        saved = page.evaluate(
            "localStorage.getItem('recall-quiz:reading:reader-test')")
        check("it is saved under the book's reading key",
              saved is not None and '"fontSize":24' in saved, str(saved))
        page.click("#reading-panel input[data-setting='ideas']")
        check("the Show toggles hide parts",
              page.evaluate("document.body.classList.contains('hide-ideas')"))
        page.click("#reading-panel .reading-panel-foot .reading-reset")
        check("Reset brings back the ereader's own look",
              page.evaluate("getComputedStyle(document.documentElement)"
                            ".fontSize") == "18px"
              and not page.evaluate(
                  "document.body.classList.contains('hide-ideas')"))
        page.click("#reading-gear")
        page.click(".chhead")
        page.click(".opench")
        page.wait_for_selector("section#s1 .slot.qs", timeout=10000)
        page.locator("section#s1 .slot.qs").scroll_into_view_if_needed()
        page.wait_for_selector(".qs-wrap", timeout=10000)
        order = page.evaluate(
            "(() => { const w = document.querySelector('.qs-wrap');"
            " return Array.from(w.children).map(c => c.className); })()")
        check("question navigation sits between progress and cards",
              order.index("q-progress") < order.index("q-nav")
              < order.index("q-track"), str(order))
        check("it says which question and how to move",
              "of" in page.inner_text(".q-nav") and
              "Swipe" in page.inner_text(".q-nav"))
        has_check = page.locator(".q-slide >> nth=0 >> text=Check answer")
        check("a multiple-choice question has a Check answer button",
              has_check.count() >= 1)
        first = page.locator(".q-slide").first
        first_text = first.inner_text()
        pick = "3" if "27 hours" in first_text else "True"
        first.locator(".opt", has_text=pick).first.click()
        check("choosing an option does not answer yet",
              first.locator(".fb").count() == 0)
        first.locator("button.btn", has_text="Check answer").click()
        check("Check answer shows the feedback",
              first.locator(".fb").count() == 1)
        check("no errors", not page.errors, "; ".join(page.errors))
        page.close()
    finally:
        shutil.rmtree(READER_FOLDER, ignore_errors=True)


def test_reader_many_questions(browser):
    """A section with hundreds of questions keeps the page as wide as the
    screen: the progress bar shrinks its segments instead of pushing the
    page wider (the text then looks small and off to one side)."""
    print("Ereader: a section with 212 questions on a phone")
    import os
    import shutil
    key_bytes = os.urandom(32)
    write_reader_book(key_bytes, extra_questions=210)
    try:
        page = browser.new_page(viewport={"width": 375, "height": 800})
        page.errors = []
        page.on("pageerror", lambda error: page.errors.append(str(error)))
        page.route("**/fonts.googleapis.com/**", lambda route: route.abort())
        page.goto(READER_URL + "#key=" + key_bytes.hex())
        page.wait_for_selector("body[data-ready='1']", timeout=20000)
        page.click(".chhead")
        page.click(".opench")
        page.wait_for_selector("section#s1 .slot.qs", timeout=10000)
        page.locator("section#s1 .slot.qs").scroll_into_view_if_needed()
        page.wait_for_selector(".qs-wrap", timeout=10000)
        check("the progress bar has a segment for every question",
              page.locator(".q-progress i").count() == 212)
        check("the progress bar fits inside its column",
              page.evaluate("(() => { const p = document.querySelector("
                            "'.q-progress'); return p.scrollWidth <= "
                            "p.clientWidth; })()"))
        check("the page does not scroll sideways",
              page.evaluate("document.documentElement.scrollWidth <= "
                            "window.innerWidth"))
        check("no errors", not page.errors, "; ".join(page.errors))
        page.close()
    finally:
        shutil.rmtree(READER_FOLDER, ignore_errors=True)


def test_book_defaults(browser):
    """A book can change its start-up theme with RecallQuizBookDefaults."""
    print("Book start-up defaults")
    page = open_page(browser, view=None, keep_going=False, init_script=(
        "window.RecallQuizBookDefaults = {theme: {id: 'parchment-verse'},"
        " homeLayout: {stand: 'open'}, nonsense: {a: 1}};"))
    theme = page.evaluate("document.documentElement"
                          ".getAttribute('data-theme')")
    check("the book's theme is used for a new reader",
          theme == "parchment-verse", str(theme))
    check("an unknown group is ignored",
          page.evaluate("RecallQuizDefaults.nonsense") is None)
    check("a layout default is changed",
          page.evaluate("RecallQuizDefaults.homeLayout.stand") == "open")
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
    page = open_page(browser, open_sections=False)
    page.click("#settings-button")
    check("Appearance is folded by default",
          not page.is_visible("#theme-tiles"))
    page.click("#appearance-section summary")
    groups = page.locator("#theme-tiles .theme-group").count()
    check("themes are in at least 8 groups", groups >= 8, str(groups))
    opened = page.locator("#theme-tiles .theme-group[open]").count()
    check("groups are folded by default", opened == 0, str(opened))
    all_tiles = page.evaluate(
        "() => document.querySelectorAll('#theme-tiles .theme-tile').length")
    check("tiles are hidden until a group opens",
          page.locator("#theme-tiles .theme-tile:visible").count() == 0)
    tile_count = all_tiles
    check("every theme folder has a tile in the picker",
          tile_count == len(theme_folders),
          f"{tile_count} tiles, {len(theme_folders)} folders")
    finance = page.evaluate("""() => [...document.querySelectorAll(
        '#theme-tiles .theme-group')].filter(g => g.textContent.trim()
        .startsWith('Finance')).map(g => g.querySelectorAll(
        '.theme-tile').length)""")
    check("a Finance group holds the 14 finance themes", finance == [14],
          str(finance))
    groups = page.evaluate("""() => [...document.querySelectorAll(
        '#theme-tiles .theme-group-name')].map(
        s => s.firstElementChild.textContent)""")
    check("the picker has the new theme groups",
          all(name in groups for name in (
              "Book styles", "Classroom", "Professional", "Finance")),
          str(groups))
    page.evaluate("""() => document.querySelector(
        ".theme-tile[data-theme-id='lego']").closest('details').open = true""")
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


# The synced page serves the real questions.json, so use its book id.
TEST_BOOK_ID = json.loads(
    (SITE_FOLDER / "questions.json").read_text()).get("id", "book")
SETTINGS_STORE_KEY = ("recall-quiz-example-store:example-user/"
                      "_settings:" + TEST_BOOK_ID)


def open_synced_page(browser, account_theme=None, local_theme=None,
                     account_layout=None, open_sections=False):
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
    if open_sections:
        page.add_init_script(OPEN_SECTIONS_SCRIPT)
    lines = ["sessionStorage.setItem('recall-quiz-example-account', "
             "'example-user');"]
    if account_theme:
        document = {"v": 1, "theme": account_theme}
        if account_layout:
            document["layout"] = account_layout
        lines.append(
            "sessionStorage.setItem('" + SETTINGS_STORE_KEY + "', "
            "JSON.stringify(" + json.dumps(document) + "));")
    elif account_layout:
        lines.append(
            "sessionStorage.setItem('" + SETTINGS_STORE_KEY + "', "
            "JSON.stringify({v: 1, layout: "
            + json.dumps(account_layout) + "}));")
    lines.append(
        "if (!localStorage.getItem('recall-quiz-book:" + TEST_BOOK_ID
        + "')) localStorage.setItem('recall-quiz-book:" + TEST_BOOK_ID
        + "', JSON.stringify({version: 2, layout: " + LEGACY_LAYOUT
        + ", flags: {}, ideaFlags: {}}));")
    if local_theme:
        lines.append("localStorage.setItem('recall-quiz:theme:"
                     + TEST_BOOK_ID + "', JSON.stringify("
                     + json.dumps(dict(local_theme, v=1)) + "));")
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
        "'" + SETTINGS_STORE_KEY + "');"
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
    finance = page.evaluate("""() => [...document.querySelectorAll(
        '#theme-tiles .theme-group')].filter(g => g.textContent.trim()
        .startsWith('Finance')).map(g => g.querySelectorAll(
        '.theme-tile').length)""")
    check("a Finance group holds the 14 finance themes", finance == [14],
          str(finance))
    groups = page.evaluate("""() => [...document.querySelectorAll(
        '#theme-tiles .theme-group-name')].map(
        s => s.firstElementChild.textContent)""")
    check("the picker has the new theme groups",
          all(name in groups for name in (
              "Book styles", "Classroom", "Professional", "Finance")),
          str(groups))
    page.evaluate("""() => document.querySelector(
        ".theme-tile[data-theme-id='lego']").closest('details').open = true""")
    page.click(".theme-tile[data-theme-id='lego']")
    page.wait_for_function(
        "sessionStorage.getItem('" + SETTINGS_STORE_KEY
        + "') !== null", timeout=8000)
    saved = account_theme(page)
    check("choosing a theme saves it to the account",
          saved and saved["t"] == "lego", str(saved))
    page.close()

    page = open_synced_page(
        browser,
        account_theme={"t": "classic", "m": "light", "a": 1000},
        local_theme={"t": "lego", "m": "dark", "a": 1900000000000})
    page.wait_for_function(
        "sessionStorage.getItem('" + SETTINGS_STORE_KEY
        + "').includes('lego')", timeout=8000)
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
    closed = page.locator(
        "#where-you-stand details:not([open]):not(.flag-bar)").count()
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
    closed = page.locator(
        "#where-you-stand details:not([open]):not(.flag-bar)").count()
    check("All open plus Open starts everything open", closed == 0,
          str(closed))
    page.reload()
    page.wait_for_selector("#where-you-stand .unit-progress",
                           state="attached")
    add_recent_result(page)
    choices = page.evaluate("() => RecallQuiz.settings.readChoices()")
    check("everything is remembered after a reload",
          not page.is_visible("#session-setup #keep-going-block")
          and choices["timer"] == 30
          and page.locator("#where-you-stand details:not([open])"
                           ":not(.flag-bar)").count() == 0
          and not page.is_visible("#recent-results .history-row"))

    # Overrides on the home screen leave the defaults alone.
    page.click("#session-setup .panel-toggle")
    page.click("#question-timer-choice [data-value='60']")
    page.reload()
    page.wait_for_selector("#where-you-stand .unit-progress",
                           state="attached")
    choices = page.evaluate("() => RecallQuiz.settings.readChoices()")
    check("a home-screen change lasts for the visit (survives a reload)",
          choices["timer"] == 60, str(choices))
    saved = page.evaluate(
        "() => JSON.parse(localStorage.getItem("
        "'recall-quiz-book:' + RecallQuiz.book.bookId())).layout.timer")
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

    page = open_synced_page(browser, open_sections=True)
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
        "(sessionStorage.getItem('" + SETTINGS_STORE_KEY
        + "') || '').includes('\"timer\":15')", timeout=8000)
    saved = page.evaluate(
        "() => JSON.parse(sessionStorage.getItem("
        "'" + SETTINGS_STORE_KEY + "')).layout")
    check("settings are saved to the account",
          saved and saved["stand"] == "closed" and saved["timer"] == 15
          and saved["confidence"] is True, str(saved))
    page.click("#settings-button")
    page.click("#question-timer-choice [data-value='60']")
    page.wait_for_timeout(1500)
    saved = page.evaluate(
        "() => JSON.parse(sessionStorage.getItem("
        "'" + SETTINGS_STORE_KEY + "')).layout.timer")
    check("a home-screen override is not saved to the account",
          saved == 15, str(saved))
    page.close()

    page = open_synced_page(browser, account_layout={
        "setup": "closed", "timer": 60, "confidence": False,
        "at": 2000000000000})
    page.wait_for_function(
        "RecallQuiz.settings.readChoices().timer === 60", timeout=8000)
    check("settings saved in the account are used on this device",
          not page.is_visible("#session-setup #keep-going-block")
          and not page.evaluate(
              "() => RecallQuiz.settings.readChoices().confidence"))
    page.close()


def test_show_hide_and_defaults(browser):
    """Settings can hide each control; hidden controls keep their value."""
    print("Show / hide and defaults")
    page = open_page(browser, view=None)
    page.click("#settings-button")
    page.click("[data-layout='timer'] [data-value='30']")
    page.click("[data-layout='show.timer'] [data-value='hide']")
    page.click("[data-layout='show.custom'] [data-value='hide']")
    page.click("#settings-button")
    check("a hidden control is not shown",
          not page.is_visible("#timer-field"))
    check("a hidden control keeps its default value",
          page.evaluate("() => RecallQuiz.settings.readChoices().timer")
          == 30)
    check("hiding Custom practice hides its section",
          not page.is_visible("#custom-practice"))
    check("no hide buttons sit on the home screen",
          page.locator("#home-screen [data-layout]").count() == 0)
    page.click("#settings-button")
    page.click("[data-layout='show.custom'] [data-value='show']")
    page.click("[data-layout='customStart'] [data-value='open']")
    page.click("[data-layout='filter'] [data-value='due']")
    page.click("#settings-button")
    check("Custom practice can start open",
          page.evaluate("() => document.getElementById("
                        "'custom-practice').open"))
    check("the default question filter is used",
          page.get_attribute("#question-filter-choice [data-value='due']",
                             "aria-pressed") == "true")
    page.reload()
    page.wait_for_selector("#where-you-stand .unit-progress",
                           state="attached")
    check("the hidden control stays hidden after a reload",
          not page.is_visible("#timer-field"))
    check("no errors", not page.errors, "; ".join(page.errors))
    page.close()

    fresh = open_page(browser, view=None, book=dict(
        BOOK, id="another-book"))
    check("another book starts from fresh defaults",
          fresh.is_visible("#timer-field")
          and fresh.get_attribute(
              "#question-filter-choice [data-value='all']",
              "aria-pressed") == "true")
    fresh.close()


def test_lesson_picker_cascade(browser):
    """Chapter, then topic, then idea."""
    print("Cascading lesson picker")
    page = open_page(browser, view=None)
    check("the topic drop-down starts hidden for the whole book",
          not page.is_visible("#topic-field"))
    first = page.evaluate(
        "() => RecallQuiz.book.unitIds[0]")
    page.select_option("#unit-picker", first)
    check("choosing a chapter shows its topics",
          page.is_visible("#topic-field")
          and page.locator("#topic-picker option").count() > 1)
    page.select_option("#topic-picker", index=1)
    check("choosing a topic shows its ideas",
          page.is_visible("#idea-field")
          and page.locator("#idea-picker option").count() > 1)
    page.select_option("#idea-picker", index=1)
    scope = page.evaluate("() => RecallQuiz.scopePicker.read()")
    check("the scope has chapter, topic and idea",
          scope.get("unit") == first and scope.get("section")
          and scope.get("concept"), str(scope))
    page.select_option("#unit-picker", "all")
    check("Whole book hides the lower levels",
          not page.is_visible("#topic-field")
          and not page.is_visible("#idea-field"))
    page.close()


def test_flags(browser):
    """Flag a question; Bad and Useless questions disappear."""
    print("Question flags")
    page = open_page(browser, view=None)
    before = page.evaluate("() => RecallQuiz.book.allQuestions().length")
    page.evaluate("() => RecallQuiz.bookSettings.toggleFlag("
                  "RecallQuiz.book.data.questions[0].id, 'bad')")
    after = page.evaluate("() => RecallQuiz.book.allQuestions().length")
    check("a Bad question leaves the book", after == before - 1,
          f"{before} -> {after}")
    page.evaluate("() => RecallQuiz.bookSettings.toggleFlag("
                  "RecallQuiz.book.data.questions[1].id, 'revisit')")
    check("a Revisit question stays in",
          page.evaluate("() => RecallQuiz.book.allQuestions().length")
          == after)
    page.evaluate("() => RecallQuiz.bookSettings.toggleFlag("
                  "RecallQuiz.book.data.questions[1].id, 'important')")
    flags = page.evaluate("() => RecallQuiz.bookSettings.flagsOf("
                          "RecallQuiz.book.data.questions[1].id)")
    check("a question can have several flags",
          flags == ["revisit", "important"], str(flags))
    page.click("#settings-button")
    check("Settings lists the flagged questions",
          page.locator("#flag-review-list .flag-review-row").count() == 2)
    export = page.evaluate("() => RecallQuiz.flags.createExport()")
    check("the export has ids, flags and counts",
          export["version"] == 1 and export["counts"]["bad"] == 1
          and len(export["questions"]) == 2, str(export["counts"]))
    page.locator("#flag-review-list .flag-review-row").first.get_by_text(
        "Clear flags").click()
    page.locator("#flag-review-list .flag-review-row").first.get_by_text(
        "Clear flags").click()
    check("clearing flags undoes the hiding",
          page.evaluate("() => RecallQuiz.book.allQuestions().length")
          == before)
    page.reload()
    page.wait_for_selector("#where-you-stand .unit-progress",
                           state="attached")
    page.evaluate("() => RecallQuiz.bookSettings.toggleFlag("
                  "RecallQuiz.book.data.questions[2].id, 'useless')")
    page.reload()
    page.wait_for_selector("#where-you-stand .unit-progress",
                           state="attached")
    check("flags are remembered after a reload",
          page.evaluate("() => RecallQuiz.book.allQuestions().length")
          == before - 1)
    page.close()

    page = open_page(browser, view=None)
    start_session(page)
    check("a question has a collapsed flag bar",
          page.is_visible(".flag-bar summary")
          and not page.evaluate(
              "() => document.querySelector('.flag-bar').open"))
    page.click(".flag-bar summary")
    page.click(".flag-button[data-flag='important']")
    check("pressing a flag marks it",
          page.get_attribute(".flag-button[data-flag='important']",
                             "aria-pressed") == "true")
    check("no errors", not page.errors, "; ".join(page.errors))
    page.close()


def test_saved_settings_upgrade(browser):
    """Old and newer saved records are handled safely."""
    print("Saved settings versions")
    page = open_page(browser, view=None)
    page.evaluate("""() => localStorage.setItem(
        'recall-quiz-book:' + RecallQuiz.book.bookId(),
        JSON.stringify({layout: {timer: 60, at: 5}}))""")
    page.reload()
    page.wait_for_selector("#where-you-stand .unit-progress",
                           state="attached")
    check("a record without a version is read as version 1",
          page.evaluate("() => RecallQuiz.settings.readChoices().timer")
          == 60)
    page.evaluate("""() => localStorage.setItem(
        'recall-quiz-book:' + RecallQuiz.book.bookId(),
        JSON.stringify({version: 99, layout: {timer: 30}, flags: {}}))""")
    page.reload()
    page.wait_for_selector("#where-you-stand .unit-progress",
                           state="attached")
    page.click("#settings-button")
    page.click("[data-layout='timer'] [data-value='15']")
    kept = page.evaluate(
        "() => JSON.parse(localStorage.getItem('recall-quiz-book:' + "
        "RecallQuiz.book.bookId())).version")
    check("a record from a newer version is never overwritten",
          kept == 99, str(kept))
    check("no errors", not page.errors, "; ".join(page.errors))
    page.close()


def test_keep_going_and_filter_switches(browser):
    """Keep me going and each "Which questions" option have switches."""
    print("Keep me going and question option switches")
    page = open_page(browser, view=None, keep_going=False)
    check("Keep me going is hidden by default",
          not page.is_visible("#keep-going-button")
          and not page.is_visible("#keep-going-summary")
          and not page.is_visible("#study-hint"))
    check("a hidden Keep me going line is not worked out",
          page.inner_text("#keep-going-summary").strip() == "")
    check("the 5-minute button has its own switch and starts hidden",
          not page.is_visible("#quick-session-button"))
    check("Custom practice starts open",
          page.eval_on_selector("#custom-practice", "d => d.open"))
    visible = [name for name in ["due", "gaps", "important", "all"]
               if page.is_visible(
                   f"#question-filter-choice [data-value='{name}']")]
    check("only Important only and Everything show by default",
          visible == ["important", "all"], str(visible))
    page.click("#settings-button")
    page.click("[data-layout='show.keepGoing'] [data-value='show']")
    page.click("[data-layout='show.filterDue'] [data-value='show']")
    page.click("#settings-button")
    check("showing Keep me going brings back the button, line and hint",
          page.is_visible("#keep-going-button")
          and page.is_visible("#keep-going-summary")
          and page.is_visible("#study-hint"))
    check("showing Keep me going works out its Up next line",
          page.inner_text("#keep-going-summary").strip() != "")
    check("showing an option brings it back",
          page.is_visible("#question-filter-choice [data-value='due']"))
    page.click("#settings-button")
    page.click("[data-layout='filter'] [data-value='due']")
    for name in ["Due", "Gaps", "Important", "All"]:
        page.click(f"[data-layout='show.filter{name}'] "
                   "[data-value='hide']")
    page.click("#settings-button")
    check("hiding every option hides the whole row",
          not page.is_visible("#filter-field"))
    check("the default filter still applies when everything is hidden",
          page.get_attribute("#question-filter-choice [data-value='due']",
                             "aria-pressed") == "true")
    page.reload()
    page.wait_for_selector("#where-you-stand .unit-progress",
                           state="attached")
    check("the switches are remembered after a reload",
          not page.is_visible("#filter-field")
          and page.is_visible("#keep-going-button"))
    check("no errors", not page.errors, "; ".join(page.errors))
    page.close()


def test_first_time_defaults(browser):
    """A book with no saved settings starts from js/default-settings.js."""
    print("First-time defaults")
    page = open_page(browser, view=None, keep_going=False,
                     open_sections=False)
    hidden = page.get_attribute("body", "data-hide").split()
    check("seven controls start hidden",
          sorted(hidden) == sorted(["keepGoing", "timer", "confidence",
                                    "htrab", "quick", "filterDue",
                                    "filterGaps"]), str(hidden))
    choices = page.evaluate("() => RecallQuiz.settings.readChoices()")
    check("timer, confidence and HTRAB start off",
          choices["timer"] == 0 and choices["confidence"] is False
          and page.evaluate("() => RecallQuiz.htrab.isOn()") is False,
          str(choices))
    check("Custom practice starts on Everything, by questions, 10",
          page.get_attribute("#question-filter-choice [data-value='all']",
                             "aria-pressed") == "true"
          and page.get_attribute(
              "#session-length-choice [data-value='questions']",
              "aria-pressed") == "true"
          and page.input_value("#question-count-input") == "10",
          str(choices))
    check("the lesson starts on the whole book",
          page.evaluate("() => RecallQuiz.settings.readChoices().scope"
                        ".unit") == "all")
    check("the home panels start folded, except what do you want to do",
          not page.is_visible("#progress-panel .progress-overview")
          and not page.is_visible("#recent-results .history-row")
          and page.is_visible("#session-setup #custom-practice"))
    check("every chapter starts closed",
          page.locator("#where-you-stand details:not(.flag-bar)[open]")
          .count() == 0)
    root = page.evaluate("() => [document.documentElement.dataset.theme,"
                         " document.documentElement.dataset.mode]")
    check("the theme starts as Classic, in light mode",
          root == ["classic", "light"], str(root))
    page.click("#settings-button")
    sections = page.evaluate(
        "() => [...document.querySelectorAll("
        "'#settings-screen details.settings-section')]"
        ".filter(d => d.open).map(d => d.id)")
    check("every Settings section starts folded", sections == [],
          str(sections))
    page.evaluate(
        "() => document.querySelectorAll('#settings-screen "
        "details.settings-section').forEach(d => { d.open = true; })")
    page.click("[data-layout='show.timer'] [data-value='show']")
    page.click("[data-layout='timer'] [data-value='30']")
    page.click("#settings-button")
    page.reload()
    page.wait_for_selector("#where-you-stand .unit-progress",
                           state="attached")
    saved = page.evaluate("() => RecallQuiz.settings.readChoices().timer")
    check("a reader's own choice wins over the default", saved == 30,
          str(saved))
    page.click("#settings-button")
    sections = page.evaluate(
        "() => [...document.querySelectorAll("
        "'#settings-screen details.settings-section')]"
        ".filter(d => d.open).map(d => d.id)")
    check("Settings starts folded again on the next visit",
          sections == [], str(sections))
    check("no errors", not page.errors, "; ".join(page.errors))
    page.close()

    page = open_page(browser, view=None, keep_going=False,
                     open_sections=False)
    page.evaluate("""() => localStorage.setItem(
        'recall-quiz-book:' + RecallQuiz.book.bookId(),
        JSON.stringify({version: 2, layout: {at: 5, progress: 'open',
        confidence: true, show: {timer: true}}, flags: {}, ideaFlags: {}}))""")
    page.reload()
    page.wait_for_selector("#where-you-stand .unit-progress",
                           state="attached")
    choices = page.evaluate("() => RecallQuiz.settings.readChoices()")
    check("a book with saved settings keeps them",
          choices["confidence"] is True
          and page.locator("#progress-panel.is-collapsed").count() == 0,
          str(choices))
    check("...and only what it never saved comes from the defaults",
          page.locator("#where-you-stand details:not(.flag-bar)[open]")
          .count() == 0, str(choices))
    check("no errors", not page.errors, "; ".join(page.errors))
    page.close()


def test_theme_loading(browser):
    """Only the theme in use, and its fonts, load at the start."""
    print("Theme loading")
    requests = []
    page = browser.new_page(viewport={"width": 430, "height": 900})
    page.errors = []
    page.on("pageerror", lambda error: page.errors.append(str(error)))
    page.on("request", lambda request: requests.append(request.url))
    page.route("**/fonts.googleapis.com/**", lambda route: route.abort())
    page.route("**/js/sync/sync-config.js", lambda route: route.fulfill(
        content_type="application/javascript",
        body='window.RecallQuizSyncConfig = {provider: "none"};'))
    page.goto(PAGE_URL)
    page.wait_for_selector("#book-title:not(:text-is('Recall Quiz'))")
    page.wait_for_function(
        "() => document.documentElement.dataset.theme === 'classic'")
    theme_files = [url for url in requests if "/css/themes/" in url]
    check("only the default theme's CSS loads at the start",
          len(theme_files) == 1 and theme_files[0].endswith("/classic.css"),
          str(theme_files))
    fonts = [url for url in requests if "fonts.googleapis.com" in url]
    check("only that theme's fonts are asked for",
          len(fonts) == 1 and "family=Instrument+Sans" in fonts[0]
          and "family=Source+Serif+4" in fonts[0]
          and fonts[0].count("family=") == 2, str(fonts))
    check("the picker's preview tiles wait until Appearance is opened",
          not any("theme-tiles.css" in url for url in requests))
    check("the page is not left hidden",
          "theme-loading" not in page.get_attribute("html", "class")
          if page.get_attribute("html", "class") else True)
    page.click("#settings-button")
    page.click("#appearance-section summary")
    page.wait_for_function(
        "() => [...document.styleSheets].some("
        "s => (s.href || '').includes('theme-tiles.css'))")
    fonts = [url for url in requests if "fonts.googleapis.com" in url]
    check("opening Appearance loads the other themes' fonts",
          len(fonts) >= 2 and fonts[1].count("family=") >= 5, str(fonts))
    page.click("#theme-tiles .theme-group[data-group='Playful'] summary")
    page.click("#theme-tiles .theme-tile[data-theme-id='lego']")
    page.wait_for_function(
        "() => document.documentElement.dataset.theme === 'lego'")
    theme_files = [url for url in requests if "/css/themes/" in url]
    check("choosing a theme loads just that theme's CSS",
          len(theme_files) == 2 and theme_files[1].endswith("/lego.css"),
          str(theme_files))
    check("no errors", not page.errors, "; ".join(page.errors))
    page.close()


def test_book_page_loads_from_a_cdn(browser):
    """A book page made by tools/make_book_index.py, with only its own
    questions.json beside it, gets every shared file from the CDN: the
    scripts, the theme CSS, KaTeX, the HTRAB data and the sync adapter."""
    print("Loading from a CDN")
    cdn = make_book_index.cdn_base("9.9.9") + "/"
    book_url = f"http://localhost:{PORT}/book/index.html"
    questions_url = book_url.replace("index.html", "questions.json")
    book_page = make_book_index.point_at_cdn(
        (SITE_FOLDER / "index.html").read_text(), cdn.rstrip("/"))
    math_question = {
        "id": "t-cdn", "unit": "Chapter 1", "section": "Algebra",
        "kind": "mcq", "q": "What is \\(x^2\\) when \\(x = 3\\)?",
        "options": ["\\(9\\)", "\\(6\\)"], "answer": 0}
    served = dict(BOOK, questions=[math_question])
    requests = []
    page = browser.new_page(viewport={"width": 430, "height": 900})
    page.errors = []
    page.on("pageerror", lambda error: page.errors.append(str(error)))
    page.on("request", lambda request: requests.append(request.url))

    def serve_cdn_file(route):
        """The CDN: files of this site folder, with the CORS header the
        real one sends."""
        name = route.request.url[len(cdn):].split("?")[0]
        path = SITE_FOLDER / name
        if path.is_file():
            route.fulfill(path=str(path),
                          headers={"access-control-allow-origin": "*"})
        else:
            route.fulfill(status=404)

    page.route(cdn + "**", serve_cdn_file)
    page.route("**/fonts.googleapis.com/**", lambda route: route.abort())
    page.route("**/js/sync/sync-config.js", lambda route: route.fulfill(
        content_type="application/javascript",
        body='window.RecallQuizSyncConfig = {provider: "example-in-browser",'
             ' saveDelaySeconds: 1, "example-in-browser": {}};'))
    page.route(book_url, lambda route: route.fulfill(
        body=book_page, content_type="text/html"))
    page.route(questions_url, lambda route: route.fulfill(json=served))
    page.goto(book_url)
    page.wait_for_selector("#book-title:not(:text-is('Recall Quiz'))")
    page.wait_for_function(
        "() => document.documentElement.dataset.theme === 'classic'")
    page.wait_for_function("() => typeof window.katex !== 'undefined'")
    page.evaluate("() => window.RecallQuiz.htrab.useRemote(true)")
    page.click("#settings-button")
    page.click("#appearance-section summary")
    page.wait_for_function(
        "() => [...document.styleSheets].some("
        "s => (s.href || '').includes('theme-tiles.css'))")
    page.wait_for_timeout(800)
    leaked = [url for url in requests
              if re.search(r"/book/(css|js|htrab|vendor|themes)/", url)]
    check("no shared file is asked for from the book's own site",
          not leaked, str(leaked))
    check("the app scripts come from the CDN",
          cdn + "js/asset-base.js" in requests
          and cdn + "js/main.js" in requests)
    check("the base is the CDN folder", page.evaluate(
        "() => window.RecallQuizAssetBase") == cdn)
    check("the default theme's CSS comes from the CDN",
          cdn + "css/themes/classic.css" in requests)
    check("the picker's preview tiles come from the CDN",
          cdn + "css/theme-tiles.css" in requests)
    check("the maths library comes from the CDN",
          cdn + "vendor/katex/katex.min.js" in requests)
    check("the HTRAB data comes from the CDN",
          cdn + "htrab/tags.json" in requests
          and cdn + "htrab/catalogue.json" in requests)
    check("the sync adapter comes from the CDN",
          cdn + "js/sync/providers/example-in-browser.js" in requests)
    check("the questions come from the book's own site",
          questions_url in requests)
    check("no errors", not page.errors, "; ".join(page.errors))
    page.close()


def test_book_shell_loads_from_a_cdn(browser):
    """A book's index.html made by tools/make_book_index.py (only the
    favicon and boot.js) loads the whole quiz from the CDN, while
    questions.json still comes from the book's own site."""
    print("Loader page")
    cdn = make_book_index.cdn_base("9.9.9") + "/"
    book_url = f"http://localhost:{PORT}/book/index.html"
    questions_url = book_url.replace("index.html", "questions.json")
    shell = make_book_index.shell_page("9.9.9")
    requests = []
    page = browser.new_page(viewport={"width": 430, "height": 900})
    page.errors = []
    page.on("pageerror", lambda error: page.errors.append(str(error)))
    page.on("request", lambda request: requests.append(request.url))

    def serve_cdn_file(route):
        """The CDN: files of this site folder; .html as text/plain, as
        jsDelivr serves it."""
        name = route.request.url[len(cdn):].split("?")[0]
        path = SITE_FOLDER / name
        if not path.is_file():
            route.fulfill(status=404)
            return
        headers = {"access-control-allow-origin": "*"}
        if name.endswith(".html"):
            headers["content-type"] = "text/plain; charset=utf-8"
        route.fulfill(path=str(path), headers=headers)

    page.route(cdn + "**", serve_cdn_file)
    page.route("**/fonts.googleapis.com/**", lambda route: route.abort())
    page.route("**/js/sync/sync-config.js", lambda route: route.fulfill(
        content_type="application/javascript",
        body='window.RecallQuizSyncConfig = {provider: "none"};'))
    page.route(book_url, lambda route: route.fulfill(
        body=shell, content_type="text/html"))
    page.route(questions_url, lambda route: route.fulfill(json=BOOK))
    page.goto(book_url)
    page.wait_for_selector("#book-title:not(:text-is('Recall Quiz'))")
    page.wait_for_function(
        "() => document.documentElement.dataset.theme === 'classic'")
    leaked = [url for url in requests
              if re.search(r"/book/(css|js|htrab|vendor|themes)/", url)]
    check("the quiz page itself comes from the CDN",
          cdn + "index.html" in requests)
    check("no shared file is asked for from the book's own site",
          not leaked, str(leaked))
    check("the app scripts come from the CDN",
          cdn + "js/main.js" in requests and cdn + "css/base.css" in requests)
    check("the base is the CDN folder", page.evaluate(
        "() => window.RecallQuizAssetBase") == cdn)
    check("the default theme's CSS comes from the CDN",
          cdn + "css/themes/classic.css" in requests)
    check("the questions come from the book's own site",
          questions_url in requests)
    check("the address of the page is still the book's",
          page.url == book_url)
    check("the favicon is the book's own", page.evaluate(
        "() => document.querySelector('link[rel=icon]').href")
          .endswith("/book/images/favicon.png"))
    check("the quiz shows its home screen",
          page.is_visible("#settings-button"))
    check("no errors", not page.errors, "; ".join(page.errors))
    page.close()


def test_book_shell_reports_a_missing_page(browser):
    """When the CDN does not have the page, the reader is told so."""
    cdn = make_book_index.cdn_base("9.9.9") + "/"
    book_url = f"http://localhost:{PORT}/book/index.html"
    page = browser.new_page()
    page.route(cdn + "**", lambda route: route.fulfill(status=404))
    page.route(cdn + "js/boot.js", lambda route: route.fulfill(
        path=str(SITE_FOLDER / "js/boot.js"),
        content_type="application/javascript"))
    page.route(book_url, lambda route: route.fulfill(
        body=make_book_index.shell_page("9.9.9"), content_type="text/html"))
    page.goto(book_url)
    page.wait_for_selector("p[role=alert]")
    check("a missing CDN page gives a message", "could not be loaded"
          in page.inner_text("p[role=alert]"))
    page.close()


def test_early_download(browser):
    """The question bank is requested before the app scripts run, and a
    loading note shows until it arrives."""
    print("Early download")
    page = browser.new_page(viewport={"width": 430, "height": 900})
    page.errors = []
    page.on("pageerror", lambda error: page.errors.append(str(error)))
    page.route("**/fonts.googleapis.com/**", lambda route: route.abort())
    page.route("**/js/sync/sync-config.js", lambda route: route.fulfill(
        content_type="application/javascript",
        body='window.RecallQuizSyncConfig = {provider: "none"};'))

    def slow_questions(route):
        page.wait_for_timeout(700)
        route.fulfill(json=BOOK)

    page.route("**/questions.json", slow_questions)
    page.goto(PAGE_URL, wait_until="commit")
    page.wait_for_selector("#loading-note", state="attached")
    check("a loading note shows while the book downloads",
          page.is_visible("#loading-note")
          and "Loading" in page.inner_text("#loading-note"))
    page.wait_for_selector("#book-title:not(:text-is('Recall Quiz'))")
    check("the loading note goes away once the book is open",
          not page.is_visible("#loading-note"))
    order = page.evaluate(
        "() => { const t = n => (performance.getEntriesByType('resource')"
        ".find(e => e.name.includes(n)) || {}).startTime;"
        " return [t('questions.json'), (performance.getEntriesByType("
        "'resource').find(e => e.name.includes('js/main.js')) || {})"
        ".responseEnd]; }")
    check("the download starts before the app scripts have all arrived",
          order[0] is not None and order[1] is not None
          and order[0] < order[1], str(order))
    check("the book was requested once", page.evaluate(
        "() => performance.getEntriesByType('resource')"
        ".filter(e => e.name.includes('questions.json')).length") == 1)
    check("no errors", not page.errors, "; ".join(page.errors))
    page.close()

    page = browser.new_page(viewport={"width": 430, "height": 900})
    page.route("**/fonts.googleapis.com/**", lambda route: route.abort())
    page.route("**/questions.json", lambda route: route.abort())
    page.goto(PAGE_URL)
    page.wait_for_selector("#load-error", state="visible")
    check("a failed download hides the loading note and offers the picker",
          not page.is_visible("#loading-note")
          and page.is_visible("#load-error"))
    page.close()


def test_idea_flags(browser):
    """Ideas can be flagged; Bad and Useless ones disappear."""
    print("Idea flags")
    page = open_page(browser, view=None)
    ideas = page.evaluate("() => RecallQuiz.learning.concepts()"
                          ".map(c => c.id)")
    questions = page.evaluate("() => RecallQuiz.book.allQuestions().length")
    page.evaluate(f"() => RecallQuiz.bookSettings.toggleIdeaFlag("
                  f"'{ideas[0]}', 'bad')")
    after = page.evaluate("() => RecallQuiz.learning.concepts()"
                          ".map(c => c.id)")
    check("a Bad idea leaves the idea lists", after == ideas[1:], str(after))
    check("the idea's questions stay",
          page.evaluate("() => RecallQuiz.book.allQuestions().length")
          == questions)
    check("the idea is gone from the home screen",
          page.locator(f".concept-row[data-concept-id='{ideas[0]}']")
          .count() == 0)
    page.evaluate(f"() => RecallQuiz.bookSettings.toggleIdeaFlag("
                  f"'{ideas[1]}', 'revisit')")
    page.evaluate(f"() => RecallQuiz.bookSettings.toggleIdeaFlag("
                  f"'{ideas[1]}', 'important')")
    flags = page.evaluate("() => RecallQuiz.bookSettings.ideaFlagsOf("
                          f"'{ideas[1]}')")
    check("an idea can have several flags",
          flags == ["revisit", "important"], str(flags))
    check("idea flags never touch question flags",
          page.evaluate("() => RecallQuiz.bookSettings.listFlagged()"
                        ".length") == 0)
    page.click("#settings-button")
    check("Settings lists the flagged ideas",
          page.locator("#idea-flag-review-list .flag-review-row").count()
          == 2)
    export = page.evaluate("() => RecallQuiz.flags.createIdeaExport()")
    check("the idea export has ids, flags and counts",
          export["counts"]["bad"] == 1 and len(export["ideas"]) == 2
          and export["ideas"][0]["id"] in ideas, str(export["counts"]))
    page.locator("#idea-flag-review-list .flag-review-row").nth(1).get_by_text(
        "Clear flags").click()
    page.locator("#idea-flag-review-list .flag-review-row").first.get_by_text(
        "Clear flags").click()
    check("clearing flags brings a hidden idea back",
          page.evaluate("() => RecallQuiz.learning.concepts().length")
          == len(ideas))
    page.reload()
    page.wait_for_selector("#where-you-stand .unit-progress",
                           state="attached")
    page.evaluate(f"() => RecallQuiz.bookSettings.toggleIdeaFlag("
                  f"'{ideas[2]}', 'useless')")
    page.reload()
    page.wait_for_selector("#where-you-stand .unit-progress",
                           state="attached")
    check("idea flags are remembered after a reload",
          page.evaluate("() => RecallQuiz.learning.concepts().length")
          == len(ideas) - 1)
    saved = page.evaluate(
        "() => JSON.parse(localStorage.getItem('recall-quiz-book:' + "
        "RecallQuiz.book.bookId())).version")
    check("the saved record is version 3", saved == 3, str(saved))
    page.close()

    page = open_page(browser)
    row = open_concept(page, 0)
    bar = row.locator(".flag-bar")
    check("an idea has a collapsed flag bar",
          bar.count() == 1 and not bar.evaluate("d => d.open"))
    bar.locator("summary").click()
    row.locator(".flag-button[data-flag='important']").click()
    check("pressing a flag on an idea marks it",
          row.locator(".flag-button[data-flag='important']").get_attribute(
              "aria-pressed") == "true")
    check("the open idea stays open when it is flagged Important",
          row.evaluate("d => d.open"))
    page.click("#settings-button")
    page.click("[data-layout='show.ideaFlagBar'] [data-value='hide']")
    page.click("#settings-button")
    page.reload()
    page.wait_for_selector("#where-you-stand .unit-progress",
                           state="attached")
    open_concept(page, 0)
    check("the idea flag bar can be hidden in Settings",
          page.locator(".concept-row .flag-bar").count() == 0)
    check("no errors", not page.errors, "; ".join(page.errors))
    page.close()


def test_important_ideas_come_first(browser):
    """Keep me going offers an Important idea before the others."""
    print("Important ideas first")
    free_book = json.loads(json.dumps(BOOK))
    for concept in free_book["concepts"]:
        concept["requires"] = []
    page = open_page(browser, view=None, book=free_book)
    page.evaluate("() => RecallQuiz.bookSettings.toggleIdeaFlag("
                  "'weekdays', 'important')")
    first = page.evaluate(
        "() => RecallQuiz.learning.conceptsToLearn("
        "{unitId: 'all', conceptCount: 1})[0].id")
    check("an Important core idea is taught before the other core ideas",
          first == "weekdays", first)
    page.close()


def test_idea_flags_upgrade_and_sync(browser):
    """A version 1 record and account copy gain idea flags."""
    print("Idea flags: upgrade and account sync")
    page = open_page(browser, view=None)
    page.evaluate("""() => localStorage.setItem(
        'recall-quiz-book:' + RecallQuiz.book.bookId(),
        JSON.stringify({version: 1, layout: {timer: 30, at: 5},
                        flags: {}}))""")
    page.reload()
    page.wait_for_selector("#where-you-stand .unit-progress",
                           state="attached")
    check("a version 1 record keeps its layout",
          page.evaluate("() => RecallQuiz.settings.readChoices().timer")
          == 30)
    page.evaluate("() => RecallQuiz.bookSettings.toggleIdeaFlag("
                  "RecallQuiz.learning.concepts()[0].id, 'revisit')")
    saved = page.evaluate(
        "() => JSON.parse(localStorage.getItem('recall-quiz-book:' + "
        "RecallQuiz.book.bookId()))")
    check("it is saved as version 3 with the idea flag",
          saved["version"] == 3 and len(saved["ideaFlags"]) == 1
          and saved["layout"]["timer"] == 30, str(saved))
    page.close()

    page = open_synced_page(browser)
    page.wait_for_selector("#account-body .button-row button",
                           state="attached")
    page.evaluate("() => RecallQuiz.bookSettings.toggleIdeaFlag("
                  "RecallQuiz.learning.concepts()[0].id, 'important')")
    page.wait_for_function(
        "(key) => { const t = sessionStorage.getItem(key);"
        " return t && JSON.parse(t).ideaFlags"
        " && Object.keys(JSON.parse(t).ideaFlags).length === 1; }",
        arg=SETTINGS_STORE_KEY, timeout=8000)
    doc = page.evaluate("(key) => JSON.parse(sessionStorage.getItem(key))",
                        SETTINGS_STORE_KEY)
    check("idea flags are saved to the account (version 3)",
          doc["v"] == 3 and doc["flags"] == {}, str(doc)[:200])
    page.close()


def test_settings_sections_fold(browser):
    """Every Settings section is folded on every visit."""
    print("Collapsible Settings sections")
    page = open_synced_page(browser)
    page.wait_for_selector("#account-body .button-row button",
                           state="attached")
    page.click("#settings-button")
    sections = page.locator("#settings-screen details.settings-section")
    total = sections.count()
    opened = page.locator(
        "#settings-screen details.settings-section[open]").count()
    check("every Settings section is a folded panel",
          total >= 8 and opened == 0, f"{total} sections, {opened} open")
    shown = 0
    for index in range(total):
        body = sections.nth(index).locator(":scope > :not(summary)").first
        if sections.nth(index).is_visible() and body.is_visible():
            shown += 1
    check("their contents are hidden until opened", shown == 0, str(shown))
    summary = page.inner_text("#account-current")
    check("the folded Account title shows the signed-in name",
          summary == "Example User" or len(summary) > 0, summary)
    page.click("#account-section summary")
    page.click("#appearance-section summary")
    page.click("#visibility-section summary")
    page.click("#settings-button")
    page.click("#settings-button")
    opened = page.locator(
        "#settings-screen details.settings-section[open]").count()
    check("each visit starts fully folded again", opened == 0, str(opened))
    hidden_note = page.inner_text("#visibility-section-current")
    check("a folded section shows a short summary",
          "hidden" in hidden_note or "shown" in hidden_note, hidden_note)
    check("no errors", not page.errors, "; ".join(page.errors))
    page.close()


def test_phone_width(browser):
    """Nothing scrolls sideways at phone width."""
    print("Phone width (375px)")
    page = open_page(browser, width=375)
    scrolls_sideways = page.evaluate(
        "() => document.documentElement.scrollWidth > innerWidth")
    check("the home screen does not scroll sideways",
          not scrolls_sideways)
    # Everything open (panel, units, ideas): still no sideways scroll, and
    # a long unbreakable word in an idea must not widen the list.
    page.evaluate("""() => {
      document.querySelectorAll(".panel").forEach(
        p => p.classList.remove("is-collapsed"));
      document.querySelectorAll("details").forEach(d => d.open = true);
      const p = document.createElement("p");
      p.textContent = "x".repeat(120);
      const body = document.querySelector(".concept-body");
      if (body) { body.prepend(p); }
    }""")
    page.wait_for_timeout(300)
    opened_scrolls = page.evaluate(
        "() => document.documentElement.scrollWidth > innerWidth")
    check("with every list opened it still does not scroll sideways",
          not opened_scrolls)
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
    row.locator(":scope > summary").click()
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
    check("a warm-up guess offers a collapsed Read the idea panel",
          page.inner_text(".idea-again summary").startswith("Read the idea")
          and page.evaluate(
              "() => !document.querySelector('.idea-again').open"))
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


# 1x1 PNG, used as the made-up secret picture in the media tests
TINY_PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
    "0000000d49444154789c63f8cfc0f01f0005000201a5f6454000000000"
    "49454e44ae426082")
MEDIA_ID = "u01/i01/f01"


def v2_bank():
    """The test book with every v2 field: genre, blocks, code, media."""
    bank = json.loads(json.dumps(BOOK))
    bank["genre"] = "Algorithms"
    bank["cover"] = {"id": MEDIA_ID, "type": "image/png", "role": "cover",
                     "alt": "The book cover: a blue galaxy and a title"}
    card = bank["concepts"][0]["card"]
    card["media"] = [{
        "id": MEDIA_ID, "type": "image/png", "role": "illustration",
        "alt": "A pencil cartoon of a clock on a wall"}]
    card["blocks"] = [
        {"label": "Problem", "text": "Find a number in a sorted list."},
        {"label": "Code", "text": "A loop that counts.",
         "code": "for (int i = 0; i < 3; i++) {\n  print(i);\n}",
         "lang": "java"}]
    for question in bank["questions"]:
        question["code"] = "x = 1 < 2 && y > 0"
        question["lang"] = "java"
        question["media"] = [{
            "id": MEDIA_ID, "type": "image/png", "role": "figure",
            "alt": "A clock face with the hand pointing at three"}]
    return bank


def encrypted_media():
    """(base64 book key, the .enc bytes of TINY_PNG) made with the tool."""
    sys.path.insert(0, str(SITE_FOLDER / "tools"))
    import base64
    import os
    import encrypt_media
    key = os.urandom(32)
    return (base64.b64encode(key).decode(),
            encrypt_media.encrypt(key, MEDIA_ID, TINY_PNG))


def test_template_v2_fields(browser):
    """Genre chip, labelled blocks, code, and encrypted media with a text
    fallback; the validator accepts them and rejects bad ones."""
    print("Template v2: blocks, code, media")
    bank = v2_bank()
    out = run_validator(bank)
    check("the validator accepts the v2 fields", "0 error(s)" in out,
          out[-300:])
    no_paragraphs = json.loads(json.dumps(bank))
    no_paragraphs["concepts"][0]["card"].pop("paragraphs")
    check("a card of blocks needs no paragraphs",
          "0 error(s)" in run_validator(no_paragraphs))
    broken = json.loads(json.dumps(bank))
    broken["concepts"][0]["card"]["blocks"][0].pop("label")
    broken["questions"][0]["media"][0].pop("alt")
    broken["questions"][1]["code"] = ""
    broken["sourceUse"] = "everything"
    out = run_validator(broken)
    for needle, label in (
            ("label is required", "a block without a label is an error"),
            ("alt (the words", "media without alt is an error"),
            ("code must be non-empty", "empty code is an error"),
            ("sourceUse", "an unknown sourceUse is an error")):
        check(label, needle in out, out[-300:])
    key, data = encrypted_media()
    page = open_page(browser, book=bank)
    page.route("**/media/" + MEDIA_ID + ".enc",
               lambda route: route.fulfill(body=data))
    page.evaluate("k => RecallQuiz.media.setKeyProvider("
                  "() => Promise.resolve(k))", key)
    row = open_concept(page, 0)
    check("the card shows the genre chip",
          row.locator(".idea-genre").inner_text() == "Algorithms")
    check("the page background sits on a fixed layer (iOS paints it right)",
          page.evaluate("() => { const s = getComputedStyle(document.body,"
                        " '::before'); return s.position === 'fixed' && "
                        "s.zIndex === '-1'; }"))
    check("the card shows two labelled blocks",
          row.locator(".idea-block").count() == 2)
    check("the card shows its own picture under the text",
          row.locator(".idea-card > .media-list .media-figure").count() == 1)
    page.wait_for_selector("#book-cover:not(.hidden)")
    check("the cover shows by the title with its key",
          page.eval_on_selector("#book-cover", "i => i.naturalWidth") == 1)
    check("the card block shows its code",
          "for (int i = 0" in row.locator(".code-block").inner_text())
    start_session(page)
    page.wait_for_selector(".question-wrap .code-block")
    check("the question shows its code",
          "x = 1 < 2" in page.inner_text(".question-wrap .code-block"))
    page.wait_for_selector(".media-figure.is-ready img")
    check("the secret picture is opened with the key",
          page.eval_on_selector(".media-figure img",
                                "i => i.naturalWidth") == 1)
    check("no page errors with the key", not page.errors,
          "; ".join(page.errors))
    page.close()
    page = open_page(browser, book=bank)
    page.route("**/media/" + MEDIA_ID + ".enc",
               lambda route: route.fulfill(body=data))
    start_session(page)
    page.wait_for_selector(".media-figure.is-missing")
    check("without a key the words stand in for the picture",
          "clock face" in page.inner_text(".media-alt"))
    check("without a key the box says why",
          "no key" in page.inner_text(".media-reason"),
          page.inner_html(".media-figure")[:300])
    check("without a key there is no cover",
          page.is_hidden("#book-cover"))
    check("no page errors without the key", not page.errors,
          "; ".join(page.errors))
    page.close()
    page = open_page(browser, book=bank, width=375)
    start_session(page)
    page.wait_for_selector(".question-wrap .code-block")
    check("a code block does not push the phone page sideways",
          page.evaluate("() => document.documentElement.scrollWidth <= "
                        "window.innerWidth"))
    page.close()


def test_media_key_comes_from_the_account(browser):
    """Signed in, the book key is read from the account (here the test
    adapter, never the real database) and waiting pictures open; signed
    out, or with no key, the words stay."""
    print("Media key from the account")
    bank = v2_bank()
    key, data = encrypted_media()
    book_id = bank.get("id", "book")
    page = open_page(
        browser, book=bank,
        sync_config='window.RecallQuizSyncConfig = {provider: '
                    '"example-in-browser", saveDelaySeconds: 1, '
                    '"example-in-browser": {}};',
        init_script="sessionStorage.setItem("
                    "'recall-quiz-example-media-key:%s', '%s');"
                    % (book_id, key))
    page.route("**/media/" + MEDIA_ID + ".enc",
               lambda route: route.fulfill(body=data))
    start_session(page)
    page.wait_for_selector(".media-figure.is-missing")
    check("signed out, the words stand in for the picture",
          "clock face" in page.inner_text(".media-alt"))
    page.evaluate("() => RecallQuiz.cloudSync.signIn()")
    page.wait_for_selector(".media-figure.is-ready img", timeout=8000)
    check("after sign-in the waiting picture opens with the account key",
          page.eval_on_selector(".media-figure img",
                                "i => i.naturalWidth") == 1)
    check("no page errors reading the account key", not page.errors,
          "; ".join(page.errors))
    page.close()


def test_firebase_key_rules_and_adapter():
    """The Firebase adapter reads users/<uid>/mediaKeys/<book>; the rules
    let only that reader read it and let nobody write it."""
    print("Firebase media key rules")
    rules = (SITE_FOLDER / "js/sync/providers/firebase-firestore.rules"
             ).read_text()
    block = rules[rules.index("mediaKeys"):]
    check("rules have a mediaKeys block", "mediaKeys/{bookId}" in rules)
    check("only the owner may read the key",
          "request.auth.uid == userId" in block)
    check("nobody may write the key from the page",
          "allow write: if false" in block)
    adapter = (SITE_FOLDER / "js/sync/providers/firebase.js").read_text()
    check("the adapter reads the mediaKeys document",
          '"mediaKeys"' in adapter and "readMediaKey" in adapter)


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
            test_firebase_key_rules_and_adapter()
            test_every_question_is_well_formed()
            test_bank_passes_the_validator()
            test_keep_going_teaches_the_next_idea(browser)
            test_any_order(browser)
            test_review_includes_unseen_ideas(browser)
            test_second_keep_going_reviews_first(browser)
            test_sync_bar_appears_when_turned_on(browser)
            test_validator_writer_rules()
            test_new_bank_fields_show(browser)
            test_template_v2_fields(browser)
            test_media_key_comes_from_the_account(browser)
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
            test_verse_study_card(browser)
            test_study_aids(browser)
            test_sanskrit_parts_and_font(browser)
            test_sanskrit_section_hidden_without_cards(browser)
            test_sanskrit_choice_syncs(browser)
            test_scroll_buttons_are_gone(browser)
            test_title_bar_home(browser)
            test_title_bar_session(browser)
            test_session_list_reviews_without_recording(browser)
            test_left_drawer_leaves_a_session(browser)
            test_session_navigation(browser)
            test_check_button_and_phone_bar(browser)
            test_reading_panel(browser)
            test_reading_panel_theme_and_home(browser)
            test_reader(browser)
            test_reader_many_questions(browser)
            test_book_defaults(browser)
            test_formulas(browser)
            test_themes(browser)
            test_home_views(browser)
            test_theme_follows_the_account(browser)
            test_home_layout(browser)
            test_show_hide_and_defaults(browser)
            test_first_time_defaults(browser)
            test_theme_loading(browser)
            test_book_page_loads_from_a_cdn(browser)
            test_book_shell_loads_from_a_cdn(browser)
            test_book_shell_reports_a_missing_page(browser)
            test_early_download(browser)
            test_lesson_picker_cascade(browser)
            test_flags(browser)
            test_saved_settings_upgrade(browser)
            test_keep_going_and_filter_switches(browser)
            test_idea_flags(browser)
            test_important_ideas_come_first(browser)
            test_idea_flags_upgrade_and_sync(browser)
            test_settings_sections_fold(browser)
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
