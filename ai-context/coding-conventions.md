# Coding conventions

The goal is code a person can read top to bottom and change without
fear. When in doubt, match the file you are editing.

## JavaScript

- Plain browser JavaScript, `"use strict"`, `const`/`let`, no modules,
  no frameworks, no dependencies.
- One file per responsibility. Each app file is an IIFE that takes
  `(window.RecallQuiz = window.RecallQuiz || {})` as `quiz` and adds one
  namespace (see [architecture.md](architecture.md)). Exceptions:
  `js/theme-picker.js` (runs in `<head>` before the app, uses no `quiz`)
  and the generated `js/themes-list.js`.
- Every file starts with a comment saying what it is for.
- Every function has a JSDoc comment: one line on what it does, plus
  `@param` and `@returns` where they help.
- One job per function. If a function needs a comment in the middle to
  explain a second step, split it.
- Long, descriptive names. Functions are verbs (`showAnswerFeedback`,
  `createProgressSegments`), booleans read as questions (`isChecked`,
  `isPastFirstQuestion`), collections are plural. Short
  inline callbacks are named instead of documented
  (`function markOption(...)`), which also keeps stack traces readable.
- Magic numbers become named constants at the top of the file
  (`DAYS_UNTIL_REVIEW_BY_LEVEL`, `PASS_FROM_PERCENT`).
- Build DOM with `quiz.helpers.createElement` / `createButton`. Insert
  text with `textContent` only; never `innerHTML` with book data.
- Question types talk to the session only through the `card` object.
- Results are always the strings `"got"`, `"part"`, `"miss"`.

## CSS

- Colours, fonts, radii and shadows come only from CSS variables
  (`var(--color-text)`, `var(--radius-small)`, ...) so every theme works.
  A new hard-coded colour needs a good reason.
- Each rule is written once with its final value. Do not add a later rule
  that overrides an earlier one in another file; edit the original.
- Class names say what a thing is (`.question-card`, `.sort-group-head`).
  State classes start with `is-` (`.is-right`, `.is-locked`,
  `.is-selected`). `.hidden` hides anything.
- One declaration per line, properties grouped roughly as: layout, box,
  text, colour, border, effects.
- Phone-only rules go in `css/phone.css`, nowhere else.
- Theme-only rules go in `themes/<id>/extra.css`, scoped with
  `[data-theme="<id>"]`.

## HTML

- Ids are long and kebab-case (`question-count-input`). JavaScript finds
  elements by id with `quiz.helpers.findElement`.
- No inline styles or inline event handlers.
- Choice groups use `data-value`; the theme mode buttons use
  `data-theme-mode`; tiles use `data-theme-id`.

## Python (tools/, tests/)

- Standard library only for tools; tests use Playwright.
- Descriptive names, a docstring per function, `main()` guarded by
  `if __name__ == "__main__"`.

## Everywhere

- Lines under 80 characters, 2-space indent (4 in Python).
- Exempt: `questions.json` (book content) and the generated files
  `css/themes.css` (contains data URIs) and `js/themes-list.js`.
- Comments explain why, in plain words. Keep them true when you change
  the code.
- Keep `README.md` and `ai-context/` in step with behaviour changes.
