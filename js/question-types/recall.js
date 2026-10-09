/*
 * recall.js
 * "recall": answer from memory, then reveal the model answer and say
 * how close you were.
 *
 * questions.json: "a": "the model answer"
 *
 * This is the purest retrieval practice: nothing to recognise, so the
 * reader has to bring the answer back themselves.
 * Keys: Space shows the answer, then 1, 2 or 3 rates it.
 */
(function setUpRecall(quiz) {
  "use strict";

  const { createElement, createButton } = quiz.helpers;

  const SELF_RATINGS = [
    { result: "miss", label: "Missed it", when: "Back soon", key: "1" },
    { result: "part", label: "Partly", when: "In a day or so", key: "2" },
    { result: "got", label: "Got it", when: "Later", key: "3" },
  ];

  /**
   * Draw this question type and wait for the answer.
   * @param {object} question
   * @param {object} card
   */
  function showRecall(question, card) {
    card.answerArea.appendChild(createElement("p", "recall-cue",
      "Say or think your answer first. Then check how close you were."));
    const showAnswerButton = createButton("Show the answer",
      "button primary", function showByClick() {
        revealAnswer(question, card, false);
      });
    const actions = createElement("div", "actions");
    actions.appendChild(showAnswerButton);
    card.answerArea.appendChild(actions);
    showAnswerButton.focus();

    card.setKeyHint("Keys: Space to show the answer");
    card.setKeyHandler(function showWithSpace(event) {
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        revealAnswer(question, card, false);
      }
    });
    card.setTimeUpHandler(function showWhenTimeIsUp() {
      revealAnswer(question, card, true);
    });
  }

  /**
   * Show the model answer and the three self-rating buttons.
   * @param {object} question
   * @param {object} card
   * @param {boolean} timedOut
   */
  function revealAnswer(question, card, timedOut) {
    card.stopTimer();
    card.answerArea.textContent = "";
    const panel = createElement("div", "reveal-in");
    panel.appendChild(createElement("div", "explanation", question.a));
    panel.appendChild(quiz.answerFeedback.createRereadHint(question));
    panel.appendChild(createElement("p", "note",
      (timedOut ? "Time's up. " : "") + "How close was your answer?"));
    panel.appendChild(createSelfRatingButtons(card));
    card.answerArea.appendChild(panel);

    card.setKeyHint("Keys: 1 missed, 2 partly, 3 got it");
    card.setKeyHandler(function rateWithNumberKey(event) {
      const rating = SELF_RATINGS.find(function matchesKey(choice) {
        return choice.key === event.key;
      });
      if (rating) {
        card.saveSelfRating(rating.result);
      }
    });
  }

  /**
   * "Missed it / Partly / Got it", each saying when it will come back.
   * @param {object} card
   * @returns {HTMLElement}
   */
  function createSelfRatingButtons(card) {
    const row = createElement("div", "self-rating");
    SELF_RATINGS.forEach(function addRatingButton(rating) {
      const button = createButton(rating.label, rating.result,
        function rate() {
          if (rating.result === "got") {
            quiz.celebrate(button);
          }
          card.saveSelfRating(rating.result);
        });
      button.appendChild(createElement("small", null, rating.when));
      row.appendChild(button);
    });
    return row;
  }

  quiz.questionTypes.register("recall", {
    label: "Recall it from memory",
    show: showRecall,
  });
})((window.RecallQuiz = window.RecallQuiz || {}));
