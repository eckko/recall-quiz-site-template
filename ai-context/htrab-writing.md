# Writing a concept bank for the HTRAB site

This site is the HTRAB edition of the Recall Quiz: the teaching quiz plus
the HTRAB overlay (`htrab/`). Every idea and question carries a tag from
`htrab/tags.json`. Read `learning-design.md` first for the card, ladder
and wording rules; this file adds what is specific to an HTRAB bank and
describes the three tools that build one.

## The pipeline

    work/chapters.json
      -> tools/plan_concept_bank.py   -> work/concept-plan.json
      -> one writer per chapter       -> work/parts/<prefix>.json
      -> tools/merge_concept_bank.py  -> questions.json (+ report)

1. `chapters.json` is written from the book: for each chapter or part
   its unit name, title, one-sentence `unitSummary`, `pages`, `weight`,
   and `htrab`, the tag prefixes it covers (see the tag map below).
2. `python3 tools/plan_concept_bank.py work/chapters.json` (default 8
   questions per page; `--per-page N` changes it). It splits the total
   over the chapters and plans about one idea per six questions.
3. Each chapter writer produces `work/parts/<prefix>.json`:
   `{"concepts": [...], "questions": [...]}`. The writer checks its own
   part with `python3 tools/merge_concept_bank.py work/concept-plan.json
   --only <prefix>` until it prints no errors.
4. `python3 tools/merge_concept_bank.py work/concept-plan.json
   --book-text work/book.txt` merges, validates (it runs
   `validate_bank.py`) and writes `questions.json` and
   `work/concept-bank-report.md`. It writes nothing when there is an
   error.

## Tagging rules

- Every **concept** has `htrab`: a full `level/topic/subtopic` tag. Copy
  tags from `python3 tools/list_htrab_tags.py --chapter N`; never type
  them from memory. A question without its own `htrab` inherits the
  concept's, so every question is tagged.
- One idea covers one subtopic. When a chapter has several testable
  subtopics (`list_htrab_tags.py --testable`), each one gets at least one
  idea; the merge report lists the ones left uncovered. Subtopics marked
  "not testable" have too little advice to question; skip them.
- Use a question's own `htrab` only when it really tests a different
  step from its concept (a `discriminate` question between two steps).
- Understand before judging: an idea tagged stage 3 (criticism) must
  `require` an idea tagged stage 1 or 2.

## Tag map (what each part of the book is for)

| Level | Chapters | Meaning |
|---|---|---|
| elementary | 3 | learning to read words (rarely tested) |
| inspectional | 4 | skimming, then superficial reading |
| analytical, stage 1 | 6, 7 | what is the book about as a whole: classify it, state its unity, outline it |
| analytical, stage 2 | 8, 9 | what is being said: terms, propositions, arguments, solutions |
| analytical, stage 3 | 10, 11 | is it true: criticize fairly, agree or disagree |
| analytical, by kind | 13 to 19 | practical, imaginative, history, science, philosophy, social science |
| syntopical | 20 | reading many books on one subject |
| general | 0, 1, 2, 5, 12, 21 | the art of reading, being a demanding reader, aids, growth of the mind |

## Writing from the book

- Teach the method, not the book's examples. Questions use fresh
  situations (an article, a recipe, a contract, a podcast) so the reader
  practises the step, not recalls a page.
- `htrab/catalogue.json` holds Adler's advice for each tag (action,
  self-check, slip). Base the card's rule on the action, `limits` on the
  slip, and the orienting `question` on the self-check, in your own
  words.
- `htrab/question-templates.json` holds the book's own test formats
  (Appendix B). Use them to vary question kinds; do not copy their
  wording.
- Quotes: paraphrase. A direct quotation must be under 25 words and
  word-for-word in the book; the merge checks quotes against
  `--book-text`. Never reproduce long passages.
- Contested claims: where the book gives an opinion (the best books to
  read, what a good reader must do), test what the book recommends and
  say so ("According to the authors ...").
- Text only: no images, no HTML. Formulas are rare in this book.

## Book-level unit

Besides the book's parts, add a unit named "Reading the book as a
whole" (prefix `whole`) that asks the reader to put the steps together:
which level to use for a given situation, in what order the steps run,
and what a finished analytical reading looks like. These ideas
`require` ideas from earlier units, and they are tagged with the
`general` or `analytical` tags that best match.

## Answer positions and sizes

Follow the same limits as `learning-design.md`: paragraphs under 70
words, rule one sentence, 4 to 6 ladder questions plus a pretest, at
least three kinds per ladder, right answers spread over every position.
