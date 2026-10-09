/*
 * progress-storage.js
 * Saves the reader's progress in the browser (localStorage), one save per
 * book. If the browser blocks storage, progress is kept in memory for as
 * long as the tab is open and a warning is shown.
 *
 * Saved progress looks like this (version 2):
 *
 *   {
 *     version: 2,
 *     questions: {
 *       "c09-2": {
 *         memoryLevel: 2,        // 0 to 4, see spaced-repetition.js
 *         timesSeen: 3,
 *         timesMissed: 1,
 *         nextReview: 1760000000000,   // time in milliseconds
 *         lastAnswered: 1759900000000,
 *         confidentMisses: 0     // "Certain" but wrong
 *       }
 *     },
 *     daysPracticed: ["2026-10-5"],     // year-month-day, no zero padding
 *     recentResults: [ { finishedAt, percent, marks, questionCount,
 *                        verdict, scopeName, secondsPerQuestion,
 *                        sessionMinutes } ],  // newest first, at most 5
 *     resetAt: 1760000000000   // optional: when Reset was last pressed.
 *                              // Cloud sync uses it so a reset on one
 *                              // device is not undone by another.
 *   }
 *
 * A question's record may also hold pretest fields (see
 * spaced-repetition.js, recordPretest): pretested and pretestResult.
 *
 * Older saves (version 1, with short names like "box" and "due") are
 * upgraded automatically when they are read.
 */
(function setUpProgressStorage(quiz) {
  "use strict";

  const STORAGE_KEY_PREFIX = "recall-quiz:";
  const CURRENT_VERSION = 2;
  const STORAGE_BLOCKED_WARNING =
    "This browser is blocking storage, so progress will be lost when " +
    "you close the tab. Use Download to keep a copy.";

  const progress = {
    /** The reader's saved progress for the current book */
    saved: createEmptyProgress(),
    /** False when the browser refuses to store anything */
    isPersistent: true,
    /** The localStorage key for the current book */
    storageKey: STORAGE_KEY_PREFIX + "book",
    /** Last saved copy, used when the browser blocks storage */
    inMemoryCopy: null,
  };

  /** @returns {object} progress for someone who has not started yet */
  function createEmptyProgress() {
    return {
      version: CURRENT_VERSION,
      questions: {},
      daysPracticed: [],
      recentResults: [],
    };
  }

  /**
   * Load (or start) the progress for one book.
   * @param {string} bookId  the "id" from questions.json
   */
  function openForBook(bookId) {
    progress.storageKey = STORAGE_KEY_PREFIX + bookId;
    progress.saved = upgradeSavedProgress(readFromBrowser());
    saveProgress();
  }

  /**
   * Read this book's progress from the browser.
   * @returns {object|null}  null when there is nothing saved yet
   */
  function readFromBrowser() {
    try {
      const savedText = localStorage.getItem(progress.storageKey);
      if (savedText) {
        return JSON.parse(savedText);
      }
    } catch (storageError) {
      progress.isPersistent = false;
    }
    return progress.inMemoryCopy;
  }

  /**
   * Write the current progress to the browser.
   *
   * Every save also announces itself with a "recallquiz:progress-saved"
   * event on the document. Optional add-ons (such as cloud sync in
   * js/sync/) listen for it; nothing here depends on them.
   */
  function saveProgress() {
    progress.inMemoryCopy = progress.saved;
    try {
      const savedText = JSON.stringify(progress.saved);
      localStorage.setItem(progress.storageKey, savedText);
      progress.isPersistent = true;
    } catch (storageError) {
      progress.isPersistent = false;
    }
    showStorageWarningIfNeeded();
    document.dispatchEvent(new CustomEvent("recallquiz:progress-saved"));
  }

  /** Tell the reader when their progress cannot be kept. */
  function showStorageWarningIfNeeded() {
    const warning = quiz.helpers.findElement("storage-warning");
    warning.textContent = progress.isPersistent ? "" : STORAGE_BLOCKED_WARNING;
  }

  /**
   * Replace all progress, for example from a backup file.
   * @param {object} newProgress  version 1 or 2 progress
   */
  function replaceProgress(newProgress) {
    progress.saved = upgradeSavedProgress(newProgress);
    saveProgress();
  }

  /** Forget everything for this book. */
  function eraseProgress() {
    progress.saved = createEmptyProgress();
    progress.saved.resetAt = Date.now();
    saveProgress();
  }

  /**
   * True if some data looks like progress saved by this quiz.
   * @param {object} candidate
   * @returns {boolean}
   */
  function looksLikeProgress(candidate) {
    if (!candidate) {
      return false;
    }
    const isFromNewerVersion = candidate.version > CURRENT_VERSION;
    const hasQuestions = Boolean(candidate.questions || candidate.items);
    return hasQuestions && !isFromNewerVersion;
  }

  /**
   * Bring progress from any older version up to the current one.
   * @param {object|null} saved
   * @returns {object}
   */
  function upgradeSavedProgress(saved) {
    if (!saved) {
      return createEmptyProgress();
    }
    // Version 1 is the only format with "items"; everything else is
    // treated as version 2, even if its "version" field went missing.
    if (saved.items) {
      return upgradeFromVersionOne(saved);
    }
    return Object.assign(createEmptyProgress(), saved,
      { version: CURRENT_VERSION });
  }

  /**
   * Version 1 used short names. Translate them to the readable ones.
   * @param {object} old  { items, days, history }
   * @returns {object}
   */
  function upgradeFromVersionOne(old) {
    const upgraded = createEmptyProgress();
    const oldItems = old.items || {};
    Object.keys(oldItems).forEach(function upgradeQuestion(questionId) {
      const item = oldItems[questionId];
      upgraded.questions[questionId] = {
        memoryLevel: item.box || 0,
        timesSeen: item.seen || 0,
        timesMissed: item.missed || 0,
        nextReview: item.due || 0,
        lastAnswered: item.last || 0,
        confidentMisses: item.cm || 0,
      };
    });
    upgraded.daysPracticed = (old.days || []).slice();
    upgraded.recentResults = (old.history || []).map(
      function upgradeResult(result) {
        return {
          finishedAt: result.t,
          percent: result.pct,
          marks: result.marks,
          questionCount: result.total,
          verdict: result.v,
          scopeName: result.scope,
          secondsPerQuestion: result.limit || 0,
          sessionMinutes: result.mins || 0,
        };
      }
    );
    return upgraded;
  }

  /**
   * Another tab of this site saved this book's progress (or cleared it).
   * Take its copy as it is, so two open tabs never overwrite each other's
   * answers. Every tab saves after every answer, so the stored copy is
   * always the newest.
   * @param {StorageEvent} event
   */
  function adoptCopyFromOtherTab(event) {
    if (event.key !== progress.storageKey) {
      return;
    }
    let stored = null;
    try {
      stored = event.newValue ? JSON.parse(event.newValue) : null;
    } catch (badJson) {
      return;
    }
    progress.saved = upgradeSavedProgress(stored);
    progress.inMemoryCopy = progress.saved;
    if (quiz.book.data) {
      quiz.homeScreen.refresh();
    }
  }

  window.addEventListener("storage", adoptCopyFromOtherTab);

  quiz.progress = Object.assign(progress, {
    openForBook,
    saveProgress,
    replaceProgress,
    eraseProgress,
    looksLikeProgress,
    upgradeSavedProgress,
    createEmptyProgress,
  });
})((window.RecallQuiz = window.RecallQuiz || {}));
