# Glossary

| Word | Meaning in this code |
|---|---|
| book | the content of `questions.json`; one per site |
| unit | a chapter (or lesson). The `unit` field, e.g. `"Chapter 9"`. Named "unit" so other kinds of material fit; the word shown comes from `labels.unit` |
| unit title | the chapter's name (`unitTitle`) |
| section | a topic inside a chapter (`section`), usually a sub-heading of the book; shown as "Topic" (`labels.topic`) |
| kind | a question type: `mcq`, `tf`, `multi`, `fill`, `order`, `match`, `sort`, `recall` |
| result | `"got"` (right), `"part"` (partly right), `"miss"` (wrong) |
| marks | got = 1, part = 0.5, miss = 0 |
| verdict | `"excellent"`, `"pass"` or `"fail"` for a whole session |
| memory level | 0 to 4 per question; sets the days until it comes back (0, 1, 3, 7, 21) |
| due | a question whose `nextReview` time has passed |
| due and new | the default filter: due questions plus never-seen ones |
| gap | a question missed at least once and still at level 0 or 1 ("My gaps") |
| solid | memory level 3 or more |
| learning | seen but not solid |
| confident miss | the reader chose "Certain" and was wrong |
| session | one run of questions from Start to results |
| card | the object a question type receives; also the `#question-card` panel |
| scope | what a session covered: "Whole book" or a chapter, saved as `scopeName` |
| mode | the reader's light/dark choice: `light`, `dark` or `system` (`data-mode`) |
| scheme | what is actually showing: `light` or `dark` (`data-scheme`) |
| theme | a look: colours, fonts, shapes, pictures (`data-theme`), one folder in `themes/` |
| pop colours | `--color-pop-1` to `4`: playful accents used for option numbers, bars and confetti |
| pill | the fixed top-right box showing time or questions left |
