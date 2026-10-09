/*
 * cloud-sync.js
 * Optional: keeps the reader's progress in their account so it follows
 * them across devices and survives clearing the browser.
 *
 * This file does not know which database is used. It loads the adapter
 * named in js/sync/sync-config.js from js/sync/providers/<name>.js and
 * talks to it only through the small interface in js/sync/README.md
 * (start, signIn, signOut, readProgress, writeProgress).
 *
 * The rest of the quiz does not know this file exists. It listens to
 * three events the quiz sends on the document:
 *   recallquiz:book-opened       a book's questions are ready
 *   recallquiz:progress-saved    progress changed in this browser
 *   recallquiz:session-finished  the results screen was shown
 *
 * Progress is always saved in the browser first (progress-storage.js).
 * When signed in, it is also merged with the account copy (see
 * progress-merge.js) and saved there: after a short pause, at the end of
 * a session, and when the page is hidden.
 */
(function setUpCloudSync(quiz) {
  "use strict";

  const PROVIDER_FOLDER = "js/sync/providers/";
  const OWNER_KEY_PREFIX = "recall-quiz-sync-owner:";
  const DEFAULT_SAVE_DELAY_SECONDS = 20;
  /** The account document that holds settings shared by every book
      (stored like a book called "_settings", so the rules need no change) */
  const SETTINGS_DOCUMENT_ID = "_settings";
  const THEME_SAVE_DELAY_SECONDS = 2;
  const MS_PER_SECOND = 1000;
  /** Give up waiting for the database after this long. A database that
      queues writes offline (Firestore) keeps retrying by itself. */
  const DATABASE_TIMEOUT_SECONDS = 15;

  const providers = {};
  const sync = {
    config: window.RecallQuizSyncConfig || { provider: "none" },
    provider: null,
    isProviderStarted: false,
    user: null,          // { id, name, email } when signed in
    bookId: null,
    hasUnsavedChanges: false,
    isApplyingAccountCopy: false,
    isSyncing: false,
    isSyncWanted: false,
    currentSync: Promise.resolve(),
    lastSavedAt: 0,
    status: "off",       // off | file | connecting | signed-out |
                         // syncing | saved | error
    saveTimer: null,
    themeTimer: null,
  };

  // ------------------------------------------------------------ setup

  /**
   * Adapters call this from their own file to plug themselves in.
   * @param {string} name     the name used in sync-config.js
   * @param {object} adapter  see js/sync/README.md for the methods
   */
  function registerProvider(name, adapter) {
    providers[name] = adapter;
  }

  /** @returns {boolean} true when sync-config.js names a provider */
  function isSyncTurnedOn() {
    const name = sync.config.provider;
    return Boolean(name) && name !== "none";
  }

  /** Start sync if it is turned on. Called once when this file loads. */
  function startSync() {
    if (!isSyncTurnedOn()) {
      return;
    }
    listenToQuizEvents();
    if (window.location.protocol === "file:") {
      showStatus("file");
      return;
    }
    connectToProvider();
  }

  /** Load and start the adapter; show an error bar if that fails. */
  function connectToProvider() {
    showStatus("connecting");
    loadProvider(sync.config.provider)
      .then(startProvider)
      .then(function markStarted() {
        sync.isProviderStarted = true;
      })
      .catch(function reportStartProblem(problem) {
        console.error("Cloud sync could not start:", problem);
        showStatus("error");
      });
  }

  /**
   * Add the adapter's script to the page and wait for it to register.
   * @param {string} name
   * @returns {Promise<object>} the adapter
   */
  function loadProvider(name) {
    if (!/^[a-z0-9-]+$/.test(name)) {
      return Promise.reject(new Error("Bad provider name: " + name));
    }
    if (providers[name]) {
      return Promise.resolve(providers[name]);
    }
    return new Promise(function addScript(resolve, reject) {
      const script = document.createElement("script");
      script.src = PROVIDER_FOLDER + name + ".js";
      script.onload = function useAdapter() {
        if (providers[name]) {
          resolve(providers[name]);
        } else {
          reject(new Error(script.src + " did not register " + name));
        }
      };
      script.onerror = function reportMissing() {
        reject(new Error("Could not load " + script.src));
      };
      document.head.appendChild(script);
    });
  }

  /**
   * Hand the adapter its settings and wait to hear who is signed in.
   * @param {object} adapter
   * @returns {Promise}
   */
  function startProvider(adapter) {
    sync.provider = adapter;
    const settings = sync.config[sync.config.provider] || {};
    return adapter.start(settings, handleUserChanged);
  }

  /** Listen to the quiz and the page for moments worth saving. */
  function listenToQuizEvents() {
    document.addEventListener("recallquiz:book-opened", handleBookOpened);
    document.addEventListener("recallquiz:progress-saved",
      handleProgressSaved);
    document.addEventListener("recallquiz:session-finished", saveNow);
    document.addEventListener("recallquiz:theme-changed",
      handleThemeChanged);
    document.addEventListener("recallquiz:layout-changed",
      handleThemeChanged);
    document.addEventListener("visibilitychange",
      function saveWhenHidden() {
        if (document.visibilityState === "hidden") {
          saveIfChanged();
        }
      });
    window.addEventListener("pagehide", saveIfChanged);
  }

  // ----------------------------------------------------------- events

  /**
   * A book was opened: sync it if someone is signed in.
   * @param {CustomEvent} event  detail.bookId
   */
  function handleBookOpened(event) {
    sync.bookId = event.detail.bookId;
    if (sync.user) {
      saveNow();
      syncSettings(sync.user);
    }
  }

  /**
   * The adapter tells us someone signed in or out.
   * @param {{id: string, name: string, email: string}|null} user
   */
  function handleUserChanged(user) {
    sync.user = user;
    if (!user) {
      showStatus("signed-out");
      return;
    }
    syncSettings(user);
    if (sync.bookId) {
      saveNow();
    } else {
      showStatus("saved");
    }
  }

  /** The reader picked a theme: save it to the account soon. */
  function handleThemeChanged() {
    clearTimeout(sync.themeTimer);
    if (!sync.user) {
      return;
    }
    const user = sync.user;
    sync.themeTimer = setTimeout(function saveTheme() {
      syncSettings(user);
    }, THEME_SAVE_DELAY_SECONDS * MS_PER_SECOND);
  }

  /**
   * Keep the theme the same on every device: the newest choice, in this
   * browser or in the account, wins. A newer account choice is applied
   * here; a newer browser choice is written to the account. Failures
   * are logged and ignored (the theme is not worth an error message).
   * @param {{id: string}} user
   * @returns {Promise}
   */
  function syncSettings(user) {
    const theme = window.RecallQuizTheme;
    const layout = quiz.layout;
    if (!theme || !sync.provider) {
      return Promise.resolve();
    }
    return withTimeout(
      sync.provider.readProgress(user.id, SETTINGS_DOCUMENT_ID))
      .then(function chooseNewest(account) {
        if (sync.user !== user) {
          return undefined;
        }
        const next = {};
        let mustWrite = false;
        const savedTheme = account && account.theme;
        const savedLayout = account && account.layout;
        if (savedTheme) {
          next.theme = savedTheme;
        }
        if (savedLayout) {
          next.layout = savedLayout;
        }
        const localTheme = theme.read();
        const themeUsed = savedTheme && theme.useRemote(
          { themeId: savedTheme.t, mode: savedTheme.m, at: savedTheme.a });
        if (!themeUsed && localTheme.at > 0 &&
            (!savedTheme || localTheme.at > savedTheme.a)) {
          next.theme = { t: localTheme.themeId, m: localTheme.mode,
            a: localTheme.at };
          mustWrite = true;
        }
        if (layout) {
          const localLayout = layout.readForAccount();
          const layoutUsed = savedLayout && layout.useRemote(savedLayout);
          if (!layoutUsed && localLayout.a > 0 &&
              (!savedLayout || localLayout.a > savedLayout.a)) {
            next.layout = localLayout;
            mustWrite = true;
          }
        }
        if (!mustWrite) {
          return undefined;
        }
        return withTimeout(sync.provider.writeProgress(
          user.id, SETTINGS_DOCUMENT_ID, next));
      })
      .catch(function ignoreSettingsProblem(problem) {
        console.error("Settings sync failed:", problem);
      });
  }

  /** Progress changed in the browser: save to the account soon. */
  function handleProgressSaved() {
    if (sync.isApplyingAccountCopy || !sync.user) {
      return;
    }
    sync.hasUnsavedChanges = true;
    clearTimeout(sync.saveTimer);
    const delaySeconds =
      sync.config.saveDelaySeconds || DEFAULT_SAVE_DELAY_SECONDS;
    sync.saveTimer = setTimeout(saveNow, delaySeconds * MS_PER_SECOND);
  }

  /** Save now, but only if something changed since the last save. */
  function saveIfChanged() {
    if (sync.hasUnsavedChanges) {
      saveNow();
    }
  }

  // ------------------------------------------------------------- sync

  /**
   * Merge this browser's progress with the account copy and save the
   * result in both places. Safe to call often: calls made while a sync
   * is running are combined into one more sync afterwards.
   * @returns {Promise}
   */
  function saveNow() {
    clearTimeout(sync.saveTimer);
    if (!sync.user || !sync.bookId || !sync.provider) {
      return Promise.resolve();
    }
    if (sync.isSyncing) {
      sync.isSyncWanted = true;
      return sync.currentSync;   // resolves after the extra sync too
    }
    sync.isSyncing = true;
    sync.isSyncWanted = false;
    showStatus("syncing");
    sync.currentSync = syncWithAccount(sync.user, sync.bookId)
      .then(function markSaved() {
        sync.lastSavedAt = Date.now();
        showStatus("saved");
      })
      .catch(function reportSyncProblem(problem) {
        console.error("Cloud sync failed:", problem);
        sync.hasUnsavedChanges = true;
        showStatus("error");
      })
      .then(function syncAgainIfWanted() {
        sync.isSyncing = false;
        if (sync.isSyncWanted) {
          return saveNow();
        }
        return undefined;
      });
    return sync.currentSync;
  }

  /**
   * Read the account copy, merge, apply here, and write back if needed.
   * @param {{id: string}} user
   * @param {string} bookId
   * @returns {Promise}
   */
  function syncWithAccount(user, bookId) {
    return withTimeout(sync.provider.readProgress(user.id, bookId))
      .then(function mergeAndWrite(accountCopy) {
        if (sync.user !== user || sync.bookId !== bookId) {
          return undefined;   // signed out or switched while reading
        }
        const merged = quiz.progressMerge.mergeProgress(
          browserCopyFor(user.id, bookId), accountCopy);
        applyHere(merged);
        rememberOwner(bookId, user.id);
        sync.hasUnsavedChanges = false;
        if (accountCopy &&
            quiz.progressMerge.sameProgress(merged, accountCopy)) {
          return undefined;
        }
        return withTimeout(
          sync.provider.writeProgress(user.id, bookId, merged));
      });
  }

  /**
   * Fail a database call that takes too long, so one stuck call (for
   * example offline) cannot block every later sync and sign-out.
   * @param {Promise} promise
   * @returns {Promise}
   */
  function withTimeout(promise) {
    return new Promise(function race(resolve, reject) {
      const timer = setTimeout(function giveUp() {
        reject(new Error("The database did not answer in time"));
      }, DATABASE_TIMEOUT_SECONDS * MS_PER_SECOND);
      promise.then(
        function finish(value) { clearTimeout(timer); resolve(value); },
        function fail(problem) { clearTimeout(timer); reject(problem); });
    });
  }

  /**
   * This browser's progress, unless it belongs to a different account
   * (someone else signed in here before), in which case it is ignored.
   * @returns {object|null}
   */
  function browserCopyFor(userId, bookId) {
    const owner = readOwner(bookId);
    if (owner && owner !== userId) {
      return null;
    }
    return quiz.progress.saved;
  }

  /**
   * Use merged progress in this browser and redraw the home screen.
   * @param {object} merged
   */
  function applyHere(merged) {
    if (quiz.progressMerge.sameProgress(merged, quiz.progress.saved)) {
      return;
    }
    sync.isApplyingAccountCopy = true;
    quiz.progress.replaceProgress(merged);
    sync.isApplyingAccountCopy = false;
    quiz.homeScreen.refresh();
  }

  // ------------------------------------------------------- ownership

  /** @returns {string|null} the account this browser's copy belongs to */
  function readOwner(bookId) {
    try {
      return localStorage.getItem(OWNER_KEY_PREFIX + bookId);
    } catch (storageError) {
      return null;
    }
  }

  /** Remember which account this browser's copy now belongs to. */
  function rememberOwner(bookId, userId) {
    try {
      if (userId) {
        localStorage.setItem(OWNER_KEY_PREFIX + bookId, userId);
      } else {
        localStorage.removeItem(OWNER_KEY_PREFIX + bookId);
      }
    } catch (storageError) {
      // Storage blocked: progress-storage.js already warns the reader.
    }
  }

  // ----------------------------------------------------- sign in / out

  /**
   * Ask the adapter to sign the reader in. Called straight from the
   * click, so browsers allow the sign-in pop-up.
   */
  function signIn() {
    let signingIn;
    try {
      signingIn = sync.provider.signIn();
    } catch (problem) {
      signingIn = Promise.reject(problem);
    }
    showStatus("connecting");
    signingIn.catch(function reportSignInProblem(problem) {
      console.error("Sign-in failed:", problem);
      showStatus(sync.user ? "saved" : "signed-out");
    });
  }

  /**
   * Save any last changes, sign out, and clear this book's progress from
   * this browser so the next person on this device starts fresh. The
   * progress stays in the account.
   */
  function signOut() {
    const bookId = sync.bookId;
    saveNow()
      .then(function checkSaved() {
        if (sync.hasUnsavedChanges && !confirm("Your latest answers " +
            "could not be saved to your account. Sign out anyway?")) {
          throw new Error("cancelled");
        }
        return sync.provider.signOut();
      })
      .then(function clearThisBrowser() {
        sync.user = null;
        sync.isApplyingAccountCopy = true;
        quiz.progress.replaceProgress(null);
        sync.isApplyingAccountCopy = false;
        rememberOwner(bookId, null);
        quiz.homeScreen.refresh();
        showStatus("signed-out");
      })
      .catch(function reportSignOutProblem(problem) {
        if (problem.message !== "cancelled") {
          console.error("Sign-out failed:", problem);
          showStatus("error");
        }
      });
  }

  // --------------------------------------------------------------- UI

  /**
   * Show the sync bar for one state.
   * @param {string} status  see sync.status
   */
  function showStatus(status) {
    sync.status = status;
    const helpers = quiz.helpers;
    // The Settings screen always shows the account; the home screen only
    // shows a bar when the reader has something to do (sign in, retry).
    const needsAttention = ["file", "signed-out", "error"]
      .indexOf(status) >= 0;
    fillAccount(helpers.findElement("cloud-sync-bar"), status,
      needsAttention);
    const section = helpers.findElement("account-section");
    if (section) {
      section.classList.remove("hidden");
      fillAccount(helpers.findElement("account-body"), status, true);
    }
  }

  /**
   * Fill one place (the home bar or the Settings account section).
   * @param {HTMLElement} place
   * @param {string} status
   * @param {boolean} isShown  false hides the place
   */
  function fillAccount(place, status, isShown) {
    place.textContent = "";
    place.classList.toggle("hidden", !isShown);
    place.dataset.status = status;
    place.appendChild(quiz.helpers.createElement("p", "cloud-sync-text",
      statusText(status)));
    const buttons = quiz.helpers.createElement("div", "button-row");
    statusButtons(status).forEach(function addButton(button) {
      buttons.appendChild(button);
    });
    place.appendChild(buttons);
  }

  /** @returns {string} what to tell the reader in a state */
  function statusText(status) {
    const providerLabel = (sync.provider && sync.provider.label) || "";
    const who = sync.user ? (sync.user.name || sync.user.email || "") : "";
    const texts = {
      file: "Saving progress to your account works on the published " +
        "site. Here it is saved in this browser only.",
      connecting: "Connecting to your account…",
      "signed-out": "Sign in to keep your progress across devices. " +
        "Without signing in it is saved in this browser only.",
      syncing: "Saving to your account…",
      saved: "Signed in" + (who ? " as " + who : "") + ". Progress " +
        "saved to your account" + savedTimeText() + ".",
      error: "Could not reach your account. Progress is still saved in " +
        "this browser.",
    };
    const text = texts[status] || "";
    return status === "signed-out" && providerLabel ?
      text.replace("Sign in", "Sign in with " + providerLabel) : text;
  }

  /** @returns {string} " at 11:20", or "" before the first save */
  function savedTimeText() {
    if (!sync.lastSavedAt) {
      return "";
    }
    return " at " + new Date(sync.lastSavedAt).toLocaleTimeString([],
      { hour: "2-digit", minute: "2-digit" });
  }

  /** @returns {HTMLElement[]} the action buttons for a state */
  function statusButtons(status) {
    const create = quiz.helpers.createButton;
    const buttons = [];
    if (status === "signed-out") {
      const label = "Sign in" + (sync.provider && sync.provider.label ?
        " with " + sync.provider.label : "");
      buttons.push(create(label, "button", signIn));
    }
    if (status === "error") {
      buttons.push(create("Try again", "button", retryAfterError));
    }
    if ((status === "saved" || status === "error") && sync.user) {
      buttons.push(create("Sign out", "button", signOut));
    }
    return buttons;
  }

  /**
   * The Try again button: reconnect, save, or sign in as needed. If the
   * adapter never started (its library could not be downloaded), the
   * page is reloaded, because browsers remember a failed import().
   * Progress is safe in the browser, so nothing is lost.
   */
  function retryAfterError() {
    if (!sync.isProviderStarted) {
      window.location.reload();
    } else if (sync.user) {
      saveNow();
    } else {
      signIn();
    }
  }

  quiz.cloudSync = {
    registerProvider,
    saveNow,
    signIn,
    signOut,
    state: sync,
  };
  startSync();
})((window.RecallQuiz = window.RecallQuiz || {}));
