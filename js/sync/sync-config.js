/*
 * sync-config.js
 * Settings for the optional "save progress to your account" feature.
 * This is the only file to edit when you turn sync on or off or change
 * the database. See js/sync/README.md.
 *
 *   provider: "none"      sync off; progress stays in this browser only
 *   provider: "firebase"  Google sign-in, progress saved in Firestore
 *   provider: "<name>"    any adapter in js/sync/providers/<name>.js
 *
 * Only the reader's progress is synced (memory levels, days practised,
 * recent results). The questions themselves never leave questions.json.
 *
 * The Firebase values below are not secrets: Firebase web config is
 * meant to be public. Who can read or write what is controlled by the
 * security rules in js/sync/providers/firebase-firestore.rules.
 *
 * This template starts with sync OFF so local testing never touches the
 * real database. Set provider to "firebase" before publishing.
 */
window.RecallQuizSyncConfig = {
  provider: "firebase",

  /** Wait this long after the last answer before saving to the account.
      Progress is also saved at the end of each session and when the page
      is hidden or closed. */
  saveDelaySeconds: 20,

  firebase: {
    sdkVersion: "12.19.0",
    apiKey: "AIzaSyBuMaFDHAx1cEvD7eInPlusJEHa2mU47Ww",
    authDomain: "reading-progress-39717.firebaseapp.com",
    projectId: "reading-progress-39717",
    storageBucket: "reading-progress-39717.firebasestorage.app",
    messagingSenderId: "180364097468",
    appId: "1:180364097468:web:448c46155e6a013b155db9",
  },
};
