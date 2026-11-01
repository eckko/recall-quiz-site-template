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
   * Encrypted book site (template v3): the page set
   * window.RecallQuizEncrypted = { questions: "quiz/questions.enc" } and
   * unlocked the subject key (js/unlock.js) before starting this file.
   * @returns {Promise<object>} the decrypted, parsed question bank
   */
  function fetchEncryptedQuestions() {
    const unlock = window.SubjectUnlock;
    return unlock.ready().then(function download(unlocked) {
      return fetch(window.RecallQuizEncrypted.questions,
        { cache: "no-cache" }).then(function read(response) {
        if (!response.ok) {
          throw new Error("HTTP " + response.status);
        }
        return response.arrayBuffer();
      }).then(function open(buffer) {
        return unlock.decrypt(buffer, unlocked.key);
      });
    }).then(function parse(bytes) {
      return JSON.parse(new TextDecoder().decode(bytes));
    });
  }

  /**
   * Ask for the question bank.
   * @returns {Promise<object>} the parsed JSON; it rejects when the file
   *   cannot be read (for example when the page is opened from a folder)
   */
  function fetchQuestions() {
    if (window.RecallQuizEncrypted) {
      return fetchEncryptedQuestions();
    }
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
