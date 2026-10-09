/*
 * providers/example-in-browser.js
 * A complete, working adapter that "syncs" to a pretend account kept in
 * this browser's sessionStorage. It is not useful for readers. It exists
 * as the smallest example of the adapter interface: copy it when adding
 * a new database (Supabase, your own server, ...), and the tests use it
 * to check cloud-sync.js without a real database.
 *
 * Turn it on with  provider: "example-in-browser"  in sync-config.js.
 * Settings: { userName: "Test Reader" } (optional).
 */
(function setUpExampleSync(quiz) {
  "use strict";

  const ACCOUNT_KEY = "recall-quiz-example-account";
  const STORE_KEY_PREFIX = "recall-quiz-example-store:";

  let reportUser = function ignore() {};
  let userName = "Test Reader";

  /**
   * Remember the callback and report who is signed in right now.
   * @param {object} settings
   * @param {function} onUserChanged
   * @returns {Promise}
   */
  function start(settings, onUserChanged) {
    reportUser = onUserChanged;
    userName = settings.userName || userName;
    reportUser(currentUser());
    return Promise.resolve();
  }

  /** @returns {{id: string, name: string, email: string}|null} */
  function currentUser() {
    const id = sessionStorage.getItem(ACCOUNT_KEY);
    return id ? { id, name: userName, email: "" } : null;
  }

  /** @returns {Promise} sign in as a fixed pretend user */
  function signIn() {
    sessionStorage.setItem(ACCOUNT_KEY, "example-user");
    reportUser(currentUser());
    return Promise.resolve();
  }

  /** @returns {Promise} */
  function signOut() {
    sessionStorage.removeItem(ACCOUNT_KEY);
    reportUser(null);
    return Promise.resolve();
  }

  /** @returns {Promise<object|null>} */
  function readProgress(userId, bookId) {
    const text = sessionStorage.getItem(STORE_KEY_PREFIX + userId + "/" +
      bookId);
    return Promise.resolve(text ? JSON.parse(text) : null);
  }

  /** @returns {Promise} */
  function writeProgress(userId, bookId, progress) {
    sessionStorage.setItem(STORE_KEY_PREFIX + userId + "/" + bookId,
      JSON.stringify(progress));
    return Promise.resolve();
  }

  quiz.cloudSync.registerProvider("example-in-browser", {
    label: "a test account",
    start,
    signIn,
    signOut,
    readProgress,
    writeProgress,
  });
})((window.RecallQuiz = window.RecallQuiz || {}));
