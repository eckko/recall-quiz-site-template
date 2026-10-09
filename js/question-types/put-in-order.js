/*
 * put-in-order.js
 * "order": tap the items from first to last.
 *
 * questions.json: "items": [...] in the correct order (shown shuffled)
 *
 * All in place is "got", at least half in place is "part".
 */
(function setUpPutInOrder(quiz) {
  "use strict";

  const { createElement, createButton, createCheckButton, shuffledCopy } =
    quiz.helpers;

  /**
   * Draw this question type and wait for the answer.
   * @param {object} question
   * @param {object} card
   */
  function showPutInOrder(question, card) {
    // Each item remembers its correct position.
    const items = shuffledCopy(question.items.map(
      function withPosition(text, correctPosition) {
        return { text, correctPosition };
      }));
    const chosenOrder = [];
    let isChecked = false;

    const answerBox = createElement("div", "order-answer");
    const pool = createElement("div", "order-pool");
    const actions = createElement("div", "actions");
    const checkButton = createCheckButton("Check order",
      function checkByClick() {
        checkOrder(false);
      });
    checkButton.disabled = true;
    actions.appendChild(checkButton);

    card.answerArea.appendChild(createElement("p", "note",
      "Tap the items from first to last. Tap a placed item to take it back."));
    card.answerArea.appendChild(answerBox);
    card.answerArea.appendChild(pool);
    card.answerArea.appendChild(actions);

    /** Redraw the chosen order and the items still to place. */
    function redraw() {
      answerBox.textContent = "";
      pool.textContent = "";
      if (chosenOrder.length === 0) {
        answerBox.appendChild(createElement("div", "placeholder-hint",
          "Your order appears here"));
      }
      chosenOrder.forEach(function drawPlacedItem(item, position) {
        const button = createNumberedItem("button", "order-item is-placed",
          position, item.text);
        button.type = "button";
        button.addEventListener("click", function takeBack() {
          if (!isChecked) {
            chosenOrder.splice(position, 1);
            redraw();
          }
        });
        answerBox.appendChild(button);
      });
      items.forEach(function drawItemToPlace(item) {
        if (chosenOrder.includes(item)) {
          return;
        }
        pool.appendChild(createButton(item.text, "order-item",
          function place() {
            if (!isChecked) {
              chosenOrder.push(item);
              redraw();
            }
          }));
      });
      checkButton.disabled = chosenOrder.length !== items.length;
    }

    /**
     * Mark the answer and show the result (once only).
     * @param {boolean} timedOut  the timer ran out
     */
    function checkOrder(timedOut) {
      if (isChecked) {
        return;
      }
      isChecked = true;
      actions.remove();
      const placedEverything = chosenOrder.length === items.length;
      // Anything not placed goes at the end, so it is marked wrong.
      items.forEach(function placeTheRest(item) {
        if (!chosenOrder.includes(item)) {
          chosenOrder.push(item);
        }
      });
      const rightCount = showMarkedOrder(chosenOrder, answerBox, pool);
      let result = quiz.questionTypes.resultFromCount(rightCount,
        items.length);
      if (timedOut && !placedEverything) {
        result = "miss";
      }
      const correction =
        result === "got" ? null : createCorrectOrder(question.items);
      card.showResult(result, { timedOut, extraContent: correction });
    }

    redraw();
    card.setKeyHint("Keys: Enter to check");
    card.setKeyHandler(function checkWithEnter(event) {
      if (event.key === "Enter" && !checkButton.disabled) {
        checkOrder(false);
      }
    });
    card.setTimeUpHandler(function checkWhatIsPlaced() {
      checkOrder(true);
    });
  }

  /**
   * An element showing a position number and some text.
   * @param {string} tagName  "button" or "div"
   * @param {string} className
   * @param {number} position  0 for the first
   * @param {string} text
   * @returns {HTMLElement}
   */
  function createNumberedItem(tagName, className, position, text) {
    const element = createElement(tagName, className);
    element.appendChild(
      createElement("span", "key-number", String(position + 1)));
    element.appendChild(createElement("span", null, text));
    return element;
  }

  /**
   * Show the reader's order with each item marked right or wrong.
   * @param {object[]} chosenOrder
   * @param {HTMLElement} answerBox
   * @param {HTMLElement} pool
   * @returns {number}  how many items are in the right place
   */
  function showMarkedOrder(chosenOrder, answerBox, pool) {
    answerBox.textContent = "";
    pool.textContent = "";
    let rightCount = 0;
    chosenOrder.forEach(function drawMarkedItem(item, position) {
      const isRight = item.correctPosition === position;
      if (isRight) {
        rightCount += 1;
      }
      const className =
        "order-item is-placed " + (isRight ? "is-right" : "is-wrong");
      answerBox.appendChild(
        createNumberedItem("div", className, position, item.text));
    });
    return rightCount;
  }

  /**
   * "Correct order:" followed by the numbered list.
   * @param {string[]} correctItems
   * @returns {HTMLElement}
   */
  function createCorrectOrder(correctItems) {
    const correction = createElement("div", "correction");
    correction.appendChild(createElement("p", "note", "Correct order:"));
    correctItems.forEach(function addLine(text, position) {
      correction.appendChild(createElement("div", "correction-line",
        position + 1 + ". " + text));
    });
    return correction;
  }

  quiz.questionTypes.register("order", {
    label: "Put in order",
    show: showPutInOrder,
  });
})((window.RecallQuiz = window.RecallQuiz || {}));
