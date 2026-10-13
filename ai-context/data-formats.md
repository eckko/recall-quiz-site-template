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

Everything the reader sets is kept **per book**, in `localStorage` key
`recall-quiz-book:<bookId>` (`js/book-settings.js`):
`{version: 2, layout, flags, ideaFlags}`. `layout` is owned by `js/home-layout.js`
(a value the reader never saved comes from `js/default-settings.js`, so
change a first-time default there, not in the code):
folding keys (`progress`, `recent`, `setup`, `stand` = "open"|"closed";
`chapters` "next"|"open"|"closed"; `inner`), practice defaults (`timer`
0/15/30/60, `confidence`, `htrab`, `count` (0 = all), `minutes`, `scope`
`{unit, section?, concept?}`, `filter` all|due|gaps|important, `lengthMode`),
`customStart` (auto|open|closed), `show` (`setup`, `keepGoing`, `timer`,
`confidence`, `htrab`, `quick`, `custom`, `filter`, `filterDue`,
`filterGaps`, `filterImportant`, `filterAll`, `length`, `flagBar`,
`ideaFlagBar`; hidden controls still apply their defaults. `keepGoing`
(the button, its "Up next" line and the hint), `filterDue` and `filterGaps`
are hidden until shown; a key that is missing takes that default. When all
four `filter*` options are hidden the whole row is hidden and the default
`filter` is used) and `at` (last change). Theme is per book too:
`recall-quiz:theme:<bookId>` = `{v: 1, t, m, a}`; the global
`recall-quiz:theme` is only the last theme shown, to avoid a flash.
Flags: `flags: {questionId: {f: ["bad"|"revisit"|"useless"|"important"],
a: time}}`. Bad and Useless hide the question (`quiz.book.setHiddenIds`).
`ideaFlags` has the same shape, keyed by idea (concept) id, and is kept
apart from question flags: Bad and Useless hide only the idea from the idea
lists (`quiz.learning.concepts()`), never its questions; Important ideas
are offered first in Keep me going. Version 1 records had no `ideaFlags`;
`MIGRATIONS[1]` adds it.
Versioning: bump `CURRENT_VERSION` and add a step to `MIGRATIONS[N]` (N to
N+1); newer-version data is read-only and never overwritten. The tab's
practice overrides (`sessionStorage`
`recall-quiz-practice-override:<bookId>`, `{v: 1, ...}`) are versioned the
same way. Account: one document per book, `_settings:<bookId>`:
`{v: 2, layout, flags, ideaFlags, theme: {t, m, a}}` (newest `at` wins for
layout and theme; flags and idea flags merge per item by time). Sign-in is global.
Code: `js/home-layout.js` (Settings screen,
folding, Expand all), `js/session-settings.js` (`readChoices`/`useChoices`),
`htrab/htrab.js` (`quiz.htrab.isOn`/`useRemote`). The HTRAB On/Off switch is
shown on the Settings screen; its level/stage picker stays on the home screen.
The sign-in bar shows on the home screen only when the reader must act
(signed out, error); the Account section of Settings always shows. Every
Settings section is a folded `<details>` that starts closed on each visit
(nothing is remembered); its title carries a short summary (`<id>-current`),
and Account's is the signed-in name.

Practice values in this record are *defaults*. A change made on the home
screen is an override kept in `sessionStorage` key
`recall-quiz-practice-override` (this tab only, never synced); the home
screen shows defaults plus overrides. Setting a default on the Settings
screen clears that choice's override. `theme.json` may carry `"group"`; the
picker shows one group at a time (`window.QUIZ_THEMES` entries are
`[id, name, group]`).

## Template v2 fields

All optional. Banks without them work exactly as before. Checked by
`tools/check_rich_content.py` (called from `validate_bank.py`).

| Where | Field | Meaning |
|---|---|---|
| bank | `genre` | short label shown as a chip on every card (concept `genre` wins) |
| bank | `sourceUse` | `paraphrase` (default), `quotes`, `quotes+images`. The last two are only for books whose media is encrypted |
| bank | `mediaStore` | `repo` (default): files in `media/` of the same repo. `mediaBase` changes the folder |
| concept | `genre` | chip text, 30 characters at most |
| `card` | `blocks` | 1 to 6 `{label, text, code, lang, media}` shown after the paragraphs. A card may have blocks and no paragraphs |
| question, block | `code`, `lang` | a code listing, shown as text in a `<pre>` (never parsed) |
| question, block | `media` | `[{id or src, alt, role, type}]`. `alt` is required unless `role` is `decorative`, because a question must be answerable from text |

Media files: `media/<id>.enc` is a 12-byte nonce plus AES-GCM data. The
file key is HKDF-SHA-256 of the book key with info `file:<id>`, and the
id is the authenticated data. `tools/encrypt_media.py` writes them; the
nonce is a keyed hash of the content, so a rebuild gives identical bytes.
The book key is never in the site: `quiz.media.setKeyProvider(fn)` is
called by whatever signs the reader in (the Firebase document that holds
the key must be readable only by the reader's account). Without a key the
card or question shows the `alt` text. Sizes: 3 MB a clip, 100 MB a book.
