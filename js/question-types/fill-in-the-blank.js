/*
 * fill-in-the-blank.js
 * "fill": type the missing word or phrase.
 *
 * questions.json: "accept": ["main answer", "other accepted wording", ...]
 *
 * Matching ignores capitals, punctuation and the words "the", "a", "an".
 * Devanagari and Sanskrit (IAST) spellings are compared as plain Roman
 * letters, so "धर्म", "dharma" and "dharmā" count as the same answer.
 * One wrong letter is forgiven in answers of 6 letters or more. If the
 * answer still does not match, the reader decides how close it was.
 */
(function setUpFillInTheBlank(quiz) {
  "use strict";

  const {
    createElement,
    createButton,
    createCheckButton,
    createParagraph,
  } = quiz.helpers;

  const SHORTEST_ANSWER_WITH_TYPO_ALLOWED = 6;
  /** Wait for the box to be on screen before putting the cursor in it */
  const FOCUS_DELAY_MS = 50;
  const SELF_RATINGS = [
    { result: "miss", label: "Different" },
    { result: "part", label: "Close" },
    { result: "got", label: "Same idea" },
  ];

  /**
   * Make an answer easy to compare: lower case, no punctuation, no
   * "the", "a" or "an", single spaces.
   * @param {string} text
   * @returns {string}
   */
  function simplifyForComparison(text) {
    return quiz.transliteration.toLooseRoman(text)
      .replace(/[^\p{L}\p{N} ]+/gu, " ")
      .replace(/\b(the|a|an)\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  /**
   * How many single-letter edits turn one text into the other
   * (Levenshtein distance).
   * @param {string} first
   * @param {string} second
   * @returns {number}
   */
  function editDistance(first, second) {
    const table = [];
    for (let row = 0; row <= first.length; row++) {
      table[row] = [row];
    }
    for (let column = 1; column <= second.length; column++) {
      table[0][column] = column;
    }
    for (let row = 1; row <= first.length; row++) {
      for (let column = 1; column <= second.length; column++) {
        const sameLetter = first[row - 1] === second[column - 1];
        table[row][column] = Math.min(
          table[row - 1][column] + 1,
          table[row][column - 1] + 1,
          table[row - 1][column - 1] + (sameLetter ? 0 : 1)
        );
      }
    }
    return table[first.length][second.length];
  }

  /**
   * Compare the typed answer with every accepted answer.
   * @param {string} typed
   * @param {string[]} acceptedAnswers
   * @returns {{exact: boolean, closeTypo: boolean}}
   */
  function compareAnswer(typed, acceptedAnswers) {
    const simpleTyped = simplifyForComparison(typed);
    const match = { exact: false, closeTypo: false };
    if (!simpleTyped) {
      return match;
    }
    acceptedAnswers.forEach(function compareWith(accepted) {
      const simpleAccepted = simplifyForComparison(accepted);
      if (simpleTyped === simpleAccepted) {
        match.exact = true;
      } else if (
        simpleAccepted.length >= SHORTEST_ANSWER_WITH_TYPO_ALLOWED &&
        editDistance(simpleTyped, simpleAccepted) <= 1
      ) {
        match.closeTypo = true;
      }
    });
    return match;
  }

  /**
   * "Accepted answer: ..." with an optional note after it.
   * @param {object} question
   * @param {string} [note]
   * @returns {HTMLElement}
   */
  function createAcceptedAnswerLine(question, note) {
    return createParagraph("accepted-answer", [
      "Accepted answer: ",
      { bold: question.accept[0] + (note || "") },
    ]);
  }

  /** @returns {HTMLInputElement} the text box to type into */
  function createAnswerInput() {
    const input = createElement("input", "fill-input");
    input.type = "text";
    input.autocomplete = "off";
    input.autocapitalize = "off";
    input.spellcheck = false;
    input.placeholder = "Type the missing word or phrase";
    return input;
  }

  /**
   * Draw this question type and wait for the answer.
   * @param {object} question
   * @param {object} card
   */
  function showFillInTheBlank(question, card) {
    const input = createAnswerInput();
    const actions = createElement("div", "actions");
    let isChecked = false;
    actions.appendChild(createCheckButton("Check", function checkByClick() {
      checkTypedAnswer(false);
    }));
    card.answerArea.appendChild(input);
    card.answerArea.appendChild(actions);
    focusInputSoon(input, card);

    /**
     * Mark the answer and show the result (once only).
     * @param {boolean} timedOut  the timer ran out
     */
    function checkTypedAnswer(timedOut) {
      if (isChecked) {
        return;
      }
      isChecked = true;
      card.stopTimer();
      actions.remove();
      input.disabled = true;

      const match = compareAnswer(input.value, question.accept);
      if (match.exact || match.closeTypo) {
        input.classList.add("is-correct");
        const note = match.exact ? "" : " (small typo accepted)";
        card.showResult("got", {
          extraContent: createAcceptedAnswerLine(question, note),
        });
        return;
      }
      input.classList.add("is-incorrect");
      const typedNothing = !simplifyForComparison(input.value);
      if (timedOut || typedNothing) {
        card.showResult("miss", {
          timedOut,
          extraContent: createAcceptedAnswerLine(question),
        });
        return;
      }
      askReaderHowClose(question, card);
    }

    card.setKeyHint("Keys: Enter to check");
    card.setKeyHandler(function checkWithEnter(event) {
      if (event.key === "Enter") {
        event.preventDefault();
        checkTypedAnswer(false);
      }
    });
    // Enter inside the text box checks too (and must not reach the page).
    input.addEventListener("keydown", function checkFromInput(event) {
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        checkTypedAnswer(false);
      }
    });
    card.setTimeUpHandler(function checkWhatIsTyped() {
      checkTypedAnswer(true);
    });
  }

  /**
   * Put the cursor in the box, unless the confidence row is waiting.
   * @param {HTMLInputElement} input
   * @param {object} card
   */
  function focusInputSoon(input, card) {
    setTimeout(function focusInput() {
      if (!card.isWaitingForConfidence()) {
        input.focus();
      }
    }, FOCUS_DELAY_MS);
  }

  /**
   * The answer did not match: show the accepted answer and let the
   * reader say whether theirs meant the same thing.
   * @param {object} question
   * @param {object} card
   */
  function askReaderHowClose(question, card) {
    const panel = createElement("div", "reveal-in");
    panel.appendChild(createAcceptedAnswerLine(question));
    panel.appendChild(createElement("p", "note",
      "Not an exact match. If your wording means the same thing, say so:"));
    const ratingRow = createElement("div", "self-rating");
    SELF_RATINGS.forEach(function addRatingButton(rating) {
      ratingRow.appendChild(createButton(rating.label, rating.result,
        function rate() {
          panel.remove();
          card.showResult(rating.result, {
            extraContent: createAcceptedAnswerLine(question),
          });
        }));
    });
    panel.appendChild(ratingRow);
    card.answerArea.appendChild(panel);
    card.setKeyHandler(null);
  }

  quiz.questionTypes.register("fill", {
    label: "Fill in the blank",
    show: showFillInTheBlank,
  });
})((window.RecallQuiz = window.RecallQuiz || {}));
