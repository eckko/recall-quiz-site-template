/*
 * scroll-buttons.js
 * Two round buttons floating at the right edge of every screen: one jumps
 * to the top of the page, one to the bottom. Off unless the book asks for
 * them: questions.json sets "scrollButtons": true (see ai-context/
 * data-formats.md). Long pages (a book with long idea lists or cards with
 * many parts) are the reason.
 */
(function setUpScrollButtons(quiz) {
  "use strict";

  const BOX_CLASS = "scroll-jump";

  /**
   * @param {boolean} down  true for the arrow that points down
   * @returns {string} the SVG for the arrow
   */
  function arrowSvg(down) {
    const path = down ? '<path d="M12 4v13M6 12l6 6 6-6"/><path d="M5 21h14"/>'
      : '<path d="M5 3h14"/><path d="M12 20V7M6 12l6-6 6 6"/>';
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" ' +
      'aria-hidden="true">' + path + "</svg>";
  }

  /**
   * @param {string} label  the accessible name
   * @param {boolean} down  true to go to the bottom
   * @returns {HTMLButtonElement}
   */
  function createButton(label, down) {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("aria-label", label);
    button.title = label;
    button.innerHTML = arrowSvg(down);
    button.addEventListener("click", function jump() {
      const height = Math.max(document.documentElement.scrollHeight,
        document.body.scrollHeight);
      window.scrollTo({ top: down ? height : 0, behavior: "smooth" });
    });
    return button;
  }

  /** Show the buttons if the open book asks for them (once). */
  function showIfWanted() {
    const wanted = Boolean(quiz.book.data && quiz.book.data.scrollButtons);
    const existing = document.querySelector("." + BOX_CLASS);
    if (!wanted || existing) {
      return;
    }
    const box = document.createElement("div");
    box.className = BOX_CLASS;
    box.appendChild(createButton("Go to top of page", false));
    box.appendChild(createButton("Go to bottom of page", true));
    document.body.appendChild(box);
  }

  document.addEventListener("recallquiz:book-opened", showIfWanted);
})(window.RecallQuiz = window.RecallQuiz || {});
