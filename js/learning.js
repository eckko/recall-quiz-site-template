/*
 * learning.js
 * The teaching side of the quiz. A book with a "concepts" list in
 * questions.json is taught idea by idea (see ai-context/learning-design.md):
 *
 *   pretest (an unscored guess) -> concept card -> ladder of questions
 *   -> spaced review mixed with other ideas
 *
 * This file knows the concepts, works out how far the reader has got with
 * each one (from the saved question records, so nothing extra is saved),
 * and builds the list of steps for a Learn session. It draws the concept
 * card and the labels that describe a step. A book without concepts
 * never calls into the parts that need them.
 */
(function setUpLearning(quiz) {
  "use strict";

  const { createElement } = quiz.helpers;

  /** A question at this memory level or higher counts as understood. */
  const UNDERSTOOD_LEVEL = 1;
  /** A concept is solid when this share of its ladder is solid. */
  const SOLID_SHARE = 0.75;
  const SOLID_LEVEL = 3;
  /** Due questions from earlier ideas mixed in after each new idea. */
  const REVIEWS_AFTER_EACH_CONCEPT = 2;
  const DEFAULT_CONCEPT_COUNT = 2;
  const KEEP_GOING_REVIEWS = 4;      // due questions before a new idea
  const KEEP_GOING_FALLBACK = 10;    // questions when nothing is due
  const QUICK_REVIEWS = 2;           // due questions in a 5-minute session
  const CLOSER_MIN_LEVEL = 2;        // an "easy ending" is at least this solid
  const WEAK_LEVEL = 1;              // a missed question this low is shaky

  const STATUS_NAMES = {
    locked: "Locked",
    new: "New",
    learning: "Learning",
    understood: "Understood",
    solid: "Solid",
  };

  const ROLE_NAMES = {
    pretest: "Warm-up guess, not scored",
    warmup: "Warm-up",
    extend: "One step further",
    apply: "Use it",
    transfer: "New situation",
    discriminate: "Which one applies?",
    predict: "Predict",
    "spot-error": "Spot the error",
  };

  /**
   * The three parts of a ladder, easy to hard, used to say where an
   * idea breaks down. Roles not listed belong to "apply".
   */
  const PARTS = [
    { id: "basics", name: "the basics", roles: ["warmup", "extend"] },
    { id: "apply", name: "applying it", roles: ["apply", "predict"] },
    { id: "transfer", name: "new situations",
      roles: ["transfer", "discriminate", "spot-error"] },
  ];

  // ---------------------------------------------------------- concepts

  /** @returns {object[]} the concepts of the loaded book, in order */
  function concepts() {
    const list = quiz.book.data && quiz.book.data.concepts;
    return Array.isArray(list) ? list : [];
  }

  /** @returns {boolean} true if the loaded book teaches with concepts */
  function hasConcepts() {
    return concepts().length > 0;
  }

  /** @returns {boolean} true if the book marks any idea as core */
  function hasCoreIdeas() {
    return concepts().some(function isCore(concept) {
      return concept.core === true;
    });
  }

  /**
   * True for a core idea. A book that marks none treats every idea as
   * core, so the 5-minute session still has something to teach.
   * @param {object} concept
   * @returns {boolean}
   */
  function isCore(concept) {
    return !hasCoreIdeas() || concept.core === true;
  }

  /**
   * @param {string} conceptId
   * @returns {object|undefined}
   */
  function conceptById(conceptId) {
    return concepts().find(function matches(concept) {
      return concept.id === conceptId;
    });
  }

  /**
   * Every question of one concept, pretest first, then by rung.
   * @param {string} conceptId
   * @returns {object[]}
   */
  function questionsOf(conceptId) {
    return quiz.book.allQuestions()
      .filter(function inConcept(question) {
        return question.concept === conceptId;
      })
      .sort(function byRung(first, second) {
        return (first.rung || 0) - (second.rung || 0);
      });
  }

  /**
   * @param {string} conceptId
   * @returns {object|undefined} the concept's pretest question
   */
  function pretestOf(conceptId) {
    return questionsOf(conceptId).find(function isPretest(question) {
      return question.role === "pretest";
    });
  }

  /**
   * @param {string} conceptId
   * @returns {object[]} the ladder: every question except the pretest
   */
  function ladderOf(conceptId) {
    return questionsOf(conceptId).filter(function isLadder(question) {
      return question.role !== "pretest";
    });
  }

  // ------------------------------------------------------------ status

  /**
   * How far the reader has got, ignoring locks: "new", "learning",
   * "understood" or "solid".
   * @param {string} conceptId
   * @returns {string}
   */
  function progressOf(conceptId) {
    const ladder = ladderOf(conceptId);
    const scored = ladder.filter(function wasScored(question) {
      return quiz.memory.isScored(question.id);
    });
    if (scored.length === 0) {
      return "new";
    }
    const levels = ladder.map(function levelOf(question) {
      return quiz.memory.memoryLevelOf(question.id);
    });
    const isUnderstood = scored.length === ladder.length &&
      levels.every(function atLeast(level) {
        return level >= UNDERSTOOD_LEVEL;
      });
    if (!isUnderstood) {
      return "learning";
    }
    const solidCount = levels.filter(function isSolid(level) {
      return level >= SOLID_LEVEL;
    }).length;
    return solidCount / ladder.length >= SOLID_SHARE ? "solid" : "understood";
  }

  /**
   * True when the book asks for ideas to be learned in order. By
   * default they can be studied in any order and "requires" is only
   * a hint ("Builds on ...").
   * @returns {boolean}
   */
  function isStrictOrder() {
    return Boolean(quiz.book.data && quiz.book.data.strictOrder);
  }

  /**
   * True when every concept this one requires is understood.
   * Always true unless the book sets strictOrder.
   * @param {string} conceptId
   * @param {Set<string>} [alsoCovered]  concepts about to be taught first
   * @returns {boolean}
   */
  function requirementsMet(conceptId, alsoCovered) {
    if (!isStrictOrder()) {
      return true;
    }
    const concept = conceptById(conceptId);
    return (concept.requires || []).every(function isReady(requiredId) {
      if (alsoCovered && alsoCovered.has(requiredId)) {
        return true;
      }
      const progress = progressOf(requiredId);
      return progress === "understood" || progress === "solid";
    });
  }

  /**
   * "locked", "new", "learning", "understood" or "solid".
   * @param {string} conceptId
   * @returns {string}
   */
  function statusOf(conceptId) {
    const progress = progressOf(conceptId);
    if (progress === "new" && !requirementsMet(conceptId)) {
      return "locked";
    }
    return progress;
  }

  /** @returns {string} the label for a status, e.g. "Understood" */
  function statusName(status) {
    return STATUS_NAMES[status];
  }

  /**
   * Titles of the concepts a locked concept still waits for.
   * @param {string} conceptId
   * @returns {string[]}
   */
  function missingRequirementTitles(conceptId) {
    return (conceptById(conceptId).requires || [])
      .filter(function isMissing(requiredId) {
        const progress = progressOf(requiredId);
        return progress !== "understood" && progress !== "solid";
      })
      .map(function titleOf(requiredId) {
        return conceptById(requiredId).title;
      });
  }

  /**
   * True if a question may be asked in a Review session: it belongs to
   * no concept, or to a concept the reader has started.
   * @param {object} question
   * @returns {boolean}
   */
  function isAvailableForReview(question) {
    if (!isStrictOrder()) {
      return true;
    }
    if (!question.concept || !conceptById(question.concept)) {
      return true;
    }
    return progressOf(question.concept) !== "new";
  }

  // ----------------------------------------------------- learn session

  /**
   * The concepts a Learn session would teach next, in book order.
   * A concept that waits only for one taught earlier in the same
   * session counts as ready.
   * @param {{unitId?: string, conceptIds?: string[],
   *          conceptCount?: number, onlyUnfinished?: boolean}} options
   *   onlyUnfinished: skip started ideas whose questions have all been
   *   answered (their questions come back as reviews instead)
   * @returns {object[]}
   */
  function conceptsToLearn(options) {
    const wanted = options.conceptIds || null;
    const unitId = options.unitId || "all";
    const limit = wanted ? wanted.length : (
      options.conceptCount || DEFAULT_CONCEPT_COUNT);
    const chosen = [];
    const covered = new Set();
    inTeachingOrder(Boolean(wanted)).forEach(function consider(concept) {
      if (options.coreOnly && !isCore(concept)) {
        return;
      }
      const inScope = wanted ? wanted.includes(concept.id) :
        unitId === "all" || concept.unit === unitId;
      const progress = progressOf(concept.id);
      const needsTeaching = wanted || progress === "new" ||
        (progress === "learning" &&
          (!options.onlyUnfinished || hasUnansweredQuestion(concept.id)));
      if (chosen.length >= limit || !inScope || !needsTeaching) {
        return;
      }
      if (!wanted && progress === "new" &&
          !requirementsMet(concept.id, covered)) {
        return;
      }
      chosen.push(concept);
      covered.add(concept.id);
    });
    return chosen;
  }

  /**
   * The ideas in the order they are offered: book order, except that
   * core ideas come first when nobody asked for particular ideas.
   * @param {boolean} isAskedFor  the reader chose the ideas
   * @returns {object[]}
   */
  function inTeachingOrder(isAskedFor) {
    const list = concepts().slice();
    if (isAskedFor || !hasCoreIdeas()) {
      return list;
    }
    return list.filter(isCore).concat(list.filter(function notCore(concept) {
      return !isCore(concept);
    }));
  }

  /** @returns {boolean} true if a ladder question was never answered */
  function hasUnansweredQuestion(conceptId) {
    return ladderOf(conceptId).some(function isUnanswered(question) {
      return !quiz.memory.isScored(question.id);
    });
  }

  /**
   * The steps of a Learn session.
   *
   * For a new concept: its pretest, its card, then its whole ladder.
   * For a concept already started: the ladder questions that are not
   * yet right, or due again. After each concept, up to two due
   * questions from earlier concepts are mixed in.
   *
   * Steps are question objects the session can show. A step may be a
   * copy of a question marked isPretestRun or isReviewRun, or a
   * made-up "lesson" step that shows a card.
   * @param {{unitId?: string, conceptIds?: string[],
   *          conceptCount?: number}} options
   * @returns {{steps: object[], titles: string[], conceptIds: string[]}}
   */
  function buildLearnSession(options) {
    const chosen = conceptsToLearn(options);
    const chosenIds = new Set(chosen.map(function idOf(concept) {
      return concept.id;
    }));
    const used = new Set();
    let steps = [];
    chosen.forEach(function addConcept(concept) {
      steps = steps.concat(stepsForConcept(concept,
        Boolean(options.conceptIds)));
      steps = steps.concat(dueReviewSteps(chosenIds, used));
    });
    return {
      steps,
      titles: chosen.map(function titleOf(concept) {
        return concept.title;
      }),
      conceptIds: Array.from(chosenIds),
    };
  }

  /**
   * A session plan for a Learn session (the shape js/session.js
   * starts). The plan has no steps when nothing is left to teach.
   * @param {{unitId?: string, conceptIds?: string[],
   *          conceptCount?: number}} options
   * @returns {{questions: object[], isGuided: boolean, isTimed: boolean,
   *            conceptTitles: string[], scopeName: string}}
   */
  function createLearnPlan(options) {
    const built = buildLearnSession(options);
    return {
      questions: built.steps,
      isGuided: true,
      isTimed: false,
      conceptTitles: built.titles,
      scopeName: "Learn: " + built.titles.join(", "),
    };
  }

  /**
   * The plan behind "Keep me going": due reviews first (the weakest one
   * opens the session, as the hardest job comes first), then the next
   * idea to teach (pretest, card, ladder), then one easy review so the
   * session ends on something the reader knows. With nothing due and
   * nothing new it falls back to questions the reader finds hard, then
   * to a mixed set.
   * @param {{unitId?: string, coreOnly?: boolean, maxReviews?: number,
   *          scopeName?: string}} options
   *   coreOnly: teach and review core ideas only (the 5-minute session)
   * @returns {{questions: object[], isGuided: boolean, isTimed: boolean,
   *            conceptTitles: string[], scopeName: string,
   *            reviewCount: number, fallback: string}}
   */
  function createKeepGoingPlan(options) {
    const unitId = options.unitId || "all";
    const inScope = function isInScope(question) {
      return (unitId === "all" || question.unit === unitId) &&
        (!options.coreOnly || isCoreQuestion(question));
    };
    const reviews = quiz.book.allQuestions()
      .filter(function isDue(question) {
        return inScope(question) &&
          quiz.memory.isWaitingForReview(question.id);
      })
      .sort(function weakestFirst(first, second) {
        return quiz.memory.memoryLevelOf(first.id) -
          quiz.memory.memoryLevelOf(second.id);
      })
      .slice(0, options.maxReviews || KEEP_GOING_REVIEWS)
      .map(function markAsReview(question) {
        return Object.assign({}, question, { isReviewRun: true });
      });
    const built = buildLearnSession({
      unitId, conceptCount: 1, onlyUnfinished: true,
      coreOnly: options.coreOnly,
    });
    const seen = new Set(reviews.map(function idOf(question) {
      return question.id;
    }));
    const taught = built.steps.filter(function isNew(step) {
      return !seen.has(step.id);
    });
    const questions = reviews.concat(taught);
    const plan = {
      questions,
      isGuided: built.conceptIds.length > 0,
      isTimed: false,
      conceptTitles: built.titles,
      scopeName: options.scopeName || "Keep going",
      reviewCount: reviews.length,
      fallback: "",
    };
    if (questions.length === 0) {
      addFallback(plan, inScope);
    } else {
      addEasyEnding(plan, inScope);
    }
    return plan;
  }

  /**
   * The 5-minute session: the same plan as Keep me going, but only core
   * ideas (the few that give most of the value) and fewer reviews.
   * @param {{unitId?: string}} options
   * @returns {object} a plan, see createKeepGoingPlan
   */
  function createQuickPlan(options) {
    return createKeepGoingPlan({
      unitId: options.unitId,
      coreOnly: true,
      maxReviews: QUICK_REVIEWS,
      scopeName: "5-minute session",
    });
  }

  /**
   * @param {object} question
   * @returns {boolean} true if the question's idea is a core idea
   */
  function isCoreQuestion(question) {
    const concept = conceptById(question.concept);
    return !concept || isCore(concept);
  }

  /**
   * End the session on an easy review: the most secure earlier question
   * that is not already in the session. The last thing a reader does is
   * what they remember of the session, so it should be a success.
   * @param {object} plan
   * @param {function(object): boolean} inScope
   */
  function addEasyEnding(plan, inScope) {
    const used = new Set(plan.questions.map(function idOf(step) {
      return step.id;
    }));
    const easiest = quiz.book.allQuestions()
      .filter(function isEasy(question) {
        return inScope(question) && !used.has(question.id) &&
          question.kind !== "lesson" &&
          quiz.memory.isScored(question.id) &&
          quiz.memory.memoryLevelOf(question.id) >= CLOSER_MIN_LEVEL;
      })
      .sort(function strongestFirst(first, second) {
        return quiz.memory.memoryLevelOf(second.id) -
          quiz.memory.memoryLevelOf(first.id);
      })[0];
    if (easiest) {
      plan.questions = plan.questions.concat(Object.assign({}, easiest,
        { isReviewRun: true, isEasyEnding: true }));
    }
  }

  /**
   * Fill an empty Keep going plan with hard questions, or a mixed set.
   * @param {object} plan
   * @param {function(object): boolean} inScope
   */
  function addFallback(plan, inScope) {
    const all = quiz.book.allQuestions().filter(function inChosen(question) {
      return inScope(question) && question.kind !== "lesson";
    });
    const gaps = all.filter(function isHard(question) {
      return quiz.memory.isGap(question.id);
    });
    const chosen = gaps.length ? gaps : all;
    plan.fallback = gaps.length ? "gaps" : "mix";
    plan.questions = quiz.helpers.shuffledCopy(chosen)
      .slice(0, KEEP_GOING_FALLBACK);
  }

  /**
   * @param {object} concept
   * @param {boolean} isAskedFor  the reader chose this idea ("Teach me")
   * @returns {object[]} pretest, card and ladder steps for one concept
   */
  function stepsForConcept(concept, isAskedFor) {
    const ladder = ladderOf(concept.id);
    if (progressOf(concept.id) === "new") {
      const steps = [];
      const pretest = pretestOf(concept.id);
      if (pretest) {
        steps.push(Object.assign({}, pretest, { isPretestRun: true }));
      }
      steps.push(createLessonStep(concept));
      return steps.concat(ladder);
    }
    if (isAskedFor) {
      return [createLessonStep(concept)].concat(ladder);
    }
    return ladder.filter(function needsWork(question) {
      return !quiz.memory.isScored(question.id) ||
        quiz.memory.memoryLevelOf(question.id) < UNDERSTOOD_LEVEL ||
        quiz.memory.isWaitingForReview(question.id);
    });
  }

  /**
   * The step that shows a concept card.
   * @param {object} concept
   * @returns {object}
   */
  function createLessonStep(concept) {
    return {
      id: "lesson:" + concept.id,
      kind: "lesson",
      role: "lesson",
      concept: concept.id,
      unit: concept.unit,
      unitTitle: concept.unitTitle,
      section: concept.section,
      q: concept.title,
    };
  }

  /**
   * Due questions from concepts the reader has started, other than the
   * ones being taught now. Weakest first.
   * @param {Set<string>} excludedConceptIds
   * @param {Set<string>} used  question ids already placed in the session
   * @returns {object[]} copies marked isReviewRun
   */
  function dueReviewSteps(excludedConceptIds, used) {
    return quiz.book.allQuestions()
      .filter(function isCandidate(question) {
        return question.concept &&
          !excludedConceptIds.has(question.concept) &&
          !used.has(question.id) &&
          quiz.memory.isWaitingForReview(question.id);
      })
      .sort(function weakestFirst(first, second) {
        return quiz.memory.memoryLevelOf(first.id) -
          quiz.memory.memoryLevelOf(second.id);
      })
      .slice(0, REVIEWS_AFTER_EACH_CONCEPT)
      .map(function markAsReview(question) {
        used.add(question.id);
        return Object.assign({}, question, { isReviewRun: true });
      });
  }

  /**
   * How many scored questions a list of steps holds (cards and
   * pretests are not scored).
   * @param {object[]} steps
   * @returns {number}
   */
  function countScoredSteps(steps) {
    return steps.filter(function isScoredStep(step) {
      return step.kind !== "lesson" && !step.isPretestRun;
    }).length;
  }

  // ----------------------------------------------------- where it breaks

  /**
   * Where an idea breaks down for this reader, worked out from the saved
   * records of its ladder (nothing extra is stored). A part of the
   * ladder (basics, applying, new situations) is shaky when a question in
   * it was missed and is still at a low memory level. It is solid when
   * every question in it has been answered and none is shaky.
   * @param {string} conceptId
   * @returns {{solid: string[], shaky: string, questions: object[],
   *            buildsOn: string}|null}  null when nothing is shaky yet
   */
  function weakPartOf(conceptId) {
    const ladder = ladderOf(conceptId);
    const solid = [];
    let shaky = null;
    PARTS.forEach(function check(part) {
      const members = ladder.filter(function inPart(question) {
        return partOf(question).id === part.id;
      });
      const shakyOnes = members.filter(isShaky);
      const allAnswered = members.length > 0 && members.every(
        function answered(question) {
          return quiz.memory.isScored(question.id);
        });
      if (shakyOnes.length && !shaky) {
        shaky = { name: part.name, questions: members };
      } else if (allAnswered && !shakyOnes.length) {
        solid.push(part.name);
      }
    });
    if (!shaky) {
      return null;
    }
    return {
      solid,
      shaky: shaky.name,
      questions: shaky.questions,
      buildsOn: startedBuildsOnTitle(conceptId),
    };
  }

  /**
   * @param {object} question
   * @returns {{id: string, name: string}} the ladder part it belongs to
   */
  function partOf(question) {
    return PARTS.find(function hasRole(part) {
      return part.roles.includes(question.role);
    }) || PARTS[1];
  }

  /** @returns {boolean} true if the question was missed and is still low */
  function isShaky(question) {
    return quiz.memory.timesMissed(question.id) > 0 &&
      quiz.memory.memoryLevelOf(question.id) <= WEAK_LEVEL;
  }

  /**
   * The title of a required idea that is still New, if any: a shaky idea
   * may simply be missing what it builds on.
   * @param {string} conceptId
   * @returns {string}  "" when there is none
   */
  function startedBuildsOnTitle(conceptId) {
    const waiting = (conceptById(conceptId).requires || []).filter(
      function isNotStarted(requiredId) {
        return progressOf(requiredId) === "new";
      });
    return waiting.length ? conceptById(waiting[0]).title : "";
  }

  // ---------------------------------------------------------- drawing

  /**
   * The small label above a question: its role and its type, e.g.
   * "One step further · Multiple choice".
   * @param {object} question
   * @param {string} typeLabel  from quiz.questionTypes.labelFor
   * @returns {string}
   */
  function stepLabel(question, typeLabel) {
    if (question.kind === "lesson") {
      return "The idea";
    }
    if (question.isReviewRun) {
      return "Review · " + typeLabel;
    }
    const role = ROLE_NAMES[question.role];
    return role ? role + " · " + typeLabel : typeLabel;
  }

  /**
   * The text of a concept card: paragraphs, the worked example and the
   * rule to remember.
   * @param {object} concept
   * @returns {HTMLElement}
   */
  function createCardContent(concept) {
    const card = concept.card || {};
    const content = createElement("div", "idea-card");
    if (concept.question) {
      const guide = createElement("p", "idea-question");
      guide.appendChild(createElement("b", null, "Read to answer: "));
      guide.appendChild(document.createTextNode(concept.question));
      content.appendChild(guide);
    }
    (card.paragraphs || []).forEach(function addParagraph(text) {
      content.appendChild(createElement("p", "idea-paragraph", text));
    });
    if (card.example) {
      const example = createElement("div", "idea-example");
      example.appendChild(createElement("b", null, "Worked example"));
      example.appendChild(createElement("p", null, card.example));
      content.appendChild(example);
    }
    if (card.rule) {
      const rule = createElement("p", "idea-rule");
      rule.appendChild(createElement("b", null, "Rule to remember: "));
      rule.appendChild(document.createTextNode(card.rule));
      content.appendChild(rule);
    }
    if (card.limits) {
      const limits = createElement("p", "idea-limits");
      limits.appendChild(createElement("b", null, "Where it stops working: "));
      limits.appendChild(document.createTextNode(card.limits));
      content.appendChild(limits);
    }
    return content;
  }

  /**
   * A panel with a concept's card inside. Before an answer it is called
   * "Read the idea" (the full card, not a hint); after an answer it is
   * "Show the idea again".
   * @param {object} concept
   * @param {boolean} isOpen
   * @param {boolean} [isBeforeAnswer]
   * @returns {HTMLElement}
   */
  function createIdeaAgainPanel(concept, isOpen, isBeforeAnswer) {
    const details = createElement("details", "idea-again");
    details.open = isOpen;
    details.appendChild(createElement("summary", null,
      (isBeforeAnswer ? "Read the idea: " : "Show the idea again: ") +
      concept.title));
    details.appendChild(createCardContent(concept));
    return details;
  }

  /**
   * What to tell a reader who missed a question: which idea to reread.
   * @param {object} question
   * @returns {string}
   */
  function rereadText(question) {
    const concept = conceptById(question.concept);
    if (!concept) {
      return quiz.book.unitFullName(question) + ". " +
        quiz.book.labels.topic + ": " + question.section;
    }
    return "Idea: " + concept.title + " (" +
      quiz.book.unitShortName(question) + ")";
  }

  quiz.learning = {
    DEFAULT_CONCEPT_COUNT,
    concepts,
    hasConcepts,
    hasCoreIdeas,
    isCore,
    weakPartOf,
    createQuickPlan,
    conceptById,
    questionsOf,
    pretestOf,
    ladderOf,
    progressOf,
    statusOf,
    statusName,
    missingRequirementTitles,
    isAvailableForReview,
    isStrictOrder,
    createKeepGoingPlan,
    conceptsToLearn,
    buildLearnSession,
    createLearnPlan,
    countScoredSteps,
    stepLabel,
    createCardContent,
    createIdeaAgainPanel,
    rereadText,
  };
})((window.RecallQuiz = window.RecallQuiz || {}));
