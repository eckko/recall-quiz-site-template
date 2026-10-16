/*
 * home-layout.js
 * The Settings screen and how the home screen is laid out, for ONE book.
 * Every book keeps its own settings (js/book-settings.js), so each book
 * can have its own view. They cover:
 *   - which home panels start open or folded (progress, recent results,
 *     "What do you want to do?", "Where you stand"), and how the chapter
 *     list starts;
 *   - which controls the home screen shows at all (the whole "What do you
 *     want to do?" panel, the Keep me going block, the timer, confidence
 *     check, HTRAB method, the 5-minute button, Custom practice and its
 *     parts including each "Which questions" option, the question flag
 *     bar and the idea flag bar). Which ones start hidden is decided by
 *     js/default-settings.js;
 *   - the practice defaults: lesson (chapter, topic, idea), timer per
 *     question, confidence check, HTRAB method, and for Custom practice:
 *     which questions, session length, number of questions, minutes, and
 *     whether the section starts open.
 *
 * The home screen starts from the defaults in js/default-settings.js.
 * Changing the lesson, timer, confidence check or HTRAB on the home
 * screen is an override that lasts
 * until the tab closes (sessionStorage, versioned) and never changes the
 * defaults; only the Settings screen does. Hiding a control never changes
 * its default: a hidden control still applies its default value. Folding a
 * panel by hand never changes a setting either.
 *
 * Events: "recallquiz:layout-changed" (the reader chose; cloud sync
 * listens) and "recallquiz:layout-applied" (redraw; also fired when a
 * newer choice arrives from the account).
 */
(function setUpHomeLayout(quiz) {
  "use strict";

  const { findElement, createElement, createButton } = quiz.helpers;
  const OVERRIDE_KEY_PREFIX = "recall-quiz-practice-override:";
  const OVERRIDE_VERSION = 1;
  /** Version N to N + 1 steps for the saved overrides */
  const OVERRIDE_MIGRATIONS = {};

  /** Where every first-time default lives (js/default-settings.js) */
  const DEFAULTS = window.RecallQuizDefaults;
  /** Allowed values for the layout choices. The defaults are not here: they
      come from DEFAULTS. */
  const OPTIONS = {
    progress: ["open", "closed"],
    recent: ["open", "closed"],
    setup: ["open", "closed"],
    stand: ["open", "closed"],
    chapters: ["next", "open", "closed"],
    inner: ["closed", "open"],
    customStart: ["auto", "open", "closed"],
    filter: ["all", "due", "gaps", "important"],
    lengthMode: ["questions", "time"],
  };
  /** Things the home screen can hide */
  const SHOW_KEYS = ["setup", "keepGoing", "timer", "confidence", "htrab",
    "quick", "custom", "filter", "filterDue", "filterGaps",
    "filterImportant", "filterAll", "length", "flagBar", "ideaFlagBar"];
  /** The "Which questions" options, with the filter value each stands for */
  const FILTER_SHOW_KEYS = ["filterDue", "filterGaps", "filterImportant",
    "filterAll"];
  const TIMERS = [0, 15, 30, 60];
  const DEFAULT_COUNT = DEFAULTS.practice.count;
  const DEFAULT_MINUTES = DEFAULTS.practice.minutes;
  const MAX_COUNT = 999;
  const MAX_MINUTES = 240;
  /** Choices that are practice defaults (set on the Settings screen) */
  const PRACTICE_NAMES = ["timer", "confidence", "filter", "lengthMode"];
  /** Practice values a home-screen change can override for this tab */
  const OVERRIDE_NAMES = ["timer", "confidence", "htrab"];
  const WHOLE_BOOK = { unit: "all" };

  const choice = sanitize({});
  /** Whether each panel is folded right now (starts from the choice) */
  const folded = {};
  resetFolded();

  // ------------------------------------------------------------ storage

  /**
   * Keep only allowed values; anything else falls back to the default.
   * @param {object} raw
   * @returns {object}
   */
  function sanitize(raw) {
    const clean = {
      at: Number.isFinite(raw.at) && raw.at > 0 ? raw.at : 0,
      timer: TIMERS.indexOf(raw.timer) >= 0 ?
        raw.timer : DEFAULTS.practice.timer,
      confidence: typeof raw.confidence === "boolean" ?
        raw.confidence : DEFAULTS.practice.confidence,
      htrab: typeof raw.htrab === "boolean" ?
        raw.htrab : DEFAULTS.practice.htrab,
      count: cleanWholeNumber(raw.count, DEFAULT_COUNT, MAX_COUNT, true),
      minutes: cleanWholeNumber(raw.minutes, DEFAULT_MINUTES,
        MAX_MINUTES, false),
      scope: cleanScope(raw.scope),
      show: {},
    };
    Object.keys(OPTIONS).forEach(function pick(name) {
      clean[name] = OPTIONS[name].indexOf(raw[name]) >= 0 ?
        raw[name] : defaultChoice(name);
    });
    const savedShow = raw.show && typeof raw.show === "object" ?
      raw.show : {};
    SHOW_KEYS.forEach(function keep(key) {
      clean.show[key] = typeof savedShow[key] === "boolean" ?
        savedShow[key] : DEFAULTS.show[key];
    });
    return clean;
  }

  /**
   * @param {string} name  a layout or practice choice (a key of OPTIONS)
   * @returns {string} its first-time default
   */
  function defaultChoice(name) {
    return name in DEFAULTS.homeLayout ?
      DEFAULTS.homeLayout[name] : DEFAULTS.practice[name];
  }

  /**
   * @param {*} value
   * @param {number} fallback
   * @param {number} biggest
   * @param {boolean} isZeroAllowed  zero means "all" for the count
   * @returns {number} a whole number in range, else the fallback
   */
  function cleanWholeNumber(value, fallback, biggest, isZeroAllowed) {
    const smallest = isZeroAllowed ? 0 : 1;
    return Number.isInteger(value) && value >= smallest && value <= biggest ?
      value : fallback;
  }

  /**
   * @param {*} raw  a saved lesson choice
   * @returns {{unit: string, section?: string, concept?: string}}
   */
  function cleanScope(raw) {
    if (!raw || typeof raw.unit !== "string") {
      return Object.assign({}, DEFAULTS.practice.scope);
    }
    if (raw.unit === "all") {
      return Object.assign({}, WHOLE_BOOK);
    }
    const scope = { unit: raw.unit };
    if (typeof raw.section === "string" && raw.section) {
      scope.section = raw.section;
      if (typeof raw.concept === "string" && raw.concept) {
        scope.concept = raw.concept;
      }
    }
    return scope;
  }

  /** Load this book's saved settings into the choice. */
  function loadChoiceForBook() {
    Object.keys(choice).forEach(function drop(name) {
      delete choice[name];
    });
    Object.assign(choice, sanitize(quiz.bookSettings.readLayout()));
    resetFolded();
  }

  /** Keep a copy of the choice with this book's settings. */
  function saveChoice() {
    quiz.bookSettings.saveLayout(JSON.parse(JSON.stringify(choice)));
  }

  function resetFolded() {
    ["progress", "recent", "setup", "stand"].forEach(function set(key) {
      folded[key] = choice[key] === "closed";
    });
  }

  // ---------------------------------------------------- reading choices

  /** @returns {"next"|"open"|"closed"} how chapters start */
  function chaptersStart() {
    return choice.chapters;
  }

  /** @returns {boolean} whether topics and ideas start open */
  function innerStartsOpen() {
    return choice.inner === "open";
  }

  /**
   * @param {string} key  one of SHOW_KEYS
   * @returns {boolean} whether the reader wants this shown
   */
  function isShown(key) {
    return choice.show[key] !== false;
  }

  /**
   * @returns {boolean} true when every "Which questions" option is hidden
   *   (then the whole row is out of sight and the default filter is used)
   */
  function areAllFilterOptionsHidden() {
    return FILTER_SHOW_KEYS.every(function isOff(key) {
      return !isShown(key);
    });
  }

  // ------------------------------------------------------------ folding

  /**
   * Make the first heading of a panel a button that folds the panel.
   * Safe to call again after the panel is redrawn.
   * @param {HTMLElement} panel
   * @param {"progress"|"recent"|"setup"|"stand"} key
   */
  function makeFoldable(panel, key) {
    const heading = panel.querySelector("h2");
    if (heading && !heading.querySelector(".panel-toggle")) {
      const button = createElement("button", "panel-toggle");
      button.type = "button";
      button.appendChild(createElement("span", null, heading.textContent));
      button.appendChild(createElement("i", "chevron"));
      heading.textContent = "";
      heading.appendChild(button);
      button.addEventListener("click", function toggle() {
        folded[key] = !folded[key];
        showFolded(panel, key);
      });
    }
    showFolded(panel, key);
  }

  /** Show or hide a panel's body to match its folded state. */
  function showFolded(panel, key) {
    panel.classList.toggle("is-collapsed", folded[key]);
    const button = panel.querySelector(".panel-toggle");
    if (button) {
      button.setAttribute("aria-expanded", String(!folded[key]));
    }
  }

  /** Open or close every chapter, topic and idea inside a panel. */
  function setAllOpen(panel, open) {
    panel.querySelectorAll("details:not(.flag-bar)").forEach(
      function set(details) {
        details.open = open;
      });
  }

  /**
   * The "Expand all" and "Collapse all" buttons for a panel.
   * @param {HTMLElement} panel
   * @returns {HTMLElement}
   */
  function createExpandControls(panel) {
    const row = createElement("div", "expand-controls");
    row.appendChild(createButton("Expand all", "link-button",
      function expand() {
        setAllOpen(panel, true);
      }));
    row.appendChild(createButton("Collapse all", "link-button",
      function collapse() {
        setAllOpen(panel, false);
      }));
    return row;
  }

  // -------------------------------------------------- hiding controls

  /** Whether Keep me going was shown the last time visibility was applied
      (its "Up next" line is only worked out while it is shown) */
  let wasKeepGoingShown = false;

  /** Hide the home-screen parts the reader switched off (see home.css). */
  function applyVisibility() {
    const hidden = SHOW_KEYS.filter(function isOff(key) {
      return !isShown(key);
    });
    if (areAllFilterOptionsHidden() && !hidden.includes("filter")) {
      hidden.push("filter");
    }
    document.body.setAttribute("data-hide", hidden.join(" "));
    const isKeepGoingShown = isShown("keepGoing");
    if (isKeepGoingShown && !wasKeepGoingShown && quiz.settings) {
      quiz.settings.updateKeepGoingSummary();
    }
    wasKeepGoingShown = isKeepGoingShown;
  }

  /** Open or fold Custom practice as the reader chose. */
  function applyCustomStart() {
    const details = findElement("custom-practice");
    if (choice.customStart === "auto") {
      details.open = !quiz.learning.hasConcepts();
    } else {
      details.open = choice.customStart === "open";
    }
  }

  // ------------------------------------------------------ settings screen

  /** Open or close the Settings screen. */
  function showSettings(isOpen) {
    if (isOpen) {
      foldSettingsSections();
    }
    document.body.classList.toggle("in-settings", isOpen);
    findElement("settings-screen").classList.toggle("hidden", !isOpen);
    const button = findElement("settings-button");
    button.setAttribute("aria-expanded", String(isOpen));
    button.querySelector("span").textContent = isOpen ? "Done" : "Settings";
    window.scrollTo(0, 0);
  }

  /** Put every section of the Settings screen back to its default (each
      visit starts so; all are folded unless default-settings.js says
      otherwise). */
  function foldSettingsSections() {
    document.querySelectorAll("#settings-screen details.settings-section")
      .forEach(function fold(section) {
        section.open = DEFAULTS.settingsSectionsOpen[section.id] === true;
      });
  }

  /**
   * One Settings button was pressed.
   * @param {string} name  the group's data-layout name
   * @param {string} value  the button's data-value
   */
  function pickLayoutValue(name, value) {
    if (name.indexOf("show.") === 0) {
      choice.show[name.slice("show.".length)] = value === "show";
      choiceChanged();
      applyVisibility();
    } else if (PRACTICE_NAMES.indexOf(name) >= 0) {
      setDefault(name, name === "timer" ? parseInt(value, 10) :
        name === "confidence" ? value === "on" : value);
    } else if (name === "customStart") {
      choice.customStart = value;
      choiceChanged();
      applyCustomStart();
    } else {
      choice[name] = value;
      choiceChanged();
      resetFolded();
      document.dispatchEvent(new CustomEvent("recallquiz:layout-applied"));
    }
  }

  /** Connect the Settings button and the layout choice buttons. */
  function setUpSettingsScreen() {
    const button = findElement("settings-button");
    if (!button) {
      return;
    }
    button.addEventListener("click", function toggleScreen() {
      showSettings(!document.body.classList.contains("in-settings"));
    });
    document.querySelectorAll("#settings-screen [data-layout]").forEach(
      function connect(group) {
        const name = group.getAttribute("data-layout");
        group.querySelectorAll("button").forEach(function wire(option) {
          option.addEventListener("click", function pick() {
            pickLayoutValue(name, option.getAttribute("data-value"));
          });
        });
      });
    setUpNumberDefaults();
    quiz.scopePicker.setUpDefaults(function onDefaultScope(scope) {
      setDefault("scope", scope);
    });
    makeFoldable(findElement("session-setup"), "setup");
    makeFoldable(findElement("progress-panel"), "progress");
    showChoices();
  }

  /** The default number of questions and minutes (input boxes). */
  function setUpNumberDefaults() {
    [["default-count-input", "count"], ["default-minutes-input", "minutes"]]
      .forEach(function connect(entry) {
        findElement(entry[0]).addEventListener("change",
          function save() {
            setDefault(entry[1], readNumberInput(entry[0]));
          });
      });
    document.querySelectorAll("#settings-screen [data-default-fills]")
      .forEach(function connectQuickPick(pill) {
        pill.addEventListener("click", function fill() {
          const input = findElement(pill.getAttribute("data-default-fills"));
          input.value = pill.getAttribute("data-fill-value");
          input.dispatchEvent(new Event("change"));
        });
      });
  }

  /**
   * @param {string} inputId
   * @returns {number} the whole number typed (0 when empty)
   */
  function readNumberInput(inputId) {
    const typed = parseInt(findElement(inputId).value, 10);
    return Number.isInteger(typed) ? typed : 0;
  }

  /** Show the folded state of the panels that are written in index.html. */
  function showStaticPanels() {
    showFolded(findElement("session-setup"), "setup");
    showFolded(findElement("progress-panel"), "progress");
  }

  /** The reader changed a choice: stamp it, keep it, tell cloud sync. */
  function choiceChanged() {
    choice.at = Date.now();
    saveChoice();
    showChoices();
    document.dispatchEvent(new CustomEvent("recallquiz:layout-changed"));
  }

  /** @returns {string} a saved choice as its button's data-value */
  function choiceAsText(name) {
    if (name.indexOf("show.") === 0) {
      return isShown(name.slice("show.".length)) ? "show" : "hide";
    }
    if (name === "confidence") {
      return choice.confidence ? "on" : "off";
    }
    return String(choice[name]);
  }

  /** Mark the buttons and boxes that match the saved choices. */
  function showChoices() {
    document.querySelectorAll("#settings-screen [data-layout]").forEach(
      function mark(group) {
        const current = choiceAsText(group.getAttribute("data-layout"));
        group.querySelectorAll("button").forEach(function set(option) {
          option.setAttribute("aria-pressed",
            String(option.getAttribute("data-value") === current));
        });
      });
    findElement("default-count-input").value =
      choice.count ? String(choice.count) : "";
    findElement("default-minutes-input").value = String(choice.minutes);
    quiz.scopePicker.showDefaultScope(choice.scope);
    showSectionSummaries();
  }

  /** @param {string} id  a settings section's summary element
   *  @param {string} text */
  function setSummary(id, text) {
    const element = document.getElementById(id);
    if (element) {
      element.textContent = text;
    }
  }

  /** Words for each choice, shown on the folded Settings sections. */
  const FILTER_WORDS = { all: "Everything", due: "Due and new",
    gaps: "My gaps", important: "Important only" };
  const CHAPTER_WORDS = { next: "Next one open", open: "All open",
    closed: "All closed" };

  /** Show a short summary of each section on its folded title. */
  function showSectionSummaries() {
    const hiddenCount = SHOW_KEYS.filter(function isOff(key) {
      return !isShown(key);
    }).length;
    setSummary("visibility-section-current", hiddenCount ?
      hiddenCount + " hidden" : "All shown");
    setSummary("practice-section-current",
      "Timer " + (choice.timer ? choice.timer + "s" : "off") +
      " · Confidence " + (choice.confidence ? "on" : "off"));
    setSummary("custom-practice-section-current",
      FILTER_WORDS[choice.filter] + " · " + (choice.lengthMode === "time" ?
        choice.minutes + " min" : String(choice.count || "All")));
    setSummary("home-section-current", CHAPTER_WORDS[choice.chapters]);
  }

  // ----------------------------------------------------- practice choices

  /**
   * @returns {string} the key of this book's overrides in this tab
   */
  function overrideKey() {
    return OVERRIDE_KEY_PREFIX + (bookId() || "book");
  }

  /** @returns {string} the open book's id, or "" */
  function bookId() {
    return quiz.book && quiz.book.data ? quiz.book.bookId() : "";
  }

  /**
   * Read this tab's overrides for the open book, upgraded to this
   * version. Anything unreadable, or from a newer version, is dropped.
   * @returns {object}
   */
  function readOverrides() {
    try {
      const saved = JSON.parse(
        window.sessionStorage.getItem(overrideKey()));
      if (!saved || typeof saved !== "object") {
        return {};
      }
      const version = Number(saved.v) || 1;
      if (version > OVERRIDE_VERSION) {
        return {};
      }
      const upgraded = quiz.bookSettings.runMigrations(saved, version,
        OVERRIDE_MIGRATIONS, OVERRIDE_VERSION);
      return Object.assign({}, upgraded, { v: OVERRIDE_VERSION });
    } catch (problem) {
      return {};
    }
  }

  function saveOverrides() {
    overrides.v = OVERRIDE_VERSION;
    try {
      window.sessionStorage.setItem(overrideKey(),
        JSON.stringify(overrides));
    } catch (problem) {
      // The overrides then last until the page is reloaded.
    }
  }

  let overrides = {};
  let applying = false;

  /** @returns {object} the saved defaults for this book */
  function defaultsNow() {
    return {
      timer: choice.timer, confidence: choice.confidence,
      htrab: choice.htrab, scope: choice.scope,
    };
  }

  /** @returns {object} defaults plus overrides */
  function effectiveNow() {
    const result = defaultsNow();
    OVERRIDE_NAMES.forEach(function copy(name) {
      if (overrides[name] !== undefined) {
        result[name] = overrides[name];
      }
    });
    if (overrides.scope) {
      result.scope = cleanScope(overrides.scope);
    }
    return result;
  }

  /** The reader changed a practice choice on the home screen: keep the
      ones that differ from the defaults, for this tab only. */
  function practiceChanged() {
    if (applying || !bookId()) {
      return;
    }
    const now = quiz.settings.readChoices();
    now.htrab = quiz.htrab && quiz.htrab.isOn ?
      quiz.htrab.isOn() : defaultsNow().htrab;
    const defaults = defaultsNow();
    OVERRIDE_NAMES.forEach(function keep(name) {
      if (now[name] === defaults[name]) {
        delete overrides[name];
      } else {
        overrides[name] = now[name];
      }
    });
    if (JSON.stringify(now.scope) === JSON.stringify(defaults.scope)) {
      delete overrides.scope;
    } else {
      overrides.scope = now.scope;
    }
    saveOverrides();
  }

  /**
   * The reader set a default on the Settings screen: save it, drop the
   * override of that choice, and show it on the home screen.
   * @param {"timer"|"confidence"|"htrab"|"scope"|"filter"|"lengthMode"|
   *   "count"|"minutes"} name
   * @param {number|boolean|string|object} value
   */
  function setDefault(name, value) {
    if (name === "scope") {
      choice.scope = cleanScope(value);
    } else if (name === "count") {
      choice.count = cleanWholeNumber(value, DEFAULT_COUNT, MAX_COUNT, true);
    } else if (name === "minutes") {
      choice.minutes = cleanWholeNumber(value, DEFAULT_MINUTES,
        MAX_MINUTES, false);
    } else {
      choice[name] = value;
    }
    delete overrides[name];
    saveOverrides();
    choiceChanged();
    applyEffective(["filter", "lengthMode", "count", "minutes"]
      .indexOf(name) >= 0);
  }

  /**
   * Put defaults and overrides onto the home controls and Settings.
   * @param {boolean} isCustomIncluded  also reset the Custom practice
   *   controls to their defaults (when a book opens or one of those
   *   defaults changes)
   */
  function applyEffective(isCustomIncluded) {
    if (!bookId()) {
      return;
    }
    applying = true;
    const wanted = effectiveNow();
    const choices = {
      timer: wanted.timer, confidence: wanted.confidence,
      scope: wanted.scope,
    };
    if (isCustomIncluded) {
      Object.assign(choices, {
        filter: choice.filter, lengthMode: choice.lengthMode,
        count: choice.count, minutes: choice.minutes,
      });
    }
    quiz.settings.useChoices(choices);
    showChoices();
    applying = false;
    if (quiz.htrab && quiz.htrab.useRemote) {
      // The HTRAB switches are built just after this event; wait for them.
      setTimeout(function useHtrab() {
        quiz.htrab.useRemote(wanted.htrab);
        quiz.htrab.showDefault(choice.htrab);
      }, 0);
    }
  }

  // ----------------------------------------------------------- book change

  /** A book was opened: use its own settings, from fresh defaults. */
  function useBookSettings() {
    loadChoiceForBook();
    overrides = readOverrides();
    applyVisibility();
    applyCustomStart();
    applyEffective(true);
    document.dispatchEvent(new CustomEvent("recallquiz:layout-applied"));
  }

  /**
   * Settings for this book arrived from the account: use them.
   * Same as opening the book, without touching this tab's overrides.
   */
  function useAccountSettings() {
    loadChoiceForBook();
    applyVisibility();
    applyCustomStart();
    applyEffective(true);
    document.dispatchEvent(new CustomEvent("recallquiz:layout-applied"));
  }

  quiz.layout = {
    chaptersStart, innerStartsOpen, makeFoldable, createExpandControls,
    setAllOpen, setDefault, isShown, applyCustomStart,
  };

  document.addEventListener("DOMContentLoaded", setUpSettingsScreen);
  document.addEventListener("recallquiz:practice-changed", practiceChanged);
  document.addEventListener("recallquiz:layout-applied", showStaticPanels);
  document.addEventListener("recallquiz:book-opened", useBookSettings);
  document.addEventListener("recallquiz:book-settings-applied",
    useAccountSettings);
})((window.RecallQuiz = window.RecallQuiz || {}));
