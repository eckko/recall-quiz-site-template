/*
 * multiple-choice.js
 * Two question types that share one layout:
 *
 *   "mcq"  pick the one right option.
 *          questions.json: "options": [...], "answer": index of the right one
 *   "tf"   true or false.
 *          questions.json: "answer": true or false
 *
 * Keys 1, 2, 3 ... pick an option.
 */
(function setUpMultipleChoice(quiz) {
  "use strict";

  const { createElement, createButton } = quiz.helpers;

  /**
   * Notes chapters ("Place in the argument" and similar) are about how
   * the book is built, so their questions get a different label.
   */
  const STRUCTURE_SECTION_PATTERN =
    /place in the argument|how this chapter|part overview/i;

  /**
   * The label for a multiple-choice question.
   * @param {object} question
   * @returns {string}
   */
  function multipleChoiceLabel(question) {
    if (question.concept) {
      return "Multiple choice";
    }
    if (STRUCTURE_SECTION_PATTERN.test(question.section)) {
      return "Structure: why the book is built this way";
    }
    return "Core idea";
  }

  /**
   * Create one numbered option button.
   * @param {string} text
   * @param {number} index  0 for the first option
   * @returns {HTMLButtonElement}
   */
  function createOptionButton(text, index) {
    const button = createButton(null, "option");
    button.appendChild(createElement("span", "key-number", String(index + 1)));
    button.appendChild(createElement("span", null, text));
    return button;
  }

  /**
   * Show the options and wait for one to be picked.
   * @param {string[]} options
   * @param {number} rightIndex
   * @param {object} question
   * @param {object} card
   */
  function showOptions(options, rightIndex, question, card) {
    let isAnswered = false;
    const buttons = options.map(function addOption(text, index) {
      const button = createOptionButton(text, index);
      button.addEventListener("click", function pickByClick() {
        pickOption(index, false);
      });
      card.answerArea.appendChild(button);
      return button;
    });

    /**
     * Mark the options and show the result (once only).
     * @param {number} pickedIndex  -1 when the time ran out
     * @param {boolean} timedOut
     */
    function pickOption(pickedIndex, timedOut) {
      if (isAnswered) {
        return;
      }
      isAnswered = true;
      markOptions(buttons, rightIndex, pickedIndex);
      const result = pickedIndex === rightIndex ? "got" : "miss";
      card.showResult(result, { timedOut, pickedIndexes: [pickedIndex] });
    }

    card.setKeyHint("Keys: 1 to " + options.length + " to answer");
    card.setKeyHandler(function pickByNumberKey(event) {
      const number = parseInt(event.key, 10);
      if (number >= 1 && number <= options.length) {
        pickOption(number - 1, false);
      }
    });
    card.setTimeUpHandler(function nothingPicked() {
      pickOption(-1, true);
    });
  }

  /**
   * Colour the right option green, the picked wrong one red, and fade
   * the rest. All options stop responding.
   * @param {HTMLButtonElement[]} buttons
   * @param {number} rightIndex
   * @param {number} pickedIndex
   */
  function markOptions(buttons, rightIndex, pickedIndex) {
    buttons.forEach(function markOption(button, index) {
      button.disabled = true;
      if (index === rightIndex) {
        button.classList.add("is-right");
      } else if (index === pickedIndex) {
        button.classList.add("is-wrong");
      } else {
        button.classList.add("is-faded");
      }
    });
  }

  quiz.questionTypes.register("mcq", {
    label: multipleChoiceLabel,
    show: function showMultipleChoice(question, card) {
      showOptions(question.options, question.answer, question, card);
    },
  });

  quiz.questionTypes.register("tf", {
    label: "True or false",
    show: function showTrueOrFalse(question, card) {
      const rightIndex = question.answer ? 0 : 1;
      showOptions(["True", "False"], rightIndex, question, card);
    },
  });

  // Shared with select-all.js, which uses the same option buttons.
  quiz.questionTypes.createOptionButton = createOptionButton;
})((window.RecallQuiz = window.RecallQuiz || {}));
