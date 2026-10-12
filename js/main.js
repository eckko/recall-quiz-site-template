/*
 * main.js
 * Starts the quiz: reads questions.json (downloaded early, see
 * js/early-questions.js), opens the reader's saved
 * progress and settings for that book, and shows the home screen.
 *
 * Browsers will not read questions.json when the page is opened straight
 * from a folder (file://). In that case a panel asks the reader to pick
 * the file by hand.
 */
(function startQuiz(quiz) {
  "use strict";

  const { findElement } = quiz.helpers;

  /**
   * Use a book's data and show the home screen.
   * @param {object} bookData  the parsed questions.json
   */
  function openBook(bookData) {
    quiz.math.enableIfNeeded(bookData);
    quiz.book.setBookData(bookData);
    quiz.progress.openForBook(quiz.book.bookId());
    quiz.bookSettings.openForBook(quiz.book.bookId());
    if (window.RecallQuizTheme) {
      window.RecallQuizTheme.useBook(quiz.book.bookId());
    }
    quiz.homeScreen.showBookDetails();
    findElement("load-error").classList.add("hidden");
    findElement("loading-note").classList.add("hidden");
    findElement("home-screen").classList.remove("hidden");
    findElement("where-you-stand").classList.remove("hidden");
    quiz.homeScreen.refresh();
    // Optional add-ons (such as cloud sync) start from this event.
    document.dispatchEvent(new CustomEvent("recallquiz:book-opened",
      { detail: { bookId: quiz.book.bookId() } }));
  }

  /** Hide the home screen and offer to pick questions.json by hand. */
  function showLoadError() {
    findElement("loading-note").classList.add("hidden");
    findElement("home-screen").classList.add("hidden");
    findElement("where-you-stand").classList.add("hidden");
    findElement("load-error").classList.remove("hidden");
  }

  /**
   * Use the question bank that js/early-questions.js started downloading
   * when the page began to load.
   */
  function loadQuestionsFile() {
    window.RecallQuizQuestions.promise
      .then(openBook)
      .catch(showLoadError);
  }

  /**
   * The reader picked questions.json by hand.
   * @param {Event} event
   */
  function openPickedQuestionsFile(event) {
    const file = event.target.files[0];
    if (!file) {
      return;
    }
    const reader = new FileReader();
    reader.onload = function useFile() {
      try {
        openBook(JSON.parse(reader.result));
      } catch (problem) {
        alert("That file is not a valid questions.json.");
      }
    };
    reader.readAsText(file);
  }

  findElement("questions-file-input")
    .addEventListener("change", openPickedQuestionsFile);
  loadQuestionsFile();
})((window.RecallQuiz = window.RecallQuiz || {}));
