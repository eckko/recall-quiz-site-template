# Architecture

## Shape of the app

```
index.html  (all screens live here; JS shows and hides them)
│
├─ <head>  css/*.css, js/themes-list.js, js/theme-picker.js
│           theme-picker applies the saved theme before first paint
│
└─ end of <body>: the app scripts, in this order
     js/helpers.js
     js/transliteration.js, js/math-display.js
     js/book.js
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
`window.QUIZ_THEMES` and `window.QUIZ_THEME_FONTS_URL` from the generated
`js/themes-list.js`).

| Namespace | File | Owns |
|---|---|---|
| `quiz.helpers` | helpers.js | `findElement`, `createElement`, `createButton`, `createCheckButton`, `createParagraph`, `shuffledCopy`, `countWithWord`, `formatOneDecimal`, `readWholeNumber`, `prefersReducedMotion` |
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
css/themes.css     :root[data-theme='<id>'][data-scheme='light|dark']
                   { --color-*, --font-*, --radius*, --page-background,
                     --mascot-image, --icon-*, --accent-gradient, ... }
                   + .theme-tile[data-theme-id='<id>'] { --tile-* }
                   + the theme's extra.css
js/themes-list.js  window.QUIZ_THEMES, window.QUIZ_THEME_FONTS_URL
```

`js/theme-picker.js` (in `<head>`) sets `data-theme`, `data-mode`
(reader's choice: light, dark, system) and `data-scheme` (what shows:
light or dark) on `<html>`. Defaults for every variable are in
`css/base.css` (the Classic light colours).

## CSS layout

Load order (later wins on equal specificity): `base.css`, `home.css`,
`question.css`, `question-types.css`, `results.css`, `themes.css`,
`phone.css`. Each rule is written once with its final value; there are
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
