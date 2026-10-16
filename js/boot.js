/*
 * boot.js
 * Starts a book site whose own index.html is only a favicon and this
 * script (written by tools/make_book_index.py).
 *
 * It downloads this template's index.html from the same CDN folder it was
 * loaded from, points every css/, js/ and htrab/ address in it at that
 * folder, and replaces the page with it. From then on the page behaves
 * exactly as if index.html had been opened directly: the scripts run in
 * the same order, DOMContentLoaded fires as usual, and the book's own
 * files (questions.json, images/, media/, banks/) are still asked for
 * from the book's own site, because the address of the page has not
 * changed.
 *
 * The page is replaced with document.write, the one way to get the exact
 * start-up order of a normal page. Chrome may refuse to run such scripts
 * on a very slow (2G) connection, which this site could not use anyway.
 *
 * It is meant to be loaded from a CDN, as
 * <script src=".../recall-quiz-site-template@2.1.0/js/boot.js">.
 */
(function bootFromCdn() {
  "use strict";

  const THIS_FILE = "js/boot.js";
  const PAGE_FILE = "index.html";
  /** Addresses in the template's page that point at shared files */
  const SHARED_ADDRESS = /(\b(?:href|src)=")(css|js|htrab)\//g;
  /** Only known while this script is running, not in later callbacks */
  const thisScript = document.currentScript;

  /**
   * @returns {string} the CDN folder this script came from, ending in "/"
   *   (for example https://cdn.jsdelivr.net/gh/user/repo@2.1.0/)
   */
  function templateFolder() {
    const address = thisScript ? thisScript.src : "";
    if (!address.endsWith("/" + THIS_FILE)) {
      throw new Error("boot.js was not loaded as " + THIS_FILE);
    }
    return address.slice(0, -THIS_FILE.length);
  }

  /**
   * @param {string} page    the template's index.html
   * @param {string} folder  the CDN folder, ending in "/"
   * @returns {string} the page with the folder put in front of every
   *   css/, js/ and htrab/ address
   */
  function pointAtFolder(page, folder) {
    return page.replace(SHARED_ADDRESS,
      function addFolder(match, start, directory) {
        return start + folder + directory + "/";
      });
  }

  /**
   * Download the template's page.
   * @param {string} folder  the CDN folder, ending in "/"
   * @returns {Promise<string>} the page, ready to show
   */
  function loadPage(folder) {
    return fetch(folder + PAGE_FILE).then(function read(response) {
      if (!response.ok) {
        throw new Error("HTTP " + response.status);
      }
      return response.text();
    }).then(function prepare(page) {
      return pointAtFolder(page, folder);
    });
  }

  /** @param {string} page  replace this page with the given one */
  function showPage(page) {
    document.open();
    document.write(page);
    document.close();
  }

  /** @param {Error} problem  tell the reader the quiz did not start */
  function showProblem(problem) {
    const note = document.createElement("p");
    note.setAttribute("role", "alert");
    note.textContent = "The quiz could not be loaded (" + problem.message +
      "). Check your connection and reload the page.";
    (document.body || document.documentElement).appendChild(note);
  }

  Promise.resolve()
    .then(function start() {
      return loadPage(templateFolder());
    })
    .then(showPage)
    .catch(showProblem);
})();
