# Book types the quiz-advanced skill will cover

The plan for what gets built with the `quiz-advanced` skill (repo `eckko/claude-memory`, folder `skills/quiz-advanced/`). One skill and one template; every book type below is a small "kind" file, and a unit has one kind plus any number of modifiers. The skill's `INDEX.md` is the live status; this page is the plan and the reason.

Order of work: technical books first, then the rest. The template already carries every field the later types need (genre, labelled card blocks, code, pictures, cover).

## Kinds

| Family | Kind | Status | Examples |
| --- | --- | --- | --- |
| (shared) | Writer brief `_base` | stable | all |
| Method | Reading method | stable | How to Read a Book |
| Default | Expository | stable | any book without a closer kind |
| Technical | Programming language | draft | language guides |
| Technical | Library or API | draft | framework and tool books |
| Technical | Algorithms and CS theory | draft | algorithm and theory books |
| Technical | System design | draft | designing data-heavy systems |
| Technical | Architecture | draft, trialled | Clean Architecture |
| Technical | Data and ML | draft | statistics, ML books |
| Technical | Legacy code and refactoring (uses Architecture plus `has-code`) | trial next | Working Effectively with Legacy Code |
| Theoretical | Treatise, science, popular science, mathematics, philosophy, social science, history, biography | planned | Thinking, Fast and Slow; maths texts; history |
| Practical | How-to rules, principles, movement | planned | exercise and yoga books, habit and craft books |
| Reference | Textbook, specification, handbook, design | planned | textbooks, language specifications |
| Narrative | Teaching discourse, epic or story, hymn, technical shastra, fiction | planned | Gita, Mahabharata, Vedas, Shiv Purana, Charaka Samhita, Gheranda Samhita, story books |

## Modifiers (stack on any kind)

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

## Decisions that shape every type
- Exact quotes and book pictures are allowed (`sourceUse`), because each book lives in its own repo. Pictures are encrypted file by file; the key is in Firebase under the reader's account.
- Cover, publisher logo and decorative images may be included, with ordered ids.
- Short videos, animations and gifs are wanted for physics, maths, yoga and design books.
- Autopilot is the default; the `check` flag pauses after the chapter map.
- New kinds are added with `kinds/_how-to-add-a-kind.md`; the template does not change per kind.

## Trial books
Clean Architecture (done, version 2) and Working Effectively with Legacy Code (next). Head First Design Patterns is skipped because it already has a finished quiz.
