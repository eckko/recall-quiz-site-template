# Pitfalls

Bugs this code has already had, and the rules that prevent them.

## Enter and Space can "click" twice

When a key handler moves focus to a new button (for example the Next
button appears and is focused), the same Enter/Space key press can then
activate that button too, skipping a question. `handleKeyPress` in
`js/session.js` therefore calls `preventDefault()` for Enter and Space
before calling the question type's handler, and ignores Enter/Space when
a button already has focus (the browser handles that click itself).
Keep both rules.

## Focus left on a hidden button

After clicking Start, the hidden Start button can keep focus and swallow
the first Enter. `startSession` blurs the active element. The confidence
buttons also `blur()` themselves after a click so Enter goes to the
answer. If you add a button that hides itself, blur it.

## `.hidden` must win

`.hidden` uses `display: none !important` on purpose. Before, a later
`display: flex` rule on the same element silently beat it (both the
"questions" and "minutes" rows showed at once).

## file:// cannot fetch

Opened from a folder, `fetch("questions.json")` fails. `main.js` then
shows a file picker. Do not switch to ES modules or `fetch` for scripts:
both break on `file://`.

## SVG in CSS cannot use currentColor

Icons inside `url("data:image/svg+xml,...")` do not inherit text colour.
The build replaces `currentColor` in `start-icon.svg` with the theme's
`onAccent`, and draws the next/check icons with it.

## Restoring a backup

A backup is upgraded only if it has the version-1 `items` field;
anything with `questions` is treated as version 2, and files from a newer
version are refused. (Treating a version-less v2 file as v1 once wiped
progress.)

## Generated files

`css/themes.css` and `js/themes-list.js` are overwritten by
`tools/build_themes.py`. Edits there are lost.

## Question ids are progress keys

Renaming an `id` in `questions.json` silently resets that question's
progress. Changing its text, answer or explanation is safe.

## Keep saved data compatible

Readers' progress lives only in their browsers. Any change to its shape
needs a version bump and an upgrade function (see
[recipes.md](recipes.md)). The theme setting deliberately keeps its old
short keys (`t`, `m`).

## Dark schemes and bright highlights

A bright highlighter stripe behind light text is unreadable. Dark schemes
use a softer stripe (end of the highlighter section in
`css/question.css`). Check new themes in dark mode.

## Timed sessions end gracefully

If the session clock runs out while feedback is showing,
`state.timeRanOut` is set and the results appear when the reader presses
Next, so they can finish reading. If no answer was given yet, results
show at once. With zero answers, nothing is recorded. `timeRanOut` is
reset at the start of every session (an older version leaked it into the
next session, ending it after one question).
