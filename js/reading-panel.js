/*
 * reading-panel.js
 * The round gear button in the bottom right corner and the "Reading
 * settings" panel it opens. The quiz and the ereader both use it, so
 * the two views look and work the same.
 *
 * The panel holds mode and theme, font size, font, line spacing, page
 * width, page colour and text colour (js/reading-settings.js keeps and
 * applies them). A view can add sections of its own (the ereader adds
 * "Show"). The bottom row has Reset, "Subject page" and a button back
 * to the view's own home ("Book home" or "Quiz home").
 *
 * Needs js/helpers.js, js/reading-settings.js and js/theme-picker.js
 * (window.RecallQuizTheme) to be loaded.
 */
(function setUpReadingPanel(quiz) {
  "use strict";

  const { createElement, createButton } = quiz.helpers;

  const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
  /** The outline of the gear icon (24 by 24) */
  const GEAR_PATH = "M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM19.4 " +
    "13.5l1.6 1.2-1.8 3.1-1.9-.6a7.5 7.5 0 0 1-1.7 1l-.4 2h-3.6l-.4-2a7.5 " +
    "7.5 0 0 1-1.7-1l-1.9.6L5 14.7l1.6-1.2a7.6 7.6 0 0 1 0-3L5 9.3l1.8-3.1 " +
    "1.9.6a7.5 7.5 0 0 1 1.7-1l.4-2h3.6l.4 2a7.5 7.5 0 0 1 1.7 1l1.9-.6L21 " +
    "9.3l-1.6 1.2a7.6 7.6 0 0 1 0 3z";

  const MODE_CHOICES = [["light", "Light"], ["dark", "Dark"],
    ["system", "System"]];
  const FONT_CHOICES = [["serif", "Serif"], ["sans", "Sans"],
    ["theme", "Theme font"]];
  const LINE_SPACING_CHOICES = [["tight", "Tight"], ["normal", "Normal"],
    ["loose", "Loose"]];
  const WIDTH_CHOICES = [["narrow", "Narrow"], ["normal", "Normal"],
    ["wide", "Wide"]];
  const WHITE = "#ffffff";

  /**
   * The gear icon.
   * @returns {SVGElement}
   */
  function createGearIcon() {
    const icon = document.createElementNS(SVG_NAMESPACE, "svg");
    icon.setAttribute("viewBox", "0 0 24 24");
    icon.setAttribute("width", "24");
    icon.setAttribute("height", "24");
    icon.setAttribute("aria-hidden", "true");
    const path = document.createElementNS(SVG_NAMESPACE, "path");
    path.setAttribute("d", GEAR_PATH);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "1.8");
    path.setAttribute("stroke-linejoin", "round");
    icon.appendChild(path);
    return icon;
  }

  /**
   * A row of buttons where one is chosen.
   * @param {string[][]} choices  [value, label] pairs
   * @param {string} chosen  the value that is on
   * @param {function(string): void} onPick
   * @returns {HTMLElement}
   */
  function createChoiceRow(choices, chosen, onPick) {
    const row = createElement("div", "reading-choices");
    choices.forEach(function addChoice(choice) {
      const button = createButton(choice[1], "", function pick() {
        onPick(choice[0]);
      });
      button.setAttribute("aria-pressed", String(choice[0] === chosen));
      row.appendChild(button);
    });
    return row;
  }

  /**
   * A row of round colour buttons. Pressing the chosen one again goes
   * back to the theme's colour.
   * @param {string[]} colours
   * @param {string} chosen  "" when none is chosen
   * @param {string} what  "Background" or "Text colour", for the labels
   * @param {function(string): void} onPick  gets "" to clear
   * @param {boolean} [isWhiteNamed]  write "White" under the white swatch
   * @returns {HTMLElement}
   */
  function createSwatchRow(colours, chosen, what, onPick, isWhiteNamed) {
    const row = createElement("div", "reading-swatches");
    colours.forEach(function addSwatch(colour) {
      const swatch = createButton("", "reading-swatch", function pick() {
        onPick(colour === chosen ? "" : colour);
      });
      swatch.style.background = colour;
      const name = colour === WHITE ? "White" : colour;
      swatch.setAttribute("aria-label", what + " " + name);
      swatch.title = name;
      if (isWhiteNamed && colour === WHITE) {
        swatch.setAttribute("data-caption", name);
      }
      swatch.setAttribute("aria-pressed", String(colour === chosen));
      row.appendChild(swatch);
    });
    return row;
  }

  /**
   * The font size slider with a small and a large A on its sides.
   * @param {number} size  px
   * @returns {HTMLElement}
   */
  function createSizeRow(size) {
    const row = createElement("div", "reading-size");
    row.appendChild(createElement("span", "reading-size-small", "A"));
    const slider = createElement("input");
    slider.type = "range";
    slider.min = String(quiz.reading.FONT_SIZE_MIN);
    slider.max = String(quiz.reading.FONT_SIZE_MAX);
    slider.step = "1";
    slider.value = String(size);
    slider.setAttribute("aria-label", "Font size");
    const value = createElement("span", "reading-size-value", size + " px");
    slider.addEventListener("input", function resize() {
      value.textContent = slider.value + " px";
      quiz.reading.change("fontSize", Number(slider.value));
    });
    row.appendChild(slider);
    row.appendChild(createElement("span", "reading-size-large", "A"));
    row.appendChild(value);
    return row;
  }

  /**
   * One theme to pick: a small preview in the theme's own colours (from
   * css/theme-tiles.css) and its name.
   * @param {string[]} theme  [id, name, group]
   * @param {boolean} isChosen
   * @returns {HTMLElement}
   */
  function createThemeTile(theme, isChosen) {
    const tile = createButton("", "theme-tile reading-theme", function pick() {
      window.RecallQuizTheme.chooseTheme(theme[0]);
      markChosenTheme(tile.parentNode);
    });
    tile.setAttribute("data-theme-id", theme[0]);
    tile.setAttribute("aria-pressed", String(isChosen));
    const sample = createElement("i", "reading-theme-sample");
    sample.appendChild(createElement("b"));
    tile.appendChild(sample);
    tile.appendChild(createElement("span", null, theme[1]));
    return tile;
  }

  /**
   * Mark the tile of the theme in use.
   * @param {HTMLElement} strip  the tiles' container
   */
  function markChosenTheme(strip) {
    const chosenId = window.RecallQuizTheme.read().themeId;
    strip.querySelectorAll(".reading-theme").forEach(
      function mark(tile) {
        const isChosen = tile.getAttribute("data-theme-id") === chosenId;
        tile.setAttribute("aria-pressed", String(isChosen));
      });
  }

  /**
   * The scrolling row of theme tiles, scrolled to the theme in use.
   * @returns {HTMLElement}
   */
  function createThemeStrip() {
    const strip = createElement("div", "reading-themes");
    const chosenId = window.RecallQuizTheme.read().themeId;
    window.RecallQuizTheme.themes.forEach(function add(theme) {
      strip.appendChild(createThemeTile(theme, theme[0] === chosenId));
    });
    return strip;
  }

  /**
   * Scroll a strip so its chosen tile shows (only the strip moves).
   * @param {HTMLElement} strip
   */
  function showChosenTile(strip) {
    const chosen = strip.querySelector('[aria-pressed="true"]');
    if (chosen) {
      strip.scrollLeft = chosen.offsetLeft - chosen.offsetWidth;
    }
  }

  /**
   * Make the panel and the gear button.
   * @param {{homeLabel: string, onHome: function(): void,
   *   subjectPageAddress: string|null,
   *   addSections: function(HTMLElement, function(): void): void,
   *   onReset: function(): void}} options
   *   homeLabel is the last button ("Book home" or "Quiz home");
   *   subjectPageAddress is where "Subject page" goes (no button if
   *   null); addSections adds the view's own sections to the panel
   *   and gets a function that redraws the panel; onReset runs after
   *   Reset
   * @returns {{close: function(): void, redraw: function(): void}}
   */
  function create(options) {
    const gear = createButton("", "reading-gear", togglePanel);
    gear.id = "reading-gear";
    gear.setAttribute("aria-label", "Reading settings");
    gear.setAttribute("aria-expanded", "false");
    gear.setAttribute("aria-controls", "reading-panel");
    gear.appendChild(createGearIcon());

    const panel = createElement("section", "reading-panel hidden");
    panel.id = "reading-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Reading settings");
    const head = createElement("div", "reading-panel-head");
    head.appendChild(createElement("h3", null, "Reading settings"));
    const body = createElement("div", "reading-panel-body");
    const foot = createElement("div", "reading-panel-foot");
    panel.appendChild(head);
    panel.appendChild(body);
    panel.appendChild(foot);
    document.body.appendChild(panel);
    document.body.appendChild(gear);

    /** Build the sections again, keeping the scroll positions. */
    function redraw() {
      const scrolled = body.scrollTop;
      body.textContent = "";
      addAppearanceSections(body, redraw);
      if (options.addSections) {
        options.addSections(body, redraw);
      }
      body.scrollTop = scrolled;
      showChosenTile(body.querySelector(".reading-themes"));
    }

    /** Reset everything this panel controls. */
    function resetAll() {
      quiz.reading.reset();
      window.RecallQuizTheme.chooseDefaults();
      if (options.onReset) {
        options.onReset();
      }
      redraw();
    }

    /** Open the panel if it is shut, shut it if it is open. */
    function togglePanel() {
      setOpen(panel.classList.contains("hidden"));
    }

    /**
     * @param {boolean} shouldOpen
     */
    function setOpen(shouldOpen) {
      panel.classList.toggle("hidden", !shouldOpen);
      gear.setAttribute("aria-expanded", String(shouldOpen));
      if (shouldOpen) {
        window.RecallQuizTheme.loadPickerAssets();
        redraw();
      }
    }

    /** Close the panel. */
    function close() {
      setOpen(false);
    }

    foot.appendChild(createButton("Reset", "reading-reset", resetAll));
    if (options.subjectPageAddress) {
      foot.appendChild(createButton("Subject page", "", function leave() {
        window.location.href = options.subjectPageAddress;
      }));
    }
    foot.appendChild(createButton(options.homeLabel, "", function goHome() {
      close();
      options.onHome();
    }));

    document.addEventListener("keydown", function closeOnEscape(event) {
      if (event.key === "Escape") {
        close();
      }
    });
    document.addEventListener("click", function closeOnOutsideClick(event) {
      const path = event.composedPath();
      const isInside = path.includes(panel) || path.includes(gear);
      if (!isInside && !panel.classList.contains("hidden")) {
        close();
      }
    });
    return { close, redraw };
  }

  /**
   * Add a section title and its controls.
   * @param {HTMLElement} body
   * @param {string} title
   * @param {HTMLElement} controls
   */
  function addSection(body, title, controls) {
    body.appendChild(createElement("h4", null, title));
    body.appendChild(controls);
  }

  /**
   * Mode, theme, size, font, spacing, width and the two colours.
   * @param {HTMLElement} body
   * @param {function(): void} redraw
   */
  function addAppearanceSections(body, redraw) {
    const now = quiz.reading.current();
    const theme = window.RecallQuizTheme.read();
    addSection(body, "Mode", createChoiceRow(MODE_CHOICES, theme.mode,
      function pickMode(mode) {
        window.RecallQuizTheme.chooseMode(mode);
        redraw();
      }));
    addSection(body, "Theme", createThemeStrip());
    addSection(body, "Font size", createSizeRow(now.fontSize));
    addSection(body, "Font", createChoiceRow(FONT_CHOICES, now.font,
      function pickFont(font) {
        quiz.reading.change("font", font);
        redraw();
      }));
    addSection(body, "Line spacing", createChoiceRow(LINE_SPACING_CHOICES,
      now.lineSpacing, function pickSpacing(spacing) {
        quiz.reading.change("lineSpacing", spacing);
        redraw();
      }));
    addSection(body, "Page width", createChoiceRow(WIDTH_CHOICES,
      now.width, function pickWidth(width) {
        quiz.reading.change("width", width);
        redraw();
      }));
    addSection(body, "Background", createSwatchRow(
      quiz.reading.BACKGROUND_COLOURS, now.page, "Background",
      function pickPage(colour) {
        quiz.reading.change("page", colour);
        redraw();
      }, true));
    addSection(body, "Text colour", createSwatchRow(
      quiz.reading.TEXT_COLOURS, now.text, "Text colour",
      function pickText(colour) {
        quiz.reading.change("text", colour);
        redraw();
      }));
  }

  quiz.readingPanel = { create };
})((window.RecallQuiz = window.RecallQuiz || {}));
