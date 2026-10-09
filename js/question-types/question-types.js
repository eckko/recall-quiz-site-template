/*
 * question-types.js
 * The list of question types. Each type lives in its own file in this
 * folder and registers itself here with:
 *
 *   quiz.questionTypes.register("kind-name", {
 *     label: "Shown above the question",   // text, or a function(question)
 *     show: function (question, card) { ... },
 *   });
 *
 * "kind-name" is the value of "kind" in questions.json.
 *
 * show() draws the answer controls into card.answerArea and, once the
 * reader has answered, calls card.showResult("got" | "part" | "miss")
 * (or card.saveSelfRating(result) to skip the feedback, as recall does).
 * See js/session.js (createQuestionCard) for everything `card` offers.
 */
(function setUpQuestionTypes(quiz) {
  "use strict";

  /** Every registered type, keyed by its "kind" */
  const typesByKind = {};

  /** Used when a question's kind is missing or unknown */
  const FALLBACK_KIND = "mcq";

  /**
   * Add a question type.
   * @param {string} kind  the "kind" value in questions.json
   * @param {{label: (string|Function), show: Function}} definition
   */
  function register(kind, definition) {
    typesByKind[kind] = definition;
  }

  /**
   * The definition for a question's kind.
   * @param {object} question
   * @returns {{label: (string|Function), show: Function}}
   */
  function definitionFor(question) {
    return typesByKind[question.kind] || typesByKind[FALLBACK_KIND];
  }

  /**
   * The small label above the question, e.g. "Put in order".
   * @param {object} question
   * @returns {string}
   */
  function labelFor(question) {
    const label = definitionFor(question).label;
    return typeof label === "function" ? label(question) : label;
  }

  /**
   * Draw a question's answer controls.
   * @param {object} question
   * @param {object} card  see createQuestionCard in js/session.js
   */
  function show(question, card) {
    definitionFor(question).show(question, card);
  }

  /**
   * Work out a result from how many parts were right. All right is
   * "got", at least half is "part", fewer is "miss".
   * @param {number} correctCount
   * @param {number} totalCount
   * @returns {"got"|"part"|"miss"}
   */
  function resultFromCount(correctCount, totalCount) {
    if (correctCount === totalCount) {
      return "got";
    }
    if (correctCount >= Math.ceil(totalCount / 2)) {
      return "part";
    }
    return "miss";
  }

  quiz.questionTypes = { register, labelFor, show, resultFromCount };
})((window.RecallQuiz = window.RecallQuiz || {}));
