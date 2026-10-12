/*
 * book-settings.js
 * Everything the reader sets for ONE book: the home-screen layout and
 * practice defaults (kept as an opaque "layout" object that
 * js/home-layout.js owns) and the flags on questions and on ideas (Bad,
 * Revisit, Useless, Important). Each book has its own saved record, so
 * every book can have its own view. Sign-in is not part of it: that is
 * global.
 *
 * Saved record (version 2), localStorage key "recall-quiz-book:<bookId>":
 *
 *   {
 *     version: 2,
 *     layout: { at: 1760000000000, ... },     // see home-layout.js
 *     flags: { "c09-2": { f: ["bad"], a: 1760000000000 } },
 *     ideaFlags: { "i-12": { f: ["important"], a: 1760000000000 } }
 *   }
 *
 * "f" lists the flags on a question (or idea) and "a" is when they last
 * changed (an empty list is kept as a marker, so clearing a flag on one
 * device is not undone by another). Questions flagged Bad or Useless are
 * left out of the book (quiz.book.setHiddenIds). Ideas flagged Bad or
 * Useless are left out of the idea lists only; their questions stay.
 * Question flags and idea flags never affect each other.
 *
 * History: version 1 had no "ideaFlags"; the step in MIGRATIONS adds it.
 *
 * Versions: every saved record, and the copy in the reader's account,
 * carries a version number. When the format changes, bump
 * CURRENT_VERSION and add a step to MIGRATIONS that turns version N into
 * N + 1. Old data is upgraded automatically when it is read. Data from a
 * NEWER version than this code knows is never overwritten.
 *
 * Events sent: "recallquiz:flags-changed" (the reader flagged a
 * question), "recallquiz:idea-flags-changed" (the reader flagged an idea)
 * and "recallquiz:book-settings-applied" (settings arrived from the
 * account; redraw). Cloud sync listens to all three.
 */
(function setUpBookSettings(quiz) {
  "use strict";

  const STORAGE_KEY_PREFIX = "recall-quiz-book:";
  const CURRENT_VERSION = 2;
  /** Flags a reader can put on a question or idea, in the order shown */
  const FLAG_NAMES = ["bad", "revisit", "useless", "important"];
  /** Flags that remove a question (or idea) from the book */
  const HIDING_FLAGS = ["bad", "useless"];
  /** Version N to N + 1 steps for the saved record: MIGRATIONS[N] */
  const MIGRATIONS = {
    /** 1 to 2: ideas can be flagged too */
    1: function addIdeaFlags(data) {
      return Object.assign({}, data, { ideaFlags: {} });
    },
  };
  /** The two kinds of thing a reader can flag: the record's field name */
  const FLAG_FIELDS = { question: "flags", idea: "ideaFlags" };

  const store = {
    bookId: "",
    record: createEmptyRecord(),
    /** True when the saved data comes from a newer version of this code */
    isReadOnly: false,
  };

  // ------------------------------------------------------------ versions

  /**
   * Bring data of any older version up to the current one, one step at
   * a time.
   * @param {object} data  a record or account copy
   * @param {number} version  the version the data says it has
   * @param {object} migrations  step functions keyed by the version they
   *   start from
   * @param {number} currentVersion  the version to reach
   * @returns {object} the upgraded data
   */
  function runMigrations(data, version, migrations, currentVersion) {
    let upgraded = data;
    for (let from = version; from < currentVersion; from += 1) {
      const step = migrations[from];
      upgraded = step ? step(upgraded) : upgraded;
    }
    return upgraded;
  }

  /** @returns {object} a record for a book nothing was saved for */
  function createEmptyRecord() {
    return { version: CURRENT_VERSION, layout: {}, flags: {}, ideaFlags: {} };
  }

  /**
   * Make saved data safe to use: right shape, upgraded to this version.
   * @param {object|null} raw  parsed JSON, any version
   * @returns {{record: object, isNewer: boolean}}
   */
  function upgradeRecord(raw) {
    if (!raw || typeof raw !== "object") {
      return { record: createEmptyRecord(), isNewer: false };
    }
    const version = Number(raw.version) || 1;
    if (version > CURRENT_VERSION) {
      return { record: createEmptyRecord(), isNewer: true };
    }
    const upgraded = runMigrations(Object.assign({}, raw), version,
      MIGRATIONS, CURRENT_VERSION);
    return {
      record: {
        version: CURRENT_VERSION,
        layout: isPlainObject(upgraded.layout) ? upgraded.layout : {},
        flags: cleanFlags(upgraded.flags),
        ideaFlags: cleanFlags(upgraded.ideaFlags),
      },
      isNewer: false,
    };
  }

  /** @returns {boolean} */
  function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" &&
      !Array.isArray(value);
  }

  /**
   * Keep only known flags on real entries.
   * @param {object} raw  flags as saved
   * @returns {object} question (or idea) id to {f, a}
   */
  function cleanFlags(raw) {
    const clean = {};
    if (!isPlainObject(raw)) {
      return clean;
    }
    Object.keys(raw).forEach(function check(questionId) {
      const entry = raw[questionId];
      if (isPlainObject(entry) && Array.isArray(entry.f)) {
        clean[questionId] = {
          f: FLAG_NAMES.filter(function isKnown(name) {
            return entry.f.includes(name);
          }),
          a: Number(entry.a) || 0,
        };
      }
    });
    return clean;
  }

  // ------------------------------------------------------------- storage

  /**
   * Load (or start) the settings of one book and apply its hidden
   * questions. Call before the home screen is drawn.
   * @param {string} bookId  the "id" from questions.json
   */
  function openForBook(bookId) {
    store.bookId = bookId;
    let raw = null;
    try {
      raw = JSON.parse(
        window.localStorage.getItem(STORAGE_KEY_PREFIX + bookId));
    } catch (problem) {
      raw = null;
    }
    const upgraded = upgradeRecord(raw);
    store.record = upgraded.record;
    store.isReadOnly = upgraded.isNewer;
    applyHiddenQuestions();
  }

  /** Write the record, unless it came from a newer version. */
  function saveRecord() {
    if (store.isReadOnly || !store.bookId) {
      return;
    }
    try {
      window.localStorage.setItem(STORAGE_KEY_PREFIX + store.bookId,
        JSON.stringify(store.record));
    } catch (problem) {
      // Storage may be blocked; the settings last until the page closes.
    }
  }

  // -------------------------------------------------------------- layout

  /** @returns {object} the saved layout (empty for a new book) */
  function readLayout() {
    return store.record.layout;
  }

  /**
   * Keep a new layout.
   * @param {object} layout  from home-layout.js
   */
  function saveLayout(layout) {
    store.record.layout = layout;
    saveRecord();
  }

  // --------------------------------------------------------------- flags

  /**
   * @param {"question"|"idea"} kind
   * @returns {object} the table of flags for that kind
   */
  function tableOf(kind) {
    return store.record[FLAG_FIELDS[kind]];
  }

  /**
   * @param {"question"|"idea"} kind
   * @param {string} id
   * @returns {string[]} the flags on it (empty if none)
   */
  function flagsOn(kind, id) {
    const entry = tableOf(kind)[id];
    return entry ? entry.f.slice() : [];
  }

  /**
   * Put a flag on, or take it off.
   * @param {"question"|"idea"} kind
   * @param {string} id
   * @param {string} flagName  one of FLAG_NAMES
   * @returns {boolean} true if the flag is on now
   */
  function toggleOn(kind, id, flagName) {
    if (!FLAG_NAMES.includes(flagName)) {
      return false;
    }
    const current = flagsOn(kind, id);
    const isOn = !current.includes(flagName);
    const next = FLAG_NAMES.filter(function keep(name) {
      return name === flagName ? isOn : current.includes(name);
    });
    setFlagsOn(kind, id, next);
    return isOn;
  }

  /**
   * Replace all flags on a question or idea and tell the page.
   * @param {"question"|"idea"} kind
   * @param {string} id
   * @param {string[]} flagNames
   */
  function setFlagsOn(kind, id, flagNames) {
    tableOf(kind)[id] = { f: flagNames, a: Date.now() };
    saveRecord();
    if (kind === "question") {
      applyHiddenQuestions();
    }
    document.dispatchEvent(new CustomEvent(
      kind === "question" ? "recallquiz:flags-changed" :
        "recallquiz:idea-flags-changed", { detail: { id, questionId: id } }));
  }

  /**
   * @param {"question"|"idea"} kind
   * @returns {string[]} ids flagged with a flag that removes them
   */
  function hiddenIdsOf(kind) {
    const table = tableOf(kind);
    return Object.keys(table).filter(function isHidden(id) {
      return HIDING_FLAGS.some(function has(name) {
        return table[id].f.includes(name);
      });
    });
  }

  /**
   * @param {"question"|"idea"} kind
   * @returns {{id: string, flags: string[], at: number}[]} flagged
   *   things, newest first
   */
  function listFlaggedOf(kind) {
    const table = tableOf(kind);
    return Object.keys(table)
      .filter(function hasAny(id) {
        return table[id].f.length > 0;
      })
      .map(function describe(id) {
        return { id, flags: table[id].f.slice(), at: table[id].a };
      })
      .sort(function newestFirst(first, second) {
        return second.at - first.at;
      });
  }

  /** @returns {string[]} the flags on a question (empty if none) */
  function flagsOf(questionId) {
    return flagsOn("question", questionId);
  }

  /** @returns {boolean} */
  function hasFlag(questionId, flagName) {
    return flagsOf(questionId).includes(flagName);
  }

  /** Flag a question (or take the flag off); true if it is on now. */
  function toggleFlag(questionId, flagName) {
    return toggleOn("question", questionId, flagName);
  }

  /** Take every flag off a question. */
  function clearFlags(questionId) {
    setFlagsOn("question", questionId, []);
  }

  /** @returns {{id: string, flags: string[], at: number}[]} flagged
   *  questions, newest first */
  function listFlagged() {
    return listFlaggedOf("question");
  }

  /** @returns {string[]} the flags on an idea (empty if none) */
  function ideaFlagsOf(ideaId) {
    return flagsOn("idea", ideaId);
  }

  /** @returns {boolean} */
  function hasIdeaFlag(ideaId, flagName) {
    return ideaFlagsOf(ideaId).includes(flagName);
  }

  /** Flag an idea (or take the flag off); true if it is on now. */
  function toggleIdeaFlag(ideaId, flagName) {
    return toggleOn("idea", ideaId, flagName);
  }

  /** Take every flag off an idea. */
  function clearIdeaFlags(ideaId) {
    setFlagsOn("idea", ideaId, []);
  }

  /** @returns {{id: string, flags: string[], at: number}[]} flagged
   *  ideas, newest first */
  function listFlaggedIdeas() {
    return listFlaggedOf("idea");
  }

  /** @returns {boolean} true if an idea is flagged Bad or Useless */
  function isIdeaHidden(ideaId) {
    return HIDING_FLAGS.some(function has(name) {
      return hasIdeaFlag(ideaId, name);
    });
  }

  /** Tell the book which questions to leave out. */
  function applyHiddenQuestions() {
    quiz.book.setHiddenIds(hiddenIdsOf("question"));
  }

  // ------------------------------------------------------------- account

  /**
   * @returns {{v: number, layout: object, flags: object,
   *   ideaFlags: object}} the settings in the shape saved in the
   *   reader's account
   */
  function readForAccount() {
    return {
      v: CURRENT_VERSION,
      layout: store.record.layout,
      flags: store.record.flags,
      ideaFlags: store.record.ideaFlags,
    };
  }

  /**
   * Make an account copy safe to use (any older version).
   * @param {object|null} remote
   * @returns {{v: number, layout: object, flags: object,
   *   ideaFlags: object}|null} null when it is missing or from a newer
   *   version
   */
  function upgradeAccountCopy(remote) {
    if (!isPlainObject(remote)) {
      return null;
    }
    const version = Number(remote.v) || 1;
    if (version > CURRENT_VERSION) {
      return null;
    }
    const upgraded = runMigrations(Object.assign({}, remote), version,
      MIGRATIONS, CURRENT_VERSION);
    return {
      v: CURRENT_VERSION,
      layout: isPlainObject(upgraded.layout) ? upgraded.layout : {},
      flags: cleanFlags(upgraded.flags),
      ideaFlags: cleanFlags(upgraded.ideaFlags),
    };
  }

  /**
   * Merge settings from the account into this browser: the newer layout
   * wins, and each question and idea keeps its newer flags.
   * @param {object|null} remote  the account copy, any version
   * @returns {boolean} true if this browser's settings changed
   */
  function useRemote(remote) {
    const account = upgradeAccountCopy(remote);
    if (!account || store.isReadOnly) {
      return false;
    }
    const before = JSON.stringify(store.record);
    if ((account.layout.at || 0) > (store.record.layout.at || 0)) {
      store.record.layout = account.layout;
    }
    store.record.flags = mergeFlags(store.record.flags, account.flags);
    store.record.ideaFlags = mergeFlags(store.record.ideaFlags,
      account.ideaFlags);
    const hasChanged = JSON.stringify(store.record) !== before;
    if (hasChanged) {
      saveRecord();
      applyHiddenQuestions();
      document.dispatchEvent(
        new CustomEvent("recallquiz:book-settings-applied"));
    }
    return hasChanged;
  }

  /**
   * @param {object} first  flags
   * @param {object} second  flags
   * @returns {object} each question keeps the entry changed last
   */
  function mergeFlags(first, second) {
    const merged = Object.assign({}, first);
    Object.keys(second).forEach(function pickNewer(id) {
      const mine = merged[id];
      if (!mine || second[id].a > mine.a) {
        merged[id] = second[id];
      }
    });
    return merged;
  }

  /**
   * @param {object|null} remote  the account copy, any version
   * @returns {boolean} true if this browser has something the account
   *   copy lacks, so it should be written back
   */
  function hasNewerThan(remote) {
    const account = upgradeAccountCopy(remote);
    if (!account) {
      return !store.isReadOnly && hasAnythingToSave();
    }
    if ((store.record.layout.at || 0) > (account.layout.at || 0)) {
      return true;
    }
    return hasNewerFlags(store.record.flags, account.flags) ||
      hasNewerFlags(store.record.ideaFlags, account.ideaFlags);
  }

  /**
   * @param {object} mine  flags in this browser
   * @param {object} theirs  flags in the account
   * @returns {boolean} true if any entry here is newer or missing there
   */
  function hasNewerFlags(mine, theirs) {
    return Object.keys(mine).some(function isNewer(id) {
      return !theirs[id] || mine[id].a > theirs[id].a;
    });
  }

  /** @returns {boolean} true once the reader has changed anything */
  function hasAnythingToSave() {
    return (store.record.layout.at || 0) > 0 ||
      Object.keys(store.record.flags).length > 0 ||
      Object.keys(store.record.ideaFlags).length > 0;
  }

  quiz.bookSettings = {
    FLAG_NAMES,
    HIDING_FLAGS,
    CURRENT_VERSION,
    runMigrations,
    openForBook,
    readLayout,
    saveLayout,
    flagsOf,
    hasFlag,
    toggleFlag,
    clearFlags,
    listFlagged,
    ideaFlagsOf,
    hasIdeaFlag,
    toggleIdeaFlag,
    clearIdeaFlags,
    listFlaggedIdeas,
    isIdeaHidden,
    readForAccount,
    useRemote,
    hasNewerThan,
  };
})((window.RecallQuiz = window.RecallQuiz || {}));
