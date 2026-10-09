# Learning design: questions that teach

The original Recall Quiz tests what a reader has already learned. This
version can also teach new material with the same questions. A bank
that has a `concepts` list switches the teaching features on. A bank
without one behaves exactly like the old recall quiz.

## The teaching loop

Every concept (one idea, about 10 minutes of study) goes through the
same loop:

| Step | What the reader sees | Why |
|---|---|---|
| 1. Pretest | One question on the idea **before** teaching it. Not scored. | A wrong guess primes the reader, so the next card sticks better (pretesting effect). |
| 2. Card | A short concept card (2 to 4 short paragraphs, an optional worked example, a one-line rule). | The only place where an idea is told, not discovered. |
| 3. Ladder | 4 to 6 questions, easy to hard, each using what the last one revealed. | Practice with feedback that teaches, moving from the card to new situations. |
| 4. Review | The same questions come back by spaced repetition, mixed with other concepts. | Spacing and interleaving. |

Inside a ladder, the questions play different roles:

| `role` | The question asks the reader to... |
|---|---|
| `pretest` | guess at the idea before it is taught (rung 0) |
| `warmup` | retrieve what the card just said, or what they already know |
| `extend` | take one small step past the card. Its feedback introduces a new fact. |
| `apply` | use the idea in a fresh, everyday case |
| `transfer` | use the idea in a setting the card never showed. Its feedback introduces a new idea. |
| `discriminate` | choose which of two similar ideas applies |
| `predict` | say what happens if something changes |
| `spot-error` | find the wrong step in worked reasoning |

The feedback after each answer does the teaching, so every question
carries explanations (below). Questions with the role `extend` or
`transfer` must say what new idea their feedback introduces (`teaches`).
That is how the bank teaches material the card did not contain, and the
quiz shows it in a highlighted "New idea" line.

## questions.json

```json
{
  "id": "clock-arithmetic",
  "book": "Clock Arithmetic",
  "labels": { "unit": "Lesson", "units": "lessons",
              "topic": "Idea", "whole": "Whole course" },
  "concepts": [ { ...concept... } ],
  "questions": [ { ...question... } ]
}
```

### Top-level fields added in M3 (all optional, validator warns if missing)

| Field | Rules |
|---|---|
| `summary` | one sentence (40 words or fewer) saying what the whole bank is about. Shown under the title. |
| `unitSummaries` | `{ "<unit id>": "one sentence, 30 words or fewer" }`. Shown above the ideas of that unit. This is the "state the unity" step done for the reader before they start. |

### Concept

```json
{
  "id": "remainders",
  "unit": "Lesson 1",
  "unitTitle": "Wrapping around",
  "section": "Remainders",
  "title": "Remainders and the clock",
  "requires": [],
  "card": {
    "paragraphs": ["Plain text, one idea per paragraph. Formulas: \\(17 = 12 + 5\\)."],
    "example": "A worked example (optional).",
    "rule": "One sentence the reader should be able to repeat.",
    "limits": "Where the rule stops working, in one or two sentences."
  },
  "question": "The one question to keep in mind while reading the card?",
  "core": true,
  "htrab": "level/topic/subtopic"
}
```

| Field | Rules |
|---|---|
| `id` | lower-case slug, unique, **stable** (questions point to it) |
| `unit`, `unitTitle` | same wording as on the concept's questions. Questions are grouped by `unit` as before. |
| `section` | the topic heading. Every question of the concept uses this exact text. |
| `title` | shown on the concept list and above the card |
| `requires` | ids of concepts that must be understood first. They must come earlier in the list (no cycles). `[]` for the first one. |
| `card.paragraphs` | 1 to 4 plain-text paragraphs, each under 70 words |
| `card.example` | optional worked example, under 80 words |
| `card.rule` | one sentence, required |
| `card.limits` | where the rule stops working (50 words or fewer). Shown as "Where it stops working". Warning if missing. |
| `question` | the orienting question: exactly one question, 25 words or fewer. Shown at the top of the card as "Read to answer" and under the idea's title on the home screen. Warning if missing. |
| `core` | `true` for the few ideas that give most of the value (about a fifth to a third; a warning appears above one half). "Keep me going" and the 5-minute session take core ideas first. A bank that marks none treats every idea as core. |
| `htrab` | optional HTRAB tag (see "HTRAB overlay" below) |

### Question (new fields on top of the old ones)

The old fields still apply: `id`, `unit`, `unitTitle`, `section`, `kind`,
`q`, `explain` and the fields of its `kind` (see `data-formats.md`).

| Field | Applies to | Rules |
|---|---|---|
| `concept` | every question in a bank with concepts | id of its concept. `unit` and `section` must match the concept's. |
| `role` | every question | one of the roles above |
| `rung` | every question | order in the ladder: `0` for the pretest, then `1, 2, 3 ...` with no gaps and no repeats within a concept |
| `optionExplain` | **required** for `mcq` and `multi` | list of strings, one per option, same order. For a wrong option: why a reasonable person picks it, and why it fails. For the right option: why it works. |
| `explain` | required for every kind except `recall` | 1 to 3 sentences: the reasoning in one go. |
| `rule` | recommended | one short sentence to remember, shown as "Rule to remember" |
| `teaches` | **required** for `extend` and `transfer` | one sentence: the new idea the feedback introduces. Shown as "New idea". It must not be repeated in the concept card. |
| `hint` | optional | a nudge that does not give the answer. Reader taps "Show a hint". |
| `htrab` | optional | an HTRAB tag; falls back to the concept's tag |

Questions with the role `pretest` can use `mcq`, `tf`, `fill` or
`multi`. Pick a form where a good guess is possible.

### Ladder shape a concept needs (checked by the validator)

- exactly one `pretest` (rung 0)
- at least 4 ladder questions (rung 1 and up)
- rung 1 is a `warmup`
- at least one `apply` and one `transfer`
- at least one `extend` or `transfer` carrying `teaches`
- at least 3 different `kind`s across the ladder
- the pretest is about the idea the card teaches, not a different one

## Writer rules

Everything a reader sees is plain text (no HTML, no markdown). Formulas
use `\\( ... \\)` in the JSON file (the backslash doubled).

1. **One idea per question.** Stand-alone wording. No "as above".
2. **One clearly right answer.** Wrong options are real misconceptions,
   not silly. All options have similar length and grammar. Spread the
   right answer over positions 0 to 3.
3. **Each rung uses the one before.** The feedback of rung n gives the
   reader what rung n + 1 needs.
4. **`extend` and `transfer` teach.** They must be answerable by
   reasoning from the card plus earlier feedback, and the feedback must
   introduce something the card did not say (`teaches`).
5. **The pretest is fair to guess.** Its explanation is short and ends
   by pointing to the card ("The card next shows why.").
6. **Feedback is a mini lesson.** `explain` states the reasoning,
   `optionExplain` names each misconception, `rule` is the takeaway.
7. **Vary the forms.** Across a concept, use at least three question
   kinds, and mix in `discriminate`, `predict` or `spot-error` where
   they fit.
8. **Everything is checkable.** Every number and claim must be correct.
   Work formulas out; do not guess.

### Writing good questions (checked in part by the validator)

**Wording.** Warnings come from `tools/validate_bank.py`.

- No loaded or minimising words: obviously, just, merely, simply,
  clearly, of course. They tell the reader what to think, or make a
  struggling reader feel slow.
- One question per stem. A second "?" means two questions.
- No smuggled assumptions. "Why is the author so sure?" assumes the
  author is sure. Ask "How sure does the author sound, and on what
  evidence?" Watch "Why is it so/too/still ...".
- No false dilemmas. If a question offers "A or B", the reader must be
  able to answer "neither" or "both".
- No absolutes (always, never) unless the question is about the
  absolute.
- A two-option mcq is a coin flip. Use `tf`, or add a plausible option.
- Define every key term the question uses, in the card of the idea or an
  earlier one. A term in quotation marks in a question that appears in no
  card is flagged.

**Rungs.** Every ladder includes one question that asks "what if we change
a condition?" and one that asks "why does this hold?". The `transfer`
question must use a different domain from the card's example (a recipe if
the card used a clock). A question that mixes two ideas ("which model
applies here?") belongs to the later of the two ideas, so it is never
asked before both have been taught.

**Where the rule stops.** Each card has `limits`, and each ladder has one
question that tests a case where the rule does not apply. A reader who has
only seen the rule working believes it always works.

**Orienting question.** Write the `question` first, then the card. The
card should answer it; if it cannot, the idea is two ideas.

**Contested books.** When a book argues one side of a disputed matter, do
not test "the right answer". Test the range of positions, and the reasons
each side gives ("Which evidence would the author cite for this view?").

**Critique questions** (use after the idea itself has been understood):

- Sources: Is the source knowledgeable? Reliable? Do other sources agree?
- Generalisations: Is the claim clear? Is there enough evidence? Is the
  sample representative? Is there a counterexample?
- Explanations: Does it fit all the facts? Does it confuse correlation with
  cause? Could it be tested?

**"What if" templates.** Reverse it ("what if the opposite were true?");
"plussing" (keep the idea and add something to it); "In what ways might
...?" (invite several answers); ask for the underlying interest behind a
stated position.

**"Tell apart" patterns** for `discriminate` questions: inversion (state
the opposite), necessary versus sufficient, correlation versus cause,
falsifiable versus unfalsifiable.

**Understand before judging.** Within a bank, questions that ask the
reader to agree, disagree or judge come after questions that check they
understood the claim. With HTRAB tags the validator warns when a
stage-3 idea has no stage 1 or 2 idea behind it.

## Progress and scoring

- Pretests are not scored. The first time a pretest is answered it only
  marks the question "seen as a warm-up". Afterwards it is an ordinary
  question that comes back by spaced repetition and is then scored.
- Everything else is scored as before (right 1, partly 0.5, missed 0).
- A concept's status comes from its scored questions (no extra saved
  data, so cloud sync works unchanged):
  - **New**: nothing in its ladder answered yet
  - **Learning**: started, not understood yet
  - **Understood**: every ladder question is at memory level 1 or more
  - **Solid**: at least 75% of the ladder is at memory level 3 or more
  - **Locked** (only when the bank sets `"strictOrder": true`): a
    concept in `requires` is not understood yet. Otherwise `requires`
    is only a hint, shown as "Builds on: ..." on the idea.
- Cards are not saved. A card is shown again whenever a concept is New.
- **Where it breaks** (nothing extra is saved): the ladder is split into
  three parts by role: the basics (warmup, extend), applying it (apply,
  predict) and new situations (transfer, discriminate, spot-error). A part
  is shaky when a question in it was missed and is still at memory level 1
  or lower. The idea then says "Solid on applying it, but shaky on new
  situations" and offers "Practise the weak part". If an idea it builds on
  is still New, it says so and suggests starting there.
- **Results wording.** The verdict "fail" is shown as "Needs work", a
  missed answer as "Not yet". The saved key stays `fail` so old progress
  loads. Praise names what the reader did, not a talent. A session's
  results lead with "What went right", and show the average of the last
  five sessions with a reminder that one session is a noisy measure.
- **Streak.** The home screen shows "N days in a row" and "M days
  practised". The second never goes down.

## Sessions

There are no modes. The reader studies in any order.

| Action | What it does |
|---|---|
| Keep me going | Up to 4 due reviews, weakest first (the hardest job opens the session), then the next idea to teach (pretest, card, ladder; core ideas first, then book order), with up to 2 more due reviews after it, then one easy review so the session ends on a success (peak-end). With nothing due and nothing new: the questions the reader finds hard, else a mixed set of 10. Respects the chapter picker. |
| 5-minute session | The same, but only core ideas and at most 2 reviews. About 8 to 10 steps. |
| Teach me (on an idea) | Pretest, card, ladder for a new idea; card and ladder again for an idea already started. Works on any idea, in any order. |
| Test me (on an idea) | The ladder questions only, no pretest and no card. |
| Custom practice | The old practice sessions (Due and new, My gaps, Everything, by count or time), shuffled across ideas. Includes questions of ideas not taught in the app. |

Any question can open its card with "Read the idea" before it is answered
(the full card, not a hint; not offered on a warm-up guess). After an answer
the same card is "Show the idea again". "Builds on" never blocks anything unless `strictOrder`
is set in the bank, which restores the old locking and keeps new ideas
out of Due and My gaps.

The confidence check ("How sure are you?") is on by default. Pretests
and cards skip it.

## HTRAB overlay (optional, experimental)

The overlay lets a reader practise the reading method of *How to Read a
Book* (Adler and Van Doren). It lives in the `htrab/` folder and is
switched on from the home screen ("HTRAB method"). Everything about it is
described in `htrab/README.md`.

A question (or concept) carries one tag, `level/topic/subtopic`, for
example `analytical/determining-an-authors-message/finding-the-propositions`.
With the method on the reader can pick level, stage (analytical only),
topic and subtopic and start a test of exactly that step. Each question
shows its step, and the feedback and the concept card show Adler's advice
for the step. The valid tags are in `htrab/tags.json`; the validator checks
them. Delete the `htrab/` folder and its three tags in `index.html` to
remove the overlay; banks keep their tags and still work.
