/*
 * select-all.js
 * "multi": tick every option that applies, then check.
 *
 * questions.json: "options": [...], "answers": [indexes of right options]
 *
 * All right and nothing wrong is "got". Some right and nothing wrong is
 * "part". Any wrong tick is "miss".
 * Keys 1, 2, 3 ... tick and untick; Enter checks.
 */
(function setUpSelectAll(quiz) {
  "use strict";

  const { createElement, createCheckButton } = quiz.helpers;

  /**
   * Draw this question type and wait for the answer.
   * @param {object} question
   * @param {object} card
   */
  function showSelectAll(question, card) {
    const rightIndexes = new Set(question.answers);
    const tickedIndexes = new Set();
    let isChecked = false;

    const buttons = question.options.map(function addOption(text, index) {
      const button = quiz.questionTypes.createOptionButton(text, index);
      button.addEventListener("click", function toggleTick() {
        if (isChecked) {
          return;
        }
        if (tickedIndexes.has(index)) {
          tickedIndexes.delete(index);
        } else {
          tickedIndexes.add(index);
        }
        button.classList.toggle("is-picked", tickedIndexes.has(index));
      });
      card.answerArea.appendChild(button);
      return button;
    });

    const actions = createElement("div", "actions");
    actions.appendChild(createCheckButton("Check my answer",
      function checkByClick() {
        checkTicks(false);
      }));
    card.answerArea.appendChild(actions);

    /**
     * Mark the answer and show the result (once only).
     * @param {boolean} timedOut  the timer ran out
     */
    function checkTicks(timedOut) {
      if (isChecked) {
        return;
      }
      isChecked = true;
      actions.remove();
      const pickedIndexes = Array.from(tickedIndexes);
      const counts = markTicks(buttons, rightIndexes, tickedIndexes);
      card.showResult(resultFromTickCounts(counts),
        { timedOut, pickedIndexes });
    }

    card.setKeyHint("Keys: 1 to " + question.options.length +
      " to tick, Enter to check");
    card.setKeyHandler(function tickByNumberKey(event) {
      const number = parseInt(event.key, 10);
      if (number >= 1 && number <= question.options.length) {
        buttons[number - 1].click();
      } else if (event.key === "Enter") {
        checkTicks(false);
      }
    });
    card.setTimeUpHandler(function checkWhatIsTicked() {
      checkTicks(true);
    });
  }

  /**
   * Show which ticks were right, wrong or missing, and count them.
   * @param {HTMLButtonElement[]} buttons
   * @param {Set<number>} rightIndexes
   * @param {Set<number>} tickedIndexes
   * @returns {{right: number, wrong: number, leftOut: number}}
   */
  function markTicks(buttons, rightIndexes, tickedIndexes) {
    const counts = { right: 0, wrong: 0, leftOut: 0 };
    buttons.forEach(function markOption(button, index) {
      const isRight = rightIndexes.has(index);
      const isTicked = tickedIndexes.has(index);
      button.disabled = true;
      button.classList.remove("is-picked");
      if (isRight && isTicked) {
        button.classList.add("is-right");
        counts.right += 1;
      } else if (isRight) {
        button.classList.add("is-right", "is-unticked");
        addOptionNote(button, "Correct, but you left it out");
        counts.leftOut += 1;
      } else if (isTicked) {
        button.classList.add("is-wrong");
        addOptionNote(button, "Not one of them");
        counts.wrong += 1;
      } else {
        button.classList.add("is-faded");
      }
    });
    return counts;
  }

  /**
   * Add a small note under an option, e.g. "Not one of them".
   * @param {HTMLElement} button
   * @param {string} text
   */
  function addOptionNote(button, text) {
    button.appendChild(createElement("em", "option-note", text));
  }

  /**
   * Turn the tick counts into got, part or miss.
   * @param {{right: number, wrong: number, leftOut: number}} counts
   * @returns {"got"|"part"|"miss"}
   */
  function resultFromTickCounts(counts) {
    if (counts.wrong === 0 && counts.leftOut === 0) {
      return "got";
    }
    if (counts.right > 0 && counts.wrong === 0) {
      return "part";
    }
    return "miss";
  }

  quiz.questionTypes.register("multi", {
    label: "Select all that apply",
    show: showSelectAll,
  });
})((window.RecallQuiz = window.RecallQuiz || {}));
