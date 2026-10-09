/*
 * home-layout.js
 * The Settings screen and how the home screen is laid out.
 *
 * Settings are kept in this browser and, with cloud sync on, in the
 * account, so every device behaves the same. They cover:
 *   - which home panels start open or folded (progress, recent results,
 *     "What do you want to do?", "Where you stand"), and how the chapter
 *     list starts;
 *   - the practice defaults: chapter (per book), timer per question,
 *     confidence check, HTRAB method on/off.
 *
 * The home screen starts from the defaults. Changing a practice choice
 * on the home screen is an override that lasts until the tab closes
 * (sessionStorage) and never changes the defaults; only the Settings
 * screen does. Folding a panel by hand never changes a setting either.
 *
 * Events: "recallquiz:layout-changed" (the reader chose; cloud sync
 * listens) and "recallquiz:layout-applied" (redraw; also fired when a
 * newer choice arrives from the account).
 */
(function setUpHomeLayout(quiz) {
  "use strict";

  const { findElement, createElement, createButton } = quiz.helpers;
  const STORAGE_KEY = "recall-quiz-home-layout";

  /** Allowed values for the layout choices; the first is the default. */
  const OPTIONS = {
    progress: ["open", "closed"],
    recent: ["open", "closed"],
    setup: ["open", "closed"],
    stand: ["open", "closed"],
    chapters: ["next", "open", "closed"],
    inner: ["closed", "open"],
  };
  /** Short names used in the account document */
  const ACCOUNT_KEYS = {
    progress: "p", recent: "r", setup: "s", stand: "w",
    chapters: "c", inner: "i",
  };
  const TIMERS = [0, 15, 30, 60];
  const PRACTICE_NAMES = ["timer", "confidence"];
  const OVERRIDE_KEY = "recall-quiz-practice-override";

  const choice = readSavedChoice();
  /** Whether each panel is folded right now (starts from the choice) */
  const folded = {};
  resetFolded();

  // ------------------------------------------------------------ storage

  /** @returns {object} the saved choices, cleaned */
  function readSavedChoice() {
    let saved = {};
    try {
      saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY)) || {};
    } catch (problem) {
      saved = {};
    }
    return sanitize(saved);
  }

  /**
   * Keep only allowed values; anything else falls back to the default.
   * @param {object} raw
   * @returns {object}
   */
  function sanitize(raw) {
    const clean = {
      at: Number.isFinite(raw.at) && raw.at > 0 ? raw.at : 0,
      timer: TIMERS.indexOf(raw.timer) >= 0 ? raw.timer : 0,
      confidence: raw.confidence !== false,
      htrab: raw.htrab === true,
      units: {},
    };
    Object.keys(OPTIONS).forEach(function pick(name) {
      clean[name] = OPTIONS[name].indexOf(raw[name]) >= 0 ?
        raw[name] : OPTIONS[name][0];
    });
    if (raw.units && typeof raw.units === "object") {
      Object.keys(raw.units).forEach(function copy(bookId) {
        if (typeof raw.units[bookId] === "string") {
          clean.units[bookId] = raw.units[bookId];
        }
      });
    }
    return clean;
  }

  function saveChoice() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(choice));
    } catch (problem) {
      // Storage may be blocked; the choice still works until the page closes.
    }
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
    panel.querySelectorAll("details").forEach(function set(details) {
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

  // ------------------------------------------------------ settings screen

  /** Open or close the Settings screen. */
  function showSettings(isOpen) {
    document.body.classList.toggle("in-settings", isOpen);
    findElement("settings-screen").classList.toggle("hidden", !isOpen);
    const button = findElement("settings-button");
    button.setAttribute("aria-expanded", String(isOpen));
    button.querySelector("span").textContent = isOpen ? "Done" : "Settings";
    window.scrollTo(0, 0);
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
            const value = option.getAttribute("data-value");
            if (PRACTICE_NAMES.indexOf(name) >= 0) {
              setDefault(name, name === "timer" ?
                parseInt(value, 10) : value === "on");
              return;
            }
            choice[name] = value;
            choiceChanged();
            resetFolded();
            document.dispatchEvent(
              new CustomEvent("recallquiz:layout-applied"));
          });
        });
      });
    const unitPicker = findElement("default-unit");
    unitPicker.addEventListener("change", function pickUnit() {
      setDefault("unit", unitPicker.value);
    });
    makeFoldable(findElement("session-setup"), "setup");
    makeFoldable(findElement("progress-panel"), "progress");
    showChoices();
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
    if (name === "confidence") {
      return choice.confidence ? "on" : "off";
    }
    return String(choice[name]);
  }

  /** Mark the buttons that match the saved choices. */
  function showChoices() {
    document.querySelectorAll("#settings-screen [data-layout]").forEach(
      function mark(group) {
        const current = choiceAsText(group.getAttribute("data-layout"));
        group.querySelectorAll("button").forEach(function set(option) {
          option.setAttribute("aria-pressed",
            String(option.getAttribute("data-value") === current));
        });
      });
  }

  // ----------------------------------------------------- practice choices

  /** @returns {string} the open book's id, or "" */
  function bookId() {
    return quiz.book && quiz.book.data ? quiz.book.bookId() : "";
  }

  /** @returns {object} the home-screen overrides of this tab */
  function readOverrides() {
    try {
      const saved = JSON.parse(
        window.sessionStorage.getItem(OVERRIDE_KEY)) || {};
      saved.units = saved.units || {};
      return saved;
    } catch (problem) {
      return { units: {} };
    }
  }

  function saveOverrides() {
    try {
      window.sessionStorage.setItem(OVERRIDE_KEY,
        JSON.stringify(overrides));
    } catch (problem) {
      // The overrides then last until the page is reloaded.
    }
  }

  let overrides = readOverrides();
  let applying = false;

  /** @returns {{timer, confidence, htrab, unit}} the saved defaults */
  function defaultsNow() {
    return {
      timer: choice.timer, confidence: choice.confidence,
      htrab: choice.htrab, unit: choice.units[bookId()] || "all",
    };
  }

  /** @returns {{timer, confidence, htrab, unit}} defaults plus overrides */
  function effectiveNow() {
    const result = defaultsNow();
    ["timer", "confidence", "htrab"].forEach(function copy(name) {
      if (overrides[name] !== undefined) {
        result[name] = overrides[name];
      }
    });
    if (overrides.units[bookId()]) {
      result.unit = overrides.units[bookId()];
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
    ["timer", "confidence", "htrab"].forEach(function keep(name) {
      if (now[name] === defaults[name]) {
        delete overrides[name];
      } else {
        overrides[name] = now[name];
      }
    });
    if (now.unit === defaults.unit) {
      delete overrides.units[bookId()];
    } else {
      overrides.units[bookId()] = now.unit;
    }
    saveOverrides();
  }

  /**
   * The reader set a default on the Settings screen: save it, drop the
   * override of that choice, and show it on the home screen.
   * @param {"timer"|"confidence"|"htrab"|"unit"} name
   * @param {number|boolean|string} value
   */
  function setDefault(name, value) {
    if (name === "unit") {
      if (!bookId()) {
        return;
      }
      choice.units[bookId()] = value;
      delete overrides.units[bookId()];
    } else {
      choice[name] = value;
      delete overrides[name];
    }
    saveOverrides();
    choiceChanged();
    applyEffective();
  }

  /** Put defaults and overrides onto the home controls and Settings. */
  function applyEffective() {
    if (!bookId()) {
      return;
    }
    applying = true;
    const wanted = effectiveNow();
    quiz.settings.useChoices({
      timer: wanted.timer, confidence: wanted.confidence,
      unit: wanted.unit,
    });
    const picker = findElement("default-unit");
    const defaultUnit = defaultsNow().unit;
    if (Array.from(picker.options).some(function has(option) {
      return option.value === defaultUnit;
    })) {
      picker.value = defaultUnit;
    }
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

  // ---------------------------------------------------------- account

  /**
   * Use settings from the account if they are newer than this browser's.
   * @param {object} remote  the shape from readForAccount()
   * @returns {boolean} whether the account's settings were used
   */
  function useRemote(remote) {
    if (!remote || !(remote.a > choice.at)) {
      return false;
    }
    const raw = { at: remote.a, timer: remote.t, confidence: remote.f,
      htrab: remote.h, units: Object.assign({}, choice.units, remote.u) };
    Object.keys(ACCOUNT_KEYS).forEach(function copy(name) {
      raw[name] = remote[ACCOUNT_KEYS[name]];
    });
    Object.assign(choice, sanitize(raw));
    saveChoice();
    resetFolded();
    showChoices();
    applyEffective();
    document.dispatchEvent(new CustomEvent("recallquiz:layout-applied"));
    return true;
  }

  /** @returns {object} the settings in their account shape */
  function readForAccount() {
    const remote = { t: choice.timer, f: choice.confidence,
      h: choice.htrab, u: choice.units, a: choice.at };
    Object.keys(ACCOUNT_KEYS).forEach(function copy(name) {
      remote[ACCOUNT_KEYS[name]] = choice[name];
    });
    return remote;
  }

  quiz.layout = {
    chaptersStart, innerStartsOpen, makeFoldable, createExpandControls,
    setAllOpen, readForAccount, useRemote, setDefault,
  };

  document.addEventListener("DOMContentLoaded", setUpSettingsScreen);
  document.addEventListener("recallquiz:practice-changed", practiceChanged);
  document.addEventListener("recallquiz:layout-applied", showStaticPanels);
  document.addEventListener("recallquiz:book-opened", applyEffective);
})((window.RecallQuiz = window.RecallQuiz || {}));
