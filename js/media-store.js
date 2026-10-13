/*
 * media-store.js
 * Finds and opens a book's pictures and clips (template v2).
 *
 * A media entry in questions.json looks like
 *   { "id": "u03/i07/f02", "alt": "text for the picture",
 *     "role": "figure", "type": "image/webp" }
 * and is stored in the book's own repo as media/<id>.enc: a 12-byte nonce
 * followed by AES-GCM data. The file key is derived from the book key
 * (HKDF-SHA-256, info "file:<id>"), and the id is the authenticated
 * data, so a file cannot be swapped for another. tools/encrypt_media.py
 * writes these files.
 *
 * The book key is a 32-byte key in base64. It is never in the site. A key
 * provider (a function that returns a promise of the key, or null) is set
 * by whatever signs the reader in (see js/sync/README.md). Without a key,
 * or without Web Crypto, load() gives null and the page shows the text
 * instead of the picture. An entry with a "src" instead of an "id" is a
 * plain file that is shown as it is (for the author's own diagrams).
 *
 * questions.json "mediaStore": "repo" (default). Files are fetched when a
 * card or question asks for them, never all at the start.
 */
(function setUpMediaStore(quiz) {
  "use strict";

  const NONCE_BYTES = 12;
  const media = { keyProvider: null };
  /** id -> promise of an object URL (or null) */
  const loaded = new Map();
  /** The book key once it has been imported, or null */
  let bookKeyPromise = null;

  /**
   * Set the function that supplies the book key (base64) or null.
   * @param {function(): Promise<string|null>} provider
   */
  function setKeyProvider(provider) {
    media.keyProvider = provider;
    bookKeyPromise = null;
    loaded.clear();
  }

  /**
   * The text of base64 as bytes.
   * @param {string} text
   * @returns {Uint8Array}
   */
  function fromBase64(text) {
    const raw = atob(text.trim());
    return Uint8Array.from(raw, function toByte(char) {
      return char.charCodeAt(0);
    });
  }

  /**
   * The imported book key, or null when there is none.
   * @returns {Promise<CryptoKey|null>}
   */
  function getBookKey() {
    if (!bookKeyPromise) {
      bookKeyPromise = importBookKey();
    }
    return bookKeyPromise;
  }

  /** @returns {Promise<CryptoKey|null>} */
  async function importBookKey() {
    if (!media.keyProvider || !window.crypto || !crypto.subtle) {
      return null;
    }
    try {
      const encoded = await media.keyProvider();
      if (!encoded) {
        return null;
      }
      return await crypto.subtle.importKey(
        "raw", fromBase64(encoded), "HKDF", false, ["deriveKey"]);
    } catch (error) {
      return null;
    }
  }

  /**
   * The AES key for one file.
   * @param {CryptoKey} bookKey
   * @param {string} id
   * @returns {Promise<CryptoKey>}
   */
  function deriveFileKey(bookKey, id) {
    const info = new TextEncoder().encode("file:" + id);
    return crypto.subtle.deriveKey(
      { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info },
      bookKey, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  }

  /**
   * Fetch and decrypt one file into an object URL.
   * @param {object} entry  { id, type }
   * @returns {Promise<string|null>}
   */
  async function openEncrypted(entry) {
    const bookKey = await getBookKey();
    if (!bookKey) {
      return null;
    }
    const base = (quiz.book.data && quiz.book.data.mediaBase) || "media/";
    const response = await fetch(base + entry.id + ".enc");
    if (!response.ok) {
      return null;
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    const fileKey = await deriveFileKey(bookKey, entry.id);
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bytes.slice(0, NONCE_BYTES),
        additionalData: new TextEncoder().encode(entry.id) },
      fileKey, bytes.slice(NONCE_BYTES));
    const blob = new Blob([plain], { type: entry.type || "image/webp" });
    return URL.createObjectURL(blob);
  }

  /**
   * A web address for one media entry, or null when it cannot be shown.
   * Never throws.
   * @param {object} entry
   * @returns {Promise<string|null>}
   */
  function load(entry) {
    if (entry.src) {
      return Promise.resolve(entry.src);
    }
    if (!entry.id) {
      return Promise.resolve(null);
    }
    if (!loaded.has(entry.id)) {
      loaded.set(entry.id, openEncrypted(entry).catch(function fail() {
        return null;
      }));
    }
    return loaded.get(entry.id);
  }

  /**
   * Start fetching entries so they are ready when the reader gets there.
   * @param {object[]} entries
   */
  function prefetch(entries) {
    (entries || []).forEach(load);
  }

  media.setKeyProvider = setKeyProvider;
  media.load = load;
  media.prefetch = prefetch;
  quiz.media = media;
})(window.RecallQuiz = window.RecallQuiz || {});
