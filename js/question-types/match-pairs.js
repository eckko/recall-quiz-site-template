/*
 * match-pairs.js
 * "match": tap an item on the left, then its partner on the right.
 *
 * questions.json: "pairs": [["left", "right"], ...]
 * (the right-hand column is shown shuffled)
 *
 * Linked pairs share a colour. All pairs right is "got", at least half
 * is "part".
 */
(function setUpMatchPairs(quiz) {
  "use strict";

  const { createElement, createButton, createCheckButton, shuffledCopy } =
    quiz.helpers;

  /** Colours for linked pairs, taken from the theme */
  const PAIR_COLOURS = [
    "var(--color-pop-1)",
    "var(--color-pop-2)",
    "var(--color-pop-3)",
    "var(--color-pop-4)",
    "var(--color-accent)",
    "var(--color-correct)",
  ];

  /**
   * Colour a button to show which pair it belongs to.
   * @param {HTMLElement} button
   * @param {number} pairNumber  the left item's index
   */
  function paintAsPair(button, pairNumber) {
    const colour = PAIR_COLOURS[pairNumber % PAIR_COLOURS.length];
    button.style.borderColor = colour;
    button.style.background =
      "color-mix(in srgb," + colour + " 16%,var(--color-card))";
  }

  /**
   * Draw this question type and wait for the answer.
   * @param {object} question
   * @param {object} card
   */
  function showMatchPairs(question, card) {
    const leftItems = question.pairs.map(function leftOf(pair) {
      return pair[0];
    });
    // Each right item remembers which left item it belongs to.
    const rightItems = shuffledCopy(question.pairs.map(
      function rightOf(pair, leftIndex) {
        return { text: pair[1], belongsTo: leftIndex };
      }));
    /** Links the reader made: left index -> right item */
    const links = new Map();
    let selectedLeft = null;
    let isChecked = false;

    const grid = createElement("div", "match-grid");
    const leftColumn = createElement("div", "match-column");
    const rightColumn = createElement("div", "match-column");
    const actions = createElement("div", "actions");
    const checkButton = createCheckButton("Check matches",
      function checkByClick() {
        checkMatches(false);
      });
    checkButton.disabled = true;
    actions.appendChild(checkButton);
    grid.appendChild(leftColumn);
    grid.appendChild(rightColumn);
    card.answerArea.appendChild(createElement("p", "note",
      "Tap an item on the left, then tap its match. " +
      "Tap a linked item to undo."));
    card.answerArea.appendChild(grid);
    card.answerArea.appendChild(actions);

    /**
     * Which left item a right item is linked to.
     * @param {object} rightItem
     * @returns {number}  the left index linked to it, or -1
     */
    function leftIndexLinkedTo(rightItem) {
      for (const [leftIndex, linkedItem] of links) {
        if (linkedItem === rightItem) {
          return leftIndex;
        }
      }
      return -1;
    }

    /** Tapping a left item selects it, or unlinks it if linked. */
    function tapLeft(leftIndex) {
      if (isChecked) {
        return;
      }
      if (links.has(leftIndex)) {
        links.delete(leftIndex);
        selectedLeft = leftIndex;
      } else {
        selectedLeft = selectedLeft === leftIndex ? null : leftIndex;
      }
      redraw();
    }

    /** Tapping a right item links it, or unlinks it if linked. */
    function tapRight(rightItem) {
      if (isChecked) {
        return;
      }
      const linkedLeft = leftIndexLinkedTo(rightItem);
      if (linkedLeft >= 0) {
        links.delete(linkedLeft);
        selectedLeft = null;
      } else if (selectedLeft !== null) {
        links.set(selectedLeft, rightItem);
        selectedLeft = null;
      }
      redraw();
    }

    /** Draw both columns with the current links. */
    function redraw() {
      leftColumn.textContent = "";
      rightColumn.textContent = "";
      leftItems.forEach(function drawLeft(text, leftIndex) {
        const isSelected = selectedLeft === leftIndex;
        const button = createButton(text,
          "match-item" + (isSelected ? " is-selected" : ""),
          function onTap() {
            tapLeft(leftIndex);
          });
        if (links.has(leftIndex)) {
          paintAsPair(button, leftIndex);
        }
        leftColumn.appendChild(button);
      });
      rightItems.forEach(function drawRight(rightItem) {
        const button = createButton(rightItem.text, "match-item",
          function onTap() {
            tapRight(rightItem);
          });
        const linkedLeft = leftIndexLinkedTo(rightItem);
        if (linkedLeft >= 0) {
          paintAsPair(button, linkedLeft);
        }
        rightColumn.appendChild(button);
      });
      checkButton.disabled = links.size !== leftItems.length;
    }

    /**
     * Mark the answer and show the result (once only).
     * @param {boolean} timedOut  the timer ran out
     */
    function checkMatches(timedOut) {
      if (isChecked) {
        return;
      }
      isChecked = true;
      actions.remove();
      selectedLeft = null;
      const linkedEverything = links.size === leftItems.length;
      const marked = createMarkedResults(question, leftItems, links);
      grid.replaceWith(marked.element);
      let result = quiz.questionTypes.resultFromCount(marked.rightCount,
        leftItems.length);
      if (timedOut && !linkedEverything) {
        result = "miss";
      }
      card.showResult(result, { timedOut });
    }

    redraw();
    card.setKeyHint("Keys: Enter to check");
    card.setKeyHandler(function checkWithEnter(event) {
      if (event.key === "Enter" && !checkButton.disabled) {
        checkMatches(false);
      }
    });
    card.setTimeUpHandler(function checkWhatIsLinked() {
      checkMatches(true);
    });
  }

  /**
   * One row per left item, marked right or wrong, with the right partner
   * shown for wrong ones.
   * @param {object} question
   * @param {string[]} leftItems
   * @param {Map<number, object>} links
   * @returns {{element: HTMLElement, rightCount: number}}
   */
  function createMarkedResults(question, leftItems, links) {
    const results = createElement("div", "match-results");
    let rightCount = 0;
    leftItems.forEach(function addResultRow(leftText, leftIndex) {
      const linkedItem = links.get(leftIndex);
      const isRight = Boolean(linkedItem) &&
        linkedItem.belongsTo === leftIndex;
      if (isRight) {
        rightCount += 1;
      }
      const row = createElement("div",
        "match-result-row " + (isRight ? "is-right" : "is-wrong"));
      row.appendChild(createElement("b", null, leftText));
      row.appendChild(createElement("span", null,
        linkedItem ? linkedItem.text : "(not matched)"));
      if (!isRight) {
        row.appendChild(createElement("em", "option-note",
          "Should be: " + question.pairs[leftIndex][1]));
      }
      results.appendChild(row);
    });
    return { element: results, rightCount };
  }

  quiz.questionTypes.register("match", {
    label: "Match the pairs",
    show: showMatchPairs,
  });
})((window.RecallQuiz = window.RecallQuiz || {}));
