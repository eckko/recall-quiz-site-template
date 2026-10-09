# Recipes

Step-by-step instructions for the changes people ask for most. After any
of them: run `python3 tests/run_tests.py`.

## Build a question bank from a book file

The `/quiz-book` skill does this end to end. By hand:

1. `python3 tools/extract_book.py BOOK.pdf work/extract`
2. Write `work/chapters.json` (format in the docstring of
   `tools/plan_question_bank.py`): included chapters, pages, exact
   sub-headings, weight 0.7 to 1.3, optional typeWeights.
3. `python3 tools/plan_question_bank.py work/chapters.json --per-page 6`
4. Write `work/questions/<idPrefix>.json` per chapter (check each with
   `merge_question_bank.py work/question-plan.json --only <idPrefix>`).
5. `python3 tools/merge_question_bank.py work/question-plan.json
   --book-text work/extract/book-text.txt --output questions.json`
6. `python3 tests/run_tests.py`

Keep `work/` out of the published site.

## Set the site up for a different book

1. Replace `questions.json`. Set a new unique `id` and the `book` title.
2. Add `labels` if the source is not a book with chapters.
3. Keep `unit` values consistent (`"Chapter 3"` everywhere, not
   `"Ch 3"`); the chapter list is built from them in first-seen order.
4. Run the tests: they answer every question right and wrong, so they
   catch malformed questions (wrong indexes, missing fields).

## Write questions from study notes

Aim for retrieval, not recognition: a mix of `recall` (hardest, best for
memory), `fill`, `order` (for the author's structure), `match` (terms),
`sort` (categories), `multi`, `tf`, `mcq`. Per chapter, cover both its
place in the book's argument and its core ideas. Use the author's words
in `explain`. Ids like `c09-2` (chapter, number). Make wrong options
plausible.

## Add, edit or remove a question

Edit `questions.json` directly. Keep ids stable (progress is keyed by
them). Fields per kind are in [data-formats.md](data-formats.md).

## Add a theme

1. `cp -r themes/professional themes/<new-id>`
2. Edit `theme.json` (name, fonts, shape, both colour sets, backgrounds).
3. Replace `mascot.svg` and `start-icon.svg` (original art only; the icon
   uses `currentColor`). Add or remove `background-*.svg`.
4. Edit or delete `extra.css` (scope every selector with
   `[data-theme="<new-id>"]`).
5. Add the id to `themes/picker-order.txt`.
6. If the theme uses a new Google Font, add it to `GOOGLE_FONTS` in
   `tools/build_themes.py`.
7. `python3 tools/build_themes.py`
8. Check light and dark visually (see [testing.md](testing.md)). Text on
   cards and text on accent buttons must be readable.

## Add a question type

1. `js/question-types/<name>.js`: an IIFE that calls
   `quiz.questionTypes.register("<kind>", { label, show })`.
   Use only the `card` API (see [architecture.md](architecture.md)).
   Guard against double answers with an `isChecked`/`isAnswered` flag.
   Call `card.setKeyHint`, `card.setKeyHandler` and
   `card.setTimeUpHandler` so keyboard and timers work.
   For partial credit use `quiz.questionTypes.resultFromCount(right,
   total)`.
2. Add `<script src="js/question-types/<name>.js">` in `index.html`
   after `question-types.js` and before `session.js`.
3. Styles in `css/question-types.css`, variables only.
4. Document its fields in `README.md` and
   [data-formats.md](data-formats.md).
5. Add an example to `questions.json` and a branch in `answer_question`
   in `tests/run_tests.py`.

## Change scoring or verdicts

Constants at the top of `js/results-screen.js`:
`EXCELLENT_ABOVE_PERCENT`, `EXCELLENT_NEEDS_MORE_THAN`,
`PASS_FROM_PERCENT`, plus `RULES_TEXT` and `messageFor`, which describe
the rules in words: update them together. Half marks for "part" are in
`showResults`.

## Change how often questions come back

`DAYS_UNTIL_REVIEW_BY_LEVEL` and `SOLID_LEVEL` at the top of
`js/spaced-repetition.js`. The number of levels follows the array
length. Update the comment at the top of that file and the README.

## Add a setting to the "What do you want to practise?" panel

1. Markup in `index.html`: a `.choice-group` with buttons carrying
   `data-value` and `aria-pressed`.
2. In `js/session-settings.js`: a field in `current` and a
   `setUpChoiceGroup("<id>", ...)` call.
3. Copy it into `quiz.session.state` in `resetState` (`js/session.js`)
   and use it from there.

## Change a word on the page

Static words are in `index.html`. Dynamic ones are near where they are
drawn: `js/home-screen.js`, `js/session-settings.js`,
`js/answer-feedback.js`, `js/results-screen.js`, and each question type.
Book-specific words ("Chapter", "Topic") come from `labels` in
`questions.json`; never hard-code them.

## Change the saved-progress format

1. Bump `CURRENT_VERSION` in `js/progress-storage.js`.
2. Write `upgradeFromVersionN` and call it from `upgradeSavedProgress`.
3. Update the format comment at the top of that file and
   [data-formats.md](data-formats.md).
4. Extend `test_old_progress_is_upgraded` in `tests/run_tests.py`.
