# Data formats

## questions.json

```json
{
  "id": "thinking-fast-and-slow",
  "book": "Thinking, Fast and Slow",
  "labels": { "unit": "Chapter", "units": "chapters",
              "topic": "Topic", "whole": "Whole book" },
  "questions": [ { ...question... } ]
}
```

- `id` (string, required in practice): localStorage key suffix. Changing
  it orphans saved progress. Falls back to `"book"`.
- `book` (string): page title.
- `labels` (object, optional): any subset; merged over the defaults in
  `js/book.js`.
- `questions` (array, required, non-empty).

### Common question fields

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | yes | unique, stable; progress key |
| `unit` | string | yes | chapter id as displayed, e.g. `"Chapter 9"`; the number shown in the chip is everything after the first non-digits (`/^\D+/` removed) |
| `unitTitle` | string | no | chapter title |
| `section` | string | yes | topic within the chapter; "Where you stand" groups by it |
| `kind` | string | yes | one of the kinds below; unknown kinds fall back to `mcq` |
| `q` | string | yes | question text (plain text, never HTML) |
| `explain` | string | no | shown in the feedback |

### Kind-specific fields

| kind | fields | notes |
|---|---|---|
| `mcq` | `options: string[]`, `answer: number` | index from 0. Label is "Core idea", or "Structure: why the book is built this way" when `section` matches `/place in the argument\|how this chapter\|part overview/i` |
| `tf` | `answer: boolean` | |
| `multi` | `options: string[]`, `answers: number[]` | |
| `fill` | `accept: string[]` | first entry is shown as the accepted answer |
| `order` | `items: string[]` | in the correct order; displayed shuffled |
| `match` | `pairs: [string, string][]` | right column shuffled |
| `sort` | `groups: string[]`, `items: {t: string, g: number}[]` | `g` is a group index; the CSS styles two groups distinctly |
| `recall` | `a: string` | the model answer; `explain` is not shown for recall |

All text is inserted with `textContent`, so HTML in questions is shown
literally (safe by design).

## Saved progress (localStorage)

Key: `recall-quiz:<book id>`. Current format, version 2:

```json
{
  "version": 2,
  "questions": {
    "<question id>": {
      "memoryLevel": 0,
      "timesSeen": 1,
      "timesMissed": 1,
      "nextReview": 1759660000000,
      "lastAnswered": 1759660000000,
      "confidentMisses": 0
    }
  },
  "daysPracticed": ["2026-10-5"],
  "recentResults": [
    {
      "finishedAt": 1759660000000,
      "percent": 75,
      "marks": 7.5,
      "questionCount": 10,
      "verdict": "pass",
      "scopeName": "Whole book",
      "secondsPerQuestion": 0,
      "sessionMinutes": 0
    }
  ]
}
```

- Times are milliseconds since 1970 (`Date.now()`).
- `daysPracticed` keys are `year-month-day` with **no zero padding**
  (`dayKey` in `js/spaced-repetition.js`).
- `recentResults` is newest first, at most 5.
- `verdict` is `"excellent"`, `"pass"` or `"fail"`.

### Version 1 (older saves and backups)

```json
{ "items": { "<id>": { "box", "seen", "missed", "due", "last", "cm" } },
  "days": [ ... ],
  "history": [ { "t", "pct", "marks", "total", "v", "scope",
                 "limit", "mins" } ] }
```

Mapping: box→memoryLevel, seen→timesSeen, missed→timesMissed,
due→nextReview, last→lastAnswered, cm→confidentMisses, days→daysPracticed,
history→recentResults (t→finishedAt, pct→percent, total→questionCount,
v→verdict, scope→scopeName, limit→secondsPerQuestion,
mins→sessionMinutes). `upgradeSavedProgress` in
`js/progress-storage.js` converts on every read, including loaded
backups. If you change the format: bump `CURRENT_VERSION`, add an
`upgradeFromVersionTwo`, and add a test.

### Backups

"Download" writes `quiz.progress.saved` as `<book id>-progress.json`.
"Load" accepts any object with `questions` (v2, even without a
`version` field) or `items` (v1), and refuses a `version` newer than
this code knows.

## Theme choice

Key: `recall-quiz:theme` (shared by every book on the same site), value
`{"t": "<theme id>", "m": "light" | "dark" | "system", "a": <ms>}`. The
short keys are kept for compatibility with existing saves. `a` is when the
reader last picked the theme (0 or missing if never); cloud sync keeps the
newest choice. When signed in, the choice is also stored in the account as
a document called `_settings` (same place and rules as a book's progress):
`{"theme": {"t": ..., "m": ..., "a": ...}}`.

## Home view choice

Key: `recall-quiz-home-view`, value `"structure"` (default) or `"ideas"`.
`?view=ideas` in the address overrides it. Kept in this browser only.

## theme.json

```json
{
  "name": "Lego",
  "fonts": { "body": "CSS font list", "headings": "CSS font list" },
  "shape": { "radius": "10px", "smallRadius": "6px",
             "borderWidth": "2px", "strongBorderWidth": "3px" },
  "iconStroke": { "width": 3.6, "cap": "butt", "join": "miter" },
  "light": {
    "colors": { "page", "card", "text", "textMuted", "border", "accent",
                "accent2", "highlight", "correct", "wrong", "partly",
                "pop1", "pop2", "pop3", "pop4", "onAccent", "onHero" },
    "background": [ "layer", ["long ", "layer in pieces"], "var(--color-page)" ],
    "buttonShadow": [ "layer" ],          // optional
    "buttonShadowPressed": [ "layer" ],   // optional
    "panelShadow": [ "layer" ],           // optional
    "pressDepth": "4px"                   // optional
  },
  "dark": { ...same as light... }
}
```

- All 17 colours are required in both schemes.
- A CSS value given as a list is joined with `", "` (layers). A layer
  given as a list of strings is joined with nothing (lets long values
  stay on short lines).
- `url(file.svg)` inside a background is replaced with the file's
  contents as a data URI.
- `start-icon.svg` should use `currentColor`; the build replaces it with
  `onAccent` for each scheme.
- Required files: `theme.json`, `mascot.svg`, `start-icon.svg`.
  Optional: `background-light.svg`, `background-dark.svg`, `extra.css`.

Generated variable names: see `COLOR_VARIABLES`, `OPTIONAL_VARIABLES`
and `theme_variables` in `tools/build_themes.py`.

## Formulas and Sanskrit text in questions

- **Formulas:** write them as `\(x^2\)` (inline) or `\[x^2\]` / `$$x^2$$`
  (own line). In JSON the backslash is doubled: `"\\(x^2\\)"`. Single
  dollar signs are never formulas, so "$5" stays text. `js/math-display.js`
  loads KaTeX from `vendor/katex/` only when a question holds a formula.
- **Devanagari and IAST:** fill-in answers are compared through
  `js/transliteration.js`, so `धर्म`, `dharma`, `Dharma` and `dharmā` match.
  Still list the main accepted spellings in `accept`. A one-letter typo is
  forgiven in answers of 6+ letters, as for English.
- The theme font stacks end with system Devanagari fonts (set in
  `tools/build_themes.py`).


## Concepts and teaching fields (optional)

A bank may add a top-level `concepts` list and per-question `concept`,
`role`, `rung`, `optionExplain`, `explain`, `rule`, `teaches`, `hint`.
The full schema and rules are in `learning-design.md`. Saved progress is
unchanged (format v2). M3 adds optional bank fields: top-level `summary`
and `unitSummaries`; per concept `question`, `core`, `htrab` and
`card.limits`; per question `htrab`. See `learning-design.md`. Saved
progress is still unchanged (format v2): a pretest only adds `pretested` and
`pretestResult` to a question record; concept status is derived.

## Settings (home layout and practice defaults)

`localStorage` key `recall-quiz-home-layout` holds `{progress, recent, setup,
stand, chapters, inner, timer, confidence, htrab, units, at}`:
panels `progress`/`recent`/`setup`/`stand` are "open" | "closed"; `chapters`
is "next" | "open" | "closed"; `inner` is "closed" | "open"; `timer` is
0/15/30/60; `confidence` and `htrab` are booleans; `units` maps book id to the
chapter picked; `at` is the time of the last change. In the account, the
`_settings` document holds `layout: {p, r, s, w, c, i, t, f, h, u, a}` next to
`theme`; the newest `a` wins. Code: `js/home-layout.js` (Settings screen,
folding, Expand all), `js/session-settings.js` (`readChoices`/`useChoices`),
`htrab/htrab.js` (`quiz.htrab.isOn`/`useRemote`). The HTRAB On/Off switch is
shown on the Settings screen; its level/stage picker stays on the home screen.
The sign-in bar shows on the home screen only when the reader must act
(signed out, error); the Account section of Settings always shows.

Practice values in this record are *defaults*. A change made on the home
screen is an override kept in `sessionStorage` key
`recall-quiz-practice-override` (this tab only, never synced); the home
screen shows defaults plus overrides. Setting a default on the Settings
screen clears that choice's override. `theme.json` may carry `"group"`; the
picker shows one group at a time (`window.QUIZ_THEMES` entries are
`[id, name, group]`).
