/*
 * theme-picker.js
 * Light, dark or system mode, and the theme picker.
 *
 * This file is loaded in <head>, so the saved theme is applied before
 * the page is drawn (no flash of the wrong colours). The tiles are built
 * once the page has loaded.
 *
 * How themes are switched: the <html> element gets three attributes,
 *   data-theme="lego"      which theme
 *   data-mode="system"     what the reader chose: light, dark or system
 *   data-scheme="dark"     what is actually showing: light or dark
 * and css/themes.css has a block of colours for each theme and scheme.
 *
 * The list of themes comes from js/themes-list.js, which
 * tools/build_themes.py generates.
 */
(function setUpThemePicker() {
  "use strict";

  /** One saved choice for every book on this site */
  const STORAGE_KEY = "recall-quiz:theme";
  const DEFAULT_THEME = "classic";
  const DEFAULT_MODE = "system";

  const pageRoot = document.documentElement;
  const themes = window.QUIZ_THEMES || [[DEFAULT_THEME, "Classic"]];
  const darkModeQuery = window.matchMedia
    ? window.matchMedia("(prefers-color-scheme: dark)")
    : null;

  const MODES = ["light", "dark", "system"];

  /** The reader's choice: theme id and light / dark / system, and when
      they last picked it (0 if never; cloud sync keeps the newest) */
  const choice = readSavedChoice();

  /** @returns {{themeId: string, mode: string, at: number}} */
  function readSavedChoice() {
    const saved = { themeId: DEFAULT_THEME, mode: DEFAULT_MODE, at: 0 };
    try {
      // Stored as {t: themeId, m: mode, a: picked-at}; old saves have
      // no "a".
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      saved.themeId = stored.t || saved.themeId;
      saved.mode = stored.m || saved.mode;
      saved.at = Number(stored.a) || 0;
    } catch (storageError) {
      // Storage blocked: use the defaults.
    }
    if (!themes.some(isTheme(saved.themeId))) {
      saved.themeId = DEFAULT_THEME;
    }
    return saved;
  }

  /** @param {string} themeId  @returns {function(Array): boolean} */
  function isTheme(themeId) {
    return function matchesId(theme) {
      return theme[0] === themeId;
    };
  }

  /** Remember the choice in this browser (for every book on the site). */
  function saveChoice() {
    try {
      const stored = { t: choice.themeId, m: choice.mode, a: choice.at };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    } catch (storageError) {
      // Storage blocked: the choice lasts until the tab is closed.
    }
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
    showGroup(groupOf(choice.themeId));
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

  /** @returns {string} the group a theme is in */
  function groupOf(themeId) {
    const theme = themes.find(isTheme(themeId));
    return (theme && theme[2]) || "Themes";
  }

  /** Show only the tiles of one group, and mark its chip. */
  function showGroup(name) {
    document.querySelectorAll("#theme-tiles .theme-tile").forEach(
      function show(tile) {
        tile.classList.toggle("hidden",
          tile.getAttribute("data-group") !== name);
      });
    document.querySelectorAll("#theme-groups button").forEach(
      function mark(chip) {
        chip.setAttribute("aria-pressed",
          String(chip.getAttribute("data-group") === name));
      });
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
    themes.forEach(function addTile(theme) {
      tileArea.appendChild(
        createThemeTile(theme[0], theme[1], theme[2] || "Themes"));
    });
    const groupArea = document.getElementById("theme-groups");
    groupNames().forEach(function addChip(name) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.textContent = name;
      chip.setAttribute("data-group", name);
      chip.addEventListener("click", function chooseGroup() {
        showGroup(name);
      });
      groupArea.appendChild(chip);
    });
    showGroup(groupOf(choice.themeId));
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
  };

  applyChoice();          // before the page is drawn
  loadThemeFonts();
  document.addEventListener("DOMContentLoaded", setUpPicker);
})();
