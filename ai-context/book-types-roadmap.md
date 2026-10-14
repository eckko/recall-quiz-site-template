# Book types the quiz-advanced skill will cover

The full list of book types planned for the `quiz-advanced` skill (repo `eckko/claude-memory`, folder `skills/quiz-advanced/`). One skill and one template. Each kind is one small file, and modifiers can be added to any of them. The skill's `INDEX.md` is the live status (stable, draft, planned); this page is the plan.

Order of work: technical books first, then the rest. The template already carries the fields the later types need (genre, labelled card blocks, code, pictures, cover).

## Theoretical (argument-led)

| Kind | Examples | Media that helps |
|---|---|---|
| Expository (default) | Most non-fiction | Rarely needed |
| Treatise | Long systematic works, such as the *Principia* | Diagrams |
| Science | Physics, chemistry, biology texts | Animations, plates |
| Popular science | Science for general readers | Animations |
| Mathematics | Proof-based and applied maths | Animated proofs, figures |
| Philosophy | Argument-led works | Rarely |
| Social science | Economics, sociology, psychology | Charts |
| History | Narrative and analytical history | Maps, timelines |
| Biography and autobiography | Life stories | Photos, if you want them |

## Practical (rules and action)

| Kind | Examples | Media that helps |
|---|---|---|
| How-to / rules | Cookbooks, manuals, self-help | Step images |
| Principles behind rules | Management, ethics, economics | Rarely |
| Movement | Yoga, exercise, physio | Step images, schematic animations, your own clips |

## Technical

| Kind | Examples | Media that helps |
|---|---|---|
| Programming language | Java, Python | Code blocks |
| Library or API | Framework docs | Code blocks |
| Algorithms and CS theory | Algorithm texts | Step animations |
| System design | Distributed systems | Labelled diagrams |
| Architecture | Software architecture | Diagrams |
| Data and ML | Statistics, ML texts | Charts, animations |

## Reference and design

| Kind | Examples | Media that helps |
|---|---|---|
| Textbook | Course books | Mixed |
| Specification | Language specs, standards | Code blocks |
| Handbook | Reference manuals | Tables, diagrams |
| Design | Layout, typography, visual design | Animated demos, examples |

## Narrative and scriptural

| Kind | Examples | Notes |
|---|---|---|
| Teaching discourse | Gita, Upanishads | Needs the `sanskrit` modifier |
| Epic, purana, story | Mahabharata, Shiva Purana, novels, folk tales | Chapter-based units, spoilers come after reading |
| Hymn and ritual | Vedas | Experimental, depends on a good commentary |
| Technical śāstra | Charaka Samhita, Gheranda Samhita | Health-text safety rules apply |
| Pure fiction | Novels | Reduced mode: plot, character, theme |

## Modifiers (stack on any kind)

`has-code`, `has-formulas`, `heavily-visual`, `has-animation`, `sanskrit` / non-Latin script, `reference-style`, `health-content`.

| Modifier | Status | For |
| --- | --- | --- |
| `has-formulas` | stable | maths, physics, metrics |
| `has-code` | draft | code listings with a language label |
| `heavily-visual` | draft | pictures carry the content |
| `technique-catalogue` | draft | books that list named techniques or patterns |
| `has-animation` | planned | short clips and animations (physics, maths, yoga, design) |
| `sanskrit` | planned | Sanskrit text, transliteration, meaning |
| `health-content` | planned | exercise, yoga and medical texts; care with claims |
| `reference-style` | planned | look-up books read in pieces |

(Also in the skill: `technique-catalogue`, for books that list named techniques or patterns.)

## Honest limits

- Fiction and the Vedic hymns are the weakest fits for a quiz. They work, but at lower value.
- Anything where learning depends on live demonstration (a yoga flow, for example) is best taught with your own clips or schematic animations. Realistic video cannot be made.
- A book that fits no kind falls back to the default expository teaching, so it still works.

## Decisions that shape every type

- Exact quotes and book pictures are allowed (`sourceUse`), because each book lives in its own repo. Pictures are encrypted file by file; the key is in Firebase under the reader's account.
- Cover, publisher logo and decorative images may be included, with ordered ids.
- Short videos, animations and gifs are wanted for physics, maths, yoga and design books.
- Autopilot is the default; the `check` flag pauses after the chapter map.
- New kinds are added with `kinds/_how-to-add-a-kind.md`; the template does not change per kind.

## Trial books

Clean Architecture (done, version 2) and Working Effectively with Legacy Code (next). Head First Design Patterns is skipped because it already has a finished quiz.
