# Recall Quiz

A practice page for one book. It asks you questions chapter by chapter,
brings back the ones you miss sooner (spaced repetition), shows where your
gaps are, and keeps your progress in your browser. It is plain HTML, CSS
and JavaScript: no framework, no build step, nothing to install to use it.

- [Try it on your computer](#try-it-on-your-computer)
- [Put it online with GitHub Pages](#put-it-online-with-github-pages)
- [Add a new book](#add-a-new-book)
- [Add or edit a question](#add-or-edit-a-question)
- [Change an answer or an explanation](#change-an-answer-or-an-explanation)
- [Question types and their fields](#question-types-and-their-fields)
- [Add a new theme](#add-a-new-theme)
- [How the code works](#how-the-code-works)
- [Add a new question type](#add-a-new-question-type)
- [Testing](#testing)
- [Code style](#code-style)

AI agents: read [`AGENTS.md`](AGENTS.md) and the
[`ai-context/`](ai-context/) folder first.

---

## Teaching mode (Learn)

This template can teach new material, not only test recall. A bank that
has a `concepts` list can be studied in any order:

- **Keep me going**: one button that picks what comes next: due reviews
  first, then the next idea to teach.
- **Teach me** (on any idea): an unscored warm-up guess, a short concept
  card, then a ladder of questions (warm-up, extend, apply, transfer
  ...). Every answer explains why each option is right or wrong.
- **Test me** (on any idea): straight to the ladder, no card.
- **5-minute session**: the same, with core ideas only and fewer reviews.
- **Custom practice**: the usual spaced-repetition practice with
  filters, length and timer.

Version M3 adds: a "Read the idea" panel before an answer; sessions that
open on the hardest item and end on an easy review; results that lead with
what went right and show a five-session average; an orienting question and
a "where it stops working" line on every card; `core` ideas; a "where this
idea breaks" line with "Practise the weak part"; gentler wording ("Needs
work", "Not yet"); "days practised" next to the streak; and validator
warnings for loaded or double questions.

### HTRAB overlay (optional)

`htrab/` holds an experimental overlay for practising the reading method
of *How to Read a Book*. Questions carry one tag
(`level/topic/subtopic`); with the switch on, a reader can test one step
(for example "Finding the Propositions") and sees Adler's advice in the
feedback. A second sample bank, `banks/how-to-read-a-book.json`, shows
it: open `index.html?bank=banks/how-to-read-a-book.json` (through a web
server). Remove the overlay by deleting `htrab/` and three lines in
`index.html`. See `htrab/README.md`.

Nothing is locked: "Builds on" is only a hint (set `"strictOrder": true`
in the bank to lock ideas until their requirements are understood).
A bank without `concepts` works as before (custom practice only). The full design
and the question fields are in `ai-context/learning-design.md`. Check a
bank with `python3 tools/validate_bank.py questions.json`. The bundled
`questions.json` is a small sample course ("Clock Arithmetic") that shows
the format.

Optional sign-in sync (progress only) is off by default: see
`js/sync/README.md` and `js/sync/sync-config.js`.

## Try it on your computer

Browsers will not let a page read `questions.json` straight from a folder,
so run a tiny web server in the project folder:

```bash
python3 -m http.server
```

Then open <http://localhost:8000>. (If you double-click `index.html`
instead, the page asks you to pick `questions.json` by hand. That works
too.)

## Put it online with GitHub Pages

1. Put this folder in a GitHub repository (the files at the top level,
   next to `README.md`).
2. On GitHub: **Settings → Pages → Build and deployment → Source:
   Deploy from a branch**, branch `main`, folder `/ (root)`.
3. After a minute the quiz is live at
   `https://<your-user-name>.github.io/<repository-name>/`.

Every push to `main` updates the site.

---

## Add a new book

### The quick way: `/quiz-book`

In Claude, type `/quiz-book`, give the book's title and attach the
book as a PDF or EPUB. Claude asks how many questions per page you want
(6 is the default, so a 500-page book gets about 3,000 questions),
writes them chapter by chapter, checks them, and gives you a zip of
this whole site with the new `questions.json`. Upload its contents to a
new GitHub repository as described above.

The tools it uses are in `tools/` and work on their own too:

| Tool | What it does |
|---|---|
| `extract_book.py BOOK OUT` | turns a PDF or EPUB into text files, with word and page counts per part |
| `plan_question_bank.py CHAPTERS --per-page 6` | decides how many questions each chapter gets (pages x weight) and of which types |
| `merge_question_bank.py PLAN --book-text TEXT` | checks every chapter's questions (fields, duplicates, answer positions, exact quotes) and merges them into `questions.json` |
| `pack_template.py pack FILE` | packs this site, minus the book, into one text file (how the skill keeps its template) |

### By hand

Everything except `questions.json` is the same for every book.

1. Copy the whole folder (or make a new repository from it).
2. Replace `questions.json` with the new book's questions. The top of the
   file says which book it is:

   ```json
   {
     "id": "atomic-habits",
     "book": "Atomic Habits",
     "labels": {
       "unit": "Chapter",
       "units": "chapters",
       "topic": "Topic",
       "whole": "Whole book"
     },
     "questions": [ ... ]
   }
   ```

   | Field | What it is |
   |---|---|
   | `id` | A short name with no spaces. Progress is saved under this name, so give every book a different one and **never change it** once you have started practising (that would start your progress again). |
   | `book` | The title shown at the top of the page. |
   | `labels` | Optional. The words the page uses. For a course you might use `"unit": "Lesson"`, `"units": "lessons"`, `"topic": "Section"`, `"whole": "Whole course"`. Leave it out to get the defaults shown above. |
   | `questions` | The list of questions (see below). |

3. Open the page. The chapters in the drop-down come from the questions
   themselves, in the order they first appear.

Tip: the `/xray-book` notes make a good source for questions. Ask Claude
to write questions from the notes in this format, covering each chapter's
structure and core ideas.

## Add or edit a question

Each question is one entry in the `questions` list. Every question has
these fields:

```json
{
  "id": "c09-2",
  "unit": "Chapter 9",
  "unitTitle": "Answering an Easier Question",
  "section": "Substituting Questions",
  "kind": "mcq",
  "q": "What is the difference between the target question and the heuristic question?",
  "explain": "Shown after answering. Keep it short and in the author's words."
}
```

| Field | What it is |
|---|---|
| `id` | Unique and **stable**. Your progress for this question is saved under it. Changing the id makes it a brand-new question. A pattern like `c09-2` (chapter 9, question 2) keeps them unique. |
| `unit` | The chapter, exactly as it should appear, e.g. `"Chapter 9"`. All questions with the same `unit` are grouped together. The number is taken from the end of this text for the chip ("Chapter 9"). |
| `unitTitle` | The chapter's title. |
| `section` | The topic (sub-heading) inside the chapter. "Where you stand" groups by this. |
| `kind` | The question type: `mcq`, `tf`, `multi`, `fill`, `order`, `match`, `sort` or `recall`. |
| `q` | The question text. |
| `explain` | Optional. Shown after the answer. |

Plus the fields for its type, listed in
[Question types and their fields](#question-types-and-their-fields).

**To add a question:** copy an existing question of the same type, paste
it into the list (mind the commas between entries), give it a new `id`,
and change the text.

**To remove a question:** delete its entry. Its saved progress is simply
ignored.

**Check your edit:** a missing comma breaks the whole file. Paste the file
into any JSON checker (search "JSON validator"), or run
`python3 -m json.tool questions.json > /dev/null` and look for an error.

## Change an answer or an explanation

Edit the question in `questions.json` and keep the same `id`. Your
progress for it stays. What to change:

| To change... | Edit this field |
|---|---|
| The explanation | `explain` |
| Multiple choice: which option is right | `answer` (0 is the first option, 1 the second, ...) |
| True or false | `answer`: `true` or `false` |
| Select all: which options are right | `answers`, a list of option numbers starting at 0 |
| Fill in the blank: accepted answers | `accept`, a list. The first one is shown as "Accepted answer". |
| Put in order: the right order | `items`, written in the correct order |
| Match: the pairs | `pairs` |
| Sort: which group an item belongs to | the item's `g` (0 for the first group) |
| Recall: the model answer | `a` |

---

## Question types and their fields

| `kind` | The reader... | Extra fields | Scoring |
|---|---|---|---|
| `mcq` | picks one option | `options`: list of texts. `answer`: index of the right one (from 0). | right or missed |
| `tf` | picks True or False | `answer`: `true` or `false` | right or missed |
| `multi` | ticks every option that applies | `options`, and `answers`: list of right indexes | all right: got it. Some right and none wrong: partly. Any wrong tick: missed. |
| `fill` | types a word or phrase | `accept`: list of accepted answers | Ignores capitals, punctuation and "the/a/an". Forgives one typo in answers of 6+ letters. Otherwise the reader says how close they were. |
| `order` | taps items from first to last | `items`: list in the **correct** order (shown shuffled) | all in place: got it. Half or more: partly. |
| `match` | links left items to right items | `pairs`: list of `["left", "right"]` | all right: got it. Half or more: partly. |
| `sort` | puts items into groups | `groups`: list of group names. `items`: list of `{"t": "text", "g": group index}` | all right: got it. Half or more: partly. |
| `recall` | answers from memory, then reveals | `a`: the model answer | the reader rates it: missed, partly, got it |

Examples of every type are in `questions.json`.

Marks: got it = 1, partly = 0.5, missed = 0. **Excellent** is over 90%
with more than 15 questions in one session, **Pass** is 60% or more,
**Fail** is under 60%.

---

## Add a new theme

A theme is one folder in `themes/`. You do not need to touch any code.

1. **Copy a theme folder** that is close to what you want, for example
   `themes/professional`, and rename the copy, e.g. `themes/forest`.
   The folder name is the theme's id (lower case, no spaces).
2. **Edit `theme.json`:** (set `"group"` to one of the picker groups, e.g. "Simple & pastel", "Playful", "Subjects", "Wellbeing & culture", or a new name)
   - `name`: shown under the tile in the picker.
   - `fonts.body` and `fonts.headings`: CSS font lists. To use a Google
     Font, add its name to `GOOGLE_FONTS` in `tools/build_themes.py`.
   - `shape`: corner roundness and border widths.
   - `light.colors` and `dark.colors`: the colours (see the table below).
   - `light.background` and `dark.background`: the page background as a
     list of CSS layers, top first. `url(background-light.svg)` uses a
     picture from the folder. End with `"var(--color-page)"`.
   - Optional per scheme: `buttonShadow`, `buttonShadowPressed`,
     `panelShadow`, `pressDepth`. Leave them out for the defaults.
   - `iconStroke`: how thick the arrow and tick on buttons are.
3. **Draw the pictures** (any SVG editor, or by hand):
   - `mascot.svg`: square, shown next to the title and faintly on the
     question card.
   - `start-icon.svg`: 24 by 24, on the Start button. Use
     `currentColor` for its colour so it matches the button text.
   - `background-light.svg`, `background-dark.svg`: optional patterns.
4. **Optional `extra.css`** for anything colours cannot do. Start every
   selector with `[data-theme="forest"]` so it only affects your theme.
5. **Add the id to `themes/picker-order.txt`** where you want its tile.
   (Themes not listed there go at the end.)
6. **Build:** `python3 tools/build_themes.py`. This rewrites
   `css/themes.css` and `js/themes-list.js`. Never edit those two by hand.
7. **Check it** in light and dark: open the page, press **Theme**, pick
   yours, and try a session.

### Colour roles

| In `theme.json` | Used for |
|---|---|
| `page` | the page behind the cards |
| `card` | the cards (panels) |
| `text` | normal text |
| `textMuted` | secondary text: hints, labels, notes |
| `border` | card and button outlines |
| `accent`, `accent2` | main buttons, chips, the title (a gradient from one to the other; use the same colour twice for a flat look) |
| `onAccent` | text on main buttons (must be readable on `accent`) |
| `onHero` | text on the big results card |
| `highlight` | the highlighter stripe behind the question |
| `correct`, `wrong`, `partly` | right, wrong and partly-right answers |
| `pop1` to `pop4` | playful accents: option numbers, progress bars, confetti, the streak |

Keep text readable: `text` on `card`, and `onAccent` on `accent`, should
have strong contrast in both light and dark.

---

## How the code works

### The files

```
index.html                 the page (all screens are here, shown and hidden)
questions.json             the book: its name, labels and questions

css/
  base.css                 colours (variables), page, panels, buttons
  home.css                 header, theme picker, progress, settings
  question.css             question card, options, feedback, timers
  question-types.css       the other question types
  results.css              the results screen
  themes.css               GENERATED: colours and pictures per theme
  phone.css                changes for narrow screens (loaded last)

js/
  helpers.js               creating elements, shuffling, wording counts
  book.js                  the loaded book: chapters, titles, labels
  progress-storage.js      saving and loading progress (localStorage)
  spaced-repetition.js     memory levels, due dates, streaks
  celebration.js           confetti
  timers.js                question timer, session clock, the top pill
  answer-feedback.js       after answering: record, verdict, explanation
  question-types/
    question-types.js      the registry every type adds itself to
    multiple-choice.js     mcq and tf
    select-all.js          multi
    fill-in-the-blank.js   fill
    put-in-order.js        order
    match-pairs.js         match
    sort-into-groups.js    sort
    recall.js              recall
  session.js               runs a session: one question after another
  results-screen.js        the end of a session
  home-screen.js           progress ring, recent results, where you stand
  home-layout.js           Settings screen, folding panels, Expand all, saved choices
  session-settings.js      the "What do you want to practise?" panel
  progress-file.js         download, load and reset progress
  main.js                  starts everything (loaded last)
  theme-picker.js          light/dark/system and theme tiles (in <head>)
  themes-list.js           GENERATED: the list of themes

themes/<id>/               one folder per theme (see "Add a new theme")
tools/build_themes.py      builds css/themes.css and js/themes-list.js
tools/extract_book.py      book (PDF/EPUB) to text, for writing questions
tools/plan_question_bank.py   questions per chapter and per type
tools/merge_question_bank.py  checks questions and builds questions.json
tools/pack_template.py     packs the site into one text file and back
tests/run_tests.py         browser tests
ai-context/                notes for AI agents (and curious humans)
```

### How the pieces talk to each other

Every script adds its part to one shared object, `window.RecallQuiz`
(called `quiz` inside the files): `quiz.book`, `quiz.progress`,
`quiz.memory`, `quiz.timers`, `quiz.session`, and so on. The scripts are
plain files loaded in order by `index.html`, so the page also works when
opened straight from a folder.

### What happens when you practise

```
main.js            reads questions.json
  -> book.js           remembers the book and its chapters
  -> progress-storage  loads your saved progress for this book
  -> home-screen       draws the start screen

Start button
  -> session-settings  picks and shuffles the questions
  -> session.js        shows the first question:
       progress bar or clock, chapter and topic, the question,
       then asks the question type to draw its answer controls
  -> question type     waits for an answer, then calls card.showResult()
  -> answer-feedback   records it (spaced-repetition saves it),
                       shows the verdict, explanation and Next
  -> session.js        next question ... and at the end
  -> results-screen    percentage, verdict, what to reread,
                       and saves it to "Your recent results"
```

### Spaced repetition

Each question has a memory level from 0 to 4. Right moves it up one,
missed sends it to 0, partly keeps it. The level decides when it is due
again: 0, 1, 3, 7 or 21 days. "Due and new" asks questions you have never
seen plus those whose day has come. "My gaps" asks questions you have
missed that are still at level 0 or 1. Level 3 or more counts as "solid".
The numbers are at the top of `js/spaced-repetition.js`.

### Saved progress

Saved in the browser under `recall-quiz:<book id>`, with readable names
(`memoryLevel`, `nextReview`, ...). The format is described at the top of
`js/progress-storage.js`. Older saves are upgraded automatically. Use
**Download** to keep a backup or to move to another device. The theme
choice is saved once for all books under `recall-quiz:theme` and, when you are signed in, follows your account to other devices.

### Themes

`tools/build_themes.py` reads each `themes/<id>/` folder and writes one
block of CSS variables per theme and light/dark (`css/themes.css`). The
page switches theme by setting `data-theme` and `data-scheme` on the
`<html>` element; the stylesheets only ever use the variables, so every
part of the page follows the theme.

---

## Add a new question type

1. Create `js/question-types/<your-type>.js`. Copy `multiple-choice.js` as
   a starting point. Register the type:

   ```js
   quiz.questionTypes.register("your-kind", {
     label: "Shown above the question",
     show: function showYourType(question, card) {
       // Draw your controls into card.answerArea.
       // When the reader has answered:
       card.showResult("got");   // or "part" or "miss"
     },
   });
   ```

   What `card` offers (see `createQuestionCard` in `js/session.js`):
   `answerArea`, `setKeyHint(text)`, `setKeyHandler(fn)`,
   `setTimeUpHandler(fn)`, `stopTimer()`, `isWaitingForConfidence()`,
   `showResult(result, {timedOut, extraContent})` and
   `saveSelfRating(result)`.
2. Add a `<script>` line for it in `index.html`, next to the other types.
3. Add its styles to `css/question-types.css`, using the colour variables
   (`var(--color-...)`) so it works with every theme.
4. Add an example question to `questions.json` and a branch for it in
   `answer_question` in `tests/run_tests.py`.

---

## Testing

```bash
pip install playwright && playwright install chromium   # once
python3 tests/run_tests.py
```

It checks that every file the page links to exists and that every
question in `questions.json` has the right fields. Then it opens the
page in a hidden browser and answers questions right and wrong (all of
them for a small bank; a few of each type for a large one, or all with
`--all`), and checks the confidence check, both timers, the upgrade of
older saved progress, custom labels, themes and the phone layout. Run
it after any change to the code.

## Code style

- Long, clear names: `showAnswerFeedback`, not `settle`.
- One job per function, with a short comment saying what it does.
- Lines under 80 characters, 2-space indentation.
- Colours only through CSS variables, so themes keep working.
- Class names describe what something is (`.question-card`); states start
  with `is-` (`.is-right`, `.hidden` hides).
- The book content (`questions.json`) and the generated
  `css/themes.css` are exempt from the line-length rule.

More detail for contributors and AI agents is in
[`ai-context/`](ai-context/).
