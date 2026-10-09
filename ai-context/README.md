# AI context: start here

These notes are for AI agents (and people) who need to understand or
change the quiz. They describe the code as it is; keep them up to date
when you change how something works.

| File | Read it when you need to... |
|---|---|
| [architecture.md](architecture.md) | understand the modules, the shared `quiz` object, script load order, the session flow, and where to make a change |
| [data-formats.md](data-formats.md) | read or write `questions.json`, saved progress, backups, `theme.json`, or localStorage keys |
| [coding-conventions.md](coding-conventions.md) | write code that fits: naming, comments, line length, CSS rules |
| [learning-design.md](learning-design.md) | work on Keep me going, Teach me / Test me, concepts, ladders, pretests, or write a teaching bank |
| [htrab-writing.md](htrab-writing.md) | build a concept bank for the HTRAB site: pipeline, tagging rules, writer notes, planning and merge tools |
| [recipes.md](recipes.md) | follow step-by-step instructions for common changes |
| [testing.md](testing.md) | run and extend the tests, and check visual changes |
| [pitfalls.md](pitfalls.md) | avoid the bugs that have already bitten this code once |
| [glossary.md](glossary.md) | understand the words used in the code (unit, section, got/part/miss, scheme ...) |

## The project in one paragraph

One static page (`index.html`) shows a home screen, a question card and a
results screen, hiding and showing sections. Questions come from
`questions.json` (one book per site). Each answer updates a per-question
memory level (Leitner-style spaced repetition, levels 0 to 4, gaps of 0,
1, 3, 7, 21 days) saved in localStorage per book. Eight question types
plug into a small registry. Thirty-four visual themes are data folders
compiled by a Python script into CSS variables; the stylesheets only use
those variables. No framework, no bundler, no npm dependencies at runtime.

## Constraints that shape every decision

- Must work on GitHub Pages **and** when `index.html` is opened from a
  folder (`file://`). So: plain `<script>` tags (no ES modules), and a
  manual file picker when `fetch("questions.json")` fails.
- No build step for the app. The only generator is
  `tools/build_themes.py` for themes.
- Readers' progress lives only in their browser. Never break the saved
  format without an upgrade path.
- All artwork must be original (no copyrighted characters, logos or book
  covers).
