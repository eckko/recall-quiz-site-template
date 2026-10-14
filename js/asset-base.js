/*
 * asset-base.js
 * Says where the site's shared files (css/, js/, htrab/, vendor/) are.
 *
 * Normally they sit next to index.html and the base is "": every path is
 * relative to the page. When this script itself was loaded from another
 * site, such as a CDN, the shared files sit beside it, so the base is
 * that address. A book site can then hold only index.html, questions.json
 * and images/, and every other file comes from one tagged copy of the
 * template (see tools/make_book_index.py).
 *
 * The book's own files (questions.json, images/, media/, banks/) are never
 * prefixed: they always come from the page's own site.
 *
 * To force a base, set window.RecallQuizAssetBase before this file loads.
 * It must be "" or end with "/". Load this file first, in <head>.
 */
(function setUpAssetBase() {
  "use strict";

  const THIS_FILE = "js/asset-base.js";

  /**
   * @returns {string} the folder that holds js/, css/ and the rest, when
   *   this script came from another site; "" when it came from the
   *   page's own site (or from a folder, via file://)
   */
  function baseFromThisScript() {
    const script = document.currentScript;
    if (!script || !script.src) {
      return "";
    }
    const address = new URL(script.src, window.location.href);
    const isSameSite = address.origin === window.location.origin;
    if (isSameSite || !address.pathname.endsWith("/" + THIS_FILE)) {
      return "";
    }
    return address.origin +
      address.pathname.slice(0, -THIS_FILE.length);
  }

  if (typeof window.RecallQuizAssetBase !== "string") {
    window.RecallQuizAssetBase = baseFromThisScript();
  }
})();
