/*
 * reading-settings.js
 * How the text looks: font size, font, line spacing, page width, page
 * colour and text colour. The quiz and the ereader share this file, so
 * a reader who sets them in one view finds them the same in the other.
 *
 * The choices are saved per book (recall-quiz:reading:<book id>) and
 * written onto <html> where css/base.css, css/reading-panel.css and
 * reader/style.css pick them up:
 *   --reading-font-size   e.g. "18px"
 *   --reading-line-height e.g. "1.6" (only for tight and loose)
 *   data-reading-font     serif, sans or theme (the theme's own font)
 *   data-width            narrow or wide (normal sets nothing)
 *   --color-page, --color-card, --color-text, ... when the reader picked
 *   a page or text colour (they replace the theme's colours, so every
 *   part of the page stays readable)
 *
 * The view says what "normal" means for it with configure(): the quiz
 * starts at 16px in the theme's font, the ereader at 18px in a serif.
 * Another file reacts to changes by listening for
 * "recallquiz:reading-changed" on document.
 */
(function setUpReadingSettings(quiz) {
  "use strict";

  /** Saved per book: this prefix plus the book id */
  const STORAGE_PREFIX = "recall-quiz:reading:";
  /** Used before a book is known */
  const FALLBACK_KEY = "recall-quiz:reading";
  /** Version of the saved choice; bump it when the format changes */
  const STORED_VERSION = 1;

  const FONT_SIZE_MIN = 14;
  const FONT_SIZE_MAX = 28;
  const FONT_CHOICES = ["serif", "sans", "theme"];
  const LINE_SPACING_CHOICES = ["tight", "normal", "loose"];
  const WIDTH_CHOICES = ["narrow", "normal", "wide"];
  /** Line height for the two choices that differ from the view's own */
  const LINE_HEIGHT_OF = { tight: "1.35", loose: "1.9" };

  /** Page colours offered (the first is white) */
  const BACKGROUND_COLOURS = ["#ffffff", "#faf8f3", "#f4ecd8", "#e6eefb",
    "#dde8dc", "#2b2b2b", "#17130e", "#000000"];
  /** Text colours offered */
  const TEXT_COLOURS = ["#ffffff", "#000000", "#232019", "#4a3a2a",
    "#1f3a5f", "#3b3b3b", "#d6d6d6", "#efe5d3", "#f2c879"];
  /** Theme colours a chosen page or text colour replaces */
  const COLOUR_PROPERTIES = ["--color-page", "--color-card",
    "--color-text", "--color-text-muted", "--color-border",
    "--page-background"];
  /** A page colour at least this bright gets dark text by itself */
  const LIGHT_PAGE_FROM = 0.5;
  const DARK_TEXT = "#121826";
  const LIGHT_TEXT = "#f2f2f2";

  const pageRoot = document.documentElement;

  /** What "normal" is for the view that is open */
  let viewDefaults = { fontSize: 16, font: "theme" };
  /** The open book ("" until known) */
  let bookId = "";
  /** The reader's choices; null or "" means "the view's own" */
  let choices = emptyChoices();

  /** @returns {object} choices with nothing picked */
  function emptyChoices() {
    return { fontSize: null, font: null, lineSpacing: null, width: null,
      page: "", text: "" };
  }

  /** @returns {string} the localStorage key for the open book */
  function storageKey() {
    return bookId ? STORAGE_PREFIX + bookId : FALLBACK_KEY;
  }

  /**
   * Read the saved choices of the open book.
   * @returns {object} choices (nothing picked if none or unreadable)
   */
  function readSaved() {
    const saved = emptyChoices();
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey()));
      if (!stored || typeof stored !== "object" ||
          Number(stored.v) > STORED_VERSION) {
        return saved;
      }
      keepValid(saved, stored);
    } catch (storageError) {
      // Storage blocked or damaged: use the view's own look.
    }
    return saved;
  }

  /**
   * Copy the parts of a stored object that are valid.
   * @param {object} target  choices, changed in place
   * @param {object} stored  what was in storage
   */
  function keepValid(target, stored) {
    const size = Number(stored.fontSize);
    if (size >= FONT_SIZE_MIN && size <= FONT_SIZE_MAX) {
      target.fontSize = Math.round(size);
    }
    if (FONT_CHOICES.includes(stored.font)) {
      target.font = stored.font;
    }
    if (LINE_SPACING_CHOICES.includes(stored.lineSpacing)) {
      target.lineSpacing = stored.lineSpacing;
    }
    if (WIDTH_CHOICES.includes(stored.width)) {
      target.width = stored.width;
    }
    target.page = isColour(stored.page) ? stored.page : "";
    target.text = isColour(stored.text) ? stored.text : "";
  }

  /**
   * @param {*} value
   * @returns {boolean} true for a "#rrggbb" colour
   */
  function isColour(value) {
    return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
  }

  /** Remember the choices in this browser. */
  function save() {
    const text = JSON.stringify(Object.assign({ v: STORED_VERSION },
      choices));
    try {
      localStorage.setItem(storageKey(), text);
    } catch (storageError) {
      // Storage blocked: the choices last until the tab is closed.
    }
  }

  // ----------------------------------------------------------- reading

  /**
   * What is in force right now: the reader's choice, or the view's own.
   * @returns {{fontSize: number, font: string, lineSpacing: string,
   *   width: string, page: string, text: string}}
   */
  function current() {
    return {
      fontSize: choices.fontSize || viewDefaults.fontSize,
      font: choices.font || viewDefaults.font,
      lineSpacing: choices.lineSpacing || "normal",
      width: choices.width || "normal",
      page: choices.page,
      text: choices.text,
    };
  }

  // ----------------------------------------------------------- colours

  /**
   * How bright a colour looks, from 0 (black) to 1 (white).
   * @param {string} colour  "#rrggbb"
   * @returns {number}
   */
  function brightnessOf(colour) {
    const red = parseInt(colour.slice(1, 3), 16);
    const green = parseInt(colour.slice(3, 5), 16);
    const blue = parseInt(colour.slice(5, 7), 16);
    return (0.299 * red + 0.587 * green + 0.114 * blue) / 255;
  }

  /**
   * The theme colours to replace so the page and text colour the reader
   * picked work together (cards, borders and muted text follow them).
   * @param {string} page  "#rrggbb" or ""
   * @param {string} text  "#rrggbb" or ""
   * @returns {object} custom property name to value
   */
  function coloursFor(page, text) {
    const values = {};
    if (!page && !text) {
      return values;
    }
    const pageColour = page || "var(--color-page)";
    const textColour = text || (brightnessOf(page) >= LIGHT_PAGE_FROM
      ? DARK_TEXT : LIGHT_TEXT);
    if (page) {
      values["--color-page"] = page;
      values["--page-background"] = page;
      values["--color-card"] =
        "color-mix(in srgb, " + page + " 93%, " + textColour + " 7%)";
    }
    values["--color-text"] = textColour;
    values["--color-text-muted"] =
      "color-mix(in srgb, " + textColour + " 62%, " + pageColour + " 38%)";
    values["--color-border"] =
      "color-mix(in srgb, " + pageColour + " 80%, " + textColour + " 20%)";
    return values;
  }

  // ----------------------------------------------------------- applying

  /** Put the choices on the page. */
  function apply() {
    const now = current();
    pageRoot.style.setProperty("--reading-font-size", now.fontSize + "px");
    pageRoot.setAttribute("data-reading-font", now.font);
    pageRoot.setAttribute("data-width", now.width);
    if (LINE_HEIGHT_OF[now.lineSpacing]) {
      pageRoot.style.setProperty("--reading-line-height",
        LINE_HEIGHT_OF[now.lineSpacing]);
    } else {
      pageRoot.style.removeProperty("--reading-line-height");
    }
    applyColours(coloursFor(now.page, now.text));
    document.dispatchEvent(new CustomEvent("recallquiz:reading-changed"));
  }

  /**
   * Set the replaced theme colours, and clear the ones not replaced.
   * @param {object} values  custom property name to value
   */
  function applyColours(values) {
    COLOUR_PROPERTIES.forEach(function setOrClear(name) {
      if (values[name]) {
        pageRoot.style.setProperty(name, values[name]);
      } else {
        pageRoot.style.removeProperty(name);
      }
    });
  }

  // ------------------------------------------------------------ changes

  /**
   * Say what "normal" is for this view, then show the choices.
   * @param {{fontSize: number, font: string}} defaults
   */
  function configure(defaults) {
    viewDefaults = Object.assign({}, viewDefaults, defaults);
    apply();
  }

  /**
   * A book was opened: use the choices saved for it.
   * @param {string} newBookId
   */
  function useBook(newBookId) {
    bookId = newBookId;
    choices = readSaved();
    apply();
  }

  /**
   * Change one choice, save it and show it.
   * @param {"fontSize"|"font"|"lineSpacing"|"width"|"page"|"text"} name
   * @param {number|string|null} value  null or "" goes back to normal
   */
  function change(name, value) {
    const copy = Object.assign({}, choices);
    copy[name] = value;
    const clean = emptyChoices();
    keepValid(clean, copy);
    choices = clean;
    save();
    apply();
  }

  /** Forget every choice: the view's own look again. */
  function reset() {
    choices = emptyChoices();
    save();
    apply();
  }

  quiz.reading = {
    configure,
    useBook,
    current,
    change,
    reset,
    FONT_SIZE_MIN,
    FONT_SIZE_MAX,
    BACKGROUND_COLOURS,
    TEXT_COLOURS,
  };
})((window.RecallQuiz = window.RecallQuiz || {}));
