/*
 * theme-picker.js
 * Light, dark or system mode, and the theme picker.
 *
 * This file is loaded in <head>, so the last theme shown is applied before
 * the page is drawn (no flash of the wrong colours). The tiles are built
 * once the page has loaded. Once a book is open (useBook) the theme is the
 * one saved for THAT book, so every book can look different; a book with
 * nothing saved starts from the default theme.
 *
 * How themes are switched: the <html> element gets three attributes,
 *   data-theme="lego"      which theme
 *   data-mode="system"     what the reader chose: light, dark or system
 *   data-scheme="dark"     what is actually showing: light or dark
 * and css/themes.css has a block of colours for each theme and scheme.
 *
 * The list of themes comes from js/themes-list.js, which
 * tools/build_themes.py generates. The first-time theme and mode come from
 * js/default-settings.js, which must be loaded first.
 */
(function setUpThemePicker() {
  "use strict";

  /** The theme shown last, used to paint the page before a book is open */
  const STORAGE_KEY = "recall-quiz:theme";
  /** One saved choice per book: this prefix plus the book id */
  const BOOK_KEY_PREFIX = "recall-quiz:theme:";
  /** Version of the saved choice {v, t, m, a}; bump it with a step in
      readStoredChoice when the format changes */
  const STORED_VERSION = 1;
  /** The first-time look comes from js/default-settings.js */
  const DEFAULTS = window.RecallQuizDefaults;
  const DEFAULT_THEME = DEFAULTS.theme.id;
  const DEFAULT_MODE = DEFAULTS.theme.mode;

  const pageRoot = document.documentElement;
  const themes = window.QUIZ_THEMES || [[DEFAULT_THEME, DEFAULT_THEME]];
  const darkModeQuery = window.matchMedia
    ? window.matchMedia("(prefers-color-scheme: dark)")
    : null;

  const MODES = ["light", "dark", "system"];

  /** The open book's id ("" before a book is open) */
  let bookId = "";
  /** True when this book's saved choice comes from a newer version of
      this code; it is then never overwritten */
  let isSavedChoiceNewer = false;

  /** The reader's choice: theme id and light / dark / system, and when
      they last picked it (0 if never; cloud sync keeps the newest) */
  const choice = readSavedChoice(STORAGE_KEY);
  /**
   * Read a saved choice, or the defaults.
   * @param {string} key  the localStorage key
   * @returns {{themeId: string, mode: string, at: number}}
   */
  function readSavedChoice(key) {
    const saved = { themeId: DEFAULT_THEME, mode: DEFAULT_MODE, at: 0 };
    const stored = readStoredChoice(key);
    if (stored) {
      saved.themeId = stored.t || saved.themeId;
      saved.mode = MODES.includes(stored.m) ? stored.m : saved.mode;
      saved.at = Number(stored.a) || 0;
    }
    if (!themes.some(isTheme(saved.themeId))) {
      saved.themeId = DEFAULT_THEME;
    }
    return saved;
  }

  /**
   * The parsed saved choice {v, t, m, a}, upgraded to this version
   * (version 1 is the format without a "v"). Nothing yet needs
   * converting; add a step here when the format changes.
   * @param {string} key
   * @returns {object|null} null when nothing readable is saved
   */
  function readStoredChoice(key) {
    try {
      const stored = JSON.parse(localStorage.getItem(key));
      if (!stored || typeof stored !== "object") {
        return null;
      }
      if (Number(stored.v) > STORED_VERSION) {
        isSavedChoiceNewer = true;
        return null;
      }
      return stored;
    } catch (storageError) {
      return null;       // Storage blocked or damaged: use the defaults.
    }
  }

  /** @param {string} themeId  @returns {function(Array): boolean} */
  function isTheme(themeId) {
    return function matchesId(theme) {
      return theme[0] === themeId;
    };
  }

  /** Remember the choice in this browser: for the open book, and as the
      theme to paint first next time. */
  function saveChoice() {
    const text = JSON.stringify({ v: STORED_VERSION, t: choice.themeId,
      m: choice.mode, a: choice.at });
    try {
      localStorage.setItem(STORAGE_KEY, text);
      if (bookId && !isSavedChoiceNewer) {
        localStorage.setItem(BOOK_KEY_PREFIX + bookId, text);
      }
    } catch (storageError) {
      // Storage blocked: the choice lasts until the tab is closed.
    }
  }

  /**
   * A book was opened: use the theme saved for it, or the defaults.
   * @param {string} newBookId
   */
  function useBook(newBookId) {
    bookId = newBookId;
    isSavedChoiceNewer = false;
    const saved = readSavedChoice(BOOK_KEY_PREFIX + bookId);
    choice.themeId = saved.themeId;
    choice.mode = saved.mode;
    choice.at = saved.at;
    applyChoice();
  }

  /** @returns {boolean} true if the page should be dark right now */
  function shouldBeDark() {
    if (choice.mode === "system") {
      return Boolean(darkModeQuery && darkModeQuery.matches);
    }
    return choice.mode === "dark";
  }

  /** Switch the page to the chosen theme and mode, and save it. */
  function applyChoice() {
    pageRoot.setAttribute("data-theme", choice.themeId);
    pageRoot.setAttribute("data-mode", choice.mode);
    pageRoot.setAttribute("data-scheme", shouldBeDark() ? "dark" : "light");
    saveChoice();
    markPressedButtons();
  }

  /**
   * The reader picked a theme or mode: stamp the time, apply it and tell
   * cloud sync (it listens for recallquiz:theme-changed).
   */
  function applyChoiceFromReader() {
    choice.at = Date.now();
    applyChoice();
    document.dispatchEvent(new CustomEvent("recallquiz:theme-changed"));
  }

  /**
   * Use a choice saved in the reader's account if it is newer than the
   * one in this browser.
   * @param {{themeId: string, mode: string, at: number}} remote
   * @returns {boolean} true if it was used
   */
  function useRemoteChoice(remote) {
    const isValid = remote && themes.some(isTheme(remote.themeId)) &&
      MODES.includes(remote.mode);
    if (!isValid || !(remote.at > choice.at)) {
      return false;
    }
    choice.themeId = remote.themeId;
    choice.mode = remote.mode;
    choice.at = remote.at;
    applyChoice();
    return true;
  }

  /** Show which mode button and which tile are chosen. */
  function markPressedButtons() {
    const current = document.getElementById("appearance-current");
    if (current) {
      const theme = themes.find(isTheme(choice.themeId));
      current.textContent = (theme ? theme[1] : "") + " · " +
        choice.mode.charAt(0).toUpperCase() + choice.mode.slice(1);
    }
    document.querySelectorAll("#theme-mode-choice button").forEach(
      function markModeButton(button) {
        const mode = button.getAttribute("data-theme-mode");
        button.setAttribute("aria-pressed", String(mode === choice.mode));
      });
    document.querySelectorAll("#theme-tiles .theme-tile").forEach(
      function markTile(tile) {
        const themeId = tile.getAttribute("data-theme-id");
        tile.setAttribute("aria-pressed", String(themeId === choice.themeId));
      });
    document.querySelectorAll("#theme-tiles .theme-group").forEach(
      function markGroup(group) {
        group.classList.toggle("has-current", Boolean(group.querySelector(
          '.theme-tile[aria-pressed="true"]')));
      });
  }

  /** Load the fonts the themes use (one request to Google Fonts). */
  function loadThemeFonts() {
    if (!window.QUIZ_THEME_FONTS_URL) {
      return;
    }
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = window.QUIZ_THEME_FONTS_URL;
    document.head.appendChild(link);
  }

  /** @returns {string[]} the theme groups, in picker order */
  function groupNames() {
    const names = [];
    themes.forEach(function add(theme) {
      const name = theme[2] || "Themes";
      if (names.indexOf(name) < 0) {
        names.push(name);
      }
    });
    return names;
  }

  /**
   * One folded group of tiles: a heading with the group's name and how
   * many themes it holds, and the tiles inside.
   * @param {string} name  the group
   * @returns {{group: HTMLElement, tiles: HTMLElement}}
   */
  function createThemeGroup(name) {
    const group = createPart("details", "theme-group");
    group.setAttribute("data-group", name);
    const heading = createPart("summary", "theme-group-name");
    heading.appendChild(createPart("span", null, name));
    const count = themes.filter(function inGroup(theme) {
      return (theme[2] || "Themes") === name;
    }).length;
    heading.appendChild(createPart("small", null, String(count)));
    group.appendChild(heading);
    const tiles = createPart("div", "theme-group-tiles");
    group.appendChild(tiles);
    return { group, tiles };
  }

  /**
   * A preview tile: mascot, three colour dots, a button and the name.
   * The colours come from css/themes.css, by data-theme-id.
   * @param {string} themeId
   * @param {string} themeName
   * @returns {HTMLButtonElement}
   */
  function createThemeTile(themeId, themeName, groupName) {
    const tile = document.createElement("button");
    tile.type = "button";
    tile.className = "theme-tile";
    tile.setAttribute("data-theme-id", themeId);
    tile.setAttribute("data-group", groupName);
    tile.appendChild(createPart("div", "tile-mascot"));
    const swatches = createPart("div", "tile-swatches");
    swatches.appendChild(createPart("i"));
    swatches.appendChild(createPart("i"));
    swatches.appendChild(createPart("i"));
    tile.appendChild(swatches);
    tile.appendChild(createPart("div", "tile-button", "Go"));
    tile.appendChild(createPart("div", "tile-name", themeName));
    tile.addEventListener("click", function chooseTheme() {
      choice.themeId = themeId;
      applyChoiceFromReader();
    });
    return tile;
  }

  /**
   * Create one part of a tile (theme-picker.js loads before helpers.js,
   * so it has its own small element maker).
   * @param {string} tagName
   * @param {string} [className]
   * @param {string} [text]
   * @returns {HTMLElement}
   */
  function createPart(tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) {
      element.className = className;
    }
    if (text) {
      element.textContent = text;
    }
    return element;
  }

  /**
   * Call a function when the device switches between light and dark.
   * (Safari before version 14 only has the older addListener.)
   * @param {Function} onChange
   */
  function listenForSystemModeChanges(onChange) {
    if (darkModeQuery.addEventListener) {
      darkModeQuery.addEventListener("change", onChange);
    } else {
      darkModeQuery.addListener(onChange);
    }
  }

  /** Build the tiles and connect the buttons. Runs once the page loads. */
  function setUpPicker() {
    const tileArea = document.getElementById("theme-tiles");
    if (!tileArea) {
      return;
    }
    groupNames().forEach(function addGroup(name) {
      const parts = createThemeGroup(name);
      themes.forEach(function addTile(theme) {
        if ((theme[2] || "Themes") === name) {
          parts.tiles.appendChild(
            createThemeTile(theme[0], theme[1], name));
        }
      });
      tileArea.appendChild(parts.group);
    });
    document.querySelectorAll("#theme-mode-choice button").forEach(
      function connectModeButton(button) {
        button.addEventListener("click", function chooseMode() {
          choice.mode = button.getAttribute("data-theme-mode");
          applyChoiceFromReader();
        });
      });
    if (darkModeQuery) {
      listenForSystemModeChanges(function followSystem() {
        if (choice.mode === "system") {
          applyChoice();
        }
      });
    }
    applyChoice();
  }

  /** Lets js/sync/cloud-sync.js save and restore the choice. */
  window.RecallQuizTheme = {
    read: function readChoice() {
      return { themeId: choice.themeId, mode: choice.mode, at: choice.at };
    },
    useRemote: useRemoteChoice,
    useBook,
  };

  applyChoice();          // before the page is drawn
  loadThemeFonts();
  document.addEventListener("DOMContentLoaded", setUpPicker);
})();
