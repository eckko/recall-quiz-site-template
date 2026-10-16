/*
 * early-questions.js
 * Starts downloading the question bank as soon as the page begins to
 * load, so the download runs while the other scripts load instead of
 * after them. A big book (several MB) is the slowest thing to arrive.
 *
 * This file is loaded in <head>. It only starts the request and keeps the
 * promise on window.RecallQuizQuestions.promise; js/main.js uses it. The
 * file is still checked with the server every time (cache "no-cache"),
 * so an updated book always shows up: the browser sends the saved copy's
 * tag and gets back a tiny "not modified" answer when nothing changed.
 *
 * It uses no other file and has no dependencies.
 */
(function startQuestionsDownload() {
  "use strict";

  const QUESTIONS_FILE = "questions.json";

  /**
   * The bank to load: questions.json, or a file in banks/ named in the
   * address (index.html?bank=banks/how-to-read-a-book.json), which lets
   * one site hold several sample banks.
   * @returns {string}
   */
  function questionsFileName() {
    const wanted = new URLSearchParams(window.location.search).get("bank");
    return /^banks\/[\w-]+\.json$/.test(wanted || "") ?
      wanted : QUESTIONS_FILE;
  }

  /**
   * Ask for the question bank.
   * @returns {Promise<object>} the parsed JSON; it rejects when the file
   *   cannot be read (for example when the page is opened from a folder)
   */
  function fetchQuestions() {
    return fetch(questionsFileName(), { cache: "no-cache" })
      .then(function readJson(response) {
        if (!response.ok) {
          throw new Error("HTTP " + response.status);
        }
        return response.json();
      });
  }

  const promise = fetchQuestions();
  // main.js handles a failure; this stops a "not handled" warning in the
  // short time before it has attached its own handler.
  promise.catch(function ignoreHere() {});
  window.RecallQuizQuestions = { promise };
})();
