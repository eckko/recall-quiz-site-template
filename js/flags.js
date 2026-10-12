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
 * This file draws the collapsed flag bar on a question (or an idea) and,
 * on the Settings screen, the lists of flagged questions and ideas with
 * an export for each. The
 * flags themselves are kept per book by js/book-settings.js.
 *
 * Ideas can be flagged the same way, with the same four flags. Idea flags
 * and question flags are kept apart and never affect each other: a Bad or
 * Useless idea disappears from the idea lists (undo in Settings) but its
 * questions stay, and an Important idea is offered earlier in Keep me
 * going, while "Important only" practice looks at question flags only.
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
  /** What differs between flagging a question and flagging an idea */
  const KINDS = {
    question: {
      word: "question",
      barId: "flagBar",
      hiddenNote: "This question is left out from now on. You can " +
        "undo it in Settings.",
      listId: "flag-review-list",
      exportId: "flag-export-button",
      emptyNote: "Nothing is flagged in this book yet.",
      fileStart: "flagged-questions-",
      changed: "recallquiz:flags-changed",
    },
    idea: {
      word: "idea",
      barId: "ideaFlagBar",
      hiddenNote: "This idea is left out of the lists from now on. Its " +
        "questions stay. You can undo it in Settings.",
      listId: "idea-flag-review-list",
      exportId: "idea-flag-export-button",
      emptyNote: "No idea is flagged in this book yet.",
      fileStart: "flagged-ideas-",
      changed: "recallquiz:idea-flags-changed",
    },
  };
  const REVIEW_TEXT_LENGTH = 110;
  const EXPORT_FILE_VERSION = 1;

  // ------------------------------------------------------------- flag bar

  /**
   * The settings calls for one kind of thing.
   * @param {"question"|"idea"} kind
   * @returns {{flagsOf: Function, has: Function, toggle: Function,
   *   clear: Function, list: Function}}
   */
  function storeFor(kind) {
    const settings = quiz.bookSettings;
    return kind === "question" ? {
      has: settings.hasFlag, toggle: settings.toggleFlag,
      clear: settings.clearFlags, list: settings.listFlagged,
    } : {
      has: settings.hasIdeaFlag, toggle: settings.toggleIdeaFlag,
      clear: settings.clearIdeaFlags, list: settings.listFlaggedIdeas,
    };
  }

  /**
   * The collapsed "Flag this question" bar for a question, or null when
   * the reader hid the bar in Settings.
   * @param {object} question
   * @returns {HTMLElement|null}
   */
  function createFlagBar(question) {
    return createBar("question", question.id);
  }

  /**
   * The collapsed "Flag this idea" bar for an idea, or null when the
   * reader hid the bar in Settings.
   * @param {object} concept
   * @returns {HTMLElement|null}
   */
  function createIdeaFlagBar(concept) {
    return createBar("idea", concept.id);
  }

  /**
   * @param {"question"|"idea"} kind
   * @param {string} id
   * @returns {HTMLElement|null}
   */
  function createBar(kind, id) {
    const details = KINDS[kind];
    if (!quiz.layout.isShown(details.barId) || !id) {
      return null;
    }
    const bar = createElement("details", "flag-bar");
    bar.dataset.flagKind = kind;
    bar.appendChild(createElement("summary", null,
      "Flag this " + details.word));
    const buttons = createElement("div", "flag-buttons");
    const note = createElement("p", "flag-note");
    quiz.bookSettings.FLAG_NAMES.forEach(function addButton(flagName) {
      buttons.appendChild(
        createFlagButton(kind, id, flagName, note, buttons));
    });
    bar.appendChild(buttons);
    bar.appendChild(note);
    showNote(kind, note, id);
    return bar;
  }

  /**
   * One toggle button in the bar.
   * @param {"question"|"idea"} kind
   * @param {string} id
   * @param {string} flagName
   * @param {HTMLElement} note  the line under the buttons
   * @param {HTMLElement} buttons  the row, to refresh all buttons
   * @returns {HTMLButtonElement}
   */
  function createFlagButton(kind, id, flagName, note, buttons) {
    const details = FLAG_DETAILS[flagName];
    const calls = storeFor(kind);
    const button = createButton(details.label, "pill-button flag-button",
      function toggle() {
        calls.toggle(id, flagName);
        markButtons(kind, buttons, id);
        showNote(kind, note, id);
      });
    button.dataset.flag = flagName;
    button.title = details.meaning.replace("this question",
      "this " + KINDS[kind].word);
    button.setAttribute("aria-pressed", String(calls.has(id, flagName)));
    return button;
  }

  /** Press the buttons of the flags a question or idea has. */
  function markButtons(kind, buttons, id) {
    const calls = storeFor(kind);
    buttons.querySelectorAll(".flag-button").forEach(
      function mark(button) {
        button.setAttribute("aria-pressed",
          String(calls.has(id, button.dataset.flag)));
      });
  }

  /** Tell the reader when a flag removes the question or idea. */
  function showNote(kind, note, id) {
    const calls = storeFor(kind);
    const isHidden = quiz.bookSettings.HIDING_FLAGS.some(
      function has(flagName) {
        return calls.has(id, flagName);
      });
    note.textContent = isHidden ? KINDS[kind].hiddenNote : "";
  }

  // ---------------------------------------------------------- review list

  /**
   * @param {"question"|"idea"} kind
   * @returns {Object<string, object>} everything of that kind in the
   *   book, by id (ideas the reader hid are included, so they can be
   *   listed and undone)
   */
  function itemsById(kind) {
    const items = kind === "question" ? quiz.book.data.questions :
      (quiz.book.data.concepts || []);
    const byId = {};
    items.forEach(function add(item) {
      byId[item.id] = item;
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

  /**
   * Draw the flagged questions or ideas on the Settings screen.
   * @param {"question"|"idea"} kind
   */
  function showReviewList(kind) {
    const details = KINDS[kind];
    const list = findElement(details.listId);
    if (!list || !quiz.book.data) {
      return;
    }
    const flagged = storeFor(kind).list();
    const byId = itemsById(kind);
    list.textContent = "";
    findElement(details.exportId).disabled = flagged.length === 0;
    if (flagged.length === 0) {
      list.appendChild(createElement("p", "note", details.emptyNote));
      showCount(kind, 0);
      return;
    }
    showCount(kind, flagged.length);
    flagged.forEach(function addRow(entry) {
      list.appendChild(createReviewRow(kind, entry, byId[entry.id]));
    });
  }

  /**
   * Show how many are flagged on the folded Settings section.
   * @param {"question"|"idea"} kind
   * @param {number} count
   */
  function showCount(kind, count) {
    const current = findElement(
      kind === "question" ? "flags-section-current" :
        "idea-flags-section-current");
    if (current) {
      current.textContent = count ? count + " flagged" : "None flagged";
    }
  }

  /**
   * One flagged question or idea in the list.
   * @param {"question"|"idea"} kind
   * @param {{id: string, flags: string[]}} entry
   * @param {object|undefined} item  from the book (missing if the book
   *   no longer has it)
   * @returns {HTMLElement}
   */
  function createReviewRow(kind, entry, item) {
    const row = createElement("div", "flag-review-row");
    const chips = createElement("div", "flag-chips");
    entry.flags.forEach(function addChip(flagName) {
      chips.appendChild(createElement("span", "flag-chip",
        FLAG_DETAILS[flagName].label));
    });
    row.appendChild(chips);
    row.appendChild(createElement("p", "flag-review-text", item ?
      shorten(item.q || item.title || entry.id) :
      entry.id + " (no longer in the book)"));
    if (item) {
      row.appendChild(createElement("p", "note",
        quiz.book.unitShortName(item) +
        (item.section ? " · " + item.section : "")));
    }
    row.appendChild(createButton("Clear flags", "link-button",
      function clear() {
        storeFor(kind).clear(entry.id);
      }));
    return row;
  }

  /**
   * @param {"question"|"idea"} kind
   * @returns {object} the flagged questions (or ideas) as a file for
   *   fixing the book: ids, flags, and enough of each to find it
   */
  function createExportFor(kind) {
    const byId = itemsById(kind);
    const flagged = storeFor(kind).list();
    const counts = {};
    quiz.bookSettings.FLAG_NAMES.forEach(function start(flagName) {
      counts[flagName] = 0;
    });
    const items = flagged.map(function describe(entry) {
      entry.flags.forEach(function count(flagName) {
        counts[flagName] += 1;
      });
      const item = byId[entry.id] || {};
      const base = {
        id: entry.id,
        flags: entry.flags,
        flaggedAt: new Date(entry.at).toISOString(),
        unit: item.unit || "",
        section: item.section || "",
      };
      return kind === "question" ? Object.assign(base, {
        concept: item.concept || "",
        kind: item.kind || "",
        q: item.q || "",
      }) : Object.assign(base, {
        title: item.title || "",
        question: item.question || "",
      });
    });
    return {
      version: EXPORT_FILE_VERSION,
      bookId: quiz.book.bookId(),
      book: quiz.book.data.book,
      exportedAt: new Date().toISOString(),
      counts,
      [kind === "question" ? "questions" : "ideas"]: items,
    };
  }

  /** @returns {object} the flagged questions as a file */
  function createExport() {
    return createExportFor("question");
  }

  /** @returns {object} the flagged ideas as a file */
  function createIdeaExport() {
    return createExportFor("idea");
  }

  /**
   * Download the flagged questions or ideas as a JSON file.
   * @param {"question"|"idea"} kind
   */
  function downloadExport(kind) {
    const text = JSON.stringify(createExportFor(kind), null, 2);
    const link = document.createElement("a");
    link.href = URL.createObjectURL(
      new Blob([text], { type: "application/json" }));
    link.download = KINDS[kind].fileStart + quiz.book.bookId() + ".json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function release() {
      URL.revokeObjectURL(link.href);
    }, 0);
  }

  /** Connect the Settings screen's lists and export buttons. */
  function setUpReviewList() {
    Object.keys(KINDS).forEach(function connect(kind) {
      const exportButton = findElement(KINDS[kind].exportId);
      if (exportButton) {
        exportButton.addEventListener("click", function download() {
          downloadExport(kind);
        });
      }
      [KINDS[kind].changed, "recallquiz:book-opened",
        "recallquiz:book-settings-applied"].forEach(function listen(name) {
        document.addEventListener(name, function redraw() {
          showReviewList(kind);
        });
      });
    });
  }

  quiz.flags = {
    createFlagBar, createIdeaFlagBar, createExport, createIdeaExport,
  };
  setUpReviewList();
})((window.RecallQuiz = window.RecallQuiz || {}));
