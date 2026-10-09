/*
 * providers/firebase.js
 * Cloud sync adapter for Firebase: Google sign-in (Firebase Auth) and
 * one Firestore document per reader per book:
 *
 *   users/{user id}/books/{book id}
 *     progress:  the progress as JSON text (see progress-storage.js)
 *     updatedAt: server time of the last save
 *
 * The Firebase SDK is fetched from Google's CDN only when this adapter
 * is used, with import(), so the quiz itself stays free of modules.
 * Settings come from the "firebase" block in js/sync/sync-config.js.
 * To use a different database, see js/sync/README.md.
 */
(function setUpFirebaseSync(quiz) {
  "use strict";

  const SDK_ROOT = "https://www.gstatic.com/firebasejs/";
  const DEFAULT_SDK_VERSION = "12.19.0";
  const POPUP_BLOCKED_CODES = ["auth/popup-blocked",
    "auth/operation-not-supported-in-this-environment"];

  const firebase = { app: null, auth: null, db: null };

  /**
   * Fetch one part of the Firebase SDK.
   * @param {string} version  e.g. "12.19.0"
   * @param {string} part     "app", "auth" or "firestore"
   * @returns {Promise<object>} the module
   */
  function importSdk(version, part) {
    return import(SDK_ROOT + version + "/firebase-" + part + ".js");
  }

  /**
   * Load the SDK, connect, and report sign-in changes.
   * @param {object} settings      the firebase block of sync-config.js
   * @param {function} onUserChanged  called with a user or null
   * @returns {Promise}
   */
  function start(settings, onUserChanged) {
    const version = settings.sdkVersion || DEFAULT_SDK_VERSION;
    return Promise.all([importSdk(version, "app"),
      importSdk(version, "auth"), importSdk(version, "firestore")])
      .then(function connect(modules) {
        firebase.appSdk = modules[0];
        firebase.authSdk = modules[1];
        firebase.dbSdk = modules[2];
        firebase.app = firebase.appSdk.initializeApp(
          appSettings(settings));
        firebase.auth = firebase.authSdk.getAuth(firebase.app);
        firebase.db = firebase.dbSdk.getFirestore(firebase.app);
        firebase.authSdk.onAuthStateChanged(firebase.auth,
          function reportUser(account) {
            onUserChanged(account ? describeUser(account) : null);
          });
        // Finishes a sign-in that fell back to a full-page redirect.
        return firebase.authSdk.getRedirectResult(firebase.auth)
          .catch(function reportRedirectProblem(problem) {
            console.error("Google sign-in (redirect) failed:", problem);
            return null;
          });
      });
  }

  /** @returns {object} the settings Firebase itself expects */
  function appSettings(settings) {
    const copy = Object.assign({}, settings);
    delete copy.sdkVersion;
    return copy;
  }

  /** @returns {{id: string, name: string, email: string}} */
  function describeUser(account) {
    return {
      id: account.uid,
      name: account.displayName || "",
      email: account.email || "",
    };
  }

  /**
   * Sign in with a Google pop-up, or a full-page redirect if the browser
   * blocks pop-ups.
   * @returns {Promise}
   */
  function signIn() {
    const authSdk = firebase.authSdk;
    const google = new authSdk.GoogleAuthProvider();
    return authSdk.signInWithPopup(firebase.auth, google)
      .catch(function tryRedirect(problem) {
        if (POPUP_BLOCKED_CODES.includes(problem.code)) {
          return authSdk.signInWithRedirect(firebase.auth, google);
        }
        throw problem;
      });
  }

  /** @returns {Promise} */
  function signOut() {
    return firebase.authSdk.signOut(firebase.auth);
  }

  /** @returns {object} the Firestore reference for one reader's book */
  function progressDocument(userId, bookId) {
    // Book ids could contain "/", which Firestore treats as a path.
    return firebase.dbSdk.doc(firebase.db, "users", userId, "books",
      encodeURIComponent(bookId));
  }

  /**
   * @param {string} userId
   * @param {string} bookId
   * @returns {Promise<object|null>} saved progress, or null if none
   */
  function readProgress(userId, bookId) {
    return firebase.dbSdk.getDoc(progressDocument(userId, bookId))
      .then(function readSnapshot(snapshot) {
        if (!snapshot.exists()) {
          return null;
        }
        return JSON.parse(snapshot.data().progress);
      });
  }

  /**
   * @param {string} userId
   * @param {string} bookId
   * @param {object} progress
   * @returns {Promise}
   */
  function writeProgress(userId, bookId, progress) {
    const dbSdk = firebase.dbSdk;
    return dbSdk.setDoc(progressDocument(userId, bookId), {
      progress: JSON.stringify(progress),
      updatedAt: dbSdk.serverTimestamp(),
    });
  }

  quiz.cloudSync.registerProvider("firebase", {
    label: "Google",
    start,
    signIn,
    signOut,
    readProgress,
    writeProgress,
  });
})((window.RecallQuiz = window.RecallQuiz || {}));
