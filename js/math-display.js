/*
 * math-display.js
 * Shows formulas written as \( ... \) (inline) or \[ ... \] and
 * $$ ... $$ (own line) in any question text, using KaTeX.
 *
 * Single dollar signs are NOT formulas, so prices like "$5" stay text.
 * KaTeX (vendor/katex/) is loaded only when the book contains a
 * formula, so books without maths download nothing extra.
 * In questions.json, write the backslash twice: "\\(x^2\\)".
 */
(function setUpMathDisplay(quiz) {
  "use strict";

  const KATEX_FOLDER = "vendor/katex/";
  const DELIMITERS = [
    { left: "$$", right: "$$", display: true },
    { left: "\\[", right: "\\]", display: true },
    { left: "\\(", right: "\\)", display: false },
  ];
  const FORMULA_MARKS = ["\\(", "\\[", "$$"];
  let isReady = false;
  let isWatching = false;

  /**
   * @param {object} bookData  the parsed questions.json
   * @returns {boolean} true if any question text holds a formula
   */
  function bookHasFormulas(bookData) {
    return JSON.stringify(bookData.questions || []).includes("\\\\(") ||
      JSON.stringify(bookData.questions || []).includes("\\\\[") ||
      JSON.stringify(bookData.questions || []).includes("$$");
  }

  /**
   * Add a script or stylesheet to the page.
   * @param {string} tagName  "script" or "link"
   * @param {string} file  file name inside the KaTeX folder
   * @returns {Promise<void>}
   */
  function loadFile(tagName, file) {
    return new Promise(function load(resolve, reject) {
      const element = document.createElement(tagName);
      if (tagName === "script") {
        element.src = KATEX_FOLDER + file;
      } else {
        element.rel = "stylesheet";
        element.href = KATEX_FOLDER + file;
      }
      element.onload = resolve;
      element.onerror = reject;
      document.head.appendChild(element);
    });
  }

  /** Turn every formula currently on the page into typeset maths. */
  function renderPage() {
    if (!isReady) {
      return;
    }
    window.renderMathInElement(document.body, {
      delimiters: DELIMITERS,
      ignoredClasses: ["katex", "fill-input"],
      throwOnError: false,
      trust: false,
    });
  }

  /** Re-typeset when the page changes (new question, feedback ...). */
  function watchForChanges() {
    if (isWatching) {
      return;
    }
    isWatching = true;
    let waiting = false;
    new MutationObserver(function pageChanged() {
      if (waiting) {
        return;
      }
      waiting = true;
      requestAnimationFrame(function typeset() {
        waiting = false;
        renderPage();
      });
    }).observe(document.body, { childList: true, subtree: true });
  }

  /**
   * Load KaTeX if this book needs it, then start showing formulas.
   * @param {object} bookData  the parsed questions.json
   */
  function enableIfNeeded(bookData) {
    if (isReady || !bookHasFormulas(bookData)) {
      return;
    }
    Promise.all([
      loadFile("link", "katex.min.css"),
      loadFile("script", "katex.min.js"),
    ])
      .then(function loadAutoRender() {
        return loadFile("script", "auto-render.min.js");
      })
      .then(function start() {
        isReady = true;
        watchForChanges();
        renderPage();
      })
      .catch(function ignoreMissingLibrary() {
        // Formulas then stay as plain text; the quiz still works.
      });
  }

  quiz.math = { enableIfNeeded, FORMULA_MARKS };
})((window.RecallQuiz = window.RecallQuiz || {}));
