# Recall Quiz site template

The code of the Recall Quiz teaching site (concept cards, question ladders,
spaced repetition, HTRAB tags, Google sign-in sync, themes, Settings).
Every book site is a copy of this repo plus the files below. The `quiz-htrab`
skill reads this repo's default branch directly.

## What belongs to a book (never overwritten by a template update)

| File or folder | What it is |
|---|---|
| `questions.json` | the book's ideas and questions (the sample here is a placeholder) |
| `images/` | the favicon and any book pictures |
| `docs/` | notes kept with the book |
| `book-structure/` | the reviewed chapter map (`chapters.json`, `README.md`) |
| `README.md` | the book's own readme |

Everything else is template code and should stay identical in every repo.
The list is also in `.templatesyncignore`. `media/` and `banks/` also belong
to a book when it uses them.

A book site can instead hold only `index.html`, `questions.json` and
`images/` (plus `media/` and `banks/` if used) and load the code from the
CDN at one template tag. Its `index.html` is written by
`python3 tools/make_book_index.py TAG FILE` (see the README), so such a
book does not use the template sync.

## Rules for changing the template

- Edit the template only here, never in a book repo.
- `index.html` has no per-book text: the page title comes from
  `questions.json` and the icon is `images/favicon.png`.
- After a change: `python3 tools/build_themes.py`, then
  `python3 tests/run_tests.py` and `python3 tests/test_tools.py`.
- Code is described in `AGENTS.md` and `ai-context/`.
