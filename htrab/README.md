# HTRAB overlay

HTRAB means *How to Read a Book*. This overlay tags questions with the
steps of Adler and Van Doren's reading method and lets a reader practise
one step at a time. It is experimental and off by default for every
reader. Nothing else in the app depends on it.

## What it does

When the HTRAB switch on the home screen is **On**:

1. The reader can choose a **level** (inspectional, analytical,
   syntopical ...), a **stage** (analytical only: 1 what is the book
   about, 2 what is being said, 3 is it true), a **topic** (a chapter of
   the book, such as "Determining an Author's Message") and a
   **subtopic** (a section, such as "Finding the Propositions"), and
   start a test holding only the questions with that tag.
2. Every question shows its step under the question.
3. Feedback, and the concept card, show **Adler on this step**: what to
   do, a question to ask yourself, a short quotation and the common slip.

With the switch Off (the default) none of this shows. The tagged
questions are asked like any others.

## Tagging

A question or concept gets one field:

    "htrab": "analytical/determining-an-authors-message/finding-the-propositions"

The tag has three parts (`level/topic/subtopic`) and must exist in
`tags.json`. `python3 tools/validate_bank.py` checks it, warns about tags
that have too little advice to test, and warns when a stage 3 (criticism)
idea has no stage 1 or 2 idea behind it ("understand before judging").

## Files

| File | What it is |
|---|---|
| `htrab-config.js` | `available: true/false`, the master switch |
| `htrab.js` | the overlay: switch, picker, chips, advice panel |
| `htrab.css` | its styles |
| `tags.json` | the tag tree: level > topic > subtopic, with stage and the number of advice items under each |
| `catalogue.json` | Adler's advice, keyed by tag: title, action, self-check, short quotation, slip. 1,170 items from the book chapters. Loaded only when the switch is turned on |
| `question-templates.json` | 97 question templates from the book's own exercises (Appendix B), for question writers. Not used by the app |

## Hooks into the app

The overlay only listens. The app sends three events:

- `recallquiz:book-opened`: add the switch if the bank has tags
- `recallquiz:question-shown` (detail: question, cardElement)
- `recallquiz:feedback-shown` (detail: question, result, feedback)

and the overlay starts tests with `quiz.session.startQuestions`.

## Remove it

1. Delete the `htrab/` folder.
2. In `index.html` delete the three lines marked HTRAB (one stylesheet,
   two scripts).

The validator then stops checking tags (it says so). The three events
are harmless without a listener. Banks that still hold `htrab` fields
keep working.

## Replace it

Keep the three events and `quiz.session.startQuestions` as the contract.
A different method (another book) can ship its own folder with its own
`tags.json` and `catalogue.json` in the same shapes.

## Notes on the data

- The catalogue was extracted from the book chapter by chapter. Every
  quotation was checked against the book text by script. Appendix B items
  are kept apart (`question-templates.json`).
- Part Three of the book (practical books, fiction, history, science,
  philosophy, social science) is tagged under level `analytical` with the
  stage "By kind of book".
- Syntopical reading needs several books. One bank can only test what the
  book says about the method.
