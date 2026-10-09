/*
 * lesson.js
 * "lesson": not a question but a step in a Learn session that shows a
 * concept card. The reader reads it and goes on. Nothing is scored or
 * saved. Learn sessions create these steps themselves (see
 * learning.js, createLessonStep); questions.json never contains one.
 *
 * Keys: Enter or Space to continue.
 */
(function setUpLesson(quiz) {
  "use strict";

  const { createElement, createButton } = quiz.helpers;

  /**
   * Draw the card and a button to carry on.
   * @param {object} question  the lesson step (concept id in .concept)
   * @param {object} card      see createQuestionCard in js/session.js
   */
  function showLesson(question, card) {
    const concept = quiz.learning.conceptById(question.concept);
    card.answerArea.appendChild(quiz.learning.createCardContent(concept));
    const actions = createElement("div", "actions");
    actions.appendChild(createButton("Got it, show me the questions",
      "button primary", card.continueToNext));
    card.answerArea.appendChild(actions);
    card.setKeyHint("Keys: Enter to continue");
    card.setKeyHandler(function continueWithKey(event) {
      if (event.key === "Enter" || event.key === " ") {
        card.continueToNext();
      }
    });
  }

  quiz.questionTypes.register("lesson", {
    label: "The idea",
    show: showLesson,
  });
})((window.RecallQuiz = window.RecallQuiz || {}));
