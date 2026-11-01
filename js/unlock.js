/*
 * unlock.js
 * Gets the subject key for an encrypted book site (template v3) and shows
 * the lock screen until it has it. The reader (reader/app.js) and the quiz
 * both call SubjectUnlock.ready() first, so a reader signs in once and
 * then opens either view.
 *
 * Where the key comes from, in this order:
 *   1. the address (#key=...), which is removed from it straight away;
 *   2. this tab's sessionStorage (it keeps the key between pages);
 *   3. the signed-in reader's own account: the Firestore document
 *        users/<uid>/mediaKeys/<key-doc>   field "key"
 *      (64 hex characters, or 32 bytes in base64). The author creates it
 *      by hand; the security rules let only that account read it;
 *   4. the reader pastes it.
 *
 * Optional <meta> tags on the page:
 *   key-doc          id of the Firestore document (default "subject")
 *   firebase-config  JSON of the Firebase web config (public by design);
 *                    the default is the project the quiz sync uses.
 *
 * It sets window.RecallQuizSubjectKey (a CryptoKey for AES-GCM) and
 * window.RecallQuizSubjectKeyBase64 (for the picture store) and never
 * writes the key anywhere but this tab's sessionStorage.
 *
 * A classic script with no dependencies: load it first, in <head>.
 */
(function setUpSubjectUnlock() {
  "use strict";

  const FIREBASE_VERSION = "12.19.0";
  const STORAGE_NAME = "subject-key";
  const DEFAULT_CONFIG = {
    apiKey: "AIzaSyBuMaFDHAx1cEvD7eInPlusJEHa2mU47Ww",
    authDomain: "reading-progress-39717.firebaseapp.com",
    projectId: "reading-progress-39717",
    storageBucket: "reading-progress-39717.firebasestorage.app",
    messagingSenderId: "180364097468",
    appId: "1:180364097468:web:448c46155e6a013b155db9",
  };
  const STYLE = "#unlock{max-width:26rem;margin:12vh auto;padding:0 1rem;" +
    "font:1rem/1.5 system-ui,sans-serif;color:CanvasText}" +
    "#unlock h1{font-size:1.4rem;margin:0 0 .5rem}" +
    "#unlock p{margin:.5rem 0}#unlock .row{display:flex;gap:.5rem;" +
    "flex-wrap:wrap;margin:.75rem 0}#unlock button,#unlock input{" +
    "font:inherit;padding:.55rem .9rem;border-radius:.5rem;" +
    "border:1px solid GrayText}#unlock button{cursor:pointer;" +
    "background:ButtonFace;color:ButtonText}#unlock .go{" +
    "background:#2f5bd0;color:#fff;border-color:#2f5bd0}" +
    "#unlock input{flex:1;min-width:12rem;background:Canvas;color:" +
    "CanvasText}#unlock summary{cursor:pointer}#unlock .note{color:GrayText}";

  let firebase = null;
  let firebaseReady = null;
  let pending = null;

  /** @returns {object} the Firebase web config for this page */
  function firebaseConfig() {
    const meta = document.querySelector('meta[name="firebase-config"]');
    if (meta) {
      try {
        return JSON.parse(meta.content);
      } catch (problem) {
        console.error("firebase-config meta is not valid JSON");
      }
    }
    return DEFAULT_CONFIG;
  }

  /** @returns {string} the id of the Firestore key document */
  function keyDocumentId() {
    const meta = document.querySelector('meta[name="key-doc"]');
    return (meta && meta.content) || "subject";
  }

  /**
   * @param {string} text  64 hex characters, or 32 bytes in base64
   * @returns {Uint8Array|null} the key bytes, or null when not a key
   */
  function parseKey(text) {
    const value = String(text || "").trim();
    if (/^[0-9a-f]{64}$/i.test(value)) {
      return Uint8Array.from(value.match(/../g),
        function toByte(pair) { return parseInt(pair, 16); });
    }
    try {
      const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
      if (binary.length === 32) {
        return Uint8Array.from(binary, function toByte(char) {
          return char.charCodeAt(0);
        });
      }
    } catch (problem) {
      // not base64
    }
    return null;
  }

  /** @param {Uint8Array} bytes  @returns {string} 64 hex characters */
  function toHex(bytes) {
    return Array.from(bytes, function pad(value) {
      return value.toString(16).padStart(2, "0");
    }).join("");
  }

  /** @param {Uint8Array} bytes  @returns {string} base64 */
  function toBase64(bytes) {
    return btoa(String.fromCharCode.apply(null, bytes));
  }

  /**
   * Load the Firebase pieces once (from Google's CDN, only when needed).
   * @returns {Promise}
   */
  function startFirebase() {
    if (!firebaseReady) {
      const root = "https://www.gstatic.com/firebasejs/" +
        FIREBASE_VERSION + "/firebase-";
      firebaseReady = Promise.all([import(root + "app.js"),
        import(root + "auth.js"), import(root + "firestore.js")])
        .then(function connect(modules) {
          const app = modules[0].initializeApp(firebaseConfig());
          firebase = {
            auth: modules[1], store: modules[2],
            session: modules[1].getAuth(app),
            db: modules[2].getFirestore(app),
          };
          // Finishes a sign-in that fell back to a full-page redirect.
          return firebase.auth.getRedirectResult(firebase.session)
            .catch(function ignore() { return null; });
        });
      firebaseReady.catch(function forget() { firebaseReady = null; });
    }
    return firebaseReady;
  }

  /** @returns {Promise<object|null>} the signed-in user, if any */
  function firstUser() {
    return new Promise(function wait(resolve) {
      const stop = firebase.auth.onAuthStateChanged(firebase.session,
        function got(user) { stop(); resolve(user); });
    });
  }

  /**
   * @param {object} user  the signed-in user
   * @returns {Promise<Uint8Array>} the key stored for this account
   */
  async function readAccountKey(user) {
    let snapshot;
    try {
      snapshot = await firebase.store.getDoc(firebase.store.doc(
        firebase.db, "users", user.uid, "mediaKeys", keyDocumentId()));
    } catch (problem) {
      throw new Error("This account is not allowed to read the key (" +
        (problem.code || problem.message) + ").");
    }
    if (!snapshot.exists()) {
      throw new Error((user.email || "This account") + " has no key yet." +
        " Add the document users/" + user.uid + "/mediaKeys/" +
        keyDocumentId() + " in Firestore.");
    }
    const bytes = parseKey(snapshot.data().key);
    if (!bytes) {
      throw new Error("The key stored for this account is not 32 bytes " +
        "(64 hex characters or base64).");
    }
    return bytes;
  }

  /**
   * Remember the key for this tab and publish it for the page's scripts.
   * @param {Uint8Array} bytes
   * @returns {Promise<object>} what ready() resolves with
   */
  async function accept(bytes) {
    try {
      sessionStorage.setItem(STORAGE_NAME, toHex(bytes));
    } catch (problem) {
      // private mode: the key is kept in memory only
    }
    if (location.hash.indexOf("key=") !== -1) {
      history.replaceState(null, "", location.pathname + location.search);
    }
    const key = await crypto.subtle.importKey(
      "raw", bytes, "AES-GCM", false, ["decrypt"]);
    window.RecallQuizSubjectKey = key;
    window.RecallQuizSubjectKeyBase64 = toBase64(bytes);
    return { key: key, hex: toHex(bytes), base64: toBase64(bytes) };
  }

  /** @returns {Uint8Array|null} a key from the address or this tab */
  function keyAtHand() {
    const inAddress = (location.hash.match(/key=([^&]+)/) || [])[1];
    let stored = null;
    try {
      stored = sessionStorage.getItem(STORAGE_NAME);
    } catch (problem) {
      stored = null;
    }
    return parseKey(inAddress ? decodeURIComponent(inAddress) : "") ||
      parseKey(stored);
  }

  /**
   * Show the lock screen and wait for a key.
   * @param {string} message  why the earlier attempt failed, if it did
   * @returns {Promise<Uint8Array>}
   */
  function askForKey(message) {
    return new Promise(function build(resolve) {
      const style = document.createElement("style");
      style.textContent = STYLE;
      document.head.appendChild(style);
      const box = document.createElement("div");
      box.id = "unlock";
      box.innerHTML = '<h1>Locked</h1><p class="note" role="status"></p>' +
        '<div class="row"><button type="button" class="go">' +
        'Sign in with Google</button><button type="button" hidden>' +
        'Use another account</button></div><details>' +
        '<summary>Paste the key instead</summary><form class="row">' +
        '<input type="text" autocomplete="off" aria-label="Subject key" ' +
        'placeholder="subject key (hex or base64)"><button>Unlock' +
        '</button></form></details>';
      document.body.appendChild(box);
      const note = box.querySelector(".note");
      const signIn = box.querySelector(".go");
      const other = box.querySelector("button[hidden]");
      const details = box.querySelector("details");
      const input = box.querySelector("input");
      note.textContent = message ||
        "This book is encrypted. Sign in to get the key from your account.";
      details.open = Boolean(message);

      /** @param {string} text  show a problem and allow another try */
      function fail(text) {
        note.textContent = text;
        signIn.disabled = false;
        signIn.textContent = "Sign in with Google";
        other.hidden = !(firebase && firebase.session.currentUser);
      }
      /** @returns {Promise<object|undefined>} the signed-in user */
      async function popUp() {
        const provider = new firebase.auth.GoogleAuthProvider();
        try {
          await firebase.auth.signInWithPopup(firebase.session, provider);
        } catch (problem) {
          const code = problem.code || "";
          if (code === "auth/popup-blocked" ||
              code === "auth/operation-not-supported-in-this-environment") {
            await firebase.auth.signInWithRedirect(firebase.session,
              provider);
            return undefined;
          }
          throw new Error(code === "auth/popup-closed-by-user" ||
            code === "auth/cancelled-popup-request" ?
            "Sign-in was cancelled." :
            "Sign-in failed (" + (code || problem.message) + ").");
        }
        return firebase.session.currentUser;
      }

      signIn.addEventListener("click", async function start() {
        signIn.disabled = true;
        signIn.textContent = "Signing in…";
        try {
          await startFirebase();
          const user = await popUp();
          if (user) {
            resolve(await readAccountKey(user));
          }
        } catch (problem) {
          fail(problem.message);
        }
      });
      other.addEventListener("click", async function switchAccount() {
        try {
          await firebase.auth.signOut(firebase.session);
        } catch (problem) {
          // ignore
        }
        other.hidden = true;
        note.textContent = "Signed out. Sign in with the account that " +
          "holds the key.";
      });
      box.querySelector("form").addEventListener("submit",
        function paste(event) {
          event.preventDefault();
          const bytes = parseKey(input.value);
          if (bytes) {
            resolve(bytes);
          } else {
            note.textContent = "That is not a valid key: expected 32 " +
              "bytes as hex or base64.";
          }
        });
      startFirebase().catch(function offline() {
        note.textContent = "Could not load Google sign-in. Paste the key " +
          "instead.";
        signIn.disabled = true;
        details.open = true;
      });
    });
  }

  /**
   * @returns {Promise<{key: CryptoKey, hex: string, base64: string}>}
   *   resolves once the key is known (after sign-in if needed)
   */
  function ready() {
    if (!pending) {
      pending = (async function unlock() {
        if (!window.crypto || !crypto.subtle) {
          throw new Error("This browser cannot decrypt (it needs https).");
        }
        let bytes = keyAtHand();
        let message = "";
        if (!bytes) {
          try {
            await startFirebase();
            const user = await firstUser();   // returning readers
            if (user) {
              try {
                bytes = await readAccountKey(user);
              } catch (problem) {
                message = problem.message;
              }
            }
          } catch (problem) {
            message = "Could not reach Google sign-in. " +
              (problem.message || "");
          }
        }
        if (!bytes) {
          bytes = await askForKey(message);
          const box = document.getElementById("unlock");
          if (box) {
            box.remove();
          }
        }
        return accept(bytes);
      })();
    }
    return pending;
  }

  /**
   * Decrypt one RQE1 file (see the format in tools/book_build/encfmt.py).
   * @param {ArrayBuffer} buffer
   * @param {CryptoKey} key
   * @returns {Promise<Uint8Array>} the plain bytes (gunzipped if flagged)
   */
  async function decrypt(buffer, key) {
    const bytes = new Uint8Array(buffer);
    const head = bytes.slice(0, 9);
    if (String.fromCharCode.apply(null, head.slice(0, 4)) !== "RQE1") {
      throw new Error("not an encrypted file");
    }
    const plain = new Uint8Array(await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bytes.slice(9, 21), additionalData: head },
      key, bytes.slice(21)));
    if (!(head[4] & 1)) {
      return plain;
    }
    const stream = new Blob([plain]).stream()
      .pipeThrough(new DecompressionStream("gzip"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  /** Sign out of Google (if signed in), forget the key, reload. */
  async function reset() {
    try {
      sessionStorage.removeItem(STORAGE_NAME);
    } catch (problem) {
      // ignore
    }
    try {
      await startFirebase();
      await firebase.auth.signOut(firebase.session);
    } catch (problem) {
      // ignore
    }
    location.reload();
  }

  /**
   * Add a classic script to the page and wait for it.
   * @param {string} address
   * @returns {Promise}
   */
  function loadScript(address) {
    return new Promise(function add(resolve, reject) {
      const script = document.createElement("script");
      script.src = address;
      script.onload = resolve;
      script.onerror = function failed() {
        reject(new Error("could not load " + address));
      };
      document.head.appendChild(script);
    });
  }

  window.SubjectUnlock = {
    ready: ready, decrypt: decrypt, reset: reset, loadScript: loadScript,
  };
})();
