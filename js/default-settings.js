/*
 * default-settings.js
 * Every setting a reader starts with, in one place. Change a value here
 * and every book that has no saved settings of its own starts that way.
 *
 * A reader can override any of these on the Settings screen. Their choice
 * is saved per reader and per book (js/book-settings.js) and always wins
 * over this file. A book that already has saved settings keeps them.
 *
 * Hiding a control never changes its default: a hidden control still
 * applies the default value written here.
 *
 * This file is loaded in <head>, before js/theme-picker.js, so the theme
 * default is known before the page is drawn. It is plain data on
 * window.RecallQuizDefaults (frozen); it has no functions and no
 * dependencies.
 */
(function setUpDefaultSettings() {
  "use strict";

  /**
   * Freeze an object and everything inside it.
   * @param {object} value
   * @returns {object} the same object, now read-only
   */
  function freezeDeeply(value) {
    Object.keys(value).forEach(function freeze(key) {
      if (value[key] && typeof value[key] === "object") {
        freezeDeeply(value[key]);
      }
    });
    return Object.freeze(value);
  }

  window.RecallQuizDefaults = freezeDeeply({

    /** The look: a theme id (a folder in themes/) and light, dark or
        system (follow the device) */
    theme: {
      id: "sky",
      mode: "system",
    },

    /** Which parts of the home screen are shown. true = shown. */
    show: {
      /** The whole "What do you want to do?" panel */
      setup: true,
      /** The Keep me going button, "Up next" line and "Or open any idea"
          hint */
      keepGoing: false,
      timer: false,
      confidence: false,
      htrab: false,
      /** The 5-minute session button */
      quick: false,
      /** The whole Custom practice section */
      custom: true,
      /** The whole "Which questions" row inside Custom practice */
      filter: true,
      /** Each option of "Which questions" */
      filterDue: false,
      filterGaps: false,
      filterImportant: true,
      filterAll: true,
      /** Session length inside Custom practice */
      length: true,
      /** The flag bar on questions and on ideas */
      flagBar: true,
      ideaFlagBar: true,
    },

    /** What a practice session starts with */
    practice: {
      /** Seconds per question; 0 is off. One of 0, 15, 30, 60. */
      timer: 0,
      confidence: false,
      htrab: false,
      /** The lesson: the whole book, or { unit, section, concept } */
      scope: { unit: "all" },
      /** Custom practice, "Which questions": all (Everything), due
          (Due and new), gaps (My gaps) or important (Important only) */
      filter: "all",
      /** Custom practice, "Session length": questions or time */
      lengthMode: "questions",
      /** Number of questions; 0 means all */
      count: 10,
      minutes: 15,
    },

    /** How the home screen looks when it opens. open or closed (the
        chapters can also be "next": only the next one is open). */
    homeLayout: {
      progress: "closed",
      recent: "closed",
      setup: "open",
      /** "Where you stand" (also "Your ideas") */
      stand: "closed",
      chapters: "closed",
      /** Topics and ideas inside a chapter */
      inner: "closed",
      /** Custom practice: auto (open only for books without ideas), open
          or closed */
      customStart: "open",
    },

    /** Whether each Settings section is open when the Settings screen is
        shown. Every visit starts from this; a reader's own opening and
        folding is not remembered. The keys are the section ids in
        index.html. */
    settingsSectionsOpen: {
      "account-section": false,
      "appearance-section": false,
      "visibility-section": false,
      "practice-section": false,
      "custom-practice-section": false,
      "flags-section": false,
      "idea-flags-section": false,
      "home-section": false,
      "progress-file-panel": false,
    },
  });
}());
