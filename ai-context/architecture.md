# Architecture

## Shape of the app

```
index.html  (all screens live here; JS shows and hides them)
│
├─ <head>  js/asset-base.js (first), css/*.css, js/default-settings.js,
│           js/themes-list.js, js/theme-picker.js
│           theme-picker applies the saved theme before first paint
│
└─ end of <body>: the app scripts, in this order
     js/helpers.js
     js/transliteration.js, js/math-display.js
     js/book.js
     js/media-store.js
     js/rich-content.js
     js/progress-storage.js
     js/spaced-repetition.js
     js/celebration.js
     js/timers.js
     js/answer-feedback.js
     js/question-types/question-types.js     (the registry)
     js/question-types/*.js                  (each registers itself)
     js/session.js
     js/results-screen.js
     js/home-screen.js
     js/session-settings.js
     js/progress-file.js
     js/main.js                              (starts the app; keep last)
```

## The shared object

Each app file is an IIFE that receives `window.RecallQuiz` as `quiz` and
adds one namespace to it (`js/theme-picker.js` is separate: it runs in
`<head>` and does not use `quiz`). Nothing else is global (apart from
`window.QUIZ_THEMES`, `window.QUIZ_THEME_FONTS` and
`window.QUIZ_FONT_SPECS` from the generated `js/themes-list.js`).

| Namespace | File | Owns |
|---|---|---|
| `quiz.helpers` | helpers.js | `findElement`, `createElement`, `createButton`, `createCheckButton`, `createParagraph`, `shuffledCopy`, `countWithWord`, `formatOneDecimal`, `readWholeNumber`, `prefersReducedMotion` |
| `quiz.media` | media-store.js | `load(entry)`, `prefetch(entries)`, `setKeyProvider(fn)`: opens encrypted pictures and clips; gives null (so the text shows) without a key. cloud-sync.js sets the provider from the adapter's `readMediaKey` on sign-in and clears it on sign-out; figures retry on `recallquiz:media-key-changed` |
| `quiz.rich` | rich-content.js | `createCode`, `createMedia`, `appendExtras`, `createBlocks`, `createGenreChip`: the v2 card and question extras |
| `quiz.book` | book.js | the loaded `questions.json` (`data`), `labels`, `unitIds`, `unitTitles`; `setBookData`, `allQuestions`, `bookId`, `unitShortName`, `unitFullName`, `questionsInUnit` |
| `quiz.progress` | progress-storage.js | `saved` (the progress object), `openForBook`, `saveProgress`, `replaceProgress`, `eraseProgress`, `looksLikeProgress`; version upgrades |
| `quiz.memory` | spaced-repetition.js | `recordAnswer`, `isDueOrNew`, `isWaitingForReview`, `isGap`, `isSolid`, `isLearning`, `timesMissed`, `currentDayStreak`, `countAnsweredToday` |
| `quiz.celebrate` | celebration.js | confetti burst (skipped for reduced motion) |
| `quiz.timers` | timers.js | per-question timer, session clock, the top-right pill |
| `quiz.answerFeedback` | answer-feedback.js | `showAnswerFeedback`, `recordResult`, `createRereadHint`, `createConfidenceRow` |
| `quiz.questionTypes` | question-types/question-types.js | `register`, `labelFor`, `show`, `resultFromCount` (+ `createOptionButton` added by multiple-choice.js) |
| `quiz.session` | session.js | `state` (the running session), `startSession`, `goToNextQuestion`, `returnHome`; global keydown routing |
| `quiz.resultsScreen` | results-screen.js | `showResults` |
| `quiz.homeScreen` | home-screen.js | `showBookDetails`, `refresh` |
| `quiz.reading` | reading-settings.js | per-book font size, font, line spacing, width, page and text colour; `configure`, `useBook`, `current`, `change`, `reset`; writes `--reading-*` and the colour variables on `<html>` |
| `quiz.readingPanel` | reading-panel.js | `create(options)`: the gear button and the Reading settings panel (shared with the ereader) |
| `quiz.titleBar` | title-bar.js | the sticky bar and its two drawers: `showHome`, `showQuestion`, `showResults`, `closeDrawers` |
| `quiz.settings` | session-settings.js | `current` (the panel's choices), `chooseQuestionsForSession`, `sessionMinutes`, `scopeName`, `updateReadySummary` |

Load order matters in four ways, so keep the order in `index.html`:

- every file reads `quiz.helpers` when it loads, so `helpers.js` is
  first;
- each question type calls `quiz.questionTypes.register` when it loads,
  so `question-types.js` comes before the type files, and
  `multiple-choice.js` (which adds `createOptionButton`) before
  `select-all.js`;
- session-settings, progress-file and session wire DOM events when they
  load (the DOM exists because the scripts are at the end of `<body>`);
- `main.js` starts the app, so it is last.

Apart from that, modules call each other only inside functions.

## State

There are three pieces of state. Everything else is derived.

1. **`quiz.book`**: the book. Set once by `main.js` from questions.json.
2. **`quiz.progress.saved`**: the reader's progress for this book, saved
   to localStorage after every answer. Format in
   [data-formats.md](data-formats.md).
3. **`quiz.session.state`**: the session in progress: question queue,
   current index, score, missed questions, copied settings, confidence
   level, the current keyboard handler. Reset by `startSession`.

`quiz.settings.current` holds the setup panel's choices; a session copies
what it needs at start.

## Session flow

```
startSession()                                    session.js
  settings.chooseQuestionsForSession()  -> shuffled, maybe sliced
  resetState(); timers.startSessionClock() if timed
  showCurrentQuestion()
     ├─ progress segments, or timers.createSessionClockBar()
     ├─ timers.createQuestionTimer()          if a per-question timer
     ├─ meta (chapter chip, topic, type label), question text
     ├─ answerFeedback.createConfidenceRow()  if confidence check on
     ├─ questionTypes.show(question, card)    the type draws controls
     └─ "End session" button

the question type ... calls card.showResult(result, options)
  answerFeedback.showAnswerFeedback()
     ├─ timers.stopQuestionTimer(), unlock answer area
     ├─ recordResult()  -> session score + memory.recordAnswer()
     │                     (which saves progress)
     └─ verdict, extra content, explanation, reread hint, Next button

Next (button, Enter or Space) -> session.goToNextQuestion()
  -> showCurrentQuestion() for the next index,
     or resultsScreen.showResults() after the last one
     or if the session clock ran out while feedback was showing

resultsScreen.showResults()
  stop timers, compute marks and verdict, save to recentResults,
  draw results; "Practise again" = returnHome() + startSession()
```

Recall questions are different: after revealing the answer they call
`card.saveSelfRating(result)`, which records the result and moves on
without the feedback panel.

## The `card` object (question type API)

Built per question by `createQuestionCard` in `js/session.js`. A question
type must only use this object, never `quiz.session.state` directly.

| Member | Use |
|---|---|
| `answerArea` | element to draw controls into |
| `setKeyHint(text)` | the "Keys: ..." line under the controls |
| `setKeyHandler(fn)` | receives keydown events (null to clear). The global handler already ignores modifier keys, a locked answer area, and Enter/Space on focused buttons, and calls `preventDefault` for Enter/Space. |
| `setTimeUpHandler(fn)` | called once if the per-question timer runs out |
| `stopTimer()` | stop the per-question timer early |
| `isWaitingForConfidence()` | true until a confidence level is picked |
| `showResult(result, {timedOut, extraContent})` | record and show feedback; `result` is `"got"`, `"part"` or `"miss"` |
| `saveSelfRating(result)` | record and go straight to the next question |

## Themes pipeline

```
themes/<id>/theme.json + *.svg + extra.css
        │  python3 tools/build_themes.py
        ▼
css/themes/<id>.css  :root[data-theme='<id>'][data-scheme='light|dark']
                   { --color-*, --font-*, --radius*, --page-background,
                     --mascot-image, --icon-*, --accent-gradient, ... }
                   + the theme's extra.css
                   (loaded by theme-picker.js, only for the theme in use)
css/theme-tiles.css  .theme-tile[data-theme-id='<id>'] { --tile-* }
                   (loaded when the Appearance section is opened)
js/asset-base.js   window.RecallQuizAssetBase: "" when the shared files
                   sit next to the page, or the CDN folder when this
                   script came from another site; the four places that
                   build a path to a shared file at run time (theme-picker,
                   math-display, cloud-sync, htrab) put it in front
js/boot.js         only in a book's loader index.html (favicon + boot.js):
                   fetches this template's index.html from the same CDN
                   folder, prefixes its css/, js/, htrab/ addresses and
                   replaces the page with it (document.write, so the
                   start-up order is unchanged)
js/default-settings.js  window.RecallQuizDefaults: every first-time
                    default (theme, shown controls, practice, home
                    layout, Settings sections); loaded first
js/themes-list.js  window.QUIZ_THEMES, QUIZ_THEME_FONTS (families per
                   theme), QUIZ_FONT_SPECS (how to ask Google Fonts)
```

`js/theme-picker.js` (in `<head>`) sets `data-theme`, `data-mode`
(reader's choice: light, dark, system) and `data-scheme` (what shows:
light or dark) on `<html>`. Defaults for every variable are in
`css/base.css` (the Classic light colours).

## CSS layout

Load order (later wins on equal specificity): `base.css`, `home.css`,
`question.css`, `question-types.css`, `results.css`, `phone.css`. The
theme's own CSS is added just before `phone.css` by `theme-picker.js`. Each rule is written once with its final value; there are
no "override" layers. Theme `extra.css` rules are scoped with
`[data-theme="<id>"]`, so they win by specificity.

## Where to change what

| Change | Place |
|---|---|
| wording on the home screen | `index.html` (static) or `js/home-screen.js` / `js/session-settings.js` (dynamic) |
| scoring and verdict thresholds | constants at the top of `js/results-screen.js` (the rules text is built from them) |
| review intervals, "solid" level | constants at the top of `js/spaced-repetition.js` |
| fill-in-the-blank matching | `js/question-types/fill-in-the-blank.js` |
| a new setting on the setup panel | `index.html` + `js/session-settings.js` (`current`, a choice group), then read it in `resetState` in `js/session.js` |
| phone layout | `css/phone.css` only |
| a theme's look | `themes/<id>/`, then rebuild |


## Learning layer (Learn mode)

- `js/learning.js` (loaded after `spaced-repetition.js`): concept status
  (new, learning, understood, solid, locked) derived from question
  records, and `createLearnPlan` which builds the step list (pretest,
  lesson card, ladder, interleaved reviews).
- `js/question-types/lesson.js`: the concept card, a step of kind
  `lesson`. Not scored and not timed.
- `js/session.js` takes a plan (`startSession(plan)`, `startLearning`,
  `startQuestions`). `js/session-settings.js` offers Keep me going (`createKeepGoingPlan` in learning.js) and custom practice. There are no modes; `strictOrder` in the bank restores locking.
- Pretest runs (`isPretestRun`) go through `quiz.memory.recordPretest`
  and are never scored; the question comes back later as a normal one.
- M3 additions in `learning.js`: `createQuickPlan` (core ideas only),
  `addEasyEnding` (a session ends on an easy review), `weakPartOf`
  (where an idea breaks, from the saved records), `isCore`. The results
  screen leads with "what went right" and the average of five sessions.
- `js/main.js` loads `questions.json`, or a file in `banks/` named by
  `?bank=banks/name.json`.
- Events sent for add-ons: `recallquiz:book-opened`,
  `recallquiz:question-shown` (question, cardElement),
  `recallquiz:feedback-shown` (question, result, feedback),
  `recallquiz:progress-saved`, `recallquiz:session-finished`. The HTRAB
  overlay in `htrab/` listens to these and nothing else in the app calls
  it.
- Optional sync lives in `js/sync/` and talks to the page only through
  the events `recallquiz:progress-saved`, `recallquiz:book-opened` and
  `recallquiz:session-finished`.

## Home view (structure or ideas)

`js/home-screen.js` draws the chapter list in `showWhereYouStand`. A switch
(`recall-quiz-home-view`, or `?view=`) picks "Chapter structure" (default:
chapters, then topics, each opening to its ideas) or "Ideas" (chapters
holding a flat list of ideas). A book without ideas shows its topic list in
the structure view and a short note in the ideas view.


## Encrypted book sites (3.0.0)

`js/unlock.js` (loaded first, `window.SubjectUnlock`) gets the subject key
and publishes `window.RecallQuizSubjectKey` (CryptoKey, AES-GCM) and
`window.RecallQuizSubjectKeyBase64`. When a page sets
`window.RecallQuizEncrypted = { questions: "quiz/questions.enc" }`,
`js/early-questions.js` waits for the key, fetches and decrypts that file
(RQE1 format, see `tools/book_build/encfmt.py`). `js/encrypted-book.js`
hands the base64 key to `media-store.js`, and `cloud-sync.js` then leaves
the picture key alone. `reader/app.js` is the reader; it also calls
`SubjectUnlock.ready()`.

Building the encrypted book (`tools/book_build/`): `extract_epub.py` cuts
the EPUB by the chapter map (`book-structure/chapters.json`), `build_site.py`
places ideas and questions, `add_notes.py` adds the notes EPUB.
- The navigation is `toc.ncx` next to the package file, or the NCX the
  package declares (`epubnav.read_ncx`). The cover is the `cover` meta or the
  item with `properties="cover-image"`.
- Units named `Chapter N` (and `Appendix`) are cut from their nav entry.
  Any other unit that lists `sections` (Foreword, Preface, Introduction,
  Conclusion, Afterword, ...) is cut too: a nav entry belongs to the section
  whose title starts with the entry's title up to its colon ("Foreword: to the
  50th ..." belongs to "Foreword to the 50th Anniversary Edition: Ten
  Lessons ..."). Each such file opens a level-2 node, its split title blocks
  are dropped, and later sections of the unit are found in the text by title.
  A unit with no sections has no text: it gets one empty node that holds all
  its ideas and questions, and its group is "The whole book".
- Books whose EPUB has no heading tags (headings are styled paragraphs):
  list every heading in `sections`, in book order, and put the titles that
  are subtopics of the section listed before them in the chapter's
  `"subsections"` list; they become level-3 nodes. A line holding only a
  number right above a listed title is left out of the text, a table (a
  play script) is kept as one paragraph per speaker, and the unit's own
  title line is not text, so an empty "Opening" node is not made.
- Notes: `u_chN.xhtml` or `chapter_N.xhtml` for chapter N. For the other
  units, a notes file whose `<h1>` is the first words of a section title
  (`foreword.xhtml` with `<h1>Foreword</h1>`) becomes that section's note;
  its `h3`/`h4` headings match nodes by title, and any that do not stay on
  that section.

The reader wears the quiz themes: `reader/style.css` imports
`css/theme-defaults.css` and `css/reading-panel.css`, maps its old colour
names to the `--color-*` variables, and `reader/app.js` loads
`js/default-settings.js`, `themes-list.js`, `theme-picker.js`, `helpers.js`,
`reading-settings.js` and `reading-panel.js` from the same tagged folder as
itself (the folder is the script's own address). The theme and the reading
settings are saved per book and shared with the quiz (see data-formats.md).
Both views use the same gear panel: Mode, Theme, Font size, Font, Line
spacing, Page width, Background, Text colour, then a footer of Reset, Subject
page (the folder above the book) and Book home or Quiz home. The ereader adds
a "Show" section. `data-theme` on `<html>` is the quiz theme id only; the old
reader values (white, sepia, dark, black) are gone.

The quiz page has a sticky bar (`js/title-bar.js`, markup in `index.html`):
left drawer = chapters and topics; right drawer = ideas with status chips on
the home screen, and the steps of the session in a session (`session.state
.results[i]` holds "got", "part", "miss" or "seen" for a card; `session
.jumpTo(i)` opens an answered step read-only, or jumps to an unseen one).
In both drawers a chapter opens and closes with a chevron (closed to
start with, except the chapter of the question on screen), with "Open all"
and "Close all" above.

Every step on screen (a question, or one looked at again) has a
"Back | Question n of N | Next" row under the progress bar, and a sideways
swipe on `#question-card` does the same (`session.js`: `createStepNav`,
`goToStep`, `setUpSwipe`; vertical scrolling is left to the browser with
`touch-action: pan-y pinch-zoom`). Next or a swipe can skip a question;
`goToNextQuestion` comes back to skipped ones after the last step, so the
results come only when nothing is left unanswered.
The bar changes through the events `recallquiz:question-shown`,
`recallquiz:home-shown` and `recallquiz:results-shown`. Pages are written by `tools/make_subject_pages.py`.

`tools/site/` (`build_hub.py`, `add_book.py`, `set_template_tag.py`,
`publish_book.sh`) works on a subject site checkout (`--subject-root`, default
the current folder): it checks book folders, writes `books.json`, copies a
built book in and pushes. Tests: `tests/test_site_tools.py`.
