/*
 * flags.js
 * Flags on questions, so the reader can mark a question while practising
 * and deal with it later.
 *
 *   Bad        the question should be deleted. Left out of every session
 *              at once (undo from Settings).
 *   Revisit    something is wrong and it should be fixed. Stays in.
 *   Useless    not worth asking. Left out at once (undo from Settings).
 *   Important  worth revising again and again: comes back in Keep me
 *              going and has its own "Important only" practice choice.
 *
 * This file draws the collapsed flag bar on a question and, on the
 * Settings screen, the list of flagged questions with an export. The
 * flags themselves are kept per book by js/book-settings.js.
 */
(function setUpFlags(quiz) {
  "use strict";

  const { findElement, createElement, createButton } = quiz.helpers;

  /** Name, button label and what it means, in the order shown */
  const FLAG_DETAILS = {
    bad: { label: "Bad", meaning: "Delete this question" },
    revisit: { label: "Revisit", meaning: "Fix this question later" },
    useless: { label: "Useless", meaning: "Hide this question" },
    important: { label: "Important", meaning: "Show it again and again" },
  };
  const HIDDEN_NOTE = "This question is left out from now on. You can " +
    "undo it in Settings.";
  const REVIEW_TEXT_LENGTH = 110;
  const EXPORT_FILE_VERSION = 1;

  // ------------------------------------------------------------- flag bar

  /**
   * The collapsed "Flag this question" bar for a question, or null when
   * the reader hid the bar in Settings.
   * @param {object} question
   * @returns {HTMLElement|null}
   */
  function createFlagBar(question) {
    if (!quiz.layout.isShown("flagBar") || !question.id) {
      return null;
    }
    const bar = createElement("details", "flag-bar");
    bar.appendChild(createElement("summary", null, "Flag this question"));
    const buttons = createElement("div", "flag-buttons");
    const note = createElement("p", "flag-note");
    quiz.bookSettings.FLAG_NAMES.forEach(function addButton(flagName) {
      buttons.appendChild(
        createFlagButton(question, flagName, note, buttons));
    });
    bar.appendChild(buttons);
    bar.appendChild(note);
    showNote(note, question.id);
    return bar;
  }

  /**
   * One toggle button in the bar.
   * @param {object} question
   * @param {string} flagName
   * @param {HTMLElement} note  the line under the buttons
   * @param {HTMLElement} buttons  the row, to refresh all buttons
   * @returns {HTMLButtonElement}
   */
  function createFlagButton(question, flagName, note, buttons) {
    const details = FLAG_DETAILS[flagName];
    const button = createButton(details.label, "pill-button flag-button",
      function toggle() {
        quiz.bookSettings.toggleFlag(question.id, flagName);
        markButtons(buttons, question.id);
        showNote(note, question.id);
      });
    button.dataset.flag = flagName;
    button.title = details.meaning;
    button.setAttribute("aria-pressed",
      String(quiz.bookSettings.hasFlag(question.id, flagName)));
    return button;
  }

  /** Press the buttons of the flags a question has. */
  function markButtons(buttons, questionId) {
    buttons.querySelectorAll(".flag-button").forEach(
      function mark(button) {
        button.setAttribute("aria-pressed", String(
          quiz.bookSettings.hasFlag(questionId, button.dataset.flag)));
      });
  }

  /** Tell the reader when a flag removes the question. */
  function showNote(note, questionId) {
    const isHidden = quiz.bookSettings.HIDING_FLAGS.some(
      function has(flagName) {
        return quiz.bookSettings.hasFlag(questionId, flagName);
      });
    note.textContent = isHidden ? HIDDEN_NOTE : "";
  }

  // ---------------------------------------------------------- review list

  /** @returns {Object<string, object>} every question of the book by id */
  function questionsById() {
    const byId = {};
    quiz.book.data.questions.forEach(function add(question) {
      byId[question.id] = question;
    });
    return byId;
  }

  /**
   * @param {string} text
   * @returns {string} the text cut to a short length
   */
  function shorten(text) {
    const plain = String(text || "").replace(/\s+/g, " ").trim();
    return plain.length > REVIEW_TEXT_LENGTH ?
      plain.slice(0, REVIEW_TEXT_LENGTH).trim() + "…" : plain;
  }

  /** Draw the flagged questions on the Settings screen. */
  function showReviewList() {
    const list = findElement("flag-review-list");
    if (!list || !quiz.book.data) {
      return;
    }
    const flagged = quiz.bookSettings.listFlagged();
    const byId = questionsById();
    list.textContent = "";
    findElement("flag-export-button").disabled = flagged.length === 0;
    if (flagged.length === 0) {
      list.appendChild(createElement("p", "note",
        "Nothing is flagged in this book yet."));
      return;
    }
    flagged.forEach(function addRow(entry) {
      list.appendChild(createReviewRow(entry, byId[entry.id]));
    });
  }

  /**
   * One flagged question in the list.
   * @param {{id: string, flags: string[]}} entry
   * @param {object|undefined} question  from the bank (missing if the
   *   bank no longer has it)
   * @returns {HTMLElement}
   */
  function createReviewRow(entry, question) {
    const row = createElement("div", "flag-review-row");
    const chips = createElement("div", "flag-chips");
    entry.flags.forEach(function addChip(flagName) {
      chips.appendChild(createElement("span", "flag-chip",
        FLAG_DETAILS[flagName].label));
    });
    row.appendChild(chips);
    row.appendChild(createElement("p", "flag-review-text", question ?
      shorten(question.q || question.title || entry.id) :
      entry.id + " (no longer in the book)"));
    if (question) {
      row.appendChild(createElement("p", "note",
        quiz.book.unitShortName(question) +
        (question.section ? " · " + question.section : "")));
    }
    row.appendChild(createButton("Clear flags", "link-button",
      function clear() {
        quiz.bookSettings.clearFlags(entry.id);
      }));
    return row;
  }

  /**
   * @returns {object} the flagged questions as a file for fixing the
   *   bank: ids, flags, and enough of each question to find it
   */
  function createExport() {
    const byId = questionsById();
    const flagged = quiz.bookSettings.listFlagged();
    const counts = {};
    quiz.bookSettings.FLAG_NAMES.forEach(function start(flagName) {
      counts[flagName] = 0;
    });
    const questions = flagged.map(function describe(entry) {
      entry.flags.forEach(function count(flagName) {
        counts[flagName] += 1;
      });
      const question = byId[entry.id] || {};
      return {
        id: entry.id,
        flags: entry.flags,
        flaggedAt: new Date(entry.at).toISOString(),
        unit: question.unit || "",
        section: question.section || "",
        concept: question.concept || "",
        kind: question.kind || "",
        q: question.q || "",
      };
    });
    return {
      version: EXPORT_FILE_VERSION,
      bookId: quiz.book.bookId(),
      book: quiz.book.data.book,
      exportedAt: new Date().toISOString(),
      counts,
      questions,
    };
  }

  /** Download the flagged questions as a JSON file. */
  function downloadExport() {
    const text = JSON.stringify(createExport(), null, 2);
    const link = document.createElement("a");
    link.href = URL.createObjectURL(
      new Blob([text], { type: "application/json" }));
    link.download = "flagged-questions-" + quiz.book.bookId() + ".json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function release() {
      URL.revokeObjectURL(link.href);
    }, 0);
  }

  /** Connect the Settings screen's list and export button. */
  function setUpReviewList() {
    const exportButton = findElement("flag-export-button");
    if (exportButton) {
      exportButton.addEventListener("click", downloadExport);
    }
    ["recallquiz:flags-changed", "recallquiz:book-opened",
      "recallquiz:book-settings-applied"].forEach(function listen(name) {
      document.addEventListener(name, showReviewList);
    });
  }

  quiz.flags = { createFlagBar, createExport };
  setUpReviewList();
})((window.RecallQuiz = window.RecallQuiz || {}));
