/*
 * answer-feedback.js
 * What happens after any question is answered: record the result, show
 * "Correct." (or not), what each option meant, the explanation, the rule
 * to remember and any new idea, then offer the Next button. Also the
 * optional "How sure are you?" row.
 *
 * The feedback is where a question teaches. A question can carry:
 *   optionExplain  one explanation per option (mcq and multi)
 *   explain        the reasoning in a few sentences
 *   rule           one sentence to remember
 *   teaches        a new idea this feedback introduces
 * A question that belongs to a concept also offers its concept card
 * again. See ai-context/learning-design.md.
 */
(function setUpAnswerFeedback(quiz) {
  "use strict";

  const { createElement, createButton, createParagraph } = quiz.helpers;

  const VERDICT_TEXT = {
    got: "Correct.",
    part: "Partly right.",
    miss: "Not yet.",
  };
  const PRETEST_VERDICT_TEXT = {
    got: "Good guess.",
    part: "Partly there.",
    miss: "Not yet, and that is fine.",
  };
  const VERDICT_CLASS = {
    got: "is-correct",
    part: "is-partly",
    miss: "is-incorrect",
  };
  /** A missed warm-up guess is not a failure, so it is not red. */
  const PRETEST_MISS_CLASS = "is-partly";
  const CONFIDENCE_LEVELS = [
    { level: 1, label: "Guessing" },
    { level: 2, label: "Fairly sure" },
    { level: 3, label: "Certain" },
  ];
  const CERTAIN = 3;
  const CONFETTI_FOR_RIGHT_ANSWER = 18;

  /** @returns {object} the running session (see js/session.js) */
  function session() {
    return quiz.session.state;
  }

  // ---------------------------------------------------------- results

  /**
   * True if the reader said "Certain" and still got it wrong.
   * @param {"got"|"part"|"miss"} result
   * @returns {boolean}
   */
  function isConfidentMiss(result) {
    const current = session();
    return current.askConfidence && current.confidenceLevel === CERTAIN &&
      result === "miss";
  }

  /**
   * Count the result in this session and in the reader's saved progress.
   * A pretest guess is not scored: it is only noted (see
   * quiz.memory.recordPretest).
   * @param {object} question
   * @param {"got"|"part"|"miss"} result
   */
  function recordResult(question, result) {
    const current = session();
    current.currentQuestionAnswered = true;
    if (question.isPretestRun) {
      current.pretestCount += 1;
      quiz.memory.recordPretest(question.id, result);
      return;
    }
    current.score[result] += 1;
    if (result === "miss") {
      current.missedQuestions.push(question);
    } else if (result === "got") {
      current.rightQuestions.push(question);
    }
    const wasConfidentMiss = isConfidentMiss(result);
    if (wasConfidentMiss) {
      current.confidentMissCount += 1;
    }
    quiz.memory.recordAnswer(question.id, result, wasConfidentMiss);
  }

  /**
   * Record the answer and show the feedback under it.
   * @param {object} question
   * @param {object} card  see createQuestionCard in js/session.js
   * @param {"got"|"part"|"miss"} result
   * @param {{timedOut?: boolean, extraContent?: HTMLElement,
   *          pickedIndexes?: number[]}} [options]
   *   timedOut: the timer ran out before an answer
   *   extraContent: shown above the explanation, e.g. the right order
   *   pickedIndexes: the options the reader chose (mcq and multi), so
   *     the per-option explanations can say which one they picked
   */
  function showAnswerFeedback(question, card, result, options) {
    const settings = options || {};
    quiz.timers.stopQuestionTimer();
    unlockAnswerArea(card.answerArea);
    recordResult(question, result);

    const feedback = createElement("div", "reveal-in");
    feedback.appendChild(createVerdict(question, result, settings.timedOut));
    if (question.isPretestRun) {
      feedback.appendChild(createElement("p", "note",
        "This was a warm-up guess, so it is not scored."));
    }
    if (settings.extraContent) {
      feedback.appendChild(settings.extraContent);
    }
    appendTeachingFeedback(feedback, question, result, settings);
    if (isConfidentMiss(result)) {
      feedback.appendChild(createElement("p", "confident-miss",
        "You were certain, so this is a confident miss. " +
        "It is worth rereading."));
    }
    appendWhereToGoDeeper(feedback, question, result);
    const nextButton = createNextButton();
    const actions = createElement("div", "actions");
    actions.appendChild(nextButton);
    feedback.appendChild(actions);
    card.answerArea.appendChild(feedback);
    // Optional add-ons (such as the HTRAB overlay) add to the feedback.
    document.dispatchEvent(new CustomEvent("recallquiz:feedback-shown",
      { detail: { question, result, feedback } }));
    nextButton.focus();

    card.setKeyHint("Keys: Enter for next");
    card.setKeyHandler(function goOnWithEnter(event) {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        quiz.session.goToNextQuestion();
      }
    });
    if (result === "got" && !question.isPretestRun) {
      quiz.celebrate(feedback, CONFETTI_FOR_RIGHT_ANSWER);
    }
  }

  /**
   * "Correct.", "Partly right.", "Not yet." or "Time's up.". A
   * warm-up guess gets gentler wording.
   * @param {object} question
   * @param {"got"|"part"|"miss"} result
   * @param {boolean} timedOut
   * @returns {HTMLElement}
   */
  function createVerdict(question, result, timedOut) {
    if (question.isPretestRun) {
      const pretestClass = result === "miss" ?
        PRETEST_MISS_CLASS : VERDICT_CLASS[result];
      return createElement("p", "verdict " + pretestClass,
        timedOut ? "Time's up." : PRETEST_VERDICT_TEXT[result]);
    }
    const text = timedOut ? "Time's up." : VERDICT_TEXT[result];
    return createElement("p", "verdict " + VERDICT_CLASS[result], text);
  }

  // ---------------------------------------------------- teaching parts

  /**
   * What each option meant, the explanation, the rule to remember and
   * the new idea, in that order. Each part appears only if the question
   * has it.
   * @param {HTMLElement} feedback
   * @param {object} question
   * @param {"got"|"part"|"miss"} result
   * @param {{pickedIndexes?: number[]}} settings
   */
  function appendTeachingFeedback(feedback, question, result, settings) {
    const optionExplanations =
      createOptionExplanations(question, result, settings.pickedIndexes);
    if (optionExplanations) {
      feedback.appendChild(optionExplanations);
    }
    if (question.explain) {
      feedback.appendChild(
        createElement("div", "explanation", question.explain));
    }
    if (question.rule) {
      feedback.appendChild(createLabelledLine("feedback-rule",
        "Rule to remember: ", question.rule));
    }
    if (question.teaches) {
      feedback.appendChild(createLabelledLine("feedback-teaches",
        "New idea: ", question.teaches));
    }
  }

  /**
   * A line with a bold label, e.g. "Rule to remember: ...".
   * @param {string} className
   * @param {string} label
   * @param {string} text
   * @returns {HTMLElement}
   */
  function createLabelledLine(className, label, text) {
    const line = createElement("p", className);
    line.appendChild(createElement("b", null, label));
    line.appendChild(document.createTextNode(text));
    return line;
  }

  /**
   * "Why each option": one entry per option saying why it is right or
   * why it tempts and fails. Open after a miss, closed after a right
   * answer. Null when the question has no optionExplain.
   * @param {object} question
   * @param {"got"|"part"|"miss"} result
   * @param {number[]} [pickedIndexes]
   * @returns {HTMLElement|null}
   */
  function createOptionExplanations(question, result, pickedIndexes) {
    const explanations = question.optionExplain;
    if (!Array.isArray(explanations) || !Array.isArray(question.options)) {
      return null;
    }
    const rightIndexes = new Set(
      question.kind === "multi" ? question.answers : [question.answer]);
    const picked = new Set(pickedIndexes || []);
    const box = createElement("details", "option-explanations-box");
    box.open = result !== "got";
    box.appendChild(createElement("summary", null,
      result === "got" ? "Why the other options fail" : "Why each option"));
    const list = createElement("ul", "option-explanations");
    question.options.forEach(function addOption(text, index) {
      const isRight = rightIndexes.has(index);
      const isPicked = picked.has(index);
      const entry = createElement("li",
        isRight ? "is-right" : (isPicked ? "is-picked" : ""));
      entry.appendChild(createElement("span", "option-tag",
        optionTag(isRight, isPicked, question.kind)));
      entry.appendChild(createElement("span", "option-text", text));
      entry.appendChild(createElement("span", "option-reason",
        explanations[index]));
      list.appendChild(entry);
    });
    box.appendChild(list);
    return box;
  }

  /**
   * The small tag above an option explanation.
   * @param {boolean} isRight
   * @param {boolean} isPicked
   * @param {string} kind  "mcq" or "multi"
   * @returns {string}
   */
  function optionTag(isRight, isPicked, kind) {
    if (isRight && isPicked) {
      return "Right, you chose it";
    }
    if (isRight) {
      return kind === "multi" ? "Right, you left it out" : "Right answer";
    }
    return isPicked ? "You chose this" : "Not this one";
  }

  /**
   * The concept card again (open after a miss) for a question that
   * belongs to a concept, or the old "reread" line for plain books.
   * @param {HTMLElement} feedback
   * @param {object} question
   * @param {"got"|"part"|"miss"} result
   */
  function appendWhereToGoDeeper(feedback, question, result) {
    const concept = quiz.learning.conceptById(question.concept);
    if (concept) {
      feedback.appendChild(quiz.learning.createIdeaAgainPanel(concept,
        result === "miss" && !question.isPretestRun));
      return;
    }
    feedback.appendChild(createRereadHint(question));
  }

  /**
   * "To go deeper, reread Chapter 9, Title, topic Section."
   * @param {object} question
   * @returns {HTMLElement}
   */
  function createRereadHint(question) {
    return createParagraph("reread-hint", [
      "To go deeper, reread ",
      { bold: quiz.book.unitFullName(question) },
      ", topic ",
      { bold: question.section },
      ".",
    ]);
  }

  /**
   * "Next question", "Read the idea" (when a card comes next) or "See
   * results".
   * @returns {HTMLButtonElement}
   */
  function createNextButton() {
    const current = session();
    const next = current.questions[current.currentIndex + 1];
    let label = "Next question";
    if (!next) {
      label = "See results";
    } else if (next.kind === "lesson") {
      label = "Read the idea";
    }
    return createButton(label, "button primary",
      quiz.session.goToNextQuestion);
  }

  // ---------------------------------------------------------- confidence

  /**
   * The "How sure are you?" row. Until the reader picks one, the answer
   * area is greyed out and ignores taps and keys.
   * @param {HTMLElement} answerArea
   * @returns {HTMLElement}
   */
  function createConfidenceRow(answerArea) {
    const row = createElement("div", "confidence-row");
    row.appendChild(createElement("span", null, "How sure are you?"));
    CONFIDENCE_LEVELS.forEach(function addLevelButton(choice) {
      const button = createButton(choice.label, "pill-button",
        function chooseLevel() {
          session().confidenceLevel = choice.level;
          unlockAnswerArea(answerArea);
          button.blur();   // so Enter goes to the answer, not this button
          markChosenButton(row, button);
        });
      row.appendChild(button);
    });
    session().confidenceLevel = null;
    lockAnswerArea(answerArea);
    return row;
  }

  /**
   * Highlight one button in a row and clear the others.
   * @param {HTMLElement} row
   * @param {HTMLElement} chosenButton
   */
  function markChosenButton(row, chosenButton) {
    row.querySelectorAll("button").forEach(function markButton(button) {
      button.classList.toggle("is-on", button === chosenButton);
    });
  }

  /**
   * Grey out the answer area until a confidence level is picked.
   * @param {HTMLElement} answerArea
   */
  function lockAnswerArea(answerArea) {
    session().isAnswerAreaLocked = true;
    answerArea.classList.add("is-locked");
  }

  /**
   * Let the reader answer again.
   * @param {HTMLElement} answerArea
   */
  function unlockAnswerArea(answerArea) {
    session().isAnswerAreaLocked = false;
    answerArea.classList.remove("is-locked");
  }

  quiz.answerFeedback = {
    showAnswerFeedback,
    recordResult,
    createRereadHint,
    createConfidenceRow,
  };
})((window.RecallQuiz = window.RecallQuiz || {}));
